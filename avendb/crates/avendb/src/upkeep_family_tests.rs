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
