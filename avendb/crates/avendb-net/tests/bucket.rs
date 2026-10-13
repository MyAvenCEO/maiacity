//! A node's bucket (blobs B3a): every object sealed under the node's seal, a node whose folder is lost starting again
//! from its bucket alone, the whole log in one pack after each start, replacing the packs before it, a bucket sealed
//! under another seal refused, a server the same device again from its bucket, and nothing told to a peer while the
//! bucket lacks it.

mod common;

use std::fs;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use anyhow::anyhow;
use avendb::cast::*;
use avendb::id::SignerId;
use avendb::lab::Lab;
use avendb_net::bucket::{self, Bucket, Fut, Sealed};
use avendb_net::{Node, Options, server};
use common::Folder;

/// The seal the tests' buckets are sealed under.
const SEAL: [u8; 32] = [7; 32];

/// Waits until `check` holds, 30 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(30);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 30 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Every file under `dir`.
fn files(dir: &Path) -> Vec<PathBuf> {
    let entries = fs::read_dir(dir).expect("a folder").map(|e| e.expect("an entry").path());
    entries.flat_map(|path| if path.is_dir() { files(&path) } else { vec![path] }).collect()
}

/// A bucket in a folder that refuses every upload while it is broken.
struct Flaky {
    folder: bucket::Folder,
    broken: Arc<AtomicBool>,
}

impl Bucket for Flaky {
    fn put<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> Fut<'a, ()> {
        if self.broken.load(Ordering::Relaxed) {
            return Box::pin(async { Err(anyhow!("the bucket is down")) });
        }
        self.folder.put(name, bytes)
    }

    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>> {
        self.folder.get(name)
    }

    fn list<'a>(&'a self, prefix: &'a str) -> Fut<'a, Vec<String>> {
        self.folder.list(prefix)
    }

    fn delete<'a>(&'a self, name: &'a str) -> Fut<'a, ()> {
        self.folder.delete(name)
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_whose_folder_is_lost_starts_again_from_its_bucket_alone() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a) = (w.mac_a, w.passkey_a);
    let (cache, objects) = (Folder::new("cache"), Folder::new("bucket"));
    let sealed = Sealed::new(bucket::Folder::new(objects.path()), &SEAL);
    let opts = Options { store: Some(cache.path().to_path_buf()), bucket: Some(sealed.clone()), ..Options::local() };
    let mac = Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, opts.clone()).await.expect("a node");
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    until("the bucket holds all the Mac holds", || async { !mac.behind().await }).await;
    let held = mac.read(|lab, me| lab.size(me)).await;
    mac.shutdown().await.expect("it stops");
    drop(mac);
    let packs = sealed.list("edits/").await.expect("its packs");
    assert!(packs.first().is_some_and(|p| p.starts_with("edits/0000000000000000-")), "the whole log first: {packs:?}");
    let keys = sealed.list("keys/").await.expect("its keys");
    assert_eq!(keys.len(), held.1, "and every McEliece key");
    for file in files(objects.path()) {
        let bytes = fs::read(&file).expect("an object");
        let sealed_up = !contains(&bytes, "avenDB edits") && !contains(&bytes, WELCOME_TEXT);
        assert!(sealed_up, "{} is sealed: no pack's header, no Welcome", file.display());
    }
    // the folder lost, and the same Mac from a world that never saw Welcome: what it took comes from the bucket
    fs::remove_dir_all(cache.path()).expect("the folder lost");
    let mut again = world();
    handbook_ready(&mut again);
    let lab = again.lab.split(mac_a, &[passkey_a], [1; 32]);
    assert!(lab.item(mac_a, welcome).is_none(), "a world of its own holds no Welcome");
    let mac = Node::spawn(lab, mac_a, opts.clone()).await.expect("the node again, from its bucket");
    let shows = move |lab: &Lab, me| text(lab, me, welcome, 2);
    assert_eq!(mac.read(shows).await.as_deref(), Some(WELCOME_TEXT), "started again, it shows Welcome");
    let size = mac.read(|lab, me| lab.size(me)).await;
    assert!(size.0 >= held.0 && size.1 == held.1, "every edit and every key came back: {size:?} for {held:?}");
    until("the bucket holds all the Mac holds again", || async { !mac.behind().await }).await;
    let before = packs;
    let replaced = || async { sealed.list("edits/").await.expect("its packs").iter().all(|p| !before.contains(p)) };
    until("a pack of the whole log replaces the packs before it", replaced).await;
    let packs = sealed.list("edits/").await.expect("its packs");
    assert!(packs[0].starts_with("edits/0000000000000000-"), "the whole log first: {packs:?}");
    let listed = fs::read_to_string(cache.path().join("packs")).expect("the folder lists its packs");
    assert_eq!(listed.lines().collect::<Vec<_>>(), packs, "as on disk");
    mac.shutdown().await.expect("it stops");
    drop(mac);
    // under another seal, nothing in the bucket opens, and the node doesn't start
    let other = Options { bucket: Some(Sealed::new(bucket::Folder::new(objects.path()), &[8; 32])), ..opts };
    fs::remove_dir_all(cache.path()).expect("the folder lost");
    let mut third = world();
    handbook_ready(&mut third);
    let lab = third.lab.split(mac_a, &[passkey_a], [1; 32]);
    let refused = Node::spawn(lab, mac_a, other).await.err().expect("a bucket sealed under another seal is refused");
    assert!(format!("{refused:#}").contains("doesn't open"), "{refused:#}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_server_whose_folder_is_lost_is_the_same_device_again() {
    let (cache, objects) = (Folder::new("server-cache"), Folder::new("server-bucket"));
    let sealed = Sealed::new(bucket::Folder::new(objects.path()), &SEAL);
    let opts = Options { bucket: Some(sealed.clone()), ..Options::local() };
    let first = server::open(cache.path(), opts.clone()).await.expect("a server");
    let device = first.device();
    first.shutdown().await.expect("it stops");
    drop(first);
    let secret = sealed.get(server::SECRET).await.expect("the bucket opens").expect("its secret in the bucket");
    assert_eq!(secret, fs::read(cache.path().join(server::SECRET)).expect("its secret"), "the folder's");
    fs::remove_dir_all(cache.path()).expect("the folder lost");
    let again = server::open(cache.path(), opts.clone()).await.expect("the server again, from its bucket");
    assert_eq!(again.device(), device, "the same device");
    again.shutdown().await.expect("it stops");
    // another server's folder on this bucket: two secrets, and it doesn't start
    let other = Folder::new("other-server");
    server::open(other.path(), Options::local()).await.expect("another server").shutdown().await.expect("it stops");
    let refused = server::open(other.path(), opts).await.err().expect("two servers' secrets are refused");
    assert!(format!("{refused:#}").contains("two servers' secrets"), "{refused:#}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_tells_its_peers_nothing_its_bucket_lacks() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, server_d, mac_b, passkey_b) = (w.mac_a, w.passkey_a, w.server, w.mac_b, w.passkey_b);
    let node = async |w: &mut World, d: SignerId, with: &[SignerId], seed: u8, opts: Options| {
        Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await.expect("a node")
    };
    let (cache, objects) = (Folder::new("down-cache"), Folder::new("down-bucket"));
    let broken = Arc::new(AtomicBool::new(true));
    let flaky = Flaky { folder: bucket::Folder::new(objects.path()), broken: broken.clone() };
    let backed = Options {
        store: Some(cache.path().to_path_buf()),
        bucket: Some(Sealed::new(flaky, &SEAL)),
        retry: Duration::from_millis(100),
        ..Options::local()
    };
    let mac = node(&mut w, mac_a, &[passkey_a], 1, Options::local()).await;
    let server = node(&mut w, server_d, &[], 2, backed).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3, Options::local()).await;
    // the Macs reach each other through the server alone
    for n in [&mac, &bob] {
        n.know(server.addr());
        server.know(n.addr());
    }
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let holds = || server.read(move |lab, me| lab.fetched(me, welcome) > 0);
    until("the server takes Welcome's edits from Alice's Mac", holds).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(server.behind().await, "its bucket is down: the server's bucket lacks Welcome");
    assert_eq!(server.sent().1, 0, "so the server announces nothing");
    let reads = || bob.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    assert!(!reads().await, "and Bob's Mac doesn't read Welcome through it");
    broken.store(false, Ordering::Relaxed);
    until("the bucket up again, it takes all the server holds", || async { !server.behind().await }).await;
    until("then Bob's Mac reads Welcome through the server", reads).await;
    for n in [mac, server, bob] {
        n.shutdown().await.expect("the node shuts down");
    }
}
