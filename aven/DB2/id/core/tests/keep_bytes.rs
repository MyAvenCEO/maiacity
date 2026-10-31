//! A keeper's bytes against Lean's vectors (`keep-bytes.json`, `Aven.ID.KeepCbor`): fetch keys from epoch keys, and each
//! signed thing's body, CBOR, signing bytes and name. Then real signatures: a fetch key signs a link and a proof, and a
//! keeper checks them by its public half.

mod common;

use aven_core::{DocId, Hash, Signed, encode};
use aven_id::Secret;
use aven_id::keep::bytes::{
    Choice, Link, Listing, Order, fetch_key, fetch_seed, fetch_signer, proof_signed, verify,
};
use common::caps::value_json;
use common::{hex, unhex, vectors};
use ed25519_dalek::Signer;
use serde_json::{Value, json};

fn arr(v: &Value) -> [u8; 32] {
    unhex(v.as_str().unwrap()).try_into().unwrap()
}
fn doc(v: &Value) -> DocId {
    DocId::parse(v.as_str().unwrap()).unwrap()
}
fn name(v: &Value) -> Hash {
    Hash::parse(v.as_str().unwrap()).unwrap()
}

fn signed(input: &Value) -> Signed {
    if let Some(l) = input.get("listing") {
        Listing {
            cap: name(&l["cap"]),
            docs: l["docs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|d| (doc(&d["doc"]), arr(&d["key"])))
                .collect(),
        }
        .signed(vec![])
    } else if let Some(l) = input.get("link") {
        Link {
            doc: doc(&l["doc"]),
            epoch: name(&l["epoch"]),
            key: arr(&l["key"]),
            n: l["n"].as_u64().unwrap(),
            prev: name(&l["prev"]),
        }
        .signed(vec![])
    } else if let Some(o) = input.get("order") {
        match o["act"].as_str().unwrap() {
            "withdraw" => Order::Withdraw(name(&o["cap"])),
            _ => Order::Delete(doc(&o["doc"])),
        }
        .signed(vec![])
    } else if let Some(c) = input.get("choice") {
        Choice {
            doc: doc(&c["doc"]),
            fork: arr(&c["fork"]),
            branch: arr(&c["branch"]),
        }
        .signed(vec![])
    } else {
        let p = &input["proof"];
        proof_signed(
            &doc(&p["doc"]),
            &unhex(p["exporter"].as_str().unwrap()),
            vec![],
        )
    }
}

#[test]
fn keep_bytes_are_the_models() {
    let all = vectors("keep-bytes.json");
    assert!(all.len() >= 10, "{} keep-bytes vectors", all.len());
    for v in &all {
        let input = &v["input"];
        let got = if let Some(k) = input.get("epochKey") {
            let key = Secret::take(&mut arr(k));
            json!({ "seed": hex(fetch_seed(&key).expose()), "key": hex(&fetch_key(&key)) })
        } else {
            let s = signed(input);
            json!({ "body": value_json(&s.body), "cbor": hex(&encode(&s.body)), "signing": hex(&s.signing()), "name": s.name().text() })
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}

/// A fetch key signs a link and a proof; a keeper checks each by the key's public half, and nothing else verifies.
#[test]
fn fetch_keys_sign_and_keepers_check() {
    let epoch0 = Secret::take(&mut [1; 32]);
    let epoch1 = Secret::take(&mut [2; 32]);
    let d = DocId(aven_core::blake3(b"d1"));
    let link = Link {
        doc: d,
        epoch: aven_core::blake3(b"e1"),
        key: fetch_key(&epoch1),
        n: 1,
        prev: aven_core::blake3(b"listing"),
    };
    let mut s = link.signed(vec![]);
    let sig = fetch_signer(&epoch0).sign(&s.signing());
    s.sigs.push(aven_core::Sig {
        signer: fetch_key(&epoch0).to_vec(),
        sig: sig.to_bytes().to_vec(),
    });
    assert!(s.signed_by(&verify, &fetch_key(&epoch0)));
    assert!(!s.signed_by(&verify, &fetch_key(&epoch1)));
    // the same signature over another link, or another label, verifies no more
    let other = Link { n: 2, ..link }.signed(s.sigs.clone());
    assert!(!other.signed_by(&verify, &fetch_key(&epoch0)));
    let exporter = [7u8; 32];
    let mut p = proof_signed(&d, &exporter, vec![]);
    let sig = fetch_signer(&epoch1).sign(&p.signing());
    p.sigs.push(aven_core::Sig {
        signer: fetch_key(&epoch1).to_vec(),
        sig: sig.to_bytes().to_vec(),
    });
    assert!(p.signed_by(&verify, &fetch_key(&epoch1)));
    // a proof made for another connection is refused
    let elsewhere = proof_signed(&d, &[8u8; 32], p.sigs.clone());
    assert!(!elsewhere.signed_by(&verify, &fetch_key(&epoch1)));
}
