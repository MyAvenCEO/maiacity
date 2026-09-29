//! The server peer's iroh side: a private endpoint (paired devices only), a catalog replica that keeps only the small
//! entries (meta/, ingest/, device/) on its disk, and the rule "every file the catalog names is in the bucket":
//! a file a Mac added is pulled from that Mac — every 16 KiB checked against its BLAKE3 tree on arrival — and streamed
//! straight into Object Storage. Nothing unverified is stored; a bad chunk aborts the upload.

use std::{
    collections::{HashMap, HashSet},
    net::{Ipv4Addr, SocketAddr, SocketAddrV4},
    path::Path,
    sync::{Arc, Mutex},
    time::Duration,
};

use anyhow::{Context, Result, bail};
use futures_lite::StreamExt;
use iroh::{Endpoint, EndpointId, RelayMode, RelayUrl, SecretKey, endpoint::presets, protocol::Router};
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
    router: Router,
    /// who most recently told us about a file — the first place to fetch it from
    seen_from: Mutex<HashMap<Hash, EndpointId>>,
    pub wake: Notify,
}

pub struct Config<'a> {
    pub dir: &'a Path,
    pub secret: SecretKey,
    pub port: u16,
    pub relay: RelayUrl,
    pub public_ip: Option<Ipv4Addr>,
}

impl Peer {
    pub async fn start(cfg: Config<'_>, allow: Allow) -> Result<Arc<Self>> {
        std::fs::create_dir_all(cfg.dir.join("docs"))?;
        let mut builder = Endpoint::builder(presets::Minimal)
            .secret_key(cfg.secret)
            .relay_mode(RelayMode::custom([cfg.relay.clone()]))
            .hooks(allow.clone())
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
        doc.set_download_policy(DownloadPolicy::NothingExcept(vec![small("meta/"), small("ingest/"), small("device/")])).await?;
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
            router,
            seen_from: Mutex::new(HashMap::new()),
            wake: Notify::new(),
        }))
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
                    self.wake.notify_one();
                }
                Ok(LiveEvent::InsertLocal { .. } | LiveEvent::ContentReady { .. } | LiveEvent::SyncFinished(_)) => self.wake.notify_one(),
                Ok(LiveEvent::NeighborUp(id)) => tracing::info!("neighbour up: {}", id.fmt_short()),
                Ok(_) => {}
                Err(e) => tracing::warn!("catalog event: {e:#}"),
            }
        }
        Ok(())
    }

    /// Bring the bucket and the mirror in line with the catalog: every `blobs/<hash>` into LIBRARY/, every
    /// `meta/<hash>` into Postgres and LIBRARY/meta/. Runs on every wake and every minute.
    pub async fn reconcile(self: Arc<Self>, s3: S3, db: Arc<tokio_postgres::Client>) -> Result<()> {
        let mut failed: HashSet<Hash> = HashSet::new();
        loop {
            tokio::select! {
                _ = self.wake.notified() => {}
                _ = tokio::time::sleep(Duration::from_secs(60)) => failed.clear(),
            }
            if let Err(e) = self.reconcile_once(&s3, &db, &mut failed).await {
                tracing::warn!("reconcile: {e:#}");
            }
        }
    }

    async fn reconcile_once(&self, s3: &S3, db: &tokio_postgres::Client, failed: &mut HashSet<Hash>) -> Result<()> {
        // descriptions first, so the mirror knows a file before its bytes arrive
        let metas: Vec<_> = self.doc.get_many(Query::single_latest_per_key().key_prefix("meta/")).await?.collect().await;
        for entry in metas {
            let entry = entry?;
            let Ok(bytes) = self.store.blobs().get_bytes(entry.content_hash()).await else { continue }; // not arrived yet
            let Ok(meta) = serde_json::from_slice::<serde_json::Value>(&bytes) else { continue };
            let Some(hash) = meta.get("hash").and_then(|h| h.as_str()).map(String::from) else { continue };
            // each file on its own: one that fails never holds up the rest
            if let Err(e) = db::mirror(db, &meta, false).await {
                tracing::warn!("mirror {hash}: {e:#}");
            }
            let copy = async {
                if s3.head(&s3::meta_key(&hash)).await?.is_none() {
                    s3.put(&s3::meta_key(&hash), bytes, "application/json").await?;
                }
                anyhow::Ok(())
            };
            if let Err(e) = copy.await {
                tracing::warn!("meta {hash} to the bucket: {e:#}");
            }
        }

        let blobs: Vec<_> = self.doc.get_many(Query::single_latest_per_key().key_prefix("blobs/")).await?.collect().await;
        for entry in blobs {
            let entry = entry?;
            let (hash, size) = (entry.content_hash(), entry.content_len());
            if failed.contains(&hash) {
                continue;
            }
            let key = s3::blob_key(&hash.to_hex());
            match s3.head(&key).await {
                Ok(Some(have)) if have == size => {
                    db::stored(db, &hash.to_hex()).await.ok();
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
                Ok(from) => {
                    tracing::info!("stored {} ({size} B) from {}", hash.fmt_short(), from.fmt_short());
                    db::stored(db, &hash.to_hex()).await.ok();
                }
                Err(e) => {
                    tracing::warn!("{}: {e:#}", hash.fmt_short());
                    failed.insert(hash);
                }
            }
        }
        Ok(())
    }

    /// Fetch one file from whichever paired device has it, verified chunk by chunk, into the bucket.
    async fn pull(&self, hash: Hash, size: u64, s3: &S3) -> Result<EndpointId> {
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
            match tokio::time::timeout(Duration::from_secs(15), self.endpoint.connect(id, iroh_blobs::ALPN)).await {
                Ok(Ok(conn)) => match stream_into(conn, hash, size, s3).await {
                    Ok(()) => return Ok(id),
                    Err(e) => last = e,
                },
                Ok(Err(e)) => last = e.into(),
                Err(_) => last = anyhow::anyhow!("{} did not answer", id.fmt_short()),
            }
        }
        Err(last)
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
    let mut upload = s3.upload(&key).await?;
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
