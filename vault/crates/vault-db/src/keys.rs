//! Keys. Every vault, space and entry has a key per epoch, and the schedule in `policy` (the Lean model's `targets`)
//! says what each is sealed to: a human vault's key to its devices and owner signers (a passkey through a key derived
//! from its PRF output, a recovery code through a key derived from the code), a coop's key to its owner vaults' keys,
//! a space key to the vaults holding read on the space, an entry key to its space key and to the vaults holding read
//! on just that entry. Every edit is encrypted under its entry's current key, bound to the op that carries it. When
//! anyone loses access, every key they could open moves to a new epoch and the old key is sealed to the new one, so
//! those who remain still read the history (T5, T6). Relay caps get no key at all (T7).
//!
//! A key is 32 secret bytes. From them come its id, which names it in boxes and edits, its X-Wing key pair, which
//! others seal to (HPKE, ML-KEM-768 with X25519, so a recorded seal stays closed to a later quantum computer), and the
//! key that encrypts data under it. A signer's own key is one more such secret: a device derives it from its signing
//! key, a passkey from its PRF output, a recovery code from the code.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use hpke::{Deserializable, Kem as _, OpModeR, OpModeS, Serializable};
use rand_core::{CryptoRng, Infallible, TryCryptoRng, TryRng};

use crate::id::{EntryId, SignerId, SpaceId, VaultId};
use crate::policy::Scope;

type Kem = hpke::kem::XWing;
type Kdf = hpke::kdf::HkdfSha256;
type HpkeAead = hpke::aead::ChaCha20Poly1305;

const ID_CONTEXT: &str = "maiacity vault-db 2026-10-08 key id v1";
const KEM_CONTEXT: &str = "maiacity vault-db 2026-10-08 key pair v1";
const DATA_CONTEXT: &str = "maiacity vault-db 2026-10-08 data key v1";

/// A box sealed to a public key (HPKE), or wrapped under a key the sealer holds.
const SEALED: u8 = 0;
const WRAPPED: u8 = 1;

/// A family of keys, one per vault, space and entry; its epoch moves on at every rotation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum KeyScope {
    Vault(VaultId),
    Space(SpaceId),
    Entry(SpaceId, EntryId),
}

impl KeyScope {
    /// The scope a space or entry key belongs to; a vault key has none.
    pub fn scope(self) -> Option<Scope> {
        match self {
            KeyScope::Vault(_) => None,
            KeyScope::Space(sp) => Some(Scope::Space(sp)),
            KeyScope::Entry(sp, e) => Some(Scope::Entry(sp, e)),
        }
    }
}

/// A signer's own key, or one epoch of a key family: what the schedule seals keys to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum KeyName {
    Signer(SignerId),
    Scoped(KeyScope, u64),
}

/// `secret` sealed to the key pair `to`: whoever can open `to` can open `secret`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Seal {
    pub secret: KeyName,
    pub to: KeyName,
}

/// A key's id: a hash of its secret. Which key a box holds, and which key an edit is encrypted under.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct KeyId(pub [u8; 32]);

impl std::fmt::Debug for KeyId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "KeyId(")?;
        for b in &self.0[..4] {
            write!(f, "{b:02x}")?;
        }
        write!(f, "…)")
    }
}

/// An X-Wing public key, what keys are sealed to.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PublicKey(pub Vec<u8>);

impl std::fmt::Debug for PublicKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PublicKey({} bytes)", self.0.len())
    }
}

/// A key's 32 secret bytes. Never leaves a device unsealed, except a public family's key, which is published.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret([u8; 32]);

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Secret({:?})", self.id())
    }
}

impl Secret {
    /// A fresh key.
    pub fn generate(rng: &mut impl CryptoRng) -> Secret {
        let mut b = [0u8; 32];
        rng.fill_bytes(&mut b);
        Secret(b)
    }

    /// A key derived from other secret material: a signer's own key from its signing key, PRF output or code.
    pub fn derive(context: &str, material: &[u8]) -> Secret {
        Secret(blake3::derive_key(context, material))
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Secret {
        Secret(bytes)
    }

    fn from_slice(bytes: &[u8]) -> Option<Secret> {
        Some(Secret(bytes.try_into().ok()?))
    }

    /// The bytes, to publish a public family's key.
    pub fn bytes(&self) -> [u8; 32] {
        self.0
    }

    pub fn id(&self) -> KeyId {
        KeyId(blake3::derive_key(ID_CONTEXT, &self.0))
    }

    fn pair(&self) -> (<Kem as hpke::Kem>::PrivateKey, <Kem as hpke::Kem>::PublicKey) {
        Kem::derive_keypair(&blake3::derive_key(KEM_CONTEXT, &self.0))
    }

    /// The public half of the key's X-Wing pair: what others seal to without holding the key.
    pub fn public(&self) -> PublicKey {
        PublicKey(self.pair().1.to_bytes().to_vec())
    }

    fn data_key(&self) -> [u8; 32] {
        blake3::derive_key(DATA_CONTEXT, &self.0)
    }
}

/// Whom a box is for: a signer's own key, or one key of a family (by its id, as a family can have more than one key
/// at an epoch when devices rotate it at the same time).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Recipient {
    Signer(SignerId),
    Key { key: KeyScope, epoch: u64, id: KeyId },
}

impl Recipient {
    /// The key pair of the schedule the box goes to.
    pub fn name(&self) -> KeyName {
        match *self {
            Recipient::Signer(s) => KeyName::Signer(s),
            Recipient::Key { key, epoch, .. } => KeyName::Scoped(key, epoch),
        }
    }
}

/// One key sealed to one recipient.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct KeyBox {
    pub to: Recipient,
    pub bytes: Vec<u8>,
}

/// Seal `key` to the public key `to` (HPKE base mode: X-Wing, HKDF-SHA256, ChaCha20-Poly1305), bound to `info`.
/// `None` if `to` is no X-Wing public key.
pub fn seal(key: &Secret, to: &PublicKey, info: &[u8], rng: &mut impl CryptoRng) -> Option<Vec<u8>> {
    let pk = <Kem as hpke::Kem>::PublicKey::from_bytes(&to.0).ok()?;
    let (enc, ct) = hpke::single_shot_seal_with_rng::<HpkeAead, Kdf, Kem>(&OpModeS::Base, &pk, info, &key.0, &[], rng).ok()?;
    Some([&[SEALED][..], &enc.to_bytes(), &ct].concat())
}

/// Wrap `key` under `under`, a key the sealer holds: an old epoch under the new one.
pub fn wrap(key: &Secret, under: &Secret, info: &[u8], rng: &mut impl CryptoRng) -> Vec<u8> {
    [&[WRAPPED][..], &encrypt(under, &key.0, info, rng)].concat()
}

/// Open a box, sealed or wrapped, with the key it was made for; `None` if it was made for another key, with other
/// `info`, or changed.
pub fn open(bytes: &[u8], with: &Secret, info: &[u8]) -> Option<Secret> {
    let (&how, rest) = bytes.split_first()?;
    let key = match how {
        SEALED => {
            let n = <<Kem as hpke::Kem>::EncappedKey as Serializable>::size();
            let enc = <Kem as hpke::Kem>::EncappedKey::from_bytes(rest.get(..n)?).ok()?;
            hpke::single_shot_open::<HpkeAead, Kdf, Kem>(&OpModeR::Base, &with.pair().0, &enc, info, &rest[n..], &[]).ok()?
        }
        WRAPPED => decrypt(with, rest, info)?,
        _ => return None,
    };
    Secret::from_slice(&key)
}

/// Encrypt `plaintext` under `key`, bound to `context`: XChaCha20-Poly1305 with a random 24-byte nonce, under a key
/// derived from the key and the nonce, behind a commitment to both, so a ciphertext opens under one key only.
pub fn encrypt(key: &Secret, plaintext: &[u8], context: &[u8], rng: &mut impl CryptoRng) -> Vec<u8> {
    let mut nonce = [0u8; 24];
    rng.fill_bytes(&mut nonce);
    let (cipher, commitment) = per_nonce(key, &nonce);
    let ct = cipher.encrypt(&XNonce::from(nonce), Payload { msg: plaintext, aad: context }).expect("an edit fits");
    [&nonce[..], commitment.as_bytes(), &ct].concat()
}

/// Decrypt; `None` for another key, another context or a changed byte.
pub fn decrypt(key: &Secret, ciphertext: &[u8], context: &[u8]) -> Option<Vec<u8>> {
    let nonce: [u8; 24] = ciphertext.get(..24)?.try_into().ok()?;
    let commitment: [u8; 32] = ciphertext.get(24..56)?.try_into().ok()?;
    let (cipher, expected) = per_nonce(key, &nonce);
    // blake3's hashes compare in constant time
    if expected != blake3::Hash::from_bytes(commitment) {
        return None;
    }
    cipher.decrypt(&XNonce::from(nonce), Payload { msg: &ciphertext[56..], aad: context }).ok()
}

fn per_nonce(key: &Secret, nonce: &[u8; 24]) -> (XChaCha20Poly1305, blake3::Hash) {
    let data = key.data_key();
    let derive = |what: &[u8]| blake3::Hasher::new_keyed(&data).update(what).update(nonce).finalize();
    let cipher = XChaCha20Poly1305::new(&(*derive(b"encrypt").as_bytes()).into());
    (cipher, derive(b"commit"))
}

/// An edit's body: the id of the key it is encrypted under, then the ciphertext.
pub fn seal_edit(key: &Secret, plaintext: &[u8], context: &[u8], rng: &mut impl CryptoRng) -> Vec<u8> {
    [&key.id().0[..], &encrypt(key, plaintext, context, rng)].concat()
}

/// The key an edit's body names.
pub fn edit_key(body: &[u8]) -> Option<KeyId> {
    Some(KeyId(body.get(..32)?.try_into().ok()?))
}

pub fn open_edit(key: &Secret, body: &[u8], context: &[u8]) -> Option<Vec<u8>> {
    if edit_key(body)? != key.id() {
        return None;
    }
    decrypt(key, &body[32..], context)
}

/// Randomness from a seed: BLAKE3's output stream. The Lab's keys and nonces come from it, so a failing test replays
/// exactly; the app uses the operating system's randomness.
pub struct SeededRng(blake3::OutputReader);

impl SeededRng {
    pub fn new(context: &str, seed: &[u8]) -> SeededRng {
        let mut h = blake3::Hasher::new_derive_key(context);
        h.update(seed);
        SeededRng(h.finalize_xof())
    }
}

impl TryRng for SeededRng {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        let mut b = [0u8; 4];
        self.0.fill(&mut b);
        Ok(u32::from_le_bytes(b))
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        let mut b = [0u8; 8];
        self.0.fill(&mut b);
        Ok(u64::from_le_bytes(b))
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Infallible> {
        self.0.fill(dst);
        Ok(())
    }
}

impl TryCryptoRng for SeededRng {}

#[cfg(test)]
mod tests {
    use super::*;

    fn rng() -> SeededRng {
        SeededRng::new("maiacity vault-db keys tests", b"")
    }

    #[test]
    fn a_sealed_key_opens_only_with_its_recipient() {
        let mut rng = rng();
        let (key, alice, mallory) = (Secret::generate(&mut rng), Secret::generate(&mut rng), Secret::generate(&mut rng));
        let sealed = seal(&key, &alice.public(), b"Welcome at 0", &mut rng).unwrap();
        assert_eq!(open(&sealed, &alice, b"Welcome at 0"), Some(key.clone()));
        assert!(open(&sealed, &mallory, b"Welcome at 0").is_none());
        // bound to what it claims to be
        assert!(open(&sealed, &alice, b"Welcome at 1").is_none());
        for i in [0, 1, sealed.len() - 1] {
            let mut changed = sealed.clone();
            changed[i] ^= 1;
            assert!(open(&changed, &alice, b"Welcome at 0").is_none(), "byte {i}");
        }
        // X-Wing: 1,120 bytes of encapsulation, then the key and its tag
        assert_eq!(sealed.len(), 1 + 1120 + 32 + 16);
    }

    #[test]
    fn a_wrapped_key_opens_only_under_its_key() {
        let mut rng = rng();
        let (old, new, other) = (Secret::generate(&mut rng), Secret::generate(&mut rng), Secret::generate(&mut rng));
        let wrapped = wrap(&old, &new, b"history", &mut rng);
        assert_eq!(open(&wrapped, &new, b"history"), Some(old.clone()));
        assert!(open(&wrapped, &other, b"history").is_none() && open(&wrapped, &new, b"other").is_none());
    }

    #[test]
    fn an_edit_round_trips_and_fails_with_any_change() {
        let mut rng = rng();
        let (key, other) = (Secret::generate(&mut rng), Secret::generate(&mut rng));
        let sealed = encrypt(&key, b"# Welcome", b"op context", &mut rng);
        assert_eq!(decrypt(&key, &sealed, b"op context").as_deref(), Some(&b"# Welcome"[..]));
        assert!(decrypt(&other, &sealed, b"op context").is_none());
        assert!(decrypt(&key, &sealed, b"another op").is_none());
        for i in [0, 30, sealed.len() - 1] {
            let mut changed = sealed.clone();
            changed[i] ^= 1;
            assert!(decrypt(&key, &changed, b"op context").is_none(), "byte {i}");
        }
        assert!(!sealed.windows(9).any(|w| w == b"# Welcome"));
    }

    #[test]
    fn an_edit_names_its_key() {
        let mut rng = rng();
        let (key, other) = (Secret::generate(&mut rng), Secret::generate(&mut rng));
        let body = seal_edit(&key, b"todo: done", b"ctx", &mut rng);
        assert_eq!(edit_key(&body), Some(key.id()));
        assert_eq!(open_edit(&key, &body, b"ctx").as_deref(), Some(&b"todo: done"[..]));
        assert!(open_edit(&other, &body, b"ctx").is_none());
    }

    #[test]
    fn keys_derive_the_same_everywhere() {
        let a = Secret::derive("maiacity vault-db keys tests", b"a device");
        assert_eq!(a, Secret::derive("maiacity vault-db keys tests", b"a device"));
        assert_eq!(a.public(), Secret::from_bytes(a.bytes()).public());
        assert_ne!(a.id(), Secret::derive("maiacity vault-db keys tests", b"another").id());
        assert_eq!(a.public().0.len(), 1216);
    }
}
