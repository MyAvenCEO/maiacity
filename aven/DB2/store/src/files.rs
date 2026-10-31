//! A file is a hash sequence (README, "Big files are hash sequences"): chunk blobs of at most 1 MiB, every one but the
//! last exactly 1 MiB, and an index listing their hashes in order, 32 bytes each (iroh-blobs' `HashSeq`). The file is
//! named by its index's hash. The contract stays as it is: each chunk and the index are ordinary blobs, whole or absent,
//! and what a peer holds of a file is which of its chunks it has.

use std::ops::Range;

use bytes::{Bytes, BytesMut};

use crate::{Error, Hash, Result, Store};

/// A chunk's size: every chunk of a file is this long but the last, which is 1 to this many bytes.
pub const CHUNK: u64 = 1 << 20;

/// The largest blob a peer fetches: a chunk, and room for framing (`Aven.DB.Files.maxBlob`). Checked before anything
/// is allocated for a fetched blob, whatever size its holder claims.
pub const MAX_BLOB: u64 = CHUNK + 64 * 1024;

/// The largest file the city-dome takes, 32 GiB (`Aven.DB.Files.maxFile`): its index still fits in one chunk.
pub const MAX_FILE: u64 = 32 << 30;

/// Puts a file's chunks, then its index, and returns the file's name, its index's hash. The chunks come one at a time,
/// so a file of several GB never sits in memory; each must be `CHUNK` long but the last.
pub async fn put<S: Store + ?Sized>(
    store: &S,
    chunks: impl IntoIterator<Item = Bytes>,
) -> Result<Hash> {
    let mut index = BytesMut::new();
    let mut short = false;
    for chunk in chunks {
        if short || chunk.is_empty() || chunk.len() as u64 > CHUNK {
            return Err(Error::Backend(
                "a file's chunks are 1 MiB, the last 1 byte to 1 MiB".into(),
            ));
        }
        short = (chunk.len() as u64) < CHUNK;
        index.extend_from_slice(store.put(chunk).await?.as_bytes());
    }
    store.put(index.freeze()).await
}

/// `bytes` as a file's chunks.
pub fn split(bytes: Bytes) -> impl Iterator<Item = Bytes> {
    let n = (bytes.len() as u64).div_ceil(CHUNK);
    (0..n).map(move |i| {
        bytes.slice((i * CHUNK) as usize..((i + 1) * CHUNK).min(bytes.len() as u64) as usize)
    })
}

/// The chunks an index lists, or `Corrupt` for bytes that are no index.
pub fn chunks(index: &[u8]) -> Result<Vec<Hash>> {
    if !index.len().is_multiple_of(32) {
        return Err(Error::Corrupt(
            "an index is a list of 32-byte hashes".into(),
        ));
    }
    Ok(index
        .as_chunks::<32>()
        .0
        .iter()
        .map(|h| Hash::from_bytes(*h))
        .collect())
}

/// The chunks a file's byte range lies in.
pub fn touched(range: &Range<u64>) -> Range<u64> {
    if range.start >= range.end {
        return 0..0;
    }
    range.start / CHUNK..range.end.div_ceil(CHUNK)
}

/// A file this store holds the index of: its chunks and its length.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct File {
    pub name: Hash,
    pub chunks: Vec<Hash>,
    pub len: u64,
}

/// Reads a file's index, and its length from its last chunk's size; `None` without the index. A file whose last chunk
/// isn't here yet has its length counted as if that chunk were whole, until it is. An index of more chunks than
/// [`MAX_FILE`] holds, or a last chunk empty or longer than `CHUNK`, is `Corrupt`.
pub async fn open<S: Store + ?Sized>(store: &S, name: &Hash) -> Result<Option<File>> {
    let Some(index) = store.get(name).await? else {
        return Ok(None);
    };
    let chunks = chunks(&index)?;
    if chunks.len() as u64 > MAX_FILE / CHUNK {
        return Err(Error::Corrupt("a file past the largest one".into()));
    }
    let len = match chunks.last() {
        None => 0,
        Some(last) => {
            let size = store.size(last).await?.unwrap_or(CHUNK);
            if size == 0 || size > CHUNK {
                return Err(Error::Corrupt(format!("a last chunk of {size} bytes")));
            }
            (chunks.len() as u64 - 1) * CHUNK + size
        }
    };
    Ok(Some(File {
        name: *name,
        chunks,
        len,
    }))
}

impl File {
    /// Which of the chunks `range` touches this store lacks, by their place in the file.
    pub async fn missing<S: Store + ?Sized>(
        &self,
        store: &S,
        range: Range<u64>,
    ) -> Result<Vec<u64>> {
        let mut out = Vec::new();
        for i in touched(&(range.start..range.end.min(self.len))) {
            if !store.has(&self.chunks[i as usize]).await? {
                out.push(i);
            }
        }
        Ok(out)
    }

    /// The file's bytes `range`, read from the chunks it touches, each checked whole against its hash; `None` while
    /// one of them isn't here. A range not inside the file is [`Error::Range`].
    pub async fn read<S: Store + ?Sized>(
        &self,
        store: &S,
        range: Range<u64>,
    ) -> Result<Option<Bytes>> {
        let Range { start, end } = range;
        if start > end || end > self.len {
            return Err(Error::Range {
                start,
                end,
                len: self.len,
            });
        }
        let mut out = BytesMut::with_capacity((end - start) as usize);
        for i in touched(&range) {
            let Some(chunk) = store.get(&self.chunks[i as usize]).await? else {
                return Ok(None);
            };
            self.fits(i, chunk.len() as u64)?;
            let at = i * CHUNK;
            let from = start.max(at) - at;
            let to = end.min(at + chunk.len() as u64) - at;
            if from > to {
                // the last chunk arrived shorter than the length counted while it was missing
                return Err(Error::Range {
                    start,
                    end,
                    len: at + chunk.len() as u64,
                });
            }
            out.extend_from_slice(&chunk[from as usize..to as usize]);
        }
        Ok(Some(out.freeze()))
    }

    /// Whether chunk `i`, `len` bytes long, is cut as it must be (`Aven.DB.Files.fits`): every chunk but the last is
    /// exactly `CHUNK`, the last 1 to `CHUNK` bytes. Anything else is `Corrupt`: a malformed file, never a panic.
    pub fn fits(&self, i: u64, len: u64) -> Result<()> {
        let last = self.chunks.len() as u64 - 1;
        let ok = if i < last {
            len == CHUNK
        } else {
            i == last && len > 0 && len <= CHUNK
        };
        if ok {
            Ok(())
        } else {
            Err(Error::Corrupt(format!(
                "chunk {i} of {} is {len} bytes",
                self.chunks.len()
            )))
        }
    }

    /// Every chunk this store holds of the file, checked against [`File::fits`]: what a peer checks once it has fetched
    /// a file, before it keeps it.
    pub async fn check<S: Store + ?Sized>(&self, store: &S) -> Result<()> {
        for (i, chunk) in self.chunks.iter().enumerate() {
            if let Some(len) = store.size(chunk).await? {
                self.fits(i as u64, len)?;
            }
        }
        Ok(())
    }
}
