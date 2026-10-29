//! A log's edits by place (row 17, F3): each edit of a `Log` is held decoded, or only where its record lies (a spill's
//! file, a shelf's pack), and decoded from there the first time it is read, then kept decoded. So a log whose edits
//! are on a shelf holds their places, not the edits, till something reads one; and a reader that asks for one edit
//! reads that one alone. It is the same edits either way: a record read back is checked by its hash and its edit by its
//! id, as a spill checks what it reads (`bulk`), and its bulk bytes stay where they lie.
//!
//! `Edits` is a slice of them, as `[Edit]` is: indexed, sliced and walked the same way, so the replay and every reader
//! of a log take it in place of a slice. A walk of all of it decodes every edit it holds by place: what reads a log
//! often reads it by an index the log keeps (`Log::by_log`, `entry_write`, `logs`), never by a walk.

use std::ops::{Index, Range, RangeFrom, RangeFull, RangeInclusive, RangeTo, RangeToInclusive};
use std::sync::OnceLock;

use super::Edit;
use crate::bulk::Place;

/// One edit of a log: decoded, or where its record lies, decoded as it is first read.
pub struct Slot {
    edit: OnceLock<Edit>,
    place: Option<Place>,
}

impl Slot {
    fn held(edit: Edit) -> Slot {
        let held = OnceLock::new();
        let _ = held.set(edit);
        Slot { edit: held, place: None }
    }

    fn get(&self) -> &Edit {
        self.edit.get_or_init(|| {
            let p = self.place.as_ref().expect("an edit held decoded or by place");
            let bytes = p.source.read(p.at, p.len).unwrap_or_else(|e| panic!("avendb: its log's edits don't read: {e}"));
            // as the spill reads a record back: the very bytes that went in, or a disk it can't trust
            let edit = (*blake3::hash(&bytes).as_bytes() == p.sum).then(|| p.source.edit(&bytes)).flatten();
            let mut edit = edit.filter(|e| e.id() == p.edit)
                .unwrap_or_else(|| panic!("avendb: its log's edits changed in their folder: a disk it can't trust"));
            edit.shelve(p.clone());
            edit
        })
    }

    /// Decoded now, in memory.
    fn is_decoded(&self) -> bool {
        self.edit.get().is_some()
    }
}

impl Clone for Slot {
    fn clone(&self) -> Slot {
        match (&self.place, self.edit.get()) {
            (Some(place), _) => {
                let edit = OnceLock::new();
                if let Some(e) = self.edit.get() {
                    let _ = edit.set(e.clone());
                }
                Slot { edit, place: Some(place.clone()) }
            }
            (None, Some(e)) => Slot::held(e.clone()),
            (None, None) => unreachable!("an edit held decoded or by place"),
        }
    }
}

impl std::fmt::Debug for Slot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.get().fmt(f)
    }
}

/// Edits of a log, as a slice of them: see the module.
#[repr(transparent)]
pub struct Edits([Slot]);

impl Edits {
    fn of(slots: &[Slot]) -> &Edits {
        // SAFETY: `Edits` is `repr(transparent)` over `[Slot]`
        unsafe { &*(slots as *const [Slot] as *const Edits) }
    }

    /// No edits.
    pub fn empty() -> &'static Edits {
        Edits::of(&[])
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The edit at a place, or the edits in a range, if it holds them, as a slice's `get`.
    pub fn get<I: At>(&self, i: I) -> Option<&I::Out> {
        i.at(self)
    }

    pub fn first(&self) -> Option<&Edit> {
        self.0.first().map(Slot::get)
    }

    pub fn last(&self) -> Option<&Edit> {
        self.0.last().map(Slot::get)
    }

    pub fn iter(&self) -> Iter<'_> {
        Iter(self.0.iter())
    }

    pub fn contains(&self, e: &Edit) -> bool {
        self.iter().any(|x| x == e)
    }

    /// Each edit, as a value of its own.
    pub fn to_vec(&self) -> Vec<Edit> {
        self.iter().cloned().collect()
    }

    /// How many of them it holds decoded in memory now.
    pub fn decoded(&self) -> usize {
        self.0.iter().filter(|s| s.is_decoded()).count()
    }
}

/// A walk of `Edits`, each decoded as it comes.
#[derive(Clone)]
pub struct Iter<'a>(std::slice::Iter<'a, Slot>);

impl<'a> Iterator for Iter<'a> {
    type Item = &'a Edit;
    fn next(&mut self) -> Option<&'a Edit> {
        self.0.next().map(Slot::get)
    }
    fn size_hint(&self) -> (usize, Option<usize>) {
        self.0.size_hint()
    }
    fn nth(&mut self, n: usize) -> Option<&'a Edit> {
        self.0.nth(n).map(Slot::get)
    }
}

impl DoubleEndedIterator for Iter<'_> {
    fn next_back(&mut self) -> Option<Self::Item> {
        self.0.next_back().map(Slot::get)
    }
}

impl ExactSizeIterator for Iter<'_> {}

impl<'a> IntoIterator for &'a Edits {
    type Item = &'a Edit;
    type IntoIter = Iter<'a>;
    fn into_iter(self) -> Iter<'a> {
        self.iter()
    }
}

impl Index<usize> for Edits {
    type Output = Edit;
    fn index(&self, i: usize) -> &Edit {
        self.0[i].get()
    }
}

/// What `Edits::get` takes: a place, or a range of them.
pub trait At {
    type Out: ?Sized;
    fn at(self, edits: &Edits) -> Option<&Self::Out>;
}

impl At for usize {
    type Out = Edit;
    fn at(self, edits: &Edits) -> Option<&Edit> {
        edits.0.get(self).map(Slot::get)
    }
}

macro_rules! ranges {
    ($($r:ty),*) => {$(
        impl At for $r {
            type Out = Edits;
            fn at(self, edits: &Edits) -> Option<&Edits> {
                edits.0.get(self).map(Edits::of)
            }
        }

        impl Index<$r> for Edits {
            type Output = Edits;
            fn index(&self, r: $r) -> &Edits {
                Edits::of(&self.0[r])
            }
        }
    )*};
}
ranges!(Range<usize>, RangeFrom<usize>, RangeTo<usize>, RangeFull, RangeInclusive<usize>, RangeToInclusive<usize>);

impl std::fmt::Debug for Edits {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_list().entries(self.iter()).finish()
    }
}

impl PartialEq for Edits {
    fn eq(&self, o: &Edits) -> bool {
        self.len() == o.len() && self.iter().eq(o.iter())
    }
}

impl PartialEq<[Edit]> for Edits {
    fn eq(&self, o: &[Edit]) -> bool {
        self.len() == o.len() && self.iter().eq(o.iter())
    }
}

/// A log's own edits, which `Edits` borrows: grown as edits come, each held decoded or by place.
#[derive(Clone, Default)]
pub struct EditsVec(Vec<Slot>);

impl EditsVec {
    pub fn new() -> EditsVec {
        EditsVec(Vec::new())
    }

    pub fn push(&mut self, edit: Edit) {
        super::push_grown(&mut self.0, Slot::held(edit));
    }

    /// An edit held by `place` alone, decoded as it is first read.
    pub(crate) fn push_placed(&mut self, place: Place) {
        super::push_grown(&mut self.0, Slot { edit: OnceLock::new(), place: Some(place) });
    }

    /// Keeps the edits `keep` says, in order.
    pub fn retain_by(&mut self, mut keep: impl FnMut(usize) -> bool) {
        let mut i = 0;
        self.0.retain(|_| {
            let k = keep(i);
            i += 1;
            k
        });
    }

    /// Edit `i` held by place `place` from now on: its decoded copy let go, read back from there as it is next read.
    pub(crate) fn place(&mut self, i: usize, place: Place) {
        self.0[i] = Slot { edit: OnceLock::new(), place: Some(place) };
    }

    pub fn capacity(&self) -> usize {
        self.0.capacity()
    }
}

impl std::ops::Deref for EditsVec {
    type Target = Edits;
    fn deref(&self) -> &Edits {
        Edits::of(&self.0)
    }
}

impl std::fmt::Debug for EditsVec {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        (**self).fmt(f)
    }
}

impl From<Vec<Edit>> for EditsVec {
    fn from(edits: Vec<Edit>) -> EditsVec {
        EditsVec(edits.into_iter().map(Slot::held).collect())
    }
}

impl FromIterator<Edit> for EditsVec {
    fn from_iter<I: IntoIterator<Item = Edit>>(it: I) -> EditsVec {
        EditsVec(it.into_iter().map(Slot::held).collect())
    }
}

impl<'a> From<&'a [Edit]> for EditsVec {
    fn from(edits: &'a [Edit]) -> EditsVec {
        edits.iter().cloned().collect()
    }
}

impl Default for &Edits {
    fn default() -> Self {
        Edits::empty()
    }
}

impl IntoIterator for EditsVec {
    type Item = Edit;
    type IntoIter = std::iter::Map<std::vec::IntoIter<Slot>, fn(Slot) -> Edit>;
    fn into_iter(self) -> Self::IntoIter {
        fn take(s: Slot) -> Edit {
            s.get();
            s.edit.into_inner().expect("decoded")
        }
        self.0.into_iter().map(take as fn(Slot) -> Edit)
    }
}

impl Extend<Edit> for EditsVec {
    fn extend<I: IntoIterator<Item = Edit>>(&mut self, it: I) {
        self.0.extend(it.into_iter().map(Slot::held));
    }
}

impl PartialEq for EditsVec {
    fn eq(&self, o: &EditsVec) -> bool {
        **self == **o
    }
}

impl Eq for EditsVec {}

impl<'a> IntoIterator for &'a EditsVec {
    type Item = &'a Edit;
    type IntoIter = Iter<'a>;
    fn into_iter(self) -> Iter<'a> {
        self.iter()
    }
}

impl PartialEq<Vec<Edit>> for EditsVec {
    fn eq(&self, o: &Vec<Edit>) -> bool {
        **self == o[..]
    }
}

impl<'a> From<&'a Edits> for EditsVec {
    fn from(edits: &'a Edits) -> EditsVec {
        edits.iter().cloned().collect()
    }
}
