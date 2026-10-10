//! The ops engine (`avendb/docs/OPS.md`): every read and every change of a device's entries as one JSON op, whatever
//! their schema, run on the device's Lab. `ops` is the part on records alone; this is the part on entries.
//!
//! - **Records through schemas.** An op sees an entry's record as an app on a schema sees it (`lens::View`): the schema
//!   it names (`"schema"`: `"document"` or `"todo"`, a built-in's name, or a schema's id in hex), or else the one the
//!   record's own `kind` names, read through the lens to the version that wrote it. The lane an op reads through is
//!   the app's own schemas and lenses and what the entry's vault publishes. `"stored"` names the record as the item
//!   stores it, which ops read and never change. A change runs on the app's view and goes back through the view
//!   (`View::put`), so the lens writes only what changed, in the representation the item already uses: a new schema
//!   needs no new code.
//! - **Reads** (`read`). `query`: the entries whose labels and records a `where` holds of, picked by the selector of
//!   its labels first (`ops::Where::plan`), so a device opens no more than the selector picks, then ordered and a page
//!   at a time. `get`: one entry on a line, or at a version. `history`: an entry's lines and every write of it, each
//!   with the changes it made to the entry's stored record (`ops::diff`), as every reader sees them alike. `schemas`:
//!   the schemas and lenses a vault's entries are read through.
//! - **Changes** (`run`). `create`; the record ops (`ops::Op`): `set`, `unset`, `insert`, `remove`, `move`; `tag`;
//!   `propose`, `merge`, `restore`, `undo`, `variant`; and `batch`, whose record ops in a row on one entry's line make
//!   one write. Each acts for a vault (`"as"`, the device's own by default), as every edit does, and the rules judge
//!   it as they judge any peer's. A write through a ruled cap carries the proof that the cap's rules allow what it
//!   touches, and is refused (`NotAllowed`) where they don't: its readers wouldn't count it (`rules`).
//! - **Asking** (`may`). Whether each of some change ops would be made, by a dry run of each that checks, proves and
//!   refuses as `run` does and makes nothing: what a page asks before it offers a button.
//!
//! Every op answers `{"ok": ...}` or `{"refused": name, "why": "..."}`: a rule of the edits or of a device
//! (`policy::Refusal`, by its name), `BadOp` where the JSON says nothing the engine does or an op makes no sense of the
//! record, `NoSchema` where no schema reads the record, `NoEntry` where the device shows no such entry or line.

use std::cmp::Ordering;
use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::doc::Item;
use crate::history::{self, History, MAIN};
use crate::id::{BlobId, EditId, EntryId, SignerId, VaultId};
use crate::lab::Lab;
use crate::lens::{self, Lane, Schema, View};
use crate::ops::{self, Op, Path, Record, Where};
use crate::policy::{Line, Proposal, Refusal};
use crate::slice::Attrs;

/// The most writes of one entry whose changes `history` shows, the latest: each version is made from scratch from the
/// updates it holds.
pub const SHOWN: usize = 200;

/// Why an op was refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refused {
    /// A rule of the edits or of a device.
    Rule(Refusal),
    /// The JSON says nothing the engine does, or the op makes no sense of the record.
    BadOp(String),
    /// No schema reads the record: none is named and its kind names none, the one named isn't in the vault's lane, or
    /// the record isn't one of it.
    NoSchema(String),
    /// The device shows no such entry, or no such line of it.
    NoEntry,
    /// A batch's `at`th op was refused, after its steps before it did `done`, which stand.
    Batch { at: usize, done: Vec<Value>, why: Box<Refused> },
}

impl From<Refusal> for Refused {
    fn from(r: Refusal) -> Refused {
        Refused::Rule(r)
    }
}

impl Refused {
    pub fn to_json(&self) -> Value {
        let (name, why) = match self {
            Refused::Rule(r) => (format!("{r:?}"), rule(r)),
            Refused::BadOp(why) => ("BadOp".into(), why.clone()),
            Refused::NoSchema(why) => ("NoSchema".into(), why.clone()),
            Refused::NoEntry => ("NoEntry".into(), "the device shows no such entry, or no such line of it".into()),
            Refused::Batch { at, done, why } => {
                let mut out = why.to_json();
                out["at"] = (*at).into();
                out["done"] = done.clone().into();
                return out;
            }
        };
        json!({ "refused": name, "why": why })
    }
}

/// A rule's refusal in words.
fn rule(r: &Refusal) -> String {
    let why = match r {
        Refusal::NoCap => "the vault it acts for holds no cap that allows this",
        Refusal::NotAllowed => "the rules of the caps the vault acts through don't allow what it does",
        Refusal::NotActing => "the device doesn't act for that vault",
        Refusal::ReadOnly => "the entry opens read-only: no lens reaches every schema it was written under",
        Refusal::NotAView => "the record would not fit its schema",
        Refusal::Locked => "the device is locked",
        Refusal::UnknownEntry => "no such entry",
        Refusal::UnknownDep => "no such edit of the entry",
        Refusal::NotOnProposal => "no such proposal of the entry",
        _ => return format!("the rules refuse it ({r:?})"),
    };
    why.into()
}

fn bad(why: impl Into<String>) -> Refused {
    Refused::BadOp(why.into())
}

/// The fields of each op beside `op`: a field it doesn't take is a mistake, never ignored.
fn fields(name: &str) -> Option<&'static [&'static str]> {
    Some(match name {
        "query" => &["vault", "where", "schema", "select", "order", "limit", "offset"],
        "get" => &["entry", "schema", "line", "at"],
        "history" => &["entry", "limit"],
        "schemas" => &["vault"],
        "create" => &["vault", "type", "tags", "schema", "value", "as"],
        "set" | "unset" | "insert" | "remove" | "move" => {
            &["entry", "line", "schema", "as", "path", "value", "at", "to"]
        }
        "tag" => &["entry", "add", "remove", "as"],
        "propose" => &["entry", "from", "name", "as"],
        "merge" => &["entry", "from", "into", "promote", "as"],
        "restore" => &["entry", "line", "at", "as"],
        "undo" => &["entry", "line", "edit", "as"],
        "variant" => &["entry", "line", "into", "schema", "ops", "as"],
        "batch" | "may" => &["ops", "as"],
        _ => return None,
    })
}

/// The ops that only read.
const READS: [&str; 4] = ["query", "get", "history", "schemas"];

/// Op `v`'s name and fields, if it is an op the engine runs and carries no field it doesn't take.
fn op_of(v: &Value) -> Result<(&str, &Map<String, Value>), Refused> {
    let o = v.as_object().ok_or_else(|| bad("an op is a JSON object"))?;
    let name = o.get("op").and_then(Value::as_str).ok_or_else(|| bad("an op names what it does: \"op\""))?;
    let known = fields(name).ok_or_else(|| bad(format!("no op is called {name:?}")))?;
    if let Some(k) = o.keys().find(|k| *k != "op" && !known.contains(&k.as_str())) {
        return Err(bad(format!("{name} takes no field {k:?}")));
    }
    Ok((name, o))
}

/// Whether op `v` only reads: a device runs it on what it holds and changes nothing.
pub fn reads(v: &Value) -> bool {
    op_of(v).is_ok_and(|(name, _)| READS.contains(&name))
}

/// Runs op `v` on device `me`: its answer, `{"ok": ...}` or a refusal.
pub fn run(lab: &mut Lab, me: SignerId, v: &Value) -> Value {
    if reads(v) {
        return read(lab, me, v);
    }
    if op_of(v).is_ok_and(|(name, _)| name == "may") {
        return answer(may(lab, me, v));
    }
    answer(change(lab, me, v))
}

/// Whether op `v` changes nothing, though it runs on the Lab: `may`, whose dry runs make nothing.
pub fn asks(v: &Value) -> bool {
    op_of(v).is_ok_and(|(name, _)| name == "may")
}

/// Runs read op `v` on device `me`: its answer, `{"ok": ...}` or a refusal. A change is refused, as it isn't run.
pub fn read(lab: &Lab, me: SignerId, v: &Value) -> Value {
    let out = op_of(v).and_then(|(name, o)| match name {
        "query" => query(lab, me, o),
        "get" => get(lab, me, o),
        "history" => history(lab, me, o),
        "schemas" => schemas(lab, me, o),
        _ => Err(bad(format!("{name} changes what the device holds: run it, don't read it"))),
    });
    answer(out)
}

fn answer(out: Result<Value, Refused>) -> Value {
    match out {
        Ok(v) => json!({ "ok": v }),
        Err(why) => why.to_json(),
    }
}

// The fields ops share.

fn id_of<T>(v: Option<&Value>, what: &str, of: fn(&str) -> Option<T>) -> Result<T, Refused> {
    v.and_then(Value::as_str).and_then(of).ok_or_else(|| bad(format!("{what} is an id, 64 hex digits")))
}

fn entry_of(o: &Map<String, Value>) -> Result<EntryId, Refused> {
    id_of(o.get("entry"), "entry", EntryId::from_hex)
}

fn vault_of(o: &Map<String, Value>, field: &str) -> Result<VaultId, Refused> {
    id_of(o.get(field), field, VaultId::from_hex)
}

/// A line: the main line, `null` or left out, or a proposal by the write that started it.
fn line_of(o: &Map<String, Value>, field: &str) -> Result<Line, Refused> {
    match o.get(field) {
        None | Some(Value::Null) => Ok(MAIN),
        v => id_of(v, field, EditId::from_hex).map(Some),
    }
}

fn line_json(line: Line) -> Value {
    line.map_or(Value::Null, |b| b.to_hex().into())
}

/// A version: writes of the entry, by their ids.
fn edits_of(v: &Value, field: &str) -> Result<Vec<EditId>, Refused> {
    let xs = v.as_array().ok_or_else(|| bad(format!("{field} is a list of edits")))?;
    xs.iter().map(|x| id_of(Some(x), field, EditId::from_hex)).collect()
}

fn ids(edits: &[EditId]) -> Vec<String> {
    edits.iter().map(EditId::to_hex).collect()
}

fn texts_of(o: &Map<String, Value>, field: &str) -> Result<Vec<String>, Refused> {
    let Some(v) = o.get(field) else { return Ok(vec![]) };
    let xs = v.as_array().ok_or_else(|| bad(format!("{field} is a list of texts")))?;
    let text = |x: &Value| x.as_str().map(str::to_string).ok_or_else(|| bad(format!("{field} is a list of texts")));
    xs.iter().map(text).collect()
}

fn count_of(o: &Map<String, Value>, field: &str) -> Result<Option<usize>, Refused> {
    let count = |v: &Value| v.as_u64().map(|n| n as usize).ok_or_else(|| bad(format!("{field} is a count")));
    o.get(field).map(count).transpose()
}

fn strs(xs: &[String]) -> Vec<&str> {
    xs.iter().map(String::as_str).collect()
}

// Records through schemas.

/// The schema an op names.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Named {
    /// None: the one the record's kind names.
    Own,
    /// The record as stored.
    Stored,
    Id(BlobId),
}

fn named(o: &Map<String, Value>) -> Result<Named, Refused> {
    let bad = || bad("schema is \"document\", \"todo\", \"stored\" or a schema's id, 64 hex digits");
    Ok(match o.get("schema") {
        None | Some(Value::Null) => Named::Own,
        Some(Value::String(s)) => match s.as_str() {
            "stored" => Named::Stored,
            "document" => Named::Id(lens::DOCUMENT_V2.id()),
            "todo" => Named::Id(lens::TODO_V2.id()),
            s => Named::Id(BlobId::from_hex(s).ok_or_else(bad)?),
        },
        Some(_) => return Err(bad()),
    })
}

/// The schemas and lenses device `me` reads vault `v`'s entries through: the app's own, then what the vault's lane
/// publishes.
fn lane(lab: &Lab, me: SignerId, v: VaultId) -> Lane {
    Lane::with_built_ins(lab.state(me).lane_of(v))
}

/// The schema a record's kind names: of those in the lane whose `kind` is that constant, the newest, the one no lens
/// leads on from, and of several such the first by id.
fn own(lane: &Lane, stored: &Value) -> Option<Schema> {
    let kind = stored.get("kind")?.as_str()?;
    let of_kind: Vec<&Schema> = lane.schemas().filter(|s| s.kind() == Some(kind)).collect();
    let newer = |s: &Schema| lane.lenses().any(|l| l.from() == s.id() && of_kind.iter().any(|t| t.id() == l.to()));
    of_kind.iter().find(|s| !newer(s)).map(|s| (*s).clone())
}

/// An entry's record as an op sees it: through `view` (none: as stored), and whether it may change it there.
struct Seen {
    record: Record,
    view: Option<View>,
    read_only: bool,
}

impl Seen {
    fn schema(&self) -> Value {
        self.view.as_ref().map_or(Value::Null, |v| v.schema().id().to_hex().into())
    }
}

/// Item `item` as an op naming `schema` sees it through `lane`: `None` if that schema isn't in the lane or the record
/// isn't one of it.
fn see(lane: &Lane, item: &Item, schema: &Named) -> Option<Seen> {
    let stored = item.record();
    let app = match schema {
        Named::Stored => None,
        Named::Own => own(lane, &stored),
        Named::Id(id) => Some(lane.schema(*id)?.clone()),
    };
    let Some(app) = app else {
        return Some(Seen { record: stored.as_object().cloned().unwrap_or_default(), view: None, read_only: true });
    };
    let (view, read_only) = lane.view(&app, &item.authored());
    let record = item.read(&view)?.as_object()?.clone();
    Some(Seen { record, view: Some(view), read_only })
}

/// Why `see` saw nothing.
fn unseen(schema: &Named) -> Refused {
    Refused::NoSchema(match schema {
        Named::Id(id) => {
            format!("the record isn't one of schema {}, or the vault's lane holds no such schema", id.to_hex())
        }
        _ => "no schema reads the record".into(),
    })
}

/// The record an app on `app` makes of `new`: each field it leaves out at its default. `NotAView` if a value doesn't
/// fit, a required field is missing, or a list of records holds one id twice.
fn full(app: &Schema, new: &Value) -> Result<Value, Refused> {
    let seen = app.read(new).ok_or(Refusal::NotAView)?;
    if !within(new, &seen) {
        return Err(Refusal::NotAView.into());
    }
    Ok(seen)
}

/// Whether `a` is `b` with some of its records' fields left out.
fn within(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Object(x), Value::Object(y)) => x.iter().all(|(k, v)| y.get(k).is_some_and(|w| within(v, w))),
        (Value::Array(xs), Value::Array(ys)) => xs.len() == ys.len() && xs.iter().zip(ys).all(|(x, y)| within(x, y)),
        _ => a == b,
    }
}

// Reads.

/// What a query orders its rows by: one of their labels, or a place of their records, each up or down.
enum By {
    Label(String),
    Place(Path),
}

fn order_of(o: &Map<String, Value>) -> Result<Vec<(By, bool)>, Refused> {
    let Some(v) = o.get("order") else { return Ok(vec![]) };
    let bad = || bad("order is a list of [key, \"asc\" or \"desc\"]: a key is a label, or a path into the record");
    let key = |k: &Value| match k {
        Value::String(l) if ["type", "author", "entry", "created"].contains(&l.as_str()) => Ok(By::Label(l.clone())),
        Value::Array(_) => Path::of_json(k).map(By::Place).map_err(|_| bad()),
        _ => Err(bad()),
    };
    let one = |x: &Value| match x.as_array().map(Vec::as_slice) {
        Some([k, Value::String(d)]) if d == "asc" || d == "desc" => Ok((key(k)?, d == "desc")),
        _ => Err(bad()),
    };
    v.as_array().ok_or_else(bad)?.iter().map(one).collect()
}

/// An order on values, for sorting: none first, then `null`, booleans, numbers, texts, lists and records.
fn compare(a: Option<&Value>, b: Option<&Value>) -> Ordering {
    let rank = |v: Option<&Value>| match v {
        None => 0,
        Some(Value::Null) => 1,
        Some(Value::Bool(_)) => 2,
        Some(Value::Number(_)) => 3,
        Some(Value::String(_)) => 4,
        Some(Value::Array(_)) => 5,
        Some(Value::Object(_)) => 6,
    };
    match (a, b) {
        (Some(Value::Bool(x)), Some(Value::Bool(y))) => x.cmp(y),
        (Some(Value::Number(x)), Some(Value::Number(y))) => {
            let (x, y) = (x.as_f64().unwrap_or(0.0), y.as_f64().unwrap_or(0.0));
            x.partial_cmp(&y).unwrap_or(Ordering::Equal)
        }
        (Some(Value::String(x)), Some(Value::String(y))) => x.cmp(y),
        _ => rank(a).cmp(&rank(b)),
    }
}

/// A row of a query, as `query` and `get` show it: the entry, its vault, its labels, the schema it was read through
/// (`null`: as stored), whether that schema may change it, and its record.
fn row(entry: EntryId, vault: VaultId, attrs: &Attrs, seen: &Seen, record: Record) -> Value {
    json!({
        "entry": entry.to_hex(),
        "vault": vault.to_hex(),
        "type": attrs.ty.as_str(),
        "tags": attrs.tags.iter().map(|t| t.as_str()).collect::<Vec<_>>(),
        "created": attrs.created,
        "author": attrs.author.to_hex(),
        "schema": seen.schema(),
        "readOnly": seen.read_only,
        "record": record,
    })
}

/// `{"op": "query", "vault"?, "where"?, "schema"?, "select"?, "order"?, "limit"?, "offset"?}`: the entries of vault
/// `vault` (of every vault, left out) on their main lines whose labels and records `where` holds of, each record
/// through `schema`; an entry it doesn't read, or that isn't one of the schema named, isn't there. Entries are picked
/// by the selector of the where's labels before any is opened (`plan`). In the order the device took them, or by
/// `order`; from the `offset`th, at most `limit`; each record with only the fields `select` names, if it names any.
/// `count` is how many rows there are in all.
fn query(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let w = o.get("where").map(Where::of_json).transpose().map_err(bad)?.unwrap_or(Where::Yes);
    let vault = o.get("vault").map(|_| vault_of(o, "vault")).transpose()?;
    let schema = named(o)?;
    let select = o.get("select").map(|_| texts_of(o, "select")).transpose()?;
    let order = order_of(o)?;
    let (limit, offset) = (count_of(o, "limit")?, count_of(o, "offset")?.unwrap_or(0));
    let plan = w.plan();
    let mut lanes: HashMap<VaultId, Lane> = HashMap::new();
    let mut rows = vec![];
    for entry in lab.entries(me) {
        let Some(v) = lab.vault_of_entry(me, entry).filter(|v| vault.is_none_or(|x| x == *v)) else { continue };
        let Some(m) = lab.meaning(me, entry).filter(|m| plan.matches(&m.attrs)) else { continue };
        let Some(item) = lab.item(me, entry) else { continue };
        let lane = lanes.entry(v).or_insert_with(|| lane(lab, me, v));
        let Some(seen) = see(lane, item, &schema).filter(|s| w.holds(&m.attrs, &s.record)) else { continue };
        rows.push((entry, v, m.attrs, seen));
    }
    let label = |a: &Attrs, l: &str| -> Value {
        match l {
            "type" => a.ty.as_str().into(),
            "author" => a.author.to_hex().into(),
            "entry" => a.entry.to_hex().into(),
            _ => a.created.into(),
        }
    };
    rows.sort_by(|(_, _, a, x), (_, _, b, y)| {
        let by = |(key, down): &(By, bool)| {
            let o = match key {
                By::Label(l) => compare(Some(&label(a, l)), Some(&label(b, l))),
                By::Place(p) => compare(p.at(&x.record), p.at(&y.record)),
            };
            if *down { o.reverse() } else { o }
        };
        order.iter().map(by).find(|o| o.is_ne()).unwrap_or(Ordering::Equal)
    });
    let count = rows.len();
    let page = rows.into_iter().skip(offset).take(limit.unwrap_or(usize::MAX));
    let shown = page.map(|(entry, v, attrs, seen)| {
        let picked = |f: &String| select.as_ref().is_none_or(|fs| fs.contains(f));
        let record = seen.record.iter().filter(|(f, _)| picked(f)).map(|(f, x)| (f.clone(), x.clone())).collect();
        row(entry, v, &attrs, &seen, record)
    });
    Ok(json!({ "rows": shown.collect::<Vec<_>>(), "count": count, "plan": plan.to_json() }))
}

/// `{"op": "get", "entry", "schema"?, "line"?, "at"?}`: entry `entry` on line `line` (the main line, left out), or at
/// version `at` of that line, read-only, through `schema`, as a query's row, with the line's heads and the schemas the
/// item was written under.
fn get(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let (entry, line, schema) = (entry_of(o)?, line_of(o, "line")?, named(o)?);
    let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
    if !h.lines().contains(&line) {
        return Err(Refused::NoEntry);
    }
    let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
    let m = lab.meaning(me, entry).ok_or(Refused::NoEntry)?;
    let at = o.get("at").map(|v| edits_of(v, "at")).transpose()?;
    if at.iter().flatten().any(|e| h.get(*e).is_none()) {
        return Err(Refusal::UnknownDep.into());
    }
    let version;
    let item = match &at {
        Some(at) => {
            version = h.item_at(at, me, line);
            &version
        }
        None => lab.item_on(me, entry, line).ok_or(Refused::NoEntry)?,
    };
    let mut seen = see(&lane(lab, me, vault), item, &schema).ok_or_else(|| unseen(&schema))?;
    seen.read_only |= at.is_some();
    let mut out = row(entry, vault, &m.attrs, &seen, seen.record.clone());
    out["line"] = line_json(line);
    out["heads"] = ids(&h.heads(line)).into();
    out["at"] = at.as_deref().map_or(Value::Null, |at| ids(at).into());
    out["authored"] = item.authored().iter().map(BlobId::to_hex).collect::<Vec<_>>().into();
    Ok(out)
}

/// What one write of an entry's history is, as `history` and the note page show it.
pub struct Wrote {
    /// `edit`; `propose`, the start of a proposal; `merge` of two lines, which carries no change; `promote`, a merge
    /// whose change brings its line to the other's record; or `sealed`, a write the device can't open.
    pub kind: &'static str,
    /// The other line it builds on: for a merge or a promote, the line it brought in; for a proposal, the line it
    /// started from.
    pub from: Option<Line>,
    /// The version it changed: what it built on, or for a merge or a promote, its own line's version before it, so its
    /// changes are what it brought.
    pub base: Vec<EditId>,
    /// Why its readers don't count it, if they don't: it builds on a write they don't count (`builds-on`); they can't
    /// open it (`sealed`); it doesn't fit the schemas its entry was written under (`unfit`, S1 to S4); or the rules of
    /// the caps it relies on don't allow what it touches (`rules`, C1 to C4).
    pub why: Option<&'static str>,
}

pub fn wrote(h: &History, c: &history::Change) -> Wrote {
    let w = &c.write;
    let line = w.line();
    let on = |d: &EditId| h.get(*d).map(|x| x.write.line());
    let from = w.deps.iter().filter_map(on).find(|l| *l != line);
    let kind = match &c.body {
        _ if w.proposal == Proposal::New => "propose",
        None => "sealed",
        Some(change) if change.is_empty() => "merge",
        Some(_) if from.is_some() => "promote",
        Some(_) => "edit",
    };
    let own: Vec<EditId> = w.deps.iter().copied().filter(|d| on(d) == Some(line)).collect();
    let base = if kind == "edit" || own.is_empty() { w.deps.clone() } else { own };
    let builds_on = || w.deps.iter().any(|d| h.get(*d).is_some_and(|x| !x.counted));
    let why = if c.counted {
        None
    } else if builds_on() {
        Some("builds-on")
    } else if c.body.is_none() {
        Some("sealed")
    } else if !c.fits {
        Some("unfit")
    } else {
        Some("rules")
    };
    Wrote { kind, from, base, why }
}

/// A line by name: `main`, or its proposal's, `None` for a proposal whose name the device can't open.
pub fn line_name(h: &History, line: Line) -> Option<String> {
    match line {
        None => Some("main".into()),
        Some(b) => h.name(b),
    }
}

/// `{"op": "history", "entry", "limit"?}`: entry `entry`'s lines, the main line first, then each proposal in the order
/// it started, each with its name, the version it started from and its heads; and every write of it the device holds,
/// in the order it took them, each with its id, its device (`author`), the vault it acted for, its line, what it
/// builds on, what it is (`wrote`), whether its readers count it (`counted`: a write that breaks its entry's schemas,
/// that no rule of its caps allows, or that builds on one, is on no line), why not (`why`) and, for the latest `limit`
/// (`SHOWN`, left out) that change anything, the changes it made to the stored record (`ops::diff`), which every
/// reader of the entry sees alike.
fn history(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let entry = entry_of(o)?;
    let limit = count_of(o, "limit")?.unwrap_or(SHOWN);
    let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
    let line = |line: Line| {
        let start = line.and_then(|b| h.get(b));
        json!({
            "line": line_json(line),
            "name": line_name(h, line),
            "from": start.map(|c| ids(&c.write.deps)),
            "heads": ids(&h.heads(line)),
        })
    };
    let shown = h.changes().len().saturating_sub(limit);
    let edit = |(i, c): (usize, &history::Change)| {
        let (w, x) = (&c.write, wrote(h, c));
        let changes = (i >= shown && matches!(x.kind, "edit" | "promote")).then(|| {
            let after = h.item_at(&[w.edit], me, w.line()).record();
            let before = h.item_at(&x.base, me, w.line()).record();
            let empty = Record::new();
            let (a, b) = (before.as_object().unwrap_or(&empty), after.as_object().unwrap_or(&empty));
            ops::diff(a, b).iter().map(ops::Change::to_json).collect::<Vec<_>>()
        });
        json!({
            "id": w.edit.to_hex(),
            "author": w.author.to_hex(),
            "actor": w.actor.to_hex(),
            "line": line_json(w.line()),
            "deps": ids(&w.deps),
            "kind": x.kind,
            "counted": c.counted,
            "why": x.why,
            "name": if x.kind == "propose" { h.name(w.edit) } else { None },
            "from": x.from.map(|l| json!({ "line": line_json(l), "name": line_name(h, l) })),
            "changes": changes,
        })
    };
    let vault = lab.vault_of_entry(me, entry).map(|v| v.to_hex());
    Ok(json!({
        "entry": entry.to_hex(),
        "vault": vault,
        "lines": h.lines().into_iter().map(line).collect::<Vec<_>>(),
        "edits": h.changes().iter().enumerate().map(edit).collect::<Vec<_>>(),
    }))
}

/// `{"op": "schemas", "vault"}`: the schemas and lenses vault `vault`'s entries are read through, the app's own first
/// (`builtIn`), then what its lane publishes: each schema's id, title, the kind its records name and its JSON, each
/// lens's id, title, the schemas it joins and its JSON.
fn schemas(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let vault = vault_of(o, "vault")?;
    let built_in: Vec<BlobId> = lens::blobs::ALL.iter().map(|b| BlobId::of(b.as_bytes())).collect();
    let lane = lane(lab, me, vault);
    let text = |b: &[u8]| String::from_utf8_lossy(b).into_owned();
    let schema = |s: &Schema| {
        let id = s.id();
        json!({
            "id": id.to_hex(),
            "title": s.title(),
            "kind": s.kind(),
            "builtIn": built_in.contains(&id),
            "json": text(s.bytes()),
        })
    };
    let lens = |l: &lens::Lens| {
        let id = l.id();
        json!({
            "id": id.to_hex(),
            "title": l.title(),
            "from": l.from().to_hex(),
            "to": l.to().to_hex(),
            "builtIn": built_in.contains(&id),
            "json": text(l.bytes()),
        })
    };
    let first = |x: &Value| !x["builtIn"].as_bool().unwrap_or(false);
    let mut schemas: Vec<Value> = lane.schemas().map(schema).collect();
    let mut lenses: Vec<Value> = lane.lenses().map(lens).collect();
    schemas.sort_by_key(first);
    lenses.sort_by_key(first);
    Ok(json!({ "vault": vault.to_hex(), "schemas": schemas, "lenses": lenses }))
}

// Changes.

/// A change op, read: what it does, and the vault it acts for, if it names one.
struct Act {
    actor: Option<VaultId>,
    step: Step,
}

enum Step {
    Create { vault: VaultId, ty: String, tags: Vec<String>, schema: Named, value: Value },
    /// Record ops on one entry's line, through one schema: one write.
    Edits { entry: EntryId, line: Line, schema: Named, ops: Vec<Op> },
    Tag { entry: EntryId, add: Vec<String>, remove: Vec<String> },
    Propose { entry: EntryId, from: Option<Vec<EditId>>, name: String },
    Merge { entry: EntryId, from: Line, into: Line, promote: bool },
    Restore { entry: EntryId, line: Line, at: Vec<EditId> },
    Undo { entry: EntryId, line: Line, edit: EditId },
    Variant { entry: EntryId, line: Line, into: VaultId, schema: Named, ops: Vec<Op> },
}

impl Step {
    /// Step `next` joined to this one, record ops in a row on one entry's line through one schema, which make one
    /// write; or `next` back, if it doesn't join.
    fn join(&mut self, next: Step) -> Option<Step> {
        match (self, next) {
            (Step::Edits { entry, line, schema, ops }, Step::Edits { entry: e, line: l, schema: s, ops: more })
                if (*entry, *line, &*schema) == (e, l, &s) =>
            {
                ops.extend(more);
                None
            }
            (_, next) => Some(next),
        }
    }
}

/// Record ops, read: each of `ops::Op`, carrying no field an op on a record doesn't take.
fn record_ops(v: &Value) -> Result<Vec<Op>, Refused> {
    let xs = v.as_array().ok_or_else(|| bad("ops is a list of ops"))?;
    let one = |x: &Value| {
        let (name, o) = op_of(x)?;
        if !["set", "unset", "insert", "remove", "move"].contains(&name) {
            return Err(bad(format!("{name} isn't an op on a record")));
        }
        if let Some(k) = ["entry", "line", "schema", "as"].iter().find(|k| o.contains_key(**k)) {
            return Err(bad(format!("an op on the copy takes no {k:?}: the variant names them")));
        }
        Op::of_json(x).map_err(bad)
    };
    xs.iter().map(one).collect()
}

/// Change op `v`, read.
fn act_of(v: &Value) -> Result<Act, Refused> {
    let (name, o) = op_of(v)?;
    let actor = o.get("as").map(|_| vault_of(o, "as")).transpose()?;
    let text = |field: &str| {
        let text = o.get(field).and_then(Value::as_str).map(str::to_string);
        text.ok_or_else(|| bad(format!("{name} takes a text {field}")))
    };
    let step = match name {
        "create" => {
            let value = o.get("value").filter(|v| v.is_object()).ok_or_else(|| bad("create takes a record: value"))?;
            let (tags, schema) = (texts_of(o, "tags")?, named(o)?);
            Step::Create { vault: vault_of(o, "vault")?, ty: text("type")?, tags, schema, value: value.clone() }
        }
        "set" | "unset" | "insert" | "remove" | "move" => {
            let op = Op::of_json(v).map_err(bad)?;
            Step::Edits { entry: entry_of(o)?, line: line_of(o, "line")?, schema: named(o)?, ops: vec![op] }
        }
        "tag" => Step::Tag { entry: entry_of(o)?, add: texts_of(o, "add")?, remove: texts_of(o, "remove")? },
        "propose" => {
            let from = o.get("from").map(|v| edits_of(v, "from")).transpose()?;
            Step::Propose { entry: entry_of(o)?, from, name: text("name")? }
        }
        "merge" => {
            if !o.contains_key("from") {
                return Err(bad("merge takes the line it merges: from, null for the main line"));
            }
            let promote = match o.get("promote") {
                None => false,
                Some(p) => p.as_bool().ok_or_else(|| bad("promote is true or false"))?,
            };
            Step::Merge { entry: entry_of(o)?, from: line_of(o, "from")?, into: line_of(o, "into")?, promote }
        }
        "restore" => {
            let at = edits_of(o.get("at").ok_or_else(|| bad("restore takes the version it puts back: at"))?, "at")?;
            Step::Restore { entry: entry_of(o)?, line: line_of(o, "line")?, at }
        }
        "undo" => {
            let edit = id_of(o.get("edit"), "edit", EditId::from_hex)?;
            Step::Undo { entry: entry_of(o)?, line: line_of(o, "line")?, edit }
        }
        "variant" => {
            let ops = o.get("ops").map(record_ops).transpose()?.unwrap_or_default();
            let (line, schema) = (line_of(o, "line")?, named(o)?);
            Step::Variant { entry: entry_of(o)?, line, into: vault_of(o, "into")?, schema, ops }
        }
        "batch" => return Err(bad("a batch holds no batch")),
        "may" => return Err(bad("may asks about change ops, not about may")),
        name => return Err(bad(format!("{name} only reads: read it, don't run it"))),
    };
    Ok(Act { actor, step })
}

/// Change op `v` run on device `me`: a single op's answer, or a batch's, one for each step, a step being an op or
/// record ops in a row on one entry's line through one schema acting for one vault, which make one write. Every op
/// of a batch is read before any runs; then they run in order up to the first refused, and what ran before it
/// stands: the refusal says which (`at`) and what those did (`done`).
fn change(lab: &mut Lab, me: SignerId, v: &Value) -> Result<Value, Refused> {
    let (name, o) = op_of(v)?;
    if name != "batch" {
        let act = act_of(v)?;
        let actor = act.actor.or_else(|| lab.vault_of(me)).ok_or(Refusal::NotActing)?;
        return step(lab, me, actor, act.step);
    }
    let actor = o.get("as").map(|_| vault_of(o, "as")).transpose()?;
    let ops = o.get("ops").and_then(Value::as_array).ok_or_else(|| bad("a batch takes its ops: ops"))?;
    let mut steps: Vec<(usize, VaultId, Step)> = vec![];
    let refused = |at, done: &[Value], why| Refused::Batch { at, done: done.to_vec(), why: Box::new(why) };
    for (i, op) in ops.iter().enumerate() {
        let act = act_of(op).map_err(|why| refused(i, &[], why))?;
        let actor = act.actor.or(actor).or_else(|| lab.vault_of(me));
        let actor = actor.ok_or_else(|| refused(i, &[], Refusal::NotActing.into()))?;
        let next = match steps.last_mut() {
            Some((_, a, last)) if *a == actor => last.join(act.step),
            _ => Some(act.step),
        };
        steps.extend(next.map(|next| (i, actor, next)));
    }
    let mut done = vec![];
    for (i, actor, s) in steps {
        let out = step(lab, me, actor, s).map_err(|why| refused(i, &done, why))?;
        done.push(out);
    }
    Ok(done.into())
}

/// `{"op": "may", "ops", "as"?}`: whether device `me` would make each of the change ops `ops`, each acting for the
/// vault it names (`as`, else the may's, else the device's own), each on what the device holds now: for each, `true`,
/// or the refusal running it would meet. Each runs dry (`Lab::dry`): checked, proven against the rules of the caps it
/// relies on and refused as `run` would, and then not made.
fn may(lab: &mut Lab, me: SignerId, v: &Value) -> Result<Value, Refused> {
    let (_, o) = op_of(v)?;
    let actor = o.get("as").map(|_| vault_of(o, "as")).transpose()?;
    let ops = o.get("ops").and_then(Value::as_array).ok_or_else(|| bad("may takes the ops it asks about: ops"))?;
    let one = |lab: &mut Lab, op: &Value| -> Result<Value, Refused> {
        let act = act_of(op)?;
        let actor = act.actor.or(actor).or_else(|| lab.vault_of(me)).ok_or(Refusal::NotActing)?;
        lab.dry(|lab| step(lab, me, actor, act.step))
    };
    let answers = ops.iter().map(|op| match one(lab, op) {
        Ok(_) => Value::Bool(true),
        Err(why) => why.to_json(),
    });
    Ok(answers.collect::<Vec<_>>().into())
}

/// Step `s`, acting for `actor`, on device `me`.
fn step(lab: &mut Lab, me: SignerId, actor: VaultId, s: Step) -> Result<Value, Refused> {
    match s {
        Step::Create { vault, ty, tags, schema, value } => {
            let lane = lane(lab, me, vault);
            let app = match schema {
                Named::Own => own(&lane, &value),
                Named::Stored => None,
                Named::Id(id) => lane.schema(id).cloned(),
            };
            let app = app.ok_or_else(|| unseen(&schema))?;
            let item = Item::made(&View::plain(&app), &full(&app, &value)?, me).ok_or(Refusal::NotAView)?;
            let entry = lab.create(me, actor, vault, &ty, &strs(&tags), item)?;
            Ok(json!({ "entry": entry.to_hex() }))
        }
        Step::Edits { entry, line, schema, ops } => edits(lab, me, actor, (entry, line), &schema, &ops),
        Step::Tag { entry, add, remove } => {
            let edit = lab.tag(me, actor, entry, &strs(&add), &strs(&remove))?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex() }))
        }
        Step::Propose { entry, from, name } => {
            let from = match from {
                Some(from) => from,
                None => lab.history(me, entry).ok_or(Refused::NoEntry)?.heads(MAIN),
            };
            let edit = lab.propose(me, actor, entry, &from, &name)?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": edit.to_hex() }))
        }
        Step::Merge { entry, from, into, promote } => {
            let edit = match promote {
                true => lab.promote(me, actor, entry, from, into)?,
                false => lab.merge(me, actor, entry, from, into)?,
            };
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": line_json(into) }))
        }
        Step::Restore { entry, line, at } => {
            let edit = lab.restore(me, actor, entry, line, &at)?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": line_json(line) }))
        }
        Step::Undo { entry, line, edit } => {
            let edit = lab.undo(me, actor, entry, line, edit)?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": line_json(line) }))
        }
        Step::Variant { entry, line, into, schema, ops } => {
            let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
            let lane = lane(lab, me, vault);
            let mark = |copy: &mut Item| -> Result<(), Refused> {
                if ops.is_empty() {
                    return Ok(());
                }
                let (new, view) = ran(&lane, copy, &schema, &ops)?;
                copy.write(&view, &new);
                Ok(())
            };
            let made = lab.variant_with(me, actor, entry, (line, into), mark)?;
            Ok(json!({ "entry": made.to_hex() }))
        }
    }
}

/// Record ops `ops` run on what item `item` shows through `schema`: the record after them, each field they leave out
/// at its default, and the view to write it through.
fn ran(lane: &Lane, item: &Item, schema: &Named, ops: &[Op]) -> Result<(Value, View), Refused> {
    let seen = see(lane, item, schema).ok_or_else(|| unseen(schema))?;
    let view = seen.view.ok_or_else(|| Refused::NoSchema("a stored record changes only through its schema".into()))?;
    if seen.read_only {
        return Err(Refusal::ReadOnly.into());
    }
    let mut r = seen.record;
    for op in ops {
        let what = || bad(format!("{} makes no sense of the record: no such field or row, an id twice", op.to_json()));
        r = op.run(&r).ok_or_else(what)?;
    }
    let new = full(view.schema(), &Value::Object(r))?;
    view.put(&item.record(), &new).ok_or(Refusal::NotAView)?;
    Ok((new, view))
}

/// Record ops `ops` on entry `entry`'s line `line` through `schema`, acting for `actor`: one write of what changed, or
/// none if nothing did (`edit` is `null` then).
fn edits(
    lab: &mut Lab,
    me: SignerId,
    actor: VaultId,
    (entry, line): (EntryId, Line),
    schema: &Named,
    ops: &[Op],
) -> Result<Value, Refused> {
    let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
    let lane = lane(lab, me, vault);
    let item = lab.item_on(me, entry, line).ok_or(Refused::NoEntry)?;
    let (new, view) = ran(&lane, item, schema, ops)?;
    let unchanged = item.read(&view).as_ref() == Some(&new);
    let edit = match unchanged {
        true => None,
        false => Some(lab.edit_on(me, actor, entry, line, |item| {
            item.write(&view, &new);
        })?),
    };
    Ok(json!({ "entry": entry.to_hex(), "line": line_json(line), "edit": edit.map(|e| e.to_hex()) }))
}
