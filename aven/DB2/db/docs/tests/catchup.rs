//! Catching up (docs, "Catching up"): 500 envelopes of one Doc imported as one page, judged on one scratch copy and
//! landed in one batch. The target is under a second in every engine (the architect, for Samuel, 30 Oct 2026); this
//! measures the native engine and prints the number, and a page lands what importing one by one lands.

mod common;

use std::time::Instant;

use aven_core::Value;
use aven_db_docs::Imported;
use common::*;

/// `n` envelopes from three writers taking turns, each a put on one of 50 Records, every writer importing the others'.
fn history(n: usize) -> (aven_db_docs::Genesis, Vec<Vec<u8>>) {
    let ds = [device("w0"), device("w1"), device("w2")];
    let g = genesis(&ds[0]);
    let mut docs: Vec<_> = (0..3).map(|_| open(&g)).collect();
    let mut all: Vec<Vec<u8>> = Vec::with_capacity(n);
    let mut seen = [0usize; 3];
    for k in 0..n {
        let who = k % 3;
        for b in &all[seen[who]..] {
            docs[who].import(b, &Allow).unwrap();
        }
        let id = format!("t{}", k % 50);
        let w = if docs[who].snapshot().records.contains_key(&id) {
            put(
                &id,
                todo_type(),
                vec![("count", Value::Uint((k % 100) as u64))],
            )
        } else {
            todo_put(&id, "born")
        };
        match docs[who].commit(
            &ds[who],
            0,
            &[w],
            "now",
            aven_db_docs::Act::default(),
            &Allow,
        ) {
            Ok(b) => all.push(b),
            Err(aven_db_docs::CommitError::Empty) => {}
            Err(e) => panic!("{e:?}"),
        }
        seen[who] = all.len();
    }
    (g, all)
}

#[test]
fn five_hundred_envelopes_in_one_page() {
    let (g, all) = history(500);
    let page: Vec<&[u8]> = all.iter().map(Vec::as_slice).collect();
    let mut reader = open(&g);
    let t = Instant::now();
    let r = reader.import_page(&page, &Allow);
    let took = t.elapsed();
    assert!(
        r.iter().all(|x| *x == Ok(Imported::Counts)),
        "every envelope counts"
    );
    eprintln!(
        "catch-up: {} envelopes of one Doc in one page: {:.0} ms ({} build)",
        all.len(),
        took.as_secs_f64() * 1e3,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    );
    // the same envelopes one by one land the same state
    let mut one = open(&g);
    let t = Instant::now();
    for b in &all {
        one.import(b, &Allow).unwrap();
    }
    eprintln!(
        "catch-up: the same one by one: {:.0} ms",
        t.elapsed().as_secs_f64() * 1e3
    );
    assert_eq!(one.snapshot(), reader.snapshot());
    if !cfg!(debug_assertions) {
        assert!(
            took.as_secs_f64() < 1.0,
            "500 envelopes in under a second natively, took {took:?}"
        );
    }
}

#[test]
fn a_page_in_any_split_lands_the_same() {
    let (g, all) = history(60);
    let mut whole = open(&g);
    whole.import_page(&all.iter().map(Vec::as_slice).collect::<Vec<_>>(), &Allow);
    for size in [1, 7, 25] {
        let mut d = open(&g);
        for chunk in all.chunks(size) {
            d.import_page(&chunk.iter().map(Vec::as_slice).collect::<Vec<_>>(), &Allow);
        }
        assert_eq!(d.snapshot(), whole.snapshot(), "pages of {size}");
    }
    // backwards: everything waits until its past arrives, then the page settles at once
    let mut back = open(&g);
    let rev: Vec<&[u8]> = all.iter().rev().map(Vec::as_slice).collect();
    back.import_page(&rev, &Allow);
    assert_eq!(back.waiting(), 0);
    assert_eq!(back.snapshot(), whole.snapshot());
}
