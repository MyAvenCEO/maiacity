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

    /// A kind back from its one form, `None` for anything else (`FieldKind.ofValue?`).
    pub fn of_value(v: &Value) -> Option<Kind> {
        match v {
            Value::Text(t) => match t.as_str() {
                "any" => Some(Kind::Any),
                "bool" => Some(Kind::Bool),
                "text" => Some(Kind::Text),
                "bytes" => Some(Kind::Bytes),
                "hash" => Some(Kind::Hash),
                _ => None,
            },
            Value::Array(xs) => match xs.as_slice() {
                [Value::Text(t), Value::Uint(max)] if t == "uint" => Some(Kind::Uint(*max)),
                [Value::Text(t), of] if t == "array" => {
                    Kind::of_value(of).map(|k| Kind::Array(Box::new(k)))
                }
                _ => None,
            },
            _ => None,
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

    /// A schema back from its one form (`Schema.ofValue?`): exactly `title`, `closed` and `fields` in the codec's
    /// order, every field `[name, kind, required]`, no field named twice; `None` for anything else. What it reads is
    /// the schema whose hash was pinned (`ofValue_value`, `value_ofValue`).
    pub fn of_value(v: &Value) -> Option<Schema> {
        let Value::Map(kvs) = v else { return None };
        let [
            (t, Value::Text(title)),
            (c, Value::Bool(closed)),
            (f, Value::Array(fs)),
        ] = kvs.as_slice()
        else {
            return None;
        };
        if (t.as_str(), c.as_str(), f.as_str()) != ("title", "closed", "fields") {
            return None;
        }
        let mut fields: Vec<(String, Kind, bool)> = Vec::with_capacity(fs.len());
        for x in fs {
            let Value::Array(parts) = x else { return None };
            let [Value::Text(name), kind, Value::Bool(required)] = parts.as_slice() else {
                return None;
            };
            if fields.iter().any(|(n, _, _)| n == name) {
                return None;
            }
            fields.push((name.clone(), Kind::of_value(kind)?, *required));
        }
        Some(Schema {
            title: title.clone(),
            fields,
            closed: *closed,
        })
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
