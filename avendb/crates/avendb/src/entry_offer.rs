//! Which owners' snapshot of an entry a device may take, and what one device offers another of it: the signed
//! snapshot and the entry's setup, never its content history. The slice file the snapshot names is the one based
//! format (`entry_base`, `EntryState.lean`'s based state), the same for owners and readers.
use super::*;

const MAX_BYTES: usize = 1 << 20;
const MAX_LINES: usize = 16;
const MAX_BASIS: usize = 64;

impl Lab {
    /// The vault, the state and the entry key of snapshot `snapshot` of entry `entry`, if device `on` may take it:
    /// the snapshot stands, is of the entry's vault, isn't stale, its basis is of the entry's log, and `on` may read
    /// the entry now (`based_sound`). Checked on every use; nothing is kept.
    pub(super) fn snapshot_authority(&self, on: SignerId, snapshot: EditId, entry: EntryId) -> Option<(VaultId, &crate::policy::Stated, KeyName)> {
        let store = self.held(on);
        if store.replayed != store.log.edits().len() { return None; }
        let st = &store.replay.state;
        let en = st.entry(entry)?;
        let standing: HashSet<_> = store.replay.standing().into_iter().collect();
        if !standing.contains(&snapshot) { return None; }
        let edit = store.log.edits().iter().find(|e| e.id() == snapshot)?;
        let Action::Snapshot { vault, states } = &edit.action else { return None; };
        if *vault != en.vault { return None; }
        let stated = states.iter().find(|s| s.entry == entry)?;
        if stated.basis.is_empty() || stated.basis.len() > MAX_BASIS
            || crate::snapshot::stale(store.log.edits(), &standing, edit, stated) { return None; }
        for basis in &stated.basis {
            if let Some(held) = store.log.edits().iter().find(|e| e.id() == *basis) {
                if held.depth >= edit.depth || crate::sync::log_of(held, *basis) != Some(LogId::Entry(entry)) { return None; }
            }
        }
        // Current recipient entitlement is checked even if an old decrypted key remains locally.
        let audience = KeyFam::Audience(en.vault, en.audience());
        let opens = st.opens(&[KeyName::Signer(on)]);
        let name = st.entry_key(entry)?;
        if !(st.public_key(audience) || st.entitled(on, audience))
            || !opens.contains(&st.current(audience)) || !opens.contains(&name) || !st.wants(on, en) { return None; }
        store.keys.first(name)?;
        Some((*vault, stated, name))

    }
}

/// A normally signed, scoped checkpoint offer. Evidence contains only authorized entry setup
/// (creation/key/stay records) and its owner approval, never the intervening content history.
pub struct EntryBaseOffer {
    pub snapshot: EditId,
    pub root: FileRoot,
    pub evidence: Vec<Signed>,
    pub blobs: Vec<BlobId>,
}

impl Lab {
    /// The snapshot of the base device `me` shows entry `entry` from now, if any. An untrusted optimization hint
    /// only: it neither reads plaintext nor validates authorization. A peer still checks current READ before
    /// comparing this id to its standing snapshot.
    pub fn retained_base_hint(&self, me: SignerId, entry: EntryId) -> Option<EditId> {
        self.active_owner_base(me, entry).map(|(snapshot, _)| snapshot)
    }

    /// A persisted content pin only locates bytes. Select its signed checkpoint under
    /// current ordinary policy; ciphertext must still pass `adopt_owner_entry_base`.
    /// A disk tag may advance only to the newest currently authorized standing snapshot.
    /// Call under the node's checkpoint pin serialization gate; ordinary policy remains
    /// checked here and no in-memory cache hint is treated as authority.
    pub fn entry_base_pin_is_current(&self, me: SignerId, entry: EntryId, snapshot: EditId, root: FileRoot) -> bool {
        let Some((_, stated, _)) = self.snapshot_authority(me, snapshot, entry) else { return false; };
        if stated.slice != root { return false; }
        let log = &self.held(me).log;
        let Some(selected) = log.edits().iter().find(|edit| edit.id() == snapshot) else { return false; };
        !log.edits().iter().any(|edit| {
            (edit.depth, edit.id()) > (selected.depth, snapshot)
                && matches!(&edit.action, Action::Snapshot { states, .. } if states.iter().any(|state| state.entry == entry))
                && self.snapshot_authority(me, edit.id(), entry).is_some()
        })
    }

    pub fn entry_base_restore_point(&self, me: SignerId, entry: EntryId, hash: [u8; 32]) -> Option<(EditId, FileRoot)> {
        let store = self.held(me);
        if store.replayed != store.log.edits().len() { return None; }
        store.log.edits().iter().filter_map(|edit| {
            let Action::Snapshot { states, .. } = &edit.action else { return None; };
            let state = states.iter().find(|state| state.entry == entry && state.slice.hash == hash)?;
            if state.slice.size > (MAX_BYTES + 128) as u64 { return None; }
            self.snapshot_authority(me, edit.id(), entry)?;
            Some((edit.depth, edit.id(), state.slice))
        }).max_by_key(|(depth, id, _)| (*depth, *id)).map(|(_, id, root)| (id, root))
    }

    pub fn entry_base_offer(&self, me: SignerId, requester: SignerId, entry: EntryId) -> Option<EntryBaseOffer> {
        self.entry_base_offer_after(me, requester, entry, None)
    }

    pub fn entry_base_offer_after(&self, me: SignerId, requester: SignerId, entry: EntryId, known: Option<EditId>) -> Option<EntryBaseOffer> {
        self.entry_base_offer_matching(me,requester,entry,known,None)
    }
    /// A format-specific durable pin is only a hint: all standing/current READ gates
    /// still apply before selecting the signed snapshot with this ciphertext root.
    pub fn entry_base_offer_for_root(&self, me:SignerId, requester:SignerId, entry:EntryId, known:Option<EditId>, root:[u8;32])->Option<EntryBaseOffer> {
        self.entry_base_offer_matching(me,requester,entry,known,Some(root))
    }
    fn entry_base_offer_matching(&self, me: SignerId, requester: SignerId, entry: EntryId, known: Option<EditId>, root:Option<[u8;32]>) -> Option<EntryBaseOffer> {
        let store = self.held(me);
        if store.replayed != store.log.edits().len() { return None; }
        let st = self.latest(me);
        let en = st.entry(entry)?;
        let audience = KeyFam::Audience(en.vault, en.audience());
        let opens = st.opens(&[KeyName::Signer(requester)]);
        if !(st.public_key(audience) || st.entitled(requester, audience))
            || !opens.contains(&st.current(audience))
            || !st.entry_key(entry).is_some_and(|name| opens.contains(&name)) || !st.wants(requester, en) { return None; }
        let standing: HashSet<_> = store.replay.standing().into_iter().collect();
        let (edit, stated) = store.log.edits().iter().filter_map(|edit| {
            let Action::Snapshot { vault, states } = &edit.action else { return None; };
            if states.len() > MAX_LINES || states.iter().any(|state| state.basis.len() > MAX_BASIS) { return None; }
            if *vault != en.vault || !standing.contains(&edit.id()) { return None; }
            let stated = states.iter().find(|state| state.entry == entry)?;
            if root.is_some_and(|root|root!=stated.slice.hash) { return None; }
            if stated.slice.size > (MAX_BYTES + 128) as u64
                || crate::snapshot::stale(store.log.edits(), &standing, edit, stated) { return None; }
            Some((edit, stated))
        }).max_by_key(|(edit, _)| (edit.depth, edit.id()))?;
        if known == Some(edit.id()) { return None; }
        let allowed = self.answered(me, requester, &[]);
        let mut evidence = Vec::new();
        let mut evidence_bytes = 0usize;
        for &index in allowed.iter() {
            let candidate = &store.log.edits()[index];
            let id = store.log.ids()[index];
            let log = crate::sync::log_of(candidate, id);
            // A newly discovered entry can introduce its audience key after login. Carry
            // that authorized key evidence with the entry; background history may be stalled.
            let audience_key = log == Some(LogId::Audience(en.vault, en.audience()))
                && matches!(candidate.action, Action::Keys { .. });
            let setup = audience_key || (log == Some(LogId::Entry(entry))
                && !matches!(candidate.action, Action::Write { create: None, .. }));
            if setup || id == edit.id() {
                let signed = store.signed.owned_get(&id)?;
                if !bounded_offer_edit(&signed) { return None; }
                evidence_bytes = evidence_bytes.checked_add(signed.to_wire().len())?;
                if evidence_bytes > (480 << 10) { return None; }
                evidence.push(signed);
                if evidence.len() > 64 { return None; }
            }
        }
        if !evidence.iter().any(|signed| signed.edit.id() == edit.id()) { return None; }
        let blobs: BTreeSet<_> = evidence.iter().flat_map(|signed| signed.edit.blobs())
            .filter(|blob| store.blobs.contains_key(blob)).collect();
        Some(EntryBaseOffer { snapshot: edit.id(), root: stated.slice, evidence, blobs: blobs.into_iter().collect() })
    }
}

// Bound every variable-length field before encoding/cloning evidence. Oversized legacy setup
// remains available through ordinary history; the first-view lane never needs an oversized page.
pub(super) fn bounded_offer_edit(signed: &Signed) -> bool {
    use crate::sign::WebAuthn;
    let e = &signed.edit;
    if e.parents.len() > 64 || e.cosigners.len() > 8 || signed.sigs.len() > 8 { return false; }
    for sig in &signed.sigs {
        if sig.pq.len() > 32768 { return false; }
        if let Some(web) = &sig.webauthn {
            let a = web.assertion();
            if a.authenticator_data.len() > 4096 || a.client_data_json.len() > 4096 || a.signature.len() > 1024
                || matches!(web, WebAuthn::Batch { edits, .. } if edits.len() > 64) { return false; }
        }
        if sig.enclave.as_ref().is_some_and(|s| s.public.len() > 4096 || s.sig.len() > 4096 || s.edits.len() > 64) { return false; }
    }
    match &e.action {
        Action::Write { deps, via, create: Some(c), files, body, .. } =>
            deps.len() <= 64 && via.len() <= 16 && c.audience.len() <= 64 && files.len() <= 64 && body.len() <= (128 << 10),
        Action::Write { deps, via, create:None, files, body, .. } => deps.len()<=64 && via.len()<=16 && files.len()<=64 && body.len()<=(128<<10),
        Action::Snapshot { states, .. } => states.len() <= 16 && states.iter().all(|s| s.basis.len() <= 64),
        Action::Mark { caps, wants, keep, via, .. } => caps.as_ref().is_none_or(|x| x.len() <= 64)
            && wants.as_ref().is_none_or(|x| x.len() <= 64) && keep.len() <= 64 && via.len() <= 16,
        Action::Keys { boxes, .. } => boxes.len() <= 32 && boxes.iter().all(|b| b.bytes.len() <= 4096),
        Action::Wraps { wraps, .. } => wraps.len() <= 32 && wraps.iter().all(|w| w.boxed.bytes.len() <= 4096),
        _ => false,
    }
}
