//! A node's edits on its shelf (v8 phase S, `shelf`): what its device holds, kept the same way on every place, a
//! page's OPFS, the Mac's folder and the server's bucket, in objects each put once and never replaced or deleted, and
//! in blobs:
//!
//! - `journal/<n>`, numbered from 0 on in 16 hex digits: what one save added, the McEliece keys it brought, each by its
//!   id, the hash of the blob that holds it, and its size, and the new edits of the device's log;
//! - `heads/<n>`, numbered from 1 on: a head, put after every `JOURNALED` entries or `TAIL_EDITS` edits, which names
//!   the packs that hold the device's edits up to an entry of the journal, and every McEliece key: a node starts from
//!   its newest head and the journal after it, a few dozen objects and fewer than `TAIL_EDITS` edits, however long its
//!   device's log;
//! - a pack: a blob of `PACK` and then edits, as a journal entry holds them: those of the entries since the head before,
//!   and a save's own new edits where the pack is due with it, which then go in the pack alone, in no entry.
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
//! - the index `view` (`ShelfIndex`, `slots/index-view-0` and `-1`): the device's stored view, what its edits said when
//!   it last kept one, for a node to step on from there rather than replay every edit, kept after a replay of every
//!   edit, or 4096 edits stepped on, stamped with the head of the edits the view is of: its rows (`ViewRows`), each
//!   naming the blob that holds it, encrypted for the device alone, its replay to its replay rules (`Replay::to_view`)
//!   and what it read of them to its read rules, a row of bodies a run of the log's places, so a save puts the rows
//!   that changed and no more (`ViewOnShelf`). The slots it was kept in before, whole (`slots/view-0` and `-1`), are
//!   read where the index holds no view, and kept again as rows.
//!
//! The keys' slots are what they start with (`KEYS`), the number they were kept as, in 8
//! bytes, big-endian, then what they keep; the next goes in place of the older of the two (`Shelf::keep`), put after the edits it names, so the newest
//! that opens names edits the shelf holds. A slot is no history: every edit stays on the shelf as it was put, and one
//! that doesn't open costs the node a check of the signatures, the keys opened again or a replay of every edit, no
//! more.
//!
//! What older nodes put beside these, `sealed/<n>`, `warm/<n>` and `opened/<n>`, no node reads or puts any more; they
//! stay where they are, as everything put on a shelf does, till the person clears them.
//!
//! A node's holdings name of its device's edits only those its shelf holds (`Edits::held`): on the server, those its
//! bucket took.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::ErrorKind;
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result, anyhow, ensure};
use avendb::id::{BlobId, EditId, EntryId, SignerId};
use avendb::lab::{Checked, KeptPack, Lab, LogRows, Placed, PackFile, ViewChanges, ViewRows, Warm, Warming};
use avendb::log_head::Head as LogHead;
use avendb::policy::Log;
use avendb::sign::Signed;
use avendb::wire::Wire;
use bytes::Bytes;
use iroh_blobs::Hash;
use n0_future::time;
use tokio::sync::Notify;

use crate::shared_index::empty_head;
use crate::slot;
use crate::shelf::Shelf;
use crate::shelf_index::ShelfIndex;
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
/// How many edits of the journal a head comes after, however few entries hold them: a node checks the signature of
/// every edit after its newest head as it starts (`Lab::restore_warm`), so a catch-up's few saves of thousands of edits
/// each would have every start check them all (58 s of an iPhone's unlock, of 110k edits, on 2026-10-28). With
/// `test-fixtures`, a head after 64, so a test crosses one with a few hundred edits, not thousands.
const TAIL_EDITS: usize = if cfg!(feature = "test-fixtures") { 64 } else { PAGE_EDITS };
/// Once a head names this many packs, the next names one pack of the whole log.
const PACKS: usize = 64;
const HEADS: &str = "heads/";
const JOURNAL: &str = "journal/";
/// The rows of each pack, by its hash (`rows_name`): what an open takes the pack's edits back by, never reading the
/// pack (`Lab::log_rows`).
const ROWS: &str = "rows/";
/// The two slots a device's keys are kept in, in turn, and what each starts with.
const KEYS: ([&str; 2], &[u8]) = (["slots/keys-0", "slots/keys-1"], b"avenDB keys 1\n");
/// The slots a device's stored view was kept in before its rows, each stamped with the head of the edits it is of
/// (`slot`), read alone; and the index its rows are in now (`ViewOnShelf`).
const VIEW: &str = "view";
/// The indexes on the shelf that name, by each kept showing's or query view's row (`KeptPack::rows`), the pack it is
/// in, a blob by its hash and size (`Warming::shown`, `Warming::queries`), and how many bytes of their pages stay in
/// memory.
const SHOWN: &str = "shown";
const QUERIES: &str = "queries";
const PACKS_BUDGET: usize = 1 << 20;

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
    /// The number its next keys are kept as, `n` in slot `n % 2` of theirs (`warm`).
    slots: Mutex<u64>,
    /// Its kept showings and query views on its shelf (`PacksOnShelf`), and its stored view's rows (`ViewOnShelf`).
    shown: tokio::sync::Mutex<PacksOnShelf>,
    queries: tokio::sync::Mutex<PacksOnShelf>,
    view: tokio::sync::Mutex<ViewOnShelf>,
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
    /// How many edits the journal's entries from `mark` on hold.
    tail: usize,
    /// The number of the next head.
    head: u64,
    /// The journal's entries from `mark` on whose records the next pack holds, read back from the shelf as it is put
    /// (`pack_of_entries`), not held: a catch-up's saves since a head held every edit they saved twice (F9).
    pending: Vec<u64>,
    /// The rows of each of `pending`'s edits, sealed (`Lab::log_rows`), where it knows them: not of an entry it found
    /// on its shelf as it started, nor of one a save cut short put, so the pack of those has no rows, and is read.
    pending_rows: Vec<Option<Vec<u8>>>,
    anchors: Vec<u8>,
}

/// What the shelf holds of the node's device.
struct Kept {
    /// The first `written` edits of the device's log.
    written: usize,
    anchor_stamp: Vec<(EntryId, EditId)>,
    /// The head of the log's first `written` edits, those persisted. A withdrawal or a restore gives the log another
    /// head there, even where the number of edits stays the same; an in-flight save acknowledges only the head it
    /// wrote.
    head: Option<LogHead>,
    keys: HashSet<BlobId>,
    /// The next save puts a head of the whole log: the device didn't take back every edit the shelf held.
    whole: bool,
}

impl Kept {
    fn continues(&self, log: &Log) -> bool {
        !self.whole && self.head.is_some_and(|h| log.of_log(h))
    }
}

/// What a save puts on the shelf: the edits of the device's log from where the shelf's end, or all of them for a head
/// of the whole log, up to place `to`, and the McEliece keys the shelf lacks.
struct Due {
    to: usize,
    anchor_stamp: Vec<(EntryId, EditId)>,
    anchors: Vec<u8>,
    /// The head of the log's first `to` edits, as it took them.
    head: LogHead,
    records: Vec<u8>,
    /// The rows of the edits of `records`, sealed (`Lab::log_rows`): none while its device is locked.
    rows: Option<Vec<u8>>,
    keys: Vec<(BlobId, Arc<[u8]>)>,
    whole: bool,
}

/// What a node takes back from its shelf as it starts: its edits, in the order they were saved, and McEliece keys.
#[cfg(test)]
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

/// How many records `records` holds.
fn records_in(records: &[u8]) -> usize {
    let (mut n, mut r) = (0, Cursor(records));
    while let Some(len) = r.array().map(u32::from_be_bytes) {
        n += 1;
        if r.take(len as usize).is_none() {
            break;
        }
    }
    n
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

/// The name of the rows of the pack whose hash is `pack`.
fn rows_name(pack: Hash) -> String {
    format!("{ROWS}{}", pack.to_hex())
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
    #[cfg(test)]
    pub(crate) async fn open(shelf: Shelf) -> Result<(Edits, Stored)> {
        let mut all = Collect::default();
        let (edits, _, _, anchors) = Edits::open_into(shelf, &mut all).await?;
        // every McEliece key on the shelf, as a bench compares them
        let keys = edits.book.lock().await.keys.clone();
        let mut bytes = Vec::new();
        for (id, size) in keys {
            match edits.shelf.read_blob(key_blob(id), size).await {
                Ok(key) => bytes.push(Arc::from(&key[..])),
                Err(e) => tracing::warn!("avendb: McEliece key {} on the shelf doesn't read whole: {e}", id.to_hex()),
            }
        }
        Ok((edits, (all.signed, bytes, anchors)))
    }

    /// `open`, its edits given to `to` a page at a time as it reads them (`Taker`), never all of them at once: what it
    /// worked out before (`warm`), and the ids of the edits it gave, in their order, and the anchors its shelf names.
    pub(crate) async fn open_into(shelf: Shelf, to: &mut impl Taker) -> Result<(Edits, Warm, Vec<EditId>, Vec<u8>)> {
        let (warm, slots, packs) = read_warm(&shelf).await;
        let heads: Vec<u64> =
            numbered(&shelf, HEADS).await?.into_iter().filter(|(_, after)| after.is_empty()).map(|(n, _)| n).collect();
        let next_head = heads.last().map_or(1, |n| n + 1);
        let mut start = None;
        for &n in heads.iter().rev() {
            let mut taking = Taking::default();
            match take_head(&shelf, n, &warm, &mut taking, to).await {
                Ok((head, named)) => {
                    start = Some((head, named, taking));
                    break;
                }
                Err(e) => tracing::warn!("avendb: head {n} on the shelf doesn't read whole, so it is passed: {e:#}"),
            }
        }
        let (head, named, mut taking) = match start {
            Some((head, named, taking)) => (head, Some(named), taking),
            None => {
                to.begin(None, &warm).await?;
                (Head::default(), None, Taking::default())
            }
        };
        let started = named.map(|named| (named, taking.ids.len()));
        let mut anchors = head.anchors;
        let (mut pending, mut next, mut tail) = (Vec::new(), head.journal, 0);
        while let Some(bytes) = shelf.get(&journal_name(next)).await? {
            next += 1;
            let entry = Entry::from_bytes(&bytes).and_then(|e| Some((edits_of(&e.records)?, e)));
            drop(bytes);
            let Some((edits, entry)) = entry else {
                tracing::warn!("avendb: journal entry {} on the shelf doesn't read whole, and is skipped", next - 1);
                continue;
            };
            taking.keys.extend(entry.keys.iter().copied());
            tail += edits.len();
            let mut page = Vec::new();
            for s in edits {
                page.push((s, None));
                if page.len() >= PAGE_EDITS {
                    taking.give(&shelf, std::mem::take(&mut page), false, to).await?;
                }
            }
            taking.give(&shelf, page, false, to).await?;
            anchors = entry.anchors;
            pending.push(next - 1);
        }
        // the keys its edits name that came on the shelf after them
        let late: Vec<Key> = taking.missing.iter().filter_map(|b| Some((*b, *taking.keys.get(b)?))).collect();
        if !late.is_empty() {
            let keys = taking.read_keys(&shelf, late).await;
            to.keys(keys).await?;
        }
        let Taking { ids, keys, .. } = taking;
        let kept = Kept { anchor_stamp: Vec::new(), written: 0, head: None, keys: keys.keys().copied().collect(), whole: false };
        let pending_rows = vec![None; pending.len()];
        let book = Book { packs: head.packs, keys, mark: head.journal, next, tail, head: next_head, pending, pending_rows, anchors: anchors.clone() };
        let (book, kept) = (tokio::sync::Mutex::new(book), Mutex::new(kept));
        let (slots, checked) = (Mutex::new(slots), Mutex::new(None));
        let (shown, queries) = (tokio::sync::Mutex::new(packs.0), tokio::sync::Mutex::new(packs.1));
        let view = tokio::sync::Mutex::new(packs.2);
        let edits = Edits { shelf, book, kept, slots, shown, queries, view, started, checked, due: Notify::new() };
        Ok((edits, warm, ids, anchors))
    }

    /// What the device worked out before, as the shelf keeps it (`slots/`): its keys and its stored views, each the
    /// newest first. Nothing, where the shelf can't be read.
    #[cfg(test)]
    pub(crate) async fn warm(&self) -> Warm {
        let (warm, next, (shown, queries, view)) = read_warm(&self.shelf).await;
        *self.slots.lock().expect("slots") = next;
        *self.shown.lock().await = shown;
        *self.queries.lock().await = queries;
        *self.view.lock().await = view;
        warm
    }

    /// Keeps on the shelf what the device worked out (`Shared::save`), as `warming` gives it, each in place of the older
    /// of the two its slots keep: its keys, then its view's rows that changed.
    async fn put_warm_on(&self, on: &Shelf, warming: &mut Warming) -> Result<()> {
        if let Some(keys) = warming.keys.take() {
            let n = *self.slots.lock().expect("slots");
            self.keep_on(on, KEYS, n, &keys).await?;
            *self.slots.lock().expect("slots") = n + 1;
        }
        if let Some(view) = warming.view.take() {
            self.view.lock().await.put(on, view).await?;
        }
        if let Some(kept) = warming.shown.take() {
            self.shown.lock().await.put(on, kept).await?;
        }
        if let Some(kept) = warming.queries.take() {
            self.queries.lock().await.put(on, kept).await?;
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
    #[cfg(test)]
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
                kept.head = lab.log(me).head_at(stored.len() as u64);
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
    fn due(&self, lab: &Lab, me: SignerId, (journaled, tail, packs): (u64, usize, usize)) -> Result<Option<Due>> {
        let kept = self.kept.lock().expect("kept");
        let ids = lab.log(me).ids();
        let mut keys = Vec::new();
        for b in lab.blob_ids(me).into_iter().filter(|b| !kept.keys.contains(b)) {
            keys.push((b, lab.blob(me, b).context("a key the device holds")?));
        }
        let anchor_stamp = lab.bootstrap_stamp(me);
        let fresh = ids.len() > kept.written || !keys.is_empty() || kept.anchor_stamp != anchor_stamp;
        let packing = journaled + u64::from(fresh) >= JOURNALED || tail + ids.len().saturating_sub(kept.written) >= TAIL_EDITS;
        let whole = !kept.continues(lab.log(me)) || ids.len() < kept.written || (packing && packs >= PACKS);
        if !whole && !fresh && !packing {
            return Ok(None);
        }
        let mut records = Vec::new();
        let from = if whole { 0 } else { kept.written };
        let wire = lab.signed_wire(me, &ids[from..]).context("an edit the device holds")?;
        let rows = if wire.is_empty() { Some(Vec::new()) } else { lab.log_rows(me, from, &wire) };
        for bytes in wire {
            records.extend((bytes.len() as u32).to_be_bytes());
            records.extend(bytes);
        }
        let anchors = lab.bootstrap_bytes(me).context("bootstrap anchor cannot be encoded within durable bounds; previous durable state retained")?;
        ensure!(anchors.len() <= MAX_ANCHORS, "bootstrap anchor save exceeds its bound");
        Ok(Some(Due { anchors, anchor_stamp, to: ids.len(), head: lab.log(me).head(), records, rows, keys, whole }))
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
            self.put_rows_on(on, pack, due.rows.as_deref().map(|r| vec![r])).await?;
            book.keys.extend(brought);
            let head = Head { anchors: due.anchors.clone(), journal: book.next, packs: vec![pack], keys: book.keys.clone().into_iter().collect() };
            self.put_head_on(on, book, &head).await?;
            (book.packs, book.mark, book.tail) = (vec![pack], book.next, 0);
            book.pending.clear();
            book.anchors = due.anchors.clone();
            let mut kept = self.kept.lock().expect("kept");
            (kept.written, kept.whole) = (due.to, false);
            kept.head = Some(due.head);
            kept.anchor_stamp = due.anchor_stamp;
            kept.keys.extend(ids);
            return Ok(());
        }
        let (mut records, mut keys) = (&due.records[..], brought);
        // a pack due with this save takes the records of its own entry straight, after those of the journal's entries
        // since the newest head, read back: its entry is put all the same, so the journal holds every edit a head does
        // and a start whose head doesn't read whole takes them from the journal alone, but never read back at once (a
        // catch-up's page is a pack's worth of edits)
        let new = !records.is_empty() || !keys.is_empty() || book.anchors != due.anchors;
        let packing = book.next + u64::from(new) - book.mark >= JOURNALED || book.tail + records_in(records) >= TAIL_EDITS;
        let mut straight: (&[u8], Option<&[u8]>) = (&[], Some(&[]));
        // the rows of `records`, while they are all of them
        let mut rows = due.rows.as_deref();
        while !records.is_empty() || !keys.is_empty() || book.anchors != due.anchors {
            let name = journal_name(book.next);
            let entry = Entry { anchors: due.anchors.clone(), keys: keys.clone(), records: records.to_vec() };
            match on.put(&name, entry.to_bytes()).await {
                Ok(()) => {
                    let of = if records.is_empty() { Some(&[][..]) } else { rows.take() };
                    match packing {
                        true => straight = (records, of),
                        false => {
                            book.pending.push(book.next);
                            book.pending_rows.push(of.map(<[u8]>::to_vec));
                        }
                    }
                    book.next += 1;
                    book.tail += records_in(records);
                    book.anchors = due.anchors.clone();
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
                            book.tail += records_in(&there.records);
                            keys.retain(|k| !there.keys.contains(k));
                            book.anchors = there.anchors;
                            book.pending.push(book.next - 1);
                            book.pending_rows.push(None);
                            rows = None;
                            book.keys.extend(there.keys);
                        }
                        _ => tracing::warn!("avendb: {name} on the shelf is none of this node's saves, and is passed"),
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        // a save cut short put more entries than it knew of
        if packing || book.next - book.mark >= JOURNALED || book.tail >= TAIL_EDITS {
            self.pack_head_on(on, book, straight.0, straight.1).await?;
        }
        let mut kept = self.kept.lock().expect("kept");
        kept.written = due.to;
        kept.anchor_stamp = due.anchor_stamp;
        kept.head = Some(due.head);
        kept.keys.extend(ids);
        Ok(())
    }

    /// Puts a pack of the records of the journal's entries since the newest head and then `records`, and a head that
    /// names it after the packs before, of the journal from its next entry on.
    /// The pack's rows are those of the entries' edits, then `rows`, those of `records`, where it knows each.
    async fn pack_head_on(&self, on: &Shelf, book: &mut Book, records: &[u8], rows: Option<&[u8]>) -> Result<()> {
        let pack = self.pack_of_entries(on, &book.pending, records).await?;
        let of = book.pending_rows.iter().map(Option::as_deref).chain([rows]).collect::<Option<Vec<&[u8]>>>();
        self.put_rows_on(on, pack, of).await?;
        let mut packs = book.packs.clone();
        packs.push(pack);
        let keys = book.keys.clone().into_iter().collect();
        self.put_head_on(on, book, &Head { anchors: book.anchors.clone(), journal: book.next, packs: packs.clone(), keys }).await?;
        (book.packs, book.mark, book.tail) = (packs, book.next, 0);
        book.pending.clear();
        book.pending_rows.clear();
        Ok(())
    }

    /// Puts the rows of pack `pack`, each part of them sealed apart (`Lab::log_rows`), in the pack's order, where it
    /// knows them all: each behind its 4-byte length.
    async fn put_rows_on(&self, on: &Shelf, pack: Blob, rows: Option<Vec<&[u8]>>) -> Result<()> {
        let Some(rows) = rows else { return Ok(()) };
        let mut out = Vec::new();
        for part in rows.into_iter().filter(|p| !p.is_empty()) {
            out.extend((part.len() as u32).to_be_bytes());
            out.extend_from_slice(part);
        }
        match on.put(&rows_name(pack.0), Bytes::from(out)).await {
            // rows of the same pack, put before: the same edits
            Err(e) if e.kind() == ErrorKind::AlreadyExists => Ok(()),
            r => Ok(r?),
        }
    }

    /// A pack of `records`, on the shelf.
    async fn pack_on(&self, on: &Shelf, records: &[u8]) -> Result<Blob> {
        let mut pack = on.blob_writer();
        pack.push(Bytes::from_static(PACK)).await?;
        pack.push(Bytes::copy_from_slice(records)).await?;
        Ok(pack.finish().await?)
    }

    /// A pack of the records of journal entries `entries`, read back from the shelf an entry at a time, then `records`,
    /// on the shelf.
    async fn pack_of_entries(&self, on: &Shelf, entries: &[u64], records: &[u8]) -> Result<Blob> {
        let mut pack = on.blob_writer();
        pack.push(Bytes::from_static(PACK)).await?;
        for &n in entries {
            let bytes = on.get(&journal_name(n)).await?.ok_or_else(|| anyhow!("journal entry {n} is gone"))?;
            let entry = Entry::from_bytes(&bytes).ok_or_else(|| anyhow!("journal entry {n} doesn't read whole"))?;
            drop(bytes);
            pack.push(Bytes::from(entry.records)).await?;
        }
        if !records.is_empty() {
            pack.push(Bytes::copy_from_slice(records)).await?;
        }
        Ok(pack.finish().await?)
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

/// The edits of a page a node gives its Lab as it takes them back from its shelf (`Edits::open_into`): a few MB of
/// them, as each is a few KB.
const PAGE_EDITS: usize = 2048;

/// Where a node's edits go as it takes them back from its shelf (`Edits::open_into`), a page at a time: its Lab's
/// restore (`Lab::restore_page`), or a list of them (`Collect`).
pub(crate) trait Taker {
    /// It begins again, from the head its shelf names by `checked`, if any, with what the device worked out before:
    /// what it took before this, of a head that didn't read whole, it lets go of.
    async fn begin(&mut self, checked: Option<Checked>, warm: &Warm) -> Result<()>;
    /// The next page: its edits in the order the shelf holds them, the McEliece keys they name that the shelf holds,
    /// and whether they are of the head `begin` named.
    async fn page(&mut self, page: Vec<(Signed, Option<Placed>)>, keys: Vec<Arc<[u8]>>, of_head: bool) -> Result<()>;
    /// McEliece keys its edits named that came on the shelf after them.
    async fn keys(&mut self, keys: Vec<Arc<[u8]>>) -> Result<()>;
    /// What a part of a pack's rows `sealed` says, if it opens and it takes edits by rows now (`Lab::open_rows`).
    async fn rows(&mut self, sealed: &[u8]) -> Option<LogRows>;
    /// A pack of the head `begin` named, taken by its rows: each edit where `placed` says, with the McEliece keys they
    /// name that the shelf holds. False where it took none of them so (`Lab::restore_rows`), and the pack is read.
    async fn take_rows(&mut self, rows: LogRows, placed: Vec<Placed>, keys: Vec<Arc<[u8]>>) -> Result<bool>;
}

/// Every edit, in one list (`Edits::open`).
#[cfg(test)]
#[derive(Default)]
struct Collect {
    signed: Vec<Signed>,
}

#[cfg(test)]
impl Taker for Collect {
    async fn begin(&mut self, _: Option<Checked>, _: &Warm) -> Result<()> {
        self.signed.clear();
        Ok(())
    }
    async fn page(&mut self, page: Vec<(Signed, Option<Placed>)>, _: Vec<Arc<[u8]>>, _: bool) -> Result<()> {
        self.signed.extend(page.into_iter().map(|(s, _)| s));
        Ok(())
    }
    async fn keys(&mut self, _: Vec<Arc<[u8]>>) -> Result<()> {
        Ok(())
    }
    async fn rows(&mut self, _: &[u8]) -> Option<LogRows> {
        None
    }
    async fn take_rows(&mut self, _: LogRows, _: Vec<Placed>, _: Vec<Arc<[u8]>>) -> Result<bool> {
        Ok(false)
    }
}

/// What `Edits::open_into` gave so far: the ids of the edits, in their order, every McEliece key the shelf names and
/// its size, and those its edits named that the shelf named none of yet.
#[derive(Default)]
struct Taking {
    seen: HashSet<EditId>,
    ids: Vec<EditId>,
    keys: BTreeMap<BlobId, u64>,
    missing: HashSet<BlobId>,
}

impl Taking {
    /// Gives `to` the edits of `page` it didn't give yet, with the McEliece keys they name.
    async fn give(
        &mut self,
        shelf: &Shelf,
        mut page: Vec<(Signed, Option<Placed>)>,
        of_head: bool,
        to: &mut impl Taker,
    ) -> Result<()> {
        page.retain(|(s, _)| self.seen.insert(s.edit.id()));
        if page.is_empty() {
            return Ok(());
        }
        self.ids.extend(page.iter().map(|(s, _)| s.edit.id()));
        let want = self.wants(page.iter().flat_map(|(s, _)| s.edit.blobs()));
        let keys = self.read_keys(shelf, want).await;
        to.page(page, keys, of_head).await
    }

    /// Of the McEliece keys `blobs`, those the shelf holds, once each; it names the rest missing.
    fn wants(&mut self, blobs: impl IntoIterator<Item = BlobId>) -> Vec<Key> {
        let mut want = Vec::new();
        for b in blobs {
            match self.keys.get(&b) {
                Some(&size) => want.push((b, size)),
                None => {
                    self.missing.insert(b);
                }
            }
        }
        want.sort();
        want.dedup();
        want
    }

    /// Gives `to` the edits of pack `pack` of its head, a file of `shelf`'s, by the pack's rows, if the shelf holds
    /// them, they open, they tile the pack end to end and `to` takes edits so (`Taker::take_rows`): never reading the
    /// pack. False where it gave nothing, and the pack is read.
    async fn by_rows(&mut self, shelf: &Shelf, (hash, size): Blob, file: &Arc<dyn avendb::pages::Space>, to: &mut impl Taker) -> Result<bool> {
        let Some(bytes) = shelf.get(&rows_name(hash)).await? else { return Ok(false) };
        let mut rows = LogRows::default();
        let mut rest = &bytes[..];
        while !rest.is_empty() {
            let Some((n, more)) = rest.split_first_chunk::<4>() else { return Ok(false) };
            let Some((part, more)) = more.split_at_checked(u32::from_be_bytes(*n) as usize) else { return Ok(false) };
            match to.rows(part).await {
                Some(part) => rows.extend(part),
                None => return Ok(false),
            }
            rest = more;
        }
        let Some(places) = rows.places(PACK.len() as u64, size) else {
            tracing::warn!("avendb: the rows of its pack {hash} are of other records, so the pack is read");
            return Ok(false);
        };
        let ids: Vec<EditId> = rows.ids().collect();
        if ids.iter().any(|id| self.seen.contains(id)) {
            return Ok(false);
        }
        let want = self.wants(rows.blobs().collect::<Vec<_>>());
        let keys = self.read_keys(shelf, want).await;
        let placed = places.into_iter().map(|(at, len, sum)| Placed { file: file.clone(), at, len, sum }).collect();
        if !to.take_rows(rows, placed, keys).await? {
            return Ok(false);
        }
        self.seen.extend(ids.iter().copied());
        self.ids.extend(ids);
        Ok(true)
    }

    /// Keys `want`, read from `shelf`: one that doesn't read whole it names no more.
    async fn read_keys(&mut self, shelf: &Shelf, want: Vec<Key>) -> Vec<Arc<[u8]>> {
        let mut keys = Vec::new();
        for (id, size) in want {
            // checked against its hash, which is its id
            match shelf.read_blob(key_blob(id), size).await {
                Ok(key) => keys.push(Arc::from(&key[..])),
                Err(e) => {
                    tracing::warn!("avendb: McEliece key {} on the shelf doesn't read whole: {e}", id.to_hex());
                    self.keys.remove(&id);
                }
            }
        }
        keys
    }
}

/// Head `n` of `shelf`, its edits given to `to` a page at a time as they're read (`Taking::give`), and its name: an
/// error where it or a pack of it doesn't read whole, after which `to` begins again from another.
async fn take_head(shelf: &Shelf, n: u64, warm: &Warm, taking: &mut Taking, to: &mut impl Taker) -> Result<(Head, Checked)> {
    let bytes = shelf.get(&head_name(n)).await?.ok_or_else(|| anyhow!("listed, and gone"))?;
    let named = checked(n, &bytes);
    let head = Head::from_bytes(&bytes).ok_or_else(|| anyhow!("cut short or changed"))?;
    to.begin(Some(named), warm).await?;
    taking.keys.extend(head.keys.iter().copied());
    for &(hash, size) in &head.packs {
        // a pack that is a file of its shelf's: its edits are read from it in place from now on (`Placed`)
        let file = shelf.blob_file(hash).await;
        if let Some(file) = &file
            && taking.by_rows(shelf, (hash, size), file, to).await?
        {
            continue;
        }
        let mut reader = shelf.blob_reader(hash, size);
        ensure!(reader.take(PACK.len()).await?.as_ref() == PACK, "its pack {hash} is no pack of edits");
        let mut page = Vec::new();
        while reader.remaining() > 0 {
            let length = reader.take(4).await?;
            let length = u32::from_be_bytes(length.as_ref().try_into().expect("four bytes")) as usize;
            let at = reader.at();
            let record = reader.take(length).await?;
            let placed = file.as_ref().map(|file| {
                let sum = *bao_tree::blake3::hash(&record).as_bytes();
                Placed { file: file.clone(), at, len: length as u32, sum }
            });
            let signed = Signed::from_wire(&record).with_context(|| format!("an edit of its pack {hash} does not decode whole"))?;
            page.push((signed, placed));
            // given before the pack's hash is checked: one that isn't what its hash says ends the head, and `to`
            // begins again from another
            if page.len() >= PAGE_EDITS {
                taking.give(shelf, std::mem::take(&mut page), true, to).await?;
            }
        }
        reader.finish().with_context(|| format!("its pack {hash}"))?;
        taking.give(shelf, page, true, to).await?;
    }
    Ok((head, named))
}

/// What the device worked out before, as `shelf` keeps it (`Edits::warm`), the number its next keys are kept as, and
/// its packs and view's rows on its shelf.
async fn read_warm(shelf: &Shelf) -> (Warm, u64, (PacksOnShelf, PacksOnShelf, ViewOnShelf)) {
    let read = async {
        let (keys, next_keys) = slots_of(shelf, KEYS).await?;
        let (view, view_on) = read_view(shelf).await;
        // the view as it was kept before its rows, where its rows hold none
        let views = match view.is_empty() {
            true => slot::read(shelf, VIEW).await?.into_iter().map(|k| k.bytes).collect(),
            false => vec![],
        };
        let (shown, shown_on) = read_packs(shelf, SHOWN).await;
        let (queries, queries_on) = read_packs(shelf, QUERIES).await;
        anyhow::Ok((Warm { keys, view, views, shown, queries }, next_keys, (shown_on, queries_on, view_on)))
    };
    read.await.unwrap_or_else(|e| {
        tracing::warn!("avendb: what the device worked out before can't be read from its shelf: {e:#}");
        (Warm::default(), 0, (PacksOnShelf::none(shelf, SHOWN), PacksOnShelf::none(shelf, QUERIES), ViewOnShelf::none(shelf)))
    })
}

/// A device's stored view on its shelf (`Warming::view`): the index of its rows, each naming the blob that holds it, by
/// its hash and size, and the blob each row names, so that one a row no longer names goes.
pub(crate) struct ViewOnShelf {
    index: ShelfIndex,
    blobs: HashMap<[u8; 32], Blob>,
}

impl ViewOnShelf {
    /// None on `shelf`.
    fn none(shelf: &Shelf) -> ViewOnShelf {
        let index = ShelfIndex::empty(shelf.clone(), VIEW, PACKS_BUDGET, empty_head().head).expect("the name of an index");
        ViewOnShelf { index, blobs: HashMap::new() }
    }

    /// Puts each row `view` gives anew on the shelf through `on` as a blob, then the rows in the index, each naming its
    /// blob in place of the one it named before, and those it takes away gone, stamped with the head of the edits the
    /// view is of; and lets go of the blobs no row names then. A crash before the index's slot leaves the rows as they
    /// were, each naming a blob the shelf holds still.
    async fn put(&mut self, on: &Shelf, view: ViewChanges) -> Result<()> {
        let mut changes = Vec::with_capacity(view.rows.len());
        let mut named = Vec::with_capacity(view.rows.len());
        for (row, bytes) in view.rows {
            let blob = match bytes {
                Some(bytes) => Some(on.put_blob(&Bytes::from(bytes)).await?),
                None => None,
            };
            let value = blob.map(|(hash, size)| hash.as_bytes().iter().copied().chain(size.to_be_bytes()).collect());
            changes.push((row.to_vec(), value));
            named.push((row, blob));
        }
        self.index.apply_on(on, changes, view.head.into()).await?;
        for (row, blob) in named {
            let was = match blob {
                Some(blob) => self.blobs.insert(row, blob),
                None => self.blobs.remove(&row),
            };
            if let Some((hash, _)) = was.filter(|b| Some(*b) != blob) {
                on.drop(&hash.to_hex()).await.ok();
            }
        }
        Ok(())
    }
}

/// The rows of the stored view its shelf's index names, each read from its blob, where they all read whole; else none,
/// and the device replays its edits as it would with no view, and keeps its view anew.
async fn read_view(shelf: &Shelf) -> (ViewRows, ViewOnShelf) {
    let mut on = ViewOnShelf::none(shelf);
    match ShelfIndex::open_kept(shelf.clone(), VIEW, PACKS_BUDGET, empty_head()).await {
        Ok((index, true)) => on.index = index,
        Ok((_, false)) => return (ViewRows::new(), on),
        Err(e) => {
            tracing::warn!("avendb: the index of the stored view can't be read, so it is worked out anew: {e:#}");
            return (ViewRows::new(), on);
        }
    }
    let read = async {
        let (mut view, mut from) = (ViewRows::new(), Vec::new());
        loop {
            let rows = on.index.scan(&from, 4096).await?;
            let Some((last, _)) = rows.last() else { break };
            from = [last.as_slice(), &[0]].concat();
            for (row, value) in rows {
                let row = <[u8; 32]>::try_from(row.as_slice()).map_err(|_| anyhow!("a row of the view isn't 32 bytes"))?;
                let blob = blob_of(&value).ok_or_else(|| anyhow!("a row of the view names no blob"))?;
                view.insert(row, shelf.read_blob(blob.0, blob.1).await?.to_vec());
                on.blobs.insert(row, blob);
            }
        }
        anyhow::Ok(view)
    };
    match read.await {
        Ok(view) => (view, on),
        Err(e) => {
            tracing::warn!("avendb: the stored view's rows don't read whole, so it is worked out anew: {e:#}");
            (ViewRows::new(), ViewOnShelf::none(shelf))
        }
    }
}

/// A device's kept showings or query views on its shelf (`Warming::shown`, `Warming::queries`): the index that names,
/// by each one's row, the pack it is in; and how many rows name each pack, so that a pack no row names goes. The list
/// slots of showings of before the index (`slots/shown-0`, `-1`) are read by nothing: a shelf with only those keeps no
/// showing, and its view's next derivation keeps them all again; their packs stay unnamed till a sweep.
pub(crate) struct PacksOnShelf {
    index: ShelfIndex,
    packs: HashMap<Blob, usize>,
}

impl PacksOnShelf {
    /// None on `shelf`, of index `name`.
    fn none(shelf: &Shelf, name: &str) -> PacksOnShelf {
        let index = ShelfIndex::empty(shelf.clone(), name, PACKS_BUDGET, empty_head().head).expect("the name of an index");
        PacksOnShelf { index, packs: HashMap::new() }
    }

    /// Puts the pack of `kept` on the shelf through `on` as a blob, then its rows in the index, each naming it in place
    /// of the pack it named before, stamped with the log head they were judged at; and lets go of each pack no row
    /// names then. A crash before the index's slot leaves the rows as they were, each naming a pack the shelf holds
    /// still.
    async fn put(&mut self, on: &Shelf, kept: KeptPack) -> Result<()> {
        let blob = on.put_blob(&Bytes::from(kept.pack)).await?;
        let value: Vec<u8> = blob.0.as_bytes().iter().copied().chain(blob.1.to_be_bytes()).collect();
        let mut was = Vec::new();
        for row in &kept.rows {
            was.extend(self.index.get(row).await?.as_deref().and_then(blob_of));
        }
        let changes = kept.rows.iter().map(|row| (row.to_vec(), Some(value.clone()))).collect();
        self.index.apply_on(on, changes, kept.head.into()).await?;
        *self.packs.entry(blob).or_default() += kept.rows.len();
        let mut gone = vec![];
        for b in was {
            let rows = self.packs.get_mut(&b).expect("a pack its rows name");
            *rows -= 1;
            if *rows == 0 {
                self.packs.remove(&b);
                gone.push(b);
            }
        }
        for (hash, _) in gone.into_iter().filter(|b| *b != blob) {
            on.drop(&hash.to_hex()).await.ok();
        }
        Ok(())
    }
}

/// The packs its shelf's index `name` names, each with the rows that name it (`PackFile::rows`): a pack that doesn't
/// read whole is none, and the showings or views its rows name are worked out anew and kept again.
async fn read_packs(shelf: &Shelf, name: &str) -> (Vec<PackFile>, PacksOnShelf) {
    let mut on = PacksOnShelf::none(shelf, name);
    let kept = match ShelfIndex::open_kept(shelf.clone(), name, PACKS_BUDGET, empty_head()).await {
        Ok((index, kept)) => {
            on.index = index;
            kept
        }
        Err(e) => {
            tracing::warn!("avendb: the index of kept {name} can't be read, so they are worked out anew: {e:#}");
            return (vec![], on);
        }
    };
    if !kept {
        return (vec![], on);
    }
    let mut named: BTreeMap<Blob, Vec<[u8; 32]>> = BTreeMap::new();
    let mut from = Vec::new();
    loop {
        let rows = match on.index.scan(&from, 4096).await {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!("avendb: the index of kept {name} doesn't read whole, so they are worked out anew: {e:#}");
                return (vec![], PacksOnShelf::none(shelf, name));
            }
        };
        let Some((last, _)) = rows.last() else { break };
        from = [last.as_slice(), &[0]].concat();
        for (row, value) in rows {
            if let (Ok(row), Some(blob)) = (<[u8; 32]>::try_from(row.as_slice()), blob_of(&value)) {
                named.entry(blob).or_default().push(row);
            }
        }
    }
    let mut out = Vec::with_capacity(named.len());
    for (blob, rows) in named {
        on.packs.insert(blob, rows.len());
        match read_pack_file(shelf, blob).await {
            Ok(file) => out.push(PackFile { file, rows: Some(rows) }),
            Err(e) => tracing::warn!("avendb: a pack of kept {name} doesn't read whole, so they are worked out anew: {e:#}"),
        }
    }
    (out, on)
}

/// Pack `blob` of kept showings or views: the file it is, where its shelf keeps blobs as files, its showings read there
/// as they open; else its bytes.
async fn read_pack_file(shelf: &Shelf, (hash, size): Blob) -> Result<Arc<dyn avendb::pages::Space>> {
    if let Some(file) = shelf.blob_file(hash).await.filter(|f| f.len() == size) {
        return Ok(file);
    }
    let bytes = shelf.read_blob(hash, size).await?;
    Ok(PackFile::from(bytes.to_vec()).file)
}

/// The pack a row of the index of kept showings names, its hash and size.
fn blob_of(value: &[u8]) -> Option<Blob> {
    let (hash, size) = value.split_first_chunk::<32>()?;
    Some((Hash::from_bytes(*hash), u64::from_be_bytes(size.try_into().ok()?)))
}

/// What the two slots `which` of `shelf` keep, the newest first, and the number the next is kept as.
async fn slots_of(shelf: &Shelf, (names, starts): ([&str; 2], &[u8])) -> Result<(Vec<Vec<u8>>, u64)> {
    let mut kept = vec![];
    for name in names {
        let bytes = shelf.get(name).await?;
        let slot = bytes.as_deref().and_then(|b| b.strip_prefix(starts)).and_then(|b| b.split_first_chunk::<8>());
        kept.extend(slot.map(|(n, bytes)| (u64::from_be_bytes(*n), bytes.to_vec())));
    }
    kept.sort_by(|a, b| b.0.cmp(&a.0));
    let next = kept.first().map_or(0, |(n, _)| n + 1);
    Ok((kept.into_iter().map(|(_, bytes)| bytes).collect(), next))
}

/// Decodes a legacy pack without retaining its entire raw encoding beside its decoded edits. The bytes in flight
/// are one bounded shelf read plus the current record. Nothing escapes until the complete blob hash checks out;
/// a changed or truncated pack still rejects its whole head, so `Edits::open` can try the previous head.
#[cfg(test)]
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
        let plan = (book.next - book.mark, book.tail, book.packs.len());
        let shared = self.clone();
        let due = move || shared.edits.as_ref().expect("its edits").due(&shared.locked_lab(), shared.me, plan);
        #[cfg(not(target_arch = "wasm32"))]
        let due = tokio::task::spawn_blocking(due).await??;
        #[cfg(target_arch = "wasm32")]
        let due = due()?;
        // the edits first, so that what it worked out from them is of edits its shelf holds
        let mut put = due.is_some();
        if let Some(due) = due {
            let before = edits.checked();
            // timed among the Lab's turns, as the save's other steps: a shelf write that blocks a page's one worker
            // names itself in its report
            let _timed = crate::Timed::new(&self.lab_turns, "save: put edits", n0_future::time::Instant::now());
            edits.put_on(on, &mut book, due).await?;
            drop(_timed);
            // a head it put, named by its keys at once (`keep_checked`)
            if edits.checked() != before {
                self.keep_checked(on).await;
            }
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
        // the shared index, of the edits the shelf holds now, on the same path as their save (B1, `shared_index`): it
        // is derived, so a shelf that can't take it costs the next save that step, never this one
        if let Some(index) = &self.shared_index {
            let held = edits.held(&self.locked_lab(), self.me);
            let _timed = crate::Timed::new(&self.lab_turns, "save: step the shared index", n0_future::time::Instant::now());
            if let Err(e) = index.step(&self.lab, self.me, held).await {
                tracing::warn!("avendb: the shared index can't be stepped on: {e:#}");
            }
        }
        let shared = self.clone();
        // Only the once-only quiescent finalizer has an override shelf. The normal
        // save lane retains its bounded snapshot interval; authoritative data is already durable.
        let current = override_shelf.is_some();
        let warming = move || {
            let _timed = crate::Timed::new(&shared.lab_turns, "save: work out what to keep", n0_future::time::Instant::now());
            match current {
                true => shared.prepare_warm_at(true, avendb::lab::WarmCapture::encode),
                false => shared.prepare_warm_with(avendb::lab::WarmCapture::encode),
            }
        };
        #[cfg(not(target_arch = "wasm32"))]
        let warming = tokio::task::spawn_blocking(warming).await?;
        #[cfg(target_arch = "wasm32")]
        let warming = warming();
        // what it worked out only spares it time: a shelf that can't take it costs it that time, no more, and the
        // device gives it again at the next save
        if let Some(mut warming) = warming {
            let timed = crate::Timed::new(&self.lab_turns, "save: put what it worked out", n0_future::time::Instant::now());
            let put = edits.put_warm_on(on, &mut warming).await;
            drop(timed);
            match put {
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
        let _timed = crate::Timed::new(&self.lab_turns, "save: range summaries", n0_future::time::Instant::now());
        if let Err(error) = self.edit_transfer.summaries.flush(on).await {
            tracing::warn!(%error, "avendb: optional range summary remains pending");
        }
        Ok(put)
    }

    /// Keeps its keys on its shelf at once, naming the head it just put (`Lab::capture_warm_keys`), before the rest of
    /// its save: a node stopped between the two would else hold that head on no word as it starts again, and check the
    /// signature of every edit of it. A shelf that can't take them costs that check, no more, and the save gives them
    /// again.
    async fn keep_checked(self: &Arc<Self>, on: &Shelf) {
        let edits = self.edits.as_ref().expect("its edits");
        let shared = self.clone();
        let capture = move || {
            let _timed = crate::Timed::new(&shared.lab_turns, "save: work out its keys", n0_future::time::Instant::now());
            let checked = shared.edits.as_ref().expect("its edits").checked();
            shared.locked_lab().capture_warm_keys(shared.me, checked).map(avendb::lab::WarmCapture::encode)
        };
        #[cfg(not(target_arch = "wasm32"))]
        let warming = match tokio::task::spawn_blocking(capture).await {
            Ok(warming) => warming,
            Err(e) => return tracing::warn!("avendb: its keys can't be worked out: {e:#}"),
        };
        #[cfg(target_arch = "wasm32")]
        let warming = capture();
        let Some(mut warming) = warming else { return };
        let timed = crate::Timed::new(&self.lab_turns, "save: put its keys", n0_future::time::Instant::now());
        let put = edits.put_warm_on(on, &mut warming).await;
        drop(timed);
        match put {
            Ok(()) => {
                let shared = self.clone();
                let warmed = move || shared.locked_lab().warmed(shared.me, warming);
                #[cfg(not(target_arch = "wasm32"))]
                if let Err(e) = tokio::task::spawn_blocking(warmed).await {
                    tracing::warn!("avendb: its keys put can't be told: {e:#}");
                }
                #[cfg(target_arch = "wasm32")]
                warmed();
            }
            Err(e) => tracing::warn!("avendb: its keys can't be put on its shelf: {e:#}"),
        }
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
                    *self.unsaved.lock().expect("unsaved") = None;
                    wait = self.opts.retry;
                    edits.due.notified().await;
                }
                Err(e) => {
                    tracing::warn!("avendb: the shelf can't be written, trying again in {wait:?}: {e:#}");
                    {
                        let mut unsaved = self.unsaved.lock().expect("unsaved");
                        let u = unsaved.get_or_insert_with(|| crate::Unsaved { since: crate::unix_now(), tries: 0, error: String::new() });
                        u.tries += 1;
                        u.error = format!("{e:#}");
                    }
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
        let due = Due { to: 1, head: log_lab.log(me).head(), records, rows: None, keys: vec![], whole: false, anchors: anchors.clone(), anchor_stamp: vec![] };
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
        edits.put(&mut book, Due { to: 1, head: log_lab.log(me).head(), records, rows: None, keys: vec![], whole: true, anchors: anchors.clone(), anchor_stamp: vec![] }).await.unwrap();
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
                            // what it worked out before, read first now (`Edits::open_into`): none
                            "slots/keys-0" | "slots/keys-1" | "slots/view-0" | "slots/view-1" | "slots/index-view-0"
                            | "slots/index-view-1" | "slots/index-shown-0" | "slots/index-shown-1"
                            | "slots/index-queries-0" | "slots/index-queries-1" => None,
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
    /// Kept showings on a shelf (`PacksOnShelf`): a shelf with only a list of before the index gives none; each row
    /// names the pack it was last put in, and a pack no row names any more goes.
    #[tokio::test]
    async fn each_kept_showing_is_read_from_the_pack_its_row_names_and_a_pack_none_names_goes() {
        struct Folder(std::path::PathBuf);
        impl Drop for Folder {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).ok();
            }
        }
        let folder = Folder(std::env::temp_dir().join(format!("avendb-kept-shown-{}", crate::shelf::fresh())));
        let writer = crate::disk::open(&folder.0).expect("the test shelf").writer().unwrap();
        let shelf = writer.shelf();
        let listed = shelf.put_blob(&Bytes::from_static(b"a pack listed before the index")).await.unwrap();
        let list = [&b"avenDB shown packs 1\n"[..], &0u64.to_be_bytes(), listed.0.as_bytes(), &listed.1.to_be_bytes()].concat();
        shelf.keep("slots/shown-0", Bytes::from(list)).await.unwrap();
        let rows = |packs: &[PackFile]| -> Vec<Option<Vec<[u8; 32]>>> {
            let mut rows: Vec<_> = packs.iter().map(|p| p.rows.clone()).collect();
            rows.sort();
            rows
        };
        let (packs, mut on) = read_packs(&shelf, SHOWN).await;
        assert!(packs.is_empty(), "a list of before the index is read by nothing");
        let head = avendb::log_head::head(&[]);
        let kept = |pack: &[u8], rows: &[[u8; 32]]| KeptPack { pack: pack.to_vec(), rows: rows.to_vec(), head };
        let (a, b) = ([1; 32], [2; 32]);
        on.put(&shelf, kept(b"first", &[a, b])).await.unwrap();
        let (packs, mut on) = read_packs(&shelf, SHOWN).await;
        assert_eq!(rows(&packs), vec![Some(vec![a, b])]);
        on.put(&shelf, kept(b"second", &[b])).await.unwrap();
        let (packs, mut on) = read_packs(&shelf, SHOWN).await;
        assert_eq!(rows(&packs), vec![Some(vec![a]), Some(vec![b])], "each row names the pack it was last put in");
        on.put(&shelf, kept(b"third", &[a])).await.unwrap();
        let (packs, on) = read_packs(&shelf, SHOWN).await;
        assert_eq!(rows(&packs), vec![Some(vec![a]), Some(vec![b])]);
        assert!(!on.packs.contains_key(&(Hash::new(b"first"), 5)), "the first pack, named by no row");
        assert!(shelf.read_blob(Hash::new(b"first"), 5).await.is_err(), "goes");
        assert!(shelf.read_blob(Hash::new(b"second"), 6).await.is_ok());
    }

    #[test]
    fn withdrawal_then_append_cannot_reuse_a_saved_prefix_of_the_same_length() {
        let first = signed(0).edit;
        let second = signed(1).edit;
        let mut log = Log::from_edits(vec![first.clone(), second]);
        let kept = Kept { anchor_stamp: Vec::new(), written: 2, head: Some(log.head()), keys: HashSet::new(), whole: false };
        assert!(kept.continues(&log));
        log.let_go(&[first.id()].into());
        log.receive([signed(2).edit]);
        assert_eq!(log.ids().len(), kept.written);
        assert!(!kept.continues(&log), "equal counts do not make a replacement prefix durable");
        let kept = Kept { head: Some(log.head()), ..kept };
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
    async fn a_delayed_save_acknowledges_only_its_head_and_recovery_keeps_every_old_head() {
        use avendb::cast::{handbook, text, world};
        use avendb::lab::Backup;

        struct Folder(std::path::PathBuf);
        impl Drop for Folder {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).ok();
            }
        }
        let folder = Folder(std::env::temp_dir().join(format!("avendb-one-head-{}", crate::shelf::fresh())));
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
            let due = edits.due(&w.lab, me, (0, 0, 0)).unwrap().unwrap();
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
            let due = edits.due(&w.lab, me, (book.next - book.mark, book.tail, book.packs.len())).unwrap().unwrap();
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
        assert_eq!(edits.held(&w.lab, me), 0, "an old save cannot acknowledge the current head");
        assert!(edits.lacks(&w.lab, me), "the saver must run again");
        let second_head = shelf.get(&head_name(2)).await.unwrap().unwrap();
        {
            let mut book = edits.book.lock().await;
            let due = edits.due(&w.lab, me, (book.next - book.mark, book.tail, book.packs.len())).unwrap().unwrap();
            assert!(due.whole);
            edits.put(&mut book, due).await.expect("the current head is durable");
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
                        let view = name.starts_with("slots/index-view-");
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
        let offer=lab.entry_base_offer(mac,phone,entry).unwrap();
        lab.receive(phone,offer.evidence,vec![]);
        let shelf=crate::disk::open(&folder).unwrap();
        let node=Node::spawn(lab.split(phone,&[owner],[73;32]),phone,Options { shelf:Some(shelf.clone()), ..Options::local() }).await.unwrap();
        node.tasks.lock().unwrap().iter().for_each(|task|task.abort());
        node.shared.save().await.unwrap();
        let edits=node.shared.edits.as_ref().unwrap();
        while tokio::time::timeout(Duration::ZERO,edits.due.notified()).await.is_ok() {}
        let before=node.read(|lab,me|lab.log(me).head()).await;
        assert!(node.act(move |lab,me|lab.adopt_owner_entry_base(me,snapshot,entry,prepared.sealed)).await);
        assert_eq!(before,node.read(|lab,me|lab.log(me).head()).await,"adoption adds no signed edit");
        tokio::time::timeout(Duration::from_millis(100),edits.due.notified()).await.expect("anchor-only adoption wakes idle saver");
        node.shared.save().await.unwrap();
        let (_, (signed, keys, anchors))=Edits::open(shelf).await.unwrap();
        assert!(!anchors.is_empty());
        assert!(avendb::lab::Backup::new(signed,keys).with_bootstrap_bytes(&anchors).is_some());
        node.shutdown().await.unwrap();
        std::fs::remove_dir_all(folder).ok();
    }

    /// A shelf that takes no write while `full` holds, as a full disk or an OPFS quota: every other call goes through.
    fn full_when(shelf: Shelf, full: Arc<std::sync::atomic::AtomicBool>) -> Shelf {
        let (proxy, mut calls) = Shelf::new();
        tokio::spawn(async move {
            let no = || Err(std::io::Error::new(ErrorKind::StorageFull, "no space left on the shelf"));
            while let Some(call) = calls.recv().await {
                let full = full.load(Ordering::Relaxed);
                match call {
                    Call::Keep { name, bytes, tx } => drop(tx.send(if full { no() } else { shelf.keep(&name, bytes).await })),
                    Call::Put { name, bytes, tx } => drop(tx.send(if full { no() } else { shelf.put(&name, bytes).await })),
                    Call::Write { name, at, bytes, tx } => {
                        drop(tx.send(if full { no() } else { shelf.write(&name, at, bytes).await }))
                    }
                    Call::Finish { name, hash, size, outboard, tx } => {
                        drop(tx.send(if full { no() } else { shelf.finish(&name, hash, size, outboard).await }))
                    }
                    Call::List(tx) => drop(tx.send(shelf.list().await)),
                    Call::Outboard { hash, tx } => drop(tx.send(shelf.outboard(hash).await)),
                    Call::Drop { name, tx } => drop(tx.send(shelf.drop(&name).await)),
                    Call::Read { name, at, len, tx } => drop(tx.send(shelf.read(&name, at, len).await)),
                    Call::Get { name, tx } => drop(tx.send(shelf.get(&name).await)),
                    Call::Names { prefix, tx } => drop(tx.send(shelf.names(&prefix).await)),
                }
            }
        });
        proxy
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn a_shelf_that_takes_no_write_is_told_not_stalled_on() {
        use crate::{Node, Options};
        use avendb::cast::{document, human_on};
        use std::time::Duration;
        let folder = std::env::temp_dir().join(format!("avendb-full-shelf-{}", crate::shelf::fresh()));
        let mut lab = Lab::new();
        let passkey = lab.passkey("Alice");
        let me = lab.device_of(passkey, "Alice's phone");
        let vault = human_on(&mut lab, passkey, &[me]);
        let full = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let writer = crate::disk::open(&folder).unwrap().writer().unwrap();
        let shelf = full_when(writer.shelf(), full.clone());
        let opts = Options { shelf: Some(shelf), retry: Duration::from_millis(20), ..Options::local() };
        let node = Node::spawn(lab.split(me, &[passkey], [83; 32]), me, opts).await.unwrap();
        avendb_testkit::until("it saves", || async { !node.behind().await }).await;
        assert!(node.synced().await["unsaved"].is_null(), "a shelf that takes its writes is no news");
        // the disk fills: what it takes now stays off its shelf, and its person is told so, with why
        full.store(true, Ordering::Relaxed);
        node.act(move |lab, me| lab.create(me, vault, vault, "note", &[], document("Unsaved", "kept in memory", me)).unwrap())
            .await;
        avendb_testkit::until("it says its shelf takes no write", || async {
            node.synced().await["unsaved"]["tries"].as_u64().is_some_and(|n| n >= 2)
        })
        .await;
        let unsaved = node.synced().await["unsaved"].clone();
        assert!(unsaved["error"].as_str().unwrap().contains("no space left"), "{unsaved}");
        assert!(unsaved["since"].as_u64().unwrap() > 0);
        assert!(node.behind().await);
        // room again: the next try saves it, and the news goes
        full.store(false, Ordering::Relaxed);
        avendb_testkit::until("it saves once there is room", || async { !node.behind().await }).await;
        avendb_testkit::until("the news goes", || async { node.synced().await["unsaved"].is_null() }).await;
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
        let before = node.shared.edits.as_ref().unwrap().warm().await.view;
        assert!(!before.is_empty());
        node.act(move |lab, me| { lab.edit(me, vault, entry, |it| it.set_text(2,"recent durable edit")).unwrap(); }).await;
        node.shared.save().await.unwrap();
        assert_eq!(node.shared.edits.as_ref().unwrap().warm().await.view, before,
            "ordinary saver must retain its snapshot interval after a single write");
        let expected = node.read(move |lab,me| lab.item(me,entry).unwrap().record()).await;
        node.shutdown().await.unwrap();
        let (reopened, (signed, keys, anchors)) = Edits::open(shelf.clone()).await.unwrap();
        assert!(anchors.is_empty(), "ordinary warm reopen has no bootstrap companion");
        let count = signed.len();
        let warm = reopened.warm().await;
        assert_ne!(warm.view, before, "clean shutdown publishes the current derived frontier");
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
            let head = node.shared.locked_lab().log(me).head();
            node.act(move |lab, me| {
                lab.lock(me);
                if unlock_before_receipt {
                    assert!(lab.unlock(me));
                }
            })
            .await;
            assert_eq!(node.shared.locked_lab().log(me).head(), head, "no edit wakeup");
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
