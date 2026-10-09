//! Signatures: what makes an op's signers its signers. A signature signs the op's id, which hashes everything the op
//! says, so the rules (`policy`) only ever see ops whose author and cosigners really signed them.
//!
//! Every signer signs twice, with a classical key and with a hash-based one (SLH-DSA-SHA2-128f, FIPS 205), and an op
//! counts only if both halves verify: whoever breaks the curves, with a quantum computer or with better mathematics,
//! still has to break SHA-256 too. A signer's id is the hash of both its public keys, so it names both.
//!
//! - A device signs with ed25519, the key of its iroh endpoint, and with its SLH-DSA key. A person's device derives
//!   all its keys from their passkey's PRF output (WebAuthn's `prf` extension) on a salt of its own, at every unlock,
//!   and holds them in memory only: a locked or stolen device holds no key. The server, which has no passkey, keeps
//!   keys of its own.
//! - A passkey signs through WebAuthn, so its classical half is an assertion: the authenticator signs its data
//!   followed by the SHA-256 of the client data, whose challenge is the op's id. Passkeys only sign P-256, so their
//!   hash-based key derives from their PRF output too: the authenticator computes it, and it is a hash.
//!
//! Writes are the one exception: a device writes often, and a write carries only its classical half. The device vouches
//! for its writes in its next checkpoint, signed both ways (`policy::Action::Checkpoint`), and a peer that no longer
//! trusts the curves counts only checkpointed writes (`policy::checkpointed`).
//!
//! Each signer also has a key that keys are sealed to (`keys`): a device derives it with its other keys, a passkey
//! from its PRF output, so whoever can sign as the signer can also open what is sealed to it, and nothing else can.

use std::fmt;

use p256::ecdsa::signature::Verifier as _;
use sha2::{Digest, Sha256};
use slh_dsa::Sha2_128f;
use slh_dsa::signature::Keypair as _;
use zeroize::{ZeroizeOnDrop, Zeroizing};

use crate::hash::{self, Hasher};
use crate::id::{OpId, SignerId};
use crate::keys::Secret;
use crate::policy::{Action, Op, Refusal};

/// What both halves of a signature sign: ed25519 this followed by the op's id, SLH-DSA the op's id with this as its
/// context string.
pub const SIG_CONTEXT: &[u8] = b"avenDB 2026-10-08 op signature";

/// What a device's hello signs on a connection (`Hello`): SLH-DSA, with this as its context string, over which end of
/// the connection the device speaks for and the connection's TLS exporter. Never an op's id: the context keeps them
/// apart.
pub const HELLO_CONTEXT: &[u8] = b"avenDB 2026-10-08 hello";

/// What a passkey's hello signs with SLH-DSA (`PasskeyHello`), as its context string: never an op's id, nor a
/// device's hello.
pub const PASSKEY_HELLO_CONTEXT: &[u8] = b"avenDB 2026-10-08 passkey hello";

/// The suite of every signer and signature: ed25519 or P-256, each beside SLH-DSA-SHA2-128f. A signer's id hashes it,
/// so a later suite names other signers.
pub const SUITE: u8 = 1;

/// An SLH-DSA-SHA2-128f signature's size.
pub const PQ_SIGNATURE_BYTES: usize = 17_088;

/// The WebAuthn relying party passkeys belong to.
pub const RP_ID: &str = "maia.city";

/// Where a passkey assertion may come from: the website and the Mac app's webview.
pub const ORIGINS: [&str; 3] = ["https://maia.city", "tauri://localhost", "http://tauri.localhost"];

/// The salt the app asks every passkey's PRF for its own keys: the same on every device, so each device that uses the
/// passkey derives the same keys from it.
pub const PRF_SALT: &[u8] = b"avenDB 2026-10-08 passkey prf salt";

/// What a device's salt starts with; 32 random bytes of the device's own follow, kept on the device. They are no
/// secret: without the passkey they derive nothing.
pub const DEVICE_SALT: &[u8] = b"avenDB 2026-10-08 device prf salt ";

/// Authenticator data flags: the user was present, and verified (PIN or biometrics).
const UP: u8 = 0x01;
const UV: u8 = 0x04;

/// A signer's two public keys.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SignerKeys {
    /// A device: its ed25519 key, which is also its iroh endpoint's, and its SLH-DSA key.
    Device { ed25519: [u8; 32], slh: [u8; 32] },
    /// A passkey: its P-256 key (SEC1 compressed), and the SLH-DSA key derived from its PRF output.
    Passkey { p256: [u8; 33], slh: [u8; 32] },
}

impl SignerKeys {
    /// The signer's id: the hash of the suite and both keys.
    pub fn id(&self) -> SignerId {
        let mut h = Hasher::new("signer id");
        h.update(&[SUITE]);
        match self {
            SignerKeys::Device { ed25519, slh } => h.update(&[0]).update(ed25519).update(slh),
            SignerKeys::Passkey { p256, slh } => h.update(&[1]).update(p256).update(slh),
        };
        SignerId(h.finalize())
    }

    fn slh(&self) -> &[u8; 32] {
        match self {
            SignerKeys::Device { slh, .. } | SignerKeys::Passkey { slh, .. } => slh,
        }
    }
}

/// One signer's signature on an op: its keys, which hash to its id; the classical half; and the hash-based half, on
/// every op but a write.
#[derive(Clone, PartialEq, Eq)]
pub struct Signature {
    pub keys: SignerKeys,
    pub classical: Classical,
    /// SLH-DSA-SHA2-128f over the op's id, `PQ_SIGNATURE_BYTES` long.
    pub pq: Option<Vec<u8>>,
}

/// The hash-based half shows only its size.
impl fmt::Debug for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let pq = self.pq.as_ref().map(|s| format!("{} bytes", s.len()));
        f.debug_struct("Signature").field("keys", &self.keys).field("classical", &self.classical).field("pq", &pq).finish()
    }
}

/// The classical half of a signature.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Classical {
    /// ed25519 over `SIG_CONTEXT` and the op's id.
    Ed25519([u8; 64]),
    /// A passkey's WebAuthn assertion whose challenge is the op's id.
    Passkey(Assertion),
}

/// What `navigator.credentials.get` returns; the passkey's key is among the signer's keys.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assertion {
    pub authenticator_data: Vec<u8>,
    pub client_data_json: Vec<u8>,
    /// ECDSA P-256 over SHA-256, DER.
    pub signature: Vec<u8>,
}

/// An op with one signature per signer, in the order of `Op::sigs`: what devices store and send each other.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Signed {
    pub op: Op,
    pub sigs: Vec<Signature>,
}

impl Signed {
    /// The op, if each signer it names signed it: both halves, or on a write the classical half.
    pub fn verify(&self) -> Result<&Op, Refusal> {
        let signers: Vec<SignerId> = self.op.sigs().collect();
        let (id, pq) = (self.op.id(), needs_pq(&self.op));
        let all = signers.len() == self.sigs.len() && signers.iter().zip(&self.sigs).all(|(&s, sig)| verify(s, id, sig, pq));
        if all { Ok(&self.op) } else { Err(Refusal::BadSignature) }
    }
}

/// A device's hello on a connection (P8): its keys, and its SLH-DSA signature over the connection's TLS exporter and
/// the end it speaks for. The TLS handshake proves the classical half, as the device's iroh endpoint key is its ed25519
/// key, and the hello the hash-based half: a connection proves which device is talking even once the curves fall, and
/// a hello can't be replayed on another connection, nor sent back by the other end.
#[derive(Clone, PartialEq, Eq)]
pub struct Hello {
    pub keys: SignerKeys,
    /// SLH-DSA-SHA2-128f, `PQ_SIGNATURE_BYTES` long.
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
    /// ed25519 half is `endpoint`, and the SLH-DSA signature checks out.
    pub fn verify(&self, exporter: &[u8; 32], dialer: bool, endpoint: &[u8; 32]) -> Option<SignerId> {
        let SignerKeys::Device { ed25519, slh } = &self.keys else { return None };
        if ed25519 != endpoint {
            return None;
        }
        let key = slh_dsa::VerifyingKey::<Sha2_128f>::try_from(&slh[..]).ok()?;
        let sig = slh_dsa::Signature::<Sha2_128f>::try_from(&self.sig[..]).ok()?;
        key.try_verify_with_context(&hello_message(exporter, dialer), HELLO_CONTEXT, &sig).ok()?;
        Some(self.keys.id())
    }
}

/// What a hello signs: the end it speaks for, then the exporter.
fn hello_message(exporter: &[u8; 32], dialer: bool) -> [u8; 33] {
    let mut m = [0; 33];
    m[0] = u8::from(dialer);
    m[1..].copy_from_slice(exporter);
    m
}

/// A passkey's hello on a connection (P8c): its keys, its WebAuthn assertion, and its SLH-DSA signature, both over a
/// hash of the connection's TLS exporter, the end it speaks for, and the device whose hello proved that end. A new
/// device says it to a peer to link to its person's vault, and the peer hands it the logs of the vaults the passkey
/// owns (`Lab::link_card`). Bound to the connection and to the device, it can't be replayed on another connection, sent
/// back by the other end, nor said for another device.
#[derive(Clone, PartialEq, Eq)]
pub struct PasskeyHello {
    pub keys: SignerKeys,
    pub assertion: Assertion,
    /// SLH-DSA-SHA2-128f, `PQ_SIGNATURE_BYTES` long.
    pub sig: Vec<u8>,
}

/// The hash-based half shows only its size.
impl fmt::Debug for PasskeyHello {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let (keys, assertion, sig) = (&self.keys, &self.assertion, format!("{} bytes", self.sig.len()));
        f.debug_struct("PasskeyHello").field("keys", keys).field("assertion", assertion).field("sig", &sig).finish()
    }
}

impl PasskeyHello {
    /// The passkey this hello proves on the connection whose TLS exporter is `exporter`, from the end that dialed if
    /// `dialer`, for `device`, the device whose hello proved that end: `None` unless the keys are a passkey's and both
    /// halves check out.
    pub fn verify(&self, exporter: &[u8; 32], dialer: bool, device: SignerId) -> Option<SignerId> {
        let SignerKeys::Passkey { p256, slh } = &self.keys else { return None };
        let challenge = passkey_challenge(exporter, dialer, device);
        if !self.assertion.verify(p256, OpId(challenge)) {
            return None;
        }
        let key = slh_dsa::VerifyingKey::<Sha2_128f>::try_from(&slh[..]).ok()?;
        let sig = slh_dsa::Signature::<Sha2_128f>::try_from(&self.sig[..]).ok()?;
        key.try_verify_with_context(&challenge, PASSKEY_HELLO_CONTEXT, &sig).ok()?;
        Some(self.keys.id())
    }
}

/// What both halves of a passkey's hello sign: a hash of the end it speaks for, the exporter and the device. Its own
/// hash, so no op's id is ever one.
fn passkey_challenge(exporter: &[u8; 32], dialer: bool, device: SignerId) -> [u8; 32] {
    let mut h = Hasher::new("passkey hello");
    h.update(&[u8::from(dialer)]).update(exporter).update(&device.0);
    h.finalize()
}

/// A passkey's pass to the server's relay (P8d): its keys, its WebAuthn assertion and its SLH-DSA signature, both over
/// a hash of an iroh endpoint and the time the pass was made. The relay lets in only the devices the server knows, and
/// a new device with no UDP of its own, as a browser's, reaches nobody but through the relay: before it links, its
/// person's passkey signs it a pass for its own endpoint, and the relay lets that endpoint in for `PASS_LIFE` seconds
/// if the passkey roots a vault the server knows. A pass lets in its endpoint alone, which the relay's handshake
/// proves, so whoever replays it lets in, for what is left of those minutes, only the device it was made for.
#[derive(Clone, PartialEq, Eq)]
pub struct RelayPass {
    pub keys: SignerKeys,
    pub assertion: Assertion,
    /// SLH-DSA-SHA2-128f, `PQ_SIGNATURE_BYTES` long.
    pub sig: Vec<u8>,
    /// The endpoint it lets in: a device's ed25519 key.
    pub endpoint: [u8; 32],
    /// When it was made, by the device's clock: seconds since 1970.
    pub made: u64,
}

/// The hash-based half shows only its size.
impl fmt::Debug for RelayPass {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RelayPass")
            .field("keys", &self.keys)
            .field("assertion", &self.assertion)
            .field("sig", &format!("{} bytes", self.sig.len()))
            .field("endpoint", &self.endpoint)
            .field("made", &self.made)
            .finish()
    }
}

/// What a relay pass signs with SLH-DSA (`RelayPass`), as its context string: never an op's id, nor a hello.
pub const RELAY_PASS_CONTEXT: &[u8] = b"avenDB 2026-10-09 relay pass";

/// How long a pass lets its endpoint onto the relay: seconds from when it was made.
pub const PASS_LIFE: u64 = 10 * 60;

/// How far ahead of the relay's clock a pass may say it was made, as the device's clock may run fast: seconds.
pub const PASS_SKEW: u64 = 5 * 60;

impl RelayPass {
    /// The passkey that lets `endpoint` onto the relay by this pass at `now`, seconds since 1970 by the relay's clock:
    /// `None` unless the pass is for that endpoint, was made in the `PASS_LIFE` seconds before `now` (or at most
    /// `PASS_SKEW` after), its keys are a passkey's and both halves check out.
    pub fn verify(&self, endpoint: &[u8; 32], now: u64) -> Option<SignerId> {
        if self.endpoint != *endpoint || self.made > now.saturating_add(PASS_SKEW) || now >= self.expires() {
            return None;
        }
        let SignerKeys::Passkey { p256, slh } = &self.keys else { return None };
        let challenge = pass_challenge(&self.endpoint, self.made);
        if !self.assertion.verify(p256, OpId(challenge)) {
            return None;
        }
        let key = slh_dsa::VerifyingKey::<Sha2_128f>::try_from(&slh[..]).ok()?;
        let sig = slh_dsa::Signature::<Sha2_128f>::try_from(&self.sig[..]).ok()?;
        key.try_verify_with_context(&challenge, RELAY_PASS_CONTEXT, &sig).ok()?;
        Some(self.keys.id())
    }

    /// When it stops letting its endpoint in: seconds since 1970.
    pub fn expires(&self) -> u64 {
        self.made.saturating_add(PASS_LIFE)
    }
}

/// What both halves of a relay pass sign: a hash of the endpoint and when the pass was made. Its own hash, so no op's
/// id is ever one.
fn pass_challenge(endpoint: &[u8; 32], made: u64) -> [u8; 32] {
    let mut h = Hasher::new("relay pass");
    h.update(endpoint).update(&made.to_be_bytes());
    h.finalize()
}

/// Every op but a write carries the hash-based half of each of its signatures.
pub fn needs_pq(op: &Op) -> bool {
    !matches!(op.action, Action::Write { .. })
}

/// `sig` is `signer`'s signature on op `op`: its keys hash to the signer, its classical half verifies, and so does its
/// hash-based half wherever it is present, as it must be when `pq`.
pub fn verify(signer: SignerId, op: OpId, sig: &Signature, pq: bool) -> bool {
    if sig.keys.id() != signer {
        return false;
    }
    let classical = match (&sig.keys, &sig.classical) {
        (SignerKeys::Device { ed25519, .. }, Classical::Ed25519(bytes)) => {
            let Ok(key) = ed25519_dalek::VerifyingKey::from_bytes(ed25519) else { return false };
            key.verify_strict(&message(op), &ed25519_dalek::Signature::from_bytes(bytes)).is_ok()
        }
        (SignerKeys::Passkey { p256, .. }, Classical::Passkey(a)) => a.verify(p256, op),
        _ => false,
    };
    classical
        && match &sig.pq {
            Some(s) => verify_pq(sig.keys.slh(), op, s),
            None => !pq,
        }
}

fn verify_pq(key: &[u8; 32], op: OpId, sig: &[u8]) -> bool {
    let Ok(key) = slh_dsa::VerifyingKey::<Sha2_128f>::try_from(&key[..]) else { return false };
    let Ok(sig) = slh_dsa::Signature::<Sha2_128f>::try_from(sig) else { return false };
    key.try_verify_with_context(&op.0, SIG_CONTEXT, &sig).is_ok()
}

fn message(op: OpId) -> Vec<u8> {
    [SIG_CONTEXT, &op.0[..]].concat()
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

impl Assertion {
    /// A real assertion by the passkey `key` over `op`: the client data is a `webauthn.get` for this op from one of
    /// our origins, the authenticator data is for our relying party with the user present and verified, and the
    /// signature checks out.
    pub fn verify(&self, key: &[u8; 33], op: OpId) -> bool {
        let Ok(serde_json::Value::Object(client)) = serde_json::from_slice(&self.client_data_json) else { return false };
        let text = |k: &str| client.get(k).and_then(|v| v.as_str());
        if text("type") != Some("webauthn.get") || text("challenge") != Some(&base64url(&op.0)) {
            return false;
        }
        if !text("origin").is_some_and(|o| ORIGINS.contains(&o)) || client.get("crossOrigin").and_then(|v| v.as_bool()) == Some(true) {
            return false;
        }
        let data = &self.authenticator_data;
        if data.len() < 37 || data[..32] != sha256(RP_ID.as_bytes()) || data[32] & (UP | UV) != UP | UV {
            return false;
        }
        let Ok(key) = p256::ecdsa::VerifyingKey::from_sec1_bytes(key) else { return false };
        let Ok(sig) = p256::ecdsa::Signature::from_der(&self.signature) else { return false };
        let signed = [&data[..], &sha256(&self.client_data_json)].concat();
        key.verify(&signed, &sig).is_ok()
    }
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

/// An SLH-DSA key from 32 secret bytes: its three 16-byte seeds read from a hash of them.
fn slh_key(purpose: &str, secret: &[u8; 32]) -> slh_dsa::SigningKey<Sha2_128f> {
    let mut h = Hasher::new(purpose);
    h.update(secret);
    let seeds: Zeroizing<[u8; 48]> = Zeroizing::new(h.reader().array());
    slh_dsa::SigningKey::slh_keygen_internal(&seeds[..16], &seeds[16..32], &seeds[32..])
}

fn sign_pq(key: &slh_dsa::SigningKey<Sha2_128f>, op: OpId) -> Vec<u8> {
    key.try_sign_with_context(&op.0, SIG_CONTEXT, None).expect("a short context").to_vec()
}

fn slh_public(key: &slh_dsa::SigningKey<Sha2_128f>) -> [u8; 32] {
    key.verifying_key().to_bytes().into()
}

/// A device's keys: ed25519, the same key as its iroh endpoint, so a connection proves which device is talking; its
/// SLH-DSA key; and the key keys are sealed to for it. All three derive from 32 secret bytes, and each wipes itself as
/// it is dropped.
pub struct DeviceKey {
    ed25519: ed25519_dalek::SigningKey,
    slh: slh_dsa::SigningKey<Sha2_128f>,
    seal: Secret,
}

impl ZeroizeOnDrop for DeviceKey {}

/// Compiles only while every key a `DeviceKey` or a `Passkey` holds wipes itself as it is dropped, as their
/// `ZeroizeOnDrop` says.
const _: fn() = || {
    fn wipes<T: ZeroizeOnDrop>() {}
    wipes::<ed25519_dalek::SigningKey>();
    wipes::<slh_dsa::SigningKey<Sha2_128f>>();
    wipes::<p256::ecdsa::SigningKey>();
    wipes::<Secret>();
};

impl DeviceKey {
    /// A device's keys from 32 secret bytes: its passkey's PRF output on the device's salt (`Passkey::device`), or, for
    /// the server, bytes of its own.
    pub fn from_secret(secret: [u8; 32]) -> Self {
        let secret = Zeroizing::new(secret);
        let ed25519 = Zeroizing::new(hash::keyed(&secret, "device ed25519 key", b""));
        Self {
            ed25519: ed25519_dalek::SigningKey::from_bytes(&ed25519),
            slh: slh_key("device slh-dsa key", &secret),
            seal: Secret::derive("device seal key", &secret),
        }
    }

    pub fn keys(&self) -> SignerKeys {
        SignerKeys::Device { ed25519: self.ed25519.verifying_key().to_bytes(), slh: slh_public(&self.slh) }
    }

    pub fn id(&self) -> SignerId {
        self.keys().id()
    }

    /// The device's signature on op `op`: the classical half, and with `pq` the hash-based one.
    pub fn sign(&self, op: OpId, pq: bool) -> Signature {
        use ed25519_dalek::Signer as _;
        let classical = Classical::Ed25519(self.ed25519.sign(&message(op)).to_bytes());
        Signature { keys: self.keys(), classical, pq: pq.then(|| sign_pq(&self.slh, op)) }
    }

    /// The device's hello on the connection whose TLS exporter is `exporter`, speaking for the end that dialed if
    /// `dialer`.
    pub fn hello(&self, exporter: &[u8; 32], dialer: bool) -> Hello {
        let message = hello_message(exporter, dialer);
        let sig = self.slh.try_sign_with_context(&message, HELLO_CONTEXT, None).expect("a short context").to_vec();
        Hello { keys: self.keys(), sig }
    }

    /// The secret of the device's iroh endpoint: its ed25519 key's, as iroh takes it.
    pub fn endpoint_secret(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.ed25519.to_bytes())
    }

    /// The classical half alone, as whoever broke the device's ed25519 key holds it: it signs writes, which carry no
    /// other half, and nothing else (the Lab's tampering).
    pub fn classical_half(&self) -> ed25519_dalek::SigningKey {
        self.ed25519.clone()
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
    /// The hash-based key, derived from the PRF output on `PRF_SALT`, as the app derives it in every ceremony.
    slh: slh_dsa::SigningKey<Sha2_128f>,
}

impl ZeroizeOnDrop for Passkey {}

impl Passkey {
    /// A passkey whose private key derives from `seed`.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        let mut bytes = Zeroizing::new(seed);
        let key = loop {
            // a seed outside the curve's scalar range is about 2^-32 likely; hash on until one fits
            if let Ok(key) = p256::ecdsa::SigningKey::from_slice(&*bytes) {
                break key;
            }
            *bytes = hash::hash("software passkey seed", &*bytes);
        };
        let mut passkey = Self { key, counter: 0, slh: slh_key("passkey slh-dsa key", &[0; 32]) };
        passkey.slh = slh_key("passkey slh-dsa key", &passkey.prf(PRF_SALT));
        passkey
    }

    /// The P-256 public key, SEC1 compressed.
    pub fn public(&self) -> [u8; 33] {
        let point = self.key.verifying_key().to_sec1_point(true);
        point.as_bytes().try_into().expect("33 bytes")
    }

    pub fn keys(&self) -> SignerKeys {
        SignerKeys::Passkey { p256: self.public(), slh: slh_public(&self.slh) }
    }

    pub fn id(&self) -> SignerId {
        self.keys().id()
    }

    /// The passkey's signature on op `op`, made in the app at `origin`: an assertion, and with `pq` the hash-based half.
    pub fn sign_at(&mut self, op: OpId, origin: &str, pq: bool) -> Signature {
        use p256::ecdsa::signature::Signer as _;
        self.counter += 1;
        let mut data = sha256(RP_ID.as_bytes()).to_vec();
        data.push(UP | UV);
        data.extend_from_slice(&self.counter.to_be_bytes());
        let client = serde_json::json!({ "type": "webauthn.get", "challenge": base64url(&op.0), "origin": origin, "crossOrigin": false });
        let client_data_json = serde_json::to_vec(&client).expect("JSON");
        let signed = [&data[..], &sha256(&client_data_json)].concat();
        let sig: p256::ecdsa::Signature = self.key.sign(&signed);
        let assertion = Assertion { authenticator_data: data, client_data_json, signature: sig.to_der().as_bytes().to_vec() };
        Signature { keys: self.keys(), classical: Classical::Passkey(assertion), pq: pq.then(|| sign_pq(&self.slh, op)) }
    }

    /// The passkey's signature on op `op`, made on the website.
    pub fn sign(&mut self, op: OpId, pq: bool) -> Signature {
        self.sign_at(op, ORIGINS[0], pq)
    }

    /// The passkey's hello on the connection whose TLS exporter is `exporter`, for the end that dialed if `dialer`,
    /// whose hello proved `device` (`PasskeyHello`): an assertion and the hash-based half, in one ceremony.
    pub fn hello(&mut self, exporter: &[u8; 32], dialer: bool, device: SignerId) -> PasskeyHello {
        let challenge = passkey_challenge(exporter, dialer, device);
        let Classical::Passkey(assertion) = self.sign(OpId(challenge), false).classical else {
            unreachable!("a passkey signs by assertion")
        };
        let sig = self.slh.try_sign_with_context(&challenge, PASSKEY_HELLO_CONTEXT, None).expect("a short context");
        PasskeyHello { keys: self.keys(), assertion, sig: sig.to_vec() }
    }

    /// The passkey's pass to the server's relay for `endpoint`, made at `made`, seconds since 1970 (`RelayPass`): an
    /// assertion and the hash-based half, in one ceremony.
    pub fn pass(&mut self, endpoint: [u8; 32], made: u64) -> RelayPass {
        let challenge = pass_challenge(&endpoint, made);
        let Classical::Passkey(assertion) = self.sign(OpId(challenge), false).classical else {
            unreachable!("a passkey signs by assertion")
        };
        let sig = self.slh.try_sign_with_context(&challenge, RELAY_PASS_CONTEXT, None).expect("a short context");
        RelayPass { keys: self.keys(), assertion, sig: sig.to_vec(), endpoint, made }
    }

    /// Its private key: the seed `from_seed` makes the same passkey again from, as a platform syncs a passkey between
    /// its person's devices. The Lab hands a software passkey to a page this way (`Lab::passkey_secret`); a real one
    /// never leaves its authenticator or the platform's keychain.
    pub fn secret(&self) -> Zeroizing<[u8; 32]> {
        Zeroizing::new(self.key.to_bytes().into())
    }

    /// WebAuthn's PRF extension: 32 bytes the authenticator alone computes from `salt`, in the same ceremony as an
    /// assertion. The browser hashes the salt with the label "WebAuthn PRF" and the authenticator answers with its
    /// `hmac-secret` over that hash; this one uses a keyed SHA-3 hash with a secret of its own instead of HMAC.
    pub fn prf(&self, salt: &[u8]) -> Zeroizing<[u8; 32]> {
        let hashed = sha256(&[&b"WebAuthn PRF\0"[..], salt].concat());
        let scalar: Zeroizing<[u8; 32]> = Zeroizing::new(self.key.to_bytes().into());
        let cred_random = Zeroizing::new(hash::keyed(&scalar, "software passkey credential", b""));
        Zeroizing::new(hash::keyed(&cred_random, "software passkey prf", &hashed))
    }

    /// The key keys are sealed to for this passkey, derived from its PRF output on `PRF_SALT`: a device that uses the
    /// passkey can open what is sealed to it, during that ceremony.
    pub fn seal_secret(&self) -> Secret {
        Secret::derive("passkey seal key", &self.prf(PRF_SALT))
    }

    /// The keys of the device whose salt ends in `nonce`, derived from the passkey's PRF output on that salt, as the
    /// device derives them at every unlock.
    pub fn device(&self, nonce: [u8; 32]) -> DeviceKey {
        DeviceKey::from_secret(*self.prf(&[DEVICE_SALT, &nonce[..]].concat()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::{SpaceId, EntryId, VaultId};
    use crate::policy::{Kind, Principal};

    fn op(author: SignerId, cosigners: Vec<SignerId>) -> Op {
        let action =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(author)], threshold: 1, root: Some(author), nonce: 0, seal_to: vec![] };
        Op { parents: vec![], depth: 0, author, cosigners, action }
    }

    fn write(author: SignerId) -> Op {
        let action = Action::Write {
            space: SpaceId::from_u64(1),
            entry: EntryId::from_u64(1),
            actor: VaultId::from_u64(1),
            epoch: 0,
            deps: vec![],
            branch: crate::policy::Branch::Main,
            body: vec![1, 2, 3],
        };
        Op { parents: vec![], depth: 0, author, cosigners: vec![], action }
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
    fn a_device_signature_covers_the_whole_op() {
        let key = DeviceKey::from_secret([7; 32]);
        let op = op(key.id(), vec![]);
        let signed = Signed { op: op.clone(), sigs: vec![key.sign(op.id(), true)] };
        assert!(signed.verify().is_ok());
        assert_eq!(signed.sigs[0].pq.as_ref().map(Vec::len), Some(PQ_SIGNATURE_BYTES));
        // the same signature on a changed op, or claimed by another signer, is refused
        let other = Op { parents: vec![OpId::from_u64(1)], ..op.clone() };
        assert_eq!(Signed { op: other, sigs: vec![key.sign(op.id(), true)] }.verify().err(), Some(Refusal::BadSignature));
        let claimed = Op { author: DeviceKey::from_secret([8; 32]).id(), ..op.clone() };
        assert_eq!(Signed { op: claimed, sigs: signed.sigs.clone() }.verify().err(), Some(Refusal::BadSignature));
        // and every signer named must sign
        let both = Op { cosigners: vec![DeviceKey::from_secret([8; 32]).id()], ..op };
        assert_eq!(Signed { op: both.clone(), sigs: vec![key.sign(both.id(), true)] }.verify().err(), Some(Refusal::BadSignature));
    }

    #[test]
    fn both_halves_must_verify() {
        let key = DeviceKey::from_secret([7; 32]);
        let governance = op(key.id(), vec![]);
        // a governance op needs the hash-based half: the classical half alone, or beside a broken one, is refused
        let mut classical_only = key.sign(governance.id(), false);
        assert!(!verify(key.id(), governance.id(), &classical_only, true));
        classical_only.pq = Some(vec![0; PQ_SIGNATURE_BYTES]);
        assert!(!verify(key.id(), governance.id(), &classical_only, true));
        // nor does a hash-based half made with another SLH-DSA key pass: the keys no longer hash to the signer
        let thief = DeviceKey::from_secret([9; 32]);
        let mut theirs = thief.sign(governance.id(), true);
        theirs.keys = SignerKeys::Device { ed25519: key.ed25519.verifying_key().to_bytes(), slh: *thief.keys().slh() };
        assert!(!verify(key.id(), governance.id(), &theirs, true));
        // the hash-based half alone, beside a broken classical half, is refused too
        let mut pq_only = key.sign(governance.id(), true);
        pq_only.classical = Classical::Ed25519([0; 64]);
        assert!(!verify(key.id(), governance.id(), &pq_only, true));
        // a write needs only the classical half
        let w = write(key.id());
        assert!(Signed { op: w.clone(), sigs: vec![key.sign(w.id(), false)] }.verify().is_ok());
        assert!(Signed { op: w.clone(), sigs: vec![key.sign(w.id(), true)] }.verify().is_ok());
        assert!(Signed { op: governance.clone(), sigs: vec![key.sign(governance.id(), false)] }.verify().is_err());
    }

    #[test]
    fn a_signer_id_names_both_keys() {
        let (a, b) = (DeviceKey::from_secret([1; 32]), DeviceKey::from_secret([2; 32]));
        let SignerKeys::Device { ed25519, slh } = a.keys() else { unreachable!() };
        let SignerKeys::Device { slh: other, .. } = b.keys() else { unreachable!() };
        assert_ne!(SignerKeys::Device { ed25519, slh: other }.id(), a.id());
        assert_eq!(SignerKeys::Device { ed25519, slh }.id(), a.id());
        // a passkey's keys never hash like a device's
        let p = Passkey::from_seed([1; 32]);
        assert_ne!(p.id(), a.id());
    }

    #[test]
    fn a_passkey_signs_through_webauthn() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let device = DeviceKey::from_secret([2; 32]);
        let op = op(passkey.id(), vec![device.id()]);
        let signed = Signed { op: op.clone(), sigs: vec![passkey.sign(op.id(), true), device.sign(op.id(), true)] };
        assert!(signed.verify().is_ok());
        // the Mac app's webview is an origin too
        assert!(verify(passkey.id(), op.id(), &passkey.sign_at(op.id(), "tauri://localhost", true), true));
    }

    #[test]
    fn a_passkey_assertion_for_anything_else_is_refused() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let key = passkey.public();
        let op = op(passkey.id(), vec![]);
        let sig = passkey.sign(op.id(), true);
        let Classical::Passkey(good) = sig.classical.clone() else { unreachable!() };
        assert!(good.verify(&key, op.id()));
        // another op's challenge
        assert!(!good.verify(&key, OpId::from_u64(1)));
        // another passkey's key, and another signer's id
        assert!(!good.verify(&Passkey::from_seed([2; 32]).public(), op.id()));
        assert!(!verify(Passkey::from_seed([2; 32]).id(), op.id(), &sig, true));
        // a phishing origin
        let Classical::Passkey(phished) = passkey.sign_at(op.id(), "https://maia-city.example", false).classical else { unreachable!() };
        assert!(!phished.verify(&key, op.id()));
        // the user wasn't verified, or the assertion was for another site: the data no longer matches
        let mut unverified = good.clone();
        unverified.authenticator_data[32] = UP;
        assert!(!unverified.verify(&key, op.id()));
        let mut elsewhere = good.clone();
        elsewhere.authenticator_data[..32].copy_from_slice(&sha256(b"example.com"));
        assert!(!elsewhere.verify(&key, op.id()));
        // a registration, not an assertion
        let mut created = good.clone();
        created.client_data_json = String::from_utf8(good.client_data_json.clone()).unwrap().replace("webauthn.get", "webauthn.create").into_bytes();
        assert!(!created.verify(&key, op.id()));
        // a changed signature
        let mut changed = good;
        let last = changed.signature.len() - 1;
        changed.signature[last] ^= 1;
        assert!(!changed.verify(&key, op.id()));
    }

    #[test]
    fn a_hello_proves_its_device_on_its_connection_alone() {
        let key = DeviceKey::from_secret([7; 32]);
        let endpoint = key.ed25519.verifying_key().to_bytes();
        let (exporter, other) = ([1; 32], [2; 32]);
        let hello = key.hello(&exporter, true);
        assert_eq!(hello.verify(&exporter, true, &endpoint), Some(key.id()));
        assert_eq!(hello.sig.len(), PQ_SIGNATURE_BYTES);
        // another connection, sent back by the other end, or under another endpoint key: refused
        assert_eq!(hello.verify(&other, true, &endpoint), None);
        assert_eq!(hello.verify(&exporter, false, &endpoint), None);
        assert_eq!(hello.verify(&exporter, true, &DeviceKey::from_secret([8; 32]).endpoint_secret()), None);
        // whoever broke the device's ed25519 key and signs with an SLH-DSA key of their own proves another device
        let thief = DeviceKey::from_secret([9; 32]);
        let mut stolen = thief.hello(&exporter, true);
        stolen.keys = SignerKeys::Device { ed25519: endpoint, slh: *thief.keys().slh() };
        assert!(stolen.verify(&exporter, true, &endpoint).is_some_and(|s| s != key.id()));
        // an op's signature is no hello, and a passkey says no hello
        let op = Hello { keys: key.keys(), sig: sign_pq(&key.slh, OpId(exporter)) };
        assert_eq!(op.verify(&exporter, true, &endpoint), None);
        let passkey = Passkey::from_seed([1; 32]);
        assert_eq!(Hello { keys: passkey.keys(), sig: hello.sig.clone() }.verify(&exporter, true, &endpoint), None);
    }

    #[test]
    fn a_passkeys_hello_proves_it_for_one_device_on_one_connection() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let device = passkey.device([5; 32]).id();
        let (exporter, other) = ([1; 32], [2; 32]);
        let hello = passkey.hello(&exporter, true, device);
        assert_eq!(hello.verify(&exporter, true, device), Some(passkey.id()));
        assert_eq!(hello.sig.len(), PQ_SIGNATURE_BYTES);
        // another connection, said by the other end, or for another device: refused
        assert_eq!(hello.verify(&other, true, device), None);
        assert_eq!(hello.verify(&exporter, false, device), None);
        assert_eq!(hello.verify(&exporter, true, DeviceKey::from_secret([8; 32]).id()), None);
        // whoever broke the passkey's P-256 key and signs with an SLH-DSA key of their own proves another passkey
        let mut thief = Passkey::from_seed([2; 32]);
        let theirs = thief.hello(&exporter, true, device);
        let keys = SignerKeys::Passkey { p256: passkey.public(), slh: *thief.keys().slh() };
        let stolen = PasskeyHello { keys, assertion: hello.assertion.clone(), sig: theirs.sig };
        assert!(stolen.verify(&exporter, true, device).is_some_and(|p| p != passkey.id()));
        // an op's signature over the same challenge is no hello: its hash-based half signs under the op's context
        let challenge = OpId(passkey_challenge(&exporter, true, device));
        let op = passkey.sign(challenge, true);
        let Classical::Passkey(assertion) = op.classical.clone() else { unreachable!() };
        let replayed = PasskeyHello { keys: passkey.keys(), assertion, sig: op.pq.clone().expect("both halves") };
        assert_eq!(replayed.verify(&exporter, true, device), None);
        // and a device's keys say no passkey's hello
        let key = DeviceKey::from_secret([7; 32]);
        assert_eq!(PasskeyHello { keys: key.keys(), ..hello.clone() }.verify(&exporter, true, device), None);
    }

    #[test]
    fn a_relay_pass_lets_in_one_endpoint_for_ten_minutes() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let endpoint = *passkey.device([5; 32]).endpoint_secret();
        let endpoint = ed25519_dalek::SigningKey::from_bytes(&endpoint).verifying_key().to_bytes();
        let made = 1_791_500_000;
        let pass = passkey.pass(endpoint, made);
        assert_eq!(pass.sig.len(), PQ_SIGNATURE_BYTES);
        // from when it was made, or a little before by a device whose clock runs fast, for ten minutes
        for now in [made, made + PASS_LIFE - 1, made - PASS_SKEW] {
            assert_eq!(pass.verify(&endpoint, now), Some(passkey.id()), "at {now}");
        }
        for now in [made + PASS_LIFE, made - PASS_SKEW - 1, 0, u64::MAX] {
            assert_eq!(pass.verify(&endpoint, now), None, "at {now}");
        }
        // another endpoint, or another time than the one it signed: refused
        assert_eq!(pass.verify(&[9; 32], made), None);
        assert_eq!(RelayPass { made: made + 1, ..pass.clone() }.verify(&endpoint, made), None);
        assert_eq!(RelayPass { endpoint: [9; 32], ..pass.clone() }.verify(&[9; 32], made), None);
        // whoever broke the passkey's P-256 key and signs with an SLH-DSA key of their own makes a pass of another
        let mut thief = Passkey::from_seed([2; 32]);
        let theirs = thief.pass(endpoint, made);
        let keys = SignerKeys::Passkey { p256: passkey.public(), slh: *thief.keys().slh() };
        let stolen = RelayPass { keys, sig: theirs.sig, ..pass.clone() };
        assert!(stolen.verify(&endpoint, made).is_some_and(|p| p != passkey.id()));
        // a passkey's hello, or its signature on an op, over the same challenge is no pass
        let challenge = pass_challenge(&endpoint, made);
        let op = passkey.sign(OpId(challenge), true);
        let Classical::Passkey(assertion) = op.classical.clone() else { unreachable!() };
        let replayed = RelayPass { assertion, sig: op.pq.clone().expect("both halves"), ..pass.clone() };
        assert_eq!(replayed.verify(&endpoint, made), None);
        let hello = passkey.slh.try_sign_with_context(&challenge, PASSKEY_HELLO_CONTEXT, None).expect("a hello's half");
        assert_eq!(RelayPass { sig: hello.to_vec(), ..pass.clone() }.verify(&endpoint, made), None);
        // and a device's keys make no pass
        let key = DeviceKey::from_secret([7; 32]);
        assert_eq!(RelayPass { keys: key.keys(), ..pass.clone() }.verify(&endpoint, made), None);
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
}
