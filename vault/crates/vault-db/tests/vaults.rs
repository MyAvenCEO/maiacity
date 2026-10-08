//! Vaults and governance (P1; T2, T3), on the rules alone.

mod common;

use common::*;
use vault_db::id::VaultId;
use vault_db::policy::{Action, Kind, Log, Principal, Refusal};

#[test]
#[ignore = "P1: vaults"]
fn vault_id_is_genesis_hash() {
    let mut log = Log::new();
    let genesis = |nonce| Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(PASSKEY_S)], threshold: 1, nonce };
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
#[ignore = "P1: vaults"]
fn device_cannot_govern() {
    let c = cast();
    // Samuel's Mac acts for his vault…
    assert!(c.log.view().acts_for(MAC_S, c.samuel));
    // …but alone it can't add a device, even one that consents, remove one, or change the threshold
    let add = Action::AddDevice { vault: c.samuel, device: NEW_DEVICE };
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
#[ignore = "P1: vaults"]
fn add_owner_needs_threshold_and_consent() {
    let mut c = cast();
    // a coop's genesis needs every first owner's consent
    let owners = vec![Principal::Vault(c.samuel), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, nonce: 0 };
    assert_eq!(c.log.check(PASSKEY_S, &[], genesis).err(), Some(Refusal::NoConsent));
    let coop = with_coop(&mut c);
    let add_dave = Action::AddOwner { vault: coop, owner: Principal::Vault(c.dave) };
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
#[ignore = "P1: vaults"]
fn ownership_cycle_rejected() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    // a coop can't own itself…
    let itself = Action::AddOwner { vault: coop, owner: Principal::Vault(coop) };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], itself).err(), Some(Refusal::Cycle));
    // …nor a vault it owns: Garden, owned by the coop, can't become the coop's owner
    let genesis = Action::Genesis { kind: Kind::Coop, owners: vec![Principal::Vault(coop)], threshold: 1, nonce: 0 };
    let garden = VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B], genesis).unwrap());
    let around = Action::AddOwner { vault: coop, owner: Principal::Vault(garden) };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], around).err(), Some(Refusal::Cycle));
    // and a human vault can't be owned by a vault at all: its owners are signers
    let human = Action::AddOwner { vault: c.samuel, owner: Principal::Vault(coop) };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], human).err(), Some(Refusal::WrongOwnerKind));
}
