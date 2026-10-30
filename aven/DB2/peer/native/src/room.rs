//! The chat's room (MILESTONE2.md, `Aven.DB.Chat`): one iroh-gossip topic per network, derived from its id, on the
//! peer's shared `Router` beside `aven/db/1` (README, rule 9). A peer joins it through the Aven Peer, a member; every
//! message it sends is signed by its device key, and every message it hears is checked by `aven_db_core::chat` against
//! the door as this peer knows it (`Gate`), so a message whose sender is no member's device is dropped. Each peer says
//! `here` every `EVERY_MS`, and `bye` when it stops. The room is in memory only: a restart or a reload empties it.
//!
//! What the page hears, as timeline lines: `chat` (a line said: who, the vault it serves, the text, when), `room` (who
//! is present, on every change) and `dropped` (a message refused, and why).

use std::sync::{Arc, Mutex};

use aven_db_core::chat::{self, EVERY_MS, Kind, Message};
use aven_db_core::timeline;
use aven_db_store::Hash;
use bytes::Bytes;
use iroh::{PublicKey, SecretKey};
use iroh_gossip::api::{Event, GossipSender};
use iroh_gossip::{Gossip, TopicId};
use n0_future::StreamExt;
use n0_future::time::{Duration, sleep};
use serde_json::json;

use crate::members::Gate;
use crate::{Notes, now};

/// The network's topic: the BLAKE3 of its id, named.
pub fn topic(network: &str) -> TopicId {
    TopicId::from_bytes(
        *Hash::of(format!("avenDB chat 1\nnetwork {network}").as_bytes()).as_bytes(),
    )
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// A signature over `body` by `key`, both as messages carry them.
fn verifies(key: &str, body: &str, sig: &str) -> bool {
    let (Ok(key), Some(sig)) = (crate::keys::public(key), unhex64(sig)) else {
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

struct State {
    room: chat::Room,
    present: Vec<String>,
    last: u64,
    /// the room's direct neighbours over gossip: none, and it joins again through its bootstrap
    neighbours: usize,
}

/// A peer's place in the room: it says lines, and hears everyone's.
#[derive(Clone)]
pub struct Room {
    me: String,
    network: String,
    secret: SecretKey,
    gate: Gate,
    notes: Notes,
    sender: GossipSender,
    state: Arc<Mutex<State>>,
}

impl Room {
    /// Joins the network's room through `bootstrap` (the Aven Peer, or nobody for the Aven Peer itself), and hears it
    /// for as long as the peer runs.
    pub async fn join(
        gossip: &Gossip,
        me: String,
        network: &str,
        secret: SecretKey,
        gate: Gate,
        bootstrap: Vec<PublicKey>,
        notes: Notes,
    ) -> Result<Room, String> {
        let topic = gossip
            .subscribe(topic(network), vec![])
            .await
            .map_err(|e| e.to_string())?;
        let (sender, mut receiver) = topic.split();
        let room = Room {
            me,
            network: network.to_string(),
            secret,
            gate,
            notes,
            sender,
            state: Arc::new(Mutex::new(State {
                room: chat::Room::default(),
                present: vec![],
                last: 0,
                neighbours: 0,
            })),
        };
        let hears = room.clone();
        n0_future::task::spawn(async move {
            while let Some(event) = receiver.next().await {
                match event {
                    Ok(Event::Received(m)) => hears.hear(&m.content, m.delivered_from),
                    Ok(Event::NeighborUp(k)) => {
                        hears.state.lock().unwrap().neighbours += 1;
                        hears.note("neighbour", json!({ "up": hears.gate.name(&k).0 }));
                    }
                    Ok(Event::NeighborDown(k)) => {
                        let mut state = hears.state.lock().unwrap();
                        state.neighbours = state.neighbours.saturating_sub(1);
                        hears.note("neighbour", json!({ "down": hears.gate.name(&k).0 }));
                    }
                    Ok(_) => {}
                    Err(e) => {
                        hears.note("dropped", json!({ "why": format!("the room: {e}") }));
                        break;
                    }
                }
            }
        });
        let beats = room.clone();
        n0_future::task::spawn(async move {
            // A peer joins through its bootstrap only once the door admits it, and again every second while it has no
            // neighbour (its first try may come before its relay is up). Never before: iroh-gossip 0.101 keeps a peer
            // whose connection was closed before it became a neighbour, as the hook closes a stranger's, as active
            // with a dead sender, and never dials it again. It says it is here when the door changes, and every
            // EVERY_MS, until its gossip stopped with its endpoint.
            let (mut door, mut quiet) = (beats.gate.version(), 0);
            while beats.send(Kind::Here, String::new()).await {
                loop {
                    sleep(Duration::from_secs(1)).await;
                    quiet += 1000;
                    let alone = beats.state.lock().unwrap().neighbours == 0;
                    let admitted = beats.gate.admits(&beats.secret.public());
                    if alone && admitted && !bootstrap.is_empty() {
                        let _ = beats.sender.join_peers(bootstrap.clone()).await;
                    }
                    if beats.gate.version() != door || quiet >= EVERY_MS {
                        door = beats.gate.version();
                        break;
                    }
                }
                quiet = 0;
            }
        });
        Ok(room)
    }

    fn note(&self, event: &str, fields: serde_json::Value) {
        (self.notes)(timeline::line(now(), &self.me, event, fields));
    }

    /// A message heard, checked and taken, or dropped.
    fn hear(&self, bytes: &[u8], via: PublicKey) {
        let m: Message = match serde_json::from_slice(bytes) {
            Ok(m) => m,
            Err(e) => {
                self.note(
                    "dropped",
                    json!({ "via": via.fmt_short().to_string(), "why": e.to_string() }),
                );
                return;
            }
        };
        self.take(&m);
    }

    fn take(&self, m: &Message) {
        let mut state = self.state.lock().unwrap();
        let taken = state.room.receive(
            &self.network,
            |k| self.gate.admits_hex(k),
            verifies,
            now(),
            m,
        );
        match taken {
            Ok(()) if m.kind == Kind::Say => {
                let (name, vault) = self.who(&m.from);
                self.note("chat", json!({ "from": name, "vault": vault, "key": m.from, "text": m.text, "at": m.at }));
            }
            Ok(()) => {}
            Err(why) => {
                let from = m.from.chars().take(10).collect::<String>();
                self.note("dropped", json!({ "from": from, "why": why.name() }));
            }
        }
        self.tell(&mut state);
    }

    fn who(&self, key: &str) -> (String, Option<String>) {
        match crate::keys::public(key) {
            Ok(k) => self.gate.name(&k),
            Err(_) => (key.to_string(), None),
        }
    }

    /// The room's line when who is present has changed, and only then.
    fn tell(&self, state: &mut State) {
        let present: Vec<String> = state
            .room
            .present(now())
            .iter()
            .map(|k| self.who(k).0)
            .collect();
        if present != state.present {
            state.present = present.clone();
            self.note("room", json!({ "present": present }));
        }
    }

    /// Signs and sends a message of this peer's own, and takes it into its own room: gossip never echoes one. Whether
    /// it went out.
    async fn send(&self, kind: Kind, text: String) -> bool {
        let m = {
            let mut state = self.state.lock().unwrap();
            let at = now().max(state.last + 1);
            state.last = at;
            let mut m = Message {
                network: self.network.clone(),
                from: self.secret.public().to_string(),
                at,
                kind,
                text,
                file: None,
                sig: String::new(),
            };
            m.sig = hex(&self.secret.sign(m.body().as_bytes()).to_bytes());
            m
        };
        // its own room shows it only while the door admits this peer
        if self.gate.admits(&self.secret.public()) {
            self.take(&m);
        }
        self.post(&m).await
    }

    /// Says a line in the room.
    pub async fn say(&self, text: String) {
        self.send(Kind::Say, text).await;
    }

    /// Says goodbye: the others take this peer out of the room.
    pub async fn bye(&self) {
        self.send(Kind::Bye, String::new()).await;
    }

    /// Sends a message as it is, unchecked: every other peer checks it. The box's check sends one signed by a key that
    /// is no member's this way (MILESTONE2.md, "How it is checked", 5).
    pub async fn post(&self, m: &Message) -> bool {
        let bytes = Bytes::from(serde_json::to_vec(m).expect("a message encodes"));
        match self.sender.broadcast(bytes).await {
            Ok(()) => true,
            Err(e) => {
                self.note("dropped", json!({ "why": format!("not sent: {e}") }));
                false
            }
        }
    }
}
