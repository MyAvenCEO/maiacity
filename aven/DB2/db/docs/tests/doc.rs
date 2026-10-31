//! A Doc's commit, import and verdicts, on real Loro: two peers converge, an unfit write never enters, a split is
//! final for every reader and its log stuck, a revocation rebuilds, an envelope waits for what it names, and every
//! refusal happens before Loro sees the bytes.

mod common;

use aven_core::{Envelope, Held, Value};
use aven_db_docs::{
    Act, Body, ChangeKind, CommitError, Doc, Feed, Genesis, Imported, Limits, Refused, Unfit, Why,
    envelope_valid,
};
use common::*;

#[test]
fn genesis_names_the_doc() {
    let a = device("alice");
    let g = genesis(&a);
    let back = Genesis::decode(&g.encode()).expect("decodes");
    assert_eq!(back, g);
    assert_eq!(back.id(), g.id());
    let mut other = g.clone();
    other.nonce = [6; 32];
    assert_ne!(
        other.id(),
        g.id(),
        "the nonce makes two Docs born alike different"
    );
    assert!(
        Doc::open(g.clone(), &[], Limits::DEFAULTS).is_none(),
        "a pinned schema it doesn't have"
    );
    let builtin = Genesis::new(
        b"v",
        todo_type().r#type,
        &[(version_type().r#type, hash("x"))],
        [5; 32],
    );
    assert!(
        Doc::open(builtin, &[todo()], Limits::DEFAULTS).is_none(),
        "a built-in type is never pinned"
    );
    // the first envelope carries the genesis, and a reader opens the Doc from it
    let mut doc = open(&g);
    let first = commit(&mut doc, &a, &[todo_put("t1", "first")]);
    let body = |b: &[u8]| aven_db_docs::Body::of_value(&Envelope::decode(b).unwrap().body).unwrap();
    assert_eq!(body(&first).genesis, Some(g.clone()));
    let second = commit(&mut doc, &a, &[todo_put("t2", "second")]);
    assert_eq!(body(&second).genesis, None);
    let (mut reader, r) =
        Doc::from_first(&first, &[todo()], Limits::DEFAULTS, &Allow).expect("opens from it");
    assert_eq!(r, Imported::Counts);
    reader.import(&second, &Allow).unwrap();
    assert_eq!(reader.snapshot(), doc.snapshot());
}

#[test]
fn commit_reads_and_feed() {
    let a = device("alice");
    let g = genesis(&a);
    let mut doc = open(&g);
    let bytes = commit(&mut doc, &a, &[todo_put("t1", "Order seeds")]);
    let e = Envelope::decode(&bytes).unwrap();
    assert!(envelope_valid(&e));
    assert_eq!(e.writer, doc.writer_of(&a, 0));
    let snap = doc.snapshot();
    assert_eq!(snap.version, vec![e.name()]);
    assert_eq!(
        snap.records["t1"].fields["title"],
        Value::Text("Order seeds".into())
    );
    assert_eq!(snap.records["t1"].r#type, todo_type().r#type);
    assert_eq!(doc.head().logs[&e.writer], e.name());
    let Feed::Counted { changes, .. } = &doc.feed(0)[0] else {
        panic!("a counted entry")
    };
    assert_eq!(changes[0].kind, ChangeKind::New);
    // an edit, then the Record gone
    commit(
        &mut doc,
        &a,
        &[put("t1", todo_type(), vec![("count", Value::Uint(3))])],
    );
    assert_eq!(doc.snapshot().records["t1"].fields["count"], Value::Uint(3));
    assert_eq!(
        snap.records["t1"].fields.get("count"),
        None,
        "an old read never changes"
    );
    let mut gone = todo_put("t1", "");
    gone.set.clear();
    gone.gone = true;
    commit(&mut doc, &a, &[gone]);
    assert!(doc.snapshot().records.is_empty());
    let kinds: Vec<ChangeKind> = doc
        .feed(0)
        .iter()
        .map(|f| match f {
            Feed::Counted { changes, .. } => changes[0].kind,
            Feed::Rebuilt => panic!("no rebuild"),
        })
        .collect();
    assert_eq!(
        kinds,
        [ChangeKind::New, ChangeKind::Edited, ChangeKind::Gone]
    );
    // nothing changes, nothing is committed
    assert_eq!(
        doc.commit(&a, 0, &[], "now", Act::default(), &Allow),
        Err(CommitError::Empty)
    );
}

#[test]
fn two_peers_converge() {
    let (a, b) = (device("alice"), device("bob"));
    let g = genesis(&a);
    let (mut da, mut db) = (open(&g), open(&g));
    let x1 = commit(&mut da, &a, &[todo_put("t1", "Order seeds")]);
    assert_eq!(db.import(&x1, &Allow), Ok(Imported::Counts));
    assert_eq!(db.import(&x1, &Allow), Ok(Imported::Known));
    // concurrent edits of one field, and each its own Record
    let y1 = commit(
        &mut db,
        &b,
        &[
            put("t1", todo_type(), vec![("count", Value::Uint(7))]),
            todo_put("t2", "Bob's"),
        ],
    );
    let x2 = commit(
        &mut da,
        &a,
        &[put("t1", todo_type(), vec![("count", Value::Uint(9))])],
    );
    assert_eq!(da.import(&y1, &Allow), Ok(Imported::Counts));
    assert_eq!(db.import(&x2, &Allow), Ok(Imported::Counts));
    assert_eq!(da.snapshot().records, db.snapshot().records);
    let mut va = da.snapshot().version.clone();
    let mut vb = db.snapshot().version.clone();
    va.sort();
    vb.sort();
    assert_eq!(va, vb);
    assert_eq!(va.len(), 2, "two tips");
    // a commit on top names both tips, its own log's by `prev` (rule 7)
    let x3 = commit(&mut da, &a, &[todo_put("t3", "after both")]);
    let e3 = Envelope::decode(&x3).unwrap();
    assert_eq!(e3.prev, Some(Envelope::decode(&x2).unwrap().name()));
    assert_eq!(e3.deps, vec![Envelope::decode(&y1).unwrap().name()]);
    assert_eq!(db.import(&x3, &Allow), Ok(Imported::Counts));
    assert_eq!(da.snapshot(), db.snapshot());
}

#[test]
fn waits_for_what_it_names() {
    let (a, b) = (device("alice"), device("bob"));
    let g = genesis(&a);
    let (mut da, mut db, mut dc) = (open(&g), open(&g), open(&g));
    let x1 = commit(&mut da, &a, &[todo_put("t1", "first")]);
    db.import(&x1, &Allow).unwrap();
    let y1 = commit(&mut db, &b, &[todo_put("t2", "builds on it")]);
    assert_eq!(dc.import(&y1, &Allow), Ok(Imported::Waits));
    assert_eq!(dc.waiting(), 1);
    assert_eq!(dc.import(&x1, &Allow), Ok(Imported::Counts));
    assert_eq!(dc.waiting(), 0);
    assert_eq!(dc.snapshot(), db.snapshot());
}

#[test]
fn unfit_writes_never_enter() {
    let a = device("alice");
    let g = genesis(&a);
    let mut doc = open(&g);
    // a required field missing at birth, a value past its bound, a field the schema doesn't have, a version not pinned
    let cases = [
        put("t1", todo_type(), vec![("count", Value::Uint(1))]),
        put(
            "t1",
            todo_type(),
            vec![
                ("title", Value::Text("x".into())),
                ("count", Value::Uint(101)),
            ],
        ),
        put(
            "t1",
            todo_type(),
            vec![
                ("title", Value::Text("x".into())),
                ("colour", Value::Text("red".into())),
            ],
        ),
        put(
            "v1",
            version_type(),
            vec![("name", Value::Text("v1".into()))],
        ),
        put(
            "t1",
            aven_db_docs::Version {
                r#type: todo_type().r#type,
                schema: Some(hash("another schema")),
            },
            vec![("title", Value::Text("x".into()))],
        ),
    ];
    for c in cases {
        let r = doc.commit(
            &a,
            0,
            std::slice::from_ref(&c),
            "now",
            Act::default(),
            &Allow,
        );
        assert!(matches!(r, Err(CommitError::Unfit(_))), "{c:?}: {r:?}");
    }
    assert!(doc.snapshot().records.is_empty());
    assert_eq!(doc.envelopes().count(), 0, "nothing signed, nothing held");
    // a built-in type fits without asking
    commit(
        &mut doc,
        &a,
        &[put(
            "v1",
            version_type(),
            vec![
                ("name", Value::Text("v1".into())),
                ("at", Value::Array(vec![hash("tip").value()])),
            ],
        )],
    );
    // removing a required field is unfit
    commit(&mut doc, &a, &[todo_put("t1", "x")]);
    let mut r = todo_put("t1", "");
    r.set.clear();
    r.unset = vec!["title".into()];
    assert_eq!(
        doc.commit(&a, 0, &[r], "now", Act::default(), &Allow),
        Err(CommitError::Unfit(Unfit::Removed(
            "t1".into(),
            "title".into()
        )))
    );
}

/// An envelope a broken or hostile device signs without checking fit: built by hand from a Loro commit.
fn unchecked(
    doc: &Doc,
    d: &aven_db_docs::Device,
    g: &Genesis,
    id: &str,
    fields: Vec<(&str, loro::LoroValue)>,
    version: aven_db_docs::Version,
) -> Vec<u8> {
    let w = doc.writer_of(d, 0);
    let l = loro::LoroDoc::new();
    l.set_peer_id(w).unwrap();
    let m = l.get_map("records").ensure_mergeable_map(id).unwrap();
    m.insert(
        "t",
        loro::LoroValue::Binary(version.r#type.0.0.to_vec().into()),
    )
    .unwrap();
    for (k, v) in fields {
        m.insert(k, v).unwrap();
    }
    let mut body = Body {
        generation: 0,
        from: 0,
        to: 0,
        records: vec![(id.into(), version)],
        changes: vec![],
        at: "now".into(),
        cap: None,
        acks: vec![],
        calls: vec![],
        genesis: Some(g.clone()),
    };
    l.set_next_commit_message(&body.message());
    l.commit();
    let end = *l.oplog_vv().get(&w).unwrap();
    body.to = end as u64;
    body.changes = l
        .export(loro::ExportMode::updates_in_range(vec![loro::IdSpan::new(
            w, 0, end,
        )]))
        .unwrap();
    let mut e = Envelope {
        doc: g.id(),
        branch: "main".into(),
        writer: w,
        seq: 1,
        prev: None,
        deps: vec![],
        body: body.value(),
        sigs: vec![],
    };
    d.sign_envelope(&mut e);
    e.encode()
}

#[test]
fn a_reader_refuses_what_doesnt_fit_and_the_log_sticks() {
    let (a, m) = (device("alice"), device("mallory"));
    let g = genesis(&a);
    let mut doc = open(&g);
    let bad = unchecked(
        &doc,
        &m,
        &g,
        "t1",
        vec![("title", "x".into()), ("count", loro::LoroValue::I64(500))],
        todo_type(),
    );
    assert!(matches!(
        doc.import(&bad, &Allow),
        Ok(Imported::NotCounted(Why::Unfit(Unfit::Value(..))))
    ));
    assert!(doc.snapshot().records.is_empty());
    // a float is no Value
    let float = unchecked(
        &doc,
        &device("another"),
        &g,
        "t2",
        vec![("title", loro::LoroValue::Double(1.5))],
        todo_type(),
    );
    assert!(matches!(
        doc.import(&float, &Allow),
        Ok(Imported::NotCounted(Why::Unfit(Unfit::Op(_))))
    ));
    // the hostile device's log is stuck: its next commit is refused, its next generation writes
    let mut md = open(&g);
    md.import(&bad, &Allow).unwrap();
    assert_eq!(
        md.commit(
            &m,
            0,
            &[todo_put("t3", "ok")],
            "now",
            Act::default(),
            &Allow
        ),
        Err(CommitError::Stuck)
    );
    let next = md
        .commit(
            &m,
            1,
            &[todo_put("t3", "ok")],
            "now",
            Act::default(),
            &Allow,
        )
        .unwrap();
    assert_eq!(doc.import(&next, &Allow), Ok(Imported::Counts));
}

#[test]
fn refused_before_loro() {
    let (a, b) = (device("alice"), device("bob"));
    let g = genesis(&a);
    let mut doc = open(&g);
    let x1 = commit(&mut open(&g), &a, &[todo_put("t1", "x")]);
    // a flipped byte: the signature, or no envelope at all
    for i in [10, x1.len() / 2, x1.len() - 3] {
        let mut t = x1.clone();
        t[i] ^= 1;
        assert!(doc.import(&t, &Allow).is_err(), "byte {i}");
    }
    // too big, before decoding
    assert_eq!(
        doc.import(&vec![0; Limits::DEFAULTS.sealed + 1], &Allow),
        Err(Refused::Limits)
    );
    // another Doc's
    let other = Genesis::new(
        b"alice's vault",
        todo_type().r#type,
        &[(todo_type().r#type, todo().hash())],
        [6; 32],
    );
    let mut od = Doc::open(other, &[todo()], Limits::DEFAULTS).unwrap();
    let y = commit(&mut od, &a, &[todo_put("t1", "x")]);
    assert_eq!(doc.import(&y, &Allow), Err(Refused::Doc));
    // signed by another device alone: no signature is by the device its writer id names
    let mut e = Envelope::decode(&x1).unwrap();
    e.sigs.clear();
    b.sign_envelope(&mut e);
    assert_eq!(doc.import(&e.encode(), &Allow), Err(Refused::Writer));
    // rule 7: an envelope that names a past its Loro dependencies don't hold
    let mut da = open(&g);
    let x1 = commit(&mut da, &a, &[todo_put("t1", "x")]);
    let mut db = open(&g);
    let lone = commit(&mut db, &b, &[todo_put("t2", "y")]);
    doc.import(&x1, &Allow).unwrap();
    let mut e = Envelope::decode(&lone).unwrap();
    e.deps = vec![Envelope::decode(&x1).unwrap().name()];
    // without the genesis its own first envelope carried, so only rule 7 stands in its way
    let mut body = Body::of_value(&e.body).unwrap();
    body.genesis = None;
    e.body = body.value();
    b.sign_envelope(&mut e);
    assert_eq!(doc.import(&e.encode(), &Allow), Err(Refused::OpIds));
    assert!(
        doc.snapshot().records.contains_key("t1") && !doc.snapshot().records.contains_key("t2")
    );
}

#[test]
fn a_split_is_final_and_matches_the_model() {
    // the shape of `logs.json`: x1, then x2 and a copy x2' after it, y1 on x2, z1 on x2', x3 on x2
    let (x, y, z) = (device("cloned"), device("y"), device("z"));
    let g = genesis(&x);
    let mut d1 = open(&g);
    let x1 = commit(&mut d1, &x, &[todo_put("t1", "first")]);
    let mut d2 = open(&g);
    d2.import(&x1, &Allow).unwrap();
    let x2 = commit(&mut d1, &x, &[todo_put("t2", "second")]);
    let x2c = commit(&mut d2, &x, &[todo_put("t2", "a copy says otherwise")]);
    let y1 = commit(&mut d1, &y, &[todo_put("t3", "on the second")]);
    let z1 = commit(&mut d2, &z, &[todo_put("t4", "on the copy")]);
    let x3 = commit(&mut d1, &x, &[todo_put("t5", "the stuck log goes on")]);
    let order = [&x1, &x2, &y1, &x2c, &z1, &x3];
    let mut reader = open(&g);
    let mut feed = 0;
    for (i, b) in order.iter().enumerate() {
        let r = reader.import(b, &Allow).unwrap();
        if i == 3 {
            assert_eq!(r, Imported::NotCounted(Why::Split));
            assert!(reader.feed(feed).contains(&Feed::Rebuilt));
        }
        feed = reader.feed(0).len();
    }
    let envs: Vec<Envelope> = order.iter().map(|b| Envelope::decode(b).unwrap()).collect();
    let held = Held::new(&envs);
    for e in &envs {
        assert_eq!(
            reader.counts(&e.name()),
            held.counts(e, |_| true, |_| true),
            "seq {} of {}",
            e.seq,
            e.writer
        );
    }
    assert!(reader.counts(&envs[0].name()) && envs[1..].iter().all(|e| !reader.counts(&e.name())));
    let recs = &reader.snapshot().records;
    assert_eq!(
        recs.keys().collect::<Vec<_>>(),
        ["t1"],
        "only what counts is in the live state"
    );
    // the cloned device starts its next generation
    let mut r2 = open(&g);
    for b in order {
        r2.import(b, &Allow).unwrap();
    }
    assert_eq!(
        r2.commit(&x, 0, &[todo_put("t6", "x")], "now", Act::default(), &Allow),
        Err(CommitError::Stuck)
    );
    r2.commit(&x, 1, &[todo_put("t6", "x")], "now", Act::default(), &Allow)
        .unwrap();
}

#[test]
fn a_revocation_rebuilds() {
    let (a, b) = (device("alice"), device("bob"));
    let g = genesis(&a);
    let mut doc = open(&g);
    commit(&mut doc, &a, &[todo_put("t1", "alice's")]);
    let mut db = open(&g);
    for e in doc.envelopes().map(Envelope::encode).collect::<Vec<_>>() {
        db.import(&e, &Allow).unwrap();
    }
    let y = commit(&mut db, &b, &[todo_put("t2", "bob's")]);
    doc.import(&y, &Allow).unwrap();
    commit(&mut doc, &a, &[todo_put("t3", "on bob's")]);
    assert_eq!(doc.snapshot().records.len(), 3);
    let bob = b.public().to_vec();
    doc.reauthorize(&When(move |e: &Envelope, _: &Body| {
        !e.sigs.iter().any(|x| x.signer == bob)
    }));
    assert_eq!(
        doc.snapshot().records.keys().collect::<Vec<_>>(),
        ["t1"],
        "bob's and what built on it drop"
    );
    assert_eq!(doc.feed(0).last(), Some(&Feed::Rebuilt));
}

/// Caps says mallory's chain reaches no grant on the Doc.
struct NotMallory(Vec<u8>);

impl aven_db_docs::Authorize for NotMallory {
    fn reaches(&self, _: &Genesis, signer: &[u8]) -> bool {
        signer != self.0.as_slice()
    }

    fn authorized(&self, _: &Genesis, _: &Envelope, _: &Body) -> bool {
        true
    }
}

#[test]
fn a_stranger_never_reaches_loro() {
    let (a, m) = (device("alice"), device("mallory"));
    let g = genesis(&a);
    let mut doc = open(&g);
    // a well-formed, signed envelope whose Loro bytes are garbage: refused for its signer before Loro would read them
    let mut hostile = unchecked(&doc, &m, &g, "t1", vec![("title", "x".into())], todo_type());
    let mut e = Envelope::decode(&hostile).unwrap();
    let mut body = Body::of_value(&e.body).unwrap();
    body.changes = vec![0xff; 64];
    e.body = body.value();
    m.sign_envelope(&mut e);
    hostile = e.encode();
    let caps = NotMallory(m.public().to_vec());
    assert_eq!(doc.import(&hostile, &caps), Err(Refused::Stranger));
    assert_eq!(
        doc.envelopes().count(),
        0,
        "a stranger's envelope is never held"
    );
    // a member's garbage reaches only Loro's metadata decoding, and is refused there
    assert_eq!(doc.import(&hostile, &Allow), Err(Refused::Loro));
}

#[test]
fn the_genesis_rides_exactly_in_a_logs_first_envelope() {
    let (a, b) = (device("alice"), device("bob"));
    let g = genesis(&a);
    let mut doc = open(&g);
    let x1 = commit(&mut doc, &a, &[todo_put("t1", "first")]);
    let x2 = commit(&mut doc, &a, &[todo_put("t2", "second")]);
    // another writer's first envelope that builds on nothing carries it too; one that builds on others doesn't
    let mut lone = open(&g);
    let y1 = commit(&mut lone, &b, &[todo_put("t3", "bob alone")]);
    let body = |x: &[u8]| Body::of_value(&Envelope::decode(x).unwrap().body).unwrap();
    assert!(
        body(&x1).genesis.is_some() && body(&x2).genesis.is_none() && body(&y1).genesis.is_some()
    );
    let mut db = open(&g);
    db.import(&x1, &Allow).unwrap();
    let z1 = commit(&mut db, &b, &[todo_put("t4", "bob on alice's")]);
    assert!(body(&z1).genesis.is_none());
    // each mismatch is refused: a first without it, a later one with it, and another Doc's genesis
    let resigned = |x: &[u8], f: &dyn Fn(&mut Body)| {
        let mut e = Envelope::decode(x).unwrap();
        let mut bd = Body::of_value(&e.body).unwrap();
        f(&mut bd);
        e.body = bd.value();
        a.sign_envelope(&mut e);
        e.encode()
    };
    let mut reader = open(&g);
    assert_eq!(
        reader.import(&resigned(&x1, &|b| b.genesis = None), &Allow),
        Err(Refused::Doc)
    );
    let other = Genesis::new(
        b"another vault",
        todo_type().r#type,
        &[(todo_type().r#type, todo().hash())],
        [9; 32],
    );
    assert_eq!(
        reader.import(&resigned(&x1, &|b| b.genesis = Some(other.clone())), &Allow),
        Err(Refused::Doc)
    );
    assert_eq!(reader.import(&x1, &Allow), Ok(Imported::Counts));
    assert_eq!(
        reader.import(&resigned(&x2, &|b| b.genesis = Some(g.clone())), &Allow),
        Err(Refused::Doc)
    );
    assert_eq!(reader.import(&x2, &Allow), Ok(Imported::Counts));
}

#[test]
fn avenids_built_in_types_dont_fit_until_caps_supplies_them() {
    let a = device("alice");
    let g = genesis(&a);
    let mut doc = open(&g);
    let cap = aven_db_docs::Version {
        r#type: aven_core::DocId(aven_core::name_of(&Value::Text("avenID cap 1".into()))),
        schema: None,
    };
    let r = doc.commit(
        &a,
        0,
        &[put("c1", cap, vec![("x", Value::Null)])],
        "now",
        Act::default(),
        &Allow,
    );
    assert!(
        matches!(r, Err(CommitError::Unfit(Unfit::Version(_)))),
        "{r:?}"
    );
}
