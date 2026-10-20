//! Signing the app in with the person's passkey, as a browser signs in (#1107).
//!
//! Passkeys belong to maia.city, so the app's web view cannot use one itself: the passkey signs a sign-in's challenge in
//! the app's sign-in sheet (`passkey_sheet`, src/routes/app/avendb/sheet/), the page hands that answer to the API's
//! sign-in through `api`, and the session the API answers with, the same one a browser keeps in its cookie, is kept here
//! in a file only this user can read, never shown. Every API call the page makes goes out from here with it. No key of
//! the app's own: what the person may do is theirs in avenDB, and the shot analysis goes by the Mac's avenDB device pass.

use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::header::{COOKIE, SET_COOKIE};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

/// The API's session cookie (api/src/session.ts `COOKIE`).
const SESSION: &str = "maia_session";

pub fn api_base() -> String {
    std::env::var("MAIACITY_API").unwrap_or_else(|_| "https://api.maia.city".into())
}

/// One session per API: production and a local API never share one.
fn account() -> String {
    api_base()
}

/// The session lives in the app's own folder, readable by this user only. One per API.
fn session_file() -> std::path::PathBuf {
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.studio/session.json")
}

fn sessions() -> serde_json::Map<String, Value> {
    std::fs::read(session_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

fn write_sessions(map: &serde_json::Map<String, Value>) -> Result<(), String> {
    let file = session_file();
    std::fs::create_dir_all(file.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = file.with_extension("part");
    std::fs::write(&tmp, serde_json::to_vec_pretty(map).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&tmp, &file).map_err(|e| e.to_string())
}

/// This Mac's session with the API, while it lasts. A key from before (`mck_…`, the device flow's, which the API no
/// longer knows) is no session, and is forgotten.
fn load_session() -> Option<String> {
    let held = sessions().get(&account()).and_then(|v| v.as_str()).map(String::from)?;
    if held.starts_with("mck_") {
        forget_session();
        return None;
    }
    // founderId.expiry.signature (api/src/session.ts): one past its expiry opens nothing
    let expiry = held.split('.').nth(1).and_then(|e| e.parse::<u128>().ok())?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_millis();
    (expiry > now).then_some(held)
}

fn save_session(token: &str) -> Result<(), String> {
    let mut map = sessions();
    map.insert(account(), Value::String(token.to_string()));
    write_sessions(&map)
}

fn forget_session() {
    let mut map = sessions();
    if map.remove(&account()).is_some() {
        write_sessions(&map).ok();
    }
}

/// What an answer of the API says of the session, as a browser's cookie jar hears it: a sign-in's new one is kept, a
/// sign-out's empty one forgets it.
fn hear(res: &reqwest::Response) {
    for cookie in res.headers().get_all(SET_COOKIE) {
        let pair = cookie.to_str().ok().and_then(|c| c.split(';').next()).map(str::trim);
        match pair.and_then(|p| p.strip_prefix(SESSION)).and_then(|p| p.strip_prefix('=')) {
            Some("") => forget_session(),
            Some(token) => {
                if let Err(e) = save_session(token) {
                    tracing::warn!("the API's session could not be kept: {e}");
                }
            }
            None => {}
        }
    }
}

#[derive(Clone)]
pub struct Auth {
    http: reqwest::Client,
}

impl Default for Auth {
    /// An API that can't be reached says so within seconds, not after the system's own wait for a connection (over a
    /// minute), so the page goes on from this Mac meanwhile.
    fn default() -> Self {
        let http = reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(10)).build().unwrap_or_default();
        Self { http }
    }
}

/// Sign this Mac out: it forgets its session (which the API keeps nowhere: it is signed, and runs out by itself).
#[tauri::command]
pub async fn auth_sign_out() -> Result<(), String> {
    forget_session();
    Ok(())
}

/// What the API answered: its status and its JSON body — the page turns a refusal into the same error it always shows.
#[derive(Serialize)]
pub struct Answer {
    pub status: u16,
    pub body: Value,
}

/// The page's calls to the API, made natively with this Mac's session (no browser cookie, no CORS); a sign-in's answer
/// brings the session, a sign-out's takes it.
#[tauri::command]
pub async fn api(auth: State<'_, Auth>, method: String, path: String, body: Option<Value>) -> Result<Answer, String> {
    if !path.starts_with("/api/") {
        return Err("Only the maiaCITY API.".into());
    }
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let mut req = auth.http.request(method, format!("{}{path}", api_base()));
    if let Some(token) = load_session() {
        req = req.header(COOKIE, format!("{SESSION}={token}"));
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    // what the page can't show once it has moved on: a call that never reached the API, or one the API failed
    let res = req.send().await.map_err(|e| {
        tracing::warn!("api {path}: the API cannot be reached: {e}");
        format!("The API cannot be reached: {e}")
    })?;
    hear(&res);
    let status = res.status().as_u16();
    if status >= 500 {
        tracing::warn!("api {path}: the API answered {status}");
    }
    let body = res.json::<Value>().await.unwrap_or(Value::Null);
    Ok(Answer { status, body })
}

impl Auth {
    /// An API call from the app's own Rust side, signed by this Mac's avenDB device pass `pass` (`X-Avendb-Pass`: an
    /// admin of Maia City, as avenDB's server says, api/src/standing.ts): the status and the JSON body.
    pub async fn call_as(&self, method: &str, path: &str, body: Option<Value>, pass: &str) -> Result<(u16, Value), String> {
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut req = self.http.request(method, format!("{}{path}", api_base())).header("x-avendb-pass", pass);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.map_err(|e| format!("The API cannot be reached: {e}"))?;
        let status = res.status().as_u16();
        Ok((status, res.json().await.unwrap_or(Value::Null)))
    }
}

/// Only a Mac its person signed in to: every studio command checks this first.
pub fn signed_in() -> bool {
    load_session().is_some()
}
