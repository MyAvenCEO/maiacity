//! Sealing a key to a reader (id/caps/README.md, "Epochs", "Sealing" and "Post-quantum"; `Aven.ID.KeyFormats`).
//!
//! A [`Stanza`] seals 32 bytes to a reader's X-Wing key, key-committing: from X-Wing's shared secret, BLAKE3's key
//! derivation makes the cipher's key (`avenID stanza key 1`) and the commitment's (`avenID stanza commit 1`). The AAD
//! is `encode({id, epoch, scope, recipient})`; the stanza carries the commitment key's keyed hash of it, which the
//! reader checks in constant time before it decrypts. XChaCha20-Poly1305 seals with nonce zero: every key is used once.
//!
//! A stanza names no reader unless it carries a tag: a reader finds its own by its tag or by opening.

use aven_core::{Value, encode};
use chacha20poly1305::aead::{Aead, KeyInit as _, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use subtle::ConstantTimeEq;
use x_wing::kem::{Decapsulate, Decapsulator, KeyExport, TryKeyInit};
use x_wing::{DecapsulationKey, EncapsulationKey};
use zeroize::{Zeroize, Zeroizing};

use crate::secret::{Entropy, Secret};
use crate::value::{bytes, fields, text};

pub const STANZA_KEY_LABEL: &str = "avenID stanza key 1";
pub const STANZA_COMMIT_LABEL: &str = "avenID stanza commit 1";
/// The stanza suite: X-Wing, these derivations, XChaCha20-Poly1305 (`Aven.ID.KeyFormats.stanzaSuite`).
pub const STANZA_SUITE: u64 = 1;

pub const PUBLIC_LEN: usize = x_wing::ENCAPSULATION_KEY_SIZE;
pub const CIPHERTEXT_LEN: usize = x_wing::CIPHERTEXT_SIZE;
/// 32 bytes of key and Poly1305's 16-byte tag.
pub const SEALED_LEN: usize = 48;
/// A commitment, a tag or an epoch's name: a BLAKE3 output (`commitLen`, `tagLen`, `nameLen`).
pub const HASH_LEN: usize = 32;

/// An X-Wing key that seals open: a device's, made in its safe runtime; a passkey's, derived from its PRF; a vault's
/// or a group's, which its keyring or group epoch holds. Its seed is wiped when it drops.
pub struct SealKey(DecapsulationKey);

impl SealKey {
    /// The key whose 32-byte X-Wing seed is `seed`.
    pub fn from_seed(seed: &Secret) -> SealKey {
        SealKey(DecapsulationKey::from(*seed.expose()))
    }

    /// A fresh key: a device's, a vault's, a group's.
    pub fn generate(entropy: &mut impl Entropy) -> SealKey {
        SealKey::from_seed(&Secret::generate(entropy))
    }

    /// Its seed, for a keyring or a group epoch to carry sealed.
    pub fn seed(&self) -> Secret {
        let mut bytes = *self.0.as_bytes();
        Secret::take(&mut bytes)
    }

    pub fn public(&self) -> SealPublic {
        SealPublic(self.0.encapsulation_key().clone())
    }
}

impl std::fmt::Debug for SealKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SealKey(..)")
    }
}

/// A seal key's public half: 1,216 bytes, ML-KEM-768's and X25519's.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct SealPublic(EncapsulationKey);

impl SealPublic {
    pub fn to_bytes(&self) -> [u8; PUBLIC_LEN] {
        let mut out = [0u8; PUBLIC_LEN];
        out.copy_from_slice(&self.0.to_bytes());
        out
    }

    /// `None` unless the bytes are an X-Wing public key.
    pub fn from_bytes(bytes: &[u8]) -> Option<SealPublic> {
        EncapsulationKey::new_from_slice(bytes).ok().map(SealPublic)
    }

    /// BLAKE3 of the public key: the AAD's `recipient`.
    pub fn fingerprint(&self) -> [u8; 32] {
        *blake3::hash(&self.to_bytes()).as_bytes()
    }
}

/// What a stanza seals for: a vault's keyring, or a Doc.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scope {
    Keyring,
    Doc,
}

impl Scope {
    pub fn text(self) -> &'static str {
        match self {
            Scope::Keyring => "keyring",
            Scope::Doc => "doc",
        }
    }

    pub fn parse(s: &str) -> Option<Scope> {
        match s {
            "keyring" => Some(Scope::Keyring),
            "doc" => Some(Scope::Doc),
            _ => None,
        }
    }
}

/// Where a stanza belongs: its scope, its owner (the vault or the Doc), and its epoch's number.
#[derive(Clone, Copy, Debug)]
pub struct Context<'a> {
    pub scope: Scope,
    pub owner: &'a str,
    pub n: u64,
}

impl Context<'_> {
    fn base(&self) -> Vec<(String, Value)> {
        vec![
            ("id".into(), text(self.owner)),
            ("epoch".into(), Value::Uint(self.n)),
            ("scope".into(), text(self.scope.text())),
        ]
    }

    /// A stanza's AAD: `encode({id, epoch, scope, recipient})`.
    pub fn aad(&self, recipient: &[u8; 32]) -> Vec<u8> {
        let mut kvs = self.base();
        kvs.push(("recipient".into(), bytes(recipient)));
        encode(&Value::Map(kvs))
    }

    /// What an epoch's own key seals is bound to: `encode({id, epoch, scope})`.
    pub fn inner_aad(&self) -> Vec<u8> {
        encode(&Value::Map(self.base()))
    }
}

/// A stanza's cipher key and commitment key, from X-Wing's shared secret.
pub fn stanza_keys(shared: &[u8; 32]) -> (Secret, Secret) {
    (
        Secret::take(&mut blake3::derive_key(STANZA_KEY_LABEL, shared)),
        Secret::take(&mut blake3::derive_key(STANZA_COMMIT_LABEL, shared)),
    )
}

/// The commitment a stanza carries: the commitment key's keyed hash of the AAD.
pub fn stanza_commit(commit_key: &Secret, aad: &[u8]) -> [u8; 32] {
    *blake3::keyed_hash(commit_key.expose(), aad).as_bytes()
}

/// A key sealed to one reader.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Stanza {
    pub ct: [u8; CIPHERTEXT_LEN],
    pub commit: [u8; 32],
    pub sealed: [u8; SEALED_LEN],
    /// What the reader finds it by, when the writer knows its tag seed.
    pub tag: Option<[u8; 32]>,
}

fn shared_secret(mut shared: x_wing::SharedKey) -> Zeroizing<[u8; 32]> {
    let mut out = Zeroizing::new([0u8; 32]);
    out.copy_from_slice(&shared);
    shared.as_mut_slice().zeroize();
    out
}

impl Stanza {
    /// `secret` sealed to `to`, for `context`. Takes 64 bytes of `entropy` for the encapsulation.
    pub fn seal(
        secret: &Secret,
        to: &SealPublic,
        context: &Context,
        entropy: &mut impl Entropy,
    ) -> Stanza {
        let mut randomness = Zeroizing::new([0u8; x_wing::ENCAPSULATION_RANDOMNESS_SIZE]);
        entropy.fill(randomness.as_mut());
        let (ct, shared) = to.0.encapsulate_deterministic((&*randomness).into());
        let (key, commit_key) = stanza_keys(&shared_secret(shared));
        let aad = context.aad(&to.fingerprint());
        let mut stanza = Stanza {
            ct: [0u8; CIPHERTEXT_LEN],
            commit: stanza_commit(&commit_key, &aad),
            sealed: wrap_key(&key, &aad, secret),
            tag: None,
        };
        stanza.ct.copy_from_slice(&ct);
        stanza
    }

    /// What the stanza seals, when it was sealed to `key` for `context`. The commitment is checked in constant time
    /// before anything is decrypted.
    pub fn open(&self, key: &SealKey, context: &Context) -> Option<Secret> {
        let shared = key.0.decapsulate(&self.ct.into());
        let (cipher_key, commit_key) = stanza_keys(&shared_secret(shared));
        let aad = context.aad(&key.public().fingerprint());
        if !bool::from(stanza_commit(&commit_key, &aad).ct_eq(&self.commit)) {
            return None;
        }
        unwrap_key(&cipher_key, &aad, &self.sealed)
    }

    pub fn value(&self) -> Value {
        let mut kvs = vec![
            ("ct".into(), bytes(&self.ct)),
            ("suite".into(), Value::Uint(STANZA_SUITE)),
            ("commit".into(), bytes(&self.commit)),
            ("sealed".into(), bytes(&self.sealed)),
        ];
        if let Some(tag) = &self.tag {
            kvs.push(("tag".into(), bytes(tag)));
        }
        Value::Map(kvs)
    }

    /// Exactly a stanza's keys, its suite and byte strings of their lengths, or nothing.
    pub fn of_value(v: &Value) -> Option<Stanza> {
        let f = fields(v, &["ct", "suite", "commit", "sealed"], &["tag"])?;
        if f.uint("suite")? != STANZA_SUITE {
            return None;
        }
        let tag = match f.get("tag") {
            Some(_) => Some(f.array("tag")?),
            None => None,
        };
        Some(Stanza {
            ct: f.array("ct")?,
            commit: f.array("commit")?,
            sealed: f.array("sealed")?,
            tag,
        })
    }
}

/// `inner` sealed under a key used once, so the nonce is zero.
pub(crate) fn wrap_key(key: &Secret, aad: &[u8], inner: &Secret) -> [u8; SEALED_LEN] {
    let cipher = XChaCha20Poly1305::new(key.expose().into());
    let sealed = cipher
        .encrypt(
            &XNonce::default(),
            Payload {
                msg: inner.expose(),
                aad,
            },
        )
        .expect("XChaCha20-Poly1305 seals 32 bytes");
    let mut out = [0u8; SEALED_LEN];
    out.copy_from_slice(&sealed);
    out
}

pub(crate) fn unwrap_key(key: &Secret, aad: &[u8], sealed: &[u8; SEALED_LEN]) -> Option<Secret> {
    let cipher = XChaCha20Poly1305::new(key.expose().into());
    let opened = Zeroizing::new(
        cipher
            .decrypt(&XNonce::default(), Payload { msg: sealed, aad })
            .ok()?,
    );
    let mut bytes = Zeroizing::new([0u8; 32]);
    bytes.copy_from_slice(opened.get(..32)?);
    Some(Secret::take(&mut bytes))
}
