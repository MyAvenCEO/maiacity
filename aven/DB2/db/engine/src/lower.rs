//! Lowering `core/1`'s calls to steps (`Engine.Lower`; A32; caps, "Footprints").
//!
//! An envelope names the call it ran, `{op, params}`, and every reader lowers it alike to the steps the verdict's
//! footprint part judges its changes against. `core/1`'s writes take exactly `type` (the type Doc's 32 bytes) then
//! `fields` (a list of text); a remove names no field; read, tell, keep and share lower to no step; a `put` lowers to
//! `put-new`, as the engine's `put` always mints a new id, and no call lowers to `put-replace`. A call that is not
//! `core/1`'s, or whose params differ, is refused (`None`). A committer's op names the call [`Op::call`], which lowers
//! to exactly its own footprint step (`lower_call`).

use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use aven_core::{Call, CoreOp, DocId, Hash, Step, StepVerb, Value};

use crate::mutate::Op;

/// The `core/1` op an id names, if any (`coreOp?`).
pub fn core_op(id: &Hash) -> Option<CoreOp> {
    CoreOp::ALL.into_iter().find(|o| o.id() == *id)
}

/// A write's step verb; `None` for the ops that write nothing (`CoreOp.verb?`).
pub fn verb(o: CoreOp) -> Option<StepVerb> {
    match o {
        CoreOp::Put => Some(StepVerb::PutNew),
        CoreOp::Patch => Some(StepVerb::Patch),
        CoreOp::Remove => Some(StepVerb::Remove),
        CoreOp::Edit => Some(StepVerb::Edit),
        CoreOp::Read | CoreOp::Tell | CoreOp::Keep | CoreOp::Share => None,
    }
}

/// A write's params read back: exactly `type`, 32 bytes, then `fields`, a list of text (`writeParams`).
fn write_params(params: &[(String, Value)]) -> Option<(DocId, Vec<String>)> {
    match params {
        [(t, Value::Bytes(ty)), (f, Value::Array(fs))] if t == "type" && f == "fields" => {
            let ty: [u8; 32] = ty.as_slice().try_into().ok()?;
            let names = fs
                .iter()
                .map(|v| match v {
                    Value::Text(s) => Some(s.clone()),
                    _ => None,
                })
                .collect::<Option<Vec<_>>>()?;
            Some((DocId(Hash(ty)), names))
        }
        _ => None,
    }
}

/// `core/1`'s lowering: a call's steps, or `None` when the call isn't `core/1`'s or its params aren't as its op takes
/// them (`lowerCore`).
pub fn lower_core(c: &Call) -> Option<Vec<Step>> {
    let Some(v) = verb(core_op(&c.op)?) else {
        return Some(Vec::new());
    };
    let (r#type, fields) = write_params(&c.params)?;
    if v == StepVerb::Remove && !fields.is_empty() {
        return None;
    }
    Some(vec![Step {
        r#type,
        verb: v,
        fields,
    }])
}

impl Op {
    /// The `core/1` op an engine op is (`Op.core`).
    pub fn core(&self) -> CoreOp {
        match self {
            Op::Put { .. } => CoreOp::Put,
            Op::Patch { .. } => CoreOp::Patch,
            Op::Remove { .. } => CoreOp::Remove,
            Op::Edit { .. } => CoreOp::Edit,
        }
    }

    /// The call an op names: its `core/1` op, and its step's type and fields (`Op.call`).
    pub fn call(&self) -> Call {
        let st = self.step();
        Call {
            op: self.core().id(),
            params: vec![
                ("type".into(), Value::Bytes(st.r#type.0.0.to_vec())),
                (
                    "fields".into(),
                    Value::Array(st.fields.into_iter().map(Value::Text).collect()),
                ),
            ],
        }
    }
}
