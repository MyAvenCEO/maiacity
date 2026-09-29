//! Signing the app in with the admin's passkey — the device flow the terminals already use (api/src/keys.ts).
//!
//! Passkeys belong to maia.city, so the app cannot use one itself. It asks the API for a device code, opens the
//! approval page in the Mac's own browser, and waits; the admin approves there with the passkey, and the app
//! receives a key — kept in the macOS Keychain, never in a file, never shown. Every API call the app makes goes out
//! from here with that key, so the studio's admin functions never run from a web page.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

const SERVICE: &str = "city.maia.studio";
/// What the studio needs: the media library, and the content calendar it publishes to.
const SCOPE: &str = "media:admin,content:admin";
/// A key must be able to do this to open the studio — the admin gate.
const GATE: &str = "/api/media?kind=__gate__";

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

fn load_key() -> Option<String> {
    let bytes = security_framework::passwords::get_generic_password(SERVICE, &account()).ok()?;
    String::from_utf8(bytes).ok()
}

fn save_key(key: &str) -> Result<(), String> {
    security_framework::passwords::set_generic_password(SERVICE, &account(), key.as_bytes()).map_err(|e| e.to_string())
}

fn forget_key() {
    security_framework::passwords::delete_generic_password(SERVICE, &account()).ok();
}

#[derive(Default)]
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

/// The studio's calls to the API, made natively with the app's key (no browser cookie, no CORS).
#[tauri::command]
pub async fn api(auth: State<'_, Auth>, method: String, path: String, body: Option<Value>) -> Result<Value, String> {
    if !path.starts_with("/api/") {
        return Err("Only the maiaCITY API.".into());
    }
    let key = load_key().ok_or("Please sign in.")?;
    let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).map_err(|e| e.to_string())?;
    let mut req = auth.http.request(method, format!("{}{path}", api_base())).bearer_auth(key);
    if let Some(body) = body {
        req = req.json(&body);
    }
    let res = req.send().await.map_err(|e| format!("The API cannot be reached: {e}"))?;
    let status = res.status();
    let value: Value = res.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        return Err(value["error"].as_str().map(String::from).unwrap_or_else(|| format!("The API answered {status}.")));
    }
    Ok(value)
}

/// Only the admin passes: every vault and studio command checks this first.
pub fn signed_in() -> bool {
    load_key().is_some()
}

fn host_name() -> String {
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
