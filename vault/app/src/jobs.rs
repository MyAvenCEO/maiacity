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
use serde_json::json;
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
}

impl Kind {
    pub fn lane(self) -> Lane {
        match self {
            Kind::Proxy | Kind::Still | Kind::WorldProxy | Kind::Render | Kind::Frame => Lane::Gpu,
            Kind::Transcript => Lane::Speech,
            Kind::Analysis => Lane::Ai,
            Kind::Sound | Kind::Keep | Kind::Ingest => Lane::Io,
        }
    }
    /// how urgent: lower first (a film someone waits for before a file's proxy, a proxy before its still)
    fn priority(self) -> i32 {
        match self {
            Kind::Render | Kind::Frame | Kind::Ingest => 0,
            Kind::Proxy | Kind::WorldProxy | Kind::Transcript | Kind::Sound | Kind::Keep => 2,
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

/// Is it queued or running?
pub fn active(kind: Kind, subject: &str) -> bool {
    let id = id(kind, subject);
    with(|r| r.active.contains_key(&id))
}

/// Its name, once it knows it.
pub fn name(kind: Kind, subject: &str, name: &str) {
    update(&id(kind, subject), |j| j.name = name.into(), true);
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

/// It waits for something that comes by itself (an ingest to finish, memory, a model, a file still on its way).
pub fn waiting(kind: Kind, subject: &str, why: &str) {
    update(
        &id(kind, subject),
        |j| {
            j.state = State::Waiting;
            j.stage = why.into();
        },
        true,
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

/// It ended because there was nothing to do after all (no work kept as history).
pub fn drop_quietly(kind: Kind, subject: &str) {
    let id = id(kind, subject);
    with(|r| {
        r.active.remove(&id);
        r.told.remove(&id);
        if r.busy.values().any(|b| *b == id) {
            r.busy.retain(|_, b| *b != id);
        }
    });
    if let Some(h) = HANDLE.get() {
        h.emit("jobs-gone", &id).ok();
    }
    TURNS.notify_waiters();
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
                .filter(|j| j.lane == lane && j.state == State::Queued && !r.busy.values().any(|b| *b == j.id) && !j.hidden)
                .min_by(|a, b| a.priority.cmp(&b.priority).then(a.queued.cmp(&b.queued)))
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

/// A place in a lane that is no job of its own — the render queue's poll, which takes the GPU before it asks the API
/// for a film, so a film it claims never waits behind other work. Most urgent; never shown. Dropped with its turn.
pub async fn hidden_turn(lane: Lane, tag: &str) -> Turn {
    let id = format!("~{tag}");
    with(|r| {
        r.active.entry(id.clone()).or_insert_with(|| Job {
            id: id.clone(),
            kind: Kind::Render,
            lane,
            subject: tag.into(),
            name: String::new(),
            state: State::Queued,
            stage: String::new(),
            progress: 0.0,
            priority: -2,
            queued: now(),
            started: None,
            ended: None,
            error: None,
            hidden: true,
        });
    });
    loop {
        let notified = TURNS.notified();
        tokio::pin!(notified);
        notified.as_mut().enable();
        let ready = with(|r| {
            if r.busy.contains_key(&lane) {
                return false;
            }
            r.busy.insert(lane, id.clone());
            if let Some(j) = r.active.get_mut(&id) {
                j.state = State::Running;
            }
            true
        });
        if ready {
            return Turn { id, lane, hidden: true };
        }
        let _ = tokio::time::timeout(Duration::from_secs(1), notified).await;
    }
}

/// A queued job taken off before its turn.
#[derive(Debug)]
pub struct Cancelled;

impl std::fmt::Display for Cancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("cancelled")
    }
}

/// The lane free of an ingest and with memory to spare, the job saying so while it waits.
pub async fn ready_to_run(vault: &vault_core::Vault, kind: Kind, subject: &str) {
    if vault.hold.now().iter().any(|h| h == "ingest") {
        waiting(kind, subject, "after the ingest");
        vault.hold.free_of("ingest").await;
    }
    while crate::proxies::short_of_memory() {
        waiting(kind, subject, "waiting for memory");
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
}

// ── what starts them ─────────────────────────────────────────────────────────────────────────────────────────────

/// A watcher's rule: what it sees (`when`), the job it starts (`then`, of `kind`), and how it looks (`watch`: as it
/// happens, or a round every so often that catches what was missed). The Processes tab lists them beside the lanes.
#[derive(Serialize)]
pub struct Rule {
    pub id: &'static str,
    /// a few words a person knows it by
    pub name: &'static str,
    pub when: &'static str,
    pub then: &'static str,
    pub kind: Kind,
    pub watch: &'static str,
    /// the code that keeps it
    pub code: &'static str,
}

/// Every rule, in the order the work flows: a file in → its proxy → its stills and words → its analysis and hero frame
/// → its graded still → the film. Each names the code that keeps it (`code`), so the list and the code agree.
pub const RULES: &[Rule] = &[
    Rule { id: "ingest", name: "Ingest", when: "Files are brought in (dropped, or from a card or a drive)", then: "Ingest: hashed, into the vault, described", kind: Kind::Ingest, watch: "when asked", code: "main.rs ingest" },
    Rule { id: "proxy", name: "Proxy", when: "A video original or an EXR sequence comes in (a display still never: it is its own picture) — or its colour journey becomes known", then: "Proxy: ACEScct, to play and grade on", kind: Kind::Proxy, watch: "at ingest · every 10 min", code: "proxies.rs sweep, auto_proxy" },
    Rule { id: "still", name: "Grading still", when: "A video's proxy is made (its journey known)", then: "Grading still (4K ACEScct) and preview, at its hero frame — the middle until one is picked", kind: Kind::Still, watch: "with the proxy · every 10 min", code: "proxies.rs grading_still_at (with the proxy), backfill_still" },
    Rule { id: "still-hero", name: "Hero frame moved", when: "A video's hero frame moves (the analysis picks it, or a person sets it)", then: "Grading still and preview again, at the new moment", kind: Kind::Still, watch: "every 10 min", code: "proxies.rs marked_at" },
    Rule { id: "transcript", name: "Transcript", when: "A video or sound original is on this Mac without its words (or with an older model's)", then: "Transcript: words with their times, on this Mac", kind: Kind::Transcript, watch: "at ingest · every 10 min", code: "transcripts.rs sweep" },
    Rule { id: "sound", name: "Sound record", when: "A recording is on this Mac without its sound record", then: "Sound record: its tracks, length and start timecode", kind: Kind::Sound, watch: "at ingest · every 10 min", code: "sound.rs round" },
    Rule { id: "analysis", name: "AI analysis", when: "A picture's proxy is here and its words have settled (in the stories in scope)", then: "AI analysis: tags, cues, takes — and its hero frame", kind: Kind::Analysis, watch: "after a proxy or transcript · every 10 min", code: "analyse/mod.rs round" },
    Rule { id: "graded", name: "Graded still on save", when: "A timeline save changes how a file looks (its stacks of tools, its 16:9 framing, its scene's or the timeline's look)", then: "Graded still: its grading still through the clip's grade, as its preview — the one before goes", kind: Kind::Frame, watch: "on save · render queue every few s", code: "api/src/renders.ts queueStillsOf → render.rs graded_still_job" },
    Rule { id: "graded-again", name: "Graded still, new hero", when: "A file's grading still is made again (a new hero frame)", then: "Graded still again, through the clip that last graded it", kind: Kind::Frame, watch: "with the grading still", code: "api/src/renders.ts queueStillOfFile (proxies.rs grading_still_at)" },
    Rule { id: "world-proxy", name: "World proxy", when: "A timeline plays a world shot version without its proxy", then: "World proxy: the shot rendered in the app's own world", kind: Kind::WorldProxy, watch: "every minute", code: "world.rs proxies" },
    Rule { id: "render", name: "Render", when: "A render is asked for (the Render tab, or an agent)", then: "Render: every delivery, levelled, into the vault and the calendar", kind: Kind::Render, watch: "render queue every few s", code: "api/src/renders.ts queueRender → render.rs render_job" },
    Rule { id: "keep", name: "Keep on stores", when: "A file this Mac or a drive keeps (its story's rules) is not here — or no longer kept", then: "Kept: fetched over iroh and pinned — or let go of", kind: Kind::Keep, watch: "every minute", code: "keep.rs round" },
];

// ── the studio's view ─────────────────────────────────────────────────────────────────────────────────────────

/// Every job: the running and queued ones (each lane's in its order), then the history, newest first.
#[derive(Serialize)]
pub struct Jobs {
    pub active: Vec<Job>,
    pub history: Vec<Job>,
    /// what holds the lanes now: an ingest, memory
    pub holds: Vec<String>,
    /// what starts the jobs, each with the lane its job runs in
    pub rules: Vec<serde_json::Value>,
}

pub fn list(limit: usize) -> Jobs {
    with(|r| {
        let mut active: Vec<Job> = r.active.values().filter(|j| !j.hidden).cloned().collect();
        active.sort_by(|a, b| {
            let run = |j: &Job| !matches!(j.state, State::Running | State::Waiting) as u8;
            run(a).cmp(&run(b)).then(a.priority.cmp(&b.priority)).then(a.queued.cmp(&b.queued))
        });
        Jobs { active, history: r.history.iter().take(limit).cloned().collect(), holds: Vec::new(), rules: RULES.iter().map(|r| json!({ "id": r.id, "name": r.name, "when": r.when, "then": r.then, "kind": r.kind, "lane": r.kind.lane(), "watch": r.watch, "code": r.code })).collect() }
    })
}

#[tauri::command]
pub fn jobs_list(app: tauri::State<'_, crate::App>, limit: Option<usize>) -> Res<Jobs> {
    crate::gate()?;
    let mut j = list(limit.unwrap_or(200));
    j.holds = app.vault.hold.now();
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

/// A failed (or cancelled) job made again, as its kind is made.
#[tauri::command]
pub async fn jobs_retry(handle: AppHandle, app: tauri::State<'_, crate::App>, id: String) -> Res<()> {
    crate::gate()?;
    let job = with(|r| r.history.iter().find(|j| j.id == id).cloned()).ok_or("no such job in the history")?;
    retry(&handle, &app.vault, &job).await
}

pub async fn retry(handle: &AppHandle, vault: &std::sync::Arc<vault_core::Vault>, job: &Job) -> Res<()> {
    let hash = || job.subject.parse::<iroh_blobs::Hash>().map_err(|e| e.to_string());
    match job.kind {
        Kind::Proxy => {
            vault.catalog.describe(hash()?, &json!({ "meta": { "proxy_tries": 0 } })).await.map_err(crate::err)?;
            tauri::async_runtime::spawn(crate::proxies::auto_proxy(handle.clone(), vault.clone(), job.subject.clone(), std::path::PathBuf::new()));
        }
        Kind::Still => {
            vault.catalog.describe(hash()?, &json!({ "meta": { "grade_still_tries": 0 } })).await.map_err(crate::err)?;
            tauri::async_runtime::spawn(crate::proxies::backfill_still(vault.clone(), job.subject.clone()));
        }
        Kind::Transcript => crate::transcripts::queue(handle.clone(), vault.clone(), job.subject.clone()),
        Kind::Analysis => crate::analyse::again(vault, &job.subject).await?,
        Kind::Sound => crate::sound::wake(),
        Kind::WorldProxy => crate::world::wake(),
        Kind::Keep => {}
        Kind::Render | Kind::Frame | Kind::Ingest => return Err("a render or a hero frame is queued again from the Render tab (or the MCP); an ingest from the Ingest tab".into()),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
