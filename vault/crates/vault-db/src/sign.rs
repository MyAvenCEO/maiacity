//! Signatures: what makes an op's signers its signers. A signature signs the op's id, which hashes everything the op
//! says, so the rules (`policy`) only ever see ops whose author and cosigners really signed them.
//!
//! - A device signs with its ed25519 key, the key of its iroh endpoint, and its signer id is that public key.
//! - A passkey signs through WebAuthn, so its signature is an assertion: the authenticator signs its data followed by
//!   the SHA-256 of the client data, whose challenge is the op's id. Passkeys only sign P-256, and its signer id is
//!   the hash of its public key.
//! - A recovery code derives an ed25519 signer, kept on paper rather than on a device, that owns the human vault
//!   beside the passkey.

use std::fmt;

use p256::ecdsa::signature::Verifier as _;
use sha2::{Digest, Sha256};

use crate::id::{OpId, SignerId};
use crate::policy::{Op, Refusal};

/// What an ed25519 signature signs, followed by the op's id.
pub const SIG_CONTEXT: &[u8] = b"maiacity vault-db 2026-10-08 op signature v1";

/// The WebAuthn relying party passkeys belong to.
pub const RP_ID: &str = "maia.city";

/// Where a passkey assertion may come from: the website and the Mac app's webview.
pub const ORIGINS: [&str; 3] = ["https://maia.city", "tauri://localhost", "http://tauri.localhost"];

const PASSKEY_ID: &str = "maiacity vault-db 2026-10-08 passkey id v1";
const RECOVERY_SIGNER: &str = "maiacity vault-db 2026-10-08 recovery signer v1";

/// Authenticator data flags: the user was present, and verified (PIN or biometrics).
const UP: u8 = 0x01;
const UV: u8 = 0x04;

/// One signer's signature on an op.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Signature {
    /// ed25519 over `SIG_CONTEXT` and the op's id; the signer id is the public key.
    Ed25519([u8; 64]),
    /// A passkey's WebAuthn assertion whose challenge is the op's id.
    Passkey(Assertion),
}

/// What `navigator.credentials.get` returns, plus the passkey's public key (its hash is the signer id).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assertion {
    /// SEC1, compressed: 33 bytes.
    pub key: Vec<u8>,
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
    /// The op, if each signer it names signed it.
    pub fn verify(&self) -> Result<&Op, Refusal> {
        let signers: Vec<SignerId> = self.op.sigs().collect();
        let id = self.op.id();
        let all = signers.len() == self.sigs.len() && signers.iter().zip(&self.sigs).all(|(&s, sig)| verify(s, id, sig));
        if all { Ok(&self.op) } else { Err(Refusal::BadSignature) }
    }
}

/// `sig` is `signer`'s signature on op `op`.
pub fn verify(signer: SignerId, op: OpId, sig: &Signature) -> bool {
    match sig {
        Signature::Ed25519(bytes) => {
            let Ok(key) = ed25519_dalek::VerifyingKey::from_bytes(&signer.0) else { return false };
            key.verify_strict(&message(op), &ed25519_dalek::Signature::from_bytes(bytes)).is_ok()
        }
        Signature::Passkey(a) => a.verify(signer, op),
    }
}

fn message(op: OpId) -> Vec<u8> {
    [SIG_CONTEXT, &op.0[..]].concat()
}

/// A passkey's signer id: the hash of its public key.
pub fn passkey_id(key: &[u8]) -> SignerId {
    let mut h = blake3::Hasher::new_derive_key(PASSKEY_ID);
    h.update(key);
    SignerId(*h.finalize().as_bytes())
}

fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

impl Assertion {
    /// A real assertion by `signer` over `op`: the key hashes to the signer, the client data is a `webauthn.get` for
    /// this op from one of our origins, the authenticator data is for our relying party with the user present and
    /// verified, and the signature checks out.
    pub fn verify(&self, signer: SignerId, op: OpId) -> bool {
        if self.key.len() != 33 || passkey_id(&self.key) != signer {
            return false;
        }
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
        let Ok(key) = p256::ecdsa::VerifyingKey::from_sec1_bytes(&self.key) else { return false };
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

/// A device's key: ed25519, the same key as its iroh endpoint, so a connection proves which device is talking.
pub struct DeviceKey(ed25519_dalek::SigningKey);

impl DeviceKey {
    pub fn from_secret(secret: [u8; 32]) -> Self {
        Self(ed25519_dalek::SigningKey::from_bytes(&secret))
    }

    pub fn id(&self) -> SignerId {
        SignerId(self.0.verifying_key().to_bytes())
    }

    pub fn sign(&self, op: OpId) -> Signature {
        use ed25519_dalek::Signer as _;
        Signature::Ed25519(self.0.sign(&message(op)).to_bytes())
    }
}

/// A passkey as the Lab and the tests hold it: a software authenticator answering `navigator.credentials.get` with
/// the user present and verified. A real one lives in the platform's keychain and signs the same way.
pub struct Passkey {
    key: p256::ecdsa::SigningKey,
    counter: u32,
}

impl Passkey {
    /// A passkey whose private key derives from `seed`.
    pub fn from_seed(seed: [u8; 32]) -> Self {
        let mut bytes = seed;
        loop {
            // a seed outside the curve's scalar range is about 2^-32 likely; hash on until one fits
            if let Ok(key) = p256::ecdsa::SigningKey::from_slice(&bytes) {
                return Self { key, counter: 0 };
            }
            bytes = *blake3::hash(&bytes).as_bytes();
        }
    }

    /// The public key, SEC1 compressed.
    pub fn public(&self) -> Vec<u8> {
        self.key.verifying_key().to_sec1_point(true).as_bytes().to_vec()
    }

    pub fn id(&self) -> SignerId {
        passkey_id(&self.public())
    }

    /// An assertion over op `op`, made in the app at `origin`.
    pub fn sign_at(&mut self, op: OpId, origin: &str) -> Signature {
        use p256::ecdsa::signature::Signer as _;
        self.counter += 1;
        let mut data = sha256(RP_ID.as_bytes()).to_vec();
        data.push(UP | UV);
        data.extend_from_slice(&self.counter.to_be_bytes());
        let client = serde_json::json!({ "type": "webauthn.get", "challenge": base64url(&op.0), "origin": origin, "crossOrigin": false });
        let client_data_json = serde_json::to_vec(&client).expect("JSON");
        let signed = [&data[..], &sha256(&client_data_json)].concat();
        let sig: p256::ecdsa::Signature = self.key.sign(&signed);
        Signature::Passkey(Assertion {
            key: self.public(),
            authenticator_data: data,
            client_data_json,
            signature: sig.to_der().as_bytes().to_vec(),
        })
    }

    /// An assertion over op `op`, made on the website.
    pub fn sign(&mut self, op: OpId) -> Signature {
        self.sign_at(op, ORIGINS[0])
    }
}

/// A recovery code: 64 characters in 16 groups of 4, from Crockford's base32 (no I, L, O or U), 320 random bits. It
/// derives an ed25519 signer that owns the human vault beside the passkey, so the code alone can add a new passkey
/// and new devices after every device is gone. (From P3 it also derives the recipient the vault key is sealed to.)
#[derive(Clone, PartialEq, Eq)]
pub struct RecoveryCode([u8; 40]);

const BASE32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

impl RecoveryCode {
    /// A code from 40 random bytes (the operating system's randomness in the app; a seed on the Lab).
    pub fn new(entropy: [u8; 40]) -> Self {
        Self(entropy)
    }

    /// The code as typed: case, spaces and dashes don't matter, and O, I and L read as 0, 1 and 1.
    pub fn parse(typed: &str) -> Option<Self> {
        let mut bits: Vec<u8> = Vec::with_capacity(64);
        for c in typed.chars().filter(|c| !c.is_whitespace() && *c != '-') {
            let c = match c.to_ascii_uppercase() {
                'O' => '0',
                'I' | 'L' => '1',
                c => c,
            };
            bits.push(BASE32.iter().position(|&b| b as char == c)? as u8);
        }
        if bits.len() != 64 {
            return None;
        }
        let mut bytes = [0u8; 40];
        for (i, v) in bits.into_iter().enumerate() {
            for j in 0..5 {
                if v >> (4 - j) & 1 == 1 {
                    let bit = i * 5 + j;
                    bytes[bit / 8] |= 0x80 >> (bit % 8);
                }
            }
        }
        Some(Self(bytes))
    }

    /// The recovery signer: an ed25519 key derived from the code.
    pub fn signer(&self) -> DeviceKey {
        let mut h = blake3::Hasher::new_derive_key(RECOVERY_SIGNER);
        h.update(&self.0);
        DeviceKey::from_secret(*h.finalize().as_bytes())
    }
}

impl fmt::Display for RecoveryCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for i in 0..64 {
            let v = (0..5).fold(0usize, |v, j| {
                let bit = i * 5 + j;
                v << 1 | (self.0[bit / 8] >> (7 - bit % 8) & 1) as usize
            });
            if i > 0 && i % 4 == 0 {
                f.write_str(" ")?;
            }
            write!(f, "{}", BASE32[v] as char)?;
        }
        Ok(())
    }
}

/// Only the first group shows, so a code never ends up whole in a log.
impl fmt::Debug for RecoveryCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let shown = self.to_string();
        write!(f, "RecoveryCode({} …)", &shown[..4])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::policy::{Action, Kind, Principal};

    fn op(author: SignerId, cosigners: Vec<SignerId>) -> Op {
        let action =
            Action::Genesis { kind: Kind::Human, owners: vec![Principal::Signer(author)], threshold: 1, root: Some(author), nonce: 0 };
        Op { parents: vec![], depth: 0, author, cosigners, action }
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
        let signed = Signed { op: op.clone(), sigs: vec![key.sign(op.id())] };
        assert!(signed.verify().is_ok());
        // the same signature on a changed op, or claimed by another signer, is refused
        let other = Op { parents: vec![OpId::from_u64(1)], ..op.clone() };
        assert_eq!(Signed { op: other, sigs: vec![key.sign(op.id())] }.verify().err(), Some(Refusal::BadSignature));
        let claimed = Op { author: DeviceKey::from_secret([8; 32]).id(), ..op.clone() };
        assert_eq!(Signed { op: claimed, sigs: signed.sigs.clone() }.verify().err(), Some(Refusal::BadSignature));
        // and every signer named must sign
        let both = Op { cosigners: vec![DeviceKey::from_secret([8; 32]).id()], ..op };
        assert_eq!(Signed { op: both.clone(), sigs: vec![key.sign(both.id())] }.verify().err(), Some(Refusal::BadSignature));
    }

    #[test]
    fn a_passkey_signs_through_webauthn() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let device = DeviceKey::from_secret([2; 32]);
        let op = op(passkey.id(), vec![device.id()]);
        let signed = Signed { op: op.clone(), sigs: vec![passkey.sign(op.id()), device.sign(op.id())] };
        assert!(signed.verify().is_ok());
        // the Mac app's webview is an origin too
        assert!(verify(passkey.id(), op.id(), &passkey.sign_at(op.id(), "tauri://localhost")));
    }

    #[test]
    fn a_passkey_assertion_for_anything_else_is_refused() {
        let mut passkey = Passkey::from_seed([1; 32]);
        let op = op(passkey.id(), vec![]);
        let Signature::Passkey(good) = passkey.sign(op.id()) else { unreachable!() };
        assert!(good.verify(passkey.id(), op.id()));
        // another op's challenge
        assert!(!good.verify(passkey.id(), OpId::from_u64(1)));
        // another passkey's id
        assert!(!good.verify(Passkey::from_seed([2; 32]).id(), op.id()));
        // a phishing origin
        let Signature::Passkey(phished) = passkey.sign_at(op.id(), "https://maia-city.example") else { unreachable!() };
        assert!(!phished.verify(passkey.id(), op.id()));
        // the user wasn't verified, or the assertion was for another site: the data no longer matches
        let mut unverified = good.clone();
        unverified.authenticator_data[32] = UP;
        assert!(!unverified.verify(passkey.id(), op.id()));
        let mut elsewhere = good.clone();
        elsewhere.authenticator_data[..32].copy_from_slice(&sha256(b"example.com"));
        assert!(!elsewhere.verify(passkey.id(), op.id()));
        // a registration, not an assertion
        let mut created = good.clone();
        created.client_data_json = String::from_utf8(good.client_data_json.clone()).unwrap().replace("webauthn.get", "webauthn.create").into_bytes();
        assert!(!created.verify(passkey.id(), op.id()));
        // a changed signature
        let mut changed = good;
        let last = changed.signature.len() - 1;
        changed.signature[last] ^= 1;
        assert!(!changed.verify(passkey.id(), op.id()));
    }

    #[test]
    fn a_recovery_code_reads_back_and_derives_one_signer() {
        let code = RecoveryCode::new(std::array::from_fn(|i| (i * 37 + 11) as u8));
        let shown = code.to_string();
        assert_eq!(shown.split(' ').count(), 16);
        assert_eq!(shown.replace(' ', "").len(), 64);
        // typed back in lower case, with dashes, and with O for 0: the same code, the same signer
        let typed = shown.to_lowercase().replace(' ', "-").replace('0', "o");
        let back = RecoveryCode::parse(&typed).unwrap();
        assert!(back == code);
        assert_eq!(back.signer().id(), code.signer().id());
        // one character off is another code; a short one is none
        let mut off: Vec<char> = shown.chars().collect();
        off[0] = if off[0] == 'A' { 'B' } else { 'A' };
        let off: String = off.into_iter().collect();
        assert_ne!(RecoveryCode::parse(&off).unwrap().signer().id(), code.signer().id());
        assert!(RecoveryCode::parse(&shown[..60]).is_none() && RecoveryCode::parse("U").is_none());
        // it never prints whole
        assert!(!format!("{code:?}").contains(&shown[5..9]));
    }
}
