//! Signed things (`Aven.Core.Signed`, ARCHITECTURE.md rule 1, A30). Everything signed is a label plus a Value: the
//! signature covers exactly the encoding of `[label, body]`, so a signature made for one kind of thing can never be
//! read as another's. A signed thing is named by the hash of exactly those bytes, its signatures beside it: signing one
//! act twice gives two signatures, never two names (`Signed.name_resign`).
//!
//! Verification is a parameter, as in the Lean: [`Verify`]. aven-core holds no keys and checks no signature itself;
//! avenID implements the schemes.

use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use crate::cbor::{Value, decode, encode};
use crate::limits::{MAX_ENVELOPE_BYTES, MAX_LABEL_BYTES, MAX_SIG_BYTES, MAX_SIGNER_BYTES};
use crate::names::{Hash, blake3};

/// A signature scheme: whether `sig` is `key`'s signature over `msg` (Lean's `Verify`). Any
/// `Fn(&[u8], &[u8], &[u8]) -> bool` is one.
pub trait Verify {
    fn verify(&self, key: &[u8], msg: &[u8], sig: &[u8]) -> bool;
}

impl<F: Fn(&[u8], &[u8], &[u8]) -> bool> Verify for F {
    fn verify(&self, key: &[u8], msg: &[u8], sig: &[u8]) -> bool {
        self(key, msg, sig)
    }
}

/// What a signer signs: the encoding of `[label, body]` (`signingBytes`).
pub fn signing_bytes(label: &str, body: &Value) -> Vec<u8> {
    encode(&Value::Array(vec![Value::Text(label.into()), body.clone()]))
}

/// A label plus a Value, with who signed it and the signature (Lean's `Signed`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signed {
    pub label: String,
    pub body: Value,
    pub signer: Vec<u8>,
    pub sig: Vec<u8>,
}

impl Signed {
    /// What its signer signs.
    pub fn signing(&self) -> Vec<u8> {
        signing_bytes(&self.label, &self.body)
    }

    /// Whether the signature is the signer's over exactly [`Signed::signing`] (`Signed.valid`).
    pub fn valid(&self, verify: &impl Verify) -> bool {
        verify.verify(&self.signer, &self.signing(), &self.sig)
    }

    /// Its name: the hash of its label and body, exactly what its signer signs, never its signature (A30).
    pub fn name(&self) -> Hash {
        blake3(&self.signing())
    }

    /// As it travels, its signature with it (`Signed.value`): `{sig, body, label, signer}`.
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("sig".into(), Value::Bytes(self.sig.clone())),
            ("body".into(), self.body.clone()),
            ("label".into(), Value::Text(self.label.clone())),
            ("signer".into(), Value::Bytes(self.signer.clone())),
        ])
    }

    /// Read back from [`Signed::value`]: exactly those four keys, each in its form and within its limit.
    pub fn of_value(v: Value) -> Option<Signed> {
        let Value::Map(kvs) = v else { return None };
        let mut it = kvs.into_iter();
        let (sig, body, label, signer) = (it.next()?, it.next()?, it.next()?, it.next()?);
        if it.next().is_some()
            || (
                sig.0.as_str(),
                body.0.as_str(),
                label.0.as_str(),
                signer.0.as_str(),
            ) != ("sig", "body", "label", "signer")
        {
            return None;
        }
        let (Value::Bytes(sig), Value::Text(label), Value::Bytes(signer)) =
            (sig.1, label.1, signer.1)
        else {
            return None;
        };
        if sig.len() > MAX_SIG_BYTES
            || signer.len() > MAX_SIGNER_BYTES
            || label.len() > MAX_LABEL_BYTES
        {
            return None;
        }
        Some(Signed {
            label,
            body: body.1,
            signer,
            sig,
        })
    }

    pub fn encode(&self) -> Vec<u8> {
        encode(&self.value())
    }

    /// Decoded from its bytes, refused past [`MAX_ENVELOPE_BYTES`] before anything is read.
    pub fn decode(bytes: &[u8]) -> Option<Signed> {
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return None;
        }
        Signed::of_value(decode(bytes)?)
    }
}
