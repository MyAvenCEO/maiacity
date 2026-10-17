//! An entry's files (`docs/ARCHITECTURE.md` §8 and §13): any entry brings a file in its creation's own write, one
//! signed edit (`create` with a `file`, `Lab::create_bringing`), or in a write on its main line (`put_file` with an
//! `entry`, `Lab::bring_into`), the file's bytes beside the op as a node brings them (avendb-net's `Node::run`). Who
//! may is what the shares decide already: `create` for a creation that brings one, `set` of the whole record for a file
//! brought into an entry, as its readers count a file as the entry's (`Lab::line_files`), so a Suggester, who writes
//! on proposals alone, brings none into main. Whoever reads the entry opens its file, and its record reads as it would
//! without one. Alice keeps recipes, as Maia City does: Carol is an Editor of them, Bob a Viewer, Dave a Suggester, and
//! a Public share picks them, so the server's feed lists each with its files.

use avendb::cast::{self, World};
use avendb::engine;
use avendb::history::MAIN;
use avendb::id::{BlobId, EditId, EntryId, SignerId, VaultId};
use avendb::sealed::{Brought, FileKey, FileRoot, seal};
use avendb::world;
use serde_json::{Value, json};

fn run(w: &mut World, d: SignerId, op: &Value) -> Value {
    engine::run(&mut w.lab, d, op)
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

fn list(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or_default()
}

fn entry_id(answer: &Value) -> EntryId {
    EntryId::from_hex(answer["entry"].as_str().expect("an entry")).expect("an entry's id")
}

/// A recipe's source, sealed under a key of its own, as a node's store seals it (`Node::store_file`).
fn source(text: &str) -> Brought {
    let (key, plain) = (FileKey::from_bytes([7; 32]), text.repeat(300).into_bytes());
    let root = avendb::hash::hash("a test file's root", &seal(&key, &plain));
    Brought::new(root, key, plain.len() as u64)
}

/// A recipe as the asset thread keeps one: its card and its engine, its source empty, as its file holds it.
fn recipe(label: &str) -> Value {
    json!({
        "kind": "recipe", "title": label, "note": "Built in its parts.", "tags": ["ref:machines/lamp@1"],
        "source": "", "engine": { "host": "box", "version": 4, "hash": "ab".repeat(32) },
        "manifest": { "kit": ["box"], "presets": ["brass"], "controls": ["slider"] },
        "card": { "format": "asset-card", "v": 1, "group": "machines", "label": label },
    })
}

struct Gate {
    w: World,
    alice: VaultId,
    mac: SignerId,
}

/// Alice's recipes: Carol an Editor of them, Bob a Viewer, Dave a Suggester, and Public, each by their type.
fn gate() -> Gate {
    let mut w = cast::world();
    let (alice, mac) = (w.alice, w.mac_a);
    let recipes = json!({ "type": ["recipe"] });
    let shares = [
        (json!({ "vault": w.carol.to_hex() }), json!("Editor")),
        (json!({ "vault": w.bob.to_hex() }), json!("Viewer")),
        (json!({ "vault": w.dave.to_hex() }), json!("Suggester")),
        (json!("everyone"), json!("Public")),
    ];
    for (who, level) in shares {
        let op = json!({ "op": "share", "over": alice.to_hex(), "who": who, "level": level, "what": recipes });
        ok(run(&mut w, mac, &op));
    }
    w.lab.sync_all(0);
    Gate { w, alice, mac }
}

impl Gate {
    /// The create op of a recipe labelled `label` in Alice's vault, acting for `actor`, bringing a file of `len` bytes.
    fn create(&self, label: &str, actor: VaultId, len: u64) -> Value {
        json!({ "op": "create", "vault": self.alice.to_hex(), "type": "recipe", "value": recipe(label),
            "file": { "len": len, "name": format!("{label}.js"), "media": "text/javascript" }, "as": actor.to_hex() })
    }

    /// The writes of entry `e` device `d` shows: each one's id, line, and whether it counts.
    fn writes(&mut self, d: SignerId, e: EntryId) -> Vec<(String, Value, bool)> {
        let history = ok(run(&mut self.w, d, &json!({ "op": "history", "entry": e.to_hex() })));
        let write = |x: &Value| (x["id"].as_str().expect("an id").to_string(), x["line"].clone(), x["counted"] == true);
        list(&history["edits"]).iter().map(write).collect()
    }

    /// Entry `e`'s record on main, as device `d` reads it.
    fn record(&mut self, d: SignerId, e: EntryId) -> Value {
        ok(run(&mut self.w, d, &json!({ "op": "get", "entry": e.to_hex() })))["record"].clone()
    }

    /// The feed's row of entry `e`, as device `d` would serve it (`world::public_entries`).
    fn row(&self, d: SignerId, e: EntryId) -> Value {
        let rows = world::public_entries(&self.w.lab, d, Some(&["recipe"]));
        rows.into_iter().find(|r| r["entry"] == e.to_hex()).unwrap_or_else(|| panic!("no row of {e:?} on {d:?}"))
    }
}

/// A file as a feed's row lists it.
fn listed(root: FileRoot, len: u64) -> Value {
    json!({ "root": BlobId(root.hash).to_hex(), "size": root.size, "len": len })
}

/// A recipe and its source are one signed edit: `create` with a `file` brings it in the creation's own write, which
/// every reader of the entry opens, the file with it, and its record reads as one created without a file. `may`
/// checks the creation alone, as the rules judge it; a create with a file runs with its bytes beside it, as a node runs
/// it, never alone on the Lab, nor in a batch. Carol, an Editor, creates one as Alice does; Bob, a Viewer, and Dave, a
/// Suggester, create none on main, with a file or without.
#[test]
fn a_recipe_and_its_source_are_one_write() {
    let mut g = gate();
    let (mac, alice, bob, carol) = (g.mac, g.alice, g.w.mac_b, g.w.mac_c);
    let file = source("export default (kit) => kit.box(1, 1, 1);\n");
    let (root, len) = (file.root, file.len);
    let op = g.create("Lamp", alice, len);
    assert!(engine::brings(&op) && !engine::reads(&op), "it brings its bytes beside it");
    assert_eq!(engine::len_of(&op).ok(), Some(len));
    let may = ok(run(&mut g.w, mac, &json!({ "op": "may", "ops": [op] })));
    assert_eq!(may, json!([true]), "the creation it would make");
    let before = g.w.lab.entries(mac).len();
    let alone = run(&mut g.w, mac, &op);
    assert_eq!(refused(&alone), "BadOp", "its bytes come beside it: {alone}");
    assert!(alone["why"].as_str().is_some_and(|w| w.contains("Node::run")), "{alone}");
    assert_eq!(g.w.lab.entries(mac).len(), before, "nothing made");
    // made with its bytes: one write, which names the file in the clear, the creation
    let made = ok(engine::put_file(&mut g.w.lab, mac, &op, file.clone()));
    let e = entry_id(&made);
    assert_eq!((&made["root"], &made["size"]), (&json!(BlobId(root.hash).to_hex()), &json!(root.size)));
    let writes = g.writes(mac, e);
    assert_eq!(writes.len(), 1, "one write: {writes:?}");
    let creation = EditId::from_hex(&writes[0].0).expect("its id");
    let signed = g.w.lab.signed_edit(mac, creation).expect("the creation, signed");
    assert_eq!(signed.edit.files(), [root], "the creation brings the file");
    assert_eq!(g.w.lab.entry_files(mac, e), [(root, Some(len))]);
    assert_eq!(g.w.lab.line_files(mac, e, MAIN), [(root, Some(len))]);
    // its record reads as one made without a file
    let twin = json!({ "op": "create", "vault": alice.to_hex(), "type": "recipe", "value": recipe("Lamp") });
    let twin = entry_id(&ok(run(&mut g.w, mac, &twin)));
    assert_eq!(g.record(mac, e), g.record(mac, twin));
    assert!(g.w.lab.line_files(mac, twin, MAIN).is_empty(), "the twin brings none");
    // Carol, an Editor, creates one with its source too
    let theirs = source("export default (kit) => kit.cylinder(1, 2);\n");
    let (their_root, their_len) = (theirs.root, theirs.len);
    let op = g.create("Lantern", g.w.carol, their_len);
    let e2 = entry_id(&ok(engine::put_file(&mut g.w.lab, carol, &op, theirs)));
    g.w.lab.sync_all(1);
    // every reader opens each, and the file with it: Alice's phone, Bob's Mac, Carol's
    for d in [mac, g.w.phone_a, bob, carol] {
        assert_eq!(g.w.lab.line_files(d, e, MAIN), [(root, Some(len))], "on {d:?}");
        assert_eq!(g.w.lab.file(d, &root).map(|b| (b.root, b.len)), Some((root, len)), "on {d:?}");
        assert_eq!(g.w.lab.line_files(d, e2, MAIN), [(their_root, Some(their_len))], "on {d:?}");
        assert!(g.writes(d, e).iter().chain(&g.writes(d, e2)).all(|w| w.2), "every write counts on {d:?}");
        assert_eq!(g.record(d, e)["card"]["label"], "Lamp", "on {d:?}");
        // and the server's feed, which reads what everyone reads, lists it
        assert_eq!(g.row(d, e)["files"], json!([listed(root, len)]), "on {d:?}");
        assert_eq!(g.row(d, twin)["files"], json!([]), "on {d:?}");
    }
    // Bob reads, Dave suggests: neither creates on main, with a file or without
    let (bobs, daves) = (g.create("Lamp", g.w.bob, len), g.create("Lamp", g.w.dave, len));
    let asks = |w: &mut World, d, op: &Value| ok(run(w, d, &json!({ "op": "may", "ops": [op] })))[0].clone();
    assert_eq!(refused(&asks(&mut g.w, bob, &bobs)), "NoCap", "a Viewer creates nothing");
    let dave = g.w.mac_d;
    assert_eq!(refused(&asks(&mut g.w, dave, &daves)), "NotAllowed", "a Suggester creates on main nothing");
    let refusal = engine::put_file(&mut g.w.lab, dave, &daves, file.clone());
    assert_eq!(refused(&refusal), "NotAllowed", "with its bytes neither");
    // a file the op doesn't take
    let bad = [
        json!(3),
        json!({}),
        json!({ "len": -1 }),
        json!({ "len": 10, "name": 3 }),
        json!({ "len": 10, "media": ["text/plain"] }),
        json!({ "len": 10, "type": "text/plain" }),
    ];
    for file in bad {
        let mut op = g.create("Lamp", alice, 1);
        op["file"] = file.clone();
        assert_eq!(refused(&asks(&mut g.w, mac, &op)), "BadOp", "{file}");
    }
    // a schema or a lens holds its JSON alone
    let schema = json!({ "op": "create", "vault": alice.to_hex(), "type": "schema", "value": { "title": "Plant" },
        "file": { "len": 1 } });
    let answer = asks(&mut g.w, mac, &schema);
    assert_eq!(refused(&answer), "BadOp", "{answer}");
    assert_eq!(refused(&engine::put_file(&mut g.w.lab, mac, &schema, source("x"))), "BadOp");
    // its bytes come beside it, of the length it says, and never in a batch
    let longer = g.create("Lamp", alice, len + 1);
    let short = engine::put_file(&mut g.w.lab, mac, &longer, source("export"));
    assert_eq!(refused(&short), "BadOp", "{short}");
    let batch = json!({ "op": "batch", "ops": [g.create("Lamp", alice, len)] });
    let answer = run(&mut g.w, mac, &batch);
    assert_eq!((refused(&answer), &answer["at"]), ("BadOp", &json!(0)), "{answer}");
    assert!(answer["why"].as_str().is_some_and(|w| w.contains("never in a batch")), "{answer}");
}

/// `put_file` with an `entry` brings a file into that entry by one write on its main line that changes nothing of its
/// record, as a later bake would; without one it makes a file entry as ever. `set` of the whole record decides who
/// may: Alice and Carol, an Editor, do; Dave, a Suggester, whose share writes on proposals alone, may not. A write on
/// main that changes nothing, which his share lets him make, brings a file all the same, which readers count as a
/// write and never as the entry's file: the feed lists only the files the entry's writers brought, its newest last.
#[test]
fn put_file_brings_a_file_into_an_entry_as_its_setters_alone_do() {
    let mut g = gate();
    let (mac, alice, carol, dave) = (g.mac, g.alice, g.w.mac_c, g.w.mac_d);
    let first = source("export default (kit) => kit.box(1, 1, 1);\n");
    let (one, one_len) = (first.root, first.len);
    let op = g.create("Lamp", alice, one_len);
    let e = entry_id(&ok(engine::put_file(&mut g.w.lab, mac, &op, first)));
    g.w.lab.sync_all(1);
    let into = |len: u64, actor: VaultId| {
        json!({ "op": "put_file", "entry": e.to_hex(), "len": len, "name": "lod0.bin", "as": actor.to_hex() })
    };
    // Carol brings a second file, as an Editor may
    let second = source("lod0 ");
    let (two, two_len) = (second.root, second.len);
    let op = into(two_len, g.w.carol);
    assert_eq!(engine::len_of(&op).ok(), Some(two_len));
    assert_eq!(ok(run(&mut g.w, carol, &json!({ "op": "may", "ops": [op] }))), json!([true]));
    assert_eq!(refused(&run(&mut g.w, carol, &op)), "BadOp", "its bytes come beside it");
    let made = ok(engine::put_file(&mut g.w.lab, carol, &op, second));
    let said = (&made["entry"], &made["root"], &made["size"]);
    assert_eq!(said, (&json!(e.to_hex()), &json!(BlobId(two.hash).to_hex()), &json!(two.size)));
    let edit = made["edit"].as_str().expect("its write").to_string();
    let writes = g.writes(carol, e);
    assert_eq!(writes.len(), 2, "one write more: {writes:?}");
    assert_eq!((&writes[1].0, &writes[1].1, writes[1].2), (&edit, &Value::Null, true), "on main, counted");
    // Alice brings a third, her own vault's
    let third = source("lod1 ");
    let (three, three_len) = (third.root, third.len);
    ok(engine::put_file(&mut g.w.lab, mac, &into(three_len, alice), third));
    // Dave, a Suggester, may not: his share sets nothing on main
    g.w.lab.sync_all(2);
    let daves = into(1, g.w.dave);
    let asked = ok(run(&mut g.w, dave, &json!({ "op": "may", "ops": [daves] })))[0].clone();
    assert_eq!(refused(&asked), "NotAllowed", "{asked}");
    assert_eq!(refused(&engine::put_file(&mut g.w.lab, dave, &into(4, g.w.dave), source("junk"))), "NotAllowed");
    // a write on main that touches nothing his share lets through, with a file: counted, and no file of the entry's
    let junk = source("junk ");
    let (four, four_len) = (junk.root, junk.len);
    g.w.lab.bring(dave, g.w.dave, e, vec![junk], |_| {}).expect("an empty write on main, which a Suggester may make");
    g.w.lab.sync_all(3);
    let ours = [(one, Some(one_len)), (two, Some(two_len)), (three, Some(three_len))];
    for d in [mac, g.w.phone_a, g.w.mac_b, carol, dave] {
        assert!(g.writes(d, e).iter().all(|w| w.2), "every write counts on {d:?}");
        assert_eq!(g.w.lab.line_files(d, e, MAIN), ours, "the entry's own, oldest first, on {d:?}");
        assert!(g.w.lab.entry_files(d, e).contains(&(four, Some(four_len))), "brought all the same, on {d:?}");
        let row = g.row(d, e);
        assert_eq!(list(&row["files"]).last(), Some(&listed(three, three_len)), "the newest last, on {d:?}");
        assert_eq!(list(&row["files"]).len(), 3, "on {d:?}");
        assert_eq!(g.record(d, e)["card"]["label"], "Lamp", "its record as it was, on {d:?}");
    }
    // what it doesn't take, and an entry it can't bring one into
    let bad = [
        (json!({ "op": "put_file", "entry": e.to_hex(), "vault": alice.to_hex(), "len": 1 }), "BadOp"),
        (json!({ "op": "put_file", "entry": e.to_hex(), "tags": ["x"], "len": 1 }), "BadOp"),
        (json!({ "op": "put_file", "entry": e.to_hex(), "name": 3, "len": 1 }), "BadOp"),
        (json!({ "op": "put_file", "entry": e.to_hex() }), "BadOp"),
        (json!({ "op": "put_file", "entry": e.to_hex(), "len": 1, "line": edit }), "BadOp"),
        (json!({ "op": "put_file", "entry": "cd".repeat(32), "len": 1 }), "NoEntry"),
        (json!({ "op": "put_file", "entry": "nobody", "len": 1 }), "BadOp"),
    ];
    for (op, why) in bad {
        let asked = ok(run(&mut g.w, mac, &json!({ "op": "may", "ops": [op] })))[0].clone();
        assert_eq!(refused(&asked), why, "{op}: {asked}");
    }
    let plant = json!({ "title": "Plant", "type": "object", "properties": { "kind": { "const": "plant" },
        "name": { "type": "string", "default": "" } }, "required": ["kind"] });
    let lane = json!({ "op": "create", "vault": alice.to_hex(), "type": "schema", "value": plant });
    let schema = entry_id(&ok(run(&mut g.w, mac, &lane)));
    let into_schema = json!({ "op": "put_file", "entry": schema.to_hex(), "len": 1 });
    assert_eq!(refused(&engine::put_file(&mut g.w.lab, mac, &into_schema, source("x"))), "BadOp");
    // without an entry, a file entry as ever, whose second write brings its bytes
    let picture = source("a picture ");
    let library = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Lamp.jpg", "len": picture.len });
    let picture = entry_id(&ok(engine::put_file(&mut g.w.lab, mac, &library, picture)));
    assert_eq!(g.writes(mac, picture).len(), 2, "a file entry, then the write that brings its bytes");
}
