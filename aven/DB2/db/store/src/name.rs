//! A ref's name. Flat, so every backend stores it the same way: a file in one folder, one key under one prefix.

use std::fmt;

use crate::Error;

/// 1 to 128 of `A-Z a-z 0-9 . _ -`, not starting with `.`: `doc.3f9a.head`, `peer.key`.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct RefName(String);

impl RefName {
    pub fn new(name: impl Into<String>) -> Result<Self, Error> {
        let name = name.into();
        let ok = (1..=128).contains(&name.len())
            && !name.starts_with('.')
            && name.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'));
        if ok { Ok(Self(name)) } else { Err(Error::InvalidName(name)) }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for RefName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl fmt::Debug for RefName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "RefName({})", self.0)
    }
}
