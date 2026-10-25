//! Node-only canonical judgment continuations. Standalone Lab stays synchronous.
use super::*;
pub(super) const BATCH: usize = 32;

pub(super) struct Pending {
    history: History,
    after: After,
    lane: Arc<Lane>,
    print: [u8; 32],
    tip: Tip,
    next: usize,
    log: crate::policy::LogRevision,
    keys: Arc<()>,
    warm: Arc<()>,
}
impl Pending {
    pub(super) fn new(j: Judging<'_>, lane: Arc<Lane>, print: [u8;32], tip: Tip,
        log: crate::policy::LogRevision, keys: Arc<()>, warm: Arc<()>) -> Self {
        let (history, after) = suspend(j);
        Self { history, after, lane, print, tip, next: 0, log, keys, warm }
    }
    pub(super) fn tip_matches(&self, tip: Tip) -> bool { self.tip == tip }
    pub(super) fn current(&self, log: &crate::policy::LogRevision, keys: &Arc<()>, warm: &Arc<()>) -> bool {
        self.log == *log && Arc::ptr_eq(&self.keys, keys) && Arc::ptr_eq(&self.warm, warm)
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
        !self.locked(on) && self.sees(on, entry) && self.held(on).staged.contains_key(&entry)
    }
    pub(super) fn require_materialized(&self, on: SignerId, entry: EntryId) -> Result<(), Refusal> {
        if !self.held(on).staged.contains_key(&entry) { return Ok(()); }
        Err(if self.sees(on, entry) { Refusal::Materializing } else { Refusal::NotAllowed })
    }
    /// One fair entry turn, at most BATCH ordinary canonical judgments. Final
    /// Loro item construction is still atomic; this is not a wall-time bound.
    pub fn advance_materialization(&mut self, on: SignerId) -> bool {
        let at = self.at(on);
        if self.locked(at) { return false; }
        self.catch_up(at);
        let store = self.stores.get_mut(&at).expect("known device");
        let entry = store.staged.keys().copied().find(|e| store.staged_cursor.is_none_or(|c| *e > c))
            .or_else(|| store.staged.keys().next().copied());
        let Some(entry) = entry else { return false; };
        store.staged_cursor = Some(entry);
        let mut p = store.staged.remove(&entry).expect("selected pending entry");
        if !p.current(&store.log.revision(), &store.keys.revision, &store.warm_revision) {
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
        lab.stores.get_mut(&phone).unwrap().forget();
        assert!(lab.held(phone).staged.is_empty());
        assert!(lab.held(phone).shown.is_empty());
    }
}
