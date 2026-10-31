//! Catching up end to end, natively (docs, "Catching up"; PEERS.md §3 and §4): Alice commits 500 envelopes to a Doc
//! and uploads each one sealed to a keeper as she writes it, then her segments with their covers. Bob was offline the
//! whole time. He comes back and asks the keeper what came after his number 0. Page by page, he fetches what he lacks
//! through the fetch gate, puts the parts back together, checks each item's BLAKE3, and imports each page in one batch.
//! His Doc must then be Alice's. The time is printed; the target, under 1 s in every engine, is measured in the box.

use std::collections::BTreeMap;
use std::time::Instant;

use std::sync::Arc;

use aven_core::{DocId, Envelope, Value, blake3};
use aven_db_docs::schema::{Kind as Field, Schema};
use aven_db_docs::seal::{Kind, seal};
use aven_db_docs::{
    Act, Authorize, Body, Closer, Device, Doc, EpochKey, Genesis, Imported, Limits, Record,
    RecordWrite, Snapshot, Version,
};
use aven_id::{Secret, TestEntropy};
use aven_peer_keeper::fetch::{Assembly, answer, parts};
use aven_peer_keeper::{Arrivals, Put, Reader};

/// Caps' answer here: everyone reaches the Doc and is authorized (caps decides it for real).
struct Allow;

impl Authorize for Allow {
    fn reaches(&self, _: &Genesis, _: &[u8]) -> bool {
        true
    }
    fn authorized(&self, _: &Genesis, _: &Envelope, _: &Body, _: &aven_db_docs::Past<'_>) -> bool {
        true
    }
}

fn device(name: &str) -> Device {
    let mut e = TestEntropy::new(name);
    Device::from_seeds(&Secret::generate(&mut e), &Secret::generate(&mut e))
}

fn todo() -> Schema {
    Schema {
        title: "todo".into(),
        fields: vec![
            ("title".into(), Field::Text, true),
            ("count".into(), Field::Uint(100), false),
        ],
        closed: true,
    }
}

fn todo_type() -> Version {
    Version {
        r#type: aven_core::DocId(blake3(b"the todo type Doc")),
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

fn open(g: &Genesis) -> Doc {
    Doc::open(g.clone(), types, Limits::DEFAULTS).expect("opens")
}

fn write(id: String, k: usize, born: bool) -> RecordWrite {
    let set = if born {
        vec![("title".to_string(), Value::Text("born".into()))]
    } else {
        vec![("count".to_string(), Value::Uint((k % 100) as u64))]
    };
    RecordWrite {
        id,
        version: todo_type(),
        set,
        unset: vec![],
        gone: false,
    }
}

#[test]
fn bob_catches_up_five_hundred_envelopes_from_a_keeper() {
    // two segments: one closed at 256 envelopes, one at the end
    assert_eq!(catch_up(500, true), 2);
}

#[test]
fn bob_catches_up_a_segment_and_loose_envelopes() {
    // Alice is still writing: a segment of 256, and 44 loose envelopes no segment covers yet
    assert_eq!(catch_up(300, false), 45);
}

/// Alice writes `n` envelopes, closing her last segment if `close`; Bob catches up from 0. The items he fetched.
fn catch_up(n: usize, close: bool) -> usize {
    let alice = device("alice");
    let g = Genesis::new(
        b"alice's vault",
        todo_type().r#type,
        &[(todo_type().r#type, todo().hash())],
        [5; 32],
    );
    let epoch = EpochKey {
        name: blake3(b"epoch 1"),
        key: Secret::generate(&mut TestEntropy::new("epoch 1")),
    };
    let mut ent = TestEntropy::new("seal");

    // Alice writes, sealing and uploading each envelope at once, and each segment as it closes
    let mut doc = open(&g);
    let w = doc.writer_of(&alice, 0);
    let mut closer = Closer::new(g.id(), "main", w, 0, Limits::DEFAULTS);
    let mut keeper = Arrivals::<[u8; 32]>::default();
    let mut bytes: BTreeMap<[u8; 32], Vec<u8>> = BTreeMap::new();
    let mut segments = std::collections::BTreeSet::new();
    let mut upload = |sealed: Vec<u8>, covers: Vec<aven_core::Hash>, segment: bool| {
        let h = blake3(&sealed).0;
        let put = Put {
            hash: h,
            bytes: sealed.len() as u64,
            covers: covers.iter().map(|c| c.0).collect(),
        };
        keeper.upload("alice-peer-light", &[put]);
        if segment {
            segments.insert(h);
        }
        bytes.insert(h, sealed);
    };
    for k in 0..n {
        let id = format!("t{}", k % 50);
        let born = !doc.snapshot().records.contains_key(&id);
        let b = doc
            .commit(
                &alice,
                0,
                &[write(id, k, born)],
                "2026-10-31T12:00:00Z",
                Act::default(),
                &Allow,
            )
            .expect("commits");
        let sealed = seal(Kind::Envelope, &epoch, &g.id(), &b, &mut ent);
        let closed = closer.add(epoch.name, Envelope::decode(&b).unwrap(), blake3(&sealed));
        upload(sealed, vec![], false);
        if let Some(c) = closed {
            upload(c.segment.seal(&alice, &epoch, &mut ent), c.covers, true);
        }
    }
    if close && let Some(c) = closer.close() {
        upload(c.segment.seal(&alice, &epoch, &mut ent), c.covers, true);
    }
    if close {
        // the segments' covers dropped every loose envelope: the keeper holds only segments
        assert!(keeper.items().all(|i| segments.contains(&i.hash)));
    }

    // Bob comes back at 0 and catches up, a page at a time
    let mut bob = open(&g);
    let mut reader = Reader::default();
    let mut held: BTreeMap<[u8; 32], Vec<u8>> = BTreeMap::new();
    let (mut pages, mut counted) = (0, 0);
    let t = Instant::now();
    loop {
        let (page, more) = keeper.page(reader.at);
        if page.is_empty() {
            break;
        }
        let mut lacks = Reader::lacks(&page, |h| held.contains_key(h));
        while !lacks.is_empty() {
            let a = answer(true, &lacks, |h| keeper.get(h).map(|i| i.bytes))
                .expect("proven, within the limit");
            assert!(!a.served.is_empty(), "every fetch moves");
            for h in &a.served {
                let mut asm = Assembly::default();
                for p in parts(&bytes[h]) {
                    asm.add(p).expect("in order");
                }
                let item = asm
                    .finish(h, |b| blake3(b).0)
                    .expect("hashes to what was asked");
                held.insert(*h, item);
            }
            lacks = a.later;
        }
        // the page lands in one write: one batch import
        // as a keeper serves them, without kinds: each found by its commitment
        let items: Vec<&[u8]> = page.iter().map(|(_, h)| held[h].as_slice()).collect();
        let r = bob.import_sealed_page(&items, |n| (*n == epoch.name).then_some(&epoch), &Allow);
        for item in r {
            for e in item.expect("opens") {
                assert_eq!(e, Ok(Imported::Counts));
                counted += 1;
            }
        }
        assert!(reader.land(&page), "every page moves Bob forward");
        pages += 1;
        if !more {
            break;
        }
    }
    let took = t.elapsed();
    assert_eq!(counted, n);
    assert_eq!(bob.snapshot(), doc.snapshot(), "Bob's Doc is Alice's");
    assert!(keeper.after_all(reader.at).is_empty());
    eprintln!(
        "catch-up from a keeper: {n} envelopes in {} items, {pages} page(s): {:.0} ms ({} build)",
        held.len(),
        took.as_secs_f64() * 1e3,
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        }
    );
    held.len()
}
