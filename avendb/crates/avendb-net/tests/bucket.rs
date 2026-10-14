//! A node's bucket (blobs B3a, v8 phase S): its shelf, every object sealed under the node's seal; a node whose folder
//! is lost starting again from its bucket alone; a bucket's first shelf marked beside whatever else it holds, and one
//! put aside left whole; a bucket sealed under another seal refused; a server the same device again from its bucket,
//! its secret there alone; and a server that states it holds an edit or a file only once its bucket has it (v8
//! phase H).

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
use avendb::sync::LogId;
use avendb::wire::FileHold;
use avendb_net::bucket::{self, Bucket, Fut, Sealed};
use avendb_net::shelf::FLOOR;
use avendb_net::{Holder, Node, Options, server};
use bytes::Bytes;
use common::Folder;
use iroh_blobs::Hash;
use n0_future::stream;

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
    assert_eq!(bucket::generations(&sealed).await.expect("its shelves"), vec![FLOOR], "the first, of avenDB's floor");
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
    let journal = format!("g{FLOOR}/journal/");
    assert!(now.keys().any(|n| n.starts_with(&journal)), "the Mac's edits are in its shelf's journal");
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
    assert_eq!(bucket::aside(&sealed).await.expect("put aside"), FLOOR + 1);
    assert_eq!(bucket::generations(&sealed).await.expect("its shelves"), vec![FLOOR, FLOOR + 1]);
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
    let journal = format!("g{}/journal/", FLOOR + 1);
    assert!(after.keys().any(|n| n.starts_with(&journal)), "and the new shelf keeps what the Mac takes");
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
    let secret = sealed.get(&format!("g{FLOOR}/{}", server::SECRET)).await.expect("the bucket opens");
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
async fn a_server_states_a_holding_only_once_its_bucket_has_it() {
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
    let backed = Options { retry: Duration::from_millis(100), keep: true, ..shelf };
    let mac = node(&mut w, mac_a, &[passkey_a], 1, Options::local()).await;
    let server = node(&mut w, server_d, &[], 2, backed).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3, Options::local()).await;
    // the Macs reach each other through the server alone
    for n in [&mac, &bob] {
        n.know(server.addr());
        server.know(n.addr());
    }
    let photo_len = 300_000;
    let bytes = Bytes::from((0..photo_len).map(|j| (j % 251) as u8).collect::<Vec<u8>>());
    let photo = mac.store_file(photo_len, stream::iter([Ok(bytes)])).await.expect("Alice's Mac seals a photo");
    let root = photo.root;
    let write = move |lab: &mut Lab, me| {
        let welcome = lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me))?;
        lab.bring(me, coop, welcome, vec![photo], |_| {})?;
        Ok::<_, avendb::policy::Refusal>(welcome)
    };
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome, and brings a photo into it");
    let log = LogId::Entry(welcome);
    let holds = || server.read(move |lab, me| lab.fetched(me, welcome) > 0);
    until("the server takes Welcome's edits from Alice's Mac", holds).await;
    until("and tells Bob's Mac its holdings", || async { bob.holdings_of(server_d).is_some() }).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(server.behind().await, "its bucket is down: the server's bucket lacks Welcome");
    let held = server.holdings().await;
    assert!(held.logs.is_empty() && held.files.is_empty(), "so the server states it holds nothing, of Welcome neither");
    let told = bob.holdings_of(server_d).expect("what the server told Bob's Mac");
    assert!(!told.logs.contains_key(&log) && !told.files.contains_key(&root), "nor tells Bob's Mac it does");
    let synced = mac.synced_to().await;
    let devices: Vec<SignerId> = synced.entries[&welcome].iter().map(|h| h.device).collect();
    assert_eq!(devices, [mac_a], "Alice's Mac shows Welcome synced to itself alone");
    let reads = || bob.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    assert!(!reads().await, "and Bob's Mac doesn't read Welcome through it");
    assert!(outboards(objects.path()).is_empty(), "the bucket holds no blob");
    broken.store(false, Ordering::Relaxed);
    until("the bucket up again, it takes all the server holds", || async { !server.behind().await }).await;
    let frontier = mac.holdings().await.logs[&log].clone();
    let stated = || async { server.holdings().await.logs.get(&log) == Some(&frontier) };
    until("then the server states Welcome's log as Alice's Mac holds it", stated).await;
    until("and the photo, once the bucket has it", || async {
        server.holdings().await.files.get(&root) == Some(&FileHold::Whole)
    })
    .await;
    let hex = Hash::from_bytes(root.hash).to_hex();
    assert!(outboards(objects.path()).iter().any(|o| o.starts_with(&hex)), "which it does");
    let told = || async {
        bob.holdings_of(server_d).is_some_and(|h| h.logs.get(&log) == Some(&frontier) && h.files.contains_key(&root))
    };
    until("and tells Bob's Mac so", told).await;
    until("then Bob's Mac reads Welcome through the server", reads).await;
    let synced = || async {
        let synced = mac.synced_to().await;
        let both = |hs: &Vec<Holder>| {
            [mac_a, server_d].iter().all(|d| hs.iter().any(|h| h.device == *d && h.all()))
        };
        synced.entries.get(&welcome).is_some_and(both) && synced.files.get(&root).is_some_and(both)
    };
    until("and Alice's Mac shows Welcome and the photo synced to the server", synced).await;
    for n in [mac, server, bob] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// The names of the blobs whose outboards bucket folder `objects` holds on its first shelf.
fn outboards(objects: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(objects.join(format!("g{FLOOR}/outboards"))) else { return Vec::new() };
    entries.map(|e| e.expect("an outboard").file_name().into_string().expect("a name")).collect()
}
