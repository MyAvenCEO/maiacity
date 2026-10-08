//! The Lab: in-process devices on a network the test controls. Each device has its own keys, its own ops and its own
//! store, exactly what a real device would hold; there is also a relay server, whose vault holds relay caps and never
//! read, and any number of strangers. The scenario tests run on it, and so will the avenDB tile's Lab screen.
//!
//! It grows with the phases: devices and their ops in P1, caps and sync by caps in P2, keys, reading and the blind
//! server in P3, apps on a schema reading and editing items through their space's lane in P4, locked devices, blobs and
//! checkpoints in P4b, history and branches in P5, and in P6 offline devices, sync by what each device holds of each
//! log, gossip of one digest per log in random orders, and backups, whose restored devices fork.
//!
//! A device shows each entry on every line of its history (`branch`): it opens each write it can, and builds the item
//! of each line from the updates of that line's history. Branching, merging, promoting, restoring, undoing and
//! forking are writes like any edit, encrypted under the entry's key and checked against the writer's caps.
//!
//! A person's device derives its keys from their passkey at every unlock (`sign::Passkey::device`) and holds them only
//! while it is unlocked: a locked device keeps its ops and their ciphertext, and no key, nor anything a key opened. The
//! server and strangers have keys of their own.
//!
//! Every unlocked device keeps its keys up to date as an honest app would, each time its ops change: it opens every box
//! its standing `Keys` ops hold for a key it has, and for each family it may open, it makes the key of each epoch from
//! its oldest to the current one if nobody has yet, announces each current vault or space key it holds (keys are sealed
//! to those), boxes it for every target the schedule names that has no box yet, publishes it if the family is public,
//! and wraps each older key it holds under the next epoch's key if nobody has yet. A box is wrapped where the device
//! holds the key it goes to, and sealed to that key's public half otherwise. An owner key (a passkey, the server's owner
//! key) authoring an op on a device lends it, for that ceremony only, the key that is sealed to the owner: that is how a
//! new device reads again after every other device is lost.
//!
//! A Classic McEliece public key travels as a blob beside the ops that name it (`policy::Op::blobs`): a device keeps the
//! blobs of the ops it keeps, each only if it hashes to its id, and seals to a key once it holds that key's blob. Before
//! it syncs, a device vouches for the writes it made since its last checkpoint (`policy::Action::Checkpoint`); once
//! peers stop trusting the curves (`set_pq_only`), each counts only the writes a checkpoint by their author covers
//! (`policy::checkpointed`), and checkpoints each write of its own as it makes it.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use rand_core::Rng as _;
use serde_json::Value;

use crate::branch::{Commit, Draft, History, MAIN};
use crate::doc::{Item, Version};
use crate::encode::{self, box_info, write_context};
use crate::hash::{Hasher, Reader};
use crate::id::{BlobId, EntryId, OpId, SignerId, SpaceId, VaultId};
use crate::keys::{self, KeyBox, KeyId, KeyName, KeyScope, PublicKey, Recipient, SeededRng, Secret};
use crate::lens::{Lane, Schema};
use crate::policy::{checkpointed, replay, Action, Branch, Kind, Line, Log, Op, Principal, Refusal, Replay, State};
use crate::sign::{self, Classical, DeviceKey, Passkey, Signature, SignerKeys, Signed};
use crate::sync::{answer, asks_ids, beyond, digests_ids, forks_in, logs_of, vault_logs, LogId};

/// A device keeps its keys up to date in a few rounds at most: one to make and seal keys, one to seal newer keys to
/// the keys it just made, one to find nothing left. More means an op the rules refuse, made again and again.
const ROUNDS: usize = 6;

/// Blobs by id: the McEliece public keys a device holds, or sends beside its ops.
type Blobs = HashMap<BlobId, Arc<[u8]>>;

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
    /// An op signed with only the classical half of `signer`'s key, as whoever broke its curve (ed25519, or a passkey's
    /// P-256) could sign it: the hash-based half is missing.
    BrokenClassicalKey { signer: SignerId, action: Action },
}

/// A signer's private keys.
enum Key {
    /// A device, or the server's owner key.
    Device(DeviceKey),
    Passkey(Passkey),
}

impl Key {
    fn sign(&mut self, op: OpId, pq: bool) -> Signature {
        match self {
            Key::Device(k) => k.sign(op, pq),
            Key::Passkey(p) => p.sign(op, pq),
        }
    }

    /// The key that keys are sealed to for this signer.
    fn seal_secret(&self) -> Secret {
        match self {
            Key::Device(k) => k.seal_secret(),
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

/// What one device holds: its ops, each with its signatures, to pass on, and the blobs they name; what it makes of
/// them; the keys it opened; and the entries it shows.
struct Store {
    log: Log,
    signed: HashMap<OpId, Signed>,
    blobs: Blobs,
    /// The replay of its ops: which stand, and what it knows. Of the checkpointed ones only, once it no longer trusts
    /// the curves.
    replay: Replay,
    /// By id, so the first of a family's keys at an epoch is the one with the smallest id. Empty while it is locked.
    keys: BTreeMap<KeyId, Opened>,
    shown: BTreeMap<(SpaceId, EntryId), Shown>,
    /// The writes it made itself that no checkpoint of its own covers yet.
    unvouched: Vec<OpId>,
    /// The digest of each log it holds (`sync::digests`), what it gossips: `None` until worked out for its ops now.
    digests: Option<BTreeMap<LogId, [u8; 32]>>,
}

impl Default for Store {
    fn default() -> Store {
        Store {
            log: Log::new(),
            signed: HashMap::new(),
            blobs: HashMap::new(),
            replay: replay(&[]),
            keys: BTreeMap::new(),
            shown: BTreeMap::new(),
            unvouched: vec![],
            digests: None,
        }
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

/// What a device shows of one entry: its history, every accepted write with what the device could open, and the item
/// of each line where it opens any update.
#[derive(Default)]
struct Shown {
    history: History,
    items: BTreeMap<Line, Item>,
}

/// What a device's standing `Keys` ops say: the keys announced, the boxes, and what is published.
#[derive(Default)]
struct KeyIndex {
    /// Each key announced, by family and epoch, with the public key it is sealed to.
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

/// A copy of what a device holds, as a backup keeps it: its signed ops and the blobs they name.
#[derive(Clone)]
pub struct Backup {
    signed: Vec<Signed>,
    blobs: Blobs,
}

pub struct Lab {
    /// The keys at hand: passkeys, owner keys, and unlocked devices.
    keys: HashMap<SignerId, Key>,
    /// Each device whose keys derive from a passkey: that passkey, and the 32 bytes that end the device's salt.
    salts: HashMap<SignerId, (SignerId, [u8; 32])>,
    /// Devices in the order they were made.
    devices: Vec<SignerId>,
    stores: HashMap<SignerId, Store>,
    server: Option<(SignerId, VaultId)>,
    /// Keys made so far; each key's seed counts on from here.
    made: u64,
    /// The randomness of new keys, seals and nonces.
    rng: SeededRng,
    /// No device trusts the curves anymore: each counts only checkpointed writes.
    pq_only: bool,
    /// The devices off the network: they neither send nor receive.
    offline: HashSet<SignerId>,
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
            salts: HashMap::new(),
            devices: vec![],
            stores: HashMap::new(),
            server: None,
            made: 0,
            rng: SeededRng::new("lab randomness", b""),
            pq_only: false,
            offline: HashSet::new(),
        }
    }

    /// The seed of the next key the Lab makes: the Lab is deterministic, so a failing test replays exactly.
    fn seed(&mut self, what: &str, name: &str) -> Reader {
        self.made += 1;
        let mut h = Hasher::new("lab key");
        h.update(&self.made.to_be_bytes()).update(&(what.len() as u32).to_be_bytes()).update(what.as_bytes()).update(name.as_bytes());
        h.reader()
    }

    fn secret(&mut self, what: &str, name: &str) -> [u8; 32] {
        self.seed(what, name).array()
    }

    /// A passkey: an owner signer that governs a human vault. It signs on whichever device it is used on.
    pub fn passkey(&mut self, name: &str) -> SignerId {
        let key = Passkey::from_seed(self.secret("passkey", name));
        key.seal_secret().prepare();
        let id = key.id();
        self.keys.insert(id, Key::Passkey(key));
        id
    }

    /// A device with keys of its own, as the server and strangers have, its own ops and its own store.
    pub fn device(&mut self, name: &str) -> SignerId {
        let key = DeviceKey::from_secret(self.secret("device", name));
        self.add_device(key)
    }

    /// A person's device: its keys derive from `passkey`'s PRF output on a salt of the device's own, as it derives
    /// them at every unlock. It starts unlocked.
    pub fn device_of(&mut self, passkey: SignerId, name: &str) -> SignerId {
        let nonce = self.secret("device salt", name);
        let Some(Key::Passkey(p)) = self.keys.get(&passkey) else { panic!("{passkey:?} is no passkey the Lab holds") };
        let id = self.add_device(p.device(nonce));
        self.salts.insert(id, (passkey, nonce));
        id
    }

    fn add_device(&mut self, key: DeviceKey) -> SignerId {
        key.seal_secret().prepare();
        let id = key.id();
        self.keys.insert(id, Key::Device(key));
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
        owner.seal_secret().prepare();
        let owner_id = owner.id();
        self.keys.insert(owner_id, Key::Device(owner));
        let genesis =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(owner_id)], threshold: 1, root: None, nonce: 0, seal_to: vec![] };
        let vault = VaultId::from(self.submit(device, &[owner_id], genesis).expect("the server's vault"));
        self.submit(device, &[owner_id, device], Action::AddDevice { vault, device, seal_to: None }).expect("the server's device");
        self.server = Some((device, vault));
        (device, vault)
    }

    /// Lock device `d`: its keys, and every key and item they opened, leave its memory. Its ops and their ciphertext
    /// stay, and it still receives and passes on ops.
    pub fn lock(&mut self, d: SignerId) {
        self.keys.remove(&d);
        let store = self.stores.get_mut(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        store.keys.clear();
        store.shown.clear();
    }

    /// Unlock device `d` with the passkey its keys derive from: they derive again, and it opens again what its ops hold
    /// for it. False if its keys derive from no passkey (the server, a stranger), or the passkey is lost.
    pub fn unlock(&mut self, d: SignerId) -> bool {
        let Some(&(passkey, nonce)) = self.salts.get(&d) else { return false };
        let Some(Key::Passkey(p)) = self.keys.get(&passkey) else { return false };
        let key = p.device(nonce);
        assert_eq!(key.id(), d, "the same passkey and salt derive the same device");
        self.keys.insert(d, Key::Device(key));
        self.refresh(d, &[]);
        true
    }

    /// Device `d` holds no key: it is locked.
    pub fn locked(&self, d: SignerId) -> bool {
        !self.keys.contains_key(&d)
    }

    /// A signer is lost: its key can't sign anymore, and a lost device's store is gone with it.
    pub fn lose(&mut self, s: SignerId) {
        self.keys.remove(&s);
        self.salts.remove(&s);
        self.stores.remove(&s);
        self.devices.retain(|&d| d != s);
    }

    fn held(&self, d: SignerId) -> &Store {
        self.stores.get(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"))
    }

    fn unlocked(&self, d: SignerId) -> Result<(), Refusal> {
        if self.keys.contains_key(&d) { Ok(()) } else { Err(Refusal::Locked) }
    }

    /// The public key keys are sealed to for signer `s`, and the McEliece blob it names, if the Lab holds its key.
    fn seal_public(&self, s: SignerId) -> Option<(PublicKey, Arc<[u8]>)> {
        let secret = self.keys.get(&s)?.seal_secret();
        Some((secret.public(), secret.mceliece_public()))
    }

    /// Sign `op` with the key of each of its signers: both halves, or on a write the classical half alone. `Locked` if
    /// a signer's key isn't at hand.
    fn sign(&mut self, op: Op) -> Result<Signed, Refusal> {
        let (id, pq) = (op.id(), sign::needs_pq(&op));
        let mut sigs = vec![];
        for s in op.sigs() {
            sigs.push(self.keys.get_mut(&s).ok_or(Refusal::Locked)?.sign(id, pq));
        }
        Ok(Signed { op, sigs })
    }

    /// Device `to` keeps signed ops, and the blobs among `blobs` they name: each op once, and only if every signature
    /// checks out. Whether the ops stand is for its replay to say; a blob is checked against its id before anything is
    /// sealed with it (`key_box`). True if any op was new.
    fn keep(&mut self, to: SignerId, ops: Vec<Signed>, blobs: &Blobs) -> bool {
        let Some(store) = self.stores.get_mut(&to) else { return false };
        let mut new = false;
        for signed in ops {
            // an op it holds was checked when it arrived; a copy with other signatures adds nothing
            let id = signed.op.id();
            if store.signed.contains_key(&id) || signed.verify().is_err() {
                continue;
            }
            for b in signed.op.blobs() {
                if let Some(bytes) = blobs.get(&b) {
                    store.blobs.entry(b).or_insert_with(|| bytes.clone());
                }
            }
            store.log.receive([signed.op.clone()]);
            store.signed.insert(id, signed);
            new = true;
        }
        if new {
            store.digests = None;
        }
        new
    }

    /// Device `to` receives signed ops and their blobs, and brings its keys and items up to date if any op was new.
    fn deliver(&mut self, to: SignerId, ops: Vec<Signed>, blobs: &Blobs) {
        if self.keep(to, ops, blobs) {
            self.refresh(to, &[]);
        }
    }

    /// What device `d` sends with the ops `ids`: each with its signatures, and the blobs they name.
    fn outgoing(&self, d: SignerId, ids: &[OpId]) -> (Vec<Signed>, Blobs) {
        let store = self.held(d);
        let signed: Vec<Signed> = ids.iter().map(|id| store.signed[id].clone()).collect();
        let blobs =
            signed.iter().flat_map(|s| s.op.blobs()).filter_map(|b| Some((b, store.blobs.get(&b)?.clone()))).collect();
        (signed, blobs)
    }

    /// Device `from` hands vault `v`'s log to device `to`, as when two people exchange contact cards: a peer needs a
    /// vault's log before it accepts a grant to that vault.
    pub fn share_contact(&mut self, from: SignerId, to: SignerId, v: VaultId) {
        let store = self.held(from);
        let ids: Vec<OpId> = vault_logs(store.log.ops(), store.view(), vec![v]).iter().map(Op::id).collect();
        let (signed, blobs) = self.outgoing(from, &ids);
        self.deliver(to, signed, &blobs);
    }

    /// Sign `action` by `signers` and keep it on device `on`, if `on`'s view accepts it. The author, the first signer,
    /// signs on `on`; cosigners sign on their own devices. A signer's key to seal to that the action brings is filled
    /// in when the Lab holds that signer.
    pub fn submit(&mut self, on: SignerId, signers: &[SignerId], mut action: Action) -> Result<OpId, Refusal> {
        let (&author, cosigners) = signers.split_first().expect("an op has an author");
        let blobs = self.fill_seal_to(&mut action);
        let op = self.held(on).log.check(author, cosigners, action)?;
        let id = op.id();
        let signed = self.sign(op)?;
        debug_assert!(signed.verify().is_ok());
        // an owner key authoring on this device lends it, for this ceremony, what is sealed to it
        let lent: Vec<(SignerId, Secret)> = match self.keys.get(&author) {
            Some(key) if !self.devices.contains(&author) => vec![(author, key.seal_secret())],
            _ => vec![],
        };
        self.keep(on, vec![signed], &blobs);
        self.refresh(on, &lent);
        Ok(id)
    }

    /// Fill in the keys to seal to that `action` brings for signers the Lab holds, and return the McEliece blobs they
    /// name.
    fn fill_seal_to(&self, action: &mut Action) -> Blobs {
        let mut blobs = Blobs::new();
        let mut public = |s: SignerId| {
            let (key, blob) = self.seal_public(s)?;
            blobs.insert(key.mceliece, blob);
            Some(key)
        };
        match action {
            Action::Genesis { kind: Kind::Human, owners, seal_to, .. } if seal_to.is_empty() => {
                *seal_to = owners
                    .iter()
                    .filter_map(|p| match *p {
                        Principal::Signer(s) => Some((s, public(s)?)),
                        Principal::Vault(_) => None,
                    })
                    .collect();
            }
            Action::AddOwner { owner: Principal::Signer(s), seal_to: to @ None, .. } => *to = public(*s),
            Action::AddDevice { device, seal_to: to @ None, .. } => *to = public(*device),
            _ => {}
        }
        blobs
    }

    /// Bring device `d`'s keys and items up to date with its ops, `lent` holding the keys of owners signing on it
    /// right now. Each round replays its ops, opens what it can, and makes the `Keys` ops still missing. A locked
    /// device only replays.
    fn refresh(&mut self, d: SignerId, lent: &[(SignerId, Secret)]) {
        let own = self.keys.get(&d).map(Key::seal_secret);
        let unlocked = own.is_some();
        let mine: Vec<(SignerId, Secret)> = own.map(|o| (d, o)).into_iter().chain(lent.iter().cloned()).collect();
        for round in 0.. {
            let pq_only = self.pq_only;
            let Some(store) = self.stores.get_mut(&d) else { return };
            store.replay = if pq_only { replay(&checkpointed(store.log.ops())) } else { store.log.replay() };
            // a locked device holds no key, and opens nothing
            if !unlocked {
                return;
            }
            let ix = KeyIndex::of(&store.replay);
            open_keys(&mut store.keys, &ix, &mine);
            let actions = upkeep(d, store, &ix, &mine, &mut self.rng);
            if actions.is_empty() {
                show_items(d, store);
                return;
            }
            assert!(round < ROUNDS, "{d:?} keeps making keys ops its own view refuses: {actions:?}");
            for action in actions {
                let op = self.held(d).log.draft(d, &[], action);
                let signed = self.sign(op).expect("an unlocked device signs");
                self.keep(d, vec![signed], &Blobs::new());
            }
        }
    }

    /// Create an item in `space` on device `on`, acting for `actor`: its first encrypted write. The item must have
    /// been made on `on`, as its Loro edits carry `on`'s peer.
    pub fn create(&mut self, on: SignerId, actor: VaultId, space: SpaceId, item: Item) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let mut id = [0u8; 32];
        self.rng.fill_bytes(&mut id);
        let entry = EntryId(id);
        let draft = Action::Write { space, entry, actor, epoch: 0, deps: vec![], branch: Branch::Main, body: vec![] };
        let op = self.held(on).log.check(on, &[], draft)?;
        self.write(on, op, &item.export(&Version::default()))?;
        Ok(entry)
    }

    /// Edit an item on device `on`, acting for `actor`, on its main line: `edit_on`.
    pub fn edit(
        &mut self,
        on: SignerId,
        actor: VaultId,
        space: SpaceId,
        entry: EntryId,
        change: impl FnOnce(&mut Item),
    ) -> Result<OpId, Refusal> {
        self.edit_on(on, actor, space, entry, MAIN, change)
    }

    /// Edit an item on line `line` of its history, on device `on`, acting for `actor`: `change` edits the item as the
    /// device shows it there, and what changed becomes one encrypted write under the entry's current key, building on
    /// the line's heads.
    pub fn edit_on(
        &mut self,
        on: SignerId,
        actor: VaultId,
        space: SpaceId,
        entry: EntryId,
        line: Line,
        change: impl FnOnce(&mut Item),
    ) -> Result<OpId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, space, entry).edit(line, on, change);
        self.make(on, actor, (space, entry), draft)
    }

    /// Start a branch named `name` of an entry, from the version `from` (any of its writes, with what they build on),
    /// on device `on`, acting for `actor`. The branch is named by the write's id; the name travels encrypted.
    pub fn branch(
        &mut self,
        on: SignerId,
        actor: VaultId,
        (space, entry): (SpaceId, EntryId),
        from: &[OpId],
        name: &str,
    ) -> Result<OpId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, space, entry).branch(from, name);
        self.make(on, actor, (space, entry), draft)
    }

    /// Merge line `from` of an entry into line `into`: a write on `into` building on the heads of both.
    pub fn merge(
        &mut self,
        on: SignerId,
        actor: VaultId,
        (space, entry): (SpaceId, EntryId),
        from: Line,
        into: Line,
    ) -> Result<OpId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, space, entry).merge(from, into);
        self.make(on, actor, (space, entry), draft)
    }

    /// Promote line `from` of an entry into line `into`: a merge whose write brings `into` to exactly what `from`
    /// shows, keeping both histories.
    pub fn promote(
        &mut self,
        on: SignerId,
        actor: VaultId,
        (space, entry): (SpaceId, EntryId),
        from: Line,
        into: Line,
    ) -> Result<OpId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, space, entry).promote(from, into, on);
        self.make(on, actor, (space, entry), draft)
    }

    /// Put the record of `version` back on line `line` of an entry: restore an earlier version, or revert the
    /// line's latest commit by restoring the version it built on.
    pub fn restore(
        &mut self,
        on: SignerId,
        actor: VaultId,
        (space, entry): (SpaceId, EntryId),
        line: Line,
        version: &[OpId],
    ) -> Result<OpId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, space, entry).restore(line, version, on);
        self.make(on, actor, (space, entry), draft)
    }

    /// Undo the commit `op` on line `line` of an entry, keeping every change made since (`branch::undo`). `UnknownDep`
    /// if the device holds no such write.
    pub fn undo(
        &mut self,
        on: SignerId,
        actor: VaultId,
        (space, entry): (SpaceId, EntryId),
        line: Line,
        op: OpId,
    ) -> Result<OpId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, space, entry).undo(line, op, on).ok_or(Refusal::UnknownDep)?;
        self.make(on, actor, (space, entry), draft)
    }

    /// Fork what device `on` shows on line `line` of an entry into a new entry of space `into`: its record, and none
    /// of its history, as `on`'s first write of the new entry, acting for `actor`. `ReadOnly` if it shows nothing
    /// there.
    pub fn fork(
        &mut self,
        on: SignerId,
        actor: VaultId,
        (space, entry): (SpaceId, EntryId),
        line: Line,
        into: SpaceId,
    ) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let copy = self.item_on(on, space, entry, line).ok_or(Refusal::ReadOnly)?.copy(on);
        self.create(on, actor, into, copy)
    }

    /// What device `d` shows of an entry: its history, empty if it holds no write of it.
    fn shown(&self, d: SignerId, space: SpaceId, entry: EntryId) -> &History {
        static NONE: std::sync::LazyLock<History> = std::sync::LazyLock::new(History::default);
        self.held(d).shown.get(&(space, entry)).map_or(&NONE, |s| &s.history)
    }

    /// Make the write `draft` describes on device `on`, acting for `actor`, under the entry's current key in what the
    /// device knows (T15).
    fn make(
        &mut self,
        on: SignerId,
        actor: VaultId,
        (space, entry): (SpaceId, EntryId),
        draft: Draft,
    ) -> Result<OpId, Refusal> {
        let store = self.held(on);
        let epoch = store.view().epoch(KeyScope::Entry(space, entry));
        let Draft { branch, deps, body } = draft;
        let action = Action::Write { space, entry, actor, epoch, deps, branch, body: vec![] };
        let op = store.log.check(on, &[], action)?;
        self.write(on, op, &body)
    }

    /// Encrypt `update` into the write `op` under its entry's key at the write's epoch (the first the device holds,
    /// or a new one), bound to the op, then sign and keep it; once peers count only checkpointed writes, vouch for it
    /// at once.
    fn write(&mut self, on: SignerId, mut op: Op, update: &[u8]) -> Result<OpId, Refusal> {
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
        let signed = self.sign(op)?;
        self.keep(on, vec![signed], &Blobs::new());
        self.stores.get_mut(&on).expect("a device").unvouched.push(id);
        if self.pq_only {
            self.vouch(on);
        }
        self.refresh(on, &[]);
        Ok(id)
    }

    /// Device `d` vouches for the writes it made since its last checkpoint: a checkpoint for each entry, covering those
    /// of its writes the entry has accepted, signed both ways. Nothing while it is locked.
    pub fn checkpoint(&mut self, d: SignerId) {
        if self.vouch(d) {
            self.refresh(d, &[]);
        }
    }

    /// `checkpoint` without bringing keys and items up to date: true if it made any.
    fn vouch(&mut self, d: SignerId) -> bool {
        if self.locked(d) {
            return false;
        }
        let Some(store) = self.stores.get_mut(&d) else { return false };
        if store.unvouched.is_empty() {
            return false;
        }
        let unvouched = std::mem::take(&mut store.unvouched);
        // its own writes as every op it holds has them, whether it counts them yet or not
        let full = if self.pq_only { Some(store.log.view()) } else { None };
        let st = full.as_ref().unwrap_or(store.view());
        let mut by: BTreeMap<(SpaceId, EntryId), Vec<OpId>> = BTreeMap::new();
        for w in st.all_writes() {
            if unvouched.contains(&w.op) {
                by.entry((w.space, w.entry)).or_default().push(w.op);
            }
        }
        let made = !by.is_empty();
        for ((space, entry), covers) in by {
            let op = self.held(d).log.draft(d, &[], Action::Checkpoint { space, entry, covers });
            let signed = self.sign(op).expect("an unlocked device signs");
            self.keep(d, vec![signed], &Blobs::new());
        }
        made
    }

    /// Every device stops trusting the curves, or trusts them again: once they no longer do, each counts only the
    /// writes a checkpoint by their author covers, and checkpoints each write of its own as it makes it.
    pub fn set_pq_only(&mut self, on: bool) {
        self.pq_only = on;
        for d in self.devices.clone() {
            self.refresh(d, &[]);
        }
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
        self.unlocked(on)?;
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

    /// The item as device `d` shows it on its main line: the writes of the line's history it counts and can decrypt.
    /// `None` if it counts or opens none.
    pub fn item(&self, d: SignerId, space: SpaceId, entry: EntryId) -> Option<&Item> {
        self.item_on(d, space, entry, MAIN)
    }

    /// The item as device `d` shows it on line `line`.
    pub fn item_on(&self, d: SignerId, space: SpaceId, entry: EntryId, line: Line) -> Option<&Item> {
        self.held(d).shown.get(&(space, entry))?.items.get(&line)
    }

    /// An entry's history as device `d` holds it: every write it counts, with what it could open, its lines and their
    /// heads, the branches' names, and any version to open read-only (`History::item_at`). `None` if it counts no write
    /// of the entry.
    pub fn history(&self, d: SignerId, space: SpaceId, entry: EntryId) -> Option<&History> {
        self.held(d).shown.get(&(space, entry)).map(|s| &s.history)
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

    /// The ops device `d` holds; `log(d).view()` is what they say, every write counted.
    pub fn log(&self, d: SignerId) -> &Log {
        &self.held(d).log
    }

    /// What device `d` makes of the ops it holds: what `log(d).view()` says, but once it no longer trusts the curves,
    /// of the checkpointed writes only.
    pub fn state(&self, d: SignerId) -> &State {
        self.held(d).view()
    }

    /// The signed op device `d` holds with id `op`, as it would send it.
    pub fn signed_op(&self, d: SignerId, op: OpId) -> Option<&Signed> {
        self.held(d).signed.get(&op)
    }

    /// Every byte device `d` stores, to search for plaintext that shouldn't be there: its signed ops, the keys it
    /// opened, and the items it shows, as their content reads. The McEliece public keys it holds are left out: public,
    /// and a megabyte each.
    pub fn store(&self, d: SignerId) -> Vec<u8> {
        let store = self.held(d);
        let mut out = vec![];
        for op in store.log.ops() {
            out.extend(encode::bytes(op));
            for sig in &store.signed[&op.id()].sigs {
                match &sig.keys {
                    SignerKeys::Device { ed25519, slh } => out.extend(ed25519.iter().chain(slh)),
                    SignerKeys::Passkey { p256, slh } => out.extend(p256.iter().chain(slh)),
                }
                match &sig.classical {
                    Classical::Ed25519(b) => out.extend(b),
                    Classical::Passkey(a) => {
                        for part in [&a.authenticator_data, &a.client_data_json, &a.signature] {
                            out.extend(part);
                        }
                    }
                }
                out.extend(sig.pq.iter().flatten());
            }
        }
        for o in store.keys.values() {
            out.extend(o.secret.bytes());
        }
        for shown in store.shown.values() {
            for item in shown.items.values() {
                out.extend(item.record().to_string().into_bytes());
            }
            for c in shown.history.commits().iter().filter(|c| c.write.branch == Branch::New) {
                out.extend(c.body.iter().flatten());
            }
        }
        out
    }

    /// Take device `d` off the network, or bring it back: offline, it neither sends nor receives, and works on with
    /// what it holds.
    pub fn set_online(&mut self, d: SignerId, online: bool) {
        if online {
            self.offline.remove(&d);
        } else {
            self.offline.insert(d);
        }
    }

    /// Device `d` is on the network.
    pub fn online(&self, d: SignerId) -> bool {
        !self.offline.contains(&d)
    }

    /// What device `from` makes of the ops it holds, every write counted: what it answers by.
    fn full_view(&self, from: SignerId) -> std::borrow::Cow<'_, State> {
        let store = self.held(from);
        if self.pq_only { std::borrow::Cow::Owned(store.log.view()) } else { std::borrow::Cow::Borrowed(store.view()) }
    }

    /// Device `to` asks device `from` once, with what it holds of each log (`sync::asks`), and `from` answers with what
    /// `to` may receive by `from`'s view, of each log only what lies beyond what `to` holds of it. `from` vouches for
    /// its new writes first. How many ops `from` sent: none while either is offline.
    pub fn sync(&mut self, from: SignerId, to: SignerId) -> usize {
        if !self.online(from) || !self.online(to) {
            return 0;
        }
        self.checkpoint(from);
        let to_store = self.held(to);
        let asked = asks_ids(to_store.log.ops(), to_store.log.ids());
        let store = self.held(from);
        let (ops, ids) = (store.log.ops(), store.log.ids());
        let places = answer(ops, &self.full_view(from), to);
        let sent: Vec<OpId> =
            beyond(ops, ids, &logs_of(ops, ids), &places, &asked).into_iter().map(|i| ids[i]).collect();
        let (signed, blobs) = self.outgoing(from, &sent);
        self.deliver(to, signed, &blobs);
        sent.len()
    }

    /// The digest of each log device `d` holds (`sync::digests`): what it gossips.
    pub fn digests(&mut self, d: SignerId) -> &BTreeMap<LogId, [u8; 32]> {
        let store = self.stores.get_mut(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        store.digests.get_or_insert_with(|| digests_ids(store.log.ops(), store.log.ids()))
    }

    /// The gossip tells device `to` to ask device `from`: `from` would answer it about a log whose digest differs from
    /// `to`'s, or with an op of no log that `to` lacks.
    fn gossip_says_ask(&mut self, from: SignerId, to: SignerId) -> bool {
        self.digests(from);
        self.digests(to);
        let (theirs, mine) = (self.held(from), self.held(to));
        let (ops, ids) = (theirs.log.ops(), theirs.log.ids());
        let logs = logs_of(ops, ids);
        let (df, dt) = (theirs.digests.as_ref().expect("worked out"), mine.digests.as_ref().expect("worked out"));
        answer(ops, &self.full_view(from), to).into_iter().any(|i| match logs[i] {
            Some(l) => df.get(&l) != dt.get(&l),
            None => !mine.signed.contains_key(&ids[i]),
        })
    }

    /// Every online device gossips the digest of each log it holds, and asks a peer whenever the peer would answer it
    /// about a log whose digest differs from its own (`sync`), pair by pair in an order drawn from `seed`, until
    /// nothing new arrives. How many ops were sent in all.
    pub fn sync_all(&mut self, seed: u64) -> usize {
        let mut rng = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
        let mut next = move |n: usize| {
            rng ^= rng >> 12;
            rng ^= rng << 25;
            rng ^= rng >> 27;
            (rng.wrapping_mul(0x2545_f491_4f6c_dd1d) % n as u64) as usize
        };
        let mut sent = 0;
        loop {
            let held: usize = self.stores.values().map(|s| s.signed.len()).sum();
            let online: Vec<SignerId> = self.devices.iter().copied().filter(|&d| self.online(d)).collect();
            let mut pairs: Vec<(SignerId, SignerId)> =
                online.iter().flat_map(|&a| online.iter().filter(move |&&b| b != a).map(move |&b| (a, b))).collect();
            for i in (1..pairs.len()).rev() {
                pairs.swap(i, next(i + 1));
            }
            for (from, to) in pairs {
                if self.gossip_says_ask(from, to) {
                    sent += self.sync(from, to);
                }
            }
            if self.stores.values().map(|s| s.signed.len()).sum::<usize>() == held {
                return sent;
            }
        }
    }

    /// Every fork device `d` sees among the ops it holds (`sync::forks`): two ops of one device in one log where
    /// neither builds on the other, the smaller id first.
    pub fn forks(&self, d: SignerId) -> Vec<(OpId, OpId)> {
        let store = self.held(d);
        forks_in(store.log.ops(), store.log.ids(), store.view())
    }

    /// A backup of device `d`: its signed ops and their blobs, as they are now.
    pub fn backup(&self, d: SignerId) -> Backup {
        let store = self.held(d);
        let signed = store.log.ids().iter().map(|id| store.signed[id].clone()).collect();
        Backup { signed, blobs: store.blobs.clone() }
    }

    /// Restore device `d` from `backup`: it holds what the backup holds and nothing it made or received since. What it
    /// makes next in a log builds on the past the backup kept, so it forks from what it made there since (`forks`).
    pub fn restore_backup(&mut self, d: SignerId, backup: &Backup) {
        self.stores.insert(d, Store::default());
        self.keep(d, backup.signed.clone(), &backup.blobs);
        self.refresh(d, &[]);
    }

    /// Deliver a tampering attempt to device `to`: `Err` with why it rejects it, or the op's id if it keeps it.
    pub fn tamper(&mut self, to: SignerId, how: Tamper) -> Result<OpId, Refusal> {
        let signed = match how {
            Tamper::Unchecked { signers, action } => {
                let (&author, cosigners) = signers.split_first().expect("an op has an author");
                // drafted on the author's own device when it is one, building on what that device holds
                let on = if self.stores.contains_key(&author) { author } else { to };
                let op = self.held(on).log.draft(author, cosigners, action);
                self.sign(op)?
            }
            Tamper::ForgedSignature { claimed, action } => {
                let op = self.held(to).log.draft(claimed, &[], action);
                let forger = DeviceKey::from_secret(self.secret("forger", ""));
                Signed { sigs: vec![forger.sign(op.id(), sign::needs_pq(&op))], op }
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
                let (pk, blob) = self.seal_public(victim).expect("a signer of the Lab");
                let recipient = Recipient::Signer(victim);
                let info = box_info(k, e, secret.id(), &recipient);
                let bytes = keys::seal(&secret, &pk, &blob, &info, &mut self.rng).expect("a key");
                let boxes = vec![KeyBox { to: recipient, bytes }];
                let action = Action::Keys { key: k, epoch: e, id: secret.id(), public: None, boxes, clear: None };
                let op = self.held(holder).log.draft(holder, &[], action);
                self.sign(op)?
            }
            Tamper::BrokenClassicalKey { signer, action } => {
                let op = self.held(to).log.draft(signer, &[], action);
                let key = self.keys.get_mut(&signer).expect("a signer of the Lab");
                Signed { sigs: vec![key.sign(op.id(), false)], op }
            }
        };
        let op = signed.verify()?.clone();
        self.held(to).view().step(&op)?;
        self.deliver(to, vec![signed], &Blobs::new());
        Ok(op.id())
    }
}

/// Open every box the device can: for one of `mine` (its own key, and what owners lend it), or for a key it already
/// opened; then every key published in the clear. A box counts only if what opens is the key it names.
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
/// oldest to the current one where nobody made one yet; each current key it holds announced if it is a vault or space
/// key nobody announced yet, boxed for every target without a box yet, and published if the family is public; and each
/// older key it holds wrapped under the next epoch's key if nobody wrapped it yet. `mine` are the keys of the signers
/// it may box for by wrapping: its own, and what owners lend it.
fn upkeep(d: SignerId, store: &mut Store, ix: &KeyIndex, mine: &[(SignerId, Secret)], rng: &mut SeededRng) -> Vec<Action> {
    let st = store.replay.state.clone();
    let families: Vec<KeyScope> = st.key_scopes().into_iter().filter(|&k| st.entitled(d, k)).collect();
    // a key for every epoch from the oldest it holds to the current one, where nobody made one yet: several rotations at
    // once leave the epochs between without a key, and the history must stay one chain
    for &k in &families {
        let e = st.epoch(k);
        let from = store.keys.values().filter(|o| o.key == k).map(|o| o.epoch + 1).min().unwrap_or(e).min(e);
        for x in from..=e {
            if store.held(k, x).next().is_none() && !ix.exists(k, x) {
                let secret = Secret::generate(rng);
                // keys are sealed to vault and space keys, never to an entry key, which is only ever wrapped under the
                // next one: only those carry a public half, announced below, and its McEliece pair takes a while
                if x == e && !matches!(k, KeyScope::Entry(..)) {
                    secret.prepare();
                }
                store.keys.insert(secret.id(), Opened { key: k, epoch: x, secret });
            }
        }
    }
    let mut out = vec![];
    for &k in &families {
        let e = st.epoch(k);
        let current: Vec<Secret> = store.held(k, e).map(|o| o.secret.clone()).collect();
        for secret in current {
            let id = secret.id();
            let sealed_to = !matches!(k, KeyScope::Entry(..));
            let new = sealed_to && !ix.made.get(&(k, e)).is_some_and(|m| m.iter().any(|x| x.0 == id));
            let public = new.then(|| {
                let public = secret.public();
                store.blobs.insert(public.mceliece, secret.mceliece_public());
                public
            });
            let mut boxes = vec![];
            for t in st.targets(k) {
                if !ix.boxed(k, e, id, t)
                    && let Some(b) = key_box(&secret, (k, e), t, &st, store, ix, mine, rng)
                {
                    boxes.push(b);
                }
            }
            let clear = (st.public_key(k) && !ix.cleared(id)).then(|| secret.bytes());
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

/// A box of `secret`, a key of family `of.0` at epoch `of.1`, for target `t`: wrapped under the target's key where
/// the device holds it (its own key, a key an owner lends it, or a family's key it opened), and sealed otherwise to the
/// target's public key, an X-Wing key and the McEliece blob it names, once the blob is checked against that name.
/// `None` while the device holds neither.
#[allow(clippy::too_many_arguments)]
fn key_box(
    secret: &Secret,
    of: (KeyScope, u64),
    t: KeyName,
    st: &State,
    store: &Store,
    ix: &KeyIndex,
    mine: &[(SignerId, Secret)],
    rng: &mut SeededRng,
) -> Option<KeyBox> {
    let (k, e) = of;
    let info = |to: &Recipient| box_info(k, e, secret.id(), to);
    let held = match t {
        KeyName::Signer(s) => mine.iter().find(|m| m.0 == s).map(|m| (Recipient::Signer(s), m.1.clone())),
        KeyName::Scoped(tk, te) => {
            store.held(tk, te).next().map(|o| (Recipient::Key { key: tk, epoch: te, id: o.secret.id() }, o.secret.clone()))
        }
    };
    if let Some((to, under)) = held {
        let bytes = keys::wrap(secret, &under, &info(&to), rng);
        return Some(KeyBox { to, bytes });
    }
    let (to, pk) = match t {
        KeyName::Signer(s) => (Recipient::Signer(s), st.seal_key(s)?),
        KeyName::Scoped(tk, te) => {
            let made = ix.made.get(&(tk, te))?.iter().filter(|(_, p)| store.blobs.contains_key(&p.mceliece));
            let (i, p) = made.min_by_key(|m| m.0)?;
            (Recipient::Key { key: tk, epoch: te, id: *i }, p)
        }
    };
    let blob = store.blobs.get(&pk.mceliece).filter(|b| BlobId::of(b) == pk.mceliece)?;
    let bytes = keys::seal(secret, pk, blob, &info(&to), rng)?;
    Some(KeyBox { to, bytes })
}

/// Rebuild what device `d` shows of each entry: its history, each write of its view with what the device can decrypt,
/// in replay order, and the item of each line. A write opens only under a key of its own entry at its own epoch.
fn show_items(d: SignerId, store: &mut Store) {
    let ops: HashMap<OpId, &Op> = store.replay.ids.iter().copied().zip(&store.replay.ops).collect();
    let st = store.view();
    let mut shown = BTreeMap::new();
    for space in st.spaces() {
        for &entry in &space.entries {
            let mut history = History::default();
            for w in st.all_writes().iter().filter(|w| w.space == space.id && w.entry == entry) {
                let op = ops[&w.op];
                let Action::Write { epoch, body, .. } = &op.action else { continue };
                let key = keys::edit_key(body).and_then(|id| store.keys.get(&id));
                let key = key.filter(|o| o.key == KeyScope::Entry(space.id, entry) && o.epoch == *epoch);
                let opened = key.and_then(|key| keys::open_edit(&key.secret, body, &write_context(op)));
                history.push(Commit { write: w.clone(), body: opened }).expect("the view's writes are causally closed");
            }
            let items = history.lines().into_iter().filter_map(|l| Some((l, history.item(l, d)?))).collect();
            shown.insert((space.id, entry), Shown { history, items });
        }
    }
    store.shown = shown;
}
