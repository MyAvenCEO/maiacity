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

/// The cast's vaults and their kinds (`VaultName.castVaults`).
pub const CAST_VAULTS: &[(&str, Kind)] = &[
    ("alice", Kind::Person),
    ("bob", Kind::Person),
    ("maia-city", Kind::Coop),
    ("aven", Kind::Agent),
    ("guardian", Kind::Agent),
    ("alice-peer", Kind::Device),
    ("alice-peer-light", Kind::Device),
    ("aven-peer", Kind::Device),
    ("bob-peer-light", Kind::Device),
];

/// A cast vault's fixed nonce, BLAKE3 of `avenSANDBOX vault nonce: <id>` (`VaultName.castNonce`): public on purpose and
/// valid only in the box, so the cast's names are stable.
pub fn cast_nonce(id: &str) -> [u8; VAULT_NONCE_LEN] {
    blake3(format!("avenSANDBOX vault nonce: {id}").as_bytes()).0
}

/// A fixture handle's name (`VaultName.castName`, A164, A210): its cast genesis, of the kind the cast lists (a
/// person's for a handle only the examples use), with its fixed nonce. What every format writes for the handle while
/// the tree and the register still go by handles.
pub fn cast_name(id: &str) -> Hash {
    let kind = CAST_VAULTS
        .iter()
        .find(|(h, _)| *h == id)
        .map_or(Kind::Person, |&(_, k)| k);
    VaultGenesis {
        kind,
        nonce: cast_nonce(id),
    }
    .name()
}
