//! What a device does as it starts, step by step, for its person to watch while they wait: founding their vault,
//! linking to it or opening again (`avendb_browser::Device`), each step by its name, when it began and how long it
//! took, in milliseconds since the start began. The device marks each step as it begins it (`Progress::step`), and the
//! end of the last as the start is over (`Progress::end`, or as `Progress::ending` drops, however the start ends); the
//! page or the app it runs in watches the steps change (`Progress::watch`) and shows them as they happen.
//!
//! The steps, by name, in the order a start takes them; each start takes those it needs:
//!
//! - `unlock`: the passkey's ceremony that unlocks the device, which is its pass for a new one;
//! - `keys`: the device's keys, from its secret, and its person's passkey's, from the ceremony;
//! - `restore`: what its store kept, replayed;
//! - `node`: its node on an iroh endpoint, reaching its peers through the relay;
//! - `server`: the server, reached and proved by its hello, its card taken, and whether anybody owns it;
//! - `draft`: the edits that found its person's vault, add the device to it, and claim the server nobody owns yet;
//! - `sign`: the passkey's ceremony that signs those edits in one go;
//! - `claim`: the server, handed its claim, signs that the new vault owns avenCEO;
//! - `settle`: the server's cap on the new vault and the device's card in it;
//! - `pass`: the passkey's pass for the device, shown to the peer it links through, which hands back its person's vault;
//! - `vault`: that vault's log, every edit checked as it is taken;
//! - `join`: the edit that adds the device to its vault, signed and sent to the peer;
//! - `sync`: what the peer holds for the device, asked for;
//! - `check`: the device belongs to the vault its store holds.

use std::sync::Arc;

use n0_future::time::Instant;
use tokio::sync::watch;

/// One step of a start: its name, when it began, and how long it took once over, in milliseconds since the start began.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stage {
    pub step: &'static str,
    pub at: u64,
    pub took: Option<u64>,
}

/// The steps of a start so far, and whether it is over.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Steps {
    pub steps: Vec<Stage>,
    pub over: bool,
}

/// The steps of a start as they happen, shared by the device and whoever watches it: a clone shares them.
#[derive(Clone, Debug)]
pub struct Progress {
    steps: Arc<watch::Sender<Steps>>,
    since: Instant,
}

impl Default for Progress {
    fn default() -> Progress {
        Progress::new()
    }
}

impl Progress {
    /// A start that begins now, with no step yet.
    pub fn new() -> Progress {
        Progress { steps: Arc::new(watch::Sender::new(Steps::default())), since: Instant::now() }
    }

    /// Step `step` begins, and the one under way, if any, is over. Once the start is over, nothing changes.
    pub fn step(&self, step: &'static str) {
        let at = self.millis();
        self.steps.send_if_modified(|s| {
            !s.over && {
                ended(s, at);
                s.steps.push(Stage { step, at, took: None });
                true
            }
        });
    }

    /// The start is over, and the step under way with it.
    pub fn end(&self) {
        let at = self.millis();
        self.steps.send_if_modified(|s| {
            !s.over && {
                ended(s, at);
                s.over = true;
                true
            }
        });
    }

    /// Marks the start over as it drops, however the start ends: with its device, an error, or never, dropped.
    pub fn ending(&self) -> Ending {
        Ending(self.clone())
    }

    /// Its steps so far.
    pub fn steps(&self) -> Steps {
        self.steps.borrow().clone()
    }

    /// Its steps, marked as they change.
    pub fn watch(&self) -> watch::Receiver<Steps> {
        self.steps.subscribe()
    }

    /// Milliseconds since the start began.
    fn millis(&self) -> u64 {
        u64::try_from(self.since.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

/// Marks its start over as it drops (`Progress::ending`).
pub struct Ending(Progress);

impl Drop for Ending {
    fn drop(&mut self) {
        self.0.end();
    }
}

/// The step under way in `s`, if any, is over at `at`.
fn ended(s: &mut Steps, at: u64) {
    if let Some(last) = s.steps.last_mut().filter(|last| last.took.is_none()) {
        last.took = Some(at.saturating_sub(last.at));
    }
}
