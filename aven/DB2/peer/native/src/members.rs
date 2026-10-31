//! The members-only door, as every peer keeps it (MILESTONE2.md, "the door is checked twice"): the keys the door admits
//! and a name for each, which every peer's `after_handshake` hook holds every connection to, on every ALPN. A peer
//! learns them by configuration (the cast's `--members`), or by checking every statement the Aven Peer tells it itself
//! (`aven_id::Members::from_statements`); the Aven Peer from its own door.
//!
//! Two exceptions, on our protocol only and only where an Aven Peer keeps its tree: while the network is unclaimed it
//! is `open`, so the first signup reaches it; and a newcomer the relay let in for a statement the network would take
//! from it now (`expect`) may bring that statement. Gossip never lets either in.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, RwLock};

use aven_gen1::timeline;
use aven_gen1::wire::ALPN;
use iroh::PublicKey;
use iroh::endpoint::{AfterHandshakeOutcome, Connection, EndpointHooks};
use serde_json::json;

use crate::{Notes, now};

#[derive(Default)]
struct Inner {
    /// each admitted key and the name it goes by
    keys: BTreeMap<PublicKey, String>,
    /// the vault each admitted key's device serves, when the tree is known
    vaults: BTreeMap<PublicKey, String>,
    open: bool,
    expected: BTreeSet<PublicKey>,
    /// how many times the admitted keys were set: the room joins again when it moves
    version: u64,
}

#[derive(Clone, Default)]
pub struct Gate(Arc<RwLock<Inner>>);

impl std::fmt::Debug for Gate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Gate")
            .field("admitted", &self.0.read().unwrap().keys.len())
            .finish()
    }
}

impl Gate {
    /// The keys the door admits now, each with its name and, when known, the vault its device serves.
    pub fn set(&self, keys: impl IntoIterator<Item = (PublicKey, String, Option<String>)>) {
        let mut inner = self.0.write().unwrap();
        inner.version += 1;
        inner.keys.clear();
        inner.vaults.clear();
        for (key, name, vault) in keys {
            inner.expected.remove(&key);
            if let Some(vault) = vault {
                inner.vaults.insert(key, vault);
            }
            inner.keys.insert(key, name);
        }
    }

    /// The door as the members' network says: every admitted key, by its device's id and the vault it serves.
    pub fn set_members(&self, m: &aven_id::Members) {
        let tree = m.tree().ok();
        let keys = m
            .publics()
            .into_iter()
            .filter(|(_, k)| m.admits(k))
            .filter_map(|(d, k)| {
                let key = crate::keys::public(&k).ok()?;
                let vault = tree
                    .as_ref()
                    .and_then(|t| t.acts_for(&d))
                    .map(str::to_string);
                Some((key, d, vault))
            });
        self.set(keys.collect::<Vec<_>>());
        self.open(m.network().claim().is_none());
    }

    /// How many times the admitted keys were set.
    pub fn version(&self) -> u64 {
        self.0.read().unwrap().version
    }

    /// Whether anyone may bring a statement: an unclaimed network.
    pub fn open(&self, open: bool) {
        self.0.write().unwrap().open = open;
    }

    /// A newcomer the relay let in for its statement.
    pub fn expect(&self, key: PublicKey) {
        self.0.write().unwrap().expected.insert(key);
    }

    /// Every key the door admits now.
    pub fn admitted(&self) -> std::collections::BTreeSet<PublicKey> {
        self.0.read().unwrap().keys.keys().copied().collect()
    }

    pub fn admits(&self, key: &PublicKey) -> bool {
        self.0.read().unwrap().keys.contains_key(key)
    }

    /// The same, for a key in hex as messages carry it.
    pub fn admits_hex(&self, key: &str) -> bool {
        crate::keys::public(key).is_ok_and(|k| self.admits(&k))
    }

    /// Whether the key may reach our protocol: admitted, or a newcomer bringing a statement.
    pub fn may_bring(&self, key: &PublicKey) -> bool {
        let inner = self.0.read().unwrap();
        inner.keys.contains_key(key) || inner.open || inner.expected.contains(key)
    }

    /// The name an admitted key goes by, and the vault its device serves.
    pub fn name(&self, key: &PublicKey) -> (String, Option<String>) {
        let inner = self.0.read().unwrap();
        let name = inner
            .keys
            .get(key)
            .cloned()
            .unwrap_or_else(|| key.fmt_short().to_string());
        (name, inner.vaults.get(key).cloned())
    }
}

/// Every peer's `after_handshake` hook: a connection whose key the door doesn't admit is closed at once, but for a
/// newcomer's statement on our protocol.
pub struct Hook {
    pub me: String,
    pub gate: Gate,
    pub notes: Notes,
}

impl std::fmt::Debug for Hook {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hook").field("me", &self.me).finish()
    }
}

impl EndpointHooks for Hook {
    async fn after_handshake<'a>(&'a self, conn: &'a Connection) -> AfterHandshakeOutcome {
        let key = conn.remote_id();
        let ours = conn.alpn() == ALPN;
        if self.gate.admits(&key) || (ours && self.gate.may_bring(&key)) {
            return AfterHandshakeOutcome::accept();
        }
        let line = json!({ "key": key.to_string(), "alpn": String::from_utf8_lossy(conn.alpn()), "by": "hook" });
        (self.notes)(timeline::line(now(), &self.me, "kept-out", line));
        AfterHandshakeOutcome::Reject {
            error_code: 403u32.into(),
            reason: b"not a member".to_vec(),
        }
    }
}
