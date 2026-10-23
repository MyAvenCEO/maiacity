//! Sparse reconciliation of the holdings a device is already allowed to announce to one peer.
//!
//! `RangeSync.lean`'s `Round.same`, `Round.send`, and four levels of binary `Round.split`s correspond to a
//! matching subtree, a leaf, and a branch here. `Range.replacement_agrees` models replacing a peer claim with its
//! new snapshot, including deletion; it does not use the commutative edit-head join. As in `Range.Sound`, distinct
//! BLAKE3 inputs are assumed not to collide. These are routing claims from the connection's authenticated device,
//! not proofs of edits or permission.
//! Each receiver compares only that same device's previous claims, never fingerprints of its own private logs.
//! A round commits atomically after every requested node checks against the offered root. Interrupted or malformed
//! rounds leave the last complete holdings intact. Nothing here changes persisted edits or individual verification.

use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock};

use anyhow::{Context as _, Result, bail, ensure};
use avendb::id::SignerId;
use avendb::sealed::FileRoot;
use avendb::sync::LogId;
use avendb::wire::{Announce, FileHold, Frontier, Wire};
use bao_tree::blake3;
use n0_future::time::{Duration, Instant};

use crate::holdings::{Holdings, MOST};

pub(crate) const LIMIT: usize = (16 << 20) - 1;
const LEAF: usize = 16;
const BATCH: usize = 64;
const DEPTH: usize = 64;
const SESSIONS: usize = 8;
const NODES: usize = 1 << 16;
const STAGED: usize = 32 << 20;
const IDLE: Duration = Duration::from_secs(90);
const VERSION: u8 = 1;
// Conservative allocation charges, not serialized sizes. Shared snapshots keep their charge until their last
// reader finishes, so eviction cannot hide in-flight sends or retained incoming baselines from this budget.
const RETAINED_BYTES: usize = if cfg!(target_arch = "wasm32") {
    4 << 20
} else {
    16 << 20
};
const RETAINED_TREES: usize = 32;
const NODE_COST: usize = 512;
fn log_cost(frontier: &Frontier) -> usize {
    256 + 64 * (frontier.heads.len() + frontier.waiting.len())
}
fn logs_cost<'a>(logs: impl Iterator<Item = &'a Frontier>) -> usize {
    logs.fold(NODE_COST, |sum, f| sum.saturating_add(log_cost(f)))
}

struct Retained {
    used: Arc<AtomicUsize>,
    bytes: usize,
}
impl Drop for Retained {
    fn drop(&mut self) {
        self.used.fetch_sub(self.bytes, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Summary {
    hash: [u8; 32],
    count: u32,
}

#[derive(Clone)]
enum Kind {
    Empty,
    Leaf(BTreeMap<LogId, Frontier>),
    Branch([Arc<Node>; 16]),
    /// Only a receiving round contains these. They can never become a published tree.
    Waiting,
}

#[derive(Clone)]
struct Node {
    summary: Summary,
    cost: usize,
    kind: Kind,
}

type Prefix = Vec<u8>;

#[derive(Clone)]
pub(crate) struct Tree(Arc<Node>, Option<Arc<Retained>>);

impl Default for Tree {
    fn default() -> Self {
        Self(empty(), None)
    }
}

fn empty() -> Arc<Node> {
    static EMPTY: LazyLock<Arc<Node>> = LazyLock::new(|| {
        Arc::new(Node {
            summary: Summary {
                hash: blake3::hash(b"avenDB range 1 empty").into(),
                count: 0,
            },
            cost: 0,
            kind: Kind::Empty,
        })
    });
    EMPTY.clone()
}

fn key(log: LogId) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"avenDB range 1 key");
    match log {
        LogId::Vault(v) => {
            hasher.update(&[0]);
            hasher.update(&v.0);
        }
        LogId::Share(s) => {
            hasher.update(&[1]);
            hasher.update(&s.0);
        }
        LogId::Audience(v, a) => {
            hasher.update(&[2]);
            hasher.update(&v.0);
            hasher.update(&a.0);
        }
        LogId::Entry(e) => {
            hasher.update(&[3]);
            hasher.update(&e.0);
        }
    }
    hasher.finalize().into()
}

fn nibble(key: &[u8; 32], depth: usize) -> usize {
    if depth % 2 == 0 {
        (key[depth / 2] >> 4) as usize
    } else {
        (key[depth / 2] & 15) as usize
    }
}

fn contains(prefix: &[u8], log: LogId) -> bool {
    let key = key(log);
    prefix
        .iter()
        .enumerate()
        .all(|(i, &n)| nibble(&key, i) == n as usize)
}

fn leaf_wire(logs: &BTreeMap<LogId, Frontier>) -> Vec<u8> {
    Announce {
        full: false,
        logs: logs.iter().map(|(l, f)| (*l, f.clone())).collect(),
        files: vec![],
    }
    .to_wire()
}

fn leaf(logs: BTreeMap<LogId, Frontier>) -> Arc<Node> {
    if logs.is_empty() {
        return empty();
    }
    let mut hash = blake3::Hasher::new();
    hash.update(b"avenDB range 1 leaf");
    hash.update(&leaf_wire(&logs));
    Arc::new(Node {
        summary: Summary {
            hash: hash.finalize().into(),
            count: logs.len() as u32,
        },
        cost: logs_cost(logs.values()),
        kind: Kind::Leaf(logs),
    })
}

fn branch_summary(children: &[Summary; 16]) -> Result<Summary> {
    let count: u64 = children.iter().map(|s| s.count as u64).sum();
    ensure!(
        count > LEAF as u64 && count <= MOST as u64,
        "a range branch's size is out of bounds"
    );
    let mut hash = blake3::Hasher::new();
    hash.update(b"avenDB range 1 branch");
    for child in children {
        hash.update(&child.count.to_be_bytes());
        hash.update(&child.hash);
    }
    Ok(Summary {
        hash: hash.finalize().into(),
        count: count as u32,
    })
}

fn entries(node: &Node, into: &mut BTreeMap<LogId, Frontier>) {
    match &node.kind {
        Kind::Empty => {}
        Kind::Leaf(logs) => into.extend(logs.iter().map(|(l, f)| (*l, f.clone()))),
        Kind::Branch(children) => children.iter().for_each(|child| entries(child, into)),
        Kind::Waiting => unreachable!("an incomplete range is never published"),
    }
}

fn build(logs: BTreeMap<LogId, Frontier>, depth: usize) -> Arc<Node> {
    if logs.len() <= LEAF || depth == DEPTH {
        return leaf(logs);
    }
    let mut groups: [BTreeMap<LogId, Frontier>; 16] = std::array::from_fn(|_| BTreeMap::new());
    for (log, frontier) in logs {
        groups[nibble(&key(log), depth)].insert(log, frontier);
    }
    let children = groups.map(|group| build(group, depth + 1));
    let summary = branch_summary(&std::array::from_fn(|i| children[i].summary))
        .expect("bounded local holdings");
    Arc::new(Node {
        summary,
        cost: NODE_COST + children.iter().map(|c| c.cost).sum::<usize>(),
        kind: Kind::Branch(children),
    })
}

fn set(node: &Arc<Node>, log: LogId, value: Option<Frontier>, depth: usize) -> Arc<Node> {
    match &node.kind {
        Kind::Empty => value.map_or_else(empty, |f| leaf([(log, f)].into())),
        Kind::Leaf(logs) => {
            if logs.get(&log) == value.as_ref() {
                return node.clone();
            }
            let mut logs = logs.clone();
            match value {
                Some(f) => {
                    logs.insert(log, f);
                }
                None => {
                    logs.remove(&log);
                }
            }
            build(logs, depth)
        }
        Kind::Branch(children) => {
            let slot = nibble(&key(log), depth);
            let child = set(&children[slot], log, value, depth + 1);
            if Arc::ptr_eq(&child, &children[slot]) {
                return node.clone();
            }
            let mut children = children.clone();
            children[slot] = child;
            let count: u32 = children.iter().map(|c| c.summary.count).sum();
            if count <= LEAF as u32 {
                let mut logs = BTreeMap::new();
                for child in &children {
                    entries(child, &mut logs);
                }
                leaf(logs)
            } else {
                let summary = branch_summary(&std::array::from_fn(|i| children[i].summary))
                    .expect("bounded local holdings");
                Arc::new(Node {
                    summary,
                    cost: NODE_COST + children.iter().map(|c| c.cost).sum::<usize>(),
                    kind: Kind::Branch(children),
                })
            }
        }
        Kind::Waiting => unreachable!("only a completed tree is changed locally"),
    }
}

fn visit(node: &Node, f: &mut impl FnMut(LogId, &Frontier)) {
    match &node.kind {
        Kind::Empty => {}
        Kind::Leaf(logs) => {
            for (log, frontier) in logs {
                f(*log, frontier);
            }
        }
        Kind::Branch(children) => {
            for child in children {
                visit(child, f);
            }
        }
        Kind::Waiting => unreachable!("only completed trees are visited"),
    }
}

fn get(node: &Node, log: LogId, depth: usize) -> Option<&Frontier> {
    match &node.kind {
        Kind::Empty => None,
        Kind::Leaf(logs) => logs.get(&log),
        Kind::Branch(children) => get(&children[nibble(&key(log), depth)], log, depth + 1),
        Kind::Waiting => unreachable!("only completed trees are read"),
    }
}

impl Tree {
    fn replace(&mut self, logs: &BTreeMap<LogId, Frontier>) {
        let mut removed = Vec::new();
        visit(&self.0, &mut |log, _| {
            if !logs.contains_key(&log) {
                removed.push(log);
            }
        });
        for log in removed {
            self.0 = set(&self.0, log, None, 0);
        }
        for (log, frontier) in logs {
            if get(&self.0, *log, 0) != Some(frontier) {
                self.0 = set(&self.0, *log, Some(frontier.clone()), 0);
            }
        }
    }

    fn at(&self, prefix: &[u8]) -> Arc<Node> {
        let mut node = self.0.clone();
        for (depth, &slot) in prefix.iter().enumerate() {
            node = match &node.kind {
                Kind::Branch(children) => children[slot as usize].clone(),
                Kind::Leaf(logs) => {
                    // The new tree can split a formerly small leaf. Filtering at most sixteen entries gives the
                    // same subtree the old tree would have there without allocating empty paths for every key.
                    let logs = logs
                        .iter()
                        .filter(|(l, _)| contains(prefix, **l))
                        .map(|(l, f)| (*l, f.clone()))
                        .collect();
                    return build(logs, prefix.len());
                }
                Kind::Empty => return node,
                Kind::Waiting => unreachable!("the base of a round is complete"),
            };
            debug_assert!(depth < DEPTH);
        }
        node
    }

    /// A complete offered tree's node at each prefix the receiver requested, in that order.
    pub(crate) fn nodes(&self, response: &[u8]) -> Result<Option<Vec<u8>>> {
        let mut read = Read(response);
        ensure!(read.byte()? == VERSION, "unknown range version");
        let status = read.byte()?;
        ensure!(
            read.hash()? == self.0.summary.hash,
            "a response for another range root"
        );
        if status == 0 {
            ensure!(read.0.is_empty(), "trailing range completion bytes");
            return Ok(None);
        }
        ensure!(status == 1, "unknown range response");
        let count = read.byte()? as usize;
        ensure!(count > 0 && count <= BATCH, "too many requested ranges");
        let mut prefixes = Vec::with_capacity(count);
        let mut seen = HashSet::new();
        for _ in 0..count {
            let prefix = read.prefix()?;
            ensure!(seen.insert(prefix.clone()), "a repeated range request");
            prefixes.push(prefix);
        }
        ensure!(read.0.is_empty(), "trailing range request bytes");
        let mut out = vec![VERSION, 1];
        put_summary(&mut out, self.0.summary);
        out.push(count as u8);
        for prefix in prefixes {
            put_prefix(&mut out, &prefix);
            let node = self.at(&prefix);
            match &node.kind {
                Kind::Empty => out.push(0),
                Kind::Leaf(logs) => {
                    ensure!(
                        logs.len() <= LEAF,
                        "a hash collision overfilled a range leaf"
                    );
                    let wire = leaf_wire(logs);
                    ensure!(wire.len() <= LIMIT, "a range leaf is too large");
                    out.push(1);
                    out.extend_from_slice(&(wire.len() as u32).to_be_bytes());
                    out.extend(wire);
                }
                Kind::Branch(children) => {
                    out.push(2);
                    for child in children {
                        put_summary(&mut out, child.summary);
                    }
                }
                Kind::Waiting => unreachable!("an offered tree is complete"),
            }
            ensure!(out.len() <= LIMIT, "a range batch is too large");
        }
        Ok(Some(out))
    }

    pub(crate) fn begin(&self, files: &BTreeMap<FileRoot, FileHold>) -> Result<Vec<u8>> {
        let mut out = vec![VERSION, 0];
        put_summary(&mut out, self.0.summary);
        let announce = Announce {
            full: true,
            logs: vec![],
            files: files.iter().map(|(r, h)| (*r, Some(h.clone()))).collect(),
        };
        out.extend(announce.to_wire());
        ensure!(out.len() <= LIMIT, "range file holdings are too large");
        Ok(out)
    }
}

fn put_summary(out: &mut Vec<u8>, summary: Summary) {
    out.extend_from_slice(&summary.count.to_be_bytes());
    out.extend_from_slice(&summary.hash);
}

fn put_prefix(out: &mut Vec<u8>, prefix: &[u8]) {
    out.push(prefix.len() as u8);
    // One byte per nibble avoids alternate encodings of a half-filled last byte.
    out.extend_from_slice(prefix);
}

struct Read<'a>(&'a [u8]);
impl<'a> Read<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        ensure!(n <= self.0.len(), "a range message is cut short");
        let (bytes, rest) = self.0.split_at(n);
        self.0 = rest;
        Ok(bytes)
    }
    fn byte(&mut self) -> Result<u8> {
        Ok(self.take(1)?[0])
    }
    fn count(&mut self) -> Result<u32> {
        Ok(u32::from_be_bytes(
            self.take(4)?.try_into().expect("four bytes"),
        ))
    }
    fn hash(&mut self) -> Result<[u8; 32]> {
        Ok(self.take(32)?.try_into().expect("32 bytes"))
    }
    fn summary(&mut self) -> Result<Summary> {
        let count = self.count()?;
        ensure!(count as usize <= MOST, "too many range logs");
        let summary = Summary {
            count,
            hash: self.hash()?,
        };
        ensure!(
            count != 0 || summary == empty().summary,
            "a noncanonical empty range"
        );
        Ok(summary)
    }
    fn prefix(&mut self) -> Result<Prefix> {
        let n = self.byte()? as usize;
        ensure!(n <= DEPTH, "a range is too deep");
        let prefix = self.take(n)?.to_vec();
        ensure!(prefix.iter().all(|n| *n < 16), "an invalid range nibble");
        Ok(prefix)
    }
}

fn replace_at(node: &mut Arc<Node>, prefix: &[u8], replacement: Arc<Node>) -> Result<()> {
    let Some((&slot, rest)) = prefix.split_first() else {
        *node = replacement;
        return Ok(());
    };
    let node = Arc::make_mut(node);
    let Kind::Branch(children) = &mut node.kind else {
        bail!("a range parent is not resolved");
    };
    replace_at(&mut children[slot as usize], rest, replacement)?;
    node.cost = NODE_COST + children.iter().map(|c| c.cost).sum::<usize>();
    Ok(())
}

struct Incoming {
    device: SignerId,
    full: bool,
    at: Instant,
    expected: Summary,
    base: Tree,
    tree: Tree,
    wanted: BTreeMap<Prefix, Summary>,
    queue: VecDeque<Prefix>,
    changes: BTreeMap<LogId, Option<Frontier>>,
    files: BTreeMap<FileRoot, FileHold>,
    bytes: usize,
    nodes: usize,
}

impl Incoming {
    fn new(
        device: SignerId,
        base: Tree,
        full: bool,
        expected: Summary,
        files: BTreeMap<FileRoot, FileHold>,
        bytes: usize,
    ) -> Self {
        Self {
            device,
            full,
            at: Instant::now(),
            expected,
            base,
            tree: Tree::default(),
            wanted: BTreeMap::new(),
            queue: VecDeque::new(),
            changes: BTreeMap::new(),
            files,
            bytes,
            nodes: 0,
        }
    }

    fn changed(&mut self, prefix: &[u8], node: &Node) {
        let old = self.base.at(prefix);
        // A removed large subtree needs only its ids; do not clone every old frontier just to discard it.
        visit(&old, &mut |log, _| {
            if get(node, log, prefix.len()).is_none() {
                self.changes.insert(log, None);
            }
        });
        visit(node, &mut |log, frontier| {
            if get(&old, log, prefix.len()) != Some(frontier) {
                self.changes.insert(log, Some(frontier.clone()));
            }
        });
    }

    fn known_or_waiting(&mut self, prefix: Prefix, expected: Summary) -> Arc<Node> {
        let base = self.base.at(&prefix);
        if base.summary == expected {
            return base;
        }
        if expected.count == 0 {
            let node = empty();
            self.changed(&prefix, &node);
            return node;
        }
        self.wanted.insert(prefix.clone(), expected);
        self.queue.push_back(prefix);
        Arc::new(Node {
            summary: expected,
            cost: NODE_COST,
            kind: Kind::Waiting,
        })
    }

    fn part(&mut self, read: &mut Read<'_>) -> Result<()> {
        let prefix = read.prefix()?;
        let expected = self
            .wanted
            .remove(&prefix)
            .context("an unsolicited or duplicate range node")?;
        let node = match read.byte()? {
            0 => empty(),
            1 => {
                let len = read.count()? as usize;
                ensure!(len <= LIMIT, "a range leaf is too large");
                let wire = read.take(len)?;
                let announce = Announce::from_wire(wire)?;
                ensure!(
                    !announce.full
                        && announce.files.is_empty()
                        && !announce.logs.is_empty()
                        && announce.logs.len() <= LEAF,
                    "an invalid range leaf"
                );
                ensure!(announce.to_wire() == wire, "a noncanonical range leaf");
                ensure!(
                    announce.logs.iter().all(|(log, _)| contains(&prefix, *log)),
                    "a log outside its range"
                );
                let node = leaf(announce.logs.into_iter().collect());
                ensure!(
                    node.summary == expected,
                    "a leaf contradicts the offered range root"
                );
                self.changed(&prefix, &node);
                node
            }
            2 => {
                ensure!(prefix.len() < DEPTH, "a range branch is too deep");
                let mut summaries = [empty().summary; 16];
                for summary in &mut summaries {
                    *summary = read.summary()?;
                }
                let summary = branch_summary(&summaries)?;
                ensure!(
                    summary == expected,
                    "a branch contradicts the offered range root"
                );
                let children = std::array::from_fn(|slot| {
                    let mut child = prefix.clone();
                    child.push(slot as u8);
                    self.known_or_waiting(child, summaries[slot])
                });
                Arc::new(Node {
                    summary,
                    cost: NODE_COST + children.iter().map(|c| c.cost).sum::<usize>(),
                    kind: Kind::Branch(children),
                })
            }
            _ => bail!("unknown range node"),
        };
        ensure!(
            node.summary == expected,
            "a node contradicts the offered range root"
        );
        replace_at(&mut self.tree.0, &prefix, node)?;
        self.nodes += 1;
        ensure!(
            self.nodes <= NODES && self.wanted.len() <= NODES,
            "too many range nodes"
        );
        Ok(())
    }

    fn reply(&mut self) -> Vec<u8> {
        self.queue.retain(|prefix| self.wanted.contains_key(prefix));
        let mut out = vec![VERSION, u8::from(!self.wanted.is_empty())];
        out.extend_from_slice(&self.expected.hash);
        if !self.wanted.is_empty() {
            let n = self.queue.len().min(BATCH);
            out.push(n as u8);
            for prefix in self.queue.iter().take(n) {
                put_prefix(&mut out, prefix);
            }
        }
        out
    }
}

/// A completed round's changes, applied under the same holdings lock as legacy announcements.
pub(crate) struct Completed {
    full: bool,
    changes: BTreeMap<LogId, Option<Frontier>>,
    files: BTreeMap<FileRoot, FileHold>,
}

impl Completed {
    pub(crate) fn apply(self, holdings: &mut Holdings) {
        if self.full {
            holdings.logs.clear();
        }
        for (log, frontier) in self.changes {
            match frontier {
                Some(frontier) => {
                    holdings.logs.insert(log, frontier);
                }
                None => {
                    holdings.logs.remove(&log);
                }
            }
        }
        holdings.files = self.files;
    }
}

/// The cached trees contain only holdings already published or authorized for the peer. Staging is per connection,
/// bounded independently of the peer's claims, and discarded on a malformed message, legacy update, or disconnect.
#[derive(Default)]
pub(crate) struct Cache {
    offered: HashMap<SignerId, Tree>,
    received: HashMap<SignerId, Tree>,
    incoming: HashMap<usize, Incoming>,
    unsupported: HashSet<usize>,
    retained: Arc<AtomicUsize>,
    recent: VecDeque<(bool, SignerId)>,
    #[cfg(test)]
    completed: usize,
    #[cfg(test)]
    announced: usize,
}

impl Cache {
    pub(crate) fn has_offered(&self, device: SignerId) -> bool {
        self.offered.contains_key(&device)
    }
    fn remove_cached(&mut self, offered: bool, device: SignerId) -> Option<Tree> {
        self.recent.retain(|key| *key != (offered, device));
        if offered {
            self.offered.remove(&device)
        } else {
            self.received.remove(&device)
        }
    }

    fn remember(&mut self, offered: bool, device: SignerId, mut tree: Tree) -> Option<Tree> {
        self.remove_cached(offered, device);
        tree.1 = None;
        let cost = tree.0.cost.max(NODE_COST);
        if cost > RETAINED_BYTES {
            return None;
        }
        while self.recent.len() >= RETAINED_TREES
            || self.retained.load(Ordering::Relaxed).saturating_add(cost) > RETAINED_BYTES
        {
            let (side, old) = self.recent.pop_front()?;
            if side {
                self.offered.remove(&old);
            } else {
                self.received.remove(&old);
            }
        }
        // Only this locked Cache adds charges; independently dropped snapshots can only subtract them.
        self.retained.fetch_add(cost, Ordering::Relaxed);
        tree.1 = Some(Arc::new(Retained {
            used: self.retained.clone(),
            bytes: cost,
        }));
        self.recent.push_back((offered, device));
        if offered {
            self.offered.insert(device, tree.clone());
        } else {
            self.received.insert(device, tree.clone());
        }
        Some(tree)
    }

    pub(crate) fn offered(&mut self, device: SignerId, want: &Holdings) -> Result<Tree> {
        ensure!(
            want.logs.len() <= MOST && want.files.len() <= MOST,
            "too many holdings for a range round"
        );
        // Avoid constructing an oversized tree just to discard it. Branch allocations are checked again below.
        ensure!(
            logs_cost(want.logs.values()) <= RETAINED_BYTES,
            "range index exceeds retained budget"
        );
        let mut tree = self.remove_cached(true, device).unwrap_or_default();
        tree.1 = None;
        tree.replace(&want.logs);
        self.remember(true, device, tree)
            .context("range retained budget is occupied")
    }
    pub(crate) fn unsupported(&self, connection: usize) -> bool {
        self.unsupported.contains(&connection)
    }
    pub(crate) fn fallback(&mut self, connection: usize, device: SignerId) {
        self.unsupported.insert(connection);
        self.remove_cached(true, device);
    }
    pub(crate) fn gone(&mut self, connection: usize, device: SignerId, forget: bool) {
        self.incoming.remove(&connection);
        self.unsupported.remove(&connection);
        if forget {
            // There can be an older concurrent connection of an unknown device. Once its complete claim is
            // forgotten, no candidate based on that claim may commit a sparse patch into now-empty holdings.
            self.forget(device);
            self.remove_cached(true, device);
        }
    }
    pub(crate) fn forget(&mut self, device: SignerId) {
        self.remove_cached(false, device);
        self.incoming
            .retain(|_, incoming| incoming.device != device);
    }
    pub(crate) fn observe(&mut self, device: SignerId, announce: &Announce) {
        #[cfg(test)]
        {
            self.announced += 1;
        }
        self.incoming
            .retain(|_, incoming| incoming.device != device);
        let previous = self.remove_cached(false, device);
        if announce.logs.len() > MOST
            || logs_cost(announce.logs.iter().map(|(_, f)| f)) > RETAINED_BYTES
        {
            return;
        }
        // After eviction, a delta cannot establish a complete baseline. A later range round starts cold and
        // replaces the complete held log map; it must not leave deleted logs from the uncached claim behind.
        if !announce.full && previous.is_none() {
            return;
        }
        let mut tree = previous.unwrap_or_default();
        tree.1 = None;
        if announce.full {
            tree.0 = build(announce.logs.iter().cloned().collect(), 0);
        } else if tree.0.summary.count as usize + announce.logs.len() > MOST {
            let mut logs = BTreeMap::new();
            entries(&tree.0, &mut logs);
            logs.extend(announce.logs.iter().cloned());
            if logs.len() > MOST {
                return;
            }
            tree.0 = build(logs, 0);
        } else {
            for (log, frontier) in &announce.logs {
                tree.0 = set(&tree.0, *log, Some(frontier.clone()), 0);
            }
        }
        self.remember(false, device, tree);
    }
    pub(crate) fn expire(&mut self) {
        self.incoming
            .retain(|_, incoming| incoming.at.elapsed() < IDLE);
    }
    pub(crate) fn receive(
        &mut self,
        connection: usize,
        device: SignerId,
        bytes: &[u8],
    ) -> Result<(Vec<u8>, Option<Completed>)> {
        self.expire();
        let answer = self.take(connection, device, bytes);
        if answer.is_err() {
            self.incoming.remove(&connection);
        }
        answer
    }
    fn take(
        &mut self,
        connection: usize,
        device: SignerId,
        bytes: &[u8],
    ) -> Result<(Vec<u8>, Option<Completed>)> {
        ensure!(bytes.len() <= LIMIT, "a range message is too large");
        let mut read = Read(bytes);
        ensure!(read.byte()? == VERSION, "unknown range version");
        let kind = read.byte()?;
        let expected = read.summary()?;
        if kind == 0 {
            ensure!(
                self.incoming.contains_key(&connection) || self.incoming.len() < SESSIONS,
                "too many simultaneous range rounds"
            );
            let files = Announce::from_wire(read.0)?;
            ensure!(
                files.full
                    && files.logs.is_empty()
                    && files.files.len() <= MOST
                    && files.files.iter().all(|(_, f)| f.is_some()),
                "invalid files in a range offer"
            );
            ensure!(
                files.to_wire() == read.0,
                "noncanonical files in a range offer"
            );
            let files = files
                .files
                .into_iter()
                .map(|(r, h)| (r, h.expect("checked")))
                .collect();
            let full = !self.received.contains_key(&device);
            let base = self.received.get(&device).cloned().unwrap_or_default();
            let mut incoming = Incoming::new(device, base, full, expected, files, bytes.len());
            incoming.tree.0 = incoming.known_or_waiting(Vec::new(), expected);
            self.incoming.insert(connection, incoming);
        } else {
            ensure!(kind == 1, "unknown range message");
            let incoming = self
                .incoming
                .get_mut(&connection)
                .context("a range round has not begun or expired")?;
            ensure!(
                incoming.device == device && incoming.expected == expected,
                "a range node belongs to another round"
            );
            incoming.bytes = incoming
                .bytes
                .checked_add(bytes.len())
                .context("range byte count overflow")?;
            ensure!(incoming.bytes <= STAGED, "a range round is too large");
            let n = read.byte()? as usize;
            ensure!(n > 0 && n <= BATCH, "too many range nodes in one batch");
            // A sender must answer precisely the nodes from the last response. It cannot exploit newly discovered
            // descendants within this batch to bypass the outstanding-request bound.
            let requested: HashSet<_> = incoming
                .queue
                .iter()
                .filter(|p| incoming.wanted.contains_key(*p))
                .take(BATCH)
                .cloned()
                .collect();
            ensure!(n <= requested.len(), "more range nodes than requested");
            for _ in 0..n {
                let mut peek = Read(read.0);
                ensure!(
                    requested.contains(&peek.prefix()?),
                    "a range node was not requested in this batch"
                );
                incoming.part(&mut read)?;
            }
            ensure!(read.0.is_empty(), "trailing range node bytes");
            incoming.at = Instant::now();
        }
        let incoming = self.incoming.get_mut(&connection).expect("begun");
        let answer = incoming.reply();
        if !incoming.wanted.is_empty() {
            return Ok((answer, None));
        }
        let incoming = self.incoming.remove(&connection).expect("complete");
        debug_assert_eq!(incoming.tree.0.summary, expected);
        drop(incoming.base);
        self.remember(false, device, incoming.tree);
        #[cfg(test)]
        {
            self.completed += 1;
        }
        // A concurrent second connection's older round must not overwrite this complete claim later.
        self.incoming.retain(|_, other| other.device != device);
        Ok((
            answer,
            Some(Completed {
                full: incoming.full,
                changes: incoming.changes,
                files: incoming.files,
            }),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::id::{AudienceId, EditId, EntryId, ShareId, VaultId};
    use std::collections::BTreeSet;

    fn device() -> SignerId {
        SignerId::from_u64(7)
    }
    fn log(i: u64) -> LogId {
        match i % 4 {
            0 => LogId::Vault(VaultId::from_u64(i)),
            1 => LogId::Share(ShareId::from_u64(i)),
            2 => LogId::Audience(VaultId::from_u64(i / 4), AudienceId::from_u64(i)),
            _ => LogId::Entry(EntryId::from_u64(i)),
        }
    }
    fn frontier(i: u64) -> Frontier {
        Frontier {
            heads: vec![EditId::from_u64(i)],
            waiting: vec![EditId::from_u64(i + 100_000)],
        }
    }
    fn holdings(n: u64) -> Holdings {
        Holdings {
            logs: (0..n).map(|i| (log(i), frontier(i))).collect(),
            files: BTreeMap::new(),
        }
    }
    fn observed(cache: &mut Cache, holdings: &Holdings) {
        cache.observe(device(), &holdings.since(None).unwrap());
    }
    fn round(
        sender: &mut Cache,
        receiver: &mut Cache,
        held: &mut Holdings,
        want: &Holdings,
        connection: usize,
    ) -> (usize, usize) {
        let tree = sender.offered(device(), want).unwrap();
        let mut body = tree.begin(&want.files).unwrap();
        let (mut bytes, mut messages) = (0, 0);
        loop {
            bytes += body.len();
            messages += 1;
            let (answer, complete) = receiver.receive(connection, device(), &body).unwrap();
            if let Some(complete) = complete {
                complete.apply(held);
            }
            match tree.nodes(&answer).unwrap() {
                None => return (bytes, messages),
                Some(next) => body = next,
            }
            assert!(messages < 4096);
        }
    }

    #[test]
    fn incremental_tree_matches_a_full_rebuild_for_every_insert_remove_and_sparse_frontier_change()
    {
        let mut tree = Tree::default();
        let mut logs = BTreeMap::new();
        // Reordered arrivals, replacements and deletions cross leaf/branch boundaries repeatedly.
        for i in (0..280).map(|i| (i * 113) % 281) {
            logs.insert(log(i), frontier(i));
            tree.0 = set(&tree.0, log(i), Some(frontier(i)), 0);
            assert_eq!(tree.0.summary, build(logs.clone(), 0).summary);
        }
        for i in 0..281 {
            if i % 3 == 0 {
                logs.remove(&log(i));
                tree.0 = set(&tree.0, log(i), None, 0);
            } else {
                logs.insert(log(i), frontier(i + 1_000));
                tree.0 = set(&tree.0, log(i), Some(frontier(i + 1_000)), 0);
            }
            assert_eq!(tree.0.summary, build(logs.clone(), 0).summary);
        }
        for i in 0..281 {
            logs.remove(&log(i));
            tree.0 = set(&tree.0, log(i), None, 0);
            assert_eq!(tree.0.summary, build(logs.clone(), 0).summary);
        }
        assert_eq!(tree.0.summary, empty().summary);
    }

    #[test]
    fn completed_sparse_rounds_match_full_announcement_including_deletion_files_and_reconnect() {
        let mut sender = Cache::default();
        let mut receiver = Cache::default();
        let mut held = Holdings::default();
        let mut want = holdings(3_000);
        let root = FileRoot {
            hash: [9; 32],
            size: 16,
        };
        want.files.insert(root, FileHold::Whole);
        let (full_bytes, _) = round(&mut sender, &mut receiver, &mut held, &want, 1);
        assert_eq!(held, want);
        let (same_bytes, messages) = round(&mut sender, &mut receiver, &mut held, &want, 2);
        assert_eq!(
            messages, 1,
            "reconnecting with unchanged claims exchanges one fingerprint"
        );
        assert!(same_bytes < 256 && full_bytes > same_bytes * 100);
        for i in [0, 313, 997] {
            want.logs.remove(&log(i));
        }
        for i in [16, 498, 2_999, 3_111] {
            want.logs.insert(log(i), frontier(i + 10_000));
        }
        want.files.clear();
        let (sparse_bytes, _) = round(&mut sender, &mut receiver, &mut held, &want, 3);
        assert_eq!(
            held, want,
            "only changed ranges replace the previous complete claim"
        );
        assert!(
            sparse_bytes < full_bytes / 3,
            "{sparse_bytes} sparse bytes versus {full_bytes} for the full tree"
        );
        // A legacy live delta updates the same cached tree before the next root exchange.
        let delta = Announce {
            full: false,
            logs: vec![(log(1), frontier(88_888))],
            files: vec![],
        };
        receiver.observe(device(), &delta);
        held.take(delta);
        want.logs.insert(log(1), frontier(88_888));
        assert_eq!(round(&mut sender, &mut receiver, &mut held, &want, 4).1, 1);
        let empty = Holdings::default();
        assert_eq!(round(&mut sender, &mut receiver, &mut held, &empty, 5).1, 1);
        assert_eq!(
            held, empty,
            "scope contraction withdraws every old log and file"
        );
    }

    #[test]
    fn unfinished_wrong_root_and_duplicate_nodes_never_replace_the_last_complete_claim() {
        let old = holdings(200);
        let mut want = old.clone();
        want.logs.insert(log(7), frontier(999));
        let mut sender = Cache::default();
        let tree = sender.offered(device(), &want).unwrap();
        let begin = tree.begin(&want.files).unwrap();
        let mut receiver = Cache::default();
        observed(&mut receiver, &old);
        let before = receiver.received[&device()].0.summary;
        let (answer, done) = receiver.receive(1, device(), &begin).unwrap();
        assert!(done.is_none());
        assert_eq!(receiver.received[&device()].0.summary, before);
        let node = tree.nodes(&answer).unwrap().unwrap();
        let mut wrong = node.clone();
        wrong[6] ^= 1;
        assert!(receiver.receive(1, device(), &wrong).is_err());
        assert!(!receiver.incoming.contains_key(&1));
        assert_eq!(receiver.received[&device()].0.summary, before);
        let (answer, _) = receiver.receive(1, device(), &begin).unwrap();
        let node = tree.nodes(&answer).unwrap().unwrap();
        let (_, done) = receiver.receive(1, device(), &node).unwrap();
        assert!(
            done.is_none(),
            "root of a large changed tree has unresolved children"
        );
        assert!(
            receiver.receive(1, device(), &node).is_err(),
            "duplicate response is not a second advance"
        );
        assert_eq!(receiver.received[&device()].0.summary, before);
        assert!(
            receiver.receive(1, device(), &node).is_err(),
            "failed staging cannot be resumed"
        );
        let mut held = old;
        round(&mut sender, &mut receiver, &mut held, &want, 1);
        assert_eq!(held, want, "a fresh round recovers after the failure");
    }

    #[test]
    fn two_connections_legacy_updates_expiry_and_close_invalidate_stale_staging() {
        let old = holdings(40);
        let mut sender = Cache::default();
        let tree = sender.offered(device(), &old).unwrap();
        let begin = tree.begin(&old.files).unwrap();
        let mut receiver = Cache::default();
        let (answer, _) = receiver.receive(1, device(), &begin).unwrap();
        let stale = tree.nodes(&answer).unwrap().unwrap();
        let mut held = Holdings::default();
        round(&mut sender, &mut receiver, &mut held, &old, 2);
        assert!(
            receiver.receive(1, device(), &stale).is_err(),
            "another completed connection invalidates an older round"
        );
        let mut next = old.clone();
        next.logs.insert(log(99), frontier(99));
        let tree = sender.offered(device(), &next).unwrap();
        let begin = tree.begin(&next.files).unwrap();
        let (answer, _) = receiver.receive(1, device(), &begin).unwrap();
        let stale = tree.nodes(&answer).unwrap().unwrap();
        observed(&mut receiver, &old);
        assert!(
            receiver.receive(1, device(), &stale).is_err(),
            "a legacy announcement invalidates staging"
        );
        receiver.receive(1, device(), &begin).unwrap();
        receiver.incoming.get_mut(&1).unwrap().at = Instant::now() - IDLE;
        receiver.expire();
        assert!(
            receiver.incoming.is_empty(),
            "maintenance expires an idle connection without another message"
        );
        assert!(
            receiver.receive(1, device(), &stale).is_err(),
            "idle expiry releases staging"
        );
        receiver.receive(1, device(), &begin).unwrap();
        receiver.gone(1, device(), false);
        assert!(
            receiver.receive(1, device(), &stale).is_err(),
            "disconnect releases staging"
        );
        assert_eq!(
            receiver.received[&device()].0.summary,
            build(old.logs, 0).summary
        );
        receiver.receive(1, device(), &begin).unwrap();
        receiver.receive(2, device(), &begin).unwrap();
        receiver.gone(1, device(), true);
        assert!(
            receiver.incoming.is_empty() && receiver.received.is_empty(),
            "forgetting an unknown device invalidates every candidate based on its previous claim"
        );
    }

    #[test]
    fn malformed_prefixes_truncations_hashes_sizes_and_excess_sessions_are_bounded() {
        let mut sender = Cache::default();
        let want = holdings(300);
        let tree = sender.offered(device(), &want).unwrap();
        let begin = tree.begin(&want.files).unwrap();
        let mut receiver = Cache::default();
        let (answer, _) = receiver.receive(1, device(), &begin).unwrap();
        let root = tree.nodes(&answer).unwrap().unwrap();
        for n in 0..begin.len() {
            assert!(
                Cache::default().receive(1, device(), &begin[..n]).is_err(),
                "truncated begin at {n}"
            );
        }
        for n in 0..root.len() {
            let mut receiver = Cache::default();
            receiver.receive(1, device(), &begin).unwrap();
            assert!(
                receiver.receive(1, device(), &root[..n]).is_err(),
                "truncated node at {n}"
            );
            assert!(!receiver.incoming.contains_key(&1));
            assert!(!receiver.received.contains_key(&device()));
        }
        for i in 0..root.len() {
            let mut changed = root.clone();
            changed[i] ^= 0x80;
            let mut receiver = Cache::default();
            receiver.receive(1, device(), &begin).unwrap();
            assert!(
                receiver.receive(1, device(), &changed).is_err(),
                "tampered root byte {i}"
            );
            assert!(!receiver.received.contains_key(&device()));
        }
        let mut excessive = begin.clone();
        excessive[2..6].copy_from_slice(&((MOST + 1) as u32).to_be_bytes());
        assert!(Cache::default().receive(1, device(), &excessive).is_err());
        let mut receiver = Cache::default();
        for connection in 0..SESSIONS {
            receiver
                .receive(connection, SignerId::from_u64(connection as u64), &begin)
                .unwrap();
        }
        assert!(receiver.receive(SESSIONS, device(), &begin).is_err());
        receiver.gone(0, SignerId::from_u64(0), true);
        assert!(receiver.receive(SESSIONS, device(), &begin).is_ok());
    }

    #[test]
    fn reordered_requested_nodes_converge_but_byte_and_node_budgets_abort_atomically() {
        fn reversed(bytes: &[u8]) -> Vec<u8> {
            let mut read = Read(bytes);
            assert_eq!((read.byte().unwrap(), read.byte().unwrap()), (VERSION, 1));
            read.summary().unwrap();
            let count = read.byte().unwrap();
            let header = bytes.len() - read.0.len();
            let mut parts = Vec::new();
            for _ in 0..count {
                let start = bytes.len() - read.0.len();
                read.prefix().unwrap();
                match read.byte().unwrap() {
                    0 => {}
                    1 => {
                        let n = read.count().unwrap() as usize;
                        read.take(n).unwrap();
                    }
                    2 => {
                        for _ in 0..16 {
                            read.summary().unwrap();
                        }
                    }
                    _ => unreachable!(),
                }
                parts.push(&bytes[start..bytes.len() - read.0.len()]);
            }
            assert!(read.0.is_empty());
            let mut out = bytes[..header].to_vec();
            for part in parts.into_iter().rev() {
                out.extend_from_slice(part);
            }
            out
        }
        let want = holdings(1_000);
        let mut sender = Cache::default();
        let tree = sender.offered(device(), &want).unwrap();
        let begin = tree.begin(&want.files).unwrap();
        let mut receiver = Cache::default();
        let (mut answer, _) = receiver.receive(1, device(), &begin).unwrap();
        let mut held = Holdings::default();
        while let Some(next) = tree.nodes(&answer).unwrap() {
            let (reply, completed) = receiver.receive(1, device(), &reversed(&next)).unwrap();
            answer = reply;
            if let Some(completed) = completed {
                completed.apply(&mut held);
            }
        }
        assert_eq!(
            held, want,
            "independently requested siblings may arrive in either order"
        );
        for byte_limit in [true, false] {
            let mut receiver = Cache::default();
            let (answer, _) = receiver.receive(1, device(), &begin).unwrap();
            if byte_limit {
                receiver.incoming.get_mut(&1).unwrap().bytes = STAGED;
            } else {
                receiver.incoming.get_mut(&1).unwrap().nodes = NODES;
            }
            assert!(
                receiver
                    .receive(1, device(), &tree.nodes(&answer).unwrap().unwrap())
                    .is_err()
            );
            assert!(
                receiver.incoming.is_empty() && receiver.received.is_empty(),
                "budget exhaustion commits no claim"
            );
        }
    }

    #[test]
    fn outgoing_roots_contain_only_the_previously_authorized_peer_scope() {
        let all = holdings(700);
        let allowed = all.logs.keys().step_by(7).copied().collect();
        let visible = all.only(&allowed, &BTreeSet::new());
        let mut sender = Cache::default();
        // A previous, broader scope must leave no fingerprints behind after its permission contracts.
        sender.offered(device(), &all).unwrap();
        let mut held = Holdings::default();
        round(&mut sender, &mut Cache::default(), &mut held, &visible, 1);
        assert_eq!(held, visible);
        assert_eq!(
            sender.offered[&device()].0.summary,
            build(visible.logs, 0).summary
        );
    }

    #[test]
    fn retained_indexes_bound_peer_entries_and_charge_snapshots_after_eviction() {
        let mut cache = Cache::default();
        let small = holdings(32);
        for n in 0..100 {
            let peer = SignerId::from_u64(1000 + n);
            cache.observe(peer, &small.since(None).unwrap());
            cache.offered(peer, &small).unwrap();
            assert!(cache.offered.len() + cache.received.len() <= RETAINED_TREES);
            assert!(cache.retained.load(Ordering::Relaxed) <= RETAINED_BYTES);
        }
        let used = cache.retained.clone();
        drop(cache);
        assert_eq!(used.load(Ordering::Relaxed), 0);

        let mut cache = Cache::default();
        let mut large = holdings(1);
        large.logs.values_mut().next().unwrap().waiting = (0..RETAINED_BYTES / (3 * 64))
            .map(|n| avendb::id::EditId::from_u64(n as u64))
            .collect();
        let first = cache.offered(SignerId::from_u64(1), &large).unwrap();
        let second = cache.offered(SignerId::from_u64(2), &large).unwrap();
        assert!(
            cache.offered(SignerId::from_u64(3), &large).is_err(),
            "active snapshots prevent admission even when their map entries are evicted"
        );
        assert!(cache.offered.is_empty());
        assert!(cache.retained.load(Ordering::Relaxed) <= RETAINED_BYTES);
        drop(first);
        assert!(
            cache.offered(SignerId::from_u64(3), &large).is_ok(),
            "the last snapshot reader releases its byte charge"
        );
        let used = cache.retained.clone();
        drop(cache);
        assert!(
            used.load(Ordering::Relaxed) > 0,
            "the second snapshot still exists"
        );
        drop(second);
        assert_eq!(used.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn evicted_receive_baselines_replace_all_logs_and_deltas_do_not_seed_partial_trees() {
        let (mut sender, mut receiver, mut held) =
            (Cache::default(), Cache::default(), Holdings::default());
        let old = holdings(150);
        round(&mut sender, &mut receiver, &mut held, &old, 1);
        let evict = |receiver: &mut Cache| {
            for n in 0..RETAINED_TREES {
                receiver.observe(
                    SignerId::from_u64(1000 + n as u64),
                    &holdings(1).since(None).unwrap(),
                );
            }
            assert!(!receiver.received.contains_key(&device()));
        };
        evict(&mut receiver);
        let delta = Announce {
            full: false,
            logs: old
                .logs
                .iter()
                .take(1)
                .map(|(l, f)| (*l, f.clone()))
                .collect(),
            files: vec![],
        };
        receiver.observe(device(), &delta);
        held.take(delta);
        assert!(
            !receiver.received.contains_key(&device()),
            "a delta cannot reconstruct an evicted complete claim"
        );
        let mut next = holdings(151);
        for log in old.logs.keys().take(75) {
            next.logs.remove(log);
        }
        round(&mut sender, &mut receiver, &mut held, &next, 2);
        assert_eq!(
            held, next,
            "a cold round removes stale logs from the actual held map"
        );

        // Eviction during an active round is safe too: that round retains and charges its complete old baseline.
        let mut last = next.clone();
        for log in next.logs.keys().take(5) {
            last.logs.remove(log);
        }
        let tree = sender.offered(device(), &last).unwrap();
        let (mut answer, complete) = receiver
            .receive(3, device(), &tree.begin(&last.files).unwrap())
            .unwrap();
        assert!(complete.is_none());
        evict(&mut receiver);
        while let Some(body) = tree.nodes(&answer).unwrap() {
            let (reply, complete) = receiver.receive(3, device(), &body).unwrap();
            answer = reply;
            if let Some(complete) = complete {
                complete.apply(&mut held);
            }
        }
        assert_eq!(
            held, last,
            "the pinned baseline still makes the patch correct after cache eviction"
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn connected_nodes_use_ranges_and_reconnect_without_losing_authorized_holdings() {
        use crate::{Node, Options};
        use avendb::cast::{handbook_ready, world};
        let mut world = world();
        handbook_ready(&mut world);
        let (mac_id, passkey, server_id) = (world.mac_a, world.passkey_a, world.server);
        let opts = || Options {
            lazy: true,
            ..Options::local()
        };
        let mac = Node::spawn(
            world.lab.split(mac_id, &[passkey], [21; 32]),
            mac_id,
            opts(),
        )
        .await
        .unwrap();
        let server = Node::spawn(world.lab.split(server_id, &[], [22; 32]), server_id, opts())
            .await
            .unwrap();
        mac.know(server.addr());
        server.know(mac.addr());
        let until = Instant::now() + Duration::from_secs(30);
        loop {
            let announced = server.shared.ranges.lock().unwrap().announced;
            if announced > 0 && server.holdings_of(mac_id).is_some() {
                break;
            }
            assert!(
                Instant::now() < until,
                "first contact uses one full announcement"
            );
            n0_future::time::sleep(Duration::from_millis(20)).await;
        }
        let allowed: BTreeSet<_> = mac
            .shared
            .lab(move |lab, me| {
                lab.announce(me, server_id)
                    .into_iter()
                    .map(|(log, _)| log)
                    .collect()
            })
            .await;
        let expected = mac.holdings().await.only(&allowed, &BTreeSet::new());
        assert_eq!(server.holdings_of(mac_id), Some(expected.clone()));
        assert!(
            mac.shared.ranges.lock().unwrap().unsupported.is_empty(),
            "capable peers never fell back silently"
        );
        let completed = server.shared.ranges.lock().unwrap().completed;
        if let Some(peer) = mac.shared.live(server.id()) {
            peer.conn.close(crate::session::REFUSED, b"test reconnect");
        }
        // An idle node does not redial solely to repeat unchanged holdings; reconnect as a foreground request
        // would, then require a fresh authenticated root exchange on that connection.
        mac.shared.connection(server.id()).await.unwrap();
        let until = Instant::now() + Duration::from_secs(30);
        loop {
            let complete = server.shared.ranges.lock().unwrap().completed;
            if complete > completed {
                break;
            }
            assert!(
                Instant::now() < until,
                "a new connection completes another root exchange"
            );
            n0_future::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(server.holdings_of(mac_id), Some(expected));
        assert!(mac.shared.ranges.lock().unwrap().unsupported.is_empty());
        mac.shutdown().await.unwrap();
        server.shutdown().await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_legacy_peer_refuses_one_cached_range_reoffer_then_gets_original_announcements() {
        use crate::{ALPN, Node, Options, exporter, pq_provider, session};
        use avendb::cast::{handbook_ready, world};
        use iroh::endpoint::{Connection, SendStream, presets};
        use iroh::{Endpoint, SecretKey};
        async fn message(conn: &Connection) -> (u8, Vec<u8>, SendStream) {
            loop {
                let (mut send, mut recv) =
                    n0_future::time::timeout(Duration::from_secs(15), conn.accept_bi())
                        .await
                        .unwrap()
                        .unwrap();
                let wire = recv.read_to_end(LIMIT).await.unwrap();
                let (&kind, body) = wire.split_first().unwrap();
                if kind == session::STATE {
                    send.finish().unwrap();
                    continue;
                }
                return (kind, body.to_vec(), send);
            }
        }
        let mut world = world();
        handbook_ready(&mut world);
        let (mac_id, passkey, old_id) = (world.mac_a, world.passkey_a, world.server);
        let secret = SecretKey::from_bytes(&world.lab.endpoint_secret(old_id).unwrap());
        let raw = Endpoint::builder(presets::Empty)
            .secret_key(secret)
            .crypto_provider(pq_provider())
            .clear_ip_transports()
            .bind_addr("127.0.0.1:0")
            .unwrap()
            .bind()
            .await
            .unwrap();
        let mac = Node::spawn(
            world.lab.split(mac_id, &[passkey], [23; 32]),
            mac_id,
            Options {
                lazy: true,
                ..Options::local()
            },
        )
        .await
        .unwrap();
        let conn = raw.connect(mac.addr(), ALPN).await.unwrap();
        let exporter = exporter(&conn).unwrap();
        let (mut send, mut recv) = conn.open_bi().await.unwrap();
        send.write_all(&world.lab.hello(old_id, &exporter, true).unwrap().to_wire())
            .await
            .unwrap();
        send.finish().unwrap();
        let hello =
            avendb::sign::Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
        assert_eq!(
            hello.verify(&exporter, false, mac.id().as_bytes()),
            Some(mac_id)
        );
        let (kind, body, mut send) = message(&conn).await;
        assert_eq!(
            kind,
            session::ANNOUNCE,
            "no capability probe delays first contact"
        );
        let expected = Announce::from_wire(&body).unwrap();
        assert!(expected.full);
        send.finish().unwrap();
        let until = Instant::now() + Duration::from_secs(15);
        while !mac.shared.told.lock().unwrap().contains_key(&old_id) {
            assert!(Instant::now() < until);
            n0_future::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(mac.shared.ranges.lock().unwrap().has_offered(old_id));
        mac.shared.told.lock().unwrap().remove(&old_id);
        mac.shared.changed.notify_one();
        let (kind, _, mut send) = message(&conn).await;
        assert_eq!(
            kind,
            session::RANGES,
            "a cached full reoffer tries sparse reconciliation"
        );
        send.reset(session::REFUSED).unwrap();
        let (kind, body, mut send) = message(&conn).await;
        assert_eq!(kind, session::ANNOUNCE);
        assert_eq!(
            Announce::from_wire(&body).unwrap(),
            expected,
            "fallback uses the original full wire"
        );
        send.finish().unwrap();
        let until = Instant::now() + Duration::from_secs(15);
        while !mac.shared.told.lock().unwrap().contains_key(&old_id) {
            assert!(Instant::now() < until);
            n0_future::time::sleep(Duration::from_millis(10)).await;
        }
        mac.shared.told.lock().unwrap().remove(&old_id);
        mac.shared.changed.notify_one();
        let (kind, body, mut send) = message(&conn).await;
        assert_eq!(
            kind,
            session::ANNOUNCE,
            "the same legacy connection is not probed again"
        );
        assert_eq!(Announce::from_wire(&body).unwrap(), expected);
        send.finish().unwrap();
        conn.close(session::REFUSED, b"test done");
        raw.close().await;
        mac.shutdown().await.unwrap();
    }
}
