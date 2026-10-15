//! Sealed blobs, version 2: a file of any size, from a photo to a film of several terabytes, encrypted so that it
//! travels and is kept as iroh blobs that anyone can verify and only its readers can open, and so that any range of it
//! opens on its own.
//!
//! Each file has a key of its own (`FileKey`). A device derives it from what the file holds, keyed by a secret of the
//! person's vault (`Convergent`, `Lab::convergence`): the same file sealed again by any device of that vault, into any
//! vault it acts for, seals to the same bytes, which iroh's content addressing then keeps once; another person's
//! devices, without that secret, derive an unrelated key, so nobody else can tell which files they hold. A device
//! with no such secret takes 32 random bytes. Its plaintext is cut into segments of 65,520 bytes (`SEGMENT`), each
//! encrypted with ChaCha20-Poly1305 under the file's payload key (a key derived from the file key for this purpose
//! alone), its nonce the segment's number in the file, big-endian in 11 bytes, then a byte that marks the file's last
//! segment, as in age's STREAM. Each sealed segment is exactly 64 KiB (`SEALED`): four of iroh-blobs' 16 KiB chunk
//! groups, so a reader that seeks fetches whole segments and nothing more, and every byte it fetches is verified
//! against the blob's BLAKE3 hash before it is decrypted. Segments cannot be swapped, reordered, dropped or moved to
//! another file: each opens only at its own place, under its own file's key, and only the last one at the end.
//!
//! 16,384 segments make a piece (`PIECE`, 1 GiB of ciphertext): a file is one piece or several, each its own blob, the
//! last one shorter. A file of several pieces is named by an iroh HashSeq of their hashes. The pieces carry no header:
//! the file key, the file's length and this format are in the edit that brings the file, inside its encrypted body,
//! and the edit names the file's root hash in the clear, so whoever keeps it without a key knows what to keep.

use std::ops::Range;

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use rand_core::CryptoRng;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::hash;

/// The format's version, as the edit that brings a file names it: 2 since its keys are derived with BLAKE3 (1 with
/// SHA-3).
pub const VERSION: u8 = 2;
/// Plaintext bytes in a segment, but the last of a file.
pub const SEGMENT: usize = 65_520;
/// The tag each segment gains.
pub const TAG: usize = 16;
/// Bytes of a sealed segment, but the last of a file: 64 KiB, four of iroh-blobs' chunk groups.
pub const SEALED: usize = SEGMENT + TAG;
/// Segments in a piece, but the last of a file.
pub const PIECE_SEGMENTS: u64 = 16_384;
/// Bytes of a piece, but the last of a file: 1 GiB.
pub const PIECE: u64 = PIECE_SEGMENTS * SEALED as u64;

/// A file's key: 32 random bytes, wiped as it is dropped.
#[derive(Clone, PartialEq, Eq)]
pub struct FileKey([u8; 32]);

impl FileKey {
    /// A new file's key, from `rng`.
    pub fn random(rng: &mut impl CryptoRng) -> FileKey {
        let mut key = [0u8; 32];
        rng.fill_bytes(&mut key);
        FileKey(key)
    }

    /// The key of a file whose plaintext `bytes` hold all of it: its convergent key under `secret`, as `Convergent`
    /// derives it a piece at a time.
    pub fn convergent(secret: &[u8; 32], bytes: &[u8]) -> FileKey {
        let mut c = Convergent::new(secret, bytes.len() as u64);
        c.push(bytes);
        c.key()
    }

    /// The key the edit that brought the file carried.
    pub fn from_bytes(key: [u8; 32]) -> FileKey {
        FileKey(key)
    }

    /// Its bytes, for the edit that brings the file, which encrypts them.
    pub fn bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// The cipher of the file's segments, under its payload key.
    fn cipher(&self) -> ChaCha20Poly1305 {
        let payload = Zeroizing::new(hash::keyed(&self.0, "blob payload", b""));
        ChaCha20Poly1305::new(&(*payload).into())
    }
}

impl Zeroize for FileKey {
    fn zeroize(&mut self) {
        self.0.zeroize();
    }
}

impl Drop for FileKey {
    fn drop(&mut self) {
        self.zeroize();
    }
}

impl ZeroizeOnDrop for FileKey {}

impl std::fmt::Debug for FileKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("FileKey(..)")
    }
}

/// A file's convergent key as its plaintext comes, a chunk at a time: BLAKE3's key derivation for this purpose
/// (`hash::Hasher`) over the person's secret, the format, the file's length and every byte of it. Whoever holds the
/// secret and the same bytes derives the same key; nobody without the secret learns anything of the bytes from it. The
/// key seals one plaintext only, so a sealer that derives it before it seals checks it again over the bytes it seals
/// (`Node::store_file`): two different files under one key would share their nonces.
pub struct Convergent {
    hasher: hash::Hasher,
    len: u64,
    seen: u64,
}

impl Convergent {
    /// The key of a file of `len` bytes under `secret`, before a byte of it.
    pub fn new(secret: &[u8; 32], len: u64) -> Convergent {
        let mut hasher = hash::Hasher::new("avendb convergent file key");
        hasher.update(secret).update(&[VERSION]).update(&len.to_be_bytes());
        Convergent { hasher, len, seen: 0 }
    }

    /// The file's next bytes.
    pub fn push(&mut self, bytes: &[u8]) {
        self.seen += bytes.len() as u64;
        self.hasher.update(bytes);
    }

    /// The bytes it saw so far.
    pub fn seen(&self) -> u64 {
        self.seen
    }

    /// The key, once every byte of the file came: none if more or fewer came than its length.
    pub fn finish(self) -> Option<FileKey> {
        (self.seen == self.len).then(|| FileKey(self.hasher.finalize()))
    }

    fn key(self) -> FileKey {
        FileKey(self.hasher.finalize())
    }
}

/// The shape of a sealed file of `len` plaintext bytes: its segments, its pieces, and where each byte lies in them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Shape {
    pub len: u64,
}

impl Shape {
    pub fn new(len: u64) -> Shape {
        Shape { len }
    }

    /// Its segments: one at least, an empty file's being empty.
    pub fn segments(&self) -> u64 {
        self.len.div_ceil(SEGMENT as u64).max(1)
    }

    /// Its pieces.
    pub fn pieces(&self) -> u64 {
        self.segments().div_ceil(PIECE_SEGMENTS)
    }

    /// Its sealed bytes: the plaintext and a tag for each segment.
    pub fn sealed_len(&self) -> u64 {
        self.len + self.segments() * TAG as u64
    }

    /// Plaintext bytes in segment `i`.
    pub fn segment_len(&self, i: u64) -> usize {
        assert!(i < self.segments(), "segment {i} of a file of {} segments", self.segments());
        (self.len - i * SEGMENT as u64).min(SEGMENT as u64) as usize
    }

    /// Whether segment `i` is the file's last.
    pub fn last(&self, i: u64) -> bool {
        i + 1 == self.segments()
    }

    /// Sealed bytes in piece `p`.
    pub fn piece_len(&self, p: u64) -> u64 {
        assert!(p < self.pieces(), "piece {p} of a file of {} pieces", self.pieces());
        (self.sealed_len() - p * PIECE).min(PIECE)
    }

    /// Where segment `i` lies: its piece, and its sealed bytes in that piece.
    pub fn place(&self, i: u64) -> (u64, Range<u64>) {
        let start = (i % PIECE_SEGMENTS) * SEALED as u64;
        let len = (self.segment_len(i) + TAG) as u64;
        (i / PIECE_SEGMENTS, start..start + len)
    }

    /// The segments that hold the plaintext bytes `bytes`, clamped to the file: none for an empty range.
    pub fn segments_of(&self, bytes: Range<u64>) -> Range<u64> {
        let (from, to) = (bytes.start.min(self.len), bytes.end.min(self.len));
        if from >= to {
            return 0..0;
        }
        from / SEGMENT as u64..(to - 1) / SEGMENT as u64 + 1
    }

    /// Where the sealed bytes of the plaintext bytes `bytes` lie, piece by piece: a reader fetches these ranges of
    /// these pieces, in order, and opens them from the first of `segments_of(bytes)`.
    pub fn sealed_ranges(&self, bytes: Range<u64>) -> Vec<(u64, Range<u64>)> {
        let segments = self.segments_of(bytes);
        let mut out: Vec<(u64, Range<u64>)> = Vec::new();
        for i in segments {
            let (piece, at) = self.place(i);
            match out.last_mut() {
                Some((p, range)) if *p == piece => range.end = at.end,
                _ => out.push((piece, at)),
            }
        }
        out
    }
}

/// A file as the write that brings it names it in the clear, for whoever keeps or relays it without its key: its root,
/// the BLAKE3 hash iroh names it by (of its one piece, or of the HashSeq of its pieces), and its sealed size, which
/// tells which.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct FileRoot {
    pub hash: [u8; 32],
    pub size: u64,
}

impl FileRoot {
    /// Whether its root names a HashSeq of pieces, not its one piece.
    pub fn pieced(&self) -> bool {
        self.size > PIECE
    }
}

/// A file as the encrypted body of the write that brings it holds it: its root, its key and its plaintext length.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Brought {
    pub root: FileRoot,
    pub key: FileKey,
    pub len: u64,
}

impl Brought {
    /// A file of `len` plaintext bytes sealed under `key`, whose sealed pieces iroh names by `root`.
    pub fn new(root: [u8; 32], key: FileKey, len: u64) -> Brought {
        Brought { root: FileRoot { hash: root, size: Shape::new(len).sealed_len() }, key, len }
    }

    pub fn shape(&self) -> Shape {
        Shape::new(self.len)
    }

    /// Whether its length fits the sealed size its root names: a reader takes no other.
    pub fn fits(&self) -> bool {
        self.shape().sealed_len() == self.root.size
    }
}

/// The nonce of segment `i`: its number in 11 bytes, big-endian, then 1 for the file's last segment, else 0.
fn nonce(i: u64, last: bool) -> Nonce {
    let mut n = [0u8; 12];
    n[3..11].copy_from_slice(&i.to_be_bytes());
    n[11] = u8::from(last);
    Nonce::from(n)
}

/// Segment `i` of the file of shape `shape`, sealed: `plaintext` must be all of it.
pub fn seal_segment(key: &FileKey, shape: Shape, i: u64, plaintext: &[u8]) -> Vec<u8> {
    assert_eq!(plaintext.len(), shape.segment_len(i), "segment {i} is {} bytes", shape.segment_len(i));
    let payload = Payload { msg: plaintext, aad: b"" };
    key.cipher().encrypt(&nonce(i, shape.last(i)), payload).expect("a segment fits")
}

/// The plaintext of `sealed`, the sealed segments of the file of shape `shape` from segment `first` on, as many as it
/// holds: `None` for another key, another place in the file, a changed byte, or a cut segment.
pub fn open(key: &FileKey, shape: Shape, first: u64, sealed: &[u8]) -> Option<Vec<u8>> {
    let cipher = key.cipher();
    let mut out = Vec::with_capacity(sealed.len());
    let (mut i, mut rest) = (first, sealed);
    while !rest.is_empty() || (i == first && shape.len == 0) {
        if i >= shape.segments() {
            return None;
        }
        let (segment, after) = rest.split_at_checked(shape.segment_len(i) + TAG)?;
        let payload = Payload { msg: segment, aad: b"" };
        out.extend_from_slice(&cipher.decrypt(&nonce(i, shape.last(i)), payload).ok()?);
        (i, rest) = (i + 1, after);
    }
    Some(out)
}

/// A file sealed as it is read, a segment at a time: what it is handed comes back sealed as each segment fills. Its
/// length is known before it starts, so it knows its last segment when it reaches it.
pub struct Sealer {
    key: FileKey,
    shape: Shape,
    next: u64,
    held: Zeroizing<Vec<u8>>,
}

/// A file handed to a `Sealer` other than as long as it said.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Uneven {
    /// More bytes than its length.
    Long,
    /// Fewer bytes than its length.
    Short,
}

impl Sealer {
    pub fn new(key: &FileKey, len: u64) -> Sealer {
        Sealer { key: key.clone(), shape: Shape::new(len), next: 0, held: Zeroizing::new(Vec::with_capacity(SEGMENT)) }
    }

    pub fn shape(&self) -> Shape {
        self.shape
    }

    /// The segments `bytes` fill, sealed, in order: nothing until one fills.
    pub fn push(&mut self, mut bytes: &[u8]) -> Result<Vec<u8>, Uneven> {
        let mut out = Vec::new();
        while !bytes.is_empty() {
            if self.next >= self.shape.segments() || self.shape.len == 0 {
                return Err(Uneven::Long);
            }
            let want = self.shape.segment_len(self.next) - self.held.len();
            let (now, later) = bytes.split_at(want.min(bytes.len()));
            self.held.extend_from_slice(now);
            bytes = later;
            if self.held.len() == self.shape.segment_len(self.next) {
                out.extend(seal_segment(&self.key, self.shape, self.next, &self.held));
                self.held.clear();
                self.next += 1;
            }
        }
        Ok(out)
    }

    /// What is left once every byte came: an empty file's one segment, else nothing; `Short` if bytes are missing.
    pub fn finish(self) -> Result<Vec<u8>, Uneven> {
        if self.shape.len == 0 {
            return Ok(seal_segment(&self.key, self.shape, 0, b""));
        }
        if self.next < self.shape.segments() {
            return Err(Uneven::Short);
        }
        Ok(Vec::new())
    }
}

/// The whole file sealed at once: its pieces are the result cut every `PIECE` bytes.
pub fn seal(key: &FileKey, plaintext: &[u8]) -> Vec<u8> {
    let mut sealer = Sealer::new(key, plaintext.len() as u64);
    let mut out = sealer.push(plaintext).expect("as long as it says");
    out.extend(sealer.finish().expect("as long as it says"));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(b: u8) -> FileKey {
        FileKey::from_bytes([b; 32])
    }

    fn plaintext(len: usize) -> Vec<u8> {
        (0..len).map(|i| (i % 251) as u8).collect()
    }

    const LENGTHS: [usize; 7] = [0, 1, SEGMENT - 1, SEGMENT, SEGMENT + 1, 3 * SEGMENT + 7, 5 * SEGMENT];

    #[test]
    fn a_segment_seals_to_exactly_64_kib_and_the_whole_file_opens_again() {
        assert_eq!(SEALED, 65_536);
        assert_eq!(PIECE, 1 << 30);
        for len in LENGTHS {
            let shape = Shape::new(len as u64);
            let sealed = seal(&key(7), &plaintext(len));
            assert_eq!(sealed.len() as u64, shape.sealed_len(), "{len} bytes");
            for i in 0..shape.segments() - 1 {
                assert_eq!(shape.place(i).1.end - shape.place(i).1.start, SEALED as u64);
            }
            assert_eq!(open(&key(7), shape, 0, &sealed), Some(plaintext(len)), "{len} bytes");
        }
    }

    #[test]
    fn any_range_opens_from_its_own_segments_alone() {
        let len = 5 * SEGMENT + 300;
        let (shape, text) = (Shape::new(len as u64), plaintext(len));
        let sealed = seal(&key(3), &text);
        for (from, to) in [(0, 1), (SEGMENT - 2, SEGMENT + 2), (2 * SEGMENT + 9, 4 * SEGMENT), (len - 5, len)] {
            let segments = shape.segments_of(from as u64..to as u64);
            let ranges = shape.sealed_ranges(from as u64..to as u64);
            assert_eq!(ranges.len(), 1, "one piece");
            let (_, at) = &ranges[0];
            let opened = open(&key(3), shape, segments.start, &sealed[at.start as usize..at.end as usize]).unwrap();
            let skip = from - segments.start as usize * SEGMENT;
            assert_eq!(&opened[skip..skip + (to - from)], &text[from..to], "{from}..{to}");
        }
        assert_eq!(shape.segments_of(10..10), 0..0);
        assert_eq!(shape.segments_of(len as u64..len as u64 + 9), 0..0);
    }

    #[test]
    fn a_segment_opens_only_at_its_own_place_under_its_own_key_and_the_last_only_at_the_end() {
        let len = 3 * SEGMENT + 7;
        let shape = Shape::new(len as u64);
        let sealed = seal(&key(5), &plaintext(len));
        let seg = |i: usize| &sealed[i * SEALED..((i + 1) * SEALED).min(sealed.len())];
        // another key, another place, a changed byte
        assert_eq!(open(&key(6), shape, 1, seg(1)), None);
        assert_eq!(open(&key(5), shape, 2, seg(1)), None);
        let mut changed = seg(1).to_vec();
        changed[100] ^= 1;
        assert_eq!(open(&key(5), shape, 1, &changed), None);
        // two segments swapped
        let swapped = [seg(1), seg(0)].concat();
        assert_eq!(open(&key(5), shape, 0, &swapped), None);
        // a file cut a segment short: its new last segment was not sealed as the last
        let shorter = Shape::new(3 * SEGMENT as u64);
        assert_eq!(open(&key(5), shorter, 2, seg(2)), None);
        // the real last segment opens, but only whole
        assert_eq!(open(&key(5), shape, 3, seg(3)).map(|p| p.len()), Some(7));
        assert_eq!(open(&key(5), shape, 3, &seg(3)[..10]), None);
        // nothing past the file's end
        assert_eq!(open(&key(5), shape, 4, seg(3)), None);
    }

    #[test]
    fn a_sealer_fed_in_any_steps_seals_the_same_bytes() {
        let len = 4 * SEGMENT + 1234;
        let text = plaintext(len);
        let whole = seal(&key(9), &text);
        for step in [1usize, 7, 4096, SEGMENT, SEGMENT + 1, 200_000] {
            let mut sealer = Sealer::new(&key(9), len as u64);
            let mut out = Vec::new();
            for chunk in text.chunks(step) {
                out.extend(sealer.push(chunk).unwrap());
            }
            out.extend(sealer.finish().unwrap());
            assert_eq!(out, whole, "steps of {step}");
        }
        let mut long = Sealer::new(&key(9), 3);
        assert_eq!(long.push(b"four"), Err(Uneven::Long));
        let mut short = Sealer::new(&key(9), 3);
        short.push(b"tw").unwrap();
        assert_eq!(short.finish(), Err(Uneven::Short));
        assert_eq!(Sealer::new(&key(9), 0).push(b"x"), Err(Uneven::Long));
    }

    #[test]
    fn pieces_hold_16384_segments_and_the_last_holds_the_rest() {
        let shape = Shape::new(PIECE_SEGMENTS * SEGMENT as u64 + 1);
        assert_eq!((shape.segments(), shape.pieces()), (PIECE_SEGMENTS + 1, 2));
        assert_eq!(shape.piece_len(0), PIECE);
        assert_eq!(shape.piece_len(1), 1 + TAG as u64);
        assert_eq!(shape.place(PIECE_SEGMENTS - 1), (0, PIECE - SEALED as u64..PIECE));
        assert_eq!(shape.place(PIECE_SEGMENTS), (1, 0..1 + TAG as u64));
        // a range across the edge of two pieces: one range in each
        let edge = PIECE_SEGMENTS * SEGMENT as u64;
        let ranges = shape.sealed_ranges(edge - 5..edge + 1);
        assert_eq!(ranges, vec![(0, PIECE - SEALED as u64..PIECE), (1, 0..1 + TAG as u64)]);
        // a 4 TB film: 3,727 pieces, its sealed bytes 0.024 % more
        let film = Shape::new(4_000_000_000_000);
        assert_eq!(film.pieces(), 3_727);
        assert_eq!(film.sealed_len() - film.len, film.segments() * TAG as u64);
        assert_eq!(Shape::new(0).pieces(), 1);
        assert_eq!(Shape::new(0).sealed_len(), TAG as u64);
        // a root names one piece, or a HashSeq of several
        let one = Brought::new([1; 32], key(1), PIECE_SEGMENTS * SEGMENT as u64);
        let two = Brought::new([2; 32], key(1), PIECE_SEGMENTS * SEGMENT as u64 + 1);
        assert!(one.fits() && !one.root.pieced() && two.root.pieced());
        assert!(!Brought { len: 3, ..one }.fits());
    }

    #[test]
    fn its_bytes_stay_what_version_2_made() {
        // the format's own vectors, each the root of a sealed file of one piece (the BLAKE3 hash iroh-blobs names its
        // bytes by): if one of these changes, files already sealed stop opening
        let root = |k: u8, len: usize| hex(&hash::content(&seal(&key(k), &plaintext(len))));
        let made = [root(0, 0), root(1, 1), root(2, SEGMENT), root(3, 2 * SEGMENT + 5)];
        assert_eq!(made, VECTORS);
    }

    const VECTORS: [&str; 4] = [
        "51207487ab68a90bca875e9ee63d610b4b819fdf5599c50175a1546da8e7d98c",
        "5931d76bba7922c3f5a839eb92474b52ef98b1237929498f0f195cf18d920125",
        "9987a6107d1c6df24f75643d45d6df671320caa76b8a46c524d1273b13bc1484",
        "45da91d6a265e82036be0518b76b3c777f061b4159e6ae9d10ade41bfa315015",
    ];

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}
