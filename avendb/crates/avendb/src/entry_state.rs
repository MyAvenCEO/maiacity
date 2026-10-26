//! One entry state (`EntryState.lean`, P6 of the sync v2 plan): a device keeps the edits it holds and its stored view,
//! nothing else, and each entry it holds is full (opened from its whole log) or based (its owners' newest standing
//! snapshot that isn't stale, `snapshot::start_states`, with the edits of its log the snapshot hadn't seen replayed on
//! top). The state is worked out from the history alone, so two devices holding the same edits hold every entry in the
//! same state.

use std::collections::HashMap;

use crate::id::{EditId, EntryId};
use crate::policy::{Edit, Slice, Stated};
use crate::sealed::FileRoot;
use crate::snapshot::{Taken, seen_of, start_states};
use crate::sync::{LogId, log_of};

/// An entry's one state (`EntryState`): full, or based on the snapshot `id`, which states `stated`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EntryState {
    Full,
    Based { id: EditId, stated: Stated },
}

impl EntryState {
    pub fn is_based(&self) -> bool {
        matches!(self, EntryState::Based { .. })
    }
}

/// Entry `e`'s state for a device holding `edits`, with the slices it opened by root (`entryState`).
pub fn entry_state(edits: &[Edit], slices: &HashMap<FileRoot, Slice>, e: EntryId) -> EntryState {
    based(&start_states(edits, slices), e)
}

/// Entry `e`'s state among the states a device starts from, worked out once for many entries.
pub fn based(taken: &[Taken<'_>], e: EntryId) -> EntryState {
    match taken.iter().find(|t| t.stated.entry == e) {
        Some(t) => EntryState::Based { id: t.id, stated: t.stated.clone() },
        None => EntryState::Full,
    }
}

/// The edits of entry `e`'s log (`logOf`).
pub fn log_edits(edits: &[Edit], e: EntryId) -> Vec<&Edit> {
    let mine = Some(LogId::Entry(e));
    edits.iter().filter(|o| log_of(o, o.id()) == mine).collect()
}

/// The edits of entry `e`'s log a device replays to open it (`needs`): every one when full, those its snapshot hadn't
/// seen when based.
pub fn needs<'a>(edits: &'a [Edit], state: &EntryState, e: EntryId) -> Vec<&'a Edit> {
    let log = log_edits(edits, e);
    match state {
        EntryState::Full => log,
        EntryState::Based { stated, .. } => {
            let seen = seen_of(edits, stated);
            log.into_iter().filter(|o| !seen.contains(&o.id())).collect()
        }
    }
}
