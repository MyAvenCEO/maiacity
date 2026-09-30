//! One vault node: a private iroh endpoint, the blob store, gossip and the catalog replica, all under one directory.
//!
//! Private means: built from `presets::Minimal` — no n0 relays, no n0 DNS, nothing published anywhere. Until the
//! server peer exists the node runs without a relay; peers are added by address (see skill `connectivity.md`).

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use anyhow::{Context, Result};
use iroh::{
    Endpoint, EndpointId, RelayConfig, RelayMode, RelayUrl, SecretKey, address_lookup::MemoryLookup, endpoint::presets,
    protocol::Router,
};
use iroh_blobs::{
    BlobsProtocol,
    Hash,
    provider::events::{ConnectMode, EventMask, EventSender, ProviderMessage, RequestMode, RequestUpdate, ThrottleMode},
    store::fs::FsStore,
};
use iroh_docs::{DocTicket, protocol::Docs};
use iroh_gossip::net::Gossip;

/// The QUIC transport for moving footage over a home uplink. iroh's defaults are tuned for 100 ms: one stream may have
/// only 1.25 MB in flight, and on this Mac's line the latency swells from 43 ms to ~850 ms under load, capping a file
/// at ~3 MB/s of 59 Mbit/s. So: windows sized for a full second of a fast line, and BBR, which paces to the measured
/// bandwidth instead of filling the router's buffer (the swelling itself).
pub fn transport() -> iroh::endpoint::QuicTransportConfig {
    const STREAM: u32 = 32 * 1024 * 1024;
    iroh::endpoint::QuicTransportConfig::builder()
        .stream_receive_window(STREAM.into())
        .send_window(4 * STREAM as u64)
        .congestion_controller_factory(std::sync::Arc::new(noq_proto::congestion::Bbr3Config::default()))
        .build()
}


use crate::{catalog::Catalog, net::Allow};

pub struct Vault {
    pub dir: PathBuf,
    pub endpoint: Endpoint,
    pub store: FsStore,
    pub docs: Docs,
    pub catalog: Catalog,
    /// who may connect (the server and the other paired devices, once joined)
    pub allow: Allow,
    lookup: MemoryLookup,
    /// how fast this node sends files to its peers, in bytes per second (0 = as fast as it can)
    pub upload_limit: Arc<AtomicU64>,
    /// every file this node is sending or just sent, and to whom — as iroh reports each request
    pub transfers: Transfers,
    /// held while this Mac's own work runs (an ingest, a proxy rendering): its uploads wait until it is done
    pub hold: Hold,
    /// what iroh's garbage collection must never prune, besides what the catalog references (see `Keep`)
    pub keep: Keep,
    router: Router,
}

/// Local work first: ingest, then proxies, then sync. Each piece of work holds this while it runs; iroh asks before
/// every chunk it sends, and while anything is held the answer waits — the transfer pauses where it is and goes on
/// by itself once the work is done (nothing is aborted, nothing starts over).
#[derive(Clone)]
pub struct Hold(Arc<tokio::sync::watch::Sender<Vec<String>>>);

impl Default for Hold {
    fn default() -> Self {
        Self(Arc::new(tokio::sync::watch::channel(Vec::new()).0))
    }
}

/// While alive, uploads wait (see `Hold`).
pub struct Held {
    hold: Hold,
    why: String,
}

impl Drop for Held {
    fn drop(&mut self) {
        self.hold.0.send_modify(|w| {
            if let Some(i) = w.iter().position(|x| *x == self.why) {
                w.remove(i);
            }
        });
    }
}

impl Hold {
    /// Hold uploads for `why` ("ingest", "proxy") until the returned guard is dropped.
    pub fn take(&self, why: &str) -> Held {
        self.0.send_modify(|w| w.push(why.to_string()));
        Held { hold: self.clone(), why: why.to_string() }
    }
    /// What holds uploads now (empty: nothing).
    pub fn now(&self) -> Vec<String> {
        self.0.borrow().clone()
    }
    /// Is `why` holding now?
    pub fn holds(&self, why: &str) -> bool {
        self.0.borrow().iter().any(|w| w == why)
    }
    /// Wait until nothing holds.
    pub async fn free(&self) {
        let mut rx = self.0.subscribe();
        rx.wait_for(|w| w.is_empty()).await.ok();
    }
    /// Wait until `why` no longer holds.
    pub async fn free_of(&self, why: &str) {
        let mut rx = self.0.subscribe();
        rx.wait_for(|w| !w.iter().any(|x| x == why)).await.ok();
    }
}

/// How often iroh's garbage collection prunes the blob store.
pub const GC_EVERY: Duration = Duration::from_secs(10 * 60);

/// The files garbage collection must keep beyond what the catalog references: every file with a live description on
/// this Mac, set by the prune loop. Until it has been set once, collection does not run at all (it aborts).
#[derive(Clone, Default)]
pub struct Keep(Arc<std::sync::RwLock<Option<std::collections::HashSet<Hash>>>>);

impl Keep {
    pub fn set(&self, hashes: std::collections::HashSet<Hash>) {
        *self.0.write().unwrap() = Some(hashes);
    }

    /// The store's protect callback: these files, then iroh-docs' own (every hash a catalog entry references).
    fn protect(&self, docs: iroh_blobs::store::ProtectCb) -> iroh_blobs::store::ProtectCb {
        let keep = self.clone();
        Arc::new(move |live| {
            let (keep, docs) = (keep.0.read().unwrap().clone(), docs.clone());
            Box::pin(async move {
                let Some(keep) = keep else { return iroh_blobs::store::ProtectOutcome::Abort };
                live.extend(keep);
                docs(live).await
            })
        })
    }
}

/// One file on its way to a peer (the server pulling it into Object Storage, another device fetching it).
#[derive(Debug, Clone, serde::Serialize)]
pub struct Transfer {
    pub hash: String,
    /// the peer it goes to (its endpoint id)
    pub to: String,
    pub size: u64,
    pub sent: u64,
    /// bytes per second since it started
    pub rate: f64,
    pub done: bool,
    pub aborted: bool,
    #[serde(skip)]
    pub started: Option<Instant>,
    #[serde(skip)]
    pub ended: Option<Instant>,
}

/// The transfers of the last minute, newest state per file and peer.
#[derive(Clone, Default)]
pub struct Transfers(Arc<Mutex<HashMap<(Hash, String), Transfer>>>);

impl Transfers {
    /// What is moving now, and what ended in the last minute.
    pub fn now(&self) -> Vec<Transfer> {
        let mut all = self.0.lock().unwrap();
        all.retain(|_, t| t.ended.is_none_or(|e| e.elapsed() < Duration::from_secs(60)));
        all.values().cloned().collect()
    }

    pub fn update(&self, hash: Hash, to: &str, f: impl FnOnce(&mut Transfer)) {
        let mut all = self.0.lock().unwrap();
        let t = all.entry((hash, to.to_string())).or_insert_with(|| Transfer {
            hash: hash.to_hex(),
            to: to.to_string(),
            size: 0,
            sent: 0,
            rate: 0.0,
            done: false,
            aborted: false,
            started: Some(Instant::now()),
            ended: None,
        });
        f(t);
        if let Some(s) = t.started {
            t.rate = t.sent as f64 / s.elapsed().as_secs_f64().max(0.001);
        }
    }
}

/// What joining needs, from the API once the passkey approved this Mac: the shared catalog (with the server's
/// address in it), our relay, and the other devices the admin paired.
pub struct Join {
    pub ticket: DocTicket,
    pub relay: RelayUrl,
    pub devices: Vec<EndpointId>,
}

impl Vault {
    /// Open (or create) the vault in `dir`: `dir/secret.key` is this device's identity, `dir/blobs` the store,
    /// `dir/docs` the catalog replica, `dir/ingest` the landing place of copies being verified.
    pub async fn open(dir: impl AsRef<Path>) -> Result<Self> {
        let dir = dir.as_ref().to_path_buf();
        std::fs::create_dir_all(dir.join("ingest"))?;
        std::fs::create_dir_all(dir.join("docs"))?;
        // iroh-blobs imports by absolute path only
        let dir = std::fs::canonicalize(&dir)?;
        let secret = load_or_create_key(&dir.join("secret.key"))?;

        // until it joins, the node talks to nobody: no relay, an empty address book, an empty allowlist
        let allow = Allow::default();
        let lookup = MemoryLookup::new();
        let endpoint = Endpoint::builder(presets::Minimal)
            .secret_key(secret)
            .relay_mode(RelayMode::Disabled)
            .address_lookup(lookup.clone())
            .hooks(allow.clone())
            .transport_config(transport())
            .bind()
            .await
            .context("bind the iroh endpoint")?;

        // iroh's own pruning: the blob store's garbage collection keeps what a catalog entry references (iroh-docs'
        // protection: a `blobs/<hash>` entry is a holding) and every file that still has a live description (`Keep`);
        // the rest — a deleted file once every holder has let go of it, a temporary export — goes
        let keep = Keep::default();
        let (protect, docs_protect) = iroh_docs::engine::ProtectCallbackHandler::new();
        let mut opts = iroh_blobs::store::fs::options::Options::new(&dir.join("blobs"));
        opts.gc = Some(iroh_blobs::store::GcConfig { interval: GC_EVERY, add_protected: Some(keep.protect(docs_protect)) });
        let store = FsStore::load_with_opts(dir.join("blobs").join("blobs.db"), opts).await.context("open the blob store")?;
        let gossip = Gossip::builder().spawn(endpoint.clone());
        let docs = Docs::persistent(dir.join("docs"))
            .protect_handler(protect)
            .spawn(endpoint.clone(), (*store).clone(), gossip.clone())
            .await
            .context("open the catalog store")?;

        // the upload limit: iroh-blobs asks before it sends each 16 KiB, and a token bucket lets it wait
        let upload_limit = Arc::new(AtomicU64::new(0));
        // and every request's progress: which file goes to whom, how far it is
        let mask = EventMask { throttle: ThrottleMode::Intercept, connected: ConnectMode::Notify, get: RequestMode::NotifyLog, ..EventMask::DEFAULT };
        let (events, mut asks) = EventSender::channel(64, mask);
        let limit = upload_limit.clone();
        let hold = Hold::default();
        let held = hold.clone();
        let transfers = Transfers::default();
        let track = transfers.clone();
        tokio::spawn(async move {
            let (mut budget, mut last) = (0f64, Instant::now());
            let mut peers: HashMap<u64, String> = HashMap::new();
            while let Some(msg) = asks.recv().await {
                if let ProviderMessage::ClientConnectedNotify(c) = &msg {
                    if let Some(id) = c.endpoint_id {
                        peers.insert(c.connection_id, id.to_string());
                    }
                    continue;
                }
                if let ProviderMessage::ConnectionClosed(c) = &msg {
                    peers.remove(&c.inner.connection_id);
                    continue;
                }
                if let ProviderMessage::GetRequestReceivedNotify(r) = msg {
                    let to = peers.get(&r.connection_id).cloned().unwrap_or_default();
                    let (track, mut rx) = (track.clone(), r.rx);
                    tokio::spawn(async move {
                        let mut hash = None;
                        while let Ok(Some(update)) = rx.recv().await {
                            match update {
                                RequestUpdate::Started(s) => {
                                    hash = Some(s.hash);
                                    track.update(s.hash, &to, |t| (t.size, t.sent, t.done, t.aborted, t.started, t.ended) = (s.size, 0, false, false, Some(Instant::now()), None));
                                }
                                RequestUpdate::Progress(p) => {
                                    if let Some(h) = hash {
                                        track.update(h, &to, |t| t.sent = p.end_offset);
                                    }
                                }
                                RequestUpdate::Completed(_) => {
                                    if let Some(h) = hash {
                                        track.update(h, &to, |t| (t.sent, t.done, t.ended) = (t.size, true, Some(Instant::now())));
                                    }
                                }
                                RequestUpdate::Aborted(_) => {
                                    if let Some(h) = hash {
                                        track.update(h, &to, |t| (t.aborted, t.ended) = (true, Some(Instant::now())));
                                    }
                                }
                            }
                        }
                    });
                    continue;
                }
                if let ProviderMessage::Throttle(t) = msg {
                    // local work first: this chunk waits (in its own task — other requests are still told) until it is done
                    if !held.now().is_empty() {
                        let held = held.clone();
                        tokio::spawn(async move {
                            held.free().await;
                            t.tx.send(Ok(())).await.ok();
                        });
                        continue;
                    }
                    let rate = limit.load(Ordering::Relaxed) as f64;
                    if rate > 0.0 {
                        let now = Instant::now();
                        budget = (budget + now.duration_since(last).as_secs_f64() * rate).min(rate); // at most a second saved up
                        last = now;
                        budget -= t.inner.size as f64;
                        if budget < 0.0 {
                            tokio::time::sleep(Duration::from_secs_f64(-budget / rate)).await;
                        }
                    }
                    t.tx.send(Ok(())).await.ok();
                }
            }
        });

        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&store, Some(events)))
            .accept(iroh_gossip::ALPN, gossip)
            .accept(iroh_docs::ALPN, docs.clone())
            .spawn();

        let catalog = Catalog::open(&dir, &docs, &store).await?;
        Ok(Self { dir, endpoint, store, docs, catalog, allow, lookup, upload_limit, transfers, hold, keep, router })
    }

    /// Join the vault's network: our relay, the server's address, the paired devices, and the shared catalog —
    /// from then on files flow both ways by themselves.
    pub async fn join(&self, join: Join) -> Result<()> {
        let mut ids = join.devices;
        for addr in &join.ticket.nodes {
            ids.push(addr.id);
            self.lookup.add_endpoint_info(addr.clone());
        }
        self.allow.set(ids);
        self.endpoint.insert_relay(join.relay.clone(), Arc::new(RelayConfig::new(join.relay, None))).await;
        self.catalog.join(join.ticket).await
    }

    /// Where ingest lands copies: on the same volume as the store, so importing them is a clone, not a second copy.
    pub fn ingest_dir(&self) -> PathBuf {
        self.dir.join("ingest")
    }

    /// After sleep or a dropped network the endpoint can stay cut off from its relay (seen 2026-09-29: an hour, until
    /// restart). Once joined, a relay that is not connected makes iroh look at the network again. Returns why.
    pub async fn heal(&self) -> Option<String> {
        use iroh::Watcher;
        let relays = self.endpoint.home_relay_status().get();
        if relays.is_empty() || relays.iter().any(|r| r.is_connected()) {
            return None;
        }
        let why = relays.iter().filter_map(|r| r.last_error().map(|e| format!("{}: {e}", r.url()))).collect::<Vec<_>>().join("; ");
        self.endpoint.network_change().await;
        Some(if why.is_empty() { "the relay is not connected".into() } else { why })
    }

    /// Always close cleanly: the store may lose its last seconds of writes otherwise.
    pub async fn close(self) -> Result<()> {
        self.router.shutdown().await.ok();
        self.store.shutdown().await.ok();
        Ok(())
    }
}

/// The device's Ed25519 identity. A new key would be a new, unpaired device, so it is kept across starts.
/// (The Mac app keeps it in the Keychain instead; the file is for the CLI and tests.)
fn load_or_create_key(path: &Path) -> Result<SecretKey> {
    if let Ok(bytes) = std::fs::read(path) {
        let bytes: [u8; 32] = bytes.as_slice().try_into().context("secret.key must be 32 bytes")?;
        return Ok(SecretKey::from_bytes(&bytes));
    }
    let key = SecretKey::generate();
    std::fs::write(path, key.to_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    }
    Ok(key)
}
