//! What a docs envelope carries inside Core's `body` (docs, "Envelopes"). **Provisional: no Lean yet**; the format is
//! the README's JSON, in CBOR, and is decoded strictly: exactly these keys, each in its form.
//!
//! ```text
//! { "envelope": 1, "generation": 0, "ops": { "from": 1180, "to": 1193 },
//!   "records": { "l3": { "version": [type Doc, schema hash] } },
//!   "changes": h'<Loro update>', "at": "2026-10-30T17:02:11Z",
//!   "cap": null | h'<hash>', "acks": [ h'<hash>' … ], "call": null | h'<hash>', "params": <Value> }
//! ```
//!
//! `ops.to` is the last op's counter, inclusive. The Loro commit's message is the `b3:` text of the hash of the
//! `records` map's encoding.

use aven_core::{Hash, TypeId, Value, name_of};

/// The body's format version.
pub const BODY_VERSION: u64 = 1;

/// A docs envelope's body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Body {
    pub generation: u64,
    /// The commit's first op's counter.
    pub from: u64,
    /// Its last op's counter, inclusive.
    pub to: u64,
    /// Every Record the commit touches, with the type id it was written under, by id.
    pub records: Vec<(String, TypeId)>,
    /// The Loro update holding exactly the commit's ops.
    pub changes: Vec<u8>,
    /// The writer's claimed time (rule 9): shown, never used for order.
    pub at: String,
    pub cap: Option<Hash>,
    pub acks: Vec<Hash>,
    pub call: Option<Hash>,
    pub params: Value,
}

fn opt(h: &Option<Hash>) -> Value {
    h.as_ref().map_or(Value::Null, Hash::value)
}

fn hash(v: &Value) -> Option<Hash> {
    match v {
        Value::Bytes(b) => Some(Hash(b.as_slice().try_into().ok()?)),
        _ => None,
    }
}

fn opt_hash(v: &Value) -> Option<Option<Hash>> {
    match v {
        Value::Null => Some(None),
        v => hash(v).map(Some),
    }
}

impl Body {
    /// The `records` map.
    pub fn records_value(&self) -> Value {
        Value::Map(
            self.records
                .iter()
                .map(|(id, t)| (id.clone(), Value::Map(vec![("version".into(), t.value())])))
                .collect(),
        )
    }

    /// The commit's Loro message: the hash of the `records` map.
    pub fn message(&self) -> String {
        name_of(&self.records_value()).text()
    }

    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("at".into(), Value::Text(self.at.clone())),
            ("cap".into(), opt(&self.cap)),
            (
                "ops".into(),
                Value::Map(vec![
                    ("from".into(), Value::Uint(self.from)),
                    ("to".into(), Value::Uint(self.to)),
                ]),
            ),
            (
                "acks".into(),
                Value::Array(self.acks.iter().map(Hash::value).collect()),
            ),
            ("call".into(), opt(&self.call)),
            ("params".into(), self.params.clone()),
            ("changes".into(), Value::Bytes(self.changes.clone())),
            ("records".into(), self.records_value()),
            ("envelope".into(), Value::Uint(BODY_VERSION)),
            ("generation".into(), Value::Uint(self.generation)),
        ])
    }

    /// Read back from [`Body::value`]: exactly its keys, each in its form; Record ids sorted and distinct, as the
    /// codec gives a map's keys.
    pub fn of_value(v: &Value) -> Option<Body> {
        const KEYS: [&str; 10] = [
            "at",
            "cap",
            "ops",
            "acks",
            "call",
            "params",
            "changes",
            "records",
            "envelope",
            "generation",
        ];
        let Value::Map(kvs) = v else { return None };
        if kvs.len() != KEYS.len() || kvs.iter().zip(KEYS).any(|((k, _), want)| k != want) {
            return None;
        }
        let get = |i: usize| &kvs[i].1;
        let (
            Value::Text(at),
            Value::Map(ops),
            Value::Array(acks),
            Value::Bytes(changes),
            Value::Map(records),
        ) = (get(0), get(2), get(3), get(6), get(7))
        else {
            return None;
        };
        let (Value::Uint(BODY_VERSION), Value::Uint(generation)) = (get(8), get(9)) else {
            return None;
        };
        // the codec puts the shorter key first
        let [(tk, Value::Uint(to)), (fk, Value::Uint(from))] = ops.as_slice() else {
            return None;
        };
        if (tk.as_str(), fk.as_str()) != ("to", "from") {
            return None;
        }
        let (from, to) = (*from, *to);
        if from > to {
            return None;
        }
        let records = records
            .iter()
            .map(|(id, r)| match r {
                Value::Map(f) => match f.as_slice() {
                    [(k, t)] if k == "version" => Some((id.clone(), TypeId::of_value(t)?)),
                    _ => None,
                },
                _ => None,
            })
            .collect::<Option<Vec<_>>>()?;
        Some(Body {
            generation: *generation,
            from,
            to,
            records,
            changes: changes.clone(),
            at: at.clone(),
            cap: opt_hash(get(1))?,
            acks: acks.iter().map(hash).collect::<Option<_>>()?,
            call: opt_hash(get(4))?,
            params: get(5).clone(),
        })
    }
}
