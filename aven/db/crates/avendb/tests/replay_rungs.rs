//! A replay stepped on from a rung (`replay_on`, `Tail::rungs`) is the replay of all its edits: pages of a peer's
//! edits drafted far behind, which sort before the replay's place, replay the edits from the rung before them on,
//! not every edit, and the replay is the whole replayed each time.

mod common;

use std::time::Instant;

use avendb::id::EntryId;
use avendb::keys::KeyFam;
use avendb::policy::{replay, replay_on_why, Action, Edit, Log, Proposal, Revoking, State, Why};
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
