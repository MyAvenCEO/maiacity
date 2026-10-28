//! What a device read, sealed with its stored view (`StoredReadings.lean`): the metadata of the bodies it opened, what
//! it reads of them (`read_body`), under the read rules (`READ_RULES`), with the writes whose bodies never open and those
//! it didn't open yet (`ReadNew`). A device that opens its view reads on from them, opening only the bodies of the edits
//! after its view, and the rest as they are asked for (`Bodies`, RR1, RR3); sealed under other rules, or of other
//! edits than its view, they are none, and it reads every body anew (RR2).
//!
//! `[READ_RULES, "\n", held: u64]`, then lists, each a count in 4 bytes, big-endian: of each body it opened, its id and
//! its metadata (`metadata`) as a body on the wire, behind its length in 4 bytes; the ids of the writes whose bodies
//! never open; of those its replay didn't count; and of the entries whose key it lacked, each its id and its writes'.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::{READ_RULES, ReadNew, Store, read_body};
use crate::id::{EditId, EntryId};
use crate::policy::Readings;
use crate::slice::Body;
use crate::wire::Wire as _;

/// What a stored view's device read, opened (`open`): to read on from (`ReadNew`).
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

/// What `store` read, sealed with the view it seals of its first `held` edits: where it read every body its replay of
/// them counts and no more (it read on to the edits its replay is of, left no body for a later step, and reads nothing
/// in from an owner's base), else none.
pub(super) fn seal(store: &Store, held: usize) -> Option<Vec<u8>> {
    let rn = &store.read_new;
    let read_to = rn.log.as_ref().is_some_and(|(lineage, len, wholes)| {
        *lineage == store.log.lineage() && *len == held && *wholes == store.wholes
    });
    let r = &store.readings;
    let all = r.tags.len() == store.bodies.len() && store.bodies.ids().all(|id| r.tags.contains_key(id));
    if !read_to || !rn.left.is_empty() || !rn.bodies.is_empty() || !store.based.is_empty() || !all {
        return None;
    }
    let mut out = [READ_RULES.as_bytes(), b"\n"].concat();
    out.extend((held as u64).to_be_bytes());
    let mut ids: Vec<&EditId> = r.tags.keys().collect();
    ids.sort();
    out.extend((ids.len() as u32).to_be_bytes());
    for id in ids {
        let body = metadata(r, id).to_wire();
        out.extend(id.0);
        out.extend((body.len() as u32).to_be_bytes());
        out.extend(body);
    }
    let mut spoilt: Vec<&EditId> = store.spoilt.iter().collect();
    spoilt.sort();
    put_ids(&mut out, spoilt.into_iter());
    let mut uncounted: Vec<&EditId> = rn.uncounted.iter().collect();
    uncounted.sort();
    put_ids(&mut out, uncounted.into_iter());
    let mut lacking: Vec<(&EntryId, &Vec<EditId>)> = rn.lacking.iter().collect();
    lacking.sort();
    out.extend((lacking.len() as u32).to_be_bytes());
    for (e, ids) in lacking {
        out.extend(e.0);
        put_ids(&mut out, ids.iter());
    }
    Some(out)
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
}

/// What `bytes` sealed, where they were sealed under these read rules with a view of the first `held` edits, and read
/// whole: what reading every body they are of reads (RR1). Else none (RR2).
pub(super) fn open(bytes: &[u8], held: usize) -> Option<Sealed> {
    let mut r = Reader(bytes.strip_prefix(READ_RULES.as_bytes())?.strip_prefix(b"\n")?);
    let of = u64::from_be_bytes(r.take(8)?.try_into().ok()?);
    if of != held as u64 {
        return None;
    }
    let mut readings = Readings::default();
    let n = r.u32()?;
    let mut opened = Vec::with_capacity(n);
    for _ in 0..n {
        let id = EditId(r.id()?);
        let len = r.u32()?;
        let body = Body::from_wire(r.take(len)?).ok()?;
        read_body(&mut readings, id, &body);
        opened.push(id);
    }
    let spoilt = r.ids()?;
    let uncounted = r.ids()?.into_iter().collect();
    let mut lacking = HashMap::new();
    for _ in 0..r.u32()? {
        let e = EntryId(r.id()?);
        lacking.insert(e, r.ids()?);
    }
    r.0.is_empty().then_some(Sealed { readings, opened, spoilt, uncounted, lacking })
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
        self.log = Some((log.lineage(), held, wholes));
    }
}
