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

/// The head of a device's log with no edits.
pub(crate) fn empty_head() -> Stamp {
    Stamp {
        at: 0,
        head: avendb::hash::Hasher::new("avenDB shared index head 2").finalize(),
    }
}

/// The head of a log `from` is the head of, with `more` edits after: a hash chain, one link an edit, so that the head
/// of a prefix is a function of its edits alone (`ShelfIndex.Sound`), and a log that only grew is stepped on from the
/// head it had, never hashed again from its first edit.
pub(crate) fn head_on(from: Stamp, more: &[EditId]) -> Stamp {
    let mut head = from.head;
    #[cfg(test)]
    tests::HASHED.with(|n| n.set(n.get() + more.len()));
    for id in more {
        let mut h = avendb::hash::Hasher::new("avenDB shared index head 2");
        h.update(&head).update(&id.0);
        head = h.finalize();
    }
    Stamp {
        at: from.at + more.len() as u64,
        head,
    }
}

/// The head of the first edits `ids` of a device's log, from its first edit on: what a node does once, as it opens.
pub(crate) fn head(ids: &[EditId]) -> Stamp {
    head_on(empty_head(), ids)
}

/// What it knows of the device's log, so that it hashes no edit twice: the index's stamp and the log (its lineage,
/// `Log::lineage`, which changes when the log is anything but appended to) it is known to be a prefix of; and the
/// newest head it worked out, of which log.
struct Heads {
    index: Stamp,
    index_of: Option<LogRevision>,
    /// A log the index's stamp was found not to be the head of a prefix of.
    not_of: Option<LogRevision>,
    newest: Option<(LogRevision, Stamp)>,
}

impl Heads {
    /// The head of device `me`'s log now: stepped on from the newest it knows of that log, or the index's, else from
    /// its first edit.
    fn now(&mut self, lab: &Lab, me: SignerId) -> Stamp {
        let (log, ids) = (lab.log(me), lab.log(me).ids());
        let lineage = log.lineage();
        let from = match &self.newest {
            Some((l, s)) if *l == lineage && s.at as usize <= ids.len() => *s,
            _ if self.index_of.as_ref() == Some(&lineage)
                && self.index.at as usize <= ids.len() =>
            {
                self.index
            }
            _ => empty_head(),
        };
        let now = head_on(from, &ids[from.at as usize..]);
        self.newest = Some((lineage, now));
        now
    }

    /// The index's stamp, if it is the head of a prefix of device `me`'s log: at once where it is known to be of this
    /// log, else by hashing the prefix, once a log.
    fn of_log(&mut self, lab: &Lab, me: SignerId) -> Option<Stamp> {
        let (log, ids) = (lab.log(me), lab.log(me).ids());
        let lineage = log.lineage();
        if self.index.at as usize > ids.len() {
            return None;
        }
        if self.index_of.as_ref() == Some(&lineage) {
            return Some(self.index);
        }
        if self.not_of.as_ref() == Some(&lineage) {
            return None;
        }
        let at = match &self.newest {
            Some((l, s)) if *l == lineage && s.at == self.index.at => *s,
            _ => head(&ids[..self.index.at as usize]),
        };
        if at != self.index {
            self.not_of = Some(lineage);
            return None;
        }
        self.index_of = Some(lineage);
        Some(self.index)
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
        let heads = Mutex::new(Heads {
            index: index.stamp(),
            index_of: None,
            not_of: None,
            newest: None,
        });
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
                *self.heads.lock().expect("heads") = Heads {
                    index: empty_head(),
                    index_of: None,
                    not_of: None,
                    newest: None,
                };
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
    *heads() = Heads {
        index: stamp,
        index_of: Some(lineage.clone()),
        not_of: None,
        newest: Some((lineage, stamp)),
    };
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
