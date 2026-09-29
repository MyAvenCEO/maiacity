//! Proxies by themselves: after an ingest, every new movie is probed (AVFoundation), its colour told the way
//! game/film/color.js tells it, and its HD proxy made natively (VideoToolbox) and put into the vault as the proxy of
//! the original — both described, both synced like everything else. A file whose proxy needs a colour transform
//! (HDR, linear light → ACEScct) or whose colour cannot be told waits, and says why.

use std::{path::PathBuf, sync::Arc};

use serde_json::json;
use tauri::{AppHandle, Emitter};
use vault_core::{Vault, ingest::Batch};

pub async fn auto_proxy(handle: AppHandle, vault: Arc<Vault>, hex: String, source: PathBuf) {
    if let Err(e) = make(&handle, &vault, &hex, source).await {
        tracing::warn!("proxy of {hex}: {e}");
        let hash = hex.parse();
        if let Ok(hash) = hash {
            vault.catalog.describe(hash, &json!({ "meta": { "proxy": format!("failed: {e}") } })).await.ok();
        }
    }
}

async fn make(handle: &AppHandle, vault: &Vault, hex: &str, source: PathBuf) -> Result<(), String> {
    let hash: iroh_blobs::Hash = hex.parse().map_err(|e| format!("{e}"))?;
    // the source while the card is still there; else the vault's own copy
    let path = if source.exists() {
        source
    } else {
        let p = vault.ingest_dir().join(format!("{hex}.src"));
        vault.store.blobs().export(hash, &p).await.map_err(|e| format!("{e:#}"))?;
        p
    };
    let probe_path = path.clone();
    let probe = tokio::task::spawn_blocking(move || vault_media::probe(&probe_path)).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
    let color = vault_media::detect(&probe);
    let target = vault_media::proxy_profile(&color.profile);
    vault
        .catalog
        .describe(hash, &json!({ "meta": { "color": { "profile": color.profile, "from": color.from }, "probe": probe } }))
        .await
        .map_err(|e| format!("{e:#}"))?;
    if target == "unknown" {
        vault.catalog.describe(hash, &json!({ "meta": { "proxy": "waiting: its colour cannot be told — set it in the studio" } })).await.ok();
        return Ok(());
    }
    if vault_media::proxy_needs_transform(&color.profile) {
        vault.catalog.describe(hash, &json!({ "meta": { "proxy": "waiting: needs the colour transform into ACEScct (native transforms)" } })).await.ok();
        return Ok(());
    }

    let out = vault.ingest_dir().join(format!("{hex}.proxy.mp4"));
    let (src, o, profile) = (path.clone(), out.clone(), target.to_string());
    tokio::task::spawn_blocking(move || vault_media::make_proxy(&src, &o, &profile, &mut |_| {}))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))?;
    let batch = Batch {
        session: format!("proxy of {hex}"),
        tags: vec!["proxy".into()],
        meta: json!({ "role": "proxy", "proxy_of": hex, "color": { "profile": target, "from": "our own tag" } }),
        ..Default::default()
    };
    let made = vault.ingest_file(&out, &batch).await.map_err(|e| format!("{e:#}"))?;
    std::fs::remove_file(&out).ok();
    if path.extension().is_some_and(|e| e == "src") {
        std::fs::remove_file(&path).ok();
    }
    vault.catalog.describe(hash, &json!({ "meta": { "proxy": made.hash } })).await.map_err(|e| format!("{e:#}"))?;
    handle.emit("vault-proxy", json!({ "of": hex, "proxy": made.hash })).ok();
    Ok(())
}
