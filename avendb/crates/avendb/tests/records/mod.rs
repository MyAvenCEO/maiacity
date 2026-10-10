//! Random records and ops on them, for the properties of `spec/AvenDB/Ops.lean` (`ops.rs`) and of `Rules.lean`
//! (`rules.rs`): fields that hold a plain value, a list of values or a list of records whose ids may repeat, and ops on
//! fields, rows and ids that are there or not.
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
pub const CELLS: [&str; 4] = ["text", "type", "level", "id"];

pub fn scalar(rng: &mut Rng) -> Value {
    rng.pick(&[json!("a"), json!("B"), json!(""), json!(1), json!(-2), json!(true), json!(null), json!(1.5)])
}

/// A row with id 1 to 4: a second row may share its id, as when two devices add one at once.
pub fn row(rng: &mut Rng) -> Value {
    let mut r = Record::new();
    r.insert("id".into(), (rng.below(4) as i64 + 1).into());
    for g in &CELLS[..3] {
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

/// An op on fields and rows that are there or not, ids that are there or not: the run may refuse it.
pub fn random_op(rng: &mut Rng, r: &Record) -> Value {
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
