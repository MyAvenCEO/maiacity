//! Every hash avenDB computes itself: edit, blob, key and signer ids, key derivation, key commitment, and the Lab's
//! randomness. All of it is BLAKE3, the hash iroh names and moves every byte by (iroh-blobs), so avenDB has one hash
//! (Samuel, 2026-10-15: "BLAKE3 everywhere", the full iroh-native way):
//!
//! - **Content** (`content`): an edit's id and a blob's id (a schema, a lens, a Classic McEliece key) are the plain
//!   BLAKE3 hash of their bytes, so they are the very names iroh-blobs gives the same bytes (`iroh_blobs::Hash`), and
//!   a file's root is one too. Bytes have one name, wherever they are.
//! - **Purposes** (`hash`, `keyed`, `Hasher`): every other hash names its purpose with BLAKE3's key derivation mode
//!   (`derive_key`, context "avenDB 2026-10-15 <purpose>"), so no two purposes ever share a hash of the same bytes,
//!   nor any purpose a content hash. Its extendable output gives the Lab's randomness.
//!
//! At 256 bits of output, Grover's search leaves 128 bits, as with any 256-bit hash. The hashes inside the standards
//! avenDB uses are theirs: SHA-2 in SLH-DSA-SHA2-128f and the passkeys' P-256, SHA-3 in ML-KEM and Classic McEliece.
//!
//! Where several values go into one hash, each has a fixed size or its length in front of it, so two different lists
//! of values never hash the same.

/// Every context starts with this, then names its purpose: "avenDB 2026-10-15 audience id". The date is the day
/// avenDB's hashes became BLAKE3, as BLAKE3's key derivation asks a context to be: fixed, unique, and the
/// application's.
pub const PREFIX: &str = "avenDB 2026-10-15 ";

/// The name of some bytes: their plain BLAKE3 hash, as iroh-blobs names them.
pub fn content(bytes: &[u8]) -> [u8; 32] {
    blake3::hash(bytes).into()
}

/// A hash being computed, for one purpose.
#[derive(Clone)]
pub struct Hasher(blake3::Hasher);

impl Hasher {
    pub fn new(purpose: &str) -> Hasher {
        Hasher(blake3::Hasher::new_derive_key(&format!("{PREFIX}{purpose}")))
    }

    pub fn update(&mut self, bytes: &[u8]) -> &mut Hasher {
        self.0.update(bytes);
        self
    }

    /// The hash: 32 bytes.
    pub fn finalize(self) -> [u8; 32] {
        self.0.finalize().into()
    }

    /// As many bytes as are read: an XOF.
    pub fn reader(self) -> Reader {
        Reader(self.0.finalize_xof())
    }
}

/// The output of a hash, as long as it is read.
pub struct Reader(blake3::OutputReader);

impl Reader {
    pub fn fill(&mut self, out: &mut [u8]) {
        self.0.fill(out);
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
        assert_eq!(hash("audience id", b"x"), hash("audience id", b"x"));
        assert_ne!(hash("audience id", b"x"), hash("signer id", b"x"));
        assert_ne!(hash("audience id", b"x"), hash("audience id", b"y"));
        assert_ne!(hash("audience id", b"x"), content(b"x"));
        assert_ne!(keyed(&[1; 32], "data key", b""), keyed(&[2; 32], "data key", b""));
        // an XOF: its first 32 bytes are the hash, and it reads on from there
        let mut h = Hasher::new("audience id");
        h.update(b"x");
        let mut r = h.reader();
        assert_eq!(r.array::<32>(), hash("audience id", b"x"));
        assert_ne!(r.array::<32>(), hash("audience id", b"x"));
    }

    #[test]
    fn it_is_blake3() {
        // BLAKE3's own test vectors (github.com/BLAKE3-team/BLAKE3, test_vectors.json): the empty input, hashed and
        // with the key derived for the vectors' context; and "abc", as every BLAKE3 hashes it
        assert_eq!(hex(&content(b"")), "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262");
        assert_eq!(hex(&content(b"abc")), "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85");
        let derived: [u8; 32] = blake3::derive_key("BLAKE3 2019-12-27 16:29:52 test vectors context", b"");
        assert_eq!(hex(&derived), "2cc39783c223154fea8dfb7c1b1660f2ac2dcbd1c1de8277b0b0dd39b7e50d7d");
        // and a purpose of ours, as an independent BLAKE3 computes it (Python's blake3, derive_key_context)
        assert_eq!(hex(&hash("audience id", b"x")), AUDIENCE_X);
    }

    const AUDIENCE_X: &str = "0cdc699db491cc25e39c7f90c9778abf356f19bd6c93afa55e7a6a281c5ec98c";

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
