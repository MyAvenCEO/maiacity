//! The rules every peer applies, op for op the Lean model (`vault/spec/VaultSpec/State.lean` and `Step.lean`): who
//! acts for which vault, who governs it, which caps a vault holds, and which ops are accepted.
//!
//! Ops reach this module already verified: an op's author and cosigners are the signers whose signatures checked out.
//! The one difference from the model is naming: what an op creates (a vault, a space, a grant) is named by that op's
//! id, where the model picks numbers.

use crate::id::{EntryId, GrantId, OpId, SignerId, SpaceId, VaultId};
use crate::keys::KeyScope;

/// A human vault is what one person owns, governed by their signers. A coop vault is owned by other vaults.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Kind {
    Human,
    Coop,
}

/// An owner of a vault: a signer (of a human vault) or a vault (of a coop).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Principal {
    Signer(SignerId),
    Vault(VaultId),
}

/// What a cap allows; each role includes the ones before it. Relay stores and forwards an item's ciphertext and gets no
/// key: it is the server's role.
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

/// What a cap covers: a whole space, or one entry in it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scope {
    Space(SpaceId),
    Entry(SpaceId, EntryId),
}

impl Scope {
    pub fn space(self) -> SpaceId {
        match self {
            Scope::Space(sp) | Scope::Entry(sp, _) => sp,
        }
    }

    /// A scope covers itself, and a space covers each of its entries.
    pub fn covers(self, other: Scope) -> bool {
        match self {
            Scope::Space(sp) => other.space() == sp,
            Scope::Entry(..) => self == other,
        }
    }
}

/// Who a grant is for: a vault, never a signer (T4), or everyone (read only, T8). The type allows a signer only so
/// that a peer can receive such a grant and refuse it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Grantee {
    Principal(Principal),
    Public,
}

/// A cap: `issuer` gives `grantee` the `role` on `scope`. `parent` is the grant the issuer's own right comes from, when
/// it isn't the founder of the space; revoking a grant ends every grant resting on it.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Grant {
    pub scope: Scope,
    pub role: Role,
    pub grantee: Grantee,
    pub issuer: VaultId,
    pub parent: Option<GrantId>,
}

/// Every change is one of these, signed. Governance (owners, threshold, devices, owner grants) needs the vault's
/// threshold of owner signatures; everything else needs one device acting for the vault.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Action {
    /// A new vault; its id is this op's id. Every first owner signs.
    Genesis { kind: Kind, owners: Vec<Principal>, threshold: u32, nonce: u64 },
    /// The newcomer signs too.
    AddOwner { vault: VaultId, owner: Principal },
    /// By the threshold, or an owner leaving on its own. `keep`: the ops of the removed owner this removal had seen,
    /// which stay valid (revocation wins over everything else).
    RemoveOwner { vault: VaultId, owner: Principal, keep: Vec<OpId> },
    SetThreshold { vault: VaultId, threshold: u32 },
    /// Human vaults only; the device signs too.
    AddDevice { vault: VaultId, device: SignerId },
    /// By the threshold, or the device leaving on its own; `keep` as for `RemoveOwner`.
    RemoveDevice { vault: VaultId, device: SignerId, keep: Vec<OpId> },
    /// A new space founded by `actor`, which holds owner on it; its id is this op's id.
    FoundSpace { actor: VaultId, nonce: u64 },
    /// Its id is this op's id.
    Grant(Grant),
    /// Ends `grant` and every grant resting on it; `keep` as for `RemoveOwner`.
    Revoke { grant: GrantId, actor: VaultId, keep: Vec<OpId> },
    /// An encrypted edit of one entry under the entry key's `epoch`. The first write creates the entry.
    Write { space: SpaceId, entry: EntryId, actor: VaultId, epoch: u64, body: Vec<u8> },
}

impl Action {
    /// The ops a removal had seen, for removals.
    pub fn keep(&self) -> Option<&[OpId]> {
        match self {
            Action::RemoveOwner { keep, .. } | Action::RemoveDevice { keep, .. } | Action::Revoke { keep, .. } => {
                Some(keep)
            }
            _ => None,
        }
    }
}

/// A verified op: what it does, who signed it, and the ops it builds on (its causal past).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Op {
    pub parents: Vec<OpId>,
    pub author: SignerId,
    pub cosigners: Vec<SignerId>,
    pub action: Action,
}

impl Op {
    /// The hash of the signed op.
    pub fn id(&self) -> OpId {
        todo!("P1: BLAKE3 of the op's canonical encoding with its signatures")
    }

    /// Everyone who signed: the author first.
    pub fn sigs(&self) -> impl Iterator<Item = SignerId> + '_ {
        std::iter::once(self.author).chain(self.cosigners.iter().copied())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub id: VaultId,
    pub kind: Kind,
    pub owners: Vec<Principal>,
    pub threshold: u32,
    pub devices: Vec<SignerId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Space {
    pub id: SpaceId,
    pub founder: VaultId,
    pub entries: Vec<EntryId>,
}

/// Why a peer refused an op.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// A signature doesn't verify, or covers other bytes (checked before any rule).
    BadSignature,
    /// Already accepted.
    Duplicate,
    UnknownVault,
    UnknownSpace,
    UnknownGrant,
    /// A new owner or device, or a first owner at genesis, didn't sign.
    NoConsent,
    /// Too few owners approved a governance change.
    BelowThreshold,
    /// The threshold would be 0 or more than the number of owners.
    BadThreshold,
    /// A human vault's owners are signers, a coop's owners are vaults.
    WrongOwnerKind,
    /// A vault keeps at least one owner.
    LastOwner,
    /// The vault would own itself, directly or through other vaults (T3).
    Cycle,
    /// Devices belong to human vaults.
    NotHuman,
    /// No signer of the op acts for the vault it claims to act for.
    NotActing,
    /// The vault doesn't hold the role this needs on the scope.
    NoCap,
    /// Grants name vaults, never signers (T4).
    GrantToSigner,
    /// Public only ever gets read (T8).
    PublicBeyondRead,
    /// The parent grant doesn't cover the new one, or isn't the issuer's.
    BadParent,
    /// A write under a key epoch that doesn't exist yet.
    FutureEpoch,
}

/// What a peer knows after replaying its ops: vaults, spaces, grants, accepted writes and each key family's epoch.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct State {
    _filled_in_p1_to_p3: (),
}

impl State {
    pub fn vault(&self, v: VaultId) -> Option<&Vault> {
        let _ = v;
        todo!("P1: vaults")
    }

    pub fn space(&self, sp: SpaceId) -> Option<&Space> {
        let _ = sp;
        todo!("P2: spaces")
    }

    /// The grants in force, each with its id.
    pub fn grants(&self) -> Vec<(GrantId, Grant)> {
        todo!("P2: grants")
    }

    /// The accepted writes of one entry, in replay order.
    pub fn writes(&self, sp: SpaceId, e: EntryId) -> Vec<OpId> {
        let _ = (sp, e);
        todo!("P2: writes")
    }

    /// Signer `s` acts for vault `v`: a device or owner signer of a human vault, or anyone acting for an owner of a
    /// coop, up the chain.
    pub fn acts_for(&self, s: SignerId, v: VaultId) -> bool {
        let _ = (s, v);
        todo!("P1: chains")
    }

    /// The signers `sigs` approve for `p`: a signer by signing, a vault by the approval of its threshold of owners.
    pub fn approves(&self, sigs: &[SignerId], p: Principal) -> bool {
        let _ = (sigs, p);
        todo!("P1: governance")
    }

    /// Vault `v` holds `need` or more on `sc`: it founded the space, or a grant in force covering `sc` gives it.
    pub fn holds(&self, v: VaultId, sc: Scope, need: Role) -> bool {
        let _ = (v, sc, need);
        todo!("P2: caps")
    }

    pub fn is_public(&self, sc: Scope) -> bool {
        let _ = sc;
        todo!("P2: Public")
    }

    /// The current epoch of a key family; it starts at 0 and grows by one at every rotation.
    pub fn epoch(&self, k: KeyScope) -> u64 {
        let _ = k;
        todo!("P3: rotation")
    }

    /// Device `d` should be able to open the current key of `k`: it acts for a vault that may read it.
    pub fn entitled(&self, d: SignerId, k: KeyScope) -> bool {
        let _ = (d, k);
        todo!("P3: keys")
    }

    /// Device `d` may receive the encrypted edits of an entry: it is public, or `d` acts for a vault holding relay or
    /// more on it.
    pub fn may_receive(&self, d: SignerId, sp: SpaceId, e: EntryId) -> bool {
        let _ = (d, sp, e);
        todo!("P2: caps as sync rules")
    }

    /// Apply one op: the new state, or why the op is refused.
    pub fn step(&self, op: &Op) -> Result<State, Refusal> {
        let _ = op;
        todo!("P1 vaults, P2 caps and writes, P3 key rotation")
    }
}

/// The one order every peer replays in: causal depth, then removals first, then id.
pub fn order(ops: &[Op]) -> Vec<Op> {
    let _ = ops;
    todo!("P1: causal order")
}

/// What a peer holding `ops` knows: their replay in `order` from the empty state, refused ops skipped.
pub fn view(ops: &[Op]) -> State {
    let _ = ops;
    todo!("P1: replay")
}

/// Every state along the replay of `ops` in `order`, the empty state first and the view last.
pub fn trace(ops: &[Op]) -> Vec<State> {
    let _ = ops;
    todo!("P1: replay")
}

/// A peer's ops. Each op appended builds on everything the log holds; ops from other peers are added as they arrive.
#[derive(Clone, Debug, Default)]
pub struct Log {
    ops: Vec<Op>,
}

impl Log {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ops(&self) -> &[Op] {
        &self.ops
    }

    pub fn view(&self) -> State {
        view(&self.ops)
    }

    /// A log holding `ops`, as a peer that received them.
    pub fn from_ops(ops: Vec<Op>) -> Self {
        Self { ops }
    }

    /// The op `author` and `cosigners` would sign here, building on the log's heads, unchecked: what a peer that
    /// skips the rules would send.
    pub fn draft(&self, author: SignerId, cosigners: &[SignerId], action: Action) -> Op {
        let _ = (author, cosigners, action);
        todo!("P1: parents are the log's heads")
    }

    /// The op `append` would add, if the view accepts it.
    pub fn check(&self, author: SignerId, cosigners: &[SignerId], action: Action) -> Result<Op, Refusal> {
        let op = self.draft(author, cosigners, action);
        self.view().step(&op)?;
        Ok(op)
    }

    /// Append an op signed by `author` and `cosigners`, if the view accepts it.
    pub fn append(&mut self, author: SignerId, cosigners: &[SignerId], action: Action) -> Result<OpId, Refusal> {
        let op = self.check(author, cosigners, action)?;
        let id = op.id();
        self.ops.push(op);
        Ok(id)
    }

    /// Add ops from a peer, each once, whether or not the view accepts them: acceptance is decided at replay.
    pub fn receive(&mut self, ops: impl IntoIterator<Item = Op>) {
        for op in ops {
            if !self.ops.contains(&op) {
                self.ops.push(op);
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
    fn a_space_covers_its_entries_and_an_entry_only_itself() {
        let (sp, other) = (SpaceId::from_u64(1), SpaceId::from_u64(2));
        let (a, b) = (EntryId::from_u64(1), EntryId::from_u64(2));
        assert!(Scope::Space(sp).covers(Scope::Entry(sp, a)) && Scope::Space(sp).covers(Scope::Space(sp)));
        assert!(!Scope::Space(other).covers(Scope::Entry(sp, a)));
        assert!(Scope::Entry(sp, a).covers(Scope::Entry(sp, a)) && !Scope::Entry(sp, a).covers(Scope::Entry(sp, b)));
        assert!(!Scope::Entry(sp, a).covers(Scope::Space(sp)));
    }
}
