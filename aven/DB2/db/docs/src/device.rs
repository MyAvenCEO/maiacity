//! A device as a writer: its Ed25519 key signs single envelopes, and its hybrid key (Ed25519 and ML-DSA-65) signs the
//! segments that close them (caps, "Signatures"; docs, "Closing a segment"). Both halves come from the same seeds, so
//! the segment's Ed25519 half is the key every envelope it covers names as its signer.

use aven_core::Verify;
use aven_id::{HybridKey, HybridPublic, Secret};
use ed25519_dalek::Signer as _;

/// A device's keys, made in its safe runtime. Its seeds are wiped when it drops.
pub struct Device {
    ed25519: ed25519_dalek::SigningKey,
    hybrid: HybridKey,
}

impl Device {
    /// The device whose Ed25519 seed and ML-DSA-65 ξ are these.
    pub fn from_seeds(ed25519: &Secret, ml_dsa: &Secret) -> Device {
        Device {
            ed25519: ed25519_dalek::SigningKey::from_bytes(ed25519.expose()),
            hybrid: HybridKey::from_seeds(ed25519, ml_dsa),
        }
    }

    /// Its Ed25519 public key: an envelope's `signer`, and the device in its writer id.
    pub fn public(&self) -> [u8; 32] {
        self.ed25519.verifying_key().to_bytes()
    }

    pub fn hybrid_public(&self) -> HybridPublic {
        self.hybrid.public()
    }

    /// Signs a Core envelope as this device: its signer becomes this device's key, its signature is over exactly what
    /// it signs. A [`crate::Doc`]'s commit signs this way; it is public so a test or a tool can build an envelope by
    /// hand, which every reader still checks in full.
    pub fn sign_envelope(&self, e: &mut aven_core::Envelope) {
        e.signer = self.public().to_vec();
        e.sig = self.sign(&e.signing()).to_vec();
    }

    pub(crate) fn sign(&self, msg: &[u8]) -> [u8; 64] {
        self.ed25519.sign(msg).to_bytes()
    }

    pub(crate) fn hybrid(&self) -> &HybridKey {
        &self.hybrid
    }
}

impl std::fmt::Debug for Device {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Device(..)")
    }
}

/// Ed25519, strict, as aven-core's [`Verify`]: what a single envelope is signed with.
#[derive(Clone, Copy, Debug, Default)]
pub struct Ed25519;

impl Verify for Ed25519 {
    fn verify(&self, key: &[u8], msg: &[u8], sig: &[u8]) -> bool {
        let (Ok(key), Ok(sig)) = (<[u8; 32]>::try_from(key), <[u8; 64]>::try_from(sig)) else {
            return false;
        };
        ed25519_dalek::VerifyingKey::from_bytes(&key).is_ok_and(|k| {
            k.verify_strict(msg, &ed25519_dalek::Signature::from_bytes(&sig))
                .is_ok()
        })
    }
}
