//! Addressable actors (`avendb/spec/AvenDB/Address.lean`, task A2 of the one query engine) and the writes of mutations
//! (`Mutation.lean`, task C2). An actor is one signed entry that holds everything about itself: its interface (in the
//! field `interface` of its record), its op templates, its version and the caps it needs. So any device that may read
//! the entry describes it and admits a call to it alone, offline too; discovery is a query over actor entries, never a
//! registry.
//!
//! - **Address**: a vault, an entry and an interface version.
//! - **Interface**: methods (name, params, the ops it may make, its footprint: the selector of the entries it may
//!   touch, and the op template it runs), events, needed caps, version, description.
//! - **Call**: `{to, method, args, caller, against}`; `admit` refuses one against another version, of no such method,
//!   with args that aren't its params, or whose footprint doesn't fit the caller's caps (Lean `admit_within_cap`).
//! - **Writes inside the footprint**: each write a mutation's template makes is to an entry its footprint picks, each
//!   touch allowed by its ops; a run with one write outside is refused whole (Lean `run_inside`, `outside_refused`).
//!   With the footprint inside the cap, every write is inside the cap (`write_within_cap`). The rules still judge each
//!   write as ever.

use serde_json::{json, Map, Value};

use crate::id::{EntryId, VaultId};
use crate::rules::{self, Cap, Op, Touch};
use crate::selector::{Attrs, Selector};

/// An actor's address: its vault, its entry, and the interface version a caller means.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Address {
    pub vault: VaultId,
    pub entry: EntryId,
    pub version: u64,
}

impl Address {
    /// `{"vault": hex, "entry": hex, "version": n}`.
    pub fn of_json(v: &Value) -> Result<Address, String> {
        let o = v.as_object().ok_or("an address is {vault, entry, version}")?;
        if let Some(k) = o.keys().find(|k| !["vault", "entry", "version"].contains(&k.as_str())) {
            return Err(format!("an address takes no field {k:?}"));
        }
        let hex = |k: &str| o.get(k).and_then(Value::as_str).ok_or(format!("an address names its {k} in hex"));
        Ok(Address {
            vault: VaultId::from_hex(hex("vault")?).ok_or("a vault is 64 hex digits")?,
            entry: EntryId::from_hex(hex("entry")?).ok_or("an entry is 64 hex digits")?,
            version: o.get("version").and_then(Value::as_u64).ok_or("an address names its interface version")?,
        })
    }

    pub fn to_json(&self) -> Value {
        json!({ "vault": self.vault.to_hex(), "entry": self.entry.to_hex(), "version": self.version })
    }
}

/// One method: its name, the names of its params, the ops it may make, its footprint, and the op template it runs
/// (`{"$": "param"}` marks where an arg goes), none for a method that only names what it may do.
#[derive(Clone, Debug, PartialEq)]
pub struct Method {
    pub name: String,
    pub params: Vec<String>,
    pub ops: Vec<Op>,
    pub footprint: Selector,
    pub run: Option<Value>,
}

/// What an actor's entry says it is (Lean `Interface`).
#[derive(Clone, Debug, PartialEq)]
pub struct Interface {
    pub version: u64,
    pub methods: Vec<Method>,
    pub events: Vec<String>,
    pub needs: Vec<Cap>,
    pub description: String,
}

/// The most methods, params and ops an interface holds: so admitting a call stays small.
pub const MOST_METHODS: usize = 64;
pub const MOST_PARAMS: usize = 32;
pub const MOST_OPS: usize = 32;

fn names(v: Option<&Value>, what: &str) -> Result<Vec<String>, String> {
    let Some(v) = v else { return Ok(vec![]) };
    let xs = v.as_array().ok_or(format!("{what} is a list of names"))?;
    xs.iter().map(|x| x.as_str().map(str::to_owned).ok_or(format!("{what} is a list of names"))).collect()
}

impl Method {
    /// `{"name", "params"?, "ops", "where"?, "run"?}`: `where` the footprint, left out for the whole vault.
    pub fn of_json(v: &Value) -> Result<Method, String> {
        let o = v.as_object().ok_or("a method is {name, params, ops, where, run}")?;
        if let Some(k) = o.keys().find(|k| !["name", "params", "ops", "where", "run"].contains(&k.as_str())) {
            return Err(format!("a method takes no field {k:?}"));
        }
        let name = o.get("name").and_then(Value::as_str).filter(|n| !n.is_empty() && n.len() <= 64);
        let params = names(o.get("params"), "params")?;
        let ops = rules::ops_of_json(o.get("ops").ok_or("a method names the ops it may make, [] for none")?)?;
        if params.len() > MOST_PARAMS || ops.len() > MOST_OPS {
            return Err("a method takes at most 32 params and 32 ops".into());
        }
        if (1..params.len()).any(|i| params[..i].contains(&params[i])) {
            return Err("a method names each param once".into());
        }
        Ok(Method {
            name: name.ok_or("a method has a name of 1 to 64 bytes")?.to_owned(),
            params,
            ops,
            footprint: o.get("where").map_or(Ok(Selector::All), Selector::of_json)?,
            run: o.get("run").cloned(),
        })
    }

    pub fn to_json(&self) -> Value {
        let mut o = json!({ "name": self.name, "params": self.params, "ops": rules::ops_to_json(&self.ops) });
        if self.footprint != Selector::All {
            o["where"] = self.footprint.to_json();
        }
        if let Some(run) = &self.run {
            o["run"] = run.clone();
        }
        o
    }

    /// Its footprint fits `caps` (Lean `Method.fitsCaps`): each op it may make is held by a cap whose slice the
    /// footprint lies within. `None` caps: the caller is the vault or one of its owners, and holds every op.
    pub fn fits_caps(&self, caps: Option<&[Cap]>) -> bool {
        let Some(caps) = caps else { return true };
        self.ops.iter().all(|o| caps.iter().any(|c| &c.op == o && self.footprint.fits(&c.slice)))
    }

    /// Whether a write lies inside its footprint (Lean `Mutation.inside`): the footprint picks the written entry, and
    /// its ops allow each touch.
    pub fn inside(&self, w: &Write) -> bool {
        self.footprint.matches(&w.attrs) && rules::allows_all(&self.ops, w.main, &w.touches)
    }

    /// A run of its writes (Lean `Mutation.run`): `Err` with the first write outside its footprint, which refuses all.
    pub fn run<'a>(&self, writes: &'a [Write]) -> Result<(), &'a Write> {
        match writes.iter().find(|w| !self.inside(w)) {
            Some(w) => Err(w),
            None => Ok(()),
        }
    }
}

impl Interface {
    /// `{"version", "methods", "events"?, "needs"?, "description"?}`, as an actor's record holds it in `interface`.
    pub fn of_json(v: &Value) -> Result<Interface, String> {
        let o = v.as_object().ok_or("an interface is {version, methods, events, needs, description}")?;
        let known = ["version", "methods", "events", "needs", "description"];
        if let Some(k) = o.keys().find(|k| !known.contains(&k.as_str())) {
            return Err(format!("an interface takes no field {k:?}"));
        }
        let methods = o.get("methods").and_then(Value::as_array).ok_or("an interface lists its methods")?;
        if methods.len() > MOST_METHODS {
            return Err("an interface holds at most 64 methods".into());
        }
        let methods = methods.iter().map(Method::of_json).collect::<Result<Vec<_>, _>>()?;
        if (1..methods.len()).any(|i| methods[..i].iter().any(|m| m.name == methods[i].name)) {
            return Err("an interface names each method once".into());
        }
        let needs = match o.get("needs") {
            None => vec![],
            Some(v) => v.as_array().ok_or("needs is a list of caps")?.iter().map(Cap::of_json).collect::<Result<_, _>>()?,
        };
        Ok(Interface {
            version: o.get("version").and_then(Value::as_u64).ok_or("an interface has a version, a number")?,
            methods,
            events: names(o.get("events"), "events")?,
            needs,
            description: o.get("description").map_or(Some(""), Value::as_str).ok_or("a description is a text")?.to_owned(),
        })
    }

    pub fn to_json(&self) -> Value {
        json!({
            "version": self.version,
            "methods": self.methods.iter().map(Method::to_json).collect::<Vec<_>>(),
            "events": self.events,
            "needs": self.needs.iter().map(Cap::to_json).collect::<Vec<_>>(),
            "description": self.description,
        })
    }

    /// The interface an actor's record holds in `interface`, if it holds one.
    pub fn of_record(record: &Value) -> Option<Result<Interface, String>> {
        record.get("interface").filter(|v| !v.is_null()).map(Interface::of_json)
    }

    /// Admits call `c` from a caller holding `caps` over the actor's vault (`None`: every op, the vault or an owner),
    /// as `Address.lean`'s `admit`: the method it runs, or why not.
    pub fn admit(&self, caps: Option<&[Cap]>, c: &Call) -> Result<&Method, Verdict> {
        if c.against != self.version || c.to.version != self.version {
            return Err(Verdict::WrongVersion);
        }
        let m = self.methods.iter().find(|m| m.name == c.method).ok_or(Verdict::NoMethod)?;
        let once = (1..c.args.len()).all(|i| !c.args[..i].contains(&c.args[i]));
        if !(once && c.args.iter().all(|a| m.params.contains(a)) && m.params.iter().all(|p| c.args.contains(p))) {
            return Err(Verdict::BadArgs);
        }
        if !m.fits_caps(caps) {
            return Err(Verdict::OutsideCap);
        }
        Ok(m)
    }
}

/// A call: the actor, the method, the names of the args it passes, the vault that calls, and the interface version
/// the caller was written against.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Call {
    pub to: Address,
    pub method: String,
    pub args: Vec<String>,
    pub caller: VaultId,
    pub against: u64,
}

/// Why a call is refused (Lean `Verdict`, but for `ok`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verdict {
    WrongVersion,
    NoMethod,
    BadArgs,
    OutsideCap,
    /// A write the method's template makes lies outside its footprint (Lean `Mutation.outside_refused`).
    OutsideFootprint,
}

impl Verdict {
    pub fn name(self) -> &'static str {
        match self {
            Verdict::WrongVersion => "wrongVersion",
            Verdict::NoMethod => "noMethod",
            Verdict::BadArgs => "badArgs",
            Verdict::OutsideCap => "outsideCap",
            Verdict::OutsideFootprint => "outsideFootprint",
        }
    }

    pub fn why(self) -> &'static str {
        match self {
            Verdict::WrongVersion => "the call was written against another version of the actor's interface",
            Verdict::NoMethod => "the actor has no such method, or the device holds no actor at that address",
            Verdict::BadArgs => "the call's args are not the method's params, each once",
            Verdict::OutsideCap => "the method's footprint lies outside every cap the caller holds over the actor's vault",
            Verdict::OutsideFootprint => "a write the method's template makes lies outside its footprint: it writes nothing",
        }
    }
}

/// One write a method's template made (Lean `Mutation.Write`): the written entry's labels, its touches, and whether on
/// the main line.
#[derive(Clone, Debug, PartialEq)]
pub struct Write {
    pub attrs: Attrs,
    pub touches: Vec<Touch>,
    pub main: bool,
}

/// The template `run` with each `{"$": param}` replaced by that arg: `Err` naming a param the args lack.
pub fn bind(run: &Value, args: &Map<String, Value>) -> Result<Value, String> {
    Ok(match run {
        Value::Object(o) if o.len() == 1 && o.contains_key("$") => {
            let p = o["$"].as_str().ok_or("a slot is {\"$\": param}")?;
            args.get(p).cloned().ok_or(format!("no arg for param {p:?}"))?
        }
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| Ok((k.clone(), bind(v, args)?))).collect::<Result<_, String>>()?)
        }
        Value::Array(xs) => Value::Array(xs.iter().map(|v| bind(v, args)).collect::<Result<_, _>>()?),
        v => v.clone(),
    })
}

/// What a change op of a template writes, before it is run: the entry it writes (`Ok(entry)`, or the vault, type and
/// tags of one it creates) and its touches, on the main line or not. A template writes by `create`, `set`, `unset`,
/// `insert`, `remove`, `move`, `tag`, or a `batch` of them; anything else isn't a mutation's.
pub enum Target {
    Entry(EntryId),
    New { vault: VaultId, ty: String, tags: Vec<String> },
}

pub fn touches_of(op: &Value) -> Result<Vec<(Target, Vec<Touch>, bool)>, String> {
    let o = op.as_object().ok_or("a template is an op")?;
    let name = o.get("op").and_then(Value::as_str).ok_or("a template names its op")?;
    let entry = || -> Result<EntryId, String> {
        o.get("entry").and_then(Value::as_str).and_then(EntryId::from_hex).ok_or("the op names its entry in hex".into())
    };
    let main = o.get("line").is_none_or(|l| l.is_null() || l == "main");
    let path = || crate::ops::Loc::of_json(o.get("path").unwrap_or(&json!([])));
    let tags = |k: &str| names(o.get(k), k);
    Ok(match name {
        "batch" => {
            let ops = o.get("ops").and_then(Value::as_array).ok_or("a batch lists its ops")?;
            let mut out = vec![];
            for op in ops {
                out.extend(touches_of(op)?);
            }
            out
        }
        "create" => {
            let vault = o.get("vault").and_then(Value::as_str).and_then(VaultId::from_hex).ok_or("create names its vault")?;
            let ty = o.get("type").and_then(Value::as_str).ok_or("create names its type")?.to_owned();
            let tags = tags("tags")?;
            let draft = o.get("draft").is_some_and(|d| d == true);
            let mut touches = vec![Touch::Create];
            touches.extend(tags.iter().map(|t| Touch::Tag(t.as_str().into())));
            vec![(Target::New { vault, ty, tags }, touches, !draft)]
        }
        "set" | "unset" => {
            let to = o.get("value").and_then(rules::Scalar::of_json);
            vec![(Target::Entry(entry()?), vec![Touch::Set(path()?, if name == "set" { to } else { None })], main)]
        }
        "insert" | "remove" | "move" => {
            // a row of a list: the list is the path up to the row
            let at = path()?;
            let list = if at.is_list() { at } else { crate::ops::Loc(at.0[..at.0.len().saturating_sub(1)].to_vec()) };
            let t = match name {
                "insert" => Touch::Insert(list),
                "remove" => Touch::Remove(list),
                _ => Touch::Move(list),
            };
            vec![(Target::Entry(entry()?), vec![t], main)]
        }
        "tag" => {
            let ts = [tags("add")?, tags("remove")?].concat();
            vec![(Target::Entry(entry()?), ts.iter().map(|t| Touch::Tag(t.as_str().into())).collect(), true)]
        }
        other => return Err(format!("a mutation's template makes no {other}")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::{On, Step};
    use crate::slice::Sym;

    fn rooms() -> Selector {
        Selector::of_json(&json!({ "type": ["room"] })).unwrap()
    }

    fn send() -> Method {
        Method {
            name: "send".into(),
            params: vec!["room".into(), "text".into()],
            ops: vec![Op::Insert { path: vec![Step::Field("messages".into())], on: Some(On::Main) }],
            footprint: rooms(),
            run: None,
        }
    }

    fn chat() -> Interface {
        Interface { version: 1, methods: vec![send()], events: vec![], needs: vec![], description: "Chat".into() }
    }

    fn call(method: &str, args: &[&str], version: u64, against: u64) -> Call {
        let to = Address { vault: VaultId::from_u64(1), entry: EntryId::from_u64(42), version };
        Call { to, method: method.into(), args: args.iter().map(|&a| a.into()).collect(), caller: VaultId::from_u64(9), against }
    }

    /// The `#guard`s of `Address.lean`, case for case.
    #[test]
    fn admit_says_what_the_model_says() {
        let insert = Op::Insert { path: vec![Step::Field("messages".into())], on: Some(On::Main) };
        let cap = |op: &Op, slice: Selector| Cap { op: op.clone(), slice };
        let (i, ok) = (chat(), call("send", &["room", "text"], 1, 1));
        assert_eq!(i.admit(Some(&[cap(&insert, rooms())]), &ok).map(|m| m.name.as_str()), Ok("send"));
        assert!(i.admit(Some(&[cap(&insert, Selector::All)]), &call("send", &["text", "room"], 1, 1)).is_ok());
        assert_eq!(i.admit(Some(&[cap(&Op::Read, Selector::All)]), &ok).err(), Some(Verdict::OutsideCap));
        let todos = Selector::of_json(&json!({ "type": ["todo"] })).unwrap();
        assert_eq!(i.admit(Some(&[cap(&insert, todos)]), &ok).err(), Some(Verdict::OutsideCap));
        assert_eq!(i.admit(Some(&[]), &ok).err(), Some(Verdict::OutsideCap), "addressable is not reachable");
        assert!(i.admit(None, &ok).is_ok(), "the vault itself holds every op");
        let read = Some(&[cap(&Op::Read, Selector::All)][..]);
        assert_eq!(i.admit(read, &call("send", &["room", "text"], 1, 2)).err(), Some(Verdict::WrongVersion));
        assert_eq!(i.admit(read, &call("send", &["room", "text"], 2, 1)).err(), Some(Verdict::WrongVersion));
        assert_eq!(i.admit(read, &call("delete", &[], 1, 1)).err(), Some(Verdict::NoMethod));
        assert_eq!(i.admit(read, &call("send", &["room"], 1, 1)).err(), Some(Verdict::BadArgs));
        assert_eq!(i.admit(read, &call("send", &["room", "text", "x"], 1, 1)).err(), Some(Verdict::BadArgs));
        assert_eq!(i.admit(read, &call("send", &["room", "room", "text"], 1, 1)).err(), Some(Verdict::BadArgs));
    }

    /// The `#guard`s of `Mutation.lean`: a write outside the footprint refuses the whole run.
    #[test]
    fn a_write_outside_the_footprint_is_refused() {
        let attrs = |ty: &str, n: u64| Attrs { ty: Sym::new(ty), author: VaultId::from_u64(1), entry: EntryId::from_u64(n), created: 0, tags: vec![] };
        let messages = crate::ops::Loc::field("messages");
        let post = Write { attrs: attrs("room", 50), touches: vec![Touch::Insert(messages.clone())], main: true };
        let m = send();
        assert!(m.run(&[post.clone(), post.clone()]).is_ok());
        let to_todo = Write { attrs: attrs("todo", 51), ..post.clone() };
        assert_eq!(m.run(&[post.clone(), to_todo.clone()]), Err(&to_todo));
        let rename = Write { touches: vec![Touch::Set(crate::ops::Loc::field("name"), None)], ..post.clone() };
        assert_eq!(m.run(&[post.clone(), rename.clone()]), Err(&rename));
        let draft = Write { main: false, ..post.clone() };
        assert_eq!(m.run(&[draft.clone()]), Err(&draft));
    }

    #[test]
    fn an_interface_reads_back_its_json_and_a_template_binds_its_args() {
        let mut m = send();
        m.run = Some(json!({ "op": "insert", "entry": { "$": "room" }, "path": ["messages", { "id": 1 }],
            "value": { "id": 1, "text": { "$": "text" } } }));
        let i = Interface { methods: vec![m], events: vec!["sent".into()], ..chat() };
        assert_eq!(Interface::of_json(&i.to_json()), Ok(i.clone()));
        let room = EntryId::from_u64(50).to_hex();
        let args = json!({ "room": room, "text": "hi" });
        let bound = bind(i.methods[0].run.as_ref().unwrap(), args.as_object().unwrap()).unwrap();
        assert_eq!(bound["entry"], json!(room));
        assert_eq!(bound["value"]["text"], json!("hi"));
        let writes = touches_of(&bound).unwrap();
        assert!(matches!(&writes[..], [(Target::Entry(e), ts, true)] if e.to_hex() == room && ts == &vec![Touch::Insert(crate::ops::Loc::field("messages"))]));
        assert!(bind(&json!({ "$": "nope" }), args.as_object().unwrap()).is_err());
        assert!(Interface::of_json(&json!({ "version": 1, "methods": [{ "name": "a", "ops": [] }, { "name": "a", "ops": [] }] })).is_err());
        assert!(touches_of(&json!({ "op": "share" })).is_err(), "a mutation makes writes alone");
    }
}
