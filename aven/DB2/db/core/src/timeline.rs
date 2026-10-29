//! The timeline (SANDBOX.md, "The Control Room"): every peer writes its events as JSON lines of one shape, and the box
//! gathers them into one stream. The clock is the caller's: this only shapes the line.

use serde_json::{Map, Value, json};

/// One line: when (milliseconds since the epoch), which peer, what, and the event's own fields.
pub fn line(t: u64, peer: &str, event: &str, fields: Value) -> String {
    let mut out = Map::new();
    out.insert("t".into(), json!(t));
    out.insert("peer".into(), json!(peer));
    out.insert("event".into(), json!(event));
    if let Value::Object(fields) = fields {
        out.extend(fields);
    }
    Value::Object(out).to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn one_shape() {
        let l = super::line(5, "aven-peer", "phase", serde_json::json!({ "phase": "live" }));
        assert_eq!(l, r#"{"event":"phase","peer":"aven-peer","phase":"live","t":5}"#);
    }
}
