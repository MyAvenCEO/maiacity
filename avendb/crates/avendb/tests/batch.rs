//! Batch-signed logs (M3, `spec/AvenDB/Batches.lean`, V5): a root a device signs once per batch and a path up its tree
//! show an edit exactly as the device's signature on it does; old logs keep their signatures and check as before; a
//! log as it stands is wrapped in its order; group commit; two roots that disagree prove a fork and freeze their
//! signer.

use std::sync::{Arc, Mutex};

use avendb::batch::{
    self, check, rebuild, ForkProof, Path, Proof, Root, Roots, SignedRoot, SignerLog, Taken, Tree, FORK,
};
use avendb::id::{EditId, EntryId, SignerId, VaultId};
use avendb::policy::{Action, Edit, Proposal, Refusal};
use avendb::sign::{DeviceKey, Signature, Signed};
use avendb::wire::Wire;

/// A write by `author`, cosigned by `cosigners`, its body `n`: an edit like any a device makes.
fn write(author: SignerId, cosigners: Vec<SignerId>, n: u64) -> Edit {
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
        body: n.to_be_bytes().to_vec(),
    };
    Edit { parents: vec![], depth: n, author, cosigners, action }
}

/// A device that writes `n` edits, committing a batch after each run of the lengths `runs` cycles through: the edits,
/// each signed on its own too, and its log.
fn device(seed: u8, n: u64, runs: &[usize]) -> (DeviceKey, Vec<Signed>, SignerLog) {
    let key = DeviceKey::from_secret([seed; 32]);
    let mut log = SignerLog::new(key.id());
    let mut edits = vec![];
    let mut run = runs.iter().cycle();
    let mut left = *run.next().unwrap();
    for i in 0..n {
        let edit = write(key.id(), vec![], i + 1000 * seed as u64);
        log.write(edit.id());
        edits.push(Signed { sigs: vec![key.sign(edit.id())], edit });
        left -= 1;
        if left == 0 {
            log.commit(&key);
            left = *run.next().unwrap();
        }
    }
    log.commit(&key);
    (key, edits, log)
}

/// What a device checks of edit `edit` by `signer`: by its signature alone, and by its path alone.
fn both(edit: &Edit, sig: &Signature, proof: &Proof, roots: &mut Roots) -> (bool, bool) {
    let by_sig = Signed { edit: edit.clone(), sigs: vec![sig.clone()] }.verify().is_ok();
    let by_path = check(edit, &[None], &[Some(proof.clone())], roots).is_ok();
    (by_sig, by_path)
}

#[test]
fn a_signed_root_and_a_path_show_an_edit_exactly_as_its_signature_does() {
    let (key, edits, log) = device(7, 40, &[1, 3, 7, 2]);
    let other = DeviceKey::from_secret([8; 32]);
    let mut roots = Roots::new();
    for (i, s) in edits.iter().enumerate() {
        let proof = log.proof(s.edit.id()).expect("every edit is under a root");
        // the edit as signed: both ways take it
        assert_eq!(both(&s.edit, &s.sigs[0], &proof, &mut roots), (true, true), "edit {i}");
        // another edit under the same signature and path: neither
        let other_edit = write(key.id(), vec![], 9_000 + i as u64);
        assert_eq!(both(&other_edit, &s.sigs[0], &proof, &mut roots), (false, false));
        // another device claiming it: neither, its keys name another signer and the root another log
        let claimed = Edit { author: other.id(), ..s.edit.clone() };
        assert_eq!(both(&claimed, &s.sigs[0], &proof, &mut roots), (false, false));
        // the path of the next edit: the root doesn't climb from this one
        let next = &edits[(i + 1) % edits.len()];
        let wrong = log.proof(next.edit.id()).unwrap();
        assert!(check(&s.edit, &[None], &[Some(wrong)], &mut roots).is_err());
    }
    // a root its device didn't sign shows nothing: another device's signature on it, or a broken one
    let s = &edits[3];
    let proof = log.proof(s.edit.id()).unwrap();
    let sig = other.sign_root(&proof.root.root.message());
    let forged = Arc::new(SignedRoot { keys: other.keys(), sig, ..(*proof.root).clone() });
    let mut broken = (*proof.root).clone();
    broken.sig[100] ^= 1;
    for root in [forged, Arc::new(broken)] {
        let p = Proof { root, path: proof.path.clone() };
        assert!(!p.shows(key.id(), s.edit.id()));
        assert!(check(&s.edit, &[None], &[Some(p)], &mut Roots::new()).is_err());
    }
    // nor does a root that claims another length than its path's
    let longer = Root { length: proof.root.root.length + 1, ..proof.root.root };
    let p = Proof { root: Arc::new(SignedRoot::sign(&key, longer)), path: proof.path.clone() };
    assert!(!p.shows(key.id(), s.edit.id()));
}

#[test]
fn a_cosigned_edit_checks_by_any_mix_of_signatures_and_paths() {
    let (a, b) = (DeviceKey::from_secret([1; 32]), DeviceKey::from_secret([2; 32]));
    let edit = write(a.id(), vec![b.id()], 1);
    let (mut la, mut lb) = (SignerLog::new(a.id()), SignerLog::new(b.id()));
    la.write(edit.id());
    lb.write(edit.id());
    la.commit(&a);
    lb.commit(&b);
    let sigs = [Some(a.sign(edit.id())), Some(b.sign(edit.id()))];
    let proofs = [la.proof(edit.id()), lb.proof(edit.id())];
    let signed = Signed { edit: edit.clone(), sigs: vec![a.sign(edit.id()), b.sign(edit.id())] };
    assert!(signed.verify().is_ok());
    let mut roots = Roots::new();
    // each signer by one way or the other: all four mixes take it, as every signature does
    for (sa, pa) in [(true, false), (false, true)] {
        for (sb, pb) in [(true, false), (false, true)] {
            let s = [sigs[0].clone().filter(|_| sa), sigs[1].clone().filter(|_| sb)];
            let p = [proofs[0].clone().filter(|_| pa), proofs[1].clone().filter(|_| pb)];
            assert_eq!(check(&edit, &s, &p, &mut roots), Ok(()));
        }
    }
    // one signer with neither: refused, as a missing signature is
    assert_eq!(check(&edit, &[sigs[0].clone(), None], &[None, None], &mut roots), Err(Refusal::BadSignature));
    // a's path stands for a alone, never for b
    assert!(check(&edit, &[sigs[0].clone(), None], &[None, proofs[0].clone()], &mut roots).is_err());
}

#[test]
fn old_logs_keep_their_signatures_and_check_as_today() {
    let (key, edits, _) = device(5, 6, &[6]);
    let mut roots = Roots::new();
    for s in &edits {
        assert!(s.verify().is_ok());
        assert_eq!(check(&s.edit, &[Some(s.sigs[0].clone())], &[None], &mut roots), Ok(()));
        // a broken signature is refused, as it always was
        let mut bad = s.sigs[0].clone();
        bad.pq[0] ^= 1;
        assert!(Signed { edit: s.edit.clone(), sigs: vec![bad.clone()] }.verify().is_err());
        assert!(check(&s.edit, &[Some(bad)], &[None], &mut roots).is_err());
    }
    // a creation must still name its entry by its own id, whichever way it is signed
    let mut creation = write(key.id(), vec![], 99);
    if let Action::Write { create, .. } = &mut creation.action {
        *create = Some(avendb::policy::Creation { audience: vec![], nonce: [3; 32] });
    }
    let sig = key.sign(creation.id());
    assert_eq!(Signed { edit: creation.clone(), sigs: vec![sig.clone()] }.verify().err(), Some(Refusal::NotItsId));
    assert_eq!(check(&creation, &[Some(sig)], &[None], &mut roots), Err(Refusal::NotItsId));
    // the wire bytes of a signed edit are what they were: nothing new rides on them
    let s = &edits[0];
    assert_eq!(Signed::from_wire(&s.to_wire()).unwrap(), *s);
}

#[test]
fn an_existing_log_is_wrapped_as_it_stands_and_signed_once() {
    // six edits signed one by one before batches, held in this order
    let (key, old, _) = device(3, 6, &[6]);
    let mut log = SignerLog::wrap(key.id(), old.iter().map(|s| s.edit.id()));
    assert_eq!(log.waiting(), 6);
    let wrap = log.commit(&key).expect("one root over all of it");
    assert_eq!((wrap.root.length, wrap.root.fork), (6, FORK));
    let mut roots = Roots::new();
    assert_eq!(roots.take(&wrap, None), Taken::Newer);
    for s in &old {
        // each keeps its signature, which checks, and gains a path to the wrap
        assert!(s.verify().is_ok());
        let proof = log.proof(s.edit.id()).unwrap();
        assert!(Arc::ptr_eq(&proof.root, &wrap));
        assert_eq!(both(&s.edit, &s.sigs[0], &proof, &mut roots), (true, true));
    }
    // new edits are signed by batch, and the next root begins with the wrap
    let new: Vec<Edit> = (0..5).map(|i| write(key.id(), vec![], 500 + i)).collect();
    for e in &new {
        log.write(e.id());
    }
    let next = log.commit(&key).unwrap();
    let prefix = log.prefix(6).unwrap();
    assert_eq!(roots.take(&next, Some(&prefix)), Taken::Newer);
    for e in &new {
        assert_eq!(check(e, &[None], &[log.proof(e.id())], &mut roots), Ok(()));
    }
    // the same order makes the same wrap, so wrapping again signs no other history
    assert_eq!(Tree::wrap(old.iter().map(|s| s.edit.id())).root(), wrap.root.hash);
}

#[test]
fn group_commit_signs_at_once_and_batches_what_comes_meanwhile() {
    let key = DeviceKey::from_secret([9; 32]);
    let mut log = SignerLog::new(key.id());
    let ids: Vec<EditId> = (0..5).map(|i| write(key.id(), vec![], i).id()).collect();
    // a quiet device's first write is signed at once
    log.write(ids[0]);
    let first = log.begin().expect("free, and an edit waits");
    assert_eq!(first.length, 1);
    // two more come while it signs: they wait, and no second batch begins
    log.write(ids[1]);
    log.write(ids[2]);
    assert_eq!(log.begin(), None);
    assert!(log.end(SignedRoot::sign(&key, first)));
    assert_eq!(log.waiting(), 2);
    // the next batch takes both
    let second = log.begin().unwrap();
    assert_eq!(second.length, 3);
    // a root it didn't begin, or another device's, ends nothing
    assert!(!log.end(SignedRoot::sign(&key, first)));
    let other = DeviceKey::from_secret([10; 32]);
    assert!(!log.end(SignedRoot::sign(&other, Root { log: other.id(), ..second })));
    assert!(log.end(SignedRoot::sign(&key, second)));
    assert_eq!((log.waiting(), log.begin()), (0, None));

    // under load: a writer and a signer at once, the signer signing outside the lock as a device does
    let shared = Arc::new(Mutex::new(SignerLog::new(key.id())));
    let n = 300u64;
    let writer = {
        let shared = shared.clone();
        let id = key.id();
        std::thread::spawn(move || {
            for i in 0..n {
                shared.lock().unwrap().write(write(id, vec![], 10_000 + i).id());
            }
        })
    };
    let mut roots = Roots::new();
    let mut batches = 0;
    let mut last = 0;
    loop {
        let done = writer.is_finished();
        let begun = shared.lock().unwrap().begin();
        match begun {
            Some(root) => {
                let signed = SignedRoot::sign(&key, root);
                let mut log = shared.lock().unwrap();
                assert!(log.end(signed.clone()));
                // each root begins with the one before
                let prefix = (last > 0).then(|| log.tree().prefix(last, root.length).unwrap());
                assert_eq!(roots.take(&signed, prefix.as_deref()), Taken::Newer);
                last = root.length;
                batches += 1;
            }
            None if done => break,
            None => std::thread::yield_now(),
        }
    }
    writer.join().unwrap();
    let log = shared.lock().unwrap();
    assert_eq!((log.tree().len(), log.waiting()), (n, 0));
    assert!(batches >= 1 && batches <= n, "{batches} batches");
    for i in 0..n {
        let edit = write(key.id(), vec![], 10_000 + i);
        assert_eq!(check(&edit, &[None], &[log.proof(edit.id())], &mut roots), Ok(()));
    }
}

#[test]
fn two_roots_that_disagree_prove_a_fork_and_freeze_their_signer() {
    let (key, edits, log) = device(4, 3, &[3]);
    let honest = log.signed().unwrap().clone();
    let mut roots = Roots::new();
    assert_eq!(roots.take(&honest, None), Taken::Newer);
    assert_eq!(roots.take(&honest, None), Taken::Same);
    // a clone, restored from a backup after the second edit, signs another third
    let mut clone = SignerLog::wrap(key.id(), edits[..2].iter().map(|s| s.edit.id()));
    let third = write(key.id(), vec![], 777);
    clone.write(third.id());
    let forked = clone.commit(&key).unwrap();
    let Taken::Fork(proof) = roots.take(&forked, None) else { panic!("one length, two roots: a fork") };
    assert_eq!(proof.signer(), Some(key.id()));
    assert!(roots.why(key.id()).unwrap().contains("signed two histories"));
    // frozen: no path to its roots counts any more, while the signatures of its edits still check
    let s = &edits[0];
    let path = log.proof(s.edit.id()).unwrap();
    assert!(check(&s.edit, &[None], &[Some(path)], &mut roots).is_err());
    assert_eq!(check(&s.edit, &[Some(s.sigs[0].clone())], &[None], &mut roots), Ok(()));
    assert_eq!(roots.take(&honest, None), Taken::Frozen);
    // the proof travels: a device that never saw either root freezes the signer too
    let passed = ForkProof::from_wire(&proof.to_wire()).unwrap();
    let mut elsewhere = Roots::new();
    assert!(elsewhere.freeze(passed));
    assert!(elsewhere.frozen(key.id()).is_some());

    // of other lengths: the clone's fourth root, linked by its own tree, shows its first three aren't the honest three
    let fourth = write(key.id(), vec![], 778);
    clone.write(fourth.id());
    let longer = clone.commit(&key).unwrap();
    let mut roots = Roots::new();
    roots.take(&honest, None);
    let prefix = clone.prefix(3).unwrap();
    let Taken::Fork(proof) = roots.take(&longer, Some(&prefix)) else { panic!("a longer root that begins otherwise") };
    assert_eq!((proof.a.root.length, proof.b.root.length, proof.signer()), (3, 4, Some(key.id())));
    // and of another fork number
    let other_fork = SignedRoot::sign(&key, Root { fork: FORK + 1, ..honest.root });
    let mut roots = Roots::new();
    roots.take(&honest, None);
    assert!(matches!(roots.take(&other_fork, None), Taken::Fork(_)));
}

#[test]
fn an_honest_log_never_proves_a_fork() {
    let (key, _, mut log) = device(6, 9, &[2, 5]);
    let mut roots = Roots::new();
    let mut signed = vec![log.signed().unwrap().clone()];
    for i in 0..6 {
        log.write(write(key.id(), vec![], 600 + i).id());
        signed.push(log.commit(&key).unwrap());
    }
    // every pair of its roots, linked by its tree, agrees, shorter or longer
    for a in &signed {
        for b in &signed {
            let (m, n) = (a.root.length.min(b.root.length), a.root.length.max(b.root.length));
            let (shorter, longer) = if a.root.length <= b.root.length { (a, b) } else { (b, a) };
            let prefix = log.tree().prefix(m, n).unwrap();
            let proof = ForkProof { a: (**shorter).clone(), b: (**longer).clone(), prefix };
            assert_eq!(proof.signer(), None);
        }
    }
    // taken in any order with what links them: never frozen
    for r in signed.iter().rev() {
        let newest = roots.newest(key.id()).map(|n| n.root.length);
        let prefix = newest.and_then(|n| {
            let (m, x) = (n.min(r.root.length), n.max(r.root.length));
            log.tree().prefix(m, x)
        });
        let taken = roots.take(r, prefix.as_deref());
        assert!(matches!(taken, Taken::Newer | Taken::Older | Taken::Same), "{taken:?}");
    }
    assert!(roots.frozen(key.id()).is_none());
    // a root without what links it is only unlinked, and so is one with a prefix a peer made up: no fork
    let mut fresh = Roots::new();
    fresh.take(&signed[1], None);
    assert_eq!(fresh.take(&signed[4], None), Taken::Unlinked);
    let made_up = vec![[1; 32]; log.tree().prefix(signed[1].root.length, signed[4].root.length).unwrap().len()];
    assert_eq!(fresh.take(&signed[4], Some(&made_up)), Taken::Unlinked);
    assert!(fresh.frozen(key.id()).is_none());
    // an unlinked root is still good for the paths up to it
    assert_eq!(fresh.newest(key.id()).unwrap().root, signed[1].root);
}

#[test]
fn a_path_is_about_thirty_hashes_at_a_billion_edits() {
    let n = (1u64 << 17) + 3;
    let tree = Tree::wrap((0..n).map(EditId::from_u64));
    for i in [0, 1, n / 2, n - 4, n - 1] {
        let path = tree.prove(i, n).unwrap();
        assert!(path.hashes.len() <= 18, "{}", path.hashes.len());
        assert_eq!(path.climb(EditId::from_u64(i)), Some(tree.root()));
    }
    // a billion edits splits 30 times at most: the depth of the first edit's path
    let (mut depth, mut size) = (0, 1_000_000_000u64);
    while size > 1 {
        size = batch::split(size);
        depth += 1;
    }
    assert_eq!(depth, 30);
    // every root a longer tree keeps begins as the shorter's did
    let short = Tree::wrap((0..1000).map(EditId::from_u64));
    let p = tree.prefix(1000, n).unwrap();
    assert_eq!(rebuild(1000, n, &p), Some((short.root(), tree.root())));
}

/// `value` reads back from its bytes alone, which start with the format's version: not under another version, nor a
/// byte short or a byte more, nor any cut of them.
fn reads_one_way<T: Wire + PartialEq + std::fmt::Debug>(value: &T) {
    let bytes = value.to_wire();
    assert_eq!(bytes[0], batch::FORMAT);
    assert_eq!(T::from_wire(&bytes).unwrap(), *value);
    let mut other = bytes.clone();
    other[0] = batch::FORMAT + 1;
    assert!(T::from_wire(&other).is_err());
    assert!(T::from_wire(&[&bytes[..], &[0]].concat()).is_err());
    for cut in 0..bytes.len() {
        assert!(T::from_wire(&bytes[..cut]).is_err());
    }
}

#[test]
fn every_new_format_starts_with_its_version_and_reads_back_one_way() {
    let (key, edits, log) = device(2, 5, &[5]);
    let proof = log.proof(edits[2].edit.id()).unwrap();
    let root = (*proof.root).clone();
    reads_one_way(&root);
    reads_one_way(&proof.path);
    reads_one_way(&proof);
    // a path with a hash more than its place takes reads as nothing
    let long = Path { hashes: [&proof.path.hashes[..], &[[0; 32]]].concat(), ..proof.path.clone() };
    assert!(Path::from_wire(&long.to_wire()).is_err());
    // a root's signature counts for that root alone: as an edit's it is no signature
    let as_edit = Signature { keys: key.keys(), webauthn: None, enclave: None, pq: root.sig.clone() };
    assert!(!avendb::sign::verify(key.id(), EditId(root.root.hash), &as_edit));
}

#[test]
fn a_device_wraps_its_log_and_signs_one_root_at_unlock_then_adds_each_edit_it_signs() {
    use avendb::cast::{document, handbook, world};
    let mut w = world();
    let h = handbook(&mut w);
    let phone = w.phone_a;
    for i in 0..3 {
        let note = document("A note", &format!("Note {i}."), phone);
        w.lab.create(phone, h.coop, h.coop, "note", &[], note).expect("a note");
    }
    w.lab.lock(phone);
    assert!(w.lab.signer_log(phone).is_none(), "locked, it holds no log");
    assert!(w.lab.unlock(phone));
    // the edits it holds that it signed, in the order it holds them
    let held = w.lab.log(phone);
    let own: Vec<EditId> =
        held.edits().iter().zip(held.ids()).filter(|(e, _)| e.sigs().any(|s| s == phone)).map(|(_, id)| *id).collect();
    assert!(own.len() >= 3);
    // wrapped as it stands at the unlock, under one root it signed
    let log = w.lab.signer_log(phone).expect("wrapped at the unlock");
    for (i, id) in own.iter().enumerate() {
        assert_eq!(log.tree().index(*id), Some(i as u64));
    }
    let signed = log.signed().expect("one root over the wrapped log").clone();
    let n = own.len() as u64;
    assert_eq!((signed.root.length, signed.root.hash), (n, log.tree().root_at(n).unwrap()));
    assert!(signed.verify() && signed.root.log == phone);
    // then what it signs since goes after
    let note = document("A note", "After the unlock.", phone);
    w.lab.create(phone, h.coop, h.coop, "note", &[], note).expect("a note");
    let log = w.lab.signer_log(phone).unwrap();
    assert!(log.tree().len() > own.len() as u64);
    // another device takes the root of the unlock as the newest of the phone's log
    let mut roots = Roots::new();
    assert!(matches!(roots.take(&signed, None), Taken::Newer));
    if !cfg!(debug_assertions) {
        return;
    }
    // a debug build signs each batch at once: its newest root is shown to begin with the one of the unlock
    let newer = log.signed().unwrap().clone();
    assert!(newer.root.length > signed.root.length);
    let prefix = log.prefix(signed.root.length).unwrap();
    assert!(matches!(roots.take(&newer, Some(&prefix)), Taken::Newer));
    // and each edit's path checks as its signature does
    for i in 0..log.tree().len() {
        let id = log.tree().edit(i).unwrap();
        let Some(signed) = w.lab.signed_edit(phone, id) else { continue };
        let at = signed.edit.sigs().position(|s| s == phone).unwrap();
        let by_sig = avendb::sign::signs(&signed.edit, id, phone, &signed.sigs[at]);
        assert!(by_sig, "edit {i}");
        assert_eq!(roots.check(phone, id, &log.proof(id).unwrap()), by_sig, "edit {i}");
    }
}
