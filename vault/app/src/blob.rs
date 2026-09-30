//! A vault file read in place: its bytes by range from iroh's blob store (`BlobReader`), never copied out — the byte
//! source every reader of vault-media and vault-render takes (`Source::Blob`: AVFoundation through its resource loader,
//! stills, tars). The readers run on AVFoundation's queues and blocking threads, never on a tokio worker, so each read
//! waits on the app's runtime (`Handle::block_on`).

use std::{
    io::{self, SeekFrom},
    sync::{Arc, Mutex},
};

use iroh_blobs::{Hash, api::blobs::BlobStatus};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use vault_core::Vault;
use vault_media::{ByteSource, Source};

struct IrohBytes {
    reader: Mutex<iroh_blobs::api::blobs::BlobReader>,
    len: u64,
    rt: tokio::runtime::Handle,
}

impl ByteSource for IrohBytes {
    fn len(&self) -> u64 {
        self.len
    }

    fn read_at(&self, offset: u64, buf: &mut [u8]) -> io::Result<usize> {
        if offset >= self.len || buf.is_empty() {
            return Ok(0);
        }
        let mut reader = self.reader.lock().unwrap();
        self.rt.block_on(async {
            reader.seek(SeekFrom::Start(offset)).await?;
            reader.read(buf).await
        })
    }
}

/// A complete file of this vault, as a source read in place (`name`'s extension says what it is: AVFoundation tells a
/// movie by its type). Not complete here: an error, never a partial read.
pub async fn source(vault: &Vault, hash: Hash, name: &str) -> anyhow::Result<Source> {
    let len = match vault.store.blobs().status(hash).await? {
        BlobStatus::Complete { size } => size,
        _ => anyhow::bail!("{name}: its bytes are not all on this Mac (yet)"),
    };
    let bytes = IrohBytes { reader: Mutex::new(vault.store.blobs().reader(hash)), len, rt: tokio::runtime::Handle::current() };
    Ok(Source::blob(Arc::new(bytes), format!("{}.{}", hash.to_hex(), ext_of(name))))
}

/// The same, from a blocking thread (the render's library): waits on the runtime for the status.
pub fn source_blocking(vault: &Vault, rt: &tokio::runtime::Handle, hash: Hash, name: &str) -> anyhow::Result<Source> {
    let len = match rt.block_on(vault.store.blobs().status(hash))? {
        BlobStatus::Complete { size } => size,
        _ => anyhow::bail!("{name}: its bytes are not all on this Mac (yet)"),
    };
    let bytes = IrohBytes { reader: Mutex::new(vault.store.blobs().reader(hash)), len, rt: rt.clone() };
    Ok(Source::blob(Arc::new(bytes), format!("{}.{}", hash.to_hex(), ext_of(name))))
}

/// A file name's extension, lower case ("bin" without one).
pub fn ext_of(name: &str) -> String {
    std::path::Path::new(name).extension().map(|e| e.to_string_lossy().to_lowercase()).filter(|e| !e.is_empty()).unwrap_or_else(|| "bin".into())
}
