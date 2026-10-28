//! Gate G1 on a node (batch 5): a page of the Universe's posts off the shared index (`posts_page`), the same shapes
//! as avendb's `tests/posts_bench.rs` (the engine's walk): a base vault of published posts, and three like it with 8x
//! the posts, 16 edits on each post, or 480 public entries that are no posts. What a page costs more over the base,
//! per post, per edit of a post and per other entry, is what it reads of them; from the slopes, a page at 1M and 10M
//! edits, an entry per 50.
//!
//!   cargo test -p avendb-net --lib posts_page::bench -- --ignored --nocapture

use std::time::Instant;

use super::tests::{TAG, followed, post};
use super::*;
use crate::shelf_index::tests::Memory;
use avendb::cast::document;

const POSTS: usize = 60;
const MORE: usize = 8;
const EDITS: usize = 16;
const NOISE: usize = 480;
const PAGE: usize = 20;
const ROUNDS: usize = 40;

/// Bob's Mac following a vault of `posts` published posts with `edits` edits each and `noise` public notes, its
/// index saved.
async fn fixture(posts: usize, edits: usize, noise: usize) -> (Mutex<Lab>, SharedIndex, SignerId) {
    let mut w = followed();
    let (mac, mac_b, alice) = (w.mac_a, w.mac_b, w.alice);
    for i in 0..posts {
        let e = post(&mut w, &format!("Post {i}"), true);
        for k in 1..edits {
            w.lab.edit(mac, alice, e, |item| item.set_text(2, &format!("edit {k}"))).expect("an edit");
        }
    }
    for i in 0..noise {
        w.lab.create(mac, alice, alice, "note", &[TAG], document(&format!("Note {i}"), "x", mac)).expect("a note");
    }
    w.lab.sync_all(0);
    // a read on Bob's Mac works out what it received, so the device is settled and its index saves
    // Bob's Mac works out what it received, so it is settled and its index saves
    while !matches!(w.lab.catch_up_step(mac_b, 4096), avendb::lab::CatchUp::Caught(_)) {}
    while !w.lab.settled(mac_b) && w.lab.catch_up(mac_b) {}
    let lab = Mutex::new(w.lab);
    let ix = SharedIndex::open(Memory::new().shelf()).await.unwrap();
    let held = lab.lock().unwrap().log(mac_b).ids().len();
    let stepped = ix.step(&lab, mac_b, held).await.unwrap();
    assert!(!matches!(stepped, crate::shared_index::Stepped::Not), "the index saved: {}", lab.lock().unwrap().settled(mac_b));
    (lab, ix, mac_b)
}

/// The least time of a page and the one after it, µs.
async fn least(lab: &Mutex<Lab>, ix: &SharedIndex, me: SignerId) -> f64 {
    let mut best = f64::INFINITY;
    for _ in 0..ROUNDS {
        let t = Instant::now();
        let first = page(ix, lab, me, PAGE, None).await.unwrap().expect("off the index");
        best = best.min(t.elapsed().as_secs_f64() * 1e6);
        assert_eq!(first["ok"]["posts"].as_array().map(Vec::len), Some(PAGE), "a whole page");
        let last = EntryId::from_hex(first["ok"]["posts"][PAGE - 1]["entry"].as_str().unwrap());
        let t = Instant::now();
        std::hint::black_box(page(ix, lab, me, PAGE, last).await.unwrap());
        best = best.min(t.elapsed().as_secs_f64() * 1e6);
    }
    best
}

#[tokio::test]
#[ignore = "a bench"]
async fn bench_posts_off_the_index() {
    let shapes = [(POSTS, 1, 0), (MORE * POSTS, 1, 0), (POSTS, EDITS, 0), (POSTS, 1, NOISE)];
    let mut us = vec![];
    for (p, e, n) in shapes {
        let (lab, ix, me) = fixture(p, e, n).await;
        us.push(least(&lab, &ix, me).await);
    }
    let per_post = ((us[1] - us[0]) / ((MORE - 1) * POSTS) as f64).max(0.0);
    let per_edit = ((us[2] - us[0]) / ((EDITS - 1) * POSTS) as f64).max(0.0);
    let per_entry = ((us[3] - us[0]) / NOISE as f64).max(0.0);
    let at = |n: f64, each: f64| ((us[0] + n / 50.0 * each) / 1000.0 * 10.0).round() / 10.0;
    let line = json!({
        "kind": "posts_node",
        "page": PAGE,
        "us": us.iter().map(|x| x.round()).collect::<Vec<_>>(),
        "per_post_us": (per_post * 100.0).round() / 100.0,
        "per_edit_us": (per_edit * 100.0).round() / 100.0,
        "per_entry_us": (per_entry * 100.0).round() / 100.0,
        "at_1m_ms": at(1e6, per_entry),
        "at_10m_ms": at(1e7, per_entry),
        "at_1m_all_posts_ms": at(1e6, per_post + 49.0 * per_edit),
        "at_10m_all_posts_ms": at(1e7, per_post + 49.0 * per_edit),
    });
    println!("BENCH {line}");
}
