//! The rules every peer applies, op for op the Lean model (`vault/spec/VaultSpec/State.lean` and `Step.lean`): who
//! acts for which vault, who governs it, which caps a vault holds, which ops are accepted, and how a removal cuts what
//! it hadn't seen.
//!
//! Ops reach this module already verified: an op's author and cosigners are the signers whose signatures checked out
//! (`sign::Signed::verify`). Two differences from the model: what an op creates (a vault, a space, a grant) is named
//! by that op's id, where the model picks numbers; and a refused op says why, where the model only says no. Keys and
//! their rotation come in P3: until then every key stays at epoch 0.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

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

/// Every change is one of these, signed. Governance (owners, threshold, devices, the root, owner grants) needs the
/// vault's approval: its root, or its threshold of owners; everything else needs one device acting for the vault.
/// Every removal names the ops it had seen and keeps (`keep`); what it hadn't seen and relied on what it takes away is
/// cut (`view`).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub enum Action {
    /// A new vault; its id is this op's id. Every first owner signs, and so does the root, the passkey of a human
    /// vault, if it names one.
    Genesis { kind: Kind, owners: Vec<Principal>, threshold: u32, root: Option<SignerId>, nonce: u64 },
    /// The newcomer signs too.
    AddOwner { vault: VaultId, owner: Principal },
    /// By the vault's approval, or an owner leaving on its own.
    RemoveOwner { vault: VaultId, owner: Principal, keep: Vec<OpId> },
    SetThreshold { vault: VaultId, threshold: u32 },
    /// Human vaults only; the device signs too.
    AddDevice { vault: VaultId, device: SignerId },
    /// By the vault's approval, or the device leaving on its own.
    RemoveDevice { vault: VaultId, device: SignerId, keep: Vec<OpId> },
    /// The root hands itself on to a new passkey, which signs too, or steps down (`None`).
    SetRoot { vault: VaultId, root: Option<SignerId>, keep: Vec<OpId> },
    /// A new space founded by `actor`, which holds owner on it; its id is this op's id.
    FoundSpace { actor: VaultId, nonce: u64 },
    /// Its id is this op's id.
    Grant(Grant),
    /// Ends `grant` and every grant resting on it.
    Revoke { grant: GrantId, actor: VaultId, keep: Vec<OpId> },
    /// An encrypted edit of one entry under the entry key's `epoch`, building on the entry's writes `deps` (its Loro
    /// frontier). The first write creates the entry.
    Write { space: SpaceId, entry: EntryId, actor: VaultId, epoch: u64, deps: Vec<OpId>, body: Vec<u8> },
}

impl Action {
    /// The ops a removal had seen and keeps, for removals.
    pub fn keep(&self) -> Option<&[OpId]> {
        match self {
            Action::RemoveOwner { keep, .. }
            | Action::RemoveDevice { keep, .. }
            | Action::SetRoot { keep, .. }
            | Action::Revoke { keep, .. } => Some(keep),
            _ => None,
        }
    }

    fn keep_mut(&mut self) -> Option<&mut Vec<OpId>> {
        match self {
            Action::RemoveOwner { keep, .. }
            | Action::RemoveDevice { keep, .. }
            | Action::SetRoot { keep, .. }
            | Action::Revoke { keep, .. } => Some(keep),
            _ => None,
        }
    }
}

/// A verified op: what it does, who signed it, and the ops it builds on (its causal past).
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Op {
    pub parents: Vec<OpId>,
    /// Causal depth: one more than the deepest parent, 0 without parents. It travels with the op because a peer
    /// often holds only part of an op's past (a vault's log without the ops around it), and every peer must still
    /// order the op the same way.
    pub depth: u64,
    pub author: SignerId,
    pub cosigners: Vec<SignerId>,
    pub action: Action,
}

impl Op {
    /// BLAKE3 of the op's canonical encoding (`encode`): everything the op says, its signers included. Each signer
    /// signs this id.
    pub fn id(&self) -> OpId {
        OpId(crate::encode::op_id(self))
    }

    /// Everyone who signed: the author first.
    pub fn sigs(&self) -> impl Iterator<Item = SignerId> + '_ {
        std::iter::once(self.author).chain(self.cosigners.iter().copied())
    }

    /// The vault a vault op changes; a genesis changes the vault it creates.
    pub fn vault_of(&self) -> Option<VaultId> {
        match &self.action {
            Action::Genesis { .. } => Some(VaultId::from(self.id())),
            Action::AddOwner { vault, .. }
            | Action::RemoveOwner { vault, .. }
            | Action::SetThreshold { vault, .. }
            | Action::AddDevice { vault, .. }
            | Action::RemoveDevice { vault, .. }
            | Action::SetRoot { vault, .. } => Some(*vault),
            _ => None,
        }
    }

    /// The entry a write edits.
    pub fn write_target(&self) -> Option<(SpaceId, EntryId)> {
        match self.action {
            Action::Write { space, entry, .. } => Some((space, entry)),
            _ => None,
        }
    }

    /// The vault an op acts for: a space's founder, a grant's issuer, a revoker, a writer.
    pub fn actor(&self) -> Option<VaultId> {
        match &self.action {
            Action::FoundSpace { actor, .. } | Action::Revoke { actor, .. } | Action::Write { actor, .. } => Some(*actor),
            Action::Grant(g) => Some(g.issuer),
            _ => None,
        }
    }

    /// The vault a grant names.
    pub fn grantee(&self) -> Option<VaultId> {
        match &self.action {
            Action::Grant(Grant { grantee: Grantee::Principal(Principal::Vault(v)), .. }) => Some(*v),
            _ => None,
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
    pub devices: Vec<SignerId>,
    /// A human vault's root: its passkey, named at genesis. It approves anything for its vault on its own, wins every
    /// clash with the other owners, and only it hands the root on.
    pub root: Option<SignerId>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Space {
    pub id: SpaceId,
    pub founder: VaultId,
    pub entries: Vec<EntryId>,
}

/// An accepted write: one encrypted edit of one entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Write {
    pub op: OpId,
    pub author: SignerId,
    pub actor: VaultId,
    pub space: SpaceId,
    pub entry: EntryId,
    pub epoch: u64,
    /// The writes of the same entry it builds on.
    pub deps: Vec<OpId>,
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
    /// A human vault's owners are signers, a coop's owners are vaults.
    WrongOwnerKind,
    /// A vault keeps at least one owner.
    LastOwner,
    /// The vault would own itself, directly or through other vaults (T3).
    Cycle,
    /// Devices and roots belong to human vaults.
    NotHuman,
    /// Only a vault's root hands the root on.
    NotRoot,
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
    /// A write builds on a write its entry doesn't have (T14).
    UnknownDep,
}

/// What a removal takes away.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Fact {
    Owner(VaultId, Principal),
    Device(VaultId, SignerId),
    /// Whatever root the vault had.
    Root(VaultId),
    Grant(GrantId),
}

/// What a peer knows after replaying its ops: vaults, spaces, grants, accepted writes (and from P3 each key family's
/// epoch).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct State {
    /// In the order they were created.
    vaults: Vec<Vault>,
    spaces: Vec<Space>,
    /// The grants in force, in the order they were made.
    grants: Vec<(GrantId, Grant)>,
    /// In the order they were accepted; shared, as replays copy the state often and the writes are most of it.
    writes: Arc<Vec<Write>>,
}

impl State {
    pub fn vault(&self, v: VaultId) -> Option<&Vault> {
        self.vaults.iter().find(|x| x.id == v)
    }

    /// Every vault, in the order they were created.
    pub fn vaults(&self) -> &[Vault] {
        &self.vaults
    }

    fn vault_mut(&mut self, v: VaultId) -> &mut Vault {
        self.vaults.iter_mut().find(|x| x.id == v).expect("a vault the step just looked up")
    }

    /// A bound on chain length: without ownership cycles (T3) a chain never visits more vaults than exist.
    fn depth(&self) -> usize {
        self.vaults.len() + 1
    }

    pub fn space(&self, sp: SpaceId) -> Option<&Space> {
        self.spaces.iter().find(|x| x.id == sp)
    }

    /// Every space, in the order they were founded.
    pub fn spaces(&self) -> &[Space] {
        &self.spaces
    }

    pub fn founder(&self, sp: SpaceId) -> Option<VaultId> {
        self.space(sp).map(|s| s.founder)
    }

    pub fn grant(&self, g: GrantId) -> Option<&Grant> {
        self.grants.iter().find(|(id, _)| *id == g).map(|(_, x)| x)
    }

    /// The grants in force, each with its id.
    pub fn grants(&self) -> Vec<(GrantId, Grant)> {
        self.grants.clone()
    }

    /// The accepted writes of one entry, in replay order.
    pub fn writes(&self, sp: SpaceId, e: EntryId) -> Vec<OpId> {
        self.writes.iter().filter(|w| w.space == sp && w.entry == e).map(|w| w.op).collect()
    }

    /// Every accepted write, in replay order.
    pub fn all_writes(&self) -> &[Write] {
        &self.writes
    }

    /// The writes of one entry that no other accepted write of it builds on: what the next edit builds on.
    pub fn heads(&self, sp: SpaceId, e: EntryId) -> Vec<OpId> {
        let ws: Vec<&Write> = self.writes.iter().filter(|w| w.space == sp && w.entry == e).collect();
        ws.iter().filter(|w| !ws.iter().any(|x| x.deps.contains(&w.op))).map(|w| w.op).collect()
    }

    /// Signer `s` acts for vault `v`: a device or owner signer of a human vault, or anyone acting for an owner of a
    /// coop, up the chain.
    pub fn acts_for(&self, s: SignerId, v: VaultId) -> bool {
        self.acts_for_n(s, self.depth(), v)
    }

    fn acts_for_n(&self, s: SignerId, n: usize, v: VaultId) -> bool {
        let Some(vt) = self.vault(v).filter(|_| n > 0) else { return false };
        match vt.kind {
            Kind::Human => vt.devices.contains(&s) || vt.owners.contains(&Principal::Signer(s)),
            Kind::Coop => vt.owners.iter().any(|p| matches!(*p, Principal::Vault(o) if self.acts_for_n(s, n - 1, o))),
        }
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

    /// Human vaults are owned by signers, coops by existing vaults.
    fn owner_fits(&self, kind: Kind, p: Principal) -> Result<(), Refusal> {
        match (kind, p) {
            (Kind::Human, Principal::Signer(_)) => Ok(()),
            (Kind::Coop, Principal::Vault(o)) if self.vault(o).is_some() => Ok(()),
            (Kind::Coop, Principal::Vault(_)) => Err(Refusal::UnknownVault),
            _ => Err(Refusal::WrongOwnerKind),
        }
    }

    /// Vault `v` holds `need` or more on `sc`: it founded the space, or a grant in force covering `sc` gives it.
    pub fn holds(&self, v: VaultId, sc: Scope, need: Role) -> bool {
        self.founder(sc.space()) == Some(v)
            || self.grants.iter().any(|(_, g)| {
                g.grantee == Grantee::Principal(Principal::Vault(v)) && g.scope.covers(sc) && g.role.allows(need)
            })
    }

    /// Everyone may read `sc`.
    pub fn is_public(&self, sc: Scope) -> bool {
        self.grants.iter().any(|(_, g)| g.grantee == Grantee::Public && g.scope.covers(sc))
    }

    /// A write is authorized: its author acts for its vault, and that vault holds write on its entry.
    pub fn authorized(&self, w: &Write) -> bool {
        self.acts_for(w.author, w.actor) && self.holds(w.actor, Scope::Entry(w.space, w.entry), Role::Write)
    }

    /// The current epoch of a key family; it starts at 0 and grows by one at every rotation.
    pub fn epoch(&self, k: KeyScope) -> u64 {
        let _ = k;
        todo!("P3: rotation")
    }

    /// An entry key's current epoch, which writes may not run ahead of. Rotation comes in P3; until then it is 0.
    fn entry_epoch(&self, _sp: SpaceId, _e: EntryId) -> u64 {
        0
    }

    /// Device `d` should be able to open the current key of `k`: it acts for a vault that may read it.
    pub fn entitled(&self, d: SignerId, k: KeyScope) -> bool {
        let _ = (d, k);
        todo!("P3: keys")
    }

    /// Device `d` may receive the encrypted edits of an entry: it is public, or `d` acts for a vault holding relay or
    /// more on it. Receiving is not reading: relay gets no key.
    pub fn may_receive(&self, d: SignerId, sp: SpaceId, e: EntryId) -> bool {
        let sc = Scope::Entry(sp, e);
        self.is_public(sc) || self.vaults.iter().any(|x| self.acts_for(d, x.id) && self.holds(x.id, sc, Role::Relay))
    }

    /// Device `d` may learn about scope `sc`: an entry it may receive, or a space that is public, that one of its
    /// vaults holds a cap on, or that holds an entry it may receive.
    pub fn reaches(&self, d: SignerId, sc: Scope) -> bool {
        match sc {
            Scope::Entry(sp, e) => self.may_receive(d, sp, e),
            Scope::Space(sp) => {
                self.is_public(sc)
                    || self.vaults.iter().any(|x| self.acts_for(d, x.id) && self.holds(x.id, sc, Role::Relay))
                    || self.space(sp).is_some_and(|s| s.entries.iter().any(|&e| self.may_receive(d, sp, e)))
            }
        }
    }

    /// Grant `x` is `g`, or its parent rests on `g`.
    fn rests_on(&self, g: GrantId, x: GrantId) -> bool {
        let mut x = x;
        for _ in 0..=self.grants.len() {
            if x == g {
                return true;
            }
            match self.grant(x).and_then(|y| y.parent) {
                Some(p) => x = p,
                None => return false,
            }
        }
        false
    }

    /// Vault `a` may revoke grant `g`: it issued it, founded the space, or may revoke the grant `g` rests on.
    fn may_revoke(&self, a: VaultId, g: &Grant) -> bool {
        let mut g = g;
        for _ in 0..=self.grants.len() {
            if g.issuer == a || self.founder(g.scope.space()) == Some(a) {
                return true;
            }
            match g.parent.and_then(|p| self.grant(p)) {
                Some(p) => g = p,
                None => return false,
            }
        }
        false
    }

    /// The issuer founded the space, or relies on an owner grant to it that covers the new grant's scope.
    fn parent_ok(&self, g: &Grant) -> bool {
        match g.parent {
            None => self.founder(g.scope.space()) == Some(g.issuer),
            Some(p) => self.grant(p).is_some_and(|pg| {
                pg.grantee == Grantee::Principal(Principal::Vault(g.issuer)) && pg.role == Role::Owner && pg.scope.covers(g.scope)
            }),
        }
    }

    /// After a removal from `pre`: drop every write the removal took the authorization from, unless the remover had
    /// seen it, and every write that builds on a dropped one. Writes that were already unauthorized (kept by an
    /// earlier removal) stay. Revocation wins over what it had not seen.
    fn drop_unseen(&mut self, pre: &State, keep: &[OpId]) {
        let writes = std::mem::take(&mut self.writes);
        let survivors: Vec<Write> =
            writes.iter().filter(|w| keep.contains(&w.op) || !pre.authorized(w) || self.authorized(w)).cloned().collect();
        self.writes = Arc::new(close_deps(survivors));
    }

    /// The state with the facts `fs` taken away.
    pub fn hide(&self, fs: &[Fact]) -> State {
        let mut st = self.clone();
        if fs.is_empty() {
            return st;
        }
        for vt in &mut st.vaults {
            let id = vt.id;
            vt.owners.retain(|&p| !fs.contains(&Fact::Owner(id, p)));
            vt.devices.retain(|&d| !fs.contains(&Fact::Device(id, d)));
            if fs.contains(&Fact::Root(id)) {
                vt.root = None;
            }
        }
        st.grants.retain(|(g, _)| !fs.contains(&Fact::Grant(*g)));
        st
    }

    /// Apply one op: the new state, or why the op is refused. Each rule is the model's (`apply` in `Step.lean`), checked
    /// in the same order.
    pub fn step(&self, op: &Op) -> Result<State, Refusal> {
        let mut st = self.clone();
        st.apply(op)?;
        Ok(st)
    }

    /// `step` in place: every check comes before any change, so a refused op leaves the state as it was.
    fn apply(&mut self, op: &Op) -> Result<(), Refusal> {
        let sigs: Vec<SignerId> = op.sigs().collect();
        let approves = |st: &State, p| st.approves(&sigs, p);
        match &op.action {
            Action::Genesis { kind, owners, threshold, root, .. } => {
                let v = VaultId::from(op.id());
                if self.vault(v).is_some() {
                    return Err(Refusal::Duplicate);
                }
                if owners.is_empty() || owners.iter().enumerate().any(|(i, p)| owners[..i].contains(p)) {
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
                if !owners.iter().all(|&p| approves(self, p)) {
                    return Err(Refusal::NoConsent);
                }
                self.vaults.push(Vault {
                    id: v,
                    kind: *kind,
                    owners: owners.clone(),
                    threshold: *threshold,
                    devices: vec![],
                    root: *root,
                });
            }
            &Action::AddOwner { vault, owner } => {
                let vt = self.vault(vault).ok_or(Refusal::UnknownVault)?;
                if vt.owners.contains(&owner) {
                    return Err(Refusal::AlreadyMember);
                }
                self.owner_fits(vt.kind, owner)?;
                // no cycles: the newcomer must not be the vault itself or something the vault owns
                if matches!(owner, Principal::Vault(x) if x == vault || self.owns(vault, x)) {
                    return Err(Refusal::Cycle);
                }
                // the vault's approval, plus the newcomer's consent
                if !approves(self, Principal::Vault(vault)) {
                    return Err(Refusal::BelowThreshold);
                }
                if !approves(self, owner) {
                    return Err(Refusal::NoConsent);
                }
                self.vault_mut(vault).owners.push(owner);
            }
            Action::RemoveOwner { vault, owner, keep } => {
                let (vault, owner) = (*vault, *owner);
                let vt = self.vault(vault).ok_or(Refusal::UnknownVault)?;
                if !vt.owners.contains(&owner) {
                    return Err(Refusal::NotMember);
                }
                if vt.owners.len() <= 1 {
                    return Err(Refusal::LastOwner);
                }
                // the vault's approval, or the owner leaving on its own
                if !(approves(self, Principal::Vault(vault)) || approves(self, owner)) {
                    return Err(Refusal::BelowThreshold);
                }
                let pre = self.clone();
                let x = self.vault_mut(vault);
                let i = x.owners.iter().position(|&p| p == owner).expect("an owner");
                x.owners.remove(i);
                x.threshold = x.threshold.min(x.owners.len() as u32);
                self.drop_unseen(&pre, keep);
            }
            &Action::SetThreshold { vault, threshold } => {
                let vt = self.vault(vault).ok_or(Refusal::UnknownVault)?;
                if threshold == 0 || threshold as usize > vt.owners.len() {
                    return Err(Refusal::BadThreshold);
                }
                if !approves(self, Principal::Vault(vault)) {
                    return Err(Refusal::BelowThreshold);
                }
                self.vault_mut(vault).threshold = threshold;
            }
            &Action::AddDevice { vault, device } => {
                let vt = self.vault(vault).ok_or(Refusal::UnknownVault)?;
                if vt.kind != Kind::Human {
                    return Err(Refusal::NotHuman);
                }
                if vt.devices.contains(&device) {
                    return Err(Refusal::AlreadyMember);
                }
                // the vault's approval, plus the device's own signature
                if !approves(self, Principal::Vault(vault)) {
                    return Err(Refusal::BelowThreshold);
                }
                if !sigs.contains(&device) {
                    return Err(Refusal::NoConsent);
                }
                self.vault_mut(vault).devices.push(device);
            }
            Action::RemoveDevice { vault, device, keep } => {
                let (vault, device) = (*vault, *device);
                let vt = self.vault(vault).ok_or(Refusal::UnknownVault)?;
                if !vt.devices.contains(&device) {
                    return Err(Refusal::NotMember);
                }
                // the vault's approval, or the device leaving on its own
                if !(approves(self, Principal::Vault(vault)) || sigs.contains(&device)) {
                    return Err(Refusal::BelowThreshold);
                }
                let pre = self.clone();
                let x = self.vault_mut(vault);
                let i = x.devices.iter().position(|&d| d == device).expect("a device");
                x.devices.remove(i);
                self.drop_unseen(&pre, keep);
            }
            &Action::SetRoot { vault, root, .. } => {
                let vt = self.vault(vault).ok_or(Refusal::UnknownVault)?;
                // only the root hands the root on, and the new root signs
                if !vt.root.is_some_and(|r| sigs.contains(&r)) {
                    return Err(Refusal::NotRoot);
                }
                if root.is_some_and(|r| !sigs.contains(&r)) {
                    return Err(Refusal::NoConsent);
                }
                self.vault_mut(vault).root = root;
            }
            &Action::FoundSpace { actor, .. } => {
                let sp = SpaceId::from(op.id());
                if self.space(sp).is_some() {
                    return Err(Refusal::Duplicate);
                }
                if !self.acts_for(op.author, actor) {
                    return Err(Refusal::NotActing);
                }
                self.spaces.push(Space { id: sp, founder: actor, entries: vec![] });
            }
            Action::Grant(g) => {
                let id = GrantId::from(op.id());
                if self.grant(id).is_some() {
                    return Err(Refusal::Duplicate);
                }
                if self.space(g.scope.space()).is_none() {
                    return Err(Refusal::UnknownSpace);
                }
                // grants name vaults or Public, never signers; Public only reads
                match g.grantee {
                    Grantee::Principal(Principal::Signer(_)) => return Err(Refusal::GrantToSigner),
                    Grantee::Principal(Principal::Vault(x)) if self.vault(x).is_none() => return Err(Refusal::UnknownVault),
                    Grantee::Public if g.role != Role::Read => return Err(Refusal::PublicBeyondRead),
                    _ => {}
                }
                if !self.acts_for(op.author, g.issuer) {
                    return Err(Refusal::NotActing);
                }
                if !self.holds(g.issuer, g.scope, Role::Owner) {
                    return Err(Refusal::NoCap);
                }
                if !self.parent_ok(g) {
                    return Err(Refusal::BadParent);
                }
                // making someone owner is governance
                if g.role == Role::Owner && !approves(self, Principal::Vault(g.issuer)) {
                    return Err(Refusal::BelowThreshold);
                }
                self.grants.push((id, g.clone()));
            }
            Action::Revoke { grant, actor, keep } => {
                let (grant, actor) = (*grant, *actor);
                let g = self.grant(grant).ok_or(Refusal::UnknownGrant)?;
                if !self.acts_for(op.author, actor) {
                    return Err(Refusal::NotActing);
                }
                if !self.may_revoke(actor, g) {
                    return Err(Refusal::NoCap);
                }
                if g.role == Role::Owner && !approves(self, Principal::Vault(actor)) {
                    return Err(Refusal::BelowThreshold);
                }
                // the grant and every grant resting on it end
                let pre = self.clone();
                self.grants.retain(|(x, _)| !pre.rests_on(grant, *x));
                self.drop_unseen(&pre, keep);
            }
            Action::Write { space, entry, actor, epoch, deps, .. } => {
                let (space, entry, actor, epoch) = (*space, *entry, *actor, *epoch);
                let s = self.space(space).ok_or(Refusal::UnknownSpace)?;
                let id = op.id();
                if self.writes.iter().any(|w| w.op == id) {
                    return Err(Refusal::Duplicate);
                }
                if !self.acts_for(op.author, actor) {
                    return Err(Refusal::NotActing);
                }
                if !self.holds(actor, Scope::Entry(space, entry), Role::Write) {
                    return Err(Refusal::NoCap);
                }
                if epoch > self.entry_epoch(space, entry) {
                    return Err(Refusal::FutureEpoch);
                }
                let w = Write { op: id, author: op.author, actor, space, entry, epoch, deps: deps.clone() };
                // what it builds on was accepted, so the accepted writes stay causally closed (T14)
                if !deps_in(&self.writes, &w) {
                    return Err(Refusal::UnknownDep);
                }
                if !s.entries.contains(&entry) {
                    self.spaces.iter_mut().find(|x| x.id == space).expect("the space").entries.push(entry);
                }
                Arc::make_mut(&mut self.writes).push(w);
            }
        }
        Ok(())
    }
}

/// Write `w` builds only on writes of its own entry among `ws`.
fn deps_in(ws: &[Write], w: &Write) -> bool {
    w.deps.iter().all(|d| ws.iter().any(|x| x.op == *d && x.space == w.space && x.entry == w.entry))
}

/// Keep, in order, each write whose dependencies were kept. A write comes after the writes it builds on, so one pass
/// leaves the writes causally closed (T14).
fn close_deps(ws: Vec<Write>) -> Vec<Write> {
    let mut kept: Vec<Write> = Vec::with_capacity(ws.len());
    for w in ws {
        if deps_in(&kept, &w) {
            kept.push(w);
        }
    }
    kept
}

/// The one order every peer replays in: causal depth, then removals first, then id. Each op appears once. An op that
/// claims to be no deeper than a parent the peer holds is malformed and left out, so no op sorts ahead of its own
/// past.
pub fn order(ops: &[Op]) -> Vec<Op> {
    let mut by_id: HashMap<OpId, &Op> = HashMap::with_capacity(ops.len());
    for op in ops {
        by_id.entry(op.id()).or_insert(op);
    }
    let mut out: Vec<(u64, u8, OpId, &Op)> = by_id
        .iter()
        .filter(|(_, op)| op.parents.iter().all(|p| by_id.get(p).is_none_or(|parent| parent.depth < op.depth)))
        .map(|(&id, &op)| (op.depth, op.rank(), id, op))
        .collect();
    out.sort_by_key(|a| (a.0, a.1, a.2));
    out.into_iter().map(|(.., op)| op.clone()).collect()
}

/// What removal `r` takes away: the owner, the device, the root, or, among the grants the ops `ops` make, the grant
/// and every grant resting on it.
pub fn removes(ops: &[Op], r: &Op) -> Vec<Fact> {
    match r.action {
        Action::RemoveOwner { vault, owner, .. } => vec![Fact::Owner(vault, owner)],
        Action::RemoveDevice { vault, device, .. } => vec![Fact::Device(vault, device)],
        Action::SetRoot { vault, .. } => vec![Fact::Root(vault)],
        Action::Revoke { grant, .. } => {
            let gs: Vec<(GrantId, Option<GrantId>)> = ops
                .iter()
                .filter_map(|o| match &o.action {
                    Action::Grant(g) => Some((GrantId::from(o.id()), g.parent)),
                    _ => None,
                })
                .collect();
            let rests_on = |x: GrantId| {
                let mut x = x;
                for _ in 0..=gs.len() {
                    if x == grant {
                        return true;
                    }
                    match gs.iter().find(|(id, _)| *id == x).and_then(|(_, p)| *p) {
                        Some(p) => x = p,
                        None => return false,
                    }
                }
                false
            };
            gs.iter().filter(|(id, _)| rests_on(*id)).map(|(id, _)| Fact::Grant(*id)).collect()
        }
        _ => vec![],
    }
}

/// A removal among the ops being replayed: its position, the ops it keeps, and what it takes away.
struct Cut {
    at: usize,
    keep: HashSet<OpId>,
    facts: Vec<Fact>,
}

/// One replay of ops already in `order`, with the removals `rem` and no others: an op stands if `apply` accepts it on
/// the state before it, and again with what each later removal that hadn't seen it takes away hidden. Which ops stood,
/// and the state at the end; with `states`, every state along the way too.
struct Run {
    stood: Vec<bool>,
    state: State,
    states: Vec<State>,
}

fn run(ops: &[Op], ids: &[OpId], rem: &HashSet<OpId>, states: bool) -> Run {
    let cuts: Vec<Cut> = ops
        .iter()
        .enumerate()
        .filter(|(i, _)| rem.contains(&ids[*i]))
        .map(|(at, r)| Cut { at, keep: r.action.keep().unwrap_or(&[]).iter().copied().collect(), facts: removes(ops, r) })
        .collect();
    let mut out = Run { stood: Vec::with_capacity(ops.len()), state: State::default(), states: vec![] };
    if states {
        out.states.push(State::default());
    }
    for (i, op) in ops.iter().enumerate() {
        let id = ids[i];
        let mut stands = !op.is_removal() || rem.contains(&id);
        if stands {
            let hidden: Vec<Fact> =
                cuts.iter().filter(|c| c.at > i && !c.keep.contains(&id)).flat_map(|c| c.facts.iter().copied()).collect();
            if !hidden.is_empty() {
                stands = out.state.hide(&hidden).apply(op).is_ok();
            }
            stands = stands && out.state.apply(op).is_ok();
        }
        out.stood.push(stands);
        if states {
            out.states.push(out.state.clone());
        }
    }
    out
}

/// Who stands when removals clash, the smallest first: the vault's root; then its owners by seniority, their place
/// among the owners where no removal has happened yet; then removals no owner approved; then revocations.
fn priority(base: &State, op: &Op) -> (u8, usize) {
    match &op.action {
        Action::RemoveOwner { vault, .. } | Action::RemoveDevice { vault, .. } | Action::SetRoot { vault, .. } => {
            match base.vault(*vault) {
                None => (2, 0),
                Some(vt) => {
                    let sigs: Vec<SignerId> = op.sigs().collect();
                    if vt.root.is_some_and(|r| sigs.contains(&r)) {
                        (0, 0)
                    } else if let Some(i) = vt.owners.iter().position(|&p| base.approves(&sigs, p)) {
                        (1, i)
                    } else {
                        (2, 0)
                    }
                }
            }
        }
        _ => (3, 0),
    }
}

/// The removals that stand among ops already in `order`, chosen one by one by priority: each stands if the ops
/// replayed with it and the ones chosen before it accept it and keep accepting those.
fn resolve(ops: &[Op], ids: &[OpId]) -> HashSet<OpId> {
    let mut rem = HashSet::new();
    if !ops.iter().any(Op::is_removal) {
        return rem;
    }
    let base = run(ops, ids, &rem, false).state;
    let mut cands: Vec<usize> = (0..ops.len()).filter(|&i| ops[i].is_removal()).collect();
    cands.sort_by_key(|&i| priority(&base, &ops[i]));
    for r in cands {
        let mut trial = rem.clone();
        trial.insert(ids[r]);
        let stood = run(ops, ids, &trial, false).stood;
        if (0..ops.len()).all(|i| !trial.contains(&ids[i]) || stood[i]) {
            rem = trial;
        }
    }
    rem
}

/// A peer's replay of the ops it holds: the one order, which ops stand, and what it knows.
pub struct Replay {
    pub ops: Vec<Op>,
    pub stood: Vec<bool>,
    pub state: State,
}

impl Replay {
    /// The ids of the ops that stand, in replay order.
    pub fn standing(&self) -> Vec<OpId> {
        self.ops.iter().zip(&self.stood).filter(|(_, s)| **s).map(|(o, _)| o.id()).collect()
    }
}

pub fn replay(ops: &[Op]) -> Replay {
    let ops = order(ops);
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    let rem = resolve(&ops, &ids);
    let Run { stood, state, .. } = run(&ops, &ids, &rem, false);
    Replay { ops, stood, state }
}

/// What a peer holding `ops` knows: their replay in `order` from the empty state, refused ops skipped, every removal
/// cutting what it hadn't seen.
pub fn view(ops: &[Op]) -> State {
    replay(ops).state
}

/// Every state along the replay of `ops` in `order`, the empty state first and the view last.
pub fn trace(ops: &[Op]) -> Vec<State> {
    let ops = order(ops);
    let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
    let rem = resolve(&ops, &ids);
    run(&ops, &ids, &rem, true).states
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
    /// skips the rules would send. A write with no `deps` builds on its entry's heads. A removal keeps, beside what
    /// its `keep` names, every op of the log that stands now and that it would cut otherwise: an honest device keeps
    /// all it had seen.
    pub fn draft(&self, author: SignerId, cosigners: &[SignerId], action: Action) -> Op {
        let parents = self.heads();
        let depth = self.ops.iter().filter(|o| parents.contains(&o.id())).map(|o| o.depth + 1).max().unwrap_or(0);
        let mut op = Op { parents, depth, author, cosigners: cosigners.to_vec(), action };
        if let Action::Write { space, entry, deps, .. } = &mut op.action
            && deps.is_empty()
        {
            *deps = self.view().heads(*space, *entry);
        }
        if op.is_removal() {
            // replayed with the removals that stand now and this one, everything that stands now must still stand
            let before = replay(&self.ops);
            let standing: HashSet<OpId> = before.standing().into_iter().collect();
            let rem: HashSet<OpId> = before.ops.iter().filter(|o| o.is_removal() && standing.contains(&o.id())).map(Op::id).collect();
            loop {
                let mut all = self.ops.clone();
                all.push(op.clone());
                let ops = order(&all);
                let ids: Vec<OpId> = ops.iter().map(Op::id).collect();
                let mut trial = rem.clone();
                trial.insert(op.id());
                let stood = run(&ops, &ids, &trial, false).stood;
                let keep = op.action.keep_mut().expect("a removal");
                let lost: Vec<OpId> = ids
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
        op
    }

    /// The ops no other op of the log builds on, sorted.
    pub fn heads(&self) -> Vec<OpId> {
        let built_on: HashSet<OpId> = self.ops.iter().flat_map(|o| o.parents.iter().copied()).collect();
        let mut heads: Vec<OpId> = self.ops.iter().map(Op::id).filter(|id| !built_on.contains(id)).collect();
        heads.sort();
        heads.dedup();
        heads
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
    fn an_op_never_sorts_ahead_of_a_parent_it_holds() {
        let passkey = SignerId::from_u64(1);
        let mut log = Log::new();
        let genesis =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: None, nonce: 0 };
        let v = VaultId::from(log.append(passkey, &[], genesis).unwrap());
        let honest = log.draft(passkey, &[SignerId::from_u64(2)], Action::AddDevice { vault: v, device: SignerId::from_u64(2) });
        assert_eq!(honest.depth, 1);
        // an op claiming to be no deeper than its parent is left out where the parent is held…
        let shallow = Op { depth: 0, ..honest.clone() };
        let with_parent = [log.ops()[0].clone(), shallow.clone(), honest.clone()];
        assert_eq!(order(&with_parent).iter().filter(|o| **o == shallow).count(), 0);
        assert_eq!(order(&with_parent).last(), Some(&honest));
        // …and orders by what it claims where it isn't, as it does on every peer missing that parent
        assert_eq!(order(std::slice::from_ref(&shallow)), vec![shallow]);
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

    #[test]
    fn a_drop_takes_what_builds_on_it_along() {
        let w = |n: u64, deps: &[u64]| Write {
            op: OpId::from_u64(n),
            author: SignerId::from_u64(1),
            actor: VaultId::from_u64(1),
            space: SpaceId::from_u64(1),
            entry: EntryId::from_u64(1),
            epoch: 0,
            deps: deps.iter().map(|&d| OpId::from_u64(d)).collect(),
        };
        // 2 builds on 1, 3 on 2, 4 on 1: without 2, 3 goes too
        let kept = close_deps(vec![w(1, &[]), w(3, &[2]), w(4, &[1])]);
        assert_eq!(kept.iter().map(|x| x.op).collect::<Vec<_>>(), [OpId::from_u64(1), OpId::from_u64(4)]);
    }
}
