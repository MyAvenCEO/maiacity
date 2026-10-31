//! Caps against Lean's vectors (`caps.json`, `Aven.ID.Caps`, `Aven.ID.CapsCbor`). Every expected value is the
//! model's.

mod common;

use aven_id::caps::Branches;
use common::vectors;
use serde_json::{Value, json};

fn branches(v: &Value) -> Branches {
    match v {
        Value::String(s) if s == "any" => Branches::Any,
        Value::String(s) if s == "main" => Branches::Main,
        Value::String(s) if s == "proposals" => Branches::Proposals,
        _ => Branches::One(v["branch"].as_str().unwrap().into()),
    }
}

#[test]
fn branches_allow_as_the_model_does() {
    let all: Vec<Value> = vectors("caps.json")
        .into_iter()
        .filter(|v| v["input"].get("branches").is_some())
        .collect();
    assert!(all.len() >= 8, "{} branch vectors", all.len());
    for v in &all {
        let got = branches(&v["input"]["branches"]).allows(v["input"]["branch"].as_str().unwrap());
        assert_eq!(json!({ "allows": got }), v["expected"], "{}", v["name"]);
    }
}
