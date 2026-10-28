//! avenDB's live sync gate (plan D3, Samuel 2026-10-27): how long one edit written on a device takes to show on
//! another while that other catches up on a bulk of the first's history, and how fast the catch-up runs, on a
//! simulated link (`avendb_net::sim`) as calm as loopback or as a phone's (50 Mbit/s, 40 ms round trip, 1 % lost).
//! What failed on the iPhone on 2026-10-27 was this: live pulls that waited out their 10 s while the Mac caught up.
//! Each case prints one `BENCH {...}` line (`kind: "live"`) for `scripts/ci/avendb-bench.mjs`:
//!
//!   AVENDB_LIVE_LINK=phone AVENDB_LIVE_BULK=600 RUSTFLAGS="--cfg avendb_no_replay_checks" cargo test --profile live \
//!     -p avendb-net --features test-fixtures --test sync_bench -- --ignored --nocapture
//!
//! `--profile live` optimises as a release does, and `avendb_no_replay_checks` leaves out the debug checks that replay
//! a device's whole log on each write (`lab.rs`): with them, the live gates timed the debug build (2026-10-28, phone_bulk
//! 60 s and 0.06 of the link in debug, 5.7 s and 0.64 without them). `test-fixtures` refuses a release build.
//!
//! The bulk is 600 edits by default: the Lab checks each write against a replay of its whole log in a debug build (as
//! `test-fixtures` needs), so writing the bulk grows with its square, about 18 s at 600 and 50 s at 1,000.
//!
//! `AVENDB_LIVE_LINK` is `calm` or `phone`, or both, comma-separated; `phone_bulk` (or `calm_bulk`) is that link with a
//! bulk of `AVENDB_LIVE_BULK_MB` (20) of 48 KB edits instead, for the catch-up's use of the link (G3), where the wire's
//! time and not the receiver's cost per edit is most of it. Alice's Mac writes the bulk before either node starts; Bob's Mac asks it
//! for what it lacks till it holds all, while Alice's Mac writes a live edit every `EVERY` and the bench times each
//! from its write to Bob's Mac holding it, during the catch-up and after it. Only numbers are printed.
//!
//! A `_bulk` link runs on simulated time (Goal 6, 2026-10-28): one thread with tokio's clock paused, so time moves only
//! as the link's packets and the nodes' timers say and stands still while a node works, and its use of the link is the
//! protocol's against the link, not the runner's CPU (on the wall clock, the same code gave 0.23 to 0.49 on one
//! runner). `AVENDB_LIVE_WALL` runs it on the wall clock instead, to compare.

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
/// needs. (In a debug build each write replays the whole log, which starved a 20 MB catch-up; the live shard builds
/// with `--profile live` and `--cfg avendb_no_replay_checks`, as the doc above says.)
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

#[test]
#[ignore]
fn bench_live() {
    // one link or both: their worlds written side by side, each on a thread of its own, then the links one after
    // another, so no link's catch-up shares the machine with another's
    let bulk: usize = std::env::var("AVENDB_LIVE_BULK").ok().and_then(|n| n.parse().ok()).unwrap_or(600);
    let cases: Vec<String> =
        std::env::var("AVENDB_LIVE_LINK").unwrap_or_else(|_| "phone".into()).split(',').map(|c| c.trim().to_string()).collect();
    // a `_bulk` link's bulk is `AVENDB_LIVE_BULK_MB` of edits of `FAT` text each, 20 MB by default
    let mb: usize = std::env::var("AVENDB_LIVE_BULK_MB").ok().and_then(|n| n.parse().ok()).unwrap_or(20);
    let writing: Vec<_> = cases
        .iter()
        .map(|c| {
            let (edits, text) = if c.ends_with("_bulk") { (mb * 1_000_000 / FAT, FAT) } else { (bulk, 0) };
            std::thread::spawn(move || fixture(edits, text))
        })
        .collect();
    let fixtures: Vec<Fixture> = writing.into_iter().map(|t| t.join().expect("a fixture")).collect();
    for (case, f) in cases.into_iter().zip(fixtures) {
        // a `_bulk` link on simulated time: one thread, its clock paused, so that time moves only as the link's packets
        // and the nodes' timers say and stands still while a node works (on the thread, or on a blocking one, which
        // holds the clock); its use of the link is then the same run after run, whatever the runner. The other links
        // on the wall clock, four threads, for a live edit's delay as a person meets it (G4).
        let rt = if case.ends_with("_bulk") && std::env::var("AVENDB_LIVE_WALL").is_err() {
            tokio::runtime::Builder::new_current_thread().enable_all().start_paused(true).build()
        } else {
            tokio::runtime::Builder::new_multi_thread().worker_threads(4).enable_all().build()
        };
        rt.expect("a runtime").block_on(live_on(case, f));
    }
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
async fn live_on(case: String, f: Fixture) {
    let faults = match case.trim_end_matches("_bulk") {
        "calm" => Faults::CALM,
        "phone" => Faults::PHONE,
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
    let peak_kib = std::fs::read_to_string("/proc/self/status").ok().and_then(|s| {
        s.lines().find(|l| l.starts_with("VmHWM:"))?.split_whitespace().nth(1)?.parse::<u64>().ok()
    });
    let missed = busy.iter().chain(&idle).filter(|&&m| m >= MISS.as_secs_f64() * 1000.0).count();
    let counts = net.counts();
    let line = json!({
        "kind": "live",
        "link": case,
        "edits": want.len(),
        "wire_bytes": bytes,
        "bytes_per_edit": bytes / want.len().max(1),
        "write_s": (write_s * 1000.0).round() / 1000.0,
        "sync_s": (sync_s * 1000.0).round() / 1000.0,
        "asks": asks,
        "edits_per_s": (want.len() as f64 / sync_s).round(),
        "bytes_per_s": (bytes as f64 / sync_s).round(),
        "link_bytes_per_s": (faults.rate > 0).then_some(faults.rate),
        "link_share": (faults.rate > 0).then(|| ((bytes as f64 / sync_s / faults.rate as f64) * 1000.0).round() / 1000.0),
        "pulled_edits": got,
        "pulled_new": new,
        "resent_ratio": if new > 0 { ((got as f64 / new as f64 - 1.0) * 1000.0).round() / 1000.0 } else { 0.0 },
        "rx_bytes": rx,
        "rx_per_wire_byte": ((rx as f64 / bytes.max(1) as f64) * 100.0).round() / 100.0,
        "peak_kib": peak_kib,
        "packets_sent": counts.sent,
        "packets_lost": counts.lost,
        "live_busy": busy.len(),
        "live_busy_p50_ms": ms(pct(&busy, 0.5)),
        "live_busy_p95_ms": ms(pct(&busy, 0.95)),
        "live_idle_p50_ms": ms(pct(&idle, 0.5)),
        "live_idle_p95_ms": ms(pct(&idle, 0.95)),
        "live_missed": missed,
    });
    println!("BENCH {line}");
    mac.shutdown().await.expect("the node shuts down");
    bob.shutdown().await.expect("the node shuts down");
}
