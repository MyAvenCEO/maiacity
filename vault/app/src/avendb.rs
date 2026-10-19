//! avenDB in the app, natively: its device runs inside the app's own process (`avendb_device::host`, on a runtime of
//! its own whose threads have room on their stacks), so its node reaches the person's other devices directly, over UDP
//! sockets of its own, and keeps their vault in a folder on this Mac (~/avenDB/mac/, where the person finds all of
//! avenDB's data), not in the web view's IndexedDB. Each call the app makes is
//! answered by the device itself, with no lines of JSON between. The avenDB page calls it through `avendb`
//! ($lib/avendb/native.js), in the calls the page's own device answers; each ceremony of the person's passkey it asks
//! for runs in the sign-in sheet over the window that called last (passkey.rs), what comes back sealed to a key the
//! device made for that ceremony alone; each touch of the Mac's Touch ID key it asks for, the Secure Enclave answers
//! (enclave.rs). The app's own Rust reads a file's bytes on the device's own node (`node`).
//! It starts with the first call, runs on while the app does, its node
//! syncing whichever page is open, and stops as the app quits (`stop`), closing its store.
//!
//! A harness's agent device still runs as a process of its own, the app's binary run as `agent <harness>` (`agent`,
//! from main.rs), the command the device names for it (`agentCommand`).

use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use avendb_device::{Host, OpenNode};
use serde_json::{Value, json};
use tokio::sync::oneshot;

/// The window the sheets show over.
type Window = Arc<Mutex<Option<tauri::WebviewWindow>>>;

/// avenDB's device in the app, once a call started it.
#[derive(Default)]
pub struct Avendb(tokio::sync::Mutex<Option<Hosted>>);

struct Hosted {
    host: Host,
    /// The window whose page called last, which its sheets show over; none while only the app's own Rust called.
    window: Window,
    /// Ends the device's runtime once it has closed (`stop`).
    quit: oneshot::Sender<()>,
    /// Comes once its runtime has ended.
    ended: oneshot::Receiver<()>,
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

async fn call_on(
    state: &Avendb,
    window: Option<tauri::WebviewWindow>,
    call: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let host = host_of(state, window).await?;
    let answer = host.call(&call, args).await;
    match answer.get("ok") {
        Some(ok) => Ok(ok.clone()),
        None => Err(answer.get("error").and_then(Value::as_str).unwrap_or("no answer").to_string()),
    }
}

/// The device's host, started if it isn't; the window that called kept for its sheets.
async fn host_of(state: &Avendb, window: Option<tauri::WebviewWindow>) -> Result<Host, String> {
    let mut held = state.0.lock().await;
    if held.is_none() {
        *held = Some(start()?);
    }
    let hosted = held.as_ref().expect("started");
    if let Some(window) = window {
        *hosted.window.lock().expect("the window") = Some(window);
    }
    Ok(hosted.host.clone())
}

/// Stops avenDB's device as the app quits: it closes its drives, workers, node and store, for five seconds at most;
/// then the app quits whether it is done or not.
pub async fn stop(state: &Avendb) {
    let Some(hosted) = state.0.lock().await.take() else { return };
    let closed = async {
        hosted.host.close().await;
        let _ = hosted.quit.send(());
        let _ = hosted.ended.await;
    };
    if tokio::time::timeout(Duration::from_secs(5), closed).await.is_err() {
        tracing::warn!("avenDB's device didn't close its store in five seconds");
    }
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
    let config = avendb_device::Config { dir, direct: true, volumes };
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
    Ok(Hosted { host, window, quit, ended })
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
