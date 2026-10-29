//! Boxes fetched later (`aven/db/spec/AvenDB/LazyBoxes.lean`). Of what a new device syncs, most is access bookkeeping:
//! `Keys` edits, the boxes of one key to whoever the schedule seals it to, and `Wraps` edits, the keys of an entry's
//! earlier stays wrapped under the key of its stay now. Neither changes the state: the schedule (`settle`) already
//! says what is sealed to what, and an accepted box only carries the bytes (`step_box`). So a device takes the state
//! from every edit but the boxes (`first_view`, L1), takes of the boxes only the key state it needs now, one box of
//! each current key it opens (`first_sync`), fetches an entry's wraps and the older epochs' keys with its history when
//! it opens the entry, and never one sealed to a key it can't open, which opens nothing for it (L2). A box fetched later is checked on the state of the edits before it but
//! the boxes, by the same rules as if it had come first (L3, `with_fetched`), and whatever boxes a device holds, it
//! opens a current key only if it may (T6).
//!
//! The one thing a device without the boxes can't tell is whether an edit it holds names a box edit as a parent as deep
//! as itself, which makes that edit malformed (`boxesUnder`): an honest device's depths never do. `with_fetched`
//! checks it as the boxes arrive and, where it fails, takes the replay of every edit instead.

use std::collections::HashSet;

use crate::id::{EditId, SignerId};
use crate::keys::KeyName;
use crate::policy::{replay, Action, Edit, Replay, State};

/// A box edit: the boxes of one key, or the wraps of one entry's earlier keys (`Edit.isBox`).
pub fn is_box(edit: &Edit) -> bool {
    matches!(edit.action, Action::Keys { .. } | Action::Wraps { .. })
}

/// `boxesUnder`: no edit but a box names a box edit as a parent as deep as itself.
pub fn boxes_under(edits: &crate::policy::Edits) -> bool {
    let boxes: std::collections::HashMap<EditId, u64> =
        edits.iter().filter(|e| is_box(e)).map(|e| (e.id(), e.depth)).collect();
    edits
        .iter()
        .filter(|e| !is_box(e))
        .all(|e| e.parents.iter().all(|p| boxes.get(p).is_none_or(|&d| d < e.depth)))
}

/// The replay of every edit but the boxes: what a device holding them all knows (L1), and the same edits standing but
/// the boxes.
pub fn first_view(edits: &crate::policy::Edits) -> Replay {
    let kept: Vec<Edit> = edits.iter().filter(|e| !is_box(e)).cloned().collect();
    replay(&crate::policy::EditsVec::from(kept))
}

/// A first sync's edits by their place in the edits a peer holds: what a new device takes now, and what it may fetch
/// later.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct FirstSync {
    /// Every edit but the boxes, and of the boxes the key state it needs now: for each current key it opens, one
    /// `Keys` edit with a box to a key it opens; and those that announce a seed's public half or put a public key in
    /// the clear.
    pub now: Vec<usize>,
    /// The boxes a device fetches with the history of an entry when it opens one: each entry's `Wraps`, the keys of
    /// older epochs under the next one, and any other box it opens of a key no longer current.
    pub with_history: Vec<usize>,
    /// The boxes that open nothing for it (`L2_unopenable_irrelevant`): of keys it may not open, or boxed to other
    /// devices, or a current key it already has a box of.
    pub never: Vec<usize>,
}

/// Where an edit goes in a device's first sync (`FirstSync`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Class {
    Now,
    WithHistory,
    Never,
}

/// What device `d` needs of the boxes now, by the state `st` of every edit but the boxes, edit after edit (`first_sync`
/// with a peer's edits; `Lab::withheld` with what it sends): it opens what the schedule seals to its own key, and down
/// from there, and takes one box of each current key it opens.
pub struct Needs<'a> {
    st: &'a State,
    opens: HashSet<KeyName>,
    boxed: HashSet<KeyName>,
}

impl<'a> Needs<'a> {
    pub fn new(st: &'a State, d: SignerId) -> Needs<'a> {
        Needs { st, opens: st.opens(&[KeyName::Signer(d)]), boxed: HashSet::new() }
    }

    /// Where `e` goes, the edits before it asked of already.
    pub fn class(&mut self, e: &Edit) -> Class {
        let st = self.st;
        let current = |name: &KeyName| matches!(*name, KeyName::Scoped(k, _) if st.current(k) == *name);
        match &e.action {
            Action::Keys { name, boxes, public, clear, .. } => {
                // a seed's public half (which upkeep seals to) and a public key in the clear travel now, few as they are
                let mine = self.opens.contains(name) && boxes.iter().any(|b| self.opens.contains(&b.to.name()));
                if public.is_some() || clear.is_some() || (mine && current(name) && self.boxed.insert(*name)) {
                    Class::Now
                } else if mine && !current(name) {
                    Class::WithHistory
                } else {
                    Class::Never
                }
            }
            Action::Wraps { .. } => Class::WithHistory,
            _ => Class::Now,
        }
    }
}

/// Which of `edits` device `d` takes in its first sync, with `view` the state of every edit but the boxes
/// (`first_view`): it opens what the schedule seals to its own key, and down from there.
pub fn first_sync(edits: &crate::policy::Edits, view: &Replay, d: SignerId) -> FirstSync {
    let mut needs = Needs::new(&view.state, d);
    let mut out = FirstSync::default();
    for (i, e) in edits.iter().enumerate() {
        match needs.class(e) {
            Class::Now => out.now.push(i),
            Class::WithHistory => out.with_history.push(i),
            Class::Never => out.never.push(i),
        }
    }
    out
}

/// What taking boxes fetched later gave.
#[derive(Debug)]
pub struct Fetched {
    /// The replay of the edits held and the boxes fetched.
    pub replay: Replay,
    /// Each fetched box that stands, checked on the state of the edits before it (L3).
    pub stood: Vec<EditId>,
    /// The state is the one the device took without them: every edit held named no fetched box as a parent as deep as
    /// itself (`boxesUnder`). Else the replay of every edit is what it knows from now on.
    pub same: bool,
}

/// Take the boxes `fetched` beside the edits `held`, which a device took as `first`: replay them all, and say which
/// boxes stood and whether the state is still the one it took (L1, L3).
pub fn with_fetched(held: &crate::policy::Edits, first: &Replay, fetched: &crate::policy::Edits) -> Fetched {
    let all: Vec<Edit> = held.iter().chain(fetched.iter().filter(|e| is_box(e))).cloned().collect();
    let all = crate::policy::EditsVec::from(all);
    let replay = replay(&all);
    let fetched_ids: HashSet<EditId> = fetched.iter().filter(|e| is_box(e)).map(Edit::id).collect();
    let stood = replay.standing().into_iter().filter(|id| fetched_ids.contains(id)).collect();
    let same = boxes_under(&all) && replay.state == first.state;
    Fetched { replay, stood, same }
}
