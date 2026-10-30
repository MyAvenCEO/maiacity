//! The cast's test keys. Each Ed25519 seed is `sha256("avenSANDBOX test signer: <id>")`: public on purpose and
//! valid only inside the box (SANDBOX.md, "Vaults own vaults").

use ed25519_dalek::{SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

/// The box's test signer for a key id, such as `alice-owner` or `aven-peer`. Never a real key.
pub fn test_signer(id: &str) -> SigningKey {
    let seed: [u8; 32] = Sha256::digest(format!("avenSANDBOX test signer: {id}")).into();
    SigningKey::from_bytes(&seed)
}

/// A public half in hex, as the cast writes it.
pub fn public_hex(key: &VerifyingKey) -> String {
    key.as_bytes().iter().map(|b| format!("{b:02x}")).collect()
}

pub(crate) fn parse_public(hex: &str) -> Option<VerifyingKey> {
    if hex.len() != 64 || !hex.is_ascii() {
        return None;
    }
    let mut bytes = [0u8; 32];
    for (at, byte) in bytes.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[2 * at..2 * at + 2], 16).ok()?;
    }
    VerifyingKey::from_bytes(&bytes).ok()
}

/// A key's public half as a tree writes it: Ed25519 in hex, or a passkey's `es256:<SPKI in hex>`.
pub(crate) fn valid_public(public: &str) -> bool {
    match public.strip_prefix("es256:") {
        Some(spki) => crate::passkey::Passkey::from_spki_hex(spki).is_some(),
        None => parse_public(public).is_some(),
    }
}
