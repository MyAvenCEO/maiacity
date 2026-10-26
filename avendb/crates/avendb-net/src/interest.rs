//! Interests: what each mounted view wants, in tiers (Lean `AvenDB/Interest.lean`, step P3 of sync v2). A view sets
//! its Interests through one scope and its unmount clears them: no lease and no timer. Interests order what the node
//! brings; they grant no access, change no vault and never say a view is complete.
//!
//! The order (`Interests::entries`) is the Lean `schedule`: every entry of a higher tier before every entry of a lower
//! one, inside a tier the scopes interleaved so a large view cannot hold every slot before a second view's first row,
//! and each entry once, at the highest tier any scope wants it (`schedule_best`). Tiers only order: the set is what the
//! scopes want, whatever their tiers (`schedule_whole`).

use std::collections::{BTreeMap, BTreeSet};
use avendb::sync::LogId;

/// How many scopes a node keeps; a new one past it replaces the one changed longest ago (a page that closed without
/// clearing its scope, The OS's page reloaded), never a timer.
pub(crate) const MOST_SCOPES: usize = 128;
/// How many entries one scope names, over all its tiers.
pub(crate) const MOST_ENTRIES: usize = 512;
/// How many wants one scope holds.
pub(crate) const MOST_WANTS: usize = 32;
/// How many type selectors one scope holds (`discovery::Query`).
pub(crate) const MOST_QUERIES: usize = 8;

/// When a view wants it: on screen, one click away, the rest of the screen's data, and what the device keeps offline.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Tier { Now, Next, Later, Idle }

impl Tier {
    pub(crate) const ALL: [Tier; 4] = [Tier::Now, Tier::Next, Tier::Later, Tier::Idle];
    pub(crate) fn parse(name: &str) -> Option<Self> {
        Some(match name { "now" => Tier::Now, "next" => Tier::Next, "later" => Tier::Later, "idle" => Tier::Idle, _ => return None })
    }
}

/// One want of a scope: entries by id, nearest first as the view's signal orders them, and type selectors.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Want {
    pub tier: Tier,
    pub entries: Vec<LogId>,
    pub queries: Vec<crate::discovery::Query>,
}

impl Want {
    /// A want on screen now, of these entries alone.
    #[cfg(test)]
    pub(crate) fn now(entries: Vec<LogId>) -> Self { Self { tier: Tier::Now, entries, queries: vec![] } }
}

struct Scope {
    revision: u64,
    wants: Vec<Want>,
    /// Entries peers named for the scope's selectors, at the tier of its best selector.
    discovered: Vec<LogId>,
    /// When it last changed, by `Interests::clock`: the oldest makes room for a new scope.
    changed: u64,
}

impl Scope {
    fn live(&self) -> bool { self.wants.iter().any(|w| !w.entries.is_empty() || !w.queries.is_empty()) }
    fn queries(&self) -> Vec<crate::discovery::Query> {
        let mut out: Vec<crate::discovery::Query> = vec![];
        for want in self.ordered() { for q in &want.queries { if !out.contains(q) { out.push(q.clone()); } } }
        out
    }
    fn query_tier(&self) -> Option<Tier> { self.wants.iter().filter(|w| !w.queries.is_empty()).map(|w| w.tier).min() }
    /// The tier peer-named entries come at: the scope's best selector's, else (entries a named entry depends on, its
    /// schemas and lenses) its best named entry's.
    fn discovery_tier(&self) -> Option<Tier> {
        self.query_tier().or_else(|| self.wants.iter().filter(|w| !w.entries.is_empty()).map(|w| w.tier).min())
    }
    fn ordered(&self) -> Vec<&Want> {
        let mut wants: Vec<_> = self.wants.iter().collect();
        wants.sort_by_key(|w| w.tier);
        wants
    }
    fn at(&self, tier: Tier) -> Vec<LogId> {
        let mut out: Vec<LogId> = self.wants.iter().filter(|w| w.tier == tier).flat_map(|w| w.entries.iter().copied()).collect();
        if self.discovery_tier() == Some(tier) { out.extend(self.discovered.iter().copied()); }
        out
    }
    fn named(&self) -> usize { self.wants.iter().map(|w| w.entries.len()).sum::<usize>() + self.discovered.len() }
    fn holds(&self, log: &LogId) -> bool { self.wants.iter().any(|w| w.entries.contains(log)) || self.discovered.contains(log) }
}

#[derive(Default)]
pub(crate) struct Interests { scopes: BTreeMap<String, Scope>, clock: u64 }

impl Interests {
    /// Replace scope `scope`'s wants by `wants` at `revision`: false where it holds that revision or a later one
    /// already, so a delayed update never revives a cleared view. No wants clears the scope (and stays as a tombstone
    /// of its revision). Peer-named entries of unchanged selectors stay; changed selectors drop them.
    pub(crate) fn replace(&mut self, scope: String, revision: u64, wants: Vec<Want>) -> Result<bool, &'static str> {
        if self.scopes.get(&scope).is_some_and(|s| s.revision >= revision) { return Ok(false); }
        if wants.len() > MOST_WANTS { return Err("an interest holds at most 32 wants"); }
        if wants.iter().map(|w| w.entries.len()).sum::<usize>() > MOST_ENTRIES { return Err("an interest names at most 512 entries"); }
        if wants.iter().map(|w| w.queries.len()).sum::<usize>() > MOST_QUERIES { return Err("an interest holds at most eight type selectors"); }
        let held = self.scopes.remove(&scope);
        if held.is_none() && self.scopes.len() >= MOST_SCOPES {
            if let Some(oldest) = self.scopes.iter().min_by_key(|(_, s)| s.changed).map(|(k, _)| k.clone()) { self.scopes.remove(&oldest); }
        }
        self.clock += 1;
        let mut next = Scope { revision, wants, discovered: vec![], changed: self.clock };
        if let Some(held) = held.filter(|h| h.live() && h.queries() == next.queries()) {
            let kept: Vec<_> = held.discovered.into_iter().filter(|l| !next.holds(l)).collect();
            let room = MOST_ENTRIES.saturating_sub(next.named());
            next.discovered = kept.into_iter().take(room).collect();
        }
        self.scopes.insert(scope, next);
        Ok(true)
    }

    /// Clears every scope: The OS's page loaded again, so none of its views is mounted any more.
    pub(crate) fn release_all(&mut self) -> usize {
        let n = self.scopes.values().filter(|s| s.live()).count();
        self.scopes.clear();
        n
    }

    pub(crate) fn current(&self, scope: &str, revision: u64) -> bool {
        self.scopes.get(scope).is_some_and(|s| s.revision == revision && s.live())
    }
    /// A live scope's revision, the entries it names, best tier first, and its selectors, best tier first.
    pub(crate) fn working_set(&self, scope: &str) -> Option<(u64, Vec<LogId>, Vec<crate::discovery::Query>)> {
        self.scopes.get(scope).filter(|s| s.live()).map(|s| {
            let entries = s.ordered().into_iter().flat_map(|w| w.entries.iter().copied()).collect();
            (s.revision, entries, s.queries())
        })
    }
    pub(crate) fn query_scopes(&self) -> Vec<String> {
        self.scopes.iter().filter(|(_, s)| s.live()).map(|(scope, _)| scope.clone()).collect()
    }
    pub(crate) fn dependency_entries(&self, scope: &str, revision: u64) -> Vec<LogId> {
        self.scopes.get(scope).filter(|s| s.revision == revision)
            .map(|s| s.ordered().into_iter().flat_map(|w| w.entries.iter().copied()).chain(s.discovered.iter().copied()).collect())
            .unwrap_or_default()
    }

    /// Entries peers named for scope `scope`'s selectors at `revision`: false once that revision is gone.
    pub(crate) fn discovered(&mut self, scope: &str, revision: u64, logs: &[LogId]) -> bool {
        let Some(held) = self.scopes.get_mut(scope).filter(|s| s.revision == revision && s.live()) else { return false };
        for log in logs {
            if held.named() >= MOST_ENTRIES { break; }
            if !held.holds(log) { held.discovered.push(*log); }
        }
        true
    }

    /// Every entry the scopes want, in the scheduler's order (Lean `schedule`).
    pub(crate) fn entries(&self) -> Vec<LogId> {
        let mut seen = BTreeSet::new();
        let mut out = vec![];
        for tier in Tier::ALL {
            let rows: Vec<Vec<LogId>> = self.scopes.values().map(|s| s.at(tier)).collect();
            for row in 0..rows.iter().map(Vec::len).max().unwrap_or(0) {
                for scope in &rows {
                    if let Some(&log) = scope.get(row) { if seen.insert(log) { out.push(log); } }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::id::EntryId;
    use crate::discovery::Query;
    fn log(n: u8) -> LogId { LogId::Entry(EntryId([n; 32])) }
    fn want(tier: Tier, ids: &[u8]) -> Want { Want { tier, entries: ids.iter().map(|&n| log(n)).collect(), queries: vec![] } }
    fn query(ty: &str) -> Vec<Query> { vec![Query { types: vec![ty.into()], vault: None }] }

    #[test]
    fn higher_tiers_come_first_and_each_entry_once_at_its_best_tier() {
        let mut i = Interests::default();
        i.replace("a".into(), 1, vec![want(Tier::Idle, &[1, 2]), want(Tier::Now, &[3])]).unwrap();
        i.replace("b".into(), 1, vec![want(Tier::Next, &[4]), want(Tier::Now, &[2, 5])]).unwrap();
        // schedule_ordered + schedule_best: 2 is idle for a, now for b, so it comes now; now before next before idle
        assert_eq!(i.entries(), vec![log(3), log(2), log(5), log(4), log(1)]);
    }

    #[test]
    fn a_click_moves_tiers_and_keeps_the_set() {
        let mut i = Interests::default();
        i.replace("v".into(), 1, vec![want(Tier::Now, &[1]), want(Tier::Later, &[2])]).unwrap();
        let before: BTreeSet<_> = i.entries().into_iter().collect();
        i.replace("v".into(), 2, vec![want(Tier::Later, &[1]), want(Tier::Now, &[2])]).unwrap();
        assert_eq!(i.entries(), vec![log(2), log(1)]);
        assert_eq!(before, i.entries().into_iter().collect(), "retier_same_set");
    }

    #[test]
    fn replacing_and_clearing_end_the_old_revision_and_reject_late_updates() {
        let mut i = Interests::default();
        i.replace("v".into(), 1, vec![Want::now(vec![log(1)])]).unwrap();
        assert!(i.current("v", 1));
        assert_eq!(i.replace("v".into(), 2, vec![]), Ok(true));
        assert!(!i.current("v", 1) && !i.current("v", 2));
        assert!(i.entries().is_empty(), "closed_brings_nothing");
        assert_eq!(i.replace("v".into(), 1, vec![Want::now(vec![log(1)])]), Ok(false), "a cleared view stays cleared");
    }

    #[test]
    fn scopes_are_bounded_by_the_oldest_change_never_by_time() {
        let mut i = Interests::default();
        for n in 0..MOST_SCOPES { i.replace(n.to_string(), 1, vec![Want::now(vec![log(1)])]).unwrap(); }
        i.replace("0".into(), 2, vec![Want::now(vec![log(2)])]).unwrap();
        i.replace("new".into(), 1, vec![Want::now(vec![log(3)])]).unwrap();
        assert!(i.current("new", 1));
        assert!(i.current("0", 2), "the scope changed last stays");
        assert!(!i.current("1", 1), "the scope changed longest ago makes room");
        assert!(i.replace("big".into(), 1, vec![Want::now(vec![log(1); MOST_ENTRIES + 1])]).is_err());
        assert_eq!(i.release_all(), MOST_SCOPES);
        assert!(i.entries().is_empty());
    }

    #[test]
    fn discovered_entries_take_the_tier_of_the_best_selector_and_survive_unchanged_selectors() {
        let mut i = Interests::default();
        let rooms = Want { tier: Tier::Next, entries: vec![], queries: query("room") };
        i.replace("v".into(), 1, vec![want(Tier::Now, &[1]), rooms.clone(), want(Tier::Later, &[2])]).unwrap();
        assert!(i.discovered("v", 1, &[log(9), log(1)]));
        assert_eq!(i.entries(), vec![log(1), log(9), log(2)]);
        i.replace("v".into(), 2, vec![want(Tier::Now, &[3]), rooms]).unwrap();
        assert_eq!(i.entries(), vec![log(3), log(9)], "an unchanged selector keeps what peers named");
        assert!(!i.discovered("v", 1, &[log(8)]), "old work stays cancelled");
        i.replace("v".into(), 3, vec![Want { tier: Tier::Now, entries: vec![], queries: query("cut") }]).unwrap();
        assert!(i.entries().is_empty(), "a changed selector drops them");
    }
}
