//! aven-db-engine against Lean's `lower.json`, `changes.json` and `merge-check.json` (`Aven.DB.Engine.Lower`,
//! `Engine.Changes`): every expected value comes from `db/spec/vectors`.

mod common;

use aven_core::{DocId, TypeId, encode};
use aven_db_engine::{RecordChange, changes_from, lower_core, verdict_footprint};
use common::*;
use serde_json::{Value as Json, json};

#[test]
fn lowering() {
    let all = vectors("lower.json");
    assert!(all.len() >= 60);
    for v in all {
        let name = &v["name"];
        let c = match v["input"].get("op") {
            Some(o) => {
                let o = op(o);
                let c = o.call();
                assert_eq!(lower_core(&c), Some(vec![o.step()]), "{name}: lower_call");
                c
            }
            None => call(&v["input"]["call"]),
        };
        // Lean writes no encoding for params out of the codec's order: no encoder writes them
        if !v["expected"]["cbor"].is_null() {
            assert_eq!(
                json!(hex_of(&encode(&c.value()))),
                v["expected"]["cbor"],
                "{name}: cbor"
            );
        }
        let steps = lower_core(&c).map(|sts| sts.iter().map(step_json).collect::<Vec<_>>());
        assert_eq!(json!(steps), v["expected"]["steps"], "{name}: steps");
    }
}

fn change_json(c: &RecordChange) -> Json {
    json!({
        "id": hex_of(&c.id),
        "type": c.r#type.text(),
        "kind": c.kind.name(),
        "fields": tuple_json(&c.fields),
    })
}

fn checks(file: &str) {
    let all = vectors(file);
    assert!(all.len() >= 60);
    for v in all {
        let name = &v["name"];
        let i = &v["input"];
        let schema = aven_core::Hash::parse(i["schema"].as_str().unwrap()).unwrap();
        let ver = |t: &DocId| TypeId { r#type: *t, schema };
        let before = list(&i["before"], record);
        let after = list(&i["after"], record);
        let fp = list(&i["footprint"], step);
        let cs = changes_from(&ver, &before, &after);
        let got: Vec<Json> = cs.iter().map(change_json).collect();
        assert_eq!(json!(got), v["expected"]["changes"], "{name}: changes");
        assert_eq!(
            json!(verdict_footprint(&fp, &cs)),
            v["expected"]["verdict"],
            "{name}: verdict"
        );
    }
}

#[test]
fn changes() {
    checks("changes.json");
}

#[test]
fn merge_checks() {
    checks("merge-check.json");
}
