//! A Doc held by two readers' peers (`aven_peer::doc_host::Host`), natively, each on its own shelf: a commit at one is
//! taken at the other from what gossip carries; commits made apart sync by version, each answering the other's tips
//! with the sealed values beyond them; a peer reopens from its shelf as it was; a writer's quiet closes its loose
//! envelopes into a segment a new reader takes whole; and a stranger's envelope is refused at every reader, before
//! Loro sees a byte of it.
#![cfg(feature = "native")]

use std::collections::BTreeSet;
use std::sync::Arc;

use aven_core::{DocId, Envelope, Value, blake3};
use aven_db_docs::Shelf;
use aven_db_docs::schema::{Kind, Schema};
use aven_db_docs::{
    Act, Authorize, Body, EpochKey, Genesis, Imported, Limits, Past, RecordWrite, Refused, Version,
};
use aven_db_store::backend;
use aven_id::{Secret, TestEntropy};
use aven_peer::doc_host::DynStore;
use aven_peer::doc_host::{Committed, Host, Taken};
use aven_peer::docs::{Closing, Live, QUIET_MS, seal_segment};
use iroh::SecretKey;

/// The readers' devices reach the Doc; a stranger's doesn't. Caps implements this; here only who is in.
struct Readers(BTreeSet<[u8; 32]>);

impl Authorize for Readers {
    fn reaches(&self, _: &Genesis, signer: &[u8]) -> bool {
        <[u8; 32]>::try_from(signer).is_ok_and(|k| self.0.contains(&k))
    }

    fn authorized(&self, _: &Genesis, _: &Envelope, _: &Body, _: &Past<'_>) -> bool {
        true
    }
}

fn todo() -> Schema {
    Schema {
        title: "todo".into(),
        fields: vec![
            ("title".into(), Kind::Text, true),
            ("count".into(), Kind::Uint(100), false),
        ],
        closed: true,
    }
}

fn todo_type() -> Version {
    Version {
        r#type: DocId(blake3(b"the todo type Doc")),
        schema: Some(todo().hash()),
    }
}

fn genesis() -> Genesis {
    Genesis::new(
        b"alice's vault",
        todo_type().r#type,
        &[(todo_type().r#type, todo().hash())],
        [5; 32],
    )
}

fn epoch() -> EpochKey {
    let mut e = TestEntropy::new("the test Doc's epoch");
    EpochKey {
        name: blake3(b"the test Doc's epoch"),
        key: Secret::generate(&mut e),
    }
}

fn put(id: &str, title: &str) -> Vec<RecordWrite> {
    vec![RecordWrite {
        id: id.into(),
        version: todo_type(),
        set: vec![("title".into(), Value::Text(title.into()))],
        unset: vec![],
        gone: false,
    }]
}

fn key(seed: u8) -> SecretKey {
    SecretKey::from_bytes(&[seed; 32])
}

async fn host(shelf: Shelf<DynStore>) -> Host<Readers> {
    let readers = [key(1), key(2)]
        .iter()
        .map(|k| *k.public().as_bytes())
        .collect();
    Host::open(
        shelf,
        genesis(),
        &[todo()],
        Limits::DEFAULTS,
        vec![epoch()],
        Readers(readers),
        BTreeSet::new(),
    )
    .await
    .unwrap()
}

fn shelf() -> Shelf<DynStore> {
    Shelf::new(Arc::new(backend::memory().unwrap()))
}

fn titles(h: &Host<Readers>) -> Vec<String> {
    h.snapshot()
        .records
        .values()
        .map(|r| match r.fields.get("title") {
            Some(Value::Text(t)) => t.clone(),
            _ => String::new(),
        })
        .collect()
}

async fn commit(
    h: &mut Host<Readers>,
    device: &SecretKey,
    id: &str,
    title: &str,
    e: &mut TestEntropy,
) -> Committed {
    h.commit(
        device,
        0,
        &put(id, title),
        "2026-10-31T12:00:00Z",
        Act::default(),
        e,
    )
    .await
    .unwrap()
}

/// What `from` answers `to`'s tips with, fetched and taken in at `to`, as `doc_have` and the fetch gate carry it.
async fn sync(from: &mut Host<Readers>, to: &mut Host<Readers>, e: &mut TestEntropy) {
    let hashes = from.answer(&to.tips(), e).await.unwrap();
    let mut items = vec![];
    for h in hashes {
        items.push((false, from.sealed(&h).await.unwrap().expect("served")));
    }
    to.take(&items).await.unwrap();
}

#[tokio::test]
async fn two_readers_share_a_doc() {
    let (alice, bob) = (key(1), key(2));
    let mut e = TestEntropy::new("the host test");
    let alice_shelf = shelf();
    let mut a = host(alice_shelf.clone()).await;
    let mut b = host(shelf()).await;

    // live: what Alice's commit gossips, Bob takes
    let live = commit(&mut a, &alice, "t1", "milk", &mut e).await.live;
    let Live::Sealed(sealed) = live else {
        panic!("a small commit gossips whole")
    };
    assert_eq!(
        b.take(&[(false, sealed)]).await.unwrap(),
        vec![Taken::Imported(vec![Ok(Imported::Counts)])]
    );
    assert_eq!(titles(&b), vec!["milk"]);
    assert_eq!(a.version(), b.version());

    // apart: Alice twice and Bob once, then each answers the other's tips
    commit(&mut a, &alice, "t2", "eggs", &mut e).await;
    commit(&mut a, &alice, "t3", "bread", &mut e).await;
    commit(&mut b, &bob, "t4", "tea", &mut e).await;
    assert_ne!(a.version(), b.version());
    // what lies beyond Bob's tips is exactly Alice's two
    assert_eq!(a.answer(&b.tips(), &mut e).await.unwrap().len(), 2);
    sync(&mut a, &mut b, &mut e).await;
    sync(&mut b, &mut a, &mut e).await;
    assert_eq!(a.version(), b.version());
    assert_eq!(titles(&a), titles(&b));
    assert_eq!(titles(&a).len(), 4);
    // nothing more lies beyond either
    assert!(a.answer(&b.tips(), &mut e).await.unwrap().is_empty());

    // Alice reopens from her shelf as she was
    let again = host(alice_shelf).await;
    assert_eq!(again.version(), a.version());
    assert_eq!(titles(&again), titles(&a));
}

#[tokio::test]
async fn a_strangers_envelope_is_refused_at_every_reader() {
    let (alice, eve) = (key(1), key(9));
    let mut e = TestEntropy::new("the stranger test");
    let mut a = host(shelf()).await;
    let mut b = host(shelf()).await;
    commit(&mut a, &alice, "t1", "milk", &mut e).await;
    sync(&mut a, &mut b, &mut e).await;

    // Eve holds the epoch key (a leaked key, or a removed reader) and writes; no reader takes it
    let mut eves = host(shelf()).await;
    sync(&mut a, &mut eves, &mut e).await;
    let p = eves
        .prepare(
            *eve.public().as_bytes(),
            0,
            &put("t9", "forged"),
            "2026-10-31T12:00:00Z",
            Act::default(),
        )
        .unwrap();
    let sig = eve.sign(&p.signing()).to_bytes();
    // her own peer refuses it too: her signer reaches nothing here
    assert!(eves.finish(p, sig, &mut e).await.is_err());

    // sealed by hand and gossiped as if it were a reader's
    let p = eves
        .prepare(
            *eve.public().as_bytes(),
            0,
            &put("t9", "forged"),
            "2026-10-31T12:00:00Z",
            Act::default(),
        )
        .unwrap();
    let mut env = p.envelope().clone();
    env.add_sig(aven_core::Sig {
        signer: eve.public().as_bytes().to_vec(),
        sig: eve.sign(&p.signing()).to_bytes().to_vec(),
    });
    let sealed = aven_db_docs::seal::seal(
        aven_db_docs::seal::Kind::Envelope,
        &epoch(),
        &a.doc().id(),
        &env.encode(),
        &mut e,
    );
    for reader in [&mut a, &mut b] {
        assert_eq!(
            reader.take(&[(false, sealed.clone())]).await.unwrap(),
            vec![Taken::Imported(vec![Err(Refused::Stranger)])]
        );
        assert_eq!(titles(reader), vec!["milk"]);
    }

    // bytes that aren't a seal, or another Doc's: refused before anything opens
    assert!(matches!(
        b.take(&[(false, b"not a seal".to_vec())]).await.unwrap()[..],
        [Taken::Unopened(_)]
    ));
}

#[tokio::test]
async fn a_quiet_writer_closes_a_segment_a_new_reader_takes() {
    let alice = key(1);
    let mut e = TestEntropy::new("the segment test");
    let mut a = host(shelf()).await;
    let mut closing: Option<Closing> = None;
    let mut closed = vec![];
    for (i, title) in ["milk", "eggs", "bread"].iter().enumerate() {
        let c = commit(&mut a, &alice, &format!("t{i}"), title, &mut e).await;
        let cl = closing.get_or_insert_with(|| {
            Closing::new(a.doc().id(), c.envelope.writer, 0, Limits::DEFAULTS)
        });
        closed.extend(cl.add(c.epoch, c.envelope, c.sealed, 1_000 + i as u64));
    }
    let mut cl = closing.unwrap();
    // nothing closes while the writer writes, nor before it has been quiet long enough
    assert!(closed.is_empty());
    assert!(!cl.due(1_002 + QUIET_MS - 1));
    assert!(cl.due(1_002 + QUIET_MS));
    let c = cl.close().expect("three loose envelopes");
    assert_eq!((c.segment.from, c.segment.to, c.covers.len()), (1, 4, 3));
    assert!(cl.close().is_none());

    let seed = aven_id::Secret::take(&mut alice.to_bytes());
    let sealed = seal_segment(&c, &seed, &epoch(), &mut e);
    // a reader new to the Doc takes the segment whole, as one page
    let mut carol = host(shelf()).await;
    assert_eq!(
        carol.take(&[(true, sealed)]).await.unwrap(),
        vec![Taken::Imported(vec![Ok(Imported::Counts); 3])]
    );
    assert_eq!(carol.version(), a.version());
    assert_eq!(titles(&carol).len(), 3);
}
