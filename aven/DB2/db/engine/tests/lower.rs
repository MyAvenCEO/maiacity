//! aven-db-engine against Lean's `lower.json`, `changes.json` and `merge-check.json` (`Aven.DB.Engine.Lower`,
//! `Engine.Changes`): every expected value comes from `db/spec/vectors`.

mod common;

use aven_core::{DocId, encode};
use aven_db_engine::{RecordChange, Version, changes_from, lower_core, verdict_footprint};
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

/// A change's fields as Lean writes them, `[field, value]` or `[field]` for a removal, sorted by field: the vectors'
/// Records give their fields as JSON objects, which keep no order.
fn fields_json(fs: &[(String, Option<aven_core::Value>)]) -> Json {
    let mut out: Vec<Json> = fs
        .iter()
        .map(|(f, v)| match v {
            Some(v) => json!([f, json_value(v)]),
            None => json!([f]),
        })
        .collect();
    out.sort_by(|a, b| a[0].as_str().cmp(&b[0].as_str()));
    Json::Array(out)
}

fn sorted_fields(c: &Json) -> Json {
    let mut c = c.clone();
    if let Some(fs) = c.get_mut("fields").and_then(Json::as_array_mut) {
        fs.sort_by(|a, b| a[0].as_str().cmp(&b[0].as_str()));
    }
    c
}

/// A version as the vectors write it: `[type Doc]` or `[type Doc, schema hash]`.
fn version_json(v: &Version) -> Json {
    let mut out = vec![json!(v.r#type.text())];
    out.extend(v.schema.map(|h| json!(h.text())));
    Json::Array(out)
}

fn change_json(c: &RecordChange) -> Json {
    json!({
        "id": hex_of(&c.id),
        "type": version_json(&c.r#type),
        "kind": c.kind.name(),
        "fields": fields_json(&c.fields),
    })
}

fn checks(file: &str) {
    let all = vectors(file);
    assert!(all.len() >= 60);
    for v in all {
        let name = &v["name"];
        let i = &v["input"];
        let schema = aven_core::Hash::parse(i["schema"].as_str().unwrap()).unwrap();
        let ver = |t: &DocId| Version {
            r#type: *t,
            schema: Some(schema),
        };
        let before = list(&i["before"], record);
        let after = list(&i["after"], record);
        let fp = list(&i["footprint"], step);
        let cs = changes_from(&ver, &before, &after);
        let got: Vec<Json> = cs.iter().map(change_json).collect();
        let want: Vec<Json> = list(&v["expected"]["changes"], sorted_fields);
        assert_eq!(got, want, "{name}: changes");
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
