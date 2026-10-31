//! Envelopes, logs, splits and the past against Lean (README rule 10): `spec/vectors/envelopes.json` and `logs.json`
//! byte for byte, and on random envelopes the Lean definitions themselves, transcribed below as they read
//! (`Aven.Core.Log`, `Aven.Core.Past`): `pastNames` in its rounds, `Before` as its two rules, `Reaches`, `Split`,
//! `Discounted`, `Counts` and `Version.holds`. The crate's own walk must give their answers, and the theorems
//! (`split_final`, `counts_past`, `resign_no_split`, `chain_no_split`, `Version.holds_mono`) must hold of it.

use aven_core::limits::{MAX_DEPS, MAX_ENVELOPE_BYTES};
use aven_core::past::{in_past, past};
use aven_core::{
    DocId, ENVELOPE_LABEL, Envelope, Hash, Held, Log, LogId, Parents, Refused, Signed, Value,
    blake3, decode, encode, is_chain, signing_bytes, split,
};
use proptest::prelude::*;
use serde_json::Value as Json;

fn vectors(file: &str) -> Vec<Json> {
    let path = format!("{}/spec/vectors/{file}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// A body from its readable form (`Aven.Core.Json`); the vectors' bodies are maps of text and integers.
fn value(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Uint(n.as_u64().unwrap()),
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(xs) => Value::Array(xs.iter().map(value).collect()),
        Json::Object(o) => Value::Map(o.iter().map(|(k, v)| (k.clone(), value(v))).collect()),
    }
}

/// An envelope from its readable form (`Envelope.json` in `Vectors.lean`).
fn envelope(j: &Json) -> Envelope {
    Envelope {
        doc: DocId::parse(j["doc"].as_str().unwrap()).unwrap(),
        branch: j["branch"].as_str().unwrap().into(),
        writer: j["writer"].as_u64().unwrap(),
        seq: j["seq"].as_u64().unwrap(),
        prev: j["prev"].as_str().map(|h| Hash::parse(h).unwrap()),
        deps: j["deps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| Hash::parse(h.as_str().unwrap()).unwrap())
            .collect(),
        body: value(&j["body"]),
        signer: unhex(j["signer"].as_str().unwrap()),
        sig: unhex(j["sig"].as_str().unwrap()),
    }
}

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
    assert!(n >= 2);
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
    assert!(is_chain(&es));
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

// ---- Lean's definitions, transcribed as they read ----

/// `dedup`: each name once, its last coming kept.
fn dedup(l: &[Hash]) -> Vec<Hash> {
    match l.split_first() {
        None => vec![],
        Some((x, xs)) => {
            let d = dedup(xs);
            if d.contains(x) {
                d
            } else {
                [vec![*x], d].concat()
            }
        }
    }
}

/// `fresh`: names of things of `S` not yet known, built on by one already known.
fn fresh(s: &[Envelope], k: &[Hash]) -> Vec<Hash> {
    let found: Vec<Hash> = s
        .iter()
        .filter(|c| {
            !k.contains(&c.name())
                && s.iter()
                    .any(|b| k.contains(&b.name()) && b.parents().contains(&c.name()))
        })
        .map(Envelope::name)
        .collect();
    dedup(&found)
}

/// `pastNames S a n`, and `past S a = pastNames S a (S.length + 1)`.
fn lean_past(s: &[Envelope], a: &Envelope) -> Vec<Hash> {
    let first: Vec<Hash> = s
        .iter()
        .filter(|b| a.parents().contains(&b.name()))
        .map(Envelope::name)
        .collect();
    let mut names = dedup(&first);
    for _ in 0..s.len() + 1 {
        let more = fresh(s, &names);
        names.extend(more);
    }
    names
}

/// `Before S a`: the indices of `S` its two rules reach, `tip` then `step` until nothing is added.
fn lean_before(s: &[Envelope], a: &Envelope) -> Vec<bool> {
    let mut b: Vec<bool> = s.iter().map(|x| a.parents().contains(&x.name())).collect();
    loop {
        let next: Vec<bool> = s
            .iter()
            .enumerate()
            .map(|(i, c)| {
                b[i] || s
                    .iter()
                    .zip(&b)
                    .any(|(x, &bx)| bx && x.parents().contains(&c.name()))
            })
            .collect();
        if next == b {
            return b;
        }
        b = next;
    }
}

/// `Reaches S e`: `e` itself (`refl`) and what is `Before` it (`reaches_iff`).
fn lean_reaches(s: &[Envelope], e: &Envelope) -> Vec<Envelope> {
    let mut r = vec![e.clone()];
    r.extend(
        s.iter()
            .zip(lean_before(s, e))
            .filter(|(_, b)| *b)
            .map(|(x, _)| x.clone()),
    );
    r
}

/// `Split`: one log, one place, two names.
fn lean_split(a: &Envelope, b: &Envelope) -> bool {
    a.doc == b.doc
        && a.branch == b.branch
        && a.writer == b.writer
        && a.seq == b.seq
        && a.name() != b.name()
}

fn lean_discounted(s: &[Envelope], e: &Envelope) -> bool {
    lean_reaches(s, e)
        .iter()
        .any(|x| s.iter().any(|y| lean_split(x, y)))
}

fn lean_counts(s: &[Envelope], e: &Envelope, ok: impl Fn(&Envelope) -> bool) -> bool {
    lean_reaches(s, e)
        .iter()
        .all(|x| ok(x) && s.iter().all(|y| !lean_split(x, y)))
}

/// `Version.holds S v e`: a tip of `v` in `S` reaches `e`.
fn lean_holds(s: &[Envelope], v: &[Hash], e: &Envelope) -> bool {
    s.iter()
        .any(|t| v.contains(&t.name()) && lean_reaches(s, t).contains(e))
}

// ---- random envelopes ----

/// A small world where splits and shared parents are common: two Docs, two writers, three places, bodies from four.
/// Each envelope names earlier ones (or a name nobody holds) as its prev and deps.
#[derive(Clone, Debug)]
struct Draw {
    doc: u8,
    writer: u64,
    seq: u64,
    prev: Option<u8>,
    deps: Vec<u8>,
    body: u64,
}

fn draw() -> impl Strategy<Value = Draw> {
    (
        0u8..2,
        0u64..2,
        1u64..4,
        proptest::option::of(any::<u8>()),
        proptest::collection::vec(any::<u8>(), 0..3),
        0u64..4,
    )
        .prop_map(|(doc, writer, seq, prev, deps, body)| Draw {
            doc,
            writer,
            seq,
            prev,
            deps,
            body,
        })
}

fn build(draws: &[Draw]) -> Vec<Envelope> {
    let mut out: Vec<Envelope> = vec![];
    let pick = |out: &Vec<Envelope>, i: u8| {
        if out.is_empty() || i as usize % (out.len() + 1) == out.len() {
            blake3(&[i]) // a name nobody holds
        } else {
            out[i as usize % (out.len() + 1)].name()
        }
    };
    for d in draws {
        let e = Envelope {
            doc: DocId(blake3(&[d.doc])),
            branch: "main".into(),
            writer: d.writer,
            seq: d.seq,
            prev: d.prev.map(|i| pick(&out, i)),
            deps: d.deps.iter().map(|&i| pick(&out, i)).collect(),
            body: Value::Uint(d.body),
            signer: vec![7; 32],
            sig: vec![9; 64],
        };
        out.push(e);
    }
    out
}

/// Envelopes, and which of them a reader holds: `S` a subset of `S'`, all of them.
fn world() -> impl Strategy<Value = (Vec<Envelope>, Vec<bool>)> {
    proptest::collection::vec((draw(), any::<bool>()), 1..14).prop_map(|ds| {
        let (draws, held): (Vec<Draw>, Vec<bool>) = ds.into_iter().unzip();
        (build(&draws), held)
    })
}

fn subset(all: &[Envelope], held: &[bool]) -> Vec<Envelope> {
    all.iter()
        .zip(held)
        .filter(|(_, h)| **h)
        .map(|(e, _)| e.clone())
        .collect()
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

    /// The walk finds exactly Lean's past (`found_iff`), and decides `Before` for what is held (`inPast_iff`).
    #[test]
    fn past_is_leans((all, held) in world()) {
        let s = subset(&all, &held);
        for a in &all {
            let ours = past(Envelope::name, &s, a);
            let lean: std::collections::BTreeSet<Hash> = lean_past(&s, a).into_iter().collect();
            prop_assert_eq!(&ours, &lean);
            prop_assert_eq!(Held::new(&s).past(a), ours);
            for (b, before) in s.iter().zip(lean_before(&s, a)) {
                prop_assert_eq!(in_past(Envelope::name, &s, a, b), before);
            }
        }
    }

    /// Splits, discounting and counting are Lean's, and splits are final: what is discounted among `S` never counts
    /// among any `S'` that holds more (`split_final`). What counts builds on what counts (`counts_past`).
    #[test]
    fn splits_are_final((all, held) in world(), bad in any::<u8>()) {
        let s = subset(&all, &held);
        let (h, h_all) = (Held::new(&s), Held::new(&all));
        let ok = |x: &Envelope| x.body != Value::Uint(u64::from(bad % 8));
        for e in &all {
            prop_assert_eq!(h.discounted(e), lean_discounted(&s, e));
            prop_assert_eq!(h.counts(e, ok), lean_counts(&s, e, ok));
            prop_assert_eq!(h_all.counts(e, ok), lean_counts(&all, e, ok));
            if h.discounted(e) {
                prop_assert!(h_all.discounted(e));
                prop_assert!(!h_all.counts(e, |_| true));
            }
            if h.counts(e, ok) {
                for x in lean_reaches(&s, e) {
                    prop_assert!(h.counts(&x, ok));
                }
            }
        }
        for a in &all {
            for b in &all {
                prop_assert_eq!(split(a, b), lean_split(a, b));
            }
        }
    }

    /// A version holds what Lean's does, and more as more arrives (`Version.holds_mono`).
    #[test]
    fn versions((all, held) in world(), tips in proptest::collection::vec(any::<u8>(), 0..3)) {
        let s = subset(&all, &held);
        let v: Vec<Hash> = tips.iter().map(|&i| all[i as usize % all.len()].name()).collect();
        let (h, h_all) = (Held::new(&s), Held::new(&all));
        for e in &all {
            prop_assert_eq!(h.holds(&v, e), lean_holds(&s, &v, e));
            if h.holds(&v, e) {
                prop_assert!(h_all.holds(&v, e));
            }
        }
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
