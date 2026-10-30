//! The contract (SANDBOX.md, "Storage"): blobs and refs, like git's objects and refs. Small and async, and free of
//! any backend's types, so the core depends on this and nothing else.

use std::ops::Range;

use bytes::Bytes;

use crate::{Hash, RefName};

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    /// Compare-and-set refused: the ref no longer holds what the writer expected.
    #[error("stale: the ref holds {current:?}")]
    Stale { current: Option<Hash> },
    /// A range that isn't inside the blob.
    #[error("range {start}..{end} is outside the blob's {len} bytes")]
    Range { start: u64, end: u64, len: u64 },
    #[error("invalid ref name {0:?}")]
    InvalidName(String),
    /// Bytes at rest that don't match their name, or a ref that doesn't hold a hash.
    #[error("corrupt: {0}")]
    Corrupt(String),
    /// Anything the backend reports, as text: no backend's error types cross the contract.
    #[error("backend: {0}")]
    Backend(String),
}

/// Where a peer's blobs and refs rest. One writer per store (README, rule 1): a store need not defend against a
/// second one, but a crash mid-write never corrupts it, and every change is atomic.
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait Store {
    /// Stores `bytes` and returns their BLAKE3 hash, which the store computes. The same bytes twice keep one blob.
    async fn put(&self, bytes: Bytes) -> Result<Hash>;
    /// The whole blob, checked against its hash, or `None`.
    async fn get(&self, hash: &Hash) -> Result<Option<Bytes>>;
    /// The bytes `range` of a blob, or `None`. A range not inside the blob is [`Error::Range`]; an empty one is empty.
    async fn get_range(&self, hash: &Hash, range: Range<u64>) -> Result<Option<Bytes>>;
    async fn has(&self, hash: &Hash) -> Result<bool>;
    /// A blob's length in bytes, or `None`, without reading it: one stat (a HEAD on S3).
    async fn size(&self, hash: &Hash) -> Result<Option<u64>>;
    /// Every blob's hash, sorted.
    async fn list(&self) -> Result<Vec<Hash>>;
    /// Removes a blob; removing one that isn't there is fine.
    async fn delete(&self, hash: &Hash) -> Result<()>;

    async fn get_ref(&self, name: &RefName) -> Result<Option<Hash>>;
    /// Points `name` at `new` if it holds `expected` (`None`: it doesn't exist yet); otherwise [`Error::Stale`].
    async fn set_ref(&self, name: &RefName, expected: Option<Hash>, new: Hash) -> Result<()>;
    /// Removes `name` if it holds `expected`; otherwise [`Error::Stale`].
    async fn delete_ref(&self, name: &RefName, expected: Hash) -> Result<()>;
    /// Every ref's name, sorted.
    async fn list_refs(&self) -> Result<Vec<RefName>>;
}
