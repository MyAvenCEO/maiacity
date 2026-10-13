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
//!
//! The node saves what its device takes on disk first, as without a bucket, and then puts in the bucket what the disk
//! holds and the bucket doesn't, the keys before the edits that name them. Only once the bucket holds everything its
//! device holds does it tell its peers what changed (`Backed::behind`): nothing counts until the bucket has it. An
//! upload that fails is tried again after `Options::retry`, then twice as long each time, up to a minute.
//!
//! As a node starts, it first takes back what the bucket holds and its folder doesn't (`rebuild`): every key its
//! folder lacks, and the edits of every pack its folder's `packs` doesn't list, which lists the packs whose edits are
//! on disk. So a server whose folder is lost starts again from the bucket alone, as the same device (`server`).
//!
//! The bucket keeps every version of an object for 7 days (Object Lock): a pack replaced is deleted only as a mark,
//! and its bytes go 7 days later. Nothing ever writes a name twice.

use std::collections::HashSet;
use std::fmt;
use std::fs;
use std::io::{ErrorKind, Write as _};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result, bail};
use avendb::id::{BlobId, SignerId};
use avendb::keys::{self, Secret, SeededRng};
use avendb::lab::Lab;
use avendb::sign::Signed;
use n0_future::time;
use tokio::sync::Notify;

use crate::disk::{self, Disk};
use crate::{BACKOFF_MAX, Shared};

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
