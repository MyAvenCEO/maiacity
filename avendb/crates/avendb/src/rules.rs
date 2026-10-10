//! Caps are named groups of ops, as in `avendb/spec/AvenDB/Rules.lean` (`avendb/docs/OPS.md`, caps). A cap is a name
//! and the ops its grantee may make on the slice its selector picks: relay, backup and read (keep, pass on and open the
//! slice's edits), the write ops (create an entry, set a value, add, delete or move rows, ask for tags, start a
//! proposal, merge a line) and share (issue caps resting on it). Its role, which relays and every operational rule read
//! in the clear (`policy::Cap::role`), is the class of its strongest op (`level_of`). Every reader of an entry judges
//! each write by its touches, what its Loro ops did, place by place, read off the write imported on the version it
//! builds on (`doc::Item::footprint`, `history::History::reading`), and the tags it asks for: a value set at a place,
//! rows of a list added, deleted or moved, the entry created, a proposal started, another line merged in, a tag asked
//! for. A cap's ops allow a write when each touch is allowed by one of them.
//!
//! The ops travel sealed in the cap's slice, beside its selector, with a salt (`Grant`); the cap's `select` carries
//! their hash in the clear (`Grant::commitment`, `slice::Select`), which tells a relay nothing of them. A write through
//! a cap carries, inside its encrypted body, a proof (`Proof`): the cap it relies on and the grant of every cap of that
//! cap's chain, which its readers check against the commitments, and each cap's role against its ops
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

use crate::id::CapId;
use crate::ops::Loc;
use crate::policy::Role;
use crate::slice::{Sym, TagDelta};

/// The most ops a cap names, steps a pattern has, and values an op may set a place to or tags it may ask for: so
/// judging a write stays linear in it, and ops fit in a sealed slice. The most caps a proof opens: a write through a
/// longer chain is never counted. And the longest name a cap has, in characters.
pub const MAX_RULES: usize = 64;
pub const MAX_STEPS: usize = 8;
pub const MAX_VALUES: usize = 64;
pub const MAX_GRANTS: usize = 16;
pub const MAX_NAME: usize = 64;

/// A step of a rule's path: a field, a row of a list of records by its id, or any one step.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Step {
    Field(String),
    Row(i64),
    Any,
}

/// The lines a rule holds on.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum On {
    Main,
    Proposals,
}

/// A value a rule may set a place to, and the value a touch names where one op set one: `null`, a boolean, an integer
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
/// added, deleted or moved (what a write does inside a row it adds is part of adding it); the entry created; a tag
/// asked for, added or removed; a proposal started; another line merged in. An op a reader can't place touches the
/// whole record (`Loc::Root`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Touch {
    Set(Loc, Option<Scalar>),
    Insert(String),
    Remove(String),
    Move(String),
    Create,
    Tag(Sym),
    Propose,
    Merge,
}

/// An op a cap names, in the order caps list them (`normalize`): `Relay`, `Backup` and `Read` its slice's edits;
/// `Create` entries; `Set` any change at or under `path` (only to the values `to`, if it lists them), `Insert`,
/// `Remove` or `Move` the rows of a list, `Merge` another line, each on the lines `on` names (either, if none); ask for
/// the tags `Tag` lists (any, if none); `Propose`; and `Share`, issue caps resting on it, and on the whole vault
/// publish into its schema lane.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Rule {
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

/// A cap's ops and the salt that keeps them from being guessed: what its slice carries, sealed, and what a proof opens
/// to readers. Their hash is the cap's commitment, in the clear.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Grant {
    pub ops: Vec<Rule>,
    pub salt: [u8; 32],
}

/// What a write through a cap carries inside its encrypted body: the cap it relies on, and the grant of each cap of
/// that cap's chain, root first.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Proof {
    pub cap: CapId,
    pub grants: Vec<Grant>,
}

/// A built-in group: a name, what it lets its holders do in a few words, the ops its caps name, and whether it goes to
/// everyone (Public). The page offers them when it shares; anyone may name their own.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Group {
    pub name: &'static str,
    pub hint: &'static str,
    pub ops: Vec<Rule>,
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
    /// The commitment to the ops, as the cap's `select` carries it in the clear: the hash of the ops and the salt.
    pub fn commitment(&self) -> [u8; 32] {
        let mut bytes = vec![];
        crate::encode::Encode::encode(self, &mut bytes);
        crate::hash::hash("grant", &bytes)
    }

    /// The role a cap with these ops has (`level_of`).
    pub fn level(&self) -> Role {
        level_of(&self.ops)
    }
}

/// A place's path: a field, a row, or a field of a row.
pub fn steps(l: &Loc) -> Vec<Step> {
    match l {
        Loc::Root => vec![],
        Loc::Field(f) => vec![Step::Field(f.clone())],
        Loc::Row(f, i) => vec![Step::Field(f.clone()), Step::Row(*i)],
        Loc::Cell(f, i, g) => vec![Step::Field(f.clone()), Step::Row(*i), Step::Field(g.clone())],
    }
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

/// A rule's lines hold a write on the main line (`main`) or on a proposal.
fn on_line(main: bool, on: Option<On>) -> bool {
    match on {
        None => true,
        Some(On::Main) => main,
        Some(On::Proposals) => !main,
    }
}

impl Rule {
    /// Its class: relay, backup and read are their own, share is owner, and every op that writes is write.
    pub fn level(&self) -> Role {
        match self {
            Rule::Relay => Role::Relay,
            Rule::Backup => Role::Backup,
            Rule::Read => Role::Read,
            Rule::Share => Role::Owner,
            _ => Role::Write,
        }
    }

    /// Its place in the order caps list their ops.
    fn rank(&self) -> u8 {
        match self {
            Rule::Relay => 0,
            Rule::Backup => 1,
            Rule::Read => 2,
            Rule::Create => 3,
            Rule::Set { .. } => 4,
            Rule::Insert { .. } => 5,
            Rule::Remove { .. } => 6,
            Rule::Move { .. } => 7,
            Rule::Tag(_) => 8,
            Rule::Propose => 9,
            Rule::Merge { .. } => 10,
            Rule::Share => 11,
        }
    }

    /// The op allows touch `t` of a write on the main line (`main`) or on a proposal.
    pub fn allows(&self, main: bool, t: &Touch) -> bool {
        let list = |f: &String| [Step::Field(f.clone())];
        match (self, t) {
            (Rule::Set { path, to, on }, Touch::Set(l, v)) => {
                on_line(main, *on)
                    && reaches(path, &steps(l))
                    && match (to, v) {
                        (None, _) => true,
                        (Some(vs), Some(x)) => vs.contains(x),
                        (Some(_), None) => false,
                    }
            }
            (Rule::Set { path, to: None, on }, Touch::Insert(f) | Touch::Remove(f) | Touch::Move(f))
            | (Rule::Insert { path, on }, Touch::Insert(f))
            | (Rule::Remove { path, on }, Touch::Remove(f))
            | (Rule::Move { path, on }, Touch::Move(f)) => on_line(main, *on) && reaches(path, &list(f)),
            (Rule::Merge { on }, Touch::Merge) => on_line(main, *on),
            (Rule::Tag(tags), Touch::Tag(t)) => tags.as_ref().is_none_or(|ts| ts.contains(t)),
            (Rule::Propose, Touch::Propose) | (Rule::Create, Touch::Create) => true,
            _ => false,
        }
    }

    pub fn to_json(&self) -> Value {
        let path = |p: &[Step]| Value::Array(p.iter().map(Step::to_json).collect());
        let mut out = match self {
            Rule::Set { path: p, to, .. } => {
                let mut o = json!({ "op": "set", "path": path(p) });
                if let Some(vs) = to {
                    o["to"] = vs.iter().map(Scalar::to_json).collect();
                }
                o
            }
            Rule::Insert { path: p, .. } => json!({ "op": "insert", "path": path(p) }),
            Rule::Remove { path: p, .. } => json!({ "op": "remove", "path": path(p) }),
            Rule::Move { path: p, .. } => json!({ "op": "move", "path": path(p) }),
            Rule::Merge { .. } => json!({ "op": "merge" }),
            Rule::Tag(None) => return json!({ "op": "tag" }),
            Rule::Tag(Some(ts)) => {
                return json!({ "op": "tag", "tags": ts.iter().map(Sym::as_str).collect::<Vec<_>>() });
            }
            Rule::Relay => return json!({ "op": "relay" }),
            Rule::Backup => return json!({ "op": "backup" }),
            Rule::Read => return json!({ "op": "read" }),
            Rule::Create => return json!({ "op": "create" }),
            Rule::Propose => return json!({ "op": "propose" }),
            Rule::Share => return json!({ "op": "share" }),
        };
        if let Rule::Set { on: Some(on), .. }
        | Rule::Insert { on: Some(on), .. }
        | Rule::Remove { on: Some(on), .. }
        | Rule::Move { on: Some(on), .. }
        | Rule::Merge { on: Some(on) } = self
        {
            out["on"] = match on {
                On::Main => "main",
                On::Proposals => "proposals",
            }
            .into();
        }
        out
    }

    pub fn of_json(v: &Value) -> Result<Rule, String> {
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
                    "a cap names no op {other:?}: relay, backup, read, create, set, insert, remove, move, tag, \
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
                Rule::Set { path: path(true)?, to, on }
            }
            "insert" => Rule::Insert { path: path(false)?, on },
            "remove" => Rule::Remove { path: path(false)?, on },
            "move" => Rule::Move { path: path(false)?, on },
            "merge" => Rule::Merge { on },
            "tag" => {
                let names = |xs: &Vec<Value>| xs.iter().map(|x| x.as_str().map(Sym::new)).collect::<Option<Vec<_>>>();
                Rule::Tag(match o.get("tags") {
                    None | Some(Value::Null) => None,
                    Some(Value::Array(xs)) if xs.len() <= MAX_VALUES && names(xs).is_some() => names(xs),
                    Some(_) => return Err(format!("tags is a list of at most {MAX_VALUES} tags")),
                })
            }
            "relay" => Rule::Relay,
            "backup" => Rule::Backup,
            "read" => Rule::Read,
            "create" => Rule::Create,
            "propose" => Rule::Propose,
            _ => Rule::Share,
        })
    }
}

/// A cap's role: the class of its strongest op, relay for none (`Rules.lean`'s `levelOf`).
pub fn level_of(ops: &[Rule]) -> Role {
    ops.iter().map(Rule::level).max().unwrap_or(Role::Relay)
}

/// A cap's ops as it carries them: each once, in the order caps list them (an op's kind, then as given), read with
/// every op that writes or shares, as a writer reads what it builds on, and no relay or backup beside read or backup,
/// which they are part of. Refused: none, more than `MAX_RULES`, or ops of no role (none is).
pub fn normalize(ops: Vec<Rule>) -> Result<Vec<Rule>, String> {
    let mut out: Vec<Rule> = Vec::with_capacity(ops.len() + 1);
    for o in ops {
        if !out.contains(&o) {
            out.push(o);
        }
    }
    if out.is_empty() {
        return Err("a cap names at least one op".into());
    }
    let level = level_of(&out);
    if level.allows(Role::Write) && !out.contains(&Rule::Read) {
        out.push(Rule::Read);
    }
    out.retain(|o| match o {
        Rule::Relay => level == Role::Relay,
        Rule::Backup => level == Role::Backup,
        _ => true,
    });
    out.sort_by_key(Rule::rank);
    if out.len() > MAX_RULES {
        return Err(format!("a cap names at most {MAX_RULES} ops"));
    }
    Ok(out)
}

/// A cap's name: a few words, at most `MAX_NAME` characters, not blank.
pub fn name_ok(name: &str) -> Result<(), String> {
    if name.trim().is_empty() || name.chars().count() > MAX_NAME {
        return Err(format!("a cap has a name of 1 to {MAX_NAME} characters"));
    }
    Ok(())
}

/// The built-in groups, as `Rules.lean` has them (`groups`): a role's group for each role, Suggester (start
/// proposals and write on them) and Public (everyone reads).
pub fn groups() -> Vec<Group> {
    let suggester = vec![
        Rule::Read,
        Rule::Set { path: vec![], to: None, on: Some(On::Proposals) },
        Rule::Propose,
        Rule::Merge { on: Some(On::Proposals) },
    ];
    let g = |name, hint, ops, everyone| Group { name, hint, ops, everyone };
    let role = |r: Role, hint| g(r.group(), hint, r.ops(), false);
    vec![
        role(Role::Owner, "Reads, edits and shares it on"),
        role(Role::Write, "Reads and edits it"),
        g("Suggester", "Reads it and suggests changes to merge", suggester, false),
        role(Role::Read, "Reads it"),
        g("Public", "Everyone reads it", Role::Read.ops(), true),
        role(Role::Backup, "Keeps it encrypted, reads nothing"),
        role(Role::Relay, "Finds its devices, keeps nothing"),
    ]
}

impl Role {
    /// The name of its built-in group.
    pub fn group(self) -> &'static str {
        match self {
            Role::Owner => "Owner",
            Role::Write => "Editor",
            Role::Read => "Viewer",
            Role::Backup => "Backup",
            Role::Relay => "Relay",
        }
    }

    /// The ops of its built-in group: what a cap with this role and no narrower ops allows (`Rules.lean`'s
    /// `Role.ops`).
    pub fn ops(self) -> Vec<Rule> {
        let edit = || {
            vec![
                Rule::Read,
                Rule::Create,
                Rule::Set { path: vec![], to: None, on: None },
                Rule::Tag(None),
                Rule::Propose,
                Rule::Merge { on: None },
            ]
        };
        match self {
            Role::Relay => vec![Rule::Relay],
            Role::Backup => vec![Rule::Backup],
            Role::Read => vec![Rule::Read],
            Role::Write => edit(),
            Role::Owner => [edit(), vec![Rule::Share]].concat(),
        }
    }
}

impl Group {
    pub fn to_json(&self) -> Value {
        json!({ "name": self.name, "hint": self.hint, "ops": ops_to_json(&self.ops), "everyone": self.everyone })
    }
}

/// Ops allow a write: each of its touches, of a write on the main line (`main`) or on a proposal, is allowed by one of
/// them.
pub fn allows_all(ops: &[Rule], main: bool, touches: &[Touch]) -> bool {
    touches.iter().all(|t| ops.iter().any(|r| r.allows(main, t)))
}

/// A cap's ops from their JSON: a list of ops, at most `MAX_RULES`, as given (`normalize` puts them in order).
pub fn ops_of_json(v: &Value) -> Result<Vec<Rule>, String> {
    let rs = v.as_array().ok_or("ops are a list of ops")?;
    if rs.len() > MAX_RULES {
        return Err(format!("a cap names at most {MAX_RULES} ops"));
    }
    rs.iter().map(Rule::of_json).collect()
}

pub fn ops_to_json(ops: &[Rule]) -> Value {
    ops.iter().map(Rule::to_json).collect()
}

/// The tags a write asks for, added or removed, as touches (`Rules.lean`'s `TagDelta.touches`).
pub fn asked(d: &TagDelta) -> impl Iterator<Item = Touch> + '_ {
    d.add.iter().chain(&d.remove).cloned().map(Touch::Tag)
}

impl Touch {
    /// `{"set": path, "to": v}` (no `to` where no one plain value was set), `{"insert": field}`, `{"remove": field}`,
    /// `{"move": field}`, `"create"`, `{"tag": tag}`, `"propose"` or `"merge"`.
    pub fn to_json(&self) -> Value {
        match self {
            Touch::Set(l, None) => json!({ "set": l.to_json() }),
            Touch::Set(l, Some(v)) => json!({ "set": l.to_json(), "to": v.to_json() }),
            Touch::Insert(f) => json!({ "insert": f }),
            Touch::Remove(f) => json!({ "remove": f }),
            Touch::Move(f) => json!({ "move": f }),
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
            Touch::Insert(f) | Touch::Remove(f) | Touch::Move(f) => Some(Loc::Field(f.clone())),
            Touch::Create => Some(Loc::Root),
            Touch::Tag(_) | Touch::Propose | Touch::Merge => None,
        }
    }

    pub fn of_json(v: &Value) -> Result<Touch, String> {
        let field = |o: &Map<String, Value>, k: &str| o[k].as_str().map(str::to_string).ok_or("a list is a field");
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

    fn rule(v: Value) -> Rule {
        Rule::of_json(&v).expect("a rule")
    }

    fn touch(v: Value) -> Touch {
        Touch::of_json(&v).expect("a touch")
    }

    #[test]
    fn a_rule_reads_back_from_its_json() {
        let rules = [
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
        for v in rules {
            assert_eq!(rule(v.clone()).to_json(), v);
        }
        assert_eq!(rule(json!({ "op": "insert" })), Rule::Insert { path: vec![], on: None });
        let bad = [
            json!({ "op": "set" }),
            json!({ "op": "set", "path": ["status"], "to": [1.5] }),
            json!({ "op": "set", "path": ["status"], "to": [["x"]] }),
            json!({ "op": "set", "path": ["status"], "on": "drafts" }),
            json!({ "op": "propose", "path": [] }),
            json!({ "op": "delete", "path": [] }),
            json!({ "op": "set", "path": [1] }),
            json!({ "op": "set", "path": ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }),
            json!({ "op": "tag", "tags": "urgent" }),
            json!({ "op": "read", "path": [] }),
        ];
        for v in bad {
            assert!(Rule::of_json(&v).is_err(), "{v}");
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
            json!("create"),
            json!({ "tag": "urgent" }),
            json!("propose"),
            json!("merge"),
        ];
        for v in touches {
            assert_eq!(touch(v.clone()).to_json(), v);
        }
    }

    #[test]
    fn a_rule_allows_the_touches_its_op_path_values_and_line_name() {
        let status = rule(json!({ "op": "set", "path": ["status"], "to": ["open", "done"] }));
        assert!(status.allows(true, &touch(json!({ "set": ["status"], "to": "done" }))));
        assert!(!status.allows(true, &touch(json!({ "set": ["status"], "to": "lost" }))));
        assert!(!status.allows(true, &touch(json!({ "set": ["status"] }))));
        assert!(!status.allows(true, &touch(json!({ "set": ["title"], "to": "done" }))));
        // a set without values names rows too, at or under its path
        let items = rule(json!({ "op": "set", "path": ["items"] }));
        for t in [json!({ "insert": "items" }), json!({ "remove": "items" }), json!({ "move": "items" })] {
            assert!(items.allows(false, &touch(t)));
        }
        assert!(items.allows(true, &touch(json!({ "set": ["items", { "id": 4 }, "text"] }))));
        assert!(!items.allows(true, &touch(json!({ "set": [] }))));
        assert!(!items.allows(true, &touch(json!({ "insert": "blocks" }))));
        // any row's field
        let checked = rule(json!({ "op": "set", "path": ["blocks", "*", "checked"] }));
        assert!(checked.allows(true, &touch(json!({ "set": ["blocks", { "id": 7 }, "checked"], "to": true }))));
        assert!(!checked.allows(true, &touch(json!({ "set": ["blocks", { "id": 7 }, "text"] }))));
        assert!(!checked.allows(true, &touch(json!({ "remove": "blocks" }))));
        // the lines
        let suggest = rule(json!({ "op": "set", "path": [], "on": "proposals" }));
        assert!(suggest.allows(false, &touch(json!({ "set": ["title"], "to": "x" }))));
        assert!(!suggest.allows(true, &touch(json!({ "set": ["title"], "to": "x" }))));
        let merge = rule(json!({ "op": "merge", "on": "main" }));
        assert!(merge.allows(true, &Touch::Merge) && !merge.allows(false, &Touch::Merge));
        assert!(rule(json!({ "op": "create" })).allows(true, &Touch::Create));
        assert!(!rule(json!({ "op": "create" })).allows(true, &Touch::Propose));
        // tags: those it lists, or any
        let urgent = rule(json!({ "op": "tag", "tags": ["urgent"] }));
        assert!(urgent.allows(true, &touch(json!({ "tag": "urgent" }))));
        assert!(!urgent.allows(true, &touch(json!({ "tag": "work" }))));
        assert!(rule(json!({ "op": "tag" })).allows(false, &touch(json!({ "tag": "work" }))));
        // read, relay, backup and share allow no touch
        for op in ["read", "relay", "backup", "share"] {
            assert!(!rule(json!({ "op": op })).allows(true, &Touch::Create), "{op}");
        }
        // every touch, by one rule or another
        let rules = [status, rule(json!({ "op": "insert", "path": ["items"] }))];
        let ts = [touch(json!({ "set": ["status"], "to": "open" })), touch(json!({ "insert": "items" }))];
        assert!(allows_all(&rules, true, &ts));
        assert!(allows_all(&rules, true, &[]));
        assert!(!allows_all(&rules, true, &[touch(json!({ "remove": "items" }))]));
    }

    #[test]
    fn a_commitment_binds_the_ops_and_the_salt() {
        let ops = vec![rule(json!({ "op": "set", "path": ["status"], "to": ["done"] }))];
        let a = Grant { ops: ops.clone(), salt: [1; 32] };
        assert_eq!(a.commitment(), a.clone().commitment());
        assert_ne!(a.commitment(), Grant { ops: ops.clone(), salt: [2; 32] }.commitment());
        assert_ne!(a.commitment(), Grant { ops: vec![], salt: [1; 32] }.commitment());
    }

    #[test]
    fn a_caps_role_is_the_class_of_its_strongest_op() {
        assert_eq!(level_of(&[]), Role::Relay);
        assert_eq!(level_of(&[Rule::Backup]), Role::Backup);
        assert_eq!(level_of(&[Rule::Read, Rule::Propose]), Role::Write);
        assert_eq!(level_of(&[Rule::Tag(None), Rule::Share]), Role::Owner);
        for r in [Role::Relay, Role::Backup, Role::Read, Role::Write, Role::Owner] {
            assert_eq!(level_of(&r.ops()), r);
        }
    }

    #[test]
    fn ops_go_in_order_with_read_beside_every_write() {
        let set = rule(json!({ "op": "set", "path": ["status"] }));
        let ops = normalize(vec![Rule::Merge { on: None }, set.clone(), Rule::Relay, set.clone()]).expect("ops");
        assert_eq!(ops, vec![Rule::Read, set.clone(), Rule::Merge { on: None }]);
        assert_eq!(normalize(vec![Rule::Relay, Rule::Backup]).expect("ops"), vec![Rule::Backup]);
        assert_eq!(normalize(vec![Rule::Read, Rule::Relay]).expect("ops"), vec![Rule::Read]);
        assert!(normalize(vec![]).is_err());
        let many = (0..=MAX_RULES as i64).map(|i| Rule::Set { path: vec![Step::Row(i)], to: None, on: None });
        assert!(normalize(many.collect()).is_err());
        assert!(name_ok("Work todos").is_ok());
        assert!(name_ok(" ").is_err() && name_ok(&"x".repeat(MAX_NAME + 1)).is_err());
    }

    #[test]
    fn the_built_in_groups_are_their_roles_and_suggester() {
        let gs = groups();
        let names: Vec<&str> = gs.iter().map(|g| g.name).collect();
        assert_eq!(names, ["Owner", "Editor", "Suggester", "Viewer", "Public", "Backup", "Relay"]);
        let levels: Vec<Role> = gs.iter().map(|g| level_of(&g.ops)).collect();
        assert_eq!(levels, [Role::Owner, Role::Write, Role::Write, Role::Read, Role::Read, Role::Backup, Role::Relay]);
        for g in &gs {
            assert_eq!(normalize(g.ops.clone()).as_ref(), Ok(&g.ops), "{} is in order", g.name);
            assert!(!g.everyone || level_of(&g.ops) == Role::Read, "{} goes to everyone only to read", g.name);
        }
        let suggester = &gs[2].ops;
        let fix = touch(json!({ "set": ["title"], "to": "x" }));
        assert!(allows_all(suggester, false, &[Touch::Propose, fix.clone(), Touch::Merge]));
        assert!(!allows_all(suggester, true, &[fix]) && !allows_all(suggester, true, &[Touch::Merge]));
    }
}
