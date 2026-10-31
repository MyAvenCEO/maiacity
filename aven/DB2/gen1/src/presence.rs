//! Presence (`Aven.DB.Presence`): who is connected, as the Aven Peer counts it and tells each peer. It sees
//! connections, not peers, so it keeps a count of open connections per peer, and presence is the peers with at least
//! one: each connected peer counted once.

use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Presence<P: Ord> {
    conns: BTreeMap<P, usize>,
}

impl<P: Ord> Default for Presence<P> {
    fn default() -> Self {
        Presence {
            conns: BTreeMap::new(),
        }
    }
}

impl<P: Ord> Presence<P> {
    /// A connection of `peer` opened.
    pub fn join(&mut self, peer: P) {
        *self.conns.entry(peer).or_default() += 1;
    }

    /// A connection of `peer` closed; a peer that holds none is no-op.
    pub fn leave(&mut self, peer: &P) {
        if let Some(n) = self.conns.get_mut(peer) {
            *n -= 1;
            if *n == 0 {
                self.conns.remove(peer);
            }
        }
    }

    /// The peers connected now, each once, in order.
    pub fn present(&self) -> impl Iterator<Item = &P> {
        self.conns.keys()
    }

    /// What every peer is told: "N peers".
    pub fn count(&self) -> usize {
        self.conns.len()
    }

    pub fn contains(&self, peer: &P) -> bool {
        self.conns.contains_key(peer)
    }
}
