//! Ops (`Aven.Core.Op`, A32). An operation is named by the hash of its stored form (rule 1): one of `core/1`'s, the
//! core verbs, or a plugin's, which lowers to core ops. A cap line names an op by its id and bounds on its parameters,
//! and nothing else; an envelope names the op it ran and its parameters ([`Call`]).
//!
//! - `core/1`'s ops are read, put, patch, remove, edit, tell, keep and share, each with a fixed id: the name of its
//!   stored form `{"op": name, "plugin": "core/1"}`. Read, tell, keep and share lower to no step ([`CoreOp::writes`]).
//! - A [`Bound`] is an enumeration: one of some values, and for a list each of its elements one of them; a param that
//!   may take any value is left out (A200). A narrower bound allows no value a wider one doesn't (`Bound.within_allows`).
//! - Every Doc has a type (A39): a type Doc's own type is the built-in type of types, which is its own type too.

use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use crate::limits::{MAX_BOUND_VALUES, MAX_PARAMS};
use crate::target::Facts;
use aven_codec::Value;
use aven_codec::{DocId, Hash, name_of};

/// An operation, named by the hash of its stored form.
pub type OpId = Hash;

/// A plugin's built-in op in its stored form, `{"op": name, "plugin": plugin}` (`OpId.stored`).
pub fn stored_op(plugin: &str, name: &str) -> Value {
    Value::Map(vec![
        ("op".into(), Value::Text(name.into())),
        ("plugin".into(), Value::Text(plugin.into())),
    ])
}

/// Any plugin's built-in op id: the name of its stored form (`OpId.ofPlugin`), the one way an op of `core/1`,
/// `tree/1` or any other plugin is named (A45).
pub fn op_id(plugin: &str, name: &str) -> OpId {
    name_of(&stored_op(plugin, name))
}

/// `core/1`'s write params: the type a write is on (`typeParam`) and the fields it sets (`fieldsParam`).
pub const TYPE_PARAM: &str = "type";
pub const FIELDS_PARAM: &str = "fields";

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
        stored_op("core/1", self.name())
    }

    /// Its id: `core/1`'s op of its name ([`op_id`]).
    pub fn id(self) -> OpId {
        op_id("core/1", self.name())
    }
}

/// A bound on one parameter (`Bound`): the values it may take; for a list, each of its elements one of them. A
/// parameter that may take any value isn't bounded: a cap line leaves it out (A200).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bound(pub Vec<Value>);

impl Bound {
    /// `Bound.allows`.
    pub fn allows(&self, v: &Value) -> bool {
        match v {
            Value::Array(xs) => xs.iter().all(|x| self.0.contains(x)),
            v => self.0.contains(v),
        }
    }

    /// Read back from [`Bound::value`] (`Bound.ofValue?`): an array of at most [`MAX_BOUND_VALUES`]. A null is no
    /// bound (A200).
    pub fn of_value(v: Value) -> Option<Bound> {
        match v {
            Value::Array(vs) if vs.len() <= MAX_BOUND_VALUES => Some(Bound(vs)),
            _ => None,
        }
    }

    /// `Bound.within`: every value it allows, the other allows too.
    pub fn within(&self, other: &Bound) -> bool {
        self.0.iter().all(|v| other.0.contains(v))
    }

    /// The array of the values it allows (`Bound.value`).
    pub fn value(&self) -> Value {
        Value::Array(self.0.clone())
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
        if ko != "op" || kp != "params" || params.len() > MAX_PARAMS {
            return None;
        }
        Some(Call {
            op: Hash::of_value(&Value::Bytes(op))?,
            params,
        })
    }
}

/// A built-in type (`builtinType`): no Doc's genesis, its id the name of the label `<namespace> <name> 1`. The one
/// way a part names its built-in types (A45).
pub fn builtin_type(namespace: &str, name: &str) -> DocId {
    DocId(name_of(&Value::Text(alloc::format!(
        "{namespace} {name} 1"
    ))))
}

/// The name that stands for no vault (`noVault`): 32 zero bytes, which no vault's genesis hashes to.
pub const NO_VAULT: Hash = Hash([0; 32]);

/// The built-in type of types: the root type of every type Doc, and its own, `avenDB type of types 1`.
pub fn type_of_types() -> DocId {
    builtin_type("avenDB", "type of types")
}

impl Facts {
    /// A type Doc: one whose root type is the type of types.
    pub fn is_type(&self) -> bool {
        self.r#type == type_of_types()
    }

    /// The type of types' own facts: built in, in no vault ([`NO_VAULT`]), and its own type.
    pub fn type_of_types() -> Facts {
        Facts {
            id: type_of_types(),
            vault: NO_VAULT,
            r#type: type_of_types(),
        }
    }
}
