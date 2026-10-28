//! A manifest moves to an actor through the lens "Manifest, v2 to Actor, v3" (game/code/sources/actors.js
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

const FIXTURE: &str = include_str!("data/actors-v3.json");

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
