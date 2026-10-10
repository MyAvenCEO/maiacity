//! Rules: caps that name ops, as in `avendb/spec/AvenDB/Rules.lean` (`avendb/docs/OPS.md`, caps that name ops). A
//! write cap's slice may carry rules: which ops its grantee's writes may make, as op patterns. Every reader of an
//! entry judges each write by its touches, what its Loro ops did, place by place, read off the write imported on the
//! version it builds on (`doc::Item::footprint`, `history::History::touches`): a value set at a place, rows of a list
//! added, deleted or moved, the entry created, a proposal started, another line merged in. Rules allow a write when
//! each touch is allowed by one of them.
//!
//! The rules travel sealed in the cap's slice, beside its selector, with a salt (`Opening`); the cap's `select` carries
//! their hash in the clear (`Opening::commitment`, `slice::Select`), the one bit a relay learns: that the cap is ruled,
//! never how. A write that relies on a ruled chain carries, inside its encrypted body, a proof (`Proof`): the cap it
//! relies on and the opening of every ruled cap of that cap's chain, which its readers check against the commitments
//! (`policy::State::counts`).
//!
//! A rule in JSON, as the docs write it:
//!
//! ```text
//! {"op": "set", "path": Pattern, "to": [v]?, "on": On?}     any change at or under the path; to: only to these values
//! {"op": "insert" | "remove" | "move", "path": Pattern?, "on": On?}   rows of a list of records
//! {"op": "merge", "on": On?} | {"op": "propose"} | {"op": "create"}
//! Pattern = a path whose steps may be "*": any one field or any one row; [] is the whole record
//! On      = "main" | "proposals"                                     left out: either
//! ```

use serde_json::{json, Map, Value};

use crate::id::CapId;
use crate::ops::Loc;

/// The most rules a cap carries, steps a pattern has, and values a rule may set a place to: so judging a write stays
/// linear in it, and rules fit in a sealed slice. And the most ruled caps a proof opens: a write through a chain with
/// more is never counted.
pub const MAX_RULES: usize = 64;
pub const MAX_STEPS: usize = 8;
pub const MAX_VALUES: usize = 64;
pub const MAX_OPENINGS: usize = 16;

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
/// added, deleted or moved (what a write does inside a row it adds is part of adding it); the entry created; a
/// proposal started; another line merged in. An op a reader can't place touches the whole record (`Loc::Root`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Touch {
    Set(Loc, Option<Scalar>),
    Insert(String),
    Remove(String),
    Move(String),
    Create,
    Propose,
    Merge,
}

/// An op pattern: `Set` any change at or under `path` (only to the values `to`, if it lists them), `Insert`, `Remove`
/// or `Move` the rows of a list, `Merge` another line, each on the lines `on` names (either, if none); `Propose` and
/// `Create`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Rule {
    Set { path: Vec<Step>, to: Option<Vec<Scalar>>, on: Option<On> },
    Insert { path: Vec<Step>, on: Option<On> },
    Remove { path: Vec<Step>, on: Option<On> },
    Move { path: Vec<Step>, on: Option<On> },
    Merge { on: Option<On> },
    Propose,
    Create,
}

/// A ruled cap's rules and the salt that keeps them from being guessed: what its slice carries, sealed, and what a
/// proof opens to readers. Their hash is the cap's commitment, in the clear.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Opening {
    pub rules: Vec<Rule>,
    pub salt: [u8; 32],
}

/// What a write relying on a ruled chain carries inside its encrypted body: the cap it relies on, and the opening of
/// each cap of that cap's chain that carries rules, root first.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Proof {
    pub cap: CapId,
    pub openings: Vec<Opening>,
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

impl Opening {
    /// The commitment to the rules, as the cap's `select` carries it in the clear: the hash of the rules and the salt.
    pub fn commitment(&self) -> [u8; 32] {
        let mut bytes = vec![];
        crate::encode::Encode::encode(self, &mut bytes);
        crate::hash::hash("rules", &bytes)
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
    /// The rule allows touch `t` of a write on the main line (`main`) or on a proposal.
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
            Rule::Propose => return json!({ "op": "propose" }),
            Rule::Create => return json!({ "op": "create" }),
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
        let o = v.as_object().ok_or("a rule is an object")?;
        let name = o.get("op").and_then(Value::as_str).ok_or("a rule names the op it allows: \"op\"")?;
        let fields: &[&str] = match name {
            "set" => &["op", "path", "to", "on"],
            "insert" | "remove" | "move" => &["op", "path", "on"],
            "merge" => &["op", "on"],
            "propose" | "create" => &["op"],
            other => {
                return Err(format!("no rule allows {other:?}: set, insert, remove, move, merge, propose or create"));
            }
        };
        if let Some(k) = o.keys().find(|k| !fields.contains(&k.as_str())) {
            return Err(format!("a {name} rule takes no field {k:?}"));
        }
        let path = |required: bool| -> Result<Vec<Step>, String> {
            let Some(p) = o.get("path") else {
                return if required { Err(format!("a {name} rule names a path")) } else { Ok(vec![]) };
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
            "propose" => Rule::Propose,
            _ => Rule::Create,
        })
    }
}

/// Rules allow a write: each of its touches, of a write on the main line (`main`) or on a proposal, is allowed by
/// one of them.
pub fn allows_all(rules: &[Rule], main: bool, touches: &[Touch]) -> bool {
    touches.iter().all(|t| rules.iter().any(|r| r.allows(main, t)))
}

/// Rules from their JSON: a list of rules, at most `MAX_RULES`.
pub fn rules_of_json(v: &Value) -> Result<Vec<Rule>, String> {
    let rs = v.as_array().ok_or("rules are a list of rules")?;
    if rs.len() > MAX_RULES {
        return Err(format!("a cap carries at most {MAX_RULES} rules"));
    }
    rs.iter().map(Rule::of_json).collect()
}

pub fn rules_to_json(rules: &[Rule]) -> Value {
    rules.iter().map(Rule::to_json).collect()
}

impl Touch {
    /// `{"set": path, "to": v}` (no `to` where no one plain value was set), `{"insert": field}`, `{"remove": field}`,
    /// `{"move": field}`, `"create"`, `"propose"` or `"merge"`.
    pub fn to_json(&self) -> Value {
        match self {
            Touch::Set(l, None) => json!({ "set": l.to_json() }),
            Touch::Set(l, Some(v)) => json!({ "set": l.to_json(), "to": v.to_json() }),
            Touch::Insert(f) => json!({ "insert": f }),
            Touch::Remove(f) => json!({ "remove": f }),
            Touch::Move(f) => json!({ "move": f }),
            Touch::Create => "create".into(),
            Touch::Propose => "propose".into(),
            Touch::Merge => "merge".into(),
        }
    }

    /// The place it may change (`Rules.lean`'s `Touch.loc`): where it sets, the list whose rows it changes, the whole
    /// record for a creation; none for a proposal's start or a merge, which change nothing of their own.
    pub fn loc(&self) -> Option<Loc> {
        match self {
            Touch::Set(l, _) => Some(l.clone()),
            Touch::Insert(f) | Touch::Remove(f) | Touch::Move(f) => Some(Loc::Field(f.clone())),
            Touch::Create => Some(Loc::Root),
            Touch::Propose | Touch::Merge => None,
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
        // every touch, by one rule or another
        let rules = [status, rule(json!({ "op": "insert", "path": ["items"] }))];
        let ts = [touch(json!({ "set": ["status"], "to": "open" })), touch(json!({ "insert": "items" }))];
        assert!(allows_all(&rules, true, &ts));
        assert!(allows_all(&rules, true, &[]));
        assert!(!allows_all(&rules, true, &[touch(json!({ "remove": "items" }))]));
    }

    #[test]
    fn a_commitment_binds_the_rules_and_the_salt() {
        let rules = vec![rule(json!({ "op": "set", "path": ["status"], "to": ["done"] }))];
        let a = Opening { rules: rules.clone(), salt: [1; 32] };
        assert_eq!(a.commitment(), a.clone().commitment());
        assert_ne!(a.commitment(), Opening { rules: rules.clone(), salt: [2; 32] }.commitment());
        assert_ne!(a.commitment(), Opening { rules: vec![], salt: [1; 32] }.commitment());
    }
}
