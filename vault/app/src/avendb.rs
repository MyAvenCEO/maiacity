//! avenDB in the app, natively: its device runs inside the app's own process (`avendb_device::serve`, on a runtime of
//! its own whose threads have room on their stacks), so its node reaches the person's other devices directly, over UDP
//! sockets of its own, and keeps their vault in a folder on this Mac (~/avenDB/mac/, where the person finds all of
//! avenDB's data), not in the web view's IndexedDB. The app speaks to it as it spoke to the sidecar it was before: lines
//! of JSON, now over in-process pipes. The avenDB page calls it through `avendb` ($lib/avendb/native.js), in the calls
//! the page's own device answers; each ceremony of the person's passkey it asks for runs in the sign-in sheet over the
//! window that called last (passkey.rs), what comes back sealed to a key the device made for that ceremony alone. It
//! starts with the first call, runs on while the app does, its node syncing whichever page is open, and stops as the
//! app quits (`stop`): its input ends, and it closes its store.
//!
//! A harness's agent device still runs as a process of its own, the app's binary run as `agent <harness>` (`agent`,
//! from main.rs), the command the device names for it (`agentCommand`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader, DuplexStream};
use tokio::sync::oneshot;

/// What a call comes back with: what the device answered, or why there is no answer.
type Answer = Result<Value, String>;

/// The window the sheets show over.
type Window = Arc<Mutex<Option<tauri::WebviewWindow>>>;

/// The device's input, shared by the calls and the sheets' answers; gone once the app quits.
type Stdin = Arc<tokio::sync::Mutex<Option<DuplexStream>>>;

/// How much a pipe between the app and its device holds before the writer waits. Each way is a pipe of its own, so
/// that the end dropped on one side ends the other's reading: the app's input as it quits, the device's output as it
/// stops.
const PIPE: usize = 1 << 20;

/// avenDB's device in the app, once a call started it.
#[derive(Default)]
pub struct Avendb(tokio::sync::Mutex<Option<Sidecar>>);

struct Sidecar {
    stdin: Stdin,
    calls: Arc<Mutex<Calls>>,
    /// The window whose page called last, which its sheets show over; none while only the app's own Rust called.
    window: Window,
    /// Comes once the device has closed its store and its thread has ended.
    ended: oneshot::Receiver<()>,
}

/// The calls awaiting the device's answer, by id; or why it stopped answering.
#[derive(Default)]
struct Calls {
    next: u64,
    waiting: HashMap<u64, oneshot::Sender<Answer>>,
    ended: Option<String>,
    /// Why the device's thread ended, if it failed, for `read` to end its calls with.
    failed: Option<String>,
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

async fn call_on(
    state: &Avendb,
    window: Option<tauri::WebviewWindow>,
    call: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    let (answer, stdin, line) = {
        let mut held = state.0.lock().await;
        if held.as_ref().is_none_or(|s| s.calls.lock().expect("the calls").ended.is_some()) {
            // a device that stopped has closed its store already: its thread ends as its output does
            held.take();
            *held = Some(start()?);
        }
        let sidecar = held.as_ref().expect("started");
        if let Some(window) = window {
            *sidecar.window.lock().expect("the window") = Some(window);
        }
        let (tx, rx) = oneshot::channel();
        let id = {
            let mut calls = sidecar.calls.lock().expect("the calls");
            if let Some(why) = &calls.ended {
                return Err(why.clone());
            }
            calls.next += 1;
            let id = calls.next;
            calls.waiting.insert(id, tx);
            id
        };
        (rx, sidecar.stdin.clone(), json!({ "id": id, "call": call, "args": args }))
    };
    // a device that stopped answers every call that awaits it with why, as its output ends
    if let Err(e) = write(&stdin, &line).await {
        tracing::warn!("avenDB's device: {e}");
    }
    answer.await.map_err(|_| "avenDB's device stopped".to_string())?
}

/// Stops avenDB's device as the app quits: its input ends, and it closes its node and its store, for five seconds at
/// most; then the app quits whether it is done or not.
pub async fn stop(state: &Avendb) {
    let Some(sidecar) = state.0.lock().await.take() else { return };
    sidecar.stdin.lock().await.take();
    if tokio::time::timeout(Duration::from_secs(5), sidecar.ended).await.is_err() {
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

/// Starts the device on a thread of its own, its sheets over the window that calls (`call_on`).
fn start() -> Result<Sidecar, String> {
    moved()?;
    let dir = folder();
    std::fs::create_dir_all(&dir).map_err(|e| format!("avenDB's folder {} couldn't be made: {e}", dir.display()))?;
    // the drives the Mac mounts, which it hosts
    let volumes = cfg!(target_os = "macos").then(|| avendb_device::drive::VOLUMES.into());
    let config = avendb_device::Config { dir, direct: true, volumes };
    let (stdin, input) = tokio::io::duplex(PIPE);
    let (output, stdout) = tokio::io::duplex(PIPE);
    let calls = Arc::new(Mutex::new(Calls::default()));
    let (done, ended) = oneshot::channel();
    let failed = calls.clone();
    std::thread::Builder::new()
        .name("avendb-device".into())
        .spawn(move || {
            // threads with room on their stacks: a Classic McEliece key pair's public matrix, over a megabyte, is
            // made there
            let runtime = match tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .thread_name("avendb-device")
                .thread_stack_size(8 << 20)
                .build()
            {
                Ok(runtime) => runtime,
                Err(e) => {
                    failed.lock().expect("the calls").failed = Some(format!("avenDB's device didn't start: {e}"));
                    return;
                }
            };
            if let Err(e) = runtime.block_on(avendb_device::serve(config, input, output)) {
                tracing::warn!("avenDB's device: {e:#}");
                failed.lock().expect("the calls").failed = Some(format!("avenDB's device stopped: {e:#}"));
            }
            // its tasks end with it, its output among them, which ends `read`
            drop(runtime);
            let _ = done.send(());
        })
        .map_err(|e| format!("avenDB's device didn't start: {e}"))?;
    let stdin: Stdin = Arc::new(tokio::sync::Mutex::new(Some(stdin)));
    let window: Window = Arc::new(Mutex::new(None));
    tauri::async_runtime::spawn(read(stdout, calls.clone(), stdin.clone(), window.clone()));
    Ok(Sidecar { stdin, calls, window, ended })
}

/// Reads the device's answers, each to the call awaiting it, and its asks for the sign-in sheet, each shown over the
/// window that called last and answered; until its output ends, or it says why it can't run (`fatal`). Then every
/// call still awaiting it ends with why.
async fn read(
    stdout: DuplexStream,
    calls: Arc<Mutex<Calls>>,
    stdin: Stdin,
    window: Window,
) {
    let mut lines = BufReader::new(stdout).lines();
    let why = loop {
        let message = match lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                Ok(message) => message,
                Err(_) => continue,
            },
            Ok(None) => {
                break calls.lock().expect("the calls").failed.take().unwrap_or("avenDB's device stopped".into());
            }
            Err(e) => break format!("avenDB's device: {e}"),
        };
        if let Some(why) = message.get("fatal").and_then(Value::as_str) {
            break why.to_string();
        } else if let Some(n) = message.get("sheet").and_then(Value::as_u64) {
            let url = message.get("url").and_then(Value::as_str).unwrap_or_default().to_string();
            let (stdin, window) = (stdin.clone(), window.lock().expect("the window").clone());
            tauri::async_runtime::spawn(async move {
                let shown = match &window {
                    Some(window) => crate::passkey::sheet(window, url).await,
                    None => Err("no window to show the sign-in sheet over: open avenDB's page first".into()),
                };
                let answer = match shown {
                    Ok(back) => json!({ "sheet": n, "back": back }),
                    Err(why) => json!({ "sheet": n, "error": why }),
                };
                if let Err(e) = write(&stdin, &answer).await {
                    tracing::warn!("avenDB's device: {e}");
                }
            });
        } else if let Some(id) = message.get("id").and_then(Value::as_u64) {
            let answer = match message.get("ok") {
                Some(ok) => Ok(ok.clone()),
                None => Err(message.get("error").and_then(Value::as_str).unwrap_or("no answer").to_string()),
            };
            if let Some(tx) = calls.lock().expect("the calls").waiting.remove(&id) {
                let _ = tx.send(answer);
            }
        }
    };
    let mut calls = calls.lock().expect("the calls");
    for (_, tx) in calls.waiting.drain() {
        let _ = tx.send(Err(why.clone()));
    }
    calls.ended = Some(why);
}

/// Writes `message` to the device, a line of JSON.
async fn write(stdin: &Stdin, message: &Value) -> Result<(), String> {
    let mut stdin = stdin.lock().await;
    let stdin = stdin.as_mut().ok_or("the app is quitting")?;
    let line = format!("{message}\n");
    stdin.write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
    stdin.flush().await.map_err(|e| e.to_string())
}
