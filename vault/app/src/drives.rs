//! Drives: an external disk as a vault device of its own — its own iroh node (its key and store on the disk), paired
//! like any device, in the shared catalog, under a store name. What it keeps each story decides: a story's rules name
//! the stores each class of its files is kept in (`Rules`: "avenSSD", "hetzner", a drive's name), so a drive keeps
//! every file whose story names it for that file's class. The catalog's small records sync by themselves; the files
//! it wants it fetches over iroh's blobs protocol from the devices that hold them (this Mac, beside it), each verified
//! against its BLAKE3 hash as it streams; then it holds them (pin + its `blobs/<hash>` entry). A deleted file, or one
//! its story no longer names it for, it lets go of (prune.rs / `purge`). The app's settings.json says only which
//! drives there are: `"drives": [{ "dir": "/Volumes/…/avenOS", "name": "SDD_A" }]`.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use vault_core::{Vault, catalog::CLASSES};

#[derive(Deserialize, Clone)]
struct Config {
    dir: PathBuf,
    /// its store name in the stories' rules
    name: String,
}

/// How a drive stands, for the studio and the agents.
#[derive(Serialize, Clone, Default)]
pub struct DriveState {
    pub dir: String,
    pub name: String,
    pub node: String,
    /// the stories that name it (titles)
    pub stories: Vec<String>,
    pub joined: bool,
    /// files it wants / holds, and their bytes
    pub wanted: usize,
    pub held: usize,
    pub wanted_bytes: u64,
    pub held_bytes: u64,
    /// what it is doing now, or why it waits
    pub now: String,
    pub errors: Vec<String>,
}

static STATES: LazyLock<Mutex<HashMap<String, DriveState>>> = LazyLock::new(Default::default);

fn update(dir: &str, f: impl FnOnce(&mut DriveState)) {
    f(STATES.lock().unwrap().entry(dir.to_string()).or_default());
}

fn configs() -> Vec<Config> {
    std::fs::read(crate::settings_file())
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| serde_json::from_value(v["drives"].clone()).ok())
        .unwrap_or_default()
}

/// Every configured drive whose disk is here: its node opened, joined, and kept complete for its stories.
pub async fn start(handle: AppHandle, mac: Arc<Vault>) {
    for cfg in configs() {
        let root = cfg.dir.parent().map(|p| p.to_path_buf()).unwrap_or_default();
        let key = cfg.dir.display().to_string();
        update(&key, |s| (s.dir, s.name) = (key.clone(), cfg.name.clone()));
        if !root.exists() {
            update(&key, |s| s.now = "its disk is not connected".into());
            continue;
        }
        let drive = match Vault::open(&cfg.dir).await {
            Ok(v) => Arc::new(v),
            Err(e) => {
                update(&key, |s| s.now = format!("cannot open its vault: {e:#}"));
                tracing::warn!("drive {key}: {e:#}");
                continue;
            }
        };
        update(&key, |s| s.node = drive.endpoint.id().to_string());
        tauri::async_runtime::spawn(keep(handle.clone(), mac.clone(), drive, cfg));
    }
}

async fn keep(handle: AppHandle, mac: Arc<Vault>, drive: Arc<Vault>, cfg: Config) {
    let key = cfg.dir.display().to_string();
    // side by side in one app: each knows where the other is, and lets it in
    drive.know(mac.endpoint.addr());
    mac.know(drive.endpoint.addr());
    mac.allow.add(drive.endpoint.id());
    let label = format!("drive {} · {}", cfg.name, cfg.dir.display());
    loop {
        if !crate::auth::signed_in() {
            update(&key, |s| s.now = "waiting for the passkey sign-in".into());
            tokio::time::sleep(Duration::from_secs(10)).await;
            continue;
        }
        let auth = handle.state::<crate::auth::Auth>();
        match crate::sync::connect_as(&drive, &auth, &label).await {
            Ok(n) if n.joined => {
                drive.allow.add(mac.endpoint.id());
                mac.allow.add(drive.endpoint.id());
                update(&key, |s| s.joined = true);
                if let Err(e) = round(&mac, &drive, &cfg).await {
                    update(&key, |s| s.errors = vec![format!("{e:#}")]);
                    tracing::warn!("drive {key}: {e:#}");
                }
            }
            Ok(n) => update(&key, |s| s.now = n.note.unwrap_or_default()),
            Err(e) => update(&key, |s| s.now = format!("cannot join: {e}")),
        }
        tokio::time::sleep(Duration::from_secs(60)).await;
    }
}

/// One pass: only the small records come down by themselves (never a file); every file its story keeps on this
/// drive that is not here yet is fetched over iroh from whoever holds it, verified as it streams, then held; a file
/// no story keeps here any more is let go of.
async fn round(mac: &Vault, drive: &Vault, cfg: &Config) -> anyhow::Result<()> {
    use iroh_docs::store::{DownloadPolicy, FilterKind};
    let key = cfg.dir.display().to_string();
    drive.catalog.doc().set_download_policy(DownloadPolicy::EverythingExcept(vec![FilterKind::Prefix("blobs/".into())])).await?;
    crate::prune::once(drive).await?;

    let stories = drive.catalog.stories().await?;
    let names_me = |r: &vault_core::catalog::Rules, class: &str| {
        let stores = match class {
            "original" => &r.original,
            "proxy" => &r.proxy,
            "delivery" => &r.delivery,
            _ => &r.default,
        };
        stores.iter().any(|s| s == &cfg.name)
    };
    let mine: HashMap<&str, &vault_core::catalog::Story> =
        stories.iter().filter(|st| CLASSES.iter().any(|c| names_me(&st.rules, c))).map(|st| (st.id.as_str(), st)).collect();
    update(&key, |s| s.stories = mine.values().map(|st| st.title.clone()).collect());
    let all = drive.catalog.list().await?;
    let wants = |m: &vault_core::Meta| mine.get(m.story.as_str()).is_some_and(|st| names_me(&st.rules, &m.class));
    // what it holds that no story keeps here any more: let go of (de-sync: the bytes go when GC runs)
    for m in all.iter().filter(|m| !wants(m)) {
        let hash: iroh_blobs::Hash = m.hash.parse()?;
        if drive.catalog.holds(hash).await? {
            drive.catalog.purge(hash).await?;
            tracing::info!("drive {key}: let go of {} (its story keeps it elsewhere)", m.original_name);
        }
    }
    let wanted: Vec<_> = all.iter().filter(|m| wants(m)).collect();
    let (wanted_n, wanted_bytes) = (wanted.len(), wanted.iter().map(|m| m.size).sum::<u64>());
    // who serves it: this Mac beside it (the server keeps its copies in Object Storage, not on iroh)
    let providers = vec![mac.endpoint.id()];
    let downloader = drive.store.downloader(&drive.endpoint);
    let (mut held, mut held_bytes, mut errors) = (0usize, 0u64, Vec::new());
    for m in wanted {
        let hash: iroh_blobs::Hash = m.hash.parse()?;
        let here = matches!(drive.store.blobs().status(hash).await?, iroh_blobs::api::blobs::BlobStatus::Complete { .. });
        if !here {
            update(&key, |s| s.now = format!("fetching {} ({:.1} MB)", m.original_name, m.size as f64 / 1e6));
            if let Err(e) = downloader.download(hash, providers.clone()).await {
                errors.push(format!("{}: {e:#}", m.original_name));
                continue;
            }
        }
        if !drive.catalog.holds(hash).await? {
            drive.catalog.hold(hash, m.size).await?;
        }
        held += 1;
        held_bytes += m.size;
        update(&key, |s| (s.wanted, s.held, s.wanted_bytes, s.held_bytes) = (wanted_n, held, wanted_bytes, held_bytes));
    }
    let done = held == wanted_n;
    update(&key, |s| {
        (s.wanted, s.held, s.wanted_bytes, s.held_bytes) = (wanted_n, held, wanted_bytes, held_bytes);
        s.now = if done { "complete: every file of its stories here, verified".into() } else { format!("{} files still to come", wanted_n - held) };
        s.errors = errors.into_iter().take(10).collect();
    });
    tracing::info!("drive {key}: {held}/{wanted_n} files held ({:.2} GB)", held_bytes as f64 / 1e9);
    Ok(())
}

/// A drive's store name, by its node id (what the transfers show as the destination).
pub fn name_of(node: &str) -> Option<String> {
    STATES.lock().unwrap().values().find(|s| s.node == node).map(|s| s.name.clone())
}

/// Every drive and how it stands.
#[tauri::command]
pub fn drives_status() -> Result<Vec<DriveState>, String> {
    crate::gate()?;
    Ok(STATES.lock().unwrap().values().cloned().collect())
}
