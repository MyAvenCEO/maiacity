//! Sync on the Lab (P6): devices ask each other with what they hold of each log, gossip one digest per log and ask only
//! where one differs, go offline and come back, and come back from old backups, which forks what they sign next.

mod common;

use common::*;
use avendb::id::SignerId;
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::sync::LogId;

/// Every ordered pair of `ds`.
fn pairs(ds: &[SignerId]) -> Vec<(SignerId, SignerId)> {
    ds.iter().flat_map(|&a| ds.iter().filter(move |&&b| b != a).map(move |&b| (a, b))).collect()
}

fn devices(w: &World) -> [SignerId; 7] {
    [w.mac_a, w.phone_a, w.mac_b, w.mac_c, w.mac_d, w.server, w.stranger]
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
    w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    // the server, behind, is sent the edit and the checkpoint the Mac makes before it answers
    assert_eq!(w.lab.sync(w.mac_a, w.server), 2);
    // the Mac, ahead, names ops further back than its newest, so the server finds what they share and sends nothing
    assert_eq!(w.lab.sync(w.server, w.mac_a), 0);
    assert_eq!(w.lab.sync(w.server, w.mac_b), 2);
    assert_eq!(text(&w.lab, w.mac_b, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
}

#[test]
fn devices_that_synced_gossip_the_same_digests() {
    let mut w = world();
    let h = handbook(&mut w);
    let digests = |lab: &mut Lab, d| lab.digests(d).clone();
    let mac = digests(&mut w.lab, w.mac_a);
    // Alice's two devices hold the same ops
    assert_eq!(mac, digests(&mut w.lab, w.phone_a));
    // and of every log two devices both hold, they hold the same ops
    for (a, b) in pairs(&devices(&w)) {
        let (da, db) = (digests(&mut w.lab, a), digests(&mut w.lab, b));
        for (l, x) in &da {
            assert!(db.get(l).is_none_or(|y| y == x), "{a:?} and {b:?} differ on {l:?}");
        }
    }
    // an edit changes the digest of its entry's log alone
    w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    let after = digests(&mut w.lab, w.mac_a);
    let changed: Vec<_> = after.iter().filter(|(l, x)| mac.get(l) != Some(x)).map(|(l, _)| *l).collect();
    assert_eq!(changed, [LogId::Entry(h.space, h.welcome)]);
}

#[test]
fn an_offline_device_neither_sends_nor_receives() {
    let mut w = world();
    let h = handbook(&mut w);
    w.lab.set_online(w.mac_b, false);
    w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.edit(w.mac_b, h.coop, h.space, h.welcome, |i| i.set_text(1, "Bob's title, offline")).unwrap();
    assert_eq!(w.lab.sync(w.mac_a, w.mac_b), 0);
    assert_eq!(w.lab.sync(w.mac_b, w.mac_a), 0);
    w.lab.sync_all(3);
    assert!(!w.lab.online(w.mac_b));
    assert_eq!(text(&w.lab, w.mac_b, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    assert_eq!(text(&w.lab, w.mac_a, h.space, h.welcome, 1).as_deref(), Some("Welcome"));
    // back online, both edits reach everyone who reads Welcome
    w.lab.set_online(w.mac_b, true);
    w.lab.sync_all(3);
    for d in [w.mac_a, w.phone_a, w.mac_b] {
        assert_eq!(text(&w.lab, d, h.space, h.welcome, 1).as_deref(), Some("Bob's title, offline"), "{d:?}");
        assert_eq!(text(&w.lab, d, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "{d:?}");
    }
}

#[test]
fn a_device_restored_from_an_old_backup_forks_and_every_peer_sees_it() {
    let mut w = world();
    let h = handbook(&mut w);
    let backup = w.lab.backup(w.phone_a);
    let first = w.lab.edit(w.phone_a, h.coop, h.space, h.welcome, |i| i.set_text(2, "From the iPhone")).unwrap();
    w.lab.sync_all(4);
    assert!(devices(&w).iter().all(|&d| w.lab.forks(d).is_empty()));
    // the iPhone comes back from the backup, which lacks its edit, and edits again from that past
    w.lab.restore_backup(w.phone_a, &backup);
    assert!(w.lab.opens(w.phone_a, KeyScope::Entry(h.space, h.welcome)));
    let again = |i: &mut avendb::doc::Item| i.set_text(2, "From the restored iPhone");
    let second = w.lab.edit(w.phone_a, h.coop, h.space, h.welcome, again).unwrap();
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
    let shown: Vec<_> = [w.mac_a, w.phone_a, w.mac_b].iter().map(|&d| text(&w.lab, d, h.space, h.welcome, 2)).collect();
    assert!(shown.iter().all(|t| t.is_some() && *t == shown[0]), "{shown:?}");
}

#[test]
fn every_order_of_delivery_ends_the_same() {
    // three devices edit Welcome at the same moment, two of them offline; whatever order the devices then meet in,
    // every device that reads Welcome shows the same document, the same one each time, and of every log two devices
    // both hold, they hold the same ops
    let mut first = None;
    for seed in 0..6 {
        let mut w = world();
        let h = handbook(&mut w);
        w.lab.set_online(w.mac_b, false);
        w.lab.set_online(w.phone_a, false);
        w.lab.edit(w.mac_b, h.coop, h.space, h.welcome, |i| i.set_text(1, "Bob's title")).unwrap();
        w.lab.edit(w.phone_a, h.coop, h.space, h.welcome, |i| i.set_text(2, "From the iPhone")).unwrap();
        w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
        w.lab.sync_all(seed);
        w.lab.set_online(w.mac_b, true);
        w.lab.set_online(w.phone_a, true);
        w.lab.sync_all(seed);
        let shown: Vec<_> = [w.mac_a, w.phone_a, w.mac_b, w.server]
            .iter()
            .map(|&d| w.lab.item(d, h.space, h.welcome).and_then(|i| i.as_document()))
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
