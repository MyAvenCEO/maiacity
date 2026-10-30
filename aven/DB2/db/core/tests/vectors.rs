//! aven-db-core against Lean's vectors (README rule 10): every expected value here comes from `db/spec`, written by
//! `lake exe vectors`; this file writes none of its own.

use std::path::PathBuf;

use aven_db_core::presence::Presence;
use aven_db_core::status::{Event, Status};
use aven_db_core::timeline;
use aven_db_core::wire::{Decoder, WireError, encode};
use serde_json::{Map, Value, json};

fn vectors(file: &str) -> Vec<Value> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../spec/vectors")
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
fn presence_follows_the_vectors() {
    for v in vectors("presence.json") {
        let mut p = Presence::default();
        let told: Vec<Value> = v["input"]["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| {
                let peer = c[1].as_u64().unwrap();
                match c[0].as_str().unwrap() {
                    "join" => p.join(peer),
                    "leave" => p.leave(&peer),
                    other => panic!("unknown change {other}"),
                }
                json!(p.present().collect::<Vec<_>>())
            })
            .collect();
        assert_eq!(json!(told), v["expected"], "{}", v["name"]);
        assert_eq!(
            p.count(),
            v["expected"]
                .as_array()
                .unwrap()
                .last()
                .map_or(0, |l| l.as_array().unwrap().len())
        );
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

fn chunk(c: &Value) -> Vec<u8> {
    match c {
        Value::String(s) => s.as_bytes().to_vec(),
        fill => fill["fill"]
            .as_str()
            .unwrap()
            .repeat(fill["len"].as_u64().unwrap() as usize)
            .into_bytes(),
    }
}

/// The chunks of a stream through the decoder: the frames of each push, and the error that ends it.
fn decode(chunks: &[Vec<u8>]) -> Value {
    let mut d = Decoder::default();
    let mut frames = Vec::new();
    for c in chunks {
        match d.push(c) {
            Ok(fs) => frames.push(json!(fs)),
            Err(e) => {
                let e = match e {
                    WireError::Bad(_) => "bad",
                    WireError::TooLong => "tooLong",
                };
                return json!({ "frames": frames, "error": e });
            }
        }
    }
    json!({ "frames": frames, "error": null })
}

#[test]
fn the_wire_follows_the_vectors() {
    for v in vectors("wire.json") {
        let chunks: Vec<Vec<u8>> = v["input"]["chunks"]
            .as_array()
            .unwrap()
            .iter()
            .map(chunk)
            .collect();
        assert_eq!(decode(&chunks), v["expected"], "{}", v["name"]);
    }
}

/// However a stream is cut, the same frames arrive, and they encode back to the same bytes: a property of the
/// decoder over the vectors' streams, not an expected value.
#[test]
fn frames_survive_any_split() {
    for v in vectors("wire.json") {
        if !v["expected"]["error"].is_null() {
            continue;
        }
        let bytes: Vec<u8> = v["input"]["chunks"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(chunk)
            .collect();
        let whole = Decoder::default().push(&bytes).unwrap();
        let encoded: Vec<u8> = whole.iter().flat_map(encode).collect();
        assert_eq!(
            Decoder::default().push(&encoded).unwrap(),
            whole,
            "{}",
            v["name"]
        );
        for cut in 0..bytes.len().min(400) {
            let mut d = Decoder::default();
            let mut got = d.push(&bytes[..cut]).unwrap();
            got.extend(d.push(&bytes[cut..]).unwrap());
            assert_eq!(got, whole, "{} cut at {cut}", v["name"]);
        }
    }
}
