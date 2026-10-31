//! The fuzz target's inputs on stable (`db/docs/fuzz`, `bun run box sh sandbox/fuzz.sh`): whatever bytes arrive, a Doc
//! refuses or takes them, never panics, and its live state is only ever what counts. Random bytes as an envelope, as
//! the Loro update inside an envelope a member signed (so they reach Loro), as a sealed segment; and real Loro updates
//! with bits flipped, which reach deeper into Loro's decoding than random bytes do.

mod common;

use aven_core::Envelope;
use aven_db_docs::{Body, Doc, Imported};
use common::*;
use proptest::prelude::*;

/// An envelope a member signed around `changes`, its log place right, so its bytes reach Loro.
fn around(
    doc: &Doc,
    d: &aven_db_docs::Device,
    g: &aven_db_docs::Genesis,
    changes: Vec<u8>,
    to: u64,
) -> Vec<u8> {
    let body = Body {
        acks: vec![],
        at: String::new(),
        calls: vec![],
        cap: None,
        changes,
        generation: 0,
        from: 0,
        to,
        records: vec![("t1".into(), todo_type())],
        genesis: Some(g.clone()),
    };
    let mut e = Envelope {
        doc: g.id(),
        branch: "main".into(),
        writer: doc.writer_of(d, 0),
        seq: 1,
        prev: None,
        deps: vec![],
        body: body.value(),
        sigs: vec![],
    };
    d.sign_envelope(&mut e);
    e.encode()
}

fn only_counted(doc: &Doc) -> bool {
    doc.snapshot().version.iter().all(|n| doc.counts(n))
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(256))]

    #[test]
    fn random_bytes_anywhere(mode in 0u8..3, bytes in proptest::collection::vec(any::<u8>(), 0..2048), to in 1u64..40) {
        let a = device("alice");
        let g = genesis(&a);
        let mut doc = open(&g);
        match mode {
            0 => { let _ = doc.import(&bytes, &Allow); }
            1 => { let _ = doc.import(&around(&doc, &a, &g, bytes, to), &Allow); }
            _ => { let _ = doc.import_segment(&bytes, &epoch("e"), &Allow); }
        }
        prop_assert!(only_counted(&doc));
        prop_assert!(doc.snapshot().records.is_empty());
    }

    #[test]
    fn flipped_loro_updates(flips in proptest::collection::vec((any::<usize>(), 0u8..8), 1..6)) {
        let a = device("alice");
        let g = genesis(&a);
        let mut source = open(&g);
        let real = commit(&mut source, &a, &[todo_put("t1", "a title"), todo_put("t2", "another")]);
        let mut body = Body::of_value(&Envelope::decode(&real).unwrap().body).unwrap();
        for (at, bit) in &flips {
            let i = at % body.changes.len();
            body.changes[i] ^= 1 << bit;
        }
        let to = body.to;
        let mut doc = open(&g);
        let r = doc.import(&around(&doc, &a, &g, body.changes, to), &Allow);
        // it is refused or doesn't count, or Loro read it as some valid commit that fits: never a panic
        prop_assert!(r.is_err() || matches!(r, Ok(Imported::NotCounted(_)) | Ok(Imported::Counts)));
        prop_assert!(only_counted(&doc));
    }
}
