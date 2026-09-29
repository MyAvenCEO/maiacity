//! maiaCITY Studio — the Mac app. Every admin and studio function that touches media runs here, natively; the
//! browser build never carries them. The window shows the studio's pages; this side owns the vault (an iroh node on
//! this Mac's SSD), ingest with the three-hash check, and `vault://localhost/<hash>` — the bytes of any file, with
//! Range, for <img> and <video>.

mod auth;

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
        catalog: v.catalog.doc.id().to_string(),
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
    let mut list = app.vault.catalog.list().await.map_err(err)?;
    list.sort_by(|a, b| b.added.cmp(&a.added).then(a.original_name.cmp(&b.original_name)));
    Ok(list)
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
        let (free, total) = disk_space(&path);
        out.push(Source { name: e.file_name().to_string_lossy().into_owned(), path: path.display().to_string(), free, total });
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
async fn vault_ingest(handle: AppHandle, app: State<'_, App>, paths: Vec<String>, tags: Vec<String>) -> Res<Summary> {
    gate()?;
    if app.busy.swap(true, Ordering::SeqCst) {
        return Err("an ingest is already running".into());
    }
    let result = run_ingest(&handle, &app.vault, paths, tags).await;
    app.busy.store(false, Ordering::SeqCst);
    result.map_err(err)
}

async fn run_ingest(handle: &AppHandle, vault: &Vault, paths: Vec<String>, tags: Vec<String>) -> anyhow::Result<Summary> {
    let session = ingest::now_iso();
    let batch = ingest::Batch { session: session.clone(), tags, ..Default::default() };
    let mut files = Vec::new();
    for p in &paths {
        files.extend(ingest::walk(&PathBuf::from(p))?);
    }
    let total = files.len();
    let started = std::time::Instant::now();
    let mut outcomes = Vec::new();
    for (index, f) in files.iter().enumerate() {
        let size = std::fs::metadata(f).map(|m| m.len()).unwrap_or(0);
        let path = f.display().to_string();
        handle.emit("ingest", Progress { index, total, path: path.clone(), size, outcome: None }).ok();
        let o = vault.ingest_file(f, &batch).await?;
        handle.emit("ingest", Progress { index, total, path, size, outcome: Some(o.clone()) }).ok();
        outcomes.push(o);
    }
    let seconds = started.elapsed().as_secs_f64();
    let bytes = outcomes.iter().map(|o| o.size).sum();
    let count = |v: Verdict| outcomes.iter().filter(|o| o.verdict == v).count();
    let report = serde_json::json!({ "session": session, "sources": paths, "files": outcomes, "bytes": bytes, "seconds": seconds });
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

fn vault_dir() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    std::env::var_os("MAIACITY_VAULT").map(PathBuf::from).unwrap_or_else(|| home.join("Library/Application Support/city.maia.vault"))
}

fn main() {
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into())).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(auth::Auth::default())
        .setup(|app| {
            let vault = tauri::async_runtime::block_on(Vault::open(vault_dir()))?;
            app.manage(App { vault: Arc::new(vault), busy: AtomicBool::new(false) });
            Ok(())
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
            vault_status,
            vault_list,
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
