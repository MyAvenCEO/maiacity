//! Ops, as in `avendb/spec/AvenDB/Ops.lean`: one JSON language to read and change any record, whatever its schema
//! (`avendb/docs/OPS.md`). This module is the part on records alone; `engine` runs it on a device's Lab.
//!
//! - **Records, flat** (`Flat`). A record (what an item stores, or an app's view of it) is a JSON object. Flat, it is
//!   a value at each place (`Path`: a field, or a field of a row of a list of records) and the rows of each list of
//!   records in order. A list of records is an array whose every item is an object with an integer `id` (an empty
//!   array too); a row is named by its id, and where several rows share one (two devices added one at once) also by
//!   how many rows with that id come before it (`Key`).
//! - **Changes** (`Change`, `diff`). What a write did, in a normal form: a place's new value, a list's new rows. The
//!   diff of two records applied to the first gives the second (O1), so nothing a write did escapes its diff.
//! - **Ops** (`Op`). What an app asks: `set` or `unset` a field, a row or a field of a row; `insert`, `remove` and
//!   `move` a row of a list of records; `insert` a value into a list of values, `remove` one from it. Each names a
//!   place (`Loc`) and changes nothing it doesn't cover (O2).
//! - **Queries** (`Where`). A `where` mixes labels, the tests of a cap's selector, with tests of a record's values.
//!   Its labels make a selector that picks no less than it does (`Where::plan`), so a device picks entries by labels
//!   first and tests values only in what it opens (O3).
//!
//! A path is a JSON array: `[]` the whole record, `["title"]` a field, `["blocks", {"id": 2}]` the row of a list of
//! records with id 2, `["blocks", {"id": 2}, "text"]` a field of it; in a `where`, `["blocks", "*", "text"]` that
//! field of any row. A change names a copy of a row by `{"id": 2, "copy": 1}`.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::{json, Map, Value};

use crate::slice::{Atom, Attrs, Selector};

/// A record: a JSON object.
pub type Record = Map<String, Value>;

/// A row of a list of records: its id, and how many rows with that id come before it in the list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Key {
    pub id: i64,
    pub copy: usize,
}

/// A place of a record: a field, or a field of a row of a list of records.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Path {
    Top(String),
    Row(String, Key, String),
}

/// A change: a place's new value (`None`: gone), or a list's new rows (`None`: the field no longer holds a list of
/// records).
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    Set(Path, Option<Value>),
    Order(String, Option<Vec<Key>>),
}

/// The rows of a list of records: an array whose every item is an object with an integer `id`, an empty one too.
pub fn rows(v: &Value) -> Option<&[Value]> {
    let xs = v.as_array()?;
    xs.iter().all(|x| x.get("id").and_then(Value::as_i64).is_some()).then_some(xs.as_slice())
}

/// Each row of a list of records with its key.
pub fn keyed(rows: &[Value]) -> Vec<(Key, &Record)> {
    let mut seen: HashMap<i64, usize> = HashMap::new();
    let mut key = |r: &Value| {
        let id = r["id"].as_i64().expect("a row has an integer id");
        let copy = seen.entry(id).or_default();
        *copy += 1;
        Key { id, copy: *copy - 1 }
    };
    rows.iter().map(|r| (key(r), r.as_object().expect("a row is an object"))).collect()
}

/// A record, flat: the value at each place, and the rows of each list of records in order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Flat {
    pub leaves: BTreeMap<Path, Value>,
    pub lists: BTreeMap<String, Vec<Key>>,
}

impl Flat {
    pub fn of(r: &Record) -> Flat {
        let mut flat = Flat::default();
        for (f, v) in r {
            let Some(rows) = rows(v) else {
                flat.leaves.insert(Path::Top(f.clone()), v.clone());
                continue;
            };
            let keyed = keyed(rows);
            for (k, row) in &keyed {
                for (g, x) in row.iter().filter(|(g, _)| *g != "id") {
                    flat.leaves.insert(Path::Row(f.clone(), *k, g.clone()), x.clone());
                }
            }
            flat.lists.insert(f.clone(), keyed.iter().map(|(k, _)| *k).collect());
        }
        flat
    }

    /// The changes, one after the other.
    pub fn apply(&mut self, changes: &[Change]) {
        for c in changes {
            match c {
                Change::Set(p, Some(v)) => drop(self.leaves.insert(p.clone(), v.clone())),
                Change::Set(p, None) => drop(self.leaves.remove(p)),
                Change::Order(f, Some(ks)) => drop(self.lists.insert(f.clone(), ks.clone())),
                Change::Order(f, None) => drop(self.lists.remove(f)),
            }
        }
    }

    /// The record it is: each list's rows in order, each its id and its fields, and each other field's value.
    pub fn record(&self) -> Record {
        let mut out = Record::new();
        for (p, v) in &self.leaves {
            if let Path::Top(f) = p {
                out.insert(f.clone(), v.clone());
            }
        }
        for (f, ks) in &self.lists {
            out.insert(f.clone(), ks.iter().map(|k| Value::Object(self.row(f, k))).collect());
        }
        out
    }

    /// Row `k` of list `f`: its id and its fields.
    pub fn row(&self, f: &str, k: &Key) -> Record {
        let mut r = Record::new();
        r.insert("id".into(), k.id.into());
        for (p, v) in self.leaves.range(Path::Row(f.to_string(), *k, String::new())..) {
            match p {
                Path::Row(f2, k2, g) if f2 == f && k2 == k => drop(r.insert(g.clone(), v.clone())),
                _ => break,
            }
        }
        r
    }

    /// Row `k` is in list `f`.
    pub fn holds(&self, f: &str, k: &Key) -> bool {
        self.lists.get(f).is_some_and(|ks| ks.contains(k))
    }

    /// The changes that make this record into `after`: each list's new rows, by field, then each place's new value, by
    /// place.
    pub fn diff(&self, after: &Flat) -> Vec<Change> {
        let (r, s) = (self, after);
        let lists: BTreeSet<&String> = r.lists.keys().chain(s.lists.keys()).collect();
        let orders = lists.into_iter().filter(|f| r.lists.get(*f) != s.lists.get(*f));
        let orders = orders.map(|f| Change::Order(f.clone(), s.lists.get(f).cloned()));
        let paths: BTreeSet<&Path> = r.leaves.keys().chain(s.leaves.keys()).collect();
        let sets = paths.into_iter().filter(|p| r.leaves.get(*p) != s.leaves.get(*p));
        orders.chain(sets.map(|p| Change::Set(p.clone(), s.leaves.get(p).cloned()))).collect()
    }
}

/// The changes that make `before` into `after` (`Flat::diff`).
pub fn diff(before: &Record, after: &Record) -> Vec<Change> {
    Flat::of(before).diff(&Flat::of(after))
}

/// What a list's new rows do to its old ones: the rows they add, the rows they drop, and whether the rows they keep
/// change order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reorder {
    pub inserted: Vec<Key>,
    pub removed: Vec<Key>,
    pub moved: bool,
}

pub fn reorder(before: &[Key], after: &[Key]) -> Reorder {
    let (b, a): (BTreeSet<&Key>, BTreeSet<&Key>) = (before.iter().collect(), after.iter().collect());
    let kept_before: Vec<&Key> = before.iter().filter(|k| a.contains(k)).collect();
    let kept_after: Vec<&Key> = after.iter().filter(|k| b.contains(k)).collect();
    Reorder {
        inserted: after.iter().filter(|k| !b.contains(k)).copied().collect(),
        removed: before.iter().filter(|k| !a.contains(k)).copied().collect(),
        moved: kept_before != kept_after,
    }
}

impl Key {
    /// As a path names it: `{"id": n}`, and its copy where it isn't the first.
    pub fn to_json(&self) -> Value {
        match self.copy {
            0 => json!({ "id": self.id }),
            copy => json!({ "id": self.id, "copy": copy }),
        }
    }

    fn of_json(v: &Value) -> Result<Key, String> {
        let o = v.as_object().ok_or("a row is named by {\"id\": n}")?;
        let id = o.get("id").and_then(Value::as_i64).ok_or("a row's id is an integer")?;
        let copy = match o.get("copy") {
            None => 0,
            Some(c) => c.as_u64().ok_or("a copy is a count")? as usize,
        };
        if o.keys().any(|k| k != "id" && k != "copy") {
            return Err("a row is named by its id, and its copy".into());
        }
        Ok(Key { id, copy })
    }
}

impl Path {
    pub fn to_json(&self) -> Value {
        match self {
            Path::Top(f) => json!([f]),
            Path::Row(f, k, g) => json!([f, k.to_json(), g]),
        }
    }

    /// A place from its path: `[field]`, or `[field, {"id": n}, field]` with the row's copy where it isn't the first.
    pub fn of_json(v: &Value) -> Result<Path, String> {
        match v.as_array().map(Vec::as_slice) {
            Some([Value::String(f)]) => Ok(Path::Top(f.clone())),
            Some([Value::String(f), k, Value::String(g)]) => Ok(Path::Row(f.clone(), Key::of_json(k)?, g.clone())),
            _ => Err(format!("{v} is no place: [field] or [field, {{\"id\": n}}, field]")),
        }
    }

    /// The value at the place in record `r`: none for a row's id, which names the row.
    pub fn at<'a>(&self, r: &'a Record) -> Option<&'a Value> {
        match self {
            Path::Top(f) => r.get(f),
            Path::Row(f, k, g) => cell(r, f, k, g),
        }
    }
}

impl Change {
    /// `{"set": path, "value": v}`, `{"unset": path}`, or `{"rows": field, "keys": [key, ..]}` (`null`: no list).
    pub fn to_json(&self) -> Value {
        match self {
            Change::Set(p, Some(v)) => json!({ "set": p.to_json(), "value": v }),
            Change::Set(p, None) => json!({ "unset": p.to_json() }),
            Change::Order(f, ks) => {
                json!({ "rows": f, "keys": ks.as_ref().map(|ks| ks.iter().map(Key::to_json).collect::<Vec<_>>()) })
            }
        }
    }

    pub fn of_json(v: &Value) -> Result<Change, String> {
        if let Some(p) = v.get("set") {
            return Ok(Change::Set(Path::of_json(p)?, Some(v.get("value").ok_or("a set has a value")?.clone())));
        }
        if let Some(p) = v.get("unset") {
            return Ok(Change::Set(Path::of_json(p)?, None));
        }
        let f = v.get("rows").and_then(Value::as_str).ok_or_else(|| format!("{v} is no change"))?;
        let keys = match v.get("keys") {
            None | Some(Value::Null) => None,
            Some(ks) => {
                let ks = ks.as_array().ok_or("keys is a list")?;
                Some(ks.iter().map(Key::of_json).collect::<Result<_, _>>()?)
            }
        };
        Ok(Change::Order(f.to_string(), keys))
    }
}

/// What an op names: the whole record, a field, a row of a list of records (the first with that id, the one apps
/// see), or a field of such a row.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Loc {
    Root,
    Field(String),
    Row(String, i64),
    Cell(String, i64, String),
}

impl Loc {
    /// Whether changing at the place may make change `c`: a row's place in its list is its list's order, and as rows
    /// are told apart by how many with their id come before them, changing one row of an id may renumber its copies.
    pub fn covers(&self, c: &Change) -> bool {
        match (self, c) {
            (Loc::Root, _) => true,
            (Loc::Field(f), Change::Set(Path::Top(g) | Path::Row(g, ..), _)) | (Loc::Field(f), Change::Order(g, _)) => {
                f == g
            }
            (Loc::Row(f, i), Change::Set(Path::Row(g, k, _), _)) => f == g && *i == k.id,
            (Loc::Row(f, _), Change::Order(g, _)) => f == g,
            (Loc::Cell(f, i, g), Change::Set(Path::Row(f2, k, g2), _)) => f == f2 && *i == k.id && g == g2,
            _ => false,
        }
    }

    /// As a path names it.
    pub fn to_json(&self) -> Value {
        match self {
            Loc::Root => json!([]),
            Loc::Field(f) => json!([f]),
            Loc::Row(f, i) => json!([f, { "id": i }]),
            Loc::Cell(f, i, g) => json!([f, { "id": i }, g]),
        }
    }

    pub fn of_json(v: &Value) -> Result<Loc, String> {
        let row = |s: &Value| s.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")?.as_i64());
        let bad = || format!("{v} is no path: [], [field], [field, {{\"id\": n}}] or [field, {{\"id\": n}}, field]");
        match v.as_array().map(Vec::as_slice).ok_or_else(bad)? {
            [] => Ok(Loc::Root),
            [Value::String(f)] => Ok(Loc::Field(f.clone())),
            [Value::String(f), s] => Ok(Loc::Row(f.clone(), row(s).ok_or_else(bad)?)),
            [Value::String(f), s, Value::String(g)] => Ok(Loc::Cell(f.clone(), row(s).ok_or_else(bad)?, g.clone())),
            _ => Err(bad()),
        }
    }
}

/// What an app asks of a record, as `Op::of_json` reads it. A row is named by its id: an app's view holds one row of
/// each id.
#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    /// `{"op": "set", "path": [], "value": record}`: the whole record.
    Put(Record),
    /// `{"op": "set", "path": [f], "value": v}`.
    Set(String, Value),
    /// `{"op": "unset", "path": [f]}`.
    Unset(String),
    /// `{"op": "set", "path": [f, {"id": n}], "value": row}`: the row, all its fields; its id, if given, is `n`.
    SetRow(String, i64, Record),
    /// `{"op": "set", "path": [f, {"id": n}, g], "value": v}`.
    SetCell(String, i64, String, Value),
    /// `{"op": "unset", "path": [f, {"id": n}, g]}`.
    UnsetCell(String, i64, String),
    /// `{"op": "insert", "path": [f], "value": row, "at": n}`: a new row, at place `n` or last.
    Insert(String, Record, Option<usize>),
    /// `{"op": "remove", "path": [f, {"id": n}]}`.
    Remove(String, i64),
    /// `{"op": "move", "path": [f, {"id": n}], "to": m}`: the row to place `m` of the list without it.
    Move(String, i64, usize),
    /// `{"op": "insert", "path": [f], "value": v, "at": n}`: a value into a list of values, at place `n` or last.
    Add(String, Value, Option<usize>),
    /// `{"op": "remove", "path": [f], "value": v}`: every copy of a value out of a list of values.
    Drop(String, Value),
}

/// The fields an op may carry: its own, and what the engine reads of it.
const OP_FIELDS: [&str; 9] = ["op", "path", "value", "at", "to", "entry", "line", "schema", "as"];

fn scalar(v: &Value) -> bool {
    !v.is_array() && !v.is_object()
}

impl Op {
    pub fn of_json(v: &Value) -> Result<Op, String> {
        let o = v.as_object().ok_or("an op is an object")?;
        if let Some(other) = o.keys().find(|k| !OP_FIELDS.contains(&k.as_str())) {
            return Err(format!("an op has no field {other:?}"));
        }
        let name = o.get("op").and_then(Value::as_str).ok_or("an op names what it does: \"op\"")?;
        let loc = Loc::of_json(o.get("path").ok_or("an op names a path")?)?;
        let value = || o.get("value").cloned().ok_or_else(|| format!("{name} needs a value"));
        let at = || -> Result<Option<usize>, String> {
            o.get("at").map(|n| n.as_u64().map(|n| n as usize).ok_or("at is a place: 0, 1, ..".into())).transpose()
        };
        let row = |x: Value, id: Option<i64>| -> Result<Record, String> {
            let Value::Object(mut r) = x else { return Err("a row is an object".into()) };
            match (r.get("id").map(Value::as_i64), id) {
                (Some(Some(n)), Some(want)) if n != want => Err(format!("the row at id {want} has id {n}")),
                (Some(Some(_)), _) => Ok(r),
                (None, Some(want)) => {
                    r.insert("id".into(), want.into());
                    Ok(r)
                }
                _ => Err("a row has an integer id".into()),
            }
        };
        Ok(match (name, loc) {
            ("set", Loc::Root) => match value()? {
                Value::Object(r) => Op::Put(r),
                _ => return Err("a record is an object".into()),
            },
            ("set", Loc::Field(f)) => Op::Set(f, value()?),
            ("set", Loc::Row(f, i)) => Op::SetRow(f, i, row(value()?, Some(i))?),
            ("set", Loc::Cell(f, i, g)) => Op::SetCell(f, i, g, value()?),
            ("unset", Loc::Field(f)) => Op::Unset(f),
            ("unset", Loc::Cell(f, i, g)) => Op::UnsetCell(f, i, g),
            ("insert", Loc::Field(f)) => match value()? {
                x @ Value::Object(_) => Op::Insert(f, row(x, None)?, at()?),
                x if scalar(&x) => Op::Add(f, x, at()?),
                _ => return Err("insert takes a row, or a value for a list of values".into()),
            },
            ("remove", Loc::Row(f, i)) => Op::Remove(f, i),
            ("remove", Loc::Field(f)) => match value()? {
                x if scalar(&x) => Op::Drop(f, x),
                _ => return Err("remove takes the value to take out of a list of values".into()),
            },
            ("move", Loc::Row(f, i)) => {
                let to = o.get("to").and_then(Value::as_u64).ok_or("move names the place it moves to: to")?;
                Op::Move(f, i, to as usize)
            }
            (name, loc) => return Err(format!("{name} makes no sense at {}", loc.to_json())),
        })
    }

    pub fn to_json(&self) -> Value {
        let at = |o: &mut Value, n: &Option<usize>| {
            if let Some(n) = n {
                o["at"] = (*n).into();
            }
        };
        match self {
            Op::Put(r) => json!({ "op": "set", "path": [], "value": r }),
            Op::Set(f, v) => json!({ "op": "set", "path": [f], "value": v }),
            Op::Unset(f) => json!({ "op": "unset", "path": [f] }),
            Op::SetRow(f, i, r) => json!({ "op": "set", "path": [f, { "id": i }], "value": r }),
            Op::SetCell(f, i, g, v) => json!({ "op": "set", "path": [f, { "id": i }, g], "value": v }),
            Op::UnsetCell(f, i, g) => json!({ "op": "unset", "path": [f, { "id": i }, g] }),
            Op::Insert(f, r, n) => {
                let mut o = json!({ "op": "insert", "path": [f], "value": r });
                at(&mut o, n);
                o
            }
            Op::Remove(f, i) => json!({ "op": "remove", "path": [f, { "id": i }] }),
            Op::Move(f, i, to) => json!({ "op": "move", "path": [f, { "id": i }], "to": to }),
            Op::Add(f, v, n) => {
                let mut o = json!({ "op": "insert", "path": [f], "value": v });
                at(&mut o, n);
                o
            }
            Op::Drop(f, v) => json!({ "op": "remove", "path": [f], "value": v }),
        }
    }

    pub fn loc(&self) -> Loc {
        match self {
            Op::Put(_) => Loc::Root,
            Op::Set(f, _) | Op::Unset(f) | Op::Add(f, ..) | Op::Drop(f, _) => Loc::Field(f.clone()),
            Op::SetRow(f, i, _) | Op::Remove(f, i) | Op::Move(f, i, _) => Loc::Row(f.clone(), *i),
            Op::Insert(f, r, _) => Loc::Row(f.clone(), r["id"].as_i64().expect("a row has an integer id")),
            Op::SetCell(f, i, g, _) | Op::UnsetCell(f, i, g) => Loc::Cell(f.clone(), *i, g.clone()),
        }
    }

    /// The record after the op, or `None` where it makes no sense of it: a row or a field that isn't there, a second
    /// row with one id, a place past the end of a list, a row's id changed.
    pub fn run(&self, r: &Record) -> Option<Record> {
        let mut out = r.clone();
        // the rows of list `f`, and the place of the first with id `i`
        let row_of = |f: &str, i: i64| -> Option<(Vec<Value>, usize)> {
            let rs = rows(r.get(f)?)?;
            let at = rs.iter().position(|x| x["id"].as_i64() == Some(i))?;
            Some((rs.to_vec(), at))
        };
        match self {
            Op::Put(d) => return Some(d.clone()),
            Op::Set(f, x) => drop(out.insert(f.clone(), x.clone())),
            Op::Unset(f) => drop(out.remove(f)),
            Op::SetRow(f, i, row) => {
                let (mut rs, at) = row_of(f, *i)?;
                rs[at] = Value::Object(row.clone());
                out.insert(f.clone(), rs.into());
            }
            Op::SetCell(f, i, g, v) => {
                let (mut rs, at) = row_of(f, *i).filter(|_| g != "id")?;
                fields(&mut rs[at]).insert(g.clone(), v.clone());
                out.insert(f.clone(), rs.into());
            }
            Op::UnsetCell(f, i, g) => {
                let (mut rs, at) = row_of(f, *i).filter(|_| g != "id")?;
                fields(&mut rs[at]).remove(g);
                out.insert(f.clone(), rs.into());
            }
            Op::Insert(f, row, n) => {
                let id = row["id"].as_i64();
                let mut rs = match r.get(f) {
                    None => vec![],
                    Some(v) => rows(v)?.to_vec(),
                };
                let n = n.unwrap_or(rs.len());
                if rs.iter().any(|x| x["id"].as_i64() == id) || n > rs.len() {
                    return None;
                }
                rs.insert(n, Value::Object(row.clone()));
                out.insert(f.clone(), rs.into());
            }
            Op::Remove(f, i) => {
                let (mut rs, at) = row_of(f, *i)?;
                rs.remove(at);
                out.insert(f.clone(), rs.into());
            }
            Op::Move(f, i, to) => {
                let (mut rs, at) = row_of(f, *i)?;
                let row = rs.remove(at);
                if *to > rs.len() {
                    return None;
                }
                rs.insert(*to, row);
                out.insert(f.clone(), rs.into());
            }
            Op::Add(f, v, n) => {
                let mut vs = match r.get(f) {
                    None => vec![],
                    Some(Value::Array(xs)) if xs.is_empty() || rows(&Value::Array(xs.clone())).is_none() => xs.clone(),
                    Some(_) => return None,
                };
                let n = n.unwrap_or(vs.len());
                if n > vs.len() {
                    return None;
                }
                vs.insert(n, v.clone());
                out.insert(f.clone(), vs.into());
            }
            Op::Drop(f, v) => match r.get(f) {
                None => {}
                Some(Value::Array(xs)) if xs.is_empty() => {}
                Some(x @ Value::Array(xs)) if rows(x).is_none() => {
                    out.insert(f.clone(), xs.iter().filter(|x| *x != v).cloned().collect());
                }
                Some(_) => return None,
            },
        }
        Some(out)
    }
}

fn fields(row: &mut Value) -> &mut Record {
    row.as_object_mut().expect("a row is an object")
}

/// Ops one after the other: `None` if one makes no sense.
pub fn run_all(r: &Record, ops: &[Op]) -> Option<Record> {
    ops.iter().try_fold(r.clone(), |r, op| op.run(&r))
}

/// A test of the value at a place, as a `where` writes it beside the place's `path`.
#[derive(Clone, Debug, PartialEq)]
pub enum Test {
    Eq(Value),
    Ne(Value),
    Lt(Value),
    Le(Value),
    Gt(Value),
    Ge(Value),
    /// `"in": [v, ..]`: one of these values.
    In(Vec<Value>),
    /// `"has": v`: a list of values that holds this one.
    Has(Value),
    /// `"contains": "text"`: a text holding this one, ASCII letters in either case.
    Contains(String),
    /// `"exists": true`: there is a value; `false`: there is none.
    Exists(bool),
}

/// An order on values: of two integers, or of two texts; any other two aren't ordered.
fn lt(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => matches!((x.as_i64(), y.as_i64()), (Some(x), Some(y)) if x < y),
        (Value::String(x), Value::String(y)) => x < y,
        _ => false,
    }
}

impl Test {
    pub fn test(&self, x: Option<&Value>) -> bool {
        let one = |f: &dyn Fn(&Value) -> bool| x.is_some_and(|x| scalar(x) && f(x));
        match self {
            Test::Eq(v) => x == Some(v),
            Test::Ne(v) => x != Some(v),
            Test::Lt(v) => one(&|x| lt(x, v)),
            Test::Le(v) => one(&|x| x == v || lt(x, v)),
            Test::Gt(v) => one(&|x| lt(v, x)),
            Test::Ge(v) => one(&|x| x == v || lt(v, x)),
            Test::In(vs) => one(&|x| vs.contains(x)),
            Test::Has(v) => x.and_then(Value::as_array).is_some_and(|xs| xs.contains(v)),
            Test::Contains(t) => {
                x.and_then(Value::as_str).is_some_and(|s| s.to_ascii_lowercase().contains(&t.to_ascii_lowercase()))
            }
            Test::Exists(b) => x.is_some() == *b,
        }
    }

    fn of_json(name: &str, v: &Value) -> Result<Test, String> {
        Ok(match name {
            "eq" => Test::Eq(v.clone()),
            "ne" => Test::Ne(v.clone()),
            "lt" => Test::Lt(v.clone()),
            "le" => Test::Le(v.clone()),
            "gt" => Test::Gt(v.clone()),
            "ge" => Test::Ge(v.clone()),
            "in" => Test::In(v.as_array().ok_or("in is a list of values")?.clone()),
            "has" => Test::Has(v.clone()),
            "contains" => Test::Contains(v.as_str().ok_or("contains is a text")?.to_string()),
            "exists" => Test::Exists(v.as_bool().ok_or("exists is true or false")?),
            other => return Err(format!("no test of a value is called {other:?}")),
        })
    }

    fn to_json(&self) -> (&'static str, Value) {
        match self {
            Test::Eq(v) => ("eq", v.clone()),
            Test::Ne(v) => ("ne", v.clone()),
            Test::Lt(v) => ("lt", v.clone()),
            Test::Le(v) => ("le", v.clone()),
            Test::Gt(v) => ("gt", v.clone()),
            Test::Ge(v) => ("ge", v.clone()),
            Test::In(vs) => ("in", vs.clone().into()),
            Test::Has(v) => ("has", v.clone()),
            Test::Contains(t) => ("contains", t.clone().into()),
            Test::Exists(b) => ("exists", (*b).into()),
        }
    }
}

/// What a test reads: a place, or a field of any row of a list of records (the test holds if it holds of one).
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    At(Path),
    Each(String, String),
}

/// The value at field `g` of the row with key `k` of list `f`: none for its id, which names the row.
fn cell<'a>(r: &'a Record, f: &str, k: &Key, g: &str) -> Option<&'a Value> {
    let row = keyed(rows(r.get(f)?)?).into_iter().find(|(key, _)| key == k)?.1;
    row.get(g).filter(|_| g != "id")
}

impl Target {
    pub fn holds(&self, r: &Record, t: &Test) -> bool {
        match self {
            Target::At(p) => t.test(p.at(r)),
            Target::Each(f, g) => match r.get(f).and_then(rows) {
                Some(rs) => keyed(rs).iter().any(|(_, row)| t.test(row.get(g).filter(|_| g != "id"))),
                None => false,
            },
        }
    }

    pub fn of_json(v: &Value) -> Result<Target, String> {
        match v.as_array().map(Vec::as_slice) {
            Some([Value::String(f), Value::String(star), Value::String(g)]) if star == "*" => {
                Ok(Target::Each(f.clone(), g.clone()))
            }
            _ => Path::of_json(v).map(Target::At).map_err(|_| {
                format!("{v} is no place to test: [field], [field, {{\"id\": n}}, field] or [field, \"*\", field]")
            }),
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Target::At(p) => p.to_json(),
            Target::Each(f, g) => json!([f, "*", g]),
        }
    }
}

/// A query's `where`: `{"all": [w, ..]}`, `{"any": [w, ..]}`, `{"not": w}`, a label as a cap's selector writes it
/// (`Selector::to_json`), or `{"path": path, test: value}`. `{"all": []}` holds of everything, `{"any": []}` of
/// nothing, and a longer list nests from the right: `{"all": [a, b, c]}` is a and (b and c).
#[derive(Clone, Debug, PartialEq)]
pub enum Where {
    Yes,
    No,
    Label(Atom),
    Test(Target, Test),
    And(Box<Where>, Box<Where>),
    Or(Box<Where>, Box<Where>),
    Not(Box<Where>),
}

/// The tests of a value a `where` may write beside a path.
const TESTS: [&str; 10] = ["eq", "ne", "lt", "le", "gt", "ge", "in", "has", "contains", "exists"];

impl Where {
    pub fn holds(&self, a: &Attrs, r: &Record) -> bool {
        match self {
            Where::Yes => true,
            Where::No => false,
            Where::Label(x) => x.test(a),
            Where::Test(x, t) => x.holds(r, t),
            Where::And(u, w) => u.holds(a, r) && w.holds(a, r),
            Where::Or(u, w) => u.holds(a, r) || w.holds(a, r),
            Where::Not(w) => !w.holds(a, r),
        }
    }

    /// It tests labels alone, with no test of a value and no `not`: its cover picks exactly what it does, and a cap may
    /// pick by it (`slice::Selector::of_json`).
    pub fn labels_only(&self) -> bool {
        match self {
            Where::Yes | Where::No | Where::Label(_) => true,
            Where::Test(..) | Where::Not(_) => false,
            Where::And(u, w) | Where::Or(u, w) => u.labels_only() && w.labels_only(),
        }
    }

    /// The selector of its labels: values and negations are left to the tests, so it picks no less.
    pub fn cover(&self) -> Selector {
        match self {
            Where::Yes | Where::Test(..) | Where::Not(_) => Selector::All,
            Where::No => Selector::AnyOf(vec![]),
            Where::Label(x) => Selector::AnyOf(vec![vec![x.clone()]]),
            Where::And(u, w) => match (u.cover(), w.cover()) {
                (Selector::All, s) | (s, Selector::All) => s,
                (Selector::AnyOf(ds), Selector::AnyOf(es)) => {
                    let both = ds.iter().flat_map(|d| es.iter().map(move |e| [d.clone(), e.clone()].concat()));
                    Selector::AnyOf(both.collect())
                }
            },
            Where::Or(u, w) => match (u.cover(), w.cover()) {
                (Selector::AnyOf(ds), Selector::AnyOf(es)) => Selector::AnyOf([ds, es].concat()),
                _ => Selector::All,
            },
        }
    }

    /// The selector a device picks entries by, a cap's, before it tests what it opens: its labels', or the whole
    /// vault's where those make a selector beyond the bounds.
    pub fn plan(&self) -> Selector {
        Some(self.cover()).filter(Selector::bounded).unwrap_or(Selector::All)
    }

    pub fn of_json(v: &Value) -> Result<Where, String> {
        let o = v.as_object().ok_or("a where is an object")?;
        let list = |x: &Value| -> Result<Vec<Where>, String> {
            x.as_array().ok_or("all and any take a list")?.iter().map(Where::of_json).collect()
        };
        // a list nests from the right: [a, b, c] is a and (b and c)
        let fold = |ws: Vec<Where>, empty: Where, join: fn(Box<Where>, Box<Where>) -> Where| {
            let mut ws = ws.into_iter().rev();
            let last = ws.next();
            last.map_or(empty, |last| ws.fold(last, |acc, w| join(Box::new(w), Box::new(acc))))
        };
        if o.contains_key("path") {
            let tests: Vec<&String> = o.keys().filter(|k| *k != "path").collect();
            let [name] = tests.as_slice() else {
                return Err(format!("a test of a value names a path and one of {}", TESTS.join(", ")));
            };
            return Ok(Where::Test(Target::of_json(&o["path"])?, Test::of_json(name, &o[*name])?));
        }
        match o.iter().next().filter(|_| o.len() == 1) {
            Some((k, x)) if k == "all" => Ok(fold(list(x)?, Where::Yes, Where::And)),
            Some((k, x)) if k == "any" => Ok(fold(list(x)?, Where::No, Where::Or)),
            Some((k, x)) if k == "not" => Ok(Where::Not(Box::new(Where::of_json(x)?))),
            _ => Atom::of_json(v).map(Where::Label),
        }
    }

    pub fn to_json(&self) -> Value {
        let list = |w: &Where, ands: bool| {
            let mut out = vec![];
            let mut at = w;
            loop {
                match at {
                    Where::And(u, rest) if ands => (out.push(u.to_json()), at = rest).1,
                    Where::Or(u, rest) if !ands => (out.push(u.to_json()), at = rest).1,
                    last => break out.push(last.to_json()),
                }
            }
            out
        };
        match self {
            Where::Yes => json!({ "all": [] }),
            Where::No => json!({ "any": [] }),
            Where::Label(x) => x.to_json(),
            Where::Test(x, t) => {
                let (name, v) = t.to_json();
                json!({ "path": x.to_json(), name: v })
            }
            w @ Where::And(..) => json!({ "all": list(w, true) }),
            w @ Where::Or(..) => json!({ "any": list(w, false) }),
            Where::Not(w) => json!({ "not": w.to_json() }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn record(v: Value) -> Record {
        v.as_object().expect("a record").clone()
    }

    #[test]
    fn a_record_is_its_flat_form() {
        let r = record(json!({
            "title": "Plan",
            "blocks": [{ "id": 1, "text": "a" }, { "id": 1, "text": "b" }, { "id": 2 }],
            "tags": [],
            "odd": [1, { "id": 2 }],
        }));
        let flat = Flat::of(&r);
        assert_eq!(flat.lists["blocks"], vec![Key { id: 1, copy: 0 }, Key { id: 1, copy: 1 }, Key { id: 2, copy: 0 }]);
        assert_eq!(flat.lists["tags"], vec![]);
        assert_eq!(flat.leaves[&Path::Top("odd".into())], json!([1, { "id": 2 }]));
        assert_eq!(flat.leaves[&Path::Row("blocks".into(), Key { id: 1, copy: 1 }, "text".into())], json!("b"));
        assert_eq!(flat.record(), r);
    }

    #[test]
    fn a_diff_applied_gives_the_record_after() {
        let records = [
            json!({}),
            json!({ "title": "Plan", "blocks": [{ "id": 1, "text": "a" }, { "id": 2, "text": "b" }] }),
            json!({ "title": "Plan", "blocks": [{ "id": 2, "text": "b" }, { "id": 1, "text": "c" }, { "id": 1 }] }),
            json!({ "blocks": "flat", "tags": ["x"] }),
            json!({ "blocks": [], "tags": [] }),
        ];
        for a in &records {
            for b in &records {
                let (a, b) = (record(a.clone()), record(b.clone()));
                let mut flat = Flat::of(&a);
                flat.apply(&diff(&a, &b));
                assert_eq!(flat.record(), b, "{a:?} to {b:?}");
                let changes = diff(&a, &b);
                let back = |c: &Change| Change::of_json(&c.to_json()).expect("a change");
                assert_eq!(changes.iter().map(back).collect::<Vec<_>>(), changes);
            }
        }
    }

    #[test]
    fn a_reorder_names_what_it_adds_drops_and_moves() {
        let k = |id| Key { id, copy: 0 };
        assert_eq!(reorder(&[k(1), k(2), k(3)], &[k(1), k(4), k(3)]), Reorder {
            inserted: vec![k(4)],
            removed: vec![k(2)],
            moved: false
        });
        assert!(reorder(&[k(1), k(2)], &[k(2), k(1)]).moved);
    }

    #[test]
    fn an_op_reads_back_from_its_json() {
        let ops = [
            json!({ "op": "set", "path": [], "value": { "title": "x" } }),
            json!({ "op": "set", "path": ["title"], "value": "y" }),
            json!({ "op": "unset", "path": ["title"] }),
            json!({ "op": "set", "path": ["blocks", { "id": 2 }], "value": { "id": 2, "text": "z" } }),
            json!({ "op": "set", "path": ["blocks", { "id": 2 }, "text"], "value": "z" }),
            json!({ "op": "unset", "path": ["blocks", { "id": 2 }, "text"] }),
            json!({ "op": "insert", "path": ["blocks"], "value": { "id": 3 }, "at": 0 }),
            json!({ "op": "remove", "path": ["blocks", { "id": 3 }] }),
            json!({ "op": "move", "path": ["blocks", { "id": 3 }], "to": 1 }),
            json!({ "op": "insert", "path": ["tags"], "value": "work" }),
            json!({ "op": "remove", "path": ["tags"], "value": "work" }),
        ];
        for v in ops {
            assert_eq!(Op::of_json(&v).expect("an op").to_json(), v);
        }
        let row = Op::of_json(&json!({ "op": "set", "path": ["blocks", { "id": 2 }], "value": { "text": "z" } }));
        assert_eq!(row, Ok(Op::SetRow("blocks".into(), 2, record(json!({ "text": "z", "id": 2 })))));
        let bad = [
            json!({ "op": "set", "path": ["blocks", { "id": 2 }], "value": { "id": 3 } }),
            json!({ "op": "unset", "path": [] }),
            json!({ "op": "insert", "path": ["tags"], "value": [1] }),
            json!({ "op": "move", "path": ["blocks", { "id": 2 }] }),
            json!({ "op": "set", "path": ["blocks", { "id": 2, "copy": 1 }, "text"], "value": "z" }),
            json!({ "op": "set", "path": ["title"], "value": "y", "vaule": 1 }),
        ];
        for v in bad {
            assert!(Op::of_json(&v).is_err(), "{v}");
        }
    }

    #[test]
    fn a_where_reads_back_from_its_json() {
        let ws = [
            json!({ "all": [] }),
            json!({ "any": [{ "type": ["todo"] }, { "tag": "work" }, { "not": { "path": ["status"], "eq": "x" } }] }),
            json!({ "all": [{ "path": ["blocks", "*", "text"], "contains": "seed" }, { "path": ["n"], "in": [1] }] }),
        ];
        for v in ws {
            assert_eq!(Where::of_json(&v).expect("a where").to_json(), v);
        }
        let one = Where::of_json(&json!({ "all": [{ "tag": "x" }] })).expect("a where");
        assert_eq!(one, Where::Label(Atom::TagHas("x".into())));
        for bad in [json!({ "path": ["n"] }), json!({ "path": ["n"], "eq": 1, "ne": 2 }), json!({ "colour": "red" })] {
            assert!(Where::of_json(&bad).is_err(), "{bad}");
        }
    }
}
