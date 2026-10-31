//! What an envelope says of its authority (`Aven.ID.Authority`, A45). An envelope's body carries, under its key
//! `authority`, the one Value caps reads of it, which the docs layer carries without reading: the chain it rests on by
//! its caps' names, root first and empty on its vault's own authority, and the revocations its writer acknowledges.
//!
//! ```text
//! authority: {"acks": [name…], "caps": [name…]}
//!            {"acks": [name…], "caps": [name…], "actor": Doc}   an actor host's envelope (A27, A188)
//! ```
//!
//! Exactly one of those two shapes, keys in the codec's order, names and the actor 32 bytes; anything else reads as
//! nothing.

use aven_core::{DocId, Hash, Value};

/// What an envelope's body says of its authority.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Authority {
    /// The caps it rests on, by name (`Cap::digest`), root first; empty on its vault's own authority.
    pub caps: Vec<Hash>,
    /// The revocations its writer acknowledges, by name (`Revocation::digest`).
    pub acks: Vec<Hash>,
    /// The acting actor an actor host's envelope names (A27, A188).
    pub actor: Option<DocId>,
}

fn names(v: &[Hash]) -> Value {
    Value::Array(v.iter().map(|h| Value::Bytes(h.0.to_vec())).collect())
}

fn names_of(v: &Value) -> Option<Vec<Hash>> {
    let Value::Array(xs) = v else { return None };
    xs.iter()
        .map(|x| match x {
            Value::Bytes(b) => Some(Hash(b.as_slice().try_into().ok()?)),
            _ => None,
        })
        .collect()
}

impl Authority {
    /// The Value the body carries under `authority`, `acks` before `caps` (`Authority.value`).
    pub fn value(&self) -> Value {
        let mut kvs = vec![
            ("acks".into(), names(&self.acks)),
            ("caps".into(), names(&self.caps)),
        ];
        if let Some(a) = &self.actor {
            kvs.push(("actor".into(), Value::Bytes(a.0.0.to_vec())));
        }
        Value::Map(kvs)
    }

    /// The authority a body carries: exactly one of its two shapes, in the codec's order (`Authority.ofValue?`).
    pub fn of_value(v: &Value) -> Option<Authority> {
        let Value::Map(kvs) = v else { return None };
        match kvs.as_slice() {
            [(a, acks), (c, caps)] if a == "acks" && c == "caps" => Some(Authority {
                caps: names_of(caps)?,
                acks: names_of(acks)?,
                actor: None,
            }),
            [(a, acks), (c, caps), (t, Value::Bytes(actor))]
                if a == "acks" && c == "caps" && t == "actor" =>
            {
                Some(Authority {
                    caps: names_of(caps)?,
                    acks: names_of(acks)?,
                    actor: Some(DocId(Hash(actor.as_slice().try_into().ok()?))),
                })
            }
            _ => None,
        }
    }
}
