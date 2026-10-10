//! What a write touches (`avendb::rules`, `doc::Item::footprint`), as every reader of its entry reads it off the
//! write's Loro ops on the version it builds on, and judges it by (`spec/AvenDB/Rules.lean`, `docs/OPS.md`): the
//! touches of what apps change name the field, the row by its id and the value set, on the record as it is stored. On
//! random records, written one after another by two devices, wholesale or by random ops, the places of a write's
//! touches cover every change it makes to the stored record (`Within`, which C3's `changes_allowed` takes of this
//! side), and where only touches naming values cover a change, the place one of them names holds that value after: so
//! rules that allow some values only allow no write that leaves another there. Ruled caps on the Lab, through the ops
//! engine, are in `engine.rs`.

mod records;

use avendb::cast;
use avendb::doc::Item;
use avendb::id::SignerId;
use avendb::lens::{Status, TodoV2, View};
use avendb::ops::{diff, run_all, Loc, Op, Record};
use avendb::rules::{Scalar, Touch};
use records::{random_op, random_record, Rng};
use serde_json::{json, Value};

const ALICE: SignerId = SignerId::from_u64(2);
const BOB: SignerId = SignerId::from_u64(5);

/// What Bob's write that changes the app's view of `item` by `change` touches, read off its ops on `item`.
fn touches(item: &Item, view: &View, change: impl FnOnce(&mut Value)) -> Vec<Value> {
    let mut seen = item.read(view).expect("the app reads the item");
    change(&mut seen);
    let mut bobs = item.fork_as(BOB);
    let since = bobs.version();
    assert!(bobs.write(view, &seen), "a view of the app's schema: {seen}");
    let touched = item.clone().footprint(&bobs.export(&since), BOB, None).expect("it imports whole").touches;
    touched.iter().map(Touch::to_json).collect()
}

fn blocks(doc: &mut Value) -> &mut Vec<Value> {
    doc["blocks"].as_array_mut().expect("a document's blocks")
}

#[test]
fn touches_name_the_field_the_row_and_the_value() {
    let due = Some("2026-10-12".to_string());
    let todo = TodoV2 { title: "Fix the door".into(), status: Status::Open, notes: String::new(), due };
    let todo = Item::made(View::todo_v2(), &todo.to_value(), ALICE).expect("a todo");
    let view = View::todo_v2();
    assert_eq!(touches(&todo, view, |t| t["status"] = json!("done")), [json!({ "set": ["status"], "to": "done" })]);
    assert_eq!(touches(&todo, view, |t| t["title"] = json!("Fixed")), [json!({ "set": ["title"], "to": "Fixed" })]);
    // a place emptied is set to null; a text's edits name no value
    let undated = |t: &mut Value| {
        t.as_object_mut().expect("a record").remove("due");
    };
    assert_eq!(touches(&todo, view, undated), [json!({ "set": ["due"], "to": null })]);
    assert_eq!(touches(&todo, view, |t| t["notes"] = json!("Bring a screwdriver")), [json!({ "set": ["notes"] })]);
    // nothing changed touches nothing
    assert_eq!(touches(&todo, view, |_| {}), Vec::<Value>::new());
    // a document's blocks: a field of a row by the row's id, a text naming no value and a checkbox its value
    let doc = cast::document("Plan", "The greenhouse plan for spring.", ALICE);
    let view = View::document_v2();
    let text = json!({ "set": ["blocks", { "id": 2 }, "text"] });
    assert_eq!(touches(&doc, view, |d| d["blocks"][1]["text"] = json!("Sow beans")), [text]);
    let checked = json!({ "set": ["blocks", { "id": 2 }, "checked"], "to": true });
    assert_eq!(touches(&doc, view, |d| d["blocks"][1]["checked"] = json!(true)), [checked]);
    // rows added with whatever they hold, deleted and moved
    let row = json!({ "id": 3, "type": "item", "checked": false, "text": "Water the beds" });
    assert_eq!(touches(&doc, view, |d| blocks(d).push(row)), [json!({ "insert": "blocks" })]);
    let first = |d: &mut Value| {
        blocks(d).remove(0);
    };
    assert_eq!(touches(&doc, view, first), [json!({ "remove": "blocks" })]);
    assert_eq!(touches(&doc, view, |d| blocks(d).swap(0, 1)), [json!({ "move": "blocks" })]);
    // a list of values, made or changed, as a whole
    assert_eq!(touches(&doc, view, |d| d["tags"] = json!(["spring"])), [json!({ "set": ["tags"] })]);
    // several changes, each once
    let both = |d: &mut Value| {
        d["title"] = json!("Spring plan");
        d["blocks"][0]["text"] = json!("Spring plan");
        d["blocks"][0]["level"] = json!(2);
    };
    let both = touches(&doc, view, both);
    let want = [
        json!({ "set": ["blocks", { "id": 1 }, "text"] }),
        json!({ "set": ["blocks", { "id": 1 }, "level"], "to": 2 }),
        json!({ "set": ["title"], "to": "Spring plan" }),
    ];
    assert!(both.len() == want.len() && want.iter().all(|t| both.contains(t)), "{both:?}");
    // a v2 app's edit of a block a v1 app wrote touches what the item stores: the block's v1 kind goes, its v2 type
    // comes
    let welcome = cast::document_v1("Welcome", cast::WELCOME_TEXT, ALICE);
    let paragraph = |d: &mut Value| {
        d["blocks"][0]["type"] = json!("paragraph");
        d["blocks"][0].as_object_mut().expect("a block").remove("level");
    };
    let want = [
        json!({ "set": ["blocks", { "id": 1 }, "kind"], "to": null }),
        json!({ "set": ["blocks", { "id": 1 }, "type"], "to": "paragraph" }),
    ];
    assert_eq!(touches(&welcome, view, paragraph), want);
}

/// The record as an item stores it: no field, and no field of a row, holds `null`, which storing leaves out.
fn stored(mut r: Record) -> Record {
    r.retain(|_, v| !v.is_null());
    for rows in r.values_mut().filter_map(Value::as_array_mut) {
        for row in rows.iter_mut().filter_map(Value::as_object_mut) {
            row.retain(|_, v| !v.is_null());
        }
    }
    r
}

/// Record `r` holds plain value `v` at place `l` (`null`: nothing there), in some row of the place's id.
fn holds(r: &Record, l: &Loc, v: &Scalar) -> bool {
    let plain = |x: Option<&Value>| Scalar::of_json(x.unwrap_or(&Value::Null)).as_ref() == Some(v);
    match l {
        Loc::Field(f) => plain(r.get(f)),
        Loc::Cell(f, i, g) => {
            let rows = r.get(f).and_then(Value::as_array).into_iter().flatten();
            rows.filter(|x| x["id"].as_i64() == Some(*i)).any(|x| plain(x.get(g)))
        }
        Loc::Root | Loc::Row(..) => false,
    }
}

/// C3, the changes: four records in a row, each the last changed wholesale or by random ops, written by Alice's and
/// Bob's devices in turn, each by the smallest change, as a device stores an edit. Each write's touches, read off its
/// ops on the item that holds every write before it, cover every change it makes, and name the value of each place
/// they alone cover; and every op is placed.
#[test]
fn c3_touches_cover_every_change() {
    let mut rng = Rng(0x0c03_0c03);
    let (mut writes, mut valued) = (0, 0);
    for _ in 0..1000 {
        let mut item = Item::new(ALICE);
        let mut before = Record::new();
        for step in 0..4 {
            let after = match rng.below(3) {
                0 => random_record(&mut rng),
                _ => {
                    let ops = (0..1 + rng.below(3)).map(|_| Op::of_json(&random_op(&mut rng, &before)));
                    let Ok(ops) = ops.collect::<Result<Vec<_>, _>>() else { continue };
                    let Some(after) = run_all(&before, &ops) else { continue };
                    after
                }
            };
            let after = stored(after);
            let signer = [ALICE, BOB][step % 2];
            let mut device = item.fork_as(signer);
            let since = device.version();
            device.put_record(&Value::Object(after.clone()));
            let touched = item.footprint(&device.export(&since), signer, None).expect("it imports whole").touches;
            assert_eq!(item.record(), Value::Object(after.clone()));
            let why = |c: &str| format!("{before:?} to {after:?}: {c} in {touched:?}");
            assert!(touched.iter().all(|t| t.loc() != Some(Loc::Root)), "{}", why("an op placed nowhere"));
            for c in diff(&before, &after) {
                let covering: Vec<&Touch> = touched.iter().filter(|t| t.loc().is_some_and(|l| l.covers(&c))).collect();
                assert!(!covering.is_empty(), "{}", why(&c.to_json().to_string()));
                let named: Vec<(&Loc, &Scalar)> = covering
                    .iter()
                    .filter_map(|t| match t {
                        Touch::Set(l, Some(v)) => Some((l, v)),
                        _ => None,
                    })
                    .collect();
                if named.len() == covering.len() {
                    valued += 1;
                    assert!(named.iter().any(|(l, v)| holds(&after, l, v)), "{}", why(&c.to_json().to_string()));
                }
            }
            writes += 1;
            before = after;
        }
    }
    assert!(writes > 2000 && valued > 2000, "{writes} writes, {valued} changes covered by values alone");
}
