//! Revocations and deletes against Lean's vectors (`revocations.json`, `Aven.ID.Revoke`): every envelope's verdict
//! with the revocations a reader holds, and whether it survives its vault's delete. Every expected value is the
//! model's.

mod common;

use aven_core::{Envelope, Hash, Value as V};
use aven_id::{Doc, Reads, Revocation, Verdict};
use common::{envelope, hash, vectors};
use serde_json::{Value, json};

/// What caps reads of the examples' envelopes: their body's `vault`, `caps` and `acks` (`RevokeExamples.reads`).
struct Body;

fn field<'a>(e: &'a Envelope, k: &str) -> Option<&'a V> {
    match &e.body {
        V::Map(kvs) => kvs.iter().find(|(x, _)| x == k).map(|(_, v)| v),
        _ => None,
    }
}

fn hashes(v: Option<&V>) -> Vec<Hash> {
    match v {
        Some(V::Array(xs)) => xs
            .iter()
            .filter_map(|x| match x {
                V::Bytes(b) => b.as_slice().try_into().ok().map(Hash),
                _ => None,
            })
            .collect(),
        _ => vec![],
    }
}

impl Reads for Body {
    fn vault(&self, e: &Envelope) -> String {
        match field(e, "vault") {
            Some(V::Text(t)) => t.clone(),
            _ => String::new(),
        }
    }
    fn caps(&self, e: &Envelope) -> Vec<Hash> {
        hashes(field(e, "caps"))
    }
    fn acks(&self, e: &Envelope) -> Vec<Hash> {
        hashes(field(e, "acks"))
    }
}

fn revocation(v: &Value) -> Revocation {
    Revocation {
        id: hash(&v["id"]),
        cap: hash(&v["cap"]),
        envelope: v["envelope"].as_str().map(|_| hash(&v["envelope"])),
        kept: v["kept"].as_array().map(|k| k.iter().map(hash).collect()),
    }
}

fn verdict(v: &Verdict) -> Value {
    match v {
        Verdict::Counts => json!("counts"),
        Verdict::Revoked(r) => json!({ "revoked": r.text() }),
        Verdict::Waits(m) => json!({ "waits": m.iter().map(Hash::text).collect::<Vec<_>>() }),
    }
}

#[test]
fn verdicts_are_the_models() {
    let all = vectors("revocations.json");
    assert!(all.len() >= 50, "{} revocation vectors", all.len());
    for v in &all {
        let input = &v["input"];
        let doc: Vec<Envelope> = input["doc"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| {
                let e = envelope(&x["envelope"]);
                assert_eq!(e.name(), hash(&x["name"]), "{}: {}", v["name"], x["label"]);
                e
            })
            .collect();
        let rs: Vec<Revocation> = input["revocations"]
            .as_array()
            .unwrap()
            .iter()
            .map(revocation)
            .collect();
        let d = Doc::new(&doc);
        let named = |n: &Value| doc.iter().find(|e| e.name() == hash(n)).unwrap();
        let got = if let Some(owner) = input["owner"].as_str() {
            let is_delete = |e: &Envelope| field(e, "delete") == Some(&V::Bool(true));
            let by_owner = |e: &Envelope| Body.vault(e) == owner;
            json!({ "survives": d.survives(is_delete, by_owner, named(&input["envelope"])) })
        } else if input.get("envelope").is_some() {
            verdict(&d.verdict(&Body, &rs, named(&input["envelope"])))
        } else {
            let mut all = serde_json::Map::new();
            for e in &doc {
                all.insert(e.name().text(), verdict(&d.verdict(&Body, &rs, e)));
            }
            Value::Object(all)
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}
