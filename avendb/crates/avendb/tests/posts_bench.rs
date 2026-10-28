//! The Universe's named query bench (gate G1, batch 5, 2026-10-27): what a page of `query-posts` costs (task A3, a
//! query entry whose `read` runs the engine's `posts` op with its `after` cursor), and what it grows with. A window
//! query reads its page off an index, so its cost holds whatever else the vault holds; this one is held to that.
//!
//!   cargo test -p avendb --features test-fixtures --test posts_bench -- --ignored --nocapture
//!
//! A Lab of 1M or 10M edits can't be written in a test (its debug checks replay the log on each write), so the bench
//! measures the slopes instead: one base vault of `POSTS` published posts, and three like it, each with one thing
//! more: `MORE` times the posts, `EDITS` edits on each post, or `NOISE` public entries that are no posts. A page (20
//! posts, the first and one `after` a cursor, called through the query entry as Bob, who follows the vault) is timed
//! on each; what it costs more over the base, per post, per edit of a post and per other entry, is what it reads of
//! them (0 off an index). From the slopes, a page at 1M and 10M edits, an entry per 50: `at_1m_ms` where every entry
//! is no post (the least), `at_1m_all_posts_ms` where each is a post of 50 edits. `avendb-bench.mjs --posts` gates them.

use std::time::Instant;

use avendb::cast;
use avendb::engine;
use avendb::id::{EntryId, SignerId};
use avendb_testkit::ok;
use serde_json::{Value, json};

const QUERY_V1: &str = r#"{"title": "Query, v1", "type": "object", "required": ["kind"], "properties": {
  "kind": { "const": "query" }, "title": { "type": "string", "default": "" },
  "interface": { "type": "object", "default": {} }, "where": { "type": "object", "default": {} } }}"#;
const TAG: &str = "content:published";
/// The base's published posts.
const POSTS: usize = 60;
/// The entries that are no posts in the fourth vault.
const NOISE: usize = 480;
/// A page's posts.
const PAGE: u64 = 20;
/// The rounds of pages timed, for the least of each.
const CALLS: usize = 60;

fn run(w: &mut cast::World, d: SignerId, op: Value) -> Value {
    engine::run(&mut w.lab, d, &op)
}

/// A vault of Alice's, as Bob's Mac follows it: `posts` published posts with `edits` edits each, `noise` other
/// entries, and the query entry; the query's address.
fn fixture(posts: usize, edits: usize, noise: usize) -> (cast::World, Value) {
    let mut w = cast::world();
    let (alice, mac, mac_b) = (w.alice, w.mac_a, w.mac_b);
    let hex = alice.to_hex();
    w.lab.add_schema(mac, alice, alice, QUERY_V1.as_bytes()).expect("a lane entry");
    for i in 0..posts {
        let value = json!({ "kind": "post", "title": format!("Post {i}"), "text": "Out now.", "channel": "Devlog" });
        let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": hex, "type": "post", "tags": [TAG], "value": value })));
        let e = EntryId::from_hex(made["entry"].as_str().unwrap()).unwrap();
        for k in 1..edits {
            w.lab.edit(mac, alice, e, |item| item.set_text(2, &format!("edit {k}"))).expect("an edit");
        }
    }
    for i in 0..noise {
        w.lab.create(mac, alice, alice, "note", &[], cast::document(&format!("Note {i}"), "x", mac)).expect("a note");
    }
    for what in [json!({ "tag": TAG }), json!({ "type": ["query"] }), json!({ "type": ["note"] })] {
        ok(run(&mut w, mac, json!({ "op": "share", "over": hex, "who": "everyone", "level": "Public", "what": what })));
    }
    let footprint = json!({ "all": [{ "type": ["post"] }, { "tag": TAG }] });
    let value = json!({ "kind": "query", "title": "query-posts", "where": footprint, "interface": {
        "version": 1, "description": "Reads the published posts, newest first.", "events": [], "needs": [], "methods": [
            { "name": "read", "params": ["limit", "after"], "ops": [{ "op": "read" }], "where": footprint,
              "run": { "op": "posts", "limit": { "$": "limit" }, "after": { "$": "after" } } }] } });
    let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": hex, "type": "query", "value": value })));
    ok(run(&mut w, mac_b, json!({ "op": "follow", "vault": hex, "on": true })));
    w.lab.sync_all(0);
    (w, json!({ "vault": hex, "entry": made["entry"], "version": 1 }))
}

/// A page on Bob's Mac in µs, the first and the one after it: through the query entry, or (`raw`) the `posts` op it
/// runs, alone.
fn page_us(w: &mut cast::World, to: &Value, raw: bool) -> [f64; 2] {
    let (mac_b, bob) = (w.mac_b, w.bob.to_hex());
    let call = |after: Value| match raw {
        false => json!({ "op": "call", "to": to, "method": "read", "args": { "limit": PAGE, "after": after }, "as": bob }),
        true => json!({ "op": "posts", "limit": PAGE, "after": after }),
    };
    let t = Instant::now();
    let first = ok(run(w, mac_b, call(Value::Null)));
    let a = t.elapsed().as_secs_f64() * 1e6;
    assert_eq!(first["posts"].as_array().map(Vec::len), Some(PAGE as usize), "a whole page");
    let t = Instant::now();
    std::hint::black_box(ok(run(w, mac_b, call(first["posts"][PAGE as usize - 1]["entry"].clone()))));
    [a, t.elapsed().as_secs_f64() * 1e6]
}

/// The least of each shape's pages, timed in rounds, a page of each shape a round, so a busy moment of the machine
/// falls on all alike.
fn least(made: &mut [(cast::World, Value)], raw: bool) -> Vec<f64> {
    let mut best = vec![f64::INFINITY; made.len()];
    for _ in 0..CALLS {
        for (b, (w, to)) in best.iter_mut().zip(made.iter_mut()) {
            for x in page_us(w, to, raw) {
                *b = b.min(x);
            }
        }
    }
    best
}

/// The times the posts in the second shape, and the edits on each post in the third.
const MORE: usize = 8;
const EDITS: usize = 16;
/// The shapes: the base, then `MORE` times its posts, `EDITS` edits on each post, and `NOISE` public entries more.
const SHAPES: [(usize, usize, usize); 4] = [(POSTS, 1, 0), (MORE * POSTS, 1, 0), (POSTS, EDITS, 0), (POSTS, 1, NOISE)];

#[test]
#[ignore = "a bench"]
fn bench_posts() {
    let t = Instant::now();
    let made: Vec<_> = SHAPES.iter().map(|&(p, e, n)| std::thread::spawn(move || fixture(p, e, n))).collect();
    let mut made: Vec<_> = made.into_iter().map(|h| h.join().expect("a fixture")).collect();
    let write_s = t.elapsed().as_secs_f64();
    let us = least(&mut made, false);
    let raw = least(&mut made, true);
    // what a page costs more for each post, each edit of a post, and each other entry held: 0 where it reads an index
    let per_post = ((us[1] - us[0]) / ((MORE - 1) * POSTS) as f64).max(0.0);
    let per_edit = ((us[2] - us[0]) / ((EDITS - 1) * POSTS) as f64).max(0.0);
    let per_entry = ((us[3] - us[0]) / NOISE as f64).max(0.0);
    // at n edits, an entry per 50: the least, all of them other entries; the Universe's, all of them posts of 50 edits
    let at = |n: f64, each: f64| ((us[0] + n / 50.0 * each) / 1000.0).round();
    let line = json!({
        "kind": "posts",
        "page": PAGE,
        "write_s": (write_s * 100.0).round() / 100.0,
        "call_us": us.iter().map(|x| x.round()).collect::<Vec<_>>(),
        "raw_us": raw.iter().map(|x| x.round()).collect::<Vec<_>>(),
        "base_us": us[0].round(),
        "per_post_us": (per_post * 10.0).round() / 10.0,
        "per_edit_us": (per_edit * 10.0).round() / 10.0,
        "per_entry_us": (per_entry * 10.0).round() / 10.0,
        "at_1m_ms": at(1e6, per_entry),
        "at_10m_ms": at(1e7, per_entry),
        "at_1m_all_posts_ms": at(1e6, per_post + 49.0 * per_edit),
        "at_10m_all_posts_ms": at(1e7, per_post + 49.0 * per_edit),
    });
    println!("BENCH {line}");
}
