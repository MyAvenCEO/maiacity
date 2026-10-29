//! What a device read, sealed with its stored view (`StoredReadings.lean`): the metadata of the bodies it opened, what
//! it reads of them (`read_body`), under the read rules (`READ_RULES`), with the writes whose bodies never open and those
//! it didn't open yet (`ReadNew`). A device that opens its view reads on from them, opening only the bodies of the edits
//! after its view, and the rest as they are asked for (`Bodies`, RR1, RR3); sealed under other rules, or of other
//! edits than its view, they are none, and it reads every body anew (RR2).
//!
//! They lie in rows of the shelf's index of the stored view (`Lab::warming`), beside the view's replay, each sealed on
//! its own, so that a save puts only the rows whose bytes changed (`Rows`):
//!
//! - a row of each `ROW_EDITS` places of the log, `bodies`: of each body it opened of the edits at those places, its id
//!   and its metadata (`metadata`) as a body on the wire, behind its length in 4 bytes, the count of them first, in 4
//!   bytes, big-endian; the edits of the log's first places alone, so a row of edits the log holds as it held them
//!   reads the same at every save;
//! - and the row of the rest, `[READ_RULES, "\n", held: u64]`, then lists, each a count in 4 bytes: the ids of the
//!   writes whose bodies never open; of those its replay didn't count; of the entries whose key it lacked, each its id
//!   and its writes'; and the hash of each row of bodies it was sealed with, so that it opens with those rows and no
//!   others.
//!
//! A view kept before its rows, one sealed slot (`open_whole`), held all of these in one: the bodies, then the lists.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::{READ_RULES, ReadNew, Store, read_body};
use crate::id::{EditId, EntryId};
use crate::policy::Readings;
use crate::slice::Body;
use crate::wire::Wire as _;

/// What a stored view's device read, opened (`open`): to read on from (`ReadNew`).
#[derive(Default)]
pub(super) struct Sealed {
    pub(super) readings: Readings,
    pub(super) opened: Vec<EditId>,
    pub(super) spoilt: Vec<EditId>,
    pub(super) uncounted: HashSet<EditId>,
    pub(super) lacking: HashMap<EntryId, Vec<EditId>>,
}

/// Write `id`'s body as `read_body` reads it, from what `r` read of it: all `read_body` takes, and no more.
fn metadata(r: &Readings, id: &EditId) -> Body {
    Body {
        header: r.headers.get(id).cloned(),
        tags: r.tags.get(id).cloned().unwrap_or_default(),
        answers: vec![],
        content: r.blobs.get(id).cloned().unwrap_or_else(|| Arc::from(&[][..])),
        proof: r.proofs.get(id).cloned(),
        files: vec![],
        defines: r.defines.get(id).cloned(),
    }
}

fn put_ids<'a>(out: &mut Vec<u8>, ids: impl ExactSizeIterator<Item = &'a EditId>) {
    out.extend((ids.len() as u32).to_be_bytes());
    ids.for_each(|id| out.extend(id.0));
}

/// `store` read every body its replay of its first `held` edits counts and no more, so that `seal` seals what it read
/// with a view of them: it read on to the edits its replay is of, left no body for a later step, and reads nothing in
/// from an owner's base.
pub(super) fn sealable(store: &Store, held: usize) -> bool {
    let rn = &store.read_new;
    let read_to = rn.log.as_ref().is_some_and(|(head, wholes)| {
        store.log.of_log(*head) && head.at as usize == held && *wholes == store.wholes
    });
    let r = &store.readings;
    let all = || r.tags.len() == store.bodies.len() && store.bodies.ids().all(|id| r.tags.contains_key(id));
    read_to && rn.left.is_empty() && rn.bodies.is_empty() && store.based.is_empty() && all()
}

/// How many places of the log one row of bodies is of (`Rows`): as many as the log's head marks (`log_head`), so a
/// save after a few hundred new edits puts one row of bodies, and an iPhone of 113k edits holds 28 of them.
pub(super) const ROW_EDITS: usize = 4096;

/// What a save puts of what its device read (`seal`): the row of the rest, the rows of bodies whose bytes changed since
/// those its shelf holds, by their number, and how many rows of bodies it is of; and the hash of each one's bytes, for
/// the next save to tell which changed.
pub(super) struct Rows {
    pub(super) rest: Vec<u8>,
    pub(super) bodies: Vec<(u64, Vec<u8>)>,
    pub(super) prints: Vec<[u8; 32]>,
}

/// The bytes of a row of bodies: of each of `ids`, its id and its metadata, as the module says.
fn put_bodies(out: &mut Vec<u8>, r: &Readings, ids: &[&EditId]) {
    out.extend((ids.len() as u32).to_be_bytes());
    for id in ids {
        let body = metadata(r, id).to_wire();
        out.extend(id.0);
        out.extend((body.len() as u32).to_be_bytes());
        out.extend(body);
    }
}

/// The ids of the bodies `store` opened, a row of each `ROW_EDITS` places of its first `held` edits, each in the
/// log's order; and one row after them of those it opened of no such place, sorted, where there are any.
fn by_place(store: &Store, held: usize) -> Vec<Vec<&EditId>> {
    let tags = &store.readings.tags;
    let ids = &store.log.ids()[..held.min(store.log.ids().len())];
    let mut rows: Vec<Vec<&EditId>> =
        ids.chunks(ROW_EDITS).map(|run| run.iter().filter(|id| tags.contains_key(*id)).collect()).collect();
    if rows.iter().map(Vec::len).sum::<usize>() != tags.len() {
        let placed: HashSet<&EditId> = rows.iter().flatten().copied().collect();
        let mut left: Vec<&EditId> = tags.keys().filter(|id| !placed.contains(id)).collect();
        left.sort();
        rows.push(left);
    }
    rows
}

/// What `store` read, sealed with the view it seals of its first `held` edits, where it can (`sealable`), else none:
/// the row of the rest, and those rows of bodies whose hashes aren't among `given`, those its shelf holds, by number.
pub(super) fn seal(store: &Store, held: usize, given: &[[u8; 32]]) -> Option<Rows> {
    if !sealable(store, held) {
        return None;
    }
    let r = &store.readings;
    let (mut bodies, mut prints) = (vec![], vec![]);
    for (k, ids) in by_place(store, held).iter().enumerate() {
        let mut row = vec![];
        put_bodies(&mut row, r, ids);
        let print = *blake3::hash(&row).as_bytes();
        if given.get(k) != Some(&print) {
            bodies.push((k as u64, row));
        }
        prints.push(print);
    }
    let mut rest = [READ_RULES.as_bytes(), b"\n"].concat();
    rest.extend((held as u64).to_be_bytes());
    put_lists(&mut rest, store);
    rest.extend((prints.len() as u32).to_be_bytes());
    prints.iter().for_each(|p| rest.extend(p));
    Some(Rows { rest, bodies, prints })
}

/// The lists of the rest: the writes whose bodies never open, those its replay didn't count, and the entries whose key
/// it lacked.
fn put_lists(out: &mut Vec<u8>, store: &Store) {
    let rn = &store.read_new;
    let mut spoilt: Vec<&EditId> = store.spoilt.iter().collect();
    spoilt.sort();
    put_ids(out, spoilt.into_iter());
    let mut uncounted: Vec<&EditId> = rn.uncounted.iter().collect();
    uncounted.sort();
    put_ids(out, uncounted.into_iter());
    let mut lacking: Vec<(&EntryId, &Vec<EditId>)> = rn.lacking.iter().collect();
    lacking.sort();
    out.extend((lacking.len() as u32).to_be_bytes());
    for (e, ids) in lacking {
        out.extend(e.0);
        put_ids(out, ids.iter());
    }
}

struct Reader<'a>(&'a [u8]);

impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Option<&'a [u8]> {
        let (a, b) = self.0.split_at_checked(n)?;
        self.0 = b;
        Some(a)
    }
    fn u32(&mut self) -> Option<usize> {
        Some(u32::from_be_bytes(self.take(4)?.try_into().ok()?) as usize)
    }
    fn id(&mut self) -> Option<[u8; 32]> {
        self.take(32)?.try_into().ok()
    }
    fn ids(&mut self) -> Option<Vec<EditId>> {
        (0..self.u32()?).map(|_| self.id().map(EditId)).collect()
    }
    /// The header, where it is of these read rules and of the first `held` edits.
    fn header(&mut self, held: usize) -> Option<()> {
        self.0 = self.0.strip_prefix(READ_RULES.as_bytes())?.strip_prefix(b"\n")?;
        (u64::from_be_bytes(self.take(8)?.try_into().ok()?) == held as u64).then_some(())
    }
    /// A list of bodies, read into `readings`, their ids put in `opened`.
    fn bodies(&mut self, readings: &mut Readings, opened: &mut Vec<EditId>) -> Option<()> {
        let n = self.u32()?;
        opened.reserve(n);
        for _ in 0..n {
            let id = EditId(self.id()?);
            let len = self.u32()?;
            let body = Body::from_wire(self.take(len)?).ok()?;
            read_body(readings, id, &body);
            opened.push(id);
        }
        Some(())
    }
    /// The lists of the rest (`put_lists`), into `s`.
    fn lists(&mut self, s: &mut Sealed) -> Option<()> {
        s.spoilt = self.ids()?;
        s.uncounted = self.ids()?.into_iter().collect();
        for _ in 0..self.u32()? {
            let e = EntryId(self.id()?);
            s.lacking.insert(e, self.ids()?);
        }
        Some(())
    }
}

/// What the rows `rest` and those `bodies` gives by number sealed, where they were sealed under these read rules with
/// a view of the first `held` edits, each row of bodies the one the rest was sealed with, and all read whole: what
/// reading every body they are of reads (RR1); with the hash of each row of bodies. Else none (RR2).
pub(super) fn open(
    rest: &[u8],
    held: usize,
    bodies: impl Fn(u64) -> Option<zeroize::Zeroizing<Vec<u8>>>,
) -> Option<(Sealed, Vec<[u8; 32]>)> {
    let mut r = Reader(rest);
    r.header(held)?;
    let mut s = Sealed::default();
    r.lists(&mut s)?;
    let prints: Vec<[u8; 32]> = (0..r.u32()?).map(|_| r.id()).collect::<Option<_>>()?;
    if !r.0.is_empty() {
        return None;
    }
    for (k, print) in prints.iter().enumerate() {
        let row = bodies(k as u64)?;
        if blake3::hash(&row).as_bytes() != print {
            return None;
        }
        let mut b = Reader(&row);
        b.bodies(&mut s.readings, &mut s.opened)?;
        if !b.0.is_empty() {
            return None;
        }
    }
    Some((s, prints))
}

/// What `bytes`, a view kept as one slot before its rows, sealed beside its replay, as `open` (`VIEW_READ`).
pub(super) fn open_whole(bytes: &[u8], held: usize) -> Option<Sealed> {
    let mut r = Reader(bytes);
    r.header(held)?;
    let mut s = Sealed::default();
    r.bodies(&mut s.readings, &mut s.opened)?;
    r.lists(&mut s)?;
    r.0.is_empty().then_some(s)
}

impl ReadNew {
    /// It reads on from what its stored view read (`Sealed`), of the first `held` edits of `log`, in its replay since
    /// `wholes` whole replays: the bodies it opens next are those of the edits after them, of those its replay didn't
    /// count, and of the entries whose keys it lacked, as it would have had it read them all now.
    pub(super) fn sealed(
        &mut self,
        s: &Sealed,
        opened: usize,
        r: &Readings,
        log: &crate::policy::Log,
        held: usize,
        wholes: u64,
    ) {
        *self = ReadNew::default();
        self.uncounted = s.uncounted.clone();
        self.lacking = s.lacking.clone();
        self.then = Some((opened, 0, r.headers.len(), r.tags.len()));
        self.log = log.head_at(held as u64).map(|head| (head, wholes));
    }
}
