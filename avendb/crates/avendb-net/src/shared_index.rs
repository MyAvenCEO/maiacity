//! A device's shared index on its shelf (B1, `spec/AvenDB/SharedIndex.lean`): the rows of `avendb::index::shared`, the
//! tokens of each entry's type, tags and links in its audience and the entries of each audience in the order created,
//! kept as a `ShelfIndex` named `shared`, so a view lists the entries of a type, a tag or a link by a scan of one key
//! range, off the shelf, its pages a budget's worth in memory.
//!
//! - It is of what the device's edits say (`Lab::shared_of`), and stepped on in the save that puts them on the shelf,
//!   right after them (`Shared::save_on`), its slot stamped with the head of the edits it is of (`head`): the number of
//!   them and a hash chain of their ids, one link an edit. A save steps on it only where the device worked out all they say
//!   (`Lab::settled`) and the shelf holds every one of them; else the next save does.
//! - A save puts again each entry its new edits are of (`Lab::shared_touched`): what the index held of it, read from
//!   its own `E` row, taken out, and its rows as its edits say now put (`SharedIndex.X3_changes`). Where an edit of
//!   another log came (a key, a share), or the index's stamp names no prefix of the device's log (a withdrawal, a log
//!   restored otherwise), or the keys the tokens are under changed (`Lab::index_mark`), it puts again every entry its
//!   edits say exist and every entry the index holds (`X1_step`, `X2_rebuild`).
//! - A crash between the edits and the slot leaves the slot before, of a prefix of the edits, which the next save
//!   steps on (`ShelfIndex.I3_crash`); a page that doesn't read whole makes it build the index again.
//!
//! Its rows are blind, as the rows a device tells are: the pages tell a peer without the keys which entries share a
//! label, never the label (`BlindIndex.blind_reveals_equality_only`).

use std::collections::BTreeSet;
use std::io;
use std::sync::Mutex;

use avendb::id::{EditId, EntryId, SignerId, VaultId};
use avendb::index::shared::{self, Of};
use avendb::lab::Lab;
use avendb::pages::{Change, Sum};
use avendb::policy::LogRevision;

use crate::shelf::Shelf;
use crate::shelf_index::{ShelfIndex, Stamp};

/// Its name on the shelf: `index/shared/<page>`, `slots/index-shared-0` and `-1`.
pub(crate) const NAME: &str = "shared";
/// The bytes of its pages it holds in memory at most.
const BUDGET: usize = 8 << 20;
/// How many entries it works out under one hold of the Lab.
const SLICE: usize = 256;
/// The key of its one row of no entry: the keys its tokens are under (`Lab::index_mark`).
const MARK: &[u8] = b"M";
/// The most rows one scan reads.
const SCAN: usize = 4096;

/// What the head of a log prefix is a hash of, in one stream.
const HEAD: &str = "avenDB shared index head 3";
/// How many ids a hash of them takes at once: a run of them, so it hashes them as fast as it hashes any bytes.
const RUN: usize = 4096;

/// A head being worked out: the hash of the first `at` ids of a log, in one stream, which goes on as the log grows.
#[derive(Clone)]
struct Running {
    at: u64,
    hasher: avendb::hash::Hasher,
}

impl Running {
    fn new() -> Running {
        Running { at: 0, hasher: avendb::hash::Hasher::new(HEAD) }
    }

    /// The same, `more` ids on.
    fn on(&mut self, more: &[EditId]) {
        #[cfg(test)]
        tests::HASHED.with(|n| n.set(n.get() + more.len()));
        let mut run = Vec::with_capacity(32 * RUN.min(more.len()));
        for ids in more.chunks(RUN) {
            run.clear();
            run.extend(ids.iter().flat_map(|id| id.0));
            self.hasher.update(&run);
        }
        self.at += more.len() as u64;
    }

    fn stamp(&self) -> Stamp {
        Stamp { at: self.at, head: self.hasher.clone().finalize() }
    }
}

/// The head of a device's log with no edits.
pub(crate) fn empty_head() -> Stamp {
    Running::new().stamp()
}

/// The head of the first edits `ids` of a device's log: their number and a hash of their ids, in one stream, so that
/// the head of a prefix is a function of its edits alone (`ShelfIndex.Sound`). What a node works out once as it
/// opens, and goes on with as the log grows (`Heads`), never hashing an edit twice while its log only grows.
pub(crate) fn head(ids: &[EditId]) -> Stamp {
    let mut r = Running::new();
    r.on(ids);
    r.stamp()
}

/// What it knows of the device's log, so that it hashes no edit twice: the index's stamp and whether it is the head of
/// a prefix of a log (by its lineage, `Log::lineage`, which changes when the log is anything but appended to), and the
/// head it worked out last, of which log, to go on from.
struct Heads {
    index: Stamp,
    index_of: Option<LogRevision>,
    /// A log the index's stamp was found not to be the head of a prefix of.
    not_of: Option<LogRevision>,
    newest: Option<(LogRevision, Running)>,
}

impl Heads {
    fn new(index: Stamp) -> Heads {
        Heads { index, index_of: None, not_of: None, newest: None }
    }

    /// Its head of device `me`'s log, gone on to the first `to` of its edits: from the head it worked out last where
    /// that is of this log and no further, else from the first edit. Passing the index's stamp, it notes whether the
    /// stamp is the head there.
    fn to(&mut self, lab: &Lab, me: SignerId, to: usize) -> Stamp {
        let log = lab.log(me);
        let (lineage, ids) = (log.lineage(), log.ids());
        let mut r = match self.newest.take() {
            Some((l, r)) if l == lineage && r.at as usize <= to => r,
            _ => Running::new(),
        };
        let unknown = self.index_of.as_ref() != Some(&lineage) && self.not_of.as_ref() != Some(&lineage);
        let index = self.index.at as usize;
        if unknown && (r.at as usize) <= index && index <= to {
            r.on(&ids[r.at as usize..index]);
            if r.stamp() == self.index {
                self.index_of = Some(lineage.clone());
            } else {
                self.not_of = Some(lineage.clone());
            }
        }
        r.on(&ids[r.at as usize..to]);
        let stamp = r.stamp();
        self.newest = Some((lineage, r));
        stamp
    }

    /// The head of device `me`'s log now.
    fn now(&mut self, lab: &Lab, me: SignerId) -> Stamp {
        let len = lab.log(me).ids().len();
        self.to(lab, me, len)
    }

    /// The index's stamp, if it is the head of a prefix of device `me`'s log: at once where it is known to be of this
    /// log or not, else by hashing that prefix, once a log, from the head worked out last where it can.
    fn of_log(&mut self, lab: &Lab, me: SignerId) -> Option<Stamp> {
        let log = lab.log(me);
        let lineage = log.lineage();
        if self.index.at as usize > log.ids().len() {
            return None;
        }
        if self.index_of.as_ref() != Some(&lineage) && self.not_of.as_ref() != Some(&lineage) {
            self.to(lab, me, self.index.at as usize);
        }
        (self.index_of.as_ref() == Some(&lineage)).then_some(self.index)
    }
}

/// How a save stepped the index on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stepped {
    /// It was of the edits already, or the device wasn't settled, or the shelf lacked some of them.
    Not,
    /// It put again the entries the new edits are of, this many.
    Entries(usize),
    /// It put again every entry, this many.
    Every(usize),
}

/// The index, as the module says.
pub(crate) struct SharedIndex {
    index: tokio::sync::Mutex<ShelfIndex>,
    heads: Mutex<Heads>,
}

impl SharedIndex {
    /// The index on `shelf`, as its newest slot that opens left it: stepped on at the next save.
    pub(crate) async fn open(shelf: Shelf) -> io::Result<SharedIndex> {
        let (index, _) = ShelfIndex::open_kept(shelf, NAME, BUDGET, empty_head()).await?;
        let heads = Mutex::new(Heads::new(index.stamp()));
        Ok(SharedIndex {
            index: tokio::sync::Mutex::new(index),
            heads,
        })
    }

    /// Steps it on to what device `me` of `lab` holds, if it is settled and the shelf holds `held` of its edits, every
    /// one: on the same path as the save of them, right after it.
    pub(crate) async fn step(
        &self,
        lab: &Mutex<Lab>,
        me: SignerId,
        held: usize,
    ) -> io::Result<Stepped> {
        let mut index = self.index.lock().await;
        match step_on(&mut index, &self.heads, lab, me, held).await {
            Err(e)
                if matches!(
                    e.kind(),
                    io::ErrorKind::InvalidData | io::ErrorKind::NotFound
                ) =>
            {
                // a page that doesn't read whole: built again from what the edits say
                tracing::warn!(
                    "avendb: the shared index doesn't read whole, so it is built again: {e}"
                );
                index.clear(empty_head());
                *self.heads.lock().expect("heads") = Heads::new(empty_head());
                step_on(&mut index, &self.heads, lab, me, held).await
            }
            other => other,
        }
    }

    /// The head of the edits it is of.
    pub(crate) async fn stamp(&self) -> Stamp {
        self.index.lock().await.stamp()
    }

    /// The head of the edits it is of, if they are the first edits of device `me`'s log in `lab` now; `None` where its
    /// log isn't one they begin (a withdrawal, a log restored otherwise): what a reader asks under its hold of the Lab
    /// before it reads through the index and the tail of edits after it. At once for a log that only grew since the
    /// index was stepped on or last asked; once a log, by hashing the edits it is of.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn of_log(&self, lab: &Lab, me: SignerId) -> Option<Stamp> {
        self.heads.lock().expect("heads").of_log(lab, me)
    }

    /// The hash of its root, a function of its rows alone (`SharedIndex.X4_same_root`).
    pub(crate) async fn root(&self) -> Option<Sum> {
        self.index.lock().await.root()
    }

    /// Every row it holds, in key order: what a test compares with a rebuild.
    #[cfg(test)]
    pub(crate) async fn rows(&self) -> io::Result<Vec<(Vec<u8>, Vec<u8>)>> {
        let index = self.index.lock().await;
        let (mut out, mut from) = (Vec::new(), Vec::new());
        loop {
            let got = index.scan(&from, SCAN).await?;
            let last = got.len() < SCAN;
            if let Some((k, _)) = got.last() {
                from = [&k[..], &[0]].concat();
            }
            out.extend(got);
            if last {
                return Ok(out);
            }
        }
    }

    /// The entries whose rows carry one of `labels` (`index::type_label`, `tag_label`, `link_label`) in any audience of
    /// vault `vault` device `me` knows of, under the keys it holds (`Lab::find_tokens`), the newest first, each with
    /// its creation, older than `after` (the last of a page before), at most `limit`: what a view lists, off the
    /// shelf.
    pub(crate) async fn find(
        &self,
        lab: &Mutex<Lab>,
        me: SignerId,
        vault: VaultId,
        labels: &[String],
        after: Option<(u64, EntryId)>,
        limit: usize,
    ) -> io::Result<Vec<(u64, EntryId)>> {
        let tokens = lab
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .find_tokens(me, vault, labels);
        let index = self.index.lock().await;
        // the newest first: the greatest creation, then the greatest entry, as the keys sort
        let mut found = BTreeSet::new();
        for t in tokens {
            let prefix = shared::label_prefix(&t);
            let from = match after {
                Some((created, entry)) => {
                    [&shared::label_key(&t, created, entry)[..], &[0]].concat()
                }
                None => prefix.clone(),
            };
            for (k, _) in index.scan(&from, limit).await? {
                if !k.starts_with(&prefix) {
                    break;
                }
                let created = shared::created(k[17..25].try_into().expect("8 bytes"));
                found.insert(std::cmp::Reverse((
                    created,
                    shared::owner(&k).expect("an entry's row"),
                )));
            }
        }
        Ok(found.into_iter().take(limit).map(|r| r.0).collect())
    }
}

async fn step_on(
    index: &mut ShelfIndex,
    heads: &Mutex<Heads>,
    lab: &Mutex<Lab>,
    me: SignerId,
    held: usize,
) -> io::Result<Stepped> {
    let locked = || {
        lab.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    };
    let heads = || heads.lock().expect("heads");
    let was = index.stamp();
    let mark_was = index.get(MARK).await?;
    // what it puts again, worked out under one hold of the Lab with the stamp it will be of
    let (stamp, lineage, mark, touched) = {
        let lab = locked();
        if !lab.settled(me) || held != lab.log(me).ids().len() {
            return Ok(Stepped::Not);
        }
        let mut heads = heads();
        let stamp = heads.now(&lab, me);
        let mark = (lab.index_mark(me) as u64).to_be_bytes().to_vec();
        let of_prefix = heads.of_log(&lab, me) == Some(was);
        let touched = if of_prefix && mark_was.as_deref() == Some(&mark[..]) {
            lab.shared_touched(me, was.at as usize)
        } else {
            None
        };
        (stamp, lab.log(me).lineage(), mark, touched)
    };
    if stamp == was && touched.as_ref().is_some_and(BTreeSet::is_empty) {
        return Ok(Stepped::Not);
    }
    let every = touched.is_none();
    let entries: Vec<EntryId> = match touched {
        Some(t) => t.into_iter().collect(),
        None => {
            // every entry its edits say exist, and every entry the index holds
            let mut all: BTreeSet<EntryId> = locked().shared_entries(me).into_iter().collect();
            all.extend(held_entries(index).await?);
            all.into_iter().collect()
        }
    };
    let mut changes: Vec<Change> = Vec::new();
    for slice in entries.chunks(SLICE) {
        let mut old = Vec::with_capacity(slice.len());
        for e in slice {
            old.push(match index.get(&shared::entry_key(*e)).await? {
                Some(bytes) => {
                    Some(Of::from_bytes(*e, &bytes).ok_or_else(|| invalid("an entry's row"))?)
                }
                None => None,
            });
        }
        let new: Vec<Option<Of>> = {
            let lab = locked();
            // the Lab moved on while the old rows were read: this save leaves the index as it was
            if lab.log(me).lineage() != lineage
                || lab.log(me).ids().len() as u64 != stamp.at
                || !lab.settled(me)
            {
                return Ok(Stepped::Not);
            }
            slice.iter().map(|e| lab.shared_of(me, *e)).collect()
        };
        for (old, new) in old.into_iter().zip(new) {
            if old == new {
                continue;
            }
            changes.extend(old.iter().flat_map(Of::keys).map(|k| (k, None)));
            changes.extend(new.iter().flat_map(Of::rows).map(|(k, v)| (k, Some(v))));
        }
    }
    changes.push((MARK.to_vec(), Some(mark)));
    index.apply(changes, stamp).await?;
    // the index is of the log of `lineage`, as its stamp was worked out from it
    {
        let mut heads = heads();
        (heads.index, heads.index_of, heads.not_of) = (stamp, Some(lineage), None);
    }
    Ok(if every {
        Stepped::Every(entries.len())
    } else {
        Stepped::Entries(entries.len())
    })
}

/// Every entry the index holds rows of: its `E` rows'.
async fn held_entries(index: &ShelfIndex) -> io::Result<Vec<EntryId>> {
    let prefix = [shared::ENTRY];
    let (mut out, mut from) = (Vec::new(), prefix.to_vec());
    loop {
        let got = index.scan(&from, SCAN).await?;
        let last = got.len() < SCAN;
        for (k, _) in &got {
            if !k.starts_with(&prefix) {
                return Ok(out);
            }
            out.push(shared::owner(k).ok_or_else(|| invalid("an entry's row"))?);
        }
        match got.last() {
            Some((k, _)) if !last => from = [&k[..], &[0]].concat(),
            _ => return Ok(out),
        }
    }
}

fn invalid(what: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidData,
        format!("the shared index holds {what} that doesn't read"),
    )
}

#[cfg(test)]
#[path = "shared_index_tests.rs"]
mod tests;
