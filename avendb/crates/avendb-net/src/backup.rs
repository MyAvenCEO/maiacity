//! Snapshots of each vault (`docs/BACKUP.md`, `spec/AvenDB/Backup.lean`, avendb's `backup`): a bucket of snapshots of
//! its own beside the server's (`Snapshots`), with a folder for each vault, `vaults/<vault>/`, laid out as a shelf is
//! (`shelf`, `bucket::shelf_at`): blobs by their BLAKE3 hash with their outboards, as iroh-blobs keeps them, and named
//! objects, each put once. Each folder is sealed under a key of its own, derived from the seal the server is given and
//! the vault, and every object is bound to its name, so nothing opens in another vault's folder or under another
//! name. Nothing deletes in the bucket but retention (`Folder::retain`). In a folder:
//!
//! - packs of edits, each a blob, in the very format a node keeps its own edits in (`edits`), so a restored snapshot's
//!   packs are its node's own;
//! - the McEliece keys its edits name, and its files, each piece and HashSeq a blob, copied from the node's blob store
//!   and checked against their hashes as they stream;
//! - for each snapshot, the HashSeq of every blob it names, its root, so a snapshot is one hash as an iroh collection
//!   is; and its manifest, `snapshots/<time>` in 16 hex digits, put last: nothing counts until the bucket has it, and a
//!   backup cut short leaves blobs the next one reuses.
//!
//! A backup (`Node::back_up`) builds on the folder's newest snapshot by the frontiers and loose edits its manifest
//! names, as a device asks a peer (T19, `avendb::backup::plan`): it names that snapshot's packs again and adds one pack
//! of what lies beyond them, or of the whole snapshot when it is made whole, and copies only the blobs the folder
//! lacks.
//! A day nothing changed puts one small manifest. A restore (`restore`) copies a snapshot's blobs onto a new node's
//! shelf with the first head of its edits, so a node started there takes back every edit, each checked again
//! (`Lab::restore_backup`); a rehearsal (`rehearse`) starts one and checks it holds each log as the manifest names it
//! (B9) and every file whole. Retention (`Folder::retain`) lets go of the snapshots the policy drops, then of the blobs
//! no snapshot kept names; the bucket keeps every version it deletes 7 more days (Object Lock). A check
//! (`Folder::check`), each day after the backup, restores nothing: it lists the bucket for every blob the snapshots
//! name, reads their manifests, roots and the newest snapshot's edits, each checked again, and of the files' blobs
//! those due that day (`Reading`), so that a folder of terabytes is read through once a month, a little each day.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use avendb::backup::{self as core, DAY, Keep};
use avendb::id::{BlobId, VaultId};
use avendb::lab::Lab;
use avendb::policy::Edit;
use avendb::sealed::{FileRoot, PIECE};
use avendb::sign::Signed;
use avendb::sync::{Ask, asks_by_frontiers};
use avendb::wire::Wire;
use bao_tree::blake3;
use bytes::Bytes;
use iroh_blobs::Hash;
use iroh_blobs::api::Store;
use iroh_blobs::hashseq::HashSeq;
use n0_future::{BufferedStreamExt as _, StreamExt as _, stream};
use tokio::io::AsyncReadExt as _;
use zeroize::Zeroizing;

use crate::bucket::{self, Bucket, Sealed, shelf_at};
use crate::edits::{self, Blob, Key, key_blob};
use crate::shelf::{Shelf, fresh};
use crate::tree::Outboarder;
use crate::{Cursor, Node, Options, disk, server};

/// What every manifest starts with: avenDB's snapshots, version 1.
const MANIFEST: &[u8] = b"avenDB snapshot 1\n";
/// The folders of the vaults, each under its vault's id.
const VAULTS: &str = "vaults/";
/// A mark for each vault with a folder, under its id: what lists the vaults without listing every object.
const INDEX: &str = "index/";
/// The manifests of a folder, each under the time its snapshot was taken.
const SNAPSHOTS: &str = "snapshots/";
/// What the key of each vault's folder is derived for, and of the bucket's marks.
const SEAL: &str = "avenDB snapshots";
/// The most bytes of parts a folder caches as it is read: a backup reads little back, and a restore each part once.
const CACHE: u64 = 64 << 20;
/// The server's device's secret in the bucket, sealed under a key of its own (`Snapshots::keep_secret`).
const SECRET: &str = "server/device.key";
/// The bytes a blob is copied in at a time.
const STEP: usize = 1 << 20;
/// The blobs copied at once.
const COPYING: usize = 8;

/// A bucket of snapshots, as the module says: its objects, the seal its folders' keys are derived from, the folder on
/// this machine where what is written to it is staged, and the vaults' folders opened so far, each one shelf over its
/// own folder there.
#[derive(Clone)]
pub struct Snapshots {
    bucket: Arc<dyn Bucket>,
    seal: Arc<Zeroizing<[u8; 32]>>,
    dir: PathBuf,
    open: Arc<Mutex<HashMap<VaultId, Folder>>>,
}

impl Snapshots {
    /// The bucket of snapshots `bucket`, its folders sealed under keys derived from `seal`, staging in folder `dir`.
    pub fn new(bucket: impl Bucket, seal: &[u8; 32], dir: impl Into<PathBuf>) -> Snapshots {
        let (seal, dir) = (Arc::new(Zeroizing::new(*seal)), dir.into());
        Snapshots { bucket: Arc::new(bucket), seal, dir, open: Arc::default() }
    }

    /// The bucket's marks of its folders, sealed under a key of their own.
    fn marks(&self) -> Sealed {
        Sealed::derived(self.bucket.clone(), SEAL, &self.seal)
    }

    /// The vaults with a folder in the bucket, smallest first.
    pub async fn vaults(&self) -> Result<Vec<VaultId>> {
        let names = self.marks().list(INDEX).await?;
        let mut vaults: Vec<VaultId> = names.iter().filter_map(|n| VaultId::from_hex(n.strip_prefix(INDEX)?)).collect();
        vaults.sort();
        Ok(vaults)
    }

    /// Keeps `secret`, the server's device's secret (`server::SECRET`), in the bucket, if it doesn't hold it already: a
    /// server restored after a disaster is the same device again (`restore_all`), and a rehearsal never is.
    pub async fn keep_secret(&self, secret: &[u8]) -> Result<()> {
        let sealed = Sealed::derived(self.bucket.clone(), &format!("{SEAL}: the server's secret"), &self.seal);
        if sealed.get(SECRET).await?.as_deref() != Some(secret) {
            sealed.put(SECRET, secret).await?;
        }
        Ok(())
    }

    /// The server's device's secret the bucket keeps, if any.
    pub async fn secret(&self) -> Result<Option<Zeroizing<Vec<u8>>>> {
        let sealed = Sealed::derived(self.bucket.clone(), &format!("{SEAL}: the server's secret"), &self.seal);
        Ok(sealed.get(SECRET).await?.map(Zeroizing::new))
    }

    /// Vault `v`'s folder, marked in the bucket: the one opened already, if any.
    pub async fn folder(&self, v: VaultId) -> Result<Folder> {
        if let Some(folder) = self.open.lock().expect("the folders").get(&v) {
            return Ok(folder.clone());
        }
        let hex = v.to_hex();
        let marks = self.marks();
        let mark = format!("{INDEX}{hex}");
        if marks.get(&mark).await?.is_none() {
            marks.put(&mark, hex.as_bytes()).await?;
        }
        let sealed = Sealed::derived(self.bucket.clone(), &format!("{SEAL} of vault {hex}"), &self.seal);
        let root = format!("{VAULTS}{hex}/");
        let mut open = self.open.lock().expect("the folders");
        if let Some(folder) = open.get(&v) {
            return Ok(folder.clone());
        }
        let shelf = shelf_at(sealed.clone(), root.clone(), &self.dir.join(&hex), CACHE)?;
        Ok(open.entry(v).or_insert(Folder { vault: v, sealed, root, shelf }).clone())
    }
}

/// A vault's folder in a bucket of snapshots: its shelf, and the bucket's objects under its prefix, to delete.
#[derive(Clone)]
pub struct Folder {
    vault: VaultId,
    sealed: Sealed,
    root: String,
    shelf: Shelf,
}

/// A snapshot as its folder keeps it: when it was taken, how many edits it holds, its root, the packs of its edits and
/// the McEliece keys they name, the files they bring, each blob of those files, and the frontier of each log and the
/// loose edits of what it restores (`Backup.Manifest`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub time: u64,
    pub edits: u64,
    /// The hash of the HashSeq of every blob it names: its packs, its keys, then its files' blobs.
    pub root: Hash,
    pub packs: Vec<Blob>,
    pub keys: Vec<Key>,
    pub files: Vec<FileRoot>,
    pub blobs: Vec<Blob>,
    pub ask: Ask,
}

fn put_blobs(out: &mut Vec<u8>, blobs: &[Blob]) {
    out.extend((blobs.len() as u32).to_be_bytes());
    for (hash, size) in blobs {
        out.extend(hash.as_bytes());
        out.extend(size.to_be_bytes());
    }
}

impl Cursor<'_> {
    fn blobs(&mut self) -> Option<Vec<Blob>> {
        let n = u32::from_be_bytes(self.array()?);
        (0..n).map(|_| Some((Hash::from_bytes(self.array()?), u64::from_be_bytes(self.array()?)))).collect()
    }
}

impl Manifest {
    /// Every blob it names, its root's children: its packs, its keys, then its files' blobs.
    pub fn named(&self) -> Vec<Blob> {
        let keys = self.keys.iter().map(|&(id, size)| (key_blob(id), size));
        self.packs.iter().copied().chain(keys).chain(self.blobs.iter().copied()).collect()
    }

    fn to_bytes(&self) -> Bytes {
        let mut out = MANIFEST.to_vec();
        out.extend(self.time.to_be_bytes());
        out.extend(self.edits.to_be_bytes());
        out.extend(self.root.as_bytes());
        put_blobs(&mut out, &self.packs);
        let keys: Vec<Blob> = self.keys.iter().map(|&(id, size)| (key_blob(id), size)).collect();
        put_blobs(&mut out, &keys);
        let files: Vec<Blob> = self.files.iter().map(|f| (Hash::from_bytes(f.hash), f.size)).collect();
        put_blobs(&mut out, &files);
        put_blobs(&mut out, &self.blobs);
        let ask = self.ask.to_wire();
        out.extend((ask.len() as u32).to_be_bytes());
        out.extend(ask);
        let sum = Hash::new(&out);
        out.extend(sum.as_bytes());
        out.into()
    }

    fn from_bytes(bytes: &[u8]) -> Option<Manifest> {
        let (body, sum) = bytes.split_at_checked(bytes.len().checked_sub(32)?)?;
        if Hash::new(body).as_bytes() != sum {
            return None;
        }
        let mut r = Cursor(body.strip_prefix(MANIFEST)?);
        let (time, edits) = (u64::from_be_bytes(r.array()?), u64::from_be_bytes(r.array()?));
        let root = Hash::from_bytes(r.array()?);
        let packs = r.blobs()?;
        let keys = r.blobs()?.into_iter().map(|(hash, size)| (BlobId(*hash.as_bytes()), size)).collect();
        let files = r.blobs()?.into_iter().map(|(hash, size)| FileRoot { hash: *hash.as_bytes(), size }).collect();
        let blobs = r.blobs()?;
        let len = u32::from_be_bytes(r.array()?) as usize;
        let ask = Ask::from_wire(r.take(len)?).ok()?;
        r.0.is_empty().then_some(Manifest { time, edits, root, packs, keys, files, blobs, ask })
    }
}

/// The name of the manifest of a snapshot taken at `time`.
fn manifest_name(time: u64) -> String {
    format!("{SNAPSHOTS}{time:016x}")
}

impl Folder {
    /// The vault it is of.
    pub fn vault(&self) -> VaultId {
        self.vault
    }

    /// When each of its snapshots was taken, in seconds since 1970, the oldest first.
    pub async fn times(&self) -> Result<Vec<u64>> {
        let names = self.shelf.names(SNAPSHOTS).await?;
        let mut times: Vec<u64> =
            names.iter().filter_map(|n| u64::from_str_radix(n.strip_prefix(SNAPSHOTS)?, 16).ok()).collect();
        times.sort();
        Ok(times)
    }

    /// The manifest of its snapshot taken at `time`. Fails if there is none, or it doesn't read whole.
    pub async fn manifest(&self, time: u64) -> Result<Manifest> {
        let bytes = self.shelf.get(&manifest_name(time)).await?.with_context(|| format!("no snapshot at {time}"))?;
        Manifest::from_bytes(&bytes).with_context(|| format!("the snapshot at {time} doesn't read whole"))
    }

    /// The manifest of its newest snapshot that reads whole, if any.
    pub async fn newest(&self) -> Result<Option<Manifest>> {
        self.as_of(None).await
    }

    /// The manifest of its newest snapshot taken at `at` or before, or of its newest with `at` unsaid, that reads
    /// whole, if any.
    pub async fn as_of(&self, at: Option<u64>) -> Result<Option<Manifest>> {
        for time in self.times().await?.into_iter().rev().filter(|&t| at.is_none_or(|at| t <= at)) {
            match self.manifest(time).await {
                Ok(m) => return Ok(Some(m)),
                Err(e) => tracing::warn!("avendb: snapshot {time} of vault {}: {e:#}", self.vault.to_hex()),
            }
        }
        Ok(None)
    }

    /// Lets go, at `now`, of the snapshots `keep` drops (`avendb::backup::keeps`), then of every blob no snapshot it
    /// keeps names: what it let go of. The newest it always keeps (B5), and every snapshot it keeps restores as before
    /// (B4).
    pub async fn retain(&self, keep: &Keep, now: u64) -> Result<Retained> {
        let times = self.times().await?;
        let (mut kept, mut dropped) = (Vec::new(), Vec::new());
        for &t in &times {
            match core::keeps(keep, now, &times, t) {
                true => kept.push(self.manifest(t).await?),
                false => dropped.push(t),
            }
        }
        for &t in &dropped {
            self.sealed.delete(&format!("{}{}", self.root, manifest_name(t))).await?;
        }
        let named: HashSet<Hash> =
            kept.iter().flat_map(|m| m.named().into_iter().map(|(h, _)| h).chain([m.root])).collect();
        let mut blobs = 0;
        for (hash, _) in self.shelf.list().await? {
            if !named.contains(&hash) {
                self.shelf.drop(&hash.to_hex()).await?;
                blobs += 1;
            }
        }
        Ok(Retained { kept: kept.len(), dropped, blobs })
    }
}

/// What a retention let go of: the snapshots it dropped, by when they were taken, and how many blobs; and how many
/// snapshots it kept.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Retained {
    pub kept: usize,
    pub dropped: Vec<u64>,
    pub blobs: usize,
}

/// What a backup did: the snapshot it took, the one it built on, by when, how many edits are new in it, how many blobs
/// and bytes it put, and the files its edits bring that the node doesn't hold whole, which it couldn't take.
#[derive(Clone, Debug)]
pub struct Backup {
    pub manifest: Manifest,
    pub base: Option<u64>,
    pub news: u64,
    pub put: u64,
    pub bytes: u64,
    pub lacking: Vec<FileRoot>,
}

/// A blob being copied onto a shelf: written a step at a time under a fresh name as its tree is worked out, and
/// finished as blob `hash` of `size` bytes only if its bytes are that blob's.
struct Copying<'a> {
    to: &'a Shelf,
    name: String,
    at: u64,
    tree: Outboarder,
}

impl<'a> Copying<'a> {
    fn new(to: &'a Shelf) -> Copying<'a> {
        Copying { to, name: fresh(), at: 0, tree: Outboarder::new() }
    }

    async fn push(&mut self, bytes: Bytes) -> Result<()> {
        self.tree.push(&bytes);
        let len = bytes.len() as u64;
        self.to.write(&self.name, self.at, bytes).await?;
        self.at += len;
        Ok(())
    }

    async fn finish(self, hash: Hash, size: u64) -> Result<()> {
        let (got, len, outboard) = self.tree.finish();
        ensure!(got == hash && len == size, "blob {hash} of {size} bytes reads as {got} of {len}");
        Ok(self.to.finish(&self.name, hash, size, outboard.into()).await?)
    }

    async fn drop_it(self) {
        self.to.drop(&self.name).await.ok();
    }
}

/// Copies blob `hash` of `size` bytes from blob store `store` onto `to`, checked as it streams.
async fn copy_from_store(store: &Store, hash: Hash, size: u64, to: &Shelf) -> Result<()> {
    let mut copying = Copying::new(to);
    let copied = async {
        let mut reader = store.reader(hash);
        let mut buf = vec![0; STEP];
        loop {
            let n = reader.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            copying.push(Bytes::copy_from_slice(&buf[..n])).await?;
        }
        Ok::<_, anyhow::Error>(())
    };
    match copied.await {
        Ok(()) => copying.finish(hash, size).await,
        Err(e) => {
            copying.drop_it().await;
            Err(e)
        }
    }
}

/// Copies blob `hash` of `size` bytes from shelf `from` onto `to`, checked as it streams.
async fn copy_between(from: &Shelf, hash: Hash, size: u64, to: &Shelf) -> Result<()> {
    let (name, mut copying) = (hash.to_hex(), Copying::new(to));
    let copied = async {
        while copying.at < size {
            let bytes = from.read(&name, copying.at, STEP.min((size - copying.at) as usize)).await?;
            ensure!(!bytes.is_empty(), "blob {name} is cut short");
            copying.push(bytes).await?;
        }
        Ok(())
    };
    match copied.await {
        Ok(()) => copying.finish(hash, size).await,
        Err(e) => {
            copying.drop_it().await;
            Err(e)
        }
    }
}

/// What a backup of a vault takes from its node's Lab: how many edits the snapshot holds, the pack of its new edits,
/// whether it builds on the newest snapshot, its frontiers and loose edits, the files its edits bring and the McEliece
/// keys they name, with their bytes.
struct Taken {
    edits: u64,
    news: Vec<Signed>,
    base: bool,
    ask: Ask,
    files: Vec<FileRoot>,
    keys: Vec<(BlobId, Arc<[u8]>)>,
}

impl Node {
    /// The vaults this node knows of, smallest first: those a backup of every vault backs up.
    pub async fn vaults(&self) -> Vec<VaultId> {
        let mut vaults: Vec<VaultId> = self.read(|lab, me| lab.state(me).vaults().iter().map(|v| v.id).collect()).await;
        vaults.sort();
        vaults
    }

    /// Backs up vault `v`, as this node holds it, into its folder of `snapshots` at `time`, in seconds since 1970: its
    /// snapshot (`avendb::backup::snapshot`), building on the folder's newest by its frontiers unless made `whole` or
    /// due to be (`avendb::backup::plan`); one pack of what is new, the McEliece keys and the blobs of the files the
    /// folder lacks, the snapshot's root, and its manifest last. A file the node doesn't hold whole it leaves out, and
    /// says so. Fails if the bucket can't be written; then no snapshot counts, and what it put the next backup reuses.
    pub async fn back_up(&self, snapshots: &Snapshots, v: VaultId, time: u64, whole: bool) -> Result<Backup> {
        let folder = snapshots.folder(v).await?;
        let newest = folder.newest().await?;
        let base_ask = newest.as_ref().map(|m| m.ask.clone());
        let compact = whole || newest.as_ref().is_some_and(|m| core::due(m.packs.len()));
        let take = move |lab: &avendb::lab::Lab, me| -> Result<Taken> {
            let edits: &[Edit] = lab.log(me).edits();
            let snap = core::snapshot_places(edits, lab.state(me), v);
            let plan = core::plan(edits, &snap, base_ask.as_ref(), compact);
            let signed = |i: usize| lab.signed_edit(me, edits[i].id()).cloned().context("an edit the device holds");
            let news = plan.news.iter().map(|&i| signed(i)).collect::<Result<Vec<_>>>()?;
            let snap_edits: Vec<Edit> = snap.iter().map(|&i| edits[i].clone()).collect();
            let named: HashSet<BlobId> = snap_edits.iter().flat_map(Edit::blobs).collect();
            let mut keys = Vec::with_capacity(named.len());
            for b in named {
                match lab.blob(me, b) {
                    Some(key) => keys.push((b, key)),
                    None => tracing::warn!("avendb: McEliece key {} isn't backed up: the node lacks it", b.to_hex()),
                }
            }
            keys.sort_by_key(|(b, _)| *b);
            let (ask, files) = (asks_by_frontiers(&snap_edits), core::files(&snap_edits));
            Ok(Taken { edits: snap.len() as u64, news, base: plan.base, ask, files, keys })
        };
        let taken = self.read(take).await?;
        let held: HashSet<Hash> = folder.shelf.list().await?.into_iter().map(|(h, _)| h).collect();
        let (mut put, mut bytes) = (0, 0);
        let mut packs = match (&newest, taken.base) {
            (Some(m), true) => m.packs.clone(),
            _ => vec![],
        };
        if !taken.news.is_empty() {
            let pack = edits::pack_of(&taken.news);
            bytes += pack.len() as u64;
            packs.push(folder.shelf.put_blob(&pack).await?);
            put += 1;
        }
        let mut keys = Vec::with_capacity(taken.keys.len());
        for (id, key) in &taken.keys {
            if !held.contains(&key_blob(*id)) {
                let (hash, _) = folder.shelf.put_blob(&Bytes::copy_from_slice(key)).await?;
                ensure!(hash == key_blob(*id), "the McEliece key {} is another's", id.to_hex());
                (put, bytes) = (put + 1, bytes + key.len() as u64);
            }
            keys.push((*id, key.len() as u64));
        }
        let store = self.shared.store.clone();
        let (mut files, mut blobs, mut lacking) = (Vec::new(), Vec::new(), Vec::new());
        for root in taken.files {
            match file_blobs(&store, root).await {
                Ok(of) => {
                    files.push(root);
                    blobs.extend(of);
                }
                Err(e) => {
                    tracing::warn!("avendb: file {} isn't backed up: {e:#}", Hash::from_bytes(root.hash));
                    lacking.push(root);
                }
            }
        }
        let mut seen = HashSet::new();
        blobs.retain(|(h, _)| seen.insert(*h));
        let copies = blobs.iter().copied().filter(|(h, _)| !held.contains(h)).map(|(hash, size)| {
            let (store, to) = (store.clone(), folder.shelf.clone());
            async move { copy_from_store(&store, hash, size, &to).await.map(|()| size) }
        });
        let mut copying = stream::iter(copies).buffered_unordered(COPYING);
        while let Some(copied) = copying.next().await {
            (put, bytes) = (put + 1, bytes + copied?);
        }
        let mut manifest = Manifest {
            time,
            edits: taken.edits,
            root: Hash::EMPTY,
            packs,
            keys,
            files,
            blobs,
            ask: taken.ask,
        };
        let seq = manifest.named().into_iter().map(|(h, _)| h).collect::<HashSeq>().into_inner();
        manifest.root = Hash::new(&seq);
        if !held.contains(&manifest.root) {
            folder.shelf.put_blob(&seq).await?;
        }
        let mut at = time;
        loop {
            manifest.time = at;
            match folder.shelf.put(&manifest_name(at), manifest.to_bytes()).await {
                Ok(()) => break,
                // a snapshot of this second already: the next second's
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => at += 1,
                Err(e) => return Err(e.into()),
            }
        }
        let base = newest.filter(|_| taken.base).map(|m| m.time);
        Ok(Backup { manifest, base, news: taken.news.len() as u64, put, bytes, lacking })
    }
}

/// The blobs of file `root` in blob store `store`, which must hold each whole: its root, and with several pieces, each
/// piece the HashSeq its root is names.
async fn file_blobs(store: &Store, root: FileRoot) -> Result<Vec<Blob>> {
    let hash = Hash::from_bytes(root.hash);
    let whole = |hash: Hash| async move {
        match store.status(hash).await? {
            iroh_blobs::api::proto::BlobStatus::Complete { size } => Ok(size),
            _ => Err(anyhow!("the node doesn't hold blob {hash} whole")),
        }
    };
    if !root.pieced() {
        let size = whole(hash).await?;
        ensure!(size == root.size, "a file of {} bytes in a blob of {size}", root.size);
        return Ok(vec![(hash, size)]);
    }
    let seq_size = whole(hash).await?;
    let seq = HashSeq::new(store.get_bytes(hash).await?).context("a file's HashSeq that is none")?;
    let pieces: Vec<Hash> = seq.iter().collect();
    ensure!(pieces.len() as u64 == root.size.div_ceil(PIECE), "a HashSeq of {} pieces", pieces.len());
    let mut blobs = vec![(hash, seq_size)];
    for (p, piece) in pieces.into_iter().enumerate() {
        let want = (root.size - p as u64 * PIECE).min(PIECE);
        let size = whole(piece).await?;
        ensure!(size == want, "piece {p} is {size} bytes, not {want}");
        blobs.push((piece, size));
    }
    Ok(blobs)
}

/// Copies the blobs of `manifest`, a snapshot of `folder`, onto `to`, each checked against its hash as it streams,
/// `COPYING` at a time, but those in `held`, which it adds to; after checking its root's HashSeq names them.
async fn copy_snapshot(folder: &Folder, manifest: &Manifest, to: &Shelf, held: &mut HashSet<Hash>) -> Result<()> {
    let named = manifest.named();
    let seq: Bytes = named.iter().map(|(h, _)| *h).collect::<HashSeq>().into_inner();
    let root = folder.shelf.read_blob(manifest.root, seq.len() as u64).await?;
    ensure!(root == seq, "the snapshot at {} names other blobs than its root", manifest.time);
    let wanted: Vec<Blob> = named.into_iter().filter(|(h, _)| held.insert(*h)).collect();
    let copies = wanted.into_iter().map(|(hash, size)| async move {
        copy_between(&folder.shelf, hash, size, to).await.with_context(|| format!("blob {hash}"))
    });
    let mut copying = stream::iter(copies).buffered_unordered(COPYING);
    while let Some(copied) = copying.next().await {
        copied?;
    }
    Ok(())
}

/// Restores the snapshot of `folder` taken at `time` onto `to`, a new node's shelf: every blob it names copied
/// (`copy_snapshot`), then the first head of the node's edits, of the snapshot's packs and keys
/// (`edits::put_first_head`), which a shelf that has one already refuses. A node started on `to` takes back every
/// edit, each checked again, and holds every file whole. Its manifest.
pub async fn restore(folder: &Folder, time: u64, to: &Shelf) -> Result<Manifest> {
    let manifest = folder.manifest(time).await?;
    let mut held = to.list().await?.into_iter().map(|(h, _)| h).collect();
    copy_snapshot(folder, &manifest, to, &mut held).await?;
    edits::put_first_head(to, manifest.packs.clone(), manifest.keys.clone()).await?;
    Ok(manifest)
}

/// Restores every vault of `snapshots` onto `to`, a new server's shelf, each as its newest snapshot taken at `at` or
/// before, or its newest with `at` unsaid: each blob once, then one first head of all their packs and keys. A vault
/// with no such snapshot it leaves out. The vaults it restored, each with its manifest.
pub async fn restore_all(snapshots: &Snapshots, at: Option<u64>, to: &Shelf) -> Result<Vec<(VaultId, Manifest)>> {
    let mut held = to.list().await?.into_iter().map(|(h, _)| h).collect();
    let (mut restored, mut packs, mut keys) = (Vec::new(), Vec::new(), Vec::new());
    for v in snapshots.vaults().await? {
        let folder = snapshots.folder(v).await?;
        let Some(manifest) = folder.as_of(at).await? else {
            tracing::warn!("avendb: vault {} has no snapshot to restore", v.to_hex());
            continue;
        };
        copy_snapshot(&folder, &manifest, to, &mut held).await.with_context(|| format!("vault {}", v.to_hex()))?;
        packs.extend(manifest.packs.iter().copied().filter(|p| !packs.contains(p)).collect::<Vec<_>>());
        keys.extend(manifest.keys.iter().copied().filter(|k| !keys.contains(k)).collect::<Vec<_>>());
        restored.push((v, manifest));
    }
    edits::put_first_head(to, packs, keys).await?;
    Ok(restored)
}

/// A rehearsal of a restore (`rehearse`): the snapshot restored, how long the restore and the node's start took, how
/// many edits the node took back, how many files it holds whole, and whether it holds each log as the manifest names
/// it (B9).
#[derive(Clone, Debug)]
pub struct Rehearsal {
    pub manifest: Manifest,
    pub restore: Duration,
    pub start: Duration,
    pub edits: u64,
    pub files: usize,
    pub same: bool,
}

impl Rehearsal {
    /// It restored the snapshot whole: every edit taken back, every file whole, every log as the manifest names it.
    pub fn whole(&self) -> bool {
        self.same && self.edits == self.manifest.edits && self.files == self.manifest.files.len()
    }
}

/// Rehearses a restore of the snapshot of `folder` taken at `time`: restored onto a new shelf in folder `dir`, which
/// must be empty or not there yet, and a node started on it as a server is (`server::open`), on `opts`, as a device of
/// its own, so that it never stands in for the live server; the rehearsal, and the node, still running, for a device to
/// sync from it.
pub async fn rehearse(folder: &Folder, time: u64, dir: &Path, opts: Options) -> Result<(Rehearsal, Node)> {
    // a shelf of its own, never beside another shelf's edits (`disk::open` opens what a folder holds): only an empty
    // folder, or none yet
    if std::fs::read_dir(dir).is_ok_and(|mut entries| entries.next().is_some()) {
        bail!("{} isn't empty: a rehearsal restores onto a new shelf, in a folder of its own", dir.display());
    }
    let began = Instant::now();
    let shelf = disk::open(dir)?;
    let manifest = restore(folder, time, &shelf).await?;
    let restored = began.elapsed();
    let node = server::open(shelf, opts).await?;
    let started = began.elapsed() - restored;
    let (edits, ask) = node.read(|lab, me| (lab.size(me).0 as u64, asks_by_frontiers(lab.log(me).edits()))).await;
    let mut files = 0;
    for root in &manifest.files {
        files += usize::from(node.holds_file(*root).await);
    }
    let same = ask == manifest.ask;
    Ok((Rehearsal { manifest, restore: restored, start: started, edits, files, same }, node))
}

/// Which blobs of a folder a check reads whole (`Folder::check`): each on one day in every `days`, by its hash, so that
/// a check each day reads every blob once in `days` days, about a `days`th of the folder's bytes a day; with `days` 1,
/// every blob, and with 0, none.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Reading {
    pub days: u64,
    /// The day it is, in days since 1970.
    pub day: u64,
}

impl Reading {
    /// Every blob.
    pub const ALL: Reading = Reading { days: 1, day: 0 };
    /// No blob.
    pub const NONE: Reading = Reading { days: 0, day: 0 };

    /// The blobs due on the day of `time`, in seconds since 1970, each read once in `days` days.
    pub fn at(days: u64, time: u64) -> Reading {
        Reading { days, day: time / DAY }
    }

    /// It reads blob `hash`.
    pub fn reads(&self, hash: &Hash) -> bool {
        let first: [u8; 8] = hash.as_bytes()[..8].try_into().expect("8 bytes of 32");
        self.days > 0 && u64::from_le_bytes(first) % self.days == self.day % self.days
    }
}

/// What a check of a folder found (`Folder::check`): its snapshots, and those whose manifest or root doesn't read whole
/// or names other blobs than the other, by when each was taken; the blobs they name, roots and all, each once, with
/// their bytes, those the bucket doesn't hold whole by its listing, those it read, with their bytes, and those that
/// didn't read as what their hash says; and of the newest snapshot that reads whole, when it was taken, how many edits
/// it holds and how many its packs give back, each checked again, and whether those hold each log as its manifest
/// names it (B9). How long it took.
#[derive(Clone, Debug, Default)]
pub struct Checked {
    pub snapshots: usize,
    pub unreadable: Vec<u64>,
    pub blobs: usize,
    pub bytes: u64,
    pub missing: Vec<Hash>,
    pub read: usize,
    pub read_bytes: u64,
    pub corrupt: Vec<Hash>,
    pub newest: Option<u64>,
    pub expected: u64,
    pub edits: u64,
    pub same: bool,
    pub took: Duration,
}

impl Checked {
    /// Each snapshot reads whole, the bucket holds every blob they name, each blob read is what its hash says, and the
    /// newest gives back every edit it holds, each log as its manifest names it: every snapshot restores, as far as
    /// the bytes read show.
    pub fn whole(&self) -> bool {
        let clean = self.unreadable.is_empty() && self.missing.is_empty() && self.corrupt.is_empty();
        clean && self.newest.is_some() && self.same && self.edits == self.expected
    }
}

impl Folder {
    /// Checks the folder from the bucket alone, without restoring a snapshot onto a shelf or starting a node: that the
    /// manifest and root of each snapshot read whole and name the same blobs; that the bucket holds each blob they
    /// name, by its listing alone, its outboard and every part; that each blob `reading` names reads as what its hash
    /// says, a part at a time, past the folder's cache; and that the newest snapshot's packs and McEliece keys give
    /// back every edit it holds, each checked again as a node checks what it takes back as it starts
    /// (`Lab::restore_backup`), holding each log as its manifest names it (B9). It reads the manifests, the roots,
    /// the newest snapshot's packs and keys, and only those blobs of the files `reading` names: a check each day reads
    /// a few bytes of a folder of terabytes, and every byte of it in `Reading::days` days.
    pub async fn check(&self, reading: Reading) -> Result<Checked> {
        let began = Instant::now();
        let mut checked = Checked::default();
        let times = self.times().await?;
        checked.snapshots = times.len();
        let mut manifests = Vec::with_capacity(times.len());
        for t in times {
            match self.manifest(t).await {
                Ok(m) => manifests.push(m),
                Err(e) => {
                    tracing::warn!("avendb: snapshot {t} of vault {}: {e:#}", self.vault.to_hex());
                    checked.unreadable.push(t);
                }
            }
        }
        // each blob once: each root, then the blobs it names
        let (mut named, mut seen) = (Vec::new(), HashSet::new());
        for m in &manifests {
            let root = (m.root, 32 * m.named().len() as u64);
            named.extend([root].into_iter().chain(m.named()).filter(|(h, _)| seen.insert(*h)));
        }
        (checked.blobs, checked.bytes) = (named.len(), named.iter().map(|(_, size)| size).sum());
        let listed: HashMap<Hash, u64> = self.shelf.list().await?.into_iter().collect();
        let parts = bucket::parts_held(&self.sealed, &self.root).await?;
        let held = |&(hash, size): &Blob| {
            let of = parts.get(&hash);
            listed.get(&hash) == Some(&size) && (0..bucket::parts(size)).all(|n| of.is_some_and(|p| p.contains(&n)))
        };
        checked.missing = named.iter().filter(|b| !held(b)).map(|(h, _)| *h).collect();
        let missing: HashSet<Hash> = checked.missing.iter().copied().collect();
        let mut read = HashSet::new();
        // the roots, every day: each names its manifest's blobs
        let (mut good, mut roots) = (Vec::with_capacity(manifests.len()), HashMap::new());
        for m in manifests {
            let seq: Vec<u8> = m.named().iter().map(|(h, _)| *h).collect::<HashSeq>().into_inner().into();
            let root = (m.root, seq.len() as u64);
            if !missing.contains(&m.root) && read.insert(m.root) {
                (checked.read, checked.read_bytes) = (checked.read + 1, checked.read_bytes + root.1);
                let got = self.read_whole(root).await;
                if let Err(e) = &got {
                    let v = self.vault.to_hex();
                    tracing::warn!("avendb: the root of snapshot {} of vault {v}: {e:#}", m.time);
                    checked.corrupt.push(m.root);
                }
                roots.insert(m.root, got.ok());
            }
            match roots.get(&m.root).is_some_and(|got| got.as_ref() == Some(&seq)) {
                true => good.push(m),
                false => checked.unreadable.push(m.time),
            }
        }
        checked.unreadable.sort();
        // the newest snapshot's edits, every day: given back by its packs and keys, each checked again
        if let Some(m) = good.last() {
            let (mut signed, mut keys, mut ids) = (Vec::new(), Vec::new(), HashSet::new());
            let keys_of = m.keys.iter().map(|&(id, size)| ((key_blob(id), size), false));
            let blobs = m.packs.iter().map(|&p| (p, true)).chain(keys_of);
            for (blob, pack) in blobs {
                if missing.contains(&blob.0) || !read.insert(blob.0) {
                    continue;
                }
                (checked.read, checked.read_bytes) = (checked.read + 1, checked.read_bytes + blob.1);
                let bytes = match self.read_whole(blob).await {
                    Ok(bytes) => bytes,
                    Err(e) => {
                        tracing::warn!("avendb: blob {} of vault {}: {e:#}", blob.0, self.vault.to_hex());
                        checked.corrupt.push(blob.0);
                        continue;
                    }
                };
                match pack {
                    true => match edits::unpack(&bytes) {
                        Some(edits) => signed.extend(edits.into_iter().filter(|s| ids.insert(s.edit.id()))),
                        None => {
                            let v = self.vault.to_hex();
                            tracing::warn!("avendb: pack {} of vault {v} is no pack of edits", blob.0);
                            checked.corrupt.push(blob.0);
                        }
                    },
                    false => keys.push(Arc::<[u8]>::from(bytes)),
                }
            }
            let seed = *server::random()?;
            let taken = tokio::task::spawn_blocking(move || {
                let mut lab = Lab::with_entropy(seed);
                let me = lab.device("a check of the snapshots");
                lab.restore_backup(me, &avendb::lab::Backup::new(signed, keys));
                (lab.size(me).0 as u64, asks_by_frontiers(lab.log(me).edits()))
            });
            let (edits, ask) = taken.await?;
            (checked.newest, checked.expected) = (Some(m.time), m.edits);
            (checked.edits, checked.same) = (edits, ask == m.ask);
        }
        // the files' blobs, those due today
        let due: Vec<Blob> = named.into_iter().filter(|(h, _)| !missing.contains(h) && !read.contains(h)).collect();
        let reads = due.into_iter().filter(|(h, _)| reading.reads(h)).map(|blob| async move {
            (blob, self.read_through(blob, |_| {}).await)
        });
        let mut reading = stream::iter(reads).buffered_unordered(COPYING);
        while let Some(((hash, size), got)) = reading.next().await {
            (checked.read, checked.read_bytes) = (checked.read + 1, checked.read_bytes + size);
            if let Err(e) = got {
                tracing::warn!("avendb: blob {hash} of vault {}: {e:#}", self.vault.to_hex());
                checked.corrupt.push(hash);
            }
        }
        checked.took = began.elapsed();
        Ok(checked)
    }

    /// Blob `blob`, read whole from the bucket past the folder's cache (`read_through`).
    async fn read_whole(&self, blob: Blob) -> Result<Vec<u8>> {
        let mut bytes = Vec::with_capacity(blob.1 as usize);
        self.read_through(blob, |part| bytes.extend_from_slice(part)).await?;
        Ok(bytes)
    }

    /// Reads blob `hash` of `size` bytes from the bucket a part at a time, each opened and never cached, and hands each
    /// part to `each`: fails unless the bucket holds every part, and they read as what its hash says.
    async fn read_through(&self, (hash, size): Blob, mut each: impl FnMut(&[u8])) -> Result<()> {
        let (mut hasher, mut len) = (blake3::Hasher::new(), 0);
        for n in 0..bucket::parts(size) {
            let part = bucket::part_of(&self.sealed, &self.root, &hash, n).await?;
            let part = part.with_context(|| format!("no part {n} of blob {hash} in the bucket"))?;
            hasher.update(&part);
            each(&part);
            len += part.len() as u64;
        }
        let got = Hash::from(hasher.finalize());
        ensure!(got == hash && len == size, "blob {hash} of {size} bytes reads as {got} of {len}");
        Ok(())
    }
}
