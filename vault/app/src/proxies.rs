//! Proxies, always: every video original gets its HD proxy, in the studio's one working space (ACEScct) — its colour
//! told from the file (game/film/color.js's rules), taken through its colour journey into ACEScct, encoded natively
//! (VideoToolbox, HEVC Main10) and put into the vault as the original's proxy: in the same story, class proxy, both
//! described, both synced like everything else. The display transform is never part of a proxy — it belongs to the
//! screen or the delivery. A source whose colour cannot be told, or whose journey is not defined yet, waits and says
//! so; the sweep makes its proxy by itself the day its journey exists.
//!
//! One proxy at a time (the encoder is the Mac's); each says how far it is.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter};
use vault_core::{Meta, Vault, ingest::Batch};

/// The working space every proxy is in.
const WORKING: &str = "acescct";

/// Is there a colour journey from this source into ACEScct? (A source already in ACEScct needs none.)
pub fn journey(profile: &str) -> bool {
    profile == WORKING
}

/// A proxy being made or waiting its turn, as the studio shows it.
#[derive(Serialize, Clone)]
pub struct Making {
    /// the original's hash
    pub of: String,
    pub name: String,
    /// queued · probing · making · adding
    pub stage: String,
    /// 0…1 while making
    pub done: f64,
}

static NOW: Mutex<Option<HashMap<String, Making>>> = Mutex::new(None);
/// one proxy at a time
static TURN: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);

fn set(of: &str, name: &str, stage: &str, done: f64) {
    NOW.lock().unwrap().get_or_insert_with(HashMap::new).insert(of.into(), Making { of: of.into(), name: name.into(), stage: stage.into(), done });
}
fn clear(of: &str) {
    if let Some(m) = NOW.lock().unwrap().as_mut() {
        m.remove(of);
    }
}

/// The proxies being made or queued right now.
#[tauri::command]
pub fn proxies_now() -> crate::Res<Vec<Making>> {
    crate::gate()?;
    Ok(NOW.lock().unwrap().as_ref().map(|m| m.values().cloned().collect()).unwrap_or_default())
}

/// A film's proxy made again (its colour read again too), from the vault's own copy.
#[tauri::command]
pub async fn vault_proxy(handle: AppHandle, app: tauri::State<'_, crate::App>, hash: String) -> crate::Res<()> {
    crate::gate()?;
    tauri::async_runtime::spawn(auto_proxy(handle, app.vault.clone(), hash, PathBuf::new()));
    Ok(())
}

/// Does this file get a proxy? A video that is an original (not a proxy, not a delivery, not a working file).
pub fn wants_proxy(m: &Meta) -> bool {
    m.kind == "video" && m.class == "original"
}

/// Every original still without its proxy, queued — at the start, and every ten minutes: a journey defined since, a
/// file that came in on another device.
pub async fn sweep(handle: AppHandle, vault: Arc<Vault>) {
    loop {
        tokio::time::sleep(Duration::from_secs(20)).await;
        if crate::auth::signed_in() {
            if let Ok(all) = vault.catalog.list().await {
                for m in all.iter().filter(|m| wants_proxy(m)) {
                    let state = m.meta.get("proxy").and_then(|p| p.as_str()).unwrap_or("");
                    let made = state.len() == 64 && state.bytes().all(|b| b.is_ascii_hexdigit());
                    let profile = m.meta.pointer("/color/profile").and_then(|p| p.as_str()).unwrap_or("");
                    // never tried, or waiting for a journey that exists now
                    let due = state.is_empty() || (state.starts_with("waiting") && journey(profile));
                    let queued = NOW.lock().unwrap().as_ref().is_some_and(|n| n.contains_key(&m.hash));
                    if !made && due && !queued {
                        tauri::async_runtime::spawn(auto_proxy(handle.clone(), vault.clone(), m.hash.clone(), PathBuf::new()));
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(600)).await;
    }
}

pub async fn auto_proxy(handle: AppHandle, vault: Arc<Vault>, hex: String, source: PathBuf) {
    let name = match hex.parse::<iroh_blobs::Hash>() {
        Ok(h) => vault.catalog.meta(h).await.ok().flatten().map(|m| m.original_name).unwrap_or_default(),
        Err(_) => return,
    };
    set(&hex, &name, "queued", 0.0);
    let _turn = TURN.acquire().await;
    let result = make(&vault, &hex, &name, source).await;
    clear(&hex);
    handle.emit("vault-proxy", json!({ "of": hex })).ok();
    if let Err(e) = result {
        tracing::warn!("proxy of {hex}: {e}");
        if let Ok(hash) = hex.parse() {
            vault.catalog.describe(hash, &json!({ "meta": { "proxy": format!("failed: {e}") } })).await.ok();
        }
    }
}

async fn make(vault: &Vault, hex: &str, name: &str, source: PathBuf) -> Result<(), String> {
    let hash: iroh_blobs::Hash = hex.parse().map_err(|e| format!("{e}"))?;
    let original = vault.catalog.meta(hash).await.map_err(|e| format!("{e:#}"))?.ok_or("no such file")?;
    set(hex, name, "probing", 0.0);
    // the source while the card is still there; else the vault's own copy
    let path = if source.exists() {
        source
    } else {
        let p = vault.ingest_dir().join(format!("{hex}.src"));
        vault.store.blobs().export(hash, &p).await.map_err(|e| format!("{e:#}"))?;
        p
    };
    let cleanup = |p: &PathBuf| {
        if p.extension().is_some_and(|e| e == "src") {
            std::fs::remove_file(p).ok();
        }
    };
    let probe_path = path.clone();
    let probe = tokio::task::spawn_blocking(move || vault_media::probe(&probe_path)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
    // a colour set by hand stays; else it is told from the file
    let told = vault_media::detect(&probe);
    let set_by_hand = original.meta.pointer("/color/override").and_then(|v| v.as_str()).map(String::from);
    let profile = set_by_hand.clone().unwrap_or_else(|| told.profile.clone());
    vault
        .catalog
        .describe(hash, &json!({ "meta": { "color": { "profile": told.profile, "from": told.from, "override": set_by_hand }, "probe": probe } }))
        .await
        .map_err(|e| format!("{e:#}"))?;
    if profile == "unknown" {
        cleanup(&path);
        vault.catalog.describe(hash, &json!({ "meta": { "proxy": "waiting: its colour cannot be told — set it by hand, or add a colour journey for this kind of source" } })).await.ok();
        return Ok(());
    }
    if !journey(&profile) {
        cleanup(&path);
        vault.catalog.describe(hash, &json!({ "meta": { "proxy": format!("waiting: no colour journey from {profile} into ACEScct yet") } })).await.ok();
        return Ok(());
    }

    set(hex, name, "making", 0.0);
    let out = vault.ingest_dir().join(format!("{hex}.proxy.mp4"));
    let (src, o, of, nm) = (path.clone(), out.clone(), hex.to_string(), name.to_string());
    tokio::task::spawn_blocking(move || vault_media::make_proxy(&src, &o, WORKING, &mut |done| set(&of, &nm, "making", done)))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    set(hex, name, "adding", 1.0);
    // the proxy lives beside its original: the same story, class proxy
    let stem = std::path::Path::new(name).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| hex[..12].to_string());
    let named = vault.ingest_dir().join(format!("{stem}.proxy.mp4"));
    std::fs::rename(&out, &named).map_err(|e| e.to_string())?;
    let batch = Batch {
        session: format!("proxy of {hex}"),
        tags: vec!["proxy".into()],
        meta: json!({ "role": "proxy", "proxy_of": hex, "color": { "profile": WORKING, "from": "our own tag", "journey_from": profile } }),
        story: Some(original.story.clone()).filter(|s| !s.is_empty()),
        class: Some("proxy".into()),
        ..Default::default()
    };
    let made = vault.ingest_file(&named, &batch).await.map_err(|e| format!("{e:#}"))?;
    std::fs::remove_file(&named).ok();
    cleanup(&path);
    vault.catalog.describe(hash, &json!({ "meta": { "proxy": made.hash } })).await.map_err(|e| format!("{e:#}"))?;
    Ok(())
}
