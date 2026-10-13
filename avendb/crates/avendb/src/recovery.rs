//! The master recovery key (Samuel, 2026-10-13): while avenDB is bootstrapped, one key that every human vault adds as
//! an owner, for emergencies, and removes like any other owner once it is no longer wanted. It is a signer like any
//! other: a passkey kept in software (`sign::Passkey`), all of whose keys derive from 32 secret bytes. Its P-256 and
//! SLH-DSA keys sign, and its seal key, X-Wing and Classic McEliece, is what a vault seals its keys to, as to any
//! owner. Through its human vaults it owns the coop and aven vaults they own.
//!
//! Its person makes it on a machine of their own (`src/bin/master-key.rs`) and keeps the secret offline. What every
//! vault needs of it is its public half, `RecoveryKey`: a megabyte, nearly all of it the McEliece key.

use std::sync::Arc;

use crate::encode::Encode;
use crate::id::{BlobId, SignerId};
use crate::keys::{MCELIECE_PUBLIC_BYTES, PublicKey};
use crate::sign::{Passkey, SignerKeys};
use crate::wire::Wire;

/// How a master recovery key's public half starts, as its file holds it: what it is, and the format's version.
const MAGIC: &[u8] = b"avenDB master recovery key 1\n";

/// The public half of a master recovery key: the signer a vault adds as an owner, and what it seals its keys to.
#[derive(Clone, PartialEq, Eq)]
pub struct RecoveryKey {
    /// Its P-256 and SLH-DSA keys, a passkey's.
    pub keys: SignerKeys,
    /// The key a vault seals its keys to: X-Wing, and the McEliece key's id.
    pub seal: PublicKey,
    /// The Classic McEliece public key that `seal` names, which travels beside the edit that adds the key to a vault.
    pub mceliece: Arc<[u8]>,
}

/// The id alone, as the key is a megabyte.
impl std::fmt::Debug for RecoveryKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "RecoveryKey({})", self.id().to_hex())
    }
}

impl RecoveryKey {
    /// The public half of the master recovery key whose secret is `secret`: the keys of the passkey it is
    /// (`Passkey::from_seed`), the same a Lab takes it in as (`Lab::passkey_from`). Makes its McEliece pair, which
    /// takes about a second.
    pub fn of(secret: [u8; 32]) -> RecoveryKey {
        let passkey = Passkey::from_seed(secret);
        let seal = passkey.seal_secret();
        RecoveryKey { keys: passkey.keys(), seal: seal.public(), mceliece: seal.mceliece_public() }
    }

    /// The signer it is.
    pub fn id(&self) -> SignerId {
        self.keys.id()
    }

    /// The bytes of its file: `MAGIC`, then its keys as the wire has them.
    pub fn to_bytes(&self) -> Vec<u8> {
        [MAGIC, &self.to_wire()].concat()
    }

    /// The key a file holds: `None` unless its bytes are one whole, a passkey's keys, an X-Wing key, and the McEliece
    /// key the seal names.
    pub fn from_bytes(bytes: &[u8]) -> Option<RecoveryKey> {
        let key = RecoveryKey::from_wire(bytes.strip_prefix(MAGIC)?).ok()?;
        let passkey = matches!(key.keys, SignerKeys::Passkey { .. });
        let mceliece = key.mceliece.len() == MCELIECE_PUBLIC_BYTES && BlobId::of(&key.mceliece) == key.seal.mceliece;
        (passkey && mceliece && key.seal.xwing.len() == XWING_PUBLIC_BYTES).then_some(key)
    }
}

/// An X-Wing public key's size: ML-KEM-768's 1,184 bytes and X25519's 32.
pub const XWING_PUBLIC_BYTES: usize = 1216;

impl Encode for RecoveryKey {
    fn encode(&self, out: &mut Vec<u8>) {
        self.keys.encode(out);
        self.seal.encode(out);
        (self.mceliece.len() as u32).encode(out);
        out.extend_from_slice(&self.mceliece);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lab::Lab;

    #[test]
    fn a_recovery_key_reads_back_from_its_bytes_alone() {
        let key = RecoveryKey::of([7; 32]);
        assert_eq!(key.seal.xwing.len(), XWING_PUBLIC_BYTES);
        let bytes = key.to_bytes();
        assert_eq!(RecoveryKey::from_bytes(&bytes), Some(key.clone()), "its file holds it whole");
        assert_eq!(RecoveryKey::of([7; 32]), key, "and the same secret makes it again");
        assert_ne!(RecoveryKey::of([8; 32]).id(), key.id(), "another secret another key");
        // cut short, with bytes after it, of another format, or holding a McEliece key its seal doesn't name
        assert!(RecoveryKey::from_bytes(&bytes[..bytes.len() - 1]).is_none());
        assert!(RecoveryKey::from_bytes(&[&bytes[..], &[0]].concat()).is_none());
        assert!(RecoveryKey::from_bytes(&bytes[1..]).is_none());
        let mut other = bytes.clone();
        *other.last_mut().expect("a byte") ^= 1;
        assert!(RecoveryKey::from_bytes(&other).is_none(), "a McEliece key that isn't the one its seal names");
    }

    #[test]
    fn a_recovery_key_is_the_passkey_its_secret_makes() {
        let key = RecoveryKey::of([7; 32]);
        let mut lab = Lab::with_entropy([1; 32]);
        let passkey = lab.passkey_from("the master recovery", [7; 32]);
        assert_eq!(passkey, key.id(), "the Lab that holds its secret signs as it");
    }
}
