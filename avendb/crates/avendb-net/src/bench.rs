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

/// What the shelf's `Keys` edits are: by the kind of key each boxes and how many boxes it carries, and how many share
/// an author and a depth (made in one upkeep).
#[tokio::test(flavor = "multi_thread")]
#[ignore]
async fn bench_keys() {
    use avendb::keys::{KeyFam, KeyName};
    use avendb::policy::Action;
    use std::collections::BTreeMap;
    let Ok(root) = std::env::var("AVENDB_BENCH_SHELF") else { return };
    let shelf = disk::open(std::path::Path::new(&root)).expect("the shelf");
    let (_edits, (signed, _)) = edits::Edits::open(shelf).await.expect("its edits");
    let mut kinds: BTreeMap<String, (usize, usize, usize)> = BTreeMap::new();
    let mut batches: BTreeMap<(String, u64), usize> = BTreeMap::new();
    let mut actions: BTreeMap<&'static str, (usize, usize)> = BTreeMap::new();
    for s in &signed {
        let bytes = s.to_wire().len();
        let kind = match &s.edit.action {
            Action::Keys { .. } => "keys",
            Action::Write { .. } => "write",
            Action::Mark { .. } => "mark",
            Action::Share(_) => "share",
            Action::Revoke(_) => "revoke",
            _ => "other",
        };
        let a = actions.entry(kind).or_default();
        a.0 += 1;
        a.1 += bytes;
        if let Action::Keys { name, boxes, public, .. } = &s.edit.action {
            let k = match name {
                KeyName::Signer(_) => "signer".to_string(),
                KeyName::Scoped(KeyFam::Seed(_), _) => "seed".into(),
                KeyName::Scoped(KeyFam::Share(..), _) => "share".into(),
                KeyName::Scoped(KeyFam::Audience(..), _) => "audience".into(),
                KeyName::Entry(..) => "entry".into(),
            };
            let k = format!("{k} boxes={} public={}", boxes.len().min(3), public.is_some());
            let e = kinds.entry(k).or_default();
            e.0 += 1;
            e.1 += bytes;
            e.2 += s.sigs.len();
            *batches.entry((format!("{:?}", s.edit.author), s.edit.depth)).or_default() += 1;
        }
    }
    for (k, (n, b)) in &actions {
        eprintln!("BENCH action {k}: {n} edits, {:.1} MB", *b as f64 / 1e6);
    }
    for (k, (n, b, sigs)) in &kinds {
        eprintln!("BENCH keys {k}: {n} edits, {:.1} MB, {sigs} sigs", *b as f64 / 1e6);
    }
    let mut sizes: BTreeMap<usize, usize> = BTreeMap::new();
    for n in batches.values() {
        *sizes.entry(*n).or_default() += 1;
    }
    eprintln!("BENCH keys per (author, depth): {sizes:?}");
}
