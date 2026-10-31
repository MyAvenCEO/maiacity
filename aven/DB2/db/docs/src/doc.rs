//! A Doc: its genesis, its envelopes, and the live Loro state of what counts (docs, "A Doc", "Importing: three
//! verdicts", "What the engine and actors build on"). Step 1 holds one branch, `main`.
//!
//! **Import** runs the README's steps in order: limits on the bytes; strict decoding and the device's signature; the
//! writer id; the log (`seq`, `prev`, counters); dependencies held, else the envelope waits; the Loro update's own
//! limits and rule 7, from its metadata, before Loro imports anything; then the three verdicts, each cached per
//! envelope: **fit**, judged once on a scratch copy at the envelope's own dependencies and kept forever; **authorized**,
//! by an [`Authorize`] that caps implements; and **not a split**. An envelope counts when all three hold and everything
//! it builds on counts (`Aven.DB.Docs.Counts`); only then does it enter the live state. A verdict that turns (a split
//! found later, a revocation) rebuilds the live state from the envelopes that still count (rule 13).
//!
//! **Commit** is a local write: one batch of Record writes, applied on a scratch copy and kept only when it fits, then
//! exported as exactly its op range, signed, and imported through the same checks any reader runs. A failure at any
//! step leaves the live state as it was (rule 6).
//!
//! Every counted envelope publishes a new [`Snapshot`] (an immutable read stamped with its version, which readers
//! share without locking the committer) and a [`Feed`] entry with its [`RecordChange`]s.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use aven_core::{DocId, Envelope, Hash, TypeId, Value, Verify};
use loro::json::{JsonOpContent, MapOp};
use loro::{
    ContainerID, ContainerType, ExportMode, Frontiers, ID, IdSpan, Index, LoroDoc, LoroValue,
    ValueOrContainer,
};

use crate::body::Body;
use crate::device::{Device, Ed25519};
use crate::fit::{ChangeKind, RecordChange, Unfit, fit};
use crate::genesis::Genesis;
use crate::limits::Limits;
use crate::opids::{OpId, OpsVerdict, carried_deps, ops_agree};
use crate::schema::{Schema, builtins};
use crate::seal::{ENVELOPE_SEAL, EpochKey, open};
use crate::segment::{BadSegment, Segment};
use crate::value::{of_loro, to_loro};
use crate::writer::writer;

/// Step 1's one branch.
pub const MAIN: &str = "main";

/// The root map Records sit in, flat by id (docs, rule 2). **Provisional: no Lean yet.**
pub const RECORDS: &str = "records";

/// The field holding a Record's type Doc, fixed at its birth.
pub const TYPE_FIELD: &str = "t";

/// Whether an envelope's signer may write it: caps' minimal checks implement this (the signer served the vault, the cap
/// chain is valid, live and covering, the epoch is fresh). Its verdict can turn by a later revocation.
pub trait Authorize {
    fn authorized(&self, genesis: &Genesis, e: &Envelope, body: &Body) -> bool;
}

impl<F: Fn(&Envelope, &Body) -> bool> Authorize for F {
    fn authorized(&self, _: &Genesis, e: &Envelope, body: &Body) -> bool {
        self(e, body)
    }
}

/// One Record at a version: its type Doc and its fields.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub r#type: DocId,
    pub fields: BTreeMap<String, Value>,
}

/// An immutable read of the live state, stamped with its version: the tips of what counts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Snapshot {
    pub version: Vec<Hash>,
    pub records: BTreeMap<String, Record>,
}

/// The change feed, one entry per new version.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Feed {
    /// An envelope counted: what it did to the Records.
    Counted {
        envelope: Hash,
        changes: Vec<RecordChange>,
    },
    /// A verdict turned, and the state was rebuilt from what still counts: read the snapshot again.
    Rebuilt,
}

/// A peer's own record of what it holds of a Doc: each log's newest counted envelope (docs, "The head"). It never
/// travels. **Provisional: no Lean yet** for its CBOR.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Head {
    pub doc: DocId,
    pub logs: BTreeMap<u64, Hash>,
}

impl Head {
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("doc".into(), self.doc.0.value()),
            (
                "branches".into(),
                Value::Map(vec![(
                    MAIN.into(),
                    Value::Map(vec![(
                        "logs".into(),
                        Value::Array(
                            self.logs
                                .iter()
                                .map(|(w, h)| Value::Array(vec![Value::Uint(*w), h.value()]))
                                .collect(),
                        ),
                    )]),
                )]),
            ),
        ])
    }
}

/// Why an envelope is refused before it is held. A refused envelope is no proof of anything.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refused {
    /// Past a limit, before or after decoding.
    Limits,
    /// Not the one encoding of an envelope with a docs body, or not sealed for this Doc.
    Form,
    /// Another Doc or branch.
    Doc,
    Signature,
    /// Its writer id isn't `writer(signer, doc, branch, generation)`.
    Writer,
    /// Its `seq`, `prev` or counters don't continue its log.
    Log,
    /// Rule 7: its op ids and hashes disagree, or an op id is used twice.
    OpIds,
    /// Its Loro update doesn't decode, or holds another writer's ops or other counters than it says.
    Loro,
}

/// Why an envelope held doesn't count.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Why {
    Split,
    Unauthorized,
    Unfit(Unfit),
    /// Something it builds on doesn't count.
    Past,
}

/// What an import did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Imported {
    Counts,
    /// Held already.
    Known,
    /// It names what isn't held yet; it is kept and tried again as more arrives.
    Waits,
    NotCounted(Why),
}

/// Why a commit made nothing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CommitError {
    /// The batch changes nothing.
    Empty,
    /// A value Loro can't hold as a Core Value, or a write Loro refused.
    Value(String),
    /// The batch doesn't fit: a device never makes an unfit write.
    Unfit(Unfit),
    /// The writer's log is stuck or split: start the next generation.
    Stuck,
    /// It was refused or didn't count as its own reader judged it.
    NotCounted(String),
}

/// One Record's writes in a commit, under the schema version the app writes through.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordWrite {
    pub id: String,
    pub version: TypeId,
    pub set: Vec<(String, Value)>,
    pub unset: Vec<String>,
    /// The Record is removed.
    pub gone: bool,
}

/// What a commit says beside its changes: the cap it writes under, the revocations it acknowledges, the engine's
/// operation and its params (caps, "Checking").
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Act {
    pub cap: Option<Hash>,
    pub acks: Vec<Hash>,
    pub call: Option<Hash>,
    pub params: Option<Value>,
}

struct Held {
    e: Envelope,
    body: Body,
    name: Hash,
    authorized: bool,
    /// Judged once, when its past first counts; never again.
    fit: Option<Result<Vec<RecordChange>, Unfit>>,
}

impl Held {
    fn last(&self) -> OpId {
        (self.e.writer, self.body.to)
    }
}

/// A Doc as one peer holds it.
pub struct Doc {
    genesis: Genesis,
    id: DocId,
    limits: Limits,
    pinned: BTreeMap<TypeId, Schema>,
    held: Vec<Held>,
    by_name: BTreeMap<Hash, usize>,
    /// Each place of each log, `(writer, seq)`, and the names held there: more than one is a split.
    places: BTreeMap<(u64, u64), BTreeSet<Hash>>,
    waiting: Vec<Vec<u8>>,
    live: LoroDoc,
    counted: BTreeSet<Hash>,
    tips: BTreeSet<Hash>,
    head: Head,
    snapshot: Arc<Snapshot>,
    feed: Vec<Feed>,
}

fn fresh() -> LoroDoc {
    let d = LoroDoc::new();
    d.set_record_timestamp(false);
    d
}

fn records_root() -> ContainerID {
    ContainerID::new_root(RECORDS, ContainerType::Map)
}

fn frontiers(ops: &[OpId]) -> Option<Frontiers> {
    let ids = ops
        .iter()
        .map(|&(p, c)| Some(ID::new(p, i32::try_from(c).ok()?)))
        .collect::<Option<Vec<ID>>>()?;
    Some(Frontiers::from(ids))
}

/// The type Doc a Record carries, read from a state.
fn type_of(doc: &LoroDoc, id: &str) -> Option<DocId> {
    let Some(ValueOrContainer::Container(loro::Container::Map(m))) = doc.get_map(RECORDS).get(id)
    else {
        return None;
    };
    match m.get(TYPE_FIELD) {
        Some(ValueOrContainer::Value(LoroValue::Binary(b))) => {
            Some(DocId(Hash(b.as_slice().try_into().ok()?)))
        }
        _ => None,
    }
}

fn present(doc: &LoroDoc, id: &str) -> bool {
    matches!(
        doc.get_map(RECORDS).get(id),
        Some(ValueOrContainer::Container(loro::Container::Map(_)))
    )
}

/// A Record read from a state, `None` when it isn't there or holds what no Record may.
fn record_of(doc: &LoroDoc, id: &str) -> Option<Record> {
    let Some(ValueOrContainer::Container(loro::Container::Map(m))) = doc.get_map(RECORDS).get(id)
    else {
        return None;
    };
    let LoroValue::Map(kvs) = m.get_deep_value() else {
        return None;
    };
    let mut fields = BTreeMap::new();
    let mut ty = None;
    for (k, v) in kvs.iter() {
        if k == TYPE_FIELD {
            if let LoroValue::Binary(b) = v {
                ty = Some(DocId(Hash(b.as_slice().try_into().ok()?)));
            }
        } else {
            fields.insert(k.clone(), of_loro(v)?);
        }
    }
    Some(Record {
        r#type: ty?,
        fields,
    })
}

/// Reads what an envelope's ops do to the Records (`changesOf`), from the state before it and after it.
fn changes_of(
    before: &LoroDoc,
    after: &LoroDoc,
    json: &[loro::JsonChange],
    body: &Body,
) -> Result<Vec<RecordChange>, Unfit> {
    struct Touch {
        t: Option<DocId>,
        fields: Vec<(String, Option<Value>)>,
    }
    let root = records_root();
    let mut touched: BTreeMap<String, Touch> = BTreeMap::new();
    let bad = |why: &str| Unfit::Op(why.into());
    for op in json.iter().flat_map(|c| &c.ops) {
        let JsonOpContent::Map(m) = &op.content else {
            return Err(bad("not a map op"));
        };
        if op.container == root {
            let key = match m {
                MapOp::Insert { key, .. } | MapOp::Delete { key } => key,
            };
            touched.entry(key.clone()).or_insert(Touch {
                t: None,
                fields: vec![],
            });
            continue;
        }
        let path = after
            .get_path_to_container(&op.container)
            .ok_or_else(|| bad("a container outside Records"))?;
        let [(r, _), (c, Index::Key(id))] = path.as_slice() else {
            return Err(bad("a container outside Records"));
        };
        if *r != root || *c != op.container || op.container.container_type() != ContainerType::Map {
            return Err(bad("a container outside Records"));
        }
        let t = touched.entry(id.to_string()).or_insert(Touch {
            t: None,
            fields: vec![],
        });
        match m {
            MapOp::Insert { key, value } if key == TYPE_FIELD => match value {
                LoroValue::Binary(b) if t.t.is_none() => {
                    t.t = Some(DocId(Hash(
                        b.as_slice()
                            .try_into()
                            .map_err(|_| bad("a type that isn't a Doc"))?,
                    )));
                }
                _ => return Err(bad("a Record's type written twice, or not a Doc")),
            },
            MapOp::Delete { key } if key == TYPE_FIELD => {
                return Err(bad("a Record's type removed"));
            }
            MapOp::Insert { key, value } => {
                let v = of_loro(value).ok_or_else(|| bad("a value that isn't a Core Value"))?;
                t.fields.retain(|f| f.0 != *key);
                t.fields.push((key.clone(), Some(v)));
            }
            MapOp::Delete { key } => {
                t.fields.retain(|f| f.0 != *key);
                t.fields.push((key.clone(), None));
            }
        }
    }
    let named: BTreeMap<&str, &TypeId> =
        body.records.iter().map(|(i, t)| (i.as_str(), t)).collect();
    let mut out = Vec::new();
    for (id, t) in touched {
        let was = type_of(before, &id);
        let (kind, ty) = match (was, present(after, &id), t.t) {
            (None, true, Some(ty)) => (ChangeKind::New, ty),
            (Some(ty), true, None) => (ChangeKind::Edited, ty),
            (Some(ty), false, None) => (ChangeKind::Gone, ty),
            _ => {
                return Err(bad(
                    "a Record's type set after its birth, or a Record born without one",
                ));
            }
        };
        let version = **named.get(id.as_str()).ok_or(Unfit::Records)?;
        if version.r#type != ty {
            return Err(Unfit::Version(id));
        }
        let fields = if kind == ChangeKind::Gone {
            vec![]
        } else {
            t.fields
        };
        out.push(RecordChange {
            id,
            r#type: version,
            kind,
            fields,
        });
    }
    Ok(out)
}

impl Doc {
    /// Opens a Doc from its genesis, with the schema of every version it pins (the built-in types are pinned
    /// without asking). `None` when the genesis doesn't verify or a pinned schema is missing.
    pub fn open(genesis: Genesis, schemas: &[Schema], limits: Limits) -> Option<Doc> {
        if !genesis.valid(&Ed25519) {
            return None;
        }
        let mut pinned: BTreeMap<TypeId, Schema> = builtins().into_iter().collect();
        for p in &genesis.pins {
            let s = schemas.iter().find(|s| s.hash() == p.schema)?;
            pinned.insert(*p, s.clone());
        }
        let id = genesis.id();
        Some(Doc {
            genesis,
            id,
            limits,
            pinned,
            held: vec![],
            by_name: BTreeMap::new(),
            places: BTreeMap::new(),
            waiting: vec![],
            live: fresh(),
            counted: BTreeSet::new(),
            tips: BTreeSet::new(),
            head: Head {
                doc: id,
                logs: BTreeMap::new(),
            },
            snapshot: Arc::new(Snapshot::default()),
            feed: vec![],
        })
    }

    pub fn id(&self) -> DocId {
        self.id
    }

    pub fn genesis(&self) -> &Genesis {
        &self.genesis
    }

    pub fn head(&self) -> &Head {
        &self.head
    }

    /// The newest immutable read. Readers keep it as long as they like; the committer never waits on them.
    pub fn snapshot(&self) -> Arc<Snapshot> {
        self.snapshot.clone()
    }

    /// The change feed from entry `from` on.
    pub fn feed(&self, from: usize) -> &[Feed] {
        self.feed.get(from..).unwrap_or(&[])
    }

    /// Whether an envelope held counts.
    pub fn counts(&self, name: &Hash) -> bool {
        self.counted.contains(name)
    }

    /// The envelopes held, counted or not, in the order they were held.
    pub fn envelopes(&self) -> impl Iterator<Item = &Envelope> {
        self.held.iter().map(|h| &h.e)
    }

    /// How many envelopes wait for what they name.
    pub fn waiting(&self) -> usize {
        self.waiting.len()
    }

    /// Imports a loose envelope sealed under one of the Doc's epochs.
    pub fn import_sealed(
        &mut self,
        sealed: &[u8],
        epoch: &EpochKey,
        auth: &impl Authorize,
    ) -> Result<Imported, Refused> {
        let limit = self.limits.sealed + self.limits.sealed / 8 + 256;
        let (doc, bytes) = open(ENVELOPE_SEAL, epoch, sealed, limit).ok_or(Refused::Form)?;
        if doc != self.id {
            return Err(Refused::Doc);
        }
        self.import(&bytes, auth)
    }

    /// Imports a writer's sealed segment: each of its envelopes, in order, through every check an envelope gets.
    pub fn import_segment(
        &mut self,
        sealed: &[u8],
        epoch: &EpochKey,
        auth: &impl Authorize,
    ) -> Result<Vec<Result<Imported, Refused>>, BadSegment> {
        let (s, _) = Segment::open(sealed, &self.id, epoch, &self.limits)?;
        Ok(s.envelopes.iter().map(|e| self.import(e, auth)).collect())
    }

    /// Imports one envelope's bytes, then whatever waited on it.
    pub fn import(&mut self, bytes: &[u8], auth: &impl Authorize) -> Result<Imported, Refused> {
        let r = self.import_one(bytes, auth)?;
        if matches!(r, Imported::Counts | Imported::NotCounted(_)) {
            loop {
                let before = self.waiting.len();
                for w in std::mem::take(&mut self.waiting) {
                    // a refusal now is final: the bytes are dropped
                    let _ = self.import_one(&w, auth);
                }
                if self.waiting.len() >= before {
                    break;
                }
            }
        }
        Ok(r)
    }

    fn import_one(&mut self, bytes: &[u8], auth: &impl Authorize) -> Result<Imported, Refused> {
        // 1. limits on the bytes, before anything is decoded
        if bytes.len() > self.limits.sealed {
            return Err(Refused::Limits);
        }
        // 3. strict decoding, the device's signature
        let e = Envelope::decode(bytes).ok_or(Refused::Form)?;
        if e.encode() != bytes {
            return Err(Refused::Form);
        }
        let body = Body::of_value(&e.body).ok_or(Refused::Form)?;
        if e.doc != self.id || e.branch != MAIN {
            return Err(Refused::Doc);
        }
        let name = e.name();
        if self.by_name.contains_key(&name) {
            return Ok(Imported::Known);
        }
        if !e.valid(&Ed25519) {
            return Err(Refused::Signature);
        }
        let ops = body.to - body.from + 1;
        if !self.limits.admits(
            &e.body,
            e.deps.len(),
            body.records.len(),
            usize::try_from(ops).unwrap_or(usize::MAX),
        ) || body.changes.len() > self.limits.sealed
        {
            return Err(Refused::Limits);
        }
        // 5. the writer id and its log
        if e.writer != writer(&e.signer, &e.doc, &e.branch, body.generation) {
            return Err(Refused::Writer);
        }
        if (e.seq == 1) != e.prev.is_none() || e.seq == 0 {
            return Err(Refused::Log);
        }
        // 6. everything it names is here, else it waits
        let named: Vec<Hash> = e.prev.iter().chain(&e.deps).copied().collect();
        if named.iter().any(|n| !self.by_name.contains_key(n)) {
            if !self.waiting.iter().any(|w| w == bytes) {
                self.waiting.push(bytes.to_vec());
            }
            return Ok(Imported::Waits);
        }
        let from = match e.prev {
            None => 0,
            Some(p) => {
                let p = &self.held[self.by_name[&p]];
                if p.e.writer != e.writer
                    || p.e.seq + 1 != e.seq
                    || p.body.generation != body.generation
                {
                    return Err(Refused::Log);
                }
                p.body.to + 1
            }
        };
        if body.from != from
            || e.deps
                .iter()
                .any(|d| self.held[self.by_name[d]].e.writer == e.writer)
        {
            return Err(Refused::Log);
        }
        // 8. Loro, from the update's metadata, before Loro imports anything
        let meta =
            LoroDoc::decode_import_blob_meta(&body.changes, true).map_err(|_| Refused::Loro)?;
        let one = |vv: &loro::VersionVector, at: u64| {
            vv.iter().count() == 1
                && vv
                    .get(&e.writer)
                    .is_some_and(|c| u64::try_from(*c).ok() == Some(at))
        };
        if !one(&meta.partial_start_vv, body.from) || !one(&meta.partial_end_vv, body.to + 1) {
            return Err(Refused::Loro);
        }
        let frontier: Vec<OpId> = meta
            .start_frontiers
            .iter()
            .map(|id| (id.peer, id.counter as u64))
            .collect();
        let carried = carried_deps(&frontier, e.writer, body.from).ok_or(Refused::OpIds)?;
        let held: Vec<(Hash, OpId)> = named
            .iter()
            .map(|n| (*n, self.held[self.by_name[n]].last()))
            .collect();
        let last = (e.writer, body.to);
        if self
            .held
            .iter()
            .any(|h| h.last() == last && h.e.seq != e.seq)
        {
            return Err(Refused::OpIds);
        }
        match ops_agree(&held, last, &named, &carried) {
            OpsVerdict::Agrees => {}
            OpsVerdict::Waits => return Ok(Imported::Waits),
            OpsVerdict::Disagree | OpsVerdict::UsedTwice => return Err(Refused::OpIds),
        }
        // 7. authority, by caps
        let authorized = auth.authorized(&self.genesis, &e, &body);
        // held: from here on it is a proof, split or not
        let place = (e.writer, e.seq);
        let split = self.places.get(&place).is_some_and(|ns| !ns.is_empty());
        self.places.entry(place).or_default().insert(name);
        self.by_name.insert(name, self.held.len());
        self.held.push(Held {
            e,
            body,
            name,
            authorized,
            fit: None,
        });
        if split {
            self.rebuild();
            return Ok(Imported::NotCounted(Why::Split));
        }
        let i = self.held.len() - 1;
        Ok(match self.count(i) {
            None => Imported::Counts,
            Some(why) => Imported::NotCounted(why),
        })
    }

    /// Whether a held envelope's place in its log is half of a split.
    fn is_split(&self, h: &Held) -> bool {
        self.places
            .get(&(h.e.writer, h.e.seq))
            .is_some_and(|ns| ns.len() > 1)
    }

    /// Decides whether held envelope `i` counts against the live state, and when it does, imports it there. `None`
    /// when it counts.
    fn count(&mut self, i: usize) -> Option<Why> {
        let h = &self.held[i];
        if self.is_split(h) {
            return Some(Why::Split);
        }
        if h.e
            .prev
            .iter()
            .chain(&h.e.deps)
            .any(|n| !self.counted.contains(n))
        {
            return Some(Why::Past);
        }
        if !h.authorized {
            return Some(Why::Unauthorized);
        }
        if self.held[i].fit.is_none() {
            let v = self.judge(i);
            self.held[i].fit = Some(v);
        }
        let changes = match self.held[i].fit.as_ref().expect("judged") {
            Ok(cs) => cs.clone(),
            Err(u) => return Some(Why::Unfit(u.clone())),
        };
        let h = &self.held[i];
        if self.live.import(&h.body.changes).is_err() {
            // its past is in the live state and it fits on a copy at its past, so Loro takes it
            return Some(Why::Unfit(Unfit::Op("Loro refused it".into())));
        }
        let (name, writer) = (h.name, h.e.writer);
        let parents: Vec<Hash> = h.e.prev.iter().chain(&h.e.deps).copied().collect();
        self.counted.insert(name);
        for p in parents {
            self.tips.remove(&p);
        }
        self.tips.insert(name);
        self.head.logs.insert(writer, name);
        let mut s = (*self.snapshot).clone();
        s.version = self.tips.iter().copied().collect();
        for c in &changes {
            match record_of(&self.live, &c.id) {
                Some(r) => s.records.insert(c.id.clone(), r),
                None => s.records.remove(&c.id),
            };
        }
        self.snapshot = Arc::new(s);
        self.feed.push(Feed::Counted {
            envelope: name,
            changes,
        });
        None
    }

    /// Fit, judged once (rule 15): on a scratch copy holding the envelope, read at exactly its dependencies and at
    /// itself, the ops it carries against the schemas it names. Its past counts, so the live state holds it.
    fn judge(&self, i: usize) -> Result<Vec<RecordChange>, Unfit> {
        let h = &self.held[i];
        let past: Vec<OpId> =
            h.e.prev
                .iter()
                .chain(&h.e.deps)
                .map(|n| self.held[self.by_name[n]].last())
                .collect();
        let at = frontiers(&past).ok_or_else(|| Unfit::Op("counters past Loro's".into()))?;
        self.judge_at(&at, h.e.writer, &h.body)
    }

    fn judge_at(
        &self,
        past: &Frontiers,
        writer: u64,
        body: &Body,
    ) -> Result<Vec<RecordChange>, Unfit> {
        // Loro may panic on bytes it should have refused; on a scratch copy that is one envelope unfit, never a crash
        // and never a touched live state
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            self.judge_scratch(past, writer, body)
        }))
        .unwrap_or_else(|_| Err(Unfit::Op("Loro panicked on it".into())))
    }

    fn judge_scratch(
        &self,
        past: &Frontiers,
        writer: u64,
        body: &Body,
    ) -> Result<Vec<RecordChange>, Unfit> {
        let loro = |_| Unfit::Op("Loro refused it".into());
        let end =
            i32::try_from(body.to + 1).map_err(|_| Unfit::Op("counters past Loro's".into()))?;
        let scratch = self.live.fork();
        scratch.set_record_timestamp(false);
        scratch.import(&body.changes).map_err(loro)?;
        let json = scratch.export_json_in_id_span(IdSpan::new(writer, body.from as i32, end));
        let message = body.message();
        if json
            .iter()
            .any(|c| c.msg.as_deref() != Some(message.as_str()))
            || json.iter().map(|c| c.ops.len()).sum::<usize>() > self.limits.ops
        {
            return Err(Unfit::Op("its message isn't its Records' hash".into()));
        }
        let before = scratch.fork_at(past).map_err(loro)?;
        let after = scratch
            .fork_at(&Frontiers::from(vec![ID::new(writer, end - 1)]))
            .map_err(loro)?;
        let changes = changes_of(&before, &after, &json, body)?;
        if changes.len() > self.limits.records {
            return Err(Unfit::Records);
        }
        fit(&changes, &body.records, &self.pinned, &self.limits)?;
        Ok(changes)
    }

    /// Rebuilds the live state from the envelopes that still count, in the order they were held (rule 13).
    fn rebuild(&mut self) {
        self.live = fresh();
        self.counted.clear();
        self.tips.clear();
        self.head.logs.clear();
        self.snapshot = Arc::new(Snapshot::default());
        let feed = self.feed.len();
        for i in 0..self.held.len() {
            let _ = self.count(i);
        }
        self.feed.truncate(feed);
        self.feed.push(Feed::Rebuilt);
    }

    /// Asks caps again whether each envelope held is authorized, after a revocation. A verdict that turns rebuilds the
    /// live state; a revocation only narrows (`revocation_narrows`).
    pub fn reauthorize(&mut self, auth: &impl Authorize) {
        let mut turned = false;
        for h in &mut self.held {
            let a = h.authorized && auth.authorized(&self.genesis, &h.e, &h.body);
            turned |= a != h.authorized;
            h.authorized = a;
        }
        if turned {
            self.rebuild();
        }
    }

    /// The writer id `device` writes main as, in `generation`.
    pub fn writer_of(&self, device: &Device, generation: u64) -> u64 {
        writer(&device.public(), &self.id, MAIN, generation)
    }

    /// A local write: one batch of Record writes, as one envelope (docs, "A commit"). Returns the envelope's bytes,
    /// already counted here, to put in the store and hand to sync.
    pub fn commit(
        &mut self,
        device: &Device,
        generation: u64,
        batch: &[RecordWrite],
        at: &str,
        act: Act,
        auth: &impl Authorize,
    ) -> Result<Vec<u8>, CommitError> {
        let w = self.writer_of(device, generation);
        let own = self
            .held
            .iter()
            .filter(|h| h.e.writer == w)
            .max_by_key(|h| h.e.seq);
        let (seq, prev, from) = match own {
            None => (1, None, 0),
            Some(h) if self.counted.contains(&h.name) && !self.is_split(h) => {
                (h.e.seq + 1, Some(h.name), h.body.to + 1)
            }
            Some(_) => return Err(CommitError::Stuck),
        };
        let scratch = self.live.fork();
        scratch.set_record_timestamp(false);
        scratch
            .set_peer_id(w)
            .map_err(|e| CommitError::Value(e.to_string()))?;
        let root = scratch.get_map(RECORDS);
        let loro = |e: loro::LoroError| CommitError::Value(e.to_string());
        let mut records: Vec<(String, TypeId)> = Vec::new();
        for r in batch {
            if r.gone {
                root.delete(&r.id).map_err(loro)?;
            } else {
                let m = root.ensure_mergeable_map(&r.id).map_err(loro)?;
                if type_of(&self.live, &r.id).is_none() {
                    m.insert(
                        TYPE_FIELD,
                        LoroValue::Binary(r.version.r#type.0.0.to_vec().into()),
                    )
                    .map_err(loro)?;
                }
                for (k, v) in &r.set {
                    if k == TYPE_FIELD {
                        return Err(CommitError::Value(k.clone()));
                    }
                    m.insert(k, to_loro(v).ok_or_else(|| CommitError::Value(k.clone()))?)
                        .map_err(loro)?;
                }
                for k in &r.unset {
                    m.delete(k).map_err(loro)?;
                }
            }
            records.retain(|x| x.0 != r.id);
            records.push((r.id.clone(), r.version));
        }
        records.sort_by(|a, b| a.0.len().cmp(&b.0.len()).then_with(|| a.0.cmp(&b.0)));
        let mut body = Body {
            generation,
            from,
            to: from,
            records,
            changes: vec![],
            at: at.into(),
            cap: act.cap,
            acks: act.acks,
            call: act.call,
            params: act.params.unwrap_or(Value::Null),
        };
        scratch.set_next_commit_message(&body.message());
        scratch.commit();
        let end = scratch.oplog_vv().get(&w).copied().unwrap_or(0) as u64;
        if end <= from {
            return Err(CommitError::Empty);
        }
        body.to = end - 1;
        let span = IdSpan::new(w, from as i32, end as i32);
        body.changes = scratch
            .export(ExportMode::updates_in_range(vec![span]))
            .map_err(|e| CommitError::Value(e.to_string()))?;
        let json = scratch.export_json_in_id_span(span);
        let frontier: Vec<OpId> = json
            .first()
            .map(|c| c.deps.iter().map(|d| (d.peer, d.counter as u64)).collect())
            .unwrap_or_default();
        let carried = carried_deps(&frontier, w, from).ok_or(CommitError::Stuck)?;
        let by_last: BTreeMap<OpId, Hash> = self
            .held
            .iter()
            .filter(|h| self.counted.contains(&h.name))
            .map(|h| (h.last(), h.name))
            .collect();
        let deps = carried
            .iter()
            .filter(|o| o.0 != w)
            .map(|o| {
                by_last
                    .get(o)
                    .copied()
                    .ok_or_else(|| CommitError::NotCounted("a dependency isn't counted".into()))
            })
            .collect::<Result<Vec<Hash>, _>>()?;
        // fit, before anything is signed
        let past = frontiers(&carried).ok_or(CommitError::Stuck)?;
        self.judge_at(&past, w, &body).map_err(CommitError::Unfit)?;
        let mut e = Envelope {
            doc: self.id,
            branch: MAIN.into(),
            writer: w,
            seq,
            prev,
            deps,
            body: body.value(),
            signer: device.public().to_vec(),
            sig: vec![],
        };
        e.sig = device.sign(&e.signing()).to_vec();
        let bytes = e.encode();
        match self.import(&bytes, auth) {
            Ok(Imported::Counts) => Ok(bytes),
            other => Err(CommitError::NotCounted(format!("{other:?}"))),
        }
    }
}

/// Checks a Core envelope's Ed25519 signature: what a single envelope is signed with.
pub fn envelope_valid(e: &Envelope) -> bool {
    Ed25519.verify(&e.signer, &e.signing(), &e.sig)
}
