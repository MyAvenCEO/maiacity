//! The door of an Aven Peer that keeps its tree, over a real store: Lean's claim and member traces
//! (`id/spec/vectors/claims.json`, `invites.json`, README rule 10) sent as browsers send them, every assertion and
//! one-time signature made for real; a restart opens a new door on the same store and must read back the model's tree,
//! a wipe is an empty store. And two doors on one store, racing to claim it, or to join with one invite: exactly one is
//! kept.
#![cfg(feature = "native")]

use std::path::PathBuf;
use std::sync::Arc;

use aven_db_core::wire::Frame;
use aven_db_store::backend::{self, DalStore};
use aven_id::{Members, Relying};
use aven_peer::door::Door;
use aven_peer::door::Statement;
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
    if v["signature"].is_object() {
        // the one-time key of `Aven.ID.InviteTrace`, `one-time-1` or `one-time-2`
        let s = &v["signature"];
        let key = ["one-time-1", "one-time-2"]
            .into_iter()
            .map(aven_id::test_signer)
            .find(|k| aven_id::public_hex(&k.verifying_key()) == s["signer"])
            .unwrap();
        let signed =
            aven_id::sign_join(&hex(key.as_bytes()), s["signed"].as_str().unwrap()).unwrap();
        v["signature"] = json!(signed);
    }
    v["assertion"] = json!({
        "clientData": a["clientData"],
        "authData": a["authData"],
        "signature": hex(signature.to_der().as_bytes()),
    });
    v.to_string()
}

fn tree(m: &Members) -> Value {
    let keys: Vec<Value> = m
        .publics()
        .into_iter()
        .map(|(id, k)| json!([id, k]))
        .collect();
    let vaults: Vec<Value> = m
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
    let origins = server["origins"]
        .as_array()
        .unwrap()
        .iter()
        .map(|o| o.as_str().unwrap().to_string())
        .collect();
    let rp = Relying {
        rp_id: text("rpId"),
        origins,
    };
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

/// A step's statement as the frame a browser sends.
fn frame(op: &Value) -> Option<Frame> {
    let statement = |k: &str| statement(&op[k]);
    Some(match op["op"].as_str().unwrap() {
        "claim" => Frame::Claim {
            statement: statement("claim"),
        },
        "signIn" => Frame::SignIn {
            statement: statement("signIn"),
        },
        "invite" => Frame::Invite {
            statement: statement("invite"),
        },
        "withdraw" => Frame::Withdraw {
            statement: statement("withdraw"),
        },
        "join" => Frame::Join {
            statement: statement("join"),
        },
        _ => return None,
    })
}

async fn replay(file: &str) -> usize {
    let mut steps = 0;
    for v in vectors(file) {
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
                "restart" => {
                    door = open(&store, server).await;
                    true
                }
                "wipe" => {
                    store = Arc::new(backend::memory().unwrap());
                    door = open(&store, server).await;
                    true
                }
                _ => {
                    let frame = frame(op).unwrap();
                    door.take(from, Statement::of(&frame).unwrap())
                        .await
                        .is_ok()
                }
            };
            let name = format!("{}, step {at}", v["name"]);
            assert_eq!(
                ok,
                want["answer"]["ok"] == json!(true),
                "{name}: {}",
                want["answer"]
            );
            assert_eq!(tree(&door.members()), want["tree"], "{name}");
            if let Some(members) = want.get("members") {
                assert_eq!(json!(door.members().members()), *members, "{name}");
                assert_eq!(
                    aven_peer::door::invites(&door.members()),
                    want["invites"],
                    "{name}"
                );
            }
            steps += 1;
        }
    }
    steps
}

#[tokio::test]
async fn the_door_keeps_the_models_tree() {
    assert!(replay("claims.json").await >= 100);
}

#[tokio::test]
async fn the_door_keeps_the_models_members() {
    assert!(replay("invites.json").await >= 400);
}

async fn take(door: &Door, op: &Value) -> Result<(), String> {
    let from = op["from"].as_str().unwrap();
    door.take(from, Statement::of(&frame(op).unwrap()).unwrap())
        .await
}

/// Two writers on one store, which the one writer never allows: the ref's compare-and-set still keeps exactly one of
/// two statements racing for it.
async fn race(file: &str, trace: &str, before: usize, first: usize, second: usize) -> (Door, bool) {
    let all = vectors(file);
    let trace = all.iter().find(|v| v["name"] == trace).unwrap();
    let server = &trace["input"]["server"];
    let ops = trace["input"]["ops"].as_array().unwrap();
    let store = Arc::new(backend::memory().unwrap());
    let setup = open(&store, server).await;
    for op in &ops[..before] {
        let from = op["from"].as_str().unwrap_or_default();
        setup
            .take(from, Statement::of(&frame(op).unwrap()).unwrap())
            .await
            .unwrap();
    }
    let (a, b) = (open(&store, server).await, open(&store, server).await);
    let (x, y) = tokio::join!(take(&a, &ops[first]), take(&b, &ops[second]));
    assert_eq!(
        [x.is_ok(), y.is_ok()].iter().filter(|ok| **ok).count(),
        1,
        "{x:?} {y:?}"
    );
    (open(&store, server).await, x.is_ok())
}

#[tokio::test]
async fn of_two_racing_claims_one_is_kept() {
    let name = "the first signup claims, a second signup with another passkey is refused";
    let (kept, first) = race("claims.json", name, 0, 0, 1).await;
    let winner = vectors("claims.json")
        .into_iter()
        .find(|v| v["name"] == name)
        .unwrap();
    let winner = &winner["input"]["ops"][if first { 0 } else { 1 }]["claim"];
    assert_eq!(
        kept.members().network().claim().unwrap().person,
        winner["person"].as_str().unwrap()
    );
}

#[tokio::test]
async fn of_two_racing_joins_with_one_invite_one_is_kept() {
    let name =
        "the admin invites, a person joins with the link, and the link used again is refused";
    let (kept, _) = race("invites.json", name, 2, 2, 3).await;
    assert_eq!(kept.members().members().len(), 1);
}
