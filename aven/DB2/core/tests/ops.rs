//! Ops, bounds, calls and targets against Lean's vectors (README rule 10), byte for byte: `ops.json`, `targets.json`
//! and `target-bytes.json`. `model.rs` asks the running model about coverage, narrowing and bounds on random inputs.

mod common;

use aven_core::{Call, CoreOp, Target, Value, decode, encode, type_of_types};
use common::{bound, hex, target, unhex, value, vectors};

#[test]
fn ops() {
    let (mut core, mut calls, mut allows, mut within, mut types) = (0, 0, 0, 0, 0);
    for v in vectors("ops.json") {
        let name = v["name"].as_str().unwrap();
        let (i, x) = (&v["input"], &v["expected"]);
        if name.starts_with("core/1's ") {
            let o = CoreOp::ALL
                .into_iter()
                .find(|o| o.name() == i["op"].as_str().unwrap())
                .unwrap();
            assert_eq!(o.value(), value(i), "{name}: stored form");
            assert_eq!(
                hex(&encode(&o.value())),
                x["cbor"].as_str().unwrap(),
                "{name}: cbor"
            );
            assert_eq!(o.id().text(), x["id"].as_str().unwrap(), "{name}: id");
            assert_eq!(o.writes(), x["writes"].as_bool().unwrap(), "{name}: writes");
            core += 1;
        } else if name.starts_with("a call") {
            let Value::Bytes(op) = value(&i["op"]) else {
                panic!("{name}")
            };
            let Value::Map(params) = value(&i["params"]) else {
                panic!("{name}")
            };
            let call = Call {
                op: aven_core::Hash(op.try_into().unwrap()),
                params,
            };
            let bytes = unhex(x["cbor"].as_str().unwrap());
            assert_eq!(
                hex(&encode(&call.value())),
                x["cbor"].as_str().unwrap(),
                "{name}: cbor"
            );
            assert_eq!(
                decode(&bytes).map(|v| encode(&v)),
                Some(bytes),
                "{name}: canonical"
            );
            assert_eq!(call.op.text(), x["op"].as_str().unwrap(), "{name}: op");
            assert_eq!(call.op, CoreOp::Patch.id(), "{name}: patch's id");
            assert_eq!(
                call.param("missing"),
                Value::Null,
                "{name}: a missing param"
            );
            calls += 1;
        } else if name.starts_with("does it allow? ") {
            assert_eq!(
                bound(&i["bound"]).allows(&value(&i["value"])),
                x.as_bool().unwrap(),
                "{name}"
            );
            allows += 1;
        } else if name.starts_with("is it within? ") {
            let (a, b) = (bound(&i[0]), bound(&i[1]));
            assert_eq!(a.within(&b), x.as_bool().unwrap(), "{name}");
            within += 1;
        } else if name == "the type of types" {
            assert_eq!(aven_core::name_of(&value(i)), type_of_types().0, "{name}");
            assert_eq!(type_of_types().text(), x.as_str().unwrap(), "{name}: id");
            assert!(
                aven_core::Facts::type_of_types().is_type(),
                "{name}: its own type"
            );
            types += 1;
        } else {
            panic!("{name}: no reader for it");
        }
    }
    assert_eq!((core, calls, types), (8, 1, 1));
    assert!(allows >= 5 && within >= 4);
}

#[test]
fn targets() {
    let mut n = 0;
    for v in vectors("targets.json") {
        let name = v["name"].as_str().unwrap();
        let (a, b) = (target(&v["input"][0]), target(&v["input"][1]));
        assert_eq!(a.le(&b), v["expected"].as_bool().unwrap(), "{name}");
        n += 1;
    }
    assert!(n >= 10);
}

#[test]
fn target_bytes() {
    let mut n = 0;
    for v in vectors("target-bytes.json") {
        let name = v["name"].as_str().unwrap();
        let t = target(&v["input"]);
        let bytes = v["expected"].as_str().unwrap();
        assert_eq!(hex(&encode(&t.value())), bytes, "{name}: cbor");
        assert_eq!(
            decode(&unhex(bytes)).and_then(Target::of_value),
            Some(t),
            "{name}: read back"
        );
        n += 1;
    }
    assert!(n >= 6);
}
