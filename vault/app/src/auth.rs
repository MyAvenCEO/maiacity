//! Signing the app in with the admin's passkey — the device flow the terminals already use (api/src/keys.ts).
//!
//! Passkeys belong to maia.city, so the app cannot use one itself. It asks the API for a device code, opens the
//! approval page in the Mac's own browser, and waits; the admin approves there with the passkey, and the app
//! receives a key — its session, kept in a file only this user can read, never shown. Every API call the app makes goes out
//! from here with that key, so the studio's admin functions never run from a web page.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

const SERVICE: &str = "city.maia.studio";
/// What the studio needs: the media library, the content calendar it publishes to, and the economy sandbox (its runs,
/// configs and MIPs — the MCP proposes; only the admin accepts, on the page).
const SCOPE: &str = "media:admin,content:admin,economy:play,economy:admin";
/// A key must be able to do this to open the studio — the admin gate.
const GATE: &str = "/api/vault/join";

pub fn api_base() -> String {
    std::env::var("MAIACITY_API").unwrap_or_else(|_| "https://api.maia.city".into())
}

fn site_base() -> String {
    std::env::var("MAIACITY_SITE").unwrap_or_else(|_| "https://maia.city".into())
}

/// One key per API: production and a local API never share one.
fn account() -> String {
    api_base()
}

/// The session — the key the passkey approved — lives in the app's own folder, readable by this user only, like the
/// CLI's (~/.config/maiacity/media-keys.json). One key per API. (It was in the Keychain; every unsigned build made
/// macOS ask again, so it moves out once.)
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

fn load_key() -> Option<String> {
    if let Some(k) = sessions().get(&account()).and_then(|v| v.as_str()) {
        return Some(k.to_string());
    }
    // once: a key still in the Keychain moves into the file, and the Keychain entry goes
    let bytes = security_framework::passwords::get_generic_password(SERVICE, &account()).ok()?;
    let key = String::from_utf8(bytes).ok()?;
    if save_key(&key).is_ok() {
        security_framework::passwords::delete_generic_password(SERVICE, &account()).ok();
    }
    Some(key)
}

fn save_key(key: &str) -> Result<(), String> {
    let mut map = sessions();
    map.insert(account(), Value::String(key.to_string()));
    write_sessions(&map)
}

fn forget_key() {
    let mut map = sessions();
    map.remove(&account());
    write_sessions(&map).ok();
    security_framework::passwords::delete_generic_password(SERVICE, &account()).ok();
}

#[derive(Default, Clone)]
pub struct Auth {
    http: reqwest::Client,
}

#[derive(Serialize, Clone)]
pub struct AuthState {
    pub signed_in: bool,
    pub api: String,
    /// why not, in a sentence a person can read
    pub reason: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct DeviceStart {
    pub user_code: String,
    pub url: String,
    pub expires_in: u64,
}

#[derive(Deserialize)]
struct Started {
    device_code: String,
    user_code: String,
    expires_in: u64,
    interval: u64,
}

impl Auth {
    /// Does the key in the Keychain still open the studio? A revoked or foreign key is forgotten.
    async fn state(&self) -> AuthState {
        let api = api_base();
        let Some(key) = load_key() else {
            return AuthState { signed_in: false, api, reason: None };
        };
        match self.http.get(format!("{api}{GATE}")).bearer_auth(&key).send().await {
            Ok(r) if r.status().is_success() => AuthState { signed_in: true, api, reason: None },
            Ok(r) if r.status() == 401 || r.status() == 403 => {
                forget_key();
                AuthState { signed_in: false, api, reason: Some("This Mac's key no longer opens the studio.".into()) }
            }
            Ok(r) => AuthState { signed_in: false, api, reason: Some(format!("The API answered {}.", r.status())) },
            // offline: a key we hold stays good until the API says otherwise
            Err(_) => AuthState { signed_in: true, api, reason: Some("Offline — working from this Mac only.".into()) },
        }
    }
}

#[tauri::command]
pub async fn auth_status(auth: State<'_, Auth>) -> Result<AuthState, String> {
    Ok(auth.state().await)
}

/// Start the device flow: get a code, open the approval page in the browser, and wait for the key in the background.
/// The window hears `auth` when it arrives (or when the code expires).
#[tauri::command]
pub async fn auth_start(handle: AppHandle, auth: State<'_, Auth>) -> Result<DeviceStart, String> {
    let api = api_base();
    let label = format!("maiaCITY Studio · {}", host_name());
    let started: Started = auth
        .http
        .post(format!("{api}/api/device/start"))
        .json(&serde_json::json!({ "scope": SCOPE, "label": label }))
        .send()
        .await
        .map_err(|e| format!("The API cannot be reached: {e}"))?
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let url = format!("{}/app/device/?code={}", site_base(), started.user_code);
    std::process::Command::new("/usr/bin/open").arg(&url).spawn().ok();

    let http = auth.http.clone();
    let (device_code, interval, expires) = (started.device_code.clone(), started.interval.max(2), started.expires_in);
    tauri::async_runtime::spawn(async move {
        let deadline = std::time::Instant::now() + Duration::from_secs(expires);
        while std::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_secs(interval)).await;
            let Ok(r) = http.post(format!("{api}/api/device/token")).json(&serde_json::json!({ "device_code": device_code })).send().await
            else {
                continue;
            };
            match r.status().as_u16() {
                428 => continue, // not approved yet
                200 => {
                    let key = r.json::<Value>().await.ok().and_then(|v| v["key"].as_str().map(String::from));
                    let result = key.ok_or_else(|| "The API sent no key.".to_string()).and_then(|k| save_key(&k));
                    let state = match result {
                        Ok(()) => AuthState { signed_in: true, api: api.clone(), reason: None },
                        Err(e) => AuthState { signed_in: false, api: api.clone(), reason: Some(e) },
                    };
                    handle.emit("auth", state).ok();
                    return;
                }
                _ => break, // used, expired, unknown
            }
        }
        handle.emit("auth", AuthState { signed_in: false, api, reason: Some("The code expired. Start again.".into()) }).ok();
    });

    Ok(DeviceStart { user_code: started.user_code, url, expires_in: started.expires_in })
}

/// Sign this Mac out: the API revokes the key, and the Keychain forgets it.
#[tauri::command]
pub async fn auth_sign_out(auth: State<'_, Auth>) -> Result<AuthState, String> {
    if let Some(key) = load_key() {
        auth.http.delete(format!("{}/api/device/key", api_base())).bearer_auth(key).send().await.ok();
    }
    forget_key();
    Ok(auth.state().await)
}

/// What the API answered: its status and its JSON body — the page turns a refusal into the same error it always shows.
#[derive(Serialize)]
pub struct Answer {
    pub status: u16,
    pub body: Value,
}

/// The studio's calls to the API, made natively with the app's key (no browser cookie, no CORS).
#[tauri::command]
pub async fn api(auth: State<'_, Auth>, method: String, path: String, body: Option<Value>) -> Result<Answer, String> {
    if !path.starts_with("/api/") {
        return Err("Only the maiaCITY API.".into());
    }
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let mut req = auth.http.request(method, format!("{}{path}", api_base()));
    if let Some(key) = load_key() {
        req = req.bearer_auth(key);
    }
    if let Some(body) = body {
        req = req.json(&body);
    }
    let res = req.send().await.map_err(|e| format!("The API cannot be reached: {e}"))?;
    let status = res.status().as_u16();
    let body = res.json::<Value>().await.unwrap_or(Value::Null);
    Ok(Answer { status, body })
}

/// The economy sandbox's own brain on Samuel's GPU machine (Qwen, OpenAI-style, plain http over Tailscale): a page in
/// the app may not call plain http itself, so its asks go out natively. Only to this Mac or the tailnet, only `/v1/…`.
#[tauri::command]
pub async fn brain(auth: State<'_, Auth>, url: String, body: Option<Value>) -> Result<Answer, String> {
    let url = reqwest::Url::parse(&url).map_err(|e| e.to_string())?;
    let host = url.host_str().unwrap_or_default();
    // 100.64.0.0/10 is Tailscale's range
    let near = host == "localhost"
        || host.parse::<std::net::Ipv4Addr>().is_ok_and(|ip| ip.is_loopback() || (ip.octets()[0] == 100 && (ip.octets()[1] & 0xC0) == 64));
    if !matches!(url.scheme(), "http" | "https") || !near || !url.path().starts_with("/v1/") {
        return Err("Only a brain on this Mac or the tailnet (…/v1/…).".into());
    }
    let req = match body {
        Some(body) => auth.http.post(url).json(&body),
        None => auth.http.get(url),
    };
    let res = req.timeout(Duration::from_secs(90)).send().await.map_err(|e| format!("The brain cannot be reached: {e}"))?;
    let status = res.status().as_u16();
    let body = res.json::<Value>().await.unwrap_or(Value::Null);
    Ok(Answer { status, body })
}

/// `maiaapi://localhost/api/…` — a library file (or any GET) from the API with the app's key, Range passed through,
/// so <img>, <video> and fetch in the studio read the originals and proxies without a browser session.
pub async fn proxy(http: reqwest::Client, request: tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{Response, StatusCode, header};
    let fail = |status: StatusCode, msg: &str| Response::builder().status(status).body(msg.as_bytes().to_vec()).unwrap_or_default();
    let path = request.uri().path_and_query().map(|p| p.as_str().to_string()).unwrap_or_default();
    // the API, and the vault's gateway (files by hash)
    if !path.starts_with("/api/") && !path.starts_with("/vault/files/") {
        return fail(StatusCode::BAD_REQUEST, "only the API and the vault");
    }
    let Some(key) = load_key() else { return fail(StatusCode::UNAUTHORIZED, "sign in first") };
    let mut req = http.get(format!("{}{path}", api_base())).bearer_auth(key);
    if let Some(range) = request.headers().get(header::RANGE) {
        req = req.header(header::RANGE, range.clone());
    }
    let Ok(res) = req.send().await else { return fail(StatusCode::BAD_GATEWAY, "the API cannot be reached") };
    let mut out = Response::builder().status(res.status().as_u16()).header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    for name in [header::CONTENT_TYPE, header::CONTENT_LENGTH, header::CONTENT_RANGE, header::ACCEPT_RANGES, header::CACHE_CONTROL, header::ETAG] {
        if let Some(v) = res.headers().get(&name) {
            out = out.header(name, v.clone());
        }
    }
    let body = res.bytes().await.map(|b| b.to_vec()).unwrap_or_default();
    out.body(body).unwrap_or_default()
}

impl Auth {
    pub fn http(&self) -> reqwest::Client {
        self.http.clone()
    }

    /// An API call from the app's own Rust side, with its key: the status and the JSON body.
    pub async fn call(&self, method: &str, path: &str, body: Option<Value>) -> Result<(u16, Value), String> {
        let key = load_key().ok_or("Please sign in.")?;
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut req = self.http.request(method, format!("{}{path}", api_base())).bearer_auth(key);
        if let Some(b) = body {
            req = req.json(&b);
        }
        let res = req.send().await.map_err(|e| format!("The API cannot be reached: {e}"))?;
        let status = res.status().as_u16();
        Ok((status, res.json().await.unwrap_or(Value::Null)))
    }

    /// Like `call`, but a refusal is an error with the API's own sentence.
    pub async fn get_ok(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, String> {
        let (status, body) = self.call(method, path, body).await?;
        if status >= 400 {
            return Err(body["error"].as_str().map(String::from).unwrap_or_else(|| format!("The API answered {status}.")));
        }
        Ok(body)
    }
}

/// Only the admin passes: every vault and studio command checks this first.
pub fn signed_in() -> bool {
    load_key().is_some()
}

pub fn host_name() -> String {
    std::process::Command::new("/usr/sbin/scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "this Mac".into())
}

/// Open the approval page again in the Mac's browser (only maia.city pages).
#[tauri::command]
pub fn auth_open(url: String) -> Result<(), String> {
    if !url.starts_with(&format!("{}/app/device/", site_base())) {
        return Err("Only the approval page.".into());
    }
    std::process::Command::new("/usr/bin/open").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

