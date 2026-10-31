//! Mutations (`Engine.Mutate`; engine README, "Mutations"; ARCHITECTURE.md, A18 and A19).
//!
//! A mutation is a list of core ops applied to one Doc as one commit, all or nothing: [`Op::Put`] a new Record,
//! [`Op::Patch`] fields of the Records a `where` finds, [`Op::Remove`] them, or [`Op::Edit`] one field of one Record.
//!
//! - **Ids are made, not drawn:** a Record a `put` creates is named by (writer, counter, op index), so every reader
//!   that re-runs the commit names it alike ([`created`]).
//! - **References point backward:** [`Cell::Ref`]`(n)` names the Record op `n` put; `n` is an earlier op, and a `put`.
//! - **All or nothing:** a commit that fails anywhere changes nothing ([`apply`]).
//!
//! Values are compared by `Engine.valEq` (Core's equality), and a Record's id is written as a Value by
//! [`NewId::value`], the Value whose encoding is its bytes ([`NewId::bytes`]).

use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use aven_core::{DocId, Value, encode};

use crate::query::{Tuple, get};
use crate::value;

/// A Record's id, made from who wrote it: the writer id, its counter for this commit, the op's place in it (`NewId`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NewId {
    pub writer: u64,
    pub counter: u64,
    pub index: u64,
}

impl NewId {
    /// `[writer, counter, index]`: how a reference is written as a field's value (the examples' `ofId`).
    pub fn value(&self) -> Value {
        Value::Array(vec![
            Value::Uint(self.writer),
            Value::Uint(self.counter),
            Value::Uint(self.index),
        ])
    }

    /// A minted Record id as bytes: the encoding of (writer, counter, index) (`NewId.bytes`).
    pub fn bytes(&self) -> Vec<u8> {
        encode(&self.value())
    }
}

/// A Record in one Doc (`Record`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub id: NewId,
    pub r#type: DocId,
    pub fields: Tuple,
}

/// A field's value in a `put`: given, or the id of a Record an earlier `put` of this commit creates (`Cell`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Cell {
    Lit(Value),
    Ref(u64),
}

/// A core op on a Doc's Records, as a plugin's operation lowers to (`Engine.Op`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Op {
    Put {
        r#type: DocId,
        fields: Vec<(String, Cell)>,
    },
    Patch {
        r#type: DocId,
        r#where: Tuple,
        set: Tuple,
    },
    Remove {
        r#type: DocId,
        r#where: Tuple,
    },
    Edit {
        r#type: DocId,
        id: NewId,
        field: String,
        value: Value,
    },
}

/// Why a commit is refused (`Refused`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refused {
    /// A `{ "ref": n }` in this op to an op that is not an earlier `put`.
    BadRef(u64),
    /// An `edit` of a Record of that type the Doc doesn't have.
    Missing(u64),
}

impl Op {
    pub fn is_put(&self) -> bool {
        matches!(self, Op::Put { .. })
    }

    /// The ops a `put`'s references name (`Op.refs`).
    pub fn refs(&self) -> impl Iterator<Item = u64> + '_ {
        let fields: &[(String, Cell)] = match self {
            Op::Put { fields, .. } => fields,
            _ => &[],
        };
        fields.iter().filter_map(|(_, c)| match c {
            Cell::Ref(n) => Some(*n),
            Cell::Lit(_) => None,
        })
    }

    /// The type the op writes.
    pub fn r#type(&self) -> &DocId {
        match self {
            Op::Put { r#type, .. }
            | Op::Patch { r#type, .. }
            | Op::Remove { r#type, .. }
            | Op::Edit { r#type, .. } => r#type,
        }
    }
}

/// Op `i`'s references all point at an earlier `put` (`refsOk`).
fn refs_ok(ops: &[Op], i: usize) -> bool {
    ops[i]
        .refs()
        .all(|n| n < i as u64 && ops.get(n as usize).is_some_and(Op::is_put))
}

/// A Record matches a `where` when it is of the type and has every listed field with that value (`found`).
pub fn found(ty: &DocId, r#where: &[(String, Value)], r: &Record) -> bool {
    r.r#type == *ty
        && r#where
            .iter()
            .all(|(c, v)| get(&r.fields, c).is_some_and(|x| value::eq(x, v)))
}

/// Set fields: replaced where present, added where not, each set field moved to the front in turn (`setFields`).
pub fn set_fields(t: &Tuple, set: &[(String, Value)]) -> Tuple {
    let mut t = t.clone();
    for (c, v) in set {
        t.retain(|(k, _)| k != c);
        t.insert(0, (c.clone(), v.clone()));
    }
    t
}

/// The Record an `edit` names: its id, and the type the op says (`edits`).
fn edits(ty: &DocId, id: &NewId, r: &Record) -> bool {
    r.id == *id && r.r#type == *ty
}

/// One op at index `i` of a commit by writer `w` with counter `c` (`step`).
fn step(w: u64, c: u64, i: u64, mut s: Vec<Record>, op: &Op) -> Result<Vec<Record>, Refused> {
    match op {
        Op::Put { r#type, fields } => {
            let fields = fields
                .iter()
                .map(|(k, x)| {
                    let v = match x {
                        Cell::Lit(v) => v.clone(),
                        Cell::Ref(n) => NewId {
                            writer: w,
                            counter: c,
                            index: *n,
                        }
                        .value(),
                    };
                    (k.clone(), v)
                })
                .collect();
            s.push(Record {
                id: NewId {
                    writer: w,
                    counter: c,
                    index: i,
                },
                r#type: *r#type,
                fields,
            });
            Ok(s)
        }
        Op::Patch {
            r#type,
            r#where,
            set,
        } => {
            for r in s.iter_mut().filter(|r| found(r#type, r#where, r)) {
                r.fields = set_fields(&r.fields, set);
            }
            Ok(s)
        }
        Op::Remove { r#type, r#where } => {
            s.retain(|r| !found(r#type, r#where, r));
            Ok(s)
        }
        Op::Edit {
            r#type,
            id,
            field,
            value,
        } => {
            if !s.iter().any(|r| edits(r#type, id, r)) {
                return Err(Refused::Missing(i));
            }
            let set = [(field.clone(), value.clone())];
            for r in s.iter_mut().filter(|r| edits(r#type, id, r)) {
                r.fields = set_fields(&r.fields, &set);
            }
            Ok(s)
        }
    }
}

/// A commit: every reference checked first, then every op in turn (`commit`).
pub fn commit(w: u64, c: u64, s: &[Record], ops: &[Op]) -> Result<Vec<Record>, Refused> {
    if let Some(i) = (0..ops.len()).find(|&i| !refs_ok(ops, i)) {
        return Err(Refused::BadRef(i as u64));
    }
    ops.iter()
        .enumerate()
        .try_fold(s.to_vec(), |s, (i, op)| step(w, c, i as u64, s, op))
}

/// What the Doc holds after a commit: its result, or exactly what it held before (`apply`).
pub fn apply(w: u64, c: u64, s: &[Record], ops: &[Op]) -> Vec<Record> {
    commit(w, c, s, ops).unwrap_or_else(|_| s.to_vec())
}

/// The ids a commit's `put`s create (`created`).
pub fn created(w: u64, c: u64, ops: &[Op]) -> Vec<NewId> {
    ops.iter()
        .enumerate()
        .filter(|(_, op)| op.is_put())
        .map(|(i, _)| NewId {
            writer: w,
            counter: c,
            index: i as u64,
        })
        .collect()
}
