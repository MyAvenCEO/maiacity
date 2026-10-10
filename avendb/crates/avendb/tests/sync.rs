//! Sync on the Lab (P6): every edit is in one log, a vault's, a cap's, a cell's or an entry's, and devices ask each
//! other with what they hold of each log, gossip one digest per log and ask only where one differs, go offline and come
//! back, and come back from old backups, which forks what they sign next. A peer sends a device the logs of the entries
//! and cells it reaches, and nothing about the others (T12): an entry a steward moves out of a device's reach stops
//! syncing to it, and the device never hears of the move.

mod common;

use avendb::doc::Item;
use avendb::id::{CellId, SignerId};
use avendb::lab::Lab;
use avendb::lens::Status;
use avendb::policy::Role;
use avendb::sync::{log_of, LogId};
use common::*;

/// Every ordered pair of `ds`.
fn pairs(ds: &[SignerId]) -> Vec<(SignerId, SignerId)> {
    ds.iter().flat_map(|&a| ds.iter().filter(move |&&b| b != a).map(move |&b| (a, b))).collect()
}

fn devices(w: &World) -> [SignerId; 7] {
    [w.mac_a, w.phone_a, w.mac_b, w.mac_c, w.mac_d, w.server, w.stranger]
}

/// The logs of the edits device `d` holds.
fn logs(lab: &Lab, d: SignerId) -> Vec<LogId> {
    lab.log(d).edits().iter().filter_map(|edit| log_of(edit, edit.id())).collect()
}

#[test]
fn a_second_sync_sends_nothing() {
    let mut w = world();
    handbook(&mut w);
    w.lab.sync_all(1);
    for (from, to) in pairs(&devices(&w)) {
        assert_eq!(w.lab.sync(from, to), 0, "{from:?} to {to:?}");
    }
    // and gossip asks nobody
    assert_eq!(w.lab.sync_all(2), 0);
}

#[test]
fn an_edit_sends_only_what_is_new_both_ways() {
    let mut w = world();
    let h = handbook(&mut w);
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    // the server, behind, is sent the edit and the checkpoint the Mac makes before it answers
    assert_eq!(w.lab.sync(w.mac_a, w.server), 2);
    // the Mac, ahead, names edits further back than its newest, so the server finds what they share and sends nothing
    assert_eq!(w.lab.sync(w.server, w.mac_a), 0);
    assert_eq!(w.lab.sync(w.server, w.mac_b), 2);
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
}

#[test]
fn devices_that_synced_gossip_the_same_digests() {
    let mut w = world();
    let h = handbook(&mut w);
    let digests = |lab: &mut Lab, d| lab.digests(d).clone();
    let mac = digests(&mut w.lab, w.mac_a);
    // Alice's two devices hold the same edits
    assert_eq!(mac, digests(&mut w.lab, w.phone_a));
    // and of every log two devices both hold, they hold the same edits
    for (a, b) in pairs(&devices(&w)) {
        let (da, db) = (digests(&mut w.lab, a), digests(&mut w.lab, b));
        for (l, x) in &da {
            assert!(db.get(l).is_none_or(|y| y == x), "{a:?} and {b:?} differ on {l:?}");
        }
    }
    // an edit changes the digest of its entry's log alone, not its cell's nor its vault's
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    let after = digests(&mut w.lab, w.mac_a);
    let changed: Vec<_> = after.iter().filter(|(l, x)| mac.get(l) != Some(x)).map(|(l, _)| *l).collect();
    assert_eq!(changed, [LogId::Entry(h.welcome)]);
}

#[test]
fn an_offline_device_neither_sends_nor_receives() {
    let mut w = world();
    let h = handbook(&mut w);
    w.lab.set_online(w.mac_b, false);
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.edit(w.mac_b, h.coop, h.welcome, |i| i.set_text(1, "Bob's title, offline")).unwrap();
    assert_eq!(w.lab.sync(w.mac_a, w.mac_b), 0);
    assert_eq!(w.lab.sync(w.mac_b, w.mac_a), 0);
    w.lab.sync_all(3);
    assert!(!w.lab.online(w.mac_b));
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    assert_eq!(text(&w.lab, w.mac_a, h.welcome, 1).as_deref(), Some("Welcome"));
    // back online, both edits reach everyone who reads Welcome
    w.lab.set_online(w.mac_b, true);
    w.lab.sync_all(3);
    for d in [w.mac_a, w.phone_a, w.mac_b] {
        assert_eq!(text(&w.lab, d, h.welcome, 1).as_deref(), Some("Bob's title, offline"), "{d:?}");
        assert_eq!(text(&w.lab, d, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "{d:?}");
    }
}

#[test]
fn a_device_restored_from_an_old_backup_forks_and_every_peer_sees_it() {
    let mut w = world();
    let h = handbook(&mut w);
    let backup = w.lab.backup(w.phone_a);
    let first = w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(2, "From the iPhone")).unwrap();
    w.lab.sync_all(4);
    assert!(devices(&w).iter().all(|&d| w.lab.forks(d).is_empty()));
    // the iPhone comes back from the backup, which lacks its edit, and edits again from that past
    w.lab.restore_backup(w.phone_a, &backup);
    assert!(w.lab.reads(w.phone_a, h.welcome), "restored, the iPhone holds Welcome's key again");
    let again = |i: &mut Item| i.set_text(2, "From the restored iPhone");
    let second = w.lab.edit(w.phone_a, h.coop, h.welcome, again).unwrap();
    w.lab.sync_all(4);
    // its two edits build on the same past, neither on the other: every device that holds both flags them
    let pair = (first.min(second), first.max(second));
    for d in [w.mac_a, w.phone_a, w.mac_b, w.server] {
        assert!(w.lab.forks(d).contains(&pair), "{d:?}");
    }
    // Carol, Dave and the stranger hold neither
    for d in [w.mac_c, w.mac_d, w.stranger] {
        assert!(w.lab.forks(d).is_empty(), "{d:?}");
    }
    // both edits still count, and every device shows the same Welcome
    let shown: Vec<_> = [w.mac_a, w.phone_a, w.mac_b].iter().map(|&d| text(&w.lab, d, h.welcome, 2)).collect();
    assert!(shown.iter().all(|t| t.is_some() && *t == shown[0]), "{shown:?}");
}

#[test]
fn every_order_of_delivery_ends_the_same() {
    // three devices edit Welcome at the same moment, two of them offline; whatever order the devices then meet in,
    // every device that reads Welcome shows the same document, the same one each time, and of every log two devices
    // both hold, they hold the same edits
    let mut first = None;
    for seed in 0..6 {
        let mut w = world();
        let h = handbook(&mut w);
        w.lab.set_online(w.mac_b, false);
        w.lab.set_online(w.phone_a, false);
        w.lab.edit(w.mac_b, h.coop, h.welcome, |i| i.set_text(1, "Bob's title")).unwrap();
        w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(2, "From the iPhone")).unwrap();
        w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
        w.lab.sync_all(seed);
        w.lab.set_online(w.mac_b, true);
        w.lab.set_online(w.phone_a, true);
        w.lab.sync_all(seed);
        let shown: Vec<_> = [w.mac_a, w.phone_a, w.mac_b, w.server]
            .iter()
            .map(|&d| w.lab.item(d, h.welcome).and_then(|i| i.as_document()))
            .collect();
        // the server relays Welcome and reads none of it
        assert!(shown[3].is_none(), "seed {seed}");
        assert!(shown[..3].iter().all(|s| s.is_some() && *s == shown[0]), "seed {seed}: {shown:?}");
        assert_eq!(*first.get_or_insert_with(|| shown[0].clone()), shown[0], "seed {seed}");
        for (a, b) in pairs(&devices(&w)) {
            let (da, db) = (w.lab.digests(a).clone(), w.lab.digests(b).clone());
            assert!(da.iter().all(|(l, x)| db.get(l).is_none_or(|y| y == x)), "seed {seed}: {a:?} and {b:?}");
        }
        assert!(devices(&w).iter().all(|&d| w.lab.forks(d).is_empty()), "seed {seed}");
    }
}

#[test]
fn a_device_receives_the_logs_of_the_cells_it_reaches_and_nothing_of_the_others() {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, mac) = (w.alice, w.bob, w.mac_a);
    let work = cap(alice, vault(bob), Role::Read, tagged("todo", "work"));
    let work = w.lab.issue(mac, &[mac], work).expect("Alice shares her todos tagged work with Bob");
    w.lab.sync_all(5);
    // Bob's Mac holds the logs of the two work todos, of the cell her Mac moved them into, and of Bob's cap
    let held = logs(&w.lab, w.mac_b);
    let theirs = CellId::of(alice, &[work]);
    for l in [LogId::Entry(lib.door), LogId::Entry(lib.solar), LogId::Cell(alice, theirs), LogId::Cap(work)] {
        assert!(held.contains(&l), "Bob's Mac holds {l:?}");
    }
    // and nothing of the seeds, the plan or the diary, not even the cell they sit in, the cell of no caps
    for e in [lib.seeds, lib.plan, lib.diary] {
        assert!(!held.contains(&LogId::Entry(e)), "{e:?}");
        assert_eq!(w.lab.fetched(w.mac_b, e), 0, "{e:?}");
    }
    assert!(!held.contains(&LogId::Cell(alice, CellId::of(alice, &[]))), "nor the cell of no caps");
    // the server, which relays the whole vault through avenCEO's wide cap, holds every entry's log
    let relayed = logs(&w.lab, w.server);
    assert!(lib.all().iter().all(|&e| relayed.contains(&LogId::Entry(e))));
}

#[test]
fn an_entry_that_leaves_a_devices_reach_stops_syncing_to_it() {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, mac, bobs) = (w.alice, w.bob, w.mac_a, w.mac_b);
    let work = cap(alice, vault(bob), Role::Write, tagged("todo", "work"));
    let work = w.lab.issue(mac, &[mac], work).expect("Alice shares her todos tagged work with Bob");
    w.lab.sync_all(6);
    let solar = LogId::Entry(lib.solar);
    let named = |lab: &mut Lab| lab.announce(mac, bobs).iter().any(|(l, _)| *l == solar);
    assert!(named(&mut w.lab), "her Mac tells Bob's Mac of the solar todo");
    let had = w.lab.fetched(w.mac_b, lib.solar);
    w.lab.tag(mac, alice, lib.solar, &[], &["work"]).expect("Alice takes the work tag off the solar todo");
    w.lab.edit(mac, alice, lib.solar, |i| {
        i.edit_todo(|t| t.notes = AFTER_TEXT.into());
    })
    .expect("and writes a note on it");
    // her Mac, a steward, moved it to the cell of no caps, out of Bob's reach: it no longer tells Bob's Mac of the
    // todo's log, in what it announces or in what it asks
    let none = Some(CellId::of(alice, &[]));
    assert_eq!(w.lab.state(mac).entry(lib.solar).map(|en| en.cell()), none);
    assert!(!named(&mut w.lab));
    assert!(!w.lab.request(mac, w.mac_b).ask.haves.contains_key(&solar));
    w.lab.sync_all(6);
    assert_eq!(w.lab.fetched(w.mac_b, lib.solar), had, "Bob's Mac fetches nothing of it since");
    // it never hears of the move: by its own view the todo is still in the cell of Bob's cap
    let still = Some(CellId::of(alice, &[work]));
    assert_eq!(w.lab.state(w.mac_b).entry(lib.solar).map(|en| en.cell()), still);
    assert!(!contains(&w.lab.store(w.mac_b), AFTER_TEXT), "nor sees the note written after it left");
    // the door todo, still in that cell, syncs on: Bob checks it off and Alice sees it
    w.lab.edit(w.mac_b, bob, lib.door, |i| i.set_status(Status::Done)).expect("Bob checks it off");
    w.lab.sync_all(6);
    assert_eq!(status(&w.lab, mac, lib.door), Some(Status::Done));
    // and nothing new reaches anyone once they have synced, though Bob's Mac, behind on the solar todo for good, still
    // sends the devices ahead of it a little of what it holds of it, which they hold already
    for (from, to) in pairs(&devices(&w)) {
        let before = w.lab.size(to);
        w.lab.sync(from, to);
        assert_eq!(w.lab.size(to), before, "{from:?} to {to:?}");
    }
}
