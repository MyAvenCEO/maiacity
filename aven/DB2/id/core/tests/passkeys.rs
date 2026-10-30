//! WebAuthn assertions against Lean's vectors (`id/spec/vectors/passkeys.json`, README rule 10): the test passkeys'
//! public keys, the challenges of statements' texts, and every check broken once, each assertion signed for real with
//! its passkey's P-256 key. This file writes no expected value of its own.

mod common;

use aven_id::{Passkey, Relying, challenge};
use common::{assertion, hex, test_passkey, vectors};
use p256::pkcs8::EncodePublicKey;
use serde_json::json;

#[test]
fn passkeys_answer_as_the_model_does() {
    let all = vectors("passkeys.json");
    assert!(all.len() >= 20, "{} passkey vectors", all.len());
    for v in &all {
        let i = &v["input"];
        let got = if let Some(id) = i["id"].as_str() {
            let key = test_passkey(id);
            let spki = key.verifying_key().to_public_key_der().unwrap();
            json!({ "scalar": hex(&key.to_bytes()), "spki": hex(spki.as_bytes()) })
        } else if let Some(text) = i["text"].as_str() {
            json!(challenge(text))
        } else {
            let rp = Relying {
                rp_id: i["rpId"].as_str().unwrap().into(),
                origins: common::origins(&i["origins"]),
            };
            let key = test_passkey(i["key"].as_str().unwrap());
            let spki = hex(key.verifying_key().to_public_key_der().unwrap().as_bytes());
            let key = Passkey::from_spki_hex(&spki).expect("a passkey's SPKI");
            match assertion(&i["assertion"]).check(&rp, i["challenge"].as_str().unwrap(), &key) {
                Ok(()) => json!({ "holds": true }),
                Err(why) => json!({ "error": why.name() }),
            }
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}
