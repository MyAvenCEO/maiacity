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
}
