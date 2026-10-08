//! Ids, all 32 bytes. A signer is its public key. Everything an op creates is named by that op's id, the hash of the
//! signed op: a vault by its genesis, a space by its founding, a grant by the grant itself. An entry's id is chosen at
//! random by whoever creates it.

macro_rules! ids {
    ($($(#[$doc:meta])* $name:ident),* $(,)?) => {$(
        $(#[$doc])*
        #[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
        pub struct $name(pub [u8; 32]);

        impl $name {
            /// A small number as an id: the Lean model's numbers in the shared test vectors, and readable test fixtures.
            pub const fn from_u64(n: u64) -> Self {
                let b = n.to_be_bytes();
                let mut id = [0u8; 32];
                let mut i = 0;
                while i < 8 {
                    id[24 + i] = b[i];
                    i += 1;
                }
                Self(id)
            }
        }

        /// A small-number id prints as its number, a hash as its first four bytes.
        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}(", stringify!($name))?;
                if self.0[..24].iter().all(|&b| b == 0) {
                    let mut n = [0u8; 8];
                    n.copy_from_slice(&self.0[24..]);
                    write!(f, "{}", u64::from_be_bytes(n))?;
                } else {
                    for b in &self.0[..4] {
                        write!(f, "{b:02x}")?;
                    }
                    write!(f, "…")?;
                }
                write!(f, ")")
            }
        }
    )*};
}

ids! {
    /// A key that signs: a passkey (P-256) or a device key (ed25519, the device's iroh endpoint key).
    SignerId,
    /// A human or coop vault: the id of its genesis op.
    VaultId,
    /// A space: the id of the op that founded it.
    SpaceId,
    /// One item in a space, a markdown document or a todo.
    EntryId,
    /// A grant: the id of the op that made it.
    GrantId,
    /// A signed op: the hash of its encoding with its signatures.
    OpId,
    /// A schema or a lens in a space's schema lane: the hash of its bytes.
    BlobId,
}

/// What blob ids derive from.
const BLOB_KEY: &str = "maiacity vault-db 2026-10-08 blob v1";

impl BlobId {
    /// The id of a blob: BLAKE3 of its bytes, keyed so it is unlike any other hash of them.
    pub fn of(bytes: &[u8]) -> BlobId {
        let mut h = blake3::Hasher::new_derive_key(BLOB_KEY);
        h.update(bytes);
        BlobId(*h.finalize().as_bytes())
    }

    /// The id in lowercase hex, as lenses name schemas and edits name the schema they were written under.
    pub fn to_hex(&self) -> String {
        self.0.iter().map(|b| format!("{b:02x}")).collect()
    }

    /// An id from its lowercase hex: `None` for anything else.
    pub fn from_hex(s: &str) -> Option<BlobId> {
        let digit = |c: u8| match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            _ => None,
        };
        let s = s.as_bytes();
        if s.len() != 64 {
            return None;
        }
        let mut id = [0u8; 32];
        for (i, b) in id.iter_mut().enumerate() {
            *b = digit(s[2 * i])? << 4 | digit(s[2 * i + 1])?;
        }
        Some(BlobId(id))
    }
}

impl From<OpId> for VaultId {
    fn from(id: OpId) -> Self {
        Self(id.0)
    }
}

impl From<OpId> for SpaceId {
    fn from(id: OpId) -> Self {
        Self(id.0)
    }
}

impl From<OpId> for GrantId {
    fn from(id: OpId) -> Self {
        Self(id.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_numbers_are_distinct_ids() {
        assert_ne!(VaultId::from_u64(1), VaultId::from_u64(2));
        assert_eq!(VaultId::from_u64(258).0[30..], [1, 2]);
        assert_eq!(format!("{:?}", OpId::from_u64(7)), "OpId(7)");
        assert_eq!(format!("{:?}", OpId([0xab; 32])), "OpId(abababab…)");
    }

    #[test]
    fn a_blob_id_round_trips_through_hex() {
        let id = BlobId::of(b"blob 1");
        assert_eq!(BlobId::from_hex(&id.to_hex()), Some(id));
        assert_ne!(id, BlobId::of(b"blob 2"));
        for bad in ["", "AB", &id.to_hex().to_uppercase(), &id.to_hex()[1..]] {
            assert_eq!(BlobId::from_hex(bad), None, "{bad}");
        }
    }
}
