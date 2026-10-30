//! A store that counts what it asks its backend, as S3 requests: `get` is a GET, `get_range` a HEAD and a GET, `has`
//! a HEAD, `put` a HEAD and a PUT (db/store/src/dal.rs).

use std::ops::Range;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

use aven_db_store::{Hash, RefName, Result, Store};
use bytes::Bytes;

pub struct Counted<S> {
    pub inner: S,
    pub gets: AtomicU64,
    pub heads: AtomicU64,
    pub puts: AtomicU64,
    pub bytes_read: AtomicU64,
}

impl<S> Counted<S> {
    pub fn new(inner: S) -> Self {
        Self { inner, gets: 0.into(), heads: 0.into(), puts: 0.into(), bytes_read: 0.into() }
    }
    /// (GETs, HEADs, PUTs, bytes read), and back to zero
    pub fn take(&self) -> (u64, u64, u64, u64) {
        (self.gets.swap(0, Relaxed), self.heads.swap(0, Relaxed), self.puts.swap(0, Relaxed), self.bytes_read.swap(0, Relaxed))
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl<S: Store + Send + Sync> Store for Counted<S> {
    async fn put(&self, bytes: Bytes) -> Result<Hash> {
        self.heads.fetch_add(1, Relaxed);
        self.puts.fetch_add(1, Relaxed);
        self.inner.put(bytes).await
    }
    async fn get(&self, hash: &Hash) -> Result<Option<Bytes>> {
        self.gets.fetch_add(1, Relaxed);
        let got = self.inner.get(hash).await?;
        self.bytes_read.fetch_add(got.as_ref().map_or(0, |b| b.len() as u64), Relaxed);
        Ok(got)
    }
    async fn get_range(&self, hash: &Hash, range: Range<u64>) -> Result<Option<Bytes>> {
        self.heads.fetch_add(1, Relaxed);
        let got = self.inner.get_range(hash, range).await?;
        if let Some(b) = &got {
            if !b.is_empty() {
                self.gets.fetch_add(1, Relaxed);
                self.bytes_read.fetch_add(b.len() as u64, Relaxed);
            }
        }
        Ok(got)
    }
    async fn has(&self, hash: &Hash) -> Result<bool> {
        self.heads.fetch_add(1, Relaxed);
        self.inner.has(hash).await
    }
    async fn list(&self) -> Result<Vec<Hash>> {
        self.inner.list().await
    }
    async fn delete(&self, hash: &Hash) -> Result<()> {
        self.inner.delete(hash).await
    }
    async fn get_ref(&self, name: &RefName) -> Result<Option<Hash>> {
        self.gets.fetch_add(1, Relaxed);
        self.inner.get_ref(name).await
    }
    async fn set_ref(&self, name: &RefName, expected: Option<Hash>, new: Hash) -> Result<()> {
        self.inner.set_ref(name, expected, new).await
    }
    async fn delete_ref(&self, name: &RefName, expected: Hash) -> Result<()> {
        self.inner.delete_ref(name, expected).await
    }
    async fn list_refs(&self) -> Result<Vec<RefName>> {
        self.inner.list_refs().await
    }
}
