//! A node's edits on its shelf (v8 phase S, `shelf`): what its device holds, kept the same way on every place, a
//! page's OPFS, the Mac's folder and the server's bucket, in objects each put once and never replaced or deleted, and
//! in blobs:
//!
//! - `journal/<n>`, numbered from 0 on in 16 hex digits: what one save added, the McEliece keys it brought, each by its
//!   id, the hash of the blob that holds it, and its size, and the new edits of the device's log;
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
//! - `slots/keys-0` and `slots/keys-1`: the device's keys, encrypted for it alone (`Lab::warming`): the keys it opened
//!   from their boxes, so that it doesn't open them again, and its newest head of edits it checked, by its number and
//!   the hash of its bytes (`Checked`), so that it doesn't check their signatures again as it starts from that head
//!   (`Lab::restore_warm`); kept after every key it opens and every head it puts or takes back whole.
//! - `slots/view-0` and `slots/view-1`: the device's stored view, what its edits said when it last kept one, encrypted
//!   for it alone and this engine (`Replay::to_view`), for a node to step on from there rather than replay every edit,
//!   kept after a replay of every edit, or 4096 edits stepped on.
//!
//! Each slot is what it starts with (`KEYS`, `VIEW`), the number it was kept as, in 8 bytes, big-endian, then what it
//! keeps; the next goes in place of the older of the two (`Shelf::keep`), put after the edits it names, so the newest
//! that opens names edits the shelf holds. A slot is no history: every edit stays on the shelf as it was put, and one
//! that doesn't open costs the node a check of the signatures, the keys opened again or a replay of every edit, no
//! more.
//!
//! What older nodes put beside these, `sealed/<n>`, `warm/<n>` and `opened/<n>`, no node reads or puts any more; they
//! stay where they are, as everything put on a shelf does, till the person clears them.
//!
//! A node's holdings name of its device's edits only those its shelf holds (`Edits::held`): on the server, those its
//! bucket took.

use std::collections::{BTreeMap, HashSet};
use std::io::ErrorKind;
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result, anyhow, ensure};
use avendb::id::{BlobId, EditId, EntryId, SignerId};
use avendb::lab::{Checked, Lab, Warm, Warming};
use avendb::policy::{Log, LogRevision};
use avendb::sign::Signed;
use avendb::wire::Wire;
use bytes::Bytes;
use iroh_blobs::Hash;
use n0_future::time;
use tokio::sync::Notify;

use crate::shelf::Shelf;
use crate::{BACKOFF_MAX, Cursor, Shared};

/// What every head starts with: avenDB's heads, version 2 since a McEliece key's id is its blob's hash.
const HEAD: &[u8] = b"avenDB head 2\n";
/// What every journal entry starts with, of the same version.
const ENTRY: &[u8] = b"avenDB journal 2\n";
/// Explicit adopted baselines use v3; ordinary stores retain their v2 format.
const HEAD_ANCHORS: &[u8] = b"avenDB head 3\n";
const ENTRY_ANCHORS: &[u8] = b"avenDB journal 3\n";
const MAX_ANCHORS: usize = 16 * (1024 * 1024 + 256 + 1024 * 32);
/// What every pack starts with: avenDB's edits, version 1.
const PACK: &[u8] = b"avenDB edits 1\n";
/// How many journal entries a head comes after.
const JOURNALED: u64 = 64;
/// Once a head names this many packs, the next names one pack of the whole log.
const PACKS: usize = 64;
const HEADS: &str = "heads/";
const JOURNAL: &str = "journal/";
/// The two slots a device's keys are kept in, in turn, and what each starts with.
const KEYS: ([&str; 2], &[u8]) = (["slots/keys-0", "slots/keys-1"], b"avenDB keys 1\n");
/// The two slots a device's stored view is kept in, in turn, and what each starts with.
const VIEW: ([&str; 2], &[u8]) = (["slots/view-0", "slots/view-1"], b"avenDB slot 1\n");

/// A blob on the shelf: its hash and its size.
pub(crate) type Blob = (Hash, u64);
/// A McEliece key on the shelf: its id, the hash of the blob that holds it, and its size.
pub(crate) type Key = (BlobId, u64);

/// A node's edits on its shelf, as the module says.
pub(crate) struct Edits {
    shelf: Shelf,
    /// What the shelf holds, which one save at a time reads and writes.
    book: tokio::sync::Mutex<Book>,
    kept: Mutex<Kept>,
    /// The numbers its next keys and its next stored view are kept as, `n` in slot `n % 2` of theirs (`warm`).
    slots: Mutex<(u64, u64)>,
    /// The head it started from and how many edits it holds, the first it took back (`started`); and its newest head
    /// of edits its device checked, each one (`checked`).
    started: Option<(Checked, usize)>,
    checked: Mutex<Option<Checked>>,
    /// Woken when its device took something new.
    pub(crate) due: Notify,
}

/// What a node's shelf holds of its edits.
struct Book {
    /// The packs the newest head names.
    packs: Vec<Blob>,
    /// Every McEliece key on the shelf, and its size.
    keys: BTreeMap<BlobId, u64>,
    /// The first journal entry the newest head doesn't cover, and the next to put.
    mark: u64,
    next: u64,
    /// The number of the next head.
    head: u64,
    /// The records of the journal's entries from `mark` on: the next pack.
    pending: Vec<u8>,
    anchors: Vec<u8>,
}

/// What the shelf holds of the node's device.
struct Kept {
    /// The first `written` edits of the device's log.
    written: usize,
    anchor_stamp: Vec<(EntryId, EditId)>,
    /// The log whose first `written` edits were persisted. Withdrawals and restores start a new lineage, even
    /// when the number of edits stays the same; an in-flight save acknowledges only the lineage it wrote.
    lineage: Option<LogRevision>,
    keys: HashSet<BlobId>,
    /// The next save puts a head of the whole log: the device didn't take back every edit the shelf held.
    whole: bool,
}

impl Kept {
    fn continues(&self, log: &Log) -> bool {
        !self.whole && self.lineage.as_ref() == Some(&log.lineage())
    }
}

/// What a save puts on the shelf: the edits of the device's log from where the shelf's end, or all of them for a head
/// of the whole log, up to place `to`, and the McEliece keys the shelf lacks.
struct Due {
    to: usize,
    anchor_stamp: Vec<(EntryId, EditId)>,
    anchors: Vec<u8>,
    lineage: LogRevision,
    records: Vec<u8>,
    keys: Vec<(BlobId, Arc<[u8]>)>,
    whole: bool,
}

/// What a node takes back from its shelf as it starts: its edits, in the order they were saved, and McEliece keys.
pub(crate) type Stored = (Vec<Signed>, Vec<Arc<[u8]>>, Vec<u8>);

/// Head `n` of `bytes`, by its number and the hash of its bytes: it names its packs by their hashes, each checked as it
/// is read (`Shelf::read_blob`), so one head named so holds the very edits it held.
fn checked(n: u64, bytes: &[u8]) -> Checked {
    let mut out = [0; 40];
    out[..8].copy_from_slice(&n.to_be_bytes());
    out[8..].copy_from_slice(Hash::new(bytes).as_bytes());
    out
}

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
    for (id, size) in keys {
        put_blob(out, &(key_blob(*id), *size));
    }
}

/// The hash of the blob that holds McEliece key `id`: its id.
pub(crate) fn key_blob(id: BlobId) -> Hash {
    Hash::from_bytes(id.0)
}

impl Cursor<'_> {
    fn blob(&mut self) -> Option<Blob> {
        Some((Hash::from_bytes(self.array()?), u64::from_be_bytes(self.array()?)))
    }

    fn keys(&mut self) -> Option<Vec<Key>> {
        let key = |(hash, size): Blob| (BlobId(*hash.as_bytes()), size);
        (0..u32::from_be_bytes(self.array()?)).map(|_| self.blob().map(key)).collect()
    }
}

/// A head: the packs that hold the device's edits up to journal entry `journal`, and every McEliece key.
#[derive(Default)]
struct Head {
    anchors: Vec<u8>,
    journal: u64,
    packs: Vec<Blob>,
    keys: Vec<Key>,
}

impl Head {
    fn to_bytes(&self) -> Bytes {
        let mut out = if self.anchors.is_empty() { HEAD } else { HEAD_ANCHORS }.to_vec();
        out.extend(self.journal.to_be_bytes());
        out.extend((self.packs.len() as u32).to_be_bytes());
        self.packs.iter().for_each(|pack| put_blob(&mut out, pack));
        put_keys(&mut out, &self.keys);
        if !self.anchors.is_empty() {
            out.extend((self.anchors.len() as u32).to_be_bytes());
            out.extend(&self.anchors);
        }
        summed(out)
    }

    fn from_bytes(bytes: &[u8]) -> Option<Head> {
        let bytes = unsummed(bytes)?;
        let current = bytes.starts_with(HEAD_ANCHORS);
        let mut r = Cursor(bytes.strip_prefix(if current { HEAD_ANCHORS } else { HEAD })?);
        let journal = u64::from_be_bytes(r.array()?);
        let packs = (0..u32::from_be_bytes(r.array()?)).map(|_| r.blob()).collect::<Option<_>>()?;
        let keys = r.keys()?;
        let anchors = if current { read_anchors(&mut r)? } else { Vec::new() };
        r.0.is_empty().then_some(Head { journal, packs, keys, anchors })
    }
}

/// A journal entry: the McEliece keys a save brought, and the records of its new edits.
struct Entry {
    anchors: Vec<u8>,
    keys: Vec<Key>,
    records: Vec<u8>,
}

impl Entry {
    fn to_bytes(&self) -> Bytes {
        let mut out = if self.anchors.is_empty() { ENTRY } else { ENTRY_ANCHORS }.to_vec();
        put_keys(&mut out, &self.keys);
        if !self.anchors.is_empty() {
            out.extend((self.anchors.len() as u32).to_be_bytes());
            out.extend(&self.anchors);
        }
        out.extend(&self.records);
        summed(out)
    }

    fn from_bytes(bytes: &[u8]) -> Option<Entry> {
        let bytes = unsummed(bytes)?;
        let current = bytes.starts_with(ENTRY_ANCHORS);
        let mut r = Cursor(bytes.strip_prefix(if current { ENTRY_ANCHORS } else { ENTRY })?);
        let keys = r.keys()?;
        let anchors = if current { read_anchors(&mut r)? } else { Vec::new() };
        Some(Entry { keys, records: r.0.to_vec(), anchors })
    }
}

fn head_name(n: u64) -> String {
    format!("{HEADS}{n:016x}")
}

fn journal_name(n: u64) -> String {
    format!("{JOURNAL}{n:016x}")
}

/// The numbers of the objects on `shelf` named `<prefix><n>`, `n` in hex, in order, each with what follows it.
async fn numbered(shelf: &Shelf, prefix: &str) -> Result<Vec<(u64, String)>> {
    let mut found: Vec<(u64, String)> = shelf
        .names(prefix)
        .await?
        .iter()
        .filter_map(|name| {
            let rest = name.strip_prefix(prefix)?;
            let (n, after) = rest.split_at(rest.find('-').unwrap_or(rest.len()));
            Some((u64::from_str_radix(n, 16).ok()?, after.to_string()))
        })
        .collect();
    found.sort();
    Ok(found)
}

fn read_anchors(r: &mut Cursor<'_>) -> Option<Vec<u8>> {
    let n = u32::from_be_bytes(r.array()?) as usize;
    if n > MAX_ANCHORS || r.0.len() < n { return None; }
    let (bytes, rest) = r.0.split_at(n);
    r.0 = rest;
    Some(bytes.to_vec())
}

impl Edits {
    /// The edits on `shelf`, and what it holds, for its device to take back: the edits of its newest head that reads
    /// whole and of the journal after it, each once, in the order they were saved, and every McEliece key that reads
    /// whole and is its id's. Nothing, on a new shelf. Fails if the shelf can't be read.
    pub(crate) async fn open(shelf: Shelf) -> Result<(Edits, Stored)> {
        let heads: Vec<u64> =
            numbered(&shelf, HEADS).await?.into_iter().filter(|(_, after)| after.is_empty()).map(|(n, _)| n).collect();
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
        let (head, named, mut signed) = match start {
            Some((head, named, signed)) => (head, Some(named), signed),
            None => Default::default(),
        };
        let mut seen = HashSet::new();
        signed.retain(|s| seen.insert(s.edit.id()));
        let started = named.map(|named| (named, signed.len()));
        let mut anchors = head.anchors;
        let mut keys: BTreeMap<BlobId, u64> = head.keys.into_iter().collect();
        let (mut pending, mut next) = (Vec::new(), head.journal);
        while let Some(bytes) = shelf.get(&journal_name(next)).await? {
            next += 1;
            let entry = Entry::from_bytes(&bytes).and_then(|e| Some((edits_of(&e.records)?, e)));
            let Some((edits, entry)) = entry else {
                tracing::warn!("avendb: journal entry {} on the shelf doesn't read whole, and is skipped", next - 1);
                continue;
            };
            signed.extend(edits.into_iter().filter(|s| seen.insert(s.edit.id())));
            anchors = entry.anchors;
            pending.extend(entry.records);
            keys.extend(entry.keys);
        }
        let mut bytes = Vec::new();
        for (id, size) in keys.clone() {
            // checked against its hash, which is its id
            match shelf.read_blob(key_blob(id), size).await {
                Ok(key) => bytes.push(Arc::from(&key[..])),
                Err(e) => {
                    tracing::warn!("avendb: McEliece key {} on the shelf doesn't read whole: {e}", id.to_hex());
                    keys.remove(&id);
                }
            }
        }
        let kept = Kept { anchor_stamp: Vec::new(), written: 0, lineage: None, keys: keys.keys().copied().collect(), whole: false };
        let book = Book { packs: head.packs, keys, mark: head.journal, next, head: next_head, pending, anchors: anchors.clone() };
        let (book, kept) = (tokio::sync::Mutex::new(book), Mutex::new(kept));
        let (slots, checked) = (Mutex::new((0, 0)), Mutex::new(None));
        let edits = Edits { shelf, book, kept, slots, started, checked, due: Notify::new() };
        Ok((edits, (signed, bytes, anchors)))
    }

    /// What the device worked out before, as the shelf keeps it (`slots/`): its keys and its stored views, each the
    /// newest first. Nothing, where the shelf can't be read.
    pub(crate) async fn warm(&self) -> Warm {
        let read = async {
            let (keys, next_keys) = self.slots(KEYS).await?;
            let (views, next_view) = self.slots(VIEW).await?;
            *self.slots.lock().expect("slots") = (next_keys, next_view);
            anyhow::Ok(Warm { keys, views })
        };
        read.await.unwrap_or_else(|e| {
            tracing::warn!("avendb: what the device worked out before can't be read from its shelf: {e:#}");
            Warm::default()
        })
    }

    /// What the two slots `which` keep, the newest first, and the number the next is kept as.
    async fn slots(&self, (names, starts): ([&str; 2], &[u8])) -> Result<(Vec<Vec<u8>>, u64)> {
        let mut kept = vec![];
        for name in names {
            let bytes = self.shelf.get(name).await?;
            let slot = bytes.as_deref().and_then(|b| b.strip_prefix(starts)).and_then(|b| b.split_first_chunk::<8>());
            kept.extend(slot.map(|(n, bytes)| (u64::from_be_bytes(*n), bytes.to_vec())));
        }
        kept.sort_by(|a, b| b.0.cmp(&a.0));
        let next = kept.first().map_or(0, |(n, _)| n + 1);
        Ok((kept.into_iter().map(|(_, bytes)| bytes).collect(), next))
    }

    /// Keeps on the shelf what the device worked out (`Shared::save`), as `warming` gives it, each in place of the older
    /// of the two its slots keep: its keys, then its view.
    async fn put_warm_on(&self, on: &Shelf, warming: &mut Warming) -> Result<()> {
        if let Some(keys) = warming.keys.take() {
            let n = self.slots.lock().expect("slots").0;
            self.keep_on(on, KEYS, n, &keys).await?;
            self.slots.lock().expect("slots").0 = n + 1;
        }
        if let Some(view) = warming.view.take() {
            let n = self.slots.lock().expect("slots").1;
            self.keep_on(on, VIEW, n, &view).await?;
            self.slots.lock().expect("slots").1 = n + 1;
        }
        Ok(())
    }

    /// Keeps `bytes` as number `n` of the slots `which`, in slot `n % 2`.
    async fn keep_on(&self, on: &Shelf, (names, starts): ([&str; 2], &[u8]), n: u64, bytes: &[u8]) -> Result<()> {
        let kept = [starts, &n.to_be_bytes(), bytes].concat();
        Ok(on.keep(names[(n % 2) as usize], Bytes::from(kept)).await?)
    }

    /// The head the node started from, by its number and the hash of its bytes, and how many edits it holds, the first
    /// the node took back (`Lab::restore_warm`).
    pub(crate) fn started(&self) -> Option<(Checked, usize)> {
        self.started
    }

    /// Its newest head of edits its device checked, each one, as it took them back or as it put it (`Lab::warming`).
    pub(crate) fn checked(&self) -> Option<Checked> {
        *self.checked.lock().expect("checked")
    }

    /// Takes on device `me` of `lab` as it started, from the edits `stored` its shelf held, in their order: if the log
    /// goes on from them, the shelf holds its first edits, and the device checked the edits of the head it started from;
    /// else, as some failed their checks, the next save puts a head of the whole log.
    pub(crate) fn settle(&self, lab: &Lab, me: SignerId, stored: &[EditId]) {
        let mut kept = self.kept.lock().expect("kept");
        match lab.log(me).ids().starts_with(stored) {
            true => {
                kept.written = stored.len();
                kept.lineage = Some(lab.log(me).lineage());
                *self.checked.lock().expect("checked") = self.started.map(|(named, _)| named);
            }
            false => kept.whole = true,
        }
    }

    /// How many of the edits of device `me` of `lab` the shelf holds, the first of its log: none while it is due a
    /// head of the whole log, including a restore or withdrawal that replaced its saved prefix.
    pub(crate) fn held(&self, lab: &Lab, me: SignerId) -> usize {
        let kept = self.kept.lock().expect("kept");
        if kept.continues(lab.log(me)) { kept.written.min(lab.size(me).0) } else { 0 }
    }

    /// The shelf lacks an edit or a McEliece key device `me` of `lab` holds, or the head of its whole log it is due.
    pub(crate) fn lacks(&self, lab: &Lab, me: SignerId) -> bool {
        let kept = self.kept.lock().expect("kept");
        !kept.continues(lab.log(me))
            || kept.written < lab.size(me).0
            || kept.anchor_stamp != lab.bootstrap_stamp(me)
            || lab.blob_ids(me).iter().any(|b| !kept.keys.contains(b))
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
        let anchor_stamp = lab.bootstrap_stamp(me);
        let fresh = ids.len() > kept.written || !keys.is_empty() || kept.anchor_stamp != anchor_stamp;
        let packing = journaled + u64::from(fresh) >= JOURNALED;
        let whole = !kept.continues(lab.log(me)) || ids.len() < kept.written || (packing && packs >= PACKS);
        if !whole && !fresh && !packing {
            return Ok(None);
        }
        let mut records = Vec::new();
        for id in &ids[if whole { 0 } else { kept.written }..] {
            record(&mut records, lab.signed_edit(me, *id).context("an edit the device holds")?);
        }
        let anchors = lab.bootstrap_bytes(me).context("bootstrap anchor cannot be encoded within durable bounds; previous durable state retained")?;
        ensure!(anchors.len() <= MAX_ANCHORS, "bootstrap anchor save exceeds its bound");
        Ok(Some(Due { anchors, anchor_stamp, to: ids.len(), lineage: lab.log(me).lineage(), records, keys, whole }))
    }

    /// Puts `due` on the shelf: each new McEliece key as a blob, then the new edits and keys in the next journal
    /// entry, and a pack and a head if one is due; or a pack of the whole log and a head that names it alone.
    #[cfg(test)]
    async fn put(&self, book: &mut Book, due: Due) -> Result<()> {
        self.put_on(&self.shelf, book, due).await
    }

    async fn put_on(&self, on: &Shelf, book: &mut Book, due: Due) -> Result<()> {
        let mut brought = Vec::new();
        for (id, bytes) in &due.keys {
            let size = match book.keys.get(id) {
                Some(size) => *size,
                None => {
                    let (hash, size) = on.put_blob(&Bytes::copy_from_slice(bytes)).await?;
                    ensure!(hash == key_blob(*id), "the McEliece key {} is another's", id.to_hex());
                    size
                }
            };
            brought.push((*id, size));
        }
        let ids: Vec<BlobId> = due.keys.iter().map(|(id, _)| *id).collect();
        if due.whole {
            let pack = self.pack_on(on, &due.records).await?;
            book.keys.extend(brought);
            let head = Head { anchors: due.anchors.clone(), journal: book.next, packs: vec![pack], keys: book.keys.clone().into_iter().collect() };
            self.put_head_on(on, book, &head).await?;
            (book.packs, book.mark) = (vec![pack], book.next);
            book.pending.clear();
            book.anchors = due.anchors.clone();
            let mut kept = self.kept.lock().expect("kept");
            (kept.written, kept.whole) = (due.to, false);
            kept.lineage = Some(due.lineage);
            kept.anchor_stamp = due.anchor_stamp;
            kept.keys.extend(ids);
            return Ok(());
        }
        let (mut records, mut keys) = (&due.records[..], brought);
        while !records.is_empty() || !keys.is_empty() || book.anchors != due.anchors {
            let name = journal_name(book.next);
            let entry = Entry { anchors: due.anchors.clone(), keys: keys.clone(), records: records.to_vec() };
            match on.put(&name, entry.to_bytes()).await {
                Ok(()) => {
                    book.next += 1;
                    book.anchors = due.anchors.clone();
                    book.pending.extend(records);
                    book.keys.extend(keys);
                    break;
                }
                // put by a save cut short: what of this one it holds is put
                Err(e) if e.kind() == ErrorKind::AlreadyExists => {
                    book.next += 1;
                    let there = on.get(&name).await?.and_then(|bytes| Entry::from_bytes(&bytes));
                    let ours = |there: &Entry| {
                        records.starts_with(&there.records) && there.keys.iter().all(|k| keys.contains(k))
                    };
                    match there {
                        Some(there) if ours(&there) => {
                            records = &records[there.records.len()..];
                            keys.retain(|k| !there.keys.contains(k));
                            book.anchors = there.anchors;
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
            kept.anchor_stamp = due.anchor_stamp;
            kept.lineage = Some(due.lineage);
            kept.keys.extend(ids);
        }
        if book.next - book.mark >= JOURNALED {
            let pack = self.pack_on(on, &book.pending).await?;
            let mut packs = book.packs.clone();
            packs.push(pack);
            let keys = book.keys.clone().into_iter().collect();
            self.put_head_on(on, book, &Head { anchors: book.anchors.clone(), journal: book.next, packs: packs.clone(), keys }).await?;
            (book.packs, book.mark) = (packs, book.next);
            book.pending.clear();
        }
        Ok(())
    }

    /// A pack of `records`, on the shelf.
    async fn pack_on(&self, on: &Shelf, records: &[u8]) -> Result<Blob> {
        Ok(on.put_blob(&Bytes::from([PACK, records].concat())).await?)
    }

    /// Puts `head` on the shelf, as the next head after every head there: of edits its device holds, each checked.
    async fn put_head_on(&self, on: &Shelf, book: &mut Book, head: &Head) -> Result<()> {
        let bytes = head.to_bytes();
        loop {
            let name = head_name(book.head);
            match on.put(&name, bytes.clone()).await {
                Ok(()) => {
                    *self.checked.lock().expect("checked") = Some(checked(book.head, &bytes));
                    book.head += 1;
                    return Ok(());
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => book.head += 1,
                Err(e) => return Err(e.into()),
            }
        }
    }
}

/// A pack of the edits `signed`, as a shelf keeps them: what a head names, and what a vault's snapshot is made of
/// (`backup`), so that a snapshot's packs are a restored node's own.
pub(crate) fn pack_of<'a>(signed: impl IntoIterator<Item = &'a Signed>) -> Bytes {
    let mut out = PACK.to_vec();
    signed.into_iter().for_each(|s| record(&mut out, s));
    out.into()
}

/// The edits of `pack`, a pack (`pack_of`), every one of which must decode whole.
pub(crate) fn unpack(pack: &[u8]) -> Option<Vec<Signed>> {
    edits_of(pack.strip_prefix(PACK)?)
}

/// Puts the first head on `shelf`, a new node's: of `packs` and the McEliece keys `keys`, each a blob the shelf holds.
/// A node started on it takes back their edits and keys (`Edits::open`), each checked again: a restored snapshot.
pub(crate) async fn put_first_head(shelf: &Shelf, packs: Vec<Blob>, keys: Vec<Key>) -> Result<()> {
    Ok(shelf.put(&head_name(1), Head { anchors: Vec::new(), journal: 0, packs, keys }.to_bytes()).await?)
}

/// Head `n` on `shelf`, named by `checked`, and the edits of its packs, every one of which must read whole.
async fn read_head(shelf: &Shelf, n: u64) -> Result<(Head, Checked, Vec<Signed>)> {
    let bytes = shelf.get(&head_name(n)).await?.ok_or_else(|| anyhow!("listed, and gone"))?;
    let named = checked(n, &bytes);
    let head = Head::from_bytes(&bytes).ok_or_else(|| anyhow!("cut short or changed"))?;
    let mut signed = Vec::new();
    for &(hash, size) in &head.packs {
        signed.extend(read_pack(shelf, hash, size).await.with_context(|| format!("its pack {hash}"))?);
    }
    Ok((head, named, signed))
}

/// Decodes a legacy pack without retaining its entire raw encoding beside its decoded edits. The bytes in flight
/// are one bounded shelf read plus the current record. Nothing escapes until the complete blob hash checks out;
/// a changed or truncated pack still rejects its whole head, so `Edits::open` can try the previous head.
async fn read_pack(shelf: &Shelf, hash: Hash, size: u64) -> Result<Vec<Signed>> {
    let mut reader = shelf.blob_reader(hash, size);
    ensure!(reader.take(PACK.len()).await?.as_ref() == PACK, "no pack of edits");
    let mut signed = Vec::new();
    while reader.remaining() > 0 {
        let length = reader.take(4).await?;
        let length = u32::from_be_bytes(length.as_ref().try_into().expect("four bytes")) as usize;
        let record = reader.take(length).await?;
        signed.push(Signed::from_wire(&record).context("an edit does not decode whole")?);
    }
    reader.finish()?;
    Ok(signed)
}

impl Shared {
    /// The encoder receives only owned inputs after the Lab guard is dropped.
    /// The save lane/book guard and admitted producer remain owned by the caller.
    fn prepare_warm_with(&self, encode: impl FnOnce(avendb::lab::WarmCapture) -> avendb::lab::Warming)
        -> Option<avendb::lab::Warming> {
        self.prepare_warm_at(false, encode)
    }

    fn prepare_warm_at(&self, current: bool, encode: impl FnOnce(avendb::lab::WarmCapture) -> avendb::lab::Warming)
        -> Option<avendb::lab::Warming> {
        let capture = {
            let (mut lab, edits) = (self.locked_lab(), self.edits.as_ref().expect("its edits"));
            let held = edits.held(&lab, self.me);
            if current { lab.capture_warm_current(self.me, held, edits.checked()) }
            else { lab.capture_warm(self.me, held, edits.checked()) }
        };
        capture.map(encode)
    }

    /// Puts on the node's shelf, if it keeps one, what its device took since the last save, as `Edits::put` says. True
    /// if the shelf holds more now.
    pub(crate) async fn save(self: &Arc<Self>) -> Result<bool> {
        let operation = self.admit()?;
        let shared = self.clone();
        // The saver may be cancelled while its blocking capture or backend write
        // continues. Keep its whole save lane admitted until actual completion.
        n0_future::task::spawn(async move {
            let _operation = operation;
            shared.save_on(None).await
        })
        .await
        .context("the save task")?
    }

    pub(crate) async fn save_on(self: &Arc<Self>, override_shelf: Option<&Shelf>) -> Result<bool> {
        let Some(edits) = &self.edits else {
            return Ok(false);
        };
        let on = override_shelf.unwrap_or(&edits.shelf);
        let mut book = edits.book.lock().await;
        let plan = (book.next - book.mark, book.packs.len());
        let shared = self.clone();
        let due = move || shared.edits.as_ref().expect("its edits").due(&shared.locked_lab(), shared.me, plan);
        #[cfg(not(target_arch = "wasm32"))]
        let due = tokio::task::spawn_blocking(due).await??;
        #[cfg(target_arch = "wasm32")]
        let due = due()?;
        // the edits first, so that what it worked out from them is of edits its shelf holds
        let mut put = due.is_some();
        if let Some(due) = due {
            edits.put_on(on, &mut book, due).await?;
        }
        // Unlock only bases whose signed frontier and anchor stamp this same save lane
        // has acknowledged. Concurrent changes keep them read-only until the next save.
        let ready = {
            let mut lab=self.locked_lab();
            !edits.lacks(&lab,self.me) && edits.held(&lab,self.me)==lab.size(self.me).0
                && lab.finish_durable_owner_bases(self.me)
        };
        if ready { self.size.send_modify(|_| {}); }
        // A signer root is publishable only after its ordered leaves and root
        // receipt persist; complete legacy records remain the export eligibility gate.
        if let Some(signers) = &self.signers {
            put |= signers.save_on(self, on).await?;
        }
        // The authoritative frontier is durable now. Optional restart summaries may
        // take much longer; peers must not wait for them before learning this edit.
        // Holdings still filter through Edits::held and the current authorized view.
        if put {
            self.changed.notify_one();
        }
        let shared = self.clone();
        // Only the once-only quiescent finalizer has an override shelf. The normal
        // save lane retains its bounded snapshot interval; authoritative data is already durable.
        let current = override_shelf.is_some();
        let warming = move || if current {
            shared.prepare_warm_at(true, avendb::lab::WarmCapture::encode)
        } else {
            shared.prepare_warm_with(avendb::lab::WarmCapture::encode)
        };
        #[cfg(not(target_arch = "wasm32"))]
        let warming = tokio::task::spawn_blocking(warming).await?;
        #[cfg(target_arch = "wasm32")]
        let warming = warming();
        // what it worked out only spares it time: a shelf that can't take it costs it that time, no more, and the
        // device gives it again at the next save
        if let Some(mut warming) = warming {
            match edits.put_warm_on(on, &mut warming).await {
                Ok(()) => {
                    let shared = self.clone();
                    let warmed = move || {
                        let mut lab = shared.locked_lab();
                        lab.warmed(shared.me, warming);
                        // A restore or lock may have invalidated the receipt while the shelf was writing it.
                        // Publish this under the Lab lock, so a later mutation cannot lose its wakeup. A locked
                        // device cannot seal a snapshot; leave its edge clear so unlocking wakes the saver.
                        let pending = !lab.locked(shared.me) && lab.warm_due(shared.me);
                        shared.warm.store(pending, std::sync::atomic::Ordering::Relaxed);
                        if pending {
                            shared.edits.as_ref().expect("its edits").due.notify_one();
                        }
                    };
                    #[cfg(not(target_arch = "wasm32"))]
                    tokio::task::spawn_blocking(warmed).await?;
                    #[cfg(target_arch = "wasm32")]
                    warmed();
                }
                Err(e) => tracing::warn!("avendb: what the device worked out can't be put on its shelf: {e:#}"),
            }
        }
        // Derived summaries share the authoritative save lane but cannot prevent a clean shutdown.
        if let Err(error) = self.edit_transfer.summaries.flush(on).await {
            tracing::warn!(%error, "avendb: optional range summary remains pending");
        }
        Ok(put)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shelf::Call;
    use avendb::lab::Backup;
    use avendb::id::VaultId;
    use avendb::policy::{Action, Edit};
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Wire-valid records are enough here: signature and rule validation still belongs to Lab restoration.
    fn signed(n: usize) -> Signed {
        Signed {
            edit: Edit {
                parents: vec![],
                depth: n as u64,
                author: SignerId([1; 32]),
                cosigners: vec![],
                action: Action::Checkpoint { vault: VaultId([2; 32]), covers: vec![EditId([3; 32]); n] },
            },
            sigs: vec![],
        }
    }

    #[test]
    fn bootstrap_journal_codec_rejects_torn_anchors_and_keeps_legacy_compatible() {
        let legacy = Entry { keys: vec![], anchors: vec![], records: vec![] }.to_bytes();
        assert!(legacy.starts_with(ENTRY));
        assert!(Entry::from_bytes(&legacy).unwrap().anchors.is_empty());
        let entry = Entry { keys: vec![], anchors: vec![7; 64], records: vec![1,2,3] };
        let bytes = entry.to_bytes();
        assert_eq!(Entry::from_bytes(&bytes).unwrap().anchors, entry.anchors);
        for n in [0, ENTRY_ANCHORS.len(), bytes.len()-1] {
            assert!(Entry::from_bytes(&bytes[..n]).is_none());
        }
        let mut oversized = ENTRY_ANCHORS.to_vec();
        put_keys(&mut oversized, &[]);
        oversized.extend(((MAX_ANCHORS+1) as u32).to_be_bytes());
        assert!(Entry::from_bytes(&summed(oversized)).is_none());
        let head = Head { journal: 4, packs: vec![], keys: vec![], anchors: entry.anchors };
        assert_eq!(Head::from_bytes(&head.to_bytes()).unwrap().anchors, head.anchors);
    }

    #[tokio::test]
    async fn bootstrap_journal_reopens_atomic_anchor_and_suffix_and_retries() {
        let folder = std::env::temp_dir().join(format!("avendb-anchor-{}", crate::shelf::fresh()));
        let writer = crate::disk::open(&folder).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (edits, _) = Edits::open(shelf.clone()).await.unwrap();
        let lab = Lab::new();
        // The opaque bytes test transport durability, not authority. Core tests reject invalid anchors.
        let mut log_lab = lab;
        let me = log_lab.device("journal");
        let mut records = Vec::new();
        record(&mut records, &signed(0));
        let anchors = vec![9; 96];
        // Simulate a completed object write whose acknowledgement was lost.
        shelf.put(&journal_name(0), Entry { keys: vec![], records: records.clone(), anchors: anchors.clone() }.to_bytes()).await.unwrap();
        let mut book = edits.book.lock().await;
        let due = Due { to: 1, lineage: log_lab.log(me).lineage(), records, keys: vec![], whole: false, anchors: anchors.clone(), anchor_stamp: vec![] };
        edits.put(&mut book, due).await.unwrap();
        drop(book);
        let (_, (saved, _, retained)) = Edits::open(shelf.clone()).await.unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(retained, anchors);
        // A torn next record cannot replace the previous complete anchor/frontier pair.
        let mut next = Entry { keys: vec![], records: vec![], anchors: vec![8; 96] }.to_bytes().to_vec();
        next.pop();
        shelf.put(&journal_name(1), Bytes::from(next)).await.unwrap();
        let (_, (saved, _, retained)) = Edits::open(shelf.clone()).await.unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(retained, anchors);
        // Whole-log compaction names the same anchor in the committed head.
        let mut book = edits.book.lock().await;
        let mut records = Vec::new();
        record(&mut records, &signed(0));
        edits.put(&mut book, Due { to: 1, lineage: log_lab.log(me).lineage(), records, keys: vec![], whole: true, anchors: anchors.clone(), anchor_stamp: vec![] }).await.unwrap();
        drop(book);
        let (_, (saved, _, retained)) = Edits::open(shelf.clone()).await.unwrap();
        assert_eq!(saved.len(), 1);
        assert_eq!(retained, anchors);
        drop(writer);
        std::fs::remove_dir_all(folder).unwrap();
    }

    /// A shelf that deliberately fragments reads, including a record's four-byte length. The greatest request
    /// size makes the bounded I/O contract observable without relying on allocator or process-memory timings.
    fn fragmented(bytes: Bytes, fragment: usize) -> (Shelf, Arc<AtomicUsize>) {
        let (shelf, mut calls) = Shelf::new();
        let largest = Arc::new(AtomicUsize::new(0));
        let seen = largest.clone();
        tokio::spawn(async move {
            while let Some(call) = calls.recv().await {
                match call {
                    Call::Read { at, len, tx, .. } => {
                        seen.fetch_max(len, Ordering::Relaxed);
                        let at = usize::try_from(at).unwrap_or(usize::MAX).min(bytes.len());
                        let end = at.saturating_add(len.min(fragment)).min(bytes.len());
                        tx.send(Ok(bytes.slice(at..end))).ok();
                    }
                    _ => panic!("only blob reads are expected"),
                }
            }
        });
        (shelf, largest)
    }

    #[tokio::test]
    async fn streamed_packs_match_whole_decoding_across_fragment_and_record_boundaries() {
        let small = vec![signed(0), signed(1), signed(9)];
        let large = vec![signed(1), signed((1 << 20) / 32), signed(3)];
        for (records, fragments) in [(&small, &[1, 3, 7, 256][..]), (&large, &[65_539, 1 << 20][..])] {
            let pack = pack_of(records);
            let expected = unpack(&pack).expect("the old whole-pack decoder");
            for &fragment in fragments {
                let (shelf, largest) = fragmented(pack.clone(), fragment);
                let actual = read_pack(&shelf, Hash::new(&pack), pack.len() as u64).await.expect("a checked pack");
                assert_eq!(actual, expected, "fragment {fragment}");
                assert!(largest.load(Ordering::Relaxed) <= 1 << 20, "no whole-pack read");
            }
        }
    }

    #[tokio::test]
    async fn streamed_packs_reject_hash_changes_and_short_records() {
        let pack = pack_of(&[signed(0), signed(3)]);
        let hash = Hash::new(&pack);
        let (shelf, _) = fragmented(pack.clone(), 7);
        assert!(read_pack(&shelf, Hash::new(b"another pack"), pack.len() as u64).await.is_err());
        for length in [0, PACK.len() - 1, PACK.len() + 2, pack.len() - 1] {
            let shortened = pack.slice(..length);
            for declared in [length as u64, pack.len() as u64] {
                let (shelf, _) = fragmented(shortened.clone(), 3);
                assert!(read_pack(&shelf, hash, declared).await.is_err(), "{length} bytes, {declared} declared");
            }
        }
    }

    #[tokio::test]
    async fn untrusted_record_lengths_do_not_allocate_the_declared_record() {
        let bytes: Bytes = [PACK, &u32::MAX.to_be_bytes(), &[9; 8]].concat().into();
        // A record longer than the declared blob fails before it is allocated. With a dishonest blob size,
        // it grows only through the eight actual payload bytes and fails at EOF, without allocating 4 GiB.
        for declared in [bytes.len() as u64, u64::from(u32::MAX) + PACK.len() as u64 + 4] {
            let (shelf, largest) = fragmented(bytes.clone(), 5);
            assert!(read_pack(&shelf, Hash::new(&bytes), declared).await.is_err());
            assert!(largest.load(Ordering::Relaxed) <= 1 << 20);
        }
        let (shelf, largest) = fragmented(bytes.clone(), 5);
        let mut reader = shelf.blob_reader(Hash::new(&bytes), bytes.len() as u64);
        assert!(reader.take(usize::MAX).await.is_err());
        assert_eq!(largest.load(Ordering::Relaxed), 0, "invalid length does not even read");
        assert!(reader.finish().is_err(), "an unread blob cannot be accepted");
    }

    #[tokio::test]
    async fn a_bad_streamed_pack_falls_back_to_the_previous_head() {
        let expected = vec![signed(0), signed(2)];
        let valid = pack_of(&expected);
        let changed = pack_of(&[signed(8)]);
        let valid_hash = Hash::new(&valid);
        let wrong_hash = Hash::new(b"a different content hash");
        let heads = [
            Head { anchors: Vec::new(), journal: 0, packs: vec![(valid_hash, valid.len() as u64)], keys: vec![] }.to_bytes(),
            Head { anchors: Vec::new(), journal: 0, packs: vec![(wrong_hash, changed.len() as u64)], keys: vec![] }.to_bytes(),
        ];
        let expected_start = checked(1, &heads[0]);
        let (shelf, mut calls) = Shelf::new();
        tokio::spawn(async move {
            while let Some(call) = calls.recv().await {
                match call {
                    Call::Names { prefix, tx } => {
                        assert_eq!(prefix, HEADS);
                        tx.send(Ok(vec![head_name(1), head_name(2)])).ok();
                    }
                    Call::Get { name, tx } => {
                        let bytes = match name.as_str() {
                            "heads/0000000000000001" => Some(heads[0].clone()),
                            "heads/0000000000000002" => Some(heads[1].clone()),
                            "journal/0000000000000000" => None,
                            _ => panic!("unexpected object {name}"),
                        };
                        tx.send(Ok(bytes)).ok();
                    }
                    Call::Read { name, at, len, tx } => {
                        let bytes = if name == valid_hash.to_hex().as_str() { &valid } else { &changed };
                        let at = (at as usize).min(bytes.len());
                        let end = (at + len.min(7)).min(bytes.len());
                        tx.send(Ok(bytes.slice(at..end))).ok();
                    }
                    _ => panic!("only named objects and blob reads are expected"),
                }
            }
        });
        let (edits, (actual, keys, _)) = Edits::open(shelf).await.expect("the earlier head reads whole");
        assert_eq!(actual, expected);
        assert!(keys.is_empty());
        assert_eq!(edits.started(), Some((expected_start, expected.len())));
    }
    #[test]
    fn withdrawal_then_append_cannot_reuse_a_saved_prefix_of_the_same_length() {
        let first = signed(0).edit;
        let second = signed(1).edit;
        let mut log = Log::from_edits(vec![first.clone(), second]);
        let kept = Kept { anchor_stamp: Vec::new(), written: 2, lineage: Some(log.lineage()), keys: HashSet::new(), whole: false };
        assert!(kept.continues(&log));
        log.let_go(&[first.id()].into());
        log.receive([signed(2).edit]);
        assert_eq!(log.ids().len(), kept.written);
        assert!(!kept.continues(&log), "equal counts do not make a replacement prefix durable");
        let kept = Kept { lineage: Some(log.lineage()), ..kept };
        log.receive([signed(3).edit]);
        assert!(kept.continues(&log), "ordinary appends preserve the saved prefix");
    }

    /// A barrier before the next head is persisted, after its pack is complete. It makes the save/restore race
    /// deterministic; all storage remains in the test's disposable folder.
    fn delaying_head(shelf: Shelf) -> (Shelf, tokio::sync::oneshot::Receiver<()>, tokio::sync::oneshot::Sender<()>) {
        let (proxy, mut calls) = Shelf::new();
        let (entered, waiting) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let mut pause = Some((entered, released));
            while let Some(call) = calls.recv().await {
                match call {
                    Call::Put { name, bytes, tx } => {
                        if name.starts_with(HEADS)
                            && let Some((entered, released)) = pause.take()
                        {
                            entered.send(()).ok();
                            released.await.expect("the test releases the head");
                        }
                        tx.send(shelf.put(&name, bytes).await).ok();
                    }
                    Call::Write { name, at, bytes, tx } => {
                        tx.send(shelf.write(&name, at, bytes).await).ok();
                    }
                    Call::Finish { name, hash, size, outboard, tx } => {
                        tx.send(shelf.finish(&name, hash, size, outboard).await).ok();
                    }
                    Call::Drop { name, tx } => {
                        tx.send(shelf.drop(&name).await).ok();
                    }
                    Call::Get { name, tx } => {
                        tx.send(shelf.get(&name).await).ok();
                    }
                    Call::Read { name, at, len, tx } => {
                        tx.send(shelf.read(&name, at, len).await).ok();
                    }
                    Call::Names { prefix, tx } => {
                        tx.send(shelf.names(&prefix).await).ok();
                    }
                    _ => panic!("unexpected call while saving a head"),
                }
            }
        });
        (proxy, waiting, release)
    }

    #[tokio::test]
    async fn a_delayed_save_acknowledges_only_its_lineage_and_recovery_keeps_every_old_head() {
        use avendb::cast::{handbook, text, world};
        use avendb::lab::Backup;

        struct Folder(std::path::PathBuf);
        impl Drop for Folder {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).ok();
            }
        }
        let folder = Folder(std::env::temp_dir().join(format!("avendb-lineage-{}", crate::shelf::fresh())));
        let mut w = world();
        let h = handbook(&mut w);
        let me = w.mac_a;
        let base = w.lab.backup(me);
        let mut branches = Vec::new();
        for body in ["first branch", "other branch", "third branch"] {
            w.lab.restore_backup(me, &base);
            w.lab.edit(me, h.coop, h.welcome, |i| i.set_text(2, body)).expect("a branch write");
            branches.push(w.lab.backup(me));
        }
        w.lab.restore_backup(me, &branches[0]);
        let first_ids = w.lab.log(me).ids().to_vec();
        let writer = crate::disk::open(&folder.0).expect("the test shelf").writer().unwrap();
        let shelf = writer.shelf();
        let (mut edits, stored) = Edits::open(shelf.clone()).await.expect("the empty shelf");
        assert!(stored.0.is_empty());
        edits.settle(&w.lab, me, &[]);
        // Start with a complete head, as a node that already passed its first journal compaction does.
        edits.kept.lock().expect("kept").whole = true;
        {
            let mut book = edits.book.lock().await;
            let due = edits.due(&w.lab, me, (0, 0)).unwrap().unwrap();
            edits.put(&mut book, due).await.expect("the first head");
        }
        assert_eq!(edits.held(&w.lab, me), first_ids.len());
        let old_head = shelf.get(&head_name(1)).await.unwrap().unwrap();
        let (proxy, entered, release) = delaying_head(shelf.clone());
        edits.shelf = proxy;

        w.lab.restore_backup(me, &branches[1]);
        assert_eq!(w.lab.log(me).ids().len(), first_ids.len(), "restore preserves the count");
        assert_ne!(w.lab.log(me).ids(), first_ids);
        assert_eq!(edits.held(&w.lab, me), 0, "replacement edits are not advertised as durable");
        assert!(edits.lacks(&w.lab, me));
        {
            let mut book = edits.book.lock().await;
            let due = edits.due(&w.lab, me, (book.next - book.mark, book.packs.len())).unwrap().unwrap();
            assert!(due.whole, "replacement prefixes require a new full head");
            let writing = edits.put(&mut book, due);
            tokio::pin!(writing);
            tokio::select! {
                saved = &mut writing => panic!("save crossed its barrier early: {saved:?}"),
                reached = entered => reached.expect("the save is waiting to persist its head"),
            }
            // Another restore happens after the second branch's pack was written but before its head is durable.
            w.lab.restore_backup(me, &branches[2]);
            assert_eq!(w.lab.log(me).ids().len(), first_ids.len());
            assert_eq!(edits.held(&w.lab, me), 0);
            release.send(()).expect("release persistence");
            writing.await.expect("the second head is durable");
        }
        assert_eq!(edits.held(&w.lab, me), 0, "an old save cannot acknowledge the current lineage");
        assert!(edits.lacks(&w.lab, me), "the saver must run again");
        let second_head = shelf.get(&head_name(2)).await.unwrap().unwrap();
        {
            let mut book = edits.book.lock().await;
            let due = edits.due(&w.lab, me, (book.next - book.mark, book.packs.len())).unwrap().unwrap();
            assert!(due.whole);
            edits.put(&mut book, due).await.expect("the current lineage is durable");
        }
        let expected = w.lab.log(me).ids().to_vec();
        assert_eq!(edits.held(&w.lab, me), expected.len());
        assert!(!edits.lacks(&w.lab, me));
        assert_eq!(shelf.names(HEADS).await.unwrap(), vec![head_name(1), head_name(2), head_name(3)]);
        assert_eq!(shelf.get(&head_name(1)).await.unwrap().unwrap(), old_head);
        assert_eq!(shelf.get(&head_name(2)).await.unwrap().unwrap(), second_head);
        drop(edits);
        let (reopened, (signed, keys, _)) = Edits::open(shelf).await.expect("restart from the newest head");
        let restored: Vec<_> = signed.iter().map(|s| s.edit.id()).collect();
        assert_eq!(restored, expected, "restart selects the latest saved branch");
        w.lab.restore_from(me, Backup::new(signed, keys));
        reopened.settle(&w.lab, me, &restored);
        assert_eq!(reopened.held(&w.lab, me), expected.len());
        assert_eq!(text(&w.lab, me, h.welcome, 2).as_deref(), Some("third branch"));
    }

    /// Pause the first stored view after its keys reached disk. Every keep completion is observable without a
    /// Lab read that might itself wake the saver and hide a lost notification.
    fn delaying_view(
        shelf: Shelf,
    ) -> (
        Shelf,
        tokio::sync::oneshot::Receiver<()>,
        tokio::sync::oneshot::Sender<()>,
        tokio::sync::mpsc::UnboundedReceiver<()>,
    ) {
        delaying_view_when(shelf, Arc::new(std::sync::atomic::AtomicBool::new(true)))
    }

    fn delaying_view_when(
        shelf: Shelf,
        enabled: Arc<std::sync::atomic::AtomicBool>,
    ) -> (
        Shelf,
        tokio::sync::oneshot::Receiver<()>,
        tokio::sync::oneshot::Sender<()>,
        tokio::sync::mpsc::UnboundedReceiver<()>,
    ) {
        let (proxy, mut calls) = Shelf::new();
        let (entered, waiting) = tokio::sync::oneshot::channel();
        let (release, released) = tokio::sync::oneshot::channel();
        let (kept, views) = tokio::sync::mpsc::unbounded_channel();
        tokio::spawn(async move {
            let mut pause = Some((entered, released));
            while let Some(call) = calls.recv().await {
                match call {
                    Call::Keep { name, bytes, tx } => {
                        let view = VIEW.0.contains(&name.as_str());
                        if view && enabled.load(Ordering::Relaxed) && let Some((entered, released)) = pause.take() {
                            entered.send(()).ok();
                            released.await.expect("the test releases the view");
                        }
                        let saved = shelf.keep(&name, bytes).await;
                        if view && saved.is_ok() {
                            kept.send(()).ok();
                        }
                        tx.send(saved).ok();
                    }
                    Call::List(tx) => {
                        tx.send(shelf.list().await).ok();
                    }
                    Call::Outboard { hash, tx } => {
                        tx.send(shelf.outboard(hash).await).ok();
                    }
                    Call::Put { name, bytes, tx } => {
                        tx.send(shelf.put(&name, bytes).await).ok();
                    }
                    Call::Write { name, at, bytes, tx } => {
                        tx.send(shelf.write(&name, at, bytes).await).ok();
                    }
                    Call::Finish { name, hash, size, outboard, tx } => {
                        tx.send(shelf.finish(&name, hash, size, outboard).await).ok();
                    }
                    Call::Drop { name, tx } => {
                        tx.send(shelf.drop(&name).await).ok();
                    }
                    Call::Get { name, tx } => {
                        tx.send(shelf.get(&name).await).ok();
                    }
                    Call::Read { name, at, len, tx } => {
                        tx.send(shelf.read(&name, at, len).await).ok();
                    }
                    Call::Names { prefix, tx } => {
                        tx.send(shelf.names(&prefix).await).ok();
                    }
                }
            }
        });
        (proxy, waiting, release, views)
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn bootstrap_anchor_only_adoption_wakes_saver_and_persists() {
        use crate::{Node, Options};
        use avendb::cast::{document, human_on};
        use std::time::Duration;
        let folder = std::env::temp_dir().join(format!("avendb-anchor-wake-{}", crate::shelf::fresh()));
        let mut lab=Lab::new();
        let owner=lab.passkey("Owner");
        let mac=lab.device_of(owner,"Mac");
        let phone=lab.device_of(owner,"Phone");
        let vault=human_on(&mut lab,owner,&[mac,phone]);
        let entry=lab.create(mac,vault,vault,"note",&[],document("Base","old",mac)).unwrap();
        lab.sync(mac,phone);
        lab.edit(mac,vault,entry,|i|i.set_text(2,"new")).unwrap();
        let prepared=lab.draft_judged_entry_base(mac,&[owner],entry).unwrap();
        let snapshot=lab.complete(mac,prepared.draft,&[]).unwrap();
        let offer=lab.entry_projection_offer(mac,phone,entry).unwrap();
        lab.receive(phone,offer.evidence,vec![]);
        let shelf=crate::disk::open(&folder).unwrap();
        let node=Node::spawn(lab.split(phone,&[owner],[73;32]),phone,Options { shelf:Some(shelf.clone()), ..Options::local() }).await.unwrap();
        node.tasks.lock().unwrap().iter().for_each(|task|task.abort());
        node.shared.save().await.unwrap();
        let edits=node.shared.edits.as_ref().unwrap();
        while tokio::time::timeout(Duration::ZERO,edits.due.notified()).await.is_ok() {}
        let before=node.read(|lab,me|lab.log(me).revision()).await;
        assert!(node.act(move |lab,me|lab.adopt_owner_entry_base(me,snapshot,entry,prepared.sealed)).await);
        assert_eq!(before,node.read(|lab,me|lab.log(me).revision()).await,"adoption adds no signed edit");
        tokio::time::timeout(Duration::from_millis(100),edits.due.notified()).await.expect("anchor-only adoption wakes idle saver");
        node.shared.save().await.unwrap();
        let (_, (signed, keys, anchors))=Edits::open(shelf).await.unwrap();
        assert!(!anchors.is_empty());
        assert!(avendb::lab::Backup::new(signed,keys).with_bootstrap_bytes(&anchors).is_some());
        node.shutdown().await.unwrap();
        std::fs::remove_dir_all(folder).ok();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn durable_entry_wakes_announcements_before_optional_view_save_finishes() {
        use crate::{Node, Options};
        use avendb::cast::{document, human_on};
        use std::time::Duration;
        let folder = std::env::temp_dir().join(format!("avendb-durable-wake-{}", crate::shelf::fresh()));
        let mut lab = Lab::new();
        let passkey = lab.passkey("Alice");
        let me = lab.device_of(passkey, "local peer");
        let vault = human_on(&mut lab, passkey, &[me]);
        let writer = crate::disk::open(&folder).unwrap().writer().unwrap();
        let enabled = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (proxy, entered, release, _) = delaying_view_when(writer.shelf(), enabled.clone());
        let node = Node::spawn(lab.split(me, &[passkey], [71; 32]), me,
            Options { shelf: Some(proxy.clone()), ..Options::local() }).await.unwrap();
        // Isolate the save→announce boundary from periodic reconciliation and unrelated readers.
        node.tasks.lock().unwrap().iter().for_each(|task| task.abort());
        node.shared.save().await.unwrap();
        node.act(move |lab, me| {
            lab.create(me, vault, vault, "note", &[], document("A live entry", "generic mutation", me)).unwrap();
            let backup = lab.backup(me);
            lab.restore_from(me, backup);
        }).await;
        while tokio::time::timeout(Duration::ZERO, node.shared.changed.notified()).await.is_ok() {}
        enabled.store(true, Ordering::Relaxed);
        let shared = node.shared.clone();
        let saving = tokio::spawn(async move { shared.save_on(None).await });
        tokio::time::timeout(Duration::from_secs(15), entered).await.unwrap().unwrap();
        {
            let lab = node.shared.locked_lab();
            assert!(!node.shared.edits.as_ref().unwrap().lacks(&lab, me));
        }
        let woke = tokio::time::timeout(Duration::from_millis(100), node.shared.changed.notified()).await.is_ok();
        release.send(()).unwrap();
        saving.await.unwrap().unwrap();
        node.shutdown().await.unwrap();
        std::fs::remove_dir_all(folder).ok();
        assert!(woke, "durable entry announcement must not wait for optional snapshot I/O");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn clean_shutdown_publishes_recent_materialization_without_background_reencoding() {
        use crate::{Node, Options};
        use avendb::cast::{document, human_on};
        let folder = std::env::temp_dir().join(format!("avendb-close-view-{}", crate::shelf::fresh()));
        let mut lab = Lab::new();
        let passkey = lab.passkey("Shutdown materialization");
        let me = lab.device_of(passkey, "Mac");
        let vault = human_on(&mut lab, passkey, &[me]);
        let entry = lab.create(me, vault, vault, "note", &[], document("Recent", "before", me)).unwrap();
        lab.restore_from(me, lab.backup(me));
        // Node::spawn owns the writer lease; do not pre-claim a second writer.
        let shelf = crate::disk::open(&folder).unwrap();
        let opts = Options { shelf: Some(shelf.clone()), ..Options::local() };
        let node = Node::spawn(lab.split(me, &[passkey], [91;32]), me, opts).await.unwrap();
        node.shared.save().await.unwrap();
        let before = node.shared.edits.as_ref().unwrap().warm().await.views;
        assert!(!before.is_empty());
        node.act(move |lab, me| { lab.edit(me, vault, entry, |it| it.set_text(2,"recent durable edit")).unwrap(); }).await;
        node.shared.save().await.unwrap();
        assert_eq!(node.shared.edits.as_ref().unwrap().warm().await.views, before,
            "ordinary saver must retain its snapshot interval after a single write");
        let expected = node.read(move |lab,me| lab.item(me,entry).unwrap().record()).await;
        node.shutdown().await.unwrap();
        let (reopened, (signed, keys, anchors)) = Edits::open(shelf.clone()).await.unwrap();
        assert!(anchors.is_empty(), "ordinary warm reopen has no bootstrap companion");
        let count = signed.len();
        let warm = reopened.warm().await;
        assert_ne!(warm.views, before, "clean shutdown publishes the current derived frontier");
        // split moved the original device into Node; reopen with its same test identity.
        let mut lab = Lab::new();
        let restored_passkey = lab.passkey("Shutdown materialization");
        assert_eq!(lab.device_of(restored_passkey, "Mac"), me);
        lab.restore_warm(me, Backup::new(signed,keys), reopened.checked().map(|c|(c,count)), &warm);
        assert_eq!(lab.item(me,entry).unwrap().record(), expected);
        assert!(lab.work_metrics(me)["counts"]["replay: from its stored view"].as_u64().unwrap_or(0)>0,
            "write->shutdown->reopen must open from its stored view");
        assert!(lab.capture_warm_current(me,count,reopened.checked()).is_none(),
            "a second unchanged close does not export another snapshot");
        drop(reopened);
        drop(node);
        std::fs::remove_dir_all(folder).ok();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn an_invalidated_snapshot_save_retries_without_another_mutation_or_spinning_while_locked() {
        use crate::{Node, Options};
        use avendb::cast::{document, human_on};
        use std::time::Duration;

        struct Folder(std::path::PathBuf);
        impl Drop for Folder {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).ok();
            }
        }
        for unlock_before_receipt in [false, true] {
            let folder = Folder(std::env::temp_dir().join(format!("avendb-warming-{}", crate::shelf::fresh())));
            let mut lab = Lab::new();
            let passkey = lab.passkey("Alice");
            let me = lab.device_of(passkey, "Alice's Mac");
            let vault = human_on(&mut lab, passkey, &[me]);
            lab.create(me, vault, vault, "note", &[], document("Note", "Durable.", me)).unwrap();
            let backup = lab.backup(me);
            lab.restore_from(me, backup);
            let writer = crate::disk::open(&folder.0).unwrap().writer().unwrap();
            let shelf = writer.shelf();
            let (proxy, entered, release, mut views) = delaying_view(shelf);
            let opts = Options { shelf: Some(proxy), ..Options::local() };
            let node = Node::spawn(lab.split(me, &[passkey], [61; 32]), me, opts).await.unwrap();
            tokio::time::timeout(Duration::from_secs(15), entered).await.unwrap().unwrap();
            let edits = node.shared.edits.as_ref().unwrap();
            // No already-pending permit or rising dirty edge may rescue the stale acknowledgement by accident.
            while tokio::time::timeout(Duration::ZERO, edits.due.notified()).await.is_ok() {}
            node.shared.warm.store(true, Ordering::Relaxed);
            let revision = node.shared.locked_lab().log(me).revision();
            node.act(move |lab, me| {
                lab.lock(me);
                if unlock_before_receipt {
                    assert!(lab.unlock(me));
                }
            })
            .await;
            assert_eq!(node.shared.locked_lab().log(me).revision(), revision, "no edit wakeup");
            release.send(()).unwrap();
            tokio::time::timeout(Duration::from_secs(15), views.recv()).await.unwrap().unwrap();
            if !unlock_before_receipt {
                drop(edits.book.lock().await); // acknowledgement is complete
                assert!(!node.shared.warm.load(Ordering::Relaxed), "unlock needs a new dirty edge");
                assert!(node.read(|lab, me| lab.locked(me)).await);
                assert!(!node.shared.warm.load(Ordering::Relaxed), "a locked read must not consume the unlock edge");
                assert!(
                    tokio::time::timeout(Duration::from_millis(50), views.recv()).await.is_err(),
                    "a locked device cannot seal views and must not retry continuously"
                );
                node.act(|lab, me| assert!(lab.unlock(me))).await;
            }
            // No reads or mutations follow an unlocked rejected receipt: the saver itself must retry.
            tokio::time::timeout(Duration::from_secs(15), views.recv())
                .await
                .expect("pending snapshot work was rescheduled")
                .expect("a second view reached the shelf");
            drop(edits.book.lock().await);
            assert!(!node.shared.locked_lab().warm_due(me), "the new key prefix and view were acknowledged");
            assert!(!node.shared.warm.load(Ordering::Relaxed));
            node.shutdown().await.unwrap();
        }
    }
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn held_snapshot_encoder_releases_lab_and_cancelled_waiter_keeps_producer() {
        use crate::{Node, Options};
        use avendb::cast::{document, human_on};
        use std::time::Duration;
        let folder = std::env::temp_dir().join(format!("avendb-encode-{}", crate::shelf::fresh()));
        let mut lab = Lab::new();
        let passkey = lab.passkey("Alice");
        let me = lab.device_of(passkey, "Mac");
        let vault = human_on(&mut lab, passkey, &[me]);
        let entry = lab.create(me, vault, vault, "note", &[], document("Note", "Before", me)).unwrap();
        // Node::spawn acquires the single writer; do not pre-acquire another owner.
        let shelf = crate::disk::open(&folder).unwrap();
        let node = Node::spawn(lab.split(me, &[passkey], [71; 32]), me,
            Options { shelf: Some(shelf), ..Options::local() }).await.unwrap();
        node.shared.save().await.unwrap();
        let book = node.shared.edits.as_ref().unwrap().book.lock().await;
        node.act(|lab, me| { let backup = lab.backup(me); lab.restore_backup(me, &backup); }).await;
        let (entered_tx, entered_rx) = tokio::sync::oneshot::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        let shared = node.shared.clone();
        let operation = shared.admit().unwrap();
        let worker = tokio::task::spawn_blocking(move || {
            let _operation = operation;
            let captured = shared.prepare_warm_with(|capture| {
                entered_tx.send(()).unwrap();
                release_rx.recv().unwrap();
                capture.encode()
            });
            let _ = done_tx.send(captured.is_some());
        });
        tokio::time::timeout(Duration::from_secs(15), entered_rx).await.unwrap().unwrap();
        // Deadline detects lock ownership, not a physical performance budget.
        tokio::time::timeout(Duration::from_secs(2), node.act(move |lab, me| {
            lab.edit(me, vault, entry, |item| item.set_text(2, "During encoding")).unwrap();
        })).await.expect("snapshot encoder must not hold Lab");
        worker.abort(); // Once started, the blocking producer owns its admission until it really completes.
        drop(book);
        let mut closing = Box::pin(node.shutdown());
        assert!(tokio::time::timeout(Duration::from_millis(50), &mut closing).await.is_err(),
            "shutdown must wait for the cancelled waiter's actual encoder producer");
        release_tx.send(()).unwrap();
        assert!(tokio::time::timeout(Duration::from_secs(15), done_rx).await.unwrap().unwrap());
        tokio::time::timeout(Duration::from_secs(15), closing).await.unwrap().unwrap();
        std::fs::remove_dir_all(folder).ok();
    }

}
