//! Every process this Mac runs, in one place: the proxies, the grading stills, the world shots' proxies, the renders
//! and graded stills, the transcripts, the analyses, the sound records, the drives' and this Mac's own keeping, the
//! ingests. Each is a job — what it is, what for, where it stands (queued, waiting and why, running and how far,
//! done or failed and why) — in one registry, the studio's Processes tab and the MCP's `jobs` its views.
//!
//! The work runs in lanes, each one job at a time: the GPU (proxies, stills, world proxies, renders, frames — the
//! encoder is the Mac's), speech (transcripts), the AI (analyses), the disk and the line (sound records, keeping). A
//! lane's next job is its most urgent (a render before a proxy, a proxy before a still), then the oldest; a person can
//! move a job to the front. Every lane waits for an ingest to finish and for macOS to say there is memory to spare —
//! the jobs themselves wait, and say so.
//!
//! Finished jobs are kept as history (the last 400), on this Mac (`jobs.json` beside the app's settings). A change is
//! told to the studio as it happens (`jobs` events, a running job's progress at most four times a second).

use std::{
    collections::{HashMap, VecDeque},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};

use tauri::{AppHandle, Emitter};

use crate::Res;

/// Where a job runs: one at a time in each.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Lane {
    /// the GPU and the video encoder: proxies, grading stills, world proxies, renders, hero frames
    Gpu,
    /// the speech model: transcripts
    Speech,
    /// the picture model: analyses (and their hero frames)
    Ai,
    /// the disk and the line: sound records, keeping files, ingests
    Io,
}

/// What a job is.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Kind {
    Proxy,
    Still,
    WorldProxy,
    Render,
    Frame,
    Transcript,
    Analysis,
    Sound,
    Keep,
    Ingest,
    /// a page fetched from the web for a task of avenDB's (a YouTube video's words: aven.rs `youtube`)
    Fetch,
}

impl Kind {
    pub fn lane(self) -> Lane {
        match self {
            Kind::Proxy | Kind::Still | Kind::WorldProxy | Kind::Render | Kind::Frame => Lane::Gpu,
            Kind::Transcript => Lane::Speech,
            Kind::Analysis => Lane::Ai,
            Kind::Sound | Kind::Keep | Kind::Ingest | Kind::Fetch => Lane::Io,
        }
    }
    /// how urgent: lower first (a film someone waits for before a file's proxy, a proxy before its still)
    fn priority(self) -> i32 {
        match self {
            Kind::Render | Kind::Frame | Kind::Ingest => 0,
            Kind::Proxy | Kind::WorldProxy | Kind::Transcript | Kind::Sound | Kind::Keep | Kind::Fetch => 2,
            Kind::Still | Kind::Analysis => 3,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum State {
    /// waiting for its lane
    Queued,
    /// it has its lane, or holds it, but waits for something that comes by itself (an ingest, memory, a model)
    Waiting,
    Running,
    Done,
    Failed,
    Cancelled,
}

/// One process.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Job {
    /// "<kind>:<what for>" — one job per piece of work at a time
    pub id: String,
    pub kind: Kind,
    pub lane: Lane,
    /// what it is for: a file's hash, a shot's version, a render job's id, a drive
    pub subject: String,
    /// a name a person knows it by
    pub name: String,
    pub state: State,
    /// what it is doing now, in a few words (or what it waits for, or why it failed)
    pub stage: String,
    /// 0…1
    pub progress: f64,
    pub priority: i32,
    pub queued: String,
    pub started: Option<String>,
    pub ended: Option<String>,
    /// why it failed
    pub error: Option<String>,
    /// a place in a lane only (the render queue's poll): never shown, never kept
    #[serde(skip)]
    pub hidden: bool,
}

#[derive(Default)]
struct Registry {
    active: HashMap<String, Job>,
    history: VecDeque<Job>,
    /// the job each lane runs now
    busy: HashMap<Lane, String>,
    /// when each job last told the studio of its progress
    told: HashMap<String, Instant>,
    /// the jobs waiting in `turn` now: a lane is handed only to one of them (a job queued but not yet asking — the
    /// world proxies queued together, rendered one by one — never holds the lane up for the one that asks)
    asking: std::collections::HashSet<String>,
    loaded: bool,
}

static JOBS: Mutex<Option<Registry>> = Mutex::new(None);
static HANDLE: OnceLock<AppHandle> = OnceLock::new();
/// woken whenever a lane frees or a job's place changes
static TURNS: tokio::sync::Notify = tokio::sync::Notify::const_new();
const KEEP: usize = 400;

fn now() -> String {
    vault_core::ingest::now_iso()
}

fn history_file() -> std::path::PathBuf {
    // the tests keep theirs apart from the app's
    if cfg!(test) {
        return std::env::temp_dir().join(format!("maiacity-jobs-test-{}.json", std::process::id()));
    }
    let home = std::env::var_os("HOME").map(std::path::PathBuf::from).unwrap_or_default();
    home.join("Library/Application Support/city.maia.studio/jobs.json")
}

/// The registry, its history read from disk the first time.
fn with<R>(f: impl FnOnce(&mut Registry) -> R) -> R {
    let mut g = JOBS.lock().unwrap();
    let r = g.get_or_insert_with(Registry::default);
    if !r.loaded {
        r.loaded = true;
        if let Ok(bytes) = std::fs::read(history_file())
            && let Ok(list) = serde_json::from_slice::<Vec<Job>>(&bytes)
        {
            r.history = list.into_iter().take(KEEP).collect();
        }
    }
    f(r)
}

/// The studio told (the app's handle, at the start).
pub fn init(handle: AppHandle) {
    HANDLE.set(handle).ok();
    // a job left running by an app that quit midway is history: it ended with the app
    with(|r| {
        for j in r.history.iter_mut().filter(|j| matches!(j.state, State::Queued | State::Waiting | State::Running)) {
            j.state = State::Cancelled;
            j.stage = "the app quit".into();
        }
    });
}

fn tell(job: &Job) {
    if let Some(h) = HANDLE.get() {
        h.emit("jobs", job).ok();
    }
}

fn save(history: &VecDeque<Job>) {
    let list: Vec<&Job> = history.iter().collect();
    if let Ok(bytes) = serde_json::to_vec(&list) {
        let path = history_file();
        let part = path.with_extension("json.part");
        if std::fs::write(&part, bytes).is_ok() {
            std::fs::rename(&part, &path).ok();
        }
    }
}

/// A job queued (`false`: the same one is queued or running already — nothing new).
pub fn queue(kind: Kind, subject: &str, name: &str) -> bool {
    let id = id(kind, subject);
    let job = with(|r| {
        if r.active.contains_key(&id) {
            return None;
        }
        let j = Job {
            id: id.clone(),
            kind,
            lane: kind.lane(),
            subject: subject.into(),
            name: name.into(),
            state: State::Queued,
            stage: "queued".into(),
            progress: 0.0,
            priority: kind.priority(),
            queued: now(),
            started: None,
            ended: None,
            error: None,
            hidden: false,
        };
        r.active.insert(id.clone(), j.clone());
        Some(j)
    });
    match job {
        Some(j) => {
            tell(&j);
            TURNS.notify_waiters();
            true
        }
        None => false,
    }
}

/// A job's id: its kind and what it is for.
pub fn id(kind: Kind, subject: &str) -> String {
    format!("{}:{subject}", serde_json::to_value(kind).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default())
}

fn update(id: &str, f: impl FnOnce(&mut Job), always: bool) {
    let job = with(|r| {
        let j = r.active.get_mut(id)?;
        f(j);
        let j = j.clone();
        // progress at most four times a second; a change of state at once
        let last = r.told.get(id).copied();
        if !always && last.is_some_and(|t| t.elapsed() < Duration::from_millis(250)) {
            return None;
        }
        r.told.insert(id.to_string(), Instant::now());
        Some(j)
    });
    if let Some(j) = job {
        tell(&j);
    }
}

/// Where it is: a stage, and how far (0…1).
pub fn stage(kind: Kind, subject: &str, stage: &str, progress: f64) {
    let changed = with(|r| r.active.get(&id(kind, subject)).is_some_and(|j| j.stage != stage || j.state != State::Running));
    update(
        &id(kind, subject),
        |j| {
            j.state = State::Running;
            j.stage = stage.into();
            j.progress = progress.clamp(0.0, 1.0);
            j.started.get_or_insert_with(now);
        },
        changed,
    );
}

/// It ended: done, or failed and why. Into the history; its lane free for the next.
pub fn end(kind: Kind, subject: &str, result: Result<(), String>) {
    finish(
        &id(kind, subject),
        match result {
            Ok(()) => (State::Done, None),
            Err(e) => (State::Failed, Some(e)),
        },
    );
}

/// A job that ends with its scope: `done()` when it went through, else failed (it stopped on an error).
pub struct Ending {
    kind: Kind,
    subject: String,
    done: bool,
}

impl Ending {
    pub fn begin(kind: Kind, subject: &str, name: &str) -> Self {
        queue(kind, subject, name);
        stage(kind, subject, "starting", 0.0);
        Self { kind, subject: subject.into(), done: false }
    }
    pub fn done(mut self) {
        self.done = true;
        end(self.kind, &self.subject, Ok(()));
    }
}

impl Drop for Ending {
    fn drop(&mut self) {
        if !self.done {
            end(self.kind, &self.subject, Err("stopped on an error (the app's log says which)".into()));
        }
    }
}

fn finish(id: &str, (state, error): (State, Option<String>)) {
    let job = with(|r| {
        let mut j = r.active.remove(id)?;
        r.told.remove(id);
        r.busy.retain(|_, b| b != id);
        j.state = state.clone();
        j.ended = Some(now());
        if state == State::Done {
            j.progress = 1.0;
            j.stage = "done".into();
        }
        if let Some(e) = &error {
            j.stage = e.chars().take(300).collect();
        }
        j.error = error;
        r.history.push_front(j.clone());
        r.history.truncate(KEEP);
        save(&r.history);
        Some(j)
    });
    if let Some(j) = job {
        tell(&j);
    }
    TURNS.notify_waiters();
}

/// A job's turn on its lane: held until it is dropped. Its lane's most urgent job goes first, then the oldest.
/// `Err`: it was cancelled while it waited.
pub struct Turn {
    id: String,
    lane: Lane,
    hidden: bool,
}

impl Drop for Turn {
    fn drop(&mut self) {
        with(|r| {
            if r.busy.get(&self.lane) == Some(&self.id) {
                r.busy.remove(&self.lane);
            }
            if self.hidden {
                r.active.remove(&self.id);
            }
        });
        TURNS.notify_waiters();
    }
}

/// Wait for this job's turn on its lane.
pub async fn turn(kind: Kind, subject: &str) -> Result<Turn, Cancelled> {
    let id = id(kind, subject);
    let lane = kind.lane();
    // asking from here until it has its turn or gives up (also when the waiting future is dropped)
    struct Asking(String);
    impl Drop for Asking {
        fn drop(&mut self) {
            with(|r| r.asking.remove(&self.0));
        }
    }
    with(|r| r.asking.insert(id.clone()));
    let _asking = Asking(id.clone());
    loop {
        let notified = TURNS.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let ready = with(|r| {
            let Some(me) = r.active.get(&id) else {
                return Err(Cancelled);
            };
            if me.state == State::Cancelled {
                return Err(Cancelled);
            }
            if r.busy.contains_key(&lane) {
                return Ok(false);
            }
            // a hidden place waits for this lane (the render queue's poll): it goes first
            if r.active.values().any(|j| j.hidden && j.lane == lane && j.state == State::Queued) {
                return Ok(false);
            }
            // the most urgent of the lane's waiting jobs, then the oldest: is it this one?
            let next = r
                .active
                .values()
                .filter(|j| j.lane == lane && j.state == State::Queued && !r.busy.values().any(|b| *b == j.id) && !j.hidden && r.asking.contains(&j.id))
                .min_by(|a, b| a.priority.cmp(&b.priority).then(a.queued.cmp(&b.queued)).then(a.id.cmp(&b.id)))
                .map(|j| j.id.clone());
            if next.as_deref() == Some(id.as_str()) {
                r.busy.insert(lane, id.clone());
                return Ok(true);
            }
            Ok(false)
        })?;
        if ready {
            return Ok(Turn { id, lane, hidden: false });
        }
        // woken by a change, and in any case every second (a job that ended without telling)
        let _ = tokio::time::timeout(Duration::from_secs(1), notified).await;
    }
}

/// Whether a job other than `but` waits for lane `lane` now (queued, asking for its turn): a job that holds the lane a
/// long time (legacy_copy.rs) lets it go to that one first (`requeue`).
pub fn waiting_for(lane: Lane, but: &str) -> bool {
    with(|r| r.active.values().any(|j| j.lane == lane && j.id != but && j.state == State::Queued && r.asking.contains(&j.id)))
}

/// A running job back in its lane's queue, `stage` saying why, so that it asks for its turn again (`turn`) after the
/// jobs that wait for its lane now.
pub fn requeue(kind: Kind, subject: &str, stage: &str) {
    update(
        &id(kind, subject),
        |j| {
            j.state = State::Queued;
            j.stage = stage.into();
            j.queued = now();
        },
        true,
    );
}

/// A queued job taken off before its turn.
#[derive(Debug)]
pub struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("cancelled")
    }
}

// ── the studio's view ─────────────────────────────────────────────────────────────────────────────────────────

/// Every job: the running and queued ones (each lane's in its order), then the history, newest first.
#[derive(Serialize)]
pub struct Jobs {
    pub active: Vec<Job>,
    pub history: Vec<Job>,
    /// what holds the lanes now: memory
    pub holds: Vec<String>,
}

pub fn list(limit: usize) -> Jobs {
    with(|r| {
        let mut active: Vec<Job> = r.active.values().filter(|j| !j.hidden).cloned().collect();
        active.sort_by(|a, b| {
            let run = |j: &Job| !matches!(j.state, State::Running | State::Waiting) as u8;
            run(a).cmp(&run(b)).then(a.priority.cmp(&b.priority)).then(a.queued.cmp(&b.queued))
        });
        Jobs { active, history: r.history.iter().take(limit).cloned().collect(), holds: Vec::new() }
    })
}

#[tauri::command]
pub fn jobs_list(limit: Option<usize>) -> Res<Jobs> {
    crate::gate()?;
    let mut j = list(limit.unwrap_or(200));
    if crate::proxies::short_of_memory() {
        j.holds.push("memory".into());
    }
    Ok(j)
}

/// A queued job taken off (a running one cannot be stopped midway; it is let finish).
#[tauri::command]
pub fn jobs_cancel(id: String) -> Res<()> {
    crate::gate()?;
    let queued = with(|r| r.active.get(&id).is_some_and(|j| j.state == State::Queued));
    if !queued {
        return Err("only a job still waiting for its turn can be taken off".into());
    }
    finish(&id, (State::Cancelled, None));
    Ok(())
}

/// A queued job to the front of its lane.
#[tauri::command]
pub fn jobs_bump(id: String) -> Res<()> {
    crate::gate()?;
    update(&id, |j| j.priority = -1, true);
    TURNS.notify_waiters();
    Ok(())
}

/// A failed (or cancelled) job made again: every job of this Mac's is a task of avenDB's now (aven.rs `studio_job`),
/// asked again from that task.
#[tauri::command]
pub fn jobs_retry(id: String) -> Res<()> {
    crate::gate()?;
    with(|r| r.history.iter().any(|j| j.id == id)).then_some(()).ok_or("no such job in the history")?;
    Err("a job is asked again from its avenDB task (Jobs: Again)".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_lane_is_handed_to_a_job_that_asks_not_to_one_only_queued() {
        // jobs queued together and run one by one in their own order (the world proxies): the one asking gets the lane,
        // though another queued earlier has not asked yet — before, the lane waited for that one, and nothing ran
        assert!(queue(Kind::Sound, "q-first", "first"));
        assert!(queue(Kind::Sound, "q-second", "second"));
        let t = tokio::time::timeout(Duration::from_secs(3), turn(Kind::Sound, "q-second")).await;
        assert!(t.is_ok(), "the job asking for the lane got it");
        end(Kind::Sound, "q-second", Ok(()));
        drop(t);
        let first = tokio::time::timeout(Duration::from_secs(3), turn(Kind::Sound, "q-first")).await;
        assert!(first.is_ok());
        end(Kind::Sound, "q-first", Ok(()));
    }

    #[tokio::test]
    async fn a_lane_runs_its_most_urgent_job_first_then_the_oldest_and_one_at_a_time() {
        // a proxy holds the GPU; a still, then another proxy, then a render wait: the render goes next, then the
        // proxy, then the still; a cancelled job never gets its turn
        assert!(queue(Kind::Proxy, "t-a", "a"));
        assert!(!queue(Kind::Proxy, "t-a", "a"), "the same work is queued once");
        let first = turn(Kind::Proxy, "t-a").await.unwrap();
        queue(Kind::Still, "t-b", "b");
        queue(Kind::Proxy, "t-c", "c");
        queue(Kind::Render, "t-d", "d");
        queue(Kind::Proxy, "t-e", "e");
        jobs_cancel_quiet("proxy:t-e");
        let order = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut waiting = Vec::new();
        for (k, sub) in [(Kind::Still, "t-b"), (Kind::Proxy, "t-c"), (Kind::Render, "t-d"), (Kind::Proxy, "t-e")] {
            let order = order.clone();
            waiting.push(tokio::spawn(async move {
                match turn(k, sub).await {
                    Ok(t) => {
                        order.lock().unwrap().push(sub);
                        tokio::time::sleep(Duration::from_millis(20)).await;
                        end(k, sub, Ok(()));
                        drop(t);
                    }
                    Err(Cancelled) => order.lock().unwrap().push("cancelled"),
                }
            }));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(order.lock().unwrap().iter().all(|o| *o == "cancelled"), "nothing runs while the lane is held: {:?}", order.lock().unwrap());
        end(Kind::Proxy, "t-a", Ok(()));
        drop(first);
        for w in waiting {
            w.await.unwrap();
        }
        let order = order.lock().unwrap().clone();
        assert_eq!(order.iter().filter(|o| **o != "cancelled").copied().collect::<Vec<_>>(), ["t-d", "t-c", "t-b"]);
        let h = list(50).history;
        assert!(h.iter().any(|j| j.id == "proxy:t-a" && j.state == State::Done && j.progress == 1.0));
        assert!(h.iter().any(|j| j.id == "proxy:t-e" && j.state == State::Cancelled));
    }

    fn jobs_cancel_quiet(id: &str) {
        finish(id, (State::Cancelled, None));
    }
}
