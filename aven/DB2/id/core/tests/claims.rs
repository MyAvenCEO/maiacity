//! Claims and sign-ins against Lean's traces (`id/spec/vectors/claims.json`, README rule 10): each step sent as a
//! browser sends it, every assertion signed for real, a restart reading the network back from its statements as the
//! Aven Peer reads its store. The answers, the challenges and every tree are the model's.

mod common;

use aven_id::{Claim, ClaimError, Network, Relying, SignIn, challenge};
use common::{assertion, invalid, vectors};
use serde_json::{Value, json};

fn error(e: &ClaimError) -> Value {
    match e {
        ClaimError::Taken => json!({ "error": "taken" }),
        ClaimError::NotFromDevice => json!({ "error": "notFromDevice" }),
        ClaimError::WrongNetwork => json!({ "error": "wrongNetwork" }),
        ClaimError::Name => json!({ "error": "name" }),
        ClaimError::Assertion(why) => json!({ "error": "assertion", "why": why.name() }),
        ClaimError::Invalid(why) => json!({ "error": "invalid", "invalid": invalid(why) }),
        ClaimError::Unclaimed => json!({ "error": "unclaimed" }),
        ClaimError::Known => json!({ "error": "known" }),
        ClaimError::Counter => json!({ "error": "counter" }),
    }
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

/// A statement as JSON, with its assertion signed for real, read back the way the Aven Peer reads one.
fn statement(v: &Value) -> Value {
    let mut v = v.clone();
    let a = assertion(&v["assertion"]);
    v["assertion"] = json!({
        "clientData": String::from_utf8(a.client_data).unwrap(),
        "authData": common::hex(&a.authenticator_data),
        "signature": common::hex(&a.signature),
    });
    v
}

#[test]
fn traces_answer_as_the_model_does() {
    let all = vectors("claims.json");
    assert!(all.len() >= 50, "{} traces", all.len());
    for v in &all {
        let s = &v["input"]["server"];
        let text = |k: &str| s[k].as_str().unwrap();
        let rp = Relying {
            rp_id: text("rpId").into(),
            origins: common::origins(&s["origins"]),
        };
        let guardian = s["guardian"].as_str().map(str::to_string);
        // the box's MaiaCityGuardian is a test key from the cast's rule; the model derived its public half too
        if let Some(g) = &guardian {
            assert_eq!(
                *g,
                aven_id::public_hex(&aven_id::test_signer(aven_id::GUARDIAN).verifying_key())
            );
        }
        let mut n = Network::new(text("network"), text("peer"), text("peerKey"), rp, guardian)
            .with_coop(text("coop"), text("coopName"));
        let ops = v["input"]["ops"].as_array().unwrap();
        for (at, (op, want)) in ops
            .iter()
            .zip(v["expected"].as_array().unwrap())
            .enumerate()
        {
            let from = op["from"].as_str().unwrap_or_default();
            let (answer, asked) = match op["op"].as_str().unwrap() {
                "claim" => {
                    let c = Claim::from_json(&statement(&op["claim"])).unwrap();
                    let asked = json!(challenge(&c.text()));
                    (n.submit_claim(from, c), asked)
                }
                "signIn" => {
                    let i = SignIn::from_json(&statement(&op["signIn"])).unwrap();
                    let asked = json!(challenge(&i.text()));
                    (n.submit_sign_in(from, i), asked)
                }
                // the statements as the store gives them back: through their JSON
                "restart" => {
                    let claim = n.claim().map(|c| Claim::from_json(&c.to_json()).unwrap());
                    let sign_ins = n
                        .sign_ins()
                        .iter()
                        .map(|i| SignIn::from_json(&i.to_json()).unwrap())
                        .collect();
                    (n.restore(claim, sign_ins), Value::Null)
                }
                "wipe" => (Ok(n.wipe()), Value::Null),
                other => panic!("unknown op {other}"),
            };
            let answer = match answer {
                Ok(next) => {
                    n = next;
                    json!({ "ok": true })
                }
                Err(e) => error(&e),
            };
            let got = json!({ "challenge": asked, "claimed": n.claim().is_some(), "answer": answer, "tree": tree(&n) });
            assert_eq!(&got, want, "{}, step {at}", v["name"]);
            if n.claim().is_some() {
                // a claimed tree is well formed, and avenOS reads it back as the same tree
                let t = n.tree().expect("a claimed tree is well formed");
                let back =
                    aven_id::Tree::from_cast(&t.to_cast()).expect("the tree's cast is a cast");
                assert_eq!(back.vaults(), t.vaults(), "{}, step {at}", v["name"]);
            }
        }
    }
}
