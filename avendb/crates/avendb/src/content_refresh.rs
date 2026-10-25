//! A settled owner content edit changes one item's judgment, not its key schedule.
use super::*;

impl Lab {
    pub(super) fn content_refresh_ready(&self, on: SignerId, edit: &Edit, body: &Body) -> bool {
        let Action::Write { entry, actor, vault, proposal: Proposal::Main, create: None, stay, epoch, files, .. } = &edit.action else { return false; };
        let store = self.held(on);
        let st = &store.replay.state;
        let Some(en) = st.entry(*entry) else { return false; };
        let Some(header) = store.readings.headers.get(&en.creation) else { return false; };
        // Partial/deferred reconstruction and governance always take the canonical full path.
        *actor == *vault && en.vault == *vault && st.acts_for(on, *vault) && !header.ty.of_lane() && !header.ty.is_cap_group()
            && body.files.is_empty() && files.is_empty()
            && store.keys.first(KeyName::Entry(*entry, *stay, *epoch)).is_some()
            && en.creator == *vault
            && st.entry_writes(*entry).all(|w| w.actor == *vault && w.proposal == Proposal::Main)
            && body.header.is_none() && body.tags.is_empty() && body.answers.is_empty() && body.defines.is_none()
            && !store.behind && !store.reshow && store.replayed == store.log.edits().len()
            && store.bare.is_empty() && store.bootstrap_bases.is_empty() && store.bootstrap_state.is_none()
            && store.deferred_bodies.is_empty() && store.warm_materialization.is_none()
            && store.opened.is_empty() && store.shown.contains_key(entry)
            && self.held_back.is_none()
    }

    pub(super) fn refresh_content(&mut self, on: SignerId, id: EditId) -> bool {
        let d = self.at(on);
        let store = self.stores.get_mut(&d).expect("a device");
        let start = Perf::start();
        let suffix = &store.log.edits()[store.replayed..];
        let [edit] = suffix else { return false; };
        if edit.id() != id { return false; }
        let Action::Write { entry, .. } = edit.action else { return false; };
        let was = std::mem::replace(&mut store.replay, replay(&[]));
        let (next, why) = replay_on_why(was, store.log.edits(), store.replayed);
        store.replay = next;
        store.replayed = store.log.edits().len();
        store.latest = OnceLock::from(store.replay.state.clone());
        store.perf.count(why_counted(why), 1);
        if !matches!(why, Why::Stepped) {
            store.wholes += matches!(why, Why::Whole(_)) as u64;
            store.reshow = true;
            return false;
        }
        let st = &store.replay.state;
        let Some(w) = st.write(id) else { store.reshow = true; return false; };
        let Some(en) = st.entry(entry) else { store.reshow = true; return false; };
        let Some(body) = store.bodies.get(&id) else { store.reshow = true; return false; };
        // Exactly the same metadata insertion as read(); every older body/selector is unchanged.
        store.readings.tags.insert(id, body.tags.clone());
        if let Some(proof) = &body.proof { store.readings.proofs.insert(id, proof.clone()); }
        let r = &store.readings;
        let blobs = st.lane_of(en.vault, r);
        let lane = Lane::with_built_ins(blobs.iter().copied());
        let old = store.shown.remove(&entry).expect("guarded settled item");
        let (count, last) = st.entry_tip(entry);
        let tip = Tip { writes: count, last, lane: old.tip.lane, groups: old.tip.groups };
        // A canonical tail append must extend the shown entry exactly once. Otherwise rebuild.
        if old.tip.writes + 1 != count || last != Some(id) {
            store.shown.insert(entry, old);
            store.reshow = true;
            return false;
        }
        old.items_in(Some(store));
        let history = old.history_in(store).expect("settled history").clone();
        let items = old.items.into_inner().expect("materialized above");
        let mut judging = Judging::resume(en, r, &lane, history, old.after);
        judging.judge(d, st, (r, &store.bodies), w, &r.groups);
        let mut hash = Hasher::new("lab shown");
        for write in st.entry_writes(entry) {
            hash.update(&write.edit.0).update(&[store.bodies.contains_key(&write.edit) as u8]);
        }
        hash.update(&tip.lane).update(&tip.groups);
        let shown = judging.shown_on(d, hash.finalize(), tip, Some(items));
        debug_assert!(same_shown_in(&shown, &judged_anew(d, st, (r, &store.bodies), &r.groups, en, &lane), Some(store)));
        store.shown.insert(entry, shown);
        // A changed admission/meaning must never suppress a steward mark. Foreign
        // asks/proposals are excluded above; any computed mark falls back here.
        if store.replay.state.meaning_landed(entry, &store.readings, landed_in(store, entry))
            .is_none_or(|meaning| meaning.mark.is_some()) {
            store.reshow = true;
            return false;
        }
        store.opened.remove(&entry);
        let writes = st.all_writes();
        store.shown_writes = (writes.len(), writes.last().map(|w| w.edit));
        store.scratched.insert(entry);
        while store.scratched.len() > SCRATCHES {
            let evict = *store.scratched.iter().find(|e| **e != entry).expect("another scratch");
            store.scratched.remove(&evict);
            if let Some(s) = store.shown.get_mut(&evict) { s.after.scratch = None; }
        }
        store.behind = false;
        store.perf.count("refresh: owner content only", 1);
        store.perf.add("refresh: owner content only", start);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{world, todos_on};
    use std::time::Instant;

    #[test]
    fn owner_content_refresh_matches_full_refresh_with_unrelated_history() {
        let mut w = world();
        let todos = todos_on(&mut w);
        for n in 0..96 {
            w.lab.create(w.mac_a, w.alice, w.alice, "todo", &[], Item::todo(&format!("unrelated {n}"), w.mac_a)).unwrap();
        }
        let d = w.mac_a;
        let baseline = w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0);
        let mut fast_us = 0;
        let mut canonical_us = 0;
        for n in 0..8 {
            let began = Instant::now();
            w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, &format!("Content {n}"))).unwrap();
            fast_us += began.elapsed().as_micros();
            let record = w.lab.item(d, todos.door).unwrap().record();
            let history = w.lab.history(d, todos.door).unwrap().changes().to_vec();
            let replay = w.lab.held(d).replay.clone();
            let groups = w.lab.held(d).readings.groups.clone();
            // Force the complete canonical rebuild, including full cap-group judgment/upkeep.
            w.lab.stores.get_mut(&d).unwrap().reshow = true;
            let began = Instant::now();
            w.lab.refresh(d, &[]);
            canonical_us += began.elapsed().as_micros();
            assert_eq!(w.lab.item(d, todos.door).unwrap().record(), record);
            assert_eq!(w.lab.history(d, todos.door).unwrap().changes(), history);
            assert!(w.lab.held(d).replay == replay);
            assert_eq!(w.lab.held(d).readings.groups, groups);
        }
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64(), Some(baseline + 8));
        eprintln!("eight owner writes including signatures: {fast_us}us; eight additional canonical refreshes: {canonical_us}us; debug build, not a device latency claim");
    }

    #[test]
    fn content_fast_path_rejects_pending_policy_and_metadata_changes() {
        let mut w = world();
        let todos = todos_on(&mut w);
        let id = w.lab.edit(w.mac_a, w.alice, todos.door, |item| item.set_text(1, "owner edit")).unwrap();
        let store = w.lab.held(w.mac_a);
        let edit = store.signed[&id].edit.clone();
        let mut body = store.bodies[&id].clone();
        assert!(w.lab.content_refresh_ready(w.mac_a, &edit, &body));
        body.answers.push(id);
        assert!(!w.lab.content_refresh_ready(w.mac_a, &edit, &body));
        body.answers.clear();
        w.lab.stores.get_mut(&w.mac_a).unwrap().behind = true;
        assert!(!w.lab.content_refresh_ready(w.mac_a, &edit, &body));
        w.lab.stores.get_mut(&w.mac_a).unwrap().behind = false;
        w.lab.stores.get_mut(&w.mac_a).unwrap().reshow = true;
        assert!(!w.lab.content_refresh_ready(w.mac_a, &edit, &body));
    }
    #[test]
    fn foreign_history_and_file_or_missing_key_take_full_refresh() {
        let mut w = world();
        let todos = todos_on(&mut w);
        let d = w.mac_a;
        let id = w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "owner edit")).unwrap();
        let edit = w.lab.held(d).signed[&id].edit.clone();
        let body = w.lab.held(d).bodies[&id].clone();
        let mut files = body.clone();
        files.files.push(Brought::new([7; 32], crate::sealed::FileKey::from_bytes([9; 32]), 37));
        assert!(!w.lab.content_refresh_ready(d, &edit, &files));
        let saved = std::mem::take(&mut w.lab.stores.get_mut(&d).unwrap().keys);
        assert!(!w.lab.content_refresh_ready(d, &edit, &body));
        w.lab.stores.get_mut(&d).unwrap().keys = saved;
        w.lab.sync_all(0);
        w.lab.edit(w.mac_b, w.bob, todos.door, |item| item.set_text(1, "foreign edit")).unwrap();
        w.lab.sync_all(0);
        assert!(!w.lab.content_refresh_ready(d, &edit, &body), "foreign history requires canonical steward pass");
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0);
        w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "owner after foreign edit")).unwrap();
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0), before);
    }

}
