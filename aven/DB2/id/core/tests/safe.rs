//! The safe against Lean's vectors (`Aven.ID.Safe`, `id/spec/vectors/safe.json`): each vector's runtime is built from
//! its lists, its requests are replayed, and every output is the model's.

mod common;

use aven_id::safe::{Op, Out, Runtime, Safe, Secret};
use serde_json::{Value, json};

/// The runtime as the vector lists it; the stand-in service answers a call with its bytes reversed.
struct Listed {
    factors: Vec<String>,
    askers: Vec<String>,
    devices: Vec<String>,
    lends: bool,
}

impl Runtime for Listed {
    fn unlocks(&self, factor: &str) -> bool {
        self.factors.iter().any(|f| f == factor)
    }
    fn tells(&self, asker: &str, _: &Op) -> bool {
        self.askers.iter().any(|a| a == asker)
    }
    fn admitted(&self, device: &str) -> bool {
        self.devices.iter().any(|d| d == device)
    }
    fn lends(&self) -> bool {
        self.lends
    }
    fn service(&self, _: &str, call: &[u8]) -> Vec<u8> {
        call.iter().rev().copied().collect()
    }
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .unwrap()
        .iter()
        .map(|s| s.as_str().unwrap().to_string())
        .collect()
}

fn text(v: &Value) -> String {
    v.as_str().unwrap().to_string()
}

fn bytes(v: &Value) -> Vec<u8> {
    let hex = v.as_str().unwrap();
    (0..hex.len() / 2)
        .map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn secret(v: &Value) -> Secret {
    match v["kind"].as_str().unwrap() {
        "identity" => Secret::Identity(text(&v["device"])),
        "vault" => Secret::Vault(text(&v["name"])),
        "group" => Secret::Group(text(&v["name"])),
        "safe" => Secret::Safe,
        "doc" => Secret::Doc {
            doc: text(&v["doc"]),
            epoch: text(&v["epoch"]),
        },
        "credential" => Secret::Credential(text(&v["name"])),
        other => panic!("a secret of kind {other}"),
    }
}

fn secret_json(s: &Secret) -> Value {
    match s {
        Secret::Identity(d) => json!({ "kind": "identity", "device": d }),
        Secret::Vault(v) => json!({ "kind": "vault", "name": v }),
        Secret::Group(g) => json!({ "kind": "group", "name": g }),
        Secret::Safe => json!({ "kind": "safe" }),
        Secret::Doc { doc, epoch } => json!({ "kind": "doc", "doc": doc, "epoch": epoch }),
        Secret::Credential(c) => json!({ "kind": "credential", "name": c }),
    }
}

fn op(v: &Value) -> Op {
    match v["kind"].as_str().unwrap() {
        "unlock" => Op::Unlock(text(&v["factor"])),
        "lock" => Op::Lock,
        "sign" => Op::Sign {
            key: secret(&v["key"]),
            msg: bytes(&v["msg"]),
        },
        "open" => Op::Open {
            to: secret(&v["to"]),
            inner: secret(&v["inner"]),
        },
        "seal" => Op::Seal {
            to: secret(&v["to"]),
            secret: secret(&v["secret"]),
        },
        "derive" => Op::Derive {
            key: secret(&v["key"]),
            label: text(&v["label"]),
        },
        "use" => Op::Use {
            credential: text(&v["credential"]),
            call: bytes(&v["call"]),
        },
        "enroll" => Op::Enroll(text(&v["device"])),
        other => panic!("an op of kind {other}"),
    }
}

fn out_json(o: &Out) -> Value {
    match o {
        Out::Plain(x) => json!({ "kind": "plain", "secret": secret_json(x) }),
        Out::Sealed { to, secret } => {
            json!({ "kind": "sealed", "to": secret_json(to), "secret": secret_json(secret) })
        }
        Out::Signature { key, msg } => {
            json!({ "kind": "signature", "key": secret_json(key), "msg": hex(msg) })
        }
        Out::PublicKey { key, label } => {
            json!({ "kind": "publicKey", "key": secret_json(key), "label": label })
        }
        Out::Answer(b) => json!({ "kind": "answer", "bytes": hex(b) }),
        Out::Done => json!({ "kind": "done" }),
        Out::Refused => json!({ "kind": "refused" }),
    }
}

#[test]
fn the_safe_gives_back_what_the_model_does() {
    let all = common::vectors("safe.json");
    assert_eq!(all.len(), 3);
    for v in &all {
        let input = &v["input"];
        let r = &input["runtime"];
        assert_eq!(r["service"], "reverse", "{}", v["name"]);
        let runtime = Listed {
            factors: strings(&r["factors"]),
            askers: strings(&r["askers"]),
            devices: strings(&r["devices"]),
            lends: r["lends"].as_bool().unwrap(),
        };
        let mut safe = Safe {
            unlocked: input["safe"]["unlocked"].as_bool().unwrap(),
            holds: input["safe"]["holds"]
                .as_array()
                .unwrap()
                .iter()
                .map(secret)
                .collect(),
        };
        let outs: Vec<Value> = input["asks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|a| out_json(&safe.handle(&runtime, a["asker"].as_str().unwrap(), &op(&a["op"]))))
            .collect();
        assert_eq!(Value::Array(outs), v["expected"]["outs"], "{}", v["name"]);
    }
}

/// `stays_inside` and `safe_holds`, for every request the vectors make: nothing kept ever leaves, and nothing but a
/// Doc's key leaves in plain.
#[test]
fn nothing_kept_leaves() {
    for v in common::vectors("safe.json") {
        for o in v["expected"]["outs"].as_array().unwrap() {
            if o["kind"] == "plain" || o["kind"] == "sealed" {
                let x = secret(&o["secret"]);
                assert!(!x.kept(), "{x:?} left the safe");
                if o["kind"] == "plain" {
                    assert!(x.lendable(), "{x:?} left in plain");
                }
            }
        }
    }
}
