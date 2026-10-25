//! Node-only canonical judgment continuations. Standalone Lab stays synchronous.
use super::*;
pub(super) const BATCH: usize = 32;
const ACTIVE_ENTRIES: usize = 4;

pub(super) struct Pending {
    history: History,
    after: After,
    lane: Arc<Lane>,
    print: [u8; 32],
    tip: Tip,
    next: usize,
    log: crate::policy::LogRevision,
    keys: Arc<()>,
    generation: Arc<()>,
}
impl Pending {
    pub(super) fn new(j: Judging<'_>, lane: Arc<Lane>, print: [u8;32], tip: Tip,
        log: crate::policy::LogRevision, keys: Arc<()>, generation: Arc<()>) -> Self {
        let (history, after) = suspend(j);
        Self { history, after, lane, print, tip, next: 0, log, keys, generation }
    }
    pub(super) fn generations_current(&self, keys: &Arc<()>, generation: &Arc<()>) -> bool {
        Arc::ptr_eq(&self.keys, keys) && Arc::ptr_eq(&self.generation, generation)
    }
    pub(super) fn current(&self, log: &crate::policy::LogRevision, keys: &Arc<()>, generation: &Arc<()>) -> bool {
        self.log == *log && self.generations_current(keys, generation)
    }
    // Called only by show_items after recomputing the canonical entry's inputs.
    // An unchanged owner-only MAIN judgment has no share-policy dependency.
    pub(super) fn rebind(&mut self, log: crate::policy::LogRevision, print: [u8; 32],
        tip: Tip, keys: &Arc<()>, generation: &Arc<()>, owner_only: bool) -> bool {
        if !owner_only || self.print != print || self.tip != tip || !self.generations_current(keys, generation) {
            return false;
        }
        self.log = log;
        true
    }
}
fn suspend(j: Judging<'_>) -> (History, After) {
    let Judging { history, scratch, attrs, mine, imported, asked, .. } = j;
    (history, After { scratch, attrs, mine, imported, asked })
}
impl Lab {
    /// Scheduling only. This never changes what signed edits or bodies authorize.
    pub fn enable_staged_materialization(&mut self, on: SignerId) {
        let at = self.at(on);
        self.stores.get_mut(&at).expect("known device").staged_mode = true;
    }
    pub fn materializations_pending(&self, on: SignerId) -> bool {
        !self.locked(on) && !self.held(on).staged.is_empty()
    }
    pub fn materialization_pending(&self, on: SignerId, entry: EntryId) -> bool {
        if self.locked(on) || !self.sees(on, entry) { return false; }
        let store = self.held(on);
        if !store.staged.contains_key(&entry) { return false; }
        let st = store.view();
        let Some(en) = st.entry(entry) else { return false; };
        let audience = KeyFam::Audience(en.vault, en.audience());
        st.public_key(audience) || st.entitled(on, audience)
    }
    pub(super) fn require_materialized(&self, on: SignerId, entry: EntryId) -> Result<(), Refusal> {
        if !self.held(on).staged.contains_key(&entry) { return Ok(()); }
        Err(if self.materialization_pending(on, entry) { Refusal::Materializing } else { Refusal::NotAllowed })
    }
    /// One fair entry turn, at most BATCH ordinary canonical judgments. Final
    /// Loro item construction is still atomic; this is not a wall-time bound.
    pub fn advance_materialization(&mut self, on: SignerId) -> bool {
        let at = self.at(on);
        if self.locked(at) { return false; }
        self.catch_up(at);
        let store = self.stores.get_mut(&at).expect("known device");
        // Queued entries own no Scratch until selected. Bound concurrent partial
        // documents instead of retaining one materialized prefix for every log.
        let room = store.staged.values().filter(|p| p.next > 0).count() < ACTIVE_ENTRIES;
        let runnable = |p: &Pending| room || p.next > 0;
        let entry = store.staged.iter().find(|(e, p)| runnable(p) && store.staged_cursor.is_none_or(|c| **e > c))
            .or_else(|| store.staged.iter().find(|(_, p)| runnable(p))).map(|(e, _)| *e);
        let Some(entry) = entry else { return false; };
        store.staged_cursor = Some(entry);
        let mut p = store.staged.remove(&entry).expect("selected pending entry");
        if !p.current(&store.log.revision(), &store.keys.revision, &store.materialization_revision) {
            store.staged.clear();
            store.reshow = true;
            show_items(at, store);
            return !store.staged.is_empty();
        }
        let st = &store.replay.state;
        let Some(en) = st.entry(entry) else { return !store.staged.is_empty(); };
        let mut j = Judging::resume(en, &store.readings, &p.lane, p.history, p.after);
        let end = (p.next + BATCH).min(p.tip.writes);
        for w in st.entry_writes(entry).skip(p.next).take(end - p.next) {
            j.judge(at, st, (&store.readings, &store.bodies), w, &store.readings.groups);
        }
        let finished = end == p.tip.writes;
        if finished {
            let shown = j.shown_on(at, p.print, p.tip, None);
            debug_assert!(same_shown_in(&shown, &judged_anew(at, st,
                (&store.readings, &store.bodies), &store.readings.groups, en, &p.lane), Some(store)));
            store.shown.insert(entry, shown);
        } else {
            (p.history, p.after) = suspend(j);
            p.next = end;
            store.staged.insert(entry, p);
        }
        let pending = !store.staged.is_empty();
        // A completed entry may now justify steward marks that were withheld
        // while its counted history was unavailable. Canonical upkeep still owns them.
        if finished { self.refresh(at, &[]); }
        pending || self.materializations_pending(at)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cast::{document, human_on};

    #[test]
    fn staged_main_is_hidden_retryable_and_canonically_identical() {
        let mut lab = Lab::new();
        let owner = lab.passkey("staged owner");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        lab.sync(mac, phone);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Title", "start", mac)).unwrap();
        for n in 0..96 { lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
        lab.enable_staged_materialization(phone);
        lab.sync(mac, phone);
        assert!(lab.materialization_pending(phone, entry));
        assert!(lab.item(phone, entry).is_none(), "no partial authoritative item");
        let before = lab.backup(phone).signed().len();
        assert_eq!(lab.edit(phone, vault, entry, |i| i.set_text(2, "must not commit")), Err(Refusal::Materializing));
        assert_eq!(lab.backup(phone).signed().len(), before);
        let get = crate::engine::read(&lab, phone, &serde_json::json!({"op":"get","entry":entry.to_hex()}));
        assert_eq!(get["refused"], "Materializing");
        assert_eq!(get["retryable"], true);
        lab.advance_materialization(phone);
        assert_eq!(lab.held(phone).staged[&entry].next, BATCH);
        // An unrelated local write remains permitted and invalidates stale staging.
        let other = lab.create(phone, vault, vault, "note", &[], document("Other", "visible now", phone)).unwrap();
        assert!(lab.item(phone, other).is_some());
        assert_eq!(lab.held(phone).staged[&entry].next, 0);
        for _ in 0..8 { if !lab.materializations_pending(phone) { break; } lab.advance_materialization(phone); }
        assert!(!lab.materializations_pending(phone));
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
        lab.edit(phone, vault, entry, |i| i.set_text(2, "local now")).unwrap();
        assert!(!lab.materialization_pending(phone, entry), "incremental local publication is synchronous");
    }

    #[test]
    fn staged_prefix_survives_sustained_unrelated_owner_writes() {
        let mut lab = Lab::new();
        let owner = lab.passkey("unrelated live traffic");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let other = lab.create(mac, vault, vault, "note", &[], document("Live", "start", mac)).unwrap();
        lab.sync(mac, phone);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Cold", "start", mac)).unwrap();
        for n in 0..120 { lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
        lab.enable_staged_materialization(phone);
        lab.sync(mac, phone);
        assert!(lab.materialization_pending(phone, entry));
        for turn in 0..8 {
            if !lab.materialization_pending(phone, entry) { break; }
            let before = lab.held(phone).staged[&entry].next;
            lab.edit(mac, vault, other, |i| i.set_text(2, &format!("live {turn}"))).unwrap();
            lab.sync(mac, phone);
            assert_eq!(lab.held(phone).staged[&entry].next, before,
                "unrelated live edits must not erase a validated prefix");
            lab.advance_materialization(phone);
            if let Some(p) = lab.held(phone).staged.get(&entry) { assert!(p.next > before); }
        }
        assert!(!lab.materialization_pending(phone, entry));
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
    }

    #[test]
    fn successful_save_acknowledgements_do_not_restart_reconstruction() {
        let mut lab = Lab::new();
        let owner = lab.passkey("save during catchup");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let other = lab.create(mac, vault, vault, "note", &[], document("Live", "start", mac)).unwrap();
        lab.sync(mac, phone);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Cold", "start", mac)).unwrap();
        for n in 0..120 { lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
        lab.enable_staged_materialization(phone);
        lab.sync(mac, phone);
        let generation = lab.held(phone).materialization_revision.clone();
        let mut saved = 0;
        for turn in 0..8 {
            if !lab.materialization_pending(phone, entry) { break; }
            let before = lab.held(phone).staged[&entry].next;
            lab.edit(mac, vault, other, |i| i.set_text(2, &format!("live {turn}"))).unwrap();
            lab.sync(mac, phone);
            let receipt_generation = lab.held(phone).warm_revision.clone();
            let held = lab.log(phone).ids().len();
            let capture = lab.capture_warm_current(phone, held, None).expect("new log has an unsaved warm cut");
            lab.warmed(phone, capture.encode());
            saved += 1;
            assert!(!Arc::ptr_eq(&receipt_generation, &lab.held(phone).warm_revision), "receipt acknowledged");
            assert!(Arc::ptr_eq(&generation, &lab.held(phone).materialization_revision));
            assert_eq!(lab.held(phone).staged[&entry].next, before);
            lab.advance_materialization(phone);
            if let Some(p) = lab.held(phone).staged.get(&entry) { assert!(p.next > before); }
        }
        assert!(saved >= 3, "multiple acknowledged saves occur between reconstruction turns");
        assert!(!lab.materialization_pending(phone, entry));
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
    }

    #[test]
    fn revoked_recipient_cannot_observe_pending_materialization() {
        let mut lab = Lab::new();
        let owner = lab.passkey("pending status entitlement");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        lab.sync(mac, phone);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Private", "start", mac)).unwrap();
        for n in 0..65 { lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
        lab.enable_staged_materialization(phone);
        lab.sync(mac, phone);
        lab.advance_materialization(phone);
        let prior = lab.stores.get_mut(&phone).unwrap().staged.remove(&entry).unwrap();
        lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device {
            vault, device: phone, keep: vec![],
        })).unwrap();
        lab.sync(mac, phone);
        // Even an obsolete internal pending record must not become a status
        // oracle between policy acceptance and the next reconstruction turn.
        lab.stores.get_mut(&phone).unwrap().staged.insert(entry, prior);
        assert!(!lab.materialization_pending(phone, entry));
        assert_eq!(lab.require_materialized(phone, entry), Err(Refusal::NotAllowed));
        let get = crate::engine::read(&lab, phone, &serde_json::json!({
            "op":"get", "entry":entry.to_hex(), "schema":"stored" }));
        assert_ne!(get["refused"], "Materializing");
        let query = crate::engine::read(&lab, phone, &serde_json::json!({
            "op":"query", "schema":"stored", "where":{"type":["note"]} }));
        assert_eq!(query["ok"]["readiness"]["materializing"], 0);
    }

    #[test]
    fn handed_restore_preserves_node_staging_and_working_set() {
        let mut lab = Lab::new();
        let owner = lab.passkey("handed staging");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Cold", "start", mac)).unwrap();
        for n in 0..65 { lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
        let handed = lab.handing(mac).unwrap();
        lab.enable_staged_materialization(phone);
        lab.set_warm_working_set(phone, &[entry]);
        assert!(lab.start_handed(phone, lab.backup(mac), &handed));
        assert!(lab.held(phone).staged_mode);
        assert_eq!(lab.held(phone).warm_working_set, vec![entry]);
        assert!(lab.materialization_pending(phone, entry));
        for _ in 0..8 { if !lab.materialization_pending(phone, entry) { break; } lab.advance_materialization(phone); }
        assert_eq!(lab.item(phone, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
    }

    #[test]
    fn staged_history_does_not_hide_a_verified_newer_projection() {
        let mut lab = Lab::new();
        let owner = lab.passkey("staged projection");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Title", "start", mac)).unwrap();
        lab.sync(mac, phone);
        for n in 0..65 { lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
        // Force a cold canonical reconstruction of held history, as on reopen.
        lab.enable_staged_materialization(phone);
        lab.stores.get_mut(&phone).unwrap().shown.remove(&entry);
        lab.sync(mac, phone);
        assert!(lab.materialization_pending(phone, entry));
        lab.edit(mac, vault, entry, |i| i.set_text(2, "verified newer state")).unwrap();
        let prepared = lab.draft_entry_projection(mac, &[owner], entry).unwrap();
        let snapshot = lab.complete(mac, prepared.draft, &[]).unwrap();
        let only_snapshot = lab.backup(mac).signed().iter()
            .filter(|signed| signed.edit.id() == snapshot).cloned().collect();
        lab.receive(phone, only_snapshot, vec![]);
        assert!(lab.materialization_pending(phone, entry));
        assert!(lab.retain_entry_projection(phone, snapshot, entry, prepared.sealed));
        let expected = lab.item(mac, entry).unwrap().record();
        let get = crate::engine::read(&lab, phone, &serde_json::json!({
            "op":"get", "entry":entry.to_hex(), "schema":"stored" }));
        assert_eq!(get["ok"]["record"], expected);
        assert_eq!(get["ok"]["readOnly"], true);
        let query = crate::engine::read(&lab, phone, &serde_json::json!({
            "op":"query", "schema":"stored", "where":{"type":["note"]} }));
        assert_eq!(query["ok"]["rows"][0]["record"], expected);
        assert_eq!(query["ok"]["readiness"]["materializing"], 1);
        assert_eq!(lab.edit(phone, vault, entry, |i| i.set_text(2, "refused")), Err(Refusal::Materializing));
    }

    #[test]
    fn staged_retention_limits_active_entries_without_starving_queued_entries() {
        let mut lab = Lab::new();
        let owner = lab.passkey("bounded staging");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        lab.sync(mac, phone);
        let mut entries = Vec::new();
        for _ in 0..5 {
            let e = lab.create(mac, vault, vault, "note", &[], document("Title", "start", mac)).unwrap();
            for n in 0..65 { lab.edit(mac, vault, e, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
            entries.push(e);
        }
        lab.enable_staged_materialization(phone);
        lab.sync(mac, phone);
        for _ in 0..4 { lab.advance_materialization(phone); }
        assert_eq!(lab.held(phone).staged.values().filter(|p| p.next > 0).count(), ACTIVE_ENTRIES);
        for _ in 0..32 {
            if !lab.materializations_pending(phone) { break; }
            lab.advance_materialization(phone);
            assert!(lab.held(phone).staged.values().filter(|p| p.next > 0).count() <= ACTIVE_ENTRIES);
        }
        assert!(!lab.materializations_pending(phone));
        for e in entries { assert_eq!(lab.item(phone,e).unwrap().record(), lab.item(mac,e).unwrap().record()); }
    }

    #[test]
    fn staged_generation_cancel_rebuild_and_lock_drop_prefixes() {
        let mut lab = Lab::new();
        let owner = lab.passkey("staged cancellation");
        let mac = lab.device_of(owner, "Mac");
        let phone = lab.device_of(owner, "Phone");
        let vault = human_on(&mut lab, owner, &[mac, phone]);
        lab.sync(mac, phone);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Title", "start", mac)).unwrap();
        for n in 0..65 { lab.edit(mac, vault, entry, |i| i.set_text(2, &format!("body {n}"))).unwrap(); }
        lab.enable_staged_materialization(phone);
        lab.sync(mac, phone);
        lab.advance_materialization(phone);
        assert!(lab.held(phone).staged[&entry].next > 0);
        // Equivalent key material with a different generation cannot publish old work.
        lab.stores.get_mut(&phone).unwrap().keys.revision = Arc::new(());
        lab.advance_materialization(phone);
        assert_eq!(lab.held(phone).staged[&entry].next, 0);
        assert!(lab.item(phone, entry).is_none());
        lab.advance_materialization(phone);
        assert!(lab.held(phone).staged[&entry].next > 0);
        // Store-lifetime/rebuild invalidation remains distinct from save receipts.
        lab.stores.get_mut(&phone).unwrap().materialization_revision = Arc::new(());
        lab.advance_materialization(phone);
        assert_eq!(lab.held(phone).staged[&entry].next, 0);
        assert!(lab.item(phone, entry).is_none());
        lab.advance_materialization(phone);
        assert!(lab.held(phone).staged[&entry].next > 0);
        // Policy removals force canonical re-evaluation even if a prefix's entry
        // content itself did not change. An unrelated log rebind cannot bypass it.
        let revoked = lab.submit(mac, &[owner], Action::Revoke(crate::policy::Revoking::Device {
            vault, device: phone, keep: vec![],
        })).unwrap();
        // A revoked peer is no longer an ordinary sync recipient. Deliver the
        // signed revocation explicitly to test invalidation after it is observed.
        let signed = lab.signed_edit(mac, revoked).unwrap().clone();
        lab.receive(phone, vec![signed], vec![]);
        assert!(!lab.latest(phone).acts_for(phone, vault));
        assert!(lab.held(phone).staged.get(&entry).is_none_or(|p| p.next == 0));
        lab.stores.get_mut(&phone).unwrap().forget();
        assert!(lab.held(phone).staged.is_empty());
        assert!(lab.held(phone).shown.is_empty());
    }
}
