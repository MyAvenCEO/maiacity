//! aven-gen1 against Lean's vectors (README rule 10): every expected value here comes from `db/spec`, written by
//! `lake exe vectors`; this file writes none of its own.

use std::path::PathBuf;

use aven_gen1::status::{Event, Status};
use aven_gen1::timeline;
use serde_json::{Map, Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../db/spec/vectors")
        .join(file);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn event(name: &str) -> Event {
    [Event::Dial, Event::Frame, Event::Tick, Event::Lost]
        .into_iter()
        .find(|e| e.name() == name)
        .unwrap_or_else(|| panic!("unknown event {name}"))
}

#[test]
fn status_follows_the_vectors() {
    let all = vectors("status.json");
    assert!(all.len() >= 60);
    for v in all {
        let limit = v["input"]["limit"].as_u64().unwrap() as u32;
        let mut s = Status::start();
        let states: Vec<Value> = v["input"]["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                s = s.step(limit, event(e.as_str().unwrap()));
                json!({ "phase": s.phase.name(), "moved": s.moved, "idle": s.idle })
            })
            .collect();
        assert_eq!(json!(states), v["expected"], "{}", v["name"]);
    }
}

#[test]
fn timeline_lines_follow_the_vectors() {
    for v in vectors("timeline.json") {
        let i = &v["input"];
        let mut fields = Map::new();
        for pair in i["fields"].as_array().unwrap() {
            fields.insert(pair[0].as_str().unwrap().into(), pair[1].clone());
        }
        let line = timeline::line(
            i["t"].as_u64().unwrap(),
            i["peer"].as_str().unwrap(),
            i["event"].as_str().unwrap(),
            Value::Object(fields),
        );
        // compared as values: serde_json keeps insertion order where another crate of the workspace turns on
        // `preserve_order` (aven-id does), and sorts keys where none does
        assert_eq!(
            serde_json::from_str::<Value>(&line).unwrap(),
            v["expected"],
            "{}",
            v["name"]
        );
    }
}
