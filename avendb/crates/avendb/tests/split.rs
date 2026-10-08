//! Devices split off the Lab to run on their own (P8): each holds only its own store and keys, and they sync by the
//! bytes they would send each other on the network, the requests, the replies and the McEliece keys fetched, and the
//! digests they announce. `avendb-net` carries the same bytes over iroh.

mod common;

use common::*;
use avendb::id::{SignerId, SpaceId};
use avendb::keys::KeyScope;
use avendb::lab::Lab;
use avendb::policy::{Action, Role, Scope};
use avendb::sync::LogId;
use avendb::wire::{Announce, Reply, Request, Wire};

/// `to` asks `from` once, by the bytes alone: its request, the reply, and each McEliece key the reply names that
/// `from` hands out to it. How many ops were new to `to`.
fn ask(to: (&mut Lab, SignerId), from: (&mut Lab, SignerId)) -> usize {
    let ((to, t), (from, f)) = (to, from);
    let request = Request::from_wire(&to.request(t, f).to_wire()).expect("a request");
    let (ops, ids) = from.reply(f, t, &request);
    let reply = Reply::from_wire(&Reply { ops, blobs: ids.iter().map(|&b| (b, [0; 32])).collect() }.to_wire());
    let reply = reply.expect("a reply");
    let blobs = reply.blobs.iter().filter(|(b, _)| from.may_fetch(f, t, *b)).filter_map(|(b, _)| from.blob(f, *b));
    to.receive(t, reply.ops, blobs.collect())
}

/// The digests `from` announces to `to`, read back from their bytes.
fn announced(from: (&mut Lab, SignerId), to: SignerId) -> Vec<(LogId, [u8; 32])> {
    let digests = from.0.announce(from.1, to);
    Announce::from_wire(&Announce { digests }.to_wire()).expect("an announcement").digests
}

/// Samuel's Mac, the server and Bob's Mac split off after scenario 4, each with its own randomness.
fn split() -> (World, (SpaceId, SpaceId, avendb::id::VaultId), Lab, Lab, Lab) {
    let mut w = world();
    let (coop, space, notes) = handbook_spaces(&mut w);
    let mac = w.lab.split(w.mac_s, &[w.passkey_s], [1; 32]);
    let server = w.lab.split(w.server, &[], [2; 32]);
    let bob = w.lab.split(w.mac_b, &[w.passkey_b], [3; 32]);
    (w, (space, notes, coop), mac, server, bob)
}

#[test]
fn scenario_5_between_devices_split_off() {
    let (w, (space, _, coop), mut mac, mut server, mut bob) = split();
    let welcome = document_v1("Welcome", WELCOME_TEXT, w.mac_s);
    let welcome = mac.create(w.mac_s, coop, space, welcome).expect("Samuel's Mac writes Welcome on its own");
    // the server asks Samuel's Mac, then Bob's Mac asks the server
    assert!(ask((&mut server, w.server), (&mut mac, w.mac_s)) > 0);
    assert!(ask((&mut bob, w.mac_b), (&mut server, w.server)) > 0);
    assert_eq!(text(&bob, w.mac_b, space, welcome, 2).as_deref(), Some(WELCOME_TEXT), "Bob's Mac reads Welcome");
    assert!(server.fetched(w.server, space, welcome) > 0, "the server holds Welcome's edits");
    let opens = |k| server.opens(w.server, k);
    let either = opens(KeyScope::Entry(space, welcome)) || opens(KeyScope::Space(space));
    assert!(!either, "the server opens neither Welcome's key nor the Handbook's");
    assert!(!contains(&server.store(w.server), WELCOME_TEXT), "Welcome's text appears nowhere in the server's store");
    // asked again, nobody has anything more to send
    assert_eq!(ask((&mut bob, w.mac_b), (&mut server, w.server)), 0);
    assert_eq!(ask((&mut server, w.server), (&mut mac, w.mac_s)), 0);
}

#[test]
fn a_device_names_only_the_logs_its_peer_may_hold() {
    let (w, (space, notes, _), mac, _, _) = split();
    let to_stranger = mac.request(w.mac_s, w.stranger);
    assert_eq!(to_stranger, Request::default(), "a stranger is told nothing of what Samuel's Mac holds");
    let to_bob = mac.request(w.mac_s, w.mac_b);
    assert!(to_bob.ask.haves.contains_key(&LogId::Space(space)), "the Handbook, which Bob reaches, is named");
    assert!(!to_bob.ask.haves.contains_key(&LogId::Space(notes)), "Samuel's Notes are not");
    let to_phone = mac.request(w.mac_s, w.phone_s);
    assert!(to_phone.ask.haves.contains_key(&LogId::Space(notes)), "to Samuel's iPhone they are");
}

#[test]
fn announcements_tell_each_peer_of_its_own_logs_alone() {
    let (w, (space, notes, coop), mut mac, mut server, _) = split();
    let welcome = mac.create(w.mac_s, coop, space, document("Welcome", WELCOME_TEXT, w.mac_s)).expect("Welcome");
    let to_server = announced((&mut mac, w.mac_s), w.server);
    assert!(to_server.iter().any(|(l, _)| *l == LogId::Entry(space, welcome)), "the server hears of Welcome");
    assert!(server.differs(w.server, &to_server), "and asks, as its digests differ");
    let to_carol = announced((&mut mac, w.mac_s), w.mac_c);
    let handbook = |l: &LogId| matches!(l, LogId::Space(sp) | LogId::Entry(sp, _) if *sp == space || *sp == notes);
    assert!(!to_carol.iter().any(|(l, _)| handbook(l)), "Carol, who reaches neither space, hears of neither");
    assert!(announced((&mut mac, w.mac_s), w.stranger).is_empty(), "a stranger hears of nothing");
    ask((&mut server, w.server), (&mut mac, w.mac_s));
    let again = announced((&mut mac, w.mac_s), w.server);
    assert!(!server.differs(w.server, &again), "once it has asked, the digests agree");
}

#[test]
fn mceliece_keys_go_only_within_reach() {
    let (w, (_, _, coop), mut mac, mut server, mut bob) = split();
    // the coop founds a space on Samuel's Mac, whose new key is sealed to through its McEliece key
    let found = mac.submit(w.mac_s, &[w.mac_s], Action::FoundSpace { actor: coop, nonce: 7 }).expect("a space");
    let garden = SpaceId::from(found);
    let relay = grant(Scope::Space(garden), Role::Relay, vault(w.server_vault), coop, None);
    mac.submit(w.mac_s, &[w.mac_s], relay).expect("the server relays it");
    let new: Vec<_> = mac.blob_ids(w.mac_s).into_iter().filter(|b| server.blob(w.server, *b).is_none()).collect();
    assert!(!new.is_empty(), "the space's key brings a McEliece key");
    for &b in &new {
        assert!(mac.may_fetch(w.mac_s, w.server, b), "the server, relaying the space, may fetch it");
        assert!(mac.may_fetch(w.mac_s, w.mac_b, b), "so may Bob's Mac, acting for the coop");
        let outside = !mac.may_fetch(w.mac_s, w.mac_c, b) && !mac.may_fetch(w.mac_s, w.stranger, b);
        assert!(outside, "not Carol, nor a stranger");
    }
    ask((&mut server, w.server), (&mut mac, w.mac_s));
    assert!(new.iter().all(|b| server.blob(w.server, *b).is_some()), "the server fetched each with the space's log");
    ask((&mut bob, w.mac_b), (&mut server, w.server));
    assert!(new.iter().all(|b| bob.blob(w.mac_b, *b).is_some()), "and hands it on to Bob's Mac");
    assert!(bob.opens(w.mac_b, KeyScope::Space(garden)), "which opens the new space's key");
}

#[test]
fn devices_split_off_make_keys_of_their_own() {
    let (w, (space, _, coop), mut mac, _, mut bob) = split();
    let a = mac.create(w.mac_s, coop, space, document("A", "a", w.mac_s)).expect("an entry on Samuel's Mac");
    let b = bob.create(w.mac_b, coop, space, document("B", "b", w.mac_b)).expect("an entry on Bob's Mac");
    assert_ne!(a, b, "two devices split off draw different randomness");
    // the same seed replays the same: a failing test replays exactly
    let (w2, (space2, _, coop2), mut mac2, _, _) = split();
    let a2 = mac2.create(w2.mac_s, coop2, space2, document("A", "a", w2.mac_s)).expect("again");
    assert_eq!(a, a2);
}
