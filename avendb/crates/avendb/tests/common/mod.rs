//! The people, vaults and spaces of the plan's scenarios, the same cast as `avendb/spec/AvenDB/Examples.lean`: on one
//! log for the rules (`cast`, signers by number), and on the Lab (`avendb::cast`: `world`, real devices and keys).
#![allow(dead_code)]

pub use avendb::cast::*;
use avendb::id::{EntryId, GrantId, SignerId, SpaceId, VaultId};
use avendb::policy::{Action, Kind, Log, Principal, Role, Scope};

// Signers on the rules' log: passkeys and device keys.
pub const PASSKEY_S: SignerId = SignerId::from_u64(1);
pub const MAC_S: SignerId = SignerId::from_u64(2);
pub const PHONE_S: SignerId = SignerId::from_u64(3);
pub const PASSKEY_B: SignerId = SignerId::from_u64(4);
pub const MAC_B: SignerId = SignerId::from_u64(5);
pub const PASSKEY_C: SignerId = SignerId::from_u64(6);
pub const MAC_C: SignerId = SignerId::from_u64(7);
pub const PASSKEY_D: SignerId = SignerId::from_u64(8);
pub const MAC_D: SignerId = SignerId::from_u64(9);
pub const NEW_DEVICE: SignerId = SignerId::from_u64(77);
pub const STRANGER: SignerId = SignerId::from_u64(555);

// Entries on the rules' log.
pub const WELCOME: EntryId = EntryId::from_u64(1);
pub const CHARTER: EntryId = EntryId::from_u64(2);
pub const ONBOARDING: EntryId = EntryId::from_u64(3);
pub const DOOR: EntryId = EntryId::from_u64(21);
pub const SEEDS: EntryId = EntryId::from_u64(22);
pub const SOLAR: EntryId = EntryId::from_u64(23);

/// The rules' log after scenarios 1 and 2: Samuel with his passkey, Mac and iPhone; Bob, Carol and Dave with a passkey
/// and a Mac each.
pub struct Cast {
    pub log: Log,
    pub samuel: VaultId,
    pub bob: VaultId,
    pub carol: VaultId,
    pub dave: VaultId,
}

/// A human vault whose passkey is its only owner and its root, with its devices.
pub fn human(log: &mut Log, passkey: SignerId, devices: &[SignerId]) -> VaultId {
    let genesis = Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let v = VaultId::from(log.append(passkey, &[], genesis).unwrap());
    for &d in devices {
        log.append(passkey, &[d], Action::AddDevice { vault: v, device: d, seal_to: None }).unwrap();
    }
    v
}

pub fn cast() -> Cast {
    let mut log = Log::new();
    let samuel = human(&mut log, PASSKEY_S, &[MAC_S, PHONE_S]);
    let bob = human(&mut log, PASSKEY_B, &[MAC_B]);
    let carol = human(&mut log, PASSKEY_C, &[MAC_C]);
    let dave = human(&mut log, PASSKEY_D, &[MAC_D]);
    Cast { log, samuel, bob, carol, dave }
}

/// Scenario 3: Maia Coop, owned by Samuel and Bob with threshold 2; Bob's passkey consents.
pub fn with_coop(c: &mut Cast) -> VaultId {
    let owners = vec![Principal::Vault(c.samuel), Principal::Vault(c.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    VaultId::from(c.log.append(PASSKEY_S, &[PASSKEY_B], genesis).unwrap())
}

pub struct Spaces {
    pub handbook: SpaceId,
    pub notes: SpaceId,
    pub todos: SpaceId,
}

/// Scenario 4: the coop founds Handbook, Samuel founds Notes and Todos, all from Samuel's Mac.
pub fn spaces(c: &mut Cast, coop: VaultId) -> Spaces {
    let mut found = |actor| SpaceId::from(c.log.append(MAC_S, &[], Action::FoundSpace { actor, nonce: 0, via: vec![] }).unwrap());
    let handbook = found(coop);
    let notes = found(c.samuel);
    let todos = found(c.samuel);
    Spaces { handbook, notes, todos }
}

/// The rules' side of scenario 15: three todos in Samuel's Todos; the door todo shared with Bob (write), Carol (read)
/// and the coop (owner, which needs Samuel's passkey).
pub struct SocialTodo {
    pub c: Cast,
    pub coop: VaultId,
    pub todos: SpaceId,
    pub bob_write: GrantId,
    pub carol_read: GrantId,
    pub coop_owner: GrantId,
}

pub fn social_todo() -> SocialTodo {
    let mut c = cast();
    let coop = with_coop(&mut c);
    let todos = spaces(&mut c, coop).todos;
    let samuel = c.samuel;
    for e in [DOOR, SEEDS, SOLAR] {
        c.log.append(MAC_S, &[], write(todos, e, samuel, 0)).unwrap();
    }
    let door = Scope::Entry(todos, DOOR);
    let bob_write = GrantId::from(c.log.append(MAC_S, &[], grant(door, Role::Write, vault(c.bob), samuel, None)).unwrap());
    let carol_read =
        GrantId::from(c.log.append(MAC_S, &[], grant(door, Role::Read, vault(c.carol), samuel, None)).unwrap());
    let coop_owner = GrantId::from(c.log.append(PASSKEY_S, &[], grant(door, Role::Owner, vault(coop), samuel, None)).unwrap());
    SocialTodo { c, coop, todos, bob_write, carol_read, coop_owner }
}
