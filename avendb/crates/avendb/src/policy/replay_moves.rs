//! The entry-indexed move facts are exactly the original all-moves replay. These tests run both implementations
//! explicitly, so the oracle remains exercised even in profiles without debug assertions.

use super::*;
use crate::keys::Recipient;

const OWNER_A: SignerId = SignerId::from_u64(1);
const DEVICE_A: SignerId = SignerId::from_u64(2);
const SPARE_A: SignerId = SignerId::from_u64(3);
const OWNER_B: SignerId = SignerId::from_u64(4);
const DEVICE_B: SignerId = SignerId::from_u64(5);
const FIRST: EntryId = EntryId::from_u64(101);
const OTHER: EntryId = EntryId::from_u64(102);

struct Fixture {
    state: State,
    edits: Vec<Edit>,
    alice: VaultId,
    bob: VaultId,
    share: ShareId,
}

fn edit(at: usize, author: SignerId, action: Action) -> Edit {
    Edit { parents: vec![], depth: at as u64, author, cosigners: vec![], action }
}

fn fixture(wide: bool) -> Fixture {
    let mut st = State::default();
    let mut edits = vec![];
    let mut at = 0;
    let mut add = |author, cosigners, action| {
        let e = Edit { cosigners, ..edit(at, author, action) };
        at += 1;
        let id = e.id();
        st.step_mut(&e, id).expect("fixture edit");
        edits.push(e);
        id
    };
    let genesis = |owner| Action::Genesis {
        kind: Kind::Human, owners: vec![Principal::Signer(owner)], threshold: 1,
        root: Some(owner), nonce: 0, seal_to: vec![],
    };
    let alice = VaultId::from(add(OWNER_A, vec![], genesis(OWNER_A)));
    for device in [DEVICE_A, SPARE_A] {
        add(OWNER_A, vec![device], Action::Share(Sharing::Device { vault: alice, device, seal_to: None }));
    }
    let bob = VaultId::from(add(OWNER_B, vec![], genesis(OWNER_B)));
    add(OWNER_B, vec![DEVICE_B], Action::Share(Sharing::Device { vault: bob, device: DEVICE_B, seal_to: None }));
    let share = ShareId::from(add(DEVICE_A, vec![], Action::Share(Sharing::Grant(Share {
        over: alice, who: Who::Vault(bob), level: Level::Write, wide, select: vec![],
        parent: None, issuer: alice, nonce: 0, group: None,
    }, vec![]))));
    for entry in [FIRST, OTHER] {
        add(DEVICE_A, vec![], Action::Write {
            vault: alice, entry, actor: alice, stay: None, epoch: 0, deps: vec![], proposal: Proposal::Main,
            via: vec![], create: Some(Creation { audience: if wide { vec![] } else { vec![share] }, nonce: [0; 32] }),
            files: vec![], body: vec![],
        });
    }
    Fixture { state: st, edits, alice, bob, share }
}

fn write(f: &Fixture, entry: EntryId, actor: VaultId) -> Action {
    Action::Write {
        vault: f.alice, entry, actor, stay: None, epoch: 0, deps: vec![], proposal: Proposal::Main,
        via: vec![], create: None, files: vec![], body: vec![],
    }
}

fn key(f: &Fixture, entry: EntryId) -> Action {
    Action::Keys { name: f.state.entry_key(entry).unwrap(), id: KeyId([0; 32]), public: None, boxes: vec![], clear: None }
}

fn wraps(f: &Fixture, entry: EntryId) -> Action {
    let name = f.state.entry_key(entry).unwrap();
    let to = f.state.current(KeyFam::Audience(f.alice, f.state.entry(entry).unwrap().audience()));
    Action::Wraps { entry, wraps: vec![Wrap {
        name, id: KeyId([0; 32]), boxed: KeyBox { to: Recipient::Key { name: to, id: KeyId([0; 32]) }, bytes: vec![] },
    }] }
}

fn moved(f: &Fixture, entry: EntryId, keep: Vec<EditId>) -> Action {
    Action::Mark { vault: f.alice, entry, caps: Some(vec![]), wants: None, keep, via: vec![] }
}

fn same_run(f: &Fixture, edits: &[Edit], rem: &HashSet<EditId>, snap: usize) -> Run {
    let ids = ids(edits);
    let watch = watched(edits);
    let run = |indexed| {
        if indexed {
            run_from_using::<true>(f.state.clone(), edits, &ids, rem, true, &watch, Some(snap))
        } else {
            run_from_using::<false>(f.state.clone(), edits, &ids, rem, true, &watch, Some(snap))
        }
    };
    let indexed = run(true);
    let all = run(false);
    assert_eq!(indexed.stood, all.stood, "standing edits");
    assert_eq!(indexed.state, all.state, "final state");
    assert_eq!(indexed.states, all.states, "every intermediate state");
    assert_eq!(indexed.acts, all.acts, "checkpoint signers");
    assert_eq!(indexed.snap, all.snap, "incremental replay snapshot");
    assert_eq!(indexed.moved_out, all.moved_out, "incremental replay boundary");
    indexed
}

#[test]
fn every_action_reads_only_its_own_entry_move_facts() {
    for wide in [false, true] {
        let f = fixture(wide);
        let actions = vec![
            (OWNER_A, Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(OWNER_A)],
                threshold: 1, root: None, nonce: 99, seal_to: vec![] }),
            (OWNER_A, Action::Settings { vault: f.alice, set: Setting::Threshold(1) }),
            (OWNER_A, Action::Settings { vault: f.alice, set: Setting::Root { root: None, keep: vec![] } }),
            (OWNER_A, Action::Share(Sharing::Owner { vault: f.alice, owner: Principal::Signer(OWNER_B), seal_to: None })),
            (OWNER_A, Action::Share(Sharing::Device { vault: f.alice, device: OWNER_A, seal_to: None })),
            (DEVICE_A, Action::Share(Sharing::Grant(Share { over: f.alice, who: Who::Vault(f.bob), level: Level::Read,
                wide: false, select: vec![], parent: None, issuer: f.alice, nonce: 99, group: None }, vec![]))),
            (OWNER_A, Action::Revoke(Revoking::Owner { vault: f.alice, owner: Principal::Signer(OWNER_A), keep: vec![] })),
            (OWNER_A, Action::Revoke(Revoking::Device { vault: f.alice, device: SPARE_A, keep: vec![] })),
            (DEVICE_A, Action::Revoke(Revoking::Grant { share: f.share, actor: f.alice, keep: vec![], via: vec![] })),
            (DEVICE_B, write(&f, FIRST, f.bob)),
            (DEVICE_B, write(&f, OTHER, f.bob)),
            (DEVICE_A, write(&f, FIRST, f.alice)),
            (DEVICE_A, Action::Write { vault: f.alice, entry: EntryId::from_u64(103), actor: f.alice,
                stay: None, epoch: 0, deps: vec![], proposal: Proposal::Main, via: vec![],
                create: Some(Creation { audience: vec![], nonce: [0; 32] }), files: vec![], body: vec![] }),
            (DEVICE_A, moved(&f, FIRST, vec![])),
            (DEVICE_A, Action::Mark { vault: f.alice, entry: FIRST, caps: None, wants: Some(vec![f.share]), keep: vec![], via: vec![] }),
            (DEVICE_A, key(&f, FIRST)),
            (DEVICE_A, wraps(&f, FIRST)),
            (DEVICE_B, Action::Claim { share: f.share, vault: f.bob, via: vec![] }),
            (OWNER_A, Action::Checkpoint { vault: f.alice, covers: vec![] }),
            (OWNER_A, Action::Snapshot { vault: f.alice, states: vec![] }),
        ];
        for (at, (author, action)) in actions.into_iter().enumerate() {
            let e = edit(at, author, action);
            for cut in [vec![], vec![Fact::Device(f.alice, DEVICE_A)], vec![Fact::Share(f.share)],
                vec![Fact::Owner(f.alice, Principal::Signer(OWNER_A)), Fact::Root(f.alice)]] {
                let moves = [Fact::Audience(FIRST, Arc::from([])), Fact::Audience(OTHER, Arc::from([])),
                    Fact::Audience(FIRST, Arc::from([f.share]))];
                let mut all = cut.clone();
                all.extend(moves.iter().cloned());
                let mut scoped = cut;
                scoped.extend(moves.iter().filter(|fact| matches!((&e.action, fact),
                    (Action::Write { entry, .. }, Fact::Audience(other, _)) if entry == other)).cloned());
                assert_eq!(f.state.hide(&scoped).accepts(&e, e.id()), f.state.hide(&all).accepts(&e, e.id()),
                    "action {at}, wide={wide}");
            }
        }
    }
}

#[test]
fn indexed_moves_match_whole_runs_with_cuts_keeps_and_checkpoints() {
    for mask in 0..32 {
        let f = fixture(mask & 1 != 0);
        let mut edits = vec![
            edit(0, DEVICE_B, write(&f, FIRST, f.bob)),
            edit(1, DEVICE_A, key(&f, FIRST)),
            edit(2, DEVICE_A, wraps(&f, OTHER)),
            edit(3, DEVICE_A, write(&f, OTHER, f.alice)),
        ];
        let keep = if mask & 2 != 0 { vec![edits[0].id()] } else { vec![] };
        edits.push(edit(4, DEVICE_A, moved(&f, FIRST, keep)));
        edits.push(edit(5, DEVICE_A, moved(&f, OTHER, vec![])));
        // A repeated audience is refused, and an unauthorized move also contributes no accepted state change.
        edits.push(edit(6, if mask & 4 == 0 { DEVICE_A } else { DEVICE_B }, moved(&f, FIRST, vec![])));
        edits.push(edit(7, OWNER_A, Action::Revoke(Revoking::Device {
            vault: f.alice, device: if mask & 8 == 0 { SPARE_A } else { DEVICE_A }, keep: vec![],
        })));
        let covers = ids(&edits);
        edits.push(edit(8, OWNER_A, Action::Checkpoint { vault: f.alice, covers }));
        let rem: HashSet<_> = edits.iter().filter(|e| e.is_removal() && (mask & 16 == 0 || e.depth != 5)).map(Edit::id).collect();
        for snap in [0, 4, edits.len()] {
            same_run(&f, &edits, &rem, snap);
        }
    }
}

#[test]
fn a_move_refusal_keeps_the_original_global_tail_boundary() {
    let f = fixture(false);
    let edits = vec![
        edit(0, DEVICE_B, write(&f, FIRST, f.bob)),
        edit(1, DEVICE_A, moved(&f, FIRST, vec![])),
        edit(2, DEVICE_A, key(&f, OTHER)),
        edit(3, DEVICE_A, moved(&f, OTHER, vec![])),
    ];
    let rem = edits.iter().filter(|e| e.is_removal()).map(Edit::id).collect();
    let run = same_run(&f, &edits, &rem, 2);
    assert_eq!(run.stood, [false, true, true, true]);
    assert_eq!(run.moved_out, Some(3), "tail stays past the last unseen move, including another entry's");
}

/// The pre-optimization replay/tail assembly, using the original materialized run. Resolution's standing-move
/// choices are already compared by `same_run`; the trust-only removal pass contains no audience moves.
fn materialized_replay(edits: &[Edit]) -> Replay {
    let ids = ids(edits);
    let depths = ids.iter().copied().zip(edits.iter().map(|e| e.depth)).collect();
    let (edits, ids) = order_ids(edits, &ids);
    let moving = |e: &Edit| matches!(e.action, Action::Mark { caps: Some(_), .. });
    let after = edits.iter().rposition(|e| e.is_removal() && !moving(e)).map_or(0, |i| i + 1);
    let mut at = after.max(edits.len().saturating_sub(TAIL));
    let Resolved { rem, cands, tried, mut base } = resolve_at(&edits, &ids, Some(at));
    let covered = watched(&edits);
    let old_run = |at| run_from_using::<false>(State::default(), &edits, &ids, &rem, false, &covered, Some(at));
    let mut run = old_run(at);
    let lost = (at..edits.len()).rev().find(|&i| moving(&edits[i]) && !run.stood[i]).map(|i| i + 1);
    if let Some(past) = lost.max(run.moved_out.map(|m| m + 1)).filter(|&p| p > at) {
        at = past;
        run = old_run(at);
        if base.is_some() {
            base = Some(trust_base(&edits, &ids, at));
        }
    }
    let Run { stood, state, acts, snap, .. } = run;
    let parents = edits.iter().flat_map(|e| e.parents.iter().copied()).collect();
    let tail = snap.map(|state| Tail { at, state, base, cands, tried, parents, covered, depths });
    Replay { edits, ids, stood, state, acts, tail }
}

#[test]
fn an_old_materialized_view_keeps_its_tail_and_late_merge_behavior() {
    let f = fixture(false);
    let mut edits = f.edits.clone();
    edits.extend([
        edit(100, OWNER_A, Action::Revoke(Revoking::Device { vault: f.alice, device: SPARE_A, keep: vec![] })),
        edit(110, DEVICE_A, write(&f, OTHER, f.alice)),
        edit(120, DEVICE_A, key(&f, FIRST)),
        edit(130, DEVICE_A, moved(&f, FIRST, vec![])),
        edit(140, DEVICE_A, moved(&f, OTHER, vec![])),
    ]);
    let old = materialized_replay(&edits);
    let new = replay(&edits);
    assert!(old == new && old.same_tail(&new), "cold replay preserves every persisted Tail field");
    let held = edits.len();
    let bytes = old.to_view(held);
    for (author, actor, denied) in [(DEVICE_A, f.alice, false), (DEVICE_B, f.bob, true)] {
        let late = edit(125, author, write(&f, FIRST, actor));
        let late_id = late.id();
        let mut received = edits.clone();
        received.push(late);
        let (loaded, n) = Replay::from_view(&bytes, &received, &ids(&received)).expect("the old stored view");
        assert_eq!(n, held);
        assert!(loaded.same_tail(&old));
        let (continued, why) = replay_on_why(loaded, &received, held);
        let (fresh, fresh_why) = replay_on_why(new.clone(), &received, held);
        assert_eq!(why, fresh_why);
        assert!(continued == fresh && continued.same_tail(&fresh), "loaded old tail continues identically");
        let whole = materialized_replay(&received);
        assert!(continued == whole, "late merge agrees with the original whole run");
        let at = continued.ids.iter().position(|id| *id == late_id).unwrap();
        assert_eq!(continued.stood[at], !denied);
        if denied {
            assert!(matches!(why, Why::Whole(_)), "an unseen move still forces a whole replay");
            assert!(continued.same_tail(&whole), "the refused late write preserves the old whole-replay tail");
        } else {
            assert_eq!(why, Why::Tail, "an allowed late write still uses the persisted tail");
        }
    }
}
