//! The one seal for a Doc's loose envelopes, segments and checkpoints (`Aven.ID.Seal`; A176, A177; D13, D18), held
//! to `id/spec/vectors/seals.json`.
//!
//! - What it seals ([`Seals`]) has its own keys: from the epoch's key, `derive_key("avenDB <seals> 1")` is the
//!   cipher's and `derive_key("avenDB <seals> commit 1")` the commitment's.
//! - A fresh 24-byte nonce, XChaCha20-Poly1305's.
//! - The AAD is `encode({doc, epoch, seals})`; the commitment is the commitment key's keyed BLAKE3 over
//!   `encode({aad, nonce})`, checked in constant time before anything is decrypted.
//! - The plaintext is padded to the one padding's length of its length plus one ([`aven_id::pad_sealed`], A176:
//!   256 B, 1 KiB or 4 KiB, then Padmé): a `0x80`, then zeros.
//! - Outside: `encode({ct, doc, epoch, nonce, commit})`, and nothing else.

use aven_core::{DocId, Hash, Value, decode, encode};
use aven_id::{Entropy, Secret, pad_sealed};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use subtle::ConstantTimeEq;

/// What a seal holds (`Seals`, A177).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Seals {
    Envelope,
    Segment,
    Checkpoint,
}

impl Seals {
    pub const ALL: [Seals; 3] = [Seals::Envelope, Seals::Segment, Seals::Checkpoint];

    pub fn text(self) -> &'static str {
        match self {
            Seals::Envelope => "envelope",
            Seals::Segment => "segment",
            Seals::Checkpoint => "checkpoint",
        }
    }

    pub fn parse(s: &str) -> Option<Seals> {
        Seals::ALL.into_iter().find(|k| k.text() == s)
    }
}

/// A Doc's epoch as a writer and reader hold it: its name (the hash of its key blob) and its key.
pub struct EpochKey {
    pub name: Hash,
    pub key: Secret,
}

/// `cipherKey`: the cipher key for what it seals.
pub fn cipher_key(seals: Seals, epoch_key: &[u8; 32]) -> [u8; 32] {
    blake3::derive_key(&format!("avenDB {} 1", seals.text()), epoch_key)
}

/// `commitKey`: the commitment key for what it seals.
pub fn commit_key(seals: Seals, epoch_key: &[u8; 32]) -> [u8; 32] {
    blake3::derive_key(&format!("avenDB {} commit 1", seals.text()), epoch_key)
}

/// `aad`: `encode({doc, epoch, seals})`.
pub fn aad(seals: Seals, doc: &DocId, epoch: &Hash) -> Vec<u8> {
    encode(&Value::Map(vec![
        ("doc".into(), doc.0.value()),
        ("epoch".into(), epoch.value()),
        ("seals".into(), Value::Text(seals.text().into())),
    ]))
}

/// `commit`: the commitment key's keyed BLAKE3 over `encode({aad, nonce})`.
pub fn commit(seals: Seals, epoch_key: &[u8; 32], aad: &[u8], nonce: &[u8]) -> [u8; 32] {
    let msg = encode(&Value::Map(vec![
        ("aad".into(), Value::Bytes(aad.to_vec())),
        ("nonce".into(), Value::Bytes(nonce.to_vec())),
    ]));
    *blake3::keyed_hash(&commit_key(seals, epoch_key), &msg).as_bytes()
}

/// The most a sealed thing of a plaintext of at most `plaintext` bytes may take: the one padding's length of it plus one,
/// the tag, and the outside's frame.
pub fn sealed_limit(plaintext: usize) -> usize {
    pad_sealed(plaintext.saturating_add(1)).saturating_add(256)
}

/// `pad`: the plaintext, a `0x80`, then zeros to the one padding's length of its length plus one (A176).
pub fn pad(pt: &[u8]) -> Vec<u8> {
    let mut p = Vec::with_capacity(pad_sealed(pt.len() + 1));
    p.extend_from_slice(pt);
    p.push(0x80);
    p.resize(pad_sealed(pt.len() + 1), 0);
    p
}

/// `unpad`: the plaintext back, `None` unless the padding is whole.
pub fn unpad(p: &[u8]) -> Option<Vec<u8>> {
    let end = p.iter().rposition(|&b| b != 0)?;
    (p[end] == 0x80 && pad_sealed(end + 1) == p.len()).then(|| p[..end].to_vec())
}

/// What a keeper sees of a sealed thing: the Doc, the epoch, and the padded length (D13).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Outside {
    pub doc: DocId,
    pub epoch: Hash,
    pub len: usize,
}

/// A sealed thing as it travels (`Sealed`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sealed {
    pub ct: Vec<u8>,
    pub doc: DocId,
    pub epoch: Hash,
    pub nonce: [u8; 24],
    pub commit: [u8; 32],
}

impl Sealed {
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("ct".into(), Value::Bytes(self.ct.clone())),
            ("doc".into(), self.doc.0.value()),
            ("epoch".into(), self.epoch.value()),
            ("nonce".into(), Value::Bytes(self.nonce.to_vec())),
            ("commit".into(), Value::Bytes(self.commit.to_vec())),
        ])
    }

    pub fn encode(&self) -> Vec<u8> {
        encode(&self.value())
    }

    /// Read back within `limit` bytes: exactly its keys, each in its form.
    pub fn decode(bytes: &[u8], limit: usize) -> Option<Sealed> {
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
            ct: ct.clone(),
            doc: DocId(Hash(doc.as_slice().try_into().ok()?)),
            epoch: Hash(epoch.as_slice().try_into().ok()?),
            nonce: nonce.as_slice().try_into().ok()?,
            commit: commit.as_slice().try_into().ok()?,
        })
    }

    pub fn outside(&self) -> Outside {
        Outside {
            doc: self.doc,
            epoch: self.epoch,
            len: self.ct.len(),
        }
    }
}

/// `plaintext` sealed as `seals` for `doc` under `epoch`.
pub fn seal(
    seals: Seals,
    epoch: &EpochKey,
    doc: &DocId,
    plaintext: &[u8],
    entropy: &mut impl Entropy,
) -> Vec<u8> {
    let mut nonce = [0u8; 24];
    entropy.fill(&mut nonce);
    seal_with_nonce(seals, epoch, doc, plaintext, nonce).encode()
}

/// [`seal`] with a given nonce: for tests and vectors. A nonce must never repeat under one key.
pub fn seal_with_nonce(
    seals: Seals,
    epoch: &EpochKey,
    doc: &DocId,
    plaintext: &[u8],
    nonce: [u8; 24],
) -> Sealed {
    let a = aad(seals, doc, &epoch.name);
    let ct = XChaCha20Poly1305::new(&cipher_key(seals, epoch.key.expose()).into())
        .encrypt(
            &XNonce::from(nonce),
            Payload {
                msg: &pad(plaintext),
                aad: &a,
            },
        )
        .expect("XChaCha20-Poly1305 seals any length a store chunk holds");
    Sealed {
        ct,
        doc: *doc,
        epoch: epoch.name,
        nonce,
        commit: commit(seals, epoch.key.expose(), &a, &nonce),
    }
}

/// What a keeper sees of a sealed thing, within `limit` bytes.
pub fn outside(bytes: &[u8], limit: usize) -> Option<Outside> {
    Sealed::decode(bytes, limit).map(|s| s.outside())
}

/// What a sealed thing seals, found by its commitment alone, before anything is decrypted (`sealsOf`): each has a
/// commitment key of its own, so at most one commitment matches (`seals_by_commit`). A reader that fetched it from a
/// keeper, which knows only hashes, learns it this way, and nothing about it travels outside the seal (D13). `None`
/// when no commitment matches under `epoch`.
pub fn seals_of(epoch: &EpochKey, bytes: &[u8], limit: usize) -> Option<Seals> {
    let s = Sealed::decode(bytes, limit)?;
    if s.epoch != epoch.name {
        return None;
    }
    Seals::ALL.into_iter().find(|&k| {
        let a = aad(k, &s.doc, &s.epoch);
        bool::from(commit(k, epoch.key.expose(), &a, &s.nonce).ct_eq(&s.commit))
    })
}

/// Opens a sealed thing of `limit` bytes at most as `seals` under `epoch`: the commitment first, in constant time, then
/// the AEAD, then the padding (`openWith`). Returns its Doc and plaintext.
pub fn open(
    seals: Seals,
    epoch: &EpochKey,
    bytes: &[u8],
    limit: usize,
) -> Option<(DocId, Vec<u8>)> {
    let s = Sealed::decode(bytes, limit)?;
    if s.epoch != epoch.name {
        return None;
    }
    let a = aad(seals, &s.doc, &s.epoch);
    if !bool::from(commit(seals, epoch.key.expose(), &a, &s.nonce).ct_eq(&s.commit)) {
        return None;
    }
    let p = XChaCha20Poly1305::new(&cipher_key(seals, epoch.key.expose()).into())
        .decrypt(
            &XNonce::from(s.nonce),
            Payload {
                msg: &s.ct,
                aad: &a,
            },
        )
        .ok()?;
    Some((s.doc, unpad(&p)?))
}
