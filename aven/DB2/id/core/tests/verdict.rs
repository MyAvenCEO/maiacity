//! Caps' verdict on one envelope over Core types (`authorized`, `revoked`), as the docs layer's `Authorize` calls it:
//! against authorized.json and member.json, with each chain found by its caps' names, and against revocations.json.

mod common;

use aven_core::{Envelope, Hash, Value as V};
use aven_id::caps::{Authority, Cap, PastReads, Refused, Verdict, Written, authorized, revoked};
use common::caps::with_reader;
use common::{envelope, hash, vectors};
use serde_json::{Value, json};

/// Each reading of `file`, judged through `authorized` with its chain named by its caps' names: the same verdict as
/// the reader's; and with its root unknown to the reader, refused as an unknown cap.
fn by_names(file: &str) {
    let all = vectors(file);
    for v in all
        .iter()
        .filter(|v| v["input"].get("deviceCaps").is_some())
    {
        with_reader(&v["input"], |r, reading, _| {
            let held: Vec<Cap> = reading.chain.to_vec();
            let cap = |n: &Hash| held.iter().find(|c| c.named().digest() == *n).cloned();
            let authority = Authority {
                caps: held.iter().map(|c| c.named().digest()).collect(),
                acks: vec![],
                actor: reading.actor,
            };
            let e = Envelope {
                doc: reading.doc,
                branch: reading.branch.into(),
                writer: 1,
                seq: 1,
                prev: None,
                deps: vec![],
                body: V::Null,
                sigs: vec![],
            };
            let w = Written {
                envelope: &e,
                signer: reading.signer,
                calls: &reading.calls,
                authority: &authority,
            };
            let got = authorized(r, &cap, &w);
            assert_eq!(
                got.is_ok(),
                v["expected"]["authorized"] == true,
                "{file}: {}",
                v["name"]
            );
            assert_eq!(
                got,
                r.authorized(reading).map_err(Refused::Reader),
                "{file}: {}",
                v["name"]
            );
            if let Some(root) = authority.caps.first() {
                let none = |_: &Hash| None;
                assert_eq!(
                    authorized(r, &none, &w),
                    Err(Refused::UnknownCap(*root)),
                    "{file}: {}",
                    v["name"]
                );
            }
        });
    }
}

#[test]
fn authorized_by_names_is_the_readers_verdict() {
    by_names("authorized.json");
    by_names("member.json");
}

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

#[test]
fn revoked_is_the_models() {
    let vault = |e: &Envelope| match field(e, "vault") {
        Some(V::Text(t)) => t.clone(),
        _ => String::new(),
    };
    let authority = |e: &Envelope| Authority {
        caps: hashes(field(e, "caps")),
        acks: hashes(field(e, "acks")),
        actor: None,
    };
    let rd = PastReads {
        vault: &vault,
        authority: &authority,
    };
    for v in vectors("revocations.json")
        .iter()
        .filter(|v| v["input"].get("owner").is_none())
    {
        let input = &v["input"];
        let held: Vec<Envelope> = input["doc"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| envelope(&x["envelope"]))
            .collect();
        let rs: Vec<aven_id::caps::Revocation> = input["revocations"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| aven_id::caps::Revocation {
                id: hash(&r["id"]),
                cap: hash(&r["cap"]),
                envelope: r["envelope"].as_str().map(|_| hash(&r["envelope"])),
                kept: r["kept"].as_array().map(|k| k.iter().map(hash).collect()),
            })
            .collect();
        let json_of = |x: Verdict| match x {
            Verdict::Counts => json!("counts"),
            Verdict::Revoked(r) => json!({ "revoked": r.text() }),
            Verdict::Waits(m) => json!({ "waits": m.iter().map(Hash::text).collect::<Vec<_>>() }),
        };
        let got = match input["envelope"].as_str() {
            Some(n) => {
                let e = held.iter().find(|e| e.name() == hash(&json!(n))).unwrap();
                json_of(revoked(&rd, &held, &rs, e))
            }
            None => Value::Object(
                held.iter()
                    .map(|e| (e.name().text(), json_of(revoked(&rd, &held, &rs, e))))
                    .collect(),
            ),
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}
