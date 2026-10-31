//! Hybrid signatures (`Aven.Core.Hybrid`; A2, D10): Ed25519 and ML-DSA-65 over the same bytes, ML-DSA-65's context
//! empty, and a signature holds only when both halves verify. A key and a signature are each a Value with its suite
//! and its two halves, so they travel as the signer and signature bytes of any signed thing ([`hybrid_verify`]).
//!
//! An owner key comes from a passkey's PRF ([`crate::PrfOutput::owner_key`]). A device's comes from its own Ed25519
//! seed ([`HybridKey::from_device_seed`]), never from a passkey (D11): the seed is the Ed25519 half's, and the
//! ML-DSA-65 ξ is `derive_key("avenID device ml-dsa 1", seed)` (A43, 31 Oct 2026), derived in the device's own process
//! and wiped after use. The seed is never exported, and nothing else is derived from it; outside this derivation only
//! Ed25519's scalar signs. A quantum attacker recovers that clamped scalar from the public key, never the seed it was
//! hashed from (RFC 8032), so the ML-DSA half stays out of reach. Both halves rotate together, with the device key
//! (D19). Nothing trusts a device's ML-DSA half until its vault owner's hybrid signature binds it.

use aven_core::{Value, decode, encode};
use ed25519_dalek::Signer as _;
use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65};

use crate::secret::{Entropy, Secret};
use crate::value::{bytes, fields};

/// The label of a device's ML-DSA-65 ξ, from its Ed25519 seed (`Aven.ID.KeyFormats.deviceMlDsaLabel`).
pub const DEVICE_ML_DSA_LABEL: &str = "avenID device ml-dsa 1";

/// The hybrid suite (`Aven.Core.hybridSuite`).
pub const HYBRID_SUITE: u64 = 1;
pub const ED25519_KEY_LEN: usize = 32;
pub const ED25519_SIG_LEN: usize = 64;
pub const ML_DSA_KEY_LEN: usize = 1952;
pub const ML_DSA_SIG_LEN: usize = 3309;

/// A device's ML-DSA-65 ξ, from its Ed25519 seed (`Aven.ID.KeyFormats.deviceMlDsaSeed`).
pub fn device_ml_dsa_seed(ed25519: &Secret) -> Secret {
    Secret::take(&mut blake3::derive_key(
        DEVICE_ML_DSA_LABEL,
        ed25519.expose(),
    ))
}

/// A hybrid signing key. Both halves' seeds are wiped when it drops. ML-DSA-65's expanded key is tens of KB, so it
/// lives on the heap: a wasm worker's stack is small, and a debug build copies what it moves.
pub struct HybridKey {
    ed25519: ed25519_dalek::SigningKey,
    ml_dsa: Box<ml_dsa::SigningKey<MlDsa65>>,
}

impl HybridKey {
    /// The key whose Ed25519 seed and ML-DSA-65 ξ are these.
    pub fn from_seeds(ed25519: &Secret, ml_dsa: &Secret) -> HybridKey {
        HybridKey {
            ed25519: ed25519_dalek::SigningKey::from_bytes(ed25519.expose()),
            ml_dsa: Box::new(ml_dsa::SigningKey::from_seed(ml_dsa.expose().into())),
        }
    }

    /// A device's hybrid key, from its own Ed25519 seed: the seed itself, and the ML-DSA-65 ξ derived from it.
    pub fn from_device_seed(ed25519: &Secret) -> HybridKey {
        HybridKey::from_seeds(ed25519, &device_ml_dsa_seed(ed25519))
    }

    /// A fresh key, for tests and for anything that has no device seed: both halves random.
    pub fn generate(entropy: &mut impl Entropy) -> HybridKey {
        HybridKey::from_seeds(&Secret::generate(entropy), &Secret::generate(entropy))
    }

    pub fn public(&self) -> HybridPublic {
        let mut ml_dsa = [0u8; ML_DSA_KEY_LEN];
        ml_dsa.copy_from_slice(&self.ml_dsa.expanded_key().verifying_key().encode());
        HybridPublic {
            ed25519: self.ed25519.verifying_key().to_bytes(),
            ml_dsa,
        }
    }

    /// Both halves over `msg`, ML-DSA-65 deterministic with an empty context.
    pub fn sign(&self, msg: &[u8]) -> HybridSignature {
        let ml = self
            .ml_dsa
            .expanded_key()
            .sign_deterministic(msg, &[])
            .expect("an empty context is short enough");
        let mut ml_dsa = [0u8; ML_DSA_SIG_LEN];
        ml_dsa.copy_from_slice(&ml.encode());
        HybridSignature {
            ed25519: self.ed25519.sign(msg).to_bytes(),
            ml_dsa,
        }
    }
}

impl std::fmt::Debug for HybridKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("HybridKey(..)")
    }
}

/// A hybrid key's public halves.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct HybridPublic {
    pub ed25519: [u8; ED25519_KEY_LEN],
    pub ml_dsa: [u8; ML_DSA_KEY_LEN],
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct HybridSignature {
    pub ed25519: [u8; ED25519_SIG_LEN],
    pub ml_dsa: [u8; ML_DSA_SIG_LEN],
}

fn hybrid_value(ed25519: &[u8], ml_dsa: &[u8]) -> Value {
    Value::Map(vec![
        ("mlDsa".into(), bytes(ml_dsa)),
        ("suite".into(), Value::Uint(HYBRID_SUITE)),
        ("ed25519".into(), bytes(ed25519)),
    ])
}

/// Exactly the suite and two halves of the given lengths (`Aven.Core.Hybrid.ofValue?`).
fn halves<const E: usize, const M: usize>(v: &Value) -> Option<([u8; E], [u8; M])> {
    let f = fields(v, &["mlDsa", "suite", "ed25519"], &[])?;
    if f.uint("suite")? != HYBRID_SUITE {
        return None;
    }
    Some((f.array("ed25519")?, f.array("mlDsa")?))
}

impl HybridPublic {
    pub fn value(&self) -> Value {
        hybrid_value(&self.ed25519, &self.ml_dsa)
    }

    pub fn of_value(v: &Value) -> Option<HybridPublic> {
        let (ed25519, ml_dsa) = halves(v)?;
        Some(HybridPublic { ed25519, ml_dsa })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        encode(&self.value())
    }

    /// Holds only when both halves verify `msg`.
    pub fn verify(&self, msg: &[u8], signature: &HybridSignature) -> bool {
        let classical = ed25519_dalek::VerifyingKey::from_bytes(&self.ed25519).is_ok_and(|key| {
            // strict: no small-order key or non-canonical signature, which an all-zero key and signature would be
            key.verify_strict(
                msg,
                &ed25519_dalek::Signature::from_bytes(&signature.ed25519),
            )
            .is_ok()
        });
        let quantum = match (
            EncodedVerifyingKey::<MlDsa65>::try_from(self.ml_dsa.as_slice()),
            EncodedSignature::<MlDsa65>::try_from(signature.ml_dsa.as_slice()),
        ) {
            (Ok(key), Ok(sig)) => ml_dsa::Signature::<MlDsa65>::decode(&sig).is_some_and(|sig| {
                ml_dsa::VerifyingKey::<MlDsa65>::decode(&key).verify_with_context(msg, &[], &sig)
            }),
            _ => false,
        };
        classical & quantum
    }
}

impl HybridSignature {
    pub fn value(&self) -> Value {
        hybrid_value(&self.ed25519, &self.ml_dsa)
    }

    pub fn of_value(v: &Value) -> Option<HybridSignature> {
        let (ed25519, ml_dsa) = halves(v)?;
        Some(HybridSignature { ed25519, ml_dsa })
    }

    pub fn to_bytes(&self) -> Vec<u8> {
        encode(&self.value())
    }
}

/// The hybrid scheme as a signature check (`Aven.Core.hybridVerify`): `key` and `sig` are the encodings of a hybrid
/// key and signature, and both halves verify `msg`.
pub fn hybrid_verify(key: &[u8], msg: &[u8], sig: &[u8]) -> bool {
    let key = decode(key).and_then(|v| HybridPublic::of_value(&v));
    let sig = decode(sig).and_then(|v| HybridSignature::of_value(&v));
    match (key, sig) {
        (Some(key), Some(sig)) => key.verify(msg, &sig),
        _ => false,
    }
}

/// The hybrid scheme as aven-core's [`Verify`](aven_core::Verify), for any `Signed` thing whose signer and signature
/// are hybrid: `signed.valid(&Hybrid)` holds only when both halves verify its signing bytes (`Signed.hybrid_valid`).
#[derive(Clone, Copy, Debug, Default)]
pub struct Hybrid;

impl aven_core::Verify for Hybrid {
    fn verify(&self, key: &[u8], msg: &[u8], sig: &[u8]) -> bool {
        hybrid_verify(key, msg, sig)
    }
}

impl HybridKey {
    /// `[label, body]` signed as Core signs it, the key's and the signature's Values as their bytes.
    pub fn sign_value(&self, label: &str, body: Value) -> aven_core::Signed {
        let msg = aven_core::signing_bytes(label, &body);
        aven_core::Signed {
            label: label.into(),
            body,
            signer: self.public().to_bytes(),
            sig: self.sign(&msg).to_bytes(),
        }
    }
}
