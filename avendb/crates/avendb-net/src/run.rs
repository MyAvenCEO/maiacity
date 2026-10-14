//! One API (`docs/ARCHITECTURE.md` §8): every read and every change of a device's database, from its page, the Mac app
//! or an agent, is one JSON op of avendb's engine (`avendb::engine`), run on the node (`Node::run`) and answered as
//! JSON: `{"ok": ...}`, a refusal, or for a change its vault's owners approve with no ceremony at hand,
//! `{"approve": ...}`. What the engine can't do on a Lab alone, the node does around it: it shows where each entry and
//! file is synced to (`world`), reads and brings a file's bytes (`read_file`, `put_file`), has the passkey sign what
//! its vault approves in a ceremony, and asks its peers again once the vaults it follows change (`follow`).

use std::io;
use std::sync::Arc;

use anyhow::{Context as _, Result, bail};
use avendb::engine::{self, Prepared, Refused};
use avendb::id::BlobId;
use avendb::lab::Lab;
use avendb::policy::Refusal;
use avendb::sign::Ceremony;
use bytes::Bytes;
use iroh::EndpointId;
use n0_future::{Stream, stream, task};
use serde_json::{Value, json};

use crate::{Authenticator, Node, Shared, Step};

/// No bytes beside an op: what `Node::run` takes for every op but `put_file`.
pub type NoBytes = stream::Empty<io::Result<Bytes>>;

/// No ceremony at hand, as for an agent: an op its vault's owners approve answers `approve` and makes nothing
/// (`Node::run`). A ceremony asked of it fails.
pub struct NoCeremony;

impl Authenticator for NoCeremony {
    async fn ceremony(&self, _: [u8; 32], _: Step) -> Result<Ceremony> {
        bail!("no passkey's ceremony is at hand")
    }
}

impl Node {
    /// Runs op `op` of the engine: its answer, `{"ok": ...}` or `{"refused", "why"}`, and for `read_file` the bytes it
    /// read, beside. A read runs on what the device holds, an ask (`may`, `shares`) dry; a change is made, and its
    /// peers are told. One its vault's owners approve, `authenticator`, if given, signs in the passkey's ceremony
    /// (`Step::Approve`), and it is made: else it answers `{"approve": {challenge, signers, draft}}` and makes nothing.
    /// `world` shows where each entry and file is synced to (`synced_to`); `read_file` reads from the device's store,
    /// or else from a peer that may hand the bytes over (`read_file`), a file the device doesn't open refused
    /// (`NoCap`); `put_file` checks the entry it would create before it reads a byte of `bytes`, which it seals into
    /// the store as they come (`store_file`); `follow` asks every peer again once the vaults the device follows
    /// changed, each request naming them. Fails only where no answer comes: a ceremony that failed, the store or the
    /// network failing, a file's bytes more or fewer than its length.
    pub async fn run<S, A>(
        &self,
        op: Value,
        bytes: Option<S>,
        authenticator: Option<&A>,
    ) -> Result<(Value, Option<Vec<u8>>)>
    where
        S: Stream<Item = io::Result<Bytes>> + Unpin,
        A: Authenticator,
    {
        let name = engine::name(&op).map(str::to_string);
        let answer = match name.as_deref() {
            Some("world") => {
                let synced = self.synced_to().await;
                self.read(move |lab, me| engine::world(lab, me, &synced)).await
            }
            Some("read_file") => return self.read_bytes(&op).await,
            Some("put_file") => self.put(op, bytes).await?,
            Some("follow") => self.follow(op).await,
            _ if engine::asks(&op) => self.dry(move |lab, me| engine::run(lab, me, &op)).await,
            _ if engine::reads(&op) => self.read(move |lab, me| engine::read(lab, me, &op)).await,
            _ => self.change(op, authenticator).await?,
        };
        Ok((answer, None))
    }

    /// Runs op `op` with no bytes beside it and no ceremony at hand (`run`): a change its vault's owners approve
    /// answers `approve`.
    pub async fn op(&self, op: Value) -> Result<Value> {
        Ok(self.run(op, None::<NoBytes>, None::<&NoCeremony>).await?.0)
    }

    /// `read_file`: the answer, and the bytes beside.
    async fn read_bytes(&self, op: &Value) -> Result<(Value, Option<Vec<u8>>)> {
        let (root, range) = match engine::file_of(op) {
            Ok(file) => file,
            Err(why) => return Ok((why.to_json(), None)),
        };
        if !self.read(move |lab, me| lab.file(me, &root).is_some()).await {
            return Ok((Refused::Rule(Refusal::NoCap).to_json(), None));
        }
        let from = range.start;
        let bytes = self.read_file(root, range).await?;
        let (hash, len) = (BlobId(root.hash).to_hex(), bytes.len() as u64);
        Ok((json!({ "ok": { "root": hash, "from": from, "to": from + len, "len": len } }), Some(bytes)))
    }

    /// `put_file`: the entry it would create checked, then the bytes stored, then the entry made.
    async fn put<S>(&self, op: Value, bytes: Option<S>) -> Result<Value>
    where
        S: Stream<Item = io::Result<Bytes>> + Unpin,
    {
        let len = match engine::len_of(&op) {
            Ok(len) => len,
            Err(why) => return Ok(why.to_json()),
        };
        let checked = {
            let op = op.clone();
            self.dry(move |lab, me| engine::verdict(lab, me, &op)).await
        };
        if checked != Value::Bool(true) {
            return Ok(checked);
        }
        let brought = self.store_file(len, bytes.context("put_file brings the file's bytes beside it")?).await?;
        Ok(self.act(move |lab, me| engine::put_file(lab, me, &op, brought)).await)
    }

    /// `follow`: run, and every peer asked again if the vaults the device follows changed.
    async fn follow(&self, op: Value) -> Value {
        let before = self.read(|lab, me| lab.follows(me).to_vec()).await;
        let (answer, after) = self.act(move |lab, me| (engine::run(lab, me, &op), lab.follows(me).to_vec())).await;
        if after != before {
            self.shared.ask_all();
        }
        answer
    }

    /// A change: made, or drafted for the passkey to approve and, with a ceremony at hand, signed in it and made.
    async fn change<A: Authenticator>(&self, op: Value, authenticator: Option<&A>) -> Result<Value> {
        let prepared = self.act(move |lab, me| engine::prepare(lab, me, &op)).await;
        let (approval, authenticator) = match (prepared, authenticator) {
            (Ok(Prepared::Approve(a)), Some(authenticator)) => (a, authenticator),
            (prepared, _) => return Ok(engine::prepared(prepared)),
        };
        let ceremony = authenticator.ceremony(approval.challenge(), Step::Approve).await?;
        let approve = move |lab: &mut Lab, me| engine::approve(lab, me, approval, &ceremony);
        Ok(match self.act(approve).await {
            Ok(v) => json!({ "ok": v }),
            Err(why) => why.to_json(),
        })
    }
}

impl Shared {
    /// Asks every peer it is connected to again, as once the vaults its device follows changed: each request names
    /// them (`sync::Ask::follow`).
    fn ask_all(self: &Arc<Self>) {
        let peers: Vec<EndpointId> = self.peers.lock().expect("peers").keys().copied().collect();
        for endpoint in peers {
            let shared = self.clone();
            task::spawn(async move {
                if let Err(e) = shared.ask(endpoint).await {
                    tracing::debug!("avendb: asking {endpoint} again failed: {e:#}");
                }
            });
        }
    }
}
