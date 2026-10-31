//! How the engine compares Values (`Engine.vals`, in `Engine.Index`).
//!
//! Values are equal by Core's lawful equality. They are ordered as the index keys are (`Aven.DB.Docs.Key.Field.lt`):
//! by kind (bytes, text, negative, then non-negative integers), then integers by sign and magnitude (`Nint(n)` is
//! `-1 - n`), text and bytes bytewise, which for UTF-8 is code-point order. Other Values, which no key holds, order by
//! their encoding, and so does a keyable Value against one that isn't.

use aven_core::{Value, encode};

/// `vals.eq`.
pub fn eq(a: &Value, b: &Value) -> bool {
    a == b
}

/// A keyable Value's kind and its place among the kinds (`Field.tag`).
enum Field<'a> {
    Bytes(&'a [u8]),
    Text(&'a [u8]),
    Nint(u64),
    Uint(u64),
}

impl Field<'_> {
    fn tag(&self) -> u8 {
        match self {
            Field::Bytes(_) => 0x01,
            Field::Text(_) => 0x02,
            Field::Nint(_) => 0x13,
            Field::Uint(_) => 0x15,
        }
    }
}

/// `toField`: bytes, text and integers are keyable; no other kind is.
fn to_field(v: &Value) -> Option<Field<'_>> {
    match v {
        Value::Bytes(b) => Some(Field::Bytes(b)),
        Value::Text(t) => Some(Field::Text(t.as_bytes())),
        Value::Nint(n) => Some(Field::Nint(*n)),
        Value::Uint(n) => Some(Field::Uint(*n)),
        _ => None,
    }
}

/// `vals.lt`.
pub fn lt(a: &Value, b: &Value) -> bool {
    match (to_field(a), to_field(b)) {
        (Some(x), Some(y)) => match (x, y) {
            (Field::Bytes(a), Field::Bytes(b)) | (Field::Text(a), Field::Text(b)) => a < b,
            (Field::Nint(a), Field::Nint(b)) => b < a,
            (Field::Uint(a), Field::Uint(b)) => a < b,
            (x, y) => x.tag() < y.tag(),
        },
        _ => encode(a) < encode(b),
    }
}

/// `vals.count`: a count written as a Value.
pub fn count(n: usize) -> Value {
    Value::Uint(n as u64)
}
