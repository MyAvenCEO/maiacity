//! A move stepped on (`replay_on`, `V3_move_steps_on`) is the replay of all its edits: a steward that takes an entry to
//! another audience, keeping every write of it that stands, steps the move on the replay it keeps, as it steps a write.
//! Writes after it step on as before, a peer's write as deep as the last one replays the last edits again from after
//! the move, and the place it steps on from reads back from a stored view. A move that keeps less replays the whole.

mod common;

use avendb::id::{AudienceId, EntryId, ShareId, VaultId};
use avendb::keys::KeyFam;
use avendb::policy::{
    mk_audience, replay, replay_on, replay_on_why, Action, Edit, Level, Log, Proposal, Replay, State, Who, Why,
};
use avendb::slice::{Atom, Selector, Sym};
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

/// Alice's Mac takes entry `e` into Bob's audience, or back into her own, checked on the replay it keeps.
fn move_entry(log: &Log, was: &Replay, alice: VaultId, bobs: ShareId, e: EntryId) -> Edit {
    let into = was.state.entry(e).expect("an entry").audience() == AudienceId::of(alice, &[]);
    let to = if into { mk_audience(&[bobs]) } else { vec![] };
    let action = Action::Mark { vault: alice, entry: e, caps: Some(to), wants: None, keep: vec![], via: vec![] };
    log.check_on(was, true, MAC_A, &[], action).expect("Alice's Mac moves her entry")
}

/// `was`, the replay of the first `held` edits of `log`, stored and read back.
fn stored(was: &Replay, log: &Log, held: usize) -> Replay {
    let (back, n) = Replay::from_view(&was.to_view(held), log.edits(), log.ids()).expect("a view of the edits it holds");
    assert!(n == held && back == *was && back.same_tail(was), "read back, it differs");
    back
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

#[test]
fn a_move_after_everything_held_steps_on_as_a_write() {
    let (mut c, alice, bobs) = library();
    let mut was = replay(c.log.edits());
    let mut held = c.log.edits().len();
    for n in 0..90usize {
        let e = EntryId::from_u64(1000 + n as u64 % 10);
        let mut fresh = vec![];
        match n % 6 {
            // Alice's Mac moves the note
            2 | 5 => fresh.push(move_entry(&c.log, &was, alice, bobs, e)),
            // her Mac and her iPhone each write it, the iPhone not yet holding the Mac's write: both as deep
            4 => {
                let other = EntryId::from_u64(1000 + (n as u64 + 3) % 10);
                fresh.push(write(&c.log, &was.state, MAC_A, e, n as u8));
                fresh.push(write(&c.log, &was.state, PHONE_A, other, n as u8));
            }
            _ => fresh.push(write(&c.log, &was.state, MAC_A, e, n as u8)),
        }
        for edit in fresh {
            let moved = matches!(edit.action, Action::Mark { .. });
            c.log.receive([edit]);
            let (next, why) = replay_on_why(was, c.log.edits(), held);
            if moved {
                assert_eq!(why, Why::Stepped, "the move at {n} replayed {why:?}");
            }
            assert!(!matches!(why, Why::Whole(_)), "at {n} replayed {why:?}");
            was = next;
            if n % 7 == 6 {
                was = stored(&was, &c.log, c.log.edits().len());
            }
            held = c.log.edits().len();
            assert!(was == replay(c.log.edits()), "stepped on at {n}, it differs from the whole");
        }
    }
    // every move stood, and the last ones left notes in Bob's audience
    let moves: Vec<bool> = was.edits.iter().zip(&was.stood).filter(|(e, _)| matches!(e.action, Action::Mark { .. }))
        .map(|(_, s)| *s).collect();
    assert!(moves.len() == 30 && moves.iter().all(|s| *s), "the moves stood: {moves:?}");
    let bobs_audience = AudienceId::of(alice, &mk_audience(&[bobs]));
    assert!((0..10).any(|i| was.state.entry(EntryId::from_u64(1000 + i)).unwrap().audience() == bobs_audience));
}

#[test]
fn a_move_that_keeps_less_replays_the_whole() {
    let (mut c, alice, bobs) = library();
    let e = EntryId::from_u64(1003);
    for n in 0..3 {
        let st = c.log.view();
        let w = write(&c.log, &st, MAC_A, e, n);
        c.log.receive([w]);
    }
    let was = replay(c.log.edits());
    let held = c.log.edits().len();
    let mut edit = move_entry(&c.log, &was, alice, bobs, e);
    let Action::Mark { keep, .. } = &mut edit.action else { unreachable!() };
    assert!(keep.len() >= 4, "the move keeps the note's writes");
    keep.pop();
    c.log.receive([edit]);
    let (was, why) = replay_on_why(was, c.log.edits(), held);
    assert_eq!(why, Why::Whole("replay whole: a move keeps not every write of its entry"));
    assert!(was == replay(c.log.edits()));
    // the next write steps on again
    let w = write(&c.log, &was.state, MAC_A, e, 9);
    let held = c.log.edits().len();
    c.log.receive([w]);
    let was = replay_on(was, c.log.edits(), held);
    assert!(was == replay(c.log.edits()));
}
