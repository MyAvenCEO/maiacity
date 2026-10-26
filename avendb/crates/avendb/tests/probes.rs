//! Probes, run by hand: what avenDB's work costs on a big vault, printed rather than asserted. They run in the dev
//! profile, which is optimised (opt-level 2) and, unlike a release build, carries the test fixtures:
//!
//!   NOTES=1500 cargo test --features test-fixtures --test probes one_write -- --ignored --nocapture
//!   NOTES=3000 REMOVALS=8 cargo test --features test-fixtures --test probes whole_replay -- --ignored --nocapture
//!   NOTES=3000 cargo test --features test-fixtures --test probes sync_request -- --ignored --nocapture
//!
//! `one_write_on_a_big_vault`: one local write, one new schema, a restore and Settings' shares, by the refresh's timers.
//! `whole_replay_with_removals`: a whole replay as removals pile up on a big log.
//! `sync_request_on_a_big_vault`: what a device asks a peer, the first time, again unchanged, and after one more write.

use avendb::cast::{document, human_on};
use avendb::lab::Lab;
use avendb::policy::{replay, Action, Revoking};
use serde_json::Value;
use std::time::Instant;

fn totals(v: &Value) -> Vec<(String, f64)> {
    v["timers"].as_object().unwrap().iter().map(|(k, t)| (k.clone(), t["total_ms"].as_f64().unwrap())).collect()
}

#[test]
#[ignore]
fn one_write_on_a_big_vault() {
    let n: usize = std::env::var("NOTES").ok().and_then(|s| s.parse().ok()).unwrap_or(300);
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let alice = human_on(&mut lab, passkey, &[mac]);
    let t = Instant::now();
    let mut notes = vec![];
    for i in 0..n {
        let e = lab.create(mac, alice, alice, "note", &[], document(&format!("Note {i}"), "Hello.", mac)).unwrap();
        notes.push(e);
    }
    for (i, e) in notes.iter().enumerate() {
        let per: usize = std::env::var("EDITS").ok().and_then(|s| s.parse().ok()).unwrap_or(3);
        for k in 0..per {
            lab.edit(mac, alice, *e, |it| it.set_text(2, &format!("Edit {k} of {i}."))).unwrap();
        }
    }
    eprintln!("built {} edits in {:?}", lab.log(mac).edits().len(), t.elapsed());
    for round in 0..3 {
        let before = totals(&lab.perf(mac));
        let t = Instant::now();
        lab.edit(mac, alice, notes[round], |it| it.set_text(2, "One more.")).unwrap();
        let took = t.elapsed();
        let after = totals(&lab.perf(mac));
        eprintln!("write {round}: {took:?}");
        for (k, v) in &after {
            let was = before.iter().find(|(b, _)| b == k).map_or(0.0, |(_, x)| *x);
            if v - was > 0.05 {
                eprintln!("  {k}: {:.2} ms", v - was);
            }
        }
    }
    // a new schema of the vault: its lane grows
    for round in 0..2 {
        let before = totals(&lab.perf(mac));
        let t = Instant::now();
        let blob = avendb::lens::blobs::POST_V1.replace("Post, v1", &format!("Post, round {round}"));
        let op = serde_json::json!({ "op": "create", "vault": alice.to_hex(), "type": "schema", "value": blob });
        let answer = avendb::engine::run(&mut lab, mac, &op);
        assert!(answer.get("ok").is_some(), "{answer}");
        let took = t.elapsed();
        let after = totals(&lab.perf(mac));
        eprintln!("schema {round}: {took:?}");
        for (k, v) in &after {
            let was = before.iter().find(|(b, _)| b == k).map_or(0.0, |(_, x)| *x);
            if v - was > 0.05 {
                eprintln!("  {k}: {:.2} ms", v - was);
            }
        }
    }
    // the device starting again from what it keeps, as an unlock does
    let backup = lab.backup(mac);
    let before = totals(&lab.perf(mac));
    let t = Instant::now();
    lab.restore_from(mac, backup);
    eprintln!("restore: {:?}", t.elapsed());
    for (k, v) in &totals(&lab.perf(mac)) {
        let was = before.iter().find(|(b, _)| b == k).map_or(0.0, |(_, x)| *x);
        if v - was > 0.05 {
            eprintln!("  {k}: {:.2} ms", v - was);
        }
    }
    // what Settings asks: the shares over the vault, each row with a dry run of its revoke
    for round in 0..2 {
        let t = Instant::now();
        let op = serde_json::json!({ "op": "shares", "over": alice.to_hex() });
        let answer = avendb::engine::run(&mut lab, mac, &op);
        assert!(answer.get("ok").is_some(), "{answer}");
        eprintln!("shares {round}: {:?}", t.elapsed());
    }
}



#[test]
#[ignore]
fn whole_replay_with_removals() {
    let n: usize = std::env::var("NOTES").ok().and_then(|s| s.parse().ok()).unwrap_or(2000);
    let r: usize = std::env::var("REMOVALS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phones: Vec<_> = (0..r).map(|i| lab.device_of(passkey, &format!("Phone {i}"))).collect();
    let mut devices = vec![mac];
    devices.extend(&phones);
    let alice = human_on(&mut lab, passkey, &devices);
    for i in 0..n {
        lab.create(mac, alice, alice, "note", &[], document(&format!("Note {i}"), "Hello.", mac)).unwrap();
        if r > 0 && (i + 1) % (n / r).max(1) == 0 && (i + 1) / (n / r).max(1) <= r {
            let device = phones[(i + 1) / (n / r).max(1) - 1];
            lab.submit(mac, &[passkey], Action::Revoke(Revoking::Device { vault: alice, device, keep: vec![] })).unwrap();
        }
    }
    let edits = lab.log(mac).edits().to_vec();
    let removals = edits.iter().filter(|e| e.is_removal()).count();
    let t = Instant::now();
    let whole = replay(&edits);
    eprintln!("PROBE edits={} removals={removals} stood={} replay_ms={:.0}", edits.len(), whole.stood.iter().filter(|s| **s).count(), t.elapsed().as_secs_f64() * 1e3);
}

#[test]
#[ignore]
fn sync_request_on_a_big_vault() {
    let n: usize = std::env::var("NOTES").ok().and_then(|s| s.parse().ok()).unwrap_or(300);
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let alice = human_on(&mut lab, passkey, &[mac, phone]);
    let mut notes = vec![];
    for i in 0..n {
        notes.push(lab.create(mac, alice, alice, "note", &[], document(&format!("Note {i}"), "Hello.", mac)).unwrap());
    }
    for (i, e) in notes.iter().enumerate() {
        lab.edit(mac, alice, *e, |it| it.set_text(2, &format!("Edit of {i}."))).unwrap();
    }
    eprintln!("{} edits", lab.log(mac).edits().len());
    let time = |lab: &Lab, what: &str| {
        let t = Instant::now();
        let asked = lab.request(mac, phone);
        eprintln!("{what}: {:?} ({} logs)", t.elapsed(), asked.ask.haves.len());
    };
    time(&lab, "first");
    for k in 0..3 {
        time(&lab, &format!("unchanged {k}"));
    }
    lab.edit(mac, alice, notes[0], |it| it.set_text(2, "One more.")).unwrap();
    time(&lab, "after a write");
    time(&lab, "unchanged after it");
}
