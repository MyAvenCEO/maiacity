//! The McEliece keys in iroh-blobs, and the gate of a node's blob store. A node offers the keys its replies name, each
//! by its id, the BLAKE3 hash iroh-blobs names it by, and its gate hands each out only to a device a hello proved that
//! may fetch it by the node's view; iroh-blobs verifies every byte the asker fetches against that hash, so a peer can
//! serve no other bytes for it. The sealed pieces of files are in the same store (`files`), and the gate hands those
//! out by the same rule (T27), whatever anyone's holdings say (`holdings`).
//!
//! A node fetches every blob over one pool of blob connections (S1), one to each peer, which closes once it has been
//! idle a while; the McEliece keys a reply names in one request (GetMany), or one at a time if the peer refuses that.
//! A blob connection says no hello of its own (S2): the gate lets one in only from an endpoint with a live sync
//! connection, whose hello proved its device, and lets it fetch only while that connection lives, as that device. So
//! one who could forge that device's ed25519 key, as a quantum computer could, might fetch the keys and sealed files
//! the device may while it is connected; but a McEliece key is a public key, and a sealed file opens only under the key
//! in the write that brings it: the gate keeps others from learning whom a node seals to and what it keeps, and keeps
//! nothing secret.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context as _, Result, ensure};
use avendb::id::BlobId;
use avendb::lab::Lab;
use avendb::sealed::FileRoot;
use iroh::EndpointId;
use iroh_blobs::Hash;
use iroh_blobs::protocol::{GetManyRequest, GetRequest};
use iroh_blobs::provider::events::{
    AbortReason, ConnectMode, EventMask, EventResult, EventSender, ObserveMode, ProviderMessage, RequestMode,
    ThrottleMode,
};
use n0_future::time;
use tokio::sync::mpsc;

use crate::Shared;

/// How long a node waits for a McEliece key, a megabyte or so, once asked for.
const FETCH: Duration = Duration::from_secs(60);

/// The McEliece keys in a node's blob store, each by its id, the hash the store holds it by.
pub(crate) type Offered = HashSet<BlobId>;

/// The hash iroh-blobs names a blob by: its id.
fn hash(id: BlobId) -> Hash {
    Hash::from_bytes(id.0)
}

impl Shared {
    /// The McEliece keys `ids`, each put in the blob store first if it isn't there: a key fetched into a page's window
    /// may have left it since.
    pub(crate) async fn offer(self: &Arc<Self>, ids: Vec<BlobId>) -> Result<Vec<BlobId>> {
        let _activity = self.admit()?;
        for &id in &ids {
            let known = self.offered.lock().expect("offered").contains(&id);
            if known && self.store.has(hash(id)).await? {
                continue;
            }
            let key = self.read(move |lab, me| lab.blob(me, id)).await.context("a key the node holds")?;
            let stored = self.store.add_bytes(key.to_vec()).temp_tag().await?.hash();
            ensure!(stored == hash(id), "the key the node holds as {} is another's", id.to_hex());
            self.offered.lock().expect("offered").insert(id);
        }
        Ok(ids)
    }

    /// The McEliece keys `wanted`, each by its id, fetched from `endpoint` over iroh-blobs, through the node's pool of
    /// blob connections, in one request: each that arrives whole, which iroh-blobs verified to be the key its id names.
    /// A peer that refuses them together, as it may not hand one, is asked for each alone.
    pub(crate) async fn fetch(self: &Arc<Self>, endpoint: EndpointId, wanted: Vec<BlobId>) -> Vec<Arc<[u8]>> {
        let Ok(_activity) = self.admit() else { return Vec::new() };
        if wanted.is_empty() {
            return Vec::new();
        }
        let Ok(conn) = self.pool.get_or_connect(endpoint).await else { return Vec::new() };
        let (remote, hashes) = (self.store.remote(), wanted.iter().map(|&id| hash(id)));
        let wait = FETCH.saturating_mul(wanted.len().min(64) as u32);
        let all = remote.execute_get_many((*conn).clone(), hashes.collect::<GetManyRequest>());
        if !matches!(time::timeout(wait, all.into_future()).await, Ok(Ok(_))) {
            for &id in &wanted {
                let one = remote.execute_get((*conn).clone(), GetRequest::blob(hash(id)));
                time::timeout(FETCH, one.into_future()).await.ok();
            }
        }
        let mut keys = Vec::new();
        for id in wanted {
            let Ok(key) = self.store.get_bytes(hash(id)).await else { continue };
            self.offered.lock().expect("offered").insert(id);
            keys.push(Arc::from(&key[..]));
        }
        keys
    }

    /// The device of blob connection `connection` may fetch each of `hashes`: the sync connection that let it in still
    /// lives, and each is a McEliece key this node offered, named by an edit that device may receive by this node's
    /// view, following the vaults its last request on that connection named (`Lab::may_fetch`); or else a file's
    /// root, or one of its pieces, brought by such an edit (`Lab::may_fetch_file`, T27). Whatever anyone's holdings
    /// say.
    async fn may_fetch(self: &Arc<Self>, connection: u64, hashes: Vec<Hash>) -> bool {
        let Ok(_activity) = self.admit() else { return false };
        let Some((device, endpoint)) = self.blob_peers.lock().expect("blob peers").get(&connection).copied() else {
            return false;
        };
        let Some(sync) = self.live(endpoint).filter(|p| p.device == device) else {
            return false;
        };
        let follow = self.follows.lock().expect("follows").get(&sync.conn.stable_id()).cloned().unwrap_or_default();
        let asked: Vec<([u8; 32], Option<BlobId>, Vec<FileRoot>)> = {
            let (offered, pieces) = (self.offered.lock().expect("offered"), self.pieces.lock().expect("pieces"));
            let of = |h: &Hash| pieces.get(h).map(|roots| roots.iter().copied().collect()).unwrap_or_default();
            let key = |h: &Hash| offered.get(&BlobId(*h.as_bytes())).copied();
            hashes.iter().map(|h| (*h.as_bytes(), key(h), of(h))).collect()
        };
        let may = move |lab: &Lab, me| {
            let files = lab.files(me);
            asked.iter().all(|(hash, key, pieced)| match key {
                Some(b) => lab.may_fetch(me, device, *b, &follow),
                None => {
                    let mut roots = files.iter().filter(|f| f.hash == *hash).chain(pieced);
                    roots.any(|f| lab.may_fetch_file(me, device, f, &follow))
                }
            })
        };
        self.read(may).await
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

/// The blob provider's gate: it lets in a connection only from an endpoint with a live sync connection whose hello
/// proved its device (S2), and a request on it only while that connection lives, for blobs that device may fetch,
/// McEliece keys and the sealed pieces of files, any ranges of each blob alone: a request for a HashSeq with its
/// children is refused, as the gate would not weigh the children.
pub(crate) async fn gate(shared: Arc<Shared>, mut events: mpsc::Receiver<ProviderMessage>) {
    while let Some(event) = events.recv().await {
        let Ok(_activity) = shared.admit() else { break };
        match event {
            ProviderMessage::ClientConnected(m) => {
                let proven = |e| shared.live(e).map(|p| (p.device, e));
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
