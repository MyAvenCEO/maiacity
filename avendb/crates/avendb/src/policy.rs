//! The rules every peer applies, edit for edit the Lean model (`avendb/spec/AvenDB/State.lean` and `Step.lean`): who
//! acts for which vault, who governs it, which shares a vault holds and which audiences they reach, which edits are
//! accepted, the key schedule, and how a removal cuts what it hadn't seen.
//!
//! Two layers, as in the model. The operational one is everything here: it reads nothing a relay can't see (no
//! selector, no type, no tag), so the server applies exactly these rules (T25). An entry sits in an audience, the
//! shares that select it, named on the wire by the hash of its vault and those shares (`AudienceId::of`); a share
//! reaches an entry when it is in the entry's audience or is wide. The semantic layer, what a share's selector picks
//! and what an entry's header and tags say, is known only to an entry's readers and the vault's own devices, the
//! stewards, who keep every entry in the audience its meaning asks for, and marked with the keep shares that pick it,
//! by marking it (`Action::Mark`, `Meaning`, T23).
//!
//! A keep share names one device of its issuer, with level `Keep` and a mode (`KeepMode`): it grants nothing, and says
//! which entries of the vault it is over that device syncs, and how (`State::wants`, `State::keeps`, T28). Nothing
//! rests on one, no audience holds one, and no mark asks whether the keep shares it names are live, so its revocation,
//! by its issuer alone, cuts nothing (`removes`, K1).
//!
//! A share is a name and the ops its grantee may make (`rules`): its ops travel sealed in its slice, and only the
//! commitment to them is in the clear, in its `select`, with its level, their class. So no rule here reads them: a
//! write is accepted by its writer's shares' levels, and its readers, who read its proof and what it touches, count it
//! or not (`State::lets`, `State::uncounted`; C1 to C4).
//!
//! Edits reach this module already verified: an edit's author and cosigners are the signers whose signatures checked
//! out (`sign::Signed::verify`). Where the core differs from the model: what an edit creates (a vault, a share) is
//! named by that edit's id, and an entry by the hash of its vault, its creator and its creation's nonce, which
//! `Signed::verify` checks, where the model picks numbers; an audience is named by its id, and the shares of every
//! audience the state has met are kept beside (`audience_shares`); an entry's stays are kept oldest first, where the
//! model puts the current one first; a refused edit says why, where the model only says no; and edits carry what the
//! model leaves out, which no rule reads: the keys signers have keys sealed to, the boxes of a `Keys` edit, a share's
//! sealed selector, and a write's ciphertext, whose plaintext holds the entry's header and tags.
//!
//! The key schedule is the model's too: each family's epoch, every seal (which key may open which) and every published
//! key. Real keys follow it: a `Keys` edit carries real boxes, and a peer accepts it only if each box is a seal of the
//! schedule, so what a device can really open is never more than what the schedule lets it (T5, T6, T24).
//!
//! A replay steps one state in place (`State::step_mut`), so a write costs what it adds, not a copy of everything
//! before it. After an edit that removes nothing, `settle` touches only what the edit touched: the family it adds or
//! grows, the audience an entry goes to, the write it links. That is the model's `settle` because of T6: in every
//! reachable state a holder opens the current key of a family in use only while entitled to it, and outside removals
//! every entitlement only grows, so the only key that goes stale is an audience's that comes back into use. A removal
//! runs the model's `settle` in full (`stale_keys`).

use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::sync::Arc;

use crate::id::{AudienceId, BlobId, EditId, EntryId, ShareId, SignerId, VaultId};
use crate::keys::{KeyBox, KeyFam, KeyId, KeyName, PublicKey, Seal};
use crate::rules::{self, Grant, Proof};
use crate::sealed::FileRoot;
use crate::slice::{Attrs, Header, Select, Selector, TagDelta};
use crate::wire::Wire;

/// A vault is an identity, like a smart account, of one of four kinds. What each kind may be is one row of the kind
/// table (`Kind::rules`), the model's `Kind.rules`, which every rule and the page read.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    /// A person's vault: owned by signers, their passkeys, with the person's devices, which act for it.
    Human,
    /// A vault owned together by human and coop vaults: a cooperative, a company, a household. It has no devices and
    /// acts through its owners.
    Coop,
    /// A coop's own agent: owned by that coop alone, one to a coop (Samuel 2026-10-18: one aven per coop, none per
    /// person). It lives on its server, its device, which acts for it but never governs it; its coop's owners act for
    /// it through the coop. It owns nothing: an agent session reaches it through its server, with its rights.
    Aven,
    /// A vault for the devices of one machine, a studio worker or a drive: owned by exactly one human or coop vault,
    /// and owning nothing. Its devices act for it but never govern it.
    DeviceVault,
}

/// Who may own a vault of a kind: signers, the passkeys of a person, or vaults of the kinds listed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OwnedBy {
    Signers,
    Vaults(&'static [Kind]),
}

/// A kind's row of the kind table: who may own a vault of the kind, how many owners it has at most (`None`: any
/// number), whether it holds devices, and how many vaults of the kind one owner may own (`None`: any number).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct KindRules {
    pub owned_by: OwnedBy,
    pub most: Option<usize>,
    pub devices: bool,
    pub each: Option<usize>,
}

impl KindRules {
    /// A vault of the kind may have `n` owners: no more than the most it takes.
    pub fn takes(&self, n: usize) -> bool {
        self.most.is_none_or(|m| n <= m)
    }

    /// An owner that is a vault of kind `of`, or a signer (`None`), may own a vault of the kind.
    pub fn fits(&self, of: Option<Kind>) -> bool {
        match (self.owned_by, of) {
            (OwnedBy::Signers, None) => true,
            (OwnedBy::Vaults(ks), Some(k)) => ks.contains(&k),
            _ => false,
        }
    }
}

impl Kind {
    /// Every kind, in the order of its byte on the wire.
    pub const ALL: [Kind; 4] = [Kind::Human, Kind::Coop, Kind::Aven, Kind::DeviceVault];

    /// The kind table, defined here once: signers own human vaults, which hold devices; human and coop vaults own
    /// coops, which hold none; one coop owns an aven, which holds devices, its server, and owns one aven at most; one
    /// human or coop vault owns a device vault, which holds devices. A kind no row lists as an owner owns nothing: an
    /// aven and a device vault.
    pub const fn rules(self) -> KindRules {
        const COOP: &[Kind] = &[Kind::Human, Kind::Coop];
        const AVEN: &[Kind] = &[Kind::Coop];
        const DEVICE_VAULT: &[Kind] = &[Kind::Human, Kind::Coop];
        match self {
            Kind::Human => KindRules { owned_by: OwnedBy::Signers, most: None, devices: true, each: None },
            Kind::Coop => KindRules { owned_by: OwnedBy::Vaults(COOP), most: None, devices: false, each: None },
            Kind::Aven => KindRules { owned_by: OwnedBy::Vaults(AVEN), most: Some(1), devices: true, each: Some(1) },
            Kind::DeviceVault => {
                KindRules { owned_by: OwnedBy::Vaults(DEVICE_VAULT), most: Some(1), devices: true, each: None }
            }
        }
    }

    /// Its vaults hold devices, which act for them: human, aven and device vaults do, an aven its server; a coop acts
    /// only through its owners.
    pub fn has_devices(self) -> bool {
        self.rules().devices
    }
}

/// An owner of a vault: a signer (of a human vault) or a vault (of any other).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Principal {
    Signer(SignerId),
    Vault(VaultId),
}

/// How a device keeps what a keep share picks: it syncs the entries and keeps the files they bring whole (`Whole`),
/// syncs them and fetches a file's pieces as it reads them (`Opened`), or doesn't sync them at all (`Never`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum KeepMode {
    Whole,
    Opened,
    Never,
}

/// What a share allows; each level includes the ones before it, in the order of their rank. Keep grants nothing: a keep
/// share only says what one device of its issuer syncs, and how (`KeepMode`), and every mode has rank 0, so levels
/// compare by their rank alone. Relay only knows the vault's devices, so that its holder, a server, lets them through
/// its relay and helps them find each other: it receives none of the entries. Backup also stores and forwards the
/// ciphertext of the entries a share reaches, and gets no key: the server's level by default. Owner also issues shares
/// on its slice and is governance.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Level {
    Keep(KeepMode),
    Relay,
    Backup,
    Read,
    Write,
    Owner,
}

impl Level {
    /// A share with this level allows what `need` allows: `need` ranks no higher. Keep allows nothing, and every
    /// level allows it, which no rule asks.
    pub fn allows(self, need: Level) -> bool {
        need.rank() <= self.rank()
    }

    /// Its rank (`Level.rank`), which is also its byte on the wire: keep 0, of any mode (its mode's byte follows it
    /// there), relay 1 to owner 5.
    pub fn rank(self) -> u8 {
        match self {
            Level::Keep(_) => 0,
            Level::Relay => 1,
            Level::Backup => 2,
            Level::Read => 3,
            Level::Write => 4,
            Level::Owner => 5,
        }
    }

    /// The level of a keep share, of any mode.
    pub fn is_keep(self) -> bool {
        matches!(self, Level::Keep(_))
    }

    /// A keep share's mode, `None` for any other level.
    pub fn mode(self) -> Option<KeepMode> {
        match self {
            Level::Keep(m) => Some(m),
            _ => None,
        }
    }
}

/// Whom a share names: a vault, everyone (read only, T8), a device, which only a keep share names, one of its issuer's
/// (T4), or an invite key: a one-time signer key its inviter makes and hands on with the invite. Until a vault claims
/// the share with that key (`Action::Claim`), nobody holds it, and from then on it names that vault.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Who {
    Vault(VaultId),
    Everyone,
    Device(SignerId),
    Invite(SignerId),
}

/// A share: `who` may make the ops its slice names on the entries of vault `over` that its selector picks, and that
/// every share it rests on picks too (T22). Its id is the id of the edit that issued it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Share {
    pub over: VaultId,
    pub who: Who,
    /// The class of its ops (`rules::level_of`), in the clear: what relays and every rule here read of them. Its
    /// readers count a write through it only where it is the class of its ops (`State::chain_allows`). A keep share's
    /// is `Keep` of its mode, and it has no ops.
    pub level: Level,
    /// It selects the whole vault, in the clear, so a peer that reads no selector knows it reaches every audience.
    pub wide: bool,
    /// Its slice, its name, selector and ops (`slice::Slice`), sealed to `over`'s vault key and the grantee's (in the
    /// clear for everyone), with the commitment to its ops in the clear (`slice::Select`). No rule here reads it: its
    /// readers do (`Readings`, `State::lets`).
    pub select: Vec<u8>,
    /// The owner share its issuer relied on; `None` when the vault itself issued it.
    pub parent: Option<ShareId>,
    pub issuer: VaultId,
    /// Keeps two shares that say the same apart.
    pub nonce: u64,
    /// The cap group of `over` it grants, by its entry, in place of ops of its own (`State::ops_on`): in the clear, as
    /// its level is, so a relay learns that two shares grant the same group, never what it grants. Its level bounds
    /// the group's caps (`rules::Cap::holds`); its own grant names no op.
    pub group: Option<EntryId>,
}

/// The line of an entry's history a write extends (`Proposals.lean`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash)]
pub enum Proposal {
    #[default]
    Main,
    /// A new proposal, which this write starts: its id names the proposal, its `deps` are the version the proposal
    /// starts from, and its body holds the proposal's name, encrypted. Or, for a write that creates its entry, a
    /// draft: the entry and its own line at once, its body the entry's first content, its main line empty until its
    /// vault lands it (`history::History::landed`).
    New,
    /// The proposal that write started.
    On(EditId),
}

/// What a write that creates its entry says of it: the audience it goes in, its shares in canonical order, and the
/// nonce its id is the hash of, with its vault and the write's author (`EntryId::of`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Creation {
    pub audience: Vec<ShareId>,
    pub nonce: [u8; 32],
}

/// A line of an entry's history: `None` is the main line, `Some(b)` the proposal write `b` started.
pub type Line = Option<EditId>;

/// What a vault's settings edit sets: its threshold, or its root.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Setting {
    /// How many of its owners approve for it.
    Threshold(u32),
    /// The root hands itself on to a new passkey, which signs too, or steps down (`None`). A removal: it names the
    /// edits it had seen and keeps.
    Root { root: Option<SignerId>, keep: Vec<EditId> },
}

/// What a share edit gives: a grant, or a place in a vault, as an owner or as a device. To a person they are all shares
/// (an owner is owner on everything, a device acts for the vault), but each keeps rules of its own, under its own
/// sub-kind on the wire, where the stateless functions read it (`Edit::rank`, `sync::log_of`, `sign::standing`). Owner
/// of a whole vault is an owner of it, which no grant makes (`Refusal::WideOwner`). A keep share is a grant that grants
/// nothing and names one of its issuer's devices.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Sharing {
    /// A grant, issued by its issuer through the owners `via`; its id is this edit's id.
    Grant(Share, Vec<VaultId>),
    /// An owner of vault `vault`, by the vault's approval; the newcomer signs too, and a signer brings the key it has
    /// keys sealed to.
    Owner { vault: VaultId, owner: Principal, seal_to: Option<PublicKey> },
    /// A device of a human vault (a phone, a browser) or of a device vault (a server, an agent's harness), by the
    /// vault's approval; the device signs too, and brings the key it has keys sealed to.
    Device { vault: VaultId, device: SignerId, seal_to: Option<PublicKey> },
}

/// What a revocation ends: a grant, or an owner's or a device's place in a vault. Every revocation is a removal: it
/// names the edits it had seen and keeps.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Revoking {
    /// Ends grant `share` and every grant resting on it, revoked by vault `actor` through the owners `via`: a keep
    /// share only by its issuer, and nothing rests on one.
    Grant { share: ShareId, actor: VaultId, keep: Vec<EditId>, via: Vec<VaultId> },
    /// By the vault's approval, or the owner leaving on its own.
    Owner { vault: VaultId, owner: Principal, keep: Vec<EditId> },
    /// By the vault's approval, or the device leaving on its own.
    Device { vault: VaultId, device: SignerId, keep: Vec<EditId> },
}

impl Revoking {
    /// The edits it had seen and keeps.
    pub fn keep(&self) -> &[EditId] {
        match self {
            Revoking::Grant { keep, .. } | Revoking::Owner { keep, .. } | Revoking::Device { keep, .. } => keep,
        }
    }

    fn keep_mut(&mut self) -> &mut Vec<EditId> {
        match self {
            Revoking::Grant { keep, .. } | Revoking::Owner { keep, .. } | Revoking::Device { keep, .. } => keep,
        }
    }
}

/// Every change is one of these, signed. Governance (a vault's settings, its owners and devices, owner grants) needs
/// the vault's approval: its root, or its threshold of owners; everything else needs one device acting for the vault.
/// Every removal names the edits it had seen and keeps (`keep`); what it hadn't seen and relied on what it takes away
/// is cut (`view`). An edit that acts for a vault (issues or revokes a grant, writes, marks) names the owners `via`
/// its author acts through (`State::acts_via`): none when its author is a member of the vault, else from an owner of
/// the vault down to the vault its author is a member of, as a device of Bob's human vault writes for Bob's coop
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
    /// Vault `vault`'s threshold, or its root.
    Settings { vault: VaultId, set: Setting },
    /// A grant, an owner or a device.
    Share(Sharing),
    /// A grant, an owner or a device ends.
    Revoke(Revoking),
    /// An encrypted edit of entry `entry` of vault `vault`, on the line `proposal` of its history, under the key of its
    /// stay `stay` at epoch `epoch` of that stay's audience. The epoch is its writer's to name, the newest it knows
    /// (T15), and no peer checks it against the epoch it holds: an audience moves on by edits of other entries too, one
    /// that empties it and one that brings it back into use, which a device the entry is shared with later never
    /// receives (T12), so such a check would refuse there what every device of the vault accepts. Under an epoch its
    /// audience hasn't reached, nobody opens it until the audience does. `deps` are the entry's writes it builds on
    /// (its Loro frontier): a write that starts a proposal builds on the version the proposal starts from, and a merge
    /// also on the heads of the line it brings in. A write that creates its entry names the audience it goes in and
    /// the nonce its id is the hash of (`create`), and its stay is the one its creation begins (`None`). Its `body` is
    /// the update, the header of a new entry and the tags it adds and removes, encrypted: the tags count only when it
    /// acts for the vault, except that a new entry's added tags are its first tags. The files it brings (`sealed`) are
    /// named in the clear by their roots, smallest first, so whoever may receive it keeps them; their keys are in its
    /// body.
    Write {
        vault: VaultId,
        entry: EntryId,
        actor: VaultId,
        stay: Option<EditId>,
        epoch: u64,
        deps: Vec<EditId>,
        proposal: Proposal,
        via: Vec<VaultId>,
        create: Option<Creation>,
        files: Vec<FileRoot>,
        body: Vec<u8>,
    },
    /// A steward, acting for vault `vault`, marks its entry `entry`: with the audience of the shares `caps` (canonical
    /// order), which moves the entry there, begins a stay and keeps the writes it had seen (`keep`); with the keep
    /// shares that pick it (`wants`, in canonical order), so a peer that reads no selector knows which devices want it;
    /// or with both. A part left out (`None`) stays as it is, so a mark of the wants alone never puts back an audience
    /// another steward changed meanwhile; only a mark with `caps` is a removal, and only it keeps anything.
    Mark {
        vault: VaultId,
        entry: EntryId,
        caps: Option<Vec<ShareId>>,
        wants: Option<Vec<ShareId>>,
        keep: Vec<EditId>,
        via: Vec<VaultId>,
    },
    /// The real boxes of one key of the schedule, `name`: its `id`, its `public` half for those who seal to it without
    /// holding it, the key sealed or wrapped to each recipient, and for a public family the key itself, in the
    /// `clear`. The schedule already says who may open what, so this changes nothing in it: a peer accepts it only
    /// from a signer that may open the key, and only if every box goes where the schedule seals the key.
    Keys { name: KeyName, id: KeyId, public: Option<PublicKey>, boxes: Vec<KeyBox>, clear: Option<[u8; 32]> },
    /// Vault `vault` claims share `share`, which names an invite key, acting through the owners `via`: signed by that
    /// key, whose secret came with the invite, and by a member of `vault` acting for it, so the newcomer's vault takes
    /// the invite at sign-up with no tap of its inviter. From then on the share names `vault`, and its key is sealed to
    /// `vault`'s seed (`State::targets`); a second claim finds no invite left.
    Claim { share: ShareId, vault: VaultId, via: Vec<VaultId> },
    /// The keys of entry `entry`'s earlier stays, each wrapped under the key the schedule links it to: what a move
    /// leaves to do, in one edit and one signature rather than a `Keys` edit a key (`Wraps.lean`). Accepted where each
    /// wrap would be as a `Keys` edit of its own, the entry's own keys alone; it changes nothing in the schedule.
    Wraps { entry: EntryId, wraps: Vec<Wrap> },
    /// Vault `vault`'s owners' word, by its root or its threshold, that each edit of `covers` carried its signers'
    /// signatures when it stood (`Checkpoint.lean`): a device may then hold a covered edit without its signatures,
    /// while the checkpoint stands and the edit's signers acted for the vault. It changes nothing in the state.
    Checkpoint { vault: VaultId, covers: Vec<EditId> },
}

/// One key of an entry's earlier stays, `name` and its `id`, wrapped under the key the schedule links it to: one of a
/// `Wraps` edit's.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Wrap {
    pub name: KeyName,
    pub id: KeyId,
    pub boxed: KeyBox,
}

impl Action {
    /// The boxes of keys it carries, each with the key's name and id: a `Keys` edit's, or a `Wraps` edit's.
    pub fn key_boxes(&self) -> Vec<(KeyName, KeyId, &KeyBox)> {
        match self {
            Action::Keys { name, id, boxes, .. } => boxes.iter().map(|b| (*name, *id, b)).collect(),
            Action::Wraps { wraps, .. } => wraps.iter().map(|w| (w.name, w.id, &w.boxed)).collect(),
            _ => vec![],
        }
    }

    /// The edits a removal had seen and keeps, for removals: every revocation, handing the root on, and a mark that
    /// takes an entry to an audience.
    pub fn keep(&self) -> Option<&[EditId]> {
        match self {
            Action::Revoke(r) => Some(r.keep()),
            Action::Settings { set: Setting::Root { keep, .. }, .. } | Action::Mark { caps: Some(_), keep, .. } => {
                Some(keep)
            }
            _ => None,
        }
    }

    fn keep_mut(&mut self) -> Option<&mut Vec<EditId>> {
        match self {
            Action::Revoke(r) => Some(r.keep_mut()),
            Action::Settings { set: Setting::Root { keep, .. }, .. } | Action::Mark { caps: Some(_), keep, .. } => {
                Some(keep)
            }
            _ => None,
        }
    }

    /// The owners an act for a vault goes through, for the edits that act for one.
    pub fn via(&self) -> Option<&[VaultId]> {
        match self {
            Action::Share(Sharing::Grant(_, via))
            | Action::Revoke(Revoking::Grant { via, .. })
            | Action::Write { via, .. }
            | Action::Mark { via, .. }
            | Action::Claim { via, .. } => Some(via),
            _ => None,
        }
    }

    fn via_mut(&mut self) -> Option<&mut Vec<VaultId>> {
        match self {
            Action::Share(Sharing::Grant(_, via))
            | Action::Revoke(Revoking::Grant { via, .. })
            | Action::Write { via, .. }
            | Action::Mark { via, .. }
            | Action::Claim { via, .. } => Some(via),
            _ => None,
        }
    }
}

/// A verified edit: what it does, who signed it, and the edits of its own log it builds on.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Edit {
    /// The frontier of its own log (`sync::LogId`) as its device held it: what it builds on there. An edit that starts
    /// a log, a genesis or a grant, builds on nothing.
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
    /// The BLAKE3 hash (`hash::content`) of the edit's canonical encoding (`encode`): everything the edit says, its
    /// signers included. Each signer signs this id.
    pub fn id(&self) -> EditId {
        EditId(crate::encode::edit_id(self))
    }

    /// Everyone who signed: the author first.
    pub fn sigs(&self) -> impl Iterator<Item = SignerId> + '_ {
        std::iter::once(self.author).chain(self.cosigners.iter().copied())
    }

    /// The vault an edit acts for: a grant's issuer, a revoker of a grant, a writer, a marker (the vault itself), a
    /// claimer.
    pub fn actor(&self) -> Option<VaultId> {
        match &self.action {
            Action::Share(Sharing::Grant(c, _)) => Some(c.issuer),
            Action::Revoke(Revoking::Grant { actor, .. }) | Action::Write { actor, .. } => Some(*actor),
            Action::Mark { vault, .. } | Action::Claim { vault, .. } => Some(*vault),
            _ => None,
        }
    }

    /// The entry a write changes, or a steward marks.
    pub fn entry(&self) -> Option<EntryId> {
        match self.action {
            Action::Write { entry, .. } | Action::Mark { entry, .. } => Some(entry),
            _ => None,
        }
    }

    /// The McEliece public keys the edit names, which travel beside it as blobs: the keys signers bring to have keys
    /// sealed to them, and the keys a `Keys` edit announces.
    pub fn blobs(&self) -> Vec<BlobId> {
        match &self.action {
            Action::Genesis { seal_to, .. } => seal_to.iter().map(|(_, k)| k.mceliece).collect(),
            Action::Share(Sharing::Owner { seal_to, .. } | Sharing::Device { seal_to, .. }) => {
                seal_to.iter().map(|k| k.mceliece).collect()
            }
            Action::Keys { public, .. } => public.iter().map(|k| k.mceliece).collect(),
            _ => vec![],
        }
    }

    /// The files the edit brings: a write's, and no other edit's.
    pub fn files(&self) -> &[FileRoot] {
        match &self.action {
            Action::Write { files, .. } => files,
            _ => &[],
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
    /// Device signers act for a human or a device vault but don't govern it: a person's phones and browsers, the
    /// server or the agent's harness a device vault is for.
    pub devices: Vec<SignerId>,
    /// A human vault's root: its passkey, named at genesis. It approves anything for its vault on its own, wins every
    /// clash with the other owners, and only it hands the root on.
    pub root: Option<SignerId>,
}

/// A share as issued, with what never changes about it worked out once.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Issued {
    pub id: ShareId,
    pub share: Share,
    /// The shares it rests on, from its root share down to itself (`chain`).
    pub chain: Arc<[ShareId]>,
    /// Its intake audience: the shares of its chain that aren't wide, in canonical order. A vault that creates an entry
    /// through it puts it there, where only those shares' grantees, the wide shares and the stewards read it, until a
    /// steward moves it to its semantic audience.
    pub intake: Arc<[ShareId]>,
    /// The commitment to its ops, from its `select`: none for a share whose `select` doesn't read.
    pub commitment: Option<[u8; 32]>,
}

/// An entry of a vault: a note, a todo, a profile.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub id: EntryId,
    pub vault: VaultId,
    /// Its stays, the first first: the mark that put it in an audience (`None` for its creation), and that audience.
    pub stays: Vec<(Option<EditId>, AudienceId)>,
    /// The vault its creation acted for, and the creation's edit, whose header says the rest of what never changes
    /// about it.
    pub creator: VaultId,
    pub creation: EditId,
    /// The shares its creator could have created it through: those over its vault that the creator held with write or
    /// more, live, whose intake audience is the one it was created in. Its creation was let in if one of them selects
    /// it (`Meaning::admitted`).
    pub intake: Vec<ShareId>,
    /// The writes that acted for its vault after its creation, in the order they were accepted, and those a removal
    /// dropped since too: the tags they add and remove count (`Meaning::attrs`), as in the model.
    pub retags: Vec<EditId>,
}

impl Entry {
    /// The audience it is in now.
    pub fn audience(&self) -> AudienceId {
        self.stays.last().expect("an entry is created in a cell").1
    }

    /// The stay it is in now.
    pub fn stay(&self) -> Option<EditId> {
        self.stays.last().expect("an entry is created in a cell").0
    }

    /// The audience of one of its stays.
    pub fn stay_audience(&self, s: Option<EditId>) -> Option<AudienceId> {
        self.stays.iter().find(|(x, _)| *x == s).map(|(_, x)| *x)
    }
}

/// An accepted write: one encrypted edit of one entry, on one line of its history, under the key of one of the entry's
/// stays at one epoch of its audience. Its author, a device, acts for `actor` through the owners `via`
/// (`State::acts_via`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Write {
    pub edit: EditId,
    pub author: SignerId,
    pub actor: VaultId,
    pub entry: EntryId,
    pub stay: Option<EditId>,
    pub epoch: u64,
    /// The writes of the same entry it builds on.
    pub deps: Vec<EditId>,
    pub proposal: Proposal,
    pub via: Vec<VaultId>,
    /// It created its entry.
    pub first: bool,
    /// The audience its entry was in when it was accepted, where a removal judges it (`State::authorized`).
    pub audience: AudienceId,
    /// The shares its readers judge it by (`State::lets`): those with write or more its actor held, live, that reached
    /// its entry when it was accepted, or for a creation those whose intake audience it was created in. None for a
    /// write that acts for its entry's own vault.
    pub shares: Vec<ShareId>,
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

    /// The key it is encrypted under: its entry's in its stay, at its epoch.
    pub fn key(&self) -> KeyName {
        KeyName::Entry(self.entry, self.stay, self.epoch)
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
    /// The owner isn't of a kind the vault's row of the kind table lets own it (`Kind::rules`): a human vault's owners
    /// are signers, a coop's human or coop vaults, an aven's a human vault, a device vault's a human, coop or aven
    /// vault.
    WrongOwnerKind,
    /// The vault would have more owners than its kind takes: an aven and a device vault have exactly one.
    OneOwner,
    /// The owner already owns as many vaults of the kind as one owner may: a person owns one aven at most.
    SecondAven,
    /// A vault keeps at least one owner.
    LastOwner,
    /// The vault would own itself, directly or through other vaults (T3).
    Cycle,
    /// Only a human vault has a root.
    NotHuman,
    /// Only human and device vaults hold devices: a coop and an aven act only through their owners.
    NoDevices,
    /// Only a vault's root hands the root on: no longer refused so since every owner is equal (2026-10-19), kept for
    /// the refusals already recorded.
    NotRoot,
    /// The edit's author doesn't act for the vault it claims to act for through the owners it names.
    NotActing,
    /// The vault holds no share that allows this: no live share with the level it needs that reaches the entry, no
    /// share whose intake is the audience it creates in, no right to revoke the share (a keep share only its issuer
    /// revokes), no share over the vault a keep share is over, backup or more.
    NoCap,
    /// Not a rule of the edits but of a device: no share the vault writes through names ops that allow what the write
    /// does (`rules`), so its readers wouldn't count it, and the device doesn't make it.
    NotAllowed,
    /// Not a rule of the edits but of a device: a merge into the main line through a share builds on no accept of the
    /// entry's vault, or brings in more than it accepted (`passes`, M2), so its readers wouldn't count it, and the
    /// device doesn't make it.
    NotAccepted,
    /// Not a rule of the edits but of a device: a write on the main line of a draft that hasn't landed relies on a
    /// share, as only the entry's vault lands a draft (`history::History::lands`), so its readers wouldn't count it,
    /// and the device doesn't make it.
    NotLanded,
    /// Not a rule of the edits but of a device: a share to issue names no op or more than a share names, has a blank or
    /// long name, a selector beyond the bounds a peer accepts, or rests on a chain too long to prove
    /// (`rules::normalize`, `rules::name_ok`, `rules::MAX_GRANTS`).
    BadCap,
    /// A keep share names a device, one of its issuer's (T4): a keep share to a vault or to everyone is none.
    KeepNeedsDevice,
    /// Only a keep share names a device (T4): any other share names a vault or everyone, as a device only ever keeps
    /// what its vault may hold.
    DeviceOnlyKeeps,
    /// A share never names the vault it is over: that vault holds every right over itself already.
    CapToItself,
    /// Everyone only ever gets read (T8).
    PublicBeyondRead,
    /// Owner of a whole vault is an owner of it (`Sharing::Owner`), which no grant makes: a grant of owner is on a
    /// slice.
    WideOwner,
    /// An invite makes no owner: owner takes the newcomer's consent, which an invite key doesn't give.
    InviteOwner,
    /// A claim of a share that names no invite key: a share to a vault, to everyone or to a device, or an invite that
    /// was claimed already.
    NotInvite,
    /// The share rests on one that isn't a live share over the same vault held by its issuer, or is a keep share, or
    /// is at a lower level, or isn't wide where it is; or on one that is neither an owner share nor lets it go to a
    /// vault its issuer owns; or a root share is issued by another vault than the one it is over, or a keep share
    /// rests on a share.
    BadParent,
    /// The share was revoked already.
    Revoked,
    /// An entry id is created once: this one exists, or existed and fell.
    Reborn,
    /// A write that creates its entry names an id that isn't the hash of its vault, its author and its nonce
    /// (`EntryId::of`).
    NotItsId,
    /// A write that creates its entry names no stay, builds on nothing, and is on the main line or starts its own (a
    /// draft): it is on no proposal another write started.
    NotFirst,
    /// The entry is another vault's.
    WrongVault,
    /// An audience's shares aren't in canonical order, or one of them isn't a share over the vault, or is wide.
    BadAudience,
    /// A mark takes its entry to the audience it is in already.
    SameAudience,
    /// A mark marks nothing, neither an audience nor wants, or keeps edits where it takes its entry to no audience:
    /// only a mark that does is a removal.
    BadMark,
    /// A write under a stay its entry never had.
    UnknownStay,
    /// A key of a family under an epoch the family hasn't reached.
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
    /// A keep share names a signer that isn't a device of the vault that issues it.
    NotDevice,
    /// A mark's wants aren't in canonical order, or one isn't a keep share over the vault, or is wide; live or
    /// revoked, as readers leave out a revoked one.
    BadWants,
    /// A mark of the wants alone marks an entry with the wants it has already.
    SameWants,
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
    /// device of a device vault.
    NotClaiming,
    /// A `Wraps` edit wraps nothing, or a key that isn't one of its entry's.
    BadWraps,
}

/// What a removal takes away.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Fact {
    Owner(VaultId, Principal),
    Device(VaultId, SignerId),
    /// Whatever root the vault had.
    Root(VaultId),
    Share(ShareId),
    /// The entry is in the audience of these shares: whatever only the audience it left allowed falls.
    Audience(EntryId, Arc<[ShareId]>),
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

/// What a peer knows after replaying its edits: vaults, shares, entries and their audiences, accepted writes and the
/// key schedule. No schema lane: its readers read it off the entries (`lane_of`), which no relay can (T25). Every
/// collection is shared, so a copy of a state costs a few counts, and grows in place while nothing else holds it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct State {
    /// In the order they were created, with each one's place.
    vaults: Arc<Vec<Vault>>,
    vault_at: Arc<HashMap<VaultId, usize>>,
    /// Every share issued, live or revoked, in the order issued, with each one's place, the places of the shares naming
    /// each vault and of the shares over each vault.
    shares: Arc<Vec<Issued>>,
    share_at: Arc<HashMap<ShareId, usize>>,
    held: Arc<HashMap<VaultId, Vec<usize>>>,
    over: Arc<HashMap<VaultId, Vec<usize>>>,
    revoked: Arc<Listed<ShareId>>,
    /// In the order they were created, with each one's place.
    entries: Arc<Vec<Entry>>,
    entry_at: Arc<HashMap<EntryId, usize>>,
    /// Every entry id ever created, even of an entry that fell since: an id is created once, so an entry key's name
    /// (the entry, its stay, an epoch) names one key.
    born: Arc<Listed<EntryId>>,
    /// In the order they were accepted, with each one's place and the places of each entry's.
    writes: Arc<Vec<Write>>,
    write_at: Arc<HashMap<EditId, usize>>,
    by_entry: Arc<HashMap<EntryId, Vec<usize>>>,
    /// The shares of every audience an entry was ever in or created in, by its id.
    audiences: Arc<HashMap<AudienceId, Arc<[ShareId]>>>,
    /// The audiences entries are in now, with their vault and how many.
    in_use: Arc<HashMap<AudienceId, (VaultId, usize)>>,
    /// Each key family's epoch, where it isn't 0, and the removal that moved it to each epoch.
    epochs: Arc<HashMap<KeyFam, u64>>,
    moved: Arc<HashMap<(KeyFam, u64), EditId>>,
    seals: Arc<Seals>,
    /// The keys published to everyone, in the order they were.
    published: Arc<Listed<KeyName>>,
    /// The key each signer has keys sealed to, as it last brought it.
    seal_keys: Arc<HashMap<SignerId, PublicKey>>,
    /// Only while checking an edit that a mark after it hadn't seen (`hide`): each entry such a mark took to an
    /// audience, and that audience's shares. A write must be allowed there too.
    narrow: Vec<(EntryId, Arc<[ShareId]>)>,
    /// Only while `run` checks an edit against the state before it: the moves after it, looked up by the entry each
    /// moved, with the edit's place and id. Nothing is hidden by them; `in_audience` only notes when one that hadn't
    /// seen the edit would have answered otherwise, and only then is the edit checked again with them hidden.
    late: Option<Late>,
    /// The keep shares that pick each entry, as its vault's stewards last marked them: its wants.
    marks: Arc<HashMap<EntryId, Arc<[ShareId]>>>,
}

/// What an accepted edit changes, worked out before anything changes (`State::check`).
#[derive(Clone, Debug)]
enum Change {
    /// A `Keys` edit: nothing.
    Nothing,
    Genesis(Vault, Vec<(SignerId, PublicKey)>),
    AddOwner { at: usize, owner: Principal, seal_to: Option<(SignerId, PublicKey)> },
    RemoveOwner { at: usize, owner: Principal },
    SetThreshold { at: usize, threshold: u32 },
    AddDevice { at: usize, device: SignerId, seal_to: Option<PublicKey> },
    RemoveDevice { at: usize, device: SignerId },
    SetRoot { at: usize, root: Option<SignerId> },
    Share(Issued),
    /// The shares that end, in the order they were issued.
    Revoke(Vec<ShareId>),
    /// The share at `at`, an invite, names vault `vault` from now on.
    Claim { at: usize, vault: VaultId },
    Create(Entry, Box<Write>, Arc<[ShareId]>),
    /// A write, and whether it acts for its entry's vault, so its tags count.
    Write(Write, bool),
    /// A mark of the entry at `at`, by edit `stay`: the audience it takes the entry to, with that audience's shares,
    /// where it begins a stay there, and the wants it marks the entry with.
    Mark { at: usize, stay: EditId, to: Option<(AudienceId, Arc<[ShareId]>)>, wants: Option<Arc<[ShareId]>> },
}

impl Change {
    /// A removal that drops what it took the authorization from (`drop_unseen`) and may make keys stale. A mark that
    /// takes an entry to an audience takes nothing from a write accepted before it, which is judged in the audience it
    /// was written in, and makes no key stale but an audience's that comes back into use: it takes the light path.
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
    /// An entry came into the audience, which was empty before when `fresh`, with only its own write.
    Created { entry: usize, fresh: bool },
    /// A write was added.
    Wrote(usize),
    /// An entry moved into an audience, which was empty before when `fresh`.
    Moved { entry: usize, fresh: bool },
}

/// No item twice.
fn nodup<T: PartialEq>(xs: &[T]) -> bool {
    xs.iter().enumerate().all(|(i, x)| !xs[..i].contains(x))
}

/// An audience's canonical form: its share ids, each once, smallest first.
pub fn mk_audience(xs: &[ShareId]) -> Vec<ShareId> {
    let mut out = xs.to_vec();
    out.sort();
    out.dedup();
    out
}

/// The shares `xs` are in canonical form.
fn canonical(xs: &[ShareId]) -> bool {
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

    pub fn share(&self, c: ShareId) -> Option<&Issued> {
        self.share_at.get(&c).map(|&i| &self.shares[i])
    }

    /// Every share issued, live or revoked, in the order issued.
    pub fn shares(&self) -> &[Issued] {
        &self.shares
    }

    /// The shares naming vault `a`, live or revoked.
    pub fn shares_held(&self, a: VaultId) -> impl Iterator<Item = &Issued> {
        self.held.get(&a).into_iter().flatten().map(|&i| &self.shares[i])
    }

    /// The shares over vault `v`, live or revoked.
    pub fn shares_over(&self, v: VaultId) -> impl Iterator<Item = &Issued> {
        self.over.get(&v).into_iter().flatten().map(|&i| &self.shares[i])
    }

    /// The shares revoked, in the order they ended.
    pub fn revoked(&self) -> &[ShareId] {
        self.revoked.as_slice()
    }

    /// Share `c` was issued and hasn't been revoked.
    pub fn live(&self, c: ShareId) -> bool {
        self.share_at.contains_key(&c) && !self.revoked.contains(&c)
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

    /// The shares of audience `x`, if an entry was ever in it or created in it here.
    pub fn audience_shares(&self, x: AudienceId) -> Option<&[ShareId]> {
        self.audiences.get(&x).map(|c| &c[..])
    }

    fn shares_of(&self, x: AudienceId) -> &[ShareId] {
        self.audience_shares(x).unwrap_or_default()
    }

    /// Every audience an entry was ever in or created in, with its shares.
    pub fn audiences(&self) -> impl Iterator<Item = (AudienceId, &[ShareId])> {
        self.audiences.iter().map(|(x, shares)| (*x, &shares[..]))
    }

    pub fn write(&self, w: EditId) -> Option<&Write> {
        self.write_at.get(&w).map(|&i| &self.writes[i])
    }

    /// The place of write `w` in the replay, the order writes were accepted in: past the last for a write not accepted
    /// yet, as one a device drafts.
    pub fn place(&self, w: EditId) -> usize {
        self.write_at.get(&w).copied().unwrap_or(self.writes.len())
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

    /// Principal `p` may own a vault of kind `kind`, as the kind table says (`Kind::rules`): a signer where signers own
    /// the kind, an existing vault of a kind its row lists. So signers own human vaults alone, an aven is owned by a
    /// human vault, and a device vault owns nothing.
    fn owner_fits(&self, kind: Kind, p: Principal) -> Result<(), Refusal> {
        let of = match p {
            Principal::Signer(_) => None,
            Principal::Vault(o) => match (self.vault(o), kind.rules().owned_by) {
                (Some(ot), _) => Some(ot.kind),
                (None, OwnedBy::Vaults(_)) => return Err(Refusal::UnknownVault),
                (None, OwnedBy::Signers) => return Err(Refusal::WrongOwnerKind),
            },
        };
        if kind.rules().fits(of) { Ok(()) } else { Err(Refusal::WrongOwnerKind) }
    }

    /// Principal `p` may own one more vault of kind `kind`: the kind table sets no limit to how many one owner owns
    /// (`KindRules::each`), or `p` owns fewer. So a human vault owns one aven at most.
    fn room_for(&self, kind: Kind, p: Principal) -> bool {
        kind.rules().each.is_none_or(|n| {
            self.vaults.iter().filter(|x| x.kind == kind && x.owners.contains(&p)).count() < n
        })
    }

    /// The owners of a vault of kind `kind` fit the kind table in number: no more than the kind takes
    /// (`Refusal::OneOwner`), each of which may own one more of the kind (`Refusal::SecondAven`).
    fn owners_count(&self, kind: Kind, owners: &[Principal]) -> Result<(), Refusal> {
        if !kind.rules().takes(owners.len()) {
            return Err(Refusal::OneOwner);
        }
        if !owners.iter().all(|&p| self.room_for(kind, p)) {
            return Err(Refusal::SecondAven);
        }
        Ok(())
    }

    /// Vault `a` holds share `cp` with level `r` or more: the share is live and names `a`.
    pub fn holds(&self, a: VaultId, cp: &Issued, r: Level) -> bool {
        self.live(cp.id) && cp.share.who == Who::Vault(a) && cp.share.level.allows(r)
    }

    /// Share `cp` reaches entry `e` of vault `v` in the audience of the shares `audience`: it is over the vault, and
    /// wide, or in the audience and in the audience of every mark that moved the entry and that the edit being checked
    /// hadn't seen (`narrow`).
    fn in_audience(&self, cp: &Issued, e: EntryId, v: VaultId, audience: &[ShareId]) -> bool {
        cp.share.over == v
            && (cp.share.wide
                || (audience.contains(&cp.id)
                    && self.narrow.iter().all(|(x, shares)| *x != e || shares.contains(&cp.id))))
            && self.late.as_ref().is_none_or(|l| l.allows(cp, e))
    }

    /// Vault `a` may write entry `e` of vault `v` in the audience of the shares `audience`: it is the vault, or it
    /// holds a share with write or more that reaches the entry there.
    fn may_write_in(&self, a: VaultId, e: EntryId, v: VaultId, audience: &[ShareId]) -> bool {
        a == v || self.shares_held(a).any(|cp| self.holds(a, cp, Level::Write) && self.in_audience(cp, e, v, audience))
    }

    /// The shares through which vault `a` may write entry `e` of vault `v` in the audience of the shares `audience`:
    /// those it holds with write or more that reach the entry there.
    fn write_shares(&self, a: VaultId, e: EntryId, v: VaultId, audience: &[ShareId]) -> Vec<ShareId> {
        let reach = |cp: &&Issued| self.holds(a, cp, Level::Write) && self.in_audience(cp, e, v, audience);
        self.shares_held(a).filter(reach).map(|cp| cp.id).collect()
    }

    /// Vault `a` may write entry `e`, by what every peer sees (no selector, type or tag): it is the entry's vault, or
    /// it holds a share with write or more that reaches the entry's audience.
    pub fn may_write(&self, a: VaultId, e: EntryId) -> bool {
        self.entry(e).is_some_and(|en| self.may_write_in(a, en.id, en.vault, self.shares_of(en.audience())))
    }

    /// The shares over vault `v` through which vault `a` may create an entry in the audience of the shares `x`: those
    /// it holds with write or more whose intake audience `x` is.
    fn intake_shares(&self, a: VaultId, v: VaultId, x: &[ShareId]) -> Vec<ShareId> {
        self.shares_held(a)
            .filter(|cp| cp.share.over == v && self.holds(a, cp, Level::Write) && &cp.intake[..] == x)
            .map(|cp| cp.id)
            .collect()
    }

    /// Vault `a` may create an entry of vault `v` in the audience of the shares `x`: it is `v`, which creates in any
    /// audience, or `x` is the intake audience of a share over `v` that it holds with write or more.
    pub fn may_create(&self, a: VaultId, v: VaultId, x: &[ShareId]) -> bool {
        a == v || !self.intake_shares(a, v, x).is_empty()
    }

    /// A write is authorized: its author acts for its actor through the owners it names, and that vault may write its
    /// entry as the write found it, in the audience it was in then (`Write::audience`). Strong removal judges an edit
    /// at its own place in the replay too, so a removal takes from a write only what it took from it there: a mark that
    /// moves the entry between them doesn't hand the removal writes that never rested on what it takes away.
    pub fn authorized(&self, w: &Write) -> bool {
        self.acts_via(w.author, &w.via, w.actor)
            && self
                .entry(w.entry)
                .is_some_and(|en| self.may_write_in(w.actor, en.id, en.vault, self.shares_of(w.audience)))
    }

    /// Share `c` goes from its issuer to its own: it names a vault its issuer owns directly, as an aven's share to one
    /// of its agents' device vaults, a coop's to its server's, a person's to their aven.
    fn to_own(&self, c: &Share) -> bool {
        let owned = |g: VaultId| self.vault(g).is_some_and(|gt| gt.owners.contains(&Principal::Vault(c.issuer)));
        matches!(c.who, Who::Vault(g) if owned(g))
    }

    /// The one rule a share rests on another by (`shareParentOk`): its parent is a live share over the same vault that
    /// its issuer holds, other than a keep share; it is at a level no higher than that one's, and wide only if that
    /// one is (so a wide share's whole chain is wide); and either the parent is an owner share, whose `share` op lets
    /// its holder share on with anyone, or the share goes to a vault its issuer owns directly (`to_own`). So a person
    /// passes a coop's share on to their aven, and an aven to its agents. A root share is issued by the vault it is
    /// over.
    pub fn share_parent_ok(&self, c: &Share) -> bool {
        match c.parent {
            None => c.issuer == c.over,
            Some(p) => self.share(p).is_some_and(|pc| {
                self.live(p)
                    && pc.share.over == c.over
                    && pc.share.who == Who::Vault(c.issuer)
                    && !pc.share.level.is_keep()
                    && pc.share.level.allows(c.level)
                    && (!c.wide || pc.share.wide)
                    && (pc.share.level == Level::Owner || self.to_own(c))
            }),
        }
    }

    /// Vault `a` may revoke share `cp`: it issued it, the share is over it, it holds the share (and gives it up), or it
    /// may revoke a share `cp` rests on. A keep share only its issuer revokes, through a device or an owner: the vault
    /// it is over could otherwise have a device sync all of that vault, by revoking its last keep share that adds
    /// entries.
    pub fn may_revoke(&self, a: VaultId, cp: &Issued) -> bool {
        if cp.share.level.is_keep() {
            return cp.share.issuer == a;
        }
        cp.chain.iter().filter_map(|&c| self.share(c)).any(|x| {
            x.share.issuer == a || x.share.over == a || x.share.who == Who::Vault(a)
        })
    }

    /// The wants the stewards last marked entry `e` with: keep shares, live or revoked.
    pub fn wants_of(&self, e: EntryId) -> &[ShareId] {
        self.marks.get(&e).map(|p| &p[..]).unwrap_or_default()
    }

    /// Signer `d` is a device of vault `v`.
    pub fn is_device(&self, d: SignerId, v: VaultId) -> bool {
        self.vault(v).is_some_and(|vt| vt.devices.contains(&d))
    }

    /// Vault `a` may hold entries of vault `v`: it is `v`, or holds a share over it, backup or more. A vault issues
    /// keep shares only over such a vault, so no stranger has a vault's stewards mark entries for it.
    pub fn may_hold(&self, a: VaultId, v: VaultId) -> bool {
        a == v || self.shares_over(v).any(|cp| self.holds(a, cp, Level::Backup))
    }

    /// The live keep shares device `d` syncs vault `v` by (`keepsOf`): those over `v` naming `d`, issued by a vault `d`
    /// is still a device of. A device that leaves its vault drops them, with no revocation.
    pub fn keeps_of(&self, d: SignerId, v: VaultId) -> impl Iterator<Item = &Issued> {
        self.shares_over(v).filter(move |k| {
            k.share.level.is_keep()
                && k.share.who == Who::Device(d)
                && self.live(k.id)
                && self.is_device(d, k.share.issuer)
        })
    }

    /// Device `d`'s copy setting (`copyOf`): the live wide keep shares naming it over a vault it is a device of, issued
    /// by that vault, whole for a full copy, opened for a light one. It stands for every vault where the device has
    /// no keep share of its own (`keeps_for`), so one setting says what it keeps of every vault it syncs.
    pub fn copy_of(&self, d: SignerId) -> impl Iterator<Item = &Issued> {
        self.shares().iter().filter(move |k| {
            k.share.level.is_keep()
                && k.share.who == Who::Device(d)
                && k.share.wide
                && k.share.over == k.share.issuer
                && self.live(k.id)
                && self.is_device(d, k.share.issuer)
        })
    }

    /// The keep shares device `d` syncs vault `v` by (`keepsFor`): its own over `v` (`keeps_of`), else its copy setting
    /// (`copy_of`).
    pub fn keeps_for(&self, d: SignerId, v: VaultId) -> Vec<&Issued> {
        let own: Vec<&Issued> = self.keeps_of(d, v).collect();
        if own.is_empty() { self.copy_of(d).collect() } else { own }
    }

    /// Keep share `k` picks entry `en`, by the entry's marks (`marked`): it is wide, or among the entry's wants.
    fn marked(&self, en: &Entry, k: &Issued) -> bool {
        k.share.wide || self.wants_of(en.id).contains(&k.id)
    }

    /// Device `d` wants entry `en`, by its keep shares for the entry's vault (`keeps_for`) and the entry's marks
    /// (`wantsWith`, T28): with none, or only never ones, it wants all of the vault but what a never share picks; else
    /// what a whole or an opened one picks and no never one does.
    pub fn wants(&self, d: SignerId, en: &Entry) -> bool {
        let ks = self.keeps_for(d, en.vault);
        let never = |k: &&Issued| k.share.level == Level::Keep(KeepMode::Never);
        let adds = ks.iter().all(never) || ks.iter().any(|k| !never(k) && self.marked(en, k));
        adds && !ks.iter().any(|k| never(k) && self.marked(en, k))
    }

    /// Whether device `d` keeps whole the files entry `en` brings (`keepsWith`): a whole share of its keep shares for
    /// the entry's vault (`keeps_for`) picks the entry. `None` where none of them is whole or opened, only never ones or
    /// none: the node's own default says (`Options::keep` in avendb-net, the server's backup).
    pub fn keeps(&self, d: SignerId, en: &Entry) -> Option<bool> {
        let ks = self.keeps_for(d, en.vault);
        if ks.iter().all(|k| k.share.level == Level::Keep(KeepMode::Never)) {
            return None;
        }
        Some(ks.iter().any(|k| k.share.level == Level::Keep(KeepMode::Whole) && self.marked(en, k)))
    }

    /// Audience `x` is an audience of vault `v`: in canonical form, each of its shares one over `v` that isn't wide,
    /// nor a keep share.
    pub fn audience_ok(&self, v: VaultId, x: &[ShareId]) -> bool {
        let fits = |cp: &Issued| cp.share.over == v && !cp.share.wide && !cp.share.level.is_keep();
        canonical(x) && x.iter().all(|&c| self.share(c).is_some_and(fits))
    }

    /// How far below the human vaults vault `v` sits: a human vault at 0, any other one below its lowest owner.
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

    /// How senior vault `a` is in revoking share `cp`: 0 for the vault it is over, else the place in its chain of the
    /// highest share `a` issued, the root share at 0; a grantee giving its share up comes last.
    fn seniority(&self, a: VaultId, cp: &Issued) -> usize {
        if cp.share.over == a {
            return 0;
        }
        let issuer = |c: &ShareId| self.share(*c).map(|x| x.share.issuer);
        cp.chain.iter().position(|c| issuer(c) == Some(a)).unwrap_or(cp.chain.len())
    }

    /* The semantic layer: what only an entry's readers and its vault's stewards know. */

    /// Share `cp` with its whole chain selects attributes `a`, by the selectors `r` holds and the cap groups in force
    /// now (T22, `State.lean`'s `effSelects`): every share of the chain selects them (`share_selects`).
    pub fn eff_selects(&self, cp: &Issued, a: &Attrs, r: &Readings) -> bool {
        self.eff_selects_at(cp, a, r, self.writes.len())
    }

    /// `eff_selects` with the cap groups in force before place `place` of the replay.
    fn eff_selects_at(&self, cp: &Issued, a: &Attrs, r: &Readings, place: usize) -> bool {
        cp.chain.iter().all(|c| self.share(*c).is_some_and(|x| self.share_selects(x, a, r, place)))
    }

    /// Share `x` on its own selects attributes `a` (`State.lean`'s `shareSelects`): it is wide; or `a` are those of a
    /// cap group of its vault, which every share selects, so that whoever reads anything of a vault reads its cap
    /// groups and judges each write alike (C2); or its selector, as `r` holds it, matches, and where it names a cap
    /// group, a cap of the group in force before place `place` that it holds there does too (`rules::Cap::holds`). A
    /// selector `r` doesn't hold selects nothing.
    fn share_selects(&self, x: &Issued, a: &Attrs, r: &Readings, place: usize) -> bool {
        let c = &x.share;
        c.wide
            || (a.ty.is_cap_group() && a.author == c.over)
            || (r.selectors.get(&x.id).is_some_and(|s| s.matches(a))
                && c.group.is_none_or(|g| {
                    self.caps_of(&r.groups, c.over, g, place).iter().any(|cap| cap.holds(c.level, a))
                }))
    }

    /* Cap groups */

    /// Entry `en` carries a cap group of its vault (`isCapGroup`): its vault created it itself, and its header, as `r`
    /// holds it, says it is of type `slice::CAP_GROUP_TYPE`.
    pub fn is_cap_group(&self, en: &Entry, r: &Readings) -> bool {
        en.creator == en.vault && r.headers.get(&en.creation).is_some_and(|h| h.ty.is_cap_group())
    }

    /// What cap group entry `g` of vault `v` says before place `place` of the replay, by `groups` (`groupAt`): the last
    /// group a counted write of it accepted before that place says. None for an entry that isn't one of `v`'s cap
    /// groups, or that no such write defined.
    pub fn group_at<'a>(
        &self,
        groups: &'a Groups,
        v: VaultId,
        g: EntryId,
        place: usize,
    ) -> Option<&'a rules::CapGroup> {
        let (u, versions) = groups.of.get(&g).filter(|(u, _)| *u == v)?;
        debug_assert_eq!(*u, v);
        let before = |w: &EditId| self.write_at.get(w).is_some_and(|&i| i < place);
        versions.iter().rev().find(|(w, _)| before(w)).map(|(_, x)| &**x)
    }

    /// What cap group entry `g` of vault `v` says now, by the groups `r` holds.
    pub fn group<'a>(&self, r: &'a Readings, v: VaultId, g: EntryId) -> Option<&'a rules::CapGroup> {
        self.group_at(&r.groups, v, g, self.writes.len())
    }

    /// Cap group `g` of vault `v` and every group it includes, through any chain of includes, each once, as they stand
    /// before place `place` (`groupsOf`).
    fn groups_of(&self, groups: &Groups, v: VaultId, g: EntryId, place: usize) -> Vec<EntryId> {
        let mut out = vec![g];
        let mut i = 0;
        while i < out.len() {
            if let Some(x) = self.group_at(groups, v, out[i], place) {
                for &y in &x.includes {
                    if !out.contains(&y) {
                        out.push(y);
                    }
                }
            }
            i += 1;
        }
        out
    }

    /// The caps cap group `g` of vault `v` grants before place `place` (`capsOf`): its own and those of every group it
    /// includes.
    fn caps_of<'a>(&self, groups: &'a Groups, v: VaultId, g: EntryId, place: usize) -> Vec<&'a rules::Cap> {
        let caps = |x: EntryId| self.group_at(groups, v, x, place).into_iter().flat_map(|x| &x.caps);
        self.groups_of(groups, v, g, place).into_iter().flat_map(caps).collect()
    }

    /// The ops share `x` grants, by the grant `grant` that opens its commitment, where `at` judges a write (`opsOn`):
    /// its own; or, where it names a cap group of its vault, the op of each cap of the group in force there, and of the
    /// groups it includes, that it holds on the entry's attributes (`rules::Cap::holds`), none where those are unread.
    fn ops_on(&self, x: &Share, grant: &Grant, at: At<'_>) -> Vec<rules::Op> {
        match (x.group, at.attrs) {
            (None, _) => grant.ops.clone(),
            (Some(_), None) => vec![],
            (Some(g), Some(a)) => self
                .caps_of(at.groups, x.over, g, at.place)
                .into_iter()
                .filter(|cap| cap.holds(x.level, a))
                .map(|cap| cap.op.clone())
                .collect(),
        }
    }

    /// The cap groups as a reader holding `r` counts the writes that say them (`Groups`, `groupAt`): the writes of each
    /// cap group entry judged one after the other in the order they were accepted, by every entry's readers' rules
    /// (`counting`), each by the groups in force before it.
    pub fn read_groups(&self, r: &Readings) -> Groups {
        let mut out = Groups::default();
        let entries: Vec<&Entry> = self.entries.iter().filter(|en| self.is_cap_group(en, r)).collect();
        let mut places: Vec<usize> =
            entries.iter().flat_map(|en| self.by_entry.get(&en.id).into_iter().flatten().copied()).collect();
        places.sort_unstable();
        let mut counters: HashMap<EntryId, Counter> = HashMap::new();
        for i in places {
            let w = &self.writes[i];
            let Some(en) = self.entry(w.entry) else { continue };
            let counter = counters.entry(w.entry).or_insert_with(|| Counter::new(self, en, r));
            // a write the vault itself makes on its main line says what the group is, where its readers count it
            if counter.judge(self, w, r, &out)
                && w.actor == en.vault
                && w.proposal == Proposal::Main
                && let Some(g) = r.defines.get(&w.edit)
            {
                out.say(w.entry, en.vault, w.edit, g);
            }
        }
        out
    }

    /// The attributes of entry `en` as its creation gave them, by the header and tags `r` holds: none where `r` doesn't
    /// hold its header.
    pub fn first_attrs(&self, en: &Entry, r: &Readings) -> Option<Attrs> {
        let header = r.headers.get(&en.creation)?;
        let tags = r.tags.get(&en.creation).map(|d| d.apply(&[])).unwrap_or_default();
        Some(Attrs { ty: header.ty.clone(), author: en.creator, entry: en.id, created: header.created, tags })
    }

    /// Where its readers judge write `w`, by what `r` holds (`At`): its place, and its entry's attributes as they were
    /// when it came in, those its creation gave and the tags of each write acting for its vault accepted before it,
    /// worked out only where a share it relies on names a cap group, the only kind that asks for them.
    pub fn at_write<'a>(&self, w: &Write, r: &'a Readings) -> (Option<Attrs>, usize) {
        let place = self.place(w.edit);
        let asks = w.shares.iter().any(|c| self.share(*c).is_some_and(|cp| self.names_group(cp)));
        let attrs = asks.then(|| self.attrs_before(w.entry, place, r)).flatten();
        (attrs, place)
    }

    /// Entry `e`'s attributes before place `place` of the replay, by what `r` holds.
    fn attrs_before(&self, e: EntryId, place: usize, r: &Readings) -> Option<Attrs> {
        let en = self.entry(e)?;
        let mut a = self.first_attrs(en, r)?;
        for w in self.entry_writes(e).take_while(|w| self.write_at[&w.edit] < place) {
            if !w.first && w.actor == en.vault
                && let Some(d) = r.tags.get(&w.edit)
            {
                a.tags = d.apply(&a.tags);
            }
        }
        Some(a)
    }

    /// A share of `cp`'s chain names a cap group.
    fn names_group(&self, cp: &Issued) -> bool {
        cp.chain.iter().any(|c| self.share(*c).is_some_and(|x| x.share.group.is_some()))
    }

    /// What entry `e` means to whoever reads it, by the selectors, headers and tags `r` holds: its attributes, whether
    /// its creation was let in, its semantic audience, the keep shares that pick it, and what a steward would mark it
    /// with. `None` for an entry that doesn't exist, or whose header `r` doesn't hold. Whether a draft has landed is
    /// read off the writes `r` reads (`landed`).
    pub fn meaning(&self, e: EntryId, r: &Readings) -> Option<Meaning> {
        let landed = !self.is_draft(e) || self.landed(e, r);
        self.meaning_landed(e, r, landed)
    }

    /// `meaning`, where whoever reads entry `e` knows whether it has `landed` (`history::History::landed`), as a device
    /// does off the history it shows: while a draft hasn't, no share to everyone is in its semantic audience, so the
    /// stewards never mark it public (`State.lean`'s `semAudience`), and its creation is judged as made on a proposal.
    pub fn meaning_landed(&self, e: EntryId, r: &Readings, landed: bool) -> Option<Meaning> {
        let en = self.entry(e)?;
        let mut attrs = self.first_attrs(en, r)?;
        // its creator was the vault, or created it in the intake audience of a share whose slice held it then, and
        // whose ops let a creation through, on main or, for a draft, on a proposal, by the cap groups in force then
        let (proof, main) = (r.proofs.get(&en.creation), !self.is_draft(e));
        let place = self.place(en.creation);
        let at = At { attrs: Some(&attrs), place, groups: &r.groups };
        let through = |cp: &Issued| self.lets_through(cp, proof, main, &[rules::Touch::Create], at);
        let admitted = en.creator == en.vault
            || en
                .intake
                .iter()
                .any(|&c| self.share(c).is_some_and(|cp| self.eff_selects_at(cp, &attrs, r, place) && through(cp)));
        for w in &en.retags {
            if let Some(d) = r.tags.get(w) {
                attrs.tags = d.apply(&attrs.tags);
            }
        }
        let audience: Vec<ShareId> = if admitted {
            let public = |cp: &Issued| cp.share.who == Who::Everyone && !landed;
            let selects = |cp: &&Issued| {
                self.live(cp.id) && !cp.share.wide && !cp.share.level.is_keep() && !public(cp)
                    && self.eff_selects(cp, &attrs, r)
            };
            mk_audience(&self.shares_over(en.vault).filter(selects).map(|cp| cp.id).collect::<Vec<_>>())
        } else {
            vec![]
        };
        let live: Vec<ShareId> = self.shares_of(en.audience()).iter().copied().filter(|&c| self.live(c)).collect();
        let desired = (live != audience).then(|| audience.clone());
        // the keep shares that pick it, read as its shares are, and the wants a steward marks it with
        let picks = |k: &&Issued| {
            let mode = k.share.level.mode();
            mode.is_some_and(|m| self.live(k.id) && !k.share.wide && keep_picks(m, r.selectors.get(&k.id), &attrs))
        };
        let wants = mk_audience(&self.shares_over(en.vault).filter(picks).map(|k| k.id).collect::<Vec<_>>());
        let marked: Vec<ShareId> = self.wants_of(e).iter().copied().filter(|&x| self.live(x)).collect();
        let rewants = (marked != wants).then(|| wants.clone());
        // one mark of both, where either is due
        let mark = (desired.is_some() || rewants.is_some()).then(|| (desired.clone(), rewants));
        Some(Meaning { attrs, admitted, audience, desired, wants, mark })
    }

    /// Every share of `cp`'s chain, root first, is opened by one of `grants` in turn (`State.lean`'s `chainAllows`):
    /// each grant hashes to the commitment its share carries in the clear; its share's level is the class of its ops,
    /// or the share names a cap group, whose caps its level bounds (`Share.levelOk`); and the ops it grants where `at`
    /// judges the write (`ops_on`) allow the touches `touches` of a write on the main line (`main`) or on a proposal.
    pub fn chain_allows(
        &self,
        cp: &Issued,
        grants: &[Grant],
        main: bool,
        touches: &[rules::Touch],
        at: At<'_>,
    ) -> bool {
        cp.chain.len() == grants.len()
            && cp.chain.iter().zip(grants).all(|(c, g)| {
                self.share(*c).is_some_and(|x| {
                    x.commitment == Some(g.commitment())
                        && (x.share.group.is_some() || x.share.level == g.level())
                        && rules::allows_all(&self.ops_on(&x.share, g, at), main, touches)
                })
            })
    }

    /// A write through share `cp` makes only ops it may, by what its proof shows (`State.lean`'s `lets`): the proof
    /// names `cp` and opens its chain's grants, which allow every touch of the write, on the main line (`main`) or on a
    /// proposal, where `at` judges it.
    pub fn lets_through(
        &self,
        cp: &Issued,
        proof: Option<&Proof>,
        main: bool,
        touches: &[rules::Touch],
        at: At<'_>,
    ) -> bool {
        proof.is_some_and(|p| p.share == cp.id && self.chain_allows(cp, &p.grants, main, touches, at))
    }

    /// Write `w`'s shares let it through, by its proof `proof`, its touches `touches` and the tags it asks for `asks`,
    /// where `at` judges it (C1 to C3; `State.lean`'s `counts`, but for what it builds on): it acts for its entry's
    /// vault, so it relies on no share (`Write::shares`), or one of the shares it was accepted through lets it. A
    /// creation touches only its creation, and its tags are its first; touches its readers couldn't read (`None`) pass
    /// no share.
    pub fn lets(
        &self,
        w: &Write,
        proof: Option<&Proof>,
        touches: Option<&[rules::Touch]>,
        asks: &TagDelta,
        at: At<'_>,
    ) -> bool {
        if w.shares.is_empty() {
            return true;
        }
        let touches: Vec<rules::Touch> = match touches {
            _ if w.first => vec![rules::Touch::Create],
            Some(ts) => ts.iter().cloned().chain(rules::asked(asks)).collect(),
            None => return false,
        };
        let main = w.proposal == Proposal::Main;
        w.shares.iter().any(|c| self.share(*c).is_some_and(|cp| self.lets_through(cp, proof, main, &touches, at)))
    }

    /// The writes of entry `e` its readers don't count, by the proofs, touches, tags and fits `r` holds, in the order
    /// they were accepted (`State.lean`'s `uncounted`): a write that doesn't fit, one no share of its lets through, a
    /// merge into the main line through a share that the vault's accepts don't let through (`passes`, M2), a write on
    /// the main line of a draft not yet landed through a share (only its vault lands it, `history::History::lands`),
    /// and every write that builds on one.
    pub fn uncounted(&self, e: EntryId, r: &Readings) -> Vec<EditId> {
        self.counting(e, r).0
    }

    /// Entry `e` has landed, by what `r` holds (`State.lean`'s `landed`): it is no draft, or a write its readers count
    /// on the main line builds on its creation (`history::History::landed`).
    pub fn landed(&self, e: EntryId, r: &Readings) -> bool {
        self.counting(e, r).1
    }

    /// Entry `e` is a draft: its creation, which every peer reads in the clear, started its own line.
    pub fn is_draft(&self, e: EntryId) -> bool {
        self.entry(e).and_then(|en| self.write(en.creation)).is_some_and(|w| w.proposal == Proposal::New)
    }

    /// `uncounted` and `landed`, in one pass over entry `e`'s writes in the order they were accepted: each judged on
    /// what came before it, as its readers judge it, by the cap groups `r` holds (`Counter`).
    fn counting(&self, e: EntryId, r: &Readings) -> (Vec<EditId>, bool) {
        let Some(en) = self.entry(e) else { return (vec![], true) };
        let mut counter = Counter::new(self, en, r);
        for w in self.entry_writes(e) {
            counter.judge(self, w, r, &r.groups);
        }
        (counter.out, counter.landed)
    }

    /// The writes of entry `e` its readers read as its vault's accepts, by the touches and tags `r` holds, in the order
    /// they were accepted (`State.lean`'s `accepts`, M2; `is_accept`).
    pub fn accepts_of(&self, e: EntryId, r: &Readings) -> Vec<EditId> {
        let none = TagDelta::default();
        let accept = |w: &&Write| {
            is_accept(w, r.touches.get(&w.edit).map(Vec::as_slice), r.tags.get(&w.edit).unwrap_or(&none))
        };
        self.entry_writes(e).filter(accept).map(|w| w.edit).collect()
    }

    /// Vault `v`'s schema lane, as a reader holding `r` reads it off the entries (`State.lean`'s `laneOf`, T17): of
    /// each entry of `v` whose type is schema or lens and whose creation acted for `v` itself on its main line and
    /// counts, the content of that creation (`Readings::blobs`), in the order the entries were created, each blob once
    /// (`BlobId::of`). A creation that acts for its own vault relies on no share, so it counts where it fits. Nothing
    /// else adds to it: not an entry another vault created through a share, which acts for its creator, nor a draft,
    /// nor any later write or tag; and when a removal cuts a creation, its blob leaves with its entry.
    pub fn lane_of<'a>(&'a self, v: VaultId, r: &'a Readings) -> Vec<&'a [u8]> {
        let mut seen = HashSet::new();
        let counts = |en: &&Entry| {
            self.write(en.creation).is_some_and(|w| {
                w.first && w.actor == v && w.proposal == Proposal::Main && !r.unfit.contains(&w.edit)
            })
        };
        self.entries
            .iter()
            .filter(|en| en.vault == v && r.headers.get(&en.creation).is_some_and(|h| h.ty.of_lane()))
            .filter(counts)
            .filter_map(|en| r.blobs.get(&en.creation))
            .filter(|b| seen.insert(BlobId::of(b)))
            .map(|b| &b[..])
            .collect()
    }

    /// The write rule by meaning: vault `a` is the entry's vault, or holds a live share with write or more over it that
    /// is wide, or whose slice holds the entry and its creation was let in, by the cap groups in force now.
    pub fn sem_write(&self, a: VaultId, e: EntryId, r: &Readings) -> bool {
        let (Some(en), Some(m)) = (self.entry(e), self.meaning(e, r)) else { return false };
        a == en.vault
            || self.shares_held(a).any(|cp| {
                cp.share.over == en.vault
                    && self.holds(a, cp, Level::Write)
                    && (cp.share.wide || (m.admitted && self.eff_selects(cp, &m.attrs, r)))
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

    /// A new entry in audience `x` of vault `v` brings the audience back into use: no entry is in it, and its current
    /// key was sealed before. Settling then moves the audience to a new epoch, which a device names for the creation
    /// (`Lab::create`): whoever a removal took out while the audience was empty may still hold its current key.
    pub fn reenters(&self, v: VaultId, x: AudienceId) -> bool {
        let k = KeyFam::Audience(v, x);
        !self.has_fam(k) && self.seals.secrets.contains(&self.current(k))
    }

    /// Every family whose epoch isn't 0, with its epoch.
    pub fn epochs(&self) -> impl Iterator<Item = (KeyFam, u64)> + '_ {
        self.epochs.iter().map(|(k, e)| (*k, *e))
    }

    /// The removal whose settling moved family `k` to epoch `e`: the same on every peer that holds the same edits,
    /// whichever way it replayed them.
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

    /// The key of entry `e` in its current stay, at its audience's current epoch.
    pub fn entry_key(&self, e: EntryId) -> Option<KeyName> {
        let en = self.entry(e)?;
        Some(KeyName::Entry(en.id, en.stay(), self.epoch(KeyFam::Audience(en.vault, en.audience()))))
    }

    /// Every key family that exists: each vault's seed, the key of each live share with read or more, and the key of
    /// each audience an entry is in.
    pub fn key_fams(&self) -> Vec<KeyFam> {
        let seeds = self.vaults.iter().map(|v| KeyFam::Seed(v.id));
        let shares = self
            .shares
            .iter()
            .filter(|cp| self.live(cp.id) && cp.share.level.allows(Level::Read))
            .map(|cp| KeyFam::Share(cp.share.over, cp.id));
        let mut seen = HashSet::new();
        let audiences =
            self.entries.iter().map(|en| KeyFam::Audience(en.vault, en.audience())).filter(|k| seen.insert(*k));
        seeds.chain(shares).chain(audiences.collect::<Vec<_>>()).collect()
    }

    /// Family `k` exists (`key_fams`).
    pub fn has_fam(&self, k: KeyFam) -> bool {
        match k {
            KeyFam::Seed(v) => self.vault(v).is_some(),
            KeyFam::Share(v, c) => {
                self.share(c).is_some_and(|cp| cp.share.over == v && self.live(c) && cp.share.level.allows(Level::Read))
            }
            KeyFam::Audience(v, x) => self.in_use.get(&x).is_some_and(|&(u, n)| u == v && n > 0),
        }
    }

    /// The live shares over vault `v` with read or more that reach the audience of the shares `x`: in it, or wide.
    fn read_shares(&self, v: VaultId, x: &[ShareId]) -> impl Iterator<Item = &Issued> {
        self.shares_over(v).filter(move |cp| {
            self.live(cp.id) && cp.share.level.allows(Level::Read) && (cp.share.wide || x.contains(&cp.id))
        })
    }

    /// The vaults that may read family `k` themselves (`readsV`): a seed's vault; a live share with read or more's
    /// vault and the vault it names; an audience's vault and the vaults the live shares with read or more reaching it
    /// name. Relay shares get no key.
    pub fn readers(&self, k: KeyFam) -> Vec<VaultId> {
        let who = |cp: &Issued| match cp.share.who {
            Who::Vault(g) => Some(g),
            _ => None,
        };
        match k {
            KeyFam::Seed(v) => vec![v],
            KeyFam::Share(v, c) => match self.share(c) {
                Some(cp) if cp.share.over == v && self.live(c) && cp.share.level.allows(Level::Read) => {
                    std::iter::once(v).chain(who(cp)).collect()
                }
                _ => vec![],
            },
            KeyFam::Audience(v, x) => {
                std::iter::once(v).chain(self.read_shares(v, self.shares_of(x)).filter_map(who)).collect()
            }
        }
    }

    /// Vault `y` itself may read family `k`.
    pub fn reads_vault(&self, y: VaultId, k: KeyFam) -> bool {
        self.readers(k).contains(&y)
    }

    /// Everyone may read family `k`: a live share with read to everyone reaches it.
    pub fn public_key(&self, k: KeyFam) -> bool {
        match k {
            KeyFam::Seed(_) => false,
            KeyFam::Share(v, c) => self.share(c).is_some_and(|cp| {
                cp.share.over == v
                    && self.live(c)
                    && cp.share.level.allows(Level::Read)
                    && cp.share.who == Who::Everyone
            }),
            KeyFam::Audience(v, x) => self.read_shares(v, self.shares_of(x)).any(|cp| cp.share.who == Who::Everyone),
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
    /// owner vaults; a share key is derived from its vault's seed and sealed to its grantee's; an audience key is
    /// derived from its vault's seed and wrapped under the key of each share with read or more that reaches it.
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
            KeyFam::Share(v, c) => {
                let who = self.share(c).and_then(|cp| match cp.share.who {
                    Who::Vault(g) => Some(seed(g)),
                    _ => None,
                });
                std::iter::once(seed(v)).chain(who).collect()
            }
            KeyFam::Audience(v, x) => std::iter::once(seed(v))
                .chain(self.read_shares(v, self.shares_of(x)).map(|cp| self.current(KeyFam::Share(v, cp.id))))
                .collect(),
        }
    }

    /// What an agent holding the keys `start` can open: what is published, and whatever is sealed or wrapped to a key
    /// it can open, or derived from one. No key is learned any other way.
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
    /// able to open; or the key of one of an entry's stays, when `d` should be able to open the key of the entry's
    /// audience. An entry key's epoch is its writes' to name: a stay's audience may have moved on by edits of other
    /// entries that a reader of this one never holds (`Action::Write`), and the boxes go only where the schedule seals
    /// the key, which only the entry's own writes and stays make it.
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
            KeyName::Entry(e, s, _) => {
                let en = self.entry(e).ok_or(Refusal::UnknownKey)?;
                if !self.entitled(d, KeyFam::Audience(en.vault, en.audience())) {
                    return Err(Refusal::NotEntitled);
                }
                en.stay_audience(s).map(drop).ok_or(Refusal::UnknownKey)
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
        self.apply(change, edit, id);
        Ok(())
    }

    /// The change `check` worked out for edit `edit`, whose id is `id`, made.
    fn apply(&mut self, change: Change, edit: &Edit, id: EditId) {
        if change.removes() {
            self.remove(change, edit, id);
        } else {
            let touch = self.commit(change);
            self.settle(touch, id);
        }
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
        let drops = change.removes() || matches!(change, Change::Mark { to: Some(_), .. });
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
                // no more owners than its kind takes, each of which may own one more of its kind
                self.owners_count(*kind, owners)?;
                if *threshold == 0 || *threshold as usize > owners.len() {
                    return Err(Refusal::BadThreshold);
                }
                // every first owner consents
                if !owners.iter().all(|&p| approves(p)) {
                    return Err(Refusal::NoConsent);
                }
                let (owners_, devices) = (owners.clone(), vec![]);
                let vt = Vault { id: v, kind: *kind, owners: owners_, threshold: *threshold, devices, root: *root };
                let keys = seal_to.iter().filter(|(s, _)| owners.contains(&Principal::Signer(*s))).cloned().collect();
                Ok(Change::Genesis(vt, keys))
            }
            Action::Share(Sharing::Owner { vault, owner, seal_to }) => {
                let (v, owner) = (*vault, *owner);
                let at = vault_at(v)?;
                let vt = &self.vaults[at];
                if vt.owners.contains(&owner) {
                    return Err(Refusal::AlreadyMember);
                }
                self.owner_fits(vt.kind, owner)?;
                // no more owners than its kind takes, and the newcomer may own one more of its kind
                if !vt.kind.rules().takes(vt.owners.len() + 1) {
                    return Err(Refusal::OneOwner);
                }
                if !self.room_for(vt.kind, owner) {
                    return Err(Refusal::SecondAven);
                }
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
            Action::Revoke(Revoking::Owner { vault, owner, .. }) => {
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
            &Action::Settings { vault, set: Setting::Threshold(threshold) } => {
                let at = vault_at(vault)?;
                if threshold == 0 || threshold as usize > self.vaults[at].owners.len() {
                    return Err(Refusal::BadThreshold);
                }
                if !approves(Principal::Vault(vault)) {
                    return Err(Refusal::BelowThreshold);
                }
                Ok(Change::SetThreshold { at, threshold })
            }
            Action::Share(Sharing::Device { vault, device, seal_to }) => {
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
            Action::Revoke(Revoking::Device { vault, device, .. }) => {
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
            &Action::Settings { vault, set: Setting::Root { root, .. } } => {
                let at = vault_at(vault)?;
                // the vault's owners hand the root on, by its threshold, as any change (every owner equal: Samuel
                // 2026-10-19), and the new root signs; only a human vault has one
                if !approves(Principal::Vault(vault)) {
                    return Err(Refusal::BelowThreshold);
                }
                if root.is_some_and(|r| !sigs.contains(&r)) {
                    return Err(Refusal::NoConsent);
                }
                if root.is_some() && self.vaults[at].kind != Kind::Human {
                    return Err(Refusal::NotHuman);
                }
                Ok(Change::SetRoot { at, root })
            }
            Action::Share(Sharing::Grant(c, via)) => {
                let cid = ShareId::from(id);
                if self.share(cid).is_some() {
                    return Err(Refusal::Duplicate);
                }
                if self.vault(c.over).is_none() {
                    return Err(Refusal::UnknownVault);
                }
                // a share names a device exactly when it is a keep share (T4)
                match (c.level.is_keep(), c.who) {
                    (true, Who::Vault(_) | Who::Everyone | Who::Invite(_)) => return Err(Refusal::KeepNeedsDevice),
                    (false, Who::Device(_)) => return Err(Refusal::DeviceOnlyKeeps),
                    _ => {}
                }
                // grants name vaults, everyone or an invite key, nor the vault they are over; everyone only reads; an
                // invite makes no owner, which takes the newcomer's consent
                match c.who {
                    Who::Vault(x) if self.vault(x).is_none() => {
                        return Err(Refusal::UnknownVault);
                    }
                    Who::Vault(x) if x == c.over => return Err(Refusal::CapToItself),
                    Who::Everyone if c.level != Level::Read => return Err(Refusal::PublicBeyondRead),
                    Who::Invite(_) if c.level == Level::Owner => return Err(Refusal::InviteOwner),
                    _ => {}
                }
                // owner of the whole vault is an owner of it, which only the vault's approval and the newcomer's
                // consent make (`Sharing::Owner`), whoever approves this; owner of a slice is a grant
                if c.level == Level::Owner && c.wide {
                    return Err(Refusal::WideOwner);
                }
                // a vault keeps entries on its own devices only
                if let Who::Device(d) = c.who
                    && !self.is_device(d, c.issuer)
                {
                    return Err(Refusal::NotDevice);
                }
                if !self.acts_via(edit.author, via, c.issuer) {
                    return Err(Refusal::NotActing);
                }
                // a keep share rests on nothing, over a vault whose entries its issuer may hold, so no stranger has a
                // vault's stewards mark entries for it; any other share where its parent lets it
                if c.level.is_keep() {
                    if c.parent.is_some() {
                        return Err(Refusal::BadParent);
                    }
                    if !self.may_hold(c.issuer, c.over) {
                        return Err(Refusal::NoCap);
                    }
                } else if !self.share_parent_ok(c) {
                    return Err(Refusal::BadParent);
                }
                // making someone owner is governance
                if c.level == Level::Owner && !approves(Principal::Vault(c.issuer)) {
                    return Err(Refusal::BelowThreshold);
                }
                let above = c.parent.and_then(|p| self.share(p)).map(|p| &p.chain[..]).unwrap_or_default();
                let chain: Arc<[ShareId]> = above.iter().copied().chain([cid]).collect();
                let narrow: Vec<ShareId> = chain
                    .iter()
                    .copied()
                    .filter(|&x| if x == cid { !c.wide } else { self.share(x).is_some_and(|y| !y.share.wide) })
                    .collect();
                let intake = mk_audience(&narrow).into();
                // what every peer reads of its ops: the commitment to them
                let commitment = Select::from_wire(&c.select).ok().map(|s| s.commitment());
                Ok(Change::Share(Issued { id: cid, share: c.clone(), chain, intake, commitment }))
            }
            &Action::Revoke(Revoking::Grant { share, actor, ref via, .. }) => {
                let c = self.share(share).ok_or(Refusal::UnknownCap)?;
                if !self.live(share) {
                    return Err(Refusal::Revoked);
                }
                if !self.acts_via(edit.author, via, actor) {
                    return Err(Refusal::NotActing);
                }
                if !self.may_revoke(actor, c) {
                    return Err(Refusal::NoCap);
                }
                if c.share.level == Level::Owner && !approves(Principal::Vault(actor)) {
                    return Err(Refusal::BelowThreshold);
                }
                // the share and every share resting on it end
                let ending = self
                    .shares
                    .iter()
                    .filter(|x| x.chain.contains(&share) && !self.revoked.contains(&x.id))
                    .map(|x| x.id);
                Ok(Change::Revoke(ending.collect()))
            }
            Action::Write { vault, entry, actor, stay, epoch, deps, proposal, via, create, .. } => {
                let (v, e, actor, stay, epoch, proposal) = (*vault, *entry, *actor, *stay, *epoch, *proposal);
                if self.write_at.contains_key(&id) {
                    return Err(Refusal::Duplicate);
                }
                if !self.acts_via(edit.author, via, actor) {
                    return Err(Refusal::NotActing);
                }
                match create {
                    Some(Creation { audience: x, .. }) => {
                        // a new entry, with an id never used before, in an audience its actor may create in, under
                        // the epoch it names
                        if self.entry(e).is_some() || self.born.contains(&e) {
                            return Err(Refusal::Reborn);
                        }
                        if self.vault(v).is_none() {
                            return Err(Refusal::UnknownVault);
                        }
                        // on main, or a draft that starts its own line, read in the clear as an owner reads it (T25)
                        if stay.is_some() || !deps.is_empty() || matches!(proposal, Proposal::On(_)) {
                            return Err(Refusal::NotFirst);
                        }
                        if !self.audience_ok(v, x) {
                            return Err(Refusal::BadAudience);
                        }
                        let intake = self.intake_shares(actor, v, x);
                        if actor != v && intake.is_empty() {
                            return Err(Refusal::NoCap);
                        }
                        let audience = AudienceId::of(v, x);
                        let w = Write {
                            edit: id,
                            author: edit.author,
                            actor,
                            entry: e,
                            stay: None,
                            epoch,
                            deps: vec![],
                            proposal,
                            via: via.clone(),
                            first: true,
                            audience,
                            shares: intake.clone(),
                        };
                        let en = Entry {
                            id: e,
                            vault: v,
                            stays: vec![(None, audience)],
                            creator: actor,
                            creation: id,
                            intake,
                            retags: vec![],
                        };
                        Ok(Change::Create(en, Box::new(w), x.as_slice().into()))
                    }
                    None => {
                        let en = self.entry(e).ok_or(Refusal::UnknownEntry)?;
                        if en.vault != v {
                            return Err(Refusal::WrongVault);
                        }
                        // a vault holds no share over itself, so its own writes rely on none
                        let shares = self.write_shares(actor, e, v, self.shares_of(en.audience()));
                        if actor != v && shares.is_empty() {
                            return Err(Refusal::NoCap);
                        }
                        let (deps, via) = (deps.clone(), via.clone());
                        let w = Write {
                            edit: id,
                            author: edit.author,
                            actor,
                            entry: e,
                            stay,
                            epoch,
                            deps,
                            proposal,
                            via,
                            first: false,
                            audience: en.audience(),
                            shares,
                        };
                        en.stay_audience(stay).ok_or(Refusal::UnknownStay)?;
                        // what it builds on was accepted, so the accepted writes stay causally closed (T14); a write
                        // on a proposal builds on the proposal's start
                        builds_on(&self.entry_writes(e).collect::<Vec<_>>(), &w)?;
                        // only the vault's own devices change tags; anyone else asks them to, in its body
                        Ok(Change::Write(w, actor == v))
                    }
                }
            }
            Action::Mark { vault, entry, caps, wants, keep, via } => {
                let (v, e) = (*vault, *entry);
                let at = self.entry_at.get(&e).copied().ok_or(Refusal::UnknownEntry)?;
                let en = &self.entries[at];
                // only a steward marks an entry of its vault
                if en.vault != v {
                    return Err(Refusal::WrongVault);
                }
                if !self.acts_via(edit.author, via, v) {
                    return Err(Refusal::NotActing);
                }
                // it marks an audience, the keep shares that pick the entry, or both; only a new audience is a
                // removal, which keeps what it had seen
                if caps.is_none() && (wants.is_none() || !keep.is_empty()) {
                    return Err(Refusal::BadMark);
                }
                // another audience of the vault, and a mark begins one stay
                let to = match caps {
                    None => None,
                    Some(to) => {
                        if !self.audience_ok(v, to) {
                            return Err(Refusal::BadAudience);
                        }
                        let audience = AudienceId::of(v, to);
                        if audience == en.audience() {
                            return Err(Refusal::SameAudience);
                        }
                        if en.stays.iter().any(|(s, _)| *s == Some(id)) {
                            return Err(Refusal::Duplicate);
                        }
                        Some((audience, to.as_slice().into()))
                    }
                };
                // wants of the vault, other than the entry's but where the mark takes it to a new audience: keep shares
                // over the vault that aren't wide, as a wide one picks by being wide. Neither list asks whether what it
                // names is live: a revocation of a share or a keep share that sorts before the mark mustn't refuse it,
                // and readers leave out what isn't live
                let wants = match wants {
                    None => None,
                    Some(ks) => {
                        let fits = |&k: &ShareId| {
                            self.share(k).is_some_and(|x| x.share.level.is_keep() && x.share.over == v && !x.share.wide)
                        };
                        if !canonical(ks) || !ks.iter().all(fits) {
                            return Err(Refusal::BadWants);
                        }
                        if caps.is_none() && ks[..] == *self.wants_of(e) {
                            return Err(Refusal::SameWants);
                        }
                        Some(ks.as_slice().into())
                    }
                };
                Ok(Change::Mark { at, stay: id, to, wants })
            }
            &Action::Claim { share, vault, ref via } => {
                // a live share that names an invite key, which signs, claimed by a member of a vault there is acting
                // for it, other than the vault the share is over
                let at = self.share_at.get(&share).copied().ok_or(Refusal::UnknownCap)?;
                let Who::Invite(k) = self.shares[at].share.who else { return Err(Refusal::NotInvite) };
                if !self.live(share) {
                    return Err(Refusal::Revoked);
                }
                if !sigs.contains(&k) {
                    return Err(Refusal::NoConsent);
                }
                if !self.acts_via(edit.author, via, vault) {
                    return Err(Refusal::NotActing);
                }
                if self.vault(vault).is_none() {
                    return Err(Refusal::UnknownVault);
                }
                if vault == self.shares[at].share.over {
                    return Err(Refusal::CapToItself);
                }
                Ok(Change::Claim { at, vault })
            }
            Action::Wraps { entry, wraps } => {
                // each of the entry's own keys, wrapped where the schedule seals it, by a signer that may open it
                if wraps.is_empty() || !wraps.iter().all(|w| matches!(w.name, KeyName::Entry(e, ..) if e == *entry)) {
                    return Err(Refusal::BadWraps);
                }
                for w in wraps {
                    self.may_box(edit.author, w.name)?;
                    if !self.sealed(w.name, w.boxed.to.name()) {
                        return Err(Refusal::Unsealed);
                    }
                }
                Ok(Change::Nothing)
            }
            &Action::Checkpoint { vault, .. } => {
                vault_at(vault)?;
                if !approves(Principal::Vault(vault)) {
                    return Err(Refusal::BelowThreshold);
                }
                Ok(Change::Nothing)
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
            Change::Share(issued) => {
                let (c, v, i) = (issued.id, issued.share.over, self.shares.len());
                // a new share with read or more has a key, and a wide one reaches every audience in use; no audience in
                // use holds a share that didn't exist yet
                let mut grew = vec![];
                if issued.share.level.allows(Level::Read) {
                    grew.push(KeyFam::Share(v, c));
                    if issued.share.wide {
                        let mut seen = HashSet::new();
                        let audiences = self.entries.iter().filter(|en| en.vault == v).map(|en| en.audience());
                        grew.extend(audiences.filter(|x| seen.insert(*x)).map(|x| KeyFam::Audience(v, x)));
                    }
                }
                if let Who::Vault(g) = issued.share.who {
                    Arc::make_mut(&mut self.held).entry(g).or_default().push(i);
                }
                Arc::make_mut(&mut self.over).entry(v).or_default().push(i);
                Arc::make_mut(&mut self.share_at).insert(c, i);
                Arc::make_mut(&mut self.shares).push(issued);
                Touch::Grew(grew)
            }
            Change::Revoke(ending) => {
                let revoked = Arc::make_mut(&mut self.revoked);
                for c in ending {
                    revoked.push(c);
                }
                Touch::Nothing
            }
            // the share names the vault now, whose seed its key is sealed to from now on
            Change::Claim { at, vault } => {
                let cp = &mut Arc::make_mut(&mut self.shares)[at];
                cp.share.who = Who::Vault(vault);
                let (c, v, read) = (cp.id, cp.share.over, cp.share.level.allows(Level::Read));
                Arc::make_mut(&mut self.held).entry(vault).or_default().push(at);
                Touch::Grew(if read { vec![KeyFam::Share(v, c)] } else { vec![] })
            }
            Change::Create(en, w, shares) => {
                let (e, v, audience, i) = (en.id, en.vault, en.audience(), self.entries.len());
                Arc::make_mut(&mut self.audiences).entry(audience).or_insert(shares);
                let fresh = self.enter(v, audience);
                Arc::make_mut(&mut self.born).push(e);
                Arc::make_mut(&mut self.entry_at).insert(e, i);
                Arc::make_mut(&mut self.entries).push(en);
                self.add_write(*w);
                Touch::Created { entry: i, fresh }
            }
            Change::Write(w, retag) => {
                if retag {
                    let at = self.entry_at[&w.entry];
                    Arc::make_mut(&mut self.entries)[at].retags.push(w.edit);
                }
                Touch::Wrote(self.add_write(w))
            }
            Change::Mark { at, stay, to, wants } => {
                if let Some(wants) = wants {
                    Arc::make_mut(&mut self.marks).insert(self.entries[at].id, wants);
                }
                let Some((to, shares)) = to else { return Touch::Nothing };
                let (v, from) = (self.entries[at].vault, self.entries[at].audience());
                Arc::make_mut(&mut self.audiences).entry(to).or_insert(shares);
                self.leave(from);
                let fresh = self.enter(v, to);
                Arc::make_mut(&mut self.entries)[at].stays.push((Some(stay), to));
                Touch::Moved { entry: at, fresh }
            }
        }
    }

    /// One more entry in audience `x` of vault `v`: whether the audience was empty before.
    fn enter(&mut self, v: VaultId, x: AudienceId) -> bool {
        let n = &mut Arc::make_mut(&mut self.in_use).entry(x).or_insert((v, 0)).1;
        *n += 1;
        *n == 1
    }

    /// One entry fewer in audience `x`.
    fn leave(&mut self, x: AudienceId) {
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

    /// Index the entries and the writes again, and count the audiences in use.
    fn index_entries(&mut self) {
        self.entry_at = Arc::new(self.entries.iter().enumerate().map(|(i, en)| (en.id, i)).collect());
        self.write_at = Arc::new(self.writes.iter().enumerate().map(|(i, w)| (w.edit, i)).collect());
        let mut by_entry: HashMap<EntryId, Vec<usize>> = HashMap::new();
        for (i, w) in self.writes.iter().enumerate() {
            by_entry.entry(w.entry).or_default().push(i);
        }
        self.by_entry = Arc::new(by_entry);
        let mut in_use: HashMap<AudienceId, (VaultId, usize)> = HashMap::new();
        for en in self.entries.iter() {
            in_use.entry(en.audience()).or_insert((en.vault, 0)).1 += 1;
        }
        self.in_use = Arc::new(in_use);
    }

    /* Settling the keys */

    /// After a change that removed nothing: seal what it added, link what it wrote. Every holder that opened a current
    /// key of a family in use was entitled to it (T6), and outside removals no entitlement shrinks, so no key goes
    /// stale but an audience's that comes back into use: while it was empty its key didn't move on with the removals.
    fn settle(&mut self, touch: Touch, id: EditId) {
        match touch {
            Touch::Nothing => {}
            Touch::Grew(fams) => self.seal_fams(&fams),
            Touch::Created { entry, fresh } | Touch::Moved { entry, fresh } => {
                let en = &self.entries[entry];
                let k = KeyFam::Audience(en.vault, en.audience());
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
                let x = en.stay_audience(w.stay).expect("a write's stay");
                let to = KeyName::Scoped(KeyFam::Audience(en.vault, x), w.epoch);
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
    /// key. So is an audience that comes back into use, an entry moving into it again: while it was empty its key
    /// didn't move on with the removals, so whoever a removal took out then may still open it. A vault's share and
    /// audience keys are derived from its seed, so when the seed starts a new epoch they all do too. Called after the
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
                        KeyFam::Share(v, _) | KeyFam::Audience(v, _) => seeds.contains(v),
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

    /// The model's `linkAll`: every entry's key in its current stay derives from its audience's current key, and the
    /// key each accepted write used from its stay's audience key of that epoch; the key of each write from an earlier
    /// stay is wrapped under the current stay's key, unless it already is under some key of that stay.
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
                Fact::Share(c) => Arc::make_mut(&mut st.revoked).push(*c),
                Fact::Audience(e, shares) => st.narrow.push((*e, shares.clone())),
                _ => {}
            }
        }
        st
    }

    /// Edit `edit`, whose id is `id`, would be accepted here.
    pub fn accepts(&self, edit: &Edit, id: EditId) -> Result<(), Refusal> {
        self.check(edit, id).map(drop)
    }

    /// `accepts`, and for a write, the write it would be, with the shares its readers would judge it by
    /// (`Write::shares`): what a device proves a write of its own by (`rules::Proof`).
    pub fn accepted_write(&self, edit: &Edit, id: EditId) -> Result<Option<Write>, Refusal> {
        Ok(match self.check(edit, id)? {
            Change::Create(_, w, _) => Some(*w),
            Change::Write(w, _) => Some(w),
            _ => None,
        })
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

/// The model's `linkAll` for one entry `en` and its writes `ws`: its key in its current stay derives from its
/// audience's current key, each write's key from its stay's audience key of its epoch, and the key of a write from an
/// earlier stay is wrapped under the current stay's key, unless some key of that stay already wraps it. So whoever
/// reads an entry now reads its whole history, and a move hands nobody a key of the audience the entry left (T24).
fn link<'a>(seals: &mut Seals, epochs: &HashMap<KeyFam, u64>, en: &Entry, ws: impl IntoIterator<Item = &'a Write>) {
    let epoch = |k: KeyFam| epochs.get(&k).copied().unwrap_or(0);
    let audience = KeyFam::Audience(en.vault, en.audience());
    let key = KeyName::Entry(en.id, en.stay(), epoch(audience));
    seals.add(Seal { secret: key, to: KeyName::Scoped(audience, epoch(audience)) });
    for w in ws {
        let x = en.stay_audience(w.stay).unwrap_or_else(|| AudienceId::of(en.vault, &[]));
        seals.add(Seal { secret: w.key(), to: KeyName::Scoped(KeyFam::Audience(en.vault, x), w.epoch) });
        if w.stay != en.stay() && !seals.linked.contains(&(w.key(), en.id, en.stay())) {
            seals.add(Seal { secret: w.key(), to: key });
        }
    }
}

/// Write `w`, read with the touches `touches` and asking for the tags `asks`, is its entry's vault accepting the
/// proposal it is on (M2; `State.lean`'s `isAccept`): a write of the vault for itself, relying on no share, on a
/// proposal, that changes nothing and asks for no tag. The only policy so far, every vault's default, is one of the
/// vault's owners: whoever acts for the vault as its owner accepts for it. The accept is in the entry's own log, so
/// every reader of the entry reads it, offline, and reaches the same verdict; touches its readers couldn't read
/// (`None`) accept nothing.
pub fn is_accept(w: &Write, touches: Option<&[rules::Touch]>, asks: &TagDelta) -> bool {
    w.shares.is_empty()
        && matches!(w.proposal, Proposal::On(_))
        && touches.is_some_and(<[rules::Touch]>::is_empty)
        && asks.add.is_empty()
        && asks.remove.is_empty()
}

/// Write `w`, read with the touches `touches`, merges into the main line relying on a share, so it counts only on top
/// of its vault's accept (M2; `passes`). The vault's own merges need none, as before.
pub fn needs_accept(w: &Write, touches: Option<&[rules::Touch]>) -> bool {
    !w.shares.is_empty()
        && w.proposal == Proposal::Main
        && touches.is_some_and(|ts| ts.contains(&rules::Touch::Merge))
}

/// Write `w`, read with the touches `touches`, passes its entry's merge policy (M2; `State.lean`'s `counts` and
/// `accepted`): where it needs an accept (`needs_accept`), it builds on one (`accept`), and on nothing but accepts and
/// writes on the main line (`main`), so all it brings in is what the vault accepted, and a proposal that moved on
/// since asks again. Any other write passes.
pub fn passes(
    w: &Write,
    touches: Option<&[rules::Touch]>,
    accept: impl Fn(&EditId) -> bool,
    main: impl Fn(&EditId) -> bool,
) -> bool {
    !needs_accept(w, touches) || (w.deps.iter().any(&accept) && w.deps.iter().all(|d| accept(d) || main(d)))
}

/// Judges the writes of one entry one after the other, in the order they were accepted, each on what came before it,
/// as its readers judge them (`State.lean`'s `counts` and `creates`): a write that doesn't fit, one no share of its
/// lets through, a merge into the main line through a share that the vault's accepts don't let through (`passes`,
/// M2), a write on the main line of a draft not yet landed through a share (only its vault lands it,
/// `history::History::lands`), and every write that builds on one, they don't count.
struct Counter {
    vault: VaultId,
    entry: EntryId,
    /// The writes they don't count so far.
    out: Vec<EditId>,
    accepts: HashSet<EditId>,
    /// It is no draft, or a counted write on the main line holds its creation; and the counted writes that hold it.
    landed: bool,
    holding: HashSet<EditId>,
    /// Its attributes before the next write, where its readers read its header: its first ones, and the tags of each
    /// write acting for its vault.
    attrs: Option<Attrs>,
    /// Whose each row is, by the writes counted so far.
    mine: Mine,
}

/// Whose the places of an entry are, by its writes its readers counted so far, one after the other in the order they
/// were accepted (`State.lean`'s `owns`): a place inside a row is the writer's own where the innermost row it lies in
/// was added by that vault's counted writes and no one else's; a place in no row, where its counted creation was that
/// vault's. Every reader of the entry counts the same writes, so every reader reaches the same verdict (C2). Two vaults
/// that add a row with one id own it neither.
#[derive(Clone, Debug, Default)]
pub struct Mine {
    adders: HashMap<crate::ops::Loc, Vec<VaultId>>,
    creator: Option<VaultId>,
}

impl Mine {
    /// Place `l` is vault `a`'s own.
    pub fn owns(&self, a: VaultId, l: &crate::ops::Loc) -> bool {
        match l.row() {
            Some(r) => self.adders.get(&r).is_some_and(|vs| !vs.is_empty() && vs.iter().all(|v| *v == a)),
            None => self.creator == Some(a),
        }
    }

    /// Touches `ts` of a write by vault `a` as its readers judge them (`State.lean`'s `mine`): each set at a place that
    /// is `a`'s own marked own (`rules::Touch::Own`), each other set not, whatever the write claims, the rest as they
    /// are.
    pub fn mark(&self, a: VaultId, ts: &[rules::Touch]) -> Vec<rules::Touch> {
        use rules::Touch;
        let set = |l: &crate::ops::Loc, v: &Option<rules::Scalar>| match self.owns(a, l) {
            true => Touch::Own(l.clone(), v.clone()),
            false => Touch::Set(l.clone(), v.clone()),
        };
        ts.iter()
            .map(|t| match t {
                Touch::Set(l, v) | Touch::Own(l, v) => set(l, v),
                t => t.clone(),
            })
            .collect()
    }

    /// Write `w`, which added the rows `adds`, was judged: where its readers count it, those rows are its actor's too,
    /// and a creation makes its actor the entry's creator.
    pub fn note(&mut self, w: &Write, adds: &[crate::ops::Loc], counted: bool) {
        if !counted {
            return;
        }
        if w.first {
            self.creator = Some(w.actor);
        }
        for l in adds {
            self.adders.entry(l.clone()).or_default().push(w.actor);
        }
    }
}

impl Counter {
    fn new(st: &State, en: &Entry, r: &Readings) -> Counter {
        Counter {
            vault: en.vault,
            entry: en.id,
            out: vec![],
            accepts: HashSet::new(),
            landed: !st.is_draft(en.id),
            holding: HashSet::new(),
            attrs: st.first_attrs(en, r),
            mine: Mine::default(),
        }
    }

    /// Judge the next write of the entry, `w`, by the cap groups `groups` holds: whether its readers count it.
    fn judge(&mut self, st: &State, w: &Write, r: &Readings, groups: &Groups) -> bool {
        let none = TagDelta::default();
        let (touches, asks) = (r.touches.get(&w.edit).map(Vec::as_slice), r.tags.get(&w.edit).unwrap_or(&none));
        let e = self.entry;
        let main = |d: &EditId| st.write(*d).is_some_and(|x| x.entry == e && x.proposal == Proposal::Main);
        let at = At { attrs: self.attrs.as_ref(), place: st.place(w.edit), groups };
        let marked = touches.map(|ts| self.mine.mark(w.actor, ts));
        let lets = !r.unfit.contains(&w.edit)
            && st.lets(w, r.proofs.get(&w.edit), marked.as_deref(), asks, at)
            && passes(w, touches, |d| self.accepts.contains(d), main)
            && (w.shares.is_empty() || w.proposal != Proposal::Main || self.landed);
        let counted = !w.deps.iter().any(|d| self.out.contains(d)) && lets;
        self.mine.note(w, r.adds.get(&w.edit).map_or(&[][..], Vec::as_slice), counted);
        if !counted {
            self.out.push(w.edit);
        } else if w.first || w.deps.iter().any(|d| self.holding.contains(d)) {
            self.holding.insert(w.edit);
            self.landed |= w.proposal == Proposal::Main;
        }
        if is_accept(w, touches, asks) {
            self.accepts.insert(w.edit);
        }
        // its tags count from now on where it acts for the vault
        if !w.first
            && w.actor == self.vault
            && let (Some(a), Some(d)) = (&mut self.attrs, r.tags.get(&w.edit))
        {
            a.tags = d.apply(&a.tags);
        }
        counted
    }
}

/// What an entry's readers and its vault's stewards read where no relay can: each share's selector, a keep share's too,
/// opened from its sealed `select`; each entry's header, the schema or lens a schema or lens entry's creation holds,
/// and each write's tags and proof, from inside the writes' bodies; what each write touches, and whether it fits the
/// schemas its entry was written under, read off its update on the version it builds on
/// (`history::History::reading`); and the cap group each write of a cap group entry says, and what that makes of the
/// vaults' cap groups (`Groups`).
#[derive(Clone, Debug, Default)]
pub struct Readings {
    pub selectors: HashMap<ShareId, Selector>,
    /// By the edit that created the entry.
    pub headers: HashMap<EditId, Header>,
    /// By the edit that created a schema or lens entry (`slice::Sym::of_lane`): the content it holds, the schema or the
    /// lens, which its vault's lane names by its hash (`State::lane_of`).
    pub blobs: HashMap<EditId, Arc<[u8]>>,
    /// By the write.
    pub tags: HashMap<EditId, TagDelta>,
    pub proofs: HashMap<EditId, Proof>,
    pub touches: HashMap<EditId, Vec<rules::Touch>>,
    /// By the write: the rows it added, each by its place (`doc::Footprint::adds`), where it added any.
    pub adds: HashMap<EditId, Vec<crate::ops::Loc>>,
    /// The writes that don't fit.
    pub unfit: HashSet<EditId>,
    /// By the write: the cap group it says, a write of a cap group entry (`slice::Body::defines`).
    pub defines: HashMap<EditId, rules::CapGroup>,
    /// The cap groups in force, as the reader counts the writes that say them: worked out of the rest
    /// (`State::read_groups`), so set it again whenever they change. Until then every share that names a cap group
    /// grants nothing.
    pub groups: Groups,
}

/// The cap groups as a reader reads them (`State.lean`'s `groupAt`): of each cap group entry, an entry its vault
/// created itself of type `slice::CAP_GROUP_TYPE`, what each write of the vault's own on its main line that the reader
/// counts says the group is, in the order they were accepted. The group in force at a place of the replay is what the
/// last of them before it says (`State::group_at`). So a new version narrows or widens at once every share that names
/// the group, and every write is judged by the version in force where it comes in the one replay order, which every
/// reader reaches alike.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Groups {
    of: HashMap<EntryId, (VaultId, Vec<(EditId, Arc<rules::CapGroup>)>)>,
}

impl Groups {
    /// Every cap group entry that some counted write says a group of, with its vault.
    pub fn entries(&self) -> impl Iterator<Item = (EntryId, VaultId)> + '_ {
        self.of.iter().map(|(e, (v, _))| (*e, *v))
    }

    /// No write says a cap group.
    pub fn is_empty(&self) -> bool {
        self.of.is_empty()
    }

    /// Write `w` of cap group entry `e` of vault `v`, which its readers count, says the group is `g`: the group in
    /// force past its place, until a later one says otherwise. Each in the order they were accepted.
    pub fn say(&mut self, e: EntryId, v: VaultId, w: EditId, g: &rules::CapGroup) {
        self.of.entry(e).or_insert_with(|| (v, vec![])).1.push((w, Arc::new(g.clone())));
    }

    /// The writes that say the groups, in a canonical order: what the groups are, as each write says one for good.
    pub fn writes(&self) -> Vec<EditId> {
        let mut out: Vec<EditId> = self.of.values().flat_map(|(_, xs)| xs.iter().map(|(w, _)| *w)).collect();
        out.sort_unstable();
        out
    }
}

/// Where a write is judged (`State::lets`): the attributes of its entry as they were when it came in, where its readers
/// read them, and its place in the replay, before which the cap groups in force are those `groups` says. Only a share
/// that names a cap group asks for them: its group's caps hold where they pick those attributes (`rules::Cap::holds`).
#[derive(Clone, Copy, Debug)]
pub struct At<'a> {
    pub attrs: Option<&'a Attrs>,
    pub place: usize,
    pub groups: &'a Groups,
}

/// What an entry means to its readers (`State::meaning`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Meaning {
    /// What its first write says of it, and its tags now.
    pub attrs: Attrs,
    /// Its creator was the vault itself, or created it inside the slice of a share it created it through, whose ops let
    /// a creation through.
    pub admitted: bool,
    /// Its semantic audience: the live shares over its vault that aren't wide nor keep shares and whose slice holds
    /// it, in canonical order; none for an entry its creator made outside its own slice.
    pub audience: Vec<ShareId>,
    /// Where a steward's mark takes it: nowhere while the live part of its audience is its semantic audience (a
    /// revoked share left in it is ignored, so a revocation moves no entry), else to its semantic audience.
    pub desired: Option<Vec<ShareId>>,
    /// The keep shares that pick it: the live ones over its vault that aren't wide and pick it (`keep_picks`), in
    /// canonical order (`semWants`), whether or not its creation was let in, and whether or not the device each names
    /// still acts for its issuer.
    pub wants: Vec<ShareId>,
    /// What a steward marks it with, in one mark (`desiredMark`): the audience it takes it to (`desired`), and the
    /// wants, none while the live part of the wants it is marked with is `wants` (a revoked keep share left in them is
    /// ignored, so revoking one marks no entry), else `wants`. A part left out stays as it is, so a steward that marks
    /// only the wants never puts back an audience another steward changed meanwhile. `None` while both are as they
    /// should be.
    pub mark: Option<(Option<Vec<ShareId>>, Option<Vec<ShareId>>)>,
}

/// A keep share of mode `mode` picks attributes `a`, as a steward reads its selector `select` (`keepPicks`): a whole
/// or an opened one picks what its selector matches and every schema, lens and cap group entry too
/// (`slice::Sym::synced_by_all`), so that every device that syncs part of a vault syncs its lane and its cap groups; a
/// never one picks what its selector matches but those. A selector the reader doesn't hold matches nothing.
pub fn keep_picks(mode: KeepMode, select: Option<&Selector>, a: &Attrs) -> bool {
    let matches = select.is_some_and(|s| s.matches(a));
    match mode {
        KeepMode::Never => matches && !a.ty.synced_by_all(),
        KeepMode::Whole | KeepMode::Opened => matches || a.ty.synced_by_all(),
    }
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

/// A grant some edit issues: its id, its parent, and whether it is a keep share.
type Issue = (ShareId, Option<ShareId>, bool);

/// The grants the edits issue, each with its parent and whether it is a keep share, among edits paired with their ids.
fn shares_issued<'a>(edits: impl Iterator<Item = (&'a Edit, EditId)>) -> Vec<Issue> {
    edits
        .filter_map(|(o, id)| match &o.action {
            Action::Share(Sharing::Grant(c, _)) => Some((ShareId::from(id), c.parent, c.level.is_keep())),
            _ => None,
        })
        .collect()
}

/// What removal `r` takes away: the owner, the device, the root, among the grants the edits `edits` issue the grant and
/// every grant resting on it, or for a mark that takes an entry to an audience the audience the entry no longer is in.
/// A mark of the wants alone is no removal, and takes nothing; nor does revoking a keep share take anything (K1):
/// nothing rests on one, no audience holds one, and no mark asks whether the keep shares it names are live.
pub fn removes(edits: &[Edit], r: &Edit) -> Vec<Fact> {
    removes_among(r, || shares_issued(edits.iter().map(|o| (o, o.id()))))
}

/// `removes`, the shares issued (`shares_issued`) worked out only for a revocation.
fn removes_among(r: &Edit, shares: impl FnOnce() -> Vec<Issue>) -> Vec<Fact> {
    match &r.action {
        Action::Revoke(Revoking::Owner { vault, owner, .. }) => vec![Fact::Owner(*vault, *owner)],
        Action::Revoke(Revoking::Device { vault, device, .. }) => vec![Fact::Device(*vault, *device)],
        Action::Settings { vault, set: Setting::Root { .. } } => vec![Fact::Root(*vault)],
        Action::Revoke(Revoking::Grant { share, .. }) => {
            let cs = shares();
            // the first grant of that id, as the model finds it
            if cs.iter().find(|x| x.0 == *share).is_some_and(|x| x.2) {
                return vec![];
            }
            let parent: HashMap<ShareId, Option<ShareId>> = cs.iter().rev().map(|x| (x.0, x.1)).collect();
            let rests_on = |x: ShareId| {
                let mut x = x;
                for _ in 0..=cs.len() {
                    if x == *share {
                        return true;
                    }
                    match parent.get(&x).copied().flatten() {
                        Some(p) => x = p,
                        None => return false,
                    }
                }
                false
            };
            cs.iter().filter(|x| rests_on(x.0)).map(|x| Fact::Share(x.0)).collect()
        }
        Action::Mark { entry, caps: Some(to), .. } => vec![Fact::Audience(*entry, to.as_slice().into())],
        _ => vec![],
    }
}

/// A removal among the edits being replayed: its position, the edits it keeps, and what it takes away.
struct Cut {
    at: usize,
    keep: HashSet<EditId>,
    facts: Vec<Fact>,
}

/// The moves among the edits being replayed, by the entry each takes to an audience: each one's place, the edits it
/// keeps and the audience's shares.
#[derive(Debug, Default, PartialEq, Eq)]
struct Moves(HashMap<EntryId, Vec<(usize, Arc<HashSet<EditId>>, Arc<[ShareId]>)>>);

impl Moves {
    /// The audience facts of the moves after place `at` that hadn't seen edit `id`.
    fn unseen(&self, at: usize, id: EditId) -> impl Iterator<Item = Fact> + '_ {
        self.0.iter().flat_map(move |(e, ms)| {
            ms.iter().filter(move |m| m.0 > at && !m.1.contains(&id)).map(move |m| Fact::Audience(*e, m.2.clone()))
        })
    }
}

/// The moves after the edit `run` checks (`State::late`): they hide nothing, and only note in `differs` whether any
/// that hadn't seen the edit would have kept a share out of an entry's audience. Every check's answer depends on the
/// moves hidden only through `in_audience`, so a check none of whose calls was answered otherwise answers as it would
/// with them hidden.
#[derive(Debug)]
struct Late {
    moves: Arc<Moves>,
    at: usize,
    id: EditId,
    differs: std::sync::atomic::AtomicBool,
}

impl Late {
    /// Share `cp`, in entry `e`'s audience, answered as it is; noting whether a move that hadn't seen the edit would
    /// have kept it out.
    fn allows(&self, cp: &Issued, e: EntryId) -> bool {
        let out = self.moves.0.get(&e).into_iter().flatten().any(|m| {
            m.0 > self.at && !m.1.contains(&self.id) && !m.2.contains(&cp.id)
        });
        if out {
            self.differs.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        true
    }
}

impl Clone for Late {
    fn clone(&self) -> Self {
        Late {
            moves: self.moves.clone(),
            at: self.at,
            id: self.id,
            differs: std::sync::atomic::AtomicBool::new(self.differs.load(std::sync::atomic::Ordering::Relaxed)),
        }
    }
}

impl PartialEq for Late {
    fn eq(&self, other: &Self) -> bool {
        self.moves == other.moves && self.at == other.at && self.id == other.id
    }
}

impl Eq for Late {}

/// One replay of edits already in `order`, with the removals `rem` and no others: an edit stands if the state before it
/// accepts it, and again with what each later removal that hadn't seen it takes away hidden. Which edits stood, and the
/// state at the end; with `states`, every state along the way too.
struct Run {
    stood: Vec<bool>,
    state: State,
    states: Vec<State>,
}

fn run(edits: &[Edit], ids: &[EditId], rem: &HashSet<EditId>, states: bool) -> Run {
    let shares = std::cell::OnceCell::new();
    let shares = || shares.get_or_init(|| shares_issued(edits.iter().zip(ids.iter().copied()))).clone();
    // the moves apart, looked up by entry: an edit is checked again with them hidden only where one would answer
    // otherwise (`Late`), not scanned for at every edit
    let mut cuts: Vec<Cut> = vec![];
    let mut moves = Moves::default();
    for (at, r) in edits.iter().enumerate().filter(|(i, _)| rem.contains(&ids[*i])) {
        let keep: HashSet<EditId> = r.action.keep().unwrap_or(&[]).iter().copied().collect();
        let facts = removes_among(r, shares);
        if !facts.is_empty() && facts.iter().all(|f| matches!(f, Fact::Audience(..))) {
            let keep = Arc::new(keep);
            for f in facts {
                if let Fact::Audience(e, to) = f {
                    moves.0.entry(e).or_default().push((at, keep.clone(), to));
                }
            }
        } else {
            cuts.push(Cut { at, keep, facts });
        }
    }
    let moves = (!moves.0.is_empty()).then(|| Arc::new(moves));
    let mut out = Run { stood: Vec::with_capacity(edits.len()), state: State::default(), states: vec![] };
    if states {
        out.states.push(State::default());
    }
    for (i, edit) in edits.iter().enumerate() {
        let id = ids[i];
        let mut stands = !edit.is_removal() || rem.contains(&id);
        if stands {
            let cut = cuts.iter().filter(|c| c.at > i && !c.keep.contains(&id));
            let mut hidden: Vec<Fact> = cut.flat_map(|c| c.facts.iter().cloned()).collect();
            out.state.late = moves.clone().map(|moves| Late { moves, at: i, id, differs: false.into() });
            let checked = out.state.check(edit, id);
            let late = out.state.late.take();
            stands = match checked {
                Err(_) => false,
                Ok(change) => {
                    if let Some(l) = late.filter(|l| !hidden.is_empty() || l.differs.load(std::sync::atomic::Ordering::Relaxed)) {
                        hidden.extend(l.moves.unseen(i, id));
                    }
                    let ok = hidden.is_empty() || out.state.hide(&hidden).check(edit, id).is_ok();
                    if ok {
                        out.state.apply(change, edit, id);
                    }
                    ok
                }
            };
        }
        out.stood.push(stands);
        if states {
            out.states.push(out.state.clone());
        }
    }
    out
}

/// Who stands when removals clash, the smallest first. A vault's removals (an owner or a device revoked, the root
/// handed on) come before revoked grants, and a vault's removals before those of the coops it owns (`tier`), since a
/// coop's removals rest on its owners' approval and never the other way round. Within a vault: its root, then its
/// owners by seniority, their place among the owners where no removal has happened yet, then removals no owner
/// approved. Revoked grants follow, the most senior revoker first: the vault the grant is over, then whoever issued a
/// grant higher up the chain of the grant revoked, since a grant falls with the grant it rests on. Marks that take an
/// entry to an audience come last: a steward's upkeep. So a removal is only ever kept out by one that ranks above it,
/// and what ranks above it never rests on what it takes away. The class is the edit's kind alone, so no revoked grant
/// ever keeps out a vault's removal.
fn priority(base: &State, edit: &Edit) -> (u8, usize, u8, usize) {
    match &edit.action {
        Action::Revoke(Revoking::Owner { vault, .. } | Revoking::Device { vault, .. })
        | Action::Settings { vault, set: Setting::Root { .. } } => {
            let tier = base.tier(*vault);
            match base.vault(*vault) {
                None => (0, tier, 2, 0),
                Some(vt) => {
                    let sigs: Vec<SignerId> = edit.sigs().collect();
                    // its owners in the order they joined, every owner equal, the root no senior
                    if let Some(i) = vt.owners.iter().position(|&p| base.approves(&sigs, p)) {
                        (0, tier, 1, i)
                    } else {
                        (0, tier, 2, 0)
                    }
                }
            }
        }
        Action::Revoke(Revoking::Grant { share, actor, .. }) => {
            (1, base.share(*share).map_or(0, |c| base.seniority(*actor, c)), 0, 0)
        }
        Action::Mark { caps: Some(_), .. } => (2, 0, 0, 0),
        _ => (3, 0, 0, 0),
    }
}

/// The removals that stand among edits already in `order`, chosen one by one by priority: each stands if the edits
/// replayed with it and the ones chosen before it accept it and keep accepting those. Marks that take an entry to an
/// audience (moves) rank last, and are not tried one by one: a move takes away only what writes of its own entry
/// rested on, which no removal and no move rests on, so with the removals chosen before them the moves that stand are
/// those one replay with all of them accepts, and only those take anything away; a move the replay refuses cuts
/// nothing. The model tries each (`resolve` in `Step.lean`), which chooses the same; trying each here would replay a
/// vault's edits once for every move it ever made. A mark of the wants alone is no removal, and is never tried.
fn resolve(edits: &[Edit], ids: &[EditId]) -> HashSet<EditId> {
    let mut rem = HashSet::new();
    let moving = |i: &usize| matches!(edits[*i].action, Action::Mark { caps: Some(_), .. });
    let moves: Vec<usize> = (0..edits.len()).filter(moving).collect();
    let mut cands: Vec<usize> = (0..edits.len()).filter(|i| edits[*i].is_removal() && !moving(i)).collect();
    if !cands.is_empty() {
        let base = run(edits, ids, &rem, false).state;
        cands.sort_by_key(|&i| priority(&base, &edits[i]));
        for r in cands {
            let mut trial = rem.clone();
            trial.insert(ids[r]);
            let stood = run(edits, ids, &trial, false).stood;
            if (0..edits.len()).all(|i| !trial.contains(&ids[i]) || stood[i]) {
                rem = trial;
            }
        }
    }
    if !moves.is_empty() {
        let mut trial = rem.clone();
        trial.extend(moves.iter().map(|&i| ids[i]));
        let stood = run(edits, ids, &trial, false).stood;
        rem.extend(moves.into_iter().filter(|&i| stood[i]).map(|i| ids[i]));
    }
    rem
}

/// A peer's replay of the edits it holds: the one order, which edits stand, and what it knows.
#[derive(Debug, PartialEq)]
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

/// `replay` of `edits`, given `was`, the replay of the first `held` of them: the rest stepped on it, one by one, where
/// each is a write, no removal, deeper than every edit before it and built on none of its own depth, so it sorts after
/// all of them and no removal's standing or cut turns on it (`run`, `resolve`); else every edit replayed again.
pub fn replay_on(was: Replay, edits: &[Edit], held: usize) -> Replay {
    let Some(fresh) = edits.get(held..) else { return replay(edits) };
    let deepest = edits[..held].iter().map(|e| e.depth).max();
    let ids_fresh = ids(fresh);
    let by_id: HashMap<EditId, &Edit> = ids_fresh.iter().copied().zip(fresh).collect();
    let steps = |e: &Edit| {
        matches!(e.action, Action::Write { .. })
            && !e.is_removal()
            && deepest.is_none_or(|d| d < e.depth)
            && e.parents.iter().all(|p| by_id.get(p).is_none_or(|parent| parent.depth < e.depth))
    };
    if !fresh.iter().all(steps) {
        return replay(edits);
    }
    let mut order: Vec<(u64, u8, EditId, &Edit)> = by_id.iter().map(|(&id, &e)| (e.depth, e.rank(), id, e)).collect();
    order.sort_by_key(|a| (a.0, a.1, a.2));
    let mut out = was;
    for (.., id, e) in order {
        let stands = out.state.step_mut(e, id).is_ok();
        out.edits.push(e.clone());
        out.ids.push(id);
        out.stood.push(stands);
    }
    out
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
    /// The same ids, to tell at once whether it holds an edit: a search of `ids` for each edit received made a restore
    /// of n edits cost n²/2 compares.
    held: HashSet<EditId>,
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
        let held = ids.iter().copied().collect();
        Self { edits, ids, held }
    }

    /// The edit `author` and `cosigners` would sign here, unchecked: what a peer that skips the rules would send. It
    /// builds on the frontier of its own log (one that starts a log, a genesis or a grant, on nothing) and is one
    /// deeper than the deepest edit the log holds, so it sorts after everything this peer had seen. A write with no
    /// `deps` on the main line or a proposal builds on that line's heads. An act for a vault that names no `via` goes
    /// through the owners its author acts through (`State::via`). A removal keeps, beside what its `keep` names, every
    /// edit of the log that stands now and that it would cut otherwise: an honest device keeps all it had seen. A mark
    /// that takes an entry to an audience takes away only what the writes of its entry rested on, so it keeps every
    /// write of its entry that stands now; a mark of the wants alone keeps nothing.
    pub fn draft(&self, author: SignerId, cosigners: &[SignerId], action: Action) -> Edit {
        self.draft_with(None, author, cosigners, action)
    }

    /// `draft`, given `view`, what the log's edits say as the caller worked it out already: no replay, but for a
    /// removal other than a mark.
    pub fn draft_on(&self, view: &State, author: SignerId, cosigners: &[SignerId], action: Action) -> Edit {
        self.draft_with(Some(view), author, cosigners, action)
    }

    fn draft_with(&self, given: Option<&State>, author: SignerId, cosigners: &[SignerId], action: Action) -> Edit {
        let depth = self.edits.iter().map(|o| o.depth.saturating_add(1)).max().unwrap_or(0);
        let mut edit = Edit { parents: vec![], depth, author, cosigners: cosigners.to_vec(), action };
        if !matches!(edit.action, Action::Genesis { .. } | Action::Share(Sharing::Grant(..)))
            && let Some(l) = crate::sync::log_of(&edit, EditId([0; 32]))
        {
            edit.parents = crate::sync::frontier_of(&self.edits, &self.ids, l);
        }
        let own = std::cell::OnceCell::new();
        let view = || given.unwrap_or_else(|| own.get_or_init(|| self.view()));
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
        if let Action::Mark { entry, caps: Some(_), keep, .. } = &mut edit.action {
            keep.extend(view().writes(*entry));
            keep.sort();
            keep.dedup();
        } else if edit.is_removal() {
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
        self.held.insert(id);
        Ok(id)
    }

    /// Add edits from a peer, each once, whether or not the view accepts them: acceptance is decided at replay.
    pub fn receive(&mut self, edits: impl IntoIterator<Item = Edit>) {
        for edit in edits {
            let id = edit.id();
            if self.held.insert(id) {
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
    fn each_level_includes_the_ones_before_it() {
        assert!(
            Level::Owner.allows(Level::Read) && Level::Write.allows(Level::Write) && Level::Read.allows(Level::Backup)
        );
        assert!(Level::Backup.allows(Level::Relay) && !Level::Relay.allows(Level::Backup));
        assert!(!Level::Backup.allows(Level::Read) && !Level::Read.allows(Level::Write));
    }

    #[test]
    fn a_levels_rank_is_its_order_and_keep_allows_nothing() {
        let levels = [Level::Relay, Level::Backup, Level::Read, Level::Write, Level::Owner];
        assert_eq!(levels.map(Level::rank), [1, 2, 3, 4, 5]);
        assert!(levels.windows(2).all(|w| w[1].allows(w[0]) && !w[0].allows(w[1])));
        // every mode of keep is rank 0, below relay: it allows nothing, and any level allows it, which no rule asks
        let keeps = [KeepMode::Whole, KeepMode::Opened, KeepMode::Never].map(Level::Keep);
        assert_eq!(keeps.map(Level::rank), [0, 0, 0]);
        for k in keeps {
            assert!(levels.iter().all(|&l| !k.allows(l) && l.allows(k)));
            assert!(keeps.iter().all(|&m| k.allows(m)), "the modes compare by rank alone");
            assert!(k.is_keep() && k.mode().is_some());
        }
        assert!(levels.iter().all(|l| !l.is_keep() && l.mode().is_none()));
    }

    #[test]
    fn an_edit_never_sorts_ahead_of_a_parent_it_holds() {
        let passkey = SignerId::from_u64(1);
        let mut log = Log::new();
        let genesis =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: None, nonce: 0, seal_to: vec![] };
        let v = VaultId::from(log.append(passkey, &[], genesis).unwrap());
        let device = SignerId::from_u64(2);
        let honest = log.draft(passkey, &[device], Action::Share(Sharing::Device { vault: v, device, seal_to: None }));
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
    fn an_audience_is_canonical_when_its_shares_are_sorted_once() {
        let (a, b) = (ShareId::from_u64(1), ShareId::from_u64(2));
        assert!(canonical(&[]) && canonical(&[a]) && canonical(&[a, b]));
        assert!(!canonical(&[b, a]) && !canonical(&[a, a]));
        assert_eq!(mk_audience(&[b, a, b]), vec![a, b]);
    }
}
