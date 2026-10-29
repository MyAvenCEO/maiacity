//! A replay stepped on from a rung (`replay_on`, `Tail::rungs`) is the replay of all its edits: pages of a peer's
//! edits drafted far behind, which sort before the replay's place, replay the edits from the rung before them on,
//! not every edit, and the replay is the whole replayed each time.

use crate::common;

use std::time::Instant;

use avendb::id::EntryId;
use avendb::keys::KeyFam;
use avendb::policy::{replay, replay_on_why, rewind, Action, Edit, Log, Proposal, Replay, Revoking, State, Why};
use common::*;

/// A write of `n` on entry `e`, by `by`, drafted on `log`.
fn write(log: &Log, st: &State, by: avendb::id::SignerId, e: EntryId, n: u32) -> Edit {
    let en = st.entry(e).expect("an entry");
    let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
    let body = n.to_le_bytes().to_vec();
    let (vault, actor, stay, deps, via, files) = (en.vault, en.vault, en.stay(), vec![], vec![], vec![]);
    let action = Action::Write { vault, entry: e, actor, stay, epoch, deps, proposal: Proposal::Main, via, create: None, files, body: body.into() };
    log.draft_on(st, by, &[], action)
}

/// The same numbers each run.
struct Dice(u64);

impl Dice {
    fn roll(&mut self, below: usize) -> usize {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 % below as u64) as usize
    }
}

/// Alice's Mac writes `writes` edits over 20 entries, Carol's Mac revoked first; then, `rounds` times, a few more of
/// hers, and a page of her iPhone's edits drafted on what the Mac held up to 6,000 edits before. Each round stepped
/// on equals the whole replayed. How each round went, and the time stepped on and replayed whole.
fn rounds(writes: usize, rounds: usize, seed: u64) -> (Vec<Why>, f64, f64) {
    let mut c = cast();
    let alice = c.alice;
    let leave = Action::Revoke(Revoking::Device { vault: c.carol, device: MAC_C, keep: vec![] });
    c.log.append(PASSKEY_C, &[], leave).expect("Carol's passkey revokes her Mac");
    for i in 0..20 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let mut st = c.log.view();
    // what the Mac held every 500 of its edits, for the iPhone to draft on
    let mut behind: Vec<(Log, State)> = vec![];
    let mut n = 0u32;
    let mut mine = |c: &mut Cast, st: &mut State, count: usize, behind: &mut Vec<(Log, State)>| {
        for _ in 0..count {
            let e = EntryId::from_u64(1000 + n as u64 % 20);
            let w = write(&c.log, st, MAC_A, e, n);
            c.log.receive([w]);
            n += 1;
            if n % 500 == 0 {
                *st = c.log.view();
                behind.push((c.log.clone(), st.clone()));
            }
        }
    };
    mine(&mut c, &mut st, writes, &mut behind);
    let mut was = replay(c.log.edits());
    let mut held = c.log.edits().len();
    let mut dice = Dice(seed);
    let (mut whys, mut stepped, mut whole) = (vec![], 0.0, 0.0);
    for r in 0..rounds {
        if r > 0 {
            mine(&mut c, &mut st, 1 + dice.roll(300), &mut behind);
        }
        let t = Instant::now();
        (was, _) = replay_on_why(was, c.log.edits(), held);
        stepped += t.elapsed().as_secs_f64();
        held = c.log.edits().len();
        // a page of the iPhone's, drafted on what the Mac held some way back
        // the first some 6,000 back, before its place and after its rung
        let k = if r == 0 { behind.len() - 12 } else { behind.len() - 1 - dice.roll(behind.len().min(12)) };
        let (back, back_st) = &behind[k];
        let page: Vec<Edit> = (0..1 + dice.roll(40))
            .map(|i| write(back, back_st, PHONE_A, EntryId::from_u64(1000 + dice.roll(20) as u64), 1_000_000 + (r * 100 + i) as u32))
            .collect();
        c.log.receive(page);
        let t = Instant::now();
        let why;
        (was, why) = replay_on_why(was, c.log.edits(), held);
        stepped += t.elapsed().as_secs_f64();
        held = c.log.edits().len();
        whys.push(why);
        let t = Instant::now();
        let all = replay(c.log.edits());
        whole += t.elapsed().as_secs_f64();
        assert!(was == all, "round {r}, {why:?}: stepped on, it differs from the whole");
    }
    (whys, stepped, whole)
}

#[test]
fn pages_drafted_far_behind_replay_from_a_rung_as_the_whole() {
    let (whys, ..) = rounds(9_000, 12, 7);
    assert_eq!(whys[0], Why::Rung, "a page sorting before its place stepped on from its rung: {whys:?}");
}

#[test]
#[ignore]
fn stepping_on_from_rungs_beats_replaying_the_whole() {
    let (whys, stepped, whole) = rounds(30_000, 40, 11);
    let count = |w: fn(&Why) -> bool| whys.iter().filter(|x| w(x)).count();
    eprintln!(
        "PERF rungs {} tail {} whole {}; stepped {stepped:.2} s, the whole each round {whole:.2} s",
        count(|w| *w == Why::Rung),
        count(|w| *w == Why::Tail),
        count(|w| matches!(w, Why::Whole(_))),
    );
}

/// Alice's Mac holds `held` edits, then takes what was written on two of her iPhone's tabs while it was away, `away`
/// edits each, drafted on what it held when it left, in pages of 300: the first tab's pages, each sorting after the
/// last, then the second's, which sort back among the first's. Each page stepped on equals the whole replayed. How each went.
fn catch_up(held: usize, away: usize) -> Vec<Why> {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..20 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let mut st = c.log.view();
    for n in 0..held as u32 {
        let w = write(&c.log, &st, MAC_A, EntryId::from_u64(1000 + n as u64 % 20), n);
        c.log.receive([w]);
        if n % 500 == 499 {
            st = c.log.view();
        }
    }
    st = c.log.view();
    // what each tab wrote while the Mac was away, each on its own log of what the Mac held
    let away_of = |by, from: u32| {
        let (mut log, mut st) = (c.log.clone(), st.clone());
        let mut out = vec![];
        for n in 0..away as u32 {
            let w = write(&log, &st, by, EntryId::from_u64(1000 + (n as u64 * 7) % 20), from + n);
            log.receive([w.clone()]);
            out.push(w);
            if n % 500 == 499 {
                st = log.view();
            }
        }
        out
    };
    let (phone, other) = (away_of(PHONE_A, 1_000_000), away_of(PHONE_A, 2_000_000));
    let mut was = replay(c.log.edits());
    let mut at = c.log.edits().len();
    let mut whys = vec![];
    for page in phone.chunks(300).chain(other.chunks(300)) {
        c.log.receive(page.iter().cloned());
        let why;
        (was, why) = replay_on_why(was, c.log.edits(), at);
        at = c.log.edits().len();
        whys.push(why);
        assert!(was == replay(c.log.edits()), "{why:?}: stepped on, it differs from the whole");
    }
    whys
}

#[test]
fn a_second_devices_pages_step_on_from_a_rung() {
    let whys = catch_up(6_000, 2_400);
    assert!(!whys.iter().any(|w| matches!(w, Why::Whole(_))), "no page replayed every edit: {whys:?}");
}

/// Alice's Mac writes `writes` edits over 20 entries, then takes a page of her iPhone's drafted on what it held `back`
/// edits before: its log, its replay of what it held before the page, and how many that was.
fn far_page(writes: usize, back: usize) -> (Log, Replay, usize) {
    far_pages(writes, &[back]).pop().expect("a page")
}

/// `far_page` for each of `backs`, of the one log Alice's Mac wrote: each the log with that page taken.
fn far_pages(writes: usize, backs: &[usize]) -> Vec<(Log, Replay, usize)> {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..20 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let mut st = c.log.view();
    let mut then = vec![None; backs.len()];
    for n in 0..writes as u32 {
        for (at, &back) in then.iter_mut().zip(backs) {
            if writes - n as usize == back {
                *at = Some((c.log.clone(), st.clone()));
            }
        }
        let w = write(&c.log, &st, MAC_A, EntryId::from_u64(1000 + n as u64 % 20), n);
        c.log.receive([w]);
        if n % 500 == 499 {
            st = c.log.view();
        }
    }
    let was = replay(c.log.edits());
    let held = c.log.edits().len();
    then.into_iter()
        .map(|then| {
            let (then, then_st) = then.expect("what it held then");
            let page: Vec<Edit> = (0..5)
                .map(|i| write(&then, &then_st, PHONE_A, EntryId::from_u64(1000 + i), 2_000_000 + i as u32))
                .collect();
            let mut log = c.log.clone();
            log.receive(page);
            (log, was.clone(), held)
        })
        .collect()
}

/// `far_page`'s page, further back than a rung reaches, stepped on, from its replay or from its stored view of it: it
/// replays from the mark before them (`Marks`), as the whole, and how each went.
fn far_back((log, was, held): (Log, Replay, usize)) -> (Why, Why) {
    let view = Replay::from_view(&was.to_view(held), log.edits(), log.ids()).expect("its stored view").0;
    let whole = replay(log.edits());
    let (stepped, why) = replay_on_why(was, log.edits(), held);
    assert!(stepped == whole, "{why:?}: stepped on, it differs from the whole");
    let (opened, opened_why) = replay_on_why(view, log.edits(), held);
    assert!(opened == whole, "{opened_why:?}: stepped on from its stored view, it differs from the whole");
    (why, opened_why)
}

/// A catch-up's step replays at most a slice of edits (`Lab::step_replay`): a page far back is replayed from the mark
/// before it a slice a step (`rewind`), not every edit, and is the whole replayed.
#[test]
fn a_rewind_run_a_slice_a_step_is_the_whole_replay() {
    let (log, mut was, held) = far_page(24_000, 14_000);
    let whole = replay(log.edits());
    let mut run = rewind(&mut was, log.edits(), held).expect("a rewind from a mark");
    assert_eq!(run.of(), log.edits().len());
    let mut steps = 1;
    while !run.step(&was, log.edits(), 1_000) {
        steps += 1;
    }
    assert!((14..=19).contains(&steps), "{steps} slices of 1,000 for a page 14,000 back");
    let stepped = run.finish(was, log.edits()).unwrap_or_else(|(_, why)| panic!("{why}"));
    assert!(stepped == whole, "rewound a slice a step, it differs from the whole");
}

#[test]
fn a_page_drafted_further_back_than_a_rung_replays_from_a_mark() {
    // the three pages of one log the Mac wrote: what each tests is the page, not the log it builds again
    let backs = [9_000, 14_000, 21_000];
    for (back, page) in backs.into_iter().zip(far_pages(24_000, &backs)) {
        let (why, opened) = far_back(page);
        assert_eq!((why, opened), (Why::Rung, Why::Rung), "a page {back} back, stepped on and from its stored view");
    }
}

/// A replay that grew by pages sorting among its last edits keeps marks too: its rungs, as they fall further back
/// than a rung reaches (`Tail::rung`), and a page drafted far behind replays from the mark before it.
#[test]
fn rungs_grown_old_are_marks_a_late_page_replays_from() {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..20 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let mut st = c.log.view();
    let mut was = replay(c.log.edits());
    let mut held = c.log.edits().len();
    let mut behind: Vec<(Log, State)> = vec![];
    let mut whys = vec![];
    for n in 0..30_000u32 {
        let w = write(&c.log, &st, MAC_A, EntryId::from_u64(1000 + n as u64 % 20), n);
        c.log.receive([w]);
        if n % 500 == 499 {
            st = c.log.view();
            behind.push((c.log.clone(), st.clone()));
            // a page of the iPhone's drafted 1,000 back, sorting among the last edits: the place moves on
            let (back, back_st) = &behind[behind.len().saturating_sub(3)];
            let page: Vec<Edit> = (0..3).map(|i| write(back, back_st, PHONE_A, EntryId::from_u64(1000 + i), 1_000_000 + n + i as u32)).collect();
            c.log.receive(page);
            let why;
            (was, why) = replay_on_why(was, c.log.edits(), held);
            held = c.log.edits().len();
            whys.push(why);
        }
    }
    assert!(!whys.iter().any(|w| matches!(w, Why::Whole(_))), "no page replayed every edit: {whys:?}");
    // a page drafted on what it held 20,000 edits back
    let (back, back_st) = &behind[behind.len() - 40];
    let page: Vec<Edit> = (0..4).map(|i| write(back, back_st, PHONE_A, EntryId::from_u64(1000 + i), 3_000_000 + i as u32)).collect();
    c.log.receive(page);
    let (stepped, why) = replay_on_why(was, c.log.edits(), held);
    assert_eq!(why, Why::Rung, "a page 20,000 back stepped on from a mark");
    assert!(stepped == replay(c.log.edits()), "stepped on from a mark, it differs from the whole");
}

/// Alice's Mac writes `writes` edits over 20 entries: its log, and what it held `back` edits before, with its view.
fn mac_log(writes: usize, back: usize) -> (Cast, Log, State) {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..20 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let mut st = c.log.view();
    let mut then = None;
    for n in 0..writes as u32 {
        if writes - n as usize == back {
            then = Some((c.log.clone(), st.clone()));
        }
        let w = write(&c.log, &st, MAC_A, EntryId::from_u64(1000 + n as u64 % 20), n);
        c.log.receive([w]);
        if n % 500 == 499 {
            st = c.log.view();
        }
    }
    let (then, st) = then.expect("what it held then");
    (c, then, st)
}

/// `edits` taken one after the other by `log`, its replay `was` of what it held: each stepped on as the whole, and
/// how each went.
fn take_each(log: &mut Log, mut was: Replay, edits: Vec<Edit>) -> Vec<Why> {
    let mut whys = vec![];
    for e in edits {
        let held = log.edits().len();
        log.receive([e]);
        let why;
        (was, why) = replay_on_why(was, log.edits(), held);
        assert!(was == replay(log.edits()), "{why:?}: stepped on, it differs from the whole");
        whys.push(why);
    }
    whys
}

/// An edit of her iPhone's drafted far behind comes after one that builds on it: the edits from the mark before it
/// are replayed again with it, the one built on it among them, not every edit.
#[test]
fn an_edit_a_held_one_builds_on_replays_from_the_mark_before_it() {
    let (mut c, mut then, then_st) = mac_log(12_000, 10_000);
    let e = EntryId::from_u64(1003);
    let first = write(&then, &then_st, PHONE_A, e, 4_000_000);
    then.receive([first.clone()]);
    let second = write(&then, &then.view(), PHONE_A, e, 4_000_001);
    assert!(second.parents.contains(&first.id()), "the second builds on the first");
    let was = replay(c.log.edits());
    let whys = take_each(&mut c.log, was, vec![second, first]);
    assert!(!whys.iter().any(|w| matches!(w, Why::Whole(_))), "none replayed every edit: {whys:?}");
}

/// A checkpoint of Alice's over edits her iPhone made far behind comes before them, or after them: either way the
/// edits from the mark before the first it covers are replayed again, not every edit.
#[test]
fn a_checkpoint_and_the_edits_it_covers_replay_from_the_mark_before_them() {
    for checkpoint_first in [true, false] {
        let (mut c, mut then, then_st) = mac_log(12_000, 10_000);
        let page: Vec<Edit> =
            (0..3).map(|i| write(&then, &then_st, PHONE_A, EntryId::from_u64(1000 + i), 5_000_000 + i as u32)).collect();
        then.receive(page.clone());
        let covers = page.iter().map(Edit::id).collect();
        then.append(PASSKEY_A, &[], Action::Checkpoint { vault: c.alice, covers }).expect("her passkey's checkpoint");
        let checkpoint = then.edits().last().expect("the checkpoint").clone();
        let was = replay(c.log.edits());
        let edits = match checkpoint_first {
            true => [vec![checkpoint], page].concat(),
            false => [page, vec![checkpoint]].concat(),
        };
        let whys = take_each(&mut c.log, was, edits);
        assert!(!whys.iter().any(|w| matches!(w, Why::Whole(_))), "checkpoint first {checkpoint_first}: {whys:?}");
    }
}

/// `far_page`, with Carol's Mac revoked 1,000 edits from the end: past the page's place, so before the fix every
/// page of a peer's edits drafted further back than the last revocation replayed every edit (45 such on Samuel's Mac,
/// 2026-10-29).
fn far_page_before_a_revocation(writes: usize, back: usize) -> (Log, Replay, usize) {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..20 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let mut st = c.log.view();
    let mut then = None;
    for n in 0..writes as u32 {
        if writes - n as usize == back {
            then = Some((c.log.clone(), st.clone()));
        }
        let w = write(&c.log, &st, MAC_A, EntryId::from_u64(1000 + n as u64 % 20), n);
        c.log.receive([w]);
        if n % 500 == 499 {
            st = c.log.view();
        }
        if writes - n as usize == 1000 {
            let leave = Action::Revoke(Revoking::Device { vault: c.carol, device: MAC_C, keep: vec![] });
            c.log.append(PASSKEY_C, &[], leave).expect("Carol's passkey revokes her Mac");
            st = c.log.view();
        }
    }
    let was = replay(c.log.edits());
    let held = c.log.edits().len();
    let (then, then_st) = then.expect("what it held then");
    let page: Vec<Edit> =
        (0..5).map(|i| write(&then, &then_st, PHONE_A, EntryId::from_u64(1000 + i), 2_000_000 + i as u32)).collect();
    c.log.receive(page);
    (c.log, was, held)
}

/// A page of writes drafted before a revocation it sorts before replays from the mark before it, not every edit, and
/// is the whole replayed, stepped on, from its stored view, and run a slice a step: no edit of it says who may do what,
/// so the removals after the mark stand as they stood and take away what they took (`resolve_from_a_place`).
#[test]
fn a_page_before_a_later_revocation_replays_from_the_mark_before_it() {
    let (log, was, held) = far_page_before_a_revocation(12_000, 6_000);
    let whole = replay(log.edits());
    let view = Replay::from_view(&was.to_view(held), log.edits(), log.ids()).expect("its stored view").0;
    let mut sliced = was.clone();
    let (stepped, why) = replay_on_why(was, log.edits(), held);
    assert_eq!(why, Why::Rung, "stepped on");
    assert!(stepped == whole, "stepped on, it differs from the whole");
    let (opened, why) = replay_on_why(view, log.edits(), held);
    assert_eq!(why, Why::Rung, "from its stored view");
    assert!(opened == whole, "from its stored view, it differs from the whole");
    let mut run = rewind(&mut sliced, log.edits(), held).expect("a rewind from a mark");
    while !run.step(&sliced, log.edits(), 500) {}
    let rewound = run.finish(sliced, log.edits()).unwrap_or_else(|(_, why)| panic!("{why}"));
    assert!(rewound == whole, "rewound a slice a step, it differs from the whole");
    // and the next page, after the revocation now, steps on from its place past it
    let mut log = log;
    let st = log.view();
    let next = write(&log, &st, MAC_A, EntryId::from_u64(1000), 3_000_000);
    let held = log.edits().len();
    log.receive([next]);
    let (stepped, why) = replay_on_why(rewound, log.edits(), held);
    assert!(stepped == replay(log.edits()), "{why:?}: the next page, stepped on, differs from the whole");
}
