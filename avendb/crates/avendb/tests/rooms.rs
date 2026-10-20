//! Rooms (`docs/ARCHITECTURE.md` §5, "Rooms"): a room is an entry of type room, its messages rows, and its members
//! the vaults it is shared with at Member. A member adds messages, thread replies and reactions, and changes only the
//! rows its own counted writes added: every reader decides whose a row is from the room's history, so no write can
//! claim another's message. Everything goes through the ops engine (`engine::run`), as the page sends ops.

use avendb::cast::{self, World};
use avendb::engine;
use avendb::id::{EntryId, SignerId};
use serde_json::{Value, json};

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

/// The room's record as device `d` opens it on the main line.
fn record(w: &mut World, d: SignerId, room: &str) -> Value {
    ok(run(w, d, json!({ "op": "get", "entry": room })))["record"].clone()
}

/// The texts of the room's messages as device `d` reads them, in the list's order.
fn texts(w: &mut World, d: SignerId, room: &str) -> Vec<String> {
    let r = record(w, d, room);
    let text = |m: &Value| m["text"].as_str().unwrap_or_default().to_string();
    r["messages"].as_array().map(|ms| ms.iter().map(text).collect()).unwrap_or_default()
}

/// How many of the room's edits device `d` doesn't count.
fn uncounted(w: &mut World, d: SignerId, room: &str) -> usize {
    let history = ok(run(w, d, json!({ "op": "history", "entry": room })));
    let edits = history["edits"].as_array().cloned().unwrap_or_default();
    edits.iter().filter(|x| x["counted"] == json!(false)).count()
}

/// Alice's room "Garden", shared with Bob and Carol at Member, and synced: the world and the room.
fn garden() -> (World, String) {
    let mut w = cast::world();
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let value = json!({ "kind": "room", "look": "group", "name": "Garden" });
    let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": alice, "type": "room", "value": value })));
    let room = made["entry"].as_str().expect("the room").to_string();
    EntryId::from_hex(&room).expect("an entry's id");
    for who in [w.bob, w.carol] {
        let share = json!({ "op": "share", "over": alice, "who": { "vault": who.to_hex() }, "level": "Member",
            "what": { "entry": [room] } });
        ok(run(&mut w, mac, share));
    }
    w.lab.sync_all(0);
    (w, room)
}

fn post(id: i64, text: &str) -> Value {
    json!({ "id": id, "text": text, "at": 1_700_000_000_000_i64 })
}

#[test]
fn a_member_posts_and_edits_only_its_own_messages() {
    let (mut w, room) = garden();
    let (alice, bob, carol) = (w.mac_a, w.mac_b, w.mac_c);
    let insert = |path: Value, value: Value| json!({ "op": "insert", "entry": room, "path": path, "value": value });
    ok(run(&mut w, bob, insert(json!(["messages"]), post(11, "Beans are up"))));
    w.lab.sync_all(1);
    ok(run(&mut w, carol, insert(json!(["messages"]), post(12, "Lovely"))));
    w.lab.sync_all(2);
    for d in [alice, bob, carol] {
        assert_eq!(texts(&mut w, d, &room), ["Beans are up", "Lovely"]);
    }
    // Bob edits his message; Carol tries to change it too
    let edit = |id: i64, text: &str| {
        json!({ "op": "set", "entry": room, "path": ["messages", { "id": id }, "text"], "value": text })
    };
    ok(run(&mut w, bob, edit(11, "Beans are up!")));
    let carol_tries = run(&mut w, carol, edit(11, "Carol was here"));
    w.lab.sync_all(3);
    for d in [alice, bob, carol] {
        assert_eq!(texts(&mut w, d, &room), ["Beans are up!", "Lovely"], "on {d:?}");
    }
    assert_eq!(refused(&carol_tries), "NotAllowed");
    // a patched app writes it all the same: no reader counts it, Carol's own Mac neither
    let before = uncounted(&mut w, alice, &room);
    let forged = w.lab.patched(|lab| engine::run(lab, carol, &edit(11, "Carol was here")));
    ok(forged);
    w.lab.sync_all(3);
    for d in [alice, bob, carol] {
        assert_eq!(texts(&mut w, d, &room), ["Beans are up!", "Lovely"], "on {d:?}");
        assert_eq!(uncounted(&mut w, d, &room), before + 1, "on {d:?}");
    }
    // a member can't rename the room or delete it either
    let rename = json!({ "op": "set", "entry": room, "path": ["name"], "value": "Bob's" });
    assert_eq!(refused(&run(&mut w, bob, rename)), "NotAllowed");
    // the owner may change anything
    ok(run(&mut w, alice, edit(12, "Lovely, Carol")));
    w.lab.sync_all(4);
    assert_eq!(texts(&mut w, carol, &room), ["Beans are up!", "Lovely, Carol"]);
}

#[test]
fn threads_and_reactions_are_rows_their_adders_own() {
    let (mut w, room) = garden();
    let (alice, bob, carol) = (w.mac_a, w.mac_b, w.mac_c);
    let insert = |path: Value, value: Value| json!({ "op": "insert", "entry": room, "path": path, "value": value });
    ok(run(&mut w, bob, insert(json!(["messages"]), post(21, "Who waters on Sunday?"))));
    w.lab.sync_all(1);
    // Carol replies in Bob's thread and reacts to his message: rows she adds inside his
    ok(run(&mut w, carol, insert(json!(["messages", { "id": 21 }, "thread"]), post(22, "Me"))));
    let thumbs = json!({ "id": 23, "key": "👍" });
    ok(run(&mut w, carol, insert(json!(["messages", { "id": 21 }, "reactions"]), thumbs)));
    w.lab.sync_all(2);
    // she edits her reply and takes back her reaction; Bob can't do either for her
    let reply = json!(["messages", { "id": 21 }, "thread", { "id": 22 }, "text"]);
    let back = json!(["messages", { "id": 21 }, "reactions", { "id": 23 }, "deleted"]);
    let set = |path: &Value, value: Value| json!({ "op": "set", "entry": room, "path": path, "value": value });
    ok(run(&mut w, carol, set(&reply, json!("Me, at nine"))));
    let bob_tries = run(&mut w, bob, set(&reply, json!("Not me")));
    ok(run(&mut w, carol, set(&back, json!(true))));
    w.lab.sync_all(3);
    for d in [alice, bob, carol] {
        let r = record(&mut w, d, &room);
        let m = &r["messages"][0];
        assert_eq!(m["thread"][0]["text"], "Me, at nine", "on {d:?}");
        assert_eq!(m["reactions"][0]["deleted"], true, "on {d:?}");
    }
    assert_eq!(refused(&bob_tries), "NotAllowed");
    // Bob deletes his own message: its thread stays
    let gone = json!({ "op": "batch", "ops": [
        set(&json!(["messages", { "id": 21 }, "deleted"]), json!(true)),
        set(&json!(["messages", { "id": 21 }, "text"]), json!("")),
    ] });
    ok(run(&mut w, bob, gone));
    w.lab.sync_all(4);
    let r = record(&mut w, carol, &room);
    assert_eq!((r["messages"][0]["deleted"].clone(), r["messages"][0]["thread"][0]["text"].clone()),
        (json!(true), json!("Me, at nine")));
}

#[test]
fn a_member_can_t_remove_rows_or_touch_a_room_it_isn_t_in() {
    let (mut w, room) = garden();
    let (bob, dave) = (w.mac_b, w.mac_d);
    let insert = |value: Value| json!({ "op": "insert", "entry": room, "path": ["messages"], "value": value });
    ok(run(&mut w, bob, insert(post(31, "Mine"))));
    let remove = json!({ "op": "remove", "entry": room, "path": ["messages", { "id": 31 }] });
    assert_eq!(refused(&run(&mut w, bob, remove)), "NotAllowed");
    // Dave was never a member: he can't read it, let alone post
    w.lab.sync_all(1);
    assert!(run(&mut w, dave, insert(post(32, "Hi"))).get("refused").is_some());
}

#[test]
fn a_room_read_names_who_added_each_row_from_the_history() {
    let (mut w, room) = garden();
    let (alice, bob, carol) = (w.mac_a, w.mac_b, w.mac_c);
    let insert = |path: Value, value: Value| json!({ "op": "insert", "entry": room, "path": path, "value": value });
    for (d, id) in [(bob, 41), (carol, 42), (bob, 43)] {
        ok(run(&mut w, d, insert(json!(["messages"]), post(id, &format!("m{id}")))));
        w.lab.sync_all(id as u64);
    }
    ok(run(&mut w, carol, insert(json!(["messages", { "id": 41 }, "reactions"]), json!({ "id": 44, "key": "🌱" }))));
    w.lab.sync_all(50);
    let (b, c) = (w.bob.to_hex(), w.carol.to_hex());
    for d in [alice, bob, carol] {
        let read = ok(run(&mut w, d, json!({ "op": "room", "entry": room })));
        let ms = read["room"]["messages"].as_array().expect("its messages").clone();
        let by: Vec<Value> = ms.iter().map(|m| m["by"]["vault"].clone()).collect();
        assert_eq!(by, [json!(b), json!(c), json!(b)], "on {d:?}");
        assert_eq!(ms[0]["reactions"][0]["by"]["vault"], json!(c));
        assert_eq!(read["more"], false);
    }
    // the last two, then the one before them
    let page = ok(run(&mut w, alice, json!({ "op": "room", "entry": room, "last": 2 })));
    let ids = |p: &Value| p["room"]["messages"].as_array().unwrap().iter().map(|m| m["id"].clone()).collect::<Vec<_>>();
    assert_eq!((ids(&page), page["more"].clone()), (vec![json!(42), json!(43)], json!(true)));
    let older = ok(run(&mut w, alice, json!({ "op": "room", "entry": room, "last": 2, "before": 42 })));
    assert_eq!((ids(&older), older["more"].clone()), (vec![json!(41)], json!(false)));
}
