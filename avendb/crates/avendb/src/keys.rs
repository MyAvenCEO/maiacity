//! Keys. Every vault has a seed per generation, every cap with read or more a key per epoch, every cell (the entries
//! of a vault that the same caps select) a key per generation, and every entry a key per stay and generation, derived
//! from its cell's. The schedule in `policy` (the Lean model's `targets` and `linkAll`) says what each is sealed to,
//! wrapped under or derived from: a seed to its vault's devices and owner signers (a passkey through a key derived from
//! its PRF output) and to its owner vaults' seeds, a cap key to its grantee's seed (published for Public), a cell key
//! to the key of each cap with read or more that reaches the cell. Every write is encrypted under its entry's key in
//! the stay and generation it names, bound to the edit that carries it. When anyone loses access, every key they could
//! open moves to a new epoch and the old key is sealed to the new one, so those who remain still read the history
//! (T5, T6); a move wraps the entry's old keys under its new one, so its readers read its whole history and nobody gets
//! a key of the cell it left (T24). Relay caps get no key at all (T7, T25).
//!
//! A key is 32 secret bytes. From them come its id, which names it in boxes and edits, the key that encrypts data under
//! it, and its two key pairs that others seal to without holding it: X-Wing (ML-KEM-768 with X25519) and Classic
//! McEliece 6688128f. A sealed box carries a share for each, and the key that encrypts the box hashes both shared
//! secrets, so it stays closed while either scheme holds: lattices and curves may weaken, codes have resisted since
//! 1978. A McEliece public key is a megabyte, so it travels as a blob named by its hash, beside the edits. Where the
//! sealer holds the key a box goes to, it wraps instead (symmetric, no public key at all). A signer's own key is one
//! more such secret: a device derives it with its other keys, a passkey from its PRF output.
//!
//! Every secret here wipes itself as it is dropped (P8c, the device's secure boundary): a key's 32 bytes, each hash
//! state and cipher that held one, what a box opens to, and each McEliece pair's secret half, which a device that
//! locks has the process forget (`forget_pairs`), so that what it held stays sealed by both schemes.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use classic_mceliece_rust as mceliece;
use rand_core::{CryptoRng, Infallible, TryCryptoRng, TryRng};
use x_wing::{Decapsulate as _, Decapsulator as _, Encapsulate as _, KeyExport as _};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::hash::{self, Hasher, Reader};
use crate::id::{BlobId, CapId, CellId, EditId, EntryId, SignerId, VaultId};

/// The suite of every box and edit: X-Wing and Classic McEliece 6688128f, XChaCha20-Poly1305, SHA-3. Its first byte.
pub const SUITE: u8 = 1;

/// A box sealed to a key pair, or wrapped under a key the sealer holds, or sealed once to an X-Wing key alone
/// (`seal_once`): its second byte.
const SEALED: u8 = 0;
const WRAPPED: u8 = 1;
const ONCE: u8 = 2;

/// An X-Wing public key's size, and a ciphertext's.
pub const XWING_PUBLIC_BYTES: usize = x_wing::ENCAPSULATION_KEY_SIZE;
const XWING_CIPHERTEXT: usize = x_wing::CIPHERTEXT_SIZE;
/// A Classic McEliece 6688128f public key's size, and a ciphertext's.
pub const MCELIECE_PUBLIC_BYTES: usize = mceliece::CRYPTO_PUBLICKEYBYTES;
const MCELIECE_CIPHERTEXT: usize = mceliece::CRYPTO_CIPHERTEXTBYTES;

/// A family of keys that rotates through epochs (a seed's and a cell's are called generations): a vault's seed, whose
/// key pair is the vault's key and from which its master key is derived; the key of a cap with read or more; a cell's
/// key.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum KeyFam {
    Seed(VaultId),
    Cap(VaultId, CapId),
    Cell(VaultId, CellId),
}

impl KeyFam {
    /// The vault the family belongs to.
    pub fn vault(self) -> VaultId {
        match self {
            KeyFam::Seed(v) | KeyFam::Cap(v, _) | KeyFam::Cell(v, _) => v,
        }
    }
}

/// A signer's own key, one epoch of a key family, or the key of an entry in one of its stays (`None` for the stay its
/// creation began, else the move that began it) at a generation of that stay's cell: what the schedule seals keys to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum KeyName {
    Signer(SignerId),
    Scoped(KeyFam, u64),
    Entry(EntryId, Option<EditId>, u64),
}

/// `secret` sealed or wrapped to the key `to`, or derived from it: whoever can open `to` can open `secret`.
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
/// beside the edits.
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

/// A key's 32 secret bytes. Never leaves a device unsealed, except a public family's key, which is published; wiped as
/// it is dropped, each copy of it too.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret([u8; 32]);

impl Zeroize for Secret {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for Secret {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl ZeroizeOnDrop for Secret {}

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

    /// A key derived from this one and `data`: whoever holds this key derives it, and nobody else.
    pub fn child(&self, purpose: &str, data: &[u8]) -> Secret {
        Secret(hash::keyed(&self.0, purpose, data))
    }

    fn from_slice(bytes: &[u8]) -> Option<Secret> {
        Some(Secret(bytes.try_into().ok()?))
    }

    /// The bytes, to publish a public family's key.
    pub fn bytes(&self) -> [u8; 32] {
        self.0
    }

    /// The bytes, borrowed: no copy left behind.
    pub(crate) fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    pub fn id(&self) -> KeyId {
        KeyId(hash::keyed(&self.0, "key id", b""))
    }

    fn data_key(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(hash::keyed(&self.0, "data key", b""))
    }

    fn xwing(&self) -> x_wing::DecapsulationKey {
        let seed = Zeroizing::new(hash::keyed(&self.0, "x-wing key", b""));
        x_wing::DecapsulationKey::from(*seed)
    }

    fn mceliece(&self) -> Arc<McEliece> {
        McEliece::of(self)
    }

    /// The public halves of the key's pairs: what others seal to without holding the key. The first call makes the
    /// McEliece pair, which takes most of a second.
    pub fn public(&self) -> PublicKey {
        PublicKey { xwing: self.xwing().encapsulation_key().to_bytes().to_vec(), mceliece: self.mceliece().id }
    }

    /// The public half of its X-Wing pair alone, which `seal_once` seals to: no McEliece pair is made for it.
    pub fn xwing_public(&self) -> Vec<u8> {
        self.xwing().encapsulation_key().to_bytes().to_vec()
    }

    /// The Classic McEliece public key that `public` names: the blob that travels beside it.
    pub fn mceliece_public(&self) -> Arc<[u8]> {
        self.mceliece().public.clone()
    }

    /// Start making the key's McEliece pair in the background, so that the first `public` or `open` that needs it
    /// waits less: a device does so for its own key as it unlocks, and for a seed or a cap key as it makes one. A web
    /// page has no threads, so there the pair is only wanted (`want`), for the page to make in its workers.
    pub fn prepare(&self) {
        #[cfg(not(target_arch = "wasm32"))]
        {
            let key = self.clone();
            std::thread::spawn(move || drop(key.mceliece()));
        }
        #[cfg(target_arch = "wasm32")]
        self.want();
    }

    /// Note the key's McEliece pair as wanted, unless it is made already: `wanted_pairs` hands out its seed.
    pub fn want(&self) {
        let id = self.id();
        if pairs().lock().expect("the pairs").get(&id).is_some_and(|slot| slot.get().is_some()) {
            return;
        }
        let mut wanted = WANTED.lock().expect("the wanted pairs");
        let seed = self.pair_seed();
        if !wanted.iter().any(|w| w.0 == seed) {
            wanted.push((seed, id, false));
        }
    }

    /// The 32 bytes the key's McEliece pair is made from: all the randomness Classic McEliece draws for a pair. They
    /// open nothing, so a pair can be made anywhere from them alone.
    fn pair_seed(&self) -> [u8; 32] {
        let mut h = Hasher::new("mceliece key pair");
        h.update(&self.0);
        h.reader().array()
    }
}

/// Whether this process holds the McEliece pair of key `id`, made: its secret half among them.
pub fn pair_made(id: KeyId) -> bool {
    pairs().lock().expect("the pairs").get(&id).is_some_and(|slot| slot.get().is_some())
}

/// Forget the McEliece pairs of keys `ids`, made or wanted: a device that locks has the process forget the pairs of the
/// keys it held that nothing else in it holds (`Lab::lock`), as a pair's secret half opens half of every box sealed to
/// its key. Each is wiped once whoever uses it now is done with it; a key used again makes its pair again.
pub fn forget_pairs(ids: impl IntoIterator<Item = KeyId>) {
    let ids: std::collections::HashSet<KeyId> = ids.into_iter().collect();
    pairs().lock().expect("the pairs").retain(|id, _| !ids.contains(id));
    WANTED.lock().expect("the wanted pairs").retain(|w| !ids.contains(&w.1));
}

/// A key's Classic McEliece pair. It is made from the key alone, so every holder makes the same one, and it is kept for
/// the life of the process, as making one takes most of a second.
struct McEliece {
    public: Arc<[u8]>,
    id: BlobId,
    secret: mceliece::SecretKey<'static>,
}

/// One slot per key: whoever asks for the same key meanwhile waits for it, other keys are made side by side.
type Slot = Arc<OnceLock<Arc<McEliece>>>;

fn pairs() -> &'static Mutex<HashMap<KeyId, Slot>> {
    static PAIRS: OnceLock<Mutex<HashMap<KeyId, Slot>>> = OnceLock::new();
    PAIRS.get_or_init(Default::default)
}

/// The pairs wanted and not yet handed in: each seed, the key it is for, and whether `wanted_pairs` handed it out.
static WANTED: Mutex<Vec<([u8; 32], KeyId, bool)>> = Mutex::new(vec![]);

impl McEliece {
    fn of(key: &Secret) -> Arc<McEliece> {
        let slot = pairs().lock().expect("the pairs").entry(key.id()).or_default().clone();
        slot.get_or_init(|| {
            // made here after all: nobody needs to make it elsewhere anymore
            let seed = Zeroizing::new(key.pair_seed());
            WANTED.lock().expect("the wanted pairs").retain(|w| w.0 != *seed);
            Arc::new(McEliece::made(&seed))
        })
        .clone()
    }

    /// The pair `seed` makes (`Secret::pair_seed`).
    fn made(seed: &[u8; 32]) -> McEliece {
        let (public, secret) = mceliece::keypair_boxed(&mut PairSeed(Some(*seed)));
        let public: Arc<[u8]> = public.as_array()[..].into();
        McEliece { id: BlobId::of(&public), public, secret }
    }
}

/// A key pair's randomness: its seed, once. Classic McEliece draws 32 bytes for a pair and expands them itself.
struct PairSeed(Option<[u8; 32]>);

impl rand_core_06::RngCore for PairSeed {
    fn next_u32(&mut self) -> u32 {
        unreachable!("Classic McEliece draws a pair's seed whole")
    }

    fn next_u64(&mut self) -> u64 {
        unreachable!("Classic McEliece draws a pair's seed whole")
    }

    fn fill_bytes(&mut self, dst: &mut [u8]) {
        let seed = Zeroizing::new(self.0.take().expect("Classic McEliece draws one seed for a pair"));
        dst.copy_from_slice(&*seed);
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), rand_core_06::Error> {
        self.fill_bytes(dst);
        Ok(())
    }
}

impl rand_core_06::CryptoRng for PairSeed {}

/// The seeds of the McEliece pairs keys want (`Secret::want`) that nobody was handed yet: a web page makes each in a
/// worker of its own (`make_pair`) and hands it in (`hand_in_pair`), as it has no threads to make them in the
/// background.
pub fn wanted_pairs() -> Vec<[u8; 32]> {
    let mut out = vec![];
    for w in WANTED.lock().expect("the wanted pairs").iter_mut().filter(|w| !w.2) {
        w.2 = true;
        out.push(w.0);
    }
    out
}

/// The McEliece pair a seed from `wanted_pairs` makes: its public key, a megabyte, and its secret key.
pub fn make_pair(seed: &[u8; 32]) -> (Vec<u8>, Vec<u8>) {
    let pair = McEliece::made(seed);
    (pair.public.to_vec(), pair.secret.as_array().to_vec())
}

/// Hand in the pair `make_pair` made from a seed `wanted_pairs` gave out, for the key that wants it: false, keeping
/// nothing, if no key wants that seed or the bytes aren't a pair's. Nothing checks that the pair is the seed's, which
/// takes making it again: hand in only what `make_pair` made.
pub fn hand_in_pair(seed: &[u8; 32], public: &[u8], secret: &[u8]) -> bool {
    let Ok(secret) = <Box<[u8; mceliece::CRYPTO_SECRETKEYBYTES]>>::try_from(secret.to_vec().into_boxed_slice()) else {
        return false;
    };
    if public.len() != MCELIECE_PUBLIC_BYTES {
        return false;
    }
    let key = {
        let mut wanted = WANTED.lock().expect("the wanted pairs");
        let Some(at) = wanted.iter().position(|w| w.0 == *seed) else { return false };
        wanted.remove(at).1
    };
    let public: Arc<[u8]> = public.into();
    let pair = McEliece { id: BlobId::of(&public), public, secret: mceliece::SecretKey::from(secret) };
    let slot = pairs().lock().expect("the pairs").entry(key).or_default().clone();
    // a pair made meanwhile, where it was needed before it was handed in, stays: it is the same pair
    let _ = slot.set(Arc::new(pair));
    true
}

/// Randomness read from a hash, as McEliece takes it (rand 0.8's traits).
struct Rng06(Reader);

impl Rng06 {
    /// Randomness for one encapsulation, seeded from the caller's.
    fn from(rng: &mut impl CryptoRng) -> Rng06 {
        let mut seed = Zeroizing::new([0u8; 32]);
        rng.fill_bytes(&mut *seed);
        let mut h = Hasher::new("mceliece randomness");
        h.update(&*seed);
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

/// Whom a box is for: a signer's own key, or a key of the schedule (by its id too, as a family can have more than one
/// key at an epoch when devices rotate it at the same time).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Recipient {
    Signer(SignerId),
    Key { name: KeyName, id: KeyId },
}

impl Recipient {
    /// The key of the schedule the box goes to.
    pub fn name(&self) -> KeyName {
        match *self {
            Recipient::Signer(s) => KeyName::Signer(s),
            Recipient::Key { name, .. } => name,
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
    let key = Zeroizing::new(match how {
        SEALED => {
            let mc = with.mceliece();
            open_sealed(rest, &with.xwing(), &mc.secret, &with.public(), info)?
        }
        WRAPPED => decrypt(with, rest, info)?,
        _ => return None,
    });
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

/// Seal `plaintext` once to the X-Wing public key `to` alone, bound to `info`: what crosses once from one page to the
/// one that asked for it, held by a key that page made for the crossing and drops after it, as a passkey's ceremony
/// comes back from the Mac app's sign-in sheet (avendb-browser's `Sheet`). No key the schedule keeps is sealed so:
/// those boxes carry a McEliece share as well (`seal`). X-Wing is ML-KEM-768 with X25519, so the box stays closed while
/// either holds. `None` if `to` is no X-Wing key.
pub fn seal_once(to: &[u8], plaintext: &[u8], info: &[u8], rng: &mut impl CryptoRng) -> Option<Vec<u8>> {
    let xwing = x_wing::EncapsulationKey::try_from(to).ok()?;
    let (ct, ss) = xwing.encapsulate_with_rng(rng);
    let under = once_key(&ss, &ct, to, info);
    Some([&[SUITE, ONCE][..], &ct, &encrypt(&under, plaintext, info, rng)].concat())
}

/// What `seal_once` sealed to `with`'s X-Wing key, bound to `info`: `None` for another key, other `info`, or a changed
/// byte.
pub fn open_once(bytes: &[u8], with: &Secret, info: &[u8]) -> Option<Zeroizing<Vec<u8>>> {
    let (&[suite, how], rest) = bytes.split_first_chunk::<2>()?;
    if (suite, how) != (SUITE, ONCE) {
        return None;
    }
    let (ct, rest) = rest.split_at_checked(XWING_CIPHERTEXT)?;
    let xwing = with.xwing();
    let ss = xwing.decapsulate(&x_wing::Ciphertext::try_from(ct).ok()?);
    let to = xwing.encapsulation_key().to_bytes();
    decrypt(&once_key(&ss, ct, &to, info), rest, info).map(Zeroizing::new)
}

/// The key a box sealed once is encrypted under: the shared secret, the ciphertext, the public key and what the box is
/// bound to, which comes last.
fn once_key(ss: &[u8], ct: &[u8], to: &[u8], info: &[u8]) -> Secret {
    let mut h = Hasher::new("once key");
    h.update(ss).update(ct).update(to).update(info);
    Secret(h.finalize())
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
    let under = Zeroizing::new(hash::keyed(&data, "encryption key", nonce));
    let cipher = XChaCha20Poly1305::new(&(*under).into());
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

/// The key of entry `e` in its stay `stay` (`None` for the stay its creation began), derived from the key of that
/// stay's cell at a generation: the schedule's seal of an entry key to its cell key (`KeyName::Entry`). Whoever opens
/// the cell key derives the key of each entry in it, so a cell's entries need no box of their own; only a move wraps
/// the keys of an entry's earlier stays under the key of its new one.
pub fn entry_key(cell: &Secret, e: EntryId, stay: Option<EditId>) -> Secret {
    let mut data = Vec::with_capacity(65);
    data.extend_from_slice(&e.0);
    match stay {
        None => data.push(0),
        Some(s) => {
            data.push(1);
            data.extend_from_slice(&s.0);
        }
    }
    cell.child("entry key", &data)
}

/// Randomness from a seed, the Lab's: its keys and nonces come from it, so a failing test replays exactly, and a device
/// on a machine of its own seeds it with the machine's randomness. It keeps one key, and every draw hashes that key
/// into the bytes drawn and the next key, which overwrites it (fast key erasure): whoever reads its memory learns what
/// it will draw, never what it drew. A device that unlocks reseeds it with its own key (`reseed`), which only the
/// passkey derives again, so a copy of its memory taken while it was locked doesn't foresee that either.
pub struct SeededRng(Zeroizing<[u8; 32]>);

impl SeededRng {
    pub fn new(purpose: &str, seed: &[u8]) -> SeededRng {
        let mut h = Hasher::new(purpose);
        h.update(seed);
        SeededRng(Zeroizing::new(h.finalize()))
    }

    /// Mix secret `material` into the key: what it draws from now on depends on it.
    pub fn reseed(&mut self, material: &[u8]) {
        let mut h = Hasher::new("randomness reseeded");
        h.update(&*self.0).update(material);
        h.reader().fill(&mut *self.0);
    }
}

impl TryRng for SeededRng {
    type Error = Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Infallible> {
        let mut b = [0u8; 4];
        self.try_fill_bytes(&mut b)?;
        Ok(u32::from_le_bytes(b))
    }

    fn try_next_u64(&mut self) -> Result<u64, Infallible> {
        let mut b = [0u8; 8];
        self.try_fill_bytes(&mut b)?;
        Ok(u64::from_le_bytes(b))
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Infallible> {
        let mut h = Hasher::new("randomness drawn");
        h.update(&*self.0);
        let mut out = h.reader();
        out.fill(&mut *self.0);
        out.fill(dst);
        Ok(())
    }
}

impl TryCryptoRng for SeededRng {}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::Rng as _;

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
    fn a_box_sealed_once_opens_only_for_its_key() {
        let mut rng = rng();
        let (page, mallory) = (Secret::generate(&mut rng), Secret::generate(&mut rng));
        let to = page.xwing_public();
        assert_eq!(to.len(), XWING_PUBLIC_BYTES);
        let sealed = seal_once(&to, b"a ceremony", b"sheet 1", &mut rng).unwrap();
        assert_eq!(open_once(&sealed, &page, b"sheet 1").as_deref().map(Vec::as_slice), Some(&b"a ceremony"[..]));
        assert!(open_once(&sealed, &mallory, b"sheet 1").is_none());
        // bound to what it answers
        assert!(open_once(&sealed, &page, b"sheet 2").is_none());
        for i in [0, 1, 2, 1100, 1130, sealed.len() - 1] {
            let mut changed = sealed.clone();
            changed[i] ^= 1;
            assert!(open_once(&changed, &page, b"sheet 1").is_none(), "byte {i}");
        }
        // no other kind of box opens as one, nor one as another kind
        assert!(open(&sealed, &page, b"sheet 1").is_none());
        let wrapped = wrap(&mallory, &page, b"sheet 1", &mut rng);
        assert!(open_once(&wrapped, &page, b"sheet 1").is_none());
        // the suite and the kind, the X-Wing ciphertext (1,120 bytes), then the nonce, the commitment, the plaintext
        // and its tag
        assert_eq!(sealed.len(), 2 + 1120 + 24 + 32 + 10 + 16);
        assert!(!sealed.windows(10).any(|w| w == b"a ceremony"));
        assert!(seal_once(&to[1..], b"x", b"", &mut rng).is_none());
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
        let sealed = encrypt(&key, b"# Welcome", b"edit context", &mut rng);
        assert_eq!(decrypt(&key, &sealed, b"edit context").as_deref(), Some(&b"# Welcome"[..]));
        assert!(decrypt(&other, &sealed, b"edit context").is_none());
        assert!(decrypt(&key, &sealed, b"another edit").is_none());
        for i in [0, 30, sealed.len() - 1] {
            let mut changed = sealed.clone();
            changed[i] ^= 1;
            assert!(decrypt(&key, &changed, b"edit context").is_none(), "byte {i}");
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
    fn a_pair_made_from_its_seed_is_the_one_the_key_reads_from_its_hash() {
        // the key's hash stream, which Classic McEliece read before pairs had seeds: the same pair
        let key = Secret::derive("keys tests", &[3; 32]);
        let mut h = Hasher::new("mceliece key pair");
        h.update(&key.0);
        let (public, secret) = mceliece::keypair_boxed(&mut Rng06(h.reader()));
        assert_eq!(make_pair(&key.pair_seed()), (public.as_array().to_vec(), secret.as_array().to_vec()));
    }

    #[test]
    fn a_wanted_pair_is_handed_out_once_and_handed_in_once() {
        let key = Secret::derive("keys tests", &[4; 32]);
        key.want();
        key.want();
        let seed = key.pair_seed();
        assert_eq!(wanted_pairs().iter().filter(|s| **s == seed).count(), 1);
        assert!(!wanted_pairs().contains(&seed));
        let (public, secret) = make_pair(&seed);
        assert!(!hand_in_pair(&seed, &public[1..], &secret) && !hand_in_pair(&[0; 32], &public, &secret));
        assert!(hand_in_pair(&seed, &public, &secret));
        assert!(!hand_in_pair(&seed, &public, &secret));
        // the key reads its pair from what was handed in, and wants it no more
        assert_eq!(key.mceliece_public()[..], public[..]);
        key.want();
        assert!(!wanted_pairs().contains(&seed));
    }

    fn draw<const N: usize>(rng: &mut SeededRng) -> [u8; N] {
        let mut out = [0u8; N];
        rng.fill_bytes(&mut out);
        out
    }

    #[test]
    fn the_randomness_keeps_nothing_that_draws_again_what_it_drew() {
        // fast key erasure: the generator is one key, which every draw replaces with a hash of it
        let mut rng = SeededRng::new("keys tests", b"erasure");
        let before = *rng.0;
        let first: [u8; 32] = draw(&mut rng);
        let after = *rng.0;
        assert_ne!(after, before, "a draw replaces the key");
        assert_ne!(first, after, "and hands out other bytes than the next key");
        // whoever reads its memory now holds that key alone: what it draws next, never what it drew
        let mut copy = SeededRng(Zeroizing::new(after));
        assert_eq!(draw::<64>(&mut copy), draw::<64>(&mut rng));
        // the same seed draws the same bytes, so a failing test replays
        let mut again = SeededRng::new("keys tests", b"erasure");
        assert_eq!(draw::<32>(&mut again), first);
    }

    #[test]
    fn a_reseeded_generator_draws_what_no_copy_from_before_foresees() {
        let (mut a, mut copy, mut b) = (rng(), rng(), rng());
        a.reseed(b"the device's key, derived again as it unlocks");
        b.reseed(b"the device's key, derived again as it unlocks");
        let (x, y, z) = (draw::<32>(&mut a), draw::<32>(&mut copy), draw::<32>(&mut b));
        assert_ne!(x, y, "a copy taken before the reseed draws other bytes");
        assert_eq!(x, z, "the same reseed draws the same: a failing test replays");
    }

    #[test]
    fn a_forgotten_pair_is_made_again_when_the_key_is_used_again() {
        let key = Secret::derive("keys tests", &[6; 32]);
        let public = key.public();
        assert!(pair_made(key.id()));
        forget_pairs([key.id()]);
        assert!(!pair_made(key.id()), "forgotten: its secret half is gone from the process");
        // a key that wants its pair, and is forgotten before it is handed in, wants it no more
        let other = Secret::derive("keys tests", &[7; 32]);
        other.want();
        let wanted = || WANTED.lock().expect("the wanted pairs").iter().any(|w| w.0 == other.pair_seed());
        assert!(wanted());
        forget_pairs([other.id()]);
        assert!(!wanted());
        // used again, the key makes the same pair again
        assert_eq!(key.public(), public);
        assert!(pair_made(key.id()));
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
