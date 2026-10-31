//! Caps against Lean's vectors (`caps.json`, `Aven.ID.Caps`, `Aven.ID.CapsCbor`). Every expected value is the
//! model's.

mod common;

use aven_id::caps::Cap;
use common::caps::{Context, Names, branches, full_docs};
use common::{hex, unhex, vectors};
use serde_json::{Value, json};

#[test]
fn branches_allow_as_the_model_does() {
    let all: Vec<Value> = vectors("caps.json")
        .into_iter()
        .filter(|v| v["input"].get("branches").is_some())
        .collect();
    assert!(all.len() >= 8, "{} branch vectors", all.len());
    for v in &all {
        let got = branches(&v["input"]["branches"]).allows(v["input"]["branch"].as_str().unwrap());
        assert_eq!(json!({ "allows": got }), v["expected"], "{}", v["name"]);
    }
}

#[test]
fn chains_are_judged_as_the_model_does() {
    let all: Vec<Value> = vectors("caps.json")
        .into_iter()
        .filter(|v| v["input"].get("chain").is_some())
        .collect();
    assert!(all.len() >= 90, "{} chain vectors", all.len());
    let (mut bytes, mut short) = (0, 0);
    for v in &all {
        let names = Names::default();
        let ctx = Context::of(&names, &v["input"]["context"]);
        let chain: Vec<Cap> = v["input"]["chain"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| names.cap(c))
            .collect();
        let got = ctx.with(|x| match x.chain_error(&chain) {
            None => json!({ "ok": true }),
            Some(e) => json!({ "ok": false, "error": names.error_json(&e) }),
        });
        assert_eq!(got, v["expected"], "{}", v["name"]);
        // its bytes, its id and what its device signs, where every Doc it names is a real one
        if names.all_full() {
            for (c, j) in chain.iter().zip(v["input"]["chain"].as_array().unwrap()) {
                assert_eq!(hex(&c.bytes()), j["cbor"], "{}: {}", v["name"], c.id);
                assert_eq!(c.digest().text(), j["hash"], "{}: {}", v["name"], c.id);
                assert_eq!(hex(&c.signing()), j["signs"], "{}: {}", v["name"], c.id);
            }
            bytes += 1;
        } else {
            // the model's bytes, each short Doc id swapped for the id it maps to: everything else is byte for byte
            for (c, j) in chain.iter().zip(v["input"]["chain"].as_array().unwrap()) {
                let theirs = aven_core::decode(&unhex(j["cbor"].as_str().unwrap())).unwrap();
                assert_eq!(
                    aven_core::encode(&theirs),
                    unhex(j["cbor"].as_str().unwrap())
                );
                let theirs = aven_core::encode(&full_docs(theirs));
                assert_eq!(hex(&c.bytes()), hex(&theirs), "{}: {}", v["name"], c.id);
            }
            short += 1;
        }
    }
    eprintln!("chains: {bytes} checked byte for byte, {short} name Docs by short ids");
}
