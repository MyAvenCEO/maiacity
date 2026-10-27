//! avenDB's carrier gates (2026-10-27): how fast a device takes a peer's edits over a real node pair, directly over
//! loopback UDP and through the server's relay alone, as a device with no UDP of its own (an iPhone's page, a browser)
//! takes them; and through a relay that reads each client at a set rate, the link's bandwidth, so the edits' bytes a
//! second can be set against it. Each case prints one `BENCH {...}` line (`kind: "carrier"`) for
//! `scripts/ci/avendb-bench.mjs`, which holds the relay's numbers apart from the direct path's. One case a process:
//!
//!   AVENDB_CARRIER=relay AVENDB_CARRIER_EDITS=1000 cargo test -p avendb-server --features test-fixtures \
//!     --test relay_bench -- --ignored --nocapture
//!
//! `AVENDB_CARRIER` is `direct`, `relay`, or `relay_link` (a relay reading `AVENDB_CARRIER_LINK` bytes a second of each
//! client, 1 MB/s if unset). Alice's Mac writes the edits into the coop before either node starts; Bob's Mac then asks
//! it until it holds every one. Only numbers are printed.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::EditId;
use avendb::wire::Wire;
use avendb_net::{Admission, Node, Options};
use avendb_server::{Rates, Relay};
use iroh::{EndpointAddr, TransportAddr};
use serde_json::json;

const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);
/// The entries the edits go to, in turn.
const ENTRIES: u64 = 8;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn bench_carrier() {
    let case = std::env::var("AVENDB_CARRIER").unwrap_or_else(|_| "relay".into());
    let edits: usize = std::env::var("AVENDB_CARRIER_EDITS").ok().and_then(|n| n.parse().ok()).unwrap_or(1000);
    let link: u64 = std::env::var("AVENDB_CARRIER_LINK").ok().and_then(|n| n.parse().ok()).unwrap_or(1_000_000);
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, mac_b, passkey_b) = (w.mac_a, w.passkey_a, w.mac_b, w.passkey_b);

    // Alice's Mac writes the edits; what Bob's Mac may take of them is what it doesn't hold yet
    let t = Instant::now();
    let held: HashSet<EditId> = w.lab.log(mac_a).ids().iter().copied().collect();
    let mut entries = vec![];
    for i in 0..ENTRIES {
        let doc = document(&format!("Bench {i}"), "the carrier bench", mac_a);
        entries.push(w.lab.create(mac_a, coop, coop, "doc", &[], doc).expect("an entry"));
    }
    for k in 0..edits.saturating_sub(ENTRIES as usize) {
        let entry = entries[k % entries.len()];
        let text = format!("edit {k} of the carrier bench");
        w.lab.edit(mac_a, coop, entry, |item| item.push_block(paragraph(100 + k as u64, &text))).expect("an edit");
    }
    let write_s = t.elapsed().as_secs_f64();
    let backup = w.lab.backup(mac_a);
    let fresh: Vec<_> = backup.signed().iter().filter(|s| !held.contains(&s.edit.id())).collect();
    let want: HashSet<EditId> = fresh.iter().map(|s| s.edit.id()).collect();
    let bytes: usize = fresh.iter().map(|s| s.to_wire().len()).sum();

    let (relay, opts) = match case.as_str() {
        "direct" => (None, Options::local()),
        "relay" | "relay_link" => {
            let rates = Rates { relay: if case == "relay" { 0 } else { link }, ..Rates::default() };
            let relay = Relay::spawn_with(LOOPBACK, Admission::open(), rates).await.expect("a relay");
            let opts = Options { bind: None, relay: Some(relay.url()), ..Options::local() };
            (Some(relay), opts)
        }
        other => panic!("AVENDB_CARRIER: {other} is none of direct, relay, relay_link"),
    };
    let mac = Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, opts.clone()).await.expect("Alice's Mac");
    let bob = Node::spawn(w.lab.split(mac_b, &[passkey_b], [3; 32]), mac_b, opts).await.expect("Bob's Mac");
    if relay.is_some() {
        let unbound = mac.endpoint().bound_sockets().is_empty() && bob.endpoint().bound_sockets().is_empty();
        assert!(unbound, "through the relay alone: no UDP of their own");
    }
    // through the relay, each is told the other's id at the relay alone, as a page knows its peers: no address it might
    // have bound, and none it hasn't learnt yet
    match &relay {
        Some(r) => {
            let at = |n: &Node| EndpointAddr::from_parts(n.id(), [TransportAddr::Relay(r.url())]);
            mac.know(at(&bob));
            bob.know(at(&mac));
        }
        None => {
            mac.know(bob.addr());
            bob.know(mac.addr());
        }
    }
    // the first ask opens the connection; it is timed with the rest, as a device that comes back opens it
    let t = Instant::now();
    let mut asks = 0;
    let want_len = want.len();
    loop {
        let want = want.clone();
        let missing = bob.read(move |lab, me| {
            let ids: HashSet<&EditId> = lab.log(me).ids().iter().collect();
            want.iter().filter(|id| !ids.contains(id)).count()
        });
        let missing = missing.await;
        if missing == 0 {
            break;
        }
        assert!(t.elapsed() < Duration::from_secs(300), "Bob's Mac takes every edit within 5 minutes ({missing} missing)");
        asks += 1;
        // what each ask brought, to the log: how many edits, or that it failed (no address, key or body)
        match bob.sync_with(mac.id()).await {
            Ok(n) => eprintln!("ask {asks}: {n} new, {missing} of {want_len} missing before"),
            Err(_) => eprintln!("ask {asks}: failed, {missing} of {want_len} missing"),
        }
    }
    let sync_s = t.elapsed().as_secs_f64();
    let link = (case == "relay_link").then_some(link);
    let line = json!({
        "kind": "carrier",
        "carrier": case,
        "edits": want.len(),
        "wire_bytes": bytes,
        "bytes_per_edit": bytes / want.len().max(1),
        "write_s": (write_s * 1000.0).round() / 1000.0,
        "sync_s": (sync_s * 1000.0).round() / 1000.0,
        "asks": asks,
        "edits_per_s": (want.len() as f64 / sync_s).round(),
        "bytes_per_s": (bytes as f64 / sync_s).round(),
        "link_bytes_per_s": link,
        "link_share": link.map(|l| ((bytes as f64 / sync_s / l as f64) * 1000.0).round() / 1000.0),
    });
    println!("BENCH {line}");
    for n in [mac, bob] {
        n.shutdown().await.expect("the node shuts down");
    }
}
