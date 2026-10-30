//! A passkey's WebAuthn assertion, checked (`Aven.ID.Passkey`): the client data's type, challenge and origin, the
//! authenticator data's RP ID hash and its user-present and user-verified flags, then the passkey's ES256 signature,
//! in WebAuthn's order. The passkey's public key is what the browser's `getPublicKey()` gives at its creation
//! (SubjectPublicKeyInfo, DER), so no CBOR is ever parsed.

use std::fmt;

use p256::ecdsa::signature::Verifier;
use p256::ecdsa::{Signature, VerifyingKey};
use p256::pkcs8::DecodePublicKey;
use sha2::{Digest, Sha256};

/// Whom an assertion must be for: the RP ID its passkey was made for, and the origins avenOS is served from. A list,
/// so an assertion stored when it came holds while its origin stays listed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Relying {
    pub rp_id: String,
    pub origins: Vec<String>,
}

/// An assertion as the browser gives it: `clientDataJSON`, `authenticatorData` and the DER signature.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assertion {
    pub client_data: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AssertionError {
    /// The client data isn't JSON with a type, a challenge and an origin.
    ClientData,
    /// Not `webauthn.get`.
    Type,
    Challenge,
    Origin,
    /// Made in a frame of another origin.
    CrossOrigin,
    /// The authenticator data is shorter than 37 bytes.
    AuthData,
    /// Made for another RP ID.
    RpId,
    NotPresent,
    NotVerified,
    BadSignature,
}

impl AssertionError {
    /// The model's name for it.
    pub fn name(self) -> &'static str {
        match self {
            AssertionError::ClientData => "clientData",
            AssertionError::Type => "type",
            AssertionError::Challenge => "challenge",
            AssertionError::Origin => "origin",
            AssertionError::CrossOrigin => "crossOrigin",
            AssertionError::AuthData => "authData",
            AssertionError::RpId => "rpId",
            AssertionError::NotPresent => "notPresent",
            AssertionError::NotVerified => "notVerified",
            AssertionError::BadSignature => "badSignature",
        }
    }
}

impl fmt::Display for AssertionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "the passkey's assertion fails its {} check", self.name())
    }
}

impl std::error::Error for AssertionError {}

/// A passkey's public key: ECDSA on P-256 (ES256).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Passkey(VerifyingKey);

impl Passkey {
    /// From SubjectPublicKeyInfo in hex, as `getPublicKey()` gives it.
    pub fn from_spki_hex(hex: &str) -> Option<Passkey> {
        VerifyingKey::from_public_key_der(&crate::hex::decode(hex)?)
            .ok()
            .map(Passkey)
    }
}

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// base64url without padding (RFC 4648, 5).
pub fn base64url(bytes: &[u8]) -> String {
    let mut out = String::new();
    for group in bytes.chunks(3) {
        let at = |i: usize| group.get(i).copied().unwrap_or(0) as u32;
        let x = at(0) << 16 | at(1) << 8 | at(2);
        for i in 0..=group.len() {
            out.push(BASE64URL[(x >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// The challenge a passkey signs for a statement's text: base64url of its SHA-256.
pub fn challenge(text: &str) -> String {
    base64url(&Sha256::digest(text.as_bytes()))
}

impl Assertion {
    /// The signature counter, the four bytes after the flags. Synced passkeys keep it at 0.
    pub fn counter(&self) -> u32 {
        self.authenticator_data
            .get(33..37)
            .map_or(0, |b| u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    /// The assertion holds for `rp`, the challenge and the passkey `key`, or names the first check it fails.
    pub fn check(
        &self,
        rp: &Relying,
        challenge: &str,
        key: &Passkey,
    ) -> Result<(), AssertionError> {
        let data: serde_json::Value =
            serde_json::from_slice(&self.client_data).map_err(|_| AssertionError::ClientData)?;
        let field = |k: &str| data.get(k).and_then(serde_json::Value::as_str);
        let (Some(kind), Some(given), Some(origin)) =
            (field("type"), field("challenge"), field("origin"))
        else {
            return Err(AssertionError::ClientData);
        };
        if kind != "webauthn.get" {
            return Err(AssertionError::Type);
        }
        if given != challenge {
            return Err(AssertionError::Challenge);
        }
        if !rp.origins.iter().any(|o| o == origin) {
            return Err(AssertionError::Origin);
        }
        // absent, it is false; anything but true or false is no client data
        let cross = match data.get("crossOrigin") {
            None => false,
            Some(v) => v.as_bool().ok_or(AssertionError::ClientData)?,
        };
        if cross {
            return Err(AssertionError::CrossOrigin);
        }
        let auth = &self.authenticator_data;
        if auth.len() < 37 {
            return Err(AssertionError::AuthData);
        }
        if auth[..32] != Sha256::digest(rp.rp_id.as_bytes())[..] {
            return Err(AssertionError::RpId);
        }
        if auth[32] & 1 != 1 {
            return Err(AssertionError::NotPresent);
        }
        if auth[32] & 4 != 4 {
            return Err(AssertionError::NotVerified);
        }
        let signature =
            Signature::from_der(&self.signature).map_err(|_| AssertionError::BadSignature)?;
        let mut signed = auth.clone();
        signed.extend_from_slice(&Sha256::digest(&self.client_data));
        key.0
            .verify(&signed, &signature)
            .map_err(|_| AssertionError::BadSignature)
    }
}
