//! The Lean model's objective vectors (`avendb/spec/vectors/objectives.json`, written by `lake exe vectors` from
//! `spec/AvenDB/ObjectiveVectors.lean`): each case an objective file Lean elaborated, the metrics it holds, readings
//! and what `check` answers. The engine reads each file to the same metrics and checks them to the same results.

use avendb::objective::{self, Dec};
use serde_json::Value;

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../spec/vectors/objectives.json");

fn dec(v: &Value) -> Option<Dec> {
    v.as_i64().map(Dec::from).or_else(|| v.as_u64().map(Dec::from))
}

#[test]
fn objective_vectors() {
    let file: Value = serde_json::from_str(&std::fs::read_to_string(VECTORS).unwrap()).unwrap();
    let cases = file["cases"].as_array().unwrap();
    assert!(cases.len() >= 4);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let metrics = objective::parse(c["lean"].as_str().unwrap()).unwrap_or_else(|e| panic!("{name}: {e}"));
        let model: Vec<Value> = c["metrics"].as_array().unwrap().clone();
        assert_eq!(metrics.len(), model.len(), "{name}");
        for (m, want) in metrics.iter().zip(&model) {
            assert_eq!(m.name, want["name"].as_str().unwrap(), "{name}");
            assert_eq!(m.goal.to_json(), want["goal"], "{name}: {}", m.id);
        }
        let readings: Vec<(String, Dec)> = (c["readings"].as_array().unwrap().iter())
            .map(|r| (r["name"].as_str().unwrap().to_string(), dec(&r["value"]).unwrap()))
            .collect();
        let got = objective::check(&metrics, &readings);
        let want = &c["result"];
        assert_eq!(got.met as u64, want["met"].as_u64().unwrap(), "{name}");
        assert_eq!(got.total as u64, want["total"].as_u64().unwrap(), "{name}");
        assert_eq!(Some(got.progress), dec(&want["progress"]), "{name}");
        for (i, (r, w)) in got.results.iter().zip(want["metrics"].as_array().unwrap()).enumerate() {
            assert_eq!(r.value, dec(&w["value"]), "{name} #{i} value");
            assert_eq!(r.baseline, dec(&w["baseline"]), "{name} #{i} baseline");
            let ts: Vec<Option<Dec>> = w["targets"].as_array().unwrap().iter().map(dec).collect();
            assert_eq!(r.targets, ts, "{name} #{i} targets");
            assert_eq!(r.met, w["met"].as_bool().unwrap(), "{name} #{i} met");
            assert_eq!(Some(r.progress), dec(&w["progress"]), "{name} #{i} progress");
        }
    }
}

#[test]
fn notes_are_doc_comments() {
    let file: Value = serde_json::from_str(&std::fs::read_to_string(VECTORS).unwrap()).unwrap();
    let start = objective::parse(file["cases"][0]["lean"].as_str().unwrap()).unwrap();
    assert_eq!(start[0].note.as_deref(), Some("V1 shows its first frame within 1.5 s on the 8 GB Mac."));
    assert_eq!(start[1].id, "fps");
}
