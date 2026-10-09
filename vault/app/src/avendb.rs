//! avenDB in the app, natively: its device runs beside the app as its sidecar, `avendb-device` (built from
//! avendb/crates/avendb-device by build.rs, and bundled beside the app's own binary), so its node reaches the person's
//! other devices directly, over UDP sockets of its own, and keeps their vault in a folder on this Mac
//! (~/Library/Application Support/city.maia.studio/avendb/), not in the web view's IndexedDB. The avenDB page calls it
//! through `avendb` ($lib/avendb/native.js), in the calls the page's own device answers; each ceremony of the person's
//! passkey it asks for runs in the sign-in sheet over the window that called last (passkey.rs), what comes back sealed
//! to a key the device made for that ceremony alone. It starts with the first call, runs on while the app does, its
//! node syncing whichever page is open, and stops as the app quits (`stop`): its stdin ends, and it closes its store.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::oneshot;

/// What a call comes back with: what the device answered, or why there is no answer.
type Answer = Result<Value, String>;

/// Its stdin, shared by the calls and the sheets' answers; gone once the app quits.
type Stdin = Arc<tokio::sync::Mutex<Option<ChildStdin>>>;

/// avenDB's device beside the app, once a call started it.
#[derive(Default)]
pub struct Avendb(tokio::sync::Mutex<Option<Sidecar>>);

struct Sidecar {
    child: Child,
    stdin: Stdin,
    calls: Arc<Mutex<Calls>>,
    /// The window whose page called last, which its sheets show over.
    window: Arc<Mutex<tauri::WebviewWindow>>,
}

/// The calls awaiting the device's answer, by id; or why it stopped answering.
#[derive(Default)]
struct Calls {
    next: u64,
    waiting: HashMap<u64, oneshot::Sender<Answer>>,
    ended: Option<String>,
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
    let (answer, stdin, line) = {
        let mut held = state.0.lock().await;
        if held.as_ref().is_none_or(|s| s.calls.lock().expect("the calls").ended.is_some()) {
            if let Some(mut old) = held.take() {
                old.child.start_kill().ok();
            }
            *held = Some(start(&window)?);
        }
        let sidecar = held.as_ref().expect("started");
        *sidecar.window.lock().expect("the window") = window;
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
    // a device that stopped answers every call that awaits it with why, as its stdout ends
    if let Err(e) = write(&stdin, &line).await {
        tracing::warn!("avenDB's device: {e}");
    }
    answer.await.map_err(|_| "avenDB's device stopped".to_string())?
}

/// Stops avenDB's device as the app quits: its stdin ends, and it closes its node and its store, for five seconds at
/// most.
pub async fn stop(state: &Avendb) {
    let Some(mut sidecar) = state.0.lock().await.take() else { return };
    sidecar.stdin.lock().await.take();
    if tokio::time::timeout(Duration::from_secs(5), sidecar.child.wait()).await.is_err() {
        sidecar.child.start_kill().ok();
    }
}

/// The device's folder: beside the app's settings.
fn folder() -> PathBuf {
    crate::settings_file().with_file_name("avendb")
}

/// Starts the device, its sheets over `window` until another window calls.
fn start(window: &tauri::WebviewWindow) -> Result<Sidecar, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?.with_file_name("avendb-device");
    let mut child = Command::new(&exe)
        .arg("--dir")
        .arg(folder())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // its log, into the app's
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("avenDB's device didn't start ({}): {e}", exe.display()))?;
    let stdin: Stdin = Arc::new(tokio::sync::Mutex::new(child.stdin.take()));
    let stdout = child.stdout.take().ok_or("avenDB's device has no stdout")?;
    let calls = Arc::new(Mutex::new(Calls::default()));
    let window = Arc::new(Mutex::new(window.clone()));
    tauri::async_runtime::spawn(read(stdout, calls.clone(), stdin.clone(), window.clone()));
    Ok(Sidecar { child, stdin, calls, window })
}

/// Reads the device's answers, each to the call awaiting it, and its asks for the sign-in sheet, each shown over the
/// window that called last and answered; until its stdout ends, or it says why it can't run (`fatal`: the stand-in
/// build.rs leaves when the device didn't build). Then every call still awaiting it ends with why.
async fn read(
    stdout: ChildStdout,
    calls: Arc<Mutex<Calls>>,
    stdin: Stdin,
    window: Arc<Mutex<tauri::WebviewWindow>>,
) {
    let mut lines = BufReader::new(stdout).lines();
    let why = loop {
        let message = match lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                Ok(message) => message,
                Err(_) => continue,
            },
            Ok(None) => break "avenDB's device stopped".to_string(),
            Err(e) => break format!("avenDB's device: {e}"),
        };
        if let Some(why) = message.get("fatal").and_then(Value::as_str) {
            break why.to_string();
        } else if let Some(n) = message.get("sheet").and_then(Value::as_u64) {
            let url = message.get("url").and_then(Value::as_str).unwrap_or_default().to_string();
            let (stdin, window) = (stdin.clone(), window.lock().expect("the window").clone());
            tauri::async_runtime::spawn(async move {
                let answer = match crate::passkey::sheet(&window, url).await {
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
