//! The contract against Lean's vectors (`spec/vectors/contract.json`): every failure and an answer as the Value the
//! host hands on, and render keys with their names under BLAKE3.

use aven_core::{Hash, decode, encode};
use aven_runtimes_contract::{Failure, RenderKey, result};
use serde_json::Value as Json;

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

const FAILURES: [Failure; 6] = [
    Failure::BadInput,
    Failure::OutOfFuel,
    Failure::OutOfMemory,
    Failure::Refused,
    Failure::OutputTooLarge,
    Failure::BadOutput,
];

#[test]
fn contract() {
    let path = format!(
        "{}/../spec/vectors/contract.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let vs: Vec<Json> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let (mut failures, mut keys) = (0, 0);
    for v in vs {
        let name = v["name"].as_str().unwrap();
        let (input, cbor) = (&v["input"], v["expected"]["cbor"].as_str().unwrap());
        if let Some(f) = input.get("failure") {
            let f = FAILURES
                .iter()
                .find(|x| x.name() == f.as_str().unwrap())
                .unwrap();
            assert_eq!(hex(&encode(&result(&Err(*f)))), cbor, "{name}");
            failures += 1;
        } else if let Some(ok) = input.get("ok") {
            let o = decode(&unhex(ok.as_str().unwrap())).unwrap();
            assert_eq!(hex(&encode(&result(&Ok(o)))), cbor, "{name}");
        } else {
            let k = RenderKey {
                runtime: Hash::parse(input["runtime"].as_str().unwrap()).unwrap(),
                file: Hash::parse(input["file"].as_str().unwrap()).unwrap(),
                params: decode(&unhex(input["params"].as_str().unwrap())).unwrap(),
            };
            assert_eq!(hex(&encode(&k.value())), cbor, "{name}");
            assert_eq!(
                k.name().text(),
                v["expected"]["name"].as_str().unwrap(),
                "{name}"
            );
            keys += 1;
        }
    }
    assert_eq!((failures, keys), (6, 8));
}
