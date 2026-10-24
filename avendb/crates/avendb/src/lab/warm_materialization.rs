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
        'entries: for (entry, print, changes, items, asked) in self.entries {
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
            if entries.len().saturating_add(encoded.len()) > LIMIT {
                break;
            }
            entries.extend(encoded);
            count += 1;
        }
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
        if extra.len() <= LIMIT + 36 {
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
    bytes: Vec<u8>,
    revision: crate::policy::LogRevision,
}
impl Validated {
    pub(super) fn check(extra: &[u8], store: &Store) -> Option<Self> {
        matching(extra, store).then(|| Self {
            bytes: extra.to_vec(), revision: store.log.revision(),
        })
    }
    pub(super) fn consume(self, store: &Store) -> Option<Vec<u8>> {
        (self.revision == store.log.revision()).then_some(self.bytes)
    }
}
pub(super) struct Saved {
    print: [u8; 32],
    changes: Vec<(EditId, bool, bool, Option<Vec<Touch>>, Vec<Loc>)>,
    items: Vec<(Line, Vec<u8>)>,
    asked: BTreeSet<BlobId>,
}
pub(super) fn decode(extra: &[u8]) -> Option<BTreeMap<EntryId, Saved>> {
    if extra.len() > LIMIT + 36 {
        return None;
    }
    let mut rd = Reader::new(extra.get(32..)?);
    let n = rd.count(37).ok()?;
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
        let mut items = Vec::new();
        let lines = rd.count(5).ok()?;
        if lines > changes.len() + 1 {
            return None;
        }
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
        bodies: &HashMap<EditId, Body>,
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
        let mut history = History::default();
        let mut attrs = st.first_attrs(en, r);
        for (w, (id, fits, counted, touches, adds)) in writes.into_iter().zip(self.changes) {
            if w.edit != id {
                return None;
            }
            let body = bodies.get(&id);
            history
                .push(Change {
                    write: w.clone(),
                    body: body.map(|b| b.content.clone()),
                    fits,
                    counted,
                    touches,
                    adds,
                })
                .ok()?;
            if !w.first && w.actor == en.vault {
                if let (Some(a), Some(b)) = (attrs.as_mut(), body) {
                    a.tags = b.tags.apply(&a.tags);
                }
            }
        }
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
        Some(Shown {
            history,
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
            .consume(lab.held(device)).unwrap(), extra);
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
                &store.bodies, state.entry(*entry).unwrap(), current.print, current.tip).unwrap();
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
                &store.bodies, state.entry(*entry).unwrap(), current.print, current.tip).unwrap();
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
