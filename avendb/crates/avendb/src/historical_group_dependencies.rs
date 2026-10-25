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
        for issued in st.shares_over(en.vault).filter(|c|st.live(c.id) && !c.share.wide && !c.share.level.is_keep()) {
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
    /// Explicit semantic readiness, separate from readable historical state.
    /// Returned group IDs are ordinary transfer work, never authority evidence.
    pub fn semantic_group_dependencies(&self,on:SignerId,entry:EntryId)->Option<(BTreeSet<EntryId>,bool)> {
        let store=self.held(on);
        if store.replayed!=store.log.edits().len() {return None;}
        store.semantic_groups(store.view(),entry)
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
