//! A Doc's genesis (docs, "A Doc"; A39). **Provisional: no Lean yet.** It is a Core [`Signed`] thing under
//! [`GENESIS_LABEL`], signed by the creating device's Ed25519 key, whose body is
//!
//! ```text
//! { "genesis": 1, "vault": h'<vault>', "type": h'<root type Doc>',
//!   "pins": [ [ h'<type Doc>', [ h'<schema hash>' … ] ] … ], "nonce": h'<32 random bytes>' }
//! ```
//!
//! The Doc's id is the genesis's name, the hash of exactly what its device signs, so its vault and root type are
//! sealed into it (docs, decision 13). The nonce makes two Docs born alike different. Built-in types are pinned
//! without asking ([`crate::schema::builtins`]).

use aven_core::{DocId, Hash, Signed, TypeId, Value, Verify};

use crate::device::Device;

/// What a genesis is signed under.
pub const GENESIS_LABEL: &str = "avenDB genesis 1";

/// A Doc's genesis, as its device signed it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Genesis {
    pub vault: Vec<u8>,
    /// Its root type, a type Doc (A39). A Doc never changes type.
    pub root: DocId,
    /// The schema versions it accepts, per type.
    pub pins: Vec<TypeId>,
    pub nonce: [u8; 32],
    /// The creating device's Ed25519 key.
    pub by: Vec<u8>,
    pub sig: Vec<u8>,
}

fn bytes32(v: &Value) -> Option<[u8; 32]> {
    match v {
        Value::Bytes(b) => b.as_slice().try_into().ok(),
        _ => None,
    }
}

impl Genesis {
    /// A new Doc's genesis, signed by `device`.
    pub fn new(
        device: &Device,
        vault: &[u8],
        root: DocId,
        pins: Vec<TypeId>,
        nonce: [u8; 32],
    ) -> Genesis {
        let mut g = Genesis {
            vault: vault.to_vec(),
            root,
            pins,
            nonce,
            by: device.public().to_vec(),
            sig: vec![],
        };
        g.pins.sort();
        g.pins.dedup();
        g.sig = device.sign(&g.signed().signing()).to_vec();
        g
    }

    fn body(&self) -> Value {
        let mut types: Vec<(DocId, Vec<Hash>)> = Vec::new();
        for p in &self.pins {
            match types.last_mut() {
                Some((t, hs)) if *t == p.r#type => hs.push(p.schema),
                _ => types.push((p.r#type, vec![p.schema])),
            }
        }
        Value::Map(vec![
            (
                "pins".into(),
                Value::Array(
                    types
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
            ("genesis".into(), Value::Uint(1)),
        ])
    }

    /// As a Core signed thing.
    pub fn signed(&self) -> Signed {
        Signed {
            label: GENESIS_LABEL.into(),
            body: self.body(),
            signer: self.by.clone(),
            sig: self.sig.clone(),
        }
    }

    /// The Doc's id: the genesis's name.
    pub fn id(&self) -> DocId {
        DocId(self.signed().name())
    }

    pub fn valid(&self, verify: &impl Verify) -> bool {
        self.signed().valid(verify)
    }

    pub fn encode(&self) -> Vec<u8> {
        self.signed().encode()
    }

    /// Read back strictly: its label, exactly its keys, pins sorted by type and schema with no type twice.
    pub fn decode(bytes: &[u8]) -> Option<Genesis> {
        let s = Signed::decode(bytes)?;
        if s.label != GENESIS_LABEL {
            return None;
        }
        let Value::Map(kvs) = &s.body else {
            return None;
        };
        let [
            (k0, Value::Array(pins)),
            (k1, ty),
            (k2, nonce),
            (k3, Value::Bytes(vault)),
            (k4, Value::Uint(1)),
        ] = kvs.as_slice()
        else {
            return None;
        };
        if [k0, k1, k2, k3, k4].map(String::as_str) != ["pins", "type", "nonce", "vault", "genesis"]
        {
            return None;
        }
        let mut flat = Vec::new();
        for p in pins {
            let Value::Array(p) = p else { return None };
            let [t, Value::Array(hs)] = p.as_slice() else {
                return None;
            };
            let t = DocId(Hash(bytes32(t)?));
            if hs.is_empty() {
                return None;
            }
            for h in hs {
                flat.push(TypeId {
                    r#type: t,
                    schema: Hash(bytes32(h)?),
                });
            }
        }
        if flat.windows(2).any(|w| w[0] >= w[1]) {
            return None;
        }
        let g = Genesis {
            vault: vault.clone(),
            root: DocId(Hash(bytes32(ty)?)),
            pins: flat,
            nonce: bytes32(nonce)?,
            by: s.signer,
            sig: s.sig,
        };
        (g.encode() == bytes).then_some(g)
    }
}
