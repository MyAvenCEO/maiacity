//! The server peer's iroh side: a private endpoint (paired devices only), a catalog replica that keeps only the small
//! entries (meta/, ingest/, device/, and the derived transcript/, sound/ and analysis/ records) on its disk, and the
//! rule "every file the catalog names is in the bucket": a file a Mac added is pulled from that Mac — every 16 KiB
//! checked against its BLAKE3 tree on arrival — and streamed straight into Object Storage. Nothing unverified is
//! stored; a bad chunk aborts the upload.

use std::{
    collections::{HashMap, HashSet},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result, bail};
use futures_lite::StreamExt;
use iroh::{Endpoint, EndpointAddr, EndpointId, RelayMode, RelayUrl, SecretKey, address_lookup::MemoryLookup, endpoint::presets, protocol::Router};
use iroh_blobs::{
    BlobsProtocol, Hash,
    get::fsm::{self, BlobContentNext, ConnectedNext, EndBlobNext},
    protocol::GetRequest,
    store::fs::FsStore,
};
use iroh_docs::{
    AuthorId, DocTicket, NamespaceId,
    api::{Doc, protocol::{AddrInfoOptions, ShareMode}},
    engine::LiveEvent,
    protocol::Docs,
    store::{DownloadPolicy, FilterKind, Query},
};
use iroh_gossip::net::Gossip;
use tokio::sync::Notify;

use crate::{allow::Allow, db, s3::{self, S3}};

pub struct Peer {
    pub endpoint: Endpoint,
    pub store: FsStore,
    /// kept for writing entries as the server (the web upload, device records)
    #[allow(dead_code)]
    pub docs: Docs,
    pub doc: Doc,
    #[allow(dead_code)]
    pub author: AuthorId,
    pub allow: Allow,
    /// where each paired device can be reached: through our relay (every Mac keeps its home connection there)
    lookup: MemoryLookup,
    relay: RelayUrl,
    router: Router,
    /// who most recently told us about a file — the first place to fetch it from
    seen_from: Mutex<HashMap<Hash, EndpointId>>,
    conns: tokio::sync::Mutex<HashMap<EndpointId, iroh::endpoint::Connection>>,
    pub wake: Notify,
    /// the same, for the uploads
    pub wake_store: Notify,
    /// a file reached the bucket: the sound loop looks (sound.rs)
    pub wake_transcribe: Notify,
    /// a file reached the bucket or a transcript settled: the analysis looks (analyse.rs)
    pub wake_analyse: Notify,
}

pub struct Config<'a> {
    pub dir: &'a Path,
    pub secret: SecretKey,
    pub port: u16,
    pub relay: RelayUrl,
    pub public_ip: Option<Ipv4Addr>,
}

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

impl Peer {
    pub async fn start(cfg: Config<'_>, allow: Allow) -> Result<Arc<Self>> {
        std::fs::create_dir_all(cfg.dir.join("docs"))?;
        let lookup = MemoryLookup::new();
        let mut builder = Endpoint::builder(presets::Minimal)
            .secret_key(cfg.secret)
            .relay_mode(RelayMode::custom([cfg.relay.clone()]))
            .address_lookup(lookup.clone())
            .hooks(allow.clone())
            .transport_config(transport())
            .portmapper_config(iroh::endpoint::PortmapperConfig::Disabled)
            .bind_addr(SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, cfg.port)))?;
        if let Some(ip) = cfg.public_ip {
            builder = builder.external_addr(SocketAddr::V4(SocketAddrV4::new(ip, cfg.port)));
        }
        let endpoint = builder.bind().await.context("bind the server endpoint")?;
        // the server itself is always allowed (it dials its own relay)
        let mut ids = allow.all();
        ids.push(endpoint.id());
        allow.set(ids);

        // a small store: only the catalog's own entries (descriptions, reports, devices) — never the files
        let store = FsStore::load(cfg.dir.join("blobs")).await?;
        let gossip = Gossip::builder().spawn(endpoint.clone());
        let docs = Docs::persistent(cfg.dir.join("docs")).spawn(endpoint.clone(), (*store).clone(), gossip.clone()).await?;
        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, BlobsProtocol::new(&store, None))
            .accept(iroh_gossip::ALPN, gossip)
            .accept(iroh_docs::ALPN, docs.clone())
            .spawn();

        let id_file = cfg.dir.join("catalog.id");
        let doc = match std::fs::read_to_string(&id_file) {
            Ok(id) => docs.open(id.trim().parse::<NamespaceId>()?).await?.context("catalog.id names no replica")?,
            Err(_) => {
                let doc = docs.create().await?;
                std::fs::write(&id_file, doc.id().to_string())?;
                doc
            }
        };
        let small = |p: &str| FilterKind::Prefix(bytes::Bytes::copy_from_slice(p.as_bytes()));
        // the derived records are small too (a transcript is at most a few hundred KB): kept here like descriptions
        doc.set_download_policy(DownloadPolicy::NothingExcept(vec![
            small("meta/"),
            small("ingest/"),
            small("device/"),
            small("transcript/"),
            small("sound/"),
            small("analysis/"),
        ]))
        .await?;
        // live: iroh-docs only accepts a device's sync for a catalog that is syncing (else it closes the stream)
        doc.start_sync(vec![]).await?;
        let author = docs.author_default().await?;

        Ok(Arc::new(Self {
            endpoint,
            store,
            docs,
            doc,
            author,
            allow,
            lookup,
            relay: cfg.relay.clone(),
            router,
            seen_from: Mutex::new(HashMap::new()),
            conns: tokio::sync::Mutex::new(HashMap::new()),
            wake: Notify::new(),
            wake_store: Notify::new(),
            wake_transcribe: Notify::new(),
            wake_analyse: Notify::new(),
        }))
    }

    /// The paired devices change: let them in, and know how to reach them (through our relay).
    pub fn devices(&self, ids: Vec<EndpointId>) {
        for id in &ids {
            self.lookup.add_endpoint_info(EndpointAddr::new(*id).with_relay_url(self.relay.clone()));
        }
        let mut all = ids;
        all.push(self.endpoint.id());
        self.allow.set(all);
    }

    /// What a paired device needs: the catalog, writable (the device joins it), with the server's address in it.
    pub async fn ticket(&self) -> Result<DocTicket> {
        Ok(self.doc.share(ShareMode::Write, AddrInfoOptions::RelayAndAddresses).await?)
    }

    /// Hear the catalog: every change wakes the reconcile loop; a new file remembers who has it.
    pub async fn listen(self: Arc<Self>) -> Result<()> {
        let mut events = self.doc.subscribe().await?;
        while let Some(ev) = events.next().await {
            match ev {
                Ok(LiveEvent::InsertRemote { from, entry, .. }) => {
                    if entry.key().starts_with(b"blobs/") {
                        self.seen_from.lock().unwrap().insert(entry.content_hash(), from);
                    }
                    // a Mac's transcript arrived: a recording's analysis may go on with its words
                    if entry.key().starts_with(b"transcript/") {
                        self.wake_analyse.notify_one();
                    }
                    self.nudge();
                }
                Ok(LiveEvent::InsertLocal { .. } | LiveEvent::ContentReady { .. } | LiveEvent::SyncFinished(_)) => self.nudge(),
                Ok(LiveEvent::NeighborUp(id)) => tracing::info!("neighbour up: {}", id.fmt_short()),
                Ok(_) => {}
                Err(e) => tracing::warn!("catalog event: {e:#}"),
            }
        }
        Ok(())
    }

    /// Something changed: wake both the mirror and the uploads.
    pub fn nudge(&self) {
        self.wake.notify_one();
        self.wake_store.notify_one();
    }

    /// Keep the mirror in line with the catalog's descriptions: every `meta/<hash>` into Postgres and LIBRARY/meta/,
    /// as soon as it changes. Its own loop, so a long run of uploads never holds a description back.
    pub async fn describe(self: Arc<Self>, s3: S3, db: Arc<tokio_postgres::Client>) -> Result<()> {
        // the content each description was last mirrored at
        let mut done: HashMap<Hash, Hash> = HashMap::new();
        let mut kept: HashMap<String, Hash> = HashMap::new();
        loop {
            if let Err(e) = self.describe_once(&s3, &db, &mut done).await {
                tracing::warn!("describe: {e:#}");
            }
            if let Err(e) = self.keep_derived(&s3, &mut kept).await {
                tracing::warn!("derived records to the bucket: {e:#}");
            }
            tokio::select! {
                _ = self.wake.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(60)) => {}
            }
        }
    }

    async fn describe_once(&self, s3: &S3, db: &tokio_postgres::Client, done: &mut HashMap<Hash, Hash>) -> Result<()> {
        let metas: Vec<_> = self.doc.get_many(Query::single_latest_per_key().key_prefix("meta/")).await?.collect().await;
        let metas: Vec<_> = metas.into_iter().collect::<Result<_, _>>()?;
        let key_of = |e: &iroh_docs::Entry| std::str::from_utf8(&e.key()[5..]).ok().and_then(|h| h.parse::<Hash>().ok());
        let fresh: Vec<_> = metas.into_iter().filter(|e| key_of(e).is_some_and(|k| done.get(&k) != Some(&e.content_hash()))).collect();
        if fresh.is_empty() {
            return Ok(());
        }
        // iroh-docs fetches an entry's content once, when the entry arrives; a device it could not reach then leaves
        // the description missing for good — so ask the paired devices for whatever is still missing
        let mut missing = Vec::new();
        for entry in &fresh {
            if self.store.blobs().get_bytes(entry.content_hash()).await.is_err() {
                missing.push(entry.content_hash());
            }
        }
        if !missing.is_empty() {
            let from: Vec<EndpointId> = self.allow.all().into_iter().filter(|id| *id != self.endpoint.id()).collect();
            let n = missing.len();
            match self.store.downloader(&self.endpoint).download(missing, from).await {
                Ok(()) => tracing::info!("fetched {n} descriptions"),
                Err(e) => tracing::warn!("{n} descriptions still missing: {e:#}"),
            }
        }
        let mut mirrored = 0;
        for entry in fresh {
            let Some(key) = key_of(&entry) else { continue };
            let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await else { continue };
            let Ok(meta) = serde_json::from_slice::<serde_json::Value>(&bytes) else { continue };
            let hash = key.to_hex();
            // each file on its own: one that fails never holds up the rest (and is tried again next time)
            if let Err(e) = db::mirror(db, &meta, false).await {
                tracing::warn!("mirror {hash}: {e:#}");
                continue;
            }
            // a changed description replaces the bucket's copy
            if let Err(e) = s3.put(&s3::meta_key(&hash), bytes, "application/json").await {
                tracing::warn!("meta {hash} to the bucket: {e:#}");
                continue;
            }
            done.insert(key, entry.content_hash());
            mirrored += 1;
        }
        tracing::info!("mirrored {mirrored} descriptions");
        Ok(())
    }

    /// Every settled derived record (a transcript, an analysis — not one halfway) into the bucket beside the
    /// descriptions (`LIBRARY/transcript/<hash>.json`, `LIBRARY/analysis/<hash>.json`): one more copy, readable
    /// without iroh. Postgres keeps none of them (the site does not need a file's words or cues).
    async fn keep_derived(&self, s3: &S3, kept: &mut HashMap<String, Hash>) -> Result<()> {
        for prefix in ["transcript/", "sound/", "analysis/"] {
            let entries: Vec<_> = self.doc.get_many(Query::single_latest_per_key().key_prefix(prefix)).await?.collect().await;
            for entry in entries.into_iter().flatten() {
                let key = String::from_utf8_lossy(entry.key()).into_owned();
                if kept.get(&key) == Some(&entry.content_hash()) {
                    continue;
                }
                let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await else { continue };
                let settled = serde_json::from_slice::<serde_json::Value>(&bytes)
                    .ok()
                    .and_then(|v| v["state"].as_str().map(|s| s == "done" || s.starts_with("none") || s.starts_with("failed")))
                    .unwrap_or(false);
                if settled {
                    s3.put(&s3::derived_key(&key), bytes, "application/json").await?;
                }
                kept.insert(key, entry.content_hash());
            }
        }
        Ok(())
    }

    /// Bring the bucket in line with the catalog: every `blobs/<hash>` into LIBRARY/, pulled verified from a device
    /// that has it. Runs on every wake and every minute.
    pub async fn reconcile(self: Arc<Self>, s3: S3, db: Arc<tokio_postgres::Client>) -> Result<()> {
        let mut failed: HashSet<Hash> = HashSet::new();
        loop {
            if let Err(e) = self.reconcile_once(&s3, &db, &mut failed).await {
                tracing::warn!("reconcile: {e:#}");
            }
            tokio::select! {
                _ = self.wake_store.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(60)) => failed.clear(),
            }
        }
    }

    async fn reconcile_once(&self, s3: &S3, db: &tokio_postgres::Client, failed: &mut HashSet<Hash>) -> Result<()> {
        let blobs: Vec<_> = self.doc.get_many(Query::single_latest_per_key().key_prefix("blobs/")).await?.collect().await;
        let mut blobs: Vec<_> = blobs.into_iter().collect::<Result<_, _>>()?;
        // the order of a shoot: the small working files first, then the proxies (the edit can start from them anywhere),
        // then the originals, then the rest — each class as the file's description says (iroh-docs keeps every `meta/`
        // here), smaller files first within each
        let classes = self.classes().await;
        blobs.sort_by_key(|e| {
            let hex = String::from_utf8_lossy(e.key()).trim_start_matches("blobs/").to_string();
            let rank = match classes.get(&hex).map(String::as_str) {
                Some("default") | None => 0,
                Some("proxy") => 1,
                Some("original") => 2,
                _ => 3,
            };
            (rank, e.content_len())
        });
        // what this server holds is in the catalog itself: its own signed `blobs/<hash>` entries (iroh-docs, one per
        // author per key) — never asked about again; Postgres only follows them
        let held: HashSet<String> = {
            let mine: Vec<_> = self.doc.get_many(Query::author(self.author).key_prefix("blobs/")).await?.collect().await;
            mine.into_iter().flatten().map(|e| String::from_utf8_lossy(e.key()).trim_start_matches("blobs/").to_string()).collect()
        };
        // a deleted file: out of the bucket, and this server lets go of it (its holding and its records) — never pulled
        let deleted = self.deleted().await;
        for hex in deleted.iter().filter(|h| held.contains(*h)) {
            match self.purge(hex, s3).await {
                Ok(()) => tracing::info!("deleted {hex} from the bucket"),
                Err(e) => tracing::warn!("delete {hex}: {e:#}"),
            }
        }
        for entry in blobs {
            let (hash, size) = (entry.content_hash(), entry.content_len());
            let hex = hash.to_hex().to_string();
            if failed.contains(&hash) || held.contains(&hex) || deleted.contains(&hex) {
                continue;
            }
            let key = s3::blob_key(&hash.to_hex());
            match s3.head(&key).await {
                Ok(Some(have)) if have == size => {
                    self.hold(hash, size, db).await;
                    continue;
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!("{}: the bucket cannot be asked: {e:#}", hash.fmt_short());
                    failed.insert(hash);
                    continue;
                }
            }
            match self.pull(hash, size, s3).await {
                Ok((from, how)) => {
                    tracing::info!("stored {} ({size} B) from {}, {how}", hash.fmt_short(), from.fmt_short());
                    self.hold(hash, size, db).await;
                }
                Err(e) => {
                    tracing::warn!("{}: {e:#}", hash.fmt_short());
                    failed.insert(hash);
                }
            }
        }
        Ok(())
    }

    /// The bucket holds this file, verified: say so in the catalog (this server's own `blobs/<hash>` entry — every
    /// replica learns it by iroh-docs), and let the Postgres projection follow.
    pub(crate) async fn hold(&self, hash: Hash, size: u64, db: &tokio_postgres::Client) {
        if let Err(e) = self.doc.set_hash(self.author, format!("blobs/{}", hash.to_hex()), hash, size).await {
            tracing::warn!("{}: the catalog did not take the holding: {e:#}", hash.fmt_short());
            return;
        }
        db::stored(db, &hash.to_hex()).await.ok();
        self.wake_transcribe.notify_one();
        self.wake_analyse.notify_one();
    }

    /// The files the bucket holds: this server's own `blobs/<hash>` entries (hex).
    pub(crate) async fn held(&self) -> Result<HashSet<String>> {
        let mine: Vec<_> = self.doc.get_many(Query::author(self.author).key_prefix("blobs/")).await?.collect().await;
        Ok(mine.into_iter().flatten().map(|e| String::from_utf8_lossy(e.key()).trim_start_matches("blobs/").to_string()).collect())
    }

    /// Every file's description whose JSON is here (the newest entry per key, whoever wrote it).
    pub(crate) async fn metas(&self) -> Result<Vec<(Hash, serde_json::Value)>> {
        self.records("meta/").await
    }

    /// Every entry under a `<prefix><hash>` key whose JSON is here — descriptions (`meta/`) or derived records
    /// (`transcript/`, `analysis/`), the newest entry per key.
    pub(crate) async fn records(&self, prefix: &str) -> Result<Vec<(Hash, serde_json::Value)>> {
        let entries: Vec<_> = self.doc.get_many(Query::single_latest_per_key().key_prefix(prefix)).await?.collect().await;
        let mut out = Vec::new();
        for entry in entries.into_iter().flatten() {
            let Some(hash) = std::str::from_utf8(&entry.key()[prefix.len()..]).ok().and_then(|h| h.parse::<Hash>().ok()) else { continue };
            let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await else { continue };
            if let Ok(v) = serde_json::from_slice(&bytes) {
                out.push((hash, v));
            }
        }
        Ok(out)
    }

    /// One file's derived record (`transcript/`, `analysis/`) as it is now.
    pub(crate) async fn record(&self, prefix: &str, hash: Hash) -> Result<Option<serde_json::Value>> {
        let query = Query::single_latest_per_key().key_exact(format!("{prefix}{}", hash.to_hex()));
        let Some(entry) = self.doc.get_one(query).await? else { return Ok(None) };
        let bytes = self.store.blobs().get_bytes(entry.content_hash()).await?;
        Ok(Some(serde_json::from_slice(&bytes)?))
    }

    /// Write a file's derived record as the server — the only author of `transcript/` and `analysis/`.
    pub(crate) async fn write_record(&self, prefix: &str, hash: Hash, record: &serde_json::Value) -> Result<()> {
        self.doc.set_bytes(self.author, format!("{prefix}{}", hash.to_hex()), serde_json::to_vec(record)?).await?;
        Ok(())
    }

    /// One file's description as it is now (the newest entry, whoever wrote it).
    pub(crate) async fn meta_of(&self, hash: Hash) -> Result<Option<serde_json::Value>> {
        let query = Query::single_latest_per_key().key_exact(format!("meta/{}", hash.to_hex()));
        let Some(entry) = self.doc.get_one(query).await? else { return Ok(None) };
        let bytes = self.store.blobs().get_bytes(entry.content_hash()).await?;
        Ok(Some(serde_json::from_slice(&bytes)?))
    }

    /// Write a file's description as the server (a new `meta/<hash>` entry, signed by the server's author).
    pub(crate) async fn write_meta(&self, hash: Hash, meta: &serde_json::Value) -> Result<()> {
        self.doc.set_bytes(self.author, format!("meta/{}", hash.to_hex()), serde_json::to_vec(meta)?).await?;
        Ok(())
    }

    /// The files whose description says they are deleted (hex).
    async fn deleted(&self) -> HashSet<String> {
        let Ok(metas) = self.metas().await else { return HashSet::new() };
        metas.into_iter().filter(|(_, m)| m.pointer("/meta/deleted").is_some_and(|d| !d.is_null())).map(|(h, _)| h.to_hex().to_string()).collect()
    }

    /// A deleted file leaves the server: its bytes and derived records out of the bucket, then its holding and its
    /// records out of the catalog (so no replica references it: iroh's garbage collection prunes it on every Mac).
    async fn purge(&self, hex: &str, s3: &S3) -> Result<()> {
        s3.delete(&s3::blob_key(hex)).await?;
        for prefix in ["transcript/", "sound/", "analysis/"] {
            s3.delete(&s3::derived_key(&format!("{prefix}{hex}"))).await?;
        }
        for prefix in ["blobs/", "transcript/", "sound/", "analysis/"] {
            self.doc.del(self.author, format!("{prefix}{hex}")).await?;
        }
        Ok(())
    }

    /// Each file's class (hash → "proxy", "original" …), from the descriptions iroh-docs keeps on this server.
    async fn classes(&self) -> HashMap<String, String> {
        let mut out = HashMap::new();
        let Ok(metas) = self.doc.get_many(Query::single_latest_per_key().key_prefix("meta/")).await else { return out };
        let metas: Vec<_> = metas.collect().await;
        for entry in metas.into_iter().flatten() {
            let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await else { continue };
            let Ok(meta) = serde_json::from_slice::<serde_json::Value>(&bytes) else { continue };
            if let Some(class) = meta["class"].as_str() {
                out.insert(String::from_utf8_lossy(entry.key()).trim_start_matches("meta/").to_string(), class.to_string());
            }
        }
        out
    }

    /// Fetch one file from whichever paired device has it, verified chunk by chunk, into the bucket.
    async fn pull(&self, hash: Hash, size: u64, s3: &S3) -> Result<(EndpointId, String)> {
        let mut candidates: Vec<EndpointId> = Vec::new();
        if let Some(id) = self.seen_from.lock().unwrap().get(&hash) {
            candidates.push(*id);
        }
        for id in self.allow.all() {
            if id != self.endpoint.id() && !candidates.contains(&id) {
                candidates.push(id);
            }
        }
        let mut last = anyhow::anyhow!("no paired device to fetch from");
        for id in candidates {
            let conn = match self.conn(id).await {
                Ok(c) => c,
                Err(e) => {
                    last = e;
                    continue;
                }
            };
            let started = std::time::Instant::now();
            match stream_into(conn.clone(), hash, size, s3).await {
                Ok(()) => {
                    let rate = size as f64 / started.elapsed().as_secs_f64().max(0.001) / 1e6;
                    let paths = conn.paths();
                    let path = paths.iter().find(|p| p.is_selected()).map(|p| {
                        format!("{} {} ms", if p.is_relay() { "relayed" } else { "direct" }, p.rtt().as_millis())
                    });
                    return Ok((id, format!("{rate:.1} MB/s, {}", path.unwrap_or_else(|| "no path".into()))));
                }
                Err(e) => {
                    self.conns.lock().await.remove(&id);
                    last = e;
                }
            }
        }
        Err(last)
    }

    /// One connection per device, kept across files: no handshake per file, and the direct path, once found, stays.
    async fn conn(&self, id: EndpointId) -> Result<iroh::endpoint::Connection> {
        let mut conns = self.conns.lock().await;
        if let Some(c) = conns.get(&id).filter(|c| c.close_reason().is_none()) {
            return Ok(c.clone());
        }
        let c = tokio::time::timeout(Duration::from_secs(15), self.endpoint.connect(id, iroh_blobs::ALPN))
            .await
            .map_err(|_| anyhow::anyhow!("{} did not answer", id.fmt_short()))??;
        conns.insert(id, c.clone());
        Ok(c)
    }

    pub async fn shutdown(&self) {
        self.router.shutdown().await.ok();
        self.store.shutdown().await.ok();
    }
}

/// The verified stream of one blob, straight into a multipart upload.
async fn stream_into(conn: iroh::endpoint::Connection, hash: Hash, size: u64, s3: &S3) -> Result<()> {
    let key = s3::blob_key(&hash.to_hex());
    let connected = fsm::start(conn, GetRequest::blob(hash), Default::default()).next().await?;
    let ConnectedNext::StartRoot(root) = connected.next().await? else { bail!("the peer sent no blob") };
    let (mut content, got) = root.next().next().await?;
    if got != size {
        bail!("the peer says {got} bytes, the catalog {size}");
    }
    let mut upload = s3.upload(&key);
    let end = loop {
        match content.next().await {
            BlobContentNext::More((next, item)) => {
                content = next;
                match item {
                    Ok(bao_tree::io::BaoContentItem::Leaf(leaf)) => {
                        if let Err(e) = upload.write(&leaf.data).await {
                            upload.abort().await;
                            return Err(e);
                        }
                    }
                    Ok(bao_tree::io::BaoContentItem::Parent(_)) => {}
                    Err(e) => {
                        // a chunk that does not match the hash: nothing of this file is kept
                        upload.abort().await;
                        bail!("verification failed: {e}");
                    }
                }
            }
            BlobContentNext::Done(end) => break end,
        }
    };
    upload.finish().await?;
    if let EndBlobNext::Closing(closing) = end.next() {
        closing.next().await.ok();
    }
    Ok(())
}
