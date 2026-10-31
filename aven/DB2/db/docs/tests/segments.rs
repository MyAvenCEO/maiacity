//! Segments and seals: a writer's loose envelopes close at the limits and at every rotation, a segment opens only
//! under its epoch's key with its writer's hybrid signature, a keeper sees only the Doc, the epoch and the padded
//! length, and a reader imports a segment's envelopes through every check an envelope gets. Property tests over seal,
//! open, the commitment and Padmé.

mod common;

use aven_core::{DocId, Envelope, blake3};
use aven_docs::limits::Limits;
use aven_docs::seal::{ENVELOPE_SEAL, SEGMENT_SEAL, open as unseal, outside, padme, seal};
use aven_docs::{BadSegment, Closer, Imported, Segment};
use aven_id::TestEntropy;
use common::*;
use proptest::prelude::*;

#[test]
fn a_segment_closes_at_rotation_and_imports() {
    let a = device("alice");
    let g = genesis(&a);
    let mut doc = open(&g);
    let w = doc.writer_of(&a, 0);
    let (e1, e2) = (epoch("epoch 1"), epoch("epoch 2"));
    let mut closer = Closer::new(g.id(), "main", w, 0, Limits::DEFAULTS);
    let mut closed = vec![];
    for i in 0..5 {
        let b = commit(&mut doc, &a, &[todo_put(&format!("t{i}"), "x")]);
        let ep = if i < 3 { &e1 } else { &e2 };
        closed.extend(closer.add(ep.name, Envelope::decode(&b).unwrap()));
    }
    assert_eq!(
        closed.len(),
        1,
        "the rotation closed the first epoch's segment"
    );
    let first = &closed[0];
    assert_eq!((first.from, first.to, first.epoch), (1, 3, e1.name));
    let second = closer.close().expect("the quiet closes the rest");
    assert_eq!((second.from, second.to, second.epoch), (4, 5, e2.name));
    assert_eq!(second.prev, Some(aven_core::name_of(&first.body())));
    assert!(closer.close().is_none());

    let mut ent = TestEntropy::new("seal");
    let s1 = first.seal(&a, &e1, &mut ent);
    let s2 = second.seal(&a, &e2, &mut ent);
    // a keeper sees the Doc, the epoch and the padded length, nothing more
    let o = outside(&s1, 1 << 21).unwrap();
    assert_eq!((o.doc, o.epoch), (g.id(), e1.name));
    assert_eq!(
        o.len,
        padme(o.len - 16) + 16,
        "the ciphertext is Padmé's length plus the tag"
    );
    // under another epoch's key it doesn't open
    assert_eq!(
        Segment::open(&s1, &g.id(), &e2, &Limits::DEFAULTS).unwrap_err(),
        BadSegment::Seal
    );
    let (back, key) = Segment::open(&s1, &g.id(), &e1, &Limits::DEFAULTS).unwrap();
    assert_eq!(&back, first);
    assert_eq!(key, a.hybrid_public());
    // a reader takes both segments, in order, and holds what the writer holds
    let mut reader = open(&g);
    for (s, e) in [(&s1, &e1), (&s2, &e2)] {
        let r = reader.import_segment(s, e, &allow).unwrap();
        assert!(r.iter().all(|x| *x == Ok(Imported::Counts)), "{r:?}");
    }
    assert_eq!(reader.snapshot(), doc.snapshot());
}

#[test]
fn a_segment_closes_at_its_limits() {
    let doc = DocId(blake3(b"d"));
    let env = |seq: u64, pad: usize| Envelope {
        doc,
        branch: "main".into(),
        writer: 9,
        seq,
        prev: None,
        deps: vec![],
        body: aven_core::Value::Bytes(vec![0; pad]),
        signer: vec![],
        sig: vec![],
    };
    let mut c = Closer::new(doc, "main", 9, 0, Limits::DEFAULTS);
    let mut sizes = vec![];
    for seq in 1..=600 {
        if let Some(s) = c.add(blake3(b"e"), env(seq, 10)) {
            sizes.push(s.envelopes.len());
        }
    }
    assert_eq!(sizes, [256, 256], "256 envelopes a segment");
    let mut c = Closer::new(doc, "main", 9, 0, Limits::DEFAULTS);
    let mut closed = vec![];
    for seq in 1..=10 {
        closed.extend(c.add(blake3(b"e"), env(seq, 300 * 1024)));
    }
    assert!(
        closed
            .iter()
            .all(|s| s.envelopes.iter().map(Vec::len).sum::<usize>() <= 1 << 20),
        "1 MiB a segment"
    );
    assert_eq!(closed.len(), 3);
}

#[test]
fn a_tampered_or_foreign_segment_is_refused() {
    let (a, b) = (device("alice"), device("bob"));
    let g = genesis(&a);
    let mut doc = open(&g);
    let e1 = epoch("epoch 1");
    let w = doc.writer_of(&a, 0);
    let mut c = Closer::new(g.id(), "main", w, 0, Limits::DEFAULTS);
    let x = commit(&mut doc, &a, &[todo_put("t1", "x")]);
    c.add(e1.name, Envelope::decode(&x).unwrap());
    let seg = c.close().unwrap();
    let mut ent = TestEntropy::new("seal");
    // signed by a device that didn't sign its envelopes
    let wrong = seg.seal(&b, &e1, &mut ent);
    assert_eq!(
        Segment::open(&wrong, &g.id(), &e1, &Limits::DEFAULTS).unwrap_err(),
        BadSegment::Signature
    );
    // another Doc's
    assert_eq!(
        Segment::open(
            &seg.seal(&a, &e1, &mut ent),
            &DocId(blake3(b"other")),
            &e1,
            &Limits::DEFAULTS
        )
        .unwrap_err(),
        BadSegment::Seal
    );
    // a run that skips a sequence number
    let mut gap = seg.clone();
    gap.from = 2;
    gap.to = 2;
    assert_eq!(
        Segment::open(
            &gap.seal(&a, &e1, &mut ent),
            &g.id(),
            &e1,
            &Limits::DEFAULTS
        )
        .unwrap_err(),
        BadSegment::Run
    );
}

#[test]
fn a_loose_envelope_travels_sealed() {
    let a = device("alice");
    let g = genesis(&a);
    let mut doc = open(&g);
    let e1 = epoch("epoch 1");
    let x = commit(&mut doc, &a, &[todo_put("t1", "x")]);
    let sealed = seal(ENVELOPE_SEAL, &e1, &g.id(), &x, &mut TestEntropy::new("n"));
    // the segment subkey doesn't open it
    assert!(unseal(SEGMENT_SEAL, &e1, &sealed, 1 << 21).is_none());
    let mut reader = open(&g);
    assert_eq!(
        reader.import_sealed(&sealed, &e1, &allow),
        Ok(Imported::Counts)
    );
}

#[test]
fn padme_bounds() {
    for l in (0..5000).chain([1 << 20, (1 << 20) + 1, 123_456_789]) {
        let p = padme(l);
        assert!(p >= l && p <= l + l / 8 + 1, "{l} → {p}");
        assert_eq!(padme(p), p, "a padded length pads to itself");
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn seal_open_round_trips(pt in proptest::collection::vec(any::<u8>(), 0..4096), name in "[a-z]{1,8}", nonce in "[a-z]{1,8}") {
        let e = epoch(&name);
        let doc = DocId(blake3(name.as_bytes()));
        let s = seal(SEGMENT_SEAL, &e, &doc, &pt, &mut TestEntropy::new(&nonce));
        let (d, back) = unseal(SEGMENT_SEAL, &e, &s, 1 << 20).expect("opens");
        prop_assert_eq!(d, doc);
        prop_assert_eq!(back, pt);
        prop_assert_eq!(outside(&s, 1 << 20).unwrap().len, padme(pt_len(&s)) + 16);
    }

    #[test]
    fn any_flipped_bit_or_other_key_refuses(pt in proptest::collection::vec(any::<u8>(), 1..512), at in any::<usize>(), bit in 0u8..8) {
        let e = epoch("k");
        let doc = DocId(blake3(b"d"));
        let mut s = seal(SEGMENT_SEAL, &e, &doc, &pt, &mut TestEntropy::new("n"));
        prop_assert!(unseal(SEGMENT_SEAL, &epoch("another"), &s, 1 << 20).is_none());
        let i = at % s.len();
        s[i] ^= 1 << bit;
        prop_assert!(unseal(SEGMENT_SEAL, &e, &s, 1 << 20).is_none());
    }

    /// The commitment binds the key: the same ciphertext and nonce under a key whose commitment differs never open.
    #[test]
    fn the_commitment_is_checked_first(pt in proptest::collection::vec(any::<u8>(), 1..256)) {
        let (e, f) = (epoch("k"), epoch("k2"));
        let doc = DocId(blake3(b"d"));
        let s = seal(SEGMENT_SEAL, &e, &doc, &pt, &mut TestEntropy::new("n"));
        let other = aven_docs::EpochKey { name: e.name, key: f.key };
        prop_assert!(unseal(SEGMENT_SEAL, &other, &s, 1 << 20).is_none());
    }

    /// A segment closes at every rotation and at its limits: each holds one epoch, runs on from the one before, and
    /// together with what is still loose they hold every envelope added, in order.
    #[test]
    fn closing_keeps_every_envelope_in_one_epoch(epochs in proptest::collection::vec(0u8..3, 1..700)) {
        let doc = DocId(blake3(b"d"));
        let mut c = Closer::new(doc, "main", 9, 0, Limits::DEFAULTS);
        let mut segs = vec![];
        for (i, ep) in epochs.iter().enumerate() {
            let e = Envelope { doc, branch: "main".into(), writer: 9, seq: i as u64 + 1, prev: None, deps: vec![],
                body: aven_core::Value::Null, signer: vec![], sig: vec![] };
            segs.extend(c.add(blake3(&[*ep]), e));
        }
        let mut seqs = vec![];
        for s in &segs {
            prop_assert!(s.envelopes.len() <= 256);
            let eps: Vec<u8> = (s.from..=s.to).map(|q| epochs[q as usize - 1]).collect();
            prop_assert!(eps.iter().all(|x| blake3(&[*x]) == s.epoch));
            seqs.extend(s.from..=s.to);
        }
        seqs.extend(c.loose().iter().map(|e| e.seq));
        prop_assert_eq!(seqs, (1..=epochs.len() as u64).collect::<Vec<_>>());
        // a rotation always closed: no two neighbours in one segment differ in epoch, and neighbours across segments
        // differ unless a limit closed it
        for w in segs.windows(2) {
            prop_assert!(w[0].epoch != w[1].epoch || w[0].envelopes.len() == 256);
        }
    }
}

/// The plaintext's length a sealed thing pads, read back from its ciphertext's length.
fn pt_len(s: &[u8]) -> usize {
    outside(s, 1 << 20).unwrap().len - 16
}
