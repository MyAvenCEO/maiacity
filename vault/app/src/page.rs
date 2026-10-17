//! Asking the app's own page: what the studio does in its page's JS (asking a rule of a cut, a render, a frame, and
//! reading the tasks back as jobs, `src/lib/studio/cuts.js`) the MCP asks of it here, so the page's code stays the one
//! implementation (`src/lib/studio/pagecalls.js` answers). The call waits for the page's answer; a page that is not
//! open, or not ready, leaves it unanswered, and after a while it fails.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// How long a call waits for the page.
pub const WAIT: Duration = Duration::from_secs(90);

type Open = HashMap<String, oneshot::Sender<Result<Value, String>>>;
static OPEN: LazyLock<Mutex<Open>> = LazyLock::new(Default::default);

/// Call `name` of the page's calls with `args`: its answer, or why not.
pub async fn call(handle: &AppHandle, name: &str, args: Value) -> Result<Value, String> {
    let id = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    let (tx, rx) = oneshot::channel();
    OPEN.lock().unwrap().insert(id.clone(), tx);
    handle.emit("studio-page-call", json!({ "id": id, "name": name, "args": args })).ok();
    match tokio::time::timeout(WAIT, rx).await {
        Ok(Ok(answer)) => answer,
        _ => {
            OPEN.lock().unwrap().remove(&id);
            Err("the app's page did not answer: open the app's window, signed in, with avenDB open".into())
        }
    }
}

/// The page's answer to call `id`: its value, or its error.
#[tauri::command]
pub fn page_answer(id: String, value: Option<Value>, error: Option<String>) -> Result<(), String> {
    let tx = OPEN.lock().unwrap().remove(&id).ok_or("that call is no longer open")?;
    tx.send(match error {
        Some(e) => Err(e),
        None => Ok(value.unwrap_or(Value::Null)),
    })
    .ok();
    Ok(())
}
