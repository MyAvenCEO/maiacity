//! The cast's keys: mechanics outside the model, which knows keys only by id (`Aven.ID.Sign`). Each public half in
//! `sandbox/cast.json` is its seed's, and the cast refuses a key that isn't an Ed25519 public key. What statements
//! signed with these keys mean is Lean's (`tests/vectors.rs`).

use aven_id::{CastError, Tree, public_hex, test_signer};

const CAST: &str = include_str!("../../../sandbox/cast.json");

#[test]
fn every_public_half_is_the_seeds() {
    let t = Tree::from_cast(CAST).unwrap();
    for (id, public) in t.keys() {
        assert_eq!(public_hex(&test_signer(id).verifying_key()), public, "{id}");
    }
    // the derivation itself, sha256("avenSANDBOX test signer: <id>") as the Ed25519 seed, so a change to it can't
    // pass by changing the cast with it: Ed25519 is mechanics, which the model doesn't run
    assert_eq!(
        public_hex(&test_signer("alice-peer-light").verifying_key()).get(..8),
        Some("9f78814b")
    );
}

#[test]
fn a_cast_key_must_be_an_ed25519_key() {
    assert!(matches!(
        Tree::from_cast(
            r#"{"keys":{"k":"00"},"vaults":{"a":{"kind":"person","owners":["key:k"]}}}"#
        ),
        Err(CastError::Format(_))
    ));
}
