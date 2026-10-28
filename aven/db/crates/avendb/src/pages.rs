//! Index pages (the index gate, `spec/AvenDB/ShelfIndex.lean`): rows sorted by key in a tree of pages, each page named
//! by the BLAKE3 hash of its bytes and read back only if its bytes hash to its name, with only the pages read lately in
//! memory, so an index may be larger than its node's memory.
//!
//! - A page ends after a key whose hash says so (`cut`), or once it holds `MOST` items, never where the writes fell: the
//!   tree of the same rows is the same tree, with the same root, however it was written (I4). A node's shelf keeps such
//!   a tree whole (`avendb_net::shelf_index`).
//! - A store whose keys come at random, as edit ids do, keeps its rows in runs instead (`Runs`): the newest in memory,
//!   the rest trees of pages written once, a level each, every level `GROW` times the one above it at most, merged
//!   into the next as it fills. A row is written again once a level, a few times in all whatever the history, not once
//!   a batch as a tree changed in place would be (Samuel's flat cost per edit). Each run keeps a Bloom filter of its
//!   keys beside its pages, 10 bits a row, so a look for a key no run holds, as a new edit's, reads 64 bytes of each
//!   run's filter and no page. S7's spill holds
//!   the index of what it spilled this way (`lab::held`).

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// What every page starts with.
pub const PAGE: &[u8] = b"avenDB index page 1\n";
/// About how many items a page holds: a key ends a page one time in `FANOUT`.
pub const FANOUT: u32 = 128;
/// The most items a page holds, whatever its keys' hashes.
pub const MOST: usize = 4 * FANOUT as usize;
/// The longest key and the longest value a row may have.
pub const KEY_MAX: usize = 1024;
pub const VALUE_MAX: usize = 4096;
/// The most levels a tree has: far more than `MOST`-way pages of any log need.
pub const LEVELS: u8 = 32;

/// A BLAKE3 hash.
pub type Sum = [u8; 32];

/// An item of a page: a row's key and value, or a page's last key and the hash of that page.
pub type Item = (Vec<u8>, Vec<u8>);

pub fn sum(bytes: &[u8]) -> Sum {
    *blake3::hash(bytes).as_bytes()
}

/// A page: its level, 0 for rows, and its items, sorted by key.
#[derive(Debug)]
pub struct Node {
    pub level: u8,
    pub items: Vec<Item>,
}

impl Node {
    pub fn to_bytes(level: u8, items: &[Item]) -> Vec<u8> {
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
    pub fn from_bytes(bytes: &[u8]) -> Option<Node> {
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
            // a row's value, and a byte more for a run's tombstone mark (`Runs`)
            let fits = if level == 0 {
                vlen <= VALUE_MAX + 1
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

    pub fn size(&self) -> usize {
        64 + self
            .items
            .iter()
            .map(|(k, v)| 48 + k.len() + v.len())
            .sum::<usize>()
    }

    /// The hash of the child under item `i` of a page above the rows.
    pub fn child(&self, i: usize) -> Sum {
        self.items[i]
            .1
            .as_slice()
            .try_into()
            .expect("a page's hash")
    }
}

/// Whether `key` ends a page at `level`: one key in `FANOUT`, by its hash alone.
pub fn cut(level: usize, key: &[u8]) -> bool {
    let mut h = blake3::Hasher::new();
    h.update(b"avenDB index cut\n");
    h.update(&[level as u8]);
    h.update(key);
    let sum = h.finalize();
    u32::from_be_bytes(sum.as_bytes()[..4].try_into().expect("4 bytes")) < u32::MAX / FANOUT
}

/// The pages a tree's change puts, and the items of each level not on a page yet.
#[derive(Default)]
pub struct Builder {
    pending: Vec<Vec<Item>>,
    pub pages: Vec<(Sum, Vec<u8>)>,
}

impl Builder {
    pub fn push(&mut self, level: usize, item: Item) {
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
        self.pages.push((hash, bytes));
        self.push(level + 1, (last, hash.to_vec()));
    }

    /// No item of `level` or below waits for a page: a page of `level` as it was may stand as it is.
    pub fn clear_through(&self, level: usize) -> bool {
        self.pending.iter().take(level + 1).all(Vec::is_empty)
    }

    /// The pages it made so far, taken: a builder of a big tree hands them on as it goes.
    pub fn take_pages(&mut self) -> Vec<(Sum, Vec<u8>)> {
        std::mem::take(&mut self.pages)
    }

    /// The root of the tree: the one page of the top level, or none for no rows.
    pub fn finish(mut self) -> (Option<Sum>, Vec<(Sum, Vec<u8>)>) {
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

/// A change to one row: the value its key holds from now on, or none.
pub type Change = (Vec<u8>, Option<Vec<u8>>);

/// The rows of a page with `changes`, sorted and one a key, applied, each passed to `out` in order.
pub fn merge(rows: &[Item], changes: &[Change], mut out: impl FnMut(Item)) {
    use std::cmp::Ordering::*;
    let (mut i, mut j) = (0, 0);
    while i < rows.len() || j < changes.len() {
        let order = match (rows.get(i), changes.get(j)) {
            (Some(r), Some(c)) => r.0.cmp(&c.0),
            (Some(_), None) => Less,
            _ => Greater,
        };
        if order == Less {
            out(rows[i].clone());
            i += 1;
            continue;
        }
        if order == Equal {
            i += 1;
        }
        let (k, v) = &changes[j];
        if let Some(v) = v {
            out((k.clone(), v.clone()));
        }
        j += 1;
    }
}

/// The pages a store read lately, `budget` bytes of them at most, the oldest let go first.
#[derive(Debug)]
pub struct Cache {
    budget: usize,
    pub held: usize,
    at: HashMap<Sum, Arc<Node>>,
    order: VecDeque<Sum>,
}

impl Cache {
    pub fn new(budget: usize) -> Cache {
        Cache {
            budget,
            held: 0,
            at: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn get(&self, hash: &Sum) -> Option<Arc<Node>> {
        self.at.get(hash).cloned()
    }

    pub fn insert(&mut self, hash: Sum, node: Arc<Node>) {
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

/// Where a store keeps its pages, read and written as it goes, with no waiting: a folder of files on a machine, or one
/// space it appends to, as a page's file in OPFS that its worker reads and writes in place (`Space`).
#[derive(Debug)]
enum Store {
    Dir(PathBuf),
    Arena(Arc<dyn Space>),
}

/// A space of bytes a store appends to and reads back at once, as a page's worker does with an OPFS file it holds open
/// (`FileSystemSyncAccessHandle`), where a folder of files that come and go can't be: what it appended stays till the
/// space goes, read at the place `append` gave.
pub trait Space: Send + Sync + std::fmt::Debug {
    /// Appends `bytes`: where they start.
    fn append(&self, bytes: &[u8]) -> io::Result<u64>;
    /// Fills `bytes` from place `at`.
    fn read_at(&self, at: u64, bytes: &mut [u8]) -> io::Result<()>;
    /// The bytes it holds.
    fn len(&self) -> u64;
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// A space in memory, for tests of what a space holds.
#[derive(Debug, Default)]
pub struct MemorySpace(Mutex<Vec<u8>>);

impl MemorySpace {
    /// A space that holds `bytes`.
    pub fn of(bytes: Vec<u8>) -> MemorySpace {
        MemorySpace(Mutex::new(bytes))
    }
}

impl Space for MemorySpace {
    fn append(&self, bytes: &[u8]) -> io::Result<u64> {
        let mut held = self.0.lock().expect("space");
        let at = held.len() as u64;
        held.extend_from_slice(bytes);
        Ok(at)
    }
    fn read_at(&self, at: u64, bytes: &mut [u8]) -> io::Result<()> {
        let held = self.0.lock().expect("space");
        let at = usize::try_from(at).map_err(|_| io::ErrorKind::UnexpectedEof)?;
        let part = held.get(at..at + bytes.len()).ok_or(io::ErrorKind::UnexpectedEof)?;
        bytes.copy_from_slice(part);
        Ok(())
    }
    fn len(&self) -> u64 {
        self.0.lock().expect("space").len() as u64
    }
}

/// A folder of pages, each run's in a folder of its own (`Run`), or a space they are all appended to (`Space`), with
/// the pages it read lately (`Cache`). It is a node's own, of this process alone: it starts empty, and holds nothing
/// anyone reads after it stops.
#[derive(Debug)]
pub struct Folder {
    store: Store,
    cache: Mutex<Cache>,
    runs: AtomicU64,
    /// The bytes of pages it wrote, of runs held or let go.
    written: AtomicU64,
}

impl Folder {
    /// A folder of pages in `dir`, which it empties first (what was there is of an older run), keeping `budget` bytes
    /// of pages at hand.
    pub fn new(dir: impl Into<PathBuf>, budget: usize) -> io::Result<Arc<Folder>> {
        let dir = dir.into();
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        fs::create_dir_all(&dir)?;
        Ok(Folder::of(Store::Dir(dir), budget))
    }

    /// Pages appended to `space`, `budget` bytes of them at hand. What runs let go of stays in the space till it goes:
    /// a page's spill, whose space goes as its device closes.
    pub fn in_space(space: Arc<dyn Space>, budget: usize) -> Arc<Folder> {
        Folder::of(Store::Arena(space), budget)
    }

    fn of(store: Store, budget: usize) -> Arc<Folder> {
        let (runs, written) = (AtomicU64::new(0), AtomicU64::new(0));
        Arc::new(Folder { store, cache: Mutex::new(Cache::new(budget)), runs, written })
    }

    /// The bytes of pages it holds in memory.
    pub fn memory(&self) -> usize {
        self.cache.lock().expect("pages").held
    }

    fn page(&self, run: &Run, hash: &Sum) -> io::Result<Arc<Node>> {
        if let Some(node) = self.cache.lock().expect("pages").get(hash) {
            return Ok(node);
        }
        let bytes = match &self.store {
            Store::Dir(dir) => fs::read(dir.join(format!("r{}", run.n)).join(hex(hash)))?,
            Store::Arena(space) => {
                let (at, len) = *run.places.get(hash).ok_or(io::ErrorKind::NotFound)?;
                let mut bytes = vec![0; len as usize];
                space.read_at(at, &mut bytes)?;
                bytes
            }
        };
        let invalid = || io::Error::new(io::ErrorKind::InvalidData, "a page changed in its folder");
        if sum(&bytes) != *hash {
            return Err(invalid());
        }
        let node = Arc::new(Node::from_bytes(&bytes).ok_or_else(invalid)?);
        self.cache.lock().expect("pages").insert(*hash, node.clone());
        Ok(node)
    }
}

fn hex(hash: &Sum) -> String {
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

/// A Bloom filter of a run's keys, `BITS` bits a key, in blocks of 448 bits and an 8-byte check of them (so a block
/// changed in its folder is never read as another, as with a page), each key's `PROBES` probes in one block:
/// a key it says no to the run doesn't hold, so a look for a key a store doesn't hold, as each new edit's, reads no
/// page (one in a hundred does, about). It is made in memory as its run is written, then kept in the run's folder, so
/// each look reads one block of 64 bytes of it, and memory holds none of it once the run is written.
struct Bloom {
    blocks: Vec<[u64; 7]>,
}

const BITS: usize = 10;
const PROBES: u64 = 7;
/// The bytes of a block, and the bits of it a filter sets.
const BLOCK: usize = 64;
const BLOCK_BITS: usize = 448;

/// The check of block `n`'s bits.
fn block_check(n: u64, bits: &[u8]) -> [u8; 8] {
    let mut h = blake3::Hasher::new();
    h.update(b"avenDB bloom block\n");
    h.update(&n.to_be_bytes());
    h.update(bits);
    h.finalize().as_bytes()[..8].try_into().expect("8 bytes")
}

/// The block of `key` among `blocks`, and its probes there.
fn probes(key: &[u8], blocks: u64) -> (u64, impl Iterator<Item = usize>) {
    // FNV-1a, then two halves stirred apart: the keys are a store's own, not chosen to collide
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in key {
        h = (h ^ u64::from(*b)).wrapping_mul(0x0100_0000_01b3);
    }
    let mix = |mut z: u64| {
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    };
    let (a, b) = (mix(h), mix(h ^ 0x9e37_79b9_7f4a_7c15));
    let (c, d) = ((b & 0xffff_ffff) as usize, ((b >> 32) | 1) as usize);
    (a % blocks, (0..PROBES as usize).map(move |i| c.wrapping_add(i.wrapping_mul(d)) % BLOCK_BITS))
}

impl Bloom {
    fn new(keys: u64) -> Bloom {
        Bloom { blocks: vec![[0; 7]; (keys as usize * BITS).div_ceil(BLOCK_BITS).max(1)] }
    }

    fn add(&mut self, key: &[u8]) {
        let (block, bits) = probes(key, self.blocks.len() as u64);
        let block = &mut self.blocks[block as usize];
        for p in bits {
            block[p / 64] |= 1 << (p % 64);
        }
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.blocks.len() * BLOCK);
        for (n, block) in self.blocks.iter().enumerate() {
            let bits: Vec<u8> = block.iter().flat_map(|w| w.to_le_bytes()).collect();
            out.extend_from_slice(&bits);
            out.extend_from_slice(&block_check(n as u64, &bits));
        }
        out
    }
}

/// A run's Bloom filter in its folder, or at a place of its space, read a block at a time.
struct Blooms {
    at: BloomAt,
    blocks: u64,
}

enum BloomAt {
    File(fs::File),
    Arena(Arc<dyn Space>, u64),
}

impl Blooms {
    fn may_hold(&self, key: &[u8]) -> io::Result<bool> {
        let (block, bits) = probes(key, self.blocks);
        let mut bytes = [0u8; BLOCK];
        match &self.at {
            BloomAt::File(file) => read_at(file, &mut bytes, block * BLOCK as u64)?,
            BloomAt::Arena(space, at) => space.read_at(at + block * BLOCK as u64, &mut bytes)?,
        }
        if bytes[56..] != block_check(block, &bytes[..56]) {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "a Bloom filter changed in its folder"));
        }
        Ok(bits.into_iter().all(|p| bytes[p / 8] & (1 << (p % 8)) != 0))
    }
}

#[cfg(unix)]
fn read_at(file: &fs::File, bytes: &mut [u8], at: u64) -> io::Result<()> {
    std::os::unix::fs::FileExt::read_exact_at(file, bytes, at)
}

#[cfg(not(unix))]
fn read_at(file: &fs::File, bytes: &mut [u8], at: u64) -> io::Result<()> {
    use std::io::{Read as _, Seek as _, SeekFrom};
    let mut file = file.try_clone()?;
    file.seek(SeekFrom::Start(at))?;
    file.read_exact(bytes)
}

/// A run: a tree of pages written once, in a folder of its own, removed once nothing names it, with the Bloom filter
/// of its keys beside them, `BITS` bits a row.
pub struct Run {
    folder: Arc<Folder>,
    n: u64,
    root: Option<Sum>,
    /// How many rows it holds, tombstones among them.
    count: u64,
    bloom: Blooms,
    /// Where each of its pages is in its folder's space, if it has one: a few dozen bytes a page.
    places: HashMap<Sum, (u64, u32)>,
}

impl Drop for Run {
    fn drop(&mut self) {
        if let Store::Dir(dir) = &self.folder.store {
            fs::remove_dir_all(dir.join(format!("r{}", self.n))).ok();
        }
    }
}

impl Run {
    /// The run of `rows`, sorted by key, one a key, `expected` of them at most.
    fn build(
        folder: &Arc<Folder>,
        expected: u64,
        rows: impl Iterator<Item = Item>,
    ) -> io::Result<Run> {
        let n = folder.runs.fetch_add(1, Ordering::Relaxed);
        let dir = match &folder.store {
            Store::Dir(dir) => {
                let dir = dir.join(format!("r{n}"));
                fs::create_dir_all(&dir)?;
                Some(dir)
            }
            Store::Arena(_) => None,
        };
        let mut places = HashMap::new();
        let mut write = |hash: &Sum, bytes: &[u8]| -> io::Result<()> {
            folder.written.fetch_add(bytes.len() as u64, Ordering::Relaxed);
            match (&folder.store, &dir) {
                (Store::Arena(space), _) => {
                    places.insert(*hash, (space.append(bytes)?, bytes.len() as u32));
                    Ok(())
                }
                (_, Some(dir)) => fs::write(dir.join(hex(hash)), bytes),
                (Store::Dir(_), None) => unreachable!("a folder's run has a folder"),
            }
        };
        let mut bloom = Bloom::new(expected);
        let mut b = Builder::default();
        let mut count = 0;
        for row in rows {
            bloom.add(&row.0);
            b.push(0, row);
            count += 1;
            for (hash, bytes) in b.take_pages() {
                write(&hash, &bytes)?;
            }
        }
        let (root, pages) = b.finish();
        for (hash, bytes) in pages {
            write(&hash, &bytes)?;
        }
        let blocks = bloom.blocks.len() as u64;
        let at = match (&folder.store, &dir) {
            (Store::Arena(space), _) => BloomAt::Arena(space.clone(), space.append(&bloom.to_bytes())?),
            (_, Some(dir)) => {
                let path = dir.join("bloom");
                fs::write(&path, bloom.to_bytes())?;
                BloomAt::File(fs::File::open(&path)?)
            }
            (Store::Dir(_), None) => unreachable!("a folder's run has a folder"),
        };
        Ok(Run { folder: folder.clone(), n, root, count, bloom: Blooms { at, blocks }, places })
    }

    fn get(&self, key: &[u8]) -> io::Result<Option<Vec<u8>>> {
        let Some(mut hash) = self.root else {
            return Ok(None);
        };
        if !self.bloom.may_hold(key)? {
            return Ok(None);
        }
        loop {
            let node = self.folder.page(self, &hash)?;
            let at = node.items.partition_point(|(k, _)| k.as_slice() < key);
            if node.level == 0 {
                return Ok(node
                    .items
                    .get(at)
                    .filter(|(k, _)| k == key)
                    .map(|(_, v)| v.clone()));
            }
            if at == node.items.len() {
                return Ok(None);
            }
            hash = node.child(at);
        }
    }

    /// Its rows in order, read a page at a time.
    fn rows(&self) -> RunRows<'_> {
        RunRows {
            run: self,
            stack: Vec::new(),
            started: false,
        }
    }
}

struct RunRows<'a> {
    run: &'a Run,
    stack: Vec<(Arc<Node>, usize)>,
    started: bool,
}

impl Iterator for RunRows<'_> {
    type Item = io::Result<Item>;
    fn next(&mut self) -> Option<io::Result<Item>> {
        if !self.started {
            self.started = true;
            let root = self.run.root?;
            match self.run.folder.page(self.run, &root) {
                Ok(node) => self.stack.push((node, 0)),
                Err(e) => return Some(Err(e)),
            }
        }
        loop {
            let (node, i) = self.stack.last_mut()?;
            if *i == node.items.len() {
                self.stack.pop();
                continue;
            }
            let at = *i;
            *i += 1;
            if node.level == 0 {
                return Some(Ok(node.items[at].clone()));
            }
            let child = node.child(at);
            match self.run.folder.page(self.run, &child) {
                Ok(node) => self.stack.push((node, 0)),
                Err(e) => return Some(Err(e)),
            }
        }
    }
}

/// How many changes the newest run holds in memory before it goes into the levels as a run of pages.
pub const DELTA: usize = 16 << 10;
/// How many times the rows of a level the next holds at most.
pub const GROW: u64 = 8;

/// A store of rows whose keys come at random, as the module says: the newest changes in memory, the rest in runs of
/// pages, a level each, the newer above the older. Cloned, it shares its runs, which are never changed.
#[derive(Clone)]
pub struct Runs {
    folder: Arc<Folder>,
    delta: BTreeMap<Vec<u8>, Option<Vec<u8>>>,
    levels: Vec<Option<Arc<Run>>>,
    /// How many changes the memory holds before they go into the levels.
    limit: usize,
}

/// A run's value: a row's, marked 1, or none, a tombstone, marked 0, which hides the key in the runs below it.
fn marked(v: &Option<Vec<u8>>) -> Vec<u8> {
    match v {
        Some(v) => [&[1u8][..], v].concat(),
        None => vec![0],
    }
}

fn unmarked(v: &[u8]) -> io::Result<Option<Vec<u8>>> {
    match v.split_first() {
        Some((1, v)) => Ok(Some(v.to_vec())),
        Some((0, [])) => Ok(None),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "a row of a run with no mark",
        )),
    }
}

impl Runs {
    pub fn new(folder: &Arc<Folder>) -> Runs {
        Runs::with_limit(folder, DELTA)
    }

    /// One that holds `limit` changes in memory at most.
    pub fn with_limit(folder: &Arc<Folder>, limit: usize) -> Runs {
        Runs {
            folder: folder.clone(),
            delta: BTreeMap::new(),
            levels: Vec::new(),
            limit: limit.max(1),
        }
    }

    /// The value under `key`, if any.
    pub fn get(&self, key: &[u8]) -> io::Result<Option<Vec<u8>>> {
        if let Some(v) = self.delta.get(key) {
            return Ok(v.clone());
        }
        for run in self.levels.iter().flatten() {
            if let Some(v) = run.get(key)? {
                return unmarked(&v);
            }
        }
        Ok(None)
    }

    /// `key` holds `value` from now on, or nothing.
    pub fn set(&mut self, key: Vec<u8>, value: Option<Vec<u8>>) -> io::Result<()> {
        debug_assert!(key.len() <= KEY_MAX && value.as_ref().is_none_or(|v| v.len() <= VALUE_MAX));
        self.delta.insert(key, value);
        if self.delta.len() >= self.limit {
            self.flush()
        } else {
            Ok(())
        }
    }

    /// The bytes it holds in memory beside the pages of its folder, about.
    pub fn memory(&self) -> usize {
        self.delta
            .iter()
            .map(|(k, v)| 64 + k.len() + v.as_ref().map_or(0, Vec::len))
            .sum::<usize>()
            + self.levels.len() * 64
    }

    /// The rows of each level, the newest first.
    pub fn level_rows(&self) -> Vec<u64> {
        self.levels
            .iter()
            .map(|r| r.as_ref().map_or(0, |r| r.count))
            .collect()
    }

    /// Every row it holds, in order.
    pub fn rows(&self) -> io::Result<Vec<Item>> {
        let mut all: BTreeMap<Vec<u8>, Option<Vec<u8>>> = BTreeMap::new();
        for run in self.levels.iter().rev().flatten() {
            for row in run.rows() {
                let (k, v) = row?;
                all.insert(k, unmarked(&v)?);
            }
        }
        all.extend(self.delta.iter().map(|(k, v)| (k.clone(), v.clone())));
        Ok(all.into_iter().filter_map(|(k, v)| Some((k, v?))).collect())
    }

    /// The changes in memory go into the levels as a run, merged down as the levels fill: a level `l` holds
    /// `limit * GROW^(l + 1)` rows at most.
    fn flush(&mut self) -> io::Result<()> {
        let delta = std::mem::take(&mut self.delta);
        let mut carry: Vec<Item> = delta.iter().map(|(k, v)| (k.clone(), marked(v))).collect();
        let mut carried: Option<Run> = None;
        let mut l = 0;
        loop {
            if self.levels.len() <= l {
                self.levels.push(None);
            }
            let deepest = self.levels[l + 1..].iter().all(Option::is_none);
            let older = self.levels[l].take();
            let run = match (&older, carried.take()) {
                (None, Some(run)) => run,
                (None, None) => {
                    let rows = std::mem::take(&mut carry);
                    Run::build(
                        &self.folder,
                        rows.len() as u64,
                        rows.into_iter().filter(|r| !deepest || r.1 != [0]),
                    )?
                }
                (Some(older), newer) => {
                    let expected =
                        older.count + newer.as_ref().map_or(carry.len() as u64, |r| r.count);
                    let newer_rows: Box<dyn Iterator<Item = io::Result<Item>>> = match &newer {
                        Some(run) => Box::new(run.rows()),
                        None => Box::new(std::mem::take(&mut carry).into_iter().map(Ok)),
                    };
                    let merged = Merged {
                        newer: newer_rows.peekable(),
                        older: older.rows().peekable(),
                    };
                    let mut error = None;
                    let rows = merged.filter_map(|r| r.map_err(|e| error = Some(e)).ok());
                    let run = Run::build(
                        &self.folder,
                        expected,
                        rows.filter(|r| !deepest || r.1 != [0]),
                    )?;
                    if let Some(e) = error {
                        return Err(e);
                    }
                    run
                }
            };
            if run.count == 0 {
                return Ok(());
            }
            let cap = (self.limit as u64).saturating_mul(GROW.saturating_pow(l as u32 + 1));
            if run.count <= cap {
                self.levels[l] = Some(Arc::new(run));
                return Ok(());
            }
            carried = Some(run);
            l += 1;
        }
    }
}

/// Two runs' rows merged in order, the newer's where both hold a key.
struct Merged<A: Iterator<Item = io::Result<Item>>, B: Iterator<Item = io::Result<Item>>> {
    newer: std::iter::Peekable<A>,
    older: std::iter::Peekable<B>,
}

impl<A: Iterator<Item = io::Result<Item>>, B: Iterator<Item = io::Result<Item>>> Iterator
    for Merged<A, B>
{
    type Item = io::Result<Item>;
    fn next(&mut self) -> Option<io::Result<Item>> {
        use std::cmp::Ordering::*;
        let order = match (self.newer.peek(), self.older.peek()) {
            (Some(Ok(a)), Some(Ok(b))) => a.0.cmp(&b.0),
            (Some(Err(_)), _) => return self.newer.next(),
            (_, Some(Err(_))) => return self.older.next(),
            (Some(_), None) => Less,
            (None, Some(_)) => Greater,
            (None, None) => return None,
        };
        match order {
            Less => self.newer.next(),
            Greater => self.older.next(),
            Equal => {
                self.older.next();
                self.newer.next()
            }
        }
    }
}

#[cfg(test)]
impl Folder {
    fn dir(&self) -> &PathBuf {
        match &self.store {
            Store::Dir(dir) => dir,
            Store::Arena(_) => panic!("a space has no folder"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("avendb-pages-{name}-{}", std::process::id()))
    }

    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
    }

    /// Runs hold what a map of the same changes holds, at every step, sets and removals at random, a small memory
    /// limit so that the levels fill and merge many times; a clone keeps what it held as the original changes on.
    #[test]
    fn runs_are_the_map_of_their_changes() {
        let folder = Folder::new(dir("map"), 1 << 20).unwrap();
        let mut runs = Runs::with_limit(&folder, 64);
        let mut want: BTreeMap<Vec<u8>, Vec<u8>> = BTreeMap::new();
        let mut rng = Rng(0x2545_f491_4f6c_dd1d);
        let mut kept = None;
        for step in 0..30_000u32 {
            let k = (rng.next() % 5_000).to_be_bytes().to_vec();
            if rng.next().is_multiple_of(4) {
                want.remove(&k);
                runs.set(k, None).unwrap();
            } else {
                let v = step.to_be_bytes().to_vec();
                want.insert(k.clone(), v.clone());
                runs.set(k, Some(v)).unwrap();
            }
            if step % 997 == 0 {
                let probe = (rng.next() % 5_000).to_be_bytes();
                assert_eq!(
                    runs.get(&probe).unwrap().as_ref(),
                    want.get(&probe[..]),
                    "step {step}"
                );
            }
            if step == 10_000 {
                kept = Some((runs.clone(), want.clone()));
            }
        }
        let rows: BTreeMap<_, _> = runs.rows().unwrap().into_iter().collect();
        assert_eq!(rows, want);
        assert!(
            runs.level_rows().len() >= 2,
            "levels filled and merged: {:?}",
            runs.level_rows()
        );
        let (kept, then) = kept.unwrap();
        assert_eq!(
            kept.rows().unwrap().into_iter().collect::<BTreeMap<_, _>>(),
            then,
            "a clone keeps its runs"
        );
        drop((runs, kept));
        assert_eq!(
            fs::read_dir(folder.dir()).unwrap().count(),
            0,
            "runs nothing names are removed"
        );
        fs::remove_dir_all(folder.dir()).ok();
    }

    /// Each row is written again about once a level, so what a change costs in writes grows with the log of the rows
    /// held, never with the rows themselves; and memory holds the changes in memory and the page budget at most.
    #[test]
    fn a_row_is_written_a_few_times_whatever_the_rows_held() {
        let folder = Folder::new(dir("writes"), 256 << 10).unwrap();
        let mut runs = Runs::with_limit(&folder, 1 << 10);
        let mut rng = Rng(7);
        for _ in 0..200_000u32 {
            let k = rng.next().to_be_bytes().to_vec();
            runs.set(k, Some(vec![7; 44])).unwrap();
        }
        let levels = runs.level_rows();
        assert_eq!(
            levels.iter().sum::<u64>() + runs.delta.len() as u64,
            200_000,
            "{levels:?}"
        );
        assert!(folder.memory() <= (256 << 10) + MOST * 128);
        // the changes in memory alone: the runs' pages and Bloom filters are in the folder
        assert!(
            runs.memory() < 200 << 10,
            "{}",
            runs.memory()
        );
        // a row is about 63 bytes on a page: written again a few times a level, three levels here
        let written = folder.written.load(Ordering::Relaxed);
        let times = written as f64 / (200_000.0 * 63.0);
        assert!(
            times < 20.0,
            "each row written {times:.1} times ({written} bytes), levels {levels:?}"
        );
        let probe = rng.next().to_be_bytes();
        assert_eq!(runs.get(&probe).unwrap(), None);
        fs::remove_dir_all(folder.dir()).ok();
    }

    #[test]
    fn a_page_changed_in_its_folder_is_never_read() {
        let folder = Folder::new(dir("spoiled"), 0).unwrap();
        let mut runs = Runs::with_limit(&folder, 4);
        for k in 0..4u32 {
            runs.set(k.to_be_bytes().to_vec(), Some(vec![1])).unwrap();
        }
        let page = fs::read_dir(folder.dir())
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let file = fs::read_dir(&page)
            .unwrap()
            .map(|f| f.unwrap().path())
            .find(|p| !p.ends_with("bloom"))
            .unwrap();
        // a Bloom filter changed is refused as well
        let bloom = page.join("bloom");
        let held = fs::read(&bloom).unwrap();
        fs::write(&bloom, vec![0xff; held.len()]).unwrap();
        assert_eq!(runs.get(&0u32.to_be_bytes()).unwrap_err().kind(), io::ErrorKind::InvalidData);
        fs::write(&bloom, held).unwrap();
        fs::write(&file, b"avenDB index page 1\nother bytes").unwrap();
        folder.cache.lock().unwrap().at.clear();
        assert_eq!(
            runs.get(&0u32.to_be_bytes()).unwrap_err().kind(),
            io::ErrorKind::InvalidData
        );
        fs::remove_dir_all(folder.dir()).ok();
    }
}
