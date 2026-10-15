//! One merge of one line of an entry's history into another, place by place (T10d, T10e, T10h;
//! `avendb/spec/AvenDB/Doc.lean`'s `mergeInto`). A merge keeps every write of both lines in the history (T10g); this is
//! what the line merged into then shows, worked out from three records as git merges a file: the base, what both
//! lines' histories hold in common; ours, the line merged into; theirs, the line merged in.
//!
//! A record is seen place by place (`Place`): each field outside lists of records, each row of a list of records with
//! all its fields, and the order of each list's rows. A place only one side changed since the base shows that change,
//! and a place both changed alike shows it. A place both changed differently shows both changes joined where they don't
//! clash (`join`): a text both edited at places apart, a list of values both added to or took from, an object whose
//! fields they changed apart, rows both added or moved apart. A row of the record's own lists is one place, whatever
//! it holds: inside it, its fields join as an object's and its lists of records, at any depth, row by row by id
//! (`join_row`), and a clash anywhere in it makes the whole row the conflict. Where they do clash, a conflict, the line
//! merged into keeps its own value, unless the person merging takes the other's there (`take`). So nothing the line
//! merged into changed is lost (T10d), all the other changed alone lands (T10e), and the person's choice touches the
//! conflicts alone.
//!
//! The record is then made again from its places: each field, each row that is there, and each list's rows in the
//! merged order, a row kept there that the order lacks (one side removed it, the other changed it) after the row
//! before it in the line merged into.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Map, Value};

use crate::ops::{self, Flat, Key, Path, Record};

/// A place of a record, as a merge sees it: a field outside lists of records, a row of a list of records with all its
/// fields, or the order of a list's rows.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Place {
    Field(String),
    Row(String, Key),
    Order(String),
}

impl Place {
    /// As the engine names it: `{"at": path, "what": "value" | "row" | "order"}`, the path as ops write one
    /// (`["title"]`, `["blocks", {"id": 2}]`, `["blocks"]`).
    pub fn to_json(&self) -> Value {
        match self {
            Place::Field(f) => json!({ "at": [f], "what": "value" }),
            Place::Row(f, k) => json!({ "at": [f, key_json(k)], "what": "row" }),
            Place::Order(f) => json!({ "at": [f], "what": "order" }),
        }
    }

    /// The place `v` names, as `to_json` writes it.
    pub fn of_json(v: &Value) -> Option<Place> {
        let at = v.get("at")?.as_array()?;
        let field = at.first()?.as_str()?.to_string();
        match (v.get("what")?.as_str()?, at.len()) {
            ("value", 1) => Some(Place::Field(field)),
            ("order", 1) => Some(Place::Order(field)),
            ("row", 2) => {
                let k = &at[1];
                let copy = k.get("copy").map_or(Some(0), Value::as_u64)? as usize;
                Some(Place::Row(field, Key { id: k.get("id")?.as_i64()?, copy }))
            }
            _ => None,
        }
    }
}

fn key_json(k: &Key) -> Value {
    if k.copy == 0 { json!({ "id": k.id }) } else { json!({ "id": k.id, "copy": k.copy }) }
}

/// A conflict: a place both lines changed since their base to different values that don't join, with what the base,
/// the line merged into (`ours`) and the line merged in (`theirs`) hold there, `None` for nothing (an order as its
/// row ids).
#[derive(Clone, Debug, PartialEq)]
pub struct Conflict {
    pub place: Place,
    pub base: Option<Value>,
    pub ours: Option<Value>,
    pub theirs: Option<Value>,
}

impl Conflict {
    pub fn to_json(&self) -> Value {
        let mut out = self.place.to_json();
        out["base"] = self.base.clone().unwrap_or(Value::Null);
        out["ours"] = self.ours.clone().unwrap_or(Value::Null);
        out["theirs"] = self.theirs.clone().unwrap_or(Value::Null);
        out
    }
}

/// What a merge shows, and its conflicts, place by place in order, whichever side each took.
#[derive(Clone, Debug, PartialEq)]
pub struct Merged {
    pub record: Record,
    pub conflicts: Vec<Conflict>,
}

/// A record by places: its fields, its rows and its lists' orders.
#[derive(Default)]
struct Places {
    fields: BTreeMap<String, Value>,
    rows: BTreeMap<(String, Key), Value>,
    orders: BTreeMap<String, Vec<Key>>,
}

impl Places {
    /// Record `r`'s places, the fields `lists` names read as lists of records.
    fn of(r: &Record, lists: &BTreeSet<String>) -> Places {
        let mut p = Places::default();
        for (f, v) in r {
            match ops::rows(v).filter(|_| lists.contains(f)) {
                Some(rows) => {
                    let keyed = ops::keyed(rows);
                    for (k, row) in &keyed {
                        p.rows.insert((f.clone(), *k), Value::Object((*row).clone()));
                    }
                    p.orders.insert(f.clone(), keyed.iter().map(|(k, _)| *k).collect());
                }
                None => drop(p.fields.insert(f.clone(), v.clone())),
            }
        }
        p
    }
}

/// The merge of `theirs` into `ours` from their `base` (`Doc.lean`'s `mergeInto`), the person taking `theirs`'s value
/// at the conflicts `take` names.
pub fn merge(base: &Record, ours: &Record, theirs: &Record, take: &BTreeSet<Place>) -> Merged {
    // a field is a list of records where each side that has it holds one (an empty array too)
    let all = [base, ours, theirs];
    let names: BTreeSet<&String> = all.iter().flat_map(|r| r.keys()).collect();
    let list = |f: &&String| all.iter().all(|r| r.get(*f).is_none_or(|v| ops::rows(v).is_some()));
    let lists: BTreeSet<String> = names.into_iter().filter(list).cloned().collect();
    let (b, o, t) = (Places::of(base, &lists), Places::of(ours, &lists), Places::of(theirs, &lists));
    let mut conflicts = vec![];
    let mut out = Places::default();
    let fields: BTreeSet<&String> = b.fields.keys().chain(o.fields.keys()).chain(t.fields.keys()).collect();
    for f in fields {
        let place = Place::Field(f.clone());
        let (bv, ov, tv) = (b.fields.get(f), o.fields.get(f), t.fields.get(f));
        if let Some(v) = at(bv, ov, tv, join, take.contains(&place), &mut |c| conflicts.push(c.of(place.clone(), id))) {
            out.fields.insert(f.clone(), v);
        }
    }
    let rows: BTreeSet<&(String, Key)> = b.rows.keys().chain(o.rows.keys()).chain(t.rows.keys()).collect();
    for r in rows {
        let place = Place::Row(r.0.clone(), r.1);
        let (bv, ov, tv) = (b.rows.get(r), o.rows.get(r), t.rows.get(r));
        let clash = &mut |c: Clash<'_, Value>| conflicts.push(c.of(place.clone(), id));
        if let Some(v) = at(bv, ov, tv, join_row, take.contains(&place), clash) {
            out.rows.insert(r.clone(), v);
        }
    }
    for f in &lists {
        let place = Place::Order(f.clone());
        let (bv, ov, tv) = (b.orders.get(f), o.orders.get(f), t.orders.get(f));
        let ids = |ks: &Vec<Key>| Value::Array(ks.iter().map(key_json).collect());
        let clash = &mut |c: Clash<'_, Vec<Key>>| conflicts.push(c.of(place.clone(), ids));
        let order = at(bv, ov, tv, join_order, take.contains(&place), clash);
        // the rows that are there, in the merged order, and any the order lacks after the row before it in ours
        let there: Vec<Key> = out.rows.keys().filter(|(g, _)| g == f).map(|(_, k)| *k).collect();
        let listed = order.is_some();
        let mut keys: Vec<Key> = order.unwrap_or_default().into_iter().filter(|k| there.contains(k)).collect();
        for side in [o.orders.get(f), t.orders.get(f)].into_iter().flatten() {
            for (i, k) in side.iter().enumerate() {
                if there.contains(k) && !keys.contains(k) {
                    let after = side[..i].iter().rev().find_map(|p| keys.iter().position(|x| x == p));
                    keys.insert(after.map_or(0, |a| a + 1), *k);
                }
            }
        }
        // the list is there where the merged order is, or a row of it is
        if listed || !keys.is_empty() {
            out.orders.insert(f.clone(), keys);
        }
    }
    let mut record = Record::new();
    for (f, v) in out.fields {
        record.insert(f, v);
    }
    for (f, keys) in out.orders {
        let rows = keys.iter().filter_map(|k| out.rows.get(&(f.clone(), *k)).cloned()).collect();
        record.insert(f, Value::Array(rows));
    }
    Merged { record, conflicts }
}

/// One side's values at a conflict, before it names its place.
struct Clash<'a, T> {
    base: Option<&'a T>,
    ours: Option<&'a T>,
    theirs: Option<&'a T>,
}

impl<T> Clash<'_, T> {
    fn of(&self, place: Place, show: impl Fn(&T) -> Value) -> Conflict {
        let (base, ours, theirs) = (self.base.map(&show), self.ours.map(&show), self.theirs.map(&show));
        Conflict { place, base, ours, theirs }
    }
}

fn id(v: &Value) -> Value {
    v.clone()
}

/// `Doc.lean`'s `mergeInto` at one place: the change of whichever side changed it, both changes joined where they
/// don't clash, and at a conflict, which it tells `clash`, ours, or theirs where the person takes it.
fn at<T: Clone + PartialEq>(
    base: Option<&T>,
    ours: Option<&T>,
    theirs: Option<&T>,
    join: impl Fn(&T, &T, &T) -> Option<T>,
    take: bool,
    clash: &mut dyn FnMut(Clash<'_, T>),
) -> Option<T> {
    if ours == base {
        return theirs.cloned();
    }
    if theirs == base || ours == theirs {
        return ours.cloned();
    }
    if let (Some(b), Some(o), Some(t)) = (base, ours, theirs)
        && let Some(v) = join(b, o, t)
    {
        return Some(v);
    }
    clash(Clash { base, ours, theirs });
    if take { theirs.cloned() } else { ours.cloned() }
}

/// Two changes of one value joined, where they don't clash: a text both edited at places apart; a list of values both
/// added to or took from; an object whose fields they changed apart, each field joined the same way. `None` where they
/// clash.
pub fn join(base: &Value, ours: &Value, theirs: &Value) -> Option<Value> {
    match (base, ours, theirs) {
        (Value::String(b), Value::String(o), Value::String(t)) => join_text(b, o, t).map(Value::String),
        (Value::Array(b), Value::Array(o), Value::Array(t)) => {
            // ours, less what theirs took out, and what theirs added that ours doesn't hold
            let mut out: Vec<Value> = o.iter().filter(|x| !b.contains(x) || t.contains(x)).cloned().collect();
            out.extend(t.iter().filter(|x| !b.contains(x) && !o.contains(x)).cloned());
            Some(Value::Array(out))
        }
        (Value::Object(b), Value::Object(o), Value::Object(t)) => {
            let mut out = Map::new();
            let keys: Vec<&String> = {
                let mut seen = BTreeSet::new();
                o.keys().chain(t.keys()).chain(b.keys()).filter(|k| seen.insert(*k)).collect()
            };
            for k in keys {
                let mut clashed = false;
                if let Some(v) = at(b.get(k), o.get(k), t.get(k), join, false, &mut |_| clashed = true) {
                    out.insert(k.clone(), v);
                }
                if clashed {
                    return None;
                }
            }
            Some(Value::Object(out))
        }
        _ => None,
    }
}

/// Two changes of one row of the record's lists joined, where nothing in it clashes (`Flat`): each value in it, at any
/// depth, as `join` joins one, and each list of records in it row by row by id, its order as `join_order` joins a
/// list's, a list a side lacks as an empty one. `None` where anything clashes, so the whole row is the conflict, one
/// place as `Doc.lean`'s `mergeInto` sees it, whatever joins inside it: a value both changed that doesn't join, a list
/// both moved rows of, a row one side took out where the other changed what it holds, or a place one side made a value
/// and the other rows. A loop over the row's places, never a recursion.
pub fn join_row(base: &Value, ours: &Value, theirs: &Value) -> Option<Value> {
    let flat = |v: &Value| v.as_object().map(Flat::of);
    let (b, o, t) = (flat(base)?, flat(ours)?, flat(theirs)?);
    let mut clashed = false;
    let mut out = Flat::default();
    let paths: BTreeSet<&Path> = b.leaves.keys().chain(o.leaves.keys()).chain(t.leaves.keys()).collect();
    for p in paths {
        let (bv, ov, tv) = (b.leaves.get(p), o.leaves.get(p), t.leaves.get(p));
        if let Some(v) = at(bv, ov, tv, join, false, &mut |_| clashed = true) {
            out.leaves.insert(p.clone(), v);
        }
    }
    let lists: BTreeSet<&Path> = b.lists.keys().chain(o.lists.keys()).chain(t.lists.keys()).collect();
    let none = vec![];
    for f in lists {
        // a list a side lacks joins as an empty one, and is there where it holds rows, or where the side that changed
        // whether it is there has it
        let (bv, ov, tv) = (b.lists.get(f), o.lists.get(f), t.lists.get(f));
        let [b_, o_, t_] = [bv, ov, tv].map(|v| Some(v.unwrap_or(&none)));
        let ks = at(b_, o_, t_, join_order, false, &mut |_| clashed = true);
        let there = if ov.is_some() == bv.is_some() { tv.is_some() } else { ov.is_some() };
        if let Some(ks) = ks.filter(|ks| there || !ks.is_empty()) {
            out.lists.insert(f.clone(), ks);
        }
    }
    // what is left is in rows their lists still hold, and no place holds both a value and rows
    let held = |rows: &[(String, Key)]| {
        (0..rows.len()).all(|i| out.holds(&Path { rows: rows[..i].to_vec(), field: rows[i].0.clone() }, &rows[i].1))
    };
    let formed = out.leaves.keys().all(|p| held(&p.rows) && !out.lists.contains_key(p))
        && out.lists.keys().all(|f| held(&f.rows));
    (!clashed && formed).then(|| Value::Object(out.record()))
}

/// A text both sides edited joined, where they edited it at places apart: each side's change is the one stretch of
/// the base it replaced (all it changed, from its first change to its last), and two stretches that overlap or touch
/// clash. `None` where they do.
pub fn join_text(base: &str, ours: &str, theirs: &str) -> Option<String> {
    let b: Vec<char> = base.chars().collect();
    let (o, t): (Vec<char>, Vec<char>) = (ours.chars().collect(), theirs.chars().collect());
    let (o_from, o_to, o_new) = stretch(&b, &o);
    let (t_from, t_to, t_new) = stretch(&b, &t);
    let (first, second) = if o_to < t_from {
        ((o_from, o_to, o_new), (t_from, t_to, t_new))
    } else if t_to < o_from {
        ((t_from, t_to, t_new), (o_from, o_to, o_new))
    } else {
        return None;
    };
    let mut out: Vec<char> = b[..first.0].to_vec();
    out.extend_from_slice(first.2);
    out.extend_from_slice(&b[first.1..second.0]);
    out.extend_from_slice(second.2);
    out.extend_from_slice(&b[second.1..]);
    Some(out.into_iter().collect())
}

/// The stretch of `base` that `side` replaced, `base[from..to]`, and what it put there: all it changed, between the
/// longest start and end it shares with the base.
fn stretch<'a>(base: &[char], side: &'a [char]) -> (usize, usize, &'a [char]) {
    let start = base.iter().zip(side).take_while(|(x, y)| x == y).count();
    let most = base.len().min(side.len()) - start;
    let end = base.iter().rev().zip(side.iter().rev()).take(most).take_while(|(x, y)| x == y).count();
    (start, base.len() - end, &side[start..side.len() - end])
}

/// Two changes of a list's rows joined, where they don't clash: the order of the side that moved rows, or ours where
/// neither did, with the rows the other side added after the row before them there, and without the rows either side
/// took out. `None` where both moved rows.
fn join_order(base: &Vec<Key>, ours: &Vec<Key>, theirs: &Vec<Key>) -> Option<Vec<Key>> {
    let moved = |side: &Vec<Key>| ops::reorder(base, side).moved;
    let (first, second) = match (moved(ours), moved(theirs)) {
        (true, true) => return None,
        (false, true) => (theirs, ours),
        _ => (ours, theirs),
    };
    let mut out: Vec<Key> = first.iter().filter(|k| !base.contains(k) || second.contains(k)).copied().collect();
    for (i, k) in second.iter().enumerate() {
        if !base.contains(k) && !out.contains(k) {
            let after = second[..i].iter().rev().find_map(|p| out.iter().position(|x| x == p));
            out.insert(after.map_or(0, |a| a + 1), *k);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn rec(v: Value) -> Record {
        v.as_object().expect("a record").clone()
    }

    fn merged(base: Value, ours: Value, theirs: Value) -> Merged {
        merge(&rec(base), &rec(ours), &rec(theirs), &BTreeSet::new())
    }

    #[test]
    fn a_place_one_side_changed_shows_that_change() {
        let base = json!({ "title": "Plan", "status": "open" });
        let ours = json!({ "title": "Plan", "status": "done" });
        let theirs = json!({ "title": "The plan", "status": "open" });
        let m = merged(base.clone(), ours, theirs);
        assert_eq!(Value::Object(m.record), json!({ "title": "The plan", "status": "done" }));
        assert!(m.conflicts.is_empty());
        // a fast-forward, and nothing new
        let ours = json!({ "title": "Mine" });
        assert_eq!(Value::Object(merged(base.clone(), base.clone(), ours.clone()).record), ours);
        assert_eq!(Value::Object(merged(base.clone(), ours.clone(), base).record), ours);
    }

    #[test]
    fn a_text_both_edited_apart_joins_and_overlapping_edits_keep_ours() {
        let base = "opens at eight. Bring water.";
        let joined = join_text(base, "opens at nine. Bring water.", "opens at eight. Bring tea.");
        assert_eq!(joined.as_deref(), Some("opens at nine. Bring tea."));
        assert_eq!(join_text("opens at eight.", "opens at nine.", "opens at ten."), None, "the same word: no joining");
        assert_eq!(join_text("ab", "aXb", "aYb"), None, "two inserts at one place clash");
        let base = json!({ "title": "Gate", "notes": "opens at eight." });
        let ours = json!({ "title": "Gate", "notes": "opens at nine." });
        let theirs = json!({ "title": "Gate", "notes": "opens at ten." });
        let m = merged(base.clone(), ours, theirs);
        assert_eq!(m.record["notes"], "opens at nine.", "main keeps its own value, never \"ninen\"");
        assert_eq!(m.conflicts.len(), 1);
        assert_eq!(m.conflicts[0].to_json()["at"], json!(["notes"]));
        assert_eq!(m.conflicts[0].theirs, Some(json!("opens at ten.")));
        // taking the proposal's there, and nothing else
        let take = BTreeSet::from([Place::Field("notes".into())]);
        let ours = rec(json!({ "title": "Our gate", "notes": "opens at nine." }));
        let m = merge(&rec(base), &ours, &rec(json!({ "title": "Gate", "notes": "opens at ten." })), &take);
        assert_eq!(Value::Object(m.record), json!({ "title": "Our gate", "notes": "opens at ten." }));
    }

    #[test]
    fn rows_join_by_id_and_a_row_ours_changed_stays_though_theirs_took_it_out() {
        let base = json!({ "blocks": [{ "id": 1, "text": "a" }, { "id": 2, "text": "b" }, { "id": 3, "text": "c" }] });
        let ours = json!({ "blocks": [{ "id": 1, "text": "a" }, { "id": 2, "text": "B!" }, { "id": 3, "text": "c" },
            { "id": 4, "text": "ours" }] });
        let theirs =
            json!({ "blocks": [{ "id": 5, "text": "theirs" }, { "id": 1, "text": "A" }, { "id": 3, "text": "c" }] });
        let m = merged(base, ours, theirs);
        let rows = m.record["blocks"].as_array().unwrap();
        let texts: Vec<&str> = rows.iter().map(|r| r["text"].as_str().unwrap()).collect();
        assert_eq!(texts, ["theirs", "A", "B!", "c", "ours"], "both new rows, their edit, and our edited row kept");
        let places: Vec<Place> = m.conflicts.iter().map(|c| c.place.clone()).collect();
        assert_eq!(places, [Place::Row("blocks".into(), Key { id: 2, copy: 0 })]);
        // a row both edited in different fields joins; in the same field apart, too
        let base = json!({ "blocks": [{ "id": 1, "type": "p", "text": "one two" }] });
        let m = merged(base, json!({ "blocks": [{ "id": 1, "type": "h1", "text": "One two" }] }),
            json!({ "blocks": [{ "id": 1, "type": "p", "text": "one two three" }] }));
        assert_eq!(m.record["blocks"], json!([{ "id": 1, "type": "h1", "text": "One two three" }]));
        assert!(m.conflicts.is_empty());
    }

    #[test]
    fn rows_of_rows_join_by_id_and_a_clash_anywhere_makes_the_top_row_the_conflict() {
        let kid = |id: i64, text: &str| json!({ "id": id, "text": text });
        let bed = |kids: Vec<Value>| json!({ "blocks": [{ "id": 1, "text": "Beds", "kids": kids }, { "id": 2 }] });
        let base = bed(vec![kid(11, "North"), kid(12, "South")]);
        // ours edits the north bed and adds an east one; theirs edits the south bed, adds a west one, moves nothing
        let ours = bed(vec![kid(11, "North bed"), kid(12, "South"), kid(13, "East")]);
        let theirs = bed(vec![kid(14, "West"), kid(11, "North"), kid(12, "South bed")]);
        let m = merged(base.clone(), ours.clone(), theirs.clone());
        let want = bed(vec![kid(14, "West"), kid(11, "North bed"), kid(12, "South bed"), kid(13, "East")]);
        assert_eq!(Value::Object(m.record), want);
        assert!(m.conflicts.is_empty());
        // two levels down, the same
        let deep = |text: &str, more: Vec<Value>| {
            let mut kids = vec![json!({ "id": 111, "text": text })];
            kids.extend(more);
            bed(vec![json!({ "id": 11, "kids": kids })])
        };
        let m = merged(deep("Beans", vec![]), deep("Runner beans", vec![]), deep("Beans", vec![kid(112, "Peas")]));
        assert_eq!(Value::Object(m.record), deep("Runner beans", vec![kid(112, "Peas")]));
        // both edit one text a list down at one place: the whole top row is the conflict, ours kept unless taken
        let nord = bed(vec![kid(11, "Nord"), kid(12, "South")]);
        let norte = bed(vec![kid(11, "Norte"), kid(12, "South")]);
        let m = merged(base.clone(), nord, norte);
        let top = Place::Row("blocks".into(), Key { id: 1, copy: 0 });
        assert_eq!(m.conflicts.iter().map(|c| c.place.clone()).collect::<Vec<_>>(), vec![top.clone()]);
        assert_eq!(m.conflicts[0].ours, Some(bed(vec![kid(11, "Nord"), kid(12, "South")])["blocks"][0].clone()));
        assert_eq!(m.record["blocks"][0]["kids"][0]["text"], "Nord");
        let take = BTreeSet::from([top.clone()]);
        let ours = rec(bed(vec![kid(11, "Nord"), kid(12, "South")]));
        let m = merge(&rec(base.clone()), &ours, &rec(bed(vec![kid(11, "Norte"), kid(12, "South")])), &take);
        assert_eq!(m.record["blocks"][0]["kids"][0]["text"], "Norte");
        // a row one side took out where the other changed it, and a list both moved rows of: the top row too
        let gone = merged(base.clone(), bed(vec![kid(12, "South")]), bed(vec![kid(11, "North!"), kid(12, "South")]));
        assert_eq!(gone.conflicts.iter().map(|c| c.place.clone()).collect::<Vec<_>>(), vec![top.clone()]);
        let three = bed(vec![kid(11, "a"), kid(12, "b"), kid(13, "c")]);
        let moved = merged(
            three.clone(),
            bed(vec![kid(13, "c"), kid(11, "a"), kid(12, "b")]),
            bed(vec![kid(12, "b"), kid(11, "a"), kid(13, "c")]),
        );
        assert_eq!(moved.conflicts.iter().map(|c| c.place.clone()).collect::<Vec<_>>(), [top]);
        // a row one side took out that the other left alone is gone
        let m = merged(base, bed(vec![kid(12, "South")]), bed(vec![kid(11, "North"), kid(12, "South"), kid(15, "x")]));
        assert_eq!(Value::Object(m.record), bed(vec![kid(12, "South"), kid(15, "x")]));
        // a list both made in one row joins as two that grew from an empty one, theirs' first rows first, as above; a
        // list one side emptied and lacks, as an emptied one
        let lacks = json!({ "blocks": [{ "id": 1, "text": "Beds" }, { "id": 2 }] });
        let added = bed(vec![kid(11, "North"), kid(12, "South"), kid(15, "x")]);
        let m = merged(bed(vec![kid(11, "North"), kid(12, "South")]), lacks, added);
        assert_eq!(Value::Object(m.record), bed(vec![kid(15, "x")]));
        let with = |kids: Option<Vec<Value>>| match kids {
            Some(kids) => json!({ "blocks": [{ "id": 1, "text": "Beds", "kids": kids }] }),
            None => json!({ "blocks": [{ "id": 1, "text": "Beds" }] }),
        };
        let m = merged(with(None), with(Some(vec![kid(11, "North")])), with(Some(vec![kid(12, "South")])));
        assert_eq!(Value::Object(m.record), with(Some(vec![kid(12, "South"), kid(11, "North")])));
        assert!(m.conflicts.is_empty());
    }

    #[test]
    fn lists_of_values_take_both_sides_changes_and_orders_moved_on_both_sides_keep_ours() {
        let tags = |t: &[&str]| json!({ "tags": t });
        let m = merged(tags(&["a", "b"]), tags(&["a", "b", "c"]), tags(&["b", "d"]));
        assert_eq!(m.record["tags"], json!(["b", "c", "d"]));
        let row = |id: i64| json!({ "id": id });
        let base = json!({ "blocks": [row(1), row(2), row(3)] });
        let ours = json!({ "blocks": [row(3), row(1), row(2)] });
        let theirs = json!({ "blocks": [row(2), row(1), row(3)] });
        let m = merged(base, ours, theirs);
        assert_eq!(m.record["blocks"], json!([row(3), row(1), row(2)]));
        assert_eq!(m.conflicts[0].place, Place::Order("blocks".into()));
        let back = Place::of_json(&m.conflicts[0].to_json()).expect("a place");
        assert_eq!(back, Place::Order("blocks".into()));
        let row_place = Place::Row("blocks".into(), Key { id: 2, copy: 1 });
        assert_eq!(Place::of_json(&row_place.to_json()), Some(row_place));
    }
}
