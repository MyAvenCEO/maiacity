//! The passkey's PRF step (id/caps/README.md, "Passkeys and the PRF step"; D10, D11). The WebAuthn PRF extension gives
//! 32 bytes only the authenticator can make. From them come the passkey's **hybrid owner key** (Ed25519 + ML-DSA-65)
//! and its **seal key** (X-Wing), which the keyring is sealed to, so a new browser opens its vault with the passkey
//! alone. Nothing derived is stored (A42): a ceremony derives it again. Device keys never come from here (D11).

use ed25519_dalek::{Signer as _, Verifier as _};
use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::seal::SealKey;
use crate::secret::Secret;

/// The PRF input's domain.
pub const PRF_DOMAIN: &str = "avenID prf 1";
/// The label of the owner key's seeds.
pub const OWNER_LABEL: &str = "avenID owner 1";
/// The label of the seal key's seed.
pub const SEAL_LABEL: &str = "avenID seal 1";
/// What an owner key's signatures are made over, before the message.
const OWNER_SIGNED: &[u8] = b"avenID owner signature 1\0";

pub const ML_DSA_PUBLIC_LEN: usize = 1952;
pub const ML_DSA_SIGNATURE_LEN: usize = 3309;

/// The PRF input for a vault's owner at an epoch: the domain, a zero byte, the vault's id with its length, and the
/// epoch as 8 bytes, big-endian. Rotating the owner's epoch changes it and everything derived from it.
pub fn prf_input(vault: &str, epoch: u64) -> Vec<u8> {
    let mut out = PRF_DOMAIN.as_bytes().to_vec();
    out.push(0);
    crate::seal::put(&mut out, vault.as_bytes());
    out.extend_from_slice(&epoch.to_be_bytes());
    out
}

/// The salt the browser hands the authenticator for that input: `SHA-256("WebAuthn PRF" ‖ 0 ‖ input)` (WebAuthn
/// Level 3, the `prf` extension).
pub fn prf_salt(vault: &str, epoch: u64) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"WebAuthn PRF\0");
    hash.update(prf_input(vault, epoch));
    hash.finalize().into()
}

/// The 32 bytes the authenticator answered, wiped when dropped.
#[derive(Debug, PartialEq, Eq)]
pub struct PrfOutput(Secret);

impl PrfOutput {
    pub fn new(output: Secret) -> PrfOutput {
        PrfOutput(output)
    }

    /// The owner key's two seeds: BLAKE3's key derivation for `avenID owner 1`, read for 64 bytes, the first 32
    /// Ed25519's and the next 32 ML-DSA-65's ξ.
    pub fn owner_seeds(&self) -> (Secret, Secret) {
        let mut seeds = Zeroizing::new([0u8; 64]);
        let mut hasher = blake3::Hasher::new_derive_key(OWNER_LABEL);
        hasher.update(self.0.expose());
        hasher.finalize_xof().fill(seeds.as_mut());
        let mut ed = Zeroizing::new([0u8; 32]);
        let mut ml = Zeroizing::new([0u8; 32]);
        ed.copy_from_slice(&seeds[..32]);
        ml.copy_from_slice(&seeds[32..]);
        (Secret::take(&mut ed), Secret::take(&mut ml))
    }

    /// The seal key's X-Wing seed: BLAKE3's key derivation for `avenID seal 1`.
    pub fn seal_seed(&self) -> Secret {
        Secret::take(&mut blake3::derive_key(SEAL_LABEL, self.0.expose()))
    }

    pub fn owner_key(&self) -> OwnerKey {
        let (ed, ml) = self.owner_seeds();
        OwnerKey::from_seeds(&ed, &ml)
    }

    pub fn seal_key(&self) -> SealKey {
        SealKey::from_seed(&self.seal_seed())
    }
}

/// A passkey's hybrid owner key. Both halves sign, and both must verify.
pub struct OwnerKey {
    ed25519: ed25519_dalek::SigningKey,
    ml_dsa: ml_dsa::SigningKey<MlDsa65>,
}

impl OwnerKey {
    pub fn from_seeds(ed25519: &Secret, ml_dsa: &Secret) -> OwnerKey {
        OwnerKey {
            ed25519: ed25519_dalek::SigningKey::from_bytes(ed25519.expose()),
            ml_dsa: ml_dsa::SigningKey::from_seed(ml_dsa.expose().into()),
        }
    }

    pub fn public(&self) -> OwnerPublic {
        let mut ml_dsa = [0u8; ML_DSA_PUBLIC_LEN];
        ml_dsa.copy_from_slice(&self.ml_dsa.expanded_key().verifying_key().encode());
        OwnerPublic {
            ed25519: self.ed25519.verifying_key().to_bytes(),
            ml_dsa,
        }
    }

    /// Both halves over the same bytes; ML-DSA-65 deterministic, with an empty context.
    pub fn sign(&self, msg: &[u8]) -> HybridSignature {
        let signed = [OWNER_SIGNED, msg].concat();
        let ml = self
            .ml_dsa
            .expanded_key()
            .sign_deterministic(&signed, &[])
            .expect("an empty context is short enough");
        let mut ml_dsa = [0u8; ML_DSA_SIGNATURE_LEN];
        ml_dsa.copy_from_slice(&ml.encode());
        HybridSignature {
            ed25519: self.ed25519.sign(&signed).to_bytes(),
            ml_dsa,
        }
    }
}

impl std::fmt::Debug for OwnerKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("OwnerKey(..)")
    }
}

/// An owner key's public halves, as the vault's statement carries them beside the passkey's ES256 key.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct OwnerPublic {
    pub ed25519: [u8; 32],
    pub ml_dsa: [u8; ML_DSA_PUBLIC_LEN],
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct HybridSignature {
    pub ed25519: [u8; 64],
    pub ml_dsa: [u8; ML_DSA_SIGNATURE_LEN],
}

impl OwnerPublic {
    /// Holds only when both halves verify.
    pub fn verify(&self, msg: &[u8], signature: &HybridSignature) -> bool {
        let signed = [OWNER_SIGNED, msg].concat();
        let classical = ed25519_dalek::VerifyingKey::from_bytes(&self.ed25519).is_ok_and(|key| {
            key.verify(
                &signed,
                &ed25519_dalek::Signature::from_bytes(&signature.ed25519),
            )
            .is_ok()
        });
        let encoded_key = EncodedVerifyingKey::<MlDsa65>::try_from(self.ml_dsa.as_slice());
        let encoded_signature = EncodedSignature::<MlDsa65>::try_from(signature.ml_dsa.as_slice());
        let quantum = match (encoded_key, encoded_signature) {
            (Ok(key), Ok(sig)) => ml_dsa::Signature::<MlDsa65>::decode(&sig).is_some_and(|sig| {
                ml_dsa::VerifyingKey::<MlDsa65>::decode(&key).verify_with_context(
                    &signed,
                    &[],
                    &sig,
                )
            }),
            _ => false,
        };
        classical & quantum
    }
}
