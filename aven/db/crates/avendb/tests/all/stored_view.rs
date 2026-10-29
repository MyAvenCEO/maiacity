//! A device's stored view (`Replay::to_view`) reads back as the replay it was, the place it steps on from and all, and
//! the edits that came since step on it as they step on the replay itself: edits a device writes after everything it
//! holds, edits a peer wrote while it was behind, beside a removal before them. A view of other edits, or cut short,
//! is no view.

use crate::common;

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
    let action = Action::Write { vault, entry: e, actor, stay, epoch, deps, proposal: Proposal::Main, via, create: None, files, body: body.into() };
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
    assert!(Replay::from_view(&bytes, &avendb::policy::EditsVec::from(edits), &ids).is_none());
    // cut short, or with a byte more
    assert!(Replay::from_view(&bytes[..bytes.len() - 1], c.log.edits(), c.log.ids()).is_none());
    let mut more = bytes.clone();
    more.push(0);
    assert!(Replay::from_view(&more, c.log.edits(), c.log.ids()).is_none());
}

#[test]
fn a_view_of_the_format_before_reads_as_one_without_rungs_or_marks() {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..5 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let held = c.log.edits().len();
    let mut was = replay(c.log.edits());
    was.drop_rungs();
    // version 3 was version 4 with no rung and no mark counted after its tail's places
    let bytes = was.to_view_4(held);
    let body = bytes.strip_prefix(b"avenDB view 4\n").expect("version 4");
    let (body, counts) = body.split_at(body.len() - 8);
    assert_eq!(counts, [0; 8], "its tail keeps no rungs and no marks");
    let old = [&b"avenDB view 3\n"[..], body].concat();
    let (back, n) = Replay::from_view(&old, c.log.edits(), c.log.ids()).expect("a view of version 3 reads");
    assert_eq!(n, held);
    assert!(back == was && back.same_tail(&was), "read back, it differs");
    // and the edits after it step on it as on the replay
    let e = EntryId::from_u64(1000);
    c.log.receive([write(&c.log, &was.state, MAC_A, e, 1)]);
    assert!(replay_on(back, c.log.edits(), held) == replay(c.log.edits()));
}

/// A view of version 4 reads as the same replay, its tail's derivations worked out again from its edits; one of
/// version 5 keeps them, and reads as the same without reading an edit it is of.
#[test]
fn a_view_of_version_4_reads_its_derivations_from_its_edits() {
    let mut c = cast();
    let alice = c.alice;
    for i in 0..5 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let e = EntryId::from_u64(1000);
    let st = c.log.view();
    c.log.receive([write(&c.log, &st, MAC_A, e, 1)]);
    let held = c.log.edits().len();
    let was = replay(c.log.edits());
    for bytes in [was.to_view_4(held), was.to_view(held)] {
        let (back, n) = Replay::from_view(&bytes, c.log.edits(), c.log.ids()).expect("the view reads");
        assert_eq!(n, held);
        assert!(back == was && back.same_tail(&was), "read back, it differs");
    }
}

#[test]
fn stored_views_preserve_cap_group_bindings_in_current_and_tail_states() {
    use avendb::policy::{Level, Share, Sharing, Who};
    let mut c = cast();
    let group = EntryId::from_u64(9001);
    c.log
        .append(MAC_A, &[], creation(c.alice, group, c.alice, &[]))
        .unwrap();
    for (nonce, group) in [(1, Some(group)), (2, None)] {
        let share = Share {
            over: c.alice,
            who: Who::Vault(c.bob),
            level: Level::Read,
            wide: false,
            select: vec![1, 2, 3],
            parent: None,
            issuer: c.alice,
            nonce,
            group,
        };
        c.log
            .append(MAC_A, &[], Action::Share(Sharing::Grant(share, vec![])))
            .unwrap();
    }
    // Include a removal and continuation so the stored tail's delta states also carry the binding.
    c.log
        .append(
            PASSKEY_C,
            &[],
            Action::Revoke(Revoking::Device {
                vault: c.carol,
                device: MAC_C,
                keep: vec![],
            }),
        )
        .unwrap();
    let note = EntryId::from_u64(9002);
    c.log
        .append(MAC_A, &[], creation(c.alice, note, c.alice, &[]))
        .unwrap();
    let held = c.log.ids().len();
    let was = replay(c.log.edits());
    assert_eq!(
        was.state
            .shares()
            .iter()
            .filter(|s| s.share.group.is_some())
            .count(),
        1
    );
    let back = stored(&was, &c.log, held);
    c.log.receive([write(&c.log, &was.state, MAC_A, note, 5)]);
    let from_view = replay_on(back, c.log.edits(), held);
    let whole = replay(c.log.edits());
    assert!(from_view == whole && from_view.same_tail(&whole));
}

#[test]
fn previous_derived_view_version_is_rejected_for_full_replay() {
    let c = cast();
    let mut bytes = replay(c.log.edits()).to_view(c.log.ids().len());
    let current = b"avenDB view 5\n";
    assert!(bytes.starts_with(current));
    bytes[..current.len()].copy_from_slice(b"avenDB view 4\n");
    assert!(Replay::from_view(&bytes, c.log.edits(), c.log.ids()).is_none());
}

/// What the replay rules give for a cast of edits that reaches every kind of step: entries, writes on them, a share
/// bound to a cap group, a removal, and writes after it, as a stored view (`Replay::to_view`), hashed.
fn pinned_views() -> String {
    use avendb::policy::{Level, Share, Sharing, Who};
    let mut c = cast();
    let alice = c.alice;
    for i in 0..6 {
        c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
    }
    let share = Share {
        over: alice, who: Who::Vault(c.bob), level: Level::Read, wide: false, select: vec![1, 2, 3], parent: None,
        issuer: alice, nonce: 1, group: Some(EntryId::from_u64(1000)),
    };
    c.log.append(MAC_A, &[], Action::Share(Sharing::Grant(share, vec![]))).expect("a share");
    let mut views = vec![];
    for n in 0..12u8 {
        let st = c.log.view();
        c.log.receive([write(&c.log, &st, MAC_A, EntryId::from_u64(1000 + u64::from(n % 6)), n)]);
        if n == 5 {
            let leave = Action::Revoke(Revoking::Device { vault: c.carol, device: MAC_C, keep: vec![] });
            c.log.append(PASSKEY_C, &[], leave).expect("Carol's passkey revokes her Mac");
        }
        views.push(replay(c.log.edits()).to_view(c.log.edits().len()));
    }
    blake3::hash(&views.concat()).to_hex().to_string()
}

/// The replay rules' number (`viewRules`, `ViewRules.lean`) and the hash `pinned_views` gave under them.
const PINNED: (&str, &str) = ("2", "20640b9ba0230725d0804420125e7895aa1d1eb2e3cb7580e4527845a44e342d");

/// A device opens a view sealed to the same rules number with any later build (VR1), so what the rules give must not
/// change under one number. Where this fails: if the replay gives other views now (a rule changed, or a fix changed
/// what the engine's replay gives), bump `viewRules` in `spec/AvenDB/ViewRules.lean` and pin the new hash beside it,
/// so every device replays once; if only how a view or an edit is written down changed, with the same replay, pin the
/// new hash under the same number (a new view format bumps `VIEW` in `policy/view.rs`).
#[test]
fn the_replay_rules_number_pins_what_views_hold() {
    let rules = env!("AVENDB_VIEW_RULES");
    let got = pinned_views();
    assert_eq!(
        (rules, got.as_str()),
        PINNED,
        "the replay gives other views than the rules number pins: bump viewRules, or pin the new hash (see above)"
    );
}

/// A small deterministic generator, for the property below.
struct Rng(u64);

impl Rng {
    fn below(&mut self, n: u64) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (self.0 >> 33) % n
    }
}

/// VR1 and VR3 as a property: for logs of writes, shares and a removal in many orders, the view of any prefix reads
/// back as the replay of that prefix, opens against every longer log, and the edits after it step on it to the replay
/// of them all.
#[test]
fn a_view_of_any_prefix_opens_as_the_replay_of_that_prefix() {
    for seed in 0..8u64 {
        let mut rng = Rng(seed);
        let mut c = cast();
        let alice = c.alice;
        for i in 0..4 {
            c.log.append(MAC_A, &[], creation(alice, EntryId::from_u64(1000 + i), alice, &[])).expect("an entry");
        }
        let revoke_at = 3 + rng.below(30) as usize;
        for n in 0..40usize {
            if n == revoke_at {
                let leave = Action::Revoke(Revoking::Device { vault: c.carol, device: MAC_C, keep: vec![] });
                c.log.append(PASSKEY_C, &[], leave).expect("Carol's passkey revokes her Mac");
            }
            let st = c.log.view();
            let by = if rng.below(3) == 0 { PHONE_A } else { MAC_A };
            c.log.receive([write(&c.log, &st, by, EntryId::from_u64(1000 + rng.below(4)), n as u8)]);
        }
        let whole = replay(c.log.edits());
        for _ in 0..6 {
            let held = 1 + rng.below(c.log.edits().len() as u64) as usize;
            let prefix = replay(&c.log.edits()[..held]);
            let bytes = prefix.to_view(held);
            let (back, n) = Replay::from_view(&bytes, c.log.edits(), c.log.ids()).expect("a view of a prefix opens");
            assert_eq!(n, held);
            assert!(back == prefix && back.same_tail(&prefix), "seed {seed}, prefix {held}: it is not its replay");
            let on = replay_on(back, c.log.edits(), held);
            assert!(on == whole, "seed {seed}, prefix {held}: stepped on, it differs from the whole");
        }
    }
}
