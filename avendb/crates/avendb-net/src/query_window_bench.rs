//! The window's scale bench (gate G1, batch 5, 2026-10-27): what a named query costs opened end to end, as
//! `Node::window` opens it (`query_window::window` off the shared index, cold), on the index of a vault at 1M and 10M
//! edits: pages and bytes read off the shelf, log edits stepped on (0: the tail after the index's stamp is empty), and
//! the time. Lines of JSON (`BENCH {"kind":"window",...}`) that `scripts/ci/avendb-bench.mjs --index` holds to
//! `avendb/bench-gates.json`:
//!
//!   AVENDB_WINDOW_N=1000000,10000000 cargo test -p avendb-net --features test-fixtures --lib -- --ignored \
//!     --nocapture --exact query_window::bench::bench_window
//!
//! The fixture: a real World's Lab (Alice's vault on her Mac), its tokens for 16 types (`Lab::find_tokens`), and the
//! shared index such a vault at `n` edits holds, an entry per 50 edits of one of the types, each with its rows as
//! `index::shared::Of::rows` gives them, built through `ShelfIndex::apply` in key order, 64k rows a step, as the index
//! bench builds (I4 holds that this is the tree any order of writes gives). Its stamp is the head of the Lab's log, so
//! the window steps on no edit, as on a device whose last save is current.
//!
//! The one cost the fixture can't stand for is `shared_index::head`: each window hashes the ids of the log up to the
//! index's stamp, to check it is of a prefix of the log, and the Lab's log is short. So the bench times that hash over
//! `n` ids on its own (`head_us`) and adds it to the window's time (`window_at_n_p50_us`), which the gate holds.

use std::collections::BTreeSet;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;

use avendb::cast::world;
use avendb::id::{AudienceId, EditId, EntryId};
use avendb::index::shared::Of;
use avendb::index::type_label;
use avendb::pages::Change;
use serde_json::{Value, json};

use super::window;
use crate::shared_index::{NAME, SharedIndex, head};
use crate::shelf_index::bench::{Counts, Lcg, env_or, pct, round, shelf};
use crate::shelf_index::{ShelfIndex, Stamp};

/// The types the entries are of, as the index bench's.
const TYPES: usize = 16;
/// The entries a window lists.
const W: usize = 50;
/// The rows a build step applies.
const STEP: usize = 64 << 10;
/// The cold windows timed, for their percentiles.
const OPENS: usize = 200;
/// The edits an entry has, as `bench_gates.rs` spreads its writes.
const EDITS_PER_ENTRY: u64 = 50;

/// The index of a vault at `n` edits on `shelf`, of the tokens `tokens` (a type's, each), stamped `stamp`: its rows,
/// its depth.
async fn build(shelf: crate::shelf::Shelf, n: u64, audience: AudienceId, tokens: &[avendb::index::Token], stamp: Stamp) -> usize {
    let entries = (n / EDITS_PER_ENTRY).max(W as u64 * TYPES as u64);
    let mut rng = Lcg(11);
    let mut rows: Vec<(Vec<u8>, Vec<u8>)> = Vec::with_capacity(entries as usize * 3);
    for i in 0..entries {
        let mut id = [0u8; 32];
        for c in id.chunks_mut(8) {
            c.copy_from_slice(&rng.next().to_be_bytes());
        }
        let of = Of { entry: EntryId(id), audience, epoch: 0, created: 1_000 + i, tokens: vec![tokens[i as usize % TYPES]] };
        rows.extend(of.rows());
    }
    rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    let (mut ix, _) = ShelfIndex::open_kept(shelf, NAME, 64 << 20, head(&[])).await.expect("an index");
    let (count, mut at) = (rows.len(), 0);
    let mut it = rows.into_iter().peekable();
    while it.peek().is_some() {
        let step: Vec<Change> = it.by_ref().take(STEP).map(|(k, v)| (k, Some(v))).collect();
        at += step.len();
        // the steps stamped as the build goes, the last with the Lab's head
        let s = if it.peek().is_none() { stamp } else { Stamp { at: at as u64, head: head(&[]).head } };
        ix.apply(step, s).await.expect("a build step");
    }
    count
}

/// One `BENCH` line: the window of one type opened cold `OPENS` times through `query_window::window`.
async fn bench(n: u64) -> Value {
    let w = world();
    let (mac, alice) = (w.mac_a, w.alice);
    let labels: Vec<Vec<String>> = (0..TYPES).map(|t| vec![type_label(&format!("bench{t}"))]).collect();
    let tokens: Vec<avendb::index::Token> =
        labels.iter().map(|l| *w.lab.find_tokens(mac, alice, l).first().expect("a token of the type")).collect();
    let ids = w.lab.log(mac).ids().to_vec();
    let stamp = head(&ids);
    let lab = Mutex::new(w.lab);

    let counts = Arc::new(Counts::default());
    let shelf = shelf(None, counts.clone());
    let t = Instant::now();
    let rows = build(shelf.clone(), n, AudienceId::of(alice, &[]), &tokens, stamp).await;
    let build_s = t.elapsed().as_secs_f64();
    counts.take();

    let (mut opens, mut pages, mut bytes, mut read) = (vec![], vec![], 0u64, 0usize);
    let mut log_edits = 0u64;
    for q in 0..OPENS {
        let t = Instant::now();
        let ix = SharedIndex::open(shelf.clone()).await.expect("the index opens");
        let got = window(&ix, &lab, mac, alice, &labels[q % TYPES], None, W).await.expect("a window").expect("the index says");
        opens.push(t.elapsed().as_secs_f64());
        let (p, b, _) = counts.take();
        pages.push(p as f64);
        bytes = bytes.max(b);
        read = read.max(got.rows_read);
        log_edits += ids.len() as u64 - got.index_at;
        assert_eq!((got.index_at, got.tail, got.entries.len()), (stamp.at, 0, W), "a whole window off the index");
        let newest: BTreeSet<u64> = got.entries.iter().map(|(c, _)| *c).collect();
        assert!(newest.iter().all(|c| (c - 1_000) as usize % TYPES == q % TYPES), "of its type alone");
    }

    // the hash each window takes of the log's ids up to the stamp, at `n` edits
    let many: Vec<EditId> = (0..n).map(EditId::from_u64).collect();
    let mut heads = vec![];
    for _ in 0..3 {
        let t = Instant::now();
        std::hint::black_box(head(std::hint::black_box(&many)));
        heads.push(t.elapsed().as_secs_f64());
    }
    let head_us = pct(&heads, 0.5) * 1e6;
    let p50_us = pct(&opens, 0.5) * 1e6;
    json!({
        "kind": "window",
        "n": n,
        "rows": rows,
        "build_s": round(build_s, 2),
        "w": W,
        "window_pages_p50": pct(&pages, 0.5),
        "window_pages_read": pct(&pages, 1.0),
        "window_bytes_read": bytes,
        "window_rows_read": read,
        "window_log_edits": log_edits,
        "window_p50_us": round(p50_us, 1),
        "window_p95_us": round(pct(&opens, 0.95) * 1e6, 1),
        "head_us": round(head_us, 1),
        "window_at_n_p50_us": round(p50_us + head_us, 1),
    })
}

#[tokio::test]
async fn the_bench_opens_a_small_window() {
    let line = bench(20_000).await;
    println!("BENCH {line}");
    assert_eq!(line["window_log_edits"], 0);
    assert!(line["window_rows_read"].as_u64().unwrap() <= W as u64);
}

#[tokio::test]
#[ignore = "a bench: AVENDB_WINDOW_N sizes"]
async fn bench_window() {
    for n in env_or("AVENDB_WINDOW_N", "1000000").split(',') {
        println!("BENCH {}", bench(n.trim().parse().expect("AVENDB_WINDOW_N: sizes")).await);
    }
}
