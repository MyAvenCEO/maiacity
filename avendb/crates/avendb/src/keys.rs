//! Keys. Every vault, space and entry has a key per epoch, and the schedule in `policy` (the Lean model's `targets`)
//! says what each is sealed to: a human vault's key to its devices and owner signers (a passkey through a key derived
//! from its PRF output), a coop's key to its owner vaults' keys, a space key to the vaults holding read on the space,
//! an entry key to its space key and to the vaults holding read on just that entry. Every edit is encrypted under its
//! entry's current key, bound to the op that carries it. When anyone loses access, every key they could open moves to
//! a new epoch and the old key is sealed to the new one, so those who remain still read the history (T5, T6). Relay
//! caps get no key at all (T7).
//!
//! A key is 32 secret bytes. From them come its id, which names it in boxes and edits, the key that encrypts data under
//! it, and its two key pairs that others seal to without holding it: X-Wing (ML-KEM-768 with X25519) and Classic
//! McEliece 6688128f. A sealed box carries a share for each, and the key that encrypts the box hashes both shared
//! secrets, so it stays closed while either scheme holds: lattices and curves may weaken, codes have resisted since
//! 1978. A McEliece public key is a megabyte, so it travels as a blob named by its hash, beside the ops. Where the
//! sealer holds the key a box goes to, it wraps instead (symmetric, no public key at all). A signer's own key is one
//! more such secret: a device derives it with its other keys, a passkey from its PRF output.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use classic_mceliece_rust as mceliece;
use rand_core::{CryptoRng, Infallible, TryCryptoRng, TryRng};
use x_wing::{Decapsulate as _, Decapsulator as _, Encapsulate as _, KeyExport as _};

use crate::hash::{self, Hasher, Reader};
use crate::id::{BlobId, EntryId, SignerId, SpaceId, VaultId};
use crate::policy::Scope;

/// The suite of every box and edit: X-Wing and Classic McEliece 6688128f, XChaCha20-Poly1305, SHA-3. Its first byte.
pub const SUITE: u8 = 1;

/// A box sealed to a key pair, or wrapped under a key the sealer holds: its second byte.
const SEALED: u8 = 0;
const WRAPPED: u8 = 1;

/// An X-Wing public key's size, and a ciphertext's.
pub const XWING_PUBLIC_BYTES: usize = x_wing::ENCAPSULATION_KEY_SIZE;
const XWING_CIPHERTEXT: usize = x_wing::CIPHERTEXT_SIZE;
/// A Classic McEliece 6688128f public key's size, and a ciphertext's.
pub const MCELIECE_PUBLIC_BYTES: usize = mceliece::CRYPTO_PUBLICKEYBYTES;
const MCELIECE_CIPHERTEXT: usize = mceliece::CRYPTO_CIPHERTEXTBYTES;

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

/// What keys are sealed to: an X-Wing public key, and the id of a Classic McEliece public key, the blob that travels
/// beside the ops.
#[derive(Clone, PartialEq, Eq, Hash)]
pub struct PublicKey {
    pub xwing: Vec<u8>,
    pub mceliece: BlobId,
}

impl std::fmt::Debug for PublicKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "PublicKey(X-Wing {} bytes, McEliece {:?})", self.xwing.len(), self.mceliece)
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

    /// A key derived from 32 bytes of other secret material: a signer's own key from its PRF output or device secret.
    pub fn derive(purpose: &str, material: &[u8; 32]) -> Secret {
        Secret(hash::keyed(material, purpose, b""))
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
        KeyId(hash::keyed(&self.0, "key id", b""))
    }

    fn data_key(&self) -> [u8; 32] {
        hash::keyed(&self.0, "data key", b"")
    }

    fn xwing(&self) -> x_wing::DecapsulationKey {
        x_wing::DecapsulationKey::from(hash::keyed(&self.0, "x-wing key", b""))
    }

    fn mceliece(&self) -> Arc<McEliece> {
        McEliece::of(self)
    }

    /// The public halves of the key's pairs: what others seal to without holding the key. The first call makes the
    /// McEliece pair, which takes most of a second.
    pub fn public(&self) -> PublicKey {
        PublicKey { xwing: self.xwing().encapsulation_key().to_bytes().to_vec(), mceliece: self.mceliece().id }
    }

    /// The Classic McEliece public key that `public` names: the blob that travels beside it.
    pub fn mceliece_public(&self) -> Arc<[u8]> {
        self.mceliece().public.clone()
    }

    /// Start making the key's McEliece pair in the background, so that the first `public` or `open` that needs it
    /// waits less: a device does so for its own key as it unlocks, and for a vault or space key as it makes one.
    pub fn prepare(&self) {
        let key = self.clone();
        std::thread::spawn(move || drop(key.mceliece()));
    }
}

/// A key's Classic McEliece pair. It is made from the key alone, so every holder makes the same one, and it is kept for
/// the life of the process, as making one takes most of a second.
struct McEliece {
    public: Arc<[u8]>,
    id: BlobId,
    secret: mceliece::SecretKey<'static>,
}

impl McEliece {
    fn of(key: &Secret) -> Arc<McEliece> {
        type Slot = Arc<OnceLock<Arc<McEliece>>>;
        static PAIRS: OnceLock<Mutex<HashMap<KeyId, Slot>>> = OnceLock::new();
        // one slot per key: whoever asks for the same key meanwhile waits for it, other keys are made side by side
        let slot = PAIRS.get_or_init(Default::default).lock().expect("the pairs").entry(key.id()).or_default().clone();
        slot.get_or_init(|| {
            let mut h = Hasher::new("mceliece key pair");
            h.update(&key.0);
            let (public, secret) = mceliece::keypair_boxed(&mut Rng06(h.reader()));
            let public: Arc<[u8]> = public.as_array()[..].into();
            Arc::new(McEliece { id: BlobId::of(&public), public, secret })
        })
        .clone()
    }
}

/// Randomness read from a hash, as McEliece takes it (rand 0.8's traits).
struct Rng06(Reader);

impl Rng06 {
    /// Randomness for one encapsulation, seeded from the caller's.
    fn from(rng: &mut impl CryptoRng) -> Rng06 {
        let mut seed = [0u8; 32];
        rng.fill_bytes(&mut seed);
        let mut h = Hasher::new("mceliece randomness");
        h.update(&seed);
        Rng06(h.reader())
    }
}

impl rand_core_06::RngCore for Rng06 {
    fn next_u32(&mut self) -> u32 {
        u32::from_le_bytes(self.0.array())
    }

    fn next_u64(&mut self) -> u64 {
        u64::from_le_bytes(self.0.array())
    }

    fn fill_bytes(&mut self, dst: &mut [u8]) {
        self.0.fill(dst);
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), rand_core_06::Error> {
        self.0.fill(dst);
        Ok(())
    }
}

impl rand_core_06::CryptoRng for Rng06 {}

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

/// Seal `key` to `to`, bound to `info`, given the McEliece public key `to` names (`mceliece`): an X-Wing share and a
/// McEliece share, each encapsulating a secret, and `key` encrypted under a hash of both secrets, both ciphertexts and
/// both public keys, so opening the box takes both secret keys. `None` if `to` is no X-Wing key, or `mceliece` no
/// McEliece key; a McEliece key other than the one `to` names makes a box nobody opens.
pub fn seal(key: &Secret, to: &PublicKey, mceliece: &[u8], info: &[u8], rng: &mut impl CryptoRng) -> Option<Vec<u8>> {
    let xwing = x_wing::EncapsulationKey::try_from(&to.xwing[..]).ok()?;
    let (ct1, ss1) = xwing.encapsulate_with_rng(rng);
    let pk: Box<[u8; MCELIECE_PUBLIC_BYTES]> = mceliece.to_vec().into_boxed_slice().try_into().ok()?;
    let (ct2, ss2) = mceliece::encapsulate_boxed(&mceliece::PublicKey::from(pk), &mut Rng06::from(rng));
    let under = box_key(&ss1, ss2.as_array(), &ct1, ct2.as_array(), to, info);
    Some([&[SUITE, SEALED][..], &ct1, ct2.as_array(), &encrypt(&under, &key.0, info, rng)].concat())
}

/// The key a sealed box is encrypted under: both shared secrets, both ciphertexts, both public keys and what the box
/// is bound to. All have fixed sizes but `info`, which comes last.
fn box_key(ss1: &[u8], ss2: &[u8], ct1: &[u8], ct2: &[u8], to: &PublicKey, info: &[u8]) -> Secret {
    let mut h = Hasher::new("box key");
    h.update(ss1).update(ss2).update(ct1).update(ct2).update(&to.xwing).update(&to.mceliece.0).update(info);
    Secret(h.finalize())
}

/// Wrap `key` under `under`, a key the sealer holds: an old epoch under the new one, or a key under a recipient's key
/// the sealer holds too.
pub fn wrap(key: &Secret, under: &Secret, info: &[u8], rng: &mut impl CryptoRng) -> Vec<u8> {
    [&[SUITE, WRAPPED][..], &encrypt(under, &key.0, info, rng)].concat()
}

/// Open a box, sealed or wrapped, with the key it was made for; `None` if it was made for another key, with other
/// `info`, or changed.
pub fn open(bytes: &[u8], with: &Secret, info: &[u8]) -> Option<Secret> {
    let (&[suite, how], rest) = bytes.split_first_chunk::<2>()?;
    if suite != SUITE {
        return None;
    }
    let key = match how {
        SEALED => {
            let mc = with.mceliece();
            open_sealed(rest, &with.xwing(), &mc.secret, &with.public(), info)?
        }
        WRAPPED => decrypt(with, rest, info)?,
        _ => return None,
    };
    Secret::from_slice(&key)
}

/// A sealed box's contents, opened with an X-Wing and a McEliece secret key, for the public key `to`.
fn open_sealed(
    rest: &[u8],
    xwing: &x_wing::DecapsulationKey,
    mc: &mceliece::SecretKey<'_>,
    to: &PublicKey,
    info: &[u8],
) -> Option<Vec<u8>> {
    let (ct1, rest) = rest.split_at_checked(XWING_CIPHERTEXT)?;
    let (ct2, rest) = rest.split_at_checked(MCELIECE_CIPHERTEXT)?;
    let ss1 = xwing.decapsulate(&x_wing::Ciphertext::try_from(ct1).ok()?);
    let ss2 = mceliece::decapsulate_boxed(&mceliece::Ciphertext::from(<[u8; MCELIECE_CIPHERTEXT]>::try_from(ct2).ok()?), mc);
    decrypt(&box_key(&ss1, ss2.as_array(), ct1, ct2, to, info), rest, info)
}

/// Encrypt `plaintext` under `key`, bound to `context`: XChaCha20-Poly1305 with a random 24-byte nonce, under a key
/// derived from the key and the nonce, behind a commitment to both, so a ciphertext opens under one key only.
pub fn encrypt(key: &Secret, plaintext: &[u8], context: &[u8], rng: &mut impl CryptoRng) -> Vec<u8> {
    let mut nonce = [0u8; 24];
    rng.fill_bytes(&mut nonce);
    let (cipher, commitment) = per_nonce(key, &nonce);
    let ct = cipher.encrypt(&XNonce::from(nonce), Payload { msg: plaintext, aad: context }).expect("an edit fits");
    [&nonce[..], &commitment, &ct].concat()
}

/// Decrypt; `None` for another key, another context or a changed byte.
pub fn decrypt(key: &Secret, ciphertext: &[u8], context: &[u8]) -> Option<Vec<u8>> {
    let nonce: [u8; 24] = ciphertext.get(..24)?.try_into().ok()?;
    let commitment = ciphertext.get(24..56)?;
    let (cipher, expected) = per_nonce(key, &nonce);
    // compared in constant time
    if expected.iter().zip(commitment).fold(0, |d, (a, b)| d | (a ^ b)) != 0 {
        return None;
    }
    cipher.decrypt(&XNonce::from(nonce), Payload { msg: &ciphertext[56..], aad: context }).ok()
}

fn per_nonce(key: &Secret, nonce: &[u8; 24]) -> (XChaCha20Poly1305, [u8; 32]) {
    let data = key.data_key();
    let cipher = XChaCha20Poly1305::new(&hash::keyed(&data, "encryption key", nonce).into());
    (cipher, hash::keyed(&data, "key commitment", nonce))
}

/// An edit's body: the suite, the id of the key it is encrypted under, then the ciphertext.
pub fn seal_edit(key: &Secret, plaintext: &[u8], context: &[u8], rng: &mut impl CryptoRng) -> Vec<u8> {
    [&[SUITE][..], &key.id().0, &encrypt(key, plaintext, context, rng)].concat()
}

/// The key an edit's body names.
pub fn edit_key(body: &[u8]) -> Option<KeyId> {
    let (&[suite], rest) = body.split_first_chunk::<1>()?;
    (suite == SUITE).then_some(KeyId(*rest.first_chunk::<32>()?))
}

pub fn open_edit(key: &Secret, body: &[u8], context: &[u8]) -> Option<Vec<u8>> {
    if edit_key(body)? != key.id() {
        return None;
    }
    decrypt(key, &body[33..], context)
}

/// Randomness from a seed: SHA-3's output stream. The Lab's keys and nonces come from it, so a failing test replays
/// exactly; the app uses the operating system's randomness.
pub struct SeededRng(Reader);

impl SeededRng {
    pub fn new(purpose: &str, seed: &[u8]) -> SeededRng {
        let mut h = Hasher::new(purpose);
        h.update(seed);
        SeededRng(h.reader())
    }
}

impl TryRng for SeededRng {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        Ok(u32::from_le_bytes(self.0.array()))
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        Ok(u64::from_le_bytes(self.0.array()))
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
        SeededRng::new("keys tests", b"")
    }

    fn sealed_to(key: &Secret, to: &Secret, info: &[u8], rng: &mut SeededRng) -> Vec<u8> {
        seal(key, &to.public(), &to.mceliece_public(), info, rng).unwrap()
    }

    #[test]
    fn a_sealed_key_opens_only_with_its_recipient() {
        let mut rng = rng();
        let (key, alice, mallory) = (Secret::generate(&mut rng), Secret::generate(&mut rng), Secret::generate(&mut rng));
        let sealed = sealed_to(&key, &alice, b"Welcome at 0", &mut rng);
        assert_eq!(open(&sealed, &alice, b"Welcome at 0"), Some(key.clone()));
        assert!(open(&sealed, &mallory, b"Welcome at 0").is_none());
        // bound to what it claims to be
        assert!(open(&sealed, &alice, b"Welcome at 1").is_none());
        for i in [0, 1, 2, 1200, 1400, sealed.len() - 1] {
            let mut changed = sealed.clone();
            changed[i] ^= 1;
            assert!(open(&changed, &alice, b"Welcome at 0").is_none(), "byte {i}");
        }
        // the suite and the kind, both ciphertexts (X-Wing 1,120 bytes, McEliece 208), then the key: nonce,
        // commitment, the key and its tag
        assert_eq!(sealed.len(), 2 + 1120 + 208 + 24 + 32 + 32 + 16);
    }

    #[test]
    fn one_share_alone_opens_nothing() {
        let mut rng = rng();
        let (key, alice, mallory) = (Secret::generate(&mut rng), Secret::generate(&mut rng), Secret::generate(&mut rng));
        let sealed = sealed_to(&key, &alice, b"info", &mut rng);
        let (_, rest) = sealed.split_at(2);
        let (xwing, mc) = (alice.xwing(), alice.mceliece());
        assert!(open_sealed(rest, &xwing, &mc.secret, &alice.public(), b"info").is_some());
        // whoever broke alice's X-Wing key (lattices and curves both), or her McEliece key, still opens nothing
        let other = mallory.mceliece();
        assert!(open_sealed(rest, &xwing, &other.secret, &alice.public(), b"info").is_none());
        assert!(open_sealed(rest, &mallory.xwing(), &mc.secret, &alice.public(), b"info").is_none());
        // and a box sealed with a McEliece key other than the one its public key names opens for nobody
        let mixed = seal(&key, &alice.public(), &mallory.mceliece_public(), b"info", &mut rng).unwrap();
        assert!(open(&mixed, &alice, b"info").is_none() && open(&mixed, &mallory, b"info").is_none());
    }

    #[test]
    fn a_wrapped_key_opens_only_under_its_key() {
        let mut rng = rng();
        let (old, new, other) = (Secret::generate(&mut rng), Secret::generate(&mut rng), Secret::generate(&mut rng));
        let wrapped = wrap(&old, &new, b"history", &mut rng);
        assert_eq!(open(&wrapped, &new, b"history"), Some(old.clone()));
        assert!(open(&wrapped, &other, b"history").is_none() && open(&wrapped, &new, b"other").is_none());
        assert_eq!(wrapped.len(), 2 + 24 + 32 + 32 + 16);
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
    fn an_edit_names_its_key_and_suite() {
        let mut rng = rng();
        let (key, other) = (Secret::generate(&mut rng), Secret::generate(&mut rng));
        let body = seal_edit(&key, b"todo: done", b"ctx", &mut rng);
        assert_eq!(body[0], SUITE);
        assert_eq!(edit_key(&body), Some(key.id()));
        assert_eq!(open_edit(&key, &body, b"ctx").as_deref(), Some(&b"todo: done"[..]));
        assert!(open_edit(&other, &body, b"ctx").is_none());
        let mut later = body.clone();
        later[0] = SUITE + 1;
        assert!(edit_key(&later).is_none() && open_edit(&key, &later, b"ctx").is_none());
    }

    #[test]
    fn keys_derive_the_same_everywhere() {
        let a = Secret::derive("keys tests", &[1; 32]);
        assert_eq!(a, Secret::derive("keys tests", &[1; 32]));
        assert_eq!(a.public(), Secret::from_bytes(a.bytes()).public());
        assert_ne!(a.id(), Secret::derive("keys tests", &[2; 32]).id());
        let public = a.public();
        assert_eq!(public.xwing.len(), XWING_PUBLIC_BYTES);
        assert_eq!(XWING_PUBLIC_BYTES, 1216);
        assert_eq!(a.mceliece_public().len(), MCELIECE_PUBLIC_BYTES);
        assert_eq!(MCELIECE_PUBLIC_BYTES, 1_044_992);
        assert_eq!(BlobId::of(&a.mceliece_public()), public.mceliece);
    }
}
