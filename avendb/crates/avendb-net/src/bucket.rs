//! A node's bucket (`docs/ARCHITECTURE.md` §14): the server's shelf (`shelf`), an S3 bucket, where
//! it keeps what lasts, its folder only a cache of it, which it may lose. Every object is sealed under a key the server
//! is given (`Sealed`), as the bucket's TLS isn't post-quantum, and bound to its name, so an object read back under
//! another name doesn't open. The bucket holds a shelf for each generation (`shelf::generation`), each under a prefix
//! of its own, `g1/`, `g2/` and on, with a marker for each, `generations/g<n>`: the newest is the one in use, and
//! every older one is never read again, and never deleted: avenDB is never reset (`shelf::FLOOR`), and the server
//! deletes nothing it finds in the bucket beside its shelf. Under a generation's prefix:
//!
//! - `blobs/<hash>/<n>`: the parts of each blob, `PART` bytes each but a blob's last, and `outboards/<hash>-<size>` its
//!   outboard, put once its parts are all in the bucket: a blob counts once its outboard is there;
//! - each named object under its name: the edits of the server's device (`edits`), and its secret (`server::SECRET`).
//!
//! The shelf answers a call only once the bucket holds what it was asked to keep: nothing the server holds counts
//! before the bucket has it. A blob being written is staged in the folder's `g<n>/new/` until it is whole, and the
//! parts it read of late are cached in `g<n>/cache/`, up to `CACHE` bytes or as the server is told, the least lately
//! read let go first. A server whose folder is lost starts again from its bucket alone, as the same device.
//!
//! One server writes a bucket. It puts a named object only where the bucket holds none, and the bucket keeps every
//! version of an object for 7 days (Object Lock). Nothing deletes an object but the files a node lets go of
//! (`Call::Drop`), a blob's outboard first, then its parts.

use std::collections::{HashMap, HashSet};
use std::fmt;
use std::fs;
use std::io::{self, ErrorKind};
use std::os::unix::fs::FileExt as _;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result, anyhow, ensure};
use avendb::keys::{self, Secret, SeededRng};
use bytes::Bytes;
use iroh_blobs::Hash;

use crate::shelf::{self, Call, FLOOR, Shelf, generation, hash_of};

/// What the seal's key is derived for.
const SEAL: &str = "avenDB bucket seal";
/// The markers of the generations, each under its name.
const GENERATIONS: &str = "generations/";
/// The parts of the blobs on a generation's shelf, by blob.
const BLOBS: &str = "blobs/";
/// Their outboards, by blob and size.
const OUTBOARDS: &str = "outboards/";
/// The bytes of a part of a blob, but its last.
const PART: u64 = 8 << 20;
/// The most bytes of parts a node's folder keeps by default.
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
    /// How many objects start with `prefix`, and their bytes together, where the bucket says them (0 where it doesn't).
    fn usage<'a>(&'a self, prefix: &'a str) -> Fut<'a, (u64, u64)> {
        Box::pin(async move { Ok((self.list(prefix).await?.len() as u64, 0)) })
    }
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
            let dir = prefix.rsplit_once('/').map_or("", |(dir, _)| dir);
            let mut names = Vec::new();
            walk(&self.0.join(dir), dir, &mut names)?;
            names.retain(|name| name.starts_with(prefix));
            names.sort();
            Ok(names)
        })
    }

    fn usage<'a>(&'a self, prefix: &'a str) -> Fut<'a, (u64, u64)> {
        Box::pin(async move {
            let (mut objects, mut bytes) = (0, 0);
            for name in self.list(prefix).await? {
                (objects, bytes) = (objects + 1, bytes + fs::metadata(self.0.join(name))?.len());
            }
            Ok((objects, bytes))
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

/// Every file under folder `dir`, which is `rel` in the bucket's folder, by its name there.
fn walk(dir: &Path, rel: &str, names: &mut Vec<String>) -> Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().into_string().map_err(|_| anyhow!("a name that isn't UTF-8"))?;
        let name = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        match entry.file_type()?.is_dir() {
            true => walk(&entry.path(), &name, names)?,
            false => names.push(name),
        }
    }
    Ok(())
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

    /// `bucket`, each object sealed under a key derived from `seal` for `purpose`: the bucket of snapshots seals each
    /// vault's folder under a key of its own (`backup`).
    pub(crate) fn derived(bucket: Arc<dyn Bucket>, purpose: &str, seal: &[u8; 32]) -> Sealed {
        Sealed { bucket, key: Arc::new(Secret::derive(purpose, seal)) }
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

/// The generations of the shelves in `bucket`, the oldest first.
pub async fn generations(bucket: &Sealed) -> Result<Vec<u64>> {
    let names = bucket.list(GENERATIONS).await?;
    let mut found: Vec<u64> = names.iter().filter_map(|n| generation(n.strip_prefix(GENERATIONS)?)).collect();
    found.sort();
    Ok(found)
}

/// Marks generation `n` in `bucket`, with when, in seconds since 1970.
async fn mark(bucket: &Sealed, n: u64) -> Result<()> {
    bucket.put(&format!("{GENERATIONS}g{n}"), crate::unix_now().to_string().as_bytes()).await
}

/// Runs `work` on a thread that may block, as the folder's files take.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> io::Result<T> + Send + 'static) -> io::Result<T> {
    tokio::task::spawn_blocking(work).await.map_err(io::Error::other)?
}

/// What the work of a shelf's call failed with, as its node takes it.
fn failed(e: anyhow::Error) -> io::Error {
    io::Error::other(format!("{e:#}"))
}

/// The shelf of a node whose shelf is a bucket: the bucket's generation in use, with what it writes staged in the
/// node's folder and what it read of late cached there; or a vault's folder in the bucket of snapshots (`backup`).
struct BucketShelf {
    bucket: Sealed,
    /// The prefix of the generation in use, `g<n>/`, or of the vault's folder, `vaults/<vault>/`.
    root: String,
    staging: PathBuf,
    cache: PathBuf,
    /// The size of each blob the bucket holds whole.
    sizes: Mutex<HashMap<Hash, u64>>,
    cached: Mutex<Cached>,
    /// The parts being fetched from the bucket, each by one call at a time.
    fetching: Mutex<HashMap<(Hash, u64), Arc<tokio::sync::Mutex<()>>>>,
}

/// The parts in a node's folder's cache, each by its blob and number, with its bytes and when it was read last.
struct Cached {
    parts: HashMap<(Hash, u64), (u64, u64)>,
    bytes: u64,
    budget: u64,
    reads: u64,
}

impl Cached {
    fn touch(&mut self, part: (Hash, u64)) -> bool {
        self.reads += 1;
        let reads = self.reads;
        self.parts.get_mut(&part).map(|(_, read)| *read = reads).is_some()
    }

    /// Makes room for `bytes` more: the parts read least lately go, which it returns, for their files to go.
    fn room(&mut self, bytes: u64) -> Vec<(Hash, u64)> {
        let mut gone = Vec::new();
        while self.bytes + bytes > self.budget {
            let Some(oldest) = self.parts.iter().min_by_key(|(_, (_, read))| *read).map(|(p, _)| *p) else { break };
            self.bytes -= self.parts.remove(&oldest).map_or(0, |(b, _)| b);
            gone.push(oldest);
        }
        gone
    }

    fn forget(&mut self, part: (Hash, u64)) {
        if let Some((bytes, _)) = self.parts.remove(&part) {
            self.bytes -= bytes;
        }
    }
}

/// The shelf of a node whose shelf is `bucket`, beside its folder `dir`, which caches `budget` bytes of parts at most:
/// the bucket's newest generation's, or, with none there yet of `shelf::FLOOR` or later, a new one of that generation
/// beside whatever the bucket holds. It deletes nothing it finds in the bucket or the folder but what the folder staged
/// of blobs never finished. Fails if the bucket's marker of its generation doesn't open: a bucket sealed under another
/// seal.
pub async fn shelf(bucket: Sealed, dir: &Path, budget: u64) -> Result<Shelf> {
    let n = match generations(&bucket).await?.last() {
        Some(&n) if n >= FLOOR => n,
        _ => {
            mark(&bucket, FLOOR).await?;
            FLOOR
        }
    };
    bucket.get(&format!("{GENERATIONS}g{n}")).await?.context("the bucket's generation, marked and gone")?;
    shelf_at(bucket, format!("g{n}/"), &dir.join(format!("g{n}")), budget)
}

/// A shelf whose blobs and named objects are those in `bucket` under the prefix `root`, which ends in `/`, beside the
/// folder `local`, which stages what it writes and caches `budget` bytes of parts at most: a generation's (`shelf`),
/// or a vault's folder in the bucket of snapshots (`backup`), which is never cleared either. What the folder staged of
/// blobs never finished, it drops.
pub(crate) fn shelf_at(bucket: Sealed, root: String, local: &Path, budget: u64) -> Result<Shelf> {
    let (staging, cache) = (local.join("new"), local.join("cache"));
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
            cached.parts.insert((hash, n), (bytes, 0));
            cached.bytes += bytes;
        }
    }
    let on = Arc::new(BucketShelf {
        bucket,
        root,
        staging,
        cache,
        sizes: Mutex::default(),
        cached: Mutex::new(cached),
        fetching: Mutex::default(),
    });
    let gone = on.cached.lock().expect("cached").room(0);
    for part in gone {
        fs::remove_file(on.cached_path(part)).ok();
    }
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
                    None => self.read_staged(&name, at, len).await,
                };
                tx.send(read).ok();
            }
            Call::Outboard { hash, tx } => {
                tx.send(self.outboard(hash).await.map_err(failed)).ok();
            }
            Call::Write { name, at, bytes, tx } => {
                tx.send(self.write(&name, at, bytes).await).ok();
            }
            Call::Finish { name, hash, size, outboard, tx } => {
                tx.send(self.finish(&name, hash, size, outboard).await.map_err(failed)).ok();
            }
            Call::Drop { name, tx } => {
                let dropped = match hash_of(&name) {
                    Some(hash) => self.drop_blob(hash).await.map_err(failed),
                    None => self.staged(&name).and_then(|path| match fs::remove_file(path) {
                        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
                        r => r,
                    }),
                };
                tx.send(dropped).ok();
            }
            Call::Put { name, bytes, tx } => {
                tx.send(self.put(&name, &bytes).await).ok();
            }
            Call::Keep { name, bytes, tx } => {
                // a bucket's put replaces what it held whole, or leaves it
                tx.send(self.bucket.put(&format!("{}{name}", self.root), &bytes).await.map_err(failed)).ok();
            }
            Call::Get { name, tx } => {
                let got = self.bucket.get(&format!("{}{name}", self.root)).await;
                tx.send(got.map(|bytes| bytes.map(Bytes::from)).map_err(failed)).ok();
            }
            Call::Names { prefix, tx } => {
                tx.send(self.names(&prefix).await.map_err(failed)).ok();
            }
        }
    }

    /// Where blob `name`, being written, is staged: under a name of letters, digits and `-` alone.
    fn staged(&self, name: &str) -> io::Result<PathBuf> {
        let plain = !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
        match plain {
            true => Ok(self.staging.join(name)),
            false => Err(io::Error::new(ErrorKind::InvalidInput, format!("{name:?} names no blob being written"))),
        }
    }

    /// The name of part `n` of blob `hash`.
    fn part_name(&self, hash: &Hash, n: u64) -> String {
        part_name(&self.root, hash, n)
    }

    /// The name of blob `hash`'s outboard, of a blob of `size` bytes.
    fn outboard_name(&self, hash: &Hash, size: u64) -> String {
        format!("{}{OUTBOARDS}{}-{size:x}", self.root, hash.to_hex())
    }

    /// Where part `n` of blob `hash` is cached.
    fn cached_path(&self, (hash, n): (Hash, u64)) -> PathBuf {
        self.cache.join(hash.to_hex()).join(format!("{n:06x}"))
    }

    /// Every blob whose outboard the bucket holds, with its size.
    async fn list(&self) -> Result<Vec<(Hash, u64)>> {
        let prefix = format!("{}{OUTBOARDS}", self.root);
        let mut held = Vec::new();
        for name in self.bucket.list(&prefix).await? {
            let Some(blob) = name.strip_prefix(&prefix).and_then(blob_of) else {
                tracing::warn!("avendb: {name} in the bucket is no blob's outboard");
                continue;
            };
            held.push(blob);
        }
        self.sizes.lock().expect("sizes").extend(held.iter().copied());
        Ok(held)
    }

    /// The name of every object put whose name starts with `prefix`, in order.
    async fn names(&self, prefix: &str) -> Result<Vec<String>> {
        let names = self.bucket.list(&format!("{}{prefix}", self.root)).await?;
        let names = names.into_iter().filter_map(|name| Some(name.strip_prefix(&self.root)?.to_string()));
        Ok(names.filter(|name| shelf::named(name)).collect())
    }

    /// The size of blob `hash`, which the bucket holds whole: as listed, or else looked up by its outboard's name, as
    /// a node reads its edits before its blob store lists the shelf.
    async fn size(&self, hash: Hash) -> Result<u64> {
        if let Some(size) = self.sizes.lock().expect("sizes").get(&hash).copied() {
            return Ok(size);
        }
        let prefix = format!("{}{OUTBOARDS}", self.root);
        let names = self.bucket.list(&format!("{prefix}{}-", hash.to_hex())).await?;
        let size = names.iter().find_map(|name| blob_of(name.strip_prefix(&prefix)?)).map(|(_, size)| size);
        let size = size.with_context(|| format!("no blob {hash} in the bucket"))?;
        self.sizes.lock().expect("sizes").insert(hash, size);
        Ok(size)
    }

    /// `bytes` written from byte `at` on of blob `name`, staged.
    async fn write(&self, name: &str, at: u64, bytes: Bytes) -> io::Result<()> {
        let path = self.staged(name)?;
        blocking(move || {
            let file = fs::OpenOptions::new().create(true).write(true).truncate(false).open(path)?;
            file.write_all_at(&bytes, at)
        })
        .await
    }

    /// `len` bytes of blob `name`, staged, from byte `at` on, or fewer at its end.
    async fn read_staged(&self, name: &str, at: u64, len: usize) -> io::Result<Bytes> {
        let path = self.staged(name)?;
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
        let size = self.size(hash).await.map_err(|e| io::Error::new(ErrorKind::NotFound, format!("{e:#}")))?;
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
        let path = self.cached_path((hash, n));
        if let Some(bytes) = self.cached_range((hash, n), &path, range.clone()).await {
            return Ok(bytes);
        }
        let lock = self.fetching.lock().expect("fetching").entry((hash, n)).or_default().clone();
        let _fetching = lock.lock().await;
        // fetched meanwhile by another call
        if let Some(bytes) = self.cached_range((hash, n), &path, range.clone()).await {
            return Ok(bytes);
        }
        let name = self.part_name(&hash, n);
        let got = self.bucket.get(&name).await.map_err(failed)?;
        let lacking = || io::Error::new(ErrorKind::NotFound, format!("no {name} in the bucket"));
        let part = Bytes::from(got.ok_or_else(lacking)?);
        let gone = self.cached.lock().expect("cached").room(part.len() as u64);
        let gone: Vec<PathBuf> = gone.into_iter().map(|p| self.cached_path(p)).collect();
        let (whole, at) = (part.clone(), path.clone());
        let cached = blocking(move || {
            for gone in gone {
                fs::remove_file(gone).ok();
            }
            fs::create_dir_all(at.parent().expect("a blob's folder"))?;
            let staged = at.with_extension("part");
            fs::write(&staged, &whole)?;
            fs::rename(staged, at)
        });
        match cached.await {
            Ok(()) => {
                let mut cached = self.cached.lock().expect("cached");
                cached.bytes += part.len() as u64;
                cached.parts.insert((hash, n), (part.len() as u64, 0));
                cached.touch((hash, n));
            }
            Err(e) => tracing::warn!("avendb: {name} isn't cached: {e}"),
        }
        self.fetching.lock().expect("fetching").remove(&(hash, n));
        let (from, to) = (range.start.min(part.len() as u64), range.end.min(part.len() as u64));
        Ok(part.slice(from as usize..to as usize))
    }

    /// Bytes `range` of cached part `part`, at `path`, if the cache holds it.
    async fn cached_range(&self, part: (Hash, u64), path: &Path, range: std::ops::Range<u64>) -> Option<Bytes> {
        if !self.cached.lock().expect("cached").touch(part) {
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
                self.cached.lock().expect("cached").forget(part);
                None
            }
        }
    }

    /// The outboard of blob `hash`.
    async fn outboard(&self, hash: Hash) -> Result<Bytes> {
        let name = self.outboard_name(&hash, self.size(hash).await?);
        Ok(self.bucket.get(&name).await?.with_context(|| format!("no {name} in the bucket"))?.into())
    }

    /// Blob `name`, staged whole, is blob `hash` of `size` bytes: its parts go into the bucket, then its outboard, and
    /// then it counts; its staged bytes go.
    async fn finish(&self, name: &str, hash: Hash, size: u64, outboard: Bytes) -> Result<()> {
        let path = self.staged(name)?;
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
                self.bucket.put(&self.part_name(&hash, n), &part.await?).await?;
            }
            self.bucket.put(&self.outboard_name(&hash, size), &outboard).await?;
            self.sizes.lock().expect("sizes").insert(hash, size);
        }
        match fs::remove_file(&path) {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        }
    }

    /// Drops blob `hash`: its outboard first, so that it counts no more, then its parts, in the bucket and the cache.
    async fn drop_blob(&self, hash: Hash) -> Result<()> {
        let Ok(size) = self.size(hash).await else { return Ok(()) };
        self.sizes.lock().expect("sizes").remove(&hash);
        self.bucket.delete(&self.outboard_name(&hash, size)).await?;
        for n in 0..size.div_ceil(PART) {
            self.bucket.delete(&self.part_name(&hash, n)).await?;
            self.cached.lock().expect("cached").forget((hash, n));
        }
        fs::remove_dir_all(self.cache.join(hash.to_hex())).ok();
        Ok(())
    }

    /// Puts `bytes` under `name` once, where the bucket holds nothing under it yet: the same bytes there are put
    /// already, and other bytes are refused.
    async fn put(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        let name = format!("{}{name}", self.root);
        match self.bucket.get(&name).await.map_err(failed)? {
            Some(there) if there == bytes => Ok(()),
            Some(_) => Err(io::Error::new(ErrorKind::AlreadyExists, format!("{name} holds other bytes already"))),
            None => self.bucket.put(&name, bytes).await.map_err(failed),
        }
    }
}

/// The name of part `n` of blob `hash` on the shelf under `root`.
fn part_name(root: &str, hash: &Hash, n: u64) -> String {
    format!("{root}{BLOBS}{}/{n:06x}", hash.to_hex())
}

/// How many parts a blob of `size` bytes is kept in.
pub(crate) fn parts(size: u64) -> u64 {
    size.div_ceil(PART)
}

/// The parts the shelf under `root` in `bucket` holds of each blob, by the bucket's listing alone.
pub(crate) async fn parts_held(bucket: &Sealed, root: &str) -> Result<HashMap<Hash, HashSet<u64>>> {
    let prefix = format!("{root}{BLOBS}");
    let mut held: HashMap<Hash, HashSet<u64>> = HashMap::new();
    for name in bucket.list(&prefix).await? {
        let part = name.strip_prefix(&prefix).and_then(|rest| rest.split_once('/'));
        match part.and_then(|(hash, n)| Some((hash_of(hash)?, u64::from_str_radix(n, 16).ok()?))) {
            Some((hash, n)) => {
                held.entry(hash).or_default().insert(n);
            }
            None => tracing::warn!("avendb: {name} in the bucket is no blob's part"),
        }
    }
    Ok(held)
}

/// Part `n` of blob `hash` on the shelf under `root` in `bucket`, opened, read from the bucket and never cached: none
/// if the bucket holds none.
pub(crate) async fn part_of(bucket: &Sealed, root: &str, hash: &Hash, n: u64) -> Result<Option<Vec<u8>>> {
    bucket.get(&part_name(root, hash, n)).await
}

/// The blob an outboard's name says it is of: its hash and size.
fn blob_of(name: &str) -> Option<(Hash, u64)> {
    let (hash, size) = name.split_once('-')?;
    Some((hash_of(hash)?, u64::from_str_radix(size, 16).ok()?))
}
