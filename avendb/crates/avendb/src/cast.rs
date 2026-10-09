//! The people, devices, vaults and spaces of the plan's scenarios, on the Lab: Samuel with a passkey, a Mac and
//! an iPhone; Bob, Carol and Dave with a passkey and a Mac each; the relay server and a stranger. The scenarios
//! (`scenarios`) and the tests start from them, and so does the avenDB tile, which makes the world a step at a time
//! (`Making`) so that a page makes the McEliece pairs of each step in its workers before the next step needs them.
//! `avendb/spec/AvenDB/Examples.lean` has the same cast on the Lean model.

use crate::doc::Item;
use crate::id::{EntryId, GrantId, SignerId, SpaceId, VaultId};
use crate::lab::Lab;
use crate::lens::{BlockV1, BlockV2, DocV1, KindV1, Status, TypeV2};
use crate::policy::{Action, Branch, Grant, Grantee, Kind, Principal, Role, Scope};

pub fn vault(v: VaultId) -> Grantee {
    Grantee::Principal(Principal::Vault(v))
}

pub fn grant(scope: Scope, role: Role, grantee: Grantee, issuer: VaultId, parent: Option<GrantId>) -> Action {
    Action::Grant(Grant { scope, role, grantee, issuer, parent }, vec![])
}

/// A write that builds on its entry's heads: the log fills in `deps` when it drafts the op.
pub fn write(space: SpaceId, entry: EntryId, actor: VaultId, epoch: u64) -> Action {
    Action::Write { space, entry, actor, epoch, deps: vec![], branch: Branch::Main, via: vec![], body: vec![0xc1, 0x9e, 0x47] }
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
    let genesis = Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(passkey)],
        threshold: 1,
        root: Some(passkey),
        nonce: 0,
        seal_to: vec![],
    };
    let v = VaultId::from(lab.submit(devices[0], &[passkey], genesis).expect("a passkey founds its vault"));
    for &d in devices {
        let add = Action::AddDevice { vault: v, device: d, seal_to: None };
        lab.submit(devices[0], &[passkey, d], add).expect("the passkey adds its device");
    }
    v
}

/// Each person's devices derive their keys from their passkey; the server and the stranger have keys of their own.
pub fn world() -> World {
    let mut making = Making::new();
    while making.step().is_some() {}
    making.world()
}

/// The world made a step at a time: every signer first, whose McEliece pairs a page then makes in its workers, then
/// the server's vault, the people's vaults, and the contact cards they exchange.
pub struct Making {
    lab: Lab,
    /// Each person's passkey and devices, then the server and the stranger.
    signers: Vec<SignerId>,
    /// The server's vault, then Samuel's, Bob's, Carol's and Dave's.
    vaults: Vec<VaultId>,
    done: usize,
}

impl Default for Making {
    fn default() -> Making {
        Making::new()
    }
}

impl Making {
    /// How many steps make the world.
    pub const STEPS: usize = 5;

    pub fn new() -> Making {
        Making { lab: Lab::new(), signers: vec![], vaults: vec![], done: 0 }
    }

    /// The Lab as far as it is made.
    pub fn lab(&self) -> &Lab {
        &self.lab
    }

    /// Make the next part of the world: what it made, or `None` once the world is whole.
    pub fn step(&mut self) -> Option<&'static str> {
        let lab = &mut self.lab;
        let made = match self.done {
            0 => {
                let people: [(&str, &[&str]); 4] = [
                    ("Samuel", &["Samuel's Mac", "Samuel's iPhone"]),
                    ("Bob", &["Bob's Mac"]),
                    ("Carol", &["Carol's Mac"]),
                    ("Dave", &["Dave's Mac"]),
                ];
                for (person, devices) in people {
                    let passkey = lab.passkey(person);
                    self.signers.push(passkey);
                    for d in devices {
                        self.signers.push(lab.device_of(passkey, d));
                    }
                }
                self.signers.push(lab.server_signers().0);
                self.signers.push(lab.device("a stranger"));
                "every passkey and device, and their keys"
            }
            1 => {
                self.vaults.push(lab.server().1);
                "the server's vault"
            }
            2 => {
                let s = &self.signers;
                self.vaults.push(human_on(lab, s[0], &[s[1], s[2]]));
                "Samuel's vault, with the Mac and the iPhone"
            }
            3 => {
                let s = &self.signers;
                for (passkey, mac) in [(s[3], s[4]), (s[5], s[6]), (s[7], s[8])] {
                    self.vaults.push(human_on(lab, passkey, &[mac]));
                }
                "Bob's, Carol's and Dave's vaults"
            }
            4 => {
                // they all know each other's vaults and the server's, as after exchanging contact cards; Samuel's
                // iPhone holds the same contacts as Samuel's Mac
                let (s, v) = (&self.signers, &self.vaults);
                let macs = [(s[1], v[1]), (s[2], v[1]), (s[4], v[2]), (s[6], v[3]), (s[8], v[4]), (s[9], v[0])];
                for &(from, v) in &macs {
                    for &(to, _) in &macs {
                        if from != to {
                            lab.share_contact(from, to, v);
                        }
                    }
                }
                "contact cards between them"
            }
            _ => return None,
        };
        self.done += 1;
        Some(made)
    }

    /// The world once every step is made.
    pub fn world(self) -> World {
        assert_eq!(self.done, Making::STEPS, "a world made whole");
        let (s, v) = (self.signers, self.vaults);
        World {
            lab: self.lab,
            passkey_s: s[0],
            mac_s: s[1],
            phone_s: s[2],
            passkey_b: s[3],
            mac_b: s[4],
            passkey_c: s[5],
            mac_c: s[6],
            passkey_d: s[7],
            mac_d: s[8],
            server: s[9],
            server_vault: v[0],
            stranger: s[10],
            samuel: v[1],
            bob: v[2],
            carol: v[3],
            dave: v[4],
        }
    }
}

/// Scenario 3 on the Lab: Maia Coop, owned by Samuel and Bob with threshold 2; Bob's passkey consents.
pub fn coop_on(w: &mut World) -> VaultId {
    let owners = vec![Principal::Vault(w.samuel), Principal::Vault(w.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    VaultId::from(w.lab.submit(w.mac_s, &[w.passkey_s, w.passkey_b], genesis).expect("Samuel and Bob found the coop"))
}

/// Found a space on Samuel's Mac for `actor`, and give the server relay on it.
pub fn space_on(w: &mut World, actor: VaultId) -> SpaceId {
    let found = w.lab.submit(w.mac_s, &[w.mac_s], Action::FoundSpace { actor, nonce: 0, via: vec![] });
    let sp = SpaceId::from(found.expect("Samuel's Mac founds a space"));
    let relay = grant(Scope::Space(sp), Role::Relay, vault(w.server_vault), actor, None);
    w.lab.submit(w.mac_s, &[w.mac_s], relay).expect("the founder gives the server relay");
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

/// Scenarios 3 and 4 on the Lab: the coop, its Handbook and Samuel's Notes, every device synced, and nothing written
/// yet: where devices split off to run on their own (`Lab::split`) before Samuel writes over the network (P8).
pub fn handbook_spaces(w: &mut World) -> (VaultId, SpaceId, SpaceId) {
    let coop = coop_on(w);
    let space = space_on(w, coop);
    let samuel = w.samuel;
    let notes = space_on(w, samuel);
    w.lab.sync_all(0);
    (coop, space, notes)
}

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
    let welcome = w.lab.create(w.mac_s, coop, space, document_v1("Welcome", WELCOME_TEXT, w.mac_s)).expect("Welcome");
    let onboarding = document("Onboarding", ONBOARDING_TEXT, w.mac_s);
    let onboarding = w.lab.create(w.mac_s, coop, space, onboarding).expect("Onboarding");
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
    todos_in(w, coop)
}

/// Samuel's Todos as `todos_on` makes them, for a coop that is there already.
pub fn todos_in(w: &mut World, coop: VaultId) -> Todos {
    let samuel = w.samuel;
    let space = space_on(w, samuel);
    let mut new = |title: &str| w.lab.create(w.mac_s, samuel, space, Item::todo(title, w.mac_s)).expect("a todo");
    let door = new("Fix the greenhouse door");
    let seeds = new("Order seeds");
    let solar = new("Clean the solar panels");
    let d = Scope::Entry(space, door);
    let (bob, carol, mac, passkey) = (w.bob, w.carol, w.mac_s, w.passkey_s);
    let mut give = |signer, role, to| {
        let shared = w.lab.submit(mac, &[signer], grant(d, role, vault(to), samuel, None));
        GrantId::from(shared.expect("Samuel shares the door"))
    };
    let bob_write = give(mac, Role::Write, bob);
    let carol_read = give(mac, Role::Read, carol);
    let coop_owner = give(passkey, Role::Owner, coop);
    Todos { coop, space, door, seeds, solar, bob_write, carol_read, coop_owner }
}
