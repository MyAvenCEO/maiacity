//! A manifest moves to an actor through the lens "Manifest, v2 to Actor, v3" (maia/content/game/code/sources/actors.js
//! `actorLens`), as the Actors v3 AIP moves each of Maia City's: a proposal on the entry, then one write through v3 that
//! sets the actor's fields. The write stores what `View::put` makes of it, and the rules count it only where that
//! record fits the schemas the entry was written under (`lens::Lane::fits`). A lens that converts `kind`, `v` and
//! `tiers` one field at a time stores loads beside kind `manifest` and v 2, a record neither schema reads: refused, and
//! `may` says so before anything is proposed. The lens that moves the three together stores a v3 record, which v3 reads
//! back as written and v2 reads as a manifest with empty tiers. The schemas, both lenses and the `assets` manifest as
//! the vault holds it come from tests/data/actors-v3.json (actors.test.js keeps it equal to the JS).

use avendb::cast;
use avendb::engine;
use avendb::id::SignerId;
use avendb::lens::{Lens, Schema};
use serde_json::{json, Value};
use avendb_testkit::{ok, refused};

const FIXTURE: &str = include_str!("../data/actors-v3.json");

fn run(w: &mut cast::World, d: SignerId, op: Value) -> Value {
    engine::run(&mut w.lab, d, &op)
}

#[test]
fn a_manifest_moves_to_an_actor_only_through_the_lens_that_moves_kind_v_and_tiers_together() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let blob = |k: &str| f[k].as_str().expect("a blob").as_bytes().to_vec();
    let mut w = cast::world();
    let (alice, mac) = (w.alice, w.mac_a);
    let (v2, v3) = (Schema::parse(&blob("manifest_v2")).unwrap(), Schema::parse(&blob("actor_v3")).unwrap());
    let (per_field, lens) = (Lens::parse(&blob("lens_per_field")).unwrap(), Lens::parse(&blob("lens")).unwrap());
    // the lane picks the lens with the smallest id where two join one pair: the one that moves them together
    assert!(lens.id() < per_field.id());
    for k in ["manifest_v2", "actor_v3", "lens_per_field"] {
        w.lab.add_schema(mac, alice, alice, &blob(k)).expect("a lane entry");
    }
    let create = json!({ "op": "create", "vault": alice.to_hex(), "type": "manifest", "schema": v2.id().to_hex(),
        "tags": ["manifest", "manifest:assets"], "value": f["stored"] });
    let e = ok(run(&mut w, mac, create))["entry"].as_str().unwrap().to_string();
    let fields = ["kind", "v", "id", "title", "note", "routes", "slots", "interface", "code", "loads"];
    let set = |k: &str, line: &Value| {
        json!({ "op": "set", "entry": e, "line": line, "schema": v3.id().to_hex(), "path": [k], "value": f["actor"][k] })
    };
    let batch = |line: &Value| {
        let sets: Vec<Value> = fields.iter().filter(|&&k| f["actor"].get(k).is_some()).map(|k| set(k, line)).collect();
        json!({ "op": "batch", "ops": sets })
    };
    let asked = |w: &mut cast::World, line: &Value| ok(run(w, mac, json!({ "op": "may", "ops": [batch(line)] })))[0].clone();
    // per field: asked on main before any proposal, refused as the write on a proposal's line is, which holds nothing
    assert_eq!(asked(&mut w, &Value::Null)["refused"], "NotAView");
    let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": e, "name": "actor v3" })))["line"].clone();
    assert_eq!(asked(&mut w, &line)["refused"], "NotAView");
    assert_eq!(refused(&run(&mut w, mac, batch(&line))), "NotAView");
    // together: the same write fits
    w.lab.add_schema(mac, alice, alice, &blob("lens")).expect("a lane entry");
    assert_eq!(asked(&mut w, &Value::Null), json!(true));
    assert_eq!(asked(&mut w, &line), json!(true));
    ok(run(&mut w, mac, batch(&line)));
    let read = |w: &mut cast::World, schema: &Schema| {
        let get = json!({ "op": "get", "entry": e, "line": line, "schema": schema.id().to_hex() });
        ok(run(w, mac, get))["record"].clone()
    };
    let actor = read(&mut w, &v3);
    for k in fields.iter().filter(|&&k| f["actor"].get(k).is_some()) {
        assert_eq!(actor[*k], f["actor"][*k], "{k} reads back as written");
    }
    let manifest = read(&mut w, &v2);
    assert_eq!((manifest["kind"].clone(), manifest["v"].clone()), (json!("manifest"), json!(2)));
    assert_eq!(manifest["tiers"], json!({ "now": [], "next": [], "later": [], "idle": [] }));
}

/// "Manifest, v1" as a test writes it: `priority` and `parts` where v2 has `v` and `tiers`, and no slots.
const MANIFEST_V1: &str = r#"{"title": "Manifest, v1", "type": "object", "required": ["kind", "id", "title"], "properties": {
  "kind": { "const": "manifest" }, "id": { "type": "string" }, "title": { "type": "string" },
  "note": { "type": "string", "default": "" }, "routes": { "type": "array", "items": { "type": "string" }, "default": [] },
  "priority": { "enum": ["high", "medium", "low"], "default": "medium" },
  "parts": { "type": "array", "items": { "type": "object" }, "default": [] } }}"#;

/// The lens "Manifest, v1 to v2" (AIP-38, #1303) from `v1` to `v2`.
fn manifest_lens(v1: &Schema, v2: &Schema) -> String {
    json!({ "lens": "Manifest, v1 to v2", "from": v1.id().to_hex(), "to": v2.id().to_hex(), "steps": [
        { "add": "slots" },
        { "convert": { "from": ["priority", "parts"], "to": ["v", "tiers"],
            "forward": [[{}, { "v": 2, "tiers": { "now": [], "next": [], "later": [], "idle": [] } }]],
            "backward": [[{}, { "parts": [] }]] } } ] })
    .to_string()
}

/// A manifest written under v1 and moved to v2 (the kernel and 13 others in Maia City) is written under two schemas
/// besides v3, which a view joins by one lens. Moved whole, v1 is spent on it: its record holds nothing of v1 alone, and
/// the lens from v1 to v2 has nothing left to translate, so v3 opens it writable through the lens from v2, and it moves
/// as the others did. One moved only in part (a v2 write of its title alone, so its priority and parts are still
/// stored) holds what v1 alone names: v3 reads nothing of it, and the move is refused.
#[test]
fn a_manifest_written_under_v1_and_then_v2_moves_to_v3_once_v1_is_spent() {
    let f: Value = serde_json::from_str(FIXTURE).unwrap();
    let blob = |k: &str| f[k].as_str().expect("a blob").as_bytes().to_vec();
    let mut w = cast::world();
    let (alice, mac) = (w.alice, w.mac_a);
    let v1 = Schema::parse(MANIFEST_V1.as_bytes()).unwrap();
    let (v2, v3) = (Schema::parse(&blob("manifest_v2")).unwrap(), Schema::parse(&blob("actor_v3")).unwrap());
    for b in [MANIFEST_V1.as_bytes().to_vec(), blob("manifest_v2"), manifest_lens(&v1, &v2).into_bytes()] {
        w.lab.add_schema(mac, alice, alice, &b).expect("a lane entry");
    }
    let kernel = json!({ "kind": "manifest", "id": "kernel", "title": "Kernel", "routes": ["*"], "priority": "high",
        "parts": [{ "part": "headers", "want": { "type": ["capgroup", "schema", "lens"] } }] });
    let create = |w: &mut cast::World, title: &str| {
        let mut value = kernel.clone();
        value["title"] = json!(title);
        let op = json!({ "op": "create", "vault": alice.to_hex(), "type": "manifest", "schema": v1.id().to_hex(), "value": value });
        ok(run(w, mac, op))["entry"].as_str().unwrap().to_string()
    };
    let (whole, part) = (create(&mut w, "Kernel"), create(&mut w, "Half"));
    // to v2, as AIP-38 moved them: one write of v, tiers and slots through v2; the other of its title alone
    let through = |schema: &Schema, e: &str, line: &Value, sets: &[(&str, Value)]| {
        let ops: Vec<Value> = sets.iter().map(|(k, v)| json!({ "op": "set", "entry": e, "line": line,
            "schema": schema.id().to_hex(), "path": [k], "value": v })).collect();
        json!({ "op": "batch", "ops": ops })
    };
    let tiers = json!({ "now": kernel["parts"].clone(), "next": [], "later": [], "idle": [] });
    ok(run(&mut w, mac, through(&v2, &whole, &Value::Null, &[("v", json!(2)), ("tiers", tiers), ("slots", json!([]))])));
    ok(run(&mut w, mac, through(&v2, &part, &Value::Null, &[("title", json!("Half, renamed"))])));
    for k in ["actor_v3", "lens"] {
        w.lab.add_schema(mac, alice, alice, &blob(k)).expect("a lane entry");
    }
    let held = |e: &str| json!({ "op": "get", "entry": e, "schema": v3.id().to_hex() });
    assert_eq!(ok(run(&mut w, mac, held(&whole)))["readOnly"], json!(false), "v1 is spent on the kernel");
    // its priority and parts are v1's alone, and with no v nor tiers it is no v2 manifest that v3 reads
    assert_eq!(refused(&run(&mut w, mac, held(&part))), "NoSchema");
    let loads = json!({ "now": [{ "part": "headers", "query": { "entry": "query-capgroup-schema-lens", "version": 1 } }] });
    let interface = json!({ "version": 1, "description": "What every page reads first.", "methods": [] });
    let moves = |e: &str, line: &Value| through(&v3, e, line, &[("loads", loads.clone()), ("interface", interface.clone())]);
    for (e, fits) in [(&whole, true), (&part, false)] {
        let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": e, "name": "actor v3" })))["line"].clone();
        let may = ok(run(&mut w, mac, json!({ "op": "may", "ops": [moves(e, &line)] })))[0].clone();
        match fits {
            true => {
                assert_eq!(may, json!(true));
                ok(run(&mut w, mac, moves(e, &line)));
                let get = |schema: &Schema| json!({ "op": "get", "entry": e, "line": line, "schema": schema.id().to_hex() });
                let actor = ok(run(&mut w, mac, get(&v3)))["record"].clone();
                assert_eq!((&actor["kind"], &actor["v"], &actor["loads"]), (&json!("actor"), &json!(3), &loads));
                assert_eq!(actor["interface"]["description"], interface["description"]);
                let manifest = ok(run(&mut w, mac, get(&v2)))["record"].clone();
                assert_eq!((&manifest["kind"], &manifest["v"]), (&json!("manifest"), &json!(2)));
                // and moved, v1 and v2 are spent on it: v3 opens it writable again
                assert_eq!(ok(run(&mut w, mac, get(&v3)))["readOnly"], json!(false));
            }
            false => {
                assert_eq!(may["refused"], "NoSchema", "{may}");
                assert_eq!(refused(&run(&mut w, mac, moves(e, &line))), "NoSchema");
            }
        }
    }
}
