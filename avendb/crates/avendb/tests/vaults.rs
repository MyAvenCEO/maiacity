//! Vaults and governance (P1 and P2; T2, T3, T16, T21), on the rules alone: the four kinds of vault and who may own
//! each, by the kind table, thresholds and consent, the passkey as a human vault's root, a device vault's devices,
//! which act for it but never govern it, an aven's one owner and its agents' device vaults, and acts for a vault that
//! name the owners they go through, down to the vault their device belongs to; including changes made concurrently on
//! devices that were offline and meet later, where a removal cuts what it hadn't seen: governance, and what a removed
//! owner wrote for the coop's own entries.

mod common;

use avendb::id::{EntryId, SignerId, VaultId};
use avendb::keys::{KeyFam, KeyName};
use avendb::policy::{Action, Edit, Kind, Log, OwnedBy, Principal, Refusal, Revoking, Setting, Sharing, State};
use avendb::sync::{log_of, LogId};
use common::*;

/// A second passkey of Alice's, her backup: an owner, never the root.
const SECOND: SignerId = SignerId::from_u64(98);

/// The relay server's device on the rules' log.
const SERVER: SignerId = SignerId::from_u64(600);

/// avenCEO server's status page, an entry of its own vault.
const STATUS: EntryId = EntryId::from_u64(27);

#[test]
fn vault_id_is_genesis_hash() {
    let mut log = Log::new();
    let genesis = |nonce| Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(PASSKEY_A)],
        threshold: 1,
        root: Some(PASSKEY_A),
        nonce,
        seal_to: vec![],
    };
    let edit = log.check(PASSKEY_A, &[], genesis(0)).unwrap();
    let id = log.append(PASSKEY_A, &[], genesis(0)).unwrap();
    assert_eq!(id, edit.id());
    let v = VaultId::from(id);
    assert_eq!(log.view().vault(v).map(|x| x.id), Some(v));
    // another genesis, even with the same owner, is another vault
    let other = VaultId::from(log.append(PASSKEY_A, &[], genesis(1)).unwrap());
    assert_ne!(other, v);
}

#[test]
fn device_cannot_govern() {
    let c = cast();
    // Alice's Mac acts for her vault…
    assert!(c.log.view().acts_for(MAC_A, c.alice));
    // …but alone it can't add a device, even one that consents, remove one, or change the threshold
    let add = Action::Share(Sharing::Device { vault: c.alice, device: NEW_DEVICE, seal_to: None });
    assert_eq!(c.log.check(MAC_A, &[NEW_DEVICE], add.clone()).err(), Some(Refusal::BelowThreshold));
    let remove = Action::Revoke(Revoking::Device { vault: c.alice, device: PHONE_A, keep: vec![] });
    assert_eq!(c.log.check(MAC_A, &[], remove).err(), Some(Refusal::BelowThreshold));
    let threshold = Action::Settings { vault: c.alice, set: Setting::Threshold(1) };
    assert_eq!(c.log.check(MAC_A, &[], threshold).err(), Some(Refusal::BelowThreshold));
    // her passkey can, with the new device's own signature
    assert!(c.log.check(PASSKEY_A, &[NEW_DEVICE], add.clone()).is_ok());
    assert_eq!(c.log.check(PASSKEY_A, &[], add).err(), Some(Refusal::NoConsent));
    // and a device can always remove itself
    let leave = Action::Revoke(Revoking::Device { vault: c.alice, device: PHONE_A, keep: vec![] });
    assert!(c.log.check(PHONE_A, &[], leave).is_ok());
}

#[test]
fn add_owner_needs_threshold_and_consent() {
    let mut c = cast();
    // a coop's genesis needs every first owner's consent
    let owners = vec![Principal::Vault(c.alice), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    assert_eq!(c.log.check(PASSKEY_A, &[], genesis).err(), Some(Refusal::NoConsent));
    let coop = with_coop(&mut c);
    let add_dave = Action::Share(Sharing::Owner { vault: coop, owner: Principal::Vault(c.dave), seal_to: None });
    // Alice's vault alone is below the coop's threshold of 2
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_D], add_dave.clone()).err(), Some(Refusal::BelowThreshold));
    // both owners, but Dave hasn't consented
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], add_dave.clone()).err(), Some(Refusal::NoConsent));
    // devices don't count towards the threshold, even when they act for the owners
    assert_eq!(c.log.check(MAC_A, &[MAC_B, PASSKEY_D], add_dave.clone()).err(), Some(Refusal::BelowThreshold));
    // both owners' passkeys and Dave's
    c.log.append(PASSKEY_A, &[PASSKEY_B, PASSKEY_D], add_dave).unwrap();
    let owners = c.log.view().vault(coop).map(|v| v.owners.clone()).unwrap();
    assert!(owners.contains(&Principal::Vault(c.dave)));
}

#[test]
fn ownership_cycle_rejected() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    // a coop can't own itself…
    let itself = Action::Share(Sharing::Owner { vault: coop, owner: Principal::Vault(coop), seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], itself).err(), Some(Refusal::Cycle));
    // …nor a vault it owns: Garden, owned by the coop, can't become the coop's owner
    let owners = vec![Principal::Vault(coop)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let garden = VaultId::from(c.log.append(PASSKEY_A, &[PASSKEY_B], genesis).unwrap());
    let around = Action::Share(Sharing::Owner { vault: coop, owner: Principal::Vault(garden), seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], around).err(), Some(Refusal::Cycle));
    // and a human vault can't be owned by a vault at all: its owners are signers
    let human = Action::Share(Sharing::Owner { vault: c.alice, owner: Principal::Vault(coop), seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], human).err(), Some(Refusal::WrongOwnerKind));
}

/// What every device ends up with once the edits of two offline copies of a log meet, in either order.
fn meet(a: &Log, b: &Log) -> State {
    let (mut ab, mut ba) = (a.clone(), b.clone());
    ab.receive(b.edits().to_vec());
    ba.receive(a.edits().to_vec());
    let st = ab.view();
    assert!(ba.view() == st, "the order the edits arrived in changed the result");
    st
}

/// A coop of Alice and Bob where either may act alone, as Examples.lean's `pair`.
fn pair_of(c: &mut Cast) -> VaultId {
    let owners = vec![Principal::Vault(c.alice), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 1, seal_to: vec![] };
    VaultId::from(c.log.append(PASSKEY_A, &[PASSKEY_B], genesis).unwrap())
}

#[test]
fn concurrent_mutual_removals_leave_one_owner() {
    let mut c = cast();
    let pair = pair_of(&mut c);
    let remove = |owner| Action::Revoke(Revoking::Owner { vault: pair, owner: Principal::Vault(owner), keep: vec![] });
    // offline, each removes the other; each removal is fine alone
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    a.append(PASSKEY_A, &[], remove(c.bob)).unwrap();
    b.append(PASSKEY_B, &[], remove(c.alice)).unwrap();
    // together, the first in the replay order stands and the other would remove the last owner
    let st = meet(&a, &b);
    assert_eq!(st.vault(pair).map(|v| v.owners.len()), Some(1));
}

#[test]
fn concurrent_adds_that_close_a_cycle_keep_only_the_first() {
    let mut c = cast();
    let alice = c.alice;
    let mut coop_of_alice = |nonce| {
        let owners = vec![Principal::Vault(alice)];
        let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        VaultId::from(c.log.append(PASSKEY_A, &[], genesis).unwrap())
    };
    let (garden, kitchen) = (coop_of_alice(1), coop_of_alice(2));
    let add = |vault, owner| Action::Share(Sharing::Owner { vault, owner: Principal::Vault(owner), seal_to: None });
    // offline, Garden takes Kitchen as an owner on one device, and Kitchen takes Garden on another
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    a.append(PASSKEY_A, &[], add(garden, kitchen)).unwrap();
    b.append(PASSKEY_A, &[], add(kitchen, garden)).unwrap();
    // together they would close a cycle, so exactly one of them stands (T3)
    let st = meet(&a, &b);
    let owned_by = |x: VaultId, y: VaultId| st.vault(x).unwrap().owners.contains(&Principal::Vault(y));
    assert!(owned_by(garden, kitchen) != owned_by(kitchen, garden));
    assert!(!st.owns(garden, garden) && !st.owns(kitchen, kitchen));
}

#[test]
fn a_removal_wins_over_a_concurrent_add_it_did_not_see() {
    let mut c = cast();
    // a coop of Alice, Bob and Dave, threshold 2
    let owners = vec![Principal::Vault(c.alice), Principal::Vault(c.bob), Principal::Vault(c.dave)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 1, seal_to: vec![] };
    let trio = VaultId::from(c.log.append(PASSKEY_A, &[PASSKEY_B, PASSKEY_D], genesis).unwrap());
    // Alice and Bob remove Dave, while Dave and Alice add Carol, who consents
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    let remove = Action::Revoke(Revoking::Owner { vault: trio, owner: Principal::Vault(c.dave), keep: vec![] });
    a.append(PASSKEY_A, &[PASSKEY_B], remove).unwrap();
    let add = Action::Share(Sharing::Owner { vault: trio, owner: Principal::Vault(c.carol), seal_to: None });
    b.append(PASSKEY_D, &[PASSKEY_A, PASSKEY_C], add).unwrap();
    // removals replay first: without Dave, the add has only Alice's approval, below the threshold
    let st = meet(&a, &b);
    let owners = vec![Principal::Vault(c.alice), Principal::Vault(c.bob)];
    assert_eq!(st.vault(trio).map(|v| v.owners.clone()), Some(owners));
}

#[test]
fn the_passkey_is_the_root() {
    let mut c = cast();
    // a second passkey joins Alice's vault and the threshold goes up to 2: the root still approves alone…
    let second = Action::Share(Sharing::Owner { vault: c.alice, owner: Principal::Signer(SECOND), seal_to: None });
    c.log.append(PASSKEY_A, &[SECOND], second).unwrap();
    c.log.append(PASSKEY_A, &[], Action::Settings { vault: c.alice, set: Setting::Threshold(2) }).unwrap();
    let add = Action::Share(Sharing::Device { vault: c.alice, device: NEW_DEVICE, seal_to: None });
    assert!(c.log.check(PASSKEY_A, &[NEW_DEVICE], add.clone()).is_ok());
    // …and the second passkey alone is below the threshold
    assert_eq!(c.log.check(SECOND, &[NEW_DEVICE], add).err(), Some(Refusal::BelowThreshold));
    // only the root hands the root on, and the new root signs
    let hand_on = Action::Settings { vault: c.alice, set: Setting::Root { root: Some(SECOND), keep: vec![] } };
    assert_eq!(c.log.check(SECOND, &[], hand_on.clone()).err(), Some(Refusal::NotRoot));
    assert_eq!(c.log.check(PASSKEY_A, &[], hand_on.clone()).err(), Some(Refusal::NoConsent));
    assert!(c.log.check(PASSKEY_A, &[SECOND], hand_on).is_ok());
    // a coop has no root, and a root signs the genesis that names it
    let owners = vec![Principal::Vault(c.alice), Principal::Vault(c.bob)];
    let root = Some(PASSKEY_A);
    let coop = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root, nonce: 0, seal_to: vec![] };
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], coop).err(), Some(Refusal::NotHuman));
    let (owners, root) = (vec![Principal::Signer(PASSKEY_A)], Some(SECOND));
    let unsigned = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root, nonce: 1, seal_to: vec![] };
    assert_eq!(c.log.check(PASSKEY_A, &[], unsigned).err(), Some(Refusal::NoConsent));
}

#[test]
fn a_removed_owner_cannot_backdate_governance() {
    let mut c = cast();
    let pair = pair_of(&mut c);
    let early = c.log.clone();
    // Alice goes on for a while, then removes Bob
    for _ in 0..3 {
        c.log.append(PASSKEY_A, &[], Action::Settings { vault: pair, set: Setting::Threshold(1) }).unwrap();
    }
    let remove = Action::Revoke(Revoking::Owner { vault: pair, owner: Principal::Vault(c.bob), keep: vec![] });
    c.log.append(PASSKEY_A, &[], remove).unwrap();
    // Bob, removed, signs an add on his early copy, where he still owned the coop, so it claims to come first
    let mut forged = early;
    let add = Action::Share(Sharing::Owner { vault: pair, owner: Principal::Vault(c.dave), seal_to: None });
    forged.append(PASSKEY_B, &[PASSKEY_D], add).unwrap();
    // the removal hadn't seen it, so it is cut
    let st = meet(&c.log, &forged);
    assert_eq!(st.vault(pair).map(|v| v.owners.clone()), Some(vec![Principal::Vault(c.alice)]));

    // a stolen second passkey: on an early copy the thief removes the root's passkey from the owners and adds a
    // device of their own; the root, having seen neither, removes the stolen passkey, and outranks it
    let mut c = cast();
    let second = Action::Share(Sharing::Owner { vault: c.alice, owner: Principal::Signer(SECOND), seal_to: None });
    c.log.append(PASSKEY_A, &[SECOND], second).unwrap();
    let early = c.log.clone();
    let remove = Action::Revoke(Revoking::Owner { vault: c.alice, owner: Principal::Signer(SECOND), keep: vec![] });
    c.log.append(PASSKEY_A, &[], remove).unwrap();
    let mut stolen = early;
    let remove = Action::Revoke(Revoking::Owner { vault: c.alice, owner: Principal::Signer(PASSKEY_A), keep: vec![] });
    stolen.append(SECOND, &[], remove).unwrap();
    let add = Action::Share(Sharing::Device { vault: c.alice, device: STRANGER, seal_to: None });
    stolen.append(SECOND, &[STRANGER], add).unwrap();
    let st = meet(&c.log, &stolen);
    assert_eq!(st.vault(c.alice).map(|v| v.owners.clone()), Some(vec![Principal::Signer(PASSKEY_A)]));
    assert!(!st.acts_for(STRANGER, c.alice));
}

#[test]
fn handing_the_root_on_cuts_the_old_passkeys_backdated_edits() {
    let mut c = cast();
    let second = Action::Share(Sharing::Owner { vault: c.alice, owner: Principal::Signer(SECOND), seal_to: None });
    c.log.append(PASSKEY_A, &[SECOND], second).unwrap();
    let early = c.log.clone();
    // the root goes to the new passkey, which retires the old one
    let root = Action::Settings { vault: c.alice, set: Setting::Root { root: Some(SECOND), keep: vec![] } };
    c.log.append(PASSKEY_A, &[SECOND], root).unwrap();
    let retire = Action::Revoke(Revoking::Owner { vault: c.alice, owner: Principal::Signer(PASSKEY_A), keep: vec![] });
    c.log.append(SECOND, &[], retire).unwrap();
    // the old passkey, stolen later, adds a device on an early copy
    let mut stolen = early;
    let add = Action::Share(Sharing::Device { vault: c.alice, device: STRANGER, seal_to: None });
    stolen.append(PASSKEY_A, &[STRANGER], add).unwrap();
    let st = meet(&c.log, &stolen);
    let vt = st.vault(c.alice).unwrap();
    assert_eq!((vt.owners.clone(), vt.root), (vec![Principal::Signer(SECOND)], Some(SECOND)));
    assert!(!st.acts_for(STRANGER, c.alice));
    // what the old passkey did before stays: the honest devices that drafted both removals had seen it
    assert!(st.acts_for(MAC_A, c.alice) && st.acts_for(PHONE_A, c.alice));
}

#[test]
fn a_vault_settles_before_the_coops_it_owns() {
    let mut c = cast();
    let (alice, bob) = (c.alice, c.bob);
    // Alice's vault gains two more passkeys, either of which approves for it alone
    let (second, third) = (SignerId::from_u64(90), SignerId::from_u64(91));
    for p in [second, third] {
        let add = Action::Share(Sharing::Owner { vault: alice, owner: Principal::Signer(p), seal_to: None });
        c.log.append(PASSKEY_A, &[p], add).unwrap();
    }
    // Alice and Bob found a coop where either acts alone
    let pair = pair_of(&mut c);
    // offline, the second passkey removes Bob from the coop; the third, having gone on a step, removes the second
    // passkey from Alice's vault, so the coop's removal sorts first
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    let remove = |vault, owner| Action::Revoke(Revoking::Owner { vault, owner, keep: vec![] });
    a.append(second, &[], remove(pair, Principal::Vault(bob))).unwrap();
    b.append(PASSKEY_A, &[], Action::Settings { vault: alice, set: Setting::Threshold(1) }).unwrap();
    b.append(third, &[], remove(alice, Principal::Signer(second))).unwrap();
    // Alice's vault settles first: the second passkey goes, and the removal it approved for the coop with it
    let st = meet(&a, &b);
    let owners = vec![Principal::Signer(PASSKEY_A), Principal::Signer(third)];
    assert_eq!(st.vault(alice).map(|v| v.owners.clone()), Some(owners));
    assert_eq!(st.vault(pair).map(|v| v.owners.len()), Some(2));
    // exactly as on a device that never held the coop's log
    let mut all = a.edits().to_vec();
    all.extend(b.edits().iter().filter(|o| !a.edits().contains(o)).cloned());
    let without: Vec<_> = all.into_iter().filter(|o| log_of(o, o.id()) != Some(LogId::Vault(pair))).collect();
    assert_eq!(Log::from_edits(without).view().vault(alice), st.vault(alice));
}

/// A device vault owned by Alice's vault, with a server as its device.
fn server_of_alice(c: &mut Cast) -> VaultId {
    let owners = vec![Principal::Vault(c.alice)];
    let kind = Kind::DeviceVault;
    let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let vault = VaultId::from(c.log.append(PASSKEY_A, &[], genesis).unwrap());
    let server = Action::Share(Sharing::Device { vault, device: SERVER, seal_to: None });
    c.log.append(PASSKEY_A, &[SERVER], server).unwrap();
    vault
}

/// A vault of kind `kind` owned by `owners`, its nonce `nonce`.
fn founded(kind: Kind, owners: Vec<Principal>, nonce: u64) -> Action {
    Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] }
}

/// Four kinds of vault (Examples.lean): a device vault, as a coop's drive or a studio's worker, is owned by one human
/// or coop vault, never by a signer; its devices act for it but never govern it; it owns no vault, and has no root;
/// a coop has no devices.
#[test]
fn a_device_vaults_devices_act_for_it_but_never_govern_it() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let device_vault = |owners, root, nonce| Action::Genesis {
        kind: Kind::DeviceVault,
        owners,
        threshold: 1,
        root,
        nonce,
        seal_to: vec![],
    };
    // signers own human vaults only, and only a human vault has a root
    let by_passkey = device_vault(vec![Principal::Signer(PASSKEY_A)], None, 1);
    assert_eq!(c.log.check(PASSKEY_A, &[], by_passkey).err(), Some(Refusal::WrongOwnerKind));
    let rooted = device_vault(vec![Principal::Vault(c.alice)], Some(PASSKEY_A), 1);
    assert_eq!(c.log.check(PASSKEY_A, &[], rooted).err(), Some(Refusal::NotHuman));
    // a coop may own a device vault too, with its owners' approval, but never with another owner beside it
    let of_coop = device_vault(vec![Principal::Vault(coop)], None, 2);
    assert_eq!(c.log.check(PASSKEY_A, &[], of_coop.clone()).err(), Some(Refusal::NoConsent));
    assert!(c.log.check(PASSKEY_A, &[PASSKEY_B], of_coop).is_ok());
    let two = device_vault(vec![Principal::Vault(c.alice), Principal::Vault(coop)], None, 2);
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], two).err(), Some(Refusal::OneOwner));
    let ceo = server_of_alice(&mut c);
    let st = c.log.view();
    // the server acts for avenCEO server as a member, Alice's Mac through Alice's vault; Bob's Mac doesn't
    assert!(st.acts_for(SERVER, ceo) && st.acts_for(MAC_A, ceo) && !st.acts_for(MAC_B, ceo));
    let vias = (st.via(SERVER, ceo), st.via(MAC_A, ceo), st.via(MAC_B, ceo));
    assert_eq!(vias, (Some(vec![]), Some(vec![c.alice]), None));
    // its key is sealed to the server and to Alice's vault's key; Alice's vault's key never to the server
    let opens = |s: SignerId, k: KeyFam| st.opens(&[KeyName::Signer(s)]).contains(&st.current(k));
    assert!(opens(SERVER, KeyFam::Seed(ceo)) && opens(PHONE_A, KeyFam::Seed(ceo)));
    assert!(!opens(SERVER, KeyFam::Seed(c.alice)) && !opens(MAC_B, KeyFam::Seed(ceo)));
    // the server governs nothing: it adds no device; Alice's passkey does, through Alice's vault
    let add = Action::Share(Sharing::Device { vault: ceo, device: NEW_DEVICE, seal_to: None });
    assert_eq!(c.log.check(SERVER, &[NEW_DEVICE], add.clone()).err(), Some(Refusal::BelowThreshold));
    assert!(c.log.check(PASSKEY_A, &[NEW_DEVICE], add).is_ok());
    // it has one owner: Bob's vault doesn't join, even with Alice's passkey, and no signer does
    let bob_too = Action::Share(Sharing::Owner { vault: ceo, owner: Principal::Vault(c.bob), seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], bob_too).err(), Some(Refusal::OneOwner));
    let signer = Action::Share(Sharing::Owner { vault: ceo, owner: Principal::Signer(NEW_DEVICE), seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[NEW_DEVICE], signer).err(), Some(Refusal::WrongOwnerKind));
    // it owns no vault, neither a coop nor a device vault
    let owns_coop = Action::Share(Sharing::Owner { vault: coop, owner: Principal::Vault(ceo), seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], owns_coop).err(), Some(Refusal::WrongOwnerKind));
    let sub = device_vault(vec![Principal::Vault(ceo)], None, 3);
    assert_eq!(c.log.check(PASSKEY_A, &[], sub).err(), Some(Refusal::WrongOwnerKind));
    // a coop has no devices: it acts only through its owners
    let device = Action::Share(Sharing::Device { vault: coop, device: NEW_DEVICE, seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B, NEW_DEVICE], device).err(), Some(Refusal::NoDevices));
}

/// An aven (Examples.lean's `sAven`): a coop's AI, owned by that coop alone, one to a coop. It holds devices, its
/// server, which act for it and never govern it, and the devices of its coop's owners act for it through the coop; it
/// owns nothing: no agent's device vault, no coop and no aven.
#[test]
fn an_aven_has_one_coop_owner_holds_its_server_and_owns_nothing() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let (alice, bob) = (Principal::Vault(c.alice), Principal::Vault(c.bob));
    let hers = VaultId::from(c.log.append(PASSKEY_A, &[], founded(Kind::Coop, vec![alice], 0)).unwrap());
    let aven = founded(Kind::Aven, vec![Principal::Vault(hers)], 0);
    let aven = VaultId::from(c.log.append(PASSKEY_A, &[], aven).unwrap());
    // one to a coop, owned by a coop alone: no second for Alice's coop, none of a person, of two coops or of a signer;
    // no second owner joins it, a coop or a person
    let second = founded(Kind::Aven, vec![Principal::Vault(hers)], 1);
    assert_eq!(c.log.check(PASSKEY_A, &[], second).err(), Some(Refusal::SecondAven));
    let of_person = founded(Kind::Aven, vec![bob], 1);
    assert_eq!(c.log.check(PASSKEY_B, &[], of_person).err(), Some(Refusal::WrongOwnerKind));
    let of_two = founded(Kind::Aven, vec![Principal::Vault(hers), Principal::Vault(coop)], 1);
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], of_two).err(), Some(Refusal::OneOwner));
    let of_passkey = founded(Kind::Aven, vec![Principal::Signer(PASSKEY_B)], 1);
    assert_eq!(c.log.check(PASSKEY_B, &[], of_passkey).err(), Some(Refusal::WrongOwnerKind));
    let joins = |owner| Action::Share(Sharing::Owner { vault: aven, owner, seal_to: None });
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_B], joins(Principal::Vault(coop))).err(), Some(Refusal::OneOwner));
    let carol = joins(Principal::Vault(c.carol));
    assert_eq!(c.log.check(PASSKEY_A, &[PASSKEY_C], carol).err(), Some(Refusal::WrongOwnerKind));
    let of_coop = founded(Kind::Aven, vec![Principal::Vault(coop)], 1);
    assert!(c.log.check(PASSKEY_A, &[PASSKEY_B], of_coop).is_ok(), "the two people's coop founds its own");
    // it holds devices, its server
    let add = |vault, device| Action::Share(Sharing::Device { vault, device, seal_to: None });
    c.log.append(PASSKEY_A, &[SERVER], add(aven, SERVER)).expect("Alice's passkey adds its server, through her coop");
    // the server acts for the aven as its device, Alice's devices through her coop and her vault; Bob's don't
    let st = c.log.view();
    assert_eq!((st.via(SERVER, aven), st.via(MAC_A, aven)), (Some(vec![]), Some(vec![hers, c.alice])));
    assert_eq!(st.via(MAC_B, aven), None);
    // the server governs nothing: it adds no device to the aven
    let other = SignerId::from_u64(601);
    assert_eq!(c.log.check(SERVER, &[other], add(aven, other)).err(), Some(Refusal::BelowThreshold));
    // it owns nothing: no device vault, no coop, no aven
    let device_of_aven = founded(Kind::DeviceVault, vec![Principal::Vault(aven)], 1);
    assert_eq!(c.log.check(PASSKEY_A, &[], device_of_aven).err(), Some(Refusal::WrongOwnerKind));
    let coop_of_aven = founded(Kind::Coop, vec![Principal::Vault(aven)], 1);
    assert_eq!(c.log.check(PASSKEY_A, &[], coop_of_aven).err(), Some(Refusal::WrongOwnerKind));
    let aven_of_aven = founded(Kind::Aven, vec![Principal::Vault(aven)], 1);
    assert_eq!(c.log.check(PASSKEY_A, &[], aven_of_aven).err(), Some(Refusal::WrongOwnerKind));
}

/// A write by which vault `v` creates its own entry `e`, in the audience of no shares, through the owners `via`.
fn create_via(v: VaultId, e: EntryId, via: Vec<VaultId>) -> Action {
    let mut create = creation(v, e, v, &[]);
    if let Action::Write { via: chain, .. } = &mut create {
        *chain = via;
    }
    create
}

/// Acts name their chain (Examples.lean): an act for a vault its device isn't a member of names the owners it goes
/// through, down to the vault the device belongs to, and an honest device's log names them as it drafts the edit.
#[test]
fn an_act_for_a_coop_names_the_vault_it_goes_through() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    // Alice's Mac creates Welcome, an entry of the coop's, through Alice's vault: the log names it
    let edit = c.log.check(MAC_A, &[], create_via(coop, WELCOME, vec![])).unwrap();
    assert_eq!(edit.action.via(), Some(&[c.alice][..]));
    // with no chain, through Bob's vault, which the Mac isn't a member of, or Carol's, which owns no coop: refused
    let bare = Edit { action: create_via(coop, WELCOME, vec![]), ..edit.clone() };
    assert_eq!(c.log.view().step(&bare).err(), Some(Refusal::NotActing));
    assert_eq!(c.log.check(MAC_A, &[], create_via(coop, WELCOME, vec![c.bob])).err(), Some(Refusal::NotActing));
    assert_eq!(c.log.check(MAC_C, &[], create_via(coop, WELCOME, vec![c.carol])).err(), Some(Refusal::NotActing));
    // a coop of the coop: Bob's Mac goes through the coop, then Bob's vault, and may skip neither
    let owners = vec![Principal::Vault(coop)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 4, seal_to: vec![] };
    let guild = VaultId::from(c.log.append(PASSKEY_A, &[PASSKEY_B], genesis).unwrap());
    let edit = c.log.check(MAC_B, &[], create_via(guild, WELCOME, vec![])).unwrap();
    assert_eq!(edit.action.via(), Some(&[coop, c.bob][..]));
    assert_eq!(c.log.check(MAC_B, &[], create_via(guild, WELCOME, vec![c.bob])).err(), Some(Refusal::NotActing));
    assert_eq!(c.log.check(MAC_B, &[], create_via(guild, WELCOME, vec![coop])).err(), Some(Refusal::NotActing));
    // the server creates an entry of avenCEO server's as its member, Alice's Mac through Alice's vault
    let ceo = server_of_alice(&mut c);
    assert_eq!(c.log.check(SERVER, &[], create_via(ceo, STATUS, vec![])).unwrap().action.via(), Some(&[][..]));
    let by_mac = c.log.check(MAC_A, &[], create_via(ceo, STATUS, vec![])).unwrap();
    assert_eq!(by_mac.action.via(), Some(&[c.alice][..]));
}

/// Strong removal: what Bob's Mac wrote for the coop through Bob's vault, on a copy that hadn't seen Bob leave the
/// coop, is cut, as the write names the owner it went through (Examples.lean's `bobLeft`).
#[test]
fn a_removed_owners_unseen_writes_for_the_coop_are_cut() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    c.create(MAC_A, coop, WELCOME, coop, &[], "doc", &[]).unwrap();
    let mut offline = c.log.clone();
    let en = offline.view().entry(WELCOME).cloned().expect("Welcome");
    let late = offline.append(MAC_B, &[], write(coop, WELCOME, coop, en.stay(), 0)).unwrap();
    assert_eq!(offline.edits().last().and_then(|o| o.action.via()), Some(&[c.bob][..]));
    // Bob leaves the coop on his own, on a device that hadn't seen that write
    let leave = Action::Revoke(Revoking::Owner { vault: coop, owner: Principal::Vault(c.bob), keep: vec![] });
    c.log.append(PASSKEY_B, &[], leave.clone()).unwrap();
    let st = meet(&c.log, &offline);
    assert!(!st.writes(WELCOME).contains(&late));
    assert_eq!(st.writes(WELCOME).len(), 1);
    // had Bob's leaving seen it, it would stand: an honest device keeps all it had seen
    let mut seen = offline;
    seen.append(PASSKEY_B, &[], leave).unwrap();
    assert!(seen.view().writes(WELCOME).contains(&late));
}

/// T21: in every state the rules reach, each vault keeps to its row of the kind table (`Kind::rules`): its owners are
/// of the kinds that may own it, no more of them than it takes, devices only where it holds them, and a root only for a
/// human vault, whatever the edits.
#[test]
fn every_vault_keeps_to_its_kind() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let ceo = server_of_alice(&mut c);
    let (signer, by_coop) = (Principal::Signer, Principal::Vault(coop));
    let owner = |vault, owner| Action::Share(Sharing::Owner { vault, owner, seal_to: None });
    let device = |vault, device| Action::Share(Sharing::Device { vault, device, seal_to: None });
    let root = Setting::Root { root: Some(PASSKEY_A), keep: vec![] };
    let hers = founded(Kind::Coop, vec![Principal::Vault(c.alice)], 0);
    let hers = VaultId::from(c.log.append(PASSKEY_A, &[], hers).unwrap());
    let aven = founded(Kind::Aven, vec![Principal::Vault(hers)], 0);
    let aven = VaultId::from(c.log.append(PASSKEY_A, &[], aven).unwrap());
    let attempts = [
        (PASSKEY_A, vec![PASSKEY_B], owner(coop, signer(PASSKEY_A))),
        (PASSKEY_A, vec![PASSKEY_B, NEW_DEVICE], device(coop, NEW_DEVICE)),
        (PASSKEY_A, vec![NEW_DEVICE], owner(ceo, signer(NEW_DEVICE))),
        (PASSKEY_A, vec![PASSKEY_B], owner(ceo, Principal::Vault(c.bob))),
        (PASSKEY_A, vec![PASSKEY_B], owner(c.alice, by_coop)),
        (PASSKEY_A, vec![], Action::Settings { vault: ceo, set: root.clone() }),
        (PASSKEY_A, vec![NEW_DEVICE], device(aven, NEW_DEVICE)),
        (PASSKEY_A, vec![], Action::Settings { vault: aven, set: root }),
        (PASSKEY_A, vec![PASSKEY_B], owner(aven, Principal::Vault(c.bob))),
        (PASSKEY_A, vec![PASSKEY_B], owner(aven, by_coop)),
        (PASSKEY_A, vec![], founded(Kind::Aven, vec![Principal::Vault(c.alice)], 1)),
        (PASSKEY_A, vec![], founded(Kind::Aven, vec![Principal::Vault(hers)], 1)),
        (PASSKEY_A, vec![PASSKEY_B], founded(Kind::Aven, vec![by_coop], 1)),
        (PASSKEY_A, vec![PASSKEY_B], founded(Kind::Aven, vec![by_coop], 2)),
        (PASSKEY_A, vec![], founded(Kind::Coop, vec![Principal::Vault(ceo)], 1)),
        (PASSKEY_A, vec![], founded(Kind::Coop, vec![Principal::Vault(aven)], 1)),
        (PASSKEY_A, vec![], founded(Kind::DeviceVault, vec![Principal::Vault(aven)], 1)),
    ];
    for (author, cosigners, action) in attempts {
        let _ = c.log.append(author, &cosigners, action);
    }
    let st = c.log.view();
    for v in st.vaults() {
        let rules = v.kind.rules();
        let of = |p: &Principal| match *p {
            Principal::Signer(_) => None,
            Principal::Vault(o) => st.vault(o).map(|o| o.kind),
        };
        assert!(v.owners.iter().all(|p| rules.fits(of(p))), "{v:?}");
        assert!(rules.takes(v.owners.len()), "{v:?}");
        if let OwnedBy::Signers = rules.owned_by {
            assert_eq!(v.kind, Kind::Human, "{v:?}");
        }
        assert!(v.devices.is_empty() || v.kind.has_devices(), "{v:?}");
        assert!(v.root.is_none() || v.kind == Kind::Human, "{v:?}");
    }
    // one aven to a coop: Alice's coop's, and the one the two people's coop founds
    let avens: Vec<_> = st.vaults().iter().filter(|v| v.kind == Kind::Aven).map(|v| v.owners.clone()).collect();
    assert_eq!(avens.len(), 2, "{avens:?}");
    assert!(avens.contains(&vec![Principal::Vault(hers)]) && avens.contains(&vec![by_coop]), "{avens:?}");
    assert_eq!(st.vault(aven).map(|v| v.devices.clone()), Some(vec![NEW_DEVICE]), "an aven holds its server");
    assert_eq!(st.vault(ceo).map(|v| (v.devices.clone(), v.root, v.owners.len())), Some((vec![SERVER], None, 1)));
}
