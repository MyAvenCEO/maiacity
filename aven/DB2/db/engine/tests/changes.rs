//! `Engine.Examples`' checks of the change view and the verdict's footprint part, as Lean's `#guard`s state them, until
//! `changes.json` and `merge-check.json` export them.

use aven_core::{DocId, Value, blake3};
use aven_db_engine::{
    ChangeKind, NewId, Op, Record, Version, changes_from, commit, footprint, verdict_footprint,
};

fn doc(label: &str) -> DocId {
    DocId(blake3(format!("doc:{label}").as_bytes()))
}

fn ver(t: &DocId) -> Version {
    Version {
        r#type: *t,
        schema: Some(blake3(b"schema:v1")),
    }
}

fn rows(fs: &[(&str, Value)]) -> Vec<(String, Value)> {
    fs.iter().map(|(c, v)| (c.to_string(), v.clone())).collect()
}

fn text(s: &str) -> Value {
    Value::Text(s.into())
}

fn task(id: NewId, title: &str, done: u64) -> Record {
    Record {
        id,
        r#type: doc("type:task"),
        fields: rows(&[("x2", text(title)), ("done", Value::Uint(done))]),
    }
}

fn id(writer: u64, counter: u64, index: u64) -> NewId {
    NewId {
        writer,
        counter,
        index,
    }
}

/// Ticking a task done is one edited Record whose one field is `done`, and the untouched task is no change; it passes
/// the verdict's footprint part.
#[test]
fn a_tick_is_one_edit() {
    let todo = [
        task(id(1, 1, 0), "Order seeds", 0),
        task(id(2, 4, 0), "Water the beans", 0),
    ];
    let tick = [Op::Patch {
        r#type: doc("type:task"),
        r#where: rows(&[("x2", text("Order seeds"))]),
        set: rows(&[("done", Value::Uint(1))]),
    }];
    let after = commit(1, 8, &todo, &tick).unwrap();
    let cs = changes_from(&ver, &todo, &after);
    let seen: Vec<(ChangeKind, Vec<&str>)> =
        cs.iter().map(|c| (c.kind, c.names().collect())).collect();
    assert_eq!(seen, [(ChangeKind::Edited, vec!["done"])]);
    assert!(verdict_footprint(&ver, &footprint(&tick), &todo, &after));
}

/// A merge into main is judged on the whole merge: the settling tick's own changes pass, the whole merge, which also
/// renames the task on main, doesn't.
#[test]
fn a_merge_is_judged_whole() {
    let main_before = [task(id(1, 1, 0), "Order seeds", 0)];
    let proposal = [task(id(1, 1, 0), "Order bean seeds", 0)];
    let merged = [Record {
        id: id(1, 1, 0),
        r#type: doc("type:task"),
        fields: rows(&[("done", Value::Uint(1)), ("x2", text("Order bean seeds"))]),
    }];
    let settle = [Op::Patch {
        r#type: doc("type:task"),
        r#where: vec![],
        set: rows(&[("done", Value::Uint(1))]),
    }];
    assert!(verdict_footprint(
        &ver,
        &footprint(&settle),
        &proposal,
        &merged
    ));
    assert!(!verdict_footprint(
        &ver,
        &footprint(&settle),
        &main_before,
        &merged
    ));
}

/// A Record's type is fixed at birth: a task turned into a note, its id and fields kept, shows no change, and the verdict
/// refuses it whatever the footprint (`typesKept`).
#[test]
fn a_retype_is_refused() {
    let todo = [
        task(id(1, 1, 0), "Order seeds", 0),
        task(id(2, 4, 0), "Water the beans", 0),
    ];
    let mut retyped = todo.clone();
    retyped[0].r#type = doc("type:note");
    assert!(changes_from(&ver, &todo, &retyped).is_empty());
    assert!(!verdict_footprint(&ver, &[], &todo, &retyped));
    let tick = [Op::Patch {
        r#type: doc("type:task"),
        r#where: vec![],
        set: rows(&[("done", Value::Uint(1))]),
    }];
    assert!(!verdict_footprint(&ver, &footprint(&tick), &todo, &retyped));
}
