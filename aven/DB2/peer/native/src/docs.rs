//! Docs in the Peers (ARCHITECTURE.md, A43, A45: the Peers own the wire, presence and catch-up): the gossip that
//! carries Docs, and sync between their readers by version (`Aven.Peer.DocSync`, held to `peer/spec/vectors`'s
//! `topics.json`, `live.json` and `doc-sync.json`).
//!
//! - **One topic per group** a device reads (A9, "Massive data", 13), never per Doc: [`group_topic`], the BLAKE3 of
//!   `{key, wire}` where `key` is the group's epoch key's `avenDB topic 1` subkey. A device joins the newest epoch's
//!   and the one before. Until caps' groups exist there are two kinds: Maia City's members (the network's room) and
//!   each vault's own devices (from its keyring's epoch key).
//! - **What a topic carries** ([`Live`]): a loose envelope sealed as it is, or its Doc and hash when it is too large
//!   for a gossip message, fetched through the fetch gate on `aven/db/1`; and a Doc's [`version`], which a reader
//!   holding another answers by syncing with its sender.
//! - **Sync by version** (docs README, "Catching up", 2): two readers each tell their [`tips`], the head of each of
//!   their logs; each answers the other's whole telling with what lies [`beyond`] it. An envelope is left out only
//!   when the tips tell the other holds it: a tip names it or something it is before (by name), or names the one head
//!   of its log further on, in a log with no split held (by place). A log with a split held goes whole.
//!
//! What a Peer-Light answers is only this: the readers it meets, by version. It never keeps or serves by arrival number
//! for others (that is keepers' catch-up, stage 5).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use aven_core::{Hash, Value, decode, encode};
use aven_gen1::timeline;
use iroh::PublicKey;
use iroh_gossip::api::{Event, GossipSender};
use iroh_gossip::{Gossip, TopicId};
use n0_future::StreamExt;
use n0_future::time::{Duration, sleep};
use serde_json::json;

use crate::members::Gate;
use crate::{Notes, now};

/// The subkey label a group's gossip topic is derived under (`Aven.Peer.DocSync.topicLabel`).
pub const TOPIC_LABEL: &str = "avenDB topic 1";

/// A group's gossip topic in one epoch, on wire version `wire` (`groupTopic`): the BLAKE3 of `{key, wire}`.
pub fn group_topic(wire: u64, epoch_key: &[u8; 32]) -> [u8; 32] {
    let key = blake3::derive_key(TOPIC_LABEL, epoch_key);
    aven_core::blake3(&encode(&Value::Map(vec![
        ("key".into(), Value::Bytes(key.to_vec())),
        ("wire".into(), Value::Uint(wire)),
    ])))
    .0
}

/// The most one gossip message carries: iroh-gossip's default (`gossipMax`).
pub const GOSSIP_MAX: usize = 4096;

/// A message on a group's topic (`Live`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Live {
    /// A loose envelope, sealed with the `envelope` kind; its outside names its Doc.
    Sealed(Vec<u8>),
    /// A Doc, and the hash of a sealed envelope of it too large to gossip, to fetch.
    Hash { doc: Hash, hash: Hash },
    /// A Doc, and the version its sender holds.
    Version { doc: Hash, version: Hash },
}

impl Live {
    /// What a writer gossips for a sealed envelope of `doc` (`Live.of`).
    pub fn of(doc: Hash, sealed: &[u8]) -> Live {
        let whole = Live::Sealed(sealed.to_vec());
        if whole.encode().len() <= GOSSIP_MAX {
            whole
        } else {
            Live::Hash {
                doc,
                hash: aven_core::blake3(sealed),
            }
        }
    }

    pub fn value(&self) -> Value {
        let two = |k: &str, doc: &Hash, h: &Hash| {
            Value::Map(vec![
                ("doc".into(), Value::Bytes(doc.0.to_vec())),
                (k.into(), Value::Bytes(h.0.to_vec())),
            ])
        };
        match self {
            Live::Sealed(b) => Value::Map(vec![("sealed".into(), Value::Bytes(b.clone()))]),
            Live::Hash { doc, hash } => two("hash", doc, hash),
            Live::Version { doc, version } => two("version", doc, version),
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        encode(&self.value())
    }

    /// A message read from exactly its keys, from the one encoding of it (`Live.ofValue?`). The limits on the sealed
    /// bytes inside are the docs layer's, when it opens them.
    pub fn decode(bytes: &[u8]) -> Option<Live> {
        if bytes.len() > GOSSIP_MAX {
            return None;
        }
        let Value::Map(kvs) = decode(bytes)? else {
            return None;
        };
        let h = |b: &Vec<u8>| -> Option<Hash> { Some(Hash(b.as_slice().try_into().ok()?)) };
        match kvs.as_slice() {
            [(k, Value::Bytes(b))] if k == "sealed" => Some(Live::Sealed(b.clone())),
            [(d, Value::Bytes(doc)), (k, Value::Bytes(x))] if d == "doc" => match k.as_str() {
                "hash" => Some(Live::Hash {
                    doc: h(doc)?,
                    hash: h(x)?,
                }),
                "version" => Some(Live::Version {
                    doc: h(doc)?,
                    version: h(x)?,
                }),
                _ => None,
            },
            _ => None,
        }
    }
}

/// An envelope as sync reads it: its name (A30), its place in its log, and what it builds on (`Entry`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub name: Hash,
    pub writer: u64,
    pub seq: u64,
    pub prev: Option<Hash>,
    pub deps: Vec<Hash>,
}

impl Entry {
    fn parents(&self) -> impl Iterator<Item = &Hash> {
        self.prev.iter().chain(self.deps.iter())
    }

    pub fn tip(&self) -> Tip {
        Tip {
            writer: self.writer,
            seq: self.seq,
            name: self.name,
        }
    }
}

/// A log's head, as a tip tells it (`Tip`): the wire's, since `doc_tips` carries it.
pub use aven_peer_wire::wire::Tip;

/// A reader's tips: each held envelope that nothing held names as its `prev`, in the order held (`tips`).
pub fn tips(held: &[Entry]) -> Vec<Tip> {
    let named: BTreeSet<Hash> = held.iter().filter_map(|e| e.prev).collect();
    held.iter()
        .filter(|e| !named.contains(&e.name))
        .map(Entry::tip)
        .collect()
}

/// A Doc's version as a reader holds it (`version`): the BLAKE3 of its tips sorted by their encodings, one hash
/// whatever order they are held in.
pub fn version(tips: &[Tip]) -> Hash {
    let mut sorted: Vec<Vec<u8>> = tips.iter().map(|t| encode(&t.value())).collect();
    sorted.sort();
    let values = sorted
        .iter()
        .map(|b| decode(b).expect("a tip's own encoding"))
        .collect();
    aven_core::blake3(&encode(&Value::Array(values)))
}

/// Whether a split is held in writer `w`'s log: two envelopes of different names at one place (`split`).
pub fn split(held: &[Entry], w: u64) -> bool {
    let mut at: BTreeMap<u64, Hash> = BTreeMap::new();
    held.iter()
        .filter(|e| e.writer == w)
        .any(|e| *at.entry(e.seq).or_insert(e.name) != e.name)
}

/// The answer to `tips`: what `held` holds that the tips don't tell, in the order held (`beyond`). `held` is a version
/// (whatever it builds on is held) and its logs are whole, as a Doc holds them.
pub fn beyond<'a>(held: &'a [Entry], tips: &[Tip]) -> Vec<&'a Entry> {
    let by_name: BTreeMap<Hash, &Entry> = held.iter().map(|e| (e.name, e)).collect();
    let told_names: BTreeSet<Hash> = tips.iter().map(|t| t.name).collect();
    // by name: the past, among what is held, of each held envelope a tip names (`Before`)
    let mut before: BTreeSet<Hash> = BTreeSet::new();
    let mut stack: Vec<&Entry> = held
        .iter()
        .filter(|e| told_names.contains(&e.name))
        .collect();
    while let Some(e) = stack.pop() {
        for p in e.parents() {
            if let Some(parent) = by_name.get(p)
                && before.insert(*p)
            {
                stack.push(parent);
            }
        }
    }
    // by place: a log whose tips name exactly one head, and which holds no split here
    let mut heads: BTreeMap<u64, Vec<u64>> = BTreeMap::new();
    for t in tips {
        heads.entry(t.writer).or_default().push(t.seq);
    }
    let mut splits: BTreeMap<u64, bool> = BTreeMap::new();
    let mut by_place = |e: &Entry| {
        let whole = !*splits
            .entry(e.writer)
            .or_insert_with(|| split(held, e.writer));
        whole && matches!(heads.get(&e.writer).map(Vec::as_slice), Some([head]) if e.seq < *head)
    };
    held.iter()
        .filter(|e| !(told_names.contains(&e.name) || before.contains(&e.name) || by_place(e)))
        .collect()
}

/// What a topic hands up: a message heard and the neighbour it came through, or a member met on the topic, whom the
/// host then tells the versions of the group's Docs.
pub enum Heard {
    Live(Live, PublicKey),
    Met(PublicKey),
}

/// A peer's place on one group's topic in one epoch: iroh-gossip on the peer's `Router`, whose connections the door
/// already keeps to members (`members::Hook`). It forwards sealed bytes blind (rule 7) and hands up every message
/// that reads as a [`Live`]; every reader judges each envelope itself (rule 4), so nothing is taken on a neighbour's
/// word.
#[derive(Clone)]
pub struct GroupTopic {
    me: String,
    notes: Notes,
    sender: GossipSender,
    neighbours: Arc<AtomicUsize>,
}

impl GroupTopic {
    #[allow(clippy::too_many_arguments)]
    /// Joins the topic `topic` ([`group_topic`] of a group's epoch key) through `bootstrap`: the devices of the group's
    /// members this peer knows. As in the room, a peer dials them only once the door admits it, and again every second while
    /// it has no neighbour on the topic, for as long as its gossip runs.
    pub async fn join(
        gossip: &Gossip,
        topic: [u8; 32],
        me: String,
        gate: Gate,
        public: PublicKey,
        bootstrap: Vec<PublicKey>,
        notes: Notes,
        hear: Arc<dyn Fn(Heard) + Send + Sync>,
    ) -> Result<GroupTopic, String> {
        let (sender, mut receiver) = gossip
            .subscribe(TopicId::from_bytes(topic), vec![])
            .await
            .map_err(|e| e.to_string())?
            .split();
        let t = GroupTopic {
            me,
            notes,
            sender,
            neighbours: Arc::new(AtomicUsize::new(0)),
        };
        let hears = t.clone();
        n0_future::task::spawn(async move {
            while let Some(event) = receiver.next().await {
                match event {
                    Ok(Event::Received(m)) => match Live::decode(&m.content) {
                        Some(live) => hear(Heard::Live(live, m.delivered_from)),
                        None => hears.note(
                            "dropped",
                            json!({ "why": "not a group's message", "via": m.delivered_from.fmt_short().to_string() }),
                        ),
                    },
                    Ok(Event::NeighborUp(k)) => {
                        hears.neighbours.fetch_add(1, Ordering::Relaxed);
                        hear(Heard::Met(k));
                    }
                    Ok(Event::NeighborDown(_)) => {
                        let _ = hears.neighbours.try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                            Some(n.saturating_sub(1))
                        });
                    }
                    Ok(_) => {}
                    Err(e) => {
                        hears.note("dropped", json!({ "why": format!("a group's topic: {e}") }));
                        break;
                    }
                }
            }
        });
        let dials = t.clone();
        n0_future::task::spawn(async move {
            loop {
                if dials.neighbours.load(Ordering::Relaxed) == 0
                    && gate.admits(&public)
                    && !bootstrap.is_empty()
                    && dials.sender.join_peers(bootstrap.clone()).await.is_err()
                {
                    break;
                }
                sleep(Duration::from_secs(1)).await;
            }
        });
        Ok(t)
    }

    /// Whether a neighbour is on the topic now.
    pub fn near(&self) -> bool {
        self.neighbours.load(Ordering::Relaxed) > 0
    }

    /// Sends a message on the topic. Whether it went out: gossip never echoes it back.
    pub async fn send(&self, live: &Live) -> bool {
        match self.sender.broadcast(live.encode().into()).await {
            Ok(()) => true,
            Err(e) => {
                self.note("dropped", json!({ "why": format!("not sent: {e}") }));
                false
            }
        }
    }

    fn note(&self, event: &str, fields: serde_json::Value) {
        (self.notes)(timeline::line(now(), &self.me, event, fields));
    }
}

/// How long a writer stays quiet on a Doc before its open segment closes (docs README, "Closing a segment": 5 s to
/// start; the catch-up target tunes it).
pub const QUIET_MS: u64 = 5_000;

/// A writer's loose envelopes of one Doc, closed into segments (docs, rule 11: each writer closes its own) at whichever
/// comes first: 256 envelopes or 1 MiB, the epoch rotating (the docs layer's [`aven_db_docs::Closer`]), the writer
/// quiet for [`QUIET_MS`], or the page hiding ([`Closing::close`]). It needs no Loro, so in the browser it runs beside
/// the keys, in the Peer-Light's own worker. Only a device whose hybrid key its vault owner has bound closes segments
/// (stage 4's `device_hybrid_bound`): the caller makes a `Closing` only for one; an unbound device's envelopes stay
/// loose, as keepers keep them.
pub struct Closing {
    closer: aven_db_docs::Closer,
    last: u64,
}

impl Closing {
    pub fn new(
        doc: aven_core::DocId,
        writer: u64,
        generation: u64,
        limits: aven_db_docs::Limits,
    ) -> Closing {
        Closing {
            closer: aven_db_docs::Closer::new(doc, aven_db_docs::MAIN, writer, generation, limits),
            last: 0,
        }
    }

    /// The writer's next envelope, written at `now` (ms) under `epoch` and uploaded loose as `sealed`. Returns the
    /// segment this closes first, when the epoch rotated or a limit would be passed.
    pub fn add(
        &mut self,
        epoch: Hash,
        e: aven_core::Envelope,
        sealed: Hash,
        now: u64,
    ) -> Option<aven_db_docs::Closed> {
        self.last = now;
        self.closer.add(epoch, e, sealed)
    }

    /// Whether the writer has been quiet long enough at `now` for its open segment to close.
    pub fn due(&self, now: u64) -> bool {
        !self.closer.loose().is_empty() && now.saturating_sub(self.last) >= QUIET_MS
    }

    /// Closes the open segment, if any: the writer went quiet, or the page hides.
    pub fn close(&mut self) -> Option<aven_db_docs::Closed> {
        self.closer.close()
    }
}

/// A closed segment sealed for the Doc's readers, hybrid-signed by its writer's device: its Ed25519 seed, and the
/// ML-DSA-65 half derived from it (`aven_id::device_ml_dsa_seed`), made for this one signature and dropped.
pub fn seal_segment(
    closed: &aven_db_docs::Closed,
    device_seed: &aven_id::Secret,
    epoch: &aven_db_docs::EpochKey,
    entropy: &mut impl aven_id::Entropy,
) -> Vec<u8> {
    let device =
        aven_db_docs::Device::from_seeds(device_seed, &aven_id::device_ml_dsa_seed(device_seed));
    closed.segment.seal(&device, epoch, entropy)
}

/// What one run of the judge did (`Aven.Peer.Judge.Run`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Run {
    Done,
    Crashed,
}

/// Sifting a page that crashed the docs worker (`Aven.Peer.Judge.sift`): its envelopes again one at a time, in
/// order, each in a worker fresh from the store and the ones before it that went through. An envelope is unfit only
/// when it crashes alone, so a passing fault never marks a valid envelope. The Peer-Light drives it: [`Sifting::trying`]
/// names what to try after [`Sifting::held`], and [`Sifting::report`] says how it went.
#[derive(Debug)]
pub struct Sifting<T> {
    rest: std::collections::VecDeque<T>,
    held: Vec<T>,
    unfit: Vec<T>,
    trying: Option<T>,
}

impl<T: Clone> Sifting<T> {
    pub fn new(page: Vec<T>) -> Sifting<T> {
        Sifting {
            rest: page.into(),
            held: vec![],
            unfit: vec![],
            trying: None,
        }
    }

    /// The next envelope to try alone, or none once the page is sifted.
    pub fn trying(&mut self) -> Option<T> {
        if self.trying.is_none() {
            self.trying = self.rest.pop_front();
        }
        self.trying.clone()
    }

    /// What went through before the one being tried, in order.
    pub fn held(&self) -> &[T] {
        &self.held
    }

    /// How the one being tried went.
    pub fn report(&mut self, run: Run) {
        if let Some(e) = self.trying.take() {
            match run {
                Run::Done => self.held.push(e),
                Run::Crashed => self.unfit.push(e),
            }
        }
    }

    /// What crashed alone, in the page's order.
    pub fn unfit(&self) -> &[T] {
        &self.unfit
    }
}
