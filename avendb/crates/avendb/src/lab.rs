//! The Lab: in-process devices on a network the test controls. Each device has its own keys, its own edits and its own
//! store, exactly what a real device would hold; there is also a relay server, a device of the aven vault avenCEO,
//! which holds relay caps and never reads, and any number of strangers. The scenario tests run on it, and so do the
//! nodes: a device split off to run on its own (`split`) is what `avendb-net` puts on iroh.
//!
//! A vault is a flat library of entries (notes, todos, profiles), each with a type and tags, and caps grant relay,
//! read, write or owner on any slice of it (`slice::Selector`): the whole vault, a type, a tag, an author, one entry,
//! or any AND/OR of those. An entry sits in the cell of the caps whose slices hold it, and every rule, every key and
//! all sync go by cells (`policy`). The devices acting for a vault are its stewards: they read every selector of the
//! vault's caps and every entry's header and tags, and keep each entry in the cell its meaning asks for by moving it
//! (`policy::Meaning`). A steward creates an entry straight in its cell; anyone else creates it in the intake cell of
//! the cap it creates it through, for a steward to move. A write by anyone but the vault that adds or removes tags asks
//! the stewards to, and a steward answers it with a write acting for the vault, carrying what the asker's caps let it
//! ask for: the tags each cap's chain lets it relabel, where the cap's slice holds the entry before and after.
//!
//! A cap's selector travels sealed in the cap (`slice::Select`), to the seeds of the vault it is over, of its grantee
//! and of its issuer; a write's header, tags and content travel in its encrypted body (`slice::Body`). A device keeps
//! what it opened of both, as no edit changes them, and what it reads in them (`policy::Readings`).
//!
//! Every unlocked device keeps its keys up to date as an honest app would, each time its edits change. It opens every
//! box its standing `Keys` edits hold for a key it has and every key published in the clear, and derives the key of
//! each entry in each cell whose key it holds, for each stay the entry had there (`keys::entry_key`). For each family
//! it may open (a vault's seed, a cap's key, a cell's key), it makes a random key of each epoch from the oldest it
//! holds to the current one where nobody has yet; announces the public half of each current seed it holds, as keys are
//! sealed only to seeds and signers; boxes each current key for every target the schedule names that has no box yet,
//! wrapped where it holds the target's key, sealed to a signer's or a seed's public half otherwise, and left for a
//! steward where it is a cap's key it doesn't hold; publishes it if the family is public; and wraps each older key it
//! holds under the next epoch's. Where an entry moved to another cell, it wraps the keys of the entry's earlier stays
//! under the key it is under now (a move link), so the entry's readers read its whole history and nothing else of the
//! cells it left. An owner key (a passkey) authoring an edit on a device lends it, for that ceremony only, the key that
//! is sealed to the owner: that is how a new device reads again after every other device is lost.
//!
//! A device shows each entry on every line of its history (`history`): it opens each write it can, and builds the item
//! of each line from the updates of that line's history. Proposing, merging, promoting, restoring, undoing and making a
//! variant are writes like any edit, encrypted under the entry's key and checked against the writer's caps.
//!
//! A person's device derives its keys from their passkey at every unlock (`sign::Passkey::device`) and holds them only
//! while it is unlocked: a locked device keeps its edits and their ciphertext, and no key, nor anything a key opened.
//! The server and strangers have keys of their own. A passkey in the platform's authenticator signs in ceremonies
//! (`sign::Ceremony`): an edit is drafted (`draft`), each such passkey signs its id in a ceremony, and then it is kept
//! (`complete`); several edits drafted together (`drafting`) are signed in one ceremony, over their batch
//! (`sign::batch_challenge`). A browser's device holds the secret its keys derive from only while it is unlocked
//! (`device_with`): the PRF output its passkey evaluated on its salt, or a secret of its own masked by that output. A
//! device that doesn't know its passkey's P-256 key yet drafts its edits for each key the passkey's first ceremony
//! recovers to, all in one batch (`drafting_for`). A new device links to its person's vault by its passkey alone
//! (`link_card`, `join`, `accept_join`), and a server no vault has claimed yet becomes a device of a new aven vault,
//! avenCEO, owned by the human vault of the first device that claims it (`claim`, `accept_claim`).
//!
//! A Classic McEliece public key travels as a blob beside the edits that name it (`policy::Edit::blobs`): a device
//! keeps the blobs of the edits it keeps, each only if it hashes to its id, and seals to a key once it holds that key's
//! blob. Before it syncs, a device vouches for the writes it made since its last checkpoint
//! (`policy::Action::Checkpoint`); once peers stop trusting the curves (`set_pq_only`), each counts only the writes a
//! checkpoint by their author covers (`policy::checkpointed`), and checkpoints each write of its own as it makes it.
//! Devices sync by what each holds of each log, gossip one digest per log in random orders, and go offline and come
//! back; a device restored from a backup forks from what it made since (`forks`).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use rand_core::Rng as _;
use serde_json::Value;
use zeroize::Zeroizing;

use crate::doc::{Item, Version};
use crate::encode::{self, box_info, cap_context, select_info, write_context};
use crate::hash::{Hasher, Reader};
use crate::history::{Change, Draft, History, MAIN};
use crate::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use crate::keys::{self, KeyBox, KeyFam, KeyId, KeyName, PublicKey, Recipient, SeededRng, Secret};
use crate::lens::{Lane, Schema};
use crate::policy::{
    checkpointed, mk_cell, replay, Action, Cap, Edit, Grantee, Issued, Kind, Line, Log, Meaning, Principal, Proposal,
    Readings, Refusal, Replay, Role, State, Write,
};
use crate::rules::{Opening, Proof, Rule, Touch};
use crate::sign::{self, Ceremony, Classical, DeviceKey, Hello, Passkey, RelayPass, Signature, SignerKeys, Signed};
use crate::slice::{Attrs, Body, Header, Select, Selector, Slice, Sym, TagDelta};
use crate::sync::{
    answer, asks_ids, beyond, digests_ids, forks_in, link_places, log_of, logs_of, vault_logs, LogId, Place,
};
use crate::wire::{Claim, Join, Request, Wire as _};

/// A device keeps its keys and cells up to date in a few rounds at most: one to make and seal keys and move entries,
/// one to seal the keys of the cells they moved to and link their history, one to answer what moved, one to find
/// nothing left. More means an edit the rules refuse, made again and again.
const ROUNDS: usize = 10;

/// Blobs by id: the McEliece public keys a device holds, or sends beside its edits.
type Blobs = HashMap<BlobId, Arc<[u8]>>;

/// A tampering attempt, delivered to a device to show that it is rejected or opens nothing.
#[derive(Clone, Debug)]
pub enum Tamper {
    /// An edit the rules refuse, properly signed by `signers` and sent anyway: no cap, or a made-up chain.
    Unchecked { signers: Vec<SignerId>, action: Action },
    /// An edit claiming a signature from a signer that didn't sign it.
    ForgedSignature { claimed: SignerId, action: Action },
    /// An accepted write with one byte of its ciphertext changed.
    ChangedCiphertext(EditId),
    /// A key from before a removal, sealed again to the removed device and replayed.
    ReplayedSeal { key: KeyName, to: SignerId },
    /// An edit signed with only the classical half of `signer`'s key, as whoever broke its curve (ed25519, or a
    /// passkey's P-256) could sign it: the hash-based half is missing.
    BrokenClassicalKey { signer: SignerId, action: Action },
}

/// A signer's private keys.
enum Key {
    /// A device.
    Device(DeviceKey),
    Passkey(Passkey),
    /// A passkey in the platform's authenticator (P8e): no secret, only its keys and the public key sealed to it, as a
    /// ceremony showed them, and the id of that key, whose McEliece pair the process forgets as a device locks. It
    /// signs in a ceremony alone (`Lab::complete`).
    Web { keys: SignerKeys, seal: (PublicKey, Arc<[u8]>), pair: KeyId },
}

impl Key {
    /// Its signature on edit `edit`: `None` for a passkey in the platform's authenticator, which signs in a ceremony.
    fn sign(&mut self, edit: EditId, pq: bool) -> Option<Signature> {
        match self {
            Key::Device(k) => Some(k.sign(edit, pq)),
            Key::Passkey(p) => Some(p.sign(edit, pq)),
            Key::Web { .. } => None,
        }
    }

    /// The key that keys are sealed to for this signer: `None` for a passkey in the platform's authenticator, which
    /// lends it in a ceremony alone.
    fn seal_secret(&self) -> Option<Secret> {
        match self {
            Key::Device(k) => Some(k.seal_secret()),
            Key::Passkey(p) => Some(p.seal_secret()),
            Key::Web { .. } => None,
        }
    }

    /// The public key keys are sealed to for this signer, and the McEliece blob it names.
    fn seal_public(&self) -> (PublicKey, Arc<[u8]>) {
        match (self, self.seal_secret()) {
            (Key::Web { seal, .. }, _) => seal.clone(),
            (_, secret) => {
                let secret = secret.expect("a key at hand");
                (secret.public(), secret.mceliece_public())
            }
        }
    }

    fn keys(&self) -> SignerKeys {
        match self {
            Key::Device(k) => k.keys(),
            Key::Passkey(p) => p.keys(),
            Key::Web { keys, .. } => *keys,
        }
    }
}

/// An edit drafted on a device and checked by its view, unsigned yet, for the passkeys among its signers to sign in
/// their ceremonies (`Lab::draft`, P8e): its id is the challenge each ceremony signs, or its batch's if it was drafted
/// with others (`Lab::drafting`), and `Lab::complete` keeps it.
pub struct Unsigned {
    edit: Edit,
    blobs: Blobs,
    /// How many edits the device held as it drafted it, with those drafted before it in its batch.
    held: usize,
    /// The ids of the edits drafted together with it, its own among them, smallest first: one ceremony signs them all
    /// (`sign::batch_challenge`). Empty for an edit drafted alone.
    batch: Vec<EditId>,
    /// When the pass was made that the passkey signs it with, for an edit adding a new device, as the ceremony that
    /// unlocked the device signs it (`by_pass`).
    pass: Option<u64>,
}

/// The McEliece keys it brings show only their number.
impl std::fmt::Debug for Unsigned {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Unsigned").field("edit", &self.edit).field("blobs", &self.blobs.len()).finish_non_exhaustive()
    }
}

impl Unsigned {
    /// The edit drafted.
    pub fn edit(&self) -> &Edit {
        &self.edit
    }

    /// The same, for its passkey to sign with its pass for the new device it adds, made at `made`: the ceremony that
    /// unlocked the device, which is that pass, signs it, and no other ceremony (`sign::Ceremony::sign_adding`).
    pub fn by_pass(self, made: u64) -> Unsigned {
        Unsigned { pass: Some(made), batch: vec![], ..self }
    }

    /// What each passkey's ceremony signs: the edit's id, or, for edits drafted together (`Lab::drafting`), their
    /// batch's challenge, the same for each of them, so that one ceremony signs them all.
    pub fn challenge(&self) -> [u8; 32] {
        if self.batch.is_empty() { self.edit.id().0 } else { sign::batch_challenge(&self.batch) }
    }
}

/// Edits drafted on a device one after another, each building on those drafted before it, for its passkeys to sign all
/// of them in one ceremony (`Lab::drafting`): as a person's first device founds their vault and adds itself, and the
/// first to claim a server founds avenCEO and adds the server, in one ceremony instead of one for each edit.
pub struct Drafting<'a> {
    lab: &'a Lab,
    /// The device's log, with the edits drafted so far.
    log: Log,
    drafts: Vec<Unsigned>,
}

impl Drafting<'_> {
    /// Draft `action` signed by `signers`, as `Lab::draft` does, on top of the edits drafted before it: its edit's id.
    pub fn draft(&mut self, signers: &[SignerId], mut action: Action) -> Result<EditId, Refusal> {
        let (&author, cosigners) = signers.split_first().expect("an edit has an author");
        let blobs = self.lab.fill_seal_to(&mut action);
        let edit = self.log.check(author, cosigners, action)?;
        let (id, held) = (edit.id(), self.log.ids().len());
        self.log.receive([edit.clone()]);
        self.drafts.push(Unsigned { edit, blobs, held, batch: vec![], pass: None });
        Ok(id)
    }

    /// The drafts, in the order they were drafted, each to sign over their batch and keep in that order
    /// (`Lab::complete`).
    pub fn done(self) -> Vec<Unsigned> {
        let mut batch: Vec<EditId> = self.drafts.iter().map(|d| d.edit.id()).collect();
        batch.sort();
        let mut drafts = self.drafts;
        if drafts.len() > 1 {
            drafts.iter_mut().for_each(|d| d.batch = batch.clone());
        }
        drafts
    }
}

/// The keys a device holds, opened, made or derived: each by its id, with its name. A name can have more than one key,
/// as devices that make a family's key at the same time each make one; its keys are told apart by their ids.
#[derive(Default)]
struct Keyring {
    by_id: HashMap<KeyId, (KeyName, Secret)>,
    /// Each name's keys, the smallest id first.
    by_name: HashMap<KeyName, Vec<KeyId>>,
    /// The epochs of each family it holds a key of.
    epochs: HashMap<KeyFam, BTreeSet<u64>>,
    /// Its cell keys, in the order it took them: what the entry keys derive from.
    cells: Vec<KeyId>,
}

impl Keyring {
    /// Hold `secret` as a key of `name`: false if it holds that key already.
    fn insert(&mut self, name: KeyName, secret: Secret) -> bool {
        let id = secret.id();
        if self.by_id.contains_key(&id) {
            return false;
        }
        let ids = self.by_name.entry(name).or_default();
        let at = ids.partition_point(|x| *x < id);
        ids.insert(at, id);
        if let KeyName::Scoped(k, e) = name {
            self.epochs.entry(k).or_default().insert(e);
            if let KeyFam::Cell(..) = k {
                self.cells.push(id);
            }
        }
        self.by_id.insert(id, (name, secret));
        true
    }

    fn contains(&self, id: &KeyId) -> bool {
        self.by_id.contains_key(id)
    }

    /// Key `id`, if it holds it as a key of `name`.
    fn get(&self, id: &KeyId, name: KeyName) -> Option<&Secret> {
        self.by_id.get(id).filter(|(n, _)| *n == name).map(|(_, s)| s)
    }

    /// Its keys of `name`, the smallest id first.
    fn held(&self, name: KeyName) -> impl Iterator<Item = &Secret> {
        self.by_name.get(&name).into_iter().flatten().map(|id| &self.by_id[id].1)
    }

    fn first(&self, name: KeyName) -> Option<&Secret> {
        self.held(name).next()
    }

    /// The epochs of family `k` it holds a key of, the oldest first.
    fn epochs(&self, k: KeyFam) -> impl Iterator<Item = u64> + '_ {
        self.epochs.get(&k).into_iter().flatten().copied()
    }

    fn ids(&self) -> impl Iterator<Item = &KeyId> {
        self.by_id.keys()
    }

    fn secrets(&self) -> impl Iterator<Item = &Secret> {
        self.by_id.values().map(|(_, s)| s)
    }
}

/// What one device holds: its edits, each with its signatures, to pass on, and the blobs they name; what it makes of
/// them; the keys it holds; what it read with them; and the entries it shows.
struct Store {
    log: Log,
    signed: HashMap<EditId, Signed>,
    blobs: Blobs,
    /// The replay of its edits: which stand, and what it knows. Of the checkpointed ones only, once it no longer trusts
    /// the curves.
    replay: Replay,
    /// Empty while it is locked, as is everything below but what it made itself and has to vouch for.
    keys: Keyring,
    /// The entry keys it derived: by the key of the cell it derived each from, the entry and the stay.
    derived: HashSet<(KeyId, EntryId, Option<EditId>)>,
    /// The slices of the caps whose selectors it opened, and the caps whose selectors never open for it: garbled, or
    /// with no box for a key it holds that opens, or, where it is a steward, for no seed of the vault the cap is over.
    slices: HashMap<CapId, Slice>,
    unreadable: HashSet<CapId>,
    /// The bodies of the writes it opened, and the writes whose bodies never open: garbled under the key they name.
    bodies: HashMap<EditId, Body>,
    spoilt: HashSet<EditId>,
    /// What it reads of selectors, headers and tags, from the two above.
    readings: Readings,
    shown: BTreeMap<EntryId, Shown>,
    /// The writes it made itself that no checkpoint of its own covers yet.
    unvouched: Vec<EditId>,
    /// The digest of each log it holds (`sync::digests`), what it gossips: `None` until worked out for its edits now.
    digests: Option<BTreeMap<LogId, [u8; 32]>>,
}

impl Default for Store {
    fn default() -> Store {
        Store {
            log: Log::new(),
            signed: HashMap::new(),
            blobs: HashMap::new(),
            replay: replay(&[]),
            keys: Keyring::default(),
            derived: HashSet::new(),
            slices: HashMap::new(),
            unreadable: HashSet::new(),
            bodies: HashMap::new(),
            spoilt: HashSet::new(),
            readings: Readings::default(),
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

    /// Forget every key and everything a key opened, as it locks.
    fn forget(&mut self) {
        self.keys = Keyring::default();
        self.derived.clear();
        self.slices.clear();
        self.unreadable.clear();
        self.bodies.clear();
        self.spoilt.clear();
        self.readings = Readings::default();
        self.shown.clear();
    }

    /// It read the selector of every live cap over vault `v` and of every cap those rest on, or knows it never will:
    /// what a steward waits for before it works out any entry's cell.
    fn reads_caps(&self, st: &State, v: VaultId) -> bool {
        let read = |c: &CapId| self.slices.contains_key(c) || self.unreadable.contains(c);
        st.caps_over(v).filter(|cp| st.live(cp.id)).all(|cp| cp.chain.iter().all(read))
    }
}

/// What a device shows of one entry: its history, every accepted write with what the device could open, the item of
/// each line where it opens any update, and a hash of which writes it holds and opened, to build it again only once
/// that changes.
struct Shown {
    history: History,
    items: BTreeMap<Line, Item>,
    print: [u8; 32],
}

/// What a device's standing `Keys` edits say: the seeds announced, the boxes, and what is published.
#[derive(Default)]
struct KeyIndex {
    /// Each seed key announced, by name, with the public half keys are sealed to.
    made: HashMap<KeyName, Vec<(KeyId, PublicKey)>>,
    /// Each box, after the name and the id of the key it holds.
    boxes: Vec<(KeyName, KeyId, KeyBox)>,
    /// Which key has a box for which: its name, its id, the name of the key the box goes to.
    boxed: HashSet<(KeyName, KeyId, KeyName)>,
    /// Each key published in the clear, and their ids.
    clear: Vec<(KeyName, KeyId, [u8; 32])>,
    cleared: HashSet<KeyId>,
    /// The names some device made a key of: announced, boxed, wrapped or published, or with a box under it.
    exists: HashSet<KeyName>,
}

impl KeyIndex {
    fn of(r: &Replay) -> KeyIndex {
        let mut ix = KeyIndex::default();
        for (edit, _) in r.edits.iter().zip(&r.stood).filter(|(_, stood)| **stood) {
            if let Action::Keys { name, id, public, boxes, clear } = &edit.action {
                ix.exists.insert(*name);
                if let Some(p) = public {
                    ix.made.entry(*name).or_default().push((*id, p.clone()));
                }
                for b in boxes {
                    ix.exists.insert(b.to.name());
                    ix.boxed.insert((*name, *id, b.to.name()));
                    ix.boxes.push((*name, *id, b.clone()));
                }
                if let Some(c) = clear {
                    ix.clear.push((*name, *id, *c));
                    ix.cleared.insert(*id);
                }
            }
        }
        ix
    }

    /// Key `id` of `name` is announced, its public half with it.
    fn announced(&self, name: KeyName, id: KeyId) -> bool {
        self.made.get(&name).is_some_and(|m| m.iter().any(|x| x.0 == id))
    }
}

/// How many spare keys each new Lab keeps (`Lab::keep_spares`): none unless a page making McEliece pairs in its
/// workers asks for some (`spare_keys`), as a test would make pairs it never uses.
static SPARES: AtomicUsize = AtomicUsize::new(0);

/// Have every Lab made from now on keep `n` spare keys.
pub fn spare_keys(n: usize) {
    SPARES.store(n, Ordering::Relaxed);
}

/// Keys made ahead for seeds, each with its McEliece pair on its way.
#[derive(Default)]
struct Spares {
    keys: VecDeque<Secret>,
    keep: usize,
}

impl Spares {
    /// A key to seal to: the oldest spare, or a new key if there is none, its pair started; then spares again.
    fn take(&mut self, rng: &mut SeededRng) -> Secret {
        let key = self.keys.pop_front().unwrap_or_else(|| {
            let key = Secret::generate(rng);
            key.prepare();
            key
        });
        self.fill(rng);
        key
    }

    fn fill(&mut self, rng: &mut SeededRng) {
        while self.keys.len() < self.keep {
            let key = Secret::generate(rng);
            key.prepare();
            self.keys.push_back(key);
        }
    }
}

/// A copy of what a device holds, as a backup keeps it: its signed edits and the blobs they name.
#[derive(Clone)]
pub struct Backup {
    signed: Vec<Signed>,
    blobs: Blobs,
}

impl Backup {
    /// A backup of signed edits, in the order the device took them, and McEliece keys, each under the id it hashes to:
    /// what a node reads back from its store on disk.
    pub fn new(signed: Vec<Signed>, blobs: impl IntoIterator<Item = Arc<[u8]>>) -> Backup {
        Backup { signed, blobs: blobs.into_iter().map(|b| (BlobId::of(&b), b)).collect() }
    }

    /// Its signed edits, in the order the device took them.
    pub fn signed(&self) -> &[Signed] {
        &self.signed
    }

    /// How many McEliece keys it holds.
    pub fn blob_count(&self) -> usize {
        self.blobs.len()
    }
}

/// A cap to issue (`Lab::issue`): its grantee holds `role` over the entries of vault `over` that `slice` selects, and
/// may ask the vault's stewards to add or remove the tags its relabel set names. A slice that selects all makes a wide
/// cap. With `rules`, a cap with write or more lets its grantee's writes make only the ops they name (`rules`), and
/// the caps resting on it no more; the Lab seals them into its slice with a salt of their own.
#[derive(Clone, Debug)]
pub struct NewCap {
    pub over: VaultId,
    pub grantee: Grantee,
    pub role: Role,
    pub slice: Slice,
    /// The owner cap its issuer relies on: `None` when the vault itself issues it.
    pub parent: Option<CapId>,
    pub issuer: VaultId,
    pub rules: Option<Vec<Rule>>,
}

/// One edit a device's upkeep calls for.
#[derive(Debug)]
enum Work {
    /// An edit signed as it is: a `Keys` edit, or a steward's move.
    Edit(Action),
    /// A steward's write acting for vault `vault` on entry `entry`, carrying `body`: its answer to asks for tags.
    Retag { vault: VaultId, entry: EntryId, body: Body },
}

pub struct Lab {
    /// The keys at hand: passkeys, owner keys, and unlocked devices.
    keys: HashMap<SignerId, Key>,
    /// Every signer's name, as the Lab made it.
    names: HashMap<SignerId, String>,
    /// Each device whose keys derive from a passkey: that passkey, and the 32 bytes that end the device's salt.
    salts: HashMap<SignerId, (SignerId, [u8; 32])>,
    /// Devices in the order they were made.
    devices: Vec<SignerId>,
    stores: HashMap<SignerId, Store>,
    /// Keys made so far; each key's seed counts on from here.
    made: u64,
    /// The randomness of new keys, seals and nonces, which keeps nothing that draws again what it drew
    /// (`keys::SeededRng`).
    rng: SeededRng,
    /// A Lab on a machine of its own (`with_entropy`, `split`): every key it makes draws from its randomness too, so
    /// that no two machines make the same keys under the same name.
    on_machine: bool,
    spares: Spares,
    /// No device trusts the curves anymore: each counts only checkpointed writes.
    pq_only: bool,
    /// The devices off the network: they neither send nor receive.
    offline: HashSet<SignerId>,
    /// The time a new entry's header says it was created at, in seconds since 1970 (`set_now`).
    now: u64,
    /// A dry run (`dry`): a write is checked, proven and refused as ever, and then not made.
    dry: bool,
    /// Its devices are a patched app's (`patched`): they ignore the rules of the caps they write through, and the
    /// schemas of what they write.
    lawless: bool,
}

impl Default for Lab {
    fn default() -> Lab {
        Lab::new()
    }
}

impl Lab {
    pub fn new() -> Lab {
        Lab::seeded(None)
    }

    /// A Lab on a machine of its own, for the one device it runs (P8b): its randomness, and every key it makes,
    /// drawn from `seed` too, 32 bytes of the machine's own randomness, so that no two machines make the same keys or
    /// nonces. It keeps the seed no longer than it takes to seed its randomness.
    pub fn with_entropy(seed: [u8; 32]) -> Lab {
        Lab::seeded(Some(Zeroizing::new(seed)))
    }

    fn seeded(entropy: Option<Zeroizing<[u8; 32]>>) -> Lab {
        let mut lab = Lab {
            keys: HashMap::new(),
            names: HashMap::new(),
            salts: HashMap::new(),
            devices: vec![],
            stores: HashMap::new(),
            made: 0,
            rng: SeededRng::new("lab randomness", entropy.as_ref().map_or(&[][..], |e| &e[..])),
            on_machine: entropy.is_some(),
            spares: Spares::default(),
            pq_only: false,
            offline: HashSet::new(),
            now: 0,
            dry: false,
            lawless: false,
        };
        lab.keep_spares(SPARES.load(Ordering::Relaxed));
        lab
    }

    /// Keep `n` keys made ahead for the seeds devices make, each with its McEliece pair on its way
    /// (`keys::Secret::prepare`), so that making one never waits for its pair: a device takes a spare and makes
    /// another. A real device would do the same, as making a pair takes most of a second.
    pub fn keep_spares(&mut self, n: usize) {
        self.spares.keep = n;
        self.spares.fill(&mut self.rng);
    }

    /// The time new entries' headers say they were created at, from now on, in seconds since 1970: a node sets it from
    /// its clock before it creates an entry. A Lab starts at 0.
    pub fn set_now(&mut self, now: u64) {
        self.now = now;
    }

    /// The name the Lab made signer `s` with.
    pub fn name(&self, s: SignerId) -> Option<&str> {
        self.names.get(&s).map(String::as_str)
    }

    /// The devices, in the order they were made.
    pub fn devices(&self) -> &[SignerId] {
        &self.devices
    }

    /// The seed of the next key the Lab makes: the Lab is deterministic, so a failing test replays exactly. On a
    /// machine of its own, drawn from its randomness too.
    fn seed(&mut self, what: &str, name: &str) -> Reader {
        self.made += 1;
        let mut h = Hasher::new("lab key");
        h.update(&self.made.to_be_bytes()).update(&(what.len() as u32).to_be_bytes());
        h.update(what.as_bytes()).update(name.as_bytes());
        if self.on_machine {
            let mut drawn = Zeroizing::new([0u8; 32]);
            self.rng.fill_bytes(&mut *drawn);
            h.update(&*drawn);
        }
        h.reader()
    }

    fn secret(&mut self, what: &str, name: &str) -> [u8; 32] {
        self.seed(what, name).array()
    }

    /// A passkey: an owner signer that governs a human vault. It signs on whichever device it is used on.
    pub fn passkey(&mut self, name: &str) -> SignerId {
        let secret = self.secret("passkey", name);
        self.passkey_from(name, secret)
    }

    /// The passkey a software passkey's secret makes again (`passkey_secret`), as a platform syncs a passkey to another
    /// of its person's devices: a page holding its person's passkey (P8d) brings it into its Lab this way.
    pub fn passkey_from(&mut self, name: &str, secret: [u8; 32]) -> SignerId {
        let key = Passkey::from_seed(secret);
        key.seal_secret().prepare();
        let id = key.id();
        self.keys.insert(id, Key::Passkey(key));
        self.names.insert(id, if name.ends_with("passkey") { name.into() } else { format!("{name}'s passkey") });
        id
    }

    /// The secret of passkey `passkey`, a software passkey's private key, for another Lab to take it in
    /// (`passkey_from`): `None` if the Lab doesn't hold that passkey. A real passkey never leaves its authenticator.
    pub fn passkey_secret(&self, passkey: SignerId) -> Option<Zeroizing<[u8; 32]>> {
        match self.keys.get(&passkey)? {
            Key::Passkey(p) => Some(p.secret()),
            Key::Device(_) | Key::Web { .. } => None,
        }
    }

    /// A device with keys of its own, as the server and strangers have, its own edits and its own store.
    pub fn device(&mut self, name: &str) -> SignerId {
        let key = DeviceKey::from_secret(self.secret("device", name));
        self.add_device(key, name)
    }

    /// A person's device: its keys derive from `passkey`'s PRF output on a salt of the device's own, as it derives
    /// them at every unlock. It starts unlocked.
    pub fn device_of(&mut self, passkey: SignerId, name: &str) -> SignerId {
        let nonce = self.secret("device salt", name);
        let Some(Key::Passkey(p)) = self.keys.get(&passkey) else { panic!("{passkey:?} is no passkey the Lab holds") };
        let id = self.add_device(p.device(nonce), name);
        self.salts.insert(id, (passkey, nonce));
        id
    }

    /// A device whose keys come from `secret`, 32 bytes the device keeps itself, as the server does on its disk; or that
    /// a browser's device holds while it is unlocked (P8e): the PRF output its passkey evaluated on the device's salt
    /// (`sign::device_salt`), or, for a device made since 2026-10-10, a secret of its own that this output masks. It
    /// starts unlocked.
    pub fn device_with(&mut self, name: &str, secret: [u8; 32]) -> SignerId {
        self.add_device(DeviceKey::from_secret(secret), name)
    }

    /// A passkey in the platform's authenticator (P8e), whose P-256 key is `p256`, as a ceremony of it over any
    /// challenge showed it (`sign::Ceremony`): the Lab holds its keys and the public key sealed to it, which the
    /// ceremony's PRF output derives, and no secret. It signs in ceremonies alone (`complete`). `None` unless the
    /// ceremony's assertion is that key's.
    pub fn web_passkey(&mut self, name: &str, p256: [u8; 33], ceremony: &Ceremony) -> Option<SignerId> {
        if !ceremony.challenge().is_some_and(|c| ceremony.assertion.verify(&p256, EditId(c))) {
            return None;
        }
        let secret = ceremony.seal_secret();
        let (seal, pair) = ((secret.public(), secret.mceliece_public()), secret.id());
        let keys = ceremony.keys(p256);
        let id = keys.id();
        self.keys.insert(id, Key::Web { keys, seal, pair });
        self.names.insert(id, if name.ends_with("passkey") { name.into() } else { format!("{name}'s passkey") });
        Some(id)
    }

    /// The public keys of signer `s`, if its key is at hand: a passkey's, or a device's while it is unlocked.
    pub fn keys_of(&self, s: SignerId) -> Option<SignerKeys> {
        self.keys.get(&s).map(Key::keys)
    }

    fn add_device(&mut self, key: DeviceKey, name: &str) -> SignerId {
        key.seal_secret().prepare();
        let id = key.id();
        self.keys.insert(id, Key::Device(key));
        self.names.insert(id, name.to_string());
        self.devices.push(id);
        self.stores.insert(id, Store::default());
        id
    }

    /// The key to seal to of device `d`, a server no vault has claimed yet, as it hands it to the first device of a
    /// human vault that asks (P8f): the claim's edit names it (`claim`). `AlreadyMember` if a vault has claimed `d`
    /// already, `Locked` if `d` is.
    pub fn claim_key(&self, d: SignerId) -> Result<PublicKey, Refusal> {
        if self.vault_of(d).is_some() {
            return Err(Refusal::AlreadyMember);
        }
        Ok(self.seal_public(d).ok_or(Refusal::Locked)?.0)
    }

    /// Device `on`'s claim of a server no vault has claimed yet (P8f): `draft` (`draft`, `drafting`) adds the server's
    /// device to an aven vault `on`'s view holds, the new avenCEO, owned by `on`'s human vault, its key to seal to the
    /// one the server handed (`claim_key`). Every signer but the server signs it here, each by its ceremony among
    /// `ceremonies` or by its key at hand, and the claim brings the logs the server checks it by, and no others:
    /// avenCEO's and its owners', up the chains (`sync::vault_logs`). The server signs last, and keeps it all
    /// (`accept_claim`). `NotClaiming` if `draft` adds no device to an aven vault, `Locked` if a signer's key isn't at
    /// hand, `BadSignature` if a ceremony isn't its signer's over the draft's challenge.
    pub fn claim(
        &mut self,
        on: SignerId,
        draft: Unsigned,
        ceremonies: &[(SignerId, &Ceremony)],
    ) -> Result<Claim, Refusal> {
        let Unsigned { edit, batch, .. } = draft;
        let Action::AddDevice { vault, device: server, .. } = edit.action else { return Err(Refusal::NotClaiming) };
        if !self.held(on).view().vault(vault).is_some_and(|v| v.kind == Kind::Aven) {
            return Err(Refusal::NotClaiming);
        }
        let (id, pq) = (edit.id(), sign::needs_pq(&edit));
        let signers: Vec<SignerId> = edit.sigs().filter(|&s| s != server).collect();
        let signature = |s| self.sign_by(s, id, pq, ceremonies, &batch, None);
        let sigs = signers.into_iter().map(signature).collect::<Result<_, _>>()?;
        let store = self.held(on);
        let logs: Vec<EditId> = vault_logs(store.log.edits(), store.view(), vec![vault]).iter().map(Edit::id).collect();
        let (card, _) = self.outgoing(on, &logs);
        Ok(Claim { card, add: edit, sigs })
    }

    /// The aven vault device `server` belongs to by device `d`'s view: avenCEO, once `d`'s person claimed the server
    /// (`claim`), or once `d` holds the server's card (`card`).
    pub fn aven_of(&self, d: SignerId, server: SignerId) -> Option<VaultId> {
        let st = self.held(d).view();
        let aven = st.vaults().iter().find(|v| v.kind == Kind::Aven && v.devices.contains(&server))?;
        Some(aven.id)
    }

    /// An aven vault device `d`'s own vault alone owns that has no device yet, by `d`'s view: the avenCEO a claim
    /// founded that the server didn't take, which a claim tried again adds the server to rather than found another.
    pub fn unclaimed_aven(&self, d: SignerId) -> Option<VaultId> {
        let mine = Principal::Vault(self.vault_of(d)?);
        let st = self.held(d).view();
        let aven = st.vaults().iter().find(|v| v.kind == Kind::Aven && v.devices.is_empty() && v.owners == [mine])?;
        Some(aven.id)
    }

    /// Device `d`, a server no vault has claimed yet, takes a device's claim of it (`claim`, P8f): `d` signs the
    /// claim's edit too, in its place among the edit's signers, and keeps it, with the vault logs the claim brings,
    /// only if every signature checks out and, with them, its view makes `d` a device of an aven vault. So the first
    /// human vault to claim the server owns avenCEO, and the server acts for avenCEO but never governs it. The server's
    /// join, for the claiming device to keep too: the edit, signed, and the McEliece key it names, the server's own.
    /// `AlreadyMember` as `claim_key` says; `NotClaiming` if the edit adds another device, seals to another key than
    /// the one `d` handed, or adds `d` to anything but an aven vault; `BadSignature` if a signature doesn't verify, or
    /// one is missing or left over; otherwise why `d`'s view, with the logs the claim brings, refuses the edit.
    pub fn accept_claim(&mut self, d: SignerId, claim: Claim) -> Result<Join, Refusal> {
        let key = self.claim_key(d)?;
        let Claim { card, add, sigs } = claim;
        let Action::AddDevice { vault, device, seal_to: Some(sealed) } = &add.action else {
            return Err(Refusal::NotClaiming);
        };
        if *device != d || *sealed != key {
            return Err(Refusal::NotClaiming);
        }
        let vault = *vault;
        // the claim brings vault logs, and nothing else, each edit signed
        let vault_log = |s: &Signed| matches!(log_of(&s.edit, s.edit.id()), Some(LogId::Vault(_)));
        let card: Vec<Signed> = card.into_iter().filter(vault_log).collect();
        for signed in &card {
            signed.verify()?;
        }
        // its own signature in its place among the edit's signers, the others' in theirs
        let (id, pq) = (add.id(), sign::needs_pq(&add));
        let mine = self.sign_by(d, id, pq, &[], &[], None)?;
        let mut theirs = sigs.into_iter();
        let all: Option<Vec<Signature>> =
            add.sigs().map(|s| if s == d { Some(mine.clone()) } else { theirs.next() }).collect();
        let all = all.filter(|_| theirs.next().is_none()).ok_or(Refusal::BadSignature)?;
        let signed = Signed { edit: add, sigs: all };
        signed.verify()?;
        // with the logs it brings, its view accepts the edit, and makes `d` a device of an aven vault
        let mut log = self.held(d).log.clone();
        log.receive(card.iter().map(|s| s.edit.clone()));
        log.view().step(&signed.edit)?;
        log.receive([signed.edit.clone()]);
        if !log.view().vault(vault).is_some_and(|v| v.kind == Kind::Aven && v.devices.contains(&d)) {
            return Err(Refusal::NotClaiming);
        }
        let blobs: Blobs = self.seal_public(d).map(|(_, blob)| (key.mceliece, blob)).into_iter().collect();
        let join = Join { edit: signed.clone(), blobs: blobs.values().map(|b| b.to_vec()).collect() };
        self.deliver(d, card.into_iter().chain([signed]).collect(), &blobs);
        Ok(join)
    }

    /// Signer `s`'s signature on edit `id`: by its ceremony among `ceremonies`, over the edit's id or, with the edits
    /// `batch` drafted together, over theirs (`Ceremony::sign_in`), or, with `pass`, the device an edit adds and when
    /// the pass was made, as the passkey's pass for that device (`Ceremony::sign_adding`); or by its key at hand; both
    /// halves if `pq`. `Locked` if its key isn't at hand, `BadSignature` if its ceremony isn't its own over that
    /// challenge.
    fn sign_by(
        &mut self,
        s: SignerId,
        id: EditId,
        pq: bool,
        ceremonies: &[(SignerId, &Ceremony)],
        batch: &[EditId],
        pass: Option<(SignerId, u64)>,
    ) -> Result<Signature, Refusal> {
        match ceremonies.iter().find(|(c, _)| *c == s) {
            Some((_, c)) => {
                let keys = self.keys_of(s).ok_or(Refusal::Locked)?;
                let signed = match pass {
                    Some((device, made)) => c.sign_adding(keys, id, device, made),
                    None => c.sign_in(keys, id, batch, pq),
                };
                signed.ok_or(Refusal::BadSignature)
            }
            None => self.keys.get_mut(&s).and_then(|k| k.sign(id, pq)).ok_or(Refusal::Locked),
        }
    }

    /// The vault device `d` belongs to, by its view.
    pub fn vault_of(&self, d: SignerId) -> Option<VaultId> {
        self.held(d).view().vaults().iter().find(|v| v.devices.contains(&d)).map(|v| v.id)
    }

    /// Device `d`'s contact card: the signed edits of the logs of the vaults it acts for and of every vault that owns
    /// one of them, up the chains (`sync::vault_logs`), as a device needs them before it grants one of those vaults
    /// anything. The server hands out its own to whoever asks.
    pub fn card(&self, d: SignerId) -> Vec<Signed> {
        let store = self.held(d);
        let st = store.view();
        let vs = st.vaults().iter().map(|v| v.id).filter(|&v| st.acts_for(d, v)).collect();
        vault_logs(store.log.edits(), st, vs).iter().map(|edit| store.signed[&edit.id()].clone()).collect()
    }

    /// Lock device `d`: its keys, and every key and item they opened, leave its memory, each key wiped. So does the
    /// secret half of each of their McEliece pairs that nothing else here holds (`keys::forget_pairs`): another
    /// signer's own key, a key another device holds, or a spare. Its edits and their ciphertext stay, and it still
    /// receives and passes on edits.
    pub fn lock(&mut self, d: SignerId) {
        let own = self.keys.remove(&d).and_then(|k| k.seal_secret()).map(|s| s.id());
        let mut gone: BTreeSet<KeyId> = own.into_iter().collect();
        let store = self.stores.get_mut(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        gone.extend(store.keys.ids());
        store.forget();
        // what passkeys in the platform's authenticator lent in their ceremonies, nothing here holds
        gone.extend(self.keys.values().filter_map(|k| if let Key::Web { pair, .. } = k { Some(*pair) } else { None }));
        for secret in self.keys.values().filter_map(Key::seal_secret) {
            gone.remove(&secret.id());
        }
        for id in self.stores.values().flat_map(|store| store.keys.ids()) {
            gone.remove(id);
        }
        for spare in &self.spares.keys {
            gone.remove(&spare.id());
        }
        keys::forget_pairs(gone);
    }

    /// Unlock device `d` with the passkey its keys derive from: they derive again, and it opens again what its edits
    /// hold for it. False if its keys derive from no passkey (the server, a stranger), or the passkey is lost.
    pub fn unlock(&mut self, d: SignerId) -> bool {
        let Some(&(passkey, nonce)) = self.salts.get(&d) else { return false };
        let Some(Key::Passkey(p)) = self.keys.get(&passkey) else { return false };
        let key = p.device(nonce);
        assert_eq!(key.id(), d, "the same passkey and salt derive the same device");
        self.take_key(d, key);
        true
    }

    /// Unlock device `d` with `secret`, the secret its keys come from, as a browser's device unlocks with what its
    /// passkey's ceremony brings back (P8e, `device_with`): its keys derive again. False if they derive another device.
    pub fn unlock_with(&mut self, d: SignerId, secret: [u8; 32]) -> bool {
        let key = DeviceKey::from_secret(secret);
        if key.id() != d || !self.stores.contains_key(&d) {
            return false;
        }
        self.take_key(d, key);
        true
    }

    /// Device `d` holds its keys again, and opens again what its edits hold for it.
    fn take_key(&mut self, d: SignerId, key: DeviceKey) {
        // its own key, which only the passkey derives again, reseeds the randomness: a copy of the Lab's memory taken
        // while the device was locked doesn't foresee what it draws now
        self.rng.reseed(key.seal_secret().as_bytes());
        self.keys.insert(d, Key::Device(key));
        self.refresh(d, &[]);
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
        Some(self.keys.get(&s)?.seal_public())
    }

    /// Sign `edit` with the key of each of its signers: both halves, or on a write the classical half alone. `Locked`
    /// if a signer's key isn't at hand.
    fn sign(&mut self, edit: Edit) -> Result<Signed, Refusal> {
        let (id, pq) = (edit.id(), sign::needs_pq(&edit));
        let mut sigs = vec![];
        for s in edit.sigs() {
            sigs.push(self.keys.get_mut(&s).and_then(|k| k.sign(id, pq)).ok_or(Refusal::Locked)?);
        }
        Ok(Signed { edit, sigs })
    }

    /// Device `to` keeps signed edits, and the blobs among `blobs` they name: each edit once, and only if every
    /// signature checks out. Whether the edits stand is for its replay to say; a blob is checked against its id before
    /// anything is sealed with it (`key_box`). True if any edit was new.
    fn keep(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs) -> bool {
        let Some(store) = self.stores.get_mut(&to) else { return false };
        let mut new = false;
        for signed in edits {
            // an edit it holds was checked when it arrived; a copy with other signatures adds nothing
            let id = signed.edit.id();
            if store.signed.contains_key(&id) || signed.verify().is_err() {
                continue;
            }
            for b in signed.edit.blobs() {
                if let Some(bytes) = blobs.get(&b) {
                    store.blobs.entry(b).or_insert_with(|| bytes.clone());
                }
            }
            store.log.receive([signed.edit.clone()]);
            store.signed.insert(id, signed);
            new = true;
        }
        if new {
            store.digests = None;
        }
        new
    }

    /// Device `to` receives signed edits and their blobs, and brings its keys and items up to date if any edit was new.
    fn deliver(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs) {
        if self.keep(to, edits, blobs) {
            self.refresh(to, &[]);
        }
    }

    /// What device `d` sends with the edits `ids`: each with its signatures, and the blobs they name.
    fn outgoing(&self, d: SignerId, ids: &[EditId]) -> (Vec<Signed>, Blobs) {
        let store = self.held(d);
        let signed: Vec<Signed> = ids.iter().map(|id| store.signed[id].clone()).collect();
        let blobs = signed
            .iter()
            .flat_map(|s| s.edit.blobs())
            .filter_map(|b| Some((b, store.blobs.get(&b)?.clone())))
            .collect();
        (signed, blobs)
    }

    /// Device `from` hands vault `v`'s log to device `to`, as when two people exchange contact cards: a peer needs a
    /// vault's log before it accepts a cap to that vault.
    pub fn share_contact(&mut self, from: SignerId, to: SignerId, v: VaultId) {
        let store = self.held(from);
        let ids: Vec<EditId> = vault_logs(store.log.edits(), store.view(), vec![v]).iter().map(Edit::id).collect();
        let (signed, blobs) = self.outgoing(from, &ids);
        self.deliver(to, signed, &blobs);
    }

    /// Sign `action` by `signers` and keep it on device `on`, if `on`'s view accepts it. The author, the first signer,
    /// signs on `on`; cosigners sign on their own devices. A signer's key to seal to that the action brings is filled
    /// in when the Lab holds that signer.
    pub fn submit(&mut self, on: SignerId, signers: &[SignerId], action: Action) -> Result<EditId, Refusal> {
        let draft = self.draft(on, signers, action)?;
        self.complete(on, draft, &[])
    }

    /// Draft `action` signed by `signers` on device `on`, as `submit` does, for the passkeys among them in the
    /// platform's authenticator to sign in their ceremonies (P8e): checked by `on`'s view, with the keys to seal to
    /// it brings filled in. Its edit's id is the challenge each ceremony signs; `complete` keeps it.
    pub fn draft(&mut self, on: SignerId, signers: &[SignerId], mut action: Action) -> Result<Unsigned, Refusal> {
        let (&author, cosigners) = signers.split_first().expect("an edit has an author");
        let blobs = self.fill_seal_to(&mut action);
        let log = &self.held(on).log;
        let edit = log.check(author, cosigners, action)?;
        Ok(Unsigned { edit, blobs, held: log.ids().len(), batch: vec![], pass: None })
    }

    /// Edits to draft on device `on` one after another, each on top of those before it, for the passkeys among their
    /// signers to sign all of them in one ceremony (`Drafting`, `sign::batch_challenge`): what a browser asks its
    /// person once for, where it would otherwise ask once for each edit.
    pub fn drafting(&self, on: SignerId) -> Drafting<'_> {
        Drafting { lab: self, log: self.held(on).log.clone(), drafts: vec![] }
    }

    /// Edits to draft on device `on` for each of `passkeys`, one of which is its person's, as a device that doesn't
    /// know yet which of the keys the passkey's first ceremony recovers to is the passkey's (`sign::RelayPass`): `draft`
    /// drafts a set for each passkey, each set on its own (`drafting`), and every edit of every set is signed over one
    /// batch, so that the person's next ceremony signs them all and verifies under their passkey's key alone. Its set is
    /// the one to keep (`complete`); the others' edits nobody ever signs, and their ids show only inside the batch. Each
    /// passkey with what `draft` returned for it and its set.
    pub fn drafting_for<T>(
        &self,
        on: SignerId,
        passkeys: &[SignerId],
        draft: impl Fn(&mut Drafting<'_>, SignerId) -> Result<T, Refusal>,
    ) -> Result<Vec<(SignerId, T, Vec<Unsigned>)>, Refusal> {
        let mut sets = vec![];
        for &passkey in passkeys {
            let mut drafting = self.drafting(on);
            let out = draft(&mut drafting, passkey)?;
            sets.push((passkey, out, drafting.drafts));
        }
        let mut batch: Vec<EditId> = sets.iter().flat_map(|(_, _, drafts)| drafts.iter().map(|d| d.edit.id())).collect();
        batch.sort();
        batch.dedup();
        if batch.len() > 1 {
            sets.iter_mut().flat_map(|(_, _, drafts)| drafts.iter_mut()).for_each(|d| d.batch = batch.clone());
        }
        Ok(sets)
    }

    /// Sign `draft` (`draft`, `drafting`) and keep it on device `on`: each signer by its ceremony among `ceremonies`,
    /// or by its key at hand. `on`'s view checks the edit again if edits arrived since the draft. An owner key
    /// authoring it lends `on`, for this ceremony, what is sealed to it: from its ceremony, a passkey in the platform's
    /// authenticator. `Locked` if a signer's key isn't at hand, `BadSignature` if a ceremony isn't its signer's over
    /// the draft's challenge.
    pub fn complete(
        &mut self,
        on: SignerId,
        draft: Unsigned,
        ceremonies: &[(SignerId, &Ceremony)],
    ) -> Result<EditId, Refusal> {
        let Unsigned { edit, blobs, held, batch, pass } = draft;
        if self.held(on).log.ids().len() != held {
            self.held(on).view().step(&edit)?;
        }
        let (id, pq) = (edit.id(), sign::needs_pq(&edit));
        let ceremony = |s: SignerId| ceremonies.iter().find(|(c, _)| *c == s).map(|(_, c)| *c);
        let signers: Vec<SignerId> = edit.sigs().collect();
        let pass = match (&edit.action, pass) {
            (Action::AddDevice { device, .. }, Some(made)) => Some((*device, made)),
            (_, Some(_)) => return Err(Refusal::BadSignature),
            (_, None) => None,
        };
        // the pass signs for the passkey alone: every other signer as ever
        let signature = |s: SignerId| {
            let by_pass = pass.filter(|_| matches!(self.keys_of(s), Some(SignerKeys::Passkey { .. })));
            self.sign_by(s, id, pq, ceremonies, &batch, by_pass)
        };
        let sigs = signers.into_iter().map(signature).collect::<Result<_, _>>()?;
        let signed = Signed { edit, sigs };
        debug_assert!(signed.verify().is_ok());
        // an owner key authoring on this device lends it, for this ceremony, what is sealed to it
        let author = signed.edit.author;
        let lent: Vec<(SignerId, Secret)> = match (ceremony(author), self.keys.get(&author)) {
            (Some(c), _) => vec![(author, c.seal_secret())],
            (None, Some(key)) if !self.devices.contains(&author) => {
                key.seal_secret().map(|s| (author, s)).into_iter().collect()
            }
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

    /// Issue a cap on device `on`, signed by `signers`, if `on`'s view accepts it: its id. An owner cap is governance,
    /// so the issuer's root, or its threshold of owners, signs too. Its selector is sealed (`slice::Select`).
    /// `UnknownKey` if `on` can't seal it to the vault the cap is over, or to its grantee, as it holds no seed of
    /// theirs nor its announced public half.
    pub fn issue(&mut self, on: SignerId, signers: &[SignerId], cap: NewCap) -> Result<CapId, Refusal> {
        let draft = self.draft_cap(on, signers, cap)?;
        self.complete(on, draft, &[]).map(CapId::from)
    }

    /// The cap `issue` issues, drafted for the passkeys among its signers to sign in their ceremonies (`draft`). A
    /// cap with write or more carries its rules, if any, and the openings of the ruled caps it rests on, which its
    /// issuer reads in the slice of the cap it rests on: so its grantee can prove its writes (`rules::Proof`).
    /// `NotAllowed` if the cap it rests on is ruled and `on` doesn't read that cap's slice.
    pub fn draft_cap(&mut self, on: SignerId, signers: &[SignerId], new: NewCap) -> Result<Unsigned, Refusal> {
        self.unlocked(on)?;
        let NewCap { over, grantee, role, mut slice, parent, issuer, rules } = new;
        (slice.rules, slice.above) = (None, vec![]);
        if role.allows(Role::Write) {
            let store = self.held(on);
            let ruled = parent.and_then(|p| store.view().cap(p)).filter(|p| p.ruled);
            if let Some(p) = ruled {
                slice.above = store.slices.get(&p.id).map(Slice::openings).ok_or(Refusal::NotAllowed)?;
            }
            slice.rules = rules.map(|rules| {
                let mut salt = [0u8; 32];
                self.rng.fill_bytes(&mut salt);
                Opening { rules, salt }
            });
        }
        let wide = slice.select == Selector::All;
        let nonce = self.rng.next_u64();
        let mut cap = Cap { over, grantee, role, wide, select: vec![], parent, issuer, nonce };
        cap.select = self.seal_select(on, &cap, &slice)?;
        self.draft(on, signers, Action::Cap(cap, vec![]))
    }

    /// The `select` of `cap`, holding `slice`: in the clear for a cap to Public, else sealed under a key of its own,
    /// which is boxed to the seed of each vault that reads it: the vault the cap is over, its grantee unless the cap
    /// only relays, and its issuer where `on` holds or knows the issuer's seed (`slice::Select`).
    fn seal_select(&mut self, on: SignerId, cap: &Cap, slice: &Slice) -> Result<Vec<u8>, Refusal> {
        if cap.grantee == Grantee::Public {
            return Ok(Select::Clear(slice.clone()).to_wire());
        }
        let grantee = match cap.grantee {
            Grantee::Principal(Principal::Vault(g)) if cap.role.allows(Role::Read) => Some(g),
            _ => None,
        };
        let mut readers: Vec<VaultId> = [Some(cap.over), grantee, Some(cap.issuer)].into_iter().flatten().collect();
        let mut seen = HashSet::new();
        readers.retain(|v| seen.insert(*v));
        let Lab { stores, rng, .. } = self;
        let store = stores.get(&on).unwrap_or_else(|| panic!("{on:?} is no device of the Lab"));
        let (st, ix) = (store.view(), KeyIndex::of(&store.replay));
        let key = Secret::generate(rng);
        let sealed = keys::seal_edit(&key, &slice.to_wire(), &cap_context(cap), rng);
        let info = |to: &Recipient| select_info(cap, key.id(), to);
        let mut boxes = vec![];
        for v in readers {
            match key_box(&key, st.current(KeyFam::Seed(v)), &info, st, store, &ix, &[], rng) {
                Some(b) => boxes.push(b),
                None if v == cap.over || Some(v) == grantee => return Err(Refusal::UnknownKey),
                None => {}
            }
        }
        Ok(Select::Sealed { boxes, slice: sealed, rules: slice.rules.as_ref().map(Opening::commitment) }.to_wire())
    }

    /// Bring device `d`'s keys, cells and items up to date with its edits, `lent` holding the keys of owners signing on
    /// it right now. Each round replays its edits, opens and derives what it can, reads what that opens, and makes the
    /// edits its upkeep calls for (`upkeep`). A locked device only replays.
    fn refresh(&mut self, d: SignerId, lent: &[(SignerId, Secret)]) {
        let own = self.keys.get(&d).and_then(Key::seal_secret);
        let unlocked = own.is_some();
        let mine: Vec<(SignerId, Secret)> = own.map(|o| (d, o)).into_iter().chain(lent.iter().cloned()).collect();
        for round in 0.. {
            let pq_only = self.pq_only;
            let Lab { stores, rng, spares, .. } = self;
            let Some(store) = stores.get_mut(&d) else { return };
            store.replay = if pq_only { replay(&checkpointed(store.log.edits())) } else { store.log.replay() };
            // a locked device holds no key, and opens nothing
            if !unlocked {
                return;
            }
            let ix = KeyIndex::of(&store.replay);
            open_keys(store, &ix, &mine);
            read(d, store);
            let work = upkeep(d, store, &ix, &mine, rng, spares);
            if work.is_empty() {
                show_items(d, store);
                return;
            }
            assert!(round < ROUNDS, "{d:?} keeps making edits its own view refuses: {work:?}");
            // what its edits say, every write counted: what it drafts on
            let view = if pq_only { store.log.view() } else { store.replay.state.clone() };
            for w in work {
                self.work(d, &view, w);
            }
            if pq_only {
                self.vouch(d);
            }
        }
    }

    /// Sign and keep on device `d` an edit its upkeep calls for, drafted on `view`, what `d`'s edits say.
    fn work(&mut self, d: SignerId, view: &State, w: Work) {
        let edit = match w {
            Work::Edit(action) => self.held(d).log.draft_on(view, d, &[], action),
            Work::Retag { vault, entry, body } => {
                let en = view.entry(entry).expect("an entry of the view");
                let (stay, x) = (en.stay(), en.cell());
                let generation = view.epoch(KeyFam::Cell(vault, x));
                let action = Action::Write {
                    vault,
                    entry,
                    actor: vault,
                    stay,
                    generation,
                    deps: vec![],
                    proposal: Proposal::Main,
                    via: vec![],
                    create: None,
                    body: vec![],
                };
                let edit = self.held(d).log.draft_on(view, d, &[], action);
                self.seal_write(d, edit, body, x).expect("an unlocked device signs");
                return;
            }
        };
        let signed = self.sign(edit).expect("an unlocked device signs");
        self.keep(d, vec![signed], &Blobs::new());
    }

    /// What device `d` makes of its edits, every write counted: what it drafts and checks its own edits by.
    fn full_view(&self, d: SignerId) -> std::borrow::Cow<'_, State> {
        let store = self.held(d);
        if self.pq_only { std::borrow::Cow::Owned(store.log.view()) } else { std::borrow::Cow::Borrowed(store.view()) }
    }

    /// The write `action` authored by device `on` alone, drafted on `view`, what `on`'s edits say, if `view` accepts
    /// it: the edit, and the write it is, with the caps its readers judge it by.
    fn check_write(&self, on: SignerId, view: &State, action: Action) -> Result<(Edit, Write), Refusal> {
        let edit = self.held(on).log.draft_on(view, on, &[], action);
        let w = view.accepted_write(&edit, edit.id())?.expect("a write");
        Ok((edit, w))
    }

    /// The proof write `w` of device `on` carries, which touches `touches` (`rules::Proof`): none where its readers
    /// count it without one (it acts for its entry's vault, or a cap it relies on is unruled), else one for the first
    /// ruled cap whose chain's rules, as `on` reads them, allow every touch. `NotAllowed` if none does, or `on` can't
    /// read what the write touches.
    fn prove(
        &self,
        on: SignerId,
        view: &State,
        w: &Write,
        touches: Option<&[Touch]>,
    ) -> Result<Option<Proof>, Refusal> {
        if self.lawless || view.lets(w, None, None) {
            return Ok(None);
        }
        let store = self.held(on);
        let proofs = w.caps.iter().filter_map(|c| Some(Proof { cap: *c, openings: store.slices.get(c)?.openings() }));
        let mut proofs = proofs.filter(|p| view.lets(w, Some(p), touches));
        proofs.next().map(Some).ok_or(Refusal::NotAllowed)
    }

    /// The proof write `w` of device `on` carries (`prove`), with what it touches as its readers will read it off
    /// `content` on the history `h` holds before it, of an entry of vault `vault` (`History::reading`). `NotAView` if
    /// it doesn't fit the schemas the entry was written under, of the vault's lane and the built-in ones, unless the
    /// device is a patched app's (`patched`).
    fn proven(
        &self,
        on: SignerId,
        view: &State,
        (vault, h): (VaultId, &History),
        w: &Write,
        content: &[u8],
    ) -> Result<Option<Proof>, Refusal> {
        let read = h.reading(w, Some(content), on, &Lane::with_built_ins(view.lane_of(vault)));
        let proof = self.prove(on, view, w, read.touches.as_deref())?;
        if !(read.fits || self.lawless) {
            return Err(Refusal::NotAView);
        }
        Ok(proof)
    }

    /// Run `f` dry: every write it asks for is checked, proven and refused as ever, and then not made (`may`).
    pub fn dry<T>(&mut self, f: impl FnOnce(&mut Lab) -> T) -> T {
        let was = std::mem::replace(&mut self.dry, true);
        let out = f(self);
        self.dry = was;
        out
    }

    /// Run `f` as devices of a patched app, which ignore the rules of the caps they write through and the schemas of
    /// what they write: their writes carry no proof and are made all the same, whether they fit or not, and no reader
    /// of their entries counts those that break either, the writer's own device neither, nor anything built on them
    /// (`History::reading`, `State::uncounted`).
    pub fn patched<T>(&mut self, f: impl FnOnce(&mut Lab) -> T) -> T {
        let was = std::mem::replace(&mut self.lawless, true);
        let out = f(self);
        self.lawless = was;
        out
    }

    /// A new entry's id: 32 random bytes.
    fn new_entry_id(&mut self) -> EntryId {
        let mut id = [0u8; 32];
        self.rng.fill_bytes(&mut id);
        EntryId(id)
    }

    /// Create an entry of vault `vault` of type `ty` with tags `tags` holding `item`, on device `on`, acting for
    /// `actor`: its first encrypted write. A steward puts it in its cell, once it reads the selectors of every cap of
    /// the vault, and in the vault's own cell before (a steward moves it); anyone else in the intake cell of a cap it
    /// holds with write or more (`policy::Issued::intake`) whose slice holds it, or of the first such cap if it reads
    /// none of their selectors. The item must have been made on `on`, as its Loro edits carry `on`'s peer. `NoCap` if
    /// `actor` holds no such cap, or every slice it reads leaves the entry out.
    pub fn create(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        ty: &str,
        tags: &[&str],
        item: Item,
    ) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let entry = self.new_entry_id();
        let header = Header { ty: Sym::new(ty), created: self.now };
        let tags: Vec<Sym> = tags.iter().map(|&t| Sym::new(t)).collect();
        let cell = self.intake(on, actor, vault, entry, &header, &tags)?;
        self.create_as(on, actor, vault, entry, cell, header, tags, item)
    }

    /// `create` in the cell of the caps `cell`, whatever their slices say: what a device that ignores where its entry
    /// belongs does, which the rules check by the cell alone.
    #[allow(clippy::too_many_arguments)]
    pub fn create_in(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        cell: Vec<CapId>,
        ty: &str,
        tags: &[&str],
        item: Item,
    ) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let entry = self.new_entry_id();
        let header = Header { ty: Sym::new(ty), created: self.now };
        let tags = tags.iter().map(|&t| Sym::new(t)).collect();
        self.create_as(on, actor, vault, entry, cell, header, tags, item)
    }

    /// The first write of entry `entry`, in the cell of the caps `cell`, under the generation the cell is at, or the
    /// one it moves to as the entry brings it back into use (`policy::State::reenters`).
    #[allow(clippy::too_many_arguments)]
    fn create_as(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        entry: EntryId,
        cell: Vec<CapId>,
        header: Header,
        tags: Vec<Sym>,
        item: Item,
    ) -> Result<EntryId, Refusal> {
        let view = self.full_view(on).into_owned();
        let x = CellId::of(vault, &cell);
        let generation = view.epoch(KeyFam::Cell(vault, x)) + view.reenters(vault, x) as u64;
        let action = Action::Write {
            vault,
            entry,
            actor,
            stay: None,
            generation,
            deps: vec![],
            proposal: Proposal::Main,
            via: vec![],
            create: Some(cell),
            body: vec![],
        };
        let (edit, w) = self.check_write(on, &view, action)?;
        let (tags, content) = (TagDelta { add: tags, remove: vec![] }, item.export(&Version::default()));
        let proof = self.proven(on, &view, (vault, &History::default()), &w, &content)?;
        self.write(on, edit, Body { header: Some(header), tags, answers: vec![], content, proof }, x)?;
        Ok(entry)
    }

    /// The cell a new entry goes in (`create`).
    fn intake(
        &self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        entry: EntryId,
        header: &Header,
        tags: &[Sym],
    ) -> Result<Vec<CapId>, Refusal> {
        let (store, st) = (self.held(on), self.full_view(on));
        let attrs = Attrs { ty: header.ty.clone(), author: actor, entry, created: header.created, tags: tags.to_vec() };
        if actor == vault {
            let complete = store.reads_caps(&st, vault);
            return Ok(if complete { semantic_cell(&st, vault, &attrs, &store.readings) } else { vec![] });
        }
        let caps: Vec<&Issued> =
            st.caps_held(actor).filter(|cp| cp.cap.over == vault && st.holds(actor, cp, Role::Write)).collect();
        // its own selector, as the grantee reads it: the stewards judge by the whole chain; and of those, one whose
        // rules let a creation through first
        let holds = |cp: &&Issued| store.slices.get(&cp.id).map(|s| cp.cap.wide || s.select.matches(&attrs));
        let creates = |cp: &Issued| {
            let proof = store.slices.get(&cp.id).map(|s| Proof { cap: cp.id, openings: s.openings() });
            st.lets_through(cp, proof.as_ref(), true, Some(&[Touch::Create]))
        };
        let held: Vec<&Issued> = caps.iter().copied().filter(|cp| holds(cp) == Some(true)).collect();
        if let Some(cp) = held.iter().find(|cp| creates(cp)).or(held.first()) {
            return Ok(cp.intake.to_vec());
        }
        if !caps.is_empty() && caps.iter().all(|cp| holds(cp).is_some()) {
            return Err(Refusal::NoCap);
        }
        caps.first().map(|cp| cp.intake.to_vec()).ok_or(Refusal::NoCap)
    }

    /// Edit an entry on device `on`, acting for `actor`, on its main line: `edit_on`.
    pub fn edit(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        change: impl FnOnce(&mut Item),
    ) -> Result<EditId, Refusal> {
        self.edit_on(on, actor, entry, MAIN, change)
    }

    /// Edit an entry on line `line` of its history, on device `on`, acting for `actor`: `change` edits the item as the
    /// device shows it there, and what changed becomes one encrypted write under the entry's key now, building on the
    /// line's heads.
    pub fn edit_on(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        line: Line,
        change: impl FnOnce(&mut Item),
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).edit(line, on, change);
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// Add the tags `add` to an entry and remove the tags `remove`, on device `on`, acting for `actor`: a write on its
    /// main line carrying only the tags, building on the line's heads, as the device counts them. They count at once
    /// when `actor` is the entry's vault; anyone else asks the vault's stewards, who answer with what its caps let it
    /// ask for.
    pub fn tag(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        add: &[&str],
        remove: &[&str],
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let syms = |ts: &[&str]| ts.iter().map(|&t| Sym::new(t)).collect();
        let tags = TagDelta { add: syms(add), remove: syms(remove) };
        let deps = self.shown(on, entry).heads(MAIN);
        self.make(on, actor, entry, Draft { proposal: Proposal::Main, deps, body: vec![] }, tags)
    }

    /// Start a proposal named `name` of an entry, from the version `from` (any of its writes, with what they build on),
    /// on device `on`, acting for `actor`. The proposal is named by the write's id; the name travels encrypted.
    pub fn propose(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        from: &[EditId],
        name: &str,
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).propose(from, name);
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// Merge line `from` of an entry into line `into`: a write on `into` building on the heads of both.
    pub fn merge(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        from: Line,
        into: Line,
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).merge(from, into);
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// Promote line `from` of an entry into line `into`: a merge whose write brings `into` to exactly what `from`
    /// shows, keeping both histories.
    pub fn promote(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        from: Line,
        into: Line,
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).promote(from, into, on);
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// Put the record of `version` back on line `line` of an entry: restore an earlier version, or revert the
    /// line's latest edit by restoring the version it built on.
    pub fn restore(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        line: Line,
        version: &[EditId],
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).restore(line, version, on);
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// Undo the edit `edit` on line `line` of an entry, keeping every change made since (`history::undo`). `UnknownDep`
    /// if the device holds no such write.
    pub fn undo(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        line: Line,
        edit: EditId,
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).undo(line, edit, on).ok_or(Refusal::UnknownDep)?;
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// A variant of what device `on` shows on line `line` of an entry: a new entry of vault `into` with its record, its
    /// type and its tags, and none of its history, as `on`'s first write of the new entry, acting for `actor`.
    /// `ReadOnly` if it shows nothing there.
    pub fn variant(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        line: Line,
        into: VaultId,
    ) -> Result<EntryId, Refusal> {
        self.variant_with(on, actor, entry, (line, into), |_| Ok(()))
    }

    /// `variant`, with `change` made to the copy before it is written: one first write holds both, as when the ops
    /// engine's `variant` marks where the copy came from.
    pub fn variant_with<E: From<Refusal>>(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        (line, into): (Line, VaultId),
        change: impl FnOnce(&mut Item) -> Result<(), E>,
    ) -> Result<EntryId, E> {
        self.unlocked(on)?;
        let mut copy = self.item_on(on, entry, line).ok_or(Refusal::ReadOnly)?.copy(on);
        change(&mut copy)?;
        let m = self.meaning(on, entry).ok_or(Refusal::ReadOnly)?;
        let tags: Vec<&str> = m.attrs.tags.iter().map(Sym::as_str).collect();
        Ok(self.create(on, actor, into, m.attrs.ty.as_str(), &tags, copy)?)
    }

    /// What device `d` shows of an entry: its history, empty if it holds no write of it.
    fn shown(&self, d: SignerId, entry: EntryId) -> &History {
        static NONE: std::sync::LazyLock<History> = std::sync::LazyLock::new(History::default);
        self.held(d).shown.get(&entry).map_or(&NONE, |s| &s.history)
    }

    /// Make the write `draft` describes of entry `entry` on device `on`, acting for `actor`, carrying the tags `tags`,
    /// under the entry's key in its stay now, at its cell's generation now, in what the device knows (T15).
    fn make(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        draft: Draft,
        tags: TagDelta,
    ) -> Result<EditId, Refusal> {
        let view = self.full_view(on).into_owned();
        let en = view.entry(entry).ok_or(Refusal::UnknownEntry)?;
        let (vault, stay, x) = (en.vault, en.stay(), en.cell());
        let generation = view.epoch(KeyFam::Cell(vault, x));
        let Draft { proposal, deps, body: content } = draft;
        let (via, create) = (vec![], None);
        let action = Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create, body: vec![] };
        let (edit, w) = self.check_write(on, &view, action)?;
        let proof = self.proven(on, &view, (vault, self.shown(on, entry)), &w, &content)?;
        self.write(on, edit, Body { header: None, tags, answers: vec![], content, proof }, x)
    }

    /// Encrypt `body` into the write `edit`, whose stay is in cell `x`, then sign and keep it (`seal_write`); once
    /// peers count only checkpointed writes, vouch for it at once; and bring the device up to date. In a dry run,
    /// nothing: its id.
    fn write(&mut self, on: SignerId, edit: Edit, body: Body, x: CellId) -> Result<EditId, Refusal> {
        if self.dry {
            return Ok(edit.id());
        }
        let id = self.seal_write(on, edit, body, x)?;
        if self.pq_only {
            self.vouch(on);
        }
        self.refresh(on, &[]);
        Ok(id)
    }

    /// Encrypt `body` into the write `edit`, whose stay is in cell `x`, under the key of its entry in that stay at the
    /// generation it names (`entry_key_for`), bound to the edit, then sign and keep it.
    fn seal_write(&mut self, on: SignerId, mut edit: Edit, body: Body, x: CellId) -> Result<EditId, Refusal> {
        let Action::Write { vault, entry, stay, generation, .. } = edit.action else { unreachable!("a write") };
        let Lab { stores, rng, .. } = self;
        let store = stores.get_mut(&on).expect("a device");
        let key = entry_key_for(store, rng, vault, x, entry, stay, generation);
        let sealed = keys::seal_edit(&key, &body.to_wire(), &write_context(&edit), rng);
        if let Action::Write { body: b, .. } = &mut edit.action {
            *b = sealed;
        }
        let id = edit.id();
        let signed = self.sign(edit)?;
        self.keep(on, vec![signed], &Blobs::new());
        let store = self.stores.get_mut(&on).expect("a device");
        store.bodies.insert(id, body);
        store.unvouched.push(id);
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
        // its own writes as every edit it holds has them, whether it counts them yet or not
        let full = if self.pq_only { Some(store.log.view()) } else { None };
        let st = full.as_ref().unwrap_or(store.view());
        let mut by: BTreeMap<EntryId, Vec<EditId>> = BTreeMap::new();
        for w in st.all_writes() {
            if unvouched.contains(&w.edit) {
                by.entry(w.entry).or_default().push(w.edit);
            }
        }
        let made = !by.is_empty();
        for (entry, covers) in by {
            let edit = self.held(d).log.draft(d, &[], Action::Checkpoint { entry, covers });
            let signed = self.sign(edit).expect("an unlocked device signs");
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

    /// The devices no longer trust the curves (`set_pq_only`).
    pub fn pq_only(&self) -> bool {
        self.pq_only
    }

    /// The schemas and lenses published into vault `v`'s lane, as device `d` holds them.
    pub fn lane(&self, d: SignerId, v: VaultId) -> Lane {
        Lane::new(self.held(d).view().lane_of(v))
    }

    /// The vault entry `entry` is of, by device `d`'s view.
    pub fn vault_of_entry(&self, d: SignerId, entry: EntryId) -> Option<VaultId> {
        Some(self.held(d).view().entry(entry)?.vault)
    }

    /// The item as an app on schema `app` shows it on device `d`, through a lens from its vault's lane where another
    /// version wrote it, and whether the app opens it read-only (`Lane::view`). `None` if the device shows no such item
    /// or the app reads nothing of it.
    pub fn open(&self, d: SignerId, entry: EntryId, app: &Schema) -> Option<(Value, bool)> {
        let item = self.item(d, entry)?;
        let (view, read_only) = self.lane(d, self.vault_of_entry(d, entry)?).view(app, &item.authored());
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
        entry: EntryId,
        app: &Schema,
        change: impl FnOnce(&mut Value),
    ) -> Result<Option<EditId>, Refusal> {
        self.unlocked(on)?;
        let item = self.item(on, entry).ok_or(Refusal::ReadOnly)?;
        let vault = self.vault_of_entry(on, entry).ok_or(Refusal::ReadOnly)?;
        let (view, read_only) = self.lane(on, vault).view(app, &item.authored());
        let seen = item.read(&view).filter(|_| !read_only).ok_or(Refusal::ReadOnly)?;
        let mut value = seen.clone();
        change(&mut value);
        if view.put(&item.record(), &value).is_none() {
            return Err(Refusal::NotAView);
        }
        if value == seen {
            return Ok(None);
        }
        self.edit(on, actor, entry, |item| {
            item.write(&view, &value);
        })
        .map(Some)
    }

    /// The item as device `d` shows it on its main line: the writes of the line's history it counts and can decrypt.
    /// `None` if it counts or opens none.
    pub fn item(&self, d: SignerId, entry: EntryId) -> Option<&Item> {
        self.item_on(d, entry, MAIN)
    }

    /// The item as device `d` shows it on line `line`.
    pub fn item_on(&self, d: SignerId, entry: EntryId, line: Line) -> Option<&Item> {
        self.held(d).shown.get(&entry)?.items.get(&line)
    }

    /// An entry's history as device `d` holds it: every write it counts, with what it could open, its lines and their
    /// heads, the proposals' names, and any version to open read-only (`History::item_at`). `None` if it counts no
    /// write of the entry.
    pub fn history(&self, d: SignerId, entry: EntryId) -> Option<&History> {
        self.held(d).shown.get(&entry).map(|s| &s.history)
    }

    /// How many writes of the entry device `d` holds, whether it can decrypt them or not.
    pub fn fetched(&self, d: SignerId, entry: EntryId) -> usize {
        let writes = |edit: &&Edit| matches!(edit.action, Action::Write { entry: e, .. } if e == entry);
        self.held(d).log.edits().iter().filter(writes).count()
    }

    /// The entries device `d` knows of, in the order they were created: those of its vaults, and those its vaults'
    /// caps reach, whether it reads them or only relays them.
    pub fn entries(&self, d: SignerId) -> Vec<EntryId> {
        self.held(d).view().entries().iter().map(|en| en.id).collect()
    }

    /// What entry `entry` means to device `d`, by what it reads (`policy::State::meaning`): its type, its author, its
    /// tags now, its cell, and where a steward would move it. `None` if it doesn't read the entry's header.
    pub fn meaning(&self, d: SignerId, entry: EntryId) -> Option<Meaning> {
        let store = self.held(d);
        store.view().meaning(entry, &store.readings)
    }

    /// The slice of cap `cap` as device `d` reads it: `None` unless its selector is sealed to a vault `d` acts for
    /// (or is public), and `d` opened it.
    pub fn slice(&self, d: SignerId, cap: CapId) -> Option<&Slice> {
        self.held(d).slices.get(&cap)
    }

    /// Device `d` holds the key its view says entry `entry` is under now: it reads what is written to it next.
    pub fn reads(&self, d: SignerId, entry: EntryId) -> bool {
        let store = self.held(d);
        store.view().entry_key(entry).is_some_and(|name| store.keys.first(name).is_some())
    }

    /// Device `d` can open the current key of `k` with what it holds: the key of the latest epoch any device knows.
    pub fn opens(&self, d: SignerId, k: KeyFam) -> bool {
        let current = self.stores.values().map(|s| s.view().epoch(k)).max().unwrap_or(0);
        self.held(d).keys.first(KeyName::Scoped(k, current)).is_some()
    }

    /// Device `d` holds a key of `name`: it opened it, made it, or derived it.
    pub fn holds_key(&self, d: SignerId, name: KeyName) -> bool {
        self.held(d).keys.first(name).is_some()
    }

    /// The edits device `d` holds; `log(d).view()` is what they say, every write counted.
    pub fn log(&self, d: SignerId) -> &Log {
        &self.held(d).log
    }

    /// What device `d` makes of the edits it holds: what `log(d).view()` says, but once it no longer trusts the curves,
    /// of the checkpointed writes only.
    pub fn state(&self, d: SignerId) -> &State {
        self.held(d).view()
    }

    /// The signed edit device `d` holds with id `edit`, as it would send it.
    pub fn signed_edit(&self, d: SignerId, edit: EditId) -> Option<&Signed> {
        self.held(d).signed.get(&edit)
    }

    /// Every secret signer `s` holds here, to search views, logs and stores for secrets that shouldn't be there: its
    /// own key, the one keys are sealed to for it, then, for a device, each key it holds. None while it is locked.
    pub fn secrets(&self, s: SignerId) -> Vec<Secret> {
        let Some(key) = self.keys.get(&s) else { return vec![] };
        let held = self.stores.get(&s).into_iter().flat_map(|store| store.keys.secrets().cloned());
        key.seal_secret().into_iter().chain(held).collect()
    }

    /// Every byte device `d` stores, to search for plaintext that shouldn't be there: its signed edits, the keys it
    /// holds, the bodies and selectors it opened, and the items it shows, as their content reads. The McEliece public
    /// keys it holds are left out: public, and a megabyte each.
    pub fn store(&self, d: SignerId) -> Vec<u8> {
        let store = self.held(d);
        let mut out = vec![];
        for edit in store.log.edits() {
            out.extend(encode::bytes(edit));
            for sig in &store.signed[&edit.id()].sigs {
                match &sig.keys {
                    SignerKeys::Device { ed25519, slh } => out.extend(ed25519.iter().chain(slh)),
                    SignerKeys::Passkey { p256, slh } => out.extend(p256.iter().chain(slh)),
                }
                match &sig.classical {
                    Classical::Ed25519(b) => out.extend(b),
                    Classical::Passkey(a)
                    | Classical::Batch { assertion: a, .. }
                    | Classical::Pass { assertion: a, .. } => {
                        for part in [&a.authenticator_data, &a.client_data_json, &a.signature] {
                            out.extend(part);
                        }
                    }
                }
                out.extend(sig.pq.iter().flatten());
            }
        }
        for secret in store.keys.secrets() {
            out.extend(secret.bytes());
        }
        for body in store.bodies.values() {
            out.extend(body.to_wire());
        }
        for slice in store.slices.values() {
            out.extend(slice.to_wire());
        }
        for shown in store.shown.values() {
            for item in shown.items.values() {
                out.extend(item.record().to_string().into_bytes());
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

    /// Device `to` asks device `from` once, with what it holds of each log (`sync::asks`), and `from` answers with what
    /// `to` may receive by `from`'s view, of each log only what lies beyond what `to` holds of it. `from` vouches for
    /// its new writes first. How many edits `from` sent: none while either is offline.
    pub fn sync(&mut self, from: SignerId, to: SignerId) -> usize {
        if !self.online(from) || !self.online(to) {
            return 0;
        }
        self.checkpoint(from);
        let to_store = self.held(to);
        let asked = asks_ids(to_store.log.edits(), to_store.log.ids());
        let store = self.held(from);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let places = answer(edits, &self.full_view(from), to);
        let sent: Vec<EditId> =
            beyond(edits, ids, &logs_of(edits, ids), &places, &asked).into_iter().map(|i| ids[i]).collect();
        let (signed, blobs) = self.outgoing(from, &sent);
        self.deliver(to, signed, &blobs);
        sent.len()
    }

    /// The digest of each log device `d` holds (`sync::digests`): what it gossips.
    pub fn digests(&mut self, d: SignerId) -> &BTreeMap<LogId, [u8; 32]> {
        let store = self.stores.get_mut(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        store.digests.get_or_insert_with(|| digests_ids(store.log.edits(), store.log.ids()))
    }

    /// The gossip tells device `to` to ask device `from`: `from` would answer it about a log whose digest differs from
    /// `to`'s, or with an edit of no log that `to` lacks.
    fn gossip_says_ask(&mut self, from: SignerId, to: SignerId) -> bool {
        self.digests(from);
        self.digests(to);
        let (theirs, mine) = (self.held(from), self.held(to));
        let (edits, ids) = (theirs.log.edits(), theirs.log.ids());
        let logs = logs_of(edits, ids);
        let (df, dt) = (theirs.digests.as_ref().expect("worked out"), mine.digests.as_ref().expect("worked out"));
        answer(edits, &self.full_view(from), to).into_iter().any(|i| match logs[i] {
            Some(l) => df.get(&l) != dt.get(&l),
            None => !mine.signed.contains_key(&ids[i]),
        })
    }

    /// Every online device gossips the digest of each log it holds, and asks a peer whenever the peer would answer it
    /// about a log whose digest differs from its own (`sync`), pair by pair in an order drawn from `seed`, until
    /// nothing new arrives. How many edits were sent in all.
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

    /// Every fork device `d` sees among the edits it holds (`sync::forks`): two edits of one device in one log where
    /// neither builds on the other, the smaller id first.
    pub fn forks(&self, d: SignerId) -> Vec<(EditId, EditId)> {
        let store = self.held(d);
        forks_in(store.log.edits(), store.log.ids(), store.view())
    }

    /// Device `d` split off to run on its own, as on a machine of its own (`avendb-net` puts it on iroh): a Lab holding
    /// only `d`'s store, the keys of `d` and of the signers `with` that are used on it (its person's passkey), every
    /// signer's name, and randomness of its own from `seed`, so that no two devices split off make the same keys or
    /// nonces. This Lab keeps the rest.
    pub fn split(&mut self, d: SignerId, with: &[SignerId], seed: [u8; 32]) -> Lab {
        let store = self.stores.remove(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        self.devices.retain(|&x| x != d);
        let keys = [d].iter().chain(with).filter_map(|s| Some((*s, self.keys.remove(s)?))).collect();
        let salts = self.salts.remove(&d).map(|salt| (d, salt)).into_iter().collect();
        let seed = Zeroizing::new(seed);
        let mut rng = SeededRng::new("lab randomness", &*seed);
        let mut spares = Spares { keys: VecDeque::new(), keep: self.spares.keep };
        spares.fill(&mut rng);
        Lab {
            keys,
            names: self.names.clone(),
            salts,
            devices: vec![d],
            stores: HashMap::from([(d, store)]),
            made: 0,
            rng,
            on_machine: true,
            spares,
            pq_only: self.pq_only,
            offline: HashSet::new(),
            now: self.now,
            dry: false,
            lawless: false,
        }
    }

    /// The secret of device `d`'s iroh endpoint, its ed25519 key: `None` while it is locked.
    pub fn endpoint_secret(&self, d: SignerId) -> Option<Zeroizing<[u8; 32]>> {
        match self.keys.get(&d)? {
            Key::Device(k) => Some(k.endpoint_secret()),
            Key::Passkey(_) | Key::Web { .. } => None,
        }
    }

    /// Device `d`'s hello on the connection whose TLS exporter is `exporter`, for the end that dialed if `dialer`
    /// (`sign::Hello`): `None` while it is locked.
    pub fn hello(&self, d: SignerId, exporter: &[u8; 32], dialer: bool) -> Option<Hello> {
        match self.keys.get(&d)? {
            Key::Device(k) => Some(k.hello(exporter, dialer)),
            Key::Passkey(_) | Key::Web { .. } => None,
        }
    }

    /// The pass passkey `passkey`, used on device `d`, makes `d` at `made`, seconds since 1970 (`sign::RelayPass`): for
    /// `d` alone, which the server's relay lets in for ten minutes if the passkey roots a vault the server knows
    /// (`roots`), and which a peer hands the passkey's link card on (`link_card`). `None` unless the passkey is at hand
    /// and `d` is an unlocked device of the Lab.
    pub fn relay_pass(&mut self, d: SignerId, passkey: SignerId, made: u64) -> Option<RelayPass> {
        let Key::Device(device) = self.keys.get(&d)? else { return None };
        let device = device.keys();
        match self.keys.get_mut(&passkey)? {
            Key::Passkey(p) => Some(p.pass(device, made)),
            Key::Device(_) | Key::Web { .. } => None,
        }
    }

    /// A ceremony of passkey `passkey` over `challenge` (`sign::Ceremony`), as a software passkey the Lab holds makes
    /// it: `None` unless the Lab holds one. A passkey in the platform's authenticator makes its own, in the browser.
    pub fn ceremony(&mut self, passkey: SignerId, challenge: [u8; 32]) -> Option<Ceremony> {
        match self.keys.get_mut(&passkey)? {
            Key::Passkey(p) => Some(p.ceremony(challenge)),
            Key::Device(_) | Key::Web { .. } => None,
        }
    }

    /// The passkeys that root the vaults in device `d`'s view: the people the server knows, whose passes its relay
    /// honours (`relay_pass`).
    pub fn roots(&self, d: SignerId) -> Vec<SignerId> {
        let roots: BTreeSet<SignerId> = self.held(d).view().vaults().iter().filter_map(|v| v.root).collect();
        roots.into_iter().collect()
    }

    /// What device `d` hands a device whose passkey `passkey` proved itself on their connection (`sync::link_card`):
    /// the signed edits of the logs of the vaults the passkey owns, and of every vault that owns one of them, up the
    /// chains, so that the device can add itself to its person's vault (`join`). Nothing about any cap, cell or entry
    /// (T20); a passkey that owns no vault gets nothing.
    pub fn link_card(&self, d: SignerId, passkey: SignerId) -> Vec<Signed> {
        let store = self.held(d);
        let places = link_places(store.log.edits(), &self.full_view(d), passkey);
        places.into_iter().map(|i| store.signed[&store.log.ids()[i]].clone()).collect()
    }

    /// Device `d` adds itself to the vault whose root is its person's passkey `passkey`, by its view, as a new device
    /// does once it holds the passkey's link card (`link_card`): the edit, signed by the passkey and by `d`, sealing to
    /// `d`'s own key, and the McEliece key it names, for the peer to accept (`accept_join`). As the passkey signs on
    /// `d`, it lends `d` what is sealed to it: `d` opens the vault's seed and boxes it for itself. If `d` is in that
    /// vault already, as when a link is tried again, the edit that added it. `UnknownVault` if no vault in `d`'s view
    /// has the passkey as its root, `Locked` if the passkey isn't at hand.
    pub fn join(&mut self, d: SignerId, passkey: SignerId) -> Result<Join, Refusal> {
        let id = match self.joining(d, passkey)? {
            (_, Some(id)) => id,
            (vault, None) => self.submit(d, &[passkey, d], Action::AddDevice { vault, device: d, seal_to: None })?,
        };
        Ok(self.joined(d, id))
    }

    /// The vault whose root is passkey `passkey` by device `d`'s view, and the edit that added `d` to it, if one did:
    /// what `join` signs, or sends again. A browser's passkey signs `Action::AddDevice` in a ceremony (`draft`,
    /// `complete`, P8e), and the device sends `joined`. `UnknownVault` if no vault in `d`'s view has it as its root.
    pub fn joining(&self, d: SignerId, passkey: SignerId) -> Result<(VaultId, Option<EditId>), Refusal> {
        let store = self.held(d);
        let st = store.view();
        let vault = st.vaults().iter().find(|v| v.root == Some(passkey)).ok_or(Refusal::UnknownVault)?;
        let adds = |edit: &Edit| {
            matches!(edit.action, Action::AddDevice { vault: v, device, .. } if v == vault.id && device == d)
        };
        let edits = store.log.edits().iter().zip(store.log.ids());
        let added =
            vault.devices.contains(&d).then(|| edits.rev().find(|(edit, _)| adds(edit)).map(|(_, id)| *id)).flatten();
        Ok((vault.id, added))
    }

    /// The join device `d` sends by edit `id`, which it holds and which adds it to its vault (`joining`): the edit and
    /// the McEliece key it names.
    pub fn joined(&self, d: SignerId, id: EditId) -> Join {
        let (mut signed, blobs) = self.outgoing(d, &[id]);
        Join { edit: signed.remove(0), blobs: blobs.into_values().map(|b| b.to_vec()).collect() }
    }

    /// Device `d` accepts the join a device on the other end of a connection, `from`, sent it (`join`): an edit adding
    /// `from` itself to a vault of `d`'s view, every signature checking out, and which `d`'s view accepts: the vault
    /// approves (its root signed, or its threshold of owners) and `from` cosigned. `d` keeps it, with the McEliece key
    /// it names, and from then on answers `from` as a device of that vault. `NotJoining` if the edit adds no device or
    /// another one than `from`, `BadSignature` if a signature doesn't verify, and otherwise why `d`'s view refuses it.
    /// The same join sent again is accepted again.
    pub fn accept_join(&mut self, d: SignerId, from: SignerId, join: Join) -> Result<EditId, Refusal> {
        if !matches!(join.edit.edit.action, Action::AddDevice { device, .. } if device == from) {
            return Err(Refusal::NotJoining);
        }
        let id = join.edit.verify()?.id();
        if self.held(d).signed.contains_key(&id) {
            return Ok(id);
        }
        self.held(d).view().step(&join.edit.edit)?;
        self.receive(d, vec![join.edit], join.blobs.into_iter().map(Arc::from).collect());
        Ok(id)
    }

    /// The devices device `d` knows, other than itself, each with its ed25519 key, its iroh endpoint's: the devices
    /// of the vaults in its view whose keys it saw in a signature.
    pub fn peers(&self, d: SignerId) -> Vec<(SignerId, [u8; 32])> {
        let store = self.held(d);
        let devices: HashSet<SignerId> = store.view().vaults().iter().flat_map(|v| v.devices.iter().copied()).collect();
        let mut out = BTreeMap::new();
        for sig in store.signed.values().flat_map(|s| &s.sigs) {
            if let SignerKeys::Device { ed25519, .. } = sig.keys {
                let s = sig.keys.id();
                if s != d && devices.contains(&s) {
                    out.insert(s, ed25519);
                }
            }
        }
        out.into_iter().collect()
    }

    /// What device `d` asks `peer` when it syncs with it on the network (`wire::Request`): its frontier of each log and
    /// a few edits further back (`sync::asks`), and the McEliece keys it lacks that the edits of those logs name, but
    /// only of the logs `peer` may hold by `d`'s view: `d` tells a peer nothing about the rest. A log it names nothing
    /// of comes whole, if the peer may send it.
    pub fn request(&self, d: SignerId, peer: SignerId) -> Request {
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let places = answer(edits, &self.full_view(d), peer);
        let logs = logs_of(edits, ids);
        let shared: HashSet<LogId> = places.iter().filter_map(|&i| logs[i]).collect();
        let theirs: HashSet<EditId> = places.iter().map(|&i| ids[i]).collect();
        let mut ask = asks_ids(edits, ids);
        ask.haves.retain(|l, _| shared.contains(l));
        ask.loose.retain(|id| theirs.contains(id));
        let wants: BTreeSet<BlobId> =
            places.iter().flat_map(|&i| edits[i].blobs()).filter(|b| !store.blobs.contains_key(b)).collect();
        Request { ask, wants: wants.into_iter().collect(), after: None }
    }

    /// What device `d` answers `asker`'s request: a page of the edits `asker` may receive by `d`'s view beyond those it
    /// named, as `sync` sends them, and the McEliece keys `d` holds that those edits name or that the request wants and
    /// `asker` may fetch (`may_fetch`), smallest first. The edits come each once, by their place (`sync::place`), after
    /// the request's `after`: as many as fit in `page` bytes on the wire, and at least one. True if more are left, for
    /// `asker` to ask on after the last. `d` vouches for its new writes first.
    pub fn reply(
        &mut self,
        d: SignerId,
        asker: SignerId,
        request: &Request,
        page: usize,
    ) -> (Vec<Signed>, Vec<BlobId>, bool) {
        self.checkpoint(d);
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let places = answer(edits, &self.full_view(d), asker);
        let sent: BTreeSet<Place> = beyond(edits, ids, &logs_of(edits, ids), &places, &request.ask)
            .into_iter()
            .map(|i| (edits[i].depth, ids[i]))
            .filter(|p| request.after.is_none_or(|after| *p > after))
            .collect();
        let (mut signed, mut size, mut more) = (vec![], 0usize, false);
        for (_, id) in sent {
            let s = &store.signed[&id];
            size = size.saturating_add(s.to_wire().len());
            if size > page && !signed.is_empty() {
                more = true;
                break;
            }
            signed.push(s.clone());
        }
        let reach: HashSet<BlobId> = places.iter().flat_map(|&i| edits[i].blobs()).collect();
        let wanted = request.wants.iter().copied().filter(|b| reach.contains(b));
        let blobs: BTreeSet<BlobId> =
            signed.iter().flat_map(|s| s.edit.blobs()).chain(wanted).filter(|b| store.blobs.contains_key(b)).collect();
        (signed, blobs.into_iter().collect(), more)
    }

    /// Device `d` may hand `asker` the McEliece key `blob`: it holds it, and an edit `asker` may receive by `d`'s view
    /// names it.
    pub fn may_fetch(&self, d: SignerId, asker: SignerId, blob: BlobId) -> bool {
        let store = self.held(d);
        let edits = store.log.edits();
        store.blobs.contains_key(&blob)
            && answer(edits, &self.full_view(d), asker).into_iter().any(|i| edits[i].blobs().contains(&blob))
    }

    /// The McEliece key `b` as device `d` holds it.
    pub fn blob(&self, d: SignerId, b: BlobId) -> Option<Arc<[u8]>> {
        self.held(d).blobs.get(&b).cloned()
    }

    /// The ids of the McEliece keys device `d` holds, smallest first.
    pub fn blob_ids(&self, d: SignerId) -> Vec<BlobId> {
        let ids: BTreeSet<BlobId> = self.held(d).blobs.keys().copied().collect();
        ids.into_iter().collect()
    }

    /// How many edits and how many McEliece keys device `d` holds. Neither ever shrinks but by `restore_backup`, so
    /// while they stay the same, so does what the device holds.
    pub fn size(&self, d: SignerId) -> (usize, usize) {
        let store = self.held(d);
        (store.log.ids().len(), store.blobs.len())
    }

    /// Device `d` receives edits and McEliece keys from a peer on the network: it keeps each edit whose signatures
    /// check out, and each key an edit it holds names, by the key's own hash, then brings its keys and items up to
    /// date. How many edits were new.
    pub fn receive(&mut self, d: SignerId, edits: Vec<Signed>, blobs: Vec<Arc<[u8]>>) -> usize {
        let blobs: Blobs = blobs.into_iter().map(|b| (BlobId::of(&b), b)).collect();
        let before = self.held(d).signed.len();
        let mut changed = self.keep(d, edits, &blobs);
        let store = self.stores.get_mut(&d).expect("a device");
        let named: HashSet<BlobId> = store.log.edits().iter().flat_map(Edit::blobs).collect();
        for (b, bytes) in blobs {
            if named.contains(&b) && !store.blobs.contains_key(&b) {
                store.blobs.insert(b, bytes);
                changed = true;
            }
        }
        let new = self.held(d).signed.len() - before;
        if changed {
            self.refresh(d, &[]);
        }
        new
    }

    /// The digest of each log device `d` holds that `peer` may hold too by `d`'s view (`sync::digests`), smallest log
    /// first: what `d` tells `peer` whenever one changes, so that `peer` asks it where they differ. Nothing about any
    /// other log.
    pub fn announce(&mut self, d: SignerId, peer: SignerId) -> Vec<(LogId, [u8; 32])> {
        self.digests(d);
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let logs = logs_of(edits, ids);
        let shared: BTreeSet<LogId> =
            answer(edits, &self.full_view(d), peer).into_iter().filter_map(|i| logs[i]).collect();
        let digests = store.digests.as_ref().expect("worked out");
        shared.into_iter().filter_map(|l| Some((l, *digests.get(&l)?))).collect()
    }

    /// A peer that announced `digests` holds a log otherwise than device `d`: one differs from `d`'s digest of the
    /// log, or names a log `d` doesn't hold. Then `d` asks it.
    pub fn differs(&mut self, d: SignerId, digests: &[(LogId, [u8; 32])]) -> bool {
        let mine = self.digests(d);
        digests.iter().any(|(l, x)| mine.get(l) != Some(x))
    }

    /// A backup of device `d`: its signed edits and their blobs, as they are now.
    pub fn backup(&self, d: SignerId) -> Backup {
        let store = self.held(d);
        let signed = store.log.ids().iter().map(|id| store.signed[id].clone()).collect();
        Backup { signed, blobs: store.blobs.clone() }
    }

    /// Restore device `d` from `backup`: it holds what the backup holds and nothing it made or received since. What it
    /// makes next in a log builds on the past the backup kept, so it forks from what it made there since (`forks`).
    /// It vouches as before for the writes of its own that no checkpoint of its own covers. A node starting again
    /// from its store on disk restores the same way.
    pub fn restore_backup(&mut self, d: SignerId, backup: &Backup) {
        self.stores.insert(d, Store::default());
        self.keep(d, backup.signed.clone(), &backup.blobs);
        let store = self.stores.get_mut(&d).expect("restored");
        let edits = store.log.edits().iter().zip(store.log.ids());
        let own: Vec<(&Edit, &EditId)> = edits.filter(|(edit, _)| edit.author == d).collect();
        let covered: HashSet<EditId> = own
            .iter()
            .flat_map(|(edit, _)| match &edit.action {
                Action::Checkpoint { covers, .. } => covers.clone(),
                _ => vec![],
            })
            .collect();
        store.unvouched = own
            .iter()
            .filter(|(edit, id)| matches!(edit.action, Action::Write { .. }) && !covered.contains(id))
            .map(|(_, id)| **id)
            .collect();
        self.refresh(d, &[]);
    }

    /// `action` signed by `signers`, drafted on device `on` and building on what it holds, unchecked and kept nowhere:
    /// what a device that ignores the rules sends. `Locked` if a signer's key isn't at hand.
    pub fn sign_unchecked(&mut self, on: SignerId, signers: &[SignerId], action: Action) -> Result<Signed, Refusal> {
        let (&author, cosigners) = signers.split_first().expect("an edit has an author");
        let edit = self.held(on).log.draft(author, cosigners, action);
        self.sign(edit)
    }

    /// Deliver a tampering attempt to device `to`: `Err` with why it rejects it, or the edit's id if it keeps it.
    pub fn tamper(&mut self, to: SignerId, how: Tamper) -> Result<EditId, Refusal> {
        let signed = match how {
            Tamper::Unchecked { signers, action } => {
                // drafted on the author's own device when it is one, building on what that device holds
                let on = if self.stores.contains_key(&signers[0]) { signers[0] } else { to };
                self.sign_unchecked(on, &signers, action)?
            }
            Tamper::ForgedSignature { claimed, action } => {
                let edit = self.held(to).log.draft(claimed, &[], action);
                let forger = DeviceKey::from_secret(self.secret("forger", ""));
                Signed { sigs: vec![forger.sign(edit.id(), sign::needs_pq(&edit))], edit }
            }
            Tamper::ChangedCiphertext(id) => {
                let mut signed =
                    self.stores.values().find_map(|s| s.signed.get(&id)).cloned().expect("an edit some device holds");
                if let Action::Write { body, .. } = &mut signed.edit.action
                    && let Some(last) = body.last_mut()
                {
                    *last ^= 1;
                }
                signed
            }
            Tamper::ReplayedSeal { key, to: victim } => {
                // the first device holding the old key seals it again, straight to the victim's own key
                let holder = self.devices.iter().copied().find(|d| self.held(*d).keys.first(key).is_some());
                let holder = holder.expect("a device holding the key");
                let secret = self.held(holder).keys.first(key).expect("held").clone();
                let (pk, blob) = self.seal_public(victim).expect("a signer of the Lab");
                let recipient = Recipient::Signer(victim);
                let info = box_info(key, secret.id(), &recipient);
                let bytes = keys::seal(&secret, &pk, &blob, &info, &mut self.rng).expect("a key");
                let boxes = vec![KeyBox { to: recipient, bytes }];
                let action = Action::Keys { name: key, id: secret.id(), public: None, boxes, clear: None };
                let edit = self.held(holder).log.draft(holder, &[], action);
                self.sign(edit)?
            }
            Tamper::BrokenClassicalKey { signer, action } => {
                let edit = self.held(to).log.draft(signer, &[], action);
                let key = self.keys.get_mut(&signer).expect("a signer of the Lab");
                Signed { sigs: vec![key.sign(edit.id(), false).ok_or(Refusal::Locked)?], edit }
            }
        };
        let edit = signed.verify()?.clone();
        self.held(to).view().step(&edit)?;
        self.deliver(to, vec![signed], &Blobs::new());
        Ok(edit.id())
    }
}

/// Open every box the device can: for one of `mine` (its own key, and what owners lend it), or for a key it already
/// holds; then every key published in the clear; then derive the keys of the entries in each cell whose key it holds;
/// and again, until nothing more opens. A box counts only if what opens is the key it names.
fn open_keys(store: &mut Store, ix: &KeyIndex, mine: &[(SignerId, Secret)]) {
    // the stays each cell had: the entries whose keys a key of the cell derives, and in which stay
    let mut stays: HashMap<CellId, Vec<(EntryId, Option<EditId>)>> = HashMap::new();
    for en in store.replay.state.entries() {
        for (s, x) in &en.stays {
            stays.entry(*x).or_default().push((en.id, *s));
        }
    }
    loop {
        let mut more = false;
        for (name, id, b) in &ix.boxes {
            if store.keys.contains(id) {
                continue;
            }
            let with = match b.to {
                Recipient::Signer(s) => mine.iter().find(|m| m.0 == s).map(|m| m.1.clone()),
                Recipient::Key { name: to, id: under } => store.keys.get(&under, to).cloned(),
            };
            let Some(with) = with else { continue };
            if let Some(secret) = keys::open(&b.bytes, &with, &box_info(*name, *id, &b.to))
                && secret.id() == *id
            {
                more |= store.keys.insert(*name, secret);
            }
        }
        for &(name, id, bytes) in &ix.clear {
            let secret = Secret::from_bytes(bytes);
            if !store.keys.contains(&id) && secret.id() == id {
                more |= store.keys.insert(name, secret);
            }
        }
        more |= derive(store, &stays);
        if !more {
            return;
        }
    }
}

/// Derive the key of each entry that ever stayed in a cell whose key the device holds, for that stay, at that key's
/// generation (`keys::entry_key`): true if it derived any.
fn derive(store: &mut Store, stays: &HashMap<CellId, Vec<(EntryId, Option<EditId>)>>) -> bool {
    let mut new = vec![];
    for id in &store.keys.cells {
        let (name, cell) = &store.keys.by_id[id];
        let KeyName::Scoped(KeyFam::Cell(_, x), g) = *name else { continue };
        for &(e, s) in stays.get(&x).into_iter().flatten() {
            if store.derived.insert((*id, e, s)) {
                new.push((KeyName::Entry(e, s, g), keys::entry_key(cell, e, s)));
            }
        }
    }
    let more = !new.is_empty();
    for (name, key) in new {
        store.keys.insert(name, key);
    }
    more
}

/// The key of entry `e` in its stay `stay`, in cell `x` of vault `v`, at generation `g`: one the device holds, or one
/// it derives from a key it holds of the cell at that generation, or from a new key of the cell where it holds none,
/// which it keeps, and boxes as it brings its keys up to date.
#[allow(clippy::too_many_arguments)]
fn entry_key_for(
    store: &mut Store,
    rng: &mut SeededRng,
    v: VaultId,
    x: CellId,
    e: EntryId,
    stay: Option<EditId>,
    g: u64,
) -> Secret {
    let name = KeyName::Entry(e, stay, g);
    if let Some(key) = store.keys.first(name) {
        return key.clone();
    }
    let cell = KeyName::Scoped(KeyFam::Cell(v, x), g);
    let under = match store.keys.first(cell) {
        Some(key) => key.clone(),
        None => {
            let key = Secret::generate(rng);
            store.keys.insert(cell, key.clone());
            key
        }
    };
    let key = keys::entry_key(&under, e, stay);
    store.derived.insert((under.id(), e, stay));
    store.keys.insert(name, key.clone());
    key
}

/// Open what the device's keys open of its edits and keep it: the selector of each cap (`open_select`), and the body of
/// each write its view counts, or whose tags count (`policy::Entry::retags`); then what it reads in them.
fn read(d: SignerId, store: &mut Store) {
    let st = &store.replay.state;
    for cp in st.caps() {
        if store.slices.contains_key(&cp.id) || store.unreadable.contains(&cp.id) {
            continue;
        }
        match open_select(&cp.cap, &store.keys, st.acts_for(d, cp.cap.over)) {
            Ok(Some(slice)) => {
                store.slices.insert(cp.id, slice);
            }
            Ok(None) => {}
            Err(()) => {
                store.unreadable.insert(cp.id);
            }
        }
    }
    let retags = st.entries().iter().flat_map(|en| en.retags.iter().copied());
    let wanted = st.all_writes().iter().map(|w| w.edit).chain(retags);
    let wanted: Vec<EditId> =
        wanted.filter(|id| !store.bodies.contains_key(id) && !store.spoilt.contains(id)).collect();
    if !wanted.is_empty() {
        let edits: HashMap<EditId, &Edit> = store.replay.ids.iter().copied().zip(&store.replay.edits).collect();
        for id in wanted {
            let Some(edit) = edits.get(&id) else { continue };
            let Action::Write { entry, stay, generation, body, .. } = &edit.action else { continue };
            let Some(key) = keys::edit_key(body) else {
                store.spoilt.insert(id);
                continue;
            };
            let Some(key) = store.keys.get(&key, KeyName::Entry(*entry, *stay, *generation)) else { continue };
            match keys::open_edit(key, body, &write_context(edit)).and_then(|plain| Body::from_wire(&plain).ok()) {
                Some(b) => {
                    store.bodies.insert(id, b);
                }
                None => {
                    store.spoilt.insert(id);
                }
            }
        }
    }
    let mut r = Readings::default();
    for (c, s) in &store.slices {
        r.selectors.insert(*c, s.select.clone());
    }
    for (id, b) in &store.bodies {
        if let Some(h) = &b.header {
            r.headers.insert(*id, h.clone());
        }
        r.tags.insert(*id, b.tags.clone());
        if let Some(p) = &b.proof {
            r.proofs.insert(*id, p.clone());
        }
    }
    store.readings = r;
}

/// The slice cap `cap`'s selector holds (`slice::Select`), opened with the keys `keys`: `Ok(None)` while none of its
/// boxes goes to a key held, `Err` if it never opens: it is garbled, a box for a key held doesn't open, or what that
/// opens doesn't, or, for a steward of the vault the cap is over (`steward`), no box goes to any seed of that vault.
fn open_select(cap: &Cap, keys: &Keyring, steward: bool) -> Result<Option<Slice>, ()> {
    let (boxes, sealed) = match Select::from_wire(&cap.select).map_err(drop)? {
        Select::Clear(slice) => return Ok(Some(slice)),
        Select::Sealed { boxes, slice, .. } => (boxes, slice),
    };
    let id = keys::edit_key(&sealed).ok_or(())?;
    let to_over = |b: &&KeyBox| matches!(b.to.name(), KeyName::Scoped(KeyFam::Seed(v), _) if v == cap.over);
    if steward && !boxes.iter().any(|b| to_over(&b)) {
        return Err(());
    }
    for b in &boxes {
        let Recipient::Key { name, id: under } = b.to else { continue };
        let Some(with) = keys.get(&under, name) else { continue };
        let key = keys::open(&b.bytes, with, &select_info(cap, id, &b.to)).filter(|k| k.id() == id).ok_or(())?;
        let plain = keys::open_edit(&key, &sealed, &cap_context(cap)).ok_or(())?;
        return Slice::from_wire(&plain).map(Some).map_err(drop);
    }
    Ok(None)
}

/// The edits device `d` should make, by its view: the `Keys` edits its keys call for, and, for each vault it acts for,
/// its stewardship (`steward`). For each family it may open: a key made for each epoch from the oldest it holds to the
/// current one where nobody made one yet; each current key it holds announced if it is a seed nobody announced yet,
/// boxed for every target without a box yet, and published if the family is public; each older key it holds wrapped
/// under the next epoch's key if nobody wrapped it yet. For each entry it reads, the keys of the entry's earlier stays
/// it holds wrapped under the key the schedule links them to, if nobody did yet. `mine` are the keys of the signers it
/// may box for by wrapping: its own, and what owners lend it.
fn upkeep(
    d: SignerId,
    store: &mut Store,
    ix: &KeyIndex,
    mine: &[(SignerId, Secret)],
    rng: &mut SeededRng,
    spares: &mut Spares,
) -> Vec<Work> {
    let st = store.replay.state.clone();
    let families: Vec<KeyFam> = st.key_fams().into_iter().filter(|&k| st.entitled(d, k)).collect();
    // a key for every epoch from the oldest it holds to the current one, where nobody made one yet: several rotations
    // at once leave the epochs between without a key, and the history must stay one chain
    for &k in &families {
        let e = st.epoch(k);
        let from = store.keys.epochs(k).next().map_or(e, |x| (x + 1).min(e));
        for x in from..=e {
            let name = KeyName::Scoped(k, x);
            if store.keys.first(name).is_none() && !ix.exists.contains(&name) {
                // keys are sealed only to seeds: only those carry a public half, announced below, and its McEliece pair
                // takes a while to make
                let seed = matches!(k, KeyFam::Seed(_)) && x == e;
                store.keys.insert(name, if seed { spares.take(rng) } else { Secret::generate(rng) });
            }
        }
    }
    let mut out = vec![];
    for &k in &families {
        let e = st.epoch(k);
        let name = KeyName::Scoped(k, e);
        let current: Vec<Secret> = store.keys.held(name).cloned().collect();
        for secret in current {
            let id = secret.id();
            let public = (matches!(k, KeyFam::Seed(_)) && !ix.announced(name, id)).then(|| {
                let public = secret.public();
                store.blobs.insert(public.mceliece, secret.mceliece_public());
                public
            });
            let info = |to: &Recipient| box_info(name, id, to);
            let mut boxes = vec![];
            for t in st.targets(k) {
                if !ix.boxed.contains(&(name, id, t))
                    && let Some(b) = key_box(&secret, t, &info, &st, store, ix, mine, rng)
                {
                    boxes.push(b);
                }
            }
            let clear = (st.public_key(k) && !ix.cleared.contains(&id)).then(|| secret.bytes());
            if public.is_some() || !boxes.is_empty() || clear.is_some() {
                out.push(Work::Edit(Action::Keys { name, id, public, boxes, clear }));
            }
        }
        // the history: each older key under a key of the next epoch, so whoever reads now reads what came before
        let older: Vec<u64> = store.keys.epochs(k).filter(|&x| x < e).collect();
        for x in older {
            let (name, next) = (KeyName::Scoped(k, x), KeyName::Scoped(k, x + 1));
            let Some(under) = store.keys.first(next).cloned() else { continue };
            for secret in store.keys.held(name) {
                let id = secret.id();
                if ix.boxed.contains(&(name, id, next)) {
                    continue;
                }
                let to = Recipient::Key { name: next, id: under.id() };
                let bytes = keys::wrap(secret, &under, &box_info(name, id, &to), rng);
                let boxes = vec![KeyBox { to, bytes }];
                out.push(Work::Edit(Action::Keys { name, id, public: None, boxes, clear: None }));
            }
        }
    }
    // move links: the keys of an entry's earlier stays under a key of its stay now, as the schedule links them
    for en in st.entries() {
        if !st.entitled(d, KeyFam::Cell(en.vault, en.cell())) {
            continue;
        }
        let generation = st.epoch(KeyFam::Cell(en.vault, en.cell()));
        let mut seen = HashSet::new();
        for w in st.entry_writes(en.id).filter(|w| w.stay != en.stay()) {
            let name = w.key();
            if !seen.insert(name) {
                continue;
            }
            let linked = (0..=generation).map(|g| KeyName::Entry(en.id, en.stay(), g)).find(|&to| st.sealed(name, to));
            let Some(to_name) = linked else { continue };
            let Some(under) = store.keys.first(to_name).cloned() else { continue };
            for secret in store.keys.held(name) {
                let id = secret.id();
                if ix.boxed.contains(&(name, id, to_name)) {
                    continue;
                }
                let to = Recipient::Key { name: to_name, id: under.id() };
                let bytes = keys::wrap(secret, &under, &box_info(name, id, &to), rng);
                let boxes = vec![KeyBox { to, bytes }];
                out.push(Work::Edit(Action::Keys { name, id, public: None, boxes, clear: None }));
            }
        }
    }
    for vt in st.vaults().iter().filter(|vt| st.acts_for(d, vt.id)) {
        out.extend(steward(store, &st, vt.id));
    }
    out
}

/// What a steward of vault `v` does, once it reads the selector of every cap of the vault (`Store::reads_caps`): for
/// each entry whose creation and tags it reads, it answers the asks for tags no write acting for the vault answered
/// yet, with what each asker's caps let it ask for, in one write acting for the vault; and moves an entry no ask waits
/// on to the cell its meaning asks for, if it isn't there (`policy::Meaning::desired`).
fn steward(store: &Store, st: &State, v: VaultId) -> Vec<Work> {
    if !store.reads_caps(st, v) {
        return vec![];
    }
    let r = &store.readings;
    let mut out = vec![];
    for en in st.entries().iter().filter(|en| en.vault == v) {
        if !r.headers.contains_key(&en.creation) || !en.retags.iter().all(|w| r.tags.contains_key(w)) {
            continue;
        }
        let Some(m) = st.meaning(en.id, r) else { continue };
        let ours = st.entry_writes(en.id).filter(|w| w.actor == v);
        let answered: HashSet<EditId> =
            ours.filter_map(|w| store.bodies.get(&w.edit)).flat_map(|b| b.answers.iter().copied()).collect();
        let asks: Vec<&Write> = st
            .entry_writes(en.id)
            .filter(|w| w.actor != v && !w.first && !answered.contains(&w.edit))
            .filter(|w| store.bodies.get(&w.edit).is_some_and(|b| !b.tags.is_empty()))
            .collect();
        if asks.is_empty() {
            if let Some(to) = m.desired {
                out.push(Work::Edit(Action::Move { vault: v, entry: en.id, to, keep: vec![], via: vec![] }));
            }
            continue;
        }
        let mut tags = m.attrs.tags.clone();
        for w in &asks {
            let attrs = Attrs { tags: tags.clone(), ..m.attrs.clone() };
            tags = granted(st, store, w.actor, v, &attrs, &store.bodies[&w.edit].tags).apply(&tags);
        }
        let add = tags.iter().filter(|t| !m.attrs.tags.contains(t)).cloned().collect();
        let remove = m.attrs.tags.iter().filter(|t| !tags.contains(t)).cloned().collect();
        let mut answers: Vec<EditId> = asks.iter().map(|w| w.edit).collect();
        answers.sort();
        let body = Body { header: None, tags: TagDelta { add, remove }, answers, content: vec![], proof: None };
        out.push(Work::Retag { vault: v, entry: en.id, body });
    }
    out
}

/// The part of `ask`, the tags vault `a` asks the stewards of vault `v` to add to and remove from an entry whose
/// attributes are `attrs`, that a's caps let it ask for: those over `v` it holds with write or more whose slice holds
/// the entry before the change and after it, each as far as every cap of its chain lets its grantee relabel.
fn granted(st: &State, store: &Store, a: VaultId, v: VaultId, attrs: &Attrs, ask: &TagDelta) -> TagDelta {
    let r = &store.readings;
    let after = Attrs { tags: ask.apply(&attrs.tags), ..attrs.clone() };
    let mut may: HashSet<&Sym> = HashSet::new();
    for cp in st.caps_held(a).filter(|cp| cp.cap.over == v && st.holds(a, cp, Role::Write)) {
        if !st.eff_selects(cp, attrs, r) || !st.eff_selects(cp, &after, r) {
            continue;
        }
        let relabel = |c: &CapId| store.slices.get(c).map(|s| &s.relabel[..]).unwrap_or_default();
        let mut chain = cp.chain.iter().map(relabel);
        let first: HashSet<&Sym> = chain.next().unwrap_or_default().iter().collect();
        may.extend(chain.fold(first, |acc, xs| acc.into_iter().filter(|t| xs.contains(t)).collect()));
    }
    let keep = |ts: &[Sym]| ts.iter().filter(|t| may.contains(t)).cloned().collect();
    TagDelta { add: keep(&ask.add), remove: keep(&ask.remove) }
}

/// The semantic cell of an entry of vault `v` its creator, the vault, made with attributes `attrs`, by what `r` reads:
/// the live caps over `v` that aren't wide whose slice holds it, in canonical order (`policy::Meaning::cell`).
fn semantic_cell(st: &State, v: VaultId, attrs: &Attrs, r: &Readings) -> Vec<CapId> {
    let picks = st.caps_over(v).filter(|cp| st.live(cp.id) && !cp.cap.wide && st.eff_selects(cp, attrs, r));
    mk_cell(&picks.map(|cp| cp.id).collect::<Vec<_>>())
}

/// A box of `secret` for target `t`, bound to `info(recipient)`: wrapped under the target's key where the device holds
/// it (its own key, a key an owner lends it, or a key it holds), and sealed otherwise to the target's public half, a
/// signer's or an announced seed's, an X-Wing key and the McEliece blob it names, once the blob is checked against that
/// name. `None` while the device holds neither, and for a cap's or a cell's key it doesn't hold: a steward boxes those.
#[allow(clippy::too_many_arguments)]
fn key_box(
    secret: &Secret,
    t: KeyName,
    info: &dyn Fn(&Recipient) -> Vec<u8>,
    st: &State,
    store: &Store,
    ix: &KeyIndex,
    mine: &[(SignerId, Secret)],
    rng: &mut SeededRng,
) -> Option<KeyBox> {
    let held = match t {
        KeyName::Signer(s) => mine.iter().find(|m| m.0 == s).map(|m| (Recipient::Signer(s), &m.1)),
        _ => store.keys.first(t).map(|k| (Recipient::Key { name: t, id: k.id() }, k)),
    };
    if let Some((to, under)) = held {
        let bytes = keys::wrap(secret, under, &info(&to), rng);
        return Some(KeyBox { to, bytes });
    }
    let (to, pk) = match t {
        KeyName::Signer(s) => (Recipient::Signer(s), st.seal_key(s)?),
        KeyName::Scoped(KeyFam::Seed(_), _) => {
            let made = ix.made.get(&t)?.iter().filter(|(_, p)| store.blobs.contains_key(&p.mceliece));
            let (i, p) = made.min_by_key(|m| m.0)?;
            (Recipient::Key { name: t, id: *i }, p)
        }
        _ => return None,
    };
    let blob = store.blobs.get(&pk.mceliece).filter(|b| BlobId::of(b) == pk.mceliece)?;
    let bytes = keys::seal(secret, pk, blob, &info(&to), rng)?;
    Some(KeyBox { to, bytes })
}

/// Rebuild what device `d` shows of each entry whose writes, or what it opened of them, changed: its history, each
/// write of its view with the content of its body where the device opened it, in replay order, and the item of each
/// line.
fn show_items(d: SignerId, store: &mut Store) {
    let st = &store.replay.state;
    let mut old = std::mem::take(&mut store.shown);
    let (mut shown, mut lanes) = (BTreeMap::new(), HashMap::new());
    for en in st.entries() {
        let ws: Vec<&Write> = st.entry_writes(en.id).collect();
        let mut h = Hasher::new("lab shown");
        for w in &ws {
            h.update(&w.edit.0).update(&[store.bodies.contains_key(&w.edit) as u8]);
        }
        // the lane it judges the writes by: it only grows
        h.update(&(st.lane_of(en.vault).count() as u64).to_be_bytes());
        let print = h.finalize();
        if let Some(s) = old.remove(&en.id).filter(|s| s.print == print) {
            shown.insert(en.id, s);
            continue;
        }
        // each write counted where what it builds on counts, it fits the schemas the entry was written under, and its
        // caps let it through, by its proof and what it touches (`policy::State::lets`): both read off it on one
        // scratch item (`History::reading_on`)
        let lane = lanes.entry(en.vault).or_insert_with(|| Lane::with_built_ins(st.lane_of(en.vault)));
        let (mut history, mut scratch) = (History::default(), None);
        for w in ws {
            let body = store.bodies.get(&w.edit);
            let (proof, content) = (body.and_then(|b| b.proof.as_ref()), body.map(|b| &b.content[..]));
            let counts = |d: &EditId| history.get(*d).is_some_and(|c| c.counted);
            let read = w.deps.iter().all(counts).then(|| history.reading_on(&mut scratch, w, content, d, lane));
            let fits = read.as_ref().is_none_or(|r| r.fits);
            let counted = read.is_some_and(|r| r.fits && st.lets(w, proof, r.touches.as_deref()));
            let change = Change { write: w.clone(), body: content.map(<[u8]>::to_vec), fits, counted };
            history.push(change).expect("the view's writes are causally closed");
        }
        let items = history.lines().into_iter().filter_map(|l| Some((l, history.item(l, d)?))).collect();
        shown.insert(en.id, Shown { history, items, print });
    }
    store.shown = shown;
}
