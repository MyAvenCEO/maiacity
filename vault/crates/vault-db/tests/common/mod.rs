//! The people, vaults and spaces of the plan's scenarios, the same cast as `vault/spec/VaultSpec/Examples.lean`: on one
//! log for the rules (`cast`, signers by number), and on the Lab for the scenarios (`world`, real devices and keys).
#![allow(dead_code)]

use vault_db::doc::Item;
use vault_db::id::{EntryId, GrantId, SignerId, SpaceId, VaultId};
use vault_db::lab::Lab;
use vault_db::lens::{BlockV1, BlockV2, DocV1, KindV1, Status, TypeV2};
use vault_db::policy::{Action, Grant, Grantee, Kind, Log, Principal, Role, Scope};

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

pub fn vault(v: VaultId) -> Grantee {
    Grantee::Principal(Principal::Vault(v))
}

pub fn grant(scope: Scope, role: Role, grantee: Grantee, issuer: VaultId, parent: Option<GrantId>) -> Action {
    Action::Grant(Grant { scope, role, grantee, issuer, parent })
}

/// A write that builds on its entry's heads: the log fills in `deps` when it drafts the op.
pub fn write(space: SpaceId, entry: EntryId, actor: VaultId, epoch: u64) -> Action {
    Action::Write { space, entry, actor, epoch, deps: vec![], body: vec![0xc1, 0x9e, 0x47] }
}

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
    let mut found = |actor| SpaceId::from(c.log.append(MAC_S, &[], Action::FoundSpace { actor, nonce: 0 }).unwrap());
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

/// The Lab after scenarios 1 and 2, plus the server and a stranger.
pub struct World {
    pub lab: Lab,
    pub passkey_s: SignerId,
    pub mac_s: SignerId,
    pub phone_s: SignerId,
    pub passkey_b: SignerId,
    pub mac_b: SignerId,
    pub passkey_c: SignerId,
    pub mac_c: SignerId,
    pub passkey_d: SignerId,
    pub mac_d: SignerId,
    pub server: SignerId,
    pub server_vault: VaultId,
    pub stranger: SignerId,
    pub samuel: VaultId,
    pub bob: VaultId,
    pub carol: VaultId,
    pub dave: VaultId,
}

/// A human vault on the Lab, its passkey the root: the passkey signs the genesis on the first device, then adds each
/// device, which countersigns.
pub fn human_on(lab: &mut Lab, passkey: SignerId, devices: &[SignerId]) -> VaultId {
    let genesis = Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![] };
    let v = VaultId::from(lab.submit(devices[0], &[passkey], genesis).unwrap());
    for &d in devices {
        lab.submit(devices[0], &[passkey, d], Action::AddDevice { vault: v, device: d, seal_to: None }).unwrap();
    }
    v
}

pub fn world() -> World {
    let mut lab = Lab::new();
    let (passkey_s, mac_s, phone_s) = (lab.passkey("Samuel"), lab.device("Samuel's Mac"), lab.device("Samuel's iPhone"));
    let (passkey_b, mac_b) = (lab.passkey("Bob"), lab.device("Bob's Mac"));
    let (passkey_c, mac_c) = (lab.passkey("Carol"), lab.device("Carol's Mac"));
    let (passkey_d, mac_d) = (lab.passkey("Dave"), lab.device("Dave's Mac"));
    let (server, server_vault) = lab.server();
    let stranger = lab.device("a stranger");
    let samuel = human_on(&mut lab, passkey_s, &[mac_s, phone_s]);
    let bob = human_on(&mut lab, passkey_b, &[mac_b]);
    let carol = human_on(&mut lab, passkey_c, &[mac_c]);
    let dave = human_on(&mut lab, passkey_d, &[mac_d]);
    // they all know each other's vaults and the server's, as after exchanging contact cards; Samuel's iPhone holds his
    // contacts as his Mac does
    let macs = [(mac_s, samuel), (phone_s, samuel), (mac_b, bob), (mac_c, carol), (mac_d, dave), (server, server_vault)];
    for &(from, v) in &macs {
        for &(to, _) in &macs {
            if from != to {
                lab.share_contact(from, to, v);
            }
        }
    }
    World {
        lab,
        passkey_s,
        mac_s,
        phone_s,
        passkey_b,
        mac_b,
        passkey_c,
        mac_c,
        passkey_d,
        mac_d,
        server,
        server_vault,
        stranger,
        samuel,
        bob,
        carol,
        dave,
    }
}

/// Scenario 3 on the Lab.
pub fn coop_on(w: &mut World) -> VaultId {
    let owners = vec![Principal::Vault(w.samuel), Principal::Vault(w.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    VaultId::from(w.lab.submit(w.mac_s, &[w.passkey_s, w.passkey_b], genesis).unwrap())
}

/// Found a space on Samuel's Mac for `actor`, and give the server relay on it.
pub fn space_on(w: &mut World, actor: VaultId) -> SpaceId {
    let sp = SpaceId::from(w.lab.submit(w.mac_s, &[w.mac_s], Action::FoundSpace { actor, nonce: 0 }).unwrap());
    let relay = grant(Scope::Space(sp), Role::Relay, vault(w.server_vault), actor, None);
    w.lab.submit(w.mac_s, &[w.mac_s], relay).unwrap();
    sp
}

pub fn paragraph(id: u64, text: &str) -> BlockV2 {
    BlockV2 { id, r#type: TypeV2::Paragraph, level: None, checked: None, lang: None, text: text.into() }
}

pub fn heading(id: u64, text: &str) -> BlockV2 {
    BlockV2 { id, r#type: TypeV2::Heading, level: Some(1), checked: None, lang: None, text: text.into() }
}

/// A markdown document made on `signer`'s device: a heading (block 1) and one paragraph (block 2).
pub fn document(title: &str, body: &str, signer: SignerId) -> Item {
    let mut item = Item::document(title, signer);
    item.push_block(heading(1, title));
    item.push_block(paragraph(2, body));
    item
}

/// The same document as an app still on v1 writes it.
pub fn document_v1(title: &str, body: &str, signer: SignerId) -> Item {
    let block = |id, kind, text: &str| BlockV1 { id, kind, text: text.into() };
    let blocks = vec![block(1, KindV1::H1, title), block(2, KindV1::P, body)];
    Item::written_v1(&DocV1 { title: title.into(), blocks }, signer)
}

/// The text of block `id` as device `d` shows it.
pub fn text(lab: &Lab, d: SignerId, sp: SpaceId, e: EntryId, id: u64) -> Option<String> {
    let doc = lab.item(d, sp, e)?.as_document()?;
    doc.blocks.into_iter().find(|b| b.id == id).map(|b| b.text)
}

pub fn status(lab: &Lab, d: SignerId, sp: SpaceId, e: EntryId) -> Option<Status> {
    Some(lab.item(d, sp, e)?.as_todo()?.status)
}

/// Whether `haystack` holds `needle` anywhere.
pub fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle.as_bytes())
}

pub const WELCOME_TEXT: &str = "Welcome to Maia Coop: the greenhouse opens at eight.";
pub const ONBOARDING_TEXT: &str = "Onboarding: your first week, step by step.";
pub const CHARTER_TEXT: &str = "Our charter: one vault per person, and the data stays theirs.";
pub const AFTER_TEXT: &str = "Edited after the change: the greenhouse opens at nine.";

/// Scenarios 3 to 5 on the Lab: the coop, its Handbook and Samuel's Notes, Welcome and Onboarding written by Samuel
/// for the coop, and every device synced. Welcome is older: an app still on v1 wrote it (scenario 9).
pub struct Handbook {
    pub coop: VaultId,
    pub space: SpaceId,
    pub notes: SpaceId,
    pub welcome: EntryId,
    pub onboarding: EntryId,
}

pub fn handbook(w: &mut World) -> Handbook {
    let coop = coop_on(w);
    let space = space_on(w, coop);
    let samuel = w.samuel;
    let notes = space_on(w, samuel);
    let welcome = w.lab.create(w.mac_s, coop, space, document_v1("Welcome", WELCOME_TEXT, w.mac_s)).unwrap();
    let onboarding = w.lab.create(w.mac_s, coop, space, document("Onboarding", ONBOARDING_TEXT, w.mac_s)).unwrap();
    w.lab.sync_all(0);
    Handbook { coop, space, notes, welcome, onboarding }
}

/// Scenario 15 on the Lab: Samuel's Todos with three todos; the door todo shared with Bob (write), Carol (read) and
/// the coop (owner, signed with Samuel's passkey). Nothing synced yet.
pub struct Todos {
    pub coop: VaultId,
    pub space: SpaceId,
    pub door: EntryId,
    pub seeds: EntryId,
    pub solar: EntryId,
    pub bob_write: GrantId,
    pub carol_read: GrantId,
    pub coop_owner: GrantId,
}

pub fn todos_on(w: &mut World) -> Todos {
    let coop = coop_on(w);
    let samuel = w.samuel;
    let space = space_on(w, samuel);
    let mut new = |title: &str| w.lab.create(w.mac_s, samuel, space, Item::todo(title, w.mac_s)).unwrap();
    let door = new("Fix the greenhouse door");
    let seeds = new("Order seeds");
    let solar = new("Clean the solar panels");
    let d = Scope::Entry(space, door);
    let (bob, carol, mac, passkey) = (w.bob, w.carol, w.mac_s, w.passkey_s);
    let mut give = |signer, role, to| GrantId::from(w.lab.submit(mac, &[signer], grant(d, role, vault(to), samuel, None)).unwrap());
    let bob_write = give(mac, Role::Write, bob);
    let carol_read = give(mac, Role::Read, carol);
    let coop_owner = give(passkey, Role::Owner, coop);
    Todos { coop, space, door, seeds, solar, bob_write, carol_read, coop_owner }
}
