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
//! box its standing `Keys` edits hold for a key it has and every key published in the clear, and derives each entry key
//! it holds under an audience key it holds: its key now as it derives it, the key of a write or a link as a body or a box
//! asks for it (`keys::entry_key`, `entry_key_of`). For each
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
//! blob. Every edit is signed with ML-DSA-65, or was signed in SLH-DSA before the fork and counts by the legacy anchor
//! (`legacy`), so every
//! device counts every edit that stands, and trusts no curve.
//! Devices sync by what each holds of each log and the vaults each follows (`follow`), gossip one digest per log in
//! random orders, and go offline and come back; a device restored from a backup forks from what it made since
//! (`forks`), and follows what it followed.
//!
//! A vault's schemas and lenses are entries of its own, of the types schema and lens, each holding its JSON alone
//! (`add_schema`); the vault shares them with everyone, by a read share it issues before its first. Its lane is what a
//! device reads off those of them the vault created itself and the device counts (`lane_of`): what it reads and judges
//! the vault's entries by.

#[path = "bootstrap_dependencies.rs"]
mod bootstrap_dependencies;

#[path = "entry_base.rs"]
mod entry_base;
pub use entry_base::{AuthenticatedEntryBaseEnvelope, PreparedEntryBase, RestoredOwnerJudgment};

#[path = "entry_offer.rs"]
mod entry_offer;
pub use entry_offer::EntryBaseOffer;

/// The policy replay a stored view holds: older engines put a materialization adjunct after it, behind a header,
/// which no engine reads any more (P6, `EntryState.lean`: a device keeps its history and its stored view, nothing else).
fn view_replay(bytes: &[u8]) -> Option<&[u8]> {
    const ADJUNCT: &[u8] = b"avenDB own materialization 1\n";
    let bytes = view_parts(bytes)?.0;
    let Some(rest) = bytes.strip_prefix(ADJUNCT) else { return Some(bytes) };
    let (n, rest) = rest.split_first_chunk::<4>()?;
    rest.get(..u32::from_be_bytes(*n) as usize)
}

/// What a stored view holds beside its replay, behind a header: what its device read (`stored_readings`).
const VIEW_READ: &[u8] = b"avenDB view and readings 1\n";

/// A stored view's replay, and what its device read where it holds that (`VIEW_READ`).
fn view_parts(bytes: &[u8]) -> Option<(&[u8], Option<&[u8]>)> {
    let Some(rest) = bytes.strip_prefix(VIEW_READ) else { return Some((bytes, None)) };
    let (n, rest) = rest.split_first_chunk::<4>()?;
    let (replay, read) = rest.split_at_checked(u32::from_be_bytes(*n) as usize)?;
    Some((replay, Some(read)))
}

#[path = "lab/blind_index.rs"]
mod blind_index;
#[path = "lab/bodies.rs"]
mod bodies;
#[path = "lab/stored_readings.rs"]
mod stored_readings;
pub(crate) use bodies::BodyOf;
use bodies::{Bodies, Opener, StoreBodies};
#[path = "lab/held.rs"]
pub(crate) mod held;
mod shown_map;
use shown_map::{Closed, ShownMap};
pub use held::{Placed, ShelfFile, Spill};
#[cfg(test)]
#[path = "lab/query_coverage.rs"]
mod query_coverage;

use std::borrow::Cow;
use std::cell::OnceCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};

use rand_core::Rng as _;
use serde_json::Value;
use zeroize::Zeroizing;

use crate::batch::{self, SignerLog};
use crate::doc::{Item, Version};
use crate::encode::{self, box_info, share_context, share_select_info, write_context};
use crate::gate;
use crate::hash::{Hasher, Reader};
use crate::history::{Change, Draft, History, MAIN, Reading, Scratch};
use crate::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{self, KeyBox, KeyFam, KeyId, KeyName, PublicKey, Recipient, Secret, SeededRng};
use crate::lens::{self, Lane, Lens, Schema, View};
use crate::merge;
use crate::ops::Loc;
use crate::perf::Perf;
use crate::query_view::{self, QueryViews};
use crate::policy::{
    Action, At, Creation, Edit, Entry, Groups, Issued, KeepMode, Kind, Level, Line, Log, Meaning, Principal, Proposal,
    Readings, Refusal, Replay, ReplayRun, Share, Sharing, State, TailRun, Who, Why, Wrap, Write, covered,
    mk_audience, replay, replay_on, replay_on_or, replay_on_why, rewind,
};
use crate::recovery::RecoveryKey;
use crate::rules::{self, Grant, Op, Proof, Touch};
use crate::sealed::{Brought, FileRoot};
use crate::sign::{
    self, ApiPass, Ceremony, DeviceKey, EnclaveKey, Hello, Passkey, RelayPass, Signature, Signed, SignerKeys, WebAuthn,
};
use crate::slice::{
    Attrs, Body, CAP_GROUP_TYPE, Header, LENS_TYPE, SCHEMA_TYPE, Select, Selector, Slice, Sym, TagDelta,
};
use crate::sync::{
    LogId, Place, Stub, answer_by_log, asks_with_stubs, beyond, digests_ids, forks_in, link_places, log_of, logs_of, vault_places,
};
use crate::wire::{Claim, FileHold, Frontier, Join, Request, Statement, Wire as _};
#[cfg(test)]
use crate::sync::asks_ids;
use crate::world;

/// The ids of the edits of `log` of the logs of `vs` and of every vault that owns one of them, up the chains, as `st`
/// knows them (`sync::vault_places`): what a contact card carries.
fn vault_ids(log: &Log, st: &State, vs: Vec<VaultId>) -> Vec<EditId> {
    vault_places(log.edits(), log.ids(), st, vs).into_iter().map(|i| log.ids()[i]).collect()
}

/// A device keeps its keys and audiences up to date in a few rounds at most: one to make and seal keys and move
/// entries, one to seal the keys of the audiences they moved to and link their history, one to answer what moved, one
/// to find nothing left. More means an edit the rules refuse, made again and again.
const ROUNDS: usize = 10;

/// The entries due for upkeep a refresh looks at, at most (`UpkeepDue`): those it leaves wait for the next one, each
/// costing as much as its writes, so that a refresh costs what changed, whatever the device holds.
const UPKEEP_SLICE: usize = 64;

/// The edits a step of a catch-up replays for each entry of its budget (`Lab::catch_up_step`, `step_replay`): a step
/// replays about as long as it shows.
const REPLAY_WORK: usize = 4;

/// The edits a step of a catch-up adds to its key index for each entry of its budget, where the index is made again
/// (`KeyIndexed::step`).
const INDEX_WORK: usize = 32;

/// The bodies a step of a catch-up opens for each entry of its budget (`read`).
const READ_WORK: usize = 32;

/// The budget of the step a write of a device's own takes in the middle of a catch-up (`Lab::refresh_own`).
const OWN_WRITE_BUDGET: usize = 8;

/// The budget of the step what a device takes from a peer brings it on in the middle of a catch-up
/// (`receive_now_prepared`).
const TAKEN_BUDGET: usize = 8;


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
    Web {
        keys: SignerKeys,
        seal: (PublicKey, Arc<[u8]>),
        pair: KeyId,
    },
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

/// Edits drafted on a device one after another, each building on those drafted before it, for its passkeys to sign all
/// of them in one ceremony (`Lab::drafting`): as a person's first device founds their vault and adds itself, and the
/// first to claim a server founds avenMAIA and adds the server, in one ceremony instead of one for each edit.
pub struct Drafting<'a> {
    lab: &'a Lab,
    /// The device's log, with the edits drafted so far.
    log: Log,
    /// The replay of `log`'s edits: the device's own until a draft joins them, then stepped on with each
    /// (`policy::replay_on`). No draft replays the whole log again: a key move's checkpoint over a big vault drafted a whole replay for each edit and each look, every removal
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
        let was = std::mem::replace(&mut self.replay, Cow::Owned(replay(&[]))).into_owned();
        self.replay = Cow::Owned(replay_on(was, self.log.edits(), held));
        #[cfg(not(avendb_no_replay_checks))]
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
    /// The sum of the ids of the keys it holds (`held::key_sum`): the same for the same keys, however they came.
    sum: [u8; 32],
    /// Changes with each key it takes but an entry's: what the upkeep of every entry turns on (`UpkeepDue`).
    scoped: Arc<()>,
    /// The entries whose keys it took since the upkeep last looked (`UpkeepDue`), and since `read` last looked.
    entries_keyed: Vec<EntryId>,
    keyed_for_read: Vec<EntryId>,
    /// It took a key of an audience since `read` last looked: a body it lacked a key for may be under one it derives.
    audience_for_read: bool,
    /// The audience key the last body each author wrote under each audience that it derived the key of was under
    /// (`entry_key_of`).
    derived_by: HashMap<(SignerId, KeyName), KeyId>,
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
        held::key_sum(&mut self.sum, &id.0);
        match name {
            KeyName::Entry(e, ..) => {
                self.entries_keyed.push(e);
                self.keyed_for_read.push(e);
            }
            _ => self.scoped = Arc::new(()),
        }
        let ids = self.by_name.entry(name).or_default();
        let at = ids.partition_point(|x| *x < id);
        ids.insert(at, id);
        if let KeyName::Scoped(k, e) = name {
            self.epochs.entry(k).or_default().insert(e);
            if let KeyFam::Audience(..) = k {
                self.audiences.push(id);
                self.audience_for_read = true;
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

/// An immutable incoming page and the signature checks it needs at capture time. No authorization is
/// captured. The fields are private so callers cannot substitute bytes after verification.
pub struct ReceivePreparation {
    edits: Vec<Signed>,
    checking: Vec<usize>,
}

/// Signature results bound to the owned incoming page. Only the completing verification methods of `ReceivePreparation` create one.
pub struct PreparedReceive {
    edits: Vec<Signed>,
    signatures: HashMap<EditId, bool>,
    perf: Perf,
    /// How long checking the signatures took, and how long the thread was away between its groups (`check_cooperatively`).
    verifying: std::time::Duration,
    yielded: std::time::Duration,
}

impl PreparedReceive {
    /// How long its signature checks took, and how long a browser's one thread did other work between their groups: a
    /// page's check time is these and the wait for its turn (`check_ms`).
    pub fn spent(&self) -> (std::time::Duration, std::time::Duration) {
        (self.verifying, self.yielded)
    }
}

impl ReceivePreparation {
    /// Verify at most eight edits per turn, yielding between unfinished turns. The caller must
    /// supply an actual event-loop task yield (not a ready future or a microtask). No partial
    /// result is exposed; dropping this future discards the uncommitted owned page.
    pub async fn check_cooperatively<F, Y>(self, mut yield_turn: F) -> PreparedReceive
    where
        F: FnMut() -> Y,
        Y: std::future::Future<Output = ()>,
    {
        let mut signatures = HashMap::new();
        let mut perf = Perf::default();
        let (mut verifying, mut yielded) = (std::time::Duration::ZERO, std::time::Duration::ZERO);
        let mut chunks = self.checking.chunks(8).peekable();
        while let Some(chunk) = chunks.next() {
            let at = Perf::start();
            let began = crate::perf::now_us();
            for &i in chunk {
                let signed = &self.edits[i];
                signatures.insert(signed.edit.id(), signed.verify().is_ok());
            }
            verifying += std::time::Duration::from_micros(crate::perf::now_us().saturating_sub(began));
            perf.add("prepared signature check", at);
            perf.count("prepared signatures", chunk.len() as u64);
            if chunks.peek().is_some() {
                perf.count("prepared verification yields", 1);
                let away = crate::perf::now_us();
                yield_turn().await;
                yielded += std::time::Duration::from_micros(crate::perf::now_us().saturating_sub(away));
            }
        }
        PreparedReceive { edits: self.edits, signatures, perf, verifying, yielded }
    }

    /// Expensive pure cryptography, deliberately independent of the Lab and its current policy.
    pub fn check(self) -> PreparedReceive {
        let at = Perf::start();
        let began = crate::perf::now_us();
        let checking: Vec<_> = self.checking.iter().map(|&i| self.edits[i].clone()).collect();
        let signatures = checking.iter().zip(checked_all(&checking))
            .map(|(signed, valid)| (signed.edit.id(), valid)).collect();
        let mut perf = Perf::default();
        perf.add("prepared signature check", at);
        perf.count("prepared signatures", checking.len() as u64);
        PreparedReceive { edits: self.edits, signatures, perf, verifying: std::time::Duration::from_micros(crate::perf::now_us().saturating_sub(began)), yielded: std::time::Duration::ZERO }
    }
}

/// Whether each of `signed`'s signatures check out, in order: on every core the machine has, as each check stands
/// alone (a restore of Maia City's 18,955 edits spent 11.2 s of its 13.5 s checking them on one core, 2026-10-20); on
/// one in a browser, which has no threads to spare.
fn checked_all(signed: &[Signed]) -> Vec<bool> {
    checked_refs(&signed.iter().collect::<Vec<_>>())
}

/// `checked_all`, of the edits `signed` names.
fn checked_refs(signed: &[&Signed]) -> Vec<bool> {
    let one = |s: &&Signed| s.verify().is_ok();
    #[cfg(not(target_arch = "wasm32"))]
    {
        let cores = std::thread::available_parallelism().map_or(1, |n| n.get());
        if cores > 1 && signed.len() > 1 {
            let size = signed.len().div_ceil(cores);
            return std::thread::scope(|scope| {
                let parts: Vec<_> = signed
                    .chunks(size)
                    .map(|part| scope.spawn(move || part.iter().map(one).collect::<Vec<_>>()))
                    .collect();
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
/// The count a whole replay adds to for how far back the first edit it took since sorts (`Replay::back`): a replay
/// that could rewind that far would step on instead.
fn back_counted(back: usize) -> &'static str {
    match back {
        0..=64 => "replay whole: back 64 at most",
        65..=1024 => "replay whole: back 1k at most",
        1025..=8192 => "replay whole: back 8k at most",
        _ => "replay whole: back more than 8k",
    }
}

/// A replay of the edits a device holds run a slice a step (`Lab::step_replay`): of every edit, or of those from the
/// rung or mark before the first it took since, as far back as that is (`policy::rewind`).
enum Replaying {
    Whole(ReplayRun),
    From(TailRun),
}

impl Replaying {
    /// How many of its log's edits it is the replay of: its first.
    fn of(&self) -> usize {
        match self {
            Replaying::Whole(r) => r.of(),
            Replaying::From(r) => r.of(),
        }
    }
}

fn why_counted(why: Why) -> &'static str {
    match why {
        Why::Nothing => "replay: nothing new",
        Why::Stepped => "replay: stepped on",
        Why::Tail => "replay: last edits again",
        Why::Rung => "replay: from a rung",
        Why::Whole(why) => why,
    }
}

fn trust(store: &mut Store) -> bool {
    let vouched = store.replay.vouched(store.log.edits());
    let out: Vec<EditId> = store.bare.iter().filter(|id| !vouched.contains(id)).copied().collect();
    let mut gone = HashSet::new();
    for id in out {
        store.bare.remove(&id);
        if store.signed.get(&id).is_none_or(|s| s.verify().is_err()) {
            gone.insert(id);
        }
    }
    let signed_still = |s: &crate::sign::Signature| !s.pq.is_empty() || s.webauthn.is_some() || s.enclave.is_some();
    for id in &store.bare {
        let needs = |signed: &Signed| signed.sigs.iter().any(signed_still);
        store.signed.strip(id, needs, |signed| {
            for sig in signed.sigs.iter_mut().filter(|s| signed_still(s)) {
                sig.pq = vec![];
                sig.webauthn = None;
                sig.enclave = None;
            }
        });
    }
    if gone.is_empty() {
        return false;
    }
    store.perf.count("edits let go: unvouched", gone.len() as u64);
    store.log.let_go(&gone);
    for id in &gone {
        store.signed.remove(id);
        store.bodies.remove(id);
        store.spoilt.remove(id);
    }
    store.read_new.forget();
    store.replay = replay(&[]);
    store.replayed = 0;
    store.latest = OnceLock::new();
    store.digests = None;
    store.files_at = OnceLock::new();
    true
}

/// A device's key for what it seals on its own shelf (`Lab::shelf_key`): whoever holds the device's own key derives
/// it, and nobody else, so a stored view a shelf holds that opens with it is the device's word that it checked the
/// edits the view is of.
#[derive(Clone)]
pub struct ShelfKey(Secret);

impl ShelfKey {
    /// `bytes` encrypted for the device alone, as what `purpose` names, under `context`.
    fn lock(&self, purpose: &str, bytes: &[u8], context: &[u8], rng: &mut SeededRng) -> Vec<u8> {
        keys::encrypt(&self.0.child("shelf box", purpose.as_bytes()), bytes, context, rng)
    }

    /// What `lock` encrypted as `bytes`, if it did, as what `purpose` names, under `context`.
    fn unlock(&self, purpose: &str, bytes: &[u8], context: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
        keys::decrypt(&self.0.child("shelf box", purpose.as_bytes()), bytes, context).map(Zeroizing::new)
    }

    /// The key of entry `e`'s row in its shelf's index of kept showings (`KeptPack::rows`): the same for the entry at
    /// every save, and naming it to nobody without the key.
    fn shown_row(&self, e: &EntryId) -> [u8; 32] {
        self.0.child("kept shown row", &e.0).bytes()
    }

    /// The key of query `key`'s row in its shelf's index of kept query views (`Warming::queries`), as `shown_row`.
    fn query_row(&self, key: &str) -> [u8; 32] {
        self.0.child("kept query row", key.as_bytes()).bytes()
    }
}

/// The engine's own hash, of its sources (`build.rs`): what a device worked out with another engine it works out again.
const ENGINE: &str = env!("AVENDB_ENGINE");

/// What a device seals its stored view to (`ViewRules.lean`, `build.rs`): the number of the replay rules it was worked
/// out under, not the engine's hash, so a release that keeps the rules keeps every device's view (VR1), and one that
/// changes them names a new number, under which no older view opens (VR2).
const VIEW_RULES: &str = concat!("avenDB view rules ", env!("AVENDB_VIEW_RULES"));

/// What a device seals the showings it keeps to (`ShowRules.lean`, `build.rs`): the number of the show rules it judged
/// them under, not the engine's hash, so a release that keeps the rules keeps every device's kept showings (SR1), and one
/// that changes them names a new number, under which no older pack opens (SR2). Sealed to the engine's hash, every
/// release left them shut, and a phone's first unlock after it judged every entry anew (2026-10-28).
const SHOW_RULES: &str = concat!("avenDB show rules ", env!("AVENDB_SHOW_RULES"));

/// What a device seals what it read to, in its stored view (`StoredReadings.lean`, `build.rs`): the number of the read
/// rules, so that what a release reads otherwise of a body is read anew (RR2).
const READ_RULES: &str = concat!("avenDB read rules ", env!("AVENDB_READ_RULES"));

/// The engine's hash as a fixed-size binding, for what a device seals to the engine that made it.
pub fn engine() -> [u8; 32] {
    crate::hash::content(ENGINE.as_bytes())
}

/// The key a person's devices hand each other what they worked out with (`Lab::handing`, `Lab::start_handed`, M6):
/// derived from their passkey's seal key (`Passkey::seal_secret`), which a device derives from the PRF output of its
/// passkey's ceremony, so only a device that holds the passkey makes or opens what it locks. That passkey already signs
/// as the person's vault's owner, so a handed view trusts nobody new.
#[derive(Clone)]
pub struct HandKey(ShelfKey);

impl HandKey {
    /// The key of the passkey whose seal key is `passkey_seal`.
    pub fn of(passkey_seal: &Secret) -> HandKey {
        HandKey(ShelfKey(passkey_seal.child("hand seal", &[])))
    }
}

/// What every handed view starts with (`Lab::handing`): version 1, then how many edits it is of, their ids in the order
/// its giver took them, and its stored view of them (`Replay::to_view`).
const HANDED: &[u8] = b"avenDB handed view 1\n";

/// What `Lab::handing` locked, opened: the ids of the edits its view is of, and the view. `None` if it is no handed
/// view.
fn handed_of(bytes: &[u8]) -> Option<(Vec<EditId>, &[u8])> {
    let (n, rest) = bytes.strip_prefix(HANDED)?.split_first_chunk::<8>()?;
    let n = usize::try_from(u64::from_le_bytes(*n)).ok()?;
    let (ids, view) = rest.split_at_checked(n.checked_mul(32)?)?;
    Some((ids.chunks_exact(32).map(|id| EditId(id.try_into().expect("32 bytes"))).collect(), view))
}

/// What a change touched (`Lab::touched`): `entries` whose logs took edits, their `vaults`, or `all`; with the size
/// the device holds now and its log's removals, which the page passes as `since` next.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Touched {
    pub size: (usize, usize),
    /// How many times its log let edits go (`policy::Log::gone`).
    pub gone: u64,
    pub entries: BTreeSet<EntryId>,
    pub vaults: BTreeSet<VaultId>,
    pub all: bool,
}

impl Touched {
    /// The most entries a change names; past that it touches everything.
    pub const MOST: usize = 512;
}

/// What a device keeps on its shelf of what it worked out, to start again from it quickly (`Lab::restore_warm`), each
/// the newest first, as `Lab::warming` gave it, encrypted for it alone: its keys, for any engine, which hold the keys it
/// opened from their boxes and what its shelf names the edits it checked by (`Checked`); and its stored views, for this
/// replay rules alone (`VIEW_RULES`), each its replay of the edits its log started with (`Replay::to_view`). It vouches for
/// nothing it doesn't check: a key counts only for the very box it opened, with the key it opens it with now, and where
/// its id is the one that box names; the edits only where its shelf names them the same now; and a view only where it
/// reads back whole and is of the very edits its log starts with (`Replay::from_view`).
#[derive(Clone, Debug, Default)]
pub struct Warm {
    pub keys: Vec<Vec<u8>>,
    pub views: Vec<Vec<u8>>,
    /// The packs of kept showings its shelf's index of them names (`Warming::shown`), each with the rows that name it:
    /// a showing is taken from the pack its entry's row names, and from no other.
    pub shown: Vec<PackFile>,
    /// The packs of kept query views its shelf's index of them names (`Warming::queries`), as `shown`.
    pub queries: Vec<PackFile>,
}

/// A pack of kept showings or query views as a shelf holds it (`Warm::shown`, `Warm::queries`): the file it is, read
/// where it is as the showings it holds open (`shown_map::unpack`), or its bytes; and the rows of the shelf's index that
/// name it (`KeptPack::rows`), whose entries' showings or queries' views it is taken for. With none named (a pack given
/// as bytes alone), every one it holds is taken, a later pack's in place of an earlier one's, and none counts as kept
/// on the shelf.
#[derive(Clone, Debug)]
pub struct PackFile {
    pub file: Arc<dyn crate::pages::Space>,
    pub rows: Option<Vec<[u8; 32]>>,
}

impl From<Vec<u8>> for PackFile {
    fn from(bytes: Vec<u8>) -> PackFile {
        PackFile { file: Arc::new(crate::pages::MemorySpace::of(bytes)), rows: None }
    }
}

impl From<KeptPack> for PackFile {
    fn from(kept: KeptPack) -> PackFile {
        PackFile { file: Arc::new(crate::pages::MemorySpace::of(kept.pack)), rows: Some(kept.rows) }
    }
}

/// The showings or query views a save keeps (`Warming::shown`, `Warming::queries`): a pack of them, encrypted for the
/// device alone, to go on its shelf as a blob; the key of each one's row in the shelf's index of them, which names the
/// pack from then on (`ShelfKey::shown_row`, `ShelfKey::query_row`), in place of whatever pack it named before; and the
/// log head they were worked out at, which the index is stamped with.
#[derive(Clone, Debug)]
pub struct KeptPack {
    pub pack: Vec<u8>,
    pub rows: Vec<[u8; 32]>,
    pub head: crate::log_head::Head,
}

/// A restore a page at a time under way (`Lab::restore_start`): how many of the first edits it restores its shelf names
/// it checked, how many it took so far, and those whose signatures didn't check out, which a later page's checkpoint
/// may hold on its word yet.
pub struct Restoring {
    /// Its keys name the edits its shelf's head holds as their shelf names them (`restore_start`).
    matched: bool,
    vouch: usize,
    taken: usize,
    /// Of the edits it took so far, how many it held on its shelf's word and how many it checked the signatures of.
    vouched: usize,
    checked: usize,
    doubtful: Vec<Signed>,
    /// The McEliece keys its edits name that didn't come with their pages (`Lab::restore_wants`).
    wanting: HashSet<BlobId>,
}

impl Restoring {
    /// Whether its keys named the head its shelf started from (`Lab::restore_start`), how many edits it held on their
    /// word, and how many it checked the signatures of: what its person reads of where its shelf's step went.
    pub fn checks(&self) -> (bool, usize, usize) {
        (self.matched, self.vouched, self.checked)
    }
}

/// How a restore went (`Lab::restore_report`): the edits it held, the stored view it started from or why none, the
/// packs of kept showings that opened and those that didn't, and the showings they held.
#[derive(Clone, Debug)]
struct Restored {
    edits: usize,
    view: ViewOpened,
    kept: (usize, usize),
    showings: usize,
}

/// The stored view a restore started from (`restore_end_with`): one of the first `held` edits of its log; none on its
/// shelf; `n` none of which opens for these replay rules with its shelf key; `n` of which some open but none is of the
/// edits its log starts with; or none, as it was locked.
#[derive(Clone, Copy, Debug)]
enum ViewOpened {
    Of { held: usize },
    NoneKept,
    NoneOpens(usize),
    NoneOfThese(usize),
    Locked,
}

/// What of `Warm` a device's shelf lacks (`Lab::warming`), for its shelf to take, and what it is of, for `Lab::warmed`.
pub struct Warming {
    pub keys: Option<Vec<u8>>,
    pub view: Option<Vec<u8>>,
    /// The showings its shelf lacks, a pack of them and their rows (`ShownView.lean`).
    pub shown: Option<KeptPack>,
    /// The query views its shelf lacks (`query_view`), a pack of them and their rows, sealed to this engine.
    pub queries: Option<KeptPack>,
    // Process-local receipt binding: no replacement store, lock, withdrawal or earlier acknowledgement may
    // make its counts describe a different key prefix or view. Appending edits alone keeps this receipt valid.
    revision: Arc<()>,
    /// The head of its log as it captured it: an acknowledgement counts only while the log goes on from it.
    head: crate::log_head::Head,
    keys_of: Option<(Option<Checked>, usize)>,
    /// The head of the edits its view is of, the stamp its shelf keeps it under (`Log::head_at`), with how many times
    /// its store had replayed every edit then; and whether the view holds what it read (`stored_readings::seal`).
    view_of: Option<(crate::log_head::Head, u64)>,
    view_read: bool,
    /// The prints of the showings its pack holds, by entry, and the log head they were judged at.
    shown_of: Option<(Vec<(EntryId, [u8; 32])>, crate::log_head::Head)>,
    /// The queries whose views its pack holds, each with the stamp it is of.
    queries_of: Option<Vec<(String, query_view::Stamp)>>,
}

impl Warming {
    /// The head of the edits its view is of, if it gives one: the stamp its shelf keeps the view under.
    pub fn view_head(&self) -> Option<crate::log_head::Head> {
        self.view_of.map(|(head, _)| head)
    }
}

/// Immutable snapshot inputs, owned independently of Lab. Encoding consumes the keys
/// and private RNG; dropping an unencoded capture acknowledges nothing.
pub struct WarmCapture {
    key: ShelfKey,
    rng: SeededRng,
    opened: Option<Vec<([u8; 32], Secret)>>,
    replay: Option<crate::policy::ViewCapture>,
    /// What it read of the edits its view is of, sealed beside it (`stored_readings::seal`), where it read them all.
    read: Option<Vec<u8>>,
    /// The showings to keep, each its entry's, print and bytes (`Shown::record`), to seal one by one
    /// (`shown_map::pack`).
    shown: Option<Vec<(EntryId, [u8; 32], Zeroizing<Vec<u8>>)>>,
    /// The query views to keep, each in its pack bytes (`QueryViews::due`).
    queries: Option<Vec<Vec<u8>>>,
    receipt: Warming,
}
impl WarmCapture {
    pub fn encode(mut self) -> Warming {
        if let Some(opened) = self.opened.take() {
            let checked = self.receipt.keys_of.and_then(|(checked, _)| checked);
            let mut bytes = Zeroizing::new(match checked {
                Some(checked) => [&[1][..], &checked].concat(),
                None => vec![0],
            });
            for (box_id, key) in opened {
                bytes.extend(box_id.iter().copied().chain(key.bytes()));
            }
            self.receipt.keys = Some(self.key.lock("keys", &bytes, b"stored keys", &mut self.rng));
        }
        if let Some(replay) = self.replay.take() {
            let of = self.receipt.view_of.map_or(0, |(head, _)| head.at as usize);
            let mut bytes = Zeroizing::new(replay.encode(of));
            if let Some(read) = self.read.take() {
                let mut both = Zeroizing::new(VIEW_READ.to_vec());
                both.extend((bytes.len() as u32).to_be_bytes());
                both.extend(bytes.iter());
                both.extend(read);
                bytes = both;
            }
            self.receipt.view = Some(self.key.lock("view", &bytes, VIEW_RULES.as_bytes(), &mut self.rng));
        }
        if let (Some(shown), Some((_, head))) = (self.shown.take(), &self.receipt.shown_of) {
            let rows = shown.iter().map(|(e, _, _)| self.key.shown_row(e)).collect();
            let pack = shown_map::pack(&self.key, &mut self.rng, &shown);
            self.receipt.shown = Some(KeptPack { pack, rows, head: *head });
        }
        if let (Some(queries), Some(of)) = (self.queries.take(), &self.receipt.queries_of) {
            let rows = of.iter().map(|(key, _)| self.key.query_row(key)).collect();
            let head = of.first().map_or(crate::log_head::head(&[]), |(_, stamp)| stamp.head);
            let pack = self.key.lock("query views", &queries.concat(), ENGINE.as_bytes(), &mut self.rng);
            self.receipt.queries = Some(KeptPack { pack, rows, head });
        }
        self.receipt
    }
}

/// The most askers and askings a device keeps what it worked out for (`Answers`): past them it starts over.
const ANSWERS_KEPT: usize = 256;

/// Narrow a sync reply after the ordinary authorization decision. Scope never grants access and is not a claim
/// that the requester holds anything. Older network requests express the same restriction with loose edit IDs.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub enum ReplyScope {
    #[default]
    All,
    Logs(BTreeSet<LogId>),
    Vaults(BTreeSet<VaultId>),
}

/// What a device worked out of its edits for its peers' syncs, while its edits stay as they were (Samuel's iPhone
/// 2026-10-22, a page every 9 s): its frontiers, and, for each asking a peer makes page after page with the same
/// request, the places of all it sends, in order (`Lab::reply`). Which edits an asker may receive needs no keeping: the
/// log keeps each log's places as edits arrive (`Log::by_log`). Each is kept with the head of its log (`Log::head`),
/// checked in constant time: a log of other edits, a checkpoint withdrawal or a restore of the same length among them,
/// has another head, and a log of the same edits works out the same.
#[derive(Default)]
struct Answers {
    basis: std::sync::Mutex<Option<Arc<RequestBasis>>>,
    #[cfg(test)]
    basis_builds: std::sync::atomic::AtomicUsize,
    sends: std::sync::Mutex<HashMap<(SignerId, [u8; 32], ReplyScope), (crate::log_head::Head, Arc<ReplyPlan>)>>,
    /// The writers `Lab::writers_shown` names to each peer, kept for the log's head and the follow list.
    writers: std::sync::Mutex<HashMap<SignerId, (crate::log_head::Head, Vec<VaultId>, Arc<BTreeSet<SignerId>>)>>,
    /// What the removals its catch-up hasn't replayed yet may take away (`Lab::cuts`), for the log's head and how
    /// far its replay is.
    cuts: std::sync::Mutex<Option<(crate::log_head::Head, usize, Arc<Cuts>)>>,
    /// What each asker is answered (`Lab::answered`), by the asker and the vaults it follows: stamped with the head of
    /// the log it was worked out of and how far the replay it was worked out by is.
    answered: std::sync::Mutex<HashMap<(SignerId, Vec<VaultId>), (crate::log_head::Head, usize, Arc<Answered>)>>,
    /// Where the edits name each McEliece key and file (`Named`), stamped with the head of the log it indexes.
    named: std::sync::Mutex<Option<Arc<Named>>>,
}

/// What a device answers one asker (`Lab::answered`): the places of the edits it sends, and their logs. It sends a log
/// whole or none of it, so a place is answered exactly when its log is among `logs`.
struct Answered {
    places: Arc<Vec<usize>>,
    logs: HashSet<LogId>,
}

/// Where a device's edits name each McEliece key and each file (`Lab::may_fetch`, `Lab::may_fetch_file`), as places
/// in its log, the first `head.at` of them: the key gate looks up the few edits that name what it is asked for, not
/// every edit an asker may receive (2.3-2.5 s a call on the always-on peer, 2026-10-29). Kept as the log appends,
/// worked out anew once its first `head.at` edits are no longer those it indexed (`Log::head_at`).
#[derive(Clone)]
struct Named {
    head: crate::log_head::Head,
    /// The edits that name each McEliece key (`Edit::blobs`).
    blobs: HashMap<BlobId, Vec<usize>>,
    /// The writes that bring each file (`Edit::files`).
    files: HashMap<FileRoot, Vec<usize>>,
    /// The snapshots whose state of an entry travels as each file (`Edit::stated`), with that entry.
    stated: HashMap<FileRoot, Vec<(usize, EntryId)>>,
    /// The files the writes bring, by their root's hash.
    by_hash: HashMap<[u8; 32], BTreeSet<FileRoot>>,
}

impl Named {
    fn of(log: &crate::policy::Log) -> Named {
        let mut named = Named {
            head: log.head_at(0).expect("an empty prefix"),
            blobs: HashMap::new(),
            files: HashMap::new(),
            stated: HashMap::new(),
            by_hash: HashMap::new(),
        };
        named.extend(log);
        named
    }

    /// The same, of the edits `log` appended since.
    fn extend(&mut self, log: &crate::policy::Log) {
        for (i, edit) in log.edits().iter().enumerate().skip(self.head.at as usize) {
            for b in edit.blobs() {
                self.blobs.entry(b).or_default().push(i);
            }
            for f in edit.files() {
                self.files.entry(*f).or_default().push(i);
                self.by_hash.entry(f.hash).or_default().insert(*f);
            }
            for x in edit.stated() {
                self.stated.entry(x.slice).or_default().push((i, x.entry));
            }
        }
        self.head = log.head();
    }
}

/// What the removals among a device's edits that its replay hasn't reached may take away from a peer it answers in
/// the middle of its catch-up (`Lab::standing_for`, `StandingKeep.lean`): a device's removal takes away the device,
/// and every act for a vault it signed that the removal doesn't keep (`Revoking::keep`), which falls with it. A signed
/// act counts whether or not it would fall: more held back, never less.
#[derive(Default, Debug)]
struct Cuts {
    /// A removal that may take anything from anyone: of an owner, a grant or a root, or of a device that signed an
    /// act it doesn't keep that may change where an entry stands or what a share or an audience holds (a creation, a
    /// mark, a grant, a claim, an audience's keys), on which any peer's standing may rest.
    all: bool,
    /// The devices removed: what is theirs goes.
    removed: HashSet<SignerId>,
    /// The entries' logs that hold a write (not a creation), keys or wraps a removed device signed that its removal
    /// doesn't keep: what a peer may be handed of them may change, and of no other log.
    logs: HashSet<LogId>,
}

/// An edit that rests on its signer being a member of a vault, acting for it: a write, a mark, a grant issued or
/// revoked, a claim, a key's boxes or wraps (which only a signer that may open the key gives). Not governance, which a
/// vault's root or owners approve (`State::approves`), nor a checkpoint or a snapshot, which they give.
fn acts(action: &Action) -> bool {
    match action {
        Action::Write { .. } | Action::Mark { .. } | Action::Claim { .. } | Action::Keys { .. } | Action::Wraps { .. } => true,
        Action::Share(Sharing::Grant(..)) | Action::Revoke(crate::policy::Revoking::Grant { .. }) => true,
        Action::Genesis { .. } | Action::Settings { .. } | Action::Share(_) | Action::Revoke(_) => false,
        Action::Checkpoint { .. } | Action::Snapshot { .. } => false,
    }
}

/// Disposable structural work, shared across peers only while the exact held edits/IDs stay unchanged.
/// It contains NO permission decision, follow list, available-key state or persisted authority.
struct RequestBasis {
    head: crate::log_head::Head,
    ask: crate::sync::Ask,
}

/// A device's first sync with the boxes held back (`lazy`, `LazyBoxes.lean`): it asks its peer for the stubs of the box
/// edits it needs not now (`Lab::withheld`), counts them as held in each log's closed part and frontier when it asks
/// (`sync::asks_with_stubs`), and so is sent every edit but those; then, asked to (`Lab::fetch_withheld`), asks as any
/// device does, is sent their bodies, and checks each against its stub as it takes it (S5). A stub enters nothing it
/// knows, and opens nothing (S1, S4): only what it asks for.
#[derive(Default)]
struct LazyBoxes {
    /// It asks for stubs in its first syncs.
    on: bool,
    /// It asks for the bodies of its stubs: they no longer count as held.
    fetching: bool,
    /// Its stubs whose bodies it holds not, each with the peer that sent it.
    stubs: BTreeMap<EditId, (crate::sync::Stub, SignerId)>,
    /// The bodies that came of a stub that lied about them, each with the peer that sent the stub.
    liars: Vec<(SignerId, EditId)>,
    /// How many stubs it took in all.
    taken: usize,
    /// The stubs whose bodies an asking for them didn't bring, of the peer that sent them (`drop_unanswered`).
    unanswered: Vec<(crate::sync::Stub, SignerId)>,
}

/// The ordered edits and authorized explicit key requests for one asking. The first page works both out;
/// subsequent pages do work proportional to their output, without scanning all authorized history for keys.
struct ReplyPlan {
    places: Vec<Place>,
    wanted: Vec<BlobId>,
}

/// Where a reply page that starts at `from` of `places` ends (exclusive): as many edits as fit in `page` bytes on the
/// wire, and at least one; true if more are left. One cut for `Lab::reply_in` and `Lab::reply_cuts`, so a pull that
/// asks pages ahead by their cuts asks exactly the pages it would have asked one after the other.
fn page_end(store: &Store, places: &[Place], from: usize, page: usize) -> (usize, bool) {
    let mut size = 0usize;
    for (i, (_, id)) in places.iter().enumerate().skip(from) {
        size = size.saturating_add(store.signed.owned(id).to_wire().len());
        if size > page && i > from {
            return (i, true);
        }
    }
    (places.len(), false)
}

/// Conservative encoded-size upper bound for the first range-transfer payload class. The fixed allowance
/// covers every scalar, option/tag, vector prefix, Device public key and signature container. Variable fields
/// are counted with checked arithmetic; no bytes are copied or hashed here. Unsupported actions/ceremonies use
/// ordinary sync. Tests compare this bound against the actual wire encoder across the write variants.
fn range_write_bound(signed: &Signed) -> Option<usize> {
    use crate::sign::SignerKeys;
    let [sig] = signed.sigs.as_slice() else { return None };
    if !signed.edit.cosigners.is_empty() || !matches!(sig.keys, SignerKeys::Device { .. })
        || sig.webauthn.is_some() || sig.enclave.is_some() { return None; }
    let Action::Write { deps, via, create, files, body, .. } = &signed.edit.action else { return None };
    let ids = signed.edit.parents.len().checked_add(deps.len())?.checked_add(via.len())?
        .checked_add(create.as_ref().map_or(0, |c| c.audience.len()))?;
    1024usize.checked_add(sig.pq.len())?.checked_add(body.len())?
        .checked_add(ids.checked_mul(32)?)?.checked_add(files.len().checked_mul(40)?)
}

/// How many edits a device steps on its replay before its shelf takes its view again (`Lab::warming`): as many as it
/// steps on again as it starts from the view before. A replay of every edit puts the view on its shelf at once. The
/// cadence of writing a whole view, which a view kept as rows of a `ShelfIndex` steps on edit by edit in place of it
/// (Goal 9); no rule of what is fresh.
const VIEW_STEPS: usize = 4096;

/// The work a start does in one go, in edits to replay past its stored view and entries to show (`restore_end_with`):
/// more, and it does a step of it, `RESTORE_BUDGET`, and its catch-up the rest.
const RESTORE_WHOLE: usize = 4096;
const RESTORE_BUDGET: usize = 48;
/// What a device's shelf names edits it holds by that the device checked, each one, as it took them (avendb-net's
/// newest head that holds only such edits, by its number and the hash of its bytes, which name its packs by their
/// hashes): it keeps it with its keys (`Lab::warming`), so that it doesn't check them again as it starts, where its shelf
/// names them the same (`Lab::restore_warm`).
pub type Checked = [u8; 40];

/// A device's keys from its shelf (`Warm::keys`), opened: what its shelf named the edits it checked by, if anything
/// (`Checked`), after a byte that says whether it named any, and the keys it opened from their boxes, each by the box it
/// opened and the key it opened it with (`opened_box`).
fn keys_of(bytes: &[u8]) -> Option<(Option<Checked>, Vec<([u8; 32], Secret)>)> {
    let (checked, keys) = match bytes.split_first()? {
        (0, keys) => (None, keys),
        (1, rest) => rest.split_first_chunk::<40>().map(|(checked, keys)| (Some(*checked), keys))?,
        _ => return None,
    };
    let opened = keys.chunks_exact(64).map(|chunk| {
        let (opened, secret) = chunk.split_at(32);
        (opened.try_into().expect("32 bytes"), Secret::from_bytes(secret.try_into().expect("32 bytes")))
    });
    (keys.len() % 64 == 0).then(|| (checked, opened.collect()))
}

/// What one device holds: its edits, each with its signatures, to pass on, and the blobs they name; what it makes of
/// them; the keys it holds; what it read with them; and the entries it shows.
struct Store {
    log: Log,
    /// Its signed edits and McEliece keys: in memory, or spilled into the server's folder, a bounded cache of them in
    /// memory (`held`, S7).
    signed: held::Signeds,
    blobs: held::Keys,
    /// The replay of its edits as it last brought itself up to date: which stand, and what it knows.
    replay: Replay,
    /// Its replay's key index, grown on between refreshes (`KeyIndexed`).
    key_ix: KeyIndexed,
    /// Its owners' judged slices it took, by entry, kept on its shelf beside its history (`EntryState.lean`'s based
    /// state, one format for owners and readers).
    bases: entry_base::Anchors,
    bootstrap_state: Option<State>,
    /// The entries it shows from those slices now, each with what is left of its suffix: an entry is based while it
    /// is here, full otherwise.
    based: HashMap<EntryId, entry_base::Based>,
    bootstrap_basis: Option<entry_base::OverlayBasis>,
    bootstrap_cursor: Option<EntryId>,
    bootstrap_revision: Arc<()>,
    /// How many of its edits that replay is of, the first of its log: those after it step on it (`replay_on`).
    replayed: usize,
    /// A replay of every edit it held when it began, run a slice a step of a catch-up where stepping on would replay
    /// them all (`step_replay`): of a log that goes on from that head, the replay before it being of `replayed` edits
    /// then.
    replaying: Option<(crate::log_head::Head, usize, Replaying)>,
    /// What its edits say now, those it kept since that replay too (`Lab::latest`): replayed once for the edits it
    /// holds now, not on every ask, announce and fetch. Empty while the replay is of every edit it holds and no entry is
    /// based, the replay then being `latest` itself.
    latest: OnceLock<State>,
    /// Empty while it is locked, as is everything below.
    keys: Keyring,
    /// The entry keys it derived: by the key of the audience it derived each from, the entry and the stay.
    derived: HashSet<(KeyId, EntryId, Option<EditId>)>,
    /// The stays of its audience, by their print, each audience key it derived for every one of them (`derive`): a key
    /// whose audience's stays are as they were then derives nothing new, and is left alone.
    derived_through: HashMap<KeyId, [u8; 32]>,
    /// What its log and replay were when it last derived (`stays_changed`): its log's head, and its whole replays.
    stays_seen: Option<(crate::log_head::Head, u64)>,
    /// The slices of the shares, keep shares among them, whose selectors it opened, and those whose selectors never
    /// open for it: garbled, or with no box for a key it holds that opens, or, where it is a steward, for no seed of
    /// the vault the share is over.
    slices: HashMap<ShareId, Slice>,
    unreadable: HashSet<ShareId>,
    /// The boxes it tried with the key they are to and that didn't open to their key, each by the edit it is of and
    /// which of its boxes it is (`IndexedBox`): tried once, not again at every refresh.
    unopened: HashSet<(EditId, usize)>,
    /// The boxes to an entry's key it derived that key for from none of the audience keys it held then, each with the
    /// audience it tried and how many of its keys it held (`box_audience`): tried again once that changed, not at every
    /// refresh. A fresh browser looked at each of thousands of such boxes with each of its audience's keys at every
    /// step, 1.4 s a step (fresh8, 2026-10-29).
    underived: HashMap<(EditId, usize), (Option<KeyName>, usize)>,
    /// The bodies of the writes it opened, each opened as it is asked for where its stored view says it opened it
    /// (`Bodies`), and the writes whose bodies never open: garbled under the key they name.
    bodies: Bodies,
    spoilt: HashSet<EditId>,
    /// What it reads of selectors, headers and tags, from the two above.
    readings: Readings,
    shown: ShownMap,
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
    /// The entries a budgeted showing left to show (`show_items`), of the edits of that revision, and what it read
    /// of them then: none once it showed them all, or once any later showing begins again.
    showing: Option<Showing>,
    /// What `read` opened since it last read (`ReadNew`).
    read_new: ReadNew,
    /// What changed since its upkeep last looked at its entries (`UpkeepDue`).
    upkeep_due: UpkeepDue,
    /// The McEliece keys it lacks to seal to, as its upkeep last looked: of each target it would box a key for and
    /// can't, and of each vault's seed a share's selector was to be sealed to and couldn't (`seal_slice`). What it asks a
    /// peer for (`request`), the one way a key comes to it: it reads and holds all it may without any
    /// (`LazyBoxes.lean` `reads_without_keys`), and the box it couldn't make its upkeep makes once the key comes.
    sealing: BTreeSet<BlobId>,
    /// The entries whose shown items keep their scratch items (`SCRATCHES`).
    scratched: HashSet<EntryId>,
    /// How many writes its view held when it last showed its items, and the last of them, with the hashes of the
    /// lanes and the cap groups then: what tells that only new writes came since (`show_items`).
    shown_writes: (usize, Option<EditId>),
    shown_lanes: BTreeMap<VaultId, ([u8; 32], BTreeSet<BlobId>)>,
    shown_groups: [u8; 32],
    /// The print of what it judged the cap groups on when it last judged them (`show_items`): their entries, lanes and
    /// writes in order, and which bodies of them it opened. A show at the same print keeps the groups it judged
    /// (`CapGroupsOnce.lean`).
    shown_caps: Option<[u8; 32]>,
    /// The showings its shelf kept (`Warm::shown`), by entry, till `show_items` takes each whose print is its entry's
    /// print then, in place of judging the entry anew (`ShownView.lean`).
    kept_shown: HashMap<EntryId, Closed>,
    /// The print of each showing its shelf keeps, by entry, as its shelf's index of them names it: what a save leaves
    /// out. One whose row names a pack that doesn't open (sealed under other show rules, or cut short) is none, so the
    /// next save keeps that entry's showing again, and its row names the new pack from then on.
    shown_given: HashMap<EntryId, [u8; 32]>,
    /// How its last restore went (`restore_end_with`), for its person to read beside the step it took
    /// (`Lab::restore_report`).
    restored: Option<Restored>,
    /// The keys it opened from their boxes before, from its shelf (`Warm::keys`), each by the box it opened and the key
    /// it opened it with (`opened_box`): that box it doesn't open again. And those it opened since its shelf took them
    /// (`Lab::warming`, `Lab::warmed`).
    opened_before: HashMap<[u8; 32], Secret>,
    opened_since: Vec<([u8; 32], Secret)>,
    /// A receipt may drain the pending key prefix only once, before a lock or another receipt changes it.
    /// Allocation identity also separates replacement stores; it is never persisted or used to trust bytes.
    warm_revision: Arc<()>,
    /// What the keys its shelf keeps name the edits it checked by, as it last gave them or took them from there
    /// (`Lab::warming`).
    checked_given: Option<Checked>,
    /// The work its start does in one go (`restore_end_with`), `RESTORE_WHOLE` but in a test.
    restore_whole: usize,
    /// The head of the edits the view its shelf keeps is of (`Log::head_at`), as it last gave it or took it from there,
    /// none for none; and the head of the edits what it read beside that view is of (`stored_readings`), none where
    /// the view holds none: one of an older engine, or one given before it read every body it counts (a first sync's,
    /// given as it goes), which it gives again once it can seal what it read (`stored_readings::sealable`).
    view_given: Option<crate::log_head::Head>,
    read_given: Option<crate::log_head::Head>,
    /// How many times it replayed every edit, and how many times when its shelf took its view. A whole replay changes
    /// no edit of its log, so no head tells of it: it means an edit after the view's edits sorts among them, and the
    /// view, still the replay of its edits (VR3), would have the next start replay every edit again. Till a step back
    /// costs the distance back alone (Goal 8 lane C), the count tells it.
    wholes: u64,
    view_wholes: u64,
    /// Its first sync with the boxes held back, if it asks for one (`Lab::set_lazy_boxes`).
    lazy: LazyBoxes,
    /// Its query views (`query_view`): the answers of the queries its pages asked, each at the head it was worked out
    /// at. Its own, never an edit's.
    query_views: std::sync::Mutex<QueryViews>,
    /// Whether its shared index lists every entry of a vault it reads (`index_complete`), each with the stamp it was
    /// worked out at.
    complete: std::sync::Mutex<HashMap<VaultId, (query_view::Stamp, bool)>>,
    /// The sum of what a read depends on beside its log as it worked its items out (`context_sum`).
    context: [u8; 32],
}

/// A device's store taken out of its Lab for a probe of its memory (`Lab::probe_store`): of no use but to let go of.
#[doc(hidden)]
pub struct Probed(Store);

impl Probed {
    /// Takes part `part` out and hands it back, to let go of it and count what that frees; `None` for a part it doesn't
    /// know.
    pub fn part(&mut self, part: &str) -> Option<Box<dyn std::any::Any + Send>> {
        let store = &mut self.0;
        fn out<T: Send + 'static>(t: T) -> Option<Box<dyn std::any::Any + Send>> {
            Some(Box::new(t))
        }
        match part {
            "signed" => out(std::mem::take(&mut store.signed)),
            "blobs" => out(std::mem::take(&mut store.blobs)),
            "log" => out(std::mem::take(&mut store.log)),
            p if p.starts_with("log.") => store.log.probe_part(&p[4..]),
            p if p.starts_with("replay.") => store.replay.probe_part(&p[7..]),
            "replay" => out(std::mem::replace(&mut store.replay, replay(&[]))),
            "latest" => out(std::mem::take(&mut store.latest)),
            "key_index" => out(std::mem::take(&mut store.key_ix.ix)),
            "keys" => out(std::mem::take(&mut store.keys)),
            "bases" => out((std::mem::take(&mut store.bases), std::mem::take(&mut store.based))),
            "bodies" => out((std::mem::take(&mut store.bodies), std::mem::take(&mut store.opened))),
            "readings" => out(std::mem::take(&mut store.readings)),
            "shown" => out(std::mem::take(&mut store.shown)),
            "answers" => out(std::mem::take(&mut store.answers)),
            "files_at" => out(std::mem::take(&mut store.files_at)),
            "slices" => out(std::mem::take(&mut store.slices)),
            "opened_keys" => out((std::mem::take(&mut store.opened_before), std::mem::take(&mut store.opened_since))),
            "derived" => out((std::mem::take(&mut store.derived), std::mem::take(&mut store.unopened))),
            "covers" => out((std::mem::take(&mut store.covers), std::mem::take(&mut store.bare))),
            "showing" => out(std::mem::take(&mut store.showing)),
            _ => None,
        }
    }
}

impl Default for Store {
    fn default() -> Store {
        let mut store = Store {
            log: Log::new(),
            signed: held::Signeds::default(),
            blobs: held::Keys::default(),
            replay: replay(&[]),
            key_ix: KeyIndexed::default(),
            bases: BTreeMap::new(),
            bootstrap_state: None,
            based: HashMap::new(),
            bootstrap_basis: None,
            bootstrap_cursor: None,
            bootstrap_revision: Arc::new(()),
            replayed: 0,
            replaying: None,
            latest: OnceLock::new(),
            keys: Keyring::default(),
            derived: HashSet::new(),
            derived_through: HashMap::new(),
            stays_seen: None,
            slices: HashMap::new(),
            unreadable: HashSet::new(),
            unopened: HashSet::new(),
            underived: HashMap::new(),
            bodies: Bodies::default(),
            spoilt: HashSet::new(),
            readings: Readings::default(),
            shown: ShownMap::default(),
            kept_shown: HashMap::new(),
            shown_given: HashMap::new(),
            restored: None,
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
            showing: None,
            read_new: ReadNew::default(),
            upkeep_due: UpkeepDue::default(),
            sealing: BTreeSet::new(),
            scratched: HashSet::new(),
            shown_writes: (0, None),
            shown_lanes: BTreeMap::new(),
            shown_groups: [0; 32],
            shown_caps: None,
            opened_before: HashMap::new(),
            opened_since: vec![],
            warm_revision: Arc::new(()),
            checked_given: None,
            view_given: None,
            read_given: None,
            restore_whole: RESTORE_WHOLE,
            wholes: 0,
            view_wholes: 0,
            lazy: LazyBoxes::default(),
            query_views: std::sync::Mutex::new(QueryViews::default()),
            complete: std::sync::Mutex::new(HashMap::new()),
            context: [0; 32],
        };
        store.recontext();
        store
    }
}

impl Store {
    /// The stubs it counts as held when it asks (`LazyBoxes`): none once it asks for their bodies.
    fn counted_stubs(&self) -> Vec<Stub> {
        if self.lazy.fetching {
            return vec![];
        }
        self.lazy.stubs.values().map(|(stub, _)| stub.clone()).collect()
    }

    fn body_metadata(&self, id: EditId) -> Option<&Body> {
        self.bodies.get(&id, &self.opener())
    }
    fn metadata_bodies(&self) -> impl Iterator<Item = (&EditId, &Body)> {
        self.bodies.iter(self.opener())
    }
    /// The bodies of the writes it opened that name files in the clear (`Edit::files`), each opened as it is asked for:
    /// no other body is opened to find a file.
    fn bodies_bringing_files(&self) -> impl Iterator<Item = (&EditId, &Body)> {
        let with = self.opener();
        let brings = |id: &EditId| self.log.entry_write(*id).is_some_and(|e| !e.files().is_empty());
        self.bodies.ids().filter(move |id| brings(id)).filter_map(move |id| Some((id, self.bodies.get(id, &with)?)))
    }

    /// What its bodies open with, each as it is asked for (`Bodies::get`).
    fn opener(&self) -> Opener<'_> {
        Opener { signed: &self.signed, keys: &self.keys, st: &self.replay.state }
    }
    /// Its bodies as judging reads them (`BodyOf`).
    fn body_of(&self) -> StoreBodies<'_> {
        StoreBodies { bodies: &self.bodies, with: self.opener() }
    }
    fn view(&self) -> &State {
        self.bootstrap_state.as_ref().unwrap_or(&self.replay.state)
    }

    /// Its shelf lacks its view (`Lab::warming`): the view its shelf keeps, if any, is of other edits, and it replayed
    /// every edit since or stepped `VIEW_STEPS` on it. Its replay is of the first `replayed` edits of its log, so it
    /// seals that view even while newer edits wait to step on it (VR3): a device that keeps taking edits keeps one too.
    /// The showings it keeps on its shelf whose print its shelf lacks, by entry (`ShownView.lean`'s `keeps`): only of
    /// every write of their entry, judged of its log, not from an owner's base, against its replay of every edit it
    /// holds, and none of a cap group, which it judges anew each time. None mid catch-up.
    fn shown_due(&self) -> Vec<EntryId> {
        if self.replayed == 0 || self.replayed != self.log.edits().len() || self.showing.is_some() {
            return vec![];
        }
        let st = &self.replay.state;
        self.shown.tips().filter(|(e, print, tip)| {
            let (writes, last) = st.entry_tip(**e);
            tip.writes == writes && tip.last == last
                && self.shown_given.get(*e) != Some(print)
                && !self.based.contains_key(*e) && !self.bases.contains_key(*e)
                && st.entry(**e).is_some_and(|en| !st.is_cap_group(en, &self.readings))
        }).map(|(e, _, _)| *e).collect()
    }

    fn view_due(&self) -> bool {
        let n = self.replayed;
        if n == 0 || n > self.log.edits().len() {
            return false;
        }
        // the view its shelf keeps, where it is of the first edits of its log
        let Some(given) = self.view_given.filter(|h| self.log.of_log(*h)) else { return true };
        let since = n.abs_diff(given.at as usize);
        let read_due = self.read_given != Some(given) && stored_readings::sealable(self, n);
        self.wholes != self.view_wholes || since >= VIEW_STEPS || read_due
    }

    /// Its shelf lacks its keys (`Lab::warming`): it opened a key since its shelf took them, or its shelf names the
    /// edits it checked by `checked` now, and its keys by something else.
    fn keys_due(&self, checked: Option<Checked>) -> bool {
        !self.opened_since.is_empty() || (checked.is_some() && checked != self.checked_given)
    }

    /// The sum of what a read depends on beside its log as it worked its items out (`query_view::Stamp::context`): its
    /// shares and the selectors it opened, its cap groups and lanes, the entries whose header it hasn't read and those
    /// it shows from a base. Kept as `context`, worked out again each time one of those changes (`recontext`), never on
    /// a read.
    fn context_sum(&self) -> [u8; 32] {
        use crate::hash::Hasher;
        let (store, r) = (self, &self.readings);
        let mut context = Hasher::new("avenDB query view context 1");
        let sorted = |mut ids: Vec<[u8; 32]>| { ids.sort_unstable(); ids };
        for part in [
            sorted(r.selectors.keys().map(|s| s.0).collect()),
            sorted(r.defines.keys().map(|e| e.0).collect()),
            sorted(store.slices.keys().map(|s| s.0).collect()),
            sorted(store.unreadable.iter().map(|s| s.0).collect()),
            sorted(store.based.keys().map(|e| e.0).collect()),
            r.untyped.iter().map(|e| e.0).collect(),
        ] {
            context.update(&(part.len() as u64).to_be_bytes());
            part.iter().for_each(|id| { context.update(id); });
        }
        context.update(&store.shown_groups);
        for (v, (lane, _)) in &store.shown_lanes { context.update(&v.0).update(lane); }
        context.finalize()
    }

    /// Works `context` out again, as what a read depends on beside its log changed.
    fn recontext(&mut self) {
        self.context = self.context_sum();
    }

    /// Forget every key and everything a key opened, as it locks.
    fn forget(&mut self) {
        self.warm_revision = Arc::new(());
        self.keys = Keyring::default();
        self.derived.clear();
        self.derived_through.clear();
        self.stays_seen = None;
        self.slices.clear();
        self.unreadable.clear();
        self.unopened.clear();
        self.underived.clear();
        self.bodies.clear();
        self.files_at = OnceLock::new();
        self.spoilt.clear();
        self.readings = Readings::default();
        self.read_new.forget();
        self.upkeep_due = UpkeepDue::default();
        self.sealing.clear();
        self.shown.clear();
        self.bootstrap_state=None;
        self.based.clear();
        self.bootstrap_basis = None;
        self.bootstrap_cursor = None;
        self.reshow = true;
        self.opened.clear();
        self.opened_before.clear();
        self.recontext();
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

impl Shown {
    /// Its bytes as a device keeps it on its shelf (`Warming::shown`) and closes it to (`shown_map::Closed`), all but
    /// its scratch item, which judging builds again of its writes: none where an item holds changes a Loro snapshot
    /// leaves out.
    fn record(&self) -> Option<Vec<u8>> {
        use crate::encode::Encode;
        let mut b = vec![];
        self.print.encode(&mut b);
        (self.tip.writes as u64).encode(&mut b);
        self.tip.last.encode(&mut b);
        self.tip.lane.encode(&mut b);
        self.tip.groups.encode(&mut b);
        self.history.encode(&mut b);
        (self.items.len() as u32).encode(&mut b);
        for (line, item) in &self.items {
            crate::kept::put_line(&mut b, line);
            crate::kept::put_item(&mut b, item)?;
        }
        self.after.attrs.encode(&mut b);
        self.after.mine.encode(&mut b);
        crate::kept::put_imported(&mut b, &self.after.imported);
        crate::kept::put_asked(&mut b, &self.after.asked);
        Some(b)
    }

    /// The showing `record` made the bytes of.
    fn of_record(bytes: &[u8]) -> Result<Shown, crate::wire::WireError> {
        use crate::wire::{Decode, Reader, WireError};
        let r = &mut Reader::new(bytes);
        let print = <[u8; 32]>::decode(r)?;
        let tip = Tip {
            writes: u64::decode(r)? as usize,
            last: r.option()?,
            lane: <[u8; 32]>::decode(r)?,
            groups: <[u8; 32]>::decode(r)?,
        };
        let history = History::decode(r)?;
        let n = r.count(9)?;
        let mut items = BTreeMap::new();
        for _ in 0..n {
            let line = crate::kept::line_of(r)?;
            items.insert(line, crate::kept::item_of(r)?);
        }
        let after = After {
            scratch: None,
            attrs: r.option()?,
            mine: crate::policy::Mine::decode(r)?,
            imported: crate::kept::imported_of(r)?,
            asked: crate::kept::asked_of(r)?,
        };
        if !r.done() {
            return Err(WireError::Trailing);
        }
        Ok(Shown { history, items, print, tip, after })
    }
}

impl Shown {
    fn history_in<'a>(&'a self, _store: &Store) -> Option<&'a History> {
        Some(&self.history)
    }
    fn items(&self) -> &BTreeMap<Line, Item> { &self.items }
    fn items_in(&self, _store: Option<&Store>) -> &BTreeMap<Line, Item> { &self.items }
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
    /// Each box, after the name and the id of the key it holds: where it is, not its bytes, which its log holds
    /// already (`IndexedBox`).
    boxes: Vec<IndexedBox>,
    /// Which key has a box for which: its name, its id, the name of the key the box goes to.
    boxed: HashSet<(KeyName, KeyId, KeyName)>,
    /// Each key published in the clear, and their ids.
    clear: Vec<(KeyName, KeyId, [u8; 32])>,
    cleared: HashSet<KeyId>,
    /// The names some device made a key of: announced, boxed, wrapped or published, or with a box under it.
    exists: HashSet<KeyName>,
}

impl KeyIndex {
    /// `held` being the edits `r` is the replay of (`Replay::edits`), which its boxes are read of again.
    fn of(r: &Replay, held: &[Edit]) -> KeyIndex {
        let mut ix = KeyIndex::default();
        ix.grow(r, held, 0);
        ix
    }

    /// What `r`'s standing edits from the `from`th on add to it, as `of` reads them, `held` being the edits `r` is the
    /// replay of.
    fn grow(&mut self, r: &Replay, held: &[Edit], from: usize) {
        self.grow_to(r, held, from, r.places().len());
    }

    /// `grow` by `r`'s standing edits from the `from`th up to the `to`th alone: a slice of them, so that an index made
    /// again of every edit is made a step at a time (`KeyIndexed::step`).
    fn grow_to(&mut self, r: &Replay, held: &[Edit], from: usize, to: usize) {
        let (places, ids) = (&r.places()[from.min(to)..to], &r.ids[from.min(to)..to]);
        let stood = &r.stood[from.min(to)..to];
        let edits = places.iter().zip(ids).zip(stood).filter(|(_, stood)| **stood).map(|((place, id), _)| (&held[*place], place, *id));
        for (edit, &place, of) in edits {
            for (slot, (name, id, b)) in edit.action.key_boxes().into_iter().enumerate() {
                self.exists.insert(name);
                self.exists.insert(b.to.name());
                self.boxed.insert((name, id, b.to.name()));
                self.boxes.push(IndexedBox { name, id, to: b.to, place, slot, of });
            }
            if let Action::Keys { name, id, public, clear, .. } = &edit.action {
                self.exists.insert(*name);
                if let Some(p) = public {
                    self.made.entry(*name).or_default().push((*id, p.clone()));
                }
                if let Some(c) = clear {
                    self.clear.push((*name, *id, *c));
                    self.cleared.insert(*id);
                }
            }
        }
    }

    /// The same index as `o`.
    #[cfg(debug_assertions)]
    fn same(&self, o: &KeyIndex) -> bool {
        (&self.made, &self.boxes, &self.boxed, &self.clear, &self.cleared, &self.exists)
            == (&o.made, &o.boxes, &o.boxed, &o.clear, &o.cleared, &o.exists)
    }

    /// Key `id` of `name` is announced, its public half with it.
    fn announced(&self, name: KeyName, id: KeyId) -> bool {
        self.made.get(&name).is_some_and(|m| m.iter().any(|x| x.0 == id))
    }
}

/// A box of a key in a `KeyIndex`: the name and the id of the key it holds, whom it is to, the edit it is of by its
/// place in the log the index is of and by its id, and which of that edit's boxes it is (`Action::key_box`): its id and
/// slot tell a box tried before (`Store::unopened`), as an edit's id is a hash of its boxes' bytes. Its bytes stay in
/// the log alone, never read to index it: a key box is ~1.4 KB, and a copy of each in the index doubled what a device
/// holds of them (F9); read back from a spill to index it, each box read and checked its whole edit's record, which
/// made the index 6.6 s of a Mac's unlock in WebKit and 29 s of a phone's turn (2026-10-28).
#[derive(Clone, Debug, PartialEq, Eq)]
struct IndexedBox {
    name: KeyName,
    id: KeyId,
    to: Recipient,
    place: usize,
    slot: usize,
    of: EditId,
}

impl IndexedBox {
    /// Its bytes, of `held`, the edits of the log its index is of.
    fn bytes<'a>(&self, held: &'a [Edit]) -> std::borrow::Cow<'a, [u8]> {
        held[self.place].action.key_box(self.slot).expect("an indexed box").bytes.bytes()
    }
}

/// A device's `KeyIndex`, kept between refreshes and grown by the edits its replay took since (`KeyIndexed::take`),
/// not made again of every edit it holds each time (3.6 ms a refresh at 130,000 edits, 2026-10-27). A memo of the
/// stepped replay, never kept on the shelf: the index gate's one written exception (`ShelfIndex.lean`), as it reads no
/// box's bytes and is made at a start in 85 ms of a phone's 116,000 edits (2026-10-29), less than reading it back, and
/// made again only where its replay replayed every edit, which a step back of the distance back removes (Goal 8 lane C).
#[derive(Default)]
struct KeyIndexed {
    ix: KeyIndex,
    /// What it is of: the log's head, the store's whole replays, and the replay's length and last edit.
    of: Option<(crate::log_head::Head, u64, usize, EditId)>,
}

impl KeyIndexed {
    /// The index of `store`'s replay now, to be put back once used (`put`). It grows on from what it was of where its
    /// log only grew since, by no removal, its replay was stepped on, not made whole, and its replay's edits so far are
    /// where they were (the replay keeps its edits' order, so its last one where it was means none came before it).
    /// Only removals change which earlier edits stand; else it is made again of every edit.
    fn take(store: &mut Store) -> KeyIndex {
        let (log, r) = (&store.log, &store.replay);
        let from = Self::from(store);
        store.key_ix.of = None;
        let mut ix = std::mem::take(&mut store.key_ix.ix);
        let had = if from.is_some() { ix.boxes.len() } else { 0 };
        match from {
            Some(n) => {
                ix.grow(r, log.edits(), n);
                store.perf.count("keys: index grown", 1);
            }
            None => {
                ix = KeyIndex::of(r, log.edits());
                store.perf.count("keys: index made", 1);
            }
        }
        #[cfg(debug_assertions)]
        #[cfg(not(avendb_no_replay_checks))]
        debug_assert!(ix.same(&KeyIndex::of(r, log.edits())), "a key index grown on differs from one made whole");
        store.perf.count("keys: boxes indexed", (ix.boxes.len() - had) as u64);
        ix
    }

    /// How many of the edits of `store`'s replay its index is of, if it grows on from there (`take`).
    fn from(store: &Store) -> Option<usize> {
        let (log, r) = (&store.log, &store.replay);
        store.key_ix.of.as_ref().and_then(|(head, wholes, n, last)| {
            let (len, n) = (head.at as usize, *n);
            let grown = log.of_log(*head) && *wholes == store.wholes;
            let kept = 0 < n && n <= r.ids.len() && r.ids[n - 1] == *last;
            let removes = log.edits()[len.min(log.edits().len())..].iter().any(Edit::is_removal);
            (grown && kept && !removes).then_some(n)
        })
    }

    /// The index of `store`'s replay grown by at most `most` of its edits, where it lacks more than that: made again of
    /// every edit (a whole replay, a removal) a slice a step, and put back of that slice, so that the next `take` grows
    /// on from it (`CatchUpBudget.lean` `index`). An index made whole of a phone's 107,000 edits held its Lab 27.9 s in
    /// one turn, and a page's worker, which runs the Lab, answered no peer meanwhile (2026-10-28). True if it did.
    fn step(store: &mut Store, most: usize) -> bool {
        let from = Self::from(store);
        let (n, len) = (from.unwrap_or(0), store.replay.ids.len());
        if len - n.min(len) <= most {
            return false;
        }
        let mut ix = if from.is_some() { std::mem::take(&mut store.key_ix.ix) } else { KeyIndex::default() };
        let to = n + most.max(1);
        let had = ix.boxes.len();
        ix.grow_to(&store.replay, store.log.edits(), n, to);
        store.perf.count("keys: boxes indexed", (ix.boxes.len() - had) as u64);
        store.perf.count(if from.is_some() { "keys: index grown a step" } else { "keys: index begun a step" }, 1);
        let (log, r) = (&store.log, &store.replay);
        store.key_ix.of = Some((log.head(), store.wholes, to, r.ids[to - 1]));
        store.key_ix.ix = ix;
        true
    }

    /// `ix`, taken of `store`'s replay as it is now, back.
    fn put(store: &mut Store, ix: KeyIndex) {
        let (log, r) = (&store.log, &store.replay);
        store.key_ix.of = r.ids.last().map(|&last| (log.head(), store.wholes, r.ids.len(), last));
        store.key_ix.ix = ix;
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

/// A scan of the files a device's edits bring, a slice at a time (`Lab::scan_files`): those to keep whole by `keep`,
/// and those of `entries`, the open views', it reads.
#[derive(Default)]
pub struct FileScan {
    keep: bool,
    entries: Vec<EntryId>,
    head: Option<crate::log_head::Head>,
    at: usize,
    selected: HashSet<EntryId>,
    files: BTreeSet<FileRoot>,
    kept: BTreeSet<FileRoot>,
    named: BTreeSet<FileRoot>,
}

impl FileScan {
    /// A scan of the files to keep whole by the device's own setting `keep`, and of those the entries `entries` bring.
    pub fn new(keep: bool, entries: Vec<EntryId>) -> FileScan {
        FileScan { keep, entries, ..FileScan::default() }
    }
}

/// How a step of a catch-up went (`Lab::catch_up_step`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatchUp {
    /// Its replay stepped on: the rest of the catch-up to come.
    Stepped,
    /// Caught up, and whether there was anything to (`Lab::catch_up`).
    Caught(bool),
}

/// How a slice of a scan of files went (`Lab::scan_files`).
#[derive(Debug, PartialEq, Eq)]
pub enum FileScanned {
    /// The device's replay is behind: nothing scanned, until its catch-up.
    Behind,
    /// More slices to go.
    More,
    /// The whole scan: as `Lab::files`, `Lab::kept_files` and `Lab::demanded_files` say it.
    Done { files: Vec<FileRoot>, kept: Vec<FileRoot>, demanded: Vec<FileRoot> },
}

/// A copy of what a device holds, as a backup keeps it: its signed edits and the blobs they name.
#[derive(Clone)]
pub struct Backup {
    signed: Vec<Signed>,
    blobs: Blobs,
    bases: entry_base::Anchors,
}

impl Backup {
    /// A backup of signed edits, in the order the device took them, and McEliece keys, each under the id it hashes to:
    /// what a node reads back from its store on disk.
    pub fn new(signed: Vec<Signed>, blobs: impl IntoIterator<Item = Arc<[u8]>>) -> Backup {
        Backup { signed, blobs: blobs.into_iter().map(|b| (BlobId::of(&b), b)).collect(), bases:BTreeMap::new() }
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

/// The devices' stores, by device.
type Stores = HashMap<SignerId, Store>;

pub struct Lab {
    /// The keys at hand: passkeys, owner keys, and unlocked devices.
    keys: HashMap<SignerId, Key>,
    /// Every signer's name, as the Lab made it.
    names: HashMap<SignerId, String>,
    /// Each device whose keys derive from a passkey: that passkey, and the 32 bytes that end the device's salt.
    salts: HashMap<SignerId, (SignerId, [u8; 32])>,
    /// Devices in the order they were made.
    devices: Vec<SignerId>,
    /// Passkey-derived handoff keys of real devices, retained only while unlocked.
    hand_keys: HashMap<SignerId, HandKey>,
    stores: Stores,
    /// Keys made so far; each key's seed counts on from here.
    made: u64,
    /// The randomness of new keys, seals and nonces, which keeps nothing that draws again what it drew
    /// (`keys::SeededRng`).
    rng: SeededRng,
    /// The nonce of the next pass a device signs (`api_pass`), counted on from a draw of the randomness the Lab opens
    /// with, of its own so that the Lab's own draws stay as they were (`passes_from`): no two passes of a device are ever alike, though made in one second, by one Lab or by two of it opened
    /// alike, so a service that takes each pass once takes every one. Atomic, as a pass is signed on a Lab held to read.
    passes: AtomicU64,
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
    /// Each unlocked device's batch-signed log (M3, `batch`), in a debug build: the edits it holds that it signed, in
    /// the order it holds them, wrapped as they stand when it unlocks and signed under one root, then each edit it signs
    /// (`batched`). Edits still travel and are kept with their own signatures, so a release build keeps no log yet and
    /// pays nothing at unlock: a debug build signs each batch at once and holds each edit's path to the signature beside
    /// it.
    batches: HashMap<SignerId, SignerLog>,
    /// Production signing events, enabled by a node with an atomic durable signer ledger.
    /// They outlive Store restore and lock; only an exact persisted receipt drains them.
    signing_events: HashMap<SignerId, batch::SigningEvents>,
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
            hand_keys: HashMap::new(),
            stores: Stores::default(),
            made: 0,
            rng: SeededRng::new("lab randomness", entropy.as_ref().map_or(&[][..], |e| &e[..])),
            passes: passes_from(entropy.as_ref().map_or(&[][..], |e| &e[..])),
            on_machine: entropy.is_some(),
            spares: Spares::default(),
            offline: HashSet::new(),
            now: 0,
            dry: false,
            held_back: None,
            lawless: false,
            recovery: None,
            hosted: HashMap::new(),
            batches: HashMap::new(),
            signing_events: HashMap::new(),
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
        let key = Passkey::from_seed(secret);
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
        self.add_device(DeviceKey::from_secret(secret), name)
    }

    /// Device `id`, whose keys come from `secret`, as `device_with` makes it (`DeviceKey::of`). `None` if they are
    /// another device's.
    pub fn device_as(&mut self, name: &str, secret: [u8; 32], id: SignerId) -> Option<SignerId> {
        Some(self.add_device(DeviceKey::of(secret, id)?, name))
    }

    /// A passkey in the platform's authenticator (P8e), whose P-256 key is `p256`, as a ceremony of it over any
    /// challenge showed it (`sign::Ceremony`): the Lab holds its keys and the public key sealed to it, which the
    /// ceremony's PRF output derives, and no secret. It signs in ceremonies alone (`complete`). Its id; `None` unless
    /// the ceremony's assertion is that key's.
    pub fn web_passkey(&mut self, name: &str, p256: [u8; 33], ceremony: &Ceremony) -> Option<SignerId> {
        let assertion = ceremony.assertion()?;
        if !ceremony.challenge().is_some_and(|c| assertion.verify(&p256, EditId(c))) {
            return None;
        }
        Some(self.web_key(name, ceremony.keys(p256), ceremony))
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
    /// enclave`), held as `web_passkey` holds a passkey: its keys and the public key sealed to it, and no secret. It
    /// signs in ceremonies alone (`complete`). Its id. `None` unless it is a Touch ID key's ceremony whose Enclave
    /// signature verifies.
    pub fn web_enclave(&mut self, name: &str, ceremony: &Ceremony) -> Option<SignerId> {
        let keys = ceremony.enclave_keys()?;
        let challenge = ceremony.challenge()?;
        ceremony.sign(keys, EditId(challenge))?;
        Some(self.web_key(name, keys, ceremony))
    }

    /// The keys of owner key `s`, held as `web_passkey` and `web_enclave` hold them if the Lab doesn't hold them yet and
    /// `ceremony` is that key's: so a Mac its Touch ID key opened, with no passkey's ceremony, takes its person's passkey
    /// in from the first ceremony it makes, as for a change only the vault's root makes (2026-10-19). A passkey's are
    /// those of the key its assertion recovers to whose keys hash to `s`, as are a Touch ID key's. `None` if neither is at
    /// hand.
    pub fn take_in(&mut self, s: SignerId, ceremony: &Ceremony) -> Option<SignerKeys> {
        if let Some(keys) = self.keys_of(s) {
            return Some(keys);
        }
        let name = self.names.get(&s).cloned().unwrap_or_else(|| "the person".into());
        let challenge = EditId(ceremony.challenge()?);
        let keys = match ceremony.assertion() {
            Some(a) => a.recover().into_iter().find_map(|p256| ceremony.keys_of(p256, s)),
            None => ceremony.enclave_keys().filter(|k| k.id() == s),
        }?;
        ceremony.sign(keys, challenge)?;
        self.web_key(&name, keys, ceremony);
        self.keys_of(s)
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
            for keys in self.held(d).signed.signer_keys() {
                let s = keys.id();
                if signers.contains(&s) && !out.contains_key(&s) {
                    out.insert(s, keys.clone());
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
        let logs = vault_ids(&store.log, store.view(), vec![vault]);
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

    /// Device `d` takes a device's claim (`claim`): a server no vault has claimed yet, of it (P8f). `d` signs the claim's
    /// edit too, in its place among the edit's signers, and keeps it, with the vault logs the claim brings, only if every
    /// signature checks out and, with them, its view makes `d` a device of a device vault. So the first human vault to
    /// claim the server owns its device vault, through the coops of its seed, and the server acts for that vault but
    /// never governs it. The join, for the claiming device to keep too: the edit, signed, and the McEliece key it names,
    /// `d`'s own. `AlreadyMember` as `claim_key` says, or if `d` belongs to a vault; `NotClaiming` if the edit adds
    /// another device, seals to another key than `d`'s, or adds it to anything but a device vault; `BadSignature` if a
    /// signature doesn't verify, or one is missing or left over; otherwise why `d`'s view, with the logs the claim
    /// brings, refuses the edit.
    pub fn accept_claim(&mut self, d: SignerId, claim: Claim) -> Result<Join, Refusal> {
        // of every edit it holds, not of a replay under way (`vault_of`)
        self.step_replay(d, usize::MAX);
        if self.vault_of(d).is_some() {
            return Err(Refusal::AlreadyMember);
        }
        let key = self.claim_key(d)?;
        let Claim { card, add, sigs } = claim;
        let Action::Share(Sharing::Device { vault, device, seal_to: Some(sealed) }) = &add.action else {
            return Err(Refusal::NotClaiming);
        };
        if *device != d || *sealed != key {
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
        let own = self.sign_by(d, add.id(), &[], &[], None, &[])?;
        let mut theirs = sigs.into_iter();
        let all: Option<Vec<Signature>> = add.sigs().map(|s| if s == d { Some(own.clone()) } else { theirs.next() }).collect();
        let all = all.filter(|_| theirs.next().is_none()).ok_or(Refusal::BadSignature)?;
        let signed = Signed { edit: add, sigs: all };
        signed.verify()?;
        // with the logs it brings, its view accepts the edit, and makes it a device of a device vault: checked on a copy
        // of the little it holds
        let mut log = self.held(d).log.clone();
        log.receive(card.iter().map(|s| s.edit.clone()));
        log.trust(&bare);
        log.view().step(&signed.edit)?;
        log.receive([signed.edit.clone()]);
        if !log.view().vault(vault).is_some_and(|v| claimable(v.kind) && v.devices.contains(&d)) {
            return Err(Refusal::NotClaiming);
        }
        let blobs: Blobs = self.seal_public(d).map(|(_, blob)| (key.mceliece, blob)).into_iter().collect();
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
        let sig = match self.keys.get_mut(&s).ok_or(Refusal::Locked)? {
            Key::Consent(k) if standing.contains(&s) => return Ok(k.consent.clone()),
            key => key.sign(id).ok_or(Refusal::Locked)?,
        };
        if matches!(self.keys.get(&s), Some(Key::Device(_))) {
            if let Some(events) = self.signing_events.get_mut(&s) {
                events.record(id);
            }
        }
        self.batched(s, id, &sig);
        Ok(sig)
    }

    /// Enable production event capture before a node begins accepting mutations. For a
    /// device's first enrollment only, the caller wraps its existing history once in the
    /// order returned here, each checked against its actual Device signature. Bare
    /// checkpoint-trusted records remain legacy records; they cannot mint new roots.
    /// A resumed ledger uses its own authenticated persisted order instead.
    pub fn capture_signing(&mut self, s: SignerId) -> Vec<EditId> {
        self.start_capturing_signing(s);
        let held = self.held(s);
        held.log.ids().iter().filter_map(|id| {
            let signed = held.signed.get(id)?;
            let at = signed.edit.sigs().position(|signer| signer == s)?;
            let sig = signed.sigs.get(at)?;
            (matches!(&sig.keys, SignerKeys::Device { .. }) && sign::signs(&signed.edit, *id, s, sig))
                .then_some(*id)
        }).collect()
    }

    /// Resume event capture with the order already authenticated by its signer ledger.
    /// This does no legacy scan or signature verification at ordinary restarts.
    pub fn start_capturing_signing(&mut self, s: SignerId) {
        self.signing_events.entry(s).or_default();
    }

    /// Stop an unsupported or conflicted ledger's capture. Ordinary per-edit signatures
    /// continue to authenticate every write; no batch publication follows this transition.
    pub fn stop_capturing_signing(&mut self, s: SignerId) {
        self.signing_events.remove(&s);
    }

    pub fn signing_pending(&self, s: SignerId) -> bool {
        self.signing_events.get(&s).is_some_and(batch::SigningEvents::pending)
    }

    pub fn signing_capture(&self, s: SignerId) -> Option<batch::SigningCapture> {
        self.signing_events.get(&s)?.capture()
    }

    pub fn signing_saved(&mut self, s: SignerId, capture: &batch::SigningCapture) -> bool {
        self.signing_events.get_mut(&s).is_some_and(|events| events.acknowledge(capture))
    }

    /// Sign a root of this device's already persisted signer ledger. The storage layer
    /// calls this only after an atomic segment acknowledgement; a locked or non-device
    /// key cannot produce a root. A signature is not itself a publication receipt.
    pub fn sign_persisted_root(&self, root: batch::Root) -> Option<batch::SignedRoot> {
        let Key::Device(key) = self.keys.get(&root.log)? else {
            return None;
        };
        Some(batch::SignedRoot::sign(key, root))
    }

    /// Device `s`'s batch-signed log, wrapped as it stands where it holds none yet: the edits its store holds that it
    /// signed, in the order it holds them (`SignerLog::wrap`). None for a signer that is no device here.
    fn wrapped(&mut self, s: SignerId) -> Option<(&mut SignerLog, &DeviceKey)> {
        let Some(Key::Device(key)) = self.keys.get(&s) else {
            return None;
        };
        if !self.batches.contains_key(&s) {
            let own: Vec<EditId> = self.stores.get(&self.at(s)).map_or(vec![], |store| {
                let held = store.log.edits().iter().zip(store.log.ids());
                held.filter(|(e, _)| e.sigs().any(|x| x == s)).map(|(_, id)| *id).collect()
            });
            self.batches.insert(s, SignerLog::wrap(s, own));
        }
        Some((self.batches.get_mut(&s).expect("wrapped"), key))
    }

    /// Device `s` signed edit `id`, `sig` its signature: the edit goes at the end of the device's batch-signed log. A
    /// debug build signs the batch at once, as a free device does (group commit), and holds the edit's path up to it to
    /// the signature: each must check as the other does (V5), as the stored view is held to the whole replay.
    fn batched(&mut self, s: SignerId, id: EditId, sig: &Signature) {
        if !cfg!(debug_assertions) {
            return;
        }
        let Some((log, key)) = self.wrapped(s) else {
            return;
        };
        log.write(id);
        log.commit(key);
        let shown = log.proof(id).is_some_and(|p| batch::Roots::new().check(s, id, &p));
        let signed = sign::verify(s, id, sig);
        debug_assert_eq!(shown, signed, "a path up a signed root checks as the signature beside it");
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

    /// The vault device `d` belongs to, by its replay: of every edit it holds, but while a replay is under way, of the
    /// edits run so far, none at all after a restore whose stored view didn't open. Where "no vault" is acted on, it is
    /// read dry (`dry`), its replay stepped on in place to every edit first: a Mac that asked mid replay put its shelf
    /// aside (theOS 296eefce, 2026-10-29).
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
        vault_ids(&store.log, st, vs)
    }

    /// Lock device `d`: its keys, and every key and item they opened, leave its memory, each key wiped, and so do the
    /// device keys held beside the Lab's devices. So does the secret half of each of
    /// their McEliece pairs that nothing else here holds (`keys::forget_pairs`): another signer's own key, a key
    /// another device holds, or a spare. Its edits and their ciphertext stay, and it still receives and passes on
    /// edits.
    pub fn lock(&mut self, d: SignerId) {
        self.hand_keys.remove(&d);
        // its log is wrapped again as it stands at its next unlock
        self.batches.remove(&d);
        let own = self.keys.remove(&d).and_then(|k| k.seal_secret()).map(|s| s.id());
        let mut gone: BTreeSet<KeyId> = own.into_iter().collect();
        // and the device keys held beside its devices
        let devices = &self.devices;
        let beside = self.keys.iter().filter(|(s, k)| matches!(k, Key::Device(_)) && !devices.contains(s));
        let beside: Vec<SignerId> = beside.map(|(s, _)| *s).collect();
        for s in beside {
            self.batches.remove(&s);
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
        let Some(&(passkey, nonce)) = self.salts.get(&d) else {
            return false;
        };
        let Some(Key::Passkey(p)) = self.keys.get(&passkey) else {
            return false;
        };
        let key = p.device(nonce);
        assert_eq!(key.id(), d, "the same passkey and salt derive the same device");
        self.take_key(d, key);
        true
    }

    /// Unlock device `d` with `secret`, the secret its keys come from, as a browser's device unlocks with what its
    /// passkey's ceremony brings back (P8e, `device_with`): its keys derive again. False if they derive another device.
    pub fn unlock_with(&mut self, d: SignerId, secret: [u8; 32]) -> bool {
        let Some(key) = DeviceKey::of(secret, d) else {
            return false;
        };
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
        // its log is wrapped as it stands, and it signs one root over it (a debug build, `batches`)
        if cfg!(debug_assertions)
            && let Some((log, key)) = self.wrapped(d)
        {
            log.commit(key);
        }
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
        self.checked_prepared(to, edits, &HashMap::new())
    }

    fn checked_prepared(&mut self, to: SignerId, edits: Vec<Signed>, prepared: &HashMap<EditId, bool>) -> Vec<Signed> {
        let (at, offered) = (Perf::start(), edits.len() as u64);
        let new = self.stores.get(&self.at(to)).map_or(0, |store| {
            edits.iter().map(|s| s.edit.id()).filter(|id| !store.signed.contains_key(id)).collect::<HashSet<_>>().len()
        });
        let fresh = self.fresh_prepared(to, edits, &HashSet::new(), prepared);
        if let Some(store) = self.stores.get_mut(&self.at(to)) {
            store.perf.add("check", at);
            store.perf.count("edits offered", offered);
            store.perf.count("edits checked", fresh.len() as u64);
            // new edits whose signatures didn't check out: a peer sends them again on every asking, and their log reads
            // as lacked for good
            if new > fresh.len() {
                store.perf.count("edits dropped: signatures", (new - fresh.len()) as u64);
            }
        }
        fresh
    }

    /// `keep`, of edits from a peer: where `to` is a gated server (`gate`), only what its gate takes of the new edits
    /// whose signatures check out (`gate::takes`), the vault it serves its device vault's one owner; nothing of them if
    /// it takes nothing.
    fn take(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs) -> bool {
        self.take_prepared(to, edits, blobs, &HashMap::new())
    }

    fn take_prepared(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs, prepared: &HashMap<EditId, bool>) -> bool {
        let stubbed = self.stubbed(to, &edits);
        let changed = self.take_checked(to, edits, blobs, prepared);
        if !stubbed.is_empty() {
            self.unstub(to, stubbed);
        }
        changed
    }

    /// Of the bodies `edits` device `to` takes, those of its stubs, each with whether its stub lied about it (S5).
    fn stubbed(&self, to: SignerId, edits: &[Signed]) -> Vec<(EditId, bool)> {
        let Some(store) = self.stores.get(&self.at(to)).filter(|s| !s.lazy.stubs.is_empty()) else {
            return vec![];
        };
        let of = |s: &Signed| {
            let id = s.edit.id();
            store.lazy.stubs.get(&id).map(|(stub, _)| (id, stub.lies(&s.edit, id)))
        };
        edits.iter().filter_map(of).collect()
    }

    /// Device `to` took bodies of its stubs, `stubbed`: of each it now holds, its stub goes, and a stub that lied is
    /// told of its peer (`stub_liars`). A body it took not leaves its stub there, asked for until a body comes (S3).
    fn unstub(&mut self, to: SignerId, stubbed: Vec<(EditId, bool)>) {
        let store = self.stores.get_mut(&self.at(to)).expect("a device");
        for (id, lied) in stubbed {
            if !store.signed.contains_key(&id) {
                continue;
            }
            if let Some((_, from)) = store.lazy.stubs.remove(&id)
                && lied
            {
                store.lazy.liars.push((from, id));
            }
        }
        // the stubs it counted as held changed: so does what it asks with
        *store.answers.basis.lock().expect("request basis") = None;
    }

    fn take_checked(&mut self, to: SignerId, edits: Vec<Signed>, blobs: &Blobs, prepared: &HashMap<EditId, bool>) -> bool {
        let mut fresh = self.checked_prepared(to, edits, prepared);
        if let Some(home) = self.home(to).filter(|_| !fresh.is_empty()) {
            self.step_replay(to, usize::MAX);
            let store = self.held(to);
            // a vault new to what it knows comes only by a genesis: one in the batch, or one it holds that stands not
            // yet and the batch could let stand. With neither, `gate::takes` takes the whole batch, and its replay of
            // every edit held (4.4-4.9 s a page on the server, 2026-10-27) is skipped.
            let genesis = |e: &Edit| matches!(e.action, Action::Genesis { .. });
            let latest = self.latest(to);
            let standing = store.log.edits().iter().zip(store.log.ids()).all(|(e, id)| !genesis(e) || latest.vault(VaultId::from(*id)).is_some());
            if standing && !fresh.iter().any(|s| genesis(&s.edit)) {
                return self.keep_fresh(to, fresh, blobs);
            }
            let batch = fresh.iter().map(|s| s.edit.clone()).collect();
            let taken = gate::takes(home, store.log.edits(), self.latest(to), batch, &store.readings);
            let ids: HashSet<EditId> = taken.unwrap_or_default().iter().map(Edit::id).collect();
            let before = fresh.len();
            fresh.retain(|s| ids.contains(&s.edit.id()));
            if fresh.len() < before && let Some(store) = self.stores.get_mut(&self.at(to)) {
                store.perf.count("edits dropped: gate", (before - fresh.len()) as u64);
            }
        }
        self.keep_fresh(to, fresh, blobs)
    }

    /// Of `edits`, those device `to` doesn't hold yet whose signatures check out, each once: an edit it holds was
    /// checked when it arrived, and a copy with other signatures adds nothing. An edit a checkpoint it holds or one
    /// among `edits` covers comes unchecked, on that checkpoint's word, its signatures or none: its replay lets go of
    /// it unless one that stands vouches for it (`refresh`).
    fn fresh(&self, to: SignerId, edits: Vec<Signed>, vouched: &HashSet<EditId>) -> Vec<Signed> {
        self.fresh_prepared(to, edits, vouched, &HashMap::new())
    }

    fn fresh_prepared(&self, to: SignerId, edits: Vec<Signed>, vouched: &HashSet<EditId>, prepared: &HashMap<EditId, bool>) -> Vec<Signed> {
        let Some(store) = self.stores.get(&self.at(to)) else {
            return vec![];
        };
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
        let mut unchecked = Vec::new();
        for i in unsealed {
            match prepared.get(&rest[i].edit.id()) {
                Some(&valid) => ok[i] = valid,
                None => unchecked.push(i),
            }
        }
        let to_check: Vec<Signed> = unchecked.iter().map(|&i| rest[i].clone()).collect();
        for (i, fine) in unchecked.into_iter().zip(checked_all(&to_check)) {
            ok[i] = fine;
        }
        bare.into_iter().chain(rest.into_iter().zip(ok).filter_map(|(s, ok)| ok.then_some(s))).collect()
    }

    /// `fresh`, for a restore a page at a time (`restore_page`): the new edits of `page` in the order they came, those
    /// whose signatures check out, that `vouched` names or that a checkpoint it holds or of the page covers; and apart,
    /// those whose signatures don't, which a checkpoint of a later page may cover yet (`restore_end`).
    fn fresh_in_order(&self, to: SignerId, page: Vec<Signed>, vouched: &HashSet<EditId>) -> (Vec<Signed>, Vec<Signed>) {
        let Some(store) = self.stores.get(&self.at(to)) else {
            return (vec![], vec![]);
        };
        let mut seen = HashSet::new();
        let new: Vec<Signed> =
            page.into_iter().filter(|s| { let id = s.edit.id(); !store.signed.contains_key(&id) && seen.insert(id) }).collect();
        let batch = covered(new.iter().map(|s| &s.edit));
        let trusted = |s: &Signed| {
            let id = s.edit.id();
            store.covers.contains(&id) || batch.contains(&id) || vouched.contains(&id)
        };
        let to_check: Vec<&Signed> = new.iter().filter(|s| !trusted(s)).collect();
        let fine: HashSet<EditId> = to_check.iter().copied().zip(checked_refs(&to_check)).filter(|(_, ok)| *ok)
            .map(|(s, _)| s.edit.id()).collect();
        new.into_iter().partition(|s| trusted(s) || fine.contains(&s.edit.id()))
    }

    /// Device `to` keeps `fresh`, new edits whose signatures checked out (`fresh`), and the blobs among `blobs` they
    /// name. True if there were any.
    fn keep_fresh(&mut self, to: SignerId, fresh: Vec<Signed>, blobs: &Blobs) -> bool {
        self.keep_fresh_as(to, fresh, blobs, true, None)
    }

    /// `keep_fresh`, where `step` says a single write may step on what its edits say now (`latest`): not as it
    /// restores, which replays once it took every page.
    /// `placed` says where its shelf holds those of them it holds (`restore_page_placed`).
    fn keep_fresh_as(
        &mut self,
        to: SignerId,
        fresh: Vec<Signed>,
        blobs: &Blobs,
        step: bool,
        placed: Option<&HashMap<EditId, Placed>>,
    ) -> bool {
        let Some(store) = self.stores.get_mut(&self.at(to)) else {
            return false;
        };
        let at = Perf::start();
        // its own write, one, drafted on everything it holds: what its edits say now is what they said, that write
        // stepped on, with no replay (`latest`)
        let stepped = match &fresh[..] {
            [one] if step && store.based.is_empty() => {
                let whole = store.replayed == store.log.edits().len();
                let was = store.latest.get().or(whole.then_some(&store.replay.state));
                // the deepest edit it holds: its replay's last, or one it took since (`replay_on_why`)
                let edits = store.log.edits();
                let since = edits.get(store.replayed..).unwrap_or(edits).iter().map(|e| e.depth);
                let deepest = store.replay.edits(store.log.edits()).next_back().map(|e| e.depth).into_iter().chain(since).max();
                debug_assert_eq!(deepest, edits.iter().map(|e| e.depth).max(), "the replay's last edit is its deepest");
                was.and_then(|was| stepped_on(was, deepest, to, &one.edit))
            }
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
                if let Some(bytes) = blobs.get(&b)
                    && !store.blobs.contains_key(&b)
                {
                    store.blobs.insert(b, bytes.clone());
                }
            }
            let mut edit = signed.edit.clone();
            match placed.and_then(|p| p.get(&id)) {
                Some(p) => store.signed.insert_placed(id, signed, p),
                None => store.signed.insert(id, signed),
            }
            // spilled, the log's copy reads its bulk bytes back from the record that went in (`bulk`)
            if let Some(place) = store.signed.place(&id) {
                edit.shelve(place);
            }
            store.log.receive_ids([(edit, id)]);
            new = true;
        }
        if new {
            store.digests = None;
            store.latest = OnceLock::new();
            if let Some(state) = stepped {
                #[cfg(not(avendb_no_replay_checks))]
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
        let signed: Vec<Signed> = ids.iter().map(|id| store.signed.owned(id)).collect();
        let blobs = signed
            .iter()
            .flat_map(|s| s.edit.blobs())
            .filter_map(|b| Some((b, store.blobs.get(&b)?)))
            .collect();
        (signed, blobs)
    }

    /// Device `from` hands vault `v`'s log to device `to`, as when two people exchange contact cards: a peer needs a
    /// vault's log before it accepts a share to that vault.
    pub fn share_contact(&mut self, from: SignerId, to: SignerId, v: VaultId) {
        let store = self.held(from);
        let ids = vault_ids(&store.log, store.view(), vec![v]);
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
        let logs = vault_ids(&store.log, st, vaults);
        Ok(logs.into_iter().chain(cp.chain.iter().map(|c| EditId(c.0))).collect())
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
                #[cfg(not(avendb_no_replay_checks))]
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
            false => Cow::Owned(store.log.replay()),
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
        let mut batch: Vec<EditId> =
            sets.iter().flat_map(|(_, _, drafts)| drafts.iter().map(|d| d.edit.id())).collect();
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
        let catching = self.catching_up(on);
        self.keep(on, vec![signed], &blobs);
        self.refresh_own(on, &lent, catching);
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
        let store = stores.get_mut(&at).unwrap_or_else(|| panic!("{on:?} is no device of the Lab"));
        // the store's key index, grown on to its replay, never one made again of every edit for each share
        let ix = KeyIndexed::take(store);
        let key = Secret::generate(rng);
        let sealed = keys::seal_edit(&key, &slice.to_wire(), &share_context(of), rng);
        let bound = |to: &Recipient| share_select_info(of, key.id(), to);
        let mut boxes = vec![];
        let st = store.view();
        let mut unknown = false;
        let mut lacking = None;
        for v in readers {
            let seed = st.current(KeyFam::Seed(v));
            match key_box(&key, seed, &bound, st, store, &ix, &[], rng) {
                Some(b) => boxes.push(b),
                None if needed.contains(&v) => {
                    (unknown, lacking) = (true, seal_key(seed, st, &ix));
                    break;
                }
                None => {}
            }
        }
        // a seed's key it lacks it asks a peer for (`Store::sealing`), and the share goes once it came
        store.sealing.extend(lacking.filter(|b| !store.blobs.contains_key(b)));
        KeyIndexed::put(store, ix);
        if unknown {
            return Err(Refusal::UnknownKey);
        }
        Ok(Select::Sealed { boxes, slice: sealed, commitment: slice.grant.commitment() }.to_wire())
    }

    /// Bring device `d`'s keys, audiences and items up to date with its edits, `lent` holding the keys of owners
    /// signing on it right now. Each round replays its edits, opens and derives what it can, reads what that opens, and
    /// makes the edits its upkeep calls for (`upkeep`). A locked device only replays.
    fn refresh(&mut self, d: SignerId, lent: &[(SignerId, Secret)]) {
        self.refresh_with(d, lent, None);
    }

    /// Whether device `d` is in the middle of a catch-up a step at a time (`catch_up_step`): behind, or with a replay
    /// under way, entries left to show or bodies left to open.
    pub fn catching_up(&self, d: SignerId) -> bool {
        self.stores.get(&self.at(d)).is_some_and(|s| {
            s.behind || s.replaying.is_some() || s.showing.is_some() || !s.read_new.left.is_empty()
        })
    }

    /// `refresh` after a write of device `on`'s own: in the middle of a catch-up (`catching`), one step of it, which
    /// shows the entries of new writes first (`show_items`), and the catch-up's next steps the rest. A person's write
    /// waits for no showing of a whole page, nor a first sync's replay (`CatchUpBudget.lean`, G5, 2026-10-27: 400 ms
    /// at 32,000 edits, the page it came in the middle of shown at once).
    fn refresh_own(&mut self, on: SignerId, lent: &[(SignerId, Secret)], catching: bool) {
        if catching {
            // a removal of its own can't step on (it goes back over what it holds): its replay is stepped on in place to
            // every edit once, as an ask's (`dry`), and its catch-up goes on from there, so the person sees what they
            // removed gone at once, not after a whole replay run a slice a step (a removed device listed on, fresh11)
            let store = self.held(on);
            let mine = |e: &Edit| (e.author == on || e.cosigners.contains(&on)) && e.is_removal();
            if store.log.edits().get(store.replayed..).unwrap_or_default().iter().any(mine) {
                self.step_replay(on, usize::MAX);
            }
            self.refresh_with(on, lent, Some(OWN_WRITE_BUDGET));
        } else {
            self.refresh(on, lent);
        }
    }

    /// `refresh`, showing at most `budget` entries anew (`show_items`) if there is one: true if it is done, else it is
    /// still behind, and `show_more` and then another `refresh_with` go on from where it left off (`catch_up_step`).
    fn refresh_with(&mut self, d: SignerId, lent: &[(SignerId, Secret)], budget: Option<usize>) -> bool {
        // a session's store is its host's, which opens what it holds with its own keys
        let d = self.at(d);
        // with a budget its replay steps on a slice at most (`step_replay`), and the rest waits for the next step
        if let Some(b) = budget {
            self.step_replay(d, b.max(1).saturating_mul(REPLAY_WORK));
            if let Some(store) = self.stores.get_mut(&d)
                && store.replayed < store.log.edits().len()
                && store.latest.get().is_none()
            {
                store.behind = true;
                return false;
            }
            // and its key index, made again of every edit after a whole replay, grows a slice at most
            let unlocked = self.keys.get(&d).and_then(Key::seal_secret).is_some();
            if unlocked && let Some(store) = self.stores.get_mut(&d) && KeyIndexed::step(store, b.max(1).saturating_mul(INDEX_WORK)) {
                store.behind = true;
                return false;
            }
        }
        if let Some(store) = self.stores.get_mut(&self.at(d)) {
            store.behind = false;
        }
        let own = self.keys.get(&d).and_then(Key::seal_secret);
        let unlocked = own.is_some();
        let mine: Vec<(SignerId, Secret)> = own.map(|o| (d, o)).into_iter().chain(lent.iter().cloned()).collect();
        // the owners' base overlay of a device's based entries is kept out for a whole refresh and laid back as it was
        // after it; a step of a catch-up lays it again after each step instead (`rebuild_owner_bases`: 16 bases at
        // most, each at most 1 MiB, a bound of its own, not of the log's), so that every step stays bounded
        let mut retained = if unlocked && budget.is_none() { self.take_owner_overlay(d) } else { None };
        let began = Perf::start();
        for round in 0.. {
            let Lab { stores, rng, spares, .. } = self;
            let Some(store) = stores.get_mut(&d) else {
                return true;
            };
            store.bootstrap_state=None;
            store.based.clear();
            store.recontext();
            store.perf.count("refresh rounds", 1);
            let at = Perf::start();
            // a removal may take writes from the middle of an entry's: what it shows is checked against them all
            let fresh = store.log.edits().get(store.replayed..).unwrap_or_default();
            store.reshow |= store.replayed == 0 || fresh.iter().any(Edit::is_removal);
            let was = std::mem::replace(&mut store.replay, replay(&[]));
            let back = (store.replayed > 0 && store.replayed < store.log.edits().len())
                .then(|| was.back(&store.log.edits()[..store.replayed], &store.log.edits()[store.replayed..]));
            let (replayed, why) = replay_on_why(was, store.log.edits(), store.replayed);
            if let (Why::Whole(_), Some(back)) = (why, back) {
                store.perf.count(back_counted(back), 1);
            }
            // a whole replay a step at a time under way is of fewer edits than this one: it goes
            store.replaying = None;
            store.replay = replayed;
            store.wholes += matches!(why, Why::Whole(_)) as u64;
            store.perf.count(why_counted(why), 1);
            store.replayed = store.log.edits().len();
            #[cfg(not(avendb_no_replay_checks))]
            debug_assert!(store.replay == replay(store.log.edits()), "a replay stepped on differs from the whole");
            // the replay is of every edit it holds now, so it is `latest` itself: no second copy
            store.latest = OnceLock::new();
            store.perf.add("replay", at);
            // the edits it holds on a checkpoint's word: those one that stands vouches for lose their signatures, the
            // rest keep theirs where they check out, and it lets go of the others and replays again (`trusted`)
            if !store.bare.is_empty() && trust(store) {
                // with a budget the replay of what it kept starts again a slice a step, at the next (`step_replay`):
                // in this round it was one of every edit in one turn
                if budget.is_some() {
                    store.behind = true;
                    store.perf.add("refresh", began);
                    self.rebuild_owner_bases(d);
                    return false;
                }
                continue;
            }
            // a locked device holds no key, and opens nothing
            if !unlocked {
                store.perf.add("refresh", began);
                return true;
            }
            let at = Perf::start();
            let ix = KeyIndexed::take(store);
            store.perf.add("keys: index", at);
            open_keys(store, &ix, &mine);
            store.perf.add("open keys", at);
            let at = Perf::start();
            let read_all = read(d, store, budget.map(|b| b.max(1).saturating_mul(READ_WORK)));
            store.perf.add("read", at);
            // a step that left bodies to open goes on with them at the next, showing nothing before they are open
            if !read_all && budget.is_some() {
                KeyIndexed::put(store, ix);
                store.behind = true;
                store.perf.add("refresh", began);
                self.rebuild_owner_bases(d);
                return false;
            }
            // what it shows, every write counted or not, before its upkeep: its stewards grant counted asks alone
            let at = Perf::start();
            // a budgeted one shows one entry here, after its keys and reading, which take their own while, and the rest after it
            // a budget a step (`show_more`)
            let shown = show_items(d, store, budget.map(|_| 1));
            store.perf.add("show items", at);
            // with no budget it leaves the entries a budgeted showing left before as they are: a catch-up a step at a
            // time shows them (`catch_up_step`), and its upkeep leaves them for then
            if !shown && budget.is_some() {
                KeyIndexed::put(store, ix);
                store.behind = true;
                store.perf.add("refresh", began);
                self.rebuild_owner_bases(d);
                return false;
            }
            let at = Perf::start();
            // a device holding stubs can't tell which boxes and keys its peers made of what they hold back: it makes
            // none until their bodies are in, or it would box again what is boxed, or make a key for an epoch that has
            // one; what is due for its upkeep waits for then (`UpkeepDue`)
            let mut sliced = false;
            // nor while a step of a catch-up left bodies to open: what it boxes or tags again may be in them
            let work = if store.lazy.stubs.is_empty() && store.read_new.left.is_empty() {
                let mut waiting: HashSet<EntryId> = store.showing.iter().flat_map(|s| s.rest.iter().copied()).collect();
                let scope = store.upkeep_due.scope(store);
                store.perf.count(if scope.is_some() { "upkeep: of the entries changed" } else { "upkeep: of every entry" }, 1);
                // the entries it looks at, `UPKEEP_SLICE` at most, in the order they were created; the rest wait, due,
                // for the next refresh, and it is behind till then
                let st = &store.replay.state;
                let mut due: Vec<EntryId> = match scope {
                    Some(s) => s.into_iter().filter(|e| !waiting.contains(e) && st.entry(*e).is_some()).collect(),
                    None => st.entries().iter().map(|en| en.id).filter(|e| !waiting.contains(e)).collect(),
                };
                due.sort_by_key(|e| st.entry_place(*e));
                let later: HashSet<EntryId> = due.split_off(due.len().min(UPKEEP_SLICE)).into_iter().collect();
                sliced = !later.is_empty();
                let showing = waiting.clone();
                waiting.extend(later.iter().copied());
                let scope: HashSet<EntryId> = due.into_iter().collect();
                store.perf.count("upkeep: entries looked at", scope.len() as u64);
                let work = upkeep(d, store, &ix, &mine, rng, spares, Some(&scope), &waiting);
                store.upkeep_due.looked(&store.log, &store.keys.scoped, store.slices.len(), store.shown_groups, &store.shown_lanes, showing, later);
                store.keys.entries_keyed.clear();
                work
            } else {
                vec![]
            };
            KeyIndexed::put(store, ix);
            store.behind |= sliced;
            store.perf.add("upkeep", at);
            if work.is_empty() && sliced && budget.is_some() {
                store.perf.add("refresh", began);
                self.rebuild_owner_bases(d);
                return false;
            }
            if work.is_empty() {
                store.perf.add("refresh", began);
                // still behind while a showing with a budget left entries to show, or a step bodies to open
                store.behind |= store.showing.is_some() || !store.read_new.left.is_empty();
                if !self.restore_owner_overlay(d, retained.take()) {
                    self.rebuild_owner_bases(d);
                }
                return true;
            }
            assert!(round < ROUNDS, "{d:?} keeps making edits its own view refuses: {work:?}");
            // what its edits say, every write counted: what it drafts on, its replay of this round
            let view = store.replay.state.clone();
            for w in work {
                self.work(d, &view, w);
            }
            // a step of a catch-up looks at one slice of the entries due for upkeep; the next step goes on
            if sliced && budget.is_some() {
                self.stores.get_mut(&d).expect("a device").perf.add("refresh", began);
                self.rebuild_owner_bases(d);
                return false;
            }
        }
        unreachable!("refresh rounds end by returning")
    }

    /// The next at most `budget` entries a `refresh_with` left to show, shown, if its edits and what it read are as
    /// it left them (`Store::showing`): true if there are none left, so that the next `refresh_with` finishes.
    fn show_more(&mut self, d: SignerId, budget: usize) -> bool {
        let d = self.at(d);
        let Some(store) = self.stores.get_mut(&d) else { return true };
        if store.showing.is_none() {
            return true;
        }
        let at = Perf::start();
        let done = show_items(d, store, Some(budget));
        store.perf.add("show items", at);
        // an entry it showed from its edits that its owners' base shows is laid over again (`rebuild_owner_bases`), so
        // that between steps it shows as before them
        if !store.bases.is_empty() {
            self.rebuild_owner_bases(d);
        }
        done
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
                    body: Default::default(),
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
    /// Steps device `d`'s replay on in place over the edits it took since (`replay_on_why`), as `refresh` begins, so
    /// that `latest` is the replay itself, not a copy of the whole state made under the Lab: the server cloned its
    /// 125,727-edit state for each page it took, holding the Lab 4.4-4.9 s a page (2026-10-27). What `refresh` does
    /// after its replay (keys, reading, showing) waits for it as before (`behind`), and a removal stepped on here is
    /// shown anew there (`reshow`).
    ///
    /// Where stepping on would replay every edit again (a first sync's, or new edits sorting before its place), the
    /// whole replay runs at most `most` edits a step (`ReplayRun`, `CatchUpBudget.lean`), the replay it held standing
    /// till then, so a first sync's 130,000 edits are hundreds of short turns, not one of 10-24 s (2026-10-27).
    fn step_replay(&mut self, d: SignerId, most: usize) {
        let Some(store) = self.stores.get_mut(&self.at(d)) else { return };
        if store.replayed == store.log.edits().len() || store.latest.get().is_some() {
            return;
        }
        let at = Perf::start();
        // a replay of them all under way goes on, where its log and the replay it began after are as they were
        let run = store.replaying.take().filter(|(head, from, run)| {
            store.log.of_log(*head) && *from == store.replayed && run.of() <= head.at as usize
        });
        let mut run = match run {
            Some((_, _, run)) => run,
            None => {
                // stepped on over at most `most` of the edits it took since (one by one, or the last `TAIL` with them):
                // a first sync's 130,000 stepped on at once took 10 s (2026-10-27)
                let to = store.log.edits().len().min(store.replayed.saturating_add(most.max(1)));
                let fresh = &store.log.edits()[store.replayed..to];
                store.reshow |= store.replayed == 0 || fresh.iter().any(Edit::is_removal);
                let was = std::mem::replace(&mut store.replay, replay(&[]));
                let back = (store.replayed > 0).then(|| was.back(&store.log.edits()[..store.replayed], fresh));
                match replay_on_or(was, &store.log.edits()[..to], store.replayed, most) {
                    Ok((replayed, why)) => {
                        store.replay = replayed;
                        store.perf.count(why_counted(why), 1);
                        store.replayed = to;
                        #[cfg(not(avendb_no_replay_checks))]
                        debug_assert!(store.replay == replay(&store.log.edits()[..to]), "a replay stepped on differs from the whole");
                        store.perf.add("replay", at);
                        return;
                    }
                    // the replay it held, as it was, stays what it shows until the one of every edit it holds (not of
                    // the slice: one replay, not one a slice) ends: from the rung or mark before the first of them, as
                    // far back as it is, else of every edit
                    Err((Some(was), why)) => {
                        store.replay = was;
                        store.reshow |= store.log.edits()[store.replayed..].iter().any(Edit::is_removal);
                        let begun = Perf::start();
                        let run = match rewind(&mut store.replay, store.log.edits(), store.replayed) {
                            Ok(run) => {
                                store.perf.count(why_counted(Why::Rung), 1);
                                store.perf.add("replay: begun from a mark", begun);
                                Replaying::From(run)
                            }
                            Err(_) => {
                                if let Some(back) = back {
                                    store.perf.count(back_counted(back), 1);
                                }
                                store.perf.count(why_counted(Why::Whole(why)), 1);
                                let whole = Perf::start();
                                let run = Replaying::Whole(ReplayRun::start(store.log.edits(), store.log.ids()));
                                store.perf.add("replay: begun whole", whole);
                                run
                            }
                        };
                        store.perf.add("replay: begun", begun);
                        run
                    }
                    // a move found late to keep not every write: rare, replayed whole at once as before
                    Err((None, why)) => {
                        store.replay = replay(store.log.edits());
                        store.wholes += 1;
                        store.perf.count(why_counted(Why::Whole(why)), 1);
                        store.replayed = store.log.edits().len();
                        store.perf.add("replay", at);
                        return;
                    }
                }
            }
        };
        let n = run.of();
        let edits = &store.log.edits()[..n];
        let ran = Perf::start();
        let all = match &mut run {
            Replaying::Whole(r) => r.step(edits, most),
            Replaying::From(r) => r.step(&store.replay, edits, most),
        };
        store.perf.add("replay: run", ran);
        if !all {
            store.replaying = Some((store.log.head(), store.replayed, run));
            store.perf.add("replay", at);
            return;
        }
        let ended = Perf::start();
        match run {
            Replaying::Whole(r) => {
                store.replay = r.finish(edits, &store.log.ids()[..n]);
                store.wholes += 1;
            }
            Replaying::From(r) => match r.finish(std::mem::replace(&mut store.replay, replay(&[])), edits) {
                Ok(r) => store.replay = r,
                // its moves stood not all: every edit replayed, a slice a step, from the next
                Err((was, why)) => {
                    store.replay = was;
                    store.perf.count(why_counted(Why::Whole(why)), 1);
                    let run = Replaying::Whole(ReplayRun::start(store.log.edits(), store.log.ids()));
                    store.replaying = Some((store.log.head(), store.replayed, run));
                    store.perf.add("replay", at);
                    return;
                }
            },
        }
        store.perf.add("replay: ended", ended);
        store.replayed = n;
        #[cfg(not(avendb_no_replay_checks))]
        debug_assert!(store.replay == replay(&store.log.edits()[..n]), "a replay run a slice a step differs from the whole");
        store.perf.add("replay", at);
    }

    /// What device `d` answers its peers and checks its person's writes by in the middle of a catch-up: the replay it
    /// holds, where the edits it took since hold no removal (they can only add to what anyone may do: it hands over and
    /// accepts no more than all of them would, `StandingReplay.lean`), else `latest`. A peer's ask or a write in the
    /// middle of a first sync replayed every edit first, 10-24 s at 130,000 (2026-10-27); the catch-up's next steps
    /// bring the rest. Only while a catch-up steps it on (`catching_up`): a device that isn't catching up has nothing
    /// to step its replay on, and answered from it every ask after an edit it took came back without that edit, until
    /// something else replayed (`answer_current`; a drive re-plugged never got the note written meanwhile, 2026-10-28).
    fn standing(&self, d: SignerId) -> &State {
        self.standing_or(d).unwrap_or_else(|| self.latest(d))
    }

    /// `standing` answers by a replay behind device `d`'s log: what it answers now is less than it will once caught up.
    fn standing_lags(&self, d: SignerId) -> bool {
        let store = self.held(d);
        self.catching_up(d)
            && store.latest.get().is_none()
            && store.replayed < store.log.edits().len()
            && !store.log.edits()[store.replayed..].iter().any(Edit::is_removal)
    }

    /// Whether what device `d` answers its peers (`announce`, `request`) is by every edit it holds: false in the middle
    /// of a catch-up whose replay lags its log (`standing`), or where it answers nothing till then (`standing_or`).
    /// Whatever is worked out of its answers then and kept for its log's head is to be worked out again once it
    /// caught up, though its log didn't change: a node that kept whom to tell what so never told a peer of the edits
    /// the catch-up brought (2026-10-28, `answer_current`).
    pub fn answers_current(&self, d: SignerId) -> bool {
        !self.standing_lags(d) && self.standing_or(d).is_some()
    }

    /// `standing`, but `None` where it would replay every edit it holds: in the middle of a catch-up, with a removal
    /// among the edits it took since its replay. What answers a peer then answers nothing (`answered`,
    /// `may_fetch_file`, `withheld`), less than all its edits would, and only while the catch-up runs, whose steps bring
    /// its replay up to them (`answerBy` in `StandingReplay.lean`). A first sync of Maia City, whose pages hold removals,
    /// replayed every edit for each page's announce and each peer's ask, and never ended (S2, 2026-10-28).
    fn standing_or(&self, d: SignerId) -> Option<&State> {
        let store = self.held(d);
        if !self.catching_up(d) || store.latest.get().is_some() || store.replayed >= store.log.edits().len() {
            return Some(self.latest(d));
        }
        if !store.log.edits()[store.replayed..].iter().any(Edit::is_removal) {
            return Some(&store.replay.state);
        }
        None
    }

    /// What device `d` answers peer `asker` by (`StandingReplay.lean` `answerFor`): `standing_or`, and where that is none,
    /// in the middle of a catch-up with a removal among the edits past its replay, the replay it holds, unless one of
    /// those removals may concern `asker`: one that removes `asker`, or removes a device that ever shared anything
    /// (what it shared may be cut, and others' reach with it), or any other kind of removal (an owner's, a grant's),
    /// which concerns every peer. A Mac in the middle of its catch-up of Maia City, which holds removals, handed an
    /// iPhone that lacked 2,569 logs no page, and the iPhone asked by requests that named nothing (Fix C, 2026-10-28).
    fn standing_for(&self, d: SignerId, asker: SignerId) -> Option<(&State, Arc<Cuts>)> {
        if let Some(st) = self.standing_or(d) {
            return Some((st, Arc::default()));
        }
        let cuts = self.cuts(d);
        if cuts.all || cuts.removed.contains(&asker) {
            return None;
        }
        Some((&self.held(d).replay.state, cuts))
    }

    /// What the removals among device `d`'s edits that its replay hasn't reached may take away (`Cuts`), kept for its
    /// log's head and how far its replay is: one pass over its edits for the device removals among them, each
    /// with the edits the removed device signed that it doesn't keep. Until 2026-10-28 a device's removal took away
    /// everything from everyone wherever the removed device had ever signed a vault's share, kept or not: an iPhone in
    /// the middle of its catch-up of Maia City, whose history holds such removals, handed its Mac nothing, its own new
    /// chat message among it, for as long as the catch-up ran (Fix E).
    fn cuts(&self, d: SignerId) -> Arc<Cuts> {
        let store = self.held(d);
        let head = store.log.head();
        let mut cached = store.answers.cuts.lock().expect("cuts");
        if let Some((at, replayed, cuts)) = cached.as_ref()
            && *at == head
            && *replayed == store.replayed
        {
            return cuts.clone();
        }
        let (edits, ids, logs) = (store.log.edits(), store.log.ids(), store.log.logs());
        let mut cuts = Cuts::default();
        let mut keeps: HashMap<SignerId, Vec<HashSet<EditId>>> = HashMap::new();
        for r in edits[store.replayed..].iter().filter(|e| e.is_removal()) {
            match &r.action {
                Action::Revoke(crate::policy::Revoking::Device { device, keep, .. }) => {
                    cuts.removed.insert(*device);
                    keeps.entry(*device).or_default().push(keep.iter().copied().collect());
                }
                _ => cuts.all = true,
            }
        }
        if !cuts.all && !keeps.is_empty() {
            for (i, e) in edits.iter().enumerate() {
                // a vault's approval is its root's or its owners' signatures, never a device's (`State::approves`): an
                // edit of governance (a setting, an owner or a device given or taken, a checkpoint) stands whether or
                // not a device that signed it stays, its own addition among them; what rests on a device is what it
                // did acting for a vault, as a member of one
                if !acts(&e.action) {
                    continue;
                }
                for x in e.sigs().filter(|s| keeps.contains_key(s)) {
                    if keeps[&x].iter().all(|keep| keep.contains(&ids[i])) {
                        continue;
                    }
                    // a write to an entry, or its keys, changes what that entry's log holds alone; its creation or a
                    // mark changes where the entry stands, which shares a peer is handed rest on (`sync::Reach`)
                    let alone = matches!(&e.action, Action::Write { create: None, .. } | Action::Keys { .. } | Action::Wraps { .. });
                    match logs[i] {
                        Some(l @ LogId::Entry(_)) if alone => {
                            cuts.logs.insert(l);
                        }
                        // a signer's own key, of no log, is no part of anyone's standing
                        None => {}
                        Some(_) => cuts.all = true,
                    }
                }
                if cuts.all {
                    break;
                }
            }
        }
        let cuts = Arc::new(cuts);
        *cached = Some((head, store.replayed, cuts.clone()));
        cuts
    }

    /// Whether device `d` answers what its edits say now without replaying every edit it holds (`standing_or`): a
    /// background reader, as a node's file keeper, waits for its catch-up while it doesn't.
    pub fn answers_now(&self, d: SignerId) -> bool {
        self.standing_or(d).is_some()
    }

    fn latest(&self, d: SignerId) -> &State {
        let store = self.held(d);
        // set, it is what they say (a write stepped on, or the based entries' state); unset, the replay of them all is
        if let Some(state) = store.latest.get() {
            return state;
        }
        if store.replayed == store.log.edits().len() {
            return &store.replay.state;
        }
        store.latest.get_or_init(|| {
            // The maintained replay is a prefix of this held log, even while receive defers
            // materialization. Advance it with the SAME guards/fallback as refresh; never
            // expose its stale state directly. Withdrawal resets that prefix and restore
            // replaces the Store. Cloning still costs history work under Lab's lock.
            replay_on_why(store.replay.clone(), store.log.edits(), store.replayed).0.state
        })
    }

    /// The write `action` authored by device `on` alone, drafted on `view`, what `on`'s edits say, if `view` accepts
    /// it: the edit, and the write it is, with the shares its readers judge it by.
    fn check_write(&self, on: SignerId, view: &State, action: Action) -> Result<(Edit, Write), Refusal> {
        if let Action::Write { entry, vault, actor, proposal, deps, .. } = &action {
            if self.owner_base_durability_pending(on, *entry) || self.owner_base_wait_reason(on, *entry).is_some() { return Err(Refusal::ReadOnly); }
            if let Some(based) = self.held(on).based.get(entry)
                && (!based.writable || self.owner_base_pending(on, *entry) > 0 || self.held(on).replayed != self.held(on).log.edits().len() || *actor != *vault || *proposal != Proposal::Main || *deps != self.shown(on,*entry).heads(MAIN)) {
                return Err(Refusal::ReadOnly);
            }
        }
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
        let touches = read.touches.as_deref().map(|ts| h.mine().mark(w.signer, &[ts, needs].concat()));
        let attrs = if w.first { first.cloned() } else { view.at_write(w, readings).0 };
        let authorize = || self.prove(on, view, w, (touches.as_deref(), asks), attrs.as_ref());
        // Existing patched-app test mode remains explicit; ordinary local and remote
        // writes use the same dependency/landing/schema/proposal admission gate.
        if self.lawless { authorize() } else { h.admit(w, &read, authorize) }
    }

    /// Run `f` dry for device `d`: every edit it asks for, a write, a share, any edit it completes (`complete`), is
    /// checked, proven and refused as ever, and then not made (`may`). What it is checked by, every edit `d` holds
    /// (`latest`), is `d`'s own replay stepped on to them in place first (`step_replay`, from the rung or mark before the
    /// first it lacks), kept for its catch-up and for every ask after it. Mid catch-up each ask replayed them on a copy
    /// of the whole state that the next page threw away: a fresh browser's `may` asks held its one worker 283.8 s in 12
    /// turns, 122.8 s the longest (fresh9, 2026-10-29; `CatchUpBudget.asks_cost_once`).
    pub fn dry<T>(&mut self, d: SignerId, f: impl FnOnce(&mut Lab) -> T) -> T {
        self.step_replay(d, usize::MAX);
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
        let view = self.standing(on).clone();
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
            body: Default::default(),
        };
        let (edit, w) = self.check_write(on, &view, action)?;
        let attrs = Attrs { ty: header.ty.clone(), author: actor, entry, created: header.created, tags: tags.clone() };
        let tags = TagDelta { add: tags, remove: vec![] };
        let proof = match header.ty.of_lane() {
            true if !(lane_fits(&header.ty, &content) || self.lawless) => {
                return Err(Refusal::NotAView);
            }
            true => self.prove(on, &view, &w, (Some(&[Touch::Create]), &tags), Some(&attrs))?,
            false => self.proven(on, &view, (vault, &History::default()), &w, (&content, &tags), &[], Some(&attrs))?,
        };
        self.write(on, edit, Body { header: Some(header), tags, answers: vec![], content: content.into(), proof, files, defines }, x)
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
        let key = Passkey::from_seed(secret);
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
        let (store, st) = (self.held(on), self.standing(on));
        let ours = |cp: &&Issued| {
            let s = &cp.share;
            let read = (s.who, s.level, s.wide, s.parent) == (Who::Everyone, Level::Read, false, None);
            st.live(cp.id)
                && s.over == vault
                && s.issuer == vault
                && read
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
        let (store, st) = (self.held(on), self.standing(on));
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
        let vault = self.standing(on).entry(entry).ok_or(Refusal::UnknownEntry)?.vault;
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
        if self.held(on).based.contains_key(&entry) { return Err(Refusal::ReadOnly); }
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
        if self.held(on).based.contains_key(&entry) { return Err(Refusal::ReadOnly); }
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
        self.held(d).shown.get(&entry)?.items_in(Some(self.held(d))).get(&line).cloned()
    }

    fn shown(&self, d: SignerId, entry: EntryId) -> &History {
        static NONE: std::sync::LazyLock<History> = std::sync::LazyLock::new(History::default);
        self.held(d).shown.get(&entry).and_then(|s| s.history_in(self.held(d))).unwrap_or(&NONE)
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
        let view = self.standing(on).clone();
        let en = view.entry(entry).ok_or(Refusal::UnknownEntry)?;
        let (vault, stay, x) = (en.vault, en.stay(), en.audience());
        let epoch = view.epoch(KeyFam::Audience(vault, x));
        let Draft { proposal, deps, body: content } = draft;
        let (via, create) = (vec![], None);
        let action =
            Action::Write { vault, entry, actor, stay, epoch, deps, proposal, via, create, files: roots, body: Default::default() };
        let (edit, w) = self.check_write(on, &view, action)?;
        let proof = self.proven(on, &view, (vault, self.shown(on, entry)), &w, (&content, &tags), needs, None)?;
        self.write(on, edit, Body { header: None, tags, answers: vec![], content: content.into(), proof, files, defines }, x)
    }

    /// Encrypt `body` into the write `edit`, whose stay is in audience `x`, then sign and keep it (`seal_write`), and
    /// bring the device up to date. In a dry run, nothing: its id.
    fn write(&mut self, on: SignerId, edit: Edit, body: Body, x: AudienceId) -> Result<EditId, Refusal> {
        if self.dry {
            return Ok(edit.id());
        }
        let catching = self.catching_up(on);
        let id = self.seal_write(on, edit, body, x)?;
        match &mut self.held_back {
            Some(devices) => _ = devices.insert(on),
            None => self.refresh_own(on, &[], catching),
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
            *b = sealed.into();
        }
        let id = edit.id();
        let signed = self.sign(edit)?;
        self.keep(on, vec![signed], &Blobs::new());
        let store = self.stores.get_mut(&self.at(on)).expect("a device");
        store.bodies.insert(id, body);
        store.read_new.bodies.push(id);
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

    /// Whether log `log`, where device `d` lacks edits a peer holds, may change what a read of vault `vault` (none:
    /// every vault) that picks entries by `picks` shows (`Coverage.lean` `mayMatch`, conservative): the vault's own
    /// log and its audiences', and any share's, which decide who reads what; an entry's log of that vault whose
    /// creation `picks` may match (`Selector::may_match`); and an entry's `d` can't place yet, which may be any entry
    /// unless `picks` names its entries by id alone. A read's footprint is `engine::footprint`.
    pub fn may_change(&self, d: SignerId, log: LogId, vault: Option<VaultId>, picks: &Selector) -> bool {
        let store = self.held(d);
        let view = store.view();
        match log {
            LogId::Vault(v) | LogId::Audience(v, _) => vault.is_none_or(|x| x == v),
            LogId::Share(_) => true,
            LogId::Entry(e) => match view.entry(e) {
                None => picks.named().is_none_or(|(types, ids)| !types.is_empty() || ids.contains(&e)),
                Some(en) => vault.is_none_or(|x| x == en.vault)
                    && view.first_attrs(en, &store.readings).is_none_or(|a| picks.may_match(&a)),
            },
        }
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
        let (view, read_only) = self.lane(d, self.vault_of_entry(d, entry)?).view(app, &item.authored(), &item.record());
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
        let (view, read_only) = self.lane(on, vault).view(app, &item.authored(), &item.record());
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
        self.held(d).shown.get(&entry)?.items_in(Some(self.held(d))).get(&line)
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
        self.held(d).shown.get(&entry).and_then(|s| s.history_in(self.held(d)))
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
    /// A type scheduling/filter hint from already opened header metadata. This
    /// does not establish landed/read authorization and never hydrates a draft.
    pub(crate) fn entry_type_hint(&self, d: SignerId, entry: EntryId) -> Option<&str> {
        let store = self.held(d);
        let creation = store.view().entry(entry)?.creation;
        Some(store.readings.headers.get(&creation)?.ty.as_str())
    }

    /// The entries a query by selector `plan` may find on device `d`, of vault `vault` (of every vault, left out), in the
    /// order they were created, as `entries` has them. Where every conjunction of the plan names its types or its
    /// entries, they come off the index by type (`Readings::typed`), with the entries whose header it hasn't read
    /// (`Readings::untyped`), and the ids named, not off every entry the device holds (`spec/AvenDB/LiveQuery.lean`, `indexed_eq_scan`); the query then reads each one's meaning as before, so
    /// the index only has to miss none. Else every entry it holds.
    pub(crate) fn query_candidates(&self, d: SignerId, vault: Option<VaultId>, plan: &Selector) -> Vec<EntryId> {
        let Some((types, ids)) = plan.named() else {
            return self.entries(d).into_iter().filter(|e| vault.is_none_or(|v| self.vault_of_entry(d, *e) == Some(v))).collect();
        };
        let store = self.held(d);
        let state = store.view();
        let typed = types.iter().flat_map(|ty| store.readings.typed.get(ty).into_iter().flatten())
            .filter_map(|creation| state.write(*creation).map(|w| w.entry));
        let untyped = store.readings.untyped.iter().copied().filter(|_| !types.is_empty());
        let mut found: Vec<(usize, EntryId)> = typed.chain(untyped).chain(ids)
            .filter_map(|e| state.entry(e).filter(|en| vault.is_none_or(|v| en.vault == v)).map(|en| en.id))
            .filter(|e| self.sees(d, *e))
            .filter_map(|e| state.entry_place(e).map(|at| (at, e)))
            .collect();
        found.sort_unstable();
        found.dedup();
        found.into_iter().map(|(_, e)| e).collect()
    }

    /// Where entry `e` was created on device `d`: the depth of its creation edit, as its shared index orders entries
    /// (`index::shared`); `None` where its log holds no such edit.
    pub(crate) fn creation_depth(&self, d: SignerId, e: EntryId) -> Option<u64> {
        let store = self.held(d);
        store.log.entry_write(store.view().entry(e)?.creation).map(|c| c.depth)
    }

    /// The entries of vault `vault` (of every vault, left out) whose header device `d` hasn't read
    /// (`Readings::untyped`): a query by type can't place them yet, so each is a candidate that waits.
    pub fn untyped_of(&self, d: SignerId, vault: Option<VaultId>) -> Vec<EntryId> {
        let store = self.held(d);
        let state = store.view();
        store.readings.untyped.iter().copied()
            .filter(|e| state.entry(*e).is_some_and(|en| vault.is_none_or(|v| en.vault == v))).collect()
    }

    /// Every vault device `d`'s view knows, in the order they were created.
    pub fn view_vaults(&self, d: SignerId) -> Vec<VaultId> {
        self.held(d).view().vaults().iter().map(|v| v.id).collect()
    }

    /// `index_complete`, kept while device `d`'s query views are stamped as they were (`query_view_stamp`): whether a
    /// view of vault `vault` may list off the shared index alone.
    pub fn index_lists_all(&self, d: SignerId, vault: VaultId) -> bool {
        let store = self.held(d);
        let now = self.query_view_stamp(d);
        if let Some((at, yes)) = store.complete.lock().unwrap_or_else(|p| p.into_inner()).get(&vault) {
            if *at == now { return *yes; }
        }
        let yes = self.index_complete(d, vault);
        store.complete.lock().unwrap_or_else(|p| p.into_inner()).insert(vault, (now, yes));
        yes
    }

    /// Device `d`'s view knows vault `v` and gives it no standing there: it acts for no member or owner of `v`, and no
    /// live share over `v` reaches it, a vault it acts for, or everyone. A read of `v` answers `denied`
    /// (`Coverage.read`). A vault the view doesn't know yet is not denied: it may be on its way.
    pub(crate) fn denies_vault(&self, d: SignerId, v: VaultId) -> bool {
        let st = self.held(d).view();
        if st.vault(v).is_none() || st.acts_for(d, v) { return false; }
        !st.shares_over(v).any(|cp| st.live(cp.id) && match cp.share.who {
            Who::Everyone => true,
            Who::Device(s) | Who::Invite(s) => s == d,
            Who::Vault(x) => st.acts_for(d, x),
        })
    }

    /// What changed on device `d` since it held `edits` edits and `keys` McEliece keys (`size`): the entries whose logs
    /// took the edits after those, and their vaults; `all` where a change may touch any read (`LiveQuery.Change`).
    /// `gone`, how many times its log let edits go then (`Touched::gone`), where the caller knows it: else a change may
    /// have taken edits out, and touches everything.
    pub fn touched(&self, d: SignerId, edits: usize, keys: usize, gone: Option<u64>) -> Touched {
        let size = self.size(d);
        let store = self.held(d);
        let (log, ids) = (store.log.edits(), store.log.ids());
        let now = store.log.gone();
        let mut t = Touched { size, gone: now, all: size.0 < edits || size.1 != keys || gone != Some(now), ..Touched::default() };
        if t.all { return t; }
        for (edit, id) in log[edits..].iter().zip(&ids[edits..]) {
            match crate::sync::log_of(edit, *id) {
                Some(LogId::Entry(e)) => {
                    if let Some(v) = self.vault_of_entry(d, e) { t.vaults.insert(v); }
                    t.entries.insert(e);
                }
                None => {}
                Some(_) => { t.all = true; break; }
            }
            if t.entries.len() > Touched::MOST { t.all = true; break; }
        }
        if t.all { t.entries.clear(); t.vaults.clear(); }
        t
    }

    /// Device `d`'s query views (`query_view`).
    pub(crate) fn query_views(&self, d: SignerId) -> &std::sync::Mutex<QueryViews> {
        &self.held(d).query_views
    }

    /// The head a query view of device `d` is stamped with now (`query_view::Stamp`): its log's head, and its size and
    /// removals as `touched` reads them; the sum of what it works its items out of beside its log (`inputs`): the keys
    /// it holds, its McEliece keys, its owner bases, what it follows, its query depth and its gate; the sum of what a
    /// read depends on beside its log as it worked those out (`context`): its shares and the selectors it opened, its
    /// cap groups and lanes, the entries whose header it hasn't read and those it shows from a base; and whether it
    /// worked them all out of every edit it holds (`settled`).
    pub(crate) fn query_view_stamp(&self, d: SignerId) -> query_view::Stamp {
        use crate::hash::Hasher;
        let store = self.held(d);
        let mut inputs = Hasher::new("avenDB query view inputs 1");
        inputs.update(&store.keys.sum).update(&store.blobs.sum());
        for (e, base) in &store.bases {
            inputs.update(&e.0).update(&base.snapshot.0).update(&crate::hash::content(&base.sealed));
        }
        inputs.update(&(store.follow.len() as u64).to_be_bytes());
        for v in &store.follow { inputs.update(&v.0); }
        inputs.update(&(store.query_depth as u64).to_be_bytes()).update(&[store.gate as u8]);
        #[cfg(debug_assertions)]
        assert_eq!(store.context, store.context_sum(), "its context sum is kept as what it reads through changes");
        query_view::Stamp { head: store.log.head(), size: self.size(d), gone: store.log.gone(), inputs: inputs.finalize(),
            context: store.context, settled: store.showing.is_none() && !store.behind }
    }

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

    /// How many keys of `name` device `d` holds: more than one where devices made a family's key of one epoch at the
    /// same time, each its own.
    pub fn keys_held(&self, d: SignerId, name: KeyName) -> usize {
        self.held(d).keys.held(name).count()
    }

    /// The edits device `d` holds; `log(d).view()` is what they say, every write counted.
    pub fn log(&self, d: SignerId) -> &Log {
        &self.held(d).log
    }

    /// Device `d`'s batch-signed log while it is unlocked, in a debug build: wrapped when it unlocked, or at its first
    /// edit where it never locked (`batched`).
    pub fn signer_log(&self, d: SignerId) -> Option<&SignerLog> {
        self.batches.get(&d)
    }

    /// What device `d` currently reads: independently replayed policy, with an explicitly
    /// owner-attested entry baseline where one is active. `replay` remains the pure signed log.
    pub fn state(&self, d: SignerId) -> &State {
        self.held(d).view()
    }

    /// Pure replay of the signed edits device `d` holds; owner-attested entry overlays are
    /// separate and never alter the replay's kernel, signatures or standing decisions.
    pub fn replay(&self, d: SignerId) -> &Replay {
        &self.held(d).replay
    }

    /// Already-recorded timers and counters only. Unlike `perf`, this does not
    /// inspect history, compute vouching, or resolve authorization. Use it when
    /// measuring startup so the observation does not add diagnostic replay work.
    pub fn work_metrics(&self, d: SignerId) -> Value {
        self.held(d).perf.to_json()
    }

    /// Takes device `d`'s store out whole and hands it over, for a probe of what each part holds in memory to let go of
    /// it and count what that frees (`Probed::part`; `avendb-net/tests/memory/unlock_memory.rs`, `tests/memory/upkeep_memory.rs`).
    /// The Lab holds an empty store for `d` in its place, as a device holding nothing yet, so that whatever runs on it
    /// after (a node's catch-up, a peer's asking) finds a store that holds together. Until 2026-10-28 the probe took
    /// the parts out of the store in place: its log's edits went while its replay still counted 20,171 of them
    /// replayed, and the node's next catch-up step panicked in a worker (`step_replay`, the Mac's 20k probe).
    #[doc(hidden)]
    pub fn probe_store(&mut self, d: SignerId) -> Option<Probed> {
        let store = self.stores.get_mut(&self.at(d))?;
        let empty = Store { follow: store.follow.clone(), query_depth: store.query_depth, gate: store.gate, ..Store::default() };
        Some(Probed(std::mem::replace(store, empty)))
    }

    /// How far device `d`'s replay is behind the edits it holds, and whether its latest state is worked out: what a
    /// slow answer may be waiting on (`latest` replays the rest under the Lab's lock).
    pub fn replay_lag(&self, d: SignerId) -> Value {
        let store = self.held(d);
        serde_json::json!({ "edits": store.log.edits().len(), "replayed": store.replayed, "latest": store.latest.get().is_some() })
    }

    /// What device `d`'s work cost since it started (`perf`), and how much it holds: its edits, the bodies it opened,
    /// the entries it shows and the blobs it keeps.
    /// Stored view `sealed` of device `d` as an engine before `stored_readings` sealed it: its replay alone.
    #[cfg(feature = "test-fixtures")]
    pub fn view_without_readings(&mut self, d: SignerId, sealed: &[u8]) -> Option<Vec<u8>> {
        let key = self.shelf_key(d)?;
        let view = key.unlock("view", sealed, VIEW_RULES.as_bytes())?;
        let replay = Zeroizing::new(view_parts(&view)?.0.to_vec());
        Some(key.lock("view", &replay, VIEW_RULES.as_bytes(), &mut self.rng))
    }

    /// The hash of what device `d` read as its stored view seals it (`stored_readings::seal`), where it read every body
    /// its replay counts: what `tests/read_rules.rs` pins under the read rules' number.
    #[cfg(feature = "test-fixtures")]
    pub fn read_print(&self, d: SignerId) -> Option<String> {
        let store = self.held(d);
        Some(blake3::hash(&stored_readings::seal(store, store.replayed)?).to_hex().to_string())
    }

    pub fn perf(&self, d: SignerId) -> Value {
        let store = self.held(d);
        let mut out = store.perf.to_json();
        out["held"] = serde_json::json!({
            "edits": store.log.edits().len(),
            "bodies": store.bodies.len(),
            // of those its stored view said it opened, how many it opened as they were asked for (`Bodies::get`)
            "bodies_opened_late": store.bodies.opened_late(),
            "shown": store.shown.len(),
            "blobs": store.blobs.len(),
            "blob_bytes": store.blobs.bytes(),
            // what it holds of its edits and keys in memory, spilled or not (S7), and what its spills hold on disk
            "memory": { "edits": store.signed.memory(), "keys": store.blobs.memory(),
                // what its log of edits and its key index hold, beside the signed edits above (F9)
                "log": store.log.edits().iter()
                    .map(|e| size_of::<Edit>() + (e.parents.len() + e.cosigners.len()) * 32 + e.action.heap_bytes())
                    .sum::<usize>(),
                "key_index": store.key_ix.ix.boxes.len() * size_of::<IndexedBox>(),
                "spilled": store.signed.spilled_bytes() + store.blobs.spilled_bytes(),
                "spilling": store.signed.is_spilled() },
        });
        // its edits by the log each is of and by what it does: how much of a replay the entries' own logs are, which a
        // snapshot spares (S7c), and how much is key upkeep
        let (mut logs, mut actions) = (BTreeMap::<&str, u64>::new(), BTreeMap::<&str, u64>::new());
        for (edit, id) in store.log.edits().iter().zip(store.log.ids()) {
            let log = match log_of(edit, *id) {
                Some(LogId::Vault(_)) => "vault",
                Some(LogId::Share(_)) => "share",
                Some(LogId::Audience(..)) => "audience",
                Some(LogId::Entry(_)) => "entry",
                None => "signer",
            };
            let action = match &edit.action {
                Action::Genesis { .. } => "genesis",
                Action::Settings { .. } => "settings",
                Action::Share(_) => "share",
                Action::Revoke(_) => "revoke",
                Action::Write { .. } => "write",
                Action::Mark { .. } => "mark",
                Action::Keys { .. } => "keys",
                Action::Claim { .. } => "claim",
                Action::Wraps { .. } => "wraps",
                Action::Checkpoint { .. } => "checkpoint",
                Action::Snapshot { .. } => "snapshot",
            };
            *logs.entry(log).or_default() += 1;
            *actions.entry(action).or_default() += 1;
        }
        out["held"]["logs"] = serde_json::json!(logs);
        out["held"]["actions"] = serde_json::json!(actions);
        // the vaults' checkpoints that stand, and the edits it holds on their word, without their signatures
        let r = &store.replay;
        let checkpoint = |(e, stood): (&Edit, &bool)| *stood && matches!(e.action, Action::Checkpoint { .. });
        out["checkpoints"] = serde_json::json!({
            "standing": r.edits(store.log.edits()).zip(&r.stood).filter(|&x| checkpoint(x)).count(),
            "vouched": r.vouched(store.log.edits()).len(),
            "bare": store.bare.len(),
        });
        out
    }

    /// The signed edit device `d` holds with id `edit`, as it would send it.
    pub fn signed_edit(&self, d: SignerId, edit: EditId) -> Option<Signed> {
        self.held(d).signed.owned_get(&edit)
    }

    /// Edits `ids` of device `d` on the wire (`Wire::to_wire`), if it holds each, in order: what a save puts on its
    /// shelf, read back from its spill a run at a time, as a page it took lies there, never decoded.
    pub fn signed_wire(&self, d: SignerId, ids: &[EditId]) -> Option<Vec<Vec<u8>>> {
        self.held(d).signed.wire_of(ids)
    }

    /// Diagnostic policy observation only: no authority, persistence or rendered-state claim.
    /// Unknown/unauthorized/not-yet-replayed all have the same unavailable result.
    pub fn peer_edit_outcome(&self, d: SignerId, peer: SignerId, id: EditId) -> Option<bool> {
        let store = self.held(d);
        if store.replayed != store.log.edits().len() { return None; }
        let allowed = self.answered(d, peer, &[]);
        if !allowed.iter().any(|&i| store.log.ids().get(i) == Some(&id)) { return None; }
        let at = store.replay.ids.iter().position(|held| *held == id)?;
        store.replay.stood.get(at).copied()
    }

    /// Every secret signer `s` holds here, to search views, logs and stores for secrets that shouldn't be there: its
    /// own key, the one keys are sealed to for it, then, for a device, each key it holds. None while it is locked.
    pub fn secrets(&self, s: SignerId) -> Vec<Secret> {
        let Some(key) = self.keys.get(&s) else {
            return vec![];
        };
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
            for sig in &store.signed.owned(&edit.id()).sigs {
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
        for body in store.bodies.held() {
            out.extend(body.to_wire());
        }
        for slice in store.slices.values() {
            out.extend(slice.to_wire());
        }
        for shown in store.shown.values() {
            for item in shown.items_in(Some(store)).values() {
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
        if self.held(to).lazy.on && !self.held(to).lazy.fetching {
            let to_store = self.held(to);
            let stubs = to_store.counted_stubs();
            let ask = asks_with_stubs(to_store.log.edits(), to_store.log.ids(), to_store.log.logs(), &stubs, &to_store.follow);
            let withheld = self.withheld(from, to, &Request { ask, ..Request::default() }, &ReplyScope::All);
            self.receive_stubs(to, from, withheld);
        }
        let to_store = self.held(to);
        let stubs = to_store.counted_stubs();
        let asked = asks_with_stubs(to_store.log.edits(), to_store.log.ids(), to_store.log.logs(), &stubs, &to_store.follow);
        let store = self.held(from);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let places = self.answered(from, to, &asked.follow);
        let sent: Vec<EditId> =
            beyond(edits, ids, store.log.logs(), &places, &asked).into_iter().map(|i| ids[i]).collect();
        let (signed, blobs) = self.outgoing(from, &sent);
        self.deliver(to, signed, &blobs);
        self.drop_unanswered(to, from, None);
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
        let ids = theirs.log.ids();
        let logs = theirs.log.logs();
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
        let split = self.split_off(keys, d, store, salts, seed);
        self.hand_keys.remove(&d);
        split
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
            hand_keys: self.hand_keys.get(&d).map(|key| (d, key.clone())).into_iter().collect(),
            stores: Stores::from([(d, store)]),
            made: 0,
            passes: passes_from(&*seed),
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
            batches: self.batches.get(&d).map(|log| (d, log.clone())).into_iter().collect(),
            signing_events: self.signing_events.get(&d).map(|events| (d, events.detached())).into_iter().collect(),
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
        let Key::Device(k) = self.keys.get(&d)? else {
            return None;
        };
        let sig = k.state(&Statement::body(d, checked, &logs, &files));
        Some(Statement { keys: k.keys(), checked, logs, files, sig })
    }

    /// Device `d`'s pass to service `audience`, made now by the Lab's clock under the Lab's next nonce
    /// (`sign::ApiPass`): `None` while it is locked.
    pub fn api_pass(&self, d: SignerId, audience: &str) -> Option<ApiPass> {
        let Key::Device(k) = self.keys.get(&d)? else {
            return None;
        };
        Some(k.api_pass(audience, self.now, self.passes.fetch_add(1, Ordering::Relaxed)))
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
    /// `d` alone, which the server's relay lets in for ten minutes if the passkey owns a vault the server knows
    /// (`owner_keys`), and which a peer hands the passkey's link card on (`link_card`). `None` unless the passkey is at hand
    /// and `d` is an unlocked device of the Lab.
    pub fn relay_pass(&mut self, d: SignerId, passkey: SignerId, made: u64) -> Option<RelayPass> {
        let Key::Device(device) = self.keys.get(&d)? else {
            return None;
        };
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

    /// The keys that own the vaults in device `d`'s view, their roots among them (`admission::owner_keys`): the people
    /// the server knows, by any of their owner keys, whose passes its relay honours (`relay_pass`).
    pub fn owner_keys(&self, d: SignerId) -> Vec<SignerId> {
        crate::admission::owner_keys(self.held(d).view())
    }

    /// What device `d` hands a device whose passkey `passkey` proved itself on their connection (`sync::link_card`):
    /// the signed edits of the logs of the vaults the passkey owns, and of every vault that owns one of them, up the
    /// chains, so that the device can add itself to its person's vault (`join`). Nothing about any share, audience or
    /// entry (T20); a passkey that owns no vault gets nothing.
    pub fn link_card(&self, d: SignerId, passkey: SignerId) -> Vec<Signed> {
        let store = self.held(d);
        let places = link_places(store.log.edits(), store.log.ids(), self.standing(d), passkey);
        places.into_iter().map(|i| store.signed.owned(&store.log.ids()[i])).collect()
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
        // the vault it roots, else the person's vault it owns, as a second passkey does (Samuel 2026-10-28)
        let owns = |v: &&crate::policy::Vault| v.kind == Kind::Human && v.owners.contains(&Principal::Signer(passkey));
        let rooted = st.vaults().iter().find(|v| v.root == Some(passkey));
        let vault = rooted.or_else(|| st.vaults().iter().find(owns)).ok_or(Refusal::UnknownVault)?;
        let adds = |edit: &Edit| match edit.action {
            Action::Share(Sharing::Device { vault: v, device, .. }) => v == vault.id && device == d,
            _ => false,
        };
        let edits = store.log.edits().iter().zip(store.log.ids());
        let added =
            vault.devices.contains(&d).then(|| edits.rev().find(|(edit, _)| adds(edit)).map(|(_, id)| *id)).flatten();
        Ok((vault.id, added))
    }

    /// Of the edits `ids`, those device `d` holds signed: what a pull's page brought it that another asking of the
    /// same peer names loose (`LivePriority.lean` `withTaken`).
    pub fn holding(&self, d: SignerId, ids: impl IntoIterator<Item = EditId>) -> Vec<EditId> {
        let store = self.held(d);
        ids.into_iter().filter(|id| store.signed.contains_key(id)).collect()
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
    /// The same join sent again is accepted again. What it needs in this turn is `d`'s replay stepped on over it, so
    /// that `d` counts the new device and answers it as one (`step_replay`, the distance back at most); the rest of its
    /// catch-up, keys, readings and showings, is left to the node's steps (`catch_up_step`), so an always-on peer's
    /// store never waits a turn on one new device.
    pub fn accept_join(&mut self, d: SignerId, from: SignerId, join: Join) -> Result<EditId, Refusal> {
        if !matches!(join.edit.edit.action, Action::Share(Sharing::Device { device, .. }) if device == from) {
            return Err(Refusal::NotJoining);
        }
        let id = join.edit.verify()?.id();
        if self.held(d).signed.contains_key(&id) {
            return Ok(id);
        }
        self.held(d).view().step(&join.edit.edit)?;
        self.receive_now(d, vec![join.edit], join.blobs.into_iter().map(Arc::from).collect(), false);
        self.step_replay(d, usize::MAX);
        Ok(id)
    }

    /// The devices device `d` knows, other than itself, each with its ed25519 key, its iroh endpoint's: the devices
    /// of the vaults in its view whose keys it saw in a signature, in ML-DSA-65, as one in SLH-DSA proves nothing on a
    /// connection since the fork off it (`legacy`). One endpoint once.
    pub fn peers(&self, d: SignerId) -> Vec<(SignerId, [u8; 32])> {
        let store = self.held(d);
        let devices: HashSet<SignerId> = store.view().vaults().iter().flat_map(|v| v.devices.iter().copied()).collect();
        let own = match self.keys_of(d) {
            Some(SignerKeys::Device { ed25519, .. }) => Some(ed25519),
            _ => None,
        };
        let mut out: BTreeMap<[u8; 32], SignerId> = BTreeMap::new();
        for keys in store.signed.signer_keys() {
            if let SignerKeys::Device { ed25519, .. } = *keys {
                let s = keys.id();
                if s == d || Some(ed25519) == own || !devices.contains(&s) || keys.suite() != sign::SIGNING {
                    continue;
                }
                out.entry(ed25519).or_insert(s);
            }
        }
        let mut peers: Vec<(SignerId, [u8; 32])> = out.into_iter().map(|(key, s)| (s, key)).collect();
        peers.sort();
        peers
    }

    /// `sync::answer` of device `d`'s edits for `asker`, which follows `follow`, by the logs its log keeps the places
    /// of (`Log::by_log`): no scan of every edit it holds.
    fn answered(&self, d: SignerId, asker: SignerId, follow: &[VaultId]) -> Arc<Vec<usize>> {
        self.answering(d, asker, follow).places.clone()
    }

    /// `answered`, with the logs it sends: worked out once for the log's head and how far the replay is, whatever asks
    /// it in between (a request, each page of a reply, the key gate).
    fn answering(&self, d: SignerId, asker: SignerId, follow: &[VaultId]) -> Arc<Answered> {
        let store = self.held(d);
        let (head, replayed) = (store.log.head(), store.replayed);
        let key = (asker, follow.to_vec());
        if let Some((at, by, got)) = store.answers.answered.lock().expect("answered").get(&key)
            && *at == head
            && *by == replayed
        {
            return got.clone();
        }
        let places = match self.standing_for(d, asker) {
            None => vec![],
            Some((st, cuts)) => {
                let mut places = answer_by_log(store.log.edits(), store.log.by_log(), st, asker, follow);
                // none of the logs a removal not replayed yet may take away from it (`Cuts::logs`), till caught up
                if !cuts.logs.is_empty() {
                    let logs = store.log.logs();
                    places.retain(|&i| logs[i].is_none_or(|l| !cuts.logs.contains(&l)));
                }
                places
            }
        };
        let logs = places.iter().filter_map(|&i| store.log.logs()[i]).collect();
        let got = Arc::new(Answered { places: Arc::new(places), logs });
        let mut kept = store.answers.answered.lock().expect("answered");
        if kept.len() >= ANSWERS_KEPT {
            kept.clear();
        }
        kept.insert(key, (head, replayed, got.clone()));
        got
    }

    /// Where device `d`'s edits name each McEliece key and file (`Named`), as its log is now.
    fn named(&self, d: SignerId) -> Arc<Named> {
        let log = &self.held(d).log;
        let mut kept = self.held(d).answers.named.lock().expect("named");
        let head = log.head();
        if let Some(named) = kept.as_ref().filter(|n| n.head == head) {
            return named.clone();
        }
        let named = match kept.take() {
            Some(mut named) if log.head_at(named.head.at) == Some(named.head) => {
                Arc::make_mut(&mut named).extend(log);
                named
            }
            _ => Arc::new(Named::of(log)),
        };
        *kept = Some(named.clone());
        named
    }

    /// Log append/new receive/withdrawal give another head; replacing a Store drops this basis. Signature,
    /// key and view changes do not alter these structural inputs. Disclosure is still filtered per request.
    fn request_basis(&self, d: SignerId) -> Arc<RequestBasis> {
        let store = self.held(d);
        let head = store.log.head();
        let mut cached = store.answers.basis.lock().expect("request basis");
        if let Some(basis) = cached.as_ref().filter(|basis| basis.head == head) {
            return basis.clone();
        }
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let stubs = store.counted_stubs();
        let ask = crate::sync::asks_with_stubs(edits, ids, store.log.logs(), &stubs, &[]);
        let basis = Arc::new(RequestBasis { head, ask });
        #[cfg(test)]
        store.answers.basis_builds.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        *cached = Some(basis.clone());
        basis
    }

    /// What device `d` asks `peer` when it syncs with it on the network (`wire::Request`): its frontier of each log and
    /// a few edits further back, and the vaults it follows (`sync::asks`), and the McEliece keys it lacks to seal to
    /// (`Store::sealing`) that the edits of those logs name, but only of the logs `peer` may hold by `d`'s view, following what `d` follows: `d`
    /// tells a peer nothing about the rest. The public logs of a vault it follows it names too, as it names the vault
    /// in its request anyway, so a peer that holds them through a follow of its own sends only what `d` lacks of them,
    /// not each whole again on every asking (`RequestBasis.lean`'s `permittedWith`). A log it names nothing of comes
    /// whole, if the peer may send it.
    pub fn request(&self, d: SignerId, peer: SignerId) -> Request {
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let places = self.answered(d, peer, &store.follow);
        let basis = self.request_basis(d);
        let mut shared: HashSet<LogId> = places.iter().filter_map(|&i| store.log.logs()[i]).collect();
        let mut theirs: HashSet<EditId> = places.iter().map(|&i| ids[i]).collect();
        // the stubs `peer` sent it, which it tells `peer` of and no other peer
        if !store.lazy.fetching {
            for (stub, _) in store.lazy.stubs.values().filter(|(_, from)| *from == peer) {
                shared.insert(stub.log);
                theirs.insert(stub.id);
            }
        }
        let mut ask = basis.ask.clone();
        ask.follow = store.follow.clone();
        ask.haves.retain(|l, _| shared.contains(l));
        ask.loose.retain(|id| theirs.contains(id));
        // of those, the keys it lacks to seal to alone: it reads what its edits say without any (`Store::sealing`)
        let sealing = |b: &BlobId| store.sealing.contains(b) && !store.blobs.contains_key(b);
        let wants: BTreeSet<BlobId> = places.iter().flat_map(|&i| edits[i].blobs()).filter(sealing).collect();
        Request { ask, wants: wants.into_iter().collect(), after: None }
    }

    /// The writers device `d` may name to `peer` as those it holds segments of (S8, `Segments.lean`'s `shown`): the
    /// signers of the edits of the logs its request names to `peer` (`request`), whose ids it tells `peer` already, so
    /// naming their writers tells nothing more. Not the writers of any other log it holds, which would tell `peer` whom
    /// `d` knows in vaults `peer` has no part in. Kept for the log's head and `d`'s follow list.
    pub fn writers_shown(&self, d: SignerId, peer: SignerId) -> Arc<BTreeSet<SignerId>> {
        let store = self.held(d);
        let head = store.log.head();
        if let Some((at, follow, got)) = store.answers.writers.lock().expect("writers").get(&peer)
            && *at == head
            && *follow == store.follow
        {
            return got.clone();
        }
        let places = self.answered(d, peer, &store.follow);
        let shared: HashSet<LogId> = places.iter().filter_map(|&i| store.log.logs()[i]).collect();
        let edits = store.log.edits();
        let mut out = BTreeSet::new();
        for log in &shared {
            for &i in store.log.by_log().get(log).map(Vec::as_slice).unwrap_or_default() {
                out.insert(edits[i].author);
                out.extend(edits[i].cosigners.iter().copied());
            }
        }
        let out = Arc::new(out);
        // worked out by a replay that lags, it is worked out again once caught up (`answers_current`)
        if self.answers_current(d) {
            store.answers.writers.lock().expect("writers").insert(peer, (head, store.follow.clone(), out.clone()));
        }
        out
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
        self.reply_in(d, asker, request, page, &ReplyScope::All)
    }

    /// `reply`, restricted to these logs or vaults. This is equivalent to marking every unrelated edit loose in
    /// the request, but does not allocate, serialize and hash that history-sized list on every page.
    pub fn reply_in(
        &mut self,
        d: SignerId,
        asker: SignerId,
        request: &Request,
        page: usize,
        scope: &ReplyScope,
    ) -> (Vec<Signed>, Vec<BlobId>, bool) {
        let at = Perf::start();
        let places = self.answered(d, asker, &request.ask.follow);
        let sends = self.sends(d, asker, request, &places, scope);
        let store = self.held(d);
        // the places of all it sends this asking, in order: this page starts after the request's `after`
        let from = request.after.map_or(0, |after| sends.places.partition_point(|p| *p <= after));
        let (end, more) = page_end(store, &sends.places, from, page);
        let signed: Vec<Signed> = sends.places[from..end].iter().map(|(_, id)| store.signed.owned(id)).collect();
        // the keys it was asked for alone: an asker takes edits without the keys they name (`Store::sealing`)
        let blobs: BTreeSet<BlobId> = sends.wanted.iter().copied().filter(|b| store.blobs.contains_key(b)).collect();
        if let Some(store) = self.stores.get_mut(&self.at(d)) {
            store.perf.add("sync: reply", at);
            store.perf.count("sync: edits sent", signed.len() as u64);
        }
        (signed, blobs.into_iter().collect(), more)
    }

    /// Where the next `count` pages of `reply_in` would end, for `asker` to ask them all at once rather than each after
    /// the last came (a pull's pipelined pages): the place of each page's last edit, cut exactly as `reply_in` cuts it
    /// from the request's `after` on, and true if the last of them is the asking's last page. A hint alone: it names
    /// only places of edits the same authorization plan sends `asker`, and every page is still asked and checked.
    pub fn reply_cuts(
        &mut self,
        d: SignerId,
        asker: SignerId,
        request: &Request,
        page: usize,
        scope: &ReplyScope,
        count: usize,
    ) -> (Vec<Place>, bool) {
        let places = self.answered(d, asker, &request.ask.follow);
        let sends = self.sends(d, asker, request, &places, scope);
        let store = self.held(d);
        let mut from = request.after.map_or(0, |after| sends.places.partition_point(|p| *p <= after));
        let mut cuts = Vec::new();
        while cuts.len() < count && from < sends.places.len() {
            let (end, more) = page_end(store, &sends.places, from, page);
            cuts.push(sends.places[end - 1]);
            if !more {
                return (cuts, true);
            }
            from = end;
        }
        (cuts, from >= sends.places.len())
    }

    /// Device `d` asks for its first syncs with the boxes held back from now on, if `on` (`LazyBoxes.lean`): it asks
    /// each peer for the stubs of the box edits it needs not now (`withheld`), is sent the rest, and asks for their
    /// bodies once told to (`fetch_withheld`). Off, it asks as any device does, its stubs no longer counted.
    pub fn set_lazy_boxes(&mut self, d: SignerId, on: bool) {
        let store = self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        store.lazy.on = on;
        store.lazy.fetching |= !on;
        *store.answers.basis.lock().expect("request basis") = None;
    }

    /// The stubs of the box edits device `d` would send `asker` for `request` in `scope` that `asker` needs not now
    /// (`lazy::Needs`, by `d`'s view: a box changes nothing in the state, L1): each entry's wraps, the boxes of keys
    /// no longer current, those `asker` can't open, and of each current key it opens all boxes but one. Smallest id
    /// first. Of no edit `asker` may not receive (the same plan as `reply_in`), and only what `asker` would be sent
    /// anyway: their ids, logs, depths and parents.
    pub fn withheld(&self, d: SignerId, asker: SignerId, request: &Request, scope: &ReplyScope) -> Vec<Stub> {
        let places = self.answered(d, asker, &request.ask.follow);
        let sends = self.sends(d, asker, request, &places, scope);
        let store = self.held(d);
        let Some((st, _)) = self.standing_for(d, asker) else { return vec![] };
        let mut needs = crate::lazy::Needs::new(st, asker);
        let mut out: Vec<Stub> = sends
            .places
            .iter()
            .filter_map(|(_, id)| {
                let signed = store.signed.get(id)?;
                let edit = &signed.edit;
                let held_back = crate::lazy::is_box(edit) && needs.class(edit) != crate::lazy::Class::Now;
                held_back.then(|| Some(Stub::of(edit, *id, log_of(edit, *id)?))).flatten()
            })
            .collect();
        out.sort();
        out
    }

    /// Device `d` takes the stubs `stubs` peer `from` sent it (`withheld`), while it asks for stubs and not yet for
    /// their bodies: each of an edit it holds not, to count as held when it asks `from` (`request`). How many it took.
    /// A stub enters nothing it knows (S1).
    pub fn receive_stubs(&mut self, d: SignerId, from: SignerId, stubs: Vec<Stub>) -> usize {
        let store = self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        if !store.lazy.on || store.lazy.fetching {
            return 0;
        }
        let mut took = 0;
        for stub in stubs {
            if !store.signed.contains_key(&stub.id) && !store.lazy.stubs.contains_key(&stub.id) {
                store.lazy.stubs.insert(stub.id, (stub, from));
                took += 1;
            }
        }
        if took > 0 {
            store.lazy.taken += took;
            *store.answers.basis.lock().expect("request basis") = None;
        }
        took
    }

    /// Device `d` asks for the bodies of its stubs from now on: they no longer count as held, so its peers send them,
    /// and each is checked against its stub as it comes (S2, S5). It asks for no stubs again.
    pub fn fetch_withheld(&mut self, d: SignerId) {
        let store = self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        store.lazy.fetching = true;
        *store.answers.basis.lock().expect("request basis") = None;
    }

    /// Device `d` asks for stubs in its syncs now: it asks for them, and not yet for their bodies.
    pub fn lazy_boxes(&self, d: SignerId) -> bool {
        let lazy = &self.held(d).lazy;
        lazy.on && !lazy.fetching
    }

    /// The stubs device `d` holds whose bodies it holds not yet, smallest id first.
    pub fn stubs(&self, d: SignerId) -> Vec<Stub> {
        self.held(d).lazy.stubs.values().map(|(stub, _)| stub.clone()).collect()
    }

    /// Device `d` asked peer `from` for the bodies of its stubs, of the logs `logs` or of all, and the asking ended: the
    /// stubs `from` sent of those logs whose bodies didn't come go, as of edits `from` holds not or sends not (a stub
    /// of nothing), kept in `stubs_unanswered`. Only while it asks for their bodies. How many went.
    pub fn drop_unanswered(&mut self, d: SignerId, from: SignerId, logs: Option<&BTreeSet<LogId>>) -> usize {
        let store = self.stores.get_mut(&self.at(d)).unwrap_or_else(|| panic!("{d:?} is no device of the Lab"));
        if !store.lazy.fetching {
            return 0;
        }
        let gone: Vec<EditId> = store
            .lazy
            .stubs
            .iter()
            .filter(|(_, (stub, by))| *by == from && logs.is_none_or(|l| l.contains(&stub.log)))
            .map(|(id, _)| *id)
            .collect();
        for id in &gone {
            let stub = store.lazy.stubs.remove(id).expect("a stub");
            store.lazy.unanswered.push(stub);
        }
        gone.len()
    }

    /// The stubs device `d` let go of unanswered (`drop_unanswered`), each with the peer that sent it.
    pub fn stubs_unanswered(&self, d: SignerId) -> Vec<(Stub, SignerId)> {
        self.held(d).lazy.unanswered.clone()
    }

    /// The stubs device `d` holds, each by its id with the edits it says it builds on, and whether it asks for their
    /// bodies now (`fetch_withheld`). A box's body changes nothing it knows (`LazyBoxes.lean` S6), so its holdings count
    /// each stub as held for what a read waits on (avendb-net `differ`), its bodies asked for or not; its request names
    /// them only until it asks for their bodies (`request_basis`).
    pub fn held_stubs(&self, d: SignerId) -> (Vec<(EditId, Vec<EditId>)>, bool) {
        let store = self.held(d);
        let stubs = store.lazy.stubs.values().map(|(s, _)| (s.id, s.parents.clone())).collect();
        (stubs, store.lazy.fetching)
    }

    /// How many stubs device `d` took in all (`receive_stubs`): of boxes its first syncs held back.
    pub fn stubs_taken(&self, d: SignerId) -> usize {
        self.held(d).lazy.taken
    }

    /// Each body device `d` took of a stub that lied about it, with the peer that sent the stub, as they came (S5).
    pub fn stub_liars(&self, d: SignerId) -> Vec<(SignerId, EditId)> {
        self.held(d).lazy.liars.clone()
    }

    /// A bounded inventory for optional sparse payload transfer, using exactly the ordinary reply permission and
    /// scope plan. Only single-device-signed entry writes with a cheap conservative byte bound are eligible.
    /// This is an optimization class, never a trust decision: every excluded edit stays on the legacy sync path.
    /// The caller must bind the result to its durable head and an opaque published signer-root token separately.
    pub fn range_inventory(
        &self, d: SignerId, asker: SignerId, signer: SignerId, request: &Request,
        scope: &ReplyScope, max_edits: usize, max_wire: usize,
    ) -> Option<(crate::log_head::Head, Vec<EditId>)> {
        let places = self.answered(d, asker, &request.ask.follow);
        let sends = self.sends(d, asker, request, &places, scope);
        // Bounds additional inventory work. Initial legacy authorization-plan construction still examines the
        // held history; this does not claim to make that existing permission computation constant time.
        if sends.places.len() > max_edits { return None; }
        let store = self.held(d);
        let mut ids = Vec::new();
        for (_, id) in &sends.places {
            let signed = store.signed.owned(id);
            if signed.edit.author == signer && range_write_bound(&signed).is_some_and(|n| n <= max_wire) {
                ids.push(*id);
            }
        }
        ids.sort_unstable();
        Some((store.log.head(), ids))
    }

    /// Select a requested subset through the SAME current authorization plan, with exact revision fencing.
    /// Re-checking every requested Place rejects a narrowed/revoked/foreign scope before cloning any payload.
    /// The byte bound is computed from borrowed vector lengths before cloning or serializing large legacy edits.
    /// Keys and excluded records are reconciled by the mandatory legacy pass after optional ranges.
    pub fn range_select(
        &self, d: SignerId, asker: SignerId, signer: SignerId, request: &Request,
        scope: &ReplyScope, revision: &crate::log_head::Head, wanted: &BTreeSet<EditId>,
        max_edits: usize, max_wire: usize,
    ) -> Option<(Vec<Signed>, bool)> {
        let store = self.held(d);
        if &store.log.head() != revision || wanted.is_empty() || wanted.len() > max_edits { return None; }
        let places = self.answered(d, asker, &request.ask.follow);
        let sends = self.sends(d, asker, request, &places, scope);
        let mut selected = BTreeMap::new();
        for id in wanted {
            let signed = store.signed.get(id)?;
            let at = (signed.edit.depth, *id);
            if signed.edit.author != signer || sends.places.binary_search(&at).is_err() { return None; }
            let bytes = range_write_bound(&signed)?;
            if bytes > max_wire { return None; }
            selected.insert(at, (signed, bytes));
        }
        let mut bytes = 0usize;
        let mut take = Vec::new();
        for (signed, size) in selected.values() {
            let total = bytes.checked_add(*size)?;
            if total > max_wire { break; }
            bytes = total; take.push(Signed::clone(signed));
        }
        let more = take.len() < selected.len();
        Some((take, more))
    }

    /// The places of all device `d` sends `asker` for `request`, in order (`sync::beyond` of what `asker` may receive,
    /// `places`): kept for the request as it stands but for its `after`, while `d`'s edits stay as they were, so that
    /// an asking a peer makes page after page with the same request works it out once (`Answers`).
    fn sends(
        &self,
        d: SignerId,
        asker: SignerId,
        request: &Request,
        places: &[usize],
        scope: &ReplyScope,
    ) -> Arc<ReplyPlan> {
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let fp = store.log.head();
        let mut h = Hasher::new("asking");
        h.update(&Request { after: None, ..request.clone() }.to_wire());
        let asked = h.finalize();
        let key = (asker, asked, scope.clone());
        if let Some((at, got)) = store.answers.sends.lock().expect("answers").get(&key)
            && *at == fp
        {
            return got.clone();
        }
        let wants: HashSet<BlobId> = request.wants.iter().copied().collect();
        let wanted = if wants.is_empty() {
            vec![]
        } else {
            let reachable: BTreeSet<BlobId> =
                places.iter().flat_map(|&i| edits[i].blobs()).filter(|b| wants.contains(b)).collect();
            reachable.into_iter().collect()
        };
        let logs = logs_of(edits, ids);
        let mut scoped;
        let places = match scope {
            ReplyScope::All => places,
            _ => {
                scoped = places
                    .iter()
                    .copied()
                    .filter(|&i| match scope {
                        ReplyScope::Logs(named) => logs[i].is_some_and(|l| named.contains(&l)),
                        ReplyScope::Vaults(vaults) => match logs[i] {
                            Some(LogId::Entry(entry)) => {
                                self.vault_of_entry(d, entry).is_some_and(|v| vaults.contains(&v))
                            }
                            _ => true,
                        },
                        ReplyScope::All => true,
                    })
                    .collect::<Vec<_>>();
                // what it holds bare of these logs travels with the checkpoints that vouch for it, which the asker
                // takes it on, as it took it (`Checkpoint.lean` `cutReply_covering`): else the asker drops it on every
                // asking, a vault's checkpoint being of no entry's log (A2, 2026-10-29)
                let bare: HashSet<EditId> = scoped.iter().map(|&i| ids[i]).filter(|id| store.bare.contains(id)).collect();
                if !bare.is_empty() {
                    let vouches = |i: &usize| matches!(&edits[*i].action, Action::Checkpoint { covers, .. } if covers.iter().any(|c| bare.contains(c)));
                    scoped.extend(places.iter().filter(|i| vouches(i)));
                }
                &scoped
            }
        };
        let sent: BTreeSet<Place> =
            beyond(edits, ids, &logs, places, &request.ask).into_iter().map(|i| (edits[i].depth, ids[i])).collect();
        let got = Arc::new(ReplyPlan { places: sent.into_iter().collect(), wanted });
        let mut sends = store.answers.sends.lock().expect("answers");
        if sends.len() >= ANSWERS_KEPT {
            sends.clear();
        }
        sends.insert(key, (fp, got.clone()));
        got
    }

    /// Device `d` may hand `asker`, which follows the vaults `follow`, the McEliece key `blob`: it holds it, and an
    /// edit `asker` may receive by `d`'s view names it.
    /// The edits that name it, looked up where they are (`Named`), each answered as its log is (`answering`).
    pub fn may_fetch(&self, d: SignerId, asker: SignerId, blob: BlobId, follow: &[VaultId]) -> bool {
        let store = self.held(d);
        if !store.blobs.contains_key(&blob) {
            return false;
        }
        let named = self.named(d);
        let Some(places) = named.blobs.get(&blob) else { return false };
        let answered = self.answering(d, asker, follow);
        let logs = store.log.logs();
        places.iter().any(|&i| logs[i].is_some_and(|l| answered.logs.contains(&l)))
    }

    /// Device `d` may hand `asker`, which follows the vaults `follow`, the sealed bytes of file `file`: an edit `asker`
    /// may receive by `d`'s view brings it, or a snapshot states an entry `asker` syncs as it (T27, `sync::may_fetch`).
    /// Whether `d` holds them is its store's to say. The edits that bring it looked up where they are (`Named`).
    pub fn may_fetch_file(&self, d: SignerId, asker: SignerId, file: &FileRoot, follow: &[VaultId]) -> bool {
        let Some((st, cuts)) = self.standing_for(d, asker) else { return false };
        let named = self.named(d);
        let answered = self.answering(d, asker, follow);
        let logs = self.held(d).log.logs();
        let sent = |i: usize| logs[i].is_some_and(|l| answered.logs.contains(&l));
        if named.files.get(file).is_some_and(|at| at.iter().any(|&i| sent(i))) {
            return true;
        }
        let Some(stated) = named.stated.get(file).filter(|at| at.iter().any(|&(i, _)| sent(i))) else { return false };
        let syncing = crate::sync::Syncing::new(st, asker, follow);
        stated.iter().any(|&(i, entry)| {
            let l = LogId::Entry(entry);
            sent(i) && syncing.log(l) && !cuts.logs.contains(&l)
        })
    }

    /// The files the edits device `d` holds bring whose root's hash is `hash`: what a fetch by that hash may be of.
    pub fn files_hashed(&self, d: SignerId, hash: &[u8; 32]) -> Vec<FileRoot> {
        self.named(d).by_hash.get(hash).map(|roots| roots.iter().copied().collect()).unwrap_or_default()
    }

    /// The files the edits device `d` holds bring, smallest first: what it keeps, whether or not it reads them.
    pub fn files(&self, d: SignerId) -> Vec<FileRoot> {
        let files: BTreeSet<FileRoot> =
            self.held(d).log.edits().iter().flat_map(|e| e.files().iter().copied()).collect();
        files.into_iter().collect()
    }

    /// The files device `d` keeps whole, smallest first: those the entries it holds and its keep shares want bring,
    /// where its keep shares over the entry's vault say to keep them whole (`State::keeps`), or, with none there but
    /// never ones, where its own setting `keep` says. It fetches the rest a piece at a time as it reads them.
    pub fn kept_files(&self, d: SignerId, keep: bool) -> Vec<FileRoot> {
        let (store, st) = (self.held(d), self.standing(d));
        let kept = |edit: &&Edit| {
            let en = edit.entry().and_then(|e| st.entry(e));
            en.is_some_and(|en| st.wants(d, en) && st.keeps(d, en).unwrap_or(keep))
        };
        let files: BTreeSet<FileRoot> =
            store.log.edits().iter().filter(kept).flat_map(|e| e.files().iter().copied()).collect();
        files.into_iter().collect()
    }

    /// Files needed by active local views. Demand grants nothing: both current keep selection and
    /// readable file keys must permit each file. Opened/light devices hydrate these in background.
    pub fn demanded_files(&self, d: SignerId, entries: &[EntryId]) -> Vec<FileRoot> {
        let st = self.standing(d);
        // Many active entries still require just one held-history pass. Selection
        // precedes grouping; file() inside the projection still checks readable keys.
        let selected = entries.iter().copied()
            .filter(|entry| st.entry(*entry).is_some_and(|en| st.wants(d, en)));
        let files: BTreeSet<FileRoot> = self.entry_files_batch(d, selected)
            .into_values().flatten()
            .filter_map(|(root, len)| len.map(|_| root))
            .collect();
        files.into_iter().collect()
    }

    /// Its replay is of every edit device `d` holds, or what they say is worked out already: `latest` costs nothing.
    /// Else the first call that asks what its edits say replays them under the Lab, which a background reader such as
    /// a node's file keeper leaves to its catch-up instead.
    pub fn replay_current(&self, d: SignerId) -> bool {
        let store = self.held(d);
        store.replayed == store.log.edits().len() || store.latest.get().is_some()
    }

    /// One slice of `scan`: the next `budget` edits device `d` holds, at least one, and at the last slice what the
    /// whole scan found, as `files`, `kept_files` and `demanded_files` say it at once, for the same edits and keys.
    /// Each slice is short, so a node's file keeper lets go of the Lab between slices and a page's turn comes between.
    /// A scan whose edits changed since its last slice starts again; one of a device whose replay is behind waits
    /// (`replay_current`).
    pub fn scan_files(&self, d: SignerId, scan: &mut FileScan, budget: usize) -> FileScanned {
        if !self.replay_current(d) {
            return FileScanned::Behind;
        }
        let store = self.held(d);
        let head = store.log.head();
        if scan.head.as_ref() != Some(&head) {
            let st = self.standing(d);
            let selected = scan.entries.iter().copied().filter(|e| st.entry(*e).is_some_and(|en| st.wants(d, en)));
            *scan = FileScan { head: Some(head), at: 0, selected: selected.collect(), ..FileScan::new(scan.keep, std::mem::take(&mut scan.entries)) };
        }
        let st = self.standing(d);
        let edits = store.log.edits();
        let end = edits.len().min(scan.at.saturating_add(budget.max(1)));
        for edit in &edits[scan.at..end] {
            if edit.files().is_empty() {
                continue;
            }
            scan.files.extend(edit.files().iter().copied());
            let entry = edit.entry();
            let en = entry.and_then(|e| st.entry(e));
            if en.is_some_and(|en| st.wants(d, en) && st.keeps(d, en).unwrap_or(scan.keep)) {
                scan.kept.extend(edit.files().iter().copied());
            }
            if entry.is_some_and(|e| scan.selected.contains(&e)) {
                scan.named.extend(edit.files().iter().copied());
            }
        }
        scan.at = end;
        if end < edits.len() {
            return FileScanned::More;
        }
        let demanded = scan.named.iter().copied().filter(|root| self.file(d, root).is_some()).collect();
        FileScanned::Done {
            files: scan.files.iter().copied().collect(),
            kept: scan.kept.iter().copied().collect(),
            demanded,
        }
    }

    /// The files the writes of entry `entry` bring, as device `d` holds them, in the order it took them, each once:
    /// each with its plaintext length where `d` opens it (`file`), else `None`. Only a write brings a file, and a write
    /// is of its entry's log, so it looks at that log's edits alone (`Log::by_log`), in the order it took them: not
    /// every edit it holds once per entry, which made `entry_views` of a vault's 2,300 entries walk 107,000 edits 2,300
    /// times, 2.2 s here at 20,000 edits and over a minute on an iPhone (Goal 7, 2026-10-28).
    pub fn entry_files(&self, d: SignerId, entry: EntryId) -> Vec<(FileRoot, Option<u64>)> {
        let mut seen = BTreeSet::new();
        let log = &self.held(d).log;
        let places = log.by_log().get(&LogId::Entry(entry)).map_or(&[][..], Vec::as_slice);
        let edits = places.iter().map(|&at| &log.edits()[at]).filter(|e| e.entry() == Some(entry));
        let files = edits.flat_map(|e| e.files().iter().copied()).filter(|f| seen.insert(*f));
        files.map(|f| (f, self.file(d, &f).map(|b| b.len))).collect()
    }

    /// The same held-log projection as `entry_files`, grouped in one history pass for
    /// a full-world snapshot. The caller supplies its already selected entries; this
    /// transient map adds no authority or persisted cache. Lengths still use `file`.
    pub(crate) fn entry_files_batch(
        &self, d: SignerId, entries: impl IntoIterator<Item = EntryId>,
    ) -> BTreeMap<EntryId, Vec<(FileRoot, Option<u64>)>> {
        grouped_file_roots(entries, self.held(d).log.edits().iter())
            .into_iter()
            .map(|(entry, roots)| (entry, roots.into_iter().map(|root| {
                (root, self.file(d, &root).map(|file| file.len))
            }).collect()))
            .collect()
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
        let Some(h) = self.history(d, entry) else {
            return vec![];
        };
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
        let Some(h) = self.history(d, entry) else {
            return vec![];
        };
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
        let files = |w: &Write| Some((w.edit, store.log.entry_write(w.edit)?.files().to_vec()));
        writes.filter_map(files).filter(|(_, fs)| !fs.is_empty()).collect()
    }

    /// The key and length of file `root`, from a write device `d` opened that brings it, if any: what it opens the file
    /// with. Only a write that names the file in the clear counts, and only with the length its sealed size says.
    pub fn file(&self, d: SignerId, root: &FileRoot) -> Option<Brought> {
        let store = self.held(d);
        // a session opens a file only through a write of an entry it reads itself
        if self.hosted.contains_key(&d) {
            let brings = |(id, body): (&EditId, &Body)| {
                let edit = store.log.entry_write(*id)?;
                let Action::Write { entry, .. } = edit.action else {
                    return None;
                };
                let named = edit.files();
                let f = body.files.iter().find(|f| f.root == *root && named.contains(&f.root) && f.fits())?;
                self.sees(d, entry).then(|| (*id, f.clone()))
            };
            return store.bodies_bringing_files().filter_map(brings).min_by_key(|(id, _)| *id).map(|(_, f)| f);
        }
        // the first write by id that names the file and holds its key, each file once, rather than every body sorted
        // again at every file asked for (an entry list asks for thousands)
        let at = store.files_at.get_or_init(|| {
            let mut writes: Vec<(&EditId, &Body)> = store.bodies_bringing_files().collect();
            writes.sort_by_key(|(id, _)| **id);
            let mut at = HashMap::new();
            for (id, body) in writes {
                let Some(named) = store.log.entry_write(*id).map(Edit::files) else {
                    continue;
                };
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
        self.held(d).blobs.get(&b)
    }

    /// The ids of the McEliece keys device `d` holds, smallest first.
    pub fn blob_ids(&self, d: SignerId) -> Vec<BlobId> {
        let ids: BTreeSet<BlobId> = self.held(d).blobs.keys().into_iter().collect();
        ids.into_iter().collect()
    }

    /// How many edits and McEliece keys device `d` holds. Counts alone are not a revision: checkpoint withdrawal
    /// and restore can remove edits. Use `log(d).head()` to invalidate derived work.
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
        self.receive_now_prepared(d, edits, blobs, now, &HashMap::new())
    }

    fn receive_now_prepared(&mut self, d: SignerId, edits: Vec<Signed>, blobs: Vec<Arc<[u8]>>, now: bool, prepared: &HashMap<EditId, bool>) -> usize {
        let blobs: Blobs = blobs.into_iter().map(|b| (BlobId::of(&b), b)).collect();
        let before = self.held(d).signed.len();
        // in the middle of a catch-up a step at a time, what it takes brings it one step on, not the whole of it
        let catching = self.catching_up(d);
        let mut changed = self.take_prepared(d, edits, &blobs, prepared);
        // Edit-only pages have no late-arriving keys to match. Taking their edits and flushing a deferred
        // replay still happen normally; only the otherwise unused full-history blob-name scan is omitted.
        if !blobs.is_empty() {
            let store = self.stores.get_mut(&self.at(d)).expect("a device");
            let named: HashSet<BlobId> = store.log.edits().iter().flat_map(Edit::blobs).collect();
            for (b, bytes) in blobs {
                if named.contains(&b) && !store.blobs.contains_key(&b) {
                    store.blobs.insert(b, bytes);
                    changed = true;
                }
            }
        }
        let new = self.held(d).signed.len() - before;
        let store = self.stores.get_mut(&self.at(d)).expect("a device");
        store.behind |= changed;
        // (`CatchUpBudget.lean` `taken_le`): the keys a pull brought after its pages ran the phone's whole catch-up in
        // one turn of 1.8 min, a whole replay, its key index and its bodies, and its worker answered no peer meanwhile
        // (2026-10-28); the catch-up's own steps bring the rest
        if now && store.behind {
            if catching {
                self.refresh_with(d, &[], Some(TAKEN_BUDGET));
            } else {
                self.refresh(d, &[]);
            }
        }
        new
    }

    /// Brings device `d`'s keys and items up to date with the edits it took since it last did (`receive_now`). True if
    /// there were any.
    pub fn catch_up(&mut self, d: SignerId) -> bool {
        let Some(store) = self.stores.get_mut(&self.at(d)) else {
            return false;
        };
        if !store.behind {
            return false;
        }
        self.refresh(d, &[]);
        true
    }

    /// `catch_up` a step at a time, each its own short turn of a node's Lab, so that a page's turn comes between them
    /// (a catch-up held the server's Lab 5.5 s, 2026-10-27, nearly all of it showing entries anew): first its replay
    /// stepped on over the edits it took since (`step_replay`), which leaves it as a page taken but not yet caught up
    /// leaves it (`receive_now`); then the catch-up itself, showing at most `budget` entries anew a step
    /// (`show_items`), the entries left shown a step at a time after it, and once they all are, the catch-up again,
    /// which finds them shown. `Stepped` while there is more to come, then `Caught` with what `catch_up` says. The same
    /// keys, items and edits as one `catch_up`, a device with owners' bases of entries too (until 2026-10-28 it took
    /// its whole catch-up in one step).
    pub fn catch_up_step(&mut self, d: SignerId, budget: usize) -> CatchUp {
        let Some(store) = self.stores.get(&self.at(d)) else {
            return CatchUp::Caught(false);
        };
        // edits taken while it shows a backlog, as a live page during a long catch-up, don't wait for the backlog: their
        // replay is stepped on, their bodies read and their entries shown first, before those it left (`show_items`,
        // the entries of new writes first), so a person sees a live edit a step after it lands (batch 5, lane 8)
        if store.showing.as_ref().is_some_and(|s| s.taken == store.log.edits().len()) {
            self.show_more(d, budget);
            return CatchUp::Stepped;
        }
        if !store.behind {
            return CatchUp::Caught(false);
        }
        if store.replayed < store.log.edits().len() && store.latest.get().is_none() {
            self.step_replay(d, budget.max(1).saturating_mul(REPLAY_WORK));
            return CatchUp::Stepped;
        }
        match self.refresh_with(d, &[], Some(budget)) {
            true => CatchUp::Caught(true),
            false => CatchUp::Stepped,
        }
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
        self.receive_whose_prepared_inner(d, edits, blobs, now, &HashMap::new())
    }

    /// Captures only which immutable signatures need checking. A state change after capture is safe:
    /// reception still deduplicates, resolves checkpoint coverage and applies the CURRENT gate.
    pub fn prepare_receive(&self, d: SignerId, edits: Vec<Signed>) -> ReceivePreparation {
        let store = self.held(d);
        let mut seen = HashSet::new();
        let fresh: Vec<_> = edits.iter().enumerate().filter(|(_, signed)| {
            let id = signed.edit.id();
            !store.signed.contains_key(&id) && seen.insert(id)
        }).collect();
        let batch = covered(fresh.iter().map(|(_, signed)| &signed.edit));
        let checking = fresh.into_iter().filter_map(|(i, signed)| {
            let id = signed.edit.id();
            (!store.covers.contains(&id) && !batch.contains(&id)).then_some(i)
        }).collect();
        ReceivePreparation { edits, checking }
    }

    /// Takes a cryptographically prepared page through ordinary CURRENT-state admission.
    pub fn receive_prepared(&mut self, d: SignerId, prepared: PreparedReceive, now: bool) -> (usize, Vec<(VaultId, Option<EntryId>)>) {
        self.stores.get_mut(&self.at(d)).expect("a device").perf.merge(prepared.perf);
        self.receive_whose_prepared_inner(d, prepared.edits, Vec::new(), now, &prepared.signatures)
    }

    fn receive_whose_prepared_inner(&mut self, d: SignerId, edits: Vec<Signed>, blobs: Vec<Arc<[u8]>>, now: bool, prepared: &HashMap<EditId, bool>) -> (usize, Vec<(VaultId, Option<EntryId>)>) {
        let held = &self.held(d).signed;
        let ids = edits.iter().map(|s| (s.edit.id(), &s.edit));
        let fresh: Vec<(EditId, Option<LogId>)> =
            ids.filter(|(id, _)| !held.contains_key(id)).map(|(id, e)| (id, log_of(e, id))).collect();
        let new = self.receive_now_prepared(d, edits, blobs, now, prepared);
        let taken = fresh.into_iter().filter(|(id, _)| self.held(d).signed.contains_key(id));
        let whose = taken.filter_map(|(_, log)| self.whose_log(d, log?)).collect();
        (new, whose)
    }

    /// The digest of each log device `d` holds that `peer` may hold too by `d`'s view (`sync::digests`, as `request`
    /// names them), smallest log first: what `d` tells `peer` whenever one changes, so that `peer` asks it where they
    /// differ. Nothing about any other log. The logs of what `d` sends `peer` following nothing (`Logs.lean`
    /// `reachLogs`), which `peer`'s request is answered with whatever it follows. Told by what `d` follows, as it was, a
    /// server that follows a vault told a phone that doesn't of its public logs, then answered the phone's asking for
    /// them with nothing, and the phone counted them as lacking and asked again (S1, 2026-10-28).
    pub fn announce(&mut self, d: SignerId, peer: SignerId) -> Vec<(LogId, [u8; 32])> {
        self.digests(d);
        let store = self.held(d);
        let (edits, ids) = (store.log.edits(), store.log.ids());
        let logs = logs_of(edits, ids);
        let shared: BTreeSet<LogId> = self.answered(d, peer, &[]).iter().filter_map(|&i| logs[i]).collect();
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
        let signed = store.log.ids().iter().map(|id| store.signed.owned(id)).collect();
        Backup { signed, blobs: store.blobs.to_map(), bases:store.bases.clone() }
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
        self.restore_warm(d, backup, None, &Warm::default());
    }

    /// Device `d` holds its signed edits and McEliece keys in `spill` from now on, those it holds now among them, and
    /// only an index of them and a bounded cache in memory (S7, `held`): what a server does, its vaults growing toward
    /// a million edits. A restore keeps it spilled. It holds, proves and says the same either way.
    pub fn spill(&mut self, d: SignerId, spill: &Spill) -> std::io::Result<()> {
        let store = self.stores.get_mut(&self.at(d)).ok_or_else(|| std::io::Error::other("no such device"))?;
        store.signed.spill_edits(spill)?;
        let signed = &store.signed;
        store.log.shelve(|id| signed.place(id));
        store.blobs.spill_keys(spill)
    }

    /// `restore_from`, starting from what device `d` worked out before, as its shelf keeps it (`Warm`): what of it it
    /// opens with its shelf key. Where its keys name the edits it checked as its shelf names the first `n` of `backup`'s
    /// now (`checked`), their signatures aren't checked again: a device opening again checks only what came after. It
    /// takes the keys it opened from all of them, and its replay from the newest view that opens for this engine and is
    /// of the edits its log starts with.
    pub fn restore_warm(&mut self, d: SignerId, backup: Backup, checked: Option<(Checked, usize)>, warm: &Warm) {
        let Backup { signed, blobs, bases } = backup;
        let mut r = self.restore_start(d, checked.map(|c| c.0), warm);
        r.vouch = if r.matched { checked.map_or(0, |c| c.1) } else { 0 };
        self.restore_page_of(d, &mut r, signed, &blobs, false, None);
        self.restore_end_with(d, r, bases, warm);
    }

    /// `restore_warm` a page at a time, as a node takes its edits back from its shelf (`avendb_net::edits`): begun
    /// here, each page of its signed edits in the order the shelf holds them taken by `restore_page`, and ended by
    /// `restore_end`, which opens its stored view and brings it up to date. It holds a page of signed edits at a time
    /// beside what it keeps, spilled or not, never the whole of them twice (F9: the Mac's unlock held all 1.08 GB of
    /// them at once, and the copy for their anchors again).
    /// Its shelf names the edits of the head it starts from by `checked`: where its keys of `warm` name the same, those
    /// edits' signatures aren't checked again (`restore_page`).
    pub fn restore_start(&mut self, d: SignerId, checked: Option<Checked>, warm: &Warm) -> Restoring {
        let held = self.held(d);
        let (follow, query_depth, gate, perf) = (held.follow.clone(), held.query_depth, held.gate, held.perf.clone());
        let restore_whole = held.restore_whole;
        // spilled as it was, into new files: the old ones go with the store they were of
        let (signed, blobs) = (held.signed.fresh(), held.blobs.fresh_keys());
        let mut store = Store { follow, query_depth, gate, perf, signed, blobs, restore_whole, ..Store::default() };
        let key = self.shelf_key(d);
        let mut matched = false;
        // Decode and merge one slot at a time. Keeping both complete decoded key
        // maps alive until collection finishes needlessly raises the startup peak.
        // Preserve newest-to-oldest order and the existing per-slot validity checks.
        for (named, keys) in warm.keys.iter().filter_map(|bytes| {
            keys_of(&key.as_ref()?.unlock("keys", bytes, b"stored keys")?)
        }) {
            if let (Some(now), Some(named)) = (checked, named)
                && now == named
            {
                matched = true;
                store.checked_given = Some(now);
            }
            store.opened_before.extend(keys);
        }
        self.stores.insert(d, store);
        Restoring { matched, vouch: 0, taken: 0, vouched: 0, checked: 0, doubtful: Vec::new(), wanting: HashSet::new() }
    }

    /// The next page of the signed edits device `d` restores (`restore_start`), in the order its shelf holds them, and
    /// the McEliece keys they bring; of the head its shelf names by the `checked` it started with where `checked`.
    pub fn restore_page(
        &mut self,
        d: SignerId,
        r: &mut Restoring,
        page: Vec<Signed>,
        keys: impl IntoIterator<Item = Arc<[u8]>>,
        checked: bool,
    ) {
        self.restore_page_placed(d, r, page.into_iter().map(|s| (s, None)).collect(), keys, checked);
    }

    /// `restore_page`, each edit with where its shelf holds it, if in a file (`Placed`): a device spilled into a folder
    /// of its own reads it from there, never copying it into its spill.
    pub fn restore_page_placed(
        &mut self,
        d: SignerId,
        r: &mut Restoring,
        page: Vec<(Signed, Option<Placed>)>,
        keys: impl IntoIterator<Item = Arc<[u8]>>,
        checked: bool,
    ) {
        if checked && r.matched {
            r.vouch = r.taken + page.len();
        }
        let blobs: Blobs = keys.into_iter().map(|b| (BlobId::of(&b), b)).collect();
        let mut placed = HashMap::new();
        let page = page.into_iter().map(|(s, p)| {
            if let Some(p) = p {
                placed.insert(s.edit.id(), p);
            }
            s
        }).collect();
        self.restore_page_of(d, r, page, &blobs, true, Some(&placed));
    }

    /// `restore_page`: in the order they came where `in_order`, else as `fresh` orders them, held bare first.
    fn restore_page_of(
        &mut self,
        d: SignerId,
        r: &mut Restoring,
        page: Vec<Signed>,
        blobs: &Blobs,
        in_order: bool,
        placed: Option<&HashMap<EditId, Placed>>,
    ) {
        let (at, offered) = (Perf::start(), page.len() as u64);
        // the first edits of those it restores are those its shelf names it checked (`restore_start`)
        let vouched: HashSet<EditId> = page.iter().take(r.vouch.saturating_sub(r.taken)).map(|s| s.edit.id()).collect();
        r.taken += page.len();
        let fresh = if in_order {
            let (fresh, failed) = self.fresh_in_order(d, page, &vouched);
            r.doubtful.extend(failed);
            fresh
        } else {
            self.fresh(d, page, &vouched)
        };
        if let Some(store) = self.stores.get_mut(&self.at(d)) {
            store.perf.add("check", at);
            store.perf.count("edits offered", offered);
            let checked = fresh.iter().filter(|s| !vouched.contains(&s.edit.id())).count();
            store.perf.count("edits checked", checked as u64);
            (r.vouched, r.checked) = (r.vouched + vouched.len(), r.checked + checked);
            // the keys they name that didn't come with them: a later save may have brought one (`restore_keys`)
            r.wanting.extend(fresh.iter().flat_map(|s| s.edit.blobs())
                .filter(|b| !blobs.contains_key(b) && !store.blobs.contains_key(b)));
        }
        self.keep_fresh_as(d, fresh, blobs, false, placed);
    }

    /// The McEliece keys the edits device `d` restored so far name, which didn't come with their pages
    /// (`restore_page`).
    pub fn restore_wants(&self, r: &Restoring) -> Vec<BlobId> {
        r.wanting.iter().copied().collect()
    }

    /// Device `d`'s restore takes McEliece keys `keys`, those its edits name of them (`restore_wants`).
    pub fn restore_keys(&mut self, d: SignerId, r: &mut Restoring, keys: impl IntoIterator<Item = Arc<[u8]>>) {
        let Some(store) = self.stores.get_mut(&self.at(d)) else { return };
        for bytes in keys {
            let id = BlobId::of(&bytes);
            if r.wanting.remove(&id) && !store.blobs.contains_key(&id) {
                store.blobs.insert(id, bytes);
            }
        }
    }

    /// Ends device `d`'s restore (`restore_start`): what it holds on the word of a checkpoint a later page brought, its
    /// owners' judged slices its shelf's `anchors` name (`Backup::with_bootstrap_bytes`) of the edits it holds now, none
    /// where they don't read whole or name edits it doesn't hold, and its replay from the newest stored view of `warm`
    /// that opens for this engine and is of the edits its log starts with.
    pub fn restore_end(&mut self, d: SignerId, r: Restoring, anchors: &[u8], warm: &Warm) {
        let bases = {
            let log = &self.held(d).log;
            entry_base::anchors_of(anchors, |id| log.has(id), |entry| {
                entry_base::frontier_of(entry, log.edits().iter().zip(log.ids()))
            })
        };
        self.restore_end_with(d, r, bases.unwrap_or_default(), warm);
    }

    /// `restore_end`, with its owners' judged slices `bases`.
    /// How device `d`'s last restore went, in words for its person, with what each part of it took (`restore_end`):
    /// whether it started from a stored view and of how many edits, and if not why not, the kept showings it took,
    /// and how long replaying, reading and showing took. `None` before any restore.
    pub fn restore_report(&self, d: SignerId) -> Option<String> {
        let store = self.held(d);
        let r = store.restored.as_ref()?;
        let ms = |k: &str| store.perf.total_ms(k);
        let view = match r.view {
            ViewOpened::Of { held } => {
                let after = r.edits.saturating_sub(held);
                format!("From its stored view of {held} edits, {after} after it replayed")
            }
            ViewOpened::NoneKept => "No stored view on its shelf: every edit replayed".into(),
            ViewOpened::NoneOpens(n) => format!("{n} stored views, none sealed for these replay rules: every edit replayed"),
            ViewOpened::NoneOfThese(n) => format!("{n} stored views, none of the edits its log starts with: every edit replayed"),
            ViewOpened::Locked => "Locked, no stored view opened: every edit replayed".into(),
        };
        let kept = match r.kept {
            (0, 0) => "no kept showings".to_string(),
            (packs, 0) => format!("{} kept showings from {packs} packs", r.showings),
            (packs, failed) => format!("{} kept showings from {packs} packs, {failed} packs that don't open", r.showings),
        };
        // what made it replay every edit, or read every body, where it did: the steps on its view it couldn't take
        let wholes: Vec<String> = store.perf.counts_of("replay whole: ").map(|(why, n)| format!("{why} ({n})")).collect();
        let wholes = match wholes.is_empty() {
            true => String::new(),
            false => format!(". Replayed every edit: {}", wholes.join(", ")),
        };
        let reads = store.perf.counts_of("read: whole").map(|(_, n)| n).sum::<u64>();
        Some(format!(
            "{view}; {kept}. {} edits. Open view {:.1} s, replay {:.1} s, read {:.1} s ({reads} of every body), show {:.1} s, \
             upkeep {:.1} s{wholes}",
            r.edits, ms("open view") / 1000.0, ms("replay") / 1000.0, ms("read") / 1000.0, ms("show items") / 1000.0,
            ms("upkeep") / 1000.0
        ))
    }

    fn restore_end_with(&mut self, d: SignerId, r: Restoring, bases: entry_base::Anchors, warm: &Warm) {
        // an edit held bare that a later page's checkpoint covers, which its own page couldn't tell
        if !r.doubtful.is_empty() {
            let late: Vec<Signed> = match self.stores.get(&self.at(d)) {
                Some(store) => r.doubtful.into_iter().filter(|s| store.covers.contains(&s.edit.id())).collect(),
                None => vec![],
            };
            self.keep_fresh_as(d, late, &Blobs::new(), false, None);
        }
        let key = self.shelf_key(d);
        if let Some(store) = self.stores.get_mut(&d) {
            store.bases = bases;
        }
        // what its edits said when it last stopped, of the edits its log starts with: the rest step on it
        if let Some(key) = key
            && let Some(store) = self.stores.get_mut(&d)
        {
            let at = Perf::start();
            let (edits, ids) = (store.log.edits(), store.log.ids());
            let mut opened = 0;
            let found = warm.views.iter().find_map(|b| {
                let view = key.unlock("view", b, VIEW_RULES.as_bytes())?;
                opened += 1;
                let older = view.starts_with(b"avenDB own materialization 1\n");
                let (replay, held) = Replay::from_view(view_replay(&view)?, edits, ids)?;
                // and what it read of those edits, where it holds that
                let read = view_parts(&view)?.1.and_then(|read| stored_readings::open(read, held));
                Some((replay, held, older, read))
            });
            let mut restored = Restored {
                edits: edits.len(),
                view: match (&found, warm.views.len(), opened) {
                    (Some((_, held, ..)), ..) => ViewOpened::Of { held: *held },
                    (None, 0, _) => ViewOpened::NoneKept,
                    (None, n, 0) => ViewOpened::NoneOpens(n),
                    (None, n, _) => ViewOpened::NoneOfThese(n),
                },
                kept: (0, 0),
                showings: 0,
            };
            (store.view_given, store.read_given) = (None, None);
            match found {
                Some((replay, held, older, read)) => {
                    store.replaying = None;
                    store.replay = replay;
                    store.replayed = held;
                    // it reads on from what it read of them, opening each body it opened then only as it is asked for
                    if let Some(mut read) = read {
                        store.readings = std::mem::take(&mut read.readings);
                        store.recontext();
                        store.bodies.close(read.opened.iter().copied());
                        store.spoilt.extend(read.spoilt.iter().copied());
                        let opened = store.bodies.len();
                        store.read_new.sealed(&read, opened, &store.readings, &store.log, held, store.wholes);
                        store.read_given = store.log.head_at(held as u64);
                        store.perf.count("read: from its stored view", 1);
                    }
                    // a view an older engine kept with its adjunct is kept again without it
                    store.view_given = if older { None } else { store.log.head_at(held as u64) };
                    if older {
                        store.read_given = None;
                    }
                    store.view_wholes = store.wholes;
                    store.perf.count("replay: from its stored view", 1);
                }
                None => store.perf.count("stored view: none that opens", 1),
            }
            store.perf.add("open view", at);
            // and the showings it kept, each its entry's from the pack its row names, to take where its print is its
            // entry's print as it shows them (`show_items`); a pack that doesn't open is none, and the next save keeps
            // its entries' showings again
            let at = Perf::start();
            let mut packs = 0;
            for pack in &warm.shown {
                let Some(kept) = shown_map::unpack(&key, &pack.file) else {
                    store.perf.count("kept shown: a pack that doesn't open", 1);
                    restored.kept.1 += 1;
                    continue;
                };
                packs += 1;
                let named: Option<HashSet<[u8; 32]>> = pack.rows.as_ref().map(|rows| rows.iter().copied().collect());
                for (e, s) in kept {
                    match &named {
                        Some(named) if !named.contains(&key.shown_row(&e)) => continue,
                        Some(_) => {
                            store.shown_given.insert(e, s.print);
                        }
                        None => {}
                    }
                    store.kept_shown.insert(e, s);
                }
            }
            store.perf.count("kept shown: showings", store.kept_shown.len() as u64);
            store.perf.add("open kept shown", at);
            // and the query views it kept, each its query's from the pack its row names, to answer from while current
            let at = Perf::start();
            let views = store.query_views.get_mut().unwrap_or_else(|p| p.into_inner());
            for pack in &warm.queries {
                let named: Option<HashSet<[u8; 32]>> = pack.rows.as_ref().map(|rows| rows.iter().copied().collect());
                let mut bytes = vec![0; pack.file.len() as usize];
                let took = pack.file.read_at(0, &mut bytes).ok().map(|()| bytes)
                    .and_then(|bytes| key.unlock("query views", &bytes, ENGINE.as_bytes()))
                    .and_then(|bytes| views.take_kept(&bytes, |q| named.as_ref().is_none_or(|n| n.contains(&key.query_row(q)))));
                match took {
                    Some(n) => store.perf.count("kept query views: views", n as u64),
                    None => store.perf.count("kept query views: a pack that doesn't open", 1),
                }
            }
            store.perf.add("open kept query views", at);
            (restored.kept.0, restored.showings) = (packs, store.kept_shown.len());
            store.restored = Some(restored);
        } else if let Some(store) = self.stores.get_mut(&d) {
            let edits = store.log.edits().len();
            store.restored = Some(Restored { edits, view: ViewOpened::Locked, kept: (0, 0), showings: 0 });
        }
        // what is left to do: the edits past its stored view, and the entries no showing it kept stands for. A start
        // of little does it in one go; one of more does a step of it and ends behind, its node's catch-up steps doing
        // the rest a turn at a time as its pages read (`CatchUpBudget.lean`): an iPhone's unlock with no view of a
        // partial vault replayed, read and showed it all inside the start, 313 s (2026-10-28)
        let Some(store) = self.stores.get_mut(&d) else { return };
        let unshown = store.replay.state.entries().len().saturating_sub(store.kept_shown.len());
        let left = store.log.edits().len().saturating_sub(store.replayed) + unshown;
        if left <= store.restore_whole {
            self.refresh(d, &[]);
            return;
        }
        store.behind = true;
        store.perf.count("restore: left to its catch-up", left as u64);
        self.refresh_with(d, &[], Some(RESTORE_BUDGET));
    }

    /// The work device `d`'s start does in one go (`restore_end_with`), in edits to replay and entries to show:
    /// `RESTORE_WHOLE`, or `n`, as a test of a start that ends behind sets it.
    pub fn set_restore_whole(&mut self, d: SignerId, n: usize) {
        if let Some(store) = self.stores.get_mut(&self.at(d)) {
            store.restore_whole = n;
        }
    }

    /// Device `d`'s key for what it seals on its own shelf (`ShelfKey`), derived from its own key: `None` while it is
    /// locked.
    pub fn shelf_key(&self, d: SignerId) -> Option<ShelfKey> {
        let own = self.keys.get(&d).filter(|k| matches!(k, Key::Device(_)))?.seal_secret()?;
        Some(ShelfKey(own.child("shelf seal", &[])))
    }

    /// What of `Warm` device `d`'s shelf lacks, encrypted for it alone, to put there (`Warming`), its shelf holding the
    /// first `held` edits of its log and naming those it checked by `checked`: its keys, where it opened a key since its
    /// shelf took them or its shelf names the edits it checked anew; and its stored view, where it replayed every edit
    /// since its shelf took its view or stepped `VIEW_STEPS` edits on it, and the shelf holds every edit it is of.
    /// `None` while it is locked, and where its shelf lacks nothing. It holds them given only once the shelf took them
    /// (`warmed`), so a save cut short gives them again.
    pub fn warming(&mut self, d: SignerId, held: usize, checked: Option<Checked>) -> Option<Warming> {
        self.capture_warm(d, held, checked).map(WarmCapture::encode)
    }

    /// Capture only inputs needed by the canonical snapshot encoder. No history serialization,
    /// bulk encryption occurs here. Captures IDs/bits/acts/key handles and hashes the ordered log IDs; no edit bodies.
    /// The caller must release Lab before encoding. The existing receipt fence is retained.
    pub fn capture_warm(&mut self, d: SignerId, held: usize, checked: Option<Checked>) -> Option<WarmCapture> {
        self.capture_warm_at(d, held, checked, Some(false))
    }

    /// Clean shutdown has stopped writers and saved the authoritative journal. Publish
    /// its current derived state without waiting for the background snapshot interval.
    /// A current acknowledged view remains a no-op; failed persistence acknowledges nothing.
    pub fn capture_warm_current(&mut self, d: SignerId, held: usize, checked: Option<Checked>) -> Option<WarmCapture> {
        self.capture_warm_at(d, held, checked, Some(true))
    }

    /// `capture_warm` of its keys alone, where they are due: put on its shelf as soon as it put a head of edits it
    /// checked (`checked`), so that a node stopped before the rest of its save still holds that head on their word as
    /// it starts again, never checking every edit of it again.
    pub fn capture_warm_keys(&mut self, d: SignerId, checked: Option<Checked>) -> Option<WarmCapture> {
        self.capture_warm_at(d, 0, checked, None)
    }

    /// `capture_warm`: of everything due where `current` (`Some`), as it is now where `Some(true)`; of its keys alone
    /// where `None`.
    fn capture_warm_at(&mut self, d: SignerId, held: usize, checked: Option<Checked>, current: Option<bool>) -> Option<WarmCapture> {
        let key = self.shelf_key(d)?;
        let store = self.stores.get(&d)?;
        let close_due = current == Some(true) && store.replayed > 0 && store.replayed <= store.log.edits().len()
            && store.view_given.map(|h| h.at as usize) != Some(store.replayed);
        let keys_due = store.keys_due(checked);
        let view_due = current.is_some() && (store.view_due() || close_due) && store.replayed <= held;
        // the showings its shelf lacks, as often as its view, and once its shelf holds none of them yet
        let fresh_shown =
            if current.is_some() && (view_due || store.shown_given.is_empty()) { store.shown_due() } else { vec![] };
        // and the query views its shelf lacks, as they are now
        let queries = match current.is_some() {
            true => store.query_views.lock().unwrap_or_else(|p| p.into_inner()).due(&self.query_view_stamp(d)),
            false => vec![],
        };
        if !keys_due && !view_due && fresh_shown.is_empty() && queries.is_empty() { return None; }
        let (queries_of, queries) = match queries.is_empty() {
            true => (None, None),
            false => {
                let (of, packs): (Vec<_>, Vec<_>) = queries.into_iter().map(|(key, stamp, b)| ((key, stamp), b)).unzip();
                (Some(of), Some(packs))
            }
        };
        let (shown, shown_of) = match fresh_shown.is_empty() {
            true => (None, None),
            false => {
                let mut shown = vec![];
                let mut of = vec![];
                for e in fresh_shown {
                    if let (Some(record), Some(print)) = (store.shown.record(&e), store.shown.print(&e)) {
                        shown.push((e, print, record));
                        of.push((e, print));
                    }
                }
                (Some(shown), Some((of, store.log.head())))
            }
        };
        let keys_of = keys_due.then(|| (checked.or(store.checked_given), store.opened_since.len()));
        let opened = keys_due.then(|| store.opened_before.iter()
            .chain(store.opened_since.iter().map(|(b, k)| (b, k)))
            .map(|(b, k)| (*b, k.clone())).collect());
        let replay = view_due.then(|| store.replay.capture_view());
        let read = if view_due { stored_readings::seal(store, store.replayed) } else { None };
        let receipt = Warming {
            keys: None, view: None,
            revision: store.warm_revision.clone(), head: store.log.head(), keys_of,
            view_of: if view_due { store.log.head_at(store.replayed as u64).map(|h| (h, store.wholes)) } else { None },
            view_read: read.is_some(),
            shown: None,
            shown_of,
            queries: None,
            queries_of,
        };
        let mut seed = Zeroizing::new([0u8; 32]);
        self.rng.fill_bytes(&mut *seed);
        let rng = SeededRng::new("warm snapshot encryption", &*seed);
        Some(WarmCapture { key, rng, opened, replay, read, shown, queries, receipt })
    }

    /// Whether device `d`'s shelf lacks something of `Warm` (`warming`), as cheaply as it tells: the node's saver is
    /// woken as it comes to, so a replay or a key opened with nothing else to save reaches the shelf too.
    pub fn warm_due(&self, d: SignerId) -> bool {
        self.stores.get(&d).is_some_and(|store| {
            store.keys_due(None) || store.view_due() || (store.shown_given.is_empty() && !store.shown_due().is_empty())
                || !store.query_views.lock().unwrap_or_else(|p| p.into_inner()).due(&self.query_view_stamp(d)).is_empty()
        })
    }

    /// Device `d`'s shelf took `warming` (`warming`): what it gave, it holds given, only while the store and its
    /// pending prefix still match. Native saves serialize receipts; overlapping core callers conservatively give
    /// pending work again after the first acknowledgement, rather than drain keys an older receipt never held.
    pub fn warmed(&mut self, d: SignerId, warming: Warming) {
        let Some(store) = self.stores.get_mut(&d) else {
            return;
        };
        if !Arc::ptr_eq(&store.warm_revision, &warming.revision) || !store.log.of_log(warming.head) {
            return;
        }
        store.warm_revision = Arc::new(());
        if let Some((checked, opened)) = warming.keys_of {
            store.checked_given = checked;
            let given: Vec<([u8; 32], Secret)> =
                store.opened_since.drain(..opened.min(store.opened_since.len())).collect();
            store.opened_before.extend(given);
        }
        if let Some((head, wholes)) = warming.view_of {
            // a view given without what it read is given again once it can seal that beside it
            store.view_given = Some(head);
            store.read_given = warming.view_read.then_some(head);
            store.view_wholes = wholes;
        }
        if let Some((of, _)) = warming.shown_of {
            store.shown_given.extend(of);
        }
        if let Some(of) = warming.queries_of {
            store.query_views.get_mut().unwrap_or_else(|p| p.into_inner()).given(&of);
        }
    }

    /// Bind a real device's handoff key to a verified passkey ceremony. Unlike `device_of`, a browser's
    /// `device_with` has no software passkey in `salts`. Keep only the domain-separated handoff key,
    /// never the passkey's signing seed. A Touch ID ceremony cannot hand a view to another device.
    pub fn hand_from_ceremony(&mut self, d: SignerId, passkey: SignerId, ceremony: &Ceremony) -> bool {
        if !matches!(self.keys.get(&d), Some(Key::Device(_))) {
            return false;
        }
        let Some(keys @ SignerKeys::Passkey { .. }) = self.keys_of(passkey) else {
            return false;
        };
        let Some(challenge) = ceremony.challenge() else {
            return false;
        };
        if ceremony.sign(keys, EditId(challenge)).is_none() {
            return false;
        }
        self.hand_keys.insert(d, HandKey::of(&ceremony.seal_secret()));
        true
    }

    /// Device `d`'s key for what it hands another device of its passkey (`HandKey`): `None` while it is locked, and for
    /// a device whose keys derive from no passkey (the server, a stranger). A page derives it from its ceremony's PRF
    /// output (`HandKey::of`).
    pub fn hand_key(&self, d: SignerId) -> Option<HandKey> {
        if !matches!(self.keys.get(&d), Some(Key::Device(_))) {
            return None;
        }
        if let Some(key) = self.hand_keys.get(&d) {
            return Some(key.clone());
        }
        let (Some(Key::Device(_)), Some(&(passkey, _))) = (self.keys.get(&d), self.salts.get(&d)) else {
            return None;
        };
        let Some(Key::Passkey(p)) = self.keys.get(&passkey) else {
            return None;
        };
        Some(HandKey::of(&p.seal_secret()))
    }

    /// What device `d` hands a new device of its passkey to start from (`start_handed`, M6): the ids of the edits it
    /// holds, each checked as it took it, and its replay of them as its stored view (`Replay::to_view`), locked for that
    /// passkey's devices alone (`HandKey`) and, as a stored view is, for the replay rules it was worked out under
    /// (`VIEW_RULES`, `ViewRules.lean`): locked for the engine's hash, every release left each handed view shut, and a
    /// new device replayed every edit itself (2026-10-29). The new device then neither checks them again nor replays
    /// them. `None` while it is locked, for a device of no passkey, and while its replay is not of every edit it holds.
    pub fn handing(&mut self, d: SignerId) -> Option<Vec<u8>> {
        let key = self.hand_key(d)?;
        let Lab { stores, rng, .. } = self;
        let store = stores.get(&d)?;
        let n = store.log.edits().len();
        if n == 0 || store.replayed != n {
            return None;
        }
        let at = Perf::start();
        let mut bytes = Zeroizing::new(HANDED.to_vec());
        bytes.extend((n as u64).to_le_bytes());
        store.log.ids().iter().for_each(|id| bytes.extend(id.0));
        bytes.extend(store.replay.to_view(n));
        let handed = key.0.lock("handed view", &bytes, VIEW_RULES.as_bytes(), rng);
        if let Some(store) = stores.get_mut(&d) {
            store.perf.add("hand view", at);
        }
        Some(handed)
    }

    /// `restore_from`, for a new device `d` of a passkey, with what another device of the passkey handed it
    /// (`handing`) beside the edits it took (`backup`): it doesn't check the signatures of the edits the handed view is
    /// of, which its giver checked, and its replay starts from that view, the others stepped on it, the last ones
    /// replayed again or all of them, as they fall (`V7_handed_view`). True where it took the view: one that opens with
    /// its passkey's key, under these replay rules, of edits it took every one of; else it starts as `restore_from` does.
    pub fn start_handed(&mut self, d: SignerId, backup: Backup, handed: &[u8]) -> bool {
        let at = Perf::start();
        let key = self.hand_key(d);
        let opened = key.and_then(|key| key.0.unlock("handed view", handed, VIEW_RULES.as_bytes()));
        let Some((ids, view)) = opened.as_ref().and_then(|b| handed_of(b)) else {
            self.restore_from(d, backup);
            return false;
        };
        let of: HashSet<EditId> = ids.iter().copied().collect();
        let took: HashSet<EditId> = backup.signed.iter().map(|s| s.edit.id()).filter(|id| of.contains(id)).collect();
        if took.len() != of.len() {
            self.restore_from(d, backup);
            return false;
        }
        // the edits the view is of first, in the order its giver took them, the others after them as they came
        let Backup { signed, blobs, .. } = backup;
        let (first, rest): (Vec<Signed>, Vec<Signed>) = signed.into_iter().partition(|s| of.contains(&s.edit.id()));
        let mut first: HashMap<EditId, Signed> = first.into_iter().map(|s| (s.edit.id(), s)).collect();
        let first: Vec<Signed> = ids.iter().filter_map(|id| first.remove(id)).collect();
        let held = self.held(d);
        let (follow, query_depth, gate, perf) = (held.follow.clone(), held.query_depth, held.gate, held.perf.clone());
        let (spilled, keys) = (held.signed.fresh(), held.blobs.fresh_keys());
        self.stores.insert(d, Store { follow, query_depth, gate, perf, signed: spilled, blobs: keys, ..Store::default() });
        let offered = (first.len() + rest.len()) as u64;
        let fresh = self.fresh(d, first.into_iter().chain(rest).collect(), &of);
        let Some(store) = self.stores.get_mut(&d) else {
            return false;
        };
        store.perf.add("check", at);
        store.perf.count("edits offered", offered);
        store.perf.count("edits checked", fresh.iter().filter(|s| !of.contains(&s.edit.id())).count() as u64);
        store.perf.count("edits handed", of.len() as u64);
        self.keep_fresh(d, fresh, &blobs);
        let Some(store) = self.stores.get_mut(&d) else {
            return false;
        };
        let at = Perf::start();
        let took = match Replay::from_view(view, store.log.edits(), store.log.ids()) {
            Some((replay, held)) => {
                // a run under way stepped on the replay it held: it goes with it
                store.replaying = None;
                store.replay = replay;
                store.replayed = held;
                store.perf.count("replay: from a handed view", 1);
                true
            }
            None => {
                store.perf.count("handed view: of other edits", 1);
                false
            }
        };
        store.perf.add("open view", at);
        self.refresh(d, &[]);
        took
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
                    self.stores.values().find_map(|s| s.signed.get(&id)).map(|s| Signed::clone(&s)).expect("an edit some device holds");
                if let Action::Write { body, .. } = &mut signed.edit.action
                    && !body.is_empty()
                {
                    let mut bytes = body.to_vec();
                    *bytes.last_mut().expect("a byte") ^= 1;
                    *body = bytes.into();
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
                let boxes = vec![KeyBox { to: recipient, bytes: bytes.into() }];
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
    let at = Perf::start();
    // the stays each audience had, made only where `derive` needs them: of the entries whose stays may have changed
    // since it last derived, or of every entry
    let changed = stays_changed(store);
    let (mut all, mut some) = (None, None);
    store.perf.count(if changed.is_some() { "keys: stays of the entries changed" } else { "keys: stays of every entry" }, 1);
    store.perf.add("keys: stays", at);
    loop {
        let mut more = false;
        let at = Perf::start();
        for b in &ix.boxes {
            let (name, id) = (&b.name, &b.id);
            if store.keys.contains(id) {
                continue;
            }
            let with = match b.to {
                Recipient::Signer(s) => mine.iter().find(|m| m.0 == s).map(|m| m.1.clone()),
                // a box to an entry's key, a link of its earlier stay's, derives that key where it is to open it
                Recipient::Key { name: to, id: under } => match store.keys.get(&under, to) {
                    Some(k) => Some(k.clone()),
                    None => {
                        let tried = box_audience(&store.keys, &store.replay.state, to);
                        if store.underived.get(&(b.of, b.slot)) == Some(&tried) {
                            continue;
                        }
                        match entry_key_of(&store.keys, &store.replay.state, to, under, None) {
                            Some((k, ..)) => {
                                store.perf.count("keys derived for a body or box", 1);
                                more |= store.keys.insert(to, k.clone());
                                Some(k)
                            }
                            None => {
                                store.perf.count("keys: boxes underived", 1);
                                store.underived.insert((b.of, b.slot), tried);
                                None
                            }
                        }
                    }
                },
            };
            let Some(with) = with else { continue };
            if store.unopened.contains(&(b.of, b.slot)) {
                continue;
            }
            let bytes = b.bytes(store.log.edits());
            let info = box_info(*name, *id, &b.to);
            let opened = opened_box(&info, &bytes, &with);
            // the same box it opened before with the same key, as its shelf keeps it: what opened, again
            if let Some(secret) = store.opened_before.get(&opened).filter(|k| k.id() == *id) {
                more |= store.keys.insert(*name, secret.clone());
                store.perf.count("keys from the shelf", 1);
                continue;
            }
            match keys::open(&bytes, &with, &info) {
                Some(secret) if secret.id() == *id => {
                    store.perf.count("keys opened", 1);
                    store.opened_since.push((opened, secret.clone()));
                    more |= store.keys.insert(*name, secret);
                }
                _ => {
                    store.unopened.insert((b.of, b.slot));
                }
            }
        }
        store.perf.add("keys: boxes", at);
        let at = Perf::start();
        for &(name, id, bytes) in &ix.clear {
            let secret = Secret::from_bytes(bytes);
            if !store.keys.contains(&id) && secret.id() == id {
                more |= store.keys.insert(name, secret);
            }
        }
        store.perf.add("keys: clear", at);
        let at = Perf::start();
        more |= derive(store, changed.as_ref(), &mut all, &mut some);
        store.perf.add("keys: derive", at);
        if !more {
            break;
        }
    }
    store.stays_seen = Some((store.log.head(), store.wholes));
    // every entry's key now that the first key it holds of its audience at its epoch derives, it derived
    #[cfg(debug_assertions)]
    {
        let now = now_keys_of(&store.replay.state, None);
        for id in &store.keys.audiences {
            let (name, _) = store.keys.by_id[id];
            let KeyName::Scoped(KeyFam::Audience(_, x), g) = name else { continue };
            if store.keys.first(name).map(Secret::id) != Some(*id) {
                continue;
            }
            for &(e, s) in now.get(&(x, g)).into_iter().flatten() {
                debug_assert!(store.derived.contains(&(*id, e, s)), "derive left out {e:?} in its stay {s:?} at epoch {g}");
            }
        }
    }
}

/// Each entry's key now, in its stay now at its audience's epoch now (`State::entry_key`), which the writes to come are
/// under, by the audience and epoch it derives from: of the entries `of` alone, or of every one, in the order they were
/// created. A key of an entry its edits name otherwise, that of a write or a link, is derived where a body or a box asks
/// for it by its id (`entry_key_of`): until 2026-10-28 a device derived the key of every entry for every key of its
/// audience it held, which at 32,000 edits over 65 keys of one audience was 208,000 keys, 440 ms in one step, where
/// each entry's writes were under one (`KeyDerivation.lean`).
fn now_keys_of(st: &State, of: Option<&HashSet<EntryId>>) -> NowKeys {
    let mut now: NowKeys = HashMap::new();
    let add = |en: &Entry| {
        if let Some(KeyName::Entry(e, s, g)) = st.entry_key(en.id) {
            now.entry((en.audience(), g)).or_default().push((e, s));
        }
    };
    match of {
        Some(es) => {
            let mut ens: Vec<&Entry> = es.iter().filter_map(|e| st.entry(*e)).collect();
            ens.sort_by_key(|en| st.entry_place(en.id));
            ens.into_iter().for_each(add);
        }
        None => st.entries().iter().for_each(add),
    }
    now
}

/// The entries' keys now (`now_keys_of`): of each audience at each epoch, the entries and their stays.
type NowKeys = HashMap<(AudienceId, u64), Vec<(EntryId, Option<EditId>)>>;

/// The key `id` of entry key `name`, derived from a key of the audience of its stay at its epoch that the keyring `keys`
/// holds (`keys::entry_key`), as a body under it or a box to it asks for it, with the audience key it derives from: none
/// where no key it holds derives it. A family can have several keys of one epoch, as devices made them at the same time,
/// each its writes under its own: for a body of author `by`, the audience key its last body under the same audience was
/// under is tried first (`Keyring::derived_by`), so a body costs one derivation, not one for each key of its audience
/// (65 at 32,000 edits, 58 ms a step). An author writes under several audiences, its vault's and a coop's, each its own
/// key: one hint for all of them missed at nearly every body (2026-10-28, the iPhone-size unlock).
fn entry_key_of(keys: &Keyring, st: &State, name: KeyName, id: KeyId, by: Option<SignerId>) -> Option<(Secret, KeyName, KeyId)> {
    let KeyName::Entry(e, s, _) = name else { return None };
    let audience = entry_audience(st, name)?;
    let hint = by.and_then(|b| keys.derived_by.get(&(b, audience)));
    let hinted = hint.and_then(|h| keys.by_id.get(h)).map(|(_, a)| a);
    hinted.into_iter().chain(keys.held(audience)).find_map(|a| {
        let k = keys::entry_key(a, e, s);
        (k.id() == id).then(|| (k, audience, a.id()))
    })
}

/// The audience key name an entry key `name` derives from (`entry_key_of`): its entry's audience in its stay, at its
/// epoch; none where `name` is no entry key, or its entry or stay is not in `st`.
fn entry_audience(st: &State, name: KeyName) -> Option<KeyName> {
    let KeyName::Entry(e, s, g) = name else { return None };
    let en = st.entry(e)?;
    Some(KeyName::Scoped(KeyFam::Audience(en.vault, en.stay_audience(s)?), g))
}

/// What deriving entry key `name` from the audience keys held tries (`entry_key_of`, unhinted): the audience, and how
/// many of its keys `keys` holds. Where it is as it was, a derivation that found none finds none again.
fn box_audience(keys: &Keyring, st: &State, name: KeyName) -> (Option<KeyName>, usize) {
    let audience = entry_audience(st, name);
    (audience, audience.map_or(0, |a| keys.by_name.get(&a).map_or(0, Vec::len)))
}

/// The entries whose stays may have changed since device's store `store` last derived its entry keys (`derive`): those
/// of the edits it took since, where each is of an entry's own log and no removal, which alone moves an entry or takes
/// one away. `None` where it is to look at every entry: another edit came, its log began again, or its replay did.
fn stays_changed(store: &Store) -> Option<HashSet<EntryId>> {
    let (head, wholes) = store.stays_seen.as_ref()?;
    let log = &store.log;
    if !log.of_log(*head) || store.wholes != *wholes {
        return None;
    }
    let len = &(head.at as usize);
    let mut out = HashSet::new();
    for (edit, place) in log.edits()[*len..].iter().zip(&log.logs()[*len..]) {
        match place {
            Some(crate::sync::LogId::Entry(e)) if !edit.is_removal() => {
                out.insert(*e);
            }
            _ => return None,
        }
    }
    Some(out)
}

/// Derive each entry's key now (`now_keys_of`) from the first key of its audience at its epoch that the device holds,
/// the one its next write is under (`entry_key_for`): true if it derived any. An audience key it derived with before
/// looks only at the entries `changed` since where there are such (`stays_changed`); else at every entry whose key now
/// it derives (`all`, made once for every key), but where they are as they were when it last did.
fn derive(store: &mut Store, changed: Option<&HashSet<EntryId>>, all: &mut Option<NowKeys>, some: &mut Option<NowKeys>) -> bool {
    let Store { keys, derived, derived_through, replay, perf, .. } = store;
    let st = &replay.state;
    let mut new = vec![];
    for id in &keys.audiences {
        let (name, audience) = &keys.by_id[id];
        let KeyName::Scoped(KeyFam::Audience(_, x), g) = *name else {
            continue;
        };
        if keys.first(*name).map(Secret::id) != Some(*id) {
            continue;
        }
        let now = match changed.filter(|_| derived_through.contains_key(id)) {
            Some(ch) => some.get_or_insert_with(|| now_keys_of(st, Some(ch))),
            None => {
                let all = all.get_or_insert_with(|| now_keys_of(st, None));
                let mut h = Hasher::new("lab keys now");
                for (e, s) in all.get(&(x, g)).into_iter().flatten() {
                    h.update(&e.0).update(s.as_ref().map_or(&[0; 32], |s| &s.0));
                }
                let print = h.finalize();
                if derived_through.insert(*id, print) == Some(print) {
                    continue;
                }
                all
            }
        };
        for &(e, s) in now.get(&(x, g)).into_iter().flatten() {
            if derived.insert((*id, e, s)) {
                new.push((KeyName::Entry(e, s, g), keys::entry_key(audience, e, s)));
            }
        }
    }
    perf.count("keys derived", new.len() as u64);
    let more = !new.is_empty();
    for (name, key) in new {
        keys.insert(name, key);
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
/// At most `most` bodies opened, if there is one: those of new edits first, then those a step left before
/// (`ReadNew::left`), the rest left for the next step; with none, those of new edits alone. True if it left none.
fn read(d: SignerId, store: &mut Store, most: Option<usize>) -> bool {
    let st = &store.replay.state;
    for cp in st.shares() {
        let (id, of) = (cp.id, &cp.share);
        if store.slices.contains_key(&id) || store.unreadable.contains(&id) {
            continue;
        }
        match open_select(of, &store.keys, st.acts_for(d, of.over)) {
            Ok(Some(slice)) => {
                store.slices.insert(id, slice);
                store.read_new.slices.push(id);
            }
            Ok(None) => {}
            Err(()) => {
                store.unreadable.insert(id);
            }
        }
    }
    let at = Perf::start();
    // the bodies it may open now: of the edits it took since it last looked, of those its replay didn't count then,
    // and of those of the entries whose keys it took since; or, where its log or its replay began again since, of
    // every write its replay counts (`ReadNew::since`)
    let mut keyed = std::mem::take(&mut store.keys.keyed_for_read);
    // a key of an audience it took since may derive the key of any body it lacked one for
    if std::mem::take(&mut store.keys.audience_for_read) {
        keyed.extend(store.read_new.lacking.keys().copied());
    }
    let wanted: Vec<EditId> = match store.read_new.since(&store.log, store.wholes, keyed) {
        Some(ids) => ids,
        None => {
            store.perf.count("read: every write", 1);
            let retags = st.entries().iter().flat_map(|en| en.retags.iter().copied());
            let mut all: Vec<EditId> = st.all_writes().iter().map(|w| w.edit).chain(retags).collect();
            // and the writes it holds that its replay doesn't count, which wait for it to
            let counted: HashSet<EditId> = all.iter().copied().collect();
            all.extend(store.log.ids().iter().filter(|id| !counted.contains(id)));
            all
        }
    };
    store.perf.count("read: writes looked at", wanted.len() as u64);
    // of the edits named, the writes alone have a body: the others (keys, wraps, marks, shares) are no body to open,
    // and none of them is counted against `most` or left for a step (an iPhone's catch-up of one 712-edit page left
    // its 108,000 keys, wraps and marks to look at 32 a step after a whole replay, 3,629 steps of 24 ms, 2026-10-28)
    let mut wanted: Vec<EditId> = wanted
        .into_iter()
        .filter(|id| !store.bodies.contains_key(id) && !store.spoilt.contains(id))
        .filter(|id| store.signed.get(id).is_some_and(|s| matches!(s.edit.action, Action::Write { .. })))
        .collect();
    // a step of a catch-up opens at most `most` (a first sync's 130,000 bodies took 1.7 s in one turn, 2026-10-27):
    // the bodies of new edits first, then those it left before, the rest left for the next step, as they were
    if let Some(most) = most {
        let most = most.max(1);
        let left = &mut store.read_new.left;
        if wanted.len() < most {
            let more = left.len().min(most - wanted.len());
            wanted.extend(left.drain(..more));
        }
        if wanted.len() > most {
            for id in wanted.drain(most..).rev() {
                left.push_front(id);
            }
        }
    }
    // with none it leaves those a step left as they are, as `show_items` leaves the entries: a write of the device's
    // own in the middle of a catch-up waits for no reading of the whole, and the catch-up's next step goes on
    let done = store.read_new.left.is_empty();
    if !wanted.is_empty() {
        // each edit by its id from the signed edits it holds, every one of which its replay is of: no map of every
        // edit made again for each reading
        for id in wanted {
            // an id it is handed twice (new, and left by a step, or lacking its key before) is opened once: each one
            // opened is counted once in what it reads on from (`ReadNew::basis`), or it reads every body again
            if store.bodies.contains_key(&id) || store.spoilt.contains(&id) {
                continue;
            }
            let Some(signed) = store.signed.get(&id) else { continue };
            let edit = &signed.edit;
            let Action::Write { entry, stay, epoch, body, .. } = &edit.action else {
                continue;
            };
            // a write its replay counts, or whose tags count: another waits for it to
            let counts = st.write(id).is_some() || st.entry(*entry).is_some_and(|en| en.retags.contains(&id));
            if !counts {
                store.read_new.uncounted.insert(id);
                continue;
            }
            let Some(key) = keys::edit_key(&body.bytes()) else {
                store.spoilt.insert(id);
                continue;
            };
            // the key it is under, derived here where it isn't held: of the bodies it reads, the newest first, at most
            // `most` a step (`KeyDerivation.lean`)
            let name = KeyName::Entry(*entry, *stay, *epoch);
            let key = match store.keys.get(&key, name) {
                Some(k) => k.clone(),
                None => match entry_key_of(&store.keys, st, name, key, Some(edit.author)) {
                    Some((k, audience, from)) => {
                        store.perf.count("keys derived for a body or box", 1);
                        store.keys.derived_by.insert((edit.author, audience), from);
                        store.keys.insert(name, k.clone());
                        k
                    }
                    None => {
                        store.read_new.lacking.entry(*entry).or_default().push(id);
                        continue;
                    }
                },
            };
            match keys::open_edit(&key, &body.bytes(), &write_context(edit)).and_then(|plain| Body::from_wire(&plain).ok()) {
                Some(b) => {
                    store.bodies.insert(id, b);
                    store.read_new.bodies.push(id);
                    store.opened.entry(*entry).or_default().push(id);
                    store.files_at = OnceLock::new();
                }
                None => {
                    store.spoilt.insert(id);
                }
            }
        }
    }
    // what it opened is what looking at every write its replay counts opens, once it left none
    #[cfg(debug_assertions)]
    if done {
        let retags = st.entries().iter().flat_map(|en| en.retags.iter().copied());
        for id in st.all_writes().iter().map(|w| w.edit).chain(retags) {
            if store.bodies.contains_key(&id) || store.spoilt.contains(&id) {
                continue;
            }
            let Some(signed) = store.signed.get(&id) else { continue };
            let Action::Write { entry, stay, epoch, body, .. } = &signed.edit.action else { continue };
            let name = KeyName::Entry(*entry, *stay, *epoch);
            let opens = keys::edit_key(&body.bytes())
                .and_then(|k| store.keys.get(&k, name).cloned().or_else(|| entry_key_of(&store.keys, st, name, k, None).map(|(k, ..)| k)));
            debug_assert!(opens.is_none(), "read left {id:?} unopened, which it opens");
        }
    }
    store.perf.add("read: bodies", at);
    let at = Perf::start();
    // what it reads in them: on what it read last time, the bodies and selectors it opened since alone, where it
    // only opened more since (`ReadNew`); else all of them again
    let on = store.read_new.basis(store.bodies.len(), store.slices.len(), &store.readings);
    store.perf.count(if on { "read: on" } else { "read: whole" }, 1);
    let mut r = match on {
        true => {
            let mut r = std::mem::take(&mut store.readings);
            r.touches.clear();
            r.adds.clear();
            for (c, slice) in store.read_new.slices.iter().filter_map(|c| Some((c, store.slices.get(c)?))) {
                r.selectors.insert(*c, slice.select.clone());
            }
            let with = Opener { signed: &store.signed, keys: &store.keys, st };
            for (id, b) in store.read_new.bodies.iter().filter_map(|id| Some((id, store.bodies.get(id, &with)?))) {
                read_body(&mut r, *id, b);
            }
            r
        }
        false => readings_of(store),
    };
    store.read_new.slices.clear();
    store.read_new.bodies.clear();
    // the entries whose header it hasn't read: any of them may be of any type, so the index hands them to every query
    // by type, which finds them waiting (`Lab::query_candidates`)
    let st = &store.replay.state;
    r.untyped = st.entries().iter().filter(|en| !r.headers.contains_key(&en.creation)).map(|en| en.id).collect();
    // the cap groups in force follow from what the device counts (`show_items`): read on, they came with the readings
    if !on {
        r.groups = std::mem::take(&mut store.readings.groups);
    }
    #[cfg(debug_assertions)]
    #[cfg(not(avendb_no_replay_checks))]
    debug_assert!(same_readings(&r, &readings_of(store)), "readings read on differ from readings read whole");
    store.readings = r;
    store.recontext();
    store.read_new.read(store.bodies.len(), store.slices.len(), &store.readings);
    store.read_new.looked(&store.log, store.wholes);
    store.perf.add("read: readings", at);
    done
}

/// What device's store `store` reads in every body and selector it opened (`read`), but which entries are of no type
/// and the cap groups in force.
fn readings_of(store: &Store) -> Readings {
    let mut r = Readings::default();
    for (c, s) in &store.slices {
        r.selectors.insert(*c, s.select.clone());
    }
    for (id, b) in store.metadata_bodies() {
        read_body(&mut r, *id, b);
    }
    r
}

/// What write `id`'s body `b` says, into `r`.
fn read_body(r: &mut Readings, id: EditId, b: &Body) {
    if let Some(h) = &b.header {
        r.put_header(id, h.clone());
        // a schema or lens entry's creation holds the schema or the lens itself, and fits where it is one of its
        // type: what its readers read into its vault's lane where it acted for that vault (`State::lane_of`)
        if h.ty.of_lane() {
            r.blobs.insert(id, b.content[..].into());
            if !lane_fits(&h.ty, &b.content) {
                r.unfit.insert(id);
            }
        }
    }
    r.tags.insert(id, b.tags.clone());
    if let Some(p) = &b.proof {
        r.proofs.insert(id, p.clone());
    }
    if let Some(g) = &b.defines {
        r.defines.insert(id, g.clone());
    }
}

/// Two readings alike, the cap groups and which entries are of no type aside, and the order each type's creations
/// were indexed in, which is a map's.
#[cfg(debug_assertions)]
fn same_readings(a: &Readings, b: &Readings) -> bool {
    fn listed<K: std::fmt::Debug, V: std::fmt::Debug>(m: impl Iterator<Item = (K, V)>) -> Vec<String> {
        let mut v: Vec<String> = m.map(|kv| format!("{kv:?}")).collect();
        v.sort();
        v
    }
    let typed = |r: &Readings| -> Vec<String> {
        listed(r.typed.iter().map(|(t, ids)| (t, ids.iter().copied().collect::<BTreeSet<EditId>>())))
    };
    let unfit = |r: &Readings| listed(r.unfit.iter().map(|k| (k, ())));
    typed(a) == typed(b)
        && listed(a.headers.iter()) == listed(b.headers.iter())
        && listed(a.selectors.iter()) == listed(b.selectors.iter())
        && listed(a.tags.iter()) == listed(b.tags.iter())
        && listed(a.proofs.iter()) == listed(b.proofs.iter())
        && listed(a.defines.iter()) == listed(b.defines.iter())
        && listed(a.blobs.iter()) == listed(b.blobs.iter())
        && unfit(a) == unfit(b)
        && a.touches.is_empty()
        && a.adds.is_empty()
}

/// What `read` opened since it last read, and what it read then: so that it reads on from there where it only opened
/// more since, rather than every body again (each of 130,000 a turn on a server's size, 2026-10-27). Anything else
/// that takes bodies or selectors away or puts in readings of its own sends `read` through them all again: the counts
/// then differ from those it kept (`basis`), or it forgets them (`forget`).
///
/// Which bodies it may open goes the same way: the edits it took since it last looked, those its replay didn't count
/// then, and those whose entry's key it lacked, of the entries whose keys it took since; every write its replay counts
/// where its log began again (a removal let go of edits) or its replay did (`Store::wholes`).
#[derive(Default)]
struct ReadNew {
    /// The counts of bodies, selectors, headers and tags as it last read, if it did since it last forgot.
    then: Option<(usize, usize, usize, usize)>,
    bodies: Vec<EditId>,
    slices: Vec<ShareId>,
    /// The log's head, and how many times the store replayed every edit, when it last looked.
    log: Option<(crate::log_head::Head, u64)>,
    /// The writes it held whose bodies it didn't open as its replay didn't count them.
    uncounted: HashSet<EditId>,
    /// The writes whose bodies it didn't open as it lacked their entry's key, by the entry.
    lacking: HashMap<EntryId, Vec<EditId>>,
    /// The writes a step of a catch-up left to open for the next (`read`, at most `most` a step), in order.
    left: std::collections::VecDeque<EditId>,
}

impl ReadNew {
    /// The writes whose bodies it may open now, as `ReadNew` says, `keyed` the entries whose keys it took since;
    /// `None` where it is to look at every write its replay counts.
    fn since(&mut self, log: &Log, wholes: u64, keyed: Vec<EntryId>) -> Option<Vec<EditId>> {
        let fresh = match self.log.as_ref() {
            Some((head, w)) if log.of_log(*head) && *w == wholes => head.at as usize,
            _ => {
                self.uncounted.clear();
                self.lacking.clear();
                self.left.clear();
                return None;
            }
        };
        let mut ids: Vec<EditId> = log.ids()[fresh..].to_vec();
        ids.extend(self.uncounted.drain());
        for e in keyed {
            ids.extend(self.lacking.remove(&e).into_iter().flatten());
        }
        Some(ids)
    }

    /// It looked at `log` and its replay now.
    fn looked(&mut self, log: &Log, wholes: u64) {
        self.log = Some((log.head(), wholes));
    }

    /// It reads on from what it read last time: what it holds now is that, and what it opened since, alone.
    fn basis(&self, bodies: usize, slices: usize, r: &Readings) -> bool {
        self.then.is_some_and(|(b, s, h, t)| {
            b + self.bodies.len() == bodies
                && s + self.slices.len() == slices
                && h == r.headers.len()
                && t == r.tags.len()
        })
    }

    fn read(&mut self, bodies: usize, slices: usize, r: &Readings) {
        self.then = Some((bodies, slices, r.headers.len(), r.tags.len()));
    }

    /// What it read is to be read whole again.
    fn forget(&mut self) {
        *self = ReadNew::default();
    }
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
        let Recipient::Key { name, id: under } = b.to else {
            continue;
        };
        let Some(with) = keys.get(&under, name) else {
            continue;
        };
        let key = keys::open(&b.bytes.bytes(), with, &share_select_info(of, id, &b.to)).filter(|k| k.id() == id).ok_or(())?;
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
#[allow(clippy::too_many_arguments)]
fn upkeep(
    d: SignerId,
    store: &mut Store,
    ix: &KeyIndex,
    mine: &[(SignerId, Secret)],
    rng: &mut SeededRng,
    spares: &mut Spares,
    scope: Option<&HashSet<EntryId>>,
    waiting: &HashSet<EntryId>,
) -> Vec<Work> {
    let st = store.replay.state.clone();
    let at = Perf::start();
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
    // and those a share's selector found lacking (`seal_slice`), till they come
    let mut sealing: BTreeSet<BlobId> = store.sealing.iter().filter(|b| !store.blobs.contains_key(b)).copied().collect();
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
                if ix.boxed.contains(&(name, id, t)) {
                    continue;
                }
                match key_box(&secret, t, &info, &st, store, ix, mine, rng) {
                    Some(b) => boxes.push(b),
                    None => sealing.extend(seal_key(t, &st, ix)),
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
            let Some(under) = store.keys.first(next).cloned() else {
                continue;
            };
            for secret in store.keys.held(name) {
                let id = secret.id();
                if ix.boxed.contains(&(name, id, next)) {
                    continue;
                }
                let to = Recipient::Key { name: next, id: under.id() };
                let bytes = keys::wrap(secret, &under, &box_info(name, id, &to), rng);
                let boxes = vec![KeyBox { to, bytes: bytes.into() }];
                out.push(Work::Edit(Action::Keys { name, id, public: None, boxes, clear: None }));
            }
        }
    }
    sealing.retain(|b| !store.blobs.contains_key(b));
    store.sealing = sealing;
    store.perf.add("upkeep: families", at);
    let at = Perf::start();
    // Every current entry audience occurs in key_fams. Reuse this round's exact entitlement
    // decisions from the same immutable State; never carry them across refreshes or revocation.
    let entitled: HashSet<KeyFam> = families.iter().copied().collect();
    // move links: the keys of an entry's earlier stays under a key of its stay now, as the schedule links them
    // of the entries in `scope` alone where it has one (`UpkeepDue`), and none a showing left to show: a debug build
    // checks that every other one calls for none
    for en in upkept(&st, scope) {
        if waiting.contains(&en.id) || !entitled.contains(&KeyFam::Audience(en.vault, en.audience())) {
            continue;
        }
        let skip = scope.is_some_and(|s| !s.contains(&en.id));
        if skip && !cfg!(debug_assertions) {
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
            let Some(under) = store.keys.first(to_name).cloned() else {
                continue;
            };
            for secret in store.keys.held(name) {
                let id = secret.id();
                if ix.boxed.contains(&(name, id, to_name)) {
                    continue;
                }
                let to = Recipient::Key { name: to_name, id: under.id() };
                let bytes = keys::wrap(secret, &under, &box_info(name, id, &to), rng);
                wraps.push(Wrap { name, id, boxed: KeyBox { to, bytes: bytes.into() } });
            }
        }
        debug_assert!(!skip || wraps.is_empty(), "upkeep left out {:?}, which has keys to wrap", en.id);
        if !wraps.is_empty() && !skip {
            out.push(Work::Edit(Action::Wraps { entry: en.id, wraps }));
        }
    }
    store.perf.add("upkeep: links", at);
    let at = Perf::start();
    for vt in st.vaults().iter().filter(|vt| st.acts_for(d, vt.id)) {
        out.extend(steward(store, &st, vt.id, scope, waiting));
    }
    store.perf.add("upkeep: steward", at);
    out
}

/// The entries an upkeep of the entries `scope` looks at, in the order they were created: those of `scope` alone, or
/// every one where it has none; in a debug build every one, which checks that those out of it call for nothing.
fn upkept<'s>(st: &'s State, scope: Option<&HashSet<EntryId>>) -> Vec<&'s Entry> {
    match scope {
        Some(s) if !cfg!(debug_assertions) => {
            let mut v: Vec<&Entry> = s.iter().filter_map(|e| st.entry(*e)).collect();
            v.sort_by_key(|en| st.entry_place(en.id));
            v
        }
        _ => st.entries().iter().collect(),
    }
}

/// What a steward of vault `v` does, once it reads the selector of every share of the vault (`Store::reads_shares`):
/// for each entry whose creation and tags it reads, it answers the asks for tags no write acting for the vault answered
/// yet, granting each its entry's readers count (`show_items`) where the asker may (`granted`), in one write acting for
/// the vault; and marks an entry no ask waits on in one mark (`policy::Meaning::mark`): with the audience its meaning
/// asks for, if it isn't there, and, once it reads the selector of every keep share over the vault too
/// (`Store::reads_keeps`), with the keep shares that pick it, if it isn't marked so. A part it has nothing to change in
/// it leaves out, so it never puts back an audience another steward changed meanwhile.
fn steward(
    store: &Store,
    st: &State,
    v: VaultId,
    scope: Option<&HashSet<EntryId>>,
    waiting: &HashSet<EntryId>,
) -> Vec<Work> {
    if !store.reads_shares(st, v) {
        return vec![];
    }
    let marks = store.reads_keeps(st, v);
    let r = &store.readings;
    let mut out = vec![];
    // of the entries in `scope` alone where it has one, and none a showing left to show (`upkeep`)
    for en in upkept(st, scope).into_iter().filter(|en| en.vault == v && !waiting.contains(&en.id)) {
        let skip = scope.is_some_and(|s| !s.contains(&en.id));
        if skip && !cfg!(debug_assertions) {
            continue;
        }
        let before = out.len();
        #[allow(clippy::never_loop)]
        'one: loop {
            if !r.headers.contains_key(&en.creation) || !en.retags.iter().all(|w| r.tags.contains_key(w)) {
                break 'one;
            }
            let Some(m) = st.meaning_landed(en.id, r, landed_in(store, en.id)) else {
                break 'one;
            };
            let ours = st.entry_writes(en.id).filter(|w| w.signer == v);
            let answered: HashSet<EditId> =
                ours.filter_map(|w| store.body_metadata(w.edit)).flat_map(|b| b.answers.iter().copied()).collect();
            let asks: Vec<&Write> = st
                .entry_writes(en.id)
                .filter(|w| w.signer != v && !w.first && !answered.contains(&w.edit))
                .filter(|w| store.body_metadata(w.edit).is_some_and(|b| !b.tags.is_empty()))
                .collect();
            if asks.is_empty() {
                if let Some((caps, wants)) = m.mark {
                    let wants = wants.filter(|_| marks);
                    if caps.is_some() || wants.is_some() {
                        let (keep, via) = (vec![], vec![]);
                        out.push(Work::Edit(Action::Mark { vault: v, entry: en.id, caps, wants, keep, via }));
                    }
                }
                break 'one;
            }
            let shown = store.shown.get(&en.id).map(|s| &s.history);
            let counted = |w: &Write| shown.and_then(|h| h.get(w.edit)).is_some_and(|c| c.counted);
            let mut tags = m.attrs.tags.clone();
            for w in &asks {
                let attrs = Attrs { tags: tags.clone(), ..m.attrs.clone() };
                if counted(w) && granted(st, store, w, &attrs) {
                    tags = store.body_metadata(w.edit).expect("read tag metadata").tags.apply(&tags);
                }
            }
            let add = tags.iter().filter(|t| !m.attrs.tags.contains(t)).cloned().collect();
            let remove = m.attrs.tags.iter().filter(|t| !tags.contains(t)).cloned().collect();
            let mut answers: Vec<EditId> = asks.iter().map(|w| w.edit).collect();
            answers.sort();
            let tags = TagDelta { add, remove };
            let body = Body { header: None, tags, answers, content: Arc::from([]), proof: None, files: vec![], defines: None };
            out.push(Work::Retag { vault: v, entry: en.id, body });
            break 'one;
        }
        debug_assert!(!skip || out.len() == before, "upkeep left out {:?}, which a steward has work in", en.id);
        if skip {
            out.truncate(before);
        }
    }
    out
}

/// The stewards grant what a write its readers count asks for, the tags it adds to and removes from an entry whose
/// attributes are `attrs`, which the chain of the share its proof names allows (`policy::State::lets`): where its
/// writer still holds that share, with write or more, and its slice holds the entry before the change and after it.
fn granted(st: &State, store: &Store, w: &Write, attrs: &Attrs) -> bool {
    let r = &store.readings;
    let after = Attrs { tags: store.body_metadata(w.edit).expect("read tag metadata").tags.apply(&attrs.tags), ..attrs.clone() };
    let share = r.proofs.get(&w.edit).and_then(|p| st.share(p.share));
    share.is_some_and(|cp| {
        st.holds(w.signer, cp, Level::Write) && st.eff_selects(cp, attrs, r) && st.eff_selects(cp, &after, r)
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
        return Some(KeyBox { to, bytes: bytes.into() });
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
    let bytes = keys::seal(secret, pk, &blob, &info(&to), rng)?;
    Some(KeyBox { to, bytes: bytes.into() })
}

/// Where a Lab opened with `entropy` counts its passes' nonces from (`Lab::passes`).
fn passes_from(entropy: &[u8]) -> AtomicU64 {
    AtomicU64::new(SeededRng::new("lab passes", entropy).next_u64())
}

/// The McEliece key `key_box` seals to for target `t` where it holds no key to wrap under: the signer's own, or the
/// oldest made of a seed's epoch.
fn seal_key(t: KeyName, st: &State, ix: &KeyIndex) -> Option<BlobId> {
    match t {
        KeyName::Signer(s) => Some(st.seal_key(s)?.mceliece),
        KeyName::Scoped(KeyFam::Seed(_), _) => Some(ix.made.get(&t)?.iter().min_by_key(|m| m.0)?.1.mceliece),
        _ => None,
    }
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
    let shown = match store.shown.get(&e) {
        Some(shown) => match shown.history_in(store) {
            Some(history) => Some(history),
            // Previously opened deferred state that no longer has current keys
            // cannot fall through to the ciphertext-only relay visibility rule.
            None => return false,
        },
        None => None,
    };
    if shown.is_some_and(History::landed) {
        return true;
    }
    let opened = shown.is_some_and(|h| h.changes().iter().any(|c| c.body.is_some()));
    let ours = |w: &&Write| w.shares.is_empty() || w.proposal != Proposal::Main;
    let ws: Vec<&Write> = st.entry_writes(e).filter(ours).collect();
    !opened && crate::policy::history(ws.iter(), MAIN).iter().any(|w| w.first)
}

/// Vault `v`'s lane as `State::lane_of` reads it, read off the schemas and lenses `r` holds (`Readings::blobs`), not
/// off every entry: those whose creation is of an entry of `v` as it is now, in the order the entries were created.
fn lane_blobs<'a>(st: &'a State, v: VaultId, r: &'a Readings) -> Vec<&'a [u8]> {
    let counts = |w: &Write| w.first && w.signer == v && w.proposal == Proposal::Main && !r.unfit.contains(&w.edit);
    let mut of: Vec<(usize, &[u8])> = r
        .blobs
        .iter()
        .filter(|(id, _)| r.headers.get(id).is_some_and(|h| h.ty.of_lane()))
        .filter_map(|(id, b)| {
            let w = st.write(*id).filter(|w| counts(w))?;
            let en = st.entry(w.entry).filter(|en| en.vault == v && en.creation == *id)?;
            Some((st.entry_place(en.id)?, &b[..]))
        })
        .collect();
    of.sort_by_key(|(at, _)| *at);
    let mut seen = HashSet::new();
    of.into_iter().map(|(_, b)| b).filter(|b| seen.insert(BlobId::of(b))).collect()
}

/// Retain reconstruction accelerators as entries finish, rather than keeping
/// one extra Loro document per entry until the entire database is reconstructed.
/// Entry iteration is unique; an evicted earlier entry cannot enter the final
/// last-SCRATCHES selection. Its shown items/history remain untouched.
fn retain_recent_shown(old: &mut ShownMap, recent: &mut Vec<EntryId>, entry: EntryId, shown: Shown) {
    recent.push(entry);
    if recent.len() > SCRATCHES {
        let expired = recent[recent.len() - SCRATCHES - 1];
        old.drop_scratch(&expired);
    }
    old.insert(entry, shown);
    // at most a window of showings open as it goes, but the scratch items it keeps: a showing of every entry anew
    // holds no more open than one of a few
    if recent.len() % shown_map::WINDOW == 0 {
        let keep: HashSet<EntryId> = recent.iter().rev().take(SCRATCHES).copied().collect();
        old.trim(shown_map::WINDOW, &keep);
    }
}

/// The work a budgeted show does for each entry of its budget (`show_items`), counted as the writes it judges and
/// `SHOW_ENTRY_WORK` for each entry it judges, one for each it looks at, and the writes it reads again into a scratch
/// item it dropped (`SCRATCHES`): a step of a catch-up judges about this many writes whatever the
/// entries hold, so that a step at a server's size takes as long as one at a phone's.
const SHOW_WORK: usize = 6;
/// The fewest writes of one entry a budgeted show judges in a step (`show_items`): an entry's writes past them wait for
/// the next step.
const SHOW_SLICE: usize = 16;
const SHOW_ENTRY_WORK: usize = 4;

/// Rebuild what device `d` shows of each entry whose writes, what it opened of them, its vault's lane or the cap groups
/// in force changed: first the cap groups, as the device counts the writes that say them (`State::read_groups`), as
/// every write through a share that names one is judged by them; then each entry's history, each write of its view
/// with the content of its body where the device opened it, in replay order, and the item of each line.
/// Shows device `d`'s items anew. With a `budget`, at most that many entries other than the cap groups' are shown
/// anew, those it left before first (`Store::showing`), and it keeps those it leaves now there, with whether they are to
/// be checked against all their writes and the bodies it opened of them (`Showing`): false while any are left. One
/// with none shows what changed since it last showed and leaves those it left before as they are, for the budgeted
/// ones to come (a write of the device's own in the middle of a catch-up waits for no whole showing), but where it
/// shows every entry. So the entries end shown as one showing shows them, once none is left.
fn show_items(d: SignerId, store: &mut Store, budget: Option<usize>) -> bool {
    let pending = store.showing.take().unwrap_or_default();
    let (reshow, mut opened) = (std::mem::take(&mut store.reshow), std::mem::take(&mut store.opened));
    for (e, ids) in pending.opened {
        opened.entry(e).or_default().extend(ids);
    }
    let waiting: HashSet<EntryId> = pending.rest.iter().copied().collect();
    let (st, r) = (&store.replay.state, &store.readings);
    let bodies = &StoreBodies { bodies: &store.bodies, with: Opener { signed: &store.signed, keys: &store.keys, st } };
    let mut old = std::mem::take(&mut store.shown);
    // a showing whose bytes didn't open is none: its entry is judged anew, as after a removal
    let reshow = reshow | !old.take_spoilt().is_empty();
    if reshow {
        old.retain(|e| st.entry(*e).is_some());
    }
    // each vault's lane as the device reads it off the vault's schema and lens entries (`State::lane_of`), its hash,
    // and what judges the writes of the vault's entries, made once one of them is shown anew
    let mut lanes: HashMap<VaultId, (Vec<&[u8]>, [u8; 32], OnceCell<Lane>)> = HashMap::new();
    let at = Perf::start();
    // of every vault, not of every entry's: a step costs what changed, not what the device holds
    for vt in st.vaults() {
        let blobs = lane_blobs(st, vt.id, r);
        #[cfg(not(avendb_no_replay_checks))]
        debug_assert!(blobs == st.lane_of(vt.id, r), "a lane read off its blobs differs from one read off every entry");
        let mut h = Hasher::new("lab lane");
        for b in &blobs {
            h.update(&BlobId::of(b).0);
        }
        lanes.insert(vt.id, (blobs, h.finalize(), OnceCell::new()));
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
            h.update(&w.edit.0).update(&[bodies.has(&w.edit) as u8]);
        }
        h.update(&lanes[&en.vault].1).update(groups);
        h.finalize()
    };
    // first the cap groups, as the device counts the writes that say them (`policy::State::read_groups`): the writes
    // of every cap group entry one after the other in the order they were accepted, each by the groups in force
    // before it, and where it counts and its vault writes it itself on its main line, what it says is in force past it
    let caps: Vec<&Entry> = st.entries().iter().filter(|en| st.is_cap_group(en, r)).collect();
    let mut writes: Vec<&Write> = caps.iter().flat_map(|en| st.entry_writes(en.id)).collect();
    writes.sort_by_key(|w| st.place(w.edit));
    // what judging them reads, but the groups they say: where it is what it judged them on last, and no removal came
    // since, it keeps what it judged, their entries shown and the groups in force (a step of a catch-up shows twice,
    // and judged the same groups again each time, building their items anew, `CapGroupsOnce.lean`)
    let mut h = Hasher::new("lab cap groups judged on");
    for en in &caps {
        h.update(&en.id.0).update(&lanes[&en.vault].1);
    }
    for w in &writes {
        h.update(&w.edit.0).update(&[bodies.has(&w.edit) as u8]);
    }
    let caps_print = h.finalize();
    let cap_groups: HashSet<EntryId> = caps.iter().map(|en| en.id).collect();
    let kept = !reshow && store.shown_caps == Some(caps_print) && caps.iter().all(|en| old.contains_key(&en.id));
    let (groups, judging) = if kept {
        let groups = r.groups.clone();
        #[cfg(not(avendb_no_replay_checks))]
        debug_assert!(groups == judge_caps(d, st, (r, bodies), &caps, &writes, &lane).0, "cap groups kept differ from those judged anew");
        (groups, HashMap::new())
    } else {
        store.perf.count("show: cap group writes judged", writes.len() as u64);
        judge_caps(d, st, (r, bodies), &caps, &writes, &lane)
    };
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
        && lanes_now
            .iter()
            .all(|(v, (h, _))| gained.contains_key(v) || store.shown_lanes.get(v).is_some_and(|w| w.0 == *h))
        && store.shown_groups == groups_print;
    // what changed since it last showed (the bodies it opened since of the entries it left before among them)
    let fresh: Vec<&Entry> = if grew {
        let changed = st.entries().iter().filter(|en| gained.contains_key(&en.vault)).map(|en| en.id);
        let opened_since = opened.keys().copied().filter(|e| !waiting.contains(e));
        // the entries of the new writes first, the newest first, as a live edit's during a long catch-up whose
        // backlog came just before it (its replay and reading a slice a step, `CatchUpBudget.lean`), then the rest
        // that moved
        let mut first: HashSet<EntryId> = HashSet::new();
        let mut es: Vec<EntryId> = all.iter().skip(n).rev().map(|w| w.entry).filter(|e| first.insert(*e)).collect();
        let mut more: Vec<EntryId> = opened_since.chain(changed).filter(|e| !first.contains(e)).collect();
        more.sort();
        more.dedup();
        es.extend(more);
        es.into_iter().filter_map(|e| st.entry(e)).collect()
    } else {
        st.entries().iter().collect()
    };
    // and those it left before, after them, where it has a budget to show them in
    let seen: HashSet<EntryId> = fresh.iter().map(|en| en.id).collect();
    let left: Vec<&Entry> =
        pending.rest.iter().filter(|e| !seen.contains(e)).filter_map(|e| st.entry(*e)).collect();
    let (todo, mut rest): (Vec<&Entry>, Vec<EntryId>) = match budget {
        Some(budget) => {
            let mut all_todo = fresh;
            all_todo.extend(left);
            let cut = all_todo.len().min(budget.max(1) * SHOW_WORK);
            let rest = all_todo[cut..].iter().map(|en| en.id).collect();
            all_todo.truncate(cut);
            (all_todo, rest)
        }
        None => (fresh, left.iter().map(|en| en.id).collect()),
    };
    store.shown_writes = (all.len(), all.last().map(|w| w.edit));
    store.shown_lanes = lanes_now;
    store.shown_groups = groups_print;
    store.shown_caps = Some(caps_print);
    let mut shown_now: HashSet<EntryId> = HashSet::new();
    // its replay is of every edit it holds: mid catch-up the replay lags, and a showing kept is taken only after
    let standing = store.replayed == store.log.edits().len();
    // a budget bounds the work too: the writes it judges, and a few for each entry it judges, past which it leaves
    // the rest of them for the next step
    let work = budget.map(|b| b.max(1) * SHOW_WORK);
    let mut spent = 0;
    // an entry it judged part of its writes of, to go on with first at the next step
    let mut part: Option<EntryId> = None;
    let ids_todo: Vec<EntryId> = todo.iter().map(|en| en.id).collect();
    for (k, en) in todo.into_iter().enumerate() {
        if work.is_some_and(|w| spent >= w) {
            let mut left = ids_todo[k..].to_vec();
            left.append(&mut rest);
            rest = left;
            break;
        }
        shown_now.insert(en.id);
        spent += 1;
        if cap_groups.contains(&en.id) {
            continue;
        }
        // one it left before is checked against all its writes as it was to be then
        let reshow = reshow || (pending.reshow && waiting.contains(&en.id) && pending.part != Some(en.id));
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
                #[cfg(not(avendb_no_replay_checks))]
                debug_assert!(same_shown_in(s, &judged_anew(d, st, (r, bodies), &groups, en, lane(en.vault)), Some(store)));
            }
        }
        let kept = old.tip(&en.id).filter(|t| *t == tip && !opened.contains_key(&en.id));
        let print = match kept {
            Some(_) if !reshow => continue,
            Some(_) => {
                let print = print(en, &groups_print);
                if old.print(&en.id) == Some(print) {
                    continue;
                }
                print
            }
            None => print(en, &groups_print),
        };
        if old.print(&en.id) == Some(print) {
            old.set_tip(&en.id, tip);
            continue;
        }
        // one its shelf kept whose print is this one, judged of the same writes, bodies, lane and cap groups: what
        // judging them anew makes (`SV1_open`), against its replay of every edit it holds alone
        if standing
            && !old.contains_key(&en.id)
            && let Some(c) = store.kept_shown.remove(&en.id).filter(|c| c.print == print)
        {
            let mut c = c;
            c.tip = tip;
            #[cfg(not(avendb_no_replay_checks))]
            debug_assert!(
                c.open().is_none_or(|s| same_shown_in(&s, &judged_anew(d, st, (r, bodies), &groups, en, lane(en.vault)), Some(store))),
                "a kept showing that opens as other than judging its entry anew"
            );
            store.perf.count("show: entries taken as kept", 1);
            old.insert_closed(en.id, c);
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
        let judging_at = Perf::start();
        // judged on without its scratch item, it builds that again of the writes it judged before
        let mut again = 0;
        let (mut j, from, items) = match old.remove(&en.id) {
            Some(s) if resumes(&s) => {
                let from = s.tip.writes;
                again = if s.after.scratch.is_none() { from } else { 0 };
                (Judging::resume(en, r, lane(en.vault), s.history, s.after), from, Some(s.items))
            }
            _ => (Judging::new(st, en, r, lane(en.vault)), 0, None),
        };
        store.perf.add("show: judging, set up", judging_at);
        // with a budget, at most what is left of it of an entry's writes, `SHOW_SLICE` at least: an entry of a thousand
        // writes is judged over several steps, each going on where the last left off (a step of four entries judged
        // 300 writes, 200-300 ms on an iPhone, 2026-10-28)
        let to = match work {
            Some(w) => writes.len().min(from + w.saturating_sub(spent).max(SHOW_SLICE)),
            None => writes.len(),
        };
        store.perf.count("show: writes judged", (to - from) as u64);
        store.perf.count("show: entries judged", 1);
        for w in &writes[from..to] {
            j.judge(d, st, (r, bodies), w, &groups);
        }
        spent += to - from + again + SHOW_ENTRY_WORK;
        store.perf.add("show: judging", judging_at);
        let materialize_at = Perf::start();
        if to < writes.len() {
            // shown as far as it judged, with a print no whole showing has, so that it is never taken as shown whole
            let tip = Tip { writes: to, last: Some(writes[to - 1].edit), ..tip };
            let mut h = Hasher::new("lab shown in part");
            h.update(&print).update(&(to as u64).to_le_bytes());
            let print = h.finalize();
            let s = j.shown_on(d, print, tip, items);
            store.perf.add("show: materialize", materialize_at);
            retain_recent_shown(&mut old, &mut recent, en.id, s);
            shown_now.remove(&en.id);
            part = Some(en.id);
            let mut left = ids_todo[k + 1..].to_vec();
            left.append(&mut rest);
            rest = left;
            break;
        }
        let s = j.shown_on(d, print, tip, items);
        store.perf.add("show: materialize", materialize_at);
        #[cfg(not(avendb_no_replay_checks))]
        debug_assert!(from == 0 || same_shown_in(&s, &judged_anew(d, st, (r, bodies), &groups, en, lane(en.vault)), Some(store)));
        retain_recent_shown(&mut old, &mut recent, en.id, s);
    }
    if let Some(e) = part {
        rest.insert(0, e);
    }
    // only the entries judged last keep their scratch items
    let mut keep: HashSet<EntryId> = recent.iter().rev().take(SCRATCHES).copied().collect();
    let room = SCRATCHES.saturating_sub(keep.len());
    let before: Vec<EntryId> = store.scratched.iter().filter(|e| !keep.contains(e)).take(room).copied().collect();
    keep.extend(before);
    // of those that held one: the ones kept before, and those judged now, the cap groups' among them
    let held: HashSet<EntryId> = store.scratched.iter().chain(&recent).chain(&cap_groups).copied().collect();
    for e in held.iter().filter(|e| !keep.contains(e)) {
        old.drop_scratch(e);
    }
    debug_assert!(held.iter().all(|e| !old.has_scratch(e) || keep.contains(e)), "a scratch item kept past SCRATCHES");
    let closed = old.trim(shown_map::WINDOW, &keep);
    store.perf.count("show: showings closed", closed as u64);
    store.scratched = keep;
    store.perf.add("show: entries", at);
    store.shown = old;
    store.readings.groups = groups;
    // the entries shown anew, for the upkeep to look at again (`UpkeepDue`)
    store.upkeep_due.entries.extend(shown_now.iter().copied());
    if rest.is_empty() {
        // what its shelf kept and it took not is of writes or bodies since: of no use again
        if standing {
            store.kept_shown = HashMap::new();
        }
        store.recontext();
        return true;
    }
    // what tells it what to show anew stays as it was for the entries left, until it shows them
    let left: HashSet<EntryId> = rest.iter().copied().collect();
    opened.retain(|e, _| left.contains(e));
    // the bodies opened of the entry it judged part of were there as it judged them, or are of writes it judges next
    if let Some(e) = part {
        opened.remove(&e);
    }
    let taken = store.log.edits().len();
    store.showing = Some(Showing { rest, reshow: reshow || pending.reshow, opened, taken, part });
    store.recontext();
    false
}

/// The cap groups as device `d` counts the writes that say them (`show_items`): the writes `writes` of the cap group
/// entries `caps`, in the order they were accepted, each judged by the groups in force before it, and where it counts and
/// its vault writes it itself on its main line, what it says in force past it; with the judging of each entry.
fn judge_caps<'a>(
    d: SignerId,
    st: &State,
    (r, bodies): (&Readings, &dyn BodyOf),
    caps: &[&Entry],
    writes: &[&Write],
    lane: &impl Fn(VaultId) -> &'a Lane,
) -> (Groups, HashMap<EntryId, Judging<'a>>) {
    let mut groups = Groups::default();
    let mut judging: HashMap<EntryId, Judging> = caps.iter().map(|en| (en.id, Judging::new(st, en, r, lane(en.vault)))).collect();
    for w in writes {
        let j = judging.get_mut(&w.entry).expect("a cap group entry");
        if j.judge(d, st, (r, bodies), w, &groups)
            && w.signer == j.vault
            && w.proposal == Proposal::Main
            && let Some(g) = r.defines.get(&w.edit)
        {
            groups.say(w.entry, j.vault, w.edit, g);
        }
    }
    (groups, judging)
}

/// The entries a showing with a budget left to show (`show_items`), in the order it would show them, with whether
/// they are to be checked against all their writes and the bodies it opened of them since they were last shown.
#[derive(Default)]
struct Showing {
    rest: Vec<EntryId>,
    reshow: bool,
    opened: HashMap<EntryId, Vec<EditId>>,
    /// How many edits it held when it left them: one taken since (a live page during a long catch-up) is replayed,
    /// read and its entry shown before them (`catch_up_step`).
    taken: usize,
    /// The entry it judged part of the writes of (`SHOW_SLICE`), judged anew where it was to be: it goes on from
    /// where it left off, though the others left are to be checked against all their writes.
    part: Option<EntryId>,
}

/// What changed since the upkeep last looked at every entry's keys and stewardship (`upkeep`), so that it looks at
/// those entries alone, not at each of a server's thousands every turn: the entries the edits it took since are of,
/// those it opened bodies or took keys of, and those shown anew, a move of one among them. Where anything but an
/// entry's changed since (an edit of a vault, a share, an audience or no log, a removal but a move, an edit let go, a
/// key of more than an entry, a selector opened, the cap groups or the lanes, an entry's base), or an entry changed
/// that is a cap group or holds a schema or a lens, it looks at every entry again. A debug build checks each entry it
/// leaves out calls for nothing.
#[derive(Default)]
struct UpkeepDue {
    /// The entries shown anew, and those a showing left to show when it last looked.
    entries: HashSet<EntryId>,
    /// The entries a sliced upkeep left for its next look (`UPKEEP_SLICE`): due, but unchanged for being left, so a
    /// lane or cap group among them is no reason to look at every entry again (2026-10-27: an iPhone's catch-up looked
    /// at the same first slice of every entry some 40 times a second, a lane among the rest each time, and never ended;
    /// `UpkeepSlices.lean`: it moves on and ends).
    unlooked: HashSet<EntryId>,
    /// When it last looked: the log's head, the keys' revision, the selectors it read, the cap groups' and the lanes'
    /// hashes.
    then: Option<(crate::log_head::Head, Arc<()>, usize, [u8; 32], Vec<(VaultId, [u8; 32])>)>,
}

impl UpkeepDue {
    /// The entries its upkeep is to look at, or `None` for every one.
    fn scope(&self, store: &Store) -> Option<HashSet<EntryId>> {
        let (head, keys, slices, groups, lanes) = self.then.as_ref()?;
        let log = &store.log;
        let len = &(head.at as usize);
        if !log.of_log(*head)
            || !Arc::ptr_eq(keys, &store.keys.scoped)
            || store.slices.len() != *slices
            || store.shown_groups != *groups
            || *lanes != lanes_of(&store.shown_lanes)
            || !store.bases.is_empty()
        {
            return None;
        }
        let mut due = self.entries.clone();
        due.extend(store.keys.entries_keyed.iter().copied());
        // a move is a removal of its entry's log alone: it takes its entry to another audience, which only that
        // entry's keys and writes read (`V3_move_steps_on`); an audience key it brings back into use is a family's,
        // which the upkeep makes whatever its scope
        let moving = |e: &Edit| matches!(e.action, Action::Mark { caps: Some(_), .. });
        for (edit, place) in log.edits()[*len..].iter().zip(&log.logs()[*len..]) {
            match place {
                Some(crate::sync::LogId::Entry(e)) if !edit.is_removal() || moving(edit) => {
                    due.insert(*e);
                }
                _ => return None,
            }
        }
        let (st, r) = (&store.replay.state, &store.readings);
        let global = |e: &EntryId| {
            st.entry(*e).is_some_and(|en| {
                st.is_cap_group(en, r) || r.headers.get(&en.creation).is_some_and(|h| h.ty.of_lane() || h.ty.is_cap_group())
            })
        };
        if due.iter().any(global) {
            return None;
        }
        due.extend(self.unlooked.iter().copied());
        Some(due)
    }

    /// It looked, at what `log`, `keys`, `slices`, `groups` and `lanes` say now; the entries `waiting` to be shown
    /// it looks at again once they are, and those `unlooked` it left for its next look.
    #[allow(clippy::too_many_arguments)]
    fn looked(
        &mut self,
        log: &Log,
        keys: &Arc<()>,
        slices: usize,
        groups: [u8; 32],
        lanes: &BTreeMap<VaultId, ([u8; 32], BTreeSet<BlobId>)>,
        waiting: HashSet<EntryId>,
        unlooked: HashSet<EntryId>,
    ) {
        self.entries = waiting;
        self.unlooked = unlooked;
        self.then = Some((log.head(), keys.clone(), slices, groups, lanes_of(lanes)));
    }
}

/// Each vault's lane's hash, as a showing last showed it (`Store::shown_lanes`).
fn lanes_of(lanes: &BTreeMap<VaultId, ([u8; 32], BTreeSet<BlobId>)>) -> Vec<(VaultId, [u8; 32])> {
    lanes.iter().map(|(v, (h, _))| (*v, *h)).collect()
}

/// Entry `en`'s writes judged anew from its first, on device `d`: what judging on from where it left off must make.
fn judged_anew(
    d: SignerId,
    st: &State,
    rb: (&Readings, &dyn BodyOf),
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
fn same_shown_in(a: &Shown, b: &Shown, store: Option<&Store>) -> bool {
    a.history.changes() == b.history.changes()
        && a.items_in(store).keys().eq(b.items_in(store).keys())
        && a.items_in(store).iter().zip(b.items_in(store)).all(|((_, x), (_, y))| x.record() == y.record())
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
        (r, bodies): (&Readings, &dyn BodyOf),
        w: &Write,
        groups: &Groups,
    ) -> bool {
        let none = TagDelta::default();
        let Judging { vault, of_lane, lane, history, scratch, attrs, mine, asked, .. } = self;
        let body = bodies.body(&w.edit);
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
            let marked = r.touches.as_deref().map(|ts| mine.mark(w.signer, ts));
            history.admit(w, r, || {
                st.lets(w, proof, marked.as_deref(), asks, at)
                    .then_some(()).ok_or(Refusal::NotAllowed)
            }).is_ok()
        });
        let adds = read.as_ref().map(|r| r.adds.clone()).unwrap_or_default();
        mine.note(w, &adds, counted);
        // what it touches and asks for, as a merge that brings it in reads it
        let touches = read.and_then(|r| r.touches).map(|ts| ts.into_iter().chain(rules::asked(asks)).collect());
        let change = Change { write: w.clone(), body: body.map(|b| b.content.clone()), fits, touches, counted, adds };
        history.push(change).expect("the view's writes are causally closed");
        // its tags count from now on where it acts for the vault
        if !w.first
            && w.signer == *vault
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
                // Judgment already materialized this exact history in many linear entries.
                // Reuse only after counted-history selection; mismatches rebuild canonically.
                None => scratch.as_ref().and_then(|s| s.shown_for(&changes, d, l))
                    .or_else(|| crate::history::build_from(&changes, d, l)),
            };
            if let Some(item) = item {
                items.insert(l, item);
                imported.insert(l, changes.iter().map(|c| c.write.edit).collect());
            }
        }
        Shown { history, items, print, tip, after: After { scratch, attrs, mine, imported, asked } }
    }
}

/// What `was`, the replay of the edits held, says once `edit` steps on it, where that is the replay of them and `edit`: a
/// write device `on` authored, deeper than every edit held (the deepest is `deepest`), so it sorts last, and no removal, so it cuts nothing before it
/// and no removal's standing turns on it (`policy::replay`). None for any other edit, or one `was` refuses.
fn stepped_on(was: &State, deepest: Option<u64>, on: SignerId, edit: &Edit) -> Option<State> {
    let last = deepest.is_none_or(|d| d < edit.depth);
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

#[cfg(test)]
mod range_payload_tests {
    use super::*;
    use crate::cast::{world,todos_on};
    use crate::id::ShareId;
    use crate::policy::{Creation,Proposal,Revoking};
    use crate::sealed::FileRoot;
    use crate::sign::{DeviceKey,PQ_SIGNATURE_BYTES,PqKey,Signature,SignerKeys};

    /// A frozen edit's part of an SLH-DSA device as the wire still brings it (`legacy`): its keys and its old signature,
    /// which nothing reads.
    struct Slh(SignerKeys);
    impl Slh {
        fn id(&self)->SignerId{self.0.id()}
        fn sign(&self,edit:EditId)->Signature{
            crate::legacy::admit([edit]);
            Signature{keys:self.0,webauthn:None,enclave:None,pq:vec![7;PQ_SIGNATURE_BYTES]}
        }
    }
    enum Either{Ml(DeviceKey),Slh(Slh)}
    impl Either{
        fn id(&self)->SignerId{match self{Either::Ml(k)=>k.id(),Either::Slh(k)=>k.id()}}
        fn sign(&self,e:EditId)->Signature{match self{Either::Ml(k)=>k.sign(e),Either::Slh(k)=>k.sign(e)}}
    }

    #[test]
    fn range_write_size_bound_covers_every_nested_wire_field() {
        let slh=Slh(SignerKeys::Device{ed25519:[177;32],pq:PqKey::Slh([178;32])});
        for key in [Either::Ml(DeviceKey::from_secret([177;32])),Either::Slh(slh)] {
            for n in [0u64,1,129] {
                let vault=VaultId::from_u64(1);let nonce=[19;32];
                let action=Action::Write {
                    vault,entry:EntryId::of(vault,key.id(),&nonce),actor:vault,
                    stay:(n>0).then_some(EditId::from_u64(2)),epoch:u64::MAX,
                    deps:(0..n).map(EditId::from_u64).collect(),
                    proposal:if n==0{Proposal::Main}else if n==1{Proposal::New}else{Proposal::On(EditId::from_u64(3))},
                    via:(0..n).map(VaultId::from_u64).collect(),
                    create:Some(Creation{audience:(0..n).map(ShareId::from_u64).collect(),nonce}),
                    files:(0..n).map(|i|FileRoot{hash:EditId::from_u64(i).0,size:u64::MAX}).collect(),
                    body:vec![0xAB;n as usize*129].into(),
                };
                let edit=Edit{parents:(0..n).map(EditId::from_u64).collect(),depth:u64::MAX,author:key.id(),cosigners:vec![],action};
                let signed=Signed{sigs:vec![key.sign(edit.id())],edit};
                assert!(signed.verify().is_ok(),"the edge object has valid legacy signatures and creation ID");
                let wire=signed.to_wire();
                assert_eq!(Signed::from_wire(&wire).unwrap(),signed);
                assert!(range_write_bound(&signed).unwrap()>=wire.len());
                let mut without=signed.clone();if let Action::Write{create,..}=&mut without.edit.action{*create=None;}
                assert!(range_write_bound(&without).unwrap()>=without.to_wire().len());
                let mut unsupported=signed.clone();unsupported.edit.cosigners.push(SignerId::from_u64(99));
                assert!(range_write_bound(&unsupported).is_none());
                unsupported=signed.clone();unsupported.sigs.push(signed.sigs[0].clone());
                assert!(range_write_bound(&unsupported).is_none());
            }
        }
    }

    #[test]
    fn inventory_and_selection_match_ordinary_scope_and_fence_revocation() {
        let mut w=world();let todos=todos_on(&mut w);w.lab.sync_all(0);
        let from=w.mac_a;let to=w.mac_c;
        let scope=ReplyScope::Logs([LogId::Entry(todos.door),LogId::Entry(todos.seeds)].into());
        let mut request=Request::default();
        request.ask.haves=[(LogId::Entry(todos.door),vec![]),(LogId::Entry(todos.seeds),vec![])].into();
        let (head,ids)=w.lab.range_inventory(from,to,from,&request,&scope,65536,usize::MAX).unwrap();
        assert!(!ids.is_empty());
        let expected:BTreeSet<_>=w.lab.reply_in(from,to,&request,usize::MAX,&scope).0.into_iter()
            .filter(|s|s.edit.author==from && range_write_bound(s).is_some()).map(|s|s.edit.id()).collect();
        assert_eq!(ids.iter().copied().collect::<BTreeSet<_>>(),expected);
        let wanted:BTreeSet<_>=ids.iter().copied().collect();
        let (selected,more)=w.lab.range_select(from,to,from,&request,&scope,&head,&wanted,256,usize::MAX).unwrap();
        assert!(!more);assert_eq!(selected.iter().map(|s|s.edit.id()).collect::<BTreeSet<_>>(),expected);
        let narrow=ReplyScope::Logs([LogId::Entry(todos.seeds)].into());
        assert!(w.lab.range_select(from,to,from,&request,&narrow,&head,&wanted,256,usize::MAX).is_none(),"narrowed scope rejects even with the same head");
        assert!(w.lab.range_select(from,w.stranger,from,&request,&scope,&head,&wanted,256,usize::MAX).is_none(),"another peer cannot reuse its authorization plan");
        assert!(w.lab.range_select(from,to,from,&request,&scope,&head,&wanted,256,1).is_none(),"size eligibility never permits an oversized clone");
        assert!(w.lab.range_inventory(from,to,from,&request,&scope,0,usize::MAX).is_none());
        let snapshot=w.lab.backup(from);
        w.lab.submit(from,&[from],Action::Revoke(Revoking::Grant{share:todos.carol_read,actor:w.alice,keep:vec![],via:vec![]})).unwrap();
        assert!(w.lab.range_select(from,to,from,&request,&scope,&head,&wanted,256,usize::MAX).is_none(),"revocation fences the captured set");
        let (_,now)=w.lab.range_inventory(from,to,from,&request,&scope,65536,usize::MAX).unwrap();
        assert!(now.is_empty(),"current permission also removes the entry from root/count/leaf disclosure");
        w.lab.restore_backup(from,&snapshot);
        assert_eq!(w.lab.log(from).head(),head,"restoring the same edits gives the same head");
        let (again,_)=w.lab.range_select(from,to,from,&request,&scope,&head,&wanted,256,usize::MAX).expect("the same edits, judged anew");
        assert_eq!(again.iter().map(|s|s.edit.id()).collect::<BTreeSet<_>>(),expected,"what it sends is worked out of the edits it holds, never of an earlier capture");
    }
}

#[cfg(test)]
#[path = "receive_empty_tests.rs"]
mod receive_empty_tests;

#[cfg(test)]
#[path = "request_basis_tests.rs"]
mod request_basis_tests;

/// Preserve receipt order and first occurrence, exactly as the per-entry scan does.
/// Keeping iteration generic lets the regression count actual history visits.
fn grouped_file_roots<'a>(
    entries: impl IntoIterator<Item = EntryId>,
    edits: impl IntoIterator<Item = &'a Edit>,
) -> BTreeMap<EntryId, Vec<FileRoot>> {
    let mut groups: BTreeMap<_, (BTreeSet<FileRoot>, Vec<FileRoot>)> = entries.into_iter()
        .map(|entry| (entry, (BTreeSet::new(), vec![]))).collect();
    if !groups.is_empty() {
        for edit in edits {
            let Some((seen, roots)) = edit.entry().and_then(|entry| groups.get_mut(&entry)) else { continue };
            for &root in edit.files() {
                if seen.insert(root) { roots.push(root); }
            }
        }
    }
    groups.into_iter().map(|(entry, (_, roots))| (entry, roots)).collect()
}

#[cfg(test)]
#[path = "entry_files_batch_tests.rs"]
mod entry_files_batch_tests;
#[cfg(test)]
#[path = "latest_replay_tests.rs"]
mod latest_replay_tests;

#[cfg(test)]
#[path = "upkeep_family_tests.rs"]
mod upkeep_family_tests;

#[cfg(test)]
#[path = "based_parity_tests.rs"]
mod based_parity_tests;

#[cfg(test)]
#[path = "read_left_tests.rs"]
mod read_left_tests;

#[cfg(test)]
#[path = "prepared_receive_tests.rs"]
mod prepared_receive_tests;

#[cfg(test)]
#[path = "peer_receipt_tests.rs"]
mod peer_receipt_tests;
