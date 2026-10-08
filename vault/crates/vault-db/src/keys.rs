//! Keys. Each device has its own encryption key pair. Each vault, space and entry has a key pair per epoch, sealed
//! (HPKE) to whoever may open it: a human vault's key to its devices, a coop's key to its owner vaults' keys, a space
//! key to the vaults holding read on the space, an entry key to its space key and to the vaults holding read on just
//! that entry. Every edit is encrypted with XChaCha20-Poly1305 under its entry's current key, bound to the op that
//! carries it. When anyone loses access, every key they could open moves to a new epoch, and the old key is sealed to
//! the new one, so those who remain still read the history (T5, T6). Relay caps get no key at all (T7).

use crate::id::{EntryId, SpaceId, VaultId};

/// A family of keys, one per vault, space and entry; its epoch moves on at every rotation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum KeyScope {
    Vault(VaultId),
    Space(SpaceId),
    Entry(SpaceId, EntryId),
}

/// One key: a family at an epoch.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct KeyName {
    pub scope: KeyScope,
    pub epoch: u64,
}

/// A key pair's secret half. Never leaves the device unsealed.
pub struct SecretKey {
    _filled_in_p3: (),
}

/// A key pair's public half, what keys are sealed to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicKey(pub Vec<u8>);

/// A key sealed to another key's public half: only that key's holder opens it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sealed {
    pub key: KeyName,
    pub to: PublicKey,
    pub bytes: Vec<u8>,
}

impl SecretKey {
    /// A fresh key pair from the system's randomness.
    pub fn generate() -> SecretKey {
        todo!("P3: X25519 first, the X25519 + ML-KEM-768 hybrid once decided (see the plan's open questions)")
    }

    pub fn public(&self) -> PublicKey {
        todo!("P3: key pairs")
    }
}

/// Seal `key` (named `name`) to `to`.
pub fn seal(name: KeyName, key: &SecretKey, to: &PublicKey) -> Sealed {
    let _ = (name, key, to);
    todo!("P3: HPKE base mode, the key's name bound as info")
}

/// Open a sealed key with the secret it was sealed to; `None` if it wasn't sealed to that key or was changed.
pub fn open(sealed: &Sealed, with: &SecretKey) -> Option<SecretKey> {
    let _ = (sealed, with);
    todo!("P3: HPKE open")
}

/// Encrypt one edit under an entry key, bound to `context` (the op's other fields), so it can't be moved elsewhere.
pub fn encrypt(key: &SecretKey, plaintext: &[u8], context: &[u8]) -> Vec<u8> {
    let _ = (key, plaintext, context);
    todo!("P3: XChaCha20-Poly1305 with a random nonce")
}

/// Decrypt one edit; `None` for the wrong key, another context or a changed byte.
pub fn decrypt(key: &SecretKey, ciphertext: &[u8], context: &[u8]) -> Option<Vec<u8>> {
    let _ = (key, ciphertext, context);
    todo!("P3: XChaCha20-Poly1305")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(epoch: u64) -> KeyName {
        KeyName { scope: KeyScope::Entry(SpaceId::from_u64(12), EntryId::from_u64(21)), epoch }
    }

    #[test]
    #[ignore = "P3: keys"]
    fn a_sealed_key_opens_only_with_its_recipient() {
        let (key, alice, mallory) = (SecretKey::generate(), SecretKey::generate(), SecretKey::generate());
        let sealed = seal(name(0), &key, &alice.public());
        assert_eq!(open(&sealed, &alice).map(|k| k.public()), Some(key.public()));
        assert!(open(&sealed, &mallory).is_none());
        let mut changed = sealed.clone();
        changed.bytes[0] ^= 1;
        assert!(open(&changed, &alice).is_none());
    }

    #[test]
    #[ignore = "P3: keys"]
    fn an_edit_round_trips_and_fails_with_any_change() {
        let (key, other) = (SecretKey::generate(), SecretKey::generate());
        let sealed = encrypt(&key, b"# Welcome", b"op context");
        assert_eq!(decrypt(&key, &sealed, b"op context").as_deref(), Some(&b"# Welcome"[..]));
        assert!(decrypt(&other, &sealed, b"op context").is_none());
        assert!(decrypt(&key, &sealed, b"another op").is_none());
        let mut changed = sealed.clone();
        *changed.last_mut().unwrap() ^= 1;
        assert!(decrypt(&key, &changed, b"op context").is_none());
        assert!(!sealed.windows(9).any(|w| w == b"# Welcome"));
    }
}
