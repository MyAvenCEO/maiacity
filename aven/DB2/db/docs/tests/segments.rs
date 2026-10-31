//! Segments and seals: a writer's loose envelopes close at the limits and at every rotation, a segment opens only
//! under its epoch's key with its writer's hybrid signature, a keeper sees only the Doc, the epoch and the padded
//! length, and a reader imports a segment's envelopes through every check an envelope gets. Property tests over seal,
//! open, the commitment and Padmé.

mod common;

use aven_core::{DocId, Envelope, Value, blake3};
use aven_db_docs::limits::Limits;
use aven_db_docs::seal::{Seals, open as unseal, outside, seal};
use aven_db_docs::{BadSegment, Closer, Doc, Genesis, Imported, Segment};
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
        closed.extend(
            closer
                .add(ep.name, Envelope::decode(&b).unwrap(), blake3(&b))
                .map(|c| c.segment),
        );
    }
    assert_eq!(
        closed.len(),
        1,
        "the rotation closed the first epoch's segment"
    );
    let first = &closed[0];
    assert_eq!((first.from, first.to, first.epoch), (1, 4, Some(e1.name)));
    let second_closed = closer.close().expect("the quiet closes the rest");
    assert_eq!(
        second_closed.covers.len(),
        2,
        "covers: the sealed hashes of what it replaces"
    );
    let second = second_closed.segment;
    assert_eq!(
        (second.from, second.to, second.epoch),
        (4, 6, Some(e2.name))
    );
    assert_eq!(second.prev, Some(first.name()));
    assert!(closer.close().is_none());

    let mut ent = TestEntropy::new("seal");
    let s1 = first.seal(&a, &e1, &mut ent);
    let s2 = second.seal(&a, &e2, &mut ent);
    // a keeper sees the Doc, the epoch and the padded length, nothing more
    let o = outside(&s1, 1 << 21).unwrap();
    assert_eq!((o.doc, o.epoch), (g.id(), e1.name));
    assert_eq!(
        o.len,
        aven_id::pad_sealed(o.len - 16) + 16,
        "the ciphertext is the one padding's length plus the tag (A176)"
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
        let r = reader.import_segment(s, e, &Allow).unwrap();
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
        sigs: vec![],
    };
    let mut c = Closer::new(doc, "main", 9, 0, Limits::DEFAULTS);
    let mut sizes = vec![];
    for seq in 1..=600 {
        if let Some(s) = c
            .add(blake3(b"e"), env(seq, 10), blake3(&seq.to_le_bytes()))
            .map(|c| c.segment)
        {
            sizes.push(s.envelopes.len());
        }
    }
    assert_eq!(sizes, [256, 256], "256 envelopes a segment");
    let mut c = Closer::new(doc, "main", 9, 0, Limits::DEFAULTS);
    let mut closed = vec![];
    for seq in 1..=10 {
        closed.extend(
            c.add(
                blake3(b"e"),
                env(seq, 300 * 1024),
                blake3(&seq.to_le_bytes()),
            )
            .map(|c| c.segment),
        );
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
    c.add(e1.name, Envelope::decode(&x).unwrap(), blake3(&x));
    let seg = c.close().unwrap().segment;
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
    let sealed = seal(
        Seals::Envelope,
        &e1,
        &g.id(),
        &x,
        &mut TestEntropy::new("n"),
    );
    // the segment subkey doesn't open it
    assert!(unseal(Seals::Segment, &e1, &sealed, 1 << 21).is_none());
    let mut reader = open(&g);
    assert_eq!(
        reader.import_sealed(&sealed, &e1, &Allow),
        Ok(Imported::Counts)
    );
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn seal_open_round_trips(pt in proptest::collection::vec(any::<u8>(), 0..4096), name in "[a-z]{1,8}", nonce in "[a-z]{1,8}") {
        let e = epoch(&name);
        let doc = DocId(blake3(name.as_bytes()));
        let s = seal(Seals::Segment, &e, &doc, &pt, &mut TestEntropy::new(&nonce));
        let (d, back) = unseal(Seals::Segment, &e, &s, 1 << 20).expect("opens");
        prop_assert_eq!(d, doc);
        prop_assert_eq!(outside(&s, 1 << 20).unwrap().len, aven_id::pad_sealed(pt.len() + 1) + 16);
        prop_assert_eq!(back, pt);
    }

    #[test]
    fn any_flipped_bit_or_other_key_refuses(pt in proptest::collection::vec(any::<u8>(), 1..512), at in any::<usize>(), bit in 0u8..8) {
        let e = epoch("k");
        let doc = DocId(blake3(b"d"));
        let mut s = seal(Seals::Segment, &e, &doc, &pt, &mut TestEntropy::new("n"));
        prop_assert!(unseal(Seals::Segment, &epoch("another"), &s, 1 << 20).is_none());
        let i = at % s.len();
        s[i] ^= 1 << bit;
        prop_assert!(unseal(Seals::Segment, &e, &s, 1 << 20).is_none());
    }

    /// The commitment binds the key: the same ciphertext and nonce under a key whose commitment differs never open.
    #[test]
    fn the_commitment_is_checked_first(pt in proptest::collection::vec(any::<u8>(), 1..256)) {
        let (e, f) = (epoch("k"), epoch("k2"));
        let doc = DocId(blake3(b"d"));
        let s = seal(Seals::Segment, &e, &doc, &pt, &mut TestEntropy::new("n"));
        let other = aven_db_docs::EpochKey { name: e.name, key: f.key };
        prop_assert!(unseal(Seals::Segment, &other, &s, 1 << 20).is_none());
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
                body: aven_core::Value::Null, sigs: vec![] };
            segs.extend(c.add(blake3(&[*ep]), e, blake3(&(i as u64).to_le_bytes())).map(|c| c.segment));
        }
        let mut seqs = vec![];
        for s in &segs {
            prop_assert!(s.envelopes.len() <= 256);
            let eps: Vec<u8> = (s.from..s.to).map(|q| epochs[q as usize - 1]).collect();
            prop_assert!(eps.iter().all(|x| Some(blake3(&[*x])) == s.epoch));
            seqs.extend(s.from..s.to);
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

#[test]
fn a_mixed_sealed_page_lands_in_one_batch() {
    use aven_db_docs::{Item, Unopened};
    let a = device("alice");
    let g = genesis(&a);
    let mut writer = open(&g);
    let w = writer.writer_of(&a, 0);
    let (e1, e2) = (epoch("epoch 1"), epoch("epoch 2"));
    let mut ent = TestEntropy::new("seal");
    let mut closer = Closer::new(g.id(), "main", w, 0, Limits::DEFAULTS);
    let mut sealed_loose = vec![];
    for i in 0..4 {
        let b = commit(&mut writer, &a, &[todo_put(&format!("t{i}"), "x")]);
        let s = seal(Seals::Envelope, &e1, &g.id(), &b, &mut ent);
        assert!(
            closer
                .add(e1.name, Envelope::decode(&b).unwrap(), blake3(&s))
                .is_none()
        );
        sealed_loose.push(s);
    }
    let closed = closer.close().unwrap();
    assert_eq!(
        closed.covers,
        sealed_loose.iter().map(|s| blake3(s)).collect::<Vec<_>>()
    );
    let seg = closed.segment.seal(&a, &e1, &mut ent);
    let later = commit(&mut writer, &a, &[todo_put("t9", "after the segment")]);
    let later = seal(Seals::Envelope, &e2, &g.id(), &later, &mut ent);
    let unknown = seal(
        Seals::Envelope,
        &epoch("an epoch nobody gave us"),
        &g.id(),
        b"x",
        &mut ent,
    );
    // the later loose envelope first: it waits in the page for the segment, and the page settles at once
    let mut reader = open(&g);
    // as a keeper serves them, without kinds: each found by its commitment
    let page = [&later[..], &seg, &unknown, b"junk"].map(Item::Sealed);
    let keys = [&e1, &e2];
    let r = reader.import_items(
        &page,
        |n| keys.iter().copied().find(|k| k.name == *n),
        &Allow,
    );
    assert_eq!(r[0], Ok(vec![Ok(Imported::Counts)]));
    assert_eq!(r[1].as_ref().map(Vec::len), Ok(4));
    assert!(
        r[1].as_ref()
            .unwrap()
            .iter()
            .all(|x| *x == Ok(Imported::Counts))
    );
    assert!(matches!(r[2], Err(Unopened::Epoch(_))));
    assert_eq!(r[3], Err(Unopened::Form));
    assert_eq!(reader.snapshot(), writer.snapshot());
    // a checkpoint is no page's, and a commitment one byte off matches no kind: neither opens
    let mut blind = open(&g);
    let snap = seal(Seals::Checkpoint, &e1, &g.id(), b"a checkpoint", &mut ent);
    let mut wrong = seal(Seals::Envelope, &e1, &g.id(), b"x", &mut ent);
    let n = wrong.len();
    wrong[n - 1] ^= 1;
    let page = [&snap[..], &wrong].map(Item::Sealed);
    let r = blind.import_items(
        &page,
        |n| keys.iter().copied().find(|k| k.name == *n),
        &Allow,
    );
    assert_eq!(r, vec![Err(Unopened::Seal), Err(Unopened::Seal)]);
    // the opening half alone, with no Doc, as the Peer-Light runs it beside the keys: the same envelopes, which import
    // to the same state
    let page = [&later[..], &seg, &unknown].map(Item::Sealed);
    let plain = aven_db_docs::open_page(
        &g,
        &page,
        |n| keys.iter().copied().find(|k| k.name == *n),
        &Limits::DEFAULTS,
    );
    assert_eq!(plain[0].as_ref().map(Vec::len), Ok(1));
    assert_eq!(plain[1].as_ref().map(Vec::len), Ok(4));
    assert!(matches!(plain[2], Err(Unopened::Epoch(_))));
    let mut split = open(&g);
    let envs: Vec<&[u8]> = plain
        .iter()
        .flatten()
        .flatten()
        .map(Vec::as_slice)
        .collect();
    assert!(
        split
            .import_page(&envs, &Allow)
            .iter()
            .all(|x| *x == Ok(Imported::Counts))
    );
    assert_eq!(split.snapshot(), writer.snapshot());
    let another = aven_db_docs::Genesis {
        nonce: [9; 32],
        ..g.clone()
    };
    let other = aven_db_docs::open_page(
        &another,
        &page[..1],
        |n| keys.iter().copied().find(|k| k.name == *n),
        &Limits::DEFAULTS,
    );
    assert_eq!(other, vec![Err(Unopened::Doc)]);
    // a plain item, for a Doc whose items travel sealed, is refused unread (A187)
    let unsealed = commit(&mut writer, &a, &[todo_put("t10", "plain")]);
    assert_eq!(
        aven_db_docs::open_page(&g, &[Item::Plain(&unsealed)], |_| None, &Limits::DEFAULTS),
        vec![Err(Unopened::Plain)]
    );
    // a kind found by the commitment alone, and none under another epoch's key
    assert_eq!(
        aven_db_docs::seal::seals_of(&e1, &seg, 1 << 21),
        Some(Seals::Segment)
    );
    assert_eq!(
        aven_db_docs::seal::seals_of(&e2, &later, 1 << 21),
        Some(Seals::Envelope)
    );
    assert_eq!(aven_db_docs::seal::seals_of(&e2, &seg, 1 << 21), None);
}

/// The keyring travels plain (A187): its envelopes and its segments go unsealed, its Records being ciphertext already,
/// and a reader with no key at all takes them, as one page.
#[test]
fn the_keyring_travels_plain() {
    use aven_db_docs::{Item, Unopened};
    let a = device("alice");
    let g = Genesis::new(
        b"alice's vault",
        aven_id::caps::builtin_type("keyring"),
        &[],
        [3; 32],
    );
    assert!(aven_db_docs::travels_plain(&g));
    let mut writer = Doc::open(g.clone(), |_| None, Limits::DEFAULTS).expect("opens");
    let w = writer.writer_of(&a, 0);
    let named = |i: u64| {
        put(
            &format!("v{i}"),
            version_type(),
            vec![
                ("at", Value::Array(vec![])),
                ("name", Value::Text(format!("v{i}"))),
            ],
        )
    };
    let mut closer = Closer::new(g.id(), "main", w, 0, Limits::DEFAULTS);
    for i in 0..3 {
        let b = commit(&mut writer, &a, &[named(i)]);
        assert!(
            closer
                .add(
                    hash("the keyring's epoch"),
                    Envelope::decode(&b).unwrap(),
                    blake3(&b)
                )
                .is_none()
        );
    }
    let seg = closer.close().unwrap().segment.signed(&a);
    let loose = commit(&mut writer, &a, &[named(3)]);
    // no key: the page opens plain, the later envelope first, and lands whole
    let mut reader = Doc::open(g.clone(), |_| None, Limits::DEFAULTS).unwrap();
    let r = reader.import_items(&[Item::Plain(&loose), Item::Plain(&seg)], |_| None, &Allow);
    assert_eq!(r[0], Ok(vec![Ok(Imported::Counts)]));
    assert_eq!(r[1].as_ref().map(Vec::len), Ok(3));
    assert_eq!(reader.snapshot(), writer.snapshot());
    // the plain segment is checked as a sealed one is once opened: a byte off, and it doesn't hold
    let mut bad = seg.clone();
    let n = bad.len();
    bad[n - 1] ^= 1;
    assert!(matches!(
        aven_db_docs::open_page(&g, &[Item::Plain(&bad)], |_| None, &Limits::DEFAULTS)[..],
        [Err(Unopened::Segment(_))]
    ));
    // another Doc's plain envelope is refused by its Doc
    let other = Genesis {
        nonce: [4; 32],
        ..g.clone()
    };
    let mut od = Doc::open(other.clone(), |_| None, Limits::DEFAULTS).unwrap();
    let theirs = commit(&mut od, &a, &[named(0)]);
    assert_eq!(
        aven_db_docs::open_page(&g, &[Item::Plain(&theirs)], |_| None, &Limits::DEFAULTS),
        vec![Err(Unopened::Doc)]
    );
}
