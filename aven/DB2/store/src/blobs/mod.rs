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
use iroh_blobs::protocol::{ChunkRangesSeq, GetRequest};
use iroh_blobs::provider::events::{AbortReason, ConnectMode, EventMask, EventSender, ProviderMessage};

use crate::{Error, Hash, Result, Store};

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
#[derive(Clone, Debug)]
pub struct Blobs(iroh_blobs::api::Store);

/// What one fetch moved over the wire.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Fetched {
    /// The blobs' bytes that arrived; what was held already isn't asked for.
    pub bytes: u64,
}

fn failed(e: impl std::fmt::Display) -> Error {
    Error::Backend(format!("fetch: {e}"))
}

impl Blobs {
    pub fn new(store: Shared) -> Self {
        Self(actor::spawn(store))
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
        Provider(BlobsProtocol::new(&self.0, Some(events)))
    }

    /// A whole file, its index and every chunk, from the peer at the other end of `conn`: only what isn't held.
    pub async fn fetch_file(&self, conn: &Connection, file: Hash) -> Result<Fetched> {
        self.fetch(conn, GetRequest::new(actor::theirs(file), ChunkRangesSeq::all())).await
    }

    /// A file's index and its chunks `chunks` (by their place in the file): a seek is the chunks its range touches
    /// ([`crate::files::touched`]). Only what isn't held is asked for, in one request.
    pub async fn fetch_chunks(&self, conn: &Connection, file: Hash, chunks: Range<u64>) -> Result<Fetched> {
        let mut req = GetRequest::builder().root(ChunkRanges::all());
        for i in chunks {
            req = req.child(i, ChunkRanges::all());
        }
        self.fetch(conn, req.build(actor::theirs(file))).await
    }

    /// One blob.
    pub async fn fetch_blob(&self, conn: &Connection, hash: Hash) -> Result<Fetched> {
        self.fetch(conn, GetRequest::blob(actor::theirs(hash))).await
    }

    async fn fetch(&self, conn: &Connection, req: GetRequest) -> Result<Fetched> {
        let remote = self.0.remote();
        let local = remote.local_for_request(req).await.map_err(failed)?;
        if local.is_complete() {
            return Ok(Fetched::default());
        }
        let stats = remote.execute_get(conn.clone(), local.missing()).await.map_err(failed)?;
        Ok(Fetched { bytes: stats.payload_bytes_read })
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
