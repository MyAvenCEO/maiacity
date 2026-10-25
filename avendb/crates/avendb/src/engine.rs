//! The ops engine (`docs/ARCHITECTURE.md` §8): every read and every change of a device's entries as one JSON op,
//! whatever their schema, run on the device's Lab. `ops` is the part on records alone; this is the part on entries.
//!
//! - **Records through schemas.** An op sees an entry's record as an app on a schema sees it (`lens::View`): the schema
//!   it names (`"schema"`: `"document"` or `"todo"`, a built-in's name, or a schema's id in hex), or else the one the
//!   record's own `kind` names, read through the lens to the version that wrote it. The lane an op reads through is the
//!   app's own schemas and lenses and those the entry's vault holds as entries. `"stored"` names the record as the item
//!   stores it, which ops read and never change. A change runs on the app's view and goes back through the view
//!   (`View::put`), so the lens writes only what changed, in the representation the item already uses: a new schema
//!   needs no new code.
//! - **Reads** (`read`). `query`: the entries whose labels and records a `where` holds of, picked by the selector of
//!   its labels first (`ops::Where::plan`), so a device opens no more than the selector picks, each record read only so
//!   many rows down (`QUERY_DEPTH`, or the query's own, up to the device's most) before its lens translates it, then
//!   ordered and a page at a time, the links at the places it names followed a level at a time (`ops::follow`), each
//!   hop opening only what the device reads. `get`: one entry on a line, at a version, or at a release of its line
//!   (`version`). `pin`: what a pin of an entry at a version names, all from its history, for its label. `history`: an
//!   entry's lines, each with its version numbers, and every write of it, each with the changes it made to the entry's
//!   stored record (`ops::diff`), as every reader sees them alike. `schemas`: the schemas and lenses a vault's entries
//!   are read through. `groups`: the built-in groups of ops a share names (`rules::groups`), which the page offers when
//!   it shares; `cap_groups`: the cap groups a vault defines as entries of its own (`rules::CapGroup`). `aips` and
//!   `aip`: the AIPs the device holds, their stages, labels, reviews and what each line changes (`aips`). `kinds`: the
//!   kind table (`Kind::rules`, `words::kinds_json`), which the page reads, as in `world`, to say what each kind of
//!   vault may own and hold, and never decides itself. `limits`: how deep the device's queries read. `api_pass`: the
//!   device's signed pass to a service that holds no device (`sign::ApiPass`), which keeps nothing. And of the
//!   device's vaults (`vaults`, V2): `world`, `database`, `note`, `log`, `creatable`, `taggable`, `requests` (the
//!   access requests its person answers, and those its vaults made); `read_file`, whose bytes a node reads
//!   (avendb-net's `Node::run`).
//! - **Changes** (`run`). `create`, of a schema or lens entry too, which holds its JSON alone (`Lab::add_schema`), or
//!   with `draft`, a draft that starts its own line, which its vault lands by merging it (`Lab::create_draft`), as a
//!   Suggester proposes a new entry; the record ops (`ops::RecordOp`): `set`, `unset`, `insert`, `remove`, `move`;
//!   `tag`; `propose`; `variant`, a line that stays open beside main and follows it (`History::variant`); `merge`, and
//!   a merge into main brings main into every variant too (`follow`); `review` (the vault's answer to a proposal, its
//!   accept with it: `review`), `restore`, `undo`, `fork` (a copy of an entry as a new one); the AIP ops, `aip_open`,
//!   `aip_objective`, `aip_measure`, `aip_promote`, `aip_withdraw` and `aip_review`, the vault's answer over every line
//!   (`aips`), and `objective_check`, which reads an objective file and checks it against readings; and `batch`, whose
//!   record ops in a row on one entry's line make one write. Each acts for a vault (`"as"`, the device's own by
//!   default), as every edit does, and the rules judge it as they judge any peer's. A write through a share carries the
//!   proof that the ops of the shares of its chain allow what it touches and the tags it asks for, and is refused
//!   (`NotAllowed`) where they don't, as is a merge into main through a share on top of no accept of the vault's
//!   (`NotAccepted`, M2): its readers wouldn't count it (`rules`, `policy::passes`). And the changes of vaults
//!   (`vaults`), each run alone: `share`, `keep`, `revoke`, `settings`, `found`, `put_file`, `back_up`, `mark`, `card`,
//!   `profile`, `follow`, `set_limits`, `ask`, an access request: a record and a share; and `define_group`,
//!   `redefine_group` and `share_group`, a vault's cap groups and the shares that name them, to a vault, everyone or an
//!   invite whose link's secret the answer carries. One its vault's owners approve the device drafts for its person's
//!   passkey (`prepare`, `Prepared::Approve`): without a ceremony it answers `approve` and makes nothing; with one,
//!   `approve` keeps it.
//! - **Asking** (`may`, `shares`). Whether each of some change ops would be made, by a dry run of each that checks,
//!   proves and refuses as `run` does and makes nothing: what a page asks before it offers a button; `true`, or
//!   `{"approve": {signers}}` where the passkey would approve it. `shares` lists the shares over a vault, owners and
//!   devices among them, each with `may` of the revocation that ends it.
//!
//! Every op answers `{"ok": ...}` or `{"refused": name, "why": "..."}`: a rule of the edits or of a device
//! (`policy::Refusal`, by its name), `BadOp` where the JSON says nothing the engine does or an op makes no sense of the
//! record, `NoSchema` where no schema reads the record, `NoEntry` where the device shows no such entry or line: a
//! draft its vault hasn't landed has no main line yet, so every read and record op of its main line answers `NoEntry`
//! (`Lab::landed`).

mod aips;
mod vaults;

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};
use std::ops::Range;

use serde_json::{json, Map, Value};

use crate::data;
use crate::doc::{Item, Version};
use crate::history::{self, History, MAIN};
use crate::id::{BlobId, EditId, EntryId, SignerId, VaultId};
use crate::lab::Lab;
use crate::lens::{self, Lane, Lens, Schema, View};
use crate::merge::Place;
use crate::ops::{self, FieldOp, Path, Record, RecordOp, Where};
use crate::policy::{Kind, Line, Proposal, Refusal};
use crate::rules;
use crate::sign;
use crate::wire::Wire as _;
use crate::words;
use crate::sealed::{Brought, FileRoot};
use crate::slice::{Attrs, Selector, Sym, LENS_TYPE, SCHEMA_TYPE};
use crate::world::{self, FORK, SyncedTo, authors, authors_json, fork_mark};

pub use vaults::{approve, approved, follow_standing, passkey_of, world, world_snapshot, WorldSnapshot, Approval, Prepared, Then};

/// The most writes of one entry whose changes `history` shows, the latest: each version is made from scratch from the
/// updates it holds.
pub const SHOWN: usize = 200;

/// How many rows down a query reads each record unless it names its own depth (`query`), which the device's most
/// bounds (`Lab::query_depth`).
pub const QUERY_DEPTH: usize = 16;

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
    /// A removal while its device is behind its peers, in words: what it hasn't seen, and what to do (avendb-net's
    /// `Node::removal_waits`).
    Behind(String),
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
            Refused::Behind(why) => ("Behind".into(), why.clone()),
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
        Refusal::NoCap => "the vault it acts for holds no share that allows this",
        Refusal::NotAllowed => "the ops of the shares the vault acts through don't allow what it does",
        Refusal::NotAccepted => {
            "the entry's vault hasn't accepted what this merges into main: one of its owners accepts it first"
        }
        Refusal::NotLanded => "the entry is a draft its vault hasn't taken into main: only the vault lands a draft",
        Refusal::BadCap => "a share has a name, at least one op, and a selector and a chain within bounds",
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
        "entry_views" => &["vault", "entries", "types", "as", "kind"],
        "query" => &["vault", "where", "schema", "select", "order", "limit", "offset", "depth", "follow", "observeRevision"],
        "get" => &["entry", "schema", "line", "at", "version"],
        "pin" => &["entry", "at"],
        "checkpoint_view" | "checkpoint_entry_base" => &["entry"],
        "history" => &["entry", "limit"],
        "room" => &["entry", "last", "before"],
        "schemas" => &["vault"],
        "groups" | "kinds" | "limits" | "requests" | "perf" => &[],
        "api_pass" => &["audience"],
        "create" => &["vault", "type", "tags", "schema", "value", "draft", "file", "as"],
        "set" | "unset" | "insert" | "remove" | "move" => {
            &["entry", "line", "schema", "as", "path", "value", "at", "to"]
        }
        "tag" => &["entry", "add", "remove", "as"],
        "propose" | "variant" => &["entry", "from", "name", "as"],
        "merge" => &["entry", "from", "into", "take", "as"],
        "review" => &["entry", "line", "verdict", "text", "as"],
        "aip_open" => &["vault", "title", "note", "proposals", "tags", "objective", "as"],
        "aip_objective" => &["entry", "lean", "as"],
        "aip_measure" => &["entry", "name", "value", "note", "as"],
        "objective_check" => &["lean", "readings", "measured", "proposed", "current"],
        "aip_promote" => &["entry", "as"],
        "aip_withdraw" => &["entry", "why", "as"],
        "aip_review" => &["entry", "verdict", "text", "heads", "as"],
        "aips" => &["vault"],
        "aip" | "aip_records" => &["entry"],
        "restore" => &["entry", "line", "at", "as"],
        "undo" => &["entry", "line", "edit", "as"],
        "fork" => &["entry", "line", "into", "schema", "ops", "as"],
        "batch" | "may" => &["ops", "as"],
        "world" | "world_summary" | "log" | "jobs" | "synced" | "network" | "measure_peer_policy" | "measure_peer_visibility" => &[],
        "observe_query_emission" => &["rows"],
        "code" => &["vault", "type"],
        "posts" => &["limit", "after"],
        "bring" => &["vaults", "entries", "prioritize"],
        "demand" => &["scope", "revision", "entries", "queries"],
        "shares" => &["over", "as"],
        "database" => &["vault", "types"],
        "note" => &["entry"],
        "read_file" => &["root", "size", "from", "to", "local"],
        "creatable" => &["vault", "type", "tags", "draft", "as"],
        "taggable" => &["entry", "as"],
        "share" => &["over", "who", "level", "what", "standing", "request", "as"],
        "keep" => &["over", "mode", "what", "device", "as"],
        "copy" => &["device", "full"],
        "revoke" => &["share", "vault", "owner", "device", "standing", "as"],
        "settings" => &["vault", "threshold", "root"],
        "found" => &["vaults", "kind", "name"],
        "put_file" => &["vault", "entry", "line", "value", "schema", "name", "media", "tags", "len", "as"],
        "back_up" => &["on"],
        "mark" => &["entry"],
        "card" => &["name"],
        "profile" => &["vault", "name"],
        "follow" => &["vault", "on"],
        "set_limits" => &["depth"],
        "ask" => &["to", "asks", "level", "why", "vaults", "as"],
        "cap_groups" => &["vault"],
        "define_group" => &["vault", "group"],
        "redefine_group" => &["entry", "group"],
        "share_group" => &["over", "group", "who", "what", "as"],
        _ => return None,
    })
}

/// The ops that only read what the device holds, and `api_pass`, which signs a pass and keeps nothing.
const READS: [&str; 36] = [
    "entry_views",
    "query",
    "objective_check",
    "get",
    "pin",
    "history",
    "room",
    "schemas",
    "aips",
    "aip",
    "aip_records",
    "groups",
    "cap_groups",
    "kinds",
    "world",
    "world_summary",
    "jobs",
    "database",
    "note",
    "log",
    "read_file",
    "creatable",
    "taggable",
    "limits",
    "perf",
    "requests",
    "code",
    "posts",
    "bring",
    "demand",
    "synced",
    "network",
    "measure_peer_policy",
    "measure_peer_visibility",
    "observe_query_emission",
    "api_pass",
];

/// The ops that change nothing but ask what changes would do, by dry runs (`Lab::dry`): `may`, and `shares`, which
/// says whether each share may be revoked.
const ASKS: [&str; 2] = ["may", "shares"];

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

/// Op `v`'s name, if it is an op the engine runs and carries no field it doesn't take.
pub fn name(v: &Value) -> Option<&str> {
    op_of(v).ok().map(|(name, _)| name)
}

/// Whether op `v` only reads: a device runs it on what it holds and changes nothing.
pub fn reads(v: &Value) -> bool {
    name(v).is_some_and(|name| READS.contains(&name))
}

/// Whether op `v` takes something out of a vault: it ends a share, takes an owner or a device out, or sets a vault's
/// root, alone or in a batch. Such an edit cuts every edit resting on what it removes that its drafter doesn't hold
/// (T16), so a node makes it only once its device holds what its peers hold (avendb-net's `Node::removal_waits`); a
/// Lab alone knows no peers.
pub fn removes(v: &Value) -> bool {
    match op_of(v) {
        Ok(("revoke", _)) => true,
        Ok(("settings", o)) => o.contains_key("root"),
        Ok(("batch", o)) => o.get("ops").and_then(Value::as_array).is_some_and(|ops| ops.iter().any(removes)),
        _ => false,
    }
}

/// Whether op `v` changes nothing, though it runs on the Lab: `may` and `shares`, whose dry runs make nothing.
pub fn asks(v: &Value) -> bool {
    name(v).is_some_and(|name| ASKS.contains(&name))
}

/// Runs op `v` on device `me`: its answer, `{"ok": ...}`, a refusal, or for a change its vault's owners approve,
/// `{"approve": ...}` (`Approval::to_json`), which makes nothing: a Lab alone holds no ceremony, nor any file's bytes,
/// which a node brings (avendb-net's `Node::run`).
pub fn run(lab: &mut Lab, me: SignerId, v: &Value) -> Value {
    if asks(v) {
        return lab.dry(|lab| answer(ask(lab, me, v)));
    }
    if reads(v) {
        return read(lab, me, v);
    }
    prepared(prepare(lab, me, v))
}

/// The answer of a change prepared (`prepare`) and not approved: `{"ok": ...}`, `{"approve": ...}`, or a refusal.
pub fn prepared(out: Result<Prepared, Refused>) -> Value {
    match out {
        Ok(Prepared::Done(v)) => json!({ "ok": v }),
        Ok(Prepared::Approve(a)) => a.to_json(),
        Err(why) => why.to_json(),
    }
}

/// Runs read op `v` on device `me`: its answer, `{"ok": ...}` or a refusal. A change is refused, as it isn't run.
/// `world` names no device it is synced to, and `read_file` reads no bytes, and `jobs` are a node's: a node answers
/// those (avendb-net's `Node::run`).
pub fn read(lab: &Lab, me: SignerId, v: &Value) -> Value {
    if name(v) == Some("world_summary") {
        let summary = crate::world::summary(lab, me).map(|world| {
            let mut value = world.to_json(me);
            value["entriesComplete"] = Value::Bool(false);
            value
        });
        return json!({ "ok": summary });
    }
    if name(v) == Some("world") {
        return world(lab, me, &SyncedTo::default());
    }
    let out = op_of(v).and_then(|(name, o)| match name {
        "entry_views" => entry_views_inner(lab, me, o, &SyncedTo::default()),
        "query" => query(lab, me, o),
        "get" => get(lab, me, o),
        "pin" => pin(lab, me, o),
        "history" => history(lab, me, o),
        "room" => room(lab, me, o),
        "schemas" => schemas(lab, me, o),
        "aips" => aips::aips(lab, me, o),
        "aip" => aips::one(lab, me, o),
        "aip_records" => aips::records(lab, me, o),
        "objective_check" => aips::objective_check(o),
        "groups" => Ok(rules::groups().iter().map(rules::Group::to_json).collect()),
        "cap_groups" => vaults::cap_groups(lab, me, o),
        "kinds" => Ok(words::kinds_json()),
        "limits" => Ok(limits(lab.query_depth(me))),
        "perf" => Ok(lab.perf(me)),
        "api_pass" => api_pass(lab, me, o),
        "database" | "note" | "log" => vaults::data(lab, me, name, o),
        "creatable" => vaults::creatable(lab, me, o),
        "taggable" => vaults::taggable(lab, me, o),
        "requests" => Ok(vaults::requests(lab, me)),
        "code" => code(lab, me, o),
        "posts" => posts(lab, me, o),
        "read_file" => Err(bad("read_file reads a file's bytes from a node's store: a node runs it (Node::run)")),
        "jobs" => Err(bad("jobs tells what a node does in the background: a node runs it (Node::run)")),
        "demand" => Err(bad("demand changes a node's local scheduling priorities: a node runs it (Node::run)")),
        "bring" => Err(bad("bring asks a node's peers for vaults or entries: a node runs it (Node::run)")),
        "synced" => Err(bad("synced tells what a node's peers hold: a node runs it (Node::run)")),
        "measure_peer_policy" | "measure_peer_visibility" | "observe_query_emission" => Err(bad("peer policy measurements require a node (Node::run)")),
        "network" => Err(bad("network tells where a node syncs from and how: a node runs it (Node::run)")),
        _ if ASKS.contains(&name) => Err(bad(format!("{name} asks by dry runs: run it, don't read it"))),
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

/// Asking op `v` (`asks`) run on device `me`, dry.
fn ask(lab: &mut Lab, me: SignerId, v: &Value) -> Result<Value, Refused> {
    let (name, o) = op_of(v)?;
    match name {
        "shares" => vaults::shares(lab, me, o),
        _ => may(lab, me, v),
    }
}

/// Change op `v` on device `me`: made where the device may make it alone (`Prepared::Done`, its answer), drafted for
/// its person's passkey to approve where its vault's owners approve it (`Prepared::Approve`), or refused. A read, or
/// `may`, is refused: it isn't run.
pub fn prepare(lab: &mut Lab, me: SignerId, v: &Value) -> Result<Prepared, Refused> {
    let (name, o) = op_of(v)?;
    match name {
        "may" => Err(bad("may asks about change ops, not about may")),
        _ if READS.contains(&name) || ASKS.contains(&name) => {
            Err(bad(format!("{name} only reads: read it, don't run it")))
        }
        _ if vaults::CHANGES.contains(&name) => vaults::prepare(lab, me, name, o),
        _ => change(lab, me, v).map(Prepared::Done),
    }
}

/// The file read op `v`, a `read_file`, reads, and which of its bytes (`vaults::file_range`).
pub fn file_of(v: &Value) -> Result<(FileRoot, Range<u64>), Refused> {
    match op_of(v)? {
        ("read_file", o) => vaults::file_range(o),
        (name, _) => Err(bad(format!("{name} reads no file"))),
    }
}

/// Whether change op `v` brings a file's bytes beside it, which a node reads (avendb-net's `Node::run`): a `put_file`,
/// or a `create` with a `file`.
pub fn brings(v: &Value) -> bool {
    let o = v.as_object();
    match o.and_then(|o| o.get("op")).and_then(Value::as_str) {
        Some("put_file") => true,
        Some("create") => o.is_some_and(|o| o.contains_key("file")),
        _ => false,
    }
}

/// How many bytes change op `v`, a `put_file` or a `create` with a `file` (`brings`), brings beside it.
pub fn len_of(v: &Value) -> Result<u64, Refused> {
    match op_of(v)? {
        ("put_file", o) => vaults::file_len(o),
        ("create", o) => vaults::create_file(o)?.ok_or_else(|| bad("this create brings no file: it names none")),
        (name, _) => Err(bad(format!("{name} brings no file"))),
    }
}

/// Change op `v`, a `put_file` or a `create` with a `file` (`brings`), run on device `me` with its bytes, `brought`
/// into its node's store (`vaults::put_file`, `create`): its answer.
pub fn put_file(lab: &mut Lab, me: SignerId, v: &Value, brought: Brought) -> Value {
    answer(op_of(v).and_then(|(name, o)| match name {
        "put_file" => vaults::put_file(lab, me, o, Some(brought)),
        "create" if o.contains_key("file") => {
            let act = act_of(v)?;
            let Act { actor, step: Step::Create { vault, ty, tags, schema, value, draft, file: Some(file) } } = act
            else {
                return Err(bad("create brings a file into an entry it creates of a schema, not a schema or lens"));
            };
            if file.len != brought.len {
                return Err(bad(format!("the file is {} bytes, not the {} its len says", brought.len, file.len)));
            }
            let actor = actor.or_else(|| lab.vault_of(me)).ok_or(Refusal::NotActing)?;
            let file = Some(Bringing { len: file.len, brought: Some(brought) });
            step(lab, me, actor, Step::Create { vault, ty, tags, schema, value, draft, file })
        }
        _ => Err(bad(format!("{name} brings no file"))),
    }))
}

/// `{"op": "code", "vault", "type"?}`: the public code of vault `vault` that device `me` holds, of the kinds `type`
/// names (`world::CODE_KINDS`, every one of them for none), as avenDB's server's feed serves it (`/feed/code`,
/// `world::public_entries_of`): each entry everyone may read that its vault landed, its record as its main line holds it
/// and the files it brings. So a page that holds a device reads the code it runs off its own copy of the vault, which it
/// checked edit by edit as it took it, in the shape it reads the feed's, with no proof (H2 is the feed's).
fn code(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let vault = vault_of(o, "vault")?;
    let kinds = texts_of(o, "type")?;
    if let Some(k) = kinds.iter().find(|k| !world::CODE_KINDS.contains(&k.as_str())) {
        let of = world::CODE_KINDS.join(", ");
        return Err(bad(format!("code reads code alone: {k:?} is none of its kinds ({of})")));
    }
    let kinds = if kinds.is_empty() { world::CODE_KINDS.to_vec() } else { strs(&kinds) };
    Ok(Value::Array(world::public_entries_of(lab, me, Some(vault), Some(&kinds))))
}

/// The most posts one `posts` op hands out.
const MOST_POSTS: usize = 200;

/// `{"op": "posts", "limit"?, "after"?}`: the posts device `me` opens that everyone may read, newest first, as avenDB's
/// server serves them (`world::public_posts`): `limit` of them (`MOST_POSTS` at most, and by default), the newest or
/// those after post `after` (an entry id; none where it lists it no more: `world::page_of_posts`), as a page that shows the newest first asks for the next ones as
/// its person scrolls. `{"posts": [...], "more"}`, `more` whether more come after the last.
fn posts(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let limit = count_of(o, "limit")?.unwrap_or(MOST_POSTS).clamp(1, MOST_POSTS);
    let after = match o.get("after") {
        None | Some(Value::Null) => None,
        Some(v) => Some(id_of(Some(v), "after", EntryId::from_hex)?.to_hex()),
    };
    Ok(world::page_of_posts(world::public_posts(lab, me), limit, after.as_deref()))
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

/// Answer `out` of a change that brought file `root`, where it brought one, with its root and sealed size, as
/// `put_file` answers: `{..., "root", "size"}`.
fn with_file(mut out: Value, root: Option<FileRoot>) -> Value {
    if let Some(root) = root {
        out["root"] = BlobId(root.hash).to_hex().into();
        out["size"] = root.size.into();
    }
    out
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

/// Op `name`'s text `field`, if it gives one.
fn optional_text(o: &Map<String, Value>, name: &str, field: &str) -> Result<Option<String>, Refused> {
    match o.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(t)) => Ok(Some(t.clone())),
        Some(_) => Err(bad(format!("{name} takes a text {field}"))),
    }
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
    let bad = || {
        let kinds = "document, todo, article, flow, function, recipe, view, logic, review, bundle, policy, aip, post, \
            card, profile, file, story, spark, request, artifact or artwork";
        bad(format!("schema is a built-in kind ({kinds}), \"stored\" or a schema's id, 64 hex digits"))
    };
    Ok(match o.get("schema") {
        None | Some(Value::Null) => Named::Own,
        Some(Value::String(s)) => match s.as_str() {
            "stored" => Named::Stored,
            "document" => Named::Id(lens::DOCUMENT_V1.id()),
            "todo" => Named::Id(lens::TODO_V1.id()),
            "article" => Named::Id(lens::ARTICLE_V2.id()),
            "flow" => Named::Id(lens::FLOW_V1.id()),
            "function" => Named::Id(lens::FUNCTION_V2.id()),
            "recipe" => Named::Id(lens::RECIPE_V1.id()),
            "view" => Named::Id(lens::VIEW_V2.id()),
            "logic" => Named::Id(lens::LOGIC_V1.id()),
            "review" => Named::Id(lens::REVIEW_V2.id()),
            "bundle" => Named::Id(lens::BUNDLE_V1.id()),
            "policy" => Named::Id(lens::POLICY_V1.id()),
            "aip" => Named::Id(lens::AIP_V2.id()),
            "post" => Named::Id(lens::POST_V2.id()),
            "card" => Named::Id(lens::CARD_V1.id()),
            "profile" => Named::Id(lens::PROFILE_V1.id()),
            "file" => Named::Id(lens::FILE_V1.id()),
            "story" => Named::Id(lens::STORY_V2.id()),
            "spark" => Named::Id(lens::SPARK_V2.id()),
            "request" => Named::Id(lens::REQUEST_V1.id()),
            "artifact" => Named::Id(lens::ARTIFACT_V1.id()),
            "artwork" => Named::Id(lens::ARTWORK_V1.id()),
            s => Named::Id(BlobId::from_hex(s).ok_or_else(bad)?),
        },
        Some(_) => return Err(bad()),
    })
}

/// The schemas and lenses device `me` reads vault `v`'s entries through: the app's own, then those of the vault's lane,
/// its schema and lens entries (`Lab::lane_of`).
fn lane(lab: &Lab, me: SignerId, v: VaultId) -> Lane {
    Lane::with_built_ins(lab.lane_of(me, v))
}

/// The schema a record's kind names: of those in the lane whose `kind` is that constant, the newest, the one no lens
/// leads on from, and of several such the first by id. What the feed reads the entries everyone may read through too
/// (`world::public_entries`).
pub(crate) fn own(lane: &Lane, stored: &Value) -> Option<Schema> {
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
    seen_of(lane, &item.record(), &item.authored(), schema)
}

/// What `item` stores, `stored`, as an op naming `schema` sees it through `lane`, the item's writes made under the
/// schemas `authored`.
fn seen_of(lane: &Lane, stored: &Value, authored: &BTreeSet<BlobId>, schema: &Named) -> Option<Seen> {
    let app = match schema {
        Named::Stored => None,
        Named::Own => own(lane, stored),
        Named::Id(id) => Some(lane.schema(*id)?.clone()),
    };
    let Some(app) = app else {
        return Some(Seen { record: stored.as_object().cloned().unwrap_or_default(), view: None, read_only: true });
    };
    let (view, read_only) = lane.view(&app, authored);
    let record = view.get(stored)?.as_object()?.clone();
    Some(Seen { record, view: Some(view), read_only })
}

/// Item `item` as `see` sees it, read only `depth` rows down: each list of rows deeper than that emptied as the item
/// stores it, before the lens translates anything, and taken out of what the schema reads (`ops::empty_below`), so
/// nothing a query doesn't read is translated. Whether it took any out (`ops::cut`). A lens's steps keep each list of
/// rows at its field and its rows in it, so the places of the emptied lists are theirs in what the schema reads; a
/// `convert` whose `when` tests a list of rows would see it empty there.
fn see_within(lane: &Lane, item: &Item, schema: &Named, depth: usize) -> Option<(Seen, bool)> {
    let mut stored = item.record();
    let below = stored.as_object_mut().map(|r| ops::empty_below(r, depth)).unwrap_or_default();
    let mut seen = seen_of(lane, &stored, &item.authored(), schema)?;
    ops::take_out(&mut seen.record, &below);
    Some((seen, !below.is_empty()))
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

/// Whether `a` is `b` with some of its records' fields left out, at any depth: a loop over the pairs left to compare,
/// never a recursion.
fn within(a: &Value, b: &Value) -> bool {
    let mut todo = vec![(a, b)];
    while let Some(pair) = todo.pop() {
        match pair {
            (Value::Object(x), Value::Object(y)) => {
                for (k, v) in x {
                    let Some(w) = y.get(k) else { return false };
                    todo.push((v, w));
                }
            }
            (Value::Array(xs), Value::Array(ys)) if xs.len() == ys.len() => todo.extend(xs.iter().zip(ys)),
            (a, b) if a != b => return false,
            _ => {}
        }
    }
    true
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

/// What a query follows (`"follow"`): places that hold links, each a field, or a path to one in rows at any depth, a
/// row by its key or any row (`"*"`), as a `where` tests them.
fn follows_of(o: &Map<String, Value>) -> Result<Vec<ops::Target>, Refused> {
    let Some(v) = o.get("follow") else { return Ok(vec![]) };
    let bad = || bad("follow is a list of places that hold links: a field, or a path, [\"blocks\", \"*\", \"ref\"]");
    let one = |x: &Value| match x {
        Value::String(f) => Ok(ops::Target { rows: vec![], field: f.clone() }),
        _ => ops::Target::of_json(x).map_err(|_| bad()),
    };
    v.as_array().ok_or_else(bad)?.iter().map(one).collect()
}

/// What device `me` opens of link `l` (`ops::Opens`): the record of its entry through the schema its kind names, in
/// its vault's lane, at its newest on the main line or at the version it is pinned at, read `rows` rows down below the
/// record or the row the link names; or why it opens none: it reads no such entry (`NoEntry`: none of its shares
/// reaches it, or no key it holds opens it), the entry is another vault's (`WrongVault`), it holds no such version
/// (`NoVersion`), no schema reads the record (`NoSchema`), or the record holds no such row (`NoRow`).
fn open_link(
    lab: &Lab,
    me: SignerId,
    lanes: &mut HashMap<VaultId, Lane>,
    l: &ops::Link,
    rows: usize,
) -> Result<Record, ops::Unopened> {
    let no = |name: &'static str, why: &str| ops::Unopened { name, why: why.to_string() };
    let newest = lab.item(me, l.entry).ok_or_else(|| {
        no("NoEntry", "the reader opens no such entry: none of its shares reaches it, or no key it holds opens it")
    })?;
    let vault = lab.vault_of_entry(me, l.entry).filter(|v| *v == l.vault);
    let vault = vault.ok_or_else(|| no("WrongVault", "the entry is another vault's than the link names"))?;
    let pinned;
    let item = match &l.at {
        None => newest,
        Some(at) => {
            let h = lab.history(me, l.entry).filter(|h| at.iter().all(|e| h.get(*e).is_some()));
            let h = h.ok_or_else(|| no("NoVersion", "the reader holds no such version of the entry"))?;
            pinned = h.item_at(at, me, MAIN);
            &pinned
        }
    };
    let lane = lanes.entry(vault).or_insert_with(|| lane(lab, me, vault));
    let (seen, _) = see_within(lane, item, &Named::Own, rows + l.row.len())
        .ok_or_else(|| no("NoSchema", "no schema in the vault's lane reads the record"))?;
    let mut at = seen.record;
    for (f, id) in &l.row {
        let row = at.get(f).and_then(ops::rows).and_then(|rs| rs.iter().find(|r| r["id"].as_i64() == Some(*id)));
        at = row.and_then(Value::as_object).cloned().ok_or_else(|| no("NoRow", "the record holds no such row"))?;
    }
    Ok(at)
}

/// Scoped canonical entry summaries, with current node holdings supplied by any
/// peer. The normal core read has no transport holdings, exactly like `world`.
pub fn entry_views(lab: &Lab, me: SignerId, op: &Value, synced: &SyncedTo) -> Value {
    match entry_views_snapshot(lab, me, op) {
        Ok(snapshot) => json!({ "ok": snapshot.map(|snapshot| snapshot.into_json(synced)) }),
        Err(why) => why.to_json(),
    }
}

/// Capture the authoritative collection under Lab; encode its owned rows outside.
pub fn entry_views_snapshot(lab: &Lab, me: SignerId, op: &Value) -> Result<Option<world::EntryViews>, Refused> {
    let (name, o) = op_of(op)?;
    if name != "entry_views" { return Err(bad("expected entry_views")); }
    entry_views_capture(lab, me, o)
}

fn entry_views_capture(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Option<world::EntryViews>, Refused> {
    if o.contains_key("vault") && o.contains_key("entries") {
        return Err(bad("entry_views cannot combine vault and entries"));
    }
    let vault = o.get("vault").map(|_| vault_of(o, "vault")).transpose()?;
    let ids = o.get("entries").map(|value| {
        let values = value.as_array().ok_or_else(|| bad("entries must be an array"))?;
        if values.len() > 512 { return Err(bad("at most 512 entries")); }
        let mut ids = values.iter().map(|value| id_of(Some(value), "entry", EntryId::from_hex)).collect::<Result<Vec<_>, _>>()?;
        ids.sort(); ids.dedup();
        Ok(ids)
    }).transpose()?;
    let actor = o.get("as").map(|_| vault_of(o, "as")).transpose()?.or(vault).or_else(|| lab.vault_of(me));
    let types = o.get("types").map(|_| texts_of(o, "types")).transpose()?;
    if vault.is_none() && ids.is_none() && types.as_ref().is_none_or(|types|
        types.is_empty() || types.len() > 8 || types.iter().any(|ty| ty.is_empty())) {
        return Err(bad("global entry_views requires 1 to 8 explicit nonempty types"));
    }
    let kind = o.get("kind").map(|value| value.as_str().ok_or_else(|| bad("kind must be text"))).transpose()?;
    if kind.is_some_and(|kind| !["note", "todo", "file", "schema", "lens", "record", "sealed"].contains(&kind)) {
        return Err(bad("unknown entry kind"));
    }
    let Some(actor) = actor else { return Ok(None); };
    Ok(world::entry_views(lab, me, vault, ids.as_deref(), actor, types.as_deref(), kind))
}

fn entry_views_inner(lab: &Lab, me: SignerId, o: &Map<String, Value>, synced: &SyncedTo) -> Result<Value, Refused> {
    Ok(entry_views_capture(lab, me, o)?.map(|snapshot| snapshot.into_json(synced)).unwrap_or(Value::Null))
}

/// `{"op": "query", "vault"?, "where"?, "schema"?, "select"?, "order"?, "limit"?, "offset"?, "depth"?, "follow"?}`:
/// the entries of vault `vault` (of every vault, left out) on their main lines whose labels and records `where` holds
/// of, each record through `schema`; an entry it doesn't read, or that isn't one of the schema named, isn't there.
/// Entries are picked by the selector of the where's labels before any is opened (`plan`). Each record is read `depth`
/// rows down (`QUERY_DEPTH`, left out), and no deeper than the device's most (`Lab::query_depth`): a list of rows
/// below that isn't read, nor translated (`see_within`), so the where doesn't see it, the order neither, and the row
/// shows `cut`. In the order the device took them, or by `order`; from the `offset`th, at most `limit`; each record
/// with only the fields `select` names, if it names any. Then the links at the places `follow` names are followed, a
/// level at a time (`ops::follow`): each link shows the record or row it leads to (`to`), with the links there at
/// those places followed in turn, or why it shows none (`empty` and `why`, `open_link`); every row and every hop is a
/// level of `depth`, so a cycle of links ends there (`Deep`). `count` is how many rows there are in all, and `depth`
/// how deep each was read.
fn query(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    query_candidates_from(lab, me, o, Lab::query_candidates)
}

// The test oracle supplies the former full collection; all downstream semantics stay shared.
fn query_candidates_from(
    lab: &Lab, me: SignerId, o: &Map<String, Value>,
    candidates: impl FnOnce(&Lab, SignerId, Option<VaultId>, &Selector) -> Vec<EntryId>,
) -> Result<Value, Refused> {
    let observe_revision = match o.get("observeRevision") {
        None => false,
        Some(Value::Bool(value)) => *value,
        _ => return Err(bad("observeRevision is a boolean")),
    };
    let w = o.get("where").map(Where::of_json).transpose().map_err(bad)?.unwrap_or(Where::Yes);
    let vault = o.get("vault").map(|_| vault_of(o, "vault")).transpose()?;
    let schema = named(o)?;
    let select = o.get("select").map(|_| texts_of(o, "select")).transpose()?;
    let order = order_of(o)?;
    let (limit, offset) = (count_of(o, "limit")?, count_of(o, "offset")?.unwrap_or(0));
    let depth = count_of(o, "depth")?.unwrap_or(QUERY_DEPTH).min(lab.query_depth(me));
    let follow = follows_of(o)?;
    let plan = w.plan();
    let mut lanes: HashMap<VaultId, Lane> = HashMap::new();
    let mut rows = vec![];
    let (mut unresolved_candidates, mut checkpoint_partial) = (0usize, false);
    for entry in candidates(lab, me, vault, &plan) {
        let Some(v) = lab.vault_of_entry(me, entry).filter(|v| vault.is_none_or(|x| x == *v)) else { continue };
        let Some(m) = lab.meaning(me, entry).filter(|m| plan.matches(&m.attrs)) else { continue };
        let checkpoint = lab.entry_projection(me, entry);
        checkpoint_partial |= checkpoint.is_some() || lab.active_owner_base(me, entry).is_some();
        let lane = lanes.entry(v).or_insert_with(|| lane(lab, me, v));
        let projected = checkpoint.as_ref().and_then(|p| p.record(MAIN));
        let visible = if let Some(mut stored) = projected {
            let below = stored.as_object_mut().map(|r| ops::empty_below(r, depth)).unwrap_or_default();
            seen_of(lane, &stored, &BTreeSet::new(), &schema).map(|mut seen| {
                seen.read_only = true;
                ops::take_out(&mut seen.record, &below);
                (seen, !below.is_empty())
            })
        } else {
            lab.item(me, entry).and_then(|item| see_within(lane, item, &schema, depth))
        };
        let Some((mut seen, cut)) = visible else {
            // Known readable metadata matched the label plan, but its record was
            // absent or could not be translated. This is not a confirmed empty set.
            unresolved_candidates += 1;
            continue;
        };
        seen.read_only |= lab.owner_base_durability_pending(me, entry) || lab.owner_base_pending(me, entry) > 0 || lab.owner_base_wait_reason(me, entry).is_some();
        if w.holds(&m.attrs, &seen.record) {
            let provenance = checkpoint.map(|p| json!({ "snapshot": p.snapshot().to_hex(),
                "basis": ids(p.basis()), "partial": true, "freshness": "owner-attested-basis" }))
                .or_else(|| owner_base_provenance(lab, me, entry));
            rows.push((entry, v, m.attrs, seen, cut, provenance));
        }
    }
    let label = |a: &Attrs, l: &str| -> Value {
        match l {
            "type" => a.ty.as_str().into(),
            "author" => a.author.to_hex().into(),
            "entry" => a.entry.to_hex().into(),
            _ => a.created.into(),
        }
    };
    rows.sort_by(|(_, _, a, x, _, _), (_, _, b, y, _, _)| {
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
    let mut shown = vec![];
    for (entry, v, attrs, seen, cut, checkpoint) in page {
        let picked = |f: &String| select.as_ref().is_none_or(|fs| fs.contains(f));
        let mut record = seen.record.iter().filter(|(f, _)| picked(f)).map(|(f, x)| (f.clone(), x.clone())).collect();
        if !follow.is_empty() {
            ops::follow(&mut record, depth, &follow, &mut |l, rows| open_link(lab, me, &mut lanes, l, rows));
        }
        let mut row = row(entry, v, &attrs, &seen, record);
        row["cut"] = cut.into();
        // Captured with the authorized row under the same Lab read. This is an
        // opaque correlation frontier, not proof of paint or inclusion of a
        // sender's edit. Truncated and checkpoint bases must not be treated as
        // a complete current main-line frontier.
        if observe_revision {
            let (kind, heads) = if let Some(p) = checkpoint.as_ref() {
                ("checkpoint-basis", p["basis"].as_array().cloned().unwrap_or_default())
            } else {
                ("main-heads", lab.history(me, entry).map(|h| ids(&h.heads(MAIN)).into_iter().map(Value::String).collect()).unwrap_or_default())
            };
            let complete = heads.len() <= 32;
            row["observedRevision"] = json!({ "kind": kind,
                "heads": heads.into_iter().take(32).collect::<Vec<_>>(),
                "frontierComplete": complete });
        }
        if let Some(checkpoint) = checkpoint { row["checkpoint"] = checkpoint; }
        shown.push(row);
    }
    Ok(json!({ "rows": shown, "count": count, "plan": plan.to_json(), "depth": depth,
        "readiness": { "discovery": "unverified", "authoritativeEmpty": false,
            "unresolvedCandidates": unresolved_candidates, "checkpointPartial": checkpoint_partial,
            "pendingJudgments": lab.judgment_pending(me) } }))
}

/// `{"op": "api_pass", "audience"}`: the device's pass to service `audience` (`sign::ApiPass`), made now by its clock,
/// `{"pass", "expires"}`: the pass's wire bytes in base64url, and when it stops counting, seconds since 1970. The
/// service hands it to avenDB's server, which says which vault the device is a device of and whether that vault is an
/// admin of the server's coop (`world::pass_standing`); maiaCITY's API asks so before it opens an admin's page. It
/// keeps nothing. Refused while the device is locked (`Locked`), or for no service's name.
fn api_pass(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let audience = o.get("audience").and_then(Value::as_str).unwrap_or_default();
    if audience.is_empty() || audience.len() > sign::MAX_AUDIENCE {
        return Err(bad(format!("api_pass names its service in 1 to {} bytes: \"audience\"", sign::MAX_AUDIENCE)));
    }
    let pass = lab.api_pass(me, audience).ok_or(Refusal::Locked)?;
    Ok(json!({ "pass": sign::base64url(&pass.to_wire()), "expires": pass.expires() }))
}

/// `{"op": "limits"}`, and what `set_limits` answers: the most rows and links down a query of the device reads
/// (`depth`, `Lab::query_depth`, which `set_limits` sets and a node keeps with what opens its device again), how deep a
/// query reads that names no depth of its own (`default`, `QUERY_DEPTH`), and the most a device may read (`ceiling`,
/// `lens::CEILING`, as deep as any write that counts reaches).
pub(crate) fn limits(depth: usize) -> Value {
    json!({ "depth": depth, "default": QUERY_DEPTH, "ceiling": lens::CEILING })
}

/// `{"op": "get", "entry", "schema"?, "line"?, "at"? | "version"?}`: entry `entry` on line `line` (the main line, left
/// out), or at version `at` of that line, or at its release numbered `version` (`History::release`), read-only, through
/// `schema`, as a query's row, with the line's heads, which release of the line it shows and how many of the line's
/// writes after it (`version`, `History::describe`), the schemas the item was written under, and the files the line
/// brings that `me` counts as the entry's (`Lab::line_files`), oldest first, each `{root, size, len}` as the world lists
/// an entry's main line's, its plaintext length null where `me` opens none: so a proposal's file, a new version of an
/// asset's recipe on its line, is read before its vault accepts it.
fn owner_base_provenance(lab: &Lab, me: SignerId, entry: EntryId) -> Option<Value> {
    lab.active_owner_base(me, entry).map(|(snapshot, basis)| json!({
        "snapshot": snapshot.to_hex(), "basis": ids(&basis), "partial": true,
        "freshness": "owner-attested-basis-with-validated-suffix",
        "historyComplete": false, "filesComplete": false,
        "pendingSuffix": lab.owner_base_pending(me, entry),
        "blockedReason": lab.owner_base_wait_reason(me, entry),
        "missingDependencyBodies": lab.owner_base_missing(me).into_iter()
            .find(|(e, _)| *e == entry).map(|(_, missing)| ids(&missing)).unwrap_or_default()
    }))
}

fn get(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let (entry, line, schema) = (entry_of(o)?, line_of(o, "line")?, named(o)?);
    if !o.contains_key("at") && !o.contains_key("version") {
        if let Some(checkpoint) = lab.entry_projection(me, entry) {
            if let Some(stored) = checkpoint.record(line) {
                let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
                let m = lab.meaning(me, entry).ok_or(Refused::NoEntry)?;
                let mut seen = seen_of(&lane(lab, me, vault), &stored, &BTreeSet::new(), &schema)
                    .ok_or_else(|| unseen(&schema))?;
                seen.read_only = true;
                let mut out = row(entry, vault, &m.attrs, &seen, seen.record.clone());
                out["line"] = line_json(line);
                out["heads"] = ids(checkpoint.basis()).into();
                out["at"] = Value::Null;
                out["version"] = Value::Null;
                out["authored"] = json!([]);
                out["files"] = json!([]);
                out["filesComplete"] = false.into();
                out["checkpoint"] = json!({ "snapshot": checkpoint.snapshot().to_hex(),
                    "basis": ids(checkpoint.basis()), "partial": true, "freshness": "owner-attested-basis" });
                return Ok(out);
            }
        }
    }
    let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
    if !h.lines().contains(&line) {
        return Err(Refused::NoEntry);
    }
    let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
    let m = lab.meaning(me, entry).ok_or(Refused::NoEntry)?;
    let mut at = o.get("at").map(|v| edits_of(v, "at")).transpose()?;
    if at.iter().flatten().any(|e| h.get(*e).is_none()) {
        return Err(Refusal::UnknownDep.into());
    }
    if let Some(n) = count_of(o, "version")? {
        if at.is_some() {
            return Err(bad("get reads a version by its edits (at) or by its number (version), not both"));
        }
        let release = h.release(line, n as u64);
        if release.is_empty() {
            return Err(bad(format!("the line has no version {n}")));
        }
        at = Some(release);
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
    seen.read_only |= at.is_some() || lab.owner_base_durability_pending(me, entry) || lab.owner_base_pending(me, entry) > 0 || lab.owner_base_wait_reason(me, entry).is_some();
    let mut out = row(entry, vault, &m.attrs, &seen, seen.record.clone());
    out["line"] = line_json(line);
    out["heads"] = ids(&h.heads(line)).into();
    out["at"] = at.as_deref().map_or(Value::Null, |at| ids(at).into());
    out["version"] = described(h, line, at.as_deref().unwrap_or(&h.heads(line)));
    out["authored"] = item.authored().iter().map(BlobId::to_hex).collect::<Vec<_>>().into();
    let file = |(root, len): (FileRoot, Option<u64>)| json!({ "root": BlobId(root.hash).to_hex(), "size": root.size, "len": len });
    out["files"] = lab.line_files(me, entry, line).into_iter().map(file).collect::<Vec<_>>().into();
    if let Some(provenance) = owner_base_provenance(lab, me, entry) {
        out["checkpoint"] = provenance;
        out["filesComplete"] = false.into();
    }
    Ok(out)
}

/// What one write of an entry's history is, as `history` and the note page show it.
pub struct Wrote {
    /// `edit`; `propose`, the start of a proposal; `variant`, the start of a variant; `draft`, a creation that starts
    /// its own line (`Lab::create_draft`); `merge` of two lines, with the change, if any, that brings Loro's merged
    /// item to the three-way merge of both; `accept`, the vault's accept of the proposal it is on (M2,
    /// `policy::is_accept`); or `sealed`, a write the device can't open.
    pub kind: &'static str,
    /// The other line it builds on: for a merge, the line it brought in; for a proposal, the line it started from.
    pub from: Option<Line>,
    /// The version it changed: what it built on, or for a merge, its own line's version before it, so its changes are
    /// what it brought.
    pub base: Vec<EditId>,
    /// Why its readers don't count it, if they don't: it builds on a write they don't count (`builds-on`); it writes
    /// on main through a share of a draft its vault hadn't landed (`landing`, `History::lands`), which every reader
    /// judges in the clear, whatever it holds; they can't open it (`sealed`); it doesn't fit the schemas its entry was
    /// written under (`unfit`, S1 to S4); it merges into main through a share on top of no accept of the vault's, or
    /// brings in more than it accepted (`policy`, M2); or the ops of the shares it relies on don't allow what it
    /// touches or the tags it asks for (`ops`, C1 to C4).
    pub why: Option<&'static str>,
}

pub fn wrote(h: &History, c: &history::Change) -> Wrote {
    let w = &c.write;
    let line = w.line();
    let on = |d: &EditId| h.get(*d).map(|x| x.write.line());
    let from = w.deps.iter().filter_map(on).find(|l| *l != line);
    let kind = match &c.body {
        _ if w.proposal == Proposal::New && w.first => "draft",
        _ if w.proposal == Proposal::New && h.is_variant(w.edit) => "variant",
        _ if w.proposal == Proposal::New => "propose",
        None => "sealed",
        Some(_) if c.accept() => "accept",
        Some(change) if change.is_empty() || from.is_some() => "merge",
        Some(_) => "edit",
    };
    let own: Vec<EditId> = w.deps.iter().copied().filter(|d| on(d) == Some(line)).collect();
    let base = if kind == "edit" || own.is_empty() { w.deps.clone() } else { own };
    let builds_on = || w.deps.iter().any(|d| h.get(*d).is_some_and(|x| !x.counted));
    let why = if c.counted {
        None
    } else if builds_on() {
        Some("builds-on")
    } else if !h.landed_for(w.edit) {
        Some("landing")
    } else if c.body.is_none() {
        Some("sealed")
    } else if !c.fits {
        Some("unfit")
    } else if !h.passes(w, c.touches.as_deref()) {
        Some("policy")
    } else {
        Some("ops")
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

/// The version `heads` of `line` by its releases (`History::describe`): `{version, edits}`, the highest release of
/// the line it holds (`null` before the first) and how many of the line's writes it holds after it, as a page names a
/// version "v4", or "v4 + 2 edits".
pub fn described(h: &History, line: Line, heads: &[EditId]) -> Value {
    let d = h.describe(line, heads);
    json!({ "version": d.version, "edits": d.edits })
}

/// Which version of main write `edit` of entry history `h` belongs to, where it is in the history of line `line`, main
/// or a variant (`Lab::brought`): of main's, the first release of main that holds it, its creation or the merge that
/// took in the proposal it was made on; of a variant's, the release of main it holds (`History::describe`), as the
/// variant follows main. `null` for none.
pub fn main_version(h: &History, edit: EditId, line: Line) -> Value {
    let version = match line {
        None => main_release(h, edit),
        Some(_) => h.describe(MAIN, &[edit]).version,
    };
    json!(version)
}

/// The first release of main that holds write `edit`: its creation, or the merge that took in the proposal it was made
/// on.
fn main_release(h: &History, edit: EditId) -> Option<u64> {
    let holds = |r: &history::Release| h.version(&[r.edit]).iter().any(|c| c.write.edit == edit);
    h.releases(MAIN).iter().find(|r| holds(r)).map(|r| r.version)
}

/// The heads a pin of write `edit` names (`pin`, Samuel 2026-10-18: a pin is the entry's id and a version's heads,
/// all hashes): of main's, that release of main (`main_version`), the version a world pins; of a variant's, the write
/// itself, the variant as it stood once it brought it. Empty where main holds it in no release yet.
pub fn version_heads(h: &History, edit: EditId, line: Line) -> Value {
    let at = match line {
        None => main_release(h, edit).map(|v| h.release(MAIN, v)).unwrap_or_default(),
        Some(_) => vec![edit],
    };
    json!(ids(&at))
}

/// The releases of `line` (`History::releases`), each `{edit, version}`, oldest first.
pub fn releases(h: &History, line: Line) -> Vec<Value> {
    h.releases(line).iter().map(|r| json!({ "edit": r.edit.to_hex(), "version": r.version })).collect()
}

/// The number of each write of `h` that is a release of its own line.
pub fn numbered(h: &History) -> HashMap<EditId, u64> {
    h.lines().into_iter().flat_map(|l| h.releases(l)).map(|r| (r.edit, r.version)).collect()
}

/// `{"op": "pin", "entry", "at"?}`: what a pin of entry `entry` at version `at` (its main line's heads, left out)
/// names, all read off the entry's history at that version: the line its writes are on and its name (`main`, or the
/// proposal's or variant's), which release of the line it is and how many of the line's writes it holds after it
/// (`version`, `History::describe`), the record's title there, and the entry's short id, its first 8 hex digits. So a
/// page labels a pin "Crawler excavator v4 · 01627d33…" from avenDB alone, and stores only the entry id and the heads.
fn pin(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let entry = entry_of(o)?;
    let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
    let at = match o.get("at") {
        Some(v) => edits_of(v, "at")?,
        None => h.heads(MAIN),
    };
    if at.iter().any(|e| h.get(*e).is_none()) {
        return Err(Refusal::UnknownDep.into());
    }
    let first = at.first().and_then(|e| h.get(*e)).ok_or(Refused::NoEntry)?;
    let line = first.write.line();
    let record = h.item_at(&at, me, line).record();
    let title = record.get("title").and_then(Value::as_str).map(String::from);
    Ok(json!({
        "entry": entry.to_hex(),
        "at": ids(&at),
        "line": line_json(line),
        "name": line_name(h, line),
        "version": described(h, line, &at),
        "title": title,
        "short": entry.to_hex()[..8].to_string(),
    }))
}

/// `{"op": "history", "entry", "limit"?}`: entry `entry`'s lines, the main line first, then each proposal and variant
/// in the order it started, each with its name, the version it started from, its heads, which release its heads are
/// (`version`, `described`) and its releases (`versions`), and for a variant, that it is one (`variant`), which version
/// of main it holds (`main`) and whether main has writes it hasn't followed (`behind`); and every write of it the
/// device holds, in the order it took them, each with its id, its device (`author`), the vault it acted for, the owners
/// it acted through (`via`) and who stands behind it, link by link back to the passkeys (`chain`,
/// `data::Audit::chain`), its line, what it builds on, what it is (`wrote`), its number where it is a release of its
/// line (`version`), whether its readers count it (`counted`: a write that breaks its entry's schemas, that no op of
/// its shares allows, or that builds on one, is on no line), why not (`why`) and, for the latest `limit` (`SHOWN`, left
/// out) that change anything, the changes it made to the stored record (`ops::diff`), which every reader of the entry
/// sees alike. Each line and each release says who wrote it as it stands there (`authors`, `world::authors`): the
/// coop's aven and the human vaults whose devices signed its writes.
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
            "authors": authors_json(lab, me, &authors(lab, me, entry, &h.heads(line))),
            "version": described(h, line, &h.heads(line)),
            "versions": releases(h, line),
            "variant": line.is_some_and(|b| h.is_variant(b)),
            "main": line.filter(|&b| h.is_variant(b)).map(|_| described(h, MAIN, &h.heads(line))),
            "behind": line.is_some_and(|b| h.is_variant(b) && h.behind(line, MAIN)),
        })
    };
    let numbers = numbered(h);
    let shown = h.changes().len().saturating_sub(limit);
    let audit = data::Audit::new(lab, me);
    let edit = |(i, c): (usize, &history::Change)| {
        let (w, x) = (&c.write, wrote(h, c));
        let changes = (i >= shown && matches!(x.kind, "edit" | "merge" | "draft")).then(|| {
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
            "via": w.via.iter().map(VaultId::to_hex).collect::<Vec<_>>(),
            "chain": audit.chain(w.author, w.actor, &w.via),
            "line": line_json(w.line()),
            "deps": ids(&w.deps),
            "kind": x.kind,
            "counted": c.counted,
            "why": x.why,
            "name": if matches!(x.kind, "propose" | "variant") { h.name(w.edit) } else { None },
            "from": x.from.map(|l| json!({ "line": line_json(l), "name": line_name(h, l) })),
            "version": numbers.get(&w.edit),
            "authors": numbers.get(&w.edit).map(|_| authors_json(lab, me, &authors(lab, me, entry, &[w.edit]))),
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

/// How many messages `room` shows where it is asked for no number.
const ROOM_SHOWN: usize = 50;

/// `{"op": "room", "entry", "last"?, "before"?}`: room `entry` as its main line holds it, its last `last` messages (50
/// where it names none), those before message `before` where it names one, in the list's order, the same on every
/// device; `count`, how many it holds in all; and `more`, whether older ones are left. Each message, thread reply and
/// reaction carries who added it, read off the room's history and never off the row (`policy::Mine`): `by`, the person,
/// as `authors` names one (the human vault or the aven the device that wrote it belongs to, `{vault, name, kind}`), and
/// `actor`, the vault it acted for, as an agent's device vault; both `null` where no counted write, or more than one
/// vault, added it.
fn room(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let entry = entry_of(o)?;
    let last = count_of(o, "last")?.unwrap_or(ROOM_SHOWN);
    let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
    let item = lab.item_on(me, entry, MAIN).ok_or(Refused::NoEntry)?;
    let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
    let seen = see(&lane(lab, me, vault), item, &Named::Own).ok_or_else(|| unseen(&Named::Own))?;
    let mut record = Value::Object(seen.record.clone());
    if record["kind"] != "room" {
        return Err(bad("the entry is no room"));
    }
    let st = lab.state(me);
    // who added each row, by its place, as `policy::Mine` reads it: one vault, or none where two did
    let mut adders: HashMap<String, Option<(VaultId, VaultId)>> = HashMap::new();
    for c in h.changes().iter().filter(|c| c.counted) {
        let signed = c.write.via.last().copied().unwrap_or(c.write.actor);
        for l in &c.adds {
            let by = (c.write.actor, signed);
            adders.entry(l.to_json().to_string()).and_modify(|x| *x = x.filter(|x| x.0 == by.0)).or_insert(Some(by));
        }
    }
    let person = |v: VaultId| st.vault(v).is_some_and(|v| matches!(v.kind, Kind::Human | Kind::Aven));
    fn mark(
        rows: &mut Value,
        at: &[Value],
        field: &str,
        adders: &HashMap<String, Option<(VaultId, VaultId)>>,
        by: &dyn Fn(VaultId) -> Value,
    ) {
        let Some(rows) = rows.get_mut(field).and_then(Value::as_array_mut) else { return };
        for row in rows {
            let Some(id) = row.get("id").and_then(Value::as_i64) else { continue };
            let place = [at, &[json!(field), json!({ "id": id })]].concat();
            let who = adders.get(&Value::Array(place.clone()).to_string()).copied().flatten();
            row["by"] = who.map_or(Value::Null, |(_, signed)| by(signed));
            row["actor"] = who.map_or(Value::Null, |(actor, _)| actor.to_hex().into());
            for inner in ["thread", "reactions"] {
                mark(row, &place, inner, adders, by);
            }
        }
    }
    let by = |v: VaultId| match person(v) {
        true => authors_json(lab, me, &[v])[0].clone(),
        false => json!({ "vault": v.to_hex(), "name": null, "kind": null }),
    };
    mark(&mut record, &[], "messages", &adders, &by);
    let messages = record["messages"].as_array().cloned().unwrap_or_default();
    let end = match o.get("before") {
        None => messages.len(),
        Some(b) => {
            let b = b.as_i64().ok_or_else(|| bad("before is a message's id"))?;
            messages.iter().position(|m| m["id"].as_i64() == Some(b)).ok_or_else(|| bad("no message has that id"))?
        }
    };
    let start = end.saturating_sub(last);
    record["messages"] = messages[start..end].to_vec().into();
    Ok(json!({
        "entry": entry.to_hex(),
        "vault": vault.to_hex(),
        "heads": ids(&h.heads(MAIN)),
        "read_only": seen.read_only,
        "room": record,
        "count": messages.len(),
        "more": start > 0,
    }))
}

/// `{"op": "schemas", "vault"}`: the schemas and lenses vault `vault`'s entries are read through, the app's own first
/// (`builtIn`), then those of its lane, its schema and lens entries: each schema's id, title, the kind its records name
/// and its JSON, each lens's id, title, the schemas it joins and its JSON.
fn schemas(lab: &Lab, me: SignerId, o: &Map<String, Value>) -> Result<Value, Refused> {
    let vault = vault_of(o, "vault")?;
    let shipped = lens::blobs::SHIPPED.iter().chain(&lens::blobs::LENSES);
    let built_in: Vec<BlobId> = shipped.map(|b| BlobId::of(b.as_bytes())).collect();
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

/// A file a creation brings beside its record (`create`'s `file`): its length, as the op names it, and its bytes, once
/// a node brought them into its store (`put_file`); a dry run checks the creation without them.
struct Bringing {
    len: u64,
    brought: Option<Brought>,
}

enum Step {
    /// A new entry, or with `draft`, a draft that starts its own line (`Lab::create_draft`), its first write bringing
    /// `file`, where it names one (`Lab::create_bringing`).
    Create {
        vault: VaultId,
        ty: String,
        tags: Vec<String>,
        schema: Named,
        value: Value,
        draft: bool,
        file: Option<Bringing>,
    },
    /// A schema or lens entry holding `blob`, a schema or lens of type `ty` (`Lab::add_schema`).
    AddSchema { vault: VaultId, ty: String, blob: Vec<u8> },
    /// Record ops on one entry's line, through one schema: one write.
    Edits { entry: EntryId, line: Line, schema: Named, ops: Vec<RecordOp> },
    Tag { entry: EntryId, add: Vec<String>, remove: Vec<String> },
    Propose { entry: EntryId, from: Option<Vec<EditId>>, name: String },
    /// A variant of `entry` named `name`, from version `from`, its main line's heads left out (`Lab::variant`).
    Variant { entry: EntryId, from: Option<Vec<EditId>>, name: String },
    Merge { entry: EntryId, from: Line, into: Line, take: BTreeSet<Place> },
    /// The vault's answer to proposal `line` of `entry` (`review`).
    Review { entry: EntryId, line: EditId, verdict: String, text: String },
    /// A new AIP in `vault`, an idea over the proposal lines `proposals` (`aip_open`).
    AipOpen {
        vault: VaultId,
        title: String,
        note: String,
        proposals: Vec<(EntryId, EditId)>,
        tags: Vec<String>,
        objective: Option<String>,
    },
    /// AIP `entry`'s objective, a file of Lean (`aip_objective`, `crate::objective`).
    AipObjective { entry: EntryId, lean: String },
    /// A reading recorded on AIP `entry`: a name, a value and a note (`aip_measure`).
    AipMeasure { entry: EntryId, name: String, value: Value, note: Option<String> },
    /// AIP `entry` proposed, with its number (`aip_promote`).
    AipPromote { entry: EntryId },
    /// AIP `entry` withdrawn, and why (`aip_withdraw`).
    AipWithdraw { entry: EntryId, why: Option<String> },
    /// The vault's answer to AIP `entry`, over every line (`aip_review`), at the version of its lines `heads` names,
    /// if it names one.
    AipReview { entry: EntryId, verdict: String, text: String, heads: Option<Vec<EditId>> },
    Restore { entry: EntryId, line: Line, at: Vec<EditId> },
    Undo { entry: EntryId, line: Line, edit: EditId },
    Fork { entry: EntryId, line: Line, into: VaultId, schema: Named, ops: Vec<RecordOp> },
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

/// Record ops, read: each of `ops::RecordOp`, carrying no field an op on a record doesn't take.
fn record_ops(v: &Value) -> Result<Vec<RecordOp>, Refused> {
    let xs = v.as_array().ok_or_else(|| bad("ops is a list of ops"))?;
    let one = |x: &Value| {
        let (name, o) = op_of(x)?;
        if !["set", "unset", "insert", "remove", "move"].contains(&name) {
            return Err(bad(format!("{name} isn't an op on a record")));
        }
        if let Some(k) = ["entry", "line", "schema", "as"].iter().find(|k| o.contains_key(**k)) {
            return Err(bad(format!("an op on the copy takes no {k:?}: the fork names them")));
        }
        RecordOp::of_json(x).map_err(bad)
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
        "create" if o.get("type").and_then(Value::as_str).is_some_and(|t| Sym::new(t).of_lane()) => {
            if let Some(k) = ["tags", "schema", "file"].iter().find(|k| o.contains_key(**k)) {
                return Err(bad(format!("a schema or lens entry takes no {k:?}: it holds its JSON and nothing else")));
            }
            if draft_of(o)? {
                let why = "a schema or lens is never a draft: it joins its vault's lane by the vault's own creation \
                    on main, as a new type needs its schema there first";
                return Err(bad(why));
            }
            let blob = match o.get("value") {
                Some(Value::String(text)) => text.as_bytes().to_vec(),
                Some(v @ Value::Object(_)) => v.to_string().into_bytes(),
                _ => return Err(bad("create of a schema or lens takes its JSON: value, an object or its text")),
            };
            Step::AddSchema { vault: vault_of(o, "vault")?, ty: text("type")?, blob }
        }
        "create" => {
            let value = o.get("value").filter(|v| v.is_object()).ok_or_else(|| bad("create takes a record: value"))?;
            let (tags, schema, draft) = (texts_of(o, "tags")?, named(o)?, draft_of(o)?);
            let file = vaults::create_file(o)?.map(|len| Bringing { len, brought: None });
            let (vault, ty, value) = (vault_of(o, "vault")?, text("type")?, value.clone());
            Step::Create { vault, ty, tags, schema, value, draft, file }
        }
        "set" | "unset" | "insert" | "remove" | "move" => {
            let op = RecordOp::of_json(v).map_err(bad)?;
            Step::Edits { entry: entry_of(o)?, line: line_of(o, "line")?, schema: named(o)?, ops: vec![op] }
        }
        "tag" => Step::Tag { entry: entry_of(o)?, add: texts_of(o, "add")?, remove: texts_of(o, "remove")? },
        "propose" => {
            let from = o.get("from").map(|v| edits_of(v, "from")).transpose()?;
            Step::Propose { entry: entry_of(o)?, from, name: text("name")? }
        }
        "variant" => {
            let from = o.get("from").map(|v| edits_of(v, "from")).transpose()?;
            Step::Variant { entry: entry_of(o)?, from, name: text("name")? }
        }
        "merge" => {
            if !o.contains_key("from") {
                return Err(bad("merge takes the line it merges: from, null for the main line"));
            }
            let take = match o.get("take") {
                None => BTreeSet::new(),
                Some(t) => {
                    let places = t.as_array().ok_or_else(|| bad("take is a list of places: {at, what}"))?;
                    let why = "a place is {at: path, what: value | row | order}";
                    let place = |p| Place::of_json(p).ok_or_else(|| bad(why));
                    places.iter().map(place).collect::<Result<_, _>>()?
                }
            };
            Step::Merge { entry: entry_of(o)?, from: line_of(o, "from")?, into: line_of(o, "into")?, take }
        }
        "review" => {
            let line = line_of(o, "line")?.ok_or_else(|| bad("a review answers a proposal: line, not the main line"))?;
            let verdict = text("verdict")?;
            if !VERDICTS.contains(&verdict.as_str()) {
                return Err(bad("verdict is accepted, declined or revise"));
            }
            let text = match o.get("text") {
                None | Some(Value::Null) => String::new(),
                Some(Value::String(t)) => t.clone(),
                Some(_) => return Err(bad("review takes its words as a text: text")),
            };
            Step::Review { entry: entry_of(o)?, line, verdict, text }
        }
        "aip_open" => {
            let note = optional_text(o, name, "note")?.unwrap_or_default();
            let lines = match o.get("proposals") {
                None | Some(Value::Null) => vec![],
                Some(v) => {
                    let why = "proposals is a list of lines, each {entry, line}";
                    let xs = v.as_array().ok_or_else(|| bad(why))?;
                    let one = |x: &Value| -> Result<(EntryId, EditId), Refused> {
                        let x = x.as_object().filter(|x| x.keys().all(|k| k == "entry" || k == "line"));
                        let x = x.ok_or_else(|| bad(why))?;
                        Ok((entry_of(x)?, id_of(x.get("line"), "line", EditId::from_hex)?))
                    };
                    xs.iter().map(one).collect::<Result<_, _>>()?
                }
            };
            let (vault, tags) = (vault_of(o, "vault")?, texts_of(o, "tags")?);
            let objective = optional_text(o, name, "objective")?;
            Step::AipOpen { vault, title: text("title")?, note, proposals: lines, tags, objective }
        }
        "aip_objective" => Step::AipObjective { entry: entry_of(o)?, lean: text("lean")? },
        "aip_measure" => {
            let value = o.get("value").filter(|v| v.is_number()).cloned();
            let value = value.ok_or_else(|| bad("aip_measure takes the number it read: value"))?;
            Step::AipMeasure { entry: entry_of(o)?, name: text("name")?, value, note: optional_text(o, name, "note")? }
        }
        "aip_promote" => Step::AipPromote { entry: entry_of(o)? },
        "aip_withdraw" => Step::AipWithdraw { entry: entry_of(o)?, why: optional_text(o, name, "why")? },
        "aip_review" => {
            let verdict = text("verdict")?;
            if !VERDICTS.contains(&verdict.as_str()) {
                return Err(bad("verdict is accepted, declined or revise"));
            }
            let text = optional_text(o, name, "text")?.unwrap_or_default();
            let heads = o.get("heads").filter(|v| !v.is_null()).map(|v| edits_of(v, "heads")).transpose()?;
            Step::AipReview { entry: entry_of(o)?, verdict, text, heads }
        }
        "restore" => {
            let at = edits_of(o.get("at").ok_or_else(|| bad("restore takes the version it puts back: at"))?, "at")?;
            Step::Restore { entry: entry_of(o)?, line: line_of(o, "line")?, at }
        }
        "undo" => {
            let edit = id_of(o.get("edit"), "edit", EditId::from_hex)?;
            Step::Undo { entry: entry_of(o)?, line: line_of(o, "line")?, edit }
        }
        "fork" => {
            let ops = o.get("ops").map(record_ops).transpose()?.unwrap_or_default();
            let (line, schema) = (line_of(o, "line")?, named(o)?);
            Step::Fork { entry: entry_of(o)?, line, into: vault_of(o, "into")?, schema, ops }
        }
        name if vaults::CHANGES.contains(&name) => return Err(bad(format!("{name} runs alone, never in a batch"))),
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
        if let Step::Create { file: Some(_), .. } = act.step {
            let why = bad("a create that brings a file runs alone, its bytes beside it, never in a batch");
            return Err(refused(i, &[], why));
        }
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

/// `{"op": "may", "ops", "as"?}`: whether device `me` would make each of the change ops `ops`, each on what the device
/// holds now, each acting for the vault it names (`as`), else the may's where it takes one (`fields`), else its own or
/// the device's: for each, `true`; `{"approve": {signers}}`, once those approve it (`Approval::verdict`); or the
/// refusal running it would meet. Each runs dry (`Lab::dry`): checked, proven against the ops of the shares it relies
/// on and refused as `run` would, and then not made.
fn may(lab: &mut Lab, me: SignerId, v: &Value) -> Result<Value, Refused> {
    let (_, o) = op_of(v)?;
    let actor = o.get("as").map(|_| vault_of(o, "as")).transpose()?;
    let ops = o.get("ops").and_then(Value::as_array).ok_or_else(|| bad("may takes the ops it asks about: ops"))?;
    let acting = |op: &Value| -> Value {
        let takes = name(op).and_then(fields).is_some_and(|f| f.contains(&"as"));
        match actor {
            Some(a) if takes && op.get("as").is_none() => {
                let mut op = op.clone();
                op["as"] = a.to_hex().into();
                op
            }
            _ => op.clone(),
        }
    };
    Ok(ops.iter().map(|op| verdict(lab, me, &acting(op))).collect::<Vec<_>>().into())
}

/// What `may` answers of change op `v` on device `me`, by a dry run: `true`, `{"approve": {signers}}` or the
/// refusal.
pub fn verdict(lab: &mut Lab, me: SignerId, v: &Value) -> Value {
    vaults::verdict_of(lab.dry(|lab| prepare(lab, me, v)))
}

/// Step `s`, acting for `actor`, on device `me`.
fn step(lab: &mut Lab, me: SignerId, actor: VaultId, s: Step) -> Result<Value, Refused> {
    match s {
        Step::Create { vault, ty, tags, schema, value, draft, file } => {
            // its file's bytes come beside the op, which a node reads; a dry run checks the creation alone, as the
            // rules judge a creation by what it creates and never by the files it brings
            let files: Vec<Brought> = match file {
                Some(Bringing { brought: Some(b), .. }) => vec![b],
                Some(_) if !lab.is_dry() => {
                    let why = "a create that brings a file brings its bytes beside it: a node runs it (Node::run)";
                    return Err(bad(why));
                }
                _ => vec![],
            };
            let root = files.first().map(|b| b.root);
            let lane = lane(lab, me, vault);
            let app = match schema {
                Named::Own => own(&lane, &value),
                Named::Stored => None,
                Named::Id(id) => lane.schema(id).cloned(),
            };
            let app = app.ok_or_else(|| unseen(&schema))?;
            let (view, value) = (View::plain(&app), full(&app, &value)?);
            if draft {
                // written as the device's draft peer of the entry, whose id is drawn first (`doc::Peer::Draft`)
                let content = |entry| {
                    let mut item = Item::draft(me, entry);
                    item.write(&view, &value).then(|| item.export(&Version::default()))
                };
                let (entry, line) = lab.create_draft_bringing(me, actor, vault, &ty, &strs(&tags), content, files)?;
                return Ok(with_file(json!({ "entry": entry.to_hex(), "line": line.to_hex() }), root));
            }
            let item = Item::made(&view, &value, me).ok_or(Refusal::NotAView)?;
            let entry = lab.create_bringing(me, actor, vault, &ty, &strs(&tags), item, files)?;
            Ok(with_file(json!({ "entry": entry.to_hex() }), root))
        }
        Step::AddSchema { vault, ty, blob } => {
            // the type its JSON reads as, as `Lab::add_schema` reads it, which must be the one asked for
            let is = match (Lens::parse(&blob), Schema::parse(&blob)) {
                (Some(_), _) => LENS_TYPE,
                (None, Some(_)) => SCHEMA_TYPE,
                (None, None) => return Err(bad(format!("value is no {ty}: neither a schema nor a lens"))),
            };
            if ty != is {
                return Err(bad(format!("value is a {is}, not a {ty}")));
            }
            let entry = lab.add_schema(me, actor, vault, &blob)?;
            Ok(json!({ "entry": entry.to_hex(), "blob": BlobId::of(&blob).to_hex() }))
        }
        Step::Edits { entry, line, schema, ops } => edits(lab, me, actor, (entry, line), &schema, &ops),
        Step::Tag { entry, add, remove } => {
            landed(lab, me, entry, MAIN)?;
            let edit = lab.tag(me, actor, entry, &strs(&add), &strs(&remove))?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex() }))
        }
        Step::Propose { entry, from, name } => {
            let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
            // a draft its vault hasn't landed is on its own line alone: a proposal of it starts there, by default from
            // that line's heads, and from no version that doesn't hold its creation
            let draft = h.changes().iter().find(|c| c.write.first).filter(|_| !lab.landed(me, entry));
            let start = draft.map(|c| Some(c.write.edit)).unwrap_or(MAIN);
            let from = match from {
                Some(from) => from,
                None => h.heads(start),
            };
            if let Some(c) = draft
                && !h.version(&from).iter().any(|x| x.write.edit == c.write.edit)
            {
                let why = "the entry is a draft its vault hasn't landed: a proposal of it starts from a version of its \
                    line, which holds its creation";
                return Err(bad(why));
            }
            let edit = lab.propose(me, actor, entry, &from, &name)?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": edit.to_hex() }))
        }
        Step::Variant { entry, from, name } => {
            if !lab.landed(me, entry) {
                return Err(bad("the entry is a draft its vault hasn't landed: a variant starts from its main line"));
            }
            let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
            let from = from.unwrap_or_else(|| h.heads(MAIN));
            let edit = lab.variant(me, actor, entry, &from, &name)?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": edit.to_hex() }))
        }
        Step::Merge { entry, from, into, take } => {
            let edit = lab.merge(me, actor, entry, from, into, &take)?;
            let follows = if into == MAIN { follow(lab, me, actor, entry) } else { vec![] };
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": line_json(into), "follows": follows }))
        }
        Step::Review { entry, line, verdict, text } => review(lab, me, actor, (entry, line), &verdict, text),
        Step::AipOpen { vault, title, note, proposals, tags, objective } => {
            aips::open(lab, me, actor, vault, (title, note), &proposals, tags, objective)
        }
        Step::AipObjective { entry, lean } => aips::objective(lab, me, actor, entry, lean),
        Step::AipMeasure { entry, name, value, note } => aips::measure(lab, me, actor, entry, name, &value, note),
        Step::AipPromote { entry } => aips::promote(lab, me, actor, entry),
        Step::AipWithdraw { entry, why } => aips::withdraw(lab, me, actor, entry, why),
        Step::AipReview { entry, verdict, text, heads } => {
            aips::review(lab, me, actor, entry, &verdict, text, heads.as_deref())
        }
        Step::Restore { entry, line, at } => {
            landed(lab, me, entry, line)?;
            let edit = lab.restore(me, actor, entry, line, &at)?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": line_json(line) }))
        }
        Step::Undo { entry, line, edit } => {
            landed(lab, me, entry, line)?;
            let edit = lab.undo(me, actor, entry, line, edit)?;
            Ok(json!({ "entry": entry.to_hex(), "edit": edit.to_hex(), "line": line_json(line) }))
        }
        Step::Fork { entry, line, into, schema, ops } => {
            let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
            let lane = lane(lab, me, vault);
            // the copy names where it came from, in its first write: the note and the version it copies, by the hashes
            // of that version's edits, in place of the mark of the note its original was made from, if it was
            let at = lab.history(me, entry).map(|h| h.heads(line)).unwrap_or_default();
            let mark = |copy: &mut Item| -> Result<(), Refused> {
                let tags = copy.as_markdown().map(|d| d.tags);
                let older = tags.iter().flatten().filter(|t| t.starts_with(FORK));
                let drop = |t: &String| RecordOp::top("tags", FieldOp::Drop(t.as_str().into()));
                let mut all: Vec<RecordOp> = older.map(drop).collect();
                if tags.is_some() {
                    all.push(RecordOp::top("tags", FieldOp::Add(fork_mark(entry, &at).into(), None)));
                }
                all.extend(ops);
                if all.is_empty() {
                    return Ok(());
                }
                let (new, view) = ran(&lane, copy, &schema, &all)?;
                copy.write(&view, &new);
                Ok(())
            };
            let made = lab.fork_with(me, actor, entry, (line, into), mark)?;
            Ok(json!({ "entry": made.to_hex() }))
        }
    }
}

/// Bring main into every variant of entry `entry` that lacks a write of it, acting for `actor`: a merge of main into
/// each, which keeps the variant's own value wherever both changed one place, so it never asks. A variant `actor` may
/// not write on stays behind, as it is, and shows it. Answers each merge made, `{line, edit}`.
fn follow(lab: &mut Lab, me: SignerId, actor: VaultId, entry: EntryId) -> Vec<Value> {
    let Some(h) = lab.history(me, entry) else { return vec![] };
    let behind: Vec<EditId> = h.variants().into_iter().filter(|&v| h.behind(Some(v), MAIN)).collect();
    let none = BTreeSet::new();
    let merged = behind.into_iter().filter_map(|v| Some((v, lab.merge(me, actor, entry, MAIN, Some(v), &none).ok()?)));
    merged.map(|(v, edit)| json!({ "line": v.to_hex(), "edit": edit.to_hex() })).collect()
}

/// The verdicts a review gives (`lens::blobs::REVIEW_V1`).
const VERDICTS: [&str; 3] = ["accepted", "declined", "revise"];

/// `{"op": "review", "entry", "line", "verdict", "text"?, "as"?}`: the answer of entry `entry`'s vault, `actor`, to its
/// proposal `line` as it stands: a review record in the vault (`lens::blobs::REVIEW_V1`), naming the proposal, the
/// version it answers (`heads`), the vault that started it (`by`), the verdict, the words (`text`) and the device's
/// time (`at`, advice only). An acceptance first writes the vault's accept on the proposal (`Lab::accept`, M2), and
/// the review names the version that accept makes, so whoever may merge the proposal into main merges what was
/// accepted and nothing written after; `declined` and `revise` write the review alone. The policy is every vault's
/// default, one of its owners: the vault answers for itself (`NoCap` acting for another), and its merges need no
/// review. Answers the review entry, and the accept, if any.
fn review(
    lab: &mut Lab,
    me: SignerId,
    actor: VaultId,
    (entry, line): (EntryId, EditId),
    verdict: &str,
    text: String,
) -> Result<Value, Refused> {
    let vault = lab.vault_of_entry(me, entry).ok_or(Refused::NoEntry)?;
    if actor != vault {
        return Err(Refusal::NoCap.into());
    }
    let h = lab.history(me, entry).ok_or(Refused::NoEntry)?;
    let start = h.get(line).filter(|c| c.write.proposal == Proposal::New).ok_or(Refused::NoEntry)?;
    let (by, heads) = (start.write.actor, h.heads(Some(line)));
    let accept = match verdict {
        "accepted" => Some(lab.accept(me, actor, entry, line)?),
        _ => None,
    };
    let heads = accept.map_or(heads, |a| vec![a]);
    let value = json!({
        "kind": "review",
        "entry": entry.to_hex(),
        "line": line.to_hex(),
        "heads": ids(&heads),
        "by": by.to_hex(),
        "verdict": verdict,
        "text": text,
        "at": lab.now(),
    });
    let (ty, tags, schema) = ("review".into(), vec![], Named::Own);
    let create = Step::Create { vault, ty, tags, schema, value, draft: false, file: None };
    let made = step(lab, me, actor, create)?;
    Ok(json!({
        "entry": entry.to_hex(),
        "line": line.to_hex(),
        "review": made["entry"],
        "accept": accept.map(|a| a.to_hex()),
    }))
}

/// Whether `create` makes a draft (`draft`): false where it says nothing.
fn draft_of(o: &Map<String, Value>) -> Result<bool, Refused> {
    match o.get("draft") {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Bool(b)) => Ok(*b),
        Some(_) => Err(bad("draft is true or false")),
    }
}

/// `NoEntry` for line `line` of entry `entry` where it is the main line of a draft its vault hasn't landed
/// (`Lab::landed`), which holds nothing yet: a tag, a restore or an undo there would be a write on main that no reader
/// counts but the vault's own, and none shows it.
fn landed(lab: &Lab, me: SignerId, entry: EntryId, line: Line) -> Result<(), Refused> {
    match line == MAIN && !lab.landed(me, entry) {
        true => Err(Refused::NoEntry),
        false => Ok(()),
    }
}

/// Record ops `ops` run on what item `item` shows through `schema`: the record after them, each field they leave out
/// at its default, and the view to write it through.
fn ran(lane: &Lane, item: &Item, schema: &Named, ops: &[RecordOp]) -> Result<(Value, View), Refused> {
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
    ops: &[RecordOp],
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

#[cfg(test)]
mod query_readiness_tests {
    use super::*;
    use crate::cast::{document, human_on};
    #[test]
    fn local_empty_query_does_not_certify_discovery_or_unresolved_records() {
        let mut lab=Lab::new(); let owner=lab.passkey("Query owner");
        let device=lab.device_of(owner,"Device"); let vault=human_on(&mut lab,owner,&[device]);
        let empty=run(&mut lab,device,&json!({"op":"query","vault":vault.to_hex()}));
        assert_eq!(empty["ok"]["readiness"]["authoritativeEmpty"],false);
        assert_eq!(empty["ok"]["readiness"]["discovery"],"unverified");
        lab.create(device,vault,vault,"note",&[],document("Title","Text",device)).unwrap();
        // Known label candidate cannot be translated to the requested record schema.
        // Zero rows must preserve that distinction, not assert an empty collection.
        let missing=run(&mut lab,device,&json!({"op":"query","vault":vault.to_hex(),"schema":"todo"}));
        assert_eq!(missing["ok"]["count"],0);
        assert_eq!(missing["ok"]["readiness"]["unresolvedCandidates"],1);
        assert_eq!(missing["ok"]["readiness"]["authoritativeEmpty"],false);
    }
}

#[cfg(test)]
mod creation_candidate_regressions {
    use super::*;
    use crate::{cast, doc::Item};

    #[test]
    fn typed_query_prefilter_matches_full_scan_with_large_unrelated_store_and_retags() {
        let mut w = cast::world();
        let library = cast::library(&mut w);
        let (me, vault) = (w.mac_a, w.alice);
        for n in 0..96 {
            w.lab.create(me, vault, vault, "unrelated", &[], Item::document(&format!("Noise {n}"), me)).unwrap();
        }
        w.lab.tag(me, vault, library.seeds, &["work"], &["home"]).unwrap();
        let plan = Where::of_json(&json!({"type":["todo"]})).unwrap().plan();
        assert!(w.lab.entries(me).len() >= 101);
        assert_eq!(w.lab.query_candidates(me, Some(vault), &plan).len(), 3,
            "only matching creation metadata reaches meaning/materialization");
        let cases = [
            json!({"type":["todo"]}),
            json!({"all":[{"type":["todo"]},{"tag":"work"}]}),
            json!({"any":[{"type":["todo"]},{"tag":"work"}]}),
            json!({"noTag":["home"]}),
            json!({"onlyTags":["work"]}),
            json!({"not":{"type":["todo"]}}),
            json!({"entry":[library.seeds.to_hex()]}),
            json!({"all":[{"type":["todo"]},{"path":["status"],"eq":"open"}]}),
        ];
        for where_ in cases {
            for order in [json!([]), json!([[["title"],"desc"]])] {
                let op = json!({"where":where_,"vault":vault.to_hex(),"order":order,"limit":2,"offset":1});
                let object = op.as_object().unwrap();
                let actual = query(&w.lab, me, object).unwrap();
                let previous = query_candidates_from(&w.lab, me, object, |lab, d, _, _| lab.entries(d)).unwrap();
                assert_eq!(actual, previous, "query {op}: rows/count/readiness/order must match exactly");
            }
        }
        w.lab.sync_all(0);
        let op = json!({"where":{"type":["todo"]},"vault":vault.to_hex()});
        let object = op.as_object().unwrap();
        assert_eq!(query(&w.lab,w.mac_b,object).unwrap(),
            query_candidates_from(&w.lab,w.mac_b,object,|lab,d,_,_|lab.entries(d)).unwrap());
        assert_eq!(query(&w.lab,w.mac_b,object).unwrap()["count"],0);
    }
}
