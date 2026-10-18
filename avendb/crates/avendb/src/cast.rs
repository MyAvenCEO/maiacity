//! The people, devices and vaults of the plan's scenarios, on the Lab: Alice with a passkey, a Mac and an iPhone; Bob,
//! Carol and Dave with a passkey and a Mac each; the relay server and a stranger. Alice's vault is the first to claim
//! the server: the server is a device of avenMAIA, the aven at the end of the seed Alice's vault founds
//! (`world::SEED`), which Maia City owns, which her vault owns. The scenarios
//! (`scenarios`) and the tests start from them, and so does a page's Lab, which makes the world a step at a time
//! (`Making`) so that it makes the McEliece pairs of each step in its workers before the next step needs them.
//! `avendb/spec/AvenDB/Examples.lean` has the same cast on the Lean model.
//!
//! A vault holds its entries itself, each with a type (`doc`, `note`, `todo`) and tags; the coop's documents are in the
//! coop's vault, Alice's todos and notes in hers. A vault that wants the server to hold and pass on its entries gives
//! avenMAIA a wide relay share (`relay_on`); everything else is shared by shares on slices: a type, a tag, one
//! entry.

use crate::doc::Item;
use crate::id::{EditId, EntryId, ShareId, SignerId, VaultId};
use crate::lab::{Lab, NewShare};
use crate::lens::example::{BlockV0, DocV0, KindV0};
use crate::lens::{BlockV1, Status, TypeV1};
use crate::policy::{Action, KeepMode, Kind, Level, Principal, Proposal, Sharing, Who};
use crate::slice::{Atom, Selector};

/// Vault `v` as a share's grantee.
pub fn vault(v: VaultId) -> Who {
    Who::Vault(v)
}

/// A root share over vault `over`, issued by the vault itself: `who` holds the built-in group of `level`, Public for
/// everyone, on what `select` picks.
pub fn share(over: VaultId, who: Who, level: Level, select: Selector) -> NewShare {
    let name = if who == Who::Everyone { "Public" } else { level.group() };
    NewShare { over, who, name: name.into(), select, ops: level.ops(), parent: None, issuer: over, keep: None }
}

/// A share over vault `over` resting on the owner share `parent`, issued by its grantee `issuer`.
pub fn share_on(over: VaultId, who: Who, level: Level, select: Selector, parent: ShareId, issuer: VaultId) -> NewShare {
    NewShare { parent: Some(parent), issuer, ..share(over, who, level, select) }
}

/// A keep share of vault `issuer` to its device `device`, over vault `over`: the device syncs what `select` picks the
/// way `mode` says, by the built-in name of its mode.
pub fn keep(issuer: VaultId, device: SignerId, over: VaultId, mode: KeepMode, select: Selector) -> NewShare {
    let (who, name) = (Who::Device(device), Level::Keep(mode).group().into());
    NewShare { over, who, name, select, ops: vec![], parent: None, issuer, keep: Some(mode) }
}

/// The entries of type `ty`: "all todos".
pub fn of_type(ty: &str) -> Selector {
    Selector::AnyOf(vec![vec![Atom::TypeIn(vec![ty.into()])]])
}

/// The entries of type `ty` tagged `tag`: "the todos tagged work".
pub fn tagged(ty: &str, tag: &str) -> Selector {
    Selector::AnyOf(vec![vec![Atom::TypeIn(vec![ty.into()]), Atom::TagHas(tag.into())]])
}

/// One entry, by its id.
pub fn by_id(e: EntryId) -> Selector {
    Selector::AnyOf(vec![vec![Atom::EntryIn(vec![e])]])
}

/// A write of entry `entry` of vault `vault` for `actor`, under the entry's stay `stay` at epoch `epoch`,
/// with a body nobody opens: what a patched app sends. The log fills in `deps` and `via` as it drafts the edit.
pub fn write(vault: VaultId, entry: EntryId, actor: VaultId, stay: Option<EditId>, epoch: u64) -> Action {
    let body = vec![0xc1, 0x9e, 0x47];
    let (proposal, files) = (Proposal::Main, vec![]);
    Action::Write { vault, entry, actor, stay, epoch, deps: vec![], proposal, via: vec![], create: None, files, body }
}

/// The Lab after scenarios 1 and 2, plus the server, avenMAIA and a stranger.
pub struct World {
    pub lab: Lab,
    pub passkey_a: SignerId,
    pub mac_a: SignerId,
    pub phone_a: SignerId,
    pub passkey_b: SignerId,
    pub mac_b: SignerId,
    pub passkey_c: SignerId,
    pub mac_c: SignerId,
    pub passkey_d: SignerId,
    pub mac_d: SignerId,
    pub server: SignerId,
    /// avenMAIA, the aven the server is a device of, at the end of the seed Alice's vault founds.
    pub avenceo: VaultId,
    pub stranger: SignerId,
    pub alice: VaultId,
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
        let add = Action::Share(Sharing::Device { vault: v, device: d, seal_to: None });
        lab.submit(devices[0], &[passkey, d], add).expect("the passkey adds its device");
    }
    v
}

/// The server claimed by human vault `human`, the first to (`Lab::claim`, P8f), its passkey `passkey` signing on its
/// device `on`: the server hands its key to seal to, the passkey founds the seed (`world::SEED`), Maia City, a coop
/// `human` owns, and avenMAIA, the aven Maia City owns, and
/// adds the server as its device; the server signs last and keeps it all, `on` keeps the server's join, and syncs the
/// server the key it boxed for it. avenMAIA.
pub fn claim_on(lab: &mut Lab, on: SignerId, passkey: SignerId, human: VaultId, server: SignerId) -> VaultId {
    let key = lab.claim_key(server).expect("a server nobody has claimed hands its key");
    let mut avenceo = human;
    for kind in crate::world::SEED {
        let owners = vec![Principal::Vault(avenceo)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
        avenceo = VaultId::from(lab.submit(on, &[passkey], genesis).expect("the passkey founds the seed"));
    }
    let add = Action::Share(Sharing::Device { vault: avenceo, device: server, seal_to: Some(key) });
    let draft = lab.draft(on, &[passkey, server], add).expect("avenMAIA adds the server");
    let claim = lab.claim(on, draft, &[]).expect("the passkey signs the claim");
    let join = lab.accept_claim(server, claim).expect("the server takes the claim");
    lab.receive(on, vec![join.edit], join.blobs.into_iter().map(Into::into).collect());
    lab.sync(on, server);
    avenceo
}

/// Each person's devices derive their keys from their passkey; the server and the stranger have keys of their own.
pub fn world() -> World {
    let mut making = Making::new();
    while making.step().is_some() {}
    making.world()
}

/// The world made a step at a time: every signer first, whose McEliece pairs a page then makes in its workers, then
/// Alice's vault, avenMAIA as Alice's vault claims the server, the other people's vaults, and the contact cards
/// they exchange.
pub struct Making {
    lab: Lab,
    /// Each person's passkey and devices, then the server and the stranger.
    signers: Vec<SignerId>,
    /// Alice's vault, avenMAIA, then Bob's, Carol's and Dave's.
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
                    ("Alice", &["Alice's Mac", "Alice's iPhone"]),
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
                self.signers.push(lab.device("the server"));
                self.signers.push(lab.device("a stranger"));
                "every passkey and device, and their keys"
            }
            1 => {
                let s = &self.signers;
                self.vaults.push(human_on(lab, s[0], &[s[1], s[2]]));
                "Alice's vault, with the Mac and the iPhone"
            }
            2 => {
                let (s, v) = (&self.signers, &self.vaults);
                let avenceo = claim_on(lab, s[1], s[0], v[0], s[9]);
                self.vaults.push(avenceo);
                "avenMAIA, the end of the seed Alice's vault founds as it claims the server"
            }
            3 => {
                let s = &self.signers;
                for (passkey, mac) in [(s[3], s[4]), (s[5], s[6]), (s[7], s[8])] {
                    self.vaults.push(human_on(lab, passkey, &[mac]));
                }
                "Bob's, Carol's and Dave's vaults"
            }
            4 => {
                // they all know each other's vaults and avenMAIA, as after exchanging contact cards; Alice's
                // iPhone holds the same contacts as Alice's Mac
                let (s, v) = (&self.signers, &self.vaults);
                let macs = [(s[1], v[0]), (s[2], v[0]), (s[4], v[2]), (s[6], v[3]), (s[8], v[4]), (s[9], v[1])];
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
            passkey_a: s[0],
            mac_a: s[1],
            phone_a: s[2],
            passkey_b: s[3],
            mac_b: s[4],
            passkey_c: s[5],
            mac_c: s[6],
            passkey_d: s[7],
            mac_d: s[8],
            server: s[9],
            avenceo: v[1],
            stranger: s[10],
            alice: v[0],
            bob: v[2],
            carol: v[3],
            dave: v[4],
        }
    }
}

/// Scenario 3 on the Lab: Maia Coop, owned by Alice and Bob with threshold 2; Bob's passkey consents.
pub fn coop_on(w: &mut World) -> VaultId {
    let owners = vec![Principal::Vault(w.alice), Principal::Vault(w.bob)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 2, root: None, nonce: 0, seal_to: vec![] };
    VaultId::from(w.lab.submit(w.mac_a, &[w.passkey_a, w.passkey_b], genesis).expect("Alice and Bob found the coop"))
}

/// Vault `v` gives avenMAIA relay on all its entries, on Alice's Mac, for the server to hold and pass them on: a
/// wide share, which reaches every audience and splits none.
pub fn relay_on(w: &mut World, v: VaultId) -> ShareId {
    let relay = share(v, vault(w.avenceo), Level::Backup, Selector::All);
    w.lab.issue(w.mac_a, &[w.mac_a], relay).expect("the vault gives the server relay")
}

pub fn paragraph(id: u64, text: &str) -> BlockV1 {
    BlockV1 { id, r#type: TypeV1::Paragraph, level: None, checked: None, lang: None, text: text.into() }
}

pub fn heading(id: u64, text: &str) -> BlockV1 {
    BlockV1 { id, r#type: TypeV1::Heading, level: Some(1), checked: None, lang: None, text: text.into() }
}

/// A markdown document made on `signer`'s device: a heading (block 1) and one paragraph (block 2).
pub fn document(title: &str, body: &str, signer: SignerId) -> Item {
    let mut item = Item::document(title, signer);
    item.push_block(heading(1, title));
    item.push_block(paragraph(2, body));
    item
}

/// The same document as an app of the lens engine's example on v0 writes it (`lens::example`): a vault takes it only
/// with the example in its lane.
pub fn document_v0(title: &str, body: &str, signer: SignerId) -> Item {
    let block = |id, kind, text: &str| BlockV0 { id, kind, text: text.into() };
    let blocks = vec![block(1, KindV0::H1, title), block(2, KindV0::P, body)];
    Item::written_v0(&DocV0 { title: title.into(), blocks }, signer)
}

/// The text of block `id` of entry `e` as device `d` shows it.
pub fn text(lab: &Lab, d: SignerId, e: EntryId, id: u64) -> Option<String> {
    let doc = lab.item(d, e)?.as_document()?;
    doc.blocks.into_iter().find(|b| b.id == id).map(|b| b.text)
}

pub fn status(lab: &Lab, d: SignerId, e: EntryId) -> Option<Status> {
    Some(lab.item(d, e)?.as_todo()?.status)
}

/// Whether `haystack` holds `needle` anywhere.
pub fn contains(haystack: &[u8], needle: &str) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle.as_bytes())
}

pub const WELCOME_TEXT: &str = "Welcome to Maia Coop: the greenhouse opens at eight.";
pub const ONBOARDING_TEXT: &str = "Onboarding: your first week, step by step.";
pub const CHARTER_TEXT: &str = "Our charter: one vault per person, and the data stays theirs.";
pub const AFTER_TEXT: &str = "Edited after the change: the greenhouse opens at nine.";

/// Scenarios 3 and 4 on the Lab: the coop, which gives the server relay on its entries, every device synced, and
/// nothing written yet: where devices split off to run on their own (`Lab::split`) before Alice writes over the
/// network (P8).
pub fn handbook_ready(w: &mut World) -> VaultId {
    let coop = coop_on(w);
    relay_on(w, coop);
    w.lab.sync_all(0);
    coop
}

/// Scenarios 3 to 5 on the Lab: the coop, its documents Welcome and Onboarding written by Alice for the coop, and every
/// device synced. No share selects either: they are in the audience of no shares, which the coop's devices read and the
/// server relays.
pub struct Handbook {
    pub coop: VaultId,
    pub welcome: EntryId,
    pub onboarding: EntryId,
}

pub fn handbook(w: &mut World) -> Handbook {
    let coop = coop_on(w);
    relay_on(w, coop);
    let welcome = document("Welcome", WELCOME_TEXT, w.mac_a);
    let welcome = w.lab.create(w.mac_a, coop, coop, "doc", &[], welcome).expect("Welcome");
    let onboarding = document("Onboarding", ONBOARDING_TEXT, w.mac_a);
    let onboarding = w.lab.create(w.mac_a, coop, coop, "doc", &[], onboarding).expect("Onboarding");
    w.lab.sync_all(0);
    Handbook { coop, welcome, onboarding }
}

/// Scenario 15 on the Lab: three of Alice's todos in her vault, the door todo shared by its id with Bob (write), Carol
/// (read) and the coop (owner, signed with Alice's passkey), and moved by Alice's Mac into the audience of those
/// shares. Nothing synced yet.
pub struct Todos {
    pub coop: VaultId,
    pub door: EntryId,
    pub seeds: EntryId,
    pub solar: EntryId,
    pub bob_write: ShareId,
    pub carol_read: ShareId,
    pub coop_owner: ShareId,
}

pub fn todos_on(w: &mut World) -> Todos {
    let coop = coop_on(w);
    todos_in(w, coop)
}

/// Alice's todos as `todos_on` makes them, for a coop that is there already.
pub fn todos_in(w: &mut World, coop: VaultId) -> Todos {
    let alice = w.alice;
    relay_on(w, alice);
    let mac = w.mac_a;
    let mut new = |title: &str, tag: &str| {
        w.lab.create(mac, alice, alice, "todo", &[tag], Item::todo(title, mac)).expect("a todo")
    };
    let door = new("Fix the greenhouse door", "work");
    let seeds = new("Order seeds", "home");
    let solar = new("Clean the solar panels", "work");
    let passkey = w.passkey_a;
    let mut give = |signer, level, to| {
        let shared = w.lab.issue(mac, &[signer], share(alice, vault(to), level, by_id(door)));
        shared.expect("Alice shares the door")
    };
    let bob_write = give(mac, Level::Write, w.bob);
    let carol_read = give(mac, Level::Read, w.carol);
    let coop_owner = give(passkey, Level::Owner, coop);
    Todos { coop, door, seeds, solar, bob_write, carol_read, coop_owner }
}

/// Alice's library, as the Lean model's slices start from it: three todos, the door and the solar panels tagged work
/// and the seeds home, and two notes, the plan tagged work and her diary, all in her vault, which gives the server
/// relay on them. No other share selects any of them yet. Nothing synced yet.
pub struct Library {
    pub door: EntryId,
    pub seeds: EntryId,
    pub solar: EntryId,
    pub plan: EntryId,
    pub diary: EntryId,
}

impl Library {
    /// Every entry, in the order Alice made them.
    pub fn all(&self) -> [EntryId; 5] {
        [self.door, self.seeds, self.solar, self.plan, self.diary]
    }
}

pub fn library(w: &mut World) -> Library {
    let alice = w.alice;
    relay_on(w, alice);
    let mac = w.mac_a;
    let mut todo = |title: &str, tag: &str| {
        w.lab.create(mac, alice, alice, "todo", &[tag], Item::todo(title, mac)).expect("a todo")
    };
    let door = todo("Fix the greenhouse door", "work");
    let seeds = todo("Order seeds", "home");
    let solar = todo("Clean the solar panels", "work");
    let mut note = |title: &str, body: &str, tags: &[&str]| {
        w.lab.create(mac, alice, alice, "note", tags, document(title, body, mac)).expect("a note")
    };
    let plan = note("Plan", "The greenhouse plan for spring.", &["work"]);
    let diary = note("Diary", "Dear diary: the seedlings are up.", &[]);
    Library { door, seeds, solar, plan, diary }
}
