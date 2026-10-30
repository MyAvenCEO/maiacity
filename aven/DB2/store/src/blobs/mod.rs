//! Moving blobs between peers (README, "One of each"): iroh-blobs' protocol, `/iroh-bytes/4`, on this store through
//! one adapter ([`actor`]). Verified ranges, resume, hash sequences, several holders at once are iroh-blobs'; where
//! the bytes rest is ours, whole or absent. iroh-blobs is 0.x and breaks about monthly, so no type of it leaves this
//! module: a peer mounts [`Blobs::provider`] on its Router under [`ALPN`] and fetches with [`Blobs::fetch_file`] and
//! [`Blobs::fetch_chunks`], in our hashes and iroh's connections.

mod actor;

use std::ops::Range;
use std::sync::Arc;

use bao_tree::ChunkRanges;
use iroh::EndpointId;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh_blobs::BlobsProtocol;
use iroh_blobs::protocol::{ChunkRangesSeq, GetRequest, ObserveRequest, RangeSpec};
use iroh_blobs::provider::events::{AbortReason, ConnectMode, EventMask, EventSender, ProviderMessage};

use crate::{Hash, Store};

/// iroh-blobs' protocol, as a peer's Router names it.
pub const ALPN: &[u8] = iroh_blobs::ALPN;

/// The store the adapter serves from and fetches into. In a browser it is neither `Send` nor `Sync`, and iroh's
/// handlers must be: the adapter keeps it in a task of its own, and only channels cross to iroh-blobs.
#[cfg(not(target_arch = "wasm32"))]
pub type Shared = Arc<dyn Store + Send + Sync>;
#[cfg(target_arch = "wasm32")]
pub type Shared = Arc<dyn Store>;

/// Whom a provider serves, asked once per connection after the door (README rule 9: the door is checked twice).
pub type Admit = Arc<dyn Fn(&EndpointId) -> bool + Send + Sync>;

/// One peer's blobs, as iroh-blobs moves them.
#[derive(Clone)]
pub struct Blobs {
    api: iroh_blobs::api::Store,
    /// the store itself, to read an index fetched before a failure
    store: Shared,
}

impl std::fmt::Debug for Blobs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Blobs")
    }
}

/// Why a fetch failed: the holder hasn't the blob, or anything else (it couldn't be reached, it refused, the bytes
/// didn't check). A page answers the first with 404 and the rest with 502.
#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum FetchError {
    /// The holder said it hasn't this blob: the file's index, or a chunk asked for.
    #[error("not found: the holder has no blob {0}")]
    NotFound(Hash),
    #[error("fetch: {0}")]
    Failed(String),
}

/// What one fetch moved over the wire.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Fetched {
    /// The blobs' bytes that arrived; what was held already isn't asked for.
    pub bytes: u64,
}

fn failed(e: impl std::fmt::Display) -> FetchError {
    FetchError::Failed(e.to_string())
}

impl Blobs {
    pub fn new(store: Shared) -> Self {
        Self { api: actor::spawn(store.clone()), store }
    }

    /// The provider of `/iroh-bytes/4`: serves the connections `admit` lets in, each refused at once otherwise. Push,
    /// a remote writing into this store, stays off.
    pub fn provider(&self, admit: Admit) -> Provider {
        let mask = EventMask { connected: ConnectMode::Intercept, ..EventMask::DEFAULT };
        let (events, mut asked) = EventSender::channel(32, mask);
        n0_future::task::spawn(async move {
            while let Some(msg) = asked.recv().await {
                if let ProviderMessage::ClientConnected(msg) = msg {
                    let ok = msg.endpoint_id.is_some_and(|id| admit(&id));
                    msg.tx.send(if ok { Ok(()) } else { Err(AbortReason::Permission) }).await.ok();
                }
            }
        });
        Provider(BlobsProtocol::new(&self.api, Some(events)))
    }

    /// A whole file, its index and every chunk, from the peer at the other end of `conn`: only what isn't held.
    pub async fn fetch_file(&self, conn: &Connection, file: Hash) -> Result<Fetched, FetchError> {
        self.fetch(conn, GetRequest::new(actor::theirs(file), ChunkRangesSeq::all()), file, None).await
    }

    /// A file's index and its chunks `chunks` (by their place in the file): a seek is the chunks its range touches
    /// ([`crate::files::touched`]). Only what isn't held is asked for, in one request.
    pub async fn fetch_chunks(&self, conn: &Connection, file: Hash, chunks: Range<u64>) -> Result<Fetched, FetchError> {
        let mut req = GetRequest::builder().root(ChunkRanges::all());
        for i in chunks.clone() {
            req = req.child(i, ChunkRanges::all());
        }
        self.fetch(conn, req.build(actor::theirs(file)), file, Some(chunks)).await
    }

    /// One blob.
    pub async fn fetch_blob(&self, conn: &Connection, hash: Hash) -> Result<Fetched, FetchError> {
        self.fetch(conn, GetRequest::blob(actor::theirs(hash)), hash, Some(0..0)).await
    }

    /// `req` for `root` and its children `children` (all of them: `None`). A holder that hasn't a blob asked for
    /// resets the stream as it does for any trouble, so after a failure the holder is asked what it has of the root and
    /// of each child asked for: one it says it lacks is [`FetchError::NotFound`].
    async fn fetch(
        &self,
        conn: &Connection,
        req: GetRequest,
        root: Hash,
        children: Option<Range<u64>>,
    ) -> Result<Fetched, FetchError> {
        let remote = self.api.remote();
        let local = remote.local_for_request(req).await.map_err(failed)?;
        if local.is_complete() {
            return Ok(Fetched::default());
        }
        match remote.execute_get(conn.clone(), local.missing()).await {
            Ok(stats) => Ok(Fetched { bytes: stats.payload_bytes_read }),
            Err(e) => Err(match self.lacking(conn, root, children).await {
                Some(missing) => FetchError::NotFound(missing),
                None => failed(e),
            }),
        }
    }

    /// The first blob of `root` and its children that the holder says it hasn't, by an observe request; `None` when it
    /// has them all, or doesn't answer.
    async fn lacking(&self, conn: &Connection, root: Hash, children: Option<Range<u64>>) -> Option<Hash> {
        if !self.holds(conn, root).await? {
            return Some(root);
        }
        let file = crate::files::open(&*self.store, &root).await.ok()??;
        let children = children.unwrap_or(0..file.chunks.len() as u64);
        for i in children {
            let chunk = *file.chunks.get(i as usize)?;
            if !self.holds(conn, chunk).await? {
                return Some(chunk);
            }
        }
        None
    }

    /// Whether the holder says it has `hash`, or `None` without an answer.
    async fn holds(&self, conn: &Connection, hash: Hash) -> Option<bool> {
        use n0_future::StreamExt;
        let ask = ObserveRequest { hash: actor::theirs(hash), ranges: RangeSpec::all() };
        let mut answers = std::pin::pin!(self.api.remote().observe(conn.clone(), ask));
        let bits = answers.next().await?.ok()?;
        Some(!bits.is_empty())
    }
}

/// `/iroh-bytes/4` on a Router, members only.
#[derive(Clone, Debug)]
pub struct Provider(BlobsProtocol);

impl ProtocolHandler for Provider {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        self.0.accept(conn).await
    }
}
