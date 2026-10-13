//! Files over iroh-blobs (blobs B2): Alice's Mac brings a photo into Welcome and a scan into Onboarding; the server
//! keeps both whole on disk, opening neither, and still holds them once started again; Carol, who may read Welcome
//! alone, reads ranges of the photo through the server with Alice's Mac gone, fetching only the segments that hold
//! them; and nobody fetches a file that no edit they may receive brings: not Carol the scan, not Dave nor a stranger
//! either file, and nobody a HashSeq with its children. And sync rules (blobs B2c): Alice's iPhone syncs only her
//! proxies and keeps their films whole, while the server keeps every film. And shelves (blobs B2d, B3b): a page brings
//! files onto its shelf, the server keeps them in its bucket, and serves them from the bucket alone once its folder is
//! lost.

mod common;

use std::future::Future;
use std::io;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::SignerId;
use avendb::lab::NewRule;
use avendb::policy::Level;
use avendb::sealed::{FileRoot, PIECE, PIECE_SEGMENTS, SEGMENT};
use avendb::slice::{Atom, Selector, Sym};
use avendb_net::bucket::{self, Sealed};
use avendb_net::{Node, Options, disk};
use bytes::Bytes;
use common::Folder;
use iroh::Endpoint;
use iroh_blobs::protocol::GetRequest;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::{Hash, HashAndFormat};
use n0_future::{Stream, stream};

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8, opts: Options) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await.expect("a node")
}

/// Options for a node whose shelf is in folder `dir`, as the Mac's.
fn on_disk(dir: &Folder) -> Options {
    Options { shelf: Some(disk::open(dir.path()).expect("its shelf")), ..Options::local() }
}

/// Waits until `check` holds, 60 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(60);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 60 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Byte `j` of a file whose bytes start at `seed`.
fn byte(seed: u64, j: u64) -> u8 {
    ((seed + j) % 251) as u8
}

/// The bytes `from..to` of that file.
fn bytes(seed: u64, from: u64, to: u64) -> Vec<u8> {
    (from..to).map(|j| byte(seed, j)).collect()
}

/// That file of `len` bytes as it is read, a megabyte at a time.
fn reading(seed: u64, len: u64) -> impl Stream<Item = io::Result<Bytes>> + Unpin {
    let starts = (0..len.div_ceil(1 << 20)).map(|i| i << 20);
    stream::iter(starts.map(move |from| Ok(Bytes::from(bytes(seed, from, (from + (1 << 20)).min(len))))))
}

/// The blob `request` asks for, fetched by hand from `to` over iroh-blobs as `from`'s endpoint: what arrived, if the
/// node handed anything over.
async fn by_hand(from: &Endpoint, to: &Node, request: GetRequest) -> Option<Vec<u8>> {
    let conn = from.connect(to.addr(), iroh_blobs::ALPN).await.ok()?;
    let store = MemStore::new();
    let hash = request.hash;
    store.remote().execute_get(conn, request).await.ok()?;
    store.get_bytes(hash).await.ok().map(|b| b.to_vec())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn files_follow_their_edits_over_iroh() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    w.lab.issue(w.mac_a, &[w.mac_a], read).expect("Alice's Mac shares Welcome with Carol to read");
    w.lab.sync_all(1);
    let (mac_a, passkey_a, server_d, mac_c, passkey_c, mac_d, passkey_d, stranger_d) =
        (w.mac_a, w.passkey_a, w.server, w.mac_c, w.passkey_c, w.mac_d, w.passkey_d, w.stranger);
    let (coop, welcome, onboarding) = (h.coop, h.welcome, h.onboarding);
    let folder = Folder::new("files");
    let keeps = || Options { keep: true, ..on_disk(&folder) };
    let mac = node(&mut w, mac_a, &[passkey_a], 1, Options::local()).await;
    let server = node(&mut w, server_d, &[], 2, keeps()).await;
    let carol = node(&mut w, mac_c, &[passkey_c], 3, Options::local()).await;
    let dave = node(&mut w, mac_d, &[passkey_d], 4, Options::local()).await;
    let stranger = node(&mut w, stranger_d, &[], 5, Options::local()).await;
    // every Mac reaches the server alone, as Macs behind their routers do
    for n in [&mac, &carol, &dave, &stranger] {
        n.know(server.addr());
        server.know(n.addr());
    }
    // a photo of five segments into Welcome, a scan into Onboarding
    let (photo_len, scan_len) = (300_000, 100_000);
    let photo = mac.store_file(photo_len, reading(1, photo_len)).await.expect("Alice's Mac seals the photo");
    let scan = mac.store_file(scan_len, reading(2, scan_len)).await.expect("and the scan");
    let (photo_root, scan_root) = (photo.root, scan.root);
    assert!(mac.holds_file(photo_root).await && mac.holds_file(scan_root).await, "both in its blob store");
    assert!(mac.store_file(10, reading(3, 11)).await.is_err(), "a file longer than it says is refused");
    assert!(mac.store_file(10, reading(3, 9)).await.is_err(), "and one shorter");
    let bring = move |lab: &mut avendb::lab::Lab, me| {
        lab.bring(me, coop, welcome, vec![photo], |_| {})?;
        lab.bring(me, coop, onboarding, vec![scan], |_| {})
    };
    mac.act(bring).await.expect("Alice's Mac brings them with two writes");
    until("the server keeps both files whole", || async {
        server.holds_file(photo_root).await && server.holds_file(scan_root).await
    })
    .await;
    let opens = move |lab: &avendb::lab::Lab, me| lab.file(me, &photo_root).or(lab.file(me, &scan_root));
    assert!(server.read(opens).await.is_none(), "and opens neither");
    mac.shutdown().await.expect("Alice's Mac goes away");
    drop(mac);
    // Carol reads ranges of the photo through the server, and holds only the segments that hold them
    until("Carol's Mac gets the write that brings the photo", || async {
        carol.sync_with(server.id()).await.ok();
        carol.read(move |lab, me| lab.file(me, &photo_root).is_some()).await
    })
    .await;
    let got = carol.read_file(photo_root, 70_000..70_010).await.expect("Carol's Mac reads ten bytes of the photo");
    assert_eq!(got, bytes(1, 70_000, 70_010), "the very bytes");
    assert!(!carol.holds_file(photo_root).await, "having fetched one segment, not the photo");
    let across = carol.read_file(photo_root, 65_000..140_000).await.expect("a range across three segments");
    assert_eq!(across, bytes(1, 65_000, 140_000));
    assert!(carol.read_file(photo_root, 299_990..400_000).await.expect("a range past the end").len() == 10);
    assert!(carol.read_file(scan_root, 0..10).await.is_err(), "Carol's Mac opens no scan");
    // by hand, as Carol's, Dave's and a stranger's Macs, their hellos proven to the server
    for n in [&dave, &stranger] {
        n.sync_with(server.id()).await.expect("each asks the server, and its hello proves it");
    }
    let raw = |root: FileRoot| GetRequest::blob(Hash::from_bytes(root.hash));
    let photo_bytes = by_hand(carol.endpoint(), &server, raw(photo_root)).await;
    assert_eq!(photo_bytes.map(|b| b.len() as u64), Some(photo_root.size), "Carol's Mac may fetch the sealed photo");
    assert!(by_hand(carol.endpoint(), &server, raw(scan_root)).await.is_none(), "and not the scan");
    let whole = GetRequest::from(HashAndFormat::hash_seq(Hash::from_bytes(photo_root.hash)));
    assert!(by_hand(carol.endpoint(), &server, whole).await.is_none(), "nor the photo as a HashSeq with children");
    for (who, n) in [("Dave's Mac", &dave), ("a stranger", &stranger)] {
        for root in [photo_root, scan_root] {
            assert!(by_hand(n.endpoint(), &server, raw(root)).await.is_none(), "{who} may fetch neither file");
        }
        assert!(n.read(|lab, me| lab.files(me)).await.is_empty(), "{who} knows of no file");
    }
    // the server, started again from its folder, still holds both, and Carol reads the rest of the photo through it
    server.shutdown().await.expect("the server stops");
    drop(server);
    // the same server from a world that never saw the files: what it took comes from its folder
    let mut again = world();
    handbook(&mut again);
    let server = node(&mut again, server_d, &[], 6, keeps()).await;
    assert!(server.holds_file(photo_root).await && server.holds_file(scan_root).await, "both still on its shelf");
    carol.know(server.addr());
    carol.sync_with(server.id()).await.expect("Carol's Mac reaches the server again");
    let all = carol.read_file(photo_root, 0..u64::MAX).await.expect("Carol's Mac reads the whole photo");
    assert_eq!(all, bytes(1, 0, photo_len), "every byte");
    assert!(carol.holds_file(photo_root).await, "and holds it whole now");
    for n in [carol, dave, stranger, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// The names of the blobs whose outboards bucket folder `objects` holds on its first shelf.
fn outboards(objects: &std::path::Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(objects.join("g1/outboards")) else { return Vec::new() };
    entries.map(|e| e.expect("an outboard").file_name().into_string().expect("a name")).collect()
}

/// Alice's page brings a scan and a photo onto its shelf, and the server keeps them in its bucket, each counting only
/// once it is there. With its folder lost, the server serves Carol the photo from the bucket, caching what it reads.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn files_live_on_a_shelf_and_in_the_bucket() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    w.lab.issue(w.mac_a, &[w.mac_a], read).expect("Alice's Mac shares Welcome with Carol to read");
    w.lab.sync_all(1);
    let (mac_a, passkey_a, server_d, mac_c, passkey_c) = (w.mac_a, w.passkey_a, w.server, w.mac_c, w.passkey_c);
    let (coop, welcome, onboarding) = (h.coop, h.welcome, h.onboarding);
    let (at_page, cache, objects) = (Folder::new("shelf-page"), Folder::new("shelf-cache"), Folder::new("objects"));
    let lost = Folder::new("shelf-lost");
    let page = node(&mut w, mac_a, &[passkey_a], 1, on_disk(&at_page)).await;
    let carol = node(&mut w, mac_c, &[passkey_c], 3, Options::local()).await;
    let sealed = Sealed::new(bucket::Folder::new(objects.path()), &[7; 32]);
    let backed = async |dir: &Folder| {
        let shelf = bucket::shelf(sealed.clone(), dir.path(), bucket::CACHE).await.expect("its shelf");
        Options { shelf: Some(shelf), keep: true, ..Options::local() }
    };
    let server = node(&mut w, server_d, &[], 2, backed(&cache).await).await;
    page.know(server.addr());
    server.know(page.addr());
    let scan_len = 100_000;
    let scan = page.store_file(scan_len, reading(2, scan_len)).await.expect("the page seals the scan onto its shelf");
    let scan_root = scan.root;
    assert!(page.holds_file(scan_root).await, "whole on its shelf");
    page.act(move |lab, me| lab.bring(me, coop, onboarding, vec![scan], |_| {})).await.expect("brought");
    until("the server keeps the scan in its bucket", || server.holds_file(scan_root)).await;
    let hex = Hash::from_bytes(scan_root.hash).to_hex();
    assert!(outboards(objects.path()).iter().any(|r| r.starts_with(&hex)), "the scan's outboard in the bucket");
    let photo_len = 300_000;
    let photo = page.store_file(photo_len, reading(1, photo_len)).await.expect("the page seals the photo");
    let photo_root = photo.root;
    page.act(move |lab, me| lab.bring(me, coop, welcome, vec![photo], |_| {})).await.expect("brought");
    until("the server keeps the photo in its bucket", || server.holds_file(photo_root)).await;
    let hex = Hash::from_bytes(photo_root.hash).to_hex();
    assert!(outboards(objects.path()).iter().any(|r| r.starts_with(&hex)), "its outboard in the bucket");
    assert!(std::fs::read_dir(cache.path().join("g1/new")).expect("staging").next().is_none(), "none staged");
    for n in [page, server] {
        n.shutdown().await.expect("the node stops");
    }
    // its folder lost, the server serves Carol from the bucket alone
    let mut again = world();
    handbook(&mut again);
    let server = node(&mut again, server_d, &[], 7, backed(&lost).await).await;
    assert!(server.holds_file(photo_root).await && server.holds_file(scan_root).await, "both, from the bucket");
    carol.know(server.addr());
    until("Carol's Mac gets the write that brings the photo", || async {
        carol.sync_with(server.id()).await.ok();
        carol.read(move |lab, me| lab.file(me, &photo_root).is_some()).await
    })
    .await;
    let got = carol.read_file(photo_root, 70_000..70_010).await.expect("Carol's Mac reads ten bytes of the photo");
    assert_eq!(got, bytes(1, 70_000, 70_010), "the very bytes");
    let all = carol.read_file(photo_root, 0..u64::MAX).await.expect("and the whole photo");
    assert_eq!(all, bytes(1, 0, photo_len), "every byte");
    let cached = std::fs::read_dir(lost.path().join("g1/cache")).expect("the cache").count();
    assert!(cached > 0, "the server cached what it read from the bucket");
    for n in [carol, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// Alice's iPhone syncs only the entries tagged proxy and keeps their films whole, by a rule her Mac sets; the server,
/// with no rule, keeps every film. The iPhone never hears of the original, nor may it fetch the original's film.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_iphone_keeps_the_proxies_its_rule_picks() {
    let mut w = world();
    let (alice, mac_a, passkey_a, phone_a, server_d) = (w.alice, w.mac_a, w.passkey_a, w.phone_a, w.server);
    relay_on(&mut w, alice);
    let proxies = Selector::AnyOf(vec![vec![Atom::TagHas(Sym::new("proxy"))]]);
    let (name, keep) = ("Proxies".into(), true);
    let rule = NewRule { issuer: alice, device: phone_a, over: alice, name, select: proxies, keep };
    w.lab.set_rule(mac_a, &[mac_a], rule).expect("Alice's Mac sets her iPhone's rule");
    w.lab.sync_all(0);
    let keeps = Options { keep: true, ..Options::local() };
    let mac = node(&mut w, mac_a, &[passkey_a], 1, Options::local()).await;
    let server = node(&mut w, server_d, &[], 2, keeps).await;
    let phone = node(&mut w, phone_a, &[], 3, Options::local()).await;
    for n in [&mac, &phone] {
        n.know(server.addr());
        server.know(n.addr());
    }
    let (proxy_len, original_len) = (100_000, 300_000);
    let proxy = mac.store_file(proxy_len, reading(4, proxy_len)).await.expect("Alice's Mac seals the proxy");
    let original = mac.store_file(original_len, reading(5, original_len)).await.expect("and the original");
    let (proxy_root, original_root) = (proxy.root, original.root);
    let make = move |lab: &mut avendb::lab::Lab, me| {
        let p = lab.create(me, alice, alice, "clip", &["proxy"], document("Dawn, proxy", "A clip.", me))?;
        lab.bring(me, alice, p, vec![proxy], |_| {})?;
        let o = lab.create(me, alice, alice, "clip", &["original"], document("Dawn", "A clip.", me))?;
        lab.bring(me, alice, o, vec![original], |_| {})?;
        Ok::<_, avendb::policy::Refusal>((p, o))
    };
    let (p, o) = mac.act(make).await.expect("Alice's Mac makes a proxy and its original");
    until("the server keeps both films whole", || async {
        server.holds_file(proxy_root).await && server.holds_file(original_root).await
    })
    .await;
    until("the iPhone keeps the proxy's film whole", || async {
        phone.sync_with(server.id()).await.ok();
        phone.holds_file(proxy_root).await
    })
    .await;
    let entries = phone.read(|lab, me| lab.entries(me)).await;
    assert!(entries.contains(&p) && !entries.contains(&o), "the iPhone syncs the proxy alone");
    assert_eq!(phone.read(|lab, me| lab.files(me)).await, vec![proxy_root], "and knows of no other film");
    assert!(!phone.holds_file(original_root).await);
    let raw = GetRequest::blob(Hash::from_bytes(original_root.hash));
    assert!(by_hand(phone.endpoint(), &server, raw).await.is_none(), "nor may it fetch the original's film");
    for n in [mac, phone, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// A file of two pieces, a gigabyte and a megabyte, on disk at both ends: run by hand, as it writes 2 GB.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "writes 2 GB to the temporary folder"]
async fn a_file_of_two_pieces_over_iroh() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    w.lab.issue(w.mac_a, &[w.mac_a], read).expect("Alice's Mac shares Welcome with Carol to read");
    w.lab.sync_all(1);
    let (mac_a, passkey_a, server_d, mac_c, passkey_c, mac_d, passkey_d) =
        (w.mac_a, w.passkey_a, w.server, w.mac_c, w.passkey_c, w.mac_d, w.passkey_d);
    let (coop, welcome) = (h.coop, h.welcome);
    let (at_mac, at_server) = (Folder::new("pieces-mac"), Folder::new("pieces-server"));
    let mac = node(&mut w, mac_a, &[passkey_a], 1, on_disk(&at_mac)).await;
    let keeps = Options { keep: true, ..on_disk(&at_server) };
    let server = node(&mut w, server_d, &[], 2, keeps).await;
    let carol = node(&mut w, mac_c, &[passkey_c], 3, Options::local()).await;
    let dave = node(&mut w, mac_d, &[passkey_d], 4, Options::local()).await;
    for n in [&mac, &carol, &dave] {
        n.know(server.addr());
        server.know(n.addr());
    }
    // a gigabyte of plaintext fills the first piece and a little more; a megabyte past it fills part of the second
    let first_piece = PIECE_SEGMENTS * SEGMENT as u64;
    let len = first_piece + (1 << 20);
    let started = Instant::now();
    let film = mac.store_file(len, reading(7, len)).await.expect("Alice's Mac seals the film");
    eprintln!("sealed and stored {len} bytes in {:?}", started.elapsed());
    let root = film.root;
    assert!(root.pieced() && root.size > PIECE, "a file of two pieces, named by the HashSeq of their hashes");
    mac.act(move |lab, me| lab.bring(me, coop, welcome, vec![film], |_| {})).await.expect("brought into Welcome");
    until("the server keeps the film whole", || server.holds_file(root)).await;
    eprintln!("the server keeps it after {:?}", started.elapsed());
    mac.shutdown().await.expect("Alice's Mac goes away");
    drop(mac);
    until("Carol's Mac gets the write that brings the film", || async {
        carol.sync_with(server.id()).await.ok();
        carol.read(move |lab, me| lab.file(me, &root).is_some()).await
    })
    .await;
    let edge = first_piece - 100..first_piece + 100;
    let got = carol.read_file(root, edge.clone()).await.expect("Carol's Mac reads across the two pieces");
    assert_eq!(got, bytes(7, edge.start, edge.end), "the very bytes");
    assert!(!carol.holds_file(root).await, "holding two segments and the HashSeq, not the film");
    // a piece by its own hash, as the gate hands it out: to Carol, not to Dave
    dave.sync_with(server.id()).await.expect("Dave's Mac asks the server, and its hello proves it");
    let seq = by_hand(carol.endpoint(), &server, GetRequest::blob(Hash::from_bytes(root.hash))).await;
    let seq = seq.expect("Carol's Mac may fetch the film's HashSeq");
    let second = Hash::from_bytes(seq[32..64].try_into().expect("two hashes"));
    let piece = by_hand(carol.endpoint(), &server, GetRequest::blob(second)).await;
    assert_eq!(piece.map(|p| p.len() as u64), Some(root.size - PIECE), "and its second piece");
    assert!(by_hand(dave.endpoint(), &server, GetRequest::blob(second)).await.is_none(), "Dave's Mac neither");
    for n in [carol, dave, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}
