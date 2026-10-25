//! An owner's exhaustive scoped statement at an explicitly accepted cut.
//! It is not an assertion that unknown peers have no newer state. Ordinary
//! entry/manifest authorization and canonical owner Snapshot approval apply.
use super::*;

const VERSION: &str = "avendb-scoped-discovery-v1";
const MAX_MEMBERS: usize = 512;
const MAX_HEADS: usize = 64;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DiscoveryScope { Types(Vec<String>), Tag(String) }
impl DiscoveryScope {
    pub fn normalized(self) -> Option<Self> {
        match self {
            Self::Types(mut types) => {
                if types.is_empty() || types.len()>8 || types.iter().any(|t|t.is_empty()||t.len()>256) {return None;}
                types.sort(); types.dedup(); Some(Self::Types(types))
            }
            Self::Tag(tag) if !tag.is_empty() && tag.len()<=256 => Some(Self::Tag(tag)),
            _ => None,
        }
    }
    fn json(&self) -> Value { match self { Self::Types(types)=>json!({"types":types}), Self::Tag(tag)=>json!({"tag":tag}) } }
    fn matches(&self, lab:&Lab, on:SignerId, entry:EntryId)->Option<bool> {
        match self {
            Self::Types(types)=>{ let kind=lab.entry_type_hint(on,entry)?; Some(types.iter().any(|t|t==kind)) },
            Self::Tag(tag)=>lab.entry_tag_hint(on,entry,tag),
        }
    }
}

/// Publication remains an explicit ordinary carrier write followed by the
/// existing owner-approved entry-projection Snapshot. This builder mutates no data.
impl Lab {
    pub fn discovery_manifest_record(&self,on:SignerId,vault:VaultId,scope:DiscoveryScope)->Option<Value> {
        let scope=scope.normalized()?;
        let store=self.held(on);
        if !self.local_inventory_replayed(on) || !store.view().acts_for(on,vault) {return None;}
        let mut members=Vec::new();
        let mut total_heads=0usize;
        for entry in store.view().entries().iter().filter(|entry|entry.vault==vault) {
            // Publication never treats unknown headers/tags as an absent match.
            if !scope.matches(self,on,entry.id)? || !self.landed(on,entry.id) {continue;}
            if !self.reads(on,entry.id) || members.len()==MAX_MEMBERS {return None;}
            let mut heads=self.history(on,entry.id)?.heads(MAIN);
            heads.sort();heads.dedup();
            if heads.is_empty()||heads.len()>MAX_HEADS {return None;}
            total_heads+=heads.len(); if total_heads>4096 {return None;}
            members.push((entry.id,heads));
        }
        members.sort_by_key(|(entry,_)|*entry);
        Some(json!({"kind":VERSION,"vault":vault.to_hex(),"scope":scope.json(),
            "members":members.into_iter().map(|(entry,heads)|json!({"entry":entry.to_hex(),"heads":heads.iter().map(EditId::to_hex).collect::<Vec<_>>()})).collect::<Vec<_>>(),
            "completeAtOwnerCut":true,"remoteComplete":false}))
    }

    /// Verify the explicit owner snapshot cut, normalize query identity, check
    /// every member against CURRENT actor readability and reject known relevant
    /// additions/removals/retags or frontier changes. Unseen membership metadata
    /// remains pending rather than being exposed as authorized content.
    pub fn discovery_manifest_members(&self,on:SignerId,actor:VaultId,vault:VaultId,scope:DiscoveryScope,carrier:EntryId,snapshot:EditId)->Option<Vec<EntryId>> {
        let scope=scope.normalized()?;
        let projection=self.attested_entry_projection(on,snapshot,carrier)?;
        let record=projection.record(MAIN)?;
        if record.get("kind")?.as_str()?!=VERSION || record.get("vault")?.as_str()?!=vault.to_hex()
            || record.get("scope")?!=&scope.json() || record.get("completeAtOwnerCut")?!=&Value::Bool(true) {return None;}
        let st=self.state(on);
        if st.entry(carrier)?.vault!=vault {return None;}
        let can_read=|entry:&crate::policy::Entry| st.public_key(KeyFam::Audience(entry.vault,entry.audience()))
            || crate::world::levels(st,entry.vault,entry.audience()).iter().any(|(who,level)|*who==actor&&level.allows(Level::Read));
        if !can_read(st.entry(carrier)?) {return None;}
        let rows=record.get("members")?.as_array()?;
        if rows.len()>MAX_MEMBERS {return None;}
        let mut members=Vec::with_capacity(rows.len());
        for row in rows {
            let id=EntryId::from_hex(row.get("entry")?.as_str()?)?;
            if members.last().is_some_and(|prior|*prior>=id) {return None;}
            let entry=st.entry(id)?;
            if entry.vault!=vault || !can_read(entry) || !self.reads(on,id) || !scope.matches(self,on,id)? {return None;}
            let encoded=row.get("heads")?.as_array()?;
            if encoded.is_empty()||encoded.len()>MAX_HEADS {return None;}
            let heads:Vec<_>=encoded.iter().map(|head|EditId::from_hex(head.as_str()?)).collect::<Option<_>>()?;
            if heads.windows(2).any(|pair|pair[0]>=pair[1]) {return None;}
            let mut current=self.history(on,id)?.heads(MAIN);current.sort();current.dedup();
            if current!=heads {return None;}
            members.push(id);
        }
        // Only inspect readable local candidates. Hidden unrelated activity must
        // not alter the public readiness signal; the statement remains at its
        // explicit owner cut, not a claim covering unknown later private writes.
        for entry in st.entries().iter().filter(|entry|entry.vault==vault&&can_read(entry)) {
            if !self.landed(on,entry.id) {continue;}
            if scope.matches(self,on,entry.id)? && members.binary_search(&entry.id).is_err() {return None;}
        }
        Some(members)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast;

    #[test]
    fn owner_manifest_query_requires_approval_exact_scope_and_unchanged_membership() {
        let mut w=cast::world();
        let note=w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("member",w.mac_a)).unwrap();
        let scope=DiscoveryScope::Tag("selected".into());
        let record=w.lab.discovery_manifest_record(w.mac_a,w.alice,scope.clone()).unwrap();
        let mut item=Item::new(w.mac_a);item.put_record(&record);
        let carrier=w.lab.create(w.mac_a,w.alice,w.alice,"discovery-manifest",&[],item).unwrap();
        assert!(w.lab.draft_entry_projection(w.mac_a,&[w.mac_a],carrier).is_err());
        let prepared=w.lab.draft_entry_projection(w.mac_a,&[w.passkey_a],carrier).unwrap();
        let snapshot=w.lab.complete(w.mac_a,prepared.draft,&[]).unwrap();
        assert!(w.lab.retain_entry_projection(w.mac_a,snapshot,carrier,prepared.sealed));
        assert_eq!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,scope.clone(),carrier,snapshot),Some(vec![note]));
        assert!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,DiscoveryScope::Tag("another".into()),carrier,snapshot).is_none());
        let query=json!({"op":"entry_views","vault":w.alice.to_hex(),"as":w.alice.to_hex(),"tag":"selected",
            "manifest":{"entry":carrier.to_hex(),"snapshot":snapshot.to_hex()}});
        let result=crate::engine::read(&w.lab,w.mac_a,&query);
        assert_eq!(result["ok"]["scope"]["completeAtOwnerCut"],true);
        assert_eq!(result["ok"]["scope"]["localComplete"],false);
        assert_eq!(result["ok"]["scope"]["remoteComplete"],false);
        assert!(crate::engine::read(&w.lab,w.mac_a,&json!({"op":"read_guard","query":query})).get("ok").is_some());
        w.lab.create(w.mac_a,w.alice,w.alice,"note",&["selected"],Item::todo("new member",w.mac_a)).unwrap();
        assert!(w.lab.discovery_manifest_members(w.mac_a,w.alice,w.alice,scope,carrier,snapshot).is_none(),"known in-domain additions invalidate the old cut for negative use");
        assert!(crate::engine::read(&w.lab,w.mac_a,&json!({"op":"read_guard","query":query})).get("refused").is_some());
    }

    #[test]
    fn discovery_scope_normalizes_and_rejects_unbounded_contracts() {
        assert_eq!(DiscoveryScope::Types(vec!["post".into(),"flow".into(),"post".into()]).normalized(),Some(DiscoveryScope::Types(vec!["flow".into(),"post".into()])));
        assert!(DiscoveryScope::Types(vec![]).normalized().is_none());
        assert!(DiscoveryScope::Types(vec!["flow".into();9]).normalized().is_none());
        assert!(DiscoveryScope::Tag("x".repeat(257)).normalized().is_none());
    }
}
