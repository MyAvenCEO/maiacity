//! A Doc's genesis (`Aven.DB.Docs.Genesis`; A30, A39), held to `db/spec/vectors/genesis.json`.
//!
//! A Core Value `{pins, type, nonce, vault}`, exact keys and no defaults. The Doc's id is its name by A30: the hash of
//! `["avenDB genesis 1", genesis]`. It carries no signature of its own: the Doc's first envelope carries it in its
//! body, and that envelope's signature and cap authorize it. `pins` lists only user types, sorted, each with its schema
//! hashes sorted; the built-in types are never pinned.

use aven_core::{DocId, Hash, Value, blake3, decode, encode, signing_bytes};

/// The genesis's label, its version.
pub const GENESIS_LABEL: &str = "avenDB genesis 1";

/// A Doc's genesis.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Genesis {
    /// The schema versions it accepts, per user type.
    pub pins: Vec<(DocId, Vec<Hash>)>,
    /// Its root type, a type Doc (A39). A Doc never changes type.
    pub root: DocId,
    pub nonce: [u8; 32],
    pub vault: Vec<u8>,
}

fn bytes32(v: &Value) -> Option<[u8; 32]> {
    match v {
        Value::Bytes(b) => b.as_slice().try_into().ok(),
        _ => None,
    }
}

impl Genesis {
    /// A genesis with its pins in their order: types sorted, each type's schemas sorted.
    pub fn new(vault: &[u8], root: DocId, pins: &[(DocId, Hash)], nonce: [u8; 32]) -> Genesis {
        let mut sorted: Vec<(DocId, Hash)> = pins.to_vec();
        sorted.sort();
        sorted.dedup();
        let mut grouped: Vec<(DocId, Vec<Hash>)> = Vec::new();
        for (t, h) in sorted {
            match grouped.last_mut() {
                Some((u, hs)) if *u == t => hs.push(h),
                _ => grouped.push((t, vec![h])),
            }
        }
        Genesis {
            pins: grouped,
            root,
            nonce,
            vault: vault.to_vec(),
        }
    }

    /// `Genesis.value`: its keys in the codec's order.
    pub fn value(&self) -> Value {
        Value::Map(vec![
            (
                "pins".into(),
                Value::Array(
                    self.pins
                        .iter()
                        .map(|(t, hs)| {
                            Value::Array(vec![
                                t.0.value(),
                                Value::Array(hs.iter().map(Hash::value).collect()),
                            ])
                        })
                        .collect(),
                ),
            ),
            ("type".into(), self.root.0.value()),
            ("nonce".into(), Value::Bytes(self.nonce.to_vec())),
            ("vault".into(), Value::Bytes(self.vault.clone())),
        ])
    }

    /// The Doc's id: the hash of `["avenDB genesis 1", genesis]` (A30).
    pub fn id(&self) -> DocId {
        DocId(blake3(&signing_bytes(GENESIS_LABEL, &self.value())))
    }

    /// `Genesis.ok`: pins sorted by type with none twice, each with schemas sorted and distinct, none a built-in type.
    pub fn ok(&self, builtin: impl Fn(&DocId) -> bool) -> bool {
        self.pins.windows(2).all(|w| w[0].0 < w[1].0)
            && self
                .pins
                .iter()
                .all(|(t, hs)| !builtin(t) && !hs.is_empty() && hs.windows(2).all(|w| w[0] < w[1]))
    }

    /// The `pin?`/`genesis?` reading: exactly its keys, each in its form.
    pub fn of_value(v: &Value) -> Option<Genesis> {
        let Value::Map(kvs) = v else { return None };
        let [
            (k0, Value::Array(pins)),
            (k1, ty),
            (k2, nonce),
            (k3, Value::Bytes(vault)),
        ] = kvs.as_slice()
        else {
            return None;
        };
        if [k0, k1, k2, k3].map(String::as_str) != ["pins", "type", "nonce", "vault"] {
            return None;
        }
        let pins = pins
            .iter()
            .map(|p| match p {
                Value::Array(p) => match p.as_slice() {
                    [t, Value::Array(hs)] => Some((
                        DocId(Hash(bytes32(t)?)),
                        hs.iter()
                            .map(|h| bytes32(h).map(Hash))
                            .collect::<Option<_>>()?,
                    )),
                    _ => None,
                },
                _ => None,
            })
            .collect::<Option<_>>()?;
        Some(Genesis {
            pins,
            root: DocId(Hash(bytes32(ty)?)),
            nonce: bytes32(nonce)?,
            vault: vault.clone(),
        })
    }

    pub fn encode(&self) -> Vec<u8> {
        encode(&self.value())
    }

    pub fn decode(bytes: &[u8]) -> Option<Genesis> {
        Genesis::of_value(&decode(bytes)?)
    }
}
