//! The cast's keys (SANDBOX.md, "Vaults own vaults"). Until avenID runs, a peer reads its device key from
//! `sandbox/cast.json` directly: every Ed25519 seed is `sha256("avenSANDBOX test signer: <id>")`, public on purpose
//! and valid only inside the box.

use iroh::{PublicKey, SecretKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const CAST: &str = include_str!("../../../sandbox/cast.json");

fn cast() -> Value {
    serde_json::from_str(CAST).expect("sandbox/cast.json is JSON")
}

/// The test signer's seed for a key id of the cast.
pub fn secret(id: &str) -> SecretKey {
    let seed: [u8; 32] = Sha256::digest(format!("avenSANDBOX test signer: {id}")).into();
    SecretKey::from_bytes(&seed)
}

/// The public half the cast lists for `id`.
pub fn public(id: &str) -> Option<PublicKey> {
    cast()["keys"][id].as_str()?.parse().ok()
}

/// The peers of the cast, in its order.
pub fn peers() -> Vec<String> {
    cast()["peers"]
        .as_object()
        .map(|p| p.keys().cloned().collect())
        .unwrap_or_default()
}

/// The peer of the cast that holds `key`.
pub fn peer_of(key: &PublicKey) -> Option<String> {
    peers()
        .into_iter()
        .find(|id| public(id).as_ref() == Some(key))
}

pub const AVEN_PEER: &str = "aven-peer";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_cast_key_is_its_test_signer() {
        let keys = cast()["keys"].as_object().unwrap().clone();
        assert_eq!(keys.len(), 6);
        for id in keys.keys() {
            assert_eq!(Some(secret(id).public()), public(id), "{id}");
        }
    }

    #[test]
    fn four_peers_each_with_a_key() {
        let mut ids = peers();
        ids.sort();
        assert_eq!(
            ids,
            [
                "alice-peer",
                "alice-peer-light",
                "aven-peer",
                "bob-peer-light"
            ]
        );
        for id in peers() {
            assert_eq!(peer_of(&secret(&id).public()), Some(id));
        }
    }
}
