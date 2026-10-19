//! Signatures: what makes an edit's signers its signers. A signature signs the edit's id, which hashes everything the
//! edit says, so the rules (`policy`) only ever see edits whose author and cosigners really signed them.
//!
//! Every signature on every edit is post-quantum, over the edit's id, in its signer's suite (`Suite`): ML-DSA-65 (FIPS
//! 204), the suite every signer moves to (the key move, Samuel 2026-10-19; `SIGNING` is the suite new signers are made
//! in), or SLH-DSA-SHA2-128f (FIPS 205), a hash-based signature, the suite of every signer made before. ML-DSA-65 signs
//! in a millisecond or two where SLH-DSA takes ten, verifies four times faster, and its signature with its key is a
//! third of SLH-DSA's 17 KB. A signer's id is the hash of its suite and its public keys, so it names each of them, and
//! a signer's new key is a new signer, which its vault takes in as it takes any. Every edit made before the move keeps
//! its SLH-DSA signature, which every device checks as it always has.
//!
//! - A device signs with its post-quantum key alone. Its ed25519 key is its iroh endpoint's, which TLS proves on a
//!   connection beside its hello (`Hello`); it signs no edit. A person's device derives all its keys from their
//!   passkey's PRF output (WebAuthn's `prf` extension) on a salt of its own, at every unlock, and holds them in memory
//!   only: a locked or stolen device holds no key. The server, which has no passkey, keeps keys of its own.
//! - A passkey's post-quantum key derives from its PRF output: the authenticator computes it, a keyed hash, so it is as
//!   post-quantum as the signature. Its signature also carries the ceremony's WebAuthn assertion (`WebAuthn`), as
//!   WebAuthn signs only with curves, P-256 here: the authenticator signs its data followed by the SHA-256 of the
//!   client data, whose challenge is the edit's id, or the hash of the ids of several edits it signs at once
//!   (`batch_challenge`). The assertion is the proof that the authenticator, and its person's fingerprint or PIN, took
//!   part in that very ceremony, which the post-quantum key, the same at every ceremony, can't give; it adds nothing
//!   against a quantum computer, and nothing counts on it alone.
//! - A Mac's Touch ID key (Samuel, 2026-10-19), an owner of its person's vault beside their passkey, is an ML-DSA-65
//!   key its Secure Enclave makes and never lets out, which signs only once Touch ID passes, and 32 secret bytes the
//!   Enclave seals, opened by the same touch, which the key keys are sealed to derives from. Its Enclave's signature
//!   (`EnclaveSig`) is the proof that the chip, and its person's finger, took part in that very ceremony, and, unlike an
//!   assertion, it holds against a quantum computer too: in the ML-DSA suite it is the key's whole signature. A Touch ID
//!   key made before the move also has an SLH-DSA key, derived from the secret, which signs beside it.
//!
//! A signer may also consent once, for good, to be added as an owner (`consent_challenge`, `standing`): its signature
//! over a challenge that names it alone. An edit that founds a vault with it among the first owners, or adds it as an
//! owner, takes that standing consent in place of its signature on the edit, unless the signer authors the edit or is
//! the vault's root; no other edit does. So a key kept offline, as the master recovery key is (`recovery`), is added to
//! vaults without ever coming online.
//!
//! Each signer also has a key that keys are sealed to (`keys`): a device derives it with its other keys, a passkey
//! from its PRF output, a Touch ID key from the bytes its Enclave seals, so whoever can sign as the signer can also
//! open what is sealed to it, and nothing else can.
//!
//! A passkey in the browser's authenticator signs in ceremonies (P8e, `Ceremony`): `navigator.credentials.get` over a
//! challenge, with the PRF evaluated on `PRF_SALT` in the same ceremony. The post-quantum keys and the key sealed to
//! the passkey derive from the PRF output, which a device holds for that ceremony only. The software passkey of the tests
//! and the Lab makes the same ceremonies (`Passkey::ceremony`).

use std::fmt;

use p256::ecdsa::signature::Verifier as _;
use sha2::{Digest, Sha256};
use slh_dsa::Sha2_128f;
use slh_dsa::signature::Keypair as _;
use zeroize::{ZeroizeOnDrop, Zeroizing};

use crate::hash::{self, Hasher};
use crate::id::{EditId, EntryId, SignerId};
use crate::keys::Secret;
use crate::policy::{Action, Edit, Principal, Refusal, Sharing};

/// What a signature signs: the edit's id, with this as its post-quantum context string. It names an edit by its first name,
/// op, as the master recovery key's standing consent, made offline, signs it (`recovery`).
pub const SIG_CONTEXT: &[u8] = b"avenDB 2026-10-08 op signature";

/// What a device's hello signs on a connection (`Hello`), with this as its context string: which end of the
/// connection the device speaks for and the connection's TLS exporter. Never an edit's id: the context keeps them
/// apart.
pub const HELLO_CONTEXT: &[u8] = b"avenDB 2026-10-08 hello";

/// What a signer signs its edits with, its post-quantum key's: a device's beside its ed25519 endpoint key, a passkey's
/// beside its P-256 key. A signer's id hashes its suite's byte, so each suite names signers of its own.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Suite {
    /// SLH-DSA-SHA2-128f: the suite of every signer made before the key move.
    SlhDsa = 1,
    /// ML-DSA-65: the suite of every signer made since. A signer's keys name its ML-DSA-65 key by its hash
    /// (`ml_dsa_key`), and each of its signatures brings that key whole.
    MlDsa = 2,
}

/// The suite new signers are made in: ML-DSA-65, since every app that reads edits checks it (the key move, K3, Samuel
/// 2026-10-19). A signer made before keeps its own suite, SLH-DSA, until it moves.
pub const SIGNING: Suite = Suite::MlDsa;

/// Every suite, the one new signers are made in first: whoever holds a key's secret makes it in each, as a signer it
/// meets may be in either (the key move).
pub const SUITES: [Suite; 2] = [SIGNING, Suite::SlhDsa];

impl Suite {
    /// Its byte, as a signer's id hashes it and a device's kept secret names it (`kept_secret`).
    pub fn byte(self) -> u8 {
        self as u8
    }

    /// The suite whose byte is `byte`, if any.
    pub fn of_byte(byte: u8) -> Option<Suite> {
        SUITES.into_iter().find(|s| s.byte() == byte)
    }

    /// Its signature's name, as the History view shows it.
    pub fn name(self) -> &'static str {
        match self {
            Suite::SlhDsa => "SLH-DSA",
            Suite::MlDsa => "ML-DSA-65",
        }
    }
}

/// A device's secret as the device keeps it where nothing else says its suite, on the server's or an agent's shelf or
/// in a cloud agent's key (`avendb_net::server`): the 32 bytes alone for a device in SLH-DSA, made before the key move,
/// as every one of those was kept; else its suite's byte, then the 32.
pub fn kept_secret(secret: &[u8; 32], suite: Suite) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(match suite {
        Suite::SlhDsa => secret.to_vec(),
        Suite::MlDsa => [&[suite.byte()][..], &secret[..]].concat(),
    })
}

/// The secret and suite `kept_secret` kept as `bytes`, if they are such.
pub fn kept_secret_of(bytes: &[u8]) -> Option<(Zeroizing<[u8; 32]>, Suite)> {
    let (suite, secret) = match bytes.len() {
        32 => (Suite::SlhDsa, bytes),
        33 => (Suite::of_byte(bytes[0]).filter(|&s| s != Suite::SlhDsa)?, &bytes[1..]),
        _ => return None,
    };
    Some((Zeroizing::new(secret.try_into().ok()?), suite))
}

/// An SLH-DSA-SHA2-128f signature's size.
pub const PQ_SIGNATURE_BYTES: usize = 17_088;

/// What a Touch ID key's Secure Enclave signs with ML-DSA-65 (`EnclaveSig`), as its context string: an edit's id, or
/// the challenge of the edits it signs together (`batch_challenge`), never anything else.
pub const ENCLAVE_CONTEXT: &[u8] = b"avenDB 2026-10-19 enclave signature";

/// An ML-DSA-65 public key's size, and a signature's (FIPS 204).
pub const ML_DSA_PUBLIC_BYTES: usize = 1952;
pub const ML_DSA_SIGNATURE_BYTES: usize = 3309;

/// The WebAuthn relying party passkeys belong to.
pub const RP_ID: &str = "maia.city";

/// Where a passkey assertion comes from: the website, whose sheet the Mac app opens for its ceremonies too.
pub const ORIGIN: &str = "https://maia.city";

/// The relying party a test page's passkeys belong to, in a build with the feature `localhost-passkeys`: a page on
/// localhost, whose virtual authenticator makes them (`scripts/test-browser.sh`). A build that ships never takes one.
pub const TEST_RP_ID: &str = "localhost";

/// The salt the app asks every passkey's PRF for its own keys: the same on every device, so each device that uses the
/// passkey derives the same keys from it. Its date is its version. A later version is a salt of its own: the PRF is a
/// keyed hash inside the authenticator, so its output on a new salt is independent of this one's, and the keys it
/// derives are new even to whoever once saw this salt's output; a vault moves to them as to any new owner, the old
/// keys signing the new in (`Sharing::Owner`) and the new removing the old.
pub const PRF_SALT: &[u8] = b"avenDB 2026-10-08 passkey prf salt";

/// What a device's salt starts with; 32 random bytes of the device's own follow, kept on the device. They are no
/// secret: without the passkey they derive nothing.
pub const DEVICE_SALT: &[u8] = b"avenDB 2026-10-08 device prf salt ";

/// The salt of the device whose own 32 bytes are `nonce`: `DEVICE_SALT` followed by them. A browser asks its passkey's
/// PRF for it beside `PRF_SALT`, in the ceremony that unlocks the device.
pub fn device_salt(nonce: &[u8; 32]) -> Vec<u8> {
    [DEVICE_SALT, &nonce[..]].concat()
}

/// Authenticator data flags: the user was present, and verified (PIN or biometrics).
const UP: u8 = 0x01;
const UV: u8 = 0x04;

/// A device's or a passkey's post-quantum key, which signs its edits: an SLH-DSA key, 32 bytes, or the hash of an
/// ML-DSA-65 key (`ml_dsa_key`), whose signatures bring the key whole.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum PqKey {
    Slh([u8; 32]),
    MlDsa([u8; 32]),
}

impl PqKey {
    pub fn suite(&self) -> Suite {
        match self {
            PqKey::Slh(_) => Suite::SlhDsa,
            PqKey::MlDsa(_) => Suite::MlDsa,
        }
    }

    /// Its 32 bytes: the SLH-DSA key, or the ML-DSA-65 key's hash.
    pub fn bytes(&self) -> &[u8; 32] {
        match self {
            PqKey::Slh(k) | PqKey::MlDsa(k) => k,
        }
    }

    /// `sig` is this key's signature on `message` with the context string `context`: SLH-DSA's own, or an ML-DSA-65
    /// key that hashes to this one followed by its signature.
    fn verifies(&self, message: &[u8], context: &[u8], sig: &[u8]) -> bool {
        match self {
            PqKey::Slh(key) => {
                let Ok(key) = slh_dsa::VerifyingKey::<Sha2_128f>::try_from(&key[..]) else { return false };
                let Ok(sig) = slh_dsa::Signature::<Sha2_128f>::try_from(sig) else { return false };
                key.try_verify_with_context(message, context, &sig).is_ok()
            }
            PqKey::MlDsa(hash) => {
                let Some((public, sig)) = sig.split_at_checked(ML_DSA_PUBLIC_BYTES) else { return false };
                ml_dsa_key(public) == *hash && verify_mldsa(public, message, context, sig)
            }
        }
    }
}

/// A signer's public keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SignerKeys {
    /// A device: its post-quantum key, which signs, and its ed25519 key, its iroh endpoint's, which TLS proves.
    Device { ed25519: [u8; 32], pq: PqKey },
    /// A passkey: the post-quantum key derived from its PRF output, which signs, and its P-256 key (SEC1 compressed),
    /// which signs its ceremonies' assertions.
    Passkey { p256: [u8; 33], pq: PqKey },
    /// A Mac's Touch ID key: the hash of the ML-DSA-65 key its Secure Enclave holds (`enclave_key`), which signs its
    /// ceremonies, each signature bringing that key whole (`EnclaveSig`); and, made before the key move, the SLH-DSA
    /// key derived from the secret the Enclave seals, which signs beside it. Without one, the Enclave's signature is
    /// the key's whole signature.
    Enclave { mldsa: [u8; 32], slh: Option<[u8; 32]> },
}

impl SignerKeys {
    /// The signer's id: the hash of its suite and its keys.
    pub fn id(&self) -> SignerId {
        let mut h = Hasher::new("signer id");
        h.update(&[self.suite() as u8]);
        match self {
            SignerKeys::Device { ed25519, pq } => h.update(&[0]).update(ed25519).update(pq.bytes()),
            SignerKeys::Passkey { p256, pq } => h.update(&[1]).update(p256).update(pq.bytes()),
            SignerKeys::Enclave { mldsa, slh: Some(slh) } => h.update(&[2]).update(mldsa).update(slh),
            SignerKeys::Enclave { mldsa, slh: None } => h.update(&[2]).update(mldsa),
        };
        SignerId(h.finalize())
    }

    /// What kind of signer it is, as the views name it: `device`, `passkey`, or `touch`, a Mac's Touch ID key.
    pub fn kind(&self) -> &'static str {
        match self {
            SignerKeys::Device { .. } => "device",
            SignerKeys::Passkey { .. } => "passkey",
            SignerKeys::Enclave { .. } => "touch",
        }
    }

    /// The suite its signatures are in: a Touch ID key's is SLH-DSA's where it has an SLH-DSA key beside its Enclave's.
    pub fn suite(&self) -> Suite {
        match self {
            SignerKeys::Device { pq, .. } | SignerKeys::Passkey { pq, .. } => pq.suite(),
            SignerKeys::Enclave { slh: Some(_), .. } => Suite::SlhDsa,
            SignerKeys::Enclave { slh: None, .. } => Suite::MlDsa,
        }
    }

    /// The post-quantum key its signatures carry a signature of beside any assertion or Enclave signature: `None` for a
    /// Touch ID key whose Enclave's signature is its whole signature.
    fn pq(&self) -> Option<PqKey> {
        match self {
            SignerKeys::Device { pq, .. } | SignerKeys::Passkey { pq, .. } => Some(*pq),
            SignerKeys::Enclave { slh, .. } => slh.map(PqKey::Slh),
        }
    }
}

/// What a Touch ID key's keys name of its ML-DSA-65 key, `public` as FIPS 204 encodes it: its hash.
pub fn enclave_key(public: &[u8]) -> [u8; 32] {
    hash::hash("enclave ml-dsa-65 key", public)
}

/// What a device's or a passkey's keys name of its ML-DSA-65 key, `public` as FIPS 204 encodes it: its hash.
pub fn ml_dsa_key(public: &[u8]) -> [u8; 32] {
    hash::hash("signer ml-dsa-65 key", public)
}

/// A Touch ID key's proof on a signature, as a passkey's assertion is one (`WebAuthn`): its ML-DSA-65 key, which
/// hashes to the one its keys name, and its Secure Enclave's signature over the edit's id, or, for edits it signed in
/// one ceremony, over their batch's challenge, `edits` holding their ids, smallest first, the edit's among them
/// (`batch_challenge`). Empty `edits`: the edit alone.
#[derive(Clone, PartialEq, Eq)]
pub struct EnclaveSig {
    pub public: Vec<u8>,
    pub sig: Vec<u8>,
    pub edits: Vec<EditId>,
}

/// The keys and the signature show only their sizes.
impl fmt::Debug for EnclaveSig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("EnclaveSig")
            .field("public", &format!("{} bytes", self.public.len()))
            .field("sig", &format!("{} bytes", self.sig.len()))
            .field("edits", &self.edits)
            .finish()
    }
}

impl EnclaveSig {
    /// It proves the Touch ID key whose ML-DSA-65 key hashes to `mldsa` signed edit `edit`: its key is that one, and
    /// its signature verifies over the edit's id, or over its batch's challenge with the edit among them.
    fn verify(&self, mldsa: &[u8; 32], edit: EditId) -> bool {
        let challenge = if self.edits.is_empty() {
            edit.0
        } else if self.edits.windows(2).all(|w| w[0] < w[1]) && self.edits.contains(&edit) {
            batch_challenge(&self.edits)
        } else {
            return false;
        };
        enclave_key(&self.public) == *mldsa && verify_mldsa(&self.public, &challenge, ENCLAVE_CONTEXT, &self.sig)
    }
}

/// `sig` is the ML-DSA-65 signature of the key `public` on `message`, with the context string `context`.
fn verify_mldsa(public: &[u8], message: &[u8], context: &[u8], sig: &[u8]) -> bool {
    use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65, Signature as MlDsaSignature, VerifyingKey};
    let (Ok(public), Ok(sig)) =
        (EncodedVerifyingKey::<MlDsa65>::try_from(public), EncodedSignature::<MlDsa65>::try_from(sig))
    else {
        return false;
    };
    let Some(sig) = MlDsaSignature::<MlDsa65>::decode(&sig) else { return false };
    VerifyingKey::<MlDsa65>::decode(&public).verify_with_context(message, context, &sig)
}

/// One signer's signature on an edit: its keys, which hash to its id; the post-quantum signature over the edit's id;
/// and a passkey's WebAuthn assertion from the ceremony that made it, or a Touch ID key's Secure Enclave signature,
/// which a device's never carries.
#[derive(Clone, PartialEq, Eq)]
pub struct Signature {
    pub keys: SignerKeys,
    /// A passkey's assertion; `None` for a device or a Touch ID key.
    pub webauthn: Option<WebAuthn>,
    /// A Touch ID key's Secure Enclave signature; `None` for a device or a passkey.
    pub enclave: Option<EnclaveSig>,
    /// The signature of the keys' post-quantum key over the edit's id: SLH-DSA-SHA2-128f's, `PQ_SIGNATURE_BYTES`
    /// long; or the ML-DSA-65 key, `ML_DSA_PUBLIC_BYTES` long, followed by its signature. Empty for a Touch ID key
    /// whose Enclave's signature is its whole signature.
    pub pq: Vec<u8>,
}

/// The post-quantum signature shows only its size.
impl fmt::Debug for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let pq = format!("{} bytes", self.pq.len());
        f.debug_struct("Signature")
            .field("keys", &self.keys)
            .field("webauthn", &self.webauthn)
            .field("enclave", &self.enclave)
            .field("pq", &pq)
            .finish()
    }
}

/// A passkey's WebAuthn assertion on a signature: the proof that its authenticator, and its person, took part in the
/// ceremony that signed. WebAuthn signs only with curves, so it adds nothing against a quantum computer.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WebAuthn {
    /// The assertion whose challenge is the edit's id.
    Edit(Assertion),
    /// A passkey's WebAuthn assertion over several edits it signed in one ceremony: its challenge is their batch's
    /// (`batch_challenge`), and `edits` holds their ids, smallest first, the edit's among them.
    Batch { assertion: Assertion, edits: Vec<EditId> },
    /// A passkey's pass for a new device (`RelayPass`), made at `made`, on the edit that adds that device to the
    /// passkey's vault: the assertion over the pass's challenge (`pass_challenge`), the device's and `made`'s. The
    /// ceremony that unlocks a new device signs up or in with it: its PRF output makes the SLH-DSA signature on the
    /// edit. It counts only on an edit adding that very device, which cosigns it (`Sharing::Device`,
    /// `Signed::verify`).
    Pass { assertion: Assertion, made: u64 },
}

impl WebAuthn {
    /// Its assertion.
    pub fn assertion(&self) -> &Assertion {
        match self {
            WebAuthn::Edit(a) | WebAuthn::Batch { assertion: a, .. } | WebAuthn::Pass { assertion: a, .. } => a,
        }
    }
}

/// What `navigator.credentials.get` returns; the passkey's key is among the signer's keys.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assertion {
    pub authenticator_data: Vec<u8>,
    pub client_data_json: Vec<u8>,
    /// ECDSA P-256 over SHA-256, DER.
    pub signature: Vec<u8>,
}

/// An edit with one signature per signer, in the order of `Edit::sigs`: what devices store and send each other.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signed {
    pub edit: Edit,
    pub sigs: Vec<Signature>,
}

impl Signed {
    /// The edit, if each signer it names signed it. A write that creates its entry must name the entry by its own id,
    /// the hash of its vault, its author and its nonce (`EntryId::of`), else `NotItsId`.
    pub fn verify(&self) -> Result<&Edit, Refusal> {
        if let Action::Write { vault, entry, create: Some(c), .. } = &self.edit.action
            && *entry != EntryId::of(*vault, self.edit.author, &c.nonce)
        {
            return Err(Refusal::NotItsId);
        }
        let signers: Vec<SignerId> = self.edit.sigs().collect();
        let id = self.edit.id();
        let joins = match self.edit.action {
            Action::Share(Sharing::Device { device, .. }) if self.edit.cosigners.contains(&device) => Some(device),
            _ => None,
        };
        let standing = standing(&self.edit);
        let consents =
            |s: SignerId, sig: &Signature| standing.contains(&s) && verify(s, EditId(consent_challenge(s)), sig);
        let verifies = |(&s, sig): (&SignerId, &Signature)| verify_adding(s, id, sig, joins) || consents(s, sig);
        let all = signers.len() == self.sigs.len() && signers.iter().zip(&self.sigs).all(verifies);
        if all { Ok(&self.edit) } else { Err(Refusal::BadSignature) }
    }
}

/// A device's hello on a connection (P8): its keys, and its post-quantum signature over the connection's TLS exporter
/// and the end it speaks for. The TLS handshake proves the device's ed25519 key, its iroh endpoint's, and the hello
/// its post-quantum key: a connection proves which device is talking even once the curves fall, and a hello can't be
/// replayed on another connection, nor sent back by the other end.
#[derive(Clone, PartialEq, Eq)]
pub struct Hello {
    pub keys: SignerKeys,
    /// The device's post-quantum signature, as an edit's signature holds it (`Signature::pq`).
    pub sig: Vec<u8>,
}

/// The signature shows only its size.
impl fmt::Debug for Hello {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Hello").field("keys", &self.keys).field("sig", &format!("{} bytes", self.sig.len())).finish()
    }
}

impl Hello {
    /// The device this hello proves on the connection whose TLS exporter is `exporter`, from the end that dialed if
    /// `dialer`, `endpoint` being the ed25519 key the handshake proved: `None` unless the keys are a device's, their
    /// ed25519 half is `endpoint`, and the post-quantum signature checks out.
    pub fn verify(&self, exporter: &[u8; 32], dialer: bool, endpoint: &[u8; 32]) -> Option<SignerId> {
        let SignerKeys::Device { ed25519, pq } = &self.keys else { return None };
        let said = pq.verifies(&hello_message(exporter, dialer), HELLO_CONTEXT, &self.sig);
        (ed25519 == endpoint && said).then(|| self.keys.id())
    }
}

/// What a hello signs: the end it speaks for, then the exporter.
fn hello_message(exporter: &[u8; 32], dialer: bool) -> [u8; 33] {
    let mut m = [0; 33];
    m[0] = u8::from(dialer);
    m[1..].copy_from_slice(exporter);
    m
}

/// A passkey's pass for one device (P8d, P8e): the passkey's post-quantum key, its WebAuthn assertion and its
/// post-quantum signature, both over a hash of the device's id and the time the pass was made. Two take it:
///
/// - The server's relay lets the device's endpoint in for `PASS_LIFE` seconds if the passkey roots a vault the server
///   knows, or any passkey while sign-up is open: a new device with no UDP of its own, a browser's, reaches nobody but
///   through the relay. Its handshake proves the endpoint, the pass's device's ed25519 key.
/// - A peer hands the device the passkey's link card on it (`Lab::link_card`), once the device's hello proved it on
///   their connection: the pass names the device by both its keys, so whoever replays it gets nothing for anyone but
///   that device, which alone says its hello.
///
/// It is the ceremony that unlocks a new device: the device makes its secret before that ceremony, so its challenge
/// can name the device (`avendb-browser`'s `Fresh`), and the device signs up or in with one ceremony more, the one
/// that founds or joins its vault.
///
/// It names no P-256 key, which a device that didn't make the passkey can't know from one assertion. Whoever checks it
/// recovers the keys its assertion could be from, two, rarely up to four, each of them with the post-quantum key a
/// passkey that may have made it (`RelayPass::passkeys`). Only one of them is anyone's: an assertion that recovers to another
/// passkey's key is that passkey's forgery.
#[derive(Clone, PartialEq, Eq)]
pub struct RelayPass {
    /// The post-quantum key of the passkey that made it, from its PRF output.
    pub pq: PqKey,
    pub assertion: Assertion,
    /// That key's signature, as an edit's signature holds it (`Signature::pq`).
    pub sig: Vec<u8>,
    /// The device it is for, by its keys: its ed25519 half is the endpoint the pass lets in.
    pub device: SignerKeys,
    /// When it was made, by the device's clock: seconds since 1970.
    pub made: u64,
}

/// The post-quantum signature shows only its size.
impl fmt::Debug for RelayPass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayPass")
            .field("pq", &self.pq)
            .field("assertion", &self.assertion)
            .field("sig", &format!("{} bytes", self.sig.len()))
            .field("device", &self.device)
            .field("made", &self.made)
            .finish()
    }
}

/// What a pass signs with its passkey's post-quantum key (`RelayPass`), as its context string: never an edit's id, nor
/// a hello.
pub const RELAY_PASS_CONTEXT: &[u8] = b"avenDB 2026-10-10 relay pass";

/// The context of a device's post-quantum signature on its statement of its holdings (H2, `wire::Statement`): what it
/// signs counts as that statement alone, never as an edit, a hello or a pass.
pub const STATEMENT_CONTEXT: &[u8] = b"avenDB 2026-10-15 holdings statement";

/// The device whose keys `keys` are, if `sig` is their post-quantum signature on the body of a statement of holdings,
/// `body` (`wire::Statement::body`): `None` unless they are a device's keys and the signature checks out.
pub fn verify_statement(keys: &SignerKeys, body: &[u8], sig: &[u8]) -> Option<SignerId> {
    let SignerKeys::Device { pq, .. } = keys else { return None };
    pq.verifies(body, STATEMENT_CONTEXT, sig).then(|| keys.id())
}

/// How long a pass lets its device in: seconds from when it was made.
pub const PASS_LIFE: u64 = 10 * 60;

/// How far ahead of the checker's clock a pass may say it was made, as the device's clock may run fast: seconds.
pub const PASS_SKEW: u64 = 5 * 60;

impl RelayPass {
    /// The passkeys whose pass it could be, unchecked: each key its assertion recovers to, with its post-quantum key.
    /// Cheap, so that a relay asks whether it honours any of them before it checks the signatures (`passkeys`).
    pub fn candidates(&self) -> Vec<SignerId> {
        let passkey = |p256| SignerKeys::Passkey { p256, pq: self.pq }.id();
        self.assertion.recover().into_iter().map(passkey).collect()
    }

    /// The passkeys that made it for its device, checked at `now`, seconds since 1970 by the checker's clock: none
    /// unless its device's keys are a device's, it was made in the `PASS_LIFE` seconds before `now` (or at most
    /// `PASS_SKEW` after) and its post-quantum signature checks out; then each of its `candidates` whose P-256 key its
    /// assertion verifies under. Which device it is for, the checker checks: the endpoint a relay's handshake proved,
    /// or the device whose hello proved it on a connection.
    pub fn passkeys(&self, now: u64) -> Vec<SignerId> {
        let device = matches!(self.device, SignerKeys::Device { .. });
        if !device || self.made > now.saturating_add(PASS_SKEW) || now >= self.expires() {
            return vec![];
        }
        let challenge = pass_challenge(self.device.id(), self.made);
        if !self.pq.verifies(&challenge, RELAY_PASS_CONTEXT, &self.sig) {
            return vec![];
        }
        let verifies = |p256: &[u8; 33]| self.assertion.verify(p256, EditId(challenge));
        let passkey = |p256| SignerKeys::Passkey { p256, pq: self.pq }.id();
        self.assertion.recover().into_iter().filter(verifies).map(passkey).collect()
    }

    /// The endpoint it lets in: its device's ed25519 key.
    pub fn endpoint(&self) -> Option<[u8; 32]> {
        match self.device {
            SignerKeys::Device { ed25519, .. } => Some(ed25519),
            SignerKeys::Passkey { .. } | SignerKeys::Enclave { .. } => None,
        }
    }

    /// When it stops letting its device in: seconds since 1970.
    pub fn expires(&self) -> u64 {
        self.made.saturating_add(PASS_LIFE)
    }
}

/// What a pass signs: a hash of the device's id, which names both its keys, and when the pass was made. Its own hash,
/// so no edit's id is ever one. The ceremony that unlocks a new device signs it (`Ceremony::pass`).
pub fn pass_challenge(device: SignerId, made: u64) -> [u8; 32] {
    let mut h = Hasher::new("relay pass for a device");
    h.update(&device.0).update(&made.to_be_bytes());
    h.finalize()
}

/// What a signer signs to consent for good to be added as an owner (`standing`): a hash of its id alone.
/// Its own hash, so it is never an edit's id, nor a batch's, a hello's or a pass's challenge.
pub fn consent_challenge(signer: SignerId) -> [u8; 32] {
    let mut h = Hasher::new("standing consent to own");
    h.update(&signer.0);
    h.finalize()
}

/// The signers whose standing consent (`consent_challenge`) `edit` takes in place of their signature on it: those it
/// adds as owners, as the first owners of a vault it founds or the owner it shares a vault with (`Sharing::Owner`), but
/// its author and the vault's root, who sign the edit itself. Every other edit takes none: no grant, of any level.
pub fn standing(edit: &Edit) -> Vec<SignerId> {
    let added = match &edit.action {
        Action::Genesis { owners, root, .. } => owners
            .iter()
            .filter_map(|p| match p {
                Principal::Signer(s) if Some(*s) != *root => Some(*s),
                _ => None,
            })
            .collect(),
        Action::Share(Sharing::Owner { owner: Principal::Signer(s), .. }) => vec![*s],
        _ => vec![],
    };
    added.into_iter().filter(|&s| s != edit.author).collect()
}

/// What a passkey's assertion signs for several edits at once, in one ceremony (`WebAuthn::Batch`): a hash of their
/// ids, smallest first. Its own hash, so it is never an edit's id, nor a hello's or a pass's challenge, and it names
/// exactly these edits: the assertion counts for each of them, and for no other.
pub fn batch_challenge(edits: &[EditId]) -> [u8; 32] {
    let mut h = Hasher::new("op batch");
    for edit in edits {
        h.update(&edit.0);
    }
    h.finalize()
}

/// `sig` is `signer`'s signature on edit `edit`: its keys hash to the signer, its post-quantum signature verifies, and
/// a passkey's assertion or a Touch ID key's Enclave signature verifies too, where a device's carries neither. A Touch
/// ID key without an SLH-DSA key signs with its Enclave alone, and carries no other signature.
pub fn verify(signer: SignerId, edit: EditId, sig: &Signature) -> bool {
    verify_adding(signer, edit, sig, None)
}

/// `verify`, on an edit that adds device `joins` to a vault, which it cosigns (`Sharing::Device`), if it is one:
/// there a passkey's pass for that device (`WebAuthn::Pass`) is its assertion too.
pub fn verify_adding(signer: SignerId, edit: EditId, sig: &Signature, joins: Option<SignerId>) -> bool {
    if sig.keys.id() != signer {
        return false;
    }
    let present = match (&sig.keys, &sig.webauthn, &sig.enclave) {
        (SignerKeys::Device { .. }, None, None) => true,
        (SignerKeys::Passkey { p256, .. }, Some(WebAuthn::Edit(a)), None) => a.verify(p256, edit),
        (SignerKeys::Passkey { p256, .. }, Some(WebAuthn::Batch { assertion, edits }), None) => {
            let set = edits.windows(2).all(|w| w[0] < w[1]);
            set && edits.contains(&edit) && assertion.verify(p256, EditId(batch_challenge(edits)))
        }
        (SignerKeys::Passkey { p256, .. }, Some(WebAuthn::Pass { assertion, made }), None) => match joins {
            Some(device) => assertion.verify(p256, EditId(pass_challenge(device, *made))),
            None => false,
        },
        (SignerKeys::Enclave { mldsa, .. }, None, Some(e)) => e.verify(mldsa, edit),
        _ => false,
    };
    present
        && match sig.keys.pq() {
            Some(pq) => pq.verifies(&edit.0, SIG_CONTEXT, &sig.pq),
            None => sig.pq.is_empty(),
        }
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

impl Assertion {
    /// A real assertion by the passkey `key` over `edit`: the client data is a `webauthn.get` for this edit from one of
    /// our origins, not in a frame of another, the authenticator data is for our relying party with the user present
    /// and verified (`relying_party`), and the signature checks out.
    pub fn verify(&self, key: &[u8; 33], edit: EditId) -> bool {
        let Ok(serde_json::Value::Object(client)) = serde_json::from_slice(&self.client_data_json) else { return false };
        let text = |k: &str| client.get(k).and_then(|v| v.as_str());
        if text("type") != Some("webauthn.get") || text("challenge") != Some(&base64url(&edit.0)) {
            return false;
        }
        if client.get("crossOrigin").and_then(|v| v.as_bool()) == Some(true) {
            return false;
        }
        let data = &self.authenticator_data;
        let ours = text("origin").is_some_and(|o| data.len() >= 37 && relying_party(o, &data[..32]));
        if !ours || data[32] & (UP | UV) != UP | UV {
            return false;
        }
        let Ok(key) = p256::ecdsa::VerifyingKey::from_sec1_bytes(key) else { return false };
        let Ok(sig) = p256::ecdsa::Signature::from_der(&self.signature) else { return false };
        let signed = [&data[..], &sha256(&self.client_data_json)].concat();
        key.verify(&signed, &sig).is_ok()
    }

    /// The P-256 keys whose signature it could be: an ECDSA signature recovers to two keys, rarely up to four, and it
    /// verifies under each, the passkey's among them. A device that didn't see the passkey made learns its key from
    /// the passkey's next ceremony: the one of these keys that ceremony's assertion verifies under too.
    pub fn recover(&self) -> Vec<[u8; 33]> {
        let Ok(sig) = p256::ecdsa::Signature::from_der(&self.signature) else { return vec![] };
        let prehash = sha256(&[&self.authenticator_data[..], &sha256(&self.client_data_json)].concat());
        let mut keys: Vec<[u8; 33]> = vec![];
        for id in (0..=p256::ecdsa::RecoveryId::MAX).filter_map(|b| p256::ecdsa::RecoveryId::try_from(b).ok()) {
            let Ok(key) = p256::ecdsa::VerifyingKey::recover_from_prehash(&prehash, &sig, id) else { continue };
            let key: [u8; 33] = key.to_sec1_point(true).as_bytes().try_into().expect("33 bytes");
            if !keys.contains(&key) {
                keys.push(key);
            }
        }
        keys
    }
}

/// A passkey's P-256 key, SEC1 compressed, from its SubjectPublicKeyInfo in DER, as `navigator.credentials.create`
/// hands it out (`AuthenticatorAttestationResponse.getPublicKey`): `None` unless it is a P-256 key.
pub fn spki_p256(spki: &[u8]) -> Option<[u8; 33]> {
    // SEQUENCE { SEQUENCE { id-ecPublicKey, prime256v1 }, BIT STRING { 0 unused bits, then the point, uncompressed } }
    const PREFIX: [u8; 26] = [
        0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, //
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
    ];
    let point = spki.strip_prefix(&PREFIX[..]).filter(|p| p.len() == 65 && p[0] == 4)?;
    let key = p256::ecdsa::VerifyingKey::from_sec1_bytes(point).ok()?;
    key.to_sec1_point(true).as_bytes().try_into().ok()
}

/// What an owner key's ceremony brings back: a passkey's WebAuthn ceremony (P8e), `navigator.credentials.get`'s
/// assertion over a challenge and the passkey's PRF output on `PRF_SALT` from the same ceremony; or a Touch ID key's,
/// its Secure Enclave's ML-DSA-65 signature over a challenge and the secret the Enclave sealed, opened by the same
/// touch. The key's hash-based key and the key sealed to it derive from that output or secret, so a device holds them
/// only while it holds the ceremony, and they are wiped with it. A browser's authenticator or a Mac's Enclave makes
/// one; a software passkey or Touch ID key makes one the same way (`Passkey::ceremony`, `EnclaveKey::ceremony`).
pub struct Ceremony {
    proof: Proof,
    /// A passkey's PRF output, or a Touch ID key's secret.
    secret: Zeroizing<[u8; 32]>,
}

/// What proves a ceremony's key took part in it: a passkey's assertion, or a Touch ID key's ML-DSA-65 key with its
/// Secure Enclave's signature over the ceremony's challenge.
#[derive(Clone, Debug)]
enum Proof {
    WebAuthn(Assertion),
    Enclave { public: Vec<u8>, sig: Vec<u8>, challenge: [u8; 32] },
}

impl ZeroizeOnDrop for Ceremony {}

/// The PRF output or the secret shows nowhere.
impl fmt::Debug for Ceremony {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Ceremony").field("proof", &self.proof).finish_non_exhaustive()
    }
}

impl Ceremony {
    /// A passkey's ceremony: its assertion, and the PRF output on `PRF_SALT` it brought.
    pub fn new(assertion: Assertion, prf: [u8; 32]) -> Ceremony {
        Ceremony { proof: Proof::WebAuthn(assertion), secret: Zeroizing::new(prf) }
    }

    /// A Touch ID key's ceremony over `challenge`: its ML-DSA-65 key `public`, its Secure Enclave's signature `sig`
    /// over the challenge (`ENCLAVE_CONTEXT`), and the secret the Enclave sealed, which the same touch opened.
    pub fn enclave(public: Vec<u8>, sig: Vec<u8>, challenge: [u8; 32], secret: [u8; 32]) -> Ceremony {
        Ceremony { proof: Proof::Enclave { public, sig, challenge }, secret: Zeroizing::new(secret) }
    }

    /// A passkey's assertion: `None` for a Touch ID key's ceremony.
    pub fn assertion(&self) -> Option<&Assertion> {
        match &self.proof {
            Proof::WebAuthn(a) => Some(a),
            Proof::Enclave { .. } => None,
        }
    }

    /// The challenge it signed: as a passkey's client data says, `None` unless that is 32 bytes; a Touch ID key's.
    pub fn challenge(&self) -> Option<[u8; 32]> {
        match &self.proof {
            Proof::WebAuthn(a) => {
                let client: serde_json::Value = serde_json::from_slice(&a.client_data_json).ok()?;
                unbase64url(client.get("challenge")?.as_str()?)?.try_into().ok()
            }
            Proof::Enclave { challenge, .. } => Some(*challenge),
        }
    }

    /// The keys of its passkey, whose P-256 key is `p256`, in the suite new signers are made in (`SIGNING`); or of its
    /// Touch ID key (`p256` unread).
    pub fn keys(&self, p256: [u8; 33]) -> SignerKeys {
        self.keys_in(p256, SIGNING)
    }

    /// The keys of its passkey, whose P-256 key is `p256`, in suite `suite`: the post-quantum key derived from the PRF
    /// output; or of its Touch ID key, the Enclave's key and, in SLH-DSA's suite, the SLH-DSA key derived from its
    /// secret (`p256` unread).
    pub fn keys_in(&self, p256: [u8; 33], suite: Suite) -> SignerKeys {
        match &self.proof {
            Proof::WebAuthn(_) => SignerKeys::Passkey { p256, pq: PqSigner::derive(suite, "passkey", &self.secret).public() },
            Proof::Enclave { public, .. } => {
                let slh = (suite == Suite::SlhDsa).then(|| slh_public(&slh_key("enclave slh-dsa key", &self.secret)));
                SignerKeys::Enclave { mldsa: enclave_key(public), slh }
            }
        }
    }

    /// The keys of its passkey, whose P-256 key is `p256`, in whichever suite they are signer `id`'s: `None` if neither.
    pub fn keys_of(&self, p256: [u8; 33], id: SignerId) -> Option<SignerKeys> {
        SUITES.into_iter().map(|suite| self.keys_in(p256, suite)).find(|k| k.id() == id)
    }

    /// The keys of its Touch ID key, in the suite new signers are made in: `None` for a passkey's ceremony, whose P-256
    /// key it doesn't say (`keys`).
    pub fn enclave_keys(&self) -> Option<SignerKeys> {
        matches!(self.proof, Proof::Enclave { .. }).then(|| self.keys([0; 33]))
    }

    /// It is a ceremony of the Touch ID key whose keys are `keys`, in either suite: its Enclave's key is theirs, and, in
    /// SLH-DSA's suite, its secret derives their SLH-DSA key.
    pub fn is_enclave_of(&self, keys: &SignerKeys) -> bool {
        let SignerKeys::Enclave { slh, .. } = keys else { return false };
        let suite = if slh.is_some() { Suite::SlhDsa } else { Suite::MlDsa };
        matches!(self.proof, Proof::Enclave { .. }) && self.keys_in([0; 33], suite) == *keys
    }

    /// Its key's post-quantum key, if it is a ceremony over `challenge` of the owner key whose keys are `keys`: its PRF
    /// output or secret derives their post-quantum key in their suite, and a passkey's assertion verifies under their
    /// P-256 key, a Touch ID key's Enclave signature under the ML-DSA-65 key they name. `Some(None)` for a Touch ID key
    /// whose Enclave's signature is its whole signature.
    fn of(&self, keys: &SignerKeys, challenge: [u8; 32]) -> Option<Option<PqSigner>> {
        let (proved, purpose) = match (keys, &self.proof) {
            (SignerKeys::Passkey { p256, .. }, Proof::WebAuthn(a)) => (a.verify(p256, EditId(challenge)), "passkey"),
            (SignerKeys::Enclave { mldsa, .. }, Proof::Enclave { public, sig, challenge: c }) => {
                let proved = *c == challenge
                    && enclave_key(public) == *mldsa
                    && verify_mldsa(public, c, ENCLAVE_CONTEXT, sig);
                (proved, "enclave")
            }
            _ => (false, ""),
        };
        if !proved {
            return None;
        }
        let Some(pq) = keys.pq() else { return Some(None) };
        let key = PqSigner::derive(pq.suite(), purpose, &self.secret);
        (key.public() == pq).then_some(Some(key))
    }

    /// Its proof on a signature on edit `edit`, `batch` the ids of the edits it signs together, empty for the edit
    /// alone: the assertion (`WebAuthn::Edit`, `WebAuthn::Batch`), or the Enclave's signature (`EnclaveSig`).
    fn proof(&self, batch: &[EditId]) -> (Option<WebAuthn>, Option<EnclaveSig>) {
        match &self.proof {
            Proof::WebAuthn(a) if batch.is_empty() => (Some(WebAuthn::Edit(a.clone())), None),
            Proof::WebAuthn(a) => (Some(WebAuthn::Batch { assertion: a.clone(), edits: batch.to_vec() }), None),
            Proof::Enclave { public, sig, .. } => {
                (None, Some(EnclaveSig { public: public.clone(), sig: sig.clone(), edits: batch.to_vec() }))
            }
        }
    }

    /// The signature on edit `edit` of the owner key whose keys are `keys`: the post-quantum signature over the edit's
    /// id, with the assertion or the Enclave's signature beside it. `None` unless this is that key's ceremony over the
    /// edit's id.
    pub fn sign(&self, keys: SignerKeys, edit: EditId) -> Option<Signature> {
        let key = self.of(&keys, edit.0)?;
        let (webauthn, enclave) = self.proof(&[]);
        Some(Signature { keys, webauthn, enclave, pq: sign_pq(key.as_ref(), edit) })
    }

    /// The same, for edit `edit` among the edits `batch` this ceremony signs together, their ids smallest first: the
    /// post-quantum signature over the edit's own id, beside the assertion or the Enclave's signature over their
    /// `batch_challenge` (`WebAuthn::Batch`, `EnclaveSig::edits`). An empty `batch` is the edit alone (`sign`). `None`
    /// unless the edit is among them and this is that key's ceremony over their batch.
    pub fn sign_in(&self, keys: SignerKeys, edit: EditId, batch: &[EditId]) -> Option<Signature> {
        if batch.is_empty() {
            return self.sign(keys, edit);
        }
        if !batch.contains(&edit) || !batch.windows(2).all(|w| w[0] < w[1]) {
            return None;
        }
        let key = self.of(&keys, batch_challenge(batch))?;
        let (webauthn, enclave) = self.proof(batch);
        Some(Signature { keys, webauthn, enclave, pq: sign_pq(key.as_ref(), edit) })
    }

    /// The signature on edit `edit`, which adds the device `device` to a vault (`Sharing::Device`), of the passkey
    /// whose keys are `keys`, as this ceremony is that passkey's pass for the device, made at `made` (`pass`): the
    /// post-quantum signature over the edit's own id, beside the pass's assertion (`WebAuthn::Pass`). So the ceremony
    /// that unlocks a new device also signs the edit adding it, and the device signs in with one ceremony. `None` unless
    /// this is that passkey's ceremony over the device's `pass_challenge`.
    pub fn sign_adding(&self, keys: SignerKeys, edit: EditId, device: SignerId, made: u64) -> Option<Signature> {
        let assertion = self.assertion()?.clone();
        let key = self.of(&keys, pass_challenge(device, made))?;
        let webauthn = WebAuthn::Pass { assertion, made };
        Some(Signature { keys, webauthn: Some(webauthn), enclave: None, pq: sign_pq(key.as_ref(), edit) })
    }

    /// Its passkey's pass (`RelayPass`) for the device whose keys are `device`, made at `made`, signed by its
    /// post-quantum key in the suite new signers are made in: `None` unless they are a device's and this is a
    /// passkey's ceremony over their `pass_challenge`, as the one that unlocks a new device is.
    pub fn pass(&self, device: SignerKeys, made: u64) -> Option<RelayPass> {
        self.pass_in(device, made, SIGNING)
    }

    /// Its passkey's pass for the device whose keys are `device`, made at `made`, in each suite, the one new signers
    /// are made in first (`SUITES`): a new device doesn't know which suite its person's vault knows their passkey in
    /// (the key move), so it shows both (`avendb_net::passes_token`, `avendb_net::Node::link_by_pass`). Empty unless
    /// they are a device's and this is a passkey's ceremony over their `pass_challenge`.
    pub fn passes(&self, device: SignerKeys, made: u64) -> Vec<RelayPass> {
        SUITES.into_iter().filter_map(|suite| self.pass_in(device, made, suite)).collect()
    }

    /// `pass`, signed by its passkey's post-quantum key in suite `suite`.
    pub fn pass_in(&self, device: SignerKeys, made: u64, suite: Suite) -> Option<RelayPass> {
        let assertion = self.assertion()?.clone();
        if !matches!(device, SignerKeys::Device { .. }) {
            return None;
        }
        let challenge = pass_challenge(device.id(), made);
        if self.challenge() != Some(challenge) {
            return None;
        }
        let key = PqSigner::derive(suite, "passkey", &self.secret);
        Some(RelayPass { pq: key.public(), assertion, sig: key.sign(&challenge, RELAY_PASS_CONTEXT), device, made })
    }

    /// The key keys are sealed to for its owner key, from the PRF output or the secret: what the key lends a device
    /// for the ceremony.
    pub fn seal_secret(&self) -> Secret {
        match self.proof {
            Proof::WebAuthn(_) => Secret::derive("passkey seal key", &self.secret),
            Proof::Enclave { .. } => Secret::derive("enclave seal key", &self.secret),
        }
    }

    /// What a Touch ID key's ceremony masks its Mac's device secret with, derived from the secret the same touch
    /// opened, as a passkey's PRF output on the device's salt masks it: so a touch opens the Mac's device at every start
    /// of its app, with no passkey. `None` for a passkey's ceremony.
    pub fn device_mask(&self) -> Option<Zeroizing<[u8; 32]>> {
        matches!(self.proof, Proof::Enclave { .. })
            .then(|| Zeroizing::new(hash::keyed(&self.secret, "enclave device mask", b"")))
    }
}

/// An assertion made at `origin` for the relying party whose id hashes to `rp` is ours: maia.city's, from `ORIGIN`;
/// or, in a build for the tests with the feature `localhost-passkeys`, localhost's, from a page on it.
fn relying_party(origin: &str, rp: &[u8]) -> bool {
    if origin == ORIGIN {
        return rp == sha256(RP_ID.as_bytes());
    }
    #[cfg(feature = "localhost-passkeys")]
    {
        let port = |p: &str| !p.is_empty() && p.len() <= 5 && p.bytes().all(|b| b.is_ascii_digit());
        if origin == "http://localhost" || origin.strip_prefix("http://localhost:").is_some_and(port) {
            return rp == sha256(TEST_RP_ID.as_bytes());
        }
    }
    false
}

/// base64url without padding, as WebAuthn encodes the challenge.
pub fn base64url(bytes: &[u8]) -> String {
    const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().enumerate().fold(0u32, |n, (i, &b)| n | (b as u32) << (16 - 8 * i));
        for i in 0..=chunk.len() {
            s.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    s
}

/// The bytes `text` encodes in base64url without padding (`base64url`): `None` if it is no such text.
pub fn unbase64url(text: &str) -> Option<Vec<u8>> {
    let digit = |c: u8| match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'-' => Some(62),
        b'_' => Some(63),
        _ => None,
    };
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    for chunk in text.as_bytes().chunks(4) {
        if chunk.len() == 1 {
            return None;
        }
        let n = chunk.iter().enumerate().try_fold(0u32, |n, (i, &c)| Some(n | u32::from(digit(c)?) << (18 - 6 * i)))?;
        let bytes = n.to_be_bytes();
        out.extend_from_slice(&bytes[1..chunk.len()]);
        // the bits a shorter last chunk leaves over are zero, as `base64url` writes it
        if chunk.len() < 4 && (n << (8 * (chunk.len() - 1))) & 0x00ff_ffff != 0 {
            return None;
        }
    }
    Some(out)
}

/// An SLH-DSA key from 32 secret bytes: its three 16-byte seeds read from a hash of them.
fn slh_key(purpose: &str, secret: &[u8; 32]) -> slh_dsa::SigningKey<Sha2_128f> {
    let mut h = Hasher::new(purpose);
    h.update(secret);
    let seeds: Zeroizing<[u8; 48]> = Zeroizing::new(h.reader().array());
    slh_dsa::SigningKey::slh_keygen_internal(&seeds[..16], &seeds[16..32], &seeds[32..])
}

fn slh_public(key: &slh_dsa::SigningKey<Sha2_128f>) -> [u8; 32] {
    key.verifying_key().to_bytes().into()
}

/// An ML-DSA-65 key from 32 secret bytes: its seed, a hash of them.
fn ml_key(purpose: &str, secret: &[u8; 32]) -> ml_dsa::SigningKey<ml_dsa::MlDsa65> {
    let seed = Zeroizing::new(hash::keyed(secret, purpose, b""));
    ml_dsa::SigningKey::from_seed(&(*seed).into())
}

/// The post-quantum signature on edit `edit` of `key`, as `Signature::pq` holds it: none where a Touch ID key's Enclave
/// signs alone.
fn sign_pq(key: Option<&PqSigner>, edit: EditId) -> Vec<u8> {
    key.map_or(vec![], |key| key.sign(&edit.0, SIG_CONTEXT))
}

/// A post-quantum key that signs, in either suite, as a device, a passkey or a Touch ID key made before the key move
/// derives it. It wipes itself as it is dropped.
enum PqSigner {
    Slh(slh_dsa::SigningKey<Sha2_128f>),
    MlDsa(ml_dsa::SigningKey<ml_dsa::MlDsa65>),
}

impl ZeroizeOnDrop for PqSigner {}

impl PqSigner {
    /// The key in suite `suite` that 32 secret bytes derive for a signer of kind `kind` (`device`, `passkey`,
    /// `enclave`).
    fn derive(suite: Suite, kind: &str, secret: &[u8; 32]) -> Self {
        match suite {
            Suite::SlhDsa => PqSigner::Slh(slh_key(&format!("{kind} slh-dsa key"), secret)),
            Suite::MlDsa => PqSigner::MlDsa(ml_key(&format!("{kind} ml-dsa-65 key"), secret)),
        }
    }

    fn public(&self) -> PqKey {
        match self {
            PqSigner::Slh(key) => PqKey::Slh(slh_public(key)),
            PqSigner::MlDsa(key) => PqKey::MlDsa(ml_dsa_key(&key.verifying_key().encode())),
        }
    }

    /// Its signature on `message`, with the context string `context`, as `Signature::pq` holds it: SLH-DSA's, or the
    /// ML-DSA-65 key followed by its signature, which is deterministic.
    fn sign(&self, message: &[u8], context: &[u8]) -> Vec<u8> {
        match self {
            PqSigner::Slh(key) => {
                key.try_sign_with_context(message, context, None).expect("a short context").to_vec()
            }
            PqSigner::MlDsa(key) => {
                let sig = key.expanded_key().sign_deterministic(message, context).expect("a short context");
                [&key.verifying_key().encode()[..], &sig.encode()[..]].concat()
            }
        }
    }
}

/// A device's keys: its post-quantum key, which signs; ed25519, the same key as its iroh endpoint, so a connection
/// proves which device is talking; and the key keys are sealed to for it. All three derive from 32 secret bytes, and
/// each wipes itself as it is dropped.
pub struct DeviceKey {
    ed25519: ed25519_dalek::SigningKey,
    pq: PqSigner,
    seal: Secret,
}

impl ZeroizeOnDrop for DeviceKey {}

/// Compiles only while every key a `DeviceKey`, a `Passkey` or an `EnclaveKey` holds wipes itself as it is dropped, as their
/// `ZeroizeOnDrop` says.
const _: fn() = || {
    fn wipes<T: ZeroizeOnDrop>() {}
    wipes::<ed25519_dalek::SigningKey>();
    wipes::<slh_dsa::SigningKey<Sha2_128f>>();
    wipes::<p256::ecdsa::SigningKey>();
    wipes::<ml_dsa::SigningKey<ml_dsa::MlDsa65>>();
    wipes::<Secret>();
};

impl DeviceKey {
    /// A device's keys from 32 secret bytes, in the suite new signers are made in (`SIGNING`): its passkey's PRF output
    /// on the device's salt (`Passkey::device`), or, for the server, bytes of its own.
    pub fn from_secret(secret: [u8; 32]) -> Self {
        Self::from_secret_in(secret, SIGNING)
    }

    /// A device's keys from 32 secret bytes, in suite `suite`. Its ed25519 key and the key sealed to it are the same in
    /// either suite.
    pub fn from_secret_in(secret: [u8; 32], suite: Suite) -> Self {
        let secret = Zeroizing::new(secret);
        let ed25519 = Zeroizing::new(hash::keyed(&secret, "device ed25519 key", b""));
        Self {
            ed25519: ed25519_dalek::SigningKey::from_bytes(&ed25519),
            pq: PqSigner::derive(suite, "device", &secret),
            seal: Secret::derive("device seal key", &secret),
        }
    }

    /// The keys of device `id` from 32 secret bytes, in whichever suite they are its: `None` if neither.
    pub fn of(secret: [u8; 32], id: SignerId) -> Option<Self> {
        SUITES.into_iter().map(|suite| Self::from_secret_in(secret, suite)).find(|k| k.id() == id)
    }

    pub fn keys(&self) -> SignerKeys {
        SignerKeys::Device { ed25519: self.ed25519.verifying_key().to_bytes(), pq: self.pq.public() }
    }

    pub fn id(&self) -> SignerId {
        self.keys().id()
    }

    /// The device's signature on edit `edit`: its post-quantum key's over its id.
    pub fn sign(&self, edit: EditId) -> Signature {
        Signature { keys: self.keys(), webauthn: None, enclave: None, pq: sign_pq(Some(&self.pq), edit) }
    }

    /// The device's hello on the connection whose TLS exporter is `exporter`, speaking for the end that dialed if
    /// `dialer`.
    pub fn hello(&self, exporter: &[u8; 32], dialer: bool) -> Hello {
        Hello { keys: self.keys(), sig: self.pq.sign(&hello_message(exporter, dialer), HELLO_CONTEXT) }
    }

    /// The device's post-quantum signature on `body`, the body of its statement of its holdings
    /// (`wire::Statement::body`).
    pub fn state(&self, body: &[u8]) -> Vec<u8> {
        self.pq.sign(body, STATEMENT_CONTEXT)
    }

    /// The secret of the device's iroh endpoint: its ed25519 key's, as iroh takes it.
    pub fn endpoint_secret(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.ed25519.to_bytes())
    }

    /// The key keys are sealed to for this device.
    pub fn seal_secret(&self) -> Secret {
        self.seal.clone()
    }
}

/// A passkey as the Lab and the tests hold it: a software authenticator answering `navigator.credentials.get` with
/// the user present and verified, and the PRF extension. A real one lives in the platform's keychain and signs the
/// same way. Its keys wipe themselves as it is dropped.
pub struct Passkey {
    key: p256::ecdsa::SigningKey,
    counter: u32,
    /// The post-quantum key, derived from the PRF output on `PRF_SALT`, as the app derives it in every ceremony.
    pq: PqSigner,
}

impl ZeroizeOnDrop for Passkey {}

impl Passkey {
    /// A passkey whose private key derives from `seed`, in the suite new signers are made in (`SIGNING`).
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self::from_seed_in(seed, SIGNING)
    }

    /// A passkey whose private key derives from `seed`, its post-quantum key in suite `suite`: the same passkey in
    /// either suite, as one authenticator's PRF output derives both keys.
    pub fn from_seed_in(seed: [u8; 32], suite: Suite) -> Self {
        let mut bytes = Zeroizing::new(seed);
        let key = loop {
            // a seed outside the curve's scalar range is about 2^-32 likely; hash on until one fits
            if let Ok(key) = p256::ecdsa::SigningKey::from_slice(&*bytes) {
                break key;
            }
            *bytes = hash::hash("software passkey seed", &*bytes);
        };
        let pq = PqSigner::derive(suite, "passkey", &prf(&key, PRF_SALT));
        Self { key, counter: 0, pq }
    }

    /// Its post-quantum key's suite.
    pub fn suite(&self) -> Suite {
        self.pq.public().suite()
    }

    /// The P-256 public key, SEC1 compressed.
    pub fn public(&self) -> [u8; 33] {
        let point = self.key.verifying_key().to_sec1_point(true);
        point.as_bytes().try_into().expect("33 bytes")
    }

    pub fn keys(&self) -> SignerKeys {
        SignerKeys::Passkey { p256: self.public(), pq: self.pq.public() }
    }

    pub fn id(&self) -> SignerId {
        self.keys().id()
    }

    /// The passkey's signature on edit `edit`, made in a ceremony at `origin`: its post-quantum key's over its id, and
    /// the assertion.
    pub fn sign_at(&mut self, edit: EditId, origin: &str) -> Signature {
        use p256::ecdsa::signature::Signer as _;
        self.counter += 1;
        let mut data = sha256(RP_ID.as_bytes()).to_vec();
        data.push(UP | UV);
        data.extend_from_slice(&self.counter.to_be_bytes());
        let client = serde_json::json!({ "type": "webauthn.get", "challenge": base64url(&edit.0), "origin": origin, "crossOrigin": false });
        let client_data_json = serde_json::to_vec(&client).expect("JSON");
        let signed = [&data[..], &sha256(&client_data_json)].concat();
        let sig: p256::ecdsa::Signature = self.key.sign(&signed);
        let assertion =
            Assertion { authenticator_data: data, client_data_json, signature: sig.to_der().as_bytes().to_vec() };
        let webauthn = Some(WebAuthn::Edit(assertion));
        Signature { keys: self.keys(), webauthn, enclave: None, pq: sign_pq(Some(&self.pq), edit) }
    }

    /// The passkey's signature on edit `edit`, made on the website.
    pub fn sign(&mut self, edit: EditId) -> Signature {
        self.sign_at(edit, ORIGIN)
    }

    /// The passkey's standing consent to be added as an owner (`standing`): its signature over its consent challenge.
    pub fn consent(&mut self) -> Signature {
        self.sign(EditId(consent_challenge(self.id())))
    }

    /// The passkey's ceremony over `challenge`, on the website (`Ceremony`): an assertion, and the PRF output on
    /// `PRF_SALT`, as a browser's authenticator answers `navigator.credentials.get` with the PRF extension.
    pub fn ceremony(&mut self, challenge: [u8; 32]) -> Ceremony {
        let Some(WebAuthn::Edit(assertion)) = self.sign(EditId(challenge)).webauthn else {
            unreachable!("a passkey signs by assertion")
        };
        Ceremony::new(assertion, *self.prf(PRF_SALT))
    }

    /// The passkey's pass for the device whose keys are `device`, made at `made`, seconds since 1970 (`RelayPass`): an
    /// assertion and the post-quantum signature, in one ceremony.
    pub fn pass(&mut self, device: SignerKeys, made: u64) -> RelayPass {
        let ceremony = self.ceremony(pass_challenge(device.id(), made));
        ceremony.pass_in(device, made, self.suite()).expect("its own ceremony, for a device")
    }

    /// Its private key: the seed `from_seed` makes the same passkey again from, as a platform syncs a passkey between
    /// its person's devices. The Lab hands a software passkey to a page this way (`Lab::passkey_secret`); a real one
    /// never leaves its authenticator or the platform's keychain.
    pub fn secret(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.key.to_bytes().into())
    }

    /// WebAuthn's PRF extension: 32 bytes the authenticator alone computes from `salt`, in the same ceremony as an
    /// assertion. The browser hashes the salt with the label "WebAuthn PRF" and the authenticator answers with its
    /// `hmac-secret` over that hash; this one uses a keyed BLAKE3 hash with a secret of its own instead of HMAC.
    pub fn prf(&self, salt: &[u8]) -> Zeroizing<[u8; 32]> {
        prf(&self.key, salt)
    }

    /// The key keys are sealed to for this passkey, derived from its PRF output on `PRF_SALT`: a device that uses the
    /// passkey can open what is sealed to it, during that ceremony.
    pub fn seal_secret(&self) -> Secret {
        Secret::derive("passkey seal key", &self.prf(PRF_SALT))
    }

    /// The keys of the device whose salt ends in `nonce`, derived from the passkey's PRF output on that salt, as the
    /// device derives them at every unlock, in the passkey's suite.
    pub fn device(&self, nonce: [u8; 32]) -> DeviceKey {
        DeviceKey::from_secret_in(*self.prf(&device_salt(&nonce)), self.suite())
    }
}

/// The software passkey `key`'s PRF output on `salt` (`Passkey::prf`).
fn prf(key: &p256::ecdsa::SigningKey, salt: &[u8]) -> Zeroizing<[u8; 32]> {
    let hashed = sha256(&[&b"WebAuthn PRF\0"[..], salt].concat());
    let scalar: Zeroizing<[u8; 32]> = Zeroizing::new(key.to_bytes().into());
    let cred_random = Zeroizing::new(hash::keyed(&scalar, "software passkey credential", b""));
    Zeroizing::new(hash::keyed(&cred_random, "software passkey prf", &hashed))
}

/// A Touch ID key as the Lab and the tests hold it: a software Secure Enclave, whose ML-DSA-65 key signs a ceremony's
/// challenge and whose secret the same touch opens. A real one lives in a Mac's Secure Enclave, which signs with its
/// key and opens the secret sealed to it only after a touch, and never hands either out. Its keys wipe themselves as
/// it is dropped.
pub struct EnclaveKey {
    mldsa: ml_dsa::SigningKey<ml_dsa::MlDsa65>,
    secret: Zeroizing<[u8; 32]>,
    /// Its keys' suite: in SLH-DSA's, an SLH-DSA key derived from the secret signs beside the Enclave.
    suite: Suite,
}

impl ZeroizeOnDrop for EnclaveKey {}

impl EnclaveKey {
    /// A Touch ID key whose ML-DSA-65 key and secret derive from `seed`, in the suite new signers are made in
    /// (`SIGNING`).
    pub fn from_seed(seed: [u8; 32]) -> Self {
        Self::from_seed_in(seed, SIGNING)
    }

    /// A Touch ID key whose ML-DSA-65 key and secret derive from `seed`, in suite `suite`.
    pub fn from_seed_in(seed: [u8; 32], suite: Suite) -> Self {
        let seed = Zeroizing::new(seed);
        let mldsa = Zeroizing::new(hash::keyed(&seed, "software enclave ml-dsa key", b""));
        let secret = Zeroizing::new(hash::keyed(&seed, "software enclave secret", b""));
        Self { mldsa: ml_dsa::SigningKey::from_seed(&(*mldsa).into()), secret, suite }
    }

    /// Its ML-DSA-65 public key, as FIPS 204 encodes it.
    pub fn public(&self) -> Vec<u8> {
        self.mldsa.verifying_key().encode().to_vec()
    }

    pub fn keys(&self) -> SignerKeys {
        let slh = (self.suite == Suite::SlhDsa).then(|| slh_public(&slh_key("enclave slh-dsa key", &self.secret)));
        SignerKeys::Enclave { mldsa: enclave_key(&self.public()), slh }
    }

    pub fn id(&self) -> SignerId {
        self.keys().id()
    }

    /// Its ceremony over `challenge` (`Ceremony::enclave`): the Enclave's signature over it, and the secret, as one
    /// touch brings both.
    pub fn ceremony(&self, challenge: [u8; 32]) -> Ceremony {
        let (sig, secret) = self.touched(challenge);
        Ceremony::enclave(self.public(), sig, challenge, *secret)
    }

    /// What its Enclave hands back for one touch over `challenge`, as a Mac app hands it to its device: the ML-DSA-65
    /// signature over the challenge (`ENCLAVE_CONTEXT`), and the secret the touch opened.
    pub fn touched(&self, challenge: [u8; 32]) -> (Vec<u8>, Zeroizing<[u8; 32]>) {
        let sig = self.mldsa.expanded_key().sign_deterministic(&challenge, ENCLAVE_CONTEXT).expect("a short context");
        (sig.encode().to_vec(), self.secret.clone())
    }

    /// Its signature on edit `edit`, made in a ceremony over the edit's id.
    pub fn sign(&self, edit: EditId) -> Signature {
        self.ceremony(edit.0).sign(self.keys(), edit).expect("its own ceremony")
    }

    /// Its standing consent to be added as an owner (`standing`): its signature over its consent challenge.
    pub fn consent(&self) -> Signature {
        self.sign(EditId(consent_challenge(self.id())))
    }

    /// The key keys are sealed to for it, derived from its secret, as its ceremonies lend it (`Ceremony::seal_secret`).
    pub fn seal_secret(&self) -> Secret {
        Secret::derive("enclave seal key", &self.secret)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::VaultId;
    use crate::policy::{Kind, Level, Principal, Revoking, Setting, Share, Who};

    fn edit(author: SignerId, cosigners: Vec<SignerId>) -> Edit {
        let action =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(author)], threshold: 1, root: Some(author), nonce: 0, seal_to: vec![] };
        Edit { parents: vec![], depth: 0, author, cosigners, action }
    }

    fn write(author: SignerId) -> Edit {
        let action = Action::Write {
            vault: VaultId::from_u64(1),
            entry: EntryId::from_u64(1),
            actor: VaultId::from_u64(1),
            stay: None,
            epoch: 0,
            deps: vec![],
            proposal: crate::policy::Proposal::Main,
            via: vec![],
            create: None,
            files: vec![],
            body: vec![1, 2, 3],
        };
        Edit { parents: vec![], depth: 0, author, cosigners: vec![], action }
    }

    #[test]
    fn base64url_matches_the_rfc_vectors() {
        // RFC 4648 section 10, in the URL alphabet without padding
        for (plain, encoded) in [("", ""), ("f", "Zg"), ("fo", "Zm8"), ("foo", "Zm9v"), ("foob", "Zm9vYg"), ("fooba", "Zm9vYmE"), ("foobar", "Zm9vYmFy")] {
            assert_eq!(base64url(plain.as_bytes()), encoded);
        }
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn a_standing_consent_counts_only_where_its_signer_is_added() {
        let (mut owner, mut master) = (Passkey::from_seed([1; 32]), Passkey::from_seed([2; 32]));
        let mut other = Passkey::from_seed([3; 32]);
        let (o, m, device) = (owner.id(), master.id(), DeviceKey::from_secret([4; 32]).id());
        let consent = master.consent();
        let mut signed = |edit: Edit, consent: &Signature| {
            let own = owner.sign(edit.id());
            let sigs = if edit.author == o { vec![own, consent.clone()] } else { vec![consent.clone(), own] };
            Signed { edit, sigs }.verify().map(|_| ())
        };
        let genesis = |owners: &[SignerId], root| Action::Genesis {
            kind: Kind::Human,
            owners: owners.iter().map(|&s| Principal::Signer(s)).collect(),
            threshold: 1,
            root,
            nonce: 0,
            seal_to: vec![],
        };
        let by = |author, action| {
            let cosigners = vec![if author == o { m } else { o }];
            Edit { parents: vec![], depth: 0, author, cosigners, action }
        };
        let v = VaultId::from_u64(1);
        let add = |s| Action::Share(Sharing::Owner { vault: v, owner: Principal::Signer(s), seal_to: None });
        // founding a vault with it among the first owners, or adding it as an owner, takes it
        assert_eq!(signed(by(o, genesis(&[o, m], Some(o))), &consent), Ok(()));
        assert_eq!(signed(by(o, genesis(&[m, o], None)), &consent), Ok(()));
        assert_eq!(signed(by(o, add(m)), &consent), Ok(()));
        // no other edit: another owner added, a vault founded without it, it added as a device or granted owner of the
        // whole vault, the threshold, the root handed to it, its removal
        let grant = Share {
            over: v,
            who: Who::Device(m),
            level: Level::Owner,
            wide: true,
            select: vec![],
            parent: None,
            issuer: v,
            nonce: 0,
            group: None,
        };
        for action in [
            add(other.id()),
            genesis(&[o], Some(o)),
            Action::Share(Sharing::Device { vault: v, device, seal_to: None }),
            Action::Share(Sharing::Device { vault: v, device: m, seal_to: None }),
            Action::Share(Sharing::Grant(grant, vec![])),
            Action::Settings { vault: v, set: Setting::Threshold(1) },
            Action::Settings { vault: v, set: Setting::Root { root: Some(m), keep: vec![] } },
            Action::Revoke(Revoking::Owner { vault: v, owner: Principal::Signer(m), keep: vec![] }),
        ] {
            assert_eq!(signed(by(o, action), &consent), Err(Refusal::BadSignature));
        }
        // nor as the vault's root, nor as the edit's author, who sign it themselves
        assert_eq!(signed(by(o, genesis(&[o, m], Some(m))), &consent), Err(Refusal::BadSignature));
        assert_eq!(signed(by(m, genesis(&[o, m], Some(o))), &consent), Err(Refusal::BadSignature));
        // another signer's consent is no consent of its
        assert_eq!(signed(by(o, add(m)), &other.consent()), Err(Refusal::BadSignature));
        // and a consent is no signature on an edit, as no edit's id is its challenge
        let mut on_edit = master.sign(EditId(consent_challenge(m)));
        assert!(verify(m, EditId(consent_challenge(m)), &on_edit));
        on_edit.pq = vec![0; PQ_SIGNATURE_BYTES];
        assert!(!verify(m, EditId(consent_challenge(m)), &on_edit), "its post-quantum signature");
    }

    #[test]
    fn a_device_signature_covers_the_whole_edit() {
        let key = DeviceKey::from_secret([7; 32]);
        let edit = edit(key.id(), vec![]);
        let signed = Signed { edit: edit.clone(), sigs: vec![key.sign(edit.id())] };
        assert!(signed.verify().is_ok());
        let ml = ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES;
        assert_eq!(signed.sigs[0].pq.len(), ml, "its ML-DSA-65 key and its signature");
        assert_eq!(signed.sigs[0].webauthn, None, "a device signs with its post-quantum key alone");
        // the same signature on a changed edit, or claimed by another signer, is refused
        let other = Edit { parents: vec![EditId::from_u64(1)], ..edit.clone() };
        assert_eq!(
            Signed { edit: other, sigs: vec![key.sign(edit.id())] }.verify().err(),
            Some(Refusal::BadSignature)
        );
        let claimed = Edit { author: DeviceKey::from_secret([8; 32]).id(), ..edit.clone() };
        assert_eq!(Signed { edit: claimed, sigs: signed.sigs.clone() }.verify().err(), Some(Refusal::BadSignature));
        // and every signer named must sign
        let both = Edit { cosigners: vec![DeviceKey::from_secret([8; 32]).id()], ..edit };
        assert_eq!(
            Signed { edit: both.clone(), sigs: vec![key.sign(both.id())] }.verify().err(),
            Some(Refusal::BadSignature)
        );
    }

    #[test]
    fn a_creation_names_its_entry_by_its_own_id() {
        let (key, other) = (DeviceKey::from_secret([7; 32]), DeviceKey::from_secret([8; 32]));
        let (v, nonce) = (VaultId::from_u64(1), [5; 32]);
        let creation = |author: SignerId, entry: EntryId| {
            let mut e = write(author);
            if let Action::Write { entry: x, create, .. } = &mut e.action {
                (*x, *create) = (entry, Some(crate::policy::Creation { audience: vec![], nonce }));
            }
            e
        };
        let signed = |key: &DeviceKey, e: Edit| Signed { sigs: vec![key.sign(e.id())], edit: e };
        let ours = creation(key.id(), EntryId::of(v, key.id(), &nonce));
        assert!(signed(&key, ours).verify().is_ok());
        // another signer's id, another vault's, another nonce's or a number: refused, however well signed
        for entry in [EntryId::of(v, other.id(), &nonce), EntryId::of(VaultId::from_u64(2), key.id(), &nonce)] {
            assert_eq!(signed(&key, creation(key.id(), entry)).verify().err(), Some(Refusal::NotItsId));
        }
        for entry in [EntryId::of(v, key.id(), &[6; 32]), EntryId::from_u64(1)] {
            assert_eq!(signed(&key, creation(key.id(), entry)).verify().err(), Some(Refusal::NotItsId));
        }
        // a later write names its entry by any id: the creation's check made it
        assert!(signed(&key, write(key.id())).verify().is_ok());
    }

    #[test]
    fn the_post_quantum_signature_must_verify() {
        let key = DeviceKey::from_secret([7; 32]);
        let (governance, w) = (edit(key.id(), vec![]), write(key.id()));
        // every edit, a write as any other, carries it
        for e in [&governance, &w] {
            assert!(Signed { edit: e.clone(), sigs: vec![key.sign(e.id())] }.verify().is_ok());
            let mut broken = key.sign(e.id());
            broken.pq = vec![0; PQ_SIGNATURE_BYTES];
            assert!(Signed { edit: e.clone(), sigs: vec![broken] }.verify().is_err());
        }
        // nor does one made with another post-quantum key pass: the keys no longer hash to the signer
        let thief = DeviceKey::from_secret([9; 32]);
        let mut theirs = thief.sign(governance.id());
        theirs.keys = SignerKeys::Device { ed25519: key.ed25519.verifying_key().to_bytes(), pq: thief.pq.public() };
        assert!(!verify(key.id(), governance.id(), &theirs));
        // a device's signature carries no assertion, and a passkey's always one
        let mut passkey = Passkey::from_seed([1; 32]);
        let mut dressed = key.sign(governance.id());
        dressed.webauthn = passkey.sign(governance.id()).webauthn;
        assert!(!verify(key.id(), governance.id(), &dressed));
        let p = edit(passkey.id(), vec![]);
        let bare = Signature { webauthn: None, ..passkey.sign(p.id()) };
        assert!(!verify(passkey.id(), p.id(), &bare));
    }

    #[test]
    fn a_signer_id_names_both_keys() {
        let (a, b) = (DeviceKey::from_secret([1; 32]), DeviceKey::from_secret([2; 32]));
        let SignerKeys::Device { ed25519, pq } = a.keys() else { unreachable!() };
        let SignerKeys::Device { pq: other, .. } = b.keys() else { unreachable!() };
        assert_ne!(SignerKeys::Device { ed25519, pq: other }.id(), a.id());
        assert_eq!(SignerKeys::Device { ed25519, pq }.id(), a.id());
        // a passkey's keys never hash like a device's
        let p = Passkey::from_seed([1; 32]);
        assert_ne!(p.id(), a.id());
    }

    #[test]
    fn a_passkey_signs_through_webauthn() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let device = DeviceKey::from_secret([2; 32]);
        let edit = edit(passkey.id(), vec![device.id()]);
        let signed =
            Signed { edit: edit.clone(), sigs: vec![passkey.sign(edit.id()), device.sign(edit.id())] };
        assert!(signed.verify().is_ok());
        // from the website alone: the Mac app's webview is no origin
        assert!(!verify(passkey.id(), edit.id(), &passkey.sign_at(edit.id(), "tauri://localhost")));
    }

    #[test]
    fn one_ceremony_signs_several_edits_and_counts_for_those_alone() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let device = DeviceKey::from_secret([2; 32]);
        let (a, b) = (edit(passkey.id(), vec![]), edit(passkey.id(), vec![device.id()]));
        let mut batch = vec![a.id(), b.id()];
        batch.sort();
        let ceremony = passkey.ceremony(batch_challenge(&batch));
        for o in [&a, &b] {
            let sig = ceremony.sign_in(passkey.keys(), o.id(), &batch).expect("an edit of the batch");
            assert!(verify(passkey.id(), o.id(), &sig), "it counts for each edit of the batch");
        }
        // not for an edit outside it, over its ids in another order, or for one of its edits alone
        let other = EditId::from_u64(7);
        assert!(ceremony.sign_in(passkey.keys(), other, &batch).is_none());
        let reversed: Vec<EditId> = batch.iter().rev().copied().collect();
        assert!(ceremony.sign_in(passkey.keys(), a.id(), &reversed).is_none());
        assert!(ceremony.sign(passkey.keys(), a.id()).is_none());
        // a ceremony over one edit's id signs no batch
        let alone = passkey.ceremony(a.id().0);
        assert!(alone.sign_in(passkey.keys(), a.id(), &batch).is_none());
        // moved onto another edit, or naming another batch, it verifies nowhere
        let sig = ceremony.sign_in(passkey.keys(), a.id(), &batch).expect("its signature");
        assert!(!verify(passkey.id(), other, &sig));
        let Some(WebAuthn::Batch { assertion, edits }) = sig.webauthn.clone() else {
            unreachable!("a batch's signature")
        };
        let mut grown = [&edits[..], &[other]].concat();
        grown.sort();
        for edits in [grown, vec![a.id()], reversed] {
            let webauthn = Some(WebAuthn::Batch { assertion: assertion.clone(), edits });
            let named = Signature { webauthn, ..sig.clone() };
            assert!(!verify(passkey.id(), a.id(), &named), "only the batch the ceremony signed");
        }
        // its post-quantum signature is the edit's own
        let lone = ceremony.sign_in(passkey.keys(), b.id(), &batch).expect("its signature");
        let swapped = Signature { pq: lone.pq, ..sig };
        assert!(!verify(passkey.id(), a.id(), &swapped));
    }

    #[test]
    fn a_pass_signs_the_edit_adding_its_device_and_nothing_else() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let (device, other) = (DeviceKey::from_secret([2; 32]), DeviceKey::from_secret([3; 32]));
        let made = 1_760_000_000;
        let unlock = passkey.ceremony(pass_challenge(device.id(), made));
        let adds = |d: SignerId, cosigners: Vec<SignerId>| Edit {
            parents: vec![],
            depth: 0,
            author: passkey.id(),
            cosigners,
            action: Action::Share(Sharing::Device { vault: VaultId::from_u64(1), device: d, seal_to: None }),
        };
        let join = adds(device.id(), vec![device.id()]);
        let sig = unlock.sign_adding(passkey.keys(), join.id(), device.id(), made).expect("the pass's signature");
        let signed = Signed { edit: join.clone(), sigs: vec![sig.clone(), device.sign(join.id())] };
        assert!(signed.verify().is_ok(), "the unlock signs the edit adding its device");
        // not for another device, nor at another time, nor without the device cosigning
        assert!(unlock.sign_adding(passkey.keys(), join.id(), other.id(), made).is_none());
        let theirs = adds(other.id(), vec![other.id()]);
        let moved = Signed { edit: theirs.clone(), sigs: vec![sig.clone(), other.sign(theirs.id())] };
        assert!(moved.verify().is_err(), "another device's join");
        let Some(WebAuthn::Pass { assertion, .. }) = sig.webauthn.clone() else { unreachable!("a pass's signature") };
        let later = Signature { webauthn: Some(WebAuthn::Pass { assertion, made: made + 1 }), ..sig.clone() };
        let later = Signed { edit: join.clone(), sigs: vec![later, device.sign(join.id())] };
        assert!(later.verify().is_err(), "another time");
        let alone = adds(device.id(), vec![]);
        let alone_sig = unlock.sign_adding(passkey.keys(), alone.id(), device.id(), made).expect("signed");
        assert!(Signed { edit: alone.clone(), sigs: vec![alone_sig] }.verify().is_err(), "the device must cosign");
        // its post-quantum signature is the edit's own, and never left out
        assert!(!verify(passkey.id(), join.id(), &sig), "a pass counts on an edit adding its device alone");
        let bare = Signature { pq: vec![], ..sig.clone() };
        assert!(Signed { edit: join.clone(), sigs: vec![bare, device.sign(join.id())] }.verify().is_err());
        let other_join = Edit { depth: 1, ..join.clone() };
        let swapped = Signed { edit: other_join.clone(), sigs: vec![sig, device.sign(other_join.id())] };
        assert!(swapped.verify().is_err(), "its post-quantum signature signs this very edit");
    }

    #[test]
    fn a_passkey_assertion_for_anything_else_is_refused() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let key = passkey.public();
        let edit = edit(passkey.id(), vec![]);
        let sig = passkey.sign(edit.id());
        let Some(WebAuthn::Edit(good)) = sig.webauthn.clone() else { unreachable!() };
        assert!(good.verify(&key, edit.id()));
        // another edit's challenge
        assert!(!good.verify(&key, EditId::from_u64(1)));
        // another passkey's key, and another signer's id
        assert!(!good.verify(&Passkey::from_seed([2; 32]).public(), edit.id()));
        assert!(!verify(Passkey::from_seed([2; 32]).id(), edit.id(), &sig));
        // a phishing origin
        let Some(WebAuthn::Edit(phished)) = passkey.sign_at(edit.id(), "https://maia-city.example").webauthn else {
            unreachable!()
        };
        assert!(!phished.verify(&key, edit.id()));
        // the user wasn't verified, or the assertion was for another site: the data no longer matches
        let mut unverified = good.clone();
        unverified.authenticator_data[32] = UP;
        assert!(!unverified.verify(&key, edit.id()));
        let mut elsewhere = good.clone();
        elsewhere.authenticator_data[..32].copy_from_slice(&sha256(b"example.com"));
        assert!(!elsewhere.verify(&key, edit.id()));
        // a registration, not an assertion
        let mut created = good.clone();
        created.client_data_json = String::from_utf8(good.client_data_json.clone()).unwrap().replace("webauthn.get", "webauthn.create").into_bytes();
        assert!(!created.verify(&key, edit.id()));
        // a changed signature
        let mut changed = good;
        let last = changed.signature.len() - 1;
        changed.signature[last] ^= 1;
        assert!(!changed.verify(&key, edit.id()));
    }

    #[test]
    fn a_hello_proves_its_device_on_its_connection_alone() {
        let key = DeviceKey::from_secret([7; 32]);
        let endpoint = key.ed25519.verifying_key().to_bytes();
        let (exporter, other) = ([1; 32], [2; 32]);
        let hello = key.hello(&exporter, true);
        assert_eq!(hello.verify(&exporter, true, &endpoint), Some(key.id()));
        assert_eq!(hello.sig.len(), ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES);
        // another connection, sent back by the other end, or under another endpoint key: refused
        assert_eq!(hello.verify(&other, true, &endpoint), None);
        assert_eq!(hello.verify(&exporter, false, &endpoint), None);
        assert_eq!(hello.verify(&exporter, true, &DeviceKey::from_secret([8; 32]).endpoint_secret()), None);
        // whoever broke the device's ed25519 key and signs with a post-quantum key of their own proves another device
        let thief = DeviceKey::from_secret([9; 32]);
        let mut stolen = thief.hello(&exporter, true);
        stolen.keys = SignerKeys::Device { ed25519: endpoint, pq: thief.pq.public() };
        assert!(stolen.verify(&exporter, true, &endpoint).is_some_and(|s| s != key.id()));
        // an edit's signature is no hello, and a passkey says no hello
        let edit = Hello { keys: key.keys(), sig: sign_pq(Some(&key.pq), EditId(exporter)) };
        assert_eq!(edit.verify(&exporter, true, &endpoint), None);
        let passkey = Passkey::from_seed([1; 32]);
        assert_eq!(Hello { keys: passkey.keys(), sig: hello.sig.clone() }.verify(&exporter, true, &endpoint), None);
    }

    #[test]
    fn a_pass_names_one_device_for_ten_minutes() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let device = passkey.device([5; 32]).keys();
        let made = 1_791_500_000;
        let pass = passkey.pass(device, made);
        assert_eq!(pass.sig.len(), ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES);
        let SignerKeys::Device { ed25519, .. } = device else { unreachable!() };
        assert_eq!(pass.endpoint(), Some(ed25519), "it lets in the device's endpoint");
        // from when it was made, or a little before by a device whose clock runs fast, for ten minutes: the passkey is
        // among those it may be from, each with a key its assertion recovers to
        for now in [made, made + PASS_LIFE - 1, made - PASS_SKEW] {
            let passkeys = pass.passkeys(now);
            assert!(passkeys.contains(&passkey.id()) && passkeys.len() >= 2, "at {now}");
            assert_eq!(passkeys, pass.candidates(), "at {now}");
        }
        for now in [made + PASS_LIFE, made - PASS_SKEW - 1, 0, u64::MAX] {
            assert!(pass.passkeys(now).is_empty(), "at {now}");
        }
        // for another device, made at another time than the one it signed, or for a passkey: refused
        assert!(RelayPass { device: passkey.device([6; 32]).keys(), ..pass.clone() }.passkeys(made).is_empty());
        assert!(RelayPass { made: made + 1, ..pass.clone() }.passkeys(made).is_empty());
        assert!(RelayPass { device: passkey.keys(), ..pass.clone() }.passkeys(made).is_empty());
        // whoever broke the passkey's P-256 key and signs with a post-quantum key of their own makes a pass of others
        let theirs = Passkey::from_seed([2; 32]).pass(device, made);
        let stolen = RelayPass { pq: theirs.pq, sig: theirs.sig, ..pass.clone() }.passkeys(made);
        assert!(!stolen.is_empty() && !stolen.contains(&passkey.id()));
        // a passkey's signature on an edit over the same challenge is no pass: its post-quantum signature, another
        // context
        let edit = passkey.sign(EditId(pass_challenge(device.id(), made)));
        let Some(WebAuthn::Edit(assertion)) = edit.webauthn.clone() else { unreachable!() };
        let replayed = RelayPass { assertion, sig: edit.pq.clone(), ..pass.clone() };
        assert!(replayed.passkeys(made).is_empty());
        // and an assertion that recovers to no key is no passkey's
        let assertion = Assertion { signature: vec![1, 2, 3], ..pass.assertion.clone() };
        assert!(RelayPass { assertion, ..pass.clone() }.passkeys(made).is_empty());
    }

    #[test]
    fn a_passkey_is_made_again_from_its_secret() {
        let passkey = Passkey::from_seed([3; 32]);
        let again = Passkey::from_seed(*passkey.secret());
        assert_eq!(again.id(), passkey.id());
        assert_eq!(again.seal_secret(), passkey.seal_secret());
        assert_eq!(again.device([5; 32]).id(), passkey.device([5; 32]).id());
        assert_eq!(*passkey.secret(), [3; 32], "a seed in the curve's range is the key itself");
    }

    #[test]
    fn device_keys_derive_from_the_passkey() {
        let (passkey, other) = (Passkey::from_seed([1; 32]), Passkey::from_seed([2; 32]));
        // the same passkey and salt give the same device at every unlock; another salt or passkey, another device
        assert_eq!(passkey.device([5; 32]).id(), passkey.device([5; 32]).id());
        assert_eq!(passkey.device([5; 32]).seal_secret(), passkey.device([5; 32]).seal_secret());
        assert_ne!(passkey.device([5; 32]).id(), passkey.device([6; 32]).id());
        assert_ne!(passkey.device([5; 32]).id(), other.device([5; 32]).id());
        // and none of them is the passkey's own key to seal to
        assert_ne!(passkey.device([5; 32]).seal_secret(), passkey.seal_secret());
    }

    #[test]
    fn base64url_reads_back_what_it_writes() {
        for bytes in [&b""[..], b"f", b"fo", b"foo", b"foob", b"fooba", b"foobar", &[0xfb, 0xff], &[7; 32]] {
            assert_eq!(unbase64url(&base64url(bytes)).as_deref(), Some(bytes));
        }
        // padding, another alphabet's digits, a lone last digit, or bits left over: none is base64url as we write it
        for text in ["Zg==", "+/8", "Z", "Zh", "Zm9", "Zm8=", "Zm 9"] {
            assert_eq!(unbase64url(text), None, "{text:?}");
        }
    }

    #[test]
    fn a_ceremony_signs_as_its_passkey_does() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let device = passkey.device([5; 32]);
        let edit = edit(passkey.id(), vec![device.id()]);
        let ceremony = passkey.ceremony(edit.id().0);
        assert_eq!(ceremony.challenge(), Some(edit.id().0));
        assert_eq!(ceremony.keys(passkey.public()), passkey.keys(), "its PRF output derives the post-quantum key");
        assert_eq!(ceremony.seal_secret(), passkey.seal_secret(), "and the key sealed to the passkey");
        // an edit signed by the ceremony and the device is signed by both
        let sig = ceremony.sign(passkey.keys(), edit.id()).expect("the passkey's signature");
        assert!(Signed { edit: edit.clone(), sigs: vec![sig, device.sign(edit.id())] }.verify().is_ok());
        // a pass made in a ceremony is the passkey's, as the one it makes itself is
        let made = 1_791_500_000;
        let pass = passkey.ceremony(pass_challenge(device.id(), made)).pass(device.keys(), made).expect("a pass");
        assert!(pass.passkeys(made).contains(&passkey.id()));
    }

    #[test]
    fn a_ceremony_signs_only_its_challenge_as_its_own_passkey() {
        let (mut passkey, mut other) = (Passkey::from_seed([1; 32]), Passkey::from_seed([2; 32]));
        let device = passkey.device([5; 32]).id();
        let (a, b) = (edit(passkey.id(), vec![]), edit(passkey.id(), vec![device]));
        let ceremony = passkey.ceremony(a.id().0);
        assert!(ceremony.sign(passkey.keys(), a.id()).is_some());
        // another edit, or a pass: its assertion signed neither
        assert!(ceremony.sign(passkey.keys(), b.id()).is_none());
        assert!(ceremony.pass(passkey.device([5; 32]).keys(), 0).is_none());
        // another passkey's ceremony, or keys with another passkey's half: its PRF output or assertion isn't theirs
        assert!(other.ceremony(a.id().0).sign(passkey.keys(), a.id()).is_none());
        let (SignerKeys::Passkey { pq: theirs, .. }, SignerKeys::Passkey { pq, .. }) = (other.keys(), passkey.keys())
        else {
            unreachable!()
        };
        assert!(ceremony.sign(SignerKeys::Passkey { p256: passkey.public(), pq: theirs }, a.id()).is_none());
        assert!(ceremony.sign(SignerKeys::Passkey { p256: other.public(), pq }, a.id()).is_none());
        // and a device signs no ceremony
        assert!(ceremony.sign(DeviceKey::from_secret([7; 32]).keys(), a.id()).is_none());
    }

    #[test]
    fn a_touch_id_key_signs_through_its_enclave() {
        let touch = EnclaveKey::from_seed([1; 32]);
        let device = DeviceKey::from_secret([7; 32]);
        let edit = edit(touch.id(), vec![device.id()]);
        // the same seed makes the same key again, another seed another; its ML-DSA-65 key is FIPS 204's size
        assert_eq!(EnclaveKey::from_seed([1; 32]).id(), touch.id());
        assert_ne!(EnclaveKey::from_seed([2; 32]).id(), touch.id());
        assert_eq!(touch.public().len(), ML_DSA_PUBLIC_BYTES);
        let sig = touch.sign(edit.id());
        let e = sig.enclave.clone().expect("its Enclave's signature");
        assert_eq!((e.sig.len(), &sig.webauthn), (ML_DSA_SIGNATURE_BYTES, &None));
        assert!(verify(touch.id(), edit.id(), &sig));
        assert!(Signed { edit: edit.clone(), sigs: vec![sig.clone(), device.sign(edit.id())] }.verify().is_ok());
        // its Enclave's signature left out, changed, over another edit, or another key's: no signature of it
        assert!(!verify(touch.id(), edit.id(), &Signature { enclave: None, ..sig.clone() }));
        let mut changed = e.clone();
        changed.sig[9] ^= 1;
        assert!(!verify(touch.id(), edit.id(), &Signature { enclave: Some(changed), ..sig.clone() }));
        let elsewhere = touch.sign(EditId([9; 32])).enclave;
        assert!(!verify(touch.id(), edit.id(), &Signature { enclave: elsewhere, ..sig.clone() }));
        let theirs = EnclaveKey::from_seed([2; 32]).sign(edit.id()).enclave;
        assert!(!verify(touch.id(), edit.id(), &Signature { enclave: theirs, ..sig.clone() }), "another key's");
        // a passkey's assertion beside it, or its Enclave's signature on a device's or a passkey's: none counts
        let mut passkey = Passkey::from_seed([3; 32]);
        let webauthn = passkey.sign(edit.id()).webauthn;
        assert!(!verify(touch.id(), edit.id(), &Signature { webauthn, ..sig.clone() }));
        let dressed = Signature { enclave: Some(e.clone()), ..device.sign(edit.id()) };
        assert!(!verify(device.id(), edit.id(), &dressed));
        let dressed = Signature { enclave: Some(e), ..passkey.sign(edit.id()) };
        assert!(!verify(passkey.id(), edit.id(), &dressed));
        // its standing consent is its signature over its consent challenge, as a passkey's is
        assert!(verify(touch.id(), EditId(consent_challenge(touch.id())), &touch.consent()));
    }

    #[test]
    fn a_touch_id_ceremony_signs_only_its_challenge_as_its_own_key() {
        let touch = EnclaveKey::from_seed([1; 32]);
        let device = DeviceKey::from_secret([7; 32]);
        let (a, b) = (edit(touch.id(), vec![]), edit(touch.id(), vec![device.id()]));
        let ceremony = touch.ceremony(a.id().0);
        assert_eq!(ceremony.challenge(), Some(a.id().0));
        assert_eq!(ceremony.enclave_keys(), Some(touch.keys()), "its secret derives the SLH-DSA key");
        assert_eq!(ceremony.seal_secret(), touch.seal_secret(), "and the key sealed to it");
        assert!(ceremony.assertion().is_none(), "no passkey's");
        let sig = ceremony.sign(touch.keys(), a.id()).expect("its signature");
        assert!(verify(touch.id(), a.id(), &sig));
        // another edit, a pass, another Touch ID key's keys, or a passkey's: its Enclave signed none of them
        assert!(ceremony.sign(touch.keys(), b.id()).is_none());
        assert!(ceremony.pass(device.keys(), 0).is_none());
        assert!(ceremony.sign(EnclaveKey::from_seed([2; 32]).keys(), a.id()).is_none());
        assert!(ceremony.sign(Passkey::from_seed([1; 32]).keys(), a.id()).is_none());
        // a ceremony that says another challenge than its Enclave signed signs nothing
        let Proof::Enclave { sig, .. } = &ceremony.proof else { unreachable!("a Touch ID key's") };
        let lying = Ceremony::enclave(touch.public(), sig.clone(), b.id().0, *touch.secret);
        assert!(lying.sign(touch.keys(), b.id()).is_none());
        // edits signed together: one touch, each its own post-quantum signature beside the Enclave's over their batch
        let mut batch = vec![a.id(), b.id()];
        batch.sort();
        let together = touch.ceremony(batch_challenge(&batch));
        for id in &batch {
            let sig = together.sign_in(touch.keys(), *id, &batch).expect("its signature");
            assert!(verify(touch.id(), *id, &sig));
            assert_eq!(sig.enclave.map(|e| e.edits), Some(batch.clone()), "it names both");
        }
        assert!(together.sign_in(touch.keys(), EditId([9; 32]), &batch).is_none(), "an edit outside the batch");
        // a batch named out of order is no set
        let mut swapped = together.sign_in(touch.keys(), batch[0], &batch).expect("its signature");
        swapped.enclave.as_mut().expect("its Enclave's").edits.reverse();
        assert!(!verify(touch.id(), batch[0], &swapped));
    }

    #[test]
    fn a_macs_secure_enclave_signature_checks_out_here() {
        // vault/app/scripts/enclave-probe.swift --kat on an M1 with macOS 26.1 (2026-10-19): a public key and its
        // signature over the bytes 0 to 31, with `ENCLAVE_CONTEXT`, both made in the Secure Enclave
        let kat = include_str!("../tests/data/enclave-mac.kat");
        let mut lines = kat.lines().map(|line| {
            let url: String = line.trim_end_matches('=').chars().map(|c| match c { '+' => '-', '/' => '_', c => c }).collect();
            unbase64url(&url).expect("base64")
        });
        let (public, sig) = (lines.next().expect("its public key"), lines.next().expect("its signature"));
        assert_eq!((public.len(), sig.len()), (1952, 3309), "ML-DSA-65's sizes");
        let msg: [u8; 32] = std::array::from_fn(|i| i as u8);
        assert!(verify_mldsa(&public, &msg, ENCLAVE_CONTEXT, &sig));
        // another message, a byte of the signature or the key changed: no signature
        assert!(!verify_mldsa(&public, &[0; 32], ENCLAVE_CONTEXT, &sig));
        let mut bent = sig.clone();
        bent[100] ^= 1;
        assert!(!verify_mldsa(&public, &msg, ENCLAVE_CONTEXT, &bent));
        let mut other = public.clone();
        other[100] ^= 1;
        assert!(!verify_mldsa(&other, &msg, ENCLAVE_CONTEXT, &sig));
        // nor without avenDB's context, as the Enclave signs for another use
        use ml_dsa::{EncodedSignature, EncodedVerifyingKey, MlDsa65, VerifyingKey};
        let key = VerifyingKey::<MlDsa65>::decode(&EncodedVerifyingKey::<MlDsa65>::try_from(&public[..]).expect("its size"));
        let sig = EncodedSignature::<MlDsa65>::try_from(&sig[..]).expect("its size");
        let sig = ml_dsa::Signature::<MlDsa65>::decode(&sig).expect("a signature");
        assert!(key.verify_with_context(&msg, ENCLAVE_CONTEXT, &sig) && !key.verify_with_context(&msg, b"", &sig));
    }

    #[test]
    fn a_passkeys_key_comes_from_its_public_key_info_or_its_next_ceremony() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let point = passkey.key.verifying_key().to_sec1_point(false);
        let mut spki = vec![48, 89, 48, 19, 6, 7, 42, 134, 72, 206, 61, 2, 1];
        spki.extend([6, 8, 42, 134, 72, 206, 61, 3, 1, 7, 3, 66, 0]);
        spki.extend_from_slice(point.as_bytes());
        assert_eq!(spki_p256(&spki), Some(passkey.public()), "as navigator.credentials.create hands it out");
        assert_eq!(spki_p256(&spki[..90]), None);
        let mut other = spki.clone();
        other[22] ^= 1;
        assert_eq!(spki_p256(&other), None, "another curve");
        // a passkey that made no key here: an assertion recovers to a few keys, the passkey's among them, and verifies
        // under each; its next ceremony's assertion verifies under the passkey's alone
        let assertion = |c: Ceremony| c.assertion().cloned().expect("a passkey's");
        let (a, b) = (assertion(passkey.ceremony([1; 32])), assertion(passkey.ceremony([2; 32])));
        let keys = a.recover();
        assert!(keys.contains(&passkey.public()) && keys.len() >= 2, "{:?}", keys.len());
        assert!(keys.iter().all(|k| a.verify(k, EditId([1; 32]))));
        let next: Vec<&[u8; 33]> = keys.iter().filter(|k| b.verify(k, EditId([2; 32]))).collect();
        assert_eq!(next, [&passkey.public()]);
        let theirs = assertion(Passkey::from_seed([2; 32]).ceremony([2; 32]));
        assert!(!keys.iter().any(|k| theirs.verify(k, EditId([2; 32]))), "another passkey's verifies under none");
        assert!(Assertion { signature: vec![1, 2, 3], ..a }.recover().is_empty());
    }

    #[test]
    fn localhost_passkeys_count_only_in_a_build_for_the_tests() {
        let (ours, test) = (sha256(RP_ID.as_bytes()), sha256(TEST_RP_ID.as_bytes()));
        assert!(relying_party("https://maia.city", &ours) && !relying_party("https://maia.city", &test));
        let on = cfg!(feature = "localhost-passkeys");
        for origin in ["http://localhost:5173", "http://localhost"] {
            assert_eq!(relying_party(origin, &test), on, "{origin}");
            assert!(!relying_party(origin, &ours), "{origin} for maia.city");
        }
        let others = ["http://localhost:", "http://localhost:5173/", "http://localhost.example", "https://localhost:8"];
        for origin in others {
            assert!(!relying_party(origin, &test), "{origin}");
        }
    }

    /// The signer ids of signers made before the key move, as avenDB computed them before it read ML-DSA-65 (main at
    /// 5308b60, 2026-10-19): every vault names its signers by them, so they never change.
    #[test]
    fn a_devices_kept_secret_says_its_suite_but_for_one_made_before_the_key_move() {
        let secret = [7; 32];
        let old = kept_secret(&secret, Suite::SlhDsa);
        assert_eq!(&old[..], &secret[..], "the 32 bytes alone, as every one kept before");
        let new = kept_secret(&secret, Suite::MlDsa);
        assert_eq!((new.len(), new[0]), (33, 2), "its suite's byte first");
        for (kept, suite) in [(old, Suite::SlhDsa), (new, Suite::MlDsa)] {
            let (back, read) = kept_secret_of(&kept).expect("it reads");
            assert_eq!((*back, read), (secret, suite));
        }
        assert!(kept_secret_of(&[1; 33]).is_none(), "SLH-DSA is never named");
        assert!(kept_secret_of(&[9; 33]).is_none(), "no such suite");
        assert!(kept_secret_of(&[7; 31]).is_none());
    }

    #[test]
    fn a_signer_made_before_the_key_move_keeps_its_id() {
        let ids = [
            (DeviceKey::from_secret_in([7; 32], Suite::SlhDsa).id(), "ef7d8bee911ae8d227780c232b98dcfbe590f7b12e8ab57c9a7df617123fe146"),
            (Passkey::from_seed_in([1; 32], Suite::SlhDsa).id(), "101bf00526bba32bb4b8e05fd2eb1f2714335679411ac740442570e0f476f91e"),
            (EnclaveKey::from_seed_in([1; 32], Suite::SlhDsa).id(), "df4bc843aa6e619d5d091ba0df77c755e79ee7a92dbf584b00a11fd7a6d76d74"),
        ];
        for (id, before) in ids {
            assert_eq!(id.to_hex(), before);
        }
        // the same secret in ML-DSA-65's suite is another signer, of the same kind, its ed25519 or P-256 key the same
        let (old, new) = (DeviceKey::from_secret_in([7; 32], Suite::SlhDsa), DeviceKey::from_secret_in([7; 32], Suite::MlDsa));
        assert_ne!(old.id(), new.id());
        assert_eq!((old.keys().suite(), new.keys().suite()), (Suite::SlhDsa, Suite::MlDsa));
        assert_eq!(*old.endpoint_secret(), *new.endpoint_secret(), "one iroh endpoint");
        assert_eq!(old.seal_secret(), new.seal_secret(), "one key sealed to the device");
        let (old, new) = (Passkey::from_seed_in([1; 32], Suite::SlhDsa), Passkey::from_seed_in([1; 32], Suite::MlDsa));
        assert_ne!(old.id(), new.id());
        assert_eq!((old.public(), old.seal_secret()), (new.public(), new.seal_secret()));
        assert_eq!(new.device([5; 32]).keys().suite(), Suite::MlDsa, "a passkey's devices are in its suite");
        let (old, new) = (EnclaveKey::from_seed_in([1; 32], Suite::SlhDsa), EnclaveKey::from_seed_in([1; 32], Suite::MlDsa));
        assert_ne!(old.id(), new.id());
        assert_eq!(new.keys(), SignerKeys::Enclave { mldsa: enclave_key(&old.public()), slh: None });
        // a device's secret makes it again in whichever suite its id is in, and no other device
        for suite in [Suite::SlhDsa, Suite::MlDsa] {
            let id = DeviceKey::from_secret_in([7; 32], suite).id();
            assert_eq!(DeviceKey::of([7; 32], id).map(|k| k.id()), Some(id), "{suite:?}");
            assert!(DeviceKey::of([8; 32], id).is_none(), "{suite:?}");
        }
    }

    #[test]
    fn every_signer_signs_with_ml_dsa_65_and_brings_its_key() {
        let device = DeviceKey::from_secret_in([7; 32], Suite::MlDsa);
        let mut passkey = Passkey::from_seed_in([1; 32], Suite::MlDsa);
        let touch = EnclaveKey::from_seed_in([1; 32], Suite::MlDsa);
        let e = edit(passkey.id(), vec![device.id()]);
        let (by_device, by_passkey) = (device.sign(e.id()), passkey.sign(e.id()));
        // a device's and a passkey's: their ML-DSA-65 key, then its signature, 5,261 bytes against SLH-DSA's 17,088
        for sig in [&by_device, &by_passkey] {
            assert_eq!(sig.pq.len(), ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES);
            assert_eq!(sig.keys.pq(), Some(PqKey::MlDsa(ml_dsa_key(&sig.pq[..ML_DSA_PUBLIC_BYTES]))), "it brings its key");
        }
        assert!(Signed { edit: e.clone(), sigs: vec![by_passkey.clone(), by_device.clone()] }.verify().is_ok());
        // a Touch ID key's: its Enclave's signature alone
        let t = edit(touch.id(), vec![device.id()]);
        let by_touch = touch.sign(t.id());
        assert!(by_touch.pq.is_empty() && by_touch.enclave.is_some());
        assert!(Signed { edit: t.clone(), sigs: vec![by_touch.clone(), device.sign(t.id())] }.verify().is_ok());
        assert!(verify(touch.id(), EditId(consent_challenge(touch.id())), &touch.consent()));
        assert!(verify(passkey.id(), EditId(consent_challenge(passkey.id())), &passkey.consent()));
        // a changed byte of the signature, or of the key it brings, verifies nowhere
        for at in [10, ML_DSA_PUBLIC_BYTES + 10] {
            let mut bent = by_device.clone();
            bent.pq[at] ^= 1;
            assert!(!verify(device.id(), e.id(), &bent), "byte {at}");
        }
        // nor a signature cut short, or with the key alone
        for len in [0, ML_DSA_PUBLIC_BYTES, ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES - 1] {
            let cut = Signature { pq: by_device.pq[..len].to_vec(), ..by_device.clone() };
            assert!(!verify(device.id(), e.id(), &cut), "{len} bytes");
        }
        // another ML-DSA-65 key's signature brings a key that hashes to another signer
        let thief = DeviceKey::from_secret_in([9; 32], Suite::MlDsa);
        assert!(!verify(device.id(), e.id(), &Signature { pq: thief.sign(e.id()).pq, ..by_device.clone() }));
        // a Touch ID key without an SLH-DSA key carries no other signature, and one with an SLH-DSA key never goes
        // without it
        let dressed = Signature { pq: device.sign(t.id()).pq, ..by_touch.clone() };
        assert!(!verify(touch.id(), t.id(), &dressed));
        let old = EnclaveKey::from_seed_in([1; 32], Suite::SlhDsa);
        let bare = Signature { pq: vec![], ..old.sign(t.id()) };
        assert!(!verify(old.id(), t.id(), &bare));
    }

    #[test]
    fn a_signature_counts_in_its_own_signers_suite_alone() {
        let (old, new) = (DeviceKey::from_secret_in([7; 32], Suite::SlhDsa), DeviceKey::from_secret_in([7; 32], Suite::MlDsa));
        let e = edit(old.id(), vec![]);
        let (slh, ml) = (old.sign(e.id()), new.sign(e.id()));
        assert!(verify(old.id(), e.id(), &slh) && verify(new.id(), e.id(), &ml));
        // one suite's signature under the other suite's keys: refused, whichever id it claims
        for id in [old.id(), new.id()] {
            assert!(!verify(id, e.id(), &Signature { pq: ml.pq.clone(), ..slh.clone() }));
            assert!(!verify(id, e.id(), &Signature { pq: slh.pq.clone(), ..ml.clone() }));
        }
        // the old signer's keys naming the new key's hash as an SLH-DSA key are a third signer, and verify nothing
        let SignerKeys::Device { ed25519, pq } = new.keys() else { unreachable!() };
        let mixed = SignerKeys::Device { ed25519, pq: PqKey::Slh(*pq.bytes()) };
        assert!(mixed.id() != old.id() && mixed.id() != new.id());
        assert!(!verify(mixed.id(), e.id(), &Signature { keys: mixed, ..ml.clone() }));
        // a hello and a statement, in either suite
        let (exporter, endpoint) = ([1; 32], old.ed25519.verifying_key().to_bytes());
        for key in [&old, &new] {
            let hello = key.hello(&exporter, true);
            assert_eq!(hello.verify(&exporter, true, &endpoint), Some(key.id()));
            assert_eq!(verify_statement(&key.keys(), b"holdings", &key.state(b"holdings")), Some(key.id()));
            assert_eq!(verify_statement(&key.keys(), b"other", &key.state(b"holdings")), None);
        }
        assert_eq!(new.hello(&exporter, true).sig.len(), ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES);
        let crossed = Hello { keys: old.keys(), sig: new.hello(&exporter, true).sig };
        assert_eq!(crossed.verify(&exporter, true, &endpoint), None);
        // an edit's ML-DSA-65 signature is no hello and no statement: another context
        assert_eq!(Hello { keys: new.keys(), sig: ml.pq.clone() }.verify(&exporter, true, &endpoint), None);
        assert_eq!(verify_statement(&new.keys(), &e.id().0, &ml.pq), None);
    }

    #[test]
    fn one_ceremony_signs_as_its_passkey_in_either_suite() {
        let (mut old, new) = (Passkey::from_seed_in([1; 32], Suite::SlhDsa), Passkey::from_seed_in([1; 32], Suite::MlDsa));
        let device = new.device([5; 32]);
        let e = edit(old.id(), vec![new.id()]);
        // the ceremony that moves a passkey: its one PRF output derives both keys, so it signs as both
        let ceremony = old.ceremony(e.id().0);
        assert_eq!(ceremony.keys_in(old.public(), Suite::SlhDsa), old.keys());
        assert_eq!(ceremony.keys_in(old.public(), Suite::MlDsa), new.keys());
        assert_eq!(ceremony.keys_of(old.public(), old.id()), Some(old.keys()));
        assert_eq!(ceremony.keys_of(old.public(), new.id()), Some(new.keys()));
        assert_eq!(ceremony.keys_of(old.public(), device.id()), None, "its devices are no keys of its own");
        let sigs = [old.keys(), new.keys()].map(|k| ceremony.sign(k, e.id()).expect("its signature"));
        assert!(Signed { edit: e.clone(), sigs: sigs.to_vec() }.verify().is_ok(), "the old key signs the new in");
        // in a batch, and on the edit adding a device, as in SLH-DSA's
        let f = edit(new.id(), vec![]);
        let mut batch = vec![e.id(), f.id()];
        batch.sort();
        let mut moved = Passkey::from_seed_in([1; 32], Suite::MlDsa);
        let together = moved.ceremony(batch_challenge(&batch));
        for id in &batch {
            assert!(verify(new.id(), *id, &together.sign_in(new.keys(), *id, &batch).expect("its signature")));
        }
        let made = 1_791_500_000;
        let unlock = moved.ceremony(pass_challenge(device.id(), made));
        let adds = Edit {
            parents: vec![],
            depth: 0,
            author: new.id(),
            cosigners: vec![device.id()],
            action: Action::Share(Sharing::Device { vault: VaultId::from_u64(1), device: device.id(), seal_to: None }),
        };
        let sig = unlock.sign_adding(new.keys(), adds.id(), device.id(), made).expect("the pass's signature");
        assert!(Signed { edit: adds.clone(), sigs: vec![sig, device.sign(adds.id())] }.verify().is_ok());
        // its pass is in its suite, read by its size, and names the passkey it is in that suite
        let pass = unlock.pass_in(device.keys(), made, Suite::MlDsa).expect("a pass");
        assert_eq!((pass.pq.suite(), pass.sig.len()), (Suite::MlDsa, ML_DSA_PUBLIC_BYTES + ML_DSA_SIGNATURE_BYTES));
        assert!(pass.passkeys(made).contains(&new.id()) && !pass.passkeys(made).contains(&old.id()));
        assert_eq!(moved.pass(device.keys(), made).pq, pass.pq, "a passkey passes in its own suite");
        // a pass whose key claims the other suite is no pass
        let claimed = RelayPass { pq: PqKey::Slh(*pass.pq.bytes()), ..pass.clone() };
        assert!(claimed.passkeys(made).is_empty());
        // another passkey's keys in ML-DSA-65's suite: its PRF output derives no such key
        let theirs = Passkey::from_seed_in([2; 32], Suite::MlDsa).keys();
        let SignerKeys::Passkey { pq, .. } = theirs else { unreachable!() };
        assert!(ceremony.sign(SignerKeys::Passkey { p256: old.public(), pq }, e.id()).is_none());
    }

    #[test]
    fn a_touch_id_ceremony_signs_as_its_key_in_either_suite() {
        let (old, new) = (EnclaveKey::from_seed_in([1; 32], Suite::SlhDsa), EnclaveKey::from_seed_in([1; 32], Suite::MlDsa));
        let e = edit(old.id(), vec![new.id()]);
        let ceremony = old.ceremony(e.id().0);
        assert!(ceremony.is_enclave_of(&old.keys()) && ceremony.is_enclave_of(&new.keys()));
        assert!(!ceremony.is_enclave_of(&EnclaveKey::from_seed_in([2; 32], Suite::MlDsa).keys()));
        assert!(!ceremony.is_enclave_of(&Passkey::from_seed_in([1; 32], Suite::MlDsa).keys()));
        assert_eq!(ceremony.keys_in([0; 33], Suite::MlDsa), new.keys());
        let sigs = [old.keys(), new.keys()].map(|k| ceremony.sign(k, e.id()).expect("its signature"));
        assert_eq!((sigs[0].pq.len(), sigs[1].pq.len()), (PQ_SIGNATURE_BYTES, 0));
        assert!(Signed { edit: e, sigs: sigs.to_vec() }.verify().is_ok(), "one touch signs as both");
        // a passkey's ceremony is no Touch ID key's, in either suite
        let mut passkey = Passkey::from_seed_in([1; 32], Suite::MlDsa);
        assert!(!passkey.ceremony([1; 32]).is_enclave_of(&new.keys()));
    }
}
