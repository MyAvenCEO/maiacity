//! Caps against Lean's vectors (`caps.json`, `Aven.ID.Caps`, `Aven.ID.CapsCbor`). Every expected value is the
//! model's.

mod common;

use aven_core::Hash;
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
                let c = c.named();
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
                let c = c.named();
                assert_eq!(hex(&c.bytes()), hex(&theirs), "{}: {}", v["name"], c.id);
                // and read back as itself
                let back = Cap::from_bytes(&theirs, c.id.clone(), c.signer, c.approvals.clone());
                assert_eq!(
                    back.map(codec_order),
                    Some(codec_order(c.clone())),
                    "{}: {}",
                    v["name"],
                    c.id
                );
            }
            short += 1;
        }
    }
    eprintln!("chains: {bytes} checked byte for byte, {short} name Docs by short ids");
}

/// No bytes but a cap's one encoding read as a cap: every cap of caps.json, cut short, with one byte changed or one
/// added, reads as none or as a cap that writes back to exactly those bytes.
#[test]
fn only_a_caps_own_bytes_read_back() {
    let names = Names::default();
    let caps: Vec<Cap<Hash>> = vectors("caps.json")
        .iter()
        .filter_map(|v| v["input"]["chain"].as_array().cloned())
        .flatten()
        .map(|c| names.cap(&c).named())
        .collect();
    assert!(caps.len() > 100);
    let mut read = 0;
    for c in &caps {
        let bytes = c.bytes();
        let mut variants: Vec<Vec<u8>> = (0..bytes.len()).map(|n| bytes[..n].to_vec()).collect();
        for i in 0..bytes.len() {
            for flip in [1u8, 0x20, 0x80] {
                let mut b = bytes.clone();
                b[i] ^= flip;
                variants.push(b);
            }
        }
        variants.push([bytes.as_slice(), &[0]].concat());
        for b in variants {
            if let Some(x) = Cap::from_bytes(&b, c.id.clone(), c.signer, vec![]) {
                assert_eq!(x.bytes(), b, "{}", c.id);
                read += 1;
            }
        }
    }
    eprintln!("changed bytes that are still some cap's: {read}");
}

/// A cap with each line's parameters in the codec's order (shorter names first, then by their bytes), as its bytes
/// hold them: the vectors' JSON writes a line's parameters by name, which is another order of the same map.
fn codec_order<V>(mut c: Cap<V>) -> Cap<V> {
    for l in &mut c.grant {
        l.params
            .sort_by(|(a, _), (b, _)| (a.len(), a.as_bytes()).cmp(&(b.len(), b.as_bytes())));
    }
    c
}

/// A28's issuers against Lean's vectors (`issuers.json`): coops that issue by their own quorum with no device, owners
/// that meet a quorum alone or don't, and authority that runs down only through quorums.
#[test]
fn issuers_are_judged_as_the_model_does() {
    let all = vectors("issuers.json");
    assert!(all.len() >= 13, "{} issuer vectors", all.len());
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
        for (c, j) in chain.iter().zip(v["input"]["chain"].as_array().unwrap()) {
            let c = c.named();
            assert_eq!(c.digest().text(), j["hash"], "{}: {}", v["name"], c.id);
            assert_eq!(hex(&c.bytes()), j["cbor"], "{}: {}", v["name"], c.id);
        }
    }
}
