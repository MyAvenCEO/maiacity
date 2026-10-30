//! What avenOS asks avenID: `Aven.ID.Query`, whose answers `Aven.ID.Correct` proves right and the property tests
//! hold this code to. Lists keep the tree's order; `governs` is depth first, so a vault followed by what it governs
//! is its tree as the Vault app shows it.

use crate::tree::{Kind, Tree};

impl Tree {
    fn at(&self, id: &str) -> Option<usize> {
        self.index.get(id).copied()
    }

    fn id(&self, at: usize) -> &str {
        &self.vaults[at].id
    }

    fn is(&self, id: &str, kind: Kind) -> bool {
        self.kind(id) == Some(kind)
    }

    /// The vaults `a` owns directly.
    pub fn owned(&self, a: &str) -> Vec<&str> {
        self.at(a).map_or_else(Vec::new, |at| {
            self.children[at].iter().map(|&c| self.id(c)).collect()
        })
    }

    /// Everything below `a`, depth first: what it governs.
    pub fn governs(&self, a: &str) -> Vec<&str> {
        let mut seen = vec![false; self.vaults.len()];
        let mut out = Vec::new();
        let mut stack: Vec<usize> = self.at(a).map_or_else(Vec::new, |at| {
            self.children[at].iter().rev().copied().collect()
        });
        while let Some(at) = stack.pop() {
            if std::mem::replace(&mut seen[at], true) {
                continue;
            }
            out.push(self.id(at));
            stack.extend(self.children[at].iter().rev());
        }
        out
    }

    /// The vaults above `b`, nearest first: those that govern it.
    pub fn chain(&self, b: &str) -> Vec<&str> {
        let mut seen = vec![false; self.vaults.len()];
        let mut out = Vec::new();
        let owners = |at: usize| {
            self.vaults[at]
                .owner_vaults()
                .map(|o| self.index[o])
                .collect::<Vec<_>>()
        };
        let mut stack: Vec<usize> = self
            .at(b)
            .map_or_else(Vec::new, |at| owners(at).into_iter().rev().collect());
        while let Some(at) = stack.pop() {
            if std::mem::replace(&mut seen[at], true) {
                continue;
            }
            out.push(self.id(at));
            stack.extend(owners(at).into_iter().rev());
        }
        out
    }

    /// The vault a device serves: its device vault's one owner. `None` for anything but a device.
    pub fn acts_for(&self, d: &str) -> Option<&str> {
        let vault = self.vault(d)?;
        if vault.kind != Kind::Device {
            return None;
        }
        vault.owner_vaults().next()
    }

    /// A vault's own devices: the device vaults it owns directly (Aven acts through the Aven Peer).
    pub fn acts_through(&self, a: &str) -> Vec<&str> {
        self.owned(a)
            .into_iter()
            .filter(|v| self.is(v, Kind::Device))
            .collect()
    }

    /// Whom a device may act as in avenOS: the person it serves, if it serves one. The box (`None`) holds every test
    /// key and may act as every person. Never a network or a device.
    pub fn accounts(&self, device: Option<&str>) -> Vec<&str> {
        match device {
            Some(d) => self
                .acts_for(d)
                .filter(|s| self.is(s, Kind::Person))
                .into_iter()
                .collect(),
            None => self
                .vaults
                .iter()
                .filter(|v| v.kind == Kind::Person)
                .map(|v| v.id.as_str())
                .collect(),
        }
    }

    /// The peers `a`'s Control Room shows: the devices it governs.
    pub fn sees(&self, a: &str) -> Vec<&str> {
        self.governs(a)
            .into_iter()
            .filter(|v| self.is(v, Kind::Device))
            .collect()
    }

    /// A device may act on a vault when the vault it serves is that vault or governs it.
    pub fn may_act_on(&self, d: &str, v: &str) -> bool {
        self.acts_for(d)
            .is_some_and(|s| s == v || self.governs(s).contains(&v))
    }
}
