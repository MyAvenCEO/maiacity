//! The index's scale bench (plan D1, 2026-10-27): what opening a view costs on a vault's index at 1M, 10M or 100M
//! edits, counted in pages and bytes read off the shelf and log edits stepped on, not only timed, so a regression
//! shows on any machine. Lines of JSON (`BENCH {...}`) that `scripts/ci/avendb-bench.mjs` holds to the gates of
//! `avendb/bench-gates.json`:
//!
//!   AVENDB_INDEX_N=1000000 cargo test --release -p avendb-net --lib -- --ignored --nocapture --exact shelf_index::bench::bench_index
//!   AVENDB_INDEX_N=100000000 AVENDB_INDEX_DIR=/big/disk ...     (100M on a folder shelf: by hand, past CI's 5 minutes)
//!   AVENDB_PARITY_N=100000 cargo test --release -p avendb-net --lib -- --ignored --nocapture --exact shelf_index::bench::bench_parity
//!
//! The fixture is not a log of real edits: building 100M signed edits takes hours. It is the index such a log gives,
//! built fast through the same path every index takes (`ShelfIndex::apply`), its rows in key order, 64k a step, so
//! each step changes only the right edge of the tree. That this gives the very tree a log's writes in any order give
//! is I4, held at 100k by `bench_parity` (the same root both ways). Its rows, for `n` edits:
//!
//! - `e` + an edit's id (32 bytes, at random) -> its place in the log (8 bytes): one a edit, as `id -> place` (F3).
//! - `v` + a type (one of 16) + an entry (8 bytes) -> the entry's tip (48 bytes): one an entry, an entry per 50 edits,
//!   as `bench_gates.rs` spreads its writes. A view of one type is a scan of its rows.
//!
//! Opening a view is what a node does on a cold start: open the index from its slot (`ShelfIndex::open`, no page in
//! memory), then read the first `VIEW` rows of a type. A point read is a `get` of one edit's place, cold.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use super::*;
use crate::shelf::Call;
use avendb::pages::FANOUT;
use serde_json::{Value, json};

/// The types a view asks for, as `bench_gates.rs`'s.
const TYPES: u64 = 16;
/// The rows a view lists.
const VIEW: usize = 50;
/// The rows a build step applies.
const STEP: usize = 64 << 10;
/// The cold opens timed, for their percentiles.
const OPENS: usize = 200;
/// What an index holds in memory.
const BUDGET: usize = 64 << 20;

/// What a counting shelf read: page gets and their bytes, slot gets, and listings.
#[derive(Default)]
struct Counts {
    pages: AtomicU64,
    page_bytes: AtomicU64,
    slots: AtomicU64,
}

impl Counts {
    fn take(&self) -> (u64, u64, u64) {
        (
            self.pages.swap(0, Ordering::SeqCst),
            self.page_bytes.swap(0, Ordering::SeqCst),
            self.slots.swap(0, Ordering::SeqCst),
        )
    }
}

/// A shelf in memory, or in a folder (a file an object), that counts what is read off it.
fn shelf(dir: Option<std::path::PathBuf>, counts: Arc<Counts>) -> Shelf {
    let (shelf, mut calls) = Shelf::new();
    let mut held: HashMap<String, Bytes> = HashMap::new();
    if let Some(d) = &dir {
        std::fs::create_dir_all(d).expect("the bench's folder");
    }
    let file = {
        let dir = dir.clone();
        move |name: &str| dir.as_ref().map(|d| d.join(name.replace('/', "~")))
    };
    tokio::spawn(async move {
        while let Some(call) = calls.recv().await {
            match call {
                Call::Put { name, bytes, tx } | Call::Keep { name, bytes, tx } => {
                    match file(&name) {
                        Some(f) => {
                            tx.send(std::fs::write(f, &bytes)).ok();
                        }
                        None => {
                            held.insert(name, bytes);
                            tx.send(Ok(())).ok();
                        }
                    }
                }
                Call::Get { name, tx } => {
                    let got = match file(&name) {
                        Some(f) => match std::fs::read(f) {
                            Ok(b) => Ok(Some(Bytes::from(b))),
                            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
                            Err(e) => Err(e),
                        },
                        None => Ok(held.get(&name).cloned()),
                    };
                    if name.starts_with("index/") {
                        counts.pages.fetch_add(1, Ordering::SeqCst);
                        let n = got.as_ref().ok().and_then(|b| b.as_ref()).map_or(0, |b| b.len());
                        counts.page_bytes.fetch_add(n as u64, Ordering::SeqCst);
                    } else {
                        counts.slots.fetch_add(1, Ordering::SeqCst);
                    }
                    tx.send(got).ok();
                }
                Call::Names { prefix, tx } => {
                    let names = match &dir {
                        Some(dir) => {
                            let want = prefix.replace('/', "~");
                            std::fs::read_dir(dir).map(|it| {
                                let mut v: Vec<String> = it
                                    .filter_map(|e| e.ok()?.file_name().into_string().ok())
                                    .filter(|n| n.starts_with(&want))
                                    .map(|n| n.replace('~', "/"))
                                    .collect();
                                v.sort();
                                v
                            })
                        }
                        None => {
                            let mut v: Vec<String> =
                                held.keys().filter(|n| n.starts_with(&prefix)).cloned().collect();
                            v.sort();
                            Ok(v)
                        }
                    };
                    tx.send(names).ok();
                }
                _ => panic!("an index asks only for named objects"),
            }
        }
    });
    shelf
}

/// The log the index is of, as far as opening it asks: its length and heads. Its entries are never asked for on an
/// open from a current slot; each asking is counted (the bench's `log_edits`, gated at 0).
struct FixtureLog {
    len: u64,
    asked: AtomicU64,
}

fn head(n: u64) -> Sum {
    sum(&n.to_be_bytes())
}

impl Log for FixtureLog {
    type Entry = ();
    fn len(&self) -> u64 {
        self.len
    }
    fn head_at(&self, n: u64) -> Option<Sum> {
        (n <= self.len).then(|| head(n))
    }
    fn entries(&self, from: u64, to: u64) -> Vec<()> {
        self.asked.fetch_add(to - from, Ordering::SeqCst);
        vec![(); (to - from) as usize]
    }
}

/// A small seeded generator, as `bench_gates.rs`'s.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 11
    }
}

fn entries_for(n: u64) -> u64 {
    (n / 50).max(200)
}

/// The fixture's rows for `n` edits, in key order, a step at a time: the edits' ids drawn in order (each the next
/// slice of the id space, at random within it, so they are uniform and sorted with no sort), then the entries'.
fn rows(n: u64, seed: u64) -> impl Iterator<Item = Vec<Change>> {
    let entries = entries_for(n);
    let width = u64::MAX / n.max(1);
    let mut rng = Lcg(seed);
    let mut e = 0u64;
    let mut v = 0u64;
    std::iter::from_fn(move || {
        let mut out = Vec::with_capacity(STEP);
        while out.len() < STEP && e < n {
            let mut key = Vec::with_capacity(33);
            key.push(b'e');
            key.extend_from_slice(&(e * width + rng.next() % width).to_be_bytes());
            for _ in 0..3 {
                key.extend_from_slice(&rng.next().to_be_bytes());
            }
            out.push((key, Some(e.to_be_bytes().to_vec())));
            e += 1;
        }
        // the entries, by type then entry: entry i is of type i % TYPES
        while out.len() < STEP && v < entries.div_ceil(TYPES) * TYPES {
            let (ty, i) = (v / entries.div_ceil(TYPES), v % entries.div_ceil(TYPES));
            let entry = i * TYPES + ty;
            v += 1;
            if entry >= entries {
                continue;
            }
            let mut key = vec![b'v', ty as u8];
            key.extend_from_slice(&(1000 + entry).to_be_bytes());
            let mut tip = vec![0u8; 48];
            tip[..8].copy_from_slice(&(entry * 50).to_be_bytes());
            tip[8..16].copy_from_slice(&rng.next().to_be_bytes());
            out.push((key, Some(tip)));
        }
        (!out.is_empty()).then_some(out)
    })
}

/// The index of `n` edits' rows on `shelf`, built a step at a time: its stamp at its row count.
async fn build(shelf: Shelf, n: u64) -> io::Result<(ShelfIndex, u64)> {
    let mut ix = ShelfIndex::empty(shelf, "bench", BUDGET, head(0))?;
    let mut at = 0;
    for step in rows(n, 42) {
        at += step.len() as u64;
        ix.apply(step, Stamp { at, head: head(at) }).await?;
    }
    Ok((ix, at))
}

/// Its depth, and the pages and bytes of its tree as it stands (not the older pages the build left on the shelf).
async fn tree(ix: &ShelfIndex) -> io::Result<(u8, u64, u64)> {
    let Some(root) = ix.root() else {
        return Ok((0, 0, 0));
    };
    let top = ix.page(root, None).await?;
    let (mut pages, mut bytes) = (0u64, 0u64);
    let mut stack = vec![top.clone()];
    while let Some(node) = stack.pop() {
        pages += 1;
        bytes += Node::to_bytes(node.level, &node.items).len() as u64;
        if node.level > 0 {
            for (_, child) in &node.items {
                let hash = child.as_slice().try_into().expect("a page's hash");
                stack.push(ix.page(hash, Some(node.level - 1)).await?);
            }
        }
    }
    Ok((top.level + 1, pages, bytes))
}

fn pct(xs: &[f64], p: f64) -> f64 {
    let mut s = xs.to_vec();
    s.sort_by(f64::total_cmp);
    s[((s.len() as f64 * p).ceil() as usize).saturating_sub(1).min(s.len() - 1)]
}

fn round(x: f64, places: i32) -> f64 {
    let f = 10f64.powi(places);
    (x * f).round() / f
}

/// One `BENCH` line: the index of `n` edits built, then opened cold `OPENS` times for a view and a point read.
async fn index(n: u64) -> Value {
    let counts = Arc::new(Counts::default());
    let dir = std::env::var("AVENDB_INDEX_DIR").ok().map(|d| std::path::Path::new(&d).join(format!("bench-{n}")));
    let on = if dir.is_some() { "folder" } else { "memory" };
    let shelf = shelf(dir, counts.clone());
    let t = Instant::now();
    let (built, rows) = build(shelf.clone(), n).await.expect("the build");
    let build_s = t.elapsed().as_secs_f64();
    let (depth, pages, bytes) = tree(&built).await.expect("the tree");
    let root = built.root();
    drop(built);
    counts.take();

    let log = FixtureLog { len: rows, asked: AtomicU64::new(0) };
    let entries = entries_for(n);
    let mut rng = Lcg(7);
    let (mut opens, mut gets) = (Vec::with_capacity(OPENS), Vec::with_capacity(OPENS));
    let mut open_pages = Vec::with_capacity(OPENS);
    let (mut open_bytes, mut get_pages, mut listed) = (0u64, 0u64, 0usize);
    for q in 0..OPENS {
        // a view of one type, from an entry at random on
        let ty = q as u64 % TYPES;
        let mut from = vec![b'v', ty as u8];
        let per = entries / TYPES;
        let start = rng.next() % per.saturating_sub(VIEW as u64).max(1);
        from.extend_from_slice(&(1000 + start * TYPES + ty).to_be_bytes());
        let t = Instant::now();
        let (ix, how) = ShelfIndex::open(shelf.clone(), "bench", BUDGET, &log, |_| Vec::new()).await.expect("open");
        let mut page = ix.scan(&from, VIEW).await.expect("the view");
        page.retain(|(k, _)| k[..2] == from[..2]);
        opens.push(t.elapsed().as_secs_f64());
        assert_eq!((how, ix.root()), (Opened::Current, root), "the index opens from its slot");
        assert_eq!(page.len() as u64, (VIEW as u64).min(per - start), "a view of one type");
        listed = listed.max(page.len());
        let (p, b, _) = counts.take();
        open_pages.push(p as f64);
        open_bytes = open_bytes.max(b);

        // a point read, cold: an edit's place
        let mut key = vec![b'e'];
        key.extend_from_slice(&rng.next().to_be_bytes());
        // (its pages counted from the open on, which reads the root)
        let (ix, _) = ShelfIndex::open(shelf.clone(), "bench", BUDGET, &log, |_| Vec::new()).await.expect("open");
        let t = Instant::now();
        std::hint::black_box(ix.get(&key).await.expect("a read"));
        gets.push(t.elapsed().as_secs_f64());
        get_pages = get_pages.max(counts.take().0);
    }
    // the depth a tree of `rows` rows has, FANOUT items a page about: what the pages read should follow
    let model = ((rows as f64).ln() / (FANOUT as f64).ln()).ceil() as u64 + 1;
    json!({
        "kind": "index",
        "n": n,
        "rows": rows,
        "shelf": on,
        "build_s": round(build_s, 2),
        "rows_per_s": (rows as f64 / build_s).round(),
        "depth": depth,
        "depth_model": model,
        "pages": pages,
        "index_bytes_per_edit": round(bytes as f64 / n as f64, 1),
        "open_pages_read": pct(&open_pages, 1.0),
        "open_pages_p50": pct(&open_pages, 0.5),
        "open_bytes_read": open_bytes,
        "open_log_edits": log.asked.load(Ordering::SeqCst),
        "open_p50_us": round(pct(&opens, 0.5) * 1e6, 1),
        "open_p95_us": round(pct(&opens, 0.95) * 1e6, 1),
        "view_rows": listed,
        "get_pages_read": get_pages,
        "get_p50_us": round(pct(&gets, 0.5) * 1e6, 1),
    })
}

fn env_or(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

#[tokio::test]
async fn the_bench_opens_a_small_index() {
    let line = index(20_000).await;
    println!("BENCH {line}");
    assert_eq!(line["open_log_edits"], 0);
    assert!(line["open_pages_p50"].as_f64().unwrap() <= line["depth"].as_f64().unwrap() + 1.0);
    assert_eq!(line["get_pages_read"], line["depth"]);
}

#[tokio::test]
#[ignore = "a bench: AVENDB_INDEX_N sizes, in release"]
async fn bench_index() {
    for n in env_or("AVENDB_INDEX_N", "1000000").split(',') {
        println!("BENCH {}", index(n.trim().parse().expect("AVENDB_INDEX_N: sizes")).await);
    }
}

/// I4 at the bench's size: its rows built a step at a time in key order, and the same rows written at random in
/// batches of a thousand, as a log's writes come, give one tree, so what the bench measures on the first is what a
/// node that took the writes as they came holds.
#[tokio::test]
#[ignore = "a bench: AVENDB_PARITY_N, in release"]
async fn bench_parity() {
    let n: u64 = env_or("AVENDB_PARITY_N", "100000").parse().expect("AVENDB_PARITY_N");
    let counts = Arc::new(Counts::default());
    let t = Instant::now();
    let (bulk, held) = build(shelf(None, counts.clone()), n).await.expect("the build");
    let bulk_s = t.elapsed().as_secs_f64();

    let mut all: Vec<Change> = rows(n, 42).flatten().collect();
    let mut rng = Lcg(9);
    for i in (1..all.len()).rev() {
        all.swap(i, (rng.next() % (i as u64 + 1)) as usize);
    }
    let mut ix = ShelfIndex::empty(shelf(None, counts), "bench", BUDGET, head(0)).expect("an index");
    let t = Instant::now();
    let mut at = 0;
    for batch in all.chunks(1000) {
        at += batch.len() as u64;
        ix.apply(batch.to_vec(), Stamp { at, head: head(at) }).await.expect("a batch");
    }
    let append_s = t.elapsed().as_secs_f64();
    let same = ix.root() == bulk.root();
    println!(
        "BENCH {}",
        json!({ "kind": "parity", "n": n, "rows": held, "same_root": same,
                "bulk_s": round(bulk_s, 2), "append_s": round(append_s, 2) })
    );
    assert!(same, "the bulk-built index is the index of the same rows written as they come");
}
