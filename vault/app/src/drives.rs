//! Drives: an external disk as a vault store of its own — its own iroh node (its key and store on the disk), paired
//! like any device, in the shared catalog, under a store name. What it keeps each story decides (`keep.rs`: the same
//! pass as this Mac's): the records sync by themselves, the files its stories name it for come over iroh from the
//! peers (this Mac beside it first), verified, pinned and announced; what it no longer keeps it lets go of. The app's
//! settings.json says only which drives there are: `"drives": [{ "dir": "/Volumes/…/avenOS", "name": "SDD_A" }]`.

use std::{path::PathBuf, sync::Arc, time::Duration};

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use vault_core::Vault;

use crate::keep::update;

#[derive(Deserialize, Clone)]
struct Config {
    dir: PathBuf,
    /// its store name in the stories' rules
    name: String,
}

fn configs() -> Vec<Config> {
    std::fs::read(crate::settings_file())
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| serde_json::from_value(v["drives"].clone()).ok())
        .unwrap_or_default()
}

/// Every configured drive whose disk is here: its node opened, joined, and kept by its stories' rules.
pub async fn start(handle: AppHandle, mac: Arc<Vault>) {
    for cfg in configs() {
        let root = cfg.dir.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        update(&cfg.name, |s| s.dir = cfg.dir.display().to_string());
        if !root.exists() {
            update(&cfg.name, |s| s.now = "its disk is not connected".into());
            continue;
        }
        let drive = match Vault::open(&cfg.dir).await {
            Ok(v) => Arc::new(v),
            Err(e) => {
                update(&cfg.name, |s| s.now = format!("cannot open its vault: {e:#}"));
                tracing::warn!("drive {}: {e:#}", cfg.name);
                continue;
            }
        };
        update(&cfg.name, |s| s.node = drive.endpoint.id().to_string());
        tauri::async_runtime::spawn(run(handle.clone(), mac.clone(), drive, cfg));
    }
}

async fn run(handle: AppHandle, mac: Arc<Vault>, drive: Arc<Vault>, cfg: Config) {
    let name = cfg.name.clone();
    // side by side in one app: each knows where the other is, and lets it in
    drive.know(mac.endpoint.addr());
    mac.know(drive.endpoint.addr());
    mac.allow.add(drive.endpoint.id());
    let label = format!("drive {} · {}", cfg.name, cfg.dir.display());
    loop {
        if !crate::auth::signed_in() {
            update(&name, |s| s.now = "waiting for the passkey sign-in".into());
            tokio::time::sleep(Duration::from_secs(10)).await;
            continue;
        }
        let auth = handle.state::<crate::auth::Auth>();
        match crate::sync::connect_as(&drive, &auth, &label).await {
            Ok(n) if n.joined => {
                drive.allow.add(mac.endpoint.id());
                mac.allow.add(drive.endpoint.id());
                // and the catalog straight from this Mac beside it (iroh-docs sync, peer to peer), not only via the server
                if let Err(e) = drive.catalog.doc().start_sync(vec![mac.endpoint.addr()]).await {
                    tracing::warn!("drive {name}: catalog sync with this Mac: {e:#}");
                }
                update(&name, |s| s.joined = true);
                // who serves it: this Mac beside it first, then every peer it lets in (the server, other devices)
                let mut providers = vec![mac.endpoint.id()];
                providers.extend(drive.allow.ids().into_iter().filter(|id| *id != mac.endpoint.id()));
                if let Err(e) = crate::keep::round(&drive, &name, &providers).await {
                    update(&name, |s| s.errors = vec![format!("{e:#}")]);
                    tracing::warn!("drive {name}: {e:#}");
                }
            }
            Ok(n) => update(&name, |s| s.now = n.note.unwrap_or_default()),
            Err(e) => update(&name, |s| s.now = format!("cannot join: {e}")),
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}
