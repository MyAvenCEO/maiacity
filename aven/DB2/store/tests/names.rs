//! The contract's two names. Which spellings are a hash is Lean's (`db/spec/vectors/hashes.json`); which ref names are
//! valid, and every hash the store computes, the model's traces check on every backend.

use aven_db_store::Hash;
use serde_json::Value;

#[test]
fn only_the_stores_own_spelling_reads_as_a_hash() {
    let vectors: Vec<Value> =
        serde_json::from_str(include_str!("../../db/spec/vectors/hashes.json")).unwrap();
    for v in vectors {
        let s = v["input"]["hash"].as_str().unwrap();
        assert_eq!(
            Value::Bool(s.parse::<Hash>().is_ok()),
            v["expected"],
            "{s:?}"
        );
    }
}

/// A hash reads back from its own spelling: a property, not an expected value.
#[test]
fn a_hash_reads_back_from_hex() {
    for len in [0, 1, 1000] {
        let hash = Hash::of(&vec![7; len]);
        assert_eq!(hash.to_hex().parse::<Hash>().unwrap(), hash);
    }
}

/// A ref at rest is its hash and a newline, and reads back with the newline or without (`db/spec/vectors/refs.json`,
/// Lean `Store.refText`, `Store.readRef`).
#[test]
fn a_ref_at_rest_reads_as_the_model_says() {
    let vectors: Vec<Value> = serde_json::from_str(include_str!("../../db/spec/vectors/refs.json")).unwrap();
    assert!(vectors.len() >= 10);
    for v in vectors {
        if let Some(stored) = v["input"]["stored"].as_str() {
            let reads = Hash::from_ref(stored.as_bytes()).ok().map(|h| Value::String(h.to_hex()));
            assert_eq!(reads.unwrap_or(Value::Null), v["expected"]["reads"], "{}", v["name"]);
        } else {
            let hash: Hash = v["input"]["hash"].as_str().unwrap().parse().unwrap();
            assert_eq!(Value::String(hash.ref_text()), v["expected"]["stored"]);
        }
    }
}
