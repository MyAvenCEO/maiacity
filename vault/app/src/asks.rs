//! Asking the person: what an agent may not do by itself — deleting files — waits here for their yes or no. The
//! studio shows every open question as a modal with exactly what would happen (`vault-ask`); the agent's call waits
//! for the answer. Unanswered, a question is withdrawn after a while (`vault-ask-gone`) and nothing happens.

use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::Duration,
};

use serde_json::{Value, json};
use tauri::{AppHandle, Emitter};
use tokio::sync::oneshot;

/// How long a question waits for its answer.
pub const WAIT: Duration = Duration::from_secs(15 * 60);

type Open = HashMap<String, (Value, oneshot::Sender<bool>)>;
static OPEN: LazyLock<Mutex<Open>> = LazyLock::new(Default::default);

/// Ask the person (`question` is what the modal shows; it gets an `id`). `Some(yes)` once they answered, `None` when
/// nobody did in time.
pub async fn ask(handle: &AppHandle, mut question: Value) -> Option<bool> {
    let id = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    question["id"] = json!(id);
    let (tx, rx) = oneshot::channel();
    OPEN.lock().unwrap().insert(id.clone(), (question.clone(), tx));
    handle.emit("vault-ask", &question).ok();
    let answer = tokio::time::timeout(WAIT, rx).await.ok().and_then(|r| r.ok());
    if answer.is_none() {
        OPEN.lock().unwrap().remove(&id);
        handle.emit("vault-ask-gone", json!({ "id": id })).ok();
    }
    answer
}

/// The questions waiting now (a window that opens later shows them too).
#[tauri::command]
pub fn asks_open() -> Vec<Value> {
    OPEN.lock().unwrap().values().map(|(q, _)| q.clone()).collect()
}

/// The person's answer to a question.
#[tauri::command]
pub fn ask_answer(handle: AppHandle, id: String, yes: bool) -> Result<(), String> {
    crate::gate()?;
    let (_, tx) = OPEN.lock().unwrap().remove(&id).ok_or("that question is no longer open")?;
    tx.send(yes).ok();
    handle.emit("vault-ask-gone", json!({ "id": id })).ok();
    Ok(())
}
