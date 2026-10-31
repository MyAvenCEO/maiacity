//! Caps' verdict on an envelope (`Aven.ID.Authorized`; caps README, "Checking", step 7). The docs layer hands caps
//! what an envelope carries inside its seal, the chain it rests on (root first) and the calls it names; caps judges
//! the calls, never the steps they lower to, which are the engine's.
//!
//! **Authorized:** the signing device acts within its device cap (rule 1), and the envelope writes on its vault's own
//! authority or under a chain:
//! - **own authority:** the signer's vault is the Doc's vault or governs it, and no actor host signed it;
//! - **a chain:** it keeps every rule, its last cap is held by the signer's vault, lets it write on the envelope's
//!   branch, and allows every call; an actor host's envelope names its acting actor (A27).
//!
//! A merge into main counts only when the grant covers the whole merge: the reader judges it on every call the merge
//! brings onto main ([`Reading::whole`]), not the fixing commit's alone (`merge_covered`, `merge_within_device`).

use aven_core::{Call, DocId, Facts, Step};

use super::chain::{Cap, ChainError, Ctx, vault_id};
use super::conditions::{Branches, Holder};
use super::line::{Line, World, grant_allows};

/// A device cap: what a device may do for the vault it serves, a cap from that vault to the device's own vault. `None`
/// grants are everything its vault may do except govern, which is never an op (rule 2); an agent's devices and the
/// Aven Peer hold narrower ones, and an agent's removals go to proposals.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceCap {
    pub device: String,
    pub vault: String,
    pub grants: Option<Vec<Line>>,
    pub branches: Branches,
    /// An actor host's device (A27): its grants the union of its hosted actors' standing caps.
    pub host: bool,
}

impl DeviceCap {
    /// A call it lets its device make on a Doc (`DeviceCap.allows`).
    pub fn allows(&self, w: &World, f: &Facts, c: &Call) -> bool {
        self.grants
            .as_ref()
            .is_none_or(|g| grant_allows(w, g, f, c))
    }
}

/// What caps reads of one envelope: who signed it, its Doc and branch, the chain it rests on (empty on own
/// authority), the calls it makes, and the acting actor an actor host's envelope names.
#[derive(Clone, Debug)]
pub struct Reading<'e> {
    pub signer: &'e [u8],
    pub doc: DocId,
    pub branch: &'e str,
    pub chain: &'e [Cap],
    pub calls: Vec<Call>,
    pub actor: Option<DocId>,
}

impl Reading<'_> {
    /// Its footprint: the steps its calls lower to, which the engine checks what it changed against
    /// (`Reader.footprint`). The lowering is the engine's (`Aven.DB.Engine.Lower`), so it is given.
    pub fn footprint(&self, lower: impl Fn(&Call) -> Vec<Step>) -> Vec<Step> {
        self.calls.iter().flat_map(lower).collect()
    }

    /// A merge into main, read whole (`WholeMerges`): its calls and every call the merge brings onto main from main's
    /// version at its `prev`.
    pub fn whole(mut self, merge: &[Call]) -> Self {
        for c in merge {
            if !self.calls.contains(c) {
                self.calls.push(c.clone());
            }
        }
        self
    }
}

/// Why an envelope isn't authorized: the first thing the verdict found missing.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refusal {
    /// The signing key is no device the reader knows, or its device cap isn't from the vault it serves.
    Device,
    /// The device cap doesn't let it write on this branch.
    DeviceBranch,
    /// The reader doesn't know the Doc.
    UnknownDoc,
    /// The device cap doesn't allow the call at this place in the envelope's calls.
    DeviceCall(usize),
    /// No own authority, and no chain.
    NoAuthority,
    /// The chain breaks a rule.
    Chain(Box<ChainError>),
    /// The signer's vault doesn't hold the chain's last cap.
    NotHolder,
    /// The chain's last cap doesn't write on this branch.
    Branch,
    /// The chain's last cap doesn't allow the call at this place.
    Call(usize),
    /// An actor host signed it without naming its actor (A27).
    NoActor,
}

/// The path an authorized envelope took.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Path {
    /// Its vault's own authority: the Doc's vault, or one that governs it.
    Own,
    /// A chain, held by its signer's vault.
    Chain,
}

/// What a reader knows: its chain context, who governs whom (with what actors spawned and collections list), the
/// network's members, the vault each signing key is a device of, and each device's cap (`Reader`).
pub struct Reader<'a> {
    pub ctx: Ctx<'a>,
    pub world: World<'a>,
    pub member: &'a dyn Fn(&str) -> bool,
    pub vault_of: &'a dyn Fn(&[u8]) -> Option<String>,
    pub device_cap: &'a dyn Fn(&[u8]) -> Option<DeviceCap>,
}

impl Reader<'_> {
    /// `v` holds `c`: it is `c`'s vault, in `c`'s group now, or, for the public, a member of the network (`holdsAt`).
    pub fn holds_at(&self, c: &Cap, v: &str) -> bool {
        match &c.holder {
            Holder::Vault(w) => w == v,
            Holder::Group(g) => (self.ctx.in_group)(g, v),
            Holder::Public => (self.member)(v),
        }
    }

    fn facts(&self, e: &Reading) -> Option<Facts> {
        (self.ctx.facts)(&e.doc)
    }

    /// The signing device acts within its device cap: the cap is from the vault it serves, lets it write on the
    /// envelope's branch, and allows every call (`WithinDevice`).
    pub fn within_device(&self, e: &Reading) -> Result<DeviceCap, Refusal> {
        let dc = (self.device_cap)(e.signer).ok_or(Refusal::Device)?;
        if (self.vault_of)(e.signer).as_deref() != Some(dc.vault.as_str()) {
            return Err(Refusal::Device);
        }
        if !dc.branches.allows(e.branch) {
            return Err(Refusal::DeviceBranch);
        }
        let f = self.facts(e).ok_or(Refusal::UnknownDoc)?;
        if let Some(i) = e.calls.iter().position(|c| !dc.allows(&self.world, &f, c)) {
            return Err(Refusal::DeviceCall(i));
        }
        Ok(dc)
    }

    /// Its vault's own authority: the signer's vault is the Doc's vault, or governs it (`Own`).
    pub fn own(&self, e: &Reading) -> bool {
        let (Some(v), Some(f)) = ((self.vault_of)(e.signer), self.facts(e)) else {
            return false;
        };
        let v = vault_id(&v);
        f.vault == v || (self.world.gov)(&v, &f.vault)
    }

    /// Under a chain: it keeps every rule, its last cap is held by the signer's vault, lets it write on the
    /// envelope's branch, and allows every call (`ByChain`).
    pub fn by_chain(&self, e: &Reading) -> Result<(), Refusal> {
        if let Some(err) = self.ctx.chain_error(e.chain) {
            return Err(Refusal::Chain(Box::new(err)));
        }
        let last = e
            .chain
            .last()
            .ok_or_else(|| Refusal::Chain(Box::new(ChainError::Empty)))?;
        if !(self.vault_of)(e.signer).is_some_and(|v| self.holds_at(last, &v)) {
            return Err(Refusal::NotHolder);
        }
        if !last.conditions.branches.allows(e.branch) {
            return Err(Refusal::Branch);
        }
        let f = self.facts(e).ok_or(Refusal::UnknownDoc)?;
        let g = last.grants(self.ctx.roles);
        if let Some(i) = e
            .calls
            .iter()
            .position(|c| !grant_allows(&self.world, g, &f, c))
        {
            return Err(Refusal::Call(i));
        }
        Ok(())
    }

    /// Caps' verdict (`Authorized`): its device acts within its device cap, and it writes on its vault's own
    /// authority (never an actor host's) or under a chain (an actor host's naming its actor).
    pub fn authorized(&self, e: &Reading) -> Result<Path, Refusal> {
        let dc = self.within_device(e)?;
        if !dc.host && self.own(e) {
            return Ok(Path::Own);
        }
        if e.chain.is_empty() {
            return Err(Refusal::NoAuthority);
        }
        self.by_chain(e)?;
        if dc.host && e.actor.is_none() {
            return Err(Refusal::NoActor);
        }
        Ok(Path::Chain)
    }
}
