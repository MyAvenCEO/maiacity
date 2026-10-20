//! The key move (2026-10-19, avendb/spec's `keyMove` example): every signer moves from SLH-DSA to ML-DSA-65 by the
//! edits avenDB already has. One ceremony of Alice's passkey derives both its keys from one PRF output, so the old
//! signer signs the new one in as an owner, hands it the root, and the new one removes the old; her Mac's new key,
//! from the same secret, joins as a device and removes the old one. No vault is founded again and no edit is signed
//! again: the old edits keep their SLH-DSA signatures and check out as before, the new ones carry ML-DSA-65's.
//!
//! K3b drafts it in one batch on the device a person unlocks (`Lab::moves`, `Lab::draft_move`), and only adds: each
//! next key joins beside its earlier one, which stays, the root where it was (Samuel 2026-10-20, "Add, never remove":
//! a removal cuts what its drafter didn't hold, so a move from a device that didn't hold her coop yet erased it). One
//! ceremony of the passkey and one touch of the Mac's Touch ID key sign it, and the device opens again as its next key
//! on the same store; each other device moves at its own next unlock.

mod common;

use avendb::cast;
use std::sync::Arc;

use avendb::id::{EditId, EntryId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::Lab;
use avendb::policy::{Action, KeepMode, Kind, Principal, Refusal, Revoking, Setting, Sharing};
use avendb::recovery::RecoveryKey;
use avendb::sign::{
    self, EnclaveKey, ML_DSA_PUBLIC_BYTES, ML_DSA_SIGNATURE_BYTES, PQ_SIGNATURE_BYTES, Passkey, Signed, SignerKeys,
    Suite, device_salt,
};
use avendb::slice::Selector;
use avendb::wire::Wire;
use avendb::world;

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
    // the Lab holds it in each suite, as a device does that doesn't know which its vault knows yet
    let [held, passkey] = lab.web_passkey("Alice", p256, &ceremony).expect("the passkey's own ceremony");
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
    assert_eq!(next, held, "the one the Lab holds beside it");
    let ml = ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES;
    // 1. the old key adds the new one as an owner, which signs too, in the same ceremony
    let add = Action::Share(Sharing::Owner { vault, owner: Principal::Signer(next), seal_to: None });
    assert_eq!(lab.draft(mac, &[passkey], add.clone()).err(), Some(Refusal::NoConsent), "not without the new key");
    let added = by_passkey(&mut lab, mac, &[passkey, next], add, &mut authenticator);
    assert_eq!(checks_out(&lab, mac, added), Some(vec![PQ_SIGNATURE_BYTES, ml]));
    // 2. it hands the root on, the new key signing too: not to a key that doesn't sign (every owner being equal, the
    // new key might as well take it itself)
    let hand_on = Action::Settings { vault, set: Setting::Root { root: Some(next), keep: vec![] } };
    assert_eq!(lab.draft(mac, &[passkey], hand_on.clone()).err(), Some(Refusal::NoConsent));
    assert!(lab.draft(mac, &[next], hand_on.clone()).is_ok());
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

/// Alice before K3b, in one Lab: her passkey, the vault's root, and her Mac's Touch ID key, its owners; her Mac and
/// her phone, its devices; all made before the key move, in SLH-DSA. The Mac keeps a full copy and none of her todos,
/// and wrote its card.
struct Before {
    lab: Lab,
    passkey: SignerId,
    /// The passkey's next key, which the Lab holds beside it from its first ceremony.
    next: SignerId,
    touch: SignerId,
    mac: SignerId,
    phone: SignerId,
    vault: VaultId,
    card: EntryId,
}

const MAC_SALT: [u8; 32] = [5; 32];
const PHONE_SALT: [u8; 32] = [6; 32];

fn before(authenticator: &mut Passkey, enclave: &EnclaveKey) -> Before {
    let mut lab = Lab::with_entropy([9; 32]);
    let ceremony = authenticator.ceremony([1; 32]);
    let [next, passkey] = lab.web_passkey("Alice", authenticator.public(), &ceremony).expect("its own ceremony");
    let mac = lab.device_with_in("Alice's Mac", *authenticator.prf(&device_salt(&MAC_SALT)), Suite::SlhDsa);
    let phone = lab.device_with_in("Alice's phone", *authenticator.prf(&device_salt(&PHONE_SALT)), Suite::SlhDsa);
    let owners = vec![Principal::Signer(passkey)];
    let genesis =
        Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let vault = VaultId::from(by_passkey(&mut lab, mac, &[passkey], genesis, authenticator));
    let add = Action::Share(Sharing::Device { vault, device: mac, seal_to: None });
    by_passkey(&mut lab, mac, &[passkey, mac], add, authenticator);
    lab.share_contact(mac, phone, vault);
    let add = Action::Share(Sharing::Device { vault, device: phone, seal_to: None });
    by_passkey(&mut lab, mac, &[passkey, phone], add, authenticator);
    let touch = enclave.id();
    let add = Action::Share(Sharing::Owner { vault, owner: Principal::Signer(touch), seal_to: None });
    let draft = lab.draft(mac, &[passkey, touch], add).expect("a draft");
    let (key, finger) = (authenticator.ceremony(draft.challenge()), enclave.ceremony(draft.challenge()));
    lab.complete(mac, draft, &[(passkey, &key), (touch, &finger)]).expect("both signed it");
    let copy = cast::keep(vault, mac, vault, KeepMode::Whole, Selector::All);
    lab.issue(mac, &[mac], copy).expect("its copy setting");
    let todos = cast::keep(vault, mac, vault, KeepMode::Never, cast::of_type(world::TODO));
    lab.issue(mac, &[mac], todos).expect("none of her todos");
    let card = lab.create(mac, vault, vault, world::CARD, &[], world::card("Alice's Mac", mac)).expect("its card");
    lab.sync_all(1);
    assert_eq!(lab.keys_of(touch).map(|k| k.suite()), Some(Suite::SlhDsa));
    Before { lab, passkey, next, touch, mac, phone, vault, card }
}

/// Device `old` of `lab`, whose keys come from `secret`, closed and opened again as `new`, on the store it kept, as a
/// node opens again on its shelf (`avendb_net::Node::spawn`), with its keys in each suite held as an app holds them
/// (`Lab::device_keys`).
fn reopen(lab: &mut Lab, old: SignerId, secret: [u8; 32], new: SignerId) {
    let backup = lab.backup(old);
    lab.lose(old);
    let name = lab.name(new).unwrap_or("a device").to_string();
    assert_eq!(lab.device_as(&name, secret, new), Some(new), "the same secret, its next key");
    lab.restore_backup(new, &backup);
    lab.device_keys(new, secret).expect("its keys");
}

/// What vault `vault` says on device `on`: its owners, its root and its devices.
fn members(lab: &Lab, on: SignerId, vault: VaultId) -> (Vec<Principal>, Option<SignerId>, Vec<SignerId>) {
    let v = lab.state(on).vault(vault).expect("the vault");
    (v.owners.clone(), v.root, v.devices.clone())
}

#[test]
fn one_ceremony_and_one_touch_move_alices_keys_and_her_mac() {
    let mut authenticator = Passkey::from_seed_in([1; 32], Suite::SlhDsa);
    let enclave = EnclaveKey::from_seed_in([3; 32], Suite::SlhDsa);
    let Before { mut lab, passkey, next, touch, mac, phone, vault, card } = before(&mut authenticator, &enclave);
    let made: Vec<EditId> = lab.log(mac).ids().to_vec();
    let mac_secret = *authenticator.prf(&device_salt(&MAC_SALT));

    // her Mac opens: its Lab holds its keys in each suite, from the same secret, and no other device's
    assert_eq!(lab.device_keys(mac, *authenticator.prf(&device_salt(&PHONE_SALT))), None, "the phone's secret");
    let [mac_next, same] = lab.device_keys(mac, mac_secret).expect("its keys");
    assert_eq!((same, lab.keys_of(mac_next).map(|k| k.suite())), (mac, Some(Suite::MlDsa)));
    // what moves: the passkey, whose ceremony brought both keys; the Touch ID key the Mac keeps, whose next key its
    // touch signs as; and the Mac
    let enclave_key = sign::enclave_key(&enclave.public());
    let new_touch = SignerKeys::Enclave { mldsa: enclave_key, slh: None }.id();
    assert_eq!(new_touch, EnclaveKey::from_seed_in([3; 32], Suite::MlDsa).id());
    let mut moves = lab.moves(mac, Some(enclave_key));
    moves.sort();
    let mut all = vec![(passkey, next), (touch, new_touch), (mac, mac_next)];
    all.sort();
    assert_eq!(moves, all);
    assert!(!lab.moves(mac, None).contains(&(touch, new_touch)), "with no touch, the Touch ID key stays");

    // one batch: each owner key adds its next key, and the passkey's next key adds the Mac's, signed by one ceremony
    // of the passkey and one touch, both over the batch; nothing is removed
    let drafts = lab.draft_move(mac, &moves, passkey).expect("the Mac's view takes it");
    assert_eq!(drafts.len(), 3);
    let challenge = drafts[0].challenge();
    assert!(drafts.iter().all(|d| d.challenge() == challenge), "one batch");
    let (key, finger) = (authenticator.ceremony(challenge), enclave.ceremony(challenge));
    let ceremonies = [(passkey, &key), (next, &key), (touch, &finger), (new_touch, &finger)];
    let moved = lab.complete_move(mac, drafts, &ceremonies).expect("one ceremony and one touch signed it");
    let ml = ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES;
    assert_eq!(checks_out(&lab, mac, moved[0]), Some(vec![PQ_SIGNATURE_BYTES, ml]), "the old key adds the new");
    assert_eq!(checks_out(&lab, mac, moved[2]), Some(vec![ml, ml]), "the new key adds the Mac's");
    assert!(lab.draft_move(mac, &moves, passkey).expect("nothing left to sign").is_empty());
    assert!(lab.moves(mac, Some(enclave_key)).is_empty(), "every next key is in the vault");
    // then the Mac's next key takes over its keep shares, and the Mac stays in the vault beside it
    lab.finish_move(mac, &moves).expect("its keep shares carried");
    let (owners, root, devices) = members(&lab, mac, vault);
    let signers = |s: &[SignerId]| s.iter().map(|&s| Principal::Signer(s)).collect::<Vec<_>>();
    assert_eq!((owners, root), (signers(&[passkey, touch, next, new_touch]), Some(passkey)));
    assert_eq!(devices, vec![mac, phone, mac_next]);

    // it opens again as its next key, on the store it kept, and keeps what it kept
    reopen(&mut lab, mac, mac_secret, mac_next);
    lab.sync_all(2);
    let st = lab.state(mac_next);
    assert!(st.acts_for(mac_next, vault));
    let copy: Vec<_> = st.copy_of(mac_next).map(|k| k.share.level.mode()).collect();
    assert_eq!(copy, vec![Some(KeepMode::Whole)], "its copy setting");
    let never = st.keeps_of(mac_next, vault).find(|k| k.share.level.mode() == Some(KeepMode::Never));
    let never = never.expect("none of her todos still").id;
    assert_eq!(lab.slice(mac_next, never).map(|s| &s.select), Some(&cast::of_type(world::TODO)));
    assert!(lab.slice(phone, never).is_some(), "the phone reads it too");
    assert!(lab.holds_key(mac_next, st.current(KeyFam::Seed(vault))), "it opens the vault");
    assert!(lab.item(mac_next, card).is_some(), "and reads what it wrote before");
    for id in made.iter().chain(&moved) {
        assert!(checks_out(&lab, mac_next, *id).is_some(), "{id:?}");
    }
    // nothing more moves here: the phone moves at its own unlock. Its earlier keys show as such, and it syncs with
    // the phone alone, not with its own earlier key, whose endpoint is its own
    assert_eq!(lab.moves(mac_next, Some(enclave_key)), vec![]);
    let named = [passkey, touch, next, new_touch, mac, phone, mac_next].into_iter().collect();
    let earlier: Vec<_> = lab.earlier_keys(mac_next, &named).into_iter().collect();
    let mut was = vec![(passkey, next), (touch, new_touch), (mac, mac_next)];
    was.sort();
    assert_eq!(earlier, was);
    assert_eq!(lab.peers(mac_next).into_iter().map(|(d, _)| d).collect::<Vec<_>>(), vec![phone]);

    // Alice's phone opens: her passkey's next key is an owner already, and the phone moves alone. Cut short once its
    // next key joined and what opens it named that key, it has nothing left to do at its next unlock
    let phone_secret = *authenticator.prf(&device_salt(&PHONE_SALT));
    let [phone_next, _] = lab.device_keys(phone, phone_secret).expect("its keys");
    assert_eq!(lab.peers(phone).into_iter().map(|(d, _)| d).collect::<Vec<_>>(), vec![mac_next], "the Mac, once");
    let moves = lab.moves(phone, None);
    assert_eq!(moves, vec![(phone, phone_next)]);
    let drafts = lab.draft_move(phone, &moves, next).expect("the phone's view takes it");
    assert_eq!(drafts.len(), 1);
    let key = authenticator.ceremony(drafts[0].challenge());
    lab.complete_move(phone, drafts, &[(next, &key)]).expect("its next key joined");
    reopen(&mut lab, phone, phone_secret, phone_next);
    assert!(lab.moves(phone_next, None).is_empty(), "the old phone stays beside its next key");
    assert!(lab.draft_move(phone_next, &moves, next).expect("nothing to sign").is_empty());
    lab.finish_move(phone_next, &moves).expect("its keep shares carried");
    lab.sync_all(3);
    for d in [mac_next, phone_next] {
        let (owners, root, devices) = members(&lab, d, vault);
        assert_eq!((owners, root), (signers(&[passkey, touch, next, new_touch]), Some(passkey)));
        assert_eq!(devices, vec![mac, phone, mac_next, phone_next]);
        assert!(lab.holds_key(d, lab.state(d).current(KeyFam::Seed(vault))));
    }
    assert!(lab.item(phone_next, card).is_some());
    assert!(lab.moves(phone_next, None).is_empty());
    // each key of her passkey signs for the vault, its owners being equal: one secret makes both
    let threshold = Action::Settings { vault, set: Setting::Threshold(1) };
    for key in [passkey, next] {
        assert!(lab.draft(phone_next, &[key], threshold.clone()).is_ok(), "{key:?}");
    }
}

#[test]
fn a_touch_alone_moves_the_mac_and_its_touch_id_key_and_the_passkey_moves_at_its_next_ceremony() {
    let mut authenticator = Passkey::from_seed_in([1; 32], Suite::SlhDsa);
    let enclave = EnclaveKey::from_seed_in([3; 32], Suite::SlhDsa);
    let Before { mut lab, passkey, next, touch, mac, phone, vault, card } = before(&mut authenticator, &enclave);
    // the Mac opened by a touch: the Lab holds no key of the passkey, and the Touch ID key's in each suite
    lab.lose(passkey);
    lab.lose(next);
    let new_touch = lab.web_enclave("Alice's Mac", &enclave.ceremony([4; 32])).expect("the touch");
    let mac_secret = *authenticator.prf(&device_salt(&MAC_SALT));
    let [mac_next, _] = lab.device_keys(mac, mac_secret).expect("its keys");
    let moves = lab.moves(mac, None);
    assert_eq!(moves.len(), 2);
    assert!(moves.contains(&(touch, new_touch)) && moves.contains(&(mac, mac_next)));
    // the Touch ID key approves for the vault, its owners being equal: it adds its next key, which adds the Mac's
    // next key, all in one touch
    let drafts = lab.draft_move(mac, &moves, touch).expect("the Mac's view takes it");
    assert_eq!(drafts.len(), 2);
    let finger = enclave.ceremony(drafts[0].challenge());
    lab.complete_move(mac, drafts, &[(touch, &finger), (new_touch, &finger)]).expect("one touch signed it");
    lab.finish_move(mac, &moves).expect("its keep shares carried");
    // its node opens again as its next key: a Lab of its own, which takes the Mac's edits from its shelf and the
    // Touch ID key's keys from the Lab it leaves
    let shelf = lab.backup(mac);
    let mut alone = lab.moved(mac, mac_next, [8; 32]).expect("its next key at hand");
    assert!(lab.keys_of(new_touch).is_none() && lab.keys_of(mac_next).is_none(), "handed over");
    alone.restore_backup(mac_next, &shelf);
    assert_eq!(alone.devices(), &[mac_next]);
    let signers = |s: &[SignerId]| s.iter().map(|&s| Principal::Signer(s)).collect::<Vec<_>>();
    let (owners, root, devices) = members(&alone, mac_next, vault);
    assert_eq!((owners, root), (signers(&[passkey, touch, new_touch]), Some(passkey)));
    assert_eq!(devices, vec![mac, phone, mac_next]);
    assert!(alone.item(mac_next, card).is_some());
    assert!(alone.holds_key(mac_next, alone.state(mac_next).current(KeyFam::Seed(vault))));
    assert!(alone.moves(mac_next, None).is_empty(), "the passkey moves only with a ceremony of its own");

    // the passkey's next ceremony brings both its keys, and moves it alone
    let unlock = authenticator.ceremony([5; 32]);
    assert_eq!(alone.web_passkey("Alice", authenticator.public(), &unlock), Some([next, passkey]));
    let moves = alone.moves(mac_next, None);
    assert_eq!(moves, vec![(passkey, next)]);
    let drafts = alone.draft_move(mac_next, &moves, passkey).expect("the new Mac's view takes it");
    assert_eq!(drafts.len(), 1);
    let key = authenticator.ceremony(drafts[0].challenge());
    alone.complete_move(mac_next, drafts, &[(passkey, &key), (next, &key)]).expect("one ceremony signed it");
    alone.finish_move(mac_next, &moves).expect("no device moved");
    let (owners, root, _) = members(&alone, mac_next, vault);
    assert_eq!((owners, root), (signers(&[passkey, touch, new_touch, next]), Some(passkey)));
    assert!(alone.moves(mac_next, None).is_empty());
}

/// 2026-10-20: Alice's phone, which didn't hold her coop yet, moves her passkey. The move only adds, so the coop and
/// its records stay on her Mac once the move reaches it; a move that removed her old passkey cut them there (T16).
#[test]
fn a_move_from_a_phone_that_holds_none_of_her_coop_leaves_the_coop_on_her_mac() {
    let mut authenticator = Passkey::from_seed_in([1; 32], Suite::SlhDsa);
    let enclave = EnclaveKey::from_seed_in([3; 32], Suite::SlhDsa);
    let Before { mut lab, passkey, next, touch, mac, phone, vault, .. } = before(&mut authenticator, &enclave);
    let owners = vec![Principal::Vault(vault)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 5, seal_to: vec![] };
    let coop = VaultId::from(by_passkey(&mut lab, mac, &[passkey], genesis, &mut authenticator));
    let card = lab.create(mac, coop, coop, world::CARD, &[], world::card("the coop's card", mac)).expect("a card");
    assert!(lab.state(mac).vault(coop).is_some() && lab.item(mac, card).is_some());
    assert!(lab.state(phone).vault(coop).is_none(), "the phone holds none of it");

    let phone_secret = *authenticator.prf(&device_salt(&PHONE_SALT));
    let [phone_next, _] = lab.device_keys(phone, phone_secret).expect("its keys");
    let mut moves = lab.moves(phone, None);
    moves.sort();
    let mut all = vec![(passkey, next), (phone, phone_next)];
    all.sort();
    assert_eq!(moves, all);
    let drafts = lab.draft_move(phone, &moves, passkey).expect("the phone's view takes it");
    let key = authenticator.ceremony(drafts[0].challenge());
    lab.complete_move(phone, drafts, &[(passkey, &key), (next, &key)]).expect("one ceremony signed it");
    lab.finish_move(phone, &moves).expect("its keep shares carried");
    lab.sync(phone, mac);
    lab.sync(mac, phone);

    let st = lab.state(mac);
    assert_eq!(st.vault(coop).map(|v| v.owners.clone()), Some(vec![Principal::Vault(vault)]), "the coop stays");
    assert!(lab.item(mac, card).is_some(), "with its records");
    assert!(st.acts_for(mac, coop), "and the Mac acts for it");
    let (owners, root, devices) = members(&lab, mac, vault);
    let signers = [passkey, touch, next].map(Principal::Signer).to_vec();
    assert_eq!((owners, root), (signers, Some(passkey)));
    assert_eq!(devices, vec![mac, phone, phone_next]);
}

#[test]
fn the_master_recovery_key_moves_by_the_persons_ceremony_and_its_standing_consent() {
    // Alice's vault, founded before the key move with the master recovery key among its owners, in SLH-DSA (K4)
    let mut authenticator = Passkey::from_seed_in([1; 32], Suite::SlhDsa);
    let mut lab = Lab::with_entropy([9; 32]);
    let (old, new) = (RecoveryKey::of_in([7; 32], Suite::SlhDsa), RecoveryKey::of_in([7; 32], Suite::MlDsa));
    let old_master = lab.set_recovery(Arc::new(old));
    let ceremony = authenticator.ceremony([1; 32]);
    let [next, passkey] = lab.web_passkey("Alice", authenticator.public(), &ceremony).expect("its own ceremony");
    let mac = lab.device_with_in("Alice's Mac", *authenticator.prf(&device_salt(&MAC_SALT)), Suite::SlhDsa);
    let (owners, signers) = lab.human_owners(passkey);
    assert_eq!(signers, [passkey, old_master]);
    let genesis =
        Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    // the passkey's ceremony and the master key's standing consent, as `Node::found_with` signs it
    let draft = lab.draft(mac, &signers, genesis).expect("the device's view takes it");
    let founding = authenticator.ceremony(draft.challenge());
    let vault = VaultId::from(lab.complete(mac, draft, &[(passkey, &founding)]).expect("both signed it"));
    let add = Action::Share(Sharing::Device { vault, device: mac, seal_to: None });
    by_passkey(&mut lab, mac, &[passkey, mac], add, &mut authenticator);

    // avenDB's next build carries the key in ML-DSA-65, from the same secret: the master key moves with the person's
    // next ceremony, never by its offline secret, and only where the earlier key is an owner still
    let new_master = lab.set_recovery(Arc::new(new));
    assert_ne!(new_master, old_master);
    let moves = lab.moves(mac, None);
    assert!(moves.contains(&(old_master, new_master)), "{moves:?}");
    assert!(moves.contains(&(passkey, next)));
    let drafts = lab.draft_move(mac, &[(old_master, new_master)], passkey).expect("the Mac's view takes it");
    assert_eq!(drafts.len(), 1);
    let key = authenticator.ceremony(drafts[0].challenge());
    let moved = lab.complete_move(mac, drafts, &[(passkey, &key)]).expect("her passkey and its consent signed it");
    assert!(checks_out(&lab, mac, moved[0]).is_some());
    let (owners, root, _) = members(&lab, mac, vault);
    let signers = |s: &[SignerId]| s.iter().map(|&s| Principal::Signer(s)).collect::<Vec<_>>();
    assert_eq!((owners, root), (signers(&[passkey, old_master, new_master]), Some(passkey)), "the earlier one stays");
    assert!(!lab.moves(mac, None).iter().any(|&(old, _)| old == old_master), "nothing left of it to move");
    assert!(lab.draft_move(mac, &[(old_master, new_master)], passkey).expect("nothing to sign").is_empty());
}

