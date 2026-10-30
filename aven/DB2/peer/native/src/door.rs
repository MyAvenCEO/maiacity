//! The door of an Aven Peer that keeps its tree (PRODUCTION.md, Part A; MILESTONE2.md): with `--rp-id` and `--origin`,
//! and no cast, its tree is data in its store. The claim is the first signup: one statement, stored as a blob, with
//! the ref `claim` set to it from nothing by compare-and-set, so a second signup finds it taken, even racing the first;
//! each sign-in is stored the same way under `signin-000001`, `signin-000002`, … in the order they came. The deploy's
//! health step reads `refs/claim` to tell whether the network is claimed, so the name stays.
//!
//! From milestone 2 the admin's invites are stored under `invite-<id>`, their withdrawals under `withdrawn-<id>` and
//! the joins under `joined-<id>` (`aven_id::invite_id`), each set from nothing: an invite is used once, even when two
//! joins race for it. A start reads it all back and checks every statement again (`Members::restore`); one that fails
//! stops the peer rather than leave the network open to a new claim. A wiped store is an unclaimed network. Given
//! `--guardian`, every person's vault founded is owned by MaiaCityGuardian too.
//!
//! Statements take turns, under one lock: the one writer (README, rule 1).

use std::sync::Arc;

use aven_db_core::timeline;
use aven_db_core::wire::Frame;
use aven_db_store::backend::DalStore;
use aven_db_store::{Error as StoreError, RefName, Store};
use aven_id::{
    Claim, Invite, Join, MemberError, Members, Network, Pending, Relying, SignIn, Withdrawal,
    invite_id,
};
use bytes::Bytes;
use serde_json::{Value, json};
use tokio::sync::{Mutex, watch};

use crate::{Notes, now};

pub const CLAIM: &str = "claim";
const SIGN_IN: &str = "signin-";
const INVITE: &str = "invite-";
const WITHDRAWN: &str = "withdrawn-";
const JOINED: &str = "joined-";
/// The network's vault and the Aven Peer's own, by the ids the tree knows them by.
pub const NETWORK: &str = "aven";
pub const PEER: &str = "aven-peer";

pub struct Door {
    me: String,
    store: Arc<DalStore>,
    members: Mutex<Members>,
    told: watch::Sender<Members>,
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

/// A statement the door takes, as a browser sends it.
pub enum Statement {
    Claim(Claim),
    SignIn(SignIn),
    Invite(Invite),
    Withdraw(Withdrawal),
    Join(Join),
}

impl Statement {
    /// The statement a frame carries, if it carries one.
    pub fn of(frame: &Frame) -> Option<Result<Statement, String>> {
        let parse = |text: &str| serde_json::from_str::<Value>(text).map_err(|e| e.to_string());
        Some(match frame {
            Frame::Claim { statement } => parse(statement)
                .and_then(|v| Claim::from_json(&v))
                .map(Statement::Claim),
            Frame::SignIn { statement } => parse(statement)
                .and_then(|v| SignIn::from_json(&v))
                .map(Statement::SignIn),
            Frame::Invite { statement } => parse(statement)
                .and_then(|v| Invite::from_json(&v))
                .map(Statement::Invite),
            Frame::Withdraw { statement } => parse(statement)
                .and_then(|v| Withdrawal::from_json(&v))
                .map(Statement::Withdraw),
            Frame::Join { statement } => parse(statement)
                .and_then(|v| Join::from_json(&v))
                .map(Statement::Join),
            _ => return None,
        })
    }

    /// What a browser that is no device yet may bring: a claim, a sign-in or a join.
    pub fn pending(&self) -> Option<Pending> {
        match self {
            Statement::Claim(c) => Some(Pending::Claim(c.clone())),
            Statement::SignIn(i) => Some(Pending::SignIn(i.clone())),
            Statement::Join(j) => Some(Pending::Join(j.clone())),
            _ => None,
        }
    }
}

impl Door {
    /// The door over `store`: the members read back from it, every statement checked again.
    pub async fn open(
        me: String,
        store: Arc<DalStore>,
        peer_key: &str,
        rp: Relying,
        guardian: Option<String>,
        notes: Notes,
    ) -> Result<Door, String> {
        let base = Members::new(Network::new(NETWORK, PEER, peer_key, rp, guardian));
        let refs = store.list_refs().await.map_err(store_error)?;
        let (mut claim, mut sign_ins, mut invites, mut withdrawn, mut joins) =
            (None, vec![], vec![], vec![], vec![]);
        for name in &refs {
            let n = name.as_str();
            if n == CLAIM {
                claim = Some(Claim::from_json(&read(&store, name).await?)?);
            } else if n.starts_with(SIGN_IN) {
                sign_ins.push(SignIn::from_json(&read(&store, name).await?)?);
            } else if n.starts_with(INVITE) {
                invites.push(Invite::from_json(&read(&store, name).await?)?);
            } else if n.starts_with(WITHDRAWN) {
                withdrawn.push(Withdrawal::from_json(&read(&store, name).await?)?);
            } else if n.starts_with(JOINED) {
                joins.push(Join::from_json(&read(&store, name).await?)?);
            }
        }
        let members = base
            .restore(claim, sign_ins, invites, withdrawn, joins)
            .map_err(|e| format!("the stored tree does not hold: {e}"))?;
        let (told, _) = watch::channel(members.clone());
        let door = Door {
            me,
            store,
            members: Mutex::new(members),
            told,
            notes,
        };
        door.tell(&*door.members.lock().await);
        Ok(door)
    }

    fn note(&self, event: &str, fields: Value) {
        (self.notes)(timeline::line(now(), &self.me, event, fields));
    }

    /// The timeline's line for the network as it is: claimed or not, its tree, its members and invites.
    fn tell(&self, m: &Members) {
        let n = m.network();
        let tree = n.claim().and_then(|_| m.tree().ok()).map(|t| t.to_cast());
        let devices = m
            .vaults()
            .iter()
            .filter(|v| v.kind == aven_id::Kind::Device)
            .count();
        self.note(
            "network",
            json!({ "claimed": n.claim().is_some(), "devices": devices, "tree": tree,
                "members": m.members(), "invites": invites(m) }),
        );
    }

    /// The members as they are now.
    pub fn members(&self) -> Members {
        self.told.borrow().clone()
    }

    pub fn subscribe(&self) -> watch::Receiver<Members> {
        self.told.subscribe()
    }

    /// What the network frame tells the peer whose key is `key`: claimed or not, and to a device the door admits the
    /// tree and every statement, so it checks the members itself.
    pub fn frame(m: &Members, key: &str) -> Frame {
        let admitted = m.admits(key);
        Frame::Network {
            claimed: m.network().claim().is_some(),
            tree: admitted
                .then(|| m.tree().ok().map(|t| t.to_cast()))
                .flatten(),
            statements: admitted.then(|| m.statements().to_string()),
        }
    }

    fn refused(&self, from: &str, why: String) -> String {
        self.note(
            "refused",
            json!({ "from": aven_id::device_id(from), "why": why }),
        );
        why
    }

    /// A statement from the peer whose key is `from`. Stored first; the members change only once its ref is set.
    pub async fn take(
        &self,
        from: &str,
        statement: Result<Statement, String>,
    ) -> Result<(), String> {
        let s = statement.map_err(|why| self.refused(from, format!("not a statement: {why}")))?;
        let mut members = self.members.lock().await;
        let (next, name, kept, said) = match s {
            Statement::Claim(c) => (
                members.submit_claim(from, c.clone()),
                CLAIM.to_string(),
                c.to_json(),
                ("claimed", json!({ "person": c.person, "device": c.device })),
            ),
            Statement::SignIn(i) => (
                members.submit_sign_in(from, i.clone()),
                sign_in_ref(members.network().sign_ins().len() + 1),
                i.to_json(),
                ("signed-in", json!({ "device": i.device })),
            ),
            Statement::Invite(i) => (
                members.accept_invite(i.clone()),
                invite_id(&i.key),
                i.to_json(),
                ("invited", json!({ "invite": invite_id(&i.key) })),
            ),
            Statement::Withdraw(w) => (
                members.accept_withdrawal(w.clone()),
                format!("{WITHDRAWN}{}", &invite_id(&w.key)[INVITE.len()..]),
                w.to_json(),
                ("withdrawn", json!({ "invite": invite_id(&w.key) })),
            ),
            Statement::Join(j) => (
                members.submit_join(from, j.clone()),
                format!("{JOINED}{}", &invite_id(&j.invite)[INVITE.len()..]),
                j.to_json(),
                (
                    "joined",
                    json!({ "invite": invite_id(&j.invite), "person": j.person, "device": j.device }),
                ),
            ),
        };
        let next = next.map_err(|e: MemberError| self.refused(from, e.to_string()))?;
        self.keep(&RefName::new(name).map_err(store_error)?, kept)
            .await
            .map_err(|e| self.refused(from, e))?;
        *members = next;
        self.told.send_replace(members.clone());
        self.note(said.0, said.1);
        self.tell(&members);
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
                Err(aven_id::ClaimError::Taken.to_string())
            }
            Err(StoreError::Stale { .. }) if name.as_str().starts_with(JOINED) => {
                Err(MemberError::Used.to_string())
            }
            Err(StoreError::Stale { .. }) => Err(format!("{} is taken", name.as_str())),
            Err(e) => Err(store_error(e)),
        }
    }
}

/// The invites and what became of each, as avenOS shows them to the admin.
pub fn invites(m: &Members) -> Value {
    let all: Vec<Value> = m
        .invites()
        .iter()
        .map(|i| json!({ "id": invite_id(&i.key), "key": i.key, "state": m.state(&i.key) }))
        .collect();
    json!(all)
}
