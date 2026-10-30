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
use aven_db_core::timeline;
use aven_db_core::wire::{Frame, Have, Head, MAX_FRAME};
use aven_db_store::{Hash, RefName, Store};
use bytes::Bytes;
use iroh::SecretKey;
use serde_json::json;

use crate::members::Gate;
use crate::{Notes, now};

/// The store a peer keeps its chains in, shared by the tasks that hear and write lines.
#[cfg(not(target_arch = "wasm32"))]
pub type Shared = Arc<dyn Store + Send + Sync>;
#[cfg(target_arch = "wasm32")]
pub type Shared = Arc<dyn Store>;

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
                let line = Line::parse(&bytes)?;
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
        Ok(chats)
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

    /// The `heads` frame: each device's head this peer holds.
    pub fn heads_frame(&self) -> Frame {
        let keeper = self.keeper.lock().unwrap();
        let heads = keeper
            .heads()
            .into_iter()
            .map(|(device, id)| {
                let seq = keeper.chain(&device).last().map_or(0, |h| h.line.seq);
                Head { device, id, seq }
            })
            .collect();
        Frame::Heads { heads }
    }

    /// What it holds of every chain it keeps or the Aven Peer's `heads` name: the `catch_up` frame.
    pub fn catch_up_frame(&self, heads: &[Head]) -> Frame {
        let keeper = self.keeper.lock().unwrap();
        let mut devices: Vec<String> = keeper.heads().into_iter().map(|(d, _)| d).collect();
        devices.extend(heads.iter().map(|h| h.device.clone()));
        devices.sort();
        devices.dedup();
        let holds = devices
            .into_iter()
            .filter_map(|device| {
                let seq = keeper.chain(&device).last()?.line.seq;
                Some(Have { device, seq })
            })
            .collect();
        Frame::CatchUp { holds }
    }

    /// The lines `holds` misses of every chain this peer keeps, as `lines` frames.
    pub async fn answer(&self, holds: &[Have]) -> Vec<Frame> {
        let mut lines = vec![];
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

    /// A line's blob, by its name, if the store holds it.
    pub async fn blob(&self, id: &str) -> Option<Bytes> {
        let hash: Hash = id.parse().ok()?;
        self.store.get(&hash).await.ok().flatten()
    }

    /// Writes a line of this device's own: on top of its chain, signed, kept and shown at once. The line to send.
    pub async fn write(&self, body: Body) -> Result<Line, String> {
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
            Answer::Moved(_) => Ok(line),
            other => Err(format!("its own line was not chained: {other:?}")),
        }
    }

    /// A line's blob as it arrives, from gossip or catching up: stored, then taken. What became of it.
    pub async fn take(&self, blob: &[u8]) -> Answer {
        let line = match Line::parse(blob) {
            Ok(line) => line,
            Err(why) => {
                self.note("dropped", json!({ "why": why }));
                return Answer::Refused(chain::Refusal::BadSignature);
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
