//! A node's bucket (blobs B3a, v8 phase S): its shelf, every object sealed under the node's seal; a node whose folder
//! is lost starting again from its bucket alone; a bucket's first shelf marked beside whatever else it holds, and one
//! put aside left whole; a bucket sealed under another seal refused; a server the same device again from its bucket,
//! its secret there alone; and nothing told to a peer while the bucket lacks it.

mod common;

use std::collections::BTreeMap;
use std::fs;
use std::future::Future;
use std::path::Path;
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

/// Every file under `dir`, by its path there, with its bytes.
fn files(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut found = BTreeMap::new();
    for entry in fs::read_dir(dir).expect("a folder") {
        let path = entry.expect("an entry").path();
        let name = path.file_name().expect("a name").to_string_lossy().to_string();
        if path.is_dir() {
            found.extend(files(&path).into_iter().map(|(n, bytes)| (format!("{name}/{n}"), bytes)));
        } else {
            found.insert(name, fs::read(&path).expect("a file"));
        }
    }
    found
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

/// Options for a node whose shelf is `sealed`, beside its folder `cache`.
async fn on(sealed: &Sealed, cache: &Path) -> anyhow::Result<Options> {
    let shelf = bucket::shelf(sealed.clone(), cache, bucket::CACHE).await?;
    Ok(Options { shelf: Some(shelf), ..Options::local() })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_whose_folder_is_lost_starts_again_from_its_bucket_alone() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a) = (w.mac_a, w.passkey_a);
    let (cache, objects) = (Folder::new("cache"), Folder::new("bucket"));
    // an earlier avenDB's store in the bucket, which no avenDB reads again
    fs::create_dir_all(objects.path().join("edits")).expect("its folder");
    fs::write(objects.path().join("edits/0000000000000000-00"), [1, 2, 3]).expect("its pack");
    fs::write(objects.path().join("device.key"), [4; 72]).expect("its secret");
    let earlier = files(objects.path());
    let sealed = Sealed::new(bucket::Folder::new(objects.path()), &SEAL);
    let opts = on(&sealed, cache.path()).await.expect("its shelf");
    assert_eq!(bucket::generations(&sealed).await.expect("its shelves"), vec![1], "the first, g1");
    let mac = Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, opts).await.expect("a node");
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    until("the bucket holds all the Mac holds", || async { !mac.behind().await }).await;
    let held = mac.read(|lab, me| lab.size(me)).await;
    mac.shutdown().await.expect("it stops");
    drop(mac);
    let now = files(objects.path());
    for (name, bytes) in &earlier {
        assert_eq!(now.get(name), Some(bytes), "{name} stays as it was");
    }
    assert!(now.keys().any(|n| n.starts_with("g1/journal/")), "the Mac's edits are in g1's journal");
    for (name, bytes) in now.iter().filter(|(n, _)| !earlier.contains_key(*n)) {
        let sealed_up = !contains(bytes, "avenDB") && !contains(bytes, WELCOME_TEXT);
        assert!(sealed_up, "{name} is sealed: no header of avenDB's, no Welcome");
    }
    // the folder lost, and the same Mac from a world that never saw Welcome: what it took comes from the bucket
    fs::remove_dir_all(cache.path()).expect("the folder lost");
    let mut again = world();
    handbook_ready(&mut again);
    let lab = again.lab.split(mac_a, &[passkey_a], [1; 32]);
    assert!(lab.item(mac_a, welcome).is_none(), "a world of its own holds no Welcome");
    let opts = on(&sealed, cache.path()).await.expect("its shelf");
    let mac = Node::spawn(lab, mac_a, opts).await.expect("the node again, from its bucket");
    let shows = move |lab: &Lab, me| text(lab, me, welcome, 2);
    assert_eq!(mac.read(shows).await.as_deref(), Some(WELCOME_TEXT), "started again, it shows Welcome");
    assert_eq!(mac.read(|lab, me| lab.size(me)).await, held, "every edit and every key came back");
    mac.shutdown().await.expect("it stops");
    drop(mac);
    // under another seal, nothing in the bucket opens, and the node doesn't start
    let other = Sealed::new(bucket::Folder::new(objects.path()), &[8; 32]);
    let refused = on(&other, cache.path()).await.err().expect("a bucket sealed under another seal is refused");
    assert!(format!("{refused:#}").contains("doesn't open"), "{refused:#}");
    // put aside: a second shelf beside the first, which holds nothing, and the first stays whole
    let before = files(objects.path());
    assert_eq!(bucket::aside(&sealed).await.expect("put aside"), 2);
    assert_eq!(bucket::generations(&sealed).await.expect("its shelves"), vec![1, 2]);
    let mut third = world();
    handbook_ready(&mut third);
    let lab = third.lab.split(mac_a, &[passkey_a], [1; 32]);
    let opts = on(&sealed, cache.path()).await.expect("its shelf");
    let mac = Node::spawn(lab, mac_a, opts).await.expect("the node on the new shelf");
    assert_eq!(mac.read(shows).await, None, "it starts without Welcome");
    until("the bucket holds all the Mac holds", || async { !mac.behind().await }).await;
    mac.shutdown().await.expect("it stops");
    let after = files(objects.path());
    for (name, bytes) in &before {
        assert_eq!(after.get(name), Some(bytes), "{name} stays as it was");
    }
    assert!(after.keys().any(|n| n.starts_with("g2/journal/")), "and the new shelf keeps what the Mac takes");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_server_whose_folder_is_lost_is_the_same_device_again() {
    let (cache, objects) = (Folder::new("server-cache"), Folder::new("server-bucket"));
    let sealed = Sealed::new(bucket::Folder::new(objects.path()), &SEAL);
    let shelf = on(&sealed, cache.path()).await.expect("its shelf").shelf.expect("a shelf");
    let first = server::open(shelf, Options::local()).await.expect("a server");
    let device = first.device();
    first.shutdown().await.expect("it stops");
    drop(first);
    let secret = sealed.get(&format!("g1/{}", server::SECRET)).await.expect("the bucket opens");
    let secret = secret.expect("its secret in the bucket");
    assert_eq!(secret.len(), 32, "a 32-byte secret");
    for (name, bytes) in files(cache.path()) {
        assert!(!bytes.windows(32).any(|w| w == secret), "{name} in the folder doesn't hold the secret");
    }
    fs::remove_dir_all(cache.path()).expect("the folder lost");
    let shelf = on(&sealed, cache.path()).await.expect("its shelf").shelf.expect("a shelf");
    let again = server::open(shelf, Options::local()).await.expect("the server again, from its bucket");
    assert_eq!(again.device(), device, "the same device");
    again.shutdown().await.expect("it stops");
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
    let broken = Arc::new(AtomicBool::new(false));
    let flaky = Flaky { folder: bucket::Folder::new(objects.path()), broken: broken.clone() };
    let shelf = on(&Sealed::new(flaky, &SEAL), cache.path()).await.expect("its shelf, marked");
    // the bucket down from then on
    broken.store(true, Ordering::Relaxed);
    let backed = Options { retry: Duration::from_millis(100), ..shelf };
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
