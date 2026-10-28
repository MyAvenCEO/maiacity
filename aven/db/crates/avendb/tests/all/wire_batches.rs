//! Paths on the wire (P8, `spec/AvenDB/WireBatches.lean`): a device's part of an edit held by its path up to a signed
//! root, in its signature's place (`Proof::held`), checks exactly where and as the signature does, after a restart too,
//! and nothing else passes for one.

use avendb::batch::{self, Proof, SignerLog};
use avendb::id::{EntryId, VaultId};
use avendb::policy::{Action, Edit, Proposal};
use avendb::sign::{DeviceKey, Signed};
use avendb::wire::Wire;

fn write(key: &DeviceKey, n: u64) -> Edit {
    let action = Action::Write {
        vault: VaultId::from_u64(1),
        entry: EntryId::from_u64(1),
        actor: VaultId::from_u64(1),
        stay: None,
        epoch: 0,
        deps: vec![],
        proposal: Proposal::Main,
        via: vec![],
        create: None,
        files: vec![],
        body: n.to_be_bytes().to_vec().into(),
    };
    Edit { parents: vec![], depth: n, author: key.id(), cosigners: vec![], action }
}

/// A device's `n` edits, each signed, and one root over them all.
fn batch(seed: u8, n: u64) -> (DeviceKey, Vec<Signed>, SignerLog) {
    let key = DeviceKey::from_secret([seed; 32]);
    let mut log = SignerLog::new(key.id());
    let edits: Vec<Signed> = (0..n)
        .map(|i| {
            let edit = write(&key, i + 100 * seed as u64);
            log.write(edit.id());
            Signed { sigs: vec![key.sign(edit.id())], edit }
        })
        .collect();
    log.commit(&key);
    (key, edits, log)
}

/// The edit with its signature replaced by its path.
fn by_path(signed: &Signed, log: &SignerLog) -> Signed {
    let proof = log.proof(signed.edit.id()).expect("a path");
    Signed { edit: signed.edit.clone(), sigs: vec![proof.held()] }
}

#[test]
fn a_part_held_by_its_path_checks_as_the_signature_does() {
    let (_, edits, log) = batch(31, 9);
    for signed in &edits {
        let held = by_path(signed, &log);
        assert!(signed.verify().is_ok());
        assert!(held.verify().is_ok(), "a path to a signed root stands for the signature");
        assert!(batch::held_by_path(&held) && !batch::held_by_path(signed));
        // as it is kept and read back after a restart
        let again = Signed::from_wire(&held.to_wire()).expect("reads back");
        assert_eq!(again, held);
        assert!(again.verify().is_ok());
        assert_eq!(Proof::of(&again.sigs[0]), log.proof(signed.edit.id()));
    }
}

#[test]
fn a_path_shows_no_other_edit_and_no_other_signer() {
    let (_, edits, log) = batch(32, 5);
    let (_, others, other_log) = batch(33, 5);
    // a path held on another edit of the same batch
    let held = by_path(&edits[0], &log);
    let moved = Signed { edit: edits[1].edit.clone(), sigs: held.sigs.clone() };
    assert!(moved.verify().is_err());
    // another device's path on this device's edit: its keys aren't the edit's signer's
    let theirs = by_path(&others[0], &other_log);
    assert!(Signed { edit: edits[0].edit.clone(), sigs: theirs.sigs }.verify().is_err());
    // the keys swapped for the edit's signer's, the root still another's
    let mut swapped = theirs_with_keys(&others[0], &other_log, &edits[0]);
    assert!(swapped.verify().is_err());
    // a hash of the path changed
    let mut proof = log.proof(edits[2].edit.id()).unwrap();
    if let Some(h) = proof.path.hashes.first_mut() {
        h[0] ^= 1;
    }
    swapped = Signed { edit: edits[2].edit.clone(), sigs: vec![proof.held()] };
    assert!(swapped.verify().is_err());
    // the root's signature broken
    let mut proof = log.proof(edits[3].edit.id()).unwrap();
    let mut root = (*proof.root).clone();
    root.sig[7] ^= 1;
    proof.root = std::sync::Arc::new(root);
    assert!(Signed { edit: edits[3].edit.clone(), sigs: vec![proof.held()] }.verify().is_err());
    // the mark alone, or the mark and garbage
    let mut bare = edits[4].sigs[0].clone();
    bare.pq = batch::PATH_MARK.to_vec();
    assert!(Signed { edit: edits[4].edit.clone(), sigs: vec![bare.clone()] }.verify().is_err());
    bare.pq.extend_from_slice(&[0; 64]);
    assert!(Signed { edit: edits[4].edit.clone(), sigs: vec![bare] }.verify().is_err());
}

fn theirs_with_keys(theirs: &Signed, their_log: &SignerLog, mine: &Signed) -> Signed {
    let mut sig = their_log.proof(theirs.edit.id()).unwrap().held();
    sig.keys = mine.sigs[0].keys;
    Signed { edit: mine.edit.clone(), sigs: vec![sig] }
}

#[test]
fn a_page_of_a_batch_checks_its_root_once() {
    // checked twice over: the second time every root is remembered, and each edit costs hashing alone
    let (_, edits, log) = batch(34, 64);
    let held: Vec<Signed> = edits.iter().map(|s| by_path(s, &log)).collect();
    for round in 0..2 {
        assert!(held.iter().all(|s| s.verify().is_ok()), "round {round}");
    }
}
