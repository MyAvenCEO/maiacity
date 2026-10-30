//! The door of an Aven Peer that keeps its tree (PRODUCTION.md, Part A): with `--rp-id` and `--origin`, and no cast,
//! its tree is data in its store. The claim is the first signup: one statement, stored as a blob, with the ref `claim`
//! set to it from nothing by compare-and-set, so a second signup finds it taken, even racing the first; each sign-in
//! is stored the same way under `signin-000001`, `signin-000002`, … in the order they came. The deploy's health step
//! reads `refs/claim` to tell whether the network is claimed, so the name stays. A start reads the tree back and checks
//! every statement again (`Network::restore`); one that fails stops the peer rather than leave the network open to a
//! new claim. A wiped store is an unclaimed network. Given `--guardian`, the vault a claim founds is owned by
//! MaiaCityGuardian too. The claim founds the admin coop as well (PRODUCTION.md, Part C), named by `--admin-coop`:
//! configuration, not part of the statement, so the stored claim still reads back after a rename.
//!
//! Claims and sign-ins take turns, under one lock: the one writer (README, rule 1).

use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_core::wire::Frame;
use aven_db_store::backend::DalStore;
use aven_db_store::{Error as StoreError, RefName, Store};
use aven_id::{Claim, ClaimError, Network, Relying, SignIn};
use bytes::Bytes;
use serde_json::{Value, json};
use tokio::sync::{Mutex, watch};

use crate::{Notes, now};

pub const CLAIM: &str = "claim";
const SIGN_IN: &str = "signin-";
/// The network's vault and the Aven Peer's own, by the ids the tree knows them by.
pub const NETWORK: &str = "aven";
pub const PEER: &str = "aven-peer";

pub struct Door {
    me: String,
    store: Arc<DalStore>,
    network: Mutex<Network>,
    told: watch::Sender<Network>,
    notes: Notes,
}

fn store_error(e: StoreError) -> String {
    format!("the store: {e}")
}

fn sign_in_ref(n: usize) -> String {
    format!("{SIGN_IN}{n:06}")
}

async fn read(store: &DalStore, name: &RefName) -> Result<Value, String> {
    let hash = store
        .get_ref(name)
        .await
        .map_err(store_error)?
        .ok_or("a ref vanished")?;
    let bytes = store
        .get(&hash)
        .await
        .map_err(store_error)?
        .ok_or_else(|| format!("{name:?} points at nothing"))?;
    serde_json::from_slice(&bytes).map_err(|e| format!("{}: {e}", name.as_str()))
}

impl Door {
    /// The door over `store`: the network read back from it, every statement checked again.
    pub async fn open(
        me: String,
        store: Arc<DalStore>,
        peer_key: &str,
        rp: Relying,
        guardian: Option<String>,
        (coop, coop_name): (&str, &str),
        notes: Notes,
    ) -> Result<Door, String> {
        let base = Network::new(NETWORK, PEER, peer_key, rp, guardian).with_coop(coop, coop_name);
        let refs = store.list_refs().await.map_err(store_error)?;
        let mut claim = None;
        let mut sign_ins = Vec::new();
        for name in &refs {
            if name.as_str() == CLAIM {
                claim = Some(Claim::from_json(&read(&store, name).await?)?);
            } else if name.as_str().starts_with(SIGN_IN) {
                sign_ins.push(SignIn::from_json(&read(&store, name).await?)?);
            }
        }
        let network = base
            .restore(claim, sign_ins)
            .map_err(|e| format!("the stored tree does not hold: {e}"))?;
        let (told, _) = watch::channel(network.clone());
        let door = Door {
            me,
            store,
            network: Mutex::new(network),
            told,
            notes,
        };
        door.tell("network", &*door.network.lock().await);
        Ok(door)
    }

    fn note(&self, event: &str, fields: Value) {
        (self.notes)(timeline::line(now(), &self.me, event, fields));
    }

    /// The timeline's line for the network as it is: claimed or not, and its tree.
    fn tell(&self, event: &str, n: &Network) {
        let tree = n.claim().and_then(|_| n.tree().ok()).map(|t| t.to_cast());
        let devices = n
            .vaults()
            .iter()
            .filter(|v| v.kind == aven_id::Kind::Device)
            .count();
        self.note(
            event,
            json!({ "claimed": n.claim().is_some(), "devices": devices, "tree": tree }),
        );
    }

    /// The network as it is now.
    pub fn network(&self) -> Network {
        self.told.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<Network> {
        self.told.subscribe()
    }

    /// What the network frame tells the browser whose key is `key`: claimed or not, and the tree to its devices only.
    pub fn frame(n: &Network, key: &str) -> Frame {
        let tree = n
            .has_device(key)
            .then(|| n.tree().ok().map(|t| t.to_cast()))
            .flatten();
        Frame::Network {
            claimed: n.claim().is_some(),
            tree,
        }
    }

    fn refused(&self, from: &str, why: String) -> String {
        self.note(
            "refused",
            json!({ "from": aven_id::device_id(from), "why": why }),
        );
        why
    }

    /// A claim from the browser whose key is `from`. Stored first; the network changes only once `claim` is set.
    pub async fn claim(&self, from: &str, statement: &str) -> Result<(), String> {
        let c = serde_json::from_str(statement)
            .map_err(|e| e.to_string())
            .and_then(|v| Claim::from_json(&v));
        let c = c.map_err(|why| self.refused(from, format!("not a claim: {why}")))?;
        let mut network = self.network.lock().await;
        let next = network
            .submit_claim(from, c.clone())
            .map_err(|e| self.refused(from, e.to_string()))?;
        self.keep(&RefName::new(CLAIM).map_err(store_error)?, c.to_json())
            .await
            .map_err(|e| self.refused(from, e))?;
        *network = next;
        self.told.send_replace(network.clone());
        self.note(
            "claimed",
            json!({ "person": c.person, "coop": network.coop, "device": c.device }),
        );
        self.tell("network", &network);
        Ok(())
    }

    pub async fn sign_in(&self, from: &str, statement: &str) -> Result<(), String> {
        let i = serde_json::from_str(statement)
            .map_err(|e| e.to_string())
            .and_then(|v| SignIn::from_json(&v));
        let i = i.map_err(|why| self.refused(from, format!("not a sign-in: {why}")))?;
        let mut network = self.network.lock().await;
        let next = network
            .submit_sign_in(from, i.clone())
            .map_err(|e| self.refused(from, e.to_string()))?;
        let name = RefName::new(sign_in_ref(network.sign_ins().len() + 1)).map_err(store_error)?;
        self.keep(&name, i.to_json())
            .await
            .map_err(|e| self.refused(from, e))?;
        *network = next;
        self.told.send_replace(network.clone());
        self.note("signed-in", json!({ "device": i.device }));
        self.tell("network", &network);
        Ok(())
    }

    /// A statement as a blob, and its ref set to it from nothing: a ref already there is a statement already taken.
    async fn keep(&self, name: &RefName, statement: Value) -> Result<(), String> {
        let blob = self
            .store
            .put(Bytes::from(statement.to_string()))
            .await
            .map_err(store_error)?;
        match self.store.set_ref(name, None, blob).await {
            Ok(()) => Ok(()),
            Err(StoreError::Stale { .. }) if name.as_str() == CLAIM => {
                Err(ClaimError::Taken.to_string())
            }
            Err(StoreError::Stale { .. }) => Err(format!("{} is taken", name.as_str())),
            Err(e) => Err(store_error(e)),
        }
    }
}
