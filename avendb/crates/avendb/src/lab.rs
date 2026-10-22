//! The Lab: in-process devices on a network the test controls. Each device has its own keys, its own edits and its own
//! store, exactly what a real device would hold; there is also a relay server, a device of the aven avenMAIA
//! server, which holds relay shares and never reads, and any number of strangers. The scenario tests run on it, and so
//! do the nodes: a device split off to run on its own (`split`) is what `avendb-net` puts on iroh.
//!
//! A vault is a flat library of entries (notes, todos, profiles), each with a type and tags, and shares grant relay,
//! read, write or owner on any slice of it (`slice::Selector`): the whole vault, a type, a tag, an author, one entry,
//! or any AND/OR of those. An entry sits in the audience of the shares whose slices hold it, and every rule, every key
//! and all sync go by audiences (`policy`). The devices acting for a vault are its stewards: they read every selector
//! of the vault's shares and every entry's header and tags, and keep each entry in the audience its meaning asks for by
//! moving it (`policy::Meaning`). A steward creates an entry straight in its audience; anyone else creates it in the
//! intake audience of the share it creates it through, for a steward to move. A write by anyone but the vault that adds
//! or removes tags asks the stewards to, and a steward answers it with a write acting for the vault, carrying what each
//! counted ask asks for (its proof's chain allows those tags) where the slice of the share it proves holds the entry
//! before and after.
//!
//! A share's selector travels sealed in the share (`slice::Select`), to the seeds of the vault it is over, of its
//! grantee and of its issuer; a write's header, tags and content travel in its encrypted body (`slice::Body`). A device
//! keeps what it opened of both, as no edit changes them, and what it reads in them (`policy::Readings`).
//!
//! A keep share says which entries of a vault one device of its issuer syncs, by a selector as any share's, and how
//! (`policy::KeepMode`): keeping the files they bring whole, fetching a file's pieces as it reads them, or not syncing
//! them at all (`NewShare::keep`, `issue`): any data, by type, tag, author, entry or creation. It grants nothing, has
//! no ops and rests on no share. Its selector travels sealed as a share's, to the seeds of the vault it is over and of
//! its issuer; the stewards read it and mark each entry with the keep shares that pick it, in the mark that moves it to
//! its audience or in one of the wants alone (`policy::Action::Mark`), and every peer then sends a device only the
//! entries it may receive and its keep shares want (T28), reading the marks and never a selector (T23). A device with
//! no keep share over a vault, or only never ones, syncs all of it that it may but what a never one picks. Its issuer
//! alone revokes it, as any share is revoked (`policy::Revoking::Grant`).
//!
//! Every unlocked device keeps its keys up to date as an honest app would, each time its edits change. It opens every
//! box its standing `Keys` edits hold for a key it has and every key published in the clear, and derives the key of
//! each entry in each audience whose key it holds, for each stay the entry had there (`keys::entry_key`). For each
//! family it may open (a vault's seed, a share's key, an audience's key), it makes a random key of each epoch from the
//! oldest it holds to the current one where nobody has yet; announces the public half of each current seed it holds, as
//! keys are sealed only to seeds and signers; boxes each current key for every target the schedule names that has no
//! box yet, wrapped where it holds the target's key, sealed to a signer's or a seed's public half otherwise, and left
//! for a steward where it is a share's key it doesn't hold; publishes it if the family is public; and wraps each older
//! key it holds under the next epoch's. Where an entry moved to another audience, it wraps the keys of the entry's
//! earlier stays under the key it is under now (a move link), so the entry's readers read its whole history and nothing
//! else of the audiences it left. An owner key (a passkey) authoring an edit on a device lends it, for that ceremony
//! only, the key that is sealed to the owner: that is how a new device reads again after every other device is lost.
//!
//! A device shows each entry on every line of its history (`history`): it opens each write it can, and builds the item
//! of each line from the updates of that line's history. Proposing, merging, promoting, restoring, undoing and making a
//! variant are writes like any edit, encrypted under the entry's key and checked against the writer's shares. A draft
//! (`create_draft`) is a creation that starts its own line: the device shows it on that line alone until its vault
//! lands it on main (`history::History::landed`), and its stewards keep it out of every audience everyone reads until
//! then (`policy::State::meaning_landed`).
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
//! (`link_card`, `join`, `accept_join`), and a server no vault has claimed yet becomes a device of a new device vault,
//! avenMAIA, owned by the human vault of the first device that claims it, directly or through the coops of its
//! seed (`claim`, `accept_claim`).
//!
//! A Classic McEliece public key travels as a blob beside the edits that name it (`policy::Edit::blobs`): a device
//! keeps the blobs of the edits it keeps, each only if it hashes to its id, and seals to a key once it holds that key's
//! blob. Every edit is signed with ML-DSA-65, or SLH-DSA by a signer made before the key move (`sign`), so every
//! device counts every edit that stands, and trusts no curve.
//! Devices sync by what each holds of each log and the vaults each follows (`follow`), gossip one digest per log in
//! random orders, and go offline and come back; a device restored from a backup forks from what it made since
//! (`forks`), and follows what it followed.
//!
//! A vault's schemas and lenses are entries of its own, of the types schema and lens, each holding its JSON alone
//! (`add_schema`); the vault shares them with everyone, by a read share it issues before its first. Its lane is what a
//! device reads off those of them the vault created itself and the device counts (`lane_of`): what it reads and judges
//! the vault's entries by.

use std::borrow::Cow;
use std::cell::OnceCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::{Arc, OnceLock};
use std::sync::atomic::{AtomicUsize, Ordering};

use rand_core::Rng as _;
use serde_json::Value;
use zeroize::Zeroizing;

use crate::cast;
use crate::doc::{Item, Version};
use crate::encode::{self, box_info, share_context, share_select_info, write_context};
use crate::gate;
use crate::hash::{Hasher, Reader};
use crate::history::{Change, Draft, History, Reading, Scratch, MAIN};
use crate::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{self, KeyBox, KeyFam, KeyId, KeyName, PublicKey, Recipient, SeededRng, Secret};
use crate::lens::{self, Lane, Lens, Schema, View};
use crate::merge;
use crate::ops::Loc;
use crate::perf::Perf;
use crate::policy::{
    acting, covered, mk_audience, replay, replay_none, replay_on, replay_on_why, Action, Memo, At, Creation, Edit, Entry, Groups, Issued, KeepMode, Kind, Level, Line, Log,
    Meaning, Principal, Proposal, Readings, Refusal, Replay, Revoking, Setting, Share, Sharing, State, Vault, Who, Why,
    Wrap, Write,
};
use crate::recovery::RecoveryKey;
use crate::rules::{self, Grant, Op, Proof, Touch};
use crate::sealed::{Brought, FileRoot};
use crate::sign::{
    self, ApiPass, Ceremony, DeviceKey, EnclaveKey, Hello, Passkey, RelayPass, Signature, SignerKeys, Signed, Suite,
    SUITES, WebAuthn,
};
use crate::slice::{Attrs, Body, Header, Select, Selector, Slice, Sym, TagDelta, CAP_GROUP_TYPE, LENS_TYPE, SCHEMA_TYPE};
use crate::sync::{
    answer_ids, asks_ids, beyond, digests_ids, forks_in, link_places, log_of, logs_of, vault_logs, LogId, Place,
};
use crate::wire::{Claim, FileHold, Frontier, Join, Request, Statement, Wire as _};
use crate::world;

/// A device keeps its keys and audiences up to date in a few rounds at most: one to make and seal keys and move
/// entries, one to seal the keys of the audiences they moved to and link their history, one to answer what moved, one
/// to find nothing left. More means an edit the rules refuse, made again and again.
const ROUNDS: usize = 10;

/// The most edits one checkpoint covers: a key move's covers more as several, each a few hundred kilobytes at most.
const CHECKPOINT_COVERS: usize = 4096;

/// Blobs by id: the McEliece public keys a device holds, or sends beside its edits.
type Blobs = HashMap<BlobId, Arc<[u8]>>;

/// A tampering attempt, delivered to a device to show that it is rejected or opens nothing.
#[derive(Clone, Debug)]
pub enum Tamper {
    /// An edit the rules refuse, properly signed by `signers` and sent anyway: no share, or a made-up chain.
    Unchecked { signers: Vec<SignerId>, action: Action },
    /// An edit claiming a signature from a signer that didn't sign it.
    ForgedSignature { claimed: SignerId, action: Action },
    /// An accepted write with one byte of its ciphertext changed.
    ChangedCiphertext(EditId),
    /// A key from before a removal, sealed again to the removed device and replayed.
    ReplayedSeal { key: KeyName, to: SignerId },
}

/// A signer's private keys.
enum Key {
    /// A device.
    Device(DeviceKey),
    Passkey(Passkey),
    /// A software Touch ID key (`sign::EnclaveKey`), as the tests hold one.
    Enclave(EnclaveKey),
    /// A passkey in the platform's authenticator (P8e), or a Touch ID key in a Mac's Secure Enclave: no secret, only its
    /// keys and the public key sealed to it, as a ceremony showed them, and the id of that key, whose McEliece pair the
    /// process forgets as a device locks. It signs in a ceremony alone (`Lab::complete`).
    Web { keys: SignerKeys, seal: (PublicKey, Arc<[u8]>), pair: KeyId },
    /// A signer the Lab holds the public half of alone, and its standing consent to be added as an owner, as the master
    /// recovery key (`Lab::set_recovery`): it signs no edit but one that takes that consent (`sign::standing`).
    Consent(Arc<RecoveryKey>),
    /// A session's key (`Lab::host`): its keys, and how its holder, an agent on the same machine, signs an edit's id
    /// when asked. The Lab never holds its secret.
    Remote {
        keys: SignerKeys,
        sign: Remote,
    },
}

/// How a session's holder signs edit `id` (`Lab::host`): its signature, `None` where it refuses or is gone.
pub type Remote = Arc<dyn Fn(EditId) -> Option<Signature> + Send + Sync>;

impl Key {
    /// Its signature on edit `edit`: `None` for a passkey in the platform's authenticator, which signs in a ceremony.
    fn sign(&mut self, edit: EditId) -> Option<Signature> {
        match self {
            Key::Device(k) => Some(k.sign(edit)),
            Key::Passkey(p) => Some(p.sign(edit)),
            Key::Enclave(k) => Some(k.sign(edit)),
            Key::Remote { sign, .. } => sign(edit),
            Key::Web { .. } | Key::Consent(_) => None,
        }
    }

    /// The key that keys are sealed to for this signer: `None` for a passkey in the platform's authenticator, which
    /// lends it in a ceremony alone.
    fn seal_secret(&self) -> Option<Secret> {
        match self {
            Key::Device(k) => Some(k.seal_secret()),
            Key::Passkey(p) => Some(p.seal_secret()),
            Key::Enclave(k) => Some(k.seal_secret()),
            Key::Web { .. } | Key::Consent(_) | Key::Remote { .. } => None,
        }
    }

    /// The public key keys are sealed to for this signer, and the McEliece blob it names.
    fn seal_public(&self) -> (PublicKey, Arc<[u8]>) {
        match (self, self.seal_secret()) {
            (Key::Web { seal, .. }, _) => seal.clone(),
            (Key::Consent(k), _) => (k.seal.clone(), k.mceliece.clone()),
            (Key::Remote { .. }, _) => {
                unreachable!("a session's key is sealed to nowhere (`Lab::seal_public`)")
            }
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
            Key::Enclave(k) => k.keys(),
            Key::Web { keys, .. } | Key::Remote { keys, .. } => *keys,
            Key::Consent(k) => k.keys,
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

/// The edits of one vault a checkpoint by its person's key may cover (`Lab::vouch`), each in the order its device
/// holds it.
struct Vouch {
    vault: VaultId,
    /// Those every SLH-DSA signer of which moved to its next key, or acts for the vault no more.
    ready: Vec<EditId>,
    /// Those that wait on signers that still act for the vault in SLH-DSA, each with those signers.
    waiting: Vec<(EditId, Vec<SignerId>)>,
}

/// Edits drafted on a device one after another, each building on those drafted before it, for its passkeys to sign all
/// of them in one ceremony (`Lab::drafting`): as a person's first device founds their vault and adds itself, and the
/// first to claim a server founds avenMAIA and adds the server, in one ceremony instead of one for each edit.
pub struct Drafting<'a> {
    lab: &'a Lab,
    /// The device's log, with the edits drafted so far.
    log: Log,
    /// The replay of `log`'s edits: the device's own until a draft joins them, then stepped on with each
    /// (`policy::replay_on`), the choice of its resolve taken where it holds (`Memo`). No draft replays the whole log
    /// again: a key move's checkpoint over a big vault drafted a whole replay for each edit and each look, every removal
    /// tried each time (2026-10-22, about 12 s each on Samuel's Mac).
    replay: Cow<'a, Replay>,
    drafts: Vec<Unsigned>,
}

impl Drafting<'_> {
    /// Draft `action` signed by `signers`, as `Lab::draft` does, on top of the edits drafted before it: its edit's id.
    pub fn draft(&mut self, signers: &[SignerId], mut action: Action) -> Result<EditId, Refusal> {
        let (&author, cosigners) = signers.split_first().expect("an edit has an author");
        let blobs = self.lab.fill_seal_to(&mut action);
        let edit = self.log.check_on(&self.replay, true, author, cosigners, action)?;
        let (id, held) = (edit.id(), self.log.ids().len());
        self.log.receive([edit.clone()]);
        let was = std::mem::replace(&mut self.replay, Cow::Owned(replay_none(None))).into_owned();
        self.replay = Cow::Owned(replay_on(was, self.log.edits(), held));
        debug_assert!(*self.replay == self.log.replay(), "a draft stepped on differs from the replay");
        self.drafts.push(Unsigned { edit, blobs, held, batch: vec![], pass: None });
        Ok(id)
    }

    /// What the device's log says with the edits drafted so far.
    pub fn view(&self) -> State {
        self.replay.state.clone()
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
    /// Its audience keys, in the order it took them: what the entry keys derive from.
    audiences: Vec<KeyId>,
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
            if let KeyFam::Audience(..) = k {
                self.audiences.push(id);
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

/// Whether each of `signed`'s signatures check out, in order: on every core the machine has, as each check stands
/// alone (a restore of Maia City's 18,955 edits spent 11.2 s of its 13.5 s checking them on one core, 2026-10-20); on
/// one in a browser, which has no threads to spare.
fn checked_all(signed: &[Signed]) -> Vec<bool> {
    let one = |s: &Signed| s.verify().is_ok();
    #[cfg(not(target_arch = "wasm32"))]
    {
        let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
        if cores > 1 && signed.len() > 1 {
            let size = signed.len().div_ceil(cores);
            return std::thread::scope(|scope| {
                let parts: Vec<_> =
                    signed.chunks(size).map(|part| scope.spawn(move || part.iter().map(one).collect::<Vec<_>>())).collect();
                parts.into_iter().flat_map(|part| part.join().expect("a signature check")).collect()
            });
        }
    }
    signed.iter().map(one).collect()
}

/// Device `store`'s edits held on a checkpoint's word (`Store::bare`), after a replay: each one a checkpoint that
/// stands vouches for keeps only its signers' keys, its signatures let go of; each it doesn't keeps its signatures,
/// held as any other edit, where they check out; and the store lets go of the rest, to replay again. True if it let go
/// of any.
/// The count `refresh` adds to for how its replay went (`policy::replay_on_why`): where it replayed every edit again,
/// why.
fn why_counted(why: Why) -> &'static str {
    match why {
        Why::Nothing => "replay: nothing new",
        Why::Stepped => "replay: stepped on",
        Why::Tail => "replay: last edits again",
        Why::Whole(why) => why,
    }
}

fn trust(store: &mut Store) -> bool {
    let vouched = store.replay.vouched();
    let out: Vec<EditId> = store.bare.iter().filter(|id| !vouched.contains(id)).copied().collect();
    let mut gone = HashSet::new();
    for id in out {
        store.bare.remove(&id);
        if store.signed.get(&id).is_none_or(|s| s.verify().is_err()) {
            gone.insert(id);
        }
    }
    for id in &store.bare {
        if let Some(signed) = store.signed.get_mut(id) {
            for sig in signed.sigs.iter_mut().filter(|s| !s.pq.is_empty() || s.webauthn.is_some() || s.enclave.is_some()) {
                sig.pq = vec![];
                sig.webauthn = None;
                sig.enclave = None;
            }
        }
    }
    if gone.is_empty() {
        return false;
    }
    store.log.let_go(&gone);
    for id in &gone {
        store.signed.remove(id);
        store.bodies.remove(id);
        store.spoilt.remove(id);
    }
    store.replay = replay_none(store.replay.memo.take());
    store.replayed = 0;
    store.latest = OnceLock::new();
    store.digests = None;
    store.files_at = OnceLock::new();
    true
}

/// A device's key for what it seals on its own shelf (`Lab::shelf_key`): whoever holds the device's own key derives
/// it, and nobody else, so a seal a shelf holds is the device's word that it checked what the seal names.
pub struct ShelfKey(Secret);

impl ShelfKey {
    /// The seal of `bytes`.
    pub fn seal(&self, bytes: &[u8]) -> [u8; 32] {
        self.0.child("shelf head", bytes).bytes()
    }

    /// `bytes` encrypted for the device alone, as what `purpose` names, under `context`.
    fn lock(&self, purpose: &str, bytes: &[u8], context: &[u8], rng: &mut SeededRng) -> Vec<u8> {
        keys::encrypt(&self.0.child("shelf box", purpose.as_bytes()), bytes, context, rng)
    }

    /// What `lock` encrypted as `bytes`, if it did, as what `purpose` names, under `context`.
    fn unlock(&self, purpose: &str, bytes: &[u8], context: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
        keys::decrypt(&self.0.child("shelf box", purpose.as_bytes()), bytes, context).map(Zeroizing::new)
    }
}

/// The engine's own hash, of its sources (`build.rs`): what a device worked out with another engine it works out again.
const ENGINE: &str = env!("AVENDB_ENGINE");

/// What a device keeps on its shelf of what it worked out, encrypted for it alone, to start again from it quickly
/// (`Lab::restore_warm`): the choice its replay's resolve made (`policy::Memo`), for this engine alone (`ENGINE`), and
/// the keys it opened from their boxes, each part as `Lab::warming` gave it. It vouches for
/// nothing it doesn't check: a key counts only for the very box it opened, with the key it opens it with now, and
/// where its id is the one that box names; and the choice only for edits that turn on the same (`Memo`).
#[derive(Clone, Debug, Default)]
pub struct Warm {
    pub memo: Option<Vec<u8>>,
    pub keys: Vec<Vec<u8>>,
}

/// What a device worked out that its shelf lacks, each part encrypted for it alone (`Lab::warming`): the choice of its
/// replay's resolve and the keys it opened, for its shelf to take, and what of them it gave, for `Lab::warmed`.
pub struct Warming {
    pub memo: Option<Vec<u8>>,
    pub keys: Option<Vec<u8>>,
    memo_of: Option<Memo>,
    keys_of: usize,
}

/// The most askers and askings a device keeps what it worked out for (`Answers`): past them it starts over.
const ANSWERS_KEPT: usize = 256;

/// What a device worked out of its edits for its peers' syncs, while its edits stay as they were (Samuel's iPhone
/// 2026-10-22, a page every 9 s): which of its edits each asker may receive (`sync::answer`), and, for each asking a
/// peer makes page after page with the same request, the places of all it sends, in order (`Lab::reply`). Every page
/// and every announcement worked both out again over every edit the device held, an edit's id hashed again each time,
/// and a server holds every vault it keeps. Each is kept with the fingerprint of the edits it was worked out of
/// (`fingerprint`), and is worked out again once they differ.
#[derive(Default)]
struct Answers {
    may: std::sync::Mutex<HashMap<(SignerId, Vec<VaultId>), (u64, Arc<Vec<usize>>)>>,
    sends: std::sync::Mutex<HashMap<(SignerId, [u8; 32]), (u64, Arc<Vec<Place>>)>>,
}

/// The fingerprint of a log's edits, by their ids: how many, and their first eight bytes folded together.
fn fingerprint(ids: &[EditId]) -> u64 {
    let fold = ids.iter().fold(0u64, |acc, id| acc ^ u64::from_le_bytes(id.0[..8].try_into().expect("8 bytes")).rotate_left(acc as u32 & 63));
    fold ^ (ids.len() as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15)
}

/// What one device holds: its edits, each with its signatures, to pass on, and the blobs they name; what it makes of
/// them; the keys it holds; what it read with them; and the entries it shows.
struct Store {
    log: Log,
    signed: HashMap<EditId, Signed>,
    blobs: Blobs,
    /// The replay of its edits as it last brought itself up to date: which stand, and what it knows.
    replay: Replay,
    /// How many of its edits that replay is of, the first of its log: those after it step on it (`replay_on`).
    replayed: usize,
    /// What its edits say now, those it kept since that replay too (`Lab::latest`): replayed once for the edits it
    /// holds now, not on every ask, announce and fetch.
    latest: OnceLock<State>,
    /// Empty while it is locked, as is everything below.
    keys: Keyring,
    /// The entry keys it derived: by the key of the audience it derived each from, the entry and the stay.
    derived: HashSet<(KeyId, EntryId, Option<EditId>)>,
    /// The slices of the shares, keep shares among them, whose selectors it opened, and those whose selectors never
    /// open for it: garbled, or with no box for a key it holds that opens, or, where it is a steward, for no seed of
    /// the vault the share is over.
    slices: HashMap<ShareId, Slice>,
    unreadable: HashSet<ShareId>,
    /// The boxes it tried with the key they are to and that didn't open to their key, each by its key's id, whom it
    /// is to and its first bytes: tried once, not again at every refresh.
    unopened: HashSet<(KeyId, Recipient, [u8; 32])>,
    /// The bodies of the writes it opened, and the writes whose bodies never open: garbled under the key they name.
    bodies: HashMap<EditId, Body>,
    spoilt: HashSet<EditId>,
    /// What it reads of selectors, headers and tags, from the two above.
    readings: Readings,
    shown: BTreeMap<EntryId, Shown>,
    /// The digest of each log it holds (`sync::digests`), what it gossips: `None` until worked out for its edits now.
    digests: Option<BTreeMap<LogId, [u8; 32]>>,
    /// The vaults it follows, smallest first: it names them in each request (`sync::Ask::follow`), and is sent what
    /// everyone may read of them. Its own, never an edit's.
    follow: Vec<VaultId>,
    /// The most rows down a query on it reads, however deep the query asks (`engine`'s `query`). Its own too.
    query_depth: usize,
    /// It is a server that takes a new vault only where it welcomes it (`Lab::gate`). Its own too.
    gate: bool,
    /// What its work costs (`perf`): its own, never an edit's, and kept across a restore.
    perf: Perf,
    /// What it worked out of its edits for its peers' syncs, kept while its edits stay as they were (`Answers`).
    answers: Answers,
    /// Each file its opened bodies bring, by its root (`Lab::file`): worked out once, again after a body comes or goes.
    files_at: OnceLock<HashMap<FileRoot, Brought>>,
    /// The edits the checkpoints it holds cover (`covered`), and those of them it holds on a checkpoint's word: their
    /// signatures never checked, and let go of once one that stands vouches for them (`Replay::vouched`), a signer's
    /// keys kept.
    covers: HashSet<EditId>,
    bare: HashSet<EditId>,
    /// It took edits since it last brought its keys and items up to date (`receive_now`, `catch_up`).
    behind: bool,
    /// What it shows is to be checked against every entry's writes again (`show_items`): it holds nothing shown yet, a
    /// removal came since, or it let go of edits; else only the entries whose tips moved or that `opened` names.
    reshow: bool,
    /// The bodies it opened since it last showed its items, by their entries.
    opened: HashMap<EntryId, Vec<EditId>>,
    /// The entries whose shown items keep their scratch items (`SCRATCHES`).
    scratched: HashSet<EntryId>,
    /// How many writes its view held when it last showed its items, and the last of them, with the hashes of the
    /// lanes and the cap groups then: what tells that only new writes came since (`show_items`).
    shown_writes: (usize, Option<EditId>),
    shown_lanes: BTreeMap<VaultId, ([u8; 32], BTreeSet<BlobId>)>,
    shown_groups: [u8; 32],
    /// The keys it opened from their boxes before, from its shelf (`Warm::keys`), each by the box it opened and the
    /// key it opened it with (`opened_box`): that box it doesn't open again. And those it opened since its shelf took
    /// them (`Lab::warming`, `Lab::warmed`).
    opened_before: HashMap<[u8; 32], Secret>,
    opened_since: Vec<([u8; 32], Secret)>,
    /// The choice of its replay's resolve its shelf keeps, as it last gave it or took it from there (`Lab::warmed`).
    memo_given: Option<Memo>,
}

impl Default for Store {
    fn default() -> Store {
        Store {
            log: Log::new(),
            signed: HashMap::new(),
            blobs: HashMap::new(),
            replay: replay(&[]),
            replayed: 0,
            latest: OnceLock::new(),
            keys: Keyring::default(),
            derived: HashSet::new(),
            slices: HashMap::new(),
            unreadable: HashSet::new(),
            unopened: HashSet::new(),
            bodies: HashMap::new(),
            spoilt: HashSet::new(),
            readings: Readings::default(),
            shown: BTreeMap::new(),
            digests: None,
            follow: vec![],
            query_depth: lens::CEILING,
            gate: false,
            perf: Perf::default(),
            answers: Answers::default(),
            files_at: OnceLock::new(),
            covers: HashSet::new(),
            bare: HashSet::new(),
            behind: false,
            reshow: true,
            opened: HashMap::new(),
            scratched: HashSet::new(),
            shown_writes: (0, None),
            shown_lanes: BTreeMap::new(),
            shown_groups: [0; 32],
            opened_before: HashMap::new(),
            opened_since: vec![],
            memo_given: None,
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
        self.unopened.clear();
        self.bodies.clear();
        self.files_at = OnceLock::new();
        self.spoilt.clear();
        self.readings = Readings::default();
        self.shown.clear();
        self.reshow = true;
        self.opened.clear();
        self.opened_before.clear();
        self.opened_since.clear();
    }

    /// It read the selector of every live share over vault `v` but the keep shares, and of every share those rest on,
    /// or knows it never will: what a steward waits for before it works out any entry's audience. No keep share is in
    /// an audience, so one it can't read yet stalls none.
    fn reads_shares(&self, st: &State, v: VaultId) -> bool {
        let read = |c: &ShareId| self.slices.contains_key(c) || self.unreadable.contains(c);
        let mut shares = st.shares_over(v).filter(|cp| st.live(cp.id) && !cp.share.level.is_keep());
        shares.all(|cp| cp.chain.iter().all(read))
    }

    /// It read the selector of every live keep share over vault `v`, or knows it never will: what a steward waits for
    /// before it marks any entry with the keep shares that pick it.
    fn reads_keeps(&self, st: &State, v: VaultId) -> bool {
        let read = |k: &ShareId| self.slices.contains_key(k) || self.unreadable.contains(k);
        st.shares_over(v).filter(|k| k.share.level.is_keep() && st.live(k.id)).all(|k| read(&k.id))
    }
}

/// What a device shows of one entry: its history, every accepted write with what the device could open, the item of
/// each line where it opens any update, and a hash of which writes it holds and opened, to build it again only once
/// that changes; and its tip, what a refresh that removed nothing checks instead of that hash (`Tip`).
struct Shown {
    history: History,
    items: BTreeMap<Line, Item>,
    print: [u8; 32],
    tip: Tip,
    /// Where judging its writes left off, to judge the writes that come after on (`Judging::resume`).
    after: After,
}

/// What judging an entry's writes leaves, to judge a write that comes after them as judging all of them again would
/// (`Judging`): its scratch item, kept for the entries judged last alone (`SCRATCHES`), its attributes, whose its
/// rows are, which writes each line's item imported, and which schemas judging its writes looked up in the lane.
#[derive(Default)]
struct After {
    scratch: Option<Scratch>,
    attrs: Option<Attrs>,
    mine: crate::policy::Mine,
    imported: BTreeMap<Line, HashSet<EditId>>,
    asked: BTreeSet<BlobId>,
}

/// How many entries keep their scratch items between refreshes: those judged last, as a device edits a few at a time.
const SCRATCHES: usize = 32;

/// What a refresh checks of an entry it showed, where no removal came since and nothing was let go of
/// (`Store::reshow`): how many writes it holds and its last, the hashes of its vault's lane and of the cap groups.
/// Between such refreshes the writes of an entry only grow, each new one past those it held, so a write is new to it
/// exactly where its count changed; a body opened since marks its entry (`Store::opened`).
#[derive(Clone, Copy, PartialEq, Eq)]
struct Tip {
    writes: usize,
    last: Option<EditId>,
    lane: [u8; 32],
    groups: [u8; 32],
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
            // a `Keys` edit's boxes, or a `Wraps` edit's
            for (name, id, b) in edit.action.key_boxes() {
                ix.exists.insert(name);
                ix.exists.insert(b.to.name());
                ix.boxed.insert((name, id, b.to.name()));
                ix.boxes.push((name, id, b.clone()));
            }
            if let Action::Keys { name, id, public, clear, .. } = &edit.action {
                ix.exists.insert(*name);
                if let Some(p) = public {
                    ix.made.entry(*name).or_default().push((*id, p.clone()));
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

/// A share to issue (`Lab::issue`): a named group of ops (`rules`) its grantee may make on the entries of vault `over`
/// that `select` picks, and that every share it rests on allows and picks too. Its level is the class of its ops
/// (`rules::level_of`); a selector that picks all makes a wide share. The Lab seals its name, selector and ops into its
/// slice, the ops with a salt of their own.
///
/// A keep share (`keep`) is one to a device of its issuer (`Who::Device`): it has no ops and no parent, its level is
/// its mode, and its slice grants no op.
#[derive(Clone, Debug)]
pub struct NewShare {
    pub over: VaultId,
    pub who: Who,
    pub name: String,
    pub select: Selector,
    pub ops: Vec<Op>,
    /// The owner share its issuer relies on: `None` when the vault itself issues it.
    pub parent: Option<ShareId>,
    pub issuer: VaultId,
    /// How the device syncs what it picks, for a keep share.
    pub keep: Option<KeepMode>,
}

/// A share of one of its vault's cap groups (`Lab::issue_group`): over vault `over`, to `who`, at level `level`, of
/// the slice `select`, named `name`, issued by `issuer`, naming the cap group entry `group` of `over`.
#[derive(Clone, Debug)]
pub struct GroupShare {
    pub over: VaultId,
    pub who: Who,
    pub name: String,
    pub select: Selector,
    pub group: EntryId,
    pub level: Level,
    /// The owner share its issuer relies on: `None` when the vault itself issues it.
    pub parent: Option<ShareId>,
    pub issuer: VaultId,
}

/// One edit a device's upkeep calls for.
#[derive(Debug)]
enum Work {
    /// An edit signed as it is: a `Keys` edit, or a steward's move or marks.
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
    /// The devices off the network: they neither send nor receive.
    offline: HashSet<SignerId>,
    /// The time a new entry's header says it was created at, in seconds since 1970 (`set_now`).
    now: u64,
    /// A dry run (`dry`): a write is checked, proven and refused as ever, and then not made.
    dry: bool,
    /// The devices whose writes were kept while catching up was held back (`together`): each catches up once it ends.
    held_back: Option<BTreeSet<SignerId>>,
    /// Its devices are a patched app's (`patched`): they ignore the ops of the shares they write through, and the
    /// schemas of what they write.
    lawless: bool,
    /// The master recovery key every human vault it founds adds as an owner (`set_recovery`).
    recovery: Option<Arc<RecoveryKey>>,
    /// The sessions its devices host (`host`): each session's signer, with the device that keeps its store.
    hosted: HashMap<SignerId, Hosted>,
}

/// A session a device hosts (`Lab::host`): the device, and the keys the session's own key opens in that device's view,
/// worked out again once the view holds more edits.
struct Hosted {
    host: SignerId,
    opens: std::sync::Mutex<Option<(usize, Arc<HashSet<KeyName>>)>>,
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
            offline: HashSet::new(),
            now: 0,
            dry: false,
            held_back: None,
            lawless: false,
            recovery: None,
            hosted: HashMap::new(),
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

    /// The time new entries' headers say they were created at (`set_now`).
    pub fn now(&self) -> u64 {
        self.now
    }

    /// A nonce of the Lab's randomness, as a vault's genesis takes one: no two vaults founded alike share an id.
    pub fn nonce(&mut self) -> u64 {
        self.rng.next_u64()
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
        self.passkey_from_in(name, secret, sign::SIGNING)
    }

    /// `passkey_from`, its post-quantum key in suite `suite`: the same passkey in either suite, as its one PRF output
    /// derives both keys, and so two signers, the second its next key (the key move).
    pub fn passkey_from_in(&mut self, name: &str, secret: [u8; 32], suite: Suite) -> SignerId {
        let key = Passkey::from_seed_in(secret, suite);
        key.seal_secret().prepare();
        let id = key.id();
        self.keys.insert(id, Key::Passkey(key));
        self.names.insert(id, if name.ends_with("passkey") { name.into() } else { format!("{name}'s passkey") });
        id
    }

    /// A software Touch ID key (`sign::EnclaveKey`), as a Mac's Secure Enclave holds one: an owner signer like a
    /// passkey, which signs on the Mac whose Enclave holds it.
    pub fn touch_key(&mut self, name: &str) -> SignerId {
        let key = EnclaveKey::from_seed(self.secret("touch id key", name));
        key.seal_secret().prepare();
        let id = key.id();
        self.keys.insert(id, Key::Enclave(key));
        self.names.insert(id, format!("{name}'s Touch ID"));
        id
    }

    /// The secret of passkey `passkey`, a software passkey's private key, for another Lab to take it in
    /// (`passkey_from`): `None` if the Lab doesn't hold that passkey. A real passkey never leaves its authenticator.
    pub fn passkey_secret(&self, passkey: SignerId) -> Option<Zeroizing<[u8; 32]>> {
        match self.keys.get(&passkey)? {
            Key::Passkey(p) => Some(p.secret()),
            Key::Device(_) | Key::Enclave(_) | Key::Web { .. } | Key::Consent(_) | Key::Remote { .. } => None,
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
        self.device_with_in(name, secret, sign::SIGNING)
    }

    /// `device_with`, its post-quantum key in suite `suite`: from one secret, a device in each suite, the second its
    /// next key (the key move).
    pub fn device_with_in(&mut self, name: &str, secret: [u8; 32], suite: Suite) -> SignerId {
        self.add_device(DeviceKey::from_secret_in(secret, suite), name)
    }

    /// Device `id`, whose keys come from `secret`, as `device_with` makes it, in whichever suite they are its
    /// (`DeviceKey::of`): so a device made before the key move opens as itself. `None` if they are another device's.
    pub fn device_as(&mut self, name: &str, secret: [u8; 32], id: SignerId) -> Option<SignerId> {
        Some(self.add_device(DeviceKey::of(secret, id)?, name))
    }

    /// A passkey in the platform's authenticator (P8e), whose P-256 key is `p256`, as a ceremony of it over any
    /// challenge showed it (`sign::Ceremony`): the Lab holds its keys and the public key sealed to it, which the
    /// ceremony's PRF output derives, and no secret. It signs in ceremonies alone (`complete`). The PRF output derives
    /// its keys in each suite, and the Lab holds both, so that whichever its vault knows signs (`engine::passkey_of`),
    /// the other its next key (the key move): their ids, the suite new signers are made in first (`sign::SUITES`).
    /// `None` unless the ceremony's assertion is that key's.
    pub fn web_passkey(&mut self, name: &str, p256: [u8; 33], ceremony: &Ceremony) -> Option<[SignerId; 2]> {
        let assertion = ceremony.assertion()?;
        if !ceremony.challenge().is_some_and(|c| assertion.verify(&p256, EditId(c))) {
            return None;
        }
        Some(SUITES.map(|suite| self.web_key(name, ceremony.keys_in(p256, suite), ceremony)))
    }

    /// The owner key whose keys are `keys`, held as `web_passkey` and `web_enclave` hold it, from `ceremony`, its
    /// ceremony.
    fn web_key(&mut self, name: &str, keys: SignerKeys, ceremony: &Ceremony) -> SignerId {
        let secret = ceremony.seal_secret();
        let (seal, pair) = ((secret.public(), secret.mceliece_public()), secret.id());
        let id = keys.id();
        self.keys.insert(id, Key::Web { keys, seal, pair });
        let name = match keys {
            SignerKeys::Enclave { .. } if name.ends_with("Touch ID") => name.into(),
            SignerKeys::Enclave { .. } => format!("{name}'s Touch ID"),
            _ if name.ends_with("passkey") => name.into(),
            _ => format!("{name}'s passkey"),
        };
        self.names.insert(id, name);
        id
    }

    /// A Touch ID key in a Mac's Secure Enclave, as a ceremony of it over any challenge showed it (`sign::Ceremony::
    /// enclave`), held as `web_passkey` holds a passkey: its keys and the public key sealed to it, and no secret, in
    /// each suite, so that whichever its vault knows signs (the key move). It signs in ceremonies alone (`complete`).
    /// Its id in the suite new signers are made in. `None` unless it is a Touch ID key's ceremony whose Enclave
    /// signature verifies.
    pub fn web_enclave(&mut self, name: &str, ceremony: &Ceremony) -> Option<SignerId> {
        let keys = ceremony.enclave_keys()?;
        let challenge = ceremony.challenge()?;
        ceremony.sign(keys, EditId(challenge))?;
        let [new, _] = SUITES.map(|suite| self.web_key(name, ceremony.keys_in([0; 33], suite), ceremony));
        Some(new)
    }

    /// The keys of owner key `s`, held as `web_passkey` and `web_enclave` hold them if the Lab doesn't hold them yet and
    /// `ceremony` is that key's: so a Mac its Touch ID key opened, with no passkey's ceremony, takes its person's passkey
    /// in from the first ceremony it makes, as for a change only the vault's root makes (2026-10-19). A passkey's are
    /// those of the key its assertion recovers to whose keys hash to `s`, in either suite, as are a Touch ID key's: so
    /// a device takes in an owner key another device moved to ML-DSA-65 (the key move). `None` if neither is at hand.
    pub fn take_in(&mut self, s: SignerId, ceremony: &Ceremony) -> Option<SignerKeys> {
        if let Some(keys) = self.keys_of(s) {
            return Some(keys);
        }
        let name = self.names.get(&s).cloned().unwrap_or_else(|| "the person".into());
        let challenge = EditId(ceremony.challenge()?);
        let keys = match ceremony.assertion() {
            Some(a) => a.recover().into_iter().find_map(|p256| ceremony.keys_of(p256, s)),
            None => SUITES.map(|suite| ceremony.keys_in([0; 33], suite)).into_iter().find(|k| k.id() == s),
        }?;
        ceremony.sign(keys, challenge)?;
        self.web_key(&name, keys, ceremony);
        self.keys_of(s)
    }

    /// Of `keys`, the one the vault device `d` belongs to knows as an owner: so a device that holds its person's
    /// passkey in each suite (`web_passkey`) acts as one their vault knows (the key move). First one in the suite new
    /// signers are made in whose approval alone is the vault's, as the move adds it beside the earlier key, which
    /// stays the root (`draft_move`); then its root; then any owner. `None` if it knows none of them, or the device
    /// belongs to no vault.
    pub fn owner_among(&self, d: SignerId, keys: &[SignerId]) -> Option<SignerId> {
        let id = self.vault_of(d)?;
        let st = self.state(d);
        let vault = st.vault(id)?;
        let owner = |k: &&SignerId| vault.owners.contains(&Principal::Signer(**k));
        let next = |k: &SignerId| self.keys_of(*k).is_some_and(|x| x.suite() == sign::SIGNING);
        let alone = keys.iter().filter(owner).find(|&k| next(k) && st.approves(&[*k], Principal::Vault(id)));
        let root = keys.iter().find(|&&k| vault.root == Some(k));
        alone.or(root).or_else(|| keys.iter().find(owner)).copied()
    }

    /// Device `d`, whose keys come from `secret`, in each suite (the key move, K3b), as `web_passkey` holds a passkey:
    /// the one it signs as now and the other, its next key before the move, or after it the key it moved from, held
    /// beside it where the Lab doesn't hold them yet, with no store of their own, for the edits that move it to name
    /// and sign (`draft_move`, `finish_move`). One secret makes both, with the same iroh endpoint and the same key keys
    /// are sealed to: so the device opens again as its next key on the same shelf (`moved`), and what it wrapped under
    /// `own_key` opens as before. The Mac holds each drive it hosts so too, to move it beside its own device. Locking a
    /// device of the Lab forgets them. Their ids, the suite new signers are made in first; `None` if `secret` isn't
    /// `d`'s.
    pub fn device_keys(&mut self, d: SignerId, secret: [u8; 32]) -> Option<[SignerId; 2]> {
        DeviceKey::of(secret, d)?;
        let name = self.names.get(&d).cloned().unwrap_or_else(|| "a device".into());
        Some(SUITES.map(|suite| {
            let key = DeviceKey::from_secret_in(secret, suite);
            let id = key.id();
            if !self.keys.contains_key(&id) {
                key.seal_secret().prepare();
                self.keys.insert(id, Key::Device(key));
                self.names.entry(id).or_insert_with(|| name.clone());
            }
            id
        }))
    }

    /// The next key of signer `s` (the key move, K3b), in the suite new signers are made in, where `s` signs in
    /// another and the Lab holds both: the same passkey's other key (`web_passkey`), by its P-256 key; the same Touch
    /// ID key's (`web_enclave`), by its Enclave's key; the same device's (`device_keys`), by its ed25519 key. `None` if
    /// `s` is in that suite already, or either key isn't at hand.
    pub fn next_key(&self, s: SignerId) -> Option<SignerId> {
        self.next_of(self.keys_of(s)?)
    }

    /// The next key the Lab holds of the signer whose keys are `keys` (`next_key`), whether or not it holds that
    /// signer.
    fn next_of(&self, keys: SignerKeys) -> Option<SignerId> {
        if keys.suite() == sign::SIGNING {
            return None;
        }
        let held = self.keys.values().map(Key::keys).filter(|k| k.suite() == sign::SIGNING && same_key(&keys, k));
        held.map(|k| k.id()).min()
    }

    /// The signers among `signers` whose next key is among them too, as device `d` saw them sign or holds them
    /// (`signers_seen`), each with that key: an earlier key the key move kept beside its next (`draft_move`), the
    /// same passkey, Touch ID key or device.
    pub fn earlier_keys(&self, d: SignerId, signers: &BTreeSet<SignerId>) -> BTreeMap<SignerId, SignerId> {
        let seen = self.signers_seen(d, signers);
        let next = |keys: &SignerKeys| {
            let next = seen.values().filter(|k| k.suite() == sign::SIGNING && same_key(keys, k));
            next.map(|k| k.id()).min()
        };
        let earlier = seen.iter().filter(|(_, k)| k.suite() != sign::SIGNING);
        earlier.filter_map(|(&s, k)| Some((s, next(k)?))).collect()
    }

    /// What device `on` moves to ML-DSA-65 now (the key move, K3b), each signer with its next key: each owner key of
    /// the vault it belongs to that signs in SLH-DSA and whose next key is at hand (`next_key`), and the Touch ID key
    /// whose Enclave's key `touch` names (`sign::enclave_key`), as a touch of it signs as its next key too; the master
    /// recovery key made before the move, whose next key is the one the Lab adds (`set_recovery`, K4); and each
    /// device of that vault whose next key the Lab holds (`device_keys`): `on`, or the key `on` moved from, where it
    /// is in the vault still, and any device `on` runs beside it, as the Mac runs its drives. A signer whose next key
    /// is in the vault already moved: the move keeps the earlier key beside it (`draft_move`). Nothing once they all
    /// moved, or if `on` belongs to no vault.
    pub fn moves(&self, on: SignerId, touch: Option<[u8; 32]>) -> Vec<(SignerId, SignerId)> {
        let Some(vault) = self.vault_of(on).and_then(|v| self.state(on).vault(v)) else { return vec![] };
        let owners = vault.owners.iter().filter_map(|p| if let Principal::Signer(s) = *p { Some(s) } else { None });
        let signers: BTreeSet<SignerId> = owners.chain(vault.devices.iter().copied()).collect();
        let next = |keys: SignerKeys| match keys {
            SignerKeys::Enclave { mldsa, slh: Some(_) } if Some(mldsa) == touch => {
                Some(SignerKeys::Enclave { mldsa, slh: None }.id())
            }
            _ => self.next_of(keys),
        };
        let seen = self.signers_seen(on, &signers);
        let next = |keys| next(keys).filter(|n| !signers.contains(n));
        seen.into_iter().filter_map(|(s, keys)| Some((s, next(keys)?))).collect()
    }

    /// The devices of each aven or device vault that the vault device `on` belongs to owns, up the chain, that sign in
    /// another suite than new signers are made in and whose next key isn't a device beside them yet, as `on`'s view and
    /// the signatures it holds say, each with its endpoint, its ed25519 key: the server and the agents of its person's
    /// coop's aven, which their own move (`moves`) doesn't reach, as they belong to the aven. `on` asks each for its next
    /// key (`move_key`) and adds it with theirs (`draft_move`; the key move, K3c). None if `on` belongs to no vault.
    pub fn aven_devices(&self, on: SignerId) -> Vec<(SignerId, [u8; 32])> {
        let Some(mine) = self.vault_of(on) else { return vec![] };
        let st = self.state(on);
        let governed: Vec<&Vault> = st.vaults().iter().filter(|v| claimable(v.kind) && st.owns(mine, v.id)).collect();
        let devices: BTreeSet<SignerId> = governed.iter().flat_map(|v| v.devices.iter().copied()).collect();
        let seen = self.signers_seen(on, &devices);
        let next = |keys: &SignerKeys| seen.values().any(|k| k.suite() == sign::SIGNING && same_key(keys, k));
        let mut out = vec![];
        for (d, keys) in governed.iter().flat_map(|v| &v.devices).filter_map(|d| Some((*d, seen.get(d)?))) {
            if let SignerKeys::Device { ed25519, .. } = keys
                && keys.suite() != sign::SIGNING
                && !next(keys)
                && !out.iter().any(|&(o, _)| o == d)
            {
                out.push((d, *ed25519));
            }
        }
        out
    }

    /// Every device of each aven or device vault the vault device `on` belongs to governs, up the chain, whichever
    /// suite it signs in: its person's coop's server and agents (`aven_devices`). None if `on` belongs to no vault.
    pub fn governed_devices(&self, on: SignerId) -> BTreeSet<SignerId> {
        let Some(mine) = self.vault_of(on) else { return BTreeSet::new() };
        let st = self.state(on);
        let governed = st.vaults().iter().filter(|v| claimable(v.kind) && st.owns(mine, v.id));
        governed.flat_map(|v| v.devices.iter().copied()).collect()
    }

    /// The edits that move `moves`' signers to their next keys (`moves`) on device `on`, drafted together for one
    /// ceremony of each owner key among them (`drafting`): an owner key adds its next key as an owner, which signs too
    /// (with the root, where an owner's approval alone isn't the vault's), but `by` adds the master recovery key's,
    /// whose secret is offline and which signs by its standing consent (K4); then the vault's approval, by `by` or its
    /// next key, adds each device's next key, which signs too, to the vault the device belongs to: `on`'s, or, last,
    /// an aven or a device vault that approval governs, for its server or an agent, whose next key the device handed
    /// (`move_key`) and signs in (`claim`, `accept_claim`; K3c). It only adds: every earlier key stays an owner or a
    /// device beside its next, the root where it was, as one secret makes both and nothing moves away from the person
    /// (Samuel 2026-10-20, "Add, never remove"). A removal cuts every edit resting on what it removes that its drafter
    /// doesn't hold (T16), so a move drafted on a device that didn't hold one of the person's vaults yet erased that
    /// vault on every device it reached; an addition cuts nothing, on whatever view it was drafted. Every step is an
    /// edit avenDB's Lean model's `keyMove` makes: no edit is signed again, nothing founded again, and the old edits
    /// keep their signatures. Each step is drafted only where it is still to be made, so a move cut short goes on
    /// where it stopped, and nothing is drafted once the keys moved. `NotActing` if `on` belongs to no vault;
    /// otherwise why `on`'s view refuses a step.
    pub fn draft_move(
        &self,
        on: SignerId,
        moves: &[(SignerId, SignerId)],
        by: SignerId,
    ) -> Result<Vec<Unsigned>, Refusal> {
        let vault = self.vault_of(on).ok_or(Refusal::NotActing)?;
        let approves = |view: &State, s: &[SignerId]| view.approves(s, Principal::Vault(vault));
        let owner = |view: &State, s| view.vault(vault).is_some_and(|v| v.owners.contains(&Principal::Signer(s)));
        let root = |view: &State| view.vault(vault).and_then(|v| v.root);
        let mut drafting = self.drafting(on);
        let view = drafting.view();
        let owners = moves.iter().copied().filter(|&(old, new)| owner(&view, old) && !owner(&view, new));
        for (old, new) in owners {
            let adder = if Some(new) == self.recovery() { by } else { old };
            let mut signers = vec![adder];
            signers.extend(root(&view).filter(|&r| r != adder && !approves(&view, &[adder])));
            signers.push(new);
            let (seal_to, blobs) = self.next_seal(on, &view, old, new);
            let add = Sharing::Owner { vault, owner: Principal::Signer(new), seal_to };
            drafting.draft(&signers, Action::Share(add))?;
            drafting.drafts.last_mut().expect("drafted").blobs.extend(blobs);
        }
        let view = drafting.view();
        let by = moves.iter().find(|&&(old, _)| old == by).map_or(by, |&(_, new)| new);
        // each device's next key joins the vault the device belongs to: the person's own, or an aven or a device vault
        // they govern, its server's and its agents' (K3c), after theirs
        let of = |old| match view.is_device(old, vault) {
            true => Some(vault),
            false => view.vaults().iter().find(|v| claimable(v.kind) && v.devices.contains(&old)).map(|v| v.id),
        };
        let joining = moves.iter().filter_map(|&(old, new)| Some((old, new, of(old)?)));
        let mut joining: Vec<_> = joining.filter(|&(_, new, v)| !view.is_device(new, v)).collect();
        joining.sort_by_key(|&(_, _, v)| v != vault);
        for (old, new, v) in joining {
            let (seal_to, blobs) = self.next_seal(on, &view, old, new);
            drafting.draft(&[by, new], Action::Share(Sharing::Device { vault: v, device: new, seal_to }))?;
            drafting.drafts.last_mut().expect("drafted").blobs.extend(blobs);
        }
        // last, by the next key (never an SLH-DSA key, whose signature it does away with), a checkpoint over each vault
        // that approval governs: the edits `on` holds that carry
        // an SLH-DSA signature, whose signers acted for that vault, held from then on without their signatures
        // (`Checkpoint.lean`), so no device checks an SLH-DSA signature again
        let next = moves.iter().any(|&(_, new)| new == by) || self.keys_of(by).is_some_and(|k| k.suite() != Suite::SlhDsa);
        if next {
            self.draft_checkpoints(on, &mut drafting, by)?;
        }
        Ok(drafting.done())
    }

    /// On top of `drafting`, by `by`, a next key, a checkpoint over each vault `by` approves for, covering what
    /// `uncovered` finds, in parts of at most `CHECKPOINT_COVERS` edits.
    fn draft_checkpoints(&self, on: SignerId, drafting: &mut Drafting, by: SignerId) -> Result<(), Refusal> {
        for (vault, covers) in self.uncovered(on, &drafting, by) {
            for part in covers.chunks(CHECKPOINT_COVERS) {
                drafting.draft(&[by], Action::Checkpoint { vault, covers: part.to_vec() })?;
            }
        }
        Ok(())
    }

    /// Device `on`'s checkpoints alone, signed by `by` (its person's key, moved to ML-DSA-65): over the edits earlier
    /// keys signed that no checkpoint covers yet (`uncovered`), for a person with nothing left to move or retire whose
    /// keys moved before a move drafted checkpoints, or whose vaults took such edits since. Without `all`, only those
    /// no earlier key signs any more (`Vouch::ready`), as each unlock asks: an edit of a key still to move is covered
    /// at its own move, not by a ceremony at each unlock until then. With `all`, as its person asks for it, every one
    /// `by` may vouch for, the edits of keys that still sign the old way too (`Vouch::waiting`): the vault's owners
    /// approve anything it may do, so their word adds no power (`Checkpoint.lean`). Empty if there are none.
    pub fn draft_checkpoint(&self, on: SignerId, by: SignerId, all: bool) -> Result<Vec<Unsigned>, Refusal> {
        if self.keys_of(by).is_none_or(|k| k.suite() == Suite::SlhDsa) {
            return Ok(vec![]);
        }
        let mut drafting = self.drafting(on);
        for Vouch { vault, ready, waiting } in self.vouch(on, &drafting, by) {
            let mut covers = ready;
            if all {
                covers.extend(waiting.into_iter().map(|(id, _)| id));
            }
            for part in covers.chunks(CHECKPOINT_COVERS) {
                drafting.draft(&[by], Action::Checkpoint { vault, covers: part.to_vec() })?;
            }
        }
        Ok(drafting.done())
    }

    /// For each vault `by` approves on device `on`, the edits a checkpoint by `by` may cover (`uncovered`), in `log`'s
    /// order: those whose SLH-DSA signers all moved to their next keys or act for the vault no more, and those that
    /// wait on a signer that still acts for it in SLH-DSA, each with those signers.
    fn vouch(&self, on: SignerId, drafting: &Drafting, by: SignerId) -> Vec<Vouch> {
        let store = self.held(on);
        let view = &drafting.replay.state;
        let slh = |id: &EditId| -> Vec<SignerId> {
            let sigs = store.signed.get(id).map(|s| s.sigs.as_slice()).unwrap_or_default();
            sigs.iter().filter(|x| x.keys.suite() == Suite::SlhDsa).map(|x| x.keys.id()).collect()
        };
        let uncovered = self.uncovered(on, drafting, by);
        let mut signers: BTreeSet<SignerId> = uncovered.iter().flat_map(|(_, ids)| ids.iter().flat_map(slh)).collect();
        // beside each vault's owners and devices, among which a moved key's next key is
        for v in uncovered.iter().filter_map(|(v, _)| view.vault(*v)) {
            signers.extend(v.devices.iter().copied());
            signers.extend(v.owners.iter().filter_map(|p| match p {
                Principal::Signer(s) => Some(*s),
                _ => None,
            }));
        }
        let moved = self.earlier_keys(on, &signers);
        let mut out = vec![];
        for (vault, covers) in uncovered {
            let done = |s: &SignerId| moved.contains_key(s) || !view.acts_for(*s, vault);
            let (mut ready, mut waiting) = (vec![], vec![]);
            for id in covers {
                let held: Vec<SignerId> = slh(&id).into_iter().filter(|s| !done(s)).collect();
                match held.is_empty() {
                    true => ready.push(id),
                    false => waiting.push((id, held)),
                }
            }
            out.push(Vouch { vault, ready, waiting });
        }
        out
    }

    /// Where device `on`'s old signatures stand for a checkpoint, as its Performance page shows it: what one by its
    /// person's key at hand (`vouching_key`) would cover now, by vault, `ready` as each unlock offers it and `waiting`
    /// on a key that still signs in SLH-DSA, and those keys, the most edits first, each with what it is of which vault;
    /// and `others`, the edits no checkpoint of theirs may cover, whose signers never acted for a vault they govern.
    /// Null while no key of theirs in ML-DSA-65 is at hand.
    pub fn vouching(&self, on: SignerId) -> Value {
        let Some(by) = self.vouching_key(on) else { return Value::Null };
        let drafting = self.drafting(on);
        let vouch = self.vouch(on, &drafting, by);
        let view = &drafting.replay.state;
        let mut keys: BTreeMap<SignerId, usize> = BTreeMap::new();
        for (_, held) in vouch.iter().flat_map(|v| &v.waiting) {
            held.iter().for_each(|s| *keys.entry(*s).or_default() += 1);
        }
        let seen = self.signers_seen(on, &keys.keys().copied().collect());
        let what = |s: SignerId| {
            let device = view.vaults().iter().find(|v| v.devices.contains(&s)).map(|v| ("device", v.id));
            let owner = || view.vaults().iter().find(|v| v.owners.contains(&Principal::Signer(s))).map(|v| ("owner", v.id));
            let recovery = seen.get(&s).is_some_and(|k| self.is_recovery(k));
            match device.or_else(owner) {
                Some((_, v)) if recovery => ("recovery", Some(v)),
                Some((role, v)) => (role, Some(v)),
                None => (if recovery { "recovery" } else { "signer" }, None),
            }
        };
        let mut keys: Vec<(SignerId, usize)> = keys.into_iter().collect();
        keys.sort_by_key(|&(s, n)| (std::cmp::Reverse(n), s));
        let hex = |v: VaultId| crate::words::hex(&v.0);
        let keys: Vec<Value> = keys
            .into_iter()
            .map(|(s, n)| {
                let (role, of) = what(s);
                serde_json::json!({ "signer": s.to_hex(), "role": role, "of": of.map(hex), "edits": n })
            })
            .collect();
        let ready: usize = vouch.iter().map(|v| v.ready.len()).sum();
        let waiting: usize = vouch.iter().map(|v| v.waiting.len()).sum();
        let vaults: Vec<Value> = vouch
            .iter()
            .map(|v| serde_json::json!({ "vault": hex(v.vault), "ready": v.ready.len(), "waiting": v.waiting.len() }))
            .collect();
        let others = self.uncovered_count(on).saturating_sub(ready + waiting);
        serde_json::json!({ "by": by.to_hex(), "ready": ready, "waiting": waiting, "vaults": vaults, "keys": keys, "others": others })
    }

    /// The key of device `on`'s person a checkpoint of theirs is signed by (`draft_checkpoint`), as the Lab holds
    /// their keys: an owner key of the vault `on` belongs to, in ML-DSA-65, whose approval alone is the vault's where
    /// one is (`owner_among`). None while none is at hand.
    pub fn vouching_key(&self, on: SignerId) -> Option<SignerId> {
        let next = |k: &SignerId| self.keys_of(*k).is_some_and(|x| x.suite() == sign::SIGNING);
        let held: Vec<SignerId> = self.keys.keys().copied().filter(next).collect();
        self.owner_among(on, &held).filter(next)
    }

    /// How many of device `on`'s edits carry an SLH-DSA signature no checkpoint it holds covers, and so still need
    /// their signatures checked: none left, on a device holding everything, and its old signature code can go (K6).
    pub fn uncovered_count(&self, on: SignerId) -> usize {
        let store = self.held(on);
        let slh = |s: &Signed| s.sigs.iter().any(|x| x.keys.suite() == Suite::SlhDsa);
        store.log.ids().iter().filter(|id| !store.covers.contains(id) && store.signed.get(id).is_some_and(slh)).count()
    }

    /// `uncovered_count` by the vault each edit is of (`sync::log_of`), most first: `{vault, edits}`, the vault's id.
    pub fn uncovered_by(&self, on: SignerId) -> Vec<Value> {
        let store = self.held(on);
        let st = store.view();
        let slh = |s: &Signed| s.sigs.iter().any(|x| x.keys.suite() == Suite::SlhDsa);
        let vault = |id: &EditId| {
            let e = &store.signed.get(id)?.edit;
            match crate::sync::log_of(e, *id)? {
                LogId::Vault(v) | LogId::Audience(v, _) => Some(v),
                LogId::Entry(en) => st.entry(en).map(|en| en.vault),
                LogId::Share(c) => st.share(c).map(|cp| cp.share.over),
            }
        };
        let mut by: BTreeMap<Option<VaultId>, usize> = BTreeMap::new();
        for id in store.log.ids().iter().filter(|id| !store.covers.contains(id)) {
            if store.signed.get(id).is_some_and(slh) {
                *by.entry(vault(id)).or_default() += 1;
            }
        }
        let mut out: Vec<(Option<VaultId>, usize)> = by.into_iter().collect();
        out.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        out.into_iter().map(|(v, n)| serde_json::json!({ "vault": v.map(|v| crate::words::hex(&v.0)), "edits": n })).collect()
    }

    /// For each vault `by` approves in `log`, `on`'s edits, drafted moves among them, a checkpoint over it would cover
    /// that none covers yet: those that stand and carry an SLH-DSA signature, every signer of which acted for the vault
    /// just before or just after it (`acting`). Each edit under the first vault, in `log`'s order, that may cover it.
    fn uncovered(&self, on: SignerId, drafting: &Drafting, by: SignerId) -> Vec<(VaultId, Vec<EditId>)> {
        let store = self.held(on);
        let (log, view) = (&drafting.log, &drafting.replay.state);
        let vaults: Vec<VaultId> =
            view.vaults().iter().map(|v| v.id).filter(|&v| view.approves(&[by], Principal::Vault(v))).collect();
        // signed by an SLH-DSA key: as its signatures say, or, for an edit of the move not signed yet, its keys at hand
        let slh = |id: &EditId, e: &Edit| match store.signed.get(id) {
            Some(s) => s.sigs.iter().any(|x| x.keys.suite() == Suite::SlhDsa),
            None => e.sigs().any(|s| self.keys_of(s).is_some_and(|k| k.suite() == Suite::SlhDsa)),
        };
        let edits = log.ids().iter().zip(log.edits());
        let watch: HashMap<EditId, Vec<VaultId>> =
            edits.filter(|(id, e)| !store.covers.contains(id) && slh(id, e)).map(|(&id, _)| (id, vaults.clone())).collect();
        if watch.is_empty() {
            return vec![];
        }
        let acts = acting(log.edits(), &watch, drafting.replay.memo.as_ref());
        let mut out: Vec<(VaultId, Vec<EditId>)> = vaults.iter().map(|&v| (v, vec![])).collect();
        for id in log.ids().iter().filter(|id| watch.contains_key(id)) {
            if let Some((_, covers)) = out.iter_mut().find(|(v, _)| acts.contains(&(*id, *v))) {
                covers.push(*id);
            }
        }
        out.retain(|(_, covers)| !covers.is_empty());
        out
    }

    /// The key to seal to of `new`, the next key of `old` (`draft_move`), for the edit that adds it: its own where
    /// the Lab holds it, else `old`'s as `view` knows it, the same, as one secret makes both; and the McEliece key it
    /// names, as the Lab or device `on` holds it.
    fn next_seal(&self, on: SignerId, view: &State, old: SignerId, new: SignerId) -> (Option<PublicKey>, Blobs) {
        let (key, blob) = match self.seal_public(new) {
            Some((key, blob)) => (key, Some(blob)),
            None => match view.seal_key(old) {
                Some(key) => (key.clone(), self.blob(on, key.mceliece)),
                None => return (None, Blobs::new()),
            },
        };
        let blobs = blob.map(|b| (key.mceliece, b)).into_iter().collect();
        (Some(key), blobs)
    }

    /// Sign the move's edits (`draft_move`) and keep them on device `on` in their order, each signer by its ceremony
    /// among `ceremonies` or by its key at hand (`complete`). The ids of the edits kept.
    pub fn complete_move(
        &mut self,
        on: SignerId,
        drafts: Vec<Unsigned>,
        ceremonies: &[(SignerId, &Ceremony)],
    ) -> Result<Vec<EditId>, Refusal> {
        drafts.into_iter().map(|draft| self.complete(on, draft, ceremonies)).collect()
    }

    /// The key move's last step on device `on` (K3b), once the move's edits are kept (`complete_move`) and what opens
    /// each device again names its next key: each device of `moves` whose next key is a device of the vault `on`
    /// belongs to hands that key the keep shares naming it, its copy setting among them (`carry_keeps`), so it keeps
    /// what the device kept. The device stays in the vault beside its next key (`draft_move`).
    pub fn finish_move(&mut self, on: SignerId, moves: &[(SignerId, SignerId)]) -> Result<(), Refusal> {
        let vault = self.vault_of(on).ok_or(Refusal::NotActing)?;
        let st = self.state(on);
        let moved: Vec<(SignerId, SignerId)> =
            moves.iter().copied().filter(|&(old, new)| st.is_device(old, vault) && st.is_device(new, vault)).collect();
        for (old, new) in moved {
            self.carry_keeps(on, old, new)?;
        }
        Ok(())
    }

    /// The live keep shares naming device `old` that the vault device `on` belongs to issued, issued again to `new`,
    /// its next key, which signs them: over the same vault, in the same mode, on the same selector as `on` reads it,
    /// the whole vault for a wide one, as a copy setting is. One `new` has the like of already stays as it is, and one
    /// whose selector `on` doesn't read can't be issued again.
    fn carry_keeps(&mut self, on: SignerId, old: SignerId, new: SignerId) -> Result<(), Refusal> {
        let Some(vault) = self.vault_of(on) else { return Ok(()) };
        let st = self.state(on);
        let keeps = |d| {
            let named = move |k: &&Issued| k.share.level.is_keep() && k.share.who == Who::Device(d);
            st.shares().iter().filter(named).filter(move |k| k.share.issuer == vault && st.live(k.id))
        };
        let what = |k: &Issued| {
            let select = if k.share.wide { Selector::All } else { self.slice(on, k.id)?.select.clone() };
            Some((k.share.over, k.share.level.mode()?, select))
        };
        let held: Vec<_> = keeps(new).filter_map(what).collect();
        let carried: Vec<_> = keeps(old).filter_map(what).filter(|w| !held.contains(w)).collect();
        for (over, mode, select) in carried {
            self.issue(on, &[new], cast::keep(vault, new, over, mode, select))?;
        }
        Ok(())
    }

    /// What device `on`'s person retires now, once their keys moved (`moves` names none): the key move's last part
    /// (Samuel 2026-10-20 18:56, "you should have removed all the old keys"), the steps the move itself no longer takes
    /// (`draft_move`, "Add, never remove"). In the vault `on` belongs to: the root, where it signs in another suite
    /// than new signers are made in and its next key is an owner, handed on to that key; each other owner key in that
    /// suite whose next key is an owner, and the master recovery key from before the move (`is_recovery`) beside the
    /// one the Lab adds; each device in that suite but `on` whose next key is a device beside it, or that never moved
    /// and isn't among `live`, its person's own browser or Mac that hasn't opened since (one that runs now moves at its
    /// unlock). In each aven or device vault it governs, the server's and the agents': each device in that suite whose
    /// next key is a device beside it and among `live`, those that answer as that key now, so none is cut off while it
    /// still runs as the earlier one; one that never moved stays. A removal cuts what rests on it that its drafter
    /// doesn't hold (T16): the caller drafts them (`draft_retire`) only once `on` holds what its peers hold. Nothing if
    /// `on` belongs to no vault.
    pub fn retires(&self, on: SignerId, live: &BTreeSet<SignerId>) -> Vec<Retire> {
        let Some(mine) = self.vault_of(on) else { return vec![] };
        let st = self.state(on);
        let Some(vault) = st.vault(mine) else { return vec![] };
        let signer = |p: &Principal| if let Principal::Signer(s) = *p { Some(s) } else { None };
        let owners: BTreeSet<SignerId> = vault.owners.iter().filter_map(signer).collect();
        let governed: Vec<&Vault> = st.vaults().iter().filter(|v| claimable(v.kind) && st.owns(mine, v.id)).collect();
        let devices: BTreeSet<SignerId> =
            vault.devices.iter().chain(governed.iter().flat_map(|v| &v.devices)).copied().collect();
        let all: BTreeSet<SignerId> = owners.union(&devices).copied().collect();
        let seen = self.signers_seen(on, &all);
        let old = |s: &SignerId| seen.get(s).is_some_and(|k| k.suite() != sign::SIGNING);
        let next = self.earlier_keys(on, &all);
        let legacy = |s: &SignerId| seen.get(s).is_some_and(|k| self.is_recovery(k));
        let mut out = vec![];
        if let Some(r) = vault.root.filter(old)
            && let Some(&n) = next.get(&r).filter(|n| owners.contains(n))
        {
            out.push(Retire::Root { old: r, new: n });
        }
        for s in owners.iter().filter(|s| old(s)) {
            let moved = next.get(s).is_some_and(|n| owners.contains(n));
            let replaced = legacy(s) && self.recovery().is_some_and(|m| m != *s && owners.contains(&m));
            if moved || replaced {
                out.push(Retire::Owner(*s));
            }
        }
        for &d in vault.devices.iter().filter(|&&d| d != on && old(&d)) {
            if next.get(&d).map_or(!live.contains(&d), |n| vault.devices.contains(n)) {
                out.push(Retire::Device { vault: mine, device: d });
            }
        }
        for v in governed {
            for &d in v.devices.iter().filter(|d| old(d)) {
                if next.get(&d).is_some_and(|n| v.devices.contains(n) && live.contains(n)) {
                    out.push(Retire::Device { vault: v.id, device: d });
                }
            }
        }
        out
    }

    /// The edits that retire `retires` (`retires`) on device `on`, drafted together for one ceremony of each owner key
    /// among them (`drafting`): the root first, handed on by itself and its next key, which signs too; then each owner
    /// key and each device removed by the vault's approval, by `by`, the owner key the person opened with, or its next
    /// key, with the root where `by`'s approval alone isn't the vault's. Each removal names every edit `on` holds that
    /// stands, so it cuts nothing `on` holds. `NotActing` if `on` belongs to no vault; otherwise why `on`'s view
    /// refuses a step.
    pub fn draft_retire(&self, on: SignerId, retires: &[Retire], by: SignerId) -> Result<Vec<Unsigned>, Refusal> {
        let vault = self.vault_of(on).ok_or(Refusal::NotActing)?;
        let mut drafting = self.drafting(on);
        let mut by = by;
        for retire in retires {
            let view = drafting.view();
            let root = view.vault(vault).and_then(|v| v.root);
            let mut signers = vec![by];
            signers.extend(root.filter(|&r| r != by && !view.approves(&[by], Principal::Vault(vault))));
            let action = match *retire {
                Retire::Root { old, new } => {
                    let hand_on = Setting::Root { root: Some(new), keep: vec![] };
                    drafting.draft(&[old, new], Action::Settings { vault, set: hand_on })?;
                    by = if by == old { new } else { by };
                    continue;
                }
                Retire::Owner(s) => Revoking::Owner { vault, owner: Principal::Signer(s), keep: vec![] },
                Retire::Device { vault: v, device } => Revoking::Device { vault: v, device, keep: vec![] },
            };
            drafting.draft(&signers, Action::Revoke(action))?;
        }
        // last, by the next key the root went to, the checkpoint over what earlier keys signed, in the same ceremony
        if self.keys_of(by).is_some_and(|k| k.suite() != Suite::SlhDsa) {
            self.draft_checkpoints(on, &mut drafting, by)?;
        }
        Ok(drafting.done())
    }

    /// Device `d`, its keys moved (`finish_move`), to open again as `new`, its next key or itself, on the same shelf as
    /// a node does (`avendb_net::Node::spawn`): a Lab of its own, with randomness of its own from `seed`, holding `new`
    /// with no edit yet, as `d` followed and read, and the keys this Lab holds of every owner and of `new` in the
    /// other suite, which it hands over; every signer's name, and the master recovery key it adds. The edits `d` holds
    /// stay here, for its node to put on the shelf as it closes, and the new node takes them from the shelf. `None`
    /// unless `d` is a device of the Lab and it holds `new`, `d` or a key of `d`'s in the other suite (`device_keys`).
    pub fn moved(&mut self, d: SignerId, new: SignerId, seed: [u8; 32]) -> Option<Lab> {
        let held = self.stores.get(&self.at(d))?;
        let (follow, query_depth, gate) = (held.follow.clone(), held.query_depth, held.gate);
        let store = Store { follow, query_depth, gate, ..Store::default() };
        let Some(SignerKeys::Device { ed25519, .. }) = self.keys.get(&new).map(Key::keys) else { return None };
        let mine = |k: &Key| match k.keys() {
            SignerKeys::Device { ed25519: e, .. } => e == ed25519,
            SignerKeys::Passkey { .. } | SignerKeys::Enclave { .. } => true,
        };
        let taken: Vec<SignerId> = self.keys.iter().filter(|(_, k)| mine(k)).map(|(s, _)| *s).collect();
        let keys = taken.into_iter().filter_map(|s| Some((s, self.keys.remove(&s)?))).collect();
        Some(self.split_off(keys, new, store, HashMap::new(), seed))
    }

    /// The master recovery key `key` (`recovery`): every human vault a device of this Lab founds from now on adds it as
    /// an owner, by its standing consent (`sign::standing`), and the Lab signs as it with that consent alone, on such an
    /// edit or one that adds it as an owner. A Lab that holds its secret (`passkey_from`) signs as it in full. Its id.
    pub fn set_recovery(&mut self, key: Arc<RecoveryKey>) -> SignerId {
        let id = key.id();
        self.keys.entry(id).or_insert_with(|| Key::Consent(key.clone()));
        self.names.entry(id).or_insert_with(|| "the master recovery key".into());
        self.recovery = Some(key);
        id
    }

    /// The master recovery key this Lab adds (`set_recovery`), if any.
    pub fn recovery(&self) -> Option<SignerId> {
        self.recovery.as_ref().map(|k| k.id())
    }

    /// Whether the signer whose keys are `keys` is a master recovery key: the one this Lab adds (`set_recovery`), or
    /// that key made from the same secret in the other suite, as it was before the key move (K4), by its P-256 key.
    pub fn is_recovery(&self, keys: &SignerKeys) -> bool {
        self.recovery.as_ref().is_some_and(|r| same_key(&r.keys, keys))
    }

    /// The first owners of a human vault the passkey `passkey` founds, its root, and the signers of its genesis: the
    /// passkey, and the master recovery key the Lab adds (`set_recovery`), if any, which signs by its standing consent.
    pub fn human_owners(&self, passkey: SignerId) -> (Vec<Principal>, Vec<SignerId>) {
        let signers: Vec<SignerId> = [passkey].into_iter().chain(self.recovery().filter(|&r| r != passkey)).collect();
        (signers.iter().map(|&s| Principal::Signer(s)).collect(), signers)
    }

    /// The public keys of signer `s`, if its key is at hand: a passkey's, or a device's while it is unlocked.
    pub fn keys_of(&self, s: SignerId) -> Option<SignerKeys> {
        self.keys.get(&s).map(Key::keys)
    }

    /// The public keys of each signer of `signers` that device `d` knows: at hand (`keys_of`), or else as a signature
    /// it holds brings them. A signer it never saw sign is left out.
    pub fn signers_seen(&self, d: SignerId, signers: &BTreeSet<SignerId>) -> BTreeMap<SignerId, SignerKeys> {
        let mut out: BTreeMap<SignerId, SignerKeys> =
            signers.iter().filter_map(|&s| Some((s, self.keys_of(s)?))).collect();
        if out.len() < signers.len() {
            for sig in self.held(d).signed.values().flat_map(|s| &s.sigs) {
                let s = sig.keys.id();
                if signers.contains(&s) && !out.contains_key(&s) {
                    out.insert(s, sig.keys.clone());
                    if out.len() == signers.len() {
                        break;
                    }
                }
            }
        }
        out
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
    /// device to a device vault `on`'s view holds, avenMAIA, the last of the seed `on`'s human vault founds
    /// (`world::SEED`), its key to seal to the one the server handed (`claim_key`). Every signer but the server signs
    /// it here, each by its ceremony among `ceremonies` or by its key at hand, and the claim brings the logs the server
    /// checks it by, and no others: the device vault's and its owners', up the chains (`sync::vault_logs`). The server
    /// signs last, and keeps it all (`accept_claim`). `NotClaiming` if `draft` adds no device to a device vault,
    /// `Locked` if a signer's key isn't at hand, `BadSignature` if a ceremony isn't its signer's over the draft's
    /// challenge.
    pub fn claim(
        &mut self,
        on: SignerId,
        draft: Unsigned,
        ceremonies: &[(SignerId, &Ceremony)],
    ) -> Result<Claim, Refusal> {
        let Unsigned { edit, batch, .. } = draft;
        let Action::Share(Sharing::Device { vault, device: server, .. }) = edit.action else {
            return Err(Refusal::NotClaiming);
        };
        if !self.held(on).view().vault(vault).is_some_and(|v| claimable(v.kind)) {
            return Err(Refusal::NotClaiming);
        }
        let id = edit.id();
        let signers: Vec<SignerId> = edit.sigs().filter(|&s| s != server).collect();
        let signature = |s| self.sign_by(s, id, ceremonies, &batch, None, &[]);
        let sigs = signers.into_iter().map(signature).collect::<Result<_, _>>()?;
        let store = self.held(on);
        let logs: Vec<EditId> = vault_logs(store.log.edits(), store.view(), vec![vault]).iter().map(Edit::id).collect();
        let (card, _) = self.outgoing(on, &logs);
        Ok(Claim { card, add: edit, sigs })
    }

    /// The aven or device vault device `server` belongs to by device `d`'s view: avenMAIA, once `d`'s person claimed the
    /// server (`claim`), or once `d` holds the server's card (`card`).
    pub fn server_vault_of(&self, d: SignerId, server: SignerId) -> Option<VaultId> {
        let st = self.held(d).view();
        let vault = st.vaults().iter().find(|v| claimable(v.kind) && v.devices.contains(&server))?;
        Some(vault.id)
    }

    /// The aven of a seed device `d`'s own vault founded that has no device yet, its server not added yet, by `d`'s view
    /// (`world::seeded`): the one a claim founded that the server didn't take, which a claim tried again adds the
    /// server to rather than found another seed.
    pub fn unclaimed_server(&self, d: SignerId) -> Option<VaultId> {
        let mine = self.vault_of(d)?;
        let st = self.held(d).view();
        let vault = st.vaults().iter().find(|v| v.devices.is_empty() && world::seeded(st, mine, v.id))?;
        Some(vault.id)
    }

    /// Device `d`'s next key (`next_key`), as it hands it to a device of its person's that moves it (the key move, K3c):
    /// a server or an agent of an aven, which belongs to the aven, not to its person's vault, so that their own move
    /// (`moves`) doesn't reach it, and whose next key the aven's owners add beside it, which `d` signs as too
    /// (`accept_claim`). `NotActing` if `d` belongs to no vault, `Locked` if its next key isn't at hand (`device_keys`)
    /// or it signs in that suite already, `AlreadyMember` once the next key is a device of `d`'s vault.
    pub fn move_key(&self, d: SignerId) -> Result<SignerId, Refusal> {
        let vault = self.vault_of(d).ok_or(Refusal::NotActing)?;
        let next = self.next_key(d).ok_or(Refusal::Locked)?;
        if self.state(d).is_device(next, vault) {
            return Err(Refusal::AlreadyMember);
        }
        Ok(next)
    }

    /// Device `d` takes a device's claim (`claim`): a server no vault has claimed yet, of it (P8f); or a device of an
    /// aven or a device vault, of its next key (`move_key`), as a device of its person's moves it (the key move, K3c).
    /// `d` signs the claim's edit too, as itself or as its next key, in its place among the edit's signers, and keeps
    /// it, with the vault logs the claim brings, only if every signature checks out and, with them, its view makes
    /// that key a device of a device vault, for a move the one `d` belongs to. So the first human vault to claim the
    /// server owns its device vault, through the coops of its seed, and the server acts for that vault but never
    /// governs it; and a move only adds the next key, beside `d`, which stays (`finish_move`). The join, for the
    /// claiming device to keep too: the edit, signed, and the McEliece key it names, `d`'s own. `AlreadyMember` as
    /// `claim_key` or `move_key` says; `NotClaiming` if the edit adds another device, seals to another key than `d`'s,
    /// or adds it to anything but a device vault, for a move to another vault than `d`'s; `BadSignature` if a
    /// signature doesn't verify, or one is missing or left over; otherwise why `d`'s view, with the logs the claim
    /// brings, refuses the edit.
    pub fn accept_claim(&mut self, d: SignerId, claim: Claim) -> Result<Join, Refusal> {
        // a server no vault claimed yet joins as itself, a device of a vault as its next key: one secret makes both,
        // with the same key to seal to
        let (signer, mine) = match self.vault_of(d) {
            None => (d, None),
            Some(v) => (self.move_key(d)?, Some(v)),
        };
        let key = match mine {
            None => self.claim_key(d)?,
            Some(_) => self.seal_public(signer).ok_or(Refusal::Locked)?.0,
        };
        let Claim { card, add, sigs } = claim;
        let Action::Share(Sharing::Device { vault, device, seal_to: Some(sealed) }) = &add.action else {
            return Err(Refusal::NotClaiming);
        };
        if *device != signer || *sealed != key || mine.is_some_and(|v| v != *vault) {
            return Err(Refusal::NotClaiming);
        }
        let vault = *vault;
        // the claim brings vault logs, and nothing else, each edit signed
        let vault_log = |s: &Signed| matches!(log_of(&s.edit, s.edit.id()), Some(LogId::Vault(_)));
        let card: Vec<Signed> = card.into_iter().filter(vault_log).collect();
        // each signed, or covered by a checkpoint it brings, held on its word where one that stands vouches for it
        let bare = covered(card.iter().map(|s| &s.edit));
        for signed in card.iter().filter(|s| !bare.contains(&s.edit.id())) {
            signed.verify()?;
        }
        // its own signature in its place among the edit's signers, the others' in theirs
        let own = self.sign_by(signer, add.id(), &[], &[], None, &[])?;
        let mut theirs = sigs.into_iter();
        let all: Option<Vec<Signature>> =
            add.sigs().map(|s| if s == signer { Some(own.clone()) } else { theirs.next() }).collect();
        let all = all.filter(|_| theirs.next().is_none()).ok_or(Refusal::BadSignature)?;
        let signed = Signed { edit: add, sigs: all };
        signed.verify()?;
        // with the logs it brings, its view accepts the edit, and makes the key a device of a device vault: a server no
        // vault claimed yet checks on a copy of the little it holds; a device of a vault may hold much, all of it on a
        // server, and takes the vault logs first, as its sync would bring them anyway
        let (view, card) = match mine {
            None => {
                let mut log = self.held(d).log.clone();
                log.receive(card.iter().map(|s| s.edit.clone()));
                log.trust(&bare);
                log.view().step(&signed.edit)?;
                log.receive([signed.edit.clone()]);
                (log.view(), card)
            }
            Some(_) => {
                self.deliver(d, card, &Blobs::new());
                (self.held(d).view().step(&signed.edit)?, vec![])
            }
        };
        if !view.vault(vault).is_some_and(|v| claimable(v.kind) && v.devices.contains(&signer)) {
            return Err(Refusal::NotClaiming);
        }
        let blobs: Blobs = self.seal_public(signer).map(|(_, blob)| (key.mceliece, blob)).into_iter().collect();
        let join = Join { edit: signed.clone(), blobs: blobs.values().map(|b| b.to_vec()).collect() };
        self.deliver(d, card.into_iter().chain([signed]).collect(), &blobs);
        Ok(join)
    }

    /// Device `on`'s claim (`claim`) of a session it hosts (`host`), an agent on its Mac that runs no device of its own,
    /// kept on `on`'s store as the agent signs it too: as `accept_claim` keeps a server's, with the session's signature
    /// asked of it (`Key::Remote`) and its McEliece key `mceliece`, the blob the claim's key to seal to names, which the
    /// agent handed as it connected. `NotClaiming` if the claim adds no session `on` hosts, or names another key to seal
    /// to, or its view doesn't make the session a device of the vault; `Locked` if the session didn't sign.
    pub fn accept_hosted(&mut self, on: SignerId, claim: Claim, mceliece: Arc<[u8]>) -> Result<VaultId, Refusal> {
        let Claim { add, sigs, .. } = claim;
        let Action::Share(Sharing::Device { vault, device, seal_to: Some(sealed) }) = &add.action else {
            return Err(Refusal::NotClaiming);
        };
        let (vault, device, sealed) = (*vault, *device, sealed.mceliece);
        if !self.hosted.get(&device).is_some_and(|h| h.host == on) || BlobId::of(&mceliece) != sealed {
            return Err(Refusal::NotClaiming);
        }
        // its own signature in its place among the edit's signers, the others' in theirs
        let own = self.sign_by(device, add.id(), &[], &[], None, &[])?;
        let mut theirs = sigs.into_iter();
        let all: Option<Vec<Signature>> =
            add.sigs().map(|s| if s == device { Some(own.clone()) } else { theirs.next() }).collect();
        let all = all.filter(|_| theirs.next().is_none()).ok_or(Refusal::BadSignature)?;
        let signed = Signed { edit: add, sigs: all };
        signed.verify()?;
        let view = self.held(on).view().step(&signed.edit)?;
        if !view.vault(vault).is_some_and(|v| claimable(v.kind) && v.devices.contains(&device)) {
            return Err(Refusal::NotClaiming);
        }
        let blobs: Blobs = [(sealed, mceliece)].into_iter().collect();
        self.deliver(on, vec![signed], &blobs);
        Ok(vault)
    }

    /// Signer `s`'s signature on edit `id`: by its ceremony among `ceremonies`, over the edit's id or, with the edits
    /// `batch` drafted together, over theirs (`Ceremony::sign_in`), or, with `pass`, the device an edit adds and when
    /// the pass was made, as the passkey's pass for that device (`Ceremony::sign_adding`), its keys taken in from that
    /// ceremony where the Lab doesn't hold them (`take_in`); or by its key at hand (`sign_held`). `Locked` if its key isn't
    /// at hand, `BadSignature` if its ceremony isn't its own over that challenge.
    #[allow(clippy::too_many_arguments)]
    fn sign_by(
        &mut self,
        s: SignerId,
        id: EditId,
        ceremonies: &[(SignerId, &Ceremony)],
        batch: &[EditId],
        pass: Option<(SignerId, u64)>,
        standing: &[SignerId],
    ) -> Result<Signature, Refusal> {
        match ceremonies.iter().find(|(c, _)| *c == s) {
            Some((_, c)) => {
                let keys = self.take_in(s, c).ok_or(Refusal::Locked)?;
                let signed = match pass {
                    Some((device, made)) => c.sign_adding(keys, id, device, made),
                    None => c.sign_in(keys, id, batch),
                };
                signed.ok_or(Refusal::BadSignature)
            }
            None => self.sign_held(s, id, standing),
        }
    }

    /// Signer `s`'s signature on edit `id` by its key at hand; or, for a signer the Lab holds the standing consent of
    /// alone (`Key::Consent`), that consent, if the edit takes it (`standing`, `sign::standing`). `Locked` if neither
    /// is at hand.
    fn sign_held(&mut self, s: SignerId, id: EditId, standing: &[SignerId]) -> Result<Signature, Refusal> {
        match self.keys.get_mut(&s).ok_or(Refusal::Locked)? {
            Key::Consent(k) if standing.contains(&s) => Ok(k.consent.clone()),
            key => key.sign(id).ok_or(Refusal::Locked),
        }
    }

    /// The secret device `d` derives the keys of the files it seals from (`sealed::Convergent`): from the current
    /// seed of the vault it belongs to, which every device of that vault holds and nobody outside it, so that each of
    /// them seals the same file to the same bytes, into any vault it acts for. None where it holds no such seed.
    pub fn convergence(&self, d: SignerId) -> Option<[u8; 32]> {
        let store = self.held(d);
        let vault = self.vault_of(d)?;
        let seed = store.keys.first(store.view().current(KeyFam::Seed(vault)))?;
        Some(seed.child("avendb file convergence", b"").bytes())
    }

    /// The vault device `d` belongs to, by its view.
    pub fn vault_of(&self, d: SignerId) -> Option<VaultId> {
        self.held(d).view().vaults().iter().find(|v| v.devices.contains(&d)).map(|v| v.id)
    }

    /// Device `d`, a server, takes a new vault from its peers only where it welcomes it, or again any (`gate::takes`):
    /// a human vault with the invite it claims, a coop or an aven an admin of the vault it serves owns. It serves the
    /// one owner of the device vault it belongs to, avenMAIA's Maia City (`home`); while it belongs to none, as before
    /// a claim, it takes any. What it held already, restored or not, stays; what it drafts itself, it takes.
    pub fn gate(&mut self, d: SignerId, on: bool) {
        self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab")).gate = on;
    }

    /// The vault gated device `d` serves (`gate`): the one owner, a vault, of the vault it belongs to. None where it
    /// isn't gated or belongs to no such vault.
    fn home(&self, d: SignerId) -> Option<VaultId> {
        let store = self.held(d);
        let vault = store.gate.then(|| self.vault_of(d)).flatten()?;
        match store.view().vault(vault)?.owners[..] {
            [Principal::Vault(home)] => Some(home),
            _ => None,
        }
    }

    /// Device `d`'s contact card: the signed edits of the logs of the vaults it acts for and of every vault that owns
    /// one of them, up the chains (`sync::vault_logs`), as a device needs them before it grants one of those vaults
    /// anything. The server hands out its own to whoever asks.
    pub fn card(&self, d: SignerId) -> Vec<Signed> {
        self.outgoing(d, &self.card_ids(d)).0
    }

    /// `card`'s edits.
    fn card_ids(&self, d: SignerId) -> Vec<EditId> {
        let store = self.held(d);
        let st = store.view();
        let vs = st.vaults().iter().map(|v| v.id).filter(|&v| st.acts_for(d, v)).collect();
        vault_logs(store.log.edits(), st, vs).iter().map(Edit::id).collect()
    }

    /// Lock device `d`: its keys, and every key and item they opened, leave its memory, each key wiped, and so do the
    /// device keys held beside the Lab's devices for the key move (`device_keys`). So does the secret half of each of
    /// their McEliece pairs that nothing else here holds (`keys::forget_pairs`): another signer's own key, a key
    /// another device holds, or a spare. Its edits and their ciphertext stay, and it still receives and passes on
    /// edits.
    pub fn lock(&mut self, d: SignerId) {
        let own = self.keys.remove(&d).and_then(|k| k.seal_secret()).map(|s| s.id());
        let mut gone: BTreeSet<KeyId> = own.into_iter().collect();
        // and the device keys held beside its devices for the key move (`device_keys`)
        let devices = &self.devices;
        let beside = self.keys.iter().filter(|(s, k)| matches!(k, Key::Device(_)) && !devices.contains(s));
        let beside: Vec<SignerId> = beside.map(|(s, _)| *s).collect();
        for s in beside {
            gone.extend(self.keys.remove(&s).and_then(|k| k.seal_secret()).map(|x| x.id()));
        }
        let store = self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
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
        let Some(key) = DeviceKey::of(secret, d) else { return false };
        if !self.stores.contains_key(&d) {
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
        let at = self.at(d);
        self.stores.get(&at).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"))
    }

    /// The device whose store `d` reads and writes: its host, for a session (`host`); else `d`.
    fn at(&self, d: SignerId) -> SignerId {
        self.hosted.get(&d).map_or(d, |h| h.host)
    }

    /// Device `host` hosts session `s`, an agent on its machine whose key `keys` is a device of a vault, with no store of
    /// its own (Samuel 2026-10-21, agents as sessions): what `s` writes is drafted on `host`'s one replay and signed by
    /// `s`'s holder by `sign`, as its author, and kept on `host`'s store, whose node passes it on; what `s` reads is what
    /// `host` shows, of the entries `s`'s own key opens alone (`sees`, spec `AvenDB.Sessions`). Nothing of `s` is kept:
    /// a session lives while its holder is connected.
    pub fn host(&mut self, host: SignerId, s: SignerId, keys: SignerKeys, sign: Remote) {
        assert!(self.stores.contains_key(&host), "{host:?} is no device of the Lab");
        assert!(!self.stores.contains_key(&s), "{s:?} is a device of the Lab with a store of its own");
        self.keys.insert(s, Key::Remote { keys, sign });
        self.hosted.insert(s, Hosted { host, opens: std::sync::Mutex::new(None) });
    }

    /// Session `s` (`host`) ends: its key is forgotten. What it wrote stays, as every device's writes.
    pub fn unhost(&mut self, s: SignerId) {
        if self.hosted.remove(&s).is_some() {
            self.keys.remove(&s);
        }
    }

    /// The sessions device `host` hosts.
    pub fn sessions(&self, host: SignerId) -> Vec<SignerId> {
        self.hosted.iter().filter(|(_, h)| h.host == host).map(|(s, _)| *s).collect()
    }

    /// Whether `d` reads entry `entry`: a device reads all it shows; a session (`host`) only what its own key opens in its
    /// host's view as well, the current key of the entry's audience and the entry's key (spec `AvenDB.sessionOpens`).
    pub fn sees(&self, d: SignerId, entry: EntryId) -> bool {
        let Some(h) = self.hosted.get(&d) else {
            return true;
        };
        let store = self.held(h.host);
        let st = store.view();
        let Some(en) = st.entry(entry) else {
            return false;
        };
        let opens = {
            let mut cached = h.opens.lock().expect("a session's keys");
            let held = store.log.ids().len();
            match &*cached {
                Some((at, opens)) if *at == held => opens.clone(),
                _ => {
                    let opens = Arc::new(st.opens(&[KeyName::Signer(d)]));
                    *cached = Some((held, opens.clone()));
                    opens
                }
            }
        };
        let audience = KeyFam::Audience(en.vault, en.audience());
        opens.contains(&st.current(audience)) && st.entry_key(entry).is_some_and(|k| opens.contains(&k))
    }

    fn unlocked(&self, d: SignerId) -> Result<(), Refusal> {
        if self.keys.contains_key(&d) { Ok(()) } else { Err(Refusal::Locked) }
    }

    /// The public key keys are sealed to for signer `s`, and the McEliece blob it names, if the Lab holds its key.
    fn seal_public(&self, s: SignerId) -> Option<(PublicKey, Arc<[u8]>)> {
        match self.keys.get(&s)? {
            Key::Remote { .. } => None,
            key => Some(key.seal_public()),
        }
    }

    /// Sign `edit` with the key of each of its signers; a signer the Lab holds the standing consent of alone by that
    /// consent, where the edit takes it (`sign_held`). `Locked` if a signer's key isn't at hand.
    fn sign(&mut self, edit: Edit) -> Result<Signed, Refusal> {
        let (id, standing) = (edit.id(), sign::standing(&edit));
        let mut sigs = vec![];
        for s in edit.sigs() {
            sigs.push(self.sign_held(s, id, &standing)?);
        }
        Ok(Signed { edit, sigs })
    }

    /// Device `to` keeps signed edits, and the blobs among `blobs` they name: each edit once, and only if every
    /// signature checks out. Whether the edits stand is for its replay to say; a blob is checked against its id before
    /// anything is sealed with it (`key_box`). True if any edit was new.
    fn keep(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs) -> bool {
        let fresh = self.checked(to, edits);
        self.keep_fresh(to, fresh, blobs)
    }

    /// `fresh`, timed on device `to` (`perf`).
    fn checked(&mut self, to: SignerId, edits: Vec<Signed>) -> Vec<Signed> {
        let (at, offered) = (Perf::start(), edits.len() as u64);
        let fresh = self.fresh(to, edits, &HashSet::new());
        if let Some(store) = self.stores.get_mut(&self.at(to)) {
            store.perf.add("check", at);
            store.perf.count("edits offered", offered);
            store.perf.count("edits checked", fresh.len() as u64);
        }
        fresh
    }

    /// `keep`, of edits from a peer: where `to` is a gated server (`gate`), only what its gate takes of the new edits
    /// whose signatures check out (`gate::takes`), the vault it serves its device vault's one owner; nothing of them if
    /// it takes nothing.
    fn take(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs) -> bool {
        let mut fresh = self.checked(to, edits);
        if let Some(home) = self.home(to).filter(|_| !fresh.is_empty()) {
            let store = self.held(to);
            let batch = fresh.iter().map(|s| s.edit.clone()).collect();
            let taken = gate::takes(home, store.log.edits(), self.latest(to), batch, &store.readings);
            let ids: HashSet<EditId> = taken.unwrap_or_default().iter().map(Edit::id).collect();
            fresh.retain(|s| ids.contains(&s.edit.id()));
        }
        self.keep_fresh(to, fresh, blobs)
    }

    /// Of `edits`, those device `to` doesn't hold yet whose signatures check out, each once: an edit it holds was
    /// checked when it arrived, and a copy with other signatures adds nothing. An edit a checkpoint it holds or one
    /// among `edits` covers comes unchecked, on that checkpoint's word, its signatures or none: its replay lets go of
    /// it unless one that stands vouches for it (`refresh`).
    fn fresh(&self, to: SignerId, edits: Vec<Signed>, vouched: &HashSet<EditId>) -> Vec<Signed> {
        let Some(store) = self.stores.get(&self.at(to)) else { return vec![] };
        let mut seen = HashSet::new();
        let new = |s: &Signed| {
            let id = s.edit.id();
            !store.signed.contains_key(&id) && seen.insert(id)
        };
        let new: Vec<Signed> = edits.into_iter().filter(new).collect();
        let batch = covered(new.iter().map(|s| &s.edit));
        let on_word = |s: &Signed| {
            let id = s.edit.id();
            store.covers.contains(&id) || batch.contains(&id)
        };
        let (bare, rest): (Vec<Signed>, Vec<Signed>) = new.into_iter().partition(on_word);
        // those checked when the device kept them, and sealed by it since, aren't checked again
        let (sealed, unsealed): (Vec<usize>, Vec<usize>) =
            (0..rest.len()).partition(|&i| vouched.contains(&rest[i].edit.id()));
        let mut ok = vec![false; rest.len()];
        sealed.into_iter().for_each(|i| ok[i] = true);
        let to_check: Vec<Signed> = unsealed.iter().map(|&i| rest[i].clone()).collect();
        for (i, fine) in unsealed.into_iter().zip(checked_all(&to_check)) {
            ok[i] = fine;
        }
        bare.into_iter().chain(rest.into_iter().zip(ok).filter_map(|(s, ok)| ok.then_some(s))).collect()
    }

    /// Device `to` keeps `fresh`, new edits whose signatures checked out (`fresh`), and the blobs among `blobs` they
    /// name. True if there were any.
    fn keep_fresh(&mut self, to: SignerId, fresh: Vec<Signed>, blobs: &Blobs) -> bool {
        let Some(store) = self.stores.get_mut(&self.at(to)) else { return false };
        let at = Perf::start();
        // its own write, one, drafted on everything it holds: what its edits say now is what they said, that write
        // stepped on, with no replay (`latest`)
        let stepped = match &fresh[..] {
            [one] => store.latest.get().and_then(|was| stepped_on(was, store.log.edits(), to, &one.edit)),
            _ => None,
        };
        let mut new = false;
        // what the checkpoints among them cover first: an edit `fresh` took on their word is held bare, and so is one it
        // held already, signed, that they cover
        let more = covered(fresh.iter().map(|s| &s.edit));
        store.bare.extend(more.iter().filter(|id| store.signed.contains_key(id)));
        store.covers.extend(more);
        for signed in fresh {
            let id = signed.edit.id();
            if store.covers.contains(&id) {
                store.bare.insert(id);
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
            store.latest = OnceLock::new();
            if let Some(state) = stepped {
                debug_assert!(state == store.log.view(), "a write stepped on differs from the replay");
                let _ = store.latest.set(state);
            }
            store.perf.add("keep", at);
        }
        new
    }

    /// Device `to` receives signed edits and their blobs, and brings its keys and items up to date if any edit was new.
    fn deliver(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs) {
        if self.take(to, edits, blobs) {
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
    /// vault's log before it accepts a share to that vault.
    pub fn share_contact(&mut self, from: SignerId, to: SignerId, v: VaultId) {
        let store = self.held(from);
        let ids: Vec<EditId> = vault_logs(store.log.edits(), store.view(), vec![v]).iter().map(Edit::id).collect();
        let (signed, blobs) = self.outgoing(from, &ids);
        self.deliver(to, signed, &blobs);
    }

    /// Device `from` hands invite `share` to device `to` (`invite_card`), as the server hands it to a newcomer's device
    /// that names it.
    pub fn hand_invite(&mut self, from: SignerId, to: SignerId, share: ShareId) -> Result<(), Refusal> {
        let ids = self.invite_ids(from, share)?;
        let (signed, blobs) = self.outgoing(from, &ids);
        self.deliver(to, signed, &blobs);
        Ok(())
    }

    /// What device `d` hands a newcomer's device for invite `share`, a share to an invite key that no vault claimed
    /// yet: the share and the shares it rests on, with the logs of the vaults they name, each signed. What a newcomer's
    /// device needs to claim it (`claim_invite`), and no peer passes on to anyone else before a vault claims it
    /// (`sync::Reach`): so the server hands it to whoever names the invite, as only its link names it, and nothing once
    /// it is claimed. `UnknownCap` if `d` knows no such share, `NotInvite` if it goes to no invite key, as one claimed
    /// already, `Revoked` if it was revoked.
    pub fn invite_card(&self, d: SignerId, share: ShareId) -> Result<Vec<Signed>, Refusal> {
        Ok(self.outgoing(d, &self.invite_ids(d, share)?).0)
    }

    /// `invite_card`'s edits.
    fn invite_ids(&self, d: SignerId, share: ShareId) -> Result<Vec<EditId>, Refusal> {
        let store = self.held(d);
        let st = store.view();
        let cp = st.share(share).ok_or(Refusal::UnknownCap)?;
        if !matches!(cp.share.who, Who::Invite(_)) {
            return Err(Refusal::NotInvite);
        }
        if !st.live(share) {
            return Err(Refusal::Revoked);
        }
        let named = |c: &ShareId| st.share(*c).map(|x| [x.share.over, x.share.issuer]);
        let vaults: Vec<VaultId> = cp.chain.iter().filter_map(named).flatten().collect();
        let logs = vault_logs(store.log.edits(), st, vaults);
        Ok(logs.iter().map(Edit::id).chain(cp.chain.iter().map(|c| EditId(c.0))).collect())
    }

    /// What a newcomer's device `d` hands the server at sign-up: its card (`card`), the logs of its vault, and the
    /// claims of invites its vaults made (`claim_invite`), each signed. A gated server takes a new human vault only
    /// with the invite it claims (`gate`), and the claim is in the invite's own log, which the newcomer's device
    /// doesn't see the server reach: so it hands both at once, and the server takes them as one batch (`avendb_net`'s
    /// sign-up session).
    pub fn sign_up_card(&self, d: SignerId) -> Vec<Signed> {
        self.outgoing(d, &self.sign_up_ids(d)).0
    }

    fn sign_up_ids(&self, d: SignerId) -> Vec<EditId> {
        let store = self.held(d);
        let st = store.view();
        let mine = |e: &&Edit| matches!(e.action, Action::Claim { vault, .. } if st.acts_for(d, vault));
        let claims = store.log.edits().iter().filter(mine);
        self.card_ids(d).into_iter().chain(claims.map(Edit::id)).collect()
    }

    /// Device `from`, a newcomer's, hands device `to`, the server, its sign-up card (`sign_up_card`), which `to` takes
    /// as edits from a peer.
    pub fn sign_up(&mut self, from: SignerId, to: SignerId) {
        let (signed, blobs) = self.outgoing(from, &self.sign_up_ids(from));
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
        let store = self.held(on);
        let log = &store.log;
        // checked on the replay it keeps where that is of every edit it holds, as it is but within `together`; a dry
        // run tries no removal's cuts, which only name the edit
        let edit = match store.replayed == log.edits().len() {
            true => {
                debug_assert!(store.replay == log.replay(), "the replay kept differs from the log's");
                log.check_on(&store.replay, !self.dry, author, cosigners, action)?
            }
            false => log.check(author, cosigners, action)?,
        };
        Ok(Unsigned { edit, blobs, held: log.ids().len(), batch: vec![], pass: None })
    }

    /// Edits to draft on device `on` one after another, each on top of those before it, for the passkeys among their
    /// signers to sign all of them in one ceremony (`Drafting`, `sign::batch_challenge`): what a browser asks its
    /// person once for, where it would otherwise ask once for each edit.
    pub fn drafting(&self, on: SignerId) -> Drafting<'_> {
        let store = self.held(on);
        let replay = match store.replayed == store.log.edits().len() {
            true => Cow::Borrowed(&store.replay),
            false => Cow::Owned(store.log.replay_memo(store.replay.memo.as_ref())),
        };
        Drafting { lab: self, log: store.log.clone(), replay, drafts: vec![] }
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
            self.held(on).view().accepts(&edit, edit.id())?;
        }
        // in a dry run, checked and then not made (`dry`)
        if self.dry {
            return Ok(edit.id());
        }
        let (id, standing) = (edit.id(), sign::standing(&edit));
        let ceremony = |s: SignerId| ceremonies.iter().find(|(c, _)| *c == s).map(|(_, c)| *c);
        let signers: Vec<SignerId> = edit.sigs().collect();
        let pass = match (&edit.action, pass) {
            (Action::Share(Sharing::Device { device, .. }), Some(made)) => Some((*device, made)),
            (_, Some(_)) => return Err(Refusal::BadSignature),
            (_, None) => None,
        };
        // the pass signs for the passkey alone: every other signer as ever
        let signature = |s: SignerId| {
            let by_pass = pass.filter(|_| matches!(self.keys_of(s), Some(SignerKeys::Passkey { .. })));
            self.sign_by(s, id, ceremonies, &batch, by_pass, &standing)
        };
        let sigs = signers.into_iter().map(signature).collect::<Result<_, _>>()?;
        let signed = Signed { edit, sigs };
        debug_assert!(signed.verify().is_ok());
        // an owner key authoring on this device lends it, for this ceremony, what is sealed to it
        let author = signed.edit.author;
        let lent: Vec<(SignerId, Secret)> = match (ceremony(author), self.keys.get(&author)) {
            (Some(c), _) => vec![(author, c.seal_secret())],
            (None, Some(key)) if !self.devices.contains(&author) && !matches!(key, Key::Device(_)) => {
                key.seal_secret().map(|s| (author, s)).into_iter().collect()
            }
            _ => vec![],
        };
        self.keep(on, vec![signed], &blobs);
        self.refresh(on, &lent);
        Ok(id)
    }

    /// Device `on`'s part of `draft` (`draft`): its edit signed by its first `signers` signers alone, each by its
    /// ceremony among `ceremonies` or by its key at hand, for a device of the others to sign and keep (`finish`). So
    /// two people sign one edit one after the other, as an owner add a person's vault consents to and a coop's owners
    /// approve: the first signs here, and the part goes to the other in a record (`engine`'s `share` with a request).
    /// Nothing is kept. `on`'s view checks the edit again if edits arrived since the draft; `Locked` if a signer's key
    /// isn't at hand, `BadSignature` if a ceremony isn't its signer's over the draft's challenge.
    pub fn part(
        &mut self,
        on: SignerId,
        draft: Unsigned,
        signers: usize,
        ceremonies: &[(SignerId, &Ceremony)],
    ) -> Result<Signed, Refusal> {
        let Unsigned { edit, held, batch, .. } = draft;
        if self.held(on).log.ids().len() != held {
            self.held(on).view().accepts(&edit, edit.id())?;
        }
        let (id, standing) = (edit.id(), sign::standing(&edit));
        let first: Vec<SignerId> = edit.sigs().take(signers).collect();
        let signature = |s| self.sign_by(s, id, ceremonies, &batch, None, &standing);
        let sigs = first.into_iter().map(signature).collect::<Result<_, _>>()?;
        Ok(Signed { edit, sigs })
    }

    /// Part `part`'s edit (`part`) drafted on device `on`, for the passkeys of the signers it lacks to sign in their
    /// ceremonies, over the edit's id: what `finish` keeps.
    pub fn parted(&self, on: SignerId, part: &Signed) -> Unsigned {
        let held = self.held(on).log.ids().len();
        Unsigned { edit: part.edit.clone(), blobs: Blobs::new(), held, batch: vec![], pass: None }
    }

    /// Part `part` (`part`) finished on device `on` and kept: each signer it lacks signs in its place after those that
    /// signed, by its ceremony among `ceremonies` or by its key at hand, and `on` keeps the edit if every signature
    /// verifies and `on`'s view accepts it; in a dry run, checked and then not made. `BadSignature` if a signature
    /// doesn't verify, `Locked` if a signer's key isn't at hand.
    pub fn finish(
        &mut self,
        on: SignerId,
        part: Signed,
        ceremonies: &[(SignerId, &Ceremony)],
    ) -> Result<EditId, Refusal> {
        let Signed { edit, mut sigs } = part;
        self.held(on).view().accepts(&edit, edit.id())?;
        if self.dry {
            return Ok(edit.id());
        }
        let (id, standing) = (edit.id(), sign::standing(&edit));
        let rest: Vec<SignerId> = edit.sigs().skip(sigs.len()).collect();
        for s in rest {
            sigs.push(self.sign_by(s, id, ceremonies, &[], None, &standing)?);
        }
        let signed = Signed { edit, sigs };
        signed.verify()?;
        self.keep(on, vec![signed], &Blobs::new());
        self.refresh(on, &[]);
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
            Action::Share(Sharing::Owner { owner: Principal::Signer(s), seal_to: to @ None, .. }) => *to = public(*s),
            Action::Share(Sharing::Device { device, seal_to: to @ None, .. }) => *to = public(*device),
            _ => {}
        }
        blobs
    }

    /// Issue a share on device `on`, signed by `signers`, if `on`'s view accepts it: its id. An owner share is
    /// governance, so the issuer's root, or its threshold of owners, signs too. Its selector is sealed
    /// (`slice::Select`). `UnknownKey` if `on` can't seal it to the vault the share is over, or to its grantee, as it
    /// holds no seed of theirs nor its announced public half.
    pub fn issue(&mut self, on: SignerId, signers: &[SignerId], share: NewShare) -> Result<ShareId, Refusal> {
        let draft = self.draft_share(on, signers, share)?;
        self.complete(on, draft, &[]).map(ShareId::from)
    }

    /// The share `issue` issues, drafted for the passkeys among its signers to sign in their ceremonies (`draft`). It
    /// carries its ops in order (`rules::normalize`) and the grants of the shares it rests on, which its issuer reads
    /// in the slice of the share it rests on: so its grantee can prove its writes (`rules::Proof`). `BadCap` for a
    /// share of no name, no op, too many or a selector beyond the bounds a peer accepts, or resting on a chain too long
    /// to prove; `NotAllowed` if `on` doesn't read the slice of the share it rests on. A keep share carries no op:
    /// `BadCap` for one that has some.
    pub fn draft_share(&mut self, on: SignerId, signers: &[SignerId], new: NewShare) -> Result<Unsigned, Refusal> {
        self.unlocked(on)?;
        let NewShare { over, who, name, select, ops, parent, issuer, keep } = new;
        let ops = match keep {
            Some(_) if !ops.is_empty() => return Err(Refusal::BadCap),
            Some(_) => ops,
            None => rules::normalize(ops).map_err(|_| Refusal::BadCap)?,
        };
        let level = keep.map_or_else(|| rules::level_of(&ops), Level::Keep);
        let new = NewShare { over, who, name, select, ops, parent, issuer, keep };
        self.draft_slice(on, signers, new, level, None)
    }

    /// Issue a share of one of its vault's cap groups on device `on`, signed by `signers` (`draft_group_share`): its
    /// id.
    pub fn issue_group(&mut self, on: SignerId, signers: &[SignerId], share: GroupShare) -> Result<ShareId, Refusal> {
        let draft = self.draft_group_share(on, signers, share)?;
        self.complete(on, draft, &[]).map(ShareId::from)
    }

    /// A share of cap group `group` of the vault it is over, drafted as `draft_share` drafts one: it grants no op of
    /// its own, but the ops of the caps of the group in force wherever a write through it is judged, and of the groups
    /// it includes, that its level bounds, on what they pick (`policy::State::lets`); so a new version of the group
    /// narrows or widens it at once, and revoking it ends it alone. Its selector, `Selector::All` for all of the vault,
    /// bounds what the caps pick. A share to an invite key holds its selector in the clear, as nobody it could be
    /// sealed to holds the key yet (`seal_select`). `BadCap` for a keep level.
    pub fn draft_group_share(
        &mut self,
        on: SignerId,
        signers: &[SignerId],
        share: GroupShare,
    ) -> Result<Unsigned, Refusal> {
        self.unlocked(on)?;
        let GroupShare { over, who, name, select, group, level, parent, issuer } = share;
        if level.is_keep() {
            return Err(Refusal::BadCap);
        }
        // never wide, which picks everything whatever the group's caps say: on all of the vault, it picks every entry,
        // and the caps what of each it grants
        let select = match select {
            Selector::All => Selector::AnyOf(vec![vec![]]),
            s => s,
        };
        let new = NewShare { over, who, name, select, ops: vec![], parent, issuer, keep: None };
        self.draft_slice(on, signers, new, level, Some(group))
    }

    /// The share `new` describes at level `level`, granting its ops, or naming cap group `group`, drafted
    /// (`draft_share`).
    fn draft_slice(
        &mut self,
        on: SignerId,
        signers: &[SignerId],
        new: NewShare,
        level: Level,
        group: Option<EntryId>,
    ) -> Result<Unsigned, Refusal> {
        let NewShare { over, who, name, select, ops, parent, issuer, .. } = new;
        if rules::name_ok(&name).is_err() || !select.bounded() {
            return Err(Refusal::BadCap);
        }
        let above = match parent {
            Some(p) => self.held(on).slices.get(&p).map(Slice::grants).ok_or(Refusal::NotAllowed)?,
            None => vec![],
        };
        if above.len() >= rules::MAX_GRANTS {
            return Err(Refusal::BadCap);
        }
        let mut salt = [0u8; 32];
        self.rng.fill_bytes(&mut salt);
        let slice = Slice { name, select, grant: Grant { ops, salt }, above };
        let wide = slice.select == Selector::All;
        let nonce = self.rng.next_u64();
        let mut share = Share { over, who, level, wide, select: vec![], parent, issuer, nonce, group };
        share.select = self.seal_select(on, &share, &slice)?;
        self.draft(on, signers, Action::Share(Sharing::Grant(share, vec![])))
    }

    /// The `select` of `share`, holding `slice`: in the clear for a share to everyone or to an invite key, whose
    /// holder has no vault to seal it to until it claims the share, and whose grantee its claim changes, so that a
    /// sealed selector, bound to the share (`encode::share_context`), would never open again; else sealed under a key
    /// of its own, which is boxed to the seed of each vault that reads it: the vault the share is over, its grantee
    /// unless the share only relays, and its issuer where `on` holds or knows the issuer's seed (`slice::Select`). A
    /// keep share's grantee is a device, which reads it through its issuer; the stewards of the vault it is over read
    /// it to mark what it picks, and a wide one they never mark by.
    fn seal_select(&mut self, on: SignerId, share: &Share, slice: &Slice) -> Result<Vec<u8>, Refusal> {
        if matches!(share.who, Who::Everyone | Who::Invite(_)) {
            return Ok(Select::Clear(slice.clone()).to_wire());
        }
        let who = match share.who {
            Who::Vault(g) if share.level.allows(Level::Read) => Some(g),
            _ => None,
        };
        let readers: Vec<VaultId> = [Some(share.over), who, Some(share.issuer)].into_iter().flatten().collect();
        let needed: Vec<VaultId> = if share.level.is_keep() && share.wide {
            vec![]
        } else {
            [Some(share.over), who].into_iter().flatten().collect()
        };
        self.seal_slice(on, share, slice, &readers, &needed)
    }

    /// `slice`, the slice of share `of`'s selector, sealed under a key of its own, which is boxed to the seed of each
    /// vault of `readers` that `on` holds or knows the seed of (`slice::Select`). `UnknownKey` if it can't box it for
    /// one of `needed`.
    fn seal_slice(
        &mut self,
        on: SignerId,
        of: &Share,
        slice: &Slice,
        readers: &[VaultId],
        needed: &[VaultId],
    ) -> Result<Vec<u8>, Refusal> {
        let mut seen = HashSet::new();
        let readers = readers.iter().copied().filter(|v| seen.insert(*v));
        let at = self.at(on);
        let Lab { stores, rng, .. } = self;
        let store = stores.get(&at).unwrap_or_else(|| panic!("{on:?} is no device of the Lab"));
        let (st, ix) = (store.view(), KeyIndex::of(&store.replay));
        let key = Secret::generate(rng);
        let sealed = keys::seal_edit(&key, &slice.to_wire(), &share_context(of), rng);
        let bound = |to: &Recipient| share_select_info(of, key.id(), to);
        let mut boxes = vec![];
        for v in readers {
            match key_box(&key, st.current(KeyFam::Seed(v)), &bound, st, store, &ix, &[], rng) {
                Some(b) => boxes.push(b),
                None if needed.contains(&v) => return Err(Refusal::UnknownKey),
                None => {}
            }
        }
        Ok(Select::Sealed { boxes, slice: sealed, commitment: slice.grant.commitment() }.to_wire())
    }

    /// Bring device `d`'s keys, audiences and items up to date with its edits, `lent` holding the keys of owners
    /// signing on it right now. Each round replays its edits, opens and derives what it can, reads what that opens, and
    /// makes the edits its upkeep calls for (`upkeep`). A locked device only replays.
    fn refresh(&mut self, d: SignerId, lent: &[(SignerId, Secret)]) {
        // a session's store is its host's, which opens what it holds with its own keys
        let d = self.at(d);
        if let Some(store) = self.stores.get_mut(&self.at(d)) {
            store.behind = false;
        }
        let own = self.keys.get(&d).and_then(Key::seal_secret);
        let unlocked = own.is_some();
        let mine: Vec<(SignerId, Secret)> = own.map(|o| (d, o)).into_iter().chain(lent.iter().cloned()).collect();
        let began = Perf::start();
        for round in 0.. {
            let Lab { stores, rng, spares, .. } = self;
            let Some(store) = stores.get_mut(&d) else { return };
            store.perf.count("refresh rounds", 1);
            let at = Perf::start();
            // a removal may take writes from the middle of an entry's: what it shows is checked against them all
            let fresh = store.log.edits().get(store.replayed..).unwrap_or_default();
            store.reshow |= store.replayed == 0 || fresh.iter().any(Edit::is_removal);
            let was = std::mem::replace(&mut store.replay, replay(&[]));
            let memo = was.memo.clone().filter(|m| m.upto > 0);
            let (replayed, why) = replay_on_why(was, store.log.edits(), store.replayed);
            // a replay of every edit whose resolve chose as before took that choice, and tried no removal again
            if matches!(why, Why::Whole(_)) && memo.is_some() && replayed.memo == memo {
                store.perf.count("replay: removals as chosen before", 1);
            }
            store.replay = replayed;
            store.perf.count(why_counted(why), 1);
            store.replayed = store.log.edits().len();
            debug_assert!(store.replay == replay(store.log.edits()), "a replay stepped on differs from the whole");
            store.latest = OnceLock::from(store.replay.state.clone());
            store.perf.add("replay", at);
            // the edits it holds on a checkpoint's word: those one that stands vouches for lose their signatures, the
            // rest keep theirs where they check out, and it lets go of the others and replays again (`trusted`)
            if !store.bare.is_empty() && trust(store) {
                continue;
            }
            // a locked device holds no key, and opens nothing
            if !unlocked {
                store.perf.add("refresh", began);
                return;
            }
            let at = Perf::start();
            let ix = KeyIndex::of(&store.replay);
            open_keys(store, &ix, &mine);
            store.perf.add("open keys", at);
            let at = Perf::start();
            read(d, store);
            store.perf.add("read", at);
            // what it shows, every write counted or not, before its upkeep: its stewards grant counted asks alone
            let at = Perf::start();
            show_items(d, store);
            store.perf.add("show items", at);
            let at = Perf::start();
            let work = upkeep(d, store, &ix, &mine, rng, spares);
            store.perf.add("upkeep", at);
            if work.is_empty() {
                store.perf.add("refresh", began);
                return;
            }
            assert!(round < ROUNDS, "{d:?} keeps making edits its own view refuses: {work:?}");
            // what its edits say, every write counted: what it drafts on, its replay of this round
            let view = store.replay.state.clone();
            for w in work {
                self.work(d, &view, w);
            }
        }
    }

    /// Sign and keep on device `d` an edit its upkeep calls for, drafted on `view`, what `d`'s edits say.
    fn work(&mut self, d: SignerId, view: &State, w: Work) {
        let edit = match w {
            Work::Edit(action) => self.held(d).log.draft_on(view, d, &[], action),
            Work::Retag { vault, entry, body } => {
                let en = view.entry(entry).expect("an entry of the view");
                let (stay, x) = (en.stay(), en.audience());
                let epoch = view.epoch(KeyFam::Audience(vault, x));
                let action = Action::Write {
                    vault,
                    entry,
                    actor: vault,
                    stay,
                    epoch,
                    deps: vec![],
                    proposal: Proposal::Main,
                    via: vec![],
                    create: None,
                    files: vec![],
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

    /// What device `d`'s edits say now, those it kept since it last brought itself up to date too: what it drafts and
    /// checks its own edits by.
    fn latest(&self, d: SignerId) -> &State {
        let store = self.held(d);
        store.latest.get_or_init(|| store.log.view())
    }

    /// The write `action` authored by device `on` alone, drafted on `view`, what `on`'s edits say, if `view` accepts
    /// it: the edit, and the write it is, with the shares its readers judge it by.
    fn check_write(&self, on: SignerId, view: &State, action: Action) -> Result<(Edit, Write), Refusal> {
        let edit = self.held(on).log.draft_on(view, on, &[], action);
        let w = view.accepted_write(&edit, edit.id())?.expect("a write");
        Ok((edit, w))
    }

    /// The proof write `w` of device `on` carries, which touches `touches` and asks for the tags `asks`, of an entry
    /// with the attributes `attrs` before it (`rules::Proof`): none where it acts for its entry's vault, so relies on
    /// no share, else one for the first share it relies on whose chain's ops, as `on` reads them and the cap groups
    /// in force, allow every touch and every tag it asks for. `NotAllowed` if none does, or `on` can't read what the
    /// write touches.
    fn prove(
        &self,
        on: SignerId,
        view: &State,
        w: &Write,
        (touches, asks): (Option<&[Touch]>, &TagDelta),
        attrs: Option<&Attrs>,
    ) -> Result<Option<Proof>, Refusal> {
        if self.lawless || w.shares.is_empty() {
            return Ok(None);
        }
        let store = self.held(on);
        let at = At { attrs, place: view.place(w.edit), groups: &store.readings.groups };
        let proofs = w.shares.iter().filter_map(|c| Some(Proof { share: *c, grants: store.slices.get(c)?.grants() }));
        let mut proofs = proofs.filter(|p| view.lets(w, Some(p), touches, asks, at));
        proofs.next().map(Some).ok_or(Refusal::NotAllowed)
    }

    /// The proof write `w` of device `on` carries (`prove`), with what it touches as its readers will read it off
    /// `content` on the history `h` holds before it, of an entry of vault `vault` (`History::reading`), and the tags it
    /// asks for, `asks`. `NotAView` if
    /// it doesn't fit the schemas the entry was written under, of the vault's lane and the built-in ones, and
    /// `NotAccepted` if it merges into main through a share on top of no accept of the vault's (`History::passes`, M2),
    /// and `NotLanded`, before anything else, if it writes on main through a share of a draft its vault hasn't landed
    /// (`History::lands`), unless the device is a patched app's (`patched`). The proof lets the touches `needs`
    /// through too, which its readers don't read off it, as a write that brings files into an entry needs to set its
    /// whole record (`bring_into`). A creation's entry has the attributes `first`; any other write's, those `on`
    /// reads off its entry (`policy::State::at_write`).
    #[allow(clippy::too_many_arguments)]
    fn proven(
        &self,
        on: SignerId,
        view: &State,
        (vault, h): (VaultId, &History),
        w: &Write,
        (content, asks): (&[u8], &TagDelta),
        needs: &[Touch],
        first: Option<&Attrs>,
    ) -> Result<Option<Proof>, Refusal> {
        if !(h.lands(w) || self.lawless) {
            return Err(Refusal::NotLanded);
        }
        let readings = &self.held(on).readings;
        let lane = Lane::with_built_ins(view.lane_of(vault, readings));
        // on a copy of the scratch item its showing left, where it holds the version the write builds on
        let shown = self.held(on).shown.get(&w.entry).filter(|_| !w.first);
        let mut at = shown.and_then(|s| s.after.scratch.as_ref()).map(Scratch::fork);
        let read = h.reading_on(&mut at, w, Some(content), on, &lane);
        // each set marked own or not as its readers will mark it, by whose each row is (`policy::Mine`)
        let touches = read.touches.as_deref().map(|ts| h.mine().mark(w.actor, &[ts, needs].concat()));
        let attrs = if w.first { first.cloned() } else { view.at_write(w, readings).0 };
        let proof = self.prove(on, view, w, (touches.as_deref(), asks), attrs.as_ref())?;
        if !(read.fits || self.lawless) {
            return Err(Refusal::NotAView);
        }
        if !(h.passes(w, read.touches.as_deref()) || self.lawless) {
            return Err(Refusal::NotAccepted);
        }
        Ok(proof)
    }

    /// Run `f` dry: every edit it asks for, a write, a share, any edit it completes (`complete`), is checked, proven
    /// and refused as ever, and then not made (`may`).
    pub fn dry<T>(&mut self, f: impl FnOnce(&mut Lab) -> T) -> T {
        let was = std::mem::replace(&mut self.dry, true);
        let out = f(self);
        self.dry = was;
        out
    }

    /// Run `f` with each device's catching up after its writes (`refresh`) held back until `f` ends, then done once:
    /// for an op that makes several writes none of which reads what another made, as an AIP's review accepting each
    /// of its lines in turn, the whole log replayed once instead of once a write. Within `f` a device's histories and
    /// items are as before its first write; what it checks a write by (`latest`) has every write it kept.
    pub fn together<T>(&mut self, f: impl FnOnce(&mut Lab) -> T) -> T {
        if self.held_back.is_some() {
            return f(self);
        }
        self.held_back = Some(BTreeSet::new());
        let out = f(self);
        for d in self.held_back.take().unwrap_or_default() {
            self.refresh(d, &[]);
        }
        out
    }

    /// Whether it runs dry (`dry`): what isn't an edit, as the bytes of a file or the vaults a device follows, it
    /// leaves as they are too.
    pub fn is_dry(&self) -> bool {
        self.dry
    }

    /// Run `f` as devices of a patched app, which ignore the ops of the shares they write through and the schemas of
    /// what they write: their writes carry no proof and are made all the same, whether they fit or not, and no reader
    /// of their entries counts those that break either, the writer's own device neither, nor anything built on them
    /// (`History::reading`, `State::uncounted`).
    pub fn patched<T>(&mut self, f: impl FnOnce(&mut Lab) -> T) -> T {
        let was = std::mem::replace(&mut self.lawless, true);
        let out = f(self);
        self.lawless = was;
        out
    }

    /// The id of a new entry of vault `vault` that device `on` creates, and the nonce of 32 random bytes it is the
    /// hash of (`EntryId::of`).
    fn new_entry_id(&mut self, on: SignerId, vault: VaultId) -> (EntryId, [u8; 32]) {
        let mut nonce = [0u8; 32];
        self.rng.fill_bytes(&mut nonce);
        (EntryId::of(vault, on, &nonce), nonce)
    }

    /// Create an entry of vault `vault` of type `ty` with tags `tags` holding `item`, on device `on`, acting for
    /// `actor`: its first encrypted write. A steward puts it in its audience, once it reads the selectors of every
    /// share of the vault, and in the vault's own audience before (a steward moves it); anyone else in the intake
    /// audience of a share it holds with write or more (`policy::Issued::intake`) whose slice holds it, or of the first
    /// such share if it reads none of their selectors. The item must have been made on `on`, as its Loro edits carry
    /// `on`'s peer. `NoCap` if `actor` holds no such share, or every slice it reads leaves the entry out.
    pub fn create(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        ty: &str,
        tags: &[&str],
        item: Item,
    ) -> Result<EntryId, Refusal> {
        self.create_bringing(on, actor, vault, ty, tags, item, vec![])
    }

    /// `create`, its first write bringing the files `files` too, as `bring`'s write does: one signed edit makes the
    /// entry and brings them, judged as a creation alone, by the `create` op of the shares it goes through. Whoever may
    /// receive it may fetch their sealed bytes (T27), and who opens it opens them (`file`).
    #[allow(clippy::too_many_arguments)]
    pub fn create_bringing(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        ty: &str,
        tags: &[&str],
        item: Item,
        files: Vec<Brought>,
    ) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let (entry, nonce) = self.new_entry_id(on, vault);
        let header = Header { ty: Sym::new(ty), created: self.now };
        let tags: Vec<Sym> = tags.iter().map(|&t| Sym::new(t)).collect();
        let audience = self.intake(on, actor, vault, entry, &header, &tags, true)?;
        let content = item.export(&Version::default());
        let at = (entry, Creation { audience, nonce });
        self.create_with(on, actor, vault, at, header, tags, (content, files, None), Proposal::Main)?;
        Ok(entry)
    }

    /// Draft an entry of vault `vault` of type `ty` with tags `tags`, on device `on`, acting for `actor`: a creation
    /// that starts its own line, the draft's (`Proposal::New`), named by its own id, so its main line holds nothing
    /// until the vault lands it, merging that line (`History::landed`). `content` makes its first content once its id
    /// is drawn: a draft's creation is written as its author's draft peer of the entry (`doc::Peer::Draft`,
    /// `doc::Item::draft`), as the line it starts isn't named until it is written; `None` where what it would hold
    /// isn't a view of its schema. It goes in the audience `create` puts a new entry in, judged as a creation on a
    /// proposal: through a share whose ops let it create on proposals (a Suggester's), and, where the vault drafts it
    /// itself, among no share to everyone. Further edits are writes on its line, and an AIP names it as any proposal.
    /// The entry and the line, the creation's own id. `NotAView` where `content` makes none, or for a schema or lens,
    /// which joins its vault's lane by a creation on main alone, unless the device is a patched app's.
    #[allow(clippy::too_many_arguments)]
    pub fn create_draft(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        ty: &str,
        tags: &[&str],
        content: impl FnOnce(EntryId) -> Option<Vec<u8>>,
    ) -> Result<(EntryId, EditId), Refusal> {
        self.create_draft_bringing(on, actor, vault, ty, tags, content, vec![])
    }

    /// `create_draft`, its creation bringing the files `files` too (`create_bringing`): they are on the draft's line,
    /// as its first content is, and on its main line once its vault lands it, with all the line holds
    /// (`line_files`).
    #[allow(clippy::too_many_arguments)]
    pub fn create_draft_bringing(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        ty: &str,
        tags: &[&str],
        content: impl FnOnce(EntryId) -> Option<Vec<u8>>,
        files: Vec<Brought>,
    ) -> Result<(EntryId, EditId), Refusal> {
        self.unlocked(on)?;
        let (entry, nonce) = self.new_entry_id(on, vault);
        let header = Header { ty: Sym::new(ty), created: self.now };
        if header.ty.of_lane() && !self.lawless {
            return Err(Refusal::NotAView);
        }
        let tags: Vec<Sym> = tags.iter().map(|&t| Sym::new(t)).collect();
        let audience = self.intake(on, actor, vault, entry, &header, &tags, false)?;
        let content = content(entry).ok_or(Refusal::NotAView)?;
        let at = (entry, Creation { audience, nonce });
        let line = self.create_with(on, actor, vault, at, header, tags, (content, files, None), Proposal::New)?;
        Ok((entry, line))
    }

    /// `create` in the audience of the shares `audience`, whatever their slices say: what a device that ignores where
    /// its entry belongs does, which the rules check by the audience alone.
    #[allow(clippy::too_many_arguments)]
    pub fn create_in(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        audience: Vec<ShareId>,
        ty: &str,
        tags: &[&str],
        item: Item,
    ) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let (entry, nonce) = self.new_entry_id(on, vault);
        let header = Header { ty: Sym::new(ty), created: self.now };
        let tags = tags.iter().map(|&t| Sym::new(t)).collect();
        let content = item.export(&Version::default());
        let at = (entry, Creation { audience, nonce });
        self.create_with(on, actor, vault, at, header, tags, (content, vec![], None), Proposal::Main)?;
        Ok(entry)
    }

    /// The first write of entry `entry`, holding `content` and bringing the files `files` (`make_bringing`), in the
    /// audience of the shares its creation names, with the nonce its id is the hash of, under the epoch the audience is at, or the one it moves to as the entry
    /// brings it back into use (`policy::State::reenters`), on the main line or, for a draft, starting its own
    /// (`proposal`). A schema or lens entry's content is its schema or lens, and nothing else (`add_schema`):
    /// `NotAView` where it isn't one, unless the device is a patched app's. Its id.
    #[allow(clippy::too_many_arguments)]
    fn create_with(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        (entry, create): (EntryId, Creation),
        header: Header,
        tags: Vec<Sym>,
        (content, mut files, defines): (Vec<u8>, Vec<Brought>, Option<rules::CapGroup>),
        proposal: Proposal,
    ) -> Result<EditId, Refusal> {
        files.sort_by_key(|f| f.root);
        files.dedup_by_key(|f| f.root);
        let roots = files.iter().map(|f| f.root).collect();
        let view = self.latest(on).clone();
        let x = AudienceId::of(vault, &create.audience);
        let epoch = view.epoch(KeyFam::Audience(vault, x)) + view.reenters(vault, x) as u64;
        let action = Action::Write {
            vault,
            entry,
            actor,
            stay: None,
            epoch,
            deps: vec![],
            proposal,
            via: vec![],
            create: Some(create),
            files: roots,
            body: vec![],
        };
        let (edit, w) = self.check_write(on, &view, action)?;
        let attrs = Attrs { ty: header.ty.clone(), author: actor, entry, created: header.created, tags: tags.clone() };
        let tags = TagDelta { add: tags, remove: vec![] };
        let proof = match header.ty.of_lane() {
            true if !(lane_fits(&header.ty, &content) || self.lawless) => return Err(Refusal::NotAView),
            true => self.prove(on, &view, &w, (Some(&[Touch::Create]), &tags), Some(&attrs))?,
            false => self.proven(on, &view, (vault, &History::default()), &w, (&content, &tags), &[], Some(&attrs))?,
        };
        self.write(on, edit, Body { header: Some(header), tags, answers: vec![], content, proof, files, defines }, x)
    }

    /// Define cap group `group` of vault `vault` on device `on`, acting for the vault: a new entry of type
    /// `slice::CAP_GROUP_TYPE` whose record is the group (`rules::CapGroup::record`) and whose first write says it
    /// (`slice::Body::defines`), in force from there on for every share that names the entry (`issue_group`). Every
    /// share over the vault selects it, so whoever reads anything of the vault reads its cap groups and judges each
    /// write alike (`policy::State::eff_selects`). Its id. `NoCap` if `on` doesn't act for the vault.
    pub fn define_group(&mut self, on: SignerId, vault: VaultId, group: rules::CapGroup) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let (entry, nonce) = self.new_entry_id(on, vault);
        let header = Header { ty: Sym::new(CAP_GROUP_TYPE), created: self.now };
        let audience = self.intake(on, vault, vault, entry, &header, &[], true)?;
        let view = View::built_in(CAP_GROUP_TYPE).expect("a built-in cap group app");
        let item = Item::made(view, &group.record(), on).ok_or(Refusal::NotAView)?;
        let content = item.export(&Version::default());
        let at = (entry, Creation { audience, nonce });
        self.create_with(on, vault, vault, at, header, vec![], (content, vec![], Some(group)), Proposal::Main)?;
        Ok(entry)
    }

    /// A new version of cap group entry `entry` of vault `vault`, on device `on`, acting for the vault: a write on its
    /// main line whose record is `group` and which says it, in force from there on in place of the version before it
    /// for every share that names the entry. So a narrower version narrows every share of the group at once, and a
    /// share holds the group, never a copy of its ops. `UnknownEntry` if `on` knows no cap group entry `entry` of
    /// `vault`.
    pub fn redefine_group(
        &mut self,
        on: SignerId,
        vault: VaultId,
        entry: EntryId,
        group: rules::CapGroup,
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let store = self.held(on);
        let st = store.view();
        if !st.entry(entry).is_some_and(|en| en.vault == vault && st.is_cap_group(en, &store.readings)) {
            return Err(Refusal::UnknownEntry);
        }
        let (view, record) = (View::built_in(CAP_GROUP_TYPE).expect("a built-in cap group app"), group.record());
        let draft = self.shown(on, entry).edit(MAIN, on, |item| item.set_record(view, &record));
        self.make_bringing(on, vault, entry, draft, TagDelta::default(), (vec![], &[]), Some(group))
    }

    /// Cap group entry `entry` of vault `vault` as device `on` counts the writes that say it, now
    /// (`policy::State::group`): `None` for an entry that is none, or that `on` doesn't read.
    pub fn group(&self, on: SignerId, vault: VaultId, entry: EntryId) -> Option<&rules::CapGroup> {
        let store = self.held(on);
        store.view().group(&store.readings, vault, entry)
    }

    /// The cap groups of vault `vault` device `on` reads, each with its entry, in the order their entries were created.
    pub fn groups(&self, on: SignerId, vault: VaultId) -> Vec<(EntryId, &rules::CapGroup)> {
        let store = self.held(on);
        let st = store.view();
        let of = |en: &Entry| Some((en.id, st.group(&store.readings, vault, en.id)?));
        st.entries().iter().filter(|en| en.vault == vault).filter_map(of).collect()
    }

    /// An invite key made again from `secret`, the 32 bytes an invite's link holds: a signer that signs the claim of
    /// the share issued to it (`claim_invite`), as a software passkey signs. Its id, which a share to the invite names
    /// (`Who::Invite`).
    pub fn invite_key(&mut self, secret: [u8; 32]) -> SignerId {
        self.invite_key_in(secret, sign::SIGNING)
    }

    /// `invite_key`, in suite `suite`: an invite made before the key move names its key in SLH-DSA.
    pub fn invite_key_in(&mut self, secret: [u8; 32], suite: Suite) -> SignerId {
        let key = Passkey::from_seed_in(secret, suite);
        let id = key.id();
        self.keys.insert(id, Key::Passkey(key));
        self.names.insert(id, "an invite key".into());
        id
    }

    /// A new invite: the secret its link holds, drawn from the Lab's randomness, and the id of the key `invite_key`
    /// makes again from it, which a share to the invite names (`Who::Invite`). The Lab keeps no key: the issuer's
    /// device hands the secret on in the link and forgets it.
    pub fn new_invite(&mut self) -> (Zeroizing<[u8; 32]>, SignerId) {
        let secret = Zeroizing::new(self.secret("invite key", ""));
        let id = Passkey::from_seed(*secret).id();
        (secret, id)
    }

    /// Claim share `share`, which its issuer issued to invite key `invite`, for vault `vault`, on device `on`, acting
    /// for the vault: one edit, which the device and the invite key sign, that makes `vault` the share's grantee, once
    /// (G1), with no owner of the vault it is over signing. What a newcomer's device does at sign-up, with the key its
    /// invite link holds. `NotInvite` if the share goes to no invite key, as one claimed already, `Revoked` if it was
    /// revoked, `NoConsent` if it goes to another key.
    pub fn claim_invite(
        &mut self,
        on: SignerId,
        share: ShareId,
        vault: VaultId,
        invite: SignerId,
    ) -> Result<EditId, Refusal> {
        self.submit(on, &[on, invite], Action::Claim { share, vault, via: vec![] })
    }

    /// Create a schema or lens entry of vault `vault` holding `blob`, on device `on`, acting for `actor`: of the type
    /// the blob reads as, a lens or else a schema (`lens::Lane::new`), its content the blob and nothing else. What the
    /// vault itself creates so joins its lane (`policy::State::lane_of`), which its readers read its entries through.
    /// The vault first shares its schemas and lenses with everyone, unless a share of its own does already
    /// (`schemas_share`), and the entry goes in the audience a steward puts it in, which that share is in. What anyone
    /// else creates goes where `create` puts it, and joins no lane. `NotAView` if the blob is neither, unless the
    /// device is a patched app's: its blob makes a schema entry, which no reader counts.
    pub fn add_schema(
        &mut self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        blob: &[u8],
    ) -> Result<EntryId, Refusal> {
        self.unlocked(on)?;
        let ty = match (Lens::parse(blob), Schema::parse(blob)) {
            (Some(_), _) => LENS_TYPE,
            (None, Some(_)) => SCHEMA_TYPE,
            (None, None) if self.lawless => SCHEMA_TYPE,
            (None, None) => return Err(Refusal::NotAView),
        };
        let (entry, nonce) = self.new_entry_id(on, vault);
        let header = Header { ty: Sym::new(ty), created: self.now };
        let shared = match actor == vault {
            true => self.schemas_share(on, vault)?,
            false => None,
        };
        let audience = match self.intake(on, actor, vault, entry, &header, &[], true)? {
            x if x.is_empty() => shared.into_iter().collect(),
            x => x,
        };
        let (content, at) = ((blob.to_vec(), vec![], None), (entry, Creation { audience, nonce }));
        self.create_with(on, actor, vault, at, header, vec![], content, Proposal::Main)?;
        Ok(entry)
    }

    /// The share vault `vault` shares its schemas and lenses with everyone by, as device `on` holds it: a live one the
    /// vault issued itself, to read, picking every schema and lens entry and nothing else; else one `on` issues for it
    /// now. In a dry run, none is issued.
    fn schemas_share(&mut self, on: SignerId, vault: VaultId) -> Result<Option<ShareId>, Refusal> {
        let select = Selector::lane();
        let (store, st) = (self.held(on), self.latest(on));
        let ours = |cp: &&Issued| {
            let s = &cp.share;
            let read = (s.who, s.level, s.wide, s.parent) == (Who::Everyone, Level::Read, false, None);
            st.live(cp.id) && s.over == vault && s.issuer == vault && read
                && store.slices.get(&cp.id).is_some_and(|sl| sl.select == select)
        };
        let found = st.shares().iter().find(ours).map(|cp| cp.id);
        if found.is_some() || self.dry {
            return Ok(found);
        }
        let name = "Schemas and lenses".to_string();
        let ops = Level::Read.ops();
        let share =
            NewShare { over: vault, who: Who::Everyone, name, select, ops, parent: None, issuer: vault, keep: None };
        self.issue(on, &[on], share).map(Some)
    }

    /// The audience a new entry goes in (`create`), created on the main line (`main`) or a draft (`create_draft`),
    /// which no share to everyone reads until it lands (`policy::State::meaning_landed`).
    #[allow(clippy::too_many_arguments)]
    fn intake(
        &self,
        on: SignerId,
        actor: VaultId,
        vault: VaultId,
        entry: EntryId,
        header: &Header,
        tags: &[Sym],
        main: bool,
    ) -> Result<Vec<ShareId>, Refusal> {
        let (store, st) = (self.held(on), self.latest(on));
        let attrs = Attrs { ty: header.ty.clone(), author: actor, entry, created: header.created, tags: tags.to_vec() };
        if actor == vault {
            let complete = store.reads_shares(st, vault);
            let mut x = if complete { semantic_audience(st, vault, &attrs, &store.readings) } else { vec![] };
            x.retain(|c| main || st.share(*c).is_none_or(|cp| cp.share.who != Who::Everyone));
            return Ok(x);
        }
        let shares: Vec<&Issued> =
            st.shares_held(actor).filter(|cp| cp.share.over == vault && st.holds(actor, cp, Level::Write)).collect();
        // its own selector, as the grantee reads it: the stewards judge by the whole chain; and of those, one whose
        // ops let a creation through first
        let holds = |cp: &&Issued| store.slices.get(&cp.id).map(|s| cp.share.wide || s.select.matches(&attrs));
        let at = At { attrs: Some(&attrs), place: st.all_writes().len(), groups: &store.readings.groups };
        let creates = |cp: &Issued| {
            let proof = store.slices.get(&cp.id).map(|s| Proof { share: cp.id, grants: s.grants() });
            st.lets_through(cp, proof.as_ref(), main, &[Touch::Create], at)
        };
        let held: Vec<&Issued> = shares.iter().copied().filter(|cp| holds(cp) == Some(true)).collect();
        if let Some(cp) = held.iter().find(|cp| creates(cp)).or(held.first()) {
            return Ok(cp.intake.to_vec());
        }
        if !shares.is_empty() && shares.iter().all(|cp| holds(cp).is_some()) {
            return Err(Refusal::NoCap);
        }
        shares.first().map(|cp| cp.intake.to_vec()).ok_or(Refusal::NoCap)
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
        let draft = self.shown(on, entry).edit_on(self.shown_item(on, entry, line), line, on, change);
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// Bring the files `files` into an entry, on device `on`, acting for `actor`: a write on its main line that names
    /// them by their roots, holds their keys and lengths encrypted, and carries what `change` does to the item (what
    /// the entry says of them: a name, a type), building on the line's heads. Whoever may receive the write may fetch
    /// the files' sealed bytes (T27); who reads the entry opens them (`file`).
    pub fn bring(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        files: Vec<Brought>,
        change: impl FnOnce(&mut Item),
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).edit_on(self.shown_item(on, entry, MAIN), MAIN, on, change);
        self.make_bringing(on, actor, entry, draft, TagDelta::default(), (files, &[]), None)
    }

    /// Bring the files `files` into an entry, on device `on`, acting for `actor`, as one who may set its whole record:
    /// `bring`, changing nothing of the item, made only where the write acts for the entry's vault or a share it relies
    /// on lets it set the record at its root on the main line (`NotAllowed` else), as the entry's readers count a file
    /// as its own (`line_files`). So `set` decides who brings a file into an entry, as `create` decides who creates one
    /// with a file (`create_bringing`): a Suggester's share, which writes on proposals alone, brings none.
    pub fn bring_into(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        files: Vec<Brought>,
    ) -> Result<EditId, Refusal> {
        self.bring_on(on, actor, entry, MAIN, files, |_| {})
    }

    /// Bring the files `files` into an entry on line `line` of its history, on device `on`, acting for `actor`, as one
    /// who may set its whole record there: one write on that line that carries what `change` does to the item as the
    /// device shows it there (a new version of its record, or nothing), made only where the write acts for the entry's
    /// vault or a share it relies on lets it set the record at its root on that line (`NotAllowed` else), as the
    /// entry's readers count a file of a line as its own (`line_files`). So a version and its file are one write, on
    /// main or on a proposal that a merge takes into main.
    pub fn bring_on(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        line: Line,
        files: Vec<Brought>,
        change: impl FnOnce(&mut Item),
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).edit(line, on, change);
        self.make_bringing(on, actor, entry, draft, TagDelta::default(), (files, &[whole()]), None)
    }

    /// Add the tags `add` to an entry and remove the tags `remove`, on device `on`, acting for `actor`: a write on its
    /// main line carrying only the tags, building on the line's heads, as the device counts them. They count at once
    /// when `actor` is the entry's vault; anyone else asks the vault's stewards, who answer with what its shares let it
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

    /// Start a variant of an entry named `name` from version `from`, on device `on`, acting for `actor`: a line that
    /// stays open beside main and follows it (`history::History::variant`).
    pub fn variant(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        from: &[EditId],
        name: &str,
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).variant(from, name);
        self.make(on, actor, entry, draft, TagDelta::default())
    }

    /// Accept proposal `line` of an entry as it stands, on device `on`, acting for `actor`, the entry's vault: a write on
    /// the proposal that builds on its heads and changes nothing, which every reader of the entry reads as the vault's
    /// accept (`policy::is_accept`, M2). A merge of the proposal into main by anyone else counts only on top of it, and
    /// brings in nothing written on the proposal after it. `NoCap` if `actor` isn't the entry's vault, whose accept
    /// alone counts (the default policy, one of its owners), `NotOnProposal` if the device shows no such proposal.
    pub fn accept(&mut self, on: SignerId, actor: VaultId, entry: EntryId, line: EditId) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let vault = self.latest(on).entry(entry).ok_or(Refusal::UnknownEntry)?.vault;
        if actor != vault {
            return Err(Refusal::NoCap);
        }
        let h = self.shown(on, entry);
        if !h.get(line).is_some_and(|c| c.write.proposal == Proposal::New) {
            return Err(Refusal::NotOnProposal);
        }
        let deps = h.heads(Some(line));
        self.make(on, actor, entry, Draft { proposal: Proposal::On(line), deps, body: vec![] }, TagDelta::default())
    }

    /// Merge line `from` of an entry into line `into`: a write on `into` building on the heads of both, which brings
    /// `into` to the three-way merge of both lines from their base (`history::History::merge`), `into` keeping its own
    /// value at every conflict but those `take` names, where it takes `from`'s.
    pub fn merge(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        from: Line,
        into: Line,
        take: &BTreeSet<merge::Place>,
    ) -> Result<EditId, Refusal> {
        self.unlocked(on)?;
        let draft = self.shown(on, entry).merge(from, into, on, take);
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

    /// A fork of what device `on` shows on line `line` of an entry: a new entry of vault `into` with its record, its
    /// type and its tags, and none of its history, as `on`'s first write of the new entry, acting for `actor`.
    /// `ReadOnly` if it shows nothing there.
    pub fn fork(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        line: Line,
        into: VaultId,
    ) -> Result<EntryId, Refusal> {
        self.fork_with(on, actor, entry, (line, into), |_| Ok(()))
    }

    /// `fork`, with `change` made to the copy before it is written: one first write holds both, as when the ops
    /// engine's `fork` marks where the copy came from.
    pub fn fork_with<E: From<Refusal>>(
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
    /// A copy of the item device `d` shows of entry `entry` on line `line`, to edit: the item its history makes.
    fn shown_item(&self, d: SignerId, entry: EntryId, line: Line) -> Option<Item> {
        // the host's item writes as the host's peer: a session's write is its own key's, its item made anew for it
        if self.hosted.contains_key(&d) {
            return None;
        }
        self.held(d).shown.get(&entry)?.items.get(&line).cloned()
    }

    fn shown(&self, d: SignerId, entry: EntryId) -> &History {
        static NONE: std::sync::LazyLock<History> = std::sync::LazyLock::new(History::default);
        self.held(d).shown.get(&entry).map_or(&NONE, |s| &s.history)
    }

    /// Make the write `draft` describes of entry `entry` on device `on`, acting for `actor`, carrying the tags `tags`,
    /// under the entry's key in its stay now, at its audience's epoch now, in what the device knows (T15).
    fn make(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        draft: Draft,
        tags: TagDelta,
    ) -> Result<EditId, Refusal> {
        self.make_bringing(on, actor, entry, draft, tags, (vec![], &[]), None)
    }

    /// `make`, bringing the files `files`: named in the clear by their roots, their keys and lengths in its body. Its
    /// proof lets the touches `needs` through too (`proven`).
    fn make_bringing(
        &mut self,
        on: SignerId,
        actor: VaultId,
        entry: EntryId,
        draft: Draft,
        tags: TagDelta,
        (mut files, needs): (Vec<Brought>, &[Touch]),
        defines: Option<rules::CapGroup>,
    ) -> Result<EditId, Refusal> {
        files.sort_by_key(|f| f.root);
        files.dedup_by_key(|f| f.root);
        let roots = files.iter().map(|f| f.root).collect();
        let view = self.latest(on).clone();
        let en = view.entry(entry).ok_or(Refusal::UnknownEntry)?;
        let (vault, stay, x) = (en.vault, en.stay(), en.audience());
        let epoch = view.epoch(KeyFam::Audience(vault, x));
        let Draft { proposal, deps, body: content } = draft;
        let (via, create) = (vec![], None);
        let action =
            Action::Write { vault, entry, actor, stay, epoch, deps, proposal, via, create, files: roots, body: vec![] };
        let (edit, w) = self.check_write(on, &view, action)?;
        let proof = self.proven(on, &view, (vault, self.shown(on, entry)), &w, (&content, &tags), needs, None)?;
        self.write(on, edit, Body { header: None, tags, answers: vec![], content, proof, files, defines }, x)
    }

    /// Encrypt `body` into the write `edit`, whose stay is in audience `x`, then sign and keep it (`seal_write`), and
    /// bring the device up to date. In a dry run, nothing: its id.
    fn write(&mut self, on: SignerId, edit: Edit, body: Body, x: AudienceId) -> Result<EditId, Refusal> {
        if self.dry {
            return Ok(edit.id());
        }
        let id = self.seal_write(on, edit, body, x)?;
        match &mut self.held_back {
            Some(devices) => _ = devices.insert(on),
            None => self.refresh(on, &[]),
        }
        Ok(id)
    }

    /// Encrypt `body` into the write `edit`, whose stay is in audience `x`, under the key of its entry in that stay at
    /// the epoch it names (`entry_key_for`), bound to the edit, then sign and keep it.
    fn seal_write(&mut self, on: SignerId, mut edit: Edit, body: Body, x: AudienceId) -> Result<EditId, Refusal> {
        let Action::Write { vault, entry, stay, epoch, .. } = edit.action else { unreachable!("a write") };
        let at = self.at(on);
        let Lab { stores, rng, .. } = self;
        let store = stores.get_mut(&at).expect("a device");
        let key = entry_key_for(store, rng, vault, x, entry, stay, epoch);
        let sealed = keys::seal_edit(&key, &body.to_wire(), &write_context(&edit), rng);
        if let Action::Write { body: b, .. } = &mut edit.action {
            *b = sealed;
        }
        let id = edit.id();
        let signed = self.sign(edit)?;
        self.keep(on, vec![signed], &Blobs::new());
        let store = self.stores.get_mut(&self.at(on)).expect("a device");
        store.bodies.insert(id, body);
        store.opened.entry(entry).or_default().push(id);
        store.files_at = OnceLock::new();
        Ok(id)
    }

    /// Device `on` marks entry `entry` now as a steward of its vault does in its upkeep (`steward`), acting for the
    /// vault: with the audience its meaning asks for, and the keep shares that pick it, where it reads every selector
    /// that takes, and where the marks the entry carries say otherwise; never with an audience or wants of its own. The
    /// mark, or none where there is nothing to mark, or `on` doesn't read every selector a mark takes yet.
    /// `UnknownEntry` if `on` knows no such entry, `NotActing` if it doesn't act for the entry's vault.
    pub fn mark_now(&mut self, on: SignerId, entry: EntryId) -> Result<Option<EditId>, Refusal> {
        self.unlocked(on)?;
        let store = self.held(on);
        let (st, r) = (store.view(), &store.readings);
        let en = st.entry(entry).ok_or(Refusal::UnknownEntry)?;
        let v = en.vault;
        if !st.acts_for(on, v) {
            return Err(Refusal::NotActing);
        }
        let read = r.headers.contains_key(&en.creation) && en.retags.iter().all(|w| r.tags.contains_key(w));
        if !read || !store.reads_shares(st, v) {
            return Ok(None);
        }
        let Some((caps, wants)) = st.meaning_landed(entry, r, landed_in(store, entry)).and_then(|m| m.mark) else {
            return Ok(None);
        };
        let wants = wants.filter(|_| store.reads_keeps(st, v));
        if caps.is_none() && wants.is_none() {
            return Ok(None);
        }
        let (keep, via) = (vec![], vec![]);
        self.submit(on, &[on], Action::Mark { vault: v, entry, caps, wants, keep, via }).map(Some)
    }

    /// The schemas and lenses in vault `v`'s lane, as device `d` reads them off the schema and lens entries it holds
    /// (`policy::State::lane_of`).
    pub fn lane(&self, d: SignerId, v: VaultId) -> Lane {
        Lane::new(self.lane_of(d, v))
    }

    /// The blobs of vault `v`'s lane, as device `d` reads them off the schema and lens entries it holds, in the order
    /// the entries were created (`policy::State::lane_of`): each a schema or a lens.
    pub fn lane_of(&self, d: SignerId, v: VaultId) -> Vec<&[u8]> {
        let store = self.held(d);
        store.view().lane_of(v, &store.readings)
    }

    /// What schema or lens entry `entry` holds, as device `d` reads it: the JSON its creation brought, as written
    /// (`policy::Readings::blobs`). `None` for any other entry, or one whose creation `d` doesn't open.
    pub fn lane_entry(&self, d: SignerId, entry: EntryId) -> Option<&[u8]> {
        let store = self.held(d);
        let en = store.view().entry(entry)?;
        store.readings.blobs.get(&en.creation).map(|b| &b[..])
    }

    /// The vault entry `entry` is of, by device `d`'s view.
    pub fn vault_of_entry(&self, d: SignerId, entry: EntryId) -> Option<VaultId> {
        Some(self.held(d).view().entry(entry)?.vault)
    }

    /// The vault log `log` is about, by device `d`'s view, and its entry where it is one's: a vault's own log's or one
    /// of its audiences', the vault a share is over, or an entry's.
    pub fn whose_log(&self, d: SignerId, log: LogId) -> Option<(VaultId, Option<EntryId>)> {
        let view = self.held(d).view();
        match log {
            LogId::Vault(v) | LogId::Audience(v, _) => Some((v, None)),
            LogId::Share(c) => Some((view.share(c)?.share.over, None)),
            LogId::Entry(e) => Some((view.entry(e)?.vault, Some(e))),
        }
    }

    /// The entries whose writes bring file `root`, each with its vault, by device `d`'s view: whose the file is.
    pub fn whose_file(&self, d: SignerId, root: &FileRoot) -> BTreeMap<EntryId, VaultId> {
        let store = self.held(d);
        let entries = store.log.edits().iter().filter(|e| e.files().contains(root)).filter_map(Edit::entry);
        entries.filter_map(|e| Some((e, store.view().entry(e)?.vault))).collect()
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
        if !self.sees(d, entry) {
            return None;
        }
        self.held(d).shown.get(&entry)?.items.get(&line)
    }

    /// Whether entry `e` has landed, as device `d` shows it (`History::landed`): it is no draft, or its vault took it
    /// into main. Every main read leaves out one that hasn't (`world`, `data`, the feeds).
    pub fn landed(&self, d: SignerId, e: EntryId) -> bool {
        self.sees(d, e) && landed_in(self.held(d), e)
    }

    /// Whether entry `e` goes public once it lands, as device `d` reads the selectors of its vault's shares: a live
    /// share to everyone over its vault picks it then, on the whole vault or by its slice, as its meaning would have it
    /// had it landed (`policy::State::meaning_landed`). Advice, for whoever answers a draft: only its vault's stewards
    /// read every selector, and they mark it so once it lands.
    pub fn public_once_landed(&self, d: SignerId, e: EntryId) -> bool {
        let store = self.held(d);
        let (st, r) = (store.view(), &store.readings);
        let Some(en) = st.entry(e) else { return false };
        let everyone = |cp: &Issued| cp.share.who == Who::Everyone && st.live(cp.id) && !cp.share.level.is_keep();
        let wide = st.shares_over(en.vault).any(|cp| cp.share.wide && everyone(cp));
        let picks = |c: &ShareId| st.share(*c).is_some_and(everyone);
        wide || st.meaning_landed(e, r, true).is_some_and(|m| m.audience.iter().any(picks))
    }

    /// An entry's history as device `d` holds it: every write it counts, with what it could open, its lines and their
    /// heads, the proposals' names, and any version to open read-only (`History::item_at`). `None` if it counts no
    /// write of the entry.
    pub fn history(&self, d: SignerId, entry: EntryId) -> Option<&History> {
        if !self.sees(d, entry) {
            return None;
        }
        self.held(d).shown.get(&entry).map(|s| &s.history)
    }

    /// How many writes of the entry device `d` holds, whether it can decrypt them or not.
    pub fn fetched(&self, d: SignerId, entry: EntryId) -> usize {
        let writes = |edit: &&Edit| matches!(edit.action, Action::Write { entry: e, .. } if e == entry);
        self.held(d).log.edits().iter().filter(writes).count()
    }

    /// The entries device `d` knows of, in the order they were created: those of its vaults, and those its vaults'
    /// shares reach, whether it reads them or only relays them.
    pub fn entries(&self, d: SignerId) -> Vec<EntryId> {
        let ids = self.held(d).view().entries().iter().map(|en| en.id);
        ids.filter(|&e| self.sees(d, e)).collect()
    }

    /// What entry `entry` means to device `d`, by what it reads (`policy::State::meaning`): its type, its author, its
    /// tags now, its audience, and where a steward would move it. `None` if it doesn't read the entry's header.
    pub fn meaning(&self, d: SignerId, entry: EntryId) -> Option<Meaning> {
        if !self.sees(d, entry) {
            return None;
        }
        let store = self.held(d);
        store.view().meaning_landed(entry, &store.readings, landed_in(store, entry))
    }

    /// The slice of share `share`, a keep share too, as device `d` reads it: `None` unless its selector is sealed to a
    /// vault `d` acts for (or is public), and `d` opened it.
    pub fn slice(&self, d: SignerId, share: ShareId) -> Option<&Slice> {
        self.held(d).slices.get(&share)
    }

    /// Device `d` holds the key its view says entry `entry` is under now: it reads what is written to it next.
    pub fn reads(&self, d: SignerId, entry: EntryId) -> bool {
        if !self.sees(d, entry) {
            return false;
        }
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

    /// What device `d` makes of the edits it holds, as it last brought itself up to date: what `log(d).view()` says.
    pub fn state(&self, d: SignerId) -> &State {
        self.held(d).view()
    }

    /// The replay of the edits device `d` holds: which stand, and what they say (`state`).
    pub fn replay(&self, d: SignerId) -> &Replay {
        &self.held(d).replay
    }

    /// What device `d`'s work cost since it started (`perf`), and how much it holds: its edits, the bodies it opened,
    /// the entries it shows and the blobs it keeps.
    pub fn perf(&self, d: SignerId) -> Value {
        let store = self.held(d);
        let mut out = store.perf.to_json();
        out["held"] = serde_json::json!({
            "edits": store.log.edits().len(),
            "bodies": store.bodies.len(),
            "shown": store.shown.len(),
            "blobs": store.blobs.len(),
            "blob_bytes": store.blobs.values().map(|b| b.len()).sum::<usize>(),
        });
        // the vaults' checkpoints that stand, and the edits it holds on their word, without their signatures
        let r = &store.replay;
        let checkpoint = |(e, stood): (&Edit, &bool)| *stood && matches!(e.action, Action::Checkpoint { .. });
        out["checkpoints"] = serde_json::json!({
            "standing": r.edits.iter().zip(&r.stood).filter(|&x| checkpoint(x)).count(),
            "vouched": r.vouched().len(),
            "bare": store.bare.len(),
            "uncovered": self.uncovered_count(d),
            "uncovered_by": self.uncovered_by(d),
            "vouching": self.vouching(d),
        });
        out
    }

    /// The signed edit device `d` holds with id `edit`, as it would send it.
    pub fn signed_edit(&self, d: SignerId, edit: EditId) -> Option<&Signed> {
        self.held(d).signed.get(&edit)
    }

    /// Every secret signer `s` holds here, to search views, logs and stores for secrets that shouldn't be there: its
    /// own key, the one keys are sealed to for it, then, for a device, each key it holds. None while it is locked.
    pub fn secrets(&self, s: SignerId) -> Vec<Secret> {
        let Some(key) = self.keys.get(&s) else { return vec![] };
        let held = self.stores.get(&self.at(s)).into_iter().flat_map(|store| store.keys.secrets().cloned());
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
                    SignerKeys::Device { ed25519, pq } => out.extend(ed25519.iter().chain(pq.bytes())),
                    SignerKeys::Passkey { p256, pq } => out.extend(p256.iter().chain(pq.bytes())),
                    SignerKeys::Enclave { mldsa, slh } => out.extend(mldsa.iter().chain(slh.iter().flatten())),
                }
                if let Some(a) = sig.webauthn.as_ref().map(WebAuthn::assertion) {
                    out.extend(a.authenticator_data.iter().chain(&a.client_data_json).chain(&a.signature));
                }
                if let Some(e) = &sig.enclave {
                    out.extend(e.public.iter().chain(&e.sig));
                }
                out.extend(&sig.pq);
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

    /// Device `d` follows the vaults `vaults` from now on, and no others: it names them in each request, and is sent
    /// what everyone reads of them (`sync::Ask::follow`). Any device may follow any vault: it needs no share.
    pub fn follow(&mut self, d: SignerId, vaults: &[VaultId]) {
        let store = self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        let mut follow = vaults.to_vec();
        follow.sort();
        follow.dedup();
        store.follow = follow;
    }

    /// The vaults device `d` follows, smallest first (`follow`).
    pub fn follows(&self, d: SignerId) -> &[VaultId] {
        &self.held(d).follow
    }

    /// Device `d` reads at most `depth` rows down in a query from now on, however deep the query asks (`engine`'s
    /// `query`, whose own limit is `engine::QUERY_DEPTH` unless it names one).
    pub fn set_query_depth(&mut self, d: SignerId, depth: usize) {
        self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab")).query_depth = depth;
    }

    /// The most rows down device `d` reads in a query (`set_query_depth`): `lens::CEILING` until set, as deep as any
    /// write that counts reaches.
    pub fn query_depth(&self, d: SignerId) -> usize {
        self.held(d).query_depth
    }

    /// Device `to` asks device `from` once, with what it holds of each log and the vaults it follows (`sync::asks`),
    /// and `from` answers with what `to` may receive by `from`'s view, of each log only what lies beyond what `to`
    /// holds of it. How many edits `from` sent: none while either is offline.
    pub fn sync(&mut self, from: SignerId, to: SignerId) -> usize {
        if !self.online(from) || !self.online(to) {
            return 0;
        }
        let to_store = self.held(to);
        let asked = asks_ids(to_store.log.edits(), to_store.log.ids(), &to_store.follow);
        let store = self.held(from);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let places = self.answered(from, to, &asked.follow);
        let sent: Vec<EditId> =
            beyond(edits, ids, &logs_of(edits, ids), &places, &asked).into_iter().map(|i| ids[i]).collect();
        let (signed, blobs) = self.outgoing(from, &sent);
        self.deliver(to, signed, &blobs);
        sent.len()
    }

    /// The digest of each log device `d` holds (`sync::digests`): what it gossips.
    pub fn digests(&mut self, d: SignerId) -> &BTreeMap<LogId, [u8; 32]> {
        let store = self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
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
        self.answered(from, to, &mine.follow).iter().any(|&i| match logs[i] {
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
    /// signer's name, the master recovery key this Lab adds (`set_recovery`), and randomness of its own from `seed`, so
    /// that no two devices split off make the same keys or nonces. This Lab keeps the rest.
    pub fn split(&mut self, d: SignerId, with: &[SignerId], seed: [u8; 32]) -> Lab {
        let store = self.stores.remove(&d).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        self.devices.retain(|&x| x != d);
        let keys: HashMap<SignerId, Key> =
            [d].iter().chain(with).filter_map(|s| Some((*s, self.keys.remove(s)?))).collect();
        let salts = self.salts.remove(&d).map(|salt| (d, salt)).into_iter().collect();
        self.split_off(keys, d, store, salts, seed)
    }

    /// A Lab on a machine of its own holding `keys` and device `d`, its store `store` and its salt among `salts`, with
    /// every signer's name, the master recovery key this Lab adds, and randomness of its own from `seed` (`split`,
    /// `moved`).
    fn split_off(
        &self,
        mut keys: HashMap<SignerId, Key>,
        d: SignerId,
        store: Store,
        salts: HashMap<SignerId, (SignerId, [u8; 32])>,
        seed: [u8; 32],
    ) -> Lab {
        if let Some(r) = &self.recovery {
            keys.entry(r.id()).or_insert_with(|| Key::Consent(r.clone()));
        }
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
            offline: HashSet::new(),
            now: self.now,
            dry: false,
            held_back: None,
            lawless: false,
            recovery: self.recovery.clone(),
            hosted: HashMap::new(),
        }
    }

    /// The secret of device `d`'s iroh endpoint, its ed25519 key: `None` while it is locked.
    pub fn endpoint_secret(&self, d: SignerId) -> Option<Zeroizing<[u8; 32]>> {
        match self.keys.get(&d)? {
            Key::Device(k) => Some(k.endpoint_secret()),
            Key::Passkey(_) | Key::Enclave(_) | Key::Web { .. } | Key::Consent(_) | Key::Remote { .. } => None,
        }
    }

    /// A key device `d` alone derives, for `purpose` and `data`, from the key keys are sealed to for it
    /// (`keys::Secret::child`): to wrap a secret it keeps for itself (`keys::wrap`), as the Mac's device wraps the key
    /// of each drive it hosts. `None` while `d` is locked, or for a signer that is no device.
    pub fn own_key(&self, d: SignerId, purpose: &str, data: &[u8]) -> Option<Secret> {
        match self.keys.get(&d)? {
            Key::Device(k) => Some(k.seal_secret().child(purpose, data)),
            Key::Passkey(_) | Key::Enclave(_) | Key::Web { .. } | Key::Consent(_) | Key::Remote { .. } => None,
        }
    }

    /// Device `d`'s hello on the connection whose TLS exporter is `exporter`, for the end that dialed if `dialer`
    /// (`sign::Hello`): `None` while it is locked.
    pub fn hello(&self, d: SignerId, exporter: &[u8; 32], dialer: bool) -> Option<Hello> {
        match self.keys.get(&d)? {
            Key::Device(k) => Some(k.hello(exporter, dialer)),
            Key::Passkey(_) | Key::Enclave(_) | Key::Web { .. } | Key::Consent(_) | Key::Remote { .. } => None,
        }
    }

    /// Device `d`'s signed statement that it holds `logs` and `files`, as it checked at `checked`, seconds since 1970
    /// (H2, `wire::Statement`): `None` while it is locked.
    pub fn statement(
        &self,
        d: SignerId,
        checked: u64,
        logs: Vec<(LogId, Frontier)>,
        files: Vec<(FileRoot, FileHold)>,
    ) -> Option<Statement> {
        let Key::Device(k) = self.keys.get(&d)? else { return None };
        let sig = k.state(&Statement::body(d, checked, &logs, &files));
        Some(Statement { keys: k.keys(), checked, logs, files, sig })
    }

    /// Device `d`'s pass to service `audience`, made now by the Lab's clock (`sign::ApiPass`): `None` while it is
    /// locked.
    pub fn api_pass(&self, d: SignerId, audience: &str) -> Option<ApiPass> {
        let Key::Device(k) = self.keys.get(&d)? else { return None };
        Some(k.api_pass(audience, self.now))
    }

    /// What device `on`, the server of vault `home`, says of device `d` by its view and the cap groups it reads: the
    /// vault `d` is a device of, and whether that vault is an admin of `home` (`gate::device_standing`).
    pub fn device_standing(&self, on: SignerId, home: VaultId, d: SignerId) -> Option<(VaultId, bool)> {
        let store = self.held(on);
        let st = store.view();
        gate::device_standing(st, &st.read_groups(&store.readings), home, d)
    }

    /// The cap groups device `on` reads in force now, by its view (`State::read_groups`): what the server weighs who
    /// holds which of its vault's groups by (`quota`).
    pub fn read_groups(&self, on: SignerId) -> crate::policy::Groups {
        let store = self.held(on);
        store.view().read_groups(&store.readings)
    }

    /// Whether vault `u` measures the AIPs of vault `v` that `author` started, by device `on`'s view and the cap groups
    /// it reads (`gate::measures`).
    pub fn measures(&self, on: SignerId, v: VaultId, author: VaultId, u: VaultId) -> bool {
        let store = self.held(on);
        let st = store.view();
        gate::measures(st, &st.read_groups(&store.readings), v, author, u)
    }

    /// Of each write `added` names, its actor and what it added to an AIP of vault `v` that `author` started, in order,
    /// what the vault's Measurers added, by device `on`'s view and the cap groups it reads (`gate::measured_by`).
    pub fn measured_by<T>(
        &self,
        on: SignerId,
        v: VaultId,
        author: VaultId,
        added: impl IntoIterator<Item = (VaultId, Vec<T>)>,
    ) -> Vec<T> {
        let store = self.held(on);
        let st = store.view();
        gate::measured_by(st, &st.read_groups(&store.readings), v, author, added)
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
            Key::Device(_) | Key::Enclave(_) | Key::Web { .. } | Key::Consent(_) | Key::Remote { .. } => None,
        }
    }

    /// A ceremony of passkey `passkey` over `challenge` (`sign::Ceremony`), as a software passkey or Touch ID key the Lab
    /// holds makes it: `None` unless the Lab holds one. A passkey in the platform's authenticator makes its own, in the
    /// browser, and a Touch ID key in a Mac's Secure Enclave, in the Mac app.
    pub fn ceremony(&mut self, passkey: SignerId, challenge: [u8; 32]) -> Option<Ceremony> {
        match self.keys.get_mut(&passkey)? {
            Key::Passkey(p) => Some(p.ceremony(challenge)),
            Key::Enclave(k) => Some(k.ceremony(challenge)),
            Key::Device(_) | Key::Web { .. } | Key::Consent(_) | Key::Remote { .. } => None,
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
    /// chains, so that the device can add itself to its person's vault (`join`). Nothing about any share, audience or
    /// entry (T20); a passkey that owns no vault gets nothing.
    pub fn link_card(&self, d: SignerId, passkey: SignerId) -> Vec<Signed> {
        let store = self.held(d);
        let places = link_places(store.log.edits(), self.latest(d), passkey);
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
            (vault, None) => {
                self.submit(d, &[passkey, d], Action::Share(Sharing::Device { vault, device: d, seal_to: None }))?
            }
        };
        Ok(self.joined(d, id))
    }

    /// The vault whose root is passkey `passkey` by device `d`'s view, and the edit that added `d` to it, if one did:
    /// what `join` signs, or sends again. A browser's passkey signs `Sharing::Device` in a ceremony (`draft`,
    /// `complete`, P8e), and the device sends `joined`. `UnknownVault` if no vault in `d`'s view has it as its root.
    pub fn joining(&self, d: SignerId, passkey: SignerId) -> Result<(VaultId, Option<EditId>), Refusal> {
        let store = self.held(d);
        let st = store.view();
        let vault = st.vaults().iter().find(|v| v.root == Some(passkey)).ok_or(Refusal::UnknownVault)?;
        let adds = |edit: &Edit| match edit.action {
            Action::Share(Sharing::Device { vault: v, device, .. }) => v == vault.id && device == d,
            _ => false,
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
        if !matches!(join.edit.edit.action, Action::Share(Sharing::Device { device, .. }) if device == from) {
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
    /// of the vaults in its view whose keys it saw in a signature. One endpoint once: a device the key move kept
    /// beside its next key (`draft_move`) is that next key, where `d` saw it sign, and `d`'s own earlier key is `d`.
    pub fn peers(&self, d: SignerId) -> Vec<(SignerId, [u8; 32])> {
        let store = self.held(d);
        let devices: HashSet<SignerId> = store.view().vaults().iter().flat_map(|v| v.devices.iter().copied()).collect();
        let own = match self.keys_of(d) {
            Some(SignerKeys::Device { ed25519, .. }) => Some(ed25519),
            _ => None,
        };
        let mut out: BTreeMap<[u8; 32], (SignerId, bool)> = BTreeMap::new();
        for sig in store.signed.values().flat_map(|s| &s.sigs) {
            if let SignerKeys::Device { ed25519, .. } = sig.keys {
                let (s, next) = (sig.keys.id(), sig.keys.suite() == sign::SIGNING);
                if s == d || Some(ed25519) == own || !devices.contains(&s) {
                    continue;
                }
                let known = out.entry(ed25519).or_insert((s, next));
                if next && !known.1 {
                    *known = (s, next);
                }
            }
        }
        let mut peers: Vec<(SignerId, [u8; 32])> = out.into_iter().map(|(key, (s, _))| (s, key)).collect();
        peers.sort();
        peers
    }

    /// `sync::answer` of device `d`'s edits for `asker`, which follows `follow`: kept while `d`'s edits stay as they
    /// were (`Answers`).
    fn answered(&self, d: SignerId, asker: SignerId, follow: &[VaultId]) -> Arc<Vec<usize>> {
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let fp = fingerprint(ids);
        let key = (asker, follow.to_vec());
        if let Some((at, got)) = store.answers.may.lock().expect("answers").get(&key)
            && *at == fp
        {
            return got.clone();
        }
        let got = Arc::new(answer_ids(edits, ids, self.latest(d), asker, follow));
        let mut may = store.answers.may.lock().expect("answers");
        if may.len() >= ANSWERS_KEPT {
            may.clear();
        }
        may.insert(key, (fp, got.clone()));
        got
    }

    /// What device `d` asks `peer` when it syncs with it on the network (`wire::Request`): its frontier of each log and
    /// a few edits further back, and the vaults it follows (`sync::asks`), and the McEliece keys it lacks that the
    /// edits of those logs name, but only of the logs `peer` may hold by `d`'s view, following nothing: `d` tells a
    /// peer nothing about the rest. A log it names nothing of comes whole, if the peer may send it, so one `peer` holds
    /// only through what it follows comes whole: that costs bytes, and loses nothing.
    pub fn request(&self, d: SignerId, peer: SignerId) -> Request {
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let places = self.answered(d, peer, &[]);
        let logs = logs_of(edits, ids);
        let shared: HashSet<LogId> = places.iter().filter_map(|&i| logs[i]).collect();
        let theirs: HashSet<EditId> = places.iter().map(|&i| ids[i]).collect();
        let mut ask = asks_ids(edits, ids, &store.follow);
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
    /// `asker` to ask on after the last.
    pub fn reply(
        &mut self,
        d: SignerId,
        asker: SignerId,
        request: &Request,
        page: usize,
    ) -> (Vec<Signed>, Vec<BlobId>, bool) {
        let at = Perf::start();
        let places = self.answered(d, asker, &request.ask.follow);
        let sends = self.sends(d, asker, request, &places);
        let store = self.held(d);
        let edits = store.log.edits();
        // the places of all it sends this asking, in order: this page starts after the request's `after`
        let from = request.after.map_or(0, |after| sends.partition_point(|p| *p <= after));
        let (mut signed, mut size, mut more) = (vec![], 0usize, false);
        for (_, id) in &sends[from..] {
            let s = &store.signed[id];
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
        if let Some(store) = self.stores.get_mut(&self.at(d)) {
            store.perf.add("sync: reply", at);
            store.perf.count("sync: edits sent", signed.len() as u64);
        }
        (signed, blobs.into_iter().collect(), more)
    }

    /// The places of all device `d` sends `asker` for `request`, in order (`sync::beyond` of what `asker` may receive,
    /// `places`): kept for the request as it stands but for its `after`, while `d`'s edits stay as they were, so that
    /// an asking a peer makes page after page with the same request works it out once (`Answers`).
    fn sends(&self, d: SignerId, asker: SignerId, request: &Request, places: &[usize]) -> Arc<Vec<Place>> {
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let fp = fingerprint(ids);
        let mut h = Hasher::new("asking");
        h.update(&Request { after: None, ..request.clone() }.to_wire());
        let asked = h.finalize();
        let key = (asker, asked);
        if let Some((at, got)) = store.answers.sends.lock().expect("answers").get(&key)
            && *at == fp
        {
            return got.clone();
        }
        let sent: BTreeSet<Place> = beyond(edits, ids, &logs_of(edits, ids), places, &request.ask)
            .into_iter()
            .map(|i| (edits[i].depth, ids[i]))
            .collect();
        let got = Arc::new(sent.into_iter().collect::<Vec<_>>());
        let mut sends = store.answers.sends.lock().expect("answers");
        if sends.len() >= ANSWERS_KEPT {
            sends.clear();
        }
        sends.insert(key, (fp, got.clone()));
        got
    }

    /// Device `d` may hand `asker`, which follows the vaults `follow`, the McEliece key `blob`: it holds it, and an
    /// edit `asker` may receive by `d`'s view names it.
    pub fn may_fetch(&self, d: SignerId, asker: SignerId, blob: BlobId, follow: &[VaultId]) -> bool {
        let store = self.held(d);
        let edits = store.log.edits();
        store.blobs.contains_key(&blob)
            && self.answered(d, asker, follow).iter().any(|&i| edits[i].blobs().contains(&blob))
    }

    /// Device `d` may hand `asker`, which follows the vaults `follow`, the sealed bytes of file `file`: an edit `asker`
    /// may receive by `d`'s view brings it, or a snapshot states an entry `asker` syncs as it (T27). Whether `d` holds them is its store's to say.
    pub fn may_fetch_file(&self, d: SignerId, asker: SignerId, file: &FileRoot, follow: &[VaultId]) -> bool {
        crate::sync::fetchable(self.held(d).log.edits(), self.latest(d), asker, file, follow)
    }

    /// The files the edits device `d` holds bring, smallest first: what it keeps, whether or not it reads them.
    pub fn files(&self, d: SignerId) -> Vec<FileRoot> {
        let files: BTreeSet<FileRoot> = self.held(d).log.edits().iter().flat_map(|e| e.files().iter().copied()).collect();
        files.into_iter().collect()
    }

    /// The files device `d` keeps whole, smallest first: those the entries it holds and its keep shares want bring,
    /// where its keep shares over the entry's vault say to keep them whole (`State::keeps`), or, with none there but
    /// never ones, where its own setting `keep` says. It fetches the rest a piece at a time as it reads them.
    pub fn kept_files(&self, d: SignerId, keep: bool) -> Vec<FileRoot> {
        let (store, st) = (self.held(d), self.latest(d));
        let kept = |edit: &&Edit| {
            let en = edit.entry().and_then(|e| st.entry(e));
            en.is_some_and(|en| st.wants(d, en) && st.keeps(d, en).unwrap_or(keep))
        };
        let files: BTreeSet<FileRoot> =
            store.log.edits().iter().filter(kept).flat_map(|e| e.files().iter().copied()).collect();
        files.into_iter().collect()
    }

    /// The files the writes of entry `entry` bring, as device `d` holds them, in the order it took them, each once:
    /// each with its plaintext length where `d` opens it (`file`), else `None`.
    pub fn entry_files(&self, d: SignerId, entry: EntryId) -> Vec<(FileRoot, Option<u64>)> {
        let mut seen = BTreeSet::new();
        let edits = self.held(d).log.edits().iter().filter(|e| e.entry() == Some(entry));
        let files = edits.flat_map(|e| e.files().iter().copied()).filter(|f| seen.insert(*f));
        files.map(|f| (f, self.file(d, &f).map(|b| b.len))).collect()
    }

    /// The files the writes of line `line` of entry `entry` bring that device `d` counts as the entry's, in the order
    /// the line's history holds them, oldest first, each once, with its plaintext length where `d` opens it (`file`):
    /// of the writes it counts on that line's history (`History::history`), those that create the entry, act for its
    /// vault, or rely on a share whose chain lets them set the whole record on their line (`bring_into`). So `create`
    /// decides who brings a file with a new entry and `set` who brings one into an entry, and a write that changes
    /// nothing its readers read, as a Suggester may make one on main, brings in none they count; a draft's files are
    /// its line's, and its main line's once its vault lands it. What avenDB's server's feed lists of an entry, and of
    /// which it serves the newest (`world::public_entries`).
    pub fn line_files(&self, d: SignerId, entry: EntryId, line: Line) -> Vec<(FileRoot, Option<u64>)> {
        let mut seen = BTreeSet::new();
        let files = self.bringing(d, entry, line).into_iter().flat_map(|(_, files)| files);
        files.filter(|f| seen.insert(*f)).map(|f| (f, self.file(d, &f).map(|b| b.len))).collect()
    }

    /// The writes of entry `entry` that bring files device `d` counts as the entry's (`line_files`), on its main line
    /// and on each of its variants, each once, in the order the lines' histories hold them, main's first: each with the
    /// line it is in the history of (main for a proposal's that a merge took into main), and the files it brings, with
    /// their plaintext lengths where `d` opens them (`file`). An asset's versions, as the seed writes them, each a
    /// record and its file in one write (`bring_on`), which avenDB's server's feed lists of an entry, with the record
    /// each holds (`world::public_entries`).
    pub fn brought(&self, d: SignerId, entry: EntryId) -> Vec<(EditId, Line, Vec<(FileRoot, Option<u64>)>)> {
        let Some(h) = self.history(d, entry) else { return vec![] };
        let lines = std::iter::once(MAIN).chain(h.variants().into_iter().map(Some));
        let mut seen = BTreeSet::new();
        let writes = lines.flat_map(|line| self.bringing(d, entry, line).into_iter().map(move |w| (line, w)));
        let fresh = writes.filter(|(_, (edit, _))| seen.insert(*edit));
        let opened = |files: Vec<FileRoot>| files.into_iter().map(|f| (f, self.file(d, &f).map(|b| b.len))).collect();
        fresh.map(|(line, (edit, files))| (edit, line, opened(files))).collect()
    }

    /// The writes on line `line` of entry `entry`'s history, oldest first, that bring files device `d` counts as the
    /// entry's (`line_files`), each with the files it brings, by their roots.
    fn bringing(&self, d: SignerId, entry: EntryId, line: Line) -> Vec<(EditId, Vec<FileRoot>)> {
        let Some(h) = self.history(d, entry) else { return vec![] };
        let store = self.held(d);
        let (st, need) = (store.view(), [whole()]);
        let may = |w: &&Write| {
            let (proof, main) = (store.readings.proofs.get(&w.edit), w.proposal == Proposal::Main);
            let (attrs, place) = st.at_write(w, &store.readings);
            let at = At { attrs: attrs.as_ref(), place, groups: &store.readings.groups };
            let lets = |c: &ShareId| st.share(*c).is_some_and(|cp| st.lets_through(cp, proof, main, &need, at));
            w.first || w.shares.is_empty() || w.shares.iter().any(lets)
        };
        let writes = h.history(line).into_iter().map(|c| &c.write).filter(may);
        let files = |w: &Write| Some((w.edit, store.signed.get(&w.edit)?.edit.files().to_vec()));
        writes.filter_map(files).filter(|(_, fs)| !fs.is_empty()).collect()
    }

    /// The key and length of file `root`, from a write device `d` opened that brings it, if any: what it opens the file
    /// with. Only a write that names the file in the clear counts, and only with the length its sealed size says.
    pub fn file(&self, d: SignerId, root: &FileRoot) -> Option<Brought> {
        let store = self.held(d);
        // a session opens a file only through a write of an entry it reads itself
        if self.hosted.contains_key(&d) {
            let brings = |(id, body): (&EditId, &Body)| {
                let signed = store.signed.get(id)?;
                let Action::Write { entry, .. } = signed.edit.action else {
                    return None;
                };
                let named = signed.edit.files();
                let f = body.files.iter().find(|f| f.root == *root && named.contains(&f.root) && f.fits())?;
                self.sees(d, entry).then(|| (*id, f.clone()))
            };
            return store.bodies.iter().filter_map(brings).min_by_key(|(id, _)| *id).map(|(_, f)| f);
        }
        // the first write by id that names the file and holds its key, each file once, rather than every body sorted
        // again at every file asked for (an entry list asks for thousands)
        let at = store.files_at.get_or_init(|| {
            let mut writes: Vec<(&EditId, &Body)> = store.bodies.iter().collect();
            writes.sort_by_key(|(id, _)| **id);
            let mut at = HashMap::new();
            for (id, body) in writes {
                let Some(named) = store.signed.get(id).map(|s| s.edit.files()) else { continue };
                for f in body.files.iter().filter(|f| named.contains(&f.root) && f.fits()) {
                    at.entry(f.root).or_insert_with(|| f.clone());
                }
            }
            at
        });
        at.get(root).cloned()
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
        self.receive_now(d, edits, blobs, true)
    }

    /// `receive`, bringing its keys and items up to date only if `now`, else at the next `catch_up` (or the next
    /// `receive` that does): a pull's pages from far behind each sort before what the replay last stepped over, and each
    /// would replay the whole log (2026-10-21, an iPhone catching up a page of 4 MB at a time). How many edits were new.
    fn receive_now(&mut self, d: SignerId, edits: Vec<Signed>, blobs: Vec<Arc<[u8]>>, now: bool) -> usize {
        let blobs: Blobs = blobs.into_iter().map(|b| (BlobId::of(&b), b)).collect();
        let before = self.held(d).signed.len();
        let mut changed = self.take(d, edits, &blobs);
        let store = self.stores.get_mut(&self.at(d)).expect("a device");
        let named: HashSet<BlobId> = store.log.edits().iter().flat_map(Edit::blobs).collect();
        for (b, bytes) in blobs {
            if named.contains(&b) && !store.blobs.contains_key(&b) {
                store.blobs.insert(b, bytes);
                changed = true;
            }
        }
        let new = self.held(d).signed.len() - before;
        let store = self.stores.get_mut(&self.at(d)).expect("a device");
        store.behind |= changed;
        if now && store.behind {
            self.refresh(d, &[]);
        }
        new
    }

    /// Brings device `d`'s keys and items up to date with the edits it took since it last did (`receive_now`). True if
    /// there were any.
    pub fn catch_up(&mut self, d: SignerId) -> bool {
        let Some(store) = self.stores.get_mut(&self.at(d)) else { return false };
        if !store.behind {
            return false;
        }
        self.refresh(d, &[]);
        true
    }

    /// `receive`, and whose each edit it took is (`whose_log`): what a pull tells its person.
    pub fn receive_whose(
        &mut self,
        d: SignerId,
        edits: Vec<Signed>,
        blobs: Vec<Arc<[u8]>>,
    ) -> (usize, Vec<(VaultId, Option<EntryId>)>) {
        self.receive_whose_now(d, edits, blobs, true)
    }

    /// `receive_whose`, bringing its keys and items up to date only if `now` (`receive_now`): a pull's page that isn't
    /// its last.
    pub fn receive_whose_now(
        &mut self,
        d: SignerId,
        edits: Vec<Signed>,
        blobs: Vec<Arc<[u8]>>,
        now: bool,
    ) -> (usize, Vec<(VaultId, Option<EntryId>)>) {
        let held = &self.held(d).signed;
        let ids = edits.iter().map(|s| (s.edit.id(), &s.edit));
        let fresh: Vec<(EditId, Option<LogId>)> =
            ids.filter(|(id, _)| !held.contains_key(id)).map(|(id, e)| (id, log_of(e, id))).collect();
        let new = self.receive_now(d, edits, blobs, now);
        let taken = fresh.into_iter().filter(|(id, _)| self.held(d).signed.contains_key(id));
        let whose = taken.filter_map(|(_, log)| self.whose_log(d, log?)).collect();
        (new, whose)
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
            self.answered(d, peer, &[]).iter().filter_map(|&i| logs[i]).collect();
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
    /// A node starting again from its store on disk restores the same way.
    pub fn restore_backup(&mut self, d: SignerId, backup: &Backup) {
        self.restore_from(d, backup.clone());
    }

    /// `restore_backup`, taking `backup`'s edits instead of a copy of them: a node starting again from its store holds
    /// each edit once as it restores, not twice (Samuel 2026-10-20: the server's start took more than its 1 GB).
    pub fn restore_from(&mut self, d: SignerId, backup: Backup) {
        self.restore_vouched(d, backup, &HashSet::new());
    }

    /// `restore_from`, where the edits `vouched` were checked already: their signatures aren't checked again. A node
    /// vouches for the edits of a shelf's head it sealed with its own key (`shelf_key`) after it kept them, each
    /// checked as it came (avendb-net's `Edits::vouched`): so a device opening again checks only what came after.
    pub fn restore_vouched(&mut self, d: SignerId, backup: Backup, vouched: &HashSet<EditId>) {
        self.restore_warm(d, backup, vouched, &Warm::default());
    }

    /// `restore_vouched`, starting from what device `d` worked out before, as its shelf keeps it (`Warm`): what of it
    /// it opens with its shelf key, and holds for this engine.
    pub fn restore_warm(&mut self, d: SignerId, backup: Backup, vouched: &HashSet<EditId>, warm: &Warm) {
        let held = self.held(d);
        let (follow, query_depth, gate, perf) = (held.follow.clone(), held.query_depth, held.gate, held.perf.clone());
        let mut store = Store { follow, query_depth, gate, perf, ..Store::default() };
        if let Some(key) = self.shelf_key(d) {
            let memo = warm.memo.as_deref().and_then(|b| key.unlock("memo", b, ENGINE.as_bytes()));
            if let Some(memo) = memo.and_then(|b| Memo::from_bytes(&b)) {
                store.memo_given = Some(memo.clone());
                store.replay = replay_none(Some(memo));
            }
            for bytes in warm.keys.iter().filter_map(|b| key.unlock("keys", b, b"opened keys")) {
                for chunk in bytes.chunks_exact(64) {
                    let (opened, secret) = chunk.split_at(32);
                    let secret = Secret::from_bytes(secret.try_into().expect("32 bytes"));
                    store.opened_before.insert(opened.try_into().expect("32 bytes"), secret);
                }
            }
        }
        self.stores.insert(d, store);
        let (at, offered) = (Perf::start(), backup.signed.len() as u64);
        let fresh = self.fresh(d, backup.signed, vouched);
        if let Some(store) = self.stores.get_mut(&self.at(d)) {
            store.perf.add("check", at);
            store.perf.count("edits offered", offered);
            store.perf.count("edits checked", fresh.iter().filter(|s| !vouched.contains(&s.edit.id())).count() as u64);
        }
        self.keep_fresh(d, fresh, &backup.blobs);
        self.refresh(d, &[]);
    }

    /// Device `d`'s key for what it seals on its own shelf (`ShelfKey`), derived from its own key: `None` while it is
    /// locked.
    pub fn shelf_key(&self, d: SignerId) -> Option<ShelfKey> {
        let own = self.keys.get(&d).filter(|k| matches!(k, Key::Device(_)))?.seal_secret()?;
        Some(ShelfKey(own.child("shelf seal", &[])))
    }

    /// What device `d` worked out that its shelf lacks, encrypted for it alone, to put there (`Warming`): the choice its
    /// replay's resolve made (`policy::Memo`), for this engine, where it tried a removal and its shelf doesn't keep that
    /// choice; and the keys it opened from their boxes since its shelf took them, or with `all` every key it opened or
    /// took from there. `None` while it is locked, and where its shelf lacks nothing. It holds them given only once the
    /// shelf took them (`warmed`), so a save cut short gives them again.
    pub fn warming(&mut self, d: SignerId, all: bool) -> Option<Warming> {
        let key = self.shelf_key(d)?;
        let store = self.stores.get(&d)?;
        let memo_of = store.replay.memo.as_ref().filter(|m| m.upto > 0 && store.memo_given.as_ref() != Some(*m)).cloned();
        let keys_of = store.opened_since.len();
        if memo_of.is_none() && keys_of == 0 {
            return None;
        }
        let memo = memo_of.as_ref().map(|m| key.lock("memo", &m.to_bytes(), ENGINE.as_bytes(), &mut self.rng));
        let keys = (keys_of > 0).then(|| {
            let since = store.opened_since.iter().map(|(b, k)| (b, k));
            let give: Vec<(&[u8; 32], &Secret)> = match all {
                true => store.opened_before.iter().chain(since).collect(),
                false => since.collect(),
            };
            let bytes: Zeroizing<Vec<u8>> =
                Zeroizing::new(give.iter().flat_map(|(b, k)| b.iter().copied().chain(k.bytes())).collect());
            key.lock("keys", &bytes, b"opened keys", &mut self.rng)
        });
        Some(Warming { memo, keys, memo_of, keys_of })
    }

    /// Whether device `d` worked out something its shelf lacks (`warming`), as cheaply as it tells: the node's saver
    /// is woken as it comes to, so a replay or a key opened with nothing else to save reaches the shelf too.
    pub fn warm_due(&self, d: SignerId) -> bool {
        let Some(store) = self.stores.get(&d) else { return false };
        let memo = store.replay.memo.as_ref().is_some_and(|m| m.upto > 0 && store.memo_given.as_ref() != Some(m));
        memo || !store.opened_since.is_empty()
    }

    /// Device `d`'s shelf took `warming` (`warming`): what it gave, it holds given.
    pub fn warmed(&mut self, d: SignerId, warming: Warming) {
        let Some(store) = self.stores.get_mut(&d) else { return };
        if let Some(memo) = warming.memo_of {
            store.memo_given = Some(memo);
        }
        let n = warming.keys_of.min(store.opened_since.len());
        let given: Vec<([u8; 32], Secret)> = store.opened_since.drain(..n).collect();
        store.opened_before.extend(given);
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
                Signed { sigs: vec![forger.sign(edit.id())], edit }
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
        };
        let edit = signed.verify()?.clone();
        self.held(to).view().step(&edit)?;
        self.deliver(to, vec![signed], &Blobs::new());
        Ok(edit.id())
    }
}

/// A step of the key move's last part (`Lab::retires`): the root handed on from `old` to its next key `new`, an
/// earlier owner key removed, or a device removed from vault `vault`, the person's own or an aven they govern.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Retire {
    Root { old: SignerId, new: SignerId },
    Owner(SignerId),
    Device { vault: VaultId, device: SignerId },
}

/// `a` and `b` are keys of one signer in two suites (`Lab::next_key`), or the same keys: one passkey, by its P-256
/// key; one Touch ID key, by its Enclave's key; one device, by its ed25519 key, which names its iroh endpoint too.
fn same_key(a: &SignerKeys, b: &SignerKeys) -> bool {
    match (*a, *b) {
        (SignerKeys::Passkey { p256: a, .. }, SignerKeys::Passkey { p256: b, .. }) => a == b,
        (SignerKeys::Enclave { mldsa: a, .. }, SignerKeys::Enclave { mldsa: b, .. }) => a == b,
        (SignerKeys::Device { ed25519: a, .. }, SignerKeys::Device { ed25519: b, .. }) => a == b,
        _ => false,
    }
}

/// The name of box `bytes` with `info`, as key `with` opens it: what opens is the same wherever all three are.
fn opened_box(info: &[u8], bytes: &[u8], with: &Secret) -> [u8; 32] {
    let mut h = crate::hash::Hasher::new("opened box");
    h.update(&with.id().0).update(&(info.len() as u64).to_le_bytes()).update(info).update(bytes);
    h.finalize()
}

/// Open every box the device can: for one of `mine` (its own key, and what owners lend it), or for a key it already
/// holds; then every key published in the clear; then derive the keys of the entries in each audience whose key it
/// holds; and again, until nothing more opens. A box counts only if what opens is the key it names.
fn open_keys(store: &mut Store, ix: &KeyIndex, mine: &[(SignerId, Secret)]) {
    // the stays each audience had: the entries whose keys a key of the audience derives, and in which stay
    let mut stays: HashMap<AudienceId, Vec<(EntryId, Option<EditId>)>> = HashMap::new();
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
            let mut first = [0; 32];
            let n = b.bytes.len().min(32);
            first[..n].copy_from_slice(&b.bytes[..n]);
            if store.unopened.contains(&(*id, b.to, first)) {
                continue;
            }
            let info = box_info(*name, *id, &b.to);
            let opened = opened_box(&info, &b.bytes, &with);
            // the same box it opened before with the same key, as its shelf keeps it: what opened, again
            if let Some(secret) = store.opened_before.get(&opened).filter(|k| k.id() == *id) {
                more |= store.keys.insert(*name, secret.clone());
                store.perf.count("keys from the shelf", 1);
                continue;
            }
            match keys::open(&b.bytes, &with, &info) {
                Some(secret) if secret.id() == *id => {
                    store.perf.count("keys opened", 1);
                    store.opened_since.push((opened, secret.clone()));
                    more |= store.keys.insert(*name, secret);
                }
                _ => {
                    store.unopened.insert((*id, b.to, first));
                }
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

/// Derive the key of each entry that ever stayed in an audience whose key the device holds, for that stay, at that
/// key's epoch (`keys::entry_key`): true if it derived any.
fn derive(store: &mut Store, stays: &HashMap<AudienceId, Vec<(EntryId, Option<EditId>)>>) -> bool {
    let mut new = vec![];
    for id in &store.keys.audiences {
        let (name, audience) = &store.keys.by_id[id];
        let KeyName::Scoped(KeyFam::Audience(_, x), g) = *name else { continue };
        for &(e, s) in stays.get(&x).into_iter().flatten() {
            if store.derived.insert((*id, e, s)) {
                new.push((KeyName::Entry(e, s, g), keys::entry_key(audience, e, s)));
            }
        }
    }
    let more = !new.is_empty();
    for (name, key) in new {
        store.keys.insert(name, key);
    }
    more
}

/// The key of entry `e` in its stay `stay`, in audience `x` of vault `v`, at epoch `g`: one the device holds, or one
/// it derives from a key it holds of the audience at that epoch, or from a new key of the audience where it holds none,
/// which it keeps, and boxes as it brings its keys up to date.
#[allow(clippy::too_many_arguments)]
fn entry_key_for(
    store: &mut Store,
    rng: &mut SeededRng,
    v: VaultId,
    x: AudienceId,
    e: EntryId,
    stay: Option<EditId>,
    g: u64,
) -> Secret {
    let name = KeyName::Entry(e, stay, g);
    if let Some(key) = store.keys.first(name) {
        return key.clone();
    }
    let audience = KeyName::Scoped(KeyFam::Audience(v, x), g);
    let under = match store.keys.first(audience) {
        Some(key) => key.clone(),
        None => {
            let key = Secret::generate(rng);
            store.keys.insert(audience, key.clone());
            key
        }
    };
    let key = keys::entry_key(&under, e, stay);
    store.derived.insert((under.id(), e, stay));
    store.keys.insert(name, key.clone());
    key
}

/// Open what the device's keys open of its edits and keep it: the selector of each share (`open_select`), a keep
/// share's too, and the body of each write its view counts, or whose tags count (`policy::Entry::retags`); then what
/// it reads in them.
fn read(d: SignerId, store: &mut Store) {
    let st = &store.replay.state;
    for cp in st.shares() {
        let (id, of) = (cp.id, &cp.share);
        if store.slices.contains_key(&id) || store.unreadable.contains(&id) {
            continue;
        }
        match open_select(of, &store.keys, st.acts_for(d, of.over)) {
            Ok(Some(slice)) => {
                store.slices.insert(id, slice);
            }
            Ok(None) => {}
            Err(()) => {
                store.unreadable.insert(id);
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
            let Action::Write { entry, stay, epoch, body, .. } = &edit.action else { continue };
            let Some(key) = keys::edit_key(body) else {
                store.spoilt.insert(id);
                continue;
            };
            let Some(key) = store.keys.get(&key, KeyName::Entry(*entry, *stay, *epoch)) else { continue };
            match keys::open_edit(key, body, &write_context(edit)).and_then(|plain| Body::from_wire(&plain).ok()) {
                Some(b) => {
                    store.bodies.insert(id, b);
                    store.opened.entry(*entry).or_default().push(id);
                    store.files_at = OnceLock::new();
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
            // a schema or lens entry's creation holds the schema or the lens itself, and fits where it is one of its
            // type: what its readers read into its vault's lane where it acted for that vault (`State::lane_of`)
            if h.ty.of_lane() {
                r.blobs.insert(*id, b.content.as_slice().into());
                if !lane_fits(&h.ty, &b.content) {
                    r.unfit.insert(*id);
                }
            }
        }
        r.tags.insert(*id, b.tags.clone());
        if let Some(p) = &b.proof {
            r.proofs.insert(*id, p.clone());
        }
        if let Some(g) = &b.defines {
            r.defines.insert(*id, g.clone());
        }
    }
    // the cap groups in force follow from what the device counts (`show_items`)
    r.groups = std::mem::take(&mut store.readings.groups);
    store.readings = r;
}

/// What a schema or lens entry of type `ty` holds, `blob`, is one of its type: a schema (`lens::Schema`) for a schema
/// entry, a lens (`lens::Lens`) for a lens entry. Only then does its creation fit, and put it in its vault's lane.
fn lane_fits(ty: &Sym, blob: &[u8]) -> bool {
    match ty.as_str() {
        SCHEMA_TYPE => Schema::parse(blob).is_some(),
        LENS_TYPE => Lens::parse(blob).is_some(),
        _ => false,
    }
}

/// The slice share `of`'s selector holds (`slice::Select`), opened with the keys `keys`: `Ok(None)` while none of its
/// boxes goes to a key held, `Err` if it never opens: it is garbled, a box for a key held doesn't open, or what that
/// opens doesn't, or, for a steward of the vault it is over (`steward`), no box goes to any seed of that vault.
fn open_select(of: &Share, keys: &Keyring, steward: bool) -> Result<Option<Slice>, ()> {
    let (boxes, sealed) = match Select::from_wire(&of.select).map_err(drop)? {
        Select::Clear(slice) => return Ok(Some(slice)),
        Select::Sealed { boxes, slice, .. } => (boxes, slice),
    };
    let id = keys::edit_key(&sealed).ok_or(())?;
    let to_over = |b: &&KeyBox| matches!(b.to.name(), KeyName::Scoped(KeyFam::Seed(v), _) if v == of.over);
    if steward && !boxes.iter().any(|b| to_over(&b)) {
        return Err(());
    }
    for b in &boxes {
        let Recipient::Key { name, id: under } = b.to else { continue };
        let Some(with) = keys.get(&under, name) else { continue };
        let key = keys::open(&b.bytes, with, &share_select_info(of, id, &b.to)).filter(|k| k.id() == id).ok_or(())?;
        let plain = keys::open_edit(&key, &sealed, &share_context(of)).ok_or(())?;
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
        if !st.entitled(d, KeyFam::Audience(en.vault, en.audience())) {
            continue;
        }
        let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
        // every wrap of the entry in one edit, one signature however many writes it had (`Wraps.lean`)
        let mut wraps = vec![];
        let mut seen = HashSet::new();
        for w in st.entry_writes(en.id).filter(|w| w.stay != en.stay()) {
            let name = w.key();
            if !seen.insert(name) {
                continue;
            }
            let linked = (0..=epoch).map(|g| KeyName::Entry(en.id, en.stay(), g)).find(|&to| st.sealed(name, to));
            let Some(to_name) = linked else { continue };
            let Some(under) = store.keys.first(to_name).cloned() else { continue };
            for secret in store.keys.held(name) {
                let id = secret.id();
                if ix.boxed.contains(&(name, id, to_name)) {
                    continue;
                }
                let to = Recipient::Key { name: to_name, id: under.id() };
                let bytes = keys::wrap(secret, &under, &box_info(name, id, &to), rng);
                wraps.push(Wrap { name, id, boxed: KeyBox { to, bytes } });
            }
        }
        if !wraps.is_empty() {
            out.push(Work::Edit(Action::Wraps { entry: en.id, wraps }));
        }
    }
    for vt in st.vaults().iter().filter(|vt| st.acts_for(d, vt.id)) {
        out.extend(steward(store, &st, vt.id));
    }
    out
}

/// What a steward of vault `v` does, once it reads the selector of every share of the vault (`Store::reads_shares`):
/// for each entry whose creation and tags it reads, it answers the asks for tags no write acting for the vault answered
/// yet, granting each its entry's readers count (`show_items`) where the asker may (`granted`), in one write acting for
/// the vault; and marks an entry no ask waits on in one mark (`policy::Meaning::mark`): with the audience its meaning
/// asks for, if it isn't there, and, once it reads the selector of every keep share over the vault too
/// (`Store::reads_keeps`), with the keep shares that pick it, if it isn't marked so. A part it has nothing to change in
/// it leaves out, so it never puts back an audience another steward changed meanwhile.
fn steward(store: &Store, st: &State, v: VaultId) -> Vec<Work> {
    if !store.reads_shares(st, v) {
        return vec![];
    }
    let marks = store.reads_keeps(st, v);
    let r = &store.readings;
    let mut out = vec![];
    for en in st.entries().iter().filter(|en| en.vault == v) {
        if !r.headers.contains_key(&en.creation) || !en.retags.iter().all(|w| r.tags.contains_key(w)) {
            continue;
        }
        let Some(m) = st.meaning_landed(en.id, r, landed_in(store, en.id)) else { continue };
        let ours = st.entry_writes(en.id).filter(|w| w.actor == v);
        let answered: HashSet<EditId> =
            ours.filter_map(|w| store.bodies.get(&w.edit)).flat_map(|b| b.answers.iter().copied()).collect();
        let asks: Vec<&Write> = st
            .entry_writes(en.id)
            .filter(|w| w.actor != v && !w.first && !answered.contains(&w.edit))
            .filter(|w| store.bodies.get(&w.edit).is_some_and(|b| !b.tags.is_empty()))
            .collect();
        if asks.is_empty() {
            if let Some((caps, wants)) = m.mark {
                let wants = wants.filter(|_| marks);
                if caps.is_some() || wants.is_some() {
                    let (keep, via) = (vec![], vec![]);
                    out.push(Work::Edit(Action::Mark { vault: v, entry: en.id, caps, wants, keep, via }));
                }
            }
            continue;
        }
        let shown = store.shown.get(&en.id).map(|s| &s.history);
        let counted = |w: &Write| shown.and_then(|h| h.get(w.edit)).is_some_and(|c| c.counted);
        let mut tags = m.attrs.tags.clone();
        for w in &asks {
            let attrs = Attrs { tags: tags.clone(), ..m.attrs.clone() };
            if counted(w) && granted(st, store, w, &attrs) {
                tags = store.bodies[&w.edit].tags.apply(&tags);
            }
        }
        let add = tags.iter().filter(|t| !m.attrs.tags.contains(t)).cloned().collect();
        let remove = m.attrs.tags.iter().filter(|t| !tags.contains(t)).cloned().collect();
        let mut answers: Vec<EditId> = asks.iter().map(|w| w.edit).collect();
        answers.sort();
        let tags = TagDelta { add, remove };
        let body = Body { header: None, tags, answers, content: vec![], proof: None, files: vec![], defines: None };
        out.push(Work::Retag { vault: v, entry: en.id, body });
    }
    out
}

/// The stewards grant what a write its readers count asks for, the tags it adds to and removes from an entry whose
/// attributes are `attrs`, which the chain of the share its proof names allows (`policy::State::lets`): where its
/// writer still holds that share, with write or more, and its slice holds the entry before the change and after it.
fn granted(st: &State, store: &Store, w: &Write, attrs: &Attrs) -> bool {
    let r = &store.readings;
    let after = Attrs { tags: store.bodies[&w.edit].tags.apply(&attrs.tags), ..attrs.clone() };
    let share = r.proofs.get(&w.edit).and_then(|p| st.share(p.share));
    share.is_some_and(|cp| {
        st.holds(w.actor, cp, Level::Write) && st.eff_selects(cp, attrs, r) && st.eff_selects(cp, &after, r)
    })
}

/// The semantic audience of an entry of vault `v` its creator, the vault, made with attributes `attrs`, by what `r`
/// reads: the live shares over `v` that aren't wide nor keep shares whose slice holds it, in canonical order
/// (`policy::Meaning::audience`).
fn semantic_audience(st: &State, v: VaultId, attrs: &Attrs, r: &Readings) -> Vec<ShareId> {
    let fits = |cp: &Issued| !cp.share.wide && !cp.share.level.is_keep();
    let picks = st.shares_over(v).filter(|cp| st.live(cp.id) && fits(cp) && st.eff_selects(cp, attrs, r));
    mk_audience(&picks.map(|cp| cp.id).collect::<Vec<_>>())
}

/// A box of `secret` for target `t`, bound to `info(recipient)`: wrapped under the target's key where the device holds
/// it (its own key, a key an owner lends it, or a key it holds), and sealed otherwise to the target's public half, a
/// signer's or an announced seed's, an X-Wing key and the McEliece blob it names, once the blob is checked against that
/// name. `None` while the device holds neither, and for a share's or an audience's key it doesn't hold: a steward boxes
/// those.
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

/// What a write that brings files into an entry needs a share it relies on to let it do, as it changes nothing its
/// readers read: set the whole record (`Lab::bring_into`, `Lab::line_files`).
fn whole() -> Touch {
    Touch::Set(Loc::root(), None)
}

/// Whether entry `e` has landed as the device holding `store` shows it (`Lab::landed`): it is no draft, which every
/// peer reads in the clear, or the history it shows lands it (`History::landed`). A device that opens none of a draft,
/// as one that keeps its ciphertext for others, counts none of it: it reads, as a relay would, whether a write on main
/// that acts for the vault itself, relying on no share, builds on its creation, as only the vault lands a draft; so it
/// still lists what it holds once the vault took it in, sealed.
fn landed_in(store: &Store, e: EntryId) -> bool {
    let st = store.view();
    if !st.is_draft(e) {
        return true;
    }
    let shown = store.shown.get(&e).map(|s| &s.history);
    if shown.is_some_and(History::landed) {
        return true;
    }
    let opened = shown.is_some_and(|h| h.changes().iter().any(|c| c.body.is_some()));
    let ours = |w: &&Write| w.shares.is_empty() || w.proposal != Proposal::Main;
    let ws: Vec<&Write> = st.entry_writes(e).filter(ours).collect();
    !opened && crate::policy::history(ws.iter(), MAIN).iter().any(|w| w.first)
}

/// Rebuild what device `d` shows of each entry whose writes, what it opened of them, its vault's lane or the cap groups
/// in force changed: first the cap groups, as the device counts the writes that say them (`State::read_groups`), as
/// every write through a share that names one is judged by them; then each entry's history, each write of its view
/// with the content of its body where the device opened it, in replay order, and the item of each line.
fn show_items(d: SignerId, store: &mut Store) {
    let (st, r, bodies) = (&store.replay.state, &store.readings, &store.bodies);
    let (reshow, opened) = (std::mem::take(&mut store.reshow), std::mem::take(&mut store.opened));
    let mut old = std::mem::take(&mut store.shown);
    if reshow {
        old.retain(|e, _| st.entry(*e).is_some());
    }
    // each vault's lane as the device reads it off the vault's schema and lens entries (`State::lane_of`), its hash,
    // and what judges the writes of the vault's entries, made once one of them is shown anew
    let mut lanes: HashMap<VaultId, (Vec<&[u8]>, [u8; 32], OnceCell<Lane>)> = HashMap::new();
    let at = Perf::start();
    for en in st.entries() {
        lanes.entry(en.vault).or_insert_with(|| {
            let blobs = st.lane_of(en.vault, r);
            let mut h = Hasher::new("lab lane");
            for b in &blobs {
                h.update(&BlobId::of(b).0);
            }
            (blobs, h.finalize(), OnceCell::new())
        });
    }
    store.perf.add("show: lanes", at);
    let at = Perf::start();
    let lane = |v: VaultId| {
        let (blobs, _, lane) = &lanes[&v];
        lane.get_or_init(|| Lane::with_built_ins(blobs.iter().copied()))
    };
    // what it shows of an entry is new where its writes, what it opened of them, its lane or the cap groups changed
    let print = |en: &Entry, groups: &[u8; 32]| {
        let mut h = Hasher::new("lab shown");
        for w in st.entry_writes(en.id) {
            h.update(&w.edit.0).update(&[bodies.contains_key(&w.edit) as u8]);
        }
        h.update(&lanes[&en.vault].1).update(groups);
        h.finalize()
    };
    // first the cap groups, as the device counts the writes that say them (`policy::State::read_groups`): the writes
    // of every cap group entry one after the other in the order they were accepted, each by the groups in force
    // before it, and where it counts and its vault writes it itself on its main line, what it says is in force past it
    let mut groups = Groups::default();
    let mut judging: HashMap<EntryId, Judging> = HashMap::new();
    let mut writes: Vec<&Write> = vec![];
    for en in st.entries().iter().filter(|en| st.is_cap_group(en, r)) {
        judging.insert(en.id, Judging::new(st, en, r, lane(en.vault)));
        writes.extend(st.entry_writes(en.id));
    }
    writes.sort_by_key(|w| st.place(w.edit));
    for w in writes {
        let j = judging.get_mut(&w.entry).expect("a cap group entry");
        if j.judge(d, st, (r, bodies), w, &groups)
            && w.actor == j.vault
            && w.proposal == Proposal::Main
            && let Some(g) = r.defines.get(&w.edit)
        {
            groups.say(w.entry, j.vault, w.edit, g);
        }
    }
    let mut h = Hasher::new("lab groups");
    for w in groups.writes() {
        h.update(&w.0);
    }
    let groups_print = h.finalize();
    store.perf.add("show: cap groups", at);
    let at = Perf::start();
    let tip = |en: &Entry| {
        let (writes, last) = st.entry_tip(en.id);
        Tip { writes, last, lane: lanes[&en.vault].1, groups: groups_print }
    };
    let cap_groups: HashSet<EntryId> = judging.keys().copied().collect();
    let mut recent: Vec<EntryId> = vec![];
    for (e, j) in judging {
        let en = st.entry(e).expect("an entry");
        old.insert(e, j.shown_on(d, print(en, &groups_print), tip(en), None));
    }
    // then every other entry, by the groups in force: anew only where its tip moved, a body of it opened, or, after a
    // removal, which writes it holds and opened changed. Where the writes only grew past those it showed, under the
    // same lanes and cap groups, only the entries of the new writes and of the bodies opened can have moved.
    let all = st.all_writes();
    let ids = |blobs: &[&[u8]]| blobs.iter().map(|b| BlobId::of(b)).collect::<BTreeSet<BlobId>>();
    let lanes_now: BTreeMap<VaultId, ([u8; 32], BTreeSet<BlobId>)> =
        lanes.iter().map(|(v, (blobs, h, _))| (*v, (*h, ids(blobs)))).collect();
    // a vault whose lane only gained schemas or lenses since: its old hash and what it gained. A write is judged by
    // the schemas it was written under alone (`Lane::fits`), so it is judged as before where it names none of them.
    let gained: HashMap<VaultId, ([u8; 32], BTreeSet<BlobId>)> = lanes_now
        .iter()
        .filter_map(|(v, (h, now))| {
            let (was, before) = store.shown_lanes.get(v)?;
            (was != h && before.is_subset(now)).then(|| (*v, (*was, now - before)))
        })
        .collect();
    let (n, last) = store.shown_writes;
    let grew = !reshow
        && (1..=all.len()).contains(&n)
        && Some(all[n - 1].edit) == last
        && store.shown_lanes.len() == lanes_now.len()
        && lanes_now.iter().all(|(v, (h, _))| gained.contains_key(v) || store.shown_lanes.get(v).is_some_and(|w| w.0 == *h))
        && store.shown_groups == groups_print;
    let todo: Vec<&Entry> = if grew {
        let changed = st.entries().iter().filter(|en| gained.contains_key(&en.vault)).map(|en| en.id);
        let mut es: Vec<EntryId> =
            all[n..].iter().map(|w| w.entry).chain(opened.keys().copied()).chain(changed).collect();
        es.sort();
        es.dedup();
        es.into_iter().filter_map(|e| st.entry(e)).collect()
    } else {
        st.entries().iter().collect()
    };
    store.shown_writes = (all.len(), all.last().map(|w| w.edit));
    store.shown_lanes = lanes_now;
    store.shown_groups = groups_print;
    for en in todo {
        if cap_groups.contains(&en.id) {
            continue;
        }
        let tip = tip(en);
        // judged under the lane before it gained schemas none of its writes name: as if under this one
        if let Some((was, new)) = gained.get(&en.vault)
            && let Some(s) = old.get_mut(&en.id)
            && s.tip.lane == *was
            && s.after.asked.is_disjoint(new)
        {
            s.tip.lane = tip.lane;
            if !reshow && s.tip == tip && !opened.contains_key(&en.id) {
                s.print = print(en, &groups_print);
                debug_assert!(same_shown(s, &judged_anew(d, st, (r, bodies), &groups, en, lane(en.vault))));
            }
        }
        let kept = old.get_mut(&en.id).filter(|s| s.tip == tip && !opened.contains_key(&en.id));
        let print = match kept {
            Some(_) if !reshow => continue,
            Some(s) => {
                let print = print(en, &groups_print);
                if s.print == print {
                    continue;
                }
                print
            }
            None => print(en, &groups_print),
        };
        if let Some(s) = old.get_mut(&en.id).filter(|s| s.print == print) {
            s.tip = tip;
            continue;
        }
        // writes that only came after those it judged, judged on where it left off: what judging all of them makes
        let writes: Vec<&Write> = st.entry_writes(en.id).collect();
        // a body it opened of a write it judged before changes what it judged: all are judged again then
        let resumes = |s: &Shown| {
            let (was, now) = (s.tip, tip);
            let new = |id: &EditId| writes[was.writes..].iter().any(|w| w.edit == *id);
            !reshow
                && (was.lane, was.groups) == (now.lane, now.groups)
                && was.writes > 0
                && was.writes <= writes.len()
                && Some(writes[was.writes - 1].edit) == was.last
                && opened.get(&en.id).is_none_or(|ids| ids.iter().all(new))
        };
        let (mut j, from, items) = match old.remove(&en.id) {
            Some(s) if resumes(&s) => {
                let from = s.tip.writes;
                (Judging::resume(en, r, lane(en.vault), s.history, s.after), from, Some(s.items))
            }
            _ => (Judging::new(st, en, r, lane(en.vault)), 0, None),
        };
        for w in &writes[from..] {
            j.judge(d, st, (r, bodies), w, &groups);
        }
        let s = j.shown_on(d, print, tip, items);
        debug_assert!(from == 0 || same_shown(&s, &judged_anew(d, st, (r, bodies), &groups, en, lane(en.vault))));
        recent.push(en.id);
        old.insert(en.id, s);
    }
    // only the entries judged last keep their scratch items
    let mut keep: HashSet<EntryId> = recent.iter().rev().take(SCRATCHES).copied().collect();
    let room = SCRATCHES.saturating_sub(keep.len());
    let before: Vec<EntryId> = store.scratched.iter().filter(|e| !keep.contains(e)).take(room).copied().collect();
    keep.extend(before);
    for (e, s) in old.iter_mut() {
        if s.after.scratch.is_some() && !keep.contains(e) {
            s.after.scratch = None;
        }
    }
    store.scratched = keep;
    store.perf.add("show: entries", at);
    store.shown = old;
    store.readings.groups = groups;
}

/// Entry `en`'s writes judged anew from its first, on device `d`: what judging on from where it left off must make.
fn judged_anew(
    d: SignerId,
    st: &State,
    rb: (&Readings, &HashMap<EditId, Body>),
    groups: &Groups,
    en: &Entry,
    lane: &Lane,
) -> Shown {
    let mut j = Judging::new(st, en, rb.0, lane);
    for w in st.entry_writes(en.id) {
        j.judge(d, st, rb, w, groups);
    }
    let tip = Tip { writes: 0, last: None, lane: [0; 32], groups: [0; 32] };
    j.shown_on(d, [0; 32], tip, None)
}

/// Two showings of an entry show the same: the same writes, judged alike, and the same record on each line.
fn same_shown(a: &Shown, b: &Shown) -> bool {
    a.history.changes() == b.history.changes()
        && a.items.keys().eq(b.items.keys())
        && a.items.iter().zip(&b.items).all(|((_, x), (_, y))| x.record() == y.record())
}

/// The writes of one entry as a device judges them, one after the other in the order they were accepted, each on what
/// came before it (`show_items`): the history they make, the scratch item it reads them on, and the entry's attributes
/// before the next write, as `policy::State`'s counting reads them (`policy::At`).
struct Judging<'a> {
    vault: VaultId,
    /// A schema or lens entry, whose creation holds the schema or the lens itself, no update.
    of_lane: bool,
    lane: &'a Lane,
    history: History,
    scratch: Option<Scratch>,
    attrs: Option<Attrs>,
    /// Whose each row is, by the writes counted so far (`policy::Mine`).
    mine: crate::policy::Mine,
    /// The writes each line's item imported, where it is judged on from an earlier showing.
    imported: BTreeMap<Line, HashSet<EditId>>,
    /// The schemas it looked up in the lane: a lane that only gained others judges its writes as this one did.
    asked: BTreeSet<BlobId>,
}

impl<'a> Judging<'a> {
    fn new(st: &State, en: &Entry, r: &Readings, lane: &'a Lane) -> Judging<'a> {
        let of_lane = r.headers.get(&en.creation).is_some_and(|h| h.ty.of_lane());
        let attrs = st.first_attrs(en, r);
        let mine = Default::default();
        let (imported, asked) = (BTreeMap::new(), BTreeSet::new());
        let history = History::default();
        Judging { vault: en.vault, of_lane, lane, history, scratch: None, attrs, mine, imported, asked }
    }

    /// Judging on from where judging the writes of `history` left off, `after`.
    fn resume(en: &Entry, r: &Readings, lane: &'a Lane, history: History, after: After) -> Judging<'a> {
        let of_lane = r.headers.get(&en.creation).is_some_and(|h| h.ty.of_lane());
        let After { scratch, attrs, mine, imported, asked } = after;
        Judging { vault: en.vault, of_lane, lane, history, scratch, attrs, mine, imported, asked }
    }

    /// Judge the next write of the entry, `w`, on device `d`, by what it reads (`r`), the bodies it opened, and the cap
    /// groups `groups` holds: whether it counts. It counts where what it builds on counts, it fits the schemas the
    /// entry was written under, its shares let it through, by its proof, what it touches and the tags it asks for
    /// (`policy::State::lets`), a merge into main through a share builds on the vault's accept (`History::passes`,
    /// M2), and a write on main through a share is of an entry that landed (`History::lands`), as only the vault lands
    /// a draft: the first two read off it on one scratch item (`History::reading_on`); but a schema or lens entry's
    /// creation holds the schema or the lens itself, no update, and fits where it is one of its type (`lane_fits`).
    fn judge(
        &mut self,
        d: SignerId,
        st: &State,
        (r, bodies): (&Readings, &HashMap<EditId, Body>),
        w: &Write,
        groups: &Groups,
    ) -> bool {
        let none = TagDelta::default();
        let Judging { vault, of_lane, lane, history, scratch, attrs, mine, asked, .. } = self;
        let body = bodies.get(&w.edit);
        let (proof, content) = (body.and_then(|b| b.proof.as_ref()), body.map(|b| &b.content[..]));
        let asks = body.map(|b| &b.tags).unwrap_or(&none);
        let counts = |d: &EditId| history.get(*d).is_some_and(|c| c.counted);
        let read = w.deps.iter().all(counts).then(|| match *of_lane && w.first {
            true => Reading { touches: Some(vec![Touch::Create]), adds: vec![], fits: !r.unfit.contains(&w.edit) },
            false => {
                let read = history.reading_on(scratch, w, content, d, lane);
                asked.extend(scratch.iter().flat_map(|s| s.authored()));
                read
            }
        });
        let fits = read.as_ref().is_none_or(|r| r.fits);
        let at = At { attrs: attrs.as_ref(), place: st.place(w.edit), groups };
        let counted = read.as_ref().is_some_and(|r| {
            let marked = r.touches.as_deref().map(|ts| mine.mark(w.actor, ts));
            r.fits
                && st.lets(w, proof, marked.as_deref(), asks, at)
                && history.passes(w, r.touches.as_deref())
                && history.lands(w)
        });
        let adds = read.as_ref().map(|r| r.adds.clone()).unwrap_or_default();
        mine.note(w, &adds, counted);
        // what it touches and asks for, as a merge that brings it in reads it
        let touches = read.and_then(|r| r.touches).map(|ts| ts.into_iter().chain(rules::asked(asks)).collect());
        let change = Change { write: w.clone(), body: content.map(<[u8]>::to_vec), fits, touches, counted, adds };
        history.push(change).expect("the view's writes are causally closed");
        // its tags count from now on where it acts for the vault
        if !w.first
            && w.actor == *vault
            && let (Some(a), Some(b)) = (attrs.as_mut(), body)
        {
            a.tags = b.tags.apply(&a.tags);
        }
        counted
    }

    /// What device `d` shows of the entry once it judged every write, with the print `print`: its history, and the item
    /// on each line. No item on main for a draft its vault hasn't landed: its main line holds nothing yet, whatever a
    /// write of the vault's own on main beside it holds.
    ///
    /// The items `items` it showed before are grown by the updates of each line's history they didn't import, as
    /// building them again would make them, Loro taking updates in any order.
    fn shown_on(self, d: SignerId, print: [u8; 32], tip: Tip, items: Option<BTreeMap<Line, Item>>) -> Shown {
        let Judging { history, scratch, attrs, mine, imported: mut was, asked, .. } = self;
        let mut old = items.unwrap_or_default();
        let landed = history.landed();
        let (mut items, mut imported) = (BTreeMap::new(), BTreeMap::new());
        for l in history.lines().into_iter().filter(|l| *l != MAIN || landed) {
            let changes = history.history(l);
            let held = was.remove(&l).unwrap_or_default();
            let item = match old.remove(&l) {
                Some(mut item) => {
                    for c in changes.iter().filter(|c| !held.contains(&c.write.edit)) {
                        crate::history::import_change(&mut item, c);
                    }
                    Some(item)
                }
                None => crate::history::build_from(&changes, d, l),
            };
            if let Some(item) = item {
                items.insert(l, item);
                imported.insert(l, changes.iter().map(|c| c.write.edit).collect());
            }
        }
        Shown { history, items, print, tip, after: After { scratch, attrs, mine, imported, asked } }
    }
}

/// What `was`, the replay of `held`, says once `edit` steps on it, where that is the replay of `held` and `edit`: a write
/// device `on` authored, deeper than every edit held, so it sorts last, and no removal, so it cuts nothing before it
/// and no removal's standing turns on it (`policy::replay`). None for any other edit, or one `was` refuses.
fn stepped_on(was: &State, held: &[Edit], on: SignerId, edit: &Edit) -> Option<State> {
    let last = held.iter().all(|e| e.depth < edit.depth);
    if edit.author != on || !matches!(edit.action, Action::Write { .. }) || edit.is_removal() || !last {
        return None;
    }
    let mut state = was.clone();
    state.step_mut(edit, edit.id()).ok()?;
    Some(state)
}

/// A vault of kind `kind` takes a device by a claim (`Lab::claim`, `Lab::accept_claim`): a device vault, an agent's or
/// a worker's, or an aven, whose device is its server (Samuel 2026-10-18: an aven lives on its server).
fn claimable(kind: Kind) -> bool {
    matches!(kind, Kind::DeviceVault | Kind::Aven)
}
