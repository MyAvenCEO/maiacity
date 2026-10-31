//! Ops (`Aven.Core.Op`, A32). An operation is named by the hash of its stored form (rule 1): one of `core/1`'s, the
//! core verbs, or a plugin's, which lowers to core ops. A cap line names an op by its id and bounds on its parameters,
//! and nothing else; an envelope names the op it ran and its parameters ([`Call`]).
//!
//! - `core/1`'s ops are read, put, patch, remove, edit, tell, keep and share, each with a fixed id: the name of its
//!   stored form `{"op": name, "plugin": "core/1"}`. Read, tell, keep and share lower to no step ([`CoreOp::writes`]).
//! - A [`Bound`] is an enumeration: any value, or one of some values, and for a list each of its elements one of them.
//!   A narrower bound allows no value a wider one doesn't (`Bound.within_allows`).
//! - Every Doc has a type (A39): a type Doc's own type is the built-in type of types, which is its own type too.

use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use crate::cbor::Value;
use crate::names::{DocId, Hash, name_of};
use crate::target::Facts;

/// An operation, named by the hash of its stored form.
pub type OpId = Hash;

/// `core/1`'s operations, the core verbs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum CoreOp {
    Read,
    Put,
    Patch,
    Remove,
    Edit,
    Tell,
    Keep,
    Share,
}

impl CoreOp {
    /// All eight, in Lean's order.
    pub const ALL: [CoreOp; 8] = [
        CoreOp::Read,
        CoreOp::Put,
        CoreOp::Patch,
        CoreOp::Remove,
        CoreOp::Edit,
        CoreOp::Tell,
        CoreOp::Keep,
        CoreOp::Share,
    ];

    pub fn name(self) -> &'static str {
        match self {
            CoreOp::Read => "read",
            CoreOp::Put => "put",
            CoreOp::Patch => "patch",
            CoreOp::Remove => "remove",
            CoreOp::Edit => "edit",
            CoreOp::Tell => "tell",
            CoreOp::Keep => "keep",
            CoreOp::Share => "share",
        }
    }

    /// Put, patch, remove and edit lower to steps; read, tell, keep and share to none.
    pub fn writes(self) -> bool {
        matches!(
            self,
            CoreOp::Put | CoreOp::Patch | CoreOp::Remove | CoreOp::Edit
        )
    }

    /// Its stored form, `{"op": name, "plugin": "core/1"}`.
    pub fn value(self) -> Value {
        Value::Map(vec![
            ("op".into(), Value::Text(self.name().into())),
            ("plugin".into(), Value::Text("core/1".into())),
        ])
    }

    /// Its id: the name of its stored form.
    pub fn id(self) -> OpId {
        name_of(&self.value())
    }
}

/// A bound on one parameter (Lean's `Option (List Value)`): any value, or one of these values; for a list, each of its
/// elements one of them.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Bound {
    Any,
    OneOf(Vec<Value>),
}

impl Bound {
    /// `Bound.allows`.
    pub fn allows(&self, v: &Value) -> bool {
        match (self, v) {
            (Bound::Any, _) => true,
            (Bound::OneOf(vs), Value::Array(xs)) => xs.iter().all(|x| vs.contains(x)),
            (Bound::OneOf(vs), v) => vs.contains(v),
        }
    }

    /// Read back from [`Bound::value`] (`Bound.ofValue?`): null for any value, an array for the values it allows.
    pub fn of_value(v: Value) -> Option<Bound> {
        match v {
            Value::Null => Some(Bound::Any),
            Value::Array(vs) => Some(Bound::OneOf(vs)),
            _ => None,
        }
    }

    /// `Bound.within`: any value it allows, the other allows too.
    pub fn within(&self, other: &Bound) -> bool {
        match (self, other) {
            (_, Bound::Any) => true,
            (Bound::OneOf(vs), Bound::OneOf(ws)) => vs.iter().all(|v| ws.contains(v)),
            (Bound::Any, Bound::OneOf(_)) => false,
        }
    }

    /// Null for any value, else the values it allows.
    pub fn value(&self) -> Value {
        match self {
            Bound::Any => Value::Null,
            Bound::OneOf(vs) => Value::Array(vs.clone()),
        }
    }
}

/// An op called: the op by its id and its parameters by name, as an envelope names what it ran.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Call {
    pub op: OpId,
    pub params: Vec<(String, Value)>,
}

impl Call {
    /// A parameter's value; one the call doesn't give reads as null (`Call.param`: the first with that name).
    pub fn param(&self, p: &str) -> Value {
        self.params
            .iter()
            .find(|(k, _)| k == p)
            .map_or(Value::Null, |(_, v)| v.clone())
    }

    /// `{"op": id, "params": {name: value, …}}` (`Call.value`). Lean writes the params as given, so a call whose
    /// params aren't in the codec's order, or name one twice, isn't canonical; this crate's `encode` writes maps in the
    /// codec's order, so it agrees with Lean on every canonical call.
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("op".into(), self.op.value()),
            ("params".into(), Value::Map(self.params.clone())),
        ])
    }

    /// Read back from [`Call::value`] (`Call.ofValue?`): its op a hash of 32 bytes, its params a map. Bytes that aren't
    /// canonical never reach it: `decode` refuses them, a call's params out of order among them.
    pub fn of_value(v: Value) -> Option<Call> {
        let Value::Map(kvs) = v else { return None };
        let [(ko, Value::Bytes(op)), (kp, Value::Map(params))]: [(String, Value); 2] =
            kvs.try_into().ok()?
        else {
            return None;
        };
        if ko != "op" || kp != "params" {
            return None;
        }
        Some(Call {
            op: Hash(op.as_slice().try_into().ok()?),
            params,
        })
    }
}

/// The built-in type of types: the root type of every type Doc, and its own. Its id is the name of a fixed label.
pub fn type_of_types() -> DocId {
    DocId(name_of(&Value::Text("avenDB type of types 1".into())))
}

impl Facts {
    /// A type Doc: one whose root type is the type of types.
    pub fn is_type(&self) -> bool {
        self.r#type == type_of_types()
    }

    /// The type of types' own facts: built in, in no vault, and its own type.
    pub fn type_of_types() -> Facts {
        Facts {
            id: type_of_types(),
            vault: String::new(),
            r#type: type_of_types(),
        }
    }
}
