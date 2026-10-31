//! Caps against the running Lean model (`aven-id-model`, `Aven.ID.CapsModel`): random chains, made by changing the
//! chains of `caps.json`, and random Docs of Core envelopes under a revocation go to the model, and every answer it
//! gives must be this crate's: the first rule a chain breaks, and every envelope's verdict.

mod common;

use std::cell::RefCell;

use aven_core::{Bound, DocId, Envelope, Hash, Value as V, blake3};
use aven_id::caps::{Branches, Cap, Doc, Form, Holder, Reads, Revocation, Sig, Verdict};
use common::caps::{Context, Names};
use common::model::Model;
use common::{hex, vectors};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use serde_json::{Value, json};

/// One change to a chain.
#[derive(Clone, Debug)]
enum Change {
    Drop(usize),
    Swap(usize, usize),
    Share(usize, bool),
    Form(usize),
    Holder(usize, usize),
    Signer(usize, usize),
    Issuer(usize, usize),
    Approval(usize, usize),
    Parent(usize, usize),
    DropLine(usize, usize),
    Borrow(usize, usize, usize),
    Loosen(usize, usize),
    Expires(usize, Option<u64>),
    Branches(usize, usize),
}

const VAULTS: [&str; 5] = ["alice", "bob", "maia-city", "aven", "garden"];
const SIGNERS: [&str; 5] = [
    "alice-peer",
    "alice-peer-light",
    "bob-peer-light",
    "aven-peer",
    "alice-owner",
];

fn change() -> impl Strategy<Value = Change> {
    let i = 0usize..6;
    prop_oneof![
        i.clone().prop_map(Change::Drop),
        (i.clone(), i.clone()).prop_map(|(a, b)| Change::Swap(a, b)),
        (i.clone(), any::<bool>()).prop_map(|(a, b)| Change::Share(a, b)),
        i.clone().prop_map(Change::Form),
        (i.clone(), 0usize..7).prop_map(|(a, b)| Change::Holder(a, b)),
        (i.clone(), 0usize..5).prop_map(|(a, b)| Change::Signer(a, b)),
        (i.clone(), 0usize..5).prop_map(|(a, b)| Change::Issuer(a, b)),
        (i.clone(), 0usize..3).prop_map(|(a, b)| Change::Approval(a, b)),
        (i.clone(), 0usize..7).prop_map(|(a, b)| Change::Parent(a, b)),
        (i.clone(), 0usize..3).prop_map(|(a, b)| Change::DropLine(a, b)),
        (i.clone(), i.clone(), 0usize..3).prop_map(|(a, b, c)| Change::Borrow(a, b, c)),
        (i.clone(), 0usize..3).prop_map(|(a, b)| Change::Loosen(a, b)),
        (i.clone(), proptest::option::of(0u64..200)).prop_map(|(a, b)| Change::Expires(a, b)),
        (i, 0usize..4).prop_map(|(a, b)| Change::Branches(a, b)),
    ]
}

fn apply(chain: &mut Vec<Cap>, garden: DocId, c: &Change) {
    let n = chain.len();
    if n == 0 {
        return;
    }
    match *c {
        Change::Drop(i) => {
            chain.remove(i % n);
        }
        Change::Swap(i, j) => chain.swap(i % n, j % n),
        Change::Share(i, up) => {
            let s = &mut chain[i % n].share;
            *s = if up { *s + 1 } else { s.saturating_sub(1) };
        }
        Change::Form(i) => {
            let f = &mut chain[i % n].form;
            *f = if *f == Form::Grant {
                Form::Attenuate
            } else {
                Form::Grant
            };
        }
        Change::Holder(i, h) => {
            chain[i % n].holder = match h {
                5 => Holder::Public,
                6 => Holder::Group(garden),
                v => Holder::Vault(VAULTS[v].into()),
            }
        }
        Change::Signer(i, s) => chain[i % n].signer = SIGNERS[s].into(),
        Change::Issuer(i, v) => chain[i % n].issuer = VAULTS[v].into(),
        Change::Approval(i, a) => {
            let c = &mut chain[i % n];
            c.approvals = match a {
                0 => vec![],
                1 => vec![Sig::new("alice-owner", c.id.clone())],
                _ => vec![Sig::new("bob-owner", "another")],
            }
        }
        Change::Parent(i, p) => {
            chain[i % n].parent = if p == 6 {
                None
            } else {
                Some(chain[p % n].id.clone())
            }
        }
        Change::DropLine(i, l) => {
            let g = &mut chain[i % n].grant;
            if !g.is_empty() {
                g.remove(l % g.len());
            }
        }
        Change::Borrow(i, j, l) => {
            let from = &chain[j % n].grant;
            if let Some(line) = from.get(l % from.len().max(1)).cloned() {
                chain[i % n].grant.push(line);
            }
        }
        Change::Loosen(i, l) => {
            let g = &mut chain[i % n].grant;
            let at = l % g.len().max(1);
            if let Some(line) = g.get_mut(at) {
                for (_, b) in &mut line.params {
                    *b = Bound::Any;
                }
            }
        }
        Change::Expires(i, e) => chain[i % n].conditions.expires = e,
        Change::Branches(i, b) => {
            chain[i % n].conditions.branches = match b {
                0 => Branches::Any,
                1 => Branches::Main,
                2 => Branches::Proposals,
                _ => Branches::One("fix-title".into()),
            }
        }
    }
}

#[test]
fn chains_are_the_models() {
    let all: Vec<Value> = vectors("caps.json")
        .into_iter()
        .filter(|v| v["input"].get("chain").is_some())
        .collect();
    let model = RefCell::new(Model::start());
    let mut runner = TestRunner::new(Config {
        cases: 600,
        ..Config::default()
    });
    let strategy = (0..all.len(), proptest::collection::vec(change(), 0..4));
    let broken = std::cell::Cell::new(0u32);
    runner
        .run(&strategy, |(at, changes)| {
            let v = &all[at];
            let names = Names::default();
            let ctx = Context::of(&names, &v["input"]["context"]);
            let mut chain: Vec<Cap> = v["input"]["chain"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| names.cap(c))
                .collect();
            let garden = ctx
                .groups
                .first()
                .map(|g| g.0)
                .unwrap_or(DocId(blake3(b"g")));
            for c in &changes {
                apply(&mut chain, garden, c);
            }
            let ours = ctx.with(|x| match x.chain_error(&chain) {
                None => json!({ "ok": true }),
                Some(e) => json!({ "ok": false, "error": names.error_json(&e) }),
            });
            if ours["ok"] == false {
                broken.set(broken.get() + 1);
            }
            let case = json!({
                "chain": chain.iter().map(|c| names.cap_json(c)).collect::<Vec<_>>(),
                "context": v["input"]["context"],
            });
            let theirs = model.borrow_mut().ask(&case);
            prop_assert_eq!(&ours, &theirs, "{} changed by {:?}", v["name"], changes);
            Ok(())
        })
        .unwrap();
    assert!(
        broken.get() > 100 && broken.get() < 590,
        "{} broken chains",
        broken.get()
    );
}

/// What caps reads of the generated envelopes: their body's `vault`, `caps` and `acks`, as `revocations.json`'s do.
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

fn verdict_json(v: &Verdict) -> Value {
    match v {
        Verdict::Counts => json!("counts"),
        Verdict::Revoked(r) => json!({ "revoked": r.text() }),
        Verdict::Waits(m) => json!({ "waits": m.iter().map(Hash::text).collect::<Vec<_>>() }),
    }
}

/// One generated envelope: its writer, the earlier ones it builds on, whether it writes under the cap, acks the
/// revocation, deletes, or names a dep nobody holds.
type Spec = (usize, Vec<usize>, bool, bool, bool, bool);

fn doc() -> impl Strategy<Value = (Vec<Spec>, usize, bool, Option<Vec<usize>>)> {
    let spec = (
        0usize..3,
        proptest::collection::vec(0usize..8, 0..3),
        any::<bool>(),
        proptest::bool::weighted(0.25),
        proptest::bool::weighted(0.1),
        proptest::bool::weighted(0.05),
    );
    (
        proptest::collection::vec(spec, 1..8),
        0usize..8,
        any::<bool>(),
        proptest::option::of(proptest::collection::vec(0usize..8, 0..3)),
    )
}

#[test]
fn revocations_are_the_models() {
    let model = RefCell::new(Model::start());
    let mut runner = TestRunner::new(Config {
        cases: 300,
        ..Config::default()
    });
    let notes = DocId(blake3(b"notes"));
    let cap = blake3(b"cap-a");
    let rev = blake3(b"rev");
    let (revoked, waits) = (std::cell::Cell::new(0u32), std::cell::Cell::new(0u32));
    runner
        .run(&doc(), |(specs, at, in_doc, kept)| {
            let writers = ["alice", "bob", "maia-city"];
            let mut doc: Vec<Envelope> = Vec::new();
            for (i, (w, deps, under, ack, delete, lost)) in specs.iter().enumerate() {
                let mut deps: Vec<Hash> = deps.iter().filter(|&&d| d < i).map(|&d| doc[d].name()).collect();
                deps.dedup();
                if *lost {
                    deps.push(blake3(b"lost"));
                }
                let mut body = vec![
                    ("acks".to_string(), V::Array(if *ack { vec![rev.value()] } else { vec![] })),
                    ("caps".to_string(), V::Array(if *under { vec![cap.value()] } else { vec![] })),
                    ("time".to_string(), V::Uint(0)),
                    ("label".to_string(), V::Text(format!("e{i}"))),
                    ("vault".to_string(), V::Text(writers[*w].into())),
                ];
                if *delete {
                    body.push(("delete".to_string(), V::Bool(true)));
                }
                doc.push(Envelope {
                    doc: notes,
                    branch: "main".into(),
                    writer: *w as u64 + 1,
                    seq: i as u64 + 1,
                    prev: None,
                    deps,
                    body: V::Map(body),
                    signer: writers[*w].as_bytes().to_vec(),
                    sig: vec![],
                });
            }
            let names: Vec<Hash> = doc.iter().map(Envelope::name).collect();
            let r = Revocation {
                id: rev,
                cap,
                envelope: in_doc.then(|| names[at % names.len()]),
                kept: if in_doc {
                    None
                } else {
                    kept.map(|k| k.iter().map(|&i| names[i % names.len()]).collect())
                },
            };
            let held = Doc::new(&doc);
            let entries: Vec<Value> = doc
                .iter()
                .map(|e| {
                    json!({
                        "label": match field(e, "label") { Some(V::Text(t)) => t.clone(), _ => String::new() },
                        "name": e.name().text(), "vault": Body.vault(e),
                        "caps": Body.caps(e).iter().map(Hash::text).collect::<Vec<_>>(),
                        "acks": Body.acks(e).iter().map(Hash::text).collect::<Vec<_>>(), "time": 0,
                        "envelope": {
                            "doc": e.doc.text(), "branch": e.branch, "writer": e.writer, "seq": e.seq,
                            "prev": e.prev.map(|p| p.text()),
                            "deps": e.deps.iter().map(Hash::text).collect::<Vec<_>>(),
                            "body": common::caps::value_json(&e.body), "signer": hex(&e.signer), "sig": hex(&e.sig),
                        },
                    })
                })
                .collect();
            let revs = json!([{
                "id": r.id.text(), "cap": r.cap.text(), "envelope": r.envelope.map(|x| x.text()),
                "kept": r.kept.as_ref().map(|k| k.iter().map(Hash::text).collect::<Vec<_>>()),
            }]);
            let mut ours = serde_json::Map::new();
            for e in &doc {
                let v = held.verdict(&Body, std::slice::from_ref(&r), e);
                match v {
                    Verdict::Revoked(_) => revoked.set(revoked.get() + 1),
                    Verdict::Waits(_) => waits.set(waits.get() + 1),
                    Verdict::Counts => {}
                }
                ours.insert(e.name().text(), verdict_json(&v));
            }
            let theirs = model
                .borrow_mut()
                .ask(&json!({ "doc": entries, "revocations": revs }));
            prop_assert_eq!(&Value::Object(ours), &theirs);
            // and each survives its vault's deletes as the model says
            let e = &doc[at % doc.len()];
            let is_delete = |x: &Envelope| field(x, "delete") == Some(&V::Bool(true));
            let by_owner = |x: &Envelope| Body.vault(x) == "alice";
            let ours = json!({ "survives": held.survives(is_delete, by_owner, e) });
            let theirs = model.borrow_mut().ask(&json!({
                "doc": entries, "revocations": [], "owner": "alice", "envelope": e.name().text(),
            }));
            prop_assert_eq!(ours, theirs);
            Ok(())
        })
        .unwrap();
    assert!(
        revoked.get() > 50 && waits.get() > 10,
        "{} revoked, {} waiting",
        revoked.get(),
        waits.get()
    );
}

/// One change to a reading of `authorized.json`.
#[derive(Clone, Debug)]
enum Twist {
    Signer(usize),
    Branch(usize),
    Doc(usize),
    DropCall(usize),
    BorrowCall(usize, usize),
    Param(usize, usize),
    Chain(usize),
    Actor(bool),
    Grants(usize, usize),
    DeviceBranches(usize, usize),
    Host(usize),
}

fn twist() -> impl Strategy<Value = Twist> {
    let i = 0usize..8;
    prop_oneof![
        i.clone().prop_map(Twist::Signer),
        (0usize..3).prop_map(Twist::Branch),
        (0usize..10).prop_map(Twist::Doc),
        i.clone().prop_map(Twist::DropCall),
        (0usize..15, i.clone()).prop_map(|(a, b)| Twist::BorrowCall(a, b)),
        (i.clone(), 0usize..4).prop_map(|(a, b)| Twist::Param(a, b)),
        (0usize..3).prop_map(Twist::Chain),
        any::<bool>().prop_map(Twist::Actor),
        (i.clone(), 0usize..3).prop_map(|(a, b)| Twist::Grants(a, b)),
        (i.clone(), 0usize..4).prop_map(|(a, b)| Twist::DeviceBranches(a, b)),
        i.prop_map(Twist::Host),
    ]
}

fn twisted(all: &[Value], at: usize, twists: &[Twist]) -> Value {
    let mut x = all[at]["input"].clone();
    for t in twists {
        let keys: Vec<Value> = x["keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k["key"].clone())
            .collect();
        let docs: Vec<Value> = x["context"]["docs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["id"].clone())
            .collect();
        let n_calls = x["calls"].as_array().unwrap().len();
        let n_dc = x["deviceCaps"].as_array().unwrap().len();
        match *t {
            Twist::Signer(k) => {
                x["envelope"]["signer"] = keys.get(k).cloned().unwrap_or(json!(hex(b"mallory")));
            }
            Twist::Branch(b) => x["envelope"]["branch"] = json!(["main", "fix-title", "other"][b]),
            Twist::Doc(d) => {
                x["envelope"]["doc"] = docs
                    .get(d)
                    .cloned()
                    .unwrap_or(json!(DocId(blake3(b"unknown")).text()));
            }
            Twist::DropCall(c) if n_calls > 0 => {
                x["calls"].as_array_mut().unwrap().remove(c % n_calls);
            }
            Twist::BorrowCall(from, c) => {
                let other = &all[from % all.len()]["input"]["calls"];
                if let Some(call) = other
                    .as_array()
                    .unwrap()
                    .get(c % other.as_array().unwrap().len().max(1))
                {
                    x["calls"].as_array_mut().unwrap().push(call.clone());
                }
            }
            Twist::Param(c, p) if n_calls > 0 => {
                let call = &mut x["calls"][c % n_calls];
                call["params"]["type"] = match p {
                    0 => json!({ "bytes": hex(b"tasks") }),
                    1 => json!("notes"),
                    2 => json!([{ "bytes": hex(b"tasks") }]),
                    _ => Value::Null,
                };
            }
            Twist::Chain(0) => x["chain"] = json!([]),
            Twist::Chain(1) => {
                x["chain"].as_array_mut().unwrap().pop();
            }
            Twist::Chain(_) => {}
            Twist::Actor(a) => {
                x["actor"] = if a {
                    json!(DocId(blake3(b"actor")).text())
                } else {
                    Value::Null
                };
            }
            Twist::Grants(d, g) if n_dc > 0 => {
                let dc = &mut x["deviceCaps"][d % n_dc];
                match g {
                    0 => dc["grants"] = Value::Null,
                    1 => dc["grants"] = json!([]),
                    _ => {
                        if let Some(gs) = dc["grants"].as_array_mut() {
                            gs.pop();
                        }
                    }
                }
            }
            Twist::DeviceBranches(d, b) if n_dc > 0 => {
                x["deviceCaps"][d % n_dc]["branches"] = match b {
                    0 => json!("any"),
                    1 => json!("main"),
                    2 => json!("proposals"),
                    _ => json!({ "branch": "fix-title" }),
                };
            }
            Twist::Host(d) if n_dc > 0 => {
                let h = &mut x["deviceCaps"][d % n_dc]["host"];
                *h = json!(!h.as_bool().unwrap());
            }
            _ => {}
        }
    }
    x
}

/// The reader's verdict against the running model: readings of `authorized.json` changed at random (another signer,
/// branch or Doc, calls dropped or borrowed or their bounds' values changed, the chain cut, the actor named or not,
/// device caps widened, narrowed or made a host's) get the model's answer, part by part.
#[test]
fn verdicts_are_the_models_on_random_readings() {
    let all = vectors("authorized.json");
    let model = RefCell::new(Model::start());
    let mut runner = TestRunner::new(Config {
        cases: 500,
        ..Config::default()
    });
    let paths = RefCell::new(std::collections::BTreeMap::<String, u32>::new());
    runner
        .run(
            &(0..all.len(), proptest::collection::vec(twist(), 0..4)),
            |(at, twists)| {
                let input = twisted(&all, at, &twists);
                let ours = common::caps::judge(&input);
                let theirs = model.borrow_mut().ask(&input);
                prop_assert_eq!(
                    &ours,
                    &theirs,
                    "{} twisted by {:?}",
                    all[at]["name"],
                    twists
                );
                let path = format!(
                    "{}{}",
                    ours["path"].as_str().unwrap(),
                    ours.get("refusal")
                        .map_or(String::new(), |r| format!(" {r}"))
                );
                *paths.borrow_mut().entry(path).or_default() += 1;
                Ok(())
            },
        )
        .unwrap();
    let paths = paths.into_inner();
    eprintln!("paths: {paths:?}");
    assert!(paths.len() >= 5, "{paths:?}");
}
