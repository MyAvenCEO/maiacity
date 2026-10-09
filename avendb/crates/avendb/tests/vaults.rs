//! Vaults and governance (P1 and P2; T2, T3, T16, T21), on the rules alone, including changes made concurrently on
//! devices that were offline and meet later.

mod common;

use common::*;
use avendb::id::{SignerId, SpaceId, VaultId};
use avendb::keys::{KeyName, KeyScope};
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

#[test]
fn a_vault_settles_before_the_coops_it_owns() {
    let mut c = cast();
    let (samuel, bob) = (c.samuel, c.bob);
    // Samuel's vault gains two more passkeys, either of which approves for it alone
    let (second, third) = (SignerId::from_u64(90), SignerId::from_u64(91));
    for p in [second, third] {
        c.log.append(PASSKEY_S, &[p], Action::AddOwner { vault: samuel, owner: Principal::Signer(p), seal_to: None }).unwrap();
    }
    // Samuel and Bob found a coop where either acts alone
    let owners = vec![Principal::Vault(samuel), Principal::Vault(bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 1, seal_to: vec![] };
    let pair = VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B], genesis).unwrap());
    // offline, the second passkey removes Bob from the coop; the third, having gone on a step, removes the second
    // passkey from Samuel's vault, so the coop's removal sorts first
    let (mut a, mut b) = (c.log.clone(), c.log.clone());
    a.append(second, &[], Action::RemoveOwner { vault: pair, owner: Principal::Vault(bob), keep: vec![] }).unwrap();
    b.append(PASSKEY_S, &[], Action::SetThreshold { vault: samuel, threshold: 1 }).unwrap();
    b.append(third, &[], Action::RemoveOwner { vault: samuel, owner: Principal::Signer(second), keep: vec![] }).unwrap();
    // Samuel's vault settles first: the second passkey goes, and the removal it approved for the coop with it
    let st = meet(&a, &b);
    assert_eq!(st.vault(samuel).map(|v| v.owners.clone()), Some(vec![Principal::Signer(PASSKEY_S), Principal::Signer(third)]));
    assert_eq!(st.vault(pair).map(|v| v.owners.len()), Some(2));
    // exactly as on a device that never held the coop's log
    let mut all = a.ops().to_vec();
    all.extend(b.ops().iter().filter(|o| !a.ops().contains(o)).cloned());
    let without: Vec<_> = all.into_iter().filter(|o| o.vault_of() != Some(pair)).collect();
    assert_eq!(Log::from_ops(without).view().vault(samuel), st.vault(samuel));
}


/// The relay server's device on the rules' log.
const SERVER: SignerId = SignerId::from_u64(600);

/// An aven vault owned by Samuel's vault, as avenCEO is, with the server as its device.
fn aven_of_samuel(c: &mut Cast) -> VaultId {
    let owners = vec![Principal::Vault(c.samuel)];
    let genesis = Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let aven = VaultId::from(c.log.append(PASSKEY_S, &[], genesis).unwrap());
    c.log.append(PASSKEY_S, &[SERVER], Action::AddDevice { vault: aven, device: SERVER, seal_to: None }).unwrap();
    aven
}

/// Three kinds of vault (Examples.lean): a human vault is owned by its person's passkeys, a coop and an aven vault by
/// human and coop vaults, never by a signer. An aven vault, as the relay server's avenCEO, has devices of its own, its
/// servers, which act for it but never govern it; it owns no vault, and has no root; a coop has no devices.
#[test]
fn an_aven_vaults_devices_act_for_it_but_never_govern_it() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let aven =
        |owners, root, nonce| Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root, nonce, seal_to: vec![] };
    // signers own human vaults only, and only a human vault has a root
    let by_passkey = aven(vec![Principal::Signer(PASSKEY_S)], None, 1);
    assert_eq!(c.log.check(PASSKEY_S, &[], by_passkey).err(), Some(Refusal::WrongOwnerKind));
    let rooted = aven(vec![Principal::Vault(c.samuel)], Some(PASSKEY_S), 1);
    assert_eq!(c.log.check(PASSKEY_S, &[], rooted).err(), Some(Refusal::NotHuman));
    // a coop may own an aven vault too, with its owners' approval
    let of_coop = aven(vec![Principal::Vault(coop)], None, 2);
    assert_eq!(c.log.check(PASSKEY_S, &[], of_coop.clone()).err(), Some(Refusal::NoConsent));
    assert!(c.log.check(PASSKEY_S, &[PASSKEY_B], of_coop).is_ok());
    let ceo = aven_of_samuel(&mut c);
    let st = c.log.view();
    // the server acts for avenCEO as a member, Samuel's Mac through Samuel's vault; Bob's Mac doesn't
    assert!(st.acts_for(SERVER, ceo) && st.acts_for(MAC_S, ceo) && !st.acts_for(MAC_B, ceo));
    let vias = (st.via(SERVER, ceo), st.via(MAC_S, ceo), st.via(MAC_B, ceo));
    assert_eq!(vias, (Some(vec![]), Some(vec![c.samuel]), None));
    // avenCEO's key is sealed to the server and to Samuel's vault's key; Samuel's vault's key never to the server
    let opens = |s: SignerId, k: KeyScope| st.opens(&[KeyName::Signer(s)]).contains(&st.current(k));
    assert!(opens(SERVER, KeyScope::Vault(ceo)) && opens(PHONE_S, KeyScope::Vault(ceo)));
    assert!(!opens(SERVER, KeyScope::Vault(c.samuel)) && !opens(MAC_B, KeyScope::Vault(ceo)));
    // the server governs nothing: it adds no device and no owner; Samuel's passkey does, through Samuel's vault
    let add = Action::AddDevice { vault: ceo, device: NEW_DEVICE, seal_to: None };
    assert_eq!(c.log.check(SERVER, &[NEW_DEVICE], add.clone()).err(), Some(Refusal::BelowThreshold));
    assert!(c.log.check(PASSKEY_S, &[NEW_DEVICE], add).is_ok());
    let bob_too = Action::AddOwner { vault: ceo, owner: Principal::Vault(c.bob), seal_to: None };
    assert_eq!(c.log.check(SERVER, &[PASSKEY_B], bob_too.clone()).err(), Some(Refusal::BelowThreshold));
    assert!(c.log.check(PASSKEY_S, &[PASSKEY_B], bob_too).is_ok());
    // no signer joins its owners; it owns no vault, neither a coop nor an aven vault
    let signer = Action::AddOwner { vault: ceo, owner: Principal::Signer(NEW_DEVICE), seal_to: None };
    assert_eq!(c.log.check(PASSKEY_S, &[NEW_DEVICE], signer).err(), Some(Refusal::WrongOwnerKind));
    let owns_coop = Action::AddOwner { vault: coop, owner: Principal::Vault(ceo), seal_to: None };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B], owns_coop).err(), Some(Refusal::WrongOwnerKind));
    let sub = aven(vec![Principal::Vault(ceo)], None, 3);
    assert_eq!(c.log.check(PASSKEY_S, &[], sub).err(), Some(Refusal::WrongOwnerKind));
    // a coop has no devices: it acts only through its owners
    let device = Action::AddDevice { vault: coop, device: NEW_DEVICE, seal_to: None };
    assert_eq!(c.log.check(PASSKEY_S, &[PASSKEY_B, NEW_DEVICE], device).err(), Some(Refusal::NoDevices));
}

/// Acts name their chain (Examples.lean): an act for a vault its device isn't a member of names the owners it goes
/// through, down to the vault the device belongs to, and an honest device's log names them as it drafts the op.
#[test]
fn an_act_for_a_coop_names_the_vault_it_goes_through() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let found = |actor, via| Action::FoundSpace { actor, nonce: 5, via };
    // Samuel's Mac founds a space for the coop through Samuel's vault: the log names it
    let op = c.log.check(MAC_S, &[], found(coop, vec![])).unwrap();
    assert_eq!(op.action.via(), Some(&[c.samuel][..]));
    // with no chain, through Bob's vault, which the Mac isn't a member of, or Carol's, which owns no coop: refused
    let bare = avendb::policy::Op { action: found(coop, vec![]), ..op.clone() };
    assert_eq!(c.log.view().step(&bare).err(), Some(Refusal::NotActing));
    assert_eq!(c.log.check(MAC_S, &[], found(coop, vec![c.bob])).err(), Some(Refusal::NotActing));
    assert_eq!(c.log.check(MAC_C, &[], found(coop, vec![c.carol])).err(), Some(Refusal::NotActing));
    // a coop of the coop: Bob's Mac goes through the coop, then Bob's vault, and may skip neither
    let owners = vec![Principal::Vault(coop)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 4, seal_to: vec![] };
    let guild = VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B], genesis).unwrap());
    let op = c.log.check(MAC_B, &[], found(guild, vec![])).unwrap();
    assert_eq!(op.action.via(), Some(&[coop, c.bob][..]));
    assert_eq!(c.log.check(MAC_B, &[], found(guild, vec![c.bob])).err(), Some(Refusal::NotActing));
    assert_eq!(c.log.check(MAC_B, &[], found(guild, vec![coop])).err(), Some(Refusal::NotActing));
    // the server founds a space for avenCEO as its member, Samuel's Mac through Samuel's vault
    let ceo = aven_of_samuel(&mut c);
    assert_eq!(c.log.check(SERVER, &[], found(ceo, vec![])).unwrap().action.via(), Some(&[][..]));
    assert_eq!(c.log.check(MAC_S, &[], found(ceo, vec![])).unwrap().action.via(), Some(&[c.samuel][..]));
}

/// Strong removal: what Bob's Mac wrote for the coop through Bob's vault, on a copy that hadn't seen Bob leave the
/// coop, is cut, as the write names the owner it went through (Examples.lean's `bobLeft`).
#[test]
fn a_removed_owners_unseen_writes_for_the_coop_are_cut() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let found = Action::FoundSpace { actor: coop, nonce: 0, via: vec![] };
    let handbook = SpaceId::from(c.log.append(MAC_S, &[], found).unwrap());
    c.log.append(MAC_S, &[], write(handbook, WELCOME, coop, 0)).unwrap();
    let mut offline = c.log.clone();
    let late = offline.append(MAC_B, &[], write(handbook, WELCOME, coop, 0)).unwrap();
    assert_eq!(offline.ops().last().and_then(|o| o.action.via()), Some(&[c.bob][..]));
    // Bob leaves the coop on his own, on a device that hadn't seen that write
    let leave = Action::RemoveOwner { vault: coop, owner: Principal::Vault(c.bob), keep: vec![] };
    c.log.append(PASSKEY_B, &[], leave).unwrap();
    let st = meet(&c.log, &offline);
    assert!(!st.writes(handbook, WELCOME).contains(&late));
    assert_eq!(st.writes(handbook, WELCOME).len(), 1);
}

/// T21: in every state the rules reach, each vault's owners fit its kind, only human and aven vaults have devices, and
/// only human vaults a root, whatever the ops.
#[test]
fn every_vault_keeps_to_its_kind() {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let ceo = aven_of_samuel(&mut c);
    let (signer, by_coop) = (Principal::Signer, Principal::Vault(coop));
    let attempts = [
        (PASSKEY_S, vec![PASSKEY_B], Action::AddOwner { vault: coop, owner: signer(PASSKEY_S), seal_to: None }),
        (PASSKEY_S, vec![PASSKEY_B, NEW_DEVICE], Action::AddDevice { vault: coop, device: NEW_DEVICE, seal_to: None }),
        (PASSKEY_S, vec![NEW_DEVICE], Action::AddOwner { vault: ceo, owner: signer(NEW_DEVICE), seal_to: None }),
        (PASSKEY_S, vec![PASSKEY_B], Action::AddOwner { vault: c.samuel, owner: by_coop, seal_to: None }),
        (PASSKEY_S, vec![], Action::SetRoot { vault: ceo, root: Some(PASSKEY_S), keep: vec![] }),
    ];
    for (author, cosigners, action) in attempts {
        let _ = c.log.append(author, &cosigners, action);
    }
    let st = c.log.view();
    for v in st.vaults() {
        let signers = v.owners.iter().filter(|p| matches!(p, Principal::Signer(_))).count();
        match v.kind {
            Kind::Human => assert_eq!(signers, v.owners.len(), "{v:?}"),
            Kind::Coop | Kind::Aven => assert_eq!(signers, 0, "{v:?}"),
        }
        assert!(v.devices.is_empty() || v.kind.has_devices(), "{v:?}");
        assert!(v.root.is_none() || v.kind == Kind::Human, "{v:?}");
    }
    assert_eq!(st.vault(ceo).map(|v| (v.devices.clone(), v.root)), Some((vec![SERVER], None)));
}
