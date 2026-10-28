//! Random records and ops on them, for the properties of `spec/AvenDB/Ops.lean` (`ops.rs`) and of `Rules.lean`
//! (`rules.rs`): fields that hold a plain value, a list of values or a list of records whose ids may repeat, and ops on
//! fields, rows and ids that are there or not; and records whose rows hold lists of records in turn, a few deep, with
//! ops at any depth.
#![allow(dead_code)]

use avendb::ops::Record;
use serde_json::{json, Value};

/// xorshift64*: small and deterministic, so a failing seed can be replayed.
pub struct Rng(pub u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }

    pub fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    pub fn pick<T: Clone>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len())].clone()
    }
}

pub const FIELDS: [&str; 4] = ["title", "blocks", "tags", "n"];
/// The fields of a row an op at depth picks from: its rows, a value, a list of values or rows.
pub const ROW_FIELDS: [&str; 4] = ["kids", "text", "tags", "id"];
pub const AUDIENCES: [&str; 4] = ["text", "type", "level", "id"];

pub fn scalar(rng: &mut Rng) -> Value {
    rng.pick(&[json!("a"), json!("B"), json!(""), json!(1), json!(-2), json!(true), json!(null), json!(1.5)])
}

/// A row with id 1 to 4: a second row may share its id, as when two devices add one at once.
pub fn row(rng: &mut Rng) -> Value {
    let mut r = Record::new();
    r.insert("id".into(), (rng.below(4) as i64 + 1).into());
    for g in &AUDIENCES[..3] {
        if rng.below(2) == 0 {
            r.insert(g.to_string(), scalar(rng));
        }
    }
    Value::Object(r)
}

pub fn value(rng: &mut Rng) -> Value {
    match rng.below(4) {
        0 => scalar(rng),
        1 => (0..rng.below(3)).map(|_| scalar(rng)).collect(),
        _ => (0..rng.below(4)).map(|_| row(rng)).collect(),
    }
}

pub fn random_record(rng: &mut Rng) -> Record {
    let mut r = Record::new();
    for f in FIELDS {
        if rng.below(3) != 0 {
            r.insert(f.to_string(), value(rng));
        }
    }
    r
}

/// A row with id 1 to 4, which may hold rows of its own in `kids`, `depth` lists deep at most, and a list of values or
/// an empty list in `tags`.
pub fn nested_row(rng: &mut Rng, depth: usize) -> Value {
    let mut r = row(rng);
    if depth > 0 && rng.below(2) == 0 {
        r["kids"] = (0..rng.below(4)).map(|_| nested_row(rng, depth - 1)).collect();
    }
    if rng.below(4) == 0 {
        r["tags"] = (0..rng.below(3)).map(|_| scalar(rng)).collect();
    }
    r
}

/// A record whose blocks may hold rows of their own, four lists deep at most.
pub fn nested_record(rng: &mut Rng) -> Record {
    let mut r = random_record(rng);
    if rng.below(2) == 0 {
        r.insert("blocks".into(), (0..rng.below(4)).map(|_| nested_row(rng, 3)).collect());
    }
    r
}

/// An op at any depth: down a chain of rows that are there or not (mostly there: through the fields that hold rows,
/// by ids they hold), then one of `random_op`'s on a field of the row it reached; a row it inserts may hold rows of
/// its own.
pub fn nested_op(rng: &mut Rng, r: &Record) -> Value {
    let (mut steps, mut at, mut fields, mut down) = (vec![], Some(r), &FIELDS, "blocks");
    while rng.below(3) != 0 {
        let f = if rng.below(8) == 0 { rng.pick(fields) } else { down };
        let rows = at.and_then(|x| x.get(f)).and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default();
        let ids: Vec<i64> = rows.iter().filter_map(|x| x["id"].as_i64()).collect();
        let id = if ids.is_empty() || rng.below(8) == 0 { rng.below(5) as i64 + 1 } else { rng.pick(&ids) };
        at = rows.iter().find(|x| x["id"].as_i64() == Some(id)).and_then(Value::as_object);
        steps.extend([json!(f), json!({ "id": id })]);
        (fields, down) = (&ROW_FIELDS, "kids");
    }
    let empty = Record::new();
    let mut op = op_on(rng, at.unwrap_or(&empty), fields);
    if op["op"] == "insert" && op["value"].is_object() && rng.below(2) == 0 {
        op["value"] = nested_row(rng, 2);
    }
    let path = op["path"].as_array().expect("a path").clone();
    op["path"] = steps.into_iter().chain(path).collect();
    op
}

/// An op on fields and rows that are there or not, ids that are there or not: the run may refuse it.
pub fn random_op(rng: &mut Rng, r: &Record) -> Value {
    op_on(rng, r, &FIELDS)
}

/// An op on one of `fields` of record or row `r`.
fn op_on(rng: &mut Rng, r: &Record, fields: &[&str]) -> Value {
    let f = rng.pick(fields);
    let rows = r.get(f).and_then(Value::as_array).into_iter().flatten();
    let ids: Vec<i64> = rows.filter_map(|x| x["id"].as_i64()).collect();
    let id = if ids.is_empty() || rng.below(4) == 0 { rng.below(5) as i64 + 1 } else { rng.pick(&ids) };
    let g = rng.pick(&AUDIENCES);
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
