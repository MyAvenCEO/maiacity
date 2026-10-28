//! What a device shows of each entry, at most `WINDOW` of them open in memory (S6, `ShownView.lean`).
//!
//! A showing is open (its history, its items as Loro documents) or closed: the bytes a shelf keeps of it
//! (`Shown::record`), with its print and tip beside them, which it opens again as it is read. Reading one opens it;
//! `trim` closes those read least lately past the window, each of which it can keep the bytes of; one whose items hold
//! changes a snapshot leaves out stays open. A showing its shelf kept comes in closed (`insert_closed`), so an unlock
//! opens only those it reads. Closed or open, it is the same showing: it opens as the showing it closed, and judging
//! anew makes it (`SV1_open`). One whose bytes don't open is none, and the next `show_items` judges its entry anew.

use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use super::{Shown, Tip};
use crate::id::EntryId;

/// How many showings stay open past a `trim` beside those it keeps open (the scratch items' entries): those read or
/// judged last.
pub(super) const WINDOW: usize = if cfg!(feature = "test-fixtures") { 8 } else { 256 };

/// A showing as its shelf keeps it (`Shown::record`), with the print and tip it stands for now.
#[derive(Clone)]
pub(super) struct Closed {
    pub(super) print: [u8; 32],
    pub(super) tip: Tip,
    pub(super) bytes: Arc<[u8]>,
}

impl Closed {
    /// The showing a shelf kept as `bytes` (`Shown::record`): its print and tip read off them, the rest when it opens.
    pub(super) fn of_record(bytes: Vec<u8>) -> Option<Closed> {
        use crate::wire::{Decode, Reader};
        let r = &mut Reader::new(&bytes);
        let print = <[u8; 32]>::decode(r).ok()?;
        let tip = Tip {
            writes: u64::decode(r).ok()? as usize,
            last: r.option().ok()?,
            lane: <[u8; 32]>::decode(r).ok()?,
            groups: <[u8; 32]>::decode(r).ok()?,
        };
        Some(Closed { print, tip, bytes: bytes.into() })
    }

    pub(super) fn open(&self) -> Option<Shown> {
        let mut s = Shown::of_record(&self.bytes).ok()?;
        (s.print == self.print).then(|| {
            s.tip = self.tip;
            s
        })
    }
}

struct Slot {
    open: OnceLock<Shown>,
    /// Its bytes, while they are those of the open showing too (or it is closed).
    closed: Option<Closed>,
    used: AtomicU64,
}

impl Slot {
    fn print(&self) -> [u8; 32] {
        match (self.open.get(), &self.closed) {
            (Some(s), _) => s.print,
            (None, Some(c)) => c.print,
            (None, None) => unreachable!("a slot holds its showing"),
        }
    }

    fn tip(&self) -> Tip {
        match (self.open.get(), &self.closed) {
            (Some(s), _) => s.tip,
            (None, Some(c)) => c.tip,
            (None, None) => unreachable!("a slot holds its showing"),
        }
    }
}

/// Each entry's showing, open or closed, as the module says.
#[derive(Default)]
pub(super) struct ShownMap {
    slots: BTreeMap<EntryId, Slot>,
    clock: AtomicU64,
    /// The entries whose bytes didn't open, to judge anew (`take_spoilt`).
    spoilt: Mutex<Vec<EntryId>>,
    any_spoilt: AtomicBool,
}

impl ShownMap {
    pub(super) fn len(&self) -> usize {
        self.slots.len()
    }

    pub(super) fn clear(&mut self) {
        self.slots.clear();
    }

    pub(super) fn contains_key(&self, e: &EntryId) -> bool {
        self.slots.contains_key(e)
    }

    fn tick(&self) -> u64 {
        self.clock.fetch_add(1, Ordering::Relaxed) + 1
    }

    fn spoil(&self, e: EntryId) {
        self.spoilt.lock().expect("spoilt showings").push(e);
        self.any_spoilt.store(true, Ordering::Relaxed);
    }

    /// Entry `e`'s showing, opened where it is closed.
    pub(super) fn get(&self, e: &EntryId) -> Option<&Shown> {
        let slot = self.slots.get(e)?;
        slot.used.store(self.tick(), Ordering::Relaxed);
        if let Some(s) = slot.open.get() {
            return Some(s);
        }
        match slot.closed.as_ref()?.open() {
            Some(s) => Some(slot.open.get_or_init(|| s)),
            None => {
                self.spoil(*e);
                None
            }
        }
    }

    /// Entry `e`'s showing, open, to change: its bytes no longer stand for it.
    pub(super) fn get_mut(&mut self, e: &EntryId) -> Option<&mut Shown> {
        let now = self.tick();
        let slot = self.slots.get_mut(e)?;
        *slot.used.get_mut() = now;
        if slot.open.get().is_none() {
            match slot.closed.as_ref()?.open() {
                Some(s) => {
                    let _ = slot.open.set(s);
                }
                None => {
                    self.spoilt.get_mut().expect("spoilt showings").push(*e);
                    *self.any_spoilt.get_mut() = true;
                    return None;
                }
            }
        }
        slot.closed = None;
        slot.open.get_mut()
    }

    /// Its print and tip, open or closed, without opening it.
    pub(super) fn print(&self, e: &EntryId) -> Option<[u8; 32]> {
        self.slots.get(e).map(Slot::print)
    }

    pub(super) fn tip(&self, e: &EntryId) -> Option<Tip> {
        self.slots.get(e).map(Slot::tip)
    }

    /// It stands for tip `tip` now: of the same writes, judged as before.
    pub(super) fn set_tip(&mut self, e: &EntryId, tip: Tip) {
        if let Some(slot) = self.slots.get_mut(e) {
            if let Some(s) = slot.open.get_mut() {
                s.tip = tip;
            }
            if let Some(c) = &mut slot.closed {
                c.tip = tip;
            }
        }
    }

    /// Lets go of its scratch item, if it is open: its bytes never hold one.
    pub(super) fn drop_scratch(&mut self, e: &EntryId) {
        if let Some(s) = self.slots.get_mut(e).and_then(|slot| slot.open.get_mut()) {
            s.after.scratch = None;
        }
    }

    /// Whether it holds a scratch item: none, closed.
    pub(super) fn has_scratch(&self, e: &EntryId) -> bool {
        self.slots.get(e).and_then(|slot| slot.open.get()).is_some_and(|s| s.after.scratch.is_some())
    }

    pub(super) fn insert(&mut self, e: EntryId, s: Shown) {
        let used = AtomicU64::new(self.tick());
        self.slots.insert(e, Slot { open: OnceLock::from(s), closed: None, used });
    }

    /// A showing its shelf kept, closed till it is read.
    pub(super) fn insert_closed(&mut self, e: EntryId, c: Closed) {
        self.slots.insert(e, Slot { open: OnceLock::new(), closed: Some(c), used: AtomicU64::new(0) });
    }

    pub(super) fn remove(&mut self, e: &EntryId) -> Option<Shown> {
        let slot = self.slots.remove(e)?;
        if let Some(s) = slot.open.into_inner() {
            return Some(s);
        }
        let s = slot.closed?.open();
        if s.is_none() {
            self.spoilt.get_mut().expect("spoilt showings").push(*e);
            *self.any_spoilt.get_mut() = true;
        }
        s
    }

    pub(super) fn retain(&mut self, mut keep: impl FnMut(&EntryId) -> bool) {
        self.slots.retain(|e, _| keep(e));
    }

    pub(super) fn extend(&mut self, shown: impl IntoIterator<Item = (EntryId, Shown)>) {
        for (e, s) in shown {
            self.insert(e, s);
        }
    }

    /// Every entry, with its print and tip, opening none.
    pub(super) fn tips(&self) -> impl Iterator<Item = (&EntryId, [u8; 32], Tip)> {
        self.slots.iter().map(|(e, slot)| (e, slot.print(), slot.tip()))
    }

    /// Every showing, each opened: what a test or a check of all of them reads.
    pub(super) fn iter(&self) -> impl Iterator<Item = (&EntryId, &Shown)> {
        self.slots.keys().filter_map(|e| self.get(e).map(|s| (e, s)))
    }

    pub(super) fn values(&self) -> impl Iterator<Item = &Shown> {
        self.iter().map(|(_, s)| s)
    }

    /// Its bytes as its shelf keeps them (`Shown::kept`): those it holds closed, or the open showing's.
    pub(super) fn kept(&self, e: &EntryId, out: &mut Vec<u8>) -> Option<()> {
        use crate::encode::Encode;
        let slot = self.slots.get(e)?;
        // the tip its bytes hold is of no account: one taken again stands for its entry's tip then (`show_items`)
        match (&slot.closed, slot.open.get()) {
            (Some(c), _) => {
                c.bytes.encode(out);
                Some(())
            }
            (None, Some(s)) => s.kept(out),
            (None, None) => None,
        }
    }

    /// The entries whose bytes didn't open since it was last asked, their slots let go of: each is judged anew.
    pub(super) fn take_spoilt(&mut self) -> Vec<EntryId> {
        if !std::mem::take(self.any_spoilt.get_mut()) {
            return vec![];
        }
        let es = std::mem::take(self.spoilt.get_mut().expect("spoilt showings"));
        for e in &es {
            self.slots.remove(e);
        }
        es
    }

    /// Closes the showings read least lately till at most `window` are open beside those of `keep`, but those whose
    /// items hold changes a snapshot leaves out: how many it closed.
    pub(super) fn trim(&mut self, window: usize, keep: &HashSet<EntryId>) -> usize {
        let mut by_use: Vec<(u64, EntryId)> = self
            .slots
            .iter_mut()
            .filter(|(e, slot)| slot.open.get().is_some() && !keep.contains(e))
            .map(|(e, slot)| (*slot.used.get_mut(), *e))
            .collect();
        let open = by_use.len();
        if open <= window {
            return 0;
        }
        by_use.sort_unstable();
        let mut closed = 0;
        for (_, e) in by_use {
            if open - closed <= window {
                break;
            }
            let slot = self.slots.get_mut(&e).expect("a slot");
            if slot.closed.is_none() {
                let s = slot.open.get().expect("open");
                let Some(bytes) = s.record() else { continue };
                slot.closed = Some(Closed { print: s.print, tip: s.tip, bytes: bytes.into() });
            }
            slot.open = OnceLock::new();
            closed += 1;
        }
        closed
    }
}

impl std::ops::Index<&EntryId> for ShownMap {
    type Output = Shown;
    fn index(&self, e: &EntryId) -> &Shown {
        self.get(e).expect("a showing of the entry")
    }
}
