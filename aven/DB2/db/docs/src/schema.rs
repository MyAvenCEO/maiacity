//! Fit's rules for step 1: the docs layer's built-in types, named by their labels (`Aven.DB.Docs.Genesis`), and one
//! toy schema language for a user type's version, named by its hash. The full schema language (JSON Schema's subset
//! with `x-loro`) and type Docs come with user types, in step 3.
//!
//! What a schema here may say is only what survives a merge (docs, rule 16; `Aven.DB.Docs.Fit`): a field's kind, an
//! upper bound on a number replaced whole, which fields are required at a Record's birth, and whether other fields are
//! allowed. No size of a container, nothing across fields or Records.

use aven_core::{DocId, Hash, Value, blake3, encode};

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

/// A docs built-in type: the name of its label `avenDB <name> 1` (`builtinType`).
pub fn builtin_type(name: &str) -> DocId {
    DocId(aven_core::name_of(&Value::Text(format!("avenDB {name} 1"))))
}

/// The docs layer's built-in types (`builtinNames`).
pub const BUILTIN_NAMES: [&str; 4] = ["branch", "closed", "version", "split"];

/// Whether a type Doc is one of the docs layer's built-in types (`isBuiltin`).
pub fn is_builtin(t: &DocId) -> bool {
    BUILTIN_NAMES.iter().any(|n| builtin_type(n) == *t)
}
