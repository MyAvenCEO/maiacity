//! Every hash avenDB computes itself: edit, blob, key and signer ids, key derivation, key commitment, and the Lab's
//! randomness. All of it is cSHAKE256 (SHA-3's customizable XOF, NIST SP 800-185), with a customization string that
//! names the purpose, so no two purposes ever share a hash of the same bytes. SHA-3 has 24 rounds where the best
//! published attacks reach 6, and no algebraic structure for a quantum computer or better mathematics to use; at 256
//! bits of output, Grover's search leaves 128 bits.
//!
//! Where several values go into one hash, each has a fixed size or its length in front of it, so two different lists
//! of values never hash the same.

use cshake::digest::{ExtendableOutput, Update, XofReader};
use cshake::{CShake256, CShake256Reader};

/// Every customization string starts with this, then names its purpose: "avenDB 2026-10-08 op id", an edit's id. A
/// purpose keeps the words it was given (an edit was once called an op), so every id already made stays what it was.
pub const PREFIX: &str = "avenDB 2026-10-08 ";

/// A hash being computed, for one purpose.
#[derive(Clone)]
pub struct Hasher(CShake256);

impl Hasher {
    pub fn new(purpose: &str) -> Hasher {
        Hasher(CShake256::new_with_function_name(b"", format!("{PREFIX}{purpose}").as_bytes()))
    }

    pub fn update(&mut self, bytes: &[u8]) -> &mut Hasher {
        self.0.update(bytes);
        self
    }

    /// The hash: 32 bytes.
    pub fn finalize(self) -> [u8; 32] {
        let mut out = [0u8; 32];
        self.0.finalize_xof().read(&mut out);
        out
    }

    /// As many bytes as are read: an XOF.
    pub fn reader(self) -> Reader {
        Reader(self.0.finalize_xof())
    }
}

/// The output of a hash, as long as it is read.
pub struct Reader(CShake256Reader);

impl Reader {
    pub fn fill(&mut self, out: &mut [u8]) {
        self.0.read(out);
    }

    pub fn array<const N: usize>(&mut self) -> [u8; N] {
        let mut out = [0u8; N];
        self.fill(&mut out);
        out
    }
}

/// The hash of `bytes` for `purpose`.
pub fn hash(purpose: &str, bytes: &[u8]) -> [u8; 32] {
    let mut h = Hasher::new(purpose);
    h.update(bytes);
    h.finalize()
}

/// A hash keyed by 32 secret bytes: a key derived from another, or a pseudorandom function of it. The key comes first
/// and has a fixed size, so it can't run into what follows.
pub fn keyed(key: &[u8; 32], purpose: &str, bytes: &[u8]) -> [u8; 32] {
    let mut h = Hasher::new(purpose);
    h.update(key).update(bytes);
    h.finalize()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn purposes_keep_hashes_apart() {
        assert_eq!(hash("op id", b"x"), hash("op id", b"x"));
        assert_ne!(hash("op id", b"x"), hash("blob id", b"x"));
        assert_ne!(hash("op id", b"x"), hash("op id", b"y"));
        assert_ne!(keyed(&[1; 32], "data key", b""), keyed(&[2; 32], "data key", b""));
        // an XOF: its first 32 bytes are the hash, and it reads on from there
        let mut h = Hasher::new("op id");
        h.update(b"x");
        let mut r = h.reader();
        assert_eq!(r.array::<32>(), hash("op id", b"x"));
        assert_ne!(r.array::<32>(), hash("op id", b"x"));
    }

    #[test]
    fn it_is_cshake256() {
        // NIST SP 800-185's cSHAKE256 samples 3 and 4: N = "", S = "Email Signature", 512 bits of output
        let sample = |data: &[u8]| {
            let mut h = CShake256::new_with_function_name(b"", b"Email Signature");
            h.update(data);
            let mut out = [0u8; 64];
            h.finalize_xof().read(&mut out);
            hex(&out)
        };
        let three = "d008828e2b80ac9d2218ffee1d070c48b8e4c87bff32c9699d5b6896eee0edd1\
                     64020e2be0560858d9c00c037e34a96937c561a74c412bb4c746469527281c8c";
        let four = "07dc27b11e51fbac75bc7b3c1d983e8b4b85fb1defaf218912ac864302730917\
                    27f42b17ed1df63e8ec118f04b23633c1dfb1574c8fb55cb45da8e25afb092bb";
        assert_eq!(sample(&[0, 1, 2, 3]), three);
        assert_eq!(sample(&(0..200).map(|i| i as u8).collect::<Vec<_>>()), four);
        // and ours, as an independent cSHAKE256 computes it
        assert_eq!(hex(&hash("op id", b"x")), "71b6752d416f7dc9ba44f80028a435c31d2aa9b0c0f56ecbe52e80607642d6e1");
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
