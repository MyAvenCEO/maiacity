//! A Doc: its genesis, its envelopes, and the live Loro state of what counts (docs, "A Doc", "Importing: three
//! verdicts", "What the engine and actors build on"). Step 1 holds one branch, `main`. Its formats are the Lean's:
//! `Aven.DB.Docs.Genesis`, `Body`, `Head`, and rule 7 on Loro commits (`loroAgrees`).
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

use aven_core::{DocId, Envelope, Hash, Value, Verify};
use loro::json::{JsonOpContent, MapOp};
use loro::{
    ContainerID, ContainerType, ExportMode, Frontiers, ID, IdSpan, Index, LoroDoc, LoroValue,
    ValueOrContainer,
};

use crate::body::{Body, Call, Version, codec_order};
use crate::builtins::{BuiltinFit, DocsBuiltins};
use crate::device::{Device, Ed25519};
use crate::fit::Rules;
use crate::fit::{ChangeKind, RecordChange, Unfit, fit};
use crate::genesis::Genesis;
use crate::limits::Limits;
use crate::opids::{OpId, OpsVerdict, carried_deps, ops_agree};
use crate::schema::{Schema, is_builtin};
use crate::seal::{EpochKey, Seals, open};
use crate::segment::{BadSegment, Segment};
use crate::value::{of_loro, to_loro};
use crate::writer::writer;

/// Step 1's one branch.
pub const MAIN: &str = "main";

/// The root map Records sit in, flat by id (docs, rule 2; `Aven.DB.Docs.recordsRoot`).
pub const RECORDS: &str = "records";

/// The field holding a Record's type Doc, fixed at its birth.
pub const TYPE_FIELD: &str = "t";

/// Whether an envelope's signer may write it: caps' minimal checks implement this (the signer served the vault, the cap
/// chain is valid, live and covering, the epoch is fresh). Its verdict can turn by a later revocation.
pub trait Authorize {
    /// Step 4: the signer's chain reaches this Doc at all: the device served a vault that holds some grant on it. A
    /// stranger's envelope is refused here, before any of its bytes reaches Loro, and is never held.
    fn reaches(&self, genesis: &Genesis, signer: &[u8]) -> bool;

    /// Step 7: the cap chain is valid, live and covering, judged against the envelope's own past, so every reader
    /// reaches the same verdict whatever order it imported in. This verdict can turn by a later revocation.
    fn authorized(&self, genesis: &Genesis, e: &Envelope, body: &Body, past: &Past<'_>) -> bool;
}

/// An envelope's past as a reader holds it: every held envelope it reaches through `prev` and `deps`, in the order
/// they were held, each with its name and body. Import holds the whole past before it asks (step 6), so every reader
/// sees the same past. Whether those envelopes count is decided after: if any doesn't, neither does this one, so a
/// verdict on the past only matters where all of it counts.
pub struct Past<'a> {
    items: Vec<(Hash, &'a Envelope, &'a Body)>,
}

impl<'a> Past<'a> {
    pub fn iter(&self) -> impl Iterator<Item = (Hash, &'a Envelope, &'a Body)> + '_ {
        self.items.iter().copied()
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn contains(&self, name: &Hash) -> bool {
        self.items.iter().any(|x| x.0 == *name)
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

impl Snapshot {
    /// A type Doc's versions (A39, A207): each `schema` Record's schema, by its hash. They are built-ins, so
    /// write-once, and two with one hash hold one schema (`pin_resolves_one`).
    pub fn versions(&self) -> BTreeMap<Hash, Schema> {
        let version = crate::schema::builtin_type("schema");
        self.records
            .values()
            .filter(|r| r.r#type == version)
            .filter_map(|r| Schema::of_value(r.fields.get("schema")?))
            .map(|s| (s.hash(), s))
            .collect()
    }
}

/// Why a Doc doesn't open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unopenable {
    /// The genesis isn't well formed (`Genesis::ok`): a built-in type pinned, or pins out of order.
    Genesis,
    /// A pin resolves to no version of its type Doc, by name.
    Pin { r#type: DocId, schema: Hash },
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
/// travels (`Aven.DB.Docs.Head`, held to `heads.json`).
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
    /// Its signer's chain doesn't reach this Doc: a stranger, refused before Loro sees a byte.
    Stranger,
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
    /// The Doc moved on between prepare and finish: prepare again.
    Moved,
}

/// One Record's writes in a commit, under the schema version the app writes through.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordWrite {
    pub id: String,
    pub version: Version,
    pub set: Vec<(String, Value)>,
    pub unset: Vec<String>,
    /// The Record is removed.
    pub gone: bool,
}

/// What a commit says beside its changes: the cap it writes under, the revocations it acknowledges, the engine's
/// operations it ran (caps, "Checking"; A32).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Act {
    pub cap: Option<Hash>,
    pub acks: Vec<Hash>,
    pub calls: Vec<Call>,
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
        (self.e.writer, self.body.to - 1)
    }
}

/// A Doc as one peer holds it.
pub struct Doc {
    genesis: Genesis,
    id: DocId,
    limits: Limits,
    rules: Rules,
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
    /// Envelopes the caller marked unfit: the judge crashed on them alone.
    crashed: BTreeSet<Hash>,
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

/// Reads what an envelope's ops do to the Records (`changesOf`), on a scratch copy holding its ops: checked out at
/// the envelope itself to read where each op lands, then at its dependencies to read what was there before.
fn changes_of(
    scratch: &LoroDoc,
    past: &Frontiers,
    at: &Frontiers,
    json: &[loro::JsonChange],
    body: &Body,
) -> Result<Vec<RecordChange>, Unfit> {
    struct Touch {
        t: Option<DocId>,
        fields: Vec<(String, Option<Value>)>,
    }
    let loro = |_| Unfit::Op("its version isn't in the scratch copy".into());
    scratch.checkout(at).map_err(loro)?;
    let after = scratch;
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
    let named: BTreeMap<&str, &Version> =
        body.records.iter().map(|(i, t)| (i.as_str(), t)).collect();
    let present_after: Vec<bool> = touched.keys().map(|id| present(after, id)).collect();
    scratch.checkout(past).map_err(loro)?;
    let mut out = Vec::new();
    for ((id, t), now) in touched.into_iter().zip(present_after) {
        let was = type_of(scratch, &id);
        let (kind, ty) = match (was, now, t.t) {
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

/// One item of a page as catch-up fetches it: a loose envelope or a segment, sealed or, for the keyring alone, plain.
#[derive(Clone, Copy, Debug)]
pub enum Item<'a> {
    /// Sealed under one of the Doc's epochs: what it seals is found by its commitment.
    Sealed(&'a [u8]),
    /// Unsealed (A187): the keyring Doc's envelope, Core's encoding, or segment, its hybrid-signed bytes. Its Records are
    /// already ciphertext, so it travels as it is; every other Doc's items are sealed.
    Plain(&'a [u8]),
}

/// Whether a Doc's items travel plain: its genesis types it avenID's `keyring` (A187, A209).
pub fn travels_plain(genesis: &Genesis) -> bool {
    genesis.root == aven_id::caps::builtin_type("keyring")
}

/// Opens a page as catch-up fetches it, loose envelopes and segments mixed, without a [`Doc`]: what holds the epoch
/// keys opens, and only plaintext envelopes go on to be imported.
///
/// - **Sealed:** a keeper serves sealed things by hash and the reader doesn't know what each seals (it is in the AAD,
///   D13), so each is opened under its epoch's key (found by the epoch its outside names) as what its commitment says
///   it seals ([`crate::seal::seals_of`], `Aven.ID.Seal.seals_by_commit`), checked before anything is decrypted.
/// - **Plain:** only for the keyring ([`travels_plain`]): an envelope if Core reads it as one, else a segment, checked
///   as a sealed one is once opened. Either is the page's Doc's.
///
/// Per item, its envelopes' bytes in order (a segment's flattened), or why it didn't open.
pub fn open_page<'k>(
    genesis: &Genesis,
    items: &[Item<'_>],
    epochs: impl Fn(&Hash) -> Option<&'k EpochKey>,
    limits: &Limits,
) -> Vec<Result<Vec<Vec<u8>>, Unopened>> {
    let doc = genesis.id();
    let plain = travels_plain(genesis);
    let limit = crate::seal::sealed_limit(limits.sealed);
    let seg_limit = crate::seal::sealed_limit(limits.segment_bytes);
    items
        .iter()
        .map(|item| match *item {
            Item::Plain(_) if !plain => Err(Unopened::Plain),
            Item::Plain(b) => match Envelope::decode(b) {
                Some(e) if b.len() <= limits.sealed => {
                    if e.doc == doc {
                        Ok(vec![b.to_vec()])
                    } else {
                        Err(Unopened::Doc)
                    }
                }
                Some(_) => Err(Unopened::Form),
                None => Segment::open_plain(b, &doc, limits)
                    .map(|(s, _)| s.envelopes)
                    .map_err(Unopened::Segment),
            },
            Item::Sealed(b) => {
                let out = crate::seal::outside(b, limit.max(seg_limit)).ok_or(Unopened::Form)?;
                if out.doc != doc {
                    return Err(Unopened::Doc);
                }
                let epoch = epochs(&out.epoch).ok_or(Unopened::Epoch(out.epoch))?;
                match crate::seal::seals_of(epoch, b, limit.max(seg_limit)) {
                    Some(Seals::Envelope) => match open(Seals::Envelope, epoch, b, limit) {
                        Some((d, pt)) if d == doc => Ok(vec![pt]),
                        _ => Err(Unopened::Seal),
                    },
                    Some(Seals::Segment) => Segment::open(b, &doc, epoch, limits)
                        .map(|(s, _)| s.envelopes)
                        .map_err(Unopened::Segment),
                    Some(Seals::Checkpoint) | None => Err(Unopened::Seal),
                }
            }
        })
        .collect()
}

/// Why an item of a page didn't open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unopened {
    /// Not a sealed thing, or a plain envelope or segment, within the limits.
    Form,
    /// Another Doc's.
    Doc,
    /// An epoch the reader holds no key for.
    Epoch(Hash),
    /// No commitment matches under its epoch's key (a checkpoint is no page's), or it doesn't open as what its
    /// commitment says it seals.
    Seal,
    Segment(BadSegment),
    /// Plain, for a Doc whose items travel sealed: every Doc but the keyring (A187).
    Plain,
}

/// What steps 1 to 8 made of an envelope: held (with whether it is half of a split), or a verdict already.
enum Checked {
    Held(usize, bool),
    Done(Imported),
}

/// Fit, judged once (rule 15), on a scratch copy holding the envelope's past: its ops imported, read at its own
/// version and at its dependencies, against the schemas it names. Loro may panic on bytes it should have refused; on a
/// scratch copy, natively, that is one envelope unfit, never a crash and never a touched live state.
fn judge(
    scratch: &LoroDoc,
    h: &Held,
    held: &[Held],
    by_name: &BTreeMap<Hash, usize>,
    rules: &Rules,
    limits: &Limits,
) -> Result<Vec<RecordChange>, Unfit> {
    let past: Vec<OpId> =
        h.e.prev
            .iter()
            .chain(&h.e.deps)
            .map(|n| held[by_name[n]].last())
            .collect();
    let past = frontiers(&past).ok_or_else(|| Unfit::Op("counters past Loro's".into()))?;
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        scratch
            .import(&h.body.changes)
            .map_err(|_| Unfit::Op("Loro refused it".into()))?;
        let r = judge_on(scratch, &past, h.e.writer, &h.body, rules, limits);
        scratch.checkout_to_latest();
        r
    }))
    .unwrap_or_else(|_| Err(Unfit::Op("Loro panicked on it".into())))
}

/// The judge itself, on a scratch copy that holds the envelope's ops.
fn judge_on(
    scratch: &LoroDoc,
    past: &Frontiers,
    writer: u64,
    body: &Body,
    rules: &Rules,
    limits: &Limits,
) -> Result<Vec<RecordChange>, Unfit> {
    let end = i32::try_from(body.to).map_err(|_| Unfit::Op("counters past Loro's".into()))?;
    let json = scratch.export_json_in_id_span(IdSpan::new(writer, body.from as i32, end));
    let message = body.message();
    if json
        .iter()
        .any(|c| c.msg.as_deref() != Some(message.as_str()))
        || json.iter().map(|c| c.ops.len()).sum::<usize>() > limits.ops
    {
        return Err(Unfit::Op("its message isn't its Records' hash".into()));
    }
    let at = Frontiers::from(vec![ID::new(writer, end - 1)]);
    let changes = changes_of(scratch, past, &at, &json, body)?;
    if changes.len() > limits.records {
        return Err(Unfit::Records);
    }
    fit(&changes, &body.records, rules, limits)?;
    Ok(changes)
}

impl Doc {
    /// Opens a Doc from its genesis, reading every version it pins from its type Doc: `types` gives a type Doc's
    /// snapshot, and a pin `(type Doc, h)` resolves to the `schema` Record there whose schema hashes to `h`
    /// ([`Snapshot::versions`], `Aven.DB.Docs.pin_resolves_one`). The built-in types need no pin. The genesis carries
    /// no signature: the Doc's first envelope carries it, and that envelope's signature and cap authorize it.
    pub fn open(
        genesis: Genesis,
        types: impl Fn(&DocId) -> Option<Arc<Snapshot>>,
        limits: Limits,
    ) -> Result<Doc, Unopenable> {
        Doc::open_with(genesis, types, limits, Box::new(DocsBuiltins))
    }

    /// [`Doc::open`] with the built-in types' checks given: the docs layer's own, joined with avenID's once caps
    /// supplies them (`Either(DocsBuiltins, caps)`).
    pub fn open_with(
        genesis: Genesis,
        types: impl Fn(&DocId) -> Option<Arc<Snapshot>>,
        limits: Limits,
        builtins: Box<dyn BuiltinFit + Send + Sync>,
    ) -> Result<Doc, Unopenable> {
        if !genesis.ok(is_builtin) {
            return Err(Unopenable::Genesis);
        }
        let mut pinned: BTreeMap<Version, Schema> = BTreeMap::new();
        for (t, hs) in &genesis.pins {
            let versions = types(t).map(|s| s.versions()).unwrap_or_default();
            for h in hs {
                let s = versions.get(h).ok_or(Unopenable::Pin {
                    r#type: *t,
                    schema: *h,
                })?;
                pinned.insert(
                    Version {
                        r#type: *t,
                        schema: Some(*h),
                    },
                    s.clone(),
                );
            }
        }
        let id = genesis.id();
        Ok(Doc {
            genesis,
            id,
            limits,
            rules: Rules { pinned, builtins },
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
            crashed: BTreeSet::new(),
        })
    }

    /// Opens a Doc from its first envelope, which carries its genesis, and imports that envelope. `None` when the
    /// bytes carry no genesis of their Doc, or the first envelope doesn't import.
    pub fn from_first(
        bytes: &[u8],
        types: impl Fn(&DocId) -> Option<Arc<Snapshot>>,
        limits: Limits,
        auth: &impl Authorize,
    ) -> Option<Result<(Doc, Imported), Unopenable>> {
        let e = Envelope::decode(bytes)?;
        let g = Body::of_value(&e.body)?.genesis?;
        if g.id() != e.doc {
            return None;
        }
        let mut doc = match Doc::open(g, types, limits) {
            Ok(d) => d,
            Err(u) => return Some(Err(u)),
        };
        let r = doc.import(bytes, auth).ok()?;
        Some(Ok((doc, r)))
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
        let limit = crate::seal::sealed_limit(self.limits.sealed);
        let (doc, bytes) = open(Seals::Envelope, epoch, sealed, limit).ok_or(Refused::Form)?;
        if doc != self.id {
            return Err(Refused::Doc);
        }
        self.import(&bytes, auth)
    }

    /// Imports a writer's sealed segment as one page: each of its envelopes through every check an envelope gets.
    pub fn import_segment(
        &mut self,
        sealed: &[u8],
        epoch: &EpochKey,
        auth: &impl Authorize,
    ) -> Result<Vec<Result<Imported, Refused>>, BadSegment> {
        let (s, _) = Segment::open(sealed, &self.id, epoch, &self.limits)?;
        let page: Vec<&[u8]> = s.envelopes.iter().map(Vec::as_slice).collect();
        Ok(self.import_page(&page, auth))
    }

    /// Imports a page as catch-up fetches it, loose envelopes and segments mixed, sealed or (the keyring's) plain, in
    /// one batch: [`open_page`], then [`Doc::import_page`] over what opened (one judge, one `import_batch`, one
    /// snapshot). Per item, the results of its envelopes in order, or why it didn't open.
    pub fn import_items<'k>(
        &mut self,
        items: &[Item<'_>],
        epochs: impl Fn(&Hash) -> Option<&'k EpochKey>,
        auth: &impl Authorize,
    ) -> Vec<Result<Vec<Result<Imported, Refused>>, Unopened>> {
        let opened = open_page(&self.genesis, items, epochs, &self.limits);
        let page: Vec<&[u8]> = opened
            .iter()
            .flatten()
            .flatten()
            .map(Vec::as_slice)
            .collect();
        let mut results = self.import_page(&page, auth).into_iter();
        opened
            .into_iter()
            .map(|o| o.map(|envs| results.by_ref().take(envs.len()).collect()))
            .collect()
    }

    /// Imports one envelope's bytes, then whatever waited on it: a page of one.
    pub fn import(&mut self, bytes: &[u8], auth: &impl Authorize) -> Result<Imported, Refused> {
        self.import_page(&[bytes], auth)
            .pop()
            .expect("one result per envelope")
    }

    /// Imports a page of envelopes, then whatever waited on them (docs, "Imports go in a batch"). Every envelope is
    /// checked before any byte reaches Loro; the page is then judged on one scratch copy, and what counts enters the
    /// live state in one batch: one diff, one snapshot.
    pub fn import_page(
        &mut self,
        page: &[&[u8]],
        auth: &impl Authorize,
    ) -> Vec<Result<Imported, Refused>> {
        let mut results: Vec<Result<Imported, Refused>> = Vec::with_capacity(page.len());
        let mut fresh_held: Vec<(usize, Option<usize>)> = Vec::new();
        let mut split = false;
        for (k, bytes) in page.iter().enumerate() {
            match self.import_one(bytes, auth) {
                Ok(Checked::Held(i, sp)) => {
                    split |= sp;
                    fresh_held.push((i, Some(k)));
                    results.push(Ok(Imported::Counts));
                }
                Ok(Checked::Done(r)) => results.push(Ok(r)),
                Err(e) => results.push(Err(e)),
            }
        }
        // whatever waited and is now whole is held too, before anything is judged
        loop {
            let before = self.waiting.len();
            for w in std::mem::take(&mut self.waiting) {
                // a refusal now is final: the bytes are dropped; one of this page's own that waited takes its verdict
                let mine = page
                    .iter()
                    .position(|b| *b == w.as_slice())
                    .filter(|&k| results[k] == Ok(Imported::Waits));
                match self.import_one(&w, auth) {
                    Ok(Checked::Held(i, sp)) => {
                        split |= sp;
                        fresh_held.push((i, mine));
                    }
                    Err(e) => {
                        if let Some(k) = mine {
                            results[k] = Err(e);
                        }
                    }
                    Ok(Checked::Done(_)) => {}
                }
            }
            if self.waiting.len() >= before {
                break;
            }
        }
        let verdicts: BTreeMap<usize, Option<Why>> = if split {
            self.rebuild()
        } else {
            self.settle(fresh_held.iter().map(|x| x.0).collect())
        };
        for (i, k) in fresh_held {
            if let Some(k) = k {
                results[k] = Ok(match verdicts.get(&i).cloned().flatten() {
                    None if self.counted.contains(&self.held[i].name) => Imported::Counts,
                    None => Imported::NotCounted(Why::Past),
                    Some(why) => Imported::NotCounted(why),
                });
            }
        }
        results
    }

    /// Steps 1 to 8: everything checked before any byte reaches Loro. A held envelope is judged with its page.
    fn import_one(&mut self, bytes: &[u8], auth: &impl Authorize) -> Result<Checked, Refused> {
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
        // the genesis rides exactly in a log's first envelope, and is this Doc's (`genesis_iff_first`)
        let first = e.seq == 1 && e.prev.is_none() && e.deps.is_empty();
        if body.genesis.is_some() != first
            || body.genesis.as_ref().is_some_and(|g| *g != self.genesis)
        {
            return Err(Refused::Doc);
        }
        let name = e.name();
        if self.by_name.contains_key(&name) {
            return Ok(Checked::Done(Imported::Known));
        }
        // every signature beside it verifies, and one is by the device whose writer id it carries: that one places it
        // in its log (Core's `Envelope.placed`); the others are approvals
        if !envelope_valid(&e) {
            return Err(Refused::Signature);
        }
        let Some(signer) = e
            .sigs
            .iter()
            .map(|x| x.signer.clone())
            .find(|k| e.writer == writer(k, &e.doc, &e.branch, body.generation))
        else {
            return Err(Refused::Writer);
        };
        // 4. the signer's chain reaches this Doc: strangers never reach Loro
        if !auth.reaches(&self.genesis, &signer) {
            return Err(Refused::Stranger);
        }
        if body.to <= body.from {
            return Err(Refused::Form);
        }
        let ops = body.to - body.from;
        if !self.limits.admits(
            &e.body,
            e.deps.len(),
            body.records.len(),
            usize::try_from(ops).unwrap_or(usize::MAX),
        ) || body.changes.len() > self.limits.sealed
        {
            return Err(Refused::Limits);
        }
        // 5. the writer id (its signer's, above) and its log
        if (e.seq == 1) != e.prev.is_none() || e.seq == 0 {
            return Err(Refused::Log);
        }
        // 6. everything it names is here, else it waits
        let named: Vec<Hash> = e.prev.iter().chain(&e.deps).copied().collect();
        if named.iter().any(|n| !self.by_name.contains_key(n)) {
            if !self.waiting.iter().any(|w| w == bytes) {
                self.waiting.push(bytes.to_vec());
            }
            return Ok(Checked::Done(Imported::Waits));
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
                p.body.to
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
        if !one(&meta.partial_start_vv, body.from) || !one(&meta.partial_end_vv, body.to) {
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
        let last = (e.writer, body.to - 1);
        if self
            .held
            .iter()
            .any(|h| h.last() == last && h.e.seq != e.seq)
        {
            return Err(Refused::OpIds);
        }
        match ops_agree(&held, last, &named, &carried) {
            OpsVerdict::Agrees => {}
            OpsVerdict::Waits => return Ok(Checked::Done(Imported::Waits)),
            OpsVerdict::Disagree | OpsVerdict::UsedTwice => return Err(Refused::OpIds),
        }
        // 7. authority, by caps
        let authorized = {
            let past = self.past_of(e.prev.iter().chain(&e.deps));
            auth.authorized(&self.genesis, &e, &body, &past)
        };
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
        Ok(Checked::Held(self.held.len() - 1, split))
    }

    /// The held envelopes reached from `parents`, in the order held.
    fn past_of<'n>(&self, parents: impl Iterator<Item = &'n Hash>) -> Past<'_> {
        let mut seen: BTreeSet<usize> = BTreeSet::new();
        let mut todo: Vec<Hash> = parents.copied().collect();
        while let Some(n) = todo.pop() {
            if let Some(&i) = self.by_name.get(&n)
                && seen.insert(i)
            {
                todo.extend(
                    self.held[i]
                        .e
                        .prev
                        .iter()
                        .chain(&self.held[i].e.deps)
                        .copied(),
                );
            }
        }
        Past {
            items: seen
                .into_iter()
                .map(|i| (self.held[i].name, &self.held[i].e, &self.held[i].body))
                .collect(),
        }
    }

    /// Whether a held envelope's place in its log is half of a split.
    fn is_split(&self, h: &Held) -> bool {
        self.places
            .get(&(h.e.writer, h.e.seq))
            .is_some_and(|ns| ns.len() > 1)
    }

    /// Settles held envelopes, in the order given: each counts when it isn't half of a split, is authorized, its past
    /// counts, and it fits, judged once on one scratch copy for the whole page. What counts enters the live state in
    /// one batch. Returns why each that doesn't count doesn't (`None` when it counts).
    fn settle(&mut self, order: Vec<usize>) -> BTreeMap<usize, Option<Why>> {
        let mut out = BTreeMap::new();
        let mut accepted: Vec<usize> = Vec::new();
        let mut taken: BTreeSet<Hash> = BTreeSet::new();
        let mut scratch: Option<LoroDoc> = None;
        for i in order {
            let h = &self.held[i];
            let why = if self.is_split(h) {
                Some(Why::Split)
            } else if h
                .e
                .prev
                .iter()
                .chain(&h.e.deps)
                .any(|n| !self.counted.contains(n) && !taken.contains(n))
            {
                Some(Why::Past)
            } else if !h.authorized {
                Some(Why::Unauthorized)
            } else {
                if h.fit.is_none() && self.crashed.contains(&h.name) {
                    self.held[i].fit = Some(Err(Unfit::Op("the judge crashed on it".into())));
                } else if h.fit.is_none() {
                    let sc = scratch.get_or_insert_with(|| {
                        let sc = self.live.fork();
                        sc.set_record_timestamp(false);
                        // what this page already took, so later envelopes find their past
                        let _ = sc.import_batch(
                            &accepted
                                .iter()
                                .map(|&j| self.held[j].body.changes.clone())
                                .collect::<Vec<_>>(),
                        );
                        sc
                    });
                    let v = judge(
                        sc,
                        &self.held[i],
                        &self.held,
                        &self.by_name,
                        &self.rules,
                        &self.limits,
                    );
                    self.held[i].fit = Some(v);
                } else if let Some(sc) = &scratch {
                    let _ = sc.import(&self.held[i].body.changes);
                }
                match self.held[i].fit.as_ref().expect("judged") {
                    Ok(_) => None,
                    Err(u) => Some(Why::Unfit(u.clone())),
                }
            };
            if why.is_none() {
                accepted.push(i);
                taken.insert(self.held[i].name);
            }
            out.insert(i, why);
        }
        if accepted.is_empty() {
            return out;
        }
        let batch: Vec<Vec<u8>> = accepted
            .iter()
            .map(|&i| self.held[i].body.changes.clone())
            .collect();
        if self.live.import_batch(&batch).is_err() {
            // each fit on a copy of this state with its past, so Loro takes them; if it doesn't, nothing counts
            for &i in &accepted {
                out.insert(i, Some(Why::Unfit(Unfit::Op("Loro refused it".into()))));
            }
            return out;
        }
        let mut s = (*self.snapshot).clone();
        let mut ids: BTreeSet<String> = BTreeSet::new();
        for &i in &accepted {
            let h = &self.held[i];
            self.counted.insert(h.name);
            for p in h.e.prev.iter().chain(&h.e.deps) {
                self.tips.remove(p);
            }
            self.tips.insert(h.name);
            self.head.logs.insert(h.e.writer, h.name);
            let changes = h.fit.clone().expect("judged").expect("fits");
            ids.extend(changes.iter().map(|c| c.id.clone()));
            self.feed.push(Feed::Counted {
                envelope: h.name,
                changes,
            });
        }
        s.version = self.tips.iter().copied().collect();
        for id in ids {
            match record_of(&self.live, &id) {
                Some(r) => s.records.insert(id, r),
                None => s.records.remove(&id),
            };
        }
        self.snapshot = Arc::new(s);
        out
    }

    /// Rebuilds the live state from the envelopes that still count, in the order they were held (rule 13).
    fn rebuild(&mut self) -> BTreeMap<usize, Option<Why>> {
        self.live = fresh();
        self.counted.clear();
        self.tips.clear();
        self.head.logs.clear();
        self.snapshot = Arc::new(Snapshot::default());
        let feed = self.feed.len();
        let out = self.settle((0..self.held.len()).collect());
        self.feed.truncate(feed);
        self.feed.push(Feed::Rebuilt);
        out
    }

    /// Asks caps again whether each envelope held is authorized, after a revocation. A verdict that turns rebuilds the
    /// live state; a revocation only narrows (`revocation_narrows`).
    pub fn reauthorize(&mut self, auth: &impl Authorize) {
        let mut turned = false;
        let verdicts: Vec<bool> = (0..self.held.len())
            .map(|i| {
                let h = &self.held[i];
                let past = self.past_of(h.e.prev.iter().chain(&h.e.deps));
                h.authorized && auth.authorized(&self.genesis, &h.e, &h.body, &past)
            })
            .collect();
        for (h, a) in self.held.iter_mut().zip(verdicts) {
            turned |= a != h.authorized;
            h.authorized = a;
        }
        if turned {
            let _ = self.rebuild();
        }
    }

    /// The writer id `device` writes main as, in `generation`.
    pub fn writer_of(&self, device: &Device, generation: u64) -> u64 {
        writer(&device.public(), &self.id, MAIN, generation)
    }

    /// A local write: one batch of Record writes, as one envelope (docs, "A commit"), signed by `device`. Returns the
    /// envelope's bytes, already counted here, to put in the store and hand to sync. It is [`Doc::prepare`], the
    /// device's signature over [`Prepared::signing`], and [`Doc::finish`].
    pub fn commit(
        &mut self,
        device: &Device,
        generation: u64,
        batch: &[RecordWrite],
        at: &str,
        act: Act,
        auth: &impl Authorize,
    ) -> Result<Vec<u8>, CommitError> {
        let p = self.prepare(device.public(), generation, batch, at, act)?;
        let sig = device.sign(&p.signing());
        self.finish(p, sig, auth)
    }

    /// Everything a commit does before its signature, for a device whose key lives elsewhere (the Peer-Light keeps keys
    /// in a worker of their own): the scratch copy, fit, the op range, the body and the unsigned envelope. Nothing in
    /// the Doc changes until [`Doc::finish`].
    pub fn prepare(
        &self,
        signer: [u8; 32],
        generation: u64,
        batch: &[RecordWrite],
        at: &str,
        act: Act,
    ) -> Result<Prepared, CommitError> {
        let w = writer(&signer, &self.id, MAIN, generation);
        let own = self
            .held
            .iter()
            .filter(|h| h.e.writer == w)
            .max_by_key(|h| h.e.seq);
        let (seq, prev, from) = match own {
            None => (1, None, 0),
            Some(h) if self.counted.contains(&h.name) && !self.is_split(h) => {
                (h.e.seq + 1, Some(h.name), h.body.to)
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
        let mut records: Vec<(String, Version)> = Vec::new();
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
        records.sort_by(|a, b| codec_order(&a.0, &b.0));
        let mut body = Body {
            generation,
            from,
            to: from,
            records,
            changes: vec![],
            at: at.into(),
            cap: act.cap,
            acks: act.acks,
            calls: act.calls,
            genesis: None,
        };
        scratch.set_next_commit_message(&body.message());
        scratch.commit();
        let end = scratch.oplog_vv().get(&w).copied().unwrap_or(0) as u64;
        if end <= from {
            return Err(CommitError::Empty);
        }
        body.to = end;
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
        let judged = judge_on(&scratch, &past, w, &body, &self.rules, &self.limits);
        scratch.checkout_to_latest();
        judged.map_err(CommitError::Unfit)?;
        // the genesis rides exactly in a log's first envelope
        body.genesis = (seq == 1 && deps.is_empty()).then(|| self.genesis.clone());
        let e = Envelope {
            doc: self.id,
            branch: MAIN.into(),
            writer: w,
            seq,
            prev,
            deps,
            body: body.value(),
            sigs: vec![],
        };
        Ok(Prepared {
            envelope: e,
            signer,
            base: self.held.len(),
            version: self.snapshot.version.clone(),
        })
    }

    /// Attaches the device's signature to a prepared commit and imports it through every check a reader runs. Refused
    /// when the Doc moved on since [`Doc::prepare`] (another import or commit in between): prepare again.
    pub fn finish(
        &mut self,
        prepared: Prepared,
        sig: [u8; 64],
        auth: &impl Authorize,
    ) -> Result<Vec<u8>, CommitError> {
        if prepared.base != self.held.len() || prepared.version != self.snapshot.version {
            return Err(CommitError::Moved);
        }
        let mut e = prepared.envelope;
        // the log writer's own entry in `sigs` (Core's `addSig`): its name never changes
        e.add_sig(aven_core::Sig {
            signer: prepared.signer.to_vec(),
            sig: sig.to_vec(),
        });
        let bytes = e.encode();
        match self.import(&bytes, auth) {
            Ok(Imported::Counts) => Ok(bytes),
            other => Err(CommitError::NotCounted(format!("{other:?}"))),
        }
    }

    /// Every envelope held, counted or not, with its name, in the order it was held.
    pub fn held(&self) -> impl Iterator<Item = (Hash, &Envelope)> {
        self.held.iter().map(|h| (h.name, &h.e))
    }

    /// What this peer holds of the Doc (`Docs.Held`): each envelope's name and the hash of its encoded bytes, in the
    /// order held, to keep beside the head. Reopening is [`Doc::open`], then [`Doc::import_page`] of those bytes.
    pub fn held_page(&self) -> HeldPage {
        HeldPage {
            doc: self.id,
            envelopes: self
                .held
                .iter()
                .map(|h| (h.name, aven_core::blake3(&h.e.encode())))
                .collect(),
        }
    }

    /// Marks an envelope unfit by its name, before or after it is held: the judge crashed on it alone (the Peer-Light's
    /// docs worker, `db/docs/README.md`, "Importing", (c)). It never counts; if it counted, the live state rebuilds. The
    /// mark is the caller's own, never stored or sent by the docs layer.
    pub fn mark_unfit(&mut self, name: Hash) {
        self.crashed.insert(name);
        if let Some(&i) = self.by_name.get(&name) {
            let was = self.counted.contains(&name);
            self.held[i].fit = Some(Err(Unfit::Op("the judge crashed on it".into())));
            if was {
                let _ = self.rebuild();
            }
        }
    }
}

/// A commit prepared and not yet signed: what the device signs, and the Doc as it was.
#[derive(Clone, Debug)]
pub struct Prepared {
    envelope: Envelope,
    signer: [u8; 32],
    base: usize,
    version: Vec<Hash>,
}

impl Prepared {
    /// The bytes the device signs: Core's `["avenDB envelope 1", unsigned envelope]`.
    pub fn signing(&self) -> Vec<u8> {
        self.envelope.signing()
    }

    /// The envelope it will be, unsigned.
    pub fn envelope(&self) -> &Envelope {
        &self.envelope
    }
}

/// What a peer holds of a Doc (`Aven.DB.Docs.Held`, `held.json`): every envelope by its name and the hash of its encoded
/// bytes, in the order held. The head's companion, kept beside it, never travelling.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HeldPage {
    pub doc: DocId,
    pub envelopes: Vec<(Hash, Hash)>,
}

impl HeldPage {
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("doc".into(), self.doc.0.value()),
            (
                "envelopes".into(),
                Value::Array(
                    self.envelopes
                        .iter()
                        .map(|(n, b)| Value::Array(vec![n.value(), b.value()]))
                        .collect(),
                ),
            ),
        ])
    }

    /// `Held.ofValue?`: exactly its two keys, each pair two 32-byte hashes, no envelope named twice.
    pub fn of_value(v: &Value) -> Option<HeldPage> {
        let h = |v: &Value| match v {
            Value::Bytes(b) => Some(Hash(b.as_slice().try_into().ok()?)),
            _ => None,
        };
        let Value::Map(kvs) = v else { return None };
        let [(d, doc), (e, Value::Array(es))] = kvs.as_slice() else {
            return None;
        };
        if d != "doc" || e != "envelopes" {
            return None;
        }
        let envelopes: Vec<(Hash, Hash)> = es
            .iter()
            .map(|p| match p {
                Value::Array(p) => match p.as_slice() {
                    [n, b] => Some((h(n)?, h(b)?)),
                    _ => None,
                },
                _ => None,
            })
            .collect::<Option<_>>()?;
        let names: BTreeSet<Hash> = envelopes.iter().map(|x| x.0).collect();
        (names.len() == envelopes.len()).then_some(HeldPage {
            doc: DocId(h(doc)?),
            envelopes,
        })
    }
}

/// Checks a Core envelope's Ed25519 signatures, what a single envelope is signed with: it has one at least, and every
/// one beside it verifies over what it signs.
pub fn envelope_valid(e: &Envelope) -> bool {
    let msg = e.signing();
    !e.sigs.is_empty()
        && e.sigs
            .iter()
            .all(|x| Ed25519.verify(&x.signer, &msg, &x.sig))
}
