//! Historical group discovery only. Callers separately fence complete group
//! frontiers, signature provenance and recursive writer/capability authority.
use super::*;
impl Lab {
    /// Union every opened historical definition's includes, including definitions
    /// later replaced or currently uncounted. This conservative superset cannot
    /// erase a permission that influenced an earlier write. It grants nothing:
    /// canonical `read_groups`/`group_at` still decide each write at its own place.
    /// `None` means unavailable/incomplete materialization, never an empty group.
    pub fn historical_group_dependencies(&self, on: SignerId, vault: VaultId, group: EntryId)
        -> Option<BTreeSet<EntryId>> {
        let store=self.held(on);
        if store.replayed!=store.log.edits().len() || store.bootstrap_active.contains(&group) {return None;}
        let st=&store.replay.state;
        let entry=st.entry(group)?;
        if entry.vault!=vault || !st.is_cap_group(entry,&store.readings) {return None;}
        let ids=store.log.bounded_entry_write_ids(group,512)?;
        if ids.is_empty() {return None;}
        let mut includes=BTreeSet::new();
        let mut edges=0usize;
        for id in ids {
            // Full retained bodies are required, including foreign writers and
            // historical versions. A lazy/checkpoint projection is not enough.
            let body=store.bodies.get(&id)?;
            if let Some(definition)=&body.defines {
                edges=edges.checked_add(definition.includes.len())?;
                if edges>512 {return None;}
                includes.extend(definition.includes.iter().copied());
                if includes.len()>128 {return None;}
            }
        }
        Some(includes)
    }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test]
    fn historical_include_survives_redefinition_and_missing_body_is_unavailable() {
        let mut w=crate::cast::world();
        let child=w.lab.define_group(w.mac_a,w.alice,rules::CapGroup{name:"child".into(),caps:vec![],includes:vec![]}).unwrap();
        let root=w.lab.define_group(w.mac_a,w.alice,rules::CapGroup{name:"root".into(),caps:vec![],includes:vec![child]}).unwrap();
        w.lab.redefine_group(w.mac_a,w.alice,root,rules::CapGroup{name:"root".into(),caps:vec![],includes:vec![]}).unwrap();
        assert!(w.lab.group(w.mac_a,w.alice,root).unwrap().includes.is_empty());
        assert_eq!(w.lab.historical_group_dependencies(w.mac_a,w.alice,root),Some([child].into_iter().collect()));
        let first=w.lab.held(w.mac_a).log.bounded_entry_write_ids(root,512).unwrap()[0];
        w.lab.stores.get_mut(&w.mac_a).unwrap().bodies.remove(&first);
        assert!(w.lab.historical_group_dependencies(w.mac_a,w.alice,root).is_none());
        assert!(w.lab.historical_group_dependencies(w.mac_a,w.bob,root).is_none());
    }
}

impl Store {
    /// Required current semantic group locations and whether every known read is
    /// materialized. A proven nonmatching selector chain needs no group bodies.
    pub(super) fn semantic_groups(&self, st: &State, id: EntryId) -> Option<(BTreeSet<EntryId>,bool)> {
        let en=st.entry(id)?;let r=&self.readings;
        let mut attrs=st.first_attrs(en,r)?;
        for edit in &en.retags {attrs.tags=r.tags.get(edit)?.apply(&attrs.tags);}
        let cap_group=attrs.ty.is_cap_group() && attrs.author==en.vault;
        let mut pending=BTreeSet::new();let mut chains=0usize;
        // Prepare group-bearing chains once per vault/replay, not a fresh scan
        // of every share for every entry and every UI meaning read.
        let candidates={
            let mut index=self.semantic_group_index.lock().expect("semantic group index");
            index.entry(en.vault).or_insert_with(||st.shares_over(en.vault)
                .filter(|c|st.live(c.id) && !c.share.wide && !c.share.level.is_keep()
                    && c.chain.iter().any(|id|st.share(*id).is_some_and(|x|x.share.group.is_some())))
                .map(|c|c.id).collect()).clone()
        };
        for id in candidates {
            let issued=st.share(id)?;
            chains=chains.checked_add(issued.chain.len())?;if chains>2048 {return None;}
            let mut matching=true;let mut unknown=false;let mut roots=BTreeSet::new();
            for id in issued.chain.iter() {
                let link=st.share(*id)?;
                if link.share.wide || cap_group {continue;}
                match r.selectors.get(id) {
                    Some(selector) if !selector.matches(&attrs)=>matching=false,
                    None if self.unreadable.contains(id)=>matching=false,
                    None=>unknown=true,
                    _=>{}
                }
                if let Some(group)=link.share.group {roots.insert(group);}
            }
            if !matching {continue;}
            if unknown {return None;}
            pending.extend(roots);
        }
        let mut required=BTreeSet::new();let mut ready=true;
        while let Some(group)=pending.pop_first() {
            if !required.insert(group) {continue;}
            if required.len()+pending.len()>32 {return None;}
            let Some(definition)=st.group(r,en.vault,group) else {ready=false;continue;};
            let Some(history)=self.log.bounded_entry_write_ids(group,512) else {ready=false;continue;};
            if self.bootstrap_active.contains(&group) || history.iter().any(|id|!self.bodies.contains_key(id)) {ready=false;}
            pending.extend(definition.includes.iter().copied().filter(|g|!required.contains(g)));
        }
        Some((required,ready))
    }
}
impl Lab {
    /// Immutable selector evidence for one authenticated grant chain. `None`
    /// means missing decrypted evidence, never a negative match. Liveness is
    /// deliberately not used: the network must fence matching current grants.
    pub fn semantic_selector_matches(&self,on:SignerId,entry:EntryId,share:ShareId)->Option<bool> {
        let store=self.held(on);let st=store.view();let en=st.entry(entry)?;
        if store.replayed!=store.log.edits().len() {return None;}
        let mut attrs=st.first_attrs(en,&store.readings)?;
        for edit in &en.retags {attrs.tags=store.readings.tags.get(edit)?.apply(&attrs.tags);}
        let cap_group=attrs.ty.is_cap_group() && attrs.author==en.vault;
        let issued=st.share(share)?;
        if issued.share.over!=en.vault || issued.chain.len()>128 {return None;}
        let mut unknown=false;
        for id in issued.chain.iter() {
            let link=st.share(*id)?;
            if link.share.wide || cap_group {continue;}
            match store.readings.selectors.get(id) {
                Some(selector) if !selector.matches(&attrs)=>return Some(false),
                None if store.unreadable.contains(id)=>return Some(false),
                None=>unknown=true,
                _=>{},
            }
        }
        (!unknown).then_some(true)
    }
    pub fn semantic_pending(&self,on:SignerId,entry:EntryId)->bool {
        self.held(on).semantic_pending.contains(&entry)
    }
    /// Persisted selective work to resume when an active view is requested.
    pub fn semantic_pending_entries(&self,on:SignerId)->BTreeSet<EntryId> {
        self.held(on).semantic_pending.iter().copied().collect()
    }
    /// Explicit semantic readiness, separate from readable historical state.
    /// Returned group IDs are ordinary transfer work, never authority evidence.
    pub fn semantic_group_dependencies(&self,on:SignerId,entry:EntryId)->Option<(BTreeSet<EntryId>,bool)> {
        let store=self.held(on);
        if store.replayed!=store.log.edits().len() {return None;}
        store.semantic_groups(store.view(),entry).map(|(groups,ready)|
            (groups,ready && !store.semantic_all_pending && !store.semantic_pending.contains(&entry)))
    }

    /// Called before scoped receive/refresh. Historical rendering remains usable;
    /// automatic semantic marking waits for a verified connected inventory cut.
    pub fn defer_semantic_marks(&mut self,on:SignerId,entry:EntryId)->bool {
        let store=self.stores.get_mut(&self.at(on)).expect("device");
        if store.semantic_all_pending || store.semantic_pending.contains(&entry) {return true;}
        if store.semantic_pending.len()>=4096 {return false;}
        store.semantic_pending.insert(entry);store.bootstrap_revision=Arc::new(());
        true
    }
    /// Caller must hold its current authenticated inventory fence and have closed
    /// selectors/current matching frontiers for that cut. Local readiness is
    /// rechecked here; this method never overrides canonical authorization.
    pub fn complete_semantic_cut(&mut self,on:SignerId,entry:EntryId)->bool {
        let store=self.held(on);
        if store.semantic_all_pending || store.replayed!=store.log.edits().len() || !store.reads_shares(store.view(),store.view().entry(entry).map(|e|e.vault).unwrap_or(VaultId([0;32])))
            || !store.semantic_groups(store.view(),entry).is_some_and(|(_,ready)|ready) {return false;}
        let store=self.stores.get_mut(&self.at(on)).expect("device");
        if store.semantic_pending.remove(&entry) {store.bootstrap_revision=Arc::new(());}
        true
    }
}

#[cfg(test)] mod semantic_tests {
    use super::*;
    #[test]
    fn missing_matching_group_never_removes_an_existing_audience() {
        let mut w=crate::cast::world();
        let target=w.lab.create(w.mac_a,w.alice,w.alice,"doc",&[],crate::cast::document("Target","text",w.mac_a)).unwrap();
        let group=w.lab.define_group(w.mac_a,w.alice,rules::CapGroup {
            name:"Readers".into(),caps:vec![rules::Cap{op:rules::Op::Read,slice:crate::slice::Selector::All}],includes:vec![],
        }).unwrap();
        w.lab.issue_group(w.mac_a,&[w.mac_a],GroupShare {
            over:w.alice,who:Who::Vault(w.bob),name:"Readers".into(),select:crate::cast::by_id(target),
            group,level:Level::Read,parent:None,issuer:w.alice,
        }).unwrap();
        assert!(w.lab.semantic_group_dependencies(w.mac_a,target).unwrap().1);
        w.lab.stores.get_mut(&w.mac_a).unwrap().readings.groups=crate::policy::Groups::default();
        assert_eq!(w.lab.semantic_group_dependencies(w.mac_a,target),Some(([group].into_iter().collect(),false)));
        assert!(w.lab.mark_now(w.mac_a,target).unwrap().is_none());
        assert!(w.lab.meaning(w.mac_a,target).is_none(),"unknown group must not look like confirmed no audience");
    }
    #[test]
    fn proven_nonmatching_selector_does_not_require_its_group() {
        let mut w=crate::cast::world();
        let target=w.lab.create(w.mac_a,w.alice,w.alice,"doc",&[],crate::cast::document("Target","text",w.mac_a)).unwrap();
        let group=w.lab.define_group(w.mac_a,w.alice,rules::CapGroup{name:"Other".into(),caps:vec![],includes:vec![]}).unwrap();
        w.lab.issue_group(w.mac_a,&[w.mac_a],GroupShare {
            over:w.alice,who:Who::Vault(w.bob),name:"Other".into(),select:crate::cast::of_type("other-kind"),
            group,level:Level::Read,parent:None,issuer:w.alice,
        }).unwrap();
        w.lab.stores.get_mut(&w.mac_a).unwrap().readings.groups=crate::policy::Groups::default();
        assert_eq!(w.lab.semantic_group_dependencies(w.mac_a,target),Some((BTreeSet::new(),true)));
    }
}

#[cfg(test)] mod restart_tests {
    use super::*;
    #[test] fn completed_unchanged_store_keeps_offline_reads_and_writes() {
        let mut w=crate::cast::world();
        let entry=w.lab.create(w.mac_a,w.alice,w.alice,"doc",&[],crate::cast::document("Local","kept",w.mac_a)).unwrap();
        let backup=w.lab.backup(w.mac_a);
        w.lab.restore_backup(w.mac_a,&backup);
        assert!(w.lab.item(w.mac_a,entry).is_some());
        assert!(w.lab.semantic_group_dependencies(w.mac_a,entry).unwrap().1);
        w.lab.edit(w.mac_a,w.alice,entry,|item|item.set_text(2,"offline update")).unwrap();
        assert_eq!(crate::cast::text(&w.lab,w.mac_a,entry,2).as_deref(),Some("offline update"));
    }
    #[test] fn bounded_pending_admission_keeps_existing_store_savable() {
        let mut w=crate::cast::world();
        let entry=w.lab.create(w.mac_a,w.alice,w.alice,"doc",&[],crate::cast::document("Local","kept",w.mac_a)).unwrap();
        for n in 0..4096u32 {
            let mut id=[0u8;32];id[..4].copy_from_slice(&n.to_le_bytes());
            assert!(w.lab.defer_semantic_marks(w.mac_a,EntryId(id)));
        }
        assert!(!w.lab.defer_semantic_marks(w.mac_a,entry));
        assert!(w.lab.backup(w.mac_a).bootstrap_bytes().is_some());
        w.lab.edit(w.mac_a,w.alice,entry,|item|item.set_text(2,"still writable")).unwrap();
        assert!(w.lab.backup(w.mac_a).bootstrap_bytes().is_some());
        let corrupt=w.lab.backup(w.mac_a).defer_unverified_semantics();
        let bytes=corrupt.bootstrap_bytes().unwrap();
        assert!(bytes.len()<64,"global corruption guard is compact");
        let restored=Backup::new(corrupt.signed.clone(),corrupt.blobs.values().cloned())
            .with_bootstrap_bytes(&bytes).unwrap();
        w.lab.restore_backup(w.mac_a,&restored);
        assert!(w.lab.item(w.mac_a,entry).is_some());
        assert!(!w.lab.semantic_group_dependencies(w.mac_a,entry).unwrap().1);
        assert!(w.lab.backup(w.mac_a).bootstrap_bytes().is_some());
    }
    #[test] fn semantic_save_stamp_tracks_insert_and_clear() {
        let mut w=crate::cast::world();
        let entry=w.lab.create(w.mac_a,w.alice,w.alice,"doc",&[],crate::cast::document("Local","kept",w.mac_a)).unwrap();
        let initial=w.lab.bootstrap_stamp(w.mac_a);
        w.lab.defer_semantic_marks(w.mac_a,entry);
        assert_ne!(initial,w.lab.bootstrap_stamp(w.mac_a));
        // This complete local world is the test's trusted current cut.
        assert!(w.lab.complete_semantic_cut(w.mac_a,entry));
        assert_eq!(initial,w.lab.bootstrap_stamp(w.mac_a));
        let backup=w.lab.backup(w.mac_a);
        w.lab.restore_backup(w.mac_a,&backup);
        assert!(w.lab.semantic_group_dependencies(w.mac_a,entry).unwrap().1);
    }
    #[test] fn malformed_companion_recovery_preserves_content_but_not_semantic_certainty() {
        let mut w=crate::cast::world();
        let entry=w.lab.create(w.mac_a,w.alice,w.alice,"doc",&[],crate::cast::document("Local","kept",w.mac_a)).unwrap();
        let backup=w.lab.backup(w.mac_a);
        assert!(backup.clone().with_bootstrap_bytes(b"AVSEM001bad").is_none());
        w.lab.restore_backup(w.mac_a,&backup.defer_unverified_semantics());
        assert!(w.lab.item(w.mac_a,entry).is_some());
        assert!(!w.lab.semantic_group_dependencies(w.mac_a,entry).unwrap().1);
        assert!(w.lab.mark_now(w.mac_a,entry).unwrap().is_none());
    }
    #[test] fn incomplete_semantic_cut_stays_pending_after_backup_reopen() {
        let mut w=crate::cast::world();
        let entry=w.lab.create(w.mac_a,w.alice,w.alice,"doc",&[],crate::cast::document("Local","kept",w.mac_a)).unwrap();
        w.lab.defer_semantic_marks(w.mac_a,entry);
        let backup=w.lab.backup(w.mac_a);
        let companion=backup.bootstrap_bytes().unwrap();
        let durable=Backup::new(backup.signed.clone(),backup.blobs.values().cloned()).with_bootstrap_bytes(&companion).unwrap();
        w.lab.restore_backup(w.mac_a,&durable);
        assert!(w.lab.item(w.mac_a,entry).is_some(),"local historical content remains readable");
        assert!(!w.lab.semantic_group_dependencies(w.mac_a,entry).unwrap().1);
        assert!(w.lab.mark_now(w.mac_a,entry).unwrap().is_none());
    }
}
