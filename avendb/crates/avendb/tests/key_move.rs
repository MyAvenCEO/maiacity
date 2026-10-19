//! The key move (2026-10-19, avendb/spec's `keyMove` example): every signer moves from SLH-DSA to ML-DSA-65 by the
//! edits avenDB already has. One ceremony of Alice's passkey derives both its keys from one PRF output, so the old
//! signer signs the new one in as an owner, hands it the root, and the new one removes the old; her Mac's new key,
//! from the same secret, joins as a device and removes the old one. No vault is founded again and no edit is signed
//! again: the old edits keep their SLH-DSA signatures and check out as before, the new ones carry ML-DSA-65's.

mod common;

use avendb::id::{EditId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Principal, Refusal, Revoking, Setting, Sharing};
use avendb::sign::{
    EnclaveKey, ML_DSA_PUBLIC_BYTES, ML_DSA_SIGNATURE_BYTES, PQ_SIGNATURE_BYTES, Passkey, Signed, Suite, device_salt,
};
use avendb::wire::Wire;

/// `action` signed by `signers` on device `on`, the passkey's signers among them, old and new, in one ceremony of
/// `authenticator`.
fn by_passkey(lab: &mut Lab, on: SignerId, signers: &[SignerId], action: Action, authenticator: &mut Passkey) -> EditId {
    let draft = lab.draft(on, signers, action).expect("the device's view takes it");
    let ceremony = authenticator.ceremony(draft.challenge());
    let mut theirs: Vec<(SignerId, _)> = vec![];
    for &s in signers {
        if lab.take_in(s, &ceremony).is_some() && !lab.devices().contains(&s) {
            theirs.push((s, &ceremony));
        }
    }
    lab.complete(on, draft, &theirs).expect("the passkey signed it")
}

/// Its signatures read back from their bytes and check out, as any device that receives the edit checks them; and
/// the size of each of its post-quantum signatures.
fn checks_out(lab: &Lab, on: SignerId, id: EditId) -> Option<Vec<usize>> {
    let signed = lab.signed_edit(on, id).expect("kept");
    let read = Signed::from_wire(&signed.to_wire()).ok()?;
    read.verify().ok()?;
    Some(read.sigs.iter().map(|s| s.pq.len()).collect())
}

#[test]
fn alices_passkey_and_mac_move_to_ml_dsa_65_and_keep_her_vault() {
    let mut authenticator = Passkey::from_seed_in([1; 32], Suite::SlhDsa);
    let mut lab = Lab::with_entropy([7; 32]);
    let ceremony = authenticator.ceremony([1; 32]);
    let p256 = authenticator.public();
    let passkey = lab.web_passkey("Alice", p256, &ceremony).expect("the passkey's own ceremony");
    let mac_secret = *authenticator.prf(&device_salt(&[5; 32]));
    let mac = lab.device_with_in("Alice's Mac", mac_secret, Suite::SlhDsa);
    // her vault, as made before the key move: SLH-DSA signers
    let owners = vec![Principal::Signer(passkey)];
    let genesis =
        Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let founded = by_passkey(&mut lab, mac, &[passkey], genesis, &mut authenticator);
    let vault = VaultId::from(founded);
    let add = Action::Share(Sharing::Device { vault, device: mac, seal_to: None });
    let joined = by_passkey(&mut lab, mac, &[passkey, mac], add, &mut authenticator);
    let before = [founded, joined];
    assert_eq!(checks_out(&lab, mac, joined), Some(vec![PQ_SIGNATURE_BYTES, PQ_SIGNATURE_BYTES]));

    // the passkey's next key: the same authenticator, its ML-DSA-65 key from the same PRF output, another signer
    let next = ceremony.keys_in(p256, Suite::MlDsa).id();
    assert_ne!(next, passkey);
    assert_eq!(next, Passkey::from_seed_in([1; 32], Suite::MlDsa).id());
    let ml = ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES;
    // 1. the old key adds the new one as an owner, which signs too, in the same ceremony
    let add = Action::Share(Sharing::Owner { vault, owner: Principal::Signer(next), seal_to: None });
    assert_eq!(lab.draft(mac, &[passkey], add.clone()).err(), Some(Refusal::NoConsent), "not without the new key");
    let added = by_passkey(&mut lab, mac, &[passkey, next], add, &mut authenticator);
    assert_eq!(checks_out(&lab, mac, added), Some(vec![PQ_SIGNATURE_BYTES, ml]));
    // 2. it hands the root on, the new key signing too; the new key may not take it itself, nor the old one hand it to
    // a key that doesn't sign
    let hand_on = Action::Settings { vault, set: Setting::Root { root: Some(next), keep: vec![] } };
    assert_eq!(lab.draft(mac, &[next], hand_on.clone()).err(), Some(Refusal::NotRoot));
    assert_eq!(lab.draft(mac, &[passkey], hand_on.clone()).err(), Some(Refusal::NoConsent));
    let handed = by_passkey(&mut lab, mac, &[passkey, next], hand_on, &mut authenticator);
    assert_eq!(checks_out(&lab, mac, handed), Some(vec![PQ_SIGNATURE_BYTES, ml]));
    // 3. the new key removes the old one
    let off = Action::Revoke(Revoking::Owner { vault, owner: Principal::Signer(passkey), keep: vec![] });
    let removed = by_passkey(&mut lab, mac, &[next], off, &mut authenticator);
    assert_eq!(checks_out(&lab, mac, removed), Some(vec![ml]));
    let owners = lab.state(mac).vault(vault).map(|v| (v.owners.clone(), v.root));
    assert_eq!(owners, Some((vec![Principal::Signer(next)], Some(next))));

    // 4. the Mac's next key, from its same secret, joins as a device by the new passkey; 5. which removes the old one
    let new_mac = lab.device_with_in("Alice's Mac", mac_secret, Suite::MlDsa);
    assert_ne!(new_mac, mac);
    lab.share_contact(mac, new_mac, vault);
    let join = Action::Share(Sharing::Device { vault, device: new_mac, seal_to: None });
    let joined_new = by_passkey(&mut lab, mac, &[next, new_mac], join, &mut authenticator);
    assert_eq!(checks_out(&lab, mac, joined_new), Some(vec![ml, ml]));
    lab.sync_all(2);
    let leave = Action::Revoke(Revoking::Device { vault, device: mac, keep: vec![] });
    let left = by_passkey(&mut lab, new_mac, &[next], leave, &mut authenticator);
    lab.sync_all(2);

    // every edit, the old ones with their SLH-DSA signatures, still checks out on the new Mac
    for id in before.into_iter().chain([added, handed, removed, joined_new, left]) {
        assert!(checks_out(&lab, new_mac, id).is_some(), "{id:?}");
    }
    let st = lab.state(new_mac);
    assert!(st.acts_for(new_mac, vault) && !st.acts_for(mac, vault));
    assert!(lab.holds_key(new_mac, st.current(KeyFam::Seed(vault))), "the new Mac opens the vault");
    // the old keys sign nothing for it any more
    let threshold = Action::Settings { vault, set: Setting::Threshold(1) };
    assert!(lab.draft(new_mac, &[passkey], threshold.clone()).is_err(), "the old passkey");
    assert!(lab.draft(new_mac, &[next], threshold).is_ok(), "the new one does");
}

#[test]
fn a_device_takes_in_a_passkey_another_device_moved() {
    // Alice's phone knows her passkey's old key; her passkey moved on her Mac. Its next ceremony brings in the new key,
    // in whichever suite its id names, and no other signer's
    let mut authenticator = Passkey::from_seed_in([1; 32], Suite::SlhDsa);
    let (old, next) = (authenticator.id(), Passkey::from_seed_in([1; 32], Suite::MlDsa).id());
    let mut lab = Lab::with_entropy([8; 32]);
    let ceremony = authenticator.ceremony([2; 32]);
    let keys = lab.take_in(next, &ceremony).expect("its ML-DSA-65 key, from the ceremony");
    assert_eq!((keys.id(), keys.suite()), (next, Suite::MlDsa));
    assert_eq!(lab.take_in(old, &ceremony).map(|k| k.suite()), Some(Suite::SlhDsa));
    let other = Passkey::from_seed_in([2; 32], Suite::MlDsa).id();
    assert!(lab.take_in(other, &ceremony).is_none(), "another passkey's key");
    // and a moved Touch ID key, by its touch alone
    let enclave = EnclaveKey::from_seed_in([3; 32], Suite::SlhDsa);
    let moved = EnclaveKey::from_seed_in([3; 32], Suite::MlDsa).id();
    assert!(lab.take_in(moved, &ceremony).is_none(), "a passkey's ceremony is no touch");
    assert!(lab.take_in(moved, &EnclaveKey::from_seed([4; 32]).ceremony([4; 32])).is_none(), "another Enclave's");
    let touch = enclave.ceremony([4; 32]);
    assert_eq!(lab.take_in(moved, &touch).map(|k| k.suite()), Some(Suite::MlDsa));
}
