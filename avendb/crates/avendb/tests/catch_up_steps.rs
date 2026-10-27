//! A catch-up a step at a time (`Lab::catch_up_step`), as a node takes it, a short turn of its Lab each, so a page's
//! turn comes between them: it brings the device to what one `catch_up` brings it to, its edits, its view, its entries
//! and every item as it reads it, however small its steps.

use avendb::cast::{document, handbook_ready, world, World};
use avendb::id::SignerId;
use avendb::lab::{CatchUp, FileScan, FileScanned};
use avendb::sign::Signed;

/// Alice's Mac writes `n` documents for the coop; her iPhone takes them a page at a time, none caught up yet, as a
/// pull takes its pages before its last.
fn behind(n: usize) -> (World, SignerId, Vec<Signed>, avendb::id::VaultId) {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac, phone) = (w.mac_a, w.phone_a);
    for i in 0..n {
        let doc = document(&format!("Doc {i}"), "Written while the iPhone was away.", mac);
        w.lab.create(mac, coop, coop, "doc", &[], doc).expect("a document");
    }
    let held: std::collections::HashSet<_> = w.lab.log(phone).ids().iter().copied().collect();
    let fresh: Vec<Signed> = w.lab.backup(mac).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
    for page in fresh.chunks(40) {
        w.lab.receive_whose_now(phone, page.to_vec(), vec![], false);
    }
    (w, phone, fresh, coop)
}

/// What device `d` holds and shows: its edits, its view, and each entry with what it reads of its item.
fn seen(w: &World, d: SignerId) -> (Vec<avendb::id::EditId>, Vec<(avendb::id::EntryId, Option<serde_json::Value>)>) {
    let entries = w.lab.entries(d).into_iter().map(|e| (e, w.lab.item(d, e).map(|i| i.record()))).collect();
    (w.lab.log(d).ids().to_vec(), entries)
}

#[test]
fn a_catch_up_in_steps_brings_what_one_catch_up_brings() {
    let n = 120;
    let (mut once, d, fresh, _) = behind(n);
    let (mut steps, d2, fresh2, _) = behind(n);
    assert_eq!(d, d2);
    assert_eq!(
        fresh.iter().map(|s| s.edit.id()).collect::<Vec<_>>(),
        fresh2.iter().map(|s| s.edit.id()).collect::<Vec<_>>(),
        "the two worlds are made alike"
    );
    // behind, the keeper's scan waits for the catch-up rather than replay every edit under the Lab
    assert!(!steps.lab.replay_current(d));
    assert_eq!(steps.lab.scan_files(d, &mut FileScan::new(true, vec![]), 64), FileScanned::Behind);
    assert!(once.lab.catch_up(d));
    let mut taken = 0;
    loop {
        taken += 1;
        assert!(taken < 10 * n, "a catch-up in steps ends");
        match steps.lab.catch_up_step(d, 7) {
            CatchUp::Stepped => {}
            CatchUp::Caught(any) => {
                assert!(any, "it had edits to catch up with");
                break;
            }
        }
    }
    assert!(taken >= n / 7, "{taken} steps: a few entries shown anew a step");
    assert!(steps.lab.replay_current(d));
    let (a, b) = (seen(&once, d), seen(&steps, d));
    assert_eq!(a.1.len(), b.1.len());
    assert!(a.1.iter().filter(|(_, item)| item.is_some()).count() >= n, "it reads every document");
    assert_eq!(a, b, "the same edits, entries and items as one catch-up");
    assert!(once.lab.state(d) == steps.lab.state(d), "the same view");
    // and once caught up, nothing more to do
    assert_eq!(steps.lab.catch_up_step(d, 7), CatchUp::Caught(false));
}

#[test]
fn a_catch_up_in_steps_that_more_edits_cut_into_still_ends_where_one_ends() {
    let n = 60;
    let (mut once, d, _, coop) = behind(n);
    let (mut steps, _, _, _) = behind(n);
    // a few steps in, more of the Mac's edits come, as a pull's next page does between two turns of the Lab
    let mut taken = 0;
    while taken < 4 {
        assert_eq!(steps.lab.catch_up_step(d, 5), CatchUp::Stepped);
        taken += 1;
    }
    let mac = steps.mac_a;
    for w in [&mut once, &mut steps] {
        let doc = document("Late", "Written meanwhile.", mac);
        w.lab.create(mac, coop, coop, "doc", &[], doc).expect("a document");
        let held: std::collections::HashSet<_> = w.lab.log(d).ids().iter().copied().collect();
        let late: Vec<Signed> = w.lab.backup(mac).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
        w.lab.receive_whose_now(d, late, vec![], false);
    }
    assert!(once.lab.catch_up(d));
    loop {
        taken += 1;
        assert!(taken < 10 * n);
        if let CatchUp::Caught(_) = steps.lab.catch_up_step(d, 5) {
            break;
        }
    }
    assert_eq!(seen(&once, d), seen(&steps, d));
    assert!(once.lab.state(d) == steps.lab.state(d));
}
