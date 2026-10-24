//! Ephemeral view demand, local to a node. It orders missing entry logs and hydrates permitted files, but grants no access and changes no vault.
//! Leases keep a crashed tab from retaining priority forever; revisions reject delayed updates after replacement.

use std::collections::{BTreeMap, BTreeSet};
use avendb::sync::LogId;
use n0_future::time::{Duration, Instant};

pub(crate) const MOST_SCOPES: usize = 128;
pub(crate) const MOST_ENTRIES: usize = 512;
pub(crate) const LEASE: Duration = Duration::from_secs(90);

struct Scope {
    revision: u64,
    entries: Vec<LogId>,
    queries: Vec<crate::discovery::Query>,
    discovered: Vec<LogId>,
    until: Instant,
}

#[derive(Default)]
pub(crate) struct Demands(BTreeMap<String, Scope>);

impl Demands {
    pub(crate) fn replace(&mut self, scope: String, revision: u64, entries: Vec<LogId>, now: Instant) -> Result<bool, &'static str> {
        self.0.retain(|_, s| s.until > now);
        if self.0.get(&scope).is_some_and(|s| s.revision >= revision) { return Ok(false); }
        if !self.0.contains_key(&scope) && self.0.len() >= MOST_SCOPES { return Err("too many active view demands"); }
        if entries.len() > MOST_ENTRIES { return Err("a view demand names at most 512 entries"); }
        // An empty scope is a tombstone too: a delayed earlier update must not revive a closed view.
        self.0.insert(scope, Scope { revision, entries, queries: vec![], discovered: vec![], until: now + LEASE });
        Ok(true)
    }

    pub(crate) fn set_queries(&mut self, scope: &str, queries: Vec<crate::discovery::Query>) {
        if let Some(held) = self.0.get_mut(scope) { held.queries = queries; }
    }
    pub(crate) fn queries(&mut self, scope: &str, now: Instant) -> Option<(u64, Vec<crate::discovery::Query>)> {
        self.0.retain(|_, s| s.until > now);
        self.0.get(scope).filter(|s| !s.queries.is_empty()).map(|s| (s.revision, s.queries.clone()))
    }
    pub(crate) fn query_scopes(&mut self, now: Instant) -> Vec<String> {
        self.0.retain(|_, s| s.until > now);
        self.0.iter().filter(|(_, s)| !s.queries.is_empty()).map(|(scope, _)| scope.clone()).collect()
    }

    /// Hints share the view lease and revision, never outliving a released/replaced view.
    pub(crate) fn discovered(&mut self, scope: &str, revision: u64, logs: &[LogId], now: Instant) -> bool {
        let Some(held) = self.0.get_mut(scope).filter(|s| s.until > now && s.revision == revision && !s.queries.is_empty()) else { return false };
        for log in logs {
            if held.discovered.len() + held.entries.len() >= MOST_ENTRIES { break; }
            if !held.entries.contains(log) && !held.discovered.contains(log) { held.discovered.push(*log); }
        }
        true
    }

    pub(crate) fn entries(&mut self, now: Instant) -> Vec<LogId> {
        self.0.retain(|_, s| s.until > now);
        let scopes: Vec<_> = self.0.values().collect();
        let mut seen = BTreeSet::new();
        let mut entries = vec![];
        // Interleave visible windows so a large view cannot monopolize every slot before a second view's first row.
        for row in 0..scopes.iter().map(|s| s.entries.len()).max().unwrap_or(0) {
            for scope in &scopes {
                if let Some(&log) = scope.entries.get(row) {
                    if seen.insert(log) { entries.push(log); }
                }
            }
        }
        // Explicit IDs stay ahead of discovered candidates; interleave scopes for fairness.
        for row in 0..scopes.iter().map(|s| s.discovered.len()).max().unwrap_or(0) {
            for scope in &scopes {
                if let Some(&log) = scope.discovered.get(row) {
                    if seen.insert(log) { entries.push(log); }
                }
            }
        }
        entries
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::id::EntryId;
    fn entry(n: u8) -> LogId { LogId::Entry(EntryId([n; 32])) }

    #[test]
    fn replacement_release_and_expiry_do_not_remove_another_views_demand() {
        let now = Instant::now();
        let mut d = Demands::default();
        d.replace("a".into(), 1, vec![entry(3), entry(2)], now).unwrap();
        d.replace("b".into(), 1, vec![entry(3), entry(4)], now).unwrap();
        assert_eq!(d.entries(now), vec![entry(3), entry(2), entry(4)]);
        d.replace("a".into(), 3, vec![], now).unwrap();
        assert!(!d.replace("a".into(), 2, vec![entry(9)], now).unwrap());
        assert_eq!(d.entries(now), vec![entry(3), entry(4)]);
        assert!(d.entries(now + LEASE).is_empty());
    }

    #[test]
    fn scopes_are_bounded_and_expired_capacity_is_reclaimed() {
        let now = Instant::now();
        let mut d = Demands::default();
        for n in 0..MOST_SCOPES { d.replace(n.to_string(), 1, vec![entry(1)], now).unwrap(); }
        assert!(d.replace("extra".into(), 1, vec![], now).is_err());
        assert!(d.replace("extra".into(), 1, vec![], now + LEASE).is_ok());
        assert!(d.replace("large".into(), 1, vec![entry(1); MOST_ENTRIES + 1], now + LEASE).is_err());
    }
}

#[cfg(test)]
mod query_tests {
    use super::*;
    use crate::discovery::Query;
    #[test]
    fn discovery_scope_replacement_and_expiry_reject_late_results() {
        let now = Instant::now();
        let mut d = Demands::default();
        d.replace("view".into(), 1, vec![], now).unwrap();
        d.set_queries("view", vec![Query { types: vec!["note".into()], vault: None }]);
        assert_eq!(d.queries("view", now).unwrap().0, 1);
        let hinted = LogId::Entry(avendb::id::EntryId([19; 32]));
        assert!(d.discovered("view", 1, &[hinted], now));
        assert_eq!(d.entries(now), vec![hinted]);
        assert!(!d.replace("view".into(), 1, vec![], now).unwrap());
        d.replace("view".into(), 2, vec![], now).unwrap();
        assert!(d.queries("view", now).is_none());
        assert!(!d.discovered("view", 1, &[hinted], now));
        assert!(d.entries(now).is_empty());
        d.set_queries("view", vec![Query { types: vec!["note".into()], vault: None }]);
        assert!(d.queries("view", now + LEASE).is_none());
    }
}
