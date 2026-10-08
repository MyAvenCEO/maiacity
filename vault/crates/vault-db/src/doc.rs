//! The two example items, each one Loro document: a markdown document (a list of blocks, each block a map) and a todo
//! (a map). An item's Loro updates are what gets encrypted into `Write` ops and synced. Its content depends only on
//! which updates it holds (Loro converges), so devices holding the same writes show the same item (T11, T13).
//!
//! An item is one root map, `item`, whose `kind` says what it is. A document has a `title`, its `blocks` (a movable
//! list of maps, each with an `id`, a `type`, maybe a `level`, `checked` or `lang`, and its `text` as a Loro text) and
//! its `tags` (a list of strings). A v1 block names a `kind` where a v2 block has a `type`, so a reader tells the two
//! apart block by block. A todo has a `title`, a `status`, its `notes` (a Loro text) and maybe a `due` date.
//!
//! Each device edits as a Loro peer of its own, derived from its signer, so an import can check that every op of a
//! write is its signer's. No clock goes into the updates: the same edits export the same bytes.

use std::collections::BTreeMap;

use loro::{
    Counter, EncodedBlobMode, ExportMode, Frontiers, LoroDoc, LoroList, LoroMap, LoroMapValue, LoroMovableList,
    LoroResult, LoroText, LoroValue, PeerID, UpdateOptions, ValueOrContainer, VersionVector,
};

use crate::id::SignerId;
use crate::lens::{BlockV2, DocV1, DocV2, Status, TodoV2, TypeV2};

/// What a signer's Loro peer derives from.
const PEER_KEY: &str = "maiacity vault-db 2026-10-08 loro peer v1";

/// Peer ids at the very top are Loro's: it refuses `PeerID::MAX` and marks things internally with a few below it.
const RESERVED: u64 = 16;

/// The root map every item lives in.
const ROOT: &str = "item";

/// Block types and todo statuses as an item names them.
const TYPES: [(TypeV2, &str); 4] =
    [(TypeV2::Heading, "heading"), (TypeV2::Paragraph, "paragraph"), (TypeV2::Item, "item"), (TypeV2::Code, "code")];
const STATUSES: [(Status, &str); 3] = [(Status::Open, "open"), (Status::Doing, "doing"), (Status::Done, "done")];

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
        Item::on(LoroDoc::new(), peer(signer))
    }

    /// `doc` edited as `peer`, with no timestamps in its changes.
    fn on(doc: LoroDoc, peer: PeerID) -> Item {
        doc.set_peer_id(peer).expect("a peer id Loro takes");
        doc.set_record_timestamp(false);
        Item { doc, peer, parked: BTreeMap::new() }
    }

    /// A new markdown document under the v2 schema, made on `signer`'s device: its edits carry that signer's Loro peer.
    pub fn document(title: &str, signer: SignerId) -> Item {
        let item = Item::new(signer);
        let root = item.root();
        edit(root.insert("kind", "document"));
        edit(root.insert("title", title));
        edit(root.insert_container("blocks", LoroMovableList::new()));
        edit(root.insert_container("tags", LoroList::new()));
        item.doc.commit();
        item
    }

    /// A new todo under the v2 schema, made on `signer`'s device.
    pub fn todo(title: &str, signer: SignerId) -> Item {
        let item = Item::new(signer);
        let root = item.root();
        edit(root.insert("kind", "todo"));
        edit(root.insert("title", title));
        edit(root.insert("status", name(&STATUSES, Status::Open)));
        edit(root.insert_container("notes", LoroText::new()));
        item.doc.commit();
        item
    }

    /// A document as an app still on v1 writes it, on `signer`'s device.
    pub fn written_v1(doc: &DocV1, signer: SignerId) -> Item {
        let _ = (doc, signer);
        todo!("P4: v1 documents")
    }

    /// The same item as another device holds it, whose edits from now on are that device's.
    pub fn fork_as(&self, signer: SignerId) -> Item {
        Item::on(self.doc.fork(), peer(signer))
    }

    /// The migration commit's change: every block rewritten in v2 shape. Running it again changes nothing.
    pub fn migrate(&mut self) {
        todo!("P4: migration")
    }

    /// The item as a v1 app reads it: through the lens backwards; `None` for a todo.
    pub fn as_document_v1(&self) -> Option<DocV1> {
        todo!("P4: read through the lens")
    }

    /// The item as a v2 document, through the lens if it was written under v1; `None` for a todo.
    pub fn as_document(&self) -> Option<DocV2> {
        let item = self.content();
        if str_at(&item, "kind")? != "document" {
            return None;
        }
        Some(DocV2 {
            title: str_at(&item, "title").unwrap_or_default().into(),
            blocks: list_at(&item, "blocks").iter().filter_map(|b| block_v2(b.as_map()?)).collect(),
            tags: list_at(&item, "tags").iter().filter_map(|t| Some(t.as_string()?.as_str().into())).collect(),
        })
    }

    /// The item as a v2 todo, through the lens if it was written under v1; `None` for a document.
    pub fn as_todo(&self) -> Option<TodoV2> {
        let item = self.content();
        if str_at(&item, "kind")? != "todo" {
            return None;
        }
        Some(TodoV2 {
            title: str_at(&item, "title").unwrap_or_default().into(),
            // a v1 todo has `done` instead: the lens reads it
            status: named(&STATUSES, str_at(&item, "status")?)?,
            notes: str_at(&item, "notes").unwrap_or_default().into(),
            due: str_at(&item, "due").map(Into::into),
        })
    }

    /// Append a block to a document (a todo has none).
    pub fn push_block(&mut self, block: BlockV2) {
        let Some(blocks) = self.blocks() else { return };
        let b = edit(blocks.push_container(LoroMap::new()));
        // the id's 64 bits as Loro's integer, an i64
        edit(b.insert("id", block.id as i64));
        edit(b.insert("type", name(&TYPES, block.r#type)));
        if let Some(level) = block.level {
            edit(b.insert("level", i64::from(level)));
        }
        if let Some(checked) = block.checked {
            edit(b.insert("checked", checked));
        }
        if let Some(lang) = &block.lang {
            edit(b.insert("lang", lang.as_str()));
        }
        edit(edit(b.insert_container("text", LoroText::new())).insert(0, &block.text));
        self.doc.commit();
    }

    /// Replace the text of block `block` by the smallest character edit, so concurrent edits of it merge character by
    /// character. A block that isn't there (deleted meanwhile) is left alone.
    pub fn set_text(&mut self, block: u64, text: &str) {
        let Some(t) = self.block(block).and_then(|b| b.get("text")?.into_container().ok()?.into_text().ok()) else {
            return;
        };
        t.update(text, UpdateOptions::default()).expect("without a timeout the diff always finishes");
        self.doc.commit();
    }

    /// Set a todo's status (a document has none).
    pub fn set_status(&mut self, status: Status) {
        if self.kind().as_deref() == Some("todo") {
            edit(self.root().insert("status", name(&STATUSES, status)));
            self.doc.commit();
        }
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

    /// Import an update signed by `signer`, after checking its Loro peer ids belong to that signer.
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
    pub fn import(&mut self, update: &[u8], signer: SignerId) -> Result<(), DocError> {
        let meta = LoroDoc::decode_import_blob_meta(update, true).map_err(|_| DocError::Malformed)?;
        if meta.mode != EncodedBlobMode::Updates {
            return Err(DocError::Malformed);
        }
        let peer = peer(signer);
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

    fn kind(&self) -> Option<String> {
        Some(self.root().get("kind")?.into_value().ok()?.as_string()?.as_str().to_owned())
    }

    /// The item as plain values: its root map, texts read as strings.
    fn content(&self) -> LoroMapValue {
        self.root().get_deep_value().into_map().unwrap_or_default()
    }

    fn blocks(&self) -> Option<LoroMovableList> {
        self.root().get("blocks")?.into_container().ok()?.into_movable_list().ok()
    }

    fn block(&self, id: u64) -> Option<LoroMap> {
        let blocks = self.blocks()?;
        (0..blocks.len())
            .filter_map(|i| blocks.get(i)?.into_container().ok()?.into_map().ok())
            .find(|b| matches!(b.get("id"), Some(ValueOrContainer::Value(LoroValue::I64(n))) if n == id as i64))
    }
}

/// A deep copy that edits as the same device: only one of the two may edit from then on, or two different ops would
/// carry one id. `fork_as` gives another device's copy.
impl Clone for Item {
    fn clone(&self) -> Item {
        Item::on(self.doc.fork(), self.peer)
    }
}

/// The Loro peer of `signer`'s edits: the first 8 bytes of a keyed hash of the signer. Two signers share a peer only by
/// a 64-bit collision.
fn peer(signer: SignerId) -> PeerID {
    let mut h = blake3::Hasher::new_derive_key(PEER_KEY);
    h.update(&signer.0);
    usable(u64::from_be_bytes(*h.finalize().as_bytes().first_chunk().expect("32 bytes")))
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

fn name<T: PartialEq>(table: &[(T, &'static str)], value: T) -> &'static str {
    table.iter().find(|(v, _)| *v == value).map(|(_, n)| *n).expect("every value has a name")
}

fn named<T: Copy>(table: &[(T, &'static str)], name: &str) -> Option<T> {
    table.iter().find(|(_, n)| *n == name).map(|(v, _)| *v)
}

fn str_at<'a>(map: &'a LoroMapValue, key: &str) -> Option<&'a str> {
    Some(map.get(key)?.as_string()?.as_str())
}

fn list_at<'a>(map: &'a LoroMapValue, key: &str) -> &'a [LoroValue] {
    map.get(key).and_then(LoroValue::as_list).map(|l| l.as_slice()).unwrap_or_default()
}

/// A v2 block, or `None` for any other shape: a v1 block names a `kind` instead of a `type`, and the lens reads it.
fn block_v2(b: &LoroMapValue) -> Option<BlockV2> {
    Some(BlockV2 {
        id: *b.get("id")?.as_i64()? as u64,
        r#type: named(&TYPES, str_at(b, "type")?)?,
        level: b.get("level").and_then(LoroValue::as_i64).and_then(|&l| u8::try_from(l).ok()),
        checked: b.get("checked").and_then(LoroValue::as_bool).copied(),
        lang: str_at(b, "lang").map(Into::into),
        text: str_at(b, "text").unwrap_or_default().into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMUEL: SignerId = SignerId::from_u64(2);
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

    #[test]
    fn a_documents_blocks_round_trip() {
        let mut doc = welcome(SAMUEL);
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
        let mut todo = Item::todo(title, SAMUEL);
        let open = TodoV2 { title: title.into(), status: Status::Open, notes: String::new(), due: None };
        assert_eq!(todo.as_todo(), Some(open));
        assert!(todo.as_document().is_none());
        for status in [Status::Doing, Status::Done] {
            todo.set_status(status);
            assert_eq!(todo.as_todo().unwrap().status, status);
        }
        // and as another device shows it
        let mut bobs = Item::new(BOB);
        bobs.import(&todo.export(&Version::default()), SAMUEL).unwrap();
        assert_eq!(bobs.as_todo().unwrap().status, Status::Done);
    }

    #[test]
    fn an_empty_item_shows_nothing_until_it_imports_the_first_write() {
        let mut reader = Item::new(BOB);
        assert!(reader.as_document().is_none() && reader.as_todo().is_none());
        assert_eq!(reader.version(), Version::default());
        let doc = welcome(SAMUEL);
        reader.import(&doc.export(&Version::default()), SAMUEL).unwrap();
        assert_eq!(reader.as_document(), doc.as_document());
        assert_eq!(reader.version(), doc.version());
    }

    #[test]
    fn exports_are_deterministic() {
        // no clock and no random peer in the updates: the same edits export the same bytes, run after run
        let edits = || {
            let mut doc = welcome(SAMUEL);
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
        assert_eq!(peer(SAMUEL), peer(SAMUEL));
        assert_ne!(peer(SAMUEL), peer(BOB));
        let doc = welcome(SAMUEL);
        let meta = LoroDoc::decode_import_blob_meta(&doc.export(&Version::default()), true).unwrap();
        assert_eq!(meta.partial_end_vv.keys().collect::<Vec<_>>(), [&peer(SAMUEL)]);
        assert_eq!(doc.fork_as(BOB).doc.peer_id(), peer(BOB));
        // the ids Loro keeps for itself are never ours
        assert!([PeerID::MAX, PeerID::MAX - 2].iter().all(|&p| usable(p) <= PeerID::MAX - RESERVED));
        assert_eq!(usable(7), 7);
    }

    #[test]
    fn concurrent_edits_of_one_text_merge() {
        let base = welcome(SAMUEL);
        let start = base.version();
        let (mut samuels, mut bobs) = (base.fork_as(SAMUEL), base.fork_as(BOB));
        samuels.set_text(2, NINE);
        bobs.set_text(2, "Hello from Maia Coop: the greenhouse opens at eight.");
        let (from_samuel, from_bob) = (samuels.export(&start), bobs.export(&start));
        samuels.import(&from_bob, BOB).unwrap();
        bobs.import(&from_samuel, SAMUEL).unwrap();
        let merged = Some("Hello from Maia Coop: the greenhouse opens at nine.".to_string());
        assert_eq!((text(&samuels, 2), text(&bobs, 2)), (merged.clone(), merged));
    }

    #[test]
    fn a_malformed_update_is_refused() {
        let base = welcome(SAMUEL);
        let start = base.version();
        let mut bobs = base.fork_as(BOB);
        bobs.set_text(2, NINE);
        let update = bobs.export(&start);
        let mut flipped = update.clone();
        *flipped.last_mut().unwrap() ^= 1;
        let mut samuels = base.fork_as(SAMUEL);
        // garbage, cut short, a byte changed, and a snapshot (its state would be taken as is)
        for bad in [&b"not a loro update"[..], &update[..update.len() - 1], &flipped[..], &bobs.bytes()[..]] {
            assert_eq!(samuels.import(bad, BOB), Err(DocError::Malformed));
        }
        assert_eq!(samuels.version(), start);
    }

    #[test]
    fn an_update_carrying_another_peers_ops_is_refused() {
        // Carol passes Bob's edit on inside her own write: his ops carry his peer, so it isn't hers
        let base = welcome(SAMUEL);
        let start = base.version();
        let mut bobs = base.fork_as(BOB);
        bobs.set_text(2, NINE);
        let mut carols = base.fork_as(CAROL);
        carols.import(&bobs.export(&start), BOB).unwrap();
        carols.set_text(1, "Welcome, everyone");
        let mut samuels = base.fork_as(SAMUEL);
        assert_eq!(samuels.import(&carols.export(&start), CAROL), Err(DocError::WrongPeer));
        assert_eq!(samuels.version(), start);
    }

    #[test]
    fn an_update_that_arrives_early_waits_for_what_it_builds_on() {
        let base = welcome(SAMUEL);
        let start = base.version();
        let mut samuels = base.fork_as(SAMUEL);
        samuels.set_text(2, NINE);
        let from_samuel = samuels.export(&start);
        let mut bobs = base.fork_as(BOB);
        bobs.import(&from_samuel, SAMUEL).unwrap();
        let seen = bobs.version();
        bobs.set_text(1, "Welcome, everyone");
        let from_bob = bobs.export(&seen);
        // Carol gets Bob's edit first: it waits, then lands with Samuel's, which it builds on
        let mut carols = base.fork_as(CAROL);
        carols.import(&from_bob, BOB).unwrap();
        assert_eq!(carols.as_document(), base.as_document());
        carols.import(&from_samuel, SAMUEL).unwrap();
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
        let base = welcome(SAMUEL);
        let (start, frontiers) = (base.version(), base.doc.oplog_frontiers());
        let mut bobs = base.fork_as(BOB);
        bobs.set_text(2, NINE);
        let mut samuels = base.fork_as(SAMUEL);
        samuels.import(&bobs.export(&start), BOB).unwrap();
        samuels.put_back(&frontiers);
        assert_eq!((samuels.version(), samuels.as_document()), (start, base.as_document()));
        assert_eq!(samuels.doc.peer_id(), peer(SAMUEL));
    }
}
