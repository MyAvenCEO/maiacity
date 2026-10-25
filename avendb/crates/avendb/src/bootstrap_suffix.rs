//! A current owner-approved base is a suffix cursor, never a held-history claim.
use super::*;

/// Constructed only by current local projection authority. Network callers use
/// this metadata for dependency planning, not to install a policy kernel.
#[derive(Clone, PartialEq, Eq)]
pub struct OwnerBaseScope {
    snapshot: EditId,
    basis: Vec<EditId>,
    vault: VaultId,
    via: BTreeSet<VaultId>,
    audiences: BTreeSet<Vec<ShareId>>,
    shares: BTreeSet<ShareId>,
    writes: BTreeSet<EditId>,
    stays: BTreeSet<EditId>,
}
impl OwnerBaseScope {
    pub fn snapshot(&self) -> EditId { self.snapshot }
    pub fn basis(&self) -> &[EditId] { &self.basis }
    pub fn vault(&self) -> VaultId { self.vault }
    pub fn via(&self) -> &BTreeSet<VaultId> { &self.via }
    pub fn audiences(&self) -> &BTreeSet<Vec<ShareId>> { &self.audiences }
    pub fn shares(&self) -> &BTreeSet<ShareId> { &self.shares }
    pub fn writes(&self) -> &BTreeSet<EditId> { &self.writes }
    pub fn stays(&self) -> &BTreeSet<EditId> { &self.stays }
}
impl Lab {
    /// The accepted overlay is authenticated and currently readable by an owner.
    /// The 512-fact envelope stays bounded; no historical ciphertext is cloned.
    pub fn owner_base_scope(&self, on: SignerId, entry: EntryId) -> Option<OwnerBaseScope> {
        if !self.owner_overlay_current(on) { return None; }
        let (snapshot, basis) = self.active_owner_base(on, entry)?;
        let store = self.held(on);
        let slice = store.bootstrap_state.as_ref()?.slice_of(entry);
        if slice.entries.len() != 1 || slice.writes.len() > 512 || slice.audiences.len() > 64 { return None; }
        let en = &slice.entries[0];
        if en.id != entry || !slice.within(entry, en.vault) { return None; }
        let mut via = BTreeSet::new();
        let mut writes = BTreeSet::new();
        for write in &slice.writes {
            if write.actor != en.vault || write.proposal != Proposal::Main || write.via.len() > 32 { return None; }
            via.extend(write.via.iter().copied()); writes.insert(write.edit);
        }
        let audiences: BTreeSet<Vec<ShareId>> = slice.audiences.iter().map(|(_, ids)| ids.to_vec()).collect();
        let shares: BTreeSet<_> = audiences.iter().flatten().copied()
            .chain(slice.marks.iter().flat_map(|(_, ids)| ids.iter().copied())).collect();
        if via.len() > 128 || shares.len() > 128 { return None; }
        let stays = en.stays.iter().filter_map(|(stay, _)| *stay).collect();
        Some(OwnerBaseScope { snapshot, basis, vault: en.vault, via, audiences, shares, writes, stays })
    }

    /// Explicit suffix transfer. `snapshot` is NOT recorded as receiver holdings.
    /// The provider authenticates the named statement and current recipient again.
    pub fn owner_base_suffix_reply(&mut self, me: SignerId, requester: SignerId,
        entry: EntryId, snapshot: EditId, seen: &[EditId]) -> Option<crate::wire::Reply> {
        if seen.len() > 32 { return None; }
        let (vault, stated, _) = self.projection_authority(me, snapshot, entry)?;
        let mut cutoff = stated.basis.clone();
        let st = self.latest(me);
        let en = st.entry(entry)?;
        let audience = KeyFam::Audience(vault, en.audience());
        let opens = st.opens(&[KeyName::Signer(requester)]);
        if !(st.public_key(audience) || st.entitled(requester, audience))
            || !opens.contains(&st.current(audience))
            || !st.entry_key(entry).is_some_and(|key| opens.contains(&key)) || !st.wants(requester, en) { return None; }
        // Seen IDs suppress bytes only in this response, never establish trust.
        cutoff.extend(seen.iter().copied()); cutoff.sort(); cutoff.dedup();
        let ask = crate::sync::Ask { haves: [(LogId::Entry(entry), cutoff)].into_iter().collect(), loose: vec![], follow: vec![] };
        let request = crate::wire::Request { ask, wants: vec![], after: None };
        let (mut edits, _, mut more) = self.reply_in(me, requester, &request, 480 << 10,
            &ReplyScope::Logs([LogId::Entry(entry)].into_iter().collect()));
        if edits.len() > 64 { edits.truncate(64); more = true; }
        if edits.iter().any(|s| !entry_projection::bounded_offer_edit(s)) { return None; }
        Some(crate::wire::Reply { edits, blobs: vec![], more })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on, text};
    #[test]
    fn long_owner_base_transfers_only_suffix_and_rechecks_revocation() {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner,"Mac");
        let phone = lab.device_of(owner,"Phone");
        let vault = human_on(&mut lab,owner,&[mac,phone]);
        let entry = lab.create(mac,vault,vault,"note",&[],document("Long","initial",mac)).unwrap();
        lab.sync(mac,phone);
        for n in 0..80 { lab.edit(mac,vault,entry,|i|i.set_text(2,&format!("value {n}"))).unwrap(); }
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac,&[owner],entry).unwrap();
        let snapshot = lab.complete(mac,draft,&[]).unwrap();
        let offer = lab.entry_projection_offer(mac,phone,entry).unwrap();
        lab.receive(phone,offer.evidence,vec![]);
        assert!(lab.adopt_owner_entry_base(phone,snapshot,entry,sealed));
        let scope = lab.owner_base_scope(phone,entry).expect("current bounded owner metadata");
        assert!(scope.writes().len()>64);
        let before = lab.log(phone).ids().to_vec();
        let suffix = lab.edit(mac,vault,entry,|i|i.set_text(2,"latest suffix")).unwrap();
        let reply = lab.owner_base_suffix_reply(mac,phone,entry,snapshot,&[]).unwrap();
        assert!(!reply.more);
        assert_eq!(reply.edits.iter().map(|s|s.edit.id()).collect::<Vec<_>>(),vec![suffix]);
        assert_eq!(lab.log(phone).ids(),before,"requesting a suffix does not claim base history");
        // Match network admission: retain verified bytes without synchronously
        // rebuilding the accepted overlay under the receive lock.
        let prepared = lab.prepare_receive(phone, reply.edits).check();
        lab.receive_prepared(phone, prepared, false);
        assert!(lab.owner_base_scope(phone,entry).is_none(),
            "the old overlay must not masquerade as current after suffix admission");
        let mut turns = 0;
        loop {
            let (worked, pending) = lab.catch_up_step(phone, &[entry]);
            turns += 1;
            assert!(worked, "admitted suffix must schedule canonical work");
            assert!(turns < 32, "bounded suffix must finish in finite paced turns");
            if !pending { break; }
        }
        assert_eq!(text(&lab,phone,entry,2).as_deref(),Some("latest suffix"));
        let advanced = lab.owner_base_scope(phone,entry).expect("base remains active after suffix");
        assert_eq!(advanced.snapshot(), scope.snapshot());
        assert!(advanced != scope, "a retained snapshot ID cannot stand in for the current dependency summary");
        assert!(lab.log(phone).edits().iter().filter(|e|crate::sync::log_of(e,e.id())==Some(LogId::Entry(entry))).count()<64);
        let revoked=lab.submit(mac,&[owner],Action::Revoke(Revoking::Device{vault,device:phone,keep:vec![]})).unwrap();
        assert!(lab.owner_base_suffix_reply(mac,phone,entry,snapshot,&[]).is_none());
        let removal=lab.signed_edit(mac,revoked).unwrap().clone();
        lab.receive(phone,vec![removal],vec![]);
        assert!(lab.owner_base_scope(phone,entry).is_none());
    }
}
