//! The bytes an edit carries in bulk: a write's body and the bytes of each key box (batch 5, Log on disk, step 1).
//!
//! They are most of what a device's log of edits holds in memory: a key upkeep edit is a few boxes of over a kilobyte
//! each, and a write's body is its encrypted update. A `Bulk` holds them once, shared by every copy of its edit (the
//! signed store's and the log's), and once its store is spilled (`lab::Spill`), not in memory at all: the place of its
//! edit's record in the spill, from which it reads them back when asked, checked against the BLAKE3 hash of the record
//! as the spill checks it. It is the same bytes either way: an edit's encoding, and so its id, reads them back
//! (`encode::edit_id`), its equality and hash are of the bytes, and it changes nothing an edit says, proves or sends.

use std::borrow::Cow;
use std::fmt;
use std::hash::{Hash, Hasher};
use std::io;
use std::sync::Arc;

use crate::id::EditId;
use crate::policy::Edit;

/// What holds the record of an edit a `Bulk` reads back: a spill's file.
pub(crate) trait Source: Send + Sync {
    /// The `len` bytes at `at`.
    fn read(&self, at: u64, len: u32) -> io::Result<Vec<u8>>;
    /// The edit those bytes are the record of.
    fn edit(&self, bytes: &[u8]) -> Option<Edit>;
}

/// Where an edit's record is, which its bulk bytes are read back from.
#[derive(Clone)]
pub(crate) struct Place {
    pub(crate) source: Arc<dyn Source>,
    pub(crate) at: u64,
    pub(crate) len: u32,
    pub(crate) sum: [u8; 32],
    pub(crate) edit: EditId,
}

/// Which bulk bytes of its edit it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Part {
    Body,
    /// Its `n`th key box, as `Action::key_box` counts them.
    Box(u32),
}

/// Bytes read back from their edit's record: its place, shared by every part of the edit, which part, and how long.
#[derive(Clone)]
struct Shelved {
    place: Arc<Place>,
    part: Part,
    len: u32,
}

#[derive(Clone)]
enum Repr {
    Held(Arc<[u8]>),
    Shelved(Shelved),
}

/// The bytes an edit carries in bulk, as the module says.
#[derive(Clone)]
pub struct Bulk(Repr);

/// Bytes under this many are held in memory, shelved or not: a handle is about as big.
const SMALL: usize = 96;

impl Bulk {
    pub fn new(bytes: impl Into<Arc<[u8]>>) -> Bulk {
        Bulk(Repr::Held(bytes.into()))
    }

    /// Its bytes: at hand, or read back from its edit's record.
    pub fn bytes(&self) -> Cow<'_, [u8]> {
        match &self.0 {
            Repr::Held(b) => Cow::Borrowed(b),
            Repr::Shelved(s) => Cow::Owned(s.read()),
        }
    }

    /// Its bytes, as a value of their own.
    pub fn to_vec(&self) -> Vec<u8> {
        self.bytes().into_owned()
    }

    pub fn len(&self) -> usize {
        match &self.0 {
            Repr::Held(b) => b.len(),
            Repr::Shelved(s) => s.len as usize,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The bytes it holds in memory: none once shelved.
    pub fn heap_bytes(&self) -> usize {
        match &self.0 {
            Repr::Held(b) => b.len(),
            Repr::Shelved(_) => 0,
        }
    }

    /// It holds its bytes in memory.
    pub fn is_held(&self) -> bool {
        matches!(self.0, Repr::Held(_))
    }

    /// The same bytes, read back from `place` from now on, where they are not small.
    pub(crate) fn shelve(&mut self, place: &Arc<Place>, part: Part) {
        if let Repr::Held(b) = &self.0
            && b.len() >= SMALL
            && let Ok(len) = u32::try_from(b.len())
        {
            self.0 = Repr::Shelved(Shelved { place: place.clone(), part, len });
        }
    }
}

impl Shelved {
    fn read(&self) -> Vec<u8> {
        let p = &self.place;
        let bytes = p.source.read(p.at, p.len).unwrap_or_else(|e| panic!("avendb: its spill of edits doesn't read: {e}"));
        // as the spill reads a record back: the very bytes that went in, or a disk it can't trust
        let edit = (*blake3::hash(&bytes).as_bytes() == p.sum).then(|| p.source.edit(&bytes)).flatten();
        let edit = edit.filter(|e| e.id() == p.edit);
        let edit = edit.unwrap_or_else(|| panic!("avendb: its spill of edits changed in its folder: a disk it can't trust"));
        let bulk = match self.part {
            Part::Body => edit.action.body().cloned(),
            Part::Box(n) => edit.action.key_box(n as usize).map(|b| b.bytes.clone()),
        };
        let bulk = bulk.unwrap_or_else(|| panic!("avendb: an edit's record lacks the bulk it was shelved from"));
        let bytes = bulk.to_vec();
        assert_eq!(bytes.len(), self.len as usize, "avendb: an edit's record holds other bulk than it was shelved from");
        bytes
    }
}

impl Default for Bulk {
    fn default() -> Bulk {
        Bulk::new(Vec::new())
    }
}

impl From<Vec<u8>> for Bulk {
    fn from(bytes: Vec<u8>) -> Bulk {
        Bulk::new(bytes)
    }
}

impl From<&[u8]> for Bulk {
    fn from(bytes: &[u8]) -> Bulk {
        Bulk::new(bytes)
    }
}

impl PartialEq for Bulk {
    fn eq(&self, o: &Bulk) -> bool {
        if let (Repr::Held(a), Repr::Held(b)) = (&self.0, &o.0)
            && Arc::ptr_eq(a, b)
        {
            return true;
        }
        self.len() == o.len() && self.bytes() == o.bytes()
    }
}

impl Eq for Bulk {}

impl PartialEq<[u8]> for Bulk {
    fn eq(&self, o: &[u8]) -> bool {
        self.len() == o.len() && *self.bytes() == *o
    }
}

impl Hash for Bulk {
    fn hash<H: Hasher>(&self, h: &mut H) {
        self.bytes().hash(h);
    }
}

impl fmt::Debug for Bulk {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.0 {
            Repr::Held(b) => b.fmt(f),
            Repr::Shelved(s) => write!(f, "Bulk(shelved, {} bytes)", s.len),
        }
    }
}

impl Edit {
    /// Its bulk bytes, each read back from `place` from now on (`Bulk::shelve`): its record there.
    pub(crate) fn shelve(&mut self, place: Place) {
        let place = Arc::new(place);
        let place = &place;
        match &mut self.action {
            crate::policy::Action::Write { body, .. } => body.shelve(place, Part::Body),
            crate::policy::Action::Keys { boxes, .. } => {
                for (n, b) in boxes.iter_mut().enumerate() {
                    b.bytes.shelve(place, Part::Box(n as u32));
                }
            }
            crate::policy::Action::Wraps { wraps, .. } => {
                for (n, w) in wraps.iter_mut().enumerate() {
                    w.boxed.bytes.shelve(place, Part::Box(n as u32));
                }
            }
            _ => {}
        }
    }
}

impl crate::policy::Action {
    /// A write's body.
    pub fn body(&self) -> Option<&Bulk> {
        match self {
            crate::policy::Action::Write { body, .. } => Some(body),
            _ => None,
        }
    }
}
