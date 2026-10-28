//! The server's memory bounded (S7): its bucket the one store of record, its edits and keys spilled into its folder,
//! a bounded cache of them in memory; a cold start, its folder lost, rebuilding from the bucket the very state a warm
//! one holds; and a bucket that fails a call now and then (504s, timeouts) still loading, every call tried again.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use anyhow::bail;
use avendb::cast::*;
use avendb::lab::{Lab, Spill};
use avendb::wire::Wire as _;
use avendb_net::bucket::{self, Bucket, Fut, Sealed};
use avendb_net::{Node, Options};
use avendb_server::backups::Retrying;

const SEAL: [u8; 32] = [9; 32];

/// A folder of the test's own, gone after it.
struct Dir(PathBuf);

impl Dir {
    fn new(name: &str) -> Dir {
        static MADE: AtomicU32 = AtomicU32::new(0);
        let n = MADE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!("avendb-bounded-{name}-{}-{n}", std::process::id()));
        std::fs::remove_dir_all(&path).ok();
        std::fs::create_dir_all(&path).expect("a folder");
        Dir(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for Dir {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.0).ok();
    }
}

/// A bucket in a folder whose every `every`-th call fails, as Hetzner's answered 504 now and then, counting them.
struct Flaky {
    folder: bucket::Folder,
    every: u32,
    calls: AtomicU32,
    failed: Arc<AtomicU32>,
}

impl Flaky {
    fn fails(&self) -> bool {
        let n = self.calls.fetch_add(1, Ordering::Relaxed) + 1;
        let fails = n.is_multiple_of(self.every);
        if fails {
            self.failed.fetch_add(1, Ordering::Relaxed);
        }
        fails
    }
}

impl Bucket for Flaky {
    fn put<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> Fut<'a, ()> {
        if self.fails() {
            return Box::pin(async { bail!("the bucket answers 504 Gateway Timeout") });
        }
        self.folder.put(name, bytes)
    }

    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>> {
        if self.fails() {
            return Box::pin(async { bail!("operation timed out") });
        }
        self.folder.get(name)
    }

    fn list<'a>(&'a self, prefix: &'a str) -> Fut<'a, Vec<String>> {
        if self.fails() {
            return Box::pin(async { bail!("the bucket answers 503 Slow Down") });
        }
        self.folder.list(prefix)
    }

    fn delete<'a>(&'a self, name: &'a str) -> Fut<'a, ()> {
        self.folder.delete(name)
    }
}

/// The bucket in `objects`, failing every third call, each tried again within a few milliseconds.
fn flaky(objects: &Path, failed: &Arc<AtomicU32>) -> Sealed {
    let flaky = Flaky { folder: bucket::Folder::new(objects), every: 3, calls: AtomicU32::new(0), failed: failed.clone() };
    let retrying = Retrying::with(flaky, Duration::from_millis(2), Duration::from_secs(60), "the test's bucket");
    Sealed::new(retrying, &SEAL)
}

async fn until<F: Future<Output = bool>>(what: &str, mut done: impl FnMut() -> F) {
    let began = Instant::now();
    while !done().await {
        assert!(began.elapsed() < Duration::from_secs(120), "{what}: not within two minutes");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// What a device holds and shows, to tell two starts apart: its edits in order, each on the wire, its keys, and the
/// text of each of `docs`.
fn state(lab: &Lab, me: avendb::id::SignerId, docs: &[avendb::id::EntryId]) -> (Vec<Vec<u8>>, Vec<avendb::id::BlobId>, Vec<Option<String>>) {
    let backup = lab.backup(me);
    let edits = backup.signed().iter().map(|s| s.to_wire()).collect();
    (edits, lab.blob_ids(me), docs.iter().map(|&d| text(lab, me, d, 2)).collect())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_cold_start_on_a_flaky_bucket_rebuilds_the_warm_state() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a) = (w.mac_a, w.passkey_a);
    let (objects, folder) = (Dir::new("objects"), Dir::new("folder"));
    let failed = Arc::new(AtomicU32::new(0));
    let open = async |lab: Lab, failed: &Arc<AtomicU32>| {
        let shelf = bucket::shelf(flaky(objects.path(), failed), folder.path(), 64 << 20).await.expect("its shelf");
        let mut lab = lab;
        // spilled, with a cache of a few edits alone, so that what it reads comes back from its spill
        let spill = Spill::new(folder.path().join("spill"), 64 << 10).expect("its spill");
        lab.spill(mac_a, &spill).expect("spilled");
        Node::spawn(lab, mac_a, Options { shelf: Some(shelf), ..Options::local() }).await.expect("a node")
    };
    let mac = open(w.lab.split(mac_a, &[passkey_a], [1; 32]), &failed).await;
    let mut docs = vec![];
    for n in 0..12 {
        let write = move |lab: &mut Lab, me| {
            lab.create(me, coop, coop, "doc", &[], document(&format!("Note {n}"), &format!("{WELCOME_TEXT} {n}"), me))
        };
        docs.push(mac.act(write).await.expect("Alice's Mac writes a note"));
    }
    until("the bucket holds all the Mac holds", || async { !mac.behind().await }).await;
    let docs2 = docs.clone();
    let warm = mac.read(move |lab, me| state(lab, me, &docs2)).await;
    assert!(warm.2.iter().all(Option::is_some), "it shows every note");
    let spilled = mac.read(|lab, me| lab.perf(me)["held"]["memory"].clone()).await;
    assert_eq!(spilled["spilling"], true, "its edits are spilled: {spilled}");
    assert!(spilled["spilled"].as_u64().unwrap_or(0) > 0, "into its folder: {spilled}");
    mac.shutdown().await.expect("it stops");
    drop(mac);
    assert!(failed.load(Ordering::Relaxed) > 0, "the bucket failed calls, each tried again");

    // cold: the folder lost, cache and spill, and a world that never saw the notes; the bucket as flaky as ever
    std::fs::remove_dir_all(folder.path()).expect("the folder lost");
    let before = failed.load(Ordering::Relaxed);
    let mut again = world();
    handbook_ready(&mut again);
    let lab = again.lab.split(mac_a, &[passkey_a], [1; 32]);
    assert!(lab.item(mac_a, docs[0]).is_none(), "a world of its own holds no note");
    let mac = open(lab, &failed).await;
    let docs2 = docs.clone();
    let cold = mac.read(move |lab, me| state(lab, me, &docs2)).await;
    assert!(failed.load(Ordering::Relaxed) > before, "its load met failures too, and waited them out");
    assert_eq!(cold.0.len(), warm.0.len(), "every edit came back");
    assert!(cold == warm, "a cold start holds and shows exactly what the warm one did");
    mac.shutdown().await.expect("it stops");
}
