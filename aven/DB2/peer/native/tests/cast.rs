//! The box's cast (SANDBOX.md, "Vaults own vaults"): every device key's Ed25519 seed is
//! `sha256("avenSANDBOX test signer: <id>")`, and its public half is `keys[<id>]` in `sandbox/cast.json`. The binary
//! never reads the cast; `sandbox/up.mjs` derives the same seeds and hands them in, and this holds the derivation.

use aven_peer::keys;
use sha2::{Digest, Sha256};

#[test]
fn every_cast_key_is_its_test_signer() {
    let cast: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../sandbox/cast.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let cast_keys = cast["keys"].as_object().unwrap();
    assert_eq!(cast_keys.len(), 6);
    for (id, public) in cast_keys {
        let seed: String = Sha256::digest(format!("avenSANDBOX test signer: {id}"))
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        assert_eq!(
            keys::secret(&seed).unwrap().public(),
            keys::public(public.as_str().unwrap()).unwrap(),
            "{id}"
        );
    }
    for peer in cast["peers"].as_object().unwrap().keys() {
        assert!(cast_keys.contains_key(peer), "{peer} has a key");
    }
}
