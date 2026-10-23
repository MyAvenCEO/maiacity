//! A shelf in a folder (v8 phase S, `shelf`): the Mac's, the server's when it keeps no bucket, and the tests'. The
//! folder holds a shelf for each generation, `g1/`, `g2/` and on (`shelf::generation`), and the newest is the one in
//! use (`open`); a new one made beside them puts every older one aside (`aside`), never read again and never deleted:
//! avenDB is never reset (`shelf::FLOOR`), and nothing in the folder but a shelf's own files is ever removed. In a
//! generation's folder:
//!
//! - `blobs/<hash>`: each finished blob, and `outboards/<hash>` its outboard, written last, so a blob counts once its
//!   outboard is there;
//! - `new/`: the blobs being written, each under the name its node chose, and the objects being put;
//! - each named object at its name: `heads/0000000000000001` in `heads/`, `device.key` beside `heads/`.
//!
//! What it answers it holds on disk, synced: the file, then the folder that names it. An object is written whole
//! beside its place, synced, then linked into it, so an object is always whole and one already there is never
//! replaced. Every file it writes is readable by its owner alone.

use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read as _, Write as _};
use std::os::unix::fs::FileExt as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{Context as _, Result};
use bytes::Bytes;
use data_encoding::HEXLOWER;
use iroh_blobs::Hash;

use crate::shelf::{self, Call, FLOOR, RESERVED, Shelf, generation, hash_of};

/// The finished blobs, each under its hash.
const BLOBS: &str = "blobs";
/// Their outboards, each under its blob's hash.
const OUTBOARDS: &str = "outboards";
/// The blobs being written and the objects being put.
const NEW: &str = "new";

/// The generations of the shelves in folder `root`, the oldest first.
pub fn generations(root: &Path) -> Result<Vec<u64>> {
    let mut found = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(found),
        Err(e) => return Err(e).with_context(|| format!("the shelves in {}", root.display())),
    };
    for entry in entries {
        let entry = entry?;
        if let Some(n) = entry.file_name().to_str().and_then(generation)
            && entry.file_type()?.is_dir()
        {
            found.push(n);
        }
    }
    found.sort();
    Ok(found)
}

/// The shelf in folder `root` in use: its newest generation's, or, with none there yet of `shelf::FLOOR` or later, a
/// new one of that generation beside whatever the folder holds. It removes nothing it finds in the folder. Its calls
/// are answered on tokio's threads that may block.
pub fn open(root: &Path) -> Result<Shelf> {
    let complete = || -> Result<Option<PathBuf>> {
        let Some(n) = generations(root)?.last().copied().filter(|n| *n >= FLOOR) else { return Ok(None) };
        let dir = root.join(format!("g{n}"));
        Ok([BLOBS, OUTBOARDS, NEW].iter().all(|sub| dir.join(sub).is_dir()).then_some(dir))
    };
    let dir = if let Some(dir) = complete()? {
        dir
    } else {
        // A complete read-open changes no files. Bootstrap or repair is a writer,
        // and must rescan after acquiring ownership before creating a generation.
        fs::create_dir_all(root)?;
        let _bootstrap = crate::writer::Source::new(root).claim()?;
        if let Some(dir) = complete()? {
            dir
        } else {
            let n = match generations(root)?.last() {
                Some(&n) if n >= FLOOR => n,
                _ => make(root, FLOOR)?,
            };
            let dir = root.join(format!("g{n}"));
            for sub in [BLOBS, OUTBOARDS, NEW] {
                fs::create_dir_all(dir.join(sub)).with_context(|| format!("the shelf in {}", dir.display()))?;
            }
            sync_dir(&dir)?;
            dir
        }
    };
    let selected = generation(dir.file_name().and_then(|n| n.to_str()).expect("generation name")).expect("generation");
    let on = Arc::new(Folder { dir });
    let bounded = on.clone();
    let queue = crate::disk_queue::Queue::start(move |call| on.answer(call));
    let source = crate::writer::Source::for_generation(root, selected);
    Ok(Shelf::native(queue, source).with_bounded_get(move |name, limit| {
        let on = bounded.clone();
        async move { tokio::task::spawn_blocking(move || on.get_bounded(&name, limit)).await.map_err(io::Error::other)? }
    }))
}

/// Puts the shelf in folder `root` in use aside: a new generation made beside it, empty, which the next `open` uses.
/// Its number.
/// How many files folder `root` holds, under it at any depth, and their bytes together: what a place's shelves take
/// on its disk. Links aren't followed; a folder that isn't there holds nothing.
pub fn usage(root: &Path) -> io::Result<(u64, u64)> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok((0, 0)),
        Err(e) => return Err(e),
    };
    let (mut files, mut bytes) = (0, 0);
    for entry in entries {
        let entry = entry?;
        let kind = entry.file_type()?;
        if kind.is_dir() {
            let (f, b) = usage(&entry.path())?;
            (files, bytes) = (files + f, bytes + b);
        } else if kind.is_file() {
            (files, bytes) = (files + 1, bytes + entry.metadata()?.len());
        }
    }
    Ok((files, bytes))
}

pub fn aside(root: &Path) -> Result<u64> {
    fs::create_dir_all(root)?;
    let _writer = crate::writer::Source::new(root).claim()?;
    let n = generations(root)?.last().map_or(FLOOR, |n| (n + 1).max(FLOOR));
    make(root, n)
}

/// Makes generation `n`'s folder in `root`, which must be new.
fn make(root: &Path, n: u64) -> Result<u64> {
    fs::create_dir_all(root).with_context(|| format!("the shelves' folder, {}", root.display()))?;
    fs::create_dir(root.join(format!("g{n}"))).with_context(|| format!("generation {n} in {}", root.display()))?;
    sync_dir(root)?;
    Ok(n)
}

/// Syncs folder `dir`, so what it names lasts.
fn sync_dir(dir: &Path) -> io::Result<()> {
    File::open(dir)?.sync_all()
}

/// Writes `bytes` to `path`, a new file readable by its owner alone, and syncs it.
fn write_synced(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = owned().create_new(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// Options to write a file readable by its owner alone.
fn owned() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.write(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options
}

/// A name of the node's own for what it writes beside its place.
fn staged(what: &str) -> String {
    let mut n = [0; 8];
    getrandom::fill(&mut n).expect("randomness");
    format!("{what}-{}", HEXLOWER.encode(&n))
}

/// Gone already is gone.
fn removed(r: io::Result<()>) -> io::Result<()> {
    match r {
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

/// A generation's folder, which answers its shelf's calls.
struct Folder {
    dir: PathBuf,
}

impl Folder {
    fn answer(&self, call: Call) {
        match call {
            Call::List(tx) => {
                tx.send(self.list()).ok();
            }
            Call::Read { name, at, len, tx } => {
                tx.send(self.read(&name, at, len)).ok();
            }
            Call::Outboard { hash, tx } => {
                tx.send(fs::read(self.dir.join(OUTBOARDS).join(hash.to_hex())).map(Bytes::from)).ok();
            }
            Call::Write { name, at, bytes, tx } => {
                let written = self.writing(&name).and_then(|path| {
                    let file = owned().create(true).truncate(false).open(path)?;
                    file.write_all_at(&bytes, at)
                });
                tx.send(written).ok();
            }
            Call::Finish { name, hash, size, outboard, tx } => {
                tx.send(self.finish(&name, hash, size, &outboard)).ok();
            }
            Call::Drop { name, tx } => {
                let dropped = match hash_of(&name) {
                    Some(hash) => removed(fs::remove_file(self.dir.join(OUTBOARDS).join(hash.to_hex())))
                        .and_then(|()| removed(fs::remove_file(self.dir.join(BLOBS).join(hash.to_hex())))),
                    None => self.writing(&name).and_then(|path| removed(fs::remove_file(path))),
                };
                tx.send(dropped).ok();
            }
            Call::Put { name, bytes, tx } => {
                tx.send(self.put(&name, &bytes)).ok();
            }
            Call::Keep { name, bytes, tx } => {
                tx.send(self.keep(&name, &bytes)).ok();
            }
            Call::Get { name, tx } => {
                let got = self.object(&name).and_then(|path| match fs::read(path) {
                    Ok(bytes) => Ok(Some(Bytes::from(bytes))),
                    Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
                    Err(e) => Err(e),
                });
                tx.send(got).ok();
            }
            Call::Names { prefix, tx } => {
                tx.send(self.names(&prefix)).ok();
            }
        }
    }

    /// Where blob `name`, being written, is: in `new/`, under a name of letters, digits and `-` alone.
    fn writing(&self, name: &str) -> io::Result<PathBuf> {
        let plain = !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
        match plain {
            true => Ok(self.dir.join(NEW).join(name)),
            false => Err(io::Error::new(ErrorKind::InvalidInput, format!("{name:?} names no blob being written"))),
        }
    }

    /// Where object `name` is.
    fn object(&self, name: &str) -> io::Result<PathBuf> {
        match shelf::named(name) {
            true => Ok(self.dir.join(name)),
            false => Err(io::Error::new(ErrorKind::InvalidInput, format!("{name:?} names no object"))),
        }
    }

    fn get_bounded(&self, name: &str, limit: usize) -> io::Result<Option<Bytes>> {
        let path = self.object(name)?;
        let file = match File::open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let ceiling = limit
            .checked_add(1)
            .and_then(|n| u64::try_from(n).ok())
            .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, "bounded object limit overflows"))?;
        // Metadata rejects a known huge file cheaply. The streaming limit also
        // covers growth after this check; metadata alone is never the bound.
        if file.metadata()?.len() > limit as u64 {
            return Err(io::Error::new(ErrorKind::InvalidData, "named object exceeds its read limit"));
        }
        let mut bytes = Vec::new();
        file.take(ceiling).read_to_end(&mut bytes)?;
        if bytes.len() > limit {
            return Err(io::Error::new(ErrorKind::InvalidData, "named object exceeds its read limit"));
        }
        Ok(Some(bytes.into()))
    }

    /// Every blob it holds whole, with its size. Listing is read-only: another
    /// handle may be writing a staged blob concurrently. Orphan cleanup requires
    /// exclusive writer ownership at startup, never an ordinary list operation.
    fn list(&self) -> io::Result<Vec<(Hash, u64)>> {
        let mut held = Vec::new();
        for entry in fs::read_dir(self.dir.join(OUTBOARDS))? {
            let Some(hash) = entry?.file_name().to_str().and_then(hash_of) else {
                continue;
            };
            match fs::metadata(self.dir.join(BLOBS).join(hash.to_hex())) {
                Ok(meta) => held.push((hash, meta.len())),
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(e) => return Err(e),
            }
        }
        Ok(held)
    }

    /// `len` bytes of blob `name` from byte `at` on, or fewer at its end: a finished one by its hash, else one being
    /// written.
    fn read(&self, name: &str, at: u64, len: usize) -> io::Result<Bytes> {
        let path = match hash_of(name) {
            Some(hash) => self.dir.join(BLOBS).join(hash.to_hex()),
            None => self.writing(name)?,
        };
        let file = File::open(path)?;
        let end = (at + len as u64).min(file.metadata()?.len());
        let mut bytes = vec![0; end.saturating_sub(at) as usize];
        file.read_exact_at(&mut bytes, at)?;
        Ok(bytes.into())
    }

    /// Blob `name`, written whole, is blob `hash` of `size` bytes: synced and renamed into place, then its outboard
    /// beside it, written whole first. If it holds `hash` already, `name` goes.
    fn finish(&self, name: &str, hash: Hash, size: u64, outboard: &[u8]) -> io::Result<()> {
        let part = self.writing(name)?;
        let (blob, done) = (self.dir.join(BLOBS).join(hash.to_hex()), self.dir.join(OUTBOARDS).join(hash.to_hex()));
        if done.exists() {
            return removed(fs::remove_file(part));
        }
        let file = owned().create(size == 0).truncate(false).open(&part)?;
        let len = file.metadata()?.len();
        if len != size {
            return Err(io::Error::other(format!("{name} is {len} bytes, not {size}")));
        }
        file.sync_all()?;
        fs::rename(&part, &blob)?;
        sync_dir(&self.dir.join(BLOBS))?;
        let staged = self.dir.join(NEW).join(staged("outboard"));
        write_synced(&staged, outboard)?;
        fs::rename(&staged, &done)?;
        sync_dir(&self.dir.join(OUTBOARDS))
    }

    /// Puts `bytes` under `name` once: written whole in `new/`, synced, then linked into place, unless something is
    /// there already. The same bytes there are put already; other bytes are refused.
    fn put(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        let (path, folder) = self.placed(name)?;
        let same = |path: &Path| match fs::read(path)? == bytes {
            true => Ok(()),
            false => Err(io::Error::new(ErrorKind::AlreadyExists, format!("{name} holds other bytes already"))),
        };
        if path.exists() {
            return same(&path);
        }
        let staged = self.dir.join(NEW).join(staged("put"));
        write_synced(&staged, bytes)?;
        let linked = fs::hard_link(&staged, &path);
        removed(fs::remove_file(&staged))?;
        match linked {
            Ok(()) => sync_dir(&folder),
            Err(e) if e.kind() == ErrorKind::AlreadyExists => same(&path),
            Err(e) => Err(e),
        }
    }

    /// Keeps `bytes` under `name` in place: written whole in `new/`, synced, then renamed over what it held, which a
    /// reader finds whole until then.
    fn keep(&self, name: &str, bytes: &[u8]) -> io::Result<()> {
        let (path, folder) = self.placed(name)?;
        let staged = self.dir.join(NEW).join(staged("keep"));
        write_synced(&staged, bytes)?;
        match fs::rename(&staged, &path) {
            Ok(()) => sync_dir(&folder),
            Err(e) => {
                removed(fs::remove_file(&staged))?;
                Err(e)
            }
        }
    }

    /// Where object `name` is, and its folder, made if it isn't yet.
    fn placed(&self, name: &str) -> io::Result<(PathBuf, PathBuf)> {
        let path = self.object(name)?;
        let folder = path.parent().expect("an object's folder").to_path_buf();
        if !folder.exists() {
            fs::create_dir_all(&folder)?;
            // each folder made, named by the one above it
            let mut made = folder.as_path();
            while let Some(above) = made.parent().filter(|_| made != self.dir) {
                sync_dir(above)?;
                made = above;
            }
        }
        Ok((path, folder))
    }

    /// The name of every object whose name starts with `prefix`, in order.
    fn names(&self, prefix: &str) -> io::Result<Vec<String>> {
        let base = prefix.rsplit_once('/').map_or("", |(base, _)| base);
        let mut names = Vec::new();
        walk(&self.dir.join(base), base, &mut names)?;
        names.retain(|name| name.starts_with(prefix) && shelf::named(name));
        names.sort();
        Ok(names)
    }
}

/// Every file under folder `dir`, which is `rel` in the generation's folder, but those in the folders the shelf keeps
/// its blobs in, each by its name there.
fn walk(dir: &Path, rel: &str, names: &mut Vec<String>) -> io::Result<()> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    for entry in entries {
        let entry = entry?;
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        let name = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        if rel.is_empty() && RESERVED.contains(&name.as_str()) {
            continue;
        }
        match entry.file_type()? {
            kind if kind.is_dir() => walk(&entry.path(), &name, names)?,
            kind if kind.is_file() => names.push(name),
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod reader_tests {
    use super::*;
    #[tokio::test]
    async fn real_writer_closes_retained_shelf_handles_and_refuses_stale_generations() {
        let root = std::env::temp_dir().join(format!("avendb-writer-runtime-{}", std::process::id()));
        let reader = open(&root).unwrap();
        assert_eq!(reader.put("not-owned", Bytes::new()).await.unwrap_err().kind(), ErrorKind::PermissionDenied);
        let owner = reader.writer().unwrap();
        let writable = owner.shelf();
        writable.put("history", Bytes::from_static(b"preserve")).await.unwrap();
        assert!(reader.writer().is_err());
        owner.shutdown().await.unwrap();
        assert_eq!(writable.put("too-late", Bytes::new()).await.unwrap_err().kind(), ErrorKind::BrokenPipe);
        assert_eq!(writable.get("history").await.unwrap().unwrap(), Bytes::from_static(b"preserve"));
        let replacement = reader.writer().unwrap();
        replacement.shutdown().await.unwrap();
        let next = aside(&root).unwrap();
        assert!(next > FLOOR);
        assert_eq!(reader.writer().err().unwrap().kind(), ErrorKind::InvalidInput);
        assert_eq!(reader.get("history").await.unwrap().unwrap(), Bytes::from_static(b"preserve"));
        let current = open(&root).unwrap().writer().unwrap();
        current.shutdown().await.unwrap();
        drop((owner, replacement, current, writable, reader));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn bounded_named_reads_reject_sparse_oversized_files_and_keep_exact_boundaries() {
        let root = std::env::temp_dir().join(format!("avendb-bounded-read-{}", std::process::id()));
        let owner = open(&root).unwrap().writer().unwrap();
        let shelf = owner.shelf();
        shelf.put("test/empty", Bytes::new()).await.unwrap();
        shelf.put("test/exact", Bytes::from_static(b"1234")).await.unwrap();
        assert_eq!(shelf.get_bounded("test/empty", 0).await.unwrap(), Some(Bytes::new()));
        assert_eq!(shelf.get_bounded("test/exact", 4).await.unwrap(), Some(Bytes::from_static(b"1234")));
        assert_eq!(shelf.get_bounded("test/exact", 3).await.unwrap_err().kind(), ErrorKind::InvalidData);
        assert!(shelf.get_bounded("test/missing", 4).await.unwrap().is_none());
        let huge = root.join(format!("g{FLOOR}/test/huge"));
        File::create(&huge).unwrap().set_len(1 << 32).unwrap();
        assert_eq!(shelf.get_bounded("test/huge", 4 << 20).await.unwrap_err().kind(), ErrorKind::InvalidData);
        assert_eq!(shelf.get_bounded("../escape", 4).await.unwrap_err().kind(), ErrorKind::InvalidInput);
        let (unsupported, _rx) = Shelf::new();
        assert_eq!(unsupported.get_bounded("test/exact", 4).await.unwrap_err().kind(), ErrorKind::Unsupported);
        drop(shelf);
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn existing_reader_open_is_inert_but_bootstrap_requires_writer_ownership() {
        let root = std::env::temp_dir().join(format!("avendb-reader-bootstrap-{}", std::process::id()));
        let shelf = open(&root).unwrap();
        drop(shelf);
        let source = crate::writer::Source::new(&root);
        let owner = source.claim().unwrap();
        let generation = root.join(format!("g{FLOOR}"));
        let before = fs::metadata(&generation).unwrap().modified().unwrap();
        assert!(open(&root).is_ok(), "a complete read-open needs no writer lease");
        assert_eq!(before, fs::metadata(&generation).unwrap().modified().unwrap());
        fs::remove_dir(generation.join(NEW)).unwrap();
        assert!(open(&root).is_err(), "read-open cannot repair a held writer's generation");
        assert!(!generation.join(NEW).exists());
        drop(owner);
        assert!(open(&root).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn another_reader_listing_never_deletes_the_writers_staged_blob() {
        let root = std::env::temp_dir().join(format!("avendb-reader-staging-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let _ownership = open(&root).unwrap().writer().unwrap();
        let writer = _ownership.shelf();
        writer.write("new-reader-race", 0, Bytes::from_static(b"first part")).await.unwrap();
        let reader = open(&root).unwrap();
        assert!(reader.list().await.unwrap().is_empty());
        writer.write("new-reader-race", 10, Bytes::from_static(b" and last")).await.unwrap();
        assert_eq!(&reader.read("new-reader-race", 0, 64).await.unwrap()[..], b"first part and last");
        assert!(root.join(format!("g{FLOOR}/new/new-reader-race")).exists());
        drop((reader, writer, _ownership));
        std::fs::remove_dir_all(root).unwrap();
    }
}
