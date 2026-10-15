//! Ops, as in `avendb/spec/AvenDB/Ops.lean`: one JSON language to read and change any record, whatever its schema
//! (`avendb/docs/ARCHITECTURE.md` §8). This module is the part on records alone; `engine` runs it on a device's Lab.
//!
//! - **Records, flat** (`Flat`). A record (what an item stores, or an app's view of it) is a JSON object, and so is a
//!   row of a list of records, whose fields may hold lists of records in turn, at any depth. Flat, a record is a value
//!   at each place (`Path`: a field of the record, or of a row, named by the chain of rows around it from the top) and
//!   the rows of each list of records in order, each list named by the place of its field. A list of records is an
//!   array whose every item is an object with an integer `id` (an empty array too); a row is named by its id, and where
//!   several rows of its list share one (two devices added one at once) also by how many rows with that id come before
//!   it (`Key`).
//! - **Changes** (`Change`, `diff`). What a write did, in a normal form: a place's new value, a list's new rows. The
//!   diff of two records applied to the first gives the second (O1), so nothing a write did escapes its diff.
//! - **Ops** (`RecordOp`). What an app asks: `set` or `unset` a field, of the record or of a row at any depth, or a
//!   whole row; `insert`, `remove` and `move` a row of a list of records; `insert` a value into a list of values,
//!   `remove` one from it. Each names a place (`Loc`: its steps from the top, each row by its id) and changes nothing it
//!   doesn't cover (O2).
//! - **Queries** (`Where`). A `where` mixes labels, the tests of a share's selector, with tests of a record's values, at
//!   a place or in any row of a list (`*`), at any depth. Its labels make a selector that picks no less than it does
//!   (`Where::plan`), so a device picks entries by labels first and tests values only in what it opens (O3). A query
//!   reads each record so many rows down (`cut`): what lies deeper is never read, translated or tested.
//! - **Links** (`Link`, `follow`), as in `avendb/spec/AvenDB/Links.lean`. A field holds a record's own rows, or a
//!   link to an entry of a vault, maybe a row of it, at its newest or pinned at a version. A query follows the links
//!   at the places it names, a level at a time, each hop opening what the reader opens of it, or showing why it opens
//!   nothing there (L1, L2); every hop and every row is a level of the query's depth, so a cycle of links ends there
//!   (L3).
//!
//! A path is a JSON array: `[]` the whole record, `["title"]` a field, `["blocks", {"id": 2}]` the row of a list of
//! records with id 2, `["blocks", {"id": 2}, "text"]` a field of it, `["blocks", {"id": 2}, "children", {"id": 5},
//! "text"]` a field of a row of a list in that row, and so on; in a `where`, `["blocks", "*", "text"]` that field of
//! any row, at any depth. A change names a copy of a row by `{"id": 2, "copy": 1}`.
//!
//! Every walk over a record here is a loop over an explicit stack, never a recursion: a record nested deep can't
//! overflow the stack.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::{json, Map, Value};

use crate::id::{EditId, EntryId, VaultId};
use crate::slice::{Atom, Attrs, Selector};

/// A record: a JSON object.
pub type Record = Map<String, Value>;

/// A row of a list of records: its id, and how many rows with that id come before it in the list.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Key {
    pub id: i64,
    pub copy: usize,
}

/// A place of a record: field `field` of the record (`rows` empty), or of the row the chain `rows` names, each step
/// a list's field and the row's key, from the top. A list of records is named by the place of its field. Places of
/// one row sort together, its own fields first, then what is in its lists.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Path {
    pub rows: Vec<(String, Key)>,
    pub field: String,
}

/// A change: a place's new value (`None`: gone), or a list's new rows (`None`: the field no longer holds a list of
/// records).
#[derive(Clone, Debug, PartialEq)]
pub enum Change {
    Set(Path, Option<Value>),
    Order(Path, Option<Vec<Key>>),
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

/// Record `r` read `depth` rows down, as a query reads it (`engine`'s `query`): the rows of its lists, of theirs and so
/// on to `depth` levels, each list of rows deeper than that taken out of the row that holds it (all of the record's
/// own at 0; `Doc.cut`). Whether it took any out.
pub fn cut(r: &mut Record, depth: usize) -> bool {
    let places = empty_below(r, depth);
    take_out(r, &places);
    !places.is_empty()
}

/// Record `r` read `depth` rows down, as it is stored: each list of rows deeper than that emptied, so a schema still
/// reads the row that holds it with nothing below to translate, and the places of those lists, which `take_out`
/// takes out of what the schema read (`engine`'s `see_within`). A loop over an explicit stack, never a recursion.
pub fn empty_below(r: &mut Record, depth: usize) -> Vec<Path> {
    let mut places = vec![];
    let mut todo: Vec<(&mut Record, Vec<(String, Key)>)> = vec![(r, vec![])];
    while let Some((r, chain)) = todo.pop() {
        let held = |v: &Value| rows(v).is_some_and(|xs| !xs.is_empty());
        let deeper: Vec<String> = r.iter().filter(|(_, v)| held(v)).map(|(f, _)| f.clone()).collect();
        if chain.len() == depth {
            for f in deeper {
                r.insert(f.clone(), json!([]));
                places.push(Path { rows: chain.clone(), field: f });
            }
            continue;
        }
        for (f, v) in r {
            if !deeper.contains(f) {
                continue;
            }
            let keys: Vec<Key> = keyed(rows(v).expect("a list of rows")).into_iter().map(|(k, _)| k).collect();
            let xs = v.as_array_mut().expect("a list of rows");
            for (k, x) in keys.into_iter().zip(xs.iter_mut().filter_map(Value::as_object_mut)) {
                let mut down = chain.clone();
                down.push((f.clone(), k));
                todo.push((x, down));
            }
        }
    }
    places
}

/// Record `r` with the fields at `places` taken out, each where a row by its key holds it: whether it took any. A place
/// whose row isn't there (a copy an app doesn't see, a row a schema doesn't read) takes nothing.
pub fn take_out(r: &mut Record, places: &[Path]) -> bool {
    let mut took = false;
    'places: for p in places {
        let mut at: &mut Record = r;
        for (f, k) in &p.rows {
            let Some(row) = at.get_mut(f).and_then(|v| row_mut(v, k)) else { continue 'places };
            at = row;
        }
        took |= at.remove(&p.field).is_some();
    }
    took
}

/// The row with key `k` of the list of records `v`.
fn row_mut<'a>(v: &'a mut Value, k: &Key) -> Option<&'a mut Record> {
    let i = keyed(rows(v)?).iter().position(|(key, _)| key == k)?;
    v.as_array_mut()?.get_mut(i)?.as_object_mut()
}

/// A link (`Links.Link`): entry `entry` of vault `vault`, the row `row` names in it (each list's field and its row's
/// id, in turn: none for the whole record), at its newest, or pinned at version `at` (its writes). A record holds it
/// as `{"vault": id, "entry": id, "row"?: [field, {"id": n}, ..], "at"?: [edit, ..]}`, nothing else, `row` and `at`
/// left out where they name nothing; a schema says a field holds one (`"x-link"`, `lens::Schema`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Link {
    pub vault: VaultId,
    pub entry: EntryId,
    pub row: Vec<(String, i64)>,
    pub at: Option<Vec<EditId>>,
}

impl Link {
    /// The link a value is, if it is one.
    pub fn of_json(v: &Value) -> Option<Link> {
        let o = v.as_object()?;
        if !o.keys().all(|k| ["vault", "entry", "row", "at"].contains(&k.as_str())) {
            return None;
        }
        let vault = VaultId::from_hex(o.get("vault")?.as_str()?)?;
        let entry = EntryId::from_hex(o.get("entry")?.as_str()?)?;
        let row = match o.get("row") {
            None => vec![],
            Some(steps) => {
                let Loc(steps) = Loc::of_json(steps).ok()?;
                if steps.is_empty() || steps.len() % 2 != 0 {
                    return None;
                }
                let pair = |p: &[Seg]| match p {
                    [Seg::Field(f), Seg::Row(i)] => Some((f.clone(), *i)),
                    _ => None,
                };
                steps.chunks(2).map(pair).collect::<Option<Vec<_>>>()?
            }
        };
        let at = match o.get("at") {
            None => None,
            Some(xs) => {
                let xs = xs.as_array().filter(|xs| !xs.is_empty())?;
                Some(xs.iter().map(|x| EditId::from_hex(x.as_str()?)).collect::<Option<Vec<_>>>()?)
            }
        };
        Some(Link { vault, entry, row, at })
    }

    pub fn to_json(&self) -> Value {
        let mut o = Map::new();
        o.insert("vault".into(), self.vault.to_hex().into());
        o.insert("entry".into(), self.entry.to_hex().into());
        if !self.row.is_empty() {
            let steps = self.row.iter().flat_map(|(f, i)| [Value::from(f.as_str()), json!({ "id": i })]);
            o.insert("row".into(), steps.collect());
        }
        if let Some(at) = &self.at {
            o.insert("at".into(), at.iter().map(EditId::to_hex).collect());
        }
        Value::Object(o)
    }
}

/// Why a hop shows nothing (`Links.Why`): a name (`NoEntry`, `WrongVault`, `NoVersion`, `NoRow`, `Deep`, or the
/// engine's `NoSchema`) and words.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Unopened {
    pub name: &'static str,
    pub why: String,
}

/// What a reader opens of a link (`Links.Opens`), read so many rows down: the record or the row there, or why it opens
/// none.
pub type Opens<'a> = dyn FnMut(&Link, usize) -> Result<Record, Unopened> + 'a;

/// The places of the links at `targets` in `r`, each with how many rows down it lies: a field that holds a link, or
/// each link of a list a field holds, by its JSON pointer under `base`. A loop over an explicit stack.
fn link_places(r: &Record, base: &str, targets: &[Target]) -> Vec<(String, usize)> {
    let token = |s: &str| s.replace('~', "~0").replace('/', "~1");
    let mut out = vec![];
    for t in targets {
        let mut todo: Vec<(&Record, String, usize)> = vec![(r, base.to_string(), 0)];
        while let Some((at, ptr, n)) = todo.pop() {
            let Some((f, pick)) = t.rows.get(n) else {
                let here = format!("{ptr}/{}", token(&t.field));
                match at.get(&t.field) {
                    Some(v) if Link::of_json(v).is_some() => out.push((here, n)),
                    Some(Value::Array(xs)) => {
                        let links = xs.iter().enumerate().filter(|(_, x)| Link::of_json(x).is_some());
                        out.extend(links.map(|(i, _)| (format!("{here}/{i}"), n)));
                    }
                    _ => {}
                }
                continue;
            };
            let Some(list) = at.get(f).and_then(rows) else { continue };
            for (i, (k, row)) in keyed(list).into_iter().enumerate() {
                if pick.is_none_or(|p| p == k) {
                    todo.push((row, format!("{ptr}/{}/{i}", token(f)), n + 1));
                }
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Record `r`, read `depth` rows down, with the links at `targets` followed (`Links.follow`), a level at a time: a link
/// `k` rows down has `depth - k` levels left. A link with none left shows `"empty": "Deep"`; else it shows what
/// `open` opens of it, read one level less deep (`"to"`), with the links at `targets` in that followed in turn, or why
/// it opens nothing (`"empty"` and `"why"`). Every hop is a level, so a cycle of links ends at the depth (L3). A loop
/// over the hops still to make, never a recursion.
pub fn follow(r: &mut Record, depth: usize, targets: &[Target], open: &mut Opens) {
    let mut root = Value::Object(std::mem::take(r));
    let first = link_places(root.as_object().expect("a record"), "", targets);
    let mut todo: Vec<(String, usize)> =
        first.into_iter().filter_map(|(at, k)| Some((at, depth.checked_sub(k)?))).collect();
    while let Some((at, left)) = todo.pop() {
        let Some(v) = root.pointer_mut(&at) else { continue };
        let Some(link) = Link::of_json(v) else { continue };
        let o = v.as_object_mut().expect("a link is an object");
        let shown = match left.checked_sub(1) {
            None => Err(Unopened { name: "Deep", why: format!("deeper than the query reads ({depth} levels)") }),
            Some(rest) => open(&link, rest).map(|to| (to, rest)),
        };
        match shown {
            Ok((to, rest)) => {
                let next = link_places(&to, &format!("{at}/to"), targets);
                todo.extend(next.into_iter().filter_map(|(p, k)| Some((p, rest.checked_sub(k)?))));
                o.insert("to".into(), Value::Object(to));
            }
            Err(u) => {
                o.insert("empty".into(), u.name.into());
                o.insert("why".into(), u.why.into());
            }
        }
    }
    let Value::Object(m) = root else { unreachable!("a record stays one") };
    *r = m;
}

/// A record, flat: the value at each place, and the rows of each list of records in order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Flat {
    pub leaves: BTreeMap<Path, Value>,
    pub lists: BTreeMap<Path, Vec<Key>>,
}

impl Flat {
    pub fn of(r: &Record) -> Flat {
        Flat::of_with(r, |_| true)
    }

    /// Record `r`, flat, an array of rows read as a list of records only where `rows_at` says its place holds one, and
    /// as one value elsewhere: as a schema that calls a field one value reads it (`lens::Lane::fits`).
    pub fn of_with(r: &Record, rows_at: impl Fn(&Path) -> bool) -> Flat {
        let mut flat = Flat::default();
        // each record or row still to flatten, with the chain of rows to it
        let mut todo: Vec<(Vec<(String, Key)>, &Record)> = vec![(vec![], r)];
        while let Some((chain, fields)) = todo.pop() {
            for (f, v) in fields {
                // a row's id names it: no place of its own
                if !chain.is_empty() && f == "id" {
                    continue;
                }
                let place = Path { rows: chain.clone(), field: f.clone() };
                let Some(rows) = rows(v).filter(|_| rows_at(&place)) else {
                    flat.leaves.insert(place, v.clone());
                    continue;
                };
                let keyed = keyed(rows);
                for (k, row) in &keyed {
                    let mut deeper = chain.clone();
                    deeper.push((f.clone(), *k));
                    todo.push((deeper, row));
                }
                flat.lists.insert(place, keyed.iter().map(|(k, _)| *k).collect());
            }
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

    /// The record it is: each list's rows in order, each its id and its fields, and each other field's value, at every
    /// depth. A place in a row no list holds is in no record.
    pub fn record(&self) -> Record {
        // each record and row's fields, by the chain of rows to it
        let mut objects: BTreeMap<&[(String, Key)], Record> = BTreeMap::new();
        for (p, v) in &self.leaves {
            objects.entry(&p.rows).or_default().insert(p.field.clone(), v.clone());
        }
        // the deepest lists first, so each row is whole when its list takes it
        let mut lists: Vec<(&Path, &Vec<Key>)> = self.lists.iter().collect();
        lists.sort_by_key(|(p, _)| std::cmp::Reverse(p.rows.len()));
        for (p, ks) in lists {
            let mut chain = p.rows.clone();
            let mut rows = Vec::with_capacity(ks.len());
            for k in ks {
                chain.push((p.field.clone(), *k));
                let mut row = objects.remove(chain.as_slice()).unwrap_or_default();
                chain.pop();
                row.insert("id".into(), k.id.into());
                rows.push(Value::Object(row));
            }
            objects.entry(&p.rows).or_default().insert(p.field.clone(), Value::Array(rows));
        }
        objects.remove([].as_slice()).unwrap_or_default()
    }

    /// Row `k` of the list at `list`, its own fields: its id, its values, and each of its lists as `[]`, whatever its
    /// rows (the row as a scope of its own, what a schema reads of it).
    pub fn own(&self, list: &Path, k: &Key) -> Record {
        let mut r = self.fields(&list.row(k));
        r.insert("id".into(), k.id.into());
        r
    }

    /// The own fields of the record (`chain` empty) or of the row the chain names: its values, and each of its lists as
    /// `[]`, whatever its rows.
    pub fn fields(&self, chain: &[(String, Key)]) -> Record {
        let mut r = Record::new();
        let from = Path { rows: chain.to_vec(), field: String::new() };
        for (p, v) in self.leaves.range(&from..).take_while(|(p, _)| p.rows == chain) {
            r.insert(p.field.clone(), v.clone());
        }
        for (p, _) in self.lists.range(&from..).take_while(|(p, _)| p.rows == chain) {
            r.insert(p.field.clone(), Value::Array(vec![]));
        }
        r
    }

    /// Row `k` is in the list at `f`.
    pub fn holds(&self, f: &Path, k: &Key) -> bool {
        self.lists.get(f).is_some_and(|ks| ks.contains(k))
    }

    /// How many rows deep its deepest row is, counting the row itself (`Doc.depth`): 0 for a record that holds no row,
    /// 1 where only its own lists hold rows.
    pub fn depth(&self) -> usize {
        self.lists.iter().filter(|(_, ks)| !ks.is_empty()).map(|(f, _)| f.rows.len() + 1).max().unwrap_or(0)
    }

    /// The changes that make this record into `after`: each list's new rows, by place, then each place's new value, by
    /// place.
    pub fn diff(&self, after: &Flat) -> Vec<Change> {
        let (r, s) = (self, after);
        let lists: BTreeSet<&Path> = r.lists.keys().chain(s.lists.keys()).collect();
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
    /// A field of the record.
    pub fn top(f: impl Into<String>) -> Path {
        Path { rows: vec![], field: f.into() }
    }

    /// Field `g` of row `k` of the list at this place.
    pub fn child(&self, k: Key, g: impl Into<String>) -> Path {
        Path { rows: self.row(&k), field: g.into() }
    }

    /// The chain of rows to row `k` of the list at this place.
    pub fn row(&self, k: &Key) -> Vec<(String, Key)> {
        let mut chain = self.rows.clone();
        chain.push((self.field.clone(), *k));
        chain
    }

    /// The innermost row around the place: none for a field of the record itself, else the place of its list and its
    /// key (`Path.scope`).
    pub fn scope(&self) -> Option<(Path, Key)> {
        let ((f, k), above) = self.rows.split_last()?;
        Some((Path { rows: above.to_vec(), field: f.clone() }, *k))
    }

    /// `[field]`, or each row's list field and key in turn, then the field: `[f, {"id": n}, g, ..]`.
    pub fn to_json(&self) -> Value {
        let mut out = Vec::with_capacity(2 * self.rows.len() + 1);
        for (f, k) in &self.rows {
            out.push(Value::from(f.as_str()));
            out.push(k.to_json());
        }
        out.push(self.field.as_str().into());
        Value::Array(out)
    }

    /// A place from its path: `[field]`, or `[field, {"id": n}, field, ..]`, each row with its copy where it isn't
    /// the first.
    pub fn of_json(v: &Value) -> Result<Path, String> {
        let bad = || format!("{v} is no place: [field], or [field, {{\"id\": n}}, field] at any depth");
        let steps = v.as_array().ok_or_else(bad)?;
        let (last, pairs) = steps.split_last().ok_or_else(bad)?;
        if pairs.len() % 2 != 0 {
            return Err(bad());
        }
        let mut rows = Vec::with_capacity(pairs.len() / 2);
        for pair in pairs.chunks(2) {
            let Value::String(f) = &pair[0] else { return Err(bad()) };
            rows.push((f.clone(), Key::of_json(&pair[1]).map_err(|_| bad())?));
        }
        let Value::String(field) = last else { return Err(bad()) };
        Ok(Path { rows, field: field.clone() })
    }

    /// The value at the place in record `r`: none for a row's id, which names the row.
    pub fn at<'a>(&self, r: &'a Record) -> Option<&'a Value> {
        let mut at = r;
        for (f, k) in &self.rows {
            at = keyed(rows(at.get(f)?)?).into_iter().find(|(key, _)| key == k)?.1;
        }
        at.get(&self.field).filter(|_| self.rows.is_empty() || self.field != "id")
    }

    /// As a change names a list: a field of the record by its name, one in a row by its path.
    fn list_json(&self) -> Value {
        if self.rows.is_empty() { self.field.as_str().into() } else { self.to_json() }
    }
}

impl Change {
    /// How many rows deep it reaches (`Change.depth`): a value set in a row, as deep as the row; rows given to a list,
    /// one deeper than the list; a value or a list gone, or a list emptied, no row at all. No change a write that fits
    /// makes reaches deeper than `lens::CEILING`.
    pub fn depth(&self) -> usize {
        match self {
            Change::Set(p, Some(_)) => p.rows.len(),
            Change::Order(f, Some(ks)) if !ks.is_empty() => f.rows.len() + 1,
            _ => 0,
        }
    }

    /// `{"set": path, "value": v}`, `{"unset": path}`, or `{"rows": list, "keys": [key, ..]}` (`null`: no list), a
    /// list of the record by its field, one in a row by its path.
    pub fn to_json(&self) -> Value {
        match self {
            Change::Set(p, Some(v)) => json!({ "set": p.to_json(), "value": v }),
            Change::Set(p, None) => json!({ "unset": p.to_json() }),
            Change::Order(f, ks) => {
                let keys = ks.as_ref().map(|ks| ks.iter().map(Key::to_json).collect::<Vec<_>>());
                json!({ "rows": f.list_json(), "keys": keys })
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
        let f = match v.get("rows") {
            Some(Value::String(f)) => Path::top(f.as_str()),
            Some(p @ Value::Array(xs)) if xs.len() > 1 => Path::of_json(p)?,
            _ => return Err(format!("{v} is no change")),
        };
        let keys = match v.get("keys") {
            None | Some(Value::Null) => None,
            Some(ks) => {
                let ks = ks.as_array().ok_or("keys is a list")?;
                Some(ks.iter().map(Key::of_json).collect::<Result<_, _>>()?)
            }
        };
        Ok(Change::Order(f, keys))
    }
}

/// A step of the place an op names: a field, or the row of a list of records with an id (the first with it, the one
/// apps see).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Seg {
    Field(String),
    Row(i64),
}

/// What an op names: its steps from the top, field and row in turn. `[]` is the whole record, `[field]` a field,
/// `[field, row]` a row of the list in it, `[field, row, field]` a field of that row, and so on at any depth.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Default)]
pub struct Loc(pub Vec<Seg>);

impl Loc {
    /// The whole record.
    pub fn root() -> Loc {
        Loc(vec![])
    }

    /// A field of the record.
    pub fn field(f: impl Into<String>) -> Loc {
        Loc(vec![Seg::Field(f.into())])
    }

    /// Field `g` of the row with id `i` of list `f`.
    pub fn cell(f: impl Into<String>, i: i64, g: impl Into<String>) -> Loc {
        Loc(vec![Seg::Field(f.into()), Seg::Row(i), Seg::Field(g.into())])
    }

    /// The place with field `f` (and the row with id `i` of its list) one step down.
    fn and(&self, f: &str, i: Option<i64>) -> Loc {
        let mut steps = self.0.clone();
        steps.push(Seg::Field(f.to_string()));
        steps.extend(i.map(Seg::Row));
        Loc(steps)
    }

    /// It names `p`, or a field or a row above it, step by step: a row by its id, whatever its copy (`Loc.above`).
    fn above(&self, p: &Path) -> bool {
        let mut at = self.0.as_slice();
        for (f, k) in &p.rows {
            match at {
                [] => return true,
                [Seg::Field(g)] => return g == f,
                [Seg::Field(g), Seg::Row(i), rest @ ..] if g == f && *i == k.id => at = rest,
                _ => return false,
            }
        }
        match at {
            [] => true,
            [Seg::Field(g)] => *g == p.field,
            _ => false,
        }
    }

    /// It names a row of the list at `q` (`Loc.rowOf`).
    fn row_of(&self, q: &Path) -> bool {
        let mut at = self.0.as_slice();
        for (f, k) in &q.rows {
            match at {
                [Seg::Field(g), Seg::Row(i), rest @ ..] if g == f && *i == k.id => at = rest,
                _ => return false,
            }
        }
        matches!(at, [Seg::Field(g), Seg::Row(_)] if *g == q.field)
    }

    /// Whether changing at the place may make change `c`: what is at or under it, and for a row, its list's order. As
    /// rows are told apart by how many with their id come before them, changing one row of an id may renumber its
    /// copies, and what is under them: a step to a row covers every copy of its id.
    pub fn covers(&self, c: &Change) -> bool {
        match c {
            Change::Set(p, _) => self.above(p),
            Change::Order(q, _) => self.above(q) || self.row_of(q),
        }
    }

    /// It names a list: its last step is a field.
    pub fn is_list(&self) -> bool {
        matches!(self.0.last(), Some(Seg::Field(_)))
    }

    /// As a path names it.
    pub fn to_json(&self) -> Value {
        let step = |s: &Seg| match s {
            Seg::Field(f) => Value::from(f.as_str()),
            Seg::Row(i) => json!({ "id": i }),
        };
        Value::Array(self.0.iter().map(step).collect())
    }

    /// A place from its path: `[]`, or a field, then a row by its id (`{"id": n}`, no copy), and so on in turn.
    pub fn of_json(v: &Value) -> Result<Loc, String> {
        let row = |s: &Value| s.as_object().filter(|o| o.len() == 1).and_then(|o| o.get("id")?.as_i64());
        let bad = || format!("{v} is no path: [], or a field, a row {{\"id\": n}}, a field and so on in turn");
        let steps = v.as_array().ok_or_else(bad)?;
        let mut out = Vec::with_capacity(steps.len());
        for (n, s) in steps.iter().enumerate() {
            out.push(match (n % 2, s) {
                (0, Value::String(f)) => Seg::Field(f.clone()),
                (1, s) => Seg::Row(row(s).ok_or_else(bad)?),
                _ => return Err(bad()),
            });
        }
        Ok(Loc(out))
    }
}

/// What an op does to one field of the record, or of a row. A row is named by its id: an app's view holds one row of
/// each id.
#[derive(Clone, Debug, PartialEq)]
pub enum FieldOp {
    /// `{"op": "set", "path": [.., f], "value": v}`.
    Set(Value),
    /// `{"op": "unset", "path": [.., f]}`.
    Unset,
    /// `{"op": "set", "path": [.., f, {"id": n}], "value": row}`: the row, all its fields; its id, if given, is `n`.
    SetRow(i64, Record),
    /// `{"op": "insert", "path": [.., f], "value": row, "at": n}`: a new row, at place `n` or last.
    Insert(Record, Option<usize>),
    /// `{"op": "remove", "path": [.., f, {"id": n}]}`.
    Remove(i64),
    /// `{"op": "move", "path": [.., f, {"id": n}], "to": m}`: the row to place `m` of the list without it.
    Move(i64, usize),
    /// `{"op": "insert", "path": [.., f], "value": v, "at": n}`: a value into a list of values, at place `n` or last.
    Add(Value, Option<usize>),
    /// `{"op": "remove", "path": [.., f], "value": v}`: every copy of a value out of a list of values.
    Drop(Value),
}

/// What an app asks of a record, as `RecordOp::of_json` reads it: the whole record (`{"op": "set", "path": [],
/// "value": record}`), or an op on field `f` of the row its steps name (of the record itself, for none), at any depth.
#[derive(Clone, Debug, PartialEq)]
pub enum RecordOp {
    Put(Record),
    Edit(Loc, String, FieldOp),
}

/// The fields an op may carry: its own, and what the engine reads of it.
const OP_FIELDS: [&str; 9] = ["op", "path", "value", "at", "to", "entry", "line", "schema", "as"];

fn scalar(v: &Value) -> bool {
    !v.is_array() && !v.is_object()
}

impl FieldOp {
    /// The record or row's fields `r` after the op on field `f`, or `None` where it makes no sense of them: a row or a
    /// field that isn't there, a second row with one id, a place past the end of a list.
    fn run(&self, r: &mut Record, f: &str) -> Option<()> {
        // the rows of list `f`, and the place of the first with id `i`
        let row_of = |r: &Record, i: i64| -> Option<(Vec<Value>, usize)> {
            let rs = rows(r.get(f)?)?;
            let at = rs.iter().position(|x| x["id"].as_i64() == Some(i))?;
            Some((rs.to_vec(), at))
        };
        match self {
            FieldOp::Set(x) => drop(r.insert(f.to_string(), x.clone())),
            FieldOp::Unset => drop(r.remove(f)),
            FieldOp::SetRow(i, row) => {
                let (mut rs, at) = row_of(r, *i)?;
                rs[at] = Value::Object(row.clone());
                r.insert(f.to_string(), rs.into());
            }
            FieldOp::Insert(row, n) => {
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
                r.insert(f.to_string(), rs.into());
            }
            FieldOp::Remove(i) => {
                let (mut rs, at) = row_of(r, *i)?;
                rs.remove(at);
                r.insert(f.to_string(), rs.into());
            }
            FieldOp::Move(i, to) => {
                let (mut rs, at) = row_of(r, *i)?;
                let row = rs.remove(at);
                if *to > rs.len() {
                    return None;
                }
                rs.insert(*to, row);
                r.insert(f.to_string(), rs.into());
            }
            FieldOp::Add(v, n) => {
                let mut vs = match r.get(f) {
                    None => vec![],
                    Some(x @ Value::Array(xs)) if xs.is_empty() || rows(x).is_none() => xs.clone(),
                    Some(_) => return None,
                };
                let n = n.unwrap_or(vs.len());
                if n > vs.len() {
                    return None;
                }
                vs.insert(n, v.clone());
                r.insert(f.to_string(), vs.into());
            }
            FieldOp::Drop(v) => match r.get(f) {
                None => {}
                Some(Value::Array(xs)) if xs.is_empty() => {}
                Some(x @ Value::Array(xs)) if rows(x).is_none() => {
                    let kept: Vec<Value> = xs.iter().filter(|x| *x != v).cloned().collect();
                    r.insert(f.to_string(), kept.into());
                }
                Some(_) => return None,
            },
        }
        Some(())
    }
}

impl RecordOp {
    pub fn of_json(v: &Value) -> Result<RecordOp, String> {
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
        // the row the op works in, its field, and the row of that field's list it names, if it names one
        let (scope, f, id) = match loc.0.as_slice() {
            [] if name == "set" => match value()? {
                Value::Object(r) => return Ok(RecordOp::Put(r)),
                _ => return Err("a record is an object".into()),
            },
            [above @ .., Seg::Field(f)] => (Loc(above.to_vec()), f.clone(), None),
            [above @ .., Seg::Field(f), Seg::Row(i)] => (Loc(above.to_vec()), f.clone(), Some(*i)),
            _ => return Err(format!("{name} makes no sense at {}", loc.to_json())),
        };
        let op = match (name, id) {
            ("set", None) => FieldOp::Set(value()?),
            ("set", Some(i)) => FieldOp::SetRow(i, row(value()?, Some(i))?),
            ("unset", None) => FieldOp::Unset,
            ("insert", None) => match value()? {
                x @ Value::Object(_) => FieldOp::Insert(row(x, None)?, at()?),
                x if scalar(&x) => FieldOp::Add(x, at()?),
                _ => return Err("insert takes a row, or a value for a list of values".into()),
            },
            ("remove", Some(i)) => FieldOp::Remove(i),
            ("remove", None) => match value()? {
                x if scalar(&x) => FieldOp::Drop(x),
                _ => return Err("remove takes the value to take out of a list of values".into()),
            },
            ("move", Some(i)) => {
                let to = o.get("to").and_then(Value::as_u64).ok_or("move names the place it moves to: to")?;
                FieldOp::Move(i, to as usize)
            }
            (name, _) => return Err(format!("{name} makes no sense at {}", loc.to_json())),
        };
        Ok(RecordOp::Edit(scope, f, op))
    }

    pub fn to_json(&self) -> Value {
        let (scope, f, op) = match self {
            RecordOp::Put(r) => return json!({ "op": "set", "path": [], "value": r }),
            RecordOp::Edit(scope, f, op) => (scope, f, op),
        };
        let path = |i: Option<i64>| scope.and(f, i).to_json();
        let at = |mut o: Value, n: &Option<usize>| {
            if let Some(n) = n {
                o["at"] = (*n).into();
            }
            o
        };
        match op {
            FieldOp::Set(v) => json!({ "op": "set", "path": path(None), "value": v }),
            FieldOp::Unset => json!({ "op": "unset", "path": path(None) }),
            FieldOp::SetRow(i, r) => json!({ "op": "set", "path": path(Some(*i)), "value": r }),
            FieldOp::Insert(r, n) => at(json!({ "op": "insert", "path": path(None), "value": r }), n),
            FieldOp::Remove(i) => json!({ "op": "remove", "path": path(Some(*i)) }),
            FieldOp::Move(i, to) => json!({ "op": "move", "path": path(Some(*i)), "to": to }),
            FieldOp::Add(v, n) => at(json!({ "op": "insert", "path": path(None), "value": v }), n),
            FieldOp::Drop(v) => json!({ "op": "remove", "path": path(None), "value": v }),
        }
    }

    /// An op on field `f` of the record itself.
    pub fn top(f: impl Into<String>, op: FieldOp) -> RecordOp {
        RecordOp::Edit(Loc::root(), f.into(), op)
    }

    /// The place it names.
    pub fn loc(&self) -> Loc {
        match self {
            RecordOp::Put(_) => Loc::root(),
            RecordOp::Edit(scope, f, op) => {
                let id = match op {
                    FieldOp::SetRow(i, _) | FieldOp::Remove(i) | FieldOp::Move(i, _) => Some(*i),
                    FieldOp::Insert(r, _) => Some(r["id"].as_i64().expect("a row has an integer id")),
                    FieldOp::Set(_) | FieldOp::Unset | FieldOp::Add(..) | FieldOp::Drop(_) => None,
                };
                scope.and(f, id)
            }
        }
    }

    /// The record after the op, or `None` where it makes no sense of it: a row or a field that isn't there, a row
    /// around it too, a second row with one id, a place past the end of a list, a row's id changed.
    pub fn run(&self, r: &Record) -> Option<Record> {
        let (scope, f, op) = match self {
            RecordOp::Put(d) => return Some(d.clone()),
            RecordOp::Edit(scope, f, op) => (scope, f, op),
        };
        // a row's id names it: no op changes it
        if !scope.0.is_empty() && f == "id" {
            return None;
        }
        let mut out = r.clone();
        // down to the row the op works in, by the first row of each list with each id
        let mut at: &mut Record = &mut out;
        for pair in scope.0.chunks(2) {
            let [Seg::Field(g), Seg::Row(i)] = pair else { return None };
            let list = at.get_mut(g)?;
            rows(list)?;
            let rs = list.as_array_mut()?;
            let n = rs.iter().position(|x| x["id"].as_i64() == Some(*i))?;
            at = rs[n].as_object_mut()?;
        }
        op.run(at, f)?;
        Some(out)
    }
}

/// Ops one after the other: `None` if one makes no sense.
pub fn run_all(r: &Record, ops: &[RecordOp]) -> Option<Record> {
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

/// An order on values: of two numbers (two integers exactly), or of two texts; any other two aren't ordered.
fn lt(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => match (x.as_i64(), y.as_i64()) {
            (Some(x), Some(y)) => x < y,
            _ => matches!((x.as_f64(), y.as_f64()), (Some(x), Some(y)) if x < y),
        },
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

/// What a test reads: field `field` of the record, or of each row the steps `rows` reach, each step a list's field
/// and its row's key, or `None` (`"*"`) for any of its rows: the test holds if it holds of one. A key that names no
/// row reaches a row with nothing in it.
#[derive(Clone, Debug, PartialEq)]
pub struct Target {
    pub rows: Vec<(String, Option<Key>)>,
    pub field: String,
}

impl Target {
    /// What a place holds.
    pub fn at(p: &Path) -> Target {
        Target { rows: p.rows.iter().map(|(f, k)| (f.clone(), Some(*k))).collect(), field: p.field.clone() }
    }

    pub fn holds(&self, r: &Record, t: &Test) -> bool {
        // each record or row the steps reached, with how many they took: none for a row that isn't there
        let mut todo: Vec<(Option<&Record>, usize)> = vec![(Some(r), 0)];
        while let Some((at, n)) = todo.pop() {
            let Some((f, pick)) = self.rows.get(n) else {
                // a row's id names it: no value a test sees
                let v = at.and_then(|x| x.get(&self.field)).filter(|_| n == 0 || self.field != "id");
                if t.test(v) {
                    return true;
                }
                continue;
            };
            let list = at.and_then(|x| x.get(f)).and_then(rows).map(keyed);
            match pick {
                Some(k) => todo.push((list.and_then(|rs| rs.into_iter().find(|(key, _)| key == k)).map(|r| r.1), n + 1)),
                None => todo.extend(list.into_iter().flatten().map(|(_, row)| (Some(row), n + 1))),
            }
        }
        false
    }

    /// `[field]`, or each list's field and its row's key or `"*"` in turn, then the field.
    pub fn of_json(v: &Value) -> Result<Target, String> {
        let bad = || {
            format!("{v} is no place to test: [field], or [field, {{\"id\": n}} or \"*\", field] at any depth")
        };
        let steps = v.as_array().ok_or_else(bad)?;
        let (last, pairs) = steps.split_last().ok_or_else(bad)?;
        if pairs.len() % 2 != 0 {
            return Err(bad());
        }
        let mut rows = Vec::with_capacity(pairs.len() / 2);
        for pair in pairs.chunks(2) {
            let Value::String(f) = &pair[0] else { return Err(bad()) };
            let pick = match &pair[1] {
                Value::String(star) if star == "*" => None,
                k => Some(Key::of_json(k).map_err(|_| bad())?),
            };
            rows.push((f.clone(), pick));
        }
        let Value::String(field) = last else { return Err(bad()) };
        Ok(Target { rows, field: field.clone() })
    }

    pub fn to_json(&self) -> Value {
        let mut out = Vec::with_capacity(2 * self.rows.len() + 1);
        for (f, pick) in &self.rows {
            out.push(Value::from(f.as_str()));
            out.push(pick.as_ref().map_or_else(|| "*".into(), Key::to_json));
        }
        out.push(self.field.as_str().into());
        Value::Array(out)
    }
}

/// A query's `where`: `{"all": [w, ..]}`, `{"any": [w, ..]}`, `{"not": w}`, a label as a share's selector writes it
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

    /// It tests labels alone, with no test of a value and no `not`: its cover picks exactly what it does, and a share
    /// may pick by it (`slice::Selector::of_json`).
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

    /// The selector a device picks entries by, a share's, before it tests what it opens: its labels', or the whole
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

    fn k(id: i64, copy: usize) -> Key {
        Key { id, copy }
    }

    /// An outline five lists deep: sections, their items, their steps, their notes, their marks.
    fn outline() -> Record {
        record(json!({
            "title": "Plan",
            "sections": [
                { "id": 1, "name": "a", "items": [
                    { "id": 1, "text": "x", "steps": [
                        { "id": 1, "notes": [{ "id": 1, "marks": [{ "id": 1, "c": "red" }], "t": "n" }] },
                        { "id": 1, "notes": [] },
                    ] },
                ] },
                { "id": 2, "items": [] },
            ],
        }))
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
        assert_eq!(flat.lists[&Path::top("blocks")], vec![k(1, 0), k(1, 1), k(2, 0)]);
        assert_eq!(flat.lists[&Path::top("tags")], vec![]);
        assert_eq!(flat.leaves[&Path::top("odd")], json!([1, { "id": 2 }]));
        assert_eq!(flat.leaves[&Path::top("blocks").child(k(1, 1), "text")], json!("b"));
        assert_eq!(flat.record(), r);
    }

    #[test]
    fn a_nested_record_is_its_flat_form() {
        let r = outline();
        let flat = Flat::of(&r);
        let items = Path::top("sections").child(k(1, 0), "items");
        let steps = items.child(k(1, 0), "steps");
        let notes = steps.child(k(1, 0), "notes");
        let marks = notes.child(k(1, 0), "marks");
        assert_eq!(flat.lists[&items], vec![k(1, 0)]);
        assert_eq!(flat.lists[&steps], vec![k(1, 0), k(1, 1)]);
        assert_eq!(flat.lists[&steps.child(k(1, 1), "notes")], vec![]);
        assert_eq!(flat.lists[&Path::top("sections").child(k(2, 0), "items")], vec![]);
        assert_eq!(flat.leaves[&marks.child(k(1, 0), "c")], json!("red"));
        assert_eq!(marks.child(k(1, 0), "c").at(&r), Some(&json!("red")));
        assert_eq!(marks.child(k(1, 0), "id").at(&r), None);
        assert!(!flat.leaves.keys().any(|p| !p.rows.is_empty() && p.field == "id"));
        assert_eq!(flat.record(), r);
        // a row's own fields: its values, and its lists as []
        let own = flat.own(&Path::top("sections"), &k(1, 0));
        assert_eq!(Value::Object(own), json!({ "id": 1, "name": "a", "items": [] }));
        assert_eq!(steps.scope(), Some((items.clone(), k(1, 0))));
        assert_eq!(Path::top("title").scope(), None);
    }

    #[test]
    fn a_deep_record_walks_without_recursion() {
        // a list 1000 rows deep, walked on a stack far too small for a recursion that deep: every walk is a loop
        let mut v = json!({ "id": 0, "t": "leaf" });
        for n in 1..1000 {
            v = json!({ "id": n, "in": [v] });
        }
        let r = record(json!({ "in": [v] }));
        let walk = || {
            let flat = Flat::of(&r);
            assert_eq!(flat.lists.len(), 1000);
            let deepest = flat.leaves.keys().next().expect("a leaf").clone();
            assert_eq!(deepest.rows.len(), 1000);
            assert_eq!(deepest.at(&r), Some(&json!("leaf")));
            assert_eq!(Path::of_json(&deepest.to_json()).as_ref(), Ok(&deepest));
            assert!(Target::at(&deepest).holds(&r, &Test::Eq(json!("leaf"))));
            let mut changed = flat.clone();
            changed.apply(&[Change::Set(deepest.clone(), Some(json!("new")))]);
            let after = changed.record();
            assert_eq!(flat.diff(&Flat::of(&after)), vec![Change::Set(deepest.clone(), Some(json!("new")))]);
            let mut loc = Loc::of_json(&deepest.to_json()).expect("a path");
            let Some(Seg::Field(f)) = loc.0.pop() else { panic!("a field") };
            (after, RecordOp::Edit(loc, f, FieldOp::Set(json!("new"))))
        };
        let (after, op) = std::thread::scope(|s| {
            let small = std::thread::Builder::new().stack_size(64 * 1024);
            small.spawn_scoped(s, walk).expect("a thread").join().expect("no overflow")
        });
        // serde_json clones, compares and drops a record by recursion: that, on the stack this test runs on
        assert_eq!(op.run(&r), Some(after));
        // read 999 rows down, by loops too: the last list emptied, then taken out
        let deep = r.clone();
        let (deep, places) = std::thread::scope(|s| {
            let small = std::thread::Builder::new().stack_size(64 * 1024);
            let read = move || {
                let mut deep = deep;
                let places = empty_below(&mut deep, 999);
                assert!(take_out(&mut deep, &places));
                (deep, places)
            };
            small.spawn_scoped(s, read).expect("a thread").join().expect("no overflow")
        });
        assert_eq!((places.len(), places[0].rows.len(), places[0].field.as_str()), (1, 999, "in"));
        assert_eq!(Flat::of(&deep).depth(), 999);
    }

    /// A query's cut, in two steps as the engine makes it around a lens: each list too deep emptied where it is
    /// stored, so a schema still reads the row that holds it, then taken out of what it read.
    #[test]
    fn a_record_read_so_many_rows_down_holds_no_list_deeper() {
        let r = outline();
        for depth in 0..7 {
            let (mut whole, mut emptied) = (r.clone(), r.clone());
            let was = cut(&mut whole, depth);
            let places = empty_below(&mut emptied, depth);
            assert_eq!(Flat::of(&emptied).depth(), Flat::of(&r).depth().min(depth), "{depth}: the lists stay, empty");
            for p in &places {
                assert_eq!(Flat::of(&emptied).lists.get(p), Some(&vec![]), "{depth}: {p:?} is emptied");
            }
            assert_eq!(take_out(&mut emptied, &places), was);
            assert_eq!(emptied, whole, "{depth}");
            assert_eq!(was, depth < 5, "{depth}");
            assert!(Flat::of(&whole).depth() <= depth);
        }
        // a copy of a row a reader doesn't see takes out nothing of the row it sees
        let mut seen = record(json!({ "steps": [{ "id": 1, "notes": [{ "id": 1 }] }] }));
        let copy = Path { rows: vec![("steps".into(), k(1, 1))], field: "notes".into() };
        assert!(!take_out(&mut seen, &[copy]));
        assert_eq!(seen["steps"][0]["notes"], json!([{ "id": 1 }]));
    }

    fn id(n: u8) -> String {
        format!("{n:064x}")
    }

    fn link(entry: u8) -> Value {
        json!({ "vault": id(1), "entry": id(entry) })
    }

    #[test]
    fn a_link_reads_back_from_its_json() {
        let whole = json!({ "vault": id(1), "entry": id(2), "row": ["blocks", { "id": 2 }, "kids", { "id": 5 }],
            "at": [id(7), id(8)] });
        let l = Link::of_json(&whole).expect("a link");
        assert_eq!((l.row.len(), l.at.as_ref().map(Vec::len)), (2, Some(2)));
        assert_eq!(l.to_json(), whole);
        assert_eq!(Link::of_json(&link(3)).expect("a link to the newest").to_json(), link(3));
        let with = |k: &str, v: Value| {
            let mut x = link(3);
            x[k] = v;
            x
        };
        let bad = [
            with("colour", json!("red")),
            with("entry", json!("3")),
            with("vault", json!(1)),
            with("row", json!([])),
            with("row", json!(["blocks"])),
            with("row", json!(["blocks", { "id": 2 }, "text"])),
            with("at", json!([])),
            with("at", json!(["x"])),
            json!([id(1), id(3)]),
        ];
        for v in bad {
            assert_eq!(Link::of_json(&v), None, "{v}");
        }
    }

    /// Links followed at any depth, a level at a time: in rows (`*`), in a list of links, one level less deep at each
    /// hop, each row a level too, a cycle ending at the depth, a hop opening nothing showing why, and a value that
    /// isn't a link left as it is.
    #[test]
    fn links_are_followed_a_level_at_a_time() {
        // Ada and Bo are each other's friend; 9 opens nothing
        fn open_of(asked: &mut Vec<(i64, usize)>) -> impl FnMut(&Link, usize) -> Result<Record, Unopened> + '_ {
            move |l: &Link, rows: usize| {
                let n = i64::from(l.entry.0[31]);
                asked.push((n, rows));
                let mut r = match n {
                    1 => record(json!({ "name": "Ada", "friend": link(2), "kids": [{ "id": 1, "friend": link(2) }] })),
                    2 => record(json!({ "name": "Bo", "friend": link(1) })),
                    _ => return Err(Unopened { name: "NoEntry", why: "none".into() }),
                };
                cut(&mut r, rows);
                Ok(r)
            }
        }
        let board = record(json!({
            "cards": [{ "id": 1, "owner": link(1) }, { "id": 2, "owner": "Bo" }],
            "refs": [link(2), "not a link", link(9)],
        }));
        let targets: Vec<Target> = [json!(["cards", "*", "owner"]), json!(["refs"]), json!(["friend"])]
            .iter()
            .map(|t| Target::of_json(t).expect("a place"))
            .collect();
        let mut asked = vec![];
        let mut r = board.clone();
        follow(&mut r, 2, &targets, &mut open_of(&mut asked));
        // a card's owner is a row down: one level left, so Ada is read no rows down and her friend lies too deep
        let ada = &r["cards"][0]["owner"];
        assert_eq!((&ada["to"]["name"], &ada["to"]["friend"]["empty"]), (&json!("Ada"), &json!("Deep")));
        assert_eq!(ada["to"].get("kids"), None, "read no rows down");
        assert_eq!(r["cards"][1]["owner"], "Bo");
        // a list of links: Bo, then Ada one level less deep, then too deep; a value that isn't a link stays
        let bo = &r["refs"][0];
        assert_eq!((&bo["to"]["name"], &bo["to"]["friend"]["to"]["name"]), (&json!("Bo"), &json!("Ada")));
        assert_eq!(bo["to"]["friend"]["to"]["friend"]["empty"], "Deep");
        assert_eq!(r["refs"][1], "not a link");
        assert_eq!((&r["refs"][2]["empty"], &r["refs"][2]["why"]), (&json!("NoEntry"), &json!("none")));
        asked.sort();
        assert_eq!(asked, [(1, 0), (1, 0), (2, 1), (9, 1)]);
        // a cycle ends at the depth: as many hops as the depth, then `Deep`
        for depth in 0..8 {
            let mut r = record(json!({ "friend": link(1) }));
            follow(&mut r, depth, &targets, &mut open_of(&mut vec![]));
            let mut at = &r["friend"];
            let mut hops = 0;
            while let Some(to) = at.get("to") {
                hops += 1;
                at = &to["friend"];
            }
            assert_eq!((hops, &at["empty"]), (depth, &json!("Deep")));
        }
        // a link in a row of a record a hop opened: Ada's kids, a row down from her, one level less again
        let mut r = record(json!({ "friend": link(1) }));
        let kids = [Target::of_json(&json!(["kids", "*", "friend"])).unwrap(), targets[2].clone()];
        follow(&mut r, 3, &kids, &mut open_of(&mut vec![]));
        assert_eq!(r["friend"]["to"]["kids"][0]["friend"]["to"]["name"], "Bo");
        assert_eq!(r["friend"]["to"]["kids"][0]["friend"]["to"]["friend"]["empty"], "Deep");
        // nothing named, nothing followed
        let mut r = board.clone();
        follow(&mut r, 16, &[], &mut open_of(&mut vec![]));
        assert_eq!(r, board);
    }

    #[test]
    fn a_diff_applied_gives_the_record_after() {
        let records = [
            json!({}),
            json!({ "title": "Plan", "blocks": [{ "id": 1, "text": "a" }, { "id": 2, "text": "b" }] }),
            json!({ "title": "Plan", "blocks": [{ "id": 2, "text": "b" }, { "id": 1, "text": "c" }, { "id": 1 }] }),
            json!({ "blocks": "flat", "tags": ["x"] }),
            json!({ "blocks": [], "tags": [] }),
            json!({ "blocks": [{ "id": 1, "kids": [{ "id": 3, "t": "x" }, { "id": 3 }] }] }),
            json!({ "blocks": [{ "id": 1, "kids": [{ "id": 3, "t": "y", "more": [{ "id": 4 }] }] }, { "id": 2 }] }),
            json!({ "blocks": [{ "id": 1, "kids": "flat" }] }),
            Value::Object(outline()),
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
    fn a_change_keeps_its_json_at_depth_one() {
        let set = Change::Set(Path::top("blocks").child(k(2, 1), "text"), Some(json!("z")));
        assert_eq!(set.to_json(), json!({ "set": ["blocks", { "id": 2, "copy": 1 }, "text"], "value": "z" }));
        let order = Change::Order(Path::top("blocks"), Some(vec![k(1, 0)]));
        assert_eq!(order.to_json(), json!({ "rows": "blocks", "keys": [{ "id": 1 }] }));
        let deep = Change::Order(Path::top("blocks").child(k(1, 0), "kids"), None);
        assert_eq!(deep.to_json(), json!({ "rows": ["blocks", { "id": 1 }, "kids"], "keys": null }));
        assert_eq!(Change::of_json(&deep.to_json()), Ok(deep));
        for bad in [json!({ "rows": ["blocks"], "keys": [] }), json!({ "rows": ["blocks", { "id": 1 }], "keys": [] })] {
            assert!(Change::of_json(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_place_covers_what_is_under_it() {
        let kids = Path::top("blocks").child(k(1, 1), "kids");
        let text = kids.child(k(3, 0), "text");
        let set = |p: &Path| Change::Set(p.clone(), None);
        let order = |p: &Path| Change::Order(p.clone(), None);
        let loc = |v: Value| Loc::of_json(&v).expect("a path");
        assert!(loc(json!([])).covers(&set(&text)));
        assert!(loc(json!(["blocks"])).covers(&set(&text)));
        assert!(loc(json!(["blocks", { "id": 1 }])).covers(&set(&text)));
        assert!(loc(json!(["blocks", { "id": 1 }, "kids"])).covers(&set(&text)));
        assert!(loc(json!(["blocks", { "id": 1 }, "kids", { "id": 3 }])).covers(&set(&text)));
        assert!(loc(json!(["blocks", { "id": 1 }, "kids", { "id": 3 }, "text"])).covers(&set(&text)));
        assert!(!loc(json!(["blocks", { "id": 1 }, "kids", { "id": 3 }, "note"])).covers(&set(&text)));
        assert!(!loc(json!(["blocks", { "id": 2 }, "kids"])).covers(&set(&text)));
        assert!(!loc(json!(["blocks", { "id": 1 }, "kids", { "id": 3 }])).covers(&set(&kids)));
        // a row covers its list's order, and nothing of its siblings
        assert!(loc(json!(["blocks", { "id": 1 }, "kids", { "id": 9 }])).covers(&order(&kids)));
        assert!(loc(json!(["blocks", { "id": 1 }, "kids"])).covers(&order(&kids)));
        assert!(!loc(json!(["blocks", { "id": 1 }, "kids", { "id": 9 }])).covers(&set(&text)));
        assert!(!loc(json!(["blocks", { "id": 1 }, "kids", { "id": 3 }, "more", { "id": 1 }])).covers(&order(&kids)));
        assert!(loc(json!(["blocks", { "id": 1 }])).covers(&order(&Path::top("blocks"))));
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
            json!({ "op": "set", "path": ["blocks", { "id": 2 }, "kids", { "id": 5 }, "text"], "value": "z" }),
            json!({ "op": "set", "path": ["blocks", { "id": 2 }, "kids", { "id": 5 }], "value": { "id": 5 } }),
            json!({ "op": "insert", "path": ["blocks", { "id": 2 }, "kids"], "value": { "id": 6 }, "at": 1 }),
            json!({ "op": "move", "path": ["blocks", { "id": 2 }, "kids", { "id": 5 }], "to": 0 }),
            json!({ "op": "remove", "path": ["a", { "id": 1 }, "b", { "id": 2 }, "c", { "id": 3 }] }),
            json!({ "op": "insert", "path": ["blocks", { "id": 2 }, "tags"], "value": "x" }),
        ];
        for v in ops {
            assert_eq!(RecordOp::of_json(&v).expect("an op").to_json(), v);
        }
        let row = RecordOp::of_json(&json!({ "op": "set", "path": ["blocks", { "id": 2 }], "value": { "text": "z" } }));
        let want = record(json!({ "text": "z", "id": 2 }));
        assert_eq!(row, Ok(RecordOp::top("blocks", FieldOp::SetRow(2, want))));
        let deep = RecordOp::of_json(&json!({ "op": "remove", "path": ["blocks", { "id": 2 }, "kids", { "id": 5 }] }));
        let scope = Loc(vec![Seg::Field("blocks".into()), Seg::Row(2)]);
        assert_eq!(deep, Ok(RecordOp::Edit(scope, "kids".into(), FieldOp::Remove(5))));
        let bad = [
            json!({ "op": "set", "path": ["blocks", { "id": 2 }], "value": { "id": 3 } }),
            json!({ "op": "unset", "path": [] }),
            json!({ "op": "insert", "path": ["tags"], "value": [1] }),
            json!({ "op": "move", "path": ["blocks", { "id": 2 }] }),
            json!({ "op": "set", "path": ["blocks", { "id": 2, "copy": 1 }, "text"], "value": "z" }),
            json!({ "op": "set", "path": ["title"], "value": "y", "vaule": 1 }),
            json!({ "op": "set", "path": [{ "id": 2 }], "value": "y" }),
            json!({ "op": "set", "path": ["blocks", "kids"], "value": "y" }),
            json!({ "op": "set", "path": ["blocks", { "id": 2 }, { "id": 3 }], "value": "y" }),
        ];
        for v in bad {
            assert!(RecordOp::of_json(&v).is_err(), "{v}");
        }
    }

    #[test]
    fn an_op_runs_at_any_depth() {
        let r = outline();
        let op = |v: Value| RecordOp::of_json(&v).expect("an op");
        let steps = json!(["sections", { "id": 1 }, "items", { "id": 1 }, "steps"]);
        let mark = json!(["sections", { "id": 1 }, "items", { "id": 1 }, "steps", { "id": 1 }, "notes", { "id": 1 },
            "marks", { "id": 1 }, "c"]);
        let set = op(json!({ "op": "set", "path": mark, "value": "blue" }));
        let after = set.run(&r).expect("set at depth 5");
        let changes = diff(&r, &after);
        assert_eq!(changes.len(), 1);
        assert!(set.loc().covers(&changes[0]));
        // an insert goes in the first row of each id, and is the one row of its id
        let insert = op(json!({ "op": "insert", "path": steps, "value": { "id": 2 }, "at": 0 }));
        let after = insert.run(&r).expect("an insert at depth 3");
        let ks: Vec<Key> = Flat::of(&after).lists[&Path::of_json(&json!(["sections", { "id": 1 }, "items", { "id": 1 },
            "steps"])).expect("a path")]
        .clone();
        assert_eq!(ks, vec![k(2, 0), k(1, 0), k(1, 1)]);
        assert!(diff(&r, &after).iter().all(|c| insert.loc().covers(c)));
        assert_eq!(op(json!({ "op": "insert", "path": steps, "value": { "id": 1 } })).run(&r), None);
        // a row that isn't there, at any step, makes no sense
        let missing = json!(["sections", { "id": 3 }, "items", { "id": 1 }, "steps"]);
        assert_eq!(op(json!({ "op": "insert", "path": missing, "value": { "id": 2 } })).run(&r), None);
        // nor does a change to a row's id
        let id = json!(["sections", { "id": 1 }, "items", { "id": 1 }, "id"]);
        assert_eq!(op(json!({ "op": "set", "path": id, "value": 9 })).run(&r), None);
        // a move and a remove deep down
        let mv = op(json!({ "op": "move", "path": ["sections", { "id": 2 }], "to": 0 }));
        assert_eq!(mv.run(&r).expect("a move")["sections"][0]["id"], json!(2));
        let rm = op(json!({ "op": "remove", "path": ["sections", { "id": 1 }, "items", { "id": 1 }] }));
        assert_eq!(rm.run(&r).expect("a remove")["sections"][0]["items"], json!([]));
    }

    #[test]
    fn a_target_reads_at_any_depth() {
        let r = outline();
        let target = |v: Value| Target::of_json(&v).expect("a target");
        let any_mark = json!(["sections", "*", "items", "*", "steps", "*", "notes", "*", "marks", "*", "c"]);
        assert!(target(any_mark.clone()).holds(&r, &Test::Eq(json!("red"))));
        assert!(!target(any_mark.clone()).holds(&r, &Test::Eq(json!("blue"))));
        assert_eq!(target(any_mark.clone()).to_json(), any_mark);
        let one = json!(["sections", { "id": 1 }, "items", "*", "text"]);
        assert!(target(one).holds(&r, &Test::Eq(json!("x"))));
        // a row that isn't there holds nothing; no row of a list that isn't there is any
        let missing = json!(["sections", { "id": 3 }, "name"]);
        assert!(target(missing).holds(&r, &Test::Exists(false)));
        assert!(!target(json!(["nothing", "*", "name"])).holds(&r, &Test::Exists(false)));
        assert!(!target(json!(["sections", "*", "id"])).holds(&r, &Test::Exists(true)));
        for bad in [json!([]), json!(["a", "*"]), json!(["a", 1, "b"]), json!(["a", "b", "c"])] {
            assert!(Target::of_json(&bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_where_reads_back_from_its_json() {
        let ws = [
            json!({ "all": [] }),
            json!({ "any": [{ "type": ["todo"] }, { "tag": "work" }, { "not": { "path": ["status"], "eq": "x" } }] }),
            json!({ "all": [{ "path": ["blocks", "*", "text"], "contains": "seed" }, { "path": ["n"], "in": [1] }] }),
            json!({ "path": ["blocks", { "id": 1 }, "kids", "*", "text"], "eq": "x" }),
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
