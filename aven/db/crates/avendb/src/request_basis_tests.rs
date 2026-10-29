//! RequestBasis.lean correspondence: exact structural reuse with fresh disclosure/follow/key availability.
use super::*;
use crate::cast::{world, todos_on};
use crate::policy::Revoking;
use crate::sync::answer_ids;
use std::sync::atomic::Ordering;

// Original uncached request algorithm, including uncached permission planning. Do not route this
// oracle through request_basis: equality must detect both stale structure and stale disclosure.
fn reference(lab: &Lab, d: SignerId, peer: SignerId) -> Request {
    let store = lab.held(d);
    let (edits, ids) = (store.log.edits(), store.log.ids());
    let places = answer_ids(edits, ids, lab.latest(d), peer, &store.follow);
    let logs = logs_of(edits, ids);
    let shared: HashSet<_> = places.iter().filter_map(|&i| logs[i]).collect();
    let theirs: HashSet<_> = places.iter().map(|&i| ids[i]).collect();
    let mut ask = asks_ids(edits, ids, &store.follow);
    ask.haves.retain(|log, _| shared.contains(log));
    ask.loose.retain(|id| theirs.contains(id));
    let wants: BTreeSet<_> = places.iter().flat_map(|&i| edits[i].blobs())
        .filter(|b| !store.blobs.contains_key(b)).collect();
    Request { ask, wants: wants.into_iter().collect(), after: None }
}
fn same(lab: &Lab, d: SignerId, peers: &[SignerId]) {
    for &peer in peers {
        assert_eq!(lab.request(d, peer).to_wire(), reference(lab, d, peer).to_wire());
    }
}
fn builds(lab: &Lab, d: SignerId) -> usize {
    lab.held(d).answers.basis_builds.load(Ordering::Relaxed)
}

#[test]
fn unchanged_requests_share_one_basis_across_peers_without_private_disclosure() {
    let mut w = world();
    todos_on(&mut w);
    let d = w.mac_a;
    let peers = [w.phone_a, w.mac_b, w.mac_c, w.stranger];
    let before = builds(&w.lab, d);
    // Explicitly evict any fixture-generated basis to count exactly one rebuild.
    *w.lab.held(d).answers.basis.lock().unwrap() = None;
    for _ in 0..4 { same(&w.lab, d, &peers); }
    // A caller may narrow or rewrite its outgoing request. That owned value must not
    // change the shared structural basis or the next request to any other peer.
    let mut narrowed = w.lab.request(d, w.phone_a);
    narrowed.ask.haves.clear();
    narrowed.ask.loose.clear();
    narrowed.ask.follow.push(w.carol);
    narrowed.wants.clear();
    same(&w.lab, d, &peers);
    assert_eq!(builds(&w.lab, d), before + 1);
    assert!(w.lab.request(d, w.stranger).ask.haves.is_empty());
}

#[test]
fn follow_and_blob_changes_are_current_without_rebuilding_history() {
    let mut w = world();
    todos_on(&mut w);
    let (d, peer) = (w.mac_a, w.phone_a);
    same(&w.lab, d, &[peer]);
    let before = builds(&w.lab, d);
    w.lab.follow(d, &[w.bob, w.alice, w.bob]);
    same(&w.lab, d, &[peer]);
    assert_eq!(w.lab.request(d, peer).ask.follow, w.lab.follows(d));
    w.lab.follow(d, &[]);
    same(&w.lab, d, &[peer]);
    let named: BTreeSet<_> = w.lab.answered(d, peer, &[]).iter()
        .flat_map(|&i| w.lab.held(d).log.edits()[i].blobs()).collect();
    let blob = *named.iter().find(|id| w.lab.held(d).blobs.contains_key(*id)).expect("fixture has an authorized key blob");
    let at = w.lab.at(d);
    let bytes = w.lab.stores.get_mut(&at).unwrap().blobs.remove(&blob).unwrap();
    assert!(!w.lab.request(d, peer).wants.contains(&blob), "a key it lacks but seals to no one is wanted by none");
    w.lab.stores.get_mut(&at).unwrap().sealing.insert(blob);
    assert!(w.lab.request(d, peer).wants.contains(&blob), "a key it lacks to seal to is asked for");
    same(&w.lab, d, &[peer]);
    w.lab.receive_now(d, vec![], vec![bytes], false);
    assert!(!w.lab.request(d, peer).wants.contains(&blob));
    same(&w.lab, d, &[peer]);
    assert_eq!(builds(&w.lab, d), before);
    let duplicate = w.lab.backup(d).signed.last().unwrap().clone();
    w.lab.receive_now(d, vec![duplicate], vec![], false);
    same(&w.lab, d, &[peer]);
    assert_eq!(builds(&w.lab, d), before, "duplicate signed receipt leaves structure unchanged");
    w.lab.lock(d);
    same(&w.lab, d, &[peer]);
    assert_eq!(builds(&w.lab, d), before, "locking keys does not change held structural history");
}

#[test]
fn revocation_changes_the_basis_and_a_restore_of_the_same_edits_gives_it_back() {
    let mut w = world();
    let todos = todos_on(&mut w);
    let (d, peer) = (w.mac_a, w.mac_c);
    same(&w.lab, d, &[peer]);
    let old = w.lab.request_basis(d);
    let snapshot = w.lab.backup(d);
    w.lab.submit(d, &[d], Action::Revoke(Revoking::Grant {
        share: todos.carol_read, actor: w.alice, keep: vec![], via: vec![],
    })).unwrap();
    same(&w.lab, d, &[peer, w.stranger]);
    assert!(!Arc::ptr_eq(&old, &w.lab.request_basis(d)));
    assert!(!w.lab.request(d, peer).ask.haves.contains_key(&LogId::Entry(todos.door)));
    w.lab.restore_backup(d, &snapshot);
    same(&w.lab, d, &[peer]);
    let restored = w.lab.request_basis(d);
    // The same edits as before the revocation: the same head, and the basis worked out of them is the same.
    assert_eq!(old.head, restored.head);
    assert_eq!(old.ask, restored.ask);
    w.lab.restore_backup(d, &snapshot);
    same(&w.lab, d, &[peer]);
    assert_eq!(restored.ask, w.lab.request_basis(d).ask);
}

#[test]
fn equal_length_different_restored_histories_produce_their_own_requests() {
    let mut w = world();
    let todos = todos_on(&mut w);
    let (d, peer) = (w.mac_a, w.phone_a);
    let base = w.lab.backup(d);
    w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "Branch A")).unwrap();
    let a = w.lab.backup(d);
    w.lab.restore_backup(d, &base);
    w.lab.edit(d, w.alice, todos.door, |item| item.set_text(1, "Branch B")).unwrap();
    let b = w.lab.backup(d);
    assert_eq!(a.signed.len(), b.signed.len(), "count cannot distinguish these histories");
    w.lab.restore_backup(d, &a);
    same(&w.lab, d, &[peer]);
    let request_a = w.lab.request(d, peer).to_wire();
    let basis_a = w.lab.request_basis(d);
    w.lab.restore_backup(d, &b);
    same(&w.lab, d, &[peer]);
    assert_ne!(basis_a.head, w.lab.request_basis(d).head);
    assert_ne!(request_a, w.lab.request(d, peer).to_wire());
}

#[test]
fn missing_parent_arrival_and_withdrawal_rebuild_structural_closure() {
    let mut w = world();
    todos_on(&mut w);
    let d = w.mac_a;
    let full = w.lab.held(d).log.clone();
    let mut shortened = full.clone();
    let removed = *full.ids().first().unwrap();
    shortened.let_go(&[removed].into());
    let at = w.lab.at(d);
    w.lab.stores.get_mut(&at).unwrap().log = shortened;
    let incomplete = w.lab.request_basis(d);
    assert_eq!(incomplete.ask, asks_ids(w.lab.held(d).log.edits(), w.lab.held(d).log.ids(), &[]));
    let parent = full.edits()[0].clone();
    w.lab.stores.get_mut(&at).unwrap().log.receive([parent]);
    let repaired = w.lab.request_basis(d);
    assert_ne!(incomplete.head, repaired.head);
    assert_eq!(repaired.ask, asks_ids(w.lab.held(d).log.edits(), w.lab.held(d).log.ids(), &[]));
    w.lab.stores.get_mut(&at).unwrap().log.let_go(&[removed].into());
    let withdrawn = w.lab.request_basis(d);
    assert_ne!(repaired.head, withdrawn.head);
    assert_eq!(withdrawn.ask, incomplete.ask);
}

/// The log's own index of each edit's log (`Log::logs`, `Log::by_log`) is what a scan of every edit finds, as edits
/// arrive and after the log lets some go; and an answer by it is the scan's, for every device and every asker.
#[test]
fn the_log_index_is_the_scan() {
    let mut w = world();
    todos_on(&mut w);
    let devices = [w.mac_a, w.phone_a, w.mac_b, w.mac_c, w.stranger];
    let indexed = |log: &Log| {
        let (edits, ids) = (log.edits(), log.ids());
        assert_eq!(log.logs(), logs_of(edits, ids).as_slice());
        let mut by_log: HashMap<LogId, Vec<usize>> = HashMap::new();
        for (i, l) in log.logs().iter().enumerate() {
            if let Some(l) = l { by_log.entry(*l).or_default().push(i); }
        }
        assert_eq!(log.by_log(), &by_log);
    };
    for &d in &devices {
        indexed(&w.lab.held(d).log);
        for &peer in &devices {
            let store = w.lab.held(d);
            let scan = answer_ids(store.log.edits(), store.log.ids(), w.lab.latest(d), peer, &[]);
            assert_eq!(*w.lab.answered(d, peer, &[]), scan);
        }
    }
    let mut log = w.lab.held(w.mac_a).log.clone();
    let gone: HashSet<EditId> = log.ids().iter().step_by(3).copied().collect();
    log.let_go(&gone);
    indexed(&log);
}
