//! A field's value as Loro holds it and as the one codec does (ARCHITECTURE.md rule 1). Fields of Records are Core
//! Values: no floats, and integers within Loro's `i64`. Anything else Loro might hold (a float, a child container) is
//! no Value, so it never fits.

use aven_core::Value;
use loro::LoroValue;

/// A Core Value as Loro stores it, `None` for an integer outside `i64`.
pub fn to_loro(v: &Value) -> Option<LoroValue> {
    Some(match v {
        Value::Uint(n) => LoroValue::I64(i64::try_from(*n).ok()?),
        Value::Nint(n) => LoroValue::I64(-1 - i64::try_from(*n).ok()?),
        Value::Bytes(b) => LoroValue::Binary(b.clone().into()),
        Value::Text(s) => LoroValue::String(s.clone().into()),
        Value::Array(xs) => {
            LoroValue::List(xs.iter().map(to_loro).collect::<Option<Vec<_>>>()?.into())
        }
        Value::Map(kvs) => LoroValue::Map(
            kvs.iter()
                .map(|(k, x)| Some((k.clone(), to_loro(x)?)))
                .collect::<Option<std::collections::HashMap<_, _>>>()?
                .into(),
        ),
        Value::Bool(b) => LoroValue::Bool(*b),
        Value::Null => LoroValue::Null,
    })
}

/// A Loro value as a Core Value, `None` for a float or a container.
pub fn of_loro(v: &LoroValue) -> Option<Value> {
    Some(match v {
        LoroValue::Null => Value::Null,
        LoroValue::Bool(b) => Value::Bool(*b),
        LoroValue::I64(n) if *n >= 0 => Value::Uint(*n as u64),
        LoroValue::I64(n) => Value::Nint((-1 - *n) as u64),
        LoroValue::Binary(b) => Value::Bytes(b.to_vec()),
        LoroValue::String(s) => Value::Text(s.to_string()),
        LoroValue::List(xs) => Value::Array(xs.iter().map(of_loro).collect::<Option<_>>()?),
        LoroValue::Map(kvs) => {
            let mut kvs: Vec<(String, Value)> = kvs
                .iter()
                .map(|(k, x)| Some((k.clone(), of_loro(x)?)))
                .collect::<Option<_>>()?;
            kvs.sort_by(|a, b| a.0.len().cmp(&b.0.len()).then_with(|| a.0.cmp(&b.0)));
            Value::Map(kvs)
        }
        LoroValue::Double(_) | LoroValue::Container(_) => return None,
    })
}
