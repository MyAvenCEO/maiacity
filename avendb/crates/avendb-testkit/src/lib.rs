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
