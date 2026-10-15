//! One API (`docs/ARCHITECTURE.md` §8): every read and every change of a device's database, from its page, the Mac app
//! or an agent, is one JSON op of avendb's engine (`avendb::engine`), run on the node (`Node::run`) and answered as
//! JSON: `{"ok": ...}`, a refusal, or for a change its vault's owners approve with no ceremony at hand,
//! `{"approve": ...}`. What the engine can't do on a Lab alone, the node does around it: it shows where each entry and
//! file is synced to (`world`), reads and brings a file's bytes (`read_file`, `put_file`), tells what it does in the
//! background (`jobs`), has the passkey sign what its vault approves in a ceremony, and asks its peers again once the
//! vaults it follows change (`follow`).

use std::collections::BTreeMap;
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result, bail};
use avendb::engine::{self, Prepared, Refused};
use avendb::id::BlobId;
use avendb::lab::Lab;
use avendb::policy::Refusal;
use avendb::sign::Ceremony;
use bytes::Bytes;
use iroh::EndpointId;
use n0_future::{StreamExt as _, stream, task};
use serde_json::{Value, json};

use crate::{Authenticator, Node, Shared, Source, Step};

/// No bytes beside an op: what `Node::run` takes for every op but `put_file`.
pub type NoBytes = fn() -> stream::Empty<io::Result<Bytes>>;

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
    /// the store as they come (`store_file`), a `bring` job; `jobs` tells the node's jobs (`Node::jobs`); `follow`
    /// asks every peer again once the vaults the device follows changed, each request naming them. Fails only where no
    /// answer comes: a ceremony that failed, the store or the network failing, a file's bytes more or fewer than its
    /// length.
    pub async fn run<B, A>(
        &self,
        op: Value,
        bytes: Option<B>,
        authenticator: Option<&A>,
    ) -> Result<(Value, Option<Vec<u8>>)>
    where
        B: Source,
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
            Some("jobs") => json!({ "ok": self.jobs().to_json() }),
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
    async fn put<B: Source>(&self, op: Value, bytes: Option<B>) -> Result<Value> {
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
        let bytes = bytes.context("put_file brings the file's bytes beside it")?;
        // a job of its own, its bytes told as they come
        let name = op.get("name").and_then(Value::as_str).unwrap_or_default().to_string();
        let mut job = self.jobs().begin("bring", String::new(), name, len, "bytes");
        let vault = op.get("vault").and_then(Value::as_str).map(|v| (v.to_string(), len));
        job.about(vault.clone().into_iter().collect(), BTreeMap::new());
        job.stage("sealing");
        // read twice, for the file's key and then to seal it: each byte counts half
        let (job, done) = (Arc::new(Mutex::new(job)), Arc::new(AtomicU64::new(0)));
        let counted = {
            let (job, mut bytes) = (job.clone(), bytes);
            move || {
                let (job, done) = (job.clone(), done.clone());
                bytes.open().inspect(move |b| {
                    if let Ok(b) = b {
                        let now = done.fetch_add(b.len() as u64, Ordering::Relaxed) + b.len() as u64;
                        job.lock().expect("the job").progress(now / 2, None);
                    }
                })
            }
        };
        let stored = self.store_file(len, counted).await;
        let mut job = Arc::into_inner(job).context("the job, once read")?.into_inner().expect("the job");
        let brought = match stored {
            Ok(brought) => brought,
            Err(e) => {
                job.failed(&e);
                return Err(e);
            }
        };
        job.subject(BlobId(brought.root.hash).to_hex());
        job.stage("making its entry");
        let made = self.act(move |lab, me| engine::put_file(lab, me, &op, brought)).await;
        if let Some(entry) = made["ok"]["entry"].as_str() {
            job.about(vault.into_iter().collect(), [(entry.to_string(), len)].into());
        }
        job.done();
        Ok(made)
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
