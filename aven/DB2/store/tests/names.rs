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
