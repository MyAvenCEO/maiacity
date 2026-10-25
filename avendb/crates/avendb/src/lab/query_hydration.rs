//! A scheduling hint only; ordinary query authorization still runs on each turn.
use super::*;
impl Lab {
    /// Inspect lazy cells without importing snapshots or opening deferred bodies.
    /// The query may defer this candidate, but cannot treat this hint as visibility.
    pub(crate) fn query_needs_hydration(&self, d: SignerId, entry: EntryId) -> bool {
        self.query_hydration_needed(d,entry,false)
    }
    pub(crate) fn query_metadata_needs_hydration(&self, d: SignerId, entry: EntryId) -> bool {
        self.query_hydration_needed(d,entry,true)
    }
    fn query_hydration_needed(&self, d: SignerId, entry: EntryId, metadata_only: bool) -> bool {
        if !self.sees(d, entry) { return false; }
        let store=self.held(d);
        let state=store.view();
        let Some(en)=state.entry(entry) else {return false};
        // These candidates cannot progress by hydrating a record. Let ordinary
        // meaning report them unresolved without consuming a continuation slot.
        if state.first_attrs(en,&store.readings).is_none()
            || !store.semantic_groups(state,entry).is_some_and(|(_,ready)|ready) {return false;}
        let Some(shown)=store.shown.get(&entry) else { return false; };
        if shown.history_bodies.iter().any(|id| !store.bodies.contains_key(id) && !store.deferred_authorized(*id)) {return false;}
        let history=state.is_draft(entry) && !shown.history_bodies.is_empty()
            && shown.hydrated_history.get().is_none();
        history || (!metadata_only && shown.items.get().is_none())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document,human_on};
    #[test]
    fn missing_semantic_groups_do_not_starve_ready_cold_candidates() {
        let mut w=crate::cast::world();
        let mut entries=Vec::new();
        for n in 0..12 {
            entries.push(w.lab.create(w.mac_a,w.alice,w.alice,"note",&[],
                document(&format!("Note {n:02}"),"body",w.mac_a)).unwrap());
        }
        let group=w.lab.define_group(w.mac_a,w.alice,rules::CapGroup {
            name:"Readers".into(),caps:vec![rules::Cap{op:rules::Op::Read,slice:Selector::All}],includes:vec![],
        }).unwrap();
        // Make the first four candidates unclassifiable until their semantic
        // group arrives, while the remaining eight are independently usable.
        entries.sort();
        for entry in &entries[..4] {
            w.lab.issue_group(w.mac_a,&[w.mac_a],GroupShare {
                over:w.alice,who:Who::Vault(w.bob),name:"Readers".into(),
                select:crate::cast::by_id(*entry),group,level:Level::Read,parent:None,issuer:w.alice,
            }).unwrap();
        }
        let backup=w.lab.backup(w.mac_a);let count=backup.signed.len();
        let receipt=w.lab.warming(w.mac_a,count,Some([93;40])).unwrap();
        let warm=Warm{keys:receipt.keys.clone().into_iter().collect(),views:receipt.view.clone().into_iter().collect()};
        w.lab.warmed(w.mac_a,receipt);
        w.lab.restore_warm(w.mac_a,backup,Some(([93;40],count)),&warm);
        w.lab.stores.get_mut(&w.mac_a).unwrap().readings.groups=crate::policy::Groups::default();
        for entry in &entries[..4] {
            assert!(w.lab.meaning(w.mac_a,*entry).is_none());
            assert!(!w.lab.query_needs_hydration(w.mac_a,*entry),"missing semantic dependencies cannot progress by hydration");
        }
        let query=serde_json::json!({"op":"query","vault":w.alice.to_hex(),
            "where":{"type":["note"]},"depth":1,"select":[],"limit":1});
        let mut result=crate::engine::read(&w.lab,w.mac_a,&query);
        for _ in 0..16 {
            if result["ok"]["pageComplete"]==true {break;}
            result=crate::engine::read(&w.lab,w.mac_a,&query);
        }
        assert_eq!(result["ok"]["pageComplete"],true,"unavailable leading candidates cannot prevent other local hydration");
        assert_eq!(result["ok"]["readiness"]["deferredCandidates"],0);
        assert_eq!(result["ok"]["countExact"],false,"missing groups remain explicitly unresolved");
        assert_eq!(result["ok"]["count"],8);
        assert_eq!(result,crate::engine::full_query_oracle(&w.lab,w.mac_a,&query));
    }
    #[test]
    fn cold_query_count_yields_and_converges_to_exact_canonical_page() {
        let mut lab=Lab::new();
        let owner=lab.passkey("Cold query slices");
        let device=lab.device_of(owner,"Mac");
        let vault=human_on(&mut lab,owner,&[device]);
        let mut entries=Vec::new();
        for n in 0..16 {
            entries.push(lab.create(device,vault,vault,"note",&[],
                document(&format!("Note {n:02}"),"body",device)).unwrap());
        }
        // A non-default depth intentionally cannot use default-depth visibility
        // receipts; these candidates must actually be classified after restore.
        let queries = [
            serde_json::json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},
                "depth":1,"select":[],"limit":1,"offset":2}),
            serde_json::json!({"op":"query","vault":vault.to_hex(),"where":{"all":[{"type":["note"]},{"path":["title"],"eq":"Note 07"}]},
                "depth":1,"select":["title"],"limit":3,"order":[["created","desc"]]}),
        ];
        let expected:Vec<_>=queries.iter().map(|q|crate::engine::full_query_oracle(&lab,device,q)).collect();
        let backup=lab.backup(device); let count=backup.signed.len();
        let receipt=lab.warming(device,count,Some([91;40])).unwrap();
        assert!(receipt.view.is_some(),"fixture must retain the actual materialized warm view");
        let warm=Warm{keys:receipt.keys.clone().into_iter().collect(),views:receipt.view.clone().into_iter().collect()};
        lab.warmed(device,receipt);
        for (query,expected) in queries.into_iter().zip(expected) {
            // A successful warm save acknowledges the view. A second capture
            // without edits legitimately omits it; reuse the persisted image,
            // rather than constructing an empty on-disk fixture on iteration 2.
            lab.restore_warm(device,backup.clone(),Some(([91;40],count)),&warm);
            assert_eq!(entries.iter().filter(|e|lab.query_needs_hydration(device,**e)).count(),16);
            let first=crate::engine::read(&lab,device,&query);
            assert!(first["ok"]["readiness"]["deferredCandidates"].as_u64().unwrap()>0);
            assert_eq!(first["ok"]["countExact"],false);
            assert_eq!(first["ok"]["pageComplete"],false);
            let remaining=entries.iter().filter(|e|lab.query_needs_hydration(device,**e)).count();
            assert!((12..16).contains(&remaining),"one turn imports at least one and at most four cold candidates");
            let mut previous=remaining;
            let mut final_answer=first;
            for _ in 0..32 {
                if final_answer["ok"]["pageComplete"]==true { break; }
                final_answer=crate::engine::read(&lab,device,&query);
                let now=entries.iter().filter(|e|lab.query_needs_hydration(device,**e)).count();
                assert!(now<previous,"continuation must retain progress without a sync event");
                previous=now;
            }
            assert_eq!(final_answer,expected,"bounded query must converge to the exact canonical count and page");
        }
    }
}
