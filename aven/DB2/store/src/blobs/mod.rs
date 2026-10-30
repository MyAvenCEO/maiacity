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
use iroh_blobs::provider::events::{
    AbortReason, ConnectMode, EventMask, EventSender, ProviderMessage,
};

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
    /// What was asked for as a file is a blob but no index, no list of 32-byte hashes: it never will be one.
    #[error("not a file: {0} is no list of hashes")]
    NotAFile(Hash),
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
        Self {
            api: actor::spawn(store.clone()),
            store,
        }
    }

    /// The provider of `/iroh-bytes/4`: serves the connections `admit` lets in, each refused at once otherwise. Push,
    /// a remote writing into this store, stays off.
    pub fn provider(&self, admit: Admit) -> Provider {
        let mask = EventMask {
            connected: ConnectMode::Intercept,
            ..EventMask::DEFAULT
        };
        let (events, mut asked) = EventSender::channel(32, mask);
        n0_future::task::spawn(async move {
            while let Some(msg) = asked.recv().await {
                if let ProviderMessage::ClientConnected(msg) = msg {
                    let ok = msg.endpoint_id.is_some_and(|id| admit(&id));
                    msg.tx
                        .send(if ok {
                            Ok(())
                        } else {
                            Err(AbortReason::Permission)
                        })
                        .await
                        .ok();
                }
            }
        });
        Provider(BlobsProtocol::new(&self.api, Some(events)))
    }

    /// A whole file, its index and every chunk, from the peer at the other end of `conn`: only what isn't held.
    pub async fn fetch_file(&self, conn: &Connection, file: Hash) -> Result<Fetched, FetchError> {
        self.fetch(
            conn,
            GetRequest::new(actor::theirs(file), ChunkRangesSeq::all()),
            file,
            Some(None),
        )
        .await
    }

    /// A file's index and its chunks `chunks` (by their place in the file): a seek is the chunks its range touches
    /// ([`crate::files::touched`]). Only what isn't held is asked for, in one request.
    pub async fn fetch_chunks(
        &self,
        conn: &Connection,
        file: Hash,
        chunks: Range<u64>,
    ) -> Result<Fetched, FetchError> {
        let mut req = GetRequest::builder().root(ChunkRanges::all());
        for i in chunks.clone() {
            req = req.child(i, ChunkRanges::all());
        }
        self.fetch(
            conn,
            req.build(actor::theirs(file)),
            file,
            Some(Some(chunks)),
        )
        .await
    }

    /// One blob.
    pub async fn fetch_blob(&self, conn: &Connection, hash: Hash) -> Result<Fetched, FetchError> {
        self.fetch(conn, GetRequest::blob(actor::theirs(hash)), hash, None)
            .await
    }

    /// `req` for `root` and, when `root` is a file's index (`file` is `Some`), its children: all of them (`None`) or
    /// those in a range. A holder that hasn't a blob asked for resets the stream as it does for any trouble, and a root
    /// that is no index ends the fetch the same way, so after a failure the holder is asked what it has: a blob it lacks
    /// is [`FetchError::NotFound`], a root it holds that is no list of hashes [`FetchError::NotAFile`].
    async fn fetch(
        &self,
        conn: &Connection,
        req: GetRequest,
        root: Hash,
        file: Option<Option<Range<u64>>>,
    ) -> Result<Fetched, FetchError> {
        let remote = self.api.remote();
        let local = remote.local_for_request(req).await.map_err(failed)?;
        if local.is_complete() {
            return Ok(Fetched::default());
        }
        match remote.execute_get(conn.clone(), local.missing()).await {
            Ok(stats) => Ok(Fetched {
                bytes: stats.payload_bytes_read,
            }),
            Err(e) => Err(self
                .why(conn, root, file)
                .await
                .unwrap_or_else(|| failed(e))),
        }
    }

    /// Why a fetch of `root` (and, for a file, its children) failed, as the holder answers: a blob it says it hasn't,
    /// or a root that is no index; `None` when it has them all, or doesn't answer.
    async fn why(
        &self,
        conn: &Connection,
        root: Hash,
        file: Option<Option<Range<u64>>>,
    ) -> Option<FetchError> {
        let size = self.held_size(conn, root).await?;
        let Some(size) = size else {
            return Some(FetchError::NotFound(root));
        };
        let children = file?;
        let index = match crate::files::open(&*self.store, &root).await {
            Ok(Some(index)) => index,
            Err(crate::Error::Corrupt(_)) => return Some(FetchError::NotAFile(root)),
            // the root didn't arrive: the holder's word on its size says whether it can be an index
            Ok(None) | Err(_) if size % 32 != 0 => return Some(FetchError::NotAFile(root)),
            _ => return None,
        };
        let children = children.unwrap_or(0..index.chunks.len() as u64);
        for i in children {
            let chunk = *index.chunks.get(i as usize)?;
            if self.held_size(conn, chunk).await?.is_none() {
                return Some(FetchError::NotFound(chunk));
            }
        }
        None
    }

    /// The size of `hash` as the holder says it holds it: `Some(None)` when it hasn't it, `None` without an answer.
    async fn held_size(&self, conn: &Connection, hash: Hash) -> Option<Option<u64>> {
        use n0_future::StreamExt;
        let ask = ObserveRequest {
            hash: actor::theirs(hash),
            ranges: RangeSpec::all(),
        };
        let mut answers = std::pin::pin!(self.api.remote().observe(conn.clone(), ask));
        let bits = answers.next().await?.ok()?;
        Some((!bits.is_empty()).then(|| bits.size()))
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
