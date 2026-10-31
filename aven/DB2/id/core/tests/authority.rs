//! An envelope's authority against Lean's vectors (`authority.json`, `Aven.ID.Authority`) and the running model: what
//! reads, the names it gives, and every other shape read as nothing.

mod common;

use std::cell::RefCell;

use aven_core::{Hash, Value as V};
use aven_id::caps::Authority;
use common::model::Model;
use common::{core_value, hex, unhex, vectors};
use proptest::prelude::*;
use proptest::test_runner::{Config, TestRunner};
use serde_json::{Value, json};

fn answer(a: Option<Authority>) -> Value {
    match a {
        None => json!({ "reads": false }),
        Some(a) => json!({
            "reads": true,
            "caps": a.caps.iter().map(Hash::text).collect::<Vec<_>>(),
            "acks": a.acks.iter().map(Hash::text).collect::<Vec<_>>(),
        }),
    }
}

#[test]
fn authorities_read_as_the_model_says() {
    let all = vectors("authority.json");
    assert!(all.len() >= 12, "{} authority vectors", all.len());
    for v in &all {
        // the CBOR, decoded by Core, is the Value read
        let value = aven_core::decode(&unhex(v["input"]["cbor"].as_str().unwrap()))
            .expect("canonical CBOR");
        assert_eq!(
            aven_core::encode(&core_value(&v["input"]["authority"])),
            aven_core::encode(&value)
        );
        let got = Authority::of_value(&value);
        if let Some(a) = &got {
            assert_eq!(
                hex(&aven_core::encode(&a.value())),
                v["input"]["cbor"],
                "{}",
                v["name"]
            );
        }
        assert_eq!(answer(got), v["expected"], "{}", v["name"]);
    }
}

/// Random Values near an authority's shape go to `aven-id-model`, and every answer must be this crate's.
#[test]
fn authorities_read_as_the_running_model_says() {
    let model = RefCell::new(Model::start());
    let name = prop_oneof![Just(32usize), Just(32usize), Just(31usize), Just(33usize)]
        .prop_flat_map(|n| proptest::collection::vec(any::<u8>(), n))
        .prop_map(V::Bytes);
    let item = prop_oneof![4 => name, 1 => Just(V::Text("cap".into())), 1 => Just(V::Null)];
    let list = prop_oneof![
        5 => proptest::collection::vec(item.clone(), 0..3).prop_map(V::Array),
        1 => item,
    ];
    let key = prop_oneof![
        Just("acks".to_string()),
        Just("caps".to_string()),
        Just("more".to_string())
    ];
    let value = proptest::collection::vec((key, list), 0..4).prop_map(|kvs| {
        let mut kvs: Vec<(String, V)> = kvs;
        kvs.sort_by(|a, b| (a.0.len(), a.0.as_bytes()).cmp(&(b.0.len(), b.0.as_bytes())));
        kvs.dedup_by(|a, b| a.0 == b.0);
        V::Map(kvs)
    });
    // half the draws a well-formed authority, so both answers come often
    let good = (
        proptest::collection::vec(any::<[u8; 32]>(), 0..3),
        proptest::collection::vec(any::<[u8; 32]>(), 0..3),
    )
        .prop_map(|(caps, acks)| {
            Authority {
                caps: caps.into_iter().map(Hash).collect(),
                acks: acks.into_iter().map(Hash).collect(),
            }
            .value()
        });
    let value = prop_oneof![good, value];
    let mut runner = TestRunner::new(Config {
        cases: 300,
        ..Config::default()
    });
    let reads = std::cell::Cell::new(0u32);
    runner
        .run(&value, |v| {
            let ours = answer(Authority::of_value(&v));
            if ours["reads"] == true {
                reads.set(reads.get() + 1);
            }
            let theirs = model
                .borrow_mut()
                .ask(&json!({ "authority": common::caps::value_json(&v) }));
            prop_assert_eq!(&ours, &theirs, "{:?}", v);
            Ok(())
        })
        .unwrap();
    assert!(
        reads.get() > 100 && reads.get() < 250,
        "{} of 300 read",
        reads.get()
    );
}
