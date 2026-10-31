//! The past, decided (`Aven.Core.Past`). Anything found by name that names its parents has a past among the things a
//! reader holds: what it builds on, and what those build on, until nothing new is found (`Before`). Core's envelopes
//! are one such thing, by the name a reader computes; the tree's statements another, by the name a peer stores each
//! under. Nothing here depends on which.
//!
//! Things are found by name: two held things with one name are both in the past or neither is (`Before.rename`).
//! Lean decides the past in rounds, each adding what something already found builds on (`pastNames`); this walks the
//! same names once each, so a reader holding `n` things with `p` parents in all spends `O((n + p) log n)`, and the
//! property tests check it against Lean's rounds on random inputs (`found_iff`, `inPast_iff`).

use alloc::collections::{BTreeMap, BTreeSet};
use alloc::vec::Vec;

use aven_codec::Hash;

/// The names a thing builds on, its parents (Lean's `Parents`).
pub trait Parents {
    fn parents(&self) -> Vec<Hash>;
}

/// The names of the things of `held` before `a` (`Past.past`, as a set): `a` itself is left out unless something it
/// builds on builds on it.
pub fn past<T: Parents>(nm: impl Fn(&T) -> Hash, held: &[T], a: &T) -> BTreeSet<Hash> {
    let names: Vec<Hash> = held.iter().map(nm).collect();
    past_named(held, &names, a)
}

/// `b` is before `a` among `held` (`Past.inPast`; `inPast_iff`: exactly `Before` for `b` in `held`).
pub fn in_past<T: Parents>(nm: impl Fn(&T) -> Hash, held: &[T], a: &T, b: &T) -> bool {
    let nb = nm(b);
    past(nm, held, a).contains(&nb)
}

/// [`past`] with each held thing's name already worked out: `names[i]` is the name of `held[i]`.
pub(crate) fn past_named<T: Parents>(held: &[T], names: &[Hash], a: &T) -> BTreeSet<Hash> {
    let mut by_name: BTreeMap<Hash, Vec<usize>> = BTreeMap::new();
    for (i, n) in names.iter().enumerate() {
        by_name.entry(*n).or_default().push(i);
    }
    let mut found = BTreeSet::new();
    let mut todo = a.parents();
    while let Some(n) = todo.pop() {
        let Some(things) = by_name.get(&n) else {
            continue;
        };
        if !found.insert(n) {
            continue;
        }
        for &i in things {
            todo.extend(held[i].parents());
        }
    }
    found
}
