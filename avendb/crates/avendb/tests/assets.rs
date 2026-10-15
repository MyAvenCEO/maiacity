//! The game's asset schema (`src/lib/assets/schemas/asset.v1.json`, the app's side) read by avenDB's own schema
//! parser, the same check a `create` of a `schema` entry makes (`Lab::add_schema`). Assets are not stored in avenDB
//! yet; this keeps the day they are a matter of creating the entry: if avenDB would refuse the schema, or read an asset
//! record other than as the app writes it, this fails.

use avendb::lens::Schema;
use serde_json::{json, Value};

const ASSET_V1: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../src/lib/assets/schemas/asset.v1.json");

fn asset_v1() -> Schema {
    let bytes = std::fs::read(ASSET_V1).expect("the app's asset schema is there");
    Schema::parse(&bytes).expect("avenDB reads the asset schema as a schema of its subset")
}

#[test]
fn avendb_reads_the_asset_schema() {
    let s = asset_v1();
    assert_eq!(s.kind(), Some("asset"));
    assert_eq!(s.title(), "Asset, v1");
}

#[test]
fn an_asset_record_reads_as_written() {
    let s = asset_v1();
    let apple = json!({
        "kind": "asset",
        "title": "Apple",
        "group": "plants",
        "name": "apple",
        "version": 2,
        "note": "Grown from code, seed to fruit, roots and all",
        "licence": "CC0-1.0",
        "files": [
            { "id": 1, "role": "recipe", "name": "recipe.js", "media": "text/javascript" },
            { "id": 2, "role": "card", "name": "card.json", "media": "application/json" },
            { "id": 3, "role": "lod0", "name": "lod0.glb", "media": "model/gltf-binary" },
            { "id": 4, "role": "impostor", "name": "impostor.webp", "media": "image/webp" }
        ],
        "tags": ["fruit-tree"]
    });
    assert_eq!(s.read(&apple), Some(apple));

    // what it leaves out reads as its default
    let bare = json!({ "kind": "asset", "group": "things", "name": "bed" });
    let read = s.read(&bare).expect("an asset with its group and name reads");
    assert_eq!(read["version"], json!(1));
    assert_eq!(read["files"], json!([]));
}

#[test]
fn what_is_not_an_asset_does_not_read() {
    let s = asset_v1();
    let no_group = json!({ "kind": "asset", "name": "apple" });
    assert_eq!(s.read(&no_group), None);
    let other_group = json!({ "kind": "asset", "group": "weapons", "name": "x" });
    assert_eq!(s.read(&other_group), None);
    // a file of a role it doesn't know is not read; the asset still is
    let odd: Value = json!({ "kind": "asset", "group": "plants", "name": "apple",
        "files": [{ "id": 1, "role": "script", "name": "x.js" }] });
    assert_eq!(s.read(&odd).expect("the asset reads")["files"], json!([]));
}
