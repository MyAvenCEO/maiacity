//! A probe, run by hand: what one local write and one new schema cost on a device holding a big vault, by the
//! refresh's timers (`NOTES=1500 cargo test --release --test write_cost -- --ignored --nocapture`).

use avendb::cast::{document, human_on};
use avendb::lab::Lab;
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
}
