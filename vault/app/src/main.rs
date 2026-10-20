//! maiaCITY Studio — the Mac app. Every admin and studio function that touches media runs here, natively; the
//! browser build never carries them. The window shows the studio's pages; this side owns the vault (an iroh node on
//! this Mac's SSD), ingest with the three-hash check, and `vault://localhost/<hash>` — the bytes of any file, with
//! Range, for <img> and <video>.

mod analyse;
mod asks;
mod auth;
mod aven;
mod avendb;
mod blob;
mod enclave;
mod jobs;
mod models;
mod page;
mod passkey;
mod player;
mod proxies;
mod render;
#[cfg(target_os = "macos")]
mod revive;
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

/// A file the studio made itself (a title card rendered from its layers on the Thumbnail step): its bytes come as
/// the request's raw body; the `x-ingest` header carries, percent-encoded, a JSON { name, story, tags, title,
/// description, public }. Written to a temporary folder and ingested like a picked file (the three-hash check, the
/// story's bucket, its tags), then described; answers its hash.
#[tauri::command]
async fn vault_ingest_bytes(handle: AppHandle, app: State<'_, App>, request: tauri::ipc::Request<'_>) -> Res<serde_json::Value> {
    gate()?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("send the file's bytes as the body".into()) };
    let about = request.headers().get("x-ingest").and_then(|v| v.to_str().ok()).map(percent_decode).unwrap_or_else(|| "{}".into());
    let about: serde_json::Value = serde_json::from_str(&about).map_err(err)?;
    let name = about["name"].as_str().filter(|n| !n.is_empty() && !n.contains('/') && !n.starts_with('.')).unwrap_or("made.bin");
    let dir = std::env::temp_dir().join(format!("maiacity-made-{}", ingest::now_iso().replace([':', '.'], "-")));
    std::fs::create_dir_all(&dir).map_err(err)?;
    let path = dir.join(name);
    std::fs::write(&path, bytes).map_err(err)?;
    let tags: Vec<String> = about["tags"].as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default();
    let story = about["story"].as_str().filter(|s| !s.is_empty()).map(String::from);
    if app.busy.swap(true, Ordering::SeqCst) {
        return Err("an ingest is already running".into());
    }
    let result = run_ingest(&handle, &app.vault, vec![path.display().to_string()], tags, story, None, true).await;
    app.busy.store(false, Ordering::SeqCst);
    let _ = std::fs::remove_dir_all(&dir);
    let summary = result.map_err(err)?;
    let hash = Hash::new(bytes);
    // what it is, as the studio says: a file the same bytes already made keeps its place, its words are set anew
    let patch: serde_json::Map<String, serde_json::Value> = ["title", "description", "public"]
        .iter()
        .filter(|k| !about[*k].is_null())
        .map(|k| (k.to_string(), about[*k].clone()))
        .collect();
    if !patch.is_empty() {
        app.vault.catalog.describe(hash, &serde_json::Value::Object(patch)).await.map_err(err)?;
    }
    Ok(serde_json::json!({ "hash": hash.to_hex(), "files": summary.files, "verified": summary.verified, "duplicates": summary.duplicates, "mismatches": summary.mismatches }))
}

/// "%20" and the like back to their bytes (a header is ASCII; the JSON in it is sent percent-encoded).
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&b[i + 1..i + 3]).unwrap_or("zz"), 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
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
    // a process like every other (jobs.rs): the Processes tab shows it beside the work it starts; ended as failed if
    // it stops on an error
    let source = paths.iter().filter_map(|p| std::path::Path::new(p).file_name()).map(|n| n.to_string_lossy()).collect::<Vec<_>>().join(", ");
    let ingesting = jobs::Ending::begin(jobs::Kind::Ingest, &session, &format!("{total} files from {source}"));
    // local work first: while the files come in, nothing is rendered and nothing is sent — each resumes after
    let held = vault.hold.take("ingest");
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
        jobs::stage(jobs::Kind::Ingest, &session, &format!("{} of {total} in", index + 1), (index + 1) as f64 / total.max(1) as f64);
        handle.emit("ingest", Progress { index, total, path, size, story: story.clone(), outcome: Some(o.clone()) }).ok();
        outcomes.push(o);
    }
    drop(held);
    ingesting.done();
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

/// Runs harness `args[0]`'s agent device beside the app's avenDB folder (or `--dir <folder>`), as an MCP server on its
/// stdin and stdout, logging on its stderr (`avendb_device::agent`). What the process exits with.
fn agent(args: &[String]) -> i32 {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into()))
        .with_writer(std::io::stderr)
        .with_ansi(false)
        .init();
    let (harness, dir) = match args {
        [harness] => (harness.clone(), avendb::folder()),
        [harness, flag, dir] if flag == "--dir" => (harness.clone(), PathBuf::from(dir)),
        _ => {
            eprintln!("usage: maiacity-studio agent <harness> [--dir <folder>]");
            return 2;
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread().enable_all().thread_stack_size(8 << 20).build() {
        Ok(runtime) => runtime,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    match runtime.block_on(avendb_device::agent::serve(dir, harness, tokio::io::stdin(), tokio::io::stdout())) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e:#}");
            1
        }
    }
}

fn main() {
    // the TLS of whatever names none: aws-lc-rs, the provider the app's legacy node uses too (vault-core's
    // `tls-aws-lc-rs`); avenDB's node names its own, post-quantum only
    rustls::crypto::aws_lc_rs::default_provider().install_default().expect("no TLS provider before the app's");
    // `agent <harness> [--dir <folder>]`: a harness's agent device, the command avenDB's device names for it
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|a| a == "agent") {
        std::process::exit(agent(&args[1..]));
    }
    tracing_subscriber::fmt().with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "warn".into())).init();

    let app = tauri::Builder::default();
    // a page whose web process died opens again, never left white (revive.rs)
    #[cfg(target_os = "macos")]
    let app = app.on_page_load(revive::loaded).on_web_content_process_terminate(revive::died);
    app.plugin(tauri_plugin_dialog::init())
        .manage(auth::Auth::default())
        .manage(avendb::Avendb::default())
        .setup(|app| {
            aven::init(app.handle());
            let vault = Arc::new(tauri::async_runtime::block_on(Vault::open(vault_dir()))?);
            app.manage(App { vault, busy: AtomicBool::new(false) });
            // every process this Mac runs, in one registry (jobs.rs): the studio's Processes tab is its view
            jobs::init(app.handle().clone());
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
        .register_asynchronous_uri_scheme_protocol("aven", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn(async move { responder.respond(aven::serve(app, request).await) });
        })
        .register_asynchronous_uri_scheme_protocol("vault", |ctx, request, responder| {
            let vault = ctx.app_handle().state::<App>().vault.clone();
            tauri::async_runtime::spawn(async move { responder.respond(serve(vault, request).await) });
        })
        .invoke_handler(tauri::generate_handler![
            auth::auth_status,
            auth::auth_start,
            auth::auth_sign_out,
            auth::api,
            passkey::passkey_sheet,
            avendb::avendb,
            enclave::avendb_touch_ready,
            aven::studio_ingest,
            aven::studio_job,
            aven::studio_import,
            aven::film_seed,
            aven::film_seed_keep,
            asks::asks_open,
            asks::ask_answer,
            page::page_answer,
            vault_list,
            vault_describe,
            vault_ingest_bytes,
            log_js,
            jobs::jobs_list,
            jobs::jobs_cancel,
            jobs::jobs_bump,
            jobs::jobs_retry,
            transcripts::transcript_edit,
            proxies::color_lut,
            proxies::color_grade,
            proxies::studio_sound,
            proxies::color_frame,
            player::player_load,
            player::player_play,
            player::player_pause,
            player::player_sync,
            player::player_drawn,
            transcripts::vault_transcribe,
            render::sound_measure,
            render::eq_response,
            world::world_proxy_next,
            world::world_proxy_frame,
            world::world_proxy_end
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
                // and avenDB's device, which closes its own
                tauri::async_runtime::block_on(avendb::stop(&handle.state::<avendb::Avendb>()));
            }
        });
}
