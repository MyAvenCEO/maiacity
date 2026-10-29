//! A device's shared index on its shelf (B1, `spec/AvenDB/SharedIndex.lean`): the rows of `avendb::index::shared`, the
//! tokens of each entry's type, tags and links in its audience and the entries of each audience in the order created,
//! kept as a `ShelfIndex` named `shared`, so a view lists the entries of a type, a tag or a link by a scan of one key
//! range, off the shelf, its pages a budget's worth in memory.
//!
//! - It is of what the device's edits say (`Lab::shared_of`), and stepped on in the save that puts them on the shelf,
//!   right after them (`Shared::save_on`), its slot stamped with the head of the edits it is of: the log's one head
//!   (`Log::head`, `avendb::log_head`), the number of them and a hash of their ids in one stream. A save steps on it only where the device worked out all they say
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

use avendb::id::{EntryId, SignerId, VaultId};
use avendb::index::shared::{self, Of};
use avendb::lab::Lab;
use avendb::pages::{Change, Sum};

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

/// The head of a device's log with no edits.
pub(crate) fn empty_head() -> Stamp {
    head(&[])
}

/// The head of a log of edits `ids` (`avendb::log_head::head`).
pub(crate) fn head(ids: &[avendb::id::EditId]) -> Stamp {
    avendb::log_head::head(ids).into()
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
    /// The head of the edits it is of, as its slot holds it: what a reader asks under its hold of the Lab.
    stamp: Mutex<Stamp>,
}

impl SharedIndex {
    /// The index on `shelf`, as its newest slot that opens left it: stepped on at the next save. Where its slots can't
    /// be read, the index of no edits, which the next save builds again of every entry (I3): a node always keeps one.
    pub(crate) async fn open(shelf: Shelf) -> io::Result<SharedIndex> {
        let index = match ShelfIndex::open_kept(shelf.clone(), NAME, BUDGET, empty_head()).await {
            Ok((index, _)) => index,
            Err(e) => {
                tracing::warn!("avendb: the shared index can't be read on the shelf, so it is built again: {e:#}");
                ShelfIndex::empty(shelf, NAME, BUDGET, empty_head().head)?
            }
        };
        let stamp = Mutex::new(index.stamp());
        Ok(SharedIndex { index: tokio::sync::Mutex::new(index), stamp })
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
        match step_on(&mut index, &self.stamp, lab, me, held).await {
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
                *self.stamp.lock().expect("stamp") = empty_head();
                step_on(&mut index, &self.stamp, lab, me, held).await
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
    /// before it reads through the index and the tail of edits after it (`Log::of_log`).
    pub(crate) fn of_log(&self, lab: &Lab, me: SignerId) -> Option<Stamp> {
        let stamp = *self.stamp.lock().expect("stamp");
        lab.log(me).of_log(stamp.into()).then_some(stamp)
    }

    /// The rows its finds have read off the index so far, all told: a bench's count of what a read reads.
    #[cfg(test)]
    pub(crate) async fn rows_read(&self) -> u64 {
        self.index.lock().await.rows_read()
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
        let tokens = lab.lock().unwrap_or_else(std::sync::PoisonError::into_inner).find_tokens(me, vault, labels);
        self.find_by(&tokens, after, limit).await
    }

    /// `find`, of the rows of tokens `tokens`: the newest `limit` entries after `after` that carry one of them.
    pub(crate) async fn find_by(
        &self,
        tokens: &[avendb::index::Token],
        after: Option<(u64, EntryId)>,
        limit: usize,
    ) -> io::Result<Vec<(u64, EntryId)>> {
        let index = self.index.lock().await;
        // the newest first: the greatest creation, then the greatest entry, as the keys sort
        let mut found = BTreeSet::new();
        for t in tokens {
            let prefix = shared::label_prefix(t);
            let from = match after {
                Some((created, entry)) => [&shared::label_key(t, created, entry)[..], &[0]].concat(),
                None => prefix.clone(),
            };
            // its own rows alone, so a token of few rows reads no rows of the tokens after it
            for (k, _) in index.scan_within(&from, &prefix, limit).await? {
                let created = shared::created(k[17..25].try_into().expect("8 bytes"));
                found.insert(std::cmp::Reverse((created, shared::owner(k.as_slice()).expect("an entry's row"))));
            }
        }
        Ok(found.into_iter().take(limit).map(|r| r.0).collect())
    }
}

async fn step_on(
    index: &mut ShelfIndex,
    kept: &Mutex<Stamp>,
    lab: &Mutex<Lab>,
    me: SignerId,
    held: usize,
) -> io::Result<Stepped> {
    let locked = || {
        lab.lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    };
    let was = index.stamp();
    let mark_was = index.get(MARK).await?;
    // what it puts again, worked out under one hold of the Lab with the stamp it will be of
    let (stamp, mark, touched) = {
        let lab = locked();
        if !lab.settled(me) || held != lab.log(me).ids().len() {
            return Ok(Stepped::Not);
        }
        let stamp: Stamp = lab.log(me).head().into();
        let mark = (lab.index_mark(me) as u64).to_be_bytes().to_vec();
        let goes_on = lab.log(me).of_log(was.into());
        let touched = if goes_on && mark_was.as_deref() == Some(&mark[..]) {
            lab.shared_touched(me, was.at as usize)
        } else {
            None
        };
        (stamp, mark, touched)
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
            if Stamp::from(lab.log(me).head()) != stamp || !lab.settled(me) {
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
    *kept.lock().expect("stamp") = stamp;
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
