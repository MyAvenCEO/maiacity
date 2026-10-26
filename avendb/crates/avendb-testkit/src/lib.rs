//! The helpers every avenDB test shares, once (step T3 of the tests and architecture audit): what an op answered or
//! why it was refused, a list in an answer, and a wait until a condition holds. Tests only: no product crate links it.

use serde_json::Value;

/// What an op answered, which it must have done.
pub fn ok(answer: Value) -> Value {
    assert!(answer.get("ok").is_some(), "refused: {answer}");
    answer["ok"].clone()
}

/// Why an op was refused, which it must have been.
pub fn refused(answer: &Value) -> &str {
    answer["refused"].as_str().unwrap_or_else(|| panic!("not refused: {answer}"))
}

/// The items of a list in an answer, which must be one: a missing list fails, never reads as empty.
pub fn list(v: &Value) -> &[Value] {
    v.as_array().unwrap_or_else(|| panic!("a list, not {v}"))
}

/// The Lean model's vector file `name` (`avendb/spec/vectors/<name>.json`, written by `lake exe vectors`).
pub fn vectors(name: &str) -> Value {
    let path = format!("{}/../../spec/vectors/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}: run `lake exe vectors` in avendb/spec"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// A number in a vector, which must be one.
pub fn num(v: &Value) -> u64 {
    v.as_u64().unwrap_or_else(|| panic!("a number, not {v}"))
}

/// Waits until `check` holds, 60 seconds at most.
#[cfg(feature = "wait")]
pub async fn until<F: Future<Output = bool>>(what: &str, check: impl FnMut() -> F) {
    until_within(std::time::Duration::from_secs(60), what, check).await
}

/// Waits until `check` holds, `within` at most, looking every 50 ms.
#[cfg(feature = "wait")]
pub async fn until_within<F: Future<Output = bool>>(within: std::time::Duration, what: &str, mut check: impl FnMut() -> F) {
    // the wall clock, not tokio's: a test on paused time still ends
    let end = std::time::Instant::now() + within;
    while !check().await {
        assert!(std::time::Instant::now() < end, "{what}, within {within:?}");
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}
