//! The chat's history (`store/README.md`, "The chat keeps its history"; `aven_gen1::chain`): every line this peer
//! hears or writes is a blob in its store, and each device's newest line is the ref `chat-<device>`, moved forward by
//! compare-and-set, only ever as the [`Keeper`] moves it. The Aven Peer keeps every chain and raises forks; every peer
//! does the same with what it hears. A restart or a reload loads the chains from the store, and catching up takes the
//! lines another peer holds that this one misses.
//!
//! Local first: a line this peer writes is in its store and on its page before any peer has it. A device whose store
//! holds its key knows its head from its store (`Aven.DB.Chains.own_store_never_forks`), so it writes on its chain at
//! once, offline too; one whose key is given apart from its store learns its head from the Aven Peer first, and keeps
//! what it writes until then in its store (`queued`), so a reload loses nothing. What the page hears,
//! as timeline lines: `chat` (a line shown, with its place: device, number, name), `fork` (a fork raised) and `dropped`.
//!
//! Deleting (`Aven.DB.Chains`, "Deleting a line"): a delete is a retraction, a line of this device's chain
//! ([`Chats::retract`]). Every line its own vault retracted loses its text in the store: its blob is deleted and the ref
//! `gone-<id>` names the retraction instead, so a reload still walks the chain past it, and catching up sends the
//! retraction in its place. A file no line names any more leaves the store, its index, its chunks no other file lists
//! and its `file-<index>`, so this peer stops serving it. The page hears the line again as `deleted`, in place.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use aven_db_store::withhold::Withheld;
use aven_db_store::{Hash, RefName};
use aven_gen1::chain::{self, Answer, Body, Held, Keeper, Line, Retraction, Settled};
use aven_gen1::files::Announcement;
use aven_gen1::timeline;
use aven_peer_wire::wire::{Frame, Have, Head, MAX_FRAME, catch_up_pages, heads_pages};
use bytes::Bytes;
use iroh::{PublicKey, SecretKey};
use serde_json::json;

use crate::members::Gate;
use crate::{Notes, now};

/// The store a peer keeps its chains in, shared by the tasks that hear and write lines.
pub use aven_db_store::blobs::Shared;

/// What a peer does with each `file` line it newly chains, told the device whose chain it is on: the Aven Peer keeps
/// the file (`keep::keep`).
pub type OnFile = Arc<dyn Fn(PublicKey, Announcement) + Send + Sync>;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A signature over `body` by the device `key`, both as lines carry them.
pub fn verifies(key: &str, body: &str, sig: &str) -> bool {
    let Ok(key) = crate::keys::public(key) else {
        return false;
    };
    let Some(sig) = unhex64(sig) else {
        return false;
    };
    key.verify(body.as_bytes(), &iroh::Signature::from_bytes(&sig))
        .is_ok()
}

fn unhex64(s: &str) -> Option<[u8; 64]> {
    if s.len() != 128 || !s.is_ascii() {
        return None;
    }
    let mut out = [0u8; 64];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).ok()?;
    }
    Some(out)
}

/// Lines' blobs with the retractions first (`Aven.DB.Chains.Keeper.catchUpAll`), each group in its order: a peer
/// applies every delete before any line or file it deletes reaches it.
fn retractions_first(lines: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    let (first, rest): (Vec<Vec<u8>>, Vec<Vec<u8>>) = lines
        .into_iter()
        .partition(|l| Line::read_kept(l).is_some_and(|(l, _)| matches!(l.body, Body::Retract(_))));
    first.into_iter().chain(rest).collect()
}

/// Lines in frames that stay well under the wire's limit, in order.
pub fn batches(lines: Vec<Vec<u8>>) -> Vec<Frame> {
    let mut out = vec![];
    let (mut batch, mut size) = (vec![], 0);
    for line in lines {
        if size + line.len() > MAX_FRAME / 2 && !batch.is_empty() {
            out.push(Frame::Lines {
                lines: std::mem::take(&mut batch),
            });
            size = 0;
        }
        size += line.len() + 16;
        batch.push(line);
    }
    if !batch.is_empty() {
        out.push(Frame::Lines { lines: batch });
    }
    out
}

/// The ref that says a store is its device's: the device's key (hex), set once the device knows its head. A
/// Peer-Light's store says it by holding the device's secret (`device-key`).
pub const KEY_REF: &str = "chain-key";
/// A Peer-Light's device secret, kept in its store (peer/light, `deviceSecret`).
pub const SECRET_REF: &str = "device-key";
/// What a device whose store isn't its key's yet wrote before it knew its head: a JSON list of bodies.
pub const QUEUED_REF: &str = "queued";

fn fixed_ref(name: &str) -> RefName {
    RefName::new(name).expect("a fixed ref name is valid")
}

/// Whether `store` is the store of the device whose secret is `secret`: it holds that secret (a Peer-Light's), or says
/// it is that key's (`chain-key`). Then it holds every line the key signed, and is the device's truth. Read by the refs'
/// hashes alone, never the blobs: a blob read keeps an OPFS handle open, and a second worker of the same origin must
/// still read its secret (sandbox/engines.mjs, a worker nobody started).
pub async fn owns(store: &Shared, secret: &SecretKey) -> bool {
    let at = async |name: &str| store.get_ref(&fixed_ref(name)).await.ok().flatten();
    let secret_hex = hex(&secret.to_bytes());
    at(SECRET_REF).await == Some(Hash::of(secret_hex.as_bytes()))
        || at(KEY_REF).await == Some(Hash::of(secret.public().to_string().as_bytes()))
}

/// Sets `name` to a blob of `bytes`, whatever it held: under the one writer, so a lost race is only a retry.
async fn put_ref(store: &Shared, name: &str, bytes: Vec<u8>) -> Result<(), String> {
    let name = fixed_ref(name);
    let blob = store.put(bytes.into()).await.map_err(|e| e.to_string())?;
    let mut expected = store.get_ref(&name).await.map_err(|e| e.to_string())?;
    for _ in 0..4 {
        if expected == Some(blob) {
            return Ok(());
        }
        match store.set_ref(&name, expected, blob).await {
            Ok(()) => return Ok(()),
            Err(aven_db_store::Error::Stale { current }) => expected = current,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err(format!("{name:?} kept moving"))
}

fn body_json(body: &Body) -> serde_json::Value {
    match body {
        Body::Text(t) => json!({ "text": t }),
        Body::File(f) => json!({ "file": f }),
        Body::Retract(r) => {
            json!({ "retract": r.target, "device": r.device, "seq": r.seq, "prev": r.prev,
            "at": r.at })
        }
        Body::Redacted => json!({}),
    }
}

fn body_of(v: &serde_json::Value) -> Option<Body> {
    if let Some(target) = v["retract"].as_str() {
        return Some(Body::Retract(Retraction {
            target: target.to_string(),
            device: v["device"].as_str()?.to_string(),
            seq: v["seq"].as_u64()?,
            prev: v["prev"].as_str().map(str::to_string),
            at: v["at"].as_u64()?,
        }));
    }
    match (v["text"].as_str(), v.get("file")) {
        (Some(t), _) => Some(Body::Text(t.to_string())),
        (None, Some(f)) => serde_json::from_value(f.clone()).ok().map(Body::File),
        _ => None,
    }
}

/// The prefix of the ref kept while a file is being dropped, `dropped-<index>`: a restart finishes the drop.
const DROPPED_REF: &str = "dropped-";

/// The ref that names, for a line whose text this peer dropped, the retraction that counts for it: `gone-<id>`.
fn gone_ref(id: &str) -> Result<RefName, String> {
    RefName::new(format!("gone-{id}")).map_err(|e| e.to_string())
}

fn ref_name(device: &str) -> Result<RefName, String> {
    RefName::new(format!("{}{device}", chain::REF)).map_err(|e| e.to_string())
}

/// A peer's chains: its store, and what it holds in memory, the one place they change.
#[derive(Clone)]
pub struct Chats {
    me: String,
    network: String,
    secret: SecretKey,
    gate: Gate,
    notes: Notes,
    store: Shared,
    keeper: Arc<Mutex<Keeper>>,
    /// whether this device knows its own head (from the Aven Peer, or as the Aven Peer): until then what it writes
    /// waits in `queued`, unchained, so it never forks itself (`Aven.DB.Chains.learned_never_forks`)
    learned: Arc<std::sync::atomic::AtomicBool>,
    /// what it wrote before it knew its head: a name the page shows it by, and the body
    queued: Arc<Mutex<Vec<(String, Body)>>>,
    /// the queued line being chained now, which the line shown replaces
    replacing: Arc<Mutex<Option<String>>>,
    /// told each `file` line newly chained
    on_file: Arc<std::sync::OnceLock<OnFile>>,
    /// the blobs of files a retraction took: served by no one here, even before their bytes are gone
    withheld: Withheld,
    /// how many times a head moved here: the Aven Peer tells its links the heads that moved
    moved: Arc<std::sync::atomic::AtomicU64>,
    /// each line kept in a gap: since when, until this peer caught up for it once (then `None`)
    gaps: Arc<Mutex<BTreeMap<String, Option<u64>>>>,
}

impl Chats {
    /// Loads the chains the store holds, walking each back from its head, and tells the page every line in them.
    pub async fn open(
        me: String,
        network: &str,
        secret: SecretKey,
        gate: Gate,
        notes: Notes,
        store: Shared,
    ) -> Result<Chats, String> {
        let mut chains = vec![];
        // lines kept before a line's bytes had to be canonical: still read, and counted (none, as our own code writes)
        let mut not_canonical = 0;
        for name in store.list_refs().await.map_err(|e| e.to_string())? {
            let Some(device) = name.as_str().strip_prefix(chain::REF) else {
                continue;
            };
            let mut at = store.get_ref(&name).await.map_err(|e| e.to_string())?;
            let mut lines = vec![];
            // newest first, back to the first line: each step one line older (README, rule 3)
            while let Some(hash) = at {
                let Some(bytes) = store.get(&hash).await.map_err(|e| e.to_string())? else {
                    // a line whose text was dropped: its place, from the retraction `gone-<id>` names
                    let Some(line) = Chats::gone(&store, &hash.to_hex()).await else {
                        break;
                    };
                    at = line.prev.as_deref().and_then(|p| p.parse().ok());
                    lines.push(Held {
                        id: hash.to_hex(),
                        line,
                    });
                    continue;
                };
                let (line, canonical) = Line::read_kept(&bytes)
                    .ok_or_else(|| format!("{name} reaches a blob that is no line"))?;
                not_canonical += usize::from(!canonical);
                at = line.prev.as_deref().and_then(|p| p.parse().ok());
                lines.push(Held {
                    id: hash.to_hex(),
                    line,
                });
            }
            lines.reverse();
            chains.push((device.to_string(), lines));
        }
        let learned = owns(&store, &secret).await;
        // what waited for its head before a reload, from the store
        let queued: Vec<Body> = match store.get_ref(&fixed_ref(QUEUED_REF)).await {
            Ok(Some(blob)) => store
                .get(&blob)
                .await
                .ok()
                .flatten()
                .and_then(|b| serde_json::from_slice::<Vec<serde_json::Value>>(&b).ok())
                .map(|v| v.iter().filter_map(body_of).collect())
                .unwrap_or_default(),
            _ => vec![],
        };
        let chats = Chats {
            me,
            network: network.to_string(),
            secret,
            gate,
            notes,
            store,
            keeper: Arc::new(Mutex::new(Keeper::load(chains))),
            gaps: Arc::default(),
            moved: Arc::default(),
            on_file: Arc::default(),
            withheld: Arc::default(),
            learned: Arc::new(learned.into()),
            queued: Arc::default(),
            replacing: Arc::default(),
        };
        // every delete it holds applied before anything is shown or served, and the files a stop left half dropped
        // (`dropped-<index>`) dropped
        chats.settle().await;
        for name in chats.store.list_refs().await.map_err(|e| e.to_string())? {
            if let Some(index) = name.as_str().strip_prefix(DROPPED_REF) {
                chats.drop_file(index).await;
            }
        }
        let shown: Vec<Held> = chats
            .keeper
            .lock()
            .unwrap()
            .shown()
            .into_iter()
            .cloned()
            .collect();
        for h in &shown {
            chats.show(h);
        }
        chats.note("chains", json!({ "notCanonical": not_canonical }));
        for body in queued {
            chats.enqueue(body);
        }
        // a store that knew its key, with lines that waited for its head (a stop between `learn` keeping `chain-key` and clearing `queued`): chained now
        if learned && !chats.queued.lock().unwrap().is_empty() {
            chats
                .learned
                .store(false, std::sync::atomic::Ordering::Relaxed);
            chats.learn().await;
        }
        Ok(chats)
    }

    /// A line that waits for this device's head, shown as queued.
    fn enqueue(&self, body: Body) {
        let name = format!("queued-{}-{}", now(), self.queued.lock().unwrap().len());
        let text = match &body {
            Body::Text(t) => t.clone(),
            Body::File(f) => f.name.clone(),
            // a delete waiting for this device's head: the line shows deleted at once (local first)
            Body::Retract(r) => {
                self.note(
                    "chat",
                    json!({ "id": r.target, "key": r.device, "seq": r.seq, "at": r.at,
                    "deleted": true }),
                );
                self.queued.lock().unwrap().push((name, body));
                return;
            }
            Body::Redacted => return,
        };
        let (from, vault) = match crate::keys::public(&self.device()) {
            Ok(k) => self.gate.name(&k),
            Err(_) => (self.device(), None),
        };
        self.note(
            "chat",
            json!({ "from": from, "vault": vault, "key": self.device(), "text": text, "at": now(), "seq": 0,
                "id": name, "queued": true }),
        );
        self.queued.lock().unwrap().push((name, body));
    }

    /// What waits for this device's head, as the store keeps it: none once it is all chained.
    async fn keep_queued(&self) -> Result<(), String> {
        let bodies: Vec<serde_json::Value> = self
            .queued
            .lock()
            .unwrap()
            .iter()
            .map(|(_, b)| body_json(b))
            .collect();
        if bodies.is_empty() {
            let name = fixed_ref(QUEUED_REF);
            return match self.store.get_ref(&name).await.map_err(|e| e.to_string())? {
                Some(at) => self
                    .store
                    .delete_ref(&name, at)
                    .await
                    .map_err(|e| e.to_string()),
                None => Ok(()),
            };
        }
        put_ref(
            &self.store,
            QUEUED_REF,
            serde_json::to_vec(&bodies).map_err(|e| e.to_string())?,
        )
        .await
    }

    /// Tells the page every line again, each with its sender as the door now names it: when the door changes, as a
    /// Peer-Light's does once the Aven Peer tells it the members, the history it showed by keys gets its names.
    pub fn retell(&self) {
        // the vaults the door names may have changed what counts: settled again
        let me = self.clone();
        n0_future::task::spawn(async move { me.settle().await });
        let shown: Vec<Held> = self
            .keeper
            .lock()
            .unwrap()
            .shown()
            .into_iter()
            .cloned()
            .collect();
        for h in &shown {
            self.show(h);
        }
    }

    fn note(&self, event: &str, fields: serde_json::Value) {
        (self.notes)(timeline::line(now(), &self.me, event, fields));
    }

    /// The page's line for a line shown.
    fn show(&self, h: &Held) {
        let (name, vault) = match crate::keys::public(&h.line.device) {
            Ok(k) => self.gate.name(&k),
            Err(_) => (h.line.device.clone(), None),
        };
        let mut fields = json!({ "from": name, "vault": vault, "key": h.line.device, "at": h.line.at,
            "seq": h.line.seq, "id": h.id });
        // a line written before this device knew its head, chained now: the page shows it in place of its queued one
        if h.line.device == self.device()
            && let Some(queued) = self.replacing.lock().unwrap().as_ref()
        {
            fields["replaces"] = json!(queued);
        }
        match &h.line.body {
            // a retraction isn't shown: the line it deletes is, as deleted once settling took its text
            Body::Retract(_) => return,
            Body::Text(text) => fields["text"] = json!(text),
            // a file: the page shows it by its index, its name as its text
            Body::File(file) => {
                fields["text"] = json!(file.name);
                fields["file"] = json!(file);
            }
            Body::Redacted => fields["deleted"] = json!(true),
        }
        self.note("chat", fields);
    }

    /// Every `file` line it holds in a chain, with the device whose chain it is on.
    pub fn files(&self) -> Vec<(PublicKey, Announcement)> {
        let keeper = self.keeper.lock().unwrap();
        keeper
            .heads()
            .iter()
            .flat_map(|(device, _)| keeper.chain(device).iter())
            .filter_map(
                |h| match (&h.line.body, crate::keys::public(&h.line.device)) {
                    (Body::File(f), Ok(from)) => Some((from, f.clone())),
                    _ => None,
                },
            )
            .collect()
    }

    /// What to do with each `file` line chained from now on; set once.
    pub fn on_file(&self, f: OnFile) {
        let _ = self.on_file.set(f);
    }

    /// The store its chains rest in.
    pub fn store(&self) -> Shared {
        self.store.clone()
    }

    /// This device's key, as lines name it.
    pub fn device(&self) -> String {
        self.secret.public().to_string()
    }

    /// Each device's head this peer holds.
    pub fn heads(&self) -> Vec<(String, String)> {
        self.keeper.lock().unwrap().heads()
    }

    /// Whether it holds the line `id` of `device`.
    pub fn holds(&self, device: &str, id: &str) -> bool {
        self.keeper.lock().unwrap().holds(device, id)
    }

    /// The seq of the newest line of `device` it holds in its chain: catching up walks back to it.
    pub fn have(&self, device: &str) -> u64 {
        self.keeper
            .lock()
            .unwrap()
            .chain(device)
            .last()
            .map_or(0, |h| h.line.seq)
    }

    /// The blobs of `device`'s chain newer than `seq`, oldest first, as frames carry them.
    pub async fn lines_after(&self, device: &str, seq: u64) -> Vec<Vec<u8>> {
        // a line held without its text goes as the retraction that counts for it
        let ids: Vec<(String, Option<String>)> = {
            let keeper = self.keeper.lock().unwrap();
            let author = self.author();
            keeper
                .chain(device)
                .iter()
                .filter(|h| h.line.seq > seq)
                .map(|h| match h.line.body {
                    Body::Redacted => (h.id.clone(), keeper.stand_in(&author, h).map(|r| r.id)),
                    _ => (h.id.clone(), Some(h.id.clone())),
                })
                .collect()
        };
        let mut out = vec![];
        for (id, sent) in ids {
            let sent = match sent {
                Some(sent) => Some(sent),
                None => self.gone_to(&id).await,
            };
            if let Some(blob) = match sent {
                Some(sent) => self.blob(&sent).await,
                None => None,
            } {
                out.push(blob.to_vec());
            }
        }
        out
    }

    /// How many times a head moved here: a change to tell the links.
    pub fn moved(&self) -> u64 {
        self.moved.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Each device's head this peer holds, with its number: what `heads` frames tell.
    pub fn heads_told(&self) -> Vec<Head> {
        let keeper = self.keeper.lock().unwrap();
        keeper
            .heads()
            .into_iter()
            .map(|(device, id)| {
                let seq = keeper.chain(&device).last().map_or(0, |h| h.line.seq);
                Head { device, id, seq }
            })
            .collect()
    }

    /// One telling of every head this peer holds, as `heads` frames in pages (`wire::heads_pages`).
    pub fn heads_frames(&self) -> Vec<Frame> {
        heads_pages(self.heads_told())
    }

    /// Whether the Aven Peer's `heads` name a line this peer doesn't hold: then it catches up.
    pub fn behind(&self, heads: &[Head]) -> bool {
        heads.iter().any(|h| h.seq > self.have(&h.device))
    }

    /// What it holds of every chain it keeps or `devices` names (the Aven Peer's heads, as told), each named with the
    /// number of its newest line here, 0 for none: `catch_up` frames in pages, `only` for the chains they name.
    pub fn catch_up_frames(&self, devices: impl IntoIterator<Item = String>) -> Vec<Frame> {
        let keeper = self.keeper.lock().unwrap();
        let mut named: Vec<String> = keeper.heads().into_iter().map(|(d, _)| d).collect();
        named.extend(devices);
        named.sort();
        named.dedup();
        let holds = named
            .into_iter()
            .map(|device| {
                let seq = keeper.chain(&device).last().map_or(0, |h| h.line.seq);
                Have { device, seq }
            })
            .collect();
        catch_up_pages(holds)
    }

    /// The lines `holds` misses, as `lines` frames: of the chains it names alone when `only` (a page of a catch-up),
    /// else of every chain this peer keeps, one it doesn't name from the first.
    /// The retractions go first (`Aven.DB.Chains.Keeper.catchUpAll`): the asker applies every delete before any line
    /// or file it deletes reaches it.
    pub async fn answer(&self, holds: &[Have], only: bool) -> Vec<Frame> {
        let mut lines = vec![];
        if only {
            for h in holds {
                lines.extend(self.lines_after(&h.device, h.seq).await);
            }
        } else {
            for (device, _) in self.heads() {
                let seq = holds
                    .iter()
                    .find(|h| h.device == device)
                    .map_or(0, |h| h.seq);
                lines.extend(self.lines_after(&device, seq).await);
            }
        }
        batches(retractions_first(lines))
    }

    /// This device's own lines the Aven Peer's `heads` show it is missing: written offline, sent on reconnect, the
    /// retractions first.
    pub async fn unsent(&self, heads: &[Head]) -> Vec<Frame> {
        let device = self.device();
        let seq = heads
            .iter()
            .find(|h| h.device == device)
            .map_or(0, |h| h.seq);
        batches(retractions_first(self.lines_after(&device, seq).await))
    }

    /// This device's own lines the Aven Peer's `heads` show it holds: they have gone out.
    pub fn sent(&self, heads: &[Head]) -> Vec<String> {
        let device = self.device();
        let seq = heads
            .iter()
            .find(|h| h.device == device)
            .map_or(0, |h| h.seq);
        self.keeper
            .lock()
            .unwrap()
            .chain(&device)
            .iter()
            .filter(|h| h.line.seq <= seq)
            .map(|h| h.id.clone())
            .collect()
    }

    /// A line's blob, by its name, if the store holds it.
    pub async fn blob(&self, id: &str) -> Option<Bytes> {
        let hash: Hash = id.parse().ok()?;
        self.store.get(&hash).await.ok().flatten()
    }

    /// Whether this device knows its own head, so may write on its chain.
    pub fn learned(&self) -> bool {
        self.learned.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// This device knows its own head now: as the Aven Peer, from the start; any other peer once the Aven Peer's
    /// `heads` named its head and it caught up to it. What it queued is chained on top, in order, and shown in place
    /// of its queued line. The lines to send.
    pub async fn learn(&self) -> Vec<Line> {
        if self
            .learned
            .swap(true, std::sync::atomic::Ordering::Relaxed)
        {
            return vec![];
        }
        // from now on this store is its key's: it holds every line the key signs (`own_store_never_forks`)
        if let Err(why) = put_ref(&self.store, KEY_REF, self.device().into_bytes()).await {
            self.note(
                "dropped",
                json!({ "why": format!("{KEY_REF} not kept: {why}") }),
            );
        }
        let queued = std::mem::take(&mut *self.queued.lock().unwrap());
        let mut out = vec![];
        for (name, body) in queued {
            self.replacing.lock().unwrap().replace(name);
            match self.write(body).await {
                Ok(Some(line)) => out.push(line),
                Ok(None) => {}
                Err(why) => self.note("dropped", json!({ "why": why })),
            }
            self.replacing.lock().unwrap().take();
        }
        if let Err(why) = self.keep_queued().await {
            self.note(
                "dropped",
                json!({ "why": format!("{QUEUED_REF} not cleared: {why}") }),
            );
        }
        out
    }

    /// Writes a line of this device's own: on top of its chain, signed, kept and shown at once. The line to send; or,
    /// before this device knows its own head, `None`: queued and shown, chained once it knows (`learn`).
    pub async fn write(&self, body: Body) -> Result<Option<Line>, String> {
        if !self.learned() {
            body.check().map_err(|why| why.name().to_string())?;
            self.enqueue(body);
            // kept in the store as soon as it is written: a reload finds it waiting still
            self.keep_queued().await?;
            return Ok(None);
        }
        let line = {
            let keeper = self.keeper.lock().unwrap();
            let device = self.device();
            let (seq, prev) = keeper.next(&device);
            let last = keeper.chain(&device).last().map_or(0, |h| h.line.at);
            let mut line = Line {
                network: self.network.clone(),
                device,
                seq,
                prev,
                at: now().max(last + 1),
                sig: String::new(),
                body,
            };
            line.sig = hex(&self.secret.sign(line.signs().as_bytes()).to_bytes());
            line
        };
        match self.take(&line.blob()).await {
            Answer::Moved(_) => Ok(Some(line)),
            other => Err(format!("its own line was not chained: {other:?}")),
        }
    }

    /// A line's blob as it arrives, from gossip or catching up: stored, then taken. What became of it.
    pub async fn take(&self, blob: &[u8]) -> Answer {
        let line = match Line::parse(blob) {
            Ok(line) => line,
            Err(why) => {
                self.note("dropped", json!({ "why": why.name() }));
                return Answer::Refused(why);
            }
        };
        let id = Hash::of(blob);
        let device = line.device.clone();
        // checked first, so a stranger's line never reaches the store
        if let Err(why) = chain::check(
            &self.network,
            &|k: &str| self.gate.admits_hex(k),
            &verifies,
            &line,
        ) {
            let from = device.chars().take(10).collect::<String>();
            self.note("dropped", json!({ "from": from, "why": why.name() }));
            return Answer::Refused(why);
        }
        // held already, but for a line whose text it doesn't hold and that would count again: a retraction
        let stub = self
            .keeper
            .lock()
            .unwrap()
            .stub_of(&device, &id.to_hex())
            .is_some();
        if self.holds(&device, &id.to_hex()) && !(stub && matches!(line.body, Body::Retract(_))) {
            return Answer::Known;
        }
        // every line it keeps rests in the store first, chained or not
        if let Err(e) = self.store.put(Bytes::copy_from_slice(blob)).await {
            self.note("dropped", json!({ "why": format!("not stored: {e}") }));
            return Answer::Refused(chain::Refusal::BadSignature);
        }
        let (answer, settled) = self.keeper.lock().unwrap().take(
            &self.network,
            |k| self.gate.admits_hex(k),
            verifies,
            &self.author(),
            id.to_hex(),
            line,
        );
        match &answer {
            Answer::Moved(ids) => {
                self.moved
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                let held: Vec<Held> = {
                    let keeper = self.keeper.lock().unwrap();
                    keeper
                        .chain(&device)
                        .iter()
                        .filter(|h| ids.contains(&h.id))
                        .cloned()
                        .collect()
                };
                // the ref first: a line is shown once a reload would find it again (a reload half a second after a
                // line was shown in WebKit lost it, 30 Oct 2026)
                self.advance(&device).await;
                for h in &held {
                    if let Body::File(f) = &h.line.body
                        && let Ok(index) = f.file.parse::<Hash>()
                    {
                        self.withheld.write().unwrap().remove(&index);
                    }
                    self.show(h);
                    if let (Body::File(file), Some(f), Ok(from)) = (
                        &h.line.body,
                        self.on_file.get(),
                        crate::keys::public(&h.line.device),
                    ) {
                        f(from, file.clone());
                    }
                }
            }
            Answer::Gap => {
                self.gaps.lock().unwrap().insert(id.to_hex(), Some(now()));
                let h = self.keeper.lock().unwrap().loose().first().cloned();
                if let Some(h) = h {
                    self.show(&h);
                }
            }
            Answer::Fork => {
                let name = match crate::keys::public(&device) {
                    Ok(k) => self.gate.name(&k).0,
                    Err(_) => device.clone(),
                };
                self.note(
                    "fork",
                    json!({ "device": name, "key": device, "id": id.to_hex() }),
                );
            }
            Answer::Known | Answer::Refused(_) => {}
        }
        self.apply(settled).await;
        answer
    }

    /// The vault a device's lines are said for, as the door names it now; the device itself when it names none.
    fn author(&self) -> impl Fn(&str) -> String + use<> {
        let gate = self.gate.clone();
        move |d: &str| match crate::keys::public(d) {
            Ok(k) => gate.name(&k).1.unwrap_or_else(|| d.to_string()),
            Err(_) => d.to_string(),
        }
    }

    /// Settles what it holds again, with the door as it is now, and does what that asks of the store.
    pub async fn settle(&self) {
        let settled = self.keeper.lock().unwrap().settle(&self.author());
        self.apply(settled).await;
    }

    /// What settling asks of the store and the page: each line that lost its text named gone (`gone-<id>`, the
    /// retraction that counts for it) before its blob is deleted, so a reload still walks its chain; the chains a stub
    /// moved; the files no line names any more dropped; and each such line told again, as deleted.
    async fn apply(&self, settled: Settled) {
        let Settled {
            dropped,
            redacted,
            stubs,
        } = settled;
        for (h, r) in redacted.iter().chain(stubs.iter()) {
            let named = match (gone_ref(&h.id), r.id.parse::<Hash>()) {
                (Ok(name), Ok(r)) => match self.store.get_ref(&name).await {
                    Ok(Some(_)) => Ok(()),
                    Ok(None) => self
                        .store
                        .set_ref(&name, None, r)
                        .await
                        .map_err(|e| e.to_string()),
                    Err(e) => Err(e.to_string()),
                },
                (Err(e), _) => Err(e),
                (_, Err(e)) => Err(e.to_string()),
            };
            match (named, h.id.parse::<Hash>()) {
                (Ok(()), Ok(hash)) => {
                    if let Err(e) = self.store.delete(&hash).await {
                        self.note(
                            "dropped",
                            json!({ "why": format!("a deleted line's text kept: {e}") }),
                        );
                    }
                }
                (Err(why), _) => self.note(
                    "dropped",
                    json!({ "why": format!("a deleted line's text kept: {why}") }),
                ),
                (_, Err(e)) => self.note("dropped", json!({ "why": e.to_string() })),
            }
        }
        let devices: std::collections::BTreeSet<String> =
            stubs.iter().map(|(s, _)| s.line.device.clone()).collect();
        for device in devices {
            self.advance(&device).await;
        }
        for file in &dropped {
            self.drop_file(file).await;
        }
        let told: Vec<Held> = {
            let keeper = self.keeper.lock().unwrap();
            let ids: std::collections::BTreeSet<&str> = redacted
                .iter()
                .chain(stubs.iter())
                .map(|(h, _)| h.id.as_str())
                .collect();
            keeper
                .shown()
                .into_iter()
                .filter(|h| ids.contains(h.id.as_str()))
                .cloned()
                .collect()
        };
        for h in &told {
            self.show(h);
        }
        if !redacted.is_empty() || !dropped.is_empty() {
            self.note(
                "deleted",
                json!({ "lines": redacted.iter().map(|(h, _)| &h.id).collect::<Vec<_>>(), "files": dropped }),
            );
        }
    }

    /// The place of a line whose text this store dropped, from the retraction its `gone-<id>` names.
    async fn gone(store: &Shared, id: &str) -> Option<Line> {
        let at = store.get_ref(&gone_ref(id).ok()?).await.ok()??;
        let r = Line::read_kept(&store.get(&at).await.ok()??)?.0;
        let Body::Retract(t) = &r.body else {
            return None;
        };
        Some(Line {
            network: r.network.clone(),
            device: t.device.clone(),
            seq: t.seq,
            prev: t.prev.clone(),
            at: t.at,
            sig: String::new(),
            body: Body::Redacted,
        })
    }

    /// The retraction `gone-<id>` names.
    async fn gone_to(&self, id: &str) -> Option<String> {
        let name = gone_ref(id).ok()?;
        Some(self.store.get_ref(&name).await.ok()??.to_hex())
    }

    /// Whether a line this peer holds names the file `index`.
    pub fn names(&self, index: &str) -> bool {
        self.keeper
            .lock()
            .unwrap()
            .all()
            .any(|h| matches!(&h.line.body, Body::File(f) if f.file == index))
    }

    /// A file no line names any more leaves the store: `file-<index>`, its index and the chunks no other file this
    /// peer keeps lists (files are named by their hash, so two files may share a chunk).
    /// Withheld first, so nothing serves it while its bytes go; `dropped-<index>` kept until they have.
    pub async fn drop_file(&self, index: &str) {
        let Ok(hash) = index.parse::<Hash>() else {
            return;
        };
        self.withheld.write().unwrap().insert(hash);
        // the ref names the index itself: nothing new is stored for it
        if let Ok(name) = RefName::new(format!("{DROPPED_REF}{index}"))
            && let Ok(None) = self.store.get_ref(&name).await
            && let Err(why) = self.store.set_ref(&name, None, hash).await
        {
            self.note(
                "dropped",
                json!({ "why": format!("{DROPPED_REF}{index} not kept: {why}") }),
            );
        }
        let Some(file) = aven_db_store::files::open(&*self.store, &hash)
            .await
            .ok()
            .flatten()
        else {
            self.drop_ref(&format!("file-{index}")).await;
            return self.drop_ref(&format!("{DROPPED_REF}{index}")).await;
        };
        let others: Vec<String> = self
            .keeper
            .lock()
            .unwrap()
            .all()
            .filter_map(|h| match &h.line.body {
                Body::File(f) if f.file != index => Some(f.file.clone()),
                _ => None,
            })
            .collect();
        let mut kept = std::collections::BTreeSet::new();
        for other in others {
            if let Ok(other) = other.parse::<Hash>()
                && let Ok(Some(f)) = aven_db_store::files::open(&*self.store, &other).await
            {
                kept.extend(f.chunks);
            }
        }
        let gone: Vec<Hash> = file
            .chunks
            .iter()
            .filter(|c| !kept.contains(*c))
            .copied()
            .collect();
        self.withheld.write().unwrap().extend(gone.iter().copied());
        self.drop_ref(&format!("file-{index}")).await;
        let mut failed = false;
        for chunk in gone.iter().chain([&hash]) {
            failed |= self.store.delete(chunk).await.is_err();
        }
        if failed {
            self.note("dropped", json!({ "why": format!("file {index} not all deleted; withheld, and dropped again on restart") }));
        } else {
            self.drop_ref(&format!("{DROPPED_REF}{index}")).await;
        }
    }

    /// The blobs it serves no more: a store that withholds them (`aven_db_store::withhold::Withholding`) serves its files.
    pub fn withheld(&self) -> Withheld {
        self.withheld.clone()
    }

    /// Whether `file` (an index's hash) was taken by a retraction here and no line names it again.
    pub fn withholds(&self, file: &Hash) -> bool {
        self.withheld.read().unwrap().contains(file)
    }

    async fn drop_ref(&self, name: &str) {
        let Ok(name) = RefName::new(name) else { return };
        if let Ok(Some(at)) = self.store.get_ref(&name).await {
            let _ = self.store.delete_ref(&name, at).await;
        }
    }

    /// Deletes the line `id`: a retraction of it, written on this device's chain like any line, offline too. Only a
    /// line of the vault this device acts for (`Aven.DB.Chains.retracts`); the line to send, as `write` returns it.
    pub async fn retract(&self, id: &str) -> Result<Option<Line>, String> {
        let body = {
            let keeper = self.keeper.lock().unwrap();
            let author = self.author();
            let held = keeper
                .all()
                .find(|h| h.id == id)
                .ok_or_else(|| format!("no line {id}"))?;
            if matches!(held.line.body, Body::Retract(_)) {
                return Err("a delete can't be deleted".into());
            }
            if author(&held.line.device) != author(&self.device()) {
                return Err("only its own vault deletes a line".into());
            }
            Body::Retract(Retraction::of(id, &held.line))
        };
        self.write(body).await
    }

    /// Whether a gap has been open for [`chain::GAP_WAIT_MS`], so the link should catch up for the lines before it:
    /// once per gap, never again for the same one (README, rule 4). A gap that closed on its own asks for nothing.
    pub fn due(&self, at: u64) -> bool {
        let open: Vec<String> = self
            .keeper
            .lock()
            .unwrap()
            .loose()
            .iter()
            .map(|h| h.id.clone())
            .collect();
        let mut gaps = self.gaps.lock().unwrap();
        gaps.retain(|id, _| open.contains(id));
        let mut due = false;
        for since in gaps.values_mut() {
            if since.is_some_and(|s| at >= s + chain::GAP_WAIT_MS) {
                *since = None;
                due = true;
            }
        }
        due
    }

    /// Moves `chat-<device>` to the head the keeper holds, by compare-and-set: forward only, as the keeper moves.
    async fn advance(&self, device: &str) {
        let Ok(name) = ref_name(device) else {
            return;
        };
        let mut expected = self.store.get_ref(&name).await.ok().flatten();
        // each try either sets the ref or learns what it holds now: two tries settle it, a few more are a race
        for _ in 0..8 {
            let head = self
                .keeper
                .lock()
                .unwrap()
                .chain(device)
                .last()
                .and_then(|h| h.id.parse::<Hash>().ok());
            let Some(head) = head else { return };
            if expected == Some(head) {
                return;
            }
            match self.store.set_ref(&name, expected, head).await {
                Ok(()) => return,
                Err(aven_db_store::Error::Stale { current }) => expected = current,
                Err(e) => {
                    self.note(
                        "dropped",
                        json!({ "why": format!("{name:?} not moved: {e}") }),
                    );
                    return;
                }
            }
        }
    }
}
