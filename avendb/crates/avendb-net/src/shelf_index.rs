//! An index on the shelf (the index gate, `spec/AvenDB/ShelfIndex.lean`): rows a node derives from a log, kept on its
//! one shelf as content-addressed pages, never in a store of its own, and never only in memory.
//!
//! - An index is a derivation of its log and nothing more: each entry of the log changes some rows (`Change`), in the
//!   log's order, so the index of a log is its rows with every entry's changes applied (`derive`), and an index is
//!   disposable: a node can always build it again from the log (I1).
//! - Its rows lie in a tree of pages, sorted by key. A page ends after a key whose hash says so (`cut`), or once it
//!   holds `MOST` items, never where the writes fell, so the tree of the same rows is the same tree, with the same root,
//!   however it was written (I4): a page changed puts a page anew and leaves every other page as it was. Each page is
//!   put once under the BLAKE3 hash of its bytes (`index/<name>/<hash>`), and read back only if its bytes hash to its
//!   name.
//! - Beside its pages, the index keeps its root in two slots, in turn (`slots/index-<name>-0`, `-1`), stamped with the
//!   log head it reflects (`Stamp`), the number of the slot, and the BLAKE3 hash of all before it. The pages go on the
//!   shelf before the slot that names them, so a slot that opens names pages the shelf holds.
//! - A node that opens an index takes the newest slot that opens, and whose root reads whole; where its stamp names a
//!   prefix of the log the node holds, it steps the rest of the log on the index; else, or with no slot, it builds the
//!   index again from the log (I2, I3). A crash at any point of a write leaves the older slot, or the new one: either
//!   is the index of a prefix of the log, so the node never reads an index that is not of its log. A log rewritten
//!   from a place (a withdrawal) has another head there, and the index is built again.
//! - A page lost or changed on the shelf is found as it is read: the read fails (`NotFound`, `InvalidData`), never
//!   answering other rows, and the node builds the index again (`rebuild`), or opens it again.
//! - Only the pages a node reads lately are in memory, `budget` bytes of them at most, the oldest let go first: an
//!   index may be larger than its node's memory.
//!
//! Pages no slot names any more stay on the shelf, as everything put on one does, till a sweep the person agrees to.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io;
use std::sync::{Arc, Mutex};

use bao_tree::blake3;
use bytes::Bytes;
use data_encoding::HEXLOWER;

use crate::shelf::{Shelf, named};

/// What every page starts with.
const PAGE: &[u8] = b"avenDB index page 1\n";
/// What every slot starts with.
const SLOT: &[u8] = b"avenDB index slot 1\n";
/// About how many items a page holds: a key ends a page one time in `FANOUT`.
const FANOUT: u32 = 128;
/// The most items a page holds, whatever its keys' hashes.
const MOST: usize = 4 * FANOUT as usize;
/// The longest key and the longest value a row may have.
pub(crate) const KEY_MAX: usize = 1024;
pub(crate) const VALUE_MAX: usize = 4096;
/// The most levels a tree has: far more than `MOST`-way pages of any log need.
const LEVELS: u8 = 32;
/// How many entries of a log a node steps on at once as it catches up or builds an index again.
const BATCH: u64 = 4096;
/// How many pages it puts at once.
const PUTS: usize = 16;

/// A change to one row of an index: the value its key holds from now on, or none.
pub(crate) type Change = (Vec<u8>, Option<Vec<u8>>);

/// A BLAKE3 hash.
type Sum = [u8; 32];

/// The head of a log an index reflects: how many of its entries, and the log's own hash of that prefix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Stamp {
    pub(crate) at: u64,
    pub(crate) head: Sum,
}

/// A log an index is of: its length, the hash of each of its prefixes (its head there, one no other prefix has), and
/// its entries.
pub(crate) trait Log {
    type Entry;
    fn len(&self) -> u64;
    /// The head of its first `n` entries, if it holds that many.
    fn head_at(&self, n: u64) -> Option<Sum>;
    /// Its entries from place `from` up to place `to`.
    fn entries(&self, from: u64, to: u64) -> Vec<Self::Entry>;
}

/// How a node opened an index (`ShelfIndex::open`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Opened {
    /// Its slot was of the log as it stands.
    Current,
    /// Its slot was of a prefix of the log: it stepped on this many entries after it.
    CaughtUp(u64),
    /// No slot opened, or its stamp named no prefix of the log, or a page didn't read whole: it built the index again.
    Rebuilt,
}

/// An item of a page: a row's key and value, or a page's last key and the hash of that page.
type Item = (Vec<u8>, Vec<u8>);

/// A page: its level, 0 for rows, and its items, sorted by key.
#[derive(Debug)]
struct Node {
    level: u8,
    items: Vec<Item>,
}

impl Node {
    fn to_bytes(level: u8, items: &[Item]) -> Vec<u8> {
        let mut out = Vec::with_capacity(
            PAGE.len()
                + 5
                + items
                    .iter()
                    .map(|(k, v)| 6 + k.len() + v.len())
                    .sum::<usize>(),
        );
        out.extend_from_slice(PAGE);
        out.push(level);
        out.extend_from_slice(&(items.len() as u32).to_be_bytes());
        for (k, v) in items {
            out.extend_from_slice(&(k.len() as u16).to_be_bytes());
            out.extend_from_slice(k);
            out.extend_from_slice(&(v.len() as u32).to_be_bytes());
            out.extend_from_slice(v);
        }
        out
    }

    /// The page `bytes` hold, if they hold one whole: keys in order, within their limits, and a child's hash under
    /// each key of a page above the rows.
    fn from_bytes(bytes: &[u8]) -> Option<Node> {
        let mut r = bytes.strip_prefix(PAGE)?;
        let mut take = |n: usize| -> Option<&[u8]> {
            let (head, rest) = r.split_at_checked(n)?;
            r = rest;
            Some(head)
        };
        let level = take(1)?[0];
        let count = u32::from_be_bytes(take(4)?.try_into().ok()?) as usize;
        if level >= LEVELS || count == 0 || count > MOST {
            return None;
        }
        let mut items: Vec<Item> = Vec::with_capacity(count);
        for _ in 0..count {
            let klen = u16::from_be_bytes(take(2)?.try_into().ok()?) as usize;
            let k = take(klen)?.to_vec();
            let vlen = u32::from_be_bytes(take(4)?.try_into().ok()?) as usize;
            let v = take(vlen)?.to_vec();
            let fits = if level == 0 {
                vlen <= VALUE_MAX
            } else {
                vlen == 32
            };
            if klen > KEY_MAX || !fits || items.last().is_some_and(|(last, _)| *last >= k) {
                return None;
            }
            items.push((k, v));
        }
        r.is_empty().then_some(Node { level, items })
    }

    fn size(&self) -> usize {
        64 + self
            .items
            .iter()
            .map(|(k, v)| 48 + k.len() + v.len())
            .sum::<usize>()
    }
}

/// Whether `key` ends a page at `level`: one key in `FANOUT`, by its hash alone.
fn cut(level: usize, key: &[u8]) -> bool {
    let mut h = blake3::Hasher::new();
    h.update(b"avenDB index cut\n");
    h.update(&[level as u8]);
    h.update(key);
    let sum = h.finalize();
    u32::from_be_bytes(sum.as_bytes()[..4].try_into().expect("4 bytes")) < u32::MAX / FANOUT
}

fn sum(bytes: &[u8]) -> Sum {
    *blake3::hash(bytes).as_bytes()
}

fn invalid(what: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_string())
}

/// The pages a tree's change puts, and the items of each level not on a page yet.
#[derive(Default)]
struct Builder {
    pending: Vec<Vec<Item>>,
    pages: Vec<(Sum, Bytes)>,
}

impl Builder {
    fn push(&mut self, level: usize, item: Item) {
        if self.pending.len() <= level {
            self.pending.resize_with(level + 1, Vec::new);
        }
        let ends = cut(level, &item.0);
        self.pending[level].push(item);
        if ends || self.pending[level].len() >= MOST {
            self.close(level);
        }
    }

    /// Puts the items of `level` not on a page yet on one, which an item of the level above names.
    fn close(&mut self, level: usize) {
        let items = std::mem::take(&mut self.pending[level]);
        let bytes = Node::to_bytes(level as u8, &items);
        let hash = sum(&bytes);
        let last = items.into_iter().next_back().expect("a page of items").0;
        self.pages.push((hash, bytes.into()));
        self.push(level + 1, (last, hash.to_vec()));
    }

    /// No item of `level` or below waits for a page: a page of `level` as it was may stand as it is.
    fn clear_through(&self, level: usize) -> bool {
        self.pending.iter().take(level + 1).all(Vec::is_empty)
    }

    /// The root of the tree: the one page of the top level, or none for no rows.
    fn finish(mut self) -> (Option<Sum>, Vec<(Sum, Bytes)>) {
        let mut level = 0;
        loop {
            let above = self
                .pending
                .get(level + 1..)
                .is_none_or(|p| p.iter().all(Vec::is_empty));
            let Some(here) = self.pending.get(level) else {
                return (None, self.pages);
            };
            if level >= 1 && here.len() == 1 && above {
                let root = here[0].1.as_slice().try_into().expect("a page's hash");
                return (Some(root), self.pages);
            }
            if here.is_empty() {
                if above {
                    return (None, self.pages);
                }
            } else {
                self.close(level);
            }
            level += 1;
        }
    }
}

/// The pages a node read lately, `budget` bytes of them at most, the oldest let go first.
struct Pages {
    budget: usize,
    held: usize,
    at: HashMap<Sum, Arc<Node>>,
    order: VecDeque<Sum>,
}

impl Pages {
    fn insert(&mut self, hash: Sum, node: Arc<Node>) {
        if self.at.insert(hash, node.clone()).is_some() {
            return;
        }
        self.held += node.size();
        self.order.push_back(hash);
        while self.held > self.budget && self.order.len() > 1 {
            let old = self.order.pop_front().expect("a page held");
            if let Some(n) = self.at.remove(&old) {
                self.held -= n.size();
            }
        }
    }
}

/// An index on a node's shelf, as the module says.
#[derive(Clone)]
pub(crate) struct ShelfIndex {
    shelf: Shelf,
    name: String,
    root: Option<Sum>,
    stamp: Stamp,
    /// The number of the slot it kept last: the next goes in slot `kept + 1`, in place of the older of the two.
    kept: u64,
    pages: Arc<Mutex<Pages>>,
}

impl ShelfIndex {
    /// The empty index `name` on `shelf`, of no entries of its log, holding `budget` bytes of pages at most in memory.
    fn empty(shelf: Shelf, name: &str, budget: usize, head: Sum) -> io::Result<ShelfIndex> {
        if !named(&format!("index/{name}")) || name.contains('/') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{name:?} names no index"),
            ));
        }
        let pages = Pages {
            budget,
            held: 0,
            at: HashMap::new(),
            order: VecDeque::new(),
        };
        Ok(ShelfIndex {
            shelf,
            name: name.to_string(),
            root: None,
            stamp: Stamp { at: 0, head },
            kept: 0,
            pages: Arc::new(Mutex::new(pages)),
        })
    }

    /// Opens index `name` of `log` on `shelf`, as the module says, and steps on it what the log holds beyond its
    /// slot, each entry's changes by `derive`; or builds it again from the log.
    pub(crate) async fn open<L: Log>(
        shelf: Shelf,
        name: &str,
        budget: usize,
        log: &L,
        derive: impl Fn(&L::Entry) -> Vec<Change>,
    ) -> io::Result<(ShelfIndex, Opened)> {
        let empty_head = log
            .head_at(0)
            .ok_or_else(|| invalid("a log has a head of no entries"))?;
        let mut index = ShelfIndex::empty(shelf, name, budget, empty_head)?;
        let slots = index.slots().await?;
        index.kept = slots.iter().map(|s| s.0).max().unwrap_or(0);
        for (_, root, stamp) in slots {
            let fits = stamp.at <= log.len() && log.head_at(stamp.at) == Some(stamp.head);
            if !fits {
                continue;
            }
            if let Some(root) = root
                && index.page(root, None).await.is_err()
            {
                continue;
            }
            let mut from = index.clone();
            from.root = root;
            from.stamp = stamp;
            let more = log.len() - stamp.at;
            match from.catch_up(log, &derive).await {
                Ok(()) => {
                    let how = if more == 0 {
                        Opened::Current
                    } else {
                        Opened::CaughtUp(more)
                    };
                    return Ok((from, how));
                }
                // a page below the root that doesn't read whole: built again, below
                Err(e)
                    if matches!(
                        e.kind(),
                        io::ErrorKind::InvalidData | io::ErrorKind::NotFound
                    ) =>
                {
                    index.kept = from.kept;
                    break;
                }
                Err(e) => return Err(e),
            }
        }
        index.catch_up(log, &derive).await?;
        Ok((index, Opened::Rebuilt))
    }

    /// It built again from `log`, from no pages: what a node does once a read finds a page lost or changed, which a
    /// read says (`NotFound`, `InvalidData`) and never answers past.
    pub(crate) async fn rebuild<L: Log>(
        &mut self,
        log: &L,
        derive: impl Fn(&L::Entry) -> Vec<Change>,
    ) -> io::Result<()> {
        let head = log
            .head_at(0)
            .ok_or_else(|| invalid("a log has a head of no entries"))?;
        self.root = None;
        self.stamp = Stamp { at: 0, head };
        self.catch_up(log, &derive).await
    }

    /// Steps on it the entries of `log` after its stamp, `BATCH` at a time, a slot kept after each.
    async fn catch_up<L: Log>(
        &mut self,
        log: &L,
        derive: &impl Fn(&L::Entry) -> Vec<Change>,
    ) -> io::Result<()> {
        let mut at = self.stamp.at;
        while at < log.len() {
            let to = log.len().min(at + BATCH);
            let changes: Vec<Change> = log.entries(at, to).iter().flat_map(derive).collect();
            let head = log
                .head_at(to)
                .ok_or_else(|| invalid("a log has a head at every place it holds"))?;
            self.apply(changes, Stamp { at: to, head }).await?;
            at = to;
        }
        Ok(())
    }

    /// Applies `changes`, in order, the last of each key's standing, as of log head `stamp`: on the same path as the
    /// log's append, right after it. Its new pages go on the shelf, then its slot.
    pub(crate) async fn apply(&mut self, changes: Vec<Change>, stamp: Stamp) -> io::Result<()> {
        let mut last: BTreeMap<Vec<u8>, Option<Vec<u8>>> = BTreeMap::new();
        for (k, v) in changes {
            if k.len() > KEY_MAX || v.as_ref().is_some_and(|v| v.len() > VALUE_MAX) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "a row past the index's limits",
                ));
            }
            last.insert(k, v);
        }
        let changes: Vec<Change> = last.into_iter().collect();
        let (root, pages) = self.walk(&changes).await?.finish();
        let mut put = HashMap::new();
        for (hash, bytes) in pages {
            put.insert(hash, bytes);
        }
        let put: Vec<_> = put.into_iter().collect();
        for group in put.chunks(PUTS) {
            let puts = group.iter().map(|(hash, bytes)| {
                let (shelf, name, bytes) =
                    (self.shelf.clone(), self.page_name(hash), bytes.clone());
                async move { shelf.put(&name, bytes).await }
            });
            for done in crate::blind::join_all(puts.collect()).await {
                done?;
            }
        }
        self.keep_slot(root, stamp).await?;
        self.root = root;
        self.stamp = stamp;
        Ok(())
    }

    /// The tree with `changes`, sorted and one a key, applied: the pages it puts, and its root.
    async fn walk(&self, changes: &[Change]) -> io::Result<Builder> {
        struct Frame {
            node: Arc<Node>,
            next: usize,
            lo: usize,
            hi: usize,
        }
        let mut b = Builder::default();
        let Some(root) = self.root else {
            for (k, v) in changes {
                if let Some(v) = v {
                    b.push(0, (k.clone(), v.clone()));
                }
            }
            return Ok(b);
        };
        let mut stack = vec![Frame {
            node: self.page(root, None).await?,
            next: 0,
            lo: 0,
            hi: changes.len(),
        }];
        while let Some(f) = stack.last_mut() {
            let node = f.node.clone();
            if node.level == 0 {
                let (lo, hi) = (f.lo, f.hi);
                stack.pop();
                merge(&node.items, &changes[lo..hi], |item| b.push(0, item));
                continue;
            }
            if f.next == node.items.len() {
                stack.pop();
                continue;
            }
            let i = f.next;
            f.next += 1;
            let (key, child) = &node.items[i];
            // the changes up to this child's last key, or all those left for the last child of the page
            let lo = f.lo;
            let mut hi = f.hi;
            if i + 1 < node.items.len() {
                hi = lo + changes[lo..f.hi].partition_point(|(k, _)| k <= key);
            }
            f.lo = hi;
            let level = node.level - 1;
            if lo == hi && b.clear_through(level as usize) {
                b.push(node.level as usize, (key.clone(), child.clone()));
            } else {
                let hash = child.as_slice().try_into().expect("a page's hash");
                stack.push(Frame {
                    node: self.page(hash, Some(level)).await?,
                    next: 0,
                    lo,
                    hi,
                });
            }
        }
        Ok(b)
    }

    /// Page `hash`, of `level` if given: from memory, or from the shelf if its bytes there hash to its name.
    async fn page(&self, hash: Sum, level: Option<u8>) -> io::Result<Arc<Node>> {
        let held = self.pages.lock().expect("pages").at.get(&hash).cloned();
        let node = match held {
            Some(node) => node,
            None => {
                let name = self.page_name(&hash);
                let bytes = self.shelf.get(&name).await?.ok_or_else(|| {
                    io::Error::new(io::ErrorKind::NotFound, format!("no page {name}"))
                })?;
                if sum(&bytes) != hash {
                    return Err(invalid(format!("page {name} holds other bytes")));
                }
                let node = Arc::new(
                    Node::from_bytes(&bytes)
                        .ok_or_else(|| invalid(format!("page {name} is no page")))?,
                );
                self.pages.lock().expect("pages").insert(hash, node.clone());
                node
            }
        };
        if level.is_some_and(|l| l != node.level) {
            return Err(invalid("a page of another level"));
        }
        Ok(node)
    }

    /// The value under `key`, if any.
    pub(crate) async fn get(&self, key: &[u8]) -> io::Result<Option<Vec<u8>>> {
        let Some(mut hash) = self.root else {
            return Ok(None);
        };
        let mut level = None;
        loop {
            let node = self.page(hash, level).await?;
            let at = node.items.partition_point(|(k, _)| k.as_slice() < key);
            if node.level == 0 {
                return Ok(node
                    .items
                    .get(at)
                    .filter(|(k, _)| k == key)
                    .map(|(_, v)| v.clone()));
            }
            let Some((_, child)) = node.items.get(at) else {
                return Ok(None);
            };
            hash = child.as_slice().try_into().expect("a page's hash");
            level = Some(node.level - 1);
        }
    }

    /// Up to `limit` rows from key `from` on, in order.
    pub(crate) async fn scan(&self, from: &[u8], limit: usize) -> io::Result<Vec<Item>> {
        let mut out = Vec::new();
        let Some(root) = self.root else {
            return Ok(out);
        };
        let mut stack = vec![(self.page(root, None).await?, 0usize)];
        while let Some((node, next)) = stack.pop() {
            if out.len() >= limit {
                break;
            }
            let start = next.max(node.items.partition_point(|(k, _)| k.as_slice() < from));
            if node.level == 0 {
                out.extend(node.items[start..].iter().take(limit - out.len()).cloned());
                continue;
            }
            if start < node.items.len() {
                let hash = node.items[start]
                    .1
                    .as_slice()
                    .try_into()
                    .expect("a page's hash");
                let child = self.page(hash, Some(node.level - 1)).await?;
                stack.push((node, start + 1));
                stack.push((child, 0));
            }
        }
        Ok(out)
    }

    /// The hash of its root page, a function of its rows alone (I4), or none for no rows.
    pub(crate) fn root(&self) -> Option<Sum> {
        self.root
    }

    /// The head of the log it reflects.
    pub(crate) fn stamp(&self) -> Stamp {
        self.stamp
    }

    fn page_name(&self, hash: &Sum) -> String {
        format!("index/{}/{}", self.name, HEXLOWER.encode(hash))
    }

    fn slot_name(&self, n: u64) -> String {
        format!("slots/index-{}-{}", self.name, n % 2)
    }

    /// Keeps `root` and `stamp` in its next slot, in place of the older of the two.
    async fn keep_slot(&mut self, root: Option<Sum>, stamp: Stamp) -> io::Result<()> {
        let n = self.kept + 1;
        let mut out = Vec::with_capacity(SLOT.len() + 8 + 8 + 32 + 33 + 32);
        out.extend_from_slice(SLOT);
        out.extend_from_slice(&n.to_be_bytes());
        out.extend_from_slice(&stamp.at.to_be_bytes());
        out.extend_from_slice(&stamp.head);
        out.push(root.is_some() as u8);
        out.extend_from_slice(&root.unwrap_or_default());
        let check = sum(&out);
        out.extend_from_slice(&check);
        self.shelf.keep(&self.slot_name(n), out.into()).await?;
        self.kept = n;
        Ok(())
    }

    /// The slots that open, the newest first: each one's number, root and stamp.
    async fn slots(&self) -> io::Result<Vec<(u64, Option<Sum>, Stamp)>> {
        let mut found = Vec::new();
        for i in 0..2 {
            let Some(bytes) = self
                .shelf
                .get(&format!("slots/index-{}-{i}", self.name))
                .await?
            else {
                continue;
            };
            if let Some(slot) = slot_of(&bytes)
                && slot.0 % 2 == i
            {
                found.push(slot);
            }
        }
        found.sort_by_key(|s| std::cmp::Reverse(s.0));
        Ok(found)
    }
}

/// The slot `bytes` hold, if they hold one whole.
fn slot_of(bytes: &[u8]) -> Option<(u64, Option<Sum>, Stamp)> {
    let (body, check) = bytes.split_at_checked(bytes.len().checked_sub(32)?)?;
    if sum(body) != *check {
        return None;
    }
    let r = body.strip_prefix(SLOT)?;
    if r.len() != 8 + 8 + 32 + 1 + 32 {
        return None;
    }
    let n = u64::from_be_bytes(r[..8].try_into().ok()?);
    let at = u64::from_be_bytes(r[8..16].try_into().ok()?);
    let head: Sum = r[16..48].try_into().ok()?;
    let root: Sum = r[49..81].try_into().ok()?;
    let root = match r[48] {
        0 => None,
        1 => Some(root),
        _ => return None,
    };
    Some((n, root, Stamp { at, head }))
}

/// The rows of a page with `changes`, sorted and one a key, applied, each passed to `out` in order.
fn merge(rows: &[Item], changes: &[Change], mut out: impl FnMut(Item)) {
    let (mut i, mut j) = (0, 0);
    while i < rows.len() || j < changes.len() {
        let order = match (rows.get(i), changes.get(j)) {
            (Some(r), Some(c)) => r.0.cmp(&c.0),
            (Some(_), None) => std::cmp::Ordering::Less,
            _ => std::cmp::Ordering::Greater,
        };
        match order {
            std::cmp::Ordering::Less => {
                out(rows[i].clone());
                i += 1;
            }
            std::cmp::Ordering::Equal | std::cmp::Ordering::Greater => {
                if order == std::cmp::Ordering::Equal {
                    i += 1;
                }
                let (k, v) = &changes[j];
                if let Some(v) = v {
                    out((k.clone(), v.clone()));
                }
                j += 1;
            }
        }
    }
}

/// The rows a log's entries give, from scratch: what every index of it must hold (I1).
#[cfg(test)]
fn derive<E>(entries: &[E], rows: impl Fn(&E) -> Vec<Change>) -> BTreeMap<Vec<u8>, Vec<u8>> {
    let mut out = BTreeMap::new();
    for (k, v) in entries.iter().flat_map(rows) {
        match v {
            Some(v) => out.insert(k, v),
            None => out.remove(&k),
        };
    }
    out
}

#[cfg(test)]
#[path = "shelf_index_tests.rs"]
mod tests;
