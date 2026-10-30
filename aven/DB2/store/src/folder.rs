//! What the opfs driver needs of a folder (store/README.md, "What the store asks of the opfs driver"): whole files
//! read, written and removed, and a move that replaces its target in one step. OPFS gives it through sync access
//! handles in the Peer-Light's worker; memory gives it to the tests, which crash it at every step.

use std::collections::BTreeMap;
use std::ops::Range;
use std::sync::{Arc, Mutex};

use bytes::Bytes;

use crate::{Error, Result};

/// Shared across threads natively, where the peers run on tokio; a browser's JS handles are not, and needn't be.
#[cfg(not(target_arch = "wasm32"))]
pub trait Shared: Send + Sync {}
#[cfg(not(target_arch = "wasm32"))]
impl<T: Send + Sync> Shared for T {}
#[cfg(target_arch = "wasm32")]
pub trait Shared {}
#[cfg(target_arch = "wasm32")]
impl<T> Shared for T {}

/// A folder of files under paths such as `blobs/<hash>`, `refs/<name>` and `tmp/ref-<name>`.
#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
pub trait Folder: Shared {
    /// The file's bytes `range`, all of them when `None`, or `None` when the file is missing. A range past the end
    /// gives what there is: the store checks ranges against the size first.
    async fn read(&self, path: &str, range: Option<Range<u64>>) -> Result<Option<Bytes>>;
    /// The file's length, or `None` when it is missing.
    async fn size(&self, path: &str) -> Result<Option<u64>>;
    /// Writes the file whole, replacing what it held, and flushes it.
    async fn write(&self, path: &str, bytes: &[u8]) -> Result<()>;
    /// Moves `from` onto `to` in one step, replacing `to`. `false`: this folder can't, and nothing changed; the store
    /// copies instead.
    async fn rename(&self, from: &str, to: &str) -> Result<bool>;
    /// Removes the file; a missing one is fine.
    async fn remove(&self, path: &str) -> Result<()>;
    /// The names of the files in `dir`, in any order.
    async fn list(&self, dir: &str) -> Result<Vec<String>>;
}

/// A folder in memory, shared by its clones: the tests' disk.
#[derive(Clone, Debug, Default)]
pub struct MemFolder {
    files: Arc<Mutex<BTreeMap<String, Vec<u8>>>>,
    /// Whether `rename` works, or the store has to copy.
    pub moves: bool,
}

impl MemFolder {
    pub fn new(moves: bool) -> Self {
        Self {
            files: Arc::default(),
            moves,
        }
    }

    /// Every file and its bytes.
    pub fn files(&self) -> BTreeMap<String, Vec<u8>> {
        self.files.lock().expect("files").clone()
    }

    /// A folder of its own holding these files.
    pub fn with_files(files: BTreeMap<String, Vec<u8>>, moves: bool) -> Self {
        Self {
            files: Arc::new(Mutex::new(files)),
            moves,
        }
    }

    /// Sets a file's bytes directly, as a crash leaves them.
    pub fn set(&self, path: &str, bytes: &[u8]) {
        self.files
            .lock()
            .expect("files")
            .insert(path.into(), bytes.to_vec());
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Folder for MemFolder {
    async fn read(&self, path: &str, range: Option<Range<u64>>) -> Result<Option<Bytes>> {
        let files = self.files.lock().expect("files");
        Ok(files.get(path).map(|b| match range {
            None => Bytes::copy_from_slice(b),
            Some(r) => {
                let end = (r.end as usize).min(b.len());
                Bytes::copy_from_slice(&b[(r.start as usize).min(end)..end])
            }
        }))
    }

    async fn size(&self, path: &str) -> Result<Option<u64>> {
        Ok(self
            .files
            .lock()
            .expect("files")
            .get(path)
            .map(|b| b.len() as u64))
    }

    async fn write(&self, path: &str, bytes: &[u8]) -> Result<()> {
        self.set(path, bytes);
        Ok(())
    }

    async fn rename(&self, from: &str, to: &str) -> Result<bool> {
        if !self.moves {
            return Ok(false);
        }
        let mut files = self.files.lock().expect("files");
        let bytes = files
            .remove(from)
            .ok_or_else(|| Error::Backend(format!("{from} isn't there to move")))?;
        files.insert(to.into(), bytes);
        Ok(true)
    }

    async fn remove(&self, path: &str) -> Result<()> {
        self.files.lock().expect("files").remove(path);
        Ok(())
    }

    async fn list(&self, dir: &str) -> Result<Vec<String>> {
        let prefix = format!("{dir}/");
        Ok(self
            .files
            .lock()
            .expect("files")
            .keys()
            .filter_map(|k| k.strip_prefix(&prefix).map(str::to_owned))
            .collect())
    }
}
