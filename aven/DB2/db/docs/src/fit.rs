//! Fit, judged once per envelope from what it names (docs, rule 15, "Fit"; `Aven.DB.Docs.Fit`, `Changes`).
//!
//! Fit reads one view of an envelope, its [`RecordChange`]s: per Record it touches, its id, its type id, whether it is
//! new, edited or gone, and each field it writes with its new value (or its removal). The engine's footprint reads
//! the same view. The checks are the README's:
//! 1. the Records the ops touch are exactly those the envelope names;
//! 2. every named version is pinned by the Doc, and is the Record's own type;
//! 3. every value the ops set is allowed by its field's schema, and within the depth limit;
//! 4. a new Record's required fields are set;
//! 5. no op removes a required field.

use std::collections::BTreeMap;

use aven_core::{DocId, TypeId, Value};

use crate::limits::{Limits, depth};
use crate::schema::Schema;

/// What a change does to its Record (`ChangeKind`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChangeKind {
    New,
    Edited,
    Gone,
}

/// One Record an envelope touches (`RecordChange`). A field's value is `None` where the envelope removes it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecordChange {
    pub id: String,
    pub r#type: TypeId,
    pub kind: ChangeKind,
    pub fields: Vec<(String, Option<Value>)>,
}

impl RecordChange {
    /// The fields it writes, without their values: what a footprint reads.
    pub fn names(&self) -> impl Iterator<Item = &str> {
        self.fields.iter().map(|f| f.0.as_str())
    }
}

/// Why an envelope doesn't fit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Unfit {
    /// Its ops touch other Records than it names.
    Records,
    /// A version that isn't pinned, or isn't the Record's type.
    Version(String),
    /// A value its field's schema doesn't allow, or too deep.
    Value(String, String),
    /// A new Record without a required field.
    Required(String, String),
    /// An op removes a required field.
    Removed(String, String),
    /// An op Records can't hold: another container, a child container, a float, or a write to a Record's type.
    Op(String),
}

/// What a Doc's Records were before an envelope: each Record's type Doc, its `t`.
pub type Types = BTreeMap<String, DocId>;

/// The fit verdict on `changes` that an envelope naming `named` says it makes, with the Doc's pinned schemas.
pub fn fit(
    changes: &[RecordChange],
    named: &[(String, TypeId)],
    pinned: &BTreeMap<TypeId, Schema>,
    limits: &Limits,
) -> Result<(), Unfit> {
    let mut touched: Vec<(&str, &TypeId)> =
        changes.iter().map(|c| (c.id.as_str(), &c.r#type)).collect();
    let mut names: Vec<(&str, &TypeId)> = named.iter().map(|(i, t)| (i.as_str(), t)).collect();
    touched.sort();
    names.sort();
    if touched != names {
        return Err(Unfit::Records);
    }
    for c in changes {
        let schema = pinned
            .get(&c.r#type)
            .ok_or_else(|| Unfit::Version(c.id.clone()))?;
        for (f, v) in &c.fields {
            match v {
                Some(v) if depth(v) > limits.depth || !schema.allows(f, v) => {
                    return Err(Unfit::Value(c.id.clone(), f.clone()));
                }
                None if schema.field(f).is_some_and(|x| x.2) && c.kind != ChangeKind::Gone => {
                    return Err(Unfit::Removed(c.id.clone(), f.clone()));
                }
                _ => {}
            }
        }
        if c.kind == ChangeKind::New {
            for r in schema.required() {
                if !c.fields.iter().any(|(f, v)| f == r && v.is_some()) {
                    return Err(Unfit::Required(c.id.clone(), r.into()));
                }
            }
        }
    }
    Ok(())
}

/// One write of a field: its stamp (Lamport, then writer id, as one order) and its value (`Write`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Write<V> {
    pub stamp: u64,
    pub value: V,
}

/// A field's value after every write: the latest; the first on a tie (`latest`).
pub fn latest<V>(writes: &[Write<V>]) -> Option<&Write<V>> {
    writes
        .iter()
        .rev()
        .fold(None, |acc: Option<&Write<V>>, w| match acc {
            Some(a) if w.stamp < a.stamp => Some(a),
            _ => Some(w),
        })
}
