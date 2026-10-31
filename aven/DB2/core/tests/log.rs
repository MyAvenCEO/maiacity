//! Signed things, envelopes, logs, splits, the past and the limits against Lean's vectors (README rule 10), byte for
//! byte: `envelopes.json`, `logs.json`, `signed.json`, `limits.json`, `past.json` and `counts.json`; and properties
//! that need no model: round trips, signing again, a writer's log. `model.rs` asks the running model on random inputs.

mod common;

use aven_core::limits::{
    MAX_BRANCH_BYTES, MAX_DEPS, MAX_ENVELOPE_BYTES, MAX_LABEL_BYTES, MAX_SIG_BYTES,
    MAX_SIGNER_BYTES,
};
use aven_core::past::{in_past, past};
use aven_core::{
    DocId, ENVELOPE_LABEL, Envelope, Hash, Held, Log, LogId, MAX_DEPTH, Refused, Signed, Value,
    blake3, decode, encode, is_chain, signing_bytes, split,
};
use common::{bools, envelope, hex, indices, names, signed, unhex, vectors};
use proptest::prelude::*;
use serde_json::Value as Json;

#[test]
fn envelopes() {
    let mut n = 0;
    for v in vectors("envelopes.json") {
        let name = v["name"].as_str().unwrap();
        let e = envelope(&v["input"]);
        let x = &v["expected"];
        assert_eq!(
            hex(&e.signing()),
            x["signs"].as_str().unwrap(),
            "{name}: signs"
        );
        assert_eq!(
            hex(&e.encode()),
            x["cbor"].as_str().unwrap(),
            "{name}: cbor"
        );
        assert_eq!(e.name().text(), x["name"].as_str().unwrap(), "{name}: name");
        assert_eq!(
            Envelope::decode(&unhex(x["cbor"].as_str().unwrap())),
            Some(e),
            "{name}: read back"
        );
        n += 1;
    }
    assert!(n >= 3);
}

#[test]
fn logs() {
    let mut n = 0;
    for v in vectors("logs.json") {
        let name = v["name"].as_str().unwrap();
        let pair = v["input"].as_array().unwrap();
        let (a, b) = (envelope(&pair[0]), envelope(&pair[1]));
        let want = v["expected"].as_bool().unwrap();
        assert_eq!(split(&a, &b), want, "{name}");
        assert_eq!(split(&b, &a), want, "{name}: Split.symm");
        n += 1;
    }
    assert!(n >= 4);
}

/// The vectors' first two envelopes are a chain, and a writer's log takes them in order and refuses the split.
#[test]
fn vectors_chain() {
    let es: Vec<Envelope> = vectors("envelopes.json")
        .iter()
        .map(|v| envelope(&v["input"]))
        .collect();
    // the first two are one writer's log; the third, another writer's, builds on both
    assert!(is_chain(&es[..2]) && !is_chain(&es));
    assert!(is_chain(&es[2..]) && es[2].deps == [es[1].name(), es[0].name()]);
    let mut log = Log::new(es[0].log());
    assert_eq!(log.push(es[1].clone()), Err(Refused::NotNext));
    log.push(es[0].clone()).unwrap();
    log.push(es[1].clone()).unwrap();
    log.push(es[1].clone()).unwrap();
    assert_eq!(log.head(), Some(es[1].name()));
    let pair = &vectors("logs.json")[2]["input"];
    assert_eq!(log.push(envelope(&pair[1])), Err(Refused::Split));
    let mut other = es[0].clone();
    other.writer += 1;
    assert_eq!(log.push(other), Err(Refused::OtherLog));
    let mut stray = es[1].clone();
    stray.seq = 3;
    assert_eq!(log.push(stray), Err(Refused::WrongPrev));
}

/// What the Lean signs, under the label it names.
#[test]
fn labels_and_signing() {
    assert_eq!(ENVELOPE_LABEL, "avenDB envelope 1");
    let e = envelope(&vectors("envelopes.json")[0]["input"]);
    assert_eq!(e.signing(), signing_bytes(ENVELOPE_LABEL, &e.unsigned()));
    assert_eq!(
        decode(&e.signing()),
        Some(Value::Array(vec![
            Value::Text(ENVELOPE_LABEL.into()),
            e.unsigned()
        ]))
    );
    // verification is a parameter: here, a scheme whose signature is the hash of the key and the message
    let scheme = |key: &[u8], msg: &[u8], sig: &[u8]| blake3(&[key, msg].concat()).0 == sig;
    let mut signed = e.clone();
    signed.sig = blake3(&[&e.signer[..], &e.signing()].concat()).0.to_vec();
    assert!(signed.valid(&scheme));
    assert!(!e.valid(&scheme));
    assert_eq!(signed.name(), e.name());
}

/// Every input has a limit (rule 10), and only the envelope's own shape reads back.
#[test]
fn limits() {
    let e = envelope(&vectors("envelopes.json")[1]["input"]);
    let mut big = e.clone();
    big.body = Value::Bytes(vec![0; MAX_ENVELOPE_BYTES]);
    assert!(big.encode().len() > MAX_ENVELOPE_BYTES);
    assert_eq!(Envelope::decode(&big.encode()), None);
    let mut many = e.clone();
    many.deps = vec![e.name(); MAX_DEPS + 1];
    assert_eq!(Envelope::decode(&many.encode()), None);
    many.deps.pop();
    assert_eq!(Envelope::decode(&many.encode()), Some(many));
    // a short hash, a missing key, an extra key, a key of the wrong form: each refused
    let Value::Map(kvs) = e.value() else { panic!() };
    let with = |i: usize, v: Value| {
        let mut kvs = kvs.clone();
        kvs[i].1 = v;
        Envelope::of_value(Value::Map(kvs))
    };
    assert_eq!(with(0, Value::Bytes(vec![1; 31])), None);
    assert_eq!(with(5, Value::Bytes(vec![1; 33])), None);
    assert_eq!(with(1, Value::Nint(0)), None);
    assert_eq!(with(6, Value::Bytes(b"main".to_vec())), None);
    assert_eq!(Envelope::of_value(Value::Map(kvs[1..].to_vec())), None);
    let mut extra = kvs.clone();
    extra.push(("zzzzzzz".into(), Value::Null));
    assert_eq!(Envelope::of_value(Value::Map(extra)), None);
    // the codec decodes maps in its own order, so an unsorted map never reaches `of_value`
    assert_eq!(Envelope::decode(&encode(&e.value())), Some(e));
}

#[test]
fn signed_things() {
    let mut n = 0;
    for v in vectors("signed.json") {
        let name = v["name"].as_str().unwrap();
        let s = signed(&v["input"]);
        let x = &v["expected"];
        assert_eq!(
            hex(&s.signing()),
            x["signs"].as_str().unwrap(),
            "{name}: signs"
        );
        assert_eq!(
            hex(&s.encode()),
            x["cbor"].as_str().unwrap(),
            "{name}: cbor"
        );
        assert_eq!(s.name().text(), x["name"].as_str().unwrap(), "{name}: name");
        assert_eq!(
            Signed::decode(&unhex(x["cbor"].as_str().unwrap())),
            Some(s),
            "{name}: read back"
        );
        n += 1;
    }
    assert!(n >= 3);
}

/// `limits.rs` holds Lean's numbers, and a reader accepts exactly at each limit and refuses one past it.
#[test]
fn limits_vectors() {
    let vs = vectors("limits.json");
    let l = &vs[0]["expected"];
    let num = |k: &str| l[k].as_u64().unwrap() as usize;
    assert_eq!(MAX_ENVELOPE_BYTES, num("maxEnvelopeBytes"));
    assert_eq!(MAX_DEPS, num("maxDeps"));
    assert_eq!(MAX_BRANCH_BYTES, num("maxBranchBytes"));
    assert_eq!(MAX_LABEL_BYTES, num("maxLabelBytes"));
    assert_eq!(MAX_SIGNER_BYTES, num("maxSignerBytes"));
    assert_eq!(MAX_SIG_BYTES, num("maxSigBytes"));
    assert_eq!(MAX_DEPTH, num("maxDepth"));
    let (mut accepted, mut refused) = (0, 0);
    for v in &vs[1..] {
        let name = v["name"].as_str().unwrap();
        let i = &v["input"];
        let zeros = i
            .get("bodyZeros")
            .map(|n| Value::Bytes(vec![0; n.as_u64().unwrap() as usize]));
        let (bytes, ok) = if let Some(e) = i.get("envelope") {
            let mut e = envelope(e);
            if let Some(z) = zeros {
                e.body = z;
            }
            let bytes = e.encode();
            let back = Envelope::decode(&bytes);
            assert!(back.is_none() || back == Some(e), "{name}: read back");
            (bytes.len(), back.is_some())
        } else {
            let mut s = signed(&i["signed"]);
            if let Some(z) = zeros {
                s.body = z;
            }
            let bytes = s.encode();
            let back = Signed::decode(&bytes);
            assert!(back.is_none() || back == Some(s), "{name}: read back");
            (bytes.len(), back.is_some())
        };
        assert_eq!(
            bytes as u64,
            v["expected"]["bytes"].as_u64().unwrap(),
            "{name}: size"
        );
        let want = v["expected"]["accepted"].as_bool().unwrap();
        assert_eq!(ok, want, "{name}");
        if want { accepted += 1 } else { refused += 1 }
    }
    assert!(
        accepted >= 9 && refused >= 9,
        "{accepted} accepted, {refused} refused"
    );
}

/// A world of `past.json` or `counts.json`: its envelopes, and those a reader holds.
fn world(i: &Json) -> (Vec<Envelope>, Vec<Envelope>) {
    let all: Vec<Envelope> = i["envelopes"]
        .as_array()
        .unwrap()
        .iter()
        .map(envelope)
        .collect();
    let held = bools(&i["held"]);
    let s = all
        .iter()
        .zip(&held)
        .filter(|(_, h)| **h)
        .map(|(e, _)| e.clone())
        .collect();
    (all, s)
}

#[test]
fn past_vectors() {
    let mut n = 0;
    for v in vectors("past.json") {
        let name = v["name"].as_str().unwrap();
        let (all, s) = world(&v["input"]);
        let held = Held::new(&s);
        for (k, a) in all.iter().enumerate() {
            let want: std::collections::BTreeSet<Hash> =
                names(&v["expected"]["past"][k]).into_iter().collect();
            assert_eq!(
                past(Envelope::name, &s, a),
                want,
                "{name}, envelope {k}: past"
            );
            assert_eq!(held.past(a), want, "{name}, envelope {k}: past");
            let before: Vec<bool> = s
                .iter()
                .map(|b| in_past(Envelope::name, &s, a, b))
                .collect();
            assert_eq!(
                before,
                bools(&v["expected"]["inPast"][k]),
                "{name}, envelope {k}: inPast"
            );
            n += 1;
        }
    }
    assert!(n >= 100);
}

#[test]
fn counts_vectors() {
    let mut n = 0;
    for v in vectors("counts.json") {
        let name = v["name"].as_str().unwrap();
        let (all, s) = world(&v["input"]);
        let bad: Vec<Hash> = indices(&v["input"]["bad"])
            .iter()
            .map(|&i| all[i].name())
            .collect();
        let tips: Vec<Hash> = indices(&v["input"]["tips"])
            .iter()
            .map(|&i| all[i].name())
            .collect();
        let held = Held::new(&s);
        let ok = |x: &Envelope| !bad.contains(&x.name());
        let x = &v["expected"];
        let got = |f: &dyn Fn(&Envelope) -> bool| all.iter().map(f).collect::<Vec<bool>>();
        assert_eq!(
            got(&|e| held.discounted(e)),
            bools(&x["discounted"]),
            "{name}: discounted"
        );
        assert_eq!(
            got(&|e| held.counts(e, ok)),
            bools(&x["counts"]),
            "{name}: counts"
        );
        assert_eq!(
            got(&|e| held.holds(&tips, e)),
            bools(&x["holds"]),
            "{name}: holds"
        );
        n += all.len();
    }
    assert!(n >= 100);
}

/// A Value of every form, a few levels deep.
fn any_value() -> impl Strategy<Value = Value> {
    let leaf = prop_oneof![
        any::<u64>().prop_map(Value::Uint),
        any::<u64>().prop_map(Value::Nint),
        proptest::collection::vec(any::<u8>(), 0..40).prop_map(Value::Bytes),
        ".{0,6}".prop_map(Value::Text),
        any::<bool>().prop_map(Value::Bool),
        Just(Value::Null),
    ];
    leaf.prop_recursive(3, 24, 4, |inner| {
        prop_oneof![
            proptest::collection::vec(inner.clone(), 0..4).prop_map(Value::Array),
            proptest::collection::btree_map(".{0,4}", inner, 0..4)
                .prop_map(|m| Value::Map(m.into_iter().collect())),
        ]
    })
}

/// Maps in the codec's key order, as `decode` gives them.
fn canonical(v: Value) -> Value {
    match v {
        Value::Array(xs) => Value::Array(xs.into_iter().map(canonical).collect()),
        Value::Map(kvs) => {
            let mut kvs: Vec<(String, Value)> =
                kvs.into_iter().map(|(k, v)| (k, canonical(v))).collect();
            kvs.sort_by(|a, b| {
                a.0.len()
                    .cmp(&b.0.len())
                    .then_with(|| a.0.as_bytes().cmp(b.0.as_bytes()))
            });
            Value::Map(kvs)
        }
        v => v,
    }
}

fn any_envelope() -> impl Strategy<Value = Envelope> {
    (
        any::<[u8; 32]>(),
        ".{0,8}",
        any::<u64>(),
        any::<u64>(),
        proptest::option::of(any::<[u8; 32]>()),
        proptest::collection::vec(any::<[u8; 32]>(), 0..4),
        any_value(),
        proptest::collection::vec(any::<u8>(), 0..64),
        proptest::collection::vec(any::<u8>(), 0..96),
    )
        .prop_map(
            |(doc, branch, writer, seq, prev, deps, body, signer, sig)| Envelope {
                doc: DocId(Hash(doc)),
                branch,
                writer,
                seq,
                prev: prev.map(Hash),
                deps: deps.into_iter().map(Hash).collect(),
                body: canonical(body),
                signer,
                sig,
            },
        )
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    /// An envelope reads back from its bytes, and its bytes from it; what it signs decodes to `[label, unsigned]`.
    #[test]
    fn envelope_round_trip(e in any_envelope()) {
        let bytes = e.encode();
        prop_assert_eq!(decode(&bytes), Some(e.value()));
        prop_assert_eq!(Envelope::decode(&bytes), Some(e.clone()));
        prop_assert_eq!(Envelope::decode(&bytes).map(|d| d.encode()), Some(bytes));
        prop_assert_eq!(
            decode(&e.signing()),
            Some(Value::Array(vec![Value::Text(ENVELOPE_LABEL.into()), e.unsigned()]))
        );
    }

    /// A signed thing reads back too, and its name is its label's and body's alone.
    #[test]
    fn signed_round_trip(label in ".{0,12}", body in any_value(), signer in proptest::collection::vec(any::<u8>(), 0..40),
        sig in proptest::collection::vec(any::<u8>(), 0..80), sig2 in proptest::collection::vec(any::<u8>(), 0..80)) {
        let s = Signed { label, body: canonical(body), signer, sig };
        prop_assert_eq!(Signed::decode(&s.encode()), Some(s.clone()));
        prop_assert_eq!(s.name(), blake3(&signing_bytes(&s.label, &s.body)));
        let again = Signed { sig: sig2, signer: vec![1, 2, 3], ..s.clone() };
        prop_assert_eq!(again.name(), s.name()); // Signed.name_resign
    }

    /// Signing again keeps the name and makes no split (`Envelope.name_resign`, `resign_no_split`); any change to
    /// what is signed changes the name (`Envelope.name_inj`, under BLAKE3).
    #[test]
    fn resign(e in any_envelope(), sig in proptest::collection::vec(any::<u8>(), 0..96), body in any_value()) {
        let again = Envelope { sig, ..e.clone() };
        prop_assert_eq!(again.name(), e.name());
        prop_assert!(!split(&e, &again));
        let other = Envelope { body: canonical(body), ..e.clone() };
        prop_assert_eq!(other.name() == e.name(), other.unsigned() == e.unsigned());
        prop_assert_eq!(split(&e, &other), other.unsigned() != e.unsigned());
    }

    /// A writer's log is a chain and holds no split (`chain_no_split`); two readers' chains of one log agree wherever
    /// both hold it, unless a split lies between them (`chains_agree`).
    #[test]
    fn chains(bodies in proptest::collection::vec(0u64..3, 1..8), other in proptest::collection::vec(0u64..3, 1..8)) {
        let id = LogId { doc: DocId(blake3(b"a Doc")), branch: "main".into(), writer: 1 };
        let write = |bodies: &[u64]| {
            let mut log = Log::new(id.clone());
            for &b in bodies {
                let e = Envelope {
                    doc: id.doc, branch: id.branch.clone(), writer: id.writer, seq: log.next_seq(), prev: log.head(),
                    deps: vec![], body: Value::Uint(b), signer: vec![7; 32], sig: vec![9; 64],
                };
                log.push(e).unwrap();
            }
            log
        };
        let (l1, l2) = (write(&bodies), write(&other));
        prop_assert!(is_chain(l1.envelopes()) && is_chain(l2.envelopes()));
        for a in l1.envelopes() {
            for b in l1.envelopes() {
                prop_assert!(!split(a, b));
            }
        }
        let split_between = l1.envelopes().iter().any(|a| l2.envelopes().iter().any(|b| split(a, b)));
        let agree = l1.envelopes().iter().zip(l2.envelopes()).all(|(a, b)| a == b);
        prop_assert!(split_between || agree);
        prop_assert_eq!(split_between, !agree);
        // a log refuses the other's envelopes past the first difference: they split it
        for e in l2.envelopes() {
            let mut l = l1.clone();
            match l.push(e.clone()) {
                Ok(()) => prop_assert!(l1.envelopes().contains(e) || e.seq == l1.next_seq()),
                Err(r) => prop_assert!(matches!(r, Refused::Split | Refused::NotNext | Refused::WrongPrev)),
            }
        }
    }
}
