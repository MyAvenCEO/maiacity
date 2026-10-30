//! Invites, withdrawals and joins against Lean's traces (`id/spec/vectors/invites.json`, README rule 10): each step
//! sent as a browser sends it, every assertion and every one-time key's signature made for real, a restart reading the
//! members back from their statements as the Aven Peer reads its store. The answers, the challenges, every tree, the
//! invites' states and what the door says of each key are the model's.

mod common;

use aven_id::{
    Claim, ClaimError, Invite, Join, MemberError, Members, Network, Pending, Relying, SignIn,
    Withdrawal, challenge,
};
use common::{assertion, invalid, vectors};
use ed25519_dalek::Signer;
use serde_json::{Value, json};

fn claim_error(e: &ClaimError) -> Value {
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

fn error(e: &MemberError) -> Value {
    let named = |n: &str| json!({ "error": n });
    match e {
        MemberError::Claim(why) => json!({ "error": "claim", "claim": claim_error(why) }),
        MemberError::Unclaimed => named("unclaimed"),
        MemberError::WrongNetwork => named("wrongNetwork"),
        MemberError::Name => named("name"),
        MemberError::NotAdmin => named("notAdmin"),
        MemberError::Assertion(why) => json!({ "error": "assertion", "why": why.name() }),
        MemberError::KnownInvite => named("knownInvite"),
        MemberError::NoInvite => named("noInvite"),
        MemberError::Used => named("used"),
        MemberError::Withdrawn => named("withdrawn"),
        MemberError::BadInviteSignature => named("badInviteSignature"),
        MemberError::NotFromDevice => named("notFromDevice"),
        MemberError::Known => named("known"),
        MemberError::Invalid(why) => json!({ "error": "invalid", "invalid": invalid(why) }),
    }
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

fn invites(m: &Members) -> Value {
    let all: Vec<Value> = m
        .invites()
        .iter()
        .map(
            |i| json!({ "id": aven_id::invite_id(&i.key), "key": i.key, "state": m.state(&i.key) }),
        )
        .collect();
    json!(all)
}

/// The secret of a trace's one-time key, by its public half: `one-time-1` or `one-time-2`, test keys from the cast's
/// rule (`Aven.ID.InviteTrace`).
fn one_time(public: &str) -> ed25519_dalek::SigningKey {
    ["one-time-1", "one-time-2"]
        .into_iter()
        .map(aven_id::test_signer)
        .find(|k| aven_id::public_hex(&k.verifying_key()) == public)
        .unwrap_or_else(|| panic!("{public} is no trace's one-time key"))
}

/// A statement as JSON with its assertion, and a join's one-time signature, made for real: read back the way the Aven
/// Peer reads one.
fn statement(v: &Value) -> Value {
    let mut v = v.clone();
    let a = assertion(&v["assertion"]);
    v["assertion"] = json!({
        "clientData": String::from_utf8(a.client_data).unwrap(),
        "authData": common::hex(&a.authenticator_data),
        "signature": common::hex(&a.signature),
    });
    if v["signature"].is_object() {
        let s = &v["signature"];
        let signed =
            one_time(s["signer"].as_str().unwrap()).sign(s["signed"].as_str().unwrap().as_bytes());
        v["signature"] = json!(common::hex(&signed.to_bytes()));
    }
    v
}

/// What the step brings to the door, from whom, when it is a newcomer's.
fn pending(op: &Value) -> Option<(String, Pending)> {
    let from = op["from"].as_str()?.to_string();
    let p = match op["op"].as_str().unwrap() {
        "claim" => Pending::Claim(Claim::from_json(&statement(&op["claim"])).unwrap()),
        "signIn" => Pending::SignIn(SignIn::from_json(&statement(&op["signIn"])).unwrap()),
        "join" => Pending::Join(Join::from_json(&statement(&op["join"])).unwrap()),
        _ => return None,
    };
    Some((from, p))
}

#[test]
fn traces_answer_as_the_model_does() {
    let all = vectors("invites.json");
    assert!(all.len() >= 50, "{} traces", all.len());
    let mut steps = 0;
    for v in &all {
        let s = &v["input"]["server"];
        let text = |k: &str| s[k].as_str().unwrap();
        let rp = Relying {
            rp_id: text("rpId").into(),
            origins: common::origins(&s["origins"]),
        };
        let guardian = s["guardian"].as_str().map(str::to_string);
        let door: Vec<&str> = v["input"]["doorKeys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| k.as_str().unwrap())
            .collect();
        let mut m = Members::new(
            Network::new(text("network"), text("peer"), text("peerKey"), rp, guardian)
                .with_coop(text("coop"), text("coopName")),
        );
        let ops = v["input"]["ops"].as_array().unwrap();
        let wants = v["expected"].as_array().unwrap();
        for (at, (op, want)) in ops.iter().zip(wants).enumerate() {
            let newcomer = pending(op).map(|(from, p)| m.newcomer(&from, &p));
            let (answer, asked) = match op["op"].as_str().unwrap() {
                "invite" => {
                    let i = Invite::from_json(&statement(&op["invite"])).unwrap();
                    let asked = json!(challenge(&i.text()));
                    (m.accept_invite(i), asked)
                }
                "withdraw" => {
                    let w = Withdrawal::from_json(&statement(&op["withdraw"])).unwrap();
                    let asked = json!(challenge(&w.text()));
                    (m.accept_withdrawal(w), asked)
                }
                "claim" | "signIn" | "join" => {
                    let (from, p) = pending(op).unwrap();
                    let asked = json!(challenge(&match &p {
                        Pending::Claim(c) => c.text(),
                        Pending::SignIn(i) => i.text(),
                        Pending::Join(j) => j.text(),
                    }));
                    (m.take(&from, p), asked)
                }
                // the statements as the store gives them back: through their JSON
                "restart" => {
                    let n = m.network();
                    let back = m.restore(
                        n.claim().map(|c| Claim::from_json(&c.to_json()).unwrap()),
                        n.sign_ins()
                            .iter()
                            .map(|i| SignIn::from_json(&i.to_json()).unwrap())
                            .collect(),
                        m.invites()
                            .iter()
                            .map(|i| Invite::from_json(&i.to_json()).unwrap())
                            .collect(),
                        m.withdrawn()
                            .iter()
                            .map(|w| Withdrawal::from_json(&w.to_json()).unwrap())
                            .collect(),
                        m.joins()
                            .iter()
                            .map(|j| Join::from_json(&j.to_json()).unwrap())
                            .collect(),
                    );
                    (back, Value::Null)
                }
                "wipe" => (Ok(m.wipe()), Value::Null),
                other => panic!("unknown op {other}"),
            };
            let answer = match answer {
                Ok(next) => {
                    m = next;
                    json!({ "ok": true })
                }
                Err(e) => error(&e),
            };
            let got = json!({
                "challenge": asked,
                "newcomer": newcomer,
                "answer": answer,
                "tree": tree(&m),
                "members": m.members(),
                "invites": invites(&m),
                "door": door.iter().map(|k| m.admits(k)).collect::<Vec<_>>(),
            });
            assert_eq!(&got, want, "{}, step {at}", v["name"]);
            // what the Aven Peer tells its members reads back, every statement checked again, as the same members
            // behind the same door, in the order a store lists them
            let back = Members::from_statements(&m.statements()).unwrap();
            let sorted = |mut v: Vec<String>| {
                v.sort();
                v
            };
            assert_eq!(
                sorted(back.members()),
                sorted(m.members()),
                "{}, step {at}",
                v["name"]
            );
            assert_eq!(
                sorted(back.admitted()),
                sorted(m.admitted()),
                "{}, step {at}",
                v["name"]
            );
            steps += 1;
        }
    }
    assert!(steps >= 400, "{steps} steps");
}

/// The page's helpers: a one-time key's public half from the link's secret, and its signature over a join's text,
/// which the join's check takes.
#[test]
fn a_link_signs_its_join() {
    let secret = common::hex(aven_id::test_signer("one-time-1").as_bytes());
    let public = aven_id::one_time_public(&secret).unwrap();
    assert_eq!(
        public,
        aven_id::public_hex(&aven_id::test_signer("one-time-1").verifying_key())
    );
    let text = aven_id::join_text(
        "aven",
        &public,
        "person-b",
        "Bea",
        "passkey-b",
        "3059",
        "device-4",
        "ab",
    );
    let signature = aven_id::sign_join(&secret, &text).unwrap();
    let join = Join::from_json(&json!({
        "network": "aven", "invite": public, "person": "person-b", "name": "Bea", "passkey": { "id": "passkey-b", "spki": "3059" },
        "device": { "id": "device-4", "key": "ab" }, "signature": signature,
        "assertion": { "clientData": "{}", "authData": "", "signature": "" },
    }))
    .unwrap();
    assert!(join.signed_by_invite());
    assert!(aven_id::one_time_public("nope").is_none());
}
