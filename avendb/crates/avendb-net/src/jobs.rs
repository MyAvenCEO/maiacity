//! What a node does in the background, as jobs its person can watch (the page's Jobs), on the studio's model
//! (vault/app's `jobs.rs`): each job has a kind, what it works on (its subject), a name, a state, the stage it is at,
//! and how far it is, in units of its own (bytes, pieces, edits), with when it started and ended and why it failed, and
//! the vaults and entries it is about, each with how many of its units are theirs, so that a page shows each vault its
//! own and where each entry it worked on is synced to. A
//! node keeps those under way and the last `HISTORY` that ended (`Jobs`), and tells them as its `jobs` op asks
//! (`Node::run`). A job begins as its work does (`Jobs::begin`) and ends with it: done, failed, or forgotten where it
//! did nothing worth showing; if its work stops without saying, as a task dropped, it failed (`Running`'s drop).
//!
//! The kinds:
//!
//! - `bring`: a file brought into the node's store, sealed as its bytes come (`put_file`), in bytes;
//! - `keep`: a file kept whole, its pieces fetched from the peers that hold them (the keeper), in pieces; one that
//!   fetched nothing, as its pieces were all there, is forgotten, and so is one that failed before it fetched any:
//!   the keeper tries it again;
//! - `pull`: the edits a peer holds for the node, asked for page by page and taken, in edits; one that took none is
//!   forgotten.

use std::collections::{BTreeMap, VecDeque};

use avendb::id::SignerId;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use n0_future::time;
use serde_json::{Value, json};

/// How many ended jobs a node keeps, the newest first.
pub const HISTORY: usize = 200;

/// Where a job is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum State {
    Running,
    Done,
    Failed,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            State::Running => "running",
            State::Done => "done",
            State::Failed => "failed",
        }
    }
}

/// One job: what it does and how far it is.
#[derive(Clone, Debug)]
pub struct Job {
    /// `<kind>:<subject>#<n>`, the `n`th job the node began.
    pub id: String,
    pub kind: &'static str,
    /// What it works on, in hex: a file's root, a peer's device; empty for a file not sealed yet.
    pub subject: String,
    /// What it is, in words, as it began: a file's name, where it has one.
    pub name: String,
    pub state: State,
    /// What it does now, in words.
    pub stage: String,
    /// How far it is, of `total`, in `unit`s; `total` 0 while it doesn't know.
    pub done: u64,
    pub total: u64,
    pub unit: &'static str,
    /// When it started and ended, in milliseconds since 1970.
    pub started: u64,
    pub ended: Option<u64>,
    /// Why it failed.
    pub error: Option<String>,
    /// The vaults it is about, in hex, each with how many of its units are that vault's: a file's, its entry's vault
    /// with all of it; a pull's, each vault whose edits it took with how many.
    pub vaults: BTreeMap<String, u64>,
    /// The entries it is about, in hex, as `vaults`: a file's, the entry that brings it; a pull's, each entry whose
    /// edits it took.
    pub entries: BTreeMap<String, u64>,
    /// The session it began for (`Node::acting`), an agent theOS hosts; none for the node's own device. A session sees
    /// its own jobs alone (`Jobs::to_json_for`).
    pub by: Option<SignerId>,
}

impl Job {
    /// The job as the page reads it.
    pub fn to_json(&self) -> Value {
        json!({
            "id": self.id,
            "kind": self.kind,
            "subject": self.subject,
            "name": self.name,
            "state": self.state.name(),
            "stage": self.stage,
            "done": self.done,
            "total": self.total,
            "unit": self.unit,
            "started": self.started,
            "ended": self.ended,
            "error": self.error,
            "vaults": self.vaults,
            "entries": self.entries,
        })
    }
}

#[derive(Default)]
struct Book {
    running: BTreeMap<String, Job>,
    ended: VecDeque<Job>,
}

/// A node's jobs: those under way and the last that ended, shared by the node's tasks and whoever reads them; a clone
/// shares them.
#[derive(Clone, Default)]
pub struct Jobs {
    book: Arc<Mutex<Book>>,
    /// How many jobs it began.
    began: Arc<AtomicU64>,
}

impl Jobs {
    /// A job of kind `kind` on `subject` begins, named `name`, of `total` `unit`s (0 while it doesn't know).
    pub fn begin(&self, kind: &'static str, subject: String, name: String, total: u64, unit: &'static str) -> Running {
        let n = self.began.fetch_add(1, Ordering::Relaxed);
        let id = format!("{kind}:{subject}#{n}");
        let job = Job {
            id: id.clone(),
            kind,
            subject,
            name,
            state: State::Running,
            stage: String::new(),
            done: 0,
            total,
            unit,
            started: now_ms(),
            ended: None,
            error: None,
            vaults: BTreeMap::new(),
            entries: BTreeMap::new(),
            by: crate::acting(),
        };
        self.book.lock().expect("jobs").running.insert(id.clone(), job);
        Running { jobs: self.clone(), id, over: false }
    }

    /// Those under way, the oldest first, and the last that ended, the newest first.
    pub fn snapshot(&self) -> (Vec<Job>, Vec<Job>) {
        let book = self.book.lock().expect("jobs");
        let mut running: Vec<Job> = book.running.values().cloned().collect();
        running.sort_by_key(|j| j.started);
        (running, book.ended.iter().cloned().collect())
    }

    /// The jobs as the page reads them: `{"running": [...], "ended": [...]}`.
    pub fn to_json(&self) -> Value {
        self.to_json_for(None)
    }

    /// `to_json`, as `who` reads them: a session (`Node::acting`) its own jobs alone, never its host's or another
    /// session's; the node's own device, none, all of them.
    pub fn to_json_for(&self, who: Option<SignerId>) -> Value {
        let (mut running, mut ended) = self.snapshot();
        if who.is_some() {
            running.retain(|j| j.by == who);
            ended.retain(|j| j.by == who);
        }
        json!({
            "running": running.iter().map(Job::to_json).collect::<Vec<_>>(),
            "ended": ended.iter().map(Job::to_json).collect::<Vec<_>>(),
        })
    }

    fn update(&self, id: &str, change: impl FnOnce(&mut Job)) {
        if let Some(job) = self.book.lock().expect("jobs").running.get_mut(id) {
            change(job);
        }
    }

    /// Job `id` ends in `state`, and goes to the history, or nowhere if `keep` is false.
    fn end(&self, id: &str, state: State, error: Option<String>, keep: bool) {
        let mut book = self.book.lock().expect("jobs");
        let Some(mut job) = book.running.remove(id) else { return };
        if keep {
            job.state = state;
            job.error = error;
            job.ended = Some(now_ms());
            if state == State::Done && job.total > 0 {
                job.done = job.total;
            }
            book.ended.push_front(job);
            book.ended.truncate(HISTORY);
        }
    }
}

/// A job under way, as its work holds it: it says how far it is, and ends with it. Dropped before it ended, it failed.
pub struct Running {
    jobs: Jobs,
    id: String,
    over: bool,
}

impl Running {
    /// It is at stage `stage`.
    pub fn stage(&mut self, stage: impl Into<String>) {
        let stage = stage.into();
        self.jobs.update(&self.id, |j| j.stage = stage);
    }

    /// It has done `done` of its units, of `total` if it knows now.
    pub fn progress(&mut self, done: u64, total: Option<u64>) {
        self.jobs.update(&self.id, |j| {
            j.done = done;
            if let Some(total) = total {
                j.total = total;
            }
        });
    }

    /// It is about the vaults `vaults` and the entries `entries`, each with how many of its units are theirs.
    pub fn about(&mut self, vaults: BTreeMap<String, u64>, entries: BTreeMap<String, u64>) {
        self.jobs.update(&self.id, |j| (j.vaults, j.entries) = (vaults, entries));
    }

    /// It now works on `subject`, as a file once it is sealed is named by its root.
    pub fn subject(&mut self, subject: String) {
        self.jobs.update(&self.id, |j| j.subject = subject);
    }

    /// It is done.
    pub fn done(mut self) {
        self.over = true;
        self.jobs.end(&self.id, State::Done, None, true);
    }

    /// It failed, for `why`.
    pub fn failed(mut self, why: &anyhow::Error) {
        self.over = true;
        self.jobs.end(&self.id, State::Failed, Some(format!("{why:#}")), true);
    }

    /// It ends, done or failed as `result` says.
    pub fn ended<T>(self, result: &anyhow::Result<T>) {
        match result {
            Ok(_) => self.done(),
            Err(e) => self.failed(e),
        }
    }

    /// It did nothing worth showing: gone, with no trace.
    pub fn forget(mut self) {
        self.over = true;
        self.jobs.end(&self.id, State::Done, None, false);
    }
}

impl Drop for Running {
    fn drop(&mut self) {
        if !self.over {
            self.jobs.end(&self.id, State::Failed, Some("it stopped before it ended".into()), true);
        }
    }
}

/// The time by this machine's clock, or the browser's, in milliseconds since 1970.
pub(crate) fn now_ms() -> u64 {
    time::SystemTime::now().duration_since(time::SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_job_runs_ends_and_goes_to_the_history() {
        let jobs = Jobs::default();
        let mut keep = jobs.begin("keep", "ab".into(), "a film".into(), 4, "pieces");
        keep.stage("fetching");
        keep.progress(2, None);
        keep.about(BTreeMap::from([("v1".to_string(), 4)]), BTreeMap::from([("e1".to_string(), 4)]));
        let (running, ended) = jobs.snapshot();
        assert_eq!((running.len(), ended.len()), (1, 0));
        assert_eq!((running[0].id.as_str(), running[0].done, running[0].total), ("keep:ab#0", 2, 4));
        assert_eq!(running[0].stage, "fetching");
        let told = jobs.to_json()["running"][0].clone();
        assert_eq!((&told["vaults"], &told["entries"]), (&json!({ "v1": 4 }), &json!({ "e1": 4 })), "what it is about");
        keep.done();
        let (running, ended) = jobs.snapshot();
        assert!(running.is_empty());
        assert_eq!((ended[0].state, ended[0].done), (State::Done, 4), "done is all of it");
        // one dropped before it ended failed; one forgotten leaves no trace
        drop(jobs.begin("bring", "cd".into(), "a song".into(), 9, "bytes"));
        jobs.begin("pull", "ef".into(), "the server".into(), 0, "edits").forget();
        let (_, ended) = jobs.snapshot();
        let states: Vec<_> = ended.iter().map(|j| (j.id.as_str(), j.state)).collect();
        assert_eq!(states, [("bring:cd#1", State::Failed), ("keep:ab#0", State::Done)], "the newest first");
        assert_eq!(ended[0].error.as_deref(), Some("it stopped before it ended"));
        let json = jobs.to_json();
        let told = (json["running"].as_array().map(Vec::len), json["ended"][0]["state"].as_str());
        assert_eq!(told, (Some(0), Some("failed")), "as the page reads them");
    }

    #[test]
    fn the_history_keeps_the_last_ones() {
        let jobs = Jobs::default();
        for n in 0..HISTORY + 5 {
            jobs.begin("pull", n.to_string(), String::new(), 0, "edits").done();
        }
        let (_, ended) = jobs.snapshot();
        assert_eq!(ended.len(), HISTORY);
        assert_eq!(ended[0].subject, (HISTORY + 4).to_string(), "the newest first");
    }
}
