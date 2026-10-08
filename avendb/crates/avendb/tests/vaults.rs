//! Vaults and governance (P1 and P2; T2, T3, T16), on the rules alone, including changes made concurrently on devices
//! that were offline and meet later.

mod common;

use common::*;
use avendb::id::{SignerId, VaultId};
use avendb::policy::{Action, Kind, Log, Principal, Refusal, State};

#[test]
fn vault_id_is_genesis_hash() {
    let mut log = Log::new();
    let genesis = |nonce| Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(PASSKEY_S)],
        threshold: 1,
        root: Some(PASSKEY_S),
        nonce,
        seal_to: vec![],
    };
    let op = log.check(PASSKEY_S, &[], genesis(0)).unwrap();
    let id = log.append(PASSKEY_S, &[], genesis(0)).unwrap();
    assert_eq!(id, op.id());
    let v = VaultId::from(id);
    assert_eq!(log.view().vault(v).map(|x| x.id), Some(v));
    // another genesis, even with the same owner, is another vault
    let other = VaultId::from(log.append(PASSKEY_S, &[], genesis(1)).unwrap());
    assert_ne!(other, v);
}

#[test]
fn device_cannot_govern() {
    let c = cast();
    // Samuel's Mac acts for his vault…
    assert!(c.log.view().acts_for(MAC_S, c.samuel));
    // …but alone it can't add a device, even one that consents, remove one, or change the threshold
    let add = Action::AddDevice { vault: c.samuel, device: NEW_DEVICE, seal_to: None };
    assert_eq!(c.log.check(MAC_S, &[NEW_DEVICE], add.clone()).err(), Some(Refusal::BelowThreshold));
    let remove = Action::RemoveDevice { vault: c.samuel, device: PHONE_S, keep: vec![] };
    assert_eq!(c.log.check(MAC_S, &[], remove).err(), Some(Refusal::BelowThreshold));
    let threshold = Action::SetThreshold { vault: c.samuel, threshold: 1 };
    assert_eq!(c.log.check(MAC_S, &[], threshold).err(), Some(Refusal::BelowThreshold));
    // his passkey can, with the new device's own signature
    assert!(c.log.check(PASSKEY_S, &[NEW_DEVICE], add.clone()).is_ok());
    assert_eq!(c.log.check(PASSKEY_S, &[], add).err(), Some(Refusal::NoConsent));
    // and a device can always remove itself
    let leave = Action::RemoveDevice { vault: c.samuel, device: PHONE_S, keep: vec![] };
    assert!(c.log.check(PHONE_S, &[], leave).is_ok());
}

#[test]
fn add_owner_needs_threshold_and_consent() {
    let mut c = cast();
    // a coop's genesis needs every first owner's consent
    let owners = vec![Principal::Vault(c.samuel), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    assert_eq!(c.log.check(PASSKEY_S, &[], genesis).err(), Some(Refusal::NoConsent));
    let coop = with_coop(&mut c);
    let add_dave = Action::AddOwner { vault: coop, owner: Principal::Vault(c.dave), seal_to: None };
    // Samuel's vault alone is below the coop's threshold of 2
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_D], add_dave.clone()).err(), Some(Refusal::BelowThreshold));
    // both owners, but Dave hasn't consented
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], add_dave.clone()).err(), Some(Refusal::NoConsent));
    // devices don't count towards the threshold, even when they act for the owners
    assert_eq!(c.log.check(MAC_S, &[MAC_B, PASSKEY_D], add_dave.clone()).err(), Some(Refusal::BelowThreshold));
    // both owners' passkeys and Dave's
    c.log.append(PASSKEY_S, &[PASSKEY_B, PASSKEY_D], add_dave).unwrap();
    let owners = c.log.view().vault(coop).map(|v| v.owners.clone()).unwrap();
    assert!(owners.contains(&Principal::Vault(c.dave)));
}

#[test]
fn ownership_cycle_rejected() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    // a coop can't own itself…
    let itself = Action::AddOwner { vault: coop, owner: Principal::Vault(coop), seal_to: None };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], itself).err(), Some(Refusal::Cycle));
    // …nor a vault it owns: Garden, owned by the coop, can't become the coop's owner
    let genesis = Action::Genesis { kind: Kind::Coop, owners: vec![Principal::Vault(coop)], threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let garden = VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B], genesis).unwrap());
    let around = Action::AddOwner { vault: coop, owner: Principal::Vault(garden), seal_to: None };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], around).err(), Some(Refusal::Cycle));
    // and a human vault can't be owned by a vault at all: its owners are signers
    let human = Action::AddOwner { vault: c.samuel, owner: Principal::Vault(coop), seal_to: None };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], human).err(), Some(Refusal::WrongOwnerKind));
}

/// What every device ends up with once the ops of two offline copies of a log meet, in either order.
fn meet(a: &Log, b: &Log) -> State {
    let (mut ab, mut ba) = (a.clone(), b.clone());
    ab.receive(b.ops().to_vec());
    ba.receive(a.ops().to_vec());
    let st = ab.view();
    assert!(ba.view() == st, "the order the ops arrived in changed the result");
    st
}

#[test]
fn concurrent_mutual_removals_leave_one_owner() {
    let mut c = cast();
    // a coop of Samuel and Bob where either may act alone
    let owners = vec![Principal::Vault(c.samuel), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 1, seal_to: vec![] };
    let pair = VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B], genesis).unwrap());
    // offline, each removes the other; each removal is fine alone
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    a.append(PASSKEY_S, &[], Action::RemoveOwner { vault: pair, owner: Principal::Vault(c.bob), keep: vec![] }).unwrap();
    b.append(PASSKEY_B, &[], Action::RemoveOwner { vault: pair, owner: Principal::Vault(c.samuel), keep: vec![] }).unwrap();
    // together, the first in the replay order stands and the other would remove the last owner
    let st = meet(&a, &b);
    assert_eq!(st.vault(pair).map(|v| v.owners.len()), Some(1));
}

#[test]
fn concurrent_adds_that_close_a_cycle_keep_only_the_first() {
    let mut c = cast();
    let mut coop_of_samuel = |nonce| {
        let genesis = Action::Genesis { kind: Kind::Coop, owners: vec![Principal::Vault(c.samuel)], threshold: 1, root: None, nonce, seal_to: vec![] };
        VaultId::from(c.log.append(PASSKEY_S, &[], genesis).unwrap())
    };
    let (garden, kitchen) = (coop_of_samuel(1), coop_of_samuel(2));
    // offline, Garden takes Kitchen as an owner on one device, and Kitchen takes Garden on another
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    a.append(PASSKEY_S, &[], Action::AddOwner { vault: garden, owner: Principal::Vault(kitchen), seal_to: None }).unwrap();
    b.append(PASSKEY_S, &[], Action::AddOwner { vault: kitchen, owner: Principal::Vault(garden), seal_to: None }).unwrap();
    // together they would close a cycle, so exactly one of them stands (T3)
    let st = meet(&a, &b);
    let owned_by = |x: VaultId, y: VaultId| st.vault(x).unwrap().owners.contains(&Principal::Vault(y));
    assert!(owned_by(garden, kitchen) != owned_by(kitchen, garden));
    assert!(!st.owns(garden, garden) && !st.owns(kitchen, kitchen));
}

#[test]
fn a_removal_wins_over_a_concurrent_add_it_did_not_see() {
    let mut c = cast();
    // a coop of Samuel, Bob and Dave, threshold 2
    let owners = vec![Principal::Vault(c.samuel), Principal::Vault(c.bob), Principal::Vault(c.dave)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 1, seal_to: vec![] };
    let trio = VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B, PASSKEY_D], genesis).unwrap());
    // Samuel and Bob remove Dave, while Dave and Samuel add Carol, who consents
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    a.append(PASSKEY_S, &[PASSKEY_B], Action::RemoveOwner { vault: trio, owner: Principal::Vault(c.dave), keep: vec![] }).unwrap();
    b.append(PASSKEY_D, &[PASSKEY_S, PASSKEY_C], Action::AddOwner { vault: trio, owner: Principal::Vault(c.carol), seal_to: None }).unwrap();
    // removals replay first: without Dave, the add has only Samuel's approval, below the threshold
    let st = meet(&a, &b);
    assert_eq!(st.vault(trio).map(|v| v.owners.clone()), Some(vec![Principal::Vault(c.samuel), Principal::Vault(c.bob)]));
}

/// A second passkey of Samuel's, his backup: an owner, never the root.
const SECOND: SignerId = SignerId::from_u64(98);

#[test]
fn the_passkey_is_the_root() {
    let mut c = cast();
    // a second passkey joins Samuel's vault and the threshold goes up to 2: the root still approves alone…
    c.log.append(PASSKEY_S, &[SECOND], Action::AddOwner { vault: c.samuel, owner: Principal::Signer(SECOND), seal_to: None }).unwrap();
    c.log.append(PASSKEY_S, &[], Action::SetThreshold { vault: c.samuel, threshold: 2 }).unwrap();
    let add = Action::AddDevice { vault: c.samuel, device: NEW_DEVICE, seal_to: None };
    assert!(c.log.check(PASSKEY_S, &[NEW_DEVICE], add.clone()).is_ok());
    // …and the second passkey alone is below the threshold
    assert_eq!(c.log.check(SECOND, &[NEW_DEVICE], add).err(), Some(Refusal::BelowThreshold));
    // only the root hands the root on, and the new root signs
    let hand_on = Action::SetRoot { vault: c.samuel, root: Some(SECOND), keep: vec![] };
    assert_eq!(c.log.check(SECOND, &[], hand_on.clone()).err(), Some(Refusal::NotRoot));
    assert_eq!(c.log.check(PASSKEY_S, &[], hand_on.clone()).err(), Some(Refusal::NoConsent));
    assert!(c.log.check(PASSKEY_S, &[SECOND], hand_on).is_ok());
    // a coop has no root, and a root signs the genesis that names it
    let owners = vec![Principal::Vault(c.samuel), Principal::Vault(c.bob)];
    let coop = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: Some(PASSKEY_S), nonce: 0, seal_to: vec![] };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], coop).err(), Some(Refusal::NotHuman));
    let owners = vec![Principal::Signer(PASSKEY_S)];
    let unsigned = Action::Genesis { kind: Kind::Human, owners, threshold: 1, root: Some(SECOND), nonce: 1, seal_to: vec![] };
    assert_eq!(c.log.check(PASSKEY_S, &[], unsigned).err(), Some(Refusal::NoConsent));
}

#[test]
fn a_removed_owner_cannot_backdate_governance() {
    let mut c = cast();
    // a coop of Samuel and Bob where either may act alone
    let owners = vec![Principal::Vault(c.samuel), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 1, seal_to: vec![] };
    let pair = VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B], genesis).unwrap());
    let early = c.log.clone();
    // Samuel goes on for a while, then removes Bob
    for _ in 0..3 {
        c.log.append(PASSKEY_S, &[], Action::SetThreshold { vault: pair, threshold: 1 }).unwrap();
    }
    c.log.append(PASSKEY_S, &[], Action::RemoveOwner { vault: pair, owner: Principal::Vault(c.bob), keep: vec![] }).unwrap();
    // Bob, removed, signs an add on his early copy, where he still owned the coop, so it claims to come first
    let mut forged = early;
    forged.append(PASSKEY_B, &[PASSKEY_D], Action::AddOwner { vault: pair, owner: Principal::Vault(c.dave), seal_to: None }).unwrap();
    // the removal hadn't seen it, so it is cut
    let st = meet(&c.log, &forged);
    assert_eq!(st.vault(pair).map(|v| v.owners.clone()), Some(vec![Principal::Vault(c.samuel)]));

    // a stolen second passkey: on an early copy the thief removes the root's passkey from the owners and adds a
    // device of their own; the root, having seen neither, removes the stolen passkey, and outranks it
    let mut c = cast();
    c.log.append(PASSKEY_S, &[SECOND], Action::AddOwner { vault: c.samuel, owner: Principal::Signer(SECOND), seal_to: None }).unwrap();
    let early = c.log.clone();
    let remove = Action::RemoveOwner { vault: c.samuel, owner: Principal::Signer(SECOND), keep: vec![] };
    c.log.append(PASSKEY_S, &[], remove).unwrap();
    let mut stolen = early;
    let remove = Action::RemoveOwner { vault: c.samuel, owner: Principal::Signer(PASSKEY_S), keep: vec![] };
    stolen.append(SECOND, &[], remove).unwrap();
    stolen.append(SECOND, &[STRANGER], Action::AddDevice { vault: c.samuel, device: STRANGER, seal_to: None }).unwrap();
    let st = meet(&c.log, &stolen);
    assert_eq!(st.vault(c.samuel).map(|v| v.owners.clone()), Some(vec![Principal::Signer(PASSKEY_S)]));
    assert!(!st.acts_for(STRANGER, c.samuel));
}

#[test]
fn handing_the_root_on_cuts_the_old_passkeys_backdated_ops() {
    let mut c = cast();
    c.log.append(PASSKEY_S, &[SECOND], Action::AddOwner { vault: c.samuel, owner: Principal::Signer(SECOND), seal_to: None }).unwrap();
    let early = c.log.clone();
    // the root goes to the new passkey, which retires the old one
    c.log.append(PASSKEY_S, &[SECOND], Action::SetRoot { vault: c.samuel, root: Some(SECOND), keep: vec![] }).unwrap();
    let retire = Action::RemoveOwner { vault: c.samuel, owner: Principal::Signer(PASSKEY_S), keep: vec![] };
    c.log.append(SECOND, &[], retire).unwrap();
    // the old passkey, stolen later, adds a device on an early copy
    let mut stolen = early;
    stolen.append(PASSKEY_S, &[STRANGER], Action::AddDevice { vault: c.samuel, device: STRANGER, seal_to: None }).unwrap();
    let st = meet(&c.log, &stolen);
    let vt = st.vault(c.samuel).unwrap();
    assert_eq!((vt.owners.clone(), vt.root), (vec![Principal::Signer(SECOND)], Some(SECOND)));
    assert!(!st.acts_for(STRANGER, c.samuel));
    // what the old passkey did before stays: the honest devices that drafted both removals had seen it
    assert!(st.acts_for(MAC_S, c.samuel) && st.acts_for(PHONE_S, c.samuel));
}
