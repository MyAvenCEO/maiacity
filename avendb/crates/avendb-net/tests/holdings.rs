//! Holdings (v8 phase H): each device tells each peer what it holds for good of what the peer may know, all of it on
//! a new connection and then what changed alone; a node keeps what a device told it on the connection whose hello
//! proved that device, and nothing anyone says of another; it asks a peer for the logs where the peer holds what it
//! lacks, of those the peer may hold, and those alone; holdings let nobody fetch a file T27 refuses, and a device
//! fetches the files of what it follows while its requests say so; and Synced to lists the devices that hold each
//! entry and file, exactly. Some peers are by hand, their keys in the Lab, reading what a node sends them.

use std::collections::BTreeMap;
use std::future::Future;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{EntryId, SignerId};
use avendb::lab::Lab;
use avendb::policy::{Level, Who};
use avendb::sealed::FileRoot;
use avendb::sync::{LogId, asks, frontiers, log_of};
use avendb::wire::{Announce, FileHold, Frontier, Reply, Request, Wire};
use avendb_net::{ALPN, Holder, Node, Options, exporter, pq_provider};
use bytes::Bytes;
use iroh::endpoint::{Connection, presets};
use iroh::{Endpoint, SecretKey};
use iroh_blobs::Hash;
use iroh_blobs::protocol::GetRequest;
use iroh_blobs::store::mem::MemStore;
use n0_future::stream;

/// A request, as a node sends it (`session::REQUEST`).
const REQUEST: u8 = 0;
/// An announcement, as a node sends it (`session::ANNOUNCE`).
const ANNOUNCE: u8 = 1;
/// A request for the logs it names alone (`session::ASK_LOGS`).
const ASK_LOGS: u8 = 7;

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, Options::local()).await.expect("a node")
}

/// Waits until `check` holds, 30 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(30);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 30 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Device `d` by hand: an endpoint of its ed25519 key, its keys staying in `lab`.
async fn by_hand(lab: &Lab, d: SignerId) -> Endpoint {
    let secret = SecretKey::from_bytes(&lab.endpoint_secret(d).expect("its key"));
    let builder = Endpoint::builder(presets::Empty).secret_key(secret).crypto_provider(pq_provider());
    builder.clear_ip_transports().bind_addr("127.0.0.1:0").expect("loopback").bind().await.expect("an endpoint")
}

/// A connection from `from`, device `d` of `lab` by hand, to `to`, once both hellos proved their devices.
async fn hello(lab: &Lab, d: SignerId, from: &Endpoint, to: &Node) -> Connection {
    let conn = from.connect(to.addr(), ALPN).await.expect("a connection");
    let exporter = exporter(&conn).expect("an exporter");
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    send.write_all(&lab.hello(d, &exporter, true).expect("its hello").to_wire()).await.expect("the hello goes out");
    send.finish().expect("and ends");
    let theirs = avendb::sign::Hello::from_wire(&recv.read_to_end(64 << 10).await.expect("a hello back"));
    let proves = theirs.expect("a hello").verify(&exporter, false, to.id().as_bytes());
    assert_eq!(proves, Some(to.device()), "which proves the node's device");
    conn
}

/// Sends a message of `kind` on a stream of its own, as a node does, and waits for its answer.
async fn say(conn: &Connection, kind: u8, body: &[u8]) {
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    send.write_all(&[&[kind][..], body].concat()).await.expect("the message goes out");
    send.finish().expect("and ends");
    recv.read_to_end(16 << 20).await.expect("its answer");
}

/// The next message the node sends on `conn` other than an announcement, answered by `answer`; and the
/// announcements before it, each answered by nothing, as a node answers them.
async fn next(conn: &Connection, kind: u8, answer: impl FnOnce(&[u8]) -> Vec<u8>) -> (Vec<u8>, Vec<Announce>) {
    let mut heard = Vec::new();
    loop {
        let (mut send, mut recv) = conn.accept_bi().await.expect("a message from the node");
        let message = recv.read_to_end(16 << 20).await.expect("its bytes");
        let (&k, body) = message.split_first().expect("a kind");
        if k == ANNOUNCE {
            heard.push(Announce::from_wire(body).expect("an announcement"));
            send.finish().expect("nothing back");
            continue;
        }
        assert_eq!(k, kind, "a message of kind {kind}");
        send.write_all(&answer(body)).await.expect("the answer goes out");
        send.finish().expect("and ends");
        return (body.to_vec(), heard);
    }
}

/// The next announcement the node sends on `conn`.
async fn announced(conn: &Connection) -> Announce {
    let (mut send, mut recv) = conn.accept_bi().await.expect("a message from the node");
    let message = recv.read_to_end(16 << 20).await.expect("its bytes");
    let (&k, body) = message.split_first().expect("a kind");
    assert_eq!(k, ANNOUNCE, "an announcement");
    send.finish().expect("nothing back");
    Announce::from_wire(body).expect("an announcement")
}

/// The blob `hash`, fetched by hand from `to` as `from`'s endpoint, if the node hands it over.
async fn fetch(from: &Endpoint, to: &Node, hash: Hash) -> Option<Vec<u8>> {
    let conn = from.connect(to.addr(), iroh_blobs::ALPN).await.ok()?;
    let store = MemStore::new();
    store.remote().execute_get(conn, GetRequest::blob(hash)).await.ok()?;
    store.get_bytes(hash).await.ok().map(|b| b.to_vec())
}

/// `devices`, smallest first, as Synced to lists them.
fn sorted(mut devices: Vec<SignerId>) -> Vec<SignerId> {
    devices.sort();
    devices
}

/// The devices Synced to on `n` lists with all of entry `e`.
async fn synced(n: &Node, e: EntryId) -> Vec<SignerId> {
    all(n.synced_to().await.entries.get(&e).map(Vec::as_slice).unwrap_or_default())
}

/// The devices among `holders` that hold all of it.
fn all(holders: &[Holder]) -> Vec<SignerId> {
    holders.iter().filter(|h| h.all()).map(|h| h.device).collect()
}

/// A photo of `len` bytes, sealed into `n`'s blob store and brought into entry `e` of `coop`.
async fn photo(n: &Node, coop: avendb::id::VaultId, e: EntryId, len: u64) -> FileRoot {
    let bytes = Bytes::from((0..len).map(|j| (j % 251) as u8).collect::<Vec<u8>>());
    let photo = n.store_file(len, stream::iter([Ok(bytes)])).await.expect("a photo");
    let root = photo.root;
    n.act(move |lab, me| lab.bring(me, coop, e, vec![photo], |_| {})).await.expect("brought");
    root
}

/// Alice's and Bob's Macs reach each other through the server alone. Each node keeps what each device told it on
/// their own connection: Bob's Mac never hears Alice's Mac's holdings, as the server passes on nobody's, nor Alice's
/// Mac Bob's; and Carol's Mac, outside the coop, hears of Welcome from nobody. Synced to lists exactly the devices
/// that told each node they hold Welcome, and the node's own device, and never Carol's.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn holdings_come_only_from_the_connection_that_proved_their_device() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, server_d, mac_b, passkey_b, mac_c, passkey_c) =
        (w.mac_a, w.passkey_a, w.server, w.mac_b, w.passkey_b, w.mac_c, w.passkey_c);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let server = node(&mut w, server_d, &[], 2).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3).await;
    let carol = node(&mut w, mac_c, &[passkey_c], 4).await;
    for n in [&mac, &bob, &carol] {
        n.know(server.addr());
        server.know(n.addr());
    }
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let log = LogId::Entry(welcome);
    let reads = || bob.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("Bob's Mac reads Welcome through the server", reads).await;
    let all = sorted(vec![mac_a, server_d, mac_b]);
    until("the server shows Welcome synced to all three", || async { synced(&server, welcome).await == all }).await;
    let (on_mac, on_bob) = (sorted(vec![mac_a, server_d]), sorted(vec![server_d, mac_b]));
    until("Alice's Mac to itself and the server", || async { synced(&mac, welcome).await == on_mac }).await;
    until("Bob's Mac to the server and itself", || async { synced(&bob, welcome).await == on_bob }).await;
    assert_eq!(bob.proven(mac.id()), None, "the Macs never met");
    assert_eq!(bob.holdings_of(mac_a), None, "so Bob's Mac never heard Alice's Mac's holdings: the server passes none");
    assert_eq!(mac.holdings_of(mac_b), None, "nor Alice's Mac Bob's Mac's");
    let frontier = mac.holdings().await.logs[&log].clone();
    let told = bob.holdings_of(server_d).expect("the server's own holdings");
    assert_eq!(told.logs.get(&log), Some(&frontier), "which hold Welcome as Alice's Mac does");
    until("the server tells Carol's Mac its holdings too", || async { carol.holdings_of(server_d).is_some() }).await;
    let told = carol.holdings_of(server_d).expect("the server's holdings");
    assert!(!told.logs.contains_key(&log), "but nothing of Welcome, which Carol's Mac may not know");
    assert!(carol.read(move |lab, me| lab.fetched(me, welcome) == 0).await, "nor does it get Welcome");
    for n in [mac, server, bob, carol] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// Carol's Mac, outside the coop, by hand, tells Alice's Mac it holds Welcome as she does and its photo whole: Alice's
/// Mac keeps that as Carol's Mac's word alone, of no other device, and shows Welcome and the photo synced to nobody but
/// itself. Told of an edit of Welcome it lacks, it asks Carol's Mac nothing: Welcome's log is beyond what her Mac may
/// hold by its view, so her claim steers nothing, and learns nothing of what it holds.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_forged_holding_from_a_third_party_is_ignored() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_b, mac_c) = (w.mac_a, w.passkey_a, w.mac_b, w.mac_c);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let root = photo(&mac, coop, welcome, 300_000).await;
    let log = LogId::Entry(welcome);
    let frontier = mac.holdings().await.logs[&log].clone();
    let raw = by_hand(&w.lab, mac_c).await;
    let conn = hello(&w.lab, mac_c, &raw, &mac).await;
    let files = vec![(root, Some(FileHold::Whole))];
    let forged = Announce { full: true, logs: vec![(log, frontier.clone())], files };
    say(&conn, ANNOUNCE, &forged.to_wire()).await;
    let heard = mac.holdings_of(mac_c).expect("Alice's Mac keeps what Carol's Mac said");
    assert_eq!(heard.logs.get(&log), Some(&frontier), "as Carol's Mac's word");
    assert_eq!(mac.holdings_of(mac_b), None, "and of no other device");
    let synced = mac.synced_to().await;
    let only = |hs: &[Holder]| hs == [Holder { device: mac_a, has: hs[0].of, of: hs[0].of }];
    assert!(only(&synced.entries[&welcome]), "but shows Welcome synced to itself alone");
    assert!(only(&synced.files[&root]), "and the photo");
    // an edit of Welcome Alice's Mac lacks, of a log beyond Carol's Mac's reach: it asks nothing of it
    let lacking = Frontier { heads: vec![avendb::id::EditId([9; 32])], waiting: vec![] };
    let forged = Announce { full: false, logs: vec![(log, lacking)], files: vec![] };
    say(&conn, ANNOUNCE, &forged.to_wire()).await;
    let asked = tokio::time::timeout(Duration::from_secs(2), next(&conn, ASK_LOGS, |_| Reply::default().to_wire()));
    assert!(asked.await.is_err(), "Alice's Mac asks Carol's Mac nothing of Welcome");
    assert!(mac.read(move |lab, me| lab.fetched(me, welcome) > 0).await, "and it holds Welcome as before");
    mac.shutdown().await.expect("the node shuts down");
}

/// Dave's Mac, outside the coop, by hand, tells Alice's Mac it holds Welcome's photo whole: it still may not fetch the
/// photo, alone or with others, and Alice's Mac names no file to it. Bob's Mac, in the coop, by hand, may fetch it
/// while its sync connection lives, and not once it closed.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn holdings_never_let_a_peer_get_a_file_t27_refuses() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_b, mac_d) = (w.mac_a, w.passkey_a, w.mac_b, w.mac_d);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let root = photo(&mac, coop, welcome, 300_000).await;
    let hash = Hash::from_bytes(root.hash);
    let raw = by_hand(&w.lab, mac_d).await;
    let conn = hello(&w.lab, mac_d, &raw, &mac).await;
    let first = announced(&conn).await;
    assert!(first.full, "Alice's Mac tells Dave's Mac all its holdings on their new connection");
    assert!(first.files.is_empty(), "which name no file Dave's Mac may not fetch");
    assert!(!first.logs.iter().any(|(l, _)| *l == LogId::Entry(welcome)), "nor Welcome's log");
    let forged = Announce { full: true, logs: vec![], files: vec![(root, Some(FileHold::Whole))] };
    say(&conn, ANNOUNCE, &forged.to_wire()).await;
    assert!(mac.holdings_of(mac_d).is_some_and(|h| h.files.contains_key(&root)), "Alice's Mac heard it");
    assert_eq!(fetch(&raw, &mac, hash).await, None, "and still hands Dave's Mac no photo");
    let both = raw.connect(mac.addr(), iroh_blobs::ALPN).await.expect("a blob connection, its sync connection live");
    let many: iroh_blobs::protocol::GetManyRequest = [hash].into_iter().collect();
    assert!(MemStore::new().remote().execute_get_many(both, many).await.is_err(), "nor in a GetMany");
    // Bob's Mac, in the coop, may fetch it while its sync connection lives
    let raw = by_hand(&w.lab, mac_b).await;
    let conn = hello(&w.lab, mac_b, &raw, &mac).await;
    let got = fetch(&raw, &mac, hash).await.expect("Bob's Mac fetches the sealed photo");
    assert_eq!(got.len() as u64, root.size, "all of it");
    conn.close(0u32.into(), b"done");
    until("and not once it closed", || async { fetch(&raw, &mac, hash).await.is_none() }).await;
    mac.shutdown().await.expect("the node shuts down");
}

/// The coop makes Welcome public, with its photo. Dave's Mac, outside the coop, by hand, may fetch the photo only while
/// its last request on its sync connection follows the coop (`sync::Ask::follow`): not before, and not once a request
/// follows nothing again.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_follower_fetches_the_files_of_what_it_follows() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_d) = (w.mac_a, w.passkey_a, w.mac_d);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let root = photo(&mac, coop, welcome, 300_000).await;
    let public = share(coop, Who::Everyone, Level::Read, by_id(welcome));
    mac.act(move |lab, me| lab.issue(me, &[me], public)).await.expect("the coop makes Welcome public");
    let hash = Hash::from_bytes(root.hash);
    let raw = by_hand(&w.lab, mac_d).await;
    let conn = hello(&w.lab, mac_d, &raw, &mac).await;
    assert_eq!(fetch(&raw, &mac, hash).await, None, "Dave's Mac, which follows nothing, may not fetch the photo");
    let ask = |follow: Vec<_>| Request { ask: asks(&[], &follow), wants: vec![], after: None }.to_wire();
    say(&conn, REQUEST, &ask(vec![coop])).await;
    let got = fetch(&raw, &mac, hash).await.expect("once it asks following the coop, it fetches the photo");
    assert_eq!(got.len() as u64, root.size, "all of it");
    say(&conn, REQUEST, &ask(vec![])).await;
    assert_eq!(fetch(&raw, &mac, hash).await, None, "and not once it asks following nothing again");
    mac.shutdown().await.expect("the node shuts down");
}

/// Bob's Mac by hand: Alice's Mac tells it all its holdings on their new connection, and then what changed alone; told
/// of an entry it lacks, it asks for that entry's log alone, and takes it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_announcement_carries_changes_alone_and_an_ask_the_logs_that_differ() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_b) = (w.mac_a, w.passkey_a, w.mac_b);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let raw = by_hand(&w.lab, mac_b).await;
    let conn = hello(&w.lab, mac_b, &raw, &mac).await;
    let first = announced(&conn).await;
    assert!(first.full && first.logs.len() > 1, "all its holdings first: {} logs", first.logs.len());
    let held = mac.holdings().await;
    assert!(first.logs.iter().all(|(l, f)| held.logs.get(l) == Some(f)), "as it holds them");
    // a note on Bob's Mac, which Alice's Mac lacks
    let note = document("Seeds", "Seeds for the greenhouse.", mac_b);
    let note = w.lab.create(mac_b, coop, coop, "doc", &[], note).expect("Bob's Mac writes a note");
    w.lab.checkpoint(mac_b);
    let log = LogId::Entry(note);
    let frontier = Frontier { heads: frontiers(w.lab.log(mac_b).edits())[&log].clone(), waiting: vec![] };
    let told = Announce { full: true, logs: vec![(log, frontier.clone())], files: vec![] };
    say(&conn, ANNOUNCE, &told.to_wire()).await;
    let lab = &mut w.lab;
    let answer = |body: &[u8]| {
        let mut request = Request::from_wire(body).expect("a request");
        assert_eq!(request.ask.haves.keys().collect::<Vec<_>>(), [&log], "for the note's log alone");
        // answered as a node answers it: of that log alone
        let (edits, ids) = (lab.log(mac_b).edits(), lab.log(mac_b).ids());
        let others = edits.iter().zip(ids).filter(|(e, id)| log_of(e, **id) != Some(log)).map(|(_, id)| *id);
        request.ask.loose.extend(others);
        let (edits, ids, more) = lab.reply(mac_b, mac_a, &request, usize::MAX);
        let hash = |id| Hash::new(&lab.blob(mac_b, id).expect("a key")[..]);
        let blobs = ids.into_iter().map(|id| (id, *hash(id).as_bytes())).collect();
        Reply { edits, blobs, more }.to_wire()
    };
    let (_, between) = next(&conn, ASK_LOGS, answer).await;
    assert!(between.is_empty(), "nothing told meanwhile: nothing changed");
    until("Alice's Mac takes the note", || mac.read(move |lab, me| lab.fetched(me, note) > 0)).await;
    // then it tells what changed alone: the note's log, as Bob's Mac holds it, and whatever it changed itself as it
    // took the note, as a steward does
    let mut now: BTreeMap<LogId, Frontier> = first.logs.iter().cloned().collect();
    while now.get(&log) != Some(&frontier) {
        let changed = announced(&conn).await;
        assert!(!changed.full && changed.files.is_empty(), "then it tells what changed");
        assert!(changed.logs.iter().all(|(l, f)| now.get(l) != Some(f)), "and nothing else: {changed:?}");
        assert!(changed.logs.len() < first.logs.len(), "a few logs of the {} it told first", first.logs.len());
        now.extend(changed.logs);
    }
    mac.shutdown().await.expect("the node shuts down");
}
