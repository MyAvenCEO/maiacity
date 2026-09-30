//! This Mac in the vault's network: pairing with the API (the passkey already approved this app), joining the shared
//! catalog with the server peer, and — for the studio — where every file's copies are and whether they are verified.
//!
//! Files flow by themselves once joined: the catalog replicates over iroh-docs, this node fetches every file it lacks
//! from the paired peers that have it (iroh-blobs, verified), and the server pulls what this Mac ingested into Object
//! Storage. What only the server holds (a web upload, a file from another Mac that went offline) comes down from its
//! gateway and is checked against its hash before the store takes it.

use std::{sync::Arc, time::Duration};

use iroh_blobs::{Hash, api::proto::BlobStatus};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, State};
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
    connect_as(vault, auth, &format!("maiaCITY Studio · {}", auth::host_name())).await
}

/// Pair a node (this Mac's, or a drive's) under a label and join the vault's network with it.
pub async fn connect_as(vault: &Vault, auth: &Auth, label: &str) -> Res<Network> {
    let me = vault.endpoint.id().to_string();
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
    // which author's entries are Object Storage's: a record of the catalog (`store/hetzner`), known offline too
    if let (Some(author), Some(server)) = (join["author"].as_str(), join["server"].as_str()) {
        let record = json!({ "author": author, "node": server });
        vault.catalog.put_store_record("hetzner", &record).await.map_err(err)?;
    }
    std::fs::remove_file(vault.dir.join("server.author")).ok();
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
        } else if let Some(name) = crate::keep::name_of(to) {
            name
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

/// The files Object Storage holds: the server author's `blobs/<hash>` entries in this Mac's replica of the catalog.
/// None until this Mac has joined once (it learns which author is the server's then).
pub async fn held_by_server(v: &Vault) -> Option<std::collections::HashSet<String>> {
    let record = v.catalog.store_record("hetzner").await.ok()??;
    let author: iroh_docs::AuthorId = record["author"].as_str()?.parse().ok()?;
    v.catalog.held_by(author).await.ok()
}

#[tauri::command]
pub async fn vault_copies(app: State<'_, App>, auth: State<'_, Auth>) -> Res<Vec<Copies>> {
    gate()?;
    let v = &app.vault;
    // what Object Storage holds: the server's own entries in this Mac's replica of the catalog (offline too)
    let _ = &auth;
    let held = held_by_server(v).await;
    let mut out = Vec::new();
    for m in v.catalog.list().await.map_err(err)? {
        let hash: Hash = m.hash.parse().map_err(err)?;
        let (here, here_bytes) = match v.store.blobs().status(hash).await {
            Ok(BlobStatus::Complete { size }) => ("verified", size),
            Ok(BlobStatus::Partial { size }) => ("partial", size.unwrap_or(0)),
            _ => ("missing", 0),
        };
        let server_state = match &held {
            Some(h) if h.contains(&m.hash) => "stored",
            Some(_) => "syncing",
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

/// Keep this Mac on the vault's network: joined (again after a restart or a lost network), the relay healed, the uploads
/// paced by the time of day. Its files come over iroh by the keep pass (keep.rs) — never over HTTPS.
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
    }
}
