//! A node's bucket (blobs B3a, `docs/BLOBS.md`): where the server's store lives, an S3 bucket, its folder on disk
//! only a cache of it and a short queue of what goes up next. Every object is sealed under a key the server is given
//! (`Sealed`), as the bucket's TLS isn't post-quantum, and bound to its name, so an object read back under another
//! name doesn't open:
//!
//! - `edits/<from>-<n>`: a pack of the device's edits, those of its log from place `from` on, after `PACK` each a
//!   record as on disk (`disk::record`). A pack from place 0 holds the whole log and replaces every pack before it: the
//!   first after each start is one, and so is the next once the bucket holds `PACKS` packs.
//! - `keys/<id>`: each McEliece key, under its id.
//! - `device.key`: the server's device's secret (`server`).
//! - `parts/<hash>/<n>`: the parts of each blob the server's blob store keeps (blobs B3b, `shelf`), `PART` bytes each
//!   but a blob's last, and `blobs/<hash>-<size>`: its record, its outboard, put once its parts are all in the bucket.
//!   The node's shelf is the bucket: a blob counts once its record is there. Its folder keeps the blobs it writes in
//!   `shelf/staging/` until they are in the bucket, and the parts it read of late in `shelf/cache/`, up to
//!   `Options::cache` bytes, the least lately read let go first.
//!
//! The node saves what its device takes on disk first, as without a bucket, and then puts in the bucket what the disk
//! holds and the bucket doesn't, the keys before the edits that name them. Only once the bucket holds everything its
//! device holds does it tell its peers what changed (`Backed::behind`): nothing counts until the bucket has it. An
//! upload that fails is tried again after `Options::retry`, then twice as long each time, up to a minute.
//!
//! As a node starts, it first takes back what the bucket holds and its folder doesn't (`rebuild`): every key its
//! folder lacks, and the edits of every pack its folder's `packs` doesn't list, which lists the packs whose edits are
//! on disk. So a server whose folder is lost starts again from the bucket alone, as the same device (`server`). The
//! files a blob store in its folder's `blobs/` kept, before B3b, move into the bucket once (`adopt`), and that store
//! is put aside whole.
//!
//! The bucket keeps every version of an object for 7 days (Object Lock): a pack replaced is deleted only as a mark,
//! and its bytes go 7 days later. Nothing writes a name twice, but the parts of a blob whose record never went up,
//! which the blob's next upload writes anew.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::io::{self, ErrorKind, Write as _};
use std::os::unix::fs::FileExt as _;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context as _, Result, bail, ensure};
use avendb::id::{BlobId, SignerId};
use avendb::keys::{self, Secret, SeededRng};
use avendb::lab::Lab;
use avendb::sign::Signed;
use bytes::Bytes;
use iroh_blobs::api::Store;
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::{BlobFormat, Hash};
use n0_future::{StreamExt as _, stream, time};
use tokio::io::AsyncReadExt as _;
use tokio::sync::{Notify, mpsc};

use crate::disk::{self, Disk};
use crate::shelf::{Call, Shelf, hash_of};
use crate::{BACKOFF_MAX, Shared, files};

/// The packs of edits, by name.
const EDITS: &str = "edits/";
/// The McEliece keys, by name.
const KEYS: &str = "keys/";
/// What every pack starts with: avenDB's edits, version 1.
const PACK: &[u8] = b"avenDB edits 1\n";
/// When the bucket holds this many packs, the next holds the whole log and replaces them.
const PACKS: usize = 64;
/// The file in a node's folder that lists the packs whose edits are on disk.
const HELD: &str = "packs";
/// What the seal's key is derived for.
const SEAL: &str = "avenDB bucket seal";
/// The parts of the blobs on the shelf, by blob.
const PARTS: &str = "parts/";
/// The records of the blobs on the shelf, by blob and size.
const BLOBS: &str = "blobs/";
/// What every blob's record starts with, before its outboard: avenDB's blobs, version 1.
const RECORD: &[u8] = b"avenDB blob 1\n";
/// The bytes of a part of a blob, but its last.
const PART: u64 = 8 << 20;
/// The folder of the shelf in a node's folder: `staging/` and `cache/`.
const SHELF: &str = "shelf";
/// The most bytes of parts a node's folder keeps by default (`Options::cache`).
pub const CACHE: u64 = 8 << 30;

/// What `Bucket`'s calls return.
pub type Fut<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

/// The objects of a bucket, each under its name: an S3 bucket's on the server (`avendb-server`), a folder's in the
/// tests (`Folder`). What it holds is sealed already (`Sealed`).
pub trait Bucket: Send + Sync + 'static {
    /// Puts `bytes` under `name`.
    fn put<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> Fut<'a, ()>;
    /// The bytes under `name`, if any.
    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>>;
    /// Every name that starts with `prefix`, in order.
    fn list<'a>(&'a self, prefix: &'a str) -> Fut<'a, Vec<String>>;
    /// Deletes what is under `name`, if anything.
    fn delete<'a>(&'a self, name: &'a str) -> Fut<'a, ()>;
}

/// A bucket in a folder, each object a file under its name: the tests'.
#[derive(Clone, Debug)]
pub struct Folder(PathBuf);

impl Folder {
    pub fn new(dir: impl Into<PathBuf>) -> Folder {
        Folder(dir.into())
    }
}

impl Bucket for Folder {
    fn put<'a>(&'a self, name: &'a str, bytes: Vec<u8>) -> Fut<'a, ()> {
        Box::pin(async move {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().context("an object's folder")?)?;
            Ok(fs::write(path, bytes)?)
        })
    }

    fn get<'a>(&'a self, name: &'a str) -> Fut<'a, Option<Vec<u8>>> {
        Box::pin(async move {
            match fs::read(self.0.join(name)) {
                Ok(bytes) => Ok(Some(bytes)),
                Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
                Err(e) => Err(e.into()),
            }
        })
    }

    fn list<'a>(&'a self, prefix: &'a str) -> Fut<'a, Vec<String>> {
        Box::pin(async move {
            let (dir, start) = prefix.rsplit_once('/').map_or(("", prefix), |(dir, start)| (dir, start));
            let entries = match fs::read_dir(self.0.join(dir)) {
                Ok(entries) => entries,
                Err(e) if e.kind() == ErrorKind::NotFound => return Ok(Vec::new()),
                Err(e) => return Err(e.into()),
            };
            let mut names = Vec::new();
            for entry in entries {
                let name = entry?.file_name().into_string().map_err(|_| anyhow::anyhow!("a name that isn't UTF-8"))?;
                if name.starts_with(start) {
                    names.push(if dir.is_empty() { name } else { format!("{dir}/{name}") });
                }
            }
            names.sort();
            Ok(names)
        })
    }

    fn delete<'a>(&'a self, name: &'a str) -> Fut<'a, ()> {
        Box::pin(async move {
            match fs::remove_file(self.0.join(name)) {
                Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
                _ => Ok(()),
            }
        })
    }
}

/// A bucket whose every object is sealed under a key derived from the seal the server is given (`AVENDB_BUCKET_SEAL`)
/// and bound to its name (`keys::encrypt`): XChaCha20-Poly1305 under a 256-bit key, which a quantum computer doesn't
/// break either. An object sealed under another key, or changed, doesn't open, and the node doesn't start.
#[derive(Clone)]
pub struct Sealed {
    bucket: Arc<dyn Bucket>,
    key: Arc<Secret>,
}

impl fmt::Debug for Sealed {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Sealed(..)")
    }
}

impl Sealed {
    /// `bucket`, each object sealed under a key derived from `seal`.
    pub fn new(bucket: impl Bucket, seal: &[u8; 32]) -> Sealed {
        Sealed { bucket: Arc::new(bucket), key: Arc::new(Secret::derive(SEAL, seal)) }
    }

    /// Puts `plain` under `name`, sealed.
    pub async fn put(&self, name: &str, plain: &[u8]) -> Result<()> {
        let mut rng = SeededRng::new("avenDB bucket nonce", &*crate::server::random()?);
        let sealed = keys::encrypt(&self.key, plain, name.as_bytes(), &mut rng);
        self.bucket.put(name, sealed).await.with_context(|| format!("putting {name} in the bucket"))
    }

    /// What is under `name`, opened, if anything.
    pub async fn get(&self, name: &str) -> Result<Option<Vec<u8>>> {
        let sealed = self.bucket.get(name).await.with_context(|| format!("getting {name} from the bucket"))?;
        let Some(sealed) = sealed else { return Ok(None) };
        let plain = keys::decrypt(&self.key, &sealed, name.as_bytes());
        Ok(Some(plain.with_context(|| format!("{name} in the bucket doesn't open: another seal's, or changed"))?))
    }

    /// Every name that starts with `prefix`, in order.
    pub async fn list(&self, prefix: &str) -> Result<Vec<String>> {
        self.bucket.list(prefix).await.with_context(|| format!("listing {prefix} in the bucket"))
    }

    /// Deletes what is under `name`.
    pub async fn delete(&self, name: &str) -> Result<()> {
        self.bucket.delete(name).await.with_context(|| format!("deleting {name} from the bucket"))
    }
}

/// A pack of `signed`.
fn pack<'a>(signed: impl Iterator<Item = &'a Signed>) -> Vec<u8> {
    let mut out = PACK.to_vec();
    signed.for_each(|s| disk::record(&mut out, s));
    out
}

/// The edits of a pack, every one of which must decode whole.
fn unpack(bytes: &[u8]) -> Result<Vec<Signed>> {
    let records = bytes.strip_prefix(PACK).context("no pack of avenDB's edits")?;
    let (signed, whole) = disk::records(records);
    if whole != records.len() {
        bail!("a pack cut short, after {} edits", signed.len());
    }
    Ok(signed)
}

/// What a node takes back from its bucket as it starts, beside what its folder holds (`rebuild`).
#[derive(Default)]
pub(crate) struct Rebuilt {
    /// The edits of the packs its folder doesn't hold.
    pub edits: Vec<Signed>,
    /// The keys its folder lacks.
    pub keys: Vec<Arc<[u8]>>,
    /// Every pack in the bucket.
    packs: Vec<String>,
    /// Every key in the bucket.
    held: HashSet<BlobId>,
}

/// What the bucket holds that folder `dir` doesn't: every key the folder's `keys/` lacks, checked against its id, and
/// the edits of every pack the folder's `packs` doesn't list.
pub(crate) async fn rebuild(bucket: &Sealed, dir: &Path) -> Result<Rebuilt> {
    let on_disk = held(dir)?;
    let mut rebuilt = Rebuilt::default();
    for name in bucket.list(KEYS).await? {
        let Some(b) = name.strip_prefix(KEYS).and_then(BlobId::from_hex) else { continue };
        rebuilt.held.insert(b);
        if dir.join(disk::KEYS).join(b.to_hex()).exists() {
            continue;
        }
        let bytes = bucket.get(&name).await?.with_context(|| format!("{name}, listed, isn't in the bucket"))?;
        if BlobId::of(&bytes) != b {
            bail!("{name} in the bucket doesn't hash to its id");
        }
        rebuilt.keys.push(Arc::from(bytes));
    }
    rebuilt.packs = bucket.list(EDITS).await?;
    for name in rebuilt.packs.iter().filter(|name| !on_disk.contains(*name)) {
        let bytes = bucket.get(name).await?.with_context(|| format!("{name}, listed, isn't in the bucket"))?;
        rebuilt.edits.extend(unpack(&bytes).with_context(|| format!("{name} in the bucket"))?);
    }
    Ok(rebuilt)
}

/// The packs folder `dir` lists as on disk.
fn held(dir: &Path) -> Result<HashSet<String>> {
    match fs::read_to_string(dir.join(HELD)) {
        Ok(text) => Ok(text.lines().map(str::to_string).collect()),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(HashSet::new()),
        Err(e) => Err(e.into()),
    }
}

/// Lists `packs` in folder `dir` as on disk, written beside its place first, then renamed into it.
fn hold(dir: &Path, packs: &[String]) -> Result<()> {
    let (path, part) = (dir.join(HELD), dir.join(format!("{HELD}.part")));
    let mut file = fs::File::create(&part)?;
    file.write_all(packs.iter().map(|p| format!("{p}\n")).collect::<String>().as_bytes())?;
    file.sync_all()?;
    Ok(fs::rename(part, path)?)
}

/// A node's bucket, and what it holds of the node's device.
pub(crate) struct Backed {
    bucket: Sealed,
    /// The node's folder, whose `packs` lists the packs whose edits are on disk.
    dir: PathBuf,
    held: Mutex<Held>,
    /// Woken when the device saved something new on disk.
    pub due: Notify,
}

/// What the bucket holds of a node's device.
struct Held {
    /// How many of its edits: the first `edits` of its log.
    edits: usize,
    /// The next pack holds the whole log, and replaces every pack before it.
    whole: bool,
    keys: HashSet<BlobId>,
    /// Its packs, the last put last.
    packs: Vec<String>,
}

impl Backed {
    /// `bucket` for the node with its folder in `dir`, once the folder holds what `rebuilt` took back from it: every
    /// pack in the bucket is on disk now. The first pack it puts holds the whole log.
    pub(crate) fn new(bucket: Sealed, dir: &Path, rebuilt: Rebuilt) -> Result<Backed> {
        hold(dir, &rebuilt.packs)?;
        let held = Held { edits: 0, whole: true, keys: rebuilt.held, packs: rebuilt.packs };
        Ok(Backed { bucket, dir: dir.to_path_buf(), held: Mutex::new(held), due: Notify::new() })
    }

    /// The bucket lacks an edit or a McEliece key device `me` of `lab` holds, or the whole log it puts first.
    pub(crate) fn behind(&self, lab: &Lab, me: SignerId) -> bool {
        let held = self.held.lock().expect("held");
        held.whole || held.edits < lab.size(me).0 || lab.blob_ids(me).iter().any(|b| !held.keys.contains(b))
    }
}

/// What a node puts in its bucket next: the keys on disk the bucket lacks, and a pack of the edits on disk from place
/// `from` to place `to` of the device's log, if there are any.
struct Due {
    keys: Vec<(BlobId, Arc<[u8]>)>,
    from: usize,
    to: usize,
    pack: Option<Vec<u8>>,
}

impl Shared {
    /// Puts in the node's bucket, if it keeps one, what its disk holds and the bucket doesn't: the keys first, then a
    /// pack of the edits; a pack of the whole log replaces the packs before it. True if the bucket holds more now.
    pub(crate) async fn flush(self: &Arc<Self>) -> Result<bool> {
        let Some(backed) = &self.bucket else { return Ok(false) };
        let shared = self.clone();
        let Due { keys, from, to, pack } = tokio::task::spawn_blocking(move || shared.due()).await??;
        let mut more = false;
        for (b, bytes) in keys {
            backed.bucket.put(&format!("{KEYS}{}", b.to_hex()), &bytes).await?;
            backed.held.lock().expect("held").keys.insert(b);
            more = true;
        }
        let Some(pack) = pack else {
            let mut held = backed.held.lock().expect("held");
            // nothing on disk: nothing to put
            if held.whole && to == 0 {
                held.whole = false;
                more = true;
            }
            return Ok(more);
        };
        let mut n = [0; 8];
        getrandom::fill(&mut n).map_err(|e| anyhow::anyhow!("no randomness from the machine: {e}"))?;
        let name = format!("{EDITS}{from:016x}-{:016x}", u64::from_le_bytes(n));
        backed.bucket.put(&name, &pack).await?;
        let (replaced, packs) = {
            let mut held = backed.held.lock().expect("held");
            let replaced = if from == 0 { std::mem::take(&mut held.packs) } else { Vec::new() };
            held.packs.push(name);
            (held.edits, held.whole) = (to, false);
            (replaced, held.packs.clone())
        };
        hold(&backed.dir, &packs)?;
        for old in replaced {
            if let Err(e) = backed.bucket.delete(&old).await {
                tracing::warn!("avendb: a pack replaced stays in the bucket: {e:#}");
            }
        }
        Ok(true)
    }

    /// What the node puts in its bucket next, as its device and its disk hold it now.
    fn due(&self) -> Result<Due> {
        let backed = self.bucket.as_ref().context("a bucket")?;
        let lab = self.lab.lock().expect("the Lab");
        let disk: &Mutex<Disk> = self.disk.as_ref().context("a bucket beside a store")?;
        let disk = disk.lock().expect("the store");
        let held = backed.held.lock().expect("held");
        let ids = lab.log(self.me).ids();
        // the disk holds the first of the log's edits, in its order
        let to = disk.len().min(ids.len());
        let from = if held.whole || held.packs.len() >= PACKS || to < held.edits { 0 } else { held.edits };
        let mut keys = Vec::new();
        for b in lab.blob_ids(self.me).into_iter().filter(|b| disk.holds_key(b) && !held.keys.contains(b)) {
            keys.push((b, lab.blob(self.me, b).context("a key the device holds")?));
        }
        let edits = ids[from.min(to)..to].iter().map(|id| lab.signed_edit(self.me, *id).context("an edit it holds"));
        let edits = edits.collect::<Result<Vec<&Signed>>>()?;
        let pack = (!edits.is_empty()).then(|| pack(edits.into_iter()));
        Ok(Due { keys, from, to, pack })
    }

    /// Puts in the bucket what the device saved on disk, as soon as it saved it, and tells the peers once the bucket
    /// holds it; a failed upload it tries again after `retry`, then twice as long each time, up to `BACKOFF_MAX`.
    pub(crate) async fn flusher(self: Arc<Self>) {
        let Some(backed) = &self.bucket else { return };
        let mut wait = self.opts.retry;
        loop {
            match self.flush().await {
                Ok(more) => {
                    if more {
                        self.changed.notify_one();
                    }
                    wait = self.opts.retry;
                    backed.due.notified().await;
                }
                Err(e) => {
                    tracing::warn!("avendb: the bucket can't be written, trying again in {wait:?}: {e:#}");
                    time::sleep(wait).await;
                    wait = wait.saturating_mul(2).min(BACKOFF_MAX);
                }
            }
        }
    }
}

/// What the work of a shelf's call failed with, as its node's blob store takes it.
fn failed(e: anyhow::Error) -> io::Error {
    io::Error::other(format!("{e:#}"))
}

/// The name of part `n` of blob `hash`.
fn part_name(hash: &Hash, n: u64) -> String {
    format!("{PARTS}{}/{n:06x}", hash.to_hex())
}

/// The name of blob `hash`'s record, of a blob of `size` bytes.
fn record_name(hash: &Hash, size: u64) -> String {
    format!("{BLOBS}{}-{size:x}", hash.to_hex())
}

/// Runs `work` on a thread that may block, as the folder's files take.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> io::Result<T> + Send + 'static) -> io::Result<T> {
    tokio::task::spawn_blocking(work).await.map_err(io::Error::other)?
}

/// The shelf of a node whose store lives in a bucket: the bucket, its records and parts, with what it writes staged in
/// the node's folder and what it read of late cached there.
struct BucketShelf {
    bucket: Sealed,
    staging: PathBuf,
    cache: PathBuf,
    /// The size of each blob the bucket holds whole.
    sizes: Mutex<HashMap<Hash, u64>>,
    cached: Mutex<Cached>,
    /// The parts being fetched from the bucket, each by one call at a time.
    fetching: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

/// The parts in a node's folder's cache, each with its bytes and when it was read last.
struct Cached {
    parts: HashMap<String, (u64, u64)>,
    bytes: u64,
    budget: u64,
    reads: u64,
}

impl Cached {
    fn touch(&mut self, name: &str) -> bool {
        self.reads += 1;
        let reads = self.reads;
        self.parts.get_mut(name).map(|(_, read)| *read = reads).is_some()
    }

    /// Makes room for `bytes` more: the parts read least lately go, whose names it returns, for their files to go.
    fn room(&mut self, bytes: u64) -> Vec<String> {
        let mut gone = Vec::new();
        while self.bytes + bytes > self.budget {
            let Some(oldest) = self.parts.iter().min_by_key(|(_, (_, read))| *read).map(|(n, _)| n.clone()) else {
                break;
            };
            self.bytes -= self.parts.remove(&oldest).map_or(0, |(b, _)| b);
            gone.push(oldest);
        }
        gone
    }
}

/// The shelf of a node whose store lives in `bucket`, beside its folder `dir`, which caches `budget` bytes of parts at
/// most: blobs B3b, as the module says. What `staging/` held of blobs never finished, it drops as it starts.
pub(crate) fn shelf(bucket: Sealed, dir: &Path, budget: u64) -> Result<Shelf> {
    let (staging, cache) = (dir.join(SHELF).join("staging"), dir.join(SHELF).join("cache"));
    if staging.exists() {
        fs::remove_dir_all(&staging)?;
    }
    fs::create_dir_all(&staging)?;
    fs::create_dir_all(&cache)?;
    let mut cached = Cached { parts: HashMap::new(), bytes: 0, budget, reads: 0 };
    for blob in fs::read_dir(&cache)? {
        let blob = blob?;
        let Some(hash) = blob.file_name().to_str().and_then(hash_of) else { continue };
        for part in fs::read_dir(blob.path())? {
            let part = part?;
            let Some(n) = part.file_name().to_str().and_then(|n| u64::from_str_radix(n, 16).ok()) else { continue };
            let bytes = part.metadata()?.len();
            cached.parts.insert(part_name(&hash, n), (bytes, 0));
            cached.bytes += bytes;
        }
    }
    for gone in cached.room(0) {
        fs::remove_file(cache.join(gone.trim_start_matches(PARTS))).ok();
    }
    let on = Arc::new(BucketShelf {
        bucket,
        staging,
        cache,
        sizes: Mutex::default(),
        cached: Mutex::new(cached),
        fetching: Mutex::default(),
    });
    let (shelf, mut calls) = Shelf::new();
    tokio::spawn(async move {
        while let Some(call) = calls.recv().await {
            let on = on.clone();
            tokio::spawn(async move { on.answer(call).await });
        }
    });
    Ok(shelf)
}

impl BucketShelf {
    async fn answer(&self, call: Call) {
        match call {
            Call::List(tx) => {
                tx.send(self.list().await.map_err(failed)).ok();
            }
            Call::Read { name, at, len, tx } => {
                let read = match hash_of(&name) {
                    Some(hash) => self.read(hash, at, len).await,
                    None => self.read_staged(name, at, len).await,
                };
                tx.send(read).ok();
            }
            Call::Outboard { hash, tx } => {
                tx.send(self.outboard(hash).await.map_err(failed)).ok();
            }
            Call::Write { name, at, bytes, tx } => {
                let path = self.staging.join(&name);
                let written = blocking(move || {
                    let file = fs::OpenOptions::new().create(true).write(true).truncate(false).open(path)?;
                    file.write_all_at(&bytes, at)
                });
                tx.send(written.await).ok();
            }
            Call::Finish { name, hash, size, outboard, tx } => {
                tx.send(self.finish(&name, hash, size, outboard).await.map_err(failed)).ok();
            }
            Call::Drop { name, tx } => {
                let dropped = match hash_of(&name) {
                    Some(hash) => self.drop_blob(hash).await.map_err(failed),
                    None => fs::remove_file(self.staging.join(&name)).or_else(|e| match e.kind() {
                        ErrorKind::NotFound => Ok(()),
                        _ => Err(e),
                    }),
                };
                tx.send(dropped).ok();
            }
        }
    }

    /// Every blob whose record the bucket holds, with its size.
    async fn list(&self) -> Result<Vec<(Hash, u64)>> {
        let mut held = Vec::new();
        for name in self.bucket.list(BLOBS).await? {
            let blob = name.strip_prefix(BLOBS).and_then(|b| b.split_once('-'));
            let Some((hash, size)) = blob.and_then(|(h, s)| Some((hash_of(h)?, u64::from_str_radix(s, 16).ok()?)))
            else {
                tracing::warn!("avendb: {name} in the bucket is no blob's record");
                continue;
            };
            held.push((hash, size));
        }
        *self.sizes.lock().expect("sizes") = held.iter().copied().collect();
        Ok(held)
    }

    /// `len` bytes of blob `name`, staged, from byte `at` on, or fewer at its end.
    async fn read_staged(&self, name: String, at: u64, len: usize) -> io::Result<Bytes> {
        let path = self.staging.join(&name);
        blocking(move || {
            let file = fs::File::open(path)?;
            let end = (at + len as u64).min(file.metadata()?.len());
            let mut bytes = vec![0; end.saturating_sub(at) as usize];
            file.read_exact_at(&mut bytes, at)?;
            Ok(bytes.into())
        })
        .await
    }

    /// `len` bytes of blob `hash` from byte `at` on, or fewer at its end: from the parts in the cache, and the others
    /// fetched from the bucket and cached.
    async fn read(&self, hash: Hash, at: u64, len: usize) -> io::Result<Bytes> {
        let size = self.sizes.lock().expect("sizes").get(&hash).copied();
        let size = size.ok_or_else(|| io::Error::new(ErrorKind::NotFound, format!("no blob {hash} in the bucket")))?;
        let end = (at + len as u64).min(size);
        let mut out = Vec::with_capacity(end.saturating_sub(at) as usize);
        let mut from = at;
        while from < end {
            let n = from / PART;
            let to = end.min((n + 1) * PART);
            out.extend_from_slice(&self.part(hash, n, from - n * PART..to - n * PART).await?);
            from = to;
        }
        Ok(out.into())
    }

    /// Bytes `range` of part `n` of blob `hash`: from the cache, or else the part fetched whole from the bucket, and
    /// cached.
    async fn part(&self, hash: Hash, n: u64, range: std::ops::Range<u64>) -> io::Result<Bytes> {
        let name = part_name(&hash, n);
        let path = self.cache.join(name.trim_start_matches(PARTS));
        if let Some(bytes) = self.cached_range(&name, &path, range.clone()).await {
            return Ok(bytes);
        }
        let lock = self.fetching.lock().expect("fetching").entry(name.clone()).or_default().clone();
        let _fetching = lock.lock().await;
        // fetched meanwhile by another call
        if let Some(bytes) = self.cached_range(&name, &path, range.clone()).await {
            return Ok(bytes);
        }
        let got = self.bucket.get(&name).await.map_err(failed)?;
        let lacking = || io::Error::new(ErrorKind::NotFound, format!("no {name} in the bucket"));
        let part = Bytes::from(got.ok_or_else(lacking)?);
        let gone = self.cached.lock().expect("cached").room(part.len() as u64);
        let (whole, cache) = (part.clone(), self.cache.clone());
        let cached = blocking(move || {
            for gone in gone {
                fs::remove_file(cache.join(gone.trim_start_matches(PARTS))).ok();
            }
            fs::create_dir_all(path.parent().expect("a blob's folder"))?;
            let staged = path.with_extension("part");
            fs::write(&staged, &whole)?;
            fs::rename(staged, path)
        });
        match cached.await {
            Ok(()) => {
                let mut cached = self.cached.lock().expect("cached");
                cached.bytes += part.len() as u64;
                cached.parts.insert(name.clone(), (part.len() as u64, 0));
                cached.touch(&name);
            }
            Err(e) => tracing::warn!("avendb: {name} isn't cached: {e}"),
        }
        self.fetching.lock().expect("fetching").remove(&name);
        let (from, to) = (range.start.min(part.len() as u64), range.end.min(part.len() as u64));
        Ok(part.slice(from as usize..to as usize))
    }

    /// Bytes `range` of cached part `name`, at `path`, if the cache holds it.
    async fn cached_range(&self, name: &str, path: &Path, range: std::ops::Range<u64>) -> Option<Bytes> {
        if !self.cached.lock().expect("cached").touch(name) {
            return None;
        }
        let path = path.to_path_buf();
        let read = blocking(move || {
            let file = fs::File::open(path)?;
            let end = range.end.min(file.metadata()?.len());
            let mut bytes = vec![0; end.saturating_sub(range.start) as usize];
            file.read_exact_at(&mut bytes, range.start)?;
            Ok(Bytes::from(bytes))
        });
        match read.await {
            Ok(bytes) => Some(bytes),
            Err(_) => {
                let mut cached = self.cached.lock().expect("cached");
                if let Some((bytes, _)) = cached.parts.remove(name) {
                    cached.bytes -= bytes;
                }
                None
            }
        }
    }

    /// The outboard of blob `hash`, from its record.
    async fn outboard(&self, hash: Hash) -> Result<Bytes> {
        let size = self.sizes.lock().expect("sizes").get(&hash).copied().with_context(|| format!("no blob {hash}"))?;
        let name = record_name(&hash, size);
        let record = self.bucket.get(&name).await?.with_context(|| format!("no {name} in the bucket"))?;
        let outboard = record.strip_prefix(RECORD).with_context(|| format!("{name} is no blob's record"))?;
        Ok(Bytes::copy_from_slice(outboard))
    }

    /// Blob `name`, staged whole, is blob `hash` of `size` bytes: its parts go into the bucket, then its record, and
    /// then it counts; its staged bytes go.
    async fn finish(&self, name: &str, hash: Hash, size: u64, outboard: Bytes) -> Result<()> {
        let path = self.staging.join(name);
        if !self.sizes.lock().expect("sizes").contains_key(&hash) {
            let staged = if size == 0 { 0 } else { fs::metadata(&path)?.len() };
            ensure!(staged == size, "{name} is {staged} bytes, not {size}");
            for n in 0..size.div_ceil(PART) {
                let (at, path) = (n * PART, path.clone());
                let part = blocking(move || {
                    let mut bytes = vec![0; (size - at).min(PART) as usize];
                    fs::File::open(path)?.read_exact_at(&mut bytes, at)?;
                    Ok(bytes)
                });
                self.bucket.put(&part_name(&hash, n), &part.await?).await?;
            }
            let record = [RECORD, &outboard].concat();
            self.bucket.put(&record_name(&hash, size), &record).await?;
            self.sizes.lock().expect("sizes").insert(hash, size);
        }
        match fs::remove_file(&path) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    /// Drops blob `hash`: its record first, so that it counts no more, then its parts, in the bucket and the cache.
    async fn drop_blob(&self, hash: Hash) -> Result<()> {
        let Some(size) = self.sizes.lock().expect("sizes").remove(&hash) else { return Ok(()) };
        self.bucket.delete(&record_name(&hash, size)).await?;
        for n in 0..size.div_ceil(PART) {
            let name = part_name(&hash, n);
            self.bucket.delete(&name).await?;
            let mut cached = self.cached.lock().expect("cached");
            if let Some((bytes, _)) = cached.parts.remove(&name) {
                cached.bytes -= bytes;
            }
        }
        fs::remove_dir_all(self.cache.join(hash.to_hex())).ok();
        Ok(())
    }
}

/// Moves into `store`, a blob store over the bucket, the files the blob store in folder `dir`'s `blobs/` kept before
/// B3b: each under its tag, its pieces and the HashSeq that names them. Then puts that store aside whole, in `aside/`,
/// never deleted. Nothing to do if the folder holds none.
pub(crate) async fn adopt(dir: &Path, store: &Store) -> Result<()> {
    let from = dir.join(files::BLOBS);
    if !from.exists() {
        return Ok(());
    }
    let old: Store = FsStore::load(&from).await?.into();
    let moved = async {
        let mut tags = old.tags().list_prefix(b"avendb/file/").await?;
        let mut kept = Vec::new();
        while let Some(tag) = tags.next().await {
            kept.push(tag?);
        }
        for tag in &kept {
            let value = tag.hash_and_format();
            let seq = match value.format {
                BlobFormat::HashSeq => Some(old.get_bytes(value.hash).await?),
                BlobFormat::Raw => None,
            };
            let pieces = match &seq {
                Some(seq) => HashSeq::new(seq.clone()).context("a file's HashSeq that is none")?.iter().collect(),
                None => vec![value.hash],
            };
            for piece in pieces {
                copy(&old, store, piece).await?;
            }
            if let Some(seq) = seq {
                store.add_bytes_with_opts((seq, BlobFormat::HashSeq)).temp_tag().await?.hash();
            }
            store.tags().set(tag.name.clone(), value).await?;
        }
        Ok::<_, anyhow::Error>(kept.len())
    };
    let moved = moved.await;
    old.shutdown().await.ok();
    let moved = moved.context("moving the folder's files into the bucket")?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    let to = dir.join("aside").join(format!("{now}-blobs"));
    fs::create_dir_all(to.parent().expect("aside"))?;
    fs::rename(&from, &to)?;
    tracing::info!("avendb: {moved} files moved from the folder's blob store into the bucket; it is aside in {to:?}");
    Ok(())
}

/// Copies blob `hash` from `old` into `store`, a megabyte at a time, checked against its hash.
async fn copy(old: &Store, store: &Store, hash: Hash) -> Result<()> {
    let (tx, rx) = mpsc::channel::<io::Result<Bytes>>(4);
    let mut reader = old.reader(hash);
    tokio::spawn(async move {
        loop {
            let mut buf = vec![0; 1 << 20];
            let sent = match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => tx.send(Ok(Bytes::from(buf).slice(..n))).await,
                Err(e) => {
                    tx.send(Err(e)).await.ok();
                    break;
                }
            };
            if sent.is_err() {
                break;
            }
        }
    });
    let bytes = stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|b| (b, rx)) });
    let added = store.add_stream(bytes).await.temp_tag().await?;
    ensure!(added.hash() == hash, "blob {hash} copied as {}", added.hash());
    Ok(())
}
