//! A device's start, timed on a real shelf (Step 0 of the performance plan, 2026-10-20): `AVENDB_BENCH_SHELF` names a
//! copy of a device's folder (one that holds `g18/`), never the folder a running device uses. It reads the shelf, then
//! restores a new device of a fresh Lab from it, as `Node::spawn` does, and prints how long each part took and what
//! the Lab measured. Run it by hand: `AVENDB_BENCH_SHELF=<copy> cargo test -p avendb-net --release bench -- --ignored
//! --nocapture`.

use crate::{disk, edits};
use avendb::lab::Lab;
use avendb::wire::Wire;
use std::time::Instant;

#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn bench_restore() {
    let Ok(root) = std::env::var("AVENDB_BENCH_SHELF") else { return };
    let began = Instant::now();
    let shelf = disk::open(std::path::Path::new(&root)).expect("the shelf");
    let (_edits, (signed, keys)) = edits::Edits::open(shelf).await.expect("its edits");
    let read = began.elapsed();
    let (count, bytes) = (signed.len(), signed.iter().map(|s| s.to_wire().len()).sum::<usize>());
    let mut lab = Lab::new();
    let me = lab.device("bench");
    let began = Instant::now();
    lab.restore_from(me, avendb::lab::Backup::new(signed, keys));
    let restored = began.elapsed();
    eprintln!("BENCH edits={count} wire_mb={:.1} read_s={:.2} restore_s={:.2}", bytes as f64 / 1e6, read.as_secs_f64(), restored.as_secs_f64());
    eprintln!("BENCH perf {}", lab.perf(me));
}

/// The rules' replay of the same shelf's edits alone, done `AVENDB_BENCH_ROUNDS` times (3 if unset): what every write
/// and every page of a pull costs today.
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn bench_replay() {
    let Ok(root) = std::env::var("AVENDB_BENCH_SHELF") else { return };
    let rounds: usize = std::env::var("AVENDB_BENCH_ROUNDS").ok().and_then(|n| n.parse().ok()).unwrap_or(3);
    let shelf = disk::open(std::path::Path::new(&root)).expect("the shelf");
    let (_edits, (signed, _)) = edits::Edits::open(shelf).await.expect("its edits");
    let edits: Vec<_> = signed.into_iter().map(|s| s.edit).collect();
    let removals = edits.iter().filter(|e| e.is_removal()).count();
    for _ in 0..rounds {
        let began = Instant::now();
        let r = avendb::policy::replay(&edits);
        eprintln!("BENCH replay edits={} removals={removals} stood={} s={:.3}", edits.len(), r.stood.iter().filter(|s| **s).count(), began.elapsed().as_secs_f64());
    }
}
