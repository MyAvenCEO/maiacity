//! What one local read costs a device the size of Alice's iPhone (Goal 7, 2026-10-28: on the iPhone `query` took
//! 72.8 s at p95, `entry_views` 115.5 s, its edits spilled at 107,000): her writers' documents, every one boxed to each
//! of her devices, on a shelf in a folder, the node started again from it with its edits spilled as `avendb-device`
//! spills them, then each read a page asks for run on its own, nothing else waiting for the Lab, so that what it
//! takes is the read's own cost, not a wait for another turn. A `LOCAL_READS {...}` line per run, each read's fastest,
//! median and slowest of `LOCAL_READS_RUNS`, settled and in the middle of a catch-up.
//!
//!   LOCAL_READS_EDITS=100000 cargo test --release -p avendb-net --test all local_reads:: -- --ignored --nocapture
#![cfg(not(debug_assertions))]

use crate::common;

use std::time::{Duration, Instant};

use avendb::cast::{document, paragraph};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{Lab, Spill};
use avendb::policy::{Action, Kind, Principal, Sharing};
use avendb_net::{Node, Options, disk};
use avendb_testkit::until;
use common::Folder;
use serde_json::{Value, json};

fn env(name: &str, default: usize) -> usize {
    std::env::var(name).ok().and_then(|n| n.parse().ok()).unwrap_or(default)
}

/// Alice's vault, her Mac, her iPhone and `writers` devices of hers, made the same way each time: the same keys.
fn base(writers: usize) -> (Lab, SignerId, SignerId, VaultId, Vec<SignerId>) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let ws: Vec<SignerId> = (0..writers).map(|i| lab.device_of(passkey, &format!("Alice's writer {i}"))).collect();
    let genesis = Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(passkey)],
        threshold: 1,
        root: Some(passkey),
        nonce: 0,
        seal_to: vec![],
    };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    for &d in [mac, phone].iter().chain(&ws) {
        let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
        lab.submit(mac, &[passkey, d], add).expect("a device added");
    }
    for &d in [phone].iter().chain(&ws) {
        lab.sync(mac, d);
    }
    (lab, passkey, phone, alice, ws)
}

/// `base`, each writer having written `edits / writers` edits over `entries` documents of Alice's vault, all of which
/// the iPhone took.
fn written(writers: usize, entries: usize, edits: usize) -> (Lab, SignerId, SignerId, VaultId) {
    let (mut lab, passkey, phone, alice, ws) = base(writers);
    let per = edits / writers.max(1);
    for (i, &w) in ws.iter().enumerate() {
        let docs: Vec<EntryId> = (0..entries)
            .map(|e| {
                let doc = document(&format!("Doc {i}.{e}"), "Written by one of Alice's devices.", w);
                lab.create(w, alice, alice, "doc", &[], doc).expect("a document")
            })
            .collect();
        for k in 0..per.saturating_sub(docs.len()) {
            let entry = docs[k % docs.len()];
            let text = format!("Edit {k} of writer {i}.");
            lab.edit(w, alice, entry, |item| item.push_block(paragraph(100 + k as u64, &text))).expect("an edit");
        }
        lab.sync(w, phone);
    }
    (lab, passkey, phone, alice)
}

/// Each of `reads` run `runs` times on `node`, one after another: its fastest, median and slowest, in ms.
async fn timed(node: &Node, reads: &[(&str, Value)], runs: usize) -> Value {
    let mut out = serde_json::Map::new();
    for (name, op) in reads {
        let mut took: Vec<Duration> = Vec::with_capacity(runs);
        for _ in 0..runs {
            let at = Instant::now();
            let answer = node.op(op.clone()).await.expect("an answer");
            took.push(at.elapsed());
            assert!(answer.get("ok").is_some(), "{name} answers: {answer}");
        }
        took.sort();
        let ms = |d: Duration| (d.as_secs_f64() * 1e4).round() / 10.0;
        out.insert((*name).into(), json!({ "min": ms(took[0]), "median": ms(took[runs / 2]), "max": ms(took[runs - 1]) }));
    }
    Value::Object(out)
}

#[test]
#[ignore]
fn measure_local_reads() {
    let (writers, entries, edits) = (env("LOCAL_READS_WRITERS", 32), env("LOCAL_READS_ENTRIES", 72), env("LOCAL_READS_EDITS", 20_000));
    let runs = env("LOCAL_READS_RUNS", 5).max(1);
    let dir = Folder::new("local-reads");
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build().expect("a runtime");
    let began = Instant::now();
    let held_edits = rt.block_on(async {
        let (mut lab, passkey, phone, _) = written(writers, entries, edits);
        let lab = lab.split(phone, &[passkey], [1; 32]);
        let opts = Options { shelf: Some(disk::open(dir.path()).expect("the shelf")), ..Options::local() };
        let node = Node::spawn(lab, phone, opts).await.expect("a node");
        until("the shelf holds it", || async { !node.behind().await }).await;
        until("what it worked out, put", || async { !node.read(|lab, me| lab.warm_due(me)).await }).await;
        let n = node.read(|lab, me| lab.log(me).edits().len()).await;
        node.shutdown().await.expect("it stops");
        n
    });
    eprintln!("LOCAL_READS fixture: {held_edits} edits on its shelf in {:.1?}", began.elapsed());
    // the same iPhone starting again from its shelf, its edits spilled past 256 MiB
    let (mut lab, passkey, phone, alice, _) = base(writers);
    let mut lab = lab.split(phone, &[passkey], [2; 32]);
    let spill = Spill::new(dir.path().join("spill"), 256 << 20).expect("its spill");
    lab.spill(phone, &spill).expect("spilled");
    let v = alice.to_hex();
    let reads = [
        ("entry_views", json!({ "op": "entry_views", "vault": v, "types": ["doc"] })),
        ("entry_views_global", json!({ "op": "entry_views", "types": ["doc"] })),
        ("query", json!({ "op": "query", "vault": v, "where": { "type": ["doc"] } })),
        ("query_window", json!({ "op": "query", "vault": v, "where": { "type": ["doc"] }, "window": 50 })),
        ("cap_groups", json!({ "op": "cap_groups", "vault": v })),
        ("world_summary", json!({ "op": "world_summary" })),
        ("synced", json!({ "op": "synced" })),
    ];
    let (unlock, settled, perf) = rt.block_on(async {
        let at = Instant::now();
        let opts = Options { shelf: Some(disk::open(dir.path()).expect("the shelf")), ..Options::local() };
        let node = Node::spawn(lab, phone, opts).await.expect("a node");
        let unlock = at.elapsed();
        let (n, spilled) = node.read(|lab, me| (lab.log(me).edits().len(), lab.perf(me)["held"]["memory"]["spilling"].clone())).await;
        assert_eq!(n, held_edits, "it took back every edit");
        assert_eq!(spilled, true, "its edits are spilled");
        let settled = timed(&node, &reads, runs).await;
        // what each Lab call `entry_views` makes per entry costs, over every entry
        let parts = node.read(|lab, me| {
            let ids = lab.entries(me);
            let mut out = serde_json::Map::new();
            let mut part = |name: &str, f: &dyn Fn(EntryId)| {
                let at = Instant::now();
                ids.iter().for_each(|&e| f(e));
                out.insert(name.into(), json!((at.elapsed().as_secs_f64() * 1e4).round() / 10.0));
            };
            part("landed", &|e| { std::hint::black_box(lab.landed(me, e)); });
            part("meaning", &|e| { std::hint::black_box(lab.meaning(me, e)); });
            part("item", &|e| { std::hint::black_box(lab.item(me, e).is_some()); });
            part("item_again", &|e| { std::hint::black_box(lab.item(me, e).is_some()); });
            part("history", &|e| { std::hint::black_box(lab.history(me, e).map(|h| h.changes().len())); });
            part("levels", &|e| { let st = lab.state(me); if let Some(en) = st.entry(e) { std::hint::black_box(avendb::world::levels(st, en.vault, en.audience())); } });
            part("authors", &|e| { if let Some(h) = lab.history(me, e) { let heads = h.heads(avendb::history::MAIN); std::hint::black_box(avendb::world::authors(lab, me, e, &heads)); } });
            part("heads", &|e| { if let Some(h) = lab.history(me, e) { std::hint::black_box(h.heads(avendb::history::MAIN)); } });
            part("as_markdown", &|e| { std::hint::black_box(lab.item(me, e).map(|i| i.as_markdown().is_some())); });
            part("read_file_view", &|e| { std::hint::black_box(lab.item(me, e).map(|i| avendb::lens::View::built_in("file").and_then(|v| i.read(v)).is_some())); });
            part("entry_files", &|e| { std::hint::black_box(lab.entry_files(me, e)); });
            Value::Object(out)
        }).await;
        eprintln!("LOCAL_READS parts over every entry, ms: {parts}");
        // `entry_views` in its three parts: the snapshot, under the Lab's lock; where each entry is synced to; the JSON
        let op = reads[0].1.clone();
        let (snapshot, json_ms) = node.read(move |lab, me| {
            let at = Instant::now();
            let snap = avendb::engine::entry_views_snapshot(lab, me, &op).expect("a snapshot").expect("entries");
            let snapshot = at.elapsed();
            let at = Instant::now();
            std::hint::black_box(snap.into_json(&Default::default()));
            (snapshot, at.elapsed())
        }).await;
        eprintln!("LOCAL_READS entry_views split, ms: snapshot {:.1}, json {:.1}", snapshot.as_secs_f64() * 1e3, json_ms.as_secs_f64() * 1e3);
        let perf = node.read(|lab, me| lab.perf(me)).await;
        (unlock, settled, perf)
    });
    let doc_entries = writers * entries;
    println!("LOCAL_READS {}", json!({
        "edits": held_edits,
        "entries": doc_entries,
        "unlock_s": unlock.as_secs_f64(),
        "settled_ms": settled,
        "counts": perf["counts"],
        "timers": perf["timers"],
    }));
}
