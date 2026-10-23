//! Ephemeral view demand, local to a node. It orders missing entry logs but grants no access and changes no vault.
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
        self.0.insert(scope, Scope { revision, entries, until: now + LEASE });
        Ok(true)
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
