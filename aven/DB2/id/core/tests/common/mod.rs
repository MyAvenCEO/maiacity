//! What aven-id's tests share: Lean's vectors (`id/spec/vectors`, `lake exe vectors`) and aven-id's answers in the
//! model's JSON form (`Aven.ID.Json`), so a test compares the two as values and writes no expected value of its own.

#![allow(dead_code)]

pub mod caps;
pub mod model;

use std::path::PathBuf;

use aven_id::{Invalid, Kind, Owner, SignError, Tree, Vault};
use serde_json::{Value, json};

/// A vector file, as Lean wrote it.
pub fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A tree in the model's form: key ids and vaults, each with its name, the kinds and owners as text. `Err` when it isn't one.
pub fn parse(input: &Value) -> Result<(Vec<String>, Vec<Vault>), String> {
    let keys = input["keys"].as_array().ok_or("no keys")?;
    let keys = keys
        .iter()
        .map(|k| k.as_str().map(str::to_string).ok_or("a key isn't text"))
        .collect::<Result<_, _>>()?;
    let mut vaults = Vec::new();
    for v in input["vaults"].as_array().ok_or("no vaults")? {
        let id = v["id"].as_str().ok_or("no id")?.to_string();
        let name = v["name"].as_str().ok_or("no name")?.to_string();
        let kind = v["kind"]
            .as_str()
            .and_then(Kind::parse)
            .ok_or("an unknown kind")?;
        let owners = v["owners"].as_array().ok_or("no owners")?;
        let owners = owners
            .iter()
            .map(|o| {
                o.as_str()
                    .and_then(Owner::parse)
                    .ok_or("neither key: nor vault:")
            })
            .collect::<Result<_, _>>()?;
        vaults.push(Vault {
            name,
            id,
            kind,
            owners,
        });
    }
    Ok((keys, vaults))
}

pub fn case(keys: &[String], vaults: &[Vault]) -> Value {
    let vaults: Vec<Value> = vaults
        .iter()
        .map(|v| {
            let owners: Vec<String> = v.owners.iter().map(Owner::to_string).collect();
            json!({ "id": v.id, "name": v.name, "kind": v.kind.as_str(), "owners": owners })
        })
        .collect();
    json!({ "keys": keys, "vaults": vaults })
}

pub fn answer(t: &Tree, q: &Value) -> Value {
    let arg = |i: usize| q[i].as_str().unwrap_or_default();
    match arg(0) {
        "kind" => json!(t.kind(arg(1)).map(Kind::as_str)),
        "name" => json!(t.vault(arg(1)).map(|v| &v.name)),
        "owners" => json!(t.vault(arg(1)).map_or_else(Vec::new, |v| {
            v.owners.iter().map(Owner::to_string).collect::<Vec<_>>()
        })),
        "owned" => json!(t.owned(arg(1))),
        "governs" => json!(t.governs(arg(1))),
        "chain" => json!(t.chain(arg(1))),
        "actsFor" => json!(t.acts_for(arg(1))),
        "actsThrough" => json!(t.acts_through(arg(1))),
        "accounts" => json!(t.accounts(q[1].as_str())),
        "sees" => json!(t.sees(arg(1))),
        "mayActOn" => json!(t.may_act_on(arg(1), arg(2))),
        other => panic!("unknown query {other}"),
    }
}

/// The rule a tree breaks, as the model names it. A cycle names no vault: which one aven-id finds is its own.
pub fn invalid(why: &Invalid) -> Value {
    match why {
        Invalid::Duplicate(id) => json!({ "rule": "duplicate", "vault": id }),
        Invalid::Unowned(id) => json!({ "rule": "unowned", "vault": id }),
        Invalid::Unknown { vault, owner } => {
            json!({ "rule": "unknown", "vault": vault, "owner": owner.to_string() })
        }
        Invalid::DeviceOwners(id) => json!({ "rule": "deviceOwners", "vault": id }),
        Invalid::DeviceOwns { device, vault } => {
            json!({ "rule": "deviceOwns", "device": device, "vault": vault })
        }
        Invalid::DeviceKeyless(id) => json!({ "rule": "deviceKeyless", "vault": id }),
        Invalid::DeviceKeyOwns { device, vault } => {
            json!({ "rule": "deviceKeyOwns", "device": device, "vault": vault })
        }
        Invalid::Name(id) => json!({ "rule": "name", "vault": id }),
        Invalid::CoopOwner { coop, owner } => {
            json!({ "rule": "coopOwner", "vault": coop, "owner": owner.to_string() })
        }
        Invalid::CoopDevice { coop, device } => {
            json!({ "rule": "coopDevice", "vault": coop, "device": device })
        }
        Invalid::Cycle(_) => json!({ "rule": "cycle" }),
    }
}

/// aven-id's result for a tree and its queries, in the model's form. Keys are known by id only.
pub fn result(keys: &[String], vaults: &[Vault], queries: &[Value]) -> Value {
    let keys = keys.iter().map(|k| (k.clone(), String::new())).collect();
    match Tree::new(keys, vaults.to_vec()) {
        Ok(t) => {
            json!({ "wf": true, "answers": queries.iter().map(|q| answer(&t, q)).collect::<Vec<_>>() })
        }
        Err(why) => json!({ "wf": false, "invalid": invalid(&why), "answers": [] }),
    }
}

pub fn sign_error(e: &SignError) -> Value {
    match e {
        SignError::NotDevice(id) => json!({ "error": "notDevice", "id": id }),
        SignError::NoKey(id) => json!({ "error": "noKey", "id": id }),
        SignError::WrongKey(id) => json!({ "error": "wrongKey", "id": id }),
        SignError::WrongVault { device, vault } => {
            json!({ "error": "wrongVault", "device": device, "vault": vault })
        }
        SignError::BadSignature => json!({ "error": "badSignature" }),
    }
}

/// A test passkey: its P-256 scalar is `sha256("avenSANDBOX test passkey: <id>")` (`Aven.ID.P256`).
pub fn test_passkey(id: &str) -> p256::ecdsa::SigningKey {
    use sha2::{Digest, Sha256};
    let scalar = Sha256::digest(format!("avenSANDBOX test passkey: {id}"));
    p256::ecdsa::SigningKey::from_slice(&scalar).expect("a scalar below the group's order")
}

/// A relying party's origins, as the vectors list them.
pub fn origins(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|o| o.as_str().unwrap().to_string())
        .collect()
}

pub fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

pub fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

/// An assertion as the vectors write it, signed for real: its signer signs what the model says it signed
/// (`signed`: the authenticator data, then the SHA-256 of the client data), and what is sent is the rest.
pub fn assertion(a: &Value) -> aven_id::Assertion {
    use p256::ecdsa::signature::Signer;
    use sha2::{Digest, Sha256};
    let mut signed = unhex(a["signed"]["authData"].as_str().unwrap());
    signed.extend_from_slice(&Sha256::digest(
        a["signed"]["clientData"].as_str().unwrap().as_bytes(),
    ));
    let signature: p256::ecdsa::Signature =
        test_passkey(a["signer"].as_str().unwrap()).sign(&signed);
    aven_id::Assertion {
        client_data: a["clientData"].as_str().unwrap().as_bytes().to_vec(),
        authenticator_data: unhex(a["authData"].as_str().unwrap()),
        signature: signature.to_der().as_bytes().to_vec(),
    }
}

/// A Core Value as Core's vectors write it (`Aven.Core.Value.json`): byte strings as `{"bytes": hex}`.
pub fn core_value(v: &Value) -> aven_core::Value {
    use aven_core::Value as V;
    match v {
        Value::Null => V::Null,
        Value::Bool(b) => V::Bool(*b),
        Value::Number(n) => match n.as_u64() {
            Some(u) => V::Uint(u),
            None => V::Nint((-1 - n.as_i64().unwrap()) as u64),
        },
        Value::String(s) => V::Text(s.clone()),
        Value::Array(xs) => V::Array(xs.iter().map(core_value).collect()),
        Value::Object(m) => match (m.len(), m.get("bytes").and_then(Value::as_str)) {
            (1, Some(h)) => V::Bytes(unhex(h)),
            _ => V::Map(m.iter().map(|(k, x)| (k.clone(), core_value(x))).collect()),
        },
    }
}

/// A hash as Core writes it, `b3:` and hex.
pub fn hash(v: &Value) -> aven_core::Hash {
    aven_core::Hash::parse(v.as_str().unwrap()).unwrap()
}

/// An envelope as Core's vectors write it (`envelopes.json`).
pub fn envelope(v: &Value) -> aven_core::Envelope {
    aven_core::Envelope {
        doc: aven_core::DocId::parse(v["doc"].as_str().unwrap()).unwrap(),
        branch: v["branch"].as_str().unwrap().into(),
        writer: v["writer"].as_u64().unwrap(),
        seq: v["seq"].as_u64().unwrap(),
        prev: v["prev"].as_str().map(|_| hash(&v["prev"])),
        deps: v["deps"].as_array().unwrap().iter().map(hash).collect(),
        body: core_value(&v["body"]),
        sigs: v["sigs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| aven_core::Sig {
                signer: unhex(x["signer"].as_str().unwrap()),
                sig: unhex(x["sig"].as_str().unwrap()),
            })
            .collect(),
    }
}
