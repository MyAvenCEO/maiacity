//! The one slot a node keeps what it derived of its log in (the index gate, `ShelfIndex.lean` I3): two of each, kept
//! in turn (`slots/<name>-0`, `-1`), each stamped with the head of the log it is of (`Log::head_at`), whole or read as
//! none. An index keeps its root in its slots (`shelf_index`); a device kept its stored view in them before its rows
//! (`edits`), which it reads still.
//!
//! A slot is what it starts with (`SLOT`), the number it was kept as, the stamp's place and head, what it keeps, and
//! the hash of all that; the next goes in place of the older of the two (`Shelf::keep`), so a crash at any point leaves
//! the one before, or both. A torn slot reads as none.

use std::io;

use avendb::pages::sum;
use bytes::Bytes;

use crate::shelf::Shelf;
use crate::shelf_index::Stamp;

/// What every slot starts with.
const SLOT: &[u8] = b"avenDB index slot 1\n";

/// A slot that read whole: the number it was kept as, its stamp and what it keeps.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Kept {
    pub(crate) n: u64,
    pub(crate) stamp: Stamp,
    pub(crate) bytes: Vec<u8>,
}

fn name(of: &str, n: u64) -> String {
    format!("slots/{of}-{}", n % 2)
}

/// Keeps `bytes` under `stamp` in slot `n` of `of`'s, in place of the older of its two.
pub(crate) async fn keep(shelf: &Shelf, of: &str, n: u64, stamp: Stamp, bytes: &[u8]) -> io::Result<()> {
    let mut out = Vec::with_capacity(SLOT.len() + 8 + 8 + 32 + bytes.len() + 32);
    out.extend_from_slice(SLOT);
    out.extend_from_slice(&n.to_be_bytes());
    out.extend_from_slice(&stamp.at.to_be_bytes());
    out.extend_from_slice(&stamp.head);
    out.extend_from_slice(bytes);
    let check = sum(&out);
    out.extend_from_slice(&check);
    shelf.keep(&name(of, n), Bytes::from(out)).await
}

/// `of`'s slots that read whole, the newest first.
pub(crate) async fn read(shelf: &Shelf, of: &str) -> io::Result<Vec<Kept>> {
    let mut found = Vec::new();
    for i in 0..2 {
        let Some(bytes) = shelf.get(&name(of, i)).await? else { continue };
        if let Some(kept) = kept(&bytes).filter(|k| k.n % 2 == i) {
            found.push(kept);
        }
    }
    found.sort_by_key(|k| std::cmp::Reverse(k.n));
    Ok(found)
}

/// The slot `bytes` hold, if they hold one whole.
fn kept(bytes: &[u8]) -> Option<Kept> {
    let (body, check) = bytes.split_at_checked(bytes.len().checked_sub(32)?)?;
    if sum(body) != *check {
        return None;
    }
    let r = body.strip_prefix(SLOT)?;
    let (n, r) = r.split_first_chunk::<8>()?;
    let (at, r) = r.split_first_chunk::<8>()?;
    let (head, r) = r.split_first_chunk::<32>()?;
    let stamp = Stamp { at: u64::from_be_bytes(*at), head: *head };
    Some(Kept { n: u64::from_be_bytes(*n), stamp, bytes: r.to_vec() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shelf_index::tests::Memory;

    /// A slot reads back as kept, the newer of two first; a torn or changed one reads as none (I3).
    #[tokio::test]
    async fn a_slot_reads_back_whole_or_not_at_all() {
        let shelf = Memory::new().shelf();
        let stamp = |at| Stamp { at, head: [at as u8; 32] };
        keep(&shelf, "view", 0, stamp(3), b"first").await.unwrap();
        keep(&shelf, "view", 1, stamp(9), b"second").await.unwrap();
        let found = read(&shelf, "view").await.unwrap();
        assert_eq!(found.iter().map(|k| (k.n, k.stamp, &k.bytes[..])).collect::<Vec<_>>(),
            [(1, stamp(9), &b"second"[..]), (0, stamp(3), &b"first"[..])]);
        let mut torn = shelf.get("slots/view-1").await.unwrap().unwrap().to_vec();
        torn[SLOT.len() + 20] ^= 1;
        shelf.keep("slots/view-1", Bytes::from(torn)).await.unwrap();
        assert_eq!(read(&shelf, "view").await.unwrap().len(), 1, "a changed slot reads as none");
        assert!(read(&shelf, "other").await.unwrap().is_empty());
    }
}
