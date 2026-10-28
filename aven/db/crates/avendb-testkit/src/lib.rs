//! The helpers every avenDB test shares, once (step T3 of the tests and architecture audit): what an op answered or
//! why it was refused, a list in an answer, a wait until a condition holds, the counting allocator of the tests that
//! measure memory (`memory`), and the check that every file of a test program builds (W4). Tests only: no product
//! crate links it.

pub mod memory;

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

/// The Lean model's vector file `name` (`aven/db/spec/vectors/<name>.json`, written by `lake exe vectors`).
pub fn vectors(name: &str) -> Value {
    let path = format!("{}/../../spec/vectors/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}: run `lake exe vectors` in aven/db/spec"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// A number in a vector, which must be one.
pub fn num(v: &Value) -> u64 {
    v.as_u64().unwrap_or_else(|| panic!("a number, not {v}"))
}

/// Every `.rs` file in the folder `dir` of a test program is a module its `main.rs` (`main`) names: cargo builds only
/// what a `mod` line names, so a file none names never builds and none of its tests runs (W4, each crate's tests one
/// program: `tests/all/`).
pub fn every_file_a_module(main: &str, dir: &str) {
    let named: Vec<&str> = main.lines().filter_map(|l| l.trim().strip_prefix("mod ")?.strip_suffix(';')).collect();
    let mut unnamed = vec![];
    for file in std::fs::read_dir(dir).unwrap_or_else(|e| panic!("{dir}: {e}")) {
        let name = file.unwrap_or_else(|e| panic!("{dir}: {e}")).file_name();
        let name = name.to_str().unwrap_or_else(|| panic!("{dir}: a file name in UTF-8, not {name:?}"));
        if let Some(module) = name.strip_suffix(".rs").filter(|m| *m != "main" && !named.contains(m)) {
            unnamed.push(format!("mod {module};"));
        }
    }
    unnamed.sort();
    assert!(unnamed.is_empty(), "{dir}: no `mod` line names these files, so they never build: add {}", unnamed.join(" "));
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
