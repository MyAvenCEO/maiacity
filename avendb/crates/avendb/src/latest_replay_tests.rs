//! LatestReplay.lean correspondence: deferred history uses guarded replay, never stale policy.
use super::*;
use crate::cast::{world, todos_on};
use crate::policy::Revoking;

fn check(lab: &Lab, d: SignerId, peers: &[SignerId]) -> Why {
    let store = lab.held(d);
    let canonical = store.log.view();
    let (advanced, why) = replay_on_why(store.replay.clone(), store.log.edits(), store.replayed);
    assert!(advanced.state == canonical);
    assert!(*lab.latest(d) == canonical);
    let first = lab.latest(d) as *const State;
    assert_eq!(first, lab.latest(d) as *const State, "same revision reuses latest");
    for &peer in peers {
        let expected = answer_ids(store.log.edits(), store.log.ids(), &canonical, peer, &[]);
        let actual = lab.answered(d, peer, &[]);
        assert_eq!(*actual, expected, "canonical permission selection including private edits");
        assert!(Arc::ptr_eq(&actual, &lab.answered(d, peer, &[])));
    }
    why
}

#[test]
fn deferred_writes_advance_latest_and_revocation_falls_back_without_stale_disclosure() {
    let mut w = world();
    let todos = todos_on(&mut w);
    let d = w.mac_a;
    let peers = [w.mac_b, w.mac_c, w.stranger];
    let base = w.lab.backup(d);
    let held: HashSet<_> = base.signed.iter().map(|s| s.edit.id()).collect();
    w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "First deferred write")).unwrap();
    w.lab.edit(d, w.alice, todos.seeds, |item| item.set_text(1, "Second deferred write")).unwrap();
    let writes = w.lab.backup(d);
    let fresh: Vec<_> = writes.signed.iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
    w.lab.restore_backup(d, &base);
    assert!(w.lab.receive_now(d, fresh, vec![], false) >= 2);
    assert!(w.lab.held(d).behind);
    assert!(w.lab.held(d).latest.get().is_none());
    assert!(matches!(check(&w.lab, d, &peers), Why::Stepped | Why::Tail));
    measure(&w.lab, d, "deferred writes");
    w.lab.catch_up(d);
    let before_revoke = w.lab.backup(d);
    let known: HashSet<_> = before_revoke.signed.iter().map(|s| s.edit.id()).collect();
    w.lab.submit(d, &[d], Action::Revoke(Revoking::Grant {
        share: todos.carol_read, actor: w.alice, keep: vec![], via: vec![],
    })).unwrap();
    let revoked = w.lab.backup(d);
    let fresh = revoked.signed.iter().filter(|s| !known.contains(&s.edit.id())).cloned().collect();
    w.lab.restore_backup(d, &before_revoke);
    check(&w.lab, d, &peers);
    w.lab.receive_now(d, fresh, vec![], false);
    assert!(w.lab.held(d).latest.get().is_none());
    assert!(matches!(check(&w.lab, d, &peers), Why::Whole(_)));
    measure(&w.lab, d, "revocation fallback");
    assert!(!w.lab.request(d, w.mac_c).ask.haves.contains_key(&LogId::Entry(todos.door)));
    w.lab.restore_backup(d, &before_revoke);
    check(&w.lab, d, &peers);
    w.lab.restore_backup(d, &base);
    check(&w.lab, d, &peers);
}

#[test]
fn late_parent_and_restore_match_whole_replay() {
    let mut w = world();
    todos_on(&mut w);
    let d = w.mac_a;
    let snapshot = w.lab.backup(d);
    // Construct a real deferred prefix followed by reverse receipt of the remainder.
    // Signature validation and the canonical fallback judge the historical order.
    w.lab.restore_backup(d, &Backup { signed: vec![], blobs: snapshot.blobs.clone(), bootstrap_bases:BTreeMap::new(), semantic_pending:HashSet::new() });
    let split = snapshot.signed.len() / 2;
    w.lab.receive_now(d, snapshot.signed[split..].to_vec(), vec![], false);
    check(&w.lab, d, &[w.mac_c, w.stranger]);
    w.lab.catch_up(d);
    w.lab.receive_now(d, snapshot.signed[..split].to_vec(), vec![], false);
    check(&w.lab, d, &[w.mac_c, w.stranger]);
    w.lab.restore_backup(d, &snapshot);
    check(&w.lab, d, &[w.mac_c, w.stranger]);
}

#[test]
fn deferred_checkpoint_keeps_canonical_fallback() {
    let mut w = world();
    todos_on(&mut w);
    let d = w.mac_a;
    let base = w.lab.backup(d);
    let known: HashSet<_> = base.signed.iter().map(|s| s.edit.id()).collect();
    w.lab.submit(d, &[w.passkey_a], Action::Checkpoint { vault: w.alice, covers: vec![] }).unwrap();
    let after = w.lab.backup(d);
    let fresh = after.signed.iter().filter(|s| !known.contains(&s.edit.id())).cloned().collect();
    w.lab.restore_backup(d, &base);
    w.lab.receive_now(d, fresh, vec![], false);
    assert!(matches!(check(&w.lab, d, &[w.mac_c, w.stranger]), Why::Whole(_)));
}

#[test]
fn trust_withdrawal_resets_prefix_before_next_latest() {
    let mut w = world();
    let todos = todos_on(&mut w);
    let d = w.mac_a;
    check(&w.lab, d, &[w.mac_c, w.stranger]);
    let at = w.lab.at(d);
    let store = w.lab.stores.get_mut(&at).unwrap();
    let old_revision = store.log.revision();
    let id = *store.log.ids().iter().find(|id| {
        store.signed.get(id).unwrap().edit.entry() == Some(todos.door)
    }).unwrap();
    // Simulate a receipt held on a checkpoint's word whose signature was discarded,
    // but which is no longer vouched for. Exercise the real withdrawal path.
    let signed = store.signed.get_mut(&id).unwrap();
    for sig in &mut signed.sigs { sig.pq.clear(); sig.webauthn = None; sig.enclave = None; }
    assert!(signed.verify().is_err());
    store.bare.insert(id);
    assert!(trust(store));
    assert_ne!(old_revision, store.log.revision());
    assert_eq!(store.replayed, 0);
    assert!(store.latest.get().is_none());
    assert!(!store.log.ids().contains(&id));
    assert!(matches!(check(&w.lab, d, &[w.mac_c, w.stranger]), Why::Whole(_)));
}

fn measure(lab: &Lab, d: SignerId, label: &str) {
    // Supplementary CPU comparison, including clone cost; no wall-clock acceptance assertion.
    let store = lab.held(d);
    let full_at = std::time::Instant::now();
    for _ in 0..8 { std::hint::black_box(store.log.view()); }
    let full = full_at.elapsed();
    let guarded_at = std::time::Instant::now();
    for _ in 0..8 {
        std::hint::black_box(replay_on_why(store.replay.clone(), store.log.edits(), store.replayed));
    }
    eprintln!("latest {label}: held={} prefix={} iterations=8 full={:?} guarded_including_clone={:?}",
        store.log.edits().len(), store.replayed, full, guarded_at.elapsed());
}
