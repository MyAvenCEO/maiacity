//! Device-local, engine-bound materialization receipts, never accepted from peers.
//! The authenticated ordered prefix must match; only covered ordinary suffix
//! writes may exclude touched entries and retain the rest. Each entry checks its
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
const WITH_PAGES: u32 = u32::MAX - 2;
const MAX_PAGES: usize = MAX_WRITES.div_ceil(MAX_ENTRIES);
use crate::deferred_body::{BodyMetadata, DeferredBody};

enum CapturedLine {
    Materialized(Item),
    // Untouched, authenticated own receipt. Import remains lazy and keeps the
    // same canonical-history fallback on its eventual first read.
    Deferred(Vec<u8>),
}

pub(super) struct Capture {
    basis: [u8; 32],
    entries: Vec<(
        EntryId,
        [u8; 32],
        Vec<(EditId, bool, bool, Option<Vec<Touch>>, Vec<Loc>)>,
        BTreeMap<Line, CapturedLine>,
        BTreeSet<BlobId>,
        Vec<(EditId, Vec<u8>)>,
    )>,
}
fn basis(store: &Store) -> [u8; 32] { basis_ids(store.log.ids()) }
fn basis_ids(ids: &[EditId]) -> [u8; 32] {
    let mut h = Hasher::new("own materialization log");
    for id in ids {
        h.update(&id.0);
    }
    h.finalize()
}
// Reject before constructing metadata if writes cannot fit; stop before the
// next encoding once the remaining byte budget is exhausted.
fn capture_metadata<I>(n: usize, writes: usize, bytes: usize,
    make: impl FnOnce() -> I) -> Result<(Vec<(EditId, Vec<u8>)>, usize), ()>
where I: IntoIterator<Item = Option<(EditId, Vec<u8>)>> {
    if n == 0 || n > MAX_WRITES.saturating_sub(writes) { return Err(()); }
    let (mut out, mut used) = (Vec::new(), 0usize);
    for value in make() {
        let Some((id, body)) = value else { return Ok((Vec::new(), 0)); };
        used = used.checked_add(body.len()).ok_or(())?;
        if used > bytes { return Err(()); }
        out.push((id,body));
    }
    Ok((out,used))
}
impl Capture {
    pub(super) fn take(store: &Store) -> Self {
        // Bound forked documents and judgment metadata before encoding. Prefer the
        // entries most recently worked on; uncaptured entries reconstruct normally.
        let requested: HashSet<_> = store.warm_working_set.iter().copied().collect();
        let order = store.shown.iter().filter(|(e,_)| requested.contains(e))
            .chain(store.shown.iter().filter(|(e,_)| !requested.contains(e) && store.scratched.contains(e)))
            .chain(store.shown.iter().filter(|(e,_)| !requested.contains(e) && !store.scratched.contains(e)));
        let (mut entries, mut writes, mut source_bytes) = (Vec::new(), 0usize, 0usize);
        for (e, s) in order {
            let n = s.history.changes().len();
            if n == 0 || n > MAX_WRITES.saturating_sub(writes) { continue; }
            // A metadata-only receipt has neither materialized items nor a saved
            // snapshot. Recapture its judgment instead of dropping it merely
            // because its new iteration position is within the snapshot budget.
            let keep_snapshot = entries.len() < MAX_ENTRIES
                && (s.items.get().is_some()
                    || s.deferred.lock().expect("deferred items lock").is_some());
            let body_bytes = if !keep_snapshot { 0 } else { s.history.changes().iter()
                .try_fold(0usize, |sum,c| sum.checked_add(c.body.as_ref().map_or(0,Vec::len)))
                .unwrap_or(usize::MAX) };
            let Some(available) = LIMIT.checked_sub(source_bytes).and_then(|b| b.checked_sub(body_bytes)) else { continue; };
            let Ok((metadata, metadata_bytes)) = capture_metadata(n,writes,available, ||
                s.history.changes().iter().map(|c| {
                    let body = store.body_metadata(c.write.edit)?;
                    let metadata = BodyMetadata::of(body);
                    metadata.ordinary().then(|| (c.write.edit, metadata.bytes()))
                })) else { continue; };
            if !keep_snapshot && metadata.len() != n { continue; }
            let bytes = body_bytes + metadata_bytes;
            let (items, snapshot_bytes) = if !keep_snapshot { (BTreeMap::new(), 0) }
            else if let Some(items) = s.items.get() {
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
                metadata,
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
        let mut pages: Vec<Vec<u8>> = Vec::new();
        let mut total_bytes = 0usize;
        'entries: for (entry, print, changes, items, asked, metadata) in self.entries {
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
                body.encode(&mut encoded);
                if total_bytes.saturating_add(entries.len()).saturating_add(encoded.len()) > LIMIT { continue 'entries; }
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
                if total_bytes
                    .saturating_add(entries.len())
                    .saturating_add(encoded.len())
                    .saturating_add(snapshot.len())
                    .saturating_add(4)
                    > LIMIT
                {
                    continue 'entries;
                }
                snapshot.encode(&mut encoded);
            }
            if total_bytes.saturating_add(entries.len()).saturating_add(encoded.len()) > LIMIT {
                break;
            }
            entries.extend(encoded);
            count += 1;
            if count as usize == MAX_ENTRIES {
                let mut page = Vec::new(); count.encode(&mut page); page.append(&mut entries);
                total_bytes += page.len() + 4; pages.push(page); count = 0;
            }
        }
        if count > 0 {
            let mut page = Vec::new(); count.encode(&mut page); page.extend(entries); pages.push(page);
        }
        // Bytes and writes stay globally bounded; pages only separate optional
        // working-set snapshots from metadata-only ordinary-entry receipts.
        WITH_PAGES.encode(&mut out);
        (pages.len() as u32).encode(&mut out);
        for page in pages { page.encode(&mut out); }
        if out.len().saturating_sub(MAGIC.len() + 4 + replay.len()) > LIMIT + 40 {
            // Never persist an over-budget adjunct. Its policy view remains valid.
            let mut only = MAGIC.to_vec(); replay.encode(&mut only); return only;
        }
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
    /// Called only after Replay::from_view authenticated an ordered prefix of
    /// this exact log. Ordinary writes cannot alter another entry's key/policy,
    /// schema lane or cap groups. Never reuse the entries those writes target.
    pub(super) fn check_prefix(extra: &[u8], store: &Store, held: usize) -> Option<Self> {
        if held == store.log.ids().len() { return Self::check(extra, store); }
        let suffix = store.log.edits().get(held..)?;
        if suffix.len() > MAX_WRITES || suffix.iter().any(|edit|
            !matches!(edit.action,Action::Write {create:None,proposal:Proposal::Main,..})) { return None; }
        let prefix = store.log.ids().get(..held)?;
        if extra.get(..32) != Some(basis_ids(prefix).as_slice()) { return None; }
        let mut saved = decode(extra)?;
        let mut touched = HashSet::new();
        for edit in suffix {
            let Action::Write { entry, create: None, proposal: Proposal::Main, .. } = &edit.action else { return None; };
            let old = saved.get(entry)?;
            // No new entries or uncovered/schema/lens/group entries. Only own
            // authenticated complete metadata establishes this classification.
            if old.changes.is_empty() || old.metadata.len() != old.changes.len()
                || old.metadata.iter().any(|(_, metadata)| !metadata.ordinary())
                || !old.metadata.iter().any(|(_, metadata)| metadata.fields().header.is_some()) {
                return None;
            }
            touched.insert(*entry);
        }
        saved.retain(|entry, _| !touched.contains(entry));
        Some(Self { saved, revision: store.log.revision() })
    }
    pub(super) fn consume(self, store: &Store) -> Option<BTreeMap<EntryId, Saved>> {
        (self.revision == store.log.revision()).then_some(self.saved)
    }
    pub(super) fn deferred(&self, store: &Store) -> HashMap<EditId, Arc<DeferredBody>> {
        if self.revision != store.log.revision() { return HashMap::new(); }
        let mut out = HashMap::new();
        let mut retained_bytes = 0usize;
        for (entry, saved) in &self.saved {
            // Partial owner-bootstrap overlays have their own counted-history
            // and durability gates; do not substitute warm metadata for them.
            if store.bootstrap_bases.contains_key(entry) { continue; }
            if saved.metadata.len() != saved.changes.len() { continue; }
            let mut pending = Vec::new();
            let mut entry_bytes = 0usize;
            for (id, metadata) in &saved.metadata {
                let Some(edit) = store.log.entry_write(*id) else { pending.clear(); break; };
                let Action::Write { entry, stay, epoch, body, .. } = &edit.action else { pending.clear(); break; };
                entry_bytes = entry_bytes.saturating_add(body.len());
                if retained_bytes.saturating_add(entry_bytes) > LIMIT { pending.clear(); break; }
                let Some(keyid) = keys::edit_key(body) else { pending.clear(); break; };
                if store.keys.get(&keyid, KeyName::Entry(*entry, *stay, *epoch)).is_none() { pending.clear(); break; }
                let Some(body) = DeferredBody::from_own_receipt(self.revision.clone(), metadata.clone(),
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
}
#[derive(Default)]
struct DecodeBudget {writes:usize,details:usize,snapshots:usize}

pub(super) fn decode(extra: &[u8]) -> Option<BTreeMap<EntryId, Saved>> {
    if extra.len()>LIMIT+40 {return None;}
    let mut rd=Reader::new(extra.get(32..)?);
    let marker=u32::decode(&mut rd).ok()?;
    let (mut budget,mut out)=(DecodeBudget::default(),BTreeMap::new());
    if marker==WITH_PAGES {
        let count=rd.count(4).ok()?;
        if count>MAX_PAGES {return None;}
        for _ in 0..count {
            let size=rd.count(1).ok()?;
            let mut page=Reader::new(rd.take(size).ok()?);
            let count=page.count(37).ok()?;
            decode_entries(&mut page,true,count,&mut budget,&mut out)?;
            if !page.done() {return None;}
        }
    } else {
        let metadata=marker==WITH_METADATA;
        let count=if metadata {rd.count(37).ok()?} else {marker as usize};
        decode_entries(&mut rd,metadata,count,&mut budget,&mut out)?;
    }
    rd.done().then_some(out)
}
// Borrow each authenticated page directly. Only data that must survive release
// of the decrypted envelope is owned; no reconstructed page wrapper or second map.
fn decode_entries(rd:&mut Reader<'_>,with_metadata:bool,n:usize,
    budget:&mut DecodeBudget,out:&mut BTreeMap<EntryId,Saved>)->Option<()> {
    if n>MAX_ENTRIES {return None;}
    for _ in 0..n {
        let entry = EntryId::decode(rd).ok()?;
        let print = <[u8; 32]>::decode(rd).ok()?;
        let mut changes = Vec::new();
        let n = rd.count(39).ok()?;
        budget.writes = budget.writes.checked_add(n)?;
        if budget.writes > MAX_WRITES {
            return None;
        }
        for _ in 0..n {
            let edit = EditId::decode(rd).ok()?;
            let fits = bool::decode(rd).ok()?;
            let counted = bool::decode(rd).ok()?;
            let remaining = 65536usize.checked_sub(budget.details)?;
            let touches = match rd.u8().ok()? {
                0 => None,
                1 => Some(bounded_seq::<Touch>(rd, 1, MAX_WRITES.min(remaining)).ok()?),
                _ => return None,
            };
            budget.details += touches.as_ref().map_or(0, Vec::len);
            let adds = bounded_seq::<Loc>(rd, 4, MAX_WRITES.min(65536 - budget.details)).ok()?;
            budget.details += adds.len();
            changes.push((edit, fits, counted, touches, adds));
        }
        let asked = bounded_seq::<BlobId>(rd, 32, MAX_WRITES)
            .ok()?
            .into_iter()
            .collect();
        let mut body_metadata = Vec::new();
        if with_metadata {
            let count = rd.count(36).ok()?;
            if count > changes.len() { return None; }
            for i in 0..count {
                let id = EditId::decode(rd).ok()?;
                if id != changes[i].0 { return None; }
                let bytes=rd.count(1).ok()?;
                let body = BodyMetadata::decode(rd.take(bytes).ok()?)?;
                if !body.ordinary() { return None; }
                body_metadata.push((id, body));
            }
        }
        let mut items = Vec::new();
        let lines = rd.count(5).ok()?;
        if lines > changes.len() + 1 {
            return None;
        }
        budget.snapshots+=usize::from(lines>0);
        if budget.snapshots>MAX_ENTRIES {return None;}
        for _ in 0..lines {
            items.push((rd.option().ok()?, rd.bytes().ok()?));
        }
        if out
            .insert(
                entry,
                Saved {
                    print,
                    changes,
                    items,
                    asked,
                    metadata: body_metadata,
                },
            )
            .is_some()
        {
            return None;
        }
    }
    Some(())
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
    fn capture_prechecks_write_budget_and_stops_metadata_at_byte_budget() {
        let calls = std::cell::Cell::new(0);
        let result = capture_metadata(2,MAX_WRITES-1,LIMIT, || {
            calls.set(calls.get()+1);
            std::iter::empty::<Option<(EditId,Vec<u8>)>>()
        });
        assert!(result.is_err()); assert_eq!(calls.get(),0);
        let result = capture_metadata(3,0,3, || (0..3).map(|_| {
            calls.set(calls.get()+1); Some((EditId([0;32]),vec![0;2]))
        }));
        assert!(result.is_err()); assert_eq!(calls.get(),2,"third body never encoded");
        let result = capture_metadata(1,0,2, || [Some((EditId([0;32]),vec![0;2]))]);
        assert_eq!(result.unwrap().1,2,"exact budget remains admitted");
    }

    #[test]
    fn paged_metadata_restores_beyond_snapshot_budget_without_unrelated_content() {
        use crate::cast::{document,human_on};
        let mut lab=Lab::new(); let owner=lab.passkey("Metadata pages");
        let device=lab.device_of(owner,"Mac"); let vault=human_on(&mut lab,owner,&[device]);
        let entries:Vec<_>=lab.together(|lab| (0..300).map(|n|
            lab.create(device,vault,vault,"note",&[],document(&format!("Note {n}"),"body",device)).unwrap()).collect());
        lab.set_warm_working_set(device,&[entries[299]]);
        let encoded=Capture::take(lab.held(device)).encode(Vec::new());
        let saved=decode(unwrap(&encoded).unwrap().1).unwrap();
        assert!(saved.len()>MAX_ENTRIES);
        assert!(saved.values().filter(|entry|!entry.items.is_empty()).count()<=MAX_ENTRIES);
        assert!(!saved[&entries[299]].items.is_empty(),"requested snapshot gets priority");
        let wanted=*entries.iter().find(|entry|saved[*entry].items.is_empty()).unwrap();
        let expected=lab.item(device,wanted).unwrap().record();
        let backup=lab.backup(device); let n=backup.signed.len();
        let receipt=lab.capture_warm_current(device,n,Some([31;40])).unwrap().encode();
        let warm=Warm {keys:receipt.keys.into_iter().collect(),views:receipt.view.into_iter().collect()};
        lab.restore_warm_working_set(device,backup.clone(),Some(([31;40],n)),&warm,&[wanted]);
        assert_eq!(lab.item(device,wanted).unwrap().record(),expected);
        let selected=lab.held(device).view().entry(wanted).unwrap().creation;
        assert!(lab.held(device).deferred_bodies[&selected].content_ready(),"metadata-only selected entry hydrates its own content");
        for entry in entries.iter().filter(|entry|**entry!=wanted) {
            let id=lab.held(device).view().entry(*entry).unwrap().creation;
            assert!(lab.held(device).deferred_bodies.contains_key(&id),"all covered ordinary metadata retained");
            assert!(!lab.held(device).deferred_bodies[&id].content_ready(),"unrelated historical content stays closed");
            assert!(lab.held(device).shown[entry].items.get().is_none());
        }
        // Saving a hydrated target must not force unrelated deferred content,
        // and the resulting receipt must remain usable on the next reopen.
        let receipt=lab.capture_warm_current(device,n,Some([32;40])).unwrap().encode();
        // Saves emit only changed slots; keep the last authenticated view.
        let warm=Warm {keys:receipt.keys.into_iter().chain(warm.keys).collect(),
            views:receipt.view.into_iter().chain(warm.views).collect()};
        lab.restore_warm_working_set(device,backup.clone(),Some(([32;40],n)),&warm,&[wanted]);
        assert_eq!(lab.item(device,wanted).unwrap().record(),expected);
        for entry in entries.iter().filter(|entry|**entry!=wanted) {
            let id=lab.held(device).view().entry(*entry).unwrap().creation;
            assert!(!lab.held(device).deferred_bodies[&id].content_ready());
            assert!(lab.held(device).shown[entry].items.get().is_none());
        }
        lab.restore_backup(device,&backup);
        assert_eq!(lab.item(device,wanted).unwrap().record(),expected);
    }

    #[test]
    fn borrowed_pages_enforce_global_snapshot_budget_and_own_retained_items() {
        fn page(first:u64,count:u32)->Vec<u8> {
            let mut out=Vec::new();count.encode(&mut out);
            for n in first..first+u64::from(count) {
                EntryId::from_u64(n).encode(&mut out);[0u8;32].encode(&mut out);
                0u32.encode(&mut out); // judgment changes
                0u32.encode(&mut out); // asked blobs
                0u32.encode(&mut out); // ordinary body metadata
                1u32.encode(&mut out); // one saved item
                Option::<EditId>::None.encode(&mut out);vec![7u8,8,9].encode(&mut out);
            }
            out
        }
        let retained={
            let mut extra=vec![0u8;32];WITH_PAGES.encode(&mut extra);2u32.encode(&mut extra);
            page(1,128).encode(&mut extra);page(129,128).encode(&mut extra);
            let decoded=decode(&extra).unwrap();
            let mut overflow=vec![0u8;32];WITH_PAGES.encode(&mut overflow);2u32.encode(&mut overflow);
            page(1,256).encode(&mut overflow);page(257,1).encode(&mut overflow);
            assert!(decode(&overflow).is_none(),"snapshot budget spans borrowed pages");
            decoded
        }; // authenticated input envelope can be released here
        assert_eq!(retained.len(),256);
        assert_eq!(retained[&EntryId::from_u64(256)].items[0].1,vec![7u8,8,9]);
    }

    #[test]
    fn paged_metadata_rejects_duplicate_truncated_and_excess_pages() {
        let (lab,device,_,_,_,_)=warmed_notes();
        let encoded=Capture::take(lab.held(device)).encode(Vec::new());
        let extra=unwrap(&encoded).unwrap().1;
        let mut reader=Reader::new(&extra[32..]);
        assert_eq!(u32::decode(&mut reader).unwrap(),WITH_PAGES);
        assert_eq!(reader.count(4).unwrap(),1);
        let page=reader.bytes().unwrap();
        let mut duplicate=extra[..32].to_vec(); WITH_PAGES.encode(&mut duplicate);
        2u32.encode(&mut duplicate); page.encode(&mut duplicate); page.encode(&mut duplicate);
        assert!(decode(&duplicate).is_none());
        assert!(decode(&extra[..extra.len()-1]).is_none());
        let mut excess=extra[..32].to_vec(); WITH_PAGES.encode(&mut excess);
        ((MAX_PAGES+1) as u32).encode(&mut excess); excess.resize(40+(MAX_PAGES+1)*4,0);
        assert!(decode(&excess).is_none());
        // Old WITH_METADATA pages still decode unchanged for persisted upgrades.
        let mut legacy=extra[..32].to_vec(); WITH_METADATA.encode(&mut legacy); legacy.extend(page);
        assert!(decode(&legacy).is_some());
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
    fn tag_inventory_does_not_decode_unrelated_warm_entries() {
        let (mut lab, device, _vault, entries, backup, warm) = warmed_notes();
        let n = backup.signed.len();
        lab.restore_warm(device, backup, Some(([19;40],n)), &warm);
        let out = crate::engine::read(&lab,device,&serde_json::json!({"op":"entry_views","tag":"no-such-tag"}));
        assert_eq!(out["ok"]["rows"],serde_json::json!([]));
        assert_eq!(out["ok"]["scope"]["remoteComplete"],false);
        for entry in entries { assert!(lab.held(device).shown[&entry].items.get().is_none()); }
    }

    #[test]
    fn tag_inventory_unknown_header_cannot_claim_complete_local_absence() {
        let (mut lab, device, _vault, entries, backup, warm) = warmed_notes();
        let n = backup.signed.len();
        lab.restore_warm(device, backup, Some(([19;40],n)), &warm);
        let creation = lab.held(device).view().entry(entries[0]).unwrap().creation;
        lab.stores.get_mut(&device).unwrap().readings.headers.remove(&creation);
        let out = crate::engine::read(&lab,device,&serde_json::json!({"op":"entry_views","tag":"no-such-tag"}));
        assert_eq!(out["ok"]["scope"]["localComplete"],false);
        assert_eq!(out["ok"]["scope"]["remoteComplete"],false);
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
        lab.edit(device,vault,entries[0],|item| { item.edit_document(|d| d.title="Successor".into()); }).unwrap();
        assert_eq!(lab.item(device,entries[1]).unwrap().record(),expected[1]);
        assert!(lab.held(device).deferred_bodies.is_empty(), "changed log conservatively restores canonical decoding");
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
        let changed = lab.held(device).view().entry(entries[0]).unwrap().creation;
        let untouched = lab.held(device).view().entry(entries[1]).unwrap().creation;
        assert!(!lab.held(device).deferred_bodies.contains_key(&changed));
        assert!(lab.held(device).deferred_bodies.contains_key(&untouched));
        assert!(!lab.held(device).deferred_bodies[&untouched].content_ready());
        assert_eq!(lab.item(device,entries[0]).unwrap().record(),expected);
        let actual: Vec<_> = entries.iter().map(|entry| lab.item(device,*entry).unwrap().record()).collect();
        let full = lab.backup(device);
        lab.restore_backup(device, &full);
        assert_eq!(actual, entries.iter().map(|entry| lab.item(device,*entry).unwrap().record()).collect::<Vec<_>>());
    }

    #[test]
    fn prefix_reuse_rejects_schema_and_nonprefix_or_corrupt_receipts() {
        let (mut lab, device, vault, entries, backup, warm) = warmed_notes();
        let held = backup.signed.len();
        let encoded = Capture::take(lab.held(device)).encode(Vec::new());
        let extra = unwrap(&encoded).unwrap().1;
        lab.edit(device,vault,entries[0],|item| { item.edit_document(|d| d.title="suffix".into()); }).unwrap();
        assert!(Validated::check_prefix(extra,lab.held(device),held).is_some());
        let mut corrupt = extra.to_vec(); corrupt[0] ^= 1;
        assert!(Validated::check_prefix(&corrupt,lab.held(device),held).is_none());
        assert!(Validated::check_prefix(extra,lab.held(device),held-1).is_none());
        let mut changed = lab.held(device).log.edits().to_vec(); changed.swap(0,1);
        let mut reordered = Store::default(); reordered.log = crate::policy::Log::from_edits(changed);
        assert!(Validated::check_prefix(extra,&reordered,held).is_none());
        lab.restore_backup(device,&backup);
        lab.add_schema(device,vault,vault,crate::lens::example::DOCUMENT_V0.bytes()).unwrap();
        let current = lab.backup(device);
        assert!(Validated::check_prefix(extra,lab.held(device),held).is_none());
        let expected: Vec<_> = entries.iter().map(|entry|lab.item(device,*entry).unwrap().record()).collect();
        lab.restore_warm(device,current,Some(([19;40],held)),&warm);
        assert!(lab.held(device).deferred_bodies.is_empty());
        assert_eq!(expected,entries.iter().map(|entry|lab.item(device,*entry).unwrap().record()).collect::<Vec<_>>());
    }

    #[test]
    fn prefix_reuse_rebuilds_after_share_revocation_and_key_rotation() {
        let (mut lab, device, vault, entries, backup, warm)=warmed_notes();
        let held=backup.signed.len();
        let share=lab.issue(device,&[device],crate::cast::share(vault,crate::policy::Who::Everyone,
            crate::policy::Level::Read,crate::cast::of_type("note"))).unwrap();
        lab.submit(device,&[device],Action::Revoke(crate::policy::Revoking::Grant {
            share,actor:vault,keep:vec![],via:vec![] })).unwrap();
        let expected:Vec<_>=entries.iter().map(|entry|lab.item(device,*entry).map(Item::record)).collect();
        let changed=lab.backup(device);
        lab.restore_warm(device,changed,Some(([19;40],held)),&warm);
        assert!(lab.held(device).deferred_bodies.is_empty());
        assert_eq!(expected,entries.iter().map(|entry|lab.item(device,*entry).map(Item::record)).collect::<Vec<_>>());
    }

    #[test]
    fn prefix_reuse_does_not_admit_a_tampered_signed_suffix() {
        let (mut lab, device, vault, entries, backup, warm) = warmed_notes();
        let held=backup.signed.len();
        lab.edit(device,vault,entries[0],|item| { item.edit_document(|d|d.title="Not signed like this".into()); }).unwrap();
        let mut changed=lab.backup(device);
        let signed=changed.signed.iter_mut().rev().find(|signed|
            matches!(signed.edit.action,Action::Write{entry,..} if entry==entries[0])).unwrap();
        if let Action::Write{body,..}=&mut signed.edit.action { *body.last_mut().unwrap() ^= 1; }
        lab.restore_backup(device,&changed);
        let expected:Vec<_>=entries.iter().map(|entry|lab.item(device,*entry).map(Item::record)).collect();
        lab.restore_warm(device,changed,Some(([19;40],held)),&warm);
        assert_eq!(expected,entries.iter().map(|entry|lab.item(device,*entry).map(Item::record)).collect::<Vec<_>>());
    }

    #[test]
    fn prefix_reuse_rejects_every_nonordinary_suffix_action() {
        let (lab, device, _vault, _entries, backup, _warm) = warmed_notes();
        let encoded = Capture::take(lab.held(device)).encode(Vec::new());
        let extra = unwrap(&encoded).unwrap().1;
        let held = backup.signed.len();
        // Classifier must reject even an otherwise matching authenticated prefix
        // before considering whether these governance/key actions can be accepted.
        for edit in lab.held(device).log.edits().iter().filter(|edit|
            !matches!(edit.action,Action::Write { create:None,proposal:Proposal::Main,.. })) {
            let mut edits=lab.held(device).log.edits().to_vec();
            let mut suffix=edit.clone(); suffix.depth+=10000; edits.push(suffix);
            let mut store=Store::default(); store.log=crate::policy::Log::from_edits(edits);
            assert!(Validated::check_prefix(extra,&store,held).is_none());
        }
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
