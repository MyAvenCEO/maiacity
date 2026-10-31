//! Schemas for step 1's fit: the built-in types every Doc pins without asking (docs, "Types are Docs"), and the
//! smallest schema language they need. **Provisional: no Lean yet** for the built-in types' ids, their schema hashes
//! or their fields; the full schema language (JSON Schema's subset with `x-loro`) and type Docs are step 3's.
//!
//! What a schema here may say is only what survives a merge (docs, rule 16; `Aven.DB.Docs.Fit`): a field's kind, an
//! upper bound on a number replaced whole, which fields are required at a Record's birth, and whether other fields are
//! allowed. No size of a container, nothing across fields or Records.

use aven_core::{DocId, Hash, TypeId, Value, blake3, encode};

/// What one field may hold, judged on a value replaced whole.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    Any,
    Bool,
    Text,
    Bytes,
    /// A hash: 32 bytes.
    Hash,
    /// An unsigned integer, at most this.
    Uint(u64),
    /// Each element of a list.
    Array(Box<Kind>),
}

impl Kind {
    pub fn allows(&self, v: &Value) -> bool {
        match (self, v) {
            (Kind::Any, _) | (Kind::Bool, Value::Bool(_)) | (Kind::Text, Value::Text(_)) => true,
            (Kind::Bytes, Value::Bytes(_)) => true,
            (Kind::Hash, Value::Bytes(b)) => b.len() == 32,
            (Kind::Uint(max), Value::Uint(n)) => n <= max,
            (Kind::Array(k), Value::Array(xs)) => xs.iter().all(|x| k.allows(x)),
            _ => false,
        }
    }

    fn value(&self) -> Value {
        match self {
            Kind::Any => Value::Text("any".into()),
            Kind::Bool => Value::Text("bool".into()),
            Kind::Text => Value::Text("text".into()),
            Kind::Bytes => Value::Text("bytes".into()),
            Kind::Hash => Value::Text("hash".into()),
            Kind::Uint(max) => Value::Array(vec![Value::Text("uint".into()), Value::Uint(*max)]),
            Kind::Array(k) => Value::Array(vec![Value::Text("array".into()), k.value()]),
        }
    }
}

/// One version of a Record's shape.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Schema {
    pub title: String,
    /// Each field, its kind, and whether it is required at birth.
    pub fields: Vec<(String, Kind, bool)>,
    /// `additionalProperties: false`.
    pub closed: bool,
}

impl Schema {
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("title".into(), Value::Text(self.title.clone())),
            ("closed".into(), Value::Bool(self.closed)),
            (
                "fields".into(),
                Value::Array(
                    self.fields
                        .iter()
                        .map(|(f, k, r)| {
                            Value::Array(vec![Value::Text(f.clone()), k.value(), Value::Bool(*r)])
                        })
                        .collect(),
                ),
            ),
        ])
    }

    /// Its hash, the schema half of its type id.
    pub fn hash(&self) -> Hash {
        blake3(&encode(&self.value()))
    }

    pub fn field(&self, name: &str) -> Option<&(String, Kind, bool)> {
        self.fields.iter().find(|(f, _, _)| f == name)
    }

    /// Whether `name` may hold `v`.
    pub fn allows(&self, name: &str, v: &Value) -> bool {
        match self.field(name) {
            Some((_, k, _)) => k.allows(v),
            None => !self.closed,
        }
    }

    pub fn required(&self) -> impl Iterator<Item = &str> {
        self.fields.iter().filter(|f| f.2).map(|f| f.0.as_str())
    }
}

/// A built-in type's Doc id: the hash of `avenDB built-in type <name>`.
pub fn builtin_type(name: &str) -> DocId {
    DocId(blake3(format!("avenDB built-in type {name}").as_bytes()))
}

/// The built-in types every Doc pins (docs, "Types are Docs"): caps' `cap`, `revoke` and `epoch`, whose fields caps
/// owns and so are open here, and docs' `branch`, `closed`, `version` and `split`.
pub fn builtins() -> Vec<(TypeId, Schema)> {
    let open = |t: &str| Schema {
        title: t.into(),
        fields: vec![],
        closed: false,
    };
    let f = |n: &str, k: Kind, r: bool| (n.to_string(), k, r);
    let all = [
        open("cap"),
        open("revoke"),
        open("epoch"),
        Schema {
            title: "branch".into(),
            fields: vec![
                f("name", Kind::Text, true),
                f("base", Kind::Array(Box::new(Kind::Hash)), true),
                f("follows", Kind::Text, false),
                f("nonce", Kind::Hash, true),
            ],
            closed: true,
        },
        Schema {
            title: "closed".into(),
            fields: vec![f("at", Kind::Array(Box::new(Kind::Hash)), false)],
            closed: true,
        },
        Schema {
            title: "version".into(),
            fields: vec![
                f("name", Kind::Text, true),
                f("at", Kind::Array(Box::new(Kind::Hash)), true),
            ],
            closed: true,
        },
        Schema {
            title: "split".into(),
            fields: vec![
                f("writer", Kind::Uint(u64::MAX), true),
                f("after", Kind::Hash, true),
            ],
            closed: true,
        },
    ];
    all.into_iter()
        .map(|s| {
            (
                TypeId {
                    r#type: builtin_type(&s.title),
                    schema: s.hash(),
                },
                s,
            )
        })
        .collect()
}
