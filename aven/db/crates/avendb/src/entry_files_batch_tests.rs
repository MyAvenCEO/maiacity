//! EntryFilesBatch.lean correspondence: held-log order, selection and canonical resolution.
use super::*;
use crate::cast::{world, todos_on};
use std::cell::Cell;

#[test]
fn grouped_roots_visit_history_once_preserving_first_occurrence_and_scope() {
    let mut w = world();
    let todos = todos_on(&mut w);
    let mut edits = w.lab.held(w.mac_a).log.edits().to_vec();
    let roots = [FileRoot { hash: [1; 32], size: 13 }, FileRoot { hash: [2; 32], size: 29 }];
    // Interleaved writes, including duplicate file roots, remain in held receipt order.
    for edit in &mut edits {
        if let Action::Write { files, .. } = &mut edit.action {
            *files = vec![roots[1], roots[0], roots[1]];
        }
    }
    let visits = Cell::new(0);
    let selected = [todos.door, todos.seeds];
    let grouped = grouped_file_roots(selected, edits.iter().inspect(|_| visits.set(visits.get() + 1)));
    assert_eq!(visits.get(), edits.len(), "one history pass, not one pass per entry");
    for entry in selected {
        let mut seen = BTreeSet::new();
        let expected: Vec<_> = edits.iter().filter(|e| e.entry() == Some(entry))
            .flat_map(|e| e.files().iter().copied()).filter(|f| seen.insert(*f)).collect();
        assert_eq!(grouped[&entry], expected);
        assert_eq!(expected, [roots[1], roots[0]]);
    }
    let narrow = grouped_file_roots([todos.door], edits.iter());
    assert_eq!(narrow.len(), 1);
    assert_eq!(narrow[&todos.door], grouped[&todos.door]);
    visits.set(0);
    assert!(grouped_file_roots([], edits.iter().inspect(|_| visits.set(visits.get() + 1))).is_empty());
    assert_eq!(visits.get(), 0, "an empty world does not scan history");
}

#[test]
fn batched_projection_matches_current_device_before_after_revocation_and_restore() {
    let mut w = world();
    let todos = todos_on(&mut w);
    let file = Brought::new([7; 32], crate::sealed::FileKey::from_bytes([9; 32]), 37);
    let root = file.root;
    let answer = crate::engine::put_file(&mut w.lab, w.mac_a, &serde_json::json!({
        "op": "put_file", "entry": todos.door.to_hex(), "len": file.len,
        "name": "private.bin", "as": w.alice.to_hex(),
    }), file);
    assert!(answer.get("ok").is_some(), "{answer}");
    w.lab.sync_all(0);
    assert_eq!(w.lab.entry_files(w.mac_a, todos.door), [(root, Some(37))]);
    assert_eq!(w.lab.entry_files(w.server, todos.door), [(root, None)], "relay holds ciphertext, not its key");
    let check = |lab: &Lab| {
        for d in [w.mac_a, w.mac_b, w.mac_c, w.server, w.stranger] {
            let selected = [todos.door, todos.seeds];
            let batch = lab.entry_files_batch(d, selected);
            for entry in selected { assert_eq!(batch[&entry], lab.entry_files(d, entry)); }
            // Differential reference is the original per-entry demand projection,
            // including current keep selection and current readable file keys.
            for demanded in [vec![], selected.to_vec(), vec![todos.door, todos.door, todos.seeds]] {
                let state = lab.latest(d);
                let expected: BTreeSet<_> = demanded.iter()
                    .filter(|entry| state.entry(**entry).is_some_and(|en| state.wants(d, en)))
                    .flat_map(|entry| lab.entry_files(d, *entry))
                    .filter_map(|(root, len)| len.map(|_| root)).collect();
                assert_eq!(lab.demanded_files(d, &demanded), expected.into_iter().collect::<Vec<_>>());
            }
            if let Some(world) = crate::world::world(lab, d) {
                for entry in world.entries { assert_eq!(entry.files, lab.entry_files(d, entry.entry)); }
            }
        }
    };
    check(&w.lab);
    let backup = w.lab.backup(w.mac_a);
    w.lab.submit(w.mac_a, &[w.mac_a], Action::Revoke(crate::policy::Revoking::Grant {
        share: todos.carol_read, actor: w.alice, keep: vec![], via: vec![],
    })).unwrap();
    w.lab.sync_all(1);
    check(&w.lab);
    w.lab.restore_backup(w.mac_a, &backup);
    check(&w.lab);
}

/// The keeper's scan a slice at a time (`Lab::scan_files`) finds what `files`, `kept_files` and `demanded_files` find
/// in one pass, however small its slices, and starts again where the edits changed between two slices.
#[test]
fn a_scan_of_files_in_slices_finds_what_one_pass_finds() {
    let mut w = world();
    let todos = todos_on(&mut w);
    for (k, entry) in [(7u8, todos.door), (8, todos.seeds)] {
        let file = Brought::new([k; 32], crate::sealed::FileKey::from_bytes([k + 2; 32]), 30 + k as u64);
        let answer = crate::engine::put_file(&mut w.lab, w.mac_a, &serde_json::json!({
            "op": "put_file", "entry": entry.to_hex(), "len": file.len, "name": "f.bin", "as": w.alice.to_hex(),
        }), file);
        assert!(answer.get("ok").is_some(), "{answer}");
    }
    w.lab.sync_all(0);
    let whole = |lab: &Lab, d: SignerId, keep: bool, entries: &[EntryId], budget: usize| {
        let mut scan = FileScan::new(keep, entries.to_vec());
        let mut slices = 0;
        loop {
            slices += 1;
            match lab.scan_files(d, &mut scan, budget) {
                FileScanned::Done { files, kept, demanded } => return (files, kept, demanded, slices),
                FileScanned::More => {}
                FileScanned::Behind => panic!("a device caught up is not behind"),
            }
        }
    };
    let selected = [todos.door, todos.seeds, todos.solar];
    for d in [w.mac_a, w.mac_b, w.mac_c, w.server, w.stranger] {
        for keep in [false, true] {
            let expected = (w.lab.files(d), w.lab.kept_files(d, keep), w.lab.demanded_files(d, &selected));
            for budget in [1, 3, usize::MAX] {
                let (files, kept, demanded, slices) = whole(&w.lab, d, keep, &selected, budget);
                assert_eq!((files, kept, demanded), expected, "{d:?} keep={keep} budget={budget}");
                if budget == 1 {
                    assert_eq!(slices, w.lab.log(d).edits().len().max(1), "a slice of one edit a turn");
                }
            }
        }
    }
    assert!(!w.lab.files(w.mac_a).is_empty(), "the fixture brings files");
    // the edits change between two slices: it scans them all again, and finds what one pass finds now
    let d = w.mac_a;
    let mut scan = FileScan::new(true, selected.to_vec());
    assert_eq!(w.lab.scan_files(d, &mut scan, 2), FileScanned::More);
    let more = Brought::new([9; 32], crate::sealed::FileKey::from_bytes([11; 32]), 41);
    let answer = crate::engine::put_file(&mut w.lab, d, &serde_json::json!({
        "op": "put_file", "entry": todos.solar.to_hex(), "len": more.len, "name": "g.bin", "as": w.alice.to_hex(),
    }), more);
    assert!(answer.get("ok").is_some(), "{answer}");
    let expected = (w.lab.files(d), w.lab.kept_files(d, true), w.lab.demanded_files(d, &selected));
    loop {
        match w.lab.scan_files(d, &mut scan, 2) {
            FileScanned::Done { files, kept, demanded } => break assert_eq!((files, kept, demanded), expected),
            FileScanned::More => {}
            FileScanned::Behind => panic!("caught up"),
        }
    }
}
