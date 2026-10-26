//! One entry state (`EntryState.lean`'s scenarios): Alice's note is full before any snapshot, based on her passkey's
//! snapshot with nothing to replay, replays only a write after it, and is full again after a removal.

use std::collections::HashMap;

use avendb::cast::{document, human_on};
use avendb::entry_state::{EntryState, entry_state, log_edits, needs};
use avendb::id::{EditId, EntryId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::policy::{Action, Edit, Revoking, Slice, Stated};
use avendb::sealed::FileRoot;

struct Note {
    lab: Lab,
    passkey: SignerId,
    mac: SignerId,
    phone: SignerId,
    alice: VaultId,
    welcome: EntryId,
}

fn note() -> Note {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's phone");
    let alice = human_on(&mut lab, passkey, &[mac, phone]);
    let welcome = lab.create(mac, alice, alice, "note", &[], document("Welcome", "Hello.", mac)).expect("a note");
    lab.edit(mac, alice, welcome, |i| i.set_text(2, "Hello again.")).expect("a second write");
    Note { lab, passkey, mac, phone, alice, welcome }
}

fn edits(n: &Note) -> Vec<Edit> {
    n.lab.log(n.mac).edits().to_vec()
}

fn root(b: u8) -> FileRoot {
    FileRoot { hash: [b; 32], size: 1 }
}

fn stated(n: &Note, at: FileRoot) -> (Stated, Slice) {
    let basis = n.lab.state(n.mac).writes(n.welcome).last().copied().into_iter().collect();
    (Stated { entry: n.welcome, basis, slice: at }, n.lab.state(n.mac).slice_of(n.welcome))
}

fn snap(n: &mut Note, states: Vec<Stated>) -> EditId {
    n.lab.submit(n.mac, &[n.passkey], Action::Snapshot { vault: n.alice, states }).expect("the passkey's")
}

fn ids(edits: Vec<&Edit>) -> Vec<EditId> {
    edits.into_iter().map(|e| e.id()).collect()
}

#[test]
fn full_before_a_snapshot_based_after_it() {
    let mut n = note();
    let held = edits(&n);
    let none = HashMap::new();
    assert_eq!(entry_state(&held, &none, n.welcome), EntryState::Full);
    let log = ids(log_edits(&held, n.welcome));
    assert!(log.len() >= 2, "the note's log holds both writes");
    assert_eq!(ids(needs(&held, &EntryState::Full, n.welcome)), log, "full: the whole log");

    let (x, slice) = stated(&n, root(1));
    let c = snap(&mut n, vec![x.clone()]);
    let held = edits(&n);
    let slices = HashMap::from([(root(1), slice)]);
    let state = entry_state(&held, &slices, n.welcome);
    assert_eq!(state, EntryState::Based { id: c, stated: x });
    assert!(needs(&held, &state, n.welcome).is_empty(), "a fresh snapshot: nothing to replay");
    // a slice the device hasn't opened yet leaves the entry full
    assert_eq!(entry_state(&held, &HashMap::new(), n.welcome), EntryState::Full);
}

#[test]
fn a_write_after_the_snapshot_is_the_whole_suffix() {
    let mut n = note();
    let (x, slice) = stated(&n, root(1));
    snap(&mut n, vec![x]);
    let before = edits(&n).len();
    n.lab.edit(n.mac, n.alice, n.welcome, |i| i.set_text(2, "Hello, once more.")).expect("a third write");
    let held = edits(&n);
    let third = held[before..].iter().map(|e| e.id()).collect::<Vec<_>>();
    let slices = HashMap::from([(root(1), slice)]);
    let state = entry_state(&held, &slices, n.welcome);
    assert!(state.is_based());
    assert_eq!(ids(needs(&held, &state, n.welcome)), third);
}

#[test]
fn a_newer_snapshot_wins() {
    let mut n = note();
    let (x, slice) = stated(&n, root(1));
    snap(&mut n, vec![x]);
    n.lab.edit(n.mac, n.alice, n.welcome, |i| i.set_text(2, "Hello, once more.")).expect("a third write");
    let (y, newer) = stated(&n, root(2));
    let c = snap(&mut n, vec![y.clone()]);
    let held = edits(&n);
    let slices = HashMap::from([(root(1), slice), (root(2), newer)]);
    let state = entry_state(&held, &slices, n.welcome);
    assert_eq!(state, EntryState::Based { id: c, stated: y }, "the owners' newest word");
    assert!(needs(&held, &state, n.welcome).is_empty());
}

#[test]
fn a_removal_after_the_snapshot_makes_it_full_again() {
    let mut n = note();
    let (x, slice) = stated(&n, root(1));
    snap(&mut n, vec![x]);
    let remove = Action::Revoke(Revoking::Device { vault: n.alice, device: n.phone, keep: vec![] });
    n.lab.submit(n.mac, &[n.passkey], remove).expect("the passkey removes the phone");
    let held = edits(&n);
    let slices = HashMap::from([(root(1), slice)]);
    assert_eq!(entry_state(&held, &slices, n.welcome), EntryState::Full);
}
