//! Gate G1 on a node (batch 5, counts since L2 of Goal 6): a page of the Universe's posts off the shared index
//! (`posts_page`), measured at the size it is gated at, not drawn from slopes. A slope taken over a few hundred entries
//! and multiplied out to 10M edits multiplies the runner's jitter with it (the #1348 run: 27 µs of it in 649 against 622
//! gave "11.7 ms at 10M", the merged head 0.4 ms), so the gate holds what a page reads and times it where it reads it:
//!
//! - the shapes: a base vault of published posts as Bob's Mac follows it, and two like it with 8x the posts or 16 edits
//!   on each post. Pages, bytes and index rows a page reads off the shelf, cold, are the same in each: a page reads the
//!   newest of the posts' rows, never the rest of them nor their history, and no index row it doesn't need.
//! - the sizes: the base with, older than its posts, an entry per 50 edits of a vault at 1M and 10M edits (the other
//!   types of `TYPES` in turn, under the keys Bob's Mac holds), built on the shelf through `ShelfIndex::apply` as
//!   `query_window_bench.rs` builds them, stamped as Bob's log is, so a page steps on no edit. Each page cold: pages,
//!   bytes and index rows read, and its time, p50 and p95 of `OPENS`.
//!
//! Lines of JSON (`BENCH {"kind":"posts_node",...}`, `{"kind":"posts_at",...}`) that `scripts/ci/avendb-bench.mjs
//! --posts` holds to `avendb/bench-gates.json`:
//!
//!   AVENDB_WINDOW_N=1000000,10000000 cargo test -p avendb-net --features test-fixtures --lib -- --ignored \
//!     --nocapture --exact posts_page::bench::bench_posts_off_the_index

use std::sync::Arc;
use std::time::Instant;

use super::tests::{followed, post};
use super::*;
use crate::shared_index::{NAME, empty_head};
use crate::shelf::Shelf;
use crate::shelf_index::ShelfIndex;
use crate::shelf_index::bench::{Counts, Lcg, env_or, pct, round, shelf};

const POSTS: usize = 60;
const MORE: usize = 8;
const EDITS: usize = 16;
const PAGE: usize = 20;
/// The index rows a page needs: its posts and one more, newest first, and the one profile of the vault (it holds no
/// files). A find that reads past a token's own rows (before fab0a86d, up to 64 rows a token) reads more.
const ROWS_NEEDED: usize = PAGE + 1 + 1;
/// The cold pages timed, for their percentiles.
const OPENS: usize = 100;
/// The edits an entry has, as `bench_gates.rs` spreads its writes.
const EDITS_PER_ENTRY: u64 = 50;
/// The types the other entries are of, none of them a post, a file or a profile, which a page reads.
const TYPES: &[&str] = &["note", "task", "event", "place", "chat", "link", "list", "draft"];
/// The rows a build step applies.
const STEP: usize = 64 << 10;

/// Bob's Mac following a vault of `posts` published posts with `edits` edits each, its index saved on a counting
/// shelf, and below its posts in creation `others` entries of `TYPES`: the Lab, the shelf and its counts, Bob's Mac.
async fn fixture(posts: usize, edits: usize, others: u64) -> (Mutex<Lab>, Shelf, Arc<Counts>, SignerId) {
    let mut w = followed();
    let (mac, mac_b, alice) = (w.mac_a, w.mac_b, w.alice);
    let mut first = None;
    for i in 0..posts {
        let e = post(&mut w, &format!("Post {i}"), true);
        first.get_or_insert(e);
        for k in 1..edits {
            w.lab.edit(mac, alice, e, |item| item.set_text(2, &format!("edit {k}"))).expect("an edit");
        }
    }
    w.lab.sync_all(0);
    // Bob's Mac works out what it received, so it is settled and its index saves
    while !matches!(w.lab.catch_up_step(mac_b, 4096), avendb::lab::CatchUp::Caught(_)) {}
    while !w.lab.settled(mac_b) && w.lab.catch_up(mac_b) {}
    let lab = Mutex::new(w.lab);
    let counts = Arc::new(Counts::default());
    let shelf = shelf(None, counts.clone());
    let ix = SharedIndex::open(shelf.clone()).await.unwrap();
    let held = lab.lock().unwrap().log(mac_b).ids().len();
    let stepped = ix.step(&lab, mac_b, held).await.unwrap();
    assert!(!matches!(stepped, crate::shared_index::Stepped::Not), "the index saved");
    let stamp = ix.stamp().await;
    drop(ix);
    if others > 0 {
        let (of, tokens) = {
            let lab = lab.lock().unwrap();
            let of = lab.shared_of(mac_b, first.expect("a post")).expect("its rows");
            let tokens: Vec<Token> = TYPES
                .iter()
                .map(|t| *lab.find_tokens(mac_b, alice, &[type_label(t)]).first().expect("a token of the type"))
                .collect();
            (of, tokens)
        };
        assert!(of.created > 0, "the posts come after the vault's first edit");
        let mut rng = Lcg(11);
        let mut rows = Vec::with_capacity(others as usize * 3);
        for i in 0..others {
            let mut id = [0u8; 32];
            for c in id.chunks_mut(8) {
                c.copy_from_slice(&rng.next().to_be_bytes());
            }
            // older than the posts, as many to a creation as it takes (a row's key ends in its entry, so they differ)
            let created = i * of.created / others;
            let tokens = vec![tokens[i as usize % TYPES.len()]];
            rows.extend(avendb::index::shared::Of { entry: EntryId(id), created, tokens, ..of.clone() }.rows());
        }
        rows.sort_unstable_by(|a, b| a.0.cmp(&b.0));
        let (mut kept, opened) = ShelfIndex::open_kept(shelf.clone(), NAME, 64 << 20, empty_head()).await.unwrap();
        assert!(opened, "Bob's index on the shelf");
        let mut it = rows.into_iter().peekable();
        while it.peek().is_some() {
            let step: Vec<avendb::pages::Change> = it.by_ref().take(STEP).map(|(k, v)| (k, Some(v))).collect();
            kept.apply(step, stamp).await.expect("a build step");
        }
    }
    counts.take();
    (lab, shelf, counts, mac_b)
}

/// A first page and the next, each opened cold `OPENS` times: the pages, bytes and index rows each read at most, and
/// the first page's times, µs.
struct Read {
    pages: [u64; 2],
    bytes: [u64; 2],
    rows: [u64; 2],
    us: Vec<f64>,
}

async fn read(lab: &Mutex<Lab>, shelf: &Shelf, counts: &Counts, me: SignerId) -> Read {
    let mut r = Read { pages: [0; 2], bytes: [0; 2], rows: [0; 2], us: vec![] };
    for _ in 0..OPENS {
        let mut last = None;
        for (i, after) in [None, Some(())].into_iter().enumerate() {
            let t = Instant::now();
            let ix = SharedIndex::open(shelf.clone()).await.unwrap();
            let got = page(&ix, lab, me, PAGE, after.and(last)).await.unwrap().expect("off the index");
            if i == 0 {
                r.us.push(t.elapsed().as_secs_f64() * 1e6);
            }
            let (p, b, _) = counts.take();
            r.pages[i] = r.pages[i].max(p);
            r.bytes[i] = r.bytes[i].max(b);
            r.rows[i] = r.rows[i].max(ix.rows_read().await);
            assert_eq!(got["ok"]["posts"].as_array().map(Vec::len), Some(PAGE), "a whole page");
            last = EntryId::from_hex(got["ok"]["posts"][PAGE - 1]["entry"].as_str().unwrap());
        }
    }
    r
}

#[tokio::test]
async fn the_bench_reads_a_page() {
    let (lab, shelf, counts, me) = fixture(2 * PAGE, 1, 2_000).await;
    let r = read(&lab, &shelf, &counts, me).await;
    assert!(r.pages[0] > 0 && r.bytes[0] > 0, "a page reads off the shelf");
}

#[tokio::test]
#[ignore = "a bench: AVENDB_WINDOW_N sizes"]
async fn bench_posts_off_the_index() {
    let mut shapes = vec![];
    for (p, e) in [(POSTS, 1), (MORE * POSTS, 1), (POSTS, EDITS)] {
        let (lab, shelf, counts, me) = fixture(p, e, 0).await;
        shapes.push(read(&lab, &shelf, &counts, me).await);
    }
    let [base, more, edits] = &shapes[..] else { unreachable!() };
    let line = json!({
        "kind": "posts_node",
        "page": PAGE,
        "pages": shapes.iter().map(|r| r.pages[0]).collect::<Vec<_>>(),
        "next_pages": shapes.iter().map(|r| r.pages[1]).collect::<Vec<_>>(),
        "bytes": shapes.iter().map(|r| r.bytes[0]).collect::<Vec<_>>(),
        "rows": shapes.iter().map(|r| r.rows[0]).collect::<Vec<_>>(),
        "next_rows": shapes.iter().map(|r| r.rows[1]).collect::<Vec<_>>(),
        "rows_needed": ROWS_NEEDED,
        "us": shapes.iter().map(|r| round(pct(&r.us, 0.5), 0)).collect::<Vec<_>>(),
        "pages_more_per_post": round((more.pages[0] as f64 - base.pages[0] as f64) / ((MORE - 1) * POSTS) as f64, 3),
        "pages_more_per_edit": round((edits.pages[0] as f64 - base.pages[0] as f64) / ((EDITS - 1) * POSTS) as f64, 3),
    });
    println!("BENCH {line}");
    for n in env_or("AVENDB_WINDOW_N", "1000000").split(',') {
        let n: u64 = n.trim().parse().expect("AVENDB_WINDOW_N: sizes");
        let t = Instant::now();
        let (lab, shelf, counts, me) = fixture(POSTS, 1, n / EDITS_PER_ENTRY).await;
        let build_s = t.elapsed().as_secs_f64();
        let r = read(&lab, &shelf, &counts, me).await;
        let line = json!({
            "kind": "posts_at",
            "n": n,
            "page": PAGE,
            "build_s": round(build_s, 2),
            "pages_read": r.pages[0],
            "next_pages_read": r.pages[1],
            "bytes_read": r.bytes[0],
            "rows_read": r.rows[0],
            "next_rows_read": r.rows[1],
            "rows_needed": ROWS_NEEDED,
            "p50_us": round(pct(&r.us, 0.5), 1),
            "p95_us": round(pct(&r.us, 0.95), 1),
        });
        println!("BENCH {line}");
    }
}
