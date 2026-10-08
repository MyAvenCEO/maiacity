//! The Lab: in-process devices on a network the test controls. Each device has its own keys, its own ops and its own
//! store, exactly what a real device would hold; there is also a relay server, whose vault holds relay caps and never
//! read, and any number of strangers. The scenario tests run on it, and so will the Database tile's Lab screen.
//!
//! It grows with the phases: devices and their ops in P1, caps and sync by caps in P2, keys, reading and the blind
//! server in P3, apps on a schema reading and editing items through their space's lane in P4, branches in P5, and in
//! P6 offline devices and random delivery orders.
//!
//! Every device keeps its keys up to date as an honest app would, each time its ops change: it opens every box its
//! standing `Keys` ops hold for a key it has, and for each family it may open, it makes the key of each epoch from its
//! oldest to the current one if nobody has yet, seals each current key it holds to every target the schedule names
//! that has no box yet, publishes it if the family is public, and wraps each older key it holds under the next
//! epoch's key if nobody has yet. An owner key (a passkey, a recovery code, the server's owner key) authoring an op on
//! a device lends it, for that ceremony only, the key that is sealed to the owner: that is how a new device reads
//! again after every other device is lost.

use std::collections::{BTreeMap, HashMap};

use crate::doc::{Item, Version};
use crate::encode::{self, box_info, write_context};
use crate::id::{EntryId, OpId, SignerId, SpaceId, VaultId};
use crate::keys::{self, KeyBox, KeyId, KeyName, KeyScope, PublicKey, Recipient, SeededRng, Secret};
use crate::lens::{Lane, Schema};
use rand_core::Rng as _;
use serde_json::Value;
use crate::policy::{replay, Action, Kind, Log, Op, Principal, Refusal, Replay, State};
use crate::sign::{DeviceKey, Passkey, RecoveryCode, Signature, Signed};
use crate::sync::{respond, vault_logs};

/// What the Lab's keys derive from: the Lab is deterministic, so a failing test replays exactly.
const LAB_KEY: &str = "maiacity vault-db 2026-10-08 lab key v1";

/// A device keeps its keys up to date in a few rounds at most: one to make and seal keys, one to seal newer keys to
/// the keys it just made, one to find nothing left. More means an op the rules refuse, made again and again.
const ROUNDS: usize = 6;

/// A tampering attempt, delivered to a device to show that it is rejected or opens nothing.
#[derive(Clone, Debug)]
pub enum Tamper {
    /// An op the rules refuse, properly signed by `signers` and sent anyway: no cap, or a made-up chain.
    Unchecked { signers: Vec<SignerId>, action: Action },
    /// An op claiming a signature from a signer that didn't sign it.
    ForgedSignature { claimed: SignerId, action: Action },
    /// An accepted write with one byte of its ciphertext changed.
    ChangedCiphertext(OpId),
    /// A key from before a revocation, sealed again to the revoked device and replayed.
    ReplayedSeal { key: KeyName, to: SignerId },
}

/// A signer's private key.
enum Key {
    /// A device, the server's owner key, or a recovery code's signer.
    Ed25519(DeviceKey),
    Passkey(Passkey),
}

impl Key {
    fn sign(&mut self, op: OpId) -> Signature {
        match self {
            Key::Ed25519(k) => k.sign(op),
            Key::Passkey(p) => p.sign(op),
        }
    }

    /// The key that keys are sealed to for this signer.
    fn seal_secret(&self) -> Secret {
        match self {
            Key::Ed25519(k) => k.seal_secret(),
            Key::Passkey(p) => p.seal_secret(),
        }
    }
}

/// A key a device opened: its family, its epoch and its secret.
#[derive(Clone)]
struct Opened {
    key: KeyScope,
    epoch: u64,
    secret: Secret,
}

/// What one device holds: its ops, each with its signatures, to pass on; what it makes of them; the keys it opened;
/// and the items it shows.
struct Store {
    log: Log,
    signed: HashMap<OpId, Signed>,
    /// The replay of its ops: which stand, and what it knows.
    replay: Replay,
    /// By id, so the first of a family's keys at an epoch is the one with the smallest id.
    keys: BTreeMap<KeyId, Opened>,
    items: BTreeMap<(SpaceId, EntryId), Item>,
}

impl Default for Store {
    fn default() -> Store {
        Store { log: Log::new(), signed: HashMap::new(), replay: replay(&[]), keys: BTreeMap::new(), items: BTreeMap::new() }
    }
}

impl Store {
    fn view(&self) -> &State {
        &self.replay.state
    }

    /// The keys it holds of family `k` at epoch `e`, the smallest id first.
    fn held(&self, k: KeyScope, e: u64) -> impl Iterator<Item = &Opened> {
        self.keys.values().filter(move |o| o.key == k && o.epoch == e)
    }
}

/// What a device's standing `Keys` ops say: the keys made, the boxes, and what is published.
#[derive(Default)]
struct KeyIndex {
    /// Each key made, by family and epoch, with the public key it is sealed to.
    made: BTreeMap<(KeyScope, u64), Vec<(KeyId, PublicKey)>>,
    /// Each box, after the key it holds.
    boxes: Vec<(KeyScope, u64, KeyId, KeyBox)>,
    /// Each key published in the clear.
    clear: Vec<(KeyScope, u64, KeyId, [u8; 32])>,
}

impl KeyIndex {
    fn of(r: &Replay) -> KeyIndex {
        let mut ix = KeyIndex::default();
        for (op, _) in r.ops.iter().zip(&r.stood).filter(|(_, stood)| **stood) {
            if let Action::Keys { key, epoch, id, public, boxes, clear } = &op.action {
                if let Some(p) = public {
                    ix.made.entry((*key, *epoch)).or_default().push((*id, p.clone()));
                }
                ix.boxes.extend(boxes.iter().map(|b| (*key, *epoch, *id, b.clone())));
                ix.clear.extend(clear.map(|c| (*key, *epoch, *id, c)));
            }
        }
        ix
    }

    /// Key `id` of `k` at `e` has a box for `to`: for a family's key, to any of its keys at that epoch.
    fn boxed(&self, k: KeyScope, e: u64, id: KeyId, to: KeyName) -> bool {
        self.boxes.iter().any(|(bk, be, bid, b)| (*bk, *be, *bid) == (k, e, id) && b.to.name() == to)
    }

    fn cleared(&self, id: KeyId) -> bool {
        self.clear.iter().any(|c| c.2 == id)
    }

    /// Some device made a key of `k` at `e`: it is announced, boxed or wrapped, or something is wrapped under it.
    fn exists(&self, k: KeyScope, e: u64) -> bool {
        self.made.contains_key(&(k, e))
            || self.boxes.iter().any(|(bk, be, _, b)| (*bk, *be) == (k, e) || b.to.name() == KeyName::Scoped(k, e))
    }
}

pub struct Lab {
    keys: HashMap<SignerId, Key>,
    /// Devices in the order they were made.
    devices: Vec<SignerId>,
    stores: HashMap<SignerId, Store>,
    server: Option<(SignerId, VaultId)>,
    /// Keys made so far; each key's seed counts on from here.
    made: u64,
    /// The randomness of new keys, seals and nonces.
    rng: SeededRng,
}

impl Default for Lab {
    fn default() -> Lab {
        Lab::new()
    }
}

impl Lab {
    pub fn new() -> Lab {
        Lab {
            keys: HashMap::new(),
            devices: vec![],
            stores: HashMap::new(),
            server: None,
            made: 0,
            rng: SeededRng::new(LAB_KEY, b"randomness"),
        }
    }

    fn seed(&mut self, what: &str, name: &str) -> blake3::OutputReader {
        self.made += 1;
        let mut h = blake3::Hasher::new_derive_key(LAB_KEY);
        h.update(&self.made.to_be_bytes()).update(what.as_bytes()).update(name.as_bytes());
        h.finalize_xof()
    }

    fn secret(&mut self, what: &str, name: &str) -> [u8; 32] {
        let mut out = [0u8; 32];
        self.seed(what, name).fill(&mut out);
        out
    }

    /// A passkey: an owner signer that governs a human vault. It signs on whichever device it is used on.
    pub fn passkey(&mut self, name: &str) -> SignerId {
        let key = Passkey::from_seed(self.secret("passkey", name));
        let id = key.id();
        self.keys.insert(id, Key::Passkey(key));
        id
    }

    /// A device with its own signing and encryption keys, its own ops and its own store.
    pub fn device(&mut self, name: &str) -> SignerId {
        let key = DeviceKey::from_secret(self.secret("device", name));
        let id = key.id();
        self.keys.insert(id, Key::Ed25519(key));
        self.devices.push(id);
        self.stores.insert(id, Store::default());
        id
    }

    /// The relay server: a device and its vault, which holds relay caps on what it stores and never read. Its vault
    /// is owned by a key of the server's own, kept off the device.
    pub fn server(&mut self) -> (SignerId, VaultId) {
        if let Some(s) = self.server {
            return s;
        }
        let device = self.device("the server");
        let owner = DeviceKey::from_secret(self.secret("server owner", "the server"));
        let owner_id = owner.id();
        self.keys.insert(owner_id, Key::Ed25519(owner));
        let genesis =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(owner_id)], threshold: 1, root: None, nonce: 0, seal_to: vec![] };
        let vault = VaultId::from(self.submit(device, &[owner_id], genesis).expect("the server's vault"));
        self.submit(device, &[owner_id, device], Action::AddDevice { vault, device, seal_to: None }).expect("the server's device");
        self.server = Some((device, vault));
        (device, vault)
    }

    /// A new recovery code, as the app shows it once to write down. Its signer can sign from then on (the code is
    /// at hand); add it to a human vault as an owner to make it a way back in.
    pub fn recovery_code(&mut self) -> RecoveryCode {
        let mut entropy = [0u8; 40];
        self.seed("recovery code", "").fill(&mut entropy);
        let code = RecoveryCode::new(entropy);
        self.use_code(&code);
        code
    }

    /// Type a recovery code in: its signer can sign again.
    pub fn use_code(&mut self, code: &RecoveryCode) -> SignerId {
        let key = code.signer();
        let id = key.id();
        self.keys.insert(id, Key::Ed25519(key));
        id
    }

    /// A signer is lost: its key can't sign anymore, and a lost device's store is gone with it.
    pub fn lose(&mut self, s: SignerId) {
        self.keys.remove(&s);
        self.stores.remove(&s);
        self.devices.retain(|&d| d != s);
    }

    fn held(&self, d: SignerId) -> &Store {
        self.stores.get(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"))
    }

    /// The public key keys are sealed to for signer `s`, if the Lab holds its key.
    fn seal_public(&self, s: SignerId) -> Option<PublicKey> {
        Some(self.keys.get(&s)?.seal_secret().public())
    }

    /// Sign `op` with the key of each of its signers.
    fn sign(&mut self, op: Op) -> Signed {
        let id = op.id();
        let sigs = op
            .sigs()
            .map(|s| self.keys.get_mut(&s).unwrap_or_else(|| panic!("the Lab holds no key for {s:?}")).sign(id))
            .collect();
        Signed { op, sigs }
    }

    /// Device `to` keeps signed ops: each once, and only if every signature checks out. Whether they stand is for its
    /// replay to say. True if any was new.
    fn keep(&mut self, to: SignerId, ops: Vec<Signed>) -> bool {
        let Some(store) = self.stores.get_mut(&to) else { return false };
        let mut new = false;
        for signed in ops {
            let Ok(op) = signed.verify() else { continue };
            let id = op.id();
            if !store.signed.contains_key(&id) {
                store.log.receive([op.clone()]);
                store.signed.insert(id, signed);
                new = true;
            }
        }
        new
    }

    /// Device `to` receives signed ops, and brings its keys and items up to date if any was new.
    fn deliver(&mut self, to: SignerId, ops: Vec<Signed>) {
        if self.keep(to, ops) {
            self.refresh(to, &[]);
        }
    }

    fn signed(&self, d: SignerId, ops: &[Op]) -> Vec<Signed> {
        let store = self.held(d);
        ops.iter().map(|op| store.signed[&op.id()].clone()).collect()
    }

    /// Device `from` hands vault `v`'s log to device `to`, as when two people exchange contact cards: a peer needs a
    /// vault's log before it accepts a grant to that vault.
    pub fn share_contact(&mut self, from: SignerId, to: SignerId, v: VaultId) {
        let store = self.held(from);
        let ops = vault_logs(store.log.ops(), store.view(), vec![v]);
        let signed = self.signed(from, &ops);
        self.deliver(to, signed);
    }

    /// Sign `action` by `signers` and keep it on device `on`, if `on`'s view accepts it. The author, the first signer,
    /// signs on `on`; cosigners sign on their own devices. A signer's key to seal to that the action brings is filled
    /// in when the Lab holds that signer.
    pub fn submit(&mut self, on: SignerId, signers: &[SignerId], mut action: Action) -> Result<OpId, Refusal> {
        let (&author, cosigners) = signers.split_first().expect("an op has an author");
        self.fill_seal_to(&mut action);
        let op = self.held(on).log.check(author, cosigners, action)?;
        let id = op.id();
        let signed = self.sign(op);
        debug_assert!(signed.verify().is_ok());
        // an owner key authoring on this device lends it, for this ceremony, what is sealed to it
        let lent: Vec<(SignerId, Secret)> = match self.keys.get(&author) {
            Some(key) if !self.devices.contains(&author) => vec![(author, key.seal_secret())],
            _ => vec![],
        };
        self.keep(on, vec![signed]);
        self.refresh(on, &lent);
        Ok(id)
    }

    fn fill_seal_to(&self, action: &mut Action) {
        match action {
            Action::Genesis { kind: Kind::Human, owners, seal_to, .. } if seal_to.is_empty() => {
                *seal_to = owners
                    .iter()
                    .filter_map(|p| match *p {
                        Principal::Signer(s) => Some((s, self.seal_public(s)?)),
                        Principal::Vault(_) => None,
                    })
                    .collect();
            }
            Action::AddOwner { owner: Principal::Signer(s), seal_to: to @ None, .. } => *to = self.seal_public(*s),
            Action::AddDevice { device, seal_to: to @ None, .. } => *to = self.seal_public(*device),
            _ => {}
        }
    }

    /// Bring device `d`'s keys and items up to date with its ops, `lent` holding the keys of owners signing on it
    /// right now. Each round replays its ops, opens what it can, and makes the `Keys` ops still missing.
    fn refresh(&mut self, d: SignerId, lent: &[(SignerId, Secret)]) {
        let Some(own) = self.keys.get(&d).map(Key::seal_secret) else { return };
        let mine: Vec<(SignerId, Secret)> = std::iter::once((d, own)).chain(lent.iter().cloned()).collect();
        for round in 0.. {
            let Some(store) = self.stores.get_mut(&d) else { return };
            store.replay = replay(store.log.ops());
            let ix = KeyIndex::of(&store.replay);
            open_keys(&mut store.keys, &ix, &mine);
            let actions = upkeep(d, store, &ix, &mut self.rng);
            if actions.is_empty() {
                show_items(d, store);
                return;
            }
            assert!(round < ROUNDS, "{d:?} keeps making keys ops its own view refuses: {actions:?}");
            for action in actions {
                let op = self.held(d).log.draft(d, &[], action);
                let signed = self.sign(op);
                self.keep(d, vec![signed]);
            }
        }
    }

    /// Create an item in `space` on device `on`, acting for `actor`: its first encrypted write. The item must have
    /// been made on `on`, as its Loro edits carry `on`'s peer.
    pub fn create(&mut self, on: SignerId, actor: VaultId, space: SpaceId, item: Item) -> Result<EntryId, Refusal> {
        let mut id = [0u8; 32];
        self.rng.fill_bytes(&mut id);
        let entry = EntryId(id);
        let draft = Action::Write { space, entry, actor, epoch: 0, deps: vec![], body: vec![] };
        let op = self.held(on).log.check(on, &[], draft)?;
        self.write(on, op, &item.export(&Version::default()));
        Ok(entry)
    }

    /// Edit an item on device `on`, acting for `actor`: the change becomes one encrypted write under the entry's
    /// current key.
    pub fn edit(
        &mut self,
        on: SignerId,
        actor: VaultId,
        space: SpaceId,
        entry: EntryId,
        change: impl FnOnce(&mut Item),
    ) -> Result<OpId, Refusal> {
        let store = self.held(on);
        let epoch = store.view().epoch(KeyScope::Entry(space, entry));
        let draft = Action::Write { space, entry, actor, epoch, deps: vec![], body: vec![] };
        let op = store.log.check(on, &[], draft)?;
        // the item as this device shows it; a copy edits as this device, and the change is what came after
        let mut item = store.items.get(&(space, entry)).cloned().unwrap_or_else(|| Item::new(on));
        let since = item.version();
        change(&mut item);
        Ok(self.write(on, op, &item.export(&since)))
    }

    /// Encrypt `update` into the write `op` under its entry's key at the write's epoch (the first the device holds,
    /// or a new one), bound to the op, then sign and keep it.
    fn write(&mut self, on: SignerId, mut op: Op, update: &[u8]) -> OpId {
        let Action::Write { space, entry, epoch, .. } = op.action else { unreachable!("a write") };
        let k = KeyScope::Entry(space, entry);
        let store = self.stores.get_mut(&on).expect("a device");
        let held = store.held(k, epoch).next().map(|o| o.secret.clone());
        let secret = match held {
            Some(secret) => secret,
            None => {
                let secret = Secret::generate(&mut self.rng);
                store.keys.insert(secret.id(), Opened { key: k, epoch, secret: secret.clone() });
                secret
            }
        };
        let body = keys::seal_edit(&secret, update, &write_context(&op), &mut self.rng);
        if let Action::Write { body: b, .. } = &mut op.action {
            *b = body;
        }
        let id = op.id();
        let signed = self.sign(op);
        self.deliver(on, vec![signed]);
        id
    }

    /// The schemas and lenses published into `space`'s lane, as device `d` holds them.
    pub fn lane(&self, d: SignerId, space: SpaceId) -> Lane {
        Lane::new(self.held(d).view().lane_of(space))
    }

    /// The item as an app on schema `app` shows it on device `d`, through a lens from the space's lane where another
    /// version wrote it, and whether the app opens it read-only (`Lane::view`). `None` if the device shows no such item
    /// or the app reads nothing of it.
    pub fn open(&self, d: SignerId, space: SpaceId, entry: EntryId, app: &Schema) -> Option<(Value, bool)> {
        let item = self.item(d, space, entry)?;
        let (view, read_only) = self.lane(d, space).view(app, &item.authored());
        Some((item.read(&view)?, read_only))
    }

    /// Edit an item as an app on schema `app` on device `on`, acting for `actor`: `change` edits the app's view of the
    /// item, and only what changed becomes one encrypted write, tagged with `app`. `Ok(None)`, writing nothing, if the
    /// view is unchanged; `ReadOnly` if the app opens the item read-only or reads nothing of it; `NotAView` if the
    /// edited view doesn't fit the app's schema.
    pub fn edit_as(
        &mut self,
        on: SignerId,
        actor: VaultId,
        space: SpaceId,
        entry: EntryId,
        app: &Schema,
        change: impl FnOnce(&mut Value),
    ) -> Result<Option<OpId>, Refusal> {
        let item = self.item(on, space, entry).ok_or(Refusal::ReadOnly)?;
        let (view, read_only) = self.lane(on, space).view(app, &item.authored());
        let seen = item.read(&view).filter(|_| !read_only).ok_or(Refusal::ReadOnly)?;
        let mut value = seen.clone();
        change(&mut value);
        if view.put(&item.record(), &value).is_none() {
            return Err(Refusal::NotAView);
        }
        if value == seen {
            return Ok(None);
        }
        self.edit(on, actor, space, entry, |item| {
            item.write(&view, &value);
        })
        .map(Some)
    }

    /// The item as device `d` shows it: the writes it holds and can decrypt. `None` if it holds or opens none.
    pub fn item(&self, d: SignerId, space: SpaceId, entry: EntryId) -> Option<&Item> {
        self.held(d).items.get(&(space, entry))
    }

    /// How many writes of the entry device `d` holds, whether it can decrypt them or not.
    pub fn fetched(&self, d: SignerId, space: SpaceId, entry: EntryId) -> usize {
        self.held(d).log.ops().iter().filter(|op| op.write_target() == Some((space, entry))).count()
    }

    /// Device `d` can open the current key of `k` with what it holds: the key of the latest epoch any device knows.
    pub fn opens(&self, d: SignerId, k: KeyScope) -> bool {
        let current = self.stores.values().map(|s| s.view().epoch(k)).max().unwrap_or(0);
        self.held(d).held(k, current).next().is_some()
    }

    /// The ops device `d` holds; `log(d).view()` is what it knows.
    pub fn log(&self, d: SignerId) -> &Log {
        &self.held(d).log
    }

    /// The signed op device `d` holds with id `op`, as it would send it.
    pub fn signed_op(&self, d: SignerId, op: OpId) -> Option<&Signed> {
        self.held(d).signed.get(&op)
    }

    /// Every byte device `d` stores, to search for plaintext that shouldn't be there: its signed ops, the keys it
    /// opened, and the items it shows, as their content reads.
    pub fn store(&self, d: SignerId) -> Vec<u8> {
        let store = self.held(d);
        let mut out = vec![];
        for op in store.log.ops() {
            out.extend(encode::bytes(op));
            for sig in &store.signed[&op.id()].sigs {
                match sig {
                    Signature::Ed25519(b) => out.extend(b),
                    Signature::Passkey(a) => {
                        for part in [&a.key, &a.authenticator_data, &a.client_data_json, &a.signature] {
                            out.extend(part);
                        }
                    }
                }
            }
        }
        for o in store.keys.values() {
            out.extend(o.secret.bytes());
        }
        for item in store.items.values() {
            out.extend(item.record().to_string().into_bytes());
        }
        out
    }

    /// Device `from` answers device `to` once, sending what `to` may receive by `from`'s view.
    pub fn sync(&mut self, from: SignerId, to: SignerId) {
        let ops = respond(self.held(from).log.ops(), to);
        let signed = self.signed(from, &ops);
        self.deliver(to, signed);
    }

    /// Every pair of online devices syncs until nothing new arrives, in an order drawn from `seed`.
    pub fn sync_all(&mut self, seed: u64) {
        let mut rng = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
        let mut next = move |n: usize| {
            rng ^= rng >> 12;
            rng ^= rng << 25;
            rng ^= rng >> 27;
            (rng.wrapping_mul(0x2545_f491_4f6c_dd1d) % n as u64) as usize
        };
        loop {
            let held: usize = self.stores.values().map(|s| s.signed.len()).sum();
            let mut pairs: Vec<(SignerId, SignerId)> =
                self.devices.iter().flat_map(|&a| self.devices.iter().filter(move |&&b| b != a).map(move |&b| (a, b))).collect();
            for i in (1..pairs.len()).rev() {
                pairs.swap(i, next(i + 1));
            }
            for (from, to) in pairs {
                self.sync(from, to);
            }
            if self.stores.values().map(|s| s.signed.len()).sum::<usize>() == held {
                break;
            }
        }
    }

    pub fn set_online(&mut self, d: SignerId, online: bool) {
        let _ = (d, online);
        todo!("P6: the network")
    }

    /// Deliver a tampering attempt to device `to`: `Err` with why it rejects it, or `Ok` if it keeps it.
    pub fn tamper(&mut self, to: SignerId, how: Tamper) -> Result<(), Refusal> {
        let signed = match how {
            Tamper::Unchecked { signers, action } => {
                let (&author, cosigners) = signers.split_first().expect("an op has an author");
                // drafted on the author's own device when it is one, building on what that device holds
                let on = if self.stores.contains_key(&author) { author } else { to };
                let op = self.held(on).log.draft(author, cosigners, action);
                self.sign(op)
            }
            Tamper::ForgedSignature { claimed, action } => {
                let op = self.held(to).log.draft(claimed, &[], action);
                let forger = DeviceKey::from_secret(self.secret("forger", ""));
                Signed { sigs: vec![forger.sign(op.id())], op }
            }
            Tamper::ChangedCiphertext(id) => {
                let mut signed = self.stores.values().find_map(|s| s.signed.get(&id)).cloned().expect("an op some device holds");
                if let Action::Write { body, .. } = &mut signed.op.action
                    && let Some(last) = body.last_mut()
                {
                    *last ^= 1;
                }
                signed
            }
            Tamper::ReplayedSeal { key, to: victim } => {
                let KeyName::Scoped(k, e) = key else { panic!("a family's key, not {key:?}") };
                // the first device holding the old key seals it again, straight to the victim's own key
                let holder = self.devices.iter().copied().find(|d| self.held(*d).held(k, e).next().is_some());
                let holder = holder.expect("a device holding the key");
                let secret = self.held(holder).held(k, e).next().expect("held").secret.clone();
                let pk = self.seal_public(victim).expect("a signer of the Lab");
                let recipient = Recipient::Signer(victim);
                let bytes = keys::seal(&secret, &pk, &box_info(k, e, secret.id(), &recipient), &mut self.rng).expect("a key");
                let boxes = vec![KeyBox { to: recipient, bytes }];
                let action = Action::Keys { key: k, epoch: e, id: secret.id(), public: None, boxes, clear: None };
                let op = self.held(holder).log.draft(holder, &[], action);
                self.sign(op)
            }
        };
        let op = signed.verify()?.clone();
        self.held(to).view().step(&op)?;
        self.deliver(to, vec![signed]);
        Ok(())
    }
}

/// Open every box the device can: sealed to one of `mine` (its own key, and what owners lend it), or to a key it
/// already opened; then every key published in the clear. A box counts only if what opens is the key it names.
fn open_keys(keyring: &mut BTreeMap<KeyId, Opened>, ix: &KeyIndex, mine: &[(SignerId, Secret)]) {
    loop {
        let mut more = false;
        for (k, e, id, b) in &ix.boxes {
            if keyring.contains_key(id) {
                continue;
            }
            let with = match b.to {
                Recipient::Signer(s) => mine.iter().find(|m| m.0 == s).map(|m| m.1.clone()),
                Recipient::Key { key, epoch, id: under } => {
                    keyring.get(&under).filter(|o| o.key == key && o.epoch == epoch).map(|o| o.secret.clone())
                }
            };
            let Some(with) = with else { continue };
            if let Some(secret) = keys::open(&b.bytes, &with, &box_info(*k, *e, *id, &b.to))
                && secret.id() == *id
            {
                keyring.insert(*id, Opened { key: *k, epoch: *e, secret });
                more = true;
            }
        }
        for &(k, e, id, bytes) in &ix.clear {
            let secret = Secret::from_bytes(bytes);
            if !keyring.contains_key(&id) && secret.id() == id {
                keyring.insert(id, Opened { key: k, epoch: e, secret });
                more = true;
            }
        }
        if !more {
            return;
        }
    }
}

/// The `Keys` ops device `d` should make, by its view: for each family it may open, a key made for each epoch from its
/// oldest to the current one where nobody made one yet; each current key it holds announced, sealed to every target
/// without a box yet, and published if the family is public; and each older key it holds wrapped under the next
/// epoch's key if nobody wrapped it yet.
fn upkeep(d: SignerId, store: &mut Store, ix: &KeyIndex, rng: &mut SeededRng) -> Vec<Action> {
    let st = store.replay.state.clone();
    let mut out = vec![];
    // keys announced in this round, so newer families can be sealed to them right away
    let mut announced: Vec<(KeyScope, u64, KeyId, PublicKey)> = vec![];
    for k in st.key_scopes() {
        if !st.entitled(d, k) {
            continue;
        }
        // a key for every epoch from the oldest it holds to the current one, where nobody made one yet: several
        // rotations at once leave the epochs between without a key, and the history must stay one chain
        let e = st.epoch(k);
        let from = store.keys.values().filter(|o| o.key == k).map(|o| o.epoch + 1).min().unwrap_or(e).min(e);
        for x in from..=e {
            if store.held(k, x).next().is_none() && !ix.exists(k, x) {
                let secret = Secret::generate(rng);
                store.keys.insert(secret.id(), Opened { key: k, epoch: x, secret });
            }
        }
        let current: Vec<Secret> = store.held(k, e).map(|o| o.secret.clone()).collect();
        for secret in current {
            let id = secret.id();
            let new = !ix.made.get(&(k, e)).is_some_and(|m| m.iter().any(|x| x.0 == id));
            let public = new.then(|| secret.public());
            let mut boxes = vec![];
            for t in st.targets(k) {
                if ix.boxed(k, e, id, t) {
                    continue;
                }
                let sealed = match t {
                    KeyName::Signer(s) => st.seal_key(s).map(|pk| (Recipient::Signer(s), pk.clone())),
                    KeyName::Scoped(tk, te) => {
                        let made = ix.made.get(&(tk, te)).into_iter().flatten().map(|(i, p)| (*i, p));
                        let now = announced.iter().filter(|a| (a.0, a.1) == (tk, te)).map(|a| (a.2, &a.3));
                        made.chain(now).min_by_key(|m| m.0).map(|(i, p)| (Recipient::Key { key: tk, epoch: te, id: i }, p.clone()))
                    }
                };
                if let Some((to, pk)) = sealed
                    && let Some(bytes) = keys::seal(&secret, &pk, &box_info(k, e, id, &to), rng)
                {
                    boxes.push(KeyBox { to, bytes });
                }
            }
            let clear = (st.public_key(k) && !ix.cleared(id)).then(|| secret.bytes());
            if let Some(p) = &public {
                announced.push((k, e, id, p.clone()));
            }
            if public.is_some() || !boxes.is_empty() || clear.is_some() {
                out.push(Action::Keys { key: k, epoch: e, id, public, boxes, clear });
            }
        }
        // the history: each older key under a key of the next epoch, so whoever reads now reads what came before
        let older: Vec<Opened> = store.keys.values().filter(|o| o.key == k && o.epoch < e).cloned().collect();
        for o in older {
            let id = o.secret.id();
            let wrapped = ix.boxes.iter().any(|(bk, be, bid, b)| {
                (*bk, *be, *bid) == (k, o.epoch, id) && b.to.name() == KeyName::Scoped(k, o.epoch + 1)
            });
            let Some(next) = store.held(k, o.epoch + 1).next() else { continue };
            if wrapped {
                continue;
            }
            let to = Recipient::Key { key: k, epoch: o.epoch + 1, id: next.secret.id() };
            let bytes = keys::wrap(&o.secret, &next.secret, &box_info(k, o.epoch, id, &to), rng);
            out.push(Action::Keys { key: k, epoch: o.epoch, id, public: None, boxes: vec![KeyBox { to, bytes }], clear: None });
        }
    }
    out
}

/// Rebuild the items device `d` shows: for each entry, the writes of its view it can decrypt, in replay order. A
/// write opens only under a key of its own entry at its own epoch.
fn show_items(d: SignerId, store: &mut Store) {
    let ops: HashMap<OpId, &Op> = store.log.ops().iter().map(|op| (op.id(), op)).collect();
    let st = store.view();
    let mut items = BTreeMap::new();
    for space in st.spaces() {
        for &entry in &space.entries {
            let mut item = Item::new(d);
            let mut shown = false;
            for w in st.writes(space.id, entry) {
                let op = ops[&w];
                let Action::Write { epoch, body, .. } = &op.action else { continue };
                let key = keys::edit_key(body).and_then(|id| store.keys.get(&id));
                let Some(key) = key.filter(|o| o.key == KeyScope::Entry(space.id, entry) && o.epoch == *epoch) else {
                    continue;
                };
                if let Some(update) = keys::open_edit(&key.secret, body, &write_context(op)) {
                    shown |= item.import(&update, op.author).is_ok();
                }
            }
            if shown {
                items.insert((space.id, entry), item);
            }
        }
    }
    store.items = items;
}
