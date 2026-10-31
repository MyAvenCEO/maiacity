//! Sealing envelopes and segments under a Doc's epoch key (caps, "Sealing"; docs, "Closing a segment"). **Provisional:
//! no Lean yet** for the construction below; caps fixes only the subkey labels, XChaCha20-Poly1305 with a key
//! commitment, Padmé, and that outside are only the Doc, the epoch and the padded length (D13, D18).
//!
//! - The use's subkey is `derive_key(label, epoch key)`: `avenDB envelope 1` or `avenDB segment 1`.
//! - A fresh 24-byte nonce. From `subkey ‖ nonce`, BLAKE3's key derivation makes the cipher's key
//!   (`avenDB seal key 1`) and the commitment's (`avenDB seal commit 1`), as a stanza's are made.
//! - The AAD is `encode({doc, epoch})`; the commitment is the commitment key's keyed hash of it, checked in constant
//!   time before anything is decrypted, so a sealed thing opens under one key only.
//! - The plaintext is padded to Padmé's length: a `0x80`, then zeros.
//! - As it travels: `encode({ct, doc, epoch, nonce, commit})`.

use aven_core::{DocId, Hash, Value, decode, encode};
use aven_id::{Entropy, Secret, subkey};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use subtle::ConstantTimeEq;

/// The loose envelope's subkey label.
pub const ENVELOPE_SEAL: &str = "avenDB envelope 1";
/// The segment's subkey label.
pub const SEGMENT_SEAL: &str = "avenDB segment 1";
pub const SEAL_KEY_LABEL: &str = "avenDB seal key 1";
pub const SEAL_COMMIT_LABEL: &str = "avenDB seal commit 1";

/// A Doc's epoch as a writer and reader hold it: its name (the hash of its key blob) and its key.
pub struct EpochKey {
    pub name: Hash,
    pub key: Secret,
}

/// Padmé (PURBs): the padded length of `l`, at most about 12 % more, leaking `O(log log l)` bits.
pub fn padme(l: usize) -> usize {
    if l < 2 {
        return l;
    }
    let e = usize::BITS - 1 - l.leading_zeros(); // ⌊log₂ l⌋
    let s = u32::BITS - e.leading_zeros(); // ⌊log₂ e⌋ + 1
    let mask = (1usize << (e - s)) - 1;
    (l + mask) & !mask
}

fn keys(sub: &Secret, nonce: &[u8; 24]) -> ([u8; 32], [u8; 32]) {
    let mut material = [0u8; 56];
    material[..32].copy_from_slice(sub.expose());
    material[32..].copy_from_slice(nonce);
    (
        blake3::derive_key(SEAL_KEY_LABEL, &material),
        blake3::derive_key(SEAL_COMMIT_LABEL, &material),
    )
}

fn aad(doc: &DocId, epoch: &Hash) -> Vec<u8> {
    encode(&Value::Map(vec![
        ("doc".into(), doc.0.value()),
        ("epoch".into(), epoch.value()),
    ]))
}

/// `plaintext` sealed for `doc` under `epoch`'s subkey for `label`.
pub fn seal(
    label: &str,
    epoch: &EpochKey,
    doc: &DocId,
    plaintext: &[u8],
    entropy: &mut impl Entropy,
) -> Vec<u8> {
    let mut nonce = [0u8; 24];
    entropy.fill(&mut nonce);
    let (key, commit_key) = keys(&subkey(label, &epoch.key), &nonce);
    let aad = aad(doc, &epoch.name);
    let commit = blake3::keyed_hash(&commit_key, &aad);
    let mut padded = Vec::with_capacity(padme(plaintext.len() + 1));
    padded.extend_from_slice(plaintext);
    padded.push(0x80);
    padded.resize(padme(plaintext.len() + 1), 0);
    let ct = XChaCha20Poly1305::new(&key.into())
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: &padded,
                aad: &aad,
            },
        )
        .expect("XChaCha20-Poly1305 seals any length a store chunk holds");
    encode(&Value::Map(vec![
        ("ct".into(), Value::Bytes(ct)),
        ("doc".into(), doc.0.value()),
        ("epoch".into(), epoch.name.value()),
        ("nonce".into(), Value::Bytes(nonce.to_vec())),
        ("commit".into(), Value::Bytes(commit.as_bytes().to_vec())),
    ]))
}

/// What is outside a seal: the Doc, the epoch, and the padded length (D13).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outside {
    pub doc: DocId,
    pub epoch: Hash,
    pub len: usize,
}

struct Sealed {
    outside: Outside,
    ct: Vec<u8>,
    nonce: [u8; 24],
    commit: [u8; 32],
}

fn read(bytes: &[u8], limit: usize) -> Option<Sealed> {
    if bytes.len() > limit {
        return None;
    }
    let Value::Map(kvs) = decode(bytes)? else {
        return None;
    };
    let [
        (k0, Value::Bytes(ct)),
        (k1, Value::Bytes(doc)),
        (k2, Value::Bytes(epoch)),
        (k3, Value::Bytes(nonce)),
        (k4, Value::Bytes(commit)),
    ] = kvs.as_slice()
    else {
        return None;
    };
    if [k0, k1, k2, k3, k4].map(String::as_str) != ["ct", "doc", "epoch", "nonce", "commit"] {
        return None;
    }
    Some(Sealed {
        outside: Outside {
            doc: DocId(Hash(doc.as_slice().try_into().ok()?)),
            epoch: Hash(epoch.as_slice().try_into().ok()?),
            len: ct.len(),
        },
        ct: ct.clone(),
        nonce: nonce.as_slice().try_into().ok()?,
        commit: commit.as_slice().try_into().ok()?,
    })
}

/// What a keeper sees of a sealed thing, within `limit` bytes.
pub fn outside(bytes: &[u8], limit: usize) -> Option<Outside> {
    read(bytes, limit).map(|s| s.outside)
}

/// Opens a sealed thing of `limit` bytes at most with `epoch`'s subkey for `label`: `None` unless its commitment is
/// this key's, it authenticates, and its padding is whole.
pub fn open(label: &str, epoch: &EpochKey, bytes: &[u8], limit: usize) -> Option<(DocId, Vec<u8>)> {
    let s = read(bytes, limit)?;
    if s.outside.epoch != epoch.name {
        return None;
    }
    let (key, commit_key) = keys(&subkey(label, &epoch.key), &s.nonce);
    let aad = aad(&s.outside.doc, &s.outside.epoch);
    let commit = blake3::keyed_hash(&commit_key, &aad);
    if !bool::from(commit.as_bytes().ct_eq(&s.commit)) {
        return None;
    }
    let mut pt = XChaCha20Poly1305::new(&key.into())
        .decrypt(
            &XNonce::from(s.nonce),
            Payload {
                msg: &s.ct,
                aad: &aad,
            },
        )
        .ok()?;
    let end = pt.iter().rposition(|&b| b != 0)?;
    if pt[end] != 0x80 || padme(end + 1) != pt.len() {
        return None;
    }
    pt.truncate(end);
    Some((s.outside.doc, pt))
}
