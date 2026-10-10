//! The Lean model's ops vectors (`avendb/spec/vectors/ops.json`, written by `lake exe vectors`, checked by every
//! `lake build`), and one property per theorem of `spec/AvenDB/Ops.lean` on random records. Each diff must make the
//! model's changes (in any order: no two touch one place) and, applied, the record after (O1). Each run of ops must
//! end on the model's record, or be refused where the model refuses it, and change nothing its ops don't name (O2).
//! Each query must pick entries by the model's selector (`Where::plan`), which picks no less than the query (O3), and
//! hold of exactly the model's entries. A type or a tag is a number in the model, and its digits here; a vault or an
//! entry is its number in 64 hex digits.

use avendb::id::{EntryId, VaultId};
use avendb::ops::{diff, run_all, Change, Flat, Op, Record, Where};
use avendb::slice::{Attrs, Sym};
use serde_json::{json, Value};

const OPS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/ops.json");

fn vectors() -> Value {
    let text = std::fs::read_to_string(OPS).expect("the ops vectors: run `lake exe vectors` in avendb/spec");
    serde_json::from_str(&text).expect("the ops vectors are JSON")
}

fn list(v: &Value) -> &[Value] {
    v.as_array().unwrap_or_else(|| panic!("a list, not {v}"))
}

fn record(v: &Value) -> Record {
    v.as_object().unwrap_or_else(|| panic!("a record, not {v}")).clone()
}

/// The changes, each once, in any order.
fn same_changes(got: &[Change], want: &[Change]) -> bool {
    got.len() == want.len() && want.iter().all(|c| got.contains(c))
}

#[test]
fn each_diff_makes_the_models_changes() {
    let v = vectors();
    for case in list(&v["diffs"]) {
        let (r, s) = (record(&case["before"]), record(&case["after"]));
        let want: Vec<Change> = list(&case["changes"]).iter().map(|c| Change::of_json(c).expect("a change")).collect();
        let got = diff(&r, &s);
        assert!(same_changes(&got, &want), "{case}\nmade {:?}", got.iter().map(Change::to_json).collect::<Vec<_>>());
        let mut flat = Flat::of(&r);
        flat.apply(&got);
        assert_eq!(flat.record(), s, "{case}");
    }
}

#[test]
fn each_run_ends_where_the_models_does() {
    let v = vectors();
    for case in list(&v["runs"]) {
        let before = record(&case["before"]);
        let op = |o: &Value| Op::of_json(o).unwrap_or_else(|why| panic!("{o}: {why}"));
        let ops: Vec<Op> = list(&case["ops"]).iter().map(op).collect();
        for op in &ops {
            assert_eq!(Op::of_json(&op.to_json()).as_ref(), Ok(op), "{case}");
        }
        let after = run_all(&before, &ops);
        assert_eq!(after.as_ref(), case["after"].as_object(), "{case}");
        if let Some(after) = after {
            for c in diff(&before, &after) {
                let named = ops.iter().any(|op| op.loc().covers(&c));
                assert!(named, "{case}: {} names none of {}", c.to_json(), case["ops"]);
            }
        }
    }
}

#[test]
fn each_query_picks_and_holds_as_the_models() {
    let v = vectors();
    let entries: Vec<(Attrs, Record)> = list(&v["entries"])
        .iter()
        .map(|e| {
            let text = |k: &str| e[k].as_str().unwrap_or_else(|| panic!("{k} of {e}"));
            let attrs = Attrs {
                ty: Sym::new(text("type")),
                author: VaultId::from_hex(text("author")).expect("a vault id"),
                entry: EntryId::from_hex(text("entry")).expect("an entry id"),
                created: e["created"].as_u64().expect("created"),
                tags: list(&e["tags"]).iter().map(|t| Sym::new(t.as_str().expect("a tag"))).collect(),
            };
            (attrs, record(&e["record"]))
        })
        .collect();
    for case in list(&v["queries"]) {
        let w = Where::of_json(&case["where"]).unwrap_or_else(|why| panic!("{case}: {why}"));
        assert_eq!(w.to_json(), case["where"], "{case}");
        let plan = w.plan();
        assert_eq!(plan.to_json(), case["plan"], "{case}");
        let holds = |i: &usize| w.holds(&entries[*i].0, &entries[*i].1);
        let rows: Vec<Value> = (0..entries.len()).filter(holds).map(Value::from).collect();
        assert_eq!(rows, *list(&case["rows"]), "{case}");
        for (a, r) in &entries {
            assert!(!w.holds(a, r) || plan.matches(a), "{case}: the plan misses {}", a.entry.to_hex());
        }
    }
}

/// xorshift64*: small and deterministic, so a failing seed can be replayed.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn pick<T: Clone>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len())].clone()
    }
}

const FIELDS: [&str; 4] = ["title", "blocks", "tags", "n"];
const CELLS: [&str; 4] = ["text", "type", "level", "id"];

fn scalar(rng: &mut Rng) -> Value {
    rng.pick(&[json!("a"), json!("B"), json!(""), json!(1), json!(-2), json!(true), json!(null), json!(1.5)])
}

/// A row with id 1 to 4: a second row may share its id, as when two devices add one at once.
fn row(rng: &mut Rng) -> Value {
    let mut r = Record::new();
    r.insert("id".into(), (rng.below(4) as i64 + 1).into());
    for g in &CELLS[..3] {
        if rng.below(2) == 0 {
            r.insert(g.to_string(), scalar(rng));
        }
    }
    Value::Object(r)
}

fn value(rng: &mut Rng) -> Value {
    match rng.below(4) {
        0 => scalar(rng),
        1 => (0..rng.below(3)).map(|_| scalar(rng)).collect(),
        _ => (0..rng.below(4)).map(|_| row(rng)).collect(),
    }
}

fn random_record(rng: &mut Rng) -> Record {
    let mut r = Record::new();
    for f in FIELDS {
        if rng.below(3) != 0 {
            r.insert(f.to_string(), value(rng));
        }
    }
    r
}

/// An op on fields and rows that are there or not, ids that are there or not: the run may refuse it.
fn random_op(rng: &mut Rng, r: &Record) -> Value {
    let f = rng.pick(&FIELDS);
    let rows = r.get(f).and_then(Value::as_array).into_iter().flatten();
    let ids: Vec<i64> = rows.filter_map(|x| x["id"].as_i64()).collect();
    let id = if ids.is_empty() || rng.below(4) == 0 { rng.below(5) as i64 + 1 } else { rng.pick(&ids) };
    let g = rng.pick(&CELLS);
    let mut op = match rng.below(11) {
        0 => json!({ "op": "set", "path": [], "value": random_record(rng) }),
        1 => json!({ "op": "set", "path": [f], "value": value(rng) }),
        2 => json!({ "op": "unset", "path": [f] }),
        3 => json!({ "op": "set", "path": [f, { "id": id }], "value": { "text": scalar(rng) } }),
        4 => json!({ "op": "set", "path": [f, { "id": id }, g], "value": scalar(rng) }),
        5 => json!({ "op": "unset", "path": [f, { "id": id }, g] }),
        6 => json!({ "op": "insert", "path": [f], "value": row(rng) }),
        7 => json!({ "op": "remove", "path": [f, { "id": id }] }),
        8 => json!({ "op": "move", "path": [f, { "id": id }], "to": rng.below(4) }),
        9 => json!({ "op": "insert", "path": [f], "value": scalar(rng) }),
        _ => json!({ "op": "remove", "path": [f], "value": scalar(rng) }),
    };
    if rng.below(3) == 0 && matches!(op["op"].as_str(), Some("insert")) {
        op["at"] = rng.below(4).into();
    }
    op
}

/// O1: a diff applied gives the record after, between any two records.
#[test]
fn o1_a_diff_explains_any_two_records() {
    let mut rng = Rng(0x0101_0101);
    for _ in 0..4000 {
        let (r, s) = (random_record(&mut rng), random_record(&mut rng));
        let mut flat = Flat::of(&r);
        flat.apply(&diff(&r, &s));
        assert_eq!(flat.record(), s, "{r:?} to {s:?}");
        assert!(diff(&s, &s).is_empty());
        let back: Vec<Change> = diff(&r, &s).iter().map(|c| Change::of_json(&c.to_json()).expect("a change")).collect();
        assert_eq!(back, diff(&r, &s));
    }
}

/// O2: an op the run takes changes nothing it doesn't name, and a run of ops nothing none of them names.
#[test]
fn o2_ops_change_only_what_they_name() {
    let mut rng = Rng(0x0202_0202);
    let mut taken = 0;
    for _ in 0..4000 {
        let before = random_record(&mut rng);
        let json: Vec<Value> = (0..1 + rng.below(3)).map(|_| random_op(&mut rng, &before)).collect();
        let Ok(ops) = json.iter().map(Op::of_json).collect::<Result<Vec<_>, _>>() else { continue };
        let Some(after) = run_all(&before, &ops) else { continue };
        taken += 1;
        for c in diff(&before, &after) {
            assert!(ops.iter().any(|op| op.loc().covers(&c)), "{before:?} {json:?}: {} named by none", c.to_json());
        }
    }
    assert!(taken > 1000, "only {taken} runs taken");
}

/// O3: the selector a query picks entries by picks every entry the query holds of.
#[test]
fn o3_a_plan_picks_no_less_than_its_query() {
    let mut rng = Rng(0x0303_0303);
    let labels = [
        json!({ "type": ["1"] }),
        json!({ "type": ["1", "2"] }),
        json!({ "tag": "7" }),
        json!({ "noTag": ["7"] }),
        json!({ "onlyTags": ["7", "8"] }),
        json!({ "created": [0, 300] }),
        json!({ "author": [VaultId::from_u64(1).to_hex()] }),
        json!({ "entry": [EntryId::from_u64(2).to_hex(), EntryId::from_u64(3).to_hex()] }),
    ];
    fn random_where(rng: &mut Rng, labels: &[Value], depth: usize) -> Value {
        match if depth == 0 { rng.below(2) } else { rng.below(6) } {
            0 => rng.pick(labels),
            1 => json!({ "path": [rng.pick(&FIELDS)], rng.pick(&["eq", "ne", "lt", "exists"]): json!(true) }),
            2 => json!({ "not": random_where(rng, labels, depth - 1) }),
            3 => json!({ "any": (0..rng.below(3)).map(|_| random_where(rng, labels, depth - 1)).collect::<Vec<_>>() }),
            _ => json!({ "all": (0..rng.below(4)).map(|_| random_where(rng, labels, depth - 1)).collect::<Vec<_>>() }),
        }
    }
    for _ in 0..2000 {
        let w = Where::of_json(&random_where(&mut rng, &labels, 3)).expect("a where");
        let plan = w.plan();
        for _ in 0..20 {
            let attrs = Attrs {
                ty: Sym::new(&(1 + rng.below(3)).to_string()),
                author: VaultId::from_u64(1 + rng.below(2) as u64),
                entry: EntryId::from_u64(1 + rng.below(4) as u64),
                created: rng.below(600) as u64,
                tags: ["7", "8", "9"].iter().filter(|_| rng.below(2) == 0).map(|t| Sym::new(t)).collect(),
            };
            let r = random_record(&mut rng);
            assert!(!w.holds(&attrs, &r) || plan.matches(&attrs), "{} misses {attrs:?}", w.to_json());
        }
    }
}
