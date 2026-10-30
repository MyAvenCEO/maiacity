//! The door of an Aven Peer that keeps its tree, over a real store: Lean's claim traces (`id/spec/vectors/claims.json`,
//! README rule 10) sent as browsers send them, every assertion signed for real; a restart opens a new door on the same
//! store and must read back the model's tree, a wipe is an empty store. And two doors on one store, racing to claim
//! it: exactly one claim is kept.
#![cfg(feature = "native")]

use std::path::PathBuf;
use std::sync::Arc;

use aven_db_store::backend::{self, DalStore};
use aven_id::{Network, Relying};
use aven_peer::door::Door;
use p256::ecdsa::signature::Signer;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../id/spec/vectors")
        .join(file);
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len() / 2)
        .map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap())
        .collect()
}

/// A statement as a browser sends it: its assertion signed for real by the test passkey the model names.
fn statement(v: &Value) -> String {
    let a = &v["assertion"];
    let key = Sha256::digest(format!(
        "avenSANDBOX test passkey: {}",
        a["signer"].as_str().unwrap()
    ));
    let key = p256::ecdsa::SigningKey::from_slice(&key).unwrap();
    let mut signed = unhex(a["signed"]["authData"].as_str().unwrap());
    signed.extend_from_slice(&Sha256::digest(
        a["signed"]["clientData"].as_str().unwrap().as_bytes(),
    ));
    let signature: p256::ecdsa::Signature = key.sign(&signed);
    let mut v = v.clone();
    v["assertion"] = json!({
        "clientData": a["clientData"],
        "authData": a["authData"],
        "signature": hex(signature.to_der().as_bytes()),
    });
    v.to_string()
}

fn tree(n: &Network) -> Value {
    let keys: Vec<Value> = n
        .publics()
        .into_iter()
        .map(|(id, k)| json!([id, k]))
        .collect();
    let vaults: Vec<Value> = n
        .vaults()
        .iter()
        .map(|v| {
            let owners: Vec<String> = v.owners.iter().map(ToString::to_string).collect();
            json!({ "id": v.id, "name": v.name, "kind": v.kind.as_str(), "owners": owners })
        })
        .collect();
    json!({ "keys": keys, "vaults": vaults })
}

async fn open(store: &Arc<DalStore>, server: &Value) -> Door {
    let text = |k: &str| server[k].as_str().unwrap().to_string();
    let origins = server["origins"].as_array().unwrap().iter().map(|o| o.as_str().unwrap().to_string()).collect();
    let rp = Relying { rp_id: text("rpId"), origins };
    Door::open(
        "aven-peer".into(),
        store.clone(),
        &text("peerKey"),
        rp,
        server["guardian"].as_str().map(str::to_string),
        (&text("coop"), &text("coopName")),
        Arc::new(|_| {}),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn the_door_keeps_the_models_tree() {
    for v in vectors("claims.json") {
        let server = &v["input"]["server"];
        let mut store = Arc::new(backend::memory().unwrap());
        let mut door = open(&store, server).await;
        let ops = v["input"]["ops"].as_array().unwrap();
        for (at, (op, want)) in ops
            .iter()
            .zip(v["expected"].as_array().unwrap())
            .enumerate()
        {
            let from = op["from"].as_str().unwrap_or_default();
            let ok = match op["op"].as_str().unwrap() {
                "claim" => door
                    .claim(from, &statement(&op["claim"]))
                    .await
                    .is_ok(),
                "signIn" => door.sign_in(from, &statement(&op["signIn"])).await.is_ok(),
                "restart" => {
                    door = open(&store, server).await;
                    true
                }
                "wipe" => {
                    store = Arc::new(backend::memory().unwrap());
                    door = open(&store, server).await;
                    true
                }
                other => panic!("unknown op {other}"),
            };
            let name = format!("{}, step {at}", v["name"]);
            assert_eq!(
                ok,
                want["answer"]["ok"] == json!(true),
                "{name}: {}",
                want["answer"]
            );
            assert_eq!(tree(&door.network()), want["tree"], "{name}");
        }
    }
}

#[tokio::test]
async fn of_two_racing_claims_one_is_kept() {
    let all = vectors("claims.json");
    let trace = all
        .iter()
        .find(|v| v["name"] == "the first signup claims, a second signup with another passkey is refused")
        .unwrap();
    let server = &trace["input"]["server"];
    let (first, second) = (&trace["input"]["ops"][0], &trace["input"]["ops"][1]);
    let store = Arc::new(backend::memory().unwrap());
    // two writers on one store, which the one writer never allows: the ref's compare-and-set still keeps one
    let (a, b) = (open(&store, server).await, open(&store, server).await);
    let (s1, s2) = (statement(&first["claim"]), statement(&second["claim"]));
    let (x, y) = tokio::join!(
        a.claim(first["from"].as_str().unwrap(), &s1),
        b.claim(second["from"].as_str().unwrap(), &s2),
    );
    assert_eq!(
        [x.is_ok(), y.is_ok()].iter().filter(|ok| **ok).count(),
        1,
        "{x:?} {y:?}"
    );
    let kept = open(&store, server).await.network();
    let winner = if x.is_ok() {
        &first["claim"]
    } else {
        &second["claim"]
    };
    assert_eq!(
        kept.claim().unwrap().person,
        winner["person"].as_str().unwrap()
    );
}
