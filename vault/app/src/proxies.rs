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

use vault_media::proxy::WORKING;

/// Is there a colour journey from this source into ACEScct? (vault_media::cst — verified against OCIO)
pub fn journey(profile: &str) -> bool {
    vault_media::cst::journey(profile).is_some()
}

/// The colour detection's version: a file told "unknown" by an older one is read again (2: the sample description's
/// log atom — Apple Log 2 from the Blackmagic app and the iPhone).
const DETECTOR: u64 = 2;

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

/// How often a proxy is tried before it waits for a person (a decode that failed once — the Mac short of memory, a
/// card pulled — usually works the next time).
const TRIES: u64 = 3;

/// What holds this Mac's uploads now: "ingest", "proxy" (empty: nothing — files sync).
#[tauri::command]
pub fn vault_hold(app: tauri::State<'_, crate::App>) -> crate::Res<Vec<String>> {
    crate::gate()?;
    Ok(app.vault.hold.now())
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
    // what a run that ended midway left behind (the app quit, the Mac froze): half-made proxies, exported sources,
    // landing copies — nothing uses them now; the files themselves are taken up again below
    let started = std::time::SystemTime::now();
    for e in std::fs::read_dir(vault.ingest_dir()).into_iter().flatten().flatten() {
        let old = e.metadata().and_then(|m| m.modified()).is_ok_and(|t| t < started);
        let name = e.file_name().to_string_lossy().into_owned();
        if old && (name.ends_with(".proxy.mp4") || name.ends_with(".src") || name.ends_with(".part")) {
            tracing::info!("left from an earlier run, removed: {name}");
            std::fs::remove_file(e.path()).ok();
        }
    }
    loop {
        tokio::time::sleep(Duration::from_secs(20)).await;
        if crate::auth::signed_in() {
            if let Ok(all) = vault.catalog.list().await {
                for m in all.iter().filter(|m| wants_proxy(m)) {
                    let state = m.meta.get("proxy").and_then(|p| p.as_str()).unwrap_or("");
                    let made = state.len() == 64 && state.bytes().all(|b| b.is_ascii_hexdigit());
                    let profile = m.meta.pointer("/color/profile").and_then(|p| p.as_str()).unwrap_or("");
                    let detector = m.meta.pointer("/color/detector").and_then(|d| d.as_u64()).unwrap_or(0);
                    let tries = m.meta.get("proxy_tries").and_then(|t| t.as_u64()).unwrap_or(0);
                    // never tried, waiting for a journey that exists now, its colour unknown to an older detector, or
                    // failed fewer than TRIES times (healing by itself)
                    let due = state.is_empty()
                        || (state.starts_with("waiting") && (journey(profile) || (profile == "unknown" && detector < DETECTOR)))
                        || (state.starts_with("failed") && tries < TRIES);
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
    // an ingest first: every file in, then the proxies
    vault.hold.free_of("ingest").await;
    let result = {
        let _held = vault.hold.take("proxy");
        make(&vault, &hex, &name, source).await
    };
    clear(&hex);
    handle.emit("vault-proxy", json!({ "of": hex })).ok();
    if let Err(e) = result {
        tracing::warn!("proxy of {hex}: {e}");
        for left in [format!("{hex}.proxy.mp4"), format!("{hex}.src")] {
            std::fs::remove_file(vault.ingest_dir().join(left)).ok();
        }
        if let Ok(hash) = hex.parse::<iroh_blobs::Hash>() {
            let tries = vault.catalog.meta(hash).await.ok().flatten().and_then(|m| m.meta.get("proxy_tries").and_then(|t| t.as_u64())).unwrap_or(0) + 1;
            let note = if tries < TRIES { format!("failed: {e} — tried {tries} of {TRIES}, again by itself") } else { format!("failed: {e} — tried {TRIES} times, make it again by hand") };
            vault.catalog.describe(hash, &json!({ "meta": { "proxy": note, "proxy_tries": tries } })).await.ok();
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
        .describe(hash, &json!({ "meta": { "color": { "profile": told.profile, "from": told.from, "override": set_by_hand, "detector": DETECTOR }, "probe": probe } }))
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
    let (src, o, of, nm, pf) = (path.clone(), out.clone(), hex.to_string(), name.to_string(), profile.clone());
    tokio::task::spawn_blocking(move || vault_media::make_proxy(&src, &o, &pf, &mut |done| set(&of, &nm, "making", done)))
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
