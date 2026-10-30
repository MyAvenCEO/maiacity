//! A blob's name: the BLAKE3 hash of its bytes, which only the store computes.

use std::fmt;
use std::str::FromStr;

use crate::Error;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Hash([u8; 32]);

impl Hash {
    /// The hash of `bytes`.
    pub fn of(bytes: &[u8]) -> Self {
        Self(*blake3::hash(bytes).as_bytes())
    }

    /// A hash read from where it was written: an index's list, iroh-blobs' name for a blob.
    pub(crate) fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// 64 lowercase hex digits: how a hash is written in storage.
    pub fn to_hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// How a ref holds this hash at rest, in every driver: its hex and a newline (Lean `Store.refText`).
    pub fn ref_text(&self) -> String {
        format!("{self}\n")
    }

    /// A ref's bytes at rest, read back: the hash's hex with one trailing newline or none (Lean `Store.readRef`). The
    /// OpenDAL drivers wrote the newline, the opfs driver of 30 Oct 2026 left it out; a browser keeps what either wrote.
    pub fn from_ref(bytes: &[u8]) -> Result<Self, Error> {
        let text = std::str::from_utf8(bytes).map_err(|_| Error::Corrupt("a ref that isn't text".into()))?;
        text.strip_suffix('\n').unwrap_or(text).parse()
    }
}

impl FromStr for Hash {
    type Err = Error;

    /// Only the store's own spelling: 64 lowercase hex digits.
    fn from_str(s: &str) -> Result<Self, Error> {
        let bad = || Error::Corrupt(format!("not a hash: {s:?}"));
        if s.len() != 64 || !s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) {
            return Err(bad());
        }
        let mut out = [0u8; 32];
        for (i, byte) in out.iter_mut().enumerate() {
            *byte = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).map_err(|_| bad())?;
        }
        Ok(Self(out))
    }
}

impl fmt::Display for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

impl fmt::Debug for Hash {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Hash({}…)", &self.to_hex()[..12])
    }
}
