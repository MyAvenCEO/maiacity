//! A Value in its one JSON form (`Aven.Core.Json`): null, booleans, integers of either sign, text, arrays, maps, and
//! bytes as `{"bytes": hex}`. How a part is written in the repository and how a page hands Values to the host.

use aven_core::Value;
use serde_json::Value as Json;

/// A Value from its JSON form; `None` for a float, an integer out of range, or bytes that aren't hex.
pub fn of_json(j: &Json) -> Option<Value> {
    Some(match j {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => match (n.as_u64(), n.as_i64()) {
            (Some(u), _) => Value::Uint(u),
            (None, Some(i)) => Value::Nint((-1 - i) as u64),
            _ => return None,
        },
        Json::String(s) => Value::Text(s.clone()),
        Json::Array(xs) => Value::Array(xs.iter().map(of_json).collect::<Option<_>>()?),
        Json::Object(o) if o.len() == 1 && o.contains_key("bytes") => {
            Value::Bytes(unhex(o["bytes"].as_str()?)?)
        }
        Json::Object(o) => Value::Map(
            o.iter()
                .map(|(k, v)| Some((k.clone(), of_json(v)?)))
                .collect::<Option<_>>()?,
        ),
    })
}

/// A Value's JSON form. A negative integer below `i64::MIN` has none, nor has a map with the key `bytes` alone.
pub fn to_json(v: &Value) -> Option<Json> {
    Some(match v {
        Value::Null => Json::Null,
        Value::Bool(b) => Json::Bool(*b),
        Value::Uint(u) => Json::from(*u),
        Value::Nint(n) => Json::from(i64::try_from(*n).ok().map(|n| -1 - n)?),
        Value::Text(s) => Json::String(s.clone()),
        Value::Bytes(b) => {
            let hex: String = b.iter().map(|x| format!("{x:02x}")).collect();
            Json::Object(
                [("bytes".to_string(), Json::String(hex))]
                    .into_iter()
                    .collect(),
            )
        }
        Value::Array(xs) => Json::Array(xs.iter().map(to_json).collect::<Option<_>>()?),
        Value::Map(kv) if kv.len() == 1 && kv[0].0 == "bytes" => return None,
        Value::Map(kv) => Json::Object(
            kv.iter()
                .map(|(k, v)| Some((k.clone(), to_json(v)?)))
                .collect::<Option<_>>()?,
        ),
    })
}

fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(s.get(i..i + 2)?, 16).ok())
        .collect()
}
