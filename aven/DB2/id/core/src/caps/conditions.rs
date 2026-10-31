//! A cap's conditions, holder and form (`Aven.ID.Caps`; caps README, "Conditions", "Holders"): the parts of a cap
//! that don't name an op. Each narrows as the model's does, so a chain's conditions only tighten down it.

use aven_core::DocId;

/// Which branches a cap may write: any, main only, proposals only, or one branch by its name (never main).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Branches {
    Any,
    Main,
    Proposals,
    One(String),
}

/// Main, as an envelope names its branch.
pub const MAIN: &str = "main";

impl Branches {
    /// `self` allows no branch `wider` doesn't (`Branches.within`).
    pub fn within(&self, wider: &Branches) -> bool {
        match (self, wider) {
            (_, Branches::Any) => true,
            (Branches::Main, Branches::Main) => true,
            (Branches::Proposals, Branches::Proposals) => true,
            (Branches::One(_), Branches::Proposals) => true,
            (Branches::One(b), Branches::One(c)) => b == c,
            _ => false,
        }
    }

    /// Whether a cap with these branches writes on `branch`: main only on main, proposals on every branch but main,
    /// one branch only on it (`Branches.allows`).
    pub fn allows(&self, branch: &str) -> bool {
        match self {
            Branches::Any => true,
            Branches::Main => branch == MAIN,
            Branches::Proposals => branch != MAIN,
            Branches::One(c) => branch == c && branch != MAIN,
        }
    }
}

/// How much history a reader opens: all of it, or only from the grant on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum History {
    All,
    FromNow,
}

impl History {
    pub fn within(self, wider: History) -> bool {
        !(self == History::All && wider == History::FromNow)
    }

    pub fn name(self) -> &'static str {
        match self {
            History::All => "all",
            History::FromNow => "from-now",
        }
    }
}

/// `c` is no looser than `p`, an absent bound being none at all (`atMost`).
fn at_most(c: Option<u64>, p: Option<u64>) -> bool {
    match (c, p) {
        (_, None) => true,
        (Some(c), Some(p)) => c <= p,
        (None, Some(_)) => false,
    }
}

/// A cap's conditions: times as numbers, `approve` the approvals each act under it needs, `uses` how many acts, `own`
/// that it changes only Records its holder created.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Conditions {
    pub not_before: u64,
    pub expires: Option<u64>,
    pub approve: u64,
    pub uses: Option<u64>,
    pub own: bool,
    pub branches: Branches,
    pub history: History,
}

impl Default for Conditions {
    fn default() -> Conditions {
        Conditions {
            not_before: 0,
            expires: None,
            approve: 0,
            uses: None,
            own: false,
            branches: Branches::Any,
            history: History::All,
        }
    }
}

impl Conditions {
    /// `self` is at least as strict as `p` in every condition (`Conditions.narrows`).
    pub fn narrows(&self, p: &Conditions) -> bool {
        p.not_before <= self.not_before
            && at_most(self.expires, p.expires)
            && p.approve <= self.approve
            && at_most(self.uses, p.uses)
            && (!p.own || self.own)
            && self.branches.within(&p.branches)
            && self.history.within(p.history)
    }
}

/// Who holds a cap: a vault (devices are vaults), everyone in a group (its Doc, of avenID's type `group`), the public
/// (every member of the network, D15), or a ticket's one-time key until a vault claims it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Holder {
    Vault(String),
    Group(DocId),
    Public,
    Ticket(String),
}

/// A cap's form: a **grant** starts a chain or passes its parent on to a holder, with its issuer's owners' approval
/// (D14); an **attenuation** narrows its parent for the same holder (D16) and needs no approval (A27).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Form {
    Grant,
    Attenuate,
}

impl Form {
    /// How many hops a link passes its parent on: a grant one, an attenuation none.
    pub fn hops(self) -> u64 {
        match self {
            Form::Grant => 1,
            Form::Attenuate => 0,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            Form::Grant => "grant",
            Form::Attenuate => "attenuate",
        }
    }

    pub fn parse(s: &str) -> Option<Form> {
        match s {
            "grant" => Some(Form::Grant),
            "attenuate" => Some(Form::Attenuate),
            _ => None,
        }
    }
}
