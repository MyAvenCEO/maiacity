//! The two example items, each one Loro document: a markdown document and a todo. An item's Loro updates are what
//! gets encrypted into `Write` edits and synced. Its content depends only on which updates it holds (Loro converges),
//! so devices holding the same writes show the same item (T11, T13).
//!
//! An item is one root map, `item`: the stored record, holding the fields of every schema version that wrote it
//! (`lens`). Free text is a Loro text, so concurrent edits of it merge character by character; a list of records (a
//! document's blocks) is a movable list of maps, each with its `id`, and so is a list of records in a row, at any
//! depth; a list of values (tags) a Loro list; anything else one value, where concurrent edits keep one of them. A
//! container that appears after the item was made (a document's first tag, the text of a block that had none, the
//! first rows of a row) is created mergeable, so two devices creating it at once share it instead of one hiding the
//! other. Every walk over a record here is a loop over an explicit stack, never a recursion.
//!
//! Every edit goes through an app's view (`lens::View`): the app edits what it sees, the lens turns that into the new
//! stored record, and the item makes the smallest change that holds it. Each change carries the view's schema as its
//! Loro commit message, so a reader knows which versions wrote an item (`authored`). A merge, restore or undo puts
//! back a record those versions wrote (`put_record`), and names none; a copy into a new entry names them all (`copy`).
//!
//! Each device edits as a Loro peer of its own on each line of an item's history, derived from its signer and the
//! line, so an import can check that every op of a write is its signer's, and a device's edits on one line are one run
//! of ops that the line's history holds whole (`history`). A draft's creation starts its own line, named by its own
//! id, which hashes its content: so it is written as its signer's draft peer of the entry instead (`Peer`). No clock
//! goes into the updates: the same edits export the same bytes.
//!
//! What a write touches (`rules::Touch`), which the ops of the shares it relies on judge, is read off its Loro ops once
//! imported on the version it builds on (`Item::footprint`): each op by the place its container has in the record then.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use loro::{
    CommitOptions, Container, ContainerID, ContainerType, Counter, EncodedBlobMode, ExportMode, Frontiers, ID, IdSpan,
    Index, JsonMapOp, JsonMovableListOp, JsonOpContent, LoroDoc, LoroList, LoroMap, LoroMovableList, LoroResult,
    LoroText, LoroValue, PeerID, ToJson, UpdateOptions, ValueOrContainer, VersionVector,
};
use serde_json::Value;

use crate::id::{BlobId, EntryId, SignerId};
use crate::lens::example::{self, DocV0, TodoV0};
use crate::lens::{BlockV1, DocV1, Status, Stored, TodoV1, TypeV1, View};
use crate::ops::{self, Loc, Record, Seg};
use crate::policy::{Line, Proposal, Write};
use crate::rules::{Scalar, Touch};

/// Peer ids at the very top are Loro's: it refuses `PeerID::MAX` and marks things internally with a few below it.
const RESERVED: u64 = 16;

/// The root map every item lives in.
const ROOT: &str = "item";

/// A version of an item (Loro's version vector), to export what came after it: each peer and how many of its ops the
/// item holds, in peer order (8 + 4 bytes, big-endian), so equal versions are equal bytes. Empty is before any write.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Version(pub Vec<u8>);

impl Version {
    fn of(vv: &VersionVector) -> Version {
        let mut peers: Vec<(PeerID, Counter)> = vv.iter().filter(|e| *e.1 > 0).map(|(&p, &n)| (p, n)).collect();
        peers.sort_unstable();
        let mut bytes = Vec::with_capacity(12 * peers.len());
        for (p, n) in peers {
            bytes.extend(p.to_be_bytes());
            bytes.extend(n.to_be_bytes());
        }
        Version(bytes)
    }

    fn vv(&self) -> VersionVector {
        let entry = |e: &[u8]| -> Option<(PeerID, Counter)> {
            Some((PeerID::from_be_bytes(e[..8].try_into().ok()?), Counter::from_be_bytes(e[8..].try_into().ok()?)))
        };
        self.0.chunks_exact(12).filter_map(entry).collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DocError {
    /// Not a Loro update, or a crafted one.
    Malformed,
    /// The update's Loro peer ids aren't the ones its signer may use.
    WrongPeer,
}

/// What an update does to the item it imports into (`Item::footprint`): what its ops touch, the rows it added (each by
/// its place, at any depth: a row its after holds more often than its before, `ops::row_places`), and the record before
/// and after it.
#[derive(Clone, Debug, PartialEq)]
pub struct Footprint {
    pub touches: Vec<Touch>,
    pub adds: Vec<Loc>,
    pub before: Value,
    pub after: Value,
}

/// One item as one device holds it: a Loro document whose edits carry that device's peer.
pub struct Item {
    doc: LoroDoc,
    peer: PeerID,
    /// Peers with changes an import parked until what they build on arrives, and how far those go: they may land with
    /// a later import, whoever signs it. A fork starts without them (Loro keeps parked changes out of snapshots).
    parked: BTreeMap<PeerID, Counter>,
}

impl Item {
    /// An empty item on `signer`'s device, before it imports any write: it shows nothing until one is there.
    pub fn new(signer: SignerId) -> Item {
        Item::new_on(signer, None)
    }

    /// An empty item on `signer`'s device whose edits extend line `line` of its history.
    pub fn new_on(signer: SignerId, line: Line) -> Item {
        Item::on(LoroDoc::new(), peer(signer, line))
    }

    /// An empty item on `signer`'s device whose first edit is a draft's creation of entry `entry`: its edits carry the
    /// signer's draft peer of the entry (`Peer::Draft`), as the creation starts a line its own id names, which isn't
    /// known until it is written.
    pub fn draft(signer: SignerId, entry: EntryId) -> Item {
        Item::on(LoroDoc::new(), Peer::Draft(signer, entry).id())
    }

    /// `doc` edited as `peer`, with no timestamps in its changes.
    fn on(doc: LoroDoc, peer: PeerID) -> Item {
        doc.set_peer_id(peer).expect("a peer id Loro takes");
        doc.set_record_timestamp(false);
        Item { doc, peer, parked: BTreeMap::new() }
    }

    /// A new item made on `signer`'s device by an app reading through `view`: `value` is its first edit. `None` if
    /// `value` isn't a view of the app's schema.
    pub fn made(view: &View, value: &Value, signer: SignerId) -> Option<Item> {
        let mut item = Item::new(signer);
        item.write(view, value).then_some(item)
    }

    /// A new markdown document made by the document app on `signer`'s device: its edits carry that signer's Loro
    /// peer. Only what differs from the schema's defaults is written: its kind and title.
    pub fn document(title: &str, signer: SignerId) -> Item {
        let doc = DocV1 { title: title.into(), blocks: vec![], tags: vec![] };
        Item::made(View::document_v1(), &doc.to_value(), signer).expect("a v1 document")
    }

    /// A document as an app of the lens engine's example on v0 writes it (`lens::example`), on `signer`'s device. Its
    /// block ids must differ.
    pub fn written_v0(doc: &DocV0, signer: SignerId) -> Item {
        Item::made(example::document_v0(), &doc.to_value(), signer).expect("a v0 document, each block id once")
    }

    /// A new todo made by the todo app: its status is open by the schema's default, and not written.
    pub fn todo(title: &str, signer: SignerId) -> Item {
        let todo = TodoV1 { title: title.into(), status: Status::Open, notes: String::new(), due: None };
        Item::made(View::todo_v1(), &todo.to_value(), signer).expect("a v1 todo")
    }

    /// A todo as an app of the lens engine's example on v0 writes it.
    pub fn todo_v0(todo: &TodoV0, signer: SignerId) -> Item {
        Item::made(example::todo_v0(), &todo.to_value(), signer).expect("a v0 todo")
    }

    /// The same item as another device holds it, whose edits from now on are that device's.
    pub fn fork_as(&self, signer: SignerId) -> Item {
        self.fork_on(signer, None)
    }

    /// The same item as `signer`'s device holds it on line `line`, whose edits from now on extend that line.
    pub fn fork_on(&self, signer: SignerId, line: Line) -> Item {
        Item::on(self.doc.fork(), peer(signer, line))
    }

    /// What the item stores: its root map as JSON, texts as strings; `{}` before any write.
    pub fn record(&self) -> Value {
        self.root().get_deep_value().to_json_value()
    }

    /// The item as an app reading through `view` sees it: `None` for another kind of item, or before any write.
    pub fn read(&self, view: &View) -> Option<Value> {
        view.get(&self.record())
    }

    /// An edit through `view`: the app's view of the item is now `new`. Only what changed is written, tagged with the
    /// view's schema; nothing at all if `new` is the view as it was. False, writing nothing, if `new` isn't a view of
    /// the app's schema.
    pub fn write(&mut self, view: &View, new: &Value) -> bool {
        let Some(next) = view.put(&self.record(), new) else { return false };
        self.set_record(view, &next);
        true
    }

    /// Make the item store exactly `record` by the smallest change, tagged with `view`'s schema, whose schemas (and
    /// the lens's other one) say which fields are texts: how `write` lands an edit once the lens has made it a stored
    /// record, and how a test sets up records no single app writes.
    pub fn set_record(&mut self, view: &View, record: &Value) {
        let want = record.as_object().cloned().unwrap_or_default();
        sync(&self.root(), &want, view);
        self.doc.commit_with(CommitOptions::new().commit_msg(&view.schema().id().to_hex()));
        debug_assert_eq!(self.record(), Value::Object(want));
    }

    /// Make the item store exactly `record` by the smallest change, as a merge, a restore or an undo does: the record
    /// is one the item's own changes wrote, so this change names no schema. The built-in views of the record's kind say
    /// which new fields are texts.
    pub fn put_record(&mut self, record: &Value) {
        let want = record.as_object().cloned().unwrap_or_default();
        sync(&self.root(), &want, kind_view(record));
        self.doc.commit();
        debug_assert_eq!(self.record(), Value::Object(want));
    }

    /// A new item on `signer`'s device that stores exactly this one's record, and none of its history: one change,
    /// naming every schema this one was written under, so apps read the copy as they read this one. A variant, a new
    /// entry of another, starts from it.
    pub fn copy(&self, signer: SignerId) -> Item {
        let item = Item::new(signer);
        let record = self.record();
        sync(&item.root(), &record.as_object().cloned().unwrap_or_default(), kind_view(&record));
        let names: Vec<String> = self.authored().iter().map(BlobId::to_hex).collect();
        if names.is_empty() {
            item.doc.commit();
        } else {
            item.doc.commit_with(CommitOptions::new().commit_msg(&names.join(" ")));
        }
        item
    }

    /// The schemas the item's changes were written under, by their commit messages: each names one, or for a copy
    /// several, apart by spaces. A change without one (a merge, a restore, an undo) names none.
    pub fn authored(&self) -> BTreeSet<BlobId> {
        self.authored_since(&Version::default())
    }

    /// The schemas the changes made after `since` were written under: what one write's update was written under,
    /// imported on the version it builds on.
    pub fn authored_since(&self, since: &Version) -> BTreeSet<BlobId> {
        let from = since.vv();
        let mut out = BTreeSet::new();
        for (&peer, &end) in self.doc.oplog_vv().iter() {
            let mut at: Counter = from.get(&peer).copied().unwrap_or(0);
            while at < end {
                let Some(change) = self.doc.get_change(ID::new(peer, at)) else { break };
                out.extend(change.message.as_deref().unwrap_or_default().split(' ').filter_map(BlobId::from_hex));
                at = change.id.counter + change.len as Counter;
            }
        }
        out
    }

    /// The item as the document app reads it; `None` for a todo.
    pub fn as_document(&self) -> Option<DocV1> {
        DocV1::from_value(&self.read(View::document_v1())?)
    }

    /// The item as Markdown, as a page shows a note: a document as the document app reads it, a spark by its title, its
    /// blocks and its tags, as a document, or an article as one, its title and its tags, its text the paragraph of
    /// block 2, where a note keeps its text (`cast::document`). `None` for anything else.
    pub fn as_markdown(&self) -> Option<DocV1> {
        if let Some(doc) = self.as_document() {
            return Some(doc);
        }
        if let Some(spark) = self.read(View::built_in("spark")?).and_then(|s| DocV1::from_value(&s)) {
            return Some(spark);
        }
        let article = self.read(View::built_in("article")?)?;
        let text = |k: &str| article.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
        let tags = article.get("tags").and_then(Value::as_array).into_iter().flatten();
        let tags = tags.filter_map(|t| Some(t.as_str()?.to_string())).collect();
        let paragraph = TypeV1::Paragraph;
        let block = BlockV1 { id: 2, r#type: paragraph, level: None, checked: None, lang: None, text: text("text") };
        Some(DocV1 { title: text("title"), blocks: vec![block], tags })
    }

    /// The item as the example's v0 app, which has the lens, reads it; `None` for a todo.
    pub fn as_document_v0(&self) -> Option<DocV0> {
        DocV0::from_value(&self.read(example::document_v0())?)
    }

    /// The item as the todo app reads it; `None` for a document.
    pub fn as_todo(&self) -> Option<TodoV1> {
        TodoV1::from_value(&self.read(View::todo_v1())?)
    }

    /// The item as the example's v0 todo app, which has the lens, reads it; `None` for a document.
    pub fn as_todo_v0(&self) -> Option<TodoV0> {
        TodoV0::from_value(&self.read(example::todo_v0())?)
    }

    /// Edit the document as the document app sees it. False if it isn't a document, or `change` leaves two blocks with
    /// one id.
    pub fn edit_document(&mut self, change: impl FnOnce(&mut DocV1)) -> bool {
        let Some(mut d) = self.as_document() else { return false };
        change(&mut d);
        self.write(View::document_v1(), &d.to_value())
    }

    /// Edit the document as the example's v0 app sees it.
    pub fn edit_document_v0(&mut self, change: impl FnOnce(&mut DocV0)) -> bool {
        let Some(mut d) = self.as_document_v0() else { return false };
        change(&mut d);
        self.write(example::document_v0(), &d.to_value())
    }

    /// Edit the todo as the todo app sees it.
    pub fn edit_todo(&mut self, change: impl FnOnce(&mut TodoV1)) -> bool {
        let Some(mut t) = self.as_todo() else { return false };
        change(&mut t);
        self.write(View::todo_v1(), &t.to_value())
    }

    /// Edit the todo as the example's v0 todo app sees it.
    pub fn edit_todo_v0(&mut self, change: impl FnOnce(&mut TodoV0)) -> bool {
        let Some(mut t) = self.as_todo_v0() else { return false };
        change(&mut t);
        self.write(example::todo_v0(), &t.to_value())
    }

    /// Append a block to a document (a todo has none).
    pub fn push_block(&mut self, block: BlockV1) {
        self.edit_document(|d| d.blocks.push(block));
    }

    /// Replace the text of block `block` by the smallest character edit, so concurrent edits of it merge character by
    /// character. A block that isn't there (deleted meanwhile) is left alone.
    pub fn set_text(&mut self, block: u64, text: &str) {
        self.edit_document(|d| {
            if let Some(b) = d.blocks.iter_mut().find(|b| b.id == block) {
                b.text = text.into();
            }
        });
    }

    /// Set a todo's status (a document has none).
    pub fn set_status(&mut self, status: Status) {
        self.edit_todo(|t| t.status = status);
    }

    /// Every op the item holds.
    pub fn version(&self) -> Version {
        Version::of(&self.doc.oplog_vv())
    }

    /// The updates made since `since`, to encrypt into one write.
    pub fn export(&self, since: &Version) -> Vec<u8> {
        self.doc.export(ExportMode::updates(&since.vv())).expect("updates always export")
    }

    /// What a device stores for the item: a Loro snapshot, its history and its state.
    pub fn bytes(&self) -> Vec<u8> {
        self.doc.export(ExportMode::Snapshot).expect("a snapshot of an attached document")
    }
    /// Import an update `signer` wrote on the main line: `import_on`.
    pub fn import(&mut self, update: &[u8], signer: SignerId) -> Result<(), DocError> {
        self.import_on(update, signer, None)
    }

    /// Import an update signed by `signer` on line `line`, after checking its Loro peer ids are the ones that signer
    /// edits that line as.
    ///
    /// Loro decodes the update into a scratch document first (`decode_import_blob_meta`): it must hold updates, not a
    /// snapshot (whose state import would take as it is), and every change in it must carry the signer's peer. Import
    /// decodes the same bytes the same way, so it adds that peer's ops and nothing else, besides changes an earlier
    /// import parked until what they build on arrived; the version vectors before and after are compared all the same,
    /// and anything else puts the item back as it was. An update whose dependencies are missing waits inside Loro and
    /// shows once they arrive.
    ///
    /// Not caught: a signer sending two different updates for the same ops of its own (a device keeps whichever it
    /// imports first), and ops naming others' ids (deleting or moving their text), which any writer may do.
    pub fn import_on(&mut self, update: &[u8], signer: SignerId, line: Line) -> Result<(), DocError> {
        self.import_as(update, Peer::Line(signer, line))
    }

    /// Import an update whose ops must all carry the Loro peer `as_peer` (`import_on`): a write's, as `Peer::of` names
    /// it.
    pub fn import_as(&mut self, update: &[u8], as_peer: Peer) -> Result<(), DocError> {
        let meta = LoroDoc::decode_import_blob_meta(update, true).map_err(|_| DocError::Malformed)?;
        if meta.mode != EncodedBlobMode::Updates {
            return Err(DocError::Malformed);
        }
        let peer = as_peer.id();
        if meta.partial_end_vv.keys().any(|&p| p != peer) {
            return Err(DocError::WrongPeer);
        }
        let (frontiers, before) = (self.doc.oplog_frontiers(), self.doc.oplog_vv());
        let imported = self.doc.import(update);
        let after = self.doc.oplog_vv();
        let status = match imported {
            Ok(status) if !smuggled(&before, &after, peer, &self.parked) => status,
            refused => {
                if after != before {
                    self.put_back(&frontiers);
                }
                return Err(if refused.is_ok() { DocError::WrongPeer } else { DocError::Malformed });
            }
        };
        for (&p, &(_, end)) in status.pending.iter().flat_map(|r| r.iter()) {
            let parked = self.parked.entry(p).or_default();
            *parked = end.max(*parked);
        }
        self.parked.retain(|p, end| after.get(p).is_none_or(|have| have < end));
        Ok(())
    }

    /// Import an update `signer` wrote on line `line` (`import_on`) on this item, which holds the version it builds on,
    /// and read what it touches (`rules::Touch`): each of its ops by the place its container has in the record once it
    /// is in (`At`). A value set at a field (`Set` with the value, where it set one plain value; `null` where it
    /// deleted one); a text, a list of values or a map changed in a field (`Set`, no value); a row of a list of records
    /// added, deleted or moved (`Insert`, `Remove`, `Move`), whatever the op does inside a row it adds being part of
    /// adding it; each of these in a row too, at any depth, the row by its id, down each list that is a list of records
    /// before and after (else at the field of that list); a row's id set is changing its list; a list of records made
    /// to add rows to is adding them. An op nowhere in the record (outside the root map, or in a container it no longer
    /// reaches) touches the whole record.
    /// With them, the record before and after it, which readers judge it by too (`lens::Lane::fits`). `None` where the
    /// update doesn't import, or imports only in part: it builds on ops the item doesn't hold.
    pub fn footprint(&mut self, update: &[u8], signer: SignerId, line: Line) -> Option<Footprint> {
        self.footprint_as(update, Peer::Line(signer, line))
    }

    /// `footprint`, of an update whose ops carry the Loro peer `as_peer`: a write's, as `Peer::of` names it.
    pub fn footprint_as(&mut self, update: &[u8], as_peer: Peer) -> Option<Footprint> {
        let (before, was) = (self.record(), self.doc.oplog_vv());
        self.import_as(update, as_peer).ok()?;
        let (after, now, p) = (self.record(), self.doc.oplog_vv(), as_peer.id());
        let others = |q: &PeerID| *q != p && now.get(q) != was.get(q);
        if !self.parked.is_empty() || now.keys().any(others) {
            return None;
        }
        let (start, end) = (was.get(&p).copied().unwrap_or(0), now.get(&p).copied().unwrap_or(0));
        // a container its own ops made: what it does inside one is part of making it
        let made = |c: &ContainerID| {
            matches!(c, ContainerID::Normal { peer, counter, .. } if *peer == p && (start..end).contains(counter))
        };
        let inside_made = |c: &ContainerID| {
            let mut at = Some(c.clone());
            while let Some(c) = at {
                if made(&c) {
                    return true;
                }
                at = c.parse_mergeable().map(|(parent, ..)| parent);
            }
            false
        };
        let (mut out, mut lists) = (vec![], vec![]);
        for op in self.doc.export_json_in_id_span(IdSpan::new(p, start, end)).iter().flat_map(|c| &c.ops) {
            let Some(path) = self.doc.get_path_to_container(&op.container) else {
                if !inside_made(&op.container) {
                    out.push(Touch::Set(Loc::root(), None));
                }
                continue;
            };
            let root = ContainerID::Root { name: ROOT.into(), container_type: ContainerType::Map };
            if path.first().is_none_or(|(c, _)| *c != root) {
                out.push(Touch::Set(Loc::root(), None));
                continue;
            }
            if path.iter().any(|(c, _)| made(c)) {
                continue;
            }
            out.push(match (At::of(&path, &before, &after), &op.content) {
                // a row's id names it: changing it changes its list
                (At::Map(at), JsonOpContent::Map(JsonMapOp::Insert { key, .. } | JsonMapOp::Delete { key }))
                    if key == "id" && !at.0.is_empty() =>
                {
                    Touch::Set(list_of(&at), None)
                }
                (At::Map(at), JsonOpContent::Map(JsonMapOp::Insert { key, value })) if container(value) => {
                    lists.push(and(&at, key));
                    continue;
                }
                (At::Map(at), JsonOpContent::Map(JsonMapOp::Insert { key, value })) => {
                    Touch::Set(and(&at, key), scalar(value))
                }
                (At::Map(at), JsonOpContent::Map(JsonMapOp::Delete { key })) => {
                    Touch::Set(and(&at, key), Some(Scalar::Null))
                }
                (At::Map(at), _) => Touch::Set(list_of(&at), None),
                (At::Field(at), JsonOpContent::MovableList(JsonMovableListOp::Insert { .. })) => Touch::Insert(at),
                (At::Field(at), JsonOpContent::MovableList(JsonMovableListOp::Delete { .. })) => Touch::Remove(at),
                (At::Field(at), JsonOpContent::MovableList(JsonMovableListOp::Move { .. })) => Touch::Move(at),
                (At::Field(_), JsonOpContent::Tree(_) | JsonOpContent::Future(_)) => Touch::Set(Loc::root(), None),
                (At::Field(at) | At::Inside(at), _) => Touch::Set(at, None),
            });
        }
        // a list of records made to add rows to is adding them
        for l in lists {
            if !out.contains(&Touch::Insert(l.clone())) {
                out.push(Touch::Set(l, None));
            }
        }
        let adds = added(&before, &after);
        Some(Footprint { touches: crate::rules::dedup(out), adds, before, after })
    }

    /// The history up to `frontiers` and nothing after, as before an import that went wrong.
    fn put_back(&mut self, frontiers: &Frontiers) {
        let doc = self.doc.fork_at(frontiers).expect("a version the item held");
        *self = Item::on(doc, self.peer);
    }

    fn root(&self) -> LoroMap {
        self.doc.get_map(ROOT)
    }
}

/// The rows record `after` holds more often than record `before`, each by its place, once per copy more.
fn added(before: &Value, after: &Value) -> Vec<Loc> {
    let mut had: HashMap<Loc, usize> = HashMap::new();
    for l in crate::ops::row_places(before) {
        *had.entry(l).or_default() += 1;
    }
    let mut out = vec![];
    for l in crate::ops::row_places(after) {
        match had.get_mut(&l) {
            Some(n) if *n > 0 => *n -= 1,
            _ => out.push(l),
        }
    }
    out
}

/// A deep copy that edits as the same device: only one of the two may edit from then on, or two different ops would
/// carry one id. `fork_as` gives another device's copy.
impl Clone for Item {
    fn clone(&self) -> Item {
        Item::on(self.doc.fork(), self.peer)
    }
}

/// The Loro peer of `signer`'s edits on line `line`: the first 8 bytes of a hash of the signer, and on a proposal, of
/// the proposal too, for a purpose that keeps a proposal's old name, branch, so every peer stays what it was. Two
/// signers, or two lines, share a peer only by a 64-bit collision.
fn peer(signer: SignerId, line: Line) -> PeerID {
    Peer::Line(signer, line).id()
}

/// Whose Loro peer the ops of a write carry, one name for every write (`Peer::of`): its signer's on the line it
/// extends (`Line`); or, for a draft's creation, which starts a line named by its own id, a hash of its content and so
/// not known as it is written, its signer's draft peer of its entry (`Draft`), whose id the device draws before the
/// write. A draft peer differs from every line's, so nothing its signer later writes on main, or on the draft's line,
/// collides with it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Peer {
    Line(SignerId, Line),
    Draft(SignerId, EntryId),
}

impl Peer {
    /// The peer write `w`'s ops carry: the draft peer of its entry for a draft's creation, a creation that starts a
    /// line of its own (`Proposal::New`), else its author's on its line.
    pub fn of(w: &Write) -> Peer {
        match w.first && w.proposal == Proposal::New {
            true => Peer::Draft(w.author, w.entry),
            false => Peer::Line(w.author, w.line()),
        }
    }

    /// Its Loro peer id: the first 8 bytes of a hash of what names it, each kind for a purpose of its own.
    pub fn id(self) -> PeerID {
        let h = match self {
            Peer::Line(signer, None) => crate::hash::hash("loro peer", &signer.0),
            Peer::Line(signer, Some(b)) => crate::hash::hash("loro peer on a branch", &[signer.0, b.0].concat()),
            Peer::Draft(signer, entry) => crate::hash::hash("loro peer of a draft", &[signer.0, entry.0].concat()),
        };
        usable(u64::from_be_bytes(*h.first_chunk().expect("32 bytes")))
    }
}

/// The built-in view of a record's kind (`View::built_in`), or else a document's. Fields it doesn't know are stored by
/// what they hold.
fn kind_view(record: &Value) -> &'static View {
    record.get("kind").and_then(Value::as_str).and_then(View::built_in).unwrap_or(View::document_v1())
}

/// Where an op's container is in the record, once the update is in (`Item::footprint`): the map of the record or of a
/// row (`Map`), the container at a field (`Field`), or one inside it (`Inside`), each by its place, a row by its id.
enum At {
    Map(Loc),
    Field(Loc),
    Inside(Loc),
}

impl At {
    /// Where the container `path` leads to from the root map is: down each list of records that holds rows before and
    /// after the update, through the row `after` holds at the position the path goes through, by its id; at the field
    /// of a list that doesn't. A loop down the path.
    fn of<'v>(path: &[(ContainerID, Index)], before: &'v Value, after: &'v Value) -> At {
        let (mut b, mut a) = (before.as_object(), after.as_object());
        let mut at = Loc::root();
        let mut i = 1;
        loop {
            let Some((c, Index::Key(f))) = path.get(i) else {
                return if i == path.len() { At::Map(at) } else { At::Inside(at) };
            };
            let field = and(&at, f);
            match path.get(i + 1) {
                None => return At::Field(field),
                Some((r, Index::Seq(j)))
                    if c.container_type() == ContainerType::MovableList && r.container_type() == ContainerType::Map =>
                {
                    let rows = |x: Option<&'v Record>| x.and_then(|x| x.get(f.as_str())).and_then(ops::rows);
                    let (Some(was), Some(now)) = (rows(b), rows(a)) else { return At::Inside(field) };
                    let Some(row) = now.get(*j).and_then(Value::as_object) else { return At::Inside(field) };
                    let Some(id) = row.get("id").and_then(Value::as_i64) else { return At::Inside(field) };
                    b = was.iter().find(|x| x["id"].as_i64() == Some(id)).and_then(Value::as_object);
                    a = Some(row);
                    at = field;
                    at.0.push(Seg::Row(id));
                    i += 2;
                }
                Some(_) => return At::Inside(field),
            }
        }
    }
}

/// Field `key` of the record or the row at `at`.
fn and(at: &Loc, key: &str) -> Loc {
    let mut l = at.clone();
    l.0.push(Seg::Field(key.to_string()));
    l
}

/// The list a row is in (the record itself for the record's own place): its place without its last row.
fn list_of(at: &Loc) -> Loc {
    match at.0.split_last() {
        Some((Seg::Row(_), list)) => Loc(list.to_vec()),
        _ => Loc::root(),
    }
}

/// A map slot's value that makes a container there: a container, or the marker of a mergeable one, which Loro stores
/// as a binary value starting with its magic (`loro::LoroValue::Binary`).
fn container(v: &LoroValue) -> bool {
    match v {
        LoroValue::Container(_) => true,
        LoroValue::Binary(b) => b.len() == 8 && b.starts_with(&[0, b'L', b'M', 1]),
        _ => false,
    }
}

/// The plain value a map slot was set to, as a rule names it: none for a number that isn't an integer, a binary, a
/// list, a map or a container.
fn scalar(v: &LoroValue) -> Option<Scalar> {
    match v {
        LoroValue::Null => Some(Scalar::Null),
        LoroValue::Bool(b) => Some(Scalar::Bool(*b)),
        LoroValue::I64(i) => Some(Scalar::Int(*i)),
        LoroValue::String(s) => Some(Scalar::Text(s.to_string())),
        _ => None,
    }
}

/// A peer id Loro takes: the reserved ones at the top move down below them.
fn usable(p: PeerID) -> PeerID {
    if p > PeerID::MAX - RESERVED { p - RESERVED } else { p }
}

/// Whether ops other than `peer`'s landed between `before` and `after`, beyond the changes earlier imports parked.
fn smuggled(before: &VersionVector, after: &VersionVector, peer: PeerID, parked: &BTreeMap<PeerID, Counter>) -> bool {
    let at = |vv: Option<&Counter>| vv.copied().unwrap_or(0);
    after.iter().any(|(p, &end)| *p != peer && end > at(before.get(p)) && end > at(parked.get(p)))
}

/// Edits fail only on a detached document, and an item never detaches.
fn edit<T>(result: LoroResult<T>) -> T {
    result.expect("an edit of an attached document")
}

/// A plain value as Loro holds it.
fn loro(v: &Value) -> LoroValue {
    match v {
        Value::Null => LoroValue::Null,
        Value::Bool(b) => (*b).into(),
        Value::Number(n) => n.as_i64().map(LoroValue::from).unwrap_or_else(|| n.as_f64().unwrap_or_default().into()),
        Value::String(s) => s.as_str().into(),
        Value::Array(xs) => LoroValue::List(xs.iter().map(loro).collect::<Vec<_>>().into()),
        Value::Object(m) => LoroValue::Map(m.iter().map(|(k, v)| (k.clone(), loro(v))).collect::<HashMap<_, _>>().into()),
    }
}

/// The field `k` of `r`, unless it is absent or `null`.
fn present<'a>(r: &'a Record, k: &str) -> Option<&'a Value> {
    r.get(k).filter(|v| !v.is_null())
}

/// What is left to sync (`sync`): a map to hold a record or a row, or a movable list to hold rows, each with the lists
/// it is down (each a field of a row of the one before), by which the view's schemas say how its fields are stored.
enum Sync<'a> {
    Map(LoroMap, &'a Record, Vec<String>),
    Rows(LoroMovableList, &'a [Value], Vec<String>),
}

/// Make the root map `m` hold exactly `want` by the smallest change (`sync_map`, `sync_records`), rows in rows at any
/// depth: a loop over what is left to sync, never a recursion.
fn sync(m: &LoroMap, want: &Record, view: &View) {
    let mut todo = vec![Sync::Map(m.clone(), want, vec![])];
    while let Some(next) = todo.pop() {
        match next {
            Sync::Map(m, want, lists) => sync_map(&m, want, view, &lists, &mut todo),
            Sync::Rows(l, want, lists) => sync_records(&l, want, lists, &mut todo),
        }
    }
}

/// Make map `m` hold exactly `want`: each key whose value differs is set, deleted, or for a container brought to its
/// new content by the smallest change, so concurrent edits of other parts merge. `lists` are the lists `m` is a row
/// down; a list of records in it is left to sync.
fn sync_map<'a>(m: &LoroMap, want: &'a Record, view: &View, lists: &[String], todo: &mut Vec<Sync<'a>>) {
    let have = m.get_deep_value().to_json_value();
    let have = have.as_object().cloned().unwrap_or_default();
    let keys: BTreeSet<&String> = have.keys().chain(want.keys()).collect();
    for key in keys {
        let w = present(want, key);
        if present(&have, key) == w {
            continue;
        }
        match w {
            None => edit(m.delete(key)),
            Some(w) => set_key(m, key, w, view, lists, todo),
        }
    }
}

/// Set `key` of `m` to `w`, a container the way the view's schemas store the field.
fn set_key<'a>(m: &LoroMap, key: &str, w: &'a Value, view: &View, lists: &[String], todo: &mut Vec<Sync<'a>>) {
    let now = m.get(key);
    // a field no schema of the view names: one value stays one value, else an array of rows (objects with an integer
    // id) is a list of records, at any depth, an array of other objects one value, and any other array a list of values
    let stored = view.stored(lists, key).unwrap_or(match (&now, w) {
        (Some(ValueOrContainer::Value(v)), _) if !container(v) => Stored::Value,
        (_, Value::Array(xs)) if xs.iter().any(Value::is_object) => {
            if ops::rows(w).is_some() { Stored::Records } else { Stored::Value }
        }
        (_, Value::Array(_)) => Stored::List,
        _ => Stored::Value,
    });
    let down = || lists.iter().cloned().chain([key.to_string()]).collect::<Vec<_>>();
    match (&now, w) {
        (Some(ValueOrContainer::Container(Container::Text(t))), Value::String(s)) => return update_text(t, s),
        (Some(ValueOrContainer::Container(Container::MovableList(l))), Value::Array(xs)) => {
            return todo.push(Sync::Rows(l.clone(), xs, down()));
        }
        (Some(ValueOrContainer::Container(Container::List(l))), Value::Array(xs)) => return sync_values(l, xs),
        _ => {}
    }
    // a new field, or one changing what it holds: a container is made mergeable, so that devices making it at once
    // share it (Loro makes one only where the key holds no plain value)
    let replace = |m: &LoroMap| {
        if now.is_some() {
            edit(m.delete(key));
        }
    };
    match (stored, w) {
        (Stored::Text, Value::String(s)) => {
            replace(m);
            update_text(&edit(m.ensure_mergeable_text(key)), s);
        }
        (Stored::Records, Value::Array(xs)) => {
            replace(m);
            todo.push(Sync::Rows(edit(m.ensure_mergeable_movable_list(key)), xs, down()));
        }
        // an array its schema holds as one value (a tuple, a list of objects): one value, as any other
        (Stored::Value, Value::Array(_)) => edit(m.insert(key, loro(w))),
        (_, Value::Array(xs)) => {
            replace(m);
            sync_values(&edit(m.ensure_mergeable_list(key)), xs);
        }
        _ => edit(m.insert(key, loro(w))),
    }
}

fn update_text(t: &LoroText, s: &str) {
    t.update(s, UpdateOptions::default()).expect("without a timeout the diff always finishes");
}

/// Make list `l` hold `want` by the fewest deletions and insertions: the values both hold in the same order stay.
fn sync_values(l: &LoroList, want: &[Value]) {
    let have = l.get_deep_value().to_json_value();
    let have = have.as_array().cloned().unwrap_or_default();
    let (n, m) = (have.len(), want.len());
    // the longest common subsequence from each pair of positions on
    let mut common = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            common[i][j] =
                if have[i] == want[j] { common[i + 1][j + 1] + 1 } else { common[i + 1][j].max(common[i][j + 1]) };
        }
    }
    let (mut i, mut j, mut at) = (0, 0, 0);
    while i < n || j < m {
        if i < n && j < m && have[i] == want[j] {
            (i, j, at) = (i + 1, j + 1, at + 1);
        } else if j < m && (i == n || common[i][j + 1] >= common[i + 1][j]) {
            edit(l.insert(at, loro(&want[j])));
            (j, at) = (j + 1, at + 1);
        } else {
            edit(l.delete(at, 1));
            i += 1;
        }
    }
}

/// A record's key in a list: its id and how many records before it have that id; for one without an id, how many
/// such come before it.
type Key = (Option<Value>, usize);

fn keys(list: &[Value]) -> Vec<Key> {
    let mut seen: HashMap<Option<Value>, usize> = HashMap::new();
    list.iter()
        .map(|e| {
            let id = e.as_object().and_then(|r| present(r, "id")).cloned();
            let n = seen.entry(id.clone()).or_default();
            *n += 1;
            (id, *n - 1)
        })
        .collect()
}

/// Make the movable list of records `l` hold `want`: records it no longer has are deleted; of those it keeps, the
/// longest run already in the wanted order stays where it is and each other moves next to the record before it; new
/// records are inserted; each record is then left to sync field by field, once the list holds its rows in order.
/// Concurrent edits inside a record that moved still land in it. `lists` are the lists down to this one, its own last.
fn sync_records<'a>(l: &LoroMovableList, want: &'a [Value], lists: Vec<String>, todo: &mut Vec<Sync<'a>>) {
    let have = l.get_deep_value().to_json_value();
    let have = have.as_array().cloned().unwrap_or_default();
    let (hk, wk) = (keys(&have), keys(want));
    let wanted: HashSet<&Key> = wk.iter().collect();
    for i in (0..hk.len()).rev() {
        if !wanted.contains(&hk[i]) {
            edit(l.delete(i, 1));
        }
    }
    let mut now: Vec<Key> = hk.into_iter().filter(|k| wanted.contains(k)).collect();
    let place: HashMap<&Key, usize> = wk.iter().enumerate().map(|(j, k)| (k, j)).collect();
    let order: Vec<usize> = now.iter().map(|k| place[k]).collect();
    let stay: HashSet<usize> = longest_increasing(&order).into_iter().map(|i| order[i]).collect();
    let mut prev: Option<usize> = None;
    for (j, k) in wk.iter().enumerate() {
        let at = match now.iter().position(|x| x == k) {
            Some(i) if stay.contains(&j) => i,
            Some(i) => {
                let to = match prev {
                    None => 0,
                    Some(p) if i > p => p + 1,
                    Some(p) => p,
                };
                if i != to {
                    edit(l.mov(i, to));
                    let x = now.remove(i);
                    now.insert(to, x);
                }
                to
            }
            None => {
                let to = prev.map_or(0, |p| p + 1);
                edit(l.insert_container(to, LoroMap::new()));
                now.insert(to, k.clone());
                to
            }
        };
        match (l.get(at), want[j].as_object()) {
            (Some(ValueOrContainer::Container(Container::Map(m))), Some(r)) => {
                todo.push(Sync::Map(m, r, lists.clone()));
            }
            // something that isn't a record, which the lens never changes: kept as it is
            (Some(ValueOrContainer::Value(v)), _) if v.to_json_value() == want[j] => {}
            _ => edit(l.set(at, loro(&want[j]))),
        }
        prev = Some(at);
    }
    debug_assert_eq!(now, wk);
}

/// The positions of a longest strictly increasing run in `xs`, not necessarily contiguous.
fn longest_increasing(xs: &[usize]) -> Vec<usize> {
    // tails[k]: the position of the smallest last value of a run of length k + 1
    let mut tails: Vec<usize> = vec![];
    let mut back: Vec<Option<usize>> = vec![None; xs.len()];
    for i in 0..xs.len() {
        let k = tails.partition_point(|&t| xs[t] < xs[i]);
        back[i] = k.checked_sub(1).map(|k| tails[k]);
        if k == tails.len() {
            tails.push(i);
        } else {
            tails[k] = i;
        }
    }
    let mut out = vec![];
    let mut at = tails.last().copied();
    while let Some(i) = at {
        out.push(i);
        at = back[i];
    }
    out.reverse();
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::lens::example::{BlockV0, KindV0, DOCUMENT_V0};
    use crate::lens::{TypeV1, DOCUMENT_V1};

    const ALICE: SignerId = SignerId::from_u64(2);
    const BOB: SignerId = SignerId::from_u64(5);
    const CAROL: SignerId = SignerId::from_u64(7);
    const WELCOME: &str = "Welcome to Maia Coop: the greenhouse opens at eight.";
    const NINE: &str = "Welcome to Maia Coop: the greenhouse opens at nine.";

    fn block(id: u64, r#type: TypeV1, text: &str) -> BlockV1 {
        BlockV1 { id, r#type, level: None, checked: None, lang: None, text: text.into() }
    }

    /// A heading (block 1) and a paragraph (block 2), made on `signer`'s device.
    fn welcome(signer: SignerId) -> Item {
        let mut item = Item::document("Welcome", signer);
        item.push_block(BlockV1 { level: Some(1), ..block(1, TypeV1::Heading, "Welcome") });
        item.push_block(block(2, TypeV1::Paragraph, WELCOME));
        item
    }

    fn text(item: &Item, id: u64) -> Option<String> {
        item.as_document()?.blocks.into_iter().find(|b| b.id == id).map(|b| b.text)
    }

    /// The document as the example's v1 app, which has the lens from v0, reads it.
    fn through_lens(item: &Item) -> Option<DocV1> {
        DocV1::from_value(&item.read(example::document_v1())?)
    }

    /// Edit the document as the example's v1 app sees it.
    fn edit_through_lens(item: &mut Item, change: impl FnOnce(&mut DocV1)) -> bool {
        let Some(mut d) = through_lens(item) else { return false };
        change(&mut d);
        item.write(example::document_v1(), &d.to_value())
    }

    /// `a` and `b` after each imports what the other wrote since `start`.
    fn merge(a: &mut Item, a_signer: SignerId, b: &mut Item, b_signer: SignerId, start: &Version) {
        let (from_a, from_b) = (a.export(start), b.export(start));
        a.import(&from_b, b_signer).unwrap();
        b.import(&from_a, a_signer).unwrap();
    }

    #[test]
    fn a_documents_blocks_round_trip() {
        let mut doc = welcome(ALICE);
        let code = BlockV1 { lang: Some("sh".into()), ..block(3, TypeV1::Code, "open greenhouse --at 8") };
        let item = BlockV1 { checked: Some(true), ..block(u64::MAX, TypeV1::Item, "Water the seedlings") };
        doc.push_block(code.clone());
        doc.push_block(item.clone());
        doc.set_text(2, NINE);
        doc.set_text(99, "no such block");
        let shown = doc.as_document().unwrap();
        assert_eq!((shown.title.as_str(), shown.blocks[0].level), ("Welcome", Some(1)));
        assert_eq!(shown.blocks[1].text, NINE);
        assert_eq!(shown.blocks[2..], [code, item]);
        assert!(shown.tags.is_empty() && doc.as_todo().is_none());
    }

    #[test]
    fn a_todos_status_round_trips() {
        let title = "Fix the greenhouse door";
        let mut todo = Item::todo(title, ALICE);
        let open = TodoV1 { title: title.into(), status: Status::Open, notes: String::new(), due: None };
        assert_eq!(todo.as_todo(), Some(open));
        assert!(todo.as_document().is_none());
        for status in [Status::Doing, Status::Done] {
            todo.set_status(status);
            assert_eq!(todo.as_todo().unwrap().status, status);
        }
        // and as another device shows it
        let mut bobs = Item::new(BOB);
        bobs.import(&todo.export(&Version::default()), ALICE).unwrap();
        assert_eq!(bobs.as_todo().unwrap().status, Status::Done);
    }

    #[test]
    fn reading_writes_nothing_not_even_a_default() {
        // an app that puts back the view it read changes nothing, through the lens too: no op at all (T9g)
        let mut doc = welcome(ALICE);
        let mut todo = Item::todo("Order seeds", ALICE);
        let before = (doc.version(), todo.version());
        for view in [example::document_v0(), example::document_v1(), View::document_v1()] {
            let seen = doc.read(view).unwrap();
            assert!(doc.write(view, &seen));
        }
        for view in [example::todo_v0(), example::todo_v1(), View::todo_v1()] {
            let seen = todo.read(view).unwrap();
            assert!(todo.write(view, &seen));
        }
        assert_eq!((doc.version(), todo.version()), before);
        // the todo's open status and empty notes, and the document's empty tags, are the schemas' defaults: not stored
        assert_eq!(todo.record(), json!({"kind": "todo", "title": "Order seeds"}));
        assert!(doc.record().get("tags").is_none());
    }

    #[test]
    fn a_value_that_isnt_a_view_writes_nothing() {
        let mut doc = welcome(ALICE);
        let before = doc.version();
        let chapter = json!({"kind": "document", "blocks": [{"id": 1, "type": "chapter"}]});
        let twice = json!({"kind": "document", "blocks": [{"id": 1, "type": "paragraph"}, {"id": 1, "type": "code"}]});
        for bad in [chapter, twice, json!({"kind": "todo"}), json!("Welcome")] {
            assert!(!doc.write(View::document_v1(), &bad), "{bad}");
        }
        assert!(!doc.edit_document(|d| d.blocks.push(block(1, TypeV1::Code, "a second block 1"))));
        assert_eq!(doc.version(), before);
        assert!(Item::made(View::todo_v1(), &json!({"kind": "document"}), BOB).is_none());
    }

    #[test]
    fn each_change_names_the_schema_it_was_written_under() {
        let heading = BlockV0 { id: 1, kind: KindV0::H1, text: "Welcome".into() };
        let v0 = DocV0 { title: "Welcome".into(), blocks: vec![heading] };
        let mut doc = Item::written_v0(&v0, ALICE);
        assert_eq!(doc.authored(), BTreeSet::from([DOCUMENT_V0.id()]));
        // a v1 app reads it through the lens, and an edit that changes nothing tags nothing
        let heading = BlockV1 { level: Some(1), ..block(1, TypeV1::Heading, "Welcome") };
        assert_eq!(through_lens(&doc).unwrap().blocks[0], heading);
        assert!(edit_through_lens(&mut doc, |_| {}));
        assert_eq!(doc.authored(), BTreeSet::from([DOCUMENT_V0.id()]));
        assert!(edit_through_lens(&mut doc, |d| d.tags.push("coop".into())));
        assert_eq!(doc.authored(), BTreeSet::from([DOCUMENT_V0.id(), DOCUMENT_V1.id()]));
        // another device reads the same tags off the updates it imports
        let mut bobs = Item::new(BOB);
        bobs.import(&doc.export(&Version::default()), ALICE).unwrap();
        assert_eq!(bobs.authored(), doc.authored());
        assert!(Item::new(CAROL).authored().is_empty());
    }

    #[test]
    fn a_record_put_back_names_no_schema_and_a_copy_names_them_all() {
        let heading = BlockV0 { id: 1, kind: KindV0::H1, text: "Welcome".into() };
        let mut doc = Item::written_v0(&DocV0 { title: "Welcome".into(), blocks: vec![heading] }, ALICE);
        let first = doc.record();
        assert!(edit_through_lens(&mut doc, |d| d.tags.push("coop".into())));
        let both = BTreeSet::from([DOCUMENT_V0.id(), DOCUMENT_V1.id()]);
        // a restore of the first version writes the change back, under no schema of its own
        let mut bobs = doc.fork_as(BOB);
        bobs.put_record(&first);
        assert_eq!((bobs.record(), bobs.authored()), (first, both.clone()));
        // a copy has one change, naming both schemas
        let copy = doc.copy(CAROL);
        assert_eq!((copy.record(), copy.authored()), (doc.record(), both));
        assert_eq!(copy.doc.oplog_vv().len(), 1);
    }

    #[test]
    fn a_field_two_devices_add_at_once_merges() {
        // nobody had tagged the document, and block 3 had no text yet: each device makes the container, and the two
        // are one, so neither edit hides the other
        let mut base = welcome(ALICE);
        base.push_block(block(3, TypeV1::Paragraph, ""));
        assert!(base.record()["blocks"][2].get("text").is_none());
        let start = base.version();
        let (mut alices, mut bobs) = (base.fork_as(ALICE), base.fork_as(BOB));
        alices.edit_document(|d| d.tags.push("coop".into()));
        alices.set_text(3, "Seeds");
        bobs.edit_document(|d| d.tags.push("greenhouse".into()));
        bobs.set_text(3, "Water");
        merge(&mut alices, ALICE, &mut bobs, BOB, &start);
        assert_eq!(alices.as_document(), bobs.as_document());
        let mut tags = alices.as_document().unwrap().tags;
        tags.sort();
        assert_eq!(tags, ["coop", "greenhouse"]);
        let both = text(&alices, 3).unwrap();
        assert!(both == "SeedsWater" || both == "WaterSeeds", "{both}");
    }

    #[test]
    fn a_text_edit_lands_in_its_block_after_a_concurrent_move() {
        let base = welcome(ALICE);
        let start = base.version();
        let (mut alices, mut bobs) = (base.fork_as(ALICE), base.fork_as(BOB));
        assert!(alices.edit_document(|d| d.blocks.reverse()));
        bobs.set_text(2, NINE);
        merge(&mut alices, ALICE, &mut bobs, BOB, &start);
        let doc = alices.as_document().unwrap();
        assert_eq!(doc.blocks.iter().map(|b| b.id).collect::<Vec<_>>(), [2, 1]);
        assert_eq!(doc.blocks[0].text, NINE);
        assert_eq!(alices.as_document(), bobs.as_document());
    }

    #[test]
    fn an_item_stores_exactly_the_record_it_is_given() {
        // records no single app writes: both versions' fields in one block, a field no schema knows, records moved,
        // added and dropped, a text where a plain value was and back
        let mut item = welcome(ALICE);
        let records = [
            json!({"kind": "document", "title": "Welcome", "x": 3, "tags": ["a", "b"], "blocks": [
                {"id": 2, "kind": "p", "type": "paragraph", "text": "Two"},
                {"id": 7, "kind": "h2"},
                {"id": 1, "type": "heading", "level": 1, "text": "Welcome"}]}),
            json!({"kind": "document", "title": 5, "tags": ["b"], "blocks": [
                {"id": 1, "type": "heading", "text": "Welcome back"},
                {"id": 9, "type": "code", "lang": "sh", "text": "ls"},
                {"id": 2, "kind": "p", "text": "Two"}]}),
            json!({"kind": "document", "title": "Welcome", "blocks": []}),
            json!({"kind": "document"}),
        ];
        for record in records {
            item.set_record(View::document_v1(), &record);
            assert_eq!(item.record(), record);
        }
    }

    #[test]
    fn an_empty_item_shows_nothing_until_it_imports_the_first_write() {
        let mut reader = Item::new(BOB);
        assert!(reader.as_document().is_none() && reader.as_todo().is_none());
        assert_eq!(reader.version(), Version::default());
        let doc = welcome(ALICE);
        reader.import(&doc.export(&Version::default()), ALICE).unwrap();
        assert_eq!(reader.as_document(), doc.as_document());
        assert_eq!(reader.version(), doc.version());
    }

    #[test]
    fn exports_are_deterministic() {
        // no clock and no random peer in the updates: the same edits export the same bytes, run after run
        let edits = || {
            let mut doc = welcome(ALICE);
            doc.set_text(2, NINE);
            let mut todo = Item::todo("Order seeds", BOB);
            todo.set_status(Status::Doing);
            [doc.export(&Version::default()), todo.export(&Version::default())]
        };
        let updates = edits();
        assert_eq!(updates, edits());
        for u in &updates {
            assert_eq!(LoroDoc::decode_import_blob_meta(u, true).unwrap().end_timestamp, 0);
        }
    }

    #[test]
    fn each_signer_edits_as_its_own_peer() {
        assert_eq!(peer(ALICE, None), peer(ALICE, None));
        assert_ne!(peer(ALICE, None), peer(BOB, None));
        let b = Some(crate::id::EditId::from_u64(1));
        assert!(peer(ALICE, b) != peer(ALICE, None) && peer(ALICE, b) != peer(BOB, b));
        assert_ne!(peer(ALICE, b), peer(ALICE, Some(crate::id::EditId::from_u64(2))));
        let doc = welcome(ALICE);
        let meta = LoroDoc::decode_import_blob_meta(&doc.export(&Version::default()), true).unwrap();
        assert_eq!(meta.partial_end_vv.keys().collect::<Vec<_>>(), [&peer(ALICE, None)]);
        assert_eq!(doc.fork_as(BOB).doc.peer_id(), peer(BOB, None));
        // a draft's creation is its signer's draft peer of its entry, no line's, and imports as that alone
        let (e, f) = (EntryId::from_u64(1), EntryId::from_u64(2));
        let draft = Peer::Draft(ALICE, e).id();
        assert!(draft != peer(ALICE, None) && draft != peer(ALICE, b) && draft != Peer::Draft(BOB, e).id());
        assert_ne!(draft, Peer::Draft(ALICE, f).id());
        let mut made = Item::draft(ALICE, e);
        made.set_record(View::document_v1(), &serde_json::json!({ "kind": "document", "title": "A draft" }));
        let update = made.export(&Version::default());
        assert_eq!(Item::new(BOB).import(&update, ALICE), Err(DocError::WrongPeer), "no line's peer");
        let mut read = Item::new(BOB);
        assert_eq!(read.import_as(&update, Peer::Draft(ALICE, f)), Err(DocError::WrongPeer), "nor another entry's");
        read.import_as(&update, Peer::Draft(ALICE, e)).expect("its draft peer's");
        assert_eq!(read.record(), made.record());
        // the ids Loro keeps for itself are never ours
        assert!([PeerID::MAX, PeerID::MAX - 2].iter().all(|&p| usable(p) <= PeerID::MAX - RESERVED));
        assert_eq!(usable(7), 7);
    }

    #[test]
    fn concurrent_edits_of_one_text_merge() {
        let base = welcome(ALICE);
        let start = base.version();
        let (mut alices, mut bobs) = (base.fork_as(ALICE), base.fork_as(BOB));
        alices.set_text(2, NINE);
        bobs.set_text(2, "Hello from Maia Coop: the greenhouse opens at eight.");
        merge(&mut alices, ALICE, &mut bobs, BOB, &start);
        let merged = Some("Hello from Maia Coop: the greenhouse opens at nine.".to_string());
        assert_eq!((text(&alices, 2), text(&bobs, 2)), (merged.clone(), merged));
    }

    #[test]
    fn a_malformed_update_is_refused() {
        let base = welcome(ALICE);
        let start = base.version();
        let mut bobs = base.fork_as(BOB);
        bobs.set_text(2, NINE);
        let update = bobs.export(&start);
        let mut flipped = update.clone();
        *flipped.last_mut().unwrap() ^= 1;
        let mut alices = base.fork_as(ALICE);
        // garbage, cut short, a byte changed, and a snapshot (its state would be taken as is)
        for bad in [&b"not a loro update"[..], &update[..update.len() - 1], &flipped[..], &bobs.bytes()[..]] {
            assert_eq!(alices.import(bad, BOB), Err(DocError::Malformed));
        }
        assert_eq!(alices.version(), start);
    }

    #[test]
    fn an_update_carrying_another_peers_ops_is_refused() {
        // Carol passes Bob's edit on inside her own write: his ops carry his peer, so it isn't hers
        let base = welcome(ALICE);
        let start = base.version();
        let mut bobs = base.fork_as(BOB);
        bobs.set_text(2, NINE);
        let mut carols = base.fork_as(CAROL);
        carols.import(&bobs.export(&start), BOB).unwrap();
        carols.set_text(1, "Welcome, everyone");
        let mut alices = base.fork_as(ALICE);
        assert_eq!(alices.import(&carols.export(&start), CAROL), Err(DocError::WrongPeer));
        assert_eq!(alices.version(), start);
    }

    #[test]
    fn an_update_that_arrives_early_waits_for_what_it_builds_on() {
        let base = welcome(ALICE);
        let start = base.version();
        let mut alices = base.fork_as(ALICE);
        alices.set_text(2, NINE);
        let from_alice = alices.export(&start);
        let mut bobs = base.fork_as(BOB);
        bobs.import(&from_alice, ALICE).unwrap();
        let seen = bobs.version();
        bobs.set_text(1, "Welcome, everyone");
        let from_bob = bobs.export(&seen);
        // Carol gets Bob's edit first: it waits, then lands with Alice's, which it builds on
        let mut carols = base.fork_as(CAROL);
        carols.import(&from_bob, BOB).unwrap();
        assert_eq!(carols.as_document(), base.as_document());
        carols.import(&from_alice, ALICE).unwrap();
        assert_eq!(carols.as_document(), bobs.as_document());
        assert!(carols.parked.is_empty());
    }

    #[test]
    fn only_the_signers_ops_and_parked_ones_may_land() {
        let vv = |e: &[(PeerID, Counter)]| e.iter().copied().collect::<VersionVector>();
        let parked = BTreeMap::from([(9, 4)]);
        assert!(!smuggled(&vv(&[(5, 2)]), &vv(&[(5, 6), (9, 4)]), 5, &parked));
        assert!(smuggled(&vv(&[(5, 2)]), &vv(&[(5, 2), (7, 1)]), 5, &parked));
        assert!(smuggled(&vv(&[]), &vv(&[(9, 5)]), 5, &parked));
        // and when something else lands anyway, the item goes back to what it held before
        let base = welcome(ALICE);
        let (start, frontiers) = (base.version(), base.doc.oplog_frontiers());
        let mut bobs = base.fork_as(BOB);
        bobs.set_text(2, NINE);
        let mut alices = base.fork_as(ALICE);
        alices.import(&bobs.export(&start), BOB).unwrap();
        alices.put_back(&frontiers);
        assert_eq!((alices.version(), alices.as_document()), (start, base.as_document()));
        assert_eq!(alices.doc.peer_id(), peer(ALICE, None));
    }

    #[test]
    fn a_shallow_snapshot_refuses_a_proposal_from_before_it() {
        // main moves on from Welcome's first version, and a proposal starts from that version
        let base = welcome(ALICE);
        let start = base.version();
        let mut main = base.clone();
        main.set_text(2, NINE);
        let mut proposal = base.fork_on(BOB, Some(crate::id::EditId::from_u64(1)));
        proposal.set_text(1, "Welcome, everyone");
        let update = proposal.export(&start);
        // a device that compacted main into a shallow snapshot can't take the proposal's edit
        let shallow = main.doc.export(ExportMode::shallow_snapshot(&main.doc.oplog_frontiers())).unwrap();
        let compacted = LoroDoc::new();
        compacted.import(&shallow).unwrap();
        assert!(compacted.import(&update).is_err());
        // the full snapshot every device stores takes it
        let mut restored = Item::on(LoroDoc::new(), peer(ALICE, None));
        restored.doc.import(&main.bytes()).unwrap();
        restored.import_on(&update, BOB, Some(crate::id::EditId::from_u64(1))).unwrap();
        let shown = (text(&restored, 1), text(&restored, 2));
        assert_eq!((shown.0.as_deref(), shown.1.as_deref()), (Some("Welcome, everyone"), Some(NINE)));
    }

    #[test]
    fn the_longest_run_already_in_order_stays() {
        assert_eq!(longest_increasing(&[]), Vec::<usize>::new());
        assert_eq!(longest_increasing(&[2, 0, 3, 1]), [1, 3]);
        assert_eq!(longest_increasing(&[0, 1, 2]), [0, 1, 2]);
        assert_eq!(longest_increasing(&[2, 1, 0]).len(), 1);
    }
}
