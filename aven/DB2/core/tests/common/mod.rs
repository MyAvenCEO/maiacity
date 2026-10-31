//! Reading Lean's vectors (README rule 10): one JSON vector per line, `{"name", "input", "expected"}`, and the readable
//! forms of `Vectors.lean` (`Aven.Core.Json`).

#![allow(dead_code)]

use aven_core::{DocId, Envelope, Hash, Sig, Signed, Value};
use serde_json::Value as Json;

pub fn vectors(file: &str) -> Vec<Json> {
    let path = format!("{}/spec/vectors/{file}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

pub fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

/// A Value from its readable form; the vectors here hold integers, text, maps and byte strings.
pub fn value(j: &Json) -> Value {
    match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Uint(n.as_u64().unwrap()),
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(xs) => Value::Array(xs.iter().map(value).collect()),
        Json::Object(o) if o.len() == 1 && o.contains_key("bytes") && o["bytes"].is_string() => {
            Value::Bytes(unhex(o["bytes"].as_str().unwrap()))
        }
        Json::Object(o) => Value::Map(o.iter().map(|(k, v)| (k.clone(), value(v))).collect()),
    }
}

fn hash(j: &Json) -> Hash {
    Hash::parse(j.as_str().unwrap()).unwrap()
}

/// An envelope from its readable form (`Envelope.json` in `Vectors.lean`).
pub fn envelope(j: &Json) -> Envelope {
    Envelope {
        doc: DocId::parse(j["doc"].as_str().unwrap()).unwrap(),
        branch: j["branch"].as_str().unwrap().into(),
        writer: j["writer"].as_u64().unwrap(),
        seq: j["seq"].as_u64().unwrap(),
        prev: j["prev"].as_str().map(|h| Hash::parse(h).unwrap()),
        deps: j["deps"].as_array().unwrap().iter().map(hash).collect(),
        body: value(&j["body"]),
        sigs: sigs(&j["sigs"]),
    }
}

/// Signatures from their readable form, `[{"signer", "sig"}]`.
pub fn sigs(j: &Json) -> Vec<Sig> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|x| Sig {
            signer: unhex(x["signer"].as_str().unwrap()),
            sig: unhex(x["sig"].as_str().unwrap()),
        })
        .collect()
}

/// A signed thing from its readable form (`Signed.json` in `Vectors.lean`).
pub fn signed(j: &Json) -> Signed {
    Signed {
        label: j["label"].as_str().unwrap().into(),
        body: value(&j["body"]),
        sigs: sigs(&j["sigs"]),
    }
}

pub fn names(j: &Json) -> Vec<Hash> {
    j.as_array().unwrap().iter().map(hash).collect()
}

pub fn bools(j: &Json) -> Vec<bool> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|b| b.as_bool().unwrap())
        .collect()
}

pub fn indices(j: &Json) -> Vec<usize> {
    j.as_array()
        .unwrap()
        .iter()
        .map(|i| i.as_u64().unwrap() as usize)
        .collect()
}

/// A target from its readable form (`Target.json` in `Vectors.lean`).
pub fn target(j: &Json) -> aven_core::Target {
    use aven_core::{Reach, Target};
    let below = || j["below"].as_bool().unwrap();
    let vault = || j["vault"].as_str().unwrap().to_string();
    if let Some(d) = j.get("doc") {
        Target::Doc {
            doc: DocId::parse(d.as_str().unwrap()).unwrap(),
            reach: Reach::of_name(j["reach"].as_str().unwrap()).unwrap(),
        }
    } else if let Some(t) = j.get("type") {
        Target::VaultType {
            vault: vault(),
            r#type: DocId::parse(t.as_str().unwrap()).unwrap(),
            below: below(),
        }
    } else {
        Target::Vault {
            vault: vault(),
            below: below(),
        }
    }
}

/// A bound from its readable form: null for any value, else the values it allows.
pub fn bound(j: &Json) -> aven_core::Bound {
    match j {
        Json::Null => aven_core::Bound::Any,
        Json::Array(vs) => aven_core::Bound::OneOf(vs.iter().map(value).collect()),
        j => panic!("not a bound: {j}"),
    }
}
