//! X25519MLKEM768 in pure Rust (P8d), for a node in a browser, where aws-lc-rs doesn't build: ML-KEM-768 from the
//! `ml-kem` crate and X25519 from `x25519-dalek`, as a key exchange group of rustls. It is aws-lc-rs's group byte for
//! byte (draft-ietf-tls-ecdhe-mlkem), so the two agree: the client's share is its ML-KEM-768 encapsulation key, then
//! its X25519 share; the server's share is the ML-KEM-768 ciphertext, then its X25519 share; and the secret is the
//! ML-KEM-768 shared secret, then the X25519 one.

use ml_kem::ml_kem_768::{DecapsulationKey, EncapsulationKey};
use ml_kem::{Decapsulate as _, Encapsulate as _, Kem as _, KeyExport as _, MlKem768, TryKeyInit as _};
use rustls::crypto::{ActiveKeyExchange, CompletedKeyExchange, SharedSecret, SupportedKxGroup};
use rustls::{Error, NamedGroup, PeerMisbehaved, ProtocolVersion};
use x25519_dalek::{EphemeralSecret, PublicKey};

/// An ML-KEM-768 encapsulation key, and a ciphertext.
const MLKEM_KEY: usize = 1184;
const MLKEM_CIPHERTEXT: usize = 1088;
/// An X25519 share.
const X25519_SHARE: usize = 32;

/// X25519MLKEM768, the only key exchange a node in a browser offers, as `pq_provider`'s is elsewhere.
pub static X25519MLKEM768: &dyn SupportedKxGroup = &Hybrid;

#[derive(Debug)]
struct Hybrid;

fn invalid() -> Error {
    Error::PeerMisbehaved(PeerMisbehaved::InvalidKeyShare)
}

/// The X25519 secret of `ours` and the peer's share `theirs`: none for a share of low order, whose secret anyone knows.
fn x25519(ours: EphemeralSecret, theirs: &[u8]) -> Result<[u8; 32], Error> {
    let theirs: [u8; 32] = theirs.try_into().map_err(|_| invalid())?;
    let shared = ours.diffie_hellman(&PublicKey::from(theirs));
    if !shared.was_contributory() {
        return Err(invalid());
    }
    Ok(shared.to_bytes())
}

impl SupportedKxGroup for Hybrid {
    /// The client's side: a fresh ML-KEM-768 key pair and X25519 secret, its share their public halves.
    fn start(&self) -> Result<Box<dyn ActiveKeyExchange>, Error> {
        let (mlkem, key) = MlKem768::generate_keypair();
        let x25519 = EphemeralSecret::random();
        let share = [&key.to_bytes()[..], PublicKey::from(&x25519).as_bytes()].concat();
        Ok(Box::new(Started { mlkem, x25519, share }))
    }

    /// The server's side, all at once: an encapsulation to the client's key, and a fresh X25519 secret.
    fn start_and_complete(&self, client: &[u8]) -> Result<CompletedKeyExchange, Error> {
        if client.len() != MLKEM_KEY + X25519_SHARE {
            return Err(invalid());
        }
        let (key, theirs) = client.split_at(MLKEM_KEY);
        let key = EncapsulationKey::new_from_slice(key).map_err(|_| invalid())?;
        let (ciphertext, mlkem) = key.encapsulate();
        let ours = EphemeralSecret::random();
        let share = [&ciphertext[..], PublicKey::from(&ours).as_bytes()].concat();
        let x25519 = x25519(ours, theirs)?;
        Ok(CompletedKeyExchange {
            group: NamedGroup::X25519MLKEM768,
            pub_key: share,
            secret: SharedSecret::from([&mlkem[..], &x25519[..]].concat()),
        })
    }

    fn name(&self) -> NamedGroup {
        NamedGroup::X25519MLKEM768
    }

    fn usable_for_version(&self, version: ProtocolVersion) -> bool {
        version == ProtocolVersion::TLSv1_3
    }
}

/// The client's side once its share is sent: its secrets, until the server's share comes back.
struct Started {
    mlkem: DecapsulationKey,
    x25519: EphemeralSecret,
    share: Vec<u8>,
}

impl ActiveKeyExchange for Started {
    fn complete(self: Box<Self>, server: &[u8]) -> Result<SharedSecret, Error> {
        if server.len() != MLKEM_CIPHERTEXT + X25519_SHARE {
            return Err(invalid());
        }
        let (ciphertext, theirs) = server.split_at(MLKEM_CIPHERTEXT);
        let Started { mlkem, x25519: ours, .. } = *self;
        let mlkem = mlkem.decapsulate_slice(ciphertext).map_err(|_| invalid())?;
        let x25519 = x25519(ours, theirs)?;
        Ok(SharedSecret::from([&mlkem[..], &x25519[..]].concat()))
    }

    fn pub_key(&self) -> &[u8] {
        &self.share
    }

    fn group(&self) -> NamedGroup {
        NamedGroup::X25519MLKEM768
    }
}

#[cfg(test)]
mod tests {
    use rustls::crypto::SupportedKxGroup;
    use rustls::crypto::aws_lc_rs::kx_group;
    use rustls::{NamedGroup, ProtocolVersion};

    use super::X25519MLKEM768;

    /// The ML-KEM-768 encapsulation key, then the X25519 share; the ciphertext, then the X25519 share.
    const CLIENT_SHARE: usize = 1184 + 32;
    const SERVER_SHARE: usize = 1088 + 32;

    /// A key exchange between a client of group `client` and a server of group `server`: the secret each side agreed.
    fn agree(client: &dyn SupportedKxGroup, server: &dyn SupportedKxGroup) -> (Vec<u8>, Vec<u8>) {
        let started = client.start().expect("the client's share");
        assert_eq!(started.pub_key().len(), CLIENT_SHARE);
        assert_eq!(started.group(), NamedGroup::X25519MLKEM768);
        let completed = server.start_and_complete(started.pub_key()).expect("the server's share");
        assert_eq!(completed.pub_key.len(), SERVER_SHARE);
        assert_eq!(completed.group, NamedGroup::X25519MLKEM768);
        let theirs = completed.secret.secret_bytes().to_vec();
        let ours = started.complete(&completed.pub_key).expect("the client's secret");
        (ours.secret_bytes().to_vec(), theirs)
    }

    #[test]
    fn it_agrees_with_aws_lc_rs_either_way() {
        assert_eq!(X25519MLKEM768.name(), NamedGroup::X25519MLKEM768);
        assert!(X25519MLKEM768.usable_for_version(ProtocolVersion::TLSv1_3));
        assert!(!X25519MLKEM768.usable_for_version(ProtocolVersion::TLSv1_2));
        let aws_lc_rs = kx_group::X25519MLKEM768;
        for (client, server) in [(X25519MLKEM768, aws_lc_rs), (aws_lc_rs, X25519MLKEM768)] {
            let (ours, theirs) = agree(client, server);
            assert_eq!(ours.len(), 64, "the ML-KEM-768 secret, then the X25519 one");
            assert_eq!(ours, theirs);
        }
        let (a, _) = agree(X25519MLKEM768, X25519MLKEM768);
        let (b, _) = agree(X25519MLKEM768, X25519MLKEM768);
        assert_ne!(a, b, "a fresh secret every time");
    }

    #[test]
    fn it_refuses_a_malformed_share() {
        let client = kx_group::X25519MLKEM768.start().expect("a share");
        let share = client.pub_key().to_vec();
        // a share cut short, or one byte too long
        assert!(X25519MLKEM768.start_and_complete(&share[..CLIENT_SHARE - 1]).is_err());
        assert!(X25519MLKEM768.start_and_complete(&[&share[..], &[0]].concat()).is_err());
        // an X25519 share of low order agrees a secret anyone knows
        let low_order = [&share[..1184], &[0; 32]].concat();
        assert!(X25519MLKEM768.start_and_complete(&low_order).is_err());
        // an encapsulation key whose coefficients don't reduce modulo q isn't one
        let not_a_key = [&[0xff; 1184][..], &share[1184..]].concat();
        assert!(X25519MLKEM768.start_and_complete(&not_a_key).is_err());

        let ours = X25519MLKEM768.start().expect("a share");
        let server = kx_group::X25519MLKEM768.start_and_complete(ours.pub_key()).expect("the server's share");
        let reply = server.pub_key;
        for bad in [reply[..SERVER_SHARE - 1].to_vec(), [&reply[..1088], &[0; 32]].concat()] {
            let ours = X25519MLKEM768.start().expect("a share");
            assert!(ours.complete(&bad).is_err(), "{} bytes", bad.len());
        }
    }
}
