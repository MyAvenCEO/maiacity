//! The opfs driver (store/README.md, "What the store asks of the opfs driver"): the `Store` contract written directly
//! on a [`Folder`], OPFS's sync access handles in a Peer-Light. Every write goes to a temporary file named by its place
//! (`tmp/blob-<hash>`, `tmp/ref-<name>`), then moves into place, or is copied where the folder can't move. Opening
//! recovers what a crash left: a whole temporary file rolls forward, every other one goes (Lean: `Aven.DB.StoreCrash`,
//! `crash_atomic`).

use std::ops::Range;

use async_lock::Mutex;
use bytes::Bytes;

use crate::folder::Folder;
use crate::{Error, Hash, RefName, Result, Store};

pub struct OpfsStore<F> {
    folder: F,
    /// Every write takes its turn under this lock: compare-and-set reads, compares and writes in one turn, and two
    /// puts of the same bytes never share a temporary file.
    writes: Mutex<()>,
}

fn blob_path(h: &Hash) -> String {
    format!("blobs/{h}")
}

fn ref_path(n: &RefName) -> String {
    format!("refs/{n}")
}

impl<F: Folder> OpfsStore<F> {
    /// Opens the store on `folder`, recovering what a crash left there.
    pub async fn open(folder: F) -> Result<Self> {
        let store = Self { folder, writes: Mutex::new(()) };
        store.recover().await?;
        Ok(store)
    }

    pub fn folder(&self) -> &F {
        &self.folder
    }

    /// Lean's `recover`: a whole temporary file rolls forward into place, whatever the place holds; every other
    /// temporary file is removed.
    async fn recover(&self) -> Result<()> {
        for name in self.folder.list("tmp").await? {
            let tmp = format!("tmp/{name}");
            if let Some(to) = self.whole(&name, &tmp).await? {
                self.place(&tmp, &to).await?;
            }
            self.folder.remove(&tmp).await?;
        }
        Ok(())
    }

    /// Where the temporary file `name` goes, if it is whole: a blob's bytes that hash to its name, a ref's value that
    /// is a hash.
    async fn whole(&self, name: &str, tmp: &str) -> Result<Option<String>> {
        let Some(bytes) = self.folder.read(tmp, None).await? else {
            return Ok(None);
        };
        if let Some(hex) = name.strip_prefix("blob-")
            && let Ok(h) = hex.parse::<Hash>()
            && Hash::of(&bytes) == h
        {
            return Ok(Some(blob_path(&h)));
        }
        if let Some(n) = name.strip_prefix("ref-")
            && let Ok(n) = RefName::new(n)
            && std::str::from_utf8(&bytes).is_ok_and(|v| v.parse::<Hash>().is_ok())
        {
            return Ok(Some(ref_path(&n)));
        }
        Ok(None)
    }

    /// Moves `tmp` onto `to`, or copies it where the folder can't move: write `to` whole, then remove `tmp`.
    async fn place(&self, tmp: &str, to: &str) -> Result<()> {
        if self.folder.rename(tmp, to).await? {
            return Ok(());
        }
        let bytes = self
            .folder
            .read(tmp, None)
            .await?
            .ok_or_else(|| Error::Backend(format!("{tmp} vanished")))?;
        self.folder.write(to, &bytes).await?;
        self.folder.remove(tmp).await
    }

    /// Writes `bytes` to the temporary file `tmp/<name>`, then into place at `to`.
    async fn write(&self, name: &str, to: &str, bytes: &[u8]) -> Result<()> {
        let tmp = format!("tmp/{name}");
        self.folder.write(&tmp, bytes).await?;
        self.place(&tmp, to).await
    }

    async fn read_ref(&self, n: &RefName) -> Result<Option<Hash>> {
        let Some(bytes) = self.folder.read(&ref_path(n), None).await? else {
            return Ok(None);
        };
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| Error::Corrupt(format!("ref {n} isn't text")))?;
        text.parse().map(Some)
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl<F: Folder> Store for OpfsStore<F> {
    async fn put(&self, bytes: Bytes) -> Result<Hash> {
        let h = Hash::of(&bytes);
        let _turn = self.writes.lock().await;
        if self.folder.size(&blob_path(&h)).await?.is_none() {
            self.write(&format!("blob-{h}"), &blob_path(&h), &bytes).await?;
        }
        Ok(h)
    }

    async fn get(&self, h: &Hash) -> Result<Option<Bytes>> {
        let Some(bytes) = self.folder.read(&blob_path(h), None).await? else {
            return Ok(None);
        };
        if Hash::of(&bytes) != *h {
            return Err(Error::Corrupt(format!("blob {h} doesn't match its name")));
        }
        Ok(Some(bytes))
    }

    async fn get_range(&self, h: &Hash, range: Range<u64>) -> Result<Option<Bytes>> {
        let Some(len) = self.folder.size(&blob_path(h)).await? else {
            return Ok(None);
        };
        if range.start > range.end || range.end > len {
            return Err(Error::Range { start: range.start, end: range.end, len });
        }
        if range.is_empty() {
            return Ok(Some(Bytes::new()));
        }
        self.folder.read(&blob_path(h), Some(range)).await
    }

    async fn has(&self, h: &Hash) -> Result<bool> {
        Ok(self.folder.size(&blob_path(h)).await?.is_some())
    }

    async fn list(&self) -> Result<Vec<Hash>> {
        let mut out = self
            .folder
            .list("blobs")
            .await?
            .iter()
            .map(|n| n.parse())
            .collect::<Result<Vec<Hash>>>()?;
        out.sort();
        Ok(out)
    }

    async fn delete(&self, h: &Hash) -> Result<()> {
        let _turn = self.writes.lock().await;
        self.folder.remove(&blob_path(h)).await
    }

    async fn get_ref(&self, n: &RefName) -> Result<Option<Hash>> {
        self.read_ref(n).await
    }

    async fn set_ref(&self, n: &RefName, expected: Option<Hash>, new: Hash) -> Result<()> {
        let _turn = self.writes.lock().await;
        let current = self.read_ref(n).await?;
        if current != expected {
            return Err(Error::Stale { current });
        }
        self.write(&format!("ref-{n}"), &ref_path(n), new.to_hex().as_bytes()).await
    }

    async fn delete_ref(&self, n: &RefName, expected: Hash) -> Result<()> {
        let _turn = self.writes.lock().await;
        let current = self.read_ref(n).await?;
        if current != Some(expected) {
            return Err(Error::Stale { current });
        }
        self.folder.remove(&ref_path(n)).await
    }

    async fn list_refs(&self) -> Result<Vec<RefName>> {
        let mut out = self
            .folder
            .list("refs")
            .await?
            .into_iter()
            .map(RefName::new)
            .collect::<Result<Vec<RefName>>>()?;
        out.sort();
        Ok(out)
    }
}
