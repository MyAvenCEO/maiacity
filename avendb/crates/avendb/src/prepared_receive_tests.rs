//! Immutable signature preparation must preserve ordinary current-state reception.
use super::*;
use crate::{cast, sign::Suite};
use std::time::Instant;

fn receiver() -> (Lab, SignerId) {
    let mut lab = Lab::with_entropy([211; 32]);
    let me = lab.device_with_in("receiver", [212; 32], Suite::MlDsa);
    (lab, me)
}

#[test]
fn prepared_receive_matches_current_admission_and_releases_signature_work() {
    let mut source = Lab::with_entropy([210; 32]);
    let owner = source.passkey_from_in("owner", [213; 32], Suite::MlDsa);
    let sender = source.device_with_in("sender", [214; 32], Suite::MlDsa);
    let (_, me) = receiver();
    source.device_with_in("receiver", [212; 32], Suite::MlDsa);
    let vault = cast::human_on(&mut source, owner, &[sender, me]);
    for n in 0..48 {
        source
            .create(
                sender,
                vault,
                vault,
                world::NOTE,
                &[],
                cast::document(&format!("Entry {n}"), "body", sender),
            )
            .unwrap();
    }
    let edits = source.backup(sender).signed;
    let (mut ordinary, _) = receiver();
    let (mut prepared, _) = receiver();
    // Exercise the same bounded checker used by the browser. A pending task boundary is
    // mandatory between unfinished groups, and no partial prepared result is observable.
    let turns = std::cell::Cell::new(0usize);
    let mut checker = std::pin::pin!(prepared.prepare_receive(me, edits.clone()).check_cooperatively(|| {
        let mut pending = true;
        std::future::poll_fn(move |cx| {
            if pending {
                pending = false;
                cx.waker().wake_by_ref();
                std::task::Poll::Pending
            } else { std::task::Poll::Ready(()) }
        })
    }));
    let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
    let cooperative = loop {
        match std::future::Future::poll(checker.as_mut(), &mut cx) {
            std::task::Poll::Pending => turns.set(turns.get() + 1),
            std::task::Poll::Ready(result) => break result,
        }
    };
    let parallel = prepared.prepare_receive(me, edits.clone()).check();
    assert_eq!(cooperative.signatures, parallel.signatures);
    assert_eq!(turns.get(), cooperative.signatures.len().saturating_sub(1) / 8);
    assert!(turns.get() > 0);
    let at = Instant::now();
    let expected = ordinary.receive_whose_now(me, edits.clone(), vec![], false);
    let baseline = at.elapsed();
    let at = Instant::now();
    let plan = prepared.prepare_receive(me, edits.clone());
    let capture = at.elapsed();
    let at = Instant::now();
    // This call has no Lab reference: unrelated reads/mutations can take its mutex throughout verification.
    let checked = plan.check();
    let crypto = at.elapsed();
    let at = Instant::now();
    assert_eq!(prepared.receive_prepared(me, checked, false), expected);
    let commit = at.elapsed();
    assert_eq!(prepared.backup(me).signed, ordinary.backup(me).signed);
    eprintln!(
        "prepared receive: {} edits; baseline lock {:?}; capture {:?}; crypto outside lock {:?}; commit lock {:?}; protected total {:?}",
        edits.len(),
        baseline,
        capture,
        crypto,
        commit,
        capture + commit
    );

    // Capture sees duplicates, but a restore removes them before commitment. Missing prepared checks must
    // fall back to actual verification rather than treating capture-time possession as authority.
    let mut invalid = edits.last().unwrap().clone();
    invalid.sigs[0].pq[0] ^= 1;
    let incoming = vec![invalid.clone(), edits.last().unwrap().clone()];
    let checked = prepared.prepare_receive(me, incoming.clone()).check();
    let (empty, _) = receiver();
    prepared.restore_backup(me, &empty.backup(me));
    ordinary.restore_backup(me, &empty.backup(me));
    assert_eq!(
        prepared.receive_prepared(me, checked, false),
        ordinary.receive_whose_now(me, incoming, vec![], false)
    );
    assert!(
        prepared.log(me).ids().is_empty(),
        "an invalid first duplicate is still refused"
    );

    // First-occurrence semantics also survive preparation when the receiver holds no copy.
    let incoming = vec![invalid, edits.last().unwrap().clone()];
    let checked = prepared.prepare_receive(me, incoming.clone()).check();
    assert_eq!(
        prepared.receive_prepared(me, checked, false),
        ordinary.receive_whose_now(me, incoming, vec![], false)
    );
    assert_eq!(prepared.backup(me).signed, ordinary.backup(me).signed);
}

#[test]
fn prepared_signature_never_caches_gate_admission() {
    let mut w = cast::world();
    let me = w.server;
    let mut lab = w.lab.split(me, &[], [215; 32]);
    let person = w.lab.passkey_from_in("newcomer", [217; 32], Suite::MlDsa);
    let device = w
        .lab
        .device_with_in("newcomer device", [218; 32], Suite::MlDsa);
    let vault = cast::human_on(&mut w.lab, person, &[device]);
    let incoming = w.lab.backup(device).signed;
    let checked = lab.prepare_receive(me, incoming.clone()).check();
    // Gate changes after cryptographic preparation. The current gate, not the captured one, decides.
    lab.gate(me, true);
    assert!(
        lab.home(me).is_some(),
        "the fixture has an effective admission gate"
    );
    let before = lab.backup(me);
    let expected = lab.receive_whose_now(me, incoming.clone(), vec![], true);
    let after = lab.backup(me);
    assert!(lab.state(me).vault(vault).is_none());
    lab.restore_backup(me, &before);
    assert_eq!(lab.receive_prepared(me, checked, true), expected);
    assert_eq!(lab.backup(me).signed, after.signed);
    lab.gate(me, false);
    let before = lab.backup(me);
    let checked = lab.prepare_receive(me, incoming.clone()).check();
    let expected = lab.receive_whose_now(me, incoming, vec![], true);
    let after = lab.backup(me);
    lab.restore_backup(me, &before);
    assert_eq!(lab.receive_prepared(me, checked, true), expected);
    assert!(lab.state(me).vault(vault).is_some());
    assert_eq!(lab.backup(me).signed, after.signed);
}

#[test]
fn prepared_receive_preserves_whole_page_checkpoint_coverage() {
    let mut source = Lab::with_entropy([219; 32]);
    let owner = source.passkey_from_in("checkpoint owner", [220; 32], Suite::MlDsa);
    let sender = source.device_with_in("checkpoint sender", [221; 32], Suite::MlDsa);
    let vault = cast::human_on(&mut source, owner, &[sender]);
    let ids = source.log(sender).ids().to_vec();
    source
        .submit(
            sender,
            &[owner],
            Action::Checkpoint {
                vault,
                covers: ids.clone(),
            },
        )
        .unwrap();
    let mut incoming = source.backup(sender).signed;
    for signed in &mut incoming {
        if ids.contains(&signed.edit.id()) {
            for signature in &mut signed.sigs {
                signature.pq.clear();
                signature.webauthn = None;
                signature.enclave = None;
            }
        }
    }
    let checkpoint = incoming
        .iter()
        .find(|s| matches!(s.edit.action, Action::Checkpoint { .. }))
        .unwrap()
        .clone();
    let bare = incoming
        .iter()
        .find(|s| ids.contains(&s.edit.id()))
        .unwrap()
        .clone();
    let (mut prepared, me) = receiver();
    let (mut ordinary, _) = receiver();
    let checked = prepared.prepare_receive(me, incoming.clone()).check();
    let mut batches=checked.into_batches();
    let checked=batches.next().unwrap();
    assert!(batches.next().is_none(),"checkpoint coverage preserves whole-page admission");
    assert_eq!(
        prepared.receive_prepared(me, checked, true),
        ordinary.receive_whose_now(me, incoming, vec![], true)
    );
    assert!(prepared.state(me).vault(vault).is_some());
    let perf=prepared.held(me).perf.to_json();
    assert_eq!(perf["counts"]["receive: atomic checkpoint pages"],1);
    assert_eq!(perf["timers"]["receive: atomic checkpoint admission"]["count"],1);
    assert_eq!(prepared.backup(me).signed, ordinary.backup(me).signed);
    assert!(prepared.state(me) == ordinary.state(me));

    // Capture may skip a signature covered by an earlier page. Withdrawal before commitment
    // removes that coverage; the bare edit must fall back to verification and be refused.
    let (mut withdrawn, me) = receiver();
    let empty = withdrawn.backup(me);
    withdrawn.receive_whose_now(me, vec![checkpoint], vec![], false);
    assert!(withdrawn.held(me).covers.contains(&bare.edit.id()));
    let checked = withdrawn.prepare_receive(me, vec![bare]).check();
    withdrawn.restore_backup(me, &empty);
    assert_eq!(withdrawn.receive_prepared(me, checked, false).0, 0);
    assert!(withdrawn.log(me).ids().is_empty());
}

#[test]
fn prepared_chunks_preserve_order_dedup_and_signature_ownership() {
    let mut source=Lab::with_entropy([231;32]);
    let owner=source.passkey_from_in("owner",[232;32],Suite::MlDsa);
    let sender=source.device_with_in("sender",[233;32],Suite::MlDsa);
    let vault=cast::human_on(&mut source,owner,&[sender]);
    let originals=source.backup(sender).signed;
    let entry=source.create(sender,vault,vault,world::NOTE,&[],cast::document("Invalid duplicate","body",sender)).unwrap();
    let id=source.state(sender).entry(entry).unwrap().creation;
    let valid=source.signed_edit(sender,id).unwrap().clone();
    let mut invalid=valid.clone();invalid.sigs[0].pq[0]^=1;
    let mut incoming:Vec<_>=originals.iter().cycle().take(300).cloned().collect();
    incoming[127]=invalid.clone();incoming[128]=valid;incoming[299]=invalid;
    let (mut chunked,me)=receiver();let (mut whole,_)=receiver();
    let prepared=chunked.prepare_receive(me,incoming.clone()).check();
    let mut seen=Vec::new();let mut new=0;
    for batch in prepared.into_batches() {
        assert!(batch.edits.len()<=128);
        seen.extend(batch.edits.iter().cloned());
        new+=chunked.receive_prepared(me,batch,false).0;
    }
    assert_eq!(seen,incoming);
    assert_eq!(new,whole.receive_whose_now(me,incoming,vec![],false).0);
    assert_eq!(chunked.backup(me).signed,whole.backup(me).signed);
    assert!(chunked.signed_edit(me,id).is_none(),"negative first-duplicate result survives chunk boundary");
}

#[test]
fn independently_verified_checkpoint_page_can_stage_without_coverage_shortcut() {
    let mut source=Lab::with_entropy([234;32]);
    let owner=source.passkey_from_in("owner",[235;32],Suite::MlDsa);
    let sender=source.device_with_in("sender",[236;32],Suite::MlDsa);
    let vault=cast::human_on(&mut source,owner,&[sender]);
    let covers=source.log(sender).ids().to_vec();
    source.submit(sender,&[owner],Action::Checkpoint {vault,covers}).unwrap();
    let originals=source.backup(sender).signed;
    let incoming:Vec<_>=originals.iter().cycle().take(300).cloned().collect();
    let (mut chunked,me)=receiver();let (mut whole,_)=receiver();
    let mut prepared=chunked.prepare_receive(me,incoming.clone()).check();
    // Model already-completed independent verification, not checkpoint trust.
    prepared.signatures=prepared.edits.iter().map(|s|(s.edit.id(),s.verify().is_ok())).collect();
    assert!(prepared.signatures.values().all(|valid|*valid));
    assert!(!prepared.requires_atomic_checkpoint());
    let mut chunks=0;
    for batch in prepared.into_batches() {
        chunks+=1;assert!(batch.edits.len()<=128);
        chunked.receive_prepared(me,batch,false);
    }
    assert_eq!(chunks,3);
    whole.receive_whose_now(me,incoming,vec![],false);
    assert_eq!(chunked.backup(me).signed,whole.backup(me).signed);
    chunked.catch_up(me);whole.catch_up(me);
    assert!(chunked.state(me)==whole.state(me));
}
