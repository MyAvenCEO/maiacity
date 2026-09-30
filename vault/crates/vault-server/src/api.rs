//! How the API's answers read to the vault server's loops: not set up (no Prem key), paused (the API's breaker after
//! Prem failed, or its own rate limit — until when, and why), or a failure of the file itself.

use std::time::Duration;

use serde_json::Value;

/// Why a round stops without blaming the file: the API has no Prem key.
#[derive(Debug)]
pub struct NotReady;
impl std::fmt::Display for NotReady {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("the analysis is not set up on the API (PREMAI_API_KEY)")
    }
}
impl std::error::Error for NotReady {}

/// Prem is paused for a model — the API's breaker after Prem failed (its attestation report unavailable, the model not
/// enabled for our key, rate limiting), or the API's own rate limit: until when, and why. The round stops at once (no
/// next file), the waiting files say why (`queued: <reason>`), and nothing is asked until then.
#[derive(Debug, Clone, PartialEq)]
pub struct Paused {
    pub until: Option<chrono::DateTime<chrono::Utc>>,
    pub reason: String,
    /// only the API's own rate limit (not Prem failing): a stretch may wait for it and go on
    pub rate: bool,
}
impl std::fmt::Display for Paused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.until {
            Some(u) => write!(f, "{} (paused until {})", self.reason, u.format("%H:%M:%S UTC")),
            None => f.write_str(&self.reason),
        }
    }
}
impl std::error::Error for Paused {}

impl Paused {
    /// How long to sleep: until the pause ends (a minute at least, half an hour at most; five minutes when unsaid).
    pub fn wait(&self, now: chrono::DateTime<chrono::Utc>) -> Duration {
        let secs = self.until.map(|u| (u - now).num_seconds()).unwrap_or(300);
        Duration::from_secs(secs.clamp(60, 1800) as u64)
    }
}

/// The API's answer when it is not a result: paused (503 with `paused_until`, or `transient`), not set up (a 503
/// without), or the file's own failure.
pub fn api_error(status: u16, body: &[u8]) -> anyhow::Error {
    let v: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let why = v["error"].as_str().map(String::from);
    if v.get("paused_until").is_some() || v["transient"] == true {
        let until = v["paused_until"].as_str().and_then(|u| chrono::DateTime::parse_from_rfc3339(u).ok()).map(|u| u.with_timezone(&chrono::Utc));
        let reason = v["reason"].as_str().map(String::from).or(why).unwrap_or_else(|| "Prem is paused".into());
        return Paused { until, reason, rate: v["pause"] == "rate" }.into();
    }
    if status == 503 {
        return NotReady.into();
    }
    anyhow::anyhow!("{}", why.unwrap_or_else(|| format!("the API answered {status}")))
}

/// Is the API paused for its model right now (its status route says `paused_until`)?
pub fn status_paused(v: &Value) -> Option<Paused> {
    let until = v["paused_until"].as_str()?;
    let until = chrono::DateTime::parse_from_rfc3339(until).ok().map(|u| u.with_timezone(&chrono::Utc));
    Some(Paused { until, reason: v["reason"].as_str().unwrap_or("Prem is paused").to_string(), rate: false })
}

/// The state a waiting file shows: queued, and why.
pub fn queued(p: &Paused) -> String {
    format!("queued: {}", p.reason)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_paused_api_stops_the_round_and_says_why() {
        let body = br#"{"error":"qwen38-27b is not enabled for confidential use on our Prem key","transient":true,"paused_until":"2026-09-30T07:00:00.000Z","reason":"qwen38-27b is not enabled for confidential use on our Prem key","pause":"provider"}"#;
        let e = api_error(503, body);
        let p = e.downcast_ref::<Paused>().unwrap();
        assert_eq!(p.reason, "qwen38-27b is not enabled for confidential use on our Prem key");
        assert!(!p.rate);
        assert_eq!(queued(p), "queued: qwen38-27b is not enabled for confidential use on our Prem key");
        let now = chrono::DateTime::parse_from_rfc3339("2026-09-30T06:55:00Z").unwrap().with_timezone(&chrono::Utc);
        assert_eq!(p.wait(now), Duration::from_secs(300));
        // a pause about to end still waits a minute
        let soon = chrono::DateTime::parse_from_rfc3339("2026-09-30T06:59:59Z").unwrap().with_timezone(&chrono::Utc);
        assert_eq!(p.wait(soon), Duration::from_secs(60));
        assert!(api_error(503, br#"{"error":"x","pause":"rate","paused_until":"2026-09-30T07:00:00Z"}"#).downcast_ref::<Paused>().unwrap().rate);
        // not set up: a 503 without a pause; the file's own failure: anything else
        assert!(api_error(503, br#"{"error":"PREMAI_API_KEY is missing"}"#).is::<NotReady>());
        let own = api_error(502, br#"{"error":"Prem's attestation of m failed verification"}"#);
        assert!(!own.is::<Paused>() && !own.is::<NotReady>());
        assert_eq!(own.to_string(), "Prem's attestation of m failed verification");
        assert!(status_paused(&json!({ "ready": true })).is_none());
        assert_eq!(status_paused(&json!({ "ready": true, "paused_until": "2026-09-30T07:00:00Z", "reason": "r" })).unwrap().reason, "r");
    }
}
