//! The tile's world, as it is made and named, and the rules of thumb its views and actions share: which vault a device
//! acts for, and which passkeys approve for a vault.

use std::collections::{HashMap, HashSet};

use serde_json::{json, Value};
use wasm_bindgen::prelude::*;

use avendb::cast::{self, Making, World};
use avendb::id::{BlobId, EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use avendb::keys::{KeyName, KeyScope};
use avendb::lab::{Backup, Lab};
use avendb::lens::{DOCUMENT_LENS, DOCUMENT_V1, DOCUMENT_V2, TODO_LENS, TODO_V1, TODO_V2};
use avendb::policy::{Action, Grant, Grantee, Kind, Principal, Role, Scope, State};

/// The avenDB tile's world: the scenarios' people, devices and vaults (`avendb::cast`), and in it Maia Coop with its
/// Handbook, Alice's Notes and Alice's Todos, made a step at a time; then read through views and changed through
/// actions, each on the device the page picks.
#[wasm_bindgen]
pub struct Tile {
    pub(crate) making: Option<Making>,
    pub(crate) world: Option<World>,
    /// The tile's own steps taken once the world is made.
    steps: usize,
    pub(crate) demo: Option<Demo>,
    pub(crate) vault_names: HashMap<VaultId, String>,
    pub(crate) space_names: HashMap<SpaceId, String>,
    /// Every signer the tile made, in order, and the passkeys among them.
    pub(crate) signers: Vec<SignerId>,
    pub(crate) passkeys: HashSet<SignerId>,
    /// When each op was made, by the page's clock: milliseconds since 1970.
    pub(crate) made_at: HashMap<OpId, f64>,
    pub(crate) backups: HashMap<SignerId, Backup>,
    /// Counts what the tile founds and syncs, so each founding is an op of its own and each sync takes another order.
    pub(crate) counter: u64,
}

/// What the tile writes into the world, for the page to open first.
pub(crate) struct Demo {
    pub coop: VaultId,
    pub handbook: SpaceId,
    pub notes: SpaceId,
    pub todos: SpaceId,
    pub welcome: EntryId,
    pub door: EntryId,
}

/// The tile's own steps, once the world is made.
const STEPS: [&str; 3] = [
    "Maia Coop, its Handbook and Alice's Notes, with Welcome and Onboarding",
    "Alice's Todos, the door shared with Bob, Carol and the coop",
    "each space's schemas, a public Charter and a note",
];

impl Default for Tile {
    fn default() -> Tile {
        Tile::new()
    }
}

#[wasm_bindgen]
impl Tile {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Tile {
        Tile {
            making: Some(Making::new()),
            world: None,
            steps: 0,
            demo: None,
            vault_names: HashMap::new(),
            space_names: HashMap::new(),
            signers: vec![],
            passkeys: HashSet::new(),
            made_at: HashMap::new(),
            backups: HashMap::new(),
            counter: 0,
        }
    }

    /// Make the next part of the world, `now` being the page's clock: what it made, or `None` once all is made. The
    /// McEliece pairs each step wants are best handed in before the next.
    pub fn build_step(&mut self, now: f64) -> Option<String> {
        if let Some(making) = &mut self.making {
            if let Some(made) = making.step() {
                self.stamp(now);
                return Some(made.into());
            }
            let world = self.making.take().expect("the world being made").world();
            self.name_world(world);
        }
        let w = self.world.as_mut()?;
        match self.steps {
            0 => {
                let h = cast::handbook(w);
                self.vault_names.insert(h.coop, "Maia Coop".into());
                self.space_names.insert(h.space, "Handbook".into());
                self.space_names.insert(h.notes, "Alice's Notes".into());
                let (handbook, notes, welcome) = (h.space, h.notes, h.welcome);
                let (todos, door) = (SpaceId([0; 32]), EntryId([0; 32]));
                self.demo = Some(Demo { coop: h.coop, handbook, notes, todos, welcome, door });
            }
            1 => {
                let demo = self.demo.as_mut().expect("the Handbook");
                let t = cast::todos_in(w, demo.coop);
                (demo.todos, demo.door) = (t.space, t.door);
                self.space_names.insert(t.space, "Alice's Todos".into());
            }
            2 => {
                let demo = self.demo.as_ref().expect("the Todos");
                let (mac, coop, alice) = (w.mac_a, demo.coop, w.alice);
                let lanes: [(SpaceId, VaultId, &[&[u8]]); 3] = [
                    (demo.handbook, coop, &[DOCUMENT_V1.bytes(), DOCUMENT_V2.bytes(), DOCUMENT_LENS.bytes()]),
                    (demo.todos, alice, &[TODO_V1.bytes(), TODO_V2.bytes(), TODO_LENS.bytes()]),
                    (demo.notes, alice, &[DOCUMENT_V2.bytes()]),
                ];
                for (space, actor, blobs) in lanes {
                    for blob in blobs {
                        let publish = Action::Publish { space, actor, via: vec![], blob: blob.to_vec() };
                        w.lab.submit(mac, &[mac], publish).expect("an owner publishes its schemas");
                    }
                }
                let charter = cast::document("Charter", cast::CHARTER_TEXT, mac);
                let charter = w.lab.create(mac, coop, demo.handbook, charter).expect("the coop writes its Charter");
                let public = cast::grant(Scope::Entry(demo.handbook, charter), Role::Read, Grantee::Public, coop, None);
                w.lab.submit(mac, &[mac], public).expect("and makes it public");
                let idea = "Plant the beans by the south wall, where the sun comes first.";
                let note = cast::document("Ideas", idea, mac);
                w.lab.create(mac, alice, demo.notes, note).expect("Alice writes a note");
                w.lab.sync_all(0);
                w.lab.sync(w.server, w.stranger);
            }
            _ => return None,
        }
        self.steps += 1;
        self.stamp(now);
        Some(STEPS[self.steps - 1].into())
    }

    /// How many steps `build_step` takes to make the whole world.
    pub fn steps() -> usize {
        Making::STEPS + STEPS.len()
    }

    /// The whole world is made.
    pub fn ready(&self) -> bool {
        self.steps == STEPS.len()
    }
}

impl Tile {
    /// Name the people's human vaults and avenCEO, and note every signer.
    fn name_world(&mut self, w: World) {
        let people = [(w.alice, "Alice"), (w.bob, "Bob"), (w.carol, "Carol"), (w.dave, "Dave")];
        for (v, name) in people.into_iter().chain([(w.avenceo, "avenCEO")]) {
            self.vault_names.insert(v, name.into());
        }
        let passkeys = [w.passkey_a, w.passkey_b, w.passkey_c, w.passkey_d];
        self.passkeys.extend(passkeys);
        self.signers = vec![w.passkey_a, w.mac_a, w.phone_a, w.passkey_b, w.mac_b, w.passkey_c, w.mac_c];
        self.signers.extend([w.passkey_d, w.mac_d, w.server, w.stranger]);
        self.world = Some(w);
    }

    /// Note the page's clock for every op no device held before.
    pub(crate) fn stamp(&mut self, now: f64) {
        let Some(lab) = self.making.as_ref().map(Making::lab).or(self.world.as_ref().map(|w| &w.lab)) else { return };
        let mut new = vec![];
        for &d in lab.devices() {
            new.extend(lab.log(d).ids().iter().filter(|id| !self.made_at.contains_key(id)));
        }
        for id in new {
            self.made_at.insert(id, now);
        }
    }

    pub(crate) fn world(&self) -> Result<&World, String> {
        self.world.as_ref().filter(|_| self.ready()).ok_or_else(|| "The world isn't made yet.".into())
    }

    pub(crate) fn world_mut(&mut self) -> Result<&mut World, String> {
        let ready = self.ready();
        self.world.as_mut().filter(|_| ready).ok_or_else(|| "The world isn't made yet.".into())
    }

    pub(crate) fn lab(&self) -> &Lab {
        &self.world.as_ref().expect("a world made").lab
    }

    pub(crate) fn signer_name(&self, s: SignerId) -> String {
        self.lab().name(s).map_or_else(|| format!("a signer {}", short(&s.0)), str::to_string)
    }

    pub(crate) fn vault_name(&self, v: VaultId) -> String {
        self.vault_names.get(&v).cloned().unwrap_or_else(|| format!("a vault {}", short(&v.0)))
    }

    pub(crate) fn space_name(&self, sp: SpaceId) -> String {
        self.space_names.get(&sp).cloned().unwrap_or_else(|| format!("a space {}", short(&sp.0)))
    }

    pub(crate) fn signer(&self, s: SignerId) -> Value {
        json!({"id": hex(&s.0), "name": self.signer_name(s)})
    }

    pub(crate) fn vault(&self, v: VaultId) -> Value {
        json!({"id": hex(&v.0), "name": self.vault_name(v)})
    }

    pub(crate) fn principal(&self, p: Principal) -> Value {
        match p {
            Principal::Signer(s) => json!({"kind": "signer", "id": hex(&s.0), "name": self.signer_name(s)}),
            Principal::Vault(v) => json!({"kind": "vault", "id": hex(&v.0), "name": self.vault_name(v)}),
        }
    }

    /// A key by what it opens: a signer's own key, or a family's key at an epoch.
    pub(crate) fn key_name(&self, k: KeyName) -> String {
        match k {
            KeyName::Signer(s) => format!("{}'s own key", self.signer_name(s)),
            KeyName::Scoped(KeyScope::Vault(v), e) => format!("{}'s vault key, epoch {e}", self.vault_name(v)),
            KeyName::Scoped(KeyScope::Space(sp), e) => format!("{}'s key, epoch {e}", self.space_name(sp)),
            KeyName::Scoped(KeyScope::Entry(_, en), e) => format!("the key of entry {}, epoch {e}", short(&en.0)),
        }
    }
}

/// The passkeys and owner keys that together approve for `p` by view `st`: a signer itself, a vault's root, or else
/// enough of its owners'. Empty if they don't reach its threshold.
pub(crate) fn approvers(st: &State, p: Principal) -> Vec<SignerId> {
    approvers_n(st, p, 8).unwrap_or_default()
}

fn approvers_n(st: &State, p: Principal, n: usize) -> Option<Vec<SignerId>> {
    match p {
        Principal::Signer(s) => Some(vec![s]),
        Principal::Vault(v) => {
            let vt = st.vault(v).filter(|_| n > 0)?;
            if let Some(root) = vt.root {
                return Some(vec![root]);
            }
            let (mut out, mut approved) = (vec![], 0);
            for &o in &vt.owners {
                if approved == vt.threshold {
                    break;
                }
                if let Some(signers) = approvers_n(st, o, n - 1) {
                    out.extend(signers.into_iter().filter(|s| !out.contains(s)).collect::<Vec<_>>());
                    approved += 1;
                }
            }
            (approved >= vt.threshold).then_some(out)
        }
    }
}

/// The vault device `d` acts for that holds `need` or more on `sc`, a person's own vault before a coop: whoever
/// writes, shares or publishes there acts for it. Failing that, any vault it acts for, or the space's founder, so the
/// rules refuse it with their own reason.
pub(crate) fn acting(st: &State, d: SignerId, sc: Scope, need: Role) -> VaultId {
    let mine: Vec<&avendb::policy::Vault> = st.vaults().iter().filter(|v| st.acts_for(d, v.id)).collect();
    let human_first = mine.iter().filter(|v| v.kind == Kind::Human).chain(mine.iter().filter(|v| v.kind == Kind::Coop));
    let holding = human_first.clone().find(|v| st.holds(v.id, sc, need)).map(|v| v.id);
    holding
        .or_else(|| human_first.clone().next().map(|v| v.id))
        .or_else(|| st.founder(sc.space()))
        .unwrap_or(VaultId([0; 32]))
}

/// The best role a vault device `d` acts for holds on `sc`, and that vault: a person's own vault first.
pub(crate) fn role_on(st: &State, d: SignerId, sc: Scope) -> Option<(Role, VaultId)> {
    let mut best: Option<(Role, VaultId)> = None;
    for v in st.vaults().iter().filter(|v| st.acts_for(d, v.id)) {
        let held = [Role::Owner, Role::Write, Role::Read, Role::Relay].into_iter().find(|&r| st.holds(v.id, sc, r));
        if let Some(r) = held
            && best.is_none_or(|(b, _)| r > b)
        {
            best = Some((r, v.id));
        }
    }
    best
}

/// The vault device `d` grants on `sc` as, and the grant its right comes from: the space's founder needs none.
pub(crate) fn granting(st: &State, d: SignerId, sc: Scope) -> Option<(VaultId, Option<GrantId>)> {
    let mine: Vec<VaultId> = st.vaults().iter().filter(|v| st.acts_for(d, v.id)).map(|v| v.id).collect();
    if let Some(f) = st.founder(sc.space()).filter(|f| mine.contains(f)) {
        return Some((f, None));
    }
    st.grants().into_iter().find_map(|(id, g)| match g.grantee {
        Grantee::Principal(Principal::Vault(v)) if mine.contains(&v) && g.role == Role::Owner && g.scope.covers(sc) => {
            Some((v, Some(id)))
        }
        _ => None,
    })
}

/// The vault device `d` revokes grant `g` as: its issuer, its space's founder, or the issuer of a grant it rests on.
pub(crate) fn revoking(st: &State, d: SignerId, g: &Grant) -> Option<VaultId> {
    let mut chain = vec![g.issuer];
    let mut at = g.parent;
    while let Some(p) = at.and_then(|p| st.grant(p)).filter(|_| chain.len() < 64) {
        chain.push(p.issuer);
        at = p.parent;
    }
    chain.extend(st.founder(g.scope.space()));
    chain.into_iter().find(|&v| st.acts_for(d, v))
}

/// The person's vault device `d` is a device of, by its own view.
pub(crate) fn person_of(st: &State, d: SignerId) -> Option<VaultId> {
    st.vaults().iter().find(|v| v.kind == Kind::Human && v.devices.contains(&d)).map(|v| v.id)
}

pub(crate) fn role_name(r: Role) -> &'static str {
    match r {
        Role::Relay => "relay",
        Role::Read => "read",
        Role::Write => "write",
        Role::Owner => "owner",
    }
}

pub(crate) fn role_named(s: &str) -> Option<Role> {
    [Role::Relay, Role::Read, Role::Write, Role::Owner].into_iter().find(|&r| role_name(r) == s)
}

/// 32 bytes as 64 lowercase hex digits: every id the page sees.
pub fn hex(b: &[u8; 32]) -> String {
    BlobId(*b).to_hex()
}

/// 64 lowercase hex digits as 32 bytes.
pub fn unhex(s: &str) -> Option<[u8; 32]> {
    BlobId::from_hex(s).map(|b| b.0)
}

/// The first four bytes, as a person reads an id aloud.
pub(crate) fn short(b: &[u8; 32]) -> String {
    hex(b)[..8].to_string()
}

/// A signer's fingerprint, to compare on two screens: its first eight bytes, in four groups.
pub(crate) fn fingerprint(s: SignerId) -> String {
    let h = hex(&s.0);
    [&h[0..4], &h[4..8], &h[8..12], &h[12..16]].join(" ")
}
