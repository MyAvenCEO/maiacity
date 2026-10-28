//! Gate G5 (batch 5, W2): how long a person's write waits while the Lab is busy, a catch-up slice of `TURN` running and
//! a page's 32 reads of `TURN` each queued, as the iPhone's waited 1.9 s on 27 Oct. The harness is `writes_first`'s
//! unit test, which asserts the order alone; this one times it, 20 rounds, and prints one `BENCH {"kind":"writes",...}`
//! line, which `scripts/ci/avendb-bench.mjs` holds to a p95 under 50 ms. It runs in the bench job's live shard, on the
//! live profile (optimised, no whole-log replays), never under the full suite's load:
//!
//!   RUSTFLAGS="--cfg avendb_no_replay_checks" cargo test --profile live -p avendb-net --features test-fixtures --lib \
//!     -- --ignored --nocapture --exact lab_schedule::bench::bench_writes_first

use super::*;
use crate::{Node, Options};
use avendb::cast::{document, handbook_ready, world};
use serde_json::json;
use std::time::{Duration, Instant};

/// A catch-up slice's and a read's turn.
const TURN: Duration = Duration::from_millis(20);
/// The page's reads queued.
const READS: usize = 32;
/// The rounds timed.
const ROUNDS: usize = 20;

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "a bench: the live shard"]
async fn bench_writes_first() {
    let mut w = world();
    let vault = handbook_ready(&mut w);
    let me = w.mac_a;
    let node = Node::spawn(w.lab.split(me, &[], [193; 32]), me, Options { lazy: true, ..Options::local() }).await.unwrap();
    let (mut behind, mut out_of_order) = (Vec::new(), 0);
    for round in 0..ROUNDS {
        // a catch-up slice holds the Lab, then the page's reads queue, and more background turns behind them
        let shared = node.shared.clone();
        let (entered, entering) = tokio::sync::oneshot::channel();
        let slice = tokio::spawn(async move {
            shared
                .try_lab_class(Class::Background, move |_, _| {
                    entered.send(()).unwrap();
                    std::thread::sleep(TURN);
                })
                .await
                .unwrap()
        });
        entering.await.unwrap();
        let ran = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let reads: Vec<_> = (0..READS)
            .map(|_| {
                let (shared, ran) = (node.shared.clone(), ran.clone());
                tokio::spawn(async move {
                    shared
                        .read(move |lab, me| {
                            ran.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                            std::thread::sleep(TURN);
                            lab.size(me)
                        })
                        .await
                })
            })
            .collect();
        let more: Vec<_> = (0..4)
            .map(|_| {
                let shared = node.shared.clone();
                tokio::spawn(async move { shared.try_lab_class(Class::Background, |_, _| std::thread::sleep(TURN)).await.unwrap() })
            })
            .collect();
        while node.shared.lab_schedule.state.lock().unwrap().foreground.len() < READS {
            tokio::task::yield_now().await;
        }
        // the person writes
        let asked = Instant::now();
        let ahead = ran.clone();
        let (entry, reads_before) = node
            .try_act(move |lab, me| {
                let reads_before = ahead.load(std::sync::atomic::Ordering::SeqCst);
                let doc = document(&format!("Write {round}"), "while busy", me);
                (lab.create(me, vault, vault, "doc", &[], doc).unwrap(), reads_before)
            })
            .await
            .unwrap();
        behind.push(asked.elapsed().as_secs_f64() * 1e3);
        if reads_before > 0 {
            out_of_order += 1;
        }
        assert!(node.read(move |lab, me| lab.item(me, entry).is_some()).await);
        slice.await.unwrap();
        for r in reads {
            r.await.unwrap();
        }
        for m in more {
            m.await.unwrap();
        }
    }
    behind.sort_by(f64::total_cmp);
    let at = |p: f64| (behind[((behind.len() as f64 * p).ceil() as usize).saturating_sub(1)] * 10.0).round() / 10.0;
    let line = json!({
        "kind": "writes",
        "rounds": ROUNDS,
        "turn_ms": TURN.as_millis() as u64,
        "reads_queued": READS,
        "write_p50_ms": at(0.5),
        "write_p95_ms": at(0.95),
        "write_max_ms": at(1.0),
        "writes_behind_a_read": out_of_order,
    });
    println!("BENCH {line}");
    node.shutdown().await.unwrap();
}
