//! Same-state family selection parity, including revoked/restored policy.
use super::*;
use crate::cast::{world, todos_on};
use crate::policy::Revoking;
use std::{hint::black_box, time::Instant};

fn decisions(st: &State, d: SignerId) -> (Vec<bool>, Vec<bool>, usize) {
    let families = st.key_fams();
    let selected: HashSet<_> = families.iter().copied().filter(|&k| st.entitled(d, k)).collect();
    let keys: Vec<_> = st.entries().iter().map(|e| KeyFam::Audience(e.vault, e.audience())).collect();
    assert!(keys.iter().all(|k| families.contains(k)), "every current audience is enumerated");
    (keys.iter().map(|&k| st.entitled(d, k)).collect(), keys.iter().map(|k| selected.contains(k)).collect(), selected.len())
}

#[test]
fn upkeep_families_match_current_authorization_after_revocation_and_restore() {
    let mut w = world();
    let t = todos_on(&mut w);
    let backup = w.lab.backup(w.mac_a);
    let actors = [w.mac_a, w.mac_b, w.mac_c, w.server, w.stranger];
    let check = |lab: &Lab| {
        let st = lab.held(w.mac_a).view();
        for d in actors {
            let (old, new, _) = decisions(st, d);
            assert_eq!(old, new, "current canonical authorization must be identical for every actor");
        }
        // Revocation and restore can change which writes count; any eligible scratch
        // must still agree with materializing the freshly selected canonical history.
        for shown in lab.held(w.mac_a).shown.values() {
            let Some(scratch) = &shown.after.scratch else { continue };
            for line in shown.history.lines() {
                let changes = shown.history.history(line);
                if let Some(projected) = scratch.shown_for(&changes, w.mac_a, line) {
                    let canonical = crate::history::build_from(&changes, w.mac_a, line).unwrap();
                    assert_eq!(projected.record(), canonical.record());
                    assert_eq!(projected.version(), canonical.version());
                }
            }
        }
    };
    check(&w.lab);
    let before = decisions(w.lab.held(w.mac_a).view(), w.mac_c).0;
    w.lab.submit(w.mac_a, &[w.mac_a], Action::Revoke(Revoking::Grant {
        share: t.carol_read, actor: w.alice, keep: vec![], via: vec![],
    })).unwrap();
    check(&w.lab);
    assert_ne!(before, decisions(w.lab.held(w.mac_a).view(), w.mac_c).0, "revocation changes a real decision");
    w.lab.restore_backup(w.mac_a, &backup);
    check(&w.lab);
    assert_eq!(before, decisions(w.lab.held(w.mac_a).view(), w.mac_c).0);
}

#[test]
fn measure_repeated_current_audience_checks() {
    let mut w = world();
    todos_on(&mut w);
    let st = w.lab.held(w.mac_a).view();
    // Repeat real entry audience decisions to isolate the removed cost. This is not an unlock benchmark.
    let keys: Vec<_> = st.entries().iter().map(|e| KeyFam::Audience(e.vault, e.audience())).cycle().take(4096).collect();
    assert_eq!(keys.len(), 4096);
    for d in [w.mac_a, w.mac_c, w.stranger] {
        let start = Instant::now();
        let old: Vec<_> = keys.iter().map(|&k| black_box(st.entitled(d, black_box(k)))).collect();
        let before = start.elapsed();
        let start = Instant::now();
        // Include construction cost, even though production already needs the filtered family Vec.
        let selected: HashSet<_> = st.key_fams().into_iter().filter(|&k| st.entitled(d, k)).collect();
        let new: Vec<_> = keys.iter().map(|k| black_box(selected.contains(black_box(k)))).collect();
        let after = start.elapsed();
        assert_eq!(old, new);
        eprintln!("upkeep audience checks={} families={} baseline={before:?} reused={after:?}", keys.len(), selected.len());
    }
}

#[test]
fn profile_same_engine_synthetic_warm_restore() {
    use crate::cast::{document, human_on};
    let mut lab = Lab::new();
    let passkey = lab.passkey("Synthetic warm profile");
    let mac = lab.device_of(passkey, "Synthetic Mac");
    let phone = lab.device_of(passkey, "Synthetic phone");
    let vault = human_on(&mut lab, passkey, &[mac, phone]);
    let mut entries = vec![];
    let entries_count = std::env::var("AVENDB_SYNTHETIC_WARM_ENTRIES").ok()
        .map(|v| v.parse::<usize>().expect("synthetic entry count is a number")).unwrap_or(32);
    assert!((1..=256).contains(&entries_count), "bound synthetic fixture time and memory");
    for n in 0..entries_count {
        let id = lab.create(mac, vault, vault, "note", &[], document("Synthetic note", "initial", mac)).unwrap();
        for j in 0..4 {
            lab.edit(mac, vault, id, |it| it.set_text(2, &format!("entry {n} revision {j}"))).unwrap();
        }
        entries.push(id);
    }
    lab.restore_from(phone, lab.backup(mac));
    let backup = lab.backup(phone);
    let count = backup.signed.len();
    let index = KeyIndex::of(&lab.held(phone).replay);
    eprintln!("synthetic fixture edits={count} boxes={} cloned_box_bytes={}", index.boxes.len(), index.boxes.iter().map(|(_, _, b)| b.bytes.len()).sum::<usize>());
    drop(index);
    let pending = lab.warming(phone, count, Some([77; 40])).unwrap();
    let warm = Warm { keys: pending.keys.clone().into_iter().collect(), views: pending.view.clone().into_iter().collect() };
    assert!(warm.views.len() == 1 && warm.keys.len() == 1);
    lab.warmed(phone, pending);
    let records: Vec<_> = entries.iter().map(|e| lab.item(phone, *e).unwrap().record()).collect();
    for trial in 0..3 {
        let before = lab.work_metrics(phone);
        let start = Instant::now();
        lab.restore_warm(phone, backup.clone(), Some(([77; 40], count)), &warm);
        let elapsed = start.elapsed();
        let after = lab.work_metrics(phone);
        assert_eq!(after["counts"]["replay: from its stored view"].as_u64().unwrap_or(0),
            before["counts"]["replay: from its stored view"].as_u64().unwrap_or(0) + 1);
        assert_eq!(entries.iter().map(|e| lab.item(phone, *e).unwrap().record()).collect::<Vec<_>>(), records);
        let deltas: serde_json::Map<String, serde_json::Value> = after["timers"].as_object().unwrap().iter()
            .map(|(k,v)| (k.clone(), serde_json::json!(v["total_ms"].as_f64().unwrap_or(0.0)
                - before["timers"][k]["total_ms"].as_f64().unwrap_or(0.0)))).collect();
        eprintln!("synthetic same-engine warm trial={trial} edits={count} entries={} open={elapsed:?} phases_ms={}", entries.len(), serde_json::Value::Object(deltas));
    }
}


#[test]
fn guarded_scratch_projection_matches_rebuild_and_successor_writes() {
    let mut w = world();
    todos_on(&mut w);
    for n in 0..4 {
        let entry = w.lab.create(w.mac_a, w.alice, w.alice, "note", &[],
            crate::cast::document("Scratch materialization", "initial", w.mac_a)).unwrap();
        for revision in 0..16 {
            w.lab.edit(w.mac_a, w.alice, entry,
                |item| item.set_text(2, &format!("note {n} revision {revision}"))).unwrap();
        }
        if n == 0 {
            let heads = w.lab.shown(w.mac_a, entry).heads(MAIN);
            let proposal = w.lab.propose(w.mac_a, w.alice, entry, &heads, "parallel line").unwrap();
            w.lab.edit_on(w.mac_a, w.alice, entry, Some(proposal),
                |item| item.set_text(2, "proposal content")).unwrap();
        }
    }
    let store = w.lab.held(w.mac_a);
    let mut reused = 0;
    let mut baseline = std::time::Duration::ZERO;
    let mut candidate = std::time::Duration::ZERO;
    for shown in store.shown.values() {
        let Some(scratch) = &shown.after.scratch else { continue };
        for line in shown.history.lines() {
            let changes = shown.history.history(line);
            let canonical = crate::history::build_from(&changes, w.mac_a, line);
            let proposed = scratch.shown_for(&changes, w.mac_a, line);
            if let Some(mut proposed) = proposed {
                let mut canonical = canonical.expect("an eligible scratch corresponds to a shown item");
                assert_eq!(proposed.record(), canonical.record());
                assert_eq!(proposed.version(), canonical.version());
                proposed.set_text(1, "same next edit");
                canonical.set_text(1, "same next edit");
                assert_eq!(proposed.record(), canonical.record());
                assert_eq!(proposed.version(), canonical.version(), "next edit keeps the same signer/line peer");
                for _ in 0..10 {
                    let at = Instant::now();
                    std::hint::black_box(crate::history::build_from(&changes, w.mac_a, line));
                    baseline += at.elapsed();
                    let at = Instant::now();
                    std::hint::black_box(scratch.shown_for(&changes, w.mac_a, line));
                    candidate += at.elapsed();
                }
                reused += 1;
            }
            if !changes.is_empty() {
                let mut denied: Vec<_> = changes.iter().map(|c| (*c).clone()).collect();
                denied.last_mut().unwrap().counted = false;
                let denied_refs: Vec<_> = denied.iter().collect();
                assert!(scratch.shown_for(&denied_refs, w.mac_a, line).is_none(),
                    "an authorization-rejected write prevents reuse even with identical IDs");
                for signer in [w.mac_b, w.mac_c] {
                    if let Some(mut projected) = scratch.shown_for(&changes, signer, line) {
                        let mut rebuilt = crate::history::build_from(&changes, signer, line).unwrap();
                        projected.set_text(1, "another signer continues");
                        rebuilt.set_text(1, "another signer continues");
                        assert_eq!(projected.record(), rebuilt.record());
                        assert_eq!(projected.version(), rebuilt.version());
                    }
                }
                assert!(scratch.shown_for(&changes[..changes.len()-1], w.mac_a, line).is_none(),
                    "scratch may not expose writes outside the selected history");
            }
        }
    }
    assert!(reused > 0);
    eprintln!("scratch projection eligible={reused} repetitions=10 build={baseline:?} guarded_fork={candidate:?}");
}


#[test]
fn unchanged_warm_restore_does_not_reencode_and_corrupt_views_recover() {
    use crate::cast::{document, human_on};
    let mut lab = Lab::new();
    let passkey = lab.passkey("Warm save baseline");
    let device = lab.device_of(passkey, "Warm device");
    let vault = human_on(&mut lab, passkey, &[device]);
    let entry = lab.create(device, vault, vault, "note", &[], document("Retained", "first", device)).unwrap();
    // A freshly founding device generated its own keys rather than opening their
    // boxes. Exercise an already-warm device, including those opened-box receipts.
    lab.restore_from(device, lab.backup(device));
    let backup = lab.backup(device);
    let count = backup.signed.len();
    let marker = [81; 40];
    let saved = lab.warming(device, count, Some(marker)).unwrap();
    let warm = Warm { keys: saved.keys.clone().into_iter().collect(), views: saved.view.clone().into_iter().collect() };
    assert_eq!(warm.views.len(), 1);
    lab.warmed(device, saved);
    lab.restore_warm(device, backup.clone(), Some((marker, count)), &warm);
    let restored = lab.held(device);
    assert!(!lab.warm_due(device), "validated unchanged state is already represented on its shelf: replayed={} saved={} wholes={} saved_wholes={} newkeys={} checked={:?} counts={}",
        restored.replayed, restored.view_given, restored.wholes, restored.view_wholes, restored.opened_since.len(), restored.checked_given, lab.work_metrics(device));
    assert!(lab.capture_warm(device, count, Some(marker)).is_none(), "no capture means no redundant encode/encrypt");

    lab.edit(device, vault, entry, |item| item.set_text(1, "next mutation")).unwrap();
    let expected = lab.item(device, entry).unwrap().record();
    let next = lab.backup(device);
    let next_count = next.signed.len();
    let next_marker = [82; 40];
    let pending = lab.warming(device, next_count, Some(next_marker)).unwrap();
    assert!(pending.keys.is_some(), "new durable frontier must update signature-check receipt");
    let mut next_warm = warm.clone();
    if let Some(keys) = &pending.keys { next_warm.keys.insert(0, keys.clone()); }
    if let Some(view) = &pending.view { next_warm.views.insert(0, view.clone()); }
    lab.warmed(device, pending);
    lab.restore_warm(device, next.clone(), Some((next_marker, next_count)), &next_warm);
    assert_eq!(lab.item(device, entry).unwrap().record(), expected, "next edit survives stored-prefix replay");

    let broken = Warm { keys: next_warm.keys, views: vec![vec![0, 1, 2]] };
    lab.restore_warm(device, next, Some((next_marker, next_count)), &broken);
    assert_eq!(lab.item(device, entry).unwrap().record(), expected);
    assert!(lab.capture_warm(device, next_count, Some(next_marker)).is_some(), "invalid derived view must be regenerated");
}


#[test]
fn ordinary_reconstruction_bounds_scratch_retention_before_final_sweep() {
    use crate::cast::{document, human_on};
    let mut lab = Lab::new();
    let passkey = lab.passkey("Scratch bound");
    let device = lab.device_of(passkey, "Device");
    let vault = human_on(&mut lab, passkey, &[device]);
    let (mut reconstructed, mut recent) = (BTreeMap::new(), Vec::new());
    let mut expected = BTreeMap::new();
    let mut peak = 0;
    for i in 0..(SCRATCHES * 2 + 7) {
        let entry = lab.create(device, vault, vault, "note", &[],
            document(&format!("Note {i}"), "retained content", device)).unwrap();
        let shown = lab.stores.get_mut(&device).unwrap().shown.remove(&entry).unwrap();
        assert!(shown.after.scratch.is_some());
        expected.insert(entry, (shown.items[&MAIN].record(), shown.items[&MAIN].version()));
        // The exact helper used during show_items, before its final cache sweep.
        retain_recent_shown(&mut reconstructed, &mut recent, entry, shown);
        let held = reconstructed.values().filter(|s| s.after.scratch.is_some()).count();
        peak = peak.max(held);
        assert!(held <= SCRATCHES, "scratch documents must be bounded during reconstruction");
    }
    assert_eq!(peak, SCRATCHES);
    let selected: HashSet<_> = recent.iter().rev().take(SCRATCHES).copied().collect();
    for (entry, shown) in &reconstructed {
        assert_eq!(shown.after.scratch.is_some(), selected.contains(entry), "same final cache selection");
        assert_eq!((shown.items[&MAIN].record(), shown.items[&MAIN].version()), expected[entry]);
    }
    eprintln!("ordinary reconstructed={} retained_scratch_peak={peak} bound={SCRATCHES}", reconstructed.len());
}
