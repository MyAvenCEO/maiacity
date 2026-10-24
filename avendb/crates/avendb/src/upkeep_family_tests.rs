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
