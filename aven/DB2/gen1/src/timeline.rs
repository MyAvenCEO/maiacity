//! The timeline (SANDBOX.md, "The Control Room", `Aven.DB.Timeline`): every peer writes its events as JSON lines of
//! one shape, and the box gathers them into one stream. The clock is the caller's: this only shapes the line.

use serde_json::{Map, Value, json};

/// One line: when (milliseconds since the epoch), which peer, what, and the event's own fields. A field of the same
/// name never takes the place of the three.
pub fn line(t: u64, peer: &str, event: &str, fields: Value) -> String {
    let mut out = Map::new();
    out.insert("t".into(), json!(t));
    out.insert("peer".into(), json!(peer));
    out.insert("event".into(), json!(event));
    if let Value::Object(fields) = fields {
        for (key, value) in fields {
            if !out.contains_key(&key) {
                out.insert(key, value);
            }
        }
    }
    Value::Object(out).to_string()
}
