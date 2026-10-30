//! Files in the city-dome (`store/README.md`, "How a file travels"; `aven_db_core::files`): a file is put into the
//! store a chunk at a time, so a movie of several GB never sits in memory; then its index, and the ref `file-<index>`
//! that keeps it. Its announcement is a line of the sender's chain. A range read takes the chunks it touches from the
//! store; a chunk this peer doesn't hold yet comes from another holder, over iroh-blobs once the store's adapter is in.

use aven_db_core::files::{self, Announcement, CHUNK};
use aven_db_store::{Hash, RefName, Store};
use bytes::Bytes;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// A hash from its 32 bytes, as an index lists it.
fn hash(b: [u8; 32]) -> Hash {
    let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
    hex.parse().expect("64 hex digits")
}

/// Puts one chunk, at most [`CHUNK`] bytes, and returns its name.
pub async fn put_chunk<S: Store + ?Sized>(store: &S, bytes: Bytes) -> Result<Hash, String> {
    if bytes.is_empty() || bytes.len() as u64 > CHUNK {
        return Err(format!(
            "a chunk is 1 to {CHUNK} bytes, not {}",
            bytes.len()
        ));
    }
    store.put(bytes).await.map_err(err)
}

/// Puts a file's index over the chunks already put, in order, and keeps it under `file-<index>`. The announcement
/// to say as a line.
pub async fn share<S: Store + ?Sized>(
    store: &S,
    name: &str,
    kind: &str,
    size: u64,
    chunks: &[Hash],
) -> Result<Announcement, String> {
    if chunks.len() as u64 != files::count(CHUNK, size) {
        return Err(format!(
            "{size} bytes are {} chunks, not {}",
            files::count(CHUNK, size),
            chunks.len()
        ));
    }
    for c in chunks {
        if !store.has(c).await.map_err(err)? {
            return Err(format!("chunk {c:?} isn't in the store"));
        }
    }
    let index = files::index(chunks.iter().map(|h| *h.as_bytes()));
    let file = store.put(Bytes::from(index)).await.map_err(err)?;
    keep(store, &file).await?;
    Ok(Announcement {
        file: file.to_hex(),
        size,
        name: name.to_string(),
        kind: kind.to_string(),
    })
}

/// Sets `file-<index>` from nothing; a file kept already stays kept.
pub async fn keep<S: Store + ?Sized>(store: &S, file: &Hash) -> Result<(), String> {
    let name = RefName::new(files::ref_name(&file.to_hex())).map_err(err)?;
    match store.set_ref(&name, None, *file).await {
        Ok(()) | Err(aven_db_store::Error::Stale { .. }) => Ok(()),
        Err(e) => Err(err(e)),
    }
}

/// The chunks of a file this store doesn't hold yet, in order: what a peer still has to fetch.
pub async fn missing<S: Store + ?Sized>(
    store: &S,
    file: &Hash,
) -> Result<Option<Vec<Hash>>, String> {
    let Some(index) = store.get(file).await.map_err(err)? else {
        return Ok(None);
    };
    let hashes = files::hashes(&index).ok_or("not an index")?;
    let mut out = vec![];
    for h in hashes {
        let h = hash(h);
        if !store.has(&h).await.map_err(err)? {
            out.push(h);
        }
    }
    Ok(Some(out))
}

/// What a range read found: the bytes, or the chunks it still needs.
#[derive(Debug, PartialEq, Eq)]
pub enum Read {
    Bytes(Vec<u8>),
    /// the index itself, if the store doesn't hold it, or the chunks the range touches that it doesn't
    Missing(Vec<Hash>),
}

/// Bytes `start..end` of a file of `size` bytes, from the chunks the range touches alone.
pub async fn read<S: Store + ?Sized>(
    store: &S,
    file: &Hash,
    size: u64,
    start: u64,
    end: u64,
) -> Result<Read, String> {
    if start > end || end > size {
        return Err(format!("{start}..{end} is outside the file's {size} bytes"));
    }
    let Some(index) = store.get(file).await.map_err(err)? else {
        return Ok(Read::Missing(vec![*file]));
    };
    let hashes = files::hashes(&index).ok_or("not an index")?;
    let (mut got, mut missing) = (vec![], vec![]);
    for i in files::touches(CHUNK, start..end) {
        let h = hash(
            *hashes
                .get(i as usize)
                .ok_or("the index is shorter than the file")?,
        );
        match store.get(&h).await.map_err(err)? {
            Some(b) => got.push(b),
            None => missing.push(h),
        }
    }
    if !missing.is_empty() {
        return Ok(Read::Missing(missing));
    }
    let slices: Vec<&[u8]> = got.iter().map(|b| b.as_ref()).collect();
    files::read(CHUNK, size, start..end, &slices)
        .map(Read::Bytes)
        .ok_or_else(|| "a range outside the file".into())
}
