//! A Mac's Touch ID key (2026-10-19): a second owner of its person's human vault beside her passkey, the vault's root,
//! as avendb/spec's `touch` example has it. Its Secure Enclave signs a ceremony's challenge with ML-DSA-65 and opens the
//! secret sealed to it with the same touch; the Mac's Lab holds its keys alone, as it holds a passkey's in the
//! platform's authenticator, and signs as it in a ceremony. Once the passkey adds it, with its consent, a touch
//! approves what the vault's owners approve, without the passkey, and every device checks its signatures; only the root
//! hands the root on. A software Touch ID key stands in for the Enclave here, and the Lab sees nothing else of it.

mod common;

use avendb::engine::passkey_of;
use avendb::id::{EditId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::policy::{Action, Kind, Principal, Refusal, Revoking, Setting, Sharing};
use avendb::sign::{EnclaveKey, Passkey, Signed, device_salt};
use avendb::wire::Wire;

/// Alice's Mac in a Lab of its own: its keys from her passkey's PRF output on its salt, her passkey's and its Touch ID
/// key's brought in by a ceremony of each, and her vault founded by her passkey, the Mac in it. The Lab, the Mac, the
/// passkey, the Touch ID key and the vault.
fn mac(authenticator: &mut Passkey, enclave: &EnclaveKey) -> (Lab, SignerId, SignerId, SignerId, VaultId) {
    let mut lab = Lab::with_entropy([7; 32]);
    let passkey = lab.web_passkey("Alice", authenticator.public(), &authenticator.ceremony([1; 32]));
    let [passkey, _] = passkey.expect("the passkey's own ceremony");
    let mac = lab.device_with("Alice's Mac", *authenticator.prf(&device_salt(&[5; 32])));
    let touch = lab.web_enclave("Alice's Mac", &enclave.ceremony([1; 32])).expect("the Enclave's own ceremony");
    assert_eq!((passkey, touch), (authenticator.id(), enclave.id()), "the ceremonies show their keys");
    let owners = vec![Principal::Signer(passkey)];
    let genesis =
        Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let vault = by_passkey(&mut lab, mac, &[passkey], genesis, authenticator).into();
    let add = Action::Share(Sharing::Device { vault, device: mac, seal_to: None });
    by_passkey(&mut lab, mac, &[passkey, mac], add, authenticator);
    (lab, mac, passkey, touch, vault)
}

/// `action` signed by `signers` on device `on`, the passkey among them in a ceremony of `authenticator`.
fn by_passkey(lab: &mut Lab, on: SignerId, signers: &[SignerId], action: Action, authenticator: &mut Passkey) -> EditId {
    let draft = lab.draft(on, signers, action).expect("the device's view takes it");
    let ceremony = authenticator.ceremony(draft.challenge());
    lab.complete(on, draft, &[(authenticator.id(), &ceremony)]).expect("the passkey signed it")
}

/// `action` signed by `signers` on device `on`, the Touch ID key among them in a ceremony of `enclave`: one touch.
fn by_touch(lab: &mut Lab, on: SignerId, signers: &[SignerId], action: Action, enclave: &EnclaveKey) -> EditId {
    let draft = lab.draft(on, signers, action).expect("the device's view takes it");
    let ceremony = enclave.ceremony(draft.challenge());
    lab.complete(on, draft, &[(enclave.id(), &ceremony)]).expect("the Touch ID key signed it")
}

/// The passkey adds the Touch ID key as an owner, and the key consents with a touch over the same edit.
fn add_touch(lab: &mut Lab, mac: SignerId, vault: VaultId, authenticator: &mut Passkey, enclave: &EnclaveKey) {
    let (passkey, touch) = (authenticator.id(), enclave.id());
    let add = Action::Share(Sharing::Owner { vault, owner: Principal::Signer(touch), seal_to: None });
    let draft = lab.draft(mac, &[passkey, touch], add).expect("a draft");
    let (key, finger) = (authenticator.ceremony(draft.challenge()), enclave.ceremony(draft.challenge()));
    lab.complete(mac, draft, &[(passkey, &key), (touch, &finger)]).expect("both signed it");
}

/// Its signatures read back from their bytes and check out, as any device that receives the edit checks them.
fn checks_out(lab: &Lab, on: SignerId, id: EditId) -> bool {
    let signed = lab.signed_edit(on, id).expect("kept");
    Signed::from_wire(&signed.to_wire()).is_ok_and(|s| s.verify().is_ok())
}

#[test]
fn a_touch_id_key_owns_alices_vault_beside_her_passkey() {
    let (mut authenticator, enclave) = (Passkey::from_seed([1; 32]), EnclaveKey::from_seed([2; 32]));
    let (mut lab, mac, passkey, touch, vault) = mac(&mut authenticator, &enclave);
    // the key joins as an owner only with its consent and the passkey's approval: not by the passkey alone, nor by
    // itself or the Mac
    let add = Action::Share(Sharing::Owner { vault, owner: Principal::Signer(touch), seal_to: None });
    assert_eq!(lab.draft(mac, &[passkey], add.clone()).err(), Some(Refusal::NoConsent));
    assert!(lab.draft(mac, &[touch], add.clone()).is_err(), "the key alone");
    assert!(lab.draft(mac, &[mac, touch], add).is_err(), "the Mac and the key");
    assert_eq!(passkey_of(&lab, mac), Some(passkey), "the passkey approves until then");
    add_touch(&mut lab, mac, vault, &mut authenticator, &enclave);
    let owners = lab.state(mac).vault(vault).map(|v| (v.owners.clone(), v.root));
    assert_eq!(owners, Some((vec![Principal::Signer(passkey), Principal::Signer(touch)], Some(passkey))));
    // from now on a touch approves: the Mac picks the key, and a phone joins with its ceremony alone
    assert_eq!(passkey_of(&lab, mac), Some(touch));
    let phone = lab.device("Alice's phone");
    let join = Action::Share(Sharing::Device { vault, device: phone, seal_to: None });
    assert_eq!(lab.submit(mac, &[touch, phone], join.clone()), Err(Refusal::Locked), "no touch, no signature");
    let joined = by_touch(&mut lab, mac, &[touch, phone], join, &enclave);
    assert!(lab.state(mac).acts_for(phone, vault));
    assert!(checks_out(&lab, mac, joined));
    // and takes it off again; the Mac alone may not
    let leave = Action::Revoke(Revoking::Device { vault, device: phone, keep: vec![] });
    assert!(lab.draft(mac, &[mac], leave.clone()).is_err(), "a device doesn't govern");
    let left = by_touch(&mut lab, mac, &[touch], leave, &enclave);
    assert!(!lab.state(mac).acts_for(phone, vault) && checks_out(&lab, mac, left));
    // every owner equal (Samuel, 2026-10-19): the key, an owner, takes the root too, the new root signing
    let hand_on = Action::Settings { vault, set: Setting::Root { root: Some(touch), keep: vec![] } };
    assert!(lab.draft(mac, &[touch], hand_on).is_ok());
}

#[test]
fn a_touch_id_ceremony_signs_only_its_own_keys_challenge() {
    let (mut authenticator, enclave) = (Passkey::from_seed([1; 32]), EnclaveKey::from_seed([2; 32]));
    let (mut lab, mac, _, touch, vault) = mac(&mut authenticator, &enclave);
    add_touch(&mut lab, mac, vault, &mut authenticator, &enclave);
    let phone = lab.device("Alice's phone");
    let join = Action::Share(Sharing::Device { vault, device: phone, seal_to: None });
    // a ceremony over another challenge, of another Touch ID key, or of her passkey for the key: no signature
    let draft = lab.draft(mac, &[touch, phone], join.clone()).expect("a draft");
    let elsewhere = enclave.ceremony([2; 32]);
    assert_eq!(lab.complete(mac, draft, &[(touch, &elsewhere)]), Err(Refusal::BadSignature));
    let draft = lab.draft(mac, &[touch, phone], join.clone()).expect("a draft");
    let theirs = EnclaveKey::from_seed([3; 32]).ceremony(draft.challenge());
    assert_eq!(lab.complete(mac, draft, &[(touch, &theirs)]), Err(Refusal::BadSignature));
    let draft = lab.draft(mac, &[touch, phone], join.clone()).expect("a draft");
    let passkeys = authenticator.ceremony(draft.challenge());
    assert_eq!(lab.complete(mac, draft, &[(touch, &passkeys)]), Err(Refusal::BadSignature));
    assert!(!lab.state(mac).acts_for(phone, vault), "the Mac kept none of them");
    // a passkey's ceremony shows no Touch ID key, nor a Touch ID key's a passkey
    assert!(lab.web_enclave("Eve", &passkeys).is_none());
    assert!(lab.web_passkey("Eve", authenticator.public(), &enclave.ceremony([4; 32])).is_none());
    // one touch signs a batch: each edit its own signature beside the Enclave's over the batch
    let other = lab.device("Alice's tablet");
    let mut drafting = lab.drafting(mac);
    drafting.draft(&[touch, phone], join).expect("a draft");
    let join = Action::Share(Sharing::Device { vault, device: other, seal_to: None });
    drafting.draft(&[touch, other], join).expect("a draft");
    let drafts = drafting.done();
    let ceremony = enclave.ceremony(drafts[0].challenge());
    for draft in drafts {
        let id = lab.complete(mac, draft, &[(touch, &ceremony)]).expect("the touch signed it");
        assert!(checks_out(&lab, mac, id));
    }
    assert!(lab.state(mac).acts_for(phone, vault) && lab.state(mac).acts_for(other, vault));
}

#[test]
fn the_root_takes_a_lost_macs_touch_id_key_off() {
    let (mut authenticator, enclave) = (Passkey::from_seed([1; 32]), EnclaveKey::from_seed([2; 32]));
    let (mut lab, mac, passkey, touch, vault) = mac(&mut authenticator, &enclave);
    add_touch(&mut lab, mac, vault, &mut authenticator, &enclave);
    // the passkey revokes the key, and the vault is the passkey's alone again
    let off = Action::Revoke(Revoking::Owner { vault, owner: Principal::Signer(touch), keep: vec![] });
    let id = by_passkey(&mut lab, mac, &[passkey], off, &mut authenticator);
    assert!(checks_out(&lab, mac, id));
    let owners = lab.state(mac).vault(vault).map(|v| v.owners.clone());
    assert_eq!(owners, Some(vec![Principal::Signer(passkey)]));
    assert_eq!(passkey_of(&lab, mac), Some(passkey), "the passkey approves again");
    // a touch approves nothing more
    let phone = lab.device("Alice's phone");
    let join = Action::Share(Sharing::Device { vault, device: phone, seal_to: None });
    assert!(lab.draft(mac, &[touch, phone], join).is_err());
}

#[test]
fn the_owners_list_names_a_touch_id_key_by_its_kind() {
    let (mut authenticator, enclave) = (Passkey::from_seed([1; 32]), EnclaveKey::from_seed([2; 32]));
    let (mut lab, mac, passkey, touch, vault) = mac(&mut authenticator, &enclave);
    add_touch(&mut lab, mac, vault, &mut authenticator, &enclave);
    // each owner as the page reads it, `by` its kind: from the keys at hand, then, with neither key at hand, as their
    // signatures on the Mac show them
    let owners = |lab: &Lab| {
        let seen = avendb::world::world(lab, mac).expect("her world").to_json(mac);
        let mine = seen["vaults"].as_array().unwrap().iter().find(|v| v["id"] == vault.to_hex()).cloned();
        mine.expect("her vault")["owners"].as_array().unwrap().iter().map(|o| o["by"].clone()).collect::<Vec<_>>()
    };
    assert_eq!(owners(&lab), [serde_json::json!("passkey"), serde_json::json!("touch")]);
    lab.lose(passkey);
    lab.lose(touch);
    assert!(lab.keys_of(touch).is_none());
    assert_eq!(owners(&lab), [serde_json::json!("passkey"), serde_json::json!("touch")]);
}
