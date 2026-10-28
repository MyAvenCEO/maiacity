//! The shelf's contract (`shelf`), held by every place that keeps one: the Mac's folder (`disk`), the server's bucket
//! (`bucket`), and any shelf of a test. Each place answers the same calls the same way, so a node never knows which it
//! has; a place that answers one differently is caught here, before a node trusts it.
//!
//! - an object is put once: the same bytes again change nothing, other bytes are refused (`AlreadyExists`), and what
//!   was put stays;
//! - a slot, a name under `slots/` alone, is kept in place, never put; a name outside it is never kept;
//! - a name a shelf holds nothing under is none (`Get` answers `None`), and one it may never hold is refused;
//! - the names put under a prefix come back in order, and only those;
//! - a blob counts once it is finished: then it is listed with its size, read by any range, a range past its end cut
//!   to it, and its outboard is the one it was finished with; the same blob finished again from another name is held
//!   once; a dropped blob is listed no more, and reads as missing.

use std::io::ErrorKind;

use bytes::Bytes;
use iroh_blobs::Hash;

use crate::shelf::{Shelf, fresh};
use crate::tree::Outboarder;

/// `bytes` as a blob: its hash, size and outboard.
fn blob(bytes: &[u8]) -> (Hash, u64, Bytes) {
    let mut tree = Outboarder::new();
    tree.push(bytes);
    let (hash, size, outboard) = tree.finish();
    (hash, size, outboard.into())
}

/// Holds `shelf` to the contract, `place` naming it in what fails. The shelf may hold anything beside what this puts,
/// under names of its own.
pub(crate) async fn holds(shelf: &Shelf, place: &str) {
    let at = |what: &str| format!("{place}: {what}");

    // put once
    let first = Bytes::from_static(b"the first bytes");
    shelf.put("contract/one", first.clone()).await.unwrap_or_else(|e| panic!("{}: {e}", at("a new name is put")));
    assert_eq!(shelf.get("contract/one").await.expect("get").as_ref(), Some(&first), "{}", at("what was put"));
    shelf.put("contract/one", first.clone()).await.unwrap_or_else(|e| panic!("{}: {e}", at("the same bytes again")));
    let other = shelf.put("contract/one", Bytes::from_static(b"other bytes")).await;
    assert_eq!(other.map_err(|e| e.kind()), Err(ErrorKind::AlreadyExists), "{}", at("other bytes are refused"));
    assert_eq!(shelf.get("contract/one").await.expect("get").as_ref(), Some(&first), "{}", at("and the first stay"));

    // slots
    let put_slot = shelf.put("slots/contract", Bytes::from_static(b"x")).await;
    assert_eq!(put_slot.map_err(|e| e.kind()), Err(ErrorKind::InvalidInput), "{}", at("a slot is never put"));
    let kept_out = shelf.keep("contract/kept", Bytes::from_static(b"x")).await;
    assert_eq!(kept_out.map_err(|e| e.kind()), Err(ErrorKind::InvalidInput), "{}", at("only a slot is kept"));
    for bytes in [&b"the older"[..], &b"the newer, longer"[..], &b"short"[..]] {
        shelf.keep("slots/contract", Bytes::copy_from_slice(bytes)).await.expect("keep");
        let got = shelf.get("slots/contract").await.expect("get");
        assert_eq!(got.as_deref(), Some(bytes), "{}", at("a slot holds what was kept last, whole"));
    }

    // names
    assert_eq!(shelf.get("contract/none").await.expect("get"), None, "{}", at("a name never put is none"));
    for bad in ["../contract", "contract/../x", "blobs/x", "Contract", "contract//x", ""] {
        let got = shelf.get(bad).await;
        assert_eq!(got.map_err(|e| e.kind()), Err(ErrorKind::InvalidInput), "{}", at(&format!("{bad:?} is refused")));
    }
    for name in ["contract/list/b", "contract/list/a", "contract/list/c/d", "contract/lister"] {
        shelf.put(name, Bytes::from(name.as_bytes().to_vec())).await.expect("put");
    }
    let listed = shelf.names("contract/list/").await.expect("names");
    let wanted = ["contract/list/a", "contract/list/b", "contract/list/c/d"];
    assert_eq!(listed, wanted, "{}", at("the names under a prefix, in order, and only those"));
    let listed = shelf.names("contract/").await.expect("names");
    assert!(listed.windows(2).all(|w| w[0] < w[1]), "{}", at("names in order"));
    assert!(!listed.iter().any(|n| n.starts_with("slots/")), "{}", at("no slot among the names put"));

    // blobs
    let bytes: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
    let (hash, size, outboard) = blob(&bytes);
    let staged = fresh();
    let half = bytes.len() / 2;
    shelf.write(&staged, 0, Bytes::copy_from_slice(&bytes[..half])).await.expect("write");
    shelf.write(&staged, half as u64, Bytes::copy_from_slice(&bytes[half..])).await.expect("write");
    let before = shelf.list().await.expect("list");
    assert!(!before.iter().any(|(h, _)| *h == hash), "{}", at("a blob being written counts for nothing"));
    shelf.finish(&staged, hash, size, outboard.clone()).await.expect("finish");
    let listed = shelf.list().await.expect("list");
    assert!(listed.contains(&(hash, size)), "{}", at("a finished blob is listed with its size"));
    let name = hash.to_hex();
    for (from, len) in [(0, 10), (1000, 4096), (half as u64 - 3, 7), (size - 5, 5)] {
        let got = shelf.read(&name, from, len).await.expect("read");
        assert_eq!(&got[..], &bytes[from as usize..from as usize + len], "{}", at(&format!("bytes {from}+{len}")));
    }
    let tail = shelf.read(&name, size - 5, 100).await.expect("read");
    assert_eq!(&tail[..], &bytes[bytes.len() - 5..], "{}", at("a range past the end, cut to it"));
    assert_eq!(shelf.outboard(hash).await.expect("outboard"), outboard, "{}", at("the outboard it was finished with"));
    assert_eq!(shelf.read_blob(hash, size).await.expect("read whole"), Bytes::from(bytes.clone()), "{}", at("whole"));

    // the same blob again, from another name
    let again = fresh();
    shelf.write(&again, 0, Bytes::from(bytes.clone())).await.expect("write");
    shelf.finish(&again, hash, size, outboard.clone()).await.expect("finished again");
    let held = shelf.list().await.expect("list").into_iter().filter(|(h, _)| *h == hash).count();
    assert_eq!(held, 1, "{}", at("the same blob is held once"));

    // a small blob, through put_blob
    let small = Bytes::from_static(b"a small blob");
    let (small_hash, small_size) = shelf.put_blob(&small).await.expect("put_blob");
    assert_eq!(shelf.read_blob(small_hash, small_size).await.expect("read"), small, "{}", at("a small blob"));

    // dropped
    shelf.drop(&name).await.expect("drop");
    assert!(!shelf.list().await.expect("list").iter().any(|(h, _)| *h == hash), "{}", at("a dropped blob is gone"));
    let read = shelf.read(&name, 0, 10).await;
    assert_eq!(read.map_err(|e| e.kind()), Err(ErrorKind::NotFound), "{}", at("and reads as missing"));
    let missing = Hash::from_bytes([9; 32]).to_hex();
    let read = shelf.read(&missing, 0, 10).await;
    assert_eq!(read.map_err(|e| e.kind()), Err(ErrorKind::NotFound), "{}", at("a blob never held reads as missing"));
}

#[cfg(test)]
mod places {
    use std::path::PathBuf;

    use super::holds;
    use crate::{bucket, disk};

    fn folder(what: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("avendb-contract-{what}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        dir
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_macs_folder_holds_the_contract() {
        let root = folder("disk");
        let owner = disk::open(&root).expect("a shelf").writer().expect("its writer");
        holds(&owner.shelf(), "the Mac's folder").await;
        owner.shutdown().await.expect("it stops");
        std::fs::remove_dir_all(root).ok();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn the_servers_bucket_holds_the_contract() {
        let (objects, cache) = (folder("bucket"), folder("cache"));
        let sealed = bucket::Sealed::new(bucket::Folder::new(&objects), &[7; 32]);
        let shelf = bucket::shelf(sealed, &cache, 64 << 20).await.expect("a shelf");
        holds(&shelf, "the server's bucket").await;
        for dir in [objects, cache] {
            std::fs::remove_dir_all(dir).ok();
        }
    }
}
