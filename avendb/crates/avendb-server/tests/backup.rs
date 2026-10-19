//! The full recovery test (`docs/BACKUP.md`): the server backs up every vault it knows into a bucket of snapshots over
//! three days, a quiet day putting no blob and a busy one the pack of what is new and the file it brings; a drill
//! rehearses every vault back from the bucket alone, each whole, and the first day's without what came after; and a
//! restore after a disaster brings the server back on a new shelf as the same device, holding every file whole, from
//! which Carol's Mac reads Welcome's files over iroh. Each step timed. The film is 20 MB in a folder, and on a real
//! bucket a film of two pieces, a gigabyte and 64 MiB, as the studio's are (`AVENDB_TEST_FILM_MB` says otherwise).
//!
//! On a real bucket when the environment names one (`AVENDB_TEST_BUCKET`, with `AVENDB_TEST_BUCKET_ENDPOINT`,
//! `_REGION`, `_ACCESS_KEY` and `_SECRET_KEY`: Hetzner's `maiacity-avendb-snapshots-test` in hel1, from its own
//! workflow, `.github/workflows/avendb-backups.yml`), else in a folder. On a real bucket each run writes under a prefix
//! of its own, sealed under a seal of its own, and deletes what it wrote as it ends.

#[path = "../../avendb-net/tests/common/mod.rs"]
mod common;

use std::collections::hash_map::RandomState;
use std::future::Future;
use std::hash::{BuildHasher as _, Hasher as _};
use std::io;
use std::sync::Arc;
use std::time::{Duration, Instant};

use avendb::backup::{DAY, HOUR, Keep};
use avendb::cast::*;
use avendb::id::SignerId;
use avendb::policy::Level;
use avendb::sealed::{PIECE, PIECE_SEGMENTS, SEGMENT};
use avendb_net::backup::Snapshots;
use avendb_net::bucket::{self, Bucket, Fut};
use avendb_net::{Node, Options, disk, server};
use avendb_server::backups::{self, Run};
use avendb_server::BucketConfig;
use bytes::Bytes;
use common::Folder;
use n0_future::{Stream, stream};
use zeroize::Zeroizing;

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8, opts: Options) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await.expect("a node")
}

/// Waits until `check` holds, 10 minutes at most: a film of a gigabyte crosses to the server in that.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(600);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 10 minutes");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// The bytes `from..to` of a file whose bytes start at `seed`.
fn bytes(seed: u64, from: u64, to: u64) -> Vec<u8> {
    (from..to).map(|j| ((seed + j) % 251) as u8).collect()
}

/// That file of `len` bytes as it is read, a megabyte at a time.
fn reading(seed: u64, len: u64) -> impl FnMut() -> Box<dyn Stream<Item = io::Result<Bytes>> + Unpin + Send> {
    move || {
        let starts = (0..len.div_ceil(1 << 20)).map(|i| i << 20);
        Box::new(stream::iter(starts.map(move |from| Ok(Bytes::from(bytes(seed, from, (from + (1 << 20)).min(len)))))))
    }
}

/// 32 bytes of the machine's randomness, by the keys its hash maps are seeded with.
fn random() -> [u8; 32] {
    let mut out = [0; 32];
    for chunk in out.chunks_mut(8) {
        chunk.copy_from_slice(&RandomState::new().build_hasher().finish().to_le_bytes());
    }
    out
}

/// A bucket's objects under `prefix` alone, by their names after it: a run's own on a bucket runs share.
struct Prefixed {
    bucket: Arc<dyn Bucket>,
    prefix: String,
}

impl Bucket for Prefixed {
    fn put<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> Fut<'a, ()> {
        Box::pin(async move { self.bucket.put(&format!("{}{name}", self.prefix), bytes).await })
    }

    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>> {
        Box::pin(async move { self.bucket.get(&format!("{}{name}", self.prefix)).await })
    }

    fn list<'a>(&'a self, prefix: &'a str) -> Fut<'a, Vec<String>> {
        Box::pin(async move {
            let names = self.bucket.list(&format!("{}{prefix}", self.prefix)).await?;
            Ok(names.into_iter().filter_map(|n| n.strip_prefix(&self.prefix).map(str::to_string)).collect())
        })
    }

    fn delete<'a>(&'a self, name: &'a str) -> Fut<'a, ()> {
        Box::pin(async move { self.bucket.delete(&format!("{}{name}", self.prefix)).await })
    }
}

/// What the environment says `n` is, if anything.
fn var(n: &str) -> Option<String> {
    std::env::var(n).ok().filter(|v| !v.is_empty())
}

/// The bucket the test backs up into: the real one the environment names, under a prefix of the run's own, or else a
/// folder; and what it is, for the log.
fn the_bucket(folder: &Folder) -> (Arc<dyn Bucket>, String) {
    let Some(name) = var("AVENDB_TEST_BUCKET") else {
        return (Arc::new(bucket::Folder::new(folder.path())), format!("a folder, {}", folder.path().display()));
    };
    let said = |n: &str| var(n).unwrap_or_else(|| panic!("{n}: unsaid, with AVENDB_TEST_BUCKET said"));
    let config = BucketConfig {
        name: name.clone(),
        endpoint: said("AVENDB_TEST_BUCKET_ENDPOINT"),
        region: said("AVENDB_TEST_BUCKET_REGION"),
        access_key: said("AVENDB_TEST_BUCKET_ACCESS_KEY"),
        secret_key: said("AVENDB_TEST_BUCKET_SECRET_KEY"),
        seal: Zeroizing::new([0; 32]),
    };
    let s3 = avendb_server::bucket::S3::new(&config).expect("the test bucket");
    let prefix = format!("runs/{}/", data_encoding::HEXLOWER.encode(&random()[..8]));
    let at = format!("bucket {name} at {}, under {prefix}", config.endpoint);
    (Arc::new(Prefixed { bucket: Arc::new(s3), prefix }), at)
}

/// What `run` put, summed.
fn put(run: &Run) -> (u64, u64) {
    (run.done.iter().map(|d| d.put).sum(), run.done.iter().map(|d| d.bytes).sum())
}

/// `bytes` in `took`, in MB/s.
fn rate(bytes: u64, took: Duration) -> f64 {
    bytes as f64 / took.as_secs_f64().max(1e-6) / 1e6
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_server_comes_back_whole_from_its_snapshots() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    w.lab.issue(w.mac_a, &[w.mac_a], read).expect("Alice's Mac shares Welcome with Carol to read");
    w.lab.sync_all(1);
    let (mac_a, passkey_a, server_d, mac_c, passkey_c) = (w.mac_a, w.passkey_a, w.server, w.mac_c, w.passkey_c);
    let (coop, welcome) = (h.coop, h.welcome);
    let (at_server, local, staging) = (Folder::new("server"), Folder::new("snapshots"), Folder::new("staging"));
    let (objects, where_) = the_bucket(&local);
    eprintln!("backing up into {where_}");
    let shelf = disk::open(at_server.path()).expect("its shelf");
    let mac = node(&mut w, mac_a, &[passkey_a], 1, Options::local()).await;
    let server = node(&mut w, server_d, &[], 2, Options { keep: true, shelf: Some(shelf), ..Options::local() }).await;
    mac.know(server.addr());
    server.know(mac.addr());
    // a film into Welcome: of two pieces on a real bucket, as the studio's films of gigabytes are
    let film_len = match var("AVENDB_TEST_FILM_MB") {
        Some(mb) => mb.parse::<u64>().expect("AVENDB_TEST_FILM_MB: megabytes") * 1_000_000,
        None if var("AVENDB_TEST_BUCKET").is_some() => PIECE_SEGMENTS * SEGMENT as u64 + (64 << 20),
        None => 20_000_000,
    };
    let scan_len = 2_500_000;
    let began = Instant::now();
    let film = mac.store_file(film_len, reading(1, film_len)).await.expect("Alice's Mac seals the film");
    let film_root = film.root;
    eprintln!("a film of {film_len} bytes, {} pieces, sealed in {:?}", film_root.size.div_ceil(PIECE), began.elapsed());
    mac.act(move |lab, me| lab.bring(me, coop, welcome, vec![film], |_| {})).await.expect("brought into Welcome");
    until("the server keeps the film whole", || server.holds_file(film_root)).await;

    let seal = random();
    let snapshots = Snapshots::new(Shared(objects.clone()), &seal, staging.path());
    let (keep, day) = (Keep::default(), |n: u64| (20_000 + n) * DAY + 3 * HOUR);
    let first = backups::back_up_all(&server, &snapshots, &keep, day(0), false).await;
    let vaults = server.vaults().await;
    assert!(first.failed.is_empty(), "every vault backed up: {:?}", first.failed);
    assert_eq!(first.done.len(), vaults.len(), "each vault the server knows");
    let (blobs, sent) = put(&first);
    let (n, took) = (vaults.len(), first.took);
    eprintln!("day 1: {n} vaults, {blobs} blobs, {sent} bytes, in {took:?}, {:.1} MB/s", rate(sent, took));
    let coop_first = first.done.iter().find(|d| d.vault == coop).expect("the coop's").clone();
    assert_eq!((coop_first.base, coop_first.files), (None, 1), "the coop, all of it, with the film");
    // a quiet day: nothing put but each vault's manifest
    let quiet = backups::back_up_all(&server, &snapshots, &keep, day(1), false).await;
    assert!(quiet.failed.is_empty() && quiet.done.iter().all(|d| d.base == Some(day(0)) && d.news == 0));
    assert_eq!(put(&quiet), (0, 0), "no blob on a quiet day");
    eprintln!("day 2, quiet: {} manifests in {:?}", quiet.done.len(), quiet.took);
    // a busy day: Alice's Mac brings a scan into Welcome
    let scan = mac.store_file(scan_len, reading(2, scan_len)).await.expect("Alice's Mac seals the scan");
    let scan_root = scan.root;
    mac.act(move |lab, me| lab.bring(me, coop, welcome, vec![scan], |_| {})).await.expect("brought into Welcome");
    until("the server keeps the scan whole", || server.holds_file(scan_root)).await;
    let busy = backups::back_up_all(&server, &snapshots, &keep, day(2), false).await;
    assert!(busy.failed.is_empty(), "every vault backed up: {:?}", busy.failed);
    let coop_busy = busy.done.iter().find(|d| d.vault == coop).expect("the coop's").clone();
    assert!(coop_busy.base == Some(day(1)) && coop_busy.news > 0 && coop_busy.files == 2, "{coop_busy:?}");
    assert_eq!(coop_busy.put, 2, "the pack of what is new and the scan");
    assert!(coop_busy.bytes < scan_len + film_len / 10, "not the film again: {} bytes", coop_busy.bytes);
    eprintln!("day 3, busy: {} blobs, {} bytes, in {:?}", put(&busy).0, put(&busy).1, busy.took);

    // the drill: every vault back from the bucket alone, each whole; the first day's without the scan
    let drills = Folder::new("drills");
    let began = Instant::now();
    let (drilled, failed) = backups::drill(&snapshots, None, drills.path()).await.expect("a drill");
    let took = began.elapsed();
    assert!(failed.is_empty(), "every vault comes back: {failed:?}");
    assert_eq!(drilled.len(), vaults.len());
    assert!(drilled.iter().all(|d| d.rehearsal.whole()), "each whole");
    let coop_drill = drilled.iter().find(|d| d.vault == coop).expect("the coop's");
    let film_bytes = film_len + scan_len;
    let r = &coop_drill.rehearsal;
    let (vaults_back, files_rate) = (drilled.len(), rate(film_bytes, r.restore));
    eprintln!("drill: {vaults_back} vaults whole in {took:?}; the coop's restored in {:?} ({files_rate:.1} MB/s of its \
        files) and started in {:?}", r.restore, r.start);
    let (older, _) = backups::drill(&snapshots, Some(day(0) + HOUR), drills.path()).await.expect("a drill of day 1");
    let coop_older = older.iter().find(|d| d.vault == coop).expect("the coop's");
    assert_eq!(coop_older.rehearsal.manifest.time, day(0), "the first day's snapshot");
    assert!(coop_older.rehearsal.whole() && coop_older.rehearsal.files == 1, "the film, and no scan");

    // a disaster: the server's shelf lost; a server restored from the snapshots is the same device
    let fresh = Folder::new("fresh");
    let unclaimed = server::open(disk::open(fresh.path()).expect("a shelf"), Options::local()).await.expect("a server");
    let device = unclaimed.device();
    unclaimed.shutdown().await.expect("it stops");
    drop(unclaimed);
    let secret = disk::open(fresh.path()).expect("its shelf").get(server::SECRET).await.expect("read");
    snapshots.keep_secret(&secret.expect("its secret")).await.expect("kept with the snapshots");
    server.shutdown().await.expect("the server is lost");
    mac.shutdown().await.expect("and Alice's Mac goes away");
    drop((server, mac));
    let again = Folder::new("restored");
    let began = Instant::now();
    let restored = backups::restore(&snapshots, None, again.path()).await.expect("a restore");
    let took = began.elapsed();
    assert_eq!(restored.len(), vaults.len(), "every vault");
    assert!(backups::restore(&snapshots, None, again.path()).await.is_err(), "never into a folder that isn't empty");
    let shelf = disk::open(again.path()).expect("its shelf");
    let restarted = server::open(shelf, Options::local()).await.expect("started");
    eprintln!("restore: {} vaults in {took:?}, started in {:?}", restored.len(), began.elapsed() - took);
    assert_eq!(restarted.device(), device, "the same device as the one whose secret the snapshots keep");
    assert!(restarted.holds_file(film_root).await && restarted.holds_file(scan_root).await, "both files whole");
    let edits: u64 = restarted.read(|lab, me| lab.size(me).0 as u64).await;
    assert!(edits >= coop_busy.edits, "every edit of the coop's, and of the other vaults: {edits}");
    let carol = node(&mut w, mac_c, &[passkey_c], 3, Options::local()).await;
    carol.know(restarted.addr());
    until("Carol's Mac gets from it the writes that bring both files", || async {
        carol.sync_with(restarted.id()).await.ok();
        carol.read(move |lab, me| lab.file(me, &film_root).is_some() && lab.file(me, &scan_root).is_some()).await
    })
    .await;
    let began = Instant::now();
    // a range at a time, as a player reads it
    let mut at = 0;
    while at < film_len {
        let to = (at + (64 << 20)).min(film_len);
        let got = carol.read_file(film_root, at..to).await.expect("Carol's Mac reads the film");
        assert!(got == bytes(1, at, to), "every byte of the film, {at}..{to}");
        at = to;
    }
    let took = began.elapsed();
    eprintln!("Carol's Mac read the film from the restored server in {took:?}, {:.1} MB/s", rate(film_len, took));
    let scan_read = carol.read_file(scan_root, 0..u64::MAX).await.expect("and the scan");
    assert!(scan_read == bytes(2, 0, scan_len), "every byte of the scan");
    for n in [carol, restarted] {
        n.shutdown().await.expect("the node shuts down");
    }

    // what the run wrote, deleted: on a real bucket, Object Lock keeps each version until its days are up
    let names = objects.list("").await.expect("the run's objects");
    eprintln!("deleting the run's {} objects", names.len());
    for name in names {
        objects.delete(&name).await.expect("deleted");
    }
}

/// A bucket shared: the test's handle and the bucket of snapshots' alike.
struct Shared(Arc<dyn Bucket>);

impl Bucket for Shared {
    fn put<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> Fut<'a, ()> {
        self.0.put(name, bytes)
    }

    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>> {
        self.0.get(name)
    }

    fn list<'a>(&'a self, prefix: &'a str) -> Fut<'a, Vec<String>> {
        self.0.list(prefix)
    }

    fn delete<'a>(&'a self, name: &'a str) -> Fut<'a, ()> {
        self.0.delete(name)
    }
}
