//! Snapshots of each vault (`backup`, `docs/BACKUP.md`): the server backs up the coop into its folder of a bucket of
//! snapshots over a few days, the first day all of it, a quiet day only a manifest, and a busy day one pack of what is
//! new and the file it brings; every object sealed. Each snapshot rehearsed in a new node of its own comes back as it
//! was, every edit and every file: Carol's Mac, which may read Welcome, syncs from the newest over iroh and reads both
//! its files, and the oldest holds the photo and no scan. A snapshot made whole names one pack of all of it; retention
//! lets go of the snapshots it drops and of the blobs only they named, and the snapshot it keeps still comes back. A
//! check from the bucket alone, restoring nothing, finds each snapshot whole, and then a blob gone and two changed.

mod common;

use std::future::Future;
use std::io;
use std::path::Path;
use std::time::{Duration, Instant};

use avendb::backup::{DAY, HOUR, Keep};
use avendb::cast::*;
use avendb::id::SignerId;
use avendb::policy::Level;
use avendb_net::backup::{self, Reading, Snapshots};
use avendb_net::{Node, Options, bucket, disk};
use bytes::Bytes;
use common::Folder;
use iroh_blobs::Hash;
use n0_future::{Stream, stream};

/// The seal the bucket of snapshots is sealed under.
const SEAL: [u8; 32] = [9; 32];

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8, opts: Options) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await.expect("a node")
}

/// Waits until `check` holds, 60 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(60);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 60 s");
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

/// Every file under `dir`, by its path there, with its bytes.
fn objects(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut found = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let name = path.file_name().expect("a name").to_string_lossy().to_string();
        if path.is_dir() {
            found.extend(objects(&path).into_iter().map(|(n, bytes)| (format!("{name}/{n}"), bytes)));
        } else {
            found.push((name, std::fs::read(&path).expect("its bytes")));
        }
    }
    found
}

fn contains(bytes: &[u8], text: &str) -> bool {
    bytes.windows(text.len()).any(|w| w == text.as_bytes())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_vault_comes_back_from_each_snapshot_it_keeps() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    w.lab.issue(w.mac_a, &[w.mac_a], read).expect("Alice's Mac shares Welcome with Carol to read");
    w.lab.sync_all(1);
    let (mac_a, passkey_a, server_d, mac_c, passkey_c) = (w.mac_a, w.passkey_a, w.server, w.mac_c, w.passkey_c);
    let (coop, welcome) = (h.coop, h.welcome);
    let (at_server, bucket_dir, staging) = (Folder::new("server"), Folder::new("snapshots"), Folder::new("staging"));
    let shelf = || Some(disk::open(at_server.path()).expect("its shelf"));
    let on_shelf = || Options { keep: true, shelf: shelf(), ..Options::local() };
    let mac = node(&mut w, mac_a, &[passkey_a], 1, Options::local()).await;
    let server = node(&mut w, server_d, &[], 2, on_shelf()).await;
    let carol = node(&mut w, mac_c, &[passkey_c], 3, Options::local()).await;
    mac.know(server.addr());
    server.know(mac.addr());
    let (photo_len, scan_len) = (300_000, 2_500_000);
    let photo = mac.store_file(photo_len, reading(1, photo_len)).await.expect("Alice's Mac seals the photo");
    let photo_root = photo.root;
    mac.act(move |lab, me| lab.bring(me, coop, welcome, vec![photo], |_| {})).await.expect("brought into Welcome");
    until("the server keeps the photo whole", || server.holds_file(photo_root)).await;
    // the McEliece keys its edits name come after a pull's last page
    let keyed = || server.read(move |lab, me| lab.request(me, mac_a).wants.is_empty());
    until("the server holds the keys its edits name", keyed).await;
    assert!(server.vaults().await.contains(&coop), "the server knows of the coop");

    // day one: all of the coop, one pack, its McEliece keys and the photo
    let snapshots = Snapshots::new(bucket::Folder::new(bucket_dir.path()), &SEAL, staging.path());
    let day = |n: u64| (20_000 + n) * DAY + 3 * HOUR;
    let first = server.back_up(&snapshots, coop, day(0), false).await.expect("the first snapshot");
    assert_eq!(first.base, None, "built on nothing");
    assert_eq!((first.manifest.packs.len(), first.news), (1, first.manifest.edits), "one pack of every edit");
    assert_eq!(first.manifest.files, vec![photo_root], "and the photo");
    assert!(first.lacking.is_empty() && first.bytes > photo_len, "the photo's bytes copied");
    // day two, nothing changed: a manifest, nothing else
    let quiet = server.back_up(&snapshots, coop, day(1), false).await.expect("a quiet day's snapshot");
    assert_eq!(quiet.base, Some(day(0)), "built on the first");
    assert_eq!((quiet.news, quiet.put, quiet.bytes), (0, 0, 0), "no pack, no blob");
    assert_eq!((&quiet.manifest.packs, quiet.manifest.root), (&first.manifest.packs, first.manifest.root));
    // day three, Alice's Mac brings a scan into Welcome: one pack of what is new, and the scan
    let scan = mac.store_file(scan_len, reading(2, scan_len)).await.expect("Alice's Mac seals the scan");
    let scan_root = scan.root;
    mac.act(move |lab, me| lab.bring(me, coop, welcome, vec![scan], |_| {})).await.expect("brought into Welcome");
    until("the server keeps the scan whole", || server.holds_file(scan_root)).await;
    let busy = server.back_up(&snapshots, coop, day(2), false).await.expect("a busy day's snapshot");
    assert_eq!(busy.base, Some(day(1)), "built on the quiet day's");
    assert!(busy.news > 0 && busy.manifest.edits == first.manifest.edits + busy.news, "only what is new");
    assert_eq!(busy.manifest.packs.len(), 2, "the first pack again and one more");
    assert_eq!(busy.manifest.packs[0], first.manifest.packs[0]);
    let files = &busy.manifest.files;
    assert!(files.len() == 2 && files.contains(&photo_root) && files.contains(&scan_root), "and both files");
    assert_eq!(busy.put, 2, "the pack and the scan, the photo already there");
    assert!(busy.bytes > scan_len && busy.bytes < scan_len + photo_len, "the scan's bytes, not the photo's");
    assert_eq!(snapshots.vaults().await.expect("its folders"), vec![coop], "one folder, the coop's");
    let folder = snapshots.folder(coop).await.expect("the coop's folder");
    assert_eq!(folder.times().await.expect("its snapshots"), vec![day(0), day(1), day(2)]);
    for (name, bytes) in objects(bucket_dir.path()) {
        let sealed = !contains(&bytes, "avenDB") && !contains(&bytes, WELCOME_TEXT);
        assert!(sealed, "{name} is sealed: no header of avenDB's, no Welcome");
    }

    // a check from the bucket alone, restoring nothing: each snapshot whole, every blob there, and every one read
    let all = folder.check(Reading::ALL).await.expect("a check");
    assert!(all.whole(), "every snapshot whole: {all:?}");
    assert_eq!((all.snapshots, all.newest, all.edits), (3, Some(day(2)), busy.manifest.edits));
    assert_eq!((all.read, all.read_bytes), (all.blobs, all.bytes), "every blob read");
    // a day's check: the roots, packs and keys, and neither file's blob unless it is due
    let daily = folder.check(Reading::NONE).await.expect("a check");
    assert!(daily.whole() && daily.read == all.read - 2, "all but the photo and the scan: {daily:?}");
    for (hash, _) in busy.manifest.named() {
        assert_eq!((0..30).filter(|&d| Reading::at(30, day(d)).reads(&hash)).count(), 1, "read on one day of 30");
    }

    // the busy day's snapshot in a new node: every edit, both files, and Carol's Mac reads them from it over iroh
    let (newest_dir, oldest_dir) = (Folder::new("rehearsal-newest"), Folder::new("rehearsal-oldest"));
    let (newest, restored) =
        backup::rehearse(&folder, day(2), newest_dir.path(), Options::local()).await.expect("a rehearsal");
    assert!(newest.whole(), "the busy day's snapshot comes back whole: {newest:?}");
    assert_eq!((newest.edits, newest.files), (busy.manifest.edits, 2));
    assert_ne!(restored.id(), server.id(), "a device of its own, never the live server");
    until("the server's shelf holds all it holds", || async { !server.behind().await }).await;
    server.shutdown().await.expect("the server goes away");
    mac.shutdown().await.expect("and Alice's Mac");
    drop((server, mac));
    carol.know(restored.addr());
    until("Carol's Mac gets from it the writes that bring both files", || async {
        carol.sync_with(restored.id()).await.ok();
        carol.read(move |lab, me| lab.file(me, &photo_root).is_some() && lab.file(me, &scan_root).is_some()).await
    })
    .await;
    let photo_read = carol.read_file(photo_root, 0..u64::MAX).await.expect("Carol's Mac reads the photo");
    let scan_read = carol.read_file(scan_root, 0..u64::MAX).await.expect("and the scan");
    assert_eq!((photo_read, scan_read), (bytes(1, 0, photo_len), bytes(2, 0, scan_len)), "every byte of each");
    // the first day's snapshot: the photo, and no scan
    let (oldest, older) =
        backup::rehearse(&folder, day(0), oldest_dir.path(), Options::local()).await.expect("a rehearsal");
    assert!(oldest.whole() && oldest.edits == first.manifest.edits, "the first day's comes back as it was");
    assert!(older.holds_file(photo_root).await && !older.holds_file(scan_root).await, "the photo, and no scan");
    assert!(backup::rehearse(&folder, day(0), oldest_dir.path(), Options::local()).await.is_err(), "not twice there");

    // made whole: one pack of all of it, the files already there
    let mut again = world();
    handbook(&mut again);
    let server = node(&mut again, server_d, &[], 4, on_shelf()).await;
    let whole = server.back_up(&snapshots, coop, day(3), true).await.expect("a snapshot made whole");
    assert_eq!((whole.base, whole.manifest.packs.len()), (None, 1), "one pack");
    assert_eq!((whole.manifest.edits, whole.put), (busy.manifest.edits, 1), "of the same edits, the pack alone put");
    // retention with no windows keeps the newest alone, and lets go of the two packs and two roots only others named
    let none = Keep { recent: 0, days: 0, weeks: 0 };
    let retained = folder.retain(&none, day(3)).await.expect("retention");
    assert_eq!((retained.kept, retained.dropped.clone(), retained.blobs), (1, vec![day(0), day(1), day(2)], 4));
    assert_eq!(folder.times().await.expect("its snapshots"), vec![day(3)]);
    assert!(folder.manifest(day(0)).await.is_err(), "the first is gone");
    let kept_dir = Folder::new("rehearsal-kept");
    let (kept, last) = backup::rehearse(&folder, day(3), kept_dir.path(), Options::local()).await.expect("a rehearsal");
    assert!(kept.whole() && kept.files == 2, "the one it keeps comes back whole");
    assert!(folder.check(Reading::ALL).await.expect("a check").whole(), "and checks whole");

    // a blob gone from the bucket, and two changed there: a check finds each, and the folder isn't whole
    let at = bucket_dir.path().join("vaults").join(coop.to_hex());
    let (photo, scan) = (Hash::from_bytes(photo_root.hash), Hash::from_bytes(scan_root.hash));
    let pack = whole.manifest.packs[0].0;
    let mut outboards = std::fs::read_dir(at.join("outboards")).expect("its outboards").flatten().map(|e| e.path());
    let outboard = outboards.find(|p| p.to_string_lossy().contains(&photo.to_hex())).expect("the photo's");
    std::fs::remove_file(outboard).expect("the photo's outboard deleted");
    for changed in [scan, pack] {
        let part = at.join("blobs").join(changed.to_hex()).join("000000");
        let mut bytes = std::fs::read(&part).expect("its first part");
        bytes[100] ^= 1;
        std::fs::write(&part, bytes).expect("changed");
    }
    let broken = folder.check(Reading::ALL).await.expect("a check");
    assert!(!broken.whole(), "not whole: {broken:?}");
    assert_eq!(broken.missing, vec![photo], "the photo's blob, missing by the listing alone");
    let mut corrupt = broken.corrupt.clone();
    corrupt.sort();
    let mut changed = vec![scan, pack];
    changed.sort();
    assert_eq!(corrupt, changed, "the scan and the pack, each read past the cache");
    assert!(broken.edits < broken.expected, "the pack's edits not given back");
    let daily = folder.check(Reading::NONE).await.expect("a check");
    assert!(!daily.whole() && daily.missing == vec![photo], "the listing, every day");
    assert_eq!(daily.corrupt, vec![pack], "and the newest snapshot's edits, every day");
    for n in [restored, older, last, carol, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}
