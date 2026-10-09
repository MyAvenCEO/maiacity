//! The rules every peer applies, edit for edit the Lean model (`avendb/spec/AvenDB/State.lean` and `Step.lean`): who
//! acts for which vault, who governs it, which caps a vault holds and which cells they reach, which edits are
//! accepted, the key schedule, and how a removal cuts what it hadn't seen.
//!
//! Two layers, as in the model. The operational one is everything here: it reads nothing a relay can't see (no
//! selector, no type, no tag), so the server applies exactly these rules (T25). An entry sits in a cell, the caps that
//! select it, named on the wire by the hash of its vault and those caps (`CellId::of`); a cap reaches an entry when it
//! is in the entry's cell or is wide. The semantic layer, what a cap's selector picks and what an entry's header and
//! tags say, is known only to an entry's readers and the vault's own devices, the stewards, who keep every entry in
//! the cell its meaning asks for by moving it (`Meaning`, T23).
//!
//! Edits reach this module already verified: an edit's author and cosigners are the signers whose signatures checked
//! out (`sign::Signed::verify`). Where the core differs from the model: what an edit creates (a vault, a cap) is named
//! by that edit's id, where the model picks numbers; a cell is named by its id, and the caps of every cell the state
//! has met are kept beside (`cell_caps`); an entry's stays are kept oldest first, where the model puts the current one
//! first; a refused edit says why, where the model only says no; and edits carry what the model leaves out, which no
//! rule reads: the keys signers have keys sealed to, the boxes of a `Keys` edit, a cap's sealed selector, and a write's
//! ciphertext, whose plaintext holds the entry's header and tags.
//!
//! The key schedule is the model's too: each family's epoch, every seal (which key may open which) and every published
//! key. Real keys follow it: a `Keys` edit carries real boxes, and a peer accepts it only if each box is a seal of the
//! schedule, so what a device can really open is never more than what the schedule lets it (T5, T6, T24).
//!
//! A replay steps one state in place (`State::step_mut`), so a write costs what it adds, not a copy of everything
//! before it. After an edit that removes nothing, `settle` touches only what the edit touched: the family it adds or
//! grows, the cell an entry goes to, the write it links. That is the model's `settle` because of T6: in every reachable
//! state a holder opens the current key of a family in use only while entitled to it, and outside removals every
//! entitlement only grows, so the only key that goes stale is a cell's that comes back into use. A removal runs the
//! model's `settle` in full (`stale_keys`).

use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::sync::Arc;

use crate::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};
use crate::keys::{KeyBox, KeyFam, KeyId, KeyName, PublicKey, Seal};
use crate::slice::{Attrs, Header, Selector, TagDelta};

/// A vault is an identity, like a smart account. A human vault is owned by signers, its person's passkeys, and its
/// devices act for it. A coop vault is owned by human and coop vaults. An aven vault, an agent such as the relay
/// server, is owned by human and coop vaults too, and its devices (the servers it runs on) act for it but never govern
/// it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Human,
    Coop,
    Aven,
}

impl Kind {
    /// Human and aven vaults have devices, coops don't: a coop acts only through its owners.
    pub fn has_devices(self) -> bool {
        self != Kind::Coop
    }
}

/// An owner of a vault: a signer (of a human vault) or a vault (of a coop or an aven vault).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Principal {
    Signer(SignerId),
    Vault(VaultId),
}

/// What a cap allows; each role includes the ones before it. Relay stores and forwards the ciphertext of the entries a
/// cap reaches and gets no key: it is the server's role. Owner also issues caps on its slice and is governance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Role {
    Relay,
    Read,
    Write,
    Owner,
}

impl Role {
    pub fn allows(self, need: Role) -> bool {
        need <= self
    }
}

/// Whom a cap names: a vault, never a signer (T4), or everyone (read only, T8). The type allows a signer only so that
/// a peer can receive such a cap and refuse it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Grantee {
    Principal(Principal),
    Public,
}

/// A cap: `grantee` holds `role` over the entries of vault `over` that its selector picks, and that every cap it rests
/// on picks too (T22). Its id is the id of the edit that issued it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Cap {
    pub over: VaultId,
    pub grantee: Grantee,
    pub role: Role,
    /// It selects the whole vault, in the clear, so a peer that reads no selector knows it reaches every cell.
    pub wide: bool,
    /// Its selector, and the tags its grantee may ask the vault's stewards to add or remove, sealed to `over`'s vault
    /// key and the grantee's (in the clear for Public). No rule here reads it: its readers do (`Readings`).
    pub select: Vec<u8>,
    /// The owner cap its issuer relied on; `None` when the vault itself issued it.
    pub parent: Option<CapId>,
    pub issuer: VaultId,
    /// Keeps two caps that say the same apart.
    pub nonce: u64,
}

/// The line of an entry's history a write extends (`Proposals.lean`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Proposal {
    #[default]
    Main,
    /// A new proposal, which this write starts: its id names the proposal, its `deps` are the version the proposal
    /// starts from, and its body holds the proposal's name, encrypted.
    New,
    /// The proposal that write started.
    On(EditId),
}

/// A line of an entry's history: `None` is the main line, `Some(b)` the proposal write `b` started.
pub type Line = Option<EditId>;

/// Every change is one of these, signed. Governance (owners, threshold, devices, the root, owner caps) needs the
/// vault's approval: its root, or its threshold of owners; everything else needs one device acting for the vault.
/// Every removal names the edits it had seen and keeps (`keep`); what it hadn't seen and relied on what it takes away
/// is cut (`view`). An edit that acts for a vault (issues or revokes a cap, writes, moves, publishes) names the owners
/// `via` its author acts through (`State::acts_via`): none when its author is a member of the vault, else from an owner
/// of the vault down to the vault its author is a member of, as a device of Bob's human vault writes for Bob's coop
/// through `[bob]`.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Action {
    /// A new vault; its id is this edit's id. Every first owner signs, and so does the root, the passkey of a human
    /// vault, if it names one. `seal_to` brings, for signer owners, the key each has keys sealed to (a passkey's
    /// from its PRF output), where it has one.
    Genesis {
        kind: Kind,
        owners: Vec<Principal>,
        threshold: u32,
        root: Option<SignerId>,
        nonce: u64,
        seal_to: Vec<(SignerId, PublicKey)>,
    },
    /// The newcomer signs too, and a signer brings the key it has keys sealed to.
    AddOwner { vault: VaultId, owner: Principal, seal_to: Option<PublicKey> },
    /// By the vault's approval, or an owner leaving on its own.
    RemoveOwner { vault: VaultId, owner: Principal, keep: Vec<EditId> },
    SetThreshold { vault: VaultId, threshold: u32 },
    /// A device of a human vault (a phone, a browser) or of an aven vault (a server); the device signs too, and
    /// brings the key it has keys sealed to.
    AddDevice { vault: VaultId, device: SignerId, seal_to: Option<PublicKey> },
    /// By the vault's approval, or the device leaving on its own.
    RemoveDevice { vault: VaultId, device: SignerId, keep: Vec<EditId> },
    /// The root hands itself on to a new passkey, which signs too, or steps down (`None`).
    SetRoot { vault: VaultId, root: Option<SignerId>, keep: Vec<EditId> },
    /// A cap, issued by its issuer through the owners `via`; its id is this edit's id.
    Cap(Cap, Vec<VaultId>),
    /// Ends `cap` and every cap resting on it.
    Revoke { cap: CapId, actor: VaultId, keep: Vec<EditId>, via: Vec<VaultId> },
    /// An encrypted edit of entry `entry` of vault `vault`, on the line `proposal` of its history, under the key of its
    /// stay `stay` at generation `generation` of that stay's cell. `deps` are the entry's writes it builds on (its Loro
    /// frontier): a write that starts a proposal builds on the version the proposal starts from, and a merge also on
    /// the heads of the line it brings in. A write that creates its entry names the cell it goes in (`create`, its caps
    /// in canonical order), and its stay is the one its creation begins (`None`). Its `body` is the update, the
    /// header of a new entry and the tags it adds and removes, encrypted: the tags count only when it acts for the
    /// vault, except that a new entry's added tags are its first tags.
    Write {
        vault: VaultId,
        entry: EntryId,
        actor: VaultId,
        stay: Option<EditId>,
        generation: u64,
        deps: Vec<EditId>,
        proposal: Proposal,
        via: Vec<VaultId>,
        create: Option<Vec<CapId>>,
        body: Vec<u8>,
    },
    /// A steward, acting for vault `vault`, moves its entry `entry` to the cell of the caps `to` (canonical order),
    /// keeping the writes it had seen.
    Move { vault: VaultId, entry: EntryId, to: Vec<CapId>, keep: Vec<EditId>, via: Vec<VaultId> },
    /// The real boxes of one key of the schedule, `name`: its `id`, its `public` half for those who seal to it without
    /// holding it, the key sealed or wrapped to each recipient, and for a public family the key itself, in the
    /// `clear`. The schedule already says who may open what, so this changes nothing in it: a peer accepts it only
    /// from a signer that may open the key, and only if every box goes where the schedule seals the key.
    Keys { name: KeyName, id: KeyId, public: Option<PublicKey>, boxes: Vec<KeyBox>, clear: Option<[u8; 32]> },
    /// A schema or a lens, published into the vault's schema lane by the vault or a vault holding a wide owner cap over
    /// it (T17): a blob that holds no data, named by its hash (`BlobId::of`).
    Publish { vault: VaultId, actor: VaultId, via: Vec<VaultId>, blob: Vec<u8> },
    /// A device vouches for its own accepted writes of one entry, named in `covers`, with both halves of its signature,
    /// where the writes carry only the classical half (`sign`). It changes nothing; a peer that no longer trusts the
    /// curves counts only the writes a checkpoint covers (`checkpointed`).
    Checkpoint { entry: EntryId, covers: Vec<EditId> },
}

impl Action {
    /// The edits a removal had seen and keeps, for removals.
    pub fn keep(&self) -> Option<&[EditId]> {
        match self {
            Action::RemoveOwner { keep, .. }
            | Action::RemoveDevice { keep, .. }
            | Action::SetRoot { keep, .. }
            | Action::Revoke { keep, .. }
            | Action::Move { keep, .. } => Some(keep),
            _ => None,
        }
    }

    fn keep_mut(&mut self) -> Option<&mut Vec<EditId>> {
        match self {
            Action::RemoveOwner { keep, .. }
            | Action::RemoveDevice { keep, .. }
            | Action::SetRoot { keep, .. }
            | Action::Revoke { keep, .. }
            | Action::Move { keep, .. } => Some(keep),
            _ => None,
        }
    }

    /// The owners an act for a vault goes through, for the edits that act for one.
    pub fn via(&self) -> Option<&[VaultId]> {
        match self {
            Action::Cap(_, via)
            | Action::Revoke { via, .. }
            | Action::Write { via, .. }
            | Action::Move { via, .. }
            | Action::Publish { via, .. } => Some(via),
            _ => None,
        }
    }

    fn via_mut(&mut self) -> Option<&mut Vec<VaultId>> {
        match self {
            Action::Cap(_, via)
            | Action::Revoke { via, .. }
            | Action::Write { via, .. }
            | Action::Move { via, .. }
            | Action::Publish { via, .. } => Some(via),
            _ => None,
        }
    }
}

/// A verified edit: what it does, who signed it, and the edits of its own log it builds on.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Edit {
    /// The frontier of its own log (`sync::LogId`) as its device held it: what it builds on there. An edit that starts
    /// a log, a genesis or a cap, builds on nothing.
    pub parents: Vec<EditId>,
    /// Causal depth: one more than the deepest edit its device held when it made it, in any log, 0 for the first. It
    /// only orders edits: whatever a device had seen sorts before what it makes next. It travels with the edit because
    /// a peer often holds only part of an edit's past (a vault's log without the edits around it), and every peer must
    /// still order the edit the same way.
    pub depth: u64,
    pub author: SignerId,
    pub cosigners: Vec<SignerId>,
    pub action: Action,
}

impl Edit {
    /// The SHA-3 hash (`hash`) of the edit's canonical encoding (`encode`): everything the edit says, its signers
    /// included. Each signer signs this id.
    pub fn id(&self) -> EditId {
        EditId(crate::encode::edit_id(self))
    }

    /// Everyone who signed: the author first.
    pub fn sigs(&self) -> impl Iterator<Item = SignerId> + '_ {
        std::iter::once(self.author).chain(self.cosigners.iter().copied())
    }

    /// The vault an edit acts for: a cap's issuer, a revoker, a writer, a mover (the vault itself), a publisher.
    pub fn actor(&self) -> Option<VaultId> {
        match &self.action {
            Action::Cap(c, _) => Some(c.issuer),
            Action::Revoke { actor, .. } | Action::Write { actor, .. } | Action::Publish { actor, .. } => Some(*actor),
            Action::Move { vault, .. } => Some(*vault),
            _ => None,
        }
    }

    /// The entry a write or a move changes, or a checkpoint vouches for.
    pub fn entry(&self) -> Option<EntryId> {
        match self.action {
            Action::Write { entry, .. } | Action::Move { entry, .. } | Action::Checkpoint { entry, .. } => Some(entry),
            _ => None,
        }
    }

    /// The McEliece public keys the edit names, which travel beside it as blobs: the keys signers bring to have keys
    /// sealed to them, and the keys a `Keys` edit announces.
    pub fn blobs(&self) -> Vec<BlobId> {
        match &self.action {
            Action::Genesis { seal_to, .. } => seal_to.iter().map(|(_, k)| k.mceliece).collect(),
            Action::AddOwner { seal_to, .. } | Action::AddDevice { seal_to, .. } => {
                seal_to.iter().map(|k| k.mceliece).collect()
            }
            Action::Keys { public, .. } => public.iter().map(|k| k.mceliece).collect(),
            _ => vec![],
        }
    }

    pub fn is_removal(&self) -> bool {
        self.action.keep().is_some()
    }

    /// Removals sort before anything else at the same depth.
    fn rank(&self) -> u8 {
        if self.is_removal() { 0 } else { 1 }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub id: VaultId,
    pub kind: Kind,
    pub owners: Vec<Principal>,
    pub threshold: u32,
    /// Device signers act for a human or an aven vault but don't govern it: a person's phones and browsers, the
    /// servers an aven vault runs on.
    pub devices: Vec<SignerId>,
    /// A human vault's root: its passkey, named at genesis. It approves anything for its vault on its own, wins every
    /// clash with the other owners, and only it hands the root on.
    pub root: Option<SignerId>,
}

/// A cap as issued, with what never changes about it worked out once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Issued {
    pub id: CapId,
    pub cap: Cap,
    /// The caps it rests on, from its root cap down to itself (`chain`).
    pub chain: Arc<[CapId]>,
    /// Its intake cell: the caps of its chain that aren't wide, in canonical order. A vault that creates an entry
    /// through it puts it there, where only those caps' grantees, the wide caps and the stewards read it, until a
    /// steward moves it to its semantic cell.
    pub intake: Arc<[CapId]>,
}

/// An entry of a vault: a note, a todo, a profile.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: EntryId,
    pub vault: VaultId,
    /// Its stays, the first first: the move that put it in a cell (`None` for its creation), and that cell.
    pub stays: Vec<(Option<EditId>, CellId)>,
    /// The vault its creation acted for, and the creation's edit, whose header says the rest of what never changes
    /// about it.
    pub creator: VaultId,
    pub creation: EditId,
    /// The caps its creator could have created it through: those over its vault that the creator held with write or
    /// more, live, whose intake cell is the one it was created in. Its creation was let in if one of them selects it
    /// (`Meaning::admitted`).
    pub intake: Vec<CapId>,
    /// The writes that acted for its vault after its creation, in the order they were accepted, and those a removal
    /// dropped since too: the tags they add and remove count (`Meaning::attrs`), as in the model.
    pub retags: Vec<EditId>,
}

impl Entry {
    /// The cell it is in now.
    pub fn cell(&self) -> CellId {
        self.stays.last().expect("an entry is created in a cell").1
    }

    /// The stay it is in now.
    pub fn stay(&self) -> Option<EditId> {
        self.stays.last().expect("an entry is created in a cell").0
    }

    /// The cell of one of its stays.
    pub fn stay_cell(&self, s: Option<EditId>) -> Option<CellId> {
        self.stays.iter().find(|(x, _)| *x == s).map(|(_, x)| *x)
    }
}

/// An accepted write: one encrypted edit of one entry, on one line of its history, under the key of one of the entry's
/// stays at one generation of its cell. Its author, a device, acts for `actor` through the owners `via`
/// (`State::acts_via`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Write {
    pub edit: EditId,
    pub author: SignerId,
    pub actor: VaultId,
    pub entry: EntryId,
    pub stay: Option<EditId>,
    pub generation: u64,
    /// The writes of the same entry it builds on.
    pub deps: Vec<EditId>,
    pub proposal: Proposal,
    pub via: Vec<VaultId>,
    /// It created its entry.
    pub first: bool,
    /// The cell its entry was in when it was accepted, where a removal judges it (`State::authorized`).
    pub cell: CellId,
}

impl AsRef<Write> for Write {
    fn as_ref(&self) -> &Write {
        self
    }
}

impl Write {
    /// The line it extends.
    pub fn line(&self) -> Line {
        match self.proposal {
            Proposal::Main => None,
            Proposal::New => Some(self.edit),
            Proposal::On(b) => Some(b),
        }
    }

    /// The key it is encrypted under: its entry's in its stay, at its generation.
    pub fn key(&self) -> KeyName {
        KeyName::Entry(self.entry, self.stay, self.generation)
    }
}

/// Why a peer refused an edit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// A signature doesn't verify, or covers other bytes (checked before any rule).
    BadSignature,
    /// Already accepted.
    Duplicate,
    UnknownVault,
    UnknownCap,
    UnknownEntry,
    /// A genesis names no owner, or one owner twice.
    BadOwners,
    /// The owner or device is already there.
    AlreadyMember,
    /// The owner or device to remove isn't there.
    NotMember,
    /// A new owner, device or root, or a first owner at genesis, didn't sign.
    NoConsent,
    /// The vault's root didn't sign, and too few owners approved a governance change.
    BelowThreshold,
    /// The threshold would be 0 or more than the number of owners.
    BadThreshold,
    /// A human vault's owners are signers; a coop's and an aven vault's owners are human or coop vaults.
    WrongOwnerKind,
    /// A vault keeps at least one owner.
    LastOwner,
    /// The vault would own itself, directly or through other vaults (T3).
    Cycle,
    /// Only a human vault has a root.
    NotHuman,
    /// A coop has no devices: it acts only through its owners.
    NoDevices,
    /// Only a vault's root hands the root on.
    NotRoot,
    /// The edit's author doesn't act for the vault it claims to act for through the owners it names.
    NotActing,
    /// The vault holds no cap that allows this: no live cap with the role it needs that reaches the entry, no cap whose
    /// intake is the cell it creates in, no right to revoke the cap, no wide owner cap over the vault's lane.
    NoCap,
    /// Caps name vaults, never signers (T4).
    CapToSigner,
    /// A cap never names the vault it is over: that vault holds every right over itself already.
    CapToItself,
    /// Public only ever gets read (T8).
    PublicBeyondRead,
    /// The parent cap isn't a live owner cap over the same vault held by the issuer, or a wide cap rests on one that
    /// isn't, or a root cap is issued by another vault than the one it is over.
    BadParent,
    /// The cap was revoked already.
    Revoked,
    /// An entry id is created once: this one exists, or existed and fell.
    Reborn,
    /// A write that creates its entry names no stay, builds on nothing and is on the main line.
    NotFirst,
    /// The entry is another vault's.
    WrongVault,
    /// A cell's caps aren't in canonical order, or one of them isn't a cap over the vault, or is wide.
    BadCell,
    /// A move to the cell its entry is in already.
    SameCell,
    /// A write under a stay its entry never had.
    UnknownStay,
    /// A write or a key under an epoch that doesn't exist yet.
    FutureEpoch,
    /// A write builds on a write its entry doesn't have (T14).
    UnknownDep,
    /// A write on a proposal builds on neither the write that started it nor another write on it, or names a proposal
    /// its entry doesn't have.
    NotOnProposal,
    /// A key of a family that doesn't exist, of an entry that doesn't, or of a stay it never had.
    UnknownKey,
    /// The signer boxes a key it may not open.
    NotEntitled,
    /// A box goes where the schedule doesn't seal the key.
    Unsealed,
    /// A key in the clear of a family that isn't public.
    NotPublic,
    /// The blob is in the vault's lane already.
    AlreadyPublished,
    /// A checkpoint covers nothing, or something other than its own author's accepted writes of its entry.
    NotOwnWrite,
    /// Not a rule of the edits but of a device: a signer's key isn't at hand, as the device is locked or the key is
    /// lost, so nothing is signed.
    Locked,
    /// Not a rule of the edits but of an app: it opened the item read-only, as no lens it holds reaches every schema
    /// the item was written under (`lens::Lane::view`), so it may not edit it.
    ReadOnly,
    /// Not a rule of the edits but of an app: its edit doesn't fit its own schema (`lens::View::put`).
    NotAView,
    /// Not a rule of the edits but of a device: what a device on a connection sent to join a vault (`Lab::accept_join`)
    /// adds no device, or another device than itself.
    NotJoining,
    /// Not a rule of the edits but of a server: a claim of it (`Lab::accept_claim`) doesn't add the server itself as a
    /// device of an aven vault.
    NotClaiming,
}

/// What a removal takes away.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Fact {
    Owner(VaultId, Principal),
    Device(VaultId, SignerId),
    /// Whatever root the vault had.
    Root(VaultId),
    Cap(CapId),
    /// The entry is in the cell of these caps: whatever only the cell it left allowed falls.
    Cell(EntryId, Arc<[CapId]>),
}

/// Whoever starts out holding keys: a signer with its own key, whoever holds a vault's seed (its members, and the
/// members of its owners), and everyone, who holds what is published.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Holder {
    Signer(SignerId),
    Vault(VaultId),
    Everyone,
}

impl Holder {
    /// The keys the holder starts out with.
    pub fn start(self, st: &State) -> Vec<KeyName> {
        match self {
            Holder::Signer(s) => vec![KeyName::Signer(s)],
            Holder::Vault(v) => vec![st.current(KeyFam::Seed(v))],
            Holder::Everyone => vec![],
        }
    }

    /// The holder should be able to open the current key of `k`.
    pub fn entitled(self, st: &State, k: KeyFam) -> bool {
        match self {
            Holder::Signer(s) => st.entitled(s, k),
            Holder::Vault(x) => st.entitled_vault(x, k),
            Holder::Everyone => st.public_key(k),
        }
    }
}

/// A list without repeats, with a set to look its items up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Listed<T: Eq + Hash> {
    list: Vec<T>,
    set: HashSet<T>,
}

impl<T: Eq + Hash> Default for Listed<T> {
    fn default() -> Self {
        Listed { list: vec![], set: HashSet::new() }
    }
}

impl<T: Copy + Eq + Hash> Listed<T> {
    /// Add `x` at the end, unless it is there already.
    fn push(&mut self, x: T) {
        if self.set.insert(x) {
            self.list.push(x);
        }
    }

    pub fn contains(&self, x: &T) -> bool {
        self.set.contains(x)
    }

    pub fn as_slice(&self) -> &[T] {
        &self.list
    }
}

/// The seals made so far, in order, with what the schedule looks up in them.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct Seals {
    list: Vec<Seal>,
    set: HashSet<Seal>,
    /// The family keys sealed to each key, by that key: what opening it opens of the families. An entry key opens no
    /// family key, so this is all `stale_keys` follows.
    fams: HashMap<KeyName, Vec<KeyName>>,
    /// Every family key sealed to anything.
    secrets: HashSet<KeyName>,
    /// Each key sealed to a key of an entry's stay, with that entry and stay: what `link` checks for a move link.
    linked: HashSet<(KeyName, EntryId, Option<EditId>)>,
}

impl Seals {
    fn add(&mut self, s: Seal) {
        if !self.set.insert(s) {
            return;
        }
        self.list.push(s);
        if let KeyName::Scoped(..) = s.secret {
            self.fams.entry(s.to).or_default().push(s.secret);
            self.secrets.insert(s.secret);
        }
        if let KeyName::Entry(e, stay, _) = s.to {
            self.linked.insert((s.secret, e, stay));
        }
    }
}

/// A blob in a vault's schema lane.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Published {
    pub vault: VaultId,
    pub blob: BlobId,
    pub bytes: Arc<[u8]>,
}

/// What a peer knows after replaying its edits: vaults, caps, entries and their cells, accepted writes, the key
/// schedule and the schema lanes. Every collection is shared, so a copy of a state costs a few counts, and grows in
/// place while nothing else holds it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct State {
    /// In the order they were created, with each one's place.
    vaults: Arc<Vec<Vault>>,
    vault_at: Arc<HashMap<VaultId, usize>>,
    /// Every cap issued, live or revoked, in the order issued, with each one's place, the places of the caps naming
    /// each vault and of the caps over each vault.
    caps: Arc<Vec<Issued>>,
    cap_at: Arc<HashMap<CapId, usize>>,
    held: Arc<HashMap<VaultId, Vec<usize>>>,
    over: Arc<HashMap<VaultId, Vec<usize>>>,
    revoked: Arc<Listed<CapId>>,
    /// In the order they were created, with each one's place.
    entries: Arc<Vec<Entry>>,
    entry_at: Arc<HashMap<EntryId, usize>>,
    /// Every entry id ever created, even of an entry that fell since: an id is created once, so an entry key's name
    /// (the entry, its stay, a generation) names one key.
    born: Arc<Listed<EntryId>>,
    /// In the order they were accepted, with each one's place and the places of each entry's.
    writes: Arc<Vec<Write>>,
    write_at: Arc<HashMap<EditId, usize>>,
    by_entry: Arc<HashMap<EntryId, Vec<usize>>>,
    /// The caps of every cell an entry was ever in or created in, by its id.
    cells: Arc<HashMap<CellId, Arc<[CapId]>>>,
    /// The cells entries are in now, with their vault and how many.
    in_use: Arc<HashMap<CellId, (VaultId, usize)>>,
    /// Each key family's epoch, where it isn't 0, and the removal that moved it to each epoch.
    epochs: Arc<HashMap<KeyFam, u64>>,
    moved: Arc<HashMap<(KeyFam, u64), EditId>>,
    seals: Arc<Seals>,
    /// The keys published to everyone, in the order they were.
    published: Arc<Listed<KeyName>>,
    /// The key each signer has keys sealed to, as it last brought it.
    seal_keys: Arc<HashMap<SignerId, PublicKey>>,
    /// Each vault's schema lane: the schemas and lenses published into it, in the order they came.
    lane: Arc<Vec<Published>>,
    /// Only while checking an edit that a move after it hadn't seen (`hide`): each entry such a move took to a cell,
    /// and that cell's caps. A write must be allowed there too.
    narrow: Vec<(EntryId, Arc<[CapId]>)>,
}

/// What an accepted edit changes, worked out before anything changes (`State::check`).
#[derive(Clone, Debug)]
enum Change {
    /// A `Keys` edit or a checkpoint: nothing.
    Nothing,
    Genesis(Vault, Vec<(SignerId, PublicKey)>),
    AddOwner { at: usize, owner: Principal, seal_to: Option<(SignerId, PublicKey)> },
    RemoveOwner { at: usize, owner: Principal },
    SetThreshold { at: usize, threshold: u32 },
    AddDevice { at: usize, device: SignerId, seal_to: Option<PublicKey> },
    RemoveDevice { at: usize, device: SignerId },
    SetRoot { at: usize, root: Option<SignerId> },
    Cap(Issued),
    /// The caps that end, in the order they were issued.
    Revoke(Vec<CapId>),
    Create(Entry, Write, Arc<[CapId]>),
    /// A write, and whether it acts for its entry's vault, so its tags count.
    Write(Write, bool),
    Move { at: usize, stay: EditId, to: CellId, caps: Arc<[CapId]> },
    Publish(Published),
}

impl Change {
    /// A removal that drops what it took the authorization from (`drop_unseen`) and may make keys stale. A move takes
    /// nothing from a write accepted before it, which is judged in the cell it was written in, and makes no key stale
    /// but a cell's that comes back into use: it takes the light path.
    fn removes(&self) -> bool {
        matches!(
            self,
            Change::RemoveOwner { .. } | Change::RemoveDevice { .. } | Change::SetRoot { .. } | Change::Revoke(_)
        )
    }
}

/// What a commit touched, for `settle`.
enum Touch {
    Nothing,
    /// Families that are new or have new targets, none of whose keys went stale.
    Grew(Vec<KeyFam>),
    /// An entry came into the cell, which was empty before when `fresh`, with only its own write.
    Created { entry: usize, fresh: bool },
    /// A write was added.
    Wrote(usize),
    /// An entry moved into a cell, which was empty before when `fresh`.
    Moved { entry: usize, fresh: bool },
}

/// No item twice.
fn nodup<T: PartialEq>(xs: &[T]) -> bool {
    xs.iter().enumerate().all(|(i, x)| !xs[..i].contains(x))
}

/// A cell's canonical form: its cap ids, each once, smallest first.
pub fn mk_cell(xs: &[CapId]) -> Vec<CapId> {
    let mut out = xs.to_vec();
    out.sort();
    out.dedup();
    out
}

/// The caps `xs` are in canonical form.
fn canonical(xs: &[CapId]) -> bool {
    xs.windows(2).all(|w| w[0] < w[1])
}

impl State {
    pub fn vault(&self, v: VaultId) -> Option<&Vault> {
        self.vault_at.get(&v).map(|&i| &self.vaults[i])
    }

    /// Every vault, in the order they were created.
    pub fn vaults(&self) -> &[Vault] {
        &self.vaults
    }

    /// A bound on chain length: without ownership cycles (T3) a chain never visits more vaults than exist.
    fn depth(&self) -> usize {
        self.vaults.len() + 1
    }

    pub fn cap(&self, c: CapId) -> Option<&Issued> {
        self.cap_at.get(&c).map(|&i| &self.caps[i])
    }

    /// Every cap issued, live or revoked, in the order issued.
    pub fn caps(&self) -> &[Issued] {
        &self.caps
    }

    /// The caps naming vault `a`, live or revoked.
    pub fn caps_held(&self, a: VaultId) -> impl Iterator<Item = &Issued> {
        self.held.get(&a).into_iter().flatten().map(|&i| &self.caps[i])
    }

    /// The caps over vault `v`, live or revoked.
    pub fn caps_over(&self, v: VaultId) -> impl Iterator<Item = &Issued> {
        self.over.get(&v).into_iter().flatten().map(|&i| &self.caps[i])
    }

    /// The caps revoked, in the order they ended.
    pub fn revoked(&self) -> &[CapId] {
        self.revoked.as_slice()
    }

    /// Cap `c` was issued and hasn't been revoked.
    pub fn live(&self, c: CapId) -> bool {
        self.cap_at.contains_key(&c) && !self.revoked.contains(&c)
    }

    pub fn entry(&self, e: EntryId) -> Option<&Entry> {
        self.entry_at.get(&e).map(|&i| &self.entries[i])
    }

    /// Every entry, in the order they were created.
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// Entry id `e` was ever created: it exists, or it fell since.
    pub fn born(&self, e: EntryId) -> bool {
        self.born.contains(&e)
    }

    /// Every entry id ever created, in the order created.
    pub fn all_born(&self) -> &[EntryId] {
        self.born.as_slice()
    }

    /// The caps of cell `x`, if an entry was ever in it or created in it here.
    pub fn cell_caps(&self, x: CellId) -> Option<&[CapId]> {
        self.cells.get(&x).map(|c| &c[..])
    }

    fn caps_of(&self, x: CellId) -> &[CapId] {
        self.cell_caps(x).unwrap_or_default()
    }

    /// Every cell an entry was ever in or created in, with its caps.
    pub fn cells(&self) -> impl Iterator<Item = (CellId, &[CapId])> {
        self.cells.iter().map(|(x, caps)| (*x, &caps[..]))
    }

    /// What was published into every vault's schema lane, in the order it came.
    pub fn lane(&self) -> &[Published] {
        &self.lane
    }

    /// The blobs of vault `v`'s schema lane, in the order they came.
    pub fn lane_of(&self, v: VaultId) -> impl Iterator<Item = &[u8]> {
        self.lane.iter().filter(move |p| p.vault == v).map(|p| &p.bytes[..])
    }

    pub fn write(&self, w: EditId) -> Option<&Write> {
        self.write_at.get(&w).map(|&i| &self.writes[i])
    }

    /// The accepted writes of one entry, in replay order.
    pub fn entry_writes(&self, e: EntryId) -> impl Iterator<Item = &Write> {
        self.by_entry.get(&e).into_iter().flatten().map(|&i| &self.writes[i])
    }

    /// The ids of the accepted writes of one entry, in replay order.
    pub fn writes(&self, e: EntryId) -> Vec<EditId> {
        self.entry_writes(e).map(|w| w.edit).collect()
    }

    /// Every accepted write, in replay order.
    pub fn all_writes(&self) -> &[Write] {
        &self.writes
    }

    /// The lines of one entry's history: the main line, then each proposal in the order it started.
    pub fn lines(&self, e: EntryId) -> Vec<Line> {
        let starts = self.entry_writes(e).filter(|w| w.proposal == Proposal::New);
        std::iter::once(None).chain(starts.map(|w| Some(w.edit))).collect()
    }

    /// The history of line `line` of one entry: the line's own accepted writes and every write they build on, in replay
    /// order.
    pub fn history(&self, e: EntryId, line: Line) -> Vec<&Write> {
        history(self.entry_writes(e).collect::<Vec<_>>().into_iter(), line)
    }

    /// The writes of line `line` of one entry that no other write of its history builds on: what the next edit on the
    /// line builds on.
    pub fn heads(&self, e: EntryId, line: Line) -> Vec<EditId> {
        tips(&self.history(e, line))
    }

    /// Signer `s` is a member of vault `v`: one of its devices, or one of its owner signers (a human vault's passkeys).
    pub fn member(&self, s: SignerId, v: VaultId) -> bool {
        self.vault(v).is_some_and(|vt| vt.devices.contains(&s) || vt.owners.contains(&Principal::Signer(s)))
    }

    /// Signer `s` acts for vault `v`: it is a member of `v`, or acts for an owner of `v`, up the chain. Whatever the
    /// kind: a human vault has no vault owners and a coop no members, by the rules (`owner_fits`).
    pub fn acts_for(&self, s: SignerId, v: VaultId) -> bool {
        self.acts_for_n(s, self.depth(), v)
    }

    fn acts_for_n(&self, s: SignerId, n: usize, v: VaultId) -> bool {
        let Some(vt) = self.vault(v).filter(|_| n > 0) else { return false };
        vt.devices.contains(&s)
            || vt.owners.contains(&Principal::Signer(s))
            || vt.owners.iter().any(|p| matches!(*p, Principal::Vault(o) if self.acts_for_n(s, n - 1, o)))
    }

    /// Vault `o` is listed as an owner of vault `v`.
    pub fn owner_of(&self, o: VaultId, v: VaultId) -> bool {
        self.vault(v).is_some_and(|vt| vt.owners.contains(&Principal::Vault(o)))
    }

    /// Signer `s` acts for vault `actor` through the owners `via`, as an edit names them: `via` runs from an owner of
    /// `actor` down, each vault an owner of the one before, to the vault `s` is a member of; with no `via`, `s` is a
    /// member of `actor` itself. A device of Bob's human vault acts for Bob's coop through `[bob]`.
    pub fn acts_via(&self, s: SignerId, via: &[VaultId], actor: VaultId) -> bool {
        let mut v = actor;
        for &o in via {
            if !self.owner_of(o, v) {
                return false;
            }
            v = o;
        }
        self.member(s, v)
    }

    /// The owners signer `s` acts for vault `v` through, as an edit names them (`acts_via`): none when `s` is a member
    /// of `v`, else the shortest chain, the first owner in each vault's order winning a tie, or `None` if `s` doesn't
    /// act for `v`.
    pub fn via(&self, s: SignerId, v: VaultId) -> Option<Vec<VaultId>> {
        // breadth first from `v` up its owners: the first vault `s` is a member of ends the shortest chain
        let mut paths: Vec<Vec<VaultId>> = vec![vec![]];
        let mut seen: HashSet<VaultId> = HashSet::from([v]);
        for _ in 0..self.depth() {
            let mut next = vec![];
            for path in paths {
                let at = path.last().copied().unwrap_or(v);
                if self.member(s, at) {
                    return Some(path);
                }
                for p in self.vault(at).map(|vt| &vt.owners[..]).unwrap_or_default() {
                    if let Principal::Vault(o) = *p
                        && seen.insert(o)
                    {
                        next.push(path.iter().copied().chain([o]).collect());
                    }
                }
            }
            paths = next;
        }
        None
    }

    /// The signers `sigs` approve for `p`: a signer by signing, a vault when its root signed or its threshold of
    /// owners approve. Devices are not owners, so they never approve.
    pub fn approves(&self, sigs: &[SignerId], p: Principal) -> bool {
        self.approves_n(sigs, self.depth(), p)
    }

    fn approves_n(&self, sigs: &[SignerId], n: usize, p: Principal) -> bool {
        match p {
            Principal::Signer(s) => sigs.contains(&s),
            Principal::Vault(v) => match self.vault(v).filter(|_| n > 0) {
                None => false,
                Some(vt) => {
                    vt.root.is_some_and(|r| sigs.contains(&r))
                        || vt.owners.iter().filter(|&&o| self.approves_n(sigs, n - 1, o)).count() >= vt.threshold as usize
                }
            },
        }
    }

    /// Vault `a` owns vault `x`, directly or through owners of owners.
    pub fn owns(&self, a: VaultId, x: VaultId) -> bool {
        self.owns_n(a, self.depth(), x)
    }

    fn owns_n(&self, a: VaultId, n: usize, x: VaultId) -> bool {
        let Some(vt) = self.vault(x).filter(|_| n > 0) else { return false };
        vt.owners.iter().any(|p| matches!(*p, Principal::Vault(o) if o == a || self.owns_n(a, n - 1, o)))
    }

    /// Human vaults are owned by signers, their person's passkeys; coop and aven vaults by existing human and coop
    /// vaults, never by a signer directly.
    fn owner_fits(&self, kind: Kind, p: Principal) -> Result<(), Refusal> {
        match (kind, p) {
            (Kind::Human, Principal::Signer(_)) => Ok(()),
            (Kind::Coop | Kind::Aven, Principal::Vault(o)) => match self.vault(o) {
                None => Err(Refusal::UnknownVault),
                // an aven vault owns nothing (yet)
                Some(ot) if ot.kind == Kind::Aven => Err(Refusal::WrongOwnerKind),
                Some(_) => Ok(()),
            },
            _ => Err(Refusal::WrongOwnerKind),
        }
    }

    /// Vault `a` holds cap `cp` with role `r` or more: the cap is live and names `a`.
    pub fn holds(&self, a: VaultId, cp: &Issued, r: Role) -> bool {
        self.live(cp.id) && cp.cap.grantee == Grantee::Principal(Principal::Vault(a)) && cp.cap.role.allows(r)
    }

    /// Cap `cp` reaches entry `e` of vault `v` in the cell of the caps `cell`: it is over the vault, and wide, or in
    /// the cell and in the cell of every move the edit being checked hadn't seen (`narrow`).
    fn in_cell(&self, cp: &Issued, e: EntryId, v: VaultId, cell: &[CapId]) -> bool {
        cp.cap.over == v
            && (cp.cap.wide
                || (cell.contains(&cp.id) && self.narrow.iter().all(|(x, caps)| *x != e || caps.contains(&cp.id))))
    }

    /// Vault `a` may write entry `e` of vault `v` in the cell of the caps `cell`: it is the vault, or it holds a cap
    /// with write or more that reaches the entry there.
    fn may_write_in(&self, a: VaultId, e: EntryId, v: VaultId, cell: &[CapId]) -> bool {
        a == v || self.caps_held(a).any(|cp| self.holds(a, cp, Role::Write) && self.in_cell(cp, e, v, cell))
    }

    /// Vault `a` may write entry `e`, by what every peer sees (no selector, type or tag): it is the entry's vault, or it
    /// holds a cap with write or more that reaches the entry's cell.
    pub fn may_write(&self, a: VaultId, e: EntryId) -> bool {
        self.entry(e).is_some_and(|en| self.may_write_in(a, en.id, en.vault, self.caps_of(en.cell())))
    }

    /// The caps over vault `v` through which vault `a` may create an entry in the cell of the caps `x`: those it holds
    /// with write or more whose intake cell `x` is.
    fn intake_caps(&self, a: VaultId, v: VaultId, x: &[CapId]) -> Vec<CapId> {
        self.caps_held(a)
            .filter(|cp| cp.cap.over == v && self.holds(a, cp, Role::Write) && &cp.intake[..] == x)
            .map(|cp| cp.id)
            .collect()
    }

    /// Vault `a` may create an entry of vault `v` in the cell of the caps `x`: it is `v`, which creates in any cell, or
    /// `x` is the intake cell of a cap over `v` that it holds with write or more.
    pub fn may_create(&self, a: VaultId, v: VaultId, x: &[CapId]) -> bool {
        a == v || !self.intake_caps(a, v, x).is_empty()
    }

    /// A write is authorized: its author acts for its actor through the owners it names, and that vault may write its
    /// entry as the write found it, in the cell it was in then (`Write::cell`). Strong removal judges an edit at its
    /// own place in the replay too, so a removal takes from a write only what it took from it there: a move between
    /// them doesn't hand the removal writes that never rested on what it takes away.
    pub fn authorized(&self, w: &Write) -> bool {
        self.acts_via(w.author, &w.via, w.actor)
            && self.entry(w.entry).is_some_and(|en| self.may_write_in(w.actor, en.id, en.vault, self.caps_of(w.cell)))
    }

    /// Vault `a` publishes into vault `v`'s schema lane: it is `v`, or holds a wide owner cap over it.
    pub fn owns_lane(&self, a: VaultId, v: VaultId) -> bool {
        a == v || self.caps_held(a).any(|cp| cp.cap.over == v && cp.cap.wide && self.holds(a, cp, Role::Owner))
    }

    /// A cap's parent is a live owner cap over the same vault that its issuer holds, and a wide cap rests only on a wide
    /// one (so a wide cap's whole chain is wide); a root cap is issued by the vault it is over.
    fn cap_parent_ok(&self, c: &Cap) -> bool {
        match c.parent {
            None => c.issuer == c.over,
            Some(p) => self.cap(p).is_some_and(|pc| {
                self.live(p)
                    && pc.cap.over == c.over
                    && pc.cap.role == Role::Owner
                    && pc.cap.grantee == Grantee::Principal(Principal::Vault(c.issuer))
                    && (!c.wide || pc.cap.wide)
            }),
        }
    }

    /// Vault `a` may revoke cap `cp`: it issued it, the cap is over it, it holds the cap (and gives it up), or it may
    /// revoke a cap `cp` rests on.
    pub fn may_revoke(&self, a: VaultId, cp: &Issued) -> bool {
        cp.chain.iter().filter_map(|&c| self.cap(c)).any(|x| {
            x.cap.issuer == a || x.cap.over == a || x.cap.grantee == Grantee::Principal(Principal::Vault(a))
        })
    }

    /// Cell `x` is a cell of vault `v`: in canonical form, each of its caps one over `v` that isn't wide.
    pub fn cell_ok(&self, v: VaultId, x: &[CapId]) -> bool {
        canonical(x) && x.iter().all(|&c| self.cap(c).is_some_and(|cp| cp.cap.over == v && !cp.cap.wide))
    }

    /// How far below the human vaults vault `v` sits: a human vault at 0, a coop or an aven vault one below its lowest
    /// owner.
    fn tier(&self, v: VaultId) -> usize {
        self.tier_n(v, self.depth())
    }

    fn tier_n(&self, v: VaultId, n: usize) -> usize {
        match (n, self.vault(v)) {
            (0, _) | (_, None) => 0,
            (_, Some(vt)) => vt.owners.iter().fold(0, |t, p| match *p {
                Principal::Vault(o) => t.max(self.tier_n(o, n - 1) + 1),
                Principal::Signer(_) => t,
            }),
        }
    }

    /// How senior vault `a` is in revoking cap `cp`: 0 for the vault it is over, else the place in its chain of the
    /// highest cap `a` issued, the root cap at 0; a grantee giving its cap up comes last.
    fn seniority(&self, a: VaultId, cp: &Issued) -> usize {
        if cp.cap.over == a {
            return 0;
        }
        let issuer = |c: &CapId| self.cap(*c).map(|x| x.cap.issuer);
        cp.chain.iter().position(|c| issuer(c) == Some(a)).unwrap_or(cp.chain.len())
    }

    /* The semantic layer: what only an entry's readers and its vault's stewards know. */

    /// Cap `cp` with its whole chain selects attributes `a`, by the selectors `r` holds (T22): every cap of the chain is
    /// wide or its selector matches. A selector `r` doesn't hold selects nothing.
    pub fn eff_selects(&self, cp: &Issued, a: &Attrs, r: &Readings) -> bool {
        cp.chain.iter().all(|c| {
            self.cap(*c).is_some_and(|x| x.cap.wide || r.selectors.get(c).is_some_and(|s| s.matches(a)))
        })
    }

    /// What entry `e` means to whoever reads it, by the selectors, headers and tags `r` holds: its attributes, whether
    /// its creation was let in, its semantic cell and where a steward would move it. `None` for an entry that doesn't
    /// exist, or whose header `r` doesn't hold.
    pub fn meaning(&self, e: EntryId, r: &Readings) -> Option<Meaning> {
        let en = self.entry(e)?;
        let header = r.headers.get(&en.creation)?;
        let first = r.tags.get(&en.creation).map(|d| d.apply(&[])).unwrap_or_default();
        let mut attrs =
            Attrs { ty: header.ty.clone(), author: en.creator, entry: en.id, created: header.created, tags: first };
        // its creator was the vault, or created it in the intake cell of a cap whose slice held it then
        let admitted = en.creator == en.vault
            || en.intake.iter().any(|&c| self.cap(c).is_some_and(|cp| self.eff_selects(cp, &attrs, r)));
        for w in &en.retags {
            if let Some(d) = r.tags.get(w) {
                attrs.tags = d.apply(&attrs.tags);
            }
        }
        let cell: Vec<CapId> = if admitted {
            let selects =
                |cp: &&Issued| self.live(cp.id) && !cp.cap.wide && self.eff_selects(cp, &attrs, r);
            mk_cell(&self.caps_over(en.vault).filter(selects).map(|cp| cp.id).collect::<Vec<_>>())
        } else {
            vec![]
        };
        let live: Vec<CapId> = self.caps_of(en.cell()).iter().copied().filter(|&c| self.live(c)).collect();
        let desired = (live != cell).then(|| cell.clone());
        Some(Meaning { attrs, admitted, cell, desired })
    }

    /// The write rule by meaning: vault `a` is the entry's vault, or holds a live cap with write or more over it that
    /// is wide, or whose slice holds the entry and its creation was let in.
    pub fn sem_write(&self, a: VaultId, e: EntryId, r: &Readings) -> bool {
        let (Some(en), Some(m)) = (self.entry(e), self.meaning(e, r)) else { return false };
        a == en.vault
            || self.caps_held(a).any(|cp| {
                cp.cap.over == en.vault
                    && self.holds(a, cp, Role::Write)
                    && (cp.cap.wide || (m.admitted && self.eff_selects(cp, &m.attrs, r)))
            })
    }

    /* Keys */

    /// The current epoch of a key family; it starts at 0 and grows by one at every rotation.
    pub fn epoch(&self, k: KeyFam) -> u64 {
        self.epochs.get(&k).copied().unwrap_or(0)
    }

    /// The current key of a family.
    pub fn current(&self, k: KeyFam) -> KeyName {
        KeyName::Scoped(k, self.epoch(k))
    }

    /// Every family whose epoch isn't 0, with its epoch.
    pub fn epochs(&self) -> impl Iterator<Item = (KeyFam, u64)> + '_ {
        self.epochs.iter().map(|(k, e)| (*k, *e))
    }

    /// The removal whose settling moved family `k` to epoch `e`: real derived keys mix it in (`lab`), so two devices
    /// that saw different removals never derive one key for different audiences.
    pub fn moved_by(&self, k: KeyFam, e: u64) -> Option<EditId> {
        self.moved.get(&(k, e)).copied()
    }

    /// Every seal of the schedule, in the order made.
    pub fn seals(&self) -> &[Seal] {
        &self.seals.list
    }

    /// The schedule seals `secret` to `to`.
    pub fn sealed(&self, secret: KeyName, to: KeyName) -> bool {
        self.seals.set.contains(&Seal { secret, to })
    }

    /// Every published key, in the order published.
    pub fn published(&self) -> &[KeyName] {
        self.published.as_slice()
    }

    /// The key signer `s` has keys sealed to.
    pub fn seal_key(&self, s: SignerId) -> Option<&PublicKey> {
        self.seal_keys.get(&s)
    }

    /// The key of entry `e` in its current stay, at its cell's current generation.
    pub fn entry_key(&self, e: EntryId) -> Option<KeyName> {
        let en = self.entry(e)?;
        Some(KeyName::Entry(en.id, en.stay(), self.epoch(KeyFam::Cell(en.vault, en.cell()))))
    }

    /// Every key family that exists: each vault's seed, the key of each live cap with read or more, and the key of
    /// each cell an entry is in.
    pub fn key_fams(&self) -> Vec<KeyFam> {
        let seeds = self.vaults.iter().map(|v| KeyFam::Seed(v.id));
        let caps = self
            .caps
            .iter()
            .filter(|cp| self.live(cp.id) && cp.cap.role.allows(Role::Read))
            .map(|cp| KeyFam::Cap(cp.cap.over, cp.id));
        let mut seen = HashSet::new();
        let cells = self.entries.iter().map(|en| KeyFam::Cell(en.vault, en.cell())).filter(|k| seen.insert(*k));
        seeds.chain(caps).chain(cells.collect::<Vec<_>>()).collect()
    }

    /// Family `k` exists (`key_fams`).
    pub fn has_fam(&self, k: KeyFam) -> bool {
        match k {
            KeyFam::Seed(v) => self.vault(v).is_some(),
            KeyFam::Cap(v, c) => {
                self.cap(c).is_some_and(|cp| cp.cap.over == v && self.live(c) && cp.cap.role.allows(Role::Read))
            }
            KeyFam::Cell(v, x) => self.in_use.get(&x).is_some_and(|&(u, n)| u == v && n > 0),
        }
    }

    /// The live caps over vault `v` with read or more that reach the cell of the caps `x`: in it, or wide.
    fn read_caps(&self, v: VaultId, x: &[CapId]) -> impl Iterator<Item = &Issued> {
        self.caps_over(v)
            .filter(move |cp| self.live(cp.id) && cp.cap.role.allows(Role::Read) && (cp.cap.wide || x.contains(&cp.id)))
    }

    /// The vaults that may read family `k` themselves (`readsV`): a seed's vault; a live cap with read or more's vault
    /// and the vault it names; a cell's vault and the vaults the live caps with read or more reaching it name. Relay
    /// caps get no key.
    pub fn readers(&self, k: KeyFam) -> Vec<VaultId> {
        let grantee = |cp: &Issued| match cp.cap.grantee {
            Grantee::Principal(Principal::Vault(g)) => Some(g),
            _ => None,
        };
        match k {
            KeyFam::Seed(v) => vec![v],
            KeyFam::Cap(v, c) => match self.cap(c) {
                Some(cp) if cp.cap.over == v && self.live(c) && cp.cap.role.allows(Role::Read) => {
                    std::iter::once(v).chain(grantee(cp)).collect()
                }
                _ => vec![],
            },
            KeyFam::Cell(v, x) => std::iter::once(v).chain(self.read_caps(v, self.caps_of(x)).filter_map(grantee)).collect(),
        }
    }

    /// Vault `y` itself may read family `k`.
    pub fn reads_vault(&self, y: VaultId, k: KeyFam) -> bool {
        self.readers(k).contains(&y)
    }

    /// Everyone may read family `k`: a live cap with read to Public reaches it.
    pub fn public_key(&self, k: KeyFam) -> bool {
        match k {
            KeyFam::Seed(_) => false,
            KeyFam::Cap(v, c) => self.cap(c).is_some_and(|cp| {
                cp.cap.over == v && self.live(c) && cp.cap.role.allows(Role::Read) && cp.cap.grantee == Grantee::Public
            }),
            KeyFam::Cell(v, x) => self.read_caps(v, self.caps_of(x)).any(|cp| cp.cap.grantee == Grantee::Public),
        }
    }

    /// Signer `d` should be able to open the current key of `k`: it acts for a vault that may read `k`.
    pub fn entitled(&self, d: SignerId, k: KeyFam) -> bool {
        self.readers(k).into_iter().any(|y| self.acts_for(d, y))
    }

    /// Whoever holds the current key of vault `x`'s seed should be able to open the current key of `k`: `x` may read
    /// `k`, or a vault it owns may.
    pub fn entitled_vault(&self, x: VaultId, k: KeyFam) -> bool {
        self.readers(k).into_iter().any(|y| y == x || self.owns(x, y))
    }

    /// The keys the current key of `k` is sealed to, wrapped under or derived from: a seed is sealed to its vault's
    /// devices and owner signers (a human vault's passkeys, through keys derived from them) and to the seeds of its
    /// owner vaults; a cap key is derived from its vault's seed and sealed to its grantee's; a cell key is derived from
    /// its vault's seed and wrapped under the key of each cap with read or more that reaches it.
    pub fn targets(&self, k: KeyFam) -> Vec<KeyName> {
        let seed = |v: VaultId| self.current(KeyFam::Seed(v));
        match k {
            KeyFam::Seed(v) => match self.vault(v) {
                None => vec![],
                Some(vt) => {
                    let signers = vt.owners.iter().filter_map(|p| match *p {
                        Principal::Signer(s) => Some(s),
                        Principal::Vault(_) => None,
                    });
                    let vaults = vt.owners.iter().filter_map(|p| match *p {
                        Principal::Vault(o) => Some(seed(o)),
                        Principal::Signer(_) => None,
                    });
                    vt.devices.iter().copied().chain(signers).map(KeyName::Signer).chain(vaults).collect()
                }
            },
            KeyFam::Cap(v, c) => {
                let grantee = self.cap(c).and_then(|cp| match cp.cap.grantee {
                    Grantee::Principal(Principal::Vault(g)) => Some(seed(g)),
                    _ => None,
                });
                std::iter::once(seed(v)).chain(grantee).collect()
            }
            KeyFam::Cell(v, x) => std::iter::once(seed(v))
                .chain(self.read_caps(v, self.caps_of(x)).map(|cp| self.current(KeyFam::Cap(v, cp.id))))
                .collect(),
        }
    }

    /// What an agent holding the keys `start` can open: what is published, and whatever is sealed or wrapped to a key it
    /// can open, or derived from one. No key is learned any other way.
    pub fn opens(&self, start: &[KeyName]) -> HashSet<KeyName> {
        let mut by_to: HashMap<KeyName, Vec<KeyName>> = HashMap::new();
        for s in &self.seals.list {
            by_to.entry(s.to).or_default().push(s.secret);
        }
        reach(&by_to, start.iter().chain(self.published.as_slice()).copied())
    }

    /// The family keys an agent holding the keys `start` can open: `opens` without the entry keys, which open no family
    /// key.
    fn opens_fams(&self, start: impl IntoIterator<Item = KeyName>) -> HashSet<KeyName> {
        reach(&self.seals.fams, start.into_iter().chain(self.published.as_slice().iter().copied()))
    }

    /// Every signer some vault lists.
    fn signers(&self) -> Vec<SignerId> {
        self.vaults
            .iter()
            .flat_map(|v| {
                v.devices.iter().copied().chain(v.owners.iter().filter_map(|p| match *p {
                    Principal::Signer(s) => Some(s),
                    Principal::Vault(_) => None,
                }))
            })
            .collect()
    }

    /// The holders that matter: every signer some vault lists, every vault, and everyone.
    pub fn holders(&self) -> Vec<Holder> {
        let signers = self.signers().into_iter().map(Holder::Signer);
        signers.chain(self.vaults.iter().map(|v| Holder::Vault(v.id))).chain([Holder::Everyone]).collect()
    }

    /// Signer `d` may box key `name`: the key of a family that exists, at an epoch it has reached, that `d` should be
    /// able to open; or the key of one of an entry's stays at a generation that stay's cell has reached, when `d` should
    /// be able to open the key of the entry's cell.
    fn may_box(&self, d: SignerId, name: KeyName) -> Result<(), Refusal> {
        match name {
            KeyName::Signer(_) => Err(Refusal::UnknownKey),
            KeyName::Scoped(k, e) => {
                if !self.has_fam(k) {
                    return Err(Refusal::UnknownKey);
                }
                if !self.entitled(d, k) {
                    return Err(Refusal::NotEntitled);
                }
                if e > self.epoch(k) {
                    return Err(Refusal::FutureEpoch);
                }
                Ok(())
            }
            KeyName::Entry(e, s, g) => {
                let en = self.entry(e).ok_or(Refusal::UnknownKey)?;
                if !self.entitled(d, KeyFam::Cell(en.vault, en.cell())) {
                    return Err(Refusal::NotEntitled);
                }
                let x = en.stay_cell(s).ok_or(Refusal::UnknownKey)?;
                if g > self.epoch(KeyFam::Cell(en.vault, x)) {
                    return Err(Refusal::FutureEpoch);
                }
                Ok(())
            }
        }
    }

    /* Steps */

    /// Apply one edit, then rotate, seal and link keys: the new state, or why the edit is refused. Each rule is the
    /// model's (`step` in `Step.lean`), checked in the same order.
    pub fn step(&self, edit: &Edit) -> Result<State, Refusal> {
        let mut st = self.clone();
        st.step_mut(edit, edit.id())?;
        Ok(st)
    }

    /// `step` in place, for edit `edit` whose id is `id`: a refused edit leaves the state as it was.
    pub fn step_mut(&mut self, edit: &Edit, id: EditId) -> Result<(), Refusal> {
        let change = self.check(edit, id)?;
        if change.removes() {
            self.remove(change, edit, id);
        } else {
            let touch = self.commit(change);
            self.settle(touch, id);
        }
        Ok(())
    }

    /// `step_mut` the way the model words it, whatever the edit: every write judged again after it (`drop_unseen`) and
    /// every key looked at (`stale_keys`, `seal_all`, `link_all`). It ends where `step_mut` does (T6); the tests check
    /// that it does.
    #[doc(hidden)]
    pub fn step_full(&mut self, edit: &Edit, id: EditId) -> Result<(), Refusal> {
        let change = self.check(edit, id)?;
        let keep: HashSet<EditId> = edit.action.keep().unwrap_or_default().iter().copied().collect();
        let holders = self.holders();
        let fams: HashSet<KeyFam> = self.key_fams().into_iter().collect();
        let drops = change.removes() || matches!(change, Change::Move { .. });
        let stays = self.survivors(&keep);
        let set_root = matches!(change, Change::SetRoot { .. });
        self.commit(change);
        if drops && !set_root {
            self.drop_unseen(&stays);
        }
        self.settle_full(&holders, &fams, id);
        Ok(())
    }

    /// A removal: what it takes away, every write it took the authorization from and hadn't seen dropped, and every key
    /// that went stale rotated.
    fn remove(&mut self, change: Change, edit: &Edit, id: EditId) {
        let keep: HashSet<EditId> = edit.action.keep().unwrap_or_default().iter().copied().collect();
        let holders = self.holders();
        let fams: HashSet<KeyFam> = self.key_fams().into_iter().collect();
        // the root's hand-over cuts what it hadn't seen in the replay (`view`), but drops nothing here
        let stays = (!matches!(change, Change::SetRoot { .. })).then(|| self.survivors(&keep));
        self.commit(change);
        if let Some(stays) = stays {
            self.drop_unseen(&stays);
        }
        self.settle_full(&holders, &fams, id);
    }

    /// Before a removal: the writes that stay whatever it takes away, those it had seen (`keep`) and those that were
    /// unauthorized already.
    fn survivors(&self, keep: &HashSet<EditId>) -> Vec<bool> {
        self.writes.iter().map(|w| keep.contains(&w.edit) || !self.authorized(w)).collect()
    }

    /// Check one edit against the state: what it would change, or why it is refused. Nothing changes.
    fn check(&self, edit: &Edit, id: EditId) -> Result<Change, Refusal> {
        let sigs: Vec<SignerId> = edit.sigs().collect();
        let approves = |p| self.approves(&sigs, p);
        let vault_at = |v: VaultId| self.vault_at.get(&v).copied().ok_or(Refusal::UnknownVault);
        match &edit.action {
            Action::Genesis { kind, owners, threshold, root, seal_to, .. } => {
                let v = VaultId::from(id);
                if self.vault(v).is_some() {
                    return Err(Refusal::Duplicate);
                }
                if owners.is_empty() || !nodup(owners) {
                    return Err(Refusal::BadOwners);
                }
                for &p in owners {
                    self.owner_fits(*kind, p)?;
                }
                // only a human vault has a root, and the root signs
                if let Some(r) = root {
                    if *kind != Kind::Human {
                        return Err(Refusal::NotHuman);
                    }
                    if !sigs.contains(r) {
                        return Err(Refusal::NoConsent);
                    }
                }
                if *threshold == 0 || *threshold as usize > owners.len() {
                    return Err(Refusal::BadThreshold);
                }
                // every first owner consents
                if !owners.iter().all(|&p| approves(p)) {
                    return Err(Refusal::NoConsent);
                }
                let vt = Vault { id: v, kind: *kind, owners: owners.clone(), threshold: *threshold, devices: vec![], root: *root };
                let keys = seal_to.iter().filter(|(s, _)| owners.contains(&Principal::Signer(*s))).cloned().collect();
                Ok(Change::Genesis(vt, keys))
            }
            Action::AddOwner { vault, owner, seal_to } => {
                let (v, owner) = (*vault, *owner);
                let at = vault_at(v)?;
                let vt = &self.vaults[at];
                if vt.owners.contains(&owner) {
                    return Err(Refusal::AlreadyMember);
                }
                self.owner_fits(vt.kind, owner)?;
                // no cycles: the newcomer must not be the vault itself or something the vault owns
                if matches!(owner, Principal::Vault(x) if x == v || self.owns(v, x)) {
                    return Err(Refusal::Cycle);
                }
                // the vault's approval, plus the newcomer's consent
                if !approves(Principal::Vault(v)) {
                    return Err(Refusal::BelowThreshold);
                }
                if !approves(owner) {
                    return Err(Refusal::NoConsent);
                }
                let seal_to = match (owner, seal_to) {
                    (Principal::Signer(s), Some(key)) => Some((s, key.clone())),
                    _ => None,
                };
                Ok(Change::AddOwner { at, owner, seal_to })
            }
            Action::RemoveOwner { vault, owner, .. } => {
                let (v, owner) = (*vault, *owner);
                let at = vault_at(v)?;
                let vt = &self.vaults[at];
                if !vt.owners.contains(&owner) {
                    return Err(Refusal::NotMember);
                }
                if vt.owners.len() <= 1 {
                    return Err(Refusal::LastOwner);
                }
                // the vault's approval, or the owner leaving on its own
                if !(approves(Principal::Vault(v)) || approves(owner)) {
                    return Err(Refusal::BelowThreshold);
                }
                Ok(Change::RemoveOwner { at, owner })
            }
            &Action::SetThreshold { vault, threshold } => {
                let at = vault_at(vault)?;
                if threshold == 0 || threshold as usize > self.vaults[at].owners.len() {
                    return Err(Refusal::BadThreshold);
                }
                if !approves(Principal::Vault(vault)) {
                    return Err(Refusal::BelowThreshold);
                }
                Ok(Change::SetThreshold { at, threshold })
            }
            Action::AddDevice { vault, device, seal_to } => {
                let (v, device) = (*vault, *device);
                let at = vault_at(v)?;
                let vt = &self.vaults[at];
                if !vt.kind.has_devices() {
                    return Err(Refusal::NoDevices);
                }
                if vt.devices.contains(&device) {
                    return Err(Refusal::AlreadyMember);
                }
                // the vault's approval, plus the device's own signature
                if !approves(Principal::Vault(v)) {
                    return Err(Refusal::BelowThreshold);
                }
                if !sigs.contains(&device) {
                    return Err(Refusal::NoConsent);
                }
                Ok(Change::AddDevice { at, device, seal_to: seal_to.clone() })
            }
            Action::RemoveDevice { vault, device, .. } => {
                let (v, device) = (*vault, *device);
                let at = vault_at(v)?;
                if !self.vaults[at].devices.contains(&device) {
                    return Err(Refusal::NotMember);
                }
                // the vault's approval, or the device leaving on its own
                if !(approves(Principal::Vault(v)) || sigs.contains(&device)) {
                    return Err(Refusal::BelowThreshold);
                }
                Ok(Change::RemoveDevice { at, device })
            }
            &Action::SetRoot { vault, root, .. } => {
                let at = vault_at(vault)?;
                // only the root hands the root on, and the new root signs
                if !self.vaults[at].root.is_some_and(|r| sigs.contains(&r)) {
                    return Err(Refusal::NotRoot);
                }
                if root.is_some_and(|r| !sigs.contains(&r)) {
                    return Err(Refusal::NoConsent);
                }
                Ok(Change::SetRoot { at, root })
            }
            Action::Cap(c, via) => {
                let cid = CapId::from(id);
                if self.cap(cid).is_some() {
                    return Err(Refusal::Duplicate);
                }
                if self.vault(c.over).is_none() {
                    return Err(Refusal::UnknownVault);
                }
                // caps name vaults or Public, never signers, nor the vault they are over; Public only reads
                match c.grantee {
                    Grantee::Principal(Principal::Signer(_)) => return Err(Refusal::CapToSigner),
                    Grantee::Principal(Principal::Vault(x)) if self.vault(x).is_none() => {
                        return Err(Refusal::UnknownVault);
                    }
                    Grantee::Principal(Principal::Vault(x)) if x == c.over => return Err(Refusal::CapToItself),
                    Grantee::Public if c.role != Role::Read => return Err(Refusal::PublicBeyondRead),
                    _ => {}
                }
                if !self.acts_via(edit.author, via, c.issuer) {
                    return Err(Refusal::NotActing);
                }
                if !self.cap_parent_ok(c) {
                    return Err(Refusal::BadParent);
                }
                // making someone owner is governance
                if c.role == Role::Owner && !approves(Principal::Vault(c.issuer)) {
                    return Err(Refusal::BelowThreshold);
                }
                let above = c.parent.and_then(|p| self.cap(p)).map(|p| &p.chain[..]).unwrap_or_default();
                let chain: Arc<[CapId]> = above.iter().copied().chain([cid]).collect();
                let narrow: Vec<CapId> = chain
                    .iter()
                    .copied()
                    .filter(|&x| if x == cid { !c.wide } else { self.cap(x).is_some_and(|y| !y.cap.wide) })
                    .collect();
                let intake = mk_cell(&narrow).into();
                Ok(Change::Cap(Issued { id: cid, cap: c.clone(), chain, intake }))
            }
            &Action::Revoke { cap, actor, ref via, .. } => {
                let c = self.cap(cap).ok_or(Refusal::UnknownCap)?;
                if !self.live(cap) {
                    return Err(Refusal::Revoked);
                }
                if !self.acts_via(edit.author, via, actor) {
                    return Err(Refusal::NotActing);
                }
                if !self.may_revoke(actor, c) {
                    return Err(Refusal::NoCap);
                }
                if c.cap.role == Role::Owner && !approves(Principal::Vault(actor)) {
                    return Err(Refusal::BelowThreshold);
                }
                // the cap and every cap resting on it end
                let ending =
                    self.caps.iter().filter(|x| x.chain.contains(&cap) && !self.revoked.contains(&x.id)).map(|x| x.id);
                Ok(Change::Revoke(ending.collect()))
            }
            Action::Write { vault, entry, actor, stay, generation, deps, proposal, via, create, .. } => {
                let (v, e, actor, stay, generation, proposal) = (*vault, *entry, *actor, *stay, *generation, *proposal);
                if self.write_at.contains_key(&id) {
                    return Err(Refusal::Duplicate);
                }
                if !self.acts_via(edit.author, via, actor) {
                    return Err(Refusal::NotActing);
                }
                match create {
                    Some(x) => {
                        // a new entry, with an id never used before, in a cell its actor may create in, under a
                        // generation that cell has reached
                        if self.entry(e).is_some() || self.born.contains(&e) {
                            return Err(Refusal::Reborn);
                        }
                        if self.vault(v).is_none() {
                            return Err(Refusal::UnknownVault);
                        }
                        if stay.is_some() || !deps.is_empty() || proposal != Proposal::Main {
                            return Err(Refusal::NotFirst);
                        }
                        if !self.cell_ok(v, x) {
                            return Err(Refusal::BadCell);
                        }
                        let intake = self.intake_caps(actor, v, x);
                        if actor != v && intake.is_empty() {
                            return Err(Refusal::NoCap);
                        }
                        let cell = CellId::of(v, x);
                        if generation > self.epoch(KeyFam::Cell(v, cell)) {
                            return Err(Refusal::FutureEpoch);
                        }
                        let en = Entry {
                            id: e,
                            vault: v,
                            stays: vec![(None, cell)],
                            creator: actor,
                            creation: id,
                            intake,
                            retags: vec![],
                        };
                        let (deps, via) = (vec![], via.clone());
                        let w = Write { edit: id, author: edit.author, actor, entry: e, stay: None, generation, deps, proposal, via, first: true, cell };
                        Ok(Change::Create(en, w, x.as_slice().into()))
                    }
                    None => {
                        let en = self.entry(e).ok_or(Refusal::UnknownEntry)?;
                        let (deps, via) = (deps.clone(), via.clone());
                        let w = Write {
                            edit: id,
                            author: edit.author,
                            actor,
                            entry: e,
                            stay,
                            generation,
                            deps,
                            proposal,
                            via,
                            first: false,
                            cell: en.cell(),
                        };
                        if en.vault != v {
                            return Err(Refusal::WrongVault);
                        }
                        if !self.may_write_in(actor, e, v, self.caps_of(en.cell())) {
                            return Err(Refusal::NoCap);
                        }
                        let x = en.stay_cell(stay).ok_or(Refusal::UnknownStay)?;
                        if generation > self.epoch(KeyFam::Cell(v, x)) {
                            return Err(Refusal::FutureEpoch);
                        }
                        // what it builds on was accepted, so the accepted writes stay causally closed (T14); a write
                        // on a proposal builds on the proposal's start
                        builds_on(&self.entry_writes(e).collect::<Vec<_>>(), &w)?;
                        // only the vault's own devices change tags; anyone else asks them to, in its body
                        Ok(Change::Write(w, actor == v))
                    }
                }
            }
            Action::Move { vault, entry, to, via, .. } => {
                let (v, e) = (*vault, *entry);
                let at = self.entry_at.get(&e).copied().ok_or(Refusal::UnknownEntry)?;
                let en = &self.entries[at];
                // only a steward moves, to another cell of the vault, and a move begins one stay
                if en.vault != v {
                    return Err(Refusal::WrongVault);
                }
                if !self.acts_via(edit.author, via, v) {
                    return Err(Refusal::NotActing);
                }
                if !self.cell_ok(v, to) {
                    return Err(Refusal::BadCell);
                }
                let cell = CellId::of(v, to);
                if cell == en.cell() {
                    return Err(Refusal::SameCell);
                }
                if en.stays.iter().any(|(s, _)| *s == Some(id)) {
                    return Err(Refusal::Duplicate);
                }
                Ok(Change::Move { at, stay: id, to: cell, caps: to.as_slice().into() })
            }
            Action::Keys { name, boxes, clear, .. } => {
                self.may_box(edit.author, *name)?;
                // a box the schedule doesn't seal would hand the key to someone who may not open it
                if !boxes.iter().all(|b| self.sealed(*name, b.to.name())) {
                    return Err(Refusal::Unsealed);
                }
                if clear.is_some() && !self.published.contains(name) {
                    return Err(Refusal::NotPublic);
                }
                Ok(Change::Nothing)
            }
            Action::Publish { vault, actor, via, blob } => {
                let (v, actor, b) = (*vault, *actor, BlobId::of(blob));
                if self.vault(v).is_none() {
                    return Err(Refusal::UnknownVault);
                }
                if self.lane.iter().any(|p| p.vault == v && p.blob == b) {
                    return Err(Refusal::AlreadyPublished);
                }
                // only the vault, or a vault holding a wide owner cap over it, publishes into its lane
                if !self.acts_via(edit.author, via, actor) {
                    return Err(Refusal::NotActing);
                }
                if !self.owns_lane(actor, v) {
                    return Err(Refusal::NoCap);
                }
                Ok(Change::Publish(Published { vault: v, blob: b, bytes: blob.as_slice().into() }))
            }
            Action::Checkpoint { entry, covers } => {
                // a device vouches for its own accepted writes of the entry, and changes nothing
                let own = |c: &EditId| self.write(*c).is_some_and(|w| w.author == edit.author && w.entry == *entry);
                if covers.is_empty() || !covers.iter().all(own) {
                    return Err(Refusal::NotOwnWrite);
                }
                Ok(Change::Nothing)
            }
        }
    }

    /// Make the change `check` worked out.
    fn commit(&mut self, change: Change) -> Touch {
        match change {
            Change::Nothing => Touch::Nothing,
            Change::Genesis(vt, keys) => {
                let v = vt.id;
                Arc::make_mut(&mut self.vault_at).insert(v, self.vaults.len());
                Arc::make_mut(&mut self.vaults).push(vt);
                if !keys.is_empty() {
                    Arc::make_mut(&mut self.seal_keys).extend(keys);
                }
                Touch::Grew(vec![KeyFam::Seed(v)])
            }
            Change::AddOwner { at, owner, seal_to } => {
                let vt = &mut Arc::make_mut(&mut self.vaults)[at];
                vt.owners.push(owner);
                let v = vt.id;
                if let Some((s, key)) = seal_to {
                    Arc::make_mut(&mut self.seal_keys).insert(s, key);
                }
                Touch::Grew(vec![KeyFam::Seed(v)])
            }
            Change::RemoveOwner { at, owner } => {
                let vt = &mut Arc::make_mut(&mut self.vaults)[at];
                let i = vt.owners.iter().position(|&p| p == owner).expect("an owner");
                vt.owners.remove(i);
                vt.threshold = vt.threshold.min(vt.owners.len() as u32);
                Touch::Nothing
            }
            Change::SetThreshold { at, threshold } => {
                Arc::make_mut(&mut self.vaults)[at].threshold = threshold;
                Touch::Nothing
            }
            Change::AddDevice { at, device, seal_to } => {
                let vt = &mut Arc::make_mut(&mut self.vaults)[at];
                vt.devices.push(device);
                let v = vt.id;
                if let Some(key) = seal_to {
                    Arc::make_mut(&mut self.seal_keys).insert(device, key);
                }
                Touch::Grew(vec![KeyFam::Seed(v)])
            }
            Change::RemoveDevice { at, device } => {
                let vt = &mut Arc::make_mut(&mut self.vaults)[at];
                let i = vt.devices.iter().position(|&d| d == device).expect("a device");
                vt.devices.remove(i);
                Touch::Nothing
            }
            Change::SetRoot { at, root } => {
                Arc::make_mut(&mut self.vaults)[at].root = root;
                Touch::Nothing
            }
            Change::Cap(issued) => {
                let (c, v, i) = (issued.id, issued.cap.over, self.caps.len());
                // a new cap with read or more has a key, and a wide one reaches every cell in use; no cell in use holds
                // a cap that didn't exist yet
                let mut grew = vec![];
                if issued.cap.role.allows(Role::Read) {
                    grew.push(KeyFam::Cap(v, c));
                    if issued.cap.wide {
                        let mut seen = HashSet::new();
                        let cells = self.entries.iter().filter(|en| en.vault == v).map(|en| en.cell());
                        grew.extend(cells.filter(|x| seen.insert(*x)).map(|x| KeyFam::Cell(v, x)));
                    }
                }
                if let Grantee::Principal(Principal::Vault(g)) = issued.cap.grantee {
                    Arc::make_mut(&mut self.held).entry(g).or_default().push(i);
                }
                Arc::make_mut(&mut self.over).entry(v).or_default().push(i);
                Arc::make_mut(&mut self.cap_at).insert(c, i);
                Arc::make_mut(&mut self.caps).push(issued);
                Touch::Grew(grew)
            }
            Change::Revoke(ending) => {
                let revoked = Arc::make_mut(&mut self.revoked);
                for c in ending {
                    revoked.push(c);
                }
                Touch::Nothing
            }
            Change::Create(en, w, caps) => {
                let (e, v, cell, i) = (en.id, en.vault, en.cell(), self.entries.len());
                Arc::make_mut(&mut self.cells).entry(cell).or_insert(caps);
                let fresh = self.enter(v, cell);
                Arc::make_mut(&mut self.born).push(e);
                Arc::make_mut(&mut self.entry_at).insert(e, i);
                Arc::make_mut(&mut self.entries).push(en);
                self.add_write(w);
                Touch::Created { entry: i, fresh }
            }
            Change::Write(w, retag) => {
                if retag {
                    let at = self.entry_at[&w.entry];
                    Arc::make_mut(&mut self.entries)[at].retags.push(w.edit);
                }
                Touch::Wrote(self.add_write(w))
            }
            Change::Move { at, stay, to, caps } => {
                let (v, from) = (self.entries[at].vault, self.entries[at].cell());
                Arc::make_mut(&mut self.cells).entry(to).or_insert(caps);
                self.leave(from);
                let fresh = self.enter(v, to);
                Arc::make_mut(&mut self.entries)[at].stays.push((Some(stay), to));
                Touch::Moved { entry: at, fresh }
            }
            Change::Publish(p) => {
                Arc::make_mut(&mut self.lane).push(p);
                Touch::Nothing
            }
        }
    }

    /// One more entry in cell `x` of vault `v`: whether the cell was empty before.
    fn enter(&mut self, v: VaultId, x: CellId) -> bool {
        let n = &mut Arc::make_mut(&mut self.in_use).entry(x).or_insert((v, 0)).1;
        *n += 1;
        *n == 1
    }

    /// One entry fewer in cell `x`.
    fn leave(&mut self, x: CellId) {
        let in_use = Arc::make_mut(&mut self.in_use);
        if let Some((_, n)) = in_use.get_mut(&x) {
            *n -= 1;
            if *n == 0 {
                in_use.remove(&x);
            }
        }
    }

    /// Add an accepted write: its place.
    fn add_write(&mut self, w: Write) -> usize {
        let i = self.writes.len();
        Arc::make_mut(&mut self.write_at).insert(w.edit, i);
        Arc::make_mut(&mut self.by_entry).entry(w.entry).or_default().push(i);
        Arc::make_mut(&mut self.writes).push(w);
        i
    }

    /// After a removal: drop every write the removal took the authorization from, unless it stays anyway (`stays`, by
    /// place: the remover had seen it, or it was unauthorized already), and every write that builds on a dropped one;
    /// an entry whose creation is dropped goes with all its writes. Revocation wins over what it had not seen.
    fn drop_unseen(&mut self, stays: &[bool]) {
        let mut kept: Vec<Write> = Vec::with_capacity(self.writes.len());
        // the entry of each write kept so far: a write stays only if what it builds on stayed (T14)
        let mut kept_in: HashMap<EditId, EntryId> = HashMap::with_capacity(self.writes.len());
        for (w, &stays) in self.writes.iter().zip(stays) {
            if (stays || self.authorized(w)) && w.deps.iter().all(|d| kept_in.get(d) == Some(&w.entry)) {
                kept_in.insert(w.edit, w.entry);
                kept.push(w.clone());
            }
        }
        if kept.len() == self.writes.len() {
            return;
        }
        let created: HashSet<EntryId> = kept.iter().filter(|w| w.first).map(|w| w.entry).collect();
        let entries: Vec<Entry> = self.entries.iter().filter(|en| created.contains(&en.id)).cloned().collect();
        kept.retain(|w| created.contains(&w.entry));
        self.entries = Arc::new(entries);
        self.writes = Arc::new(kept);
        self.index_entries();
    }

    /// Index the entries and the writes again, and count the cells in use.
    fn index_entries(&mut self) {
        self.entry_at = Arc::new(self.entries.iter().enumerate().map(|(i, en)| (en.id, i)).collect());
        self.write_at = Arc::new(self.writes.iter().enumerate().map(|(i, w)| (w.edit, i)).collect());
        let mut by_entry: HashMap<EntryId, Vec<usize>> = HashMap::new();
        for (i, w) in self.writes.iter().enumerate() {
            by_entry.entry(w.entry).or_default().push(i);
        }
        self.by_entry = Arc::new(by_entry);
        let mut in_use: HashMap<CellId, (VaultId, usize)> = HashMap::new();
        for en in self.entries.iter() {
            in_use.entry(en.cell()).or_insert((en.vault, 0)).1 += 1;
        }
        self.in_use = Arc::new(in_use);
    }

    /* Settling the keys */

    /// After a change that removed nothing: seal what it added, link what it wrote. Every holder that opened a current
    /// key of a family in use was entitled to it (T6), and outside removals no entitlement shrinks, so no key goes
    /// stale but a cell's that comes back into use: while it was empty its key didn't move on with the removals.
    fn settle(&mut self, touch: Touch, id: EditId) {
        match touch {
            Touch::Nothing => {}
            Touch::Grew(fams) => self.seal_fams(&fams),
            Touch::Created { entry, fresh } | Touch::Moved { entry, fresh } => {
                let en = &self.entries[entry];
                let k = KeyFam::Cell(en.vault, en.cell());
                if fresh && self.seals.secrets.contains(&self.current(k)) {
                    self.bump(k, id);
                }
                self.seal_fams(&[k]);
                let seals = Arc::make_mut(&mut self.seals);
                let ws = self.by_entry.get(&self.entries[entry].id).into_iter().flatten().map(|&i| &self.writes[i]);
                link(seals, &self.epochs, &self.entries[entry], ws);
            }
            Touch::Wrote(i) => {
                let w = &self.writes[i];
                let en = &self.entries[self.entry_at[&w.entry]];
                let x = en.stay_cell(w.stay).expect("a write's stay");
                let to = KeyName::Scoped(KeyFam::Cell(en.vault, x), w.generation);
                let linked = w.stay == en.stay() || self.seals.linked.contains(&(w.key(), en.id, en.stay()));
                if !self.seals.set.contains(&Seal { secret: w.key(), to }) || !linked {
                    let seals = Arc::make_mut(&mut self.seals);
                    link(seals, &self.epochs, &self.entries[self.entry_at[&self.writes[i].entry]], [&self.writes[i]]);
                }
            }
        }
    }

    /// After a removal, or any edit in `step_full`: the model's `settle`. Rotate what went stale (`stale_keys`), then
    /// seal every current key to its targets, publish the public ones, and derive and link the entry keys. `holders`
    /// and `fams` are the holders and the families as they were before the edit; the epochs and the seals are as they
    /// were until now.
    fn settle_full(&mut self, holders: &[Holder], fams: &HashSet<KeyFam>, id: EditId) {
        for k in self.stale_keys(holders, fams) {
            self.bump(k, id);
        }
        self.seal_fams(&self.key_fams());
        self.link_all();
    }

    /// The families whose current key some holder could open before a change but should no longer open after it, unless
    /// the family is public now: these start a new epoch. A family that stops being public is one: everyone held its
    /// key. So is a cell that comes back into use, an entry moving into it again: while it was empty its key didn't move
    /// on with the removals, so whoever a removal took out then may still open it. A vault's cap and cell keys are
    /// derived from its seed, so when the seed starts a new generation they all start a new epoch too. Called after the
    /// change, with the holders and the families from before it, while the epochs and the seals are still as they were.
    fn stale_keys(&self, holders: &[Holder], before: &HashSet<KeyFam>) -> Vec<KeyFam> {
        let fams = self.key_fams();
        let current: HashMap<KeyName, KeyFam> = fams.iter().map(|&k| (self.current(k), k)).collect();
        let mut stale: HashSet<KeyFam> = HashSet::new();
        for &h in holders {
            for key in self.opens_fams(h.start(self)) {
                if let Some(&k) = current.get(&key)
                    && !stale.contains(&k)
                    && !self.public_key(k)
                    && !h.entitled(self, k)
                {
                    stale.insert(k);
                }
            }
        }
        for &k in &fams {
            if !before.contains(&k) && self.seals.secrets.contains(&self.current(k)) {
                stale.insert(k);
            }
        }
        let seeds: HashSet<VaultId> = stale
            .iter()
            .filter_map(|k| match k {
                KeyFam::Seed(v) => Some(*v),
                _ => None,
            })
            .collect();
        fams.into_iter()
            .filter(|k| {
                stale.contains(k)
                    || match k {
                        KeyFam::Cap(v, _) | KeyFam::Cell(v, _) => seeds.contains(v),
                        KeyFam::Seed(_) => false,
                    }
            })
            .collect()
    }

    /// Start a new epoch of `k`, moved on by edit `by`. The old key is sealed to the new one, so whoever may read now
    /// can read the history.
    fn bump(&mut self, k: KeyFam, by: EditId) {
        let e = self.epoch(k);
        Arc::make_mut(&mut self.epochs).insert(k, e + 1);
        Arc::make_mut(&mut self.moved).insert((k, e + 1), by);
        Arc::make_mut(&mut self.seals).add(Seal { secret: KeyName::Scoped(k, e), to: KeyName::Scoped(k, e + 1) });
    }

    /// Seal the current key of each family `fams` to each of its targets, and publish it if it is public.
    fn seal_fams(&mut self, fams: &[KeyFam]) {
        for &k in fams {
            let secret = self.current(k);
            for to in self.targets(k) {
                let s = Seal { secret, to };
                // the seals are shared with the states before; copy them only to add one
                if !self.seals.set.contains(&s) {
                    Arc::make_mut(&mut self.seals).add(s);
                }
            }
            if self.public_key(k) && !self.published.contains(&secret) {
                Arc::make_mut(&mut self.published).push(secret);
            }
        }
    }

    /// The model's `linkAll`: every entry's key in its current stay derives from its cell's current key, and the key
    /// each accepted write used from its stay's cell key of that generation; the key of each write from an earlier stay
    /// is wrapped under the current stay's key, unless it already is under some key of that stay.
    fn link_all(&mut self) {
        let seals = Arc::make_mut(&mut self.seals);
        for en in self.entries.iter() {
            let ws = self.by_entry.get(&en.id).into_iter().flatten().map(|&i| &self.writes[i]);
            link(seals, &self.epochs, en, ws);
        }
    }

    /// The state with the facts `fs` taken away: what an edit that a removal after it hadn't seen is checked against.
    pub fn hide(&self, fs: &[Fact]) -> State {
        let mut st = self.clone();
        if fs.is_empty() {
            return st;
        }
        if fs.iter().any(|f| matches!(f, Fact::Owner(..) | Fact::Device(..) | Fact::Root(_))) {
            for vt in Arc::make_mut(&mut st.vaults).iter_mut() {
                let id = vt.id;
                vt.owners.retain(|&p| !fs.contains(&Fact::Owner(id, p)));
                vt.devices.retain(|&d| !fs.contains(&Fact::Device(id, d)));
                if fs.contains(&Fact::Root(id)) {
                    vt.root = None;
                }
            }
        }
        for f in fs {
            match f {
                Fact::Cap(c) => Arc::make_mut(&mut st.revoked).push(*c),
                Fact::Cell(e, caps) => st.narrow.push((*e, caps.clone())),
                _ => {}
            }
        }
        st
    }

    /// Edit `edit`, whose id is `id`, would be accepted here.
    pub fn accepts(&self, edit: &Edit, id: EditId) -> Result<(), Refusal> {
        self.check(edit, id).map(drop)
    }
}

/// Everything the keys `start` open through the seals `by_to` (each key with the keys sealed to it).
fn reach(by_to: &HashMap<KeyName, Vec<KeyName>>, start: impl Iterator<Item = KeyName>) -> HashSet<KeyName> {
    let mut open: HashSet<KeyName> = start.collect();
    let mut todo: Vec<KeyName> = open.iter().copied().collect();
    while let Some(k) = todo.pop() {
        for &s in by_to.get(&k).into_iter().flatten() {
            if open.insert(s) {
                todo.push(s);
            }
        }
    }
    open
}

/// The model's `linkAll` for one entry `en` and its writes `ws`: its key in its current stay derives from its cell's
/// current key, each write's key from its stay's cell key of its generation, and the key of a write from an earlier
/// stay is wrapped under the current stay's key, unless some key of that stay already wraps it. So whoever reads an
/// entry now reads its whole history, and a move hands nobody a key of the cell the entry left (T24).
fn link<'a>(seals: &mut Seals, epochs: &HashMap<KeyFam, u64>, en: &Entry, ws: impl IntoIterator<Item = &'a Write>) {
    let epoch = |k: KeyFam| epochs.get(&k).copied().unwrap_or(0);
    let cell = KeyFam::Cell(en.vault, en.cell());
    let key = KeyName::Entry(en.id, en.stay(), epoch(cell));
    seals.add(Seal { secret: key, to: KeyName::Scoped(cell, epoch(cell)) });
    for w in ws {
        let x = en.stay_cell(w.stay).unwrap_or_else(|| CellId::of(en.vault, &[]));
        seals.add(Seal { secret: w.key(), to: KeyName::Scoped(KeyFam::Cell(en.vault, x), w.generation) });
        if w.stay != en.stay() && !seals.linked.contains(&(w.key(), en.id, en.stay())) {
            seals.add(Seal { secret: w.key(), to: key });
        }
    }
}

/// What an entry's readers and its vault's stewards read where no relay can: each cap's selector, opened from its
/// sealed `select`; each entry's header and each write's tags, from inside the writes' bodies.
#[derive(Clone, Debug, Default)]
pub struct Readings {
    pub selectors: HashMap<CapId, Selector>,
    /// By the edit that created the entry.
    pub headers: HashMap<EditId, Header>,
    /// By the write.
    pub tags: HashMap<EditId, TagDelta>,
}

/// What an entry means to its readers (`State::meaning`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Meaning {
    /// What its first write says of it, and its tags now.
    pub attrs: Attrs,
    /// Its creator was the vault itself, or created it inside the slice of a cap it created it through.
    pub admitted: bool,
    /// Its semantic cell: the live caps over its vault that aren't wide and whose slice holds it, in canonical order;
    /// none for an entry its creator made outside its own slice.
    pub cell: Vec<CapId>,
    /// Where a steward moves it: nowhere while the live part of its cell is its semantic cell (a revoked cap left in it
    /// is ignored, so a revocation moves no entry), else to its semantic cell.
    pub desired: Option<Vec<CapId>>,
}

/// The edits a peer counts once it no longer trusts the curves, so neither ed25519 nor P-256: every edit but a write,
/// as each carries the hash-based half of its signatures too, and each write that a checkpoint by its own author
/// covers. Removals cut what a forger signs on an old copy of the log (T16), so whoever broke a device's ed25519 key
/// still writes nothing a checkpoint didn't cover.
pub fn checkpointed(edits: &[Edit]) -> Vec<Edit> {
    let covered: HashSet<(SignerId, EditId)> = edits
        .iter()
        .filter_map(|edit| match &edit.action {
            Action::Checkpoint { covers, .. } => Some(covers.iter().map(|&c| (edit.author, c))),
            _ => None,
        })
        .flatten()
        .collect();
    edits
        .iter()
        .filter(|edit| !matches!(edit.action, Action::Write { .. }) || covered.contains(&(edit.author, edit.id())))
        .cloned()
        .collect()
}

/// Write `w` builds only on writes of its own entry among `ws`.
fn deps_in<W: AsRef<Write>>(ws: &[W], w: &Write) -> bool {
    w.deps.iter().all(|d| ws.iter().map(AsRef::as_ref).any(|x| x.edit == *d && x.entry == w.entry))
}

/// Write `w` may follow the writes `ws`: it builds only on writes of its own entry among them (`UnknownDep`), and a
/// write on a proposal on the write that started it or another write on it (`NotOnProposal`).
pub fn builds_on<W: AsRef<Write>>(ws: &[W], w: &Write) -> Result<(), Refusal> {
    if !deps_in(ws, w) {
        return Err(Refusal::UnknownDep);
    }
    if !on_proposal(ws, w) {
        return Err(Refusal::NotOnProposal);
    }
    Ok(())
}

/// Write `w` extends its line: the main line and a new proposal need nothing more; a write on proposal `b` builds on
/// the write of its own entry that started `b`, or on another write on `b`.
fn on_proposal<W: AsRef<Write>>(ws: &[W], w: &Write) -> bool {
    let ws = || ws.iter().map(AsRef::as_ref);
    match w.proposal {
        Proposal::On(b) => {
            ws().any(|x| x.edit == b && x.proposal == Proposal::New && x.entry == w.entry)
                && w.deps.iter().any(|&d| d == b || ws().any(|x| x.edit == d && x.proposal == Proposal::On(b)))
        }
        Proposal::Main | Proposal::New => true,
    }
}

/// The history of line `line` among one entry's writes `ws`, in their order: the line's own writes and every write
/// they build on (`Proposals.lean`'s `history`). Each write comes after what it builds on, so one pass from the end
/// collects them.
pub fn history<'a, W: AsRef<Write> + 'a>(ws: impl DoubleEndedIterator<Item = &'a W>, line: Line) -> Vec<&'a W> {
    let mut needed: HashSet<EditId> = HashSet::new();
    let mut out = vec![];
    for x in ws.rev() {
        let w = x.as_ref();
        if w.line() == line || needed.contains(&w.edit) {
            needed.extend(w.deps.iter().copied());
            out.push(x);
        }
    }
    out.reverse();
    out
}

/// The writes of `h` that no write of `h` builds on.
pub fn tips<W: AsRef<Write>>(h: &[&W]) -> Vec<EditId> {
    let built_on: HashSet<EditId> = h.iter().flat_map(|w| w.as_ref().deps.iter().copied()).collect();
    h.iter().map(|w| w.as_ref().edit).filter(|edit| !built_on.contains(edit)).collect()
}

/// The one order every peer replays in: causal depth, then removals first, then id. Each edit appears once. An edit
/// that claims to be no deeper than a parent the peer holds is malformed and left out, so no edit sorts ahead of its
/// own past.
pub fn order(edits: &[Edit]) -> Vec<Edit> {
    order_ids(edits, &ids(edits)).0
}

/// Each edit's id.
fn ids(edits: &[Edit]) -> Vec<EditId> {
    edits.iter().map(Edit::id).collect()
}

/// `order`, given each edit's id (`ids[i]` is `edits[i]`'s), and the ids in the order too: a replay hashes each edit
/// once.
fn order_ids(edits: &[Edit], ids: &[EditId]) -> (Vec<Edit>, Vec<EditId>) {
    let mut by_id: HashMap<EditId, &Edit> = HashMap::with_capacity(edits.len());
    for (edit, &id) in edits.iter().zip(ids) {
        by_id.entry(id).or_insert(edit);
    }
    let mut out: Vec<(u64, u8, EditId, &Edit)> = by_id
        .iter()
        .filter(|(_, edit)| edit.parents.iter().all(|p| by_id.get(p).is_none_or(|parent| parent.depth < edit.depth)))
        .map(|(&id, &edit)| (edit.depth, edit.rank(), id, edit))
        .collect();
    out.sort_by_key(|a| (a.0, a.1, a.2));
    out.into_iter().map(|(.., id, edit)| (edit.clone(), id)).unzip()
}

/// The caps the edits issue, each with its parent, among edits paired with their ids.
fn caps_issued<'a>(edits: impl Iterator<Item = (&'a Edit, EditId)>) -> Vec<(CapId, Option<CapId>)> {
    edits
        .filter_map(|(o, id)| match &o.action {
            Action::Cap(c, _) => Some((CapId::from(id), c.parent)),
            _ => None,
        })
        .collect()
}

/// What removal `r` takes away: the owner, the device, the root, among the caps the edits `edits` issue the cap and
/// every cap resting on it, or for a move the cell the entry no longer is in.
pub fn removes(edits: &[Edit], r: &Edit) -> Vec<Fact> {
    removes_among(r, || caps_issued(edits.iter().map(|o| (o, o.id()))))
}

/// `removes`, the caps issued (`caps_issued`) worked out only for a revocation.
fn removes_among(r: &Edit, caps: impl FnOnce() -> Vec<(CapId, Option<CapId>)>) -> Vec<Fact> {
    match &r.action {
        Action::RemoveOwner { vault, owner, .. } => vec![Fact::Owner(*vault, *owner)],
        Action::RemoveDevice { vault, device, .. } => vec![Fact::Device(*vault, *device)],
        Action::SetRoot { vault, .. } => vec![Fact::Root(*vault)],
        Action::Revoke { cap, .. } => {
            let cs = caps();
            let parent: HashMap<CapId, Option<CapId>> = cs.iter().rev().copied().collect();
            let rests_on = |x: CapId| {
                let mut x = x;
                for _ in 0..=cs.len() {
                    if x == *cap {
                        return true;
                    }
                    match parent.get(&x).copied().flatten() {
                        Some(p) => x = p,
                        None => return false,
                    }
                }
                false
            };
            cs.iter().filter(|(id, _)| rests_on(*id)).map(|(id, _)| Fact::Cap(*id)).collect()
        }
        Action::Move { entry, to, .. } => vec![Fact::Cell(*entry, to.as_slice().into())],
        _ => vec![],
    }
}

/// A removal among the edits being replayed: its position, the edits it keeps, and what it takes away.
struct Cut {
    at: usize,
    keep: HashSet<EditId>,
    facts: Vec<Fact>,
}

/// One replay of edits already in `order`, with the removals `rem` and no others: an edit stands if the state before it
/// accepts it, and again with what each later removal that hadn't seen it takes away hidden. Which edits stood, and the
/// state at the end; with `states`, every state along the way too.
struct Run {
    stood: Vec<bool>,
    state: State,
    states: Vec<State>,
}

fn run(edits: &[Edit], ids: &[EditId], rem: &HashSet<EditId>, states: bool) -> Run {
    let caps = std::cell::OnceCell::new();
    let caps = || caps.get_or_init(|| caps_issued(edits.iter().zip(ids.iter().copied()))).clone();
    let cuts: Vec<Cut> = edits
        .iter()
        .enumerate()
        .filter(|(i, _)| rem.contains(&ids[*i]))
        .map(|(at, r)| Cut { at, keep: r.action.keep().unwrap_or(&[]).iter().copied().collect(), facts: removes_among(r, caps) })
        .collect();
    let mut out = Run { stood: Vec::with_capacity(edits.len()), state: State::default(), states: vec![] };
    if states {
        out.states.push(State::default());
    }
    for (i, edit) in edits.iter().enumerate() {
        let id = ids[i];
        let mut stands = !edit.is_removal() || rem.contains(&id);
        if stands {
            let hidden: Vec<Fact> =
                cuts.iter().filter(|c| c.at > i && !c.keep.contains(&id)).flat_map(|c| c.facts.iter().cloned()).collect();
            if !hidden.is_empty() {
                stands = out.state.hide(&hidden).check(edit, id).is_ok();
            }
            if stands {
                stands = out.state.step_mut(edit, id).is_ok();
            }
        }
        out.stood.push(stands);
        if states {
            out.states.push(out.state.clone());
        }
    }
    out
}

/// Who stands when removals clash, the smallest first. Vault removals come before revocations, and a vault's removals
/// before those of the coops it owns (`tier`), since a coop's removals rest on its owners' approval and never the other
/// way round. Within a vault: its root, then its owners by seniority, their place among the owners where no removal has
/// happened yet, then removals no owner approved. Revocations follow, the most senior revoker first: the vault the cap
/// is over, then whoever issued a cap higher up the chain of the cap revoked, since a cap falls with the cap it rests
/// on. Moves come last: a steward's upkeep. So a removal is only ever kept out by one that ranks above it, and what
/// ranks above it never rests on what it takes away.
fn priority(base: &State, edit: &Edit) -> (u8, usize, u8, usize) {
    match &edit.action {
        Action::RemoveOwner { vault, .. } | Action::RemoveDevice { vault, .. } | Action::SetRoot { vault, .. } => {
            let tier = base.tier(*vault);
            match base.vault(*vault) {
                None => (0, tier, 2, 0),
                Some(vt) => {
                    let sigs: Vec<SignerId> = edit.sigs().collect();
                    if vt.root.is_some_and(|r| sigs.contains(&r)) {
                        (0, tier, 0, 0)
                    } else if let Some(i) = vt.owners.iter().position(|&p| base.approves(&sigs, p)) {
                        (0, tier, 1, i)
                    } else {
                        (0, tier, 2, 0)
                    }
                }
            }
        }
        Action::Revoke { cap, actor, .. } => (1, base.cap(*cap).map_or(0, |c| base.seniority(*actor, c)), 0, 0),
        Action::Move { .. } => (2, 0, 0, 0),
        _ => (3, 0, 0, 0),
    }
}

/// The removals that stand among edits already in `order`, chosen one by one by priority: each stands if the edits
/// replayed with it and the ones chosen before it accept it and keep accepting those.
fn resolve(edits: &[Edit], ids: &[EditId]) -> HashSet<EditId> {
    let mut rem = HashSet::new();
    if !edits.iter().any(Edit::is_removal) {
        return rem;
    }
    let base = run(edits, ids, &rem, false).state;
    let mut cands: Vec<usize> = (0..edits.len()).filter(|&i| edits[i].is_removal()).collect();
    cands.sort_by_key(|&i| priority(&base, &edits[i]));
    for r in cands {
        let mut trial = rem.clone();
        trial.insert(ids[r]);
        let stood = run(edits, ids, &trial, false).stood;
        if (0..edits.len()).all(|i| !trial.contains(&ids[i]) || stood[i]) {
            rem = trial;
        }
    }
    rem
}

/// A peer's replay of the edits it holds: the one order, which edits stand, and what it knows.
pub struct Replay {
    pub edits: Vec<Edit>,
    /// Each edit's id, `ids[i]` being `edits[i]`'s.
    pub ids: Vec<EditId>,
    pub stood: Vec<bool>,
    pub state: State,
}

impl Replay {
    /// The ids of the edits that stand, in replay order.
    pub fn standing(&self) -> Vec<EditId> {
        self.ids.iter().zip(&self.stood).filter(|(_, s)| **s).map(|(id, _)| *id).collect()
    }
}

pub fn replay(edits: &[Edit]) -> Replay {
    replay_ids(edits, &ids(edits))
}

/// `replay`, given each edit's id.
fn replay_ids(edits: &[Edit], ids: &[EditId]) -> Replay {
    let (edits, ids) = order_ids(edits, ids);
    let rem = resolve(&edits, &ids);
    let Run { stood, state, .. } = run(&edits, &ids, &rem, false);
    Replay { edits, ids, stood, state }
}

/// What a peer holding `edits` knows: their replay in `order` from the empty state, refused edits skipped, every
/// removal cutting what it hadn't seen.
pub fn view(edits: &[Edit]) -> State {
    replay(edits).state
}

/// Every state along the replay of `edits` in `order`, the empty state first and the view last.
pub fn trace(edits: &[Edit]) -> Vec<State> {
    let (edits, ids) = order_ids(edits, &ids(edits));
    let rem = resolve(&edits, &ids);
    run(&edits, &ids, &rem, true).states
}

/// A peer's edits. Each edit appended builds on the frontier of its own log and sorts after everything the peer holds;
/// edits from other peers are added as they arrive.
#[derive(Clone, Debug, Default)]
pub struct Log {
    edits: Vec<Edit>,
    /// Each edit's id, hashed once.
    ids: Vec<EditId>,
}

impl Log {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn edits(&self) -> &[Edit] {
        &self.edits
    }

    /// Each edit's id, `ids()[i]` being `edits()[i]`'s.
    pub fn ids(&self) -> &[EditId] {
        &self.ids
    }

    pub fn view(&self) -> State {
        self.replay().state
    }

    /// The replay of the log's edits.
    pub fn replay(&self) -> Replay {
        replay_ids(&self.edits, &self.ids)
    }

    /// A log holding `edits`, as a peer that received them.
    pub fn from_edits(edits: Vec<Edit>) -> Self {
        let ids = ids(&edits);
        Self { edits, ids }
    }

    /// The edit `author` and `cosigners` would sign here, unchecked: what a peer that skips the rules would send. It
    /// builds on the frontier of its own log (one that starts a log, a genesis or a cap, on nothing) and is one deeper
    /// than the deepest edit the log holds, so it sorts after everything this peer had seen. A write with no `deps` on
    /// the main line or a proposal builds on that line's heads. An act for a vault that names no `via` goes through the
    /// owners its author acts through (`State::via`). A removal keeps, beside what its `keep` names, every edit of the
    /// log that stands now and that it would cut otherwise: an honest device keeps all it had seen.
    pub fn draft(&self, author: SignerId, cosigners: &[SignerId], action: Action) -> Edit {
        let depth = self.edits.iter().map(|o| o.depth.saturating_add(1)).max().unwrap_or(0);
        let mut edit = Edit { parents: vec![], depth, author, cosigners: cosigners.to_vec(), action };
        if !matches!(edit.action, Action::Genesis { .. } | Action::Cap(..))
            && let Some(l) = crate::sync::log_of(&edit, EditId([0; 32]))
        {
            edit.parents = crate::sync::frontier_of(&self.edits, &self.ids, l);
        }
        let view = std::cell::OnceCell::new();
        let view = || view.get_or_init(|| self.view());
        if let Action::Write { entry, deps, proposal, create: None, .. } = &mut edit.action
            && deps.is_empty()
            && *proposal != Proposal::New
        {
            let line = if let Proposal::On(b) = *proposal { Some(b) } else { None };
            *deps = view().heads(*entry, line);
        }
        // an act for a vault its author isn't a member of names the owners it goes through
        if let Some(actor) = edit.actor()
            && edit.action.via().is_some_and(<[VaultId]>::is_empty)
            && let Some(chain) = view().via(author, actor)
        {
            *edit.action.via_mut().expect("an act for a vault") = chain;
        }
        if edit.is_removal() {
            // replayed with the removals that stand now and this one, everything that stands now must still stand
            let before = self.replay();
            let standing: HashSet<EditId> = before.standing().into_iter().collect();
            let rem: HashSet<EditId> = before
                .edits
                .iter()
                .zip(&before.ids)
                .filter(|(o, id)| o.is_removal() && standing.contains(id))
                .map(|(_, id)| *id)
                .collect();
            loop {
                let id = edit.id();
                let (mut all, mut all_ids) = (self.edits.clone(), self.ids.clone());
                all.push(edit.clone());
                all_ids.push(id);
                let (edits, ids) = order_ids(&all, &all_ids);
                let mut trial = rem.clone();
                trial.insert(id);
                let stood = run(&edits, &ids, &trial, false).stood;
                let keep = edit.action.keep_mut().expect("a removal");
                let lost: Vec<EditId> = ids
                    .iter()
                    .zip(&stood)
                    .filter(|&(id, s)| !*s && standing.contains(id) && !keep.contains(id))
                    .map(|(id, _)| *id)
                    .collect();
                if lost.is_empty() {
                    break;
                }
                keep.extend(lost);
                keep.sort();
            }
        }
        edit
    }

    /// The frontier of log `l`: what an edit of that log made here builds on.
    pub fn frontier(&self, l: crate::sync::LogId) -> Vec<EditId> {
        crate::sync::frontier_of(&self.edits, &self.ids, l)
    }

    /// The edit `append` would add, if the view accepts it.
    pub fn check(&self, author: SignerId, cosigners: &[SignerId], action: Action) -> Result<Edit, Refusal> {
        let edit = self.draft(author, cosigners, action);
        self.view().accepts(&edit, edit.id())?;
        Ok(edit)
    }

    /// Append an edit signed by `author` and `cosigners`, if the view accepts it.
    pub fn append(&mut self, author: SignerId, cosigners: &[SignerId], action: Action) -> Result<EditId, Refusal> {
        let edit = self.check(author, cosigners, action)?;
        let id = edit.id();
        self.edits.push(edit);
        self.ids.push(id);
        Ok(id)
    }

    /// Add edits from a peer, each once, whether or not the view accepts them: acceptance is decided at replay.
    pub fn receive(&mut self, edits: impl IntoIterator<Item = Edit>) {
        for edit in edits {
            let id = edit.id();
            if !self.ids.contains(&id) {
                self.edits.push(edit);
                self.ids.push(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_role_includes_the_ones_before_it() {
        assert!(Role::Owner.allows(Role::Read) && Role::Write.allows(Role::Write) && Role::Read.allows(Role::Relay));
        assert!(!Role::Relay.allows(Role::Read) && !Role::Read.allows(Role::Write));
    }

    #[test]
    fn an_edit_never_sorts_ahead_of_a_parent_it_holds() {
        let passkey = SignerId::from_u64(1);
        let mut log = Log::new();
        let genesis =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: None, nonce: 0, seal_to: vec![] };
        let v = VaultId::from(log.append(passkey, &[], genesis).unwrap());
        let honest = log.draft(passkey, &[SignerId::from_u64(2)], Action::AddDevice { vault: v, device: SignerId::from_u64(2), seal_to: None });
        assert_eq!(honest.depth, 1);
        // an edit claiming to be no deeper than its parent is left out where the parent is held…
        let shallow = Edit { depth: 0, ..honest.clone() };
        let with_parent = [log.edits()[0].clone(), shallow.clone(), honest.clone()];
        assert_eq!(order(&with_parent).iter().filter(|o| **o == shallow).count(), 0);
        assert_eq!(order(&with_parent).last(), Some(&honest));
        // …and orders by what it claims where it isn't, as it does on every peer missing that parent
        assert_eq!(order(std::slice::from_ref(&shallow)), vec![shallow]);
    }

    #[test]
    fn a_cell_is_canonical_when_its_caps_are_sorted_once() {
        let (a, b) = (CapId::from_u64(1), CapId::from_u64(2));
        assert!(canonical(&[]) && canonical(&[a]) && canonical(&[a, b]));
        assert!(!canonical(&[b, a]) && !canonical(&[a, a]));
        assert_eq!(mk_cell(&[b, a, b]), vec![a, b]);
    }
}
