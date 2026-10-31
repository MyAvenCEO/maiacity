//! The passkey's PRF step (id/caps/README.md, "Passkeys and the PRF step"; D10, D11; `Aven.ID.KeyFormats`). The
//! WebAuthn PRF extension gives 32 bytes only the authenticator can make. From them come the passkey's **hybrid owner
//! key** (Ed25519 + ML-DSA-65) and its **seal key** (X-Wing), which the keyring is sealed to, so a new browser opens its
//! vault with the passkey alone. Nothing derived is stored (A42): a ceremony derives it again. Device keys never come
//! from here (D11).

use aven_core::{Value, encode};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::hybrid::HybridKey;
use crate::seal::SealKey;
use crate::secret::Secret;
use crate::value::text;

/// The PRF input's label.
pub const PRF_LABEL: &str = "avenID prf 1";
/// The label of the owner key's seeds.
pub const OWNER_LABEL: &str = "avenID owner 1";
/// The label of the seal key's seed.
pub const SEAL_LABEL: &str = "avenID seal 1";

/// The PRF input for a vault's owner at an epoch: `encode(["avenID prf 1", {epoch, vault}])`. Rotating the owner's
/// epoch changes it and everything derived from it.
pub fn prf_input(vault: &str, epoch: u64) -> Vec<u8> {
    encode(&Value::Array(vec![
        text(PRF_LABEL),
        Value::Map(vec![
            ("epoch".into(), Value::Uint(epoch)),
            ("vault".into(), text(vault)),
        ]),
    ]))
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

    /// The passkey's hybrid owner key.
    pub fn owner_key(&self) -> HybridKey {
        let (ed, ml) = self.owner_seeds();
        HybridKey::from_seeds(&ed, &ml)
    }

    pub fn seal_key(&self) -> SealKey {
        SealKey::from_seed(&self.seal_seed())
    }
}
