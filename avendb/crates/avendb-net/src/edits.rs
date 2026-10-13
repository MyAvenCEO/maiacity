//! A node's edits on its shelf (v8 phase S, `shelf`): what its device holds, kept the same way on every place, a
//! page's OPFS, the Mac's folder and the server's bucket, in objects each put once and never replaced or deleted, and
//! in blobs:
//!
//! - `journal/<n>`, numbered from 0 on in 16 hex digits: what one save added, the McEliece keys it brought, each by its
//!   id and the blob that holds it, and the new edits of the device's log;
//! - `heads/<n>`, numbered from 1 on: a head, put after every `JOURNALED` entries, which names the packs that hold the
//!   device's edits up to an entry of the journal, and every McEliece key: a node starts from its newest head and the
//!   journal after it, a few dozen objects, however long its device's log;
//! - a pack: a blob of `PACK` and then edits, as a journal entry holds them.
//!
//! An edit is a record: its length in 4 bytes, big-endian, then its bytes on the wire. A head and a journal entry end
//! with the BLAKE3 hash of all before it, so one cut short or changed reads as none: the node starts from the newest
//! head that reads whole, packs and all, or an older one, and skips an entry that doesn't. The device checks every
//! edit again as it takes it back (`Lab::restore_backup`); if any fails, or the shelf holds `PACKS` packs, the next
//! head names one pack of its whole log alone, and the heads, packs and entries before it stay where they are, as
//! everything put on a shelf does.
//!
//! A node's holdings name of its device's edits only those its shelf holds (`Edits::held`): on the server, those its
//! bucket took.

use std::collections::{BTreeMap, HashSet};
use std::io::ErrorKind;
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result, anyhow};
use avendb::id::{BlobId, EditId, SignerId};
use avendb::lab::Lab;
use avendb::sign::Signed;
use avendb::wire::Wire;
use bytes::Bytes;
use iroh_blobs::Hash;
use n0_future::time;
use tokio::sync::Notify;

use crate::shelf::Shelf;
use crate::{BACKOFF_MAX, Cursor, Shared};

/// What every head starts with: avenDB's heads, version 1.
const HEAD: &[u8] = b"avenDB head 1\n";
/// What every journal entry starts with.
const ENTRY: &[u8] = b"avenDB journal 1\n";
/// What every pack starts with: avenDB's edits, version 1.
const PACK: &[u8] = b"avenDB edits 1\n";
/// How many journal entries a head comes after.
const JOURNALED: u64 = 64;
/// Once a head names this many packs, the next names one pack of the whole log.
const PACKS: usize = 64;
const HEADS: &str = "heads/";
const JOURNAL: &str = "journal/";

/// A blob on the shelf: its hash and its size.
type Blob = (Hash, u64);
/// A McEliece key on the shelf: its id, and the blob that holds it.
type Key = (BlobId, Blob);

/// A node's edits on its shelf, as the module says.
pub(crate) struct Edits {
    shelf: Shelf,
    /// What the shelf holds, which one save at a time reads and writes.
    book: tokio::sync::Mutex<Book>,
    kept: Mutex<Kept>,
    /// Woken when its device took something new.
    pub(crate) due: Notify,
}

/// What a node's shelf holds of its edits.
struct Book {
    /// The packs the newest head names.
    packs: Vec<Blob>,
    /// Every McEliece key on the shelf.
    keys: BTreeMap<BlobId, Blob>,
    /// The first journal entry the newest head doesn't cover, and the next to put.
    mark: u64,
    next: u64,
    /// The number of the next head.
    head: u64,
    /// The records of the journal's entries from `mark` on: the next pack.
    pending: Vec<u8>,
}

/// What the shelf holds of the node's device.
struct Kept {
    /// The first `written` edits of the device's log.
    written: usize,
    keys: HashSet<BlobId>,
    /// The next save puts a head of the whole log: the device didn't take back every edit the shelf held.
    whole: bool,
}

/// What a save puts on the shelf: the edits of the device's log from where the shelf's end, or all of them for a head
/// of the whole log, up to place `to`, and the McEliece keys the shelf lacks.
struct Due {
    to: usize,
    records: Vec<u8>,
    keys: Vec<(BlobId, Arc<[u8]>)>,
    whole: bool,
}

/// What a node takes back from its shelf as it starts: its edits, in the order they were saved, and McEliece keys.
pub(crate) type Stored = (Vec<Signed>, Vec<Arc<[u8]>>);

/// One record: the edit's length, then its bytes.
fn record(out: &mut Vec<u8>, signed: &Signed) {
    let bytes = signed.to_wire();
    out.extend((bytes.len() as u32).to_be_bytes());
    out.extend(bytes);
}

/// The edits of `records`, every one of which must decode whole.
fn edits_of(records: &[u8]) -> Option<Vec<Signed>> {
    let (mut signed, mut r) = (Vec::new(), Cursor(records));
    while !r.0.is_empty() {
        let len = u32::from_be_bytes(r.array()?) as usize;
        signed.push(Signed::from_wire(r.take(len)?).ok()?);
    }
    Some(signed)
}

/// `out`, with the BLAKE3 hash of it after it.
fn summed(mut out: Vec<u8>) -> Bytes {
    let sum = Hash::new(&out);
    out.extend(sum.as_bytes());
    out.into()
}

/// What comes before the BLAKE3 hash at the end of `bytes`, if it is the hash of it.
fn unsummed(bytes: &[u8]) -> Option<&[u8]> {
    let (body, sum) = bytes.split_at_checked(bytes.len().checked_sub(32)?)?;
    (Hash::new(body).as_bytes() == sum).then_some(body)
}

fn put_blob(out: &mut Vec<u8>, (hash, size): &Blob) {
    out.extend(hash.as_bytes());
    out.extend(size.to_be_bytes());
}

fn put_keys(out: &mut Vec<u8>, keys: &[Key]) {
    out.extend((keys.len() as u32).to_be_bytes());
    for (id, blob) in keys {
        out.extend(id.0);
        put_blob(out, blob);
    }
}

impl Cursor<'_> {
    fn blob(&mut self) -> Option<Blob> {
        Some((Hash::from_bytes(self.array()?), u64::from_be_bytes(self.array()?)))
    }

    fn keys(&mut self) -> Option<Vec<Key>> {
        (0..u32::from_be_bytes(self.array()?)).map(|_| Some((BlobId(self.array()?), self.blob()?))).collect()
    }
}

/// A head: the packs that hold the device's edits up to journal entry `journal`, and every McEliece key.
#[derive(Default)]
struct Head {
    journal: u64,
    packs: Vec<Blob>,
    keys: Vec<Key>,
}

impl Head {
    fn to_bytes(&self) -> Bytes {
        let mut out = HEAD.to_vec();
        out.extend(self.journal.to_be_bytes());
        out.extend((self.packs.len() as u32).to_be_bytes());
        self.packs.iter().for_each(|pack| put_blob(&mut out, pack));
        put_keys(&mut out, &self.keys);
        summed(out)
    }

    fn from_bytes(bytes: &[u8]) -> Option<Head> {
        let mut r = Cursor(unsummed(bytes)?.strip_prefix(HEAD)?);
        let journal = u64::from_be_bytes(r.array()?);
        let packs = (0..u32::from_be_bytes(r.array()?)).map(|_| r.blob()).collect::<Option<_>>()?;
        let keys = r.keys()?;
        r.0.is_empty().then_some(Head { journal, packs, keys })
    }
}

/// A journal entry: the McEliece keys a save brought, and the records of its new edits.
struct Entry {
    keys: Vec<Key>,
    records: Vec<u8>,
}

impl Entry {
    fn to_bytes(&self) -> Bytes {
        let mut out = ENTRY.to_vec();
        put_keys(&mut out, &self.keys);
        out.extend(&self.records);
        summed(out)
    }

    fn from_bytes(bytes: &[u8]) -> Option<Entry> {
        let mut r = Cursor(unsummed(bytes)?.strip_prefix(ENTRY)?);
        let keys = r.keys()?;
        Some(Entry { keys, records: r.0.to_vec() })
    }
}

fn head_name(n: u64) -> String {
    format!("{HEADS}{n:016x}")
}

fn journal_name(n: u64) -> String {
    format!("{JOURNAL}{n:016x}")
}

impl Edits {
    /// The edits on `shelf`, and what it holds, for its device to take back: the edits of its newest head that reads
    /// whole and of the journal after it, each once, in the order they were saved, and every McEliece key that reads
    /// whole and is its id's. Nothing, on a new shelf. Fails if the shelf can't be read.
    pub(crate) async fn open(shelf: Shelf) -> Result<(Edits, Stored)> {
        let mut heads: Vec<u64> = shelf.names(HEADS).await?.iter().filter_map(|name| {
            u64::from_str_radix(name.strip_prefix(HEADS)?, 16).ok()
        }).collect();
        heads.sort();
        let next_head = heads.last().map_or(1, |n| n + 1);
        let mut start = None;
        for &n in heads.iter().rev() {
            match read_head(&shelf, n).await {
                Ok(read) => {
                    start = Some(read);
                    break;
                }
                Err(e) => tracing::warn!("avendb: head {n} on the shelf doesn't read whole, so it is passed: {e:#}"),
            }
        }
        let (head, mut signed) = start.unwrap_or_default();
        let mut keys: BTreeMap<BlobId, Blob> = head.keys.into_iter().collect();
        let (mut pending, mut next) = (Vec::new(), head.journal);
        while let Some(bytes) = shelf.get(&journal_name(next)).await? {
            next += 1;
            let entry = Entry::from_bytes(&bytes).and_then(|e| Some((edits_of(&e.records)?, e)));
            let Some((edits, entry)) = entry else {
                tracing::warn!("avendb: journal entry {} on the shelf doesn't read whole, and is skipped", next - 1);
                continue;
            };
            signed.extend(edits);
            pending.extend(entry.records);
            keys.extend(entry.keys);
        }
        let mut bytes = Vec::new();
        for (id, (hash, size)) in keys.clone() {
            match shelf.read_blob(hash, size).await {
                Ok(key) if BlobId::of(&key) == id => bytes.push(Arc::from(&key[..])),
                Ok(_) => {
                    tracing::warn!("avendb: McEliece key {} on the shelf isn't its id's, and is left out", id.to_hex());
                    keys.remove(&id);
                }
                Err(e) => {
                    tracing::warn!("avendb: McEliece key {} on the shelf doesn't read whole: {e}", id.to_hex());
                    keys.remove(&id);
                }
            }
        }
        let mut seen = HashSet::new();
        signed.retain(|s| seen.insert(s.edit.id()));
        let kept = Kept { written: 0, keys: keys.keys().copied().collect(), whole: false };
        let book = Book { packs: head.packs, keys, mark: head.journal, next, head: next_head, pending };
        let edits = Edits { shelf, book: tokio::sync::Mutex::new(book), kept: Mutex::new(kept), due: Notify::new() };
        Ok((edits, (signed, bytes)))
    }

    /// Takes on device `me` of `lab` as it started, from the edits `stored` its shelf held, in their order: if the log
    /// goes on from them, the shelf holds its first edits; else, as some failed their checks, the next save puts a
    /// head of the whole log.
    pub(crate) fn settle(&self, lab: &Lab, me: SignerId, stored: &[EditId]) {
        let mut kept = self.kept.lock().expect("kept");
        match lab.log(me).ids().starts_with(stored) {
            true => kept.written = stored.len(),
            false => kept.whole = true,
        }
    }

    /// How many of the edits of device `me` of `lab` the shelf holds, the first of its log: none while it is due a
    /// head of the whole log, as the device didn't take back every edit it held.
    pub(crate) fn held(&self, lab: &Lab, me: SignerId) -> usize {
        let kept = self.kept.lock().expect("kept");
        if kept.whole { 0 } else { kept.written.min(lab.size(me).0) }
    }

    /// The shelf lacks an edit or a McEliece key device `me` of `lab` holds, or the head of its whole log it is due.
    pub(crate) fn lacks(&self, lab: &Lab, me: SignerId) -> bool {
        let kept = self.kept.lock().expect("kept");
        kept.whole || kept.written < lab.size(me).0 || lab.blob_ids(me).iter().any(|b| !kept.keys.contains(b))
    }

    /// What a save puts on the shelf, as device `me` of `lab` holds it now and `book` says the shelf holds, if
    /// anything: its new edits and keys, or a pack and head due.
    fn due(&self, lab: &Lab, me: SignerId, (journaled, packs): (u64, usize)) -> Result<Option<Due>> {
        let kept = self.kept.lock().expect("kept");
        let ids = lab.log(me).ids();
        let mut keys = Vec::new();
        for b in lab.blob_ids(me).into_iter().filter(|b| !kept.keys.contains(b)) {
            keys.push((b, lab.blob(me, b).context("a key the device holds")?));
        }
        let fresh = ids.len() > kept.written || !keys.is_empty();
        let packing = journaled + u64::from(fresh) >= JOURNALED;
        let whole = kept.whole || ids.len() < kept.written || (packing && packs >= PACKS);
        if !whole && !fresh && !packing {
            return Ok(None);
        }
        let mut records = Vec::new();
        for id in &ids[if whole { 0 } else { kept.written }..] {
            record(&mut records, lab.signed_edit(me, *id).context("an edit the device holds")?);
        }
        Ok(Some(Due { to: ids.len(), records, keys, whole }))
    }

    /// Puts `due` on the shelf: each new McEliece key as a blob, then the new edits and keys in the next journal
    /// entry, and a pack and a head if one is due; or a pack of the whole log and a head that names it alone.
    async fn put(&self, book: &mut Book, due: Due) -> Result<()> {
        let mut brought = Vec::new();
        for (id, bytes) in &due.keys {
            let blob = match book.keys.get(id) {
                Some(blob) => *blob,
                None => self.shelf.put_blob(&Bytes::copy_from_slice(bytes)).await?,
            };
            brought.push((*id, blob));
        }
        let ids: Vec<BlobId> = due.keys.iter().map(|(id, _)| *id).collect();
        if due.whole {
            let pack = self.pack(&due.records).await?;
            book.keys.extend(brought);
            let head = Head { journal: book.next, packs: vec![pack], keys: book.keys.clone().into_iter().collect() };
            self.put_head(book, &head).await?;
            (book.packs, book.mark) = (vec![pack], book.next);
            book.pending.clear();
            let mut kept = self.kept.lock().expect("kept");
            (kept.written, kept.whole) = (due.to, false);
            kept.keys.extend(ids);
            return Ok(());
        }
        let (mut records, mut keys) = (&due.records[..], brought);
        while !records.is_empty() || !keys.is_empty() {
            let name = journal_name(book.next);
            let entry = Entry { keys: keys.clone(), records: records.to_vec() };
            match self.shelf.put(&name, entry.to_bytes()).await {
                Ok(()) => {
                    book.next += 1;
                    book.pending.extend(records);
                    book.keys.extend(keys);
                    break;
                }
                // put by a save cut short: what of this one it holds is put
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                    book.next += 1;
                    let there = self.shelf.get(&name).await?.and_then(|bytes| Entry::from_bytes(&bytes));
                    let ours = |there: &Entry| {
                        records.starts_with(&there.records) && there.keys.iter().all(|k| keys.contains(k))
                    };
                    match there {
                        Some(there) if ours(&there) => {
                            records = &records[there.records.len()..];
                            keys.retain(|k| !there.keys.contains(k));
                            book.pending.extend(&there.records);
                            book.keys.extend(there.keys);
                        }
                        _ => tracing::warn!("avendb: {name} on the shelf is none of this node's saves, and is passed"),
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        {
            let mut kept = self.kept.lock().expect("kept");
            kept.written = due.to;
            kept.keys.extend(ids);
        }
        if book.next - book.mark >= JOURNALED {
            let pack = self.pack(&book.pending).await?;
            let mut packs = book.packs.clone();
            packs.push(pack);
            let keys = book.keys.clone().into_iter().collect();
            self.put_head(book, &Head { journal: book.next, packs: packs.clone(), keys }).await?;
            (book.packs, book.mark) = (packs, book.next);
            book.pending.clear();
        }
        Ok(())
    }

    /// A pack of `records`, on the shelf.
    async fn pack(&self, records: &[u8]) -> Result<Blob> {
        Ok(self.shelf.put_blob(&Bytes::from([PACK, records].concat())).await?)
    }

    /// Puts `head` on the shelf, as the next head after every head there.
    async fn put_head(&self, book: &mut Book, head: &Head) -> Result<()> {
        let bytes = head.to_bytes();
        loop {
            let name = head_name(book.head);
            match self.shelf.put(&name, bytes.clone()).await {
                Ok(()) => {
                    book.head += 1;
                    return Ok(());
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => book.head += 1,
                Err(e) => return Err(e.into()),
            }
        }
    }
}

/// Head `n` on `shelf`, and the edits of its packs, every one of which must read whole.
async fn read_head(shelf: &Shelf, n: u64) -> Result<(Head, Vec<Signed>)> {
    let bytes = shelf.get(&head_name(n)).await?.ok_or_else(|| anyhow!("listed, and gone"))?;
    let head = Head::from_bytes(&bytes).ok_or_else(|| anyhow!("cut short or changed"))?;
    let mut signed = Vec::new();
    for &(hash, size) in &head.packs {
        let pack = shelf.read_blob(hash, size).await.with_context(|| format!("its pack {hash}"))?;
        let records = pack.strip_prefix(PACK).with_context(|| format!("its pack {hash} is no pack of edits"))?;
        signed.extend(edits_of(records).with_context(|| format!("its pack {hash} holds an edit cut short"))?);
    }
    Ok((head, signed))
}

impl Shared {
    /// Puts on the node's shelf, if it keeps one, what its device took since the last save, as `Edits::put` says. True
    /// if the shelf holds more now.
    pub(crate) async fn save(self: &Arc<Self>) -> Result<bool> {
        let Some(edits) = &self.edits else { return Ok(false) };
        let mut book = edits.book.lock().await;
        let plan = (book.next - book.mark, book.packs.len());
        let shared = self.clone();
        let due = move || {
            let lab = shared.lab.lock().expect("the Lab");
            shared.edits.as_ref().expect("its edits").due(&lab, shared.me, plan)
        };
        #[cfg(not(target_arch = "wasm32"))]
        let due = tokio::task::spawn_blocking(due).await??;
        #[cfg(target_arch = "wasm32")]
        let due = due()?;
        let Some(due) = due else { return Ok(false) };
        edits.put(&mut book, due).await?;
        Ok(true)
    }

    /// Puts on the node's shelf what its device takes, as soon as it took it, and tells the peers once the shelf holds
    /// it, as the node's holdings name it from then on; a failed save it tries again after `retry`, then twice as long
    /// each time, up to `BACKOFF_MAX`.
    pub(crate) async fn saver(self: Arc<Self>) {
        let Some(edits) = &self.edits else { return };
        let mut wait = self.opts.retry;
        loop {
            match self.save().await {
                Ok(saved) => {
                    if saved {
                        self.changed.notify_one();
                    }
                    wait = self.opts.retry;
                    edits.due.notified().await;
                }
                Err(e) => {
                    tracing::warn!("avendb: the shelf can't be written, trying again in {wait:?}: {e:#}");
                    time::sleep(wait).await;
                    wait = wait.saturating_mul(2).min(BACKOFF_MAX);
                }
            }
        }
    }
}
