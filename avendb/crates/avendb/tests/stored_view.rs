//! A device's stored view (`Replay::to_view`) reads back as the replay it was, the place it steps on from and all, and
//! the edits that came since step on it as they step on the replay itself: edits a device writes after everything it
//! holds, edits a peer wrote while it was behind, beside a removal before them. A view of other edits, or cut short,
//! is no view.

mod common;

use avendb::id::EntryId;
use avendb::keys::KeyFam;
use avendb::policy::{replay, replay_on, Action, Edit, Log, Proposal, Replay, Revoking, State};
use common::*;

/// A write of `n` on entry `e`, by `by`, drafted on `log`.
fn write(log: &Log, st: &State, by: avendb::id::SignerId, e: EntryId, n: u8) -> Edit {
    let en = st.entry(e).expect("an entry");
    let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
    let body = vec![n, 2, 3];
    let (vault, actor, stay, deps, via, files) = (en.vault, en.vault, en.stay(), vec![], vec![], vec![]);
    let action = Action::Write { vault, entry: e, actor, stay, epoch, deps, proposal: Proposal::Main, via, create: None, files, body };
    log.draft_on(st, by, &[], action)
}

/// `was`, the replay of the first `held` edits of `log`, stored and read back.
fn stored(was: &Replay, log: &Log, held: usize) -> Replay {
    let bytes = was.to_view(held);
    let (back, n) = Replay::from_view(&bytes, log.edits(), log.ids()).expect("a view of the edits it holds");
    assert_eq!(n, held);
    assert!(back == *was, "read back, it differs");
    assert!(back.same_tail(was), "read back, the place it steps on from differs");
    back
}

#[test]
fn a_stored_view_reads_back_and_steps_on_as_the_replay_does() {
    let mut c = cast();
    let alice = c.alice;
    let leave = Action::Revoke(Revoking::Device { vault: c.carol, device: MAC_C, keep: vec![] });
    c.log.append(PASSKEY_C, &[], leave).expect("Carol's passkey revokes her Mac");
    for i in 0..20 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let mut was = replay(c.log.edits());
    let mut held = c.log.edits().len();
    let mut behind: Vec<Log> = vec![];
    for n in 0..300usize {
        let e = EntryId::from_u64(1000 + n as u64 % 20);
        let mine = write(&c.log, &was.state, MAC_A, e, n as u8);
        c.log.receive([mine]);
        behind.push(c.log.clone());
        if n % 25 == 24 && behind.len() > 12 {
            let back = &behind[behind.len() - 12];
            let st = back.view();
            c.log.receive([write(back, &st, PHONE_A, EntryId::from_u64(1000 + (n as u64 + 7) % 20), n as u8)]);
        }
        // every tenth time, the device stops and starts again from its view
        if n % 10 == 9 {
            was = stored(&was, &c.log, held);
        }
        let from_view = replay_on(stored(&was, &c.log, held), c.log.edits(), held);
        was = replay_on(was, c.log.edits(), held);
        assert!(from_view == was && from_view.same_tail(&was), "stepped on from its view at {n}, it differs");
        held = c.log.edits().len();
        if n % 25 == 24 {
            assert!(was == replay(c.log.edits()), "stepped on at {n}, it differs from the whole");
        }
    }
}

#[test]
fn a_view_of_other_edits_or_cut_short_is_no_view() {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..5 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let held = c.log.edits().len();
    let bytes = replay(c.log.edits()).to_view(held);
    assert!(Replay::from_view(&bytes, c.log.edits(), c.log.ids()).is_some());
    // more edits than the device holds
    assert!(Replay::from_view(&bytes, &c.log.edits()[1..], &c.log.ids()[1..]).is_none());
    // other edits in their place
    let mut edits = c.log.edits().to_vec();
    let mut ids = c.log.ids().to_vec();
    edits.swap(0, held - 1);
    ids[0] = ids[held - 1];
    assert!(Replay::from_view(&bytes, &edits, &ids).is_none());
    // cut short, or with a byte more
    assert!(Replay::from_view(&bytes[..bytes.len() - 1], c.log.edits(), c.log.ids()).is_none());
    let mut more = bytes.clone();
    more.push(0);
    assert!(Replay::from_view(&more, c.log.edits(), c.log.ids()).is_none());
}
