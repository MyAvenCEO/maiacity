//! A store that withholds some blobs: a peer's store as it serves files, where a file a retraction took reads as gone
//! (`Aven.DB.Chains`, "Deleting a line"), whether or not its bytes have left the store yet.

use std::collections::BTreeSet;
use std::ops::Range;
use std::sync::{Arc, RwLock};

use bytes::Bytes;

use crate::blobs::Shared;
use crate::{Hash, RefName, Result, Store};

/// The blobs of files a retraction took (aven-peer's `chats`, "Deleting"): never served again, whether or not their
/// bytes have left the store yet.
pub type Withheld = Arc<RwLock<BTreeSet<Hash>>>;

/// A peer's store as it serves files: a withheld blob reads as gone, so neither iroh-blobs' provider nor a Peer-Light's
/// /files/<hash> serves a deleted file, even while its bytes are still being deleted. Everything else passes through.
pub struct Withholding {
    pub store: Shared,
    pub withheld: Withheld,
}

impl Withholding {
    pub fn serving(store: Shared, withheld: Withheld) -> Shared {
        Arc::new(Withholding { store, withheld })
    }

    fn hides(&self, hash: &Hash) -> bool {
        self.withheld.read().unwrap().contains(hash)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Store for Withholding {
    async fn put(&self, bytes: Bytes) -> Result<Hash> {
        self.store.put(bytes).await
    }
    async fn get(&self, hash: &Hash) -> Result<Option<Bytes>> {
        if self.hides(hash) {
            return Ok(None);
        }
        self.store.get(hash).await
    }
    async fn get_range(&self, hash: &Hash, range: Range<u64>) -> Result<Option<Bytes>> {
        if self.hides(hash) {
            return Ok(None);
        }
        self.store.get_range(hash, range).await
    }
    async fn has(&self, hash: &Hash) -> Result<bool> {
        Ok(!self.hides(hash) && self.store.has(hash).await?)
    }
    async fn size(&self, hash: &Hash) -> Result<Option<u64>> {
        if self.hides(hash) {
            return Ok(None);
        }
        self.store.size(hash).await
    }
    async fn list(&self) -> Result<Vec<Hash>> {
        let mut all = self.store.list().await?;
        all.retain(|h| !self.hides(h));
        Ok(all)
    }
    async fn delete(&self, hash: &Hash) -> Result<()> {
        self.store.delete(hash).await
    }
    async fn get_ref(&self, name: &RefName) -> Result<Option<Hash>> {
        self.store.get_ref(name).await
    }
    async fn set_ref(&self, name: &RefName, expected: Option<Hash>, new: Hash) -> Result<()> {
        self.store.set_ref(name, expected, new).await
    }
    async fn delete_ref(&self, name: &RefName, expected: Hash) -> Result<()> {
        self.store.delete_ref(name, expected).await
    }
    async fn list_refs(&self) -> Result<Vec<RefName>> {
        self.store.list_refs().await
    }
}
