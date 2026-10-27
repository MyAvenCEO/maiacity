//! What the always-on peer's log, replay and state hold in memory per edit, measured by the bytes the allocator holds
//! (`held_bytes.rs` counts the same way), at a size held: a `MEMORY {...}` line per run.
//!
//!   AVENDB_MEMORY_N=100000 cargo test --release -p avendb --test peer_memory -- --ignored --nocapture
//!
//! The fixture is `bench_gates.rs`'s: one vault, writes spread over an entry per 50 edits, each received and stepped on
//! (`replay_on`). The parts are told apart by building each again from the log's edits and by letting each go. The
//! gate beside it (`memory_per_edit_stays_flat`) holds what an edit costs at a small size and at ten times it alike.

mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::HashMap;
use std::sync::atomic::{AtomicIsize, Ordering};

use avendb::id::{EditId, EntryId, VaultId};
use avendb::keys::KeyFam;
use avendb::policy::{replay, replay_on, Action, Edit, Log, Proposal, Replay, State};
use avendb::sync::{log_of, LogId};
use common::*;
use serde_json::{json, Value};

struct Counting;
static HELD: AtomicIsize = AtomicIsize::new(0);
/// The most it held since `PEAK` was last set to what it held.
static PEAK: AtomicIsize = AtomicIsize::new(0);

// SAFETY: forwards to the system allocator, counting the bytes it holds
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, l: Layout) -> *mut u8 {
        let now = HELD.fetch_add(l.size() as isize, Ordering::Relaxed) + l.size() as isize;
        PEAK.fetch_max(now, Ordering::Relaxed);
        unsafe { System.alloc(l) }
    }
    unsafe fn dealloc(&self, p: *mut u8, l: Layout) {
        HELD.fetch_sub(l.size() as isize, Ordering::Relaxed);
        unsafe { System.dealloc(p, l) }
    }
    unsafe fn realloc(&self, p: *mut u8, l: Layout, n: usize) -> *mut u8 {
        let now = HELD.fetch_add(n as isize - l.size() as isize, Ordering::Relaxed) + n as isize - l.size() as isize;
        PEAK.fetch_max(now, Ordering::Relaxed);
        unsafe { System.realloc(p, l, n) }
    }
}

#[global_allocator]
static A: Counting = Counting;

fn held() -> isize {
    HELD.load(Ordering::Relaxed)
}

fn entry(i: u64) -> EntryId {
    EntryId::from_u64(1000 + i)
}

fn target(k: usize, entries: u64) -> EntryId {
    entry((k as u64).wrapping_mul(7919) % entries)
}

fn entries_for(n: usize) -> u64 {
    (n as u64 / 50).max(200)
}

/// Drafts as `bench_gates.rs` drafts: the deepest depth and each log's last edit kept as edits come.
struct Drafter {
    depth: u64,
    last: HashMap<LogId, EditId>,
}

impl Drafter {
    fn write(&self, st: &State, e: EntryId, n: usize) -> Edit {
        let en = st.entry(e).expect("an entry");
        let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
        let body = n.to_le_bytes().to_vec();
        let via = st.via(MAC_A, en.vault).unwrap_or_default();
        let deps = st.heads(e, None);
        let action = Action::Write { vault: en.vault, entry: e, actor: en.vault, stay: en.stay(), epoch, deps,
            proposal: Proposal::Main, via, create: None, files: vec![], body };
        let parents = self.last.get(&LogId::Entry(e)).into_iter().copied().collect();
        Edit { parents, depth: self.depth, author: MAC_A, cosigners: vec![], action }
    }

    fn create(&self, st: &State, v: VaultId, e: EntryId) -> Edit {
        let mut action = creation(v, e, v, &[]);
        if let Action::Write { via, .. } = &mut action
            && let Some(chain) = st.via(MAC_A, v)
        {
            *via = chain;
        }
        let parents = self.last.get(&LogId::Entry(e)).into_iter().copied().collect();
        Edit { parents, depth: self.depth, author: MAC_A, cosigners: vec![], action }
    }

    fn took(&mut self, edit: &Edit, id: EditId) {
        self.depth = self.depth.max(edit.depth + 1);
        if let Some(l) = log_of(edit, id) {
            self.last.insert(l, id);
        }
    }
}

/// Alice's Mac with `n` writes over their entries, each received and stepped on alone.
fn grown(n: usize) -> (Log, Replay) {
    let entries = entries_for(n);
    let c = cast();
    let (mut log, alice) = (c.log, c.alice);
    let mut was = replay(log.edits());
    let depth = log.edits().iter().map(|e| e.depth + 1).max().unwrap_or(0);
    let last = log.edits().iter().zip(log.ids()).filter_map(|(e, id)| Some((log_of(e, *id)?, *id))).collect();
    let mut d = Drafter { depth, last };
    for k in 0..entries as usize + n {
        let edit = if k < entries as usize {
            d.create(&was.state, alice, entry(k as u64))
        } else {
            d.write(&was.state, target(k, entries), k)
        };
        let before = log.edits().len();
        log.receive([edit]);
        was = replay_on(was, log.edits(), before);
        d.took(&log.edits()[before], log.ids()[before]);
    }
    assert_eq!(was.state.all_writes().len(), entries as usize + n, "every write stood");
    (log, was)
}

/// What `n` writes held cost, in bytes per edit, in all and by part.
fn measure(n: usize) -> Value {
    let h0 = held();
    let (log, was) = grown(n);
    let total = held() - h0;
    let edits = log.edits().len() as isize;
    // the bare edits alone, then the log built of them, then their whole replay
    let h1 = held();
    let bare = log.edits().to_vec();
    let bare_bytes = held() - h1;
    drop(bare);
    drop(was);
    let h2 = held();
    let again = Log::from_edits(log.edits().to_vec());
    let log_bytes = held() - h2;
    drop(log);
    // a cold start's replay of every edit: what it holds after, and the most it held on the way
    let h3 = held();
    PEAK.store(h3, Ordering::Relaxed);
    let mut r = replay(again.edits());
    let replay_bytes = held() - h3;
    let replay_peak = PEAK.load(Ordering::Relaxed) - h3;
    // the replay let go of but its state: what it holds beside its state
    let state = std::mem::take(&mut r.state);
    let h4 = held();
    drop(r);
    let state_bytes = replay_bytes - (h4 - held());
    drop(state);
    let per = |b: isize| b / edits;
    json!({
        "kind": "memory",
        "n": n,
        "edits": edits,
        "total_per_edit": per(total),
        "bare_edit_per_edit": per(bare_bytes),
        "log_per_edit": per(log_bytes),
        "replay_per_edit": per(replay_bytes),
        "replay_peak_per_edit": per(replay_peak),
        "replay_without_state_per_edit": per(replay_bytes - state_bytes),
        "state_per_edit": per(state_bytes),
    })
}

#[test]
#[ignore]
fn measure_memory() {
    let n: usize = std::env::var("AVENDB_MEMORY_N").ok().and_then(|v| v.parse().ok()).unwrap_or(10_000);
    println!("MEMORY {}", measure(n));
}

#[test]
#[ignore]
fn sizes() {
    use avendb::policy::Write;
    println!("SIZES edit={} action={} write={} id={} logid={}", std::mem::size_of::<Edit>(), std::mem::size_of::<Action>(),
        std::mem::size_of::<Write>(), std::mem::size_of::<EditId>(), std::mem::size_of::<Option<LogId>>());
}
