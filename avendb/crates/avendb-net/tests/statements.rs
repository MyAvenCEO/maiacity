//! Signed holdings (H2): each device signs what it tells a peer it holds, with when it checked, and a node keeps the
//! newest statement each device it knows signed, whoever brought it, and passes it on to a peer that may know all of
//! it. Synced to lists a device on a live connection by what it announced, and any other by its statement, with when
//! it checked: a device's word outlives its connection, and the node's restart, on its shelf. A statement that proves
//! no device, or another than the one it names, or the node's own, or a stranger's, or one checked far ahead, counts
//! for nothing. Some peers are by hand, their keys in the Lab.

mod common;

use std::future::Future;
use std::path::Path;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use avendb::cast::*;
use avendb::id::{EntryId, SignerId};
use avendb::lab::Lab;
use avendb::sync::LogId;
use avendb::wire::{Statement, Wire};
use avendb_net::shelf::FLOOR;
use avendb_net::{ALPN, Holder, Node, Options, disk, exporter, pq_provider};
use common::Folder;
use iroh::endpoint::{Connection, presets};
use iroh::{Endpoint, SecretKey};

/// An announcement, as a node sends it (`session::ANNOUNCE`).
const ANNOUNCE: u8 = 1;
/// A signed statement of holdings (`session::STATE`).
const STATE: u8 = 8;

/// A node for device `d`, split off `w`'s Lab with the keys of `with`, its randomness drawn from `seed`, on the shelf
/// in folder `dir` if given.
async fn node(w: &mut World, d: SignerId, with: &[SignerId], seed: u8, dir: Option<&Path>) -> Node {
    let shelf = dir.map(|dir| disk::open(dir).expect("the shelf"));
    let opts = Options { shelf, ..Options::local() };
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

/// The time now: seconds since 1970.
fn unix_now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).expect("after 1970").as_secs()
}

/// How Synced to on `n` lists `device` for entry `e`, if it does.
async fn listed(n: &Node, e: EntryId, device: SignerId) -> Option<Holder> {
    n.synced_to().await.entries.get(&e)?.iter().find(|h| h.device == device).copied()
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

/// Hands `statement` to the node on `conn`, as a node does: whether it took it, keeping it or finding it older than the
/// one it keeps, or refused it.
async fn state(conn: &Connection, statement: &Statement) -> bool {
    let (mut send, mut recv) = conn.open_bi().await.expect("a stream");
    send.write_all(&[&[STATE][..], &statement.to_wire()].concat()).await.expect("the statement goes out");
    send.finish().expect("and ends");
    recv.read_to_end(1 << 10).await.is_ok()
}

/// The next statement the node sends on `conn`, past its announcements, each answered by nothing as a node does.
async fn stated(conn: &Connection) -> Statement {
    loop {
        let (mut send, mut recv) = conn.accept_bi().await.expect("a message from the node");
        let message = recv.read_to_end(16 << 20).await.expect("its bytes");
        let (&k, body) = message.split_first().expect("a kind");
        if k == 13 {
            send.reset(iroh::endpoint::VarInt::from_u32(1)).expect("legacy peer refuses sparse holdings");
            continue;
        }
        send.finish().expect("nothing back");
        if k == ANNOUNCE {
            continue;
        }
        assert_eq!(k, STATE, "a statement");
        return Statement::from_wire(body).expect("a statement");
    }
}

/// Alice's phone writes Welcome and reaches the server alone, as her Mac does. The server keeps the phone's statement
/// and passes it on to the Mac, which never met the phone, and whose Synced to lists the phone with all of Welcome and
/// when it checked; the server lists it with no time while the phone is connected, and with its time once it left.
/// The server keeps the statement on its shelf: started again, with nobody connected, it still lists the phone so.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_statement_outlives_its_devices_connection_and_the_nodes_restart() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, phone_a, passkey_a, server_d) = (w.mac_a, w.phone_a, w.passkey_a, w.server);
    let dir = Folder::new("statements");
    let server = node(&mut w, server_d, &[], 1, Some(dir.path())).await;
    let mac = node(&mut w, mac_a, &[passkey_a], 2, None).await;
    let phone = node(&mut w, phone_a, &[passkey_a], 3, None).await;
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = phone.act(write).await.expect("Alice's phone writes Welcome");
    for n in [&mac, &phone] {
        n.know(server.addr());
        server.know(n.addr());
    }
    let reads = || mac.read(move |lab, me| text(lab, me, welcome, 2).as_deref() == Some(WELCOME_TEXT));
    until("Alice's Mac reads Welcome through the server", reads).await;
    let by_statement = |h: Option<Holder>| h.is_some_and(|h| h.all() && h.checked.is_some());
    until("the Mac lists the phone by its statement", || async { by_statement(listed(&mac, welcome, phone_a).await) })
        .await;
    assert_eq!(mac.proven(phone.id()), None, "the Mac and the phone never met: the server passed it on");
    let checked = listed(&mac, welcome, phone_a).await.and_then(|h| h.checked).expect("when the phone checked");
    assert!(checked <= unix_now() && unix_now() - checked < 120, "lately, by the phone's clock: {checked}");
    let statement = mac.statement_of(phone_a).expect("the phone's statement");
    assert_eq!(statement.verify(), Some(phone_a), "which proves the phone");
    let frontier = phone.holdings().await.logs[&LogId::Entry(welcome)].clone();
    assert!(statement.logs.contains(&(LogId::Entry(welcome), frontier)), "and states Welcome as the phone holds it");
    let live = listed(&server, welcome, phone_a).await.expect("the server lists the phone");
    assert_eq!((live.all(), live.checked), (true, None), "by what it announces, while it is connected");
    // the phone leaves: the server lists it by its statement from now on
    phone.shutdown().await.expect("the phone shuts down");
    until("the server lists the phone by its statement", || async {
        by_statement(listed(&server, welcome, phone_a).await)
    })
    .await;
    let checked = server.statement_of(phone_a).expect("the phone's statement").checked;
    let shelved = dir.path().join(format!("g{FLOOR}/stated/{}", phone_a.to_hex()));
    until("the server's shelf keeps it", || async { std::fs::read_dir(&shelved).is_ok_and(|mut d| d.next().is_some()) })
        .await;
    // the server starts again, with nobody connected: its shelf still says where Welcome is, and since when
    mac.shutdown().await.expect("the Mac shuts down");
    server.shutdown().await.expect("the server shuts down");
    // from a world of its own, which never saw Welcome: what it holds, and what it says of the phone, come off its
    // shelf
    let mut again = world();
    handbook_ready(&mut again);
    let server = node(&mut again, server_d, &[], 4, Some(dir.path())).await;
    until("the server lists the phone by its statement again", || async {
        by_statement(listed(&server, welcome, phone_a).await)
    })
    .await;
    let again = server.statement_of(phone_a).expect("the phone's statement, off the shelf");
    assert_eq!(again.verify(), Some(phone_a), "which proves the phone still");
    assert!(again.checked <= checked, "the newest the shelf kept: {} of {checked}", again.checked);
    server.shutdown().await.expect("the server shuts down");
}

/// Bob's Mac, by hand, meets Alice's Mac, which states what it holds, signed, with when it checked. Alice's Mac keeps
/// Bob's Mac's own statement, and Alice's phone's that Bob's Mac passes on, as it proves the phone whoever brings it,
/// and lists the phone in Synced to with when it checked; an older statement changes nothing. It refuses a statement
/// signed by another device than the one it names, one checked a week ahead, a stranger's, and its own.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_statement_counts_only_as_the_word_of_the_device_that_signed_it() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_b, phone_a, stranger) = (w.mac_a, w.passkey_a, w.mac_b, w.phone_a, w.stranger);
    let mac = node(&mut w, mac_a, &[passkey_a], 1, None).await;
    let write = move |lab: &mut Lab, me| lab.create(me, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, me));
    let welcome = mac.act(write).await.expect("Alice's Mac writes Welcome");
    let log = LogId::Entry(welcome);
    let raw = by_hand(&w.lab, mac_b).await;
    let conn = hello(&w.lab, mac_b, &raw, &mac).await;
    let first = stated(&conn).await;
    assert_eq!(first.verify(), Some(mac_a), "Alice's Mac states its holdings, signed");
    assert!(first.checked <= unix_now() && unix_now() - first.checked < 120, "with when it checked");
    let frontier = mac.holdings().await.logs[&log].clone();
    assert!(first.logs.contains(&(log, frontier.clone())), "Welcome among them, as it holds it");
    let now = unix_now();
    let says = |lab: &Lab, d: SignerId, checked: u64, logs| lab.statement(d, checked, logs, vec![]).expect("signed");
    // Bob's Mac's own statement, and an older one after it
    let bobs = says(&w.lab, mac_b, now, vec![]);
    assert!(state(&conn, &bobs).await, "Alice's Mac takes Bob's Mac's statement");
    assert_eq!(mac.statement_of(mac_b), Some(bobs.clone()), "and keeps it");
    assert!(state(&conn, &says(&w.lab, mac_b, now - 60, vec![])).await, "an older one it takes");
    assert_eq!(mac.statement_of(mac_b), Some(bobs.clone()), "and changes nothing");
    // the phone's statement, as Bob's Mac would sign it, proves nothing
    let phones = says(&w.lab, phone_a, now, vec![(log, frontier.clone())]);
    let forged = Statement { sig: says(&w.lab, mac_b, now, vec![(log, frontier.clone())]).sig, ..phones.clone() };
    assert!(!state(&conn, &forged).await, "the phone's word, signed by Bob's Mac, is refused");
    assert_eq!(mac.statement_of(phone_a), None, "and kept nowhere");
    // the phone's own, passed on by Bob's Mac: it proves the phone whoever brings it
    assert!(state(&conn, &phones).await, "the phone's own statement Alice's Mac takes, from Bob's Mac");
    assert_eq!(mac.statement_of(phone_a), Some(phones), "as the phone's word");
    let phone = listed(&mac, welcome, phone_a).await.expect("Synced to lists the phone");
    assert_eq!((phone.all(), phone.checked), (true, Some(now)), "with all of Welcome and when it checked");
    // a week ahead, a stranger's, and its own: refused
    assert!(!state(&conn, &says(&w.lab, mac_b, now + 7 * 24 * 3600, vec![])).await, "a week ahead is refused");
    assert_eq!(mac.statement_of(mac_b), Some(bobs), "and the one it keeps stays");
    assert!(!state(&conn, &says(&w.lab, stranger, now, vec![])).await, "a stranger's is refused");
    assert_eq!(mac.statement_of(stranger), None);
    assert!(!state(&conn, &first).await, "its own is refused");
    assert_eq!(mac.statement_of(mac_a), None);
    mac.shutdown().await.expect("the node shuts down");
}
