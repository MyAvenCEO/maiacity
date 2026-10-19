//! The server's relay (P8b): devices with no UDP of their own sync through it alone, as a device behind a strict
//! firewall would; it lets in only the devices the server knows, those of the vaults acting for the vaults it relays,
//! and lets go of a device taken out of its vault; and a new server, started as its binary starts it, learns its
//! devices from what it relays. From P8c, a new device that linked through the server is let in too; from P8d, a new
//! device with no UDP of its own, as a browser's, by its passkey's pass, until the pass runs out. From P8f, a new
//! server lets in a pass of any passkey until the first human vault claims it, and then no stranger's.

#[path = "../../avendb-net/tests/common/mod.rs"]
mod common;

use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Level, Principal, Revoking};
use avendb::sign::PASS_LIFE;
use avendb::slice::Selector;
use avendb::{engine, lens, world};
use avendb_net::{Admission, Node, Offer, Options, server};
use avendb_server::{Config, Relay};
use common::Folder;
use iroh::{EndpointId, RelayUrl, SecretKey};
use serde_json::{Value, json};

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

/// A bucket's seal, as its environment says it: 64 hex digits.
const SEAL: &str = "abababababababababababababababababababababababababababababababab";

/// How a device with no UDP of its own runs: it reaches every peer through `relay`.
fn relay_only(relay: &RelayUrl) -> Options {
    Options { bind: None, relay: Some(relay.clone()), ..Options::local() }
}

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8, opts: Options) -> Node {
    Node::spawn(w.lab.split(d, with, [seed; 32]), d, opts).await.expect("a node")
}

/// The endpoint of device `d` of `w`'s Lab.
fn endpoint(w: &World, d: SignerId) -> EndpointId {
    SecretKey::from_bytes(&w.lab.endpoint_secret(d).expect("a device's key")).public()
}

/// The time by this machine's clock: seconds since 1970.
fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").as_secs()
}

/// How a new device with no UDP of its own runs, as a browser's: through `relay` alone, showing it `pass`.
fn with_pass(relay: &RelayUrl, pass: avendb::sign::RelayPass) -> Options {
    Options { relay_pass: Some(pass), ..relay_only(relay) }
}

/// Waits until `check` holds, 30 seconds at most.
async fn until<F: Future<Output = bool>>(what: &str, mut check: impl FnMut() -> F) {
    let end = Instant::now() + Duration::from_secs(30);
    while !check().await {
        assert!(Instant::now() < end, "{what}, within 30 s");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Waits until none of `nodes` sends anything for three seconds: once they agree, they say nothing more.
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

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn scenario_5_through_the_relay_alone() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, server_d, mac_b, passkey_b) = (w.mac_a, w.passkey_a, w.server, w.mac_b, w.passkey_b);
    let stranger_d = w.stranger;
    let opts = Options { relay: Some(url.clone()), admission: Some(admission), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_a, &[passkey_a], 1, relay_only(&url)).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3, relay_only(&url)).await;
    let stranger = node(&mut w, stranger_d, &[], 5, relay_only(&url)).await;
    for n in [&mac, &bob, &stranger] {
        assert!(n.endpoint().bound_sockets().is_empty(), "a device with no UDP of its own");
        n.know(server.addr());
    }
    let write = move |lab: &mut Lab, me| {
        lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me))
    };
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let reads = || bob.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("Bob's Mac reads Welcome, through the relay alone", reads).await;
    let met = || async { bob.proven(mac.id()) == Some(mac_a) };
    until("through the relay, the Macs reach each other by their ids alone", met).await;
    let holds = || server.read(move |lab, me| lab.fetched(me, welcome) > 0);
    until("and the server holds Welcome's edits", holds).await;
    let opens = move |lab: &Lab, me| {
        let audience = lab.state(me).entry(welcome).expect("Welcome").audience();
        lab.reads(me, welcome) || lab.opens(me, KeyFam::Audience(coop, audience)) || lab.opens(me, KeyFam::Seed(coop))
    };
    assert!(!server.read(opens).await, "the server opens neither Welcome's key, nor its cell's, nor the coop's");
    let serves = [&mac, &bob, &server].iter().all(|n| relay.serves(&n.id()));
    assert!(serves, "the relay serves the Macs and the server");
    // the relay turns away a device the server doesn't know, which then reaches no one
    assert!(!relay.serves(&stranger.id()), "the relay turns the stranger away");
    let reach = tokio::time::timeout(Duration::from_secs(3), stranger.sync_with(server.id())).await;
    assert!(!matches!(reach, Ok(Ok(_))), "and the stranger can't reach the server");
    quiet(&[&mac, &server, &bob]).await;
    for n in [mac, server, bob, stranger] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_server_lets_in_the_devices_of_the_vaults_it_relays() {
    let dir = Folder::new("relay");
    let data = dir.path().to_path_buf();
    let (relay_url, public_addr) = (None, None);
    let (signup, gate, bucket, cache) = (false, false, None, 0);
    let (bind, relay_bind, feed_bind) = (LOOPBACK, LOOPBACK, LOOPBACK);
    let snapshots = None;
    let config =
        Config { data, bind, relay_bind, feed_bind, relay_url, public_addr, signup, gate, bucket, cache, snapshots };
    let started = avendb_server::start(&config).await.expect("the server and its relay");
    let (server, relay) = (&started.node, &started.relay);
    let url = relay.url();
    assert_eq!(server::vault(server).await, None, "a new server is nobody's");
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_b, passkey_b) = (w.mac_a, w.passkey_a, w.mac_b, w.passkey_b);
    let bob_mac = endpoint(&w, mac_b);
    // Alice's Mac, on UDP, makes its first contact with the server straight: the relay doesn't know it yet
    let opts = Options { relay: Some(url.clone()), ..Options::local() };
    let mac = node(&mut w, mac_a, &[passkey_a], 1, opts).await;
    mac.know(server.addr());
    assert!(!relay.admission().admits(&mac.id()), "the new server knows no device of Alice's");
    // Alice's vault claims it first: the server is a device of avenMAIA, the aven of the seed her vault founds
    let v = mac.claim(&started.offer, passkey_a).await.expect("Alice's vault claims the server");
    assert_eq!(server::vault(server).await, Some(v), "the server is avenMAIA's device");
    until("the server knows Alice's Mac", || async { relay.admission().admits(&mac.id()) }).await;
    assert!(!relay.admission().admits(&bob_mac), "and not yet Bob's");
    // the coop gives avenMAIA relay on the whole of it, and Alice writes Welcome into it
    let relayed = move |lab: &mut Lab, me| {
        lab.issue(me, &[me], share(coop, vault(v), Level::Backup, Selector::All))?;
        lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me))
    };
    let welcome = mac.act(relayed).await.expect("the coop, relayed by avenMAIA, and Welcome");
    let holds = || server.read(move |lab, me| lab.fetched(me, welcome) > 0);
    until("the new server holds Welcome's edits", holds).await;
    until("from the coop's log it lets Bob's Mac in", || async { relay.admission().admits(&bob_mac) }).await;
    mac.shutdown().await.expect("Alice's Mac stops");
    // Bob's Mac has no UDP: it takes the server's card through the relay, then Welcome
    let bob = node(&mut w, mac_b, &[passkey_b], 3, relay_only(&url)).await;
    bob.know(server.addr());
    assert!(bob.contact(server.id()).await.expect("the server's card, through the relay") > 0);
    let reads = || bob.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("Bob's Mac reads Welcome, written while it was away", reads).await;
    assert_eq!(bob.proven(mac.id()), None, "from the server: Bob's Mac never met Alice's");
    assert!(relay.serves(&bob.id()), "through the relay");
    bob.shutdown().await.expect("Bob's Mac stops");
    started.shutdown().await.expect("the server stops");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_taken_out_of_its_vault_is_let_go_by_the_relay() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    handbook_ready(&mut w);
    let (mac_a, passkey_a, phone_a, server_d, alice) = (w.mac_a, w.passkey_a, w.phone_a, w.server, w.alice);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_a, &[passkey_a], 1, relay_only(&url)).await;
    let phone = node(&mut w, phone_a, &[], 6, relay_only(&url)).await;
    for n in [&mac, &phone] {
        n.know(server.addr());
    }
    until("the relay serves Alice's phone", || async { relay.serves(&phone.id()) }).await;
    let take_out = Action::Revoke(Revoking::Device { vault: alice, device: phone_a, keep: vec![] });
    mac.act(move |lab, me| lab.submit(me, &[passkey_a], take_out)).await.expect("Alice takes her phone out");
    until("the server learns it, and stops admitting the phone", || async { !admission.admits(&phone.id()) }).await;
    until("the relay lets the phone go", || async { !relay.serves(&phone.id()) }).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(!relay.serves(&phone.id()), "and doesn't let it back in");
    assert!(relay.serves(&mac.id()) && relay.serves(&server.id()), "while it serves Alice's Mac and the server");
    for n in [mac, server, phone] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_device_linked_through_the_server_is_let_in_by_its_relay() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    let h = handbook(&mut w);
    // Alice loses her Mac and her iPhone; her passkey is on her new Mac
    w.lab.lose(w.mac_a);
    w.lab.lose(w.phone_a);
    let new = w.lab.device_of(w.passkey_a, "Alice's new Mac");
    let (passkey_a, server_d) = (w.passkey_a, w.server);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, new, &[passkey_a], 7, Options { relay: Some(url.clone()), ..Options::local() }).await;
    assert!(!admission.admits(&mac.id()), "the server doesn't know the new Mac");
    // the new Mac, on UDP, makes its first contact straight, by the server's offer
    let offer = Offer::from_text(&server.offer().to_text()).expect("the server's offer");
    mac.link(&offer, passkey_a).await.expect("the new Mac links through the server");
    until("once it joined, the server lets it in", || async { admission.admits(&mac.id()) }).await;
    let welcome = h.welcome;
    let reads = || mac.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("the new Mac reads Welcome", reads).await;
    until("and the relay serves it", || async { relay.serves(&mac.id()) }).await;
    quiet(&[&mac, &server]).await;
    for n in [mac, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_servers_offer_names_its_public_address_and_its_relay() {
    let dir = Folder::new("offer");
    let public: SocketAddr = "203.0.113.7:7401".parse().expect("a socket");
    let relay_url: RelayUrl = "https://avendb.maia.city".parse().expect("a URL");
    let config = Config {
        data: dir.path().to_path_buf(),
        bind: LOOPBACK,
        relay_bind: LOOPBACK,
        feed_bind: LOOPBACK,
        relay_url: Some(relay_url.clone()),
        public_addr: Some(public),
        signup: true,
        gate: false,
        bucket: None,
        cache: 0,
        snapshots: None,
    };
    let started = avendb_server::start(&config).await.expect("the server and its relay");
    let offer = Offer::from_text(&started.offer.to_text()).expect("its offer reads back");
    assert_eq!(offer.device, started.node.device(), "its device");
    assert_eq!(offer.addr.id, started.node.id(), "its endpoint");
    assert_eq!(offer.addr.ip_addrs().collect::<Vec<_>>(), [&public], "where devices on UDP reach it, alone");
    assert_eq!(offer.addr.relay_urls().collect::<Vec<_>>(), [&relay_url], "and its relay");
    started.shutdown().await.expect("the server stops");
}

/// What the server at `addr` answers a plain HTTP/1.1 request for `path` by `method`: its head, lower case, and its
/// body.
async fn http(addr: SocketAddr, method: &str, path: &str) -> (String, String) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut stream = tokio::net::TcpStream::connect(addr).await.expect("the feed's socket");
    let request = format!("{method} {path} HTTP/1.1\r\nHost: avendb.maia.city\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.expect("the request");
    let mut answer = String::new();
    stream.read_to_string(&mut answer).await.expect("the answer");
    let (head, body) = answer.split_once("\r\n\r\n").expect("a head and a body");
    (head.to_lowercase(), body.to_string())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_server_serves_the_posts_everyone_reads_as_the_maia_universe_feed() {
    let dir = Folder::new("feed");
    let (data, relay_url, public_addr) = (dir.path().to_path_buf(), None, None);
    let (signup, gate, bucket, cache) = (true, false, None, 0);
    let (bind, relay_bind, feed_bind) = (LOOPBACK, LOOPBACK, LOOPBACK);
    let snapshots = None;
    let config =
        Config { data, bind, relay_bind, feed_bind, relay_url, public_addr, signup, gate, bucket, cache, snapshots };
    let started = avendb_server::start(&config).await.expect("the server, its relay and its feed");
    let addr = started.feed.addr();
    // a new server keeps nothing anyone published yet; any page may read its feed
    let (head, body) = http(addr, "GET", "/feed/posts").await;
    assert!(head.starts_with("http/1.1 200"), "{head}");
    assert!(head.contains("content-type: application/json"), "{head}");
    assert!(head.contains("access-control-allow-origin: *"), "{head}");
    assert_eq!(body, r#"{"posts":[]}"#);
    let (head, _) = http(addr, "OPTIONS", "/feed/posts").await;
    assert!(head.starts_with("http/1.1 204") && head.contains("access-control-allow-origin: *"), "{head}");
    // no picture anyone may read yet, a name that isn't a picture's, nor a path that names no vault
    let vault = "ab".repeat(32);
    let picture = format!("/feed/files/{vault}/{}.png", "cd".repeat(32));
    for path in [picture.as_str(), &format!("/feed/files/{vault}/notes.txt"), "/feed/files/nobody/a.png"] {
        let (head, body) = http(addr, "GET", path).await;
        assert!(head.starts_with("http/1.1 404") && head.contains("access-control-allow-origin: *"), "{path}: {head}");
        assert_eq!(body, "no such picture", "{path}");
    }
    let (head, _) = http(addr, "OPTIONS", &picture).await;
    assert!(head.starts_with("http/1.1 204"), "a page may ask for one: {head}");
    // no entry nor code anyone may read yet, however a query asks for it, nor any one entry; a query it can't read is a
    // bad request
    let empty = [
        ("/feed/entries", r#"{"entries":[]}"#),
        ("/feed/entries?type=story,article&seed=1", r#"{"entries":[]}"#),
        ("/feed/entries?type=story%2Cpotion&t=1", r#"{"entries":[]}"#),
        ("/feed/code", r#"{"code":[]}"#),
        ("/feed/code?seed=1&type=view,logic&bare=1", r#"{"code":[]}"#),
        ("/feed/code?kind=view%2Clogic&t=1", r#"{"code":[]}"#),
    ];
    for (path, want) in empty {
        let (head, body) = http(addr, "GET", path).await;
        assert!(head.starts_with("http/1.1 200") && head.contains("access-control-allow-origin: *"), "{path}: {head}");
        assert!(head.contains("content-type: application/json"), "{path}: {head}");
        assert_eq!(body, want, "{path}");
    }
    let many = format!("/feed/entries?type={}", ["story"; 17].join(","));
    let entry = format!("/feed/entry/{vault}/{}", "cd".repeat(32));
    let asked = format!("{entry}?vault=Maia%20City");
    for path in ["/feed/code?type=potion", "/feed/code?vault=Maia%20City", &many, &asked] {
        let (head, body) = http(addr, "GET", path).await;
        assert!(head.starts_with("http/1.1 400") && head.contains("content-type: application/json"), "{path}: {head}");
        assert!(body.starts_with(r#"{"error":"#), "{path}: {body}");
    }
    for path in [entry.as_str(), "/feed/entry/nobody", "/feed/entry/"] {
        let (head, body) = http(addr, "GET", path).await;
        assert!(head.starts_with("http/1.1 404") && head.contains("access-control-allow-origin: *"), "{path}: {head}");
        assert!(body.starts_with(r#"{"error":"#), "{path}: {body}");
    }
    for path in ["/feed/entries", "/feed/code", entry.as_str()] {
        let (head, _) = http(addr, "OPTIONS", path).await;
        assert!(head.starts_with("http/1.1 204"), "a page may ask for {path}: {head}");
    }
    let (head, _) = http(addr, "GET", "/relay").await;
    assert!(head.starts_with("http/1.1 404"), "nothing else: {head}");
    started.shutdown().await.expect("the server stops");
}

/// What the server at `addr` answers a GET of `path`, which must be found: its body, as JSON.
async fn got(addr: SocketAddr, path: &str) -> Value {
    let (head, body) = http(addr, "GET", path).await;
    assert!(head.starts_with("http/1.1 200"), "{path}: {head}");
    serde_json::from_str(&body).unwrap_or_else(|e| panic!("{path}: {e}: {body}"))
}

/// What device `me`'s node answers op `op`, run as the page runs it (`engine::run`), which it must answer.
async fn ran(node: &Node, op: Value) -> Value {
    let answer = node.act(move |lab, me| engine::run(lab, me, &op)).await;
    assert!(answer.get("ok").is_some(), "refused: {answer}");
    answer["ok"].clone()
}

/// The entries and the code everyone may read, over HTTP, as a page nobody signed in to and the API read them: Maia
/// City, the coop of the seed Alice's claim of the server founds, and a coop of her own that calls itself Maia City
/// too, each make a view and their profile Public, and keep a logic to themselves. The server serves both views, by its
/// seed's name for Maia City's alone; `seed=1` keeps Maia City's, whatever the other calls itself; a page asks for the
/// kinds it wants; and each public entry reads whole on its own, as the same query asks for it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_server_serves_the_code_everyone_reads_and_maia_citys_alone_for_seed_1() {
    let dir = Folder::new("code");
    let (data, relay_url, public_addr) = (dir.path().to_path_buf(), None, None);
    let (signup, gate, bucket, cache) = (false, false, None, 0);
    let (bind, relay_bind, feed_bind) = (LOOPBACK, LOOPBACK, LOOPBACK);
    let snapshots = None;
    let config =
        Config { data, bind, relay_bind, feed_bind, relay_url, public_addr, signup, gate, bucket, cache, snapshots };
    let started = avendb_server::start(&config).await.expect("the server, its relay and its feed");
    let (server, addr) = (&started.node, started.feed.addr());
    let mut w = world();
    let (mac_a, passkey) = (w.mac_a, w.passkey_a);
    let opts = Options { relay: Some(started.relay.url()), ..Options::local() };
    let mac = node(&mut w, mac_a, &[passkey], 1, opts).await;
    mac.know(server.addr());
    // Alice's vault claims the server: the seed it founds is Maia City, a coop her vault owns alone, and avenMAIA, its
    // aven, the server's vault; Maia City gives avenMAIA backup, as every vault founded under her follows her server
    // setting, so the server knows it as its seed's coop
    let avenceo = mac.claim(&started.offer, passkey).await.expect("Alice's vault claims the server");
    let coop_of = move |lab: &Lab, me| match lab.state(me).vault(avenceo).map(|v| &v.owners[..]) {
        Some(&[Principal::Vault(coop)]) => Some(coop),
        _ => None,
    };
    let city = mac.read(coop_of).await.expect("Maia City, founded with the seed");
    let seed = || server.read(world::seed_of);
    let backup = move |v: VaultId| {
        move |lab: &mut Lab, me| lab.issue(me, &[me], share(v, vault(avenceo), Level::Backup, Selector::All))
    };
    mac.act(backup(city)).await.expect("Maia City gives avenMAIA backup");
    until("the server knows its seed's coop", || async { seed().await.first() == Some(&city) }).await;
    assert_eq!(seed().await, [city, avenceo], "Maia City and avenMAIA");
    // a coop of her own, which she calls Maia City too
    let owners = vec![Principal::Vault(w.alice)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 41, seal_to: vec![] };
    let found = mac.act(move |lab, me| lab.submit(me, &[passkey], genesis)).await;
    let fake = VaultId::from(found.expect("Alice's vault founds a coop"));
    // each named Maia City, its name Public, as everyone may read who published, and Public on a tag, with a public
    // view and a private logic
    let tag = "code:public";
    let (mut views, mut logics) = (vec![], vec![]);
    mac.act(backup(fake)).await.expect("her coop gives avenMAIA backup too");
    for v in [city, fake] {
        let v = v.to_hex();
        ran(&mac, json!({ "op": "profile", "vault": v, "name": world::SEED_COOP })).await;
        for what in [json!({ "tag": tag }), json!({ "type": [world::PROFILE] })] {
            let public = json!({ "op": "share", "over": v, "who": "everyone", "level": "Public", "what": what,
                "as": v });
            ran(&mac, public).await;
        }
        let view = json!({ "kind": "view", "title": "Holders", "source": "<p>{{n}}</p>",
            "data": { "n": 1 }, "height": 300 });
        let create = json!({ "op": "create", "vault": v, "type": "view", "tags": [tag], "value": view,
            "as": v });
        views.push(ran(&mac, create).await["entry"].as_str().expect("its id").to_string());
        let logic = json!({ "op": "create", "vault": v, "type": "logic",
            "value": { "kind": "logic", "source": "export function tick() {}" }, "as": v });
        logics.push(ran(&mac, logic).await["entry"].as_str().expect("its id").to_string());
    }
    let entries = |code: &Value| -> Vec<String> {
        let rows = code["code"].as_array().expect("its rows");
        rows.iter().map(|r| r["entry"].as_str().expect("an entry").to_string()).collect()
    };
    let mut both = views.clone();
    both.sort();
    let listed = || async {
        let mut listed = entries(&got(addr, "/feed/code").await);
        listed.sort();
        listed == both
    };
    until("the server serves both public views, and no private logic", listed).await;
    // seed=1: Maia City's alone, by where it stands in the seed, never by the name another vault gives itself
    let ours = got(addr, "/feed/code?seed=1").await;
    assert_eq!(entries(&ours), [views[0].clone()], "Maia City's view alone");
    let row = &ours["code"][0];
    let named = [&row["seed"], &row["name"], &row["vault"]].map(Value::clone);
    assert_eq!(named, [json!(world::SEED_COOP), json!(world::SEED_COOP), json!(city.to_hex())]);
    let typed = [&row["type"], &row["schema"], &row["tags"]].map(Value::clone);
    assert_eq!(typed, [json!("view"), json!(lens::VIEW_V2.id().to_hex()), json!([tag])], "a view of v2");
    let record = [&row["record"]["source"], &row["record"]["height"], &row["record"]["form"]].map(Value::clone);
    assert_eq!(record, [json!("<p>{{n}}</p>"), json!(300), json!("html")], "its record on main");
    assert!(row["heads"].as_array().is_some_and(|hs| hs.len() == 1), "the heads of that version: {row}");
    let theirs = got(addr, &format!("/feed/code?vault={}", fake.to_hex())).await;
    assert_eq!(entries(&theirs), [views[1].clone()]);
    let named = [&theirs["code"][0]["seed"], &theirs["code"][0]["name"]].map(Value::clone);
    assert_eq!(named, [Value::Null, json!(world::SEED_COOP)], "a name is no seed");
    // bare: every row as it was but its record
    let bare = got(addr, "/feed/code?seed=1&type=view&bare=1").await;
    let mut want = row.clone();
    want.as_object_mut().expect("a row").remove("record");
    assert_eq!(bare["code"], json!([want]), "its entry, vault, type, schema, tags and heads, no record");
    assert_eq!(got(addr, "/feed/code?seed=1&kind=logic").await, json!({ "code": [] }), "no public logic");
    // the entries of the kinds a page asks for, of whatever kind: Maia City's profile and view, by kind; both views
    let kinds = got(addr, "/feed/entries?type=view,profile&seed=1").await;
    let rows = kinds["entries"].as_array().expect("its rows");
    let typed: Vec<&Value> = rows.iter().map(|r| &r["type"]).collect();
    assert_eq!(typed, [&json!("profile"), &json!("view")], "{kinds}");
    assert_eq!((&rows[0]["record"]["title"], &rows[1]), (&json!(world::SEED_COOP), row), "its name, and the same row");
    let views_of = got(addr, "/feed/entries?type=view").await;
    assert_eq!(views_of["entries"], got(addr, "/feed/code").await["code"], "the views are all the code");
    let all = got(addr, "/feed/entries").await;
    let all = all["entries"].as_array().expect("its rows");
    assert!(all.len() >= 4 && all.iter().all(|r| r["entry"] != logics[0] && r["entry"] != logics[1]), "{all:?}");
    // one public entry, whole, as its row, and as a query asks for it; a private one is not found, nor one the query
    // doesn't ask for
    let at = |v: VaultId, e: &str, query: &str| format!("/feed/entry/{}/{e}{query}", v.to_hex());
    assert_eq!(&got(addr, &at(city, &views[0], "")).await, row, "the same row");
    assert_eq!(got(addr, &at(city, &views[0], "?seed=1&bare=1")).await, want, "bare");
    for (path, why) in [(at(city, &logics[0], ""), "a private logic"), (at(fake, &views[1], "?seed=1"), "no seed's")] {
        let (head, body) = http(addr, "GET", &path).await;
        assert!(head.starts_with("http/1.1 404") && body.starts_with(r#"{"error":"#), "{why}: {head}");
    }
    mac.shutdown().await.expect("Alice's Mac stops");
    started.shutdown().await.expect("the server stops");
}

/// Op `op` on `node` with the bytes of `text` beside it, as a page hands a file's bytes over (`Node::run`), which it
/// must answer: what it made.
async fn brought(node: &Node, op: Value, text: &str) -> Value {
    use http_body_util::{BodyExt as _, Full};
    use hyper::body::Bytes;
    let text = Bytes::from(text.to_string());
    let bytes = move || Full::new(text.clone()).map_err(|e: std::convert::Infallible| -> std::io::Error { match e {} });
    let bytes = move || bytes().into_data_stream();
    let (answer, _) = node.run(op, Some(bytes), None::<&avendb_net::NoCeremony>).await.expect("an answer");
    assert!(answer.get("ok").is_some(), "refused: {answer}");
    answer["ok"].clone()
}

/// A public code entry's file, over HTTP, as a page with no device reads a recipe's source: Maia City creates a
/// recipe with its source, one write, and brings a newer one into it; each row of it lists both, and
/// `/feed/entry/<vault>/<entry>/file` serves the newest whole, as plain text no page runs, `seed=1` holding as ever.
/// An entry with no file, a private one, one that isn't code, and one `seed=1` leaves out are not found; a query it
/// can't read is a bad request.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_server_serves_a_public_code_entrys_newest_file_whole_as_plain_text() {
    let dir = Folder::new("source");
    let (data, relay_url, public_addr) = (dir.path().to_path_buf(), None, None);
    let (signup, gate, bucket, cache) = (false, false, None, 0);
    let (bind, relay_bind, feed_bind) = (LOOPBACK, LOOPBACK, LOOPBACK);
    let snapshots = None;
    let config =
        Config { data, bind, relay_bind, feed_bind, relay_url, public_addr, signup, gate, bucket, cache, snapshots };
    let started = avendb_server::start(&config).await.expect("the server, its relay and its feed");
    let (server, addr) = (&started.node, started.feed.addr());
    let mut w = world();
    let (mac_a, passkey, alice) = (w.mac_a, w.passkey_a, w.alice);
    let opts = Options { relay: Some(started.relay.url()), ..Options::local() };
    let mac = node(&mut w, mac_a, &[passkey], 1, opts).await;
    mac.know(server.addr());
    // Alice's vault claims the server, whose seed is Maia City and avenMAIA, its aven; Maia City and Alice's vault give
    // avenMAIA backup
    let avenceo = mac.claim(&started.offer, passkey).await.expect("Alice's vault claims the server");
    let coop_of = move |lab: &Lab, me| match lab.state(me).vault(avenceo).map(|v| &v.owners[..]) {
        Some(&[Principal::Vault(coop)]) => Some(coop),
        _ => None,
    };
    let city = mac.read(coop_of).await.expect("Maia City, founded with the seed");
    for v in [city, alice] {
        let backup = share(v, vault(avenceo), Level::Backup, Selector::All);
        mac.act(move |lab, me| lab.issue(me, &[me], backup)).await.expect("it gives avenMAIA backup");
    }
    let seeded = || async { server.read(world::seed_of).await.first() == Some(&city) };
    until("the server knows its seed's coop", seeded).await;
    // each Public on a tag
    let tag = "code:public";
    for v in [city, alice] {
        let public = json!({ "op": "share", "over": v.to_hex(), "who": "everyone", "level": "Public",
            "what": { "tag": tag }, "as": v.to_hex() });
        ran(&mac, public).await;
    }
    let recipe = |label: &str| {
        json!({ "kind": "recipe", "title": label, "source": "",
            "engine": { "host": "box", "version": 4, "hash": "ab".repeat(32) }, "manifest": { "kit": ["box"] },
            "card": { "format": "asset-card", "v": 1, "group": "machines", "label": label } })
    };
    let create = |v: VaultId, ty: &str, tags: Value, value: Value, text: &str| {
        let file = json!({ "len": text.len(), "name": "source.js", "media": "text/javascript" });
        json!({ "op": "create", "vault": v.to_hex(), "type": ty, "tags": tags, "value": value, "file": file,
            "as": v.to_hex() })
    };
    // Maia City's lamp, with its source, then a newer source brought into it
    let (old, new) = ("export default (kit) => kit.box(1);\n", "export default (kit) => kit.box(2); // newer\n");
    let lamp = brought(&mac, create(city, "recipe", json!([tag]), recipe("Lamp"), old), old).await;
    let e = lamp["entry"].as_str().expect("its entry").to_string();
    let into = json!({ "op": "put_file", "entry": e, "len": new.len(), "name": "source.js", "as": city.to_hex() });
    let newer = brought(&mac, into, new).await;
    assert_eq!(newer["entry"], json!(e), "brought into it");
    // Alice's own lantern, public too; Maia City's view, with no file; a private logic and a public post, each with one
    let lantern = create(alice, "recipe", json!([tag]), recipe("Lantern"), "lantern\n");
    let lantern = brought(&mac, lantern, "lantern\n").await;
    let view = json!({ "kind": "view", "title": "Holders", "source": "<p>{{n}}</p>", "data": { "n": 1 } });
    let create_view = json!({ "op": "create", "vault": city.to_hex(), "type": "view", "tags": [tag], "value": view,
        "as": city.to_hex() });
    let view = ran(&mac, create_view).await;
    let logic = json!({ "kind": "logic", "source": "export function tick() {}" });
    let logic = brought(&mac, create(city, "logic", json!([]), logic, "private\n"), "private\n").await;
    let post = json!({ "kind": "post", "title": "Harvest", "text": "Out now.", "channel": "Devlog" });
    let post = brought(&mac, create(city, "post", json!([tag]), post, "a post's file\n"), "a post's file\n").await;
    let file = |v: VaultId, made: &Value, query: &str| {
        format!("/feed/entry/{}/{}/file{query}", v.to_hex(), made["entry"].as_str().expect("an entry"))
    };
    let lamps = file(city, &lamp, "");
    let served = || async { http(addr, "GET", &lamps).await.0.starts_with("http/1.1 200") };
    until("the server serves the lamp's newest source", served).await;
    // its row lists both files, the newest last, as the code and the entry's own row do
    let listed = |made: &Value, text: &str| json!({ "root": made["root"], "size": made["size"], "len": text.len() });
    let row = got(addr, &format!("/feed/entry/{}/{e}", city.to_hex())).await;
    assert_eq!(row["files"], json!([listed(&lamp, old), listed(&newer, new)]), "{row}");
    let code = got(addr, "/feed/code?seed=1&type=recipe").await;
    assert_eq!(code["code"], json!([row]), "Maia City's recipe alone, the same row");
    let views = got(addr, "/feed/code?seed=1&type=view").await;
    assert_eq!(views["code"][0]["files"], json!([]), "a view with no file lists none");
    let posts = format!("/feed/entry/{}/{}", city.to_hex(), post["entry"].as_str().expect("an entry"));
    let public = || async { http(addr, "GET", &posts).await.0.starts_with("http/1.1 200") };
    until("the server serves the post", public).await;
    let posted = "a post's file\n";
    assert_eq!(got(addr, &posts).await["files"], json!([listed(&post, posted)]), "a public post lists its file");
    // the newest, whole, as plain text that no page runs
    let (head, body) = http(addr, "GET", &lamps).await;
    assert_eq!(body, new);
    for want in ["content-type: text/plain; charset=utf-8", "x-content-type-options: nosniff",
        "access-control-allow-origin: *", &format!("content-length: {}", new.len())]
    {
        assert!(head.contains(want), "{want}: {head}");
    }
    let (head, body) = http(addr, "HEAD", &lamps).await;
    assert!(head.starts_with("http/1.1 200") && body.is_empty(), "{head}");
    let (head, _) = http(addr, "OPTIONS", &lamps).await;
    assert!(head.starts_with("http/1.1 204"), "a page may ask for it: {head}");
    // seed=1 as ever: Maia City's lamp, never Alice's own lantern, which is served without it
    assert_eq!(http(addr, "GET", &file(city, &lamp, "?seed=1&type=recipe")).await.1, new);
    let (head, body) = http(addr, "GET", &file(alice, &lantern, "")).await;
    assert!(head.starts_with("http/1.1 200") && body == "lantern\n", "{head}");
    // and none of these
    let none = [
        (file(alice, &lantern, "?seed=1"), "a vault seed=1 leaves out"),
        (file(city, &view, ""), "an entry with no file"),
        (file(city, &logic, ""), "a private logic"),
        (file(city, &post, ""), "a post, which is no code"),
        (format!("/feed/entry/{}/{}/file", city.to_hex(), "cd".repeat(32)), "an entry the server doesn't hold"),
        (format!("/feed/entry/{}/file", city.to_hex()), "no entry named"),
        (format!("/feed/entry/{}/{e}/files", city.to_hex()), "no such route"),
    ];
    for (path, why) in none {
        let (head, body) = http(addr, "GET", &path).await;
        assert!(head.starts_with("http/1.1 404") && head.contains("access-control-allow-origin: *"), "{why}: {head}");
        assert!(!body.contains("kit.box") && !body.contains("private") && !body.contains("post's"), "{why}: {body}");
    }
    let (head, body) = http(addr, "GET", &file(city, &lamp, "?vault=Maia%20City")).await;
    assert!(head.starts_with("http/1.1 400") && head.contains("content-type: text/plain"), "{head}");
    assert!(body.contains("vault is a vault's id"), "{body}");
    mac.shutdown().await.expect("Alice's Mac stops");
    started.shutdown().await.expect("the server stops");
}

#[test]
fn the_server_is_configured_by_its_environment() {
    let defaults = Config::from_vars(|_| None).expect("the defaults");
    assert_eq!(defaults.data, PathBuf::from("/data"));
    assert_eq!(defaults.bind, "0.0.0.0:7401".parse::<SocketAddr>().expect("a socket"), "iroh's UDP");
    assert_eq!(defaults.relay_bind, "0.0.0.0:3350".parse::<SocketAddr>().expect("a socket"), "the relay's HTTP");
    assert_eq!(defaults.feed_bind, "0.0.0.0:3351".parse::<SocketAddr>().expect("a socket"), "the feed's HTTP");
    assert_eq!(defaults.relay_url, None, "the relay's own socket, unless it is said where devices reach it");
    assert_eq!(defaults.public_addr, None, "its own interfaces' addresses, unless it is said where it is reached");
    assert!(defaults.signup, "sign-up is open, unless it is said closed");
    assert!(!defaults.gate, "it takes any new vault, unless it is said gated");
    assert!(defaults.bucket.is_none(), "no bucket, unless one is said");
    assert_eq!(defaults.cache, 8 << 30, "its folder caches 8 GB of the bucket's files, unless it is said");
    let vars = HashMap::from([
        ("AVENDB_DATA", "/srv/avendb"),
        ("AVENDB_BIND", "[::]:7402"),
        ("AVENDB_RELAY_BIND", "127.0.0.1:3351"),
        ("AVENDB_FEED_BIND", "127.0.0.1:3352"),
        ("AVENDB_RELAY_URL", "https://avendb.maia.city"),
        ("AVENDB_PUBLIC_ADDR", "203.0.113.7:7401"),
        ("AVENDB_SIGNUP", "closed"),
        ("AVENDB_GATE", "on"),
        ("AVENDB_BUCKET", "maiacity-avendb"),
        ("AVENDB_BUCKET_ENDPOINT", "https://hel1.your-objectstorage.com"),
        ("AVENDB_BUCKET_REGION", "hel1"),
        ("AVENDB_BUCKET_ACCESS_KEY", "an access key"),
        ("AVENDB_BUCKET_SECRET_KEY", "a secret key"),
        ("AVENDB_BUCKET_SEAL", SEAL),
        ("AVENDB_CACHE", "20"),
    ]);
    let set = Config::from_vars(|k| vars.get(k).map(|v| v.to_string())).expect("what the environment says");
    assert_eq!(set.data, PathBuf::from("/srv/avendb"));
    assert_eq!(set.bind, "[::]:7402".parse::<SocketAddr>().expect("a socket"));
    assert_eq!(set.relay_bind, "127.0.0.1:3351".parse::<SocketAddr>().expect("a socket"));
    assert_eq!(set.feed_bind, "127.0.0.1:3352".parse::<SocketAddr>().expect("a socket"));
    assert_eq!(set.relay_url, Some("https://avendb.maia.city".parse().expect("a URL")));
    assert_eq!(set.public_addr, Some("203.0.113.7:7401".parse().expect("a socket")));
    assert!(!set.signup);
    assert!(set.gate);
    let bucket = set.bucket.expect("a bucket");
    assert_eq!((bucket.name.as_str(), bucket.region.as_str()), ("maiacity-avendb", "hel1"));
    assert_eq!(*bucket.seal, [0xab; 32], "its seal, from 64 hex digits");
    assert!(!format!("{bucket:?}").contains("secret key"), "its keys never in a log line");
    assert_eq!(set.cache, 20 << 30, "20 GB of cache");
    for (unsaid, seal) in [("AVENDB_BUCKET_REGION", SEAL), ("", &SEAL[2..])] {
        let var = |k: &str| {
            let v = if k == "AVENDB_BUCKET_SEAL" { Some(seal) } else { vars.get(k).copied() };
            v.filter(|_| k != unsaid).map(str::to_string)
        };
        assert!(Config::from_vars(var).is_err(), "a bucket with {unsaid} unsaid, or a seal short of 32 bytes: said so");
    }
    assert!(defaults.snapshots.is_none() && set.snapshots.is_none(), "no backups, unless their bucket is said");
    // a bucket of snapshots, at the server's bucket's endpoint with its key unless its own are said, under its seal
    let mut backed = vars.clone();
    backed.extend([("AVENDB_SNAPSHOTS", "maiacity-avendb-snapshots"), ("AVENDB_SNAPSHOTS_AT", "04:30")]);
    backed.insert("AVENDB_SNAPSHOTS_READ_DAYS", "90");
    backed.insert("AVENDB_SNAPSHOTS_ACCESS_KEY", "a key of its own");
    let set = Config::from_vars(|k| backed.get(k).map(|v| v.to_string())).expect("a bucket of snapshots");
    let snapshots = set.snapshots.expect("its backups");
    let b = &snapshots.bucket;
    let at = (b.name.as_str(), b.endpoint.as_str(), b.region.as_str());
    let hel1 = ("maiacity-avendb-snapshots", "https://hel1.your-objectstorage.com", "hel1");
    assert_eq!(at, hel1, "where the server's bucket is");
    assert_eq!((b.access_key.as_str(), b.secret_key.as_str()), ("a key of its own", "a secret key"));
    assert_eq!((*b.seal, snapshots.at), ([0xab; 32], 4 * 3600 + 30 * 60), "the server's seal, at half past four");
    assert_eq!(snapshots.dir, std::env::temp_dir().join("avendb-snapshots"));
    assert_eq!(snapshots.read_days, 90, "each file's blobs read once in 90 days");
    let by_default = |k: &str| (!k.starts_with("AVENDB_SNAPSHOTS_")).then(|| backed.get(k).map(|v| v.to_string()));
    let by_default = Config::from_vars(|k| by_default(k).flatten()).expect("by default").snapshots.expect("backups");
    assert_eq!((by_default.at, by_default.read_days), (3 * 3600, 30), "at three, each blob read once in 30 days");
    let wrong = [("AVENDB_SNAPSHOTS", "maiacity-avendb"), ("AVENDB_SNAPSHOTS_AT", "4h"), ("AVENDB_BUCKET_SEAL", "")];
    for (k, v) in wrong.into_iter().chain([("AVENDB_SNAPSHOTS_READ_DAYS", "monthly")]) {
        let var = |n: &str| match n == k {
            true => Some(v.to_string()).filter(|v| !v.is_empty()),
            false => backed.get(n).map(|v| v.to_string()),
        };
        assert!(Config::from_vars(var).is_err(), "{k} as {v:?}: the server's own bucket, no time, no seal or no days");
    }
    assert!(Config::from_vars(|k| (k == "AVENDB_SIGNUP").then(|| "maybe".to_string())).is_err());
    assert!(Config::from_vars(|k| (k == "AVENDB_GATE").then(|| "maybe".to_string())).is_err());
    let wrong = Config::from_vars(|k| (k == "AVENDB_BIND").then(|| "the server's port".to_string()));
    assert!(wrong.is_err(), "a socket that isn't one is said so, not taken for the default");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_device_with_no_udp_gets_onto_the_relay_by_its_passkeys_pass_and_links() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    let h = handbook(&mut w);
    let eve_key = w.lab.passkey("Eve");
    let eves = w.lab.device_of(eve_key, "Eve's browser");
    let old = w.lab.device_of(w.passkey_a, "Alice's old browser");
    let other = w.lab.device_of(w.passkey_a, "Alice's other browser");
    let new = w.lab.device_of(w.passkey_a, "Alice's browser");
    let (mac_a, passkey_a, server_d, alice) = (w.mac_a, w.passkey_a, w.server, w.alice);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_a, &[], 1, relay_only(&url)).await;
    mac.know(server.addr());
    until("the relay serves Alice's Mac", || async { relay.serves(&mac.id()) }).await;
    let now = unix_now();
    let mut pass = |d, passkey, made| w.lab.relay_pass(d, passkey, made).expect("a pass");
    let (eve_pass, stale) = (pass(eves, eve_key, now), pass(old, passkey_a, now - PASS_LIFE));
    let fresh = pass(new, passkey_a, now);
    // Alice's browser shows its own pass, for its own endpoint, by Alice's passkey: let in, for ten minutes
    let browser = node(&mut w, new, &[passkey_a], 7, with_pass(&url, fresh.clone())).await;
    until("the relay lets Alice's browser in by its pass", || async { relay.serves(&browser.id()) }).await;
    assert!(relay.passed(&browser.id()).is_some_and(|until| until == now + PASS_LIFE), "for ten minutes");
    assert!(!admission.admits(&browser.id()), "though the server doesn't know it yet");
    // a pass by a passkey that roots no vault the server knows, one that ran out, and one for another endpoint
    let eve = node(&mut w, eves, &[eve_key], 8, with_pass(&url, eve_pass)).await;
    let old = node(&mut w, old, &[passkey_a], 9, with_pass(&url, stale)).await;
    let other = node(&mut w, other, &[passkey_a], 10, with_pass(&url, fresh)).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(!relay.serves(&eve.id()), "Eve's passkey roots no vault the server knows: turned away");
    assert!(!relay.serves(&old.id()), "a pass that ran out: turned away");
    assert!(!relay.serves(&other.id()), "another device's pass: turned away");
    // through the relay alone, the browser links through Alice's Mac, whose code it scanned, and the server learns it
    let offer = Offer::from_text(&mac.offer().to_text()).expect("the Mac's code");
    assert!(offer.addr.ip_addrs().next().is_none(), "the Mac too is reached through the relay alone");
    assert_eq!(browser.link(&offer, passkey_a).await.expect("the browser links"), alice);
    until("once it joined, the server knows it", || async { admission.admits(&browser.id()) }).await;
    let welcome = h.welcome;
    let reads = || browser.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("the browser reads Welcome", reads).await;
    quiet(&[&mac, &server, &browser]).await;
    for n in [mac, server, browser, eve, old, other] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn the_relay_lets_a_device_go_once_its_pass_runs_out_unless_it_joined() {
    let admission = Admission::default();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    handbook_ready(&mut w);
    let new = w.lab.device_of(w.passkey_a, "Alice's browser");
    let (passkey_a, server_d) = (w.passkey_a, w.server);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    // a pass with five seconds left: the browser never links
    let pass = w.lab.relay_pass(new, passkey_a, unix_now() + 5 - PASS_LIFE).expect("a pass");
    let browser = node(&mut w, new, &[passkey_a], 7, with_pass(&url, pass)).await;
    until("let in by its pass", || async { relay.serves(&browser.id()) }).await;
    until("and let go once it runs out", || async { !relay.serves(&browser.id()) }).await;
    assert_eq!(relay.passed(&browser.id()), None);
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(!relay.serves(&browser.id()), "nor let back in");
    for n in [server, browser] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_device_with_no_udp_gets_onto_its_relay_soon_after_the_relay_first_answers() {
    // a relay on a port that answers nothing yet, as one a browser's first HTTPS request doesn't reach in time: the
    // device's first report of its relays picks none, and iroh's next comes only 20 to 26 seconds on
    let free = std::net::TcpListener::bind(LOOPBACK).expect("a free port");
    let bind = free.local_addr().expect("its address");
    drop(free);
    let url: RelayUrl = format!("http://{bind}").parse().expect("the relay's URL");
    let admission = Admission::open();
    let mut w = world();
    let eve_key = w.lab.passkey("Eve");
    let eves = w.lab.device_of(eve_key, "Eve's browser");
    let pass = w.lab.relay_pass(eves, eve_key, unix_now()).expect("a pass");
    let browser = node(&mut w, eves, &[eve_key], 8, with_pass(&url, pass)).await;
    let started = Instant::now();
    let late = async {
        tokio::time::sleep(Duration::from_secs(1)).await;
        Relay::spawn(bind, admission.clone()).await.expect("the relay, a second late")
    };
    let (on, relay) = tokio::join!(browser.on_relay(), late);
    let took = started.elapsed();
    assert!(on, "the browser gets onto its relay");
    assert!(relay.serves(&browser.id()), "which serves it");
    // it has iroh pick its relay again every two seconds while it has none: on it within a few seconds of the first
    assert!(took < Duration::from_secs(12), "on its relay {took:?} after it started, not 20 to 26 seconds on");
    browser.shutdown().await.expect("the node shuts down");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_persons_first_browser_founds_their_vault_through_a_relay_open_to_sign_up() {
    let admission = Admission::open();
    let relay = Relay::spawn(LOOPBACK, admission.clone()).await.expect("a relay");
    let url = relay.url();
    let mut w = world();
    // Eve is new: her passkey roots no vault anywhere yet, and her first device is a browser
    let eve_key = w.lab.passkey("Eve");
    let eves = w.lab.device_of(eve_key, "Eve's browser");
    let (server_d, avenceo) = (w.server, w.avenceo);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), card: true, ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let pass = w.lab.relay_pass(eves, eve_key, unix_now()).expect("a pass");
    let browser = node(&mut w, eves, &[eve_key], 8, with_pass(&url, pass)).await;
    browser.know(server.addr());
    until("the relay, open to sign-up, lets Eve's browser in by her pass", || async { relay.serves(&browser.id()) })
        .await;
    // in its ten minutes, the browser founds her vault, takes the server's card and gives it relay on all of it
    let eve = browser.act(move |lab, me| human_on(lab, eve_key, &[me])).await;
    assert!(browser.contact(server.id()).await.expect("the server's card") > 0);
    let relay_on =
        move |lab: &mut Lab, me| lab.issue(me, &[me], share(eve, vault(avenceo), Level::Backup, Selector::All));
    let relayed = browser.act(relay_on).await.expect("Eve's vault, relayed by the server");
    until("the server learns Eve's browser from what it relays", || async { admission.admits(&browser.id()) }).await;
    let holds = move |lab: &Lab, me| lab.state(me).vault(eve).is_some() && lab.state(me).share(relayed).is_some();
    until("and keeps her vault's log", || server.read(holds)).await;
    quiet(&[&server, &browser]).await;
    for n in [server, browser] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn an_unclaimed_server_lets_in_the_browser_that_claims_it_and_then_no_strangers() {
    let dir = Folder::new("claim");
    let (data, relay_url, public_addr) = (dir.path().to_path_buf(), None, None);
    let (signup, gate, bucket, cache) = (false, false, None, 0);
    let (bind, relay_bind, feed_bind) = (LOOPBACK, LOOPBACK, LOOPBACK);
    let snapshots = None;
    let config =
        Config { data, bind, relay_bind, feed_bind, relay_url, public_addr, signup, gate, bucket, cache, snapshots };
    let started = avendb_server::start(&config).await.expect("the server and its relay");
    let (server, relay) = (&started.node, &started.relay);
    let url = relay.url();
    let mut w = world();
    // Eve comes first: her passkey roots no vault anywhere yet, and her first device is a browser, with no UDP
    let eve_key = w.lab.passkey("Eve");
    let eves = w.lab.device_of(eve_key, "Eve's browser");
    let stranger_key = w.lab.passkey("a stranger");
    assert!(relay.admission().honours(&stranger_key), "unclaimed, with sign-up closed, it honours any passkey's pass");
    let pass = w.lab.relay_pass(eves, eve_key, unix_now()).expect("a pass");
    let browser = node(&mut w, eves, &[eve_key], 8, with_pass(&url, pass)).await;
    // her browser founds her vault through the server, and in the same ceremony claims it
    let (eve, avenceo) = browser.found(&started.offer, eve_key).await.expect("Eve's vault, which claims the server");
    assert_eq!(server::vault(server).await, Some(avenceo), "the server is avenMAIA's device");
    assert!(relay.serves(&browser.id()), "through the relay");
    let seeded = browser.read(move |lab, me| avendb::world::seeded(lab.state(me), eve, avenceo)).await;
    assert!(seeded, "avenMAIA of Eve's seed, owned through Maia City");
    until("claimed, its relay honours no stranger's pass", || async { !relay.admission().honours(&stranger_key) })
        .await;
    assert!(relay.admission().honours(&eve_key), "but Eve's, whose vault owns avenMAIA");
    until("and lets her browser in for good", || async { relay.admission().admits(&browser.id()) }).await;
    quiet(&[server, &browser]).await;
    browser.shutdown().await.expect("the browser stops");
    started.shutdown().await.expect("the server stops");
}
