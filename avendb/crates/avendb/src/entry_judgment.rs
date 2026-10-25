//! Owner-attested History/Mine/After restoration. This restores judgment metadata,
//! never the independently replayed authorization kernel or a writable Store.
use super::*;
use crate::history::ScratchImage;
use crate::ops::{Loc, Seg};
use crate::rules::Scalar;
use crate::wire::Decode;

#[path = "entry_anchor_metadata.rs"]
mod anchor_metadata;
use anchor_metadata::{get_anchor_metadata, put_anchor_metadata};

#[path = "entry_bootstrap_store.rs"]
mod bootstrap_store;
pub(crate) use bootstrap_store::{Anchors, OverlayBasis, BootstrapProgress};

#[path = "entry_checkpoint_capsule.rs"]
mod capsule;
pub use capsule::EntryCheckpointCapsule;
#[path = "entry_key_recovery.rs"]
mod entry_key_recovery;
pub use entry_key_recovery::EntryKeyRecovery;

const JUDGMENT: &[u8] = b"avenDB entry judgment 2\n";
const MAX_FACTS: usize = 512;
const MAX_LIST: usize = 1024;
const MAX_PATH: usize = 64;

pub struct RestoredOwnerJudgment {
    entry: EntryId,
    lane_digest: Option<[u8; 32]>,
    history: History,
    after: After,
    items: BTreeMap<Line, Item>,
    policy: crate::policy::Slice,
    bodies: HashMap<EditId, Body>,
}
impl RestoredOwnerJudgment {
    pub fn entry(&self) -> EntryId {
        self.entry
    }
    pub fn counted_writes(&self) -> usize {
        self.history.changes().iter().filter(|c| c.counted).count()
    }
    /// Store adoption, policy replay anchors and durable suffix recovery remain separate.
    pub fn is_writable(&self) -> bool {
        false
    }
}
// Exact Lane::with_built_ins input order, including shipped schema/lens versions.
fn bootstrap_lane_digest(state: &State, readings: &Readings, vault: VaultId) -> [u8; 32] {
    let mut h = Hasher::new("bootstrap lane inputs v1");
    for bytes in crate::lens::blobs::SHIPPED.iter().chain(&crate::lens::blobs::LENSES).map(|s| s.as_bytes()).chain(state.lane_of(vault, readings)) { h.update(&BlobId::of(bytes).0); }
    h.finalize()
}
const LANE_ATTESTATION: &[u8] = b"lane1";
fn judgment_context(vault: VaultId, entry: EntryId) -> Vec<u8> {
    let mut b = JUDGMENT.to_vec();
    vault.encode(&mut b);
    entry.encode(&mut b);
    b
}
fn bounded_count(r: &mut WireReader<'_>, min: usize, max: usize) -> Option<usize> {
    let n = r.count(min).ok()?;
    (n <= max).then_some(n)
}
fn seq<T: Decode>(r: &mut WireReader<'_>, min: usize, max: usize) -> Option<Vec<T>> {
    (0..bounded_count(r, min, max)?)
        .map(|_| T::decode(r).ok())
        .collect()
}
fn put_loc(l: &Loc, b: &mut Vec<u8>) {
    (l.0.len() as u32).encode(b);
    for s in &l.0 {
        match s {
            Seg::Field(f) => {
                b.push(0);
                f.encode(b);
            }
            Seg::Row(i) => {
                b.push(1);
                i.encode(b);
            }
        }
    }
}
fn get_loc(r: &mut WireReader<'_>) -> Option<Loc> {
    let mut out = Vec::new();
    for _ in 0..bounded_count(r, 1, MAX_PATH)? {
        out.push(match r.u8().ok()? {
            0 => {
                let s = String::decode(r).ok()?;
                if s.len() > 4096 {
                    return None;
                }
                Seg::Field(s)
            }
            1 => Seg::Row(i64::decode(r).ok()?),
            _ => return None,
        });
    }
    Some(Loc(out))
}
fn put_touch(t: &Touch, b: &mut Vec<u8>) {
    match t {
        Touch::Set(l, v) | Touch::Own(l, v) => {
            b.push(if matches!(t, Touch::Own(..)) { 1 } else { 0 });
            put_loc(l, b);
            v.encode(b);
        }
        Touch::Insert(l) => {
            b.push(2);
            put_loc(l, b);
        }
        Touch::Remove(l) => {
            b.push(3);
            put_loc(l, b);
        }
        Touch::Move(l) => {
            b.push(4);
            put_loc(l, b);
        }
        Touch::Create => b.push(5),
        Touch::Tag(t) => {
            b.push(6);
            t.encode(b);
        }
        Touch::Propose => b.push(7),
        Touch::Merge => b.push(8),
        Touch::Merged(l) => {
            b.push(9);
            put_loc(l, b);
        }
    }
}
fn get_touch(r: &mut WireReader<'_>) -> Option<Touch> {
    Some(match r.u8().ok()? {
        0 => Touch::Set(get_loc(r)?, r.option::<Scalar>().ok()?),
        1 => Touch::Own(get_loc(r)?, r.option::<Scalar>().ok()?),
        2 => Touch::Insert(get_loc(r)?),
        3 => Touch::Remove(get_loc(r)?),
        4 => Touch::Move(get_loc(r)?),
        5 => Touch::Create,
        6 => Touch::Tag(Decode::decode(r).ok()?),
        7 => Touch::Propose,
        8 => Touch::Merge,
        9 => Touch::Merged(get_loc(r)?),
        _ => return None,
    })
}
fn put_judgment(shown: &Shown, store: &Store) -> Option<Vec<u8>> {
    // Proposal labels are content: metadata-only history is not sufficient.
    let history = shown.history_in(store)?;
    // Publication must not depend on ephemeral scratch retention (last 32
    // entries or a warm reopen). Attest the same current MAIN causal snapshot.
    let scratch = Scratch::from_attested_item(shown.items_in(Some(store)).get(&MAIN)?.clone(),
        &history.history(MAIN))?;
    put_judgment_with_scratch(history, &shown.after, Some(&scratch))
}
fn put_judgment_parts(history: &History, after: &After) -> Option<Vec<u8>> {
    put_judgment_with_scratch(history, after, after.scratch.as_ref())
}
fn put_judgment_with_scratch(history: &History, after: &After, scratch: Option<&Scratch>) -> Option<Vec<u8>> {
    let mut b = Vec::new();
    (history.changes().len() as u32).encode(&mut b);
    if history.changes().len() > MAX_FACTS {
        return None;
    }
    for c in history.changes() {
        suffix::encode_write(&c.write, &mut b);
        c.fits.encode(&mut b);
        c.counted.encode(&mut b);
        match &c.touches {
            None => b.push(0),
            Some(ts) => {
                b.push(1);
                (ts.len() as u32).encode(&mut b);
                for t in ts {
                    put_touch(t, &mut b);
                }
            }
        }
        (c.adds.len() as u32).encode(&mut b);
        for l in &c.adds {
            put_loc(l, &mut b);
        }
        // A proposal's label is not a CRDT update; retain it. Historical content updates
        // are represented by the attested scratch/snapshots, not replayed from bodies.
        let label = (c.write.proposal == Proposal::New && !c.write.first)
            .then(|| c.body.clone())
            .flatten();
        label.encode(&mut b);
    }
    match &after.attrs {
        None => b.push(0),
        Some(a) => {
            b.push(1);
            a.ty.encode(&mut b);
            a.author.encode(&mut b);
            a.entry.encode(&mut b);
            a.created.encode(&mut b);
            a.tags.encode(&mut b);
        }
    }
    (after.imported.len() as u32).encode(&mut b);
    for (line, ids) in &after.imported {
        line.encode(&mut b);
        let mut ids: Vec<_> = ids.iter().copied().collect();
        ids.sort();
        ids.encode(&mut b);
    }
    after
        .asked
        .iter()
        .copied()
        .collect::<Vec<_>>()
        .encode(&mut b);
    match scratch {
        None => b.push(0),
        Some(s) => {
            let image = s.image()?;
            b.push(1);
            image.snapshot.encode(&mut b);
            image.holds.into_iter().collect::<Vec<_>>().encode(&mut b);
            image
                .authored
                .into_iter()
                .collect::<Vec<_>>()
                .encode(&mut b);
            image.tip.encode(&mut b);
        }
    }
    (b.len() <= MAX_BYTES).then_some(b)
}
fn get_judgment(bytes: &[u8], entry: EntryId, on: SignerId) -> Option<RestoredOwnerJudgment> {
    if bytes.len() > MAX_BYTES {
        return None;
    }
    let mut r = WireReader::new(bytes);
    let mut history = History::default();
    let mut ids = BTreeSet::new();
    for _ in 0..bounded_count(&mut r, 1, MAX_FACTS)? {
        let w = suffix::decode_write(&mut r)?;
        if w.entry != entry
            || w.first != ids.is_empty()
            || (w.first && !w.deps.is_empty())
            || !ids.insert(w.edit)
        {
            return None;
        }
        let fits = bool::decode(&mut r).ok()?;
        let counted = bool::decode(&mut r).ok()?;
        let touches = match r.u8().ok()? {
            0 => None,
            1 => Some(
                (0..bounded_count(&mut r, 1, MAX_LIST)?)
                    .map(|_| get_touch(&mut r))
                    .collect::<Option<Vec<_>>>()?,
            ),
            _ => return None,
        };
        let adds = (0..bounded_count(&mut r, 1, MAX_LIST)?)
            .map(|_| get_loc(&mut r))
            .collect::<Option<Vec<_>>>()?;
        let body = r.option::<Vec<u8>>().ok()?;
        if body
            .as_ref()
            .is_some_and(|b| b.len() > 4096 || w.proposal != Proposal::New || w.first)
            || (counted
                && (!fits
                    || touches.is_none()
                    || !w
                        .deps
                        .iter()
                        .all(|id| history.get(*id).is_some_and(|c| c.counted))))
        {
            return None;
        }
        history
            .push(Change {
                write: w,
                body,
                fits,
                touches,
                counted,
                adds,
            })
            .ok()?;
    }
    if ids.is_empty() {
        return None;
    }
    let attrs = match r.u8().ok()? {
        0 => None,
        1 => Some(Attrs {
            ty: Decode::decode(&mut r).ok()?,
            author: Decode::decode(&mut r).ok()?,
            entry: Decode::decode(&mut r).ok()?,
            created: Decode::decode(&mut r).ok()?,
            tags: seq(&mut r, 4, MAX_LIST)?,
        }),
        _ => return None,
    };
    if attrs.as_ref().is_some_and(|a| a.entry != entry) {
        return None;
    }
    let mut imported = BTreeMap::new();
    for _ in 0..bounded_count(&mut r, 5, MAX_LINES)? {
        let line = r.option::<EditId>().ok()?;
        let list = seq::<EditId>(&mut r, 32, MAX_FACTS)?;
        let set: HashSet<_> = list.iter().copied().collect();
        let expected: HashSet<_> = history.history(line).iter().map(|c| c.write.edit).collect();
        if list.len() != set.len()
            || set.is_empty()
            || !history.lines().contains(&line)
            || set != expected
            || imported.insert(line, set).is_some()
        {
            return None;
        }
    }
    let asked = seq::<BlobId>(&mut r, 32, MAX_LIST)?.into_iter().collect();
    let scratch = match r.u8().ok()? {
        0 => None,
        1 => {
            let snapshot = r.bytes().ok()?;
            snapshot_version(&snapshot)?;
            let hold_ids = seq::<EditId>(&mut r, 32, MAX_FACTS)?;
            let holds: BTreeSet<_> = hold_ids.iter().copied().collect();
            if holds.len() != hold_ids.len() {
                return None;
            }
            let authored = seq::<BlobId>(&mut r, 32, MAX_LIST)?.into_iter().collect();
            let tip = r.option::<EditId>().ok()?;
            if !holds.is_subset(&ids)
                || holds.iter().any(|id| {
                    history
                        .get(*id)
                        .is_none_or(|c| !c.write.deps.iter().all(|d| holds.contains(d)))
                })
            {
                return None;
            }
            let line = tip
                .and_then(|id| history.get(id).map(|c| c.write.line()))
                .unwrap_or(MAIN);
            Some(Scratch::from_owner_image(
                ScratchImage {
                    snapshot,
                    holds,
                    authored,
                    tip,
                },
                on,
                line,
            )?)
        }
        _ => return None,
    };
    if !r.done() {
        return None;
    }
    let mine = history.mine();
    Some(RestoredOwnerJudgment {
        entry,
        lane_digest: None,
        history,
        after: After {
            scratch,
            attrs,
            mine,
            imported,
            asked,
        },
        items: BTreeMap::new(),
        policy: crate::policy::Slice::default(),
        bodies: HashMap::new(),
    })
}
impl Lab {
    /// Owner ceremony over complete content-judgment metadata plus per-line full CRDT
    /// state. This attests the owners' judgment under Snapshot's existing trust model;
    /// it does not manufacture historical author signatures or mutate the policy kernel.
    pub fn draft_judged_entry_base(
        &mut self,
        on: SignerId,
        signers: &[SignerId],
        entry: EntryId,
    ) -> Result<PreparedEntryBase, Refusal> {
        if self.owner_base_wait_reason(on, entry).is_some()
            || self.owner_base_pending(on, entry) > 0
            || self.owner_base_durability_pending(on, entry) {
            return Err(Refusal::ReadOnly);
        }
        let prepared = self.draft_entry_base(on, signers, entry)?;
        let Action::Snapshot { vault, states } = &prepared.draft.edit.action else {
            return Err(Refusal::NotAccepted);
        };
        let vault = *vault;
        let basis = states[0].basis.clone();
        let store = self.held(on);
        let shown = store.shown.get(&entry).ok_or(Refusal::NotAccepted)?;
        let metadata = put_judgment(shown, store).ok_or(Refusal::NotAccepted)?;
        get_judgment(&metadata, entry, on).ok_or(Refusal::NotAccepted)?;
        let key = store
            .replay
            .state
            .entry_key(entry)
            .and_then(|name| store.keys.first(name))
            .ok_or(Refusal::NoCap)?
            .clone();
        let base = keys::open_edit(&key, &prepared.sealed, &context(vault, entry))
            .ok_or(Refusal::NotAccepted)?;
        let mut bytes = judgment_context(vault, entry);
        base.encode(&mut bytes);
        metadata.encode(&mut bytes);
        put_anchor_metadata(store, entry)
            .ok_or(Refusal::NotAccepted)?
            .encode(&mut bytes);
        bytes.extend_from_slice(LANE_ATTESTATION);
        bytes.extend_from_slice(&bootstrap_lane_digest(&store.replay.state, &store.readings, vault));
        if bytes.len() > MAX_BYTES {
            return Err(Refusal::NotAccepted);
        }
        let sealed = keys::seal_edit(&key, &bytes, &judgment_context(vault, entry), &mut self.rng);
        let root = FileRoot {
            hash: crate::hash::content(&sealed),
            size: sealed.len() as u64,
        };
        let draft = self.draft(
            on,
            signers,
            Action::Snapshot {
                vault,
                states: vec![crate::policy::Stated {
                    entry,
                    basis,
                    slice: root,
                }],
            },
        )?;
        Ok(PreparedEntryBase {
            draft,
            sealed,
            root,
        })
    }
    /// Restore only entry judgment. Policy is independently held and checked on EVERY
    /// call; a known later removal refuses restoration. No Store/Node writable activation.
    pub fn restore_owner_judgment(
        &self,
        on: SignerId,
        snapshot: EditId,
        entry: EntryId,
        sealed: &[u8],
    ) -> Option<RestoredOwnerJudgment> {
        self.decode_owner_judgment(on, snapshot, entry, sealed, true)
    }

    // Retirement separately reconstructs canonical judgment from every held body.
    // Parsing owner-authenticated metadata does not install or authorize a state.
    fn decode_owner_judgment(&self, on: SignerId, snapshot: EditId, entry: EntryId,
        sealed: &[u8], compare_held: bool) -> Option<RestoredOwnerJudgment> {
        if capsule::is_local(sealed) {
            let (owner, capsule)=capsule::local_parts(sealed)?;
            return self.decode_capsuled_owner_judgment(on,snapshot,entry,&owner,&capsule,compare_held);
        }
        if sealed.len() > MAX_BYTES + 128 {
            return None;
        }
        let (vault, stated, name) = self.projection_authority(on, snapshot, entry)?;
        if stated.slice.size != sealed.len() as u64
            || stated.slice.hash != crate::hash::content(sealed)
        {
            return None;
        }
        let store = self.held(on);
        let key = store.keys.get(&keys::edit_key(sealed)?, name)?;
        let bytes = keys::open_edit(key, sealed, &judgment_context(vault, entry))?;
        self.decode_owner_judgment_plain(on, entry, vault, stated, &bytes, compare_held)
    }
    fn decode_owner_judgment_plain(&self, on: SignerId, entry: EntryId, vault: VaultId,
        stated: &crate::policy::Stated, bytes: &[u8], compare_held: bool) -> Option<RestoredOwnerJudgment> {
        let store = self.held(on);
        if bytes.len() > MAX_BYTES {
            return None;
        }
        let mut r = WireReader::new(&bytes);
        let prefix = judgment_context(vault, entry);
        if r.take(prefix.len()).ok()? != prefix {
            return None;
        }
        let base = r.bytes().ok()?;
        let metadata = r.bytes().ok()?;
        let policy_bytes = r.bytes().ok()?;
        let (policy, bodies) = get_anchor_metadata(&policy_bytes, entry, vault)?;
        // Old owner judgments remain useful read-only state, never a writable empty-lane claim.
        let lane_digest = if r.done() { None } else {
            if r.take(LANE_ATTESTATION.len()).ok()? != LANE_ATTESTATION { return None; }
            Some(r.take(32).ok()?.try_into().ok()?)
        };
        if !r.done() { return None; }
        let lines = decode(&base, vault, entry, &stated.basis)?;
        let mut restored = get_judgment(&metadata, entry, on)?;
        if policy.writes.iter().collect::<Vec<_>>()
            != restored
                .history
                .changes()
                .iter()
                .map(|c| &c.write)
                .collect::<Vec<_>>()
        {
            return None;
        }
        restored.lane_digest = lane_digest;
        restored.policy = policy;
        restored.bodies = bodies;
        for (line, base) in &lines {
            let mut heads = restored.history.heads(*line);
            heads.sort();
            heads.dedup();
            if heads != base.basis {
                return None;
            }
        }
        let line_set: BTreeSet<_> = restored
            .history
            .lines()
            .into_iter()
            .filter(|l| *l != MAIN || restored.history.landed())
            .collect();
        if line_set != lines.keys().copied().collect() {
            return None;
        }
        // Full holders compare owner claims to the canonical current cut. Historical
        // cuts after later local writes deliberately fall back until prefix restoration
        // is implemented; never compare merely JSON or trust the claim over held facts.
        if compare_held && stated.basis.iter().all(|id| store.log.ids().contains(id)) {
            let shown = store.shown.get(&entry)?;
            if put_judgment(shown, store)? != metadata
                || put_anchor_metadata(store, entry)? != policy_bytes
            {
                return None;
            }
            for (line, base) in &lines {
                shown.history_in(store)?
                    .snapshot_scratch(&base.basis, &base.snapshot, on, *line)?;
            }
        }
        restored.items = lines
            .into_iter()
            .map(|(line, base)| Some((line, Item::from_owner_snapshot(&base.snapshot, on, line)?)))
            .collect::<Option<_>>()?;
        Some(restored)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};
    #[test]
    fn warm_reopen_publishes_judged_base_with_proposal_labels() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Warm publisher");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        let heads = lab.history(mac, entry).unwrap().heads(MAIN);
        let proposal = lab.propose(mac, vault, entry, &heads, "Retain this proposal label").unwrap();
        lab.sync(mac, phone);
        let expected = put_judgment(&lab.held(mac).shown[&entry], lab.held(mac)).unwrap();
        lab.stores.get_mut(&mac).unwrap().shown.get_mut(&entry).unwrap().after.scratch = None;
        assert_eq!(put_judgment(&lab.held(mac).shown[&entry], lab.held(mac)).unwrap(), expected,
            "ephemeral scratch eviction cannot alter published causal judgment");
        let backup = lab.backup(mac);
        let n = backup.signed.len();
        let receipt = lab.capture_warm_current(mac, n, Some([27; 40])).unwrap().encode();
        let warm = Warm { keys: receipt.keys.clone().into_iter().collect(), views: receipt.view.clone().into_iter().collect() };
        lab.warmed(mac, receipt);
        lab.restore_warm(mac, backup, Some(([27; 40], n)), &warm);
        assert!(lab.held(mac).deferred_bodies.contains_key(&proposal));
        // Projection/base publication can use current snapshots without an empty
        // fallback; judged publication must also demand the proposal label.
        assert!(lab.draft_entry_projection(mac, &[owner], entry).is_ok());
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        assert_eq!(put_judgment(&lab.held(mac).shown[&entry], lab.held(mac)).unwrap(), expected);
        assert!(lab.held(mac).deferred_bodies[&proposal].content_ready());
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        lab.sync(mac, phone);
        let backup = lab.backup(phone);
        let n = backup.signed.len();
        let receipt = lab.capture_warm_current(phone, n, Some([28; 40])).unwrap().encode();
        let warm = Warm { keys: receipt.keys.clone().into_iter().collect(), views: receipt.view.clone().into_iter().collect() };
        lab.warmed(phone, receipt);
        lab.restore_warm(phone, backup, Some(([28; 40], n)), &warm);
        assert!(lab.held(phone).deferred_bodies.contains_key(&proposal));
        let restored = lab.restore_owner_judgment(phone, snapshot, entry, &sealed).unwrap();
        assert_eq!(put_judgment_parts(&restored.history, &restored.after).unwrap(), expected,
            "full holder accepts identical judgment including proposal labels");
        assert!(restored.history.get(proposal).unwrap().body.as_ref().is_some_and(|label| !label.is_empty()));
    }

    #[test]
    fn owner_judgment_restores_partial_history_metadata_without_changing_kernel() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab
            .create(mac, vault, vault, "note", &[], document("Base", "old", mac))
            .unwrap();
        lab.sync(mac, phone);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "new"))
            .unwrap();
        let PreparedEntryBase { draft, sealed, .. } =
            lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        let held = lab.log(phone).ids().to_vec();
        let kernel = lab.state(phone).clone();
        let restored = lab
            .restore_owner_judgment(phone, snapshot, entry, &sealed)
            .unwrap();
        assert!(!restored.is_writable());
        assert_eq!(restored.counted_writes(), 2);
        assert_eq!(lab.log(phone).ids(), held);
        assert_eq!(*lab.state(phone), kernel);
        assert!(
            lab.restore_owner_judgment(mac, snapshot, entry, &sealed)
                .is_some()
        );
        let original = lab.held(mac).shown.get(&entry).unwrap();
        assert_eq!(restored.after.attrs, original.after.attrs);
        assert_eq!(restored.after.imported, original.after.imported);
        assert_eq!(restored.after.asked, original.after.asked);
        assert_eq!(
            restored.items[&MAIN].record(),
            lab.item(mac, entry).unwrap().record()
        );
        for (a, b) in restored
            .history
            .changes()
            .iter()
            .zip(original.history.changes())
        {
            assert_eq!(a.write, b.write);
            assert_eq!(a.fits, b.fits);
            assert_eq!(a.counted, b.counted);
            assert_eq!(a.touches, b.touches);
            assert_eq!(a.adds, b.adds);
            assert!(
                a.body.is_none(),
                "historical CRDT updates were not retained"
            );
            for loc in &a.adds {
                let probe = vec![Touch::Set(loc.clone(), None)];
                assert_eq!(
                    restored.after.mine.mark(vault, &probe),
                    original.after.mine.mark(vault, &probe)
                );
            }
        }
        let expected = put_judgment(original, lab.held(mac)).unwrap();
        assert_eq!(
            put_judgment_parts(&restored.history, &restored.after).unwrap(),
            expected,
            "metadata roundtrip is exact"
        );
        let mut corrupt = sealed.clone();
        corrupt[0] ^= 1;
        assert!(
            lab.restore_owner_judgment(phone, snapshot, entry, &corrupt)
                .is_none()
        );
        assert!(
            lab.restore_owner_judgment(phone, snapshot, EntryId([95; 32]), &sealed)
                .is_none()
        );
        // A structurally valid owner-attested lie is rejected by a holder with the
        // independently judged cut, not accepted merely because the owner signed it.
        let (v, stated, name) = lab.projection_authority(mac, snapshot, entry).unwrap();
        let basis = stated.basis.clone();
        let key = lab.held(mac).keys.first(name).unwrap().clone();
        let plain = keys::open_edit(&key, &sealed, &judgment_context(v, entry)).unwrap();
        let mut r = WireReader::new(&plain);
        r.take(judgment_context(v, entry).len()).unwrap();
        let base = r.bytes().unwrap();
        let _metadata = r.bytes().unwrap();
        let policy_bytes = r.bytes().unwrap();
        let mut lying = restored;
        lying
            .after
            .attrs
            .as_mut()
            .unwrap()
            .tags
            .push(Sym::new("invented"));
        let mut plain = judgment_context(v, entry);
        base.encode(&mut plain);
        put_judgment_parts(&lying.history, &lying.after)
            .unwrap()
            .encode(&mut plain);
        policy_bytes.encode(&mut plain);
        plain.extend_from_slice(LANE_ATTESTATION);
        plain.extend_from_slice(&lying.lane_digest.unwrap());
        let lie = keys::seal_edit(&key, &plain, &judgment_context(v, entry), &mut lab.rng);
        let root = FileRoot {
            hash: crate::hash::content(&lie),
            size: lie.len() as u64,
        };
        let lie_id = lab
            .submit(
                mac,
                &[owner],
                Action::Snapshot {
                    vault: v,
                    states: vec![crate::policy::Stated {
                        entry,
                        basis,
                        slice: root,
                    }],
                },
            )
            .unwrap();
        assert!(
            lab.restore_owner_judgment(mac, lie_id, entry, &lie)
                .is_none()
        );
        let revoke = lab
            .submit(
                mac,
                &[owner],
                Action::Revoke(crate::policy::Revoking::Device {
                    vault,
                    device: phone,
                    keep: vec![],
                }),
            )
            .unwrap();
        let signed = lab
            .backup(mac)
            .signed()
            .iter()
            .filter(|e| e.edit.id() == revoke)
            .cloned()
            .collect();
        lab.receive(phone, signed, vec![]);
        assert!(!lab.state(phone).is_device(phone, vault));
        assert!(
            lab.restore_owner_judgment(phone, snapshot, entry, &sealed)
                .is_none()
        );
    }

    #[test]
    fn owner_judgment_resumed_suffix_matches_full_history_judgment() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let me = lab.device_of(owner, "Device");
        let vault = human_on(&mut lab, owner, &[me]);
        let entry = lab
            .create(me, vault, vault, "note", &[], document("Base", "old", me))
            .unwrap();
        lab.edit(me, vault, entry, |item| item.set_text(2, "base"))
            .unwrap();
        let original = lab.held(me).shown.get(&entry).unwrap();
        let bytes = put_judgment(original, lab.held(me)).unwrap();
        let restored = get_judgment(&bytes, entry, me).unwrap();
        let full_history = original.history.clone();
        let full_scratch = original.after.scratch.as_ref().map(Scratch::fork);
        let full_attrs = original.after.attrs.clone();
        let full_mine = full_history.mine();
        let full_imported = original.after.imported.clone();
        let full_asked = original.after.asked.clone();
        lab.edit(me, vault, entry, |item| item.set_text(2, "suffix"))
            .unwrap();
        let store = lab.held(me);
        let st = &store.replay.state;
        let en = st.entry(entry).unwrap();
        let lane = Lane::with_built_ins(st.lane_of(vault, &store.readings));
        let next = store
            .shown
            .get(&entry)
            .unwrap()
            .history
            .changes()
            .last()
            .unwrap()
            .write
            .clone();
        let mut full = Judging::resume(
            en,
            &store.readings,
            &lane,
            full_history,
            After {
                scratch: full_scratch,
                attrs: full_attrs,
                mine: full_mine,
                imported: full_imported,
                asked: full_asked,
            },
        );
        let mut partial =
            Judging::resume(en, &store.readings, &lane, restored.history, restored.after);
        let bodies = HashMap::from([(next.edit, store.bodies[&next.edit].clone())]);
        assert!(full.judge(
            me,
            st,
            (&store.readings, &bodies),
            &next,
            &store.readings.groups
        ));
        assert!(partial.judge(
            me,
            st,
            (&store.readings, &bodies),
            &next,
            &store.readings.groups
        ));
        assert_eq!(
            full.history.changes().last(),
            partial.history.changes().last()
        );
        assert_eq!(full.attrs, partial.attrs);
        assert_eq!(full.asked, partial.asked);
        assert_eq!(
            full.scratch.unwrap().image(),
            partial.scratch.unwrap().image()
        );
        assert!(get_judgment(&bytes[..bytes.len() - 1], entry, me).is_none());
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(get_judgment(&trailing, entry, me).is_none());
        assert!(get_judgment(&bytes, EntryId([99; 32]), me).is_none());
    }
}
