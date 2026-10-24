//! Dormant format-three counted-history claims. Owner authenticity is not proof that
//! the historical author signed each fact or that the CRDT snapshot is equivalent.
use super::*;
use crate::policy::Write;
use crate::wire::Decode;

const COUNTED_FORMAT: &[u8] = b"avenDB entry base 3\n";
const MAX_FACTS: usize = 512;
const MAX_LINKS: usize = 64;

/// Authenticated owner claim, with a bounded dependency-closed counted-write index.
/// Not a History, Item, capability, accepted suffix, or permission to mutate.
pub struct AuthenticatedCountedEntryBase {
    entry: EntryId,
    snapshot: EditId,
    facts: Vec<Write>,
    lines: BTreeMap<Line, BaseLine>,
}
impl AuthenticatedCountedEntryBase {
    pub fn entry(&self) -> EntryId { self.entry }
    pub fn snapshot(&self) -> EditId { self.snapshot }
    pub fn fact_count(&self) -> usize { self.facts.len() }
    pub fn is_writable(&self) -> bool { false }

    /// Structural check only. The caller's Write is not assumed signed/accepted. A
    /// successful result cannot enter the canonical history or grant write authority.
    pub fn links_suffix(&self, suffix: &Write) -> bool {
        bounded_write(suffix) && suffix.entry == self.entry && !suffix.first
            && !suffix.deps.is_empty()
            && !self.facts.iter().any(|w| w.edit == suffix.edit)
            && crate::policy::builds_on(&self.facts, suffix).is_ok()
    }
}

fn counted_context(vault: VaultId, entry: EntryId) -> Vec<u8> {
    let mut bytes = COUNTED_FORMAT.to_vec();
    vault.encode(&mut bytes); entry.encode(&mut bytes); bytes
}
fn bounded_write(w: &Write) -> bool {
    w.deps.len() <= MAX_LINKS && w.via.len() <= MAX_LINKS && w.shares.len() <= MAX_LINKS
        && w.deps.iter().copied().collect::<BTreeSet<_>>().len() == w.deps.len()
}
pub(super) fn encode_write(w: &Write, out: &mut Vec<u8>) {
    w.edit.encode(out); w.author.encode(out); w.actor.encode(out); w.entry.encode(out);
    w.stay.encode(out); w.epoch.encode(out); w.deps.encode(out); w.proposal.encode(out);
    w.via.encode(out); w.first.encode(out); w.audience.encode(out); w.shares.encode(out);
}
// Enforce each count BEFORE allocation/decoding, not after reading an unbounded vector.
fn links<T: Decode>(r: &mut WireReader<'_>) -> Option<Vec<T>> {
    let count = r.count(32).ok()?;
    if count > MAX_LINKS { return None; }
    (0..count).map(|_| T::decode(r).ok()).collect()
}
pub(super) fn decode_write(r: &mut WireReader<'_>) -> Option<Write> {
    Some(Write {
        edit: Decode::decode(r).ok()?, author: Decode::decode(r).ok()?,
        actor: Decode::decode(r).ok()?, entry: Decode::decode(r).ok()?,
        stay: r.option().ok()?, epoch: Decode::decode(r).ok()?, deps: links(r)?,
        proposal: Decode::decode(r).ok()?, via: links(r)?, first: Decode::decode(r).ok()?,
        audience: Decode::decode(r).ok()?, shares: links(r)?,
    })
}
fn valid_facts(entry: EntryId, facts: &[Write], lines: &BTreeMap<Line, BaseLine>) -> bool {
    if facts.is_empty() || facts.len() > MAX_FACTS { return false; }
    let mut ids = BTreeSet::new();
    for (i, w) in facts.iter().enumerate() {
        if !bounded_write(w) || w.entry != entry || !ids.insert(w.edit)
            || w.first != (i == 0) || (i == 0 && !w.deps.is_empty())
            || (i != 0 && w.deps.is_empty())
            || crate::policy::builds_on(&facts[..i], w).is_err() { return false; }
    }
    let mut covered = BTreeSet::new();
    for (line, base) in lines {
        let history = crate::policy::history(facts.iter(), *line);
        let mut tips = crate::policy::tips(&history);
        tips.sort(); tips.dedup();
        if tips != base.basis { return false; }
        covered.extend(history.iter().map(|w| w.edit));
    }
    covered == ids
}
fn counted_encode(vault: VaultId, entry: EntryId, base: &[u8], facts: &[Write]) -> Vec<u8> {
    let mut bytes = counted_context(vault, entry);
    base.to_vec().encode(&mut bytes);
    (facts.len() as u32).encode(&mut bytes);
    for w in facts { encode_write(w, &mut bytes); }
    bytes
}
fn counted_decode(bytes: &[u8], vault: VaultId, entry: EntryId, basis: &[EditId]) -> Option<(Vec<Write>, BTreeMap<Line, BaseLine>)> {
    if bytes.len() > MAX_BYTES { return None; }
    let mut r = WireReader::new(bytes);
    let prefix = counted_context(vault, entry);
    if r.take(prefix.len()).ok()? != prefix { return None; }
    let base = r.bytes().ok()?;
    let count = r.count(1).ok()?;
    if count == 0 || count > MAX_FACTS { return None; }
    let facts: Vec<_> = (0..count).map(|_| decode_write(&mut r)).collect::<Option<_>>()?;
    if !r.done() || facts.iter().any(|w| !bounded_write(w) || w.entry != entry) { return None; }
    // Parse and bound fact metadata before invoking Loro metadata decoding (whose internal
    // allocation remains unbounded by this representation; see entry_base.rs).
    let lines = decode(&base, vault, entry, basis)?;
    valid_facts(entry, &facts, &lines).then_some((facts, lines))
}
impl Lab {
    /// A separate dormant format: v2 remains readable, and Node publishes neither.
    /// The single returned draft requires ordinary explicit owner approval.
    pub fn draft_counted_entry_base(&mut self, on: SignerId, signers: &[SignerId], entry: EntryId) -> Result<PreparedEntryBase, Refusal> {
        let prepared = self.draft_entry_base(on, signers, entry)?;
        let Action::Snapshot { vault, states } = &prepared.draft.edit.action else { return Err(Refusal::NotAccepted); };
        let vault = *vault;
        let basis = states[0].basis.clone();
        let store = self.held(on);
        let shown = store.shown.get(&entry).ok_or(Refusal::NotAccepted)?;
        let changes = shown.history.version(&basis);
        if changes.len() > MAX_FACTS || changes.iter().any(|c| !c.counted) { return Err(Refusal::NotAccepted); }
        let facts: Vec<_> = changes.iter().map(|c| c.write.clone()).collect();
        let key = store.replay.state.entry_key(entry).and_then(|name| store.keys.first(name)).ok_or(Refusal::NoCap)?.clone();
        let base = keys::open_edit(&key, &prepared.sealed, &context(vault, entry)).ok_or(Refusal::NotAccepted)?;
        let lines = decode(&base, vault, entry, &basis).ok_or(Refusal::NotAccepted)?;
        if !valid_facts(entry, &facts, &lines) { return Err(Refusal::NotAccepted); }
        let bytes = counted_encode(vault, entry, &base, &facts);
        if bytes.len() > MAX_BYTES { return Err(Refusal::NotAccepted); }
        let sealed = keys::seal_edit(&key, &bytes, &counted_context(vault, entry), &mut self.rng);
        let root = FileRoot { hash: crate::hash::content(&sealed), size: sealed.len() as u64 };
        let draft = self.draft(on, signers, Action::Snapshot { vault,
            states: vec![crate::policy::Stated { entry, basis, slice: root }] })?;
        Ok(PreparedEntryBase { draft, sealed, root })
    }
    /// Strict full-holder equivalence check. Partial holders fail closed until an
    /// independently verified history-equivalence witness exists. Rechecks policy now;
    /// a previously authenticated owner claim cannot cache write authority.
    pub fn verify_counted_base_equivalence(&self, on: SignerId, snapshot: EditId, entry: EntryId, sealed: &[u8]) -> bool {
        let Some(base) = self.authenticate_counted_entry_base(on, snapshot, entry, sealed) else { return false; };
        let Some(shown) = self.held(on).shown.get(&entry) else { return false; };
        if base.facts.iter().any(|w| shown.history.get(w.edit).is_none_or(|c| !c.counted || c.write != *w)) {
            return false;
        }
        base.lines.iter().all(|(line, claim)|
            shown.history.snapshot_scratch(&claim.basis, &claim.snapshot, on, *line).is_some())
    }

    pub fn authenticate_counted_entry_base(&self, on: SignerId, snapshot: EditId, entry: EntryId, sealed: &[u8]) -> Option<AuthenticatedCountedEntryBase> {
        if sealed.len() > MAX_BYTES + 128 { return None; }
        let (vault, stated, name) = self.projection_authority(on, snapshot, entry)?;
        if stated.slice.size != sealed.len() as u64 || stated.slice.hash != crate::hash::content(sealed) { return None; }
        let key = self.held(on).keys.first(name)?;
        let bytes = keys::open_edit(key, sealed, &counted_context(vault, entry))?;
        let (facts, lines) = counted_decode(&bytes, vault, entry, &stated.basis)?;
        // A full holder never substitutes an owner claim for facts already validated.
        // A partial holder only receives the opaque non-writable claim.
        if let Some(shown) = self.held(on).shown.get(&entry) {
            if stated.basis.iter().all(|id| shown.history.get(*id).is_some()) {
                let local: Vec<_> = shown.history.version(&stated.basis).into_iter()
                    .filter(|c| c.counted).map(|c| c.write.clone()).collect();
                if local != facts { return None; }
            }
        }
        Some(AuthenticatedCountedEntryBase { entry, snapshot, facts, lines })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};
    use crate::policy::Proposal;

    #[test]
    fn counted_base_roundtrip_links_only_and_rejects_owner_fact_mismatch() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        let before = lab.item(phone, entry).unwrap().record();
        lab.edit(mac, vault, entry, |item| item.set_text(2, "new")).unwrap();
        assert!(lab.draft_counted_entry_base(mac, &[mac], entry).is_err());
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_counted_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        let ids = lab.log(phone).ids().to_vec();
        let base = lab.authenticate_counted_entry_base(phone, snapshot, entry, &sealed).unwrap();
        assert_eq!(base.entry(), entry);
        assert_eq!(base.snapshot(), snapshot);
        assert_eq!(base.fact_count(), 2);
        assert!(!base.is_writable());
        assert!(lab.authenticate_counted_entry_base(mac, snapshot, entry, &sealed).is_some());
        assert!(lab.verify_counted_base_equivalence(mac, snapshot, entry, &sealed));
        assert!(!lab.verify_counted_base_equivalence(phone, snapshot, entry, &sealed),
            "an owner claim cannot replace missing independently counted history");
        assert!(lab.authenticate_entry_base(phone, snapshot, entry, &sealed).is_none());
        let mut suffix = base.facts.last().unwrap().clone();
        suffix.edit = EditId([92; 32]);
        suffix.deps = vec![base.facts.last().unwrap().edit];
        assert!(base.links_suffix(&suffix));
        assert!(!base.is_writable(), "linking grants no mutation authority");
        suffix.deps = vec![EditId([93; 32])];
        assert!(!base.links_suffix(&suffix));
        suffix.deps = vec![base.facts.last().unwrap().edit];
        suffix.entry = EntryId([94; 32]);
        assert!(!base.links_suffix(&suffix));
        suffix.entry = entry;
        suffix.proposal = Proposal::On(EditId([95; 32]));
        assert!(!base.links_suffix(&suffix));
        assert_eq!(lab.log(phone).ids(), ids);
        assert_eq!(lab.item(phone, entry).unwrap().record(), before);
        let mut corrupt = sealed.clone(); corrupt[0] ^= 1;
        assert!(lab.authenticate_counted_entry_base(phone, snapshot, entry, &corrupt).is_none());

        // A correctly owner-signed envelope still cannot override independently held
        // counted facts. Alter author metadata without changing IDs/dependency shape.
        let (vault, stated, name) = lab.projection_authority(mac, snapshot, entry).unwrap();
        let basis = stated.basis.clone();
        let key = lab.held(mac).keys.first(name).unwrap().clone();
        let bytes = keys::open_edit(&key, &sealed, &counted_context(vault, entry)).unwrap();
        let mut r = WireReader::new(&bytes);
        r.take(counted_context(vault, entry).len()).unwrap();
        let raw_base = r.bytes().unwrap();
        let mut facts = base.facts.clone(); facts[1].author = SignerId([96;32]);
        let bytes = counted_encode(vault, entry, &raw_base, &facts);
        let tampered = keys::seal_edit(&key, &bytes, &counted_context(vault, entry), &mut lab.rng);
        let root = FileRoot { hash: crate::hash::content(&tampered), size: tampered.len() as u64 };
        let altered = lab.submit(mac, &[owner], Action::Snapshot { vault, states: vec![crate::policy::Stated { entry, basis, slice: root }] }).unwrap();
        assert!(lab.authenticate_counted_entry_base(mac, altered, entry, &tampered).is_none());
        let revoke = lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device {
            vault, device: phone, keep: vec![],
        })).unwrap();
        let signed = lab.backup(mac).signed().iter().filter(|e| e.edit.id() == revoke).cloned().collect();
        lab.receive(phone, signed, vec![]);
        assert!(!lab.state(phone).is_device(phone, vault));
        assert!(lab.authenticate_counted_entry_base(phone, snapshot, entry, &sealed).is_none());
    }

    #[test]
    fn counted_base_rejects_cycles_duplicates_missing_creation_and_wrong_frontier() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let me = lab.device_of(owner, "Device");
        let vault = human_on(&mut lab, owner, &[me]);
        let entry = lab.create(me, vault, vault, "note", &[], document("Base", "old", me)).unwrap();
        lab.edit(me, vault, entry, |item| item.set_text(2, "new")).unwrap();
        let shown = lab.held(me).shown.get(&entry).unwrap();
        let facts: Vec<_> = shown.history.changes().iter().filter(|c| c.counted).map(|c| c.write.clone()).collect();
        let basis = vec![facts.last().unwrap().edit];
        let item = lab.item(me, entry).unwrap();
        let lines = BTreeMap::from([(MAIN, BaseLine { basis: basis.clone(), version: item.version().0, snapshot: item.bytes() })]);
        assert!(valid_facts(entry, &facts, &lines));
        let raw_base = encode(vault, entry, &basis, &lines);
        let bytes = counted_encode(vault, entry, &raw_base, &facts);
        assert_eq!(counted_decode(&bytes, vault, entry, &basis).unwrap().0, facts);
        let mut bad = facts.clone(); bad[0].deps = vec![bad[1].edit];
        assert!(!valid_facts(entry, &bad, &lines));
        let mut bad = facts.clone(); bad.push(bad[1].clone());
        assert!(!valid_facts(entry, &bad, &lines));
        let mut bad = facts.clone(); bad[0].first = false;
        assert!(!valid_facts(entry, &bad, &lines));
        let mut bad = facts.clone(); bad[1].deps.clear();
        assert!(!valid_facts(entry, &bad, &lines));
        let mut bad = facts.clone(); bad[1].entry = EntryId([97;32]);
        assert!(!valid_facts(entry, &bad, &lines));
        let mut bad = lines.clone(); bad.get_mut(&MAIN).unwrap().basis = vec![facts[0].edit];
        assert!(!valid_facts(entry, &facts, &bad));
        assert!(counted_decode(&bytes[..bytes.len()-1], vault, entry, &basis).is_none());
        let mut bad = bytes.clone(); bad.push(0);
        assert!(counted_decode(&bad, vault, entry, &basis).is_none());
        assert!(counted_decode(&bytes, vault, EntryId([98;32]), &basis).is_none());
        let mut bomb = counted_context(vault, entry);
        raw_base.encode(&mut bomb); ((MAX_FACTS+1) as u32).encode(&mut bomb);
        bomb.extend(vec![0;MAX_FACTS+1]);
        assert!(counted_decode(&bomb, vault, entry, &basis).is_none());
        let mut links_bomb = Vec::new(); ((MAX_LINKS+1) as u32).encode(&mut links_bomb);
        links_bomb.extend(vec![0;32*(MAX_LINKS+1)]);
        assert!(links::<EditId>(&mut WireReader::new(&links_bomb)).is_none());
    }
    #[test]
    fn counted_base_scratch_and_full_history_use_identical_suffix_admission() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let me = lab.device_of(owner, "Device");
        let vault = human_on(&mut lab, owner, &[me]);
        let entry = lab.create(me, vault, vault, "note", &[], document("Base", "old", me)).unwrap();
        let history = lab.held(me).shown.get(&entry).unwrap().history.clone();
        let basis = history.heads(MAIN);
        let snapshot = lab.item(me, entry).unwrap().bytes();
        let mut scratch = Some(history.snapshot_scratch(&basis, &snapshot, me, MAIN).unwrap());
        let mut bad = snapshot.clone(); bad[0] ^= 1;
        assert!(history.snapshot_scratch(&basis, &bad, me, MAIN).is_none());
        assert!(history.snapshot_scratch(&[EditId([91;32])], &snapshot, me, MAIN).is_none());
        lab.edit(me, vault, entry, |item| item.set_text(2, "next")).unwrap();
        let store = lab.held(me);
        let next = store.shown.get(&entry).unwrap().history.changes().last().unwrap();
        assert!(next.counted);
        let lane = Lane::with_built_ins(store.replay.state.lane_of(vault, &store.readings));
        let cold = history.reading(&next.write, next.body.as_deref(), me, &lane);
        let warm = history.reading_on(&mut scratch, &next.write, next.body.as_deref(), me, &lane);
        assert_eq!(cold, warm, "same footprint, schema verdict and row additions");
        assert_eq!(history.admit(&next.write, &cold, || Ok(())), Ok(()));
        assert_eq!(history.admit(&next.write, &warm, || Ok(())), Ok(()));
        assert_eq!(history.admit(&next.write, &warm, || Err::<(), _>(Refusal::NotAllowed)), Err(Refusal::NotAllowed));
        let mut invalid_schema = warm.clone(); invalid_schema.fits = false;
        assert_eq!(history.admit(&next.write, &invalid_schema, || Ok(())), Err(Refusal::NotAView));
        let mut missing = next.write.clone(); missing.deps = vec![EditId([92;32])];
        assert!(history.admit(&missing, &warm, || Ok(())).is_err());
        let mut uncounted = History::default();
        for c in history.changes() {
            let mut c = c.clone(); c.counted = false; uncounted.push(c).unwrap();
        }
        assert_eq!(uncounted.admit(&next.write, &warm, || Ok(())), Err(Refusal::NotAccepted));
        assert!(uncounted.snapshot_scratch(&basis, &snapshot, me, MAIN).is_none());
    }

}
