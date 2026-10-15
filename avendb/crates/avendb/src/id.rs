//! Ids, all 32 bytes. A signer is its public key. Everything an edit creates is named by that edit's id, the hash of
//! the signed edit: a vault by its genesis, a share by the edit that issued it. An entry's id is drawn at random by
//! whoever creates it. An audience, the entries of a vault that the same shares select, is named by the hash of its
//! vault and its shares (`AudienceId::of`).

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

            /// The id in 64 lowercase hex digits, as the page names every id and lenses name schemas.
            pub fn to_hex(&self) -> String {
                self.0.iter().map(|b| format!("{b:02x}")).collect()
            }

            /// An id from its 64 lowercase hex digits: `None` for anything else.
            pub fn from_hex(s: &str) -> Option<Self> {
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
                Some(Self(id))
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
    /// A human, coop or aven vault: the id of its genesis edit.
    VaultId,
    /// One entry of a vault, a note or a todo: 32 random bytes its creator draws.
    EntryId,
    /// A share: the id of the edit that issued it.
    ShareId,
    /// An audience of a vault: the hash of the vault and the ids of the shares that select its entries
    /// (`AudienceId::of`).
    AudienceId,
    /// A signed edit: the BLAKE3 hash of its encoding, which its signatures sign.
    EditId,
    /// Bytes named by their hash: a schema or a lens of a vault's schema lane, or a Classic McEliece public key.
    BlobId,
}

impl BlobId {
    /// The id of a blob: the BLAKE3 hash of its bytes, the name iroh-blobs gives them (`hash::content`).
    pub fn of(bytes: &[u8]) -> BlobId {
        BlobId(crate::hash::content(bytes))
    }
}

impl From<EditId> for VaultId {
    fn from(id: EditId) -> Self {
        Self(id.0)
    }
}

impl From<EditId> for ShareId {
    fn from(id: EditId) -> Self {
        Self(id.0)
    }
}

impl AudienceId {
    /// The id of the audience of vault `v` that the shares `shares` select, given in canonical order
    /// (`policy::mk_audience`): the hash of the vault and the shares, so two peers name one audience alike and no relay
    /// learns more than which shares.
    pub fn of(v: VaultId, shares: &[ShareId]) -> AudienceId {
        let mut h = crate::hash::Hasher::new("audience id");
        h.update(&v.0);
        h.update(&(shares.len() as u64).to_be_bytes());
        for c in shares {
            h.update(&c.0);
        }
        AudienceId(h.finalize())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_numbers_are_distinct_ids() {
        assert_ne!(VaultId::from_u64(1), VaultId::from_u64(2));
        assert_eq!(VaultId::from_u64(258).0[30..], [1, 2]);
        assert_eq!(format!("{:?}", EditId::from_u64(7)), "EditId(7)");
        assert_eq!(format!("{:?}", EditId([0xab; 32])), "EditId(abababab…)");
    }

    #[test]
    fn an_audience_id_names_its_vault_and_shares() {
        let (v, w) = (VaultId::from_u64(1), VaultId::from_u64(2));
        let (a, b) = (ShareId::from_u64(1), ShareId::from_u64(2));
        let ids =
            [AudienceId::of(v, &[]), AudienceId::of(v, &[a]), AudienceId::of(v, &[a, b]), AudienceId::of(w, &[a, b])];
        assert!(ids.iter().enumerate().all(|(i, x)| ids[i + 1..].iter().all(|y| x != y)));
        assert_eq!(AudienceId::of(v, &[a, b]), AudienceId::of(v, &[a, b]));
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
