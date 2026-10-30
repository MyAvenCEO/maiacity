//! The cast's test keys, as the model derives them (`Aven.ID.Keys`, `id/spec/vectors/keys.json`): each seed is
//! `sha256("avenSANDBOX test signer: <id>")` and each public half its Ed25519 key, and `sandbox/cast.json` holds those.
//! What statements signed with these keys mean is Lean's too (`tests/vectors.rs`).

mod common;

use aven_id::{CastError, Tree, public_hex, test_signer};
use serde_json::{Value, json};

const CAST: &str = include_str!("../../../sandbox/cast.json");

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn every_key_is_the_models() {
    let cast: Value = serde_json::from_str(CAST).unwrap();
    let vectors = common::vectors("keys.json");
    assert_eq!(vectors.len(), cast["keys"].as_object().unwrap().len());
    for v in vectors {
        let id = v["input"]["id"].as_str().unwrap();
        let key = test_signer(id);
        let derived = json!({ "seed": hex(&key.to_bytes()), "public": public_hex(&key.verifying_key()) });
        assert_eq!(derived, v["expected"], "{id}");
        assert_eq!(cast["keys"][id], v["expected"]["public"], "the cast's {id}");
    }
    // and the tree reads each key's public half from the cast
    let t = Tree::from_cast(CAST).unwrap();
    for (id, public) in t.keys() {
        assert_eq!(public, cast["keys"][id], "{id}");
    }
}

/// Ed25519 decides which bytes are a public key: mechanics outside the model, which knows keys by id.
#[test]
fn a_cast_key_must_be_an_ed25519_key() {
    assert!(matches!(
        Tree::from_cast(r#"{"keys":{"k":"00"},"vaults":{"a":{"kind":"person","owners":["key:k"]}}}"#),
        Err(CastError::Format(_))
    ));
}
