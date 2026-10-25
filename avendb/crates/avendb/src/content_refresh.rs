//! Settled metadata-free content writes change one item's judgment, not the key schedule.
use super::*;

pub(super) struct ReceivedContentPrefix {
    held: usize,
    revision: crate::policy::LogRevision,
    id: EditId,
}

fn deferred_refresh_ready(store: &Store) -> bool {
    deferred_refresh_ready_at(store, &store.log.revision())
}

fn deferred_refresh_ready_at(store: &Store, revision: &crate::policy::LogRevision) -> bool {
    store.deferred_bodies.is_empty() || store.deferred_basis.as_ref()
        .is_some_and(|basis| basis.matches(revision))
}

impl Lab {
    pub(super) fn content_refresh_ready(&self, on: SignerId, edit: &Edit, body: &Body) -> bool {
        self.content_refresh_ready_at(on, on, edit, body, None)
    }

    fn content_refresh_ready_at(&self, on: SignerId, writer: SignerId, edit: &Edit, body: &Body,
        prefix: Option<&ReceivedContentPrefix>) -> bool {
        let Action::Write { entry, actor, vault, proposal: Proposal::Main, create: None, stay, epoch, files, .. } = &edit.action else { return false; };
        let store = self.held(on);
        let held = prefix.map_or(store.log.edits().len(), |prefix| prefix.held);
        let revision = prefix.map_or_else(|| store.log.revision(), |prefix| prefix.revision.clone());
        if prefix.is_some_and(|prefix| store.log.edits().len() != held+1
            || store.log.edits().get(held).is_none_or(|edit| edit.id() != prefix.id)) { return false; }
        let st = &store.replay.state;
        let metadata = |id: EditId| store.bodies.get(&id).or_else(|| {
            let deferred = store.deferred_bodies.get(&id)?;
            deferred.permits(&revision, store.body_key(id)?).ok()?;
            Some(deferred.metadata(&revision).ok()?.fields())
        });
        let Some(en) = st.entry(*entry) else { return false; };
        let Some(header) = store.readings.headers.get(&en.creation) else { return false; };
        // Governance and incomplete reconstruction always take the canonical full path.
        en.vault == *vault && st.acts_for(writer, *actor) && !header.ty.of_lane() && !header.ty.is_cap_group()
            && body.files.is_empty() && files.is_empty()
            && st.entry_key(*entry) == Some(KeyName::Entry(*entry, *stay, *epoch))
            && store.keys.first(KeyName::Entry(*entry, *stay, *epoch)).is_some()
            && en.creator == *vault
            && st.entry_writes(*entry).all(|w| w.proposal == Proposal::Main &&
                (w.actor == *vault || w.first || metadata(w.edit).is_some_and(|body| body.tags.is_empty())))
            && body.header.is_none() && body.tags.is_empty() && body.answers.is_empty() && body.defines.is_none()
            && !store.behind && !store.reshow && store.replayed == held
            && store.bare.is_empty() && store.bootstrap_bases.is_empty() && store.bootstrap_state.is_none()
            && store.bootstrap_active.is_empty() && store.bootstrap_pending.is_empty()
            && deferred_refresh_ready_at(store, &revision) && store.warm_materialization.is_none()
            && store.opened.is_empty() && store.shown.contains_key(entry) && store.shown_lanes.contains_key(vault)
            && self.held_back.is_none()
    }

    /// Capture a settled context before receive admission changes the held log.
    /// This is only a scheduling hint; the signature and current gate still run.
    pub(super) fn prepare_received_content(&self, on: SignerId, edits: &[Signed], no_blobs: bool) -> Option<ReceivedContentPrefix> {
        if !no_blobs || self.locked(self.at(on)) || self.held_back.is_some() { return None; }
        let [signed] = edits else { return None; };
        let Action::Write { entry, create: None, proposal: Proposal::Main, stay, epoch, .. } = signed.edit.action else { return None; };
        let store = self.held(on);
        let id = signed.edit.id();
        let st = &store.replay.state;
        let en = st.entry(entry)?;
        if store.behind || store.reshow || store.replayed != store.log.edits().len()
            || store.signed.contains_key(&id) || store.covers.contains(&id) || !store.bare.is_empty()
            || !st.entitled(self.at(on), KeyFam::Audience(en.vault, en.audience()))
            || st.entry_key(entry) != Some(KeyName::Entry(entry, stay, epoch)) { return None; }
        Some(ReceivedContentPrefix { held: store.replayed, revision: store.log.revision(), id })
    }

    /// Called only after ordinary take_prepared admitted the new signature and gate.
    pub(super) fn refresh_received_content(&mut self, on: SignerId, prefix: ReceivedContentPrefix) -> bool {
        let decoded = {
            let store = self.held(on);
            let Some(signed) = store.signed.get(&prefix.id) else { return false; };
            let Action::Write { entry, body, .. } = &signed.edit.action else { return false; };
            let Some(key) = store.body_key(prefix.id) else { return false; };
            let Some(plain) = keys::open_edit(key, body, &write_context(&signed.edit)) else { return false; };
            let Ok(body) = Body::from_wire(&plain) else { return false; };
            if !self.content_refresh_ready_at(on, signed.edit.author, &signed.edit, &body, Some(&prefix)) { return false; }
            (*entry, body)
        };
        let store = self.stores.get_mut(&self.at(on)).expect("receiving device");
        store.bodies.insert(prefix.id, decoded.1);
        store.opened.entry(decoded.0).or_default().push(prefix.id);
        store.files_at = OnceLock::new();
        let applied = self.refresh_content(on, prefix.id, Some(&prefix.revision));
        if applied { self.stores.get_mut(&self.at(on)).expect("device").perf.count("refresh: received content only", 1); }
        applied
    }

    pub(super) fn creation_refresh_ready(&self, on: SignerId, edit: &Edit, body: &Body) -> bool {
        let Action::Write { entry, actor, vault, proposal: Proposal::Main, create: Some(creation), stay: None, epoch, files, .. } = &edit.action else { return false; };
        let Some(header) = &body.header else { return false; };
        let store = self.held(on);
        let st = &store.replay.state;
        let audience = AudienceId::of(*vault, &creation.audience);
        let family = KeyFam::Audience(*vault, audience);
        // No new epoch/family: only a fresh entry key derived from an already held audience key.
        *actor == *vault && st.acts_for(on, *vault) && st.entry(*entry).is_none()
            && !header.ty.of_lane() && !header.ty.is_cap_group()
            && !st.reenters(*vault, audience) && *epoch == st.epoch(family)
            && store.keys.first(KeyName::Scoped(family, *epoch)).is_some()
            && store.shown_lanes.contains_key(vault)
            && body.answers.is_empty() && body.defines.is_none() && body.files.is_empty() && files.is_empty()
            && !store.behind && !store.reshow && store.replayed == store.log.edits().len()
            && store.bare.is_empty() && store.bootstrap_bases.is_empty() && store.bootstrap_state.is_none()
            && store.bootstrap_active.is_empty() && store.bootstrap_pending.is_empty()
            && deferred_refresh_ready(store) && store.warm_materialization.is_none()
            && store.opened.is_empty() && self.held_back.is_none()
    }

    pub(super) fn refresh_content(&mut self, on: SignerId, id: EditId, before: Option<&crate::policy::LogRevision>) -> bool {
        let d = self.at(on);
        let store = self.stores.get_mut(&d).expect("a device");
        let start = Perf::start();
        let suffix = &store.log.edits()[store.replayed..];
        let [edit] = suffix else { return false; };
        if edit.id() != id { return false; }
        let Action::Write { entry, ref create, .. } = edit.action else { return false; };
        let creating = create.is_some();
        let prior = store.replay.state.clone();
        let incoming = edit.clone();
        let was = std::mem::replace(&mut store.replay, replay(&[]));
        let (next, why) = replay_on_why(was, store.log.edits(), store.replayed);
        store.replay = next;
        store.replayed = store.log.edits().len();
        store.latest = OnceLock::from(store.replay.state.clone());
        store.perf.count(why_counted(why), 1);
        let equivalent_tail = matches!(why, Why::Tail) && prior.step(&incoming).is_ok_and(|expected|
            expected.same_entry_histories_and_context(&store.replay.state, id));
        if !matches!(why, Why::Stepped) && !equivalent_tail {
            store.wholes += matches!(why, Why::Whole(_)) as u64;
            store.reshow = true;
            return false;
        }
        if equivalent_tail { store.perf.count("refresh: equivalent content tail", 1); }
        // Strict or context-equivalent tail replay plus the unchanged key/authority guards preserve
        // old immutable bodies. Advance their shared exact basis once, without
        // visiting unrelated histories. Every demand still checks basis and key.
        if let Some(basis) = &store.deferred_basis {
            if !before.is_some_and(|before| basis.advance_content_append(before, store.log.revision())) { store.reshow=true; return false; }
            store.perf.count("refresh: deferred context retained", 1);
        }
        let reuse_scratch = store.shown.get(&entry).is_some_and(|shown| {
            !shown.history_bodies.is_empty()
                && store.replay.state.write(id).is_some_and(|write|
                    shown.scratch_in(store).is_some_and(|scratch|
                        scratch.resumes_complete_main(&shown.history, write)))
                && shown.history_bodies.iter().all(|id| store.deferred_authorized(*id))
        });
        let target: Vec<_> = store.replay.state.entry_writes(entry).map(|w| w.edit)
            .filter(|id| !reuse_scratch && store.deferred_bodies.contains_key(id)).collect();
        if target.iter().any(|id| Arc::strong_count(&store.deferred_bodies[id]) != 1
            || Arc::weak_count(&store.deferred_bodies[id]) != 0 || store.demanded_body(*id).is_none()) {
            store.reshow = true; return false;
        }
        for id in target {
            let key = store.body_key(id).expect("validated current key").clone();
            let receipt = store.deferred_bodies.remove(&id).expect("selected deferred body");
            let Ok(receipt) = Arc::try_unwrap(receipt) else { unreachable!("guarded exclusive receipt") };
            let body = receipt.into_opened(&store.log.revision(), &key).expect("validated plaintext");
            store.bodies.insert(id, body);
        }
        if store.deferred_bodies.is_empty() { store.deferred_basis = None; }
        let st = &store.replay.state;
        let Some(w) = st.write(id) else { store.reshow = true; return false; };
        let Some(en) = st.entry(entry) else { store.reshow = true; return false; };
        let Some(body) = store.bodies.get(&id) else { store.reshow = true; return false; };
        // Exactly the same metadata insertion as read(); every older body/selector is unchanged.
        if let Some(header) = &body.header { store.readings.headers.insert(id, header.clone()); }
        store.readings.tags.insert(id, body.tags.clone());
        if let Some(proof) = &body.proof { store.readings.proofs.insert(id, proof.clone()); }
        let r = &store.readings;
        let blobs = st.lane_of(en.vault, r);
        let lane = Lane::with_built_ins(blobs.iter().copied());
        let old = store.shown.remove(&entry);
        let (count, last) = st.entry_tip(entry);
        let tip = Tip { writes: count, last, lane: store.shown_lanes[&en.vault].0, groups: store.shown_groups };
        let mut history_bodies = Vec::new();
        let (mut judging, items) = match old {
            Some(old) if !creating && old.tip.writes + 1 == count && last == Some(id) => {
                old.items_in(Some(store));
                if !reuse_scratch { old.history_in(store).expect("settled history"); }
                // We own the previous showing: move its history rather than copying
                // every historical content buffer on each message/row mutation.
                if reuse_scratch { history_bodies = old.history_bodies.clone(); }
                let history = if old.history_bodies.is_empty() || reuse_scratch { old.history }
                    else { old.hydrated_history.into_inner().flatten().expect("hydrated above") };
                let items = old.items.into_inner().expect("materialized above");
                (Judging::resume(en, r, &lane, history, old.after), Some(items))
            }
            None if creating && count == 1 && last == Some(id) => (Judging::new(st, en, r, &lane), None),
            other => {
                if let Some(old) = other { store.shown.insert(entry, old); }
                store.reshow = true;
                return false;
            }
        };
        judging.judge(d, st, (r, &store.bodies), w, &r.groups);
        let mut hash = Hasher::new("lab shown");
        for write in st.entry_writes(entry) {
            // Match show_items' authenticated availability fingerprint. Deferred
            // metadata is retained valid state, not an absent body; hashing it as
            // absent would reject the next saved receipt and force full replay.
            hash.update(&write.edit.0).update(&[(store.bodies.contains_key(&write.edit)
                || store.deferred_bodies.contains_key(&write.edit)) as u8]);
        }
        hash.update(&tip.lane).update(&tip.groups);
        let mut shown = judging.shown_on(d, hash.finalize(), tip, items);
        shown.history_bodies = history_bodies;
        if reuse_scratch { store.perf.count("refresh: warm scratch resumed", 1); }
        // A full-body differential comparison is performed by regression tests
        // after measurement. Doing it here would decrypt the deliberately omitted
        // history on every debug-build append and judge absent bodies as missing.
        if shown.history_bodies.is_empty() {
            debug_assert!(same_shown_in(&shown, &judged_anew(d, st, (r, &store.bodies), &r.groups, en, &lane), Some(store)));
        }
        store.shown.insert(entry, shown);
        // A changed admission/meaning must never suppress a steward mark. Foreign
        // asks/proposals are excluded above; any computed mark falls back here.
        if store.replay.state.meaning_landed(entry, &store.readings, landed_in(store, entry))
            .is_none_or(|meaning| meaning.mark.is_some_and(|(caps, wants)|
                // Match upkeep -> steward exactly: a partial reader cannot issue
                // a mark on another vault's behalf. A legal mark still falls back.
                st.acts_for(d, en.vault) && store.reads_shares(st, en.vault)
                    && (caps.is_some() || (wants.is_some() && store.reads_keeps(st, en.vault))))) {
            store.perf.count("refresh: content stewardship fallback", 1);
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
            if let Some(s) = store.shown.get_mut(&evict) { s.after.clear_scratch(); }
        }
        store.behind = false;
        if creating { store.perf.count("refresh: owner creation", 1); }
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
    fn received_content_is_visible_before_batch_catchup_and_matches_full_refresh() {
        let mut w = world();
        let todos = todos_on(&mut w);
        w.lab.sync_all(0);
        let d = w.mac_b;
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: received content only"].as_u64().unwrap_or(0);
        assert!(!w.lab.held(d).replay.state.acts_for(d, w.alice), "fixture must be a reader, not Alice's steward");
        for n in 0..4 {
            let id = w.lab.edit(w.mac_a, w.alice, todos.door, |item| item.set_text(1, &format!("remote {n}"))).unwrap();
            let signed = w.lab.signed_edit(w.mac_a, id).unwrap().clone();
            assert!(w.lab.prepare_received_content(d, std::slice::from_ref(&signed), true).is_some(), "settled currently entitled receiver must capture a tail");
            let checked = w.lab.prepare_receive(d, vec![signed]).check();
            assert_eq!(w.lab.receive_prepared(d, checked, false).0, 1);
            assert!(!w.lab.held(d).behind, "an eligible verified tail is visible before catch_up: {}", w.lab.held(d).perf.to_json());
            assert_eq!(w.lab.item(d, todos.door).unwrap().record(), w.lab.item(w.mac_a, todos.door).unwrap().record());
            let record = w.lab.item(d, todos.door).unwrap().record();
            let history = w.lab.history(d, todos.door).unwrap().changes().to_vec();
            let signed_count = w.lab.size(d).0;
            w.lab.stores.get_mut(&d).unwrap().reshow = true;
            w.lab.refresh(d, &[]);
            assert_eq!(w.lab.item(d, todos.door).unwrap().record(), record);
            assert_eq!(w.lab.history(d, todos.door).unwrap().changes(), history);
            assert_eq!(w.lab.size(d).0, signed_count, "no stewardship was omitted");
        }
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: received content only"].as_u64(), Some(before+4));
    }

    #[test]
    fn received_content_ignores_unrelated_private_history_depth() {
        let mut w = world();
        let todos = todos_on(&mut w);
        w.lab.sync_all(0);
        let d = w.mac_b;
        let private = w.lab.create(d, w.bob, w.bob, "todo", &[], Item::todo("Bob private", d)).unwrap();
        for n in 0..8 {
            w.lab.edit(d, w.bob, private, |item| item.set_text(1, &format!("private {n}"))).unwrap();
        }
        let private_record = w.lab.item(d, private).unwrap().record();
        let private_history = w.lab.history(d, private).unwrap().changes().to_vec();
        let id = w.lab.edit(w.mac_a, w.alice, todos.door, |item| item.set_text(1, "live while Bob is busy")).unwrap();
        let signed = w.lab.signed_edit(w.mac_a, id).unwrap().clone();
        assert!(w.lab.log(d).edits().iter().any(|e| e.depth >= signed.edit.depth), "fixture must force bounded Tail replay");
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: equivalent content tail"].as_u64().unwrap_or(0);
        let checked = w.lab.prepare_receive(d, vec![signed]).check();
        assert_eq!(w.lab.receive_prepared(d, checked, false).0, 1);
        assert!(!w.lab.held(d).behind, "unrelated private history must not force global refresh");
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: equivalent content tail"].as_u64(), Some(before+1));
        let record = w.lab.item(d, todos.door).unwrap().record();
        assert_eq!(record, w.lab.item(w.mac_a, todos.door).unwrap().record());
        let history = w.lab.history(d, todos.door).unwrap().changes().to_vec();
        let count = w.lab.size(d).0;
        w.lab.stores.get_mut(&d).unwrap().reshow = true;
        w.lab.refresh(d, &[]);
        assert_eq!(w.lab.item(d, todos.door).unwrap().record(), record);
        assert_eq!(w.lab.history(d, todos.door).unwrap().changes(), history);
        assert_eq!(w.lab.item(d, private).unwrap().record(), private_record);
        assert_eq!(w.lab.history(d, private).unwrap().changes(), private_history);
        assert_eq!(w.lab.size(d).0, count);
    }

    #[test]
    fn received_content_refuses_bad_signature_and_keeps_multi_edit_batching() {
        let mut w = world();
        let todos = todos_on(&mut w);
        w.lab.sync_all(0);
        let d = w.mac_b;
        let first = w.lab.edit(w.mac_a, w.alice, todos.door, |item| item.set_text(1, "first")).unwrap();
        let first = w.lab.signed_edit(w.mac_a, first).unwrap().clone();
        let mut invalid = first.clone();
        invalid.sigs[0].pq[0] ^= 1;
        let record = w.lab.item(d, todos.door).unwrap().record();
        let checked = w.lab.prepare_receive(d, vec![invalid]).check();
        assert_eq!(w.lab.receive_prepared(d, checked, false).0, 0);
        assert_eq!(w.lab.item(d, todos.door).unwrap().record(), record);
        assert!(!w.lab.held(d).bodies.contains_key(&first.edit.id()));
        let second = w.lab.edit(w.mac_a, w.alice, todos.door, |item| item.set_text(1, "second")).unwrap();
        let second = w.lab.signed_edit(w.mac_a, second).unwrap().clone();
        let checked = w.lab.prepare_receive(d, vec![first, second]).check();
        assert_eq!(w.lab.receive_prepared(d, checked, false).0, 2);
        assert!(w.lab.held(d).behind, "ordinary multi-edit catch-up retains its batching");
        assert!(w.lab.catch_up(d));
        assert_eq!(w.lab.item(d, todos.door).unwrap().record(), w.lab.item(w.mac_a, todos.door).unwrap().record());
    }

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
        let mut stale = edit.clone();
        if let Action::Write { entry, stay, epoch, .. } = &mut stale.action {
            *epoch += 1;
            w.lab.stores.get_mut(&w.mac_a).unwrap().keys.insert(KeyName::Entry(*entry, *stay, *epoch), Secret::from_bytes([91;32]));
        }
        assert!(!w.lab.content_refresh_ready(w.mac_a, &stale, &body), "a held key is not enough: the current stay/epoch must match");
        w.lab.stores.get_mut(&w.mac_a).unwrap().behind = true;
        assert!(!w.lab.content_refresh_ready(w.mac_a, &edit, &body));
        w.lab.stores.get_mut(&w.mac_a).unwrap().behind = false;
        w.lab.stores.get_mut(&w.mac_a).unwrap().reshow = true;
        assert!(!w.lab.content_refresh_ready(w.mac_a, &edit, &body));
    }
    #[test]
    fn shared_content_is_incremental_but_files_keys_and_tag_asks_are_not() {
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
        assert!(w.lab.content_refresh_ready(d, &edit, &body), "ordinary shared content has no pending tag asks");
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0);
        w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "owner after foreign edit")).unwrap();
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0), before+1);
        let record = w.lab.item(d, todos.door).unwrap().record();
        let history = w.lab.history(d, todos.door).unwrap().changes().to_vec();
        w.lab.stores.get_mut(&d).unwrap().reshow = true;
        w.lab.refresh(d, &[]);
        assert_eq!(w.lab.item(d, todos.door).unwrap().record(), record);
        assert_eq!(w.lab.history(d, todos.door).unwrap().changes(), history);
        w.lab.sync_all(0);
        w.lab.tag(w.mac_b, w.bob, todos.door, &["urgent"], &[]).unwrap();
        w.lab.sync_all(0);
        assert!(!w.lab.content_refresh_ready(d, &edit, &body), "foreign tag asks always retain canonical stewardship");
        w.lab.submit(d, &[d], Action::Revoke(crate::policy::Revoking::Grant {
            share: todos.bob_write, actor: w.alice, keep: vec![], via: vec![],
        })).unwrap();
        w.lab.sync_all(0);
        assert!(w.lab.edit(w.mac_b, w.bob, todos.door, |item| item.set_text(1, "revoked edit")).is_err(),
            "the incremental path never bypasses current write authorization");
    }

    #[test]
    fn owner_creation_in_existing_audience_matches_full_refresh() {
        let mut w = world();
        todos_on(&mut w);
        let d = w.mac_a;
        for n in 0..128 {
            let unrelated = w.lab.create(d, w.alice, w.alice, "todo", &[], Item::todo(&format!("unrelated {n}"), d)).unwrap();
            for revision in 0..8 {
                w.lab.edit(d, w.alice, unrelated, |item| item.set_text(1, &format!("unrelated {n} revision {revision}"))).unwrap();
            }
        }
        eprintln!("creation differential fixture: {} signed edits", w.lab.held(d).log.edits().len());
        let baseline = w.lab.held(d).perf.to_json()["counts"]["refresh: owner creation"].as_u64().unwrap_or(0);
        let mut local_us = 0;
        let mut canonical_us = 0;
        for n in 0..8 {
            let start = Instant::now();
            let entry = w.lab.create(d, w.alice, w.alice, "todo", &[], Item::todo(&format!("new record {n}"), d)).unwrap();
            local_us += start.elapsed().as_micros();
            let record = w.lab.item(d, entry).unwrap().record();
            let history = w.lab.history(d, entry).unwrap().changes().to_vec();
            let count = w.lab.held(d).log.edits().len();
            w.lab.stores.get_mut(&d).unwrap().reshow = true;
            let start = Instant::now();
            w.lab.refresh(d, &[]);
            canonical_us += start.elapsed().as_micros();
            assert_eq!(w.lab.item(d, entry).unwrap().record(), record);
            assert_eq!(w.lab.history(d, entry).unwrap().changes(), history);
            assert_eq!(w.lab.held(d).log.edits().len(), count, "no skipped key publication or steward work");
        }
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: owner creation"].as_u64(), Some(baseline + 8));
        eprintln!("eight complete owner creations: {local_us}us; eight additional canonical refreshes: {canonical_us}us");
        let backup = w.lab.backup(d);
        let count = backup.signed.len();
        let marker = [74;40];
        let saved = w.lab.capture_warm_current(d, count, Some(marker)).unwrap().encode();
        let warm = Warm { keys: saved.keys.clone().into_iter().collect(), views: saved.view.clone().into_iter().collect() };
        w.lab.warmed(d, saved);
        w.lab.restore_warm(d, backup, Some((marker, count)), &warm);
        let deferred = w.lab.held(d).deferred_bodies.len();
        assert!(deferred > 512, "exercise a large unrelated warm history");
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: owner creation"].as_u64().unwrap_or(0);
        let start = Instant::now();
        let entry = w.lab.create(d, w.alice, w.alice, "todo", &[], Item::todo("warm new entry", d)).unwrap();
        eprintln!("warm creation with {deferred} deferred historical bodies: {}us", start.elapsed().as_micros());
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: owner creation"].as_u64(), Some(before+1));
        assert_eq!(w.lab.held(d).deferred_bodies.len(), deferred);
        assert!(w.lab.held(d).deferred_bodies.values().all(|body| !body.content_ready()), "creation opens no unrelated history");
        let record = w.lab.item(d, entry).unwrap().record();
        w.lab.restore_from(d, w.lab.backup(d));
        assert_eq!(w.lab.item(d, entry).unwrap().record(), record);
    }

    #[test]
    fn reopened_deferred_store_retains_unrelated_lazy_bodies() {
        let mut w = world();
        let todos = todos_on(&mut w);
        let d = w.mac_a;
        w.lab.restore_from(d, w.lab.backup(d));
        let backup = w.lab.backup(d);
        let count = backup.signed.len();
        let marker = [73; 40];
        let saved = w.lab.warming(d, count, Some(marker)).unwrap();
        let warm = Warm { keys: saved.keys.clone().into_iter().collect(), views: saved.view.clone().into_iter().collect() };
        w.lab.warmed(d, saved);
        w.lab.restore_warm(d, backup, Some((marker, count)), &warm);
        let deferred = w.lab.held(d).deferred_bodies.len();
        assert!(deferred > 0, "fixture must exercise actual deferred warm bodies");
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0);
        w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "after reopen")).unwrap();
        let after = w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0);
        assert_eq!(after, before + 1, "a warm ordinary edit takes the same incremental path");
        assert!(!w.lab.held(d).deferred_bodies.is_empty(), "unrelated warm bodies stay deferred");
        assert!(w.lab.held(d).deferred_bodies.values().all(|body| !body.content_ready()), "no unrelated decode");
        eprintln!("warm-reopen deferred bodies={deferred}, fast-path hits={}", after-before);
    }

    #[test]
    fn owner_creation_with_new_selector_audience_runs_stewardship() {
        let mut w = world();
        todos_on(&mut w);
        let d = w.mac_a;
        w.lab.issue(d, &[d], crate::cast::share(w.alice, crate::cast::vault(w.bob), Level::Read,
            crate::cast::tagged("todo", "new-audience"))).unwrap();
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: content stewardship fallback"].as_u64().unwrap_or(0);
        let entry = w.lab.create_in(d, w.alice, w.alice, vec![], "todo", &["new-audience"], Item::todo("new audience", d)).unwrap();
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: content stewardship fallback"].as_u64(), Some(before+1));
        assert!(w.lab.meaning(d, entry).unwrap().mark.is_none(), "full refresh completes the required mark");
        assert!(w.lab.held(d).replay.state.entry(entry).unwrap().stay().is_some(), "a real signed audience move was retained");
        assert!(w.lab.held(d).replay.state.acts_for(d, w.alice));
        assert!(w.lab.held(d).reads_shares(&w.lab.held(d).replay.state, w.alice));
        let record = w.lab.item(d, entry).unwrap().record();
        let history = w.lab.history(d, entry).unwrap().changes().to_vec();
        let signed = w.lab.size(d).0;
        w.lab.stores.get_mut(&d).unwrap().reshow = true;
        w.lab.refresh(d, &[]);
        assert_eq!(w.lab.item(d, entry).unwrap().record(), record);
        assert_eq!(w.lab.history(d, entry).unwrap().changes(), history);
        assert_eq!(w.lab.size(d).0, signed, "required stewardship was completed exactly once");
    }

    #[test]
    fn ordinary_reference_does_not_change_groups_but_group_redefinition_does() {
        let mut w = world();
        let todos = todos_on(&mut w);
        let d = w.mac_a;
        let group = rules::CapGroup { name: "Scoped".into(),
            caps: vec![rules::Cap { op: rules::Op::Read, slice: crate::cast::by_id(todos.door) }],
            includes: vec![todos.door] };
        let id = w.lab.define_group(d, w.alice, group.clone()).unwrap();
        let groups = w.lab.held(d).readings.groups.clone();
        w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "ordinary referenced content")).unwrap();
        assert_eq!(w.lab.held(d).readings.groups, groups);
        w.lab.stores.get_mut(&d).unwrap().reshow = true;
        w.lab.refresh(d, &[]);
        assert_eq!(w.lab.held(d).readings.groups, groups, "group includes never reads ordinary entry payloads");
        let before = w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0);
        let narrow = rules::CapGroup { caps: vec![], ..group };
        w.lab.redefine_group(d, w.alice, id, narrow.clone()).unwrap();
        assert_eq!(w.lab.held(d).perf.to_json()["counts"]["refresh: owner content only"].as_u64().unwrap_or(0), before);
        assert_eq!(w.lab.group(d, w.alice, id), Some(&narrow));
        w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "after policy change")).unwrap();
        let actual = w.lab.held(d).readings.groups.clone();
        w.lab.stores.get_mut(&d).unwrap().reshow = true;
        w.lab.refresh(d, &[]);
        assert_eq!(w.lab.held(d).readings.groups, actual);
    }

}
