//! Scoped sync (P5 of sync v2, `RangeSync.lean` R2): a device brings the logs a view wants, from every peer that holds
//! more of them at once, never a whole vault. It replaces the whole-vault `bring {vaults}` on the page.
//!
//! The scope is a set of logs: what `find` found (`blind`) or what a view names. Of each live peer, the logs of the scope
//! where the peer's announced holdings (`held`) say it holds what the device lacks (`differ`), each given to the peer
//! that holds it with the fewest logs given yet, so the work spreads over the peers; logs of the scope no peer announced
//! go to the peer that named them, or to every peer. Each peer's share is pulled in its own task, all of it one
//! request, so the device takes from all of them side by side (`scoped_round_agrees`: what a scoped round sends is of
//! the scope alone). A peer tells its new heads as it takes them (announcements), so nothing here waits on a timer.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use avendb::sync::LogId;
use iroh::EndpointId;

use crate::{Peer, Scope, Shared};

/// What a scoped sync did: how many new edits it took, of how many logs asked, from how many peers.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Scoped {
    pub new: usize,
    pub asked: usize,
    pub peers: usize,
}

/// Gives each log of `scope` to one peer: of the peers that hold more of it (`lacking`), the one given the fewest yet;
/// a log none holds more of goes to its `named` peer if any, else to every peer. Each peer's logs, smallest first.
pub(crate) fn assign(
    scope: &BTreeSet<LogId>,
    lacking: &BTreeMap<EndpointId, BTreeSet<LogId>>,
    named: &BTreeMap<LogId, EndpointId>,
    peers: &[EndpointId],
) -> BTreeMap<EndpointId, BTreeSet<LogId>> {
    let mut out: BTreeMap<EndpointId, BTreeSet<LogId>> = BTreeMap::new();
    for log in scope {
        let holders: Vec<EndpointId> = lacking.iter().filter(|(_, logs)| logs.contains(log)).map(|(p, _)| *p).collect();
        if let Some(best) = holders.iter().min_by_key(|p| out.get(*p).map_or(0, BTreeSet::len)) {
            out.entry(*best).or_default().insert(*log);
        } else if let Some(peer) = named.get(log).filter(|p| peers.contains(p)) {
            out.entry(*peer).or_default().insert(*log);
        } else {
            for p in peers {
                out.entry(*p).or_default().insert(*log);
            }
        }
    }
    out
}

impl Shared {
    /// Brings the logs of `scope` from the live peers, each log from one peer that holds more of it, all peers at once
    /// (`assign`). `named` says which peer named a log, where one did (`find`).
    pub(crate) async fn sync_scoped(
        self: &Arc<Self>,
        scope: BTreeSet<LogId>,
        named: BTreeMap<LogId, EndpointId>,
    ) -> Scoped {
        let Ok(_activity) = self.admit() else { return Scoped::default() };
        if scope.is_empty() {
            return Scoped::default();
        }
        let peers: Vec<Peer> =
            self.peers.lock().expect("peers").values().filter(|p| p.conn.close_reason().is_none()).cloned().collect();
        let mut lacking = BTreeMap::new();
        for p in &peers {
            let differ: BTreeSet<LogId> = self.differ(p.device).intersection(&scope).copied().collect();
            if !differ.is_empty() {
                lacking.insert(p.endpoint, differ);
            }
        }
        // what the device holds already and no peer holds more of stays out
        let held: BTreeSet<LogId> = {
            let wanted = scope.clone();
            let shared = self.clone();
            self.try_lab(move |lab, me| {
                let mine = shared.logs_of(lab, me);
                wanted.into_iter().filter(|l| mine.of.contains_key(l)).collect()
            })
            .await
            .unwrap_or_default()
        };
        let open: BTreeSet<LogId> =
            scope.iter().filter(|l| !held.contains(l) || lacking.values().any(|x| x.contains(l))).copied().collect();
        let endpoints: Vec<EndpointId> = peers.iter().map(|p| p.endpoint).collect();
        let plan = assign(&open, &lacking, &named, &endpoints);
        let asked = plan.values().map(BTreeSet::len).sum();
        let tasks: Vec<_> = plan
            .into_iter()
            .map(|(peer, logs)| {
                let shared = self.clone();
                async move {
                    // every log of its share in one asking, whose pages come by their places across all of them, so
                    // each steps on what came before (`Shared::ask_differing`)
                    shared.pull(peer, Scope::Logs(logs), true).await.unwrap_or(0)
                }
            })
            .collect();
        let peers = tasks.len();
        let new = crate::blind::join_all(tasks).await.into_iter().sum();
        Scoped { new, asked, peers }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::id::EntryId;

    fn e(n: u8) -> LogId {
        LogId::Entry(EntryId([n; 32]))
    }

    #[test]
    fn logs_spread_over_the_peers_that_hold_them_and_stay_in_scope() {
        let (a, b) = (iroh::SecretKey::from_bytes(&[1; 32]).public(), iroh::SecretKey::from_bytes(&[2; 32]).public());
        let scope: BTreeSet<LogId> = [e(1), e(2), e(3), e(4)].into();
        let lacking: BTreeMap<EndpointId, BTreeSet<LogId>> =
            [(a, [e(1), e(2), e(3), e(9)].into()), (b, [e(2), e(3)].into())].into();
        let named: BTreeMap<LogId, EndpointId> = [(e(4), b)].into();
        let plan = assign(&scope, &lacking, &named, &[a, b]);
        let all: BTreeSet<LogId> = plan.values().flatten().copied().collect();
        assert_eq!(all, scope, "every log of the scope goes to a peer, and nothing outside it (e9)");
        assert!(plan[&a].len() >= 1 && plan[&b].len() >= 2, "the work spreads: {plan:?}");
        assert!(plan[&b].contains(&e(4)), "a log no peer announced goes to the peer that named it");
        let plan = assign(&[e(5)].into(), &BTreeMap::new(), &BTreeMap::new(), &[a, b]);
        assert_eq!(plan.len(), 2, "a log nobody announced or named is asked of every peer");
    }
}
