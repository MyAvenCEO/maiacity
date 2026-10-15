//! The Lean model's ops vectors (`avendb/spec/vectors/ops.json`, written by `lake exe vectors`, checked by every
//! `lake build`), and one property per theorem of `spec/AvenDB/Ops.lean` on random records. Each diff must make the
//! model's changes (in any order: no two touch one place) and, applied, the record after (O1). Each run of ops must
//! end on the model's record, or be refused where the model refuses it, and change nothing its ops don't name (O2).
//! Each query must pick entries by the model's selector (`Where::plan`), which picks no less than the query (O3), and
//! hold of exactly the model's entries. A type or a tag is a number in the model, and its digits here; a vault or an
//! entry is its number in 64 hex digits. Each link followed must show what the model's does (`Links.follow`), each
//! record read so many rows down as the model reads it (`Doc.cut`), and each hop that shows nothing the model's reason,
//! by its name (the model says no more of why).

mod records;

use avendb::id::{EntryId, VaultId};
use avendb::ops::{cut, diff, follow, run_all, Change, Flat, Link, Record, RecordOp, Target, Unopened, Where};
use avendb::slice::{Attrs, Sym};
use records::{nested_op, nested_record, random_op, random_record, Rng, FIELDS};
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
        // how deep each record's rows go, and how deep the write reaches, which the ceiling bounds
        let depths = [Flat::of(&r).depth(), Flat::of(&s).depth()];
        assert_eq!(json!(depths), case["depths"], "{case}");
        assert_eq!(json!(got.iter().map(Change::depth).max().unwrap_or(0)), case["reach"], "{case}");
    }
}

#[test]
fn each_run_ends_where_the_models_does() {
    let v = vectors();
    for case in list(&v["runs"]) {
        let before = record(&case["before"]);
        let op = |o: &Value| RecordOp::of_json(o).unwrap_or_else(|why| panic!("{o}: {why}"));
        let ops: Vec<RecordOp> = list(&case["ops"]).iter().map(op).collect();
        for op in &ops {
            assert_eq!(RecordOp::of_json(&op.to_json()).as_ref(), Ok(op), "{case}");
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

/// `v` with every `why` taken out, at any depth: the model names why a hop shows nothing, and says no more.
fn without_why(mut v: Value) -> Value {
    let mut todo = vec![&mut v];
    while let Some(x) = todo.pop() {
        match x {
            Value::Object(o) => {
                o.remove("why");
                todo.extend(o.values_mut());
            }
            Value::Array(xs) => todo.extend(xs.iter_mut()),
            _ => {}
        }
    }
    v
}

#[test]
fn each_link_followed_shows_what_the_models_does() {
    let v = vectors();
    let graph: Vec<(Link, Record)> = list(&v["graph"])
        .iter()
        .map(|n| {
            let link = Link::of_json(&json!({ "vault": n["vault"], "entry": n["entry"] })).expect("a link");
            (link, record(&n["record"]))
        })
        .collect();
    let mut shown = 0;
    for case in list(&v["follows"]) {
        let link = Link::of_json(&case["link"]).unwrap_or_else(|| panic!("a link: {case}"));
        assert_eq!(link.to_json(), case["link"], "{case}");
        let field = |f: &Value| Target { rows: vec![], field: f.as_str().expect("a field").to_string() };
        let fields: Vec<Target> = list(&case["follow"]).iter().map(field).collect();
        let depth = case["depth"].as_u64().expect("a depth") as usize;
        // what the reader opens: the record of the link's entry, read so many rows down, in the vault it names
        let mut open = |l: &Link, rows: usize| -> Result<Record, Unopened> {
            let no = |name| Unopened { name, why: String::new() };
            let (at, r) = graph.iter().find(|(g, _)| g.entry == l.entry).ok_or(no("NoEntry"))?;
            if at.vault != l.vault {
                return Err(no("WrongVault"));
            }
            let mut r = r.clone();
            cut(&mut r, rows);
            Ok(r)
        };
        // the link at the top of a record, which it follows as deep as the case
        let mut r = Record::from_iter([("at".to_string(), case["link"].clone())]);
        let at = Target { rows: vec![], field: "at".into() };
        follow(&mut r, depth, &[&fields[..], &[at]].concat(), &mut open);
        assert_eq!(without_why(r["at"].clone()), case["shown"], "{case}");
        shown += r["at"].get("to").is_some() as usize;
    }
    assert!(shown >= 10, "most cases open a record: {shown}");
}

/// O1: a diff applied gives the record after, between any two records.
fn o1(rng: &mut Rng, record: fn(&mut Rng) -> Record) {
    for _ in 0..4000 {
        let (r, s) = (record(rng), record(rng));
        let mut flat = Flat::of(&r);
        flat.apply(&diff(&r, &s));
        assert_eq!(flat.record(), s, "{r:?} to {s:?}");
        assert!(diff(&s, &s).is_empty());
        let back: Vec<Change> = diff(&r, &s).iter().map(|c| Change::of_json(&c.to_json()).expect("a change")).collect();
        assert_eq!(back, diff(&r, &s));
    }
}

#[test]
fn o1_a_diff_explains_any_two_records() {
    o1(&mut Rng(0x0101_0101), random_record);
}

/// O1 on records whose rows hold rows, a few lists deep.
#[test]
fn o1_a_diff_explains_any_two_nested_records() {
    o1(&mut Rng(0x0111_0111), nested_record);
}

/// O2: an op the run takes changes nothing it doesn't name, and a run of ops nothing none of them names, over `runs`
/// runs. The runs it takes, and of those the ones that changed a place in a row of a row.
type Op = fn(&mut Rng, &Record) -> Value;
fn o2(rng: &mut Rng, runs: usize, record: fn(&mut Rng) -> Record, op: Op) -> (usize, usize) {
    let (mut taken, mut deep) = (0, 0);
    for _ in 0..runs {
        let before = record(rng);
        let json: Vec<Value> = (0..1 + rng.below(3)).map(|_| op(rng, &before)).collect();
        let Ok(ops) = json.iter().map(RecordOp::of_json).collect::<Result<Vec<_>, _>>() else { continue };
        let Some(after) = run_all(&before, &ops) else { continue };
        taken += 1;
        let changes = diff(&before, &after);
        for c in &changes {
            assert!(ops.iter().any(|op| op.loc().covers(c)), "{before:?} {json:?}: {} named by none", c.to_json());
        }
        let place = |c: &Change| match c {
            Change::Set(p, _) | Change::Order(p, _) => p.rows.len(),
        };
        deep += usize::from(changes.iter().any(|c| place(c) >= 2));
    }
    (taken, deep)
}

#[test]
fn o2_ops_change_only_what_they_name() {
    let (taken, _) = o2(&mut Rng(0x0202_0202), 4000, random_record, random_op);
    assert!(taken > 1000, "only {taken} runs taken");
}

/// O2 on records whose rows hold rows, by ops at any depth.
#[test]
fn o2_ops_at_any_depth_change_only_what_they_name() {
    let (taken, deep) = o2(&mut Rng(0x0222_0222), 40000, nested_record, nested_op);
    assert!(taken > 1000 && deep > 300, "only {taken} runs taken, {deep} deep");
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
