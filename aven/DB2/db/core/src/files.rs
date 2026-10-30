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
    if index.len() % 32 != 0 {
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

/// How a line that announces a file starts: the announcement follows as JSON.
pub const LINE: &str = "avenDB file 1\n";

/// A file as the city-dome announces it: its index's hash, its size, and the name and MIME type its sender claims. It
/// travels as a line of the sender's chain ([`Announcement::text`]), so it is signed by the sender's device, kept in the
/// chat's history and caught up like any line.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Announcement {
    pub file: String,
    pub size: u64,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
}

impl Announcement {
    /// The line's text.
    pub fn text(&self) -> String {
        format!("{LINE}{}", serde_json::to_string(self).expect("an announcement encodes"))
    }

    /// The announcement a line's text makes, if it makes one: a name and a hash as the store writes it.
    pub fn of(text: &str) -> Option<Announcement> {
        let a: Announcement = serde_json::from_str(text.strip_prefix(LINE)?).ok()?;
        let hash = a.file.len() == 64 && a.file.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'));
        hash.then_some(a)
    }
}

/// The ref that keeps a file: `file-<index>`.
pub fn ref_name(file: &str) -> String {
    format!("file-{file}")
}
