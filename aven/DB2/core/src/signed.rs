//! Signed things (`Aven.Core.Signed`, ARCHITECTURE.md rule 1, A30). Everything signed is a label plus a Value: the
//! signature covers exactly the encoding of `[label, body]`, so a signature made for one kind of thing can never be
//! read as another's. A signed thing is named by the hash of exactly those bytes, its signatures beside it: a set, one
//! per signer, sorted by signer, which only grows ([`add_sig`]). Adding a signature never renames the act
//! (`Signed.name_sigs`); the others are approvals over the same bytes.
//!
//! Verification is a parameter, as in the Lean: [`Verify`]. aven-core holds no keys and checks no signature itself;
//! avenID implements the schemes.

use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use crate::cbor::{Value, decode, encode};
use crate::limits::{
    MAX_ENVELOPE_BYTES, MAX_LABEL_BYTES, MAX_SIG_BYTES, MAX_SIGNER_BYTES, MAX_SIGS,
};
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

/// One signature beside a name: who signed and the signature, both opaque bytes (Lean's `Sig`); a suite lives inside
/// `sig`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Sig {
    pub signer: Vec<u8>,
    pub sig: Vec<u8>,
}

impl Sig {
    /// `{"sig", "signer"}` (`Sig.value`).
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("sig".into(), Value::Bytes(self.sig.clone())),
            ("signer".into(), Value::Bytes(self.signer.clone())),
        ])
    }

    /// Read back from [`Sig::value`] (`sigOf?`).
    pub fn of_value(v: Value) -> Option<Sig> {
        let Value::Map(kvs) = v else { return None };
        let [(ks, Value::Bytes(sig)), (kr, Value::Bytes(signer))]: [(String, Value); 2] =
            kvs.try_into().ok()?
        else {
            return None;
        };
        (ks == "sig" && kr == "signer").then_some(Sig { signer, sig })
    }

    /// A signature by its signer over `msg` (`Sig.valid`).
    pub fn valid(&self, verify: &impl Verify, msg: &[u8]) -> bool {
        verify.verify(&self.signer, msg, &self.sig)
    }
}

/// A set of signatures in its one form: strictly sorted by signer, so one per signer (`sigsOk`).
pub fn sigs_ok(sigs: &[Sig]) -> bool {
    sigs.windows(2).all(|w| w[0].signer < w[1].signer)
}

/// A set of signatures within the limits and in its one form (`sigsWithin`).
pub(crate) fn sigs_within(sigs: &[Sig]) -> bool {
    sigs.len() <= MAX_SIGS
        && sigs_ok(sigs)
        && sigs
            .iter()
            .all(|x| x.signer.len() <= MAX_SIGNER_BYTES && x.sig.len() <= MAX_SIG_BYTES)
}

/// Adds a signature to a set in its one form (`addSig`): in its place by signer, or, when that signer has signed
/// already, the set unchanged. A set only grows, and adding never renames what it signs.
pub fn add_sig(sigs: &mut Vec<Sig>, x: Sig) {
    if let Err(i) = sigs.binary_search_by(|y| y.signer.cmp(&x.signer)) {
        sigs.insert(i, x);
    }
}

pub(crate) fn sigs_value(sigs: &[Sig]) -> Value {
    Value::Array(sigs.iter().map(Sig::value).collect())
}

pub(crate) fn sigs_of(v: Value) -> Option<Vec<Sig>> {
    match v {
        Value::Array(xs) => xs.into_iter().map(Sig::of_value).collect(),
        _ => None,
    }
}

/// A label plus a Value, with the signatures beside it (Lean's `Signed`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signed {
    pub label: String,
    pub body: Value,
    pub sigs: Vec<Sig>,
}

impl Signed {
    /// What its signers sign.
    pub fn signing(&self) -> Vec<u8> {
        signing_bytes(&self.label, &self.body)
    }

    /// Every signature beside it is its signer's over [`Signed::signing`], and it has one at least (`Signed.valid`).
    pub fn valid(&self, verify: &impl Verify) -> bool {
        let msg = self.signing();
        !self.sigs.is_empty() && self.sigs.iter().all(|x| x.valid(verify, &msg))
    }

    /// `key` signed it: one of its signatures is by `key` and verifies (`Signed.signedBy`).
    pub fn signed_by(&self, verify: &impl Verify, key: &[u8]) -> bool {
        let msg = self.signing();
        self.sigs
            .iter()
            .any(|x| x.signer == key && x.valid(verify, &msg))
    }

    /// Its name: the hash of its label and body, exactly what its signers sign, never a signature (A30).
    pub fn name(&self) -> Hash {
        blake3(&self.signing())
    }

    /// As it travels, its signatures with it (`Signed.value`): `{body, sigs, label}`.
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("body".into(), self.body.clone()),
            ("sigs".into(), sigs_value(&self.sigs)),
            ("label".into(), Value::Text(self.label.clone())),
        ])
    }

    /// Read back from [`Signed::value`] and within its limits (`Signed.ofValue?`, `Signed.withinLimits`): exactly
    /// those three keys, the signatures a set in its one form.
    pub fn of_value(v: Value) -> Option<Signed> {
        let Value::Map(kvs) = v else { return None };
        let [(kb, body), (ks, sigs), (kl, Value::Text(label))]: [(String, Value); 3] =
            kvs.try_into().ok()?
        else {
            return None;
        };
        if (kb.as_str(), ks.as_str(), kl.as_str()) != ("body", "sigs", "label") {
            return None;
        }
        let sigs = sigs_of(sigs)?;
        (label.len() <= MAX_LABEL_BYTES && sigs_within(&sigs)).then_some(Signed {
            label,
            body,
            sigs,
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
