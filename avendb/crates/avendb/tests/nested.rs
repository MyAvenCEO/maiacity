//! Records inside records (`docs/ARCHITECTURE.md` §8, `spec/AvenDB/Ops.lean`): a row holds lists of records of its
//! own, at any depth, and a shape may hold rows of its own shape (an outline). An item stores each nested list as the
//! record's own, a movable list of maps in its row's map, made mergeable (`doc::Item`): rows merge by id at every
//! depth, two devices making a row's first list at once share it, a text edit lands in its row wherever its parents
//! move, and two devices adding one id at once keep both rows, apps seeing the first. A lens reads a list's rows' lists through
//! its own steps (`in` inside `in`). Every reader judges a write per row, at any depth, and none deeper than the
//! ceiling (`lens::CEILING`): that a write deeper counts for no reader is in `engine.rs`.

use std::collections::BTreeSet;

use avendb::doc::{Item, Version};
use avendb::id::{BlobId, SignerId};
use avendb::lens::{Lane, Lens, Schema, View, CEILING};
use avendb::ops::{diff, Change, Flat, Key, Path};
use avendb::rules::Touch;
use serde_json::{json, Value};

const MAC: SignerId = SignerId::from_u64(2);
const PHONE: SignerId = SignerId::from_u64(3);

/// An outline: nodes, each with a text and the nodes under it, at any depth.
pub const OUTLINE: &str = r##"{ "title": "Outline", "type": "object",
  "$defs": { "node": { "type": "object", "properties": {
      "id": { "type": "integer" },
      "text": { "type": "string", "x-loro": "text", "default": "" },
      "done": { "type": "boolean" },
      "kids": { "type": "array", "default": [], "items": { "$ref": "#/$defs/node" } } },
    "required": ["id"] } },
  "properties": {
    "kind": { "const": "outline" },
    "title": { "type": "string", "default": "" },
    "nodes": { "type": "array", "default": [], "items": { "$ref": "#/$defs/node" } } },
  "required": ["kind"] }"##;

fn outline() -> Schema {
    Schema::parse(OUTLINE.as_bytes()).expect("an outline schema")
}

/// A node as the outline app sees it: its kids' default filled in.
fn node(id: i64, text: &str, kids: Vec<Value>) -> Value {
    json!({ "id": id, "text": text, "kids": kids })
}

/// The garden: beds (1) with a north bed (11) of beans (111, runner 1111) and peas (112), and a south bed (12); and
/// tools (2).
fn garden() -> Value {
    let beans = node(111, "Beans", vec![node(1111, "Runner", vec![])]);
    let north = node(11, "North bed", vec![beans, node(112, "Peas", vec![])]);
    let beds = node(1, "Beds", vec![north, node(12, "South bed", vec![])]);
    json!({ "kind": "outline", "title": "Garden", "nodes": [beds, node(2, "Tools", vec![])] })
}

/// `r` with `change` made to it.
fn with(r: &Value, change: impl FnOnce(&mut Value)) -> Value {
    let mut r = r.clone();
    change(&mut r);
    r
}

fn kids(r: &mut Value) -> &mut Vec<Value> {
    r["kids"].as_array_mut().expect("a node's kids")
}

/// The item the Mac makes of `r`, and the same item on the phone.
fn two_devices(view: &View, r: &Value) -> (Item, Item) {
    let mac = Item::made(view, r, MAC).expect("the Mac writes it");
    let phone = mac.fork_as(PHONE);
    (mac, phone)
}

/// Each takes the other's edits since both held `at`, each signed by its own device: both hold the same.
fn exchange(at: &Version, mac: &mut Item, phone: &mut Item) {
    let (m, p) = (mac.export(at), phone.export(at));
    mac.import(&p, PHONE).expect("the phone's edits import");
    phone.import(&m, MAC).expect("the Mac's edits import");
    assert_eq!(mac.record(), phone.record(), "both hold the same");
}

fn ids(rows: &Value) -> Vec<i64> {
    rows.as_array().expect("rows").iter().map(|r| r["id"].as_i64().expect("an id")).collect()
}

#[test]
fn an_outline_reads_and_writes_rows_at_every_depth() {
    let view = View::plain(&outline());
    let mut item = Item::made(&view, &garden(), MAC).expect("an outline");
    assert_eq!(item.read(&view), Some(garden()));
    // what is stored holds no default: a node with no kids stores none
    assert!(item.record()["nodes"][1].get("kids").is_none(), "{}", item.record());
    // a field four rows down changed: only it is written, and its readers read the touch off its ops, by each row's id
    let (at, base, before) = (item.version(), item.fork_as(PHONE), item.record());
    let done = with(&garden(), |r| r["nodes"][0]["kids"][0]["kids"][0]["kids"][0]["done"] = json!(true));
    assert!(item.write(&view, &done));
    let rows = [("nodes", 1), ("kids", 11), ("kids", 111), ("kids", 1111)];
    let place = Path { rows: rows.map(|(f, id)| (f.to_string(), Key { id, copy: 0 })).to_vec(), field: "done".into() };
    let changes = diff(before.as_object().unwrap(), item.record().as_object().unwrap());
    assert_eq!(changes, [Change::Set(place, Some(json!(true)))]);
    let touched = base.clone().footprint(&item.export(&at), MAC, None).expect("it imports whole").touches;
    let path = json!(["nodes", { "id": 1 }, "kids", { "id": 11 }, "kids", { "id": 111 }, "kids", { "id": 1111 },
        "done"]);
    assert_eq!(touched.iter().map(Touch::to_json).collect::<Vec<_>>(), [json!({ "set": path, "to": true })]);
    let mut phone = Item::new(PHONE);
    phone.import(&item.export(&Version::default()), MAC).expect("it imports");
    assert_eq!(phone.read(&view), Some(done));
}

#[test]
fn two_devices_making_a_rows_first_list_at_once_share_it() {
    // the south bed has no kids stored: the Mac plants carrots under it, the phone onions, at once
    let view = View::plain(&outline());
    let (mut mac, mut phone) = two_devices(&view, &garden());
    let at = mac.version();
    assert!(mac.record()["nodes"][0]["kids"][1].get("kids").is_none());
    let plant = |id, text| with(&garden(), |r| kids(&mut r["nodes"][0]["kids"][1]).push(node(id, text, vec![])));
    assert!(mac.write(&view, &plant(121, "Carrots")));
    assert!(phone.write(&view, &plant(122, "Onions")));
    exchange(&at, &mut mac, &mut phone);
    let south = &mac.read(&view).expect("it reads")["nodes"][0]["kids"][1];
    let mut planted = ids(&south["kids"]);
    planted.sort();
    assert_eq!(planted, [121, 122], "{south}");
}

#[test]
fn two_devices_adding_one_nested_id_at_once_keep_both_apps_see_the_first() {
    let view = View::plain(&outline());
    let (mut mac, mut phone) = two_devices(&view, &garden());
    let at = mac.version();
    let add = |text: &str| with(&garden(), |r| kids(&mut r["nodes"][0]["kids"][0]).push(node(113, text, vec![])));
    assert!(mac.write(&view, &add("Leeks")));
    assert!(phone.write(&view, &add("Kale")));
    exchange(&at, &mut mac, &mut phone);
    // the item stores both rows, one a copy of the other's id; apps see the first, the same on both devices
    let stored = mac.record();
    let north = &stored["nodes"][0]["kids"][0]["kids"];
    assert_eq!(ids(north), [111, 112, 113, 113], "{north}");
    let rows = vec![("nodes".into(), Key { id: 1, copy: 0 }), ("kids".into(), Key { id: 11, copy: 0 })];
    let list = Path { rows, field: "kids".into() };
    let flat = Flat::of(stored.as_object().expect("a record"));
    assert!(flat.holds(&list, &Key { id: 113, copy: 1 }));
    let seen = mac.read(&view).expect("it reads");
    let first = north[2]["text"].clone();
    assert_eq!(ids(&seen["nodes"][0]["kids"][0]["kids"]), [111, 112, 113]);
    assert_eq!(seen["nodes"][0]["kids"][0]["kids"][2]["text"], first);
    assert_eq!(phone.read(&view), Some(seen.clone()));
    // an edit of the row apps see edits the first; its copy goes where it goes
    let moved = with(&seen, |r| {
        let north = kids(&mut r["nodes"][0]["kids"][0]);
        let leek = north.remove(2);
        north.insert(0, leek);
        north[0]["text"] = json!("Leeks and kale");
    });
    assert!(mac.write(&view, &moved));
    let north = mac.record()["nodes"][0]["kids"][0]["kids"].clone();
    assert_eq!(ids(&north), [113, 113, 111, 112], "{north}");
    assert_eq!(north[0]["text"], "Leeks and kale");
    assert_eq!(mac.read(&view), Some(moved));
    // readers judge it so: a write may keep or move the copy, never make one
    let lane = Lane::new([OUTLINE.as_bytes()]);
    let under = BTreeSet::from([outline().id()]);
    let (before, after) = (stored.clone(), mac.record());
    assert!(lane.fits(&under, &before, &after));
    let copy = with(&after, |r| kids(&mut r["nodes"][0]["kids"][0]).push(json!({ "id": 112 })));
    assert!(!lane.fits(&under, &after, &copy));
}

#[test]
fn a_text_edit_lands_in_its_deep_row_while_its_parents_move() {
    let view = View::plain(&outline());
    let (mut mac, mut phone) = two_devices(&view, &garden());
    let at = mac.version();
    // the Mac moves the north bed after the south bed, and the beds after the tools; the phone edits the runner beans
    let moved = with(&garden(), |r| {
        kids(&mut r["nodes"][0]).swap(0, 1);
        r["nodes"].as_array_mut().expect("nodes").swap(0, 1);
    });
    assert!(mac.write(&view, &moved));
    let runner = |r: &mut Value| r["nodes"][0]["kids"][0]["kids"][0]["kids"][0]["text"] = json!("Runner, scarlet");
    assert!(phone.write(&view, &with(&garden(), runner)));
    exchange(&at, &mut mac, &mut phone);
    let both = with(&moved, |r| r["nodes"][1]["kids"][1]["kids"][0]["kids"][0]["text"] = json!("Runner, scarlet"));
    assert_eq!(mac.read(&view), Some(both));
}

#[test]
fn concurrent_edits_of_one_deep_text_merge_character_by_character() {
    let view = View::plain(&outline());
    let (mut mac, mut phone) = two_devices(&view, &garden());
    let at = mac.version();
    let text = |t: &str| with(&garden(), |r| r["nodes"][0]["kids"][0]["kids"][1]["text"] = json!(t));
    assert!(mac.write(&view, &text("Sweet peas")));
    assert!(phone.write(&view, &text("Peas, early")));
    exchange(&at, &mut mac, &mut phone);
    let peas = mac.read(&view).expect("it reads")["nodes"][0]["kids"][0]["kids"][1]["text"].clone();
    assert_eq!(peas, "Sweet peas, early");
}

/// A plan v0: sections of tasks, each done or not. v1: each task has a status, open, doing or done.
const PLAN_V0: &str = r#"{ "title": "Plan, v0", "type": "object", "properties": {
  "kind": { "const": "plan" },
  "sections": { "type": "array", "default": [], "items": { "type": "object", "properties": {
    "id": { "type": "integer" },
    "name": { "type": "string", "default": "" },
    "tasks": { "type": "array", "default": [], "items": { "type": "object", "properties": {
      "id": { "type": "integer" }, "what": { "type": "string" }, "done": { "type": "boolean", "default": false } },
      "required": ["id"] } } },
    "required": ["id"] } } },
  "required": ["kind"] }"#;

const PLAN_V1: &str = r#"{ "title": "Plan, v1", "type": "object", "properties": {
  "kind": { "const": "plan" },
  "sections": { "type": "array", "default": [], "items": { "type": "object", "properties": {
    "id": { "type": "integer" },
    "name": { "type": "string", "default": "" },
    "tasks": { "type": "array", "default": [], "items": { "type": "object", "properties": {
      "id": { "type": "integer" }, "what": { "type": "string" },
      "status": { "enum": ["open", "doing", "done"], "default": "open" } },
      "required": ["id"] } } },
    "required": ["id"] } } },
  "required": ["kind"] }"#;

/// The lens from v0 to v1: in each section, in each task, `done` becomes `status`.
fn plan_lens() -> Lens {
    let (v0, v1) = (BlobId::of(PLAN_V0.as_bytes()), BlobId::of(PLAN_V1.as_bytes()));
    let lens = json!({ "lens": "Plan, v0 to v1", "from": v0.to_hex(), "to": v1.to_hex(), "steps": [
        { "in": { "field": "sections", "steps": [
            { "in": { "field": "tasks", "steps": [
                { "convert": { "from": ["done"], "to": ["status"],
                    "forward": [[{ "done": true }, { "status": "done" }], [{ "done": false }, { "status": "open" }]],
                    "backward": [[{ "status": "done" }, { "done": true }], [{}, { "done": false }]] } }
            ] } }
        ] } }
    ] });
    Lens::parse(lens.to_string().as_bytes()).expect("a lens")
}

#[test]
fn a_lens_reads_rows_of_rows_through_in_inside_in() {
    let (v0, v1) = (Schema::parse(PLAN_V0.as_bytes()).unwrap(), Schema::parse(PLAN_V1.as_bytes()).unwrap());
    let lens = plan_lens();
    let old = View::through(&v0, &lens, &v1).expect("the lens joins them");
    let new = View::through(&v1, &lens, &v0).expect("the lens joins them");
    let task = |id: i64, what: &str, done: bool| json!({ "id": id, "what": what, "done": done });
    let written = json!({ "kind": "plan", "sections": [
        { "id": 1, "name": "Spring", "tasks": [task(11, "Sow", true), task(12, "Water", false)] },
        { "id": 2, "name": "Summer", "tasks": [] }] });
    let mut item = Item::made(&old, &written, MAC).expect("a v0 app writes it");
    // a v1 app reads each task's status, two lists down
    let seen = item.read(&new).expect("v1 reads it");
    assert_eq!(seen["sections"][0]["tasks"][0]["status"], "done");
    assert_eq!(seen["sections"][0]["tasks"][1]["status"], "open");
    // it starts the watering: the task now holds its status in v1's field, and nothing else changes
    let doing = with(&seen, |r| r["sections"][0]["tasks"][1]["status"] = json!("doing"));
    assert!(item.write(&new, &doing));
    let stored = item.record();
    assert_eq!(stored["sections"][0]["tasks"][1], json!({ "id": 12, "what": "Water", "status": "doing" }));
    assert_eq!(stored["sections"][0]["tasks"][0], task(11, "Sow", true));
    assert_eq!(item.read(&new), Some(doing));
    // a v0 app reads the task as not done, and the other as it wrote it
    let back = item.read(&old).expect("v0 reads it");
    assert_eq!(back["sections"][0]["tasks"], json!([task(11, "Sow", true), task(12, "Water", false)]));
    // and its edit through the lens lands where the item holds it
    let finished = with(&back, |r| r["sections"][0]["tasks"][1]["done"] = json!(true));
    assert!(item.write(&old, &finished));
    assert_eq!(item.record()["sections"][0]["tasks"][1], json!({ "id": 12, "what": "Water", "status": "done" }));
    assert_eq!(item.read(&old), Some(finished));
}

/// An outline `depth` nodes deep, one node under the other: `depth` 0 holds none.
pub fn chain(depth: usize) -> Value {
    let mut nodes = json!([]);
    for i in (0..depth).rev() {
        nodes = json!([{ "id": i as i64 + 1, "kids": nodes }]);
    }
    json!({ "kind": "outline", "nodes": nodes })
}

#[test]
fn no_write_reaches_deeper_than_the_ceiling() {
    let lane = Lane::new([OUTLINE.as_bytes()]);
    let under = BTreeSet::from([outline().id()]);
    let nothing = json!({});
    // rows `CEILING` deep fit, from nothing and one more row at a time; a row deeper doesn't, whatever the schema says
    let deepest = chain(CEILING);
    assert!(lane.fits(&under, &nothing, &deepest));
    assert!(lane.fits(&under, &chain(CEILING - 1), &deepest));
    assert!(!lane.fits(&under, &deepest, &chain(CEILING + 1)));
    assert!(!lane.fits(&under, &nothing, &chain(300)));
    // the record, flat, is as deep as its deepest row, and the app reads it whole
    assert_eq!(Flat::of(deepest.as_object().unwrap()).depth(), CEILING);
    let view = View::plain(&outline());
    assert!(view.get(&chain(300)).is_some());
    // a value of the deepest row may change, as its schema lets it
    let deepest_value = |r: &mut Value, v: Value| {
        let mut x = &mut r["nodes"][0];
        for _ in 1..CEILING {
            x = &mut x["kids"][0];
        }
        x["done"] = v;
    };
    assert!(lane.fits(&under, &deepest, &with(&deepest, |r| deepest_value(r, json!(true)))));
    assert!(!lane.fits(&under, &deepest, &with(&deepest, |r| deepest_value(r, json!("yes")))));
}
