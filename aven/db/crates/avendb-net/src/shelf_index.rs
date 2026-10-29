//! An index on the shelf (the index gate, `spec/AvenDB/ShelfIndex.lean`): rows a node derives from a log, kept on its
//! one shelf as content-addressed pages, never in a store of its own, and never only in memory.
//!
//! - An index is a derivation of its log and nothing more: each entry of the log changes some rows (`Change`), in the
//!   log's order, so the index of a log is its rows with every entry's changes applied (`derive`), and an index is
//!   disposable: a node can always build it again from the log (I1).
//! - Its rows lie in a tree of pages (`avendb::pages`), sorted by key. A page ends after a key whose hash says so, or once it
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

use std::collections::{BTreeMap, HashMap};
use std::io;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};

pub(crate) use avendb::pages::Change;
use avendb::pages::{Builder, Cache, Item, KEY_MAX, Node, Sum, VALUE_MAX, merge, sum};
use bytes::Bytes;
use data_encoding::HEXLOWER;

use crate::shelf::{Shelf, named};

/// What every slot starts with.
const SLOT: &[u8] = b"avenDB index slot 1\n";
/// How many entries of a log a node steps on at once as it catches up or builds an index again.
const BATCH: u64 = 4096;
/// How many pages it puts at once.
const PUTS: usize = 16;

/// The head of a log an index reflects: how many of its entries, and the log's own hash of that prefix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Stamp {
    pub(crate) at: u64,
    pub(crate) head: Sum,
}

impl From<avendb::log_head::Head> for Stamp {
    fn from(h: avendb::log_head::Head) -> Stamp {
        Stamp { at: h.at, head: h.sum }
    }
}

impl From<Stamp> for avendb::log_head::Head {
    fn from(s: Stamp) -> avendb::log_head::Head {
        avendb::log_head::Head { at: s.at, sum: s.head }
    }
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

/// A device's log as an index of it reads it: its edits by their ids, the head of each prefix the log's one head
/// (`policy::Log::head_at`), so a slot stamped at a prefix opens while the log goes on from it, and not once the log
/// is rewritten there.
impl Log for avendb::policy::Log {
    type Entry = avendb::id::EditId;
    fn len(&self) -> u64 {
        self.ids().len() as u64
    }
    fn head_at(&self, n: u64) -> Option<Sum> {
        avendb::policy::Log::head_at(self, n).map(|h| h.sum)
    }
    fn entries(&self, from: u64, to: u64) -> Vec<avendb::id::EditId> {
        self.ids()[from as usize..to as usize].to_vec()
    }
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

fn invalid(what: impl std::fmt::Display) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, what.to_string())
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
    pages: Arc<Mutex<Cache>>,
    /// The rows its scans have read, all told: what a bench holds a read to, as it holds its pages.
    rows: Arc<AtomicU64>,
}

impl ShelfIndex {
    /// The empty index `name` on `shelf`, of no entries of its log, holding `budget` bytes of pages at most in memory.
    pub(crate) fn empty(shelf: Shelf, name: &str, budget: usize, head: Sum) -> io::Result<ShelfIndex> {
        if !named(&format!("index/{name}")) || name.contains('/') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!("{name:?} names no index"),
            ));
        }
        let pages = Cache::new(budget);
        Ok(ShelfIndex {
            shelf,
            name: name.to_string(),
            root: None,
            stamp: Stamp { at: 0, head },
            kept: 0,
            pages: Arc::new(Mutex::new(pages)),
            rows: Arc::new(AtomicU64::new(0)),
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

    /// Opens index `name` on `shelf` as its newest slot whose root reads whole left it, stamped as that slot says, for
    /// a caller that steps it on itself (`shared_index`, whose rows are of a state, not of single entries of a log);
    /// else the empty index stamped `empty`. True where a slot opened.
    pub(crate) async fn open_kept(shelf: Shelf, name: &str, budget: usize, empty: Stamp) -> io::Result<(ShelfIndex, bool)> {
        let mut index = ShelfIndex::empty(shelf, name, budget, empty.head)?;
        let slots = index.slots().await?;
        index.kept = slots.iter().map(|s| s.0).max().unwrap_or(0);
        for (_, root, stamp) in slots {
            if let Some(root) = root
                && index.page(root, None).await.is_err()
            {
                continue;
            }
            index.root = root;
            index.stamp = stamp;
            return Ok((index, true));
        }
        index.stamp = empty;
        Ok((index, false))
    }

    /// It forgets every row, stamped `empty`, its slots left as they are till its next `apply`: what a caller does
    /// before it builds an index again, once a page didn't read whole.
    pub(crate) fn clear(&mut self, empty: Stamp) {
        self.root = None;
        self.stamp = empty;
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
            put.insert(hash, Bytes::from(bytes));
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
        let held = self.pages.lock().expect("pages").get(&hash);
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
        self.scan_within(from, &[], limit).await
    }

    /// `scan`, of the rows whose keys start with `prefix` alone: it stops at the first row past them, so a prefix of
    /// few rows reads no row after them, however many there are.
    pub(crate) async fn scan_within(&self, from: &[u8], prefix: &[u8], limit: usize) -> io::Result<Vec<Item>> {
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
                let rows = &node.items[start..];
                let within = rows.iter().take(limit - out.len()).take_while(|(k, _)| k.starts_with(prefix)).count();
                out.extend(rows[..within].iter().cloned());
                if within < rows.len() && out.len() < limit {
                    break;
                }
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
        self.rows.fetch_add(out.len() as u64, Ordering::Relaxed);
        Ok(out)
    }

    /// The rows its scans have read so far, all told.
    #[cfg(test)]
    pub(crate) fn rows_read(&self) -> u64 {
        self.rows.load(Ordering::Relaxed)
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
pub(crate) mod tests;

#[cfg(test)]
#[path = "shelf_index_bench.rs"]
pub(crate) mod bench;
