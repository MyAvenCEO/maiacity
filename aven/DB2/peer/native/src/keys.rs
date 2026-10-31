//! Keys and members, as configuration: a peer is given its secret seed, the key of the Aven Peer it links to and,
//! optionally, the members it knows by name. Nothing here knows where it runs; the box hands the cast's test keys in
//! like any other configuration (`sandbox/up.mjs`).

use std::collections::BTreeMap;

use iroh::{PublicKey, SecretKey};

fn bytes(hex: &str) -> Result<[u8; 32], String> {
    let hex = hex.trim();
    if hex.len() != 64 {
        return Err(format!("a key is 64 hex digits, not {}", hex.len()));
    }
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// An Ed25519 secret from its 32-byte seed in hex.
pub fn secret(hex: &str) -> Result<SecretKey, String> {
    Ok(SecretKey::from_bytes(&bytes(hex)?))
}

/// The device's hybrid public half, for its vault owner's hybrid signature to bind (`device_hybrid_bound`); nothing
/// trusts it before. Ed25519 from the seed, ML-DSA-65 derived from it (`avenID device ml-dsa 1`, A43), in this process.
pub fn hybrid_public(secret: &SecretKey) -> aven_id::HybridPublic {
    let mut seed = secret.to_bytes();
    aven_id::HybridKey::from_device_seed(&aven_id::Secret::take(&mut seed)).public()
}

/// The device's seal key's public half (X-Wing, derived from its seed: `avenID device seal 1`, A43), which its
/// vault's keyring is sealed to.
pub fn seal_public(secret: &SecretKey) -> aven_id::SealPublic {
    let mut seed = secret.to_bytes();
    aven_id::device_seal_key(&aven_id::Secret::take(&mut seed)).public()
}

/// A public key in hex.
pub fn public(hex: &str) -> Result<PublicKey, String> {
    PublicKey::from_bytes(&bytes(hex)?).map_err(|e| e.to_string())
}

/// The members a peer knows by name: `name=key,name=key`.
#[derive(Clone, Debug, Default)]
pub struct Members(BTreeMap<String, PublicKey>);

impl Members {
    pub fn parse(list: &str) -> Result<Self, String> {
        let mut out = BTreeMap::new();
        for entry in list.split(',').map(str::trim).filter(|e| !e.is_empty()) {
            let (name, key) = entry
                .split_once('=')
                .ok_or_else(|| format!("{entry} is not name=key"))?;
            out.insert(name.to_string(), public(key)?);
        }
        Ok(Members(out))
    }

    /// The name a key goes by: the member's, or the start of the key for one not listed.
    pub fn name(&self, key: &PublicKey) -> String {
        self.0
            .iter()
            .find(|(_, k)| *k == key)
            .map(|(name, _)| name.clone())
            .unwrap_or_else(|| key.fmt_short().to_string())
    }

    /// Every member's key and name.
    pub fn keys(&self) -> impl Iterator<Item = (PublicKey, String)> + '_ {
        self.0.iter().map(|(name, key)| (*key, name.clone()))
    }

    pub fn knows(&self, key: &PublicKey) -> bool {
        self.0.values().any(|k| k == key)
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn members_by_name() {
        let key = SecretKey::from_bytes(&[7; 32]).public();
        let members = Members::parse(&format!("seven={}", hex(key.as_bytes()))).unwrap();
        assert_eq!(members.name(&key), "seven");
        assert!(members.knows(&key));
        assert!(Members::parse("nokey").is_err());
    }

    /// The Peer's hybrid public half is its own Ed25519 key beside the ML-DSA-65 key aven-id derives from its seed, as a
    /// Peer-Light's is (`device_ml_dsa_seed`, held to Lean's vectors there).
    #[test]
    fn hybrid_public_is_the_device_seeds() {
        let secret = SecretKey::from_bytes(&[7; 32]);
        let public = hybrid_public(&secret);
        assert_eq!(public.ed25519, *secret.public().as_bytes());
        let seed = aven_id::Secret::take(&mut [7; 32]);
        let ml = aven_id::device_ml_dsa_seed(&seed);
        assert_eq!(public, aven_id::HybridKey::from_seeds(&seed, &ml).public());
        let signature = aven_id::HybridKey::from_device_seed(&seed).sign(b"a segment");
        assert!(public.verify(b"a segment", &signature));
    }

    fn hex(b: &[u8]) -> String {
        b.iter().map(|x| format!("{x:02x}")).collect()
    }
}
