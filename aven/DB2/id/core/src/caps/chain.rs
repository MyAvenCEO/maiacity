//! Caps and their chains (`Aven.ID.Caps`). A chain is written root first; each link after the root is a grant, which
//! passes its parent on to a holder with its issuer's owners' approval (D14), or an attenuation, which narrows its
//! parent for the same holder (D16). [`chain_error`] names the first rule a chain breaks, in the order a reader checks
//! them (`chainRules`), and none exactly when it keeps them all (`chainOk`). Lean proves what that buys: a chain only
//! narrows (`narrow_chain`, `narrow_ops`), every line it grants lies in its root issuer's authority
//! (`root_authority`), and it passes its root on no more often than its root may be shared (`chain_short`).

use aven_core::{CoreOp, DocId, Facts, Hash};

use super::approve::Sig;
use super::conditions::{Conditions, Form, Holder};
use super::line::{Grant, Line, grant_within};
use super::types::group_type;
use crate::tree::Tree;
use crate::vault_name::cast_name;

/// A role: a named bundle of grants, named by its hash, so it never changes under its holders (D6).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Role {
    pub id: String,
    pub name: String,
    pub grant: Vec<Line>,
}

/// A cap. Its id is its hash ([`Cap::digest`]); the signature by its issuer's device travels beside it, and its
/// issuer's owners' approvals over its id, verified, as [`Sig`]s. An attenuation carries none.
///
/// Its vaults are `V`s (A210): a fixture's readable handles, or the 32-byte names every format writes ([`Cap::named`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cap<V = String> {
    pub id: String,
    pub issuer: V,
    pub holder: Holder<V>,
    pub parent: Option<String>,
    pub form: Form,
    pub grant: Vec<Line>,
    pub role: Option<String>,
    pub share: u64,
    pub conditions: Conditions,
    /// The device that signed it, when one did; a vault without devices, such as a coop, issues by its owners'
    /// approvals alone (A28).
    pub signer: Option<V>,
    pub approvals: Vec<Sig>,
}

impl<V> Holder<V> {
    /// The holder, its vault named another way (`Holder.map`).
    pub fn map<W>(&self, f: impl Fn(&V) -> W) -> Holder<W> {
        match self {
            Holder::Vault(v) => Holder::Vault(f(v)),
            Holder::Group(g) => Holder::Group(*g),
            Holder::Public => Holder::Public,
        }
    }
}

impl<V: Clone> Cap<V> {
    /// The cap, its vaults named another way (`Cap.map`).
    pub fn map<W>(&self, f: impl Fn(&V) -> W) -> Cap<W> {
        Cap {
            id: self.id.clone(),
            issuer: f(&self.issuer),
            holder: self.holder.map(&f),
            parent: self.parent.clone(),
            form: self.form,
            grant: self.grant.clone(),
            role: self.role.clone(),
            share: self.share,
            conditions: self.conditions.clone(),
            signer: self.signer.as_ref().map(&f),
            approvals: self.approvals.clone(),
        }
    }
}

impl Cap {
    /// The cap as every format writes it: each vault by its name, a fixture handle by its cast genesis's
    /// (`c.map Named.name`, A210).
    pub fn named(&self) -> Cap<Hash> {
        self.map(|v| cast_name(v))
    }

    /// What it grants: its role's grant, pinned by the role's id, or its own. A role nobody holds grants nothing
    /// (`Cap.grants`).
    pub fn grants<'a>(&'a self, roles: &'a [Role]) -> &'a Grant {
        match &self.role {
            None => &self.grant,
            Some(r) => roles.iter().find(|x| &x.id == r).map_or(&[], |x| &x.grant),
        }
    }
}

/// What a reader knows when it checks a chain: the tree, how many owners each vault needs, who is in each group now,
/// the roles it holds, and what each Doc it knows is, as its genesis fixes it (`Ctx`).
pub struct Ctx<'a> {
    pub tree: &'a Tree,
    pub threshold: &'a dyn Fn(&str) -> usize,
    pub in_group: &'a dyn Fn(&DocId, &str) -> bool,
    pub roles: &'a [Role],
    pub facts: &'a dyn Fn(&DocId) -> Option<Facts>,
}

/// The first rule a chain breaks (`ChainError`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChainError {
    Empty,
    NotRoot(String),
    Authority(String, Line),
    Signer(String),
    Approval(String),
    PublicShares(String),
    KeepShares(String),
    Group(String),
    Parent(String),
    Issuer(String),
    Holder(String),
    Wider(String),
    Share(String),
    Conditions(String),
}

impl ChainError {
    /// The rule's name, as the vectors write it.
    pub fn rule(&self) -> &'static str {
        match self {
            ChainError::Empty => "empty",
            ChainError::NotRoot(_) => "notRoot",
            ChainError::Authority(..) => "authority",
            ChainError::Signer(_) => "signer",
            ChainError::Approval(_) => "approval",
            ChainError::PublicShares(_) => "publicShares",
            ChainError::KeepShares(_) => "keepShares",
            ChainError::Group(_) => "group",
            ChainError::Parent(_) => "parent",
            ChainError::Issuer(_) => "issuer",
            ChainError::Holder(_) => "holder",
            ChainError::Wider(_) => "wider",
            ChainError::Share(_) => "share",
            ChainError::Conditions(_) => "conditions",
        }
    }

    /// The cap that breaks it; none for an empty chain.
    pub fn cap(&self) -> Option<&str> {
        match self {
            ChainError::Empty => None,
            ChainError::NotRoot(c)
            | ChainError::Authority(c, _)
            | ChainError::Signer(c)
            | ChainError::Approval(c)
            | ChainError::PublicShares(c)
            | ChainError::KeepShares(c)
            | ChainError::Group(c)
            | ChainError::Parent(c)
            | ChainError::Issuer(c)
            | ChainError::Holder(c)
            | ChainError::Wider(c)
            | ChainError::Share(c)
            | ChainError::Conditions(c) => Some(c),
        }
    }
}

/// Its issuer signed cap `c` (`Tree.issued`, A28): the device that signed it acts for the issuer, or, with no device
/// signing, the issuer's owners approve it by their own quorum.
pub fn issued(t: &Tree, threshold: &dyn Fn(&str) -> usize, c: &Cap) -> bool {
    match &c.signer {
        Some(s) => t.acts_for(s) == Some(c.issuer.as_str()),
        None => t.approves(threshold, &c.issuer, &c.id, &c.approvals),
    }
}

/// `issuer` has authority over vault `v`'s Docs: `v` is its own, or one it governs whose quorum it meets alone
/// (`authorityOverVault`, A28). Authority runs down the tree only through quorums.
pub fn authority_over_vault(
    t: &Tree,
    threshold: &dyn Fn(&str) -> usize,
    issuer: &str,
    v: &Hash,
) -> bool {
    *v == cast_name(issuer)
        || t.governs(issuer)
            .into_iter()
            .any(|w| cast_name(w) == *v && t.alone(threshold, issuer, w))
}

impl Ctx<'_> {
    /// Who governs whom as authority runs (`Ctx.governs`, A28), by vault ids: `v` governs `w` when `w` is below it
    /// and `v` meets its quorum alone. It is the `gov` a reader gives targets and its own-authority check.
    pub fn governs(&self, v: &Hash, w: &Hash) -> bool {
        self.tree.vaults().iter().any(|a| {
            cast_name(&a.id) == *v
                && self
                    .tree
                    .governs(&a.id)
                    .into_iter()
                    .any(|b| cast_name(b) == *w && self.tree.alone(self.threshold, &a.id, b))
        })
    }

    /// The vault a line lies in: the vault its target names, or the vault of the Doc it names, as its genesis fixed;
    /// none for a Doc the reader doesn't know (`lineVault`).
    pub fn line_vault(&self, l: &Line) -> Option<Hash> {
        match &l.doc {
            aven_core::Target::Vault { vault, .. } | aven_core::Target::VaultType { vault, .. } => {
                Some(*vault)
            }
            aven_core::Target::Doc { doc, .. } => (self.facts)(doc).map(|f| f.vault),
        }
    }

    /// `issuer` has authority over a line: over the vault it lies in (`authorityOver`).
    pub fn authority_over(&self, issuer: &str, l: &Line) -> bool {
        self.line_vault(l)
            .is_some_and(|v| authority_over_vault(self.tree, self.threshold, issuer, &v))
    }

    /// `issuer` holds `p`: it is `p`'s vault, or in `p`'s group now. The public passes nothing on (`holds`).
    pub fn holds(&self, p: &Cap, issuer: &str) -> bool {
        match &p.holder {
            Holder::Vault(v) => v == issuer,
            Holder::Group(g) => (self.in_group)(g, issuer),
            Holder::Public => false,
        }
    }

    /// A holder the reader can type: a group that holds a cap is a Doc of avenID's type `group` (`Holder.typed`).
    fn typed(&self, h: &Holder) -> bool {
        match h {
            Holder::Group(g) => (self.facts)(g).is_some_and(|f| f.r#type == group_type()),
            _ => true,
        }
    }

    /// The first of the rules every cap must keep that `c` breaks (`capRules`): a device of its issuer signed it, its
    /// issuer's owners approved it unless it only attenuates, a public cap and a keep cap don't share, and a group
    /// that holds it is a group Doc.
    fn cap_error(&self, c: &Cap) -> Option<ChainError> {
        let id = || c.id.clone();
        if !issued(self.tree, self.threshold, c) {
            return Some(ChainError::Signer(id()));
        }
        if c.form != Form::Attenuate
            && !self
                .tree
                .approves(self.threshold, &c.issuer, &c.id, &c.approvals)
        {
            return Some(ChainError::Approval(id()));
        }
        if c.holder == Holder::Public && c.share != 0 {
            return Some(ChainError::PublicShares(id()));
        }
        let keep = CoreOp::Keep.id();
        if c.share != 0 && c.grants(self.roles).iter().any(|l| l.op == keep) {
            return Some(ChainError::KeepShares(id()));
        }
        if !self.typed(&c.holder) {
            return Some(ChainError::Group(id()));
        }
        None
    }

    /// The root's rules (`rootRules`): it names no parent and is a grant, every line it grants lies in its issuer's
    /// authority, then the rules every cap keeps.
    fn root_error(&self, r: &Cap) -> Option<ChainError> {
        if r.parent.is_some() || r.form != Form::Grant {
            return Some(ChainError::NotRoot(r.id.clone()));
        }
        if let Some(l) = r
            .grants(self.roles)
            .iter()
            .find(|l| !self.authority_over(&r.issuer, l))
        {
            return Some(ChainError::Authority(r.id.clone(), l.clone()));
        }
        self.cap_error(r)
    }

    /// A link's rules (`linkRules`): it names its parent, is issued by a holder of it, keeps its holder if it
    /// attenuates, lies within it, shares one hop less (a grant) or no further (an attenuation), and its conditions
    /// are at least as strict; then the rules every cap keeps.
    fn link_error(&self, p: &Cap, c: &Cap) -> Option<ChainError> {
        let id = || c.id.clone();
        if c.parent.as_ref() != Some(&p.id) {
            return Some(ChainError::Parent(id()));
        }
        if !self.holds(p, &c.issuer) {
            return Some(ChainError::Issuer(id()));
        }
        if c.form != Form::Grant && c.holder != p.holder {
            return Some(ChainError::Holder(id()));
        }
        if !grant_within(c.grants(self.roles), p.grants(self.roles)) {
            return Some(ChainError::Wider(id()));
        }
        if c.share
            .checked_add(c.form.hops())
            .is_none_or(|s| s > p.share)
        {
            return Some(ChainError::Share(id()));
        }
        if !c.conditions.narrows(&p.conditions) {
            return Some(ChainError::Conditions(id()));
        }
        self.cap_error(c)
    }

    /// The first rule a chain, root first, breaks, or none (`chainError`).
    pub fn chain_error(&self, chain: &[Cap]) -> Option<ChainError> {
        let Some(root) = chain.first() else {
            return Some(ChainError::Empty);
        };
        self.root_error(root).or_else(|| {
            chain
                .windows(2)
                .find_map(|pc| self.link_error(&pc[0], &pc[1]))
        })
    }

    /// The chain keeps every rule (`chainOk`).
    pub fn chain_ok(&self, chain: &[Cap]) -> bool {
        self.chain_error(chain).is_none()
    }
}
