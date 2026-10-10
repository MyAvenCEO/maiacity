//! The ops engine on the Lab (`avendb::engine`, `docs/OPS.md`): queries that pick entries by the selector of their
//! labels and test what they open; record ops through an app's schema and its lens, which write only what changed;
//! every write's changes in its entry's history, the same for every reader; batches, proposals, merges, restores,
//! undos and variants as ops; and the rules judging each op's write as any peer's, by the caps of the vault it acts
//! for. Alice's library (`cast::library`) and the coop's handbook (`cast::handbook`, Welcome written by a v1 app) are
//! the data; the ops are JSON, as the page and the Mac app send them.

use avendb::cast::{self, World};
use avendb::engine;
use avendb::id::{EntryId, SignerId};
use avendb::lens::{Status, TypeV2};
use serde_json::{json, Value};

fn run(w: &mut World, d: SignerId, op: Value) -> Value {
    engine::run(&mut w.lab, d, &op)
}

/// What an op answered, which it must have done.
fn ok(answer: Value) -> Value {
    assert!(answer.get("ok").is_some(), "refused: {answer}");
    answer["ok"].clone()
}

/// Why an op was refused, which it must have been.
fn refused(answer: &Value) -> &str {
    answer["refused"].as_str().unwrap_or_else(|| panic!("not refused: {answer}"))
}

fn hex(e: EntryId) -> String {
    e.to_hex()
}

fn list(v: &Value) -> &[Value] {
    v.as_array().unwrap_or_else(|| panic!("a list, not {v}"))
}

/// The text at `at` in each of `xs`.
fn each(xs: &Value, at: impl Fn(&Value) -> &Value) -> Vec<String> {
    list(xs).iter().map(|x| at(x).as_str().unwrap_or_else(|| panic!("a text in {x}")).to_string()).collect()
}

/// The entries of a query's rows.
fn entries(rows: &Value) -> Vec<String> {
    each(&rows["rows"], |r| &r["entry"])
}

#[test]
fn a_query_picks_by_labels_then_tests_what_it_opens() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    // labels alone: the plan is the selector a cap would hold, and nothing else is opened
    let work = json!({ "op": "query", "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] } });
    let work = ok(run(&mut w, mac, work));
    assert_eq!(entries(&work), [hex(l.door), hex(l.solar)]);
    assert_eq!(work["plan"], json!([[{ "type": ["todo"] }, { "tag": "work" }]]));
    // values, through the todo's schema: every todo is open, its default, though none wrote it
    let open = json!({ "path": ["status"], "eq": "open" });
    let open = json!({ "op": "query", "vault": alice, "where": open, "schema": "todo" });
    let open = ok(run(&mut w, mac, open));
    assert_eq!(entries(&open), [hex(l.door), hex(l.seeds), hex(l.solar)]);
    assert_eq!(open["plan"], json!("all"));
    // a note isn't one of the todo schema, so no row; through its own schema each entry shows its kind's record
    let all = ok(run(&mut w, mac, json!({ "op": "query", "vault": alice })));
    assert_eq!(all["count"], 5);
    assert_eq!(each(&all["rows"], |r| &r["record"]["kind"]), ["todo", "todo", "todo", "document", "document"]);
    // a text test reads ASCII letters in either case, any row of a list of records, and labels mix with values
    let seed = json!({ "op": "query", "where": { "path": ["blocks", "*", "text"], "contains": "SEEDLINGS" } });
    assert_eq!(entries(&ok(run(&mut w, mac, seed))), [hex(l.diary)]);
    let either = json!({ "any": [{ "tag": "home" }, { "path": ["title"], "eq": "Plan" }] });
    assert_eq!(entries(&ok(run(&mut w, mac, json!({ "op": "query", "where": either })))), [hex(l.seeds), hex(l.plan)]);
    // ordered, a page at a time, with only the fields it selects
    let page = json!({
        "op": "query", "where": { "type": ["todo"] }, "order": [[["title"], "asc"]], "limit": 2, "offset": 1,
        "select": ["title"],
    });
    let page = ok(run(&mut w, mac, page));
    assert_eq!((page["count"].clone(), entries(&page)), (json!(3), vec![hex(l.door), hex(l.seeds)]));
    assert_eq!(page["rows"][0]["record"], json!({ "title": "Fix the greenhouse door" }));
    let order = json!([["created", "desc"], ["entry", "asc"]]);
    let latest = json!({ "op": "query", "where": { "type": ["note"] }, "order": order });
    assert_eq!(ok(run(&mut w, mac, latest))["count"], 2);
    // Bob's Mac holds none of Alice's entries: no cap gives his vault any
    let mac_b = w.mac_b;
    w.lab.sync_all(0);
    assert_eq!(ok(run(&mut w, mac_b, json!({ "op": "query", "vault": alice })))["count"], 0);
}

#[test]
fn record_ops_write_only_what_changed_through_the_schema() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let mac = w.mac_a;
    let set = |e: EntryId, path: Value, value: Value| {
        json!({ "op": "set", "entry": hex(e), "path": path, "value": value })
    };
    let done = ok(run(&mut w, mac, set(l.door, json!(["status"]), json!("done"))));
    assert!(done["edit"].is_string());
    assert_eq!(cast::status(&w.lab, mac, l.door), Some(Status::Done));
    // the same value again changes nothing, and writes nothing
    assert_eq!(ok(run(&mut w, mac, set(l.door, json!(["status"]), json!("done"))))["edit"], Value::Null);
    // a value the schema doesn't take, or no such row, is refused before anything is written
    assert_eq!(refused(&run(&mut w, mac, set(l.door, json!(["status"]), json!("later")))), "NotAView");
    assert_eq!(refused(&run(&mut w, mac, set(l.plan, json!(["blocks", { "id": 9 }, "text"]), json!("x")))), "BadOp");
    // rows of a list of records: a new block takes its schema's defaults, then moves first, then goes
    let block = json!({ "id": 3, "type": "paragraph" });
    let insert = json!({ "op": "insert", "entry": hex(l.plan), "path": ["blocks"], "value": block });
    ok(run(&mut w, mac, insert));
    assert_eq!(cast::text(&w.lab, mac, l.plan, 3), Some(String::new()));
    ok(run(&mut w, mac, set(l.plan, json!(["blocks", { "id": 3 }, "text"]), json!("Sow beans"))));
    ok(run(&mut w, mac, json!({ "op": "move", "entry": hex(l.plan), "path": ["blocks", { "id": 3 }], "to": 0 })));
    let doc = w.lab.item(mac, l.plan).unwrap().as_document().unwrap();
    assert_eq!(doc.blocks.iter().map(|b| b.id).collect::<Vec<_>>(), [3, 1, 2]);
    assert_eq!(doc.blocks[0].r#type, TypeV2::Paragraph);
    ok(run(&mut w, mac, json!({ "op": "remove", "entry": hex(l.plan), "path": ["blocks", { "id": 3 }] })));
    assert_eq!(cast::text(&w.lab, mac, l.plan, 3), None);
    // a list of values, by value
    let tag = |op: &str| json!({ "op": op, "entry": hex(l.plan), "path": ["tags"], "value": "spring" });
    ok(run(&mut w, mac, tag("insert")));
    assert_eq!(w.lab.item(mac, l.plan).unwrap().as_document().unwrap().tags, ["spring"]);
    ok(run(&mut w, mac, tag("remove")));
    assert!(w.lab.item(mac, l.plan).unwrap().as_document().unwrap().tags.is_empty());
}

#[test]
fn a_v1_document_reads_and_changes_through_the_lens() {
    let mut w = cast::world();
    let h = cast::handbook(&mut w);
    let (mac, coop) = (w.mac_a, h.coop.to_hex());
    // Welcome as a v2 app sees it: its v1 blocks through the lens, a heading and a paragraph
    let get = ok(run(&mut w, mac, json!({ "op": "get", "entry": hex(h.welcome), "schema": "document" })));
    assert_eq!(get["record"]["blocks"][0]["type"], "heading");
    assert_eq!(get["readOnly"], false);
    // the stored record is what the v1 app wrote, and ops only read it
    let stored = ok(run(&mut w, mac, json!({ "op": "get", "entry": hex(h.welcome), "schema": "stored" })));
    assert_eq!(stored["record"]["blocks"][0]["kind"], "h1");
    assert_eq!((stored["schema"].clone(), stored["readOnly"].clone()), (Value::Null, json!(true)));
    let raw = json!({ "op": "set", "entry": hex(h.welcome), "schema": "stored", "path": ["title"], "value": "x" });
    assert_eq!(refused(&run(&mut w, mac, raw)), "NoSchema");
    // a v2 edit through the lens: a v1 app sees it, and what only v2 says lands as v2 stores it
    let edit = json!({ "op": "batch", "as": coop, "ops": [
        { "op": "set", "entry": hex(h.welcome), "path": ["blocks", { "id": 2 }, "text"], "value": cast::AFTER_TEXT },
        { "op": "set", "entry": hex(h.welcome), "path": ["blocks", { "id": 2 }, "checked"], "value": true },
    ] });
    assert_eq!(ok(run(&mut w, mac, edit)).as_array().map(Vec::len), Some(1));
    let v1 = w.lab.item(mac, h.welcome).unwrap().as_document_v1().unwrap();
    assert_eq!(v1.blocks[1].text, cast::AFTER_TEXT);
    // its history shows each write's changes to the stored record, as every reader sees them
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": hex(h.welcome) })));
    let last = history["edits"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(last["kind"], "edit");
    let changes = last["changes"].as_array().unwrap();
    assert!(changes.contains(&json!({ "set": ["blocks", { "id": 2 }, "text"], "value": cast::AFTER_TEXT })), "{last}");
    assert!(changes.contains(&json!({ "set": ["blocks", { "id": 2 }, "checked"], "value": true })), "{last}");
    assert_eq!(changes.len(), 2, "{last}");
}

#[test]
fn creation_fills_defaults_and_refuses_what_doesnt_fit() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let create = |value: Value| {
        json!({ "op": "create", "vault": alice, "type": "todo", "tags": ["home"], "value": value })
    };
    let made = ok(run(&mut w, mac, create(json!({ "kind": "todo", "title": "Buy compost" }))));
    let entry = EntryId::from_hex(made["entry"].as_str().unwrap()).unwrap();
    assert_eq!(cast::status(&w.lab, mac, entry), Some(Status::Open));
    let row = ok(run(&mut w, mac, json!({ "op": "get", "entry": hex(entry) })));
    assert_eq!((row["type"].clone(), row["tags"].clone()), (json!("todo"), json!(["home"])));
    assert_eq!(row["record"]["notes"], "");
    let later = create(json!({ "kind": "todo", "title": "x", "status": "later" }));
    assert_eq!(refused(&run(&mut w, mac, later)), "NotAView");
    assert_eq!(refused(&run(&mut w, mac, create(json!({ "kind": "recipe", "title": "Soup" })))), "NoSchema");
    let value = json!({ "kind": "document" });
    let named = json!({ "op": "create", "vault": alice, "type": "note", "schema": "document", "value": value });
    assert!(ok(run(&mut w, mac, named))["entry"].is_string());
}

#[test]
fn lines_merge_restore_undo_and_variants_are_ops() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let mac = w.mac_a;
    let plan = hex(l.plan);
    // a proposal from the main line's heads, edited on its own line, then promoted into the main line
    let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": plan, "name": "Bolder" })))["line"].clone();
    let retitle = json!({ "op": "set", "entry": plan, "line": line, "path": ["title"], "value": "The plan" });
    ok(run(&mut w, mac, retitle));
    let main = |w: &World| w.lab.item(mac, l.plan).unwrap().as_document().unwrap().title;
    assert_eq!(main(&w), "Plan");
    ok(run(&mut w, mac, json!({ "op": "merge", "entry": plan, "from": line, "promote": true })));
    assert_eq!(main(&w), "The plan");
    // the history names the lines and what each write is
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": plan })));
    assert_eq!(history["lines"][1]["name"], "Bolder");
    assert_eq!(each(&history["edits"], |e| &e["kind"]), ["edit", "propose", "edit", "promote"]);
    // undo the retitle, which the main line took in, then restore the version the promote made
    let edits = each(&history["edits"], |e| &e["id"]);
    ok(run(&mut w, mac, json!({ "op": "undo", "entry": plan, "edit": edits[2] })));
    assert_eq!(main(&w), "Plan");
    ok(run(&mut w, mac, json!({ "op": "restore", "entry": plan, "at": [edits[3]] })));
    assert_eq!(main(&w), "The plan");
    // a variant in the coop, its copy marked in the same first write
    let coop = cast::coop_on(&mut w);
    let mark = [{ json!({ "op": "insert", "path": ["tags"], "value": format!("variant:{plan}") }) }];
    let variant = json!({ "op": "variant", "entry": plan, "into": coop.to_hex(), "as": coop.to_hex(), "ops": mark });
    let made = ok(run(&mut w, mac, variant))["entry"].as_str().unwrap().to_string();
    let copy = EntryId::from_hex(&made).unwrap();
    let doc = w.lab.item(mac, copy).unwrap().as_document().unwrap();
    assert_eq!((doc.title, doc.tags), ("The plan".to_string(), vec![format!("variant:{plan}")]));
    assert_eq!(w.lab.history(mac, copy).unwrap().changes().len(), 1);
}

#[test]
fn a_batch_is_read_whole_then_runs_until_a_refusal() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let mac = w.mac_a;
    let (plan, door) = (hex(l.plan), hex(l.door));
    let writes = |w: &World, e| w.lab.history(mac, e).unwrap().changes().len();
    let before = (writes(&w, l.plan), writes(&w, l.door));
    // two record ops on the plan make one write, a tag another, a todo's status a third
    let batch = json!({ "op": "batch", "ops": [
        { "op": "set", "entry": plan, "path": ["title"], "value": "Spring plan" },
        { "op": "set", "entry": plan, "path": ["blocks", { "id": 1 }, "text"], "value": "Spring plan" },
        { "op": "tag", "entry": plan, "add": ["spring"] },
        { "op": "set", "entry": door, "path": ["status"], "value": "doing" },
    ] });
    assert_eq!(ok(run(&mut w, mac, batch)).as_array().map(Vec::len), Some(3));
    assert_eq!((writes(&w, l.plan), writes(&w, l.door)), (before.0 + 2, before.1 + 1));
    assert_eq!(cast::text(&w.lab, mac, l.plan, 1).as_deref(), Some("Spring plan"));
    // an op that says nothing the engine does refuses the whole batch before anything runs
    let typo = json!({ "op": "batch", "ops": [
        { "op": "set", "entry": door, "path": ["status"], "value": "done" },
        { "op": "set", "entry": door, "path": ["status"], "valeu": "open" },
    ] });
    let answer = run(&mut w, mac, typo);
    assert_eq!((refused(&answer), answer["at"].clone(), answer["done"].clone()), ("BadOp", json!(1), json!([])));
    assert_eq!(cast::status(&w.lab, mac, l.door), Some(Status::Doing));
    // a refusal while running keeps what ran before it, and says so
    let late = json!({ "op": "batch", "ops": [
        { "op": "set", "entry": door, "path": ["status"], "value": "done" },
        { "op": "set", "entry": plan, "path": ["blocks", { "id": 7 }, "text"], "value": "nowhere" },
    ] });
    let answer = run(&mut w, mac, late);
    assert_eq!((refused(&answer), answer["at"].clone()), ("BadOp", json!(1)));
    assert_eq!(answer["done"].as_array().map(Vec::len), Some(1));
    assert_eq!(cast::status(&w.lab, mac, l.door), Some(Status::Done));
}

#[test]
fn the_rules_judge_each_op_by_the_caps_of_the_vault_it_acts_for() {
    let mut w = cast::world();
    let t = cast::todos_on(&mut w);
    w.lab.sync_all(0);
    let (bob, carol) = (w.bob.to_hex(), w.carol.to_hex());
    let (mac_b, mac_c) = (w.mac_b, w.mac_c);
    let door = hex(t.door);
    // Bob holds write on the door todo, Carol read: both see it, and nothing else of Alice's
    for d in [mac_b, mac_c] {
        let todos = ok(run(&mut w, d, json!({ "op": "query", "where": { "type": ["todo"] } })));
        assert_eq!(entries(&todos), [door.clone()]);
    }
    let status = |actor: &str| json!({ "op": "set", "entry": door, "path": ["status"], "value": "doing", "as": actor });
    assert!(ok(run(&mut w, mac_b, status(&bob)))["edit"].is_string());
    assert_eq!(refused(&run(&mut w, mac_c, status(&carol))), "NoCap");
    // a device acts only for its own vaults
    assert_eq!(refused(&run(&mut w, mac_c, status(&bob))), "NotActing");
    // what Bob wrote reaches Alice, and her history shows it as his
    w.lab.sync_all(1);
    let mac = w.mac_a;
    assert_eq!(cast::status(&w.lab, mac, t.door), Some(Status::Doing));
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": door })));
    let last = history["edits"].as_array().unwrap().last().unwrap().clone();
    let doing = json!([{ "set": ["status"], "value": "doing" }]);
    assert_eq!((last["actor"].clone(), last["changes"].clone()), (json!(bob), doing));
}

#[test]
fn reads_run_alone_and_every_op_says_only_what_it_takes() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let mac = w.mac_a;
    let set = json!({ "op": "set", "entry": hex(l.door), "path": ["status"], "value": "done" });
    assert!(!engine::reads(&set) && engine::reads(&json!({ "op": "query" })));
    assert_eq!(refused(&engine::read(&w.lab, mac, &set)), "BadOp");
    for bad in [
        json!({ "op": "find" }),
        json!({ "op": "query", "wehre": {} }),
        json!({ "op": "query", "where": { "colour": "red" } }),
        json!({ "op": "get", "entry": "door" }),
        json!({ "op": "set", "entry": hex(l.door), "path": ["status"] }),
        json!({ "op": "batch", "ops": [{ "op": "batch", "ops": [] }] }),
        json!({ "op": "variant", "entry": hex(l.plan), "into": hex(l.plan), "ops": [{ "op": "tag", "add": [] }] }),
    ] {
        assert_eq!(refused(&run(&mut w, mac, bad.clone())), "BadOp", "{bad}");
    }
    let alice = w.alice.to_hex();
    let schemas = ok(run(&mut w, mac, json!({ "op": "schemas", "vault": alice })));
    let mut kinds = each(&schemas["schemas"], |s| &s["kind"]);
    kinds.sort();
    assert_eq!(kinds, ["document", "document", "todo", "todo"]);
    assert!(list(&schemas["schemas"]).iter().all(|s| s["builtIn"] == true));
    assert_eq!(list(&schemas["lenses"]).len(), 2);
}
