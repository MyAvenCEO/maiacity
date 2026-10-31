//! The codec and names against Lean's vectors (README rule 10): `core/spec/vectors/cbor.json` and `names.json`.

use aven_core::{DocId, Hash, MAX_DEPTH, TypeId, Value, blake3, decode, encode};
use serde_json::Value as Json;

fn vectors(file: &str) -> Vec<Json> {
    let path = format!("{}/spec/vectors/{file}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| {
            // the deepest vectors nest 513 deep, past serde_json's default limit of 128
            let mut de = serde_json::Deserializer::from_str(l);
            de.disable_recursion_limit();
            serde::Deserialize::deserialize(&mut de).unwrap()
        })
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// A Value from its readable form (`Aven.Core.Json`): integers are numbers, text a string, `{"bytes": hex}` a byte
/// string, objects maps. Numbers are read exactly, past 64 bits (`arbitrary_precision`).
fn value(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => {
            let n: i128 = n.to_string().parse().unwrap();
            if n >= 0 {
                Value::Uint(n as u64)
            } else {
                Value::Nint((-1 - n) as u64)
            }
        }
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(xs) => Value::Array(xs.iter().map(value).collect()),
        Json::Object(o) if o.len() == 1 && o.contains_key("bytes") && o["bytes"].is_string() => {
            Value::Bytes(unhex(o["bytes"].as_str().unwrap()))
        }
        Json::Object(o) => Value::Map(o.iter().map(|(k, v)| (k.clone(), value(v))).collect()),
    }
}

/// Maps in the codec's key order, as `decode` gives them.
fn canonical(v: Value) -> Value {
    match v {
        Value::Array(xs) => Value::Array(xs.into_iter().map(canonical).collect()),
        Value::Map(kvs) => {
            let mut kvs: Vec<(String, Value)> =
                kvs.into_iter().map(|(k, v)| (k, canonical(v))).collect();
            kvs.sort_by(|a, b| {
                a.0.len()
                    .cmp(&b.0.len())
                    .then_with(|| a.0.as_bytes().cmp(b.0.as_bytes()))
            });
            Value::Map(kvs)
        }
        v => v,
    }
}

#[test]
fn cbor() {
    let (mut encoded, mut refused) = (0, 0);
    for v in vectors("cbor.json") {
        let name = v["name"].as_str().unwrap();
        match &v["expected"] {
            Json::String(bytes) => {
                let x = canonical(value(&v["input"]));
                assert_eq!(hex(&encode(&x)), *bytes, "{name}: encode");
                assert_eq!(decode(&unhex(bytes)), Some(x), "{name}: decode");
                encoded += 1;
            }
            Json::Null => {
                let bytes = unhex(v["input"].as_str().unwrap());
                assert_eq!(decode(&bytes), None, "{name}: refused");
                refused += 1;
            }
            e => panic!("{name}: {e}"),
        }
    }
    assert!(
        encoded > 100 && refused > 200,
        "{encoded} encoded, {refused} refused"
    );
}

#[test]
fn names() {
    let mut n = 0;
    for v in vectors("names.json") {
        let name = v["name"].as_str().unwrap();
        match (&v["input"], &v["expected"]) {
            (Json::String(bytes), Json::String(h)) => {
                assert_eq!(blake3(&unhex(bytes)).text(), *h, "{name}");
                assert_eq!(
                    Hash::parse(h).map(|h| h.text()),
                    Some(h.clone()),
                    "{name}: parse"
                );
            }
            (Json::Object(i), Json::Object(e)) => {
                let t = TypeId {
                    r#type: DocId::parse(i["type"].as_str().unwrap()).unwrap(),
                    schema: Hash::parse(i["schema"].as_str().unwrap()).unwrap(),
                };
                assert_eq!(t.text(), e["text"].as_str().unwrap(), "{name}: text");
                assert_eq!(
                    hex(&encode(&t.value())),
                    e["cbor"].as_str().unwrap(),
                    "{name}: cbor"
                );
                assert_eq!(TypeId::of_value(&t.value()), Some(t), "{name}: read back");
            }
            _ => panic!("{name}"),
        }
        n += 1;
    }
    assert!(n >= 17);
}

/// Nesting past `MAX_DEPTH` is refused, however long the input: a megabyte of nested arrays costs no stack. `null`
/// inside 511 arrays is 512 deep, as Lean counts (`cbor.json` has the same from both sides).
#[test]
fn deep() {
    let ok = [vec![0x81u8; MAX_DEPTH - 1], vec![0xF6]].concat();
    assert!(decode(&ok).is_some());
    let deep = [vec![0x81u8; MAX_DEPTH], vec![0xF6]].concat();
    assert_eq!(decode(&deep), None);
    let huge = [vec![0x81u8; 1_000_000], vec![0xF6]].concat();
    assert_eq!(decode(&huge), None);
}

/// A map held out of order is written in the codec's order, and a declared length longer than the input is refused
/// before anything is allocated for it.
#[test]
fn order_and_lengths() {
    let m = Value::Map(vec![
        ("b".into(), Value::Uint(1)),
        ("aa".into(), Value::Uint(2)),
    ]);
    assert_eq!(hex(&encode(&m)), "a261620162616102");
    assert_eq!(
        decode(&[0x9B, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]),
        None
    );
    assert_eq!(
        decode(&[0x5B, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00]),
        None
    );
}
