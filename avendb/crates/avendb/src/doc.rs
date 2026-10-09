//! The two example items, each one Loro document: a markdown document and a todo. An item's Loro updates are what
//! gets encrypted into `Write` ops and synced. Its content depends only on which updates it holds (Loro converges), so
//! devices holding the same writes show the same item (T11, T13).
//!
//! An item is one root map, `item`: the stored record, holding the fields of every schema version that wrote it
//! (`lens`). Free text is a Loro text, so concurrent edits of it merge character by character; a list of records (a
//! document's blocks) is a movable list of maps, each with its `id`; a list of values (tags) a Loro list; anything else
//! one value, where concurrent edits keep one of them. A container that appears after the item was made (a document's
//! first tag, the text of a block that had none) is created mergeable, so two devices creating it at once share it
//! instead of one hiding the other.
//!
//! Every edit goes through an app's view (`lens::View`): the app edits what it sees, the lens turns that into the new
//! stored record, and the item makes the smallest change that holds it. Each change carries the view's schema as its
//! Loro commit message, so a reader knows which versions wrote an item (`authored`). A promote, restore or undo puts
//! back a record those versions wrote (`put_record`), and names none; a copy into a new entry names them all (`copy`).
//!
//! Each device edits as a Loro peer of its own on each line of an item's history, derived from its signer and the
//! line, so an import can check that every op of a write is its signer's, and a device's edits on one line are one run
//! of ops that the line's history holds whole (`branch`). No clock goes into the updates: the same edits export the
//! same bytes.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use loro::{
    CommitOptions, Container, Counter, EncodedBlobMode, ExportMode, Frontiers, ID, LoroDoc, LoroList, LoroMap,
    LoroMovableList, LoroResult, LoroText, LoroValue, PeerID, ToJson, UpdateOptions, ValueOrContainer, VersionVector,
};
use serde_json::Value;

use crate::id::{BlobId, SignerId};
use crate::lens::{BlockV2, DocV1, DocV2, Record, Status, Stored, TodoV1, TodoV2, View};
use crate::policy::Line;

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

    /// A new markdown document made by a v2 app on `signer`'s device: its edits carry that signer's Loro peer. Only
    /// what differs from the schema's defaults is written: its kind and title.
    pub fn document(title: &str, signer: SignerId) -> Item {
        let doc = DocV2 { title: title.into(), blocks: vec![], tags: vec![] };
        Item::made(View::document_v2(), &doc.to_value(), signer).expect("a v2 document")
    }

    /// A document as an app still on v1 writes it, on `signer`'s device. Its block ids must differ.
    pub fn written_v1(doc: &DocV1, signer: SignerId) -> Item {
        Item::made(View::document_v1(), &doc.to_value(), signer).expect("a v1 document, each block id once")
    }

    /// A new todo made by a v2 app: its status is open by the schema's default, and not written.
    pub fn todo(title: &str, signer: SignerId) -> Item {
        let todo = TodoV2 { title: title.into(), status: Status::Open, notes: String::new(), due: None };
        Item::made(View::todo_v2(), &todo.to_value(), signer).expect("a v2 todo")
    }

    /// A todo as an app still on v1 writes it.
    pub fn todo_v1(todo: &TodoV1, signer: SignerId) -> Item {
        Item::made(View::todo_v1(), &todo.to_value(), signer).expect("a v1 todo")
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
        sync_map(&self.root(), &want, view, None);
        self.doc.commit_with(CommitOptions::new().commit_msg(&view.schema().id().to_hex()));
        debug_assert_eq!(self.record(), Value::Object(want));
    }

    /// Make the item store exactly `record` by the smallest change, as a promote, a restore or an undo does: the record
    /// is one the item's own changes wrote, so this change names no schema. The built-in views of the record's kind say
    /// which new fields are texts.
    pub fn put_record(&mut self, record: &Value) {
        let want = record.as_object().cloned().unwrap_or_default();
        sync_map(&self.root(), &want, kind_view(record), None);
        self.doc.commit();
        debug_assert_eq!(self.record(), Value::Object(want));
    }

    /// A new item on `signer`'s device that stores exactly this one's record, and none of its history: one change,
    /// naming every schema this one was written under, so apps read the copy as they read this one. A fork into another
    /// entry starts from it.
    pub fn copy(&self, signer: SignerId) -> Item {
        let item = Item::new(signer);
        let record = self.record();
        sync_map(&item.root(), &record.as_object().cloned().unwrap_or_default(), kind_view(&record), None);
        let names: Vec<String> = self.authored().iter().map(BlobId::to_hex).collect();
        if names.is_empty() {
            item.doc.commit();
        } else {
            item.doc.commit_with(CommitOptions::new().commit_msg(&names.join(" ")));
        }
        item
    }

    /// The schemas the item's changes were written under, by their commit messages: each names one, or for a copy
    /// several, apart by spaces. A change without one (a promote, a restore, an undo) names none.
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

    /// The item as a v2 app reads it, through the lens where a v1 app wrote it; `None` for a todo.
    pub fn as_document(&self) -> Option<DocV2> {
        DocV2::from_value(&self.read(View::document_v2())?)
    }

    /// The item as a v1 app that has the lens reads it; `None` for a todo.
    pub fn as_document_v1(&self) -> Option<DocV1> {
        DocV1::from_value(&self.read(View::document_v1())?)
    }

    /// The item as a v2 todo app reads it; `None` for a document.
    pub fn as_todo(&self) -> Option<TodoV2> {
        TodoV2::from_value(&self.read(View::todo_v2())?)
    }

    /// The item as a v1 todo app that has the lens reads it; `None` for a document.
    pub fn as_todo_v1(&self) -> Option<TodoV1> {
        TodoV1::from_value(&self.read(View::todo_v1())?)
    }

    /// Edit the document as a v2 app sees it. False if it isn't a document, or `change` leaves two blocks with one id.
    pub fn edit_document(&mut self, change: impl FnOnce(&mut DocV2)) -> bool {
        let Some(mut d) = self.as_document() else { return false };
        change(&mut d);
        self.write(View::document_v2(), &d.to_value())
    }

    /// Edit the document as a v1 app sees it.
    pub fn edit_document_v1(&mut self, change: impl FnOnce(&mut DocV1)) -> bool {
        let Some(mut d) = self.as_document_v1() else { return false };
        change(&mut d);
        self.write(View::document_v1(), &d.to_value())
    }

    /// Edit the todo as a v2 app sees it.
    pub fn edit_todo(&mut self, change: impl FnOnce(&mut TodoV2)) -> bool {
        let Some(mut t) = self.as_todo() else { return false };
        change(&mut t);
        self.write(View::todo_v2(), &t.to_value())
    }

    /// Edit the todo as a v1 app sees it.
    pub fn edit_todo_v1(&mut self, change: impl FnOnce(&mut TodoV1)) -> bool {
        let Some(mut t) = self.as_todo_v1() else { return false };
        change(&mut t);
        self.write(View::todo_v1(), &t.to_value())
    }

    /// Append a block to a document (a todo has none).
    pub fn push_block(&mut self, block: BlockV2) {
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
        let meta = LoroDoc::decode_import_blob_meta(update, true).map_err(|_| DocError::Malformed)?;
        if meta.mode != EncodedBlobMode::Updates {
            return Err(DocError::Malformed);
        }
        let peer = peer(signer, line);
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

    /// The history up to `frontiers` and nothing after, as before an import that went wrong.
    fn put_back(&mut self, frontiers: &Frontiers) {
        let doc = self.doc.fork_at(frontiers).expect("a version the item held");
        *self = Item::on(doc, self.peer);
    }

    fn root(&self) -> LoroMap {
        self.doc.get_map(ROOT)
    }
}

/// A deep copy that edits as the same device: only one of the two may edit from then on, or two different ops would
/// carry one id. `fork_as` gives another device's copy.
impl Clone for Item {
    fn clone(&self) -> Item {
        Item::on(self.doc.fork(), self.peer)
    }
}

/// The Loro peer of `signer`'s edits on line `line`: the first 8 bytes of a hash of the signer, and on a branch of the
/// branch too. Two signers, or two lines, share a peer only by a 64-bit collision.
fn peer(signer: SignerId, line: Line) -> PeerID {
    let h = match line {
        None => crate::hash::hash("loro peer", &signer.0),
        Some(b) => crate::hash::hash("loro peer on a branch", &[signer.0, b.0].concat()),
    };
    usable(u64::from_be_bytes(*h.first_chunk().expect("32 bytes")))
}

/// The built-in view of a record's kind: a todo's, or else a document's. Fields neither knows are stored by what they
/// hold.
fn kind_view(record: &Value) -> &'static View {
    match record.get("kind").and_then(Value::as_str) {
        Some("todo") => View::todo_v2(),
        _ => View::document_v2(),
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

/// Make map `m` hold exactly `want`: each key whose value differs is set, deleted, or for a container brought to its
/// new content by the smallest change, so concurrent edits of other parts merge. `list` names the list whose record
/// `m` is.
fn sync_map(m: &LoroMap, want: &Record, view: &View, list: Option<&str>) {
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
            Some(w) => set_key(m, key, w, view, list),
        }
    }
}

/// Set `key` of `m` to `w`, a container the way the view's schemas store the field.
fn set_key(m: &LoroMap, key: &str, w: &Value, view: &View, list: Option<&str>) {
    let stored = view.stored(list, key).unwrap_or(match w {
        Value::Array(xs) if list.is_none() && xs.iter().any(Value::is_object) => Stored::Records,
        Value::Array(_) => Stored::List,
        _ => Stored::Value,
    });
    let now = m.get(key);
    match (&now, w) {
        (Some(ValueOrContainer::Container(Container::Text(t))), Value::String(s)) => return update_text(t, s),
        (Some(ValueOrContainer::Container(Container::MovableList(l))), Value::Array(xs)) => {
            return sync_records(l, xs, view, key);
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
        (Stored::Records, Value::Array(xs)) if list.is_none() => {
            replace(m);
            sync_records(&edit(m.ensure_mergeable_movable_list(key)), xs, view, key);
        }
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
/// records are inserted; each record is then synced field by field. Concurrent edits inside a record that moved still
/// land in it.
fn sync_records(l: &LoroMovableList, want: &[Value], view: &View, field: &str) {
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
            (Some(ValueOrContainer::Container(Container::Map(m))), Some(r)) => sync_map(&m, r, view, Some(field)),
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
    use crate::lens::{BlockV1, KindV1, TypeV2, DOCUMENT_V1, DOCUMENT_V2};

    const ALICE: SignerId = SignerId::from_u64(2);
    const BOB: SignerId = SignerId::from_u64(5);
    const CAROL: SignerId = SignerId::from_u64(7);
    const WELCOME: &str = "Welcome to Maia Coop: the greenhouse opens at eight.";
    const NINE: &str = "Welcome to Maia Coop: the greenhouse opens at nine.";

    fn block(id: u64, r#type: TypeV2, text: &str) -> BlockV2 {
        BlockV2 { id, r#type, level: None, checked: None, lang: None, text: text.into() }
    }

    /// A heading (block 1) and a paragraph (block 2), made on `signer`'s device.
    fn welcome(signer: SignerId) -> Item {
        let mut item = Item::document("Welcome", signer);
        item.push_block(BlockV2 { level: Some(1), ..block(1, TypeV2::Heading, "Welcome") });
        item.push_block(block(2, TypeV2::Paragraph, WELCOME));
        item
    }

    fn text(item: &Item, id: u64) -> Option<String> {
        item.as_document()?.blocks.into_iter().find(|b| b.id == id).map(|b| b.text)
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
        let code = BlockV2 { lang: Some("sh".into()), ..block(3, TypeV2::Code, "open greenhouse --at 8") };
        let item = BlockV2 { checked: Some(true), ..block(u64::MAX, TypeV2::Item, "Water the seedlings") };
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
        let open = TodoV2 { title: title.into(), status: Status::Open, notes: String::new(), due: None };
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
        for view in [View::document_v1(), View::document_v2()] {
            let seen = doc.read(view).unwrap();
            assert!(doc.write(view, &seen));
        }
        for view in [View::todo_v1(), View::todo_v2()] {
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
            assert!(!doc.write(View::document_v2(), &bad), "{bad}");
        }
        assert!(!doc.edit_document(|d| d.blocks.push(block(1, TypeV2::Code, "a second block 1"))));
        assert_eq!(doc.version(), before);
        assert!(Item::made(View::todo_v2(), &json!({"kind": "document"}), BOB).is_none());
    }

    #[test]
    fn each_change_names_the_schema_it_was_written_under() {
        let heading = BlockV1 { id: 1, kind: KindV1::H1, text: "Welcome".into() };
        let v1 = DocV1 { title: "Welcome".into(), blocks: vec![heading] };
        let mut doc = Item::written_v1(&v1, ALICE);
        assert_eq!(doc.authored(), BTreeSet::from([DOCUMENT_V1.id()]));
        // a v2 app reads it through the lens, and an edit that changes nothing tags nothing
        let heading = BlockV2 { level: Some(1), ..block(1, TypeV2::Heading, "Welcome") };
        assert_eq!(doc.as_document().unwrap().blocks[0], heading);
        assert!(doc.edit_document(|_| {}));
        assert_eq!(doc.authored(), BTreeSet::from([DOCUMENT_V1.id()]));
        assert!(doc.edit_document(|d| d.tags.push("coop".into())));
        assert_eq!(doc.authored(), BTreeSet::from([DOCUMENT_V1.id(), DOCUMENT_V2.id()]));
        // another device reads the same tags off the updates it imports
        let mut bobs = Item::new(BOB);
        bobs.import(&doc.export(&Version::default()), ALICE).unwrap();
        assert_eq!(bobs.authored(), doc.authored());
        assert!(Item::new(CAROL).authored().is_empty());
    }

    #[test]
    fn a_record_put_back_names_no_schema_and_a_copy_names_them_all() {
        let heading = BlockV1 { id: 1, kind: KindV1::H1, text: "Welcome".into() };
        let mut doc = Item::written_v1(&DocV1 { title: "Welcome".into(), blocks: vec![heading] }, ALICE);
        let first = doc.record();
        assert!(doc.edit_document(|d| d.tags.push("coop".into())));
        let both = BTreeSet::from([DOCUMENT_V1.id(), DOCUMENT_V2.id()]);
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
        base.push_block(block(3, TypeV2::Paragraph, ""));
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
            item.set_record(View::document_v2(), &record);
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
        let b = Some(crate::id::OpId::from_u64(1));
        assert!(peer(ALICE, b) != peer(ALICE, None) && peer(ALICE, b) != peer(BOB, b));
        assert_ne!(peer(ALICE, b), peer(ALICE, Some(crate::id::OpId::from_u64(2))));
        let doc = welcome(ALICE);
        let meta = LoroDoc::decode_import_blob_meta(&doc.export(&Version::default()), true).unwrap();
        assert_eq!(meta.partial_end_vv.keys().collect::<Vec<_>>(), [&peer(ALICE, None)]);
        assert_eq!(doc.fork_as(BOB).doc.peer_id(), peer(BOB, None));
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
    fn a_shallow_snapshot_refuses_a_branch_from_before_it() {
        // main moves on from Welcome's first version, and a branch starts from that version
        let base = welcome(ALICE);
        let start = base.version();
        let mut main = base.clone();
        main.set_text(2, NINE);
        let mut branch = base.fork_on(BOB, Some(crate::id::OpId::from_u64(1)));
        branch.set_text(1, "Welcome, everyone");
        let update = branch.export(&start);
        // a device that compacted main into a shallow snapshot can't take the branch's edit
        let shallow = main.doc.export(ExportMode::shallow_snapshot(&main.doc.oplog_frontiers())).unwrap();
        let compacted = LoroDoc::new();
        compacted.import(&shallow).unwrap();
        assert!(compacted.import(&update).is_err());
        // the full snapshot every device stores takes it
        let mut restored = Item::on(LoroDoc::new(), peer(ALICE, None));
        restored.doc.import(&main.bytes()).unwrap();
        restored.import_on(&update, BOB, Some(crate::id::OpId::from_u64(1))).unwrap();
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
