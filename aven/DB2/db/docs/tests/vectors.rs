//! The docs layer against Lean's vectors (README rule 10), byte for byte: `db/spec/vectors/writers.json`,
//! `envelopes.json`, `logs.json`, `counts.json` and `fit.json`. The envelopes the vectors name are rebuilt exactly as
//! `db/spec/Vectors.lean` builds them (`opEnv`), and their names checked first, so every verdict is on the same bytes.

use std::collections::BTreeMap;

use aven_core::{DocId, Envelope, Hash, Held, Value, blake3};
use aven_db_docs::fit::{Write, latest};
use aven_db_docs::schema::{Kind, Schema};
use aven_db_docs::{OpId, ops_agree, writer, writer_derived, writer_input};
use serde_json::Value as Json;

fn vectors(file: &str) -> Vec<Json> {
    let path = format!("{}/../spec/vectors/{file}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let Json::Array(vs) = serde_json::from_str(&text).unwrap() else {
        panic!("{path}: not an array")
    };
    assert!(!vs.is_empty(), "{path}: no vectors");
    vs
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

fn s(j: &Json) -> &str {
    j.as_str().unwrap()
}

#[test]
fn writers() {
    for v in vectors("writers.json") {
        let (i, x) = (&v["input"], &v["expected"]);
        let device = unhex(s(&i["device"]));
        let doc = DocId::parse(s(&i["doc"])).unwrap();
        let (branch, generation) = (s(&i["branch"]), i["generation"].as_u64().unwrap());
        let name = s(&v["name"]);
        assert_eq!(
            hex(&writer_input(&device, &doc, branch, generation)),
            s(&x["input"]),
            "{name}: input"
        );
        assert_eq!(
            hex(&writer_derived(&device, &doc, branch, generation)),
            s(&x["derived"]),
            "{name}: derived"
        );
        assert_eq!(
            writer(&device, &doc, branch, generation).to_string(),
            s(&x["writer"]),
            "{name}: writer"
        );
    }
}

/// `opEnv`: an envelope of the vectors' one Doc, its body `{post}`, signer `07…`, signature `09…`.
fn op_env(writer: u64, seq: u64, prev: Option<Hash>, deps: Vec<Hash>, post: &str) -> Envelope {
    Envelope {
        doc: DocId(blake3(b"a Doc's genesis")),
        branch: "main".into(),
        writer,
        seq,
        prev,
        deps,
        body: Value::Map(vec![("post".into(), Value::Text(post.into()))]),
        signer: vec![7; 32],
        sig: vec![9; 64],
    }
}

fn op_pair(j: &Json) -> OpId {
    (j[0].as_u64().unwrap(), j[1].as_u64().unwrap())
}

#[test]
fn envelopes() {
    let a1 = op_env(1, 1, None, vec![], "first");
    let b1 = op_env(2, 1, None, vec![], "another writer's first");
    let a2 = op_env(1, 2, Some(a1.name()), vec![b1.name()], "builds on both");
    let a2gone = op_env(
        1,
        2,
        Some(a1.name()),
        vec![blake3(b"nothing held")],
        "names what isn't held",
    );
    let known: BTreeMap<String, &Envelope> = [&a1, &b1, &a2, &a2gone]
        .into_iter()
        .map(|e| (e.name().text(), e))
        .collect();
    for v in vectors("envelopes.json") {
        let (i, name) = (&v["input"], s(&v["name"]));
        let env = &i["envelope"];
        let e = known
            .get(s(&env["name"]))
            .unwrap_or_else(|| panic!("{name}: an envelope the Lean doesn't build"));
        let named: Vec<Hash> = e.prev.iter().chain(&e.deps).copied().collect();
        let vec_named: Vec<String> = env["named"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| s(n).to_string())
            .collect();
        assert_eq!(
            named.iter().map(Hash::text).collect::<Vec<_>>(),
            vec_named,
            "{name}: named"
        );
        let held: Vec<(Hash, OpId)> = i["held"]
            .as_array()
            .unwrap()
            .iter()
            .map(|h| {
                assert!(known.contains_key(s(&h["name"])), "{name}: held");
                (Hash::parse(s(&h["name"])).unwrap(), op_pair(&h["last"]))
            })
            .collect();
        let carried: Vec<OpId> = i["deps"].as_array().unwrap().iter().map(op_pair).collect();
        let got = ops_agree(&held, op_pair(&env["last"]), &named, &carried);
        assert_eq!(got.text(), s(&v["expected"]), "{name}");
    }
}

/// The envelopes of `logs.json` and `counts.json`, by label, as `Vectors.lean` builds them.
fn labelled() -> Vec<(&'static str, Envelope)> {
    let x1 = op_env(1, 1, None, vec![], "first");
    let x2 = op_env(1, 2, Some(x1.name()), vec![], "second");
    let x2c = op_env(
        1,
        2,
        Some(x1.name()),
        vec![],
        "a copy of the second says otherwise",
    );
    let y1 = op_env(2, 1, None, vec![x2.name()], "builds on the second");
    let z1 = op_env(3, 1, None, vec![x2c.name()], "builds on the copy");
    let x3 = op_env(1, 3, Some(x2.name()), vec![], "the stuck log goes on");
    let w1 = op_env(4, 1, None, vec![y1.name()], "builds on the other writer");
    vec![
        ("x1", x1),
        ("x2", x2),
        ("x2'", x2c),
        ("y1", y1),
        ("z1", z1),
        ("x3", x3),
        ("w1", w1),
    ]
}

/// Checks each vector envelope's summary against the one rebuilt: its name, writer, seq, prev and deps.
fn check_summary(j: &Json, by: &BTreeMap<&str, Envelope>, case: &str) {
    let label = s(&j["label"]);
    let e = &by[label];
    assert_eq!(e.name().text(), s(&j["name"]), "{case}: {label}'s name");
    assert_eq!(e.writer, j["writer"].as_u64().unwrap(), "{case}: {label}");
    assert_eq!(e.seq, j["seq"].as_u64().unwrap(), "{case}: {label}");
    let label_of = |h: &Hash| {
        by.iter()
            .find(|(_, x)| x.name() == *h)
            .map(|(l, _)| *l)
            .unwrap()
    };
    assert_eq!(
        e.prev.as_ref().map(label_of),
        j["prev"].as_str(),
        "{case}: {label}'s prev"
    );
    let deps: Vec<&str> = e.deps.iter().map(label_of).collect();
    let want: Vec<&str> = j["deps"].as_array().unwrap().iter().map(s).collect();
    assert_eq!(deps, want, "{case}: {label}'s deps");
}

#[test]
fn logs() {
    let by: BTreeMap<&str, Envelope> = labelled().into_iter().collect();
    for v in vectors("logs.json") {
        let case = s(&v["name"]);
        for j in v["input"]["envelopes"].as_array().unwrap() {
            check_summary(j, &by, case);
        }
        for reader in ["readerA", "readerB"] {
            let held: Vec<Envelope> = v["input"][reader]
                .as_array()
                .unwrap()
                .iter()
                .map(|l| by[s(l)].clone())
                .collect();
            let h = Held::new(&held);
            for (label, want) in v["expected"][reader].as_object().unwrap() {
                let e = &by[label.as_str()];
                assert_eq!(
                    h.counts(e, |_| true),
                    want["counts"].as_bool().unwrap(),
                    "{case}: {reader} {label} counts"
                );
                let split = held.iter().any(|y| aven_core::split(e, y));
                assert_eq!(
                    split,
                    want["split"].as_bool().unwrap(),
                    "{case}: {reader} {label} split"
                );
            }
        }
    }
}

#[test]
fn counts() {
    let by: BTreeMap<&str, Envelope> = labelled().into_iter().collect();
    for v in vectors("counts.json") {
        let case = s(&v["name"]);
        let mut held = Vec::new();
        let mut ok: BTreeMap<Hash, bool> = BTreeMap::new();
        for j in v["input"]["envelopes"].as_array().unwrap() {
            check_summary(&j["envelope"], &by, case);
            let e = by[s(&j["envelope"]["label"])].clone();
            ok.insert(
                e.name(),
                j["fit"].as_bool().unwrap() && j["authorized"].as_bool().unwrap(),
            );
            held.push(e);
        }
        let h = Held::new(&held);
        let counted: Vec<&Envelope> = held
            .iter()
            .filter(|e| h.counts(e, |x| ok[&x.name()]))
            .collect();
        let labels: Vec<&str> = counted
            .iter()
            .map(|e| *by.iter().find(|(_, x)| x == e).unwrap().0)
            .collect();
        let want: Vec<&str> = v["expected"]["counts"]
            .as_array()
            .unwrap()
            .iter()
            .map(s)
            .collect();
        assert_eq!(labels, want, "{case}");
        // the live state: the toy CRDT's sum of sequence numbers over what counts
        let live: u64 = counted.iter().map(|e| e.seq).sum();
        assert_eq!(
            live,
            v["expected"]["live"].as_u64().unwrap(),
            "{case}: live"
        );
    }
}

#[test]
fn fit() {
    // the vectors' rules as schemas: `v1` allows totals up to 100, `v2` up to 1000
    let schema = |t: &str, max: u64| Schema {
        title: t.into(),
        fields: vec![("total".into(), Kind::Uint(max), false)],
        closed: true,
    };
    let rules: BTreeMap<&str, Schema> = [("v1", schema("v1", 100)), ("v2", schema("v2", 1000))]
        .into_iter()
        .collect();
    for v in vectors("fit.json") {
        let case = s(&v["name"]);
        let es = v["input"]["envelopes"].as_array().unwrap();
        let fits: Vec<bool> =
            es.iter()
                .map(|e| {
                    let sc = &rules[s(&e["schema"])];
                    e["writes"].as_array().unwrap().iter().all(|w| {
                        sc.allows(s(&w["field"]), &Value::Uint(w["value"].as_u64().unwrap()))
                    })
                })
                .collect();
        let want: Vec<bool> = v["expected"]["fits"]
            .as_array()
            .unwrap()
            .iter()
            .map(|b| b.as_bool().unwrap())
            .collect();
        assert_eq!(fits, want, "{case}: fits");
        // only what fits merges; the later write wins
        let writes: Vec<Write<(&str, u64)>> = es
            .iter()
            .zip(&fits)
            .filter(|(_, f)| **f)
            .flat_map(|(e, _)| {
                e["writes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|w| s(&w["field"]) == "total")
                    .map(|w| Write {
                        stamp: w["stamp"].as_u64().unwrap(),
                        value: (s(&e["schema"]), w["value"].as_u64().unwrap()),
                    })
            })
            .collect();
        let total = &v["expected"]["total"];
        let w = latest(&writes).expect("a total");
        assert_eq!(w.value.1, total["value"].as_u64().unwrap(), "{case}: value");
        assert_eq!(w.value.0, s(&total["schema"]), "{case}: schema");
        assert_eq!(
            rules[w.value.0].allows("total", &Value::Uint(w.value.1)),
            total["fits"].as_bool().unwrap(),
            "{case}"
        );
    }
}
