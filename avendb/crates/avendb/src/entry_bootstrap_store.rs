//! Owner-held partial Store: main-line append while older content is absent.
//! Received shared writes require complete group-free grant proofs. Proposal forks
//! require their exact causal bodies; shared-holder authoring remains unsupported.
use super::*;

pub(crate) type Anchors = BTreeMap<EntryId, (EditId, Vec<u8>)>;

const SUFFIX_BATCH: usize = 32;
pub(crate) struct BootstrapProgress {
    basis: OverlayBasis,
    policy: crate::policy::Slice,
    lane_digest: Option<[u8;32]>,
    base_scratch: Option<Scratch>,
    pending: std::collections::VecDeque<EditId>,
    missing: Vec<EditId>,
    wait_reason: Option<&'static str>,
}


// Process-local identity of immutable inputs, never persisted or accepted from a peer.
// Bodies/blobs/signed entries are content-addressed and append-only between forgets;
// key insertions and anchor replacement have explicit allocation-identity revisions.
pub(crate) struct OverlayBasis {
    log: crate::policy::LogRevision,
    keys: Arc<()>,
    anchors: Arc<()>,
    warm: Arc<()>,
    bodies: usize,
    blobs: usize,
    signed: usize,
    follow: Vec<VaultId>,
    depth: usize,
    gate: bool,
}
impl OverlayBasis {
    fn of(store: &Store) -> Self {
        Self { log: store.log.revision(), keys: store.keys.revision.clone(),
            anchors: store.bootstrap_revision.clone(), warm: store.warm_revision.clone(),
            bodies: store.bodies.len(), blobs: store.blobs.len(), signed: store.signed.len(),
            follow: store.follow.clone(), depth: store.query_depth, gate: store.gate }
    }
    fn matches(&self, store: &Store) -> bool {
        self.log == store.log.revision() && Arc::ptr_eq(&self.keys, &store.keys.revision)
            && Arc::ptr_eq(&self.anchors, &store.bootstrap_revision)
            && Arc::ptr_eq(&self.warm, &store.warm_revision)
            && self.bodies == store.bodies.len() && self.blobs == store.blobs.len()
            && self.signed == store.signed.len() && self.follow == store.follow
            && self.depth == store.query_depth && self.gate == store.gate
    }
}
// Move, rather than clone, the current derived entries through a canonical refresh.
// There is no second long-lived item/history cache and no skipped policy replay.
pub(crate) struct RetainedOverlay {
    basis: OverlayBasis,
    state: State,
    shown: HashMap<EntryId, Shown>,
    active: HashSet<EntryId>,
    readings: Readings,
}

// One-time transition to ordinary canonical state, never reuse an overlay as proof.
fn canonical_owner_replacement(on: SignerId, store: &Store, base: &RestoredOwnerJudgment) -> Option<Shown> {
    let state=&store.replay.state;
    if store.replayed != store.log.edits().len() { return None; }
    let en=state.entry(base.entry)?;
    if !state.acts_for(on,en.vault) { return None; }
    let held=|id: EditId| store.signed.contains_key(&id) && store.bodies.contains_key(&id);
    if !base.history.changes().iter().all(|c| held(c.write.edit))
        || !state.entry_writes(base.entry).all(|w| held(w.edit)) { return None; }
    let lane=Lane::with_built_ins(state.lane_of(en.vault,&store.readings));
    let canonical=judged_anew(on,state,(&store.readings,&store.bodies),&store.readings.groups,en,&lane);
    if !base.history.changes().iter().all(|old| canonical.history.get(old.write.edit).is_some_and(|now|
        now.write==old.write && now.counted==old.counted && now.fits==old.fits
            && now.touches==old.touches && now.adds==old.adds)) { return None; }
    // An uncounted post-base write may lack a schema/lens rather than be a final
    // rejection. Keep the anchor until all supported suffix judgments are known.
    if canonical.history.changes().iter().any(|c|
        base.history.get(c.write.edit).is_none() && !c.counted) { return None; }
    if !canonical.items().contains_key(&MAIN)
        || canonical.items().values().any(Item::has_parked_updates) { return None; }
    Some(canonical)
}

// Fixed grant commitments are self-contained; group-based grants require historical
// group readiness beyond this slice. Ordinary State::lets still checks every op.
fn bootstrap_share_proof(state: &State, vault: VaultId, write: &Write, proof: Option<&Proof>) -> bool {
    if write.actor == vault && write.shares.is_empty() { return true; }
    let Some(proof)=proof.filter(|p| write.shares.contains(&p.share)) else { return false; };
    let Some(issued)=state.share(proof.share) else { return false; };
    issued.chain.len()==proof.grants.len() && !issued.chain.is_empty()
        && issued.chain.iter().zip(&proof.grants).all(|(id,grant)|
            state.share(*id).is_some_and(|cp| cp.share.group.is_none()
                && cp.commitment==Some(grant.commitment()) && cp.share.level==grant.level()))
}

impl Lab {

    pub fn owner_bases_pending(&self, on: SignerId) -> bool {
        !self.locked(on) && self.held(on).bootstrap_progress.values().any(|p| !p.pending.is_empty() && p.missing.is_empty() && p.wait_reason.is_none())
    }
    /// A retained ciphertext wait is distinct from a missing signed-edit demand.
    pub fn owner_base_wait_reason(&self, on: SignerId, entry: EntryId) -> Option<&'static str> {
        self.active_owner_base(on, entry)?;
        self.held(on).bootstrap_progress.get(&entry)?.wait_reason
    }
    /// Missing authenticated historical bodies of the selected dependency cut.
    /// Current owner authorization gates this local scheduling hint; it grants no
    /// remote access. Held encrypted edits may instead need ordinary key recovery.
    pub fn owner_base_missing(&self, on: SignerId) -> Vec<(EntryId, Vec<EditId>)> {
        self.held(on).bootstrap_progress.iter()
            .filter(|(entry, p)| !p.missing.is_empty() && self.active_owner_base(on, **entry).is_some())
            .map(|(entry, p)| (*entry, p.missing.clone())).collect()
    }
    /// Remaining authenticated-log work, not complete history or file availability.
    pub fn owner_base_pending(&self, on: SignerId, entry: EntryId) -> usize {
        self.held(on).bootstrap_progress.get(&entry).map_or(0, |p| p.pending.len())
    }
    /// One bounded materialization turn. The Node pump must yield between turns.
    /// A changed input basis restarts from the owner-attested base, never a stale cursor.
    pub fn advance_owner_bases(&mut self, on: SignerId) -> bool {
        let at = self.at(on);
        if self.locked(at) || !self.owner_bases_pending(at) { return false; }
        self.rebuild_owner_bases(at);
        self.owner_bases_pending(at)
    }
    /// Authorized provenance of a currently adopted owner base. A hint is neither
    /// global completeness nor permission to skip ordinary write admission.
    pub fn active_owner_base(&self, on: SignerId, entry: EntryId) -> Option<(EditId, Vec<EditId>)> {
        let store = self.held(on);
        if !store.bootstrap_active.contains(&entry)
            || store.replayed != store.log.edits().len() { return None; }
        let (snapshot, _) = store.bootstrap_bases.get(&entry)?;
        let (vault, stated, _) = self.projection_authority(on, *snapshot, entry)?;
        if !store.replay.state.acts_for(on, vault) { return None; }
        Some((*snapshot, stated.basis.clone()))
    }

    pub(crate) fn take_owner_overlay(&mut self, on: SignerId) -> Option<RetainedOverlay> {
        let store = self.stores.get_mut(&on)?;
        let basis = store.bootstrap_basis.take()?;
        if store.reshow || !basis.matches(store) || store.bootstrap_active.is_empty() { return None; }
        let state = store.bootstrap_state.take()?;
        let active = std::mem::take(&mut store.bootstrap_active);
        let shown = active.iter().filter_map(|e| store.shown.remove(e).map(|s| (*e, s))).collect();
        let readings = std::mem::take(&mut store.readings);
        store.readings.groups = readings.groups.clone();
        Some(RetainedOverlay { basis, state, shown, active, readings })
    }

    pub(crate) fn restore_owner_overlay(&mut self, on: SignerId, retained: Option<RetainedOverlay>) -> bool {
        let Some(retained) = retained else { return false; };
        if !retained.basis.matches(self.held(on)) { return false; }
        // Recheck current recipient entitlement even though the signed log is unchanged.
        for entry in &retained.active {
            let Some((snapshot, _)) = self.held(on).bootstrap_bases.get(entry) else { return false; };
            if self.projection_authority(on, *snapshot, *entry).is_none() { return false; }
        }
        let store = self.stores.get_mut(&on).expect("device");
        store.shown.extend(retained.shown);
        store.readings = retained.readings;
        store.latest = OnceLock::from(retained.state.clone());
        store.bootstrap_state = Some(retained.state);
        store.bootstrap_active = retained.active;
        store.bootstrap_basis = Some(retained.basis);
        store.perf.count("bootstrap: unchanged overlay reused", 1);
        true
    }

    pub fn adopt_owner_entry_base(
        &mut self,
        on: SignerId,
        snapshot: EditId,
        entry: EntryId,
        sealed: Vec<u8>,
    ) -> bool {
        if self
            .restore_owner_judgment(on, snapshot, entry, &sealed)
            .is_none()
        {
            return false;
        }
        let at = self.at(on);
        let store = self.stores.get_mut(&at).expect("device");
        if !store.bootstrap_bases.contains_key(&entry) && store.bootstrap_bases.len() >= 16 {
            return false;
        }
        store.bootstrap_revision = Arc::new(());
        store.bootstrap_basis = None;
        store.bootstrap_bases.insert(entry, (snapshot, sealed));
        self.rebuild_owner_bases(at);
        self.held(at).bootstrap_active.contains(&entry)
    }

    /// Reauthenticate ciphertext and policy on every reconstruction. The signed suffix
    /// stays in the ordinary log; only the entry's derived view is overlaid.
    pub(crate) fn rebuild_owner_bases(&mut self, on: SignerId) {
        // Only IDs are copied. Reusable cursors never clone/decrypt sealed anchors.
        let mut entries: Vec<_> = self.held(on).bootstrap_bases.keys().copied().collect();
        if let Some(last) = self.held(on).bootstrap_cursor {
            let next = entries.partition_point(|entry| *entry <= last);
            let n = entries.len();
            if n > 0 { entries.rotate_left(next % n); }
        }
        let mut restored = Vec::new();
        for entry in &entries {
            let snapshot = self.held(on).bootstrap_bases[entry].0;
            // Only attempt retirement after the complete attested frontier is locally held.
            // Frontier presence alone never establishes content/judgment completeness.
            let frontier_held = self.projection_authority(on,snapshot,*entry)
                .is_some_and(|(_,stated,_)| stated.basis.iter().all(|id| self.held(on).signed.contains_key(id)));
            if frontier_held {
                let sealed=&self.held(on).bootstrap_bases[entry].1;
                if let Some(base)=self.decode_owner_judgment(on,snapshot,*entry,sealed,false) {
                    if let Some(canonical)=canonical_owner_replacement(on,self.held(on),&base) {
                        let store=self.stores.get_mut(&on).expect("device");
                        store.shown.insert(*entry,canonical);
                        store.bootstrap_bases.remove(entry);
                        store.bootstrap_progress.remove(entry);
                        store.bootstrap_pending.remove(entry);
                        store.bootstrap_active.remove(entry);
                        store.bootstrap_revision=Arc::new(());
                        continue;
                    }
                }
            }
            let reusable = self.held(on).bootstrap_progress.get(entry)
                .is_some_and(|p| p.basis.matches(self.held(on)))
                && self.active_owner_base(on, *entry).is_some();
            if reusable {
                let at = self.at(on);
                let store = self.stores.get_mut(&at).expect("device");
                let progress = store.bootstrap_progress.remove(entry).expect("progress");
                if let Some(shown) = store.shown.remove(entry) {
                    let base = RestoredOwnerJudgment { entry: *entry, lane_digest: progress.lane_digest, history: shown.history,
                        after: shown.after, items: shown.items.into_inner().unwrap_or_default(),
                        policy: progress.policy, bodies: HashMap::new() };
                    restored.push((snapshot, base, Some((progress.pending, progress.base_scratch, progress.missing, progress.wait_reason))));
                    continue;
                }
            }
            let at = self.at(on);
            self.stores.get_mut(&at).expect("device").bootstrap_progress.remove(entry);
            let sealed = &self.held(on).bootstrap_bases[entry].1;
            if let Some(base) = self.restore_owner_judgment(on, snapshot, *entry, sealed) {
                restored.push((snapshot, base, None));
            }
        }
        let at = self.at(on);
        let store = self.stores.get_mut(&at).expect("device");
        store.bootstrap_state = None;
        store.latest = OnceLock::from(store.replay.state.clone());
        store.bootstrap_active.clear();
        store.bootstrap_basis = None;
        if restored.is_empty() {
            return;
        }
        let mut state = store.replay.state.clone();
        let mut budget = SUFFIX_BATCH;
        'anchor: for (_snapshot, mut base, resumed) in restored {
            let entry = base.entry;
            let Some(en) = base.policy.entries.first() else {
                continue;
            };
            let vault = en.vault;
            // Historical entry slices must not overwrite later audience moves,
            // wants, or key seals. Content writes may extend retags; policy may not.
            let current = state.slice_of(entry);
            let Some(now) = current.entries.first() else { continue; };
            if now.id != en.id || now.vault != en.vault || now.creator != en.creator
                || now.creation != en.creation || now.intake != en.intake || now.stays != en.stays
                || current.marks != base.policy.marks || current.seals != base.policy.seals
            { continue; }
            let Some(attrs) = base.after.attrs.as_ref() else {
                continue;
            };
            // Capability groups and schema/lens entries affect other entries' admission.
            // Their bootstrap remains ordinary history; this slice cannot restore them.
            if attrs.ty.of_lane() || attrs.ty.is_cap_group() {
                continue;
            }
            if !state.acts_for(on, vault) {
                continue;
            }
            let mut view = state.with_slice(entry, &base.policy);
            let mut readings = store.readings.clone();
            for (id, body) in &base.bodies {
                if let Some(h) = &body.header {
                    readings.headers.insert(*id, h.clone());
                }
                readings.tags.insert(*id, body.tags.clone());
                if let Some(p) = &body.proof {
                    readings.proofs.insert(*id, p.clone());
                }
            }
            let lane_digest = base.lane_digest;
            let lane_ready = lane_digest == Some(bootstrap_lane_digest(&view, &readings, vault));
            let lane = Lane::with_built_ins(view.lane_of(vault, &readings));
            let en = view.entry(entry).expect("scoped entry").clone();
            base.history.restore_held_bodies(&store.bodies);
            let original_scratch = if resumed.is_none() {
                base.items.get(&MAIN).cloned().and_then(|item| {
                    Scratch::from_attested_item(item, &base.history.history(MAIN))
                })
            } else { None };
            let mut judging = Judging::resume(&en, &readings, &lane, base.history, base.after);
            let (mut pending, base_scratch, mut missing, mut wait_reason) = match resumed {
                Some(saved) => saved,
                None => {
                    let judged: HashSet<_> = judging.history.changes().iter().map(|c| c.write.edit).collect();
                    let suffix = store.log.entry_suffix_ids(entry, &judged);
                    (std::collections::VecDeque::from(suffix), original_scratch, Vec::new(), None)
                }
            };
            if !lane_ready { wait_reason = Some("missing-schema-lane"); }
            let mut opened_suffix = Vec::new();
            while budget > 0 && missing.is_empty() && wait_reason.is_none() {
                let Some(id) = pending.pop_front() else { break; };
                let Some(edit) = store.log.entry_write(id).cloned() else { continue 'anchor; };
                budget -= 1;
                store.bootstrap_cursor = Some(entry);
                // Only normal verified signed-log entries, never owner-invented signatures.
                if !store.signed.get(&id).is_some_and(|s| s.verify().is_ok()) {
                    continue 'anchor;
                }
                let Ok(Some(w)) = view.accepted_write(&edit, id) else {
                    continue 'anchor;
                };
                if !w
                    .deps
                    .iter()
                    .all(|d| judging.history.get(*d).is_some_and(|c| c.counted))
                {
                    continue 'anchor;
                }
                let Action::Write { body, .. } = &edit.action else {
                    continue 'anchor;
                };
                let Some(key_id) = keys::edit_key(body) else {
                    continue 'anchor;
                };
                let Some(key) = store.keys.get(&key_id, w.key()) else {
                    wait_reason = Some("missing-entry-key");
                    pending.push_front(id);
                    break;
                };
                let Some(opened) = keys::open_edit(key, body, &write_context(&edit))
                    .and_then(|b| Body::from_wire(&b).ok())
                else {
                    // The ciphertext is already held: a duplicate edit transfer cannot
                    // fix invalid authentication/body encoding. Preserve the prefix but
                    // never count the bad body or claim that its key is merely missing.
                    wait_reason = Some("invalid-entry-body");
                    pending.push_front(id);
                    break;
                };
                if !bootstrap_share_proof(&view,vault,&w,opened.proof.as_ref()) {
                    wait_reason=Some("unsupported-share-proof");
                    pending.push_front(id);
                    break;
                }
                // A new line cannot be built from MAIN's attested snapshot: its
                // selected causal cut may predate it. Fetch precisely that cut before
                // ordinary judgment/materialization. Proposal::New content is a name,
                // so leave interpretation to History::reading_on/import_change.
                if w.proposal != Proposal::Main {
                    missing = judging.history.missing_dependency_bodies(&w.deps, None);
                    if !missing.is_empty() {
                        pending.push_front(id);
                        break;
                    }
                    judging.scratch = None;
                }
                if judging
                    .scratch
                    .as_ref()
                    .is_none_or(|s| !s.within_version(&judging.history, &w.deps))
                {
                    judging.scratch = base_scratch
                        .as_ref()
                        .filter(|s| s.within_version(&judging.history, &w.deps))
                        .map(Scratch::fork);
                }
                if !opened.content.is_empty() {
                    missing = judging.history.missing_dependency_bodies(&w.deps, judging.scratch.as_ref());
                    if !missing.is_empty() {
                        pending.push_front(id);
                        break;
                    }
                }
                if view.step_mut(&edit, id).is_err() {
                    continue 'anchor;
                }
                if let Some(p) = &opened.proof {
                    readings.proofs.insert(id, p.clone());
                }
                readings.tags.insert(id, opened.tags.clone());
                let bodies = HashMap::from([(id, opened.clone())]);
                if !judging.judge(on, &view, (&readings, &bodies), &w, &readings.groups) {
                    continue 'anchor;
                }
                opened_suffix.push((id, opened));
            }
            let tip = Tip {
                writes: view.entry_writes(entry).count(),
                last: view.entry_writes(entry).last().map(|w| w.edit),
                lane: [0; 32],
                groups: [0; 32],
            };
            let shown = judging.shown_on(on, [0; 32], tip, Some(std::mem::take(&mut base.items)));
            // The ordinary checks may reject suffix content; only counted history shows.
            store.bodies.extend(opened_suffix);
            store.shown.insert(entry, shown);
            store.readings = readings;
            store
                .projections
                .lock()
                .expect("entry projections")
                .remove(&(on, entry));
            store.bootstrap_active.insert(entry);
            {
                let basis = OverlayBasis::of(store);
                store.bootstrap_progress.insert(entry, BootstrapProgress {
                    basis, policy: view.slice_of(entry), lane_digest,
                    base_scratch, pending, missing, wait_reason,
                });
            }

            state = view;
        }
        if !store.bootstrap_active.is_empty() {
            store.latest = OnceLock::from(state.clone());
            store.bootstrap_state = Some(state);
            store.bootstrap_basis = Some(OverlayBasis::of(store));
            let entries: Vec<_> = store.bootstrap_progress.keys().copied().collect();
            for entry in entries {
                let basis = OverlayBasis::of(store);
                store.bootstrap_progress.get_mut(&entry).expect("progress").basis = basis;
            }

        }
    }
}

impl Backup {
    /// Durable companion to the existing signed-log backup. Ciphertext only; decoding
    /// grants no authority and restore rechecks its signed root and current policy.
    pub fn bootstrap_bytes(&self) -> Option<Vec<u8>> {
        encode_anchors(&self.bootstrap_bases, self.signed.iter())
    }
    pub fn with_bootstrap_bytes(mut self, bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            self.bootstrap_bases.clear();
            return Some(self);
        }
        if bytes.len() > 16 * (MAX_BYTES + 256 + 1024 * 32) {
            return None;
        }
        let mut r = WireReader::new(bytes);
        let v1 = b"avenDB bootstrap anchors 1\n";
        let v2 = b"avenDB bootstrap anchors 2\n";
        let prefix = r.take(v2.len()).ok()?;
        if prefix != v1 && prefix != v2 {
            return None;
        }
        let digest_fence = prefix == v2;
        let mut anchors = BTreeMap::new();
        for _ in 0..bounded_count(&mut r, 68, 16)? {
            let entry = EntryId::decode(&mut r).ok()?;
            let snapshot = EditId::decode(&mut r).ok()?;
            let sealed = r.bytes().ok()?;
            if !self.signed.iter().any(|s| s.edit.id() == snapshot) {
                return None;
            }
            if digest_fence {
                let count = u64::decode(&mut r).ok()?;
                let root: [u8; 32] = r.take(32).ok()?.try_into().ok()?;
                if (count, root) != anchor_frontier(entry, self.signed.iter()) {
                    return None;
                }
            } else {
                let suffix = seq::<EditId>(&mut r, 32, 1024)?;
                if !suffix
                    .iter()
                    .all(|id| self.signed.iter().any(|s| s.edit.id() == *id))
                {
                    return None;
                }
            }
            if sealed.len() > MAX_BYTES + 128 || anchors.insert(entry, (snapshot, sealed)).is_some()
            {
                return None;
            }
        }
        if !r.done() {
            return None;
        }
        self.bootstrap_bases = anchors;
        Some(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};
    #[test]
    fn owner_partial_base_receives_group_free_shared_main_and_rechecks_revocation() {
        use crate::policy::{Who,Level,Revoking};
        let mut lab=Lab::new(); let owner=lab.passkey("Owner");
        let mac=lab.device_of(owner,"Mac"); let phone=lab.device_of(owner,"Phone"); let pad=lab.device_of(owner,"Pad");
        let bad=lab.device_of(owner,"Bad proof receiver");
        let vault=human_on(&mut lab,owner,&[mac,phone,pad,bad]);
        let guest=lab.passkey("Guest"); let guest_device=lab.device_of(guest,"Guest device");
        let guest_vault=human_on(&mut lab,guest,&[guest_device]);
        lab.share_contact(guest_device,mac,guest_vault);
        lab.share_contact(mac,guest_device,vault);
        let share=lab.issue(mac,&[owner],crate::cast::share(vault,Who::Vault(guest_vault),Level::Write,crate::cast::of_type("note"))).unwrap();
        for device in [phone,pad,bad,guest_device] { lab.sync(mac,device); }
        let entry=lab.create_in(mac,vault,vault,vec![share],"note",&[],document("Base","old",mac)).unwrap();
        let withheld=lab.edit(mac,vault,entry,|item|item.set_text(2,"Attested")).unwrap();
        let PreparedEntryBase{draft,sealed,..}=lab.draft_judged_entry_base(mac,&[owner],entry).unwrap();
        let snapshot=lab.complete(mac,draft,&[]).unwrap();
        for device in [phone,pad,bad] {
            let offer=lab.entry_projection_offer(mac,device,entry).unwrap();
            lab.receive(device,offer.evidence,vec![]);
            assert!(lab.adopt_owner_entry_base(device,snapshot,entry,sealed.clone()));
        }
        lab.sync(mac,guest_device);
        let shared=lab.edit(guest_device,guest_vault,entry,|item|item.set_text(2,"Guest update")).unwrap();
        let signed=lab.signed_edit(guest_device,shared).unwrap().clone();
        let body=lab.held(guest_device).bodies[&shared].clone();
        let write=lab.held(guest_device).replay.state.write(shared).unwrap();
        assert!(bootstrap_share_proof(&lab.held(guest_device).replay.state,vault,write,body.proof.as_ref()));
        assert!(!bootstrap_share_proof(&lab.held(guest_device).replay.state,vault,write,None));
        let mut tampered=body.proof.clone().unwrap(); tampered.grants[0].salt[0]^=1;
        assert!(!bootstrap_share_proof(&lab.held(guest_device).replay.state,vault,write,Some(&tampered)));
        // A genuinely signed/encrypted malformed proof must retain the prefix
        // read-only; this exercises receive, rather than just the precheck helper.
        let mut bad_edit=signed.edit.clone();
        let mut bad_body=body.clone(); bad_body.proof=Some(tampered);
        let Action::Write { body: encrypted, .. }=&signed.edit.action else { unreachable!() };
        let key=lab.held(guest_device).keys.get(&keys::edit_key(encrypted).unwrap(),write.key()).unwrap().clone();
        let encrypted=keys::seal_edit(&key,&bad_body.to_wire(),&write_context(&bad_edit),&mut lab.rng);
        if let Action::Write { body, .. }=&mut bad_edit.action { *body=encrypted; }
        let bad_signed=lab.sign(bad_edit).unwrap(); let bad_id=bad_signed.edit.id();
        lab.receive(bad,vec![bad_signed],vec![]);
        assert!(lab.active_owner_base(bad,entry).is_some());
        assert_eq!(lab.owner_base_wait_reason(bad,entry),Some("unsupported-share-proof"));
        assert!(lab.owner_base_pending(bad,entry)>0);
        assert!(lab.history(bad,entry).unwrap().get(bad_id).is_none());
        // Independent concurrent owner suffix has the same checkpoint cut.
        let own=lab.edit(mac,vault,entry,|item|item.set_text(1,"Owner title")).unwrap();
        let own_signed=lab.signed_edit(mac,own).unwrap().clone();
        lab.receive(phone,vec![own_signed,signed.clone()],vec![]);
        lab.receive(mac,vec![signed.clone()],vec![]);
        assert!(lab.active_owner_base(phone,entry).is_some());
        assert_eq!(lab.owner_base_pending(phone,entry),0);
        assert!(lab.history(phone,entry).unwrap().get(shared).unwrap().counted);
        assert_eq!(lab.item(phone,entry).unwrap().record(),lab.item(mac,entry).unwrap().record());
        assert!(!lab.held(phone).log.ids().contains(&withheld),
            "retained pre-snapshot content remains withheld");
        let revoked=lab.submit(mac,&[owner],Action::Revoke(Revoking::Grant{share,actor:vault,keep:vec![],via:vec![]})).unwrap();
        let removal=lab.signed_edit(mac,revoked).unwrap().clone();
        // Current removal arrives before the old shared suffix on the second partial peer.
        lab.receive(pad,vec![removal.clone()],vec![]);
        lab.receive(pad,vec![signed],vec![]);
        assert!(lab.active_owner_base(pad,entry).is_none());
        assert!(!lab.adopt_owner_entry_base(pad,snapshot,entry,sealed));
        lab.receive(phone,vec![removal],vec![]);
        assert!(lab.active_owner_base(phone,entry).is_none());
    }

    #[test]
    fn partial_proposal_fetches_exact_cut_then_preserves_accept_and_merge() {
        use crate::policy::{Who,Level,Revoking};
        let mut lab=Lab::new(); let owner=lab.passkey("Proposal owner");
        let mac=lab.device_of(owner,"Mac"); let phone=lab.device_of(owner,"Phone"); let pad=lab.device_of(owner,"Pad");
        let vault=human_on(&mut lab,owner,&[mac,phone,pad]);
        let guest=lab.passkey("Proposal guest"); let device=lab.device_of(guest,"Guest device");
        let guest_vault=human_on(&mut lab,guest,&[device]);
        lab.share_contact(device,mac,guest_vault); lab.share_contact(mac,device,vault);
        let share=lab.issue(mac,&[owner],crate::cast::share(vault,Who::Vault(guest_vault),Level::Write,crate::cast::of_type("note"))).unwrap();
        for d in [phone,pad,device] {lab.sync(mac,d);}
        let entry=lab.create_in(mac,vault,vault,vec![share],"note",&[],document("Base","old",mac)).unwrap();
        lab.edit(mac,vault,entry,|i|i.set_text(2,"Checkpoint")).unwrap();
        let unrelated=lab.create(mac,vault,vault,"note",&[],document("Unrelated","withheld",mac)).unwrap();
        let unrelated_creation=lab.held(mac).replay.state.entry(unrelated).unwrap().creation;
        let PreparedEntryBase{draft,sealed,..}=lab.draft_judged_entry_base(mac,&[owner],entry).unwrap();
        let snapshot=lab.complete(mac,draft,&[]).unwrap();
        for d in [phone,pad] {
            let offer=lab.entry_projection_offer(mac,d,entry).unwrap(); lab.receive(d,offer.evidence,vec![]);
            assert!(lab.adopt_owner_entry_base(d,snapshot,entry,sealed.clone()));
        }
        lab.sync(mac,device);
        let heads=lab.history(device,entry).unwrap().heads(MAIN);
        let proposal=lab.propose(device,guest_vault,entry,&heads,"A proposal label, not a CRDT update").unwrap();
        let changed=lab.edit_on(device,guest_vault,entry,Some(proposal),|i|i.set_text(2,"Proposed")).unwrap();
        let proposed:Vec<_>=[proposal,changed].into_iter().map(|id|lab.signed_edit(device,id).unwrap().clone()).collect();
        lab.receive(phone,proposed.clone(),vec![]);
        assert!(lab.active_owner_base(phone,entry).is_some());
        assert!(lab.owner_base_pending(phone,entry)>0);
        let missing=lab.owner_base_missing(phone);
        assert!(!missing.is_empty());
        assert!(missing.iter().all(|(e,_)|*e==entry));
        // Serve only requested signed dependency bodies, not whole-world history.
        for _ in 0..8 {
            let ids:Vec<_>=lab.owner_base_missing(phone).into_iter().flat_map(|(_,ids)|ids).collect();
            if ids.is_empty(){break;}
            let edits=ids.into_iter().map(|id|lab.signed_edit(mac,id).unwrap().clone()).collect();
            lab.receive(phone,edits,vec![]);
        }
        assert_eq!(lab.owner_base_pending(phone,entry),0);
        assert_eq!(lab.history(phone,entry).unwrap().name(proposal).as_deref(),Some("A proposal label, not a CRDT update"));
        assert_eq!(lab.item_on(phone,entry,Some(proposal)).unwrap().record(),lab.item_on(device,entry,Some(proposal)).unwrap().record());
        assert!(!lab.held(phone).log.ids().contains(&unrelated_creation));
        lab.receive(mac,proposed.clone(),vec![]);
        // No collaborator can bypass the vault's accept on the main-line merge.
        assert!(lab.merge(device,guest_vault,entry,Some(proposal),MAIN,&BTreeSet::new()).is_err());
        let accepted=lab.accept(mac,vault,entry,proposal).unwrap();
        let accept=lab.signed_edit(mac,accepted).unwrap().clone();
        lab.receive(device,vec![accept.clone()],vec![]); lab.receive(phone,vec![accept],vec![]);
        let merged=lab.merge(device,guest_vault,entry,Some(proposal),MAIN,&BTreeSet::new()).unwrap();
        let merge=lab.signed_edit(device,merged).unwrap().clone();
        lab.receive(mac,vec![merge.clone()],vec![]); lab.receive(phone,vec![merge],vec![]);
        assert_eq!(lab.item(phone,entry).unwrap().record(),lab.item(mac,entry).unwrap().record());
        assert!(lab.history(phone,entry).unwrap().get(merged).unwrap().counted);
        let revoked=lab.submit(mac,&[owner],Action::Revoke(Revoking::Grant{share,actor:vault,keep:vec![],via:vec![]})).unwrap();
        let removal=lab.signed_edit(mac,revoked).unwrap().clone();
        lab.receive(pad,vec![removal],vec![]); lab.receive(pad,proposed,vec![]);
        assert!(lab.active_owner_base(pad,entry).is_none());
    }

    #[test]
    fn canonical_retirement_waits_for_suffix_schema_even_with_all_target_bodies() {
        use crate::lens::example::{DOCUMENT_V0,DOCUMENT_LENS};
        let mut lab=Lab::new(); let owner=lab.passkey("Suffix lane owner");
        let mac=lab.device_of(owner,"Mac"); let phone=lab.device_of(owner,"Phone");
        let vault=human_on(&mut lab,owner,&[mac,phone]);
        let entry=lab.create(mac,vault,vault,"note",&[],document("Base","old",mac)).unwrap();
        lab.sync(mac,phone);
        let PreparedEntryBase{draft,sealed,..}=lab.draft_judged_entry_base(mac,&[owner],entry).unwrap();
        let snapshot=lab.complete(mac,draft,&[]).unwrap();
        let base=lab.restore_owner_judgment(mac,snapshot,entry,&sealed).unwrap();
        assert!(canonical_owner_replacement(phone,lab.held(phone),&base).is_some());
        lab.add_schema(mac,vault,vault,DOCUMENT_V0.bytes()).unwrap();
        lab.add_schema(mac,vault,vault,DOCUMENT_LENS.bytes()).unwrap();
        let suffix=lab.edit(mac,vault,entry,|item| {
            assert!(item.edit_document_v0(|d| d.title="Written through custom schema".into()));
        }).unwrap();
        assert!(lab.history(mac,entry).unwrap().get(suffix).unwrap().counted);
        let signed=lab.signed_edit(mac,suffix).unwrap().clone();
        lab.receive(phone,vec![signed],vec![]);
        assert!(lab.held(phone).bodies.contains_key(&suffix));
        assert!(!lab.history(phone,entry).unwrap().get(suffix).unwrap().counted,
            "held ciphertext and body do not establish missing schema semantics");
        assert!(canonical_owner_replacement(phone,lab.held(phone),&base).is_none(),
            "must not retire while canonical suffix is missing its schema");
        let evidence:Vec<_>=lab.log(mac).ids().iter().filter_map(|id| {
            let signed=lab.signed_edit(mac,*id)?;
            (!matches!(&signed.edit.action,Action::Write{entry:e,..} if *e==entry)).then(||signed.clone())
        }).collect();
        lab.receive(phone,evidence,vec![]);
        let canonical=canonical_owner_replacement(phone,lab.held(phone),&base).unwrap();
        assert!(canonical.history.get(suffix).unwrap().counted);
        assert_eq!(canonical.items()[&MAIN].record(),lab.item(mac,entry).unwrap().record());
    }

    #[test]
    fn owner_bootstrap_missing_schema_retains_view_without_advancing_suffix() {
        use crate::cast::document_v0;
        use crate::lens::example::DOCUMENT_V0;
        let mut lab=Lab::new();
        let owner=lab.passkey("Lane owner");
        let mac=lab.device_of(owner,"Mac"); let phone=lab.device_of(owner,"Phone");
        let vault=human_on(&mut lab,owner,&[mac,phone]);
        lab.sync(mac,phone);
        lab.add_schema(mac,vault,vault,DOCUMENT_V0.bytes()).unwrap();
        let entry=lab.create(mac,vault,vault,"doc",&[],document_v0("Base","old",mac)).unwrap();
        lab.edit(mac,vault,entry,|item| { item.edit_document_v0(|d| d.title="Attested".into()); }).unwrap();
        let PreparedEntryBase{draft,sealed,..}=lab.draft_judged_entry_base(mac,&[owner],entry).unwrap();
        let snapshot=lab.complete(mac,draft,&[]).unwrap();
        let offer=lab.entry_projection_offer(mac,phone,entry).unwrap();
        lab.receive(phone,offer.evidence,vec![]);
        // A pre-lane-attestation envelope remains readable but never grants writes.
        let name=lab.held(mac).replay.state.entry_key(entry).unwrap();
        let key=lab.held(mac).keys.get(&keys::edit_key(&sealed).unwrap(),name).unwrap().clone();
        let mut legacy=keys::open_edit(&key,&sealed,&judgment_context(vault,entry)).unwrap();
        legacy.truncate(legacy.len()-LANE_ATTESTATION.len()-32);
        let legacy=keys::seal_edit(&key,&legacy,&judgment_context(vault,entry),&mut lab.rng);
        let mut legacy_action=lab.signed_edit(mac,snapshot).unwrap().edit.action.clone();
        if let Action::Snapshot{states,..}=&mut legacy_action { states[0].slice=FileRoot{hash:crate::hash::content(&legacy),size:legacy.len() as u64}; }
        let legacy_snapshot=lab.submit(mac,&[owner],legacy_action).unwrap();
        let legacy_offer=lab.entry_projection_offer(mac,phone,entry).unwrap();
        lab.receive(phone,legacy_offer.evidence,vec![]);
        assert!(lab.adopt_owner_entry_base(phone,legacy_snapshot,entry,legacy));
        assert_eq!(lab.owner_base_wait_reason(phone,entry),Some("missing-schema-lane"));
        assert!(lab.edit(phone,vault,entry, |_| {}).is_err());
        assert!(lab.adopt_owner_entry_base(phone,snapshot,entry,sealed));
        assert_eq!(lab.owner_base_wait_reason(phone,entry),Some("missing-schema-lane"));
        assert_eq!(lab.owner_base_pending(phone,entry),0);
        assert_eq!(lab.owner_base_lane_waits(phone),vec![(entry,vault)]);
        assert!(matches!(lab.draft_judged_entry_base(phone,&[owner],entry),Err(Refusal::ReadOnly)), "cannot attest incomplete local lane over an inherited base");
        let get=crate::engine::read(&lab,phone,&serde_json::json!({"op":"get","entry":entry.to_hex(),"schema":"stored"}));
        assert_eq!(get["ok"]["readOnly"],true);
        let query=crate::engine::read(&lab,phone,&serde_json::json!({"op":"query","schema":"stored","where":{"type":["doc"]}}));
        assert_eq!(query["ok"]["rows"][0]["readOnly"],true);
        let before=lab.item(phone,entry).unwrap().record();
        assert!(lab.edit(phone,vault,entry,|item| { item.edit_document_v0(|d| d.title="Forbidden while incomplete".into()); }).is_err());
        let suffix=lab.edit(mac,vault,entry,|item| { item.edit_document_v0(|d| d.title="Latest".into()); }).unwrap();
        lab.receive(phone,vec![lab.signed_edit(mac,suffix).unwrap().clone()],vec![]);
        assert_eq!(lab.owner_base_wait_reason(phone,entry),Some("missing-schema-lane"));
        assert_eq!(lab.item(phone,entry).unwrap().record(),before);
        // Supply authorized schema/governance setup only, withholding target content history.
        let evidence:Vec<_>=lab.log(mac).ids().iter().filter_map(|id| {
            let signed=lab.signed_edit(mac,*id)?;
            (!matches!(&signed.edit.action,Action::Write{entry:e,..} if *e==entry)).then(||signed.clone())
        }).collect();
        lab.receive(phone,evidence,vec![]);
        assert_eq!(lab.owner_base_wait_reason(phone,entry),None);
        assert!(lab.owner_base_lane_waits(phone).is_empty());
        assert_eq!(lab.item(phone,entry).unwrap().record(),lab.item(mac,entry).unwrap().record());
        // A later lane addition changes the admission rules: do not silently reuse the old base.
        lab.add_schema(mac,vault,vault,crate::lens::example::TODO_V0.bytes()).unwrap();
        let evidence:Vec<_>=lab.log(mac).ids().iter().filter_map(|id| {
            let signed=lab.signed_edit(mac,*id)?;
            (!matches!(&signed.edit.action,Action::Write{entry:e,..} if *e==entry)).then(||signed.clone())
        }).collect();
        lab.receive(phone,evidence,vec![]);
        assert_eq!(lab.owner_base_wait_reason(phone,entry),Some("missing-schema-lane"));
        assert!(lab.edit(phone,vault,entry, |_| {}).is_err());
        lab.sync(mac,phone);
        assert!(lab.active_owner_base(phone,entry).is_none());
        assert!(!lab.held(phone).bootstrap_bases.contains_key(&entry));
        assert!(lab.owner_base_wait_reason(phone,entry).is_none());
        lab.edit(phone,vault,entry,|item| { item.edit_document_v0(|d| d.title="Canonical again".into()); }).unwrap();
    }

    #[test]
    fn bootstrap_companion_frontier_has_fixed_size_beyond_1024_writes() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let vault = human_on(&mut lab, owner, &[mac]);
        let entry = lab
            .create(mac, vault, vault, "note", &[], document("Base", "old", mac))
            .unwrap();
        let mut backup = lab.backup(mac);
        let template = backup
            .signed
            .iter()
            .find(|s| matches!(s.edit.action,Action::Write{entry:e,..}if e==entry))
            .unwrap()
            .clone();
        // Transport-only fixtures; modified signatures never enter Lab admission.
        backup.signed = (0..1024)
            .map(|n| {
                let mut s = template.clone();
                s.edit.depth = n;
                s
            })
            .collect();
        let snapshot = backup.signed[0].edit.id();
        backup.bootstrap_bases.insert(entry, (snapshot, vec![1]));
        let mut legacy = b"avenDB bootstrap anchors 1\n".to_vec();
        1u32.encode(&mut legacy);
        entry.encode(&mut legacy);
        snapshot.encode(&mut legacy);
        vec![1u8].encode(&mut legacy);
        backup
            .signed
            .iter()
            .map(|s| s.edit.id())
            .collect::<Vec<_>>()
            .encode(&mut legacy);
        assert!(
            Backup::new(backup.signed.clone(), backup.blobs.values().cloned())
                .with_bootstrap_bytes(&legacy)
                .is_some(),
            "v1 remains readable"
        );
        let bytes = backup.bootstrap_bytes().expect("exact bound is encodable");
        assert!(
            Backup::new(backup.signed.clone(), backup.blobs.values().cloned())
                .with_bootstrap_bytes(&bytes)
                .is_some()
        );
        let mut extra = template;
        extra.edit.depth = 1024;
        backup.signed.push(extra);
        let larger = backup
            .bootstrap_bytes()
            .expect("no arbitrary write-count ceiling");
        assert_eq!(larger.len(), bytes.len(), "frontier has constant wire size");
        assert!(
            Backup::new(backup.signed.clone(), backup.blobs.values().cloned())
                .with_bootstrap_bytes(&larger)
                .is_some()
        );
        assert!(
            Backup::new(backup.signed.clone(), backup.blobs.values().cloned())
                .with_bootstrap_bytes(&bytes)
                .is_none(),
            "stale companion is not an exact committed frontier"
        );
        let mut reordered = backup.signed.clone();
        reordered.swap(1, 2);
        assert!(
            Backup::new(reordered, backup.blobs.values().cloned())
                .with_bootstrap_bytes(&larger)
                .is_none()
        );
        let mut corrupt = larger.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(
            Backup::new(backup.signed.clone(), backup.blobs.values().cloned())
                .with_bootstrap_bytes(&corrupt)
                .is_none()
        );
        backup.signed.pop();
        assert!(
            Backup::new(backup.signed, backup.blobs.values().cloned())
                .with_bootstrap_bytes(&larger)
                .is_none(),
            "torn suffix rejected"
        );
    }

    #[test]
    fn bootstrap_companion_fences_concurrent_writes_without_depth_assumptions() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let pad = lab.device_of(owner, "Pad");
        let vault = human_on(&mut lab, owner, &[mac, pad]);
        let entry = lab
            .create(mac, vault, vault, "note", &[], document("Base", "old", mac))
            .unwrap();
        lab.sync(mac, pad);
        let concurrent = lab
            .edit(pad, vault, entry, |i| i.set_text(2, "concurrent"))
            .unwrap();
        lab.edit(mac, vault, entry, |i| i.set_text(2, "first"))
            .unwrap();
        let later = lab
            .edit(mac, vault, entry, |i| i.set_text(2, "second"))
            .unwrap();
        let held = lab
            .backup(pad)
            .signed()
            .iter()
            .find(|s| s.edit.id() == concurrent)
            .unwrap()
            .clone();
        let mut backup = lab.backup(mac);
        assert!(
            held.edit.depth
                < backup
                    .signed
                    .iter()
                    .find(|s| s.edit.id() == later)
                    .unwrap()
                    .edit
                    .depth
        );
        backup.signed.push(held);
        // Opaque transport fixture only: this does not attest or activate a writable base.
        backup.bootstrap_bases.insert(entry, (later, vec![1, 2, 3]));
        let bytes = backup.bootstrap_bytes().unwrap();
        assert!(
            Backup::new(backup.signed.clone(), backup.blobs.values().cloned())
                .with_bootstrap_bytes(&bytes)
                .is_some()
        );
        backup.signed.retain(|s| s.edit.id() != concurrent);
        assert!(
            Backup::new(backup.signed, backup.blobs.values().cloned())
                .with_bootstrap_bytes(&bytes)
                .is_none()
        );
    }

    #[test]
    fn overlay_reuse_requires_exact_process_local_revisions() {
        let mut store = Store::default();
        let basis = OverlayBasis::of(&store);
        assert!(basis.matches(&store));
        store.log = crate::policy::Log::default();
        assert!(!basis.matches(&store), "same-length replacement is not the same signed-log revision");
        let basis = OverlayBasis::of(&store);
        store.keys.revision = Arc::new(());
        assert!(!basis.matches(&store), "key invalidation is not inferred from cardinality");
        let basis = OverlayBasis::of(&store);
        store.bootstrap_revision = Arc::new(());
        assert!(!basis.matches(&store), "same-entry anchor replacement invalidates derived judgment");
        let basis = OverlayBasis::of(&store);
        store.forget();
        assert!(!basis.matches(&store), "lock forgets reusable secret-derived state");
    }

    #[test]
    fn owner_bootstrap_retains_key_wait_and_resumes_on_key_arrival() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Key owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let watcher = lab.device_of(owner, "Watcher");
        let vault = human_on(&mut lab, owner, &[mac, phone, watcher]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        for device in [phone, watcher] { lab.sync(mac, device); }
        lab.edit(mac, vault, entry, |i| i.set_text(2, "base")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        for device in [phone, watcher] {
            let offer = lab.entry_projection_offer(mac, device, entry).unwrap();
            lab.receive(device, offer.evidence, vec![]);
            assert!(lab.adopt_owner_entry_base(device, snapshot, entry, sealed.clone()));
        }
        // Model a legitimate alternate same-family key arriving after its ciphertext.
        // Inject a validated key into the core keyring; transport authentication is separate.
        let name = lab.held(mac).view().entry_key(entry).unwrap();
        let original_id = lab.held(mac).keys.first(name).unwrap().id();
        // Deterministically exercise the bug: this arrival changes keys.first(name),
        // but must not change which retained key opens the signed checkpoint.
        let alternate = loop {
            let key = Secret::generate(&mut lab.rng);
            if key.id() < original_id { break key; }
        };
        let key_id = alternate.id();
        let store = lab.stores.get_mut(&mac).unwrap();
        store.keys.insert(name, alternate.clone());
        store.keys.by_name.insert(name, vec![key_id]);
        let id = lab.edit(mac, vault, entry, |i| i.set_text(2, "after key")).unwrap();
        let signed = lab.signed_edit(mac, id).unwrap().clone();
        let Action::Write { body, .. } = &signed.edit.action else { panic!("write"); };
        assert_eq!(keys::edit_key(body), Some(key_id));
        for device in [phone, watcher] {
            lab.receive(device, vec![signed.clone()], vec![]);
            assert_eq!(lab.owner_base_wait_reason(device, entry), Some("missing-entry-key"));
            assert_eq!(lab.owner_base_key_waits(device), vec![entry]);
            assert!(!lab.owner_bases_pending(device));
            assert!(lab.owner_base_missing(device).is_empty(), "held ciphertext is not a missing edit");
            assert!(lab.item(device, entry).is_some());
            assert!(lab.edit(device, vault, entry, |i| i.set_text(2, "blocked")).is_err());
        }
        let revoke = lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device { vault, device: watcher, keep: vec![] })).unwrap();
        let removal = lab.signed_edit(mac, revoke).unwrap().clone();
        lab.receive(watcher, vec![removal], vec![]);
        assert!(lab.owner_base_wait_reason(watcher, entry).is_none());
        assert!(lab.owner_base_key_waits(watcher).is_empty());
        assert!(lab.active_owner_base(watcher, entry).is_none());
        lab.stores.get_mut(&phone).unwrap().keys.insert(name, alternate);
        lab.refresh(phone, &[]);
        assert!(lab.active_owner_base(phone, entry).is_some(), "new family key must not invalidate old envelope key");
        assert!(lab.owner_base_wait_reason(phone, entry).is_none());
        assert!(lab.owner_base_key_waits(phone).is_empty());
        assert_eq!(lab.owner_base_pending(phone, entry), 0);
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
    }

    #[test]
    fn owner_bootstrap_waits_for_exact_dependency_body_then_converges() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Dependency owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let pad = lab.device_of(owner, "Pad");
        let watcher = lab.device_of(owner, "Watcher");
        let vault = human_on(&mut lab, owner, &[mac, phone, pad, watcher]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        for device in [phone, pad, watcher] { lab.sync(mac, device); }
        let dependency = lab.edit(mac, vault, entry, |i| i.set_text(2, "dependency")).unwrap();
        let dependency_signed = lab.signed_edit(mac, dependency).unwrap().clone();
        lab.sync(mac, phone);
        let concurrent = lab.edit(phone, vault, entry, |i| {
            i.edit_document(|d| d.title = "concurrent".into());
        }).unwrap();
        let concurrent_signed = lab.signed_edit(phone, concurrent).unwrap().clone();
        lab.edit(mac, vault, entry, |i| i.set_text(2, "checkpoint")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        for device in [pad, watcher] {
            let offer = lab.entry_projection_offer(mac, device, entry).unwrap();
            lab.receive(device, offer.evidence, vec![]);
            lab.receive(device, vec![concurrent_signed.clone()], vec![]);
            assert!(lab.adopt_owner_entry_base(device, snapshot, entry, sealed.clone()));
            assert_eq!(lab.owner_base_missing(device), vec![(entry, vec![dependency])]);
            assert!(!lab.owner_bases_pending(device), "missing body does not spin the materializer");
            assert_eq!(lab.owner_base_pending(device, entry), 1);
            assert!(lab.item(device, entry).is_some(), "validated prefix remains visible");
            assert!(lab.edit(device, vault, entry, |i| i.set_text(2, "premature")).is_err());
        }
        let revocation = lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device {
            vault, device: watcher, keep: vec![],
        })).unwrap();
        let signed = lab.signed_edit(mac, revocation).unwrap().clone();
        lab.receive(watcher, vec![signed], vec![]);
        assert!(lab.owner_base_missing(watcher).is_empty(), "revoked demand disappears");
        assert!(lab.active_owner_base(watcher, entry).is_none());
        lab.receive(pad, vec![dependency_signed], vec![]);
        assert!(lab.owner_base_missing(pad).is_empty());
        assert_eq!(lab.owner_base_pending(pad, entry), 0);
        lab.receive(mac, vec![concurrent_signed], vec![]);
        assert_eq!(lab.item(pad, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
    }

    #[test]
    fn owner_bootstrap_includes_concurrent_writes_older_than_snapshot() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Concurrent owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        let concurrent = lab.edit(phone, vault, entry, |item| {
            item.edit_document(|d| d.title = "concurrent title".into());
        }).unwrap();
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint text")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let signed = lab.backup(phone).signed().iter().find(|s| s.edit.id() == concurrent).unwrap().clone();
        let snapshot_depth = lab.log(mac).edits().iter().find(|e| e.id() == snapshot).unwrap().depth;
        assert!(signed.edit.depth < snapshot_depth, "the delayed branch predates the checkpoint, but is not included in it");
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, sealed));
        lab.receive(mac, vec![signed], vec![]);
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
        // The held edit alone is not sufficient evidence for writable adoption.
        lab.stores.get_mut(&phone).unwrap().signed.remove(&concurrent);
        lab.refresh(phone, &[]);
        assert!(!lab.held(phone).bootstrap_active.contains(&entry), "an unverifiable required suffix cannot be skipped while claiming writable completeness");
    }

    #[test]
    fn owner_bootstrap_waits_for_proposal_causal_bodies() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Proposal owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, sealed.clone()));
        let heads = lab.held(mac).shown.get(&entry).unwrap().history.heads(MAIN);
        let proposal = lab.propose(mac, vault, entry, &heads, "Partial proposal requiring its cut").unwrap();
        let signed = lab.backup(mac).signed().iter().find(|s| s.edit.id() == proposal).unwrap().clone();
        lab.receive(phone, vec![signed], vec![]);
        assert!(lab.held(phone).bootstrap_active.contains(&entry), "retain the verified prefix during causal-body recovery");
        assert!(lab.owner_base_pending(phone, entry)>0);
        assert!(!lab.owner_base_missing(phone).is_empty());
        assert_eq!(lab.edit(phone,vault,entry,|i|i.set_text(2,"must wait")).unwrap_err(),Refusal::ReadOnly);
        assert!(lab.history(phone,entry).unwrap().get(proposal).is_none(), "unmaterialized proposal must not count yet");
        for _ in 0..8 {
            let ids:Vec<_>=lab.owner_base_missing(phone).into_iter().flat_map(|(_,ids)|ids).collect();
            if ids.is_empty(){break;}
            let signed=ids.into_iter().map(|id|lab.signed_edit(mac,id).unwrap().clone()).collect();
            lab.receive(phone,signed,vec![]);
        }
        assert_eq!(lab.owner_base_pending(phone,entry),0);
        assert!(lab.history(phone,entry).unwrap().get(proposal).unwrap().counted);
        assert_eq!(lab.history(phone,entry).unwrap().name(proposal),lab.history(mac,entry).unwrap().name(proposal));
        assert_eq!(lab.item_on(phone,entry,Some(proposal)).unwrap().record(),lab.item_on(mac,entry,Some(proposal)).unwrap().record());
    }

    #[test]
    fn owner_bootstrap_does_not_overwrite_a_later_entry_mark() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Marked owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let public = lab.issue(mac, &[owner], crate::cast::share(vault, crate::policy::Who::Everyone, crate::policy::Level::Read, crate::cast::of_type("note"))).unwrap();
        let entry = lab.create_in(mac, vault, vault, vec![public], "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, sealed.clone()));
        let mark = lab.submit(mac, &[owner], Action::Mark { vault, entry, caps: Some(vec![]), wants: None, keep: vec![], via: vec![] }).unwrap();
        let signed = lab.backup(mac).signed().iter().find(|s| s.edit.id() == mark).unwrap().clone();
        lab.receive(phone, vec![signed], vec![]);
        let canonical = lab.held(phone).replay.state.slice_of(entry);
        assert!(!lab.held(phone).bootstrap_active.contains(&entry));
        assert!(lab.active_owner_base(phone, entry).is_none());
        assert!(!lab.adopt_owner_entry_base(phone, snapshot, entry, sealed));
        assert_eq!(lab.held(phone).view().slice_of(entry), canonical, "historical stays/seals cannot overwrite the current policy");
    }

    #[test]
    fn owner_bootstrap_shares_one_turn_budget_and_rotates_between_entries() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Budget owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entries: Vec<_> = (0..2).map(|_| lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap()).collect();
        lab.sync(mac, phone);
        for &entry in &entries {
            lab.edit(mac, vault, entry, |i| i.set_text(2, "base")).unwrap();
            let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
            let snapshot = lab.complete(mac, draft, &[]).unwrap();
            let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
            lab.receive(phone, offer.evidence, vec![]);
            assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, sealed));
        }
        let mut signed = Vec::new();
        for &entry in &entries {
            for n in 0..64 {
                let id = lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("suffix {n}"))).unwrap();
                signed.push(lab.signed_edit(mac, id).unwrap().clone());
            }
        }
        lab.receive(phone, signed, vec![]);
        let initial: Vec<_> = entries.iter().map(|e| lab.owner_base_pending(phone, *e)).collect();
        assert_eq!(initial.iter().sum::<usize>(), 128 - SUFFIX_BATCH);
        for _ in 0..2 {
            let before: usize = entries.iter().map(|e| lab.owner_base_pending(phone, *e)).sum();
            lab.advance_owner_bases(phone);
            let after: usize = entries.iter().map(|e| lab.owner_base_pending(phone, *e)).sum();
            assert_eq!(before - after, SUFFIX_BATCH, "one shared budget, not one budget per anchor");
        }
        for (entry, before) in entries.iter().zip(initial) {
            assert!(lab.owner_base_pending(phone, *entry) < before, "each runnable anchor progresses within two turns");
        }
        while lab.owner_bases_pending(phone) { lab.advance_owner_bases(phone); }
        for entry in entries {
            assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
        }
    }

    #[test]
    fn owner_bootstrap_batches_over_512_and_restarts_without_losing_suffix() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Base", "old", mac)).unwrap();
        lab.sync(mac, phone);
        lab.edit(mac, vault, entry, |i| i.set_text(2, "base")).unwrap();
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        let offer = lab.entry_projection_offer(mac, phone, entry).unwrap();
        lab.receive(phone, offer.evidence, vec![]);
        assert!(lab.adopt_owner_entry_base(phone, snapshot, entry, sealed));
        let mut suffix = Vec::new();
        for n in 0..513 {
            let id = lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("suffix {n}"))).unwrap();
            suffix.push(lab.signed_edit(mac, id).unwrap().clone());
        }
        lab.receive(phone, suffix, vec![]);
        assert_eq!(lab.owner_base_pending(phone, entry), 513 - SUFFIX_BATCH);
        assert!(lab.item(phone, entry).is_some(), "validated prefix remains useful");
        assert!(lab.edit(phone, vault, entry, |i| i.set_text(2, "premature")).is_err());
        let saved = lab.backup(phone);
        lab.restore_backup(phone, &saved);
        assert_eq!(lab.owner_base_pending(phone, entry), 513 - SUFFIX_BATCH);
        let mut turns = 0;
        while lab.owner_base_pending(phone, entry) > 0 {
            let before = lab.owner_base_pending(phone, entry);
            lab.advance_owner_bases(phone);
            assert_eq!(lab.owner_base_pending(phone, entry), before.saturating_sub(SUFFIX_BATCH));
            turns += 1;
            assert!(turns < 20);
        }
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
        assert!(lab.edit(phone, vault, entry, |i| i.set_text(2, "ready")).is_ok());
    }

    #[test]
    fn owner_bootstrap_store_writes_reopens_and_converges_concurrent_suffixes() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let pad = lab.device_of(owner, "Pad");
        let vault = human_on(&mut lab, owner, &[mac, phone, pad]);
        let entry = lab
            .create(mac, vault, vault, "note", &[], document("Base", "old", mac))
            .unwrap();
        lab.sync(mac, phone);
        lab.sync(mac, pad);
        lab.edit(mac, vault, entry, |item| item.set_text(2, "checkpoint"))
            .unwrap();
        let PreparedEntryBase { draft, sealed, .. } =
            lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, draft, &[]).unwrap();
        for device in [phone, pad] {
            let offer = lab.entry_projection_offer(mac, device, entry).unwrap();
            lab.receive(device, offer.evidence, vec![]);
            assert!(lab.stage_owner_entry_base(device, snapshot, entry, sealed.clone()));
            assert!(lab.edit(device,vault,entry,|i|i.set_text(2,"not durable")).is_err());
            assert!(lab.owner_base_durability_pending(device,entry));
            assert!(lab.finish_durable_owner_bases(device));
            assert!(!lab.owner_base_durability_pending(device,entry));
            assert_eq!(lab.retained_projection_hint(device, entry), Some(snapshot));
            let detail = crate::engine::read(&lab, device, &serde_json::json!({
                "op":"get", "entry":entry.to_hex(), "schema":"stored"
            }));
            assert_eq!(detail["ok"]["checkpoint"]["partial"], true);
            assert_eq!(detail["ok"]["filesComplete"], false);
            let query = crate::engine::read(&lab, device, &serde_json::json!({
                "op":"query", "schema":"stored", "observeRevision":true
            }));
            let row = query["ok"]["rows"].as_array().unwrap().iter()
                .find(|r| r["entry"] == entry.to_hex()).expect("adopted entry row");
            assert_eq!(row["checkpoint"]["partial"], true);
            assert_eq!(row["observedRevision"]["kind"], "checkpoint-basis");

            assert_eq!(
                lab.item(device, entry).unwrap().record(),
                lab.item(mac, entry).unwrap().record()
            );
            let before = lab.perf(device)["counts"]["bootstrap: unchanged overlay reused"].as_u64().unwrap_or(0);
            for _ in 0..3 { lab.refresh(device, &[]); }
            assert_eq!(lab.perf(device)["counts"]["bootstrap: unchanged overlay reused"].as_u64().unwrap_or(0), before + 3,
                "unchanged refresh moves the already verified materialization without decrypt/import/reverification");
            assert_eq!(lab.item(device, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
        }
        let a = lab
            .edit(phone, vault, entry, |item| item.set_text(2, "phone suffix"))
            .unwrap();
        let b = lab
            .edit(pad, vault, entry, |item| {
                item.edit_document(|d| d.title = "pad suffix".into());
            })
            .unwrap();
        let signed_a = lab
            .backup(phone)
            .signed()
            .iter()
            .find(|s| s.edit.id() == a)
            .unwrap()
            .clone();
        let signed_b = lab
            .backup(pad)
            .signed()
            .iter()
            .find(|s| s.edit.id() == b)
            .unwrap()
            .clone();
        lab.receive(phone, vec![signed_b.clone(), signed_b.clone()], vec![]);
        lab.receive(pad, vec![signed_a.clone()], vec![]);
        lab.receive(mac, vec![signed_b, signed_a], vec![]);
        let expected = lab.item(mac, entry).unwrap().record();
        assert_eq!(lab.item(phone, entry).unwrap().record(), expected);
        assert_eq!(lab.item(pad, entry).unwrap().record(), expected);
        // Recreate from serialized ciphertext anchors plus the ordinary signed suffix.
        let saved = lab.backup(phone);
        let bytes = saved.bootstrap_bytes().unwrap();
        let disk = Backup::new(saved.signed().to_vec(), saved.blobs.values().cloned())
            .with_bootstrap_bytes(&bytes)
            .unwrap();
        let missing_suffix: Vec<_> = saved
            .signed()
            .iter()
            .filter(|s| s.edit.id() != a)
            .cloned()
            .collect();
        assert!(
            Backup::new(missing_suffix, saved.blobs.values().cloned())
                .with_bootstrap_bytes(&bytes)
                .is_none(),
            "torn baseline/log pair refuses recovery"
        );
        lab.restore_backup(phone, &disk);
        assert_eq!(lab.item(phone, entry).unwrap().record(), expected);
        assert!(lab.held(phone).bootstrap_active.contains(&entry));
        let c = lab
            .edit(phone, vault, entry, |item| item.set_text(2, "after crash"))
            .unwrap();
        let signed = lab
            .backup(phone)
            .signed()
            .iter()
            .find(|s| s.edit.id() == c)
            .unwrap()
            .clone();
        lab.receive(mac, vec![signed], vec![]);
        assert_eq!(
            lab.item(phone, entry).unwrap().record(),
            lab.item(mac, entry).unwrap().record()
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
        let removal = lab
            .backup(mac)
            .signed()
            .iter()
            .find(|s| s.edit.id() == revoke)
            .unwrap()
            .clone();
        lab.receive(phone, vec![removal], vec![]);
        assert!(!lab.held(phone).bootstrap_active.contains(&entry));
        assert!(
            lab.edit(phone, vault, entry, |item| item.set_text(2, "forbidden"))
                .is_err()
        );
        let mut bad = bytes.clone();
        bad.push(0);
        assert!(
            Backup::new(vec![], vec![])
                .with_bootstrap_bytes(&bad)
                .is_none()
        );
        assert!(
            Backup::new(vec![], vec![])
                .with_bootstrap_bytes(&bytes[..bytes.len() - 1])
                .is_none()
        );
    }
}

/// Ordered signed-log frontier. This is a consistency receipt, not authorization.
/// BLAKE3 collision resistance is the binding assumption; every edit is still verified.
fn anchor_frontier<'a>(
    entry: EntryId,
    signed: impl Iterator<Item = &'a crate::sign::Signed>,
) -> (u64, [u8; 32]) {
    let mut h = blake3::Hasher::new_derive_key("avenDB durable entry anchor frontier 2");
    h.update(&entry.0);
    let mut count = 0u64;
    for s in signed.filter(|s| matches!(s.edit.action,Action::Write{entry:e,..}if e==entry)) {
        h.update(&s.edit.id().0);
        count += 1;
    }
    h.update(&count.to_be_bytes());
    (count, *h.finalize().as_bytes())
}

fn encode_anchors<'a>(
    anchors: &Anchors,
    signed: impl Iterator<Item = &'a crate::sign::Signed> + Clone,
) -> Option<Vec<u8>> {
    if anchors.is_empty() {
        return Some(Vec::new());
    }
    if anchors.len() > 16 {
        return None;
    }
    let mut b = b"avenDB bootstrap anchors 2\n".to_vec();
    (anchors.len() as u32).encode(&mut b);
    for (entry, (snapshot, sealed)) in anchors {
        if sealed.len() > MAX_BYTES + 128 || !signed.clone().any(|s| s.edit.id() == *snapshot) {
            return None;
        }
        entry.encode(&mut b);
        snapshot.encode(&mut b);
        sealed.encode(&mut b);
        // Fixed-size exact durable frontier. Depth is not causality; every held
        // entry write contributes, including concurrent writes older than the base.
        let (count, root) = anchor_frontier(*entry, signed.clone());
        count.encode(&mut b);
        b.extend_from_slice(&root);
    }
    Some(b)
}

impl Lab {
    /// Small identity stamp; the signed snapshot fixes its ciphertext root.
    pub fn bootstrap_stamp(&self, on: SignerId) -> Vec<(EntryId, EditId)> {
        self.held(on)
            .bootstrap_bases
            .iter()
            .map(|(e, (s, _))| (*e, *s))
            .collect()
    }
    /// Capture ciphertext anchors with the same held signed frontier as a journal save.
    pub fn bootstrap_bytes(&self, on: SignerId) -> Option<Vec<u8>> {
        let store = self.held(on);
        encode_anchors(
            &store.bootstrap_bases,
            store.log.ids().iter().map(|id| &store.signed[id]),
        )
    }
}

impl Lab {
    /// Runtime adoption remains read-only until the existing journal save acknowledges it.
    pub fn stage_owner_entry_base(&mut self,on:SignerId,snapshot:EditId,entry:EntryId,sealed:Vec<u8>)->bool {
        if !self.adopt_owner_entry_base(on,snapshot,entry,sealed) { return false; }
        let at=self.at(on);
        self.stores.get_mut(&at).expect("device").bootstrap_pending.insert(entry);
        true
    }
    pub fn owner_base_durability_pending(&self,on:SignerId,entry:EntryId)->bool { self.held(on).bootstrap_pending.contains(&entry) }
    /// Caller must hold the Lab lock and verify the common journal has this exact
    /// signed frontier and anchor stamp. This does not make an invalid base active.
    pub fn finish_durable_owner_bases(&mut self,on:SignerId)->bool {
        let at=self.at(on);
        let store=self.stores.get_mut(&at).expect("device");
        let changed=!store.bootstrap_pending.is_empty();
        store.bootstrap_pending.clear();
        changed
    }
}
