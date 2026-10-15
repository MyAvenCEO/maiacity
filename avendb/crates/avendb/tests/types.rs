//! Schema types v2 (`lens::Schema`, `docs/ARCHITECTURE.md` §8): numbers with bounds, strings with a length, tuples,
//! bounded lists and objects as one value, nested to any depth, shapes named once in `$defs`; and how an item stores
//! them (`doc::Item`): a tuple, a bounded list or an object is one value, which two devices editing it at once keep
//! one of, whole, while an unbounded list of values still merges item by item and a list of records row by row.

use std::collections::BTreeSet;

use avendb::doc::{Item, Version};
use avendb::id::{BlobId, SignerId};
use avendb::lens::{Lane, Schema, View};
use serde_json::{json, Value};

const MAC: SignerId = SignerId::from_u64(2);
const PHONE: SignerId = SignerId::from_u64(3);

/// A part of a machine: every type v2 adds, at the top and in a list of records.
const PART: &str = r##"{ "title": "Part", "type": "object",
  "$defs": {
    "vec3": { "type": "array", "prefixItems": [ { "type": "number" }, { "type": "number" }, { "type": "number" } ] },
    "material": { "type": "object", "properties": {
      "name": { "type": "string", "maxLength": 24 },
      "density": { "type": "number", "minimum": 0, "maximum": 25000 },
      "colour": { "type": "string", "maxLength": 7 } },
      "required": ["name"], "additionalProperties": false } },
  "properties": {
    "kind": { "const": "part" },
    "name": { "type": "string", "maxLength": 40 },
    "mass": { "type": "number", "minimum": 0 },
    "count": { "type": "integer", "minimum": 1, "maximum": 99 },
    "at": { "$ref": "#/$defs/vec3" },
    "material": { "$ref": "#/$defs/material" },
    "ports": { "type": "array", "items": { "type": "object", "properties": {
      "name": { "type": "string" }, "at": { "$ref": "#/$defs/vec3" } }, "required": ["name"] } },
    "colours": { "type": "array", "items": { "type": "string" }, "maxItems": 3 },
    "tags": { "type": "array", "items": { "type": "string" } },
    "pieces": { "type": "array", "items": { "type": "object", "properties": {
      "id": { "type": "integer" },
      "at": { "$ref": "#/$defs/vec3" },
      "material": { "$ref": "#/$defs/material" },
      "holes": { "type": "array", "items": { "type": "object", "properties": {
        "id": { "type": "integer" }, "d": { "type": "number", "minimum": 0 } }, "required": ["id"] } } },
      "required": ["id"] } } },
  "required": ["kind", "name"] }"##;

fn part() -> Schema {
    Schema::parse(PART.as_bytes()).expect("a schema of the subset")
}

fn steel() -> Value {
    json!({
        "kind": "part",
        "name": "Bracket",
        "mass": 1.25,
        "count": 4,
        "at": [0.5, -1.0, 2.0],
        "material": { "name": "steel", "density": 7850.0, "colour": "#8a8f99" },
        "ports": [{ "name": "bolt", "at": [0.0, 0.0, 0.1] }, { "name": "pin" }],
        "colours": ["grey", "black"],
        "tags": ["metal"],
        "pieces": [
            { "id": 1, "at": [0, 0, 0], "material": { "name": "steel" }, "holes": [{ "id": 1, "d": 0.008 }] },
            { "id": 2 }
        ]
    })
}

fn with(r: &Value, change: impl FnOnce(&mut Value)) -> Value {
    let mut r = r.clone();
    change(&mut r);
    r
}

#[test]
fn a_record_of_every_type_reads_as_written() {
    let s = part();
    assert_eq!(s.read(&steel()), Some(steel()));
    // an integer is a number too
    assert_eq!(s.read(&with(&steel(), |r| r["mass"] = json!(2))).unwrap()["mass"], json!(2));
}

#[test]
fn a_value_out_of_its_bounds_does_not_read() {
    let s = part();
    let read = |change: fn(&mut Value)| s.read(&with(&steel(), change));
    // a required field that doesn't fit: the record doesn't read
    assert_eq!(read(|r| r["name"] = json!("x".repeat(41))), None);
    assert!(read(|r| r["name"] = json!("é".repeat(40))).is_some(), "a length counts characters, not bytes");
    // a field that may be absent and doesn't fit reads as absent
    let absent = |change: fn(&mut Value), f: &str| {
        let r = read(change).expect("the record still reads");
        assert!(r.get(f).is_none(), "{f}: {r}");
    };
    absent(|r| r["mass"] = json!(-0.5), "mass");
    absent(|r| r["mass"] = json!("heavy"), "mass");
    absent(|r| r["count"] = json!(100), "count");
    absent(|r| r["count"] = json!(0), "count");
    absent(|r| r["count"] = json!(1.5), "count");
    absent(|r| r["at"] = json!([0, 0]), "at");
    absent(|r| r["at"] = json!([0, 0, 0, 0]), "at");
    absent(|r| r["at"] = json!([0, "up", 0]), "at");
    absent(|r| r["material"] = json!({ "density": 1 }), "material");
    absent(|r| r["material"] = json!({ "name": "oak", "grain": "fine" }), "material");
    absent(|r| r["material"] = json!({ "name": "lead", "density": 30000 }), "material");
    absent(|r| r["material"] = json!({ "name": "steel", "colour": "metallic grey" }), "material");
    absent(|r| r["ports"] = json!([{ "at": [0, 0, 0] }]), "ports");
    absent(|r| r["colours"] = json!(["a", "b", "c", "d"]), "colours");
    // a list of values keeps those that fit, a list of records the rows that read
    assert_eq!(read(|r| r["tags"] = json!(["metal", 7])).unwrap()["tags"], json!(["metal"]));
    let rows = read(|r| r["pieces"][0]["material"] = json!({ "name": 3 })).unwrap();
    assert!(rows["pieces"][0].get("material").is_none(), "a row's field that doesn't fit reads as absent");
    let holes = read(|r| r["pieces"][0]["holes"] = json!([{ "id": 1, "d": -1 }])).unwrap();
    assert!(holes["pieces"][0].get("holes").is_none(), "{holes}");
}

#[test]
fn objects_nest_to_any_depth() {
    let deep = r#"{ "title": "Deep", "type": "object", "properties": {
      "a": { "type": "object", "properties": { "b": { "type": "object", "properties": {
        "c": { "type": "array", "items": { "type": "object", "properties": {
          "d": { "type": "array", "prefixItems": [ { "type": "integer" }, { "type": "boolean" } ] } } } } } } } } } }"#;
    let s = Schema::parse(deep.as_bytes()).expect("nested objects parse");
    let r = json!({ "a": { "b": { "c": [{ "d": [1, true] }, {}] } } });
    assert_eq!(s.read(&r), Some(r.clone()));
    let wrong = json!({ "a": { "b": { "c": [{ "d": [1, 2] }] } } });
    assert_eq!(s.read(&wrong), Some(json!({})), "the field whose value doesn't fit, whole");
}

#[test]
fn a_schema_whose_refs_dont_resolve_is_none() {
    let refs = |defs: &str, at: &str| {
        let s = format!(r#"{{ "type": "object", "$defs": {defs}, "properties": {{ "x": {{ "$ref": "{at}" }} }} }}"#);
        Schema::parse(s.as_bytes())
    };
    assert!(refs(r#"{ "n": { "type": "number" } }"#, "#/$defs/n").is_some());
    assert!(refs(r#"{ "n": { "type": "number" } }"#, "#/$defs/m").is_none(), "a name it doesn't define");
    assert!(refs(r#"{ "n": { "type": "number" } }"#, "other.json#/n").is_none(), "only its own $defs");
    assert!(refs(r##"{ "a": { "$ref": "#/$defs/b" }, "b": { "$ref": "#/$defs/a" } }"##, "#/$defs/a").is_none(), "a circle");
    let selfish = r##"{ "t": { "type": "object", "properties": { "next": { "$ref": "#/$defs/t" } } } }"##;
    assert!(refs(selfish, "#/$defs/t").is_none(), "a shape that holds itself has no end");
}

/// The item a Mac makes of `r`, and the same item on the phone.
fn two_devices(view: &View, r: &Value) -> (Item, Item) {
    let mac = Item::made(view, r, MAC).expect("the Mac writes it");
    let phone = mac.fork_as(PHONE);
    (mac, phone)
}

/// Each takes the other's edits since both held `at`, each signed by its own device.
fn exchange(at: &Version, mac: &mut Item, phone: &mut Item) {
    let (m, p) = (mac.export(at), phone.export(at));
    mac.import(&p, PHONE).expect("the phone's edits import");
    phone.import(&m, MAC).expect("the Mac's edits import");
    assert_eq!(mac.record(), phone.record(), "both hold the same");
}

#[test]
fn a_value_is_kept_whole_and_a_list_merges_item_by_item() {
    let view = View::plain(&part());
    let (mut mac, mut phone) = two_devices(&view, &steel());
    let at = mac.version();
    // at once: the Mac changes the material's density, the phone its colour; both move the part, both tag it
    assert!(mac.write(&view, &with(&steel(), |r| {
        r["material"]["density"] = json!(7900.0);
        r["at"] = json!([1.0, 1.0, 1.0]);
        r["colours"] = json!(["red"]);
        r["tags"] = json!(["metal", "mac"]);
    })));
    assert!(phone.write(&view, &with(&steel(), |r| {
        r["material"]["colour"] = json!("#000000");
        r["at"] = json!([2.0, 2.0, 2.0]);
        r["colours"] = json!(["blue", "green"]);
        r["tags"] = json!(["metal", "phone"]);
    })));
    exchange(&at, &mut mac, &mut phone);
    let r = mac.read(&view).expect("it reads");
    // one of the two materials, whole: never the Mac's density with the phone's colour
    let ours = json!({ "name": "steel", "density": 7900.0, "colour": "#8a8f99" });
    let theirs = json!({ "name": "steel", "density": 7850.0, "colour": "#000000" });
    assert!(r["material"] == ours || r["material"] == theirs, "{}", r["material"]);
    assert!(r["at"] == json!([1.0, 1.0, 1.0]) || r["at"] == json!([2.0, 2.0, 2.0]), "{}", r["at"]);
    assert!(r["colours"] == json!(["red"]) || r["colours"] == json!(["blue", "green"]), "a bounded list is one value");
    // the unbounded list keeps both tags
    let tags: BTreeSet<&str> = r["tags"].as_array().unwrap().iter().filter_map(Value::as_str).collect();
    assert_eq!(tags, BTreeSet::from(["metal", "mac", "phone"]));
}

#[test]
fn a_row_merges_field_by_field_its_values_whole() {
    let view = View::plain(&part());
    let (mut mac, mut phone) = two_devices(&view, &steel());
    let at = mac.version();
    assert!(mac.write(&view, &with(&steel(), |r| r["pieces"][0]["at"] = json!([9, 9, 9]))));
    assert!(phone.write(&view, &with(&steel(), |r| r["pieces"][0]["material"] = json!({ "name": "brass" }))));
    exchange(&at, &mut mac, &mut phone);
    let piece = &mac.read(&view).unwrap()["pieces"][0];
    assert_eq!(piece["at"], json!([9, 9, 9]), "{piece}");
    assert_eq!(piece["material"], json!({ "name": "brass" }), "{piece}");
}

#[test]
fn a_value_stays_one_value_through_a_restore() {
    // a merge, a restore or an undo puts back a record with no schema at hand: what is one value stays one value
    let view = View::plain(&part());
    let mut item = Item::made(&view, &steel(), MAC).unwrap();
    let older = item.record();
    assert!(item.write(&view, &with(&steel(), |r| {
        r["ports"] = json!([{ "name": "hinge" }]);
        r["at"] = json!([3, 3, 3]);
    })));
    item.put_record(&older);
    assert_eq!(item.record(), older);
    // the restored ports are still one value: one device moving a port while another renames it keeps one of the two
    // lists, whole, never the one's place with the other's name
    let mut phone = item.fork_as(PHONE);
    let at = item.version();
    let moved = with(&older, |r| r["ports"][0]["at"] = json!([9, 9, 9]));
    let renamed = with(&older, |r| r["ports"][0]["name"] = json!("nut"));
    assert!(item.write(&view, &moved));
    assert!(phone.write(&view, &renamed));
    exchange(&at, &mut item, &mut phone);
    let ports = &item.record()["ports"];
    assert!(*ports == moved["ports"] || *ports == renamed["ports"], "{ports}");
}

#[test]
fn a_write_of_v2_values_fits_its_schema() {
    // readers judge a write by the schema it was written under: v2 values in place fit, others don't
    let s = part();
    let lane = Lane::new([s.bytes()]);
    let under: BTreeSet<BlobId> = BTreeSet::from([s.id()]);
    let before = steel();
    let fits = |change: fn(&mut Value)| lane.fits(&under, &before, &with(&before, change));
    assert!(fits(|r| r["material"] = json!({ "name": "oak", "density": 700 })));
    assert!(fits(|r| r["at"] = json!([0.25, 0.5, 0.75])));
    assert!(fits(|r| r["ports"] = json!([])));
    assert!(fits(|r| r["colours"] = json!([])));
    assert!(fits(|r| r["pieces"][0]["holes"] = json!([{ "id": 2, "d": 0.01 }])));
    assert!(!fits(|r| r["material"] = json!({ "name": "oak", "grain": "fine" })));
    assert!(!fits(|r| r["at"] = json!([0, 0])));
    assert!(!fits(|r| r["count"] = json!(100)));
    assert!(!fits(|r| r["pieces"][0]["at"] = json!(["x", 0, 0])));
}
