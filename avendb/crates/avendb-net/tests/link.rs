//! Linking a device by QR code (P8c), over iroh. A new device scans the code Alice's Mac shows (`Node::offer`), its
//! passkey's hello proves the passkey on their connection, it gets the logs of the vaults the passkey owns, adds itself
//! to Alice's vault and syncs the rest. With every other device of Alice's lost, the same through the server, whose
//! offer the app knows. And what a node refuses: a passkey's hello said on another connection, for the other end or
//! for another device, and a join of another device than the one on the connection.

mod common;

use std::future::Future;
use std::time::{Duration, Instant};

use std::sync::Mutex;

use avendb::cast::*;
use avendb::id::SignerId;
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::sign::{Ceremony, Passkey, device_salt};
use avendb::wire::{Reply, Wire};
use avendb_net::{ALPN, Authenticator, Node, Offer, Options, Step, exporter, pq_provider};
use iroh::endpoint::{Connection, presets};
use iroh::{Endpoint, SecretKey};

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

/// Whether the node's device reads `body` in block 2 of entry `e` of space `sp`.
async fn reads(n: &Node, sp: avendb::id::SpaceId, e: avendb::id::EntryId, body: &'static str) -> bool {
    n.read(move |lab, me| text(lab, me, sp, e, 2).as_deref() == Some(body)).await
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_iphone_links_by_scanning_the_code_alices_mac_shows() {
    let mut w = world();
    let h = handbook(&mut w);
    let new = w.lab.device_of(w.passkey_a, "Alice's new iPhone");
    let (mac_a, passkey_a, alice) = (w.mac_a, w.passkey_a, w.alice);
    let mac = node(&mut w, mac_a, &[], 1).await;
    let phone = node(&mut w, new, &[passkey_a], 7).await;
    // the Mac shows its offer as a QR code, in the code's compact alphanumeric mode, and the new iPhone scans it
    let code = mac.offer().to_text();
    assert!(code.starts_with("AVENDB1"), "{code}");
    assert!(code.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()), "{code}");
    let scanned = Offer::from_text(&code).expect("the code reads back");
    assert_eq!(scanned, mac.offer());
    assert_eq!(phone.link(&scanned, passkey_a).await.expect("the new iPhone links"), alice, "to Alice's vault");
    let knows = move |lab: &Lab, me| lab.state(me).vault(alice).is_some_and(|v| v.devices.contains(&new));
    assert!(mac.read(knows).await, "and the Mac counts it among Alice's devices");
    let (coop, space, welcome) = (h.coop, h.space, h.welcome);
    until("the new iPhone reads Welcome", || reads(&phone, space, welcome, WELCOME_TEXT)).await;
    let edit = move |lab: &mut Lab, me| lab.edit(me, coop, space, welcome, |i| i.set_text(2, AFTER_TEXT));
    phone.act(edit).await.expect("the new iPhone edits Welcome");
    until("the Mac reads its edit", || reads(&mac, space, welcome, AFTER_TEXT)).await;
    quiet(&[&mac, &phone]).await;
    for n in [mac, phone] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// A browser's authenticator, as a test makes it (P8e): Alice's passkey, synced by her platform, outside the device's
/// Lab, making each ceremony it is asked for, and noting what for.
struct Browser(Mutex<(Passkey, Vec<Step>)>);

impl Authenticator for Browser {
    async fn ceremony(&self, challenge: [u8; 32], step: Step) -> anyhow::Result<Ceremony> {
        let mut browser = self.0.lock().expect("the authenticator");
        browser.1.push(step);
        Ok(browser.0.ceremony(challenge))
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_browser_links_with_the_passkey_in_its_authenticator_in_two_ceremonies() {
    let mut w = world();
    let h = handbook(&mut w);
    let secret = w.lab.passkey_secret(w.passkey_a).expect("Alice's software passkey");
    let mut passkey = Passkey::from_seed(*secret);
    // the browser's Lab holds the passkey's keys, from the ceremony that unlocked the browser, and no secret of it
    let (mut lab, nonce) = (Lab::with_entropy([7; 32]), [5; 32]);
    let unlock = passkey.ceremony([1; 32]);
    let alices = lab.web_passkey("Alice", passkey.public(), &unlock).expect("Alice's passkey");
    let new = lab.web_device(alices, "Alice's browser", nonce, *passkey.prf(&device_salt(&nonce)));
    let (mac_a, alice) = (w.mac_a, w.alice);
    let mac = node(&mut w, mac_a, &[], 1).await;
    let browser = Node::spawn(lab, new, Options::local()).await.expect("the browser's node");
    let mut changes = browser.changes();
    let offer = Offer::from_text(&mac.offer().to_text()).expect("the Mac's code");
    // Eve's passkey in the authenticator: its hello isn't Alice's passkey's, and the link fails
    let eves = Browser(Mutex::new((Passkey::from_seed([9; 32]), vec![])));
    assert!(browser.link_with(&offer, alices, &eves).await.is_err(), "another passkey's ceremony");
    let authenticator = Browser(Mutex::new((passkey, vec![])));
    let linked = browser.link_with(&offer, alices, &authenticator).await.expect("the browser links");
    assert_eq!(linked, alice, "to Alice's vault");
    let steps = authenticator.0.lock().expect("the authenticator").1.clone();
    assert_eq!(steps, [Step::Hello, Step::Join], "in two ceremonies: the passkey's hello, then the edit adding it");
    let (space, welcome) = (h.space, h.welcome);
    until("the browser reads Welcome", || reads(&browser, space, welcome, WELCOME_TEXT)).await;
    assert!(changes.has_changed().expect("the node runs"), "what the browser holds changed");
    let (edits, _) = *changes.borrow_and_update();
    assert_eq!(edits, browser.read(|lab, me| lab.size(me).0).await, "it says how many edits it holds");
    quiet(&[&mac, &browser]).await;
    for n in [mac, browser] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn alice_gets_her_vault_back_through_the_server_with_her_passkey_alone() {
    let mut w = world();
    let h = handbook(&mut w);
    // Alice loses her Mac and her iPhone; her passkey, synced by her platform, is on her new Mac
    w.lab.lose(w.mac_a);
    w.lab.lose(w.phone_a);
    let new = w.lab.device_of(w.passkey_a, "Alice's new Mac");
    let (passkey_a, server_d, alice) = (w.passkey_a, w.server, w.alice);
    let server = node(&mut w, server_d, &[], 2).await;
    let mac = node(&mut w, new, &[passkey_a], 7).await;
    // the app knows the server's offer
    let offer = Offer::from_text(&server.offer().to_text()).expect("the server's offer");
    assert_eq!(mac.link(&offer, passkey_a).await.expect("the new Mac links through the server"), alice);
    let (space, welcome, onboarding, notes) = (h.space, h.welcome, h.onboarding, h.notes);
    until("the new Mac reads Welcome", || reads(&mac, space, welcome, WELCOME_TEXT)).await;
    until("and Onboarding", || reads(&mac, space, onboarding, ONBOARDING_TEXT)).await;
    assert!(mac.read(move |lab, me| lab.opens(me, KeyScope::Space(notes))).await, "and opens Alice's Notes");
    let keys = [KeyScope::Vault(alice), KeyScope::Vault(h.coop), KeyScope::Space(space), KeyScope::Space(notes)];
    let opens = move |lab: &Lab, me| keys.iter().any(|&k| lab.opens(me, k));
    assert!(!server.read(opens).await, "the server, which handed over the vault's log, opens none of its keys");
    quiet(&[&mac, &server]).await;
    for n in [mac, server] {
        n.shutdown().await.expect("the node shuts down");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_link_fails_unless_the_offered_device_answers_and_the_passkey_roots_a_vault() {
    let mut w = world();
    let eve_key = w.lab.passkey("Eve");
    let eves = w.lab.device_of(eve_key, "Eve's phone");
    let new = w.lab.device_of(w.passkey_a, "Alice's new iPhone");
    let (mac_a, mac_b, passkey_a, passkey_b) = (w.mac_a, w.mac_b, w.passkey_a, w.passkey_b);
    let mac = node(&mut w, mac_a, &[], 1).await;
    let bob = node(&mut w, mac_b, &[passkey_b], 3).await;
    let phone = node(&mut w, new, &[passkey_a], 7).await;
    let eve = node(&mut w, eves, &[eve_key], 8).await;
    // a code naming Alice's Mac at Bob's Mac's endpoint: the hello there proves another device
    let forged = Offer { device: mac_a, addr: bob.addr() };
    assert!(phone.link(&forged, passkey_a).await.is_err(), "a code whose device isn't the one answering");
    // Eve's passkey owns no vault Alice's Mac knows: an empty card, and nothing to join
    assert!(eve.link(&mac.offer(), eve_key).await.is_err(), "a passkey rooting no vault there");
    let joined = mac.read(move |lab, me| lab.state(me).vaults().iter().any(|v| v.devices.contains(&eves))).await;
    assert!(!joined, "Eve's phone is in no vault of the Mac's");
    for n in [mac, bob, phone, eve] {
        n.shutdown().await.expect("the node shuts down");
    }
}

/// An endpoint by hand, of the ed25519 key `secret`, with avenDB's TLS.
async fn client(secret: [u8; 32]) -> Endpoint {
    let builder = Endpoint::builder(presets::Empty).secret_key(SecretKey::from_bytes(&secret));
    let builder = builder.crypto_provider(pq_provider());
    builder.clear_ip_transports().bind_addr("127.0.0.1:0").expect("loopback").bind().await.expect("an endpoint")
}

/// Sends a message of `kind` on a stream of its own, by hand: the answer, or `None` if the node reset the stream.
async fn say(conn: &Connection, kind: u8, body: &[u8]) -> Option<Vec<u8>> {
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    send.write_all(&[kind]).await.expect("its kind goes out");
    send.write_all(body).await.expect("and its body");
    send.finish().expect("and ends");
    recv.read_to_end(256 << 20).await.ok()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_node_hands_its_card_for_a_passkeys_hello_on_that_very_connection_alone() {
    let mut w = world();
    let new = w.lab.device_of(w.passkey_a, "Alice's new iPhone");
    let other = w.lab.device_of(w.passkey_a, "Alice's iPad");
    let (mac_a, mac_b, passkey_a, alice) = (w.mac_a, w.mac_b, w.passkey_a, w.alice);
    let mac = node(&mut w, mac_a, &[], 1).await;
    // the new iPhone by hand: its keys and the passkey stay in the Lab
    let raw = client(*w.lab.endpoint_secret(new).expect("its key")).await;
    let conn = raw.connect(mac.addr(), ALPN).await.expect("it connects");
    let exporter = exporter(&conn).expect("an exporter");
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    send.write_all(&w.lab.hello(new, &exporter, true).expect("its hello").to_wire()).await.expect("its hello");
    send.finish().expect("ends");
    recv.read_to_end(64 << 10).await.expect("the Mac's hello back");
    let (link, join) = (3, 4);
    let lab = &mut w.lab;
    let refused = [
        ("said on another connection", lab.passkey_hello(new, passkey_a, &[7; 32], true)),
        ("said for the listening end", lab.passkey_hello(new, passkey_a, &exporter, false)),
        ("said for another device", lab.passkey_hello(mac_b, passkey_a, &exporter, true)),
    ];
    for (what, hello) in refused {
        let hello = hello.expect("the passkey's hello").to_wire();
        assert!(say(&conn, link, &hello).await.is_none(), "a passkey's hello {what}: refused");
    }
    let device = lab.hello(new, &exporter, true).expect("its hello").to_wire();
    assert!(say(&conn, link, &device).await.is_none(), "a device's hello is no passkey's");
    let hello = lab.passkey_hello(new, passkey_a, &exporter, true).expect("the passkey's hello").to_wire();
    let card = Reply::from_wire(&say(&conn, link, &hello).await.expect("its card")).expect("a reply");
    assert!(!card.edits.is_empty(), "the passkey's own hello on this connection gets its card");
    assert!(card.edits.iter().all(|s| s.edit.vault_of() == Some(alice)), "the log of Alice's vault alone");
    // the iPad's join, sent on the new iPhone's connection: refused; the new iPhone's own: accepted
    lab.receive(other, card.edits.clone(), vec![]);
    let theirs = lab.join(other, passkey_a).expect("the iPad's join").to_wire();
    assert!(say(&conn, join, &theirs).await.is_none(), "a join of another device than the one on the connection");
    lab.receive(new, card.edits, vec![]);
    let own = lab.join(new, passkey_a).expect("its join").to_wire();
    assert_eq!(say(&conn, join, &own).await, Some(vec![]), "its own join is accepted");
    let knows = move |lab: &Lab, me| lab.state(me).vault(alice).is_some_and(|v| v.devices.contains(&new));
    assert!(mac.read(knows).await, "and the Mac counts it among Alice's devices");
    let ipad = move |lab: &Lab, me| lab.state(me).vault(alice).is_some_and(|v| v.devices.contains(&other));
    assert!(!mac.read(ipad).await, "not the iPad");
    mac.shutdown().await.expect("the node shuts down");
}
