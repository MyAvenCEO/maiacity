//! A scheduling hint only; ordinary query authorization still runs on each turn.
use super::*;
impl Lab {
    /// Inspect lazy cells without importing snapshots or opening deferred bodies.
    /// The query may defer this candidate, but cannot treat this hint as visibility.
    pub(crate) fn query_needs_hydration(&self, d: SignerId, entry: EntryId) -> bool {
        if !self.sees(d, entry) { return false; }
        let store=self.held(d);
        let Some(shown)=store.shown.get(&entry) else { return false; };
        shown.items.get().is_none()
            || (store.view().is_draft(entry) && !shown.history_bodies.is_empty()
                && shown.hydrated_history.get().is_none())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document,human_on};
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
        for query in [
            serde_json::json!({"op":"query","vault":vault.to_hex(),"where":{"type":["note"]},
                "depth":1,"select":[],"limit":1,"offset":2}),
            serde_json::json!({"op":"query","vault":vault.to_hex(),"where":{"all":[{"type":["note"]},{"path":["title"],"eq":"Note 07"}]},
                "depth":1,"select":["title"],"limit":3,"order":[["created","desc"]]}),
        ] {
            let expected=crate::engine::full_query_oracle(&lab,device,&query);
            let backup=lab.backup(device); let count=backup.signed.len();
            let receipt=lab.warming(device,count,Some([91;40])).unwrap();
            let warm=Warm{keys:receipt.keys.clone().into_iter().collect(),views:receipt.view.clone().into_iter().collect()};
            lab.warmed(device,receipt);
            lab.restore_warm(device,backup,Some(([91;40],count)),&warm);
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
