//! Footprints, and every reader's check of a diff (`Engine.Footprint`; caps, "Footprints"; ARCHITECTURE.md, A18,
//! A19 and A32).
//!
//! Every lowered op has a footprint [`Step`]: the type it writes, its verb and its fields. A cap names the ops a holder
//! may call, never steps; the steps are the op's lowering, which every reader computes alike, and then checks what the
//! envelope actually changed against it ([`diff_within`]): a new Record, no Record before having its id, by a `put-new`
//! of its type writing its fields, a changed Record keeping its id and type and changing only fields the footprint
//! writes, a gone Record by a `remove` of its type. A commit that ran as its ops say, under a (writer, counter) the Doc
//! hasn't seen, always passes (`commit_within`).

use alloc::vec;
use alloc::vec::Vec;

use aven_core::{DocId, Step, StepVerb, Value};

use crate::mutate::{Op, Record};
use crate::query::get;
use crate::value;

impl Op {
    /// The op's footprint step (`Op.step`).
    pub fn step(&self) -> Step {
        match self {
            Op::Put { r#type, fields } => Step {
                r#type: *r#type,
                verb: StepVerb::PutNew,
                fields: fields.iter().map(|(f, _)| f.clone()).collect(),
            },
            Op::Patch { r#type, set, .. } => Step {
                r#type: *r#type,
                verb: StepVerb::Patch,
                fields: set.iter().map(|(f, _)| f.clone()).collect(),
            },
            Op::Remove { r#type, .. } => Step {
                r#type: *r#type,
                verb: StepVerb::Remove,
                fields: vec![],
            },
            Op::Edit { r#type, field, .. } => Step {
                r#type: *r#type,
                verb: StepVerb::Edit,
                fields: vec![field.clone()],
            },
        }
    }
}

/// A commit's footprint, known from its ops before it runs (`footprint`).
pub fn footprint(ops: &[Op]) -> Vec<Step> {
    ops.iter().map(Op::step).collect()
}

/// Whether the footprint writes field `f` for a type: `(fieldsOf fp ty).contains f`.
pub fn writes(fp: &[Step], ty: &DocId, f: &str) -> bool {
    fp.iter()
        .any(|st| st.r#type == *ty && st.fields.iter().any(|x| x == f))
}

/// The footprint has a step of this verb for a type (`hasVerb`).
pub fn has_verb(fp: &[Step], ty: &DocId, v: StepVerb) -> bool {
    fp.iter().any(|st| st.r#type == *ty && st.verb == v)
}

/// `optEq`: both there and equal, or both missing.
pub fn opt_eq(a: Option<&Value>, b: Option<&Value>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => value::eq(a, b),
        (None, None) => true,
        _ => false,
    }
}

/// A Record that kept its id and type, and changed only fields the footprint writes for its type (`changedOk`).
fn changed_ok(fp: &[Step], r0: &Record, r: &Record) -> bool {
    r0.id == r.id
        && r0.r#type == r.r#type
        && r0
            .fields
            .iter()
            .chain(&r.fields)
            .all(|(f, _)| opt_eq(get(&r0.fields, f), get(&r.fields, f)) || writes(fp, &r.r#type, f))
}

/// A new Record: its type is created, with only fields the footprint writes (`newOk`).
fn new_ok(fp: &[Step], r: &Record) -> bool {
    has_verb(fp, &r.r#type, StepVerb::PutNew)
        && r.fields.iter().all(|(f, _)| writes(fp, &r.r#type, f))
}

/// What every reader checks: the Doc before, the Doc after, and the footprint (`diffWithin`).
pub fn diff_within(fp: &[Step], s: &[Record], s2: &[Record]) -> bool {
    s2.iter().all(|r| {
        s.iter().any(|r0| changed_ok(fp, r0, r))
            || (new_ok(fp, r) && !s.iter().any(|r0| r0.id == r.id))
    }) && s.iter().all(|r0| {
        s2.iter().any(|r| r.id == r0.id && r.r#type == r0.r#type)
            || has_verb(fp, &r0.r#type, StepVerb::Remove)
    })
}

/// A reader accepts a commit's diff when it stays within the footprint of the ops it lowers to (`check`).
pub fn check(ops: &[Op], s: &[Record], s2: &[Record]) -> bool {
    diff_within(&footprint(ops), s, s2)
}
