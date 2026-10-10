//! Devices split off the Lab to run on their own (P8): each holds only its own store and keys, and they sync by the
//! bytes they would send each other on the network, the requests, the replies and the McEliece keys fetched, and the
//! digests they announce. A device names to a peer, and announces to it, only the logs of the entries, cells and caps
//! that peer may receive, and the vault logs those name: nothing of any other entry or cell (T12). `avendb-net` carries
//! the same bytes over iroh.

mod common;

use std::collections::HashMap;

use avendb::id::{CellId, EditId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::policy::Action;
use avendb::sync::{place, LogId, Place};
use avendb::wire::{Announce, Reply, Request, Wire};
use common::*;

/// `to` asks `from` once, by the bytes alone: its request, the reply, and each McEliece key the reply names that
/// `from` hands out to it. How many edits were new to `to`.
fn ask(to: (&mut Lab, SignerId), from: (&mut Lab, SignerId)) -> usize {
    ask_page(to, from, None, usize::MAX).1
}

/// `ask`, for a page of the reply: the edits after place `after` that fit in `page` bytes, or the first of them. The
/// reply, and how many of its edits were new to `to`.
fn ask_page(to: (&mut Lab, SignerId), from: (&mut Lab, SignerId), after: Option<Place>, page: usize) -> (Reply, usize) {
    let ((to, t), (from, f)) = (to, from);
    let request = Request::from_wire(&Request { after, ..to.request(t, f) }.to_wire()).expect("a request");
    let (edits, ids, more) = from.reply(f, t, &request, page);
    let blobs = ids.iter().map(|&b| (b, [0; 32])).collect();
    let reply = Reply::from_wire(&Reply { edits, blobs, more }.to_wire()).expect("a reply");
    let keys = reply.blobs.iter().filter(|(b, _)| from.may_fetch(f, t, *b)).filter_map(|(b, _)| from.blob(f, *b));
    let new = to.receive(t, reply.edits.clone(), keys.collect());
    (reply, new)
}

/// The digests `from` announces to `to`, read back from their bytes.
fn announced(from: (&mut Lab, SignerId), to: SignerId) -> Vec<(LogId, [u8; 32])> {
    let digests = from.0.announce(from.1, to);
    Announce::from_wire(&Announce { digests }.to_wire()).expect("an announcement").digests
}

/// Alice's Mac, the server and Bob's Mac split off after scenario 4, each with its own randomness: the coop and
/// Alice's vault each give the server relay on all their entries, and nothing is written yet. The coop.
fn split() -> (World, VaultId, Lab, Lab, Lab) {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let alice = w.alice;
    relay_on(&mut w, alice);
    w.lab.sync_all(0);
    let mac = w.lab.split(w.mac_a, &[w.passkey_a], [1; 32]);
    let server = w.lab.split(w.server, &[], [2; 32]);
    let bob = w.lab.split(w.mac_b, &[w.passkey_b], [3; 32]);
    (w, coop, mac, server, bob)
}

#[test]
fn scenario_5_between_devices_split_off() {
    let (w, coop, mut mac, mut server, mut bob) = split();
    let welcome = document_v1("Welcome", WELCOME_TEXT, w.mac_a);
    let welcome = mac.create(w.mac_a, coop, coop, "doc", &[], welcome).expect("Alice's Mac writes Welcome on its own");
    // the server asks Alice's Mac, then Bob's Mac asks the server
    assert!(ask((&mut server, w.server), (&mut mac, w.mac_a)) > 0);
    assert!(ask((&mut bob, w.mac_b), (&mut server, w.server)) > 0);
    assert_eq!(text(&bob, w.mac_b, welcome, 2).as_deref(), Some(WELCOME_TEXT), "Bob's Mac reads Welcome");
    assert!(server.fetched(w.server, welcome) > 0, "the server holds Welcome's edits");
    let cell = KeyFam::Cell(coop, CellId::of(coop, &[]));
    let either = server.reads(w.server, welcome) || server.opens(w.server, cell);
    assert!(!either, "the server opens neither Welcome's key nor its cell's");
    assert!(server.meaning(w.server, welcome).is_none(), "nor reads what Welcome is");
    assert!(!contains(&server.store(w.server), WELCOME_TEXT), "Welcome's text appears nowhere in the server's store");
    // asked again, nobody has anything more to send
    assert_eq!(ask((&mut bob, w.mac_b), (&mut server, w.server)), 0);
    assert_eq!(ask((&mut server, w.server), (&mut mac, w.mac_a)), 0);
}

#[test]
fn a_device_names_only_the_logs_its_peer_may_hold() {
    let (w, coop, mut mac, _, _) = split();
    let alice = w.alice;
    let welcome = mac.create(w.mac_a, coop, coop, "doc", &[], document("Welcome", WELCOME_TEXT, w.mac_a));
    let welcome = welcome.expect("Alice's Mac writes Welcome for the coop");
    let diary = mac.create(w.mac_a, alice, alice, "note", &[], document("Diary", "Dear diary", w.mac_a));
    let diary = diary.expect("and her diary in her own vault");
    let (coops, alices) = (LogId::Cell(coop, CellId::of(coop, &[])), LogId::Cell(alice, CellId::of(alice, &[])));
    let to_stranger = mac.request(w.mac_a, w.stranger);
    assert_eq!(to_stranger, Request::default(), "a stranger is told nothing of what Alice's Mac holds");
    let names = |r: &Request, l: LogId| r.ask.haves.contains_key(&l);
    let to_bob = mac.request(w.mac_a, w.mac_b);
    assert!(names(&to_bob, LogId::Entry(welcome)) && names(&to_bob, coops), "Welcome and its cell, which Bob reaches");
    assert!(!names(&to_bob, LogId::Entry(diary)) && !names(&to_bob, alices), "not Alice's diary, nor its cell");
    let to_carol: Vec<LogId> = mac.request(w.mac_a, w.mac_c).ask.haves.into_keys().collect();
    assert_eq!(to_carol, [LogId::Vault(w.carol)], "Carol, who reaches neither vault, only her own vault's log");
    let to_phone = mac.request(w.mac_a, w.phone_a);
    assert!(names(&to_phone, LogId::Entry(diary)) && names(&to_phone, alices), "to Alice's iPhone they are named");
    let to_server = mac.request(w.mac_a, w.server);
    let both = [LogId::Entry(welcome), coops, LogId::Entry(diary), alices].iter().all(|&l| names(&to_server, l));
    assert!(both, "and to the server, which relays both vaults");
}

#[test]
fn announcements_tell_each_peer_of_its_own_logs_alone() {
    let (w, coop, mut mac, mut server, _) = split();
    let welcome = document("Welcome", WELCOME_TEXT, w.mac_a);
    let welcome = mac.create(w.mac_a, coop, coop, "doc", &[], welcome).expect("Welcome");
    let to_server = announced((&mut mac, w.mac_a), w.server);
    assert!(to_server.iter().any(|(l, _)| *l == LogId::Entry(welcome)), "the server hears of Welcome");
    assert!(server.differs(w.server, &to_server), "and asks, as its digests differ");
    let to_carol: Vec<LogId> = announced((&mut mac, w.mac_a), w.mac_c).into_iter().map(|(l, _)| l).collect();
    let what = "Carol, who reaches no entry, cell or cap of the coop's or Alice's, hears of her own vault alone";
    assert_eq!(to_carol, [LogId::Vault(w.carol)], "{what}");
    assert!(announced((&mut mac, w.mac_a), w.stranger).is_empty(), "a stranger hears of nothing");
    ask((&mut server, w.server), (&mut mac, w.mac_a));
    let again = announced((&mut mac, w.mac_a), w.server);
    assert!(!server.differs(w.server, &again), "once it has asked, the digests agree");
}

#[test]
fn mceliece_keys_go_only_within_reach() {
    let (w, coop, mut mac, mut server, mut bob) = split();
    // Alice's passkey removes her lost iPhone on her Mac: her vault's seed and the coop's rotate, and the public half
    // of each new seed, which keys are sealed to, brings a McEliece key
    let remove = Action::RemoveDevice { vault: w.alice, device: w.phone_a, keep: vec![] };
    mac.submit(w.mac_a, &[w.passkey_a], remove).expect("Alice's passkey removes the iPhone");
    let new: Vec<_> = mac.blob_ids(w.mac_a).into_iter().filter(|b| server.blob(w.server, *b).is_none()).collect();
    assert!(!new.is_empty(), "the new seeds bring McEliece keys");
    for &b in &new {
        assert!(mac.may_fetch(w.mac_a, w.server, b), "the server, relaying the coop's entries, may fetch it");
        assert!(mac.may_fetch(w.mac_a, w.mac_b, b), "so may Bob's Mac, acting for the coop");
        let outside = !mac.may_fetch(w.mac_a, w.mac_c, b) && !mac.may_fetch(w.mac_a, w.stranger, b);
        assert!(outside, "not Carol, nor a stranger");
    }
    ask((&mut server, w.server), (&mut mac, w.mac_a));
    assert!(new.iter().all(|b| server.blob(w.server, *b).is_some()), "the server fetched each with the vault logs");
    ask((&mut bob, w.mac_b), (&mut server, w.server));
    assert!(new.iter().all(|b| bob.blob(w.mac_b, *b).is_some()), "and hands it on to Bob's Mac");
    assert_eq!(bob.state(w.mac_b).epoch(KeyFam::Seed(coop)), 1, "which learns the coop's key rotated");
    assert!(bob.opens(w.mac_b, KeyFam::Seed(coop)), "and opens the new one");
    assert!(!server.opens(w.server, KeyFam::Seed(coop)), "which the server doesn't");
}

#[test]
fn devices_split_off_make_keys_of_their_own() {
    let (w, coop, mut mac, _, mut bob) = split();
    let a = mac.create(w.mac_a, coop, coop, "doc", &[], document("A", "a", w.mac_a)).expect("an entry on Alice's Mac");
    let b = bob.create(w.mac_b, coop, coop, "doc", &[], document("B", "b", w.mac_b)).expect("an entry on Bob's Mac");
    assert_ne!(a, b, "two devices split off draw different randomness");
    // the same seed replays the same: a failing test replays exactly
    let (w2, coop2, mut mac2, _, _) = split();
    let a2 = mac2.create(w2.mac_a, coop2, coop2, "doc", &[], document("A", "a", w2.mac_a)).expect("again");
    assert_eq!(a, a2);
}

/// Alice's Mac writes twelve notes for the coop on its own: a reply to the server too big for one small page.
fn twelve_notes(w: &World, coop: VaultId, mac: &mut Lab) {
    for i in 0..12 {
        let note = document(&format!("Note {i}"), "Seeds for the greenhouse.", w.mac_a);
        mac.create(w.mac_a, coop, coop, "note", &[], note).expect("Alice's Mac writes a note");
    }
}

#[test]
fn a_reply_comes_a_page_at_a_time_in_causal_order_and_loses_nothing() {
    let (w, coop, mut mac, mut server, _) = split();
    twelve_notes(&w, coop, &mut mac);
    // the whole reply: each edit once, by its place, so none comes ahead of an edit it builds on
    let request = server.request(w.server, w.mac_a);
    let (whole, _, more) = mac.reply(w.mac_a, w.server, &request, usize::MAX);
    assert!(!more && whole.len() > 12, "{} edits in one reply", whole.len());
    let places: Vec<Place> = whole.iter().map(|s| place(&s.edit)).collect();
    assert!(places.windows(2).all(|p| p[0] < p[1]), "by place, each edit once");
    let at: HashMap<EditId, usize> = places.iter().enumerate().map(|(i, p)| (p.1, i)).collect();
    for (i, s) in whole.iter().enumerate() {
        assert!(s.edit.parents.iter().filter_map(|p| at.get(p)).all(|&j| j < i), "an edit comes after its parents");
    }
    // a page of one byte holds one edit, and the server takes each page whole, at once: no edit waits for its past
    let (mut after, mut got) = (None, vec![]);
    loop {
        let (page, new) = ask_page((&mut server, w.server), (&mut mac, w.mac_a), after, 1);
        assert_eq!((page.edits.len(), new), (1, 1), "one edit a page, new each time");
        assert!(server.request(w.server, w.mac_a).ask.loose.is_empty(), "no edit of page {} waits", got.len());
        got.extend(page.edits.iter().map(|s| s.edit.id()));
        if !page.more {
            break;
        }
        after = page.edits.iter().map(|s| place(&s.edit)).max();
    }
    assert_eq!(got, places.iter().map(|p| p.1).collect::<Vec<_>>(), "the pages together are the reply");
    assert_eq!(ask((&mut server, w.server), (&mut mac, w.mac_a)), 0, "asked again, nothing is left");
}

#[test]
fn a_page_holds_what_fits_and_at_least_one_edit() {
    let (w, coop, mut mac, mut server, _) = split();
    twelve_notes(&w, coop, &mut mac);
    let (mut after, mut pages) = (None, 0);
    loop {
        let (page, _) = ask_page((&mut server, w.server), (&mut mac, w.mac_a), after, 8 << 10);
        let size: usize = page.edits.iter().map(|s| s.to_wire().len()).sum();
        assert!(size <= 8 << 10 || page.edits.len() == 1, "{size} bytes in {} edits", page.edits.len());
        pages += 1;
        if !page.more {
            break;
        }
        after = page.edits.iter().map(|s| place(&s.edit)).max();
    }
    assert!(pages > 1, "more than one page");
    assert_eq!(ask((&mut server, w.server), (&mut mac, w.mac_a)), 0, "the pages together are the reply");
}
