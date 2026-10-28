//! What a device shows of each entry, at most `WINDOW` of them open in memory (S6, `ShownView.lean`).
//!
//! A showing is open (its history, its items as Loro documents) or closed: the bytes a shelf keeps of it
//! (`Shown::record`), with its print and tip beside them, which it opens again as it is read. Reading one opens it;
//! `trim` closes those read least lately past the window, each of which it can keep the bytes of; one whose items hold
//! changes a snapshot leaves out stays open. A showing its shelf kept comes in closed (`insert_closed`), so an unlock
//! opens only those it reads. Closed or open, it is the same showing: it opens as the showing it closed, and judging
//! anew makes it (`SV1_open`). One whose bytes don't open is none, and the next `show_items` judges its entry anew.
//!
//! A pack of them (`pack`) holds each sealed alone, behind a sealed index of where each is, so one taken from its
//! shelf (`unpack`) is read where it is, in its pack's file, as it opens: what an unlock holds of them is their index.

use std::collections::{BTreeMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use zeroize::Zeroizing;

use super::{ENGINE, ShelfKey, Shown, Tip};
use crate::id::EntryId;
use crate::keys::SeededRng;
use crate::pages::Space;

/// How many showings stay open past a `trim` beside those it keeps open (the scratch items' entries): those read or
/// judged last.
pub(super) const WINDOW: usize = if cfg!(feature = "test-fixtures") { 8 } else { 256 };

/// A showing as its shelf keeps it (`Shown::record`), with the print and tip it stands for now.
#[derive(Clone)]
pub(super) struct Closed {
    pub(super) print: [u8; 32],
    pub(super) tip: Tip,
    bytes: Bytes,
}

/// A closed showing's bytes: in memory, or sealed in a pack on its shelf (`pack`).
#[derive(Clone)]
enum Bytes {
    Held(Arc<[u8]>),
    Packed(Arc<Packed>),
}

/// Where a showing is sealed in a pack: its pack, and its place and length there, with the key and the context it was
/// sealed under.
struct Packed {
    pack: Arc<dyn Space>,
    at: u64,
    len: u32,
    key: ShelfKey,
    context: Vec<u8>,
}

impl Packed {
    fn read(&self) -> Option<Zeroizing<Vec<u8>>> {
        let mut sealed = vec![0; self.len as usize];
        self.pack.read_at(self.at, &mut sealed).ok()?;
        self.key.unlock("kept shown", &sealed, &self.context)
    }
}

/// The tip of a showing a pack holds till `show_items` takes it, which gives it its entry's tip then.
const UNTAKEN: Tip = Tip { writes: 0, last: None, lane: [0; 32], groups: [0; 32] };

impl Closed {
    /// Its bytes (`Shown::record`).
    fn record(&self) -> Option<Zeroizing<Vec<u8>>> {
        match &self.bytes {
            Bytes::Held(b) => Some(Zeroizing::new(b.to_vec())),
            Bytes::Packed(p) => p.read(),
        }
    }

    pub(super) fn open(&self) -> Option<Shown> {
        let mut s = match &self.bytes {
            Bytes::Held(b) => Shown::of_record(b).ok()?,
            Bytes::Packed(p) => Shown::of_record(&p.read()?).ok()?,
        };
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

    /// Its bytes as its shelf keeps them (`Shown::record`): those it holds closed, or the open showing's.
    pub(super) fn record(&self, e: &EntryId) -> Option<Zeroizing<Vec<u8>>> {
        let slot = self.slots.get(e)?;
        // the tip its bytes hold is of no account: one taken again stands for its entry's tip then (`show_items`)
        match (&slot.closed, slot.open.get()) {
            (Some(c), _) => c.record(),
            (None, Some(s)) => s.record().map(Zeroizing::new),
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
                slot.closed = Some(Closed { print: s.print, tip: s.tip, bytes: Bytes::Held(bytes.into()) });
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

/// What a pack of kept showings starts with (`Warming::shown`), the version of its bytes.
const KEPT_SHOWN: &[u8] = b"avenDB kept shown 2\n";

/// What a showing in a pack is sealed under: the engine, its entry and its print, so that it opens as no other.
fn context(e: &EntryId, print: &[u8; 32]) -> Vec<u8> {
    [ENGINE.as_bytes(), &e.0, print].concat()
}

/// A pack of the showings `shown`, each its entry's, print and bytes (`Shown::record`): `KEPT_SHOWN`, the length of
/// its index and its index, sealed, of each one's entry, print, and place and length past the index, then each one
/// sealed alone.
pub(super) fn pack(key: &ShelfKey, rng: &mut SeededRng, shown: &[(EntryId, [u8; 32], Zeroizing<Vec<u8>>)]) -> Vec<u8> {
    use crate::encode::Encode;
    let mut index = Zeroizing::new(vec![]);
    (shown.len() as u32).encode(&mut index);
    let mut sealed = vec![];
    for (e, print, record) in shown {
        let one = key.lock("kept shown", record, &context(e, print), rng);
        index.extend(e.0);
        index.extend(print);
        (sealed.len() as u64).encode(&mut index);
        (one.len() as u32).encode(&mut index);
        sealed.extend(one);
    }
    let index = key.lock("kept shown index", &index, ENGINE.as_bytes(), rng);
    let mut out = KEPT_SHOWN.to_vec();
    (index.len() as u32).encode(&mut out);
    out.extend(index);
    out.extend(sealed);
    out
}

/// The showings pack `pack` holds (`pack`), by entry, each closed where it is in the pack: none of a pack that isn't
/// one, or whose index doesn't open with `key`.
pub(super) fn unpack(key: &ShelfKey, pack: &Arc<dyn Space>) -> Option<Vec<(EntryId, Closed)>> {
    use crate::wire::{Decode, Reader};
    let head = KEPT_SHOWN.len() as u64 + 4;
    let mut start = vec![0; head as usize];
    pack.read_at(0, &mut start).ok()?;
    let n = u32::from_be_bytes(start.strip_prefix(KEPT_SHOWN)?.try_into().ok()?) as u64;
    if head + n > pack.len() {
        return None;
    }
    let mut sealed = vec![0; n as usize];
    pack.read_at(head, &mut sealed).ok()?;
    let index = key.unlock("kept shown index", &sealed, ENGINE.as_bytes())?;
    let base = head + n;
    let r = &mut Reader::new(&index);
    let count = r.count(76).ok()?;
    let mut out = Vec::with_capacity(count.min(4096));
    for _ in 0..count {
        let e = EntryId::decode(r).ok()?;
        let print = <[u8; 32]>::decode(r).ok()?;
        let at = base.checked_add(u64::decode(r).ok()?)?;
        let len = u32::decode(r).ok()?;
        if at.checked_add(len as u64)? > pack.len() {
            return None;
        }
        let packed = Packed { pack: pack.clone(), at, len, key: key.clone(), context: context(&e, &print) };
        out.push((e, Closed { print, tip: UNTAKEN, bytes: Bytes::Packed(Arc::new(packed)) }));
    }
    r.done().then_some(out)
}
