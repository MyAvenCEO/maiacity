//! A Doc held by two readers' peers (`aven_peer::doc_host::Reader`), natively, each on its own shelf: a commit at one is
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
    Act, Authorize, Body, EpochKey, Genesis, Imported, Limits, Past, Record, RecordWrite, Refused,
    Snapshot, Version,
};
use aven_db_store::backend;
use aven_id::{Secret, TestEntropy};
use aven_peer::doc_host::DynStore;
use aven_peer::doc_host::{Committed, Reader, Taken};
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

/// The todo type Doc as a reader holds it: one `schema` Record, the version holding the todo schema (A207).
fn types(t: &DocId) -> Option<Arc<Snapshot>> {
    let fields = [
        ("at".to_string(), Value::Array(vec![])),
        ("name".to_string(), Value::Text("v1".into())),
        ("schema".to_string(), todo().value()),
    ];
    let record = Record {
        r#type: aven_db_docs::schema::builtin_type("schema"),
        fields: fields.into_iter().collect(),
    };
    (*t == todo_type().r#type).then(|| {
        Arc::new(Snapshot {
            version: vec![],
            records: [("v1".to_string(), record)].into_iter().collect(),
        })
    })
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

async fn host(shelf: Shelf<DynStore>) -> Reader<Readers> {
    let readers = [key(1), key(2)]
        .iter()
        .map(|k| *k.public().as_bytes())
        .collect();
    Reader::open(
        shelf,
        genesis(),
        types,
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

fn titles(h: &Reader<Readers>) -> Vec<String> {
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
    h: &mut Reader<Readers>,
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
async fn sync(from: &mut Reader<Readers>, to: &mut Reader<Readers>, e: &mut TestEntropy) {
    let hashes = from.answer(&to.tips(), e).await.unwrap();
    let mut items = vec![];
    for h in hashes {
        items.push(from.sealer.get(&h).await.unwrap().expect("served"));
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
        b.take(&[sealed]).await.unwrap(),
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
        .host
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
    assert!(eves.host.finish(p, sig).await.is_err());

    // sealed by hand and gossiped as if it were a reader's
    let p = eves
        .host
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
        aven_db_docs::seal::Seals::Envelope,
        &epoch(),
        &a.doc().id(),
        &env.encode(),
        &mut e,
    );
    for reader in [&mut a, &mut b] {
        assert_eq!(
            reader.take(std::slice::from_ref(&sealed)).await.unwrap(),
            vec![Taken::Imported(vec![Err(Refused::Stranger)])]
        );
        assert_eq!(titles(reader), vec!["milk"]);
    }

    // bytes that aren't a seal, or another Doc's: refused before anything opens
    assert!(matches!(
        b.take(&[b"not a seal".to_vec()]).await.unwrap()[..],
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
        closed.extend(cl.add(
            c.out.epoch.expect("sealed"),
            c.envelope,
            c.out.hash,
            1_000 + i as u64,
        ));
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
        carol.take(&[sealed]).await.unwrap(),
        vec![Taken::Imported(vec![Ok(Imported::Counts); 3])]
    );
    assert_eq!(carol.version(), a.version());
    assert_eq!(titles(&carol).len(), 3);
}

/// The keyring travels plain (A187): its first Record, written by the vault's device, leaves the device as its own bytes,
/// its commit is announced on the group's topic by its version (A195), and another of the vault's devices takes it from
/// those bytes with no key at all.
#[tokio::test]
async fn the_keyring_travels_plain() {
    let alice = key(1);
    let mut e = TestEntropy::new("the keyring test");
    let keyring = Genesis::new(
        b"alice's vault",
        aven_id::caps::builtin_type("keyring"),
        &[],
        [6; 32],
    );
    let open = |s: Shelf<DynStore>| {
        let readers = [key(1), key(2)]
            .iter()
            .map(|k| *k.public().as_bytes())
            .collect();
        Reader::open(
            s,
            keyring.clone(),
            types,
            Limits::DEFAULTS,
            vec![],
            Readers(readers),
            BTreeSet::new(),
        )
    };
    let mut a = open(shelf()).await.unwrap();
    let mut b = open(shelf()).await.unwrap();
    assert!(a.sealer.plain());

    let device = aven_id::SealKey::generate(&mut e);
    let vault_key = aven_id::SealKey::generate(&mut e);
    let (epoch1, _) =
        aven_id::keyring::genesis("alice", &vault_key, &[device.public()], &mut e).unwrap();
    let record = aven_id::caps::EpochRecord {
        epoch: epoch1,
        sigs: vec![],
    };
    let Value::Map(fields) = record.value() else {
        panic!("a Record is a map")
    };
    let id: String = blake3(&record.epoch.to_bytes())
        .0
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let write = RecordWrite {
        id: id.clone(),
        version: Version {
            r#type: aven_id::caps::builtin_type("epoch"),
            schema: None,
        },
        set: fields,
        unset: vec![],
        gone: false,
    };
    let c = a
        .commit(
            &alice,
            0,
            &[write],
            "2026-10-31T12:00:00Z",
            Act::default(),
            &mut e,
        )
        .await
        .unwrap();
    // plain: no epoch, its bytes are the envelope's own, and gossip carries only the version
    assert_eq!(c.out.epoch, None);
    assert_eq!(c.out.bytes, c.envelope.encode());
    assert!(matches!(c.live, Live::Version { version, .. } if version == a.version()));

    // the other device fetches it by hash and takes it, plain
    let got = a
        .sealer
        .get(&c.out.hash)
        .await
        .unwrap()
        .expect("kept for the gate");
    assert_eq!(
        b.take(&[got]).await.unwrap(),
        vec![Taken::Imported(vec![Ok(Imported::Counts)])]
    );
    assert_eq!(b.version(), a.version());
    let held = b.snapshot();
    let r = held.records.get(&id).expect("the epoch Record");
    let back =
        aven_id::caps::EpochRecord::of_value(&Value::Map(r.fields.clone().into_iter().collect()));
    assert_eq!(back.map(|r| r.epoch.name()), Some(record.epoch.name()));
}

/// A peer's view as caps reads it: who each device serves, which devices hold a device cap, and the cap Records the
/// peer holds. The test Doc is Alice's vault's.
struct Peer {
    devices: Vec<([u8; 32], &'static str, bool)>,
    held: Vec<aven_id::caps::Cap>,
    tree: aven_id::Tree,
}

impl aven_peer::joined::Holding for Peer {
    fn judge<R>(&self, f: impl FnOnce(&aven_id::caps::Reader, &[aven_id::caps::Cap]) -> R) -> R {
        use aven_id::caps::{Branches, Ctx, DeviceCap, Reader, World, vault_id};
        let doc = genesis().id();
        let facts = |d: &DocId| {
            (*d == doc).then(|| aven_core::Facts {
                id: doc,
                vault: vault_id("alice"),
                r#type: todo_type().r#type,
            })
        };
        let device = |k: &[u8]| self.devices.iter().find(|d| d.0 == k);
        let vault_of = |k: &[u8]| device(k).map(|d| d.1.to_string());
        let device_cap = |k: &[u8]| {
            device(k).filter(|d| d.2).map(|d| DeviceCap {
                device: format!("{}-device", d.1),
                vault: d.1.into(),
                grants: None,
                branches: Branches::Any,
                host: false,
            })
        };
        let reader = Reader {
            ctx: Ctx {
                tree: &self.tree,
                threshold: &|_| 1,
                in_group: &|_, _| false,
                roles: &[],
                facts: &facts,
            },
            world: World {
                gov: &|_, _| false,
                spawned: &|_, _| false,
                lists: &|_, _| false,
            },
            member: &|_| false,
            vault_of: &vault_of,
            device_cap: &device_cap,
        };
        f(&reader, &self.held)
    }
}

/// A cap that names Bob's vault as holder of a line on the test Doc, issued by nobody: it reaches, it authorizes
/// nothing.
fn unissued_cap() -> aven_id::caps::Cap {
    use aven_id::caps::{Cap, Conditions, Form, Holder, Line};
    Cap {
        id: "unissued".into(),
        issuer: "alice".into(),
        holder: Holder::Vault("bob".into()),
        parent: None,
        form: Form::Grant,
        grant: vec![Line {
            op: blake3(b"any op"),
            doc: aven_core::Target::Doc {
                doc: genesis().id(),
                reach: aven_core::Reach::Itself,
            },
            params: vec![],
        }],
        role: None,
        share: 0,
        conditions: Conditions::default(),
        signer: None,
        approvals: vec![],
    }
}

#[tokio::test]
async fn caps_judges_every_envelope() {
    use aven_id::caps::{Path, Refusal, Refused as CapsRefused};
    use aven_peer::joined::Caps;
    let (alice, bob, alices_new, eve) = (key(1), key(2), key(3), key(9));
    let peer = || {
        Caps(Peer {
            devices: vec![
                (*alice.public().as_bytes(), "alice", true),
                (*bob.public().as_bytes(), "bob", true),
                (*alices_new.public().as_bytes(), "alice", false),
            ],
            held: vec![unissued_cap()],
            tree: aven_id::Tree::new(vec![], vec![]).unwrap(),
        })
    };
    let open = |s: Shelf<DynStore>| {
        Reader::open(
            s,
            genesis(),
            types,
            Limits::DEFAULTS,
            vec![epoch()],
            peer(),
            BTreeSet::new(),
        )
    };
    let mut e = TestEntropy::new("the caps test");
    let mut a = open(shelf()).await.unwrap();
    let mut b = open(shelf()).await.unwrap();

    // Alice's device writes on her vault's own authority, and the other reader takes it
    let c = a
        .commit(
            &alice,
            0,
            &put("t1", "milk"),
            "2026-10-31T12:00:00Z",
            Act::default(),
            &mut e,
        )
        .await
        .unwrap();
    let body = Body::of_value(&c.envelope.body).unwrap();
    assert_eq!(peer().verdict(&c.envelope, &body), Ok(Path::Own));
    let Live::Sealed(sealed) = c.live else {
        panic!("a small commit gossips whole")
    };
    assert_eq!(
        b.take(&[sealed]).await.unwrap(),
        vec![Taken::Imported(vec![Ok(Imported::Counts)])]
    );

    // what each would write, judged by caps before it is signed
    let judged = |device: &SecretKey, act: Act| {
        let p = a
            .host
            .prepare(
                *device.public().as_bytes(),
                0,
                &put("t2", "eggs"),
                "2026-10-31T12:00:00Z",
                act,
            )
            .unwrap();
        let mut env = p.envelope().clone();
        env.add_sig(aven_core::Sig {
            signer: device.public().as_bytes().to_vec(),
            sig: device.sign(&p.signing()).to_bytes().to_vec(),
        });
        let body = Body::of_value(&env.body).unwrap();
        peer().verdict(&env, &body)
    };
    // a device of Alice's vault without a device cap
    assert_eq!(
        judged(&alices_new, Act::default()),
        Err(Some(CapsRefused::Reader(Refusal::Device)))
    );
    // Bob on no authority: his vault isn't the Doc's
    assert_eq!(
        judged(&bob, Act::default()),
        Err(Some(CapsRefused::Reader(Refusal::NoAuthority)))
    );
    // Bob under a cap nobody issued: held, so it reaches, but its chain is refused
    let forged = Act {
        cap: Some(unissued_cap().digest()),
        ..Act::default()
    };
    assert!(matches!(
        judged(&bob, forged),
        Err(Some(CapsRefused::Reader(Refusal::Chain(_))))
    ));
    // Bob under a cap no reader holds
    let unknown = blake3(b"a cap nobody holds");
    assert_eq!(
        judged(
            &bob,
            Act {
                cap: Some(unknown),
                ..Act::default()
            }
        ),
        Err(Some(CapsRefused::UnknownCap(unknown)))
    );

    // at the gate: Bob reaches through the cap he holds, Eve through nothing
    let auth = peer();
    assert!(auth.reaches(&genesis(), bob.public().as_bytes()));
    assert!(!auth.reaches(&genesis(), eve.public().as_bytes()));
    // and a reader refuses to sign what caps refuses
    let p = a
        .host
        .prepare(
            *bob.public().as_bytes(),
            0,
            &put("t3", "tea"),
            "2026-10-31T12:00:00Z",
            Act::default(),
        )
        .unwrap();
    let sig = bob.sign(&p.signing()).to_bytes();
    assert!(a.host.finish(p, sig).await.is_err());
}
