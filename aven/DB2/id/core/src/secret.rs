//! Secrets and the randomness that makes them (id/caps/README.md, "Keys"). A [`Secret`] is 32 bytes that are wiped
//! when dropped, compared in constant time and never printed. Randomness comes from the caller through [`Entropy`], so
//! the crate builds for wasm32 with no source of its own, and tests can replay a seed.

use subtle::{Choice, ConstantTimeEq};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

/// 32 secret bytes: a PRF output, an epoch's key, a seed.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Secret([u8; 32]);

impl Secret {
    /// Takes the bytes and wipes the caller's copy.
    pub fn take(bytes: &mut [u8; 32]) -> Secret {
        let secret = Secret(*bytes);
        bytes.zeroize();
        secret
    }

    /// Fresh from `entropy`.
    pub fn generate(entropy: &mut impl Entropy) -> Secret {
        let mut bytes = Zeroizing::new([0u8; 32]);
        entropy.fill(bytes.as_mut());
        Secret(*bytes)
    }

    /// The bytes, for the derivation or the cipher that needs them. Never print or store them.
    pub fn expose(&self) -> &[u8; 32] {
        &self.0
    }
}

impl ConstantTimeEq for Secret {
    fn ct_eq(&self, other: &Self) -> Choice {
        self.0.ct_eq(&other.0)
    }
}

impl PartialEq for Secret {
    fn eq(&self, other: &Self) -> bool {
        self.ct_eq(other).into()
    }
}

impl Eq for Secret {}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(..)")
    }
}

/// Where fresh secrets and encapsulation randomness come from: the OS's generator in a peer, `crypto.getRandomValues`
/// in the Peer-Light, a replayable stream in tests.
pub trait Entropy {
    fn fill(&mut self, out: &mut [u8]);
}

impl<F: FnMut(&mut [u8])> Entropy for F {
    fn fill(&mut self, out: &mut [u8]) {
        self(out)
    }
}

/// A replayable stream for tests and the box: BLAKE3's output for `avenSANDBOX test entropy 1` and a name. Public on
/// purpose; never a real key's source.
pub struct TestEntropy(blake3::OutputReader);

impl TestEntropy {
    pub fn new(name: &str) -> TestEntropy {
        let mut hasher = blake3::Hasher::new_derive_key("avenSANDBOX test entropy 1");
        hasher.update(name.as_bytes());
        TestEntropy(hasher.finalize_xof())
    }
}

impl Entropy for TestEntropy {
    fn fill(&mut self, out: &mut [u8]) {
        self.0.fill(out)
    }
}
