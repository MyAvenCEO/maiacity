//! avenDB's live sync gates (plan D3, Samuel 2026-10-27): how long one edit written on a device takes to show on
//! another while that other catches up on a bulk of the first's history, and how much of its link the catch-up uses,
//! on a simulated link (`avendb_net::sim`) as calm as loopback or as a phone's (50 Mbit/s, 40 ms round trip, 1 % lost).
//! What failed on the iPhone on 2026-10-27 was this: live pulls that waited out their 10 s while the Mac caught up.
//!
//! Plain tests since Goal 7a (W1, Samuel 2026-10-28: benchmarks out of CI): every run is on simulated time, one thread
//! with tokio's clock paused, so time moves only as the link's packets and the nodes' timers say and stands still
//! while a node works. A link's use and a live edit's delay are then the protocol's against the link, not the runner's
//! CPU (on the wall clock, the same code gave 0.23 to 0.49 of the phone's link on one runner), the same run after run,
//! so the gates sit at the real targets: no live edit missed, each shown within 500 ms at p95 during a catch-up and
//! after it, at most 5 % of the edits sent again, and a phone's bulk catch-up using at least 0.8 of its link.
//!
//! `bench_live` prints the same runs, gated by nothing, for a by-hand look (on the wall clock with `AVENDB_LIVE_WALL`):
//!
//!   AVENDB_LIVE_LINK=phone,phone_bulk cargo test -p avendb-net --features test-fixtures --test sync_bench -- \
//!     --ignored --nocapture bench_live
//!
//! `AVENDB_LIVE_LINK` is `calm` or `phone`, or both, comma-separated, with a bulk of `AVENDB_LIVE_BULK` edits (600);
//! `phone_bulk` (or `calm_bulk`) is that link with a bulk of `AVENDB_LIVE_BULK_MB` (20) of 48 KB edits instead, for the
//! catch-up's use of the link (G3), where the wire's time and not the receiver's cost per edit is most of it.
//! `AVENDB_LIVE_LOSE` (thousandths) sets the phone's loss. Alice's Mac writes the bulk before either node starts; Bob's
//! Mac asks it for what it lacks till it holds all, while Alice's Mac writes a live edit every `EVERY` and each is timed
//! from its write to Bob's Mac holding it, during the catch-up and after it. Only numbers are printed.

use std::collections::HashSet;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::time::Instant as Clock;

use avendb::cast::*;
use avendb::id::EditId;
use avendb::wire::Wire;
use avendb_net::sim::{Faults, Net};
use avendb_net::{Node, Options};
use serde_json::json;

/// The entries the bulk goes to, in turn.
const ENTRIES: u64 = 8;
/// How often Alice's Mac writes a live edit during a catch-up: often enough that one of four seconds gives the 40 a p95
/// needs.
const EVERY: Duration = Duration::from_millis(100);
/// How often it writes one once the catch-up is over: as a person types, for the idle round trip.
const IDLE_EVERY: Duration = Duration::from_millis(250);
/// The live edits written once the catch-up is over, for the idle round trip.
const AFTER: usize = 10;
/// The longest a live edit is waited for: past it, it counts as missed, at this time.
const MISS: Duration = Duration::from_secs(15);
/// The text of each edit of a `_bulk` link's bulk: big, so that the catch-up's time is the wire's, not the receiver's
/// cost per edit (G3, the link's use).
const FAT: usize = 48 << 10;

fn pct(xs: &[f64], p: f64) -> f64 {
    if xs.is_empty() {
        return f64::NAN;
    }
    let mut s = xs.to_vec();
    s.sort_by(f64::total_cmp);
    s[((s.len() as f64 * p).ceil() as usize).saturating_sub(1).min(s.len() - 1)]
}

fn ms(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

/// Whether Bob's Mac holds edit `id`.
async fn holds(n: &Node, id: EditId) -> bool {
    n.read(move |lab, me| lab.log(me).ids().contains(&id)).await
}

/// One live edit by Alice's Mac on `entry`, and the milliseconds till Bob's Mac holds it (`MISS` at most).
async fn live(mac: Arc<Node>, bob: Arc<Node>, coop: avendb::id::VaultId, entry: avendb::id::EntryId, k: u64) -> f64 {
    let t = Clock::now();
    let write = move |lab: &mut avendb::lab::Lab, me| lab.edit(me, coop, entry, |item| item.push_block(paragraph(900_000 + k, "live")));
    let id = mac.act(write).await.expect("a live edit");
    while !holds(&bob, id).await {
        if t.elapsed() > MISS {
            return MISS.as_secs_f64() * 1000.0;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    t.elapsed().as_secs_f64() * 1000.0
}

/// The gates every link's run is held to (Goal 7a W1: on simulated time, so a gate sits at the real target): a live
/// edit's delay during the catch-up and after it, p95.
const LIVE_P95_MS_MAX: f64 = 500.0;
/// The share of the edits a page brought that Bob's Mac held already.
const RESENT_MAX: f64 = 0.05;
/// The share of a set-rate link a `_bulk` catch-up uses (Goal 7's task 19: back to 0.8 from Goal 6's 0.75).
const LINK_SHARE_MIN: f64 = 0.8;
/// The live edits a `phone_bulk` run times during its catch-up, at least: its p95 needs them.
const BUSY_SAMPLES_MIN: usize = 40;
/// The bulk of a test's `calm` and `phone` links: what a debug build writes in seconds (each write replays the whole
/// log, so writing grows with its square); the bench's default is 600.
const TEST_BULK: usize = 300;

/// The links of `AVENDB_LIVE_LINK`, each printed as a `BENCH` line, none gated: for a by-hand run, on the wall clock
/// with `AVENDB_LIVE_WALL`. The tests below hold the same runs to their gates.
#[test]
#[ignore = "a bench, printed only: the tests below hold its gates"]
fn bench_live() {
    // one link or both: their worlds written side by side, each on a thread of its own, then the links one after
    // another, so no link's catch-up shares the machine with another's
    let bulk: usize = std::env::var("AVENDB_LIVE_BULK").ok().and_then(|n| n.parse().ok()).unwrap_or(600);
    let cases: Vec<String> =
        std::env::var("AVENDB_LIVE_LINK").unwrap_or_else(|_| "phone".into()).split(',').map(|c| c.trim().to_string()).collect();
    let writing: Vec<_> = cases
        .iter()
        .map(|c| {
            let c = c.clone();
            std::thread::spawn(move || fixture_for(&c, bulk))
        })
        .collect();
    let fixtures: Vec<Fixture> = writing.into_iter().map(|t| t.join().expect("a fixture")).collect();
    let wall = std::env::var("AVENDB_LIVE_WALL").is_ok();
    for (case, f) in cases.into_iter().zip(fixtures) {
        println!("BENCH {}", run(&case, f, wall).line());
    }
}

/// A live edit shows on Bob's Mac within half a second while it catches up on a bulk of history over a phone's link
/// (50 Mbit/s, 40 ms round trip, 1 % lost), and after: what failed on the iPhone on 2026-10-27 (G4).
#[test]
fn a_live_edit_shows_while_a_phone_catches_up() {
    held("phone", run("phone", fixture_for("phone", TEST_BULK), false));
}

/// The same on a calm link.
#[test]
fn a_live_edit_shows_while_a_calm_link_catches_up() {
    held("calm", run("calm", fixture_for("calm", TEST_BULK), false));
}

/// A catch-up on a phone's link of 20 MB of history uses at least `LINK_SHARE_MIN` of it, and live edits still show
/// within half a second (G3, G4).
#[test]
fn a_phone_catch_up_uses_its_link() {
    let r = run("phone_bulk", fixture_for("phone_bulk", 0), false);
    let line = r.line();
    assert!(r.busy.len() >= BUSY_SAMPLES_MIN, "{} live edits timed during the catch-up, {BUSY_SAMPLES_MIN} wanted: {line}", r.busy.len());
    let share = r.share().expect("a set-rate link");
    assert!(share >= LINK_SHARE_MIN, "the catch-up used {share:.3} of its link, {LINK_SHARE_MIN} wanted: {line}");
    held("phone_bulk", r);
}

/// The gates every run holds: no live edit missed, each shown within `LIVE_P95_MS_MAX` at p95, during the catch-up and
/// after it, and at most `RESENT_MAX` of the edits sent again.
fn held(case: &str, r: Run) {
    let line = r.line();
    eprintln!("BENCH {line}");
    assert_eq!(r.missed(), 0, "{case}: live edits not there in 15 s: {line}");
    for (when, xs) in [("during the catch-up", &r.busy), ("idle", &r.idle)] {
        let p95 = pct(xs, 0.95);
        assert!(p95 < LIVE_P95_MS_MAX, "{case}: a live edit's delay {when}, p95 {p95:.1} ms: {line}");
    }
    assert!(r.resent() <= RESENT_MAX, "{case}: {:.3} of the edits sent again: {line}", r.resent());
}

/// `case`'s fixture: a `_bulk` link's bulk is `AVENDB_LIVE_BULK_MB` of edits of `FAT` text each (20 MB by default), any
/// other's `bulk` small edits.
fn fixture_for(case: &str, bulk: usize) -> Fixture {
    let mb: usize = std::env::var("AVENDB_LIVE_BULK_MB").ok().and_then(|n| n.parse().ok()).unwrap_or(20);
    if case.ends_with("_bulk") { fixture(mb * 1_000_000 / FAT, FAT) } else { fixture(bulk, 0) }
}

/// One link's run: on simulated time, one thread with tokio's clock paused, so that time moves only as the link's
/// packets and the nodes' timers say and stands still while a node works (on the thread, or on a blocking one, which
/// holds the clock); the same code gives the same numbers, whatever the machine. `wall`: on the wall clock instead,
/// four threads, to compare.
fn run(case: &str, f: Fixture, wall: bool) -> Run {
    let rt = if wall {
        tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build()
    } else {
        tokio::runtime::Builder::new_current_thread().enable_all().start_paused(true).build()
    };
    rt.expect("a runtime").block_on(live_on(case.to_string(), f))
}

/// A world in which Alice's Mac wrote a bulk of `bulk` edits Bob's Mac lacks, and an entry for the live edits that Bob's
/// Mac holds.
struct Fixture {
    w: World,
    coop: avendb::id::VaultId,
    live_entry: avendb::id::EntryId,
    want: Vec<EditId>,
    bytes: usize,
    write_s: f64,
}

/// `text`, where not 0, is the bytes of text each bulk edit carries.
fn fixture(bulk: usize, text: usize) -> Fixture {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    let (mac_a, mac_b) = (w.mac_a, w.mac_b);
    let t = Instant::now();
    let mut entries = vec![];
    for i in 0..ENTRIES {
        let doc = document(&format!("Bulk {i}"), "the live bench's bulk", mac_a);
        entries.push(w.lab.create(mac_a, coop, coop, "doc", &[], doc).expect("an entry"));
    }
    let live_entry = w.lab.create(mac_a, coop, coop, "doc", &[], document("Live", "the live bench", mac_a)).expect("an entry");
    w.lab.sync_all(0);
    let held: HashSet<EditId> = w.lab.log(mac_b).ids().iter().copied().collect();
    for k in 0..bulk {
        if text > 0 {
            // a fat edit makes an entry of its own, so that no document grows past one edit's text and each write
            // costs what one edit does; letters at random, so that no layer squeezes them
            let body: String = (0..text).map(|i| (b'a' + ((k * 7919 + i * 104_729) % 9973 % 26) as u8) as char).collect();
            w.lab.create(mac_a, coop, coop, "doc", &[], document(&format!("Bulk {k}"), &body, mac_a)).expect("an entry");
            continue;
        }
        let entry = entries[k % entries.len()];
        let text = format!("edit {k} of the live bench's bulk");
        w.lab.edit(mac_a, coop, entry, |item| item.push_block(paragraph(100 + k as u64, &text))).expect("an edit");
    }
    let backup = w.lab.backup(mac_a);
    let fresh: Vec<_> = backup.signed().iter().filter(|s| !held.contains(&s.edit.id())).collect();
    let want: Vec<EditId> = fresh.iter().map(|s| s.edit.id()).collect();
    let bytes: usize = fresh.iter().map(|s| s.to_wire().len()).sum();
    Fixture { w, coop, live_entry, want, bytes, write_s: t.elapsed().as_secs_f64() }
}

/// One link: Bob's Mac catching up on the fixture's bulk while live edits come.
async fn live_on(case: String, f: Fixture) -> Run {
    let faults = match case.trim_end_matches("_bulk") {
        "calm" => Faults::CALM,
        // `AVENDB_LIVE_LOSE` (thousandths) sets the phone's loss instead of its 1 %, to compare
        "phone" => Faults { lose: std::env::var("AVENDB_LIVE_LOSE").ok().and_then(|n| n.parse().ok()).unwrap_or(Faults::PHONE.lose), ..Faults::PHONE },
        other => panic!("AVENDB_LIVE_LINK: {other} is none of calm, phone, calm_bulk, phone_bulk"),
    };
    let Fixture { mut w, coop, live_entry, want, bytes, write_s } = f;
    let (mac_a, passkey_a, mac_b, passkey_b) = (w.mac_a, w.passkey_a, w.mac_b, w.passkey_b);

    let net = Net::with(1, faults);
    let mac = Arc::new(Node::spawn(w.lab.split(mac_a, &[passkey_a], [1; 32]), mac_a, Options::simulated(&net)).await.expect("Alice's Mac"));
    let bob = Arc::new(Node::spawn(w.lab.split(mac_b, &[passkey_b], [3; 32]), mac_b, Options::simulated(&net)).await.expect("Bob's Mac"));
    mac.know(bob.addr());
    bob.know(mac.addr());

    // Bob's Mac catches up, asking Alice's till it holds the bulk
    let caught = Arc::new(AtomicBool::new(false));
    let t = Clock::now();
    let catch_up = {
        let (bob, mac_id, caught, want) = (bob.clone(), mac.id(), caught.clone(), want.clone());
        tokio::spawn(async move {
            let mut asks = 0;
            loop {
                let want = want.clone();
                let missing = bob
                    .read(move |lab, me| {
                        let ids: HashSet<&EditId> = lab.log(me).ids().iter().collect();
                        want.iter().filter(|id| !ids.contains(id)).count()
                    })
                    .await;
                if missing == 0 {
                    break;
                }
                assert!(t.elapsed() < Duration::from_secs(240), "Bob's Mac catches up within 4 minutes ({missing} missing)");
                asks += 1;
                bob.sync_with(mac_id).await.ok();
            }
            caught.store(true, Ordering::SeqCst);
            (t.elapsed().as_secs_f64(), asks)
        })
    };

    // a live edit every `EVERY` all the while, each timed on its own, and `AFTER` more once the catch-up is over
    let (mut busy, mut idle) = (vec![], vec![]);
    let mut k = 0;
    while !caught.load(Ordering::SeqCst) {
        busy.push(tokio::spawn(live(mac.clone(), bob.clone(), coop, live_entry, k)));
        k += 1;
        tokio::time::sleep(EVERY).await;
    }
    let (sync_s, asks) = catch_up.await.expect("the catch-up");
    for _ in 0..AFTER {
        idle.push(tokio::spawn(live(mac.clone(), bob.clone(), coop, live_entry, k)));
        k += 1;
        tokio::time::sleep(IDLE_EVERY).await;
    }
    let took = |tasks: Vec<tokio::task::JoinHandle<f64>>| async move {
        let mut out = vec![];
        for t in tasks {
            out.push(t.await.expect("a live edit timed"));
        }
        out
    };
    let busy = took(busy).await;
    let idle = took(idle).await;
    // what Bob's Mac took to get there: the edits its pages brought against those new to it, and the bytes it received
    let network = bob.network().await;
    let peers = network["peers"].as_array().cloned().unwrap_or_default();
    let sum = |f: &dyn Fn(&serde_json::Value) -> Option<u64>| peers.iter().filter_map(|p| f(p)).sum::<u64>();
    let (got, new) = (sum(&|p| p["pulled"]["edits"].as_u64()), sum(&|p| p["pulled"]["new"].as_u64()));
    let rx = sum(&|p| p["rx"].as_u64());
    let counts = net.counts();
    mac.shutdown().await.expect("the node shuts down");
    bob.shutdown().await.expect("the node shuts down");
    Run { case, faults, edits: want.len(), bytes, write_s, sync_s, asks, got, new, rx, sent: counts.sent, lost: counts.lost, busy, idle }
}

/// What one link's run measured: Bob's Mac's catch-up, what its pages brought, and each live edit's delay, ms.
struct Run {
    case: String,
    faults: Faults,
    edits: usize,
    bytes: usize,
    write_s: f64,
    sync_s: f64,
    asks: usize,
    got: u64,
    new: u64,
    rx: u64,
    sent: u64,
    lost: u64,
    busy: Vec<f64>,
    idle: Vec<f64>,
}

impl Run {
    /// The share of a set-rate link the catch-up used.
    fn share(&self) -> Option<f64> {
        (self.faults.rate > 0).then(|| self.bytes as f64 / self.sync_s / self.faults.rate as f64)
    }

    /// The edits Bob's Mac's pages brought that it held already, over those new to it.
    fn resent(&self) -> f64 {
        if self.new > 0 { self.got as f64 / self.new as f64 - 1.0 } else { 0.0 }
    }

    fn missed(&self) -> usize {
        self.busy.iter().chain(&self.idle).filter(|&&m| m >= MISS.as_secs_f64() * 1000.0).count()
    }

    fn line(&self) -> serde_json::Value {
        let r3 = |x: f64| (x * 1000.0).round() / 1000.0;
        let peak_kib = std::fs::read_to_string("/proc/self/status").ok().and_then(|s| {
            s.lines().find(|l| l.starts_with("VmHWM:"))?.split_whitespace().nth(1)?.parse::<u64>().ok()
        });
        json!({
            "kind": "live",
            "link": self.case,
            "edits": self.edits,
            "wire_bytes": self.bytes,
            "bytes_per_edit": self.bytes / self.edits.max(1),
            "write_s": r3(self.write_s),
            "sync_s": r3(self.sync_s),
            "asks": self.asks,
            "edits_per_s": (self.edits as f64 / self.sync_s).round(),
            "bytes_per_s": (self.bytes as f64 / self.sync_s).round(),
            "link_bytes_per_s": (self.faults.rate > 0).then_some(self.faults.rate),
            "link_share": self.share().map(r3),
            "pulled_edits": self.got,
            "pulled_new": self.new,
            "resent_ratio": r3(self.resent()),
            "rx_bytes": self.rx,
            "rx_per_wire_byte": ((self.rx as f64 / self.bytes.max(1) as f64) * 100.0).round() / 100.0,
            "peak_kib": peak_kib,
            "packets_sent": self.sent,
            "packets_lost": self.lost,
            "live_busy": self.busy.len(),
            "live_busy_p50_ms": ms(pct(&self.busy, 0.5)),
            "live_busy_p95_ms": ms(pct(&self.busy, 0.95)),
            "live_idle_p50_ms": ms(pct(&self.idle, 0.5)),
            "live_idle_p95_ms": ms(pct(&self.idle, 0.95)),
            "live_missed": self.missed(),
        })
    }
}
