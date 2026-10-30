//! A file as a hash sequence: chunk blobs of at most 1 MiB and an index listing their hashes in order (iroh-blobs'
//! `HashSeq`: 32 bytes each), the file named by the index's hash.

use aven_db_store::{Hash, Result};
use bytes::Bytes;

pub const CHUNK: usize = 1 << 20;

/// Puts every chunk, then the index; returns the index's hash. A chunk at a time: never the whole file in memory.
pub async fn put(store: &crate::adapter::Shared, chunks: impl Iterator<Item = Bytes>) -> Result<Hash> {
    let mut index = Vec::new();
    for chunk in chunks {
        index.extend_from_slice(store.put(chunk).await?.as_bytes());
    }
    store.put(index.into()).await
}

/// The chunks' hashes an index lists.
pub fn chunks(index: &[u8]) -> Vec<Hash> {
    index
        .chunks_exact(32)
        .map(|h| h.iter().map(|b| format!("{b:02x}")).collect::<String>().parse().expect("hex"))
        .collect()
}

/// `n` chunks of random-looking bytes, the same for the same seed: BLAKE3's output stream.
pub fn random(seed: &str, size: u64) -> impl Iterator<Item = Bytes> {
    let mut xof = blake3::Hasher::new().update(seed.as_bytes()).finalize_xof();
    let n = size.div_ceil(CHUNK as u64);
    (0..n).map(move |i| {
        let len = (size - i * CHUNK as u64).min(CHUNK as u64) as usize;
        let mut buf = vec![0u8; len];
        xof.fill(&mut buf);
        Bytes::from(buf)
    })
}
