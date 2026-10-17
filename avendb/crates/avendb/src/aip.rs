//! AIPs, Aven Improvement Proposals (`docs/ARCHITECTURE.md` §8, "AIPs"): the one proposal standard of every vault,
//! for every type of entry, a layer read off what avenDB already holds, proposals, reviews and merges. This module is
//! the part on records alone, as `ops` is beside `engine`: the readable diff a schema derives of two records (`diff`),
//! its summary in one line (`summary`, and `summary_new` for a new entry, a draft), an idea's key (`key`) and the
//! labels of AIPs that hold one number (`labels`).
//! The ops that open, promote, withdraw, review and read AIPs are the engine's (`engine`'s `aips`).
//!
//! **The diff is computed, never typed.** It names each place two records of one schema differ, field by field, at any
//! depth: a value set (`set`), a row of a list of records added or removed (`add`, `remove`) or changed field by
//! field, a value added to a list of values or taken out of it, a Loro text changed (`text`, both whole). Each place
//! is labelled by its property's `title` in the schema, else by its name made readable, a row by its name, its title
//! or its id. The records are flattened as `ops` flattens them (`ops::Flat`), a list of records only where the schema
//! says one is, so its rows are matched by their ids as every merge matches them. Without a schema, the records say
//! what they hold.
//!
//! Every walk here is a loop over an explicit stack, never a recursion, as everywhere a record is walked.

use std::collections::{BTreeSet, HashMap};

use serde_json::{Value, json};

use crate::ops::{self, Flat, Key, Path, Record};

/// One place two records of one schema differ, as a person reads it: where (`path`, as ops write one, and into an
/// object that is one value, its keys), what it is called there (`label`), how it changed and what it held before and
/// after (`null`: nothing).
#[derive(Clone, Debug, PartialEq)]
pub struct Part {
    pub path: Value,
    pub label: String,
    pub kind: &'static str,
    pub old: Value,
    pub new: Value,
}

impl Part {
    fn new(path: Value, label: &str, kind: &'static str, (old, new): (Value, Value)) -> Part {
        Part { path, label: label.to_string(), kind, old, new }
    }

    pub fn to_json(&self) -> Value {
        json!({ "path": self.path, "label": self.label, "kind": self.kind, "old": self.old, "new": self.new })
    }

    /// The part in a few words: `Rent: 48 → 52`, `Tags: + work`, `Params: − height`, `Note: 2 paragraphs changed`.
    pub fn words(&self) -> String {
        let label = &self.label;
        match self.kind {
            "add" => format!("{label}: + {}", named(&self.new)),
            "remove" => format!("{label}: − {}", named(&self.old)),
            "text" => {
                let n = paragraphs(self.old.as_str().unwrap_or_default(), self.new.as_str().unwrap_or_default());
                format!("{label}: {n} paragraph{} changed", if n == 1 { "" } else { "s" })
            }
            _ => format!("{label}: {} → {}", shown(&self.old), shown(&self.new)),
        }
    }
}

/// The most characters of a value a summary shows.
pub const SHOWN: usize = 40;

/// A value in a summary: a text as it is, anything else as its JSON, `—` for nothing, cut to `SHOWN` characters.
fn shown(v: &Value) -> String {
    let s = match v {
        Value::Null => return "—".into(),
        Value::String(s) => s.clone(),
        v => v.to_string(),
    };
    match s.char_indices().nth(SHOWN) {
        Some((at, _)) => format!("{}…", s[..at].trim_end()),
        None => s,
    }
}

/// A row added or removed, by its name, its title or its id; a value as `shown`.
fn named(v: &Value) -> String {
    match v {
        Value::Object(row) => shown(&row_name(row).into()),
        v => shown(v),
    }
}

/// What a row is called: its `name`, `title` or `label`, the first that is a text with something in it, else `#id`.
fn row_name(row: &Record) -> String {
    let called = ["name", "title", "label"].iter().find_map(|k| row.get(*k)?.as_str().filter(|s| !s.trim().is_empty()));
    match called {
        Some(s) => s.to_string(),
        None => format!("#{}", row.get("id").map_or_else(String::new, Value::to_string)),
    }
}

/// How many paragraphs of text `old` text `new` changes: of the paragraphs (parts between blank lines) one holds and
/// the other doesn't, the more of those added or taken out; one at least where the texts differ only in spaces.
pub fn paragraphs(old: &str, new: &str) -> usize {
    let split = |s: &str| -> Vec<String> {
        let s = s.replace("\r\n", "\n");
        s.split("\n\n").map(str::trim).filter(|p| !p.is_empty()).map(str::to_string).collect()
    };
    let mut left: HashMap<String, usize> = HashMap::new();
    for p in split(old) {
        *left.entry(p).or_default() += 1;
    }
    let mut added = 0;
    for p in split(new) {
        match left.get_mut(&p) {
            Some(n) if *n > 0 => *n -= 1,
            _ => added += 1,
        }
    }
    let removed: usize = left.values().sum();
    match added.max(removed) {
        0 if old != new => 1,
        n => n,
    }
}

/// The summary of one part of an AIP: `<what>: <its first change> (+N more)`, `what` the schema's title without its
/// version, else the entry's type.
pub fn summary(what: &str, parts: &[Part]) -> String {
    match parts.split_first() {
        None => format!("{what}: no change"),
        Some((first, [])) => format!("{what}: {}", first.words()),
        Some((first, more)) => format!("{what}: {} (+{} more)", first.words(), more.len()),
    }
}

/// The summary of a part of an AIP that is a new entry, a draft (`engine`'s `aips`): `New <what>: <title> (+N fields)`,
/// N the fields it holds beside its title and its kind, as every part of its diff adds one.
pub fn summary_new(what: &str, title: &str, parts: &[Part]) -> String {
    let field = |p: &&Part| !matches!(p.path.get(0).and_then(Value::as_str), Some("title" | "kind"));
    let n = parts.iter().filter(field).count();
    format!("New {what}: {title} (+{n} field{})", if n == 1 { "" } else { "s" })
}

/// What a schema's title names a part by: `Markdown document, v1` is `Markdown document`.
pub fn what(title: &str) -> &str {
    match title.rsplit_once(", v") {
        Some((name, v)) if !name.is_empty() && v.chars().all(|c| c.is_ascii_digit()) => name,
        _ => title,
    }
}

/// A key, the field's name made readable: `params` is `Params`, `maxLength` and `max_length` are `Max length`.
pub fn readable(key: &str) -> String {
    let mut out = String::new();
    for (i, c) in key.chars().enumerate() {
        match c {
            '_' | '-' => out.push(' '),
            c if c.is_uppercase() && i > 0 => {
                out.push(' ');
                out.extend(c.to_lowercase());
            }
            c if i == 0 => out.extend(c.to_uppercase()),
            c => out.push(c),
        }
    }
    out
}

/// What a property of a schema holds, as the diff reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Holds {
    /// A list of records: rows matched by their ids.
    Rows,
    /// A Loro text.
    Text,
    /// A list of values, each added or taken out.
    Values,
    /// An object that is one value, read key by key.
    Object,
    /// One value.
    Value,
}

/// `p`, or the shape its `$ref` names in schema `root`'s `$defs`, as many steps as it takes, up to 32.
fn resolve<'a>(root: &'a Value, mut p: &'a Value) -> Option<&'a Value> {
    for _ in 0..32 {
        match p.get("$ref") {
            None => return Some(p),
            Some(r) => p = root.get("$defs")?.get(r.as_str()?.strip_prefix("#/$defs/")?)?,
        }
    }
    None
}

/// The property of schema `root` at field `field` of the record or, down the lists `lists`, of their rows.
fn property<'a>(root: &'a Value, lists: &[&str], field: &str) -> Option<&'a Value> {
    let mut shape = root;
    for l in lists {
        let p = resolve(root, shape.get("properties")?.get(*l)?)?;
        shape = resolve(root, p.get("items")?)?;
    }
    resolve(root, shape.get("properties")?.get(field)?)
}

/// What property `p` of schema `root` holds (`lens::Schema` reads it so).
fn holds(root: &Value, p: &Value) -> Holds {
    if p.get("x-link").is_some() {
        return Holds::Value;
    }
    match p.get("type").and_then(Value::as_str) {
        Some("array") if p.get("prefixItems").is_none() => {
            let Some(items) = p.get("items").and_then(|i| resolve(root, i)) else { return Holds::Value };
            let id = items.get("properties").and_then(|ps| ps.get("id")).and_then(|id| id.get("type"));
            let required = items.get("required").and_then(Value::as_array).is_some_and(|r| r.iter().any(|x| x == "id"));
            let object = items.get("type").and_then(Value::as_str) == Some("object");
            let bounded = p.get("minItems").is_some() || p.get("maxItems").is_some();
            match () {
                _ if object && required && id.and_then(Value::as_str) == Some("integer") => Holds::Rows,
                _ if !object && !bounded => Holds::Values,
                _ => Holds::Value,
            }
        }
        Some("string") if p.get("x-loro").and_then(Value::as_str) == Some("text") => Holds::Text,
        Some("object") => Holds::Object,
        _ => Holds::Value,
    }
}

/// What a value holds where no schema says: a list of values, an object read key by key, or one value.
fn holds_of(x: Option<&Value>, y: Option<&Value>) -> Holds {
    let values = |v: Option<&Value>| v.is_none_or(|v| v.as_array().is_some_and(|xs| xs.iter().all(|x| !x.is_object())));
    let object = |v: Option<&Value>| v.is_none_or(Value::is_object);
    match () {
        _ if values(x) && values(y) => Holds::Values,
        _ if object(x) && object(y) => Holds::Object,
        _ => Holds::Value,
    }
}

/// The row a chain of rows names in record `r`.
fn row_at<'a>(r: &'a Record, chain: &[(String, Key)]) -> Option<&'a Record> {
    let mut at = r;
    for (f, k) in chain {
        at = ops::keyed(ops::rows(at.get(f)?)?).into_iter().find(|(key, _)| key == k)?.1;
    }
    Some(at)
}

/// The path of the row a chain names, as ops write one: `["params", {"id": 2}]`.
fn row_path(chain: &[(String, Key)]) -> Value {
    Value::Array(chain.iter().flat_map(|(f, k)| [Value::from(f.as_str()), k.to_json()]).collect())
}

/// The lists of rows a place is in, from the top.
fn lists_of(p: &Path) -> Vec<&str> {
    p.rows.iter().map(|(f, _)| f.as_str()).collect()
}

/// The diff of two records of one schema: what makes `old` into `new`, place by place, each labelled (`Part`).
/// `schema` is the schema's JSON, `None` where no schema reads them.
pub fn diff(schema: Option<&Value>, old: &Record, new: &Record) -> Vec<Part> {
    let at = |lists: &[&str], field: &str| schema.and_then(|root| property(root, lists, field));
    let holds_at = |p: &Path| schema.and_then(|root| Some(holds(root, at(&lists_of(p), &p.field)?)));
    let rows_at = |p: &Path| schema.is_none() || holds_at(p) == Some(Holds::Rows);
    let (a, b) = (Flat::of_with(old, rows_at), Flat::of_with(new, rows_at));
    // what a place is called: each row it is in by its list and its name, then its own field
    let titled = |p: Option<&Value>, key: &str| match p.and_then(|p| p.get("title")).and_then(Value::as_str) {
        Some(t) => t.to_string(),
        None => readable(key),
    };
    let label = |chain: &[(String, Key)], field: Option<&str>| {
        let mut words = vec![];
        for (i, (f, k)) in chain.iter().enumerate() {
            let lists: Vec<&str> = chain[..i].iter().map(|(f, _)| f.as_str()).collect();
            words.push(titled(at(&lists, f), f));
            let row = row_at(new, &chain[..=i]).or_else(|| row_at(old, &chain[..=i]));
            words.push(row.map_or_else(|| format!("#{}", k.id), row_name));
        }
        if let Some(field) = field {
            let lists: Vec<&str> = chain.iter().map(|(f, _)| f.as_str()).collect();
            words.push(titled(at(&lists, field), field));
        }
        words.join(" › ")
    };
    let mut parts = vec![];
    // the rows added or taken out, each with all it holds, and the lists whose rows changed order
    let mut whole: BTreeSet<Vec<(String, Key)>> = BTreeSet::new();
    let within = |whole: &BTreeSet<Vec<(String, Key)>>, chain: &[(String, Key)]| {
        (1..=chain.len()).any(|n| whole.contains(&chain[..n]))
    };
    let lists: BTreeSet<&Path> = a.lists.keys().chain(b.lists.keys()).collect();
    for f in lists {
        let none = vec![];
        let (before, after) = (a.lists.get(f).unwrap_or(&none), b.lists.get(f).unwrap_or(&none));
        if before == after || within(&whole, &f.rows) {
            continue;
        }
        let r = ops::reorder(before, after);
        let list = label(&f.rows, Some(&f.field));
        for k in r.removed {
            let chain = f.row(&k);
            let row = row_at(old, &chain).map_or(Value::Null, |r| Value::Object(r.clone()));
            parts.push(Part::new(row_path(&chain), &list, "remove", (row, Value::Null)));
            whole.insert(chain);
        }
        for k in r.inserted {
            let chain = f.row(&k);
            let row = row_at(new, &chain).map_or(Value::Null, |r| Value::Object(r.clone()));
            parts.push(Part::new(row_path(&chain), &list, "add", (Value::Null, row)));
            whole.insert(chain);
        }
        if r.moved {
            let kept =
                |ks: &[Key]| ks.iter().filter(|k| after.contains(k) && before.contains(k)).map(|k| k.id).collect();
            let (old, new): (Vec<i64>, Vec<i64>) = (kept(before), kept(after));
            parts.push(Part::new(f.to_json(), &format!("{list} order"), "set", (old.into(), new.into())));
        }
    }
    // each place whose value changed, outside the rows added or taken out: a text, a list of values, an object read
    // key by key, or one value
    let places: BTreeSet<&Path> = a.leaves.keys().chain(b.leaves.keys()).collect();
    for p in places {
        let (x, y) = (a.leaves.get(p), b.leaves.get(p));
        if x == y || within(&whole, &p.rows) {
            continue;
        }
        let property = at(&lists_of(p), &p.field);
        let what = match (schema, property) {
            (Some(root), Some(prop)) => holds(root, prop),
            _ => holds_of(x, y),
        };
        let start = (p.to_json(), label(&p.rows, Some(&p.field)));
        changed(&mut parts, start, what, (schema, property), (x, y));
    }
    parts
}

/// The parts of one place's change, from `x` to `y`, where it holds `what` (`property` of schema `root`, if any): an
/// object's keys in turn, each a place of its own, by a stack.
fn changed(
    parts: &mut Vec<Part>,
    (path, label): (Value, String),
    what: Holds,
    (root, property): (Option<&Value>, Option<&Value>),
    (x, y): (Option<&Value>, Option<&Value>),
) {
    let mut todo = vec![(path, label, what, property, x, y)];
    while let Some((path, label, what, property, x, y)) = todo.pop() {
        let (old, new) = (x.cloned().unwrap_or(Value::Null), y.cloned().unwrap_or(Value::Null));
        match (what, x.and_then(Value::as_object), y.and_then(Value::as_object)) {
            (Holds::Text, ..) => {
                let text = |v: Value| if v.is_null() { Value::from("") } else { v };
                parts.push(Part { path, label, kind: "text", old: text(old), new: text(new) });
            }
            (Holds::Values, ..) => {
                let values = |v: Option<&Value>| v.and_then(Value::as_array).cloned().unwrap_or_default();
                let (mut was, now) = (values(x), values(y));
                let mut added = vec![];
                for v in now {
                    match was.iter().position(|w| *w == v) {
                        Some(i) => drop(was.remove(i)),
                        None => added.push(v),
                    }
                }
                for v in was {
                    parts.push(Part::new(path.clone(), &label, "remove", (v, Value::Null)));
                }
                for v in added {
                    parts.push(Part::new(path.clone(), &label, "add", (Value::Null, v)));
                }
            }
            (Holds::Object, Some(xo), Some(yo)) => {
                let keys: BTreeSet<&String> = xo.keys().chain(yo.keys()).collect();
                // pushed last to first, so the keys come out in order
                for k in keys.into_iter().rev() {
                    let (a, b) = (xo.get(k), yo.get(k));
                    if a == b {
                        continue;
                    }
                    let sub =
                        property.and_then(|p| p.get("properties")?.get(k.as_str())).and_then(|p| resolve(root?, p));
                    let titled = sub
                        .and_then(|p| p.get("title"))
                        .and_then(Value::as_str)
                        .map_or_else(|| readable(k), str::to_string);
                    let what = match (root, sub) {
                        (Some(root), Some(sub)) => holds(root, sub),
                        _ => holds_of(a, b),
                    };
                    // an object's text is one value: no Loro text lives inside one
                    let what = if what == Holds::Text { Holds::Value } else { what };
                    let mut deeper = path.as_array().cloned().unwrap_or_default();
                    deeper.push(k.as_str().into());
                    todo.push((Value::Array(deeper), format!("{label} › {titled}"), what, sub, a, b));
                }
            }
            _ => parts.push(Part { path, label, kind: "set", old, new }),
        }
    }
}

/// The letters and digits of a key.
const ALPHABET: &[u8; 62] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/// The key of an idea, eight letters and digits, from 64 random bits: 62 to the 8th is less than 2 to the 48th, so
/// each is near uniform.
pub fn key(mut random: u64) -> String {
    (0..8)
        .map(|_| {
            let c = ALPHABET[(random % 62) as usize] as char;
            random /= 62;
            c
        })
        .collect()
}

/// Whether `key` is an AIP's key: eight letters and digits.
pub fn is_key(key: &str) -> bool {
    key.len() == 8 && key.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// The labels of AIPs of one vault that hold number `n`, each by the place of the write that set it in the one order
/// every device replays edits in (its depth, then its id): the first keeps `AIP-n`, the others are `AIP-n.2`,
/// `AIP-n.3` in that order, the same on every reader. `order` is each AIP's place, in the order the labels come back.
pub fn labels<T: Ord + Clone>(n: u64, order: &[T]) -> Vec<String> {
    let mut sorted: Vec<&T> = order.iter().collect();
    sorted.sort();
    order
        .iter()
        .map(|t| match sorted.iter().position(|s| *s == t).unwrap_or(0) {
            0 => format!("AIP-{n}"),
            i => format!("AIP-{n}.{}", i + 1),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(v: Value) -> Record {
        v.as_object().cloned().expect("a record")
    }

    #[test]
    fn a_set_reads_label_old_and_new() {
        let schema = json!({ "type": "object", "properties": { "rent": { "type": "integer", "title": "Rent" } } });
        let parts = diff(Some(&schema), &rec(json!({ "rent": 48 })), &rec(json!({ "rent": 52 })));
        assert_eq!(parts.len(), 1);
        assert_eq!((parts[0].kind, parts[0].words()), ("set", "Rent: 48 → 52".to_string()));
        assert_eq!(summary("V1", &parts), "V1: Rent: 48 → 52");
    }

    #[test]
    fn rows_are_matched_by_id_and_changed_field_by_field() {
        let schema = json!({ "type": "object", "properties": {
            "params": { "type": "array", "items": { "type": "object", "properties": {
                "id": { "type": "integer" }, "name": { "type": "string" }, "default": { "type": "number" } },
                "required": ["id"] } } } });
        let old =
            rec(json!({ "params": [{ "id": 1, "name": "height", "default": 0.6 }, { "id": 2, "name": "width" }] }));
        let new =
            rec(json!({ "params": [{ "id": 1, "name": "height", "default": 0.8 }, { "id": 3, "name": "depth" }] }));
        let parts = diff(Some(&schema), &old, &new);
        let words: Vec<String> = parts.iter().map(Part::words).collect();
        assert_eq!(words, ["Params: − width", "Params: + depth", "Params › height › Default: 0.6 → 0.8"]);
        assert_eq!(parts[2].path, json!(["params", { "id": 1 }, "default"]));
        assert_eq!(summary("Logic", &parts), "Logic: Params: − width (+2 more)");
    }

    #[test]
    fn a_new_entry_reads_by_its_title_and_how_many_fields_it_holds() {
        let schema = json!({ "type": "object", "properties": {
            "kind": { "const": "logic" }, "title": { "type": "string" }, "source": { "type": "string" },
            "note": { "type": "string" } } });
        let new = rec(json!({ "kind": "logic", "title": "Harvest rules", "source": "x", "note": "y" }));
        let parts = diff(Some(&schema), &Record::new(), &new);
        assert_eq!(summary_new("Logic", "Harvest rules", &parts), "New Logic: Harvest rules (+2 fields)");
        let one = rec(json!({ "kind": "logic", "title": "T", "note": "y" }));
        assert_eq!(summary_new("Logic", "T", &diff(Some(&schema), &Record::new(), &one)), "New Logic: T (+1 field)");
    }

    #[test]
    fn texts_lists_of_values_and_objects() {
        let schema = json!({ "type": "object", "properties": {
            "note": { "type": "string", "x-loro": "text" },
            "tags": { "type": "array", "items": { "type": "string" } },
            "engine": { "type": "object", "properties": { "version": { "type": "integer" } } } } });
        let old = rec(json!({ "note": "One.\n\nTwo.", "tags": ["a", "b"], "engine": { "version": 4, "host": "box" } }));
        let new = rec(
            json!({ "note": "One!\n\nTwo.\n\nThree.", "tags": ["b", "c"], "engine": { "version": 5, "host": "box" } }),
        );
        let words: Vec<String> = diff(Some(&schema), &old, &new).iter().map(Part::words).collect();
        assert_eq!(words, ["Engine › Version: 4 → 5", "Note: 2 paragraphs changed", "Tags: − a", "Tags: + c"]);
    }

    #[test]
    fn values_are_cut_and_keys_made_readable() {
        let long = "x".repeat(60);
        let parts = diff(None, &rec(json!({ "maxLength": 1 })), &rec(json!({ "maxLength": long })));
        assert_eq!(parts[0].words(), format!("Max length: 1 → {}…", "x".repeat(SHOWN)));
        assert_eq!(what("Markdown document, v1"), "Markdown document");
        assert_eq!(readable("snake_case"), "Snake case");
    }

    #[test]
    fn keys_and_labels() {
        let k = key(u64::MAX);
        assert!(is_key(&k), "{k}");
        assert!(!is_key("short") && !is_key("with-dash"));
        assert_eq!(labels(3, &[(5u64, 9u8), (5, 2), (4, 7)]), ["AIP-3.3", "AIP-3.2", "AIP-3"]);
    }
}
