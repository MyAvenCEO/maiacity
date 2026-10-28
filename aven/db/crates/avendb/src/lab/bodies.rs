//! The bodies of the writes a device opened (`read`), and how it reads them (`StoredReadings.lean`).
//!
//! A body is opened as `read` comes to it, or, of the writes a stored view says it opened before (`StoredReadings`),
//! the first time something asks for it (`Bodies::get`, RR3): an unlock reads on from what its view read and opens no
//! body it doesn't ask for (an iPhone's unlock opened all 113k again each time, 27.2 s, 2026-10-28). Opened late, a
//! body is the very body opened then: the edit's sealed bytes, under its entry's key, which the device still holds.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::sync::atomic::{AtomicU64, Ordering};

use super::{Keyring, entry_key_of, held};
use crate::encode::write_context;
use crate::id::EditId;
use crate::keys::{self, KeyId, KeyName, Secret};
use crate::policy::{Action, State};
use crate::slice::Body;
use crate::wire::Wire as _;

/// The bodies of the writes a device opened: each opened, or one its stored view says it opened, opened again when
/// first asked for.
#[derive(Default)]
pub(super) struct Bodies {
    open: HashMap<EditId, Body>,
    closed: HashMap<EditId, OnceLock<Option<Body>>>,
    /// How many of those it opened again as they were asked for.
    late: AtomicU64,
    /// The entry keys it derived to open them, by their ids, each derived once (as `read` keeps those it derives).
    derived: Mutex<HashMap<KeyId, Secret>>,
}

/// What a body of `Bodies` opens with: the device's signed edits, its keys and its replay, as `read` opens one.
#[derive(Clone, Copy)]
pub(super) struct Opener<'a> {
    pub(super) signed: &'a held::Signeds,
    pub(super) keys: &'a Keyring,
    pub(super) st: &'a State,
}

impl Opener<'_> {
    /// The body of write `id`, opened as `read` opens it, if it does, an entry key it derives kept in `derived`.
    fn open(&self, id: &EditId, derived: &Mutex<HashMap<KeyId, Secret>>) -> Option<Body> {
        let signed = self.signed.get(id)?;
        let edit = &signed.edit;
        let Action::Write { entry, stay, epoch, body, .. } = &edit.action else { return None };
        let bytes = body.bytes();
        let key = keys::edit_key(&bytes)?;
        let name = KeyName::Entry(*entry, *stay, *epoch);
        let key = match self.keys.get(&key, name) {
            Some(k) => k.clone(),
            None => {
                let kept = derived.lock().expect("derived").get(&key).cloned();
                match kept {
                    Some(k) => k,
                    None => {
                        let k = entry_key_of(self.keys, self.st, name, key, Some(edit.author))?.0;
                        derived.lock().expect("derived").insert(key, k.clone());
                        k
                    }
                }
            }
        };
        keys::open_edit(&key, &bytes, &write_context(edit)).and_then(|plain| Body::from_wire(&plain).ok())
    }
}

impl Bodies {
    pub(super) fn len(&self) -> usize {
        self.open.len() + self.closed.len()
    }

    /// It opened write `id`'s body, or its view says it did.
    pub(super) fn contains_key(&self, id: &EditId) -> bool {
        self.open.contains_key(id) || self.closed.contains_key(id)
    }

    pub(super) fn insert(&mut self, id: EditId, body: Body) {
        self.closed.remove(&id);
        self.open.insert(id, body);
    }

    pub(super) fn remove(&mut self, id: &EditId) {
        self.closed.remove(id);
        self.open.remove(id);
    }

    pub(super) fn clear(&mut self) {
        self.open.clear();
        self.closed.clear();
        self.derived.lock().expect("derived").clear();
    }

    /// Writes `ids`, whose bodies a stored view says it opened (`StoredReadings`): each opened when first asked for.
    pub(super) fn close(&mut self, ids: impl IntoIterator<Item = EditId>) {
        for id in ids.into_iter().filter(|id| !self.open.contains_key(id)) {
            self.closed.insert(id, OnceLock::new());
        }
    }

    /// The ids of the writes it opened, or its view says it did, in no order.
    pub(super) fn ids(&self) -> impl Iterator<Item = &EditId> {
        self.open.keys().chain(self.closed.keys())
    }

    /// The bodies it holds opened now, those not yet asked for left out.
    pub(super) fn held(&self) -> impl Iterator<Item = &Body> {
        self.open.values().chain(self.closed.values().filter_map(|cell| cell.get()?.as_ref()))
    }

    /// How many bodies it opened again as they were asked for.
    pub(super) fn opened_late(&self) -> u64 {
        self.late.load(Ordering::Relaxed)
    }

    /// Write `id`'s body, opened with `with` the first time it is asked for where its view said it opened.
    pub(super) fn get<'a>(&'a self, id: &EditId, with: &Opener<'_>) -> Option<&'a Body> {
        if let Some(b) = self.open.get(id) {
            return Some(b);
        }
        let cell = self.closed.get(id)?;
        cell.get_or_init(|| {
            self.late.fetch_add(1, Ordering::Relaxed);
            let body = with.open(id, &self.derived);
            debug_assert!(body.is_some(), "a body its view said it opened doesn't open: {id:?}");
            body
        })
        .as_ref()
    }

    /// Every body it opened, or its view says it did, each opened as `get` opens it.
    pub(super) fn iter<'a>(&'a self, with: Opener<'a>) -> impl Iterator<Item = (&'a EditId, &'a Body)> + 'a {
        self.ids().filter_map(move |id| Some((id, self.get(id, &with)?)))
    }
}

/// The bodies of a device's writes as judging and showing read them: a store's (`Bodies`, each opened as asked for),
/// or a few of its own a caller holds.
pub(crate) trait BodyOf {
    fn body(&self, id: &EditId) -> Option<&Body>;
    /// It opened write `id`'s body, whether or not it is asked for yet.
    fn has(&self, id: &EditId) -> bool;
}

impl BodyOf for HashMap<EditId, Body> {
    fn body(&self, id: &EditId) -> Option<&Body> {
        self.get(id)
    }
    fn has(&self, id: &EditId) -> bool {
        self.contains_key(id)
    }
}

/// A store's bodies, with what opens them.
pub(super) struct StoreBodies<'a> {
    pub(super) bodies: &'a Bodies,
    pub(super) with: Opener<'a>,
}

impl BodyOf for StoreBodies<'_> {
    fn body(&self, id: &EditId) -> Option<&Body> {
        self.bodies.get(id, &self.with)
    }
    fn has(&self, id: &EditId) -> bool {
        self.bodies.contains_key(id)
    }
}
