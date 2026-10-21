//! Snapshots (`Snapshot.lean`'s scenarios): a vault's passkey states its note's slice; a device holding the history
//! finds a lie, never takes a state that reaches past its entry, goes back to the history after a removal, and starting
//! from the snapshot knows the note as the history makes it, with writes after it replayed on top.

use std::collections::{HashMap, HashSet};

use avendb::cast::{document, human_on};
use avendb::id::{EditId, EntryId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::policy::{view, Action, Edit, Refusal, Revoking, Slice, Stated};
use avendb::sealed::FileRoot;
use avendb::snapshot::{away_too_long, honest, lies, start_states, start_view, starts_right, stale, stated_in};

struct Note {
    lab: Lab,
    passkey: SignerId,
    mac: SignerId,
    phone: SignerId,
    alice: VaultId,
    welcome: EntryId,
}

/// Alice's vault with her Mac and phone, and her Mac's note with a second write on its first (`sNote`).
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

/// The note's state as the Mac holds it now, its slice by root `at`.
fn stated(n: &Note, at: FileRoot) -> (Stated, Slice) {
    let basis = n.lab.state(n.mac).writes(n.welcome).last().copied().into_iter().collect();
    (Stated { entry: n.welcome, basis, slice: at }, n.lab.state(n.mac).slice_of(n.welcome))
}

/// The passkey's snapshot of `states`.
fn snap(n: &mut Note, states: Vec<Stated>) -> EditId {
    n.lab.submit(n.mac, &[n.passkey], Action::Snapshot { vault: n.alice, states }).expect("the passkey's")
}

#[test]
fn an_honest_snapshot_stands_and_a_start_from_it_is_right() {
    let mut n = note();
    let (x, slice) = stated(&n, root(1));
    assert_eq!(slice.writes.len(), 2, "both writes");
    // a device can't sign one
    let by_mac = Action::Snapshot { vault: n.alice, states: vec![x.clone()] };
    assert_eq!(n.lab.submit(n.mac, &[n.mac], by_mac).err(), Some(Refusal::BelowThreshold));
    snap(&mut n, vec![x.clone()]);
    let slices = HashMap::from([(root(1), slice.clone())]);
    let held = edits(&n);
    assert_eq!(stated_in(&held, &slices).len(), 1);
    assert!(lies(&held, &slices).is_empty(), "honest toward the history");
    assert_eq!(start_states(&held, &slices).len(), 1);
    let start = start_view(&held, &slices);
    assert_eq!(start.slice_of(n.welcome), view(&held).slice_of(n.welcome));
    assert!(start.acts_for(n.mac, n.alice) && start.acts_for(n.phone, n.alice), "the kernel as it is");
    assert!(starts_right(&held, &slices));
    // its slice taken over the kernel alone holds the note as the history makes it
    assert_eq!(view(&[]).with_slice(n.welcome, &slice).slice_of(n.welcome), slice);
}

#[test]
fn a_write_after_the_snapshot_is_replayed_on_top() {
    let mut n = note();
    let (x, slice) = stated(&n, root(1));
    snap(&mut n, vec![x]);
    let before = edits(&n);
    n.lab.edit(n.mac, n.alice, n.welcome, |i| i.set_text(2, "Hello, once more.")).expect("a third write");
    let slices = HashMap::from([(root(1), slice)]);
    let held = edits(&n);
    let start = start_view(&held, &slices);
    assert_eq!(start.writes(n.welcome).len(), 3);
    assert_eq!(start.slice_of(n.welcome), view(&held).slice_of(n.welcome));
    assert!(starts_right(&held, &slices));
    let had: HashSet<EditId> = before.iter().map(|e| e.id()).collect();
    assert!(!away_too_long(&had, &held, 1) && away_too_long(&HashSet::new(), &held, 1));
}

#[test]
fn a_lie_is_caught_and_a_wide_slice_never_taken() {
    let mut n = note();
    let (x, slice) = stated(&n, root(1));
    // leaving the second write out: a lie
    let lie = Slice { writes: slice.writes[..1].to_vec(), ..slice.clone() };
    // reaching into another entry's marks: never taken
    let other = EntryId([9; 32]);
    let wide = Slice { marks: vec![(other, vec![].into())], ..slice.clone() };
    let c = snap(&mut n, vec![Stated { slice: root(2), ..x.clone() }, Stated { slice: root(3), ..x.clone() }]);
    let slices = HashMap::from([(root(2), lie.clone()), (root(3), wide)]);
    let held = edits(&n);
    assert_eq!(stated_in(&held, &slices).len(), 1, "only the lie is scoped");
    assert_eq!(lies(&held, &slices), vec![(c, n.welcome)]);
    let snapshot = held.iter().find(|e| e.id() == c).expect("held");
    assert!(!honest(&held, snapshot, &x, &lie) && honest(&held, snapshot, &x, &slice));
}

#[test]
fn a_removal_after_the_snapshot_sends_a_device_to_the_history() {
    let mut n = note();
    let (x, slice) = stated(&n, root(1));
    let c = snap(&mut n, vec![x.clone()]);
    let slices = HashMap::from([(root(1), slice)]);
    let held = edits(&n);
    let snapshot = held.iter().find(|e| e.id() == c).expect("held").clone();
    let standing: HashSet<EditId> = held.iter().map(|e| e.id()).collect();
    assert!(!stale(&held, &standing, &snapshot, &x));
    let remove = Action::Revoke(Revoking::Device { vault: n.alice, device: n.phone, keep: vec![] });
    n.lab.submit(n.mac, &[n.passkey], remove).expect("the passkey removes the phone");
    let held = edits(&n);
    let standing: HashSet<EditId> = held.iter().map(|e| e.id()).collect();
    assert!(stale(&held, &standing, &snapshot, &x));
    assert!(start_states(&held, &slices).is_empty());
    let start = start_view(&held, &slices);
    assert_eq!(start.slice_of(n.welcome), view(&held).slice_of(n.welcome));
    assert!(!start.acts_for(n.phone, n.alice));
    assert!(starts_right(&held, &slices));
}
