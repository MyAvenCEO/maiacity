//! What a docs envelope carries inside Core's `body` (`Aven.DB.Docs.Body`), held to `db/spec/vectors/bodies.json`:
//!
//! ```text
//! { "at": "…", "cap": null | h'…', "ops": { "to": next, "from": first }, "acks": [ h'…' … ],
//!   "calls": [ { "op": h'…', "params": { … } } … ], "changes": h'<Loro update>', "genesis"?: { … },
//!   "records": { id: [ h'<type Doc>', h'<schema hash>'? ] … }, "generation": n }
//! ```
//!
//! Decoded strictly: exactly these keys in the codec's order, `genesis` only in a Doc's first envelope, each value in
//! its form, and `from ≤ to`. `ops` is half-open, as Loro's spans are. The commit's Loro message is the lowercase hex
//! of BLAKE3 over the canonical CBOR of `records`.

use aven_core::{DocId, Hash, Value, blake3, encode};

use crate::genesis::Genesis;

/// The version a Record was written under: its type Doc, and its schema's hash unless the type is built in, which is
/// versioned by its label (`Version`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Version {
    pub r#type: DocId,
    pub schema: Option<Hash>,
}

impl Version {
    pub fn value(&self) -> Value {
        Value::Array(
            [Some(self.r#type.0.value()), self.schema.map(|h| h.value())]
                .into_iter()
                .flatten()
                .collect(),
        )
    }

    pub fn of_value(v: &Value) -> Option<Version> {
        let Value::Array(xs) = v else { return None };
        match xs.as_slice() {
            [t] => Some(Version {
                r#type: DocId(hash(t)?),
                schema: None,
            }),
            [t, s] => Some(Version {
                r#type: DocId(hash(t)?),
                schema: Some(hash(s)?),
            }),
            _ => None,
        }
    }
}

/// An operation the commit ran (`Call`, A32): its op id and its params.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Call {
    pub op: Hash,
    /// In the codec's order of keys.
    pub params: Vec<(String, Value)>,
}

impl Call {
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("op".into(), self.op.value()),
            ("params".into(), Value::Map(self.params.clone())),
        ])
    }

    pub fn of_value(v: &Value) -> Option<Call> {
        let Value::Map(kvs) = v else { return None };
        let [(o, op), (p, Value::Map(ps))] = kvs.as_slice() else {
            return None;
        };
        (o == "op" && p == "params").then_some(())?;
        Some(Call {
            op: hash(op)?,
            params: ps.clone(),
        })
    }
}

/// A docs envelope's body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Body {
    pub acks: Vec<Hash>,
    /// The writer's claimed time (rule 9): shown, never used for order.
    pub at: String,
    pub calls: Vec<Call>,
    pub cap: Option<Hash>,
    /// The Loro update holding exactly the commit's ops.
    pub changes: Vec<u8>,
    pub generation: u64,
    /// The commit's first counter.
    pub from: u64,
    /// The writer's next counter, past the commit's last op.
    pub to: u64,
    /// Every Record the commit touches, by id, in the codec's order of keys.
    pub records: Vec<(String, Version)>,
    /// Only in the Doc's first envelope.
    pub genesis: Option<Genesis>,
}

fn hash(v: &Value) -> Option<Hash> {
    match v {
        Value::Bytes(b) => Some(Hash(b.as_slice().try_into().ok()?)),
        _ => None,
    }
}

/// Map keys in the codec's order: shorter first, then bytewise.
pub fn codec_order(a: &str, b: &str) -> std::cmp::Ordering {
    a.len()
        .cmp(&b.len())
        .then_with(|| a.as_bytes().cmp(b.as_bytes()))
}

impl Body {
    /// The `records` map.
    pub fn records_value(&self) -> Value {
        Value::Map(
            self.records
                .iter()
                .map(|(id, v)| (id.clone(), v.value()))
                .collect(),
        )
    }

    /// The commit's Loro message: BLAKE3 over the canonical CBOR of `records`, lowercase hex.
    pub fn message(&self) -> String {
        blake3(&encode(&self.records_value()))
            .0
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// Its last op's counter.
    pub fn last(&self) -> u64 {
        self.to - 1
    }

    pub fn value(&self) -> Value {
        let mut kvs = vec![
            ("at".into(), Value::Text(self.at.clone())),
            ("cap".into(), self.cap.map_or(Value::Null, |h| h.value())),
            (
                "ops".into(),
                Value::Map(vec![
                    ("to".into(), Value::Uint(self.to)),
                    ("from".into(), Value::Uint(self.from)),
                ]),
            ),
            (
                "acks".into(),
                Value::Array(self.acks.iter().map(Hash::value).collect()),
            ),
            (
                "calls".into(),
                Value::Array(self.calls.iter().map(Call::value).collect()),
            ),
            ("changes".into(), Value::Bytes(self.changes.clone())),
        ];
        if let Some(g) = &self.genesis {
            kvs.push(("genesis".into(), g.value()));
        }
        kvs.push(("records".into(), self.records_value()));
        kvs.push(("generation".into(), Value::Uint(self.generation)));
        Value::Map(kvs)
    }

    /// `Body.ofValue?`: exactly its keys, each in its form, and `from ≤ to`.
    pub fn of_value(v: &Value) -> Option<Body> {
        let Value::Map(kvs) = v else { return None };
        let has_genesis = kvs.iter().any(|(k, _)| k == "genesis");
        let want: Vec<&str> = ["at", "cap", "ops", "acks", "calls", "changes"]
            .into_iter()
            .chain(has_genesis.then_some("genesis"))
            .chain(["records", "generation"])
            .collect();
        if kvs.len() != want.len() || kvs.iter().zip(&want).any(|((k, _), w)| k != w) {
            return None;
        }
        let get = |k: &str| &kvs.iter().find(|(x, _)| x == k).expect("checked").1;
        let (
            Value::Text(at),
            Value::Map(ops),
            Value::Array(acks),
            Value::Array(calls),
            Value::Bytes(changes),
        ) = (
            get("at"),
            get("ops"),
            get("acks"),
            get("calls"),
            get("changes"),
        )
        else {
            return None;
        };
        let (Value::Map(records), Value::Uint(generation)) = (get("records"), get("generation"))
        else {
            return None;
        };
        let [(tk, Value::Uint(to)), (fk, Value::Uint(from))] = ops.as_slice() else {
            return None;
        };
        if (tk.as_str(), fk.as_str()) != ("to", "from") || to < from {
            return None;
        }
        let cap = match get("cap") {
            Value::Null => None,
            c => Some(hash(c)?),
        };
        Some(Body {
            acks: acks.iter().map(hash).collect::<Option<_>>()?,
            at: at.clone(),
            calls: calls.iter().map(Call::of_value).collect::<Option<_>>()?,
            cap,
            changes: changes.clone(),
            generation: *generation,
            from: *from,
            to: *to,
            records: records
                .iter()
                .map(|(i, x)| Some((i.clone(), Version::of_value(x)?)))
                .collect::<Option<_>>()?,
            genesis: if has_genesis {
                Some(Genesis::of_value(get("genesis"))?)
            } else {
                None
            },
        })
    }
}
