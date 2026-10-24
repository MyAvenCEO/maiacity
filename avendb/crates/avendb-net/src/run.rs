//! One API (`docs/ARCHITECTURE.md` §8): every read and every change of a device's database, from its page, the Mac app
//! or an agent, is one JSON op of avendb's engine (`avendb::engine`), run on the node (`Node::run`) and answered as
//! JSON: `{"ok": ...}`, a refusal, or for a change its vault's owners approve with no ceremony at hand,
//! `{"approve": ...}`. What the engine can't do on a Lab alone, the node does around it: it shows where each entry and
//! file is synced to (`world`), reads and brings a file's bytes (`read_file`, and `put_file` or a `create` that brings
//! a file: `engine::brings`), tells what it does in the
//! background (`jobs`), has the passkey sign what its vault approves in a ceremony, and asks its peers again once the
//! vaults it follows change (`follow`). It asks its peers for some vaults before anything else (`bring`), as a page
//! that reads its code off its own device does first, and tells how far it is synced with its peers (`synced`).

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result, bail};
use avendb::engine::{self, Prepared, Refused};
use avendb::id::{BlobId, EntryId, VaultId};
use avendb::lab::Lab;
use avendb::policy::Refusal;
use avendb::sign::Ceremony;
use avendb::sync::LogId;
use bytes::Bytes;
use iroh::EndpointId;
use n0_future::time::{self, Duration, Instant};
use n0_future::{StreamExt as _, stream, task};
use serde_json::{Value, json};

use crate::{Authenticator, Node, Shared, Source, Step};

/// No bytes beside an op: what `Node::run` takes for every op but one that brings a file (`engine::brings`).
pub type NoBytes = fn() -> stream::Empty<io::Result<Bytes>>;

/// The total deadline for a foreground bring, including admission and bounded peer hedges.
const BRING: Duration = Duration::from_secs(60);

/// How long a removal asks its device's peers for what they hold before it checks it holds it all (`catch_up`), at
/// most: a peer that can't be reached by then is given up on.
const CATCHING_UP: Duration = Duration::from_secs(5);

/// How long a removal waits, once it caught up with a peer, for what that peer holds to be told (`removal_waits`), at
/// most.
const HEARD: Duration = Duration::from_secs(3);

/// The most vaults, or entries, one `bring` names.
const MOST_BROUGHT: usize = 64;

/// What one `bring` names: vaults, whose entries it brings, or the logs of entries.
#[derive(Clone)]
enum Brought {
    Vaults(BTreeSet<VaultId>),
    Logs(BTreeSet<LogId>),
}

impl Brought {
    fn len(&self) -> usize {
        match self {
            Brought::Vaults(v) => v.len(),
            Brought::Logs(l) => l.len(),
        }
    }

    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

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
    /// (`NoCap`); `put_file`, and a `create` with a `file` (`engine::brings`), checks the write it would make before
    /// it reads a byte of `bytes`, which it seals into the store as they come (`store_file`), a `bring` job, then
    /// makes it: put_file's new entry, or the write that brings the file into the `entry` it names, or the creation
    /// that brings it, one write; `jobs` tells the node's jobs (`Node::jobs`); `follow`
    /// asks every peer again once the vaults the device follows changed, each request naming them; `bring` asks its
    /// peers for the vaults it names (`bring`), and `synced` tells how far it is synced with them (`synced`). Fails only where no
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
        let _activity = self.shared.admit()?;
        let name = engine::name(&op).map(str::to_string);
        let answer = match name.as_deref() {
            Some("world") => {
                self.world_encoded(engine::WorldSnapshot::into_json).await?
            }
            Some("entry_views") => self.entry_views_encoded(op).await?,
            Some("read_file") => return self.read_bytes(&op).await,
            _ if engine::brings(&op) => self.put(op, bytes).await?,
            Some("jobs") => json!({ "ok": self.jobs().to_json_for(crate::acting()) }),
            Some("follow") => self.follow(op).await?,
            Some("bring") => self.bring_vaults(&op).await?,
            Some("demand") => self.view_demand(&op),
            Some("synced") => json!({ "ok": self.synced().await }),
            Some("network") => json!({ "ok": self.network().await }),
            _ if engine::asks(&op) => self.try_dry(move |lab, me| engine::run(lab, me, &op)).await?,
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

    /// Replace one local view's entry priorities. This is scheduling metadata, never a signed edit or capability.
    fn view_demand(&self, op: &Value) -> Value {
        let bad = |why: &str| Refused::BadOp(why.to_string()).to_json();
        let Some(scope) = op.get("scope").and_then(Value::as_str).filter(|s| s.len() == 32 && s.bytes().all(|c| c.is_ascii_hexdigit())) else {
            return bad("demand scope is a random 32-character hex identifier");
        };
        let Some(revision) = op.get("revision").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 9_007_199_254_740_991) else {
            return bad("demand revision is a positive safe integer");
        };
        let Some(raw) = op.get("entries").and_then(Value::as_array).filter(|a| a.len() <= crate::demand::MOST_ENTRIES) else {
            return bad("demand entries is an array of at most 512 entry IDs");
        };
        let Some(entries) = raw.iter().map(|v| v.as_str().and_then(EntryId::from_hex).map(LogId::Entry)).collect::<Option<Vec<_>>>() else {
            return bad("demand entries are 64-character hex entry IDs");
        };
        let queries = match op.get("queries") {
            None => vec![],
            Some(value) => match value.as_array().filter(|rows| rows.len() <= 8)
                .and_then(|rows| rows.iter().map(crate::discovery::Query::parse).collect::<Option<Vec<_>>>()) {
                Some(queries) => queries,
                None => return bad("invalid discovery selectors"),
            },
        };
        if queries.len() > 8 || queries.iter().any(|q| !q.valid()) { return bad("discovery names at most eight bounded positive-type selectors"); }
        let scope = scope.to_ascii_lowercase();
        let result = {
            let mut demands = self.shared.demands.lock().expect("demands");
            let result = demands.replace(scope.clone(), revision, entries, Instant::now());
            if matches!(result, Ok(true)) { demands.set_queries(&scope, queries); }
            result
        };
        match result {
            Ok(accepted) => {
                if accepted { self.shared.size.send_modify(|_| {}); self.shared.schedule_discovery(scope); }
                json!({"ok": {"accepted": accepted, "lease_ms": crate::demand::LEASE.as_millis() as u64, "discovery_supported": true, "discovery_complete": false}})
            },
            Err(why) => bad(why),
        }
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
        let bytes = if op.get("local").and_then(Value::as_bool) == Some(true) {
            self.read_local_file(root, range).await?
        } else {
            self.read_file(root, range).await?
        };
        let (hash, len) = (BlobId(root.hash).to_hex(), bytes.len() as u64);
        Ok((json!({ "ok": { "root": hash, "from": from, "to": from + len, "len": len } }), Some(bytes)))
    }

    /// `put_file`, or a `create` that brings a file: the write it would make checked, then the bytes stored, then the
    /// write made (`engine::put_file`).
    async fn put<B: Source>(&self, op: Value, bytes: Option<B>) -> Result<Value> {
        let len = match engine::len_of(&op) {
            Ok(len) => len,
            Err(why) => return Ok(why.to_json()),
        };
        let checked = {
            let op = op.clone();
            self.try_dry(move |lab, me| engine::verdict(lab, me, &op)).await?
        };
        if checked != Value::Bool(true) {
            return Ok(checked);
        }
        let bytes = bytes.context("the op brings the file's bytes beside it")?;
        // a job of its own, its bytes told as they come, named as the op names its file, a create's in its `file`
        let named = |o: &Value| o.get("name").and_then(Value::as_str).map(str::to_string);
        let name = op.get("file").map_or_else(|| named(&op), named).unwrap_or_default();
        let mut job = self.jobs().begin("bring", String::new(), name, len, "bytes");
        let vault = match op.get("vault").and_then(Value::as_str) {
            Some(vault) => Some(vault.to_string()),
            // brought into an entry it names: that entry's vault's
            None => {
                let entry = op.get("entry").and_then(Value::as_str).and_then(EntryId::from_hex);
                self.read(move |lab, me| entry.and_then(|e| lab.vault_of_entry(me, e))).await.map(|v| v.to_hex())
            }
        };
        let vault = vault.map(|v| (v, len));
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
        let made = self.try_act(move |lab, me| engine::put_file(lab, me, &op, brought)).await?;
        if let Some(entry) = made["ok"]["entry"].as_str() {
            job.about(vault.into_iter().collect(), [(entry.to_string(), len)].into());
        }
        job.done();
        Ok(made)
    }

    /// `bring`, `{"op": "bring", "vaults": [...]}`: each peer its device knows (`Lab::peers`) asked at once for the
    /// entries of the vaults it names (`Node::bring`), until one of them handed over all it holds of them, or each
    /// failed or took longer than `BRING`. `{"ok": {"new", "peers", "reached"}}`: how many edits were new, how many
    /// peers it asked, and whether one of them answered whole. So a page that reads a vault's code off its own device
    /// reads what its peers hold of it, the server's, before the rest of what it syncs, and not what it held before; a
    /// device that reaches none, offline, reads what it holds.
    ///
    /// `{"op": "bring", "entries": [...]}` brings the logs that are no entry's (`Node::bring` of no vault), then the
    /// logs of the entries it names alone, the same way (`Node::bring_logs`), as a page that knows which entries it reads (a world's recipes, a timeline's clips) asks
    /// for those and not their whole vault; and marks them wanted (`Node::want`), so that the node's own asking of its
    /// peers takes them before other entries' if this bring reaches nobody.
    async fn bring_vaults(&self, op: &Value) -> Result<Value> {
        let named = |key: &str| op.get(key).and_then(Value::as_array).map(|xs| xs.iter().map(|x| x.as_str()).collect::<Vec<_>>());
        let scope = match (named("vaults"), named("entries")) {
            (Some(xs), None) => xs.into_iter().map(|x| x.and_then(VaultId::from_hex)).collect::<Option<BTreeSet<_>>>().map(Brought::Vaults),
            (None, Some(xs)) => xs
                .into_iter()
                .map(|x| x.and_then(EntryId::from_hex).map(LogId::Entry))
                .collect::<Option<BTreeSet<_>>>()
                .map(Brought::Logs),
            _ => None,
        };
        let scope = match scope {
            Some(s) if !s.is_empty() && s.len() <= MOST_BROUGHT => s,
            _ => {
                let why = format!(
                    "bring names 1 to {MOST_BROUGHT} vaults, or 1 to {MOST_BROUGHT} entries, each its id, 64 hex digits"
                );
                return Ok(Refused::BadOp(why).to_json());
            }
        };
        if let Brought::Logs(logs) = &scope {
            // Scoped views register renewable demand separately; do not leave an additional one-shot priority
            // behind after that view closes. Older clients omit this and retain their original behavior.
            if op.get("prioritize").and_then(Value::as_bool) != Some(false) {
                self.try_want(logs.iter().copied())?;
            }
        }
        let peers = self.read(|lab, me| lab.peers(me)).await;
        let mut endpoints: Vec<EndpointId> = peers.into_iter().filter_map(|(_, key)| EndpointId::from_bytes(&key).ok()).collect();
        let known = endpoints.len();
        endpoints.sort_unstable();
        endpoints.dedup();
        endpoints.sort_by_key(|&peer| (self.shared.live(peer).is_none(), self.shared.pulls.rank(peer)));
        let delay = endpoints.first().map(|&peer| self.shared.pulls.hedge_after(peer)).unwrap_or_default();
        let ask = |peer: EndpointId| {
            let scope = scope.clone();
            async move {
                let started = Instant::now();
                let answer = async { match scope {
                    Brought::Vaults(vaults) => self.bring(peer, vaults).await,
                    // the logs that are no entry's first, which say who may do what (a vault named by none), then
                    // the entries' own
                    Brought::Logs(logs) => Ok(self.bring(peer, BTreeSet::new()).await? + self.bring_logs(peer, logs).await?),
                } }.await;
                self.shared.pulls.observed(peer, started.elapsed(), answer.is_ok());
                answer.ok()
            }
        };
        // The same total deadline as the former all-peer race. Keep these futures in this task so an acting
        // identity remains scoped across each peer's authorization pull and subsequent entry pull.
        let brought = time::timeout(BRING, crate::pulls::hedged(endpoints, crate::pulls::FANOUT, delay, ask)).await.ok().flatten();
        Ok(json!({ "ok": { "new": brought.unwrap_or(0), "peers": known, "reached": brought.is_some() } }))
    }

    /// `follow`: run, and every peer asked again if the vaults the device follows changed.
    async fn follow(&self, op: Value) -> Result<Value> {
        let before = self.read(|lab, me| lab.follows(me).to_vec()).await;
        let (answer, after) = self.try_act(move |lab, me| (engine::run(lab, me, &op), lab.follows(me).to_vec())).await?;
        if after != before {
            self.shared.ask_all();
        }
        Ok(answer)
    }

    /// Asks each device that holds its vaults (`avendb::lab::Lab::peers`), and each it is connected to now, for what it
    /// holds, for a few seconds at most (`CATCHING_UP`). All required candidates must enter bounded admission and
    /// at least one must hand over its complete reply in that time. Local overload therefore postpones removal
    /// rather than treating a peer that was never asked as an unreachable peer.
    pub async fn catch_up(&self) -> bool {
        self.catching_up().await.ready()
    }

    async fn catching_up(&self) -> crate::pulls::Readiness {
        let Ok(_activity) = self.shared.admit() else { return crate::pulls::Readiness { admitted: false, reached: false }; };
        let known = self.read(|lab, me| lab.peers(me)).await;
        let mut endpoints: BTreeSet<EndpointId> =
            known.into_iter().filter_map(|(_, key)| EndpointId::from_bytes(&key).ok()).collect();
        endpoints.extend(self.shared.peers.lock().expect("peers").keys().copied());
        let mut endpoints: Vec<_> = endpoints.into_iter().collect();
        endpoints.sort_by_key(|&peer| (self.shared.live(peer).is_none(), self.shared.pulls.rank(peer)));
        let caught = crate::pulls::CatchUp::new(endpoints.len());
        let asks = crate::pulls::each_bounded(endpoints, crate::pulls::CATCH_UP_FANOUT, |peer| {
            let caught = &caught;
            async move {
                if self.shared.pull(peer, crate::Scope::All, false, Some(caught)).await.is_ok() {
                    caught.reached();
                }
            }
        });
        let _ = time::timeout(CATCHING_UP, asks).await;
        caught.finish()
    }

    /// Why a removal waits (`engine::removes`), or `None` where it needn't: it cuts every edit resting on what it
    /// removes that its device doesn't hold, for everyone (T16), so the device first catches up with its peers
    /// (`catch_up`) and then holds what each it is connected to told it holds (`live_peers`), reaching at least one: a
    /// peer it caught up with whole that told nothing yet, as its announcement comes on its own, it waits for a moment
    /// (`HEARD`), and else takes the catch-up as its word. A device that knows no peer, the only one that holds its
    /// vaults, waits for nothing.
    pub async fn removal_waits(&self) -> Option<String> {
        let Ok(_activity) = self.shared.admit() else { return Some("This device is closed; reopen it before making a removal".to_string()); };
        let known = self.read(|lab, me| !lab.peers(me).is_empty()).await;
        let caught = self.catching_up().await;
        if !caught.admitted {
            return Some("Sync first: this device's sync queue is busy and could not ask every required peer before the removal check. Let it sync, then try again".to_string());
        }
        let reached = caught.reached;
        let until = Instant::now() + HEARD;
        let live = loop {
            let live = self.live_peers().await;
            if !reached || live.values().any(Option::is_some) || Instant::now() >= until {
                break live;
            }
            time::sleep(Duration::from_millis(100)).await;
        };
        let told: Vec<usize> = live.values().filter_map(|&lacks| lacks).collect();
        let lacking: usize = told.iter().sum();
        if lacking > 0 {
            let logs = if lacking == 1 { "1 log".to_string() } else { format!("{lacking} logs") };
            return Some(format!(
                "Sync first: this device hasn't seen the edits in {logs} that its peers hold, and a removal drops \
                 every edit resting on what it removes that this device doesn't hold, for everyone. Let it sync, then \
                 try again"
            ));
        }
        if told.is_empty() && !reached && (known || !live.is_empty()) {
            return Some(
                "Sync first: this device reaches none of the devices that hold its vaults right now, so it can't tell \
                 what it hasn't seen, and a removal drops every edit resting on what it removes that this device \
                 doesn't hold, for everyone. Connect it, let it sync, then try again"
                    .to_string(),
            );
        }
        None
    }

    async fn entry_views_encoded(&self, op: Value) -> Result<Value> {
        let operation = self.shared.admit()?;
        let encoding = self.shared.entry_encoding.clone().lock_owned().await;
        let (snapshot, operation, encoding) = self.read(move |lab, me| {
            (engine::entry_views_snapshot(lab, me, &op), operation, encoding)
        }).await;
        let snapshot = match snapshot {
            Err(why) => return Ok(why.to_json()),
            Ok(None) => return Ok(json!({ "ok": null })),
            Ok(Some(snapshot)) => snapshot,
        };
        let logs = snapshot.entries.iter().map(|entry| LogId::Entry(entry.entry)).collect();
        let files = snapshot.entries.iter().flat_map(|entry| entry.files.iter().map(|(file, _)| *file)).collect();
        let synced = self.shared.synced_to_for(Some((logs, files))).await;
        let work = move || {
            let (_operation, _encoding) = (operation, encoding);
            json!({ "ok": snapshot.into_json(&synced) })
        };
        #[cfg(not(target_arch = "wasm32"))]
        return tokio::task::spawn_blocking(work).await.context("entry collection JSON conversion");
        #[cfg(target_arch = "wasm32")]
        Ok(work())
    }

    async fn world_encoded(&self, encode: impl FnOnce(engine::WorldSnapshot) -> Value + Send + 'static) -> Result<Value> {
        let operation = self.shared.admit()?;
        let encoding = self.shared.world_encoding.clone().lock_owned().await;
        let synced = self.synced_to().await;
        // Both capture and rendering retain admission inside the actual work, even
        // if their async requester is cancelled. The snapshot owns its acting identity.
        let (snapshot, operation, encoding) = self.read(move |lab, me| {
            (engine::world_snapshot(lab, me, &synced), operation, encoding)
        }).await;
        let work = move || {
            let (_operation, _encoding) = (operation, encoding);
            encode(snapshot)
        };
        #[cfg(not(target_arch = "wasm32"))]
        return tokio::task::spawn_blocking(work).await.context("world JSON conversion");
        // No Lab lock is held, but synchronous WASM conversion still occupies its worker.
        #[cfg(target_arch = "wasm32")]
        Ok(work())
    }

    /// A change: made, or drafted for the passkey to approve and, with a ceremony at hand, signed in it and made. A
    /// removal (`engine::removes`), whichever way it comes (the page, an agent, the command line), is refused while
    /// its device is behind its peers (`removal_waits`).
    async fn change<A: Authenticator>(&self, op: Value, authenticator: Option<&A>) -> Result<Value> {
        if engine::removes(&op)
            && let Some(why) = self.removal_waits().await
        {
            return Ok(Refused::Behind(why).to_json());
        }
        let prepare = move |lab: &mut Lab, me| {
            let prepared = engine::prepare(lab, me, &op);
            let keys = match &prepared {
                Ok(Prepared::Approve(a)) => lab.keys_of(a.passkey),
                _ => None,
            };
            (prepared, keys)
        };
        let (prepared, keys) = self.try_act(prepare).await?;
        let (approval, authenticator) = match (prepared, authenticator) {
            (Ok(Prepared::Approve(a)), Some(authenticator)) => (a, authenticator),
            (prepared, _) => return Ok(engine::prepared(prepared)),
        };
        let ceremony = crate::ceremony_of(authenticator, keys, approval.challenge(), Step::Approve).await?;
        let approve = move |lab: &mut Lab, me| engine::approve(lab, me, approval, &ceremony);
        Ok(match self.try_act(approve).await? {
            Ok(v) => json!({ "ok": v }),
            Err(why) => why.to_json(),
        })
    }
}

impl Shared {
    /// Asks every peer it is connected to again, as once the vaults its device follows changed: each request names
    /// them (`sync::Ask::follow`).
    fn ask_all(self: &Arc<Self>) {
        if self.opts.lazy {
            return;
        }
        let peers: Vec<EndpointId> = self.peers.lock().expect("peers").keys().copied().collect();
        for endpoint in peers {
            let Ok(activity) = self.admit() else { return };
            let shared = self.clone();
            task::spawn(async move {
                let _activity = activity;
                if let Err(e) = shared.ask(endpoint).await {
                    tracing::debug!("avendb: asking {endpoint} again failed: {e:#}");
                }
            });
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod world_snapshot_tests {
    use super::*;
    use std::sync::Arc;
    use avendb::cast::{document, human_on};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn held_world_encoding_does_not_block_authorized_local_work() {
        let mut lab = Lab::new();
        let passkey = lab.passkey("Snapshot owner");
        let me = lab.device_of(passkey, "local peer");
        assert_eq!(engine::world(&lab, me, &Default::default()), json!({"ok": null}));
        let vault = human_on(&mut lab, passkey, &[me]);
        let node = Arc::new(Node::spawn(lab.split(me, &[passkey], [95; 32]), me,
            crate::Options { lazy: true, ..crate::Options::local() }).await.unwrap());
        let tasks: Vec<_> = node.tasks.lock().unwrap().drain(..).collect();
        for task in tasks { task.abort(); let _ = task.await; }
        let expected = node.world_encoded(engine::WorldSnapshot::into_json).await.unwrap();
        let (entered, entering) = tokio::sync::oneshot::channel();
        let (release, waiting) = std::sync::mpsc::channel();
        let worker = node.clone();
        let encoding = tokio::spawn(async move {
            worker.world_encoded(move |snapshot| {
                entered.send(()).unwrap();
                waiting.recv().unwrap();
                snapshot.into_json()
            }).await.unwrap()
        });
        entering.await.unwrap();
        assert!(node.shared.world_encoding.try_lock().is_err(), "held encoder owns the world-only permit");
        let mut next_world = Box::pin(node.world_encoded(engine::WorldSnapshot::into_json));
        assert!(n0_future::future::poll_once(&mut next_world).await.is_none(), "second world waits before capture");
        let peer = node.clone();
        let write = tokio::spawn(async move {
            let entry = peer.act(move |lab, me| lab.create(me, vault, vault, "note", &[],
                document("Concurrent local write", "visible without waiting for world JSON", me)).unwrap()).await;
            let local = peer.read(move |lab, me| lab.item(me, entry).is_some()).await;
            let selected = peer.entry_views_encoded(json!({"op":"entry_views", "vault":vault.to_hex(), "kind":"note"})).await.unwrap();
            local && selected["ok"]["rows"].as_array().unwrap().iter().any(|row| row["entry"] == entry.to_hex())
        });
        let mut write = write;
        let timely = time::timeout(Duration::from_secs(1), &mut write).await;
        // Always release the held encoder, including on regression failure.
        release.send(()).unwrap();
        let encoded = encoding.await.unwrap();
        if timely.is_err() { let _ = write.await; }
        assert_eq!(encoded, expected, "later mutation cannot change the captured authorized snapshot");
        let fresh = next_world.await.unwrap();
        assert_ne!(fresh, expected, "queued world captures after the concurrent mutation");
        // Cancelling the requester cannot release the active serializer's admission.
        let (entered, entering) = tokio::sync::oneshot::channel();
        let (release, waiting) = std::sync::mpsc::channel();
        let worker = node.clone();
        let abandoned = tokio::spawn(async move {
            worker.world_encoded(move |snapshot| {
                entered.send(()).unwrap();
                waiting.recv().unwrap();
                snapshot.into_json()
            }).await
        });
        entering.await.unwrap();
        abandoned.abort();
        let _ = abandoned.await;
        assert!(node.shared.world_encoding.try_lock().is_err(), "cancelled request cannot release active encoder permit");
        let premature = time::timeout(Duration::from_millis(50), node.shutdown()).await;
        release.send(()).unwrap();
        node.shutdown().await.unwrap();
        assert!(premature.is_err(), "shutdown must wait for a cancelled request's active encoder");
        assert!(matches!(timely, Ok(Ok(true))), "authorized local write/read must not wait for world encoding");
    }
}
