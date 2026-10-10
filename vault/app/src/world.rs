//! World shots' HD proxies, made here — no browser, no render worker. A world clip on a timeline is a shot of Sandbox 4
//! kept as data; while the live world loads (or is not open at all) the studio plays the shot's proxy instead: the
//! vault file whose meta names the shot and the version (`meta.shot`, `meta.shotVersion`, a video), in ACEScct.
//!
//! How one is made: the app opens the studio's own world page (`/games/sandbox-4/?film`, the same build and origin as
//! the studio) in a window of its own that nobody sees — on screen but fully transparent, under everything, not
//! clickable, with WebKit's occlusion detection off, so the page keeps its GPU, its timers and its frames as if it
//! were in front. `world_driver.js`, loaded before the page, asks for a shot (`world_proxy_next`), renders every frame
//! through film mode's own `__film.capture` (the plate's frames: shutter blur, oversampled, metered, ACEScct as 10-bit
//! codes) and hands each to the app as raw bytes (`world_proxy_frame`); the app waits for the encoder to take a frame
//! before it answers, so one frame is in flight at a time. The encoder is vault-media's `FrameWriter` (HEVC Main10 in
//! hardware, the same file a movie's proxy is), on a thread of its own. The file goes into the vault as the shot's
//! proxy: class proxy, in the story most of the timeline's files are in (else the inbox).
//!
//! What is made: the version of every world clip on every timeline that has no proxy yet — looked for a minute after
//! start and every minute after. It takes its turn with the files' proxies (the GPU lane, jobs.rs), after an ingest, and
//! only while macOS says memory is normal; while it renders, the uploads wait (`hold: proxy`). The window is closed
//! when nothing is left to render (and nobody keeps it open: `keep`).
//!
//! Plates, for the final render (render.rs): the same frames of a stretch of a shot (`Frames`: from, frames, fps),
//! framed for a delivery shape at its render size (4K for 16:9), at a finer bit rate — a vault file like any other
//! (meta `{ role: "plate", plate_key }`, the hash of everything it is made of; class proxy), synced by iroh to every
//! store its story's rules name and read in place by hash. `shoot` renders any `Frames`; the caller holds the turn.

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    ffi::c_void,
    path::Path,
    sync::{
        LazyLock, Mutex,
        mpsc::{Receiver, RecvTimeoutError, SyncSender},
    },
    time::Duration,
};

use serde::Serialize;
use serde_json::{Value, json};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use vault_core::{Vault, ingest::Batch};
use vault_media::{FrameWriter, Proxy, proxy::WORKING};

use crate::{
    Res,
    auth::Auth,
    err,
    jobs::{self, Kind},
    proxies,
};

/// The unseen window the world renders in.
pub const LABEL: &str = "world-proxy";
const DRIVER: &str = include_str!("world_driver.js");
/// The first frame waits for the world to be built round the shot (film mode gives up itself after 20 minutes).
const FIRST_FRAME: Duration = Duration::from_secs(25 * 60);
const NEXT_FRAME: Duration = Duration::from_secs(5 * 60);
/// Rendered bigger and filtered down, as the plates are.
const OVERSAMPLE: f64 = 1.5;

/// A shot for the page to render: `frames` frames from `from` seconds into the shot.
#[derive(Serialize, Clone)]
pub struct Job {
    id: String,
    spec: Value,
    shape: &'static str,
    width: u32,
    height: u32,
    fps: f64,
    from: f64,
    frames: u32,
    oversample: f64,
}

enum Msg {
    Frame(u32, Vec<u8>),
    End(Result<Value, String>),
}

/// The job the page may take next.
static SLOT: Mutex<Option<Job>> = Mutex::new(None);
static POSTED: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);
/// The job being rendered, and the way to its encoder.
static FEED: Mutex<Option<(String, SyncSender<Msg>)>> = Mutex::new(None);

fn only_world(webview: &tauri::Webview) -> Res<()> {
    if webview.label() == LABEL { Ok(()) } else { Err("only the world renderer".into()) }
}

fn feed(job: &str) -> Res<SyncSender<Msg>> {
    FEED.lock().unwrap().as_ref().filter(|(id, _)| id == job).map(|(_, tx)| tx.clone()).ok_or_else(|| "that proxy was given up".into())
}

/// Into the encoder — waiting while it is busy: the page renders the next frame only once this one is taken.
async fn send(tx: SyncSender<Msg>, msg: Msg) -> Res<()> {
    tauri::async_runtime::spawn_blocking(move || tx.send(msg)).await.map_err(err)?.map_err(|_| "that proxy was given up".into())
}

/// The page asks for a shot; it waits up to 20 s for one (none: `null`, and it asks again).
#[tauri::command]
pub async fn world_proxy_next(webview: tauri::Webview) -> Res<Option<Job>> {
    only_world(&webview)?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(job) = SLOT.lock().unwrap().take() {
            return Ok(Some(job));
        }
        if tokio::time::timeout_at(deadline, POSTED.notified()).await.is_err() {
            return Ok(None);
        }
    }
}

/// One frame of the shot being rendered: the raw bytes (x2bgr10le), headers `x-job` and `x-frame`.
#[tauri::command]
pub async fn world_proxy_frame(webview: tauri::Webview, request: tauri::ipc::Request<'_>) -> Res<()> {
    only_world(&webview)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("a frame comes as raw bytes".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(String::from);
    let job = header("x-job").ok_or("which proxy?")?;
    let n: u32 = header("x-frame").and_then(|v| v.parse().ok()).ok_or("which frame?")?;
    let tx = feed(&job)?;
    send(tx, Msg::Frame(n, bytes.clone())).await
}

/// The shot is through (`info`: its exposure, the build it rendered on) — or it failed (`error`).
#[tauri::command]
pub async fn world_proxy_end(webview: tauri::Webview, job: String, info: Option<Value>, error: Option<String>) -> Res<()> {
    only_world(&webview)?;
    let tx = feed(&job)?;
    send(tx, Msg::End(error.map_or_else(|| Ok(info.unwrap_or(Value::Null)), Err))).await
}

/// A shot version some timeline plays that has no proxy yet.
struct Want {
    shot: String,
    version: u64,
    name: String,
    project: Option<String>,
    spec: Value,
    story: Option<String>,
}

impl Want {
    /// its line in the studio's proxy list (`proxies_now`)
    /// its job's subject (jobs.rs): the shot and its version
    fn of(&self) -> String {
        format!("{}:v{}", self.shot, self.version)
    }
    fn label(&self) -> String {
        format!("{} · v{} · world", self.name, self.version)
    }
}

fn version_of(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

/// Every world clip's shot version without its proxy, with the story its timeline's files are in.
async fn wanted(auth: &Auth, vault: &Vault) -> Res<Vec<Want>> {
    let timelines = auth.get_ok("GET", "/api/timelines", None).await?;
    let files = vault.catalog.list().await.map_err(err)?;
    let have: HashSet<(String, u64)> = files
        .iter()
        .filter(|m| m.kind == "video")
        .filter_map(|m| Some((m.meta.get("shot")?.as_str()?.to_lowercase(), version_of(m.meta.get("shotVersion")?)?)))
        .collect();
    let story_of: HashMap<&str, &str> = files.iter().filter(|m| !m.story.is_empty()).map(|m| (m.hash.as_str(), m.story.as_str())).collect();
    let mut want: BTreeMap<(String, u64), Option<String>> = BTreeMap::new();
    for t in timelines.as_array().into_iter().flatten() {
        let clips = t["clips"].as_array().map(Vec::as_slice).unwrap_or_default();
        // the timeline's story: the one most of its files are in
        let mut count: HashMap<&str, usize> = HashMap::new();
        for s in clips.iter().filter_map(|c| story_of.get(c["hash"].as_str()?)) {
            *count.entry(s).or_default() += 1;
        }
        let story = count.into_iter().max_by_key(|(s, n)| (*n, *s)).map(|(s, _)| s.to_string());
        for c in clips.iter().filter(|c| c["kind"] == "world") {
            let (Some(shot), Some(version)) = (c["shot"].as_str(), version_of(&c["shotVersion"])) else { continue };
            let key = (shot.to_lowercase(), version);
            if have.contains(&key) {
                continue;
            }
            let slot = want.entry(key).or_default();
            if slot.is_none() {
                *slot = story.clone();
            }
        }
    }
    let mut out = Vec::new();
    for ((shot, version), story) in want {
        match auth.get_ok("GET", &format!("/api/shots/{shot}?version={version}"), None).await {
            Ok(r) if r["spec"].is_object() => out.push(Want {
                name: r["name"].as_str().unwrap_or("a world shot").to_string(),
                project: r["project"].as_str().map(String::from),
                spec: r["spec"].clone(),
                shot,
                version,
                story,
            }),
            Ok(_) => tracing::warn!("world proxy: shot {shot} v{version} has no spec"),
            Err(e) => tracing::warn!("world proxy: shot {shot} v{version}: {e}"),
        }
    }
    Ok(out)
}

static WAKE: tokio::sync::Notify = tokio::sync::Notify::const_new();
static RETRY: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// A look now, the failed ones' tries forgotten (one made again by hand).
pub fn wake() {
    RETRY.store(true, std::sync::atomic::Ordering::Relaxed);
    WAKE.notify_one();
}

/// Look for world shots without their proxy a minute after start, and every minute after; render them one by one.
pub async fn sweep(handle: AppHandle, vault: std::sync::Arc<Vault>) {
    // a shot version that failed this often waits for the app's next start (or a retry by hand)
    let mut failed: HashMap<(String, u64), u64> = HashMap::new();
    loop {
        let _ = tokio::time::timeout(Duration::from_secs(60), WAKE.notified()).await;
        if RETRY.swap(false, std::sync::atomic::Ordering::Relaxed) {
            failed.clear();
        }
        if !crate::auth::signed_in() {
            continue;
        }
        let auth = handle.state::<Auth>().inner().clone();
        let list = match wanted(&auth, &vault).await {
            Ok(list) => list.into_iter().filter(|w| failed.get(&(w.shot.clone(), w.version)).copied().unwrap_or(0) < proxies::TRIES).collect::<Vec<_>>(),
            Err(e) => {
                tracing::warn!("world proxies: {e}");
                continue;
            }
        };
        for w in &list {
            jobs::queue(Kind::WorldProxy, &w.of(), &w.label());
        }
        for w in &list {
            let made = render(&handle, &vault, w).await;
            jobs::end(Kind::WorldProxy, &w.of(), made.as_ref().map(|_| ()).map_err(|e| e.clone()));
            match made {
                Ok(hash) => {
                    tracing::info!("world proxy of {} v{}: {hash}", w.shot, w.version);
                    handle.emit("vault-proxy", json!({ "of": w.of(), "shot": w.shot, "shotVersion": w.version, "proxy": hash })).ok();
                }
                Err(e) => {
                    let tries = failed.entry((w.shot.clone(), w.version)).or_default();
                    *tries += 1;
                    tracing::warn!("world proxy of {} v{} (try {tries} of {}): {e}", w.shot, w.version, proxies::TRIES);
                    // the page may be stuck: the next one starts in a fresh one
                    close_if_idle(&handle);
                }
            }
        }
        close_if_idle(&handle);
    }
}

/// Keep the Mac from napping the app while a proxy renders unseen (App Nap slows timers and the GPU's work).
pub(crate) struct Awake(objc2::rc::Retained<objc2::runtime::AnyObject>);
// SAFETY: an NSProcessInfo activity token is an immutable object; ending it from another thread is allowed.
unsafe impl Send for Awake {}

impl Awake {
    pub(crate) fn begin(reason: &str) -> Option<Self> {
        use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
        // NSActivityUserInitiatedAllowingIdleSystemSleep
        const OPTIONS: u64 = 0x00FF_FFFF & !(1 << 20);
        // SAFETY: documented NSProcessInfo calls with an NSString we own.
        unsafe {
            let info: Retained<AnyObject> = msg_send![class!(NSProcessInfo), processInfo];
            let reason = objc2_foundation::NSString::from_str(reason);
            let token: Option<Retained<AnyObject>> = msg_send![&*info, beginActivityWithOptions: OPTIONS, reason: &*reason];
            token.map(Awake)
        }
    }
}

impl Drop for Awake {
    fn drop(&mut self) {
        use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
        // SAFETY: the token beginActivityWithOptions gave us, ended once.
        unsafe {
            let info: Retained<AnyObject> = msg_send![class!(NSProcessInfo), processInfo];
            let _: () = msg_send![&*info, endActivity: &*self.0];
        }
    }
}

/// The frame a shape is rendered at: HD, the long edge 1920 (as the render worker's proxies were).
fn frame_of(aspect: &str) -> (&'static str, u32, u32) {
    match aspect {
        "9:16" => ("9:16", 1080, 1920),
        "1:1" => ("1:1", 1080, 1080),
        "4:5" => ("4:5", 1080, 1350),
        _ => ("16:9", 1920, 1080),
    }
}

/// One shot version's proxy, into the vault: its hash.
async fn render(handle: &AppHandle, vault: &Vault, w: &Want) -> Res<String> {
    let of = w.of();
    let _turn = jobs::turn(Kind::WorldProxy, &of).await.map_err(|e| e.to_string())?;
    // an ingest first, and only while the Mac has memory to spare (as for every proxy)
    jobs::ready_to_run(vault, Kind::WorldProxy, &of).await;
    let _held = vault.hold.take("proxy");
    let _awake = Awake::begin("rendering a world shot's proxy");
    jobs::stage(Kind::WorldProxy, &of, "opening the world", 0.0);

    let (shape, width, height) = frame_of(w.spec["aspect"].as_str().unwrap_or("16:9"));
    let fps = w.spec["fps"].as_f64().filter(|f| *f > 0.0).unwrap_or(30.0);
    let seconds = w.spec["seconds"].as_f64().filter(|s| *s > 0.0).ok_or("the shot has no length")?;
    let frames = ((seconds * fps).round() as u32).max(1);
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let part = vault.ingest_dir().join(format!("{}-v{}-{stamp}.world.part.mp4", w.shot, w.version));
    let of2 = of.clone();
    let ask = Frames { spec: w.spec.clone(), shape, width, height, fps, from: 0.0, frames, bitrate: None };
    let (proxy, info) = match shoot(handle, &format!("{}-v{}", w.shot, w.version), &ask, &part, move |done| jobs::stage(Kind::WorldProxy, &of2, "making", done)).await {
        Ok(made) => made,
        Err(e) => {
            std::fs::remove_file(&part).ok();
            return Err(e);
        }
    };

    jobs::stage(Kind::WorldProxy, &of, "adding", 1.0);
    let named = vault.ingest_dir().join(format!("shot-{}-v{}-proxy.mp4", &w.shot[..8.min(w.shot.len())], w.version));
    std::fs::rename(&part, &named).map_err(err)?;
    let batch = Batch {
        session: format!("world proxy of shot {} v{}", w.shot, w.version),
        tags: ["proxy", "world shot"].into_iter().map(String::from).chain(w.project.clone()).collect(),
        title: Some(format!("{} · v{} · world proxy", w.name, w.version)),
        description: Some(format!("HD proxy ({}×{}) of the world shot {}, version {}, in ACEScct — for editing", proxy.width, proxy.height, w.name, w.version)),
        meta: json!({
            "role": "proxy", "shot": w.shot, "shotVersion": w.version, "shape": shape,
            "width": proxy.width, "height": proxy.height, "fps": fps, "duration_s": (proxy.seconds * 1000.0).round() / 1000.0,
            "color": { "profile": WORKING, "from": "our own tag", "primaries": "bt709", "transfer": "bt709", "matrix": "bt709", "range": "tv", "bitDepth": 10,
                "detectedFrom": format!("world shot {} v{}", w.shot, w.version) },
            "world": info,
        }),
        story: w.story.clone(),
        class: Some("proxy".into()),
        ..Default::default()
    };
    let made = vault.ingest_file(&named, &batch).await.map_err(err);
    std::fs::remove_file(&named).ok();
    Ok(made?.hash)
}

/// What the world renders: `frames` frames of a shot from `from` seconds into it, framed for `shape`, at a size and a
/// rate — a shot's whole HD proxy, or a plate the final render cuts in.
pub struct Frames {
    pub spec: Value,
    pub shape: &'static str,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub from: f64,
    pub frames: u32,
    /// the movie's bit rate (None: a proxy's)
    pub bitrate: Option<u32>,
}

/// Render frames of a shot in the unseen world into an ACEScct movie at `out` (HEVC Main10, `FrameWriter`): the movie
/// and what the world says of it (its exposure, its build). Takes no turn of its own — the caller holds
/// the GPU lane (a proxy, or a render with its plates).
pub async fn shoot(handle: &AppHandle, label: &str, ask: &Frames, out: &Path, progress: impl FnMut(f64) + Send + 'static) -> Res<(Proxy, Value)> {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let id = format!("{label}-{stamp}");
    // the encoder first, on its own thread (AVFoundation's objects stay where they are made); then the job
    let (tx, rx) = std::sync::mpsc::sync_channel::<Msg>(1);
    *FEED.lock().unwrap() = Some((id.clone(), tx));
    let (done_tx, done_rx) = tokio::sync::oneshot::channel();
    let (file, (width, height, fps, frames, bitrate)) = (out.to_path_buf(), (ask.width, ask.height, ask.fps, ask.frames, ask.bitrate));
    let mut progress = progress;
    let spawned = std::thread::Builder::new().name("world frames".into()).spawn(move || {
        let r = encode(rx, &file, width, height, fps, frames, bitrate, &mut progress);
        done_tx.send(r).ok();
    });
    if let Err(e) = spawned {
        *FEED.lock().unwrap() = None;
        return Err(err(e));
    }
    let result = async {
        open_window(handle).await?;
        *SLOT.lock().unwrap() = Some(Job {
            id: id.clone(),
            spec: ask.spec.clone(),
            shape: ask.shape,
            width,
            height,
            fps,
            from: ask.from,
            frames,
            oversample: OVERSAMPLE,
        });
        POSTED.notify_one();
        done_rx.await.map_err(|_| "the encoder stopped".to_string())?
    }
    .await;
    SLOT.lock().unwrap().take();
    *FEED.lock().unwrap() = None;
    result
}

// ── plates: a world clip's frames for the final render ─────────────────────────────────────────────────────────────

/// What a plate's cache key covers besides its request: bump it when the world renders plates differently.
const PLATE_FORMAT: u32 = 1;
/// A plate for the render: the file (a vault file, read in place), its key, the shot's fingerprint, whether the vault
/// had it already.
pub struct Plate {
    pub file: vault_media::Source,
    pub key: String,
    pub fingerprint: String,
    pub reused: bool,
}

/// The plate with this key in the vault (a live file, `meta.role: plate`).
async fn plate_in_vault(vault: &Vault, key: &str) -> Res<Option<vault_core::Meta>> {
    let all = vault.catalog.list().await.map_err(err)?;
    Ok(all.into_iter().find(|m| m.meta.get("role").and_then(Value::as_str) == Some("plate") && m.meta.get("plate_key").and_then(Value::as_str) == Some(key)))
}

/// Plates from before they were vault files (`<vault>/plates/<key>.mp4`): each ingested as the vault file it is, then
/// the folder is gone — nothing of the vault lives beside its store.
pub async fn import_old_plates(vault: &Vault) {
    let dir = vault.dir.join("plates");
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(key) = name.strip_suffix(".mp4").filter(|k| !k.contains(".part")).map(String::from) else {
            std::fs::remove_file(&path).ok();
            continue;
        };
        let known = plate_in_vault(vault, &key).await.ok().flatten().is_some();
        if !known {
            let batch = Batch {
                session: format!("plate {key}"),
                tags: vec!["plate".into()],
                title: Some(format!("plate {}", &key[..key.len().min(12)])),
                meta: json!({ "role": "plate", "plate_key": key }),
                class: Some("proxy".into()),
                ..Default::default()
            };
            match vault.ingest_file(&path, &batch).await {
                Ok(o) => tracing::info!("plate {key} is a vault file now ({})", &o.hash[..12]),
                Err(e) => {
                    tracing::warn!("plate {key}: {e:#}");
                    continue;
                }
            }
        }
        std::fs::remove_file(&path).ok();
    }
    if std::fs::remove_dir(&dir).is_ok() {
        tracing::info!("the old plates folder is gone: every plate is a vault file");
    }
}

fn hex_of(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

/// A plate's key: the shot's data (its spec, so a new version is a new plate), the stretch, the frame, the rate — and
/// how the world renders it (`PLATE_FORMAT`, the oversampling). The fingerprint is the spec's alone.
pub fn plate_key(spec: &Value, ask: &Frames) -> (String, String) {
    let fingerprint = hex_of(serde_json::to_string(spec).unwrap_or_default().as_bytes());
    let what = json!({
        "format": PLATE_FORMAT, "fingerprint": fingerprint, "from": (ask.from * 1000.0).round() / 1000.0, "frames": ask.frames,
        "shape": ask.shape, "width": ask.width, "height": ask.height, "fps": ask.fps, "oversample": OVERSAMPLE,
    });
    (hex_of(what.to_string().as_bytes())[..32].to_string(), fingerprint[..16].to_string())
}

/// A plate's bit rate: finer than a proxy's (it is graded and cut into every delivery) — 0.4 bits a pixel, 4K at 30 fps
/// about 100 Mbps.
pub fn plate_bitrate(width: u32, height: u32, fps: f64) -> u32 {
    ((width as f64 * height as f64 * fps * 0.4) as u32).clamp(20_000_000, 150_000_000)
}

/// A plate: the vault's (read in place, from whoever holds it), or rendered now in the unseen world and ingested — it
/// syncs like every file (the caller holds the GPU lane).
pub async fn plate(handle: &AppHandle, vault: &Vault, label: &str, ask: &Frames, progress: impl FnMut(f64) + Send + 'static) -> Res<Plate> {
    let (key, fingerprint) = plate_key(&ask.spec, ask);
    if let Some(m) = plate_in_vault(vault, &key).await? {
        let hash: iroh_blobs::Hash = m.hash.parse().map_err(err)?;
        let file = crate::blob::source(vault, hash, &m.original_name).await.map_err(|e| format!("plate {key}: {e:#} — it comes over iroh"))?;
        return Ok(Plate { file, key, fingerprint, reused: true });
    }
    std::fs::create_dir_all(vault.ingest_dir()).map_err(err)?;
    // the encoder writes a file (AVAssetWriter); it goes into the vault, then the work file is gone
    let work = vault.ingest_dir().join(format!("{key}.plate.mp4"));
    if let Err(e) = shoot(handle, label, ask, &work, progress).await {
        std::fs::remove_file(&work).ok();
        return Err(e);
    }
    let batch = Batch {
        session: format!("plate {key}"),
        tags: vec!["plate".into()],
        title: Some(format!("{label} · plate")),
        meta: json!({ "role": "plate", "plate_key": key, "fingerprint": fingerprint, "shape": ask.shape, "width": ask.width, "height": ask.height, "fps": ask.fps, "from": ask.from, "frames": ask.frames }),
        class: Some("proxy".into()),
        ..Default::default()
    };
    let made = vault.ingest_file(&work, &batch).await.map_err(err);
    std::fs::remove_file(&work).ok();
    let hash: iroh_blobs::Hash = made?.hash.parse().map_err(err)?;
    let file = crate::blob::source(vault, hash, &format!("{key}.mp4")).await.map_err(err)?;
    Ok(Plate { file, key, fingerprint, reused: false })
}

/// The encoder's thread: frames in order into the movie until the page says the shot is through.
#[allow(clippy::too_many_arguments)]
fn encode(rx: Receiver<Msg>, out: &Path, width: u32, height: u32, fps: f64, frames: u32, bitrate: Option<u32>, progress: &mut dyn FnMut(f64)) -> Res<(Proxy, Value)> {
    let mut writer = match bitrate {
        Some(b) => FrameWriter::create_at(out, width, height, fps, b),
        None => FrameWriter::create(out, width, height, fps),
    }
    .map_err(err)?;
    loop {
        let wait = if writer.frames() == 0 { FIRST_FRAME } else { NEXT_FRAME };
        match rx.recv_timeout(wait) {
            Ok(Msg::Frame(n, bytes)) => {
                if u64::from(n) != writer.frames() {
                    return Err(format!("frame {n} came when {} was due", writer.frames()));
                }
                writer.push(&bytes).map_err(err)?;
                progress(writer.frames() as f64 / f64::from(frames));
            }
            Ok(Msg::End(Ok(info))) => {
                if writer.frames() != u64::from(frames) {
                    return Err(format!("the world sent {} frames of {frames}", writer.frames()));
                }
                return Ok((writer.finish().map_err(err)?, info));
            }
            Ok(Msg::End(Err(e))) => return Err(format!("the world: {e}")),
            Err(RecvTimeoutError::Timeout) => return Err(format!("the world sent no frame for {} minutes", wait.as_secs() / 60)),
            Err(RecvTimeoutError::Disconnected) => return Err("the world went away".into()),
        }
    }
}

/// The world's window: opened once for a run of proxies, on screen but unseen.
async fn open_window(handle: &AppHandle) -> Res<()> {
    if handle.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(handle, LABEL, WebviewUrl::App("/games/sandbox-4/?film".into()))
        .title("The OS · world renderer")
        .inner_size(640.0, 640.0)
        .position(0.0, 0.0)
        .decorations(false)
        .resizable(false)
        .shadow(false)
        .focused(false)
        .focusable(false)
        .always_on_bottom(true)
        .skip_taskbar(true)
        .visible(true)
        .initialization_script(DRIVER)
        .build()
        .map_err(err)?;
    window.set_ignore_cursor_events(true).ok();
    window.with_webview(|w| unseen(w.inner(), w.ns_window())).map_err(err)?;
    Ok(())
}

/// Transparent, out of the way, and still "visible" to WebKit: an occluded or hidden page gets no animation frames and
/// slow timers, and the world builds its domes on its animation frames.
fn unseen(webview: *mut c_void, window: *mut c_void) {
    use objc2::{msg_send, runtime::AnyObject, sel};
    if webview.is_null() || window.is_null() {
        return;
    }
    // SAFETY: the WKWebView and NSWindow wry made, on the main thread (with_webview runs there).
    unsafe {
        let view = &*(webview as *const AnyObject);
        let can: bool = msg_send![view, respondsToSelector: sel!(_setWindowOcclusionDetectionEnabled:)];
        if can {
            let _: () = msg_send![view, _setWindowOcclusionDetectionEnabled: false];
        } else {
            tracing::warn!("world proxy: this WebKit has no switch for occlusion detection — keep the studio in front while it renders");
        }
        let win = &*(window as *const AnyObject);
        let _: () = msg_send![win, setAlphaValue: 0.0f64];
        let _: () = msg_send![win, setIgnoresMouseEvents: true];
        let _: () = msg_send![win, setExcludedFromWindowsMenu: true];
        // on every Space, out of Mission Control and of ⌘` (canJoinAllSpaces | transient | ignoresCycle)
        let _: () = msg_send![win, setCollectionBehavior: (1usize << 0) | (1 << 3) | (1 << 6)];
    }
}

pub fn close_window(handle: &AppHandle) {
    if let Some(w) = handle.get_webview_window(LABEL) {
        w.destroy().ok();
    }
}

/// Who keeps the world's window open between shots (a render with several plates): while one is held, nobody closes it.
static KEPT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

pub struct Kept;

/// Keep the world open until this is dropped (a built world takes minutes to build again).
pub fn keep() -> Kept {
    KEPT.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Kept
}

impl Drop for Kept {
    fn drop(&mut self) {
        KEPT.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Close the world's window unless it is rendering or kept open (a proxy run ending must not close it under a render).
pub fn close_if_idle(handle: &AppHandle) {
    let feed = FEED.lock().unwrap();
    if feed.is_none() && KEPT.load(std::sync::atomic::Ordering::SeqCst) == 0 {
        close_window(handle);
    }
}
