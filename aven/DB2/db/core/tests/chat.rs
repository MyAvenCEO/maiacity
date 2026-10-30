//! The chat against Lean's traces (`db/spec/vectors/chat.json`, README rule 10): messages arriving in a room and the
//! clock moving on; after each step the answer, the body the sender signs, who is present and the lines said are the
//! model's. The signature is the model's too, taken as sound: it verifies for exactly the key and the bytes it names.
//! Ed25519 itself is mechanics, checked at the peers' edge with iroh's keys.

use std::path::PathBuf;

use aven_db_core::chat::{Kind, Message, Room};
use serde_json::{Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A signature as the model knows one: the key that made it and the bytes it signed.
fn signature(signer: &str, signed: &str) -> String {
    format!("{signer}\n{signed}")
}

fn message(m: &Value) -> Message {
    let text = |k: &str| m[k].as_str().unwrap().to_string();
    let kind = [Kind::Here, Kind::Say, Kind::Bye]
        .into_iter()
        .find(|k| k.name() == m["kind"])
        .unwrap();
    Message {
        network: text("network"),
        from: text("from"),
        at: m["at"].as_u64().unwrap(),
        kind,
        text: text("text"),
        sig: signature(&text("signer"), &text("signed")),
    }
}

#[test]
fn rooms_follow_the_vectors() {
    let all = vectors("chat.json");
    assert!(all.len() >= 60, "{} traces", all.len());
    for v in all {
        let network = v["input"]["network"].as_str().unwrap();
        let members: Vec<&str> = v["input"]["members"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m.as_str().unwrap())
            .collect();
        let mut room = Room::default();
        let steps = v["input"]["steps"].as_array().unwrap();
        for (at, (step, want)) in steps
            .iter()
            .zip(v["expected"].as_array().unwrap())
            .enumerate()
        {
            let now = step["now"].as_u64().unwrap();
            let (answer, body) = match step.get("message") {
                Some(m) => {
                    let m = message(m);
                    let answer = room.receive(
                        network,
                        |k| members.contains(&k),
                        |key, body, sig| sig == signature(key, body),
                        now,
                        &m,
                    );
                    (answer, json!(m.body()))
                }
                None => (Ok(()), Value::Null),
            };
            let answer = match answer {
                Ok(()) => json!({ "ok": true }),
                Err(why) => json!({ "error": why.name() }),
            };
            let said: Vec<Value> = room
                .said()
                .iter()
                .map(|(who, text)| json!([who, text]))
                .collect();
            let got = json!({ "answer": answer, "body": body, "present": room.present(now), "said": said });
            assert_eq!(&got, want, "{}, step {at}", v["name"]);
        }
    }
}

/// A message as it travels: one JSON object, which reads back as the same message.
#[test]
fn a_message_travels_as_json() {
    let m = Message {
        network: "aven".into(),
        from: "ab".into(),
        at: 7,
        kind: Kind::Say,
        text: "hi".into(),
        sig: "00".into(),
    };
    let wire = serde_json::to_string(&m).unwrap();
    assert_eq!(serde_json::from_str::<Message>(&wire).unwrap(), m);
    assert!(wire.contains("\"kind\":\"say\""));
}
