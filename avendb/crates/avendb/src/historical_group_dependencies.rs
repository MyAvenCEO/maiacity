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
