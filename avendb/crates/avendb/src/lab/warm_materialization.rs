//! Device-local, engine-bound materialization receipts, never accepted from peers.
//! The whole ordered log must still match; each entry additionally checks its
//! canonical shown fingerprint after current keys/bodies/lane/groups are rebuilt.
use super::*;
use crate::encode::Encode;
use crate::ops::{Loc, Seg};
use crate::rules::Scalar;
use crate::wire::{Decode, Reader, WireError};
const MAGIC: &[u8] = b"avenDB own materialization 1\n";
const LIMIT: usize = 32 * 1024 * 1024;
const MAX_ENTRIES: usize = 256;
const MAX_WRITES: usize = 8192;
const WITH_METADATA: u32 = u32::MAX - 1;
const WITH_SCRATCH: u32 = u32::MAX - 2;
use crate::deferred_body::{BodyMetadata, DeferredBody};

enum CapturedLine {
    Materialized(Item),
    // Untouched, authenticated own receipt. Import remains lazy and keeps the
    // same canonical-history fallback on its eventual first read.
    Deferred(Vec<u8>),
}

enum CapturedScratch { Materialized(Scratch), Deferred(crate::history::ScratchImage) }

pub(super) struct Capture {
    basis: [u8; 32],
    entries: Vec<(
        EntryId,
        [u8; 32],
        Vec<(EditId, bool, bool, Option<Vec<Touch>>, Vec<Loc>)>,
        BTreeMap<Line, CapturedLine>,
        BTreeSet<BlobId>,
        Vec<(EditId, BodyMetadata)>,
        Option<CapturedScratch>,
    )>,
}
fn basis(store: &Store) -> [u8; 32] {
    let mut h = Hasher::new("own materialization log");
    for id in store.log.ids() {
        h.update(&id.0);
    }
    h.finalize()
}
impl Capture {
    pub(super) fn take(store: &Store) -> Self {
        // Bound forked documents and judgment metadata before encoding. Prefer the
        // entries most recently worked on; uncaptured entries reconstruct normally.
        let order = store
            .shown
            .iter()
            .filter(|(e, _)| store.scratched.contains(e))
            .chain(
                store
                    .shown
                    .iter()
                    .filter(|(e, _)| !store.scratched.contains(e)),
            );
        let (mut entries, mut writes, mut source_bytes) = (Vec::new(), 0usize, 0usize);
        for (e, s) in order {
            if entries.len() == MAX_ENTRIES {
                break;
            }
            let n = s.history.changes().len();
            let bytes: usize = s
                .history
                .changes()
                .iter()
                .map(|c| c.body.as_ref().map_or(0, Vec::len))
                .sum();
            if writes.saturating_add(n) > MAX_WRITES
                || source_bytes.saturating_add(bytes) > LIMIT
            {
                continue;
            }
            let (items, snapshot_bytes) = if let Some(items) = s.items.get() {
                if items.values().any(Item::has_parked_updates) { continue; }
                (items.iter().map(|(line, item)| (*line, CapturedLine::Materialized(item.clone()))).collect(), 0)
            } else {
                let deferred = s.deferred.lock().expect("deferred items lock");
                let Some((_, saved)) = deferred.as_ref() else { continue; };
                let size = saved.values().fold(0usize, |sum, bytes| sum.saturating_add(bytes.len()));
                if source_bytes.saturating_add(bytes).saturating_add(size) > LIMIT { continue; }
                (saved.iter().map(|(line, bytes)| (*line, CapturedLine::Deferred(bytes.clone()))).collect(), size)
            };
            writes += n;
            source_bytes += bytes + snapshot_bytes;
            entries.push((
                *e,
                s.print,
                s.history
                    .changes()
                    .iter()
                    .map(|c| {
                        (
                            c.write.edit,
                            c.fits,
                            c.counted,
                            c.touches.clone(),
                            c.adds.clone(),
                        )
                    })
                    .collect(),
                items,
                s.after.asked.clone(),
                s.history.changes().iter().map(|c| {
                    let body = store.body_metadata(c.write.edit)?;
                    let metadata = BodyMetadata::of(body);
                    metadata.ordinary().then_some((c.write.edit, metadata))
                }).collect::<Option<Vec<_>>>().unwrap_or_default(),
                s.after.scratch.as_ref().map(|s| CapturedScratch::Materialized(s.fork()))
                    .or_else(|| s.after.deferred_scratch.as_ref().map(|s| CapturedScratch::Deferred(s.image.clone()))),
            ));
        }
        Self {
            basis: basis(store),
            entries,
        }
    }
    pub(super) fn encode(self, replay: Vec<u8>) -> Vec<u8> {
        let mut out = MAGIC.to_vec();
        replay.encode(&mut out);
        self.basis.encode(&mut out);
        let mut entries = Vec::new();
        let mut count = 0u32;
        'entries: for (entry, print, changes, items, asked, metadata, scratch) in self.entries {
            let mut encoded = Vec::new();
            entry.encode(&mut encoded);
            print.encode(&mut encoded);
            (changes.len() as u32).encode(&mut encoded);
            for (edit, fits, counted, touches, adds) in changes {
                edit.encode(&mut encoded);
                fits.encode(&mut encoded);
                counted.encode(&mut encoded);
                touches.as_deref().encode(&mut encoded);
                adds.as_slice().encode(&mut encoded);
            }
            asked
                .iter()
                .copied()
                .collect::<Vec<_>>()
                .as_slice()
                .encode(&mut encoded);
            (metadata.len() as u32).encode(&mut encoded);
            for (id, body) in metadata {
                id.encode(&mut encoded);
                body.bytes().encode(&mut encoded);
                if entries.len().saturating_add(encoded.len()) > LIMIT { continue 'entries; }
            }
            (items.len() as u32).encode(&mut encoded);
            for (line, item) in items {
                line.encode(&mut encoded);
                // Export requires one owned snapshot, but never retain several
                // oversized snapshots before checking the aggregate adjunct budget.
                let snapshot = match item {
                    CapturedLine::Materialized(item) => item.bytes(),
                    CapturedLine::Deferred(bytes) => bytes,
                };
                if entries
                    .len()
                    .saturating_add(encoded.len())
                    .saturating_add(snapshot.len())
                    .saturating_add(4)
                    > LIMIT
                {
                    continue 'entries;
                }
                snapshot.encode(&mut encoded);
            }
            // Scratch encoding remains outside the shared database lock and within
            // the same bounded authenticated own adjunct as the visible snapshots.
            match scratch.and_then(|s| match s { CapturedScratch::Materialized(s) => s.image(), CapturedScratch::Deferred(image) => Some(image) }) {
                None => encoded.push(0),
                Some(image) => {
                    encoded.push(1);
                    image.snapshot.encode(&mut encoded);
                    image.holds.into_iter().collect::<Vec<_>>().as_slice().encode(&mut encoded);
                    image.authored.into_iter().collect::<Vec<_>>().as_slice().encode(&mut encoded);
                    image.tip.encode(&mut encoded);
                }
            }
            if entries.len().saturating_add(encoded.len()) > LIMIT {
                break;
            }
            entries.extend(encoded);
            count += 1;
        }
        WITH_SCRATCH.encode(&mut out);
        count.encode(&mut out);
        out.extend(entries);
        out
    }
}
pub(super) fn unwrap(bytes: &[u8]) -> Option<(&[u8], &[u8])> {
    let Some(rest) = bytes.strip_prefix(MAGIC) else {
        return Some((bytes, &[]));
    };
    let (n, rest) = rest.split_first_chunk::<4>()?;
    let (view, extra) = rest.split_at_checked(u32::from_be_bytes(*n) as usize)?;
    Some((
        view,
        if extra.len() <= LIMIT + 40 {
            extra
        } else {
            &[]
        },
    ))
}
pub(super) fn matching(extra: &[u8], store: &Store) -> bool {
    extra.get(..32) == Some(basis(store).as_slice())
}
/// An already authenticated own adjunct, bound to the exact process-local log
/// revision checked at restore. This avoids hashing all log IDs a second time
/// when show_items consumes it. Bytes and revision cannot be changed separately.
pub(super) struct Validated {
    saved: BTreeMap<EntryId, Saved>,
    revision: crate::policy::LogRevision,
}
impl Validated {
    pub(super) fn check(extra: &[u8], store: &Store) -> Option<Self> {
        if !matching(extra, store) { return None; }
        Some(Self { saved: decode(extra)?, revision: store.log.revision() })
    }
    pub(super) fn consume(self, store: &Store) -> Option<BTreeMap<EntryId, Saved>> {
        (self.revision == store.log.revision()).then_some(self.saved)
    }
    pub(super) fn deferred(&self, store: &Store, basis: Arc<crate::deferred_body::DeferredContext>) -> HashMap<EditId, Arc<DeferredBody>> {
        if self.revision != store.log.revision() || !basis.matches(&self.revision) { return HashMap::new(); }
        let mut out = HashMap::new();
        let mut retained_bytes = 0usize;
        let edits: HashMap<_, _> = store.log.ids().iter().copied().zip(store.log.edits()).collect();
        for (entry, saved) in &self.saved {
            // Partial owner-bootstrap overlays have their own counted-history
            // and durability gates; do not substitute warm metadata for them.
            if store.bootstrap_bases.contains_key(entry) { continue; }
            if saved.metadata.len() != saved.changes.len() { continue; }
            let mut pending = Vec::new();
            let mut entry_bytes = 0usize;
            for (id, metadata) in &saved.metadata {
                let Some(edit) = edits.get(id) else { pending.clear(); break; };
                let Action::Write { entry, stay, epoch, body, .. } = &edit.action else { pending.clear(); break; };
                entry_bytes = entry_bytes.saturating_add(body.len());
                if retained_bytes.saturating_add(entry_bytes) > LIMIT { pending.clear(); break; }
                let Some(keyid) = keys::edit_key(body) else { pending.clear(); break; };
                if store.keys.get(&keyid, KeyName::Entry(*entry, *stay, *epoch)).is_none() { pending.clear(); break; }
                let Some(body) = DeferredBody::from_own_receipt(basis.clone(), metadata.clone(),
                    body.clone().into(), write_context(edit)) else { pending.clear(); break; };
                pending.push((*id, Arc::new(body)));
            }
            if pending.len() == saved.changes.len() {
                retained_bytes += entry_bytes;
                out.extend(pending);
            }
        }
        out
    }
}
pub(super) struct Saved {
    print: [u8; 32],
    changes: Vec<(EditId, bool, bool, Option<Vec<Touch>>, Vec<Loc>)>,
    items: Vec<(Line, Vec<u8>)>,
    asked: BTreeSet<BlobId>,
    metadata: Vec<(EditId, BodyMetadata)>,
    scratch: Option<crate::history::ScratchImage>,
}
pub(super) fn decode(extra: &[u8]) -> Option<BTreeMap<EntryId, Saved>> {
    if extra.len() > LIMIT + 40 {
        return None;
    }
    let mut rd = Reader::new(extra.get(32..)?);
    let marker = u32::decode(&mut rd).ok()?;
    let with_scratch = marker == WITH_SCRATCH;
    let with_metadata = marker == WITH_METADATA || with_scratch;
    let n = if with_metadata { rd.count(37).ok()? } else { marker as usize };
    if n > MAX_ENTRIES {
        return None;
    }
    let (mut writes, mut metadata) = (0usize, 0usize);
    let mut out = BTreeMap::new();
    for _ in 0..n {
        let entry = EntryId::decode(&mut rd).ok()?;
        let print = <[u8; 32]>::decode(&mut rd).ok()?;
        let mut changes = Vec::new();
        let n = rd.count(39).ok()?;
        writes = writes.checked_add(n)?;
        if writes > MAX_WRITES {
            return None;
        }
        for _ in 0..n {
            let edit = EditId::decode(&mut rd).ok()?;
            let fits = bool::decode(&mut rd).ok()?;
            let counted = bool::decode(&mut rd).ok()?;
            let remaining = 65536usize.checked_sub(metadata)?;
            let touches = match rd.u8().ok()? {
                0 => None,
                1 => Some(bounded_seq::<Touch>(&mut rd, 1, MAX_WRITES.min(remaining)).ok()?),
                _ => return None,
            };
            metadata += touches.as_ref().map_or(0, Vec::len);
            let adds = bounded_seq::<Loc>(&mut rd, 4, MAX_WRITES.min(65536 - metadata)).ok()?;
            metadata += adds.len();
            changes.push((edit, fits, counted, touches, adds));
        }
        let asked = bounded_seq::<BlobId>(&mut rd, 32, MAX_WRITES)
            .ok()?
            .into_iter()
            .collect();
        let mut body_metadata = Vec::new();
        if with_metadata {
            let count = rd.count(36).ok()?;
            if count > changes.len() { return None; }
            for i in 0..count {
                let id = EditId::decode(&mut rd).ok()?;
                if id != changes[i].0 { return None; }
                let body = BodyMetadata::decode(&rd.bytes().ok()?)?;
                if !body.ordinary() { return None; }
                body_metadata.push((id, body));
            }
        }
        let mut items = Vec::new();
        let lines = rd.count(5).ok()?;
        if lines > changes.len() + 1 {
            return None;
        }
        for _ in 0..lines {
            items.push((rd.option().ok()?, rd.bytes().ok()?));
        }
        let scratch = if with_scratch {
            match rd.u8().ok()? {
                0 => None,
                1 => {
                    let snapshot = rd.bytes().ok()?;
                    let ids = bounded_seq::<EditId>(&mut rd, 32, MAX_WRITES).ok()?;
                    let holds: BTreeSet<_> = ids.iter().copied().collect();
                    if holds.len() != ids.len() { return None; }
                    let authored = bounded_seq::<BlobId>(&mut rd, 32, MAX_WRITES).ok()?.into_iter().collect();
                    let tip = rd.option().ok()?;
                    Some(crate::history::ScratchImage { snapshot, holds, authored, tip })
                }
                _ => return None,
            }
        } else { None };
        if out
            .insert(
                entry,
                Saved {
                    print,
                    changes,
                    items,
                    asked,
                    metadata: body_metadata,
                    scratch,
                },
            )
            .is_some()
        {
            return None;
        }
    }
    rd.done().then_some(out)
}
impl Saved {
    pub(super) fn restore(
        self,
        d: SignerId,
        st: &State,
        r: &Readings,
        store: &Store,
        en: &Entry,
        print: [u8; 32],
        tip: Tip,
    ) -> Option<Shown> {
        if self.print != print {
            return None;
        }
        let writes: Vec<_> = st.entry_writes(en.id).collect();
        if writes.len() != self.changes.len() {
            return None;
        }
        let mut changes = Vec::with_capacity(writes.len());
        let mut attrs = st.first_attrs(en, r);
        for (w, (id, fits, counted, touches, adds)) in writes.into_iter().zip(self.changes) {
            if w.edit != id {
                return None;
            }
            let body = store.body_metadata(id);
            let content = store.bodies.get(&id);
            changes.push(Change {
                    write: w.clone(),
                    body: content.map(|b| b.content.clone()),
                    fits,
                    counted,
                    touches,
                    adds,
                });
            if !w.first && w.actor == en.vault {
                if let (Some(a), Some(b)) = (attrs.as_mut(), body) {
                    a.tags = b.tags.apply(&a.tags);
                }
            }
        }
        let history = History::from_changes(changes).ok()?;
        let mut items = BTreeMap::new();
        let mut imported = BTreeMap::new();
        let asked = self.asked;
        for (line, bytes) in self.items {
            imported.insert(
                line,
                history.history(line).iter().map(|c| c.write.edit).collect(),
            );
            if items.insert(line, bytes).is_some() {
                return None;
            }
        }
        // Only the exact authenticated linear counted-main scratch can avoid
        // historical content reconstruction. Invalid optional scratch falls back.
        let deferred_scratch = self.scratch.and_then(|image| {
            let last = history.changes().last()?.write.edit;
            if image.tip != Some(last) || image.holds.len() != history.changes().len()
                || !history.changes().iter().all(|c| c.counted && c.write.proposal == Proposal::Main && image.holds.contains(&c.write.edit)) {
                return None;
            }
            let mut previous = None;
            for change in history.changes() {
                if change.write.deps.as_slice() != previous.as_slice() { return None; }
                previous = Some(change.write.edit);
            }
            Some(DeferredScratch { signer: d, image, opened: OnceLock::new() })
        });
        let mine = history.mine();
        let history_bodies = history.changes().iter().filter(|c| store.deferred_bodies.contains_key(&c.write.edit))
            .map(|c| c.write.edit).collect();
        Some(Shown {
            history,
            history_bodies,
            hydrated_history: OnceLock::new(),
            items: OnceLock::new(),
            deferred: std::sync::Mutex::new(Some((d, items))),
            print,
            tip,
            after: After {
                scratch: None,
                deferred_scratch,
                attrs,
                mine,
                imported,
                asked,
            },
        })
    }
}
impl Encode for Loc {
    fn encode(&self, out: &mut Vec<u8>) {
        (self.0.len() as u32).encode(out);
        for s in &self.0 {
            match s {
                Seg::Field(f) => {
                    out.push(0);
                    f.encode(out);
                }
                Seg::Row(n) => {
                    out.push(1);
                    n.encode(out);
                }
            }
        }
    }
}
impl Decode for Loc {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        let mut out = Vec::new();
        let count = r.count(1)?;
        if count > 64 {
            return Err(WireError::Unknown);
        }
        for _ in 0..count {
            out.push(match r.u8()? {
                0 => Seg::Field(String::decode(r)?),
                1 => Seg::Row(i64::decode(r)?),
                _ => return Err(WireError::Unknown),
            });
        }
        Ok(Loc(out))
    }
}
impl Encode for Touch {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Touch::Set(l, v) => {
                out.push(0);
                l.encode(out);
                v.encode(out);
            }
            Touch::Own(l, v) => {
                out.push(1);
                l.encode(out);
                v.encode(out);
            }
            Touch::Insert(l) => {
                out.push(2);
                l.encode(out);
            }
            Touch::Remove(l) => {
                out.push(3);
                l.encode(out);
            }
            Touch::Move(l) => {
                out.push(4);
                l.encode(out);
            }
            Touch::Create => out.push(5),
            Touch::Tag(t) => {
                out.push(6);
                t.encode(out);
            }
            Touch::Propose => out.push(7),
            Touch::Merge => out.push(8),
            Touch::Merged(l) => {
                out.push(9);
                l.encode(out);
            }
        }
    }
}
impl Decode for Touch {
    fn decode(r: &mut Reader<'_>) -> Result<Self, WireError> {
        Ok(match r.u8()? {
            0 => Touch::Set(Loc::decode(r)?, r.option::<Scalar>()?),
            1 => Touch::Own(Loc::decode(r)?, r.option::<Scalar>()?),
            2 => Touch::Insert(Loc::decode(r)?),
            3 => Touch::Remove(Loc::decode(r)?),
            4 => Touch::Move(Loc::decode(r)?),
            5 => Touch::Create,
            6 => Touch::Tag(Sym::decode(r)?),
            7 => Touch::Propose,
            8 => Touch::Merge,
            9 => Touch::Merged(Loc::decode(r)?),
            _ => return Err(WireError::Unknown),
        })
    }
}
fn bounded_seq<T: Decode>(r: &mut Reader<'_>, min: usize, max: usize) -> Result<Vec<T>, WireError> {
    let n = r.count(min)?;
    if n > max {
        return Err(WireError::Unknown);
    }
    let mut out = Vec::with_capacity(n.min(64));
    for _ in 0..n {
        out.push(T::decode(r)?);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn warmed_notes() -> (Lab, SignerId, VaultId, Vec<EntryId>, Backup, Warm) {
        use crate::cast::{document, human_on};
        let mut lab = Lab::new();
        let owner = lab.passkey("Deferred warm bodies");
        let device = lab.device_of(owner, "Mac");
        let vault = human_on(&mut lab, owner, &[device]);
        let entries: Vec<_> = (0..3).map(|n| lab.create(device, vault, vault, "note", &[],
            document(&format!("Entry {n}"), "held content", device)).unwrap()).collect();
        let backup = lab.backup(device);
        let n = backup.signed.len();
        let receipt = lab.capture_warm_current(device, n, Some([19;40])).unwrap().encode();
        let warm = Warm {keys: receipt.keys.clone().into_iter().collect(), views: receipt.view.clone().into_iter().collect()};
        lab.warmed(device, receipt);
        (lab, device, vault, entries, backup, warm)
    }

    #[test]
    fn typed_global_inventory_does_not_materialize_unrelated_or_unreadable_entries() {
        let (mut lab, device, _vault, entries, backup, warm) = warmed_notes();
        let n = backup.signed.len();
        lab.restore_warm(device, backup, Some(([19;40],n)), &warm);
        let out = crate::engine::read(&lab, device, &serde_json::json!({"op":"entry_views","types":["task"]}));
        assert_eq!(out["ok"]["rows"], serde_json::json!([]));
        let out = crate::engine::read(&lab, device, &serde_json::json!({"op":"entry_views","types":["note"],"as":VaultId([0;32]).to_hex()}));
        assert_eq!(out["ok"]["rows"], serde_json::json!([]));
        for entry in entries {
            assert!(lab.held(device).shown[&entry].items.get().is_none(), "type/actor gate precedes materialization");
        }
    }

    #[test]
    fn warm_metadata_restores_first_view_without_decoding_unrelated_bodies() {
        let (mut lab, device, vault, entries, backup, warm) = warmed_notes();
        let expected: Vec<_> = entries.iter().map(|e| lab.item(device,*e).unwrap().record()).collect();
        let n = backup.signed.len();
        lab.set_online(device, false);
        lab.restore_warm(device, backup, Some(([19;40],n)), &warm);
        let ids: Vec<_> = entries.iter().map(|e| lab.held(device).view().entry(*e).unwrap().creation).collect();
        assert!(ids.iter().all(|id| lab.held(device).deferred_bodies.contains_key(id)));
        assert!(ids.iter().all(|id| !lab.held(device).bodies.contains_key(id)));
        assert_eq!(lab.item(device,entries[0]).unwrap().record(), expected[0]);
        assert!(ids.iter().all(|id| !lab.held(device).deferred_bodies[id].content_ready()),
            "a validated current snapshot must not decrypt historical bodies");
        assert!(lab.history(device,entries[0]).unwrap().changes().iter().all(|c| c.body.is_some()));
        assert!(lab.held(device).deferred_bodies[&ids[0]].content_ready());
        assert!(!lab.held(device).deferred_bodies[&ids[1]].content_ready());
        let saved = Capture::take(lab.held(device)).encode(Vec::new());
        assert!(decode(unwrap(&saved).unwrap().1).is_some());
        assert!(!lab.held(device).deferred_bodies[&ids[1]].content_ready(), "saving must not hydrate unrelated content");
        let unrelated_receipt = lab.held(device).deferred_bodies[&ids[1]].clone();
        let retained_before = lab.held(device).perf.to_json()["counts"]["refresh: deferred context retained"].as_u64().unwrap_or(0);
        lab.edit(device,vault,entries[0],|item| { item.edit_document(|d| d.title="Successor".into()); }).unwrap();
        assert!(Arc::ptr_eq(&unrelated_receipt, &lab.held(device).deferred_bodies[&ids[1]]),
            "an externally held unrelated receipt does not force full refresh");
        assert!(unrelated_receipt.metadata(&lab.held(device).log.revision()).is_ok());
        assert_eq!(lab.held(device).perf.to_json()["counts"]["refresh: deferred context retained"].as_u64(), Some(retained_before+1));
        assert_eq!(lab.item(device,entries[1]).unwrap().record(),expected[1]);
        assert!(lab.held(device).deferred_bodies.contains_key(&ids[1]), "unchanged background content stays deferred after a local ordinary append");
        assert!(!lab.held(device).deferred_bodies[&ids[1]].content_ready(), "local write must not decode unrelated history");
        let changed = lab.item(device,entries[0]).unwrap().record();
        lab.restore_from(device, lab.backup(device));
        assert_eq!(lab.item(device,entries[0]).unwrap().record(), changed, "canonical cold restore matches fast warm append");
        assert_eq!(lab.item(device,entries[1]).unwrap().record(), expected[1]);
    }

    #[test]
    fn warm_scratch_import_waits_for_authorized_target_edit() {
        let (mut lab, device, vault, entries, backup, warm) = warmed_notes();
        let n=backup.signed.len();
        lab.restore_warm(device,backup,Some(([19;40],n)),&warm);
        let unopened = |lab: &Lab, entry: EntryId| lab.held(device).shown[&entry].after
            .deferred_scratch.as_ref().is_some_and(|s| s.opened.get().is_none());
        assert!(entries.iter().all(|e|unopened(&lab,*e)),"unlock imports no scratch snapshots");
        assert!(lab.item(device,entries[0]).is_some());
        let saved=Capture::take(lab.held(device)).encode(Vec::new());
        assert!(decode(unwrap(&saved).unwrap().1).is_some());
        assert!(entries.iter().all(|e|unopened(&lab,*e)),"view and re-save do not import scratch");
        lab.edit(device,vault,entries[0],|item|item.edit_document(|d|d.title="Target only".into())).unwrap();
        assert!(lab.held(device).shown[&entries[0]].after.scratch.is_some());
        assert!(entries[1..].iter().all(|e|unopened(&lab,*e)));
        lab.stores.get_mut(&device).unwrap().keys=Keyring::default();
        assert!(lab.append_history(device,entries[1]).is_none());
        assert!(entries[1..].iter().all(|e|unopened(&lab,*e)),"missing key cannot trigger scratch import");
    }

    #[test]
    fn long_single_entry_warm_append_matches_canonical_restore() {
        use crate::cast::{document, human_on, paragraph};
        use std::time::Instant;
        const REVISIONS: u64 = 256;
        let mut lab=Lab::new();
        let owner=lab.passkey("Long entry warm regression");
        let device=lab.device_of(owner,"local");
        let vault=human_on(&mut lab,owner,&[device]);
        let entry=lab.create(device,vault,vault,"note",&[],document("Append-only rows","initial",device)).unwrap();
        // Generic CRDT row appends: a long single record, not many short entries.
        for n in 0..REVISIONS {
            lab.edit(device,vault,entry,|item|item.push_block(paragraph(n+3,&format!("row {n}")))).unwrap();
        }
        let others:Vec<_>=(0..8).map(|n|lab.create(device,vault,vault,"note",&[],
            document(&format!("Unrelated {n}"),"leave deferred",device)).unwrap()).collect();
        let expected_before=lab.item(device,entry).unwrap().record();
        let other_records:Vec<_>=others.iter().map(|e|lab.item(device,*e).unwrap().record()).collect();
        let backup=lab.backup(device);
        let count=backup.signed.len();
        let marker=[73;40];
        let receipt=lab.capture_warm_current(device,count,Some(marker)).unwrap().encode();
        let warm=Warm{keys:receipt.keys.clone().into_iter().collect(),views:receipt.view.clone().into_iter().collect()};
        lab.warmed(device,receipt);
        lab.set_online(device,false);
        let started=Instant::now();
        lab.restore_warm(device,backup,Some((marker,count)),&warm);
        let warm_restore_us=started.elapsed().as_micros();
        let target_ids:Vec<_>=lab.held(device).view().entry_writes(entry).map(|w|w.edit).collect();
        let unrelated_ids:Vec<_>=others.iter().map(|e|lab.held(device).view().entry(*e).unwrap().creation).collect();
        assert_eq!(target_ids.len(),REVISIONS as usize+1);
        let deferred_before=lab.held(device).deferred_bodies.len();
        assert!(target_ids.iter().all(|id|lab.held(device).deferred_bodies.contains_key(id)));
        let started=Instant::now();
        assert_eq!(lab.item(device,entry).unwrap().record(),expected_before);
        let first_view_us=started.elapsed().as_micros();
        assert!(target_ids.iter().all(|id|!lab.held(device).deferred_bodies[id].content_ready()),
            "first view uses the validated saved item without decoding its long history");
        let hits_before=lab.held(device).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0);
        let started=Instant::now();
        lab.edit(device,vault,entry,|item|item.push_block(paragraph(REVISIONS+3,"after reopen"))).unwrap();
        let append_us=started.elapsed().as_micros();
        let deferred_after=lab.held(device).deferred_bodies.len();
        let target_deferred_after=target_ids.iter().filter(|id|lab.held(device).deferred_bodies.contains_key(id)).count();
        let unrelated_deferred_after=unrelated_ids.iter().filter(|id|lab.held(device).deferred_bodies.contains_key(id)).count();
        assert_eq!(target_deferred_after,target_ids.len(),"first append preserves omitted target history");
        assert!(target_ids.iter().all(|id|!lab.held(device).deferred_bodies[id].content_ready()),
            "saved exact scratch must avoid decoding old target bodies");
        assert_eq!(lab.held(device).perf.to_json()["counts"]["refresh: warm scratch resumed"].as_u64(),Some(1));
        assert_eq!(unrelated_deferred_after,others.len());
        assert!(unrelated_ids.iter().all(|id|!lab.held(device).deferred_bodies[id].content_ready()));
        assert_eq!(lab.held(device).perf.to_json()["counts"]["refresh: owner content only"].as_u64(),Some(hits_before+1));
        lab.edit(device,vault,entry,|item|item.push_block(paragraph(REVISIONS+4,"second append"))).unwrap();
        assert!(target_ids.iter().all(|id|!lab.held(device).deferred_bodies[id].content_ready()));
        let second_backup=lab.backup(device);
        let second_count=second_backup.signed.len();
        let receipt=lab.capture_warm_current(device,second_count,Some([46;40])).unwrap().encode();
        let second_warm=Warm{keys:receipt.keys.clone().into_iter().collect(),views:receipt.view.clone().into_iter().collect()};
        lab.warmed(device,receipt);
        let expected=lab.item(device,entry).unwrap().record();
        lab.restore_warm(device,second_backup,Some(([46;40],second_count)),&second_warm);
        assert_eq!(lab.item(device,entry).unwrap().record(),expected);
        assert!(target_ids.iter().all(|id|!lab.held(device).deferred_bodies[id].content_ready()));
        lab.edit(device,vault,entry,|item|item.push_block(paragraph(REVISIONS+5,"after second reopen"))).unwrap();
        assert!(target_ids.iter().all(|id|!lab.held(device).deferred_bodies[id].content_ready()));
        let expected=lab.item(device,entry).unwrap().record();
        let history=lab.history(device,entry).unwrap().changes().to_vec();
        assert!(history.iter().all(|c|c.body.is_some()),"public history still opens all content");
        let final_backup=lab.backup(device);
        let started=Instant::now();
        lab.restore_from(device,final_backup);
        let cold_restore_us=started.elapsed().as_micros();
        assert_eq!(lab.item(device,entry).unwrap().record(),expected);
        assert_eq!(lab.history(device,entry).unwrap().changes(),history);
        for (other,record) in others.iter().zip(other_records) {
            assert_eq!(lab.item(device,*other).unwrap().record(),record);
        }
        eprintln!("long-entry revisions={REVISIONS} warm_restore_us={warm_restore_us} first_view_us={first_view_us} append_us={append_us} canonical_cold_restore_us={cold_restore_us} deferred_before={deferred_before} deferred_after={deferred_after} target_deferred_after={target_deferred_after} unrelated_deferred_after={unrelated_deferred_after}; fixture timings only, not device latency");
    }

    #[test]
    fn corrupt_or_incomplete_optional_scratch_falls_back_canonically() {
        for corrupt in [false,true] {
            let (mut lab, device, vault, entries, backup, warm) = warmed_notes();
            let n=backup.signed.len();
            lab.restore_warm(device,backup,Some(([19;40],n)),&warm);
            let encoded=Capture::take(lab.held(device)).encode(Vec::new());
            let mut saved=decode(unwrap(&encoded).unwrap().1).unwrap().remove(&entries[0]).unwrap();
            let image=saved.scratch.as_mut().expect("restored exact scratch retained for recapture");
            if corrupt { image.snapshot=vec![0,1,2]; } else { image.holds.clear(); }
            let store=lab.held(device);
            let old=&store.shown[&entries[0]];
            let restored=saved.restore(device,store.view(),&store.readings,store,
                store.view().entry(entries[0]).unwrap(),old.print,old.tip).unwrap();
            assert!(restored.after.scratch().is_none());
            lab.stores.get_mut(&device).unwrap().shown.insert(entries[0],restored);
            lab.edit(device,vault,entries[0],|item| { item.edit_document(|d|d.title="Fallback".into()); }).unwrap();
            let expected=lab.item(device,entries[0]).unwrap().record();
            assert_eq!(lab.held(device).perf.to_json()["counts"]["refresh: warm scratch resumed"].as_u64().unwrap_or(0),0);
            lab.restore_from(device,lab.backup(device));
            assert_eq!(lab.item(device,entries[0]).unwrap().record(),expected);
        }
    }

    #[test]
    fn warm_metadata_bad_receipt_and_missing_current_key_fail_closed() {
        let (mut lab, device, _vault, entries, backup, warm) = warmed_notes();
        let expected = lab.item(device,entries[0]).unwrap().record();
        let n = backup.signed.len();
        let mut broken = warm.clone(); *broken.views[0].last_mut().unwrap() ^= 1;
        lab.restore_warm(device,backup.clone(),Some(([19;40],n)),&broken);
        assert!(lab.held(device).deferred_bodies.is_empty());
        assert_eq!(lab.item(device,entries[0]).unwrap().record(),expected);
        lab.restore_warm(device,backup,Some(([19;40],n)),&warm);
        assert!(lab.history(device,entries[0]).is_some());
        // Even previously hydrated history cannot substitute for current keys.
        lab.stores.get_mut(&device).unwrap().keys = Keyring::default();
        assert!(lab.history(device,entries[0]).is_none());
        assert!(lab.item(device,entries[0]).is_none(), "cached snapshots cannot replace current keys");
        lab.stores.get_mut(&device).unwrap().forget();
        assert!(lab.held(device).deferred_bodies.is_empty());
    }

    #[test]
    fn warm_metadata_unlanded_draft_stays_hidden_after_key_removal() {
        use crate::cast::{document, human_on};
        let mut lab = Lab::new();
        let owner = lab.passkey("Deferred draft");
        let device = lab.device_of(owner, "Mac");
        let vault = human_on(&mut lab, owner, &[device]);
        let (entry, proposal) = lab.create_draft(device, vault, vault, "note", &[],
            |id| {
                let mut item = Item::draft(device, id);
                item.set_record(crate::lens::View::document_v1(), &document("Draft", "not accepted", device).record());
                Some(item.export(&Version::default()))
            }).unwrap();
        assert!(!lab.landed(device, entry));
        let backup = lab.backup(device);
        let n = backup.signed.len();
        let receipt = lab.capture_warm_current(device, n, Some([29;40])).unwrap().encode();
        let warm = Warm { keys: receipt.keys.clone().into_iter().collect(), views: receipt.view.clone().into_iter().collect() };
        lab.warmed(device, receipt);
        lab.restore_warm(device, backup, Some(([29;40], n)), &warm);
        assert!(lab.held(device).deferred_bodies.contains_key(&proposal));
        assert!(!lab.landed(device, entry), "deferred authorized content is not a ciphertext-only relay");
        lab.stores.get_mut(&device).unwrap().keys = Keyring::default();
        assert!(!lab.landed(device, entry), "missing current keys fail closed");
    }

    #[test]
    fn warm_metadata_stale_basis_uses_canonical_suffix_not_deferred_content() {
        let (mut lab, device, vault, entries, _backup, warm) = warmed_notes();
        lab.edit(device,vault,entries[0],|item| { item.edit_document(|d| d.title="New frontier".into()); }).unwrap();
        let expected = lab.item(device,entries[0]).unwrap().record();
        let backup = lab.backup(device);
        let n = backup.signed.len();
        lab.restore_warm(device,backup,Some(([19;40],n)),&warm);
        assert!(lab.held(device).deferred_bodies.is_empty());
        assert_eq!(lab.item(device,entries[0]).unwrap().record(),expected);
    }

    #[test]
    fn warm_metadata_corrupt_snapshot_rebuilds_from_demanded_canonical_content() {
        let (mut lab, device, _vault, entries, backup, warm) = warmed_notes();
        let expected = lab.item(device,entries[0]).unwrap().record();
        let n = backup.signed.len();
        lab.restore_warm(device,backup,Some(([19;40],n)),&warm);
        let store = lab.stores.get_mut(&device).unwrap();
        let shown = store.shown.get_mut(&entries[0]).unwrap();
        assert!(shown.items.get().is_none());
        shown.deferred.lock().unwrap().as_mut().unwrap().1.insert(MAIN,vec![0,1,2]);
        assert_eq!(lab.item(device,entries[0]).unwrap().record(),expected);
        let other = lab.held(device).view().entry(entries[1]).unwrap().creation;
        assert!(!lab.held(device).deferred_bodies[&other].content_ready());
    }

    #[test]
    fn validated_warm_receipt_requires_unchanged_log_revision() {
        use crate::cast::{document, human_on};
        let mut lab = Lab::new();
        let owner = lab.passkey("Receipt revision");
        let device = lab.device_of(owner, "Mac");
        let vault = human_on(&mut lab, owner, &[device]);
        let encoded = Capture::take(lab.held(device)).encode(Vec::new());
        let extra = unwrap(&encoded).unwrap().1;
        assert_eq!(Validated::check(extra, lab.held(device)).unwrap()
            .consume(lab.held(device)).unwrap().len(), decode(extra).unwrap().len());
        let mut corrupt = extra.to_vec();
        corrupt[0] ^= 1;
        assert!(Validated::check(&corrupt, lab.held(device)).is_none());
        let before_write = Validated::check(extra, lab.held(device)).unwrap();
        lab.create(device, vault, vault, "note", &[],
            document("Changed", "new canonical write", device)).unwrap();
        assert!(before_write.consume(lab.held(device)).is_none());
        assert!(Validated::check(extra, lab.held(device)).is_none());

        let encoded = Capture::take(lab.held(device)).encode(Vec::new());
        let extra = unwrap(&encoded).unwrap().1;
        let before_replacement = Validated::check(extra, lab.held(device)).unwrap();
        // Even an equal-length freshly reconstructed log cannot reuse the
        // process-local validation token (conservatively, even equal contents).
        let edits = lab.held(device).log.edits().to_vec();
        let mut replacement = crate::policy::Log::new();
        replacement.receive(edits);
        assert_eq!(replacement.ids().len(), lab.held(device).log.ids().len());
        lab.stores.get_mut(&device).unwrap().log = replacement;
        assert!(before_replacement.consume(lab.held(device)).is_none());
        let before_withdrawal = Validated::check(extra, lab.held(device)).unwrap();
        let last = *lab.held(device).log.ids().last().unwrap();
        lab.stores.get_mut(&device).unwrap().log.let_go(&[last].into_iter().collect());
        assert!(before_withdrawal.consume(lab.held(device)).is_none());
    }

    #[test]
    fn recapturing_untouched_warm_entries_preserves_lazy_items_and_snapshots() {
        use crate::cast::{document, human_on};
        let mut lab = Lab::new();
        let owner = lab.passkey("Lazy recapture");
        let device = lab.device_of(owner, "Mac");
        let vault = human_on(&mut lab, owner, &[device]);
        let entries: Vec<_> = (0..3).map(|n| lab.create(device, vault, vault, "note", &[],
            document(&format!("Entry {n}"), "unchanged content", device)).unwrap()).collect();
        let expected: Vec<_> = entries.iter().map(|e| lab.item(device, *e).unwrap().record()).collect();
        let first = Capture::take(lab.held(device)).encode(Vec::new());
        let mut saved = decode(unwrap(&first).unwrap().1).unwrap();
        let lazy: Vec<_> = entries.iter().map(|entry| {
            let store = lab.held(device);
            let current = &store.shown[entry];
            let state = store.view();
            let restored = saved.remove(entry).unwrap().restore(device, state, &store.readings,
                store, state.entry(*entry).unwrap(), current.print, current.tip).unwrap();
            assert!(restored.items.get().is_none());
            (*entry, restored)
        }).collect();
        lab.stores.get_mut(&device).unwrap().shown.extend(lazy);
        let before: Vec<_> = entries.iter().map(|entry| lab.held(device).shown[entry]
            .deferred.lock().unwrap().as_ref().unwrap().1.clone()).collect();
        let second = Capture::take(lab.held(device)).encode(Vec::new());
        for entry in &entries {
            assert!(lab.held(device).shown[entry].items.get().is_none(),
                "saving cannot import an entry no view has demanded");
        }
        let mut saved = decode(unwrap(&second).unwrap().1).unwrap();
        for ((entry, expected), bytes) in entries.iter().zip(expected).zip(before) {
            let store = lab.held(device);
            let current = &store.shown[entry];
            let state = store.view();
            let restored = saved.remove(entry).unwrap().restore(device, state, &store.readings,
                store, state.entry(*entry).unwrap(), current.print, current.tip).unwrap();
            assert_eq!(restored.deferred.lock().unwrap().as_ref().unwrap().1, bytes,
                "untouched snapshot bytes survive saving exactly");
            assert!(restored.items.get().is_none());
            assert_eq!(restored.items()[&MAIN].record(), expected, "first demand still returns canonical content");
        }
    }

    #[test]
    fn bounded_decoder_rejects_truncated_and_oversized_receipts() {
        assert!(decode(&[]).is_none());
        let mut extra = vec![0; 32];
        ((MAX_ENTRIES + 1) as u32).encode(&mut extra);
        extra.resize(36 + (MAX_ENTRIES + 1) * 37, 0);
        assert!(decode(&extra).is_none());
        assert!(decode(&vec![0; LIMIT + 37]).is_none());
        assert!(unwrap(MAGIC).is_none());
        assert_eq!(unwrap(b"legacy").unwrap(), (&b"legacy"[..], &[][..]));
    }
}
