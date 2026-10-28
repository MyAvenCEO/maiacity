//! A catch-up a step at a time (`Lab::catch_up_step`), as a node takes it, a short turn of its Lab each, so a page's
//! turn comes between them: it brings the device to what one `catch_up` brings it to, its edits, its view, its entries
//! and every item as it reads it, however small its steps.
#![cfg(debug_assertions)]

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

/// Alice's Mac writes `n` documents for the coop and then a schema of it, an entry every entry's upkeep reads (its
/// lane); her iPhone takes them a page at a time, none caught up yet.
fn behind_a_lane(n: usize) -> (World, SignerId) {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac, phone) = (w.mac_a, w.phone_a);
    for i in 0..n {
        let doc = document(&format!("Doc {i}"), "Written while the iPhone was away.", mac);
        w.lab.create(mac, coop, coop, "doc", &[], doc).expect("a document");
    }
    let blob = avendb::lens::blobs::POST_V1.replace("Post, v1", "Post, late");
    let op = serde_json::json!({ "op": "create", "vault": coop.to_hex(), "as": coop.to_hex(), "type": "schema", "value": blob });
    let answer = avendb::engine::run(&mut w.lab, mac, &op);
    assert!(answer.get("ok").is_some(), "{answer}");
    let held: std::collections::HashSet<_> = w.lab.log(phone).ids().iter().copied().collect();
    let fresh: Vec<Signed> = w.lab.backup(mac).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
    for page in fresh.chunks(40) {
        w.lab.receive_whose_now(phone, page.to_vec(), vec![], false);
    }
    (w, phone)
}

/// How often device `d`'s upkeep looked at every entry, by its counts.
fn whole_upkeeps(w: &World, d: SignerId) -> u64 {
    w.lab.perf(d)["counts"]["upkeep: of every entry"].as_u64().unwrap_or(0)
}

/// 2026-10-27, an iPhone on batch 4: its catch-up refreshed some 40 times a second for minutes, each time with nothing
/// new, its upkeep looking at the same first slice of every entry, so it never caught up, its keeper never fetched the
/// open view's files, and its pulls and writes waited behind it. The entries a sliced upkeep left for later include a
/// lane's; being left for later is no change to it, so the next step goes on with them rather than start over.
#[test]
fn a_catch_up_whose_upkeep_leaves_a_lane_for_later_still_ends() {
    let n = 200;
    let (mut once, d) = behind_a_lane(n);
    let (mut steps, _) = behind_a_lane(n);
    assert!(once.lab.catch_up(d));
    let before = whole_upkeeps(&steps, d);
    let mut taken = 0;
    loop {
        taken += 1;
        assert!(taken < 10 * n, "a catch-up in steps ends: {taken} steps, {} looks at every entry", whole_upkeeps(&steps, d) - before);
        match steps.lab.catch_up_step(d, 7) {
            CatchUp::Stepped => {}
            CatchUp::Caught(_) => break,
        }
    }
    let whole = whole_upkeeps(&steps, d) - before;
    assert!(whole <= 2, "it looked at every entry {whole} times, starting over each step");
    assert_eq!(seen(&once, d), seen(&steps, d), "the same edits, entries and items as one catch-up");
    assert!(once.lab.state(d) == steps.lab.state(d), "the same view");
    assert_eq!(steps.lab.catch_up_step(d, 7), CatchUp::Caught(false));
}

/// A whole replay run a slice a step (`ReplayRun`, as a catch-up's step replays where stepping on would replay every
/// edit) is the replay of them all, however small its slices, and steps on from where the whole one would.
#[test]
fn a_whole_replay_run_a_slice_a_step_is_the_whole_replay() {
    let (w, phone, _, _) = behind(90);
    let log = w.lab.log(phone);
    let (edits, ids) = (log.edits(), log.ids());
    let whole = avendb::policy::replay(edits);
    for most in [1, 3, 64, usize::MAX] {
        let mut run = avendb::policy::ReplayRun::start(edits, ids);
        assert_eq!(run.of(), edits.len());
        let mut steps = 1;
        while !run.step(edits, most) {
            steps += 1;
            assert!(steps <= edits.len(), "it runs at least one edit a step");
        }
        assert!(most == usize::MAX || steps >= edits.len().div_ceil(most).min(edits.len()) - 1, "{steps} steps of {most}");
        let stepped = run.finish(edits, ids);
        assert!(stepped == whole, "slices of {most}: the same replay as the whole");
        // and the edits after them step on it as on the whole one
        let n = edits.len() - 5;
        let mut part = avendb::policy::ReplayRun::start(&edits[..n], &ids[..n]);
        while !part.step(&edits[..n], most) {}
        let on = avendb::policy::replay_on(part.finish(&edits[..n], &ids[..n]), edits, n);
        assert!(on == whole, "slices of {most}: stepped on to the whole");
    }
}

/// Alice's iPhone, which took her vault early, then the edits `writers` devices of hers made since, a page at a time
/// as a node takes them, not yet caught up: as the server's, interleaved, they sort before where its replay steps on
/// from, so its catch-up replays them all (`scale_turns.rs`, a first sync of 130,000 edits).
fn first_sync(writers: usize, per: usize) -> (avendb::lab::Lab, SignerId) {
    let (lab, phone, _) = first_sync_of(writers, per, false);
    (lab, phone)
}

/// `first_sync`, and with `removal` a device added to Alice's vault and removed again among the edits it takes, as
/// Maia City's hold removals; with one of the writers, which lacks the others' edits.
fn first_sync_of(writers: usize, per: usize, removal: bool) -> (avendb::lab::Lab, SignerId, SignerId) {
    first_sync_with(writers, per, removal, false)
}

/// `first_sync_of`, and with `adds` the device removed having added another device to Alice's vault before, by her
/// passkey's approval, as Maia City's old devices did.
fn first_sync_with(writers: usize, per: usize, removal: bool, adds: bool) -> (avendb::lab::Lab, SignerId, SignerId) {
    use avendb::cast::paragraph;
    use avendb::id::VaultId;
    use avendb::policy::{Action, Kind, Principal, Sharing};
    let mut lab = avendb::lab::Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let ws: Vec<SignerId> = (0..writers).map(|i| lab.device_of(passkey, &format!("Alice's writer {i}"))).collect();
    let genesis = Action::Genesis {
        kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![],
    };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    for &d in [phone].iter().chain(&ws) {
        let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
        lab.submit(mac, &[passkey, d], add).expect("a device added");
    }
    for &d in [phone].iter().chain(&ws) {
        lab.sync(mac, d);
    }
    if removal {
        use avendb::policy::Revoking;
        let pad = lab.device_of(passkey, "Alice's old iPad");
        let add = Action::Share(Sharing::Device { vault: alice, device: pad, seal_to: None });
        lab.submit(mac, &[passkey, pad], add).expect("a device added");
        if adds {
            let tv = lab.device_of(passkey, "Alice's TV");
            let add = Action::Share(Sharing::Device { vault: alice, device: tv, seal_to: None });
            lab.submit(mac, &[passkey, tv, pad], add).expect("a device the iPad added");
        }
        let remove = Action::Revoke(Revoking::Device { vault: alice, device: pad, keep: vec![] });
        lab.submit(mac, &[passkey], remove).expect("and removed");
        for &w in &ws {
            lab.sync(mac, w);
        }
    }
    for (i, &w) in ws.iter().enumerate() {
        let doc = document(&format!("Doc {i}"), "Written by one of Alice's devices.", w);
        let entry = lab.create(w, alice, alice, "doc", &[], doc).expect("a document");
        for k in 0..per {
            lab.edit(w, alice, entry, |item| item.push_block(paragraph(100 + k as u64, &format!("Edit {k}.")))).expect("an edit");
        }
    }
    for &w in &ws {
        let held: std::collections::HashSet<_> = lab.log(phone).ids().iter().copied().collect();
        let fresh: Vec<Signed> = lab.backup(w).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
        for page in fresh.chunks(40) {
            let prepared = lab.prepare_receive(phone, page.to_vec()).check();
            lab.receive_prepared(phone, prepared, false);
        }
    }
    (lab, phone, ws[0])
}

/// Such a catch-up replays every edit a slice a step (`ReplayRun`), the replay it held standing till the whole one
/// ends, and opens their bodies a slice a step: more steps than one each, and the same as one catch-up.
#[test]
fn a_first_sync_replays_and_reads_a_slice_a_step() {
    let (mut once, d) = first_sync(6, 40);
    let (mut steps, _) = first_sync(6, 40);
    assert!(!steps.replay_current(d));
    assert!(once.catch_up(d));
    let count = |lab: &avendb::lab::Lab, k: &str| lab.perf(d)["timers"][k]["count"].as_u64().unwrap_or(0);
    let (replays, reads) = (count(&steps, "replay"), count(&steps, "read"));
    let mut taken = 0;
    while let CatchUp::Stepped = steps.catch_up_step(d, 1) {
        taken += 1;
        assert!(taken < 10_000, "a catch-up in steps ends");
    }
    let n = steps.log(d).edits().len();
    let (replays, reads) = (count(&steps, "replay") - replays, count(&steps, "read") - reads);
    let counts = &steps.perf(d)["counts"];
    assert!(replays > 10, "{n} edits replayed in {replays} steps: {counts}");
    assert!(reads > 2, "their bodies read in {reads} steps: {counts}");
    assert!(once.state(d) == steps.state(d), "the same view");
    let seen = |lab: &avendb::lab::Lab| {
        let entries: Vec<_> = lab.entries(d).into_iter().map(|e| (e, lab.item(d, e).map(|i| i.record()))).collect();
        (lab.log(d).ids().to_vec(), entries)
    };
    assert_eq!(seen(&once), seen(&steps), "the same edits, entries and items as one catch-up");
}

/// An entry of many writes is judged over several steps of a catch-up, each going on where the last left off, so that
/// no step judges more than a slice of them (`show_items`, `SHOW_SLICE`); it ends shown as one catch-up shows it.
#[test]
fn an_entry_of_many_writes_is_shown_over_several_steps() {
    use avendb::cast::paragraph;
    let make = || {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (mac, phone) = (w.mac_a, w.phone_a);
        let doc = w.lab.create(mac, coop, coop, "doc", &[], document("Long", "Many edits.", mac)).expect("a document");
        for k in 0..200 {
            w.lab.edit(mac, coop, doc, |item| item.push_block(paragraph(100 + k, &format!("Edit {k}.")))).expect("an edit");
        }
        let held: std::collections::HashSet<_> = w.lab.log(phone).ids().iter().copied().collect();
        let fresh: Vec<Signed> = w.lab.backup(mac).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
        for page in fresh.chunks(40) {
            w.lab.receive_whose_now(phone, page.to_vec(), vec![], false);
        }
        (w, phone)
    };
    let (mut once, d) = make();
    let (mut steps, _) = make();
    assert!(once.lab.catch_up(d));
    let judged = |w: &World| w.lab.perf(d)["counts"]["show: writes judged"].as_u64().unwrap_or(0);
    let (mut most, mut taken) = (0, 0);
    loop {
        let before = judged(&steps);
        let step = steps.lab.catch_up_step(d, 1);
        most = most.max(judged(&steps) - before);
        taken += 1;
        assert!(taken < 1_000, "a catch-up in steps ends");
        if matches!(step, CatchUp::Caught(_)) {
            break;
        }
    }
    assert!(most <= 16, "at most a slice of the entry's writes judged a step: {most}");
    assert_eq!(seen(&once, d), seen(&steps, d), "the same entries and items as one catch-up");
    assert!(once.lab.state(d) == steps.lab.state(d), "the same view");
}

/// A first sync whose edits hold a removal answers its peers by nothing in the middle of its catch-up, rather than replay
/// every edit it holds for each ask (S2, 2026-10-28: a first sync of Maia City replayed them all for each page's
/// announce, and never ended); once caught up, it answers by all of them (`answerOr` in `StandingReplay.lean`).
#[test]
fn a_first_sync_with_a_removal_answers_its_peers_by_nothing_till_caught_up_not_by_a_whole_replay() {
    let (mut lab, d, writer) = first_sync_of(6, 40, true);
    // a page of what the writer, a peer, asks the iPhone for
    let asked = |lab: &mut avendb::lab::Lab| {
        let request = lab.request(writer, d);
        lab.reply(d, writer, &request, 1 << 20).0.len()
    };
    assert!(!lab.replay_current(d), "a first sync taken, not caught up");
    let mut steps = 0;
    loop {
        let step = lab.catch_up_step(d, 1);
        steps += 1;
        assert!(steps < 10_000, "a catch-up in steps ends");
        if matches!(step, CatchUp::Caught(_)) {
            break;
        }
        if !lab.replay_current(d) {
            let _ = lab.announce(d, writer);
            let _ = asked(&mut lab);
            assert!(!lab.replay_current(d), "a peer's ask at step {steps} replayed every edit");
        }
    }
    assert!(lab.replay_current(d), "caught up");
    assert!(asked(&mut lab) > 0, "caught up, it hands its peer what it holds");
}

/// Mid such a catch-up it still answers a peer the removal doesn't concern, by the replay it holds: never more than it
/// hands it once caught up (Fix C, 2026-10-28: a Mac in the middle of its catch-up of Maia City, which holds removals,
/// handed an iPhone that lacked 2,569 logs no page, as it answered every peer by nothing till caught up).
#[test]
fn a_first_sync_with_a_removal_answers_the_peers_it_doesnt_concern_by_its_replay() {
    let (mut lab, d, writer) = first_sync_of(6, 40, true);
    let asked = |lab: &mut avendb::lab::Lab| {
        let request = lab.request(writer, d);
        lab.reply(d, writer, &request, 1 << 30).0.into_iter().map(|s| s.edit.id()).collect::<Vec<_>>()
    };
    let (mut steps, mut mid) = (0, Vec::new());
    loop {
        let step = lab.catch_up_step(d, 1);
        steps += 1;
        assert!(steps < 10_000, "a catch-up in steps ends");
        if matches!(step, CatchUp::Caught(_)) {
            break;
        }
        if !lab.replay_current(d) {
            mid.push(asked(&mut lab));
            assert!(!lab.replay_current(d), "a peer's ask at step {steps} replayed every edit");
        }
    }
    let whole: std::collections::HashSet<_> = asked(&mut lab).into_iter().collect();
    assert!(!whole.is_empty(), "caught up, it hands its peer what it lacks");
    let answered = mid.iter().filter(|page| !page.is_empty()).count();
    assert!(answered > 0, "it answered the writer mid its catch-up, at none of {} steps", mid.len());
    for page in &mid {
        assert!(page.iter().all(|id| whole.contains(id)), "mid its catch-up it hands over only what it hands once caught up");
    }
}

/// A start of more than it does in one go (`Lab::set_restore_whole`), as an iPhone's unlock of a partial vault with no
/// stored view (313 s, 2026-10-28): its restore replays and shows a step of it and ends catching up, a replay of a few
/// edits; its catch-up a step at a time then brings it to what a start that did it all in one go shows.
#[test]
fn a_start_of_more_than_it_does_in_one_go_ends_behind_and_its_catch_up_shows_the_rest() {
    let warm = avendb::lab::Warm::default();
    let start = |whole: Option<usize>| {
        let (mut lab, d) = first_sync(6, 40);
        while matches!(lab.catch_up_step(d, 64), CatchUp::Stepped) {}
        if let Some(n) = whole {
            lab.set_restore_whole(d, n);
        }
        let backup = lab.backup(d);
        lab.restore_warm(d, backup, None, &warm);
        (lab, d)
    };
    let (whole, d) = start(None);
    assert!(!whole.catching_up(d), "a start of what it does in one go ends caught up");
    let (mut parts, _) = start(Some(16));
    assert!(parts.catching_up(d), "a start of more ends catching up");
    assert!(parts.perf(d)["counts"]["restore: left to its catch-up"].as_u64().is_some_and(|n| n > 16));
    let mut steps = 0;
    while matches!(parts.catch_up_step(d, 64), CatchUp::Stepped) {
        steps += 1;
    }
    assert!(steps > 1, "its catch-up takes the rest a step at a time: {steps}");
    assert!(!parts.catching_up(d));
    let seen = |lab: &avendb::lab::Lab| {
        let entries: Vec<_> = lab.entries(d).into_iter().map(|e| (e, lab.item(d, e).map(|i| i.record()))).collect();
        (lab.log(d).ids().to_vec(), entries)
    };
    assert_eq!(seen(&parts), seen(&whole), "the same as a start that did it all in one go");
}

/// What a device takes in the middle of a catch-up a step at a time brings it one step on, not the whole of it: the
/// keys a pull brought after its pages (`Shared::bring_keys`, a `receive` that brings it up to date) ran an iPhone's
/// whole catch-up in one turn of 1.8 min, a whole replay of 47.6 s, its key index made again 27.9 s and its bodies
/// 26.3 s, and its page's worker, which runs the Lab, answered no peer meanwhile (2026-10-28, `taken_le` in
/// `CatchUpBudget.lean`). The catch-up's own steps bring the rest, to what one catch-up brings.
#[test]
fn what_a_device_takes_mid_catch_up_brings_it_one_step_on_not_the_whole() {
    let (mut once, d) = first_sync(6, 40);
    let (mut steps, _) = first_sync(6, 40);
    assert!(once.catch_up(d));
    assert!(matches!(steps.catch_up_step(d, 1), CatchUp::Stepped), "a catch-up under way");
    // the keys a pull brings after its last page, as `bring_keys` takes them
    steps.receive(d, vec![], vec![]);
    assert!(!steps.replay_current(d), "taking its keys replayed every edit in one turn");
    let mut taken = 0;
    while let CatchUp::Stepped = steps.catch_up_step(d, 1) {
        taken += 1;
        assert!(taken < 10_000, "a catch-up in steps ends");
    }
    assert!(taken > 10, "the rest came a step at a time: {taken} steps");
    assert!(once.state(d) == steps.state(d), "the same view");
    let seen = |lab: &avendb::lab::Lab| {
        let entries: Vec<_> = lab.entries(d).into_iter().map(|e| (e, lab.item(d, e).map(|i| i.record()))).collect();
        (lab.log(d).ids().to_vec(), entries)
    };
    assert_eq!(seen(&once), seen(&steps), "the same edits, entries and items as one catch-up");
}

/// A whole replay makes a device's key index again of every edit it holds; in a catch-up a step at a time it is made
/// a slice a step (`KeyIndexed::step`, `index` in `CatchUpBudget.lean`), never of them all in one step (27.9 s on an
/// iPhone, 2026-10-28), and ends the index one catch-up makes.
#[test]
fn a_key_index_made_again_is_made_a_slice_a_step() {
    let (mut once, d) = first_sync(6, 40);
    let (mut steps, _) = first_sync(6, 40);
    assert!(once.catch_up(d));
    let count = |lab: &avendb::lab::Lab, k: &str| lab.perf(d)["counts"][k].as_u64().unwrap_or(0);
    let made = count(&steps, "keys: index made");
    let mut taken = 0;
    while let CatchUp::Stepped = steps.catch_up_step(d, 1) {
        taken += 1;
        assert!(taken < 10_000, "a catch-up in steps ends");
    }
    let counts = &steps.perf(d)["counts"];
    assert_eq!(count(&steps, "keys: index made"), made, "no index made of every edit in one step: {counts}");
    assert_eq!(count(&steps, "keys: index begun a step"), 1, "made again once, a slice at a time: {counts}");
    assert!(count(&steps, "keys: index grown a step") > 2, "over several steps: {counts}");
    assert!(once.state(d) == steps.state(d), "the same view");
    let seen = |lab: &avendb::lab::Lab| {
        let entries: Vec<_> = lab.entries(d).into_iter().map(|e| (e, lab.item(d, e).map(|i| i.record()))).collect();
        (lab.log(d).ids().to_vec(), entries)
    };
    assert_eq!(seen(&once), seen(&steps), "the same edits, entries and items as one catch-up");
}

/// A removed device that once added another, by its vault's passkey, takes nothing away from a peer by its removal:
/// a vault's approval is its passkey's, never a device's, so that addition stands with the iPad gone. In the middle of
/// its catch-up the iPhone still answers its writer, a subset of what it answers once caught up (Fix E,
/// `StandingKeep.lean`). Until 2026-10-28 it answered nothing till caught up: the Mac never got the iPhone's chat
/// message while the iPhone caught up on Maia City.
#[test]
fn a_removal_of_a_device_that_added_another_still_lets_its_peers_be_answered_mid_catch_up() {
    let (mut lab, d, writer) = first_sync_with(6, 40, true, true);
    let asked = |lab: &mut avendb::lab::Lab| {
        let request = lab.request(writer, d);
        lab.reply(d, writer, &request, 1 << 30).0.into_iter().map(|s| s.edit.id()).collect::<Vec<_>>()
    };
    let (mut steps, mut mid) = (0, Vec::new());
    loop {
        let step = lab.catch_up_step(d, 1);
        steps += 1;
        assert!(steps < 10_000, "a catch-up in steps ends");
        if matches!(step, CatchUp::Caught(_)) {
            break;
        }
        // while the removal waits in its catch-up, which it answers no peer by (`Lab::answers_now`)
        if !lab.answers_now(d) {
            mid.push(asked(&mut lab));
            assert!(!lab.answers_now(d), "a peer's ask at step {steps} replayed every edit");
        }
    }
    let whole: std::collections::HashSet<_> = asked(&mut lab).into_iter().collect();
    assert!(!whole.is_empty(), "caught up, it hands its peer what it lacks");
    assert!(!mid.is_empty(), "the removal waits a step of its catch-up at least");
    let answered = mid.iter().filter(|page| !page.is_empty()).count();
    assert!(answered == mid.len(), "it answered the writer at {answered} of the {} steps the removal waited", mid.len());
    for page in &mid {
        assert!(page.iter().all(|id| whole.contains(id)), "mid its catch-up it hands over only what it hands once caught up");
    }
}

/// A probe of a device's memory takes its store out whole (`Lab::probe_store`) and leaves the Lab an empty one, so a
/// catch-up step taken after (a node's, which runs on while its probe weighs the parts) steps on a store that holds
/// together. Until 2026-10-28 the probe took the parts out in place: the log's edits went while its replay counted
/// them replayed, and the next step panicked, "range start index 20171 out of range for slice of length 0" (the Mac's
/// 20k unlock probe, `avendb-net/tests/unlock_memory.rs`).
#[test]
fn a_store_taken_out_for_a_probe_leaves_a_device_its_catch_up_steps_on() {
    let (mut lab, d) = first_sync(6, 40);
    for _ in 0..3 {
        assert!(matches!(lab.catch_up_step(d, 16), CatchUp::Stepped), "part way through its catch-up");
    }
    let held = lab.log(d).edits().len();
    let mut store = lab.probe_store(d).expect("its store");
    for part in ["log.edits", "log.ids", "replay.order", "signed", "log", "replay", "key_index", "bodies", "showing"] {
        assert!(store.part(part).is_some(), "{part} is a part of its store");
    }
    drop(store);
    let mut taken = 0;
    while let CatchUp::Stepped = lab.catch_up_step(d, 16) {
        taken += 1;
        assert!(taken < 100, "a catch-up of nothing ends");
    }
    assert!(held > 0 && lab.log(d).edits().is_empty(), "the Lab holds an empty store in its place");
    assert!(lab.entries(d).is_empty(), "and shows nothing of the store taken out");
}
