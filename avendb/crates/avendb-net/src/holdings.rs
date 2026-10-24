//! Holdings (v8 phase H): one frontier each device states about itself, for its logs and its files alike
//! (`wire::Announce`). A device says what it holds for good: of each log, the frontier of the part whose whole past its
//! shelf holds, and the edits there waiting for their past; of each file, all of it or the pieces its shelf holds
//! whole. On the server that is what its bucket has taken; a node with no shelf keeps nothing past its end, and says
//! what it holds. It tells each peer only what the peer may know by its view: the logs of what it may send the peer
//! (`Lab::announce`), and the files their edits bring, which the peer may fetch (T27).
//!
//! A node keeps what each device told it, on a connection whose hello proved that device, and nothing else: no device
//! speaks for another, and a node announces no holdings of anyone's (H1, `H1_heard_on_their_connection`,
//! `H1_passes_nothing_on`); what it passes on is only what a device signed itself (H2, `statements`). They route, and never let anyone do anything: a node asks a peer for the logs where the
//! peer holds what it lacks, fetches a file first from the peers that hold it, and shows where each entry and each file
//! is synced to (`SyncedTo`, `H1_synced_to`); its blob gate hands a file out by T27 alone, whatever anyone holds
//! (`T27_holdings_never_authorize`).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use avendb::id::EditId;
use avendb::policy::{Edit, LogRevision};
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
        // Delta announcements cannot remove log entries. When permission/scope shrinks, replace the peer's
        // previous view instead of leaving stale holdings for logs it is no longer being told about.
        let told = told.filter(|before| before.logs.keys().all(|log| self.logs.contains_key(log)));
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
        let logs = logs.iter().filter_map(|l| self.logs.get(l).map(|f| (*l, f.clone()))).collect();
        let files = files.iter().filter_map(|r| self.files.get(r).map(|h| (*r, h.clone()))).collect();
        Holdings { logs, files }
    }
}

/// Where each entry and each file a device holds is synced to, by holdings (`Node::synced_to`): one list for entries
/// and files alike, of the devices that hold some of it by their own word and the device's own shelf, among those that
/// may hold it by the device's view, each with how much it holds (`Holder`), smallest first. The world the engine
/// shows names them (avendb's `world`).
pub use avendb::world::{Holder, SyncedTo};

/// One log of a device's edits: where its edits are among them, its frontier and waiting edits, and the files they
/// bring.
#[derive(Clone)]
pub(crate) struct Log {
    pub(crate) edits: Vec<usize>,
    pub(crate) frontier: Frontier,
    pub(crate) files: BTreeSet<FileRoot>,
    graph: Graph,
}

/// Incremental closed-part calculation for one log. Missing parents retain their children until they arrive;
/// closing a gap visits only the waiting descendants, never unrelated logs or the already closed history.
#[derive(Clone, Default)]
struct Graph {
    closed: HashSet<EditId>,
    heads: BTreeSet<EditId>,
    waiting: BTreeMap<EditId, usize>,
    children: HashMap<EditId, Vec<EditId>>,
}

impl Graph {
    fn add(&mut self, id: EditId, edit: &Edit, edits: &[Edit], at: &HashMap<EditId, usize>) -> Vec<EditId> {
        let parents: HashSet<EditId> = edit.parents.iter().copied().collect();
        let missing: Vec<EditId> = parents.into_iter().filter(|p| !self.closed.contains(p)).collect();
        self.waiting.insert(id, missing.len());
        for parent in &missing {
            self.children.entry(*parent).or_default().push(id);
        }
        let mut ready = if missing.is_empty() { vec![id] } else { vec![] };
        let mut closed = vec![];
        while let Some(id) = ready.pop() {
            if !self.closed.insert(id) { continue; }
            self.waiting.remove(&id);
            self.heads.insert(id);
            for parent in &edits[at[&id]].parents { self.heads.remove(parent); }
            closed.push(id);
            for child in self.children.remove(&id).into_iter().flatten() {
                let count = self.waiting.get_mut(&child).expect("a child waits for its parent");
                *count -= 1;
                if *count == 0 { ready.push(child); }
            }
        }
        closed
    }

    fn frontier(&self) -> Frontier {
        Frontier { heads: self.heads.iter().copied().collect(), waiting: self.waiting.keys().copied().collect() }
    }
}

/// A device's edits by their logs (`sync::log_of`), as they were when it held `size` (`Lab::size`): each log as `Log`
/// says, where each edit is among them, and the edits of every closed part, whose whole past in their log it holds.
#[derive(Clone)]
pub(crate) struct Logs {
    pub(crate) size: (usize, usize),
    pub(crate) of: BTreeMap<LogId, Log>,
    pub(crate) at: HashMap<EditId, usize>,
    pub(crate) closed: HashSet<EditId>,
    indexed: usize,
    revision: Option<LogRevision>,
    lineage: Option<LogRevision>,
}

impl Logs {
    /// The logs of `edits`, `ids[i]` being `edits[i]`'s id, cut as `sync` cuts them: an edit is in its log's closed
    /// part once each of its parents is, and a parent the log doesn't hold keeps it waiting.
    pub(crate) fn of(edits: &[Edit], ids: &[EditId], size: (usize, usize)) -> Logs {
        let mut logs = Logs { size, of: BTreeMap::new(), at: HashMap::new(), closed: HashSet::new(), indexed: 0, revision: None, lineage: None };
        logs.extend(edits, ids, size);
        logs
    }

    pub(crate) fn current(&self, log: &avendb::policy::Log, size: (usize, usize)) -> bool {
        self.size == size && self.revision.as_ref() == Some(&log.revision())
    }

    /// Extend a real device log, rebuilding after a checkpoint withdrawal, replacement, or clone. Log length
    /// alone cannot detect a removal followed by an append of the same count.
    pub(crate) fn update(&mut self, log: &avendb::policy::Log, size: (usize, usize)) {
        let revision = log.revision();
        if self.revision.as_ref() != Some(&revision) {
            let lineage = log.lineage();
            if self.lineage.as_ref() == Some(&lineage) {
                self.extend(log.edits(), log.ids(), size);
            } else {
                *self = Self::of(log.edits(), log.ids(), size);
            }
            self.revision = Some(revision);
            self.lineage = Some(lineage);
        }
        self.size = size;
    }

    /// Update an append-only sequence. Callers with a mutable device log must use `update` instead.
    /// `size` also includes keys, which require no re-indexing when no edit was appended.
    pub(crate) fn extend(&mut self, edits: &[Edit], ids: &[EditId], size: (usize, usize)) {
        assert_eq!(edits.len(), ids.len());
        assert!(self.indexed <= ids.len(), "a node's edit log is append-only");
        let mut changed = BTreeSet::new();
        for i in self.indexed..ids.len() {
            let id = ids[i];
            if self.at.contains_key(&id) { continue; }
            self.at.insert(id, i);
            let Some(l) = log_of(&edits[i], id) else { continue };
            let log = self.of.entry(l).or_insert_with(|| Log {
                edits: vec![], frontier: Frontier { heads: vec![], waiting: vec![] }, files: BTreeSet::new(), graph: Graph::default(),
            });
            log.edits.push(i);
            log.files.extend(edits[i].files().iter().copied());
            self.closed.extend(log.graph.add(id, &edits[i], edits, &self.at));
            changed.insert(l);
        }
        for l in changed {
            let log = self.of.get_mut(&l).expect("a changed log");
            log.frontier = log.graph.frontier();
        }
        self.indexed = ids.len();
        self.size = size;
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

    /// How many of this one's edits of log `l` a device that holds `theirs` of it holds, `edits` being this one's
    /// edits, and of how many: those that are one of its heads or waiting edits, or one its heads build on, as far as
    /// this one's edits show it. It holds all of them when it covers the log: when each head of this one's frontier is
    /// one of its heads or one they build on, and so is each edit this one holds waiting, unless it holds it waiting
    /// too (`covers` in the model); short of that, one fewer at most.
    pub(crate) fn held(&self, edits: &[Edit], l: &LogId, theirs: &Frontier) -> (u64, u64) {
        let Some(log) = self.of.get(l) else { return (0, 0) };
        let of = log.edits.len() as u64;
        if log.frontier == *theirs {
            return (of, of);
        }
        let in_log: HashSet<usize> = log.edits.iter().copied().collect();
        let mut seen: HashSet<EditId> = theirs.heads.iter().copied().collect();
        let mut stack = theirs.heads.clone();
        while let Some(id) = stack.pop() {
            let Some(&i) = self.at.get(&id).filter(|i| in_log.contains(i)) else { continue };
            stack.extend(edits[i].parents.iter().filter(|p| seen.insert(**p)));
        }
        let waiting: HashSet<&EditId> = theirs.waiting.iter().collect();
        let covered = log.frontier.heads.iter().all(|h| seen.contains(h))
            && log.frontier.waiting.iter().all(|w| seen.contains(w) || waiting.contains(w));
        if covered {
            return (of, of);
        }
        let holds: HashSet<&EditId> = seen.iter().chain(theirs.waiting.iter()).collect();
        let has = holds.into_iter().filter(|id| self.at.get(*id).is_some_and(|i| in_log.contains(i))).count() as u64;
        (has.min(of - 1), of)
    }
}

/// The frontier of the log whose edits are at `places` among `edits`, `ids[i]` being `edits[i]`'s id, and its closed
/// part: as `sync` works them out, so that a device's holdings of a log agree with its digest.
#[cfg(test)]
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
    fn narrowing_announced_scope_replaces_previously_advertised_logs() {
        let a = LogId::Entry(EntryId([1; 32]));
        let b = LogId::Entry(EntryId([2; 32]));
        let head = Frontier { heads: vec![EditId([3; 32])], waiting: vec![] };
        let before = Holdings { logs: [(a, head.clone()), (b, head)].into(), files: BTreeMap::new() };
        let after = before.only(&[b].into(), &BTreeSet::new());
        let update = after.since(Some(&before)).expect("scope changed");
        assert!(update.full, "the existing wire's full update removes absent logs");
        assert!(update.logs.iter().all(|(l, _)| *l == b));
        let mut peer = before;
        peer.take(update);
        assert_eq!(peer, after);
        let empty = Holdings::default();
        peer.take(empty.since(Some(&peer)).expect("last log removed"));
        assert_eq!(peer, empty);
    }

    #[test]
    fn incremental_frontiers_match_full_rebuild_after_every_arrival_and_gap_closure() {
        let mut w = world();
        let h = handbook(&mut w);
        for i in 0..6 {
            w.lab.edit(w.mac_a, h.coop, h.welcome, |item| item.set_text(2, &format!("version {i}"))).expect("edit");
        }
        let source = w.lab.log(w.mac_a).edits();
        for order in 0..4 {
            let mut edits = source.to_vec();
            match order {
                1 => edits.reverse(),
                2 => { let n = edits.len() / 2; edits.rotate_left(n); }
                3 => { edits.sort_by_key(|e| e.id()); }
                _ => {}
            }
            // Duplicate delivery must not alter the frontier or grow a log's positions.
            edits.push(edits[0].clone());
            let ids: Vec<_> = edits.iter().map(Edit::id).collect();
            let mut incremental = Logs::of(&[], &[], (0, 0));
            for n in 1..=edits.len() {
                incremental.extend(&edits[..n], &ids[..n], (n, 0));
                let mut all_closed = HashSet::new();
                for (l, log) in &incremental.of {
                    let places: Vec<_> = (0..n).filter(|&i| log_of(&edits[i], ids[i]) == Some(*l)).collect();
                    let (expected, closed) = frontier(&edits[..n], &ids[..n], &places);
                    assert_eq!(log.frontier, expected, "order {order}, arrival {n}, log {l:?}");
                    assert_eq!(log.edits.iter().map(|&i| ids[i]).collect::<HashSet<_>>().len(), log.edits.len());
                    all_closed.extend(closed);
                }
                assert_eq!(incremental.closed, all_closed, "same closed part at every step");
            }
            let before = incremental.frontiers();
            incremental.extend(&edits, &ids, (edits.len(), 8));
            assert_eq!(incremental.frontiers(), before, "keys alone change no frontier");
        }
    }

    #[test]
    fn a_checkpoint_withdrawal_or_same_length_restore_rebuilds_the_index() {
        let mut w = world();
        let h = handbook(&mut w);
        w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
        let source = w.lab.log(w.mac_a).edits().to_vec();
        let mut log = avendb::policy::Log::from_edits(source[..source.len() - 1].to_vec());
        let mut index = Logs::of(&[], &[], (0, 0));
        let size = (log.ids().len(), 0);
        index.update(&log, size);
        let removed = log.ids()[0];
        log.let_go(&[removed].into());
        // A received edit replaces a withdrawn edit before the index next runs: the count stays the same.
        log.receive([source.last().unwrap().clone()]);
        assert_eq!(log.ids().len(), size.0);
        assert!(!index.current(&log, size));
        index.update(&log, size);
        let expected = Logs::of(log.edits(), log.ids(), size);
        assert_eq!(index.frontiers(), expected.frontiers());
        assert_eq!(index.at, expected.at);
        assert_eq!(index.closed, expected.closed);
        assert!(!index.at.contains_key(&removed));
        // A restored sequence of the same length can have entirely different positions too.
        let restored = avendb::policy::Log::from_edits(source[..source.len() - 1].iter().rev().cloned().collect());
        assert!(!index.current(&restored, size));
        index.update(&restored, size);
        let expected = Logs::of(restored.edits(), restored.ids(), size);
        assert_eq!(index.frontiers(), expected.frontiers());
        assert_eq!(index.at, expected.at);
        // Shrinking to nothing is a valid recovery event, never an append-only assertion failure.
        log.let_go(&log.ids().iter().copied().collect());
        index.update(&log, (0, 0));
        assert!(index.of.is_empty() && index.at.is_empty() && index.closed.is_empty());
    }

    #[test]
    fn a_devices_holdings_of_each_log_are_its_frontier_and_waiting_edits_as_sync_cuts_them() {
        let mut w = world();
        let h = handbook(&mut w);
        // Welcome's log of two writes, so that with the first gone the second waits
        w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).expect("Alice edits Welcome");
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
        let (log, of) = (LogId::Entry(h.welcome), logs.of[&LogId::Entry(h.welcome)].edits.len() as u64);
        assert_eq!(logs.held(edits, &log, &logs.of[&log].frontier), (of, of), "the whole log holds all of it");
        let held = logs.held(edits, &log, welcome);
        assert_eq!(held, (of - 1, of), "the cut log doesn't cover the whole: it holds all but its first edit");
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
