//! Docs in the Peers (ARCHITECTURE.md, A43, A45: the Peers own the wire, presence and catch-up): a Doc's gossip topic,
//! and sync between two of its readers by version (`Aven.Peer.DocSync`, held to `peer/spec/vectors/topics.json` and
//! `doc-sync.json`).
//!
//! - **The topic** is `derive_key("avenDB topic 1", epoch key)` (caps README, "Sealing"): only the Doc's readers, and
//!   keepers told it, can find it. A reader joins the newest epoch's and the one before. On the wire a Doc is named by
//!   its topic, never by its id.
//! - **Sync by version** (docs README, "Catching up", 2): two readers who meet on a Doc's topic each tell their
//!   [`tips`], the head of each of their logs; each answers the other's whole telling with what lies [`beyond`] it, and
//!   the other fetches that. An envelope is left out only when the tips tell the other holds it: a tip names it or
//!   something it is before (by name), or names the one head of its log further on, in a log with no split held (by
//!   place). A log with a split held goes whole, so both halves reach every reader they meet.
//!
//! What a Peer-Light answers is only this: the readers it meets on a Doc's topic, by version. It never keeps or serves
//! by arrival number for others (that is keepers' catch-up, stage 5).

use std::collections::{BTreeMap, BTreeSet};

use aven_core::{Hash, Value, decode, encode};

/// The subkey label a Doc's gossip topic is derived under (`Aven.Peer.DocSync.topicLabel`).
pub const TOPIC_LABEL: &str = "avenDB topic 1";

/// A Doc's gossip topic in one epoch (`Aven.Peer.DocSync.topic`).
pub fn topic(epoch_key: &[u8; 32]) -> [u8; 32] {
    blake3::derive_key(TOPIC_LABEL, epoch_key)
}

/// The most one gossip message carries: iroh-gossip's default (`gossipMax`).
pub const GOSSIP_MAX: usize = 4096;

/// A message on a Doc's topic (`Live`): a commit's loose envelope sealed as it is, or, when that wouldn't fit a gossip
/// message, its sealed bytes' hash, which readers fetch through the fetch gate on `aven/db/1`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Live {
    Sealed(Vec<u8>),
    Hash(Hash),
}

impl Live {
    /// What a writer gossips for a sealed envelope (`Live.of`).
    pub fn of(sealed: &[u8]) -> Live {
        let whole = Live::Sealed(sealed.to_vec());
        if whole.encode().len() <= GOSSIP_MAX {
            whole
        } else {
            Live::Hash(aven_core::blake3(sealed))
        }
    }

    pub fn value(&self) -> Value {
        match self {
            Live::Sealed(b) => Value::Map(vec![("sealed".into(), Value::Bytes(b.clone()))]),
            Live::Hash(h) => Value::Map(vec![("hash".into(), Value::Bytes(h.0.to_vec()))]),
        }
    }

    pub fn encode(&self) -> Vec<u8> {
        encode(&self.value())
    }

    /// A message read from exactly its one key, from the one encoding of it (`Live.ofValue?`). The limits on the
    /// sealed bytes inside are the docs layer's, when it opens them.
    pub fn decode(bytes: &[u8]) -> Option<Live> {
        if bytes.len() > GOSSIP_MAX {
            return None;
        }
        let Value::Map(kvs) = decode(bytes)? else {
            return None;
        };
        match kvs.as_slice() {
            [(k, Value::Bytes(b))] if k == "sealed" => Some(Live::Sealed(b.clone())),
            [(k, Value::Bytes(b))] if k == "hash" => {
                Some(Live::Hash(Hash(b.as_slice().try_into().ok()?)))
            }
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

/// A log's head, as a tip tells it (`Tip`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Tip {
    pub writer: u64,
    pub seq: u64,
    pub name: Hash,
}

/// A reader's tips: each held envelope that nothing held names as its `prev`, in the order held (`tips`).
pub fn tips(held: &[Entry]) -> Vec<Tip> {
    let named: BTreeSet<Hash> = held.iter().filter_map(|e| e.prev).collect();
    held.iter()
        .filter(|e| !named.contains(&e.name))
        .map(Entry::tip)
        .collect()
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
