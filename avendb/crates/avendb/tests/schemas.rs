//! Writes that fit their schemas (`lens::Lane::fits`, `spec/AvenDB/Schemas.lean`, `docs/OPS.md`): every reader judges
//! each write by the schemas its entry was written under once it is in, which must be in the vault's lane or built in
//! and all of one kind, and by what it changed. On random walks of writes over two versions of a schema, a record
//! that fits keeps fitting through every write that fits, from nothing on (S2), and what a write didn't change, a row
//! or a value no schema requires, never changes its verdict, whatever it holds (S1). That every edit an app makes fits
//! is in `properties.rs`; readers that count only writes that fit, and devices that refuse to make one that doesn't
//! (S3), in `engine.rs`.

use std::collections::BTreeSet;

use avendb::id::BlobId;
use avendb::lens::{Lane, DOCUMENT_V2, TODO_V1, TODO_V2};
use avendb::ops;
use serde_json::{json, Value};

/// Two versions of a record's schema: A requires a title and takes a number, tags, and blocks that each have a type;
/// B takes a boolean for the number, no tags, and blocks that each have a text.
const A: &str = r#"{ "title": "Random, A", "type": "object", "properties": {
  "title": { "type": "string", "x-loro": "text" },
  "n": { "type": "integer", "minimum": -2 },
  "tags": { "type": "array", "items": { "type": "string" } },
  "blocks": { "type": "array", "items": { "type": "object", "properties": {
    "id": { "type": "integer" }, "text": { "type": "string" }, "type": { "enum": ["a", "B"] },
    "level": { "type": "integer", "minimum": 0 } }, "required": ["id", "type"] } } },
  "required": ["title"] }"#;

const B: &str = r#"{ "title": "Random, B", "type": "object", "properties": {
  "title": { "type": "string", "default": "" },
  "n": { "type": "boolean" },
  "blocks": { "type": "array", "items": { "type": "object", "properties": {
    "id": { "type": "integer" }, "text": { "type": "string" } }, "required": ["id", "text"] } } } }"#;

/// xorshift64*, as in `records`.
struct Rng(u64);

impl Rng {
    fn below(&mut self, n: usize) -> usize {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        (self.0.wrapping_mul(0x2545_f491_4f6c_dd1d) % n as u64) as usize
    }

    fn pick<T: Clone>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len())].clone()
    }
}

const FIELDS: [&str; 4] = ["title", "n", "tags", "blocks"];

/// A value of field `g` of a row, most of which one of the schemas takes.
fn cell(rng: &mut Rng, g: &str) -> Value {
    match g {
        "text" => rng.pick(&[json!("a"), json!(""), json!(1)]),
        "type" => rng.pick(&[json!("a"), json!("B"), json!("c")]),
        _ => rng.pick(&[json!(0), json!(2), json!(-1)]),
    }
}

/// A row with id `id`, each field there or not.
fn row(rng: &mut Rng, id: i64) -> Value {
    let mut r = json!({ "id": id });
    for g in ["text", "type", "level"] {
        if rng.below(3) != 0 {
            r[g] = cell(rng, g);
        }
    }
    r
}

/// A value of field `f`, most of which one of the schemas takes; blocks may hold two rows with one id.
fn value(rng: &mut Rng, f: &str) -> Value {
    match f {
        "title" => rng.pick(&[json!("a"), json!("B"), json!(""), json!(1.5), json!(true)]),
        "n" => rng.pick(&[json!(1), json!(-2), json!(-3), json!(true), json!("a")]),
        "tags" => rng.pick(&[json!([]), json!(["a"]), json!(["a", "B"]), json!([1]), json!([{ "id": 1 }])]),
        _ => (0..rng.below(4))
            .map(|_| {
                let id = rng.below(3) as i64 + 1;
                row(rng, id)
            })
            .collect(),
    }
}

fn blocks(o: &mut ops::Record) -> &mut Vec<Value> {
    o.get_mut("blocks").and_then(Value::as_array_mut).expect("blocks")
}

/// A random write on `r`: a field set or dropped, or a row of its blocks added, under an id the list may hold already,
/// dropped, moved, or one of its fields set or dropped.
fn write(rng: &mut Rng, r: &Value) -> Value {
    let mut s = r.clone();
    let o = s.as_object_mut().expect("a record");
    let f = rng.pick(&FIELDS);
    let n = o.get("blocks").and_then(Value::as_array).map(Vec::len);
    match (rng.below(7), n.unwrap_or(0)) {
        (0 | 1, _) => drop(o.insert(f.into(), value(rng, f))),
        (2, _) => drop(o.remove(f)),
        (3, n) => {
            let id = rng.below(4) as i64 + 1;
            let new = row(rng, id);
            match o.get_mut("blocks").and_then(Value::as_array_mut) {
                Some(rows) => rows.insert(rng.below(n + 1), new),
                None => drop(o.insert("blocks".into(), json!([new]))),
            }
        }
        (4, n) if n > 0 => drop(blocks(o).remove(rng.below(n))),
        (5, n) if n > 1 => blocks(o).swap(rng.below(n), rng.below(n)),
        (6, n) if n > 0 => {
            let (i, g) = (rng.below(n), rng.pick(&["text", "type", "level"]));
            let v = cell(rng, g);
            let r = blocks(o)[i].as_object_mut().expect("a row");
            match rng.below(3) {
                0 => drop(r.remove(g)),
                _ => drop(r.insert(g.into(), v)),
            }
        }
        _ => {}
    }
    s
}

fn ids(blobs: &[&str]) -> BTreeSet<BlobId> {
    blobs.iter().map(|b| BlobId::of(b.as_bytes())).collect()
}

/// `r` with `change` made to it.
fn with(r: &Value, change: impl FnOnce(&mut Value)) -> Value {
    let mut s = r.clone();
    change(&mut s);
    s
}

#[test]
fn s2_a_record_that_fits_keeps_fitting() {
    // random walks of writes from nothing, under A, B or both, each taking the writes that fit: every record they
    // reach fits as a whole, as a first write that made it would (S2); and what a write didn't change, a row no schema
    // reads or a number none takes, which a write elsewhere at once may leave, never changes its verdict (S1)
    let lane = Lane::new([A.as_bytes(), B.as_bytes()]);
    let (nothing, junk) = (json!({}), json!({ "id": 9, "type": 1.5, "level": "x" }));
    let (mut fit, mut unfit, mut beside) = (0, 0, 0);
    for seed in 0..300u64 {
        let mut rng = Rng(0x5200_0000 + seed);
        let under = [ids(&[A]), ids(&[B]), ids(&[A, B])][seed as usize % 3].clone();
        let mut r = nothing.clone();
        for _ in 0..40 {
            let s = write(&mut rng, &r);
            let fits = lane.fits(&under, &r, &s);
            let rows = |x: &Value| x.get("blocks").and_then(ops::rows).is_some();
            if rows(&r) && rows(&s) {
                let leave = |x: &Value| with(x, |x| x["blocks"].as_array_mut().expect("rows").push(junk.clone()));
                assert_eq!(lane.fits(&under, &leave(&r), &leave(&s)), fits, "seed {seed}: {r} to {s}");
                beside += 1;
            }
            if r.get("n") == s.get("n") {
                let leave = |x: &Value| with(x, |x| x["n"] = json!("x"));
                assert_eq!(lane.fits(&under, &leave(&r), &leave(&s)), fits, "seed {seed}: {r} to {s}");
            }
            if !fits {
                unfit += 1;
                continue;
            }
            assert!(lane.fits(&under, &nothing, &s), "seed {seed}: {r} to {s}");
            (fit, r) = (fit + 1, s);
        }
    }
    assert!(fit > 2000 && unfit > 2000 && beside > 2000, "{fit} writes fit, {unfit} don't, {beside} beside a row");
}

#[test]
fn s1_a_write_is_judged_by_what_it_changed() {
    let lane = Lane::new([A.as_bytes()]);
    let under = ids(&[A]);
    // what two writes at once may leave: a number no schema takes, and a row with no type
    let r = json!({ "title": "a", "n": 1.5, "blocks": [{ "id": 1, "type": "a" }, { "id": 2, "text": "x" }] });
    let fits = |change: &dyn Fn(&mut Value)| lane.fits(&under, &r, &with(&r, change));
    // what it changed fits, and what it didn't change elsewhere holds it back nowhere
    assert!(fits(&|s| s["title"] = json!("B")));
    assert!(fits(&|s| s["blocks"][0]["text"] = json!("y")));
    assert!(fits(&|s| s["n"] = json!(2)));
    assert!(fits(&|_| {}));
    // the row that doesn't read may go, or be given what makes it read, but not changed into another that doesn't
    assert!(fits(&|s| drop(s["blocks"].as_array_mut().expect("rows").remove(1))));
    assert!(fits(&|s| s["blocks"][1]["type"] = json!("B")));
    assert!(!fits(&|s| s["blocks"][1]["text"] = json!("y")));
    // a value its schema doesn't take, a field it doesn't name, a field it requires dropped
    assert!(!fits(&|s| s["n"] = json!("2")));
    assert!(!fits(&|s| s["colour"] = json!("red")));
    assert!(!fits(&|s| drop(s.as_object_mut().expect("a record").remove("title"))));
    // a new row reads, and holds values its schema takes
    let push = |b: Value| move |s: &mut Value| s["blocks"].as_array_mut().expect("rows").push(b.clone());
    assert!(fits(&push(json!({ "id": 3, "type": "B", "level": 0 }))));
    assert!(!fits(&push(json!({ "id": 3, "text": "z" }))));
    assert!(!fits(&push(json!({ "id": 3, "type": "B", "level": -1 }))));
    // a list of records holds rows, never one value
    assert!(!fits(&|s| s["blocks"] = json!("none")));
    assert!(!fits(&|s| s["blocks"] = json!([{ "type": "a" }])));
}

#[test]
fn a_write_makes_no_copy_of_a_row() {
    // two devices adding a row with one id at once make a copy of it, which a write may keep or move, never make
    let lane = Lane::new([A.as_bytes()]);
    let under = ids(&[A]);
    let rows = |ids: &[(i64, &str)]| {
        let rows: Vec<Value> = ids.iter().map(|(id, t)| json!({ "id": id, "type": t })).collect();
        json!({ "title": "a", "blocks": rows })
    };
    let r = rows(&[(1, "a"), (2, "a"), (1, "B")]);
    assert!(lane.fits(&under, &r, &rows(&[(1, "a"), (1, "B")])));
    assert!(lane.fits(&under, &r, &rows(&[(2, "a"), (1, "a"), (1, "B")])));
    assert!(!lane.fits(&under, &r, &rows(&[(1, "a"), (2, "a"), (1, "B"), (1, "a")])));
    assert!(!lane.fits(&under, &json!({}), &r));
}

#[test]
fn the_schemas_are_in_the_lane_and_of_one_kind() {
    let lane = Lane::with_built_ins([]);
    let (todo, gate) = (json!({ "kind": "todo", "title": "Fix the door" }), json!({ "kind": "todo", "title": "Gate" }));
    let under = |ids: &[BlobId]| ids.iter().copied().collect::<BTreeSet<_>>();
    assert!(lane.fits(&under(&[TODO_V2.id()]), &todo, &gate));
    assert!(lane.fits(&under(&[TODO_V1.id(), TODO_V2.id()]), &todo, &gate));
    // a document's schema beside a todo's: another kind, though it takes a title too
    assert!(!lane.fits(&under(&[TODO_V2.id(), DOCUMENT_V2.id()]), &todo, &gate));
    // a schema the lane doesn't hold, or none at all, lets nothing change
    let a = BlobId::of(A.as_bytes());
    assert!(!lane.fits(&under(&[TODO_V2.id(), a]), &todo, &gate));
    assert!(!lane.fits(&under(&[]), &todo, &gate));
    assert!(lane.fits(&under(&[]), &todo, &todo));
    // once the lane holds it
    let r = json!({ "title": "a" });
    assert!(!lane.fits(&under(&[a]), &r, &json!({ "title": "B" })));
    assert!(Lane::with_built_ins([A.as_bytes()]).fits(&under(&[a]), &r, &json!({ "title": "B" })));
}
