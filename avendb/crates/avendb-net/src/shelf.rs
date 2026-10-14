//! A node's shelf (`docs/ARCHITECTURE.md` §14): the one place it keeps what lasts, laid out the same
//! on every place it runs. A page's is in OPFS, through its store's worker (avendb-browser); the Mac's in its folder
//! (`disk`); the server's in its bucket (`bucket::shelf`), whose folder is only a cache. A place keeps its shelves side
//! by side, a generation each, `g1`, `g2` and on (`generation`): the newest is the one in use, and every older one is
//! put aside, never read again and never deleted. A shelf holds blobs, each named by its hash once it is finished,
//! with its outboard, the BLAKE3 tree iroh-blobs checks it by; and named objects, each put once and never replaced
//! (`Call::Put`): the edits its device holds, as a journal, packs and heads (`edits`), a page's or the Mac's meta, and
//! the server's device's secret. What a shelf answered it holds, it holds for good: synced to the folder's disk, in
//! OPFS, or in the server's bucket.
//!
//! Over its shelf a node runs a blob store of its own (`ShelfStore`), which iroh-blobs reads and writes:
//!
//! - a piece of a file the node brings goes onto the shelf as it is sealed, its outboard made as it streams in
//!   (`tree::Outboarder`), and counts once the shelf holds it whole under its hash;
//! - a blob the node keeps, one a tag names or that the HashSeq a tag names names, goes onto the shelf as it is
//!   fetched, and counts once whole and finished there: on the server, once its bucket holds it;
//! - what the node fetches of any other blob, as a page reads a stretch of a film, stays in memory, in windows of
//!   `WINDOWS` bytes at most together, the oldest let go first;
//! - the McEliece keys it offers stay in memory, and so does a file's HashSeq, which goes onto the shelf too once a tag
//!   names it;
//! - its tags stay in memory: as a node starts, its keeper tags again what it keeps (`files`), and the shelf lists what
//!   it holds whole. What a shelf holds of a blob it never finished, it drops.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io;
use std::ops::Range;
use std::sync::{Arc, Mutex, MutexGuard};

use bao_tree::blake3;
use bao_tree::blake3::hazmat::{Mode, merge_subtrees_non_root, merge_subtrees_root};
use bao_tree::io::mixed::{EncodedItem, ReadBytesAt, traverse_ranges_validated, traverse_selected_rec};
use bao_tree::io::outboard::PostOrderMemOutboard;
use bao_tree::io::sync::Outboard;
use bao_tree::io::{BaoContentItem, EncodeError, Leaf, Parent};
use bao_tree::iter::BaoChunk;
use bao_tree::{BaoTree, ChunkNum, ChunkRanges, TreeNode};
use bytes::Bytes;
use data_encoding::HEXLOWER;
use iroh_blobs::api::proto::{
    AddProgressItem, Bitfield, BlobStatus, Command, ExportBaoMsg, ExportRangesItem, ExportRangesMsg, ImportBaoMsg,
    ImportByteStreamMsg, ImportByteStreamUpdate, ImportBytesMsg, Request, Scope, TagInfo,
};
use iroh_blobs::api::{self, Store, Tag, TempTag};
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::protocol::ChunkRangesExt as _;
use iroh_blobs::store::IROH_BLOCK_SIZE;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::{BlobFormat, Hash, HashAndFormat};
use n0_future::task;
use range_collections::range_set::RangeSetRange;
use tokio::sync::{mpsc, oneshot};

use crate::tree::{self, Outboarder};

/// How many bytes a node writes to its shelf at a time, and reads from it ahead of what it is asked.
const STEP: usize = 1 << 20;
/// The most bytes its windows hold together.
const WINDOWS: usize = 64 << 20;
/// The most bytes of the outboards of shelved blobs it keeps at hand.
const OUTBOARDS: usize = 32 << 20;
/// A whole window this small, whose blob a tag comes to keep, goes onto the shelf from memory; a bigger one is fetched
/// onto it anew.
const SMALL: u64 = 4 << 20;
/// The bytes of a chunk, the least a window holds of a blob.
const CHUNK: usize = 1024;

/// What a node asks its shelf, each answered on a channel of its own once the shelf holds what it was asked to keep:
/// on the server, once its bucket does. A blob is named by its hash in hex once it is finished, and by a name of the
/// node's choosing while it is written; a named object by a name of its own (`named`).
pub enum Call {
    /// Every blob the shelf holds whole, with its size. It drops what it holds of blobs never finished.
    List(oneshot::Sender<io::Result<Vec<(Hash, u64)>>>),
    /// `len` bytes of blob `name` from byte `at` on, or fewer at its end.
    Read { name: String, at: u64, len: usize, tx: oneshot::Sender<io::Result<Bytes>> },
    /// The outboard of blob `hash`.
    Outboard { hash: Hash, tx: oneshot::Sender<io::Result<Bytes>> },
    /// `bytes` written from byte `at` on of the blob being written as `name`, begun if it isn't yet.
    Write { name: String, at: u64, bytes: Bytes, tx: oneshot::Sender<io::Result<()>> },
    /// The blob written as `name` is whole: blob `hash` of `size` bytes from now on, with `outboard` beside it. On the
    /// server, once its bucket holds both. If the shelf holds `hash` already, it drops `name`.
    Finish { name: String, hash: Hash, size: u64, outboard: Bytes, tx: oneshot::Sender<io::Result<()>> },
    /// Drops blob `name`, being written or finished, with its outboard.
    Drop { name: String, tx: oneshot::Sender<io::Result<()>> },
    /// `bytes` under `name`, put once: answered once the shelf holds them whole. The same bytes put again change
    /// nothing; other bytes under a name it holds are refused (`io::ErrorKind::AlreadyExists`), so that nothing put is
    /// ever replaced.
    Put { name: String, bytes: Bytes, tx: oneshot::Sender<io::Result<()>> },
    /// What was put under `name`, if anything.
    Get { name: String, tx: oneshot::Sender<io::Result<Option<Bytes>>> },
    /// The name of every object put whose name starts with `prefix`, in order.
    Names { prefix: String, tx: oneshot::Sender<io::Result<Vec<String>>> },
}

/// A node's shelf: where it sends its calls, which whoever keeps the shelf answers.
#[derive(Clone, Debug)]
pub struct Shelf(mpsc::Sender<Call>);

/// The folders of a shelf that hold its blobs, their outboards, what it is writing, and the lock a page's worker
/// holds: no named object is under them.
pub const RESERVED: [&str; 4] = ["blobs", "outboards", "new", "lock"];

/// The hash a finished blob's name is, if it is one.
pub fn hash_of(name: &str) -> Option<Hash> {
    let bytes: [u8; 32] = HEXLOWER.decode(name.as_bytes()).ok()?.try_into().ok()?;
    Some(Hash::from_bytes(bytes))
}

/// `name` is one a named object may have: parts parted by `/`, each of lowercase letters, digits, `.`, `_` and `-`,
/// none of them `.` or `..`, the first none of the folders a shelf keeps its blobs in (`RESERVED`). So a name is the
/// same file's on every place, and never leaves its shelf.
pub fn named(name: &str) -> bool {
    let part = |p: &str| {
        let bytes = p.bytes().all(|b| matches!(b, b'a'..=b'z' | b'0'..=b'9' | b'.' | b'_' | b'-'));
        !p.is_empty() && p != "." && p != ".." && bytes
    };
    let first = name.split('/').next().unwrap_or_default();
    !RESERVED.contains(&first) && name.split('/').all(part)
}

/// `prefix` is one names may be listed by: none, or a name, with `/` after it or not.
fn listable(prefix: &str) -> bool {
    prefix.is_empty() || named(prefix.strip_suffix('/').unwrap_or(prefix))
}

/// The generation every place's shelf is at least: avenDB's resets raise it, and a place whose newest shelf is of an
/// older one puts it aside as it opens, never deleting it, and starts a new one of this generation, empty: the server's
/// bucket (`bucket::shelf`), the Mac's folder (`disk::open`) and a page's OPFS (avendb-browser's `store.worker.js`,
/// whose `FLOOR` is this). 2 since 2026-10-14, as the claim of a server founds the seed of Maia Holding GmbH,
/// avenCEO GmbH and the CEO Aven (`avendb::world::SEED`).
pub const FLOOR: u64 = 2;

/// The generation a place's shelf is, by the name of its folder or prefix: `g1`, `g2` and on, written as the number
/// is, if it is one.
pub fn generation(name: &str) -> Option<u64> {
    let n = name.strip_prefix('g')?;
    let digits = !n.is_empty() && !n.starts_with('0') && n.bytes().all(|b| b.is_ascii_digit());
    digits.then(|| n.parse().ok()).flatten()
}

fn gone() -> io::Error {
    io::Error::new(io::ErrorKind::BrokenPipe, "the shelf is gone")
}

fn missing(name: &str) -> io::Error {
    io::Error::new(io::ErrorKind::NotFound, format!("no blob {name} on the shelf"))
}

fn unnamed(name: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, format!("{name:?} names nothing a shelf holds"))
}

impl Shelf {
    /// A shelf, and the calls to it, for whoever keeps it to answer.
    pub fn new() -> (Shelf, mpsc::Receiver<Call>) {
        let (tx, rx) = mpsc::channel(16);
        (Shelf(tx), rx)
    }

    async fn ask<T>(&self, call: impl FnOnce(oneshot::Sender<io::Result<T>>) -> Call) -> io::Result<T> {
        let (tx, rx) = oneshot::channel();
        self.0.send(call(tx)).await.map_err(|_| gone())?;
        rx.await.map_err(|_| gone())?
    }

    /// Puts `bytes` under `name` once, as `Call::Put` says: done once the shelf holds them.
    pub async fn put(&self, name: &str, bytes: Bytes) -> io::Result<()> {
        if !named(name) {
            return Err(unnamed(name));
        }
        self.ask(|tx| Call::Put { name: name.to_string(), bytes, tx }).await
    }

    /// What was put under `name`, if anything.
    pub async fn get(&self, name: &str) -> io::Result<Option<Bytes>> {
        if !named(name) {
            return Err(unnamed(name));
        }
        self.ask(|tx| Call::Get { name: name.to_string(), tx }).await
    }

    /// The name of every object put whose name starts with `prefix`, in order.
    pub async fn names(&self, prefix: &str) -> io::Result<Vec<String>> {
        if !listable(prefix) {
            return Err(unnamed(prefix));
        }
        self.ask(|tx| Call::Names { prefix: prefix.to_string(), tx }).await
    }

    pub(crate) async fn list(&self) -> io::Result<Vec<(Hash, u64)>> {
        self.ask(Call::List).await
    }

    pub(crate) async fn read(&self, name: &str, at: u64, len: usize) -> io::Result<Bytes> {
        self.ask(|tx| Call::Read { name: name.to_string(), at, len, tx }).await
    }

    pub(crate) async fn outboard(&self, hash: Hash) -> io::Result<Bytes> {
        self.ask(|tx| Call::Outboard { hash, tx }).await
    }

    pub(crate) async fn write(&self, name: &str, at: u64, bytes: Bytes) -> io::Result<()> {
        self.ask(|tx| Call::Write { name: name.to_string(), at, bytes, tx }).await
    }

    pub(crate) async fn finish(&self, name: &str, hash: Hash, size: u64, outboard: Bytes) -> io::Result<()> {
        self.ask(|tx| Call::Finish { name: name.to_string(), hash, size, outboard, tx }).await
    }

    pub(crate) async fn drop(&self, name: &str) -> io::Result<()> {
        self.ask(|tx| Call::Drop { name: name.to_string(), tx }).await
    }

    /// `bytes` as a blob on the shelf, written a step at a time and finished: its hash and size, once the shelf holds
    /// it whole. What it wrote of a blob it couldn't finish, it drops.
    pub(crate) async fn put_blob(&self, bytes: &Bytes) -> io::Result<(Hash, u64)> {
        let mut tree = Outboarder::new();
        tree.push(bytes);
        let (hash, size, outboard) = tree.finish();
        let name = fresh();
        let written = async {
            for at in (0..bytes.len()).step_by(STEP) {
                self.write(&name, at as u64, bytes.slice(at..(at + STEP).min(bytes.len()))).await?;
            }
            self.finish(&name, hash, size, outboard.into()).await
        };
        if let Err(e) = written.await {
            self.drop(&name).await.ok();
            return Err(e);
        }
        Ok((hash, size))
    }

    /// Blob `hash` of `size` bytes, read whole a step at a time, and checked against its hash.
    pub(crate) async fn read_blob(&self, hash: Hash, size: u64) -> io::Result<Bytes> {
        let name = hash.to_hex();
        let mut out = Vec::with_capacity(size as usize);
        while (out.len() as u64) < size {
            let len = STEP.min((size - out.len() as u64) as usize);
            let bytes = self.read(&name, out.len() as u64, len).await?;
            if bytes.is_empty() {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, format!("blob {name} is cut short")));
            }
            out.extend_from_slice(&bytes);
        }
        if Hash::new(&out) != hash {
            return Err(io::Error::new(io::ErrorKind::InvalidData, format!("blob {name} isn't what its hash says")));
        }
        Ok(out.into())
    }
}

/// A name for a blob being written, of the node's own choosing.
fn fresh() -> String {
    let mut n = [0; 8];
    getrandom::fill(&mut n).expect("randomness");
    format!("new-{}", HEXLOWER.encode(&n))
}

/// A node's blob store over its shelf, as the module says: an iroh-blobs store of its own.
#[derive(Clone)]
pub(crate) struct ShelfStore(Arc<Inner>);

struct Inner {
    shelf: Shelf,
    state: Mutex<State>,
}

/// What a node's blob store holds.
#[derive(Default)]
struct State {
    blobs: HashMap<Hash, Blob>,
    /// Each tag, with what it names and the blobs it keeps: those, and the children of a HashSeq.
    tags: BTreeMap<Tag, (HashAndFormat, Vec<Hash>)>,
    /// How many tags keep each blob kept.
    kept: HashMap<Hash, usize>,
    /// The windows' chunks in the order they came, each by its blob, its number in it and its count, the oldest first.
    arrived: VecDeque<(Hash, u64, u64)>,
    /// How many bytes the windows hold, and how many chunks came to them so far.
    windowed: usize,
    count: u64,
    /// The outboards of shelved blobs at hand, the oldest first, and how many bytes they hold.
    outboards: HashMap<Hash, Bytes>,
    outboarded: VecDeque<Hash>,
    outboard_bytes: usize,
    /// How many tags it made up names for.
    named: u64,
}

enum Blob {
    /// Whole in memory, with its outboard; on the shelf too, once `shelved`.
    Small { data: Bytes, outboard: Bytes, shelved: bool },
    /// Whole on the shelf.
    Shelved { size: u64 },
    /// Stretches of it in memory, as they were fetched.
    Window(Window),
    /// A blob kept, going onto the shelf as it is fetched.
    Filling(Filling),
}

/// Stretches of a blob in memory: each chunk by its number, with its count among the windows' chunks, and the pairs of
/// hashes of the parents fetched with them.
struct Window {
    size: u64,
    chunks: BTreeMap<u64, (Bytes, u64)>,
    parents: HashMap<TreeNode, (blake3::Hash, blake3::Hash)>,
}

/// A blob kept, being written onto the shelf as `name` as it is fetched: the chunks the shelf holds, and its outboard
/// so far, each parent's pair in its place, with which are in place.
struct Filling {
    name: String,
    size: u64,
    have: ChunkRanges,
    outboard: Vec<u8>,
    placed: Vec<bool>,
    /// It is whole, and being finished.
    finishing: bool,
}

impl Filling {
    fn new(size: u64) -> Filling {
        let pairs = BaoTree::new(size, IROH_BLOCK_SIZE).outboard_size() as usize / 64;
        let (outboard, placed) = (vec![0; pairs * 64], vec![false; pairs]);
        Filling { name: fresh(), size, have: ChunkRanges::empty(), outboard, placed, finishing: false }
    }

    /// Whether the shelf holds every chunk of it now, and none finishes it yet: if so, the caller does.
    fn ready(&mut self) -> bool {
        let whole = ChunkRanges::from(..ChunkNum::chunks(self.size)).is_subset(&self.have);
        let ready = whole && !self.finishing;
        self.finishing |= ready;
        ready
    }
}

/// Where the bytes of a blob are, to be read.
enum Source {
    Memory { data: Bytes, outboard: Bytes },
    /// On the shelf as `name`: whole, or `have` of it.
    Shelf { name: String, size: u64, have: Option<ChunkRanges> },
    Window { size: u64, chunks: BTreeMap<u64, Bytes>, parents: HashMap<TreeNode, (blake3::Hash, blake3::Hash)> },
    None,
}

impl Source {
    fn size(&self) -> Option<u64> {
        match self {
            Source::Memory { data, .. } => Some(data.len() as u64),
            Source::Shelf { size, .. } | Source::Window { size, .. } => Some(*size),
            Source::None => None,
        }
    }
}

impl State {
    fn keeps(&self, hash: &Hash) -> bool {
        self.kept.contains_key(hash)
    }

    /// Puts `blob` in place of what it holds of `hash`, if anything, which it returns.
    fn put(&mut self, hash: Hash, blob: Blob) -> Option<Blob> {
        let old = self.blobs.insert(hash, blob);
        if let Some(Blob::Window(w)) = &old {
            self.windowed -= w.chunks.values().map(|(c, _)| c.len()).sum::<usize>();
        }
        old
    }

    /// Lets go of what it holds of `hash`.
    fn take(&mut self, hash: &Hash) -> Option<Blob> {
        let old = self.blobs.remove(hash);
        if let Some(Blob::Window(w)) = &old {
            self.windowed -= w.chunks.values().map(|(c, _)| c.len()).sum::<usize>();
        }
        old
    }

    /// Blob `hash` of `size` bytes as what arrives of it lands: in a window, or, if a tag keeps it, onto the shelf;
    /// unless it is whole already.
    fn landing(&mut self, hash: Hash, size: u64) {
        if !self.blobs.contains_key(&hash) {
            let blob = match self.keeps(&hash) {
                true => Blob::Filling(Filling::new(size)),
                false => Blob::Window(Window::new(size)),
            };
            self.blobs.insert(hash, blob);
        }
    }

    /// A parent of blob `hash` of `size` bytes, as fetched.
    fn parent(&mut self, hash: Hash, size: u64, tree: &BaoTree, Parent { node, pair }: Parent) {
        self.landing(hash, size);
        match self.blobs.get_mut(&hash) {
            Some(Blob::Window(w)) if tree.pre_order_offset(node).is_some() => {
                w.parents.insert(node, pair);
            }
            Some(Blob::Filling(f)) => {
                let Some(at) = tree.post_order_offset(node).map(|o| o.value() as usize) else { return };
                if at < f.placed.len() {
                    f.outboard[at * 64..at * 64 + 32].copy_from_slice(pair.0.as_bytes());
                    f.outboard[at * 64 + 32..at * 64 + 64].copy_from_slice(pair.1.as_bytes());
                    f.placed[at] = true;
                }
            }
            _ => {}
        }
    }

    /// A leaf of blob `hash` of `size` bytes, as fetched: kept in its window, or, if the blob is going onto the shelf,
    /// the name it is written as there, for the caller to write it.
    fn leaf(&mut self, hash: Hash, size: u64, leaf: &Leaf) -> Option<String> {
        self.landing(hash, size);
        let w = match self.blobs.get_mut(&hash) {
            Some(Blob::Window(w)) => w,
            Some(Blob::Filling(f)) => return Some(f.name.clone()),
            _ => return None,
        };
        let first = leaf.offset / CHUNK as u64;
        for (i, at) in (0..leaf.data.len()).step_by(CHUNK).enumerate() {
            let chunk = leaf.data.slice(at..(at + CHUNK).min(leaf.data.len()));
            self.count += 1;
            self.windowed += chunk.len();
            if let Some((old, _)) = w.chunks.insert(first + i as u64, (chunk, self.count)) {
                self.windowed -= old.len();
            }
            self.arrived.push_back((hash, first + i as u64, self.count));
        }
        self.evict();
        None
    }

    /// Lets go of the windows' oldest chunks while they hold more than `WINDOWS` bytes together, and of a window with
    /// none left.
    fn evict(&mut self) {
        while self.windowed > WINDOWS {
            let Some((hash, n, count)) = self.arrived.pop_front() else { break };
            let Some(Blob::Window(w)) = self.blobs.get_mut(&hash) else { continue };
            if w.chunks.get(&n).is_some_and(|(_, c)| *c == count) {
                let (chunk, _) = w.chunks.remove(&n).expect("the chunk");
                self.windowed -= chunk.len();
                if w.chunks.is_empty() {
                    self.blobs.remove(&hash);
                }
            }
        }
        // chunks that left their windows otherwise, which the queue still names
        if self.arrived.len() > 4 * (WINDOWS / CHUNK) {
            let blobs = &self.blobs;
            let live = |(hash, n, count): &(Hash, u64, u64)| match blobs.get(hash) {
                Some(Blob::Window(w)) => w.chunks.get(n).is_some_and(|(_, c)| c == count),
                _ => false,
            };
            self.arrived.retain(live);
        }
    }

    /// The shelf holds `range` of blob `hash`, being written as `name`: true if it is whole now, for the caller to
    /// finish.
    fn wrote(&mut self, hash: Hash, name: &str, range: Range<u64>) -> bool {
        let Some(Blob::Filling(f)) = self.blobs.get_mut(&hash) else { return false };
        if f.name != name {
            return false;
        }
        f.have |= ChunkRanges::from(ChunkNum::chunks(range.start)..ChunkNum::chunks(range.end));
        f.ready()
    }

    /// Keeps the outboard of shelved blob `hash` at hand, letting go of the oldest beyond `OUTBOARDS` bytes.
    fn remember(&mut self, hash: Hash, outboard: Bytes) {
        self.outboard_bytes += outboard.len();
        if let Some(old) = self.outboards.insert(hash, outboard) {
            self.outboard_bytes -= old.len();
        } else {
            self.outboarded.push_back(hash);
        }
        while self.outboard_bytes > OUTBOARDS {
            let Some(old) = self.outboarded.pop_front() else { break };
            self.outboard_bytes -= self.outboards.remove(&old).map_or(0, |o| o.len());
        }
    }

    fn source(&self, hash: &Hash) -> Source {
        match self.blobs.get(hash) {
            Some(Blob::Small { data, outboard, .. }) => {
                Source::Memory { data: data.clone(), outboard: outboard.clone() }
            }
            Some(Blob::Shelved { size }) => Source::Shelf { name: hash.to_hex(), size: *size, have: None },
            Some(Blob::Filling(f)) => Source::Shelf { name: f.name.clone(), size: f.size, have: Some(f.have.clone()) },
            Some(Blob::Window(w)) => Source::Window {
                size: w.size,
                chunks: w.chunks.iter().map(|(n, (c, _))| (*n, c.clone())).collect(),
                parents: w.parents.clone(),
            },
            None => Source::None,
        }
    }

    fn bitfield(&self, hash: &Hash) -> Bitfield {
        match self.blobs.get(hash) {
            Some(Blob::Small { data, .. }) => Bitfield::complete(data.len() as u64),
            Some(Blob::Shelved { size }) => Bitfield::complete(*size),
            Some(Blob::Filling(f)) => Bitfield::new(f.have.clone(), f.size),
            Some(Blob::Window(w)) => Bitfield::new(w.ranges(), w.size),
            None => Bitfield::empty(),
        }
    }

    fn status(&self, hash: &Hash) -> BlobStatus {
        match self.blobs.get(hash) {
            Some(Blob::Small { data, .. }) => BlobStatus::Complete { size: data.len() as u64 },
            Some(Blob::Shelved { size }) => BlobStatus::Complete { size: *size },
            Some(Blob::Filling(Filling { size, .. }) | Blob::Window(Window { size, .. })) => {
                BlobStatus::Partial { size: Some(*size) }
            }
            None => BlobStatus::NotFound,
        }
    }

    /// Tag `name` names nothing any more: the blobs it kept, it keeps no more.
    fn untag(&mut self, name: &Tag) -> bool {
        let Some((value, children)) = self.tags.remove(name) else { return false };
        for hash in std::iter::once(value.hash).chain(children) {
            if let Some(n) = self.kept.get_mut(&hash) {
                *n -= 1;
                if *n == 0 {
                    self.kept.remove(&hash);
                }
            }
        }
        true
    }

    /// Tag `name` names `value`, and keeps it and `children`.
    fn tag(&mut self, name: Tag, value: HashAndFormat, children: Vec<Hash>) {
        self.untag(&name);
        for hash in std::iter::once(value.hash).chain(children.iter().copied()) {
            *self.kept.entry(hash).or_default() += 1;
        }
        self.tags.insert(name, (value, children));
    }
}

impl Window {
    fn new(size: u64) -> Window {
        Window { size, chunks: BTreeMap::new(), parents: HashMap::new() }
    }

    /// The chunks it holds.
    fn ranges(&self) -> ChunkRanges {
        let mut ranges = ChunkRanges::empty();
        let mut run: Option<(u64, u64)> = None;
        for &n in self.chunks.keys() {
            run = match run {
                Some((from, to)) if to == n => Some((from, n + 1)),
                Some((from, to)) => {
                    ranges |= ChunkRanges::from(ChunkNum(from)..ChunkNum(to));
                    Some((n, n + 1))
                }
                None => Some((n, n + 1)),
            };
        }
        if let Some((from, to)) = run {
            ranges |= ChunkRanges::from(ChunkNum(from)..ChunkNum(to));
        }
        ranges
    }

    /// Its blob, if it holds every byte of it and it is `SMALL` at most.
    fn whole(&self) -> Option<Bytes> {
        let chunks = ChunkNum::chunks(self.size).0;
        if self.size > SMALL || (0..chunks).any(|n| !self.chunks.contains_key(&n)) {
            return None;
        }
        Some(self.chunks.values().flat_map(|(c, _)| c.iter().copied()).collect::<Vec<u8>>().into())
    }
}

/// A window's chunks, read as one blob's bytes.
struct Chunks(BTreeMap<u64, Bytes>);

impl ReadBytesAt for Chunks {
    fn read_bytes_at(&self, offset: u64, size: usize) -> io::Result<Bytes> {
        let mut out = Vec::with_capacity(size);
        let mut n = offset / CHUNK as u64;
        while out.len() < size {
            let lacking = || io::Error::new(io::ErrorKind::UnexpectedEof, "a stretch not in the window");
            let chunk = self.0.get(&n).ok_or_else(lacking)?;
            let skip = if out.is_empty() { (offset % CHUNK as u64) as usize } else { 0 };
            let take = chunk.len().saturating_sub(skip).min(size - out.len());
            if take == 0 {
                return Err(lacking());
            }
            out.extend_from_slice(&chunk[skip..skip + take]);
            n += 1;
        }
        Ok(out.into())
    }
}

/// A window's parents, read as its blob's outboard: one not fetched is an error.
struct Parents {
    root: blake3::Hash,
    tree: BaoTree,
    pairs: HashMap<TreeNode, (blake3::Hash, blake3::Hash)>,
}

impl Outboard for Parents {
    fn root(&self) -> blake3::Hash {
        self.root
    }

    fn tree(&self) -> BaoTree {
        self.tree
    }

    fn load(&self, node: TreeNode) -> io::Result<Option<(blake3::Hash, blake3::Hash)>> {
        let lacking = || io::Error::new(io::ErrorKind::NotFound, "a parent not in the window");
        self.pairs.get(&node).copied().map(Some).ok_or_else(lacking)
    }
}

/// The channel an encoding goes out on, as bao-tree sends one.
struct Items<'a>(&'a mut irpc::channel::mpsc::Sender<EncodedItem>);

impl bao_tree::io::mixed::Sender for Items<'_> {
    type Error = irpc::channel::SendError;

    async fn send(&mut self, item: EncodedItem) -> Result<(), Self::Error> {
        self.0.send(item).await
    }
}

/// Why an encoding stopped early: what it read didn't check out, or nobody takes it any more.
enum Stop {
    Encode(EncodeError),
    Gone,
}

impl From<EncodeError> for Stop {
    fn from(e: EncodeError) -> Stop {
        Stop::Encode(e)
    }
}

impl From<io::Error> for Stop {
    fn from(e: io::Error) -> Stop {
        Stop::Encode(EncodeError::Io(e))
    }
}

impl From<irpc::channel::SendError> for Stop {
    fn from(_: irpc::channel::SendError) -> Stop {
        Stop::Gone
    }
}

/// A shelved blob's bytes, read from the shelf a step ahead of what is asked.
struct Reader<'a> {
    shelf: &'a Shelf,
    name: String,
    size: u64,
    at: u64,
    read: Bytes,
}

impl Reader<'_> {
    async fn bytes(&mut self, at: u64, len: usize) -> io::Result<Bytes> {
        let end = at + len as u64;
        if at < self.at || end > self.at + self.read.len() as u64 {
            let ahead = (len.max(STEP) as u64).min(self.size.saturating_sub(at)) as usize;
            (self.at, self.read) = (at, self.shelf.read(&self.name, at, ahead).await?);
            if self.read.len() < len {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, format!("{} ends early", self.name)));
            }
        }
        Ok(self.read.slice((at - self.at) as usize..(end - self.at) as usize))
    }
}

/// The parent of `left` and `right`.
fn parent_cv(left: &blake3::Hash, right: &blake3::Hash, root: bool) -> blake3::Hash {
    let (left, right) = (left.as_bytes(), right.as_bytes());
    if root {
        merge_subtrees_root(left, right, Mode::Hash)
    } else {
        merge_subtrees_non_root(left, right, Mode::Hash).into()
    }
}

fn unsupported(what: &str) -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, format!("a node's blob store takes no {what}"))
}

impl ShelfStore {
    /// A blob store over `shelf`, holding what it lists whole; and the store as iroh-blobs uses it.
    pub(crate) async fn open(shelf: Shelf) -> io::Result<(ShelfStore, Store)> {
        let blobs = shelf.list().await?.into_iter().map(|(hash, size)| (hash, Blob::Shelved { size })).collect();
        let inner = Arc::new(Inner { shelf, state: Mutex::new(State { blobs, ..State::default() }) });
        let (tx, rx) = mpsc::channel(32);
        task::spawn(run(inner.clone(), rx));
        let client = irpc::Client::<Request>::from(tx);
        Ok((ShelfStore(inner), MemStore::from_sender(client).into()))
    }

    /// Whether its shelf holds blob `hash` whole: on the server, its bucket.
    pub(crate) fn shelved(&self, hash: &Hash) -> bool {
        matches!(self.0.lock().blobs.get(hash), Some(Blob::Shelved { .. } | Blob::Small { shelved: true, .. }))
    }
}

/// Handles each command on a task of its own, until it is shut down.
async fn run(inner: Arc<Inner>, mut commands: mpsc::Receiver<Command>) {
    while let Some(command) = commands.recv().await {
        if let Command::Shutdown(m) = command {
            m.tx.send(()).await.ok();
            break;
        }
        let inner = inner.clone();
        task::spawn(async move { inner.handle(command).await });
    }
}

impl Inner {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().expect("the blob store")
    }

    async fn handle(self: Arc<Self>, command: Command) {
        match command {
            Command::ImportBytes(m) => self.import_bytes(m).await,
            Command::ImportByteStream(m) => self.import_stream(m).await,
            Command::ImportBao(m) => self.import_bao(m).await,
            Command::ImportPath(m) => {
                m.tx.send(unsupported("paths").into()).await.ok();
            }
            Command::ExportBao(m) => self.export_bao(m).await,
            Command::ExportRanges(m) => self.export_ranges(m).await,
            Command::ExportPath(m) => {
                m.tx.send(api::Error::from(unsupported("paths")).into()).await.ok();
            }
            Command::Observe(m) => {
                let bitfield = self.lock().bitfield(&m.inner.hash);
                m.tx.send(bitfield).await.ok();
            }
            Command::BlobStatus(m) => {
                // a blob the shelf holds whole, which a fetch that failed as it ended didn't finish, it finishes now
                let hash = m.inner.hash;
                let ready = match self.lock().blobs.get_mut(&hash) {
                    Some(Blob::Filling(f)) => f.ready(),
                    _ => false,
                };
                if ready && let Err(e) = self.finish(hash).await {
                    tracing::debug!("avendb: blob {hash} isn't finished: {e}");
                }
                let status = self.lock().status(&hash);
                m.tx.send(status).await.ok();
            }
            Command::ListBlobs(m) => {
                let whole =
                    |(h, b): (&Hash, &Blob)| matches!(b, Blob::Small { .. } | Blob::Shelved { .. }).then_some(*h);
                let hashes: Vec<Hash> = self.lock().blobs.iter().filter_map(whole).collect();
                for hash in hashes {
                    if m.tx.send(Ok(hash)).await.is_err() {
                        break;
                    }
                }
            }
            Command::DeleteBlobs(m) => {
                let deleted = self.delete(m.inner.hashes, m.inner.force).await;
                m.tx.send(deleted.map_err(api::Error::from)).await.ok();
            }
            Command::Batch(m) => {
                m.tx.send(Scope::GLOBAL).await.ok();
            }
            Command::SetTag(m) => {
                let set = self.set_tag(m.inner.name, m.inner.value).await;
                m.tx.send(set.map_err(api::Error::from)).await.ok();
            }
            Command::CreateTag(m) => {
                let name = {
                    let mut state = self.lock();
                    state.named += 1;
                    Tag::from(format!("auto-{}", state.named))
                };
                let set = self.set_tag(name.clone(), m.inner.value).await;
                m.tx.send(set.map(|()| name).map_err(api::Error::from)).await.ok();
            }
            Command::RenameTag(m) => {
                let renamed = {
                    let mut state = self.lock();
                    match state.tags.remove(&m.inner.from) {
                        Some((value, children)) => {
                            state.untag(&m.inner.to);
                            state.tags.insert(m.inner.to, (value, children));
                            Ok(())
                        }
                        None => Err(api::Error::io(io::ErrorKind::NotFound, "no such tag")),
                    }
                };
                m.tx.send(renamed).await.ok();
            }
            Command::DeleteTags(m) => {
                let deleted = {
                    let mut state = self.lock();
                    let (from, to) = (m.inner.from, m.inner.to);
                    let within =
                        |t: &Tag| from.as_ref().is_none_or(|f| t >= f) && to.as_ref().is_none_or(|end| t < end);
                    let names: Vec<Tag> = state.tags.keys().filter(|t| within(t)).cloned().collect();
                    names.iter().filter(|t| state.untag(t)).count() as u64
                };
                m.tx.send(Ok(deleted)).await.ok();
            }
            Command::ListTags(m) => {
                let tags = {
                    let state = self.lock();
                    let r = &m.inner;
                    let within = |t: &Tag| {
                        r.from.as_ref().is_none_or(|f| t >= f) && r.to.as_ref().is_none_or(|end| t < end)
                    };
                    let shown = |v: &HashAndFormat| if v.format.is_raw() { r.raw } else { r.hash_seq };
                    let tags = state.tags.iter().filter(|(t, (v, _))| within(t) && shown(v));
                    tags.map(|(t, (v, _))| Ok(TagInfo::new(t.clone(), *v))).collect()
                };
                m.tx.send(tags).await.ok();
            }
            Command::ListTempTags(m) => {
                m.tx.send(Vec::new()).await.ok();
            }
            Command::CreateTempTag(m) => {
                m.tx.send(TempTag::new(m.inner.value, None)).await.ok();
            }
            Command::SyncDb(m) => {
                m.tx.send(Ok(())).await.ok();
            }
            Command::ClearProtected(m) => {
                m.tx.send(Ok(())).await.ok();
            }
            Command::WaitIdle(m) => {
                m.tx.send(()).await.ok();
            }
            Command::Shutdown(m) => {
                m.tx.send(()).await.ok();
            }
        }
    }

    /// Bytes handed whole, as a McEliece key or a file's HashSeq: kept in memory, and onto the shelf too if a tag keeps
    /// them.
    async fn import_bytes(self: &Arc<Self>, m: ImportBytesMsg) {
        let (data, format) = (m.inner.data, m.inner.format);
        let size = data.len() as u64;
        let tree = PostOrderMemOutboard::create(&data, IROH_BLOCK_SIZE);
        let hash = Hash::from(tree.root);
        let kept = {
            let mut state = self.lock();
            match state.blobs.get_mut(&hash) {
                Some(Blob::Small { .. }) => {}
                Some(Blob::Shelved { .. }) => {
                    let outboard = Bytes::from(tree.data);
                    state.put(hash, Blob::Small { data, outboard, shelved: true });
                }
                _ => {
                    let small = Blob::Small { data, outboard: tree.data.into(), shelved: false };
                    if let Some(Blob::Filling(f)) = state.put(hash, small) {
                        let (shelf, name) = (self.shelf.clone(), f.name);
                        task::spawn(async move { shelf.drop(&name).await.ok() });
                    }
                }
            }
            state.keeps(&hash)
        };
        if kept && let Err(e) = self.shelve(hash).await {
            m.tx.send(e.into()).await.ok();
            return;
        }
        m.tx.send(AddProgressItem::Size(size)).await.ok();
        m.tx.send(AddProgressItem::CopyDone).await.ok();
        m.tx.send(AddProgressItem::Done(TempTag::new(HashAndFormat { hash, format }, None))).await.ok();
    }

    /// Bytes as they stream in, a piece of a file the node brings: onto the shelf as they come, their outboard made as
    /// they do, and finished there under their hash.
    async fn import_stream(self: &Arc<Self>, mut m: ImportByteStreamMsg) {
        let (name, format) = (fresh(), m.inner.format);
        let stored = async {
            let (mut outboarder, mut run, mut at) = (Outboarder::new(), Vec::with_capacity(STEP), 0);
            loop {
                match m.rx.recv().await? {
                    Some(ImportByteStreamUpdate::Bytes(bytes)) => {
                        outboarder.push(&bytes);
                        run.extend_from_slice(&bytes);
                        if run.len() >= STEP {
                            let run = std::mem::replace(&mut run, Vec::with_capacity(STEP));
                            let n = run.len() as u64;
                            self.shelf.write(&name, at, run.into()).await?;
                            at += n;
                        }
                    }
                    Some(ImportByteStreamUpdate::Done) => break,
                    None => return Err(io::Error::other("the stream ended before its end")),
                }
            }
            if !run.is_empty() {
                self.shelf.write(&name, at, run.into()).await?;
            }
            let (hash, size, outboard) = outboarder.finish();
            let outboard = Bytes::from(outboard);
            self.shelf.finish(&name, hash, size, outboard.clone()).await?;
            let mut state = self.lock();
            match state.blobs.get_mut(&hash) {
                Some(Blob::Small { shelved, .. }) => *shelved = true,
                _ => {
                    state.put(hash, Blob::Shelved { size });
                }
            }
            state.remember(hash, outboard);
            Ok::<_, io::Error>((hash, size))
        };
        match stored.await {
            Ok((hash, size)) => {
                m.tx.send(AddProgressItem::Size(size)).await.ok();
                m.tx.send(AddProgressItem::CopyDone).await.ok();
                m.tx.send(AddProgressItem::Done(TempTag::new(HashAndFormat { hash, format }, None))).await.ok();
            }
            Err(e) => {
                self.shelf.drop(&name).await.ok();
                m.tx.send(e.into()).await.ok();
            }
        }
    }

    /// What a peer hands over of a blob, checked already against its hash as it arrived: into a window, or, for a
    /// blob kept, onto the shelf, a step at a time, finished there once whole.
    async fn import_bao(self: &Arc<Self>, mut m: ImportBaoMsg) {
        let (hash, size) = (m.inner.hash, m.inner.size.get());
        let imported = async {
            let tree = BaoTree::new(size, IROH_BLOCK_SIZE);
            // leaves on their way to the shelf, one after the other: the name, where they start, and their bytes
            let mut run: Option<(String, u64, Vec<u8>)> = None;
            let mut whole = false;
            while let Some(item) = m.rx.recv().await? {
                match item {
                    BaoContentItem::Parent(parent) => self.lock().parent(hash, size, &tree, parent),
                    BaoContentItem::Leaf(leaf) => {
                        let Some(name) = self.lock().leaf(hash, size, &leaf) else { continue };
                        let follows =
                            run.as_ref().is_some_and(|(n, at, b)| *n == name && at + b.len() as u64 == leaf.offset);
                        if !follows && let Some((n, at, bytes)) = run.take() {
                            whole |= self.write(hash, &n, at, bytes).await?;
                        }
                        let (_, _, bytes) = run.get_or_insert_with(|| (name, leaf.offset, Vec::with_capacity(STEP)));
                        bytes.extend_from_slice(&leaf.data);
                        if bytes.len() >= STEP {
                            let (n, at, bytes) = run.take().expect("a run");
                            whole |= self.write(hash, &n, at, bytes).await?;
                        }
                    }
                }
            }
            if let Some((n, at, bytes)) = run.take() {
                whole |= self.write(hash, &n, at, bytes).await?;
            }
            if whole {
                self.finish(hash).await?;
            }
            Ok::<_, io::Error>(())
        };
        m.tx.send(imported.await.map_err(api::Error::from)).await.ok();
    }

    /// Writes `bytes` from `at` on of blob `hash`, being written as `name`: true if it is whole now, for the caller
    /// to finish.
    async fn write(&self, hash: Hash, name: &str, at: u64, bytes: Vec<u8>) -> io::Result<bool> {
        let end = at + bytes.len() as u64;
        self.shelf.write(name, at, bytes.into()).await?;
        Ok(self.lock().wrote(hash, name, at..end))
    }

    /// Finishes blob `hash`, whole on the shelf: under its hash, with its outboard, made anew from its bytes if a
    /// parent didn't arrive. Then it counts.
    async fn finish(self: &Arc<Self>, hash: Hash) -> io::Result<()> {
        let (name, size, outboard) = {
            let state = self.lock();
            let Some(Blob::Filling(f)) = state.blobs.get(&hash) else { return Ok(()) };
            let outboard = f.placed.iter().all(|p| *p).then(|| Bytes::from(f.outboard.clone()));
            (f.name.clone(), f.size, outboard)
        };
        let finished = async {
            let outboard = match outboard {
                Some(outboard) => outboard,
                None => self.rehash(&name, hash, size).await?,
            };
            self.shelf.finish(&name, hash, size, outboard.clone()).await?;
            Ok::<_, io::Error>(outboard)
        };
        match finished.await {
            Ok(outboard) => {
                {
                    let mut state = self.lock();
                    state.put(hash, Blob::Shelved { size });
                    state.remember(hash, outboard);
                }
                self.learn(hash).await;
                Ok(())
            }
            Err(e) => {
                if let Some(Blob::Filling(f)) = self.lock().blobs.get_mut(&hash) {
                    f.finishing = false;
                }
                Err(e)
            }
        }
    }

    /// The outboard of blob `hash` of `size` bytes, being written as `name`, made anew from its bytes on the shelf,
    /// which must hash to it.
    async fn rehash(&self, name: &str, hash: Hash, size: u64) -> io::Result<Bytes> {
        let (mut outboarder, mut at) = (Outboarder::new(), 0);
        while at < size {
            let bytes = self.shelf.read(name, at, STEP.min((size - at) as usize)).await?;
            if bytes.is_empty() {
                return Err(io::Error::new(io::ErrorKind::UnexpectedEof, format!("{name} ends early")));
            }
            outboarder.push(&bytes);
            at += bytes.len() as u64;
        }
        let (got, _, outboard) = outboarder.finish();
        if got != hash {
            self.shelf.drop(name).await.ok();
            self.lock().take(&hash);
            return Err(io::Error::other(format!("{name} on the shelf doesn't hash to {hash}")));
        }
        Ok(outboard.into())
    }

    /// The children of HashSeq `hash`, if it holds it whole.
    async fn children(&self, hash: Hash) -> Option<Vec<Hash>> {
        let source = self.lock().source(&hash);
        let bytes = match source {
            Source::Memory { data, .. } => data,
            Source::Window { size, chunks, .. } => Chunks(chunks).read_bytes_at(0, size as usize).ok()?,
            Source::Shelf { name, size, have: None } => self.shelf.read(&name, 0, size as usize).await.ok()?,
            _ => return None,
        };
        Some(HashSeq::new(bytes)?.iter().collect())
    }

    /// Blob `hash` is whole now: each tag that names it as a HashSeq whose children it didn't know keeps them now.
    async fn learn(&self, hash: Hash) {
        let naming: Vec<(Tag, HashAndFormat)> = {
            let state = self.lock();
            let unknown =
                |(v, c): &(HashAndFormat, Vec<Hash>)| v.hash == hash && v.format.is_hash_seq() && c.is_empty();
            state.tags.iter().filter(|(_, t)| unknown(t)).map(|(n, (v, _))| (n.clone(), *v)).collect()
        };
        if naming.is_empty() {
            return;
        }
        let Some(children) = self.children(hash).await else { return };
        let mut state = self.lock();
        for (name, value) in naming {
            state.tag(name, value, children.clone());
        }
    }

    /// Tag `name` names `value` from now on, keeping it, and the children of a HashSeq: what of them it holds whole
    /// in memory goes onto the shelf; a window of a child it lets go of, for the child to be fetched onto the shelf.
    async fn set_tag(self: &Arc<Self>, name: Tag, value: HashAndFormat) -> io::Result<()> {
        let children = match value.format {
            BlobFormat::HashSeq => self.children(value.hash).await.unwrap_or_default(),
            BlobFormat::Raw => Vec::new(),
        };
        {
            let mut state = self.lock();
            for child in &children {
                if matches!(state.blobs.get(child), Some(Blob::Window(_))) {
                    state.take(child);
                }
            }
            state.tag(name, value, children);
        }
        self.shelve(value.hash).await
    }

    /// Puts blob `hash` onto the shelf from memory, if it is whole there and not on the shelf yet; a window of a blob
    /// too big for that, or not whole, it lets go of, for the blob to be fetched onto the shelf.
    async fn shelve(self: &Arc<Self>, hash: Hash) -> io::Result<()> {
        let (data, outboard) = {
            let mut state = self.lock();
            match state.blobs.get(&hash) {
                Some(Blob::Small { data, outboard, shelved: false }) => (data.clone(), outboard.clone()),
                Some(Blob::Window(w)) => {
                    let whole = w.whole().map(|data| (PostOrderMemOutboard::create(&data, IROH_BLOCK_SIZE), data));
                    match whole {
                        Some((tree, data)) if Hash::from(tree.root) == hash => {
                            let outboard = Bytes::from(tree.data);
                            let small = Blob::Small { data: data.clone(), outboard: outboard.clone(), shelved: false };
                            state.put(hash, small);
                            (data, outboard)
                        }
                        _ => {
                            state.take(&hash);
                            return Ok(());
                        }
                    }
                }
                _ => return Ok(()),
            }
        };
        let name = fresh();
        for at in (0..data.len()).step_by(STEP) {
            self.shelf.write(&name, at as u64, data.slice(at..(at + STEP).min(data.len()))).await?;
        }
        self.shelf.finish(&name, hash, data.len() as u64, outboard).await?;
        if let Some(Blob::Small { shelved, .. }) = self.lock().blobs.get_mut(&hash) {
            *shelved = true;
        }
        Ok(())
    }

    /// Lets go of each of `hashes`, from memory and from the shelf; of one a tag keeps, only if `force`.
    async fn delete(&self, hashes: Vec<Hash>, force: bool) -> io::Result<()> {
        for hash in hashes {
            let taken = {
                let mut state = self.lock();
                if state.keeps(&hash) && !force {
                    continue;
                }
                state.take(&hash)
            };
            match taken {
                Some(Blob::Shelved { .. } | Blob::Small { shelved: true, .. }) => {
                    self.shelf.drop(&hash.to_hex()).await?
                }
                Some(Blob::Filling(f)) => self.shelf.drop(&f.name).await?,
                _ => {}
            }
        }
        Ok(())
    }

    /// The outboard of shelved blob `hash`, at hand or read from the shelf.
    async fn outboard(&self, hash: Hash) -> io::Result<Bytes> {
        if let Some(outboard) = self.lock().outboards.get(&hash) {
            return Ok(outboard.clone());
        }
        let outboard = self.shelf.outboard(hash).await?;
        self.lock().remember(hash, outboard.clone());
        Ok(outboard)
    }

    /// The encoding of `ranges` of blob `hash`, which iroh-blobs hands a peer: from memory, or from the shelf a step at
    /// a time, every leaf and parent checked against the blob's tree as it goes. Of a blob it doesn't hold whole, what
    /// its window holds; of one still filling, nothing.
    async fn export_bao(self: &Arc<Self>, mut m: ExportBaoMsg) {
        let (hash, ranges) = (m.inner.hash, m.inner.ranges);
        let source = self.lock().source(&hash);
        let tree = |size| BaoTree::new(size, IROH_BLOCK_SIZE);
        match source {
            Source::Memory { data, outboard } => {
                let (root, tree) = (hash.into(), tree(data.len() as u64));
                let outboard = PostOrderMemOutboard { root, tree, data: outboard };
                traverse_ranges_validated(data, outboard, &ranges, &mut Items(&mut m.tx)).await.ok();
            }
            Source::Window { size, chunks, parents } => {
                let outboard = Parents { root: hash.into(), tree: tree(size), pairs: parents };
                traverse_ranges_validated(Chunks(chunks), outboard, &ranges, &mut Items(&mut m.tx)).await.ok();
            }
            Source::Shelf { name, size, have: None } => {
                if m.tx.send(EncodedItem::Size(size)).await.is_err() {
                    return;
                }
                let last = match self.encode(&name, hash, size, &ranges, &mut m.tx).await {
                    Ok(()) => EncodedItem::Done,
                    Err(Stop::Encode(e)) => EncodedItem::Error(e),
                    Err(Stop::Gone) => return,
                };
                m.tx.send(last).await.ok();
            }
            Source::Shelf { .. } | Source::None => {
                let e = io::Error::new(io::ErrorKind::NotFound, format!("{hash} isn't whole here"));
                m.tx.send(EncodedItem::Error(EncodeError::Io(e))).await.ok();
            }
        }
    }

    /// `traverse_ranges_validated` over blob `hash`, shelved as `name`, read from the shelf.
    async fn encode(
        &self,
        name: &str,
        hash: Hash,
        size: u64,
        ranges: &ChunkRanges,
        tx: &mut irpc::channel::mpsc::Sender<EncodedItem>,
    ) -> Result<(), Stop> {
        let ranges = tree::truncate(ranges, size);
        if ranges.is_empty() {
            return Ok(());
        }
        let tree = BaoTree::new(size, IROH_BLOCK_SIZE);
        let outboard = PostOrderMemOutboard { root: hash.into(), tree, data: self.outboard(hash).await? };
        let mut reader = Reader { shelf: &self.shelf, name: name.to_string(), size, at: 0, read: Bytes::new() };
        let mut stack = vec![blake3::Hash::from(hash)];
        let min_level = IROH_BLOCK_SIZE.chunk_log() as u32;
        for item in tree.ranges_pre_order_chunks_iter_ref(ranges, 0) {
            match item {
                BaoChunk::Parent { node, is_root, left, right, .. } => {
                    let lacking = || io::Error::other("a parent the outboard lacks");
                    let (l, r) = outboard.load(node)?.ok_or_else(lacking)?;
                    if Some(parent_cv(&l, &r, is_root)) != stack.pop() {
                        return Err(EncodeError::ParentHashMismatch(node).into());
                    }
                    if right {
                        stack.push(r);
                    }
                    if left {
                        stack.push(l);
                    }
                    tx.send(Parent { node, pair: (l, r) }.into()).await?;
                }
                BaoChunk::Leaf { start_chunk, size, is_root, ranges } => {
                    let expected = stack.pop();
                    let data = reader.bytes(start_chunk.to_bytes(), size).await?;
                    if ranges.is_all() {
                        let actual = match is_root {
                            true => blake3::hash(&data),
                            false => tree::leaf(start_chunk.0, &data).into(),
                        };
                        if Some(actual) != expected {
                            return Err(EncodeError::LeafHashMismatch(start_chunk).into());
                        }
                        tx.send(Leaf { offset: start_chunk.to_bytes(), data }.into()).await?;
                    } else {
                        let mut items = Vec::new();
                        let actual =
                            traverse_selected_rec(start_chunk, data, is_root, ranges, min_level, true, &mut items);
                        if Some(actual) != expected {
                            return Err(EncodeError::LeafHashMismatch(start_chunk).into());
                        }
                        for item in items {
                            tx.send(item).await?;
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// The bytes `ranges` of blob `hash`, cut to it: from memory, from the shelf a step at a time, or from its window,
    /// which must hold them all.
    async fn export_ranges(self: &Arc<Self>, m: ExportRangesMsg) {
        let (hash, ranges) = (m.inner.hash, m.inner.ranges);
        let source = self.lock().source(&hash);
        let sent = async {
            let size = source.size().ok_or_else(|| missing(&hash.to_hex()))?;
            m.tx.send(ExportRangesItem::Size(size)).await?;
            for range in ranges.iter() {
                let (from, to) = match range {
                    RangeSetRange::Range(r) => (*r.start, *r.end),
                    RangeSetRange::RangeFrom(r) => (*r.start, u64::MAX),
                };
                let (from, to) = (from.min(size), to.min(size));
                let lacking = || io::Error::new(io::ErrorKind::NotFound, format!("{hash} lacks {from}..{to}"));
                match &source {
                    Source::Memory { data, .. } => {
                        for at in (from..to).step_by(STEP) {
                            let data = data.slice(at as usize..(at + STEP as u64).min(to) as usize);
                            m.tx.send(Leaf { offset: at, data }.into()).await?;
                        }
                    }
                    Source::Shelf { name, have, .. } => {
                        if have.as_ref().is_some_and(|h| !h.is_superset(&ChunkRanges::bytes(from..to))) {
                            return Err(lacking());
                        }
                        for at in (from..to).step_by(STEP) {
                            let data = self.shelf.read(name, at, STEP.min((to - at) as usize)).await?;
                            m.tx.send(Leaf { offset: at, data }.into()).await?;
                        }
                    }
                    Source::Window { chunks, .. } => {
                        for n in from / CHUNK as u64..to.div_ceil(CHUNK as u64) {
                            let chunk = chunks.get(&n).ok_or_else(lacking)?;
                            let start = n * CHUNK as u64;
                            let (a, b) = (from.max(start) - start, to.min(start + chunk.len() as u64) - start);
                            let data = chunk.slice(a as usize..b as usize);
                            m.tx.send(Leaf { offset: start + a, data }.into()).await?;
                        }
                    }
                    Source::None => return Err(lacking()),
                }
            }
            Ok::<_, io::Error>(())
        };
        if let Err(e) = sent.await {
            m.tx.send(ExportRangesItem::Error(e.into())).await.ok();
        }
    }
}
