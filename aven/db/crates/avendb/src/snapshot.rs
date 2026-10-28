//! Snapshots (`Snapshot.lean`): a vault's owners' word on the state of each of its entries, so a device takes an
//! entry's slice instead of replaying its log. A device takes a state only from a snapshot that stands, only scoped to
//! the snapshot's vault and its entry (`Slice::within`), and not where a removal stands after it outside the entry's
//! log (`stale`); a device that holds the history checks each state against it (`honest`). A slice travels as a file
//! sealed under its entry's key, which the snapshot names by its root, so every function here takes the slices opened
//! so far, by root, and passes over a state whose slice it lacks.

use std::collections::{HashMap, HashSet};

use crate::id::{EditId, VaultId};
use crate::policy::{order, replay, view, Action, Edit, Slice, Stated, State};
use crate::sealed::FileRoot;
use crate::sync::{log_of, LogId};

/// A state a device takes: the snapshot `edit` (its id `id`) of vault `vault` stated it, its slice `slice`.
#[derive(Clone, Debug)]
pub struct Taken<'a> {
    pub id: EditId,
    pub edit: &'a Edit,
    pub vault: VaultId,
    pub stated: &'a Stated,
    pub slice: &'a Slice,
}

/// The edits of entry `x.entry`'s log the snapshot had seen (`seenOf`): its basis and all it builds on.
pub fn seen_of(edits: &[Edit], x: &Stated) -> HashSet<EditId> {
    let by: HashMap<EditId, &Edit> = edits.iter().map(|e| (e.id(), e)).collect();
    let mut seen = HashSet::new();
    let mut todo = x.basis.clone();
    while let Some(id) = todo.pop() {
        if seen.insert(id) {
            todo.extend(by.get(&id).into_iter().flat_map(|e| e.parents.iter().copied()));
        }
    }
    seen
}

/// The edits a state of snapshot `c` rests on (`pastOf`): of its entry's log the ones it had seen, of every other log
/// the ones that sort before it.
pub fn past_of(edits: &[Edit], c: &Edit, x: &Stated) -> Vec<Edit> {
    let seen = seen_of(edits, x);
    let mine = Some(LogId::Entry(x.entry));
    edits
        .iter()
        .filter(|o| {
            let id = o.id();
            if log_of(o, id) == mine { seen.contains(&id) } else { o.depth < c.depth }
        })
        .cloned()
        .collect()
}

/// A state of snapshot `c` is honest toward `edits` (`honest`): each edit of its basis is held, of its entry's log, and
/// comes before it, and its slice is what the edits it rests on make of its entry.
pub fn honest(edits: &[Edit], c: &Edit, x: &Stated, slice: &Slice) -> bool {
    let mine = Some(LogId::Entry(x.entry));
    let held = |b: &EditId| edits.iter().any(|o| o.id() == *b && log_of(o, *b) == mine && o.depth < c.depth);
    x.basis.iter().all(held) && view(&past_of(edits, c, x)).slice_of(x.entry) == *slice
}

/// The states a device holding `edits` takes (`statedIn`): of each snapshot that stands, with its vault, the states
/// scoped to it whose slices `slices` holds.
pub fn stated_in<'a>(edits: &'a [Edit], slices: &'a HashMap<FileRoot, Slice>) -> Vec<Taken<'a>> {
    let standing: HashSet<EditId> = replay(edits).standing().into_iter().collect();
    let mut out = vec![];
    for edit in edits {
        let Action::Snapshot { vault, states } = &edit.action else { continue };
        let id = edit.id();
        if !standing.contains(&id) {
            continue;
        }
        for x in states {
            if let Some(slice) = slices.get(&x.slice).filter(|sl| sl.within(x.entry, *vault)) {
                out.push(Taken { id, edit, vault: *vault, stated: x, slice });
            }
        }
    }
    out
}

/// The lies a device holding the history finds (`lies`): each snapshot and entry whose state isn't honest.
pub fn lies(edits: &[Edit], slices: &HashMap<FileRoot, Slice>) -> Vec<(EditId, crate::id::EntryId)> {
    let taken = stated_in(edits, slices);
    taken.iter().filter(|t| !honest(edits, t.edit, t.stated, t.slice)).map(|t| (t.id, t.stated.entry)).collect()
}

/// A removal stands after snapshot `c`, outside its entry's log (`stale`): what it took away may change the entry's
/// state, which the snapshot hadn't seen, so a device opens the entry from its history.
pub fn stale(edits: &[Edit], standing: &HashSet<EditId>, c: &Edit, x: &Stated) -> bool {
    let mine = Some(LogId::Entry(x.entry));
    edits.iter().any(|o| {
        let id = o.id();
        o.is_removal() && standing.contains(&id) && log_of(o, id) != mine && c.depth <= o.depth
    })
}

/// The states a device starting from `edits` takes (`startStates`): the latest standing one of each entry that isn't
/// stale.
pub fn start_states<'a>(edits: &'a [Edit], slices: &'a HashMap<FileRoot, Slice>) -> Vec<Taken<'a>> {
    let standing: HashSet<EditId> = replay(edits).standing().into_iter().collect();
    let ok: Vec<Taken<'a>> =
        stated_in(edits, slices).into_iter().filter(|t| !stale(edits, &standing, t.edit, t.stated)).collect();
    let later = |t: &Taken| ok.iter().any(|u| u.stated.entry == t.stated.entry && t.edit.depth < u.edit.depth);
    ok.iter().filter(|t| !later(t)).cloned().collect()
}

/// What a device knows starting from snapshots (`startView`): the edits of every log but the taken entries' replayed,
/// each taken state put in place, then each taken entry's edits its snapshot hadn't seen replayed on top, a refused
/// one changing nothing.
pub fn start_view(edits: &[Edit], slices: &HashMap<FileRoot, Slice>) -> State {
    let taken = start_states(edits, slices);
    let seen: Vec<HashSet<EditId>> = taken.iter().map(|t| seen_of(edits, t.stated)).collect();
    let mine = |o: &Edit| {
        let log = log_of(o, o.id());
        taken.iter().position(|t| log == Some(LogId::Entry(t.stated.entry)))
    };
    let base: Vec<Edit> = edits.iter().filter(|o| mine(o).is_none()).cloned().collect();
    let mut st = taken.iter().fold(view(&base), |st, t| st.with_slice(t.stated.entry, t.slice));
    let past: Vec<Edit> =
        edits.iter().filter(|o| mine(o).is_some_and(|i| !seen[i].contains(&o.id()))).cloned().collect();
    for o in order(&past) {
        let _ = st.step_mut(&o, o.id());
    }
    st
}

/// What a full copy checks of a start (`startsRight`): every entry a device takes from snapshots is as the history
/// makes it.
pub fn starts_right(edits: &[Edit], slices: &HashMap<FileRoot, Slice>) -> bool {
    let (start, full) = (start_view(edits, slices), view(edits));
    start_states(edits, slices).iter().all(|t| start.slice_of(t.stated.entry) == full.slice_of(t.stated.entry))
}

/// A device that holds `held` and whose peers hold `edits` was away too long when more than `most` of their edits are
/// new to it (`awayTooLong`): it then starts from snapshots over `edits`, and what it held counts for nothing.
pub fn away_too_long(held: &HashSet<EditId>, edits: &[Edit], most: usize) -> bool {
    edits.iter().filter(|o| !held.contains(&o.id())).count() > most
}
