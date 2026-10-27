//! Addressable actors on the engine (`engine` ops `describe` and `call`, `avendb::address`; Lean `Address.lean` and
//! `Mutation.lean`): an actor is one entry holding its interface; any device that reads the entry describes it alone; a
//! call is admitted only against the interface's version, by a method it has, with its params, and with a footprint
//! inside the caller's caps; and a method's template that writes outside its footprint writes nothing. Alice's library
//! (`cast::library`) is the data; her lane holds an actor schema, as Maia City's will by AIP.

use avendb::cast;
use avendb::engine;
use avendb::id::{EntryId, SignerId};
use avendb::lens::Status;
use serde_json::{json, Value};
use avendb_testkit::{ok, refused};

const ACTOR_V1: &str = r#"{"title": "Actor, v1", "type": "object", "required": ["kind"], "properties": {
  "kind": { "const": "actor" }, "title": { "type": "string", "default": "" },
  "interface": { "type": "object", "default": {} } }}"#;

fn run(w: &mut cast::World, d: SignerId, op: Value) -> Value {
    engine::run(&mut w.lab, d, &op)
}

/// The todo mover: `advance` sets a todo's status, inside its footprint (todos, their status); `read` gets one;
/// `retitle` claims the status alone but its template sets the title, outside its footprint.
fn mover() -> Value {
    let set_status = json!([{ "op": "set", "path": ["status"] }]);
    json!({ "version": 1, "description": "Moves todos along", "events": ["moved"], "methods": [
        { "name": "advance", "params": ["todo", "status"], "ops": set_status, "where": { "type": ["todo"] },
          "run": { "op": "set", "entry": { "$": "todo" }, "path": ["status"], "value": { "$": "status" } } },
        { "name": "read", "params": ["todo"], "ops": [{ "op": "read" }], "where": { "type": ["todo"] },
          "run": { "op": "get", "entry": { "$": "todo" } } },
        { "name": "retitle", "params": ["todo", "title"], "ops": set_status, "where": { "type": ["todo"] },
          "run": { "op": "set", "entry": { "$": "todo" }, "path": ["title"], "value": { "$": "title" } } },
    ] })
}

#[test]
fn an_actor_is_described_by_its_entry_and_called_within_its_footprint_and_the_caps() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, mac, mac_b) = (w.alice, w.mac_a, w.mac_b);
    w.lab.add_schema(mac, alice, alice, ACTOR_V1.as_bytes()).expect("a lane entry");
    let value = json!({ "kind": "actor", "title": "Todo mover", "interface": mover() });
    let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": alice.to_hex(), "type": "actor", "value": value })));
    let actor = EntryId::from_hex(made["entry"].as_str().unwrap()).unwrap();
    // describe: the address and the interface, from the entry alone
    let d = ok(run(&mut w, mac, json!({ "op": "describe", "entry": actor.to_hex() })));
    let to = json!({ "vault": alice.to_hex(), "entry": actor.to_hex(), "version": 1 });
    assert_eq!(d["address"], to);
    assert_eq!(d["interface"]["description"], "Moves todos along");
    assert_eq!(d["interface"]["methods"][0]["name"], "advance");
    assert_eq!(refused(&run(&mut w, mac, json!({ "op": "describe", "entry": actor.to_hex(), "version": 2 }))), "BadOp");
    assert!(engine::reads(&json!({ "op": "describe", "entry": actor.to_hex() })), "describe only reads");
    // the vault itself calls: admitted, its template run, the todo moved
    let call = |method: &str, args: Value| json!({ "op": "call", "to": to, "method": method, "args": args });
    let door = l.door.to_hex();
    ok(run(&mut w, mac, call("advance", json!({ "todo": door, "status": "done" }))));
    assert_eq!(cast::status(&w.lab, mac, l.door), Some(Status::Done));
    let read = ok(run(&mut w, mac, call("read", json!({ "todo": door }))));
    assert_eq!(read["record"]["status"], "done");
    // versions must match, the method exist, the args be its params
    let mut v2 = call("advance", json!({ "todo": door, "status": "doing" }));
    v2["against"] = json!(2);
    assert_eq!(refused(&run(&mut w, mac, v2)), "wrongVersion");
    assert_eq!(refused(&run(&mut w, mac, call("delete", json!({}))) ), "noMethod");
    assert_eq!(refused(&run(&mut w, mac, call("advance", json!({ "todo": door })))), "badArgs");
    // a template that writes outside its footprint writes nothing
    let retitle = call("retitle", json!({ "todo": door, "title": "Elsewhere" }));
    assert_eq!(refused(&run(&mut w, mac, retitle)), "outsideFootprint");
    assert_eq!(w.lab.item(mac, l.door).and_then(|i| i.as_todo()).unwrap().title, "Fix the greenhouse door");
    // the vault holds every op, yet a footprint of notes alone keeps a method off the door
    let notes = json!({ "kind": "actor", "title": "Note mover", "interface": { "version": 1, "methods": [
        { "name": "advance", "params": ["todo", "status"], "ops": [{ "op": "set", "path": ["status"] }],
          "where": { "type": ["note"] },
          "run": { "op": "set", "entry": { "$": "todo" }, "path": ["status"], "value": { "$": "status" } } }] } });
    let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": alice.to_hex(), "type": "actor", "value": notes })));
    let to_notes = json!({ "vault": alice.to_hex(), "entry": made["entry"], "version": 1 });
    let wrong = json!({ "op": "call", "to": to_notes, "method": "advance", "args": { "todo": door, "status": "open" } });
    assert_eq!(refused(&run(&mut w, mac, wrong)), "outsideFootprint");
    assert_eq!(cast::status(&w.lab, mac, l.door), Some(Status::Done));
    // Bob holds a write share on the door alone, not on the actor: he can't describe it, so can't reach it
    w.lab.sync_all(0);
    assert_eq!(refused(&run(&mut w, mac_b, json!({ "op": "describe", "entry": actor.to_hex() }))), "NoEntry");
}

/// A caller's caps bound a call (cap per message): Bob reads Alice's whole vault through a read share, so he reaches
/// `read` but not `advance`, whose footprint needs a set op he holds no cap for.
#[test]
fn a_call_needs_a_cap_for_every_op_its_method_may_make() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, bob, mac, mac_b) = (w.alice, w.bob, w.mac_a, w.mac_b);
    w.lab.add_schema(mac, alice, alice, ACTOR_V1.as_bytes()).expect("a lane entry");
    let value = json!({ "kind": "actor", "title": "Todo mover", "interface": mover() });
    let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": alice.to_hex(), "type": "actor", "value": value })));
    let reads = cast::share(alice, cast::vault(bob), avendb::policy::Level::Read, avendb::slice::Selector::All);
    w.lab.issue(mac, &[mac], reads).expect("Alice lets Bob read her vault");
    w.lab.sync_all(0);
    let to = json!({ "vault": alice.to_hex(), "entry": made["entry"], "version": 1 });
    let call = |method: &str, args: Value| json!({ "op": "call", "to": to, "method": method, "args": args, "as": bob.to_hex() });
    let door = l.door.to_hex();
    let read = ok(run(&mut w, mac_b, call("read", json!({ "todo": door }))));
    assert_eq!(read["record"]["title"], "Fix the greenhouse door");
    assert_eq!(refused(&run(&mut w, mac_b, call("advance", json!({ "todo": door, "status": "done" })))), "outsideCap");
    assert_eq!(cast::status(&w.lab, mac_b, l.door), Some(Status::Open));
}

const QUERY_V1: &str = r#"{"title": "Query, v1", "type": "object", "required": ["kind"], "properties": {
  "kind": { "const": "query" }, "title": { "type": "string", "default": "" },
  "interface": { "type": "object", "default": {} }, "where": { "type": "object", "default": {} } }}"#;

/// The Universe reads by a named query (task A3): `query-posts`, a query entry whose `read` runs the `posts` op over
/// the posts a Public share reaches. Bob, who holds no share of his own, calls it by its address through the Public
/// shares alone, and pages through the posts as the `posts` op does; a footprint wider than the published posts
/// doesn't fit his caps.
#[test]
fn the_universe_reads_its_posts_by_a_named_query() {
    let mut w = cast::world();
    let (alice, mac, mac_b) = (w.alice, w.mac_a, w.mac_b);
    let alice_hex = alice.to_hex();
    w.lab.add_schema(mac, alice, alice, QUERY_V1.as_bytes()).expect("a lane entry");
    let tag = "content:published";
    for (title, tags) in [("Harvest", vec![tag]), ("Rain", vec![tag]), ("Mine", vec![])] {
        let value = json!({ "kind": "post", "title": title, "text": "Out now.", "channel": "Devlog" });
        ok(run(&mut w, mac, json!({ "op": "create", "vault": alice_hex, "type": "post", "tags": tags, "value": value })));
    }
    for what in [json!({ "tag": tag }), json!({ "type": ["query"] })] {
        ok(run(&mut w, mac, json!({ "op": "share", "over": alice_hex, "who": "everyone", "level": "Public", "what": what })));
    }
    let posts = |footprint: Value| json!({ "kind": "query", "title": "query-posts", "where": footprint, "interface": {
        "version": 1, "description": "Reads the published posts, newest first.", "events": [], "needs": [], "methods": [
            { "name": "read", "params": ["limit", "after"], "ops": [{ "op": "read" }], "where": footprint,
              "run": { "op": "posts", "limit": { "$": "limit" }, "after": { "$": "after" } } }] } });
    let published = json!({ "all": [{ "type": ["post"] }, { "tag": tag }] });
    let made = |w: &mut cast::World, value: Value| {
        let made = ok(run(w, mac, json!({ "op": "create", "vault": alice_hex, "type": "query", "value": value })));
        json!({ "vault": alice_hex, "entry": made["entry"], "version": 1 })
    };
    let (to, wide) = (made(&mut w, posts(published)), made(&mut w, posts(json!({ "type": ["post"] }))));
    ok(run(&mut w, mac_b, json!({ "op": "follow", "vault": alice_hex, "on": true })));
    w.lab.sync_all(0);
    let bob = w.bob.to_hex();
    let call = |to: &Value, args: Value| json!({ "op": "call", "to": to, "method": "read", "args": args, "as": bob });
    let d = ok(run(&mut w, mac_b, json!({ "op": "describe", "entry": to["entry"] })));
    assert_eq!(d["interface"]["methods"][0]["run"]["op"], "posts", "the query says what it runs");
    let all = ok(run(&mut w, mac_b, call(&to, json!({ "limit": null, "after": null }))));
    let mut titles: Vec<&str> = all["posts"].as_array().unwrap().iter().map(|p| p["title"].as_str().unwrap()).collect();
    titles.sort();
    assert_eq!(titles, ["Harvest", "Rain"], "the published posts, and no other");
    let first = ok(run(&mut w, mac_b, call(&to, json!({ "limit": 1, "after": null }))));
    assert_eq!((&first["posts"][0], &first["more"]), (&all["posts"][0], &json!(true)), "the newest first");
    let next = ok(run(&mut w, mac_b, call(&to, json!({ "limit": 1, "after": first["posts"][0]["entry"] }))));
    assert_eq!((&next["posts"][0], &next["more"]), (&all["posts"][1], &json!(false)), "then the next");
    assert_eq!(refused(&run(&mut w, mac_b, call(&wide, json!({ "limit": 1, "after": null })))), "outsideCap");
}
