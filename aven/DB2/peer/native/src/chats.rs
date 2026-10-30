//! The chat's history (`store/README.md`, "The chat keeps its history"; `aven_db_core::chain`): every line this peer
//! hears or writes is a blob in its store, and each device's newest line is the ref `chat-<device>`, moved forward by
//! compare-and-set, only ever as the [`Keeper`] moves it. The Aven Peer keeps every chain and raises forks; every peer
//! does the same with what it hears. A restart or a reload loads the chains from the store, and catching up takes the
//! lines another peer holds that this one misses.
//!
//! Local first: a line this peer writes is in its store and on its page before any peer has it. What the page hears,
//! as timeline lines: `chat` (a line shown, with its place: device, number, name), `fork` (a fork raised) and `dropped`.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use aven_db_core::chain::{self, Answer, Body, Held, Keeper, Line};
use aven_db_core::files::Announcement;
use aven_db_core::timeline;
use aven_db_core::wire::{Frame, Have, Head, MAX_FRAME, catch_up_pages, heads_pages};
use aven_db_store::{Hash, RefName};
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

/// Lines in frames that stay well under the wire's limit, in order.
pub fn batches(lines: Vec<String>) -> Vec<Frame> {
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
                    break;
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
            learned: Arc::default(),
            queued: Arc::default(),
            replacing: Arc::default(),
        };
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
        Ok(chats)
    }

    /// Tells the page every line again, each with its sender as the door now names it: when the door changes, as a
    /// Peer-Light's does once the Aven Peer tells it the members, the history it showed by keys gets its names.
    pub fn retell(&self) {
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
            Body::Text(text) => fields["text"] = json!(text),
            // a file: the page shows it by its index, its name as its text
            Body::File(file) => {
                fields["text"] = json!(file.name);
                fields["file"] = json!(file);
            }
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

    /// The blobs of `device`'s chain newer than `seq`, oldest first, as frames' text.
    pub async fn lines_after(&self, device: &str, seq: u64) -> Vec<String> {
        let ids: Vec<String> = self
            .keeper
            .lock()
            .unwrap()
            .chain(device)
            .iter()
            .filter(|h| h.line.seq > seq)
            .map(|h| h.id.clone())
            .collect();
        let mut out = vec![];
        for id in ids {
            if let Some(blob) = self.blob(&id).await {
                out.push(String::from_utf8_lossy(&blob).into_owned());
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
    pub async fn answer(&self, holds: &[Have], only: bool) -> Vec<Frame> {
        let mut lines = vec![];
        if only {
            for h in holds {
                lines.extend(self.lines_after(&h.device, h.seq).await);
            }
            return batches(lines);
        }
        for (device, _) in self.heads() {
            let seq = holds
                .iter()
                .find(|h| h.device == device)
                .map_or(0, |h| h.seq);
            lines.extend(self.lines_after(&device, seq).await);
        }
        batches(lines)
    }

    /// This device's own lines the Aven Peer's `heads` show it is missing: written offline, sent on reconnect.
    pub async fn unsent(&self, heads: &[Head]) -> Vec<Frame> {
        let device = self.device();
        let seq = heads
            .iter()
            .find(|h| h.device == device)
            .map_or(0, |h| h.seq);
        batches(self.lines_after(&device, seq).await)
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
        out
    }

    /// Writes a line of this device's own: on top of its chain, signed, kept and shown at once. The line to send; or,
    /// before this device knows its own head, `None`: queued and shown, chained once it knows (`learn`).
    pub async fn write(&self, body: Body) -> Result<Option<Line>, String> {
        if !self.learned() {
            body.check().map_err(|why| why.name().to_string())?;
            let name = format!("queued-{}-{}", now(), self.queued.lock().unwrap().len());
            let text = match &body {
                Body::Text(t) => t.clone(),
                Body::File(f) => f.name.clone(),
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
        if let Err(why) = chain::check(&self.network, |k| self.gate.admits_hex(k), verifies, &line)
        {
            let from = device.chars().take(10).collect::<String>();
            self.note("dropped", json!({ "from": from, "why": why.name() }));
            return Answer::Refused(why);
        }
        if self.holds(&device, &id.to_hex()) {
            return Answer::Known;
        }
        // every line it keeps rests in the store first, chained or not
        if let Err(e) = self.store.put(Bytes::copy_from_slice(blob)).await {
            self.note("dropped", json!({ "why": format!("not stored: {e}") }));
            return Answer::Refused(chain::Refusal::BadSignature);
        }
        let answer = self.keeper.lock().unwrap().receive(
            &self.network,
            |k| self.gate.admits_hex(k),
            verifies,
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
                for h in &held {
                    self.show(h);
                    if let (Body::File(file), Some(f), Ok(from)) = (
                        &h.line.body,
                        self.on_file.get(),
                        crate::keys::public(&h.line.device),
                    ) {
                        f(from, file.clone());
                    }
                }
                self.advance(&device).await;
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
        answer
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
