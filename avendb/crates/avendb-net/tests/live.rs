//! avenDB's devices on iroh (P8): scenarios 5 and 17 between nodes on this machine, each a device split off the Lab
//! (`Lab::split`) on an endpoint of its own key, syncing by announcements and requests alone, a big answer a page at a
//! time; and what a node refuses: a peer that offers classical key exchange only, a connection without a hello that
//! proves its device, and a McEliece key to a device out of its reach.

use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{BlobId, EntryId, SignerId, SpaceId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::lens::Status;
use avendb::policy::{Action, Role, Scope};
use avendb::sign::Hello;
use avendb::wire::Wire;
use avendb_net::{ALPN, Node, Options, exporter, pq_provider};
use iroh::endpoint::presets;
use iroh::{Endpoint, SecretKey};
use iroh_blobs::Hash;
use iroh_blobs::store::mem::MemStore;
use rustls::NamedGroup;
use rustls::crypto::CryptoProvider;

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, Options::local()).await.expect("a node")
}

/// Each of `nodes` told where each of the others is.
fn meet(nodes: &[&Node]) {
    for a in nodes {
        for b in nodes.iter().filter(|b| b.id() != a.id()) {
            a.know(b.addr());
        }
    }
}

/// Whether the node's device shows todo `e` of space `sp`.
async fn shows(n: &Node, sp: SpaceId, e: EntryId) -> bool {
    n.read(move |lab, me| status(lab, me, sp, e).is_some()).await
}

/// Whether the node's device holds each of the McEliece keys `keys`.
async fn holds(n: &Node, keys: Vec<BlobId>) -> bool {
    n.read(move |lab, me| keys.iter().all(|&b| lab.blob(me, b).is_some())).await
}

/// Waits until `check` holds, 30 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(30);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 30 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Waits until none of `nodes` sends anything for three seconds, three of their retries: once they agree, they say
/// nothing more to each other.
async fn quiet(nodes: &[&Node]) {
    let sent = || nodes.iter().map(|n| n.sent()).collect::<Vec<_>>();
    let end = Instant::now() + Duration::from_secs(30);
    loop {
        let before = sent();
        tokio::time::sleep(Duration::from_secs(3)).await;
        if sent() == before {
            return;
        }
        assert!(Instant::now() < end, "the nodes fall quiet within 30 s");
    }
}

/// An endpoint by hand, of the ed25519 key `secret`, with the TLS of `provider`.
async fn client(secret: [u8; 32], provider: Arc<CryptoProvider>) -> Endpoint {
    let builder = Endpoint::builder(presets::Empty).secret_key(SecretKey::from_bytes(&secret));
    let builder = builder.crypto_provider(provider);
    builder.clear_ip_transports().bind_addr("127.0.0.1:0").expect("loopback").bind().await.expect("an endpoint")
}

/// What a hello by hand is made of: the bytes it says on a connection, given the connection's exporter.
type Saying<'a> = Box<dyn FnOnce(&[u8; 32]) -> Vec<u8> + 'a>;

/// Connects `from` to `to` by hand and says the hello `hello` makes of the connection's exporter: the node's own
/// hello back, or `None` if it refused the connection. And the exporter.
async fn say_hello(from: &Endpoint, to: &Node, hello: Saying<'_>) -> (Option<Hello>, [u8; 32]) {
    let conn = from.connect(to.addr(), ALPN).await.expect("X25519MLKEM768 on both ends connects");
    let exporter = exporter(&conn).expect("an exporter");
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    send.write_all(&hello(&exporter)).await.expect("the hello goes out");
    send.finish().expect("and ends");
    let answer = recv.read_to_end(64 << 10).await.ok().map(|b| Hello::from_wire(&b).expect("a hello"));
    (answer, exporter)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scenario_5_over_iroh() {
    let mut w = world();
    let (coop, space, _) = handbook_spaces(&mut w);
    let (mac_a, passkey_a, server_d, mac_b, passkey_b) = (w.mac_a, w.passkey_a, w.server, w.mac_b, w.passkey_b);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let server = node(&mut w, server_d, &[], 2).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3).await;
    // the Macs reach each other through the server alone, as Macs behind their routers do
    for n in [&mac, &bob] {
        n.know(server.addr());
        server.know(n.addr());
    }
    let write = move |lab: &mut Lab, me| lab.create(me, coop, space, document_v1("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let reads = || bob.read(move |lab, me| text(lab, me, space, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("Bob's Mac reads Welcome, never asked to sync", reads).await;
    assert_eq!(bob.proven(mac.id()), None, "Bob's Mac never reached Alice's: Welcome came through the server");
    assert!(server.read(move |lab, me| lab.fetched(me, space, welcome) > 0).await, "the server holds Welcome's edits");
    let opens = move |lab: &Lab, me| {
        lab.opens(me, KeyScope::Entry(space, welcome)) || lab.opens(me, KeyScope::Space(space))
    };
    assert!(!server.read(opens).await, "the server opens neither Welcome's key nor the Handbook's");
    let store = server.read(|lab, me| lab.store(me)).await;
    assert!(!contains(&store, WELCOME_TEXT), "Welcome's text appears nowhere in the server's store");
    quiet(&[&mac, &server, &bob]).await;
    for n in [mac, server, bob] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scenario_17_over_iroh() {
    let mut w = world();
    let t = todos_on(&mut w);
    let (space, door, seeds, solar, bob_vault) = (t.space, t.door, t.seeds, t.solar, w.bob);
    let (mac_a, passkey_a, mac_c, passkey_c, mac_b, passkey_b) =
        (w.mac_a, w.passkey_a, w.mac_c, w.passkey_c, w.mac_b, w.passkey_b);
    let stranger_d = w.stranger;
    // the server is never started
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let carol = node(&mut w, mac_c, &[passkey_c], 4).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3).await;
    let stranger = node(&mut w, stranger_d, &[], 5).await;
    meet(&[&mac, &carol, &bob, &stranger]);
    let straight = "with the server offline, Carol's Mac gets the door todo straight from Alice's Mac";
    until(straight, || shows(&carol, space, door)).await;
    let none = carol.read(move |lab, me| [seeds, solar].iter().all(|&e| lab.fetched(me, space, e) == 0)).await;
    assert!(none, "and nothing of the other two todos");
    let asked = stranger.sync_with(mac.id()).await.expect("the stranger asks Alice's Mac");
    assert_eq!(asked, 0, "a device without a cap that asks gets nothing");
    assert_eq!(stranger.read(move |lab, me| lab.fetched(me, space, door)).await, 0, "of the door todo neither");
    until("Bob's Mac gets the door todo too", || shows(&bob, space, door)).await;
    let doing = move |lab: &mut Lab, me| lab.edit(me, bob_vault, space, door, |i| i.set_status(Status::Doing));
    bob.act(doing).await.expect("Bob starts on it on Bob's Mac");
    let in_progress = || carol.read(move |lab, me| status(lab, me, space, door) == Some(Status::Doing));
    until("Bob's and Carol's Macs sync directly: Carol sees it in progress", in_progress).await;
    let todo = move |lab: &Lab, me| lab.item(me, space, door).and_then(|i| i.as_todo());
    assert_eq!(carol.read(todo).await, bob.read(todo).await, "both show the same todo");
    assert_eq!(w.lab.fetched(w.server, space, door), 0, "the server never got it");
    quiet(&[&mac, &carol, &bob, &stranger]).await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_peer_that_offers_classical_key_exchange_alone_doesnt_connect() {
    let groups: Vec<NamedGroup> = pq_provider().kx_groups.iter().map(|g| g.name()).collect();
    assert_eq!(groups, [NamedGroup::X25519MLKEM768], "every node offers X25519MLKEM768 and nothing else");
    let mut w = world();
    let (mac_a, passkey_a, mac_b) = (w.mac_a, w.passkey_a, w.mac_b);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let secret = w.lab.endpoint_secret(mac_b).expect("Bob's Mac's key");
    let mut classical = rustls::crypto::aws_lc_rs::default_provider();
    classical.kx_groups = vec![rustls::crypto::aws_lc_rs::kx_group::X25519];
    let old = client(*secret, Arc::new(classical)).await;
    let refused = old.connect(mac.addr(), ALPN).await.err().map(|e| format!("{e:?}"));
    let why = refused.expect("Bob's Mac with X25519 alone doesn't connect");
    assert!(why.contains("NoKxGroupsInCommon"), "as they have no key exchange in common: {why}");
    let new = client(*secret, pq_provider()).await;
    let hello = Box::new(|e: &[u8; 32]| w.lab.hello(mac_b, e, true).expect("Bob's Mac's hello").to_wire());
    let (answer, _) = say_hello(&new, &mac, hello).await;
    assert!(answer.is_some(), "with X25519MLKEM768 it does, and is served");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_connection_is_served_only_once_its_hello_proves_its_device() {
    let mut w = world();
    let (mac_a, passkey_a, mac_b, mac_c) = (w.mac_a, w.passkey_a, w.mac_b, w.mac_c);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    // Bob's Mac by hand: its keys stay in the Lab
    let raw = client(*w.lab.endpoint_secret(mac_b).expect("Bob's Mac's key"), pq_provider()).await;
    let lab = &w.lab;
    let hello = |d, dialer| move |e: &[u8; 32]| lab.hello(d, e, dialer).expect("a hello").to_wire();
    let (answer, exporter) = say_hello(&raw, &mac, Box::new(hello(mac_b, true))).await;
    let answer = answer.expect("Bob's Mac's own hello gets Alice's Mac's back");
    assert_eq!(answer.verify(&exporter, false, mac.id().as_bytes()), Some(mac_a), "which proves Alice's Mac");
    assert_eq!(mac.proven(raw.id()), Some(mac_b), "and Alice's Mac knows Bob's Mac");
    let refused: [(&str, Saying); 5] = [
        ("a hello of another connection", Box::new(|_| hello(mac_b, true)(&[7; 32]))),
        ("a hello for the listening end", Box::new(hello(mac_b, false))),
        ("Carol's Mac's hello, from Bob's Mac's key", Box::new(hello(mac_c, true))),
        ("a request before any hello", Box::new(|_| [&[0][..], &avendb::wire::Request::default().to_wire()].concat())),
        ("bytes that are no hello", Box::new(|_| vec![0xa5; 300])),
    ];
    for (what, hello) in refused {
        let (answer, _) = say_hello(&raw, &mac, hello).await;
        assert!(answer.is_none(), "{what}: refused, and no hello back");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn mceliece_keys_go_over_iroh_blobs_only_within_reach() {
    let mut w = world();
    let (coop, _, _) = handbook_spaces(&mut w);
    // the coop founds a space on Alice's Mac, whose new key is sealed to through the McEliece keys
    let found = Action::FoundSpace { actor: coop, nonce: 7, via: vec![] };
    let found = w.lab.submit(w.mac_a, &[w.mac_a], found).expect("a space");
    let garden = SpaceId::from(found);
    let relay = grant(Scope::Space(garden), Role::Relay, vault(w.avenceo), coop, None);
    w.lab.submit(w.mac_a, &[w.mac_a], relay).expect("the server relays it");
    let server_holds = w.lab.blob_ids(w.server);
    let new: Vec<BlobId> = w.lab.blob_ids(w.mac_a).into_iter().filter(|b| !server_holds.contains(b)).collect();
    assert!(!new.is_empty(), "the space's key brings McEliece keys the server lacks");
    let key = |b| w.lab.blob(w.mac_a, b).expect("a key").to_vec();
    let keys: Vec<(BlobId, Vec<u8>)> = new.iter().map(|&b| (b, key(b))).collect();
    let (mac_a, passkey_a, server_d, mac_b, passkey_b, mac_c, passkey_c) =
        (w.mac_a, w.passkey_a, w.server, w.mac_b, w.passkey_b, w.mac_c, w.passkey_c);
    let mac = node(&mut w, mac_a, &[passkey_a], 1).await;
    let server = node(&mut w, server_d, &[], 2).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3).await;
    let carol = node(&mut w, mac_c, &[passkey_c], 4).await;
    meet(&[&mac, &server, &bob, &carol]);
    until("the server fetches each new McEliece key with the space's log", || holds(&server, new.clone())).await;
    until("and Bob's Mac", || holds(&bob, new.clone())).await;
    until("which opens the new space's key", || bob.read(move |lab, me| lab.opens(me, KeyScope::Space(garden)))).await;
    assert!(!holds(&carol, new.clone()).await, "Carol's Mac, outside the coop, holds none of them");
    // by hand: over iroh-blobs, Alice's Mac hands each key to Bob's Mac and to no other; each asks Alice's Mac
    // first, so its hello proves it there, even if all it holds came through the server
    bob.sync_with(mac.id()).await.expect("Bob's Mac asks Alice's Mac, and its hello proves it");
    carol.sync_with(mac.id()).await.expect("Carol's Mac asks Alice's Mac, and its hello proves it");
    for (b, key) in &keys {
        let hash = Hash::new(key);
        let fetch = |from: &Endpoint| {
            let (from, to) = (from.clone(), mac.addr());
            async move {
                let conn = from.connect(to, iroh_blobs::ALPN).await.ok()?;
                let store = MemStore::new();
                store.remote().fetch(conn, hash).await.ok()?;
                store.get_bytes(hash).await.ok()
            }
        };
        let got = fetch(bob.endpoint()).await.expect("Bob's Mac fetches the key by hand");
        assert_eq!((BlobId::of(&got), &got[..]), (*b, &key[..]), "the very key");
        assert!(fetch(carol.endpoint()).await.is_none(), "Carol's Mac, its hello proven, may not fetch it");
        let unproven = client([9; 32], pq_provider()).await;
        assert!(fetch(&unproven).await.is_none(), "nor may an endpoint no hello proved");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_big_answer_comes_a_page_at_a_time() {
    let mut w = world();
    let (coop, space, _) = handbook_spaces(&mut w);
    let notes: Vec<EntryId> = (0..16)
        .map(|i| {
            let note = document(&format!("Note {i}"), "Seeds for the greenhouse.", w.mac_a);
            w.lab.create(w.mac_a, coop, space, note).expect("Alice's Mac writes a note")
        })
        .collect();
    let request = w.lab.request(w.server, w.mac_a);
    let (whole, _, _) = w.lab.reply(w.mac_a, w.server, &request, usize::MAX);
    // pages of one op each
    let (mac_a, passkey_a, server_d) = (w.mac_a, w.passkey_a, w.server);
    let paged = Options { page: 1, ..Options::local() };
    let mac = Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, paged.clone()).await.expect("a node");
    let server = Node::spawn(w.lab.split(server_d, &[], [2; 32]), server_d, paged).await.expect("a node");
    meet(&[&mac, &server]);
    let holds = || {
        let notes = notes.clone();
        server.read(move |lab, me| notes.iter().all(|&e| lab.fetched(me, space, e) > 0))
    };
    until("the server holds every note", holds).await;
    quiet(&[&mac, &server]).await;
    let (requests, _) = server.sent();
    assert!(requests >= whole.len(), "{} ops in {requests} requests: a page each", whole.len());
    for n in [mac, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_peer_out_of_reach_is_tried_less_and_less_often() {
    let mut w = world();
    handbook_spaces(&mut w);
    let (mac_a, passkey_a) = (w.mac_a, w.passkey_a);
    // Alice's Mac on its own: every peer it knows is out of reach
    let opts = Options { retry: Duration::from_millis(100), ..Options::local() };
    let mac = Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, opts).await.expect("a node");
    tokio::time::sleep(Duration::from_secs(4)).await;
    let peers = mac.read(|lab, me| lab.peers(me).len()).await;
    let dials = mac.dials();
    // every 100 ms for 4 s would be 40 dials a peer; after 0.1, 0.2, 0.4, 0.8 and 1.6 s of waiting, it is 6
    assert!(peers > 0 && dials >= peers, "each of its {peers} peers is tried");
    assert!(dials <= 6 * peers, "{dials} dials to {peers} peers out of reach in 4 s: less and less often");
}
