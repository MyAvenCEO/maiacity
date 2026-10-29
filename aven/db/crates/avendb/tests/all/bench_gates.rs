//! avenDB's scale bench (2026-10-27): what a write, a point read, a view and a first sync cost at a size held, as lines
//! of JSON (`BENCH {...}`), printed only since Goal 7a (W1, Samuel 2026-10-28: benchmarks out of CI, timings on a
//! shared runner gated nothing real). What is a count gates in `the_bench_measures_a_small_log`, a plain test: the log's
//! bytes an edit. Each size runs in a process of its own, so that its resident memory is its own:
//!
//!   AVENDB_BENCH_N=100000 cargo test --release -p avendb --test all -- --ignored --nocapture bench_gates::bench_scale
//!   AVENDB_BENCH_FIRST=50000:3000 cargo test --release -p avendb --test all -- --ignored --nocapture bench_gates::bench_first_sync
//!
//! The fixture is the rules' log of `replay_scale.rs`, lean: one vault, writes spread over an entry per 50 edits,
//! each received and stepped on (`replay_on`) as a device that keeps up takes them. They are drafted as
//! `Log::draft_on` drafts (`the_lean_draft_is_draft_on`), but without its scan of every edit held, which would make a
//! million writes take hours; what `draft_on` itself costs at each size is timed apart (`draft_on_us`). Only numbers
//! are printed: no body, key or id.

use crate::common;

use std::collections::{BTreeMap, HashMap};
use std::time::Instant;

use avendb::id::{EditId, EntryId, SignerId, VaultId};
use avendb::index::{tokens, type_label, Row, Rows};
use avendb::keys::{KeyFam, Secret};
use avendb::policy::{replay, replay_on, Action, Edit, Log, Proposal, Replay, State};
use avendb::sync::{log_of, place, LogId};
use common::*;
use serde_json::{json, Value};

/// The edits of a page of a first sync, as in `replay_scale.rs`.
const PAGE: usize = 600;
/// The types a view asks for: an entry is of one, so a view of one type holds a sixteenth of the entries.
const TYPES: u64 = 16;
/// The last tenth of the writes, whose cost per edit is compared across sizes: what a write costs once about that much
/// is held, over enough writes that a growth of the log's vectors falls in it as often as in all of them.
const TENTH: usize = 10;
/// The log's bytes an edit, at most: a count, so it gates (Goal 7a W1); every timing here is printed only.
const LOG_BYTES_PER_EDIT_MAX: f64 = 4_000.0;
/// The point reads, views and `draft_on`s timed, for their percentiles.
const READS: usize = 20_000;
const VIEWS: usize = 400;
const DRAFTS: usize = 40;

/// Entry `i` of the fixture.
fn entry(i: u64) -> EntryId {
    EntryId::from_u64(1000 + i)
}

/// The entry the `k`th write goes to, of `entries`.
fn target(k: usize, entries: u64) -> EntryId {
    entry((k as u64).wrapping_mul(7919) % entries)
}

/// The entries `n` writes are spread over: one per 50, at least 200.
fn entries_for(n: usize) -> u64 {
    (n as u64 / 50).max(200)
}

/// The write of `n` on entry `e` by `by`, as `replay_scale.rs` writes, before it is drafted: its deps and via empty.
fn action(st: &State, e: EntryId, n: usize) -> Action {
    let en = st.entry(e).expect("an entry");
    let epoch = st.epoch(KeyFam::Audience(en.vault, en.audience()));
    let body = n.to_le_bytes().to_vec();
    let (vault, actor, stay, deps, via, files) = (en.vault, en.vault, en.stay(), vec![], vec![], vec![]);
    Action::Write { vault, entry: e, actor, stay, epoch, deps, proposal: Proposal::Main, via, create: None, files, body: body.into() }
}

/// Drafts a write as `Log::draft_on` does, keeping what that finds by a scan of every edit held: the deepest edit's
/// depth, and the frontier of the write's log, which here, each entry's log one chain of the device's own, is its last
/// edit.
struct Drafter {
    depth: u64,
    last: HashMap<LogId, EditId>,
}

impl Drafter {
    fn new(log: &Log) -> Self {
        let depth = log.edits().iter().map(|e| e.depth + 1).max().unwrap_or(0);
        let last = log.edits().iter().zip(log.ids()).filter_map(|(e, id)| Some((log_of(e, *id)?, *id))).collect();
        Drafter { depth, last }
    }

    fn draft(&self, st: &State, by: SignerId, e: EntryId, n: usize) -> Edit {
        let mut action = action(st, e, n);
        if let Action::Write { deps, via, actor, .. } = &mut action {
            *deps = st.heads(e, None);
            if let Some(chain) = st.via(by, *actor) {
                *via = chain;
            }
        }
        let parents = self.last.get(&LogId::Entry(e)).into_iter().copied().collect();
        Edit { parents, depth: self.depth, author: by, cosigners: vec![], action }
    }

    /// The creation of entry `e` of vault `v`, for `v`, by `by`.
    fn create(&self, st: &State, by: SignerId, v: VaultId, e: EntryId) -> Edit {
        let mut action = creation(v, e, v, &[]);
        if let Action::Write { via, .. } = &mut action
            && let Some(chain) = st.via(by, v)
        {
            *via = chain;
        }
        let parents = self.last.get(&LogId::Entry(e)).into_iter().copied().collect();
        Edit { parents, depth: self.depth, author: by, cosigners: vec![], action }
    }

    /// The log took `edit`, whose id is `id`.
    fn took(&mut self, edit: &Edit, id: EditId) {
        self.depth = self.depth.max(edit.depth + 1);
        if let Some(l) = log_of(edit, id) {
            self.last.insert(l, id);
        }
    }
}

/// Alice's Mac with `entries` entries created, drafted as `draft_on` drafts (`Log::append`, which checks each against a
/// replay of every edit held, made 20,000 entries take minutes), and the drafter of her writes from there.
fn start(entries: u64) -> (Log, Replay, Drafter) {
    let c = cast();
    let (mut log, alice) = (c.log, c.alice);
    let mut was = replay(log.edits());
    let mut d = Drafter::new(&log);
    for i in 0..entries {
        let edit = d.create(&was.state, MAC_A, alice, entry(i));
        let before = log.edits().len();
        log.receive([edit]);
        was = replay_on(was, log.edits(), before);
        d.took(&log.edits()[before], log.ids()[before]);
    }
    assert_eq!(was.state.entries().len(), entries as usize, "every entry created");
    (log, was, d)
}

/// The seconds `held`'s writes took: in all, over the last tenth, and drafting, receiving and stepping on each.
struct Held {
    all: f64,
    tail: f64,
    window: usize,
    parts: [f64; 3],
}

/// Alice's Mac writes `n` edits over `entries` entries, each drafted, received and stepped on alone.
fn held(n: usize, entries: u64) -> (Log, Replay, Held) {
    let (mut log, mut was, mut d) = start(entries);
    let window = (n / TENTH).max(1);
    let (t, mut tail) = (Instant::now(), None);
    let mut parts = [0f64; 3];
    for k in 0..n {
        if k == n - window {
            tail = Some(Instant::now());
        }
        let t0 = Instant::now();
        let edit = d.draft(&was.state, MAC_A, target(k, entries), k);
        let t1 = Instant::now();
        let before = log.edits().len();
        log.receive([edit]);
        let t2 = Instant::now();
        was = replay_on(was, log.edits(), before);
        parts[0] += (t1 - t0).as_secs_f64();
        parts[1] += (t2 - t1).as_secs_f64();
        parts[2] += t2.elapsed().as_secs_f64();
        d.took(&log.edits()[before], log.ids()[before]);
    }
    let all = t.elapsed().as_secs_f64();
    let tail = tail.map_or(all, |t| t.elapsed().as_secs_f64());
    assert_eq!(was.state.all_writes().len(), entries as usize + n, "every write stood");
    (log, was, Held { all, tail, window, parts })
}

/// The seconds a device that holds nothing takes to receive the edits of `log` in pages of `PAGE`, in the one order,
/// each page stepped on: how fast edits come in many at a time.
fn intake(log: Log, writes: usize) -> f64 {
    let mut edits = log.edits().to_vec();
    drop(log);
    edits.sort_by_key(place);
    let (mut to, mut r) = (Log::new(), replay(avendb::policy::Edits::empty()));
    let t = Instant::now();
    for page in edits.chunks(PAGE) {
        let before = to.edits().len();
        to.receive(page.to_vec());
        r = replay_on(r, to.edits(), before);
    }
    let s = t.elapsed().as_secs_f64();
    assert_eq!(r.state.all_writes().len(), writes, "every write stood");
    s
}

/// The resident memory of this process now, in KiB: Linux's /proc, else `ps` (macOS).
fn rss_kib() -> Option<u64> {
    if let Ok(s) = std::fs::read_to_string("/proc/self/status") {
        let line = s.lines().find(|l| l.starts_with("VmRSS:"))?;
        return line.split_whitespace().nth(1)?.parse().ok();
    }
    let pid = std::process::id().to_string();
    let out = std::process::Command::new("ps").args(["-o", "rss=", "-p", &pid]).output().ok()?;
    String::from_utf8(out.stdout).ok()?.trim().parse().ok()
}

/// The `p`th percentile of `xs` seconds, in microseconds.
fn pct(xs: &[f64], p: f64) -> f64 {
    let mut xs = xs.to_vec();
    xs.sort_by(f64::total_cmp);
    let i = ((xs.len() as f64 * p).ceil() as usize).clamp(1, xs.len()) - 1;
    xs[i] * 1e6
}

fn round(x: f64, places: i32) -> f64 {
    let m = 10f64.powi(places);
    (x * m).round() / m
}

/// A small deterministic generator, so every run asks the same reads.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
}

/// What a write, a point read and a view of one type cost with `n` writes held: one `BENCH` line.
fn scale(n: usize) -> Value {
    let entries = entries_for(n);
    let rss0 = rss_kib();
    let (log, was, h) = held(n, entries);
    let rss1 = rss_kib();

    // what `draft_on` costs, which a device's every write goes through, with this much held
    let mut drafts = Vec::with_capacity(DRAFTS);
    for k in 0..DRAFTS {
        let a = action(&was.state, target(k, entries), k);
        let t = Instant::now();
        std::hint::black_box(log.draft_on(&was.state, MAC_A, &[], a));
        drafts.push(t.elapsed().as_secs_f64());
    }

    // a point read: an entry's last write, and the edit that brought it
    let mut rng = Lcg(42);
    let mut reads = Vec::with_capacity(READS);
    for _ in 0..READS {
        let e = entry(rng.next() % entries);
        let t = Instant::now();
        let (count, tip) = was.state.entry_tip(e);
        let w = was.state.write(tip.expect("a write")).expect("the write");
        let edit = log.entry_write(w.edit).expect("its edit");
        reads.push(t.elapsed().as_secs_f64());
        std::hint::black_box((count, edit));
    }

    // a view: the entries of one type, a page from the blind index (as a peer that keeps one answers `find`), each with
    // its last write, as a view lists them
    let index = Secret::from_bytes([7; 32]).child("avenDB bench index", b"");
    let mut rows: BTreeMap<VaultId, Vec<Row>> = BTreeMap::new();
    for i in 0..entries {
        let en = was.state.entry(entry(i)).expect("an entry");
        let labels = [type_label(&format!("t{}", i % TYPES))];
        let row = Row { entry: en.id, epoch: 0, tokens: tokens(std::slice::from_ref(&index), en.audience(), &labels) };
        rows.entry(en.vault).or_default().push(row);
    }
    let mut ix = Rows::default();
    for (v, rs) in rows {
        ix.take(MAC_A, v, rs, |_| true);
    }
    let audience = was.state.entry(entry(0)).expect("an entry").audience();
    let mut views = Vec::with_capacity(VIEWS);
    let mut listed = 0;
    for q in 0..VIEWS {
        let label = type_label(&format!("t{}", q as u64 % TYPES));
        let t = Instant::now();
        let want = tokens(std::slice::from_ref(&index), audience, &[label]);
        let (hits, _more) = ix.find(None, &want, None, |_| true);
        let page: Vec<_> = hits.into_iter().map(|e| (e, was.state.entry_tip(e))).collect();
        views.push(t.elapsed().as_secs_f64());
        listed = listed.max(page.len());
        std::hint::black_box(page);
    }

    // last, the log handed over and the replay let go, so a million edits are held but twice
    let (edits, writes) = (log.edits().len(), was.state.all_writes().len());
    // what the log keeps of an edit on disk: its bytes, its id, and a signature of its own (one ML-DSA-65 an edit while
    // segments are off; S8 signs a segment once instead)
    let edit_bytes = log.edits().iter().map(|e| avendb::encode::bytes(e).len()).sum::<usize>() as f64 / edits as f64;
    let log_bytes = edit_bytes + 32.0 + avendb::sign::ML_DSA_SIGNATURE_BYTES as f64;
    drop(was);
    let intake_s = intake(log, writes);

    let per_edit = |s: f64| round(s * 1e6 / n as f64, 2);
    let (receive_us, step_us) = (per_edit(h.parts[1]), per_edit(h.parts[2]));
    let draft_on_us = round(pct(&drafts, 0.5), 1);
    let rss_per_edit = match (rss0, rss1) {
        (Some(a), Some(b)) => json!((b.saturating_sub(a) as f64 * 1024.0 / n as f64).round()),
        _ => Value::Null,
    };
    json!({
        "kind": "scale",
        "n": n,
        "entries": entries,
        "write_s": round(h.all, 3),
        "writes_per_s": (n as f64 / h.all).round(),
        "us_per_edit": per_edit(h.all),
        "tail_us_per_edit": round(h.tail * 1e6 / h.window as f64, 2),
        "draft_us_per_edit": per_edit(h.parts[0]),
        "receive_us_per_edit": receive_us,
        "step_us_per_edit": step_us,
        "draft_on_us": draft_on_us,
        "device_writes_per_s": (1e6 / (draft_on_us + receive_us + step_us)).round(),
        "intake_s": round(intake_s, 3),
        "intake_per_s": (edits as f64 / intake_s).round(),
        "rss_kib_before": rss0,
        "rss_kib_after": rss1,
        "rss_bytes_per_edit": rss_per_edit,
        "read_p50_us": round(pct(&reads, 0.50), 2),
        "read_p95_us": round(pct(&reads, 0.95), 2),
        "view_rows": listed,
        "view_p50_us": round(pct(&views, 0.50), 1),
        "view_p95_us": round(pct(&views, 0.95), 1),
        "edit_bytes_per_edit": round(edit_bytes, 1),
        "log_bytes_per_edit": log_bytes.round(),
    })
}

/// A new device taking what Alice's Mac wrote (`n` writes over `entries` entries), a page at a time, as
/// `replay_scale.rs`'s `first_sync`: the logs 256 at a time as the pull asked before, or every log in one asking. The
/// seconds each took, all pages stepped on, each held to the whole replayed.
fn first_sync(n: usize, entries: u64) -> Value {
    let (log, _, _) = held(n, entries);
    let all: Vec<(Option<LogId>, Edit)> =
        log.edits().iter().zip(log.ids()).map(|(e, id)| (log_of(e, *id), e.clone())).collect();
    let take = |pages: Vec<Vec<Edit>>| {
        let (mut log, mut r) = (Log::new(), replay(avendb::policy::Edits::empty()));
        let t = Instant::now();
        for page in pages {
            let before = log.edits().len();
            log.receive(page);
            r = replay_on(r, log.edits(), before);
        }
        let s = t.elapsed().as_secs_f64();
        assert!(r == replay(log.edits()), "a first sync stepped on differs from the whole");
        s
    };
    let paged = |mut edits: Vec<Edit>| -> Vec<Vec<Edit>> {
        edits.sort_by_key(place);
        edits.chunks(PAGE).map(<[Edit]>::to_vec).collect()
    };
    // before: the logs no entry's first, then the entries' logs 256 at a time
    let mut logs: Vec<_> = all.iter().map(|(l, _)| *l).collect::<std::collections::BTreeSet<_>>().into_iter().collect();
    logs.sort_by_key(|l| matches!(l, Some(LogId::Entry(_))));
    let mut batched = vec![];
    for chunk in logs.chunks(256) {
        let edits = all.iter().filter(|(l, _)| chunk.contains(l)).map(|(_, e)| e.clone()).collect();
        batched.extend(paged(edits));
    }
    let one = paged(all.iter().map(|(_, e)| e.clone()).collect());
    let (batched_s, one_s) = (take(batched), take(one));
    json!({
        "kind": "first",
        "n": n,
        "entries": entries,
        "batched_s": round(batched_s, 3),
        "one_asking_s": round(one_s, 3),
        "speedup": round(batched_s / one_s, 2),
    })
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_owned())
}

#[test]
fn the_lean_draft_is_draft_on() {
    let entries = 50;
    let c = cast();
    let (mut log, alice) = (c.log, c.alice);
    let mut was = replay(log.edits());
    let mut d = Drafter::new(&log);
    for i in 0..entries {
        let edit = d.create(&was.state, MAC_A, alice, entry(i));
        let drafted = log.draft_on(&was.state, MAC_A, &[], creation(alice, entry(i), alice, &[]));
        assert_eq!(edit, drafted, "entry {i} drafted otherwise");
        log.append(MAC_A, &[], creation(alice, entry(i), alice, &[])).expect("an entry `append` takes");
        assert_eq!(log.edits().last(), Some(&edit), "entry {i} appended otherwise");
        was = replay(log.edits());
        d.took(log.edits().last().expect("an edit"), *log.ids().last().expect("an id"));
    }
    for k in 0..600 {
        let e = target(k, entries);
        let edit = d.draft(&was.state, MAC_A, e, k);
        assert_eq!(edit, log.draft_on(&was.state, MAC_A, &[], action(&was.state, e, k)), "write {k} drafted otherwise");
        let before = log.edits().len();
        log.receive([edit]);
        was = replay_on(was, log.edits(), before);
        d.took(&log.edits()[before], log.ids()[before]);
    }
    assert!(was == replay(log.edits()), "the writes stepped on differ from the whole");
}

#[test]
fn the_bench_measures_a_small_log() {
    let line = scale(1_000);
    assert_eq!(line["n"], 1_000);
    assert!(line["view_rows"].as_u64().expect("rows") > 0, "a view lists entries");
    // the log's bytes an edit, a count that holds on any machine (3,585 on 2026-10-27: 244 bytes an edit, its id, one
    // ML-DSA-65 signature an edit while S8 is off)
    let bytes = line["log_bytes_per_edit"].as_f64().expect("log bytes an edit");
    assert!(bytes <= LOG_BYTES_PER_EDIT_MAX, "the log takes {bytes} bytes an edit, at most {LOG_BYTES_PER_EDIT_MAX}");
    let first = first_sync(1_000, 300);
    assert!(first["speedup"].as_f64().expect("a speedup") > 0.0);
}

#[test]
#[ignore]
fn bench_scale() {
    for n in env_or("AVENDB_BENCH_N", "10000").split(',') {
        let line = scale(n.trim().parse().expect("AVENDB_BENCH_N: sizes"));
        println!("BENCH {line}");
    }
}

#[test]
#[ignore]
fn bench_first_sync() {
    for spec in env_or("AVENDB_BENCH_FIRST", "10000:2000").split(',') {
        let (n, entries) = spec.trim().split_once(':').expect("AVENDB_BENCH_FIRST: n:entries");
        let line = first_sync(n.parse().expect("n"), entries.parse().expect("entries"));
        println!("BENCH {line}");
    }
}
