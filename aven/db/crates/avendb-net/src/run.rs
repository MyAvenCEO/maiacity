//! One API (`doc:docs/avendb` §8): every read and every change of a device's database, from its page, the Mac app
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
use avendb::slice::Selector;
use avendb::sync::LogId;
use bytes::Bytes;
use iroh::EndpointId;
use n0_future::{StreamExt as _, stream, task};
use serde_json::{Value, json};

use crate::{Authenticator, Node, Shared, Source, Step};

/// No bytes beside an op: what `Node::run` takes for every op but one that brings a file (`engine::brings`).
pub type NoBytes = fn() -> stream::Empty<io::Result<Bytes>>;

/// The most entries one `bring` names.
const MOST_BROUGHT: usize = 64;

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
                // stamped as every read is (`fresh_read`), so a page paints what the device holds now, marked behind
                // while a peer holds more, never waiting for the whole catch-up
                let mut world = self.world_encoded(engine::WorldSnapshot::into_json).await?;
                if world.get("ok").is_some() {
                    let (heard, behind, _) = self.shared.heard(None, Selector::All).await;
                    engine::coverage::add_freshness(&mut world, heard, behind.len());
                }
                world
            }
            Some("entry_views") => self.entry_views_encoded(op).await?,
            Some("checkpoint_view" | "checkpoint_entry_base") => self.publish_checkpoint(&op, authenticator).await?,
            Some("read_file") => return self.read_bytes(&op).await,
            _ if engine::brings(&op) => self.put(op, bytes).await?,
            Some("jobs") => json!({ "ok": self.jobs().to_json_for(crate::acting()) }),
            Some("follow") => self.follow(op).await?,
            Some("bring") => self.bring_entries(&op).await?,
            Some("interest") => self.view_interest(&op),
            Some("find") => self.find(&op).await?,
            Some("synced") => json!({ "ok": self.synced().await }),
            Some("network") => json!({ "ok": self.network().await }),
            Some("measure_peer_policy") => json!({ "ok": self.shared.receipts.arm() }),
            Some("measure_peer_visibility") => json!({ "ok": self.shared.ui_receipts.arm() }),
            Some("observe_query_emission") => {
                // A local UI assertion, never a remotely callable authority. Recheck
                // that each complete main frontier is still the authorized row's.
                let rows = op.get("rows").and_then(Value::as_array).filter(|r| r.len() <= 64)
                    .cloned().unwrap_or_default();
                let ids = self.read(move |lab, me| {
                    let mut ids = Vec::new();
                    for row in rows {
                        if row["kind"] != "main-heads" || row["frontierComplete"] != true || row["readOnly"] != false { continue; }
                        let Some(entry) = row["entry"].as_str().and_then(avendb::id::EntryId::from_hex) else { continue };
                        if lab.item(me, entry).is_none() { continue; }
                        let Some(history) = lab.history(me, entry) else { continue };
                        let current = history.heads(avendb::history::MAIN);
                        let Some(heads) = row["heads"].as_array().filter(|h| h.len() <= 32) else { continue };
                        let decoded: Option<Vec<_>> = heads.iter().map(|h| h.as_str().and_then(avendb::id::EditId::from_hex)).collect();
                        if decoded.as_ref() == Some(&current) { ids.extend(current); }
                    }
                    ids.truncate(64); ids
                }).await;
                json!({"ok":{"registered":self.shared.ui_receipts.emitted(ids)}})
            },
            Some("call") => {
                // a call whose method reads is answered as the read it runs, on the read path (off the indexes)
                let called = op.clone();
                match self.read(move |lab, me| engine::call_reads(lab, me, &called)).await {
                    Some(Ok(read)) => self.fresh_read(read).await,
                    Some(Err(refused)) => refused,
                    None => self.change(op, authenticator).await?,
                }
            }
            _ if engine::asks(&op) => self.try_dry(move |lab, me| engine::run(lab, me, &op)).await?,
            _ if engine::reads(&op) => self.fresh_read(op).await,
            _ => self.change(op, authenticator).await?,
        };
        Ok((answer, None))
    }

    /// Runs op `op` with no bytes beside it and no ceremony at hand (`run`): a change its vault's owners approve
    /// answers `approve`.
    pub async fn op(&self, op: Value) -> Result<Value> {
        Ok(self.run(op, None::<NoBytes>, None::<&NoCeremony>).await?.0)
    }

    /// A read on what the device holds, stamped with its freshness (`Freshness.lean`), whatever it reads: `current`,
    /// `offline` as of the device's last current read, or `behind` with the logs its live peers announced that it lacks
    /// and that may change what it shows (`Shared::heard`, `engine::footprint`): the log of an entry it may pick, or
    /// of one the device can't place yet, its vault's own log, and any share's or audience's. A query's coverage counts
    /// those logs too (`Coverage.lean` `answer`): complete only once none is behind. What comes first is the views'
    /// Interests' to say, never a read's. No clock: the announcements and the holdings decide. `touched`, which says
    /// what changed and shows nothing, is not stamped. A read looks the walk up
    /// (`Shared::heard`): it runs once per change of what the peers or the device hold, not once per read.
    async fn fresh_read(&self, op: Value) -> Value {
        let vault = op.get("vault").and_then(Value::as_str).and_then(VaultId::from_hex);
        let picks = engine::footprint(&op);
        let stamped = engine::name(&op) != Some("touched");
        // a window comes off the shared index where that can say (`query_window`, a page of posts `posts_page`),
        // else from the engine
        let indexed = match engine::name(&op) {
            Some("posts") => self.posts_indexed(&op).await,
            _ => self.windowed(&op).await,
        };
        let mut answer = match indexed {
            Some(answer) => answer,
            None => self.read(move |lab, me| engine::read(lab, me, &op)).await,
        };
        if !stamped || answer.get("ok").is_none() { return answer; }
        let (heard, matching, _) = self.shared.heard(vault, picks).await;
        if engine::coverage::reads_open(&answer) { engine::coverage::add_logs(&mut answer, matching.len()); }
        engine::coverage::add_freshness(&mut answer, heard, matching.len());
        answer
    }

    /// `interest`: replace one mounted view's Interests (`interest.rs`, Lean `Interest.lean`), or with
    /// `release: "all"` clear every view's, as The OS does when its page loads again. Scheduling metadata, never a
    /// signed edit or a capability: it orders what the node brings, what it newly wants now asked at once
    /// (`Shared::change_interests`), and an unmount (no wants) clears it; no lease, no timer.
    fn view_interest(&self, op: &Value) -> Value {
        let bad = |why: &str| Refused::BadOp(why.to_string()).to_json();
        if op.get("release").and_then(Value::as_str) == Some("all") {
            let released = self.shared.change_interests(|interests| interests.release_all());
            self.shared.size.send_modify(|_| {});
            return json!({"ok": {"released": released}});
        }
        let Some(scope) = op.get("scope").and_then(Value::as_str).filter(|s| s.len() == 32 && s.bytes().all(|c| c.is_ascii_hexdigit())) else {
            return bad("an interest's scope is a random 32-character hex identifier");
        };
        let Some(revision) = op.get("revision").and_then(Value::as_u64).filter(|n| *n > 0 && *n <= 9_007_199_254_740_991) else {
            return bad("an interest's revision is a positive safe integer");
        };
        let ids = |raw: Option<&Value>| -> Option<Vec<LogId>> {
            match raw {
                None => Some(vec![]),
                Some(v) => v.as_array().filter(|a| a.len() <= crate::interest::MOST_ENTRIES)?
                    .iter().map(|v| v.as_str().and_then(EntryId::from_hex).map(LogId::Entry)).collect(),
            }
        };
        let queries = |raw: Option<&Value>| -> Option<Vec<crate::discovery::Query>> {
            match raw {
                None => Some(vec![]),
                Some(v) => v.as_array().filter(|rows| rows.len() <= crate::interest::MOST_QUERIES)?
                    .iter().map(crate::discovery::Query::parse).collect::<Option<Vec<_>>>()
                    .filter(|qs| qs.iter().all(|q| q.valid())),
            }
        };
        let Some(raw) = op.get("wants").and_then(Value::as_array).filter(|w| w.len() <= crate::interest::MOST_WANTS) else {
            return bad("an interest's wants is an array of at most 32 wants");
        };
        let mut wants = vec![];
        for w in raw {
            let tier = w.get("tier").and_then(Value::as_str).and_then(crate::interest::Tier::parse);
            let Some(tier) = tier else { return bad("a want's tier is now, next, later or idle") };
            if w.as_object().is_some_and(|m| m.keys().any(|k| !["tier", "entries", "queries"].contains(&k.as_str()))) {
                return bad("a want holds a tier, entries and queries");
            }
            let Some(entries) = ids(w.get("entries")) else { return bad("a want's entries are 64-character hex entry IDs") };
            let Some(queries) = queries(w.get("queries")) else { return bad("a want's queries are bounded positive-type selectors") };
            wants.push(crate::interest::Want { tier, entries, queries });
        }
        let scope = scope.to_ascii_lowercase();
        let result = self.shared.change_interests(|interests| interests.replace(scope.clone(), revision, wants));
        match result {
            Ok(accepted) => {
                if accepted { self.shared.size.send_modify(|_| {}); self.shared.bootstrap_due.notify_one(); self.shared.schedule_discovery(scope); }
                json!({"ok": {"accepted": accepted, "discovery_supported": true, "discovery_complete": false}})
            },
            Err(why) => bad(why),
        }
    }

    /// `find {vault, types?, tags?, follow?, bring?}`: the entries of vault `vault` of one of the types `types` or with
    /// one of the tags `tags`, by the blind index (`blind`, P4 of sync v2): those the device reads, and those each live
    /// peer names, the always-on peer too, which reads none of them. With `bring` (the default), their logs are asked
    /// of every live peer at once, as a view's now-tier want is (`ask_now`, with the rules they rest on), and come as
    /// they come: find answers what it found and never waits on a peer to bring it. Answers `{entries, asked,
    /// answered}`: the entries in hex, and how many live peers answered of how many it asked.
    async fn find(&self, op: &Value) -> Result<Value> {
        let bad = |why: &str| Ok(Refused::BadOp(why.to_string()).to_json());
        let Some(vault) = op.get("vault").and_then(Value::as_str).and_then(VaultId::from_hex) else {
            return bad("find names its vault, 64 hex digits");
        };
        let names = |key: &str| -> Option<Vec<String>> {
            match op.get(key) {
                None => Some(vec![]),
                Some(v) => v.as_array()?.iter().map(|x| x.as_str().filter(|s| !s.is_empty() && s.len() <= 128).map(str::to_string)).collect(),
            }
        };
        let (Some(types), Some(tags)) = (names("types"), names("tags")) else {
            return bad("find's types and tags are lists of names");
        };
        let mut labels: Vec<String> = types.iter().map(|t| avendb::index::type_label(t)).collect();
        labels.extend(tags.iter().map(|t| avendb::index::tag_label(t)));
        if labels.is_empty() || labels.len() > 64 {
            return bad("find asks for 1 to 64 types and tags");
        }
        let follow = match op.get("follow") {
            None => vec![],
            Some(v) => match v.as_array().and_then(|xs| xs.iter().map(|x| x.as_str().and_then(VaultId::from_hex)).collect::<Option<Vec<_>>>()) {
                Some(f) if f.len() <= 64 => f,
                _ => return bad("find's follow is a list of at most 64 vault ids"),
            },
        };
        let found = self.shared.find(vault, labels, follow).await;
        if op.get("bring").and_then(Value::as_bool) != Some(false)
            && let Ok(activity) = self.shared.admit()
        {
            let (shared, logs) = (self.shared.clone(), found.entries.iter().map(|(e, _)| LogId::Entry(*e)).collect());
            task::spawn(async move {
                let _activity = activity;
                shared.ask_now(logs).await;
            });
        }
        let entries: Vec<String> = found.entries.iter().map(|(e, _)| e.to_hex()).collect();
        Ok(json!({"ok": {"entries": entries, "asked": found.asked, "answered": found.answered}}))
    }

    /// `read_file`: the answer, and the bytes beside.
    async fn read_bytes(&self, op: &Value) -> Result<(Value, Option<Vec<u8>>)> {
        let (root, range) = match engine::file_of(op) {
            Ok(file) => file,
            Err(why) => return Ok((why.to_json(), None)),
        };
        if !self.read(move |lab, me| lab.file(me, &root).is_some()).await {
            // the entry that brings it may not have arrived yet: the refusal says how fresh the device is
            // (`Freshness.lean`), so a page tells a file still arriving (behind) from one it may not read
            let (heard, behind, _) = self.shared.heard(None, Selector::All).await;
            let mut refused = Refused::Rule(Refusal::NoCap).to_json();
            refused["fresh"] = engine::coverage::Freshness::of(heard, (0, behind.len())).to_json();
            return Ok((refused, None));
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

    /// `bring`, `{"op": "bring", "entries": [...]}`: the entries a page reads now, set as an Interest of their own on
    /// screen now and asked at once of every live peer that holds more of them, with the rules they rest on
    /// (`Shared::ask_now`); the Interest goes once those askings ended. `{"ok": {"new", "peers", "reached"}}`: how
    /// many edits were new, how many live peers it asked, and whether every one of them answered whole. A device that
    /// reaches none, offline, reads what it holds.
    async fn bring_entries(&self, op: &Value) -> Result<Value> {
        let logs = op.get("entries").and_then(Value::as_array)
            .and_then(|xs| xs.iter().map(|x| x.as_str().and_then(EntryId::from_hex).map(LogId::Entry)).collect::<Option<BTreeSet<_>>>())
            .filter(|logs| !logs.is_empty() && logs.len() <= MOST_BROUGHT);
        let Some(logs) = logs else {
            return Ok(Refused::BadOp(format!("bring names 1 to {MOST_BROUGHT} entries, each its id, 64 hex digits")).to_json());
        };
        let _activity = self.shared.admit()?;
        let asked = self.shared.bring_now(logs).await;
        Ok(json!({ "ok": { "new": asked.new, "peers": asked.peers, "reached": asked.whole } }))
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

    /// A change: made, or drafted for the passkey to approve and, with a ceremony at hand, signed in it and made. Any
    /// change, a removal too, is judged against what its device holds, at its own heads, and never waits on a peer:
    /// local first (Samuel 2026-10-29). Its edit's deps carry the heads it saw.
    async fn change<A: Authenticator>(&self, op: Value, authenticator: Option<&A>) -> Result<Value> {
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
    use n0_future::time::{self, Duration};
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
