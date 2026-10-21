//! A replay stepped on (`replay_on`) is the replay of all its edits: edits a device writes after everything it holds,
//! and edits a peer wrote while it was behind, which sort among the last ones, beside a removal before them.

mod common;

use std::time::Instant;

use avendb::id::EntryId;
use avendb::keys::KeyFam;
use avendb::policy::{replay, replay_on, Action, Edit, Log, Proposal, Revoking, State};
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

/// Alice's Mac writes `writes` edits over 20 entries; every 25th, her iPhone writes what it drafted 12 edits behind,
/// and Carol's Mac is revoked first. Each batch stepped on equals the whole replayed; the time of each is returned.
fn steps(writes: usize) -> (f64, f64) {
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
    let (mut stepped, mut whole) = (0.0, 0.0);
    for n in 0..writes {
        let e = EntryId::from_u64(1000 + n as u64 % 20);
        let mine = write(&c.log, &was.state, MAC_A, e, n as u8);
        c.log.receive([mine]);
        behind.push(c.log.clone());
        if n % 25 == 24 && behind.len() > 12 {
            let back = &behind[behind.len() - 12];
            let st = back.view();
            c.log.receive([write(back, &st, PHONE_A, EntryId::from_u64(1000 + (n as u64 + 7) % 20), n as u8)]);
        }
        let t = Instant::now();
        was = replay_on(was, c.log.edits(), held);
        stepped += t.elapsed().as_secs_f64();
        held = c.log.edits().len();
        if n % 25 == 24 || n + 1 == writes {
            let t = Instant::now();
            let all = replay(c.log.edits());
            whole += t.elapsed().as_secs_f64();
            assert!(was == all, "stepped on at {n}, it differs from the whole");
        }
    }
    (stepped, whole)
}

#[test]
fn a_replay_stepped_on_with_a_peers_late_edits_is_the_whole_replayed() {
    steps(300);
}

#[test]
#[ignore]
fn stepping_on_beats_replaying_the_whole() {
    let (stepped, whole) = steps(6000);
    eprintln!("PERF stepped all {stepped:.2} s; the whole every 25th {whole:.2} s");
}
