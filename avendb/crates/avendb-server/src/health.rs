//! How the server is doing, for anyone to read at `GET /feed/health` (`feed::HEALTH`), so that why it stopped is seen
//! without a way onto its machine (Samuel 2026-10-20, as it restarted every two minutes): when this run started, the
//! memory it holds now and at most, its process's and its container's against the container's limit, its last panic,
//! its recent starts, and how the run before it ended. Each run says it is alive in its folder every few seconds
//! (`BEAT`, `FILE`), with the memory it held then. A run that ends by a stop or an error says so there as it ends; one
//! that said nothing was killed from outside, as for its memory, and what it last said is what it held then. Nothing
//! in it is secret: times, sizes and a panic's message.
//!
//! Its allocator's heap is in it too, in use and kept free, as the server's memory crept up as it ran
//! (2026-10-20, 896 to 964 MB in 16 minutes of a 1 GB limit): it hands back what it keeps free each minute
//! (`give_back`), in few heaps (`few_heaps`).

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::Abort;

/// The file in the server's folder each run says how it is doing in.
const FILE: &str = "health.json";

/// How often a run says it is alive.
const BEAT: Duration = Duration::from_secs(5);

/// How many starts it keeps.
const STARTS: usize = 50;

/// Every how many beats it hands back what its allocator keeps free (`give_back`): each minute.
const TRIM: u32 = 12;

/// How many heaps (arenas) glibc's allocator keeps at most: by default up to 8 for each core, a thread's own, each
/// keeping what it let go of for that thread alone.
#[cfg(all(target_os = "linux", target_env = "gnu"))]
const ARENAS: libc::c_int = 2;

/// How the server is doing, this run and the one before.
pub struct Health {
    file: PathBuf,
    started: u64,
    /// The starts it keeps, this one last.
    starts: Vec<u64>,
    /// How the run before this one ended, as it left its file, or null for the first.
    before: Value,
    /// This run's last panic, `{at, message}`: a task's panic leaves the process running.
    panic: Mutex<Value>,
    /// What its shelf takes where it keeps it, as last measured (`shelf`), or null before.
    shelf: Mutex<Value>,
    /// How the last check of the bucket of snapshots went (`checked`): when, and whether every folder was whole, each
    /// null before the first. Counts alone, never a vault's id: the repo is public, and an uptime check reads it.
    backups: Mutex<Value>,
}

impl Health {
    /// This run's, in folder `data`: what the run before left there read, and this start said.
    pub fn open(data: &Path) -> Arc<Health> {
        let file = data.join(FILE);
        let left: Option<Value> = std::fs::read(&file).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        let started = now();
        let mut starts: Vec<u64> = left.as_ref().map_or_else(Vec::new, |l| {
            l["starts"].as_array().into_iter().flatten().filter_map(Value::as_u64).collect()
        });
        starts.push(started);
        let excess = starts.len().saturating_sub(STARTS);
        starts.drain(..excess);
        let before = left.map_or(Value::Null, |l| {
            let ended = match &l["ended"] {
                Value::Null => json!({ "how": "killed", "why": "it said nothing as it ended: killed from outside, as for its memory" }),
                ended => ended.clone(),
            };
            json!({ "started": l["started"], "seen": l["seen"], "memory": l["memory"], "panic": l["panic"], "ended": ended })
        });
        let (panic, shelf) = (Mutex::new(Value::Null), Mutex::new(Value::Null));
        let backups = Mutex::new(json!({ "checked_at": null, "whole": null }));
        let health = Arc::new(Health { file, started, starts, before, panic, shelf, backups });
        health.write(Value::Null);
        health
    }

    /// Has every panic of this process kept as this run's last (`json`), then told as before.
    pub fn hook(self: &Arc<Self>) {
        let (health, told) = (self.clone(), std::panic::take_hook());
        std::panic::set_hook(Box::new(move |info| {
            let message = match (info.payload().downcast_ref::<&str>(), info.payload().downcast_ref::<String>()) {
                (Some(s), _) => (*s).to_string(),
                (_, Some(s)) => s.clone(),
                _ => "a panic with no message".to_string(),
            };
            let at = info.location().map(|l| format!("{}:{}", l.file(), l.line()));
            *health.panic.lock().unwrap_or_else(|e| e.into_inner()) = json!({ "at": now(), "where": at, "message": message });
            health.write(Value::Null);
            told(info);
        }));
    }

    /// Says it is alive every few seconds (`BEAT`), with the memory it holds, for as long as what it returns is held.
    pub(crate) fn beat(self: &Arc<Self>) -> Abort {
        let health = self.clone();
        Abort(tokio::spawn(async move {
            let mut beats = 0;
            loop {
                tokio::time::sleep(BEAT).await;
                beats = (beats + 1) % TRIM;
                if beats == 0 {
                    give_back();
                }
                health.write(Value::Null);
            }
        }))
    }

    /// Says this run ended, and how: `stopped`, as it was told to, or an `error`, with `why`.
    pub fn ended(&self, how: &str, why: Option<String>) {
        self.write(json!({ "how": how, "at": now(), "why": why }));
    }

    /// How it is doing, as `GET /feed/health` says it: this run's start and how long it has run, the memory it holds,
    /// its last panic, how many times it started in the last hour and the last few starts, and how the run before
    /// ended; what its shelf takes, and how the last check of its snapshots went.
    pub fn json(&self) -> Value {
        let now = now();
        let hour = self.starts.iter().filter(|&&s| now.saturating_sub(s) < 3600).count();
        let recent: Vec<u64> = self.starts.iter().rev().take(10).copied().collect();
        json!({
            "started": self.started,
            "up": now.saturating_sub(self.started),
            "memory": memory(),
            "panic": *self.panic.lock().unwrap_or_else(|e| e.into_inner()),
            "starts": { "hour": hour, "recent": recent },
            "before": self.before,
            "shelf": *self.shelf.lock().unwrap_or_else(|e| e.into_inner()),
            "backups": *self.backups.lock().unwrap_or_else(|e| e.into_inner()),
        })
    }

    /// Says how the check of the bucket of snapshots at `at` went (`backups::check_all`): whether every folder it
    /// checked was whole and none failed to be checked, with how many it checked and how many weren't whole or failed;
    /// a check that couldn't run at all (`checks` none) is not whole.
    pub fn checked(&self, at: u64, checks: Option<&crate::backups::Checks>) {
        let said = match checks {
            Some(c) => {
                let broken = c.checked.iter().filter(|(_, x)| !x.whole()).count() + c.failed.len();
                json!({ "checked_at": at, "whole": broken == 0, "vaults": c.checked.len(), "not_whole": broken })
            }
            None => json!({ "checked_at": at, "whole": false, "vaults": null, "not_whole": null }),
        };
        *self.backups.lock().unwrap_or_else(|e| e.into_inner()) = said;
    }

    /// Says what its shelf takes, as just measured: `{at, bucket: {objects, bytes}, folder: {files, bytes}}`.
    pub fn shelf(&self, measured: Value) {
        *self.shelf.lock().unwrap_or_else(|e| e.into_inner()) = measured;
    }

    /// Writes how this run is doing to its file, as it is now, `ended` or not (null): whole or not at all, by a file
    /// beside it renamed over it.
    fn write(&self, ended: Value) {
        let state = json!({
            "started": self.started,
            "seen": now(),
            "memory": memory(),
            "panic": *self.panic.lock().unwrap_or_else(|e| e.into_inner()),
            "starts": self.starts,
            "ended": ended,
        });
        let new = self.file.with_extension("json.new");
        let written = serde_json::to_vec(&state).map_err(std::io::Error::from).and_then(|bytes| std::fs::write(&new, bytes));
        if let Err(e) = written.and_then(|()| std::fs::rename(&new, &self.file)) {
            tracing::debug!("avenDB server: its health can't be written to {}: {e}", self.file.display());
        }
    }
}

/// Seconds since 1970.
fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Has the allocator keep its heap in few places (`ARENAS`), so what one thread let go of is there for the others and
/// handed back with the rest (`give_back`): said before the server's threads allocate.
pub fn few_heaps() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: mallopt only sets how the allocator chooses its heaps; it touches no memory in use
    unsafe {
        libc::mallopt(libc::M_ARENA_MAX, ARENAS);
    }
}

/// Hands back to the machine the memory its allocator kept of what the server let go of (glibc's `malloc_trim`): a
/// start reads its whole shelf, decoded and checked, and the heap it needed for that, which glibc keeps, would count
/// against the container's limit as the server runs (2026-10-20: 720 MB held of 420 MB in use, for Maia City alone);
/// so, each minute, does what its syncs let go of.
pub fn give_back() {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    // SAFETY: malloc_trim only returns free heap pages to the system; it touches no memory in use
    unsafe {
        libc::malloc_trim(0);
    }
}

/// The memory the process holds now and at most (`/proc/self/status`), of it its allocator's heap in use and kept free
/// (glibc's `mallinfo2`), its container's now, at most and its limit, with how many times its container's processes
/// were killed for memory (cgroup v2, `/sys/fs/cgroup`), and the machine's in all and free (`/proc/meminfo`, the
/// machine's in a container too), each in bytes; null where the machine doesn't say.
fn memory() -> Value {
    let (status, info) = (read("/proc/self/status"), read("/proc/meminfo"));
    let kb = |text: &str, name: &str| {
        let line = text.lines().find(|l| l.starts_with(name))?;
        line[name.len()..].trim().trim_end_matches("kB").trim().parse::<u64>().ok().map(|k| k * 1024)
    };
    let cgroup = |name: &str| std::fs::read_to_string(Path::new("/sys/fs/cgroup").join(name)).ok();
    let bytes = |name: &str| cgroup(name).and_then(|s| s.trim().parse::<u64>().ok());
    let kills = cgroup("memory.events").and_then(|events| {
        let line = events.lines().find(|l| l.starts_with("oom_kill "))?;
        line["oom_kill ".len()..].trim().parse::<u64>().ok()
    });
    json!({
        "rss": kb(&status, "VmRSS:"),
        "rss_peak": kb(&status, "VmHWM:"),
        "heap": heap(),
        "container": bytes("memory.current"),
        "container_peak": bytes("memory.peak"),
        "limit": bytes("memory.max"),
        "oom_kills": kills,
        "machine": kb(&info, "MemTotal:"),
        "machine_free": kb(&info, "MemAvailable:"),
    })
}

/// The allocator's heap, `{in_use, free}`: what the server holds of it, its mapped blocks too, and what it keeps free
/// of it; null but on glibc.
fn heap() -> Value {
    #[cfg(all(target_os = "linux", target_env = "gnu"))]
    {
        // SAFETY: mallinfo2 only reads the allocator's counts
        let info = unsafe { libc::mallinfo2() };
        json!({ "in_use": info.uordblks + info.hblkhd, "free": info.fordblks })
    }
    #[cfg(not(all(target_os = "linux", target_env = "gnu")))]
    Value::Null
}

/// A file of the machine's, or nothing.
fn read(path: &str) -> String {
    std::fs::read_to_string(path).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_last_check_of_the_snapshots_says_whether_every_folder_was_whole_and_no_vault() {
        use crate::backups::Checks;
        use avendb::id::VaultId;
        use avendb_net::backup::Checked;
        let dir = std::env::temp_dir().join(format!("avendb-health-checks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a folder");
        let health = Health::open(&dir);
        assert_eq!(health.json()["backups"], json!({ "checked_at": null, "whole": null }), "no check before the first");
        let whole = Checked { newest: Some(1), same: true, ..Checked::default() };
        let torn = Checked { newest: Some(1), same: true, unreadable: vec![3], ..Checked::default() };
        let (a, b) = (VaultId::from_u64(1), VaultId::from_u64(2));
        let mut checks = Checks { checked: vec![(a, whole.clone())], failed: vec![], took: Duration::ZERO };
        health.checked(100, Some(&checks));
        assert_eq!(health.json()["backups"], json!({ "checked_at": 100, "whole": true, "vaults": 1, "not_whole": 0 }));
        checks.checked.push((b, torn));
        health.checked(200, Some(&checks));
        assert_eq!(health.json()["backups"]["whole"], false, "a folder that isn't whole");
        assert_eq!(health.json()["backups"]["not_whole"], 1);
        checks.checked.truncate(1);
        checks.failed.push((b, "unreadable".into()));
        health.checked(300, Some(&checks));
        assert_eq!(health.json()["backups"]["whole"], false, "a vault it couldn't check");
        health.checked(400, None);
        assert_eq!(health.json()["backups"], json!({ "checked_at": 400, "whole": false, "vaults": null, "not_whole": null }));
        // counts alone: no vault's id is said
        let said = health.json()["backups"].to_string();
        assert!(!said.contains(&a.to_hex()) && !said.contains(&b.to_hex()), "{said}");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_run_that_said_nothing_as_it_ended_was_killed_and_one_that_stopped_says_so() {
        let dir = std::env::temp_dir().join(format!("avendb-health-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("a folder");
        let first = Health::open(&dir);
        assert!(first.json()["before"].is_null(), "the first run has none before it");
        #[cfg(all(target_os = "linux", target_env = "gnu"))]
        assert!(first.json()["memory"]["heap"]["in_use"].as_u64() > Some(0), "its heap in use is told");
        let second = Health::open(&dir);
        assert_eq!(second.json()["before"]["ended"]["how"], "killed", "the first said nothing as it ended");
        assert_eq!(second.json()["starts"]["hour"], 2);
        second.ended("stopped", None);
        let third = Health::open(&dir);
        assert_eq!(third.json()["before"]["ended"]["how"], "stopped");
        assert_eq!(third.json()["before"]["started"], second.started);
        assert_eq!(third.json()["starts"]["recent"].as_array().map(Vec::len), Some(3));
        std::fs::remove_dir_all(&dir).ok();
    }
}
