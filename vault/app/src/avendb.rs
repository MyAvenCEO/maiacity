//! avenDB in the app, natively: its device runs inside the app's own process (`avendb_device::host`, on a runtime of
//! its own whose threads have room on their stacks), so its node reaches the person's other devices directly, over UDP
//! sockets of its own, and keeps their vault in a folder on this Mac (~/avenDB/mac/, where the person finds all of
//! avenDB's data), not in the web view's IndexedDB. Each call the app makes is
//! answered by the device itself, with no lines of JSON between. The avenDB page calls it through `avendb`
//! ($lib/avendb/native.js), in the calls the page's own device answers, a file's bytes both ways as they are, never in
//! base64 in JSON (`avendb_read`, `avendb_chunk`); each ceremony of the person's passkey it asks
//! for runs in the sign-in sheet over the window that called last (passkey.rs), what comes back sealed to a key the
//! device made for that ceremony alone; each touch of the Mac's Touch ID key it asks for, the Secure Enclave answers
//! (enclave.rs). The app's own Rust reads a file's bytes on the device's own node (`node`).
//! It starts with the first call, runs on while the app does, its node
//! syncing whichever page is open, and stops as the app quits (`stop`), closing its store.
//!
//! A harness's agent device still runs as a process of its own, the app's binary run as `agent <harness>` (`agent`,
//! from main.rs), the command the device names for it (`agentCommand`).

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use avendb_device::{Host, OpenNode};
use serde_json::{Value, json};
use tokio::sync::oneshot;

/// The window the sheets show over.
type Window = Arc<Mutex<Option<tauri::WebviewWindow>>>;

/// Whether this Mac's avenDB device is open, as the last call to it left it (`is_open`).
static OPEN: AtomicBool = AtomicBool::new(false);

/// Whether this Mac's avenDB device is open, its person having unlocked it: the door the app opens on, and the studio's
/// (main.rs `gate`).
pub fn is_open() -> bool {
    OPEN.load(Ordering::Relaxed)
}

/// avenDB's device in the app, once a call started it.
#[derive(Default)]
pub struct Avendb {
    hosted: tokio::sync::Mutex<Option<Hosted>>,
    closing: AtomicBool,
    closed: AtomicBool,
}

struct Hosted {
    host: Host,
    /// The window whose page called last, which its sheets show over; none while only the app's own Rust called.
    window: Window,
    /// Retains the runtime's stop signal until every store has fenced.
    runtime: crate::avendb_shutdown::RuntimeStop,
}

/// Calls `call` with `args` on avenDB's device, as the page's own device answers it, starting the device if it isn't
/// running: what it answered.
#[tauri::command]
pub async fn avendb(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Avendb>,
    call: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    call_on(&state, Some(window), call, args).await
}

/// Runs op `op` on avenDB's device as `avendb` runs it (`run`), a `read_file`'s bytes handed to the page as they are,
/// not in base64 in JSON: the op's answer as JSON after its length (four bytes, little-endian), `bytes` in it the
/// number of bytes read, then those bytes ($lib/avendb/native.js `readFile`). A call that fails answers why, as
/// `avendb`'s do.
#[tauri::command]
pub async fn avendb_read(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Avendb>,
    op: Value,
) -> Result<tauri::ipc::Response, String> {
    let (mut answer, bytes) = run_on(&state, Some(window), op).await?;
    if let (Some(bytes), Some(out)) = (&bytes, answer.as_object_mut()) {
        out.insert("bytes".to_string(), bytes.len().into());
    }
    let bytes = bytes.unwrap_or_default();
    let json = serde_json::to_vec(&answer).map_err(|e| e.to_string())?;
    let mut body = Vec::with_capacity(4 + json.len() + bytes.len());
    body.extend_from_slice(&(json.len() as u32).to_le_bytes());
    body.extend_from_slice(&json);
    body.extend_from_slice(&bytes);
    Ok(tauri::ipc::Response::new(body))
}

/// Hands avenDB's device a chunk of a file on its way in (`fileStart`), its bytes the call's raw body, as they are,
/// not in base64 in JSON: the file's number in header `x-file` and where the chunk starts in `x-at`
/// ($lib/avendb/native.js `putFile`).
#[tauri::command]
pub async fn avendb_chunk(
    window: tauri::WebviewWindow,
    state: tauri::State<'_, Avendb>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("a chunk comes as raw bytes".into()) };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).and_then(|v| v.parse::<u64>().ok());
    let n = header("x-file").ok_or("which file?")?;
    let at = header("x-at").ok_or("where does the chunk start?")?;
    chunk_on(&state, Some(window), n, at, bytes.clone()).await
}

/// Calls `call` with `args` on avenDB's device from the app's own Rust (the studio's jobs, `aven`), starting it if it
/// isn't running: what it answered. A call that asks for the person's passkey shows its sheet over the window that
/// called last, and fails if no page has called yet.
pub async fn call(app: &tauri::AppHandle, call: &str, args: Vec<Value>) -> Result<Value, String> {
    use tauri::Manager as _;
    call_on(&app.state::<Avendb>(), None, call.to_string(), args).await
}

/// The node of avenDB's device open in the app (`Host::node`), for the app's own Rust to read a file's bytes by range
/// with nothing between (`aven::read`): none until a page has opened the device.
pub async fn node(app: &tauri::AppHandle) -> Result<Option<OpenNode>, String> {
    use tauri::Manager as _;
    Ok(host_of(&app.state::<Avendb>(), None).await?.node())
}

/// Runs op `op` on avenDB's device from the app's own Rust (`run_on`): its answer, and a `read_file`'s bytes beside.
pub async fn run(app: &tauri::AppHandle, op: Value) -> Result<(Value, Option<Vec<u8>>), String> {
    use tauri::Manager as _;
    run_on(&app.state::<Avendb>(), None, op).await
}

/// Hands avenDB's device chunk `bytes` of file `n` from `at` on, from the app's own Rust (`chunk_on`).
pub async fn chunk(app: &tauri::AppHandle, n: u64, at: u64, bytes: Vec<u8>) -> Result<(), String> {
    use tauri::Manager as _;
    chunk_on(&app.state::<Avendb>(), None, n, at, bytes).await
}

/// What the device answered, `{"ok": value}`: the value, or why not.
fn ok_of(answer: Value) -> Result<Value, String> {
    match answer.get("ok") {
        Some(ok) => Ok(ok.clone()),
        None => Err(answer.get("error").and_then(Value::as_str).unwrap_or("no answer").to_string()),
    }
}

/// Op `op` run on the device (`Host::run`), as `run` calls it but its bytes beside as they are: its answer, and a
/// `read_file`'s bytes.
async fn run_on(state: &Avendb, window: Option<tauri::WebviewWindow>, op: Value) -> Result<(Value, Option<Vec<u8>>), String> {
    let host = host_of(state, window).await?;
    let (answer, bytes) = host.run(op).await;
    OPEN.store(host.node().is_some(), Ordering::Relaxed);
    Ok((ok_of(answer)?, bytes))
}

/// Chunk `bytes` of file `n` from `at` on handed to the device (`Host::chunk`), as `fileChunk` hands it but as it is.
async fn chunk_on(state: &Avendb, window: Option<tauri::WebviewWindow>, n: u64, at: u64, bytes: Vec<u8>) -> Result<(), String> {
    let host = host_of(state, window).await?;
    ok_of(host.chunk(n, at, bytes).await).map(drop)
}

async fn call_on(
    state: &Avendb,
    window: Option<tauri::WebviewWindow>,
    call: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let host = host_of(state, window).await?;
    let answer = host.call(&call, args).await;
    OPEN.store(host.node().is_some(), Ordering::Relaxed);
    ok_of(answer)
}

/// The device's host, started if it isn't; the window that called kept for its sheets, never the world renderer's,
/// which reads off the device unseen (world.rs).
async fn host_of(state: &Avendb, window: Option<tauri::WebviewWindow>) -> Result<Host, String> {
    if state.closing.load(Ordering::Acquire) {
        return Err("avenDB is closing; no new device can start".into());
    }
    let mut held = state.hosted.lock().await;
    if state.closing.load(Ordering::Acquire) {
        return Err("avenDB is closing; no new device can start".into());
    }
    if held.is_none() {
        *held = Some(start()?);
    }
    let hosted = held.as_ref().expect("started");
    if let Some(window) = window.filter(|w| w.label() != crate::world::LABEL) {
        *hosted.window.lock().expect("the window") = Some(window);
    }
    Ok(hosted.host.clone())
}

/// Intercepts quit before Tauri tears down the app. Repeated requests share the
/// first owned close; a failed close keeps its runtime and store owner alive.
pub fn exit_requested(app: &tauri::AppHandle, code: Option<i32>, api: &tauri::ExitRequestApi) {
    use tauri::Manager as _;
    let state = app.state::<Avendb>();
    if state.closed.load(Ordering::Acquire) { return; }
    api.prevent_exit();
    if state.closing.swap(true, Ordering::AcqRel) { return; }
    OPEN.store(false, Ordering::Relaxed);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Own the close independently of the event callback and surface a panic
        // as a failure too. Hosted stays in app state until durable success.
        let closing = app.clone();
        let result = tauri::async_runtime::spawn(async move { stop(&closing.state::<Avendb>()).await }).await;
        let result = result.unwrap_or_else(|error| Err(format!("the close task failed: {error}")));
        match result {
            Ok(()) => {
                app.state::<Avendb>().closed.store(true, Ordering::Release);
                app.exit(code.unwrap_or(0));
            }
            Err(error) => {
                tracing::error!("avenDB shutdown failed; the app and store owner remain alive: {error}");
                use tauri_plugin_dialog::{DialogExt as _, MessageDialogKind};
                app.dialog().message(format!("avenDB could not safely close its store. The app has stayed open to protect pending changes.\n\n{error}"))
                    .title("Maia City could not quit safely")
                    .kind(MessageDialogKind::Error).show(|_| {});
            }
        }
    });
}

/// Close all stores before releasing the signal which keeps their runtime alive.
/// Five seconds is a diagnostic threshold, never permission to cancel the fence.
async fn stop(state: &Avendb) -> Result<(), String> {
    let mut held = state.hosted.lock().await;
    let Some(hosted) = held.as_mut() else { return Ok(()) };
    tracing::info!("avenDB shutdown: waiting for hosted stores");
    let Hosted { host, runtime, .. } = hosted;
    runtime.finish(async { host.close().await.map_err(|error| format!("{error:#}")) }).await?;
    held.take();
    Ok(())
}

/// What avenDB takes on this Mac's disk, for its Performance view: the device's folder (`folder()`) and its agents'
/// beside it, each its path, how many files and their bytes.
#[tauri::command]
pub async fn avendb_disk() -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let device = folder();
        let agents = device.with_file_name("mac-agents");
        let usage = |dir: &std::path::Path| -> Result<serde_json::Value, String> {
            let (files, bytes) = avendb_net::disk::usage(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
            Ok(serde_json::json!({ "path": dir.display().to_string(), "files": files, "bytes": bytes }))
        };
        Ok(serde_json::json!({ "device": usage(&device)?, "agents": usage(&agents)? }))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The device's folder: `~/avenDB/mac`, in the folder that holds all of avenDB's data on this Mac, its agents' folder
/// beside it (`mac-agents`, avendb-device's `agent::agents`). It keeps the name avendb-device gives it by default.
pub fn folder() -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    home.join("avenDB/mac")
}

/// Moves the device's folder, and its agents' beside it, from where the app kept them before (beside its settings,
/// in ~/Library/Application Support) to `folder()`, once: where the new one is missing and the old one is there. A
/// rename on the same disk, so nothing is copied and nothing is half moved.
fn moved() -> Result<(), String> {
    let new = folder();
    let old = crate::settings_file().with_file_name("avendb");
    if new.exists() || !old.exists() {
        return Ok(());
    }
    let parent = new.parent().ok_or("~/avenDB has no parent")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("{} couldn't be made: {e}", parent.display()))?;
    std::fs::rename(&old, &new).map_err(|e| format!("avenDB's folder didn't move to {}: {e}", new.display()))?;
    let (old_agents, new_agents) = (old.with_file_name("avendb-agents"), new.with_file_name("mac-agents"));
    if old_agents.exists() && !new_agents.exists() {
        std::fs::rename(&old_agents, &new_agents)
            .map_err(|e| format!("avenDB's agents didn't move to {}: {e}", new_agents.display()))?;
    }
    Ok(())
}

/// Starts the device on a runtime of its own, on a thread of its own, its sheets over the window that calls
/// (`call_on`).
fn start() -> Result<Hosted, String> {
    moved()?;
    let dir = folder();
    std::fs::create_dir_all(&dir).map_err(|e| format!("avenDB's folder {} couldn't be made: {e}", dir.display()))?;
    // the drives the Mac mounts, which it hosts
    let volumes = cfg!(target_os = "macos").then(|| avendb_device::drive::VOLUMES.into());
    let webtransport = avendb_device::webtransport_from_env().map_err(|error| format!("avenDB transport configuration: {error:#}"))?;
    let config = avendb_device::Config { dir, direct: true, volumes, webtransport };
    let (hosted, made) = std::sync::mpsc::channel();
    let (quit, quitting) = oneshot::channel::<()>();
    let (done, ended) = oneshot::channel();
    std::thread::Builder::new()
        .name("avendb-device".into())
        .spawn(move || {
            // threads with room on their stacks: a Classic McEliece key pair's public matrix, over a megabyte, is
            // made there; the host runs every call on this runtime, whichever runtime asks
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_name("avendb-device")
                .thread_stack_size(8 << 20)
                .build();
            let runtime = match runtime {
                Ok(runtime) => runtime,
                Err(e) => {
                    let _ = hosted.send(Err(format!("avenDB's device didn't start: {e}")));
                    return;
                }
            };
            let host = runtime.block_on(async { avendb_device::host(config) });
            let ok = host.is_ok();
            let _ = hosted.send(host.map_err(|e| format!("avenDB's device didn't start: {e:#}")));
            if ok {
                // the runtime lives until the app quits, the device closed (`stop`)
                let _ = runtime.block_on(quitting);
            }
            drop(runtime);
            let _ = done.send(());
        })
        .map_err(|e| format!("avenDB's device didn't start: {e}"))?;
    let (host, lines) = made.recv().map_err(|_| "avenDB's device didn't start".to_string())??;
    let window: Window = Arc::new(Mutex::new(None));
    tauri::async_runtime::spawn(sheets(lines, host.clone(), window.clone()));
    Ok(Hosted { host, window, runtime: crate::avendb_shutdown::RuntimeStop::new(quit, ended) })
}

/// Shows each sheet the device asks for over the window that called last, and gives it the sheet's answer; and asks
/// the Secure Enclave for each touch it asks for (enclave.rs), and gives it the Enclave's answer; until the host is gone.
async fn sheets(mut lines: avendb_device::Lines, host: Host, window: Window) {
    while let Some(message) = lines.recv().await {
        if let Some(n) = message.get("enclave").and_then(Value::as_u64) {
            let host = host.clone();
            tauri::async_runtime::spawn_blocking(move || {
                let mut answer = crate::enclave::ask(&message).unwrap_or_else(|why| json!({ "error": why }));
                answer["enclave"] = n.into();
                host.answer(&answer);
            });
            continue;
        }
        let Some(n) = message.get("sheet").and_then(Value::as_u64) else { continue };
        let url = message.get("url").and_then(Value::as_str).unwrap_or_default().to_string();
        let (host, window) = (host.clone(), window.lock().expect("the window").clone());
        tauri::async_runtime::spawn(async move {
            let shown = match &window {
                Some(window) => crate::passkey::sheet(window, url).await,
                None => Err("no window to show the sign-in sheet over: open avenDB's page first".into()),
            };
            host.answer(&match shown {
                Ok(back) => json!({ "sheet": n, "back": back }),
                Err(why) => json!({ "sheet": n, "error": why }),
            });
        });
    }
}
