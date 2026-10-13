//! The McEliece keys in iroh-blobs, and the gate of a node's blob store. A node offers the keys its replies name, by
//! BLAKE3 hash, and its gate hands each out only to a device a hello proved that may fetch it by the node's view; the
//! asker checks each key it fetches against its id, a cSHAKE256 hash, so a peer can serve no other bytes for it. The
//! sealed pieces of files are in the same store (`files`), and the gate hands those out by the same rule (T27).
//!
//! A blob connection says no hello of its own: the gate knows its device by its TLS endpoint key, the ed25519 key a
//! hello proved on a sync connection. So one who could forge that key, as a quantum computer could, might fetch the
//! keys and sealed files that device may; but a McEliece key is a public key, and a sealed file opens only under the
//! key in the write that brings it: the gate keeps others from learning whom a node seals to and what it keeps, and
//! keeps nothing secret.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context as _, Result};
use avendb::id::BlobId;
use avendb::lab::Lab;
use avendb::sealed::FileRoot;
use iroh::EndpointId;
use iroh::endpoint::VarInt;
use iroh_blobs::Hash;
use iroh_blobs::provider::events::{
    AbortReason, ConnectMode, EventMask, EventResult, EventSender, ObserveMode, ProviderMessage, RequestMode,
    ThrottleMode,
};
use tokio::sync::mpsc;

use crate::{Shared, WAIT};

/// How long a node waits for a McEliece key, a megabyte or so, once asked for.
const FETCH: Duration = Duration::from_secs(60);

/// The McEliece keys in a node's blob store, by hash and by id.
#[derive(Default)]
pub(crate) struct Offered {
    ids: HashMap<Hash, BlobId>,
    hashes: HashMap<BlobId, Hash>,
}

impl Offered {
    fn insert(&mut self, id: BlobId, hash: Hash) {
        self.ids.insert(hash, id);
        self.hashes.insert(id, hash);
    }

    /// The hash of every McEliece key in the store.
    #[cfg(target_arch = "wasm32")]
    pub(crate) fn hashes(&self) -> impl Iterator<Item = Hash> + '_ {
        self.hashes.values().copied()
    }
}

impl Shared {
    /// The BLAKE3 hash of each McEliece key in `ids`, each put in the blob store first if it isn't there.
    pub(crate) async fn offer(self: &Arc<Self>, ids: Vec<BlobId>) -> Result<Vec<(BlobId, [u8; 32])>> {
        let mut offered = Vec::with_capacity(ids.len());
        for id in ids {
            let known = self.offered.lock().expect("offered").hashes.get(&id).copied();
            let hash = match known {
                Some(hash) => hash,
                None => {
                    let key = self.lab(move |lab, me| lab.blob(me, id)).await.context("a key the node holds")?;
                    let hash = self.store.add_bytes(key.to_vec()).await?.hash;
                    self.offered.lock().expect("offered").insert(id, hash);
                    hash
                }
            };
            offered.push((id, *hash.as_bytes()));
        }
        Ok(offered)
    }

    /// The McEliece keys `wanted`, each by its id and hash, fetched from `endpoint` over iroh-blobs: each that
    /// arrives whole and is the key its id names.
    pub(crate) async fn fetch(
        self: &Arc<Self>,
        endpoint: EndpointId,
        wanted: Vec<(BlobId, [u8; 32])>,
    ) -> Vec<Arc<[u8]>> {
        if wanted.is_empty() {
            return Vec::new();
        }
        let dial = self.endpoint.connect(self.addr_of(endpoint), iroh_blobs::ALPN);
        let Ok(Ok(conn)) = n0_future::time::timeout(WAIT, dial).await else { return Vec::new() };
        let mut keys = Vec::new();
        for (id, hash) in wanted {
            let hash = Hash::from_bytes(hash);
            let fetched = n0_future::time::timeout(FETCH, self.store.remote().fetch(conn.clone(), hash).into_future());
            if !matches!(fetched.await, Ok(Ok(_))) {
                continue;
            }
            let Ok(key) = self.store.get_bytes(hash).await else { continue };
            if BlobId::of(&key) == id {
                self.offered.lock().expect("offered").insert(id, hash);
                keys.push(Arc::from(&key[..]));
            }
        }
        conn.close(VarInt::from_u32(0), b"fetched");
        keys
    }

    /// The device of blob connection `connection` may fetch each of `hashes`: a McEliece key this node offered, named
    /// by an edit it may receive by this node's view (`Lab::may_fetch`); or else a file's root, or one of its pieces,
    /// brought by such an edit (`Lab::may_fetch_file`, T27).
    async fn may_fetch(self: &Arc<Self>, connection: u64, hashes: Vec<Hash>) -> bool {
        let Some(device) = self.blob_peers.lock().expect("blob peers").get(&connection).copied() else { return false };
        let asked: Vec<([u8; 32], Option<BlobId>, Vec<FileRoot>)> = {
            let (offered, pieces) = (self.offered.lock().expect("offered"), self.pieces.lock().expect("pieces"));
            let of = |h: &Hash| pieces.get(h).map(|roots| roots.iter().copied().collect()).unwrap_or_default();
            hashes.iter().map(|h| (*h.as_bytes(), offered.ids.get(h).copied(), of(h))).collect()
        };
        let may = move |lab: &mut Lab, me| {
            let files = lab.files(me);
            asked.iter().all(|(hash, key, pieced)| match key {
                Some(b) => lab.may_fetch(me, device, *b),
                None => {
                    let mut roots = files.iter().filter(|f| f.hash == *hash).chain(pieced);
                    roots.any(|f| lab.may_fetch_file(me, device, f))
                }
            })
        };
        self.lab(may).await
    }
}

/// The blob provider's events, and where they arrive: each connection, and each request on one, waits on the gate;
/// pushes are refused outright.
pub(crate) fn events() -> (EventSender, mpsc::Receiver<ProviderMessage>) {
    let mask = EventMask {
        connected: ConnectMode::Intercept,
        get: RequestMode::Intercept,
        get_many: RequestMode::Intercept,
        push: RequestMode::Disabled,
        observe: ObserveMode::Intercept,
        throttle: ThrottleMode::None,
    };
    EventSender::channel(64, mask)
}

fn verdict(allowed: bool) -> EventResult {
    if allowed { Ok(()) } else { Err(AbortReason::Permission) }
}

/// The blob provider's gate: it lets in a connection only from an endpoint whose hello proved its device, and a
/// request only for blobs that device may fetch, McEliece keys and the sealed pieces of files, any ranges of each
/// blob alone: a request for a HashSeq with its children is refused, as the gate would not weigh the children.
pub(crate) async fn gate(shared: Arc<Shared>, mut events: mpsc::Receiver<ProviderMessage>) {
    while let Some(event) = events.recv().await {
        match event {
            ProviderMessage::ClientConnected(m) => {
                let proven = |e| shared.proven.lock().expect("proven").get(&e).copied();
                let device = m.inner.endpoint_id.and_then(proven);
                if let Some(device) = device {
                    shared.blob_peers.lock().expect("blob peers").insert(m.inner.connection_id, device);
                }
                m.tx.send(verdict(device.is_some())).await.ok();
            }
            ProviderMessage::ConnectionClosed(m) => {
                shared.blob_peers.lock().expect("blob peers").remove(&m.inner.connection_id);
            }
            ProviderMessage::GetRequestReceived(m) => {
                let (request, connection) = (&m.inner.request, m.inner.connection_id);
                let allowed = request.ranges.is_blob() && shared.may_fetch(connection, vec![request.hash]).await;
                m.tx.send(verdict(allowed)).await.ok();
            }
            ProviderMessage::GetManyRequestReceived(m) => {
                let hashes = m.inner.request.hashes.clone();
                let allowed = shared.may_fetch(m.inner.connection_id, hashes).await;
                m.tx.send(verdict(allowed)).await.ok();
            }
            ProviderMessage::ObserveRequestReceived(m) => {
                let allowed = shared.may_fetch(m.inner.connection_id, vec![m.inner.request.hash]).await;
                m.tx.send(verdict(allowed)).await.ok();
            }
            ProviderMessage::PushRequestReceived(m) => {
                m.tx.send(verdict(false)).await.ok();
            }
            ProviderMessage::Throttle(m) => {
                m.tx.send(verdict(true)).await.ok();
            }
            _ => {}
        }
    }
}
