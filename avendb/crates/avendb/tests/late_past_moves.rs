//! A late edit replays only the last edits again (`replay_on`, `V4_tail_replays`), even where moves came after it: the
//! moves among the last edits, which all stood and kept no edit out alone, are tried again with it, and the edits
//! before the place it steps on from stand as they stood. A move that a late write must pass and doesn't replays the
//! whole.

mod common;

use avendb::id::{AudienceId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::policy::{mk_audience, replay, replay_on_why, Action, Edit, Level, Log, Proposal, Replay, State, Who, Why};
use avendb::slice::{Atom, Selector, Sym};
use common::*;

/// A write of `n` on entry `e` for `actor`, by `by`, drafted on `st`, the view of a device that holds less.
fn write(log: &Log, st: &State, by: SignerId, actor: VaultId, e: EntryId, n: u8) -> Edit {
    let en = st.entry(e).expect("an entry");
    let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
    let body = vec![n, 2, 3];
    let (vault, stay, deps, via, files) = (en.vault, en.stay(), vec![], vec![], vec![]);
    let action = Action::Write { vault, entry: e, actor, stay, epoch, deps, proposal: Proposal::Main, via, create: None, files, body };
    log.draft_on(st, by, &[], action)
}

/// Alice's Mac takes entry `e` into Bob's audience, or back into her own, checked on the replay it keeps.
fn move_entry(log: &Log, was: &Replay, alice: VaultId, bobs: ShareId, e: EntryId) -> Edit {
    let into = was.state.entry(e).expect("an entry").audience() == AudienceId::of(alice, &[]);
    let to = if into { mk_audience(&[bobs]) } else { vec![] };
    let action = Action::Mark { vault: alice, entry: e, caps: Some(to), wants: None, keep: vec![], via: vec![] };
    log.check_on(was, true, MAC_A, &[], action).expect("Alice's Mac moves her entry")
}

/// Alice with ten notes and a share of her notes with Bob.
fn library() -> (common::Cast, VaultId, ShareId) {
    let mut c = cast();
    let (alice, bob) = (c.alice, c.bob);
    let notes = Selector::AnyOf(vec![vec![Atom::TypeIn(vec![Sym::new("note")])]]);
    let bobs = c.issue(MAC_A, &[], alice, Who::Vault(bob), Level::Write, notes).expect("a share with Bob");
    for i in 0..10 {
        c.create(MAC_A, alice, EntryId::from_u64(1000 + i), alice, &[], "note", &[]).expect("a note");
    }
    (c, alice, bobs)
}

/// `edit` received, and the replay stepped on: how it went, checked against the whole.
fn take(c: &mut common::Cast, was: Replay, edit: Edit) -> (Replay, Why) {
    let held = c.log.edits().len();
    c.log.receive([edit]);
    let (next, why) = replay_on_why(was, c.log.edits(), held);
    assert!(next == replay(c.log.edits()), "stepped on, it differs from the whole");
    (next, why)
}

#[test]
fn a_late_write_replays_the_last_edits_past_moves() {
    let (mut c, alice, bobs) = library();
    let mut was = replay(c.log.edits());
    for round in 0..12u64 {
        // her iPhone drafts on what it held a round ago, behind every edit her Mac makes after
        let (behind_log, behind) = (c.log.clone(), was.state.clone());
        for n in 0..4u64 {
            let e = EntryId::from_u64(1000 + (round * 4 + n) % 10);
            let w = write(&c.log, &was.state, MAC_A, alice, e, n as u8);
            (was, _) = take(&mut c, was, w);
            let m = move_entry(&c.log, &was, alice, bobs, e);
            let why;
            (was, why) = take(&mut c, was, m);
            assert_eq!(why, Why::Stepped, "the move in round {round}");
        }
        for n in 0..3u64 {
            let e = EntryId::from_u64(1000 + (round * 3 + n) % 10);
            let w = write(&behind_log, &behind, PHONE_A, alice, e, 100 + n as u8);
            let why;
            (was, why) = take(&mut c, was, w);
            assert_eq!(why, Why::Tail, "the iPhone's late write in round {round} replayed {why:?}");
        }
    }
    let stood = was.edits.iter().zip(&was.stood).filter(|(e, _)| matches!(e.action, Action::Mark { .. }));
    assert!(stood.clone().count() == 48 && stood.into_iter().all(|(_, s)| *s), "every move stood");
    // read back from a stored view, it steps on the same
    let held = c.log.edits().len();
    let (back, n) = Replay::from_view(&was.to_view(held), c.log.edits(), c.log.ids()).expect("its view");
    assert!(n == held && back == was && back.same_tail(&was));
}

#[test]
fn a_move_a_late_write_must_pass_and_doesnt_replays_the_whole() {
    let (mut c, alice, bobs) = library();
    let (bob, e) = (c.bob, EntryId::from_u64(1004));
    let mut was = replay(c.log.edits());
    let m = move_entry(&c.log, &was, alice, bobs, e);
    (was, _) = take(&mut c, was, m);
    // Bob's Mac writes the note while it is in his audience, before it hears Alice take it back
    let (bobs_log, bobs_view) = (c.log.clone(), was.state.clone());
    for n in 0..3 {
        let w = write(&c.log, &was.state, MAC_A, alice, EntryId::from_u64(1000 + n), n as u8);
        (was, _) = take(&mut c, was, w);
    }
    let back = move_entry(&c.log, &was, alice, bobs, e);
    let why;
    (was, why) = take(&mut c, was, back);
    assert_eq!(why, Why::Stepped);
    // her iPhone holds the move back, and her Mac writes on
    let (phone_log, phone_view) = (c.log.clone(), was.state.clone());
    for n in 0..2 {
        let w = write(&c.log, &was.state, MAC_A, alice, EntryId::from_u64(1005 + n), n as u8);
        (was, _) = take(&mut c, was, w);
    }
    let late = write(&bobs_log, &bobs_view, MAC_B, bob, e, 9);
    let id = late.id();
    let why;
    (was, why) = take(&mut c, was, late);
    assert_eq!(why, Why::Whole("replay whole: a move among its last edits kept a new edit out"));
    let at = was.ids.iter().position(|i| *i == id).expect("Bob's write");
    assert!(!was.stood[at], "Bob's write falls with the note out of his audience");
    // the place it steps on from is past that move now: the next late write replays the last edits again
    let w = write(&phone_log, &phone_view, PHONE_A, alice, EntryId::from_u64(1002), 1);
    let (_, why) = take(&mut c, was, w);
    assert_eq!(why, Why::Tail);
}
