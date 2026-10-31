//! A vault's name (`Aven.ID.VaultName`; A30, rule 15). Every vault is named by its own genesis, `{kind, nonce}`: its
//! kind, one of exactly four, and 32 bytes drawn fresh at its founding. The name is the A30 name of
//! `["avenID vault 1", genesis]`: BLAKE3 of those bytes. Owners, keys and epochs aren't in it, so it never changes.

use aven_core::{Hash, Value, blake3, decode, encode};

use crate::tree::Kind;
use crate::value::{bytes, fields, text};

pub const VAULT_LABEL_TEXT: &str = "avenID vault 1";
pub const VAULT_NONCE_LEN: usize = 32;

/// A vault's genesis: what it is, and what makes it this one.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct VaultGenesis {
    pub kind: Kind,
    pub nonce: [u8; VAULT_NONCE_LEN],
}

/// Exactly the four kinds: the old `network` is no kind here.
fn kind_of(s: &str) -> Option<Kind> {
    match s {
        "person" => Some(Kind::Person),
        "coop" => Some(Kind::Coop),
        "agent" => Some(Kind::Agent),
        "device" => Some(Kind::Device),
        _ => None,
    }
}

impl VaultGenesis {
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("kind".into(), text(self.kind.as_str())),
            ("nonce".into(), bytes(&self.nonce)),
        ])
    }

    /// Exactly `kind` and `nonce`, a kind of the four, a nonce of 32 bytes, and only a Value written back the same.
    pub fn of_value(v: &Value) -> Option<VaultGenesis> {
        let f = fields(v, &["kind", "nonce"], &[])?;
        let genesis = VaultGenesis {
            kind: kind_of(f.text("kind")?)?,
            nonce: f.array("nonce")?,
        };
        (genesis.value() == *v).then_some(genesis)
    }

    pub fn from_bytes(blob: &[u8]) -> Option<VaultGenesis> {
        VaultGenesis::of_value(&decode(blob)?)
    }

    /// The vault's name: BLAKE3 of `["avenID vault 1", genesis]`.
    pub fn name(&self) -> Hash {
        blake3(&encode(&Value::Array(vec![
            text(VAULT_LABEL_TEXT),
            self.value(),
        ])))
    }
}
