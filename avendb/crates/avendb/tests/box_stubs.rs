//! Box stubs on the Lab (`spec/AvenDB/LazyBoxes.lean`, S1 to S5): a fresh device's first sync takes every edit but the
//! boxes it needs not now, each held back as a stub (its id, log, depth and parents) that counts as held when it asks
//! and enters nothing it knows; it knows what a device that took them all knows; asked to fetch them, it is sent their
//! bodies, checks each against its stub, and ends holding what that device holds. A stub that lies is caught when its
//! body comes, and changes nothing the device knows once it has.

mod common;

use std::collections::BTreeSet;

use avendb::id::{EditId, SignerId};
use avendb::lab::{Lab, ReplyScope};
use avendb::lazy::is_box;
use avendb::policy::{Action, Sharing};
use avendb::sync::Stub;
use avendb::wire::Wire;
use common::*;

/// The handbook world, three more documents and an edit of Welcome, and two new iPads of Alice's that hold nothing
/// yet: one to sync lazily, one to sync whole, to hold it up against.
fn ready() -> (World, Handbook, SignerId, SignerId) {
    let mut w = world();
    let h = handbook(&mut w);
    for (title, body) in [("Charter", CHARTER_TEXT), ("Seeds", "Tomatoes in March."), ("Rota", "Bob waters on Mondays.")] {
        let doc = document(title, body, w.mac_a);
        w.lab.create(w.mac_a, h.coop, h.coop, "doc", &[], doc).expect("a document");
    }
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    let mut add = |name: &str| {
        let ipad = w.lab.device_of(w.passkey_a, name);
        let share = Action::Share(Sharing::Device { vault: w.alice, device: ipad, seal_to: None });
        w.lab.submit(w.mac_a, &[w.passkey_a, ipad], share).expect("Alice adds an iPad");
        w.lab.set_online(ipad, false);
        ipad
    };
    let (lazy, whole) = (add("Alice's iPad"), add("Alice's other iPad"));
    // every other device takes the new devices and boxes them their keys
    w.lab.sync_all(7);
    w.lab.set_online(lazy, true);
    w.lab.set_online(whole, true);
    (w, h, lazy, whole)
}

fn ids(lab: &Lab, d: SignerId) -> BTreeSet<EditId> {
    lab.log(d).ids().iter().copied().collect()
}

/// Of the edits device `d` holds, those of `of`: what it took from there, beside what it made itself.
fn from(lab: &Lab, d: SignerId, of: &BTreeSet<EditId>) -> BTreeSet<EditId> {
    ids(lab, d).intersection(of).copied().collect()
}

/// What device `d` holds that `of` holds not, by kind: what it made itself.
fn own(lab: &Lab, d: SignerId, of: &BTreeSet<EditId>) -> Vec<String> {
    let kind = |a: &Action| format!("{a:?}").chars().take_while(|c| c.is_alphanumeric()).collect::<String>();
    lab.log(d).edits().iter().filter(|e| !of.contains(&e.id())).map(|e| kind(&e.action)).collect()
}

/// The bytes on the wire of the edits device `d` holds, signatures and all.
fn bytes(lab: &Lab, d: SignerId) -> usize {
    let backup = lab.backup(d);
    backup.signed().iter().map(|s| s.to_wire().len()).sum()
}

#[test]
fn a_fresh_device_takes_only_the_boxes_it_opens_now_and_converges_once_it_fetches_the_rest() {
    let (mut w, h, lazy, whole) = ready();
    w.lab.set_lazy_boxes(lazy, true);
    let first = w.lab.sync(w.mac_a, lazy);
    let full = w.lab.sync(w.mac_a, whole);
    let stubs = w.lab.stubs(lazy);
    assert!(!stubs.is_empty(), "boxes held back");
    let mac = ids(&w.lab, w.mac_a);
    println!("made on their own: lazy {:?}, whole {:?}", own(&w.lab, lazy, &mac), own(&w.lab, whole, &mac));
    let (mine, all) = (from(&w.lab, lazy, &mac), from(&w.lab, whole, &mac));
    let stubbed: BTreeSet<EditId> = stubs.iter().map(|s| s.id).collect();
    // it holds what the whole iPad took but the stubs, and every stub is a box that iPad holds; while it holds stubs
    // it makes no key upkeep of its own, which can't tell what they box
    assert_eq!(first + stubs.len(), full);
    assert!(own(&w.lab, lazy, &mac).is_empty());
    assert!(stubbed.is_disjoint(&mine));
    assert_eq!(mine.union(&stubbed).copied().collect::<BTreeSet<_>>(), all);
    let edits = w.lab.log(whole).edits();
    let boxes = |set: &BTreeSet<EditId>| edits.iter().filter(|e| set.contains(&e.id()) && is_box(e)).count();
    assert_eq!(boxes(&stubbed), stubbed.len(), "only boxes are held back");
    // and it knows what that iPad knows, and reads the handbook as it does (S1, L1): the boxes it took open its keys
    assert_eq!(w.lab.state(lazy), w.lab.state(whole));
    for e in [h.welcome, h.onboarding] {
        assert!(w.lab.reads(lazy, e) && w.lab.reads(whole, e), "{e:?}");
    }
    assert_eq!(text(&w.lab, lazy, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    let (lazy_bytes, whole_bytes) = (bytes(&w.lab, lazy), bytes(&w.lab, whole));
    println!(
        "LAZY first sync: {} edits / {lazy_bytes} bytes, {} boxes held back; whole: {} edits / {whole_bytes} bytes",
        mine.len(),
        stubs.len(),
        all.len()
    );
    assert!(lazy_bytes < whole_bytes);
    // a second sync sends nothing more while it counts its stubs as held
    assert_eq!(w.lab.sync(w.mac_a, lazy), 0);
    // fetched, the bodies come, check against their stubs, and it holds and knows what the whole iPad does (S2)
    w.lab.fetch_withheld(lazy);
    assert_eq!(w.lab.sync(w.mac_a, lazy), stubs.len());
    assert!(w.lab.stubs(lazy).is_empty() && w.lab.stub_liars(lazy).is_empty());
    assert!(w.lab.stubs_unanswered(lazy).is_empty());
    assert_eq!(from(&w.lab, lazy, &mac), all);
    assert_eq!(w.lab.state(lazy), w.lab.state(whole));
    assert_eq!(w.lab.sync(w.mac_a, lazy), 0);
}

#[test]
fn a_stub_that_lies_is_caught_when_its_body_comes_and_changes_nothing() {
    let (mut w, h, lazy, whole) = ready();
    w.lab.sync(w.mac_a, whole);
    w.lab.set_lazy_boxes(lazy, true);
    // a dishonest relay's stubs: one deeper than its body, one built on nothing
    let request = w.lab.request(lazy, w.mac_a);
    let mut stubs = w.lab.withheld(w.mac_a, lazy, &request, &ReplyScope::All);
    assert!(stubs.len() >= 2);
    stubs[0].depth += 1;
    stubs[1].parents.clear();
    let lied: BTreeSet<EditId> = [stubs[0].id, stubs[1].id].into();
    // and one of no edit at all, whose body never comes
    let forged = Stub { id: EditId([7; 32]), ..stubs[0].clone() };
    stubs.push(forged.clone());
    stubs.sort();
    assert_eq!(w.lab.receive_stubs(lazy, w.mac_a, stubs.clone()), stubs.len());
    w.lab.sync(w.mac_a, lazy);
    // the lies enter nothing it knows and open nothing (S1, S4): it holds only edits its peer holds. A lie about
    // parents may make it claim edits it lacks, which its peer then holds back till it asks for the bodies: a wait,
    // no loss (S3)
    let mac = ids(&w.lab, w.mac_a);
    assert!(ids(&w.lab, lazy).is_subset(&mac));
    assert!(w.lab.stub_liars(lazy).is_empty());
    // fetched, the bodies come and the two lies are caught, of the peer that told them (S5)
    w.lab.fetch_withheld(lazy);
    w.lab.sync(w.mac_a, lazy);
    let caught: BTreeSet<EditId> = w.lab.stub_liars(lazy).iter().map(|(from, id)| {
        assert_eq!(*from, w.mac_a);
        *id
    }).collect();
    assert_eq!(caught, lied);
    // it took and knows exactly what the whole iPad does: nothing lost for good (S2, S3), and the forged stub, whose
    // body never came, let go of unanswered
    assert_eq!(from(&w.lab, lazy, &mac), from(&w.lab, whole, &mac));
    assert_eq!(w.lab.state(lazy), w.lab.state(whole));
    assert!(w.lab.stubs(lazy).is_empty());
    assert_eq!(w.lab.stubs_unanswered(lazy), vec![(forged, w.mac_a)]);
    assert!(w.lab.reads(lazy, h.welcome));
    assert_eq!(w.lab.sync(w.mac_a, lazy), 0);
}

#[test]
fn stubs_cross_the_wire_as_a_set() {
    use avendb::wire::Stubs;
    let (w, _, lazy, _) = ready();
    let request = w.lab.request(lazy, w.mac_a);
    let stubs = Stubs(w.lab.withheld(w.mac_a, lazy, &request, &ReplyScope::All));
    assert!(!stubs.0.is_empty());
    assert_eq!(Stubs::from_wire(&stubs.to_wire()).expect("stubs"), stubs);
    let mut twice = stubs.0.clone();
    twice.push(stubs.0[0].clone());
    assert!(Stubs::from_wire(&Stubs(twice).to_wire()).is_err(), "a repeat");
}
