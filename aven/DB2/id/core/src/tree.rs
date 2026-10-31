//! Keys, vaults of four kinds and their owners, every vault's name, and what makes a tree well formed: `Aven.ID.Tree`,
//! `Aven.ID.Name` and `Aven.ID.WF`.

use std::collections::HashMap;
use std::fmt;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Person,
    /// An agent's vault, usually an LLM agent's (Aven): owned by the vault that runs it, it acts through its own devices
    /// within the rights its owner gives it, and no person ever switches into it. Called a network's vault until 30 Oct
    /// 2026, with the same rules.
    Agent,
    /// Owned by people's or coops' vaults, and holds no devices: its people act for it through their own.
    Coop,
    Device,
}

impl Kind {
    pub fn parse(s: &str) -> Option<Kind> {
        match s {
            "person" => Some(Kind::Person),
            "agent" => Some(Kind::Agent),
            // the kind's name before 30 Oct 2026 (`Aven.ID.Before`): a stored or cast text that says it reads as an agent
            "network" => Some(Kind::Agent),
            "coop" => Some(Kind::Coop),
            "device" => Some(Kind::Device),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Person => "person",
            Kind::Agent => "agent",
            Kind::Coop => "coop",
            Kind::Device => "device",
        }
    }
}

/// An owner is a key or a vault, written `key:<id>` or `vault:<id>`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Owner {
    Key(String),
    Vault(String),
}

impl Owner {
    pub fn parse(s: &str) -> Option<Owner> {
        if let Some(id) = s.strip_prefix("key:") {
            Some(Owner::Key(id.to_string()))
        } else {
            s.strip_prefix("vault:")
                .map(|id| Owner::Vault(id.to_string()))
        }
    }

    pub fn vault(&self) -> Option<&str> {
        match self {
            Owner::Vault(id) => Some(id),
            Owner::Key(_) => None,
        }
    }

    pub fn key(&self) -> Option<&str> {
        match self {
            Owner::Key(id) => Some(id),
            Owner::Vault(_) => None,
        }
    }
}

impl fmt::Display for Owner {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Owner::Key(id) => write!(f, "key:{id}"),
            Owner::Vault(id) => write!(f, "vault:{id}"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    pub owners: Vec<Owner>,
    /// How many of its owners approve for it (D14, A28): k of n, at least one.
    pub threshold: usize,
}

impl Vault {
    pub fn owner_vaults(&self) -> impl Iterator<Item = &str> {
        self.owners.iter().filter_map(Owner::vault)
    }

    pub fn owner_keys(&self) -> impl Iterator<Item = &str> {
        self.owners.iter().filter_map(Owner::key)
    }
}

/// The longest name, in characters.
pub const MAX_NAME: usize = 64;
/// The longest name a person gives at signup, so every vault named after it fits.
pub const MAX_PERSON_NAME: usize = 48;

/// A vault's name (`Aven.ID.validName`): 1 to 64 characters, none of them a control character (Unicode's Cc).
pub fn valid_name(name: &str) -> bool {
    let n = name.chars().count();
    (1..=MAX_NAME).contains(&n) && !name.chars().any(char::is_control)
}

/// The name a person gives at signup (`Aven.ID.validPersonName`): a name of at most 48 characters.
pub fn valid_person_name(name: &str) -> bool {
    valid_name(name) && name.chars().count() <= MAX_PERSON_NAME
}

/// Why a tree is not well formed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Invalid {
    /// Two vaults share an id.
    Duplicate(String),
    /// A vault has no owner.
    Unowned(String),
    /// An owner is neither a known key nor a known vault.
    Unknown { vault: String, owner: Owner },
    /// A device's vault is not owned by exactly one vault, the one it serves.
    DeviceOwners(String),
    /// A device's vault owns another vault.
    DeviceOwns { device: String, vault: String },
    /// A device has no key of its own: none with its id.
    DeviceKeyless(String),
    /// A device's key owns a vault.
    DeviceKeyOwns { device: String, vault: String },
    /// A vault's name is none: empty, too long, or with a control character.
    Name(String),
    /// A coop is owned by something else than a person's or a coop's vault.
    CoopOwner { coop: String, owner: Owner },
    /// A coop holds a device.
    CoopDevice { coop: String, device: String },
    /// A vault's threshold is zero, so it would approve on no signature (A28).
    NoQuorum(String),
    /// A vault is above itself.
    Cycle(String),
}

impl fmt::Display for Invalid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Invalid::Duplicate(id) => write!(f, "two vaults are named {id}"),
            Invalid::Unowned(id) => write!(f, "{id} has no owner"),
            Invalid::Unknown { vault, owner } => write!(f, "{vault}'s owner {owner} is unknown"),
            Invalid::DeviceOwners(id) => {
                write!(f, "the device {id} must be owned by exactly one vault")
            }
            Invalid::DeviceOwns { device, vault } => write!(f, "the device {device} owns {vault}"),
            Invalid::DeviceKeyless(id) => write!(f, "the device {id} has no key"),
            Invalid::DeviceKeyOwns { device, vault } => {
                write!(f, "the device {device}'s key owns {vault}")
            }
            Invalid::Name(id) => write!(
                f,
                "{id}'s name must be 1 to {MAX_NAME} characters, without control characters"
            ),
            Invalid::CoopOwner { coop, owner } => {
                write!(
                    f,
                    "the coop {coop} is owned by {owner}, which is no person's or coop's vault"
                )
            }
            Invalid::CoopDevice { coop, device } => {
                write!(f, "the coop {coop} holds the device {device}")
            }
            Invalid::NoQuorum(id) => write!(f, "{id}'s threshold is zero"),
            Invalid::Cycle(id) => write!(f, "{id} is above itself"),
        }
    }
}

impl std::error::Error for Invalid {}

/// A well-formed tree of vaults, in order, with the public halves of the keys it knows (hex).
#[derive(Clone, Debug)]
pub struct Tree {
    pub(crate) keys: Vec<(String, String)>,
    pub(crate) vaults: Vec<Vault>,
    pub(crate) index: HashMap<String, usize>,
    /// The vaults each vault owns directly, in the tree's order.
    pub(crate) children: Vec<Vec<usize>>,
}

impl Tree {
    /// A tree, if it is well formed (`Aven.ID.Tree.WF`): each id once; every vault named and owned, by known keys and
    /// vaults; a device's vault owned by exactly one vault and owning nothing, with its own key, the key with its id,
    /// which owns nothing either; a coop owned by people's or coops' vaults only, holding no devices; and no vault
    /// above itself. The first rule broken is named in `Aven.ID.Tree.check`'s order.
    pub fn new(keys: Vec<(String, String)>, vaults: Vec<Vault>) -> Result<Tree, Invalid> {
        let mut index = HashMap::new();
        for (at, vault) in vaults.iter().enumerate() {
            if index.insert(vault.id.clone(), at).is_some() {
                return Err(Invalid::Duplicate(vault.id.clone()));
            }
        }
        let kind = |id: &str| index.get(id).map(|&at: &usize| vaults[at].kind);
        for vault in &vaults {
            if !valid_name(&vault.name) {
                return Err(Invalid::Name(vault.id.clone()));
            }
            if vault.owners.is_empty() {
                return Err(Invalid::Unowned(vault.id.clone()));
            }
            for owner in &vault.owners {
                let known = match owner {
                    Owner::Key(k) => keys.iter().any(|(id, _)| id == k),
                    Owner::Vault(v) => index.contains_key(v),
                };
                if !known {
                    return Err(Invalid::Unknown {
                        vault: vault.id.clone(),
                        owner: owner.clone(),
                    });
                }
            }
            if vault.kind == Kind::Device && !matches!(vault.owners.as_slice(), [Owner::Vault(_)]) {
                return Err(Invalid::DeviceOwners(vault.id.clone()));
            }
            for owner in vault.owner_vaults() {
                if vaults[index[owner]].kind == Kind::Device {
                    return Err(Invalid::DeviceOwns {
                        device: owner.to_string(),
                        vault: vault.id.clone(),
                    });
                }
            }
            if vault.kind == Kind::Device && !keys.iter().any(|(id, _)| *id == vault.id) {
                return Err(Invalid::DeviceKeyless(vault.id.clone()));
            }
            for key in vault.owner_keys() {
                if index
                    .get(key)
                    .is_some_and(|&at| vaults[at].kind == Kind::Device)
                {
                    return Err(Invalid::DeviceKeyOwns {
                        device: key.to_string(),
                        vault: vault.id.clone(),
                    });
                }
            }
            if vault.kind == Kind::Coop {
                let fits = |o: &Owner| {
                    o.vault()
                        .is_some_and(|v| matches!(kind(v), Some(Kind::Person | Kind::Coop)))
                };
                if let Some(owner) = vault.owners.iter().find(|o| !fits(o)) {
                    return Err(Invalid::CoopOwner {
                        coop: vault.id.clone(),
                        owner: owner.clone(),
                    });
                }
            }
            if vault.kind == Kind::Device
                && let Some(coop) = vault.owner_vaults().find(|&v| kind(v) == Some(Kind::Coop))
            {
                return Err(Invalid::CoopDevice {
                    coop: coop.to_string(),
                    device: vault.id.clone(),
                });
            }
            if vault.threshold == 0 {
                return Err(Invalid::NoQuorum(vault.id.clone()));
            }
        }
        let mut children = vec![Vec::new(); vaults.len()];
        for (at, vault) in vaults.iter().enumerate() {
            for owner in vault.owner_vaults() {
                let parent = &mut children[index[owner]];
                if !parent.contains(&at) {
                    parent.push(at);
                }
            }
        }
        for list in &mut children {
            list.sort_unstable();
        }
        if let Some(at) = cycle(&children) {
            return Err(Invalid::Cycle(vaults[at].id.clone()));
        }
        Ok(Tree {
            keys,
            vaults,
            index,
            children,
        })
    }

    pub fn vaults(&self) -> &[Vault] {
        &self.vaults
    }

    /// A vault's threshold as the tree stores it (`Tree.threshold`); 1 for a vault it doesn't hold.
    pub fn threshold(&self, id: &str) -> usize {
        self.vault(id).map_or(1, |v| v.threshold)
    }

    pub fn vault(&self, id: &str) -> Option<&Vault> {
        self.index.get(id).map(|&at| &self.vaults[at])
    }

    pub fn kind(&self, id: &str) -> Option<Kind> {
        self.vault(id).map(|vault| vault.kind)
    }

    /// The public half of a key, in hex. A device's key has its device vault's id.
    pub fn key(&self, id: &str) -> Option<&str> {
        self.keys
            .iter()
            .find(|(k, _)| k == id)
            .map(|(_, public)| public.as_str())
    }

    pub fn keys(&self) -> impl Iterator<Item = (&str, &str)> {
        self.keys
            .iter()
            .map(|(id, public)| (id.as_str(), public.as_str()))
    }
}

/// A vault that is above itself, if any: depth first over what each vault owns.
fn cycle(children: &[Vec<usize>]) -> Option<usize> {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        New,
        Open,
        Done,
    }
    let mut mark = vec![Mark::New; children.len()];
    for root in 0..children.len() {
        if mark[root] != Mark::New {
            continue;
        }
        mark[root] = Mark::Open;
        let mut stack = vec![(root, 0)];
        while let Some(&mut (at, ref mut next)) = stack.last_mut() {
            if let Some(&child) = children[at].get(*next) {
                *next += 1;
                match mark[child] {
                    Mark::Open => return Some(child),
                    Mark::New => {
                        mark[child] = Mark::Open;
                        stack.push((child, 0));
                    }
                    Mark::Done => {}
                }
            } else {
                mark[at] = Mark::Done;
                stack.pop();
            }
        }
    }
    None
}
