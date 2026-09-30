//! maiaCITY Studio — the Mac app. Every admin and studio function that touches media runs here, natively; the
//! browser build never carries them. The window shows the studio's pages; this side owns the vault (an iroh node on
//! this Mac's SSD), ingest with the three-hash check, and `vault://localhost/<hash>` — the bytes of any file, with
//! Range, for <img> and <video>.

mod analyse;
mod analysis;
mod asks;
mod auth;
mod blob;
mod drives;
mod local;
mod mcp;
mod models;
mod proxies;
mod keep;
mod render;
mod sound;
mod sources;
mod stories;
mod sync;
mod transcripts;
mod world;

use std::{
    io::SeekFrom,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, State,
    http::{Request, Response, StatusCode, header},
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use vault_core::{IngestOutcome, Meta, Vault, Verdict, ingest};

struct App {
    vault: Arc<Vault>,
    busy: AtomicBool,
}

type Res<T> = Result<T, String>;

/// The admin gate: nothing in the vault answers until this Mac is signed in with the admin's passkey.
fn gate() -> Res<()> {
    if auth::signed_in() { Ok(()) } else { Err("Sign in with your passkey first.".into()) }
}
fn err(e: impl std::fmt::Display) -> String {
    format!("{e:#}")
}

#[derive(Serialize)]
struct Status {
    endpoint: String,
    catalog: String,
    dir: String,
    files: usize,
    bytes: u64,
    disk_free: u64,
    disk_total: u64,
}

#[tauri::command]
async fn vault_status(app: State<'_, App>) -> Res<Status> {
    gate()?;
    let v = &app.vault;
    let list = v.catalog.list().await.map_err(err)?;
    let (free, total) = disk_space(&v.dir);
    Ok(Status {
        endpoint: v.endpoint.id().to_string(),
        catalog: v.catalog.id().to_string(),
        dir: v.dir.display().to_string(),
        files: list.len(),
        bytes: list.iter().map(|m| m.size).sum(),
        disk_free: free,
        disk_total: total,
    })
}

#[tauri::command]
async fn vault_list(app: State<'_, App>) -> Res<Vec<Meta>> {
    gate()?;
    let mut list = app.vault.catalog.list_view().await.map_err(err)?;
    list.sort_by(|a, b| b.added.cmp(&a.added).then(a.original_name.cmp(&b.original_name)));
    Ok(list)
}

/// The web view's warnings and errors (the studio's, the world frame's), into the app's log — its console is not
/// open to anyone.
#[tauri::command]
fn log_js(level: String, from: String, message: String) {
    if level == "error" {
        tracing::error!(target: "webview", "{from}: {message}");
    } else {
        tracing::warn!(target: "webview", "{from}: {message}");
    }
}

/// Change what is known about a file (title, description, tags, public; meta merged key by key) — it syncs like the
/// rest of the catalog.
#[tauri::command]
async fn vault_describe(app: State<'_, App>, hash: String, patch: serde_json::Value) -> Res<Meta> {
    gate()?;
    let hash: Hash = hash.parse().map_err(err)?;
    let meta = app.vault.catalog.describe(hash, &patch).await.map_err(err)?;
    // what the studio shows: the description with its derived records (transcript, analysis) merged in
    Ok(app.vault.catalog.meta_view(hash).await.map_err(err)?.unwrap_or(meta))
}

#[derive(Serialize)]
struct Source {
    name: String,
    path: String,
    free: u64,
    total: u64,
}

/// Cards and drives: everything mounted under /Volumes except the system disk.
#[tauri::command]
fn vault_sources() -> Res<Vec<Source>> {
    gate()?;
    let mut out = Vec::new();
    for e in std::fs::read_dir("/Volumes").map_err(err)? {
        let e = e.map_err(err)?;
        let path = e.path();
        // the system volume appears here as a link to /
        if std::fs::canonicalize(&path).map(|p| p == PathBuf::from("/")).unwrap_or(false) {
            continue;
        }
        // Time Machine's snapshots and other hidden system volumes are never a source
        let name = e.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name.starts_with("com.apple.") || name.contains("TimeMachine") || name == "Recovery" {
            continue;
        }
        let (free, total) = disk_space(&path);
        out.push(Source { name, path: path.display().to_string(), free, total });
    }
    Ok(out)
}

#[derive(Serialize)]
struct Scan {
    files: usize,
    bytes: u64,
    kinds: std::collections::BTreeMap<String, usize>,
}

#[tauri::command]
async fn vault_scan(paths: Vec<String>) -> Res<Scan> {
    gate()?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut scan = Scan { files: 0, bytes: 0, kinds: Default::default() };
        for p in paths {
            for f in ingest::walk(&PathBuf::from(p)).map_err(err)? {
                scan.files += 1;
                scan.bytes += std::fs::metadata(&f).map(|m| m.len()).unwrap_or(0);
                *scan.kinds.entry(ingest::kind_of(ingest::mime_of(&f)).to_string()).or_default() += 1;
            }
        }
        Ok(scan)
    })
    .await
    .map_err(err)?
}

#[derive(Serialize, Clone)]
struct Progress {
    index: usize,
    total: usize,
    path: String,
    size: u64,
    /// the story it goes into (empty: the inbox)
    story: String,
    outcome: Option<IngestOutcome>,
}

#[derive(Serialize)]
struct Summary {
    session: String,
    files: usize,
    bytes: u64,
    seconds: f64,
    verified: usize,
    duplicates: usize,
    mismatches: usize,
    report: String,
}

/// Ingest files and folders with the three-hash check; each file reports as it starts and as it ends
/// (event `ingest`). The session's report goes into the catalog as `ingest/<session>`.
#[tauri::command]
async fn vault_ingest(
    handle: AppHandle,
    app: State<'_, App>,
    paths: Vec<String>,
    tags: Vec<String>,
    story: Option<String>,
    class: Option<String>,
) -> Res<Summary> {
    gate()?;
    if let Some(c) = &class {
        stories::by_hand(c)?;
    }
    if app.busy.swap(true, Ordering::SeqCst) {
        return Err("an ingest is already running".into());
    }
    // a person ingests: what is already in the vault moves into the chosen story
    let result = run_ingest(&handle, &app.vault, paths, tags, story, class, true).await;
    app.busy.store(false, Ordering::SeqCst);
    result.map_err(err)
}

/// Ingest into a story (its id; None: the inbox), every file in one class or each told from itself.
async fn run_ingest(
    handle: &AppHandle,
    vault: &Arc<Vault>,
    paths: Vec<String>,
    tags: Vec<String>,
    story: Option<String>,
    class: Option<String>,
    moves_existing: bool,
) -> anyhow::Result<Summary> {
    let session = ingest::now_iso();
    let batch = ingest::Batch { session: session.clone(), tags, story, class, moves_existing, ..Default::default() };
    let mut files = Vec::new();
    for p in &paths {
        files.extend(ingest::walk(&PathBuf::from(p))?);
    }
    let total = files.len();
    let started = std::time::Instant::now();
    let mut outcomes = Vec::new();
    // local work first: while the files come in, nothing is rendered and nothing is sent — each resumes after
    let held = vault.hold.take("ingest");
    let mut proxies_due = Vec::new();
    let story = batch.story.clone().unwrap_or_default();
    for (index, f) in files.iter().enumerate() {
        let size = std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        let path = f.display().to_string();
        handle.emit("ingest", Progress { index, total, path: path.clone(), size, story: story.clone(), outcome: None }).ok();
        // how far this file is, for its B column: at most once per percent
        let (h, p, st, last) = (handle.clone(), path.clone(), story.clone(), Arc::new(std::sync::atomic::AtomicU32::new(u32::MAX)));
        let told: ingest::Progress = Arc::new(move |done: f64| {
            let pct = (done * 100.0) as u32;
            if last.swap(pct, std::sync::atomic::Ordering::Relaxed) != pct {
                h.emit("ingest-bytes", serde_json::json!({ "path": p, "story": st, "size": size, "done": done })).ok();
            }
        });
        let o = vault.ingest_file_with(f, &batch, told).await?;
        handle.emit("ingest", Progress { index, total, path, size, story: story.clone(), outcome: Some(o.clone()) }).ok();
        // every video original gets its proxy — once all files are in, one at a time, from the source while it is here
        if o.verdict == Verdict::Verified {
            if let Ok(Some(m)) = vault.catalog.meta(o.hash.parse()?).await {
                if proxies::wants_proxy(&m) {
                    proxies_due.push((o.hash.clone(), f.clone()));
                }
            }
        }
        outcomes.push(o);
    }
    drop(held);
    for (hash, source) in proxies_due {
        tauri::async_runtime::spawn(proxies::auto_proxy(handle.clone(), vault.clone(), hash, source));
    }
    // and every recording its words, here, on-device — once the ingest is done (transcripts.rs)
    {
        let (h, v) = (handle.clone(), vault.clone());
        tauri::async_runtime::spawn(async move { transcripts::queue_due(&h, &v).await });
        // its sound record (the start timecode) and its shot analysis, here too (sound.rs, analyse/)
        sound::wake();
        analyse::wake();
    }
    let seconds = started.elapsed().as_secs_f64();
    let bytes = outcomes.iter().map(|o| o.size).sum();
    let count = |v: Verdict| outcomes.iter().filter(|o| o.verdict == v).count();
    let report = serde_json::json!({ "session": session, "sources": paths, "story": batch.story, "files": outcomes, "bytes": bytes, "seconds": seconds });
    let report_hash = vault.catalog.put_report(&session, &report).await?;
    Ok(Summary {
        session,
        files: outcomes.len(),
        bytes,
        seconds,
        verified: count(Verdict::Verified),
        duplicates: count(Verdict::Duplicate),
        mismatches: count(Verdict::Mismatch),
        report: report_hash.to_hex(),
    })
}

fn disk_space(path: &std::path::Path) -> (u64, u64) {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};
    let Ok(c) = CString::new(path.as_os_str().as_bytes()) else { return (0, 0) };
    // SAFETY: statvfs fills the struct for a valid, NUL-terminated path.
    unsafe {
        let mut s: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c.as_ptr(), &mut s) != 0 {
            return (0, 0);
        }
        let frag = s.f_frsize as u64;
        (s.f_bavail as u64 * frag, s.f_blocks as u64 * frag)
    }
}

/// `vault://localhost/<hash>`: the file's bytes, with Range, straight from the store.
async fn serve(vault: Arc<Vault>, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let reply = |status: StatusCode, body: &str| {
        Response::builder().status(status).body(body.as_bytes().to_vec()).unwrap_or_default()
    };
    if !auth::signed_in() {
        return reply(StatusCode::UNAUTHORIZED, "sign in first");
    }
    let hex = request.uri().path().trim_start_matches('/').split(['.', '/']).next().unwrap_or("");
    let Ok(hash) = hex.parse::<Hash>() else { return reply(StatusCode::BAD_REQUEST, "not a hash") };
    let size = match vault.store.blobs().status(hash).await {
        Ok(BlobStatus::Complete { size }) => size,
        _ => return reply(StatusCode::NOT_FOUND, "not in this vault"),
    };
    let mime = match vault.catalog.meta(hash).await {
        Ok(Some(m)) => m.mime,
        _ => "application/octet-stream".into(),
    };

    // one range per response, at most 8 MiB — the player asks for the next one
    const MAX: u64 = 8 * 1024 * 1024;
    let range = request
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
        .and_then(|v| {
            let (a, b) = v.split_once('-')?;
            let start: u64 = if a.is_empty() { size.saturating_sub(b.parse().ok()?) } else { a.parse().ok()? };
            let end: u64 = if a.is_empty() || b.is_empty() { size - 1 } else { b.parse().ok()? };
            Some((start, end.min(size - 1)))
        });
    let (start, end, partial) = match range {
        Some((s, e)) if s <= e && s < size => (s, e.min(s + MAX - 1), true),
        Some(_) => {
            return Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{size}"))
                .body(Vec::new())
                .unwrap_or_default();
        }
        None => (0, size.saturating_sub(1), false),
    };
    let len = if size == 0 { 0 } else { end - start + 1 };

    let mut reader = vault.store.blobs().reader(hash);
    let mut body = vec![0u8; len as usize];
    if len > 0 {
        if reader.seek(SeekFrom::Start(start)).await.is_err() || reader.read_exact(&mut body).await.is_err() {
            return reply(StatusCode::INTERNAL_SERVER_ERROR, "read failed");
        }
    }
    let mut res = Response::builder()
        .status(if partial { StatusCode::PARTIAL_CONTENT } else { StatusCode::OK })
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_LENGTH, len.to_string())
        .header(header::CACHE_CONTROL, "private, max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    if partial {
        res = res.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    res.body(body).unwrap_or_default()
}

/// The app's own settings (not the vault): where the vault lives.
pub(crate) fn settings_file() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.studio/settings.json")
}

/// Where this Mac's vault lives: MAIACITY_VAULT, else the drive chosen in the studio, else the internal SSD.
fn vault_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    if let Some(dir) = std::env::var_os("MAIACITY_VAULT") {
        return PathBuf::from(dir);
    }
    std::fs::read(settings_file())
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v["vault_dir"].as_str().map(PathBuf::from))
        .unwrap_or_else(|| home.join("Library/Application Support/city.maia.vault"))
}

fn main() {
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into())).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(auth::Auth::default())
        .setup(|app| {
            let vault = Arc::new(tauri::async_runtime::block_on(Vault::open(vault_dir()))?);
            app.manage(App { vault: vault.clone(), busy: AtomicBool::new(false) });
            // signed in already: join the network now; then keep this Mac complete in the background
            let handle = app.handle().clone();
            let v = vault.clone();
            tauri::async_runtime::spawn(async move {
                if auth::signed_in() {
                    let auth = handle.state::<auth::Auth>();
                    if let Err(e) = sync::connect(&v, &auth).await {
                        tracing::warn!("joining the vault's network: {e}");
                    }
                }
                sync::keep_complete(handle, v).await;
            });
            // the studio for agents: MCP on this Mac only, behind the app's token
            // every video original without its proxy: queued, now and every ten minutes
            tauri::async_runtime::spawn(proxies::sweep(app.handle().clone(), vault.clone()));
            // and every recording without its words: transcribed here, on-device (Phonon-2), now and every ten minutes
            tauri::async_runtime::spawn(transcripts::sweep(app.handle().clone(), vault.clone()));
            // and every recording's sound record (its start timecode), read here from the file itself
            tauri::async_runtime::spawn(sound::sweep(vault.clone()));
            // and every picture's tags, cues and thumbnail: its proxy's frames, sampled here, to Prem's Qwen from this Mac
            tauri::async_runtime::spawn(analyse::sweep(app.handle().clone(), vault.clone()));
            // and every world shot a timeline plays, rendered here in the studio's own world (world.rs)
            tauri::async_runtime::spawn(world::sweep(app.handle().clone(), vault.clone()));
            // nothing of the vault beside its store: old plates become vault files; the models' unpacked copies and the
            // retired scope sheets go (the models are read from their blobs)
            {
                let v = vault.clone();
                tauri::async_runtime::spawn(async move {
                    world::import_old_plates(&v).await;
                    for old in ["models", "scopes"] {
                        std::fs::remove_dir_all(v.dir.join(old)).ok();
                    }
                });
            }
            // and every external drive that is a vault device of its own, kept complete for its stories (drives.rs)
            tauri::async_runtime::spawn(drives::start(app.handle().clone(), vault.clone()));
            // and what this Mac keeps (avenSSD): its stories' files fetched, pinned and announced, the rest let go of (keep.rs)
            tauri::async_runtime::spawn(keep::sweep(vault.clone()));
            // and the render queue: this Mac is the render worker — films and hero frames, natively (render.rs)
            tauri::async_runtime::spawn(render::sweep(app.handle().clone(), vault.clone()));
            let (handle, v) = (app.handle().clone(), vault.clone());
            let auth = app.state::<auth::Auth>().inner().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = mcp::serve(v, auth, handle).await {
                    tracing::warn!("MCP server: {e:#}");
                }
            });
            Ok(())
        })
        // the studio's window closed: the unseen world window goes with it, so the app quits as it always did
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                world::close_window(window.app_handle());
            }
        })
        .register_asynchronous_uri_scheme_protocol("maiaapi", |ctx, request, responder| {
            let http = ctx.app_handle().state::<auth::Auth>().http();
            tauri::async_runtime::spawn(async move { responder.respond(auth::proxy(http, request).await) });
        })
        .register_asynchronous_uri_scheme_protocol("vault", |ctx, request, responder| {
            let vault = ctx.app_handle().state::<App>().vault.clone();
            tauri::async_runtime::spawn(async move { responder.respond(serve(vault, request).await) });
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::auth_start,
            auth::auth_sign_out,
            auth::auth_open,
            auth::api,
            sync::vault_connect,
            sync::vault_copies,
            mcp::mcp_info,
            asks::asks_open,
            keep::stores_status,
            asks::ask_answer,
            vault_status,
            vault_list,
            vault_describe,
            log_js,
            stories::stories_list,
            sources::ingest_sources,
            sources::source_ready,
            sources::source_delete,
            sync::vault_transfers,
            stories::story_save,
            stories::story_delete,
            stories::files_move,
            stories::files_class,
            proxies::proxies_now,
            proxies::vault_hold,
            proxies::color_lut,
            proxies::color_grade,
            proxies::color_presets,
            proxies::color_thumb,
            proxies::vault_proxy,
            transcripts::vault_transcribe,
            analyse::analysis_setup,
            analyse::vault_analyse,
            render::sound_measure,
            world::world_proxy_next,
            world::world_proxy_frame,
            world::world_proxy_end,
            vault_sources,
            vault_scan,
            vault_ingest
        ])
        .build(tauri::generate_context!())
        .expect("start maiaCITY Studio")
        .run(|handle, event| {
            if let tauri::RunEvent::Exit = event {
                // close the store cleanly — it may lose its last seconds of writes otherwise
                let vault = handle.state::<App>().vault.clone();
                tauri::async_runtime::block_on(async move {
                    vault.endpoint.close().await;
                    vault.store.shutdown().await.ok();
                });
            }
        });
}
