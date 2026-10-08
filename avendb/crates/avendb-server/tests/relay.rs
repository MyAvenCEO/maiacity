//! The server's relay (P8b): devices with no UDP of their own sync through it alone, as a device behind a strict
//! firewall would; it lets in only the devices the server knows, those of the vaults acting in the spaces it relays,
//! and lets go of a device taken out of its vault; and a new server, started as its binary starts it, learns its
//! devices from what it relays. From P8c, a new device that linked through the server is let in too.

#[path = "../../avendb-net/tests/common/mod.rs"]
mod common;

use std::collections::HashMap;
use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{SignerId, SpaceId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::policy::{Action, Refusal, Role, Scope};
use avendb_net::{Admission, Node, Offer, Options, server};
use avendb_server::{Config, Relay};
use common::Folder;
use iroh::{EndpointId, RelayUrl, SecretKey};

/// A socket of the system's choosing on this machine.
const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);

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
    let (coop, space, _) = handbook_spaces(&mut w);
    let (mac_s, passkey_s, server_d, mac_b, passkey_b) = (w.mac_s, w.passkey_s, w.server, w.mac_b, w.passkey_b);
    let stranger_d = w.stranger;
    let opts = Options { relay: Some(url.clone()), admission: Some(admission), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_s, &[passkey_s], 1, relay_only(&url)).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3, relay_only(&url)).await;
    let stranger = node(&mut w, stranger_d, &[], 5, relay_only(&url)).await;
    for n in [&mac, &bob, &stranger] {
        assert!(n.endpoint().bound_sockets().is_empty(), "a device with no UDP of its own");
        n.know(server.addr());
    }
    let write = move |lab: &mut Lab, me| lab.create(me, coop, space, document_v1("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Samuel's Mac writes Welcome");
    let reads = || bob.read(move |lab, me| text(lab, me, space, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("Bob's Mac reads Welcome, through the relay alone", reads).await;
    let met = || async { bob.proven(mac.id()) == Some(mac_s) };
    until("through the relay, the Macs reach each other by their ids alone", met).await;
    let holds = || server.read(move |lab, me| lab.fetched(me, space, welcome) > 0);
    until("and the server holds Welcome's edits", holds).await;
    let opens = move |lab: &Lab, me| {
        lab.opens(me, KeyScope::Entry(space, welcome)) || lab.opens(me, KeyScope::Space(space))
    };
    assert!(!server.read(opens).await, "the server opens neither Welcome's key nor the Handbook's");
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
async fn a_new_server_lets_in_the_devices_of_the_spaces_it_relays() {
    let dir = Folder::new("relay");
    let data = dir.path().to_path_buf();
    let config = Config { data, bind: LOOPBACK, relay_bind: LOOPBACK, relay_url: None, public_addr: None };
    let started = avendb_server::start(&config).await.expect("the server and its relay");
    let (server, relay) = (&started.node, &started.relay);
    let (url, v) = (relay.url(), server::vault(server).await.expect("its vault"));
    let mut w = world();
    let (coop, _, _) = handbook_spaces(&mut w);
    let (mac_s, passkey_s, mac_b, passkey_b) = (w.mac_s, w.passkey_s, w.mac_b, w.passkey_b);
    let bob_mac = endpoint(&w, mac_b);
    // Samuel's Mac, on UDP, makes its first contact with the server straight: the relay doesn't know it yet
    let opts = Options { relay: Some(url.clone()), ..Options::local() };
    let mac = node(&mut w, mac_s, &[passkey_s], 1, opts).await;
    mac.know(server.addr());
    assert!(!relay.admission().admits(&mac.id()), "the new server knows no device of Samuel's");
    assert!(mac.contact(server.id()).await.expect("the server's card, straight from it") > 0);
    // the coop founds the Garden, gives the new server relay on it, and Samuel writes Welcome there
    let garden = move |lab: &mut Lab, me| {
        let garden = SpaceId::from(lab.submit(me, &[me], Action::FoundSpace { actor: coop, nonce: 11 })?);
        lab.submit(me, &[me], grant(Scope::Space(garden), Role::Relay, vault(v), coop, None))?;
        let welcome = lab.create(me, coop, garden, document("Welcome", WELCOME_TEXT, me))?;
        Ok::<_, Refusal>((garden, welcome))
    };
    let (garden, welcome) = mac.act(garden).await.expect("the Garden, relayed by the new server, and Welcome");
    let holds = || server.read(move |lab, me| lab.fetched(me, garden, welcome) > 0);
    until("the new server holds Welcome's edits", holds).await;
    until("from the Garden's logs it lets Bob's Mac in", || async { relay.admission().admits(&bob_mac) }).await;
    mac.shutdown().await.expect("Samuel's Mac stops");
    // Bob's Mac has no UDP: it takes the server's card through the relay, then the Garden
    let bob = node(&mut w, mac_b, &[passkey_b], 3, relay_only(&url)).await;
    bob.know(server.addr());
    assert!(bob.contact(server.id()).await.expect("the server's card, through the relay") > 0);
    let reads = || bob.read(move |lab, me| text(lab, me, garden, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("Bob's Mac reads Welcome, written while it was away", reads).await;
    assert_eq!(bob.proven(mac.id()), None, "from the server: Bob's Mac never met Samuel's");
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
    handbook_spaces(&mut w);
    let (mac_s, passkey_s, phone_s, server_d, samuel) = (w.mac_s, w.passkey_s, w.phone_s, w.server, w.samuel);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, mac_s, &[passkey_s], 1, relay_only(&url)).await;
    let phone = node(&mut w, phone_s, &[], 6, relay_only(&url)).await;
    for n in [&mac, &phone] {
        n.know(server.addr());
    }
    until("the relay serves Samuel's phone", || async { relay.serves(&phone.id()) }).await;
    let take_out = Action::RemoveDevice { vault: samuel, device: phone_s, keep: vec![] };
    mac.act(move |lab, me| lab.submit(me, &[passkey_s], take_out)).await.expect("Samuel takes his phone out");
    until("the server learns it, and stops admitting the phone", || async { !admission.admits(&phone.id()) }).await;
    until("the relay lets the phone go", || async { !relay.serves(&phone.id()) }).await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(!relay.serves(&phone.id()), "and doesn't let it back in");
    assert!(relay.serves(&mac.id()) && relay.serves(&server.id()), "while it serves Samuel's Mac and the server");
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
    // Samuel loses his Mac and his iPhone; his passkey is on his new Mac
    w.lab.lose(w.mac_s);
    w.lab.lose(w.phone_s);
    let new = w.lab.device_of(w.passkey_s, "Samuel's new Mac");
    let (passkey_s, server_d) = (w.passkey_s, w.server);
    let opts = Options { relay: Some(url.clone()), admission: Some(admission.clone()), ..Options::local() };
    let server = node(&mut w, server_d, &[], 2, opts).await;
    let mac = node(&mut w, new, &[passkey_s], 7, Options { relay: Some(url.clone()), ..Options::local() }).await;
    assert!(!admission.admits(&mac.id()), "the server doesn't know the new Mac");
    // the new Mac, on UDP, makes its first contact straight, by the server's offer
    let offer = Offer::from_text(&server.offer().to_text()).expect("the server's offer");
    mac.link(&offer, passkey_s).await.expect("the new Mac links through the server");
    until("once it joined, the server lets it in", || async { admission.admits(&mac.id()) }).await;
    let (space, welcome) = (h.space, h.welcome);
    let reads = || mac.read(move |lab, me| text(lab, me, space, welcome, 2).as_deref() == Some(WELCOME_TEXT));
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
        relay_url: Some(relay_url.clone()),
        public_addr: Some(public),
    };
    let started = avendb_server::start(&config).await.expect("the server and its relay");
    let offer = Offer::from_text(&started.offer.to_text()).expect("its offer reads back");
    assert_eq!(offer.device, started.node.device(), "its device");
    assert_eq!(offer.addr.id, started.node.id(), "its endpoint");
    assert_eq!(offer.addr.ip_addrs().collect::<Vec<_>>(), [&public], "where devices on UDP reach it, alone");
    assert_eq!(offer.addr.relay_urls().collect::<Vec<_>>(), [&relay_url], "and its relay");
    started.shutdown().await.expect("the server stops");
}

#[test]
fn the_server_is_configured_by_its_environment() {
    let defaults = Config::from_vars(|_| None).expect("the defaults");
    assert_eq!(defaults.data, PathBuf::from("/data"));
    assert_eq!(defaults.bind, "0.0.0.0:7401".parse::<SocketAddr>().expect("a socket"), "iroh's UDP");
    assert_eq!(defaults.relay_bind, "0.0.0.0:3350".parse::<SocketAddr>().expect("a socket"), "the relay's HTTP");
    assert_eq!(defaults.relay_url, None, "the relay's own socket, unless it is said where devices reach it");
    assert_eq!(defaults.public_addr, None, "its own interfaces' addresses, unless it is said where it is reached");
    let vars = HashMap::from([
        ("AVENDB_DATA", "/srv/avendb"),
        ("AVENDB_BIND", "[::]:7402"),
        ("AVENDB_RELAY_BIND", "127.0.0.1:3351"),
        ("AVENDB_RELAY_URL", "https://avendb.maia.city"),
        ("AVENDB_PUBLIC_ADDR", "203.0.113.7:7401"),
    ]);
    let set = Config::from_vars(|k| vars.get(k).map(|v| v.to_string())).expect("what the environment says");
    assert_eq!(set.data, PathBuf::from("/srv/avendb"));
    assert_eq!(set.bind, "[::]:7402".parse::<SocketAddr>().expect("a socket"));
    assert_eq!(set.relay_bind, "127.0.0.1:3351".parse::<SocketAddr>().expect("a socket"));
    assert_eq!(set.relay_url, Some("https://avendb.maia.city".parse().expect("a URL")));
    assert_eq!(set.public_addr, Some("203.0.113.7:7401".parse().expect("a socket")));
    let wrong = Config::from_vars(|k| (k == "AVENDB_BIND").then(|| "the server's port".to_string()));
    assert!(wrong.is_err(), "a socket that isn't one is said so, not taken for the default");
}
