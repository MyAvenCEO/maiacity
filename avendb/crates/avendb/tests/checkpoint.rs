//! A vault's signed checkpoint (`Checkpoint.lean`): a device holds the edits it covers without their signatures
//! ("bare") while one that stands vouches for them, lets go of their signatures once it does, and lets go of a bare
//! edit no checkpoint that stands vouches for.

mod common;

use avendb::id::{SignerId, VaultId};
use avendb::lab::{Backup, Lab};
use avendb::policy::Action;
use avendb::sign::Signed;
use common::*;

/// Alice with a passkey and a Mac, her vault founded.
fn alice() -> (Lab, SignerId, SignerId, VaultId) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let alice = human_on(&mut lab, passkey, &[mac]);
    (lab, passkey, mac, alice)
}

/// `signed` with no signature left, its signers' keys kept: what a device holds on a checkpoint's word.
fn bare(mut signed: Signed) -> Signed {
    for sig in &mut signed.sigs {
        sig.pq = vec![];
        sig.webauthn = None;
        sig.enclave = None;
    }
    signed
}

fn stripped(backup: &Backup, ids: &[avendb::id::EditId]) -> Backup {
    let signed = backup.signed().iter().map(|s| if ids.contains(&s.edit.id()) { bare(s.clone()) } else { s.clone() });
    Backup::new(signed.collect(), [])
}

#[test]
fn a_device_holds_bare_what_its_vaults_checkpoint_vouches_for() {
    let (mut lab, passkey, mac, alice) = alice();
    let before = lab.backup(mac);
    let ids: Vec<_> = before.signed().iter().map(|s| s.edit.id()).collect();
    assert!(!ids.is_empty());
    lab.submit(mac, &[passkey], Action::Checkpoint { vault: alice, covers: ids.clone() }).expect("her passkey's");
    let checked = lab.backup(mac);
    // every edit it covers held without a signature: the device takes them all on the checkpoint's word
    lab.restore_from(mac, stripped(&checked, &ids));
    assert_eq!(lab.backup(mac).signed().len(), checked.signed().len(), "every edit held");
    assert!(lab.state(mac).acts_for(mac, alice), "the Mac a device of Alice's");
    // and a device holding them signed lets go of their signatures once the checkpoint vouches for them
    lab.restore_from(mac, Backup::new(checked.signed().to_vec(), []));
    let held = lab.backup(mac);
    for s in held.signed().iter().filter(|s| ids.contains(&s.edit.id())) {
        assert!(s.sigs.iter().all(|x| x.pq.is_empty() && x.webauthn.is_none()), "no signature kept");
        assert_eq!(s.sigs.len(), s.edit.sigs().count(), "each signer's keys kept");
    }
}

#[test]
fn a_bare_edit_no_checkpoint_vouches_for_is_let_go_of() {
    let (mut lab, _passkey, mac, alice) = alice();
    let before = lab.backup(mac);
    let ids: Vec<_> = before.signed().iter().map(|s| s.edit.id()).collect();
    // with no checkpoint, an edit without its signatures is refused
    lab.restore_from(mac, stripped(&before, &ids));
    assert_eq!(lab.backup(mac).signed().len(), 0, "nothing taken");
    // the Mac's own checkpoint over them: a device is no owner, so it stands nowhere and vouches for nothing
    lab.restore_from(mac, Backup::new(before.signed().to_vec(), []));
    let forged = lab.sign_unchecked(mac, &[mac], Action::Checkpoint { vault: alice, covers: ids.clone() }).expect("signed");
    let mut signed: Vec<Signed> = stripped(&before, &ids).signed().to_vec();
    signed.push(forged);
    lab.restore_from(mac, Backup::new(signed, []));
    assert!(lab.backup(mac).signed().iter().all(|s| !ids.contains(&s.edit.id())), "every bare edit let go of");
    assert!(!lab.state(mac).acts_for(mac, alice));
}

#[test]
fn a_covered_edit_with_its_signatures_stays_where_no_checkpoint_stands() {
    let (mut lab, _passkey, mac, alice) = alice();
    let before = lab.backup(mac);
    let ids: Vec<_> = before.signed().iter().map(|s| s.edit.id()).collect();
    lab.restore_from(mac, Backup::new(before.signed().to_vec(), []));
    let forged = lab.sign_unchecked(mac, &[mac], Action::Checkpoint { vault: alice, covers: ids.clone() }).expect("signed");
    let mut signed = before.signed().to_vec();
    signed.push(forged);
    lab.restore_from(mac, Backup::new(signed, []));
    // covered by a checkpoint that doesn't stand, each edit is held by its own signatures, which check out
    let held: Vec<_> = lab.backup(mac).signed().iter().map(|s| s.edit.id()).collect();
    assert!(ids.iter().all(|id| held.contains(id)), "every signed edit kept");
    assert!(lab.state(mac).acts_for(mac, alice));
}
