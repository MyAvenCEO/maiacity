//! avenDB's release gate for a new phone's first view (2026-10-27): Alice's new phone, which holds her vault as it
//! was when she added it and nothing since, takes from her Mac, through the server's relay alone (as an iPhone's page,
//! which has no UDP of its own), a vault shaped like Samuel's: many entries shared in audiences of their own, so most
//! of its edits are audiences' keys and their wraps; a coop's channel room, in an audience of its own, and her note to
//! self room; Maia City's manifest; and a long tail of edits to other entries. The phone's Chat view is mounted before
//! it asks for anything, as the page mounts it (maia/content/game/code/sources/device.js): its rooms of every vault on screen now,
//! and Maia City's manifests. The gate: both rooms open, their records read, before the catch-up ends. It prints one
//! `BENCH {...}` line (`kind: "first_view"`) with the time to the first view, how many edits had come by then, and the
//! catch-up's edits a second, as `relay_bench.rs` (claude/s-bench-gates) prints the carriers' and on the same harness:
//! a relay that admits both, both on it before the clock starts, each told the other's id at the relay alone.
//!
//!   cargo test -p avendb-server --features test-fixtures --test first_view_gate -- --nocapture
//!
//! `AVENDB_FIRST_VIEW_SHARED` (entries shared in audiences of their own, 120 if unset) and `AVENDB_FIRST_VIEW_EDITS`
//! (the tail's edits, 1,500 if unset) size it. Synthetic: the scenarios' cast and their fixed keys, no one's data.

use std::collections::HashSet;
use std::net::SocketAddr;
use std::time::{Duration, Instant};

use avendb::cast::*;
use avendb::id::{EditId, EntryId};
use avendb::policy::Level;
use avendb_net::{Admission, Node, Options};
use avendb_server::{Rates, Relay};
use iroh::{EndpointAddr, TransportAddr};
use serde_json::{Value, json};

const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);
/// The tail's entries, in turn.
const TAIL_ENTRIES: u64 = 8;

/// The rooms of every vault the phone reads now, as its Chat view's query asks (`$lib/chat`): the entries of each row.
async fn rooms(n: &Node) -> HashSet<String> {
    let got = n.op(json!({"op": "query", "where": {"type": ["room"]}, "select": ["kind"]})).await.unwrap_or(Value::Null);
    got["ok"]["rows"].as_array().map(|rows| rows.iter().filter_map(|r| r["entry"].as_str().map(str::to_owned)).collect()).unwrap_or_default()
}

/// How many of `want` the device of node `n` doesn't hold yet.
async fn missing(n: &Node, want: &HashSet<EditId>) -> usize {
    let want = want.clone();
    n.read(move |lab, me| {
        let ids: HashSet<&EditId> = lab.log(me).ids().iter().collect();
        want.iter().filter(|id| !ids.contains(id)).count()
    })
    .await
}

fn env(name: &str, or: usize) -> usize {
    std::env::var(name).ok().and_then(|n| n.parse().ok()).unwrap_or(or)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_new_phones_chat_shows_the_coop_channel_and_the_note_to_self_before_its_catch_up_ends() {
    let shared = env("AVENDB_FIRST_VIEW_SHARED", 120);
    let tail = env("AVENDB_FIRST_VIEW_EDITS", 1500);
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, passkey_a, phone_a, alice, bob) = (w.mac_a, w.passkey_a, w.phone_a, w.alice, w.bob);

    // What Alice's Mac writes after her phone last synced: all of it new to the phone.
    let t = Instant::now();
    let held: HashSet<EditId> = w.lab.log(phone_a).ids().iter().copied().collect();
    // the rooms Chat shows first: the coop's channel, shared with Bob in an audience of its own, and her note to self
    let channel = w.lab.create(mac_a, coop, coop, "room", &[], document("Bla", "the coop's channel", mac_a)).expect("the channel");
    w.lab.issue(mac_a, &[mac_a], share(coop, vault(bob), Level::Read, by_id(channel))).expect("the channel shared with Bob");
    let note = w.lab.create(mac_a, alice, alice, "room", &[], document("Note to self", "mine", mac_a)).expect("the note to self");
    // Maia City's manifest of Chat, as a coop's entry of type manifest
    w.lab.create(mac_a, coop, coop, "manifest", &[], document("chat", "rooms now", mac_a)).expect("a manifest");
    // most of a vault like Samuel's: entries each shared in an audience of its own, their keys and wraps
    for i in 0..shared {
        let e = w.lab.create(mac_a, alice, alice, "note", &[], document(&format!("Shared {i}"), "an entry of its own audience", mac_a))
            .expect("an entry");
        w.lab.issue(mac_a, &[mac_a], share(alice, vault(bob), Level::Read, by_id(e))).expect("shared with Bob");
    }
    // and a long tail of edits to other entries
    let mut entries: Vec<EntryId> = vec![];
    for i in 0..TAIL_ENTRIES {
        entries.push(w.lab.create(mac_a, coop, coop, "doc", &[], document(&format!("Tail {i}"), "the tail", mac_a)).expect("an entry"));
    }
    for k in 0..tail {
        let entry = entries[k % entries.len()];
        w.lab.edit(mac_a, coop, entry, |item| item.push_block(paragraph(100 + k as u64, &format!("edit {k} of the tail")))).expect("an edit");
    }
    let write_s = t.elapsed().as_secs_f64();
    let want: HashSet<EditId> = w.lab.log(mac_a).ids().iter().copied().filter(|id| !held.contains(id)).collect();
    let (channel, note) = (channel.to_hex(), note.to_hex());

    // The relay alone, as an iPhone's page reaches its peers.
    let admission = Admission::default();
    let relay = Relay::spawn_with(LOOPBACK, admission.clone(), Rates { relay: 0, ..Rates::default() }).await.expect("a relay");
    let opts = Options { bind: None, relay: Some(relay.url()), ..Options::local() };
    let mac = Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, Options { admission: Some(admission.clone()), ..opts.clone() })
        .await.expect("Alice's Mac");
    let phone = Node::spawn(w.lab.split(phone_a, &[], [5; 32]), phone_a, opts).await.expect("Alice's new phone");
    assert!(mac.endpoint().bound_sockets().is_empty() && phone.endpoint().bound_sockets().is_empty(), "through the relay alone");
    let on = async { tokio::join!(mac.on_relay(), phone.on_relay()) };
    let (a, b) = tokio::time::timeout(Duration::from_secs(60), on).await.expect("on the relay within a minute");
    assert!(a && b && relay.serves(&mac.id()) && relay.serves(&phone.id()), "the relay serves both");
    assert!(admission.admits(&phone.id()), "the relay's admission names the phone");
    let at = |n: &Node| EndpointAddr::from_parts(n.id(), [TransportAddr::Relay(relay.url())]);
    mac.know(at(&phone));
    phone.know(at(&mac));

    // The phone's Chat view, mounted before it asks for anything: the rooms of every vault and Maia City's manifests now.
    let view = json!({"op": "interest", "scope": "c".repeat(32), "revision": 1, "wants": [{"tier": "now", "entries": [],
        "queries": [{"types": ["manifest"], "vault": coop.to_hex()}, {"types": ["capgroup", "schema", "lens"], "vault": coop.to_hex()}, {"types": ["room"]}]}]});
    assert_eq!(phone.op(view).await.expect("the view's interest")["ok"]["accepted"], true);

    let t = Instant::now();
    let catch_up = async {
        let mut asks = 0;
        loop {
            if missing(&phone, &want).await == 0 { break; }
            assert!(t.elapsed() < Duration::from_secs(240), "the phone takes every edit within 4 minutes");
            asks += 1;
            if let Err(e) = phone.sync_with(mac.id()).await { eprintln!("ask {asks}: failed ({e:#})"); }
        }
        (t.elapsed().as_secs_f64(), asks)
    };
    // the first view: both rooms in the view's query, their records read, and how much of the catch-up had come
    let first_view = async {
        loop {
            let seen = rooms(&phone).await;
            if seen.contains(&channel) && seen.contains(&note) {
                return Some((t.elapsed().as_secs_f64(), missing(&phone, &want).await));
            }
            if t.elapsed() > Duration::from_secs(240) { return None; }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    };
    let ((sync_s, asks), first) = tokio::join!(catch_up, first_view);
    let (first_s, left_then) = first.expect("Chat shows the coop's channel and the note to self");
    let line = json!({
        "kind": "first_view",
        "carrier": "relay",
        "edits": want.len(),
        "shared_entries": shared,
        "write_s": (write_s * 1000.0).round() / 1000.0,
        "first_view_s": (first_s * 1000.0).round() / 1000.0,
        "edits_missing_at_first_view": left_then,
        "sync_s": (sync_s * 1000.0).round() / 1000.0,
        "asks": asks,
        "edits_per_s": (want.len() as f64 / sync_s).round(),
    });
    println!("BENCH {line}");
    assert!(left_then > 0, "Chat's rooms open before the catch-up ends ({line})");
    for n in [mac, phone] {
        n.shutdown().await.expect("the node shuts down");
    }
}
