//! The render worker is this app. The studio (or an agent, over MCP) queues a job on the API's render queue
//! (render_jobs: `POST /api/timelines/:id/renders`, `…/frames`); this Mac claims it with its own key, renders it
//! natively with `vault-render` — Core Image on Metal, VideoToolbox, AVFoundation, Core Text; no bun, no ffmpeg, no
//! Chrome — puts every file it makes into the vault, and hands the API the same report the old worker did
//! (`PUT /api/renders/:id`: progress while it works, then `Render::job_result`), so the studio's Render tab, its
//! deliveries and the calendar work as they did.
//!
//!   render  a timeline into every delivery (16:9 4K master + 1080 copy, 9:16, 1:1, 4:5), levelled to `LOUDNESS`;
//!           with `params.delivery` "youtube-4k", the 16:9 4K master for YouTube alone.
//!           World clips are rendered first as ACEScct plates at each shape's size, in the app's own unseen world
//!           (world.rs, cached by what they are made of); every delivery goes into the vault as class delivery, in the
//!           story most of the timeline's files are in (else the inbox), described by `Render::about`.
//!   frame   of a media clip (`params.clip`, or the one on screen at `params.t`): its file's graded still — the grading
//!           still through the clip's whole chain, 1920×1080, a JPEG — as the file's preview, replacing the one before.
//!           Of a world clip or a gap: a hero frame at `params.t` in `params.shape`, a 16-bit PNG, replacing the one
//!           before of that clip and shape.
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

use crate::{Res, auth::Auth, err, jobs, proxies, world};

/// The loudness every film is levelled to: −14 LUFS integrated, the true peak at most −1 dBTP — what YouTube,
/// Instagram and TikTok play at (and room for their AAC encoders). Change it here.
pub const LOUDNESS: Target = Target { lufs: -14.0, true_peak: -1.0 };

/// The one delivery the studio renders for now: the 16:9 4K master for YouTube (HEVC 10-bit, 80 Mb/s, AAC 384 kb/s).
pub const YOUTUBE_4K: &str = "youtube-4k";

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
        let turn = jobs::hidden_turn(jobs::Lane::Gpu, "render-queue").await;
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

/// A job's progress: on the API's job (throttled, always the latest) and in this Mac's jobs (jobs.rs).
#[derive(Clone)]
struct Progress {
    tx: Arc<tokio::sync::watch::Sender<(f64, String)>>,
    kind: jobs::Kind,
    id: String,
}

impl Progress {
    /// Start telling the API. The task ends once every copy of the `Progress` is dropped, after sending the last
    /// value — await it before the job's last word, so no progress lands after it.
    fn start(auth: &Auth, id: &str, kind: jobs::Kind, name: &str) -> (Self, tauri::async_runtime::JoinHandle<()>) {
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
        let p = Self { tx: Arc::new(tx), kind, id: id.to_string() };
        // the lane is the render queue's already (its poll holds the GPU): the job runs at once
        jobs::queue(kind, id, name);
        jobs::stage(kind, id, "starting", 0.0);
        (p, task)
    }

    /// How far (0…1) and what is happening — "rendering 9:16" is "rendering" on the job, as the studio reads it.
    fn set(&self, done: f64, what: &str) {
        let note = if what.starts_with("rendering") && what != "rendering world plates" && what != "rendering the frame" { "rendering" } else { what };
        self.tx.send_replace((done.clamp(0.0, 1.0), note.to_string()));
        jobs::stage(self.kind, &self.id, what, done);
    }

    fn named(&self, name: &str) {
        jobs::name(self.kind, &self.id, name);
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
            let label = if kind == "frame" { "Frame" } else { "Render" };
            let jk = if kind == "frame" { jobs::Kind::Frame } else { jobs::Kind::Render };
            let (progress, told) = Progress::start(auth, &id, jk, label);
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
            jobs::end(jk, &id, result.as_ref().map(|_| ()).map_err(|e| e.clone()));
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
    /// each file as it is read: in place, from the vault's blob store (never copied out)
    files: Mutex<HashMap<String, vault_media::Source>>,
}

impl Vaulted {
    async fn new(vault: &Arc<Vault>) -> Res<Self> {
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
        Ok(Self { vault: vault.clone(), rt: tokio::runtime::Handle::current(), media, ext, story, originals, files: Mutex::new(HashMap::new()) })
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

    fn file(&self, hash: &str) -> anyhow::Result<vault_media::Source> {
        if let Some(s) = self.files.lock().unwrap().get(hash) {
            return Ok(s.clone());
        }
        let m = self.media.get(hash).with_context(|| format!("{hash} is not in the vault's catalog"))?;
        let name = if m.title.is_empty() { hash.to_string() } else { m.title.clone() };
        let blob: iroh_blobs::Hash = hash.parse()?;
        let ext = self.ext.get(hash).map(String::as_str).unwrap_or("bin");
        let src = crate::blob::source_blocking(&self.vault, &self.rt, blob, &format!("{name}.{ext}"))?;
        self.files.lock().unwrap().insert(hash.to_string(), src.clone());
        Ok(src)
    }

    fn original_of(&self, hash: &str) -> String {
        let named = self.media.get(hash).and_then(|m| m.meta.get("proxy_of").and_then(Value::as_str).map(String::from));
        named.or_else(|| self.originals.get(hash).cloned()).unwrap_or_else(|| hash.to_string())
    }

    fn stills_of(&self, original: &str) -> Vec<Media> {
        self.media.values().filter(|m| m.meta.get("grade_still_of").and_then(Value::as_str) == Some(original)).cloned().collect()
    }
}

/// What a V1 clip is called on the sheet: its script's label or description, else its file's title.
fn clip_label(timeline: &Value, id: &str) -> String {
    let c = timeline["clips"].as_array().and_then(|cs| cs.iter().find(|c| c["id"].as_str() == Some(id)));
    let s = |k: &str| c.and_then(|c| c["script"][k].as_str()).filter(|s| !s.is_empty()).map(String::from);
    let what = s("label").or_else(|| s("description")).unwrap_or_default();
    let scene = s("scene").unwrap_or_default();
    [scene, what].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>().join(" · ")
}

/// The scope sheet of the clips named (the first is the reference), after their balances: each shot's picture with its
/// skin box, its waveform, RGB parade and vectorscope with the skin line — the PNG's bytes (shown, never kept beside the
/// vault) and what each row is.
pub async fn scope_sheet(vault: &Arc<Vault>, timeline: &Value, ids: Vec<String>, regions: HashMap<String, vault_render::look::Regions>, with_looks: bool) -> Res<(Value, Vec<u8>)> {
    let looks = look_clips(vault, timeline, Some(ids), regions, HashMap::new(), with_looks).await?;
    let mut rows = Vec::new();
    let mut ok = Vec::new();
    for (i, l) in looks.into_iter().enumerate() {
        match l {
            Ok(l) => {
                let b = &l.json["balanced"];
                let n = |p: &str| b.pointer(p).and_then(Value::as_f64).map(|v| format!("{v}")).unwrap_or_else(|| "–".into());
                let skin = if b["skin"].is_null() { "no face".to_string() } else { format!("skin {} IRE {}° ({:+}°) sat {}", n("/skin/ire"), n("/skin/hue"), b["skin"]["off_skin_line"].as_f64().unwrap_or(0.0), n("/skin/chroma")) };
                let text = format!(
                    "{}{} · {} — blacks {} · mid {} · whites {} IRE · {} · clipped {}%",
                    if i == 0 { "REFERENCE · " } else { "" },
                    clip_label(timeline, &l.clip),
                    &l.clip[..l.clip.len().min(8)],
                    n("/levels/p1"),
                    n("/levels/p50"),
                    n("/levels/p99"),
                    skin,
                    n("/clipped_pct"),
                );
                rows.push(json!({ "clip": l.clip, "label": text, "balance": l.json["balance"], "from": l.json["from"] }));
                ok.push((l, text));
            }
            Err(e) => rows.push(e),
        }
    }
    if ok.is_empty() {
        return Err(format!("no shot could be read: {}", json!(rows)));
    }
    let png = tauri::async_runtime::spawn_blocking(move || {
        let refs: Vec<(&vault_render::look::Look, String)> = ok.iter().map(|(l, t)| (l, t.clone())).collect();
        let (px, w, h) = vault_render::look::scopes(&refs).map_err(err)?;
        let mut out = Vec::new();
        let mut enc = png::Encoder::new(&mut out, w, h);
        enc.set_color(png::ColorType::Rgb);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header().and_then(|mut wr| wr.write_image_data(&px)).map_err(err)?;
        Ok::<_, String>(out)
    })
    .await
    .map_err(err)??;
    Ok((json!({ "rows": rows }), png))
}

/// The V1 picture clips named (in that order), else every one with a file, as the render reads them.
fn picture_clips(t: &Timeline, ids: &Option<Vec<String>>) -> Res<Vec<Clip>> {
    let v1: Vec<&Clip> = t.clips.iter().filter(|c| c.track == "V1" && c.hash.is_some() && !c.is_world()).collect();
    let clips: Vec<Clip> = match ids {
        Some(ids) => ids.iter().map(|id| v1.iter().find(|c| &c.id == id).map(|c| (*c).clone()).ok_or(format!("no picture clip {id} with a file on this timeline"))).collect::<Res<_>>()?,
        None => v1.into_iter().cloned().collect(),
    };
    if clips.is_empty() {
        return Err("no picture clip with a file to read".into());
    }
    Ok(clips)
}

/// Every clip named read for the base correction (vault_render `look`): its elements — blacks, whites, the middle, the
/// skin Vision finds (or the regions named) — as shot and balanced, from its 4K grading still (else its original's
/// frame; never a proxy), through the ACES 2.0 output. `balances` stand in for clips' own (a proposal read before it
/// is written). A clip that can't be read comes back as its error.
pub async fn look_clips(
    vault: &Arc<Vault>,
    timeline: &Value,
    ids: Option<Vec<String>>,
    regions: HashMap<String, vault_render::look::Regions>,
    balances: HashMap<String, vault_render::grade::Balance>,
    looks: bool,
) -> Res<Vec<Result<vault_render::look::Look, Value>>> {
    let t: Timeline = serde_json::from_value(timeline.clone()).map_err(err)?;
    let clips = picture_clips(&t, &ids)?;
    let lib = Arc::new(Vaulted::new(vault).await?);
    let out = tauri::async_runtime::spawn_blocking(move || {
        clips
            .iter()
            .map(|c| {
                let r = regions.get(&c.id).cloned().unwrap_or_default();
                objc2::rc::autoreleasepool(|_| vault_render::look::look(&t, &*lib, c, odt(), &r, balances.get(&c.id), looks))
                    .map_err(|e| json!({ "clip": c.id, "error": format!("{e:#}") }))
            })
            .collect::<Vec<_>>()
    })
    .await
    .map_err(err)?;
    Ok(out)
}

/// The base correction's balances (story-producer `grading.md`), proposed from the shots' elements — written by the
/// caller only when asked. `neutral`: each clip's own neutrals to grey, then `warmth` stops warmer (a scene master);
/// else every clip levelled to `reference` as it is balanced now (the scene master), by the blacks, whites, middle and
/// skin both have (less each clip's `skip`).
#[allow(clippy::too_many_arguments)]
pub async fn propose_balances(
    vault: &Arc<Vault>,
    timeline: &Value,
    ids: Option<Vec<String>>,
    reference: Option<String>,
    neutral: bool,
    warmth: f64,
    regions: HashMap<String, vault_render::look::Regions>,
    skip: HashMap<String, Vec<String>>,
) -> Res<Value> {
    use vault_render::look::{fit, neutral as to_neutral, predict, target};
    let out = odt();
    let r = |b: &vault_render::grade::Balance| serde_json::to_value(b).unwrap_or_default();
    if neutral {
        let looks = look_clips(vault, timeline, ids, regions, HashMap::new(), false).await?;
        let shots: Vec<Value> = looks
            .into_iter()
            .map(|l| match l {
                Ok(l) => {
                    let now: vault_render::grade::Balance = serde_json::from_value(l.json["balance"].clone()).unwrap_or_default();
                    let (b, used) = to_neutral(&l, out, &now, warmth);
                    json!({ "clip": l.clip, "balance": r(&b), "neutral_by": used, "warmth": warmth, "as_shot": l.json["as_shot"], "now": l.json["balanced"], "predicted": predict(&l, out, &b) })
                }
                Err(e) => e,
            })
            .collect();
        return Ok(json!({ "target": format!("neutral, then {warmth:+} stops warmer"), "shots": shots }));
    }
    let reference = reference.ok_or("name the scene's master as the reference: shots are matched to it, never to an average")?;
    let mut ids = ids.unwrap_or_else(|| {
        timeline["clips"].as_array().into_iter().flatten().filter(|c| c["track"] == "V1" && c["hash"].is_string() && c["kind"] != "world").filter_map(|c| c["id"].as_str().map(String::from)).collect()
    });
    ids.retain(|id| id != &reference);
    ids.insert(0, reference.clone());
    let mut looks = look_clips(vault, timeline, Some(ids), regions, HashMap::new(), false).await?.into_iter();
    let master = looks.next().ok_or("the reference wasn't read")?.map_err(|e| format!("the reference can't be read: {e}"))?;
    let master_balance: vault_render::grade::Balance = serde_json::from_value(master.json["balance"].clone()).unwrap_or_default();
    let want = target(&master, out, &master_balance);
    let shots: Vec<Value> = looks
        .map(|l| match l {
            Ok(l) => {
                let (b, used) = fit(&l, &want, out, skip.get(&l.clip).map(Vec::as_slice).unwrap_or(&[]));
                json!({ "clip": l.clip, "balance": r(&b), "matched_by": used, "as_shot": l.json["as_shot"], "predicted": predict(&l, out, &b) })
            }
            Err(e) => e,
        })
        .collect();
    Ok(json!({ "target": format!("clip {reference} as it is balanced now"), "reference": { "clip": reference, "balance": r(&master_balance), "elements": predict(&master, out, &master_balance) }, "shots": shots }))
}

/// How each sound clip of a timeline sounds (vault_render `measure_sound`): loudness, true peak, a curve to draw, the
/// music under each voice clip.
pub async fn measure_sound(vault: &Arc<Vault>, timeline: &Value) -> Res<Value> {
    let t: Timeline = serde_json::from_value(timeline.clone()).map_err(err)?;
    let lib = Arc::new(Vaulted::new(vault).await?);
    let out = tauri::async_runtime::spawn_blocking(move || vault_render::measure_sound(&t, &*lib)).await.map_err(err)?.map_err(err);
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

/// A sound clip's EQ as the mix makes it (vault-render `eq`, the same biquads), for the inspector to draw: its gain in
/// dB at `n` frequencies from 20 Hz to 20 kHz, spaced evenly on the octaves; and the bands as the mix takes them.
#[tauri::command]
pub fn eq_response(eq: Value, n: Option<usize>) -> Res<Value> {
    crate::gate()?;
    let bands = vault_render::eq::clean_eq(&eq);
    let rate = vault_render::av::RATE as f64;
    let e = vault_render::eq::Eq::new(&bands, rate);
    let n = n.unwrap_or(160).clamp(16, 1024);
    let curve: Vec<[f64; 2]> = (0..n)
        .map(|i| {
            let f = 20.0 * 1000f64.powf(i as f64 / (n - 1) as f64);
            [(f * 10.0).round() / 10.0, (e.response(f, rate) * 100.0).round() / 100.0]
        })
        .collect();
    Ok(json!({ "bands": bands, "curve": curve }))
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
    let lib = Arc::new(Vaulted::new(vault).await?);
    let story = lib.story_of(&t);
    // `params.delivery` "youtube-4k": the 16:9 4K master alone, at YouTube's best; none: every delivery
    let youtube = job["params"]["delivery"].as_str() == Some(YOUTUBE_4K);
    let shapes: Vec<Shape> = shapes_of(&t).into_iter().filter(|s| !youtube || s.aspect == "16:9").collect();
    let plates = plates_for(handle, vault, auth, &t, &shapes, progress, (0.03, 0.3)).await?;
    let (from, span) = if plates.is_empty() { (0.03, 0.9) } else { (0.3, 0.63) };

    let (t2, lib2, out, p) = (t.clone(), lib.clone(), work.0.join("out"), progress.clone());
    let made = tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<vault_render::Render> {
        let mut opts = Options::new(out);
        opts.target = Some(LOUDNESS);
        if youtube {
            opts.shapes = Some(vec!["16:9".into()]);
            opts.master_only = true;
        }
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

/// How wide a file's graded still is (16:9, so 1920×1080).
const GRADED_WIDTH: u32 = 1920;

/// A `frame` job into the vault: the job's result. Of a media clip — named (`params.clip`, queued when a timeline
/// save changed how its file looks) or on screen at `params.t` (an agent's ask) — it is that file's graded still,
/// replacing the one before; of a world clip or a gap, a hero frame at `params.t` in `params.shape`, replacing the
/// one before of the same clip and shape. Never a history of either.
async fn frame_job(handle: &AppHandle, vault: &Arc<Vault>, auth: &Auth, job: &Value, work: &Work, progress: &Progress) -> Res<Value> {
    let at = job["params"]["t"].as_f64().filter(|t| *t >= 0.0).unwrap_or(0.0);
    let aspect = job["params"]["shape"].as_str().unwrap_or("16:9").to_string();
    let s = Shape::of(&aspect).ok_or_else(|| format!("no such shape: {aspect}"))?;
    let t = timeline_of(auth, job).await?;
    progress.named(&format!("Frame · {} · {at:.2} s", t.name));
    progress.set(0.05, "fetching files");
    let lib = Arc::new(Vaulted::new(vault).await?);
    let story = lib.story_of(&t);
    // the clip on screen, as hero_frame picks it: a world clip gets a plate of that one frame
    let has_cards = |c: &Clip| lib.media(c.hash.as_deref().unwrap_or("")).is_some_and(|m| m.meta.get("cards").is_some_and(Value::is_object));
    let named = job["params"]["clip"].as_str().map(|id| t.clips.iter().find(|c| c.id == id).ok_or_else(|| format!("no clip {id} on the timeline any more")));
    let clip = match named {
        Some(c) => Some(c?),
        None => t
            .clips
            .iter()
            .filter(|c| c.track == "V1" && (c.is_world() || (c.hash.as_deref().is_some_and(|h| lib.media(h).is_some()) && !has_cards(c))))
            .rfind(|c| c.start <= at && at < c.end()),
    };
    if let Some(c) = clip.filter(|c| !c.is_world()) {
        return graded_still_job(vault, &t, lib.clone(), c.id.clone(), work, progress).await;
    }
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
        meta: json!({ "role": "frame", "timeline": t.id, "version": t.version.unwrap_or(1), "t": at, "shape": aspect, "width": w, "height": h, "clip": rep["clip"] }),
        story,
        ..Default::default()
    };
    let o = vault.ingest_file(&png, &batch).await.map_err(err)?;
    if o.verdict == Verdict::Mismatch {
        return Err("the hero frame's copy in the vault is not what was rendered (hash mismatch)".into());
    }
    // one hero frame per clip and shape: the one it replaces goes
    let same = |m: &vault_core::Meta| {
        is_frame(m) && m.meta["timeline"] == json!(t.id) && m.meta["clip"] == rep["clip"] && m.meta["shape"] == json!(aspect)
    };
    for m in vault.catalog.list().await.map_err(err)?.iter().filter(|m| same(m) && m.hash != o.hash) {
        if let Ok(h) = m.hash.parse::<iroh_blobs::Hash>() {
            vault.catalog.delete_file(h, "replaced by the clip's new hero frame").await.ok();
        }
    }
    Ok(json!({ "status": "done", "progress": 1, "note": format!("hero frame ready · {at:.2} s · {aspect}"), "output_hash": o.hash, "report": rep }))
}

/// A hero frame (`role:frame`): a frame of a timeline the render worker made.
pub fn is_frame(m: &vault_core::Meta) -> bool {
    m.meta.get("role").and_then(Value::as_str) == Some("frame") || m.tags.iter().any(|t| t == "role:frame")
}

/// The stills nothing uses — a file keeps two (its grading still and its graded still), never a history: every hero
/// frame of a media clip (its file's graded still stands for it now) and all but the newest of a world clip's per
/// shape, every proxy of a hero frame (a picture already through the output transform has nothing to grade), every
/// proxy whose file is gone, and every grading still or preview its file no longer names. Each with why, newest first.
pub fn stale_stills(all: &[vault_core::Meta]) -> Vec<(&vault_core::Meta, &'static str)> {
    let by: HashMap<&str, &vault_core::Meta> = all.iter().map(|m| (m.hash.as_str(), m)).collect();
    let s = |m: &vault_core::Meta, k: &str| m.meta.get(k).and_then(Value::as_str).map(String::from);
    let world = |m: &vault_core::Meta| m.description.contains("world shot");
    let mut frames: Vec<&vault_core::Meta> = all.iter().filter(|m| is_frame(m)).collect();
    frames.sort_by(|a, b| b.added.cmp(&a.added));
    let mut kept = std::collections::HashSet::new();
    let mut out = Vec::new();
    for m in &frames {
        let key = (s(m, "timeline"), m.meta.get("clip").map(Value::to_string), s(m, "shape"));
        if !world(m) {
            out.push((*m, "a hero frame of a media clip: its file's graded still stands for it"));
        } else if !kept.insert(key) {
            out.push((*m, "an older hero frame of the same world clip and shape"));
        }
    }
    for m in all {
        let named_by = |of: &str, k: &str| by.get(of).and_then(|o| s(o, k)).as_deref() == Some(m.hash.as_str());
        if let Some(of) = s(m, "proxy_of") {
            match by.get(of.as_str()) {
                Some(o) if is_frame(o) => out.push((m, "a proxy of a hero frame")),
                None => out.push((m, "a proxy of a file no longer in the vault")),
                _ => {}
            }
        } else if let Some(of) = s(m, "grade_still_of").filter(|of| !named_by(of, "grade_still")) {
            out.push((m, if by.contains_key(of.as_str()) { "a grading still its file no longer names" } else { "a grading still of a file no longer in the vault" }));
        } else if let Some(of) = s(m, "preview_of").filter(|of| !named_by(of, "preview")) {
            out.push((m, if by.contains_key(of.as_str()) { "a preview its file no longer names" } else { "a preview of a file no longer in the vault" }));
        }
    }
    out
}

/// A file's graded still into the vault, as its preview (`meta.preview`): the one it replaces goes.
async fn graded_still_job(vault: &Arc<Vault>, t: &Timeline, lib: Arc<Vaulted>, clip: String, work: &Work, progress: &Progress) -> Res<Value> {
    progress.set(0.3, "rendering the graded still");
    let jpg = work.0.join(format!("graded-{clip}.jpg"));
    let (t2, file, c2) = (t.clone(), jpg.clone(), clip.clone());
    let rep = tauri::async_runtime::spawn_blocking(move || vault_render::graded_still(&t2, &*lib, odt(), &c2, GRADED_WIDTH, &file))
        .await
        .map_err(err)?
        .map_err(err)?;
    progress.set(0.9, "into the vault");
    let of = rep["of"].as_str().unwrap_or_default().to_string();
    let hash: iroh_blobs::Hash = of.parse().map_err(err)?;
    let original = vault.catalog.meta(hash).await.map_err(err)?.ok_or("the clip's file is not in the vault's catalog")?;
    let stem = Path::new(&original.original_name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| of[..12].to_string());
    let batch = Batch {
        session: format!("graded still of {of}"),
        tags: vec!["preview".into()],
        title: Some(format!("{stem} · graded still")),
        meta: json!({ "role": "preview", "preview_of": of, "t": rep["t"], "width": rep["width"], "height": rep["height"], "shape": "16:9",
            "graded": { "timeline": t.id, "version": t.version.unwrap_or(1), "clip": clip } }),
        story: Some(original.story.clone()).filter(|s| !s.is_empty()),
        class: Some("proxy".into()),
        ..Default::default()
    };
    let o = vault.ingest_file(&jpg, &batch).await.map_err(err)?;
    if o.verdict == Verdict::Mismatch {
        return Err("the graded still's copy in the vault is not what was rendered (hash mismatch)".into());
    }
    vault.catalog.describe(hash, &json!({ "meta": { "preview": o.hash } })).await.map_err(err)?;
    // one preview per file: the one it replaces goes
    for m in vault.catalog.list().await.map_err(err)? {
        if m.meta.get("preview_of").and_then(Value::as_str) == Some(&of)
            && m.hash != o.hash
            && let Ok(h) = m.hash.parse::<iroh_blobs::Hash>()
        {
            vault.catalog.delete_file(h, "replaced by the file's new graded still").await.ok();
        }
    }
    Ok(json!({ "status": "done", "progress": 1, "note": format!("graded still ready · {stem}"), "output_hash": o.hash, "report": rep }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_loudness_is_the_platforms() {
        assert_eq!((LOUDNESS.lufs, LOUDNESS.true_peak), (vault_render::PLATFORMS.lufs, vault_render::PLATFORMS.true_peak));
    }

    #[test]
    fn a_file_keeps_two_stills_never_a_history() {
        let m = |hash: &str, added: &str, description: &str, meta: Value| vault_core::Meta { hash: hash.into(), added: added.into(), description: description.into(), meta, ..Default::default() };
        let frame = |hash: &str, added: &str, clip: &str, world: bool| {
            m(hash, added, if world { "… — world shot s1 v2 at 1.000 s" } else { "… — A001 at 3.000 s" }, json!({ "role": "frame", "timeline": "t1", "clip": clip, "shape": "16:9" }))
        };
        let all = vec![
            m("orig", "1", "", json!({ "grade_still": "still", "preview": "graded" })),
            m("still", "2", "", json!({ "role": "grade-still", "grade_still_of": "orig" })),
            m("graded", "3", "", json!({ "role": "preview", "preview_of": "orig" })),
            m("old-still", "1", "", json!({ "role": "grade-still", "grade_still_of": "orig" })),
            m("old-preview", "1", "", json!({ "role": "preview", "preview_of": "orig" })),
            m("proxy", "1", "", json!({ "proxy_of": "orig" })),
            frame("f-media", "4", "c1", false),
            m("f-media-proxy", "5", "", json!({ "proxy_of": "f-media" })),
            frame("w-old", "4", "w1", true),
            frame("w-new", "6", "w1", true),
            m("lost-proxy", "1", "", json!({ "proxy_of": "gone" })),
        ];
        let mut stale: Vec<&str> = stale_stills(&all).iter().map(|(m, _)| m.hash.as_str()).collect();
        stale.sort();
        assert_eq!(stale, ["f-media", "f-media-proxy", "lost-proxy", "old-preview", "old-still", "w-old"]);
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
