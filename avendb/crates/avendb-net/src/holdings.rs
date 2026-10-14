//! Holdings (v8 phase H): one frontier each device states about itself, for its logs and its files alike
//! (`wire::Announce`). A device says what it holds for good: of each log, the frontier of the part whose whole past its
//! shelf holds, and the edits there waiting for their past; of each file, all of it or the pieces its shelf holds
//! whole. On the server that is what its bucket has taken; a node with no shelf keeps nothing past its end, and says
//! what it holds. It tells each peer only what the peer may know by its view: the logs of what it may send the peer
//! (`Lab::announce`), and the files their edits bring, which the peer may fetch (T27).
//!
//! A node keeps what each device told it, on a connection whose hello proved that device, and nothing else: no device
//! speaks for another, and a node passes on no holdings of anyone's (H1, `H1_heard_on_their_connection`,
//! `H1_passes_nothing_on`). They route, and never let anyone do anything: a node asks a peer for the logs where the
//! peer holds what it lacks, fetches a file first from the peers that hold it, and shows where each entry and each file
//! is synced to (`SyncedTo`, `H1_synced_to`); its blob gate hands a file out by T27 alone, whatever anyone holds
//! (`T27_holdings_never_authorize`).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use avendb::id::EditId;
use avendb::policy::Edit;
use avendb::sealed::FileRoot;
use avendb::sync::{LogId, log_of};
use avendb::wire::{Announce, FileHold, Frontier};

/// The most logs and files a node keeps of what one device holds: far more than any device holds. A device that
/// claims more has its claims dropped.
pub(crate) const MOST: usize = 1 << 18;

/// What a device holds for good, as it tells it (`wire::Announce`): of each log, its frontier and the edits it holds
/// waiting for their past; of each file, all of it or some of its pieces.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Holdings {
    pub logs: BTreeMap<LogId, Frontier>,
    pub files: BTreeMap<FileRoot, FileHold>,
}

impl Holdings {
    /// What a device holding these tells a peer it last told `told` on their connection: all of them on a new
    /// connection, `told` none, even if they are nothing; else what changed since, a file it no longer holds with
    /// `None`, if anything did.
    pub(crate) fn since(&self, told: Option<&Holdings>) -> Option<Announce> {
        let Some(told) = told else {
            let logs = self.logs.iter().map(|(l, f)| (*l, f.clone())).collect();
            let files = self.files.iter().map(|(r, h)| (*r, Some(h.clone()))).collect();
            return Some(Announce { full: true, logs, files });
        };
        let logs: Vec<(LogId, Frontier)> =
            self.logs.iter().filter(|(l, f)| told.logs.get(l) != Some(f)).map(|(l, f)| (*l, f.clone())).collect();
        let changed = self.files.iter().filter(|(r, h)| told.files.get(r) != Some(h));
        let mut files: BTreeMap<FileRoot, Option<FileHold>> = changed.map(|(r, h)| (*r, Some(h.clone()))).collect();
        files.extend(told.files.keys().filter(|r| !self.files.contains_key(r)).map(|r| (*r, None)));
        let changed = !logs.is_empty() || !files.is_empty();
        changed.then(|| Announce { full: false, logs, files: files.into_iter().collect() })
    }

    /// What its device holds once it told `announce`: that alone, if it tells all it holds, else that over what it
    /// told before.
    pub(crate) fn take(&mut self, announce: Announce) {
        if announce.full {
            *self = Holdings::default();
        }
        self.logs.extend(announce.logs);
        for (root, hold) in announce.files {
            match hold {
                Some(hold) => self.files.insert(root, hold),
                None => self.files.remove(&root),
            };
        }
    }

    /// Of these, those of the logs `logs` and the files `files` alone: what a peer that may know those is told.
    pub(crate) fn only(&self, logs: &BTreeSet<LogId>, files: &BTreeSet<FileRoot>) -> Holdings {
        let logs = self.logs.iter().filter(|(l, _)| logs.contains(l)).map(|(l, f)| (*l, f.clone())).collect();
        let files = self.files.iter().filter(|(r, _)| files.contains(r)).map(|(r, h)| (*r, h.clone())).collect();
        Holdings { logs, files }
    }
}

/// Where each entry and each file a device holds is synced to, by holdings (`Node::synced_to`): the devices that hold
/// every edit of the entry's log the device holds, or every sealed byte of the file, and those that hold some of the
/// file's pieces, by their own word and the device's own shelf, among those that may hold it by the device's view;
/// each list smallest first. The world the engine shows names them (avendb's `world`).
pub use avendb::world::SyncedTo;

/// One log of a device's edits: where its edits are among them, its frontier and waiting edits, and the files they
/// bring.
pub(crate) struct Log {
    pub(crate) edits: Vec<usize>,
    pub(crate) frontier: Frontier,
    pub(crate) files: BTreeSet<FileRoot>,
}

/// A device's edits by their logs (`sync::log_of`), as they were when it held `size` (`Lab::size`): each log as `Log`
/// says, where each edit is among them, and the edits of every closed part, whose whole past in their log it holds.
pub(crate) struct Logs {
    pub(crate) size: (usize, usize),
    pub(crate) of: BTreeMap<LogId, Log>,
    pub(crate) at: HashMap<EditId, usize>,
    pub(crate) closed: HashSet<EditId>,
}

impl Logs {
    /// The logs of `edits`, `ids[i]` being `edits[i]`'s id, cut as `sync` cuts them: an edit is in its log's closed
    /// part once each of its parents is, and a parent the log doesn't hold keeps it waiting.
    pub(crate) fn of(edits: &[Edit], ids: &[EditId], size: (usize, usize)) -> Logs {
        let mut at = HashMap::with_capacity(ids.len());
        let mut grouped: BTreeMap<LogId, Vec<usize>> = BTreeMap::new();
        for (i, (edit, &id)) in edits.iter().zip(ids).enumerate() {
            if at.insert(id, i).is_some() {
                continue;
            }
            if let Some(l) = log_of(edit, id) {
                grouped.entry(l).or_default().push(i);
            }
        }
        let mut closed = HashSet::new();
        let mut of = BTreeMap::new();
        for (l, places) in grouped {
            let (frontier, done) = frontier(edits, ids, &places);
            let files = places.iter().flat_map(|&i| edits[i].files().iter().copied()).collect();
            closed.extend(done);
            of.insert(l, Log { edits: places, frontier, files });
        }
        Logs { size, of, at, closed }
    }

    /// The frontier of each log.
    pub(crate) fn frontiers(&self) -> BTreeMap<LogId, Frontier> {
        self.of.iter().map(|(l, log)| (*l, log.frontier.clone())).collect()
    }

    /// A device that holds `theirs` of a log holds an edit of it that this one lacks: a head outside this one's
    /// closed parts, which this one lacks or holds without the whole past the device holds of it, or a waiting edit
    /// this one doesn't hold.
    pub(crate) fn lacks(&self, theirs: &Frontier) -> bool {
        theirs.heads.iter().any(|h| !self.closed.contains(h)) || theirs.waiting.iter().any(|w| !self.at.contains_key(w))
    }

    /// A device that holds `theirs` of log `l` holds every edit of it this one holds, `edits` being this one's edits:
    /// each is one of its heads or waiting edits, or one its heads build on, as far as this one's edits show it.
    pub(crate) fn covered(&self, edits: &[Edit], l: &LogId, theirs: &Frontier) -> bool {
        let Some(log) = self.of.get(l) else { return true };
        if log.frontier == *theirs {
            return true;
        }
        let in_log: HashSet<usize> = log.edits.iter().copied().collect();
        let mut seen: HashSet<EditId> = theirs.heads.iter().copied().collect();
        let mut stack = theirs.heads.clone();
        while let Some(id) = stack.pop() {
            let Some(&i) = self.at.get(&id).filter(|i| in_log.contains(i)) else { continue };
            stack.extend(edits[i].parents.iter().filter(|p| seen.insert(**p)));
        }
        let waiting: HashSet<&EditId> = theirs.waiting.iter().collect();
        log.frontier.heads.iter().all(|h| seen.contains(h))
            && log.frontier.waiting.iter().all(|w| seen.contains(w) || waiting.contains(w))
    }
}

/// The frontier of the log whose edits are at `places` among `edits`, `ids[i]` being `edits[i]`'s id, and its closed
/// part: as `sync` works them out, so that a device's holdings of a log agree with its digest.
fn frontier(edits: &[Edit], ids: &[EditId], places: &[usize]) -> (Frontier, HashSet<EditId>) {
    let by_id: HashMap<EditId, usize> = places.iter().map(|&i| (ids[i], i)).collect();
    let mut waiting: HashMap<EditId, usize> = HashMap::new();
    let mut children: HashMap<EditId, Vec<EditId>> = HashMap::new();
    let mut ready = vec![];
    for (&id, &i) in &by_id {
        let parents: HashSet<EditId> = edits[i].parents.iter().copied().collect();
        if parents.iter().any(|p| !by_id.contains_key(p)) {
            continue;
        }
        if parents.is_empty() {
            ready.push(id);
        }
        waiting.insert(id, parents.len());
        for p in parents {
            children.entry(p).or_default().push(id);
        }
    }
    let mut closed = HashSet::new();
    while let Some(id) = ready.pop() {
        if !closed.insert(id) {
            continue;
        }
        for c in children.get(&id).into_iter().flatten() {
            let n = waiting.get_mut(c).expect("a child waits");
            *n -= 1;
            if *n == 0 {
                ready.push(*c);
            }
        }
    }
    let built_on: HashSet<EditId> = closed.iter().flat_map(|id| edits[by_id[id]].parents.iter().copied()).collect();
    let mut heads: Vec<EditId> = closed.iter().copied().filter(|id| !built_on.contains(id)).collect();
    heads.sort();
    let mut waiting: Vec<EditId> = by_id.keys().copied().filter(|id| !closed.contains(id)).collect();
    waiting.sort();
    (Frontier { heads, waiting }, closed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use avendb::cast::*;
    use avendb::id::EntryId;
    use avendb::sync::{closed_part, frontiers};
    use avendb::wire::Wire;

    #[test]
    fn a_devices_holdings_of_each_log_are_its_frontier_and_waiting_edits_as_sync_cuts_them() {
        let mut w = world();
        let h = handbook(&mut w);
        w.lab.sync_all(1);
        let (edits, ids) = (w.lab.log(w.mac_b).edits(), w.lab.log(w.mac_b).ids());
        let logs = Logs::of(edits, ids, w.lab.size(w.mac_b));
        assert!(logs.of.contains_key(&LogId::Entry(h.welcome)), "Welcome's log among them");
        let heads: BTreeMap<LogId, Vec<EditId>> = logs.of.iter().map(|(l, x)| (*l, x.frontier.heads.clone())).collect();
        assert_eq!(heads, frontiers(edits), "each log's heads are its frontier");
        // with the first edit of Welcome's log gone, the rest of it waits for its past
        let first = logs.of[&LogId::Entry(h.welcome)].edits[0];
        let rest: Vec<Edit> = edits.iter().enumerate().filter(|(i, _)| *i != first).map(|(_, e)| e.clone()).collect();
        let rest_ids: Vec<EditId> = rest.iter().map(Edit::id).collect();
        let cut = Logs::of(&rest, &rest_ids, (0, 0));
        let welcome = &cut.of[&LogId::Entry(h.welcome)].frontier;
        assert!(welcome.heads.is_empty() && !welcome.waiting.is_empty(), "none of it closed");
        let closed = closed_part(&rest, LogId::Entry(h.welcome));
        assert!(welcome.waiting.iter().all(|id| !closed.contains(id)), "what waits is outside the closed part");
        assert!(cut.lacks(&logs.of[&LogId::Entry(h.welcome)].frontier), "the whole log has what the cut one lacks");
        assert!(!logs.lacks(welcome), "and the cut one nothing the whole one lacks");
        assert!(logs.covered(edits, &LogId::Entry(h.welcome), &logs.of[&LogId::Entry(h.welcome)].frontier));
        assert!(!logs.covered(edits, &LogId::Entry(h.welcome), welcome), "the cut log doesn't cover the whole");
    }

    #[test]
    fn an_announcement_tells_all_on_a_new_connection_and_then_only_what_changed() {
        let (a, b) = (LogId::Entry(EntryId([1; 32])), LogId::Entry(EntryId([2; 32])));
        let at = |n: u8| Frontier { heads: vec![EditId([n; 32])], waiting: vec![] };
        let (photo, scan) = (FileRoot { hash: [3; 32], size: 16 }, FileRoot { hash: [4; 32], size: 16 });
        let before = Holdings {
            logs: [(a, at(1)), (b, at(2))].into(),
            files: [(photo, FileHold::Whole), (scan, FileHold::Whole)].into(),
        };
        let full = before.since(None).expect("all of it");
        assert!(full.full && full.logs.len() == 2 && full.files.len() == 2);
        assert_eq!(Holdings::default().since(None).map(|a| a.full), Some(true), "even nothing, on a new connection");
        assert_eq!(before.since(Some(&before)), None, "nothing changed: nothing to tell");
        let after = Holdings { logs: [(a, at(1)), (b, at(5))].into(), files: [(photo, FileHold::Whole)].into() };
        let changed = after.since(Some(&before)).expect("what changed");
        assert_eq!(changed, Announce { full: false, logs: vec![(b, at(5))], files: vec![(scan, None)] });
        let mut heard = Holdings::default();
        heard.take(Announce::from_wire(&full.to_wire()).expect("its bytes"));
        heard.take(changed);
        assert_eq!(heard, after, "what was told adds up to what it holds");
        heard.take(Announce { full: true, ..Announce::default() });
        assert_eq!(heard, Holdings::default(), "and all of it, told again, stands in for what was told before");
        let only = after.only(&[b].into(), &BTreeSet::new());
        assert_eq!(only, Holdings { logs: [(b, at(5))].into(), files: BTreeMap::new() });
    }
}
