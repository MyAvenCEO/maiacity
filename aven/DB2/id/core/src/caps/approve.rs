//! Approvals (`Aven.ID.Approve`): k of a vault's owners signing one digest, for one act (caps README, rule 25; D14).
//! An owner is a key or a vault: a key approves by having signed exactly the digest, a vault by its own quorum, and so
//! on up to keys.
//!
//! The model knows a signature as the key that made it and the digest it signed, the scheme taken as sound. So does
//! this module: a [`Sig`] is only ever made from a signature already verified under the key it names (the caller's
//! job, with [`crate::hybrid_verify`]), and here it is counted.

use std::collections::HashMap;

use crate::tree::{Owner, Tree};

/// A verified signature: the key id that made it and the digest it signed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sig {
    pub key: String,
    pub digest: String,
}

impl Sig {
    pub fn new(key: impl Into<String>, digest: impl Into<String>) -> Sig {
        Sig {
            key: key.into(),
            digest: digest.into(),
        }
    }
}

/// Each item once, at its first place (`dedup`, `ownersOnce`).
fn once<T: PartialEq>(items: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut out = Vec::new();
    for x in items {
        if !out.contains(&x) {
            out.push(x);
        }
    }
    out
}

impl Tree {
    /// `k` is one of `vault`'s owner keys.
    fn owner_key(&self, vault: &str, k: &str) -> bool {
        self.vault(vault)
            .is_some_and(|v| v.owner_keys().any(|o| o == k))
    }

    /// The owner keys of `vault` that signed exactly `digest`, each once (`approvers`).
    pub fn approvers<'a>(&self, vault: &str, digest: &str, sigs: &'a [Sig]) -> Vec<&'a str> {
        once(
            sigs.iter()
                .filter(|s| s.digest == digest && self.owner_key(vault, &s.key))
                .map(|s| s.key.as_str()),
        )
    }

    /// `k` of `vault`'s owner keys signed exactly `digest` (`approved`).
    pub fn approved(&self, k: usize, vault: &str, digest: &str, sigs: &[Sig]) -> bool {
        k <= self.approvers(vault, digest, sigs).len()
    }

    /// `vault`'s owners approve `digest` by its threshold, an owner vault by its own, recursively (`approves`). A tree
    /// is only ever well formed, so every owner stands lower than what it owns, and one answer per vault is the
    /// model's, which looks as many levels up as the tree has vaults (`approves_iff`).
    pub fn approves(
        &self,
        threshold: &dyn Fn(&str) -> usize,
        vault: &str,
        digest: &str,
        sigs: &[Sig],
    ) -> bool {
        let mut memo = HashMap::new();
        self.approves_memo(threshold, vault, digest, sigs, &mut memo)
    }

    fn approves_memo(
        &self,
        threshold: &dyn Fn(&str) -> usize,
        vault: &str,
        digest: &str,
        sigs: &[Sig],
        memo: &mut HashMap<String, bool>,
    ) -> bool {
        if let Some(&known) = memo.get(vault) {
            return known;
        }
        let Some(v) = self.vault(vault) else {
            return false;
        };
        let mut yes = 0;
        for o in once(v.owners.iter()) {
            let ok = match o {
                Owner::Key(k) => sigs.iter().any(|s| &s.key == k && s.digest == digest),
                Owner::Vault(a) => self.approves_memo(threshold, a, digest, sigs, memo),
            };
            if ok {
                yes += 1;
            }
        }
        let answer = threshold(vault) <= yes;
        memo.insert(vault.to_string(), answer);
        answer
    }
}
