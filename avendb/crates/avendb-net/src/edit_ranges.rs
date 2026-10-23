//! Directional reconciliation of an already-authorized set of edit IDs. These fingerprints never authorize an
//! edit. Production FETCH must separately check a durable published signer-root path, then ordinary signatures.
//! `EditRanges.lean` describes missing-set acceptance and stale/scope/evidence rejection. The final legacy pull
//! remains mandatory: the first production slice covers only the serving device's durable own-signer records.
//!
//! Compressed radix-16 branches avoid a chain of 64 single-child allocations for adversarial shared prefixes.
//! Every subtree lookup touches at most 64 branch decisions or 16 leaf IDs. Initial construction/replacement and
//! persisted-summary encoding remain O(n); this module makes no incremental-update throughput claim.

use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use anyhow::{Result, anyhow, ensure};
use avendb::id::EditId;
use bao_tree::blake3;

pub(crate) const KIND: u8 = 16;
pub(crate) const CONTROL_BYTES: usize = 1 << 20;
pub(crate) const ROUND_CONTROL_BYTES: usize = 16 << 20;
pub(crate) const ROUND_FETCH_BYTES: usize = 64 << 20;
pub(crate) const MAX_QUERIES: usize = 4096;
pub(crate) const MAX_LEAVES: usize = 65_536;
pub(crate) const FETCH_IDS: usize = 256;
pub(crate) const QUERY_NODES: usize = 32;
pub(crate) const LEAF_IDS: usize = 16;
pub(crate) const SUMMARY_BYTES: usize = 4 << 20;
pub(crate) const RETAINED_BYTES: usize = if cfg!(target_arch = "wasm32") {
    4 << 20
} else {
    16 << 20
};
pub(crate) type Prefix = Vec<u8>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Summary {
    pub(crate) hash: [u8; 32],
    pub(crate) count: u32,
}
impl Summary {
    pub(crate) fn empty() -> Self {
        Block::Leaf(Vec::new()).summary()
    }
    pub(crate) fn validate(self) -> Result<()> {
        ensure!(self.count as usize <= MAX_LEAVES, "range leaf count");
        ensure!(
            self.count != 0 || self == Self::empty(),
            "noncanonical empty range"
        );
        Ok(())
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Block {
    Leaf(Vec<EditId>),
    Branch {
        skip: Prefix,
        children: [Summary; 16],
    },
}
impl Block {
    pub(crate) fn summary(&self) -> Summary {
        let mut hash = blake3::Hasher::new();
        hash.update(b"avenDB proof edit range 1\n");
        let count = match self {
            Self::Leaf(ids) => {
                hash.update(&[0]);
                hash.update(&(ids.len() as u32).to_be_bytes());
                for id in ids {
                    hash.update(&id.0);
                }
                ids.len() as u32
            }
            Self::Branch { skip, children } => {
                hash.update(&[1, skip.len() as u8]);
                hash.update(skip);
                for child in children {
                    hash.update(&child.count.to_be_bytes());
                    hash.update(&child.hash);
                }
                children
                    .iter()
                    .fold(0u32, |n, child| n.saturating_add(child.count))
            }
        };
        Summary {
            hash: hash.finalize().into(),
            count,
        }
    }
    pub(crate) fn validate(&self, prefix: &[u8]) -> Result<()> {
        valid_prefix(prefix)?;
        match self {
            Self::Leaf(ids) => {
                ensure!(
                    ids.len() <= LEAF_IDS && ordered(ids),
                    "noncanonical range leaf"
                );
                ensure!(
                    ids.iter().all(|id| matches(id, prefix)),
                    "leaf outside requested range"
                );
            }
            Self::Branch { skip, children } => {
                valid_prefix(skip)?;
                ensure!(prefix.len() + skip.len() < 64, "range depth");
                ensure!(
                    children.iter().filter(|c| c.count != 0).count() >= 2,
                    "uncompressed range branch"
                );
                for child in children {
                    child.validate()?;
                }
                let count: u64 = children.iter().map(|c| c.count as u64).sum();
                ensure!(
                    count > LEAF_IDS as u64 && count <= MAX_LEAVES as u64,
                    "range branch count"
                );
            }
        }
        Ok(())
    }
    pub(crate) fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Self::Leaf(ids) => {
                out.extend([0, ids.len() as u8]);
                for id in ids {
                    out.extend(id.0);
                }
            }
            Self::Branch { skip, children } => {
                out.extend([1, skip.len() as u8]);
                out.extend(skip);
                for child in children {
                    out.extend(child.count.to_be_bytes());
                    out.extend(child.hash);
                }
            }
        }
    }
    pub(crate) fn decode(bytes: &mut &[u8], prefix: &[u8]) -> Result<Self> {
        let tag = take::<1>(bytes)?[0];
        let n = take::<1>(bytes)?[0] as usize;
        let block = match tag {
            0 => {
                ensure!(n <= LEAF_IDS && bytes.len() >= n * 32, "range leaf size");
                let mut ids = Vec::with_capacity(n);
                for _ in 0..n {
                    ids.push(EditId(take(bytes)?));
                }
                Self::Leaf(ids)
            }
            1 => {
                ensure!(n < 64 && bytes.len() >= n + 16 * 36, "range branch size");
                let skip = bytes[..n].to_vec();
                *bytes = &bytes[n..];
                let mut children = [Summary::empty(); 16];
                for child in &mut children {
                    child.count = u32::from_be_bytes(take(bytes)?);
                    child.hash = take(bytes)?;
                }
                Self::Branch { skip, children }
            }
            _ => return Err(anyhow!("range block version")),
        };
        block.validate(prefix)?;
        Ok(block)
    }
}
fn take<const N: usize>(bytes: &mut &[u8]) -> Result<[u8; N]> {
    ensure!(bytes.len() >= N, "truncated edit range");
    let (front, rest) = bytes.split_at(N);
    *bytes = rest;
    Ok(front.try_into().expect("length checked"))
}
fn ordered(ids: &[EditId]) -> bool {
    ids.windows(2).all(|pair| pair[0] < pair[1])
}
fn nibble(id: &EditId, at: usize) -> u8 {
    if at % 2 == 0 {
        id.0[at / 2] >> 4
    } else {
        id.0[at / 2] & 15
    }
}
fn matches(id: &EditId, prefix: &[u8]) -> bool {
    prefix
        .iter()
        .enumerate()
        .all(|(at, b)| nibble(id, at) == *b)
}
fn valid_prefix(prefix: &[u8]) -> Result<()> {
    ensure!(
        prefix.len() <= 64 && prefix.iter().all(|b| *b < 16),
        "invalid edit range prefix"
    );
    Ok(())
}

#[derive(Clone)]
pub(crate) struct Budget {
    used: Arc<AtomicUsize>,
    limit: usize,
}
impl Default for Budget {
    fn default() -> Self {
        Self::new(RETAINED_BYTES)
    }
}
impl Budget {
    pub(crate) fn new(limit: usize) -> Self {
        Self {
            used: Arc::default(),
            limit,
        }
    }
    pub(crate) fn reserve(&self, bytes: usize) -> Result<Charge> {
        self.used
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(bytes).filter(|n| *n <= self.limit)
            })
            .map_err(|_| anyhow!("edit range retained budget"))?;
        Ok(Charge {
            used: self.used.clone(),
            bytes,
            limit: self.limit,
        })
    }
    #[cfg(test)]
    pub(crate) fn used(&self) -> usize {
        self.used.load(Ordering::Acquire)
    }
}
pub(crate) struct Charge {
    used: Arc<AtomicUsize>,
    bytes: usize,
    limit: usize,
}
impl Charge {
    fn grow(&mut self, bytes: usize) -> Result<()> {
        self.used
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |used| {
                used.checked_add(bytes).filter(|n| *n <= self.limit)
            })
            .map_err(|_| anyhow!("edit range work budget"))?;
        self.bytes += bytes;
        Ok(())
    }
}
impl Drop for Charge {
    fn drop(&mut self) {
        self.used.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

struct Node {
    summary: Summary,
    kind: NodeKind,
}
enum NodeKind {
    Leaf(Range<usize>),
    Branch {
        skip: Prefix,
        children: [Option<Box<Node>>; 16],
    },
}
pub(crate) struct Tree {
    ids: Vec<EditId>,
    root: Node,
    _charge: Charge,
}
impl Tree {
    /// Reserve for the input IDs, compressed nodes and hash tables before building. At most two nodes per leaf,
    /// each conservatively charged 256 bytes, plus the owned input capacity. Active Arc readers keep this charge.
    pub(crate) fn new(ids: Vec<EditId>, budget: &Budget) -> Result<Self> {
        ensure!(
            ids.len() <= MAX_LEAVES && ordered(&ids),
            "noncanonical edit range set"
        );
        let charge = budget.reserve(
            ids.capacity()
                .saturating_mul(32)
                .saturating_add(ids.len().saturating_mul(512))
                .saturating_add(1024),
        )?;
        Self::charged(ids, charge)
    }
    fn charged(ids: Vec<EditId>, charge: Charge) -> Result<Self> {
        ensure!(
            ids.len() <= MAX_LEAVES && ordered(&ids),
            "noncanonical edit range set"
        );
        let root = build(&ids, 0..ids.len(), 0);
        Ok(Self {
            ids,
            root,
            _charge: charge,
        })
    }
    pub(crate) fn root(&self) -> Summary {
        self.root.summary
    }
    pub(crate) fn contains(&self, id: EditId) -> bool {
        self.ids.binary_search(&id).is_ok()
    }
    pub(crate) fn ids(&self) -> &[EditId] {
        &self.ids
    }
    pub(crate) fn block(&self, prefix: &[u8]) -> Result<Block> {
        valid_prefix(prefix)?;
        Ok(block(&self.root, &self.ids, prefix, 0))
    }
    /// Canonical persisted summary: IDs plus every cached subtree fingerprint, not an authority record. Its
    /// caller must encrypt and bind it to the exact complete durable history, engine, scope, peer and published signer root.
    pub(crate) fn encode(&self) -> Result<Vec<u8>> {
        let mut out = b"avenDB edit summary 1\n".to_vec();
        out.extend((self.ids.len() as u32).to_be_bytes());
        for id in &self.ids {
            out.extend(id.0);
        }
        encode_nodes(&self.root, &mut out);
        ensure!(out.len() <= SUMMARY_BYTES, "persisted range summary size");
        Ok(out)
    }
    pub(crate) fn decode(bytes: &[u8], budget: &Budget) -> Result<Self> {
        const MAGIC: &[u8] = b"avenDB edit summary 1\n";
        ensure!(
            bytes.len() <= SUMMARY_BYTES && bytes.starts_with(MAGIC),
            "persisted range summary version or size"
        );
        let mut rest = &bytes[MAGIC.len()..];
        let n = u32::from_be_bytes(take(&mut rest)?) as usize;
        ensure!(
            n <= MAX_LEAVES && rest.len() >= n * 32,
            "persisted range IDs"
        );
        // Reject the allocation before reserving an untrusted count of decoded objects.
        let charge = budget.reserve(n.saturating_mul(544).saturating_add(1024))?;
        let mut ids = Vec::with_capacity(n);
        for _ in 0..n {
            ids.push(EditId(take(&mut rest)?));
        }
        let tree = Self::charged(ids, charge)?;
        check_nodes(&tree.root, &mut rest)?;
        ensure!(rest.is_empty(), "trailing persisted range fingerprints");
        Ok(tree)
    }
}
fn build(ids: &[EditId], range: Range<usize>, depth: usize) -> Node {
    if range.len() <= LEAF_IDS {
        let summary = Block::Leaf(ids[range.clone()].to_vec()).summary();
        return Node {
            summary,
            kind: NodeKind::Leaf(range),
        };
    }
    let mut at = depth;
    while nibble(&ids[range.start], at) == nibble(&ids[range.end - 1], at) {
        at += 1;
    }
    let skip: Prefix = (depth..at).map(|i| nibble(&ids[range.start], i)).collect();
    let mut children: [Option<Box<Node>>; 16] = std::array::from_fn(|_| None);
    let mut start = range.start;
    while start < range.end {
        let b = nibble(&ids[start], at);
        let end = start + ids[start..range.end].partition_point(|id| nibble(id, at) == b);
        children[b as usize] = Some(Box::new(build(ids, start..end, at + 1)));
        start = end;
    }
    let summaries =
        std::array::from_fn(|i| children[i].as_ref().map_or(Summary::empty(), |n| n.summary));
    let summary = Block::Branch {
        skip: skip.clone(),
        children: summaries,
    }
    .summary();
    Node {
        summary,
        kind: NodeKind::Branch { skip, children },
    }
}
fn block(node: &Node, ids: &[EditId], prefix: &[u8], depth: usize) -> Block {
    match &node.kind {
        NodeKind::Leaf(range) => Block::Leaf(
            ids[range.clone()]
                .iter()
                .filter(|id| matches(id, prefix))
                .copied()
                .collect(),
        ),
        NodeKind::Branch { skip, children } => {
            let needed = prefix.len().saturating_sub(depth);
            let common = needed.min(skip.len());
            if prefix[depth..depth + common] != skip[..common] {
                return Block::Leaf(vec![]);
            }
            if needed <= skip.len() {
                return Block::Branch {
                    skip: skip[needed..].to_vec(),
                    children: std::array::from_fn(|i| {
                        children[i].as_ref().map_or(Summary::empty(), |n| n.summary)
                    }),
                };
            }
            match &children[prefix[depth + skip.len()] as usize] {
                Some(child) => block(child, ids, prefix, depth + skip.len() + 1),
                None => Block::Leaf(vec![]),
            }
        }
    }
}
fn encode_nodes(node: &Node, out: &mut Vec<u8>) {
    out.extend(node.summary.count.to_be_bytes());
    out.extend(node.summary.hash);
    match &node.kind {
        NodeKind::Leaf(_) => out.push(0),
        NodeKind::Branch { skip, children } => {
            out.extend([1, skip.len() as u8]);
            out.extend(skip);
            for child in children {
                out.push(child.is_some() as u8);
                if let Some(child) = child {
                    encode_nodes(child, out);
                }
            }
        }
    }
}

/// Compare the cached preorder without allocating a second encoded tree during bounded cold reads.
fn check_nodes(node: &Node, bytes: &mut &[u8]) -> Result<()> {
    ensure!(
        u32::from_be_bytes(take(bytes)?) == node.summary.count
            && take::<32>(bytes)? == node.summary.hash,
        "persisted range fingerprint"
    );
    match &node.kind {
        NodeKind::Leaf(_) => ensure!(take::<1>(bytes)? == [0], "persisted leaf shape"),
        NodeKind::Branch { skip, children } => {
            ensure!(
                take::<2>(bytes)? == [1, skip.len() as u8] && bytes.starts_with(skip),
                "persisted branch shape"
            );
            *bytes = &bytes[skip.len()..];
            for child in children {
                ensure!(
                    take::<1>(bytes)? == [child.is_some() as u8],
                    "persisted branch presence"
                );
                if let Some(child) = child {
                    check_nodes(child, bytes)?;
                }
            }
        }
    }
    Ok(())
}

/// Bounded reconciliation work. Node responses are accepted once, only against the expected offered hash and
/// prefix; ordering between requested nodes does not matter. Only IDs actually absent locally enter `missing`.
pub(crate) struct Round {
    pending: BTreeMap<Prefix, Summary>,
    waiting: BTreeMap<Prefix, Summary>,
    missing: BTreeSet<EditId>,
    queries: usize,
    charge: Charge,
}
/// Carries the allocation reservation through fetching and validation, including caller cancellation.
pub(crate) struct Missing {
    ids: BTreeSet<EditId>,
    _charge: Charge,
}
impl Missing {
    pub(crate) fn ids(&self) -> &BTreeSet<EditId> {
        &self.ids
    }
}
impl Round {
    pub(crate) fn new(root: Summary, budget: &Budget) -> Result<Self> {
        root.validate()?;
        Ok(Self {
            pending: [(Vec::new(), root)].into(),
            waiting: BTreeMap::new(),
            missing: BTreeSet::new(),
            queries: 0,
            charge: budget.reserve(8192)?,
        })
    }
    pub(crate) fn next(&mut self, local: &Tree) -> Result<Vec<Prefix>> {
        ensure!(self.waiting.is_empty(), "edit range responses pending");
        let mut ask = Vec::new();
        while ask.len() < QUERY_NODES {
            let Some((prefix, expected)) = self.pending.pop_first() else {
                break;
            };
            if local.block(&prefix)?.summary() == expected {
                continue;
            }
            self.queries += 1;
            ensure!(self.queries <= MAX_QUERIES, "edit range query budget");
            self.waiting.insert(prefix.clone(), expected);
            ask.push(prefix);
        }
        Ok(ask)
    }
    pub(crate) fn accept(&mut self, prefix: Prefix, value: Block, local: &Tree) -> Result<()> {
        value.validate(&prefix)?;
        let expected = self
            .waiting
            .get(&prefix)
            .ok_or_else(|| anyhow!("unsolicited edit range node"))?;
        ensure!(value.summary() == *expected, "edit range root mismatch");
        match value {
            Block::Leaf(ids) => {
                for id in ids {
                    if !local.contains(id) && !self.missing.contains(&id) {
                        self.charge.grow(96)?;
                        self.missing.insert(id);
                    }
                }
                ensure!(
                    self.missing.len() <= MAX_LEAVES,
                    "edit range missing budget"
                );
            }
            Block::Branch { skip, children } => {
                for (i, child) in children
                    .into_iter()
                    .enumerate()
                    .filter(|(_, child)| child.count > 0)
                {
                    let mut path = prefix.clone();
                    path.extend(&skip);
                    path.push(i as u8);
                    ensure!(
                        !self.pending.contains_key(&path) && !self.waiting.contains_key(&path),
                        "duplicate edit range child"
                    );
                    self.charge.grow(256)?;
                    self.pending.insert(path, child);
                }
                ensure!(
                    self.pending.len() + self.waiting.len() <= MAX_QUERIES,
                    "edit range work queue budget"
                );
            }
        }
        self.waiting.remove(&prefix);
        Ok(())
    }
    pub(crate) fn finish(self) -> Result<Missing> {
        ensure!(
            self.pending.is_empty() && self.waiting.is_empty(),
            "unfinished edit range"
        );
        Ok(Missing {
            ids: self.missing,
            _charge: self.charge,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn id(n: u64) -> EditId {
        EditId(blake3::hash(&n.to_be_bytes()).into())
    }
    fn tree(ids: impl IntoIterator<Item = EditId>) -> Tree {
        Tree::new(
            ids.into_iter()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect(),
            &Budget::new(64 << 20),
        )
        .unwrap()
    }
    fn reconcile(local: &Tree, remote: &Tree) -> BTreeSet<EditId> {
        let mut round = Round::new(remote.root(), &Budget::default()).unwrap();
        loop {
            let mut ask = round.next(local).unwrap();
            if ask.is_empty() {
                break;
            }
            ask.reverse(); // reordered independent replies preserve the same result
            for prefix in ask {
                round
                    .accept(prefix.clone(), remote.block(&prefix).unwrap(), local)
                    .unwrap();
            }
        }
        round.finish().unwrap().ids().clone()
    }
    #[test]
    fn sparse_gaps_extras_and_withdrawals_equal_slow_set_difference() {
        for size in [0, 1, 16, 17, 257, 4096] {
            let original: BTreeSet<_> = (0..size).map(id).collect();
            for step in [2, 7, 37] {
                let local_ids: BTreeSet<_> = (0..size)
                    .filter(|n| n % step != 0)
                    .map(id)
                    .chain([id(10_000)])
                    .collect();
                let remote_ids: BTreeSet<_> = original
                    .iter()
                    .enumerate()
                    .filter(|(n, _)| n % 11 != 0)
                    .map(|(_, id)| *id)
                    .collect();
                let (local, remote) = (
                    tree(local_ids.iter().copied()),
                    tree(remote_ids.iter().copied()),
                );
                assert_eq!(
                    reconcile(&local, &remote),
                    remote_ids.difference(&local_ids).copied().collect()
                );
                assert!(
                    local.contains(id(10_000)),
                    "absence remotely never deletes local history"
                );
                assert!(reconcile(&remote, &remote).is_empty());
            }
        }
    }
    #[test]
    fn common_prefixes_are_compressed_and_queries_match_rebuilt_reference() {
        let ids: Vec<_> = (0..100u16)
            .map(|n| {
                let mut bytes = [42; 32];
                bytes[30..].copy_from_slice(&n.to_be_bytes());
                EditId(bytes)
            })
            .collect();
        let full = tree(ids.clone());
        assert!(full.encode().unwrap().len() < 6000);
        for depth in 0..=64 {
            let prefix: Vec<_> = (0..depth).map(|n| nibble(&ids[0], n)).collect();
            let reference = tree(ids.iter().filter(|id| matches(id, &prefix)).copied());
            // A subtree uses a prefix-relative compressed path; compare the same range in the rebuilt tree.
            assert_eq!(
                full.block(&prefix).unwrap().summary(),
                reference.block(&prefix).unwrap().summary()
            );
        }
    }
    #[test]
    fn blocks_reject_noncanonical_shapes_wrong_ranges_and_every_truncation() {
        let remote = tree((0..257).map(id));
        let mut pending = vec![Vec::new()];
        while let Some(prefix) = pending.pop() {
            let block = remote.block(&prefix).unwrap();
            let mut encoded = Vec::new();
            block.encode(&mut encoded);
            for n in 0..encoded.len() {
                assert!(Block::decode(&mut &encoded[..n], &prefix).is_err());
            }
            let mut bytes = encoded.as_slice();
            assert_eq!(Block::decode(&mut bytes, &prefix).unwrap(), block);
            assert!(bytes.is_empty());
            if let Block::Branch { skip, children } = block {
                for (i, _) in children.iter().enumerate().filter(|(_, c)| c.count > 0) {
                    let mut path = prefix.clone();
                    path.extend(&skip);
                    path.push(i as u8);
                    pending.push(path);
                }
            }
        }
        assert!(Block::Leaf(vec![id(1), id(1)]).validate(&[]).is_err());
        assert!(Block::Leaf(vec![id(1)]).validate(&[16]).is_err());
        let mut wrong: Prefix = (0..64).map(|n| nibble(&id(1), n)).collect();
        wrong[63] ^= 1;
        assert!(Block::Leaf(vec![id(1)]).validate(&wrong).is_err());
    }
    #[test]
    fn duplicate_tampered_and_unrequested_nodes_never_complete() {
        let local = tree([]);
        let remote = tree((0..100).map(id));
        let mut round = Round::new(remote.root(), &Budget::default()).unwrap();
        let prefix = round.next(&local).unwrap().remove(0);
        assert!(
            round
                .accept(prefix.clone(), Block::Leaf(vec![]), &local)
                .is_err()
        );
        round
            .accept(prefix.clone(), remote.block(&prefix).unwrap(), &local)
            .unwrap();
        assert!(
            round
                .accept(prefix.clone(), remote.block(&prefix).unwrap(), &local)
                .is_err()
        );
        assert!(round.finish().is_err());
    }
    #[test]
    fn persisted_fingerprints_are_canonical_and_pinned_readers_retain_the_budget() {
        let budget = Budget::new(64 << 10);
        let old = Arc::new(
            Tree::new(
                (0..100)
                    .map(id)
                    .collect::<BTreeSet<_>>()
                    .into_iter()
                    .collect(),
                &budget,
            )
            .unwrap(),
        );
        let encoded = old.encode().unwrap();
        let held = old.clone();
        let charged = budget.used();
        drop(old);
        assert_eq!(budget.used(), charged);
        assert!(
            Tree::decode(&encoded, &budget).is_err(),
            "an active reader is still charged"
        );
        drop(held);
        assert_eq!(budget.used(), 0);
        let read = Tree::decode(&encoded, &budget).unwrap();
        assert_eq!(read.encode().unwrap(), encoded);
        drop(read);
        let mut corrupt = encoded.clone();
        *corrupt.last_mut().unwrap() ^= 1;
        assert!(Tree::decode(&corrupt, &budget).is_err());
        assert_eq!(budget.used(), 0);
        let mut trailing = encoded;
        trailing.push(0);
        assert!(Tree::decode(&trailing, &budget).is_err());
    }
}
