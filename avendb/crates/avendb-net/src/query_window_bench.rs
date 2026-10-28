//! The window's scale bench (gate G1, batch 5, 2026-10-27): what a named query costs answered end to end, as
//! `Node::windowed` answers it (`query_window::answer`: the window off the shared index, then the query over the
//! entries it names), cold, on the index of a vault at 1M and 10M edits: pages and bytes read off the shelf, index rows
//! read, log edits stepped on (0: the tail after the index's stamp is empty), and the time. Each size prints a line of
//! JSON (`BENCH {"kind":"window",...}`) and is held to the counts of `held`; the net test shard runs it at 1M and 10M:
//!
//!   AVENDB_WINDOW_N=1000000,10000000 cargo test -p avendb-net --features test-fixtures --lib -- --ignored \
//!     --nocapture --exact query_window::bench::bench_window
//!
//! The fixture: a real World's Lab (Alice's vault on her Mac) with `REAL` entries of each of `QUERIED` types, and the
//! shared index such a vault at `n` edits holds: those entries' rows as the Lab gives them (`Lab::shared_of`), and
//! below them in creation an entry per 50 edits of one of `TYPES` types (the queried ones among them), each with its
//! rows as `index::shared::Of::rows` gives them, built through `ShelfIndex::apply` in key order, 64k rows a step, as
//! the index bench builds (I4 holds that this is the tree any order of writes gives). A query's newest `W` are the
//! Lab's own entries, which the query reads as ever; the rest of the index is what its pages are cut from. Its stamp is
//! the head of the Lab's log, so the window steps on no edit, as on a device whose last save is current.
//!
//! The one cost the fixture can't stand for is the head of a long log: a node hashes its log's ids up to the index's
//! stamp once, as it opens (`shared_index::of_log`; each window after asks it in O(1)), and the Lab's log is short. So
//! the bench times that hash over `n` ids on its own (`node_open_head_ms`), a cost of the node's opening, not of a window.

use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;

use avendb::cast::{document, world};
use avendb::id::{AudienceId, EditId, EntryId};
use avendb::index::shared::Of;
use avendb::index::type_label;
use avendb::pages::Change;
use serde_json::{Value, json};

use super::answer;
use crate::shared_index::{NAME, SharedIndex, head};
use crate::shelf_index::bench::{Counts, Lcg, env_or, pct, round, shelf};
use crate::shelf_index::{ShelfIndex, Stamp};

/// The types the entries are of, as the index bench's.
const TYPES: usize = 16;
/// The types queried, of which the Lab holds entries of its own.
const QUERIED: usize = 4;
/// The Lab's own entries of each queried type: a window's and some.
const REAL: usize = W + 10;
/// The entries a window lists.
const W: usize = 50;
/// The rows a build step applies.
const STEP: usize = 64 << 10;
/// The cold windows timed, for their percentiles.
const OPENS: usize = 200;
/// The edits an entry has, as `bench_gates.rs` spreads its writes.
const EDITS_PER_ENTRY: u64 = 50;

/// The index of a vault at `n` edits on `shelf`: rows `real`, and older than the oldest of them (`under`) an entry per 50
/// edits, of the tokens `tokens` in turn, stamped `stamp`; how many rows.
async fn build(
    shelf: crate::shelf::Shelf,
    n: u64,
    audience: AudienceId,
    tokens: &[avendb::index::Token],
    real: Vec<(Vec<u8>, Vec<u8>)>,
    under: u64,
    stamp: Stamp,
) -> usize {
    let entries = (n / EDITS_PER_ENTRY).max(W as u64 * TYPES as u64);
    assert!(under > 0, "the Lab's entries come after its first edit");
    let mut rng = Lcg(11);
    let mut rows = real;
    rows.reserve(entries as usize * 3);
    for i in 0..entries {
        let mut id = [0u8; 32];
        for c in id.chunks_mut(8) {
            c.copy_from_slice(&rng.next().to_be_bytes());
        }
        // older than the Lab's own, as many to a creation as it takes (a row's key ends in its entry, so they differ)
        let created = i * under / entries;
        let of = Of { entry: EntryId(id), audience, epoch: 0, created, tokens: vec![tokens[i as usize % TYPES]] };
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

/// One `BENCH` line: a query of one type answered cold `OPENS` times through `query_window::answer`.
async fn bench(n: u64) -> Value {
    let mut w = world();
    let (mac, alice) = (w.mac_a, w.alice);
    let types: Vec<String> = (0..TYPES).map(|t| format!("bench{t}")).collect();
    let tokens: Vec<avendb::index::Token> = types
        .iter()
        .map(|t| *w.lab.find_tokens(mac, alice, &[type_label(t)]).first().expect("a token of the type"))
        .collect();
    let mut real = vec![];
    for t in &types[..QUERIED] {
        for i in 0..REAL {
            let e = w.lab.create(mac, alice, alice, t, &[], document(&format!("{t} {i}"), "x", mac)).expect("an entry");
            real.push(w.lab.shared_of(mac, e).expect("its rows"));
        }
    }
    let under = real.iter().map(|of| of.created).min().expect("entries");
    let real_rows: Vec<_> = real.iter().flat_map(Of::rows).collect();
    let ids = w.lab.log(mac).ids().to_vec();
    let stamp = head(&ids);
    let lab = Mutex::new(w.lab);
    let query = |t: usize| json!({ "op": "query", "vault": alice.to_hex(), "where": { "type": [types[t]] }, "window": W });

    let counts = Arc::new(Counts::default());
    let shelf = shelf(None, counts.clone());
    let t = Instant::now();
    let rows = build(shelf.clone(), n, AudienceId::of(alice, &[]), &tokens, real_rows, under, stamp).await;
    let build_s = t.elapsed().as_secs_f64();
    counts.take();

    let (mut opens, mut warm, mut pages, mut bytes, mut read) = (vec![], vec![], vec![], 0u64, 0usize);
    let mut log_edits = 0u64;
    for q in 0..OPENS {
        let t = Instant::now();
        let ix = SharedIndex::open(shelf.clone()).await.expect("the index opens");
        let (got, win) = answer(&ix, &lab, mac, &query(q % QUERIED)).await.expect("a window").expect("the index says");
        opens.push(t.elapsed().as_secs_f64());
        let (p, b, _) = counts.take();
        pages.push(p as f64);
        bytes = bytes.max(b);
        read = read.max(win.rows_read);
        log_edits += (win.log_at as u64).saturating_sub(win.index_at);
        assert_eq!((win.index_at, win.tail), (stamp.at, 0), "a window off the index alone");
        assert_eq!(got["ok"]["rows"].as_array().map(Vec::len), Some(W), "a whole window of the query");
        // the same index asked again, as a node's next window is: its stamp checked in O(1), its pages held
        let t = Instant::now();
        std::hint::black_box(answer(&ix, &lab, mac, &query((q + 1) % QUERIED)).await.expect("a window"));
        warm.push(t.elapsed().as_secs_f64());
        counts.take();
    }

    // the hash a node takes of its log's ids up to the index's stamp, once as it opens, at `n` edits
    let many: Vec<EditId> = (0..n).map(EditId::from_u64).collect();
    let mut heads = vec![];
    for _ in 0..3 {
        let t = Instant::now();
        std::hint::black_box(head(std::hint::black_box(&many)));
        heads.push(t.elapsed().as_secs_f64());
    }
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
        "window_warm_p50_us": round(pct(&warm, 0.5) * 1e6, 1),
        "window_at_n_p50_us": round(p50_us, 1),
        "node_open_head_ms": round(pct(&heads, 0.5) * 1e3, 1),
    })
}

#[tokio::test]
async fn the_bench_opens_a_small_window() {
    let line = bench(20_000).await;
    println!("BENCH {line}");
    held(&line);
}

/// G1's gates, counts alone, so they hold on any machine: a query answered cold steps on no log edit, reads no index
/// row past its window's, and at most 10 pages and 128 KB off the shelf. The times are printed only (Goal 7a W1: no
/// timing gate).
fn held(line: &Value) {
    let n = |k: &str| line[k].as_f64().unwrap_or_else(|| panic!("{k} in {line}"));
    assert_eq!(n("window_log_edits"), 0.0, "log edits stepped on: {line}");
    assert!(n("window_rows_read") <= W as f64, "index rows read past the window's: {line}");
    assert!(n("window_pages_read") <= 10.0, "pages read (most): {line}");
    assert!(n("window_bytes_read") <= (128 << 10) as f64, "bytes read: {line}");
}

#[tokio::test]
#[ignore = "a bench: AVENDB_WINDOW_N sizes"]
async fn bench_window() {
    for n in env_or("AVENDB_WINDOW_N", "1000000").split(',') {
        let line = bench(n.trim().parse().expect("AVENDB_WINDOW_N: sizes")).await;
        println!("BENCH {line}");
        held(&line);
    }
}
