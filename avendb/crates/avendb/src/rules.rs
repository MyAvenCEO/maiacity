//! Shares are named groups of ops, as in `avendb/spec/AvenDB/Rules.lean` (`docs/ARCHITECTURE.md` §8). A share is a
//! name and the ops its grantee may make on the slice its selector picks: relay, backup and read (keep, pass on and
//! open the slice's edits), the write ops (create an entry, set a value, add, delete or move rows, ask for tags, start
//! a proposal, merge a line) and share (issue shares resting on it). Its level, which relays and every operational rule
//! read in the clear (`policy::Share::level`), is the class of its strongest op (`level_of`). Every reader of an entry
//! judges each write by its touches, what its Loro ops did, place by place, read off the write imported on the version
//! it builds on (`doc::Item::footprint`, `history::History::reading`), and the tags it asks for: a value set at a
//! place, rows of a list added, deleted or moved, the entry created, a proposal started, another line merged in, a tag
//! asked for. A share's ops allow a write when each touch is allowed by one of them.
//!
//! The ops travel sealed in the share's slice, beside its selector, with a salt (`Grant`); the share's `select` carries
//! their hash in the clear (`Grant::commitment`, `slice::Select`), which tells a relay nothing of them. A write through
//! a share carries, inside its encrypted body, a proof (`Proof`): the share it relies on and the grant of every share
//! of that share's chain, which its readers check against the commitments, and each share's level against its ops
//! (`policy::State::lets`).
//!
//! An op in JSON, as the docs write it:
//!
//! ```text
//! {"op": "relay" | "backup" | "read" | "create" | "propose" | "share"}
//! {"op": "set", "path": Pattern, "to": [v]?, "on": On?}     any change at or under the path; to: only to these values
//! {"op": "insert" | "remove" | "move", "path": Pattern?, "on": On?}   rows of a list of records
//! {"op": "tag", "tags": [tag]?}                              ask for these tags, added or removed; left out: any
//! {"op": "merge", "on": On?}
//! Pattern = a path whose steps may be "*": any one field or any one row; [] is the whole record
//! On      = "main" | "proposals"                                     left out: either
//! ```

use serde_json::{json, Map, Value};

use crate::id::ShareId;
use crate::ops::{Loc, Seg};
use crate::policy::{KeepMode, Level};
use crate::slice::{Sym, TagDelta};

/// The most ops a share names, steps a pattern has, and values an op may set a place to or tags it may ask for: so
/// judging a write stays linear in it, and ops fit in a sealed slice. The most shares a proof opens: a write through a
/// longer chain is never counted. And the longest name a share has, in characters.
pub const MAX_OPS: usize = 64;
/// The steps of a cap's path: a bound on decoding only, set with the generation 8 reset, so records nest inside
/// records as deep as anyone needs, and a cap reaches them, without another reset.
pub const MAX_STEPS: usize = 64;
pub const MAX_VALUES: usize = 64;
pub const MAX_GRANTS: usize = 16;
pub const MAX_NAME: usize = 64;

/// A step of an op's path: a field, a row of a list of records by its id, or any one step.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Step {
    Field(String),
    Row(i64),
    Any,
}

/// The lines an op holds on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum On {
    Main,
    Proposals,
}

/// A value an op may set a place to, and the value a touch names where one op set one: `null`, a boolean, an integer
/// or a text.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Scalar {
    Null,
    Bool(bool),
    Int(i64),
    Text(String),
}

/// What a write did, one op at a time: a value set or removed, a text edited or a list of values changed at a place
/// (with the value set, where one op set one plain value, `null` where it removed one); a row of a list of records
/// added, deleted or moved, the list named by its place, at any depth (what a write does inside a row it adds is part
/// of adding it); the entry created; a tag asked for, added or removed; a proposal started; another line merged in. An
/// op a reader can't place touches the whole record (`Loc::root`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Touch {
    Set(Loc, Option<Scalar>),
    Insert(Loc),
    Remove(Loc),
    Move(Loc),
    Create,
    Tag(Sym),
    Propose,
    Merge,
}

/// An op a share names, in the order shares list them (`normalize`): `Relay`, `Backup` and `Read` its slice's edits;
/// `Create` entries; `Set` any change at or under `path` (only to the values `to`, if it lists them), `Insert`,
/// `Remove` or `Move` the rows of a list, `Merge` another line, each on the lines `on` names (either, if none); ask for
/// the tags `Tag` lists (any, if none); `Propose`; and `Share`, issue shares resting on it. A share with `Share` is an
/// owner's, never on the whole vault (`policy::Refusal::WideOwner`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Op {
    Relay,
    Backup,
    Read,
    Create,
    Set { path: Vec<Step>, to: Option<Vec<Scalar>>, on: Option<On> },
    Insert { path: Vec<Step>, on: Option<On> },
    Remove { path: Vec<Step>, on: Option<On> },
    Move { path: Vec<Step>, on: Option<On> },
    Tag(Option<Vec<Sym>>),
    Propose,
    Merge { on: Option<On> },
    Share,
}

/// A share's ops and the salt that keeps them from being guessed: what its slice carries, sealed, and what a proof
/// opens to readers. Their hash is the share's commitment, in the clear.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Grant {
    pub ops: Vec<Op>,
    pub salt: [u8; 32],
}

/// What a write through a share carries inside its encrypted body: the share it relies on, and the grant of each share
/// of that share's chain, root first.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Proof {
    pub share: ShareId,
    pub grants: Vec<Grant>,
}

/// A built-in group: a name, what it lets its holders do in a few words, the ops its shares name, and whether it goes
/// to everyone (Public). The page offers them when it shares; anyone may name their own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Group {
    pub name: &'static str,
    pub hint: &'static str,
    pub ops: Vec<Op>,
    pub everyone: bool,
}

impl Scalar {
    /// A plain value from its JSON; none for a number that isn't an integer, a list or an object.
    pub fn of_json(v: &Value) -> Option<Scalar> {
        match v {
            Value::Null => Some(Scalar::Null),
            Value::Bool(b) => Some(Scalar::Bool(*b)),
            Value::Number(n) => n.as_i64().map(Scalar::Int),
            Value::String(s) => Some(Scalar::Text(s.clone())),
            _ => None,
        }
    }

    pub fn to_json(&self) -> Value {
        match self {
            Scalar::Null => Value::Null,
            Scalar::Bool(b) => (*b).into(),
            Scalar::Int(i) => (*i).into(),
            Scalar::Text(s) => s.as_str().into(),
        }
    }
}

impl Grant {
    /// The commitment to the ops, as the share's `select` carries it in the clear: the hash of the ops and the salt.
    pub fn commitment(&self) -> [u8; 32] {
        let mut bytes = vec![];
        crate::encode::Encode::encode(self, &mut bytes);
        crate::hash::hash("grant", &bytes)
    }

    /// The level a share with these ops has (`level_of`).
    pub fn level(&self) -> Level {
        level_of(&self.ops)
    }
}

/// A place's path: its fields and rows, step by step, at any depth.
pub fn steps(l: &Loc) -> Vec<Step> {
    let step = |s: &Seg| match s {
        Seg::Field(f) => Step::Field(f.clone()),
        Seg::Row(i) => Step::Row(*i),
    };
    l.0.iter().map(step).collect()
}

impl Step {
    /// A step of a pattern fits a step of a path: the same field, the same row, or any.
    fn fits(&self, x: &Step) -> bool {
        match (self, x) {
            (Step::Any, _) => true,
            (Step::Field(f), Step::Field(g)) => f == g,
            (Step::Row(i), Step::Row(j)) => i == j,
            _ => false,
        }
    }

    fn to_json(&self) -> Value {
        match self {
            Step::Field(f) => f.as_str().into(),
            Step::Row(i) => json!({ "id": i }),
            Step::Any => "*".into(),
        }
    }

    fn of_json(v: &Value) -> Result<Step, String> {
        match v {
            Value::String(s) if s == "*" => Ok(Step::Any),
            Value::String(f) => Ok(Step::Field(f.clone())),
            Value::Object(o) if o.len() == 1 => {
                o.get("id").and_then(Value::as_i64).map(Step::Row).ok_or_else(|| format!("{v} is no step"))
            }
            _ => Err(format!("{v} is no step: a field, {{\"id\": n}} or \"*\"")),
        }
    }
}

/// A pattern reaches a path: it names it, or a place above it, step by step.
pub fn reaches(pattern: &[Step], path: &[Step]) -> bool {
    pattern.len() <= path.len() && pattern.iter().zip(path).all(|(p, x)| p.fits(x))
}

/// An op's lines hold a write on the main line (`main`) or on a proposal.
fn on_line(main: bool, on: Option<On>) -> bool {
    match on {
        None => true,
        Some(On::Main) => main,
        Some(On::Proposals) => !main,
    }
}

impl Op {
    /// Its class: relay, backup and read are their own, share is owner, and every op that writes is write.
    pub fn level(&self) -> Level {
        match self {
            Op::Relay => Level::Relay,
            Op::Backup => Level::Backup,
            Op::Read => Level::Read,
            Op::Share => Level::Owner,
            _ => Level::Write,
        }
    }

    /// Its place in the order shares list their ops.
    fn rank(&self) -> u8 {
        match self {
            Op::Relay => 0,
            Op::Backup => 1,
            Op::Read => 2,
            Op::Create => 3,
            Op::Set { .. } => 4,
            Op::Insert { .. } => 5,
            Op::Remove { .. } => 6,
            Op::Move { .. } => 7,
            Op::Tag(_) => 8,
            Op::Propose => 9,
            Op::Merge { .. } => 10,
            Op::Share => 11,
        }
    }

    /// The op allows touch `t` of a write on the main line (`main`) or on a proposal.
    pub fn allows(&self, main: bool, t: &Touch) -> bool {
        match (self, t) {
            (Op::Set { path, to, on }, Touch::Set(l, v)) => {
                on_line(main, *on)
                    && reaches(path, &steps(l))
                    && match (to, v) {
                        (None, _) => true,
                        (Some(vs), Some(x)) => vs.contains(x),
                        (Some(_), None) => false,
                    }
            }
            (Op::Set { path, to: None, on }, Touch::Insert(f) | Touch::Remove(f) | Touch::Move(f))
            | (Op::Insert { path, on }, Touch::Insert(f))
            | (Op::Remove { path, on }, Touch::Remove(f))
            | (Op::Move { path, on }, Touch::Move(f)) => on_line(main, *on) && reaches(path, &steps(f)),
            (Op::Merge { on }, Touch::Merge) => on_line(main, *on),
            (Op::Tag(tags), Touch::Tag(t)) => tags.as_ref().is_none_or(|ts| ts.contains(t)),
            (Op::Propose, Touch::Propose) | (Op::Create, Touch::Create) => true,
            _ => false,
        }
    }

    pub fn to_json(&self) -> Value {
        let path = |p: &[Step]| Value::Array(p.iter().map(Step::to_json).collect());
        let mut out = match self {
            Op::Set { path: p, to, .. } => {
                let mut o = json!({ "op": "set", "path": path(p) });
                if let Some(vs) = to {
                    o["to"] = vs.iter().map(Scalar::to_json).collect();
                }
                o
            }
            Op::Insert { path: p, .. } => json!({ "op": "insert", "path": path(p) }),
            Op::Remove { path: p, .. } => json!({ "op": "remove", "path": path(p) }),
            Op::Move { path: p, .. } => json!({ "op": "move", "path": path(p) }),
            Op::Merge { .. } => json!({ "op": "merge" }),
            Op::Tag(None) => return json!({ "op": "tag" }),
            Op::Tag(Some(ts)) => {
                return json!({ "op": "tag", "tags": ts.iter().map(Sym::as_str).collect::<Vec<_>>() });
            }
            Op::Relay => return json!({ "op": "relay" }),
            Op::Backup => return json!({ "op": "backup" }),
            Op::Read => return json!({ "op": "read" }),
            Op::Create => return json!({ "op": "create" }),
            Op::Propose => return json!({ "op": "propose" }),
            Op::Share => return json!({ "op": "share" }),
        };
        if let Op::Set { on: Some(on), .. }
        | Op::Insert { on: Some(on), .. }
        | Op::Remove { on: Some(on), .. }
        | Op::Move { on: Some(on), .. }
        | Op::Merge { on: Some(on) } = self
        {
            out["on"] = match on {
                On::Main => "main",
                On::Proposals => "proposals",
            }
            .into();
        }
        out
    }

    pub fn of_json(v: &Value) -> Result<Op, String> {
        let o = v.as_object().ok_or("an op is an object")?;
        let name = o.get("op").and_then(Value::as_str).ok_or("an op names itself: \"op\"")?;
        let fields: &[&str] = match name {
            "set" => &["op", "path", "to", "on"],
            "insert" | "remove" | "move" => &["op", "path", "on"],
            "merge" => &["op", "on"],
            "tag" => &["op", "tags"],
            "relay" | "backup" | "read" | "create" | "propose" | "share" => &["op"],
            other => {
                return Err(format!(
                    "a share names no op {other:?}: relay, backup, read, create, set, insert, remove, move, tag, \
                     propose, merge or share"
                ));
            }
        };
        if let Some(k) = o.keys().find(|k| !fields.contains(&k.as_str())) {
            return Err(format!("a {name} op takes no field {k:?}"));
        }
        let path = |required: bool| -> Result<Vec<Step>, String> {
            let Some(p) = o.get("path") else {
                return if required { Err(format!("a {name} op names a path")) } else { Ok(vec![]) };
            };
            let steps = p.as_array().ok_or("a path is a list of steps")?;
            if steps.len() > MAX_STEPS {
                return Err(format!("a path has at most {MAX_STEPS} steps"));
            }
            steps.iter().map(Step::of_json).collect()
        };
        let on = match o.get("on") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s == "main" => Some(On::Main),
            Some(Value::String(s)) if s == "proposals" => Some(On::Proposals),
            Some(x) => return Err(format!("on is \"main\" or \"proposals\", not {x}")),
        };
        Ok(match name {
            "set" => {
                let values = |vs: &Vec<Value>| vs.iter().map(Scalar::of_json).collect::<Option<Vec<_>>>();
                let to = match o.get("to") {
                    None | Some(Value::Null) => None,
                    Some(Value::Array(vs)) if vs.len() <= MAX_VALUES && values(vs).is_some() => values(vs),
                    Some(_) => {
                        return Err(format!(
                            "to is a list of at most {MAX_VALUES} plain values: null, true, false, integers, texts"
                        ));
                    }
                };
                Op::Set { path: path(true)?, to, on }
            }
            "insert" => Op::Insert { path: path(false)?, on },
            "remove" => Op::Remove { path: path(false)?, on },
            "move" => Op::Move { path: path(false)?, on },
            "merge" => Op::Merge { on },
            "tag" => {
                let names = |xs: &Vec<Value>| xs.iter().map(|x| x.as_str().map(Sym::new)).collect::<Option<Vec<_>>>();
                Op::Tag(match o.get("tags") {
                    None | Some(Value::Null) => None,
                    Some(Value::Array(xs)) if xs.len() <= MAX_VALUES && names(xs).is_some() => names(xs),
                    Some(_) => return Err(format!("tags is a list of at most {MAX_VALUES} tags")),
                })
            }
            "relay" => Op::Relay,
            "backup" => Op::Backup,
            "read" => Op::Read,
            "create" => Op::Create,
            "propose" => Op::Propose,
            _ => Op::Share,
        })
    }
}

/// A share's level: the class of its strongest op, relay for none (`Rules.lean`'s `levelOf`).
pub fn level_of(ops: &[Op]) -> Level {
    ops.iter().map(Op::level).max_by_key(|l| l.rank()).unwrap_or(Level::Relay)
}

/// A share's ops as it carries them: each once, in the order shares list them (an op's kind, then as given), read with
/// every op that writes or shares, as a writer reads what it builds on, and no relay or backup beside read or backup,
/// which they are part of. Refused: none, more than `MAX_OPS`, or ops of no level (none is).
pub fn normalize(ops: Vec<Op>) -> Result<Vec<Op>, String> {
    let mut out: Vec<Op> = Vec::with_capacity(ops.len() + 1);
    for o in ops {
        if !out.contains(&o) {
            out.push(o);
        }
    }
    if out.is_empty() {
        return Err("a share names at least one op".into());
    }
    let level = level_of(&out);
    if level.allows(Level::Write) && !out.contains(&Op::Read) {
        out.push(Op::Read);
    }
    out.retain(|o| match o {
        Op::Relay => level == Level::Relay,
        Op::Backup => level == Level::Backup,
        _ => true,
    });
    out.sort_by_key(Op::rank);
    if out.len() > MAX_OPS {
        return Err(format!("a share names at most {MAX_OPS} ops"));
    }
    Ok(out)
}

/// A share's name: a few words, at most `MAX_NAME` characters, not blank.
pub fn name_ok(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > MAX_NAME {
        return Err(format!("a share has a name of 1 to {MAX_NAME} characters"));
    }
    Ok(())
}

/// The built-in groups, as `Rules.lean` has them (`groups`): a level's group for each level, Suggester (start
/// proposals and write on them) and Public (everyone reads).
pub fn groups() -> Vec<Group> {
    let suggester = vec![
        Op::Read,
        Op::Set { path: vec![], to: None, on: Some(On::Proposals) },
        Op::Propose,
        Op::Merge { on: Some(On::Proposals) },
    ];
    let g = |name, hint, ops, everyone| Group { name, hint, ops, everyone };
    let level = |r: Level, hint| g(r.group(), hint, r.ops(), false);
    vec![
        level(Level::Owner, "Reads, edits and shares it on"),
        level(Level::Write, "Reads and edits it"),
        g("Suggester", "Reads it and suggests changes to merge", suggester, false),
        level(Level::Read, "Reads it"),
        g("Public", "Everyone reads it", Level::Read.ops(), true),
        level(Level::Backup, "Keeps it encrypted, reads nothing"),
        level(Level::Relay, "Finds its devices, keeps nothing"),
    ]
}

impl Level {
    /// The name of its built-in group, or for a keep share, which no group grants, of its mode.
    pub fn group(self) -> &'static str {
        match self {
            Level::Keep(KeepMode::Whole) => "Keep whole",
            Level::Keep(KeepMode::Opened) => "Keep when opened",
            Level::Keep(KeepMode::Never) => "Never keep",
            Level::Owner => "Owner",
            Level::Write => "Editor",
            Level::Read => "Viewer",
            Level::Backup => "Backup",
            Level::Relay => "Relay",
        }
    }

    /// The ops of its built-in group: what a share with this level and no narrower ops allows (`Rules.lean`'s
    /// `Level.ops`). A keep share allows none.
    pub fn ops(self) -> Vec<Op> {
        let edit = || {
            vec![
                Op::Read,
                Op::Create,
                Op::Set { path: vec![], to: None, on: None },
                Op::Tag(None),
                Op::Propose,
                Op::Merge { on: None },
            ]
        };
        match self {
            Level::Keep(_) => vec![],
            Level::Relay => vec![Op::Relay],
            Level::Backup => vec![Op::Backup],
            Level::Read => vec![Op::Read],
            Level::Write => edit(),
            Level::Owner => [edit(), vec![Op::Share]].concat(),
        }
    }
}

impl Group {
    /// `{name, hint, ops, everyone, level}`, its level the class of its ops (`level_of`, `words::level_name`).
    pub fn to_json(&self) -> Value {
        let (ops, level) = (ops_to_json(&self.ops), crate::words::level_name(level_of(&self.ops)));
        json!({ "name": self.name, "hint": self.hint, "ops": ops, "everyone": self.everyone, "level": level })
    }
}

/// Ops allow a write: each of its touches, of a write on the main line (`main`) or on a proposal, is allowed by one of
/// them.
pub fn allows_all(ops: &[Op], main: bool, touches: &[Touch]) -> bool {
    touches.iter().all(|t| ops.iter().any(|r| r.allows(main, t)))
}

/// A share's ops from their JSON: a list of ops, at most `MAX_OPS`, as given (`normalize` puts them in order).
pub fn ops_of_json(v: &Value) -> Result<Vec<Op>, String> {
    let rs = v.as_array().ok_or("ops are a list of ops")?;
    if rs.len() > MAX_OPS {
        return Err(format!("a share names at most {MAX_OPS} ops"));
    }
    rs.iter().map(Op::of_json).collect()
}

pub fn ops_to_json(ops: &[Op]) -> Value {
    ops.iter().map(Op::to_json).collect()
}

/// The tags a write asks for, added or removed, as touches (`Rules.lean`'s `TagDelta.touches`).
pub fn asked(d: &TagDelta) -> impl Iterator<Item = Touch> + '_ {
    d.add.iter().chain(&d.remove).cloned().map(Touch::Tag)
}

impl Touch {
    /// `{"set": path, "to": v}` (no `to` where no one plain value was set), `{"insert": list}`, `{"remove": list}`,
    /// `{"move": list}` (a list of the record by its field, one in a row by its path), `"create"`, `{"tag": tag}`,
    /// `"propose"` or `"merge"`.
    pub fn to_json(&self) -> Value {
        let list = |l: &Loc| match l.0.as_slice() {
            [Seg::Field(f)] => f.as_str().into(),
            _ => l.to_json(),
        };
        match self {
            Touch::Set(l, None) => json!({ "set": l.to_json() }),
            Touch::Set(l, Some(v)) => json!({ "set": l.to_json(), "to": v.to_json() }),
            Touch::Insert(f) => json!({ "insert": list(f) }),
            Touch::Remove(f) => json!({ "remove": list(f) }),
            Touch::Move(f) => json!({ "move": list(f) }),
            Touch::Create => "create".into(),
            Touch::Tag(t) => json!({ "tag": t.as_str() }),
            Touch::Propose => "propose".into(),
            Touch::Merge => "merge".into(),
        }
    }

    /// The place it may change (`Rules.lean`'s `Touch.loc`): where it sets, the list whose rows it changes, the whole
    /// record for a creation; none for a tag, a proposal's start or a merge, which change nothing of the record.
    pub fn loc(&self) -> Option<Loc> {
        match self {
            Touch::Set(l, _) => Some(l.clone()),
            Touch::Insert(f) | Touch::Remove(f) | Touch::Move(f) => Some(f.clone()),
            Touch::Create => Some(Loc::root()),
            Touch::Tag(_) | Touch::Propose | Touch::Merge => None,
        }
    }

    pub fn of_json(v: &Value) -> Result<Touch, String> {
        // a list of the record by its field, one in a row by its path
        let field = |o: &Map<String, Value>, k: &str| match &o[k] {
            Value::String(f) => Ok(Loc::field(f.as_str())),
            p @ Value::Array(xs) if xs.len() > 1 => Some(Loc::of_json(p)?)
                .filter(Loc::is_list)
                .ok_or_else(|| format!("{p} is no list: a field, or a path to a field of a row")),
            p => Err(format!("{p} is no list: a field, or a path to a field of a row")),
        };
        match v {
            Value::String(s) => match s.as_str() {
                "create" => Ok(Touch::Create),
                "propose" => Ok(Touch::Propose),
                "merge" => Ok(Touch::Merge),
                _ => Err(format!("{v} is no touch")),
            },
            Value::Object(o) if o.contains_key("set") && o.keys().all(|k| k == "set" || k == "to") => {
                let to = o.get("to").map(|v| Scalar::of_json(v).ok_or(format!("{v} is no plain value"))).transpose()?;
                Ok(Touch::Set(Loc::of_json(&o["set"])?, to))
            }
            Value::Object(o) if o.len() == 1 && o.contains_key("insert") => Ok(Touch::Insert(field(o, "insert")?)),
            Value::Object(o) if o.len() == 1 && o.contains_key("remove") => Ok(Touch::Remove(field(o, "remove")?)),
            Value::Object(o) if o.len() == 1 && o.contains_key("move") => Ok(Touch::Move(field(o, "move")?)),
            Value::Object(o) if o.len() == 1 && o.contains_key("tag") => {
                Ok(Touch::Tag(Sym::new(o["tag"].as_str().ok_or("a tag is a name")?)))
            }
            _ => Err(format!("{v} is no touch")),
        }
    }
}

/// Each touch once, in the order first made.
pub fn dedup(touches: Vec<Touch>) -> Vec<Touch> {
    let mut out: Vec<Touch> = Vec::with_capacity(touches.len());
    for t in touches {
        if !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn op(v: Value) -> Op {
        Op::of_json(&v).expect("an op")
    }

    fn touch(v: Value) -> Touch {
        Touch::of_json(&v).expect("a touch")
    }

    #[test]
    fn a_shares_op_reads_back_from_its_json() {
        let ops = [
            json!({ "op": "set", "path": ["status"], "to": ["open", "done"] }),
            json!({ "op": "set", "path": [], "on": "proposals" }),
            json!({ "op": "set", "path": ["blocks", "*", "checked"] }),
            json!({ "op": "set", "path": ["blocks", { "id": 2 }, "text"], "on": "main" }),
            json!({ "op": "insert", "path": ["items"] }),
            json!({ "op": "remove", "path": [] }),
            json!({ "op": "move", "path": ["blocks"], "on": "main" }),
            json!({ "op": "merge", "on": "proposals" }),
            json!({ "op": "merge" }),
            json!({ "op": "propose" }),
            json!({ "op": "create" }),
            json!({ "op": "tag" }),
            json!({ "op": "tag", "tags": ["urgent", "work"] }),
            json!({ "op": "relay" }),
            json!({ "op": "backup" }),
            json!({ "op": "read" }),
            json!({ "op": "share" }),
        ];
        for v in ops {
            assert_eq!(op(v.clone()).to_json(), v);
        }
        assert_eq!(op(json!({ "op": "insert" })), Op::Insert { path: vec![], on: None });
        let bad = [
            json!({ "op": "set" }),
            json!({ "op": "set", "path": ["status"], "to": [1.5] }),
            json!({ "op": "set", "path": ["status"], "to": [["x"]] }),
            json!({ "op": "set", "path": ["status"], "on": "drafts" }),
            json!({ "op": "propose", "path": [] }),
            json!({ "op": "delete", "path": [] }),
            json!({ "op": "set", "path": [1] }),
            json!({ "op": "set", "path": vec!["a"; MAX_STEPS + 1] }),
            json!({ "op": "tag", "tags": "urgent" }),
            json!({ "op": "read", "path": [] }),
        ];
        for v in bad {
            assert!(Op::of_json(&v).is_err(), "{v}");
        }
    }

    #[test]
    fn a_touch_reads_back_from_its_json() {
        let touches = [
            json!({ "set": ["status"], "to": "done" }),
            json!({ "set": ["blocks", { "id": 1 }, "text"] }),
            json!({ "set": [] }),
            json!({ "insert": "items" }),
            json!({ "remove": "items" }),
            json!({ "move": "items" }),
            json!({ "insert": ["items", { "id": 1 }, "steps"] }),
            json!({ "remove": ["a", { "id": 1 }, "b", { "id": 2 }, "c"] }),
            json!({ "move": ["items", { "id": 1 }, "steps"] }),
            json!({ "set": ["a", { "id": 1 }, "b", { "id": 2 }, "c", { "id": 3 }, "d"], "to": 1 }),
            json!("create"),
            json!({ "tag": "urgent" }),
            json!("propose"),
            json!("merge"),
        ];
        for v in touches {
            assert_eq!(touch(v.clone()).to_json(), v);
        }
        let bad = [
            json!({ "insert": ["items"] }),
            json!({ "insert": ["items", { "id": 1 }] }),
            json!({ "remove": [] }),
            json!({ "move": 1 }),
            json!({ "insert": ["items", "*", "steps"] }),
        ];
        for v in bad {
            assert!(Touch::of_json(&v).is_err(), "{v}");
        }
    }

    #[test]
    fn an_op_allows_the_touches_its_path_values_and_line_name() {
        let status = op(json!({ "op": "set", "path": ["status"], "to": ["open", "done"] }));
        assert!(status.allows(true, &touch(json!({ "set": ["status"], "to": "done" }))));
        assert!(!status.allows(true, &touch(json!({ "set": ["status"], "to": "lost" }))));
        assert!(!status.allows(true, &touch(json!({ "set": ["status"] }))));
        assert!(!status.allows(true, &touch(json!({ "set": ["title"], "to": "done" }))));
        // a set without values names rows too, at or under its path
        let items = op(json!({ "op": "set", "path": ["items"] }));
        for t in [json!({ "insert": "items" }), json!({ "remove": "items" }), json!({ "move": "items" })] {
            assert!(items.allows(false, &touch(t)));
        }
        assert!(items.allows(true, &touch(json!({ "set": ["items", { "id": 4 }, "text"] }))));
        assert!(!items.allows(true, &touch(json!({ "set": [] }))));
        assert!(!items.allows(true, &touch(json!({ "insert": "blocks" }))));
        // any row's field
        let checked = op(json!({ "op": "set", "path": ["blocks", "*", "checked"] }));
        assert!(checked.allows(true, &touch(json!({ "set": ["blocks", { "id": 7 }, "checked"], "to": true }))));
        assert!(!checked.allows(true, &touch(json!({ "set": ["blocks", { "id": 7 }, "text"] }))));
        assert!(!checked.allows(true, &touch(json!({ "remove": "blocks" }))));
        // the lines
        let suggest = op(json!({ "op": "set", "path": [], "on": "proposals" }));
        assert!(suggest.allows(false, &touch(json!({ "set": ["title"], "to": "x" }))));
        assert!(!suggest.allows(true, &touch(json!({ "set": ["title"], "to": "x" }))));
        let merge = op(json!({ "op": "merge", "on": "main" }));
        assert!(merge.allows(true, &Touch::Merge) && !merge.allows(false, &Touch::Merge));
        assert!(op(json!({ "op": "create" })).allows(true, &Touch::Create));
        assert!(!op(json!({ "op": "create" })).allows(true, &Touch::Propose));
        // tags: those it lists, or any
        let urgent = op(json!({ "op": "tag", "tags": ["urgent"] }));
        assert!(urgent.allows(true, &touch(json!({ "tag": "urgent" }))));
        assert!(!urgent.allows(true, &touch(json!({ "tag": "work" }))));
        assert!(op(json!({ "op": "tag" })).allows(false, &touch(json!({ "tag": "work" }))));
        // read, relay, backup and share allow no touch
        for name in ["read", "relay", "backup", "share"] {
            assert!(!op(json!({ "op": name })).allows(true, &Touch::Create), "{name}");
        }
        // every touch, by one op or another
        let ops = [status, op(json!({ "op": "insert", "path": ["items"] }))];
        let ts = [touch(json!({ "set": ["status"], "to": "open" })), touch(json!({ "insert": "items" }))];
        assert!(allows_all(&ops, true, &ts));
        assert!(allows_all(&ops, true, &[]));
        assert!(!allows_all(&ops, true, &[touch(json!({ "remove": "items" }))]));
    }

    #[test]
    fn an_op_reaches_rows_and_lists_at_any_depth() {
        let steps = json!(["items", { "id": 1 }, "steps"]);
        let deep = |name: &str| touch(json!({ name: steps.clone() }));
        // a list in a row: the rows of the list, at or under the op's path
        for pattern in [json!(["items"]), json!(["items", "*"]), json!(["items", { "id": 1 }, "steps"])] {
            let insert = op(json!({ "op": "insert", "path": pattern }));
            assert!(insert.allows(true, &deep("insert")), "{pattern}");
            assert!(!insert.allows(true, &deep("remove")), "{pattern}");
        }
        assert!(op(json!({ "op": "insert", "path": ["items", "*", "steps"] })).allows(true, &deep("insert")));
        assert!(!op(json!({ "op": "insert", "path": ["items", { "id": 2 }] })).allows(true, &deep("insert")));
        assert!(!op(json!({ "op": "insert", "path": ["items", "*", "notes"] })).allows(true, &deep("insert")));
        // the list in a row is no list of the record
        assert!(!op(json!({ "op": "insert", "path": ["steps"] })).allows(true, &deep("insert")));
        let move_any = op(json!({ "op": "move", "path": ["items", "*", "steps", "*", "notes"] }));
        let notes = json!({ "move": ["items", { "id": 1 }, "steps", { "id": 4 }, "notes"] });
        assert!(move_any.allows(false, &touch(notes)));
        assert!(!move_any.allows(false, &deep("move")));
        // a set without values names rows too, and so does one on a row above them
        let row = op(json!({ "op": "set", "path": ["items", { "id": 1 }] }));
        assert!(row.allows(true, &deep("remove")));
        let set = json!({ "set": ["items", { "id": 1 }, "steps", { "id": 2 }, "notes", { "id": 3 }, "text"] });
        assert!(row.allows(true, &touch(set)));
        assert_eq!(deep("move").loc(), Some(Loc::of_json(&steps).expect("a path")));
    }

    #[test]
    fn a_commitment_binds_the_ops_and_the_salt() {
        let ops = vec![op(json!({ "op": "set", "path": ["status"], "to": ["done"] }))];
        let a = Grant { ops: ops.clone(), salt: [1; 32] };
        assert_eq!(a.commitment(), a.clone().commitment());
        assert_ne!(a.commitment(), Grant { ops: ops.clone(), salt: [2; 32] }.commitment());
        assert_ne!(a.commitment(), Grant { ops: vec![], salt: [1; 32] }.commitment());
    }

    #[test]
    fn a_shares_level_is_the_class_of_its_strongest_op() {
        assert_eq!(level_of(&[]), Level::Relay);
        assert_eq!(level_of(&[Op::Backup]), Level::Backup);
        assert_eq!(level_of(&[Op::Read, Op::Propose]), Level::Write);
        assert_eq!(level_of(&[Op::Tag(None), Op::Share]), Level::Owner);
        for r in [Level::Relay, Level::Backup, Level::Read, Level::Write, Level::Owner] {
            assert_eq!(level_of(&r.ops()), r);
        }
    }

    #[test]
    fn ops_go_in_order_with_read_beside_every_write() {
        let set = op(json!({ "op": "set", "path": ["status"] }));
        let ops = normalize(vec![Op::Merge { on: None }, set.clone(), Op::Relay, set.clone()]).expect("ops");
        assert_eq!(ops, vec![Op::Read, set.clone(), Op::Merge { on: None }]);
        assert_eq!(normalize(vec![Op::Relay, Op::Backup]).expect("ops"), vec![Op::Backup]);
        assert_eq!(normalize(vec![Op::Read, Op::Relay]).expect("ops"), vec![Op::Read]);
        assert!(normalize(vec![]).is_err());
        let many = (0..=MAX_OPS as i64).map(|i| Op::Set { path: vec![Step::Row(i)], to: None, on: None });
        assert!(normalize(many.collect()).is_err());
        assert!(name_ok("Work todos").is_ok());
        assert!(name_ok(" ").is_err() && name_ok(&"x".repeat(MAX_NAME + 1)).is_err());
    }

    #[test]
    fn the_built_in_groups_are_their_levels_and_suggester() {
        let gs = groups();
        let names: Vec<&str> = gs.iter().map(|g| g.name).collect();
        assert_eq!(names, ["Owner", "Editor", "Suggester", "Viewer", "Public", "Backup", "Relay"]);
        let levels: Vec<Level> = gs.iter().map(|g| level_of(&g.ops)).collect();
        assert_eq!(
            levels,
            [Level::Owner, Level::Write, Level::Write, Level::Read, Level::Read, Level::Backup, Level::Relay]
        );
        for g in &gs {
            assert_eq!(normalize(g.ops.clone()).as_ref(), Ok(&g.ops), "{} is in order", g.name);
            assert!(!g.everyone || level_of(&g.ops) == Level::Read, "{} goes to everyone only to read", g.name);
        }
        let suggester = &gs[2].ops;
        let fix = touch(json!({ "set": ["title"], "to": "x" }));
        assert!(allows_all(suggester, false, &[Touch::Propose, fix.clone(), Touch::Merge]));
        assert!(!allows_all(suggester, true, &[fix]) && !allows_all(suggester, true, &[Touch::Merge]));
    }
}
