//! This Mac in the vault's network: pairing with the API (the passkey already approved this app), joining the shared
//! catalog with the server peer, and — for the studio — where every file's copies are and whether they are verified.
//!
//! Files flow by themselves once joined: the catalog replicates over iroh-docs, this node fetches every file it lacks
//! from the paired peers that have it (iroh-blobs, verified), and the server pulls what this Mac ingested into Object
//! Storage. What only the server holds (a web upload, a file from another Mac that went offline) comes down from its
//! gateway and is checked against its hash before the store takes it.

use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use iroh_blobs::{BlobFormat, Hash, api::{blobs::AddPathOptions, proto::{BlobStatus, ImportMode}}};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};
use tokio::io::AsyncWriteExt;
use vault_core::{Join, Vault};

use crate::{App, Res, auth::{self, Auth}, err, gate};

#[derive(Serialize, Clone)]
pub struct Network {
    pub node: String,
    pub server: Option<String>,
    pub catalog: String,
    pub devices: usize,
    pub joined: bool,
    pub note: Option<String>,
}

/// Pair this Mac's node with the API and join the vault's network. Safe to call again (it only refreshes).
#[tauri::command]
pub async fn vault_connect(app: State<'_, App>, auth: State<'_, Auth>) -> Res<Network> {
    gate()?;
    connect(&app.vault, &auth).await
}

pub async fn connect(vault: &Vault, auth: &Auth) -> Res<Network> {
    let me = vault.endpoint.id().to_string();
    let label = format!("maiaCITY Studio · {}", auth::host_name());
    auth.get_ok("POST", "/api/vault/devices", Some(json!({ "endpoint_id": me, "label": label }))).await?;
    let join = auth.get_ok("GET", "/api/vault/join", None).await?;
    let (Some(ticket), Some(relay)) = (join["catalog"].as_str(), join["relay"].as_str()) else {
        return Ok(Network {
            node: me,
            server: None,
            catalog: vault.catalog.id().to_string(),
            devices: 0,
            joined: false,
            note: Some("The server peer has not started yet — this Mac keeps working on its own.".into()),
        });
    };
    let devices: Vec<iroh::EndpointId> = auth
        .get_ok("GET", "/api/vault/devices", None)
        .await?
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|d| d["revoked_at"].is_null())
                .filter_map(|d| d["endpoint_id"].as_str()?.parse().ok())
                .filter(|id: &iroh::EndpointId| id.to_string() != me)
                .collect()
        })
        .unwrap_or_default();
    let count = devices.len();
    if let Some(server) = join["server"].as_str() {
        *SERVER.lock().unwrap() = server.to_string();
    }
    vault
        .join(Join { ticket: ticket.parse().map_err(err)?, relay: relay.parse().map_err(err)?, devices })
        .await
        .map_err(err)?;
    Ok(Network {
        node: me,
        server: join["server"].as_str().map(String::from),
        catalog: vault.catalog.id().to_string(),
        devices: count,
        joined: true,
        note: None,
    })
}

/// The server peer's node id, from the last join: its pulls are the uploads to Object Storage.
static SERVER: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// One file on its way, as the studio shows it: which destination, how far, how fast.
#[derive(Serialize)]
pub struct Moving {
    pub hash: String,
    /// avenSSD (coming down to this Mac), hetzner (the server pulling it into Object Storage), or a device
    pub dest: String,
    pub size: u64,
    pub sent: u64,
    pub rate: f64,
    pub done: bool,
    pub aborted: bool,
}

/// Every file on its way to or from this Mac right now, and what ended in the last minute — live, from iroh.
#[tauri::command]
pub fn vault_transfers(app: State<'_, App>) -> Res<Vec<Moving>> {
    gate()?;
    let server = SERVER.lock().unwrap().clone();
    let dests = |to: &str| {
        if to == "avenSSD" {
            "avenSSD".to_string()
        } else if !server.is_empty() && to == server {
            "hetzner".to_string()
        } else {
            format!("device {}", &to[..to.len().min(10)])
        }
    };
    let mut out: Vec<Moving> = app
        .vault
        .transfers
        .now()
        .into_iter()
        .map(|t| Moving { dest: dests(&t.to), hash: t.hash, size: t.size, sent: t.sent, rate: t.rate, done: t.done, aborted: t.aborted })
        .collect();
    out.sort_by(|a, b| a.done.cmp(&b.done).then(b.sent.cmp(&a.sent)));
    Ok(out)
}

/// Where a file's copies are.
#[derive(Serialize, Clone)]
pub struct Copies {
    pub hash: String,
    pub name: String,
    pub size: u64,
    pub kind: String,
    /// this Mac's store: "verified" (complete, checked on the way in), "partial" (arriving), "missing"
    pub here: String,
    pub here_bytes: u64,
    /// the server peer (Object Storage): "stored" (in the bucket, pulled verified), "syncing", "unknown"
    pub server: String,
    /// where this Mac keeps it
    pub location: String,
}

#[tauri::command]
pub async fn vault_copies(app: State<'_, App>, auth: State<'_, Auth>) -> Res<Vec<Copies>> {
    gate()?;
    let v = &app.vault;
    // what the server holds, from its mirror (unreachable API: we only know this Mac)
    let server: HashMap<String, bool> = auth
        .get_ok("GET", "/api/vault/files", None)
        .await
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|a| a.iter().filter_map(|f| Some((f["hash"].as_str()?.to_string(), f["stored"].as_bool().unwrap_or(false)))).collect())
        .unwrap_or_default();
    let mut out = Vec::new();
    for m in v.catalog.list().await.map_err(err)? {
        let hash: Hash = m.hash.parse().map_err(err)?;
        let (here, here_bytes) = match v.store.blobs().status(hash).await {
            Ok(BlobStatus::Complete { size }) => ("verified", size),
            Ok(BlobStatus::Partial { size }) => ("partial", size.unwrap_or(0)),
            _ => ("missing", 0),
        };
        let server_state = match server.get(&m.hash) {
            Some(true) => "stored",
            Some(false) => "syncing",
            None => "unknown",
        };
        out.push(Copies {
            name: if m.title.is_empty() { m.original_name.clone() } else { m.title.clone() },
            hash: m.hash,
            size: m.size,
            kind: m.kind,
            here: here.into(),
            here_bytes,
            server: server_state.into(),
            location: v.dir.display().to_string(),
        });
    }
    Ok(out)
}

/// 75 % of the uplink measured on 2026-09-29 (54 Mbit/s ≈ 6.8 MB/s).
const DAY_LIMIT: u64 = 5_100_000;

/// 08:00–22:00 local time.
fn daytime() -> bool {
    // SAFETY: localtime_r fills the struct from a valid time_t.
    let hour = unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        libc::localtime_r(&now, &mut tm);
        tm.tm_hour
    };
    (8..22).contains(&hour)
}

/// Keep this Mac complete: every file the catalog names that is not here and that the server holds comes down from
/// the gateway, is checked against its hash, and only then goes into the store. Runs in the background.
pub async fn keep_complete(handle: AppHandle, vault: Arc<Vault>) {
    use tauri::Manager;
    loop {
        tokio::time::sleep(Duration::from_secs(30)).await;
        if !auth::signed_in() {
            continue;
        }
        // uploads by day leave room for everything else on the line: ~75 % of the 54 Mbit/s measured; at night, all of it
        vault.upload_limit.store(if daytime() { DAY_LIMIT } else { 0 }, std::sync::atomic::Ordering::Relaxed);
        if let Some(why) = vault.heal().await {
            tracing::warn!("vault network: relay lost ({why}) — looking at the network again");
        }
        let auth = handle.state::<Auth>();
        // stay joined: a sync that failed (the server restarting, the network away) is simply tried again; this also
        // picks up newly paired devices and revocations
        if let Err(e) = connect(&vault, &auth).await {
            tracing::warn!("vault network: {e}");
        }
        // how the uploads move, in iroh's own numbers — every 30 s while anything is being sent
        if vault.transfers.now().iter().any(|t| !t.done && !t.aborted) {
            for l in vault.allow.links() {
                tracing::info!("upload link: {l}");
            }
        }
        // local work first: nothing is fetched while an ingest or a proxy runs
        if !vault.hold.now().is_empty() {
            continue;
        }
        let Ok(files) = auth.get_ok("GET", "/api/vault/files", None).await else { continue };
        for f in files.as_array().cloned().unwrap_or_default() {
            if !vault.hold.now().is_empty() {
                break;
            }
            let (Some(hex), true) = (f["hash"].as_str(), f["stored"].as_bool().unwrap_or(false)) else { continue };
            let Ok(hash) = hex.parse::<Hash>() else { continue };
            if matches!(vault.store.blobs().status(hash).await, Ok(BlobStatus::Complete { .. })) {
                continue;
            }
            match fetch_from_gateway(&vault, &auth, hash).await {
                Ok(()) => {
                    handle.emit("vault-sync", json!({ "hash": hex, "here": "verified" })).ok();
                }
                Err(e) => tracing::warn!("{hex}: {e}"),
            }
        }
    }
}

async fn fetch_from_gateway(vault: &Vault, auth: &Auth, hash: Hash) -> Result<(), String> {
    let key = auth::load_key_pub().ok_or("not signed in")?;
    let url = format!("{}/vault/files/{}", auth::api_base(), hash.to_hex());
    let mut res = auth.http().get(url).bearer_auth(key).send().await.map_err(err)?;
    if !res.status().is_success() {
        return Err(format!("gateway answered {}", res.status()));
    }
    let landing: PathBuf = vault.ingest_dir().join(format!("{}.down", hash.to_hex()));
    let mut file = tokio::fs::File::create(&landing).await.map_err(err)?;
    let mut hasher = blake3::Hasher::new();
    // coming down to this Mac's store: followed like every other transfer
    let size = res.content_length().unwrap_or(0);
    let moving = &vault.transfers;
    moving.update(hash, "avenSSD", |t| (t.size, t.sent, t.done, t.aborted, t.ended) = (size, 0, false, false, None));
    let mut got = 0u64;
    while let Some(chunk) = match res.chunk().await {
        Ok(c) => c,
        Err(e) => {
            moving.update(hash, "avenSSD", |t| (t.aborted, t.ended) = (true, Some(std::time::Instant::now())));
            return Err(err(e));
        }
    } {
        hasher.update(&chunk);
        file.write_all(&chunk).await.map_err(err)?;
        got += chunk.len() as u64;
        moving.update(hash, "avenSSD", |t| t.sent = got);
    }
    moving.update(hash, "avenSSD", |t| (t.done, t.ended) = (true, Some(std::time::Instant::now())));
    file.sync_all().await.map_err(err)?;
    drop(file);
    // the name is the hash: anything else is refused
    if Hash::from(*hasher.finalize().as_bytes()) != hash {
        tokio::fs::remove_file(&landing).await.ok();
        return Err("the bytes from the gateway do not match their hash".into());
    }
    let tag = vault
        .store
        .blobs()
        .add_path_with_opts(AddPathOptions { path: landing.clone(), format: BlobFormat::Raw, mode: ImportMode::Copy })
        .with_named_tag(format!("vault/{}", hash.to_hex()))
        .await
        .map_err(err)?;
    tokio::fs::remove_file(&landing).await.ok();
    if tag.hash != hash {
        return Err("the store disagrees with the hash".into());
    }
    Ok(())
}
