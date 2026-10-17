//! The repo seed of the Maia City vault (the page's `src/lib/avendb/seed.js`) through the ops engine: every op the page
//! would write into a vault that holds none of it yet, piece by piece, each `"$n"` naming the entry op n of its piece
//! made, as the page's `refs` resolves it. Every create must fit its schema; each article links its story, which reads
//! back; and each code entry reads back with its `ref:` tag. The ops come from the repository as it is
//! (`node scripts/seed-ops.mjs <vault> <out.json>`), so the test runs where they are given, by the path in `SEED_OPS`:
//!
//!   node scripts/seed-ops.mjs 0000…0000 /tmp/seed.json && SEED_OPS=/tmp/seed.json cargo test --test seed -- --ignored
//!
//! The vault the ops name is swapped for Alice's, where her Mac writes them.

use avendb::cast;
use avendb::engine;
use serde_json::{Value, json};

/// Op `op` with each `"$n"` the entry the op n before it made, of `done`, as the page's `refs` has it.
fn refs(op: &Value, done: &[Value]) -> Value {
    match op {
        Value::String(s) if s.starts_with('$') && s[1..].parse::<usize>().is_ok() => {
            done[s[1..].parse::<usize>().unwrap()]["entry"].clone()
        }
        Value::Array(xs) => Value::Array(xs.iter().map(|x| refs(x, done)).collect()),
        Value::Object(o) => Value::Object(o.iter().map(|(k, v)| (k.clone(), refs(v, done))).collect()),
        v => v.clone(),
    }
}

/// Text `text` with every 64-hex-digit vault id `from` as `to`.
fn swapped(v: &Value, from: &str, to: &str) -> Value {
    serde_json::from_str(&v.to_string().replace(from, to)).expect("JSON")
}

#[test]
#[ignore = "runs on the ops scripts/seed-ops.mjs writes, by the path in SEED_OPS"]
fn the_repo_seed_fits_its_schemas() {
    let path = std::env::var("SEED_OPS").expect("SEED_OPS names the ops scripts/seed-ops.mjs wrote");
    let pieces: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).expect("the seed's ops")).expect("JSON");
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let from = pieces.iter().flat_map(|p| p["ops"].as_array().unwrap()).find_map(|o| o["vault"].as_str()).unwrap().to_string();
    let (mut made, mut posts, mut code, mut refused) = (0, vec![], vec![], vec![]);
    'pieces: for p in &pieces {
        let mut done: Vec<Value> = vec![];
        for op in p["ops"].as_array().unwrap() {
            let mut op = refs(&swapped(op, &from, &alice), &done);
            // the share is an owner's change, approved with the passkey: the page's ceremony, not the seed's records
            if op["op"] == "share" {
                done.push(json!({}));
                continue;
            }
            op.as_object_mut().unwrap().remove("as");
            let answer = engine::run(&mut w.lab, mac, &op);
            let Some(ok) = answer.get("ok") else {
                refused.push(format!("{}: {} refused: {answer}", p["key"], op["type"]));
                continue 'pieces;
            };
            match op["type"].as_str() {
                Some("post") => posts.push((p["key"].clone(), ok["entry"].clone())),
                Some("view" | "logic") => code.push((p["key"].clone(), ok["entry"].clone())),
                _ => {}
            }
            done.push(ok.clone());
            made += 1;
        }
    }
    assert!(refused.is_empty(), "every piece fits its schemas:\n{}", refused.join("\n"));
    assert!(made > 200, "the seed writes its pieces: {made} entries");
    for (key, entry) in &posts {
        let got = engine::run(&mut w.lab, mac, &json!({ "op": "get", "entry": entry }));
        let story = got["ok"]["record"]["story"]["entry"].clone();
        assert!(story.is_string(), "{key}: its post links its story: {got}");
        let story = engine::run(&mut w.lab, mac, &json!({ "op": "get", "entry": story, "schema": "story" }));
        assert_eq!(story["ok"]["record"]["kind"], "story", "{key}: its story reads back: {story}");
    }
    for (key, entry) in &code {
        let got = engine::run(&mut w.lab, mac, &json!({ "op": "get", "entry": entry }));
        let tags = got["ok"]["tags"].as_array().cloned().unwrap_or_default();
        assert!(tags.contains(&json!(format!("ref:{}", key.as_str().unwrap()))), "{key}: its ref tag: {got}");
    }
    assert_eq!(posts.len(), 68, "18 journal days and 50 inspire-me reports, each a post of its story");
}
