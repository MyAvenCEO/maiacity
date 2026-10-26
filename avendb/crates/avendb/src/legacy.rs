//! The legacy anchor (`spec/AvenDB/LegacyAnchor.lean`): the hard fork off SLH-DSA (Samuel, 2026-10-26, "we trust all
//! current signers and devices"). Signing old edits again would give them new ids, as an edit's id hashes its author,
//! and break every link, pin and frontier: a reset. So the old edits keep their ids and lose their signatures instead.
//!
//! - **The freeze.** At the fork, the edits a device holds that an SLH-DSA signer signed (`freeze`), each once and
//!   sorted by id (`Frozen`), are hashed as one tree of a batch-signed log's kind (`batch::Tree`). Its root and its
//!   length are the anchor (`Anchor`), pinned in the repo as the Maia City vault's id is (H2). The ids themselves are
//!   kept in a file of their own (`Frozen::to_bytes`), for whoever hands out paths.
//! - **After it.** A device checks an SLH-DSA signer's part of an edit by a path up the tree to the anchor alone
//!   (`check`), never by its signature: an SLH-DSA key, stolen or not, signs nothing after the fork, whatever signature
//!   it brings. A part of any other signer it checks as before. Every frozen edit has its path (`Frozen::path`), so a
//!   device takes exactly the edits it took before the fork and knows exactly what it knew (`keeps_today`,
//!   `view_today`).
//!
//! An edit's id hashes its sealed bytes, author and signers included, so the anchor pins each frozen edit byte for
//! byte: one is swapped or added only by a BLAKE3 collision.

use std::collections::{BTreeMap, HashMap, HashSet};

use serde_json::{Value, json};

use crate::batch::{Hash, Path, Tree};
use crate::id::{EditId, SignerId, VaultId};
use crate::lab::Lab;
use crate::policy::{Action, Edit, Principal, replay};
use crate::recovery;
use crate::sign::{Signed, Suite};
use crate::words;

/// The version byte the file of frozen ids starts with (`Frozen::to_bytes`).
pub const FORMAT: u8 = 1;

/// The anchor: how many edits the fork froze, and the root of their tree.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Anchor {
    pub length: u64,
    pub root: Hash,
}

impl Anchor {
    /// Path `path` climbs from edit `edit` to the anchor: it was frozen.
    pub fn shows(&self, edit: EditId, path: &Path) -> bool {
        path.length == self.length && path.climb(edit) == Some(self.root)
    }

    /// As the repo pins it: `<length>:<root in hex>`.
    pub fn to_text(&self) -> String {
        format!("{}:{}", self.length, words::hex(&self.root))
    }

    /// `to_text` read back.
    pub fn from_text(s: &str) -> Option<Anchor> {
        let (length, root) = s.trim().split_once(':')?;
        let root = EditId::from_hex(root)?.0;
        Some(Anchor { length: length.parse().ok()?, root })
    }
}

/// The edits the fork froze: their ids, each once, sorted, as the tree the anchor is the root of.
#[derive(Clone, Debug)]
pub struct Frozen {
    tree: Tree,
}

impl Frozen {
    /// The edits `ids`, in any order and any number of times each.
    pub fn new(ids: impl IntoIterator<Item = EditId>) -> Frozen {
        let mut ids: Vec<EditId> = ids.into_iter().collect();
        ids.sort();
        ids.dedup();
        Frozen { tree: Tree::wrap(ids) }
    }

    pub fn anchor(&self) -> Anchor {
        Anchor { length: self.tree.len(), root: self.tree.root() }
    }

    pub fn len(&self) -> u64 {
        self.tree.len()
    }

    pub fn is_empty(&self) -> bool {
        self.tree.is_empty()
    }

    /// Whether it froze edit `edit`.
    pub fn holds(&self, edit: EditId) -> bool {
        self.tree.index(edit).is_some()
    }

    /// The path of edit `edit` up to the anchor (`paths` in the model), if it froze it.
    pub fn path(&self, edit: EditId) -> Option<Path> {
        self.tree.prove(self.tree.index(edit)?, self.tree.len())
    }

    /// The ids, sorted.
    pub fn ids(&self) -> impl Iterator<Item = EditId> + '_ {
        (0..self.tree.len()).filter_map(|i| self.tree.edit(i))
    }

    /// As a file: the version byte, then each id, sorted.
    pub fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(1 + 32 * self.tree.len() as usize);
        out.push(FORMAT);
        for id in self.ids() {
            out.extend_from_slice(&id.0);
        }
        out
    }

    /// `to_bytes` read back: only bytes it writes, each id once and in order.
    pub fn from_bytes(bytes: &[u8]) -> Option<Frozen> {
        let (&format, rest) = bytes.split_first()?;
        if format != FORMAT || rest.len() % 32 != 0 {
            return None;
        }
        let ids: Vec<EditId> = rest.chunks_exact(32).map(|c| EditId(c.try_into().expect("32 bytes"))).collect();
        if ids.windows(2).any(|w| w[0] >= w[1]) {
            return None;
        }
        Some(Frozen { tree: Tree::wrap(ids) })
    }
}

/// What the fork freezes of `edits`, each with its signers, `legacy` saying which signers are of SLH-DSA (`freeze` in
/// the model): the edits a legacy signer signed. `edits` are those a device takes at the fork.
pub fn freeze<S>(edits: impl IntoIterator<Item = (EditId, S)>, legacy: impl Fn(SignerId) -> bool) -> Frozen
where
    S: IntoIterator<Item = SignerId>,
{
    Frozen::new(edits.into_iter().filter_map(|(id, sigs)| sigs.into_iter().any(&legacy).then_some(id)))
}

/// After the fork, a signer signed edit `edit` (`check` in the model): for a legacy signer, the path held with it
/// climbs to the anchor; for any other, `auth` says so, as before the fork. A legacy signer's signature is never asked.
pub fn check(anchor: &Anchor, legacy: bool, edit: EditId, path: Option<&Path>, auth: impl FnOnce() -> bool) -> bool {
    match legacy {
        true => path.is_some_and(|p| anchor.shows(edit, p)),
        false => auth(),
    }
}

/// What the freeze finds among every edit the server holds, at the fork: the edits it freezes, and how the vaults stand,
/// so that whoever forks sees first that each vault that matters is governed in ML-DSA-65 alone.
#[derive(Debug)]
pub struct Survey {
    pub frozen: Frozen,
    /// How many edits it takes, every one of which it takes after the fork too.
    pub held: usize,
    /// Of those, the ones held bare on a checkpoint's word (`Checkpoint.lean`): their signers' keys and no signature.
    pub bare: usize,
    /// The edits whose signatures don't check, which it takes neither now nor after the fork.
    pub refused: usize,
    /// The frozen edits by the vault they came under, most first.
    pub by_vault: Vec<(Option<VaultId>, usize)>,
    /// Each vault: who governs it and acts for it, and in which suite.
    pub vaults: Vec<Value>,
    /// Each signer of SLH-DSA: how many edits it signed and the deepest of them, beside the deepest edit of all
    /// (`deepest`), so that whoever forks sees who still signs in SLH-DSA.
    pub slh_signers: Vec<Value>,
    pub deepest: u64,
}

/// The freeze, one edit at a time (`freeze`), so that it never holds more than one vault's signed edits at once: each
/// edit checked as a device checks what it takes (`Signed::verify`), frozen where any of its signers is of SLH-DSA, its
/// signers' suites kept from the keys its signatures bring; and of the edits that aren't writes, which alone say who
/// governs a vault and acts for it, the edit itself, replayed at the end (`finish`).
#[derive(Default)]
pub struct Freezing {
    ids: Vec<EditId>,
    held: usize,
    bare: usize,
    refused: usize,
    seen: HashSet<EditId>,
    suites: HashMap<SignerId, Suite>,
    counts: BTreeMap<Option<VaultId>, usize>,
    governing: Vec<Edit>,
    slh: HashMap<SignerId, (usize, u64)>,
    deepest: u64,
}

impl Freezing {
    /// Edit `signed`, which came under vault `under`'s snapshot. An edit taken twice counts once, under the first.
    pub fn take(&mut self, signed: &Signed, under: Option<VaultId>) {
        if !self.seen.insert(signed.edit.id()) {
            return;
        }
        let checks = signed.verify().is_ok();
        // held bare on a checkpoint's word: its signers' keys, and no signature to check
        let bare = !checks && signed.sigs.iter().all(|s| s.pq.is_empty() && s.enclave.is_none() && s.webauthn.is_none());
        if !checks && !bare {
            self.refused += 1;
            return;
        }
        (self.held, self.bare) = (self.held + 1, self.bare + usize::from(bare));
        self.deepest = self.deepest.max(signed.edit.depth);
        for sig in &signed.sigs {
            self.suites.insert(sig.keys.id(), sig.keys.suite());
            if sig.keys.suite() == Suite::SlhDsa {
                let (n, deepest) = self.slh.entry(sig.keys.id()).or_default();
                (*n, *deepest) = (*n + 1, (*deepest).max(signed.edit.depth));
            }
        }
        if signed.sigs.iter().any(|s| s.keys.suite() == Suite::SlhDsa) {
            self.ids.push(signed.edit.id());
            *self.counts.entry(under).or_default() += 1;
        }
        if !matches!(signed.edit.action, Action::Write { .. }) {
            self.governing.push(signed.edit.clone());
        }
    }

    /// The freeze of every edit taken, and the vaults as the edits that govern them say.
    pub fn finish(mut self) -> Survey {
        let frozen = Frozen::new(std::mem::take(&mut self.ids));
        let held = self.held;
        self.governing.sort_by_key(|e| (e.depth, e.id()));
        let st = replay(&self.governing).state;
        let suite = |s: &SignerId| self.suites.get(s).copied();
        let master = recovery::master();
        let signer = |s: SignerId| {
            let name = suite(&s).map_or("never seen signing", Suite::name);
            let master = master.as_ref().is_some_and(|m| m.id() == s);
            json!({ "signer": short(&s.0), "suite": name, "master": master })
        };
        let vaults = st
            .vaults()
            .iter()
            .map(|v| {
                let owners: Vec<Value> = v
                    .owners
                    .iter()
                    .map(|p| match *p {
                        Principal::Signer(s) => signer(s),
                        Principal::Vault(o) => json!({ "vault": short(&o.0) }),
                    })
                    .collect();
                let slh = |s: &SignerId| suite(s) == Some(Suite::SlhDsa);
                let left = v.owners.iter().filter(|p| matches!(p, Principal::Signer(s) if slh(s))).count()
                    + v.devices.iter().filter(|s| slh(s)).count();
                json!({
                    "vault": words::hex(&v.id.0),
                    "kind": format!("{:?}", v.kind),
                    "owners": owners,
                    "root": v.root.map(signer),
                    "devices": v.devices.iter().map(|&d| signer(d)).collect::<Vec<_>>(),
                    "slh_dsa_left": left,
                })
            })
            .collect();
        let mut by_vault: Vec<(Option<VaultId>, usize)> = self.counts.into_iter().collect();
        by_vault.sort_by_key(|(_, n)| std::cmp::Reverse(*n));
        let mut slh: Vec<(SignerId, (usize, u64))> = self.slh.into_iter().collect();
        slh.sort_by_key(|(s, (_, deepest))| (std::cmp::Reverse(*deepest), *s));
        let slh_signers = slh
            .into_iter()
            .map(|(s, (edits, deepest))| json!({ "signer": short(&s.0), "edits": edits, "deepest": deepest }))
            .collect();
        let (bare, refused, deepest) = (self.bare, self.refused, self.deepest);
        Survey { frozen, held, bare, refused, by_vault, vaults, slh_signers, deepest }
    }
}

/// The freeze of the edits device `on` of `lab` holds (`Freezing`).
pub fn survey(lab: &Lab, on: SignerId) -> Survey {
    let mut freezing = Freezing::default();
    for &id in lab.log(on).ids() {
        if let Some(signed) = lab.signed_edit(on, id) {
            freezing.take(signed, None);
        }
    }
    freezing.finish()
}

impl Survey {
    /// What it says, as JSON: the anchor, the counts, the frozen edits by vault and each vault's signers.
    pub fn to_json(&self) -> Value {
        let by_vault: Vec<Value> = self
            .by_vault
            .iter()
            .map(|(v, n)| json!({ "vault": v.map(|v| words::hex(&v.0)), "edits": n }))
            .collect();
        json!({
            "anchor": self.frozen.anchor().to_text(),
            "held": self.held,
            "frozen": self.frozen.len(),
            "kept_after_the_fork": self.held,
            "held_bare": self.bare,
            "refused_now": self.refused,
            "frozen_by_vault": by_vault,
            "vaults": self.vaults,
            "deepest": self.deepest,
            "slh_signers": self.slh_signers,
        })
    }
}

/// A signer's or vault's first 4 bytes in hex, as the Settings page shows them.
fn short(b: &[u8; 32]) -> String {
    words::hex(b)[..8].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_climb_to_the_anchor_and_nothing_else_does() {
        let ids: Vec<EditId> = (0..11).map(|i| EditId::from_u64(300 - 7 * i)).collect();
        let frozen = Frozen::new(ids.iter().rev().copied().chain(ids.iter().copied()));
        let anchor = frozen.anchor();
        assert_eq!(anchor.length, 11);
        for &id in &ids {
            assert!(anchor.shows(id, &frozen.path(id).expect("frozen")));
        }
        let other = EditId::from_u64(299);
        let path = frozen.path(ids[0]).expect("frozen");
        assert!(!anchor.shows(other, &path), "another edit's path");
        assert!(frozen.path(other).is_none());
        let shorter = Frozen::new(ids[..10].iter().copied());
        assert!(!anchor.shows(ids[0], &shorter.path(ids[0]).expect("frozen")), "a path of another tree");
        assert!(!check(&anchor, true, other, Some(&path), || true), "a signature that checks counts for nothing");
        assert!(check(&anchor, false, other, None, || true));
    }

    #[test]
    fn the_file_reads_back_and_takes_only_its_own_bytes() {
        let frozen = Frozen::new([3, 1, 2].map(EditId::from_u64));
        let bytes = frozen.to_bytes();
        let back = Frozen::from_bytes(&bytes).expect("reads back");
        assert_eq!(back.anchor(), frozen.anchor());
        assert_eq!(Anchor::from_text(&frozen.anchor().to_text()), Some(frozen.anchor()));
        let mut unsorted = bytes.clone();
        unsorted[1..33].copy_from_slice(&EditId::from_u64(9).0);
        assert!(Frozen::from_bytes(&unsorted).is_none());
        assert!(Frozen::from_bytes(&bytes[..bytes.len() - 1]).is_none());
        assert!(Frozen::from_bytes(&[2]).is_none());
        assert_eq!(Frozen::from_bytes(&[FORMAT]).map(|f| f.anchor()), Some(Frozen::new([]).anchor()));
    }
}
