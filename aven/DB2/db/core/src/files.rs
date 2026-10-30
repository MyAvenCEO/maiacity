//! Files in the city-dome (`Aven.DB.Files`, `store/README.md` "Big files are hash sequences"): a file is its bytes cut
//! into chunks of [`CHUNK`] bytes, the last one shorter, each an ordinary blob; and its index, a blob of its chunks'
//! hashes in order, 32 bytes each (iroh-blobs' hash sequence). The file is named by its index's hash. A range read
//! takes exactly the chunks it [`touches`].
//!
//! The chunk size is a parameter, so the vectors cut small files into small chunks; the city-dome cuts at [`CHUNK`].
//! The hash comes from the edge (the store's BLAKE3).

use std::ops::Range;

/// The largest chunk: 1 MiB.
pub const CHUNK: u64 = 1 << 20;

/// The largest blob a peer fetches: a chunk, and room for framing. A line and an index are smaller. Checked before
/// anything is allocated for a fetched blob.
pub const MAX_BLOB: u64 = CHUNK + 64 * 1024;

/// The largest file the city-dome takes: 32 GiB, whose index (32 KiB hashes) still fits in one chunk.
pub const MAX_FILE: u64 = 32 << 30;

/// Whether chunk `i` of a file of `n` bytes, `len` bytes long, is cut as it must be: one of its chunks, exactly as long
/// as [`bounds`] says. Every chunk but the last is `c` bytes.
pub fn fits(c: u64, n: u64, i: u64, len: u64) -> bool {
    if i >= count(c, n) {
        return false;
    }
    let b = bounds(c, n, i);
    len == b.end - b.start
}

/// How many chunks a file of `n` bytes has.
pub fn count(c: u64, n: u64) -> u64 {
    n.div_ceil(c)
}

/// Where chunk `i` of a file of `n` bytes starts and ends.
pub fn bounds(c: u64, n: u64, i: u64) -> Range<u64> {
    i * c..n.min((i + 1) * c)
}

/// The chunks of `bytes`, in order.
pub fn split(c: u64, bytes: &[u8]) -> impl Iterator<Item = &[u8]> {
    bytes.chunks(c as usize)
}

/// The chunks a range touches, in order: none when it is empty.
pub fn touches(c: u64, range: Range<u64>) -> Range<u64> {
    if range.start < range.end {
        range.start / c..(range.end - 1) / c + 1
    } else {
        0..0
    }
}

/// The index: the chunks' hashes, 32 bytes each, in order.
pub fn index(hashes: impl IntoIterator<Item = [u8; 32]>) -> Vec<u8> {
    hashes.into_iter().flatten().collect()
}

/// An index's hashes, or `None` when it isn't a whole number of them.
pub fn hashes(index: &[u8]) -> Option<Vec<[u8; 32]>> {
    if !index.len().is_multiple_of(32) {
        return None;
    }
    Some(
        index
            .chunks(32)
            .map(|h| h.try_into().expect("32 bytes"))
            .collect(),
    )
}

/// The bytes of `range` from the chunks it touches alone (`got`, in order), or `None` when it isn't inside a file of
/// `n` bytes.
pub fn read(c: u64, n: u64, range: Range<u64>, got: &[&[u8]]) -> Option<Vec<u8>> {
    if range.start > range.end || range.end > n {
        return None;
    }
    let touched = touches(c, range.clone());
    let skip = (range.start - touched.start * c) as usize;
    let all: Vec<u8> = got.iter().flat_map(|g| g.iter().copied()).collect();
    if range.is_empty() {
        return Some(vec![]);
    }
    Some(all[skip..skip + (range.end - range.start) as usize].to_vec())
}

/// A file as the city-dome announces it: its index's hash, its size, and the name and MIME type its sender claims. It
/// travels as the body of a line of the sender's chain (`chain::Body::File`), so it is signed by the sender's device,
/// kept in the chat's history and caught up like any line.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Announcement {
    pub file: String,
    pub size: u64,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

/// The ref that keeps a file: `file-<index>`.
pub fn ref_name(file: &str) -> String {
    format!("file-{file}")
}
