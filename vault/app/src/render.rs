//! The render worker is this app. The studio (or an agent, over MCP) queues a job on the API's render queue
//! (render_jobs: `POST /api/timelines/:id/renders`, `…/frames`); this Mac claims it with its own key, renders it
//! natively with `vault-render` — Core Image on Metal, VideoToolbox, AVFoundation, Core Text; no bun, no ffmpeg, no
//! Chrome — puts every file it makes into the vault, and hands the API the same report the old worker did
//! (`PUT /api/renders/:id`: progress while it works, then `Render::job_result`), so the studio's Render tab, its
//! deliveries and the calendar work as they did.
//!
//!   render  a timeline into every delivery (16:9 4K master + 1080 copy, 9:16, 1:1, 4:5), levelled to `LOUDNESS`.
//!           World clips are rendered first as ACEScct plates at each shape's size, in the app's own unseen world
//!           (world.rs, cached by what they are made of); every delivery goes into the vault as class delivery, in the
//!           story most of the timeline's files are in (else the inbox), described by `Render::about`.
//!   frame   a hero frame: one frame at `params.t` in `params.shape`, through the whole chain, as a 16-bit PNG.
//!   proxy, lut  history: closed as failed, saying the Mac makes them now (as the old worker did).
//!
//! It shares the proxies' rules: one heavy GPU job at a time (`proxies::TURN` — proxies, world proxies and renders all
//! take it; the job is only claimed once it is this Mac's turn), an ingest first, only while macOS says memory is
//! normal, and while it renders the uploads wait (`hold: render`). How far it is shows beside the proxies
//! (`proxies_now`, `of: "render:<job id>"`) and on the job itself. `vault_render::render` runs on one blocking
//! thread: its GPU and AVFoundation objects are not `Send`, and one render runs at a time.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Duration,
};

use anyhow::Context;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager};
use vault_core::{Vault, Verdict, ingest::Batch};
use vault_render::{
    Library, Lut3d, Media, Options, Plate, Target,
    output::RENDER_LUT_SIZE,
    timeline::{Clip, FPS, Shape, Timeline, shapes_of},
};

use crate::{Res, auth::Auth, err, proxies, world};

/// The loudness every film is levelled to: −14 LUFS integrated, the true peak at most −1 dBTP — what YouTube,
/// Instagram and TikTok play at (and room for their AAC encoders). Change it here.
pub const LOUDNESS: Target = Target { lufs: -14.0, true_peak: -1.0 };

/// How often the queue is asked while it is empty, and how long an API that cannot be reached is waited out.
const POLL: Duration = Duration::from_secs(3);
const AWAY: Duration = Duration::from_secs(10);

/// The output transform every render and hero frame takes: ACES 2.0 to Rec.709 (`vault_media::aces2`), baked once at
/// 129³ (a few seconds, on the first render's thread).
static ODT: OnceLock<Lut3d> = OnceLock::new();

pub(crate) fn odt() -> &'static Lut3d {
    ODT.get_or_init(|| {
        Lut3d::from_rgb("odt-rec709", RENDER_LUT_SIZE, vault_media::aces2::bake_cube(RENDER_LUT_SIZE)).expect("aces2 bakes a whole cube")
    })
}

/// Claim render jobs and render them, one at a time, for as long as the app runs.
pub async fn sweep(handle: AppHandle, vault: Arc<Vault>) {
    // work a render that ended midway left behind (the app quit, the Mac froze)
    for e in std::fs::read_dir(vault.ingest_dir()).into_iter().flatten().flatten() {
        if e.file_name().to_string_lossy().starts_with("render-") {
            tracing::info!("left from an earlier render, removed: {}", e.path().display());
            std::fs::remove_dir_all(e.path()).ok();
        }
    }
    tokio::time::sleep(Duration::from_secs(20)).await;
    let mut refused: Option<u16> = None;
    loop {
        if !crate::auth::signed_in() {
            tokio::time::sleep(AWAY).await;
            continue;
        }
        let auth = handle.state::<Auth>().inner().clone();
        // this Mac's turn first — after the proxies queued before, after an ingest, with memory to spare — and only
        // then a job: one claimed here never waits behind other work
        let Ok(turn) = proxies::TURN.acquire().await else { return };
        vault.hold.free_of("ingest").await;
        while proxies::pressure() > 1 {
            tokio::time::sleep(Duration::from_secs(5)).await;
        }
        let job = match auth.call("POST", "/api/renders/claim", None).await {
            Ok((200..=299, job)) if job.is_object() => job,
            Ok((status, _)) if status >= 400 => {
                if refused != Some(status) {
                    tracing::warn!("render queue: the API refused the claim ({status})");
                    refused = Some(status);
                }
                drop(turn);
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue;
            }
            Ok(_) => {
                // nothing queued
                refused = None;
                drop(turn);
                tokio::time::sleep(POLL).await;
                continue;
            }
            Err(_) => {
                // the API away for a moment (restarted, rebuilt) is waited out
                drop(turn);
                tokio::time::sleep(AWAY).await;
                continue;
            }
        };
        refused = None;
        run(&handle, &vault, &auth, job).await;
        drop(turn);
    }
}

/// A job's progress: on the job (throttled, always the latest) and in the proxies' list.
#[derive(Clone)]
struct Progress {
    tx: Arc<tokio::sync::watch::Sender<(f64, String)>>,
    of: String,
    name: Arc<Mutex<String>>,
}

impl Progress {
    /// Start telling the API. The task ends once every copy of the `Progress` is dropped, after sending the last
    /// value — await it before the job's last word, so no progress lands after it.
    fn start(auth: &Auth, id: &str, name: &str) -> (Self, tauri::async_runtime::JoinHandle<()>) {
        let (tx, mut rx) = tokio::sync::watch::channel((0.0, "starting".to_string()));
        let (auth, path) = (auth.clone(), format!("/api/renders/{id}"));
        let task = tauri::async_runtime::spawn(async move {
            while rx.changed().await.is_ok() {
                let (progress, note) = rx.borrow_and_update().clone();
                if let Err(e) = auth.call("PUT", &path, Some(json!({ "progress": progress, "note": note }))).await {
                    tracing::warn!("render progress: {e}");
                }
                // at most one report every two seconds, always the latest
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });
        let p = Self { tx: Arc::new(tx), of: format!("render:{id}"), name: Arc::new(Mutex::new(name.to_string())) };
        proxies::set(&p.of, name, "starting", 0.0);
        (p, task)
    }

    /// How far (0…1) and what is happening — "rendering 9:16" is "rendering" on the job, as the studio reads it.
    fn set(&self, done: f64, what: &str) {
        let note = if what.starts_with("rendering") && what != "rendering world plates" && what != "rendering the frame" { "rendering" } else { what };
        self.tx.send_replace((done.clamp(0.0, 1.0), note.to_string()));
        let name = self.name.lock().unwrap().clone();
        proxies::set(&self.of, &format!("{name} · {what}"), "making", done);
    }

    fn named(&self, name: &str) {
        *self.name.lock().unwrap() = name.to_string();
    }
}

/// One job, start to report.
async fn run(handle: &AppHandle, vault: &Arc<Vault>, auth: &Auth, job: Value) {
    let id = job["id"].as_str().unwrap_or_default().to_string();
    let kind = job["kind"].as_str().unwrap_or("render").to_string();
    tracing::info!("render job {id}: {kind} {}", job["timeline_id"].as_str().unwrap_or(""));
    let body = match kind.as_str() {
        // from before: proxies and the viewer's LUTs are this app's own work, never jobs
        "proxy" => json!({ "status": "failed", "note": "Proxies are made by the Mac app now — a world shot's too, when a timeline plays it." }),
        "lut" => json!({ "status": "failed", "note": "The viewer's LUTs are baked by the Mac app now." }),
        _ => {
            let label = if kind == "frame" { "Hero frame" } else { "Render" };
            let (progress, told) = Progress::start(auth, &id, label);
            let result = {
                let _held = vault.hold.take("render");
                let _awake = world::Awake::begin("rendering a film");
                let _kept = world::keep();
                let work = Work::new(vault.ingest_dir().join(format!("render-{id}")));
                match work {
                    Ok(work) => {
                        if kind == "frame" {
                            frame_job(handle, vault, auth, &job, &work, &progress).await
                        } else {
                            render_job(handle, vault, auth, &job, &work, &progress).await
                        }
                    }
                    Err(e) => Err(e),
                }
            };
            world::close_if_idle(handle);
            proxies::clear(&progress.of);
            // the last progress report is sent before the result, never after it
            drop(progress);
            told.await.ok();
            match result {
                Ok(body) => body,
                Err(e) => json!({ "status": "failed", "note": e.chars().take(280).collect::<String>() }),
            }
        }
    };
    let status = body["status"].as_str().unwrap_or("").to_string();
    match status.as_str() {
        "done" => tracing::info!("render job {id}: done → {}", body["output_hash"].as_str().unwrap_or("")),
        _ => tracing::warn!("render job {id}: {status} — {}", body["note"].as_str().unwrap_or("")),
    }
    report(auth, &id, body).await;
    handle.emit("vault-render", json!({ "job": id, "status": status })).ok();
}

/// The job's last word: tried again for a while — a finished render must not be lost to a moment without the API.
async fn report(auth: &Auth, id: &str, body: Value) {
    let body = match vault_render::api_accepts(&body) {
        Ok(()) => body,
        Err(e) => json!({ "status": "failed", "note": format!("the render's report is not one the API takes: {e}").chars().take(280).collect::<String>() }),
    };
    for wait in [0u64, 5, 15, 30, 60, 120] {
        tokio::time::sleep(Duration::from_secs(wait)).await;
        match auth.call("PUT", &format!("/api/renders/{id}"), Some(body.clone())).await {
            Ok((s, _)) if s < 300 => return,
            Ok((s, answer)) if (400..500).contains(&s) => {
                tracing::warn!("render job {id}: the API refused the report ({s}): {answer}");
                return;
            }
            Ok((s, _)) => tracing::warn!("render job {id}: the API answered {s} to the report — again"),
            Err(e) => tracing::warn!("render job {id}: {e} — again"),
        }
    }
}

/// The job's own folder in the ingest area: the exported sources and the files it makes; gone when the job is.
struct Work(PathBuf);

impl Work {
    fn new(dir: PathBuf) -> Res<Self> {
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).map_err(err)?;
        Ok(Self(dir))
    }
}

impl Drop for Work {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).ok();
    }
}

// ── the vault, as the render reads it ──────────────────────────────────────────────────────────────────────────────

/// The vault's catalog when the job started, and its files exported to disk as the render asks for them — with
/// their own extension (AVFoundation tells a movie by it), into the job's folder, removed with it.
struct Vaulted {
    vault: Arc<Vault>,
    rt: tokio::runtime::Handle,
    media: HashMap<String, Media>,
    ext: HashMap<String, String>,
    story: HashMap<String, String>,
    /// an original's proxy (its meta.proxy) → the original: conform finds it from either side
    originals: HashMap<String, String>,
    dir: PathBuf,
    files: Mutex<HashMap<String, PathBuf>>,
}

impl Vaulted {
    async fn new(vault: &Arc<Vault>, dir: PathBuf) -> Res<Self> {
        let list = vault.catalog.list_view().await.map_err(err)?;
        let mut media = HashMap::new();
        let mut ext = HashMap::new();
        let mut story = HashMap::new();
        let mut originals = HashMap::new();
        for m in list {
            if let Some(p) = m.meta.get("proxy").and_then(Value::as_str).filter(|_| m.meta.get("role").and_then(Value::as_str) != Some("proxy")) {
                originals.insert(p.to_string(), m.hash.clone());
            }
            ext.insert(m.hash.clone(), extension(&m));
            story.insert(m.hash.clone(), m.story.clone());
            media.insert(m.hash.clone(), Media { hash: m.hash, mime: m.mime, kind: m.kind, size: m.size, title: m.title, meta: m.meta });
        }
        Ok(Self { vault: vault.clone(), rt: tokio::runtime::Handle::current(), media, ext, story, originals, dir, files: Mutex::new(HashMap::new()) })
    }

    /// The story most of the timeline's files live in; None (the inbox) when most are in the inbox.
    fn story_of(&self, t: &Timeline) -> Option<String> {
        let mut hashes: Vec<&str> = t.clips.iter().filter(|c| !c.is_world()).filter_map(|c| c.hash.as_deref()).collect();
        hashes.sort_unstable();
        hashes.dedup();
        let mut count: HashMap<&str, usize> = HashMap::new();
        for h in hashes {
            if let Some(s) = self.story.get(h) {
                *count.entry(s.as_str()).or_default() += 1;
            }
        }
        count.into_iter().max_by_key(|(s, n)| (*n, *s)).map(|(s, _)| s.to_string()).filter(|s| !s.is_empty())
    }
}

/// A file's extension on disk: the one it came in with, else its type's.
fn extension(m: &vault_core::Meta) -> String {
    if m.meta.get("sequence").and_then(Value::as_str) == Some("exr") {
        return "tar".into();
    }
    if let Some(e) = Path::new(&m.original_name).extension().map(|e| e.to_string_lossy().to_lowercase()).filter(|e| !e.is_empty() && e.len() <= 5) {
        return e;
    }
    match m.mime.as_str() {
        "video/mp4" => "mp4",
        "video/quicktime" => "mov",
        "video/x-m4v" => "m4v",
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/heic" => "heic",
        "image/x-exr" => "exr",
        "image/tiff" => "tif",
        "audio/wav" => "wav",
        "audio/mpeg" => "mp3",
        "audio/mp4" => "m4a",
        "application/x-tar" => "tar",
        _ => "bin",
    }
    .into()
}

impl Library for Vaulted {
    fn media(&self, hash: &str) -> Option<Media> {
        self.media.get(hash).cloned()
    }

    fn file(&self, hash: &str) -> anyhow::Result<PathBuf> {
        if let Some(p) = self.files.lock().unwrap().get(hash) {
            return Ok(p.clone());
        }
        let m = self.media.get(hash).with_context(|| format!("{hash} is not in the vault's catalog"))?;
        let name = if m.title.is_empty() { hash.to_string() } else { m.title.clone() };
        let blob: iroh_blobs::Hash = hash.parse()?;
        std::fs::create_dir_all(&self.dir)?;
        let path = self.dir.join(format!("{hash}.{}", self.ext.get(hash).map(String::as_str).unwrap_or("bin")));
        let vault = self.vault.clone();
        let to = path.clone();
        self.rt.block_on(async move { vault.store.blobs().export(blob, &to).await }).with_context(|| format!("{name}: its bytes are not on this Mac (yet)"))?;
        self.files.lock().unwrap().insert(hash.to_string(), path.clone());
        Ok(path)
    }

    fn original_of(&self, hash: &str) -> String {
        let named = self.media.get(hash).and_then(|m| m.meta.get("proxy_of").and_then(Value::as_str).map(String::from));
        named.or_else(|| self.originals.get(hash).cloned()).unwrap_or_else(|| hash.to_string())
    }

    fn stills_of(&self, original: &str) -> Vec<Media> {
        self.media.values().filter(|m| m.meta.get("grade_still_of").and_then(Value::as_str) == Some(original)).cloned().collect()
    }
}

/// What each picture clip of a timeline is like (vault_render `measure`: luma percentiles and the middle tones'
/// colour in ACEScct, as shot and balanced) — the clips named, else every media clip on V1; `frames` per clip.
pub async fn measure_clips(vault: &Arc<Vault>, timeline: &Value, ids: Option<Vec<String>>, frames: usize) -> Res<Vec<Value>> {
    let t: Timeline = serde_json::from_value(timeline.clone()).map_err(err)?;
    let dir = vault.ingest_dir().join(format!("measure-{}", std::process::id()));
    let lib = Arc::new(Vaulted::new(vault, dir.clone()).await?);
    let clips: Vec<Clip> = t
        .clips
        .iter()
        .filter(|c| c.track == "V1" && c.hash.is_some() && !c.is_world())
        .filter(|c| ids.as_ref().is_none_or(|ids| ids.contains(&c.id)))
        .cloned()
        .collect();
    if clips.is_empty() {
        return Err("no picture clip with a file to measure".into());
    }
    let out = tauri::async_runtime::spawn_blocking(move || {
        clips
            .iter()
            .map(|c| {
                let name = lib.media(c.hash.as_deref().unwrap_or("")).map(|m| m.title).unwrap_or_default();
                match vault_render::measure(&t, &*lib, c, frames) {
                    Ok(mut v) => {
                        v["name"] = json!(name);
                        v
                    }
                    Err(e) => json!({ "clip": c.id, "name": name, "error": format!("{e:#}") }),
                }
            })
            .collect::<Vec<Value>>()
    })
    .await
    .map_err(err)?;
    std::fs::remove_dir_all(&dir).ok();
    Ok(out)
}

/// Every shot's balance to level them to each other (vault_render `grade::fit`): to the reference clip as it is
/// balanced now, to neutral (grey middle tones, the middle at 18 %), else to the shots' average. Returns the target
/// and each shot's proposed balance; writes nothing.
pub async fn propose_balances(vault: &Arc<Vault>, timeline: &Value, ids: Option<Vec<String>>, reference: Option<String>, neutral: bool) -> Res<Value> {
    use vault_render::grade::{MATCH_AT, PIVOT, fit};
    let shots = measure_clips(vault, timeline, ids, 5).await?;
    let ok: Vec<&Value> = shots.iter().filter(|s| s.get("error").is_none()).collect();
    if ok.is_empty() {
        return Err(format!("nothing could be measured: {}", json!(shots)));
    }
    let at = |s: &Value, p: &str| s.pointer(p).and_then(Value::as_f64).unwrap_or(0.0);
    let avg = |p: &str| ok.iter().map(|s| at(s, p)).sum::<f64>() / ok.len() as f64;
    let (target, against) = match &reference {
        Some(id) => {
            let r = ok.iter().find(|s| s["clip"].as_str() == Some(id)).ok_or("the reference clip was not measured")?;
            (r["balanced"].clone(), format!("clip {id}"))
        }
        None => {
            let luma: serde_json::Map<String, Value> = MATCH_AT.iter().map(|p| (p.to_string(), json!(avg(&format!("/balanced/luma/{p}"))))).collect();
            let mut target = json!({ "luma": luma, "to_grey": { "temp": avg("/balanced/to_grey/temp"), "tint": avg("/balanced/to_grey/tint") } });
            if neutral {
                let shift = PIVOT - target["luma"]["p50"].as_f64().unwrap_or(PIVOT);
                for p in MATCH_AT {
                    target["luma"][p] = json!(target["luma"][p].as_f64().unwrap_or(0.0) + shift);
                }
                target["to_grey"] = json!({ "temp": 0.0, "tint": 0.0 });
                (target, "neutral".to_string())
            } else {
                (target, "the shots' average".to_string())
            }
        }
    };
    let proposed: Vec<Value> = ok
        .iter()
        .map(|s| {
            let id = s["clip"].as_str().unwrap_or_default();
            if reference.as_deref() == Some(id) {
                return json!({ "clip": id, "name": s["name"], "balance": s["balance"], "note": "the reference: kept as it is" });
            }
            json!({ "clip": id, "name": s["name"], "balance": fit(&s["as_shot"], &target), "as_shot": { "luma": s["as_shot"]["luma"], "to_grey": s["as_shot"]["to_grey"] } })
        })
        .collect();
    let errors: Vec<&Value> = shots.iter().filter(|s| s.get("error").is_some()).collect();
    Ok(json!({ "target": against, "target_stats": target, "shots": proposed, "errors": errors }))
}

/// How each sound clip of a timeline sounds (vault_render `measure_sound`): loudness, true peak, a curve to draw, the
/// music under each voice clip.
pub async fn measure_sound(vault: &Arc<Vault>, timeline: &Value) -> Res<Value> {
    let t: Timeline = serde_json::from_value(timeline.clone()).map_err(err)?;
    let dir = vault.ingest_dir().join(format!("sound-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)));
    let lib = Arc::new(Vaulted::new(vault, dir.clone()).await?);
    let out = tauri::async_runtime::spawn_blocking(move || vault_render::measure_sound(&t, &*lib)).await.map_err(err)?.map_err(err);
    std::fs::remove_dir_all(&dir).ok();
    out
}

/// The loudness each kind of sound is levelled to, before the render levels the whole mix to −14 LUFS: the voice
/// clear on top, the music a bed under it (the render keys it down 6 dB more while the voice speaks), the sounds
/// and ambience under both.
pub const SOUND_TARGETS: [(&str, f64); 3] = [("A1", -18.0), ("A2", -26.0), ("A3", -30.0)];

/// Every sound clip levelled to its track's target (or `targets`), its gain within −∞…+12 dB (vol ≤ 4), and fades so
/// nothing clicks: a voice 0.05 s at least, the music 1 s in and 2.5 s out where the film starts or ends, a sound
/// 0.3 s. Returns each clip's change; writes nothing.
pub fn level_sound(measured: &Value, clips: &[Value], targets: &[(String, f64)], end: f64) -> Vec<Value> {
    let target = |track: &str| targets.iter().find(|(t, _)| t == track).map(|(_, v)| *v).or_else(|| SOUND_TARGETS.iter().find(|(t, _)| *t == track).map(|(_, v)| *v));
    let mut out = Vec::new();
    for m in measured["clips"].as_array().into_iter().flatten().filter(|m| m.get("error").is_none()) {
        let (Some(id), Some(track)) = (m["clip"].as_str(), m["track"].as_str()) else { continue };
        let Some(c) = clips.iter().find(|c| c["id"].as_str() == Some(id)) else { continue };
        let Some(goal) = target(track) else { continue };
        let mut change = json!({ "clip": id, "track": track, "name": m["name"] });
        if let Some(l) = m["lufs"].as_f64() {
            // the gain that brings it to its target, never more than +12 dB (vol 4); the mix is float, and the render's
            // master limiter holds the peaks
            let g = goal - l;
            let vol = (10f64.powf(g.min(12.0) / 20.0) * 1000.0).round() / 1000.0;
            change["vol"] = json!(vol.clamp(0.0, 4.0));
            change["lufs_before"] = json!(m["lufs_at_vol"]);
            change["lufs_after"] = json!(((l + 20.0 * vol.max(1e-6).log10()) * 100.0).round() / 100.0);
        } else {
            change["note"] = json!("silent: left as it is");
        }
        let start = c["start"].as_f64().unwrap_or(0.0);
        let dur = c["dur"].as_f64().unwrap_or(0.0);
        let (fin, fout) = (c["fin"].as_f64().unwrap_or(0.0), c["fout"].as_f64().unwrap_or(0.0));
        let (want_in, want_out) = match track {
            "A1" => (0.05, 0.05),
            "A2" => (if start < 0.5 { 1.0 } else { 0.3 }, if (start + dur - end).abs() < 0.5 { 2.5 } else { 0.5 }),
            _ => (0.3, 0.3),
        };
        change["fin"] = json!(fin.max(want_in).min(dur / 2.0));
        change["fout"] = json!(fout.max(want_out).min(dur / 2.0));
        out.push(change);
    }
    out
}

/// A video's sound, for the studio to play: read from the original itself (AVFoundation, 48 kHz stereo — the file the
/// render mixes from) and handed over as a 16-bit WAV. Sound never plays from a proxy.
#[tauri::command]
pub async fn vault_sound(app: tauri::State<'_, crate::App>, hash: String) -> Res<tauri::ipc::Response> {
    crate::gate()?;
    let h: iroh_blobs::Hash = hash.parse().map_err(err)?;
    let m = app.vault.catalog.meta(h).await.map_err(err)?.ok_or("no such file")?;
    let ext = std::path::Path::new(&m.original_name).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "mov".into());
    let path = app.vault.ingest_dir().join(format!("{hash}.sound.{ext}"));
    app.vault.store.blobs().export(h, &path).await.map_err(|e| format!("the original is not on this Mac: {e:#}"))?;
    let p = path.clone();
    let wav = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Vec<u8>> {
        let mut frames: Vec<f32> = Vec::new();
        if let Some(mut r) = vault_render::av::AudioReader::open(&p, 0.0, 36_000.0)? {
            while let Some((_, chunk)) = r.next_chunk()? {
                frames.extend(chunk);
            }
        }
        let rate = vault_render::av::RATE;
        let data = frames.len() * 2;
        let mut out = Vec::with_capacity(44 + data);
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&((36 + data) as u32).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM
        out.extend_from_slice(&2u16.to_le_bytes()); // stereo
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 4).to_le_bytes());
        out.extend_from_slice(&4u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&(data as u32).to_le_bytes());
        for s in frames {
            out.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0).round() as i16).to_le_bytes());
        }
        Ok(out)
    })
    .await
    .map_err(err)?
    .map_err(err);
    std::fs::remove_file(&path).ok();
    Ok(tauri::ipc::Response::new(wav?))
}

/// The Audio tab: how the timeline on screen sounds, clip by clip (to draw; it changes nothing).
#[tauri::command]
pub async fn sound_measure(app: tauri::State<'_, crate::App>, timeline: Value) -> Res<Value> {
    crate::gate()?;
    measure_sound(&app.vault, &timeline).await
}

// ── world plates ────────────────────────────────────────────────────────────────────────────────────────────────

/// A world clip's shot record's spec (the version the clip names).
async fn spec_of(auth: &Auth, c: &Clip) -> Res<(String, Value)> {
    let shot = c.shot.clone().ok_or_else(|| format!("world clip {} names no shot", c.id))?;
    let q = c.shot_version.map(|v| format!("?version={v}")).unwrap_or_default();
    let r = auth.get_ok("GET", &format!("/api/shots/{shot}{q}"), None).await.map_err(|e| format!("shot {shot}: {e}"))?;
    let spec = r.get("spec").filter(|s| s.is_object()).cloned().ok_or_else(|| format!("shot {shot} v{} has no spec", c.shot_version.unwrap_or(0)))?;
    Ok((shot, spec))
}

/// Every world clip's plate for every shape: `frames` of its stretch (clip.in … clip.in + dur, a frame over), at the
/// shape's render size and the film's rate.
async fn plates_for(handle: &AppHandle, vault: &Vault, auth: &Auth, t: &Timeline, shapes: &[Shape], progress: &Progress, span: (f64, f64)) -> Res<HashMap<(String, String), Plate>> {
    let clips: Vec<&Clip> = t.clips.iter().filter(|c| c.is_world() && c.track == "V1").collect();
    let mut out = HashMap::new();
    if clips.is_empty() {
        return Ok(out);
    }
    world::prune_plates(vault);
    let fps = FPS as f64;
    let frames_of = |c: &Clip| ((c.dur * fps).ceil() as u32 + 1).max(2);
    let total: f64 = clips.iter().map(|c| frames_of(c) as f64 * shapes.len() as f64).sum();
    let mut done = 0.0;
    progress.set(span.0, "rendering world plates");
    for c in clips {
        let (shot, spec) = spec_of(auth, c).await?;
        let version = c.shot_version.unwrap_or(0);
        for s in shapes {
            let (width, height) = s.render_size();
            let frames = frames_of(c);
            let ask = world::Frames { spec: spec.clone(), shape: s.aspect, width, height, fps, from: c.in_, frames, bitrate: Some(world::plate_bitrate(width, height, fps)) };
            let (p, base, of) = (progress.clone(), done, frames as f64);
            let told = move |x: f64| p.set(span.0 + (span.1 - span.0) * (base + x * of) / total, "rendering world plates");
            let label = format!("plate-{}-v{version}-{}", &shot[..8.min(shot.len())], s.tag());
            let made = world::plate(handle, vault, &label, &ask, told)
                .await
                .map_err(|e| format!("world clip {} (shot {shot} v{version}), its {} plate: {e}", c.id, s.aspect))?;
            tracing::info!("plate of shot {shot} v{version} {}–{} s · {} {width}×{height}: {}", c.in_, c.in_ + c.dur, s.aspect, if made.reused { "from the cache" } else { "rendered" });
            out.insert(
                (c.id.clone(), s.aspect.to_string()),
                Plate { file: made.file, offset: 0.0, key: Some(made.key), fingerprint: Some(made.fingerprint), reused: Some(made.reused) },
            );
            done += of;
        }
    }
    Ok(out)
}

// ── the jobs ────────────────────────────────────────────────────────────────────────────────────────────────────

async fn timeline_of(auth: &Auth, job: &Value) -> Res<Timeline> {
    let id = job["timeline_id"].as_str().ok_or("the job names no timeline")?;
    let raw = auth.get_ok("GET", &format!("/api/timelines/{id}"), None).await.map_err(|e| format!("the timeline: {e}"))?;
    serde_json::from_value(raw).map_err(|e| format!("the timeline: {e}"))
}

/// A timeline into every delivery, into the vault: the job's result.
async fn render_job(handle: &AppHandle, vault: &Arc<Vault>, auth: &Auth, job: &Value, work: &Work, progress: &Progress) -> Res<Value> {
    let id = job["id"].as_str().unwrap_or_default();
    let t = timeline_of(auth, job).await?;
    progress.named(&format!("Render · {}", t.name));
    progress.set(0.02, "fetching files");
    let lib = Arc::new(Vaulted::new(vault, work.0.join("files")).await?);
    let story = lib.story_of(&t);
    let shapes = shapes_of(&t);
    let plates = plates_for(handle, vault, auth, &t, &shapes, progress, (0.03, 0.3)).await?;
    let (from, span) = if plates.is_empty() { (0.03, 0.9) } else { (0.3, 0.63) };

    let (t2, lib2, out, p) = (t.clone(), lib.clone(), work.0.join("out"), progress.clone());
    let made = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<vault_render::Render> {
        let mut opts = Options::new(out);
        opts.target = Some(LOUDNESS);
        let plate = |c: &Clip, s: &Shape| -> anyhow::Result<Option<Plate>> { Ok(plates.get(&(c.id.clone(), s.aspect.to_string())).cloned()) };
        vault_render::render(&t2, &*lib2, &plate, odt(), &opts, &mut |x, what| p.set(from + span * x, what))
    })
    .await
    .map_err(err)?
    .map_err(err)?;

    // each file into the vault, described — tagged by what it is (the name it came in as is only a fact)
    progress.set(0.94, "into the vault");
    let mut made = made;
    for i in 0..made.deliveries.len() {
        let about = made.about(&t, &made.deliveries[i]);
        let file = made.deliveries[i].file.clone();
        let batch = Batch {
            session: format!("render {id}"),
            tags: about.tags,
            title: Some(about.title),
            description: Some(about.description),
            meta: about.meta,
            story: story.clone(),
            class: Some("delivery".into()),
            ..Default::default()
        };
        let o = vault.ingest_file(&file, &batch).await.map_err(err)?;
        if o.verdict == Verdict::Mismatch {
            return Err(format!("{}: the copy in the vault is not what was rendered (hash mismatch)", made.deliveries[i].name));
        }
        std::fs::remove_file(&file).ok();
        made.deliveries[i].hash = Some(o.hash);
        progress.set(0.94 + 0.05 * (i + 1) as f64 / made.deliveries.len() as f64, "into the vault");
    }
    for w in &made.warnings {
        tracing::warn!("render job {id}: {w}");
    }
    made.job_result(&t).map_err(err)
}

/// A hero frame into the vault: the job's result.
async fn frame_job(handle: &AppHandle, vault: &Arc<Vault>, auth: &Auth, job: &Value, work: &Work, progress: &Progress) -> Res<Value> {
    let at = job["params"]["t"].as_f64().filter(|t| *t >= 0.0).unwrap_or(0.0);
    let aspect = job["params"]["shape"].as_str().unwrap_or("16:9").to_string();
    let s = Shape::of(&aspect).ok_or_else(|| format!("no such shape: {aspect}"))?;
    let t = timeline_of(auth, job).await?;
    progress.named(&format!("Hero frame · {} · {at:.2} s", t.name));
    progress.set(0.05, "fetching files");
    let lib = Arc::new(Vaulted::new(vault, work.0.join("files")).await?);
    let story = lib.story_of(&t);
    // the clip on screen, as hero_frame picks it: a world clip gets a plate of that one frame
    let has_cards = |c: &Clip| lib.media(c.hash.as_deref().unwrap_or("")).is_some_and(|m| m.meta.get("cards").is_some_and(Value::is_object));
    let clip = t
        .clips
        .iter()
        .filter(|c| c.track == "V1" && (c.is_world() || (c.hash.as_deref().is_some_and(|h| lib.media(h).is_some()) && !has_cards(c))))
        .rfind(|c| c.start <= at && at < c.end());
    let mut plates = HashMap::new();
    if let Some(c) = clip.filter(|c| c.is_world()) {
        progress.set(0.1, "rendering world plates");
        let (shot, spec) = spec_of(auth, c).await?;
        let (width, height) = s.render_size();
        let fps = FPS as f64;
        let ask = world::Frames { spec, shape: s.aspect, width, height, fps, from: c.in_ + (at - c.start), frames: 1, bitrate: Some(world::plate_bitrate(width, height, fps)) };
        let label = format!("frame-{}-{}", &shot[..8.min(shot.len())], s.tag());
        let made = world::plate(handle, vault, &label, &ask, |_| {}).await.map_err(|e| format!("world clip {}: its frame: {e}", c.id))?;
        plates.insert((c.id.clone(), aspect.clone()), Plate { file: made.file, offset: at - c.start, key: Some(made.key), fingerprint: Some(made.fingerprint), reused: Some(made.reused) });
    }
    progress.set(0.5, "rendering the frame");
    let png = work.0.join(format!("frame-{at:.2}s-{}.png", s.tag()));
    let (t2, lib2, file, shape) = (t.clone(), lib.clone(), png.clone(), aspect.clone());
    let rep = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<Value> {
        let plate = |c: &Clip, s: &Shape| -> anyhow::Result<Option<Plate>> { Ok(plates.get(&(c.id.clone(), s.aspect.to_string())).cloned()) };
        vault_render::hero_frame(&t2, &*lib2, &plate, odt(), at, &shape, &file)
    })
    .await
    .map_err(err)?
    .map_err(err)?;
    progress.set(0.9, "into the vault");
    let (w, h) = s.render_size();
    let what = rep["what"].as_str().unwrap_or("").to_string();
    let batch = Batch {
        session: format!("hero frame {}", job["id"].as_str().unwrap_or_default()),
        tags: std::iter::once("role:frame".to_string()).chain(t.project.clone()).collect(),
        title: Some(format!("{} · hero frame {at:.2} s · {aspect}", t.name)),
        description: Some(format!("One frame at full precision ({w}×{h}, 16-bit) through the whole chain, without graphics — {what}")),
        meta: json!({ "timeline": t.id, "version": t.version.unwrap_or(1), "t": at, "shape": aspect, "width": w, "height": h, "clip": rep["clip"] }),
        story,
        ..Default::default()
    };
    let o = vault.ingest_file(&png, &batch).await.map_err(err)?;
    if o.verdict == Verdict::Mismatch {
        return Err("the hero frame's copy in the vault is not what was rendered (hash mismatch)".into());
    }
    Ok(json!({ "status": "done", "progress": 1, "note": format!("hero frame ready · {at:.2} s · {aspect}"), "output_hash": o.hash, "report": rep }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loudness_is_the_platforms() {
        assert_eq!((LOUDNESS.lufs, LOUDNESS.true_peak), (vault_render::PLATFORMS.lufs, vault_render::PLATFORMS.true_peak));
    }

    #[test]
    fn a_file_is_exported_with_its_own_extension() {
        let m = |name: &str, mime: &str, meta: Value| vault_core::Meta { original_name: name.into(), mime: mime.into(), meta, ..Default::default() };
        assert_eq!(extension(&m("A001.MOV", "video/quicktime", Value::Null)), "mov");
        assert_eq!(extension(&m("", "video/mp4", Value::Null)), "mp4");
        assert_eq!(extension(&m("shot_010", "application/x-tar", json!({ "sequence": "exr" }))), "tar");
        assert_eq!(extension(&m("take.wav", "audio/wav", Value::Null)), "wav");
        assert_eq!(extension(&m("", "application/octet-stream", Value::Null)), "bin");
    }
}
