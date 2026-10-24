//! The ops engine on the Lab (`avendb::engine`, `docs/ARCHITECTURE.md` §8): queries that pick entries by the selector
//! of their labels and test what they open; record ops through an app's schema and its lens, which write only what
//! changed; every write's changes in its entry's history, the same for every reader; batches, proposals, merges,
//! restores, undos and forks as ops; and every op's write judged as any peer's, by the shares of the vault it acts
//! for, by the ops of every share of the chain it relies on (C1 to C4, `spec/AvenDB/Theorems.lean`) and by the schemas
//! its entry was written under (S1 to S4): `may` answers before a page offers a button, a write they don't allow is
//! refused, and one a patched app makes all the same counts for no reader, nor anything built on it. Alice's library
//! (`cast::library`) and the coop's handbook (`cast::handbook`, Welcome written by a v1 app) are the data; the ops are
//! JSON, as the page and the Mac app send them.

use avendb::cast::{self, World};
use avendb::data;
use avendb::engine;
use avendb::id::{BlobId, EntryId, SignerId, VaultId};
use avendb::keys::KeyFam;
use avendb::lab::{NewShare, Tamper};
use avendb::lens::{self, Schema, Status, TypeV1, View};
use avendb::policy::{Action, Kind, Level, Principal, Refusal};
use avendb::rules::{self, Op};
use avendb::world;
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
    // labels alone: the plan is the selector a share would hold, and nothing else is opened
    let work = json!({ "op": "query", "where": { "all": [{ "type": ["todo"] }, { "tag": "work" }] } });
    let work = ok(run(&mut w, mac, work));
    assert_eq!(entries(&work), [hex(l.door), hex(l.solar)]);
    assert_eq!(work["plan"], json!({ "all": [{ "type": ["todo"] }, { "tag": "work" }] }));
    // values, through the todo's schema: every todo is open, its default, though none wrote it
    let open = json!({ "path": ["status"], "eq": "open" });
    let open = json!({ "op": "query", "vault": alice, "where": open, "schema": "todo" });
    let open = ok(run(&mut w, mac, open));
    assert_eq!(entries(&open), [hex(l.door), hex(l.seeds), hex(l.solar)]);
    assert_eq!(open["plan"], json!({ "all": [] }));
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
    // Bob's Mac holds none of Alice's entries: no share gives his vault any
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
    assert_eq!(doc.blocks[0].r#type, TypeV1::Paragraph);
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
fn a_v0_document_reads_and_changes_through_the_lens() {
    let mut w = cast::world();
    let h = cast::handbook(&mut w);
    let (mac, coop) = (w.mac_a, h.coop.to_hex());
    // the coop's lane holds the lens engine's example, an older document schema and the lens from it, and an app on
    // that v0 writes a document
    for blob in [lens::example::blobs::DOCUMENT_V0, lens::example::blobs::DOCUMENT_LENS] {
        w.lab.add_schema(mac, h.coop, h.coop, blob.as_bytes()).expect("a lane entry");
    }
    let welcome = cast::document_v0("Welcome", cast::WELCOME_TEXT, mac);
    let welcome = w.lab.create(mac, h.coop, h.coop, "doc", &[], welcome).expect("a v0 document");
    // Welcome as a v1 app sees it: its v0 blocks through the lens, a heading and a paragraph
    let get = ok(run(&mut w, mac, json!({ "op": "get", "entry": hex(welcome), "schema": "document" })));
    assert_eq!(get["record"]["blocks"][0]["type"], "heading");
    assert_eq!(get["readOnly"], false);
    // the stored record is what the v0 app wrote, and ops only read it
    let stored = ok(run(&mut w, mac, json!({ "op": "get", "entry": hex(welcome), "schema": "stored" })));
    assert_eq!(stored["record"]["blocks"][0]["kind"], "h1");
    assert_eq!((stored["schema"].clone(), stored["readOnly"].clone()), (Value::Null, json!(true)));
    let raw = json!({ "op": "set", "entry": hex(welcome), "schema": "stored", "path": ["title"], "value": "x" });
    assert_eq!(refused(&run(&mut w, mac, raw)), "NoSchema");
    // a v1 edit through the lens: a v0 app sees it, and what only v1 says lands as v1 stores it
    let edit = json!({ "op": "batch", "as": coop, "ops": [
        { "op": "set", "entry": hex(welcome), "path": ["blocks", { "id": 2 }, "text"], "value": cast::AFTER_TEXT },
        { "op": "set", "entry": hex(welcome), "path": ["blocks", { "id": 2 }, "checked"], "value": true },
    ] });
    assert_eq!(ok(run(&mut w, mac, edit)).as_array().map(Vec::len), Some(1));
    let v0 = w.lab.item(mac, welcome).unwrap().as_document_v0().unwrap();
    assert_eq!(v0.blocks[1].text, cast::AFTER_TEXT);
    // its history shows each write's changes to the stored record, as every reader sees them
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": hex(welcome) })));
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
    assert_eq!(refused(&run(&mut w, mac, create(json!({ "kind": "potion", "title": "Soup" })))), "NoSchema");
    let value = json!({ "kind": "document" });
    let named = json!({ "op": "create", "vault": alice, "type": "note", "schema": "document", "value": value });
    assert!(ok(run(&mut w, mac, named))["entry"].is_string());
}

#[test]
fn articles_flows_functions_and_posts_are_kinds_of_their_own() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let create = |ty: &str, value: Value| json!({ "op": "create", "vault": alice, "type": ty, "value": value });
    let id = |made: Value| EntryId::from_hex(made["entry"].as_str().unwrap()).unwrap();
    // an article: a title and one Markdown text, which a set changes by the smallest character edit
    let article = json!({ "kind": "article", "title": "Harvest", "text": "First *light*." });
    let article = id(ok(run(&mut w, mac, create("article", article))));
    let set = json!({ "op": "set", "entry": hex(article), "path": ["text"], "value": "First *light*, then rain." });
    ok(run(&mut w, mac, set));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": hex(article), "schema": "article" })));
    let text = "First *light*, then rain.";
    assert_eq!(got["record"], json!({ "kind": "article", "title": "Harvest", "text": text, "tags": [] }));
    // read as Markdown, as a note is, for the page's note page and its world
    let doc = w.lab.item(mac, article).unwrap().as_markdown().unwrap();
    assert_eq!((doc.title.as_str(), doc.blocks[0].text.as_str()), ("Harvest", "First *light*, then rain."));
    assert!(w.lab.item(mac, article).unwrap().as_document().is_none(), "not a document");
    let note = ok(run(&mut w, mac, json!({ "op": "note", "entry": hex(article) })));
    assert_eq!((&note["kind"], &note["lines"][0]["text"]), (&json!("article"), &json!("First *light*, then rain.")));
    // a fork names its origin among the article's own tags, as a note's does
    let coop = cast::coop_on(&mut w);
    let fork = json!({ "op": "fork", "entry": hex(article), "into": coop.to_hex(), "as": coop.to_hex() });
    let copy = id(ok(run(&mut w, mac, fork)));
    let at = w.lab.history(mac, article).unwrap().heads(None);
    let tags = w.lab.item(mac, copy).unwrap().as_markdown().unwrap().tags;
    assert_eq!(tags, vec![world::fork_mark(article, &at)]);
    // a flow of stages, a function on one of them, and a post: records of their own kinds, which the world shows
    let stage = |id: u64, key: &str, next: &[&str]| json!({ "id": id, "key": key, "name": key, "next": next });
    let stages = [stage(1, "idea", &["draft"]), stage(2, "draft", &["published"]), stage(3, "published", &["draft"])];
    let flow = json!({ "kind": "flow", "key": "content", "name": "Content", "stages": stages });
    let flow = id(ok(run(&mut w, mac, create("flow", flow))));
    let function = json!({ "kind": "function", "name": "Post it", "flow": "content", "stage": "published" });
    ok(run(&mut w, mac, create("function", function)));
    let post = json!({ "kind": "post", "title": "Harvest", "text": "Out now.", "about": hex(article) });
    let post = id(ok(run(&mut w, mac, create("post", post))));
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let of = |e: EntryId| seen["entries"].as_array().unwrap().iter().find(|x| x["entry"] == hex(e)).unwrap().clone();
    assert_eq!((&of(article)["kind"], &of(article)["text"]), (&json!("note"), &json!("First *light*, then rain.")));
    assert_eq!((&of(flow)["kind"], &of(flow)["title"]), (&json!("record"), &json!("Content")));
    assert_eq!(of(flow)["record"]["stages"][2]["public"], false, "a stage is private unless it says so");
    assert_eq!((&of(post)["title"], &of(post)["text"]), (&json!("Harvest"), &json!("Out now.")));
    let told = &of(article)["record"];
    assert_eq!((&told["title"], &told["text"]), (&json!("Harvest"), &Value::Null), "its text is told once, as `text`");
    // each reads through its own schema alone, and a stage needs its key
    let flows = ok(run(&mut w, mac, json!({ "op": "query", "vault": alice, "schema": "flow" })));
    assert_eq!(entries(&flows), [hex(flow)]);
    let keyless = json!({ "kind": "flow", "stages": [{ "id": 1, "name": "Idea" }] });
    assert_eq!(refused(&run(&mut w, mac, create("flow", keyless))), "NotAView");
}

#[test]
fn the_posts_everyone_reads_are_the_feed_newest_first() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let id = |made: Value| EntryId::from_hex(made["entry"].as_str().unwrap()).unwrap();
    let feed = |w: &World| world::public_posts(&w.lab, mac);
    let listed = |posts: &[Value]| -> Vec<String> {
        let mut es: Vec<String> = posts.iter().map(|p| p["entry"].as_str().unwrap().to_string()).collect();
        es.sort();
        es
    };
    ok(run(&mut w, mac, json!({ "op": "profile", "vault": alice, "name": "Alice" })));
    // a schema of hers for posts that say when they were published, which the feed passes on though avenDB's doesn't
    let dated = lens::blobs::POST_V1.replace("Post, v1", "Post, dated").replace(
        r#""channel""#,
        r#""published": { "type": "string", "default": "" },
    "channel""#,
    );
    ok(run(&mut w, mac, json!({ "op": "create", "vault": alice, "type": "schema", "value": dated })));
    let dated = Schema::parse(dated.as_bytes()).expect("a schema").id().to_hex();
    // a post tagged as the content flow's published stage is hers alone until a Public share reaches the tag
    let tag = "content:published";
    let post = |title: &str, tags: &[&str]| {
        let value = json!({ "kind": "post", "title": title, "text": "Out now.", "channel": "Devlog" });
        json!({ "op": "create", "vault": alice, "type": "post", "tags": tags, "value": value })
    };
    let mut harvest = post("Harvest", &[tag]);
    harvest["schema"] = json!(dated);
    harvest["value"]["published"] = json!("2026-10-17T09:00:00Z");
    let harvest = id(ok(run(&mut w, mac, harvest)));
    assert!(feed(&w).is_empty(), "hers alone");
    let public = json!({ "op": "share", "over": alice, "who": "everyone", "level": "Public", "what": { "tag": tag } });
    ok(run(&mut w, mac, public));
    let rain = id(ok(run(&mut w, mac, post("Rain", &[tag]))));
    ok(run(&mut w, mac, post("Mine", &[])));
    let posts = feed(&w);
    let mut both = vec![hex(harvest), hex(rain)];
    both.sort();
    assert_eq!(listed(&posts), both, "the posts the share reaches, now and later, and no other");
    let created: Vec<u64> = posts.iter().map(|p| p["created"].as_u64().unwrap()).collect();
    assert!(created.windows(2).all(|c| c[0] >= c[1]), "newest first: {created:?}");
    // the same feed a page at a time, newest first, as a page shows the newest and the next as its person scrolls
    let page = |w: &mut World, o: Value| ok(run(w, mac, o));
    let first_page = page(&mut w, json!({ "op": "posts", "limit": 1 }));
    assert_eq!((&first_page["posts"], &first_page["more"]), (&json!([posts[0]]), &json!(true)));
    let next = page(&mut w, json!({ "op": "posts", "limit": 1, "after": posts[0]["entry"] }));
    assert_eq!((&next["posts"], &next["more"]), (&json!([posts[1]]), &json!(false)));
    let gone = page(&mut w, json!({ "op": "posts", "after": hex(EntryId([7; 32])) }));
    assert_eq!((&gone["posts"], &gone["more"]), (&json!([]), &json!(false)), "after a post taken off: none");
    assert_eq!(page(&mut w, json!({ "op": "posts" }))["posts"], json!(posts), "all of them, by default");
    assert_eq!(refused(&run(&mut w, mac, json!({ "op": "posts", "after": "x" }))), "BadOp");
    let first = posts.iter().find(|p| p["entry"] == hex(harvest)).unwrap();
    let fields = ["vault", "name", "kind", "title", "text", "channel", "about"].map(|k| first[k].clone());
    let want = [json!(alice), json!("Alice"), json!("human"), json!("Harvest"), json!("Out now."), json!("Devlog")];
    assert_eq!(fields[..6], want, "{first}");
    assert_eq!(fields[6], Value::Null, "about nothing");
    assert_eq!((&first["published"], &first["tags"]), (&json!("2026-10-17T09:00:00Z"), &json!([tag])), "as it says");
    let second = posts.iter().find(|p| p["entry"] == hex(rain)).unwrap();
    assert_eq!((&second["published"], &second["tags"]), (&Value::Null, &json!([tag])), "it says none");
    // deleted, or untagged as its article goes back to a draft, it leaves the feed
    let delete = json!({ "op": "insert", "entry": hex(rain), "path": ["tags"], "value": world::DELETED });
    ok(run(&mut w, mac, delete));
    assert_eq!(listed(&feed(&w)), [hex(harvest)]);
    ok(run(&mut w, mac, json!({ "op": "tag", "entry": hex(harvest), "remove": [tag] })));
    assert!(feed(&w).is_empty(), "no longer public");
}

/// The entries everyone reads (`world::public_entries`), of every kind or of the kinds asked, the code's
/// (`world::CODE_KINDS`) among them: each a Public share reaches, with its record as its main line counts it, the schema
/// that reads it and that version's heads, by vault, kind and entry; never a private one or a deleted one. The seed's
/// coop, Maia City, is told by where it stands in the seed: a coop of Alice's own that calls itself Maia City too is no
/// part of it.
#[test]
fn the_entries_everyone_reads_are_served_and_maia_city_told_by_the_seed() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice);
    // Maia City, the seed's coop, which owns avenMAIA, and a coop of Alice's that calls itself so too
    let seed = world::seed_of(&w.lab, mac);
    let city = seed[0];
    let fake = coop_of_alice(&mut w, 32);
    assert_eq!(seed, [city, w.avenceo], "the seed: Maia City, then avenMAIA, the server's aven");
    assert_eq!(world::seed_coop(w.lab.state(mac), alice), Some(city), "the seed's coop, found from her vault");
    let tag = "code:public";
    let entry = |made: Value| made["entry"].as_str().expect("its id").to_string();
    let mut views = vec![];
    for v in [city, fake] {
        let v = v.to_hex();
        ok(run(&mut w, mac, json!({ "op": "profile", "vault": v, "name": world::SEED_COOP })));
        let public = json!({ "op": "share", "over": v, "who": "everyone", "level": "Public", "what": { "tag": tag },
            "as": v });
        ok(run(&mut w, mac, public));
        let view = json!({ "kind": "view", "title": "Holders", "source": "<p>{{n}}</p>", "data": { "n": 1 } });
        let create = json!({ "op": "create", "vault": v, "type": "view", "tags": [tag], "value": view, "as": v });
        views.push(entry(ok(run(&mut w, mac, create))));
    }
    let made = |w: &mut World, v: VaultId, ty: &str, tags: &[&str], value: Value| {
        let create = json!({ "op": "create", "vault": v.to_hex(), "type": ty, "tags": tags, "value": value,
            "as": v.to_hex() });
        entry(ok(run(w, mac, create)))
    };
    made(&mut w, city, "logic", &[], json!({ "kind": "logic", "source": "export function tick() {}" }));
    let post = made(&mut w, city, "post", &[tag], json!({ "kind": "post", "title": "Out", "text": "Now." }));
    made(&mut w, alice, "view", &[], json!({ "kind": "view", "source": "<p>mine</p>" }));
    // the code: the two public views, Maia City's by the seed's name, the other's by none, whatever it calls itself
    let code = world::public_entries(&w.lab, mac, Some(&world::CODE_KINDS[..]));
    let text = |r: &Value, k: &str| r[k].as_str().expect("a text").to_string();
    let listed = |rows: &[Value]| -> Vec<(String, String, String)> {
        rows.iter().map(|r| (text(r, "vault"), text(r, "type"), text(r, "entry"))).collect()
    };
    let (view, city_hex, fake_hex) = ("view".to_string(), city.to_hex(), fake.to_hex());
    let mut want = vec![(city_hex.clone(), view.clone(), views[0].clone()), (fake_hex, view, views[1].clone())];
    want.sort();
    assert_eq!(listed(&code), want, "the public views, by vault: no private logic, no post, nothing of Alice's own");
    let row = code.iter().find(|r| r["entry"] == views[0]).expect("Maia City's view").clone();
    let other = code.iter().find(|r| r["entry"] == views[1]).expect("the other view");
    assert_eq!((&row["seed"], &row["name"]), (&json!(world::SEED_COOP), &json!(world::SEED_COOP)));
    assert_eq!((&other["seed"], &other["name"]), (&Value::Null, &json!(world::SEED_COOP)), "a name is no seed");
    let e = EntryId::from_hex(&views[0]).expect("an entry");
    let heads = w.lab.history(mac, e).expect("its history").heads(None);
    let heads: Vec<String> = heads.iter().map(|h| h.to_hex()).collect();
    let fields = ["type", "schema", "tags", "heads"].map(|k| row[k].clone());
    let v2 = lens::VIEW_V2.id().to_hex();
    assert_eq!(fields, [json!("view"), json!(v2), json!([tag]), json!(heads)], "{row}");
    let record = json!({ "kind": "view", "title": "Holders", "note": "", "tags": [], "source": "<p>{{n}}</p>",
        "params": [], "data": { "n": 1 }, "input": {}, "form": "html", "logic": "" });
    assert_eq!(row["record"], record, "its record on main, each field it leaves out at its default");
    assert!(row["created"].is_u64());
    // of every kind, the post too, in the same order; of the kinds asked alone
    let all = world::public_entries(&w.lab, mac, None);
    want.push((city_hex, "post".to_string(), post.clone()));
    want.sort();
    assert_eq!(listed(&all), want, "every public entry, of whatever kind");
    let posts = world::public_entries(&w.lab, mac, Some(&["post", "story"][..]));
    assert_eq!(each(&json!(posts), |r| &r["entry"]), [post.clone()]);
    let schema = lens::POST_V2.id().to_hex();
    assert_eq!((&posts[0]["schema"], &posts[0]["record"]["title"]), (&json!(schema), &json!("Out")));
    assert!(world::public_entries(&w.lab, mac, Some(&["story"][..])).is_empty(), "no public story");
    // deleted, a view leaves the code and every listing
    let delete = json!({ "op": "insert", "entry": views[0], "path": ["tags"], "value": world::DELETED,
        "as": city.to_hex() });
    ok(run(&mut w, mac, delete));
    let code = world::public_entries(&w.lab, mac, Some(&world::CODE_KINDS[..]));
    assert_eq!(each(&json!(code), |r| &r["entry"]), [views[1].clone()], "the deleted view leaves");
    assert_eq!(world::public_entries(&w.lab, mac, None).len(), 2, "the post and the other view");
}

#[test]
fn a_story_is_a_kind_of_its_own_proposed_to_and_merged_by_its_title() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    // a story: its hook variants and its journey's beats as rows, its stage a flow's tag
    let hook = "The 1 decision I didn't dare to take";
    let hooks = [json!({ "id": 7, "text": hook, "dial": 3, "image_title": ["The 1 decision"] })];
    let beats = [json!({ "id": 1, "title": "Waking up", "type": "hook", "tension": 40, "link": "but" })];
    let mut value = json!({ "kind": "story", "title": "Trailer story", "format": "film", "hooks": hooks, "hook": 7 });
    value["beats"] = json!(beats);
    let create = json!({ "op": "create", "vault": alice, "type": "story", "tags": ["story:idea"], "value": value });
    let story = ok(run(&mut w, mac, create))["entry"].as_str().unwrap().to_string();
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": story, "schema": "story" })));
    assert_eq!((&got["record"]["title"], &got["record"]["hooks"][0]["dial"]), (&json!("Trailer story"), &json!(3)));
    assert_eq!(got["record"]["sparks"], json!([]), "what it doesn't hold reads as its default");
    // what doesn't fit its schema is refused: a format it doesn't know, a tension that isn't a whole number
    let bad = |v: Value| json!({ "op": "create", "vault": alice, "type": "story", "value": v });
    assert_eq!(refused(&run(&mut w, mac, bad(json!({ "kind": "story", "format": "opera" })))), "NotAView");
    let half = json!({ "kind": "story", "beats": [{ "id": 1, "tension": 0.5 }] });
    assert_eq!(refused(&run(&mut w, mac, bad(half))), "NotAView");
    // retitled on a proposal, then merged: its note page tells each line and edit by the title its record holds
    let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": story, "name": "Sharper" })))["line"].clone();
    let retitle = json!({ "op": "set", "entry": story, "line": line, "path": ["title"], "value": "The decision" });
    ok(run(&mut w, mac, retitle));
    let note = ok(run(&mut w, mac, json!({ "op": "note", "entry": story })));
    assert_eq!(note["kind"], "story");
    let titles = (&note["lines"][0]["title"], &note["lines"][1]["title"]);
    assert_eq!(titles, (&json!("Trailer story"), &json!("The decision")));
    assert_eq!(note["lines"][1]["record"]["format"], "film");
    let last = list(&note["edits"]).last().unwrap().clone();
    assert_eq!((&last["title"], &last["beforeTitle"]), (&json!("The decision"), &json!("Trailer story")));
    ok(run(&mut w, mac, json!({ "op": "merge", "entry": story, "from": line })));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": story, "schema": "story" })));
    assert_eq!(got["record"]["title"], "The decision");
}

#[test]
fn an_artifact_is_one_source_and_a_spark_a_canvas_of_them_a_story_grows_from() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let create = |ty: &str, value: Value| json!({ "op": "create", "vault": alice, "type": ty, "value": value });
    let made = |w: &mut World, op: Value| ok(run(w, mac, op))["entry"].as_str().unwrap().to_string();
    let link = |e: &str| json!({ "vault": alice, "entry": e });
    // a picture someone else posted, its Library file linked; a YouTube video with its chapters and words
    let picture = made(&mut w, create("file", json!({ "kind": "file", "title": "light.jpg", "media": "image/jpeg" })));
    let by = json!({ "name": "Ana", "url": "https://example.org/@ana", "platform": "instagram" });
    let image = json!({ "kind": "artifact", "look": "image", "title": "Morning light", "by": by, "files": [link(&picture)] });
    let image = made(&mut w, create("artifact", image));
    let mut video = json!({ "kind": "artifact", "look": "youtube", "title": "Wake up early", "duration": 612.5 });
    video["url"] = json!("https://www.youtube.com/watch?v=abc");
    video["chapters"] = json!([{ "id": 1, "t": 0, "title": "Why" }, { "id": 2, "t": 95, "title": "How" }]);
    video["transcript"] = json!([{ "id": 1, "t": 0, "text": "The light comes in at six." }]);
    let video = made(&mut w, create("artifact", video));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": image, "schema": "artifact" })));
    let defaults = (&got["record"]["note"], &got["record"]["chapters"], &got["record"]["transcript"]);
    assert_eq!(defaults, (&json!(""), &json!([]), &json!([])), "what it doesn't hold reads as its default");
    // what doesn't fit its schema is refused: a look it doesn't know, a file that isn't a link
    for odd in [json!({ "kind": "artifact", "look": "rumour" }), json!({ "kind": "artifact", "files": ["light.jpg"] })] {
        assert_eq!(refused(&run(&mut w, mac, create("artifact", odd.clone()))), "NotAView", "{odd}");
    }
    // a spark is a canvas: the two artifacts and a text note, each where it was put
    let items = json!([
        { "id": 1, "what": "artifact", "ref": link(&image), "x": 40, "y": 20, "w": 240 },
        { "id": 2, "what": "artifact", "ref": link(&video), "x": 320, "y": 20 },
        { "id": 3, "what": "text", "text": "Open on the window, then the street.", "x": 40, "y": 300 }
    ]);
    let spark = json!({ "kind": "spark", "title": "Mornings", "items": items });
    let spark = made(&mut w, create("spark", spark));
    let moved = json!({ "op": "set", "entry": spark, "path": ["items", { "id": 3 }, "y"], "value": 340 });
    ok(run(&mut w, mac, moved));
    // a query of the canvas follows its links to the artifacts on it, and on to their files
    let q = json!({ "op": "query", "where": { "path": ["title"], "eq": "Mornings" },
        "follow": [["items", "*", "ref"], ["files"]] });
    let found = ok(run(&mut w, mac, q));
    let canvas = &found["rows"][0]["record"];
    assert_eq!(canvas["items"][2]["y"], 340);
    assert_eq!(canvas["items"][0]["ref"]["to"]["title"], "Morning light");
    assert_eq!(canvas["items"][0]["ref"]["to"]["files"][0]["to"]["media"], "image/jpeg");
    assert_eq!(canvas["items"][1]["ref"]["to"]["chapters"][1]["t"], 95);
    // a note's page still reads it as a document, its record beside, its items in it
    let note = ok(run(&mut w, mac, json!({ "op": "note", "entry": spark })));
    assert_eq!((&note["kind"], &note["lines"][0]["title"]), (&json!("spark"), &json!("Mornings")));
    assert_eq!(note["lines"][0]["record"]["items"][1]["what"], "artifact");
    // a story grows from the spark
    let story = made(&mut w, create("story", json!({ "kind": "story", "title": "Trailer story", "sparks": [spark] })));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": story, "schema": "story" })));
    assert_eq!(got["record"]["sparks"], json!([spark]));
    // the world lists the spark as a note with its record, the artifacts as records of their own
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let of = |e: &str| seen["entries"].as_array().unwrap().iter().find(|x| x["entry"] == e).unwrap().clone();
    let (s, v) = (of(&spark), of(&video));
    assert_eq!((&s["kind"], &s["record"]["items"][0]["what"]), (&json!("note"), &json!("artifact")));
    assert_eq!((&v["type"], &v["record"]["look"], &v["record"]["duration"]), (&json!("artifact"), &json!("youtube"), &json!(612.5)));
}

#[test]
fn an_artwork_is_a_story_card_of_one_shape_in_layers_rendered_into_the_library() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let create = |ty: &str, value: Value| json!({ "op": "create", "vault": alice, "type": ty, "value": value });
    let made = |w: &mut World, op: Value| ok(run(w, mac, op))["entry"].as_str().unwrap().to_string();
    let link = |e: &str| json!({ "vault": alice, "entry": e });
    let hooks = json!([{ "id": 7, "text": "Nobody must work to survive" }, { "id": 8, "text": "Rent is zero" }]);
    let story = json!({ "kind": "story", "title": "Trailer story", "hooks": hooks, "hook": 7 });
    let story = made(&mut w, create("story", story));
    let face = made(&mut w, create("file", json!({ "kind": "file", "title": "face.png", "media": "image/png" })));
    // the 16:9 card: the picture, the cut-out over it, the words its hook gives
    let layers = json!([
        { "id": 1, "kind": "image", "file": link(&face), "fit": "cover", "x": 0, "y": 0, "w": 100 },
        { "id": 2, "kind": "cutout", "file": link(&face), "x": -2, "y": 8, "w": 46, "rot": -3 },
        { "id": 3, "kind": "text", "x": 48, "y": 14, "w": 48, "size": 6.2, "color": "white", "align": "left" }
    ]);
    let card = json!({ "kind": "artwork", "title": "Trailer story · 16:9", "shape": "16x9", "layers": layers });
    let mut card = card;
    card["story"] = link(&story);
    let card = made(&mut w, create("artwork", card));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": card, "schema": "artwork" })));
    assert_eq!((&got["record"]["layers"][2]["text"], &got["record"]["layers"][0]["on"]), (&json!(""), &json!(true)));
    // moved, given the other hook, and rendered: the card a file of the Library
    ok(run(&mut w, mac, json!({ "op": "set", "entry": card, "path": ["layers", { "id": 3 }, "y"], "value": 60.5 })));
    ok(run(&mut w, mac, json!({ "op": "set", "entry": card, "path": ["hook"], "value": 8 })));
    let still = json!({ "kind": "file", "title": "card-16x9.jpg", "media": "image/jpeg" });
    let still = made(&mut w, create("file", still));
    ok(run(&mut w, mac, json!({ "op": "set", "entry": card, "path": ["render"], "value": link(&still) })));
    // what doesn't fit its schema is refused: a shape it doesn't know, a picture that isn't a link
    let odd_shape = json!({ "kind": "artwork", "shape": "3x1" });
    let odd_file = json!({ "kind": "artwork", "layers": [{ "id": 1, "kind": "image", "file": "face.png" }] });
    for odd in [odd_shape, odd_file] {
        assert_eq!(refused(&run(&mut w, mac, create("artwork", odd.clone()))), "NotAView", "{odd}");
    }
    // a query of the story's cards follows their links to the pictures and the render
    let q = json!({ "op": "query", "where": { "all": [{ "type": ["artwork"] }, { "path": ["shape"], "eq": "16x9" }] },
        "follow": [["layers", "*", "file"], ["render"], ["story"]] });
    let found = ok(run(&mut w, mac, q));
    let r = &found["rows"][0]["record"];
    assert_eq!((&r["layers"][2]["y"], &r["hook"]), (&json!(60.5), &json!(8)));
    assert_eq!(r["layers"][1]["file"]["to"]["media"], "image/png");
    assert_eq!(r["render"]["to"]["title"], "card-16x9.jpg");
    assert_eq!(r["story"]["to"]["title"], "Trailer story");
}

/// An article written for a story: it links the story and says its language, and a German fork of it links the
/// same story and names the article it came from. One written under v1, as every article was before, opens in v2 as it
/// was and edits on, what v2 adds beside what v1 held.
#[test]
fn an_article_is_written_for_a_story_and_a_v1_article_edits_on_in_v2() {
    let mut w = cast::world();
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let create = |ty: &str, value: Value| json!({ "op": "create", "vault": alice, "type": ty, "value": value });
    let made = |w: &mut World, op: Value| ok(run(w, mac, op))["entry"].as_str().unwrap().to_string();
    let story = made(&mut w, create("story", json!({ "kind": "story", "title": "Trailer story" })));
    let link = json!({ "vault": alice, "entry": story });
    let value = json!({ "kind": "article", "title": "Trailer story", "text": "## The morning", "story": link,
        "language": "en", "excerpt": "A town where nobody must work to survive." });
    let article = made(&mut w, create("article", value));
    let quote = json!({ "text": "Abundance is room to breathe.", "by": "Laborde" });
    ok(run(&mut w, mac, json!({ "op": "set", "entry": article, "path": ["quote"], "value": quote })));
    let ops = json!([{ "op": "set", "path": ["language"], "value": "de" }, { "op": "set", "path": ["title"],
        "value": "Trailer story · Deutsch" }]);
    let de = ok(run(&mut w, mac, json!({ "op": "fork", "entry": article, "into": alice, "ops": ops })));
    let de = de["entry"].as_str().unwrap().to_string();
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": de, "schema": "article" })));
    let r = &got["record"];
    let said = (&r["language"], &r["story"]["entry"], &r["quote"]["by"]);
    assert_eq!(said, (&json!("de"), &json!(story), &json!("Laborde")));
    let q = json!({ "op": "query", "where": { "all": [{ "type": ["article"] }, { "path": ["language"], "eq": "de" }] },
        "follow": [["story"]] });
    let found = ok(run(&mut w, mac, q));
    assert_eq!(found["rows"][0]["record"]["story"]["to"]["title"], "Trailer story");
    // the world gives an article's record beside its title and text, so a page finds a story's articles
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let of = |e: &str| seen["entries"].as_array().unwrap().iter().find(|x| x["entry"] == e).unwrap().clone();
    let shown = of(&de);
    assert_eq!((&shown["kind"], &shown["record"]["story"]["entry"]), (&json!("note"), &json!(story)));
    assert_eq!((&shown["forkOf"], &shown["text"]), (&json!(article), &json!("## The morning")));
    assert_eq!(shown["record"].get("text"), None, "its text is the entry's, not told twice");
    // an article of v1 opens as it was, and takes its story
    let old = json!({ "kind": "article", "title": "Seeds", "text": "*Sown in March.*" });
    let v1 = lens::ARTICLE_V1.id().to_hex();
    let op = json!({ "op": "create", "vault": alice, "type": "article", "schema": v1, "value": old });
    let old = made(&mut w, op);
    ok(run(&mut w, mac, json!({ "op": "set", "entry": old, "path": ["story"], "value": link })));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": old, "schema": "article" })));
    assert_eq!((&got["record"]["text"], &got["record"]["story"]["entry"]), (&json!("*Sown in March.*"), &json!(story)));
    let as_v1 = ok(run(&mut w, mac, json!({ "op": "get", "entry": old, "schema": v1 })));
    assert_eq!(as_v1["record"].get("story"), None, "v1 reads it without what it doesn't know");
}

/// A spark written under v1, as the page wrote them before the canvas, opens in the spark app of v2 through the lens
/// avenDB ships, its title and words kept, and edits on there: the canvas's items go beside what v1 held.
#[test]
fn a_spark_of_v1_opens_on_the_canvas_and_edits_on() {
    let mut w = cast::world();
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let blocks = [json!({ "id": 1, "type": "heading", "level": 1, "text": "Morning light" })];
    let old = json!({ "kind": "spark", "title": "Morning light", "look": "video", "url": "https://example.org/1",
        "blocks": blocks });
    let op = json!({ "op": "create", "vault": alice, "type": "spark", "schema": lens::SPARK_V1.id().to_hex(), "value": old });
    let spark = ok(run(&mut w, mac, op))["entry"].as_str().unwrap().to_string();
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": spark, "schema": "spark" })));
    assert_eq!((&got["record"]["title"], &got["record"]["items"]), (&json!("Morning light"), &json!([])));
    let note = json!({ "id": 1, "what": "text", "text": "From the window.", "x": 10, "y": 10 });
    ok(run(&mut w, mac, json!({ "op": "insert", "entry": spark, "path": ["items"], "value": note })));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": spark, "schema": "spark" })));
    assert_eq!(got["record"]["items"][0]["text"], "From the window.");
    let v1 = ok(run(&mut w, mac, json!({ "op": "get", "entry": spark, "schema": lens::SPARK_V1.id().to_hex() })));
    assert_eq!(v1["record"]["url"], "https://example.org/1", "what v1 held stays");
}

#[test]
fn an_access_request_is_a_record_and_a_share_the_vault_asked_answers() {
    let mut w = cast::world();
    w.lab.sync_all(0);
    let (alice, bob, carol) = (w.alice.to_hex(), w.bob.to_hex(), w.carol.to_hex());
    let (mac, mac_b, mac_c) = (w.mac_a, w.mac_b, w.mac_c);
    let ask = |to: &str, level: &str, why: &str| json!({ "op": "ask", "to": to, "level": level, "why": why });
    // what the request schema doesn't take is refused before anything is written
    let long = "x".repeat(501);
    for odd in [ask(&bob, "Owner", "all of it"), ask(&bob, "Editor", &long), ask(&alice, "Viewer", "me")] {
        assert_eq!(refused(&run(&mut w, mac, odd)), "BadOp");
    }
    let bad = json!({ "op": "ask", "to": bob, "level": "Viewer", "vaults": ["nope"] });
    assert_eq!(refused(&run(&mut w, mac, bad)), "BadOp");
    let may = json!({ "op": "may", "ops": [ask(&bob, "Editor", "the harvest")] });
    assert_eq!(ok(run(&mut w, mac, may)), json!([true]));
    // Alice's vault asks Bob's for Editor: a record in her vault, shared with his alone
    let asked = ok(run(&mut w, mac, ask(&bob, "Editor", "  To plan the harvest together.  ")));
    let entry = asked["entry"].as_str().unwrap().to_string();
    let mine = ok(run(&mut w, mac, json!({ "op": "requests" })));
    assert_eq!(mine["asked"], json!([]));
    let made = &mine["made"][0];
    assert_eq!((&made["entry"], &made["from"], &made["to"]), (&json!(entry), &json!(alice), &json!(bob)));
    let said = (&made["level"], &made["why"], &made["vaults"], &made["answer"]);
    assert_eq!(said, (&json!("Editor"), &json!("To plan the harvest together."), &json!([]), &Value::Null));
    let get = ok(run(&mut w, mac, json!({ "op": "get", "entry": entry })));
    assert_eq!(get["record"]["kind"], "request");
    let share = ok(run(&mut w, mac, json!({ "op": "shares", "over": alice })));
    let answer = share["rows"].as_array().unwrap().iter().find(|r| r["id"] == asked["share"]).cloned();
    assert_eq!(answer.map(|r| r["name"].clone()), Some(json!(world::ANSWER)), "{share}");
    // sync carries it to Bob's Mac, which lists it to answer; Carol's sees nothing
    w.lab.sync_all(1);
    let theirs = ok(run(&mut w, mac_b, json!({ "op": "requests" })));
    assert_eq!((theirs["asked"][0]["entry"].clone(), theirs["made"].clone()), (json!(entry), json!([])));
    assert_eq!(ok(run(&mut w, mac_c, json!({ "op": "requests" }))), json!({ "asked": [], "made": [] }));
    // Bob's vault may set the answer, to granted or denied, and nothing else of it
    let set = |at: &str, value: &str| json!({ "op": "set", "entry": entry, "path": [at], "value": value, "as": bob });
    assert_eq!(refused(&run(&mut w, mac_b, set("why", "Because"))), "NotAllowed");
    assert_eq!(refused(&run(&mut w, mac_b, set("level", "Viewer"))), "NotAllowed");
    assert_eq!(refused(&run(&mut w, mac_b, set("answer", "maybe"))), "NotAView", "the schema takes no other answer");
    // it grants it: its share of the level asked to Alice's vault, and the answer
    let grant = json!({ "op": "share", "over": bob, "who": { "vault": alice }, "level": "Editor", "as": bob });
    let granted = ok(run(&mut w, mac_b, grant))["share"].clone();
    assert!(ok(run(&mut w, mac_b, set("answer", "granted")))["edit"].is_string());
    assert_eq!(ok(run(&mut w, mac_b, json!({ "op": "requests" })))["asked"], json!([]), "answered, it isn't asked");
    w.lab.sync_all(2);
    let mine = ok(run(&mut w, mac, json!({ "op": "requests" })));
    assert_eq!(mine["made"][0]["answer"], "granted");
    let shares = ok(run(&mut w, mac, json!({ "op": "world" })))["shares"].clone();
    let got = shares.as_array().unwrap().iter().find(|s| s["id"] == granted).cloned();
    assert_eq!(got.map(|s| (s["over"].clone(), s["who"].clone())), Some((json!(bob), json!(alice))));
    // Carol's vault says no: the answer alone, which Alice sees
    let to_carol = ok(run(&mut w, mac, ask(&carol, "Viewer", "Your seed list")))["entry"].clone();
    w.lab.sync_all(3);
    let deny = json!({ "op": "set", "entry": to_carol, "path": ["answer"], "value": "denied", "as": carol });
    ok(run(&mut w, mac_c, deny));
    w.lab.sync_all(4);
    let mine = ok(run(&mut w, mac, json!({ "op": "requests" })));
    let answers: Vec<(&Value, &Value)> = list(&mine["made"]).iter().map(|r| (&r["to"], &r["answer"])).collect();
    assert_eq!(answers, [(&json!(bob), &json!("granted")), (&json!(carol), &json!("denied"))]);
}

#[test]
fn lines_merge_restore_undo_and_forks_are_ops() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let mac = w.mac_a;
    let plan = hex(l.plan);
    // a proposal from the main line's heads, retitled on its own line while main is retitled too
    let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": plan, "name": "Bolder" })))["line"].clone();
    let retitle = json!({ "op": "set", "entry": plan, "line": line, "path": ["title"], "value": "The plan" });
    ok(run(&mut w, mac, retitle));
    ok(run(&mut w, mac, json!({ "op": "set", "entry": plan, "path": ["title"], "value": "Our plan" })));
    let main = |w: &World| w.lab.item(mac, l.plan).unwrap().as_document().unwrap().title;
    assert_eq!(main(&w), "Our plan");
    // the note shows the proposal against its base with main, and the conflict a merge would find
    let note = ok(run(&mut w, mac, json!({ "op": "note", "entry": plan })));
    let title = json!({ "at": ["title"], "what": "value" });
    assert_eq!(note["lines"][1]["base"]["title"], "Plan");
    let conflict = &note["lines"][1]["conflicts"][0];
    assert_eq!(conflict["at"], title["at"]);
    assert_eq!((&conflict["ours"], &conflict["theirs"]), (&json!("Our plan"), &json!("The plan")));
    // merged into the main line, taking the proposal's title there
    ok(run(&mut w, mac, json!({ "op": "merge", "entry": plan, "from": line, "take": [title] })));
    assert_eq!(main(&w), "The plan");
    let bad = json!({ "op": "merge", "entry": plan, "from": line, "take": [{ "at": ["title"], "what": "all" }] });
    assert_eq!(refused(&run(&mut w, mac, bad)), "BadOp");
    // the history names the lines and what each write is
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": plan })));
    assert_eq!(history["lines"][1]["name"], "Bolder");
    assert_eq!(each(&history["edits"], |e| &e["kind"]), ["edit", "propose", "edit", "edit", "merge"]);
    // undo the proposal's retitle, which the main line took in, then restore the version the merge made
    let edits = each(&history["edits"], |e| &e["id"]);
    ok(run(&mut w, mac, json!({ "op": "undo", "entry": plan, "edit": edits[2] })));
    assert_eq!(main(&w), "Plan");
    ok(run(&mut w, mac, json!({ "op": "restore", "entry": plan, "at": [edits[4]] })));
    assert_eq!(main(&w), "The plan");
    // a fork in the coop, tagged in the same first write, which names the note and the version it copies
    let coop = cast::coop_on(&mut w);
    let tag = [{ json!({ "op": "insert", "path": ["tags"], "value": "draft" }) }];
    let fork = json!({ "op": "fork", "entry": plan, "into": coop.to_hex(), "as": coop.to_hex(), "ops": tag });
    let made = ok(run(&mut w, mac, fork))["entry"].as_str().unwrap().to_string();
    let copy = EntryId::from_hex(&made).unwrap();
    let doc = w.lab.item(mac, copy).unwrap().as_document().unwrap();
    let at = w.lab.history(mac, l.plan).unwrap().heads(None);
    assert_eq!(at.len(), 1, "main's one latest edit, the restore");
    let mark = world::fork_mark(l.plan, &at);
    assert_eq!((doc.title, doc.tags), ("The plan".to_string(), vec![mark.clone(), "draft".to_string()]));
    assert_eq!(w.lab.history(mac, copy).unwrap().changes().len(), 1);
    // a fork of the fork names the fork, and the version of it it copies, alone
    let again = json!({ "op": "fork", "entry": made, "into": coop.to_hex(), "as": coop.to_hex() });
    let made = EntryId::from_hex(ok(run(&mut w, mac, again))["entry"].as_str().unwrap()).unwrap();
    let doc = w.lab.item(mac, made).unwrap().as_document().unwrap();
    let at = w.lab.history(mac, copy).unwrap().heads(None);
    assert_eq!(doc.tags, vec!["draft".to_string(), world::fork_mark(copy, &at)]);
    // the world says so: what each is a fork of, and at which version
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let of = |e: EntryId| seen["entries"].as_array().unwrap().iter().find(|x| x["entry"] == hex(e)).unwrap().clone();
    assert_eq!((&of(made)["forkOf"], &of(made)["forkAt"]), (&json!(hex(copy)), &json!([at[0].to_hex()])));
    assert_eq!((&of(l.plan)["forkOf"], &of(l.plan)["forkAt"]), (&Value::Null, &Value::Null));
}

#[test]
fn each_merge_into_main_is_its_next_version_and_a_pin_names_one_by_avendb_alone() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let mac = w.mac_a;
    let plan = hex(l.plan);
    let read = json!({ "op": "history", "entry": plan });
    let main = |w: &mut World| ok(run(w, mac, read.clone()))["lines"][0]["version"].clone();
    assert_eq!(main(&mut w), json!({ "version": 1, "edits": 0 }));
    // a direct edit makes no new number
    ok(run(&mut w, mac, json!({ "op": "set", "entry": plan, "path": ["title"], "value": "Our plan" })));
    assert_eq!(main(&mut w), json!({ "version": 1, "edits": 1 }));
    // a proposal merged in is v2, and v3 after it
    for title in ["The plan", "The big plan"] {
        let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": plan, "name": title })))["line"].clone();
        ok(run(&mut w, mac, json!({ "op": "set", "entry": plan, "line": line, "path": ["title"], "value": title })));
        ok(run(&mut w, mac, json!({ "op": "merge", "entry": plan, "from": line })));
    }
    assert_eq!(main(&mut w), json!({ "version": 3, "edits": 0 }));
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": plan })));
    let versions: Vec<&Value> = list(&history["lines"][0]["versions"]).iter().map(|v| &v["version"]).collect();
    assert_eq!(versions, [&json!(1), &json!(2), &json!(3)]);
    let merges: Vec<&Value> =
        list(&history["edits"]).iter().filter(|e| e["kind"] == "merge").map(|e| &e["version"]).collect();
    assert_eq!(merges, [&json!(2), &json!(3)]);
    // any version reads by its number, read-only
    let v2 = ok(run(&mut w, mac, json!({ "op": "get", "entry": plan, "version": 2 })));
    assert_eq!((&v2["record"]["title"], &v2["version"]), (&json!("The plan"), &json!({ "version": 2, "edits": 0 })));
    assert_eq!(refused(&run(&mut w, mac, json!({ "op": "get", "entry": plan, "version": 9 }))), "BadOp");
    // a pin stores the entry and the heads; all it shows comes from the history there
    let pin = ok(run(&mut w, mac, json!({ "op": "pin", "entry": plan, "at": v2["at"] })));
    assert_eq!(pin["title"], "The plan");
    assert_eq!((&pin["name"], &pin["version"]), (&json!("main"), &json!({ "version": 2, "edits": 0 })));
    assert_eq!(pin["short"], json!(plan[..8]));
    let now = ok(run(&mut w, mac, json!({ "op": "pin", "entry": plan })));
    assert_eq!((&now["title"], &now["version"]["version"]), (&json!("The big plan"), &json!(3)));
}

/// A variant is a line of the same entry that stays open beside main and follows it: a merge into main brings main
/// into every variant in the same op, keeping the variant's own value where both changed one place. Each follow is the
/// variant's next version, and the variant says which version of main it holds and whether main has gone on since.
#[test]
fn a_variant_follows_main_and_keeps_its_own_values() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let mac = w.mac_a;
    let plan = hex(l.plan);
    let silkie = ok(run(&mut w, mac, json!({ "op": "variant", "entry": plan, "name": "Silkie" })))["line"].clone();
    let retitle = |line: &Value, title: &str| json!({ "op": "set", "entry": plan, "line": line, "path": ["title"],
        "value": title });
    ok(run(&mut w, mac, retitle(&silkie, "Silkie plan")));
    let lines = |w: &mut World| ok(run(w, mac, json!({ "op": "history", "entry": plan })))["lines"].clone();
    let v = lines(&mut w)[1].clone();
    assert_eq!((&v["line"], &v["name"], &v["variant"]), (&silkie, &json!("Silkie"), &json!(true)));
    let version = |version: u64, edits: u64| json!({ "version": version, "edits": edits });
    assert_eq!((&v["version"], &v["main"]), (&version(1, 1), &version(1, 0)));
    assert_eq!((&lines(&mut w)[0]["variant"], &v["behind"]), (&json!(false), &json!(false)));
    // a proposal merged into main is main's v2, and the variant follows in the same op: main's new tag comes in, and
    // the variant keeps its own title where both changed it
    let spring = ok(run(&mut w, mac, json!({ "op": "propose", "entry": plan, "name": "Spring" })))["line"].clone();
    ok(run(&mut w, mac, retitle(&spring, "Spring plan")));
    ok(run(&mut w, mac, json!({ "op": "insert", "entry": plan, "line": spring, "path": ["tags"], "value": "spring" })));
    // the open proposal is a bare idea, the variant beside it is none
    let bare = ok(run(&mut w, mac, json!({ "op": "aips" })));
    let ideas: Vec<&Value> = list(&bare).iter().filter(|a| a["bare"] == true).flat_map(|a| list(&a["lines"])).collect();
    assert!(ideas.iter().any(|l| l["line"] == spring), "{bare}");
    assert!(ideas.iter().all(|l| l["line"] != silkie), "{bare}");
    let merged = ok(run(&mut w, mac, json!({ "op": "merge", "entry": plan, "from": spring })));
    assert_eq!(each(&merged["follows"], |f| &f["line"]), [silkie.as_str().unwrap()]);
    let v = lines(&mut w)[1].clone();
    assert_eq!((&v["version"], &v["main"]), (&version(2, 0), &version(2, 0)));
    let get = |line: &Value| json!({ "op": "get", "entry": plan, "line": line });
    let record = |w: &mut World, line: &Value| ok(run(w, mac, get(line)))["record"].clone();
    let shown = record(&mut w, &silkie);
    assert_eq!((&shown["title"], &shown["tags"]), (&json!("Silkie plan"), &json!(["spring"])));
    assert_eq!(record(&mut w, &Value::Null)["title"], "Spring plan");
    // a direct edit of main leaves it behind until the next release lands
    ok(run(&mut w, mac, json!({ "op": "set", "entry": plan, "path": ["title"], "value": "Plan" })));
    let now = lines(&mut w);
    assert_eq!((&now[1]["behind"], &now[2]["variant"]), (&json!(true), &json!(false)));
    // its start reads as a variant's, with its name; the world counts proposals and variants apart
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": plan })));
    let start = list(&history["edits"]).iter().find(|e| e["id"] == silkie).expect("the variant's start").clone();
    assert_eq!((&start["kind"], &start["name"]), (&json!("variant"), &json!("Silkie")));
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let of = list(&seen["entries"]).iter().find(|x| x["entry"] == json!(plan)).expect("the plan").clone();
    assert_eq!((&of["proposals"], &of["variants"]), (&json!(1), &json!(1)));
}

#[test]
fn every_write_names_its_acting_chain_back_to_the_passkeys_that_made_it() {
    let mut w = cast::world();
    let h = cast::handbook(&mut w);
    let (mac, alice, bob, coop) = (w.mac_a.to_hex(), w.alice.to_hex(), w.bob.to_hex(), h.coop.to_hex());
    let on = w.mac_a;
    let history = ok(run(&mut w, on, json!({ "op": "history", "entry": hex(h.welcome) })));
    // Alice's Mac wrote Welcome for the coop through Alice's vault, an owner of the coop
    let first = &history["edits"][0];
    assert_eq!(first["via"], json!([alice]));
    let links = list(&first["chain"]["links"]);
    assert_eq!(links.len(), 2);
    let device = &links[0];
    let (who, at) = (json!({ "signer": mac }), json!(alice));
    assert_eq!((&device["who"], &device["in"], &device["as"]), (&who, &at, &json!("device")));
    // her passkey, the root of her vault, signed the edit that added the Mac, and the Mac signed it too
    let passkey = json!({ "signer": w.passkey_a.to_hex(), "vault": alice, "as": "root" });
    assert!(list(&device["signers"]).contains(&passkey), "{device}");
    assert!(list(&device["signers"]).contains(&json!({ "signer": mac, "vault": alice, "as": "device" })));
    // the edit is in the database's history, the Mac's join
    let log = ok(run(&mut w, on, json!({ "op": "log" })));
    let added = list(&log["edits"]).iter().find(|e| e["id"] == device["edit"]).expect("the edit that added the Mac");
    assert_eq!((&added["kind"], &added["fields"]["device"]), (&json!("addDevice"), &json!(mac)));
    // Alice's vault owns the coop since its genesis, which both passkeys signed
    let owner = &links[1];
    let (who, at) = (json!({ "vault": alice }), json!(coop));
    assert_eq!((&owner["who"], &owner["in"], &owner["as"]), (&who, &at, &json!("owner")));
    assert_eq!(owner["edit"], json!(coop), "the coop's genesis names it");
    let roots: Vec<(&Value, &Value)> = list(&owner["signers"]).iter().map(|s| (&s["vault"], &s["as"])).collect();
    assert!(roots.contains(&(&json!(alice), &json!("root"))) && roots.contains(&(&json!(bob), &json!("root"))));
    // and who owns the coop now
    assert_eq!(first["chain"]["owners"], json!([{ "vault": alice }, { "vault": bob }]));
    // the note page shows the same chain
    let note = ok(run(&mut w, on, json!({ "op": "note", "entry": hex(h.welcome) })));
    assert_eq!((&note["edits"][0]["via"], &note["edits"][0]["chain"]), (&first["via"], &first["chain"]));
}

#[test]
fn an_aven_s_server_traces_back_to_the_vault_that_owns_the_aven() {
    let w = cast::world();
    let (alice, server, avenceo) = (w.alice.to_hex(), w.server.to_hex(), w.avenceo.to_hex());
    let chain = data::Audit::new(&w.lab, w.mac_a).chain(w.server, w.avenceo, &[]);
    let link = &chain["links"][0];
    let (who, at) = (json!({ "signer": server }), json!(avenceo));
    assert_eq!((&link["who"], &link["in"], &link["as"]), (&who, &at, &json!("device")));
    // Alice's passkey approved the server's join for avenMAIA, at the end of the seed her vault owns, and the server
    // signed it too; Maia City owns it
    let signers = list(&link["signers"]);
    assert!(signers.contains(&json!({ "signer": w.passkey_a.to_hex(), "vault": alice, "as": "root" })), "{link}");
    assert!(signers.contains(&json!({ "signer": server, "vault": avenceo, "as": "device" })));
    let st = w.lab.state(w.mac_a);
    let [Principal::Vault(city)] = st.vault(w.avenceo).expect("avenMAIA").owners[..] else { panic!("one owner") };
    assert_eq!(chain["owners"], json!([{ "vault": city.to_hex() }]));
    assert_eq!(world::seeder(st, w.avenceo), Some(w.alice), "up the seed her vault founded");
    // a signer that acts for no vault traces back to nothing
    let none = data::Audit::new(&w.lab, w.mac_a).chain(w.stranger, w.avenceo, &[]);
    assert_eq!(none["links"][0]["edit"], Value::Null);
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
        json!({ "op": "fork", "entry": hex(l.plan), "into": hex(l.plan), "ops": [{ "op": "tag", "add": [] }] }),
    ] {
        assert_eq!(refused(&run(&mut w, mac, bad.clone())), "BadOp", "{bad}");
    }
    let alice = w.alice.to_hex();
    let schemas = ok(run(&mut w, mac, json!({ "op": "schemas", "vault": alice })));
    let mut kinds = each(&schemas["schemas"], |s| &s["kind"]);
    kinds.sort();
    let own = ["aip", "aip", "article", "article", "artifact", "artwork", "bundle", "capgroup", "card", "document", "file"];
    let own = [&own[..], &["flow", "function", "function", "logic", "policy", "post", "post", "profile"]].concat();
    let own = [&own[..], &["recipe", "request"]].concat();
    let own = [&own[..], &["review", "room", "spark", "spark", "story", "story", "todo", "view", "view"]].concat();
    let two = "its own kinds, each once but the AIP's, the article's, the function's, the post's, the spark's, the story's and the view's two versions";
    assert_eq!(kinds, own, "{two}");
    assert!(list(&schemas["schemas"]).iter().all(|s| s["builtIn"] == true));
    let lenses = list(&schemas["lenses"]);
    let from = |l: &Value| (l["from"].clone(), l["builtIn"].clone());
    let older = [lens::ARTICLE_V1.id(), lens::POST_V1.id(), lens::FUNCTION_V1.id(), lens::SPARK_V1.id(), lens::STORY_V1.id(), lens::AIP_V1.id(), lens::VIEW_V1.id()];
    let older = older.map(|id| (json!(id.to_hex()), json!(true)));
    let five = "the lenses from article, post, function, spark, story, AIP and view v1 to v2";
    assert_eq!(lenses.iter().map(from).collect::<Vec<_>>(), older, "{five}");
}

/// Ops from their JSON.
fn ops_of(v: Value) -> Vec<Op> {
    rules::ops_of_json(&v).unwrap_or_else(|why| panic!("{v}: {why}"))
}

/// A share over `over` naming the ops `ops` for `who` on entry `e`.
fn on_entry(over: VaultId, who: VaultId, e: EntryId, ops: Vec<Op>) -> NewShare {
    NewShare { name: "Door".into(), ops, ..cast::share(over, cast::vault(who), Level::Write, cast::by_id(e)) }
}

/// Whether device `d`, acting for `actor`, would make each of `ops`: `true`, or the refusal's name.
fn may(w: &mut World, d: SignerId, actor: VaultId, ops: &[Value]) -> Vec<Value> {
    let answers = ok(run(w, d, json!({ "op": "may", "as": actor.to_hex(), "ops": ops })));
    list(&answers).iter().map(|a| if *a == json!(true) { a.clone() } else { a["refused"].clone() }).collect()
}

/// The writes of entry `e` device `d` holds, in the order it took them: each one's id, and whether it counts.
fn counted(w: &mut World, d: SignerId, e: EntryId) -> Vec<(String, bool)> {
    let history = ok(run(w, d, json!({ "op": "history", "entry": hex(e) })));
    let edit = |x: &Value| (x["id"].as_str().expect("an id").to_string(), x["counted"].as_bool().expect("counted"));
    list(&history["edits"]).iter().map(edit).collect()
}

fn title(w: &World, d: SignerId, e: EntryId) -> String {
    w.lab.item(d, e).and_then(|i| i.as_todo()).expect("a todo the device shows").title
}

#[test]
fn a_share_lets_whom_it_names_make_only_what_its_ops_allow() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, bob, mac, mac_b) = (w.alice, w.bob, w.mac_a, w.mac_b);
    // Alice lets Bob move the door todo along, and nothing else
    let along = ops_of(json!([{ "op": "set", "path": ["status"], "to": ["doing", "done"] }]));
    w.lab.issue(mac, &[mac], on_entry(alice, bob, l.door, along)).expect("Alice shares the door with Bob");
    w.lab.sync_all(0);
    let set = |path: &str, value: &str| json!({ "op": "set", "entry": hex(l.door), "path": [path], "value": value });
    let (done, open, retitle) = (set("status", "done"), set("status", "open"), set("title", "The door"));
    // his page asks before it offers a button: the ops answer, and nothing is made; what changes nothing writes
    // nothing, which no op refuses
    let asked = may(&mut w, mac_b, bob, &[done.clone(), retitle.clone(), open.clone()]);
    assert_eq!(asked, [json!(true), json!("NotAllowed"), json!(true)]);
    assert_eq!(cast::status(&w.lab, mac_b, l.door), Some(Status::Open));
    // what they allow is made, carrying its proof, and every reader counts it; what they don't is refused
    ok(run(&mut w, mac_b, done));
    assert_eq!(may(&mut w, mac_b, bob, &[open, set("status", "doing")]), [json!("NotAllowed"), json!(true)]);
    assert_eq!(refused(&run(&mut w, mac_b, retitle.clone())), "NotAllowed");
    w.lab.sync_all(1);
    assert_eq!(cast::status(&w.lab, mac, l.door), Some(Status::Done));
    assert!(counted(&mut w, mac, l.door).iter().all(|c| c.1));
    // a patched app that ignores the ops makes the write all the same: no reader counts it, its own device neither
    let lawless = w.lab.patched(|lab| engine::run(lab, mac_b, &retitle));
    let lawless = ok(lawless)["edit"].as_str().expect("an edit").to_string();
    w.lab.sync_all(2);
    for d in [mac, mac_b] {
        assert_eq!(counted(&mut w, d, l.door).last(), Some(&(lawless.clone(), false)));
        assert_eq!(title(&w, d, l.door), "Fix the greenhouse door");
    }
    // nor anything built on it: a write of Alice's own that a patched app of hers makes on it (C4)
    let st = w.lab.state(mac);
    let en = st.entry(l.door).expect("the door");
    let action = cast::write(alice, l.door, alice, en.stay(), st.epoch(KeyFam::Audience(alice, en.audience())));
    let on_it = w.lab.tamper(mac, Tamper::Unchecked { signers: vec![mac], action }).expect("Alice's Mac takes it");
    // her Mac signs it as it signs every write of its own, so only what it builds on keeps it from counting
    assert!(w.lab.history(mac, l.door).and_then(|h| h.get(on_it)).is_some_and(|c| !c.counted));
    assert_eq!(counted(&mut w, mac, l.door).last(), Some(&(on_it.to_hex(), false)));
    // what Alice's app writes builds on the writes her readers count, and counts
    ok(run(&mut w, mac, set("title", "Fix the door, again")));
    w.lab.sync_all(3);
    for d in [mac, mac_b] {
        assert_eq!(title(&w, d, l.door), "Fix the door, again");
        assert_eq!(counted(&mut w, d, l.door).last().map(|c| c.1), Some(true));
    }
}

/// C1: a share resting on an owner share is held to the owner share's ops as well as its own.
#[test]
fn c1_a_share_resting_on_an_owner_share_is_held_to_both() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let coop = cast::coop_on(&mut w);
    let (alice, carol, dave) = (w.alice, w.carol, w.dave);
    let (mac, mac_b, mac_c, mac_d) = (w.mac_a, w.mac_b, w.mac_c, w.mac_d);
    // the coop may change the door's status and title, and share it on
    let owner = json!([{ "op": "set", "path": ["status"] }, { "op": "set", "path": ["title"] }, { "op": "share" }]);
    let owner = ops_of(owner);
    let owner = on_entry(alice, coop, l.door, owner);
    let owner = w.lab.issue(mac, &[w.passkey_a], owner).expect("Alice's passkey gives the coop the door");
    w.lab.sync_all(0);
    // acting for the coop, Bob lets Dave retitle it, and Carol edit it as an Editor
    let retitle = ops_of(json!([{ "op": "set", "path": ["title"] }]));
    let to_dave = cast::share_on(alice, cast::vault(dave), Level::Write, cast::by_id(l.door), owner, coop);
    w.lab.issue(mac_b, &[mac_b], NewShare { ops: retitle, ..to_dave }).expect("Bob gives Dave a cap that retitles");
    let to_carol = cast::share_on(alice, cast::vault(carol), Level::Write, cast::by_id(l.door), owner, coop);
    w.lab.issue(mac_b, &[mac_b], to_carol).expect("and Carol an Editor one");
    w.lab.sync_all(1);
    let set = |path: &str, value: &str| json!({ "op": "set", "entry": hex(l.door), "path": [path], "value": value });
    let asks = [set("status", "doing"), set("title", "The greenhouse door"), set("notes", "Oil the hinges")];
    let no = json!("NotAllowed");
    assert_eq!(may(&mut w, mac_b, coop, &asks), [json!(true), json!(true), no.clone()]);
    assert_eq!(may(&mut w, mac_d, dave, &asks), [no.clone(), json!(true), no.clone()]);
    assert_eq!(may(&mut w, mac_c, carol, &asks), [json!(true), json!(true), no]);
    // what they make reaches every reader, and counts
    ok(run(&mut w, mac_d, set("title", "The greenhouse door")));
    ok(run(&mut w, mac_c, set("status", "doing")));
    w.lab.sync_all(2);
    for d in [mac, mac_b, mac_c, mac_d] {
        assert_eq!(title(&w, d, l.door), "The greenhouse door");
        assert_eq!(cast::status(&w.lab, d, l.door), Some(Status::Doing));
        assert!(counted(&mut w, d, l.door).iter().all(|c| c.1));
    }
}

#[test]
fn a_share_that_only_suggests_writes_on_proposals_an_owner_merges() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, carol, mac, mac_c) = (w.alice, w.carol, w.mac_a, w.mac_c);
    // Carol may start proposals of the plan, change anything on them and bring the main line into them
    let suggest = json!([
        { "op": "propose" },
        { "op": "set", "path": [], "on": "proposals" },
        { "op": "merge", "on": "proposals" },
    ]);
    w.lab.issue(mac, &[mac], on_entry(alice, carol, l.plan, ops_of(suggest))).expect("Alice lets Carol suggest");
    w.lab.sync_all(0);
    let plan = hex(l.plan);
    let retitle = |line: &Value| {
        json!({ "op": "set", "entry": plan, "line": line, "path": ["title"], "value": "Spring plan" })
    };
    assert_eq!(refused(&run(&mut w, mac_c, retitle(&Value::Null))), "NotAllowed");
    let line = ok(run(&mut w, mac_c, json!({ "op": "propose", "entry": plan, "name": "Spring" })))["line"].clone();
    ok(run(&mut w, mac_c, retitle(&line)));
    let beans = json!({ "id": 3, "type": "paragraph", "text": "Sow beans" });
    ok(run(&mut w, mac_c, json!({ "op": "insert", "entry": plan, "line": line, "path": ["blocks"], "value": beans })));
    // Alice adds to the main line, which Carol brings into her proposal; she can't merge it back herself
    ok(run(&mut w, mac, json!({ "op": "tag", "entry": plan, "add": ["spring"] })));
    let body = json!({ "op": "set", "entry": plan, "path": ["blocks", { "id": 2 }, "text"], "value": "Spring first." });
    ok(run(&mut w, mac, body));
    w.lab.sync_all(1);
    ok(run(&mut w, mac_c, json!({ "op": "merge", "entry": plan, "from": null, "into": line })));
    let merge = json!({ "op": "merge", "entry": plan, "from": line });
    assert_eq!(refused(&run(&mut w, mac_c, merge.clone())), "NotAllowed");
    // Alice's readers count the proposal, and she merges it
    w.lab.sync_all(2);
    assert!(counted(&mut w, mac, l.plan).iter().all(|c| c.1));
    assert_eq!(w.lab.item(mac, l.plan).unwrap().as_document().unwrap().title, "Plan");
    ok(run(&mut w, mac, merge));
    w.lab.sync_all(3);
    for d in [mac, mac_c] {
        let doc = w.lab.item(d, l.plan).unwrap().as_document().unwrap();
        let texts: Vec<&str> = doc.blocks.iter().map(|b| b.text.as_str()).collect();
        assert_eq!((doc.title.as_str(), texts), ("Spring plan", vec!["Plan", "Spring first.", "Sow beans"]));
    }
}

/// A code entry of each kind, as JSON: its title, note and tags, its source, its engine and manifest, a param, its
/// contract, and for a recipe its card.
fn code_entry(kind: &str) -> Value {
    let (host, manifest) = match kind {
        "recipe" => ("box", json!({ "kit": ["box", "cylinder"], "presets": ["brass"], "controls": ["slider"] })),
        "view" => ("view", json!({ "messages": ["state", "resize"], "slots": ["panel"], "libs": ["d3"] })),
        "function" => ("logic", json!({ "ops": ["tag", "set"] })),
        _ => ("logic", json!({ "hooks": ["tick", "trade"], "ops": ["set"] })),
    };
    let mut entry = json!({
        "kind": kind, "title": format!("A {kind}"), "note": "Made for the test.", "tags": ["code"],
        "source": format!("// the {kind}\nexport default (x) => x;"),
        "engine": { "host": host, "version": 4, "hash": "ab".repeat(32) },
        "manifest": manifest,
        "params": [{ "id": 1, "name": "height", "kind": "number", "range": { "min": 0.2, "max": 2, "step": 0.1 },
            "default": 0.6 }, { "id": 2, "name": "lit", "kind": "toggle", "default": 1 }],
        "contract": { "budgets": { "bytes": 200000, "ms": 2000, "memory": 64000000 }, "invariants": ["replay-equal"] },
    });
    if kind == "recipe" {
        entry["card"] = json!({ "format": "asset-card", "v": 1, "group": "machines", "label": "Lamp", "size": [0.3, 0.6, 0.3] });
    }
    if kind == "function" {
        let o = entry.as_object_mut().expect("an object");
        for k in ["title", "note", "source", "params", "contract"] {
            o.remove(k);
        }
        entry["name"] = json!("Tidy");
        entry["code"] = json!("return [];");
    }
    entry
}

/// Code as entries (Scion B): recipes, views and logic, one base each with what a host needs to run it, and a function
/// of v2 with an engine and a manifest. Each reads back as written; a source longer than its schema lets it be, an
/// engine of no host, a param of no kind, a manifest naming what no host knows or a card that is no object fits none;
/// a function written under v1 opens through the shipped lens and edits on in v2.
#[test]
fn code_entries_are_kinds_of_their_own() {
    let mut w = cast::world();
    let (mac, alice) = (w.mac_a, w.alice.to_hex());
    let create = |kind: &str, value: Value| json!({ "op": "create", "vault": alice, "type": kind, "value": value });
    for kind in ["recipe", "view", "logic", "function"] {
        let made = ok(run(&mut w, mac, create(kind, code_entry(kind))));
        let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": made["entry"], "schema": kind })));
        let mut want = code_entry(kind);
        if kind == "function" {
            for (k, v) in [("about", json!("")), ("on", json!("enter")), ("flow", json!("")), ("stage", json!(""))] {
                want[k] = v;
            }
            want["enabled"] = json!(true);
        }
        if kind == "view" {
            // a view of v2: what it wasn't given reads at its defaults, and it has no height until one is set
            for (k, v) in [("data", json!({})), ("input", json!({})), ("form", json!("html")), ("logic", json!(""))] {
                want[k] = v;
            }
        }
        assert_eq!(got["record"], want, "{kind}");
    }
    let with = |kind: &str, change: &dyn Fn(&mut Value)| {
        let mut v = code_entry(kind);
        change(&mut v);
        v
    };
    let bad = [
        ("logic", with("logic", &|v| v["source"] = json!("x".repeat(200_001)))),
        ("view", with("view", &|v| v["engine"]["host"] = json!("gpu"))),
        ("recipe", with("recipe", &|v| v["engine"] = json!({ "host": "box", "version": 4 }))),
        ("logic", with("logic", &|v| v["params"][0]["kind"] = json!("slider"))),
        ("logic", with("logic", &|v| v["params"][0]["default"] = json!("tall"))),
        ("view", with("view", &|v| v["manifest"]["net"] = json!(["fetch"]))),
        ("recipe", with("recipe", &|v| v["card"] = json!("lamp.json"))),
        ("function", with("function", &|v| v["manifest"] = json!({ "kit": "box" }))),
    ];
    for (kind, value) in bad {
        assert_eq!(refused(&run(&mut w, mac, create(kind, value.clone()))), "NotAView", "{kind}: {value}");
    }
    // a function written under v1 reads in v2, with no engine and no manifest, and takes one on
    let v1 = json!({ "kind": "function", "name": "Publish", "code": "return [];" });
    let v1 = json!({ "op": "create", "vault": alice, "type": "function", "schema": lens::FUNCTION_V1.id().to_hex(),
        "value": v1 });
    let made = ok(run(&mut w, mac, v1))["entry"].clone();
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": made })));
    assert_eq!((got["record"]["name"].as_str(), got["record"].get("engine")), (Some("Publish"), None));
    let engine = json!({ "host": "logic", "version": 4, "hash": "cd".repeat(32) });
    ok(run(&mut w, mac, json!({ "op": "set", "entry": made, "path": ["engine"], "value": engine })));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": made })));
    assert_eq!((&got["record"]["engine"], got["record"]["code"].as_str()), (&engine, Some("return [];")));
}

/// A coop Alice's vault founds and owns alone, nonce `nonce`, approved by her passkey.
fn coop_of_alice(w: &mut World, nonce: u64) -> VaultId {
    let owners = vec![Principal::Vault(w.alice)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
    VaultId::from(w.lab.submit(w.mac_a, &[w.passkey_a], genesis).expect("Alice's vault founds a coop"))
}

/// A vault founded before views had a v2 holds the schemas and lenses avenDB shipped then, as Maia City held them
/// (the page's `standardize`), and neither View v2 nor its lens: `create` naming `"view"` makes a view of v2 there all
/// the same, as every app reads through its own shipped schemas beside the vault's lane (`Lane::with_built_ins`), and
/// a view of v1 written before opens in v2 through the shipped lens and edits on. The vault's database shows the two
/// among the built-in ones it doesn't hold, which the founder's page adds as it adds every one it lacks; once they are
/// in its lane, every view reads as before.
#[test]
fn a_vault_founded_before_views_of_v2_makes_them_all_the_same() {
    let mut w = cast::world();
    let mac = w.mac_a;
    let old = coop_of_alice(&mut w, 21);
    let v = old.to_hex();
    let new = [lens::blobs::VIEW_V2, lens::blobs::VIEW_LENS];
    let schemas = lens::blobs::SHIPPED.iter().map(|b| ("schema", *b));
    let then = schemas.chain(lens::blobs::LENSES.iter().map(|b| ("lens", *b)));
    for (ty, blob) in then.filter(|(_, b)| !new.contains(b)) {
        ok(run(&mut w, mac, json!({ "op": "create", "vault": v, "type": ty, "value": blob, "as": v })));
    }
    let lane = w.lab.lane(mac, old);
    assert!(lane.schema(lens::VIEW_V1.id()).is_some() && lane.schema(lens::VIEW_V2.id()).is_none(), "the old set");
    // a view of v1, as an app before v2 wrote one
    let v1 = json!({ "kind": "view", "title": "Holders", "source": "<p>{{n}}</p>" });
    let v1 = json!({ "op": "create", "vault": v, "type": "view", "schema": lens::VIEW_V1.id().to_hex(), "value": v1,
        "as": v });
    let holders = ok(run(&mut w, mac, v1))["entry"].clone();
    // a view of v2, by the built-in name, as the page and an aven ask for one
    let value = json!({ "kind": "view", "title": "Wants", "source": "{\"root\": \"list\"}", "form": "a2ui",
        "data": { "wants": [] }, "input": { "slot": "board" }, "height": 300,
        "logic": "export function on(e, d) { return d; }" });
    let create = json!({ "op": "create", "vault": v, "type": "view", "schema": "view", "value": value, "as": v });
    let wants = ok(run(&mut w, mac, create))["entry"].clone();
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": wants })));
    let v2 = lens::VIEW_V2.id().to_hex();
    assert_eq!((&got["schema"], &got["authored"]), (&json!(v2), &json!([v2])), "written and read under v2");
    for k in ["form", "data", "input", "height", "logic", "source"] {
        assert_eq!(got["record"][k], value[k], "{k}");
    }
    assert!(w.lab.lane(mac, old).schema(lens::VIEW_V2.id()).is_none(), "the app's own copy reads it");
    // the view of v1 opens in v2, at v2's defaults, and takes a height
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": holders })));
    assert_eq!((&got["schema"], &got["readOnly"]), (&json!(v2), &json!(false)), "through the shipped lens");
    assert_eq!((&got["record"]["form"], &got["record"]["source"]), (&json!("html"), &json!("<p>{{n}}</p>")));
    ok(run(&mut w, mac, json!({ "op": "set", "entry": holders, "path": ["height"], "value": 420, "as": v })));
    // what the founder's page adds, as it adds every built-in one the vault lacks: View v2 and its lens, schema first
    let db = ok(run(&mut w, mac, json!({ "op": "database", "vault": v })));
    let ids = |xs: &Value| each(xs, |x| &x["id"]);
    let missing = |all: &Value, held: &Value| -> Vec<String> {
        let held = ids(held);
        ids(all).into_iter().filter(|id| !held.contains(id)).collect()
    };
    let lacks = (missing(&db["builtIn"]["schemas"], &db["schemas"]), missing(&db["builtIn"]["lenses"], &db["lenses"]));
    assert_eq!(lacks, (vec![v2.clone()], vec![lens::VIEW_LENS.id().to_hex()]), "View v2 and its lens alone");
    for (ty, blob) in [("schema", lens::blobs::VIEW_V2), ("lens", lens::blobs::VIEW_LENS)] {
        ok(run(&mut w, mac, json!({ "op": "create", "vault": v, "type": ty, "value": blob, "as": v })));
    }
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": holders })));
    assert_eq!((&got["schema"], &got["record"]["height"]), (&json!(v2), &json!(420)), "read as before");
    assert_eq!(ok(run(&mut w, mac, json!({ "op": "get", "entry": wants })))["record"]["form"], "a2ui");
}

/// M1 (merges by path) and M2 (merges by policy): a tuner may merge into main only a line Alice accepted, whose changes
/// since their base all lie under its merge's path, the defaults of the params. Its merge of a proposal that only
/// tunes counts once she accepts it; of one that changes the source too, its device refuses, accepted or not, a patched
/// app's counts for no reader, and an owner merges it as ever.
#[test]
fn a_tuner_merges_new_defaults_and_nothing_else() {
    let mut w = cast::world();
    let (alice, bob, mac, mac_b) = (w.alice, w.bob, w.mac_a, w.mac_b);
    // a lamp's logic, a code entry: its source and a param it reads
    let lamp = json!({ "kind": "logic", "source": "glow(brightness)",
        "params": [{ "id": 1, "name": "brightness", "kind": "number", "range": { "min": 0, "max": 10 }, "default": 2 }] });
    let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": alice.to_hex(), "type": "logic", "value": lamp })));
    let e = EntryId::from_hex(made["entry"].as_str().expect("its id")).expect("an entry");
    let tuner = ops_of(json!([
        { "op": "propose" },
        { "op": "set", "path": [], "on": "proposals" },
        { "op": "merge", "on": "main", "path": ["params", "*", "default"] },
    ]));
    w.lab.issue(mac, &[mac], on_entry(alice, bob, e, tuner)).expect("Alice lets Bob tune the lamp");
    w.lab.sync_all(0);
    let lamp = hex(e);
    let set = |line: &Value, path: Value, value: Value| {
        json!({ "op": "set", "entry": lamp, "line": line, "path": path, "value": value })
    };
    let brightness = json!(["params", { "id": 1 }, "default"]);
    let main = |w: &mut World, d: SignerId| ok(run(w, d, json!({ "op": "get", "entry": hex(e) })))["record"].clone();
    // a proposal that only tunes: Bob merges it once Alice accepts it, and every reader counts the merge
    let tune = ok(run(&mut w, mac_b, json!({ "op": "propose", "entry": lamp, "name": "Brighter" })))["line"].clone();
    ok(run(&mut w, mac_b, set(&tune, brightness.clone(), json!(3))));
    let merge_tune = json!({ "op": "merge", "entry": lamp, "from": tune });
    assert_eq!(refused(&run(&mut w, mac_b, merge_tune.clone())), "NotAccepted");
    w.lab.sync_all(1);
    let accept = |line: &Value| json!({ "op": "review", "entry": lamp, "line": line, "verdict": "accepted" });
    ok(run(&mut w, mac, accept(&tune)));
    w.lab.sync_all(1);
    ok(run(&mut w, mac_b, merge_tune));
    w.lab.sync_all(1);
    for d in [mac, mac_b] {
        assert!(counted(&mut w, d, e).iter().all(|c| c.1));
        assert_eq!(main(&mut w, d)["params"][0]["default"], 3);
    }
    // a proposal that changes the source too: his device refuses his merge, into main or into another proposal
    let rewrite = ok(run(&mut w, mac_b, json!({ "op": "propose", "entry": lamp, "name": "Rewrite" })))["line"].clone();
    ok(run(&mut w, mac_b, set(&rewrite, brightness.clone(), json!(5))));
    ok(run(&mut w, mac_b, set(&rewrite, json!(["source"]), json!("flash(brightness)"))));
    w.lab.sync_all(2);
    ok(run(&mut w, mac, accept(&rewrite)));
    w.lab.sync_all(2);
    let merge = json!({ "op": "merge", "entry": lamp, "from": rewrite });
    assert_eq!(refused(&run(&mut w, mac_b, merge.clone())), "NotAllowed");
    let other = ok(run(&mut w, mac_b, json!({ "op": "propose", "entry": lamp, "name": "Other" })))["line"].clone();
    let sideways = json!({ "op": "merge", "entry": lamp, "from": rewrite, "into": other });
    assert_eq!(refused(&run(&mut w, mac_b, sideways)), "NotAllowed");
    // a patched app makes it all the same, and no reader counts it: main keeps the tuned lamp
    let patched = w.lab.patched(|lab| engine::run(lab, mac_b, &merge));
    let patched = ok(patched)["edit"].as_str().expect("its id").to_string();
    w.lab.sync_all(2);
    for d in [mac, mac_b] {
        assert_eq!(counted(&mut w, d, e).last(), Some(&(patched.clone(), false)));
        let record = main(&mut w, d);
        assert_eq!((record["source"].as_str(), &record["params"][0]["default"]), (Some("glow(brightness)"), &json!(3)));
    }
    // Alice merges anything
    ok(run(&mut w, mac, merge));
    w.lab.sync_all(3);
    for d in [mac, mac_b] {
        let record = main(&mut w, d);
        assert_eq!((record["source"].as_str(), &record["params"][0]["default"]), (Some("flash(brightness)"), &json!(5)));
    }
}

/// The edits of entry `e` device `d` holds, by their ids: each one's kind, whether it counts and why not.
fn edits_of(w: &mut World, d: SignerId, e: EntryId) -> Vec<(String, String, bool, Value)> {
    let history = ok(run(w, d, json!({ "op": "history", "entry": hex(e) })));
    let edit = |x: &Value| {
        let id = x["id"].as_str().expect("an id").to_string();
        (id, x["kind"].as_str().expect("its kind").to_string(), x["counted"] == true, x["why"].clone())
    };
    list(&history["edits"]).iter().map(edit).collect()
}

/// M2 (merges by policy): a merge into main through a share counts only on top of the vault's accept, every vault's
/// default policy being one of its owners. Bob, an editor of Alice's plan, proposes; his device refuses his merge
/// until Alice accepts by a review, which writes her accept on the proposal and a review record in her vault, and a
/// patched app's counts for no reader. Asking him to revise writes the review alone; what he writes on the proposal
/// after her accept she accepts again; only the vault reviews; and Alice merges as ever, with no review.
#[test]
fn a_merge_into_main_through_a_share_counts_on_top_of_the_vaults_accept() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, bob, mac, mac_b) = (w.alice, w.bob, w.mac_a, w.mac_b);
    let editor = on_entry(alice, bob, l.plan, Level::Write.ops());
    w.lab.issue(mac, &[mac], editor).expect("Alice makes Bob an editor of the plan");
    w.lab.sync_all(0);
    let plan = hex(l.plan);
    let retitle = |line: &Value, title: &str| {
        json!({ "op": "set", "entry": plan, "line": line, "path": ["title"], "value": title })
    };
    let line = ok(run(&mut w, mac_b, json!({ "op": "propose", "entry": plan, "name": "Spring" })))["line"].clone();
    ok(run(&mut w, mac_b, retitle(&line, "Spring plan")));
    let merge = json!({ "op": "merge", "entry": plan, "from": line });
    assert_eq!(may(&mut w, mac_b, bob, std::slice::from_ref(&merge)), [json!("NotAccepted")]);
    assert_eq!(refused(&run(&mut w, mac_b, merge.clone())), "NotAccepted");
    // a patched app merges all the same, and no reader counts it: the policy holds it back
    let patched = w.lab.patched(|lab| engine::run(lab, mac_b, &merge));
    let patched = ok(patched)["edit"].as_str().expect("its id").to_string();
    w.lab.sync_all(1);
    for d in [mac, mac_b] {
        let last = edits_of(&mut w, d, l.plan).pop().expect("the patched merge");
        assert_eq!(last, (patched.clone(), "merge".into(), false, json!("policy")));
        assert_eq!(w.lab.item(d, l.plan).unwrap().as_document().unwrap().title, "Plan");
    }
    // only the vault answers; asking Bob to revise writes the review alone, which accepts nothing
    let review = |line: &Value, verdict: &str| json!({ "op": "review", "entry": plan, "line": line, "verdict": verdict,
        "text": "Say which spring" });
    assert_eq!(refused(&run(&mut w, mac_b, review(&line, "accepted"))), "NoCap");
    assert_eq!(refused(&run(&mut w, mac, review(&Value::Null, "accepted"))), "BadOp");
    assert_eq!(refused(&run(&mut w, mac, review(&line, "maybe"))), "BadOp");
    let heads = ok(run(&mut w, mac, json!({ "op": "get", "entry": plan, "line": line })))["heads"].clone();
    let revise = ok(run(&mut w, mac, review(&line, "revise")));
    assert_eq!(revise["accept"], Value::Null);
    let record = ok(run(&mut w, mac, json!({ "op": "get", "entry": revise["review"] })))["record"].clone();
    let asked = json!({ "kind": "review", "entry": plan, "line": line, "heads": heads, "by": bob.to_hex(),
        "verdict": "revise", "text": "Say which spring", "at": 0 });
    assert_eq!(record, asked, "a review in Alice's vault, of the version she answered");
    w.lab.sync_all(2);
    assert_eq!(refused(&run(&mut w, mac_b, merge.clone())), "NotAccepted");
    // she accepts: a write of her vault on the proposal that changes nothing, and the review names the version it makes
    let yes = ok(run(&mut w, mac, review(&line, "accepted")));
    let accept = yes["accept"].as_str().expect("her accept").to_string();
    let record = ok(run(&mut w, mac, json!({ "op": "get", "entry": yes["review"] })))["record"].clone();
    assert_eq!((&record["verdict"], &record["heads"]), (&json!("accepted"), &json!([accept])));
    w.lab.sync_all(3);
    for d in [mac, mac_b] {
        let last = edits_of(&mut w, d, l.plan).pop().expect("her accept");
        assert_eq!(last, (accept.clone(), "accept".into(), true, Value::Null));
    }
    // Bob's merge on top of it counts for every reader
    ok(run(&mut w, mac_b, merge.clone()));
    w.lab.sync_all(4);
    for d in [mac, mac_b] {
        assert_eq!(w.lab.item(d, l.plan).unwrap().as_document().unwrap().title, "Spring plan");
        assert!(edits_of(&mut w, d, l.plan).iter().filter(|x| x.0 != patched).all(|x| x.2));
    }
    // what he writes on the proposal after her accept, his merge can't bring in; Alice merges it herself, no review
    ok(run(&mut w, mac_b, retitle(&line, "Spring plan, v2")));
    assert_eq!(refused(&run(&mut w, mac_b, merge.clone())), "NotAccepted");
    w.lab.sync_all(5);
    ok(run(&mut w, mac, merge));
    w.lab.sync_all(6);
    for d in [mac, mac_b] {
        assert_eq!(w.lab.item(d, l.plan).unwrap().as_document().unwrap().title, "Spring plan, v2");
    }
}

/// A bundle links proposals on several entries, and a policy declares who accepts: version 1 holds one policy alone,
/// one of the vault's owners, which every vault counts by.
#[test]
fn bundles_and_policies_are_records_of_their_own() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, mac) = (w.alice, w.mac_a);
    let (plan, door) = (hex(l.plan), hex(l.door));
    let spring = ok(run(&mut w, mac, json!({ "op": "propose", "entry": plan, "name": "Spring" })))["line"].clone();
    let hinge = ok(run(&mut w, mac, json!({ "op": "propose", "entry": door, "name": "Hinge" })))["line"].clone();
    let link = |e: &str| json!({ "vault": alice.to_hex(), "entry": e });
    let bundle = json!({ "kind": "bundle", "title": "Spring", "intent": link(&plan), "proposals": [
        { "id": 1, "entry": link(&plan), "line": spring },
        { "id": 2, "entry": link(&door), "line": hinge },
    ] });
    let create =
        |ty: &str, value: &Value| json!({ "op": "create", "vault": alice.to_hex(), "type": ty, "value": value });
    let made = ok(run(&mut w, mac, create("bundle", &bundle)))["entry"].clone();
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": made })))["record"].clone();
    assert_eq!((&got["proposals"][1]["line"], &got["proposals"][0]["entry"]), (&hinge, &link(&plan)));
    let owners = json!({ "kind": "policy", "title": "One owner", "needs": { "of": "owners", "count": 1 } });
    ok(run(&mut w, mac, create("policy", &owners)));
    let wrong = [json!({ "of": "owners", "count": 2 }), json!({ "of": "avens", "count": 1 }), json!({ "of": "owners" })];
    for needs in wrong {
        let value = json!({ "kind": "policy", "needs": needs });
        assert_eq!(refused(&run(&mut w, mac, create("policy", &value))), "NotAView", "{value}");
    }
    let bad = json!({ "kind": "bundle", "proposals": [{ "id": 1, "entry": "plan", "line": spring }] });
    assert_eq!(refused(&run(&mut w, mac, create("bundle", &bad))), "NotAView");
}

/// S3: a write whose record breaks the schemas its entry was written under counts for no reader, nor anything built
/// on it; a device refuses to make one, and one a patched app makes all the same changes no record anyone shows.
#[test]
fn s3_a_write_that_breaks_its_schema_counts_for_no_reader() {
    let mut w = cast::world();
    let t = cast::todos_on(&mut w);
    w.lab.sync_all(0);
    let (bob, mac, mac_b, mac_c) = (w.bob, w.mac_a, w.mac_b, w.mac_c);
    let door = hex(t.door);
    let status = |value: &str| json!({ "op": "set", "entry": door, "path": ["status"], "value": value });
    ok(run(&mut w, mac_b, status("doing")));
    // what Bob's Mac would write for an app that breaks the todo's schema: a status it doesn't take, a todo of no
    // kind, a field it doesn't name, or the todo retitled through the schema of a document, another kind
    let record = w.lab.item(mac_b, t.door).expect("the door").record();
    let with = |change: &dyn Fn(&mut Value)| {
        let mut r = record.clone();
        change(&mut r);
        r
    };
    let later = with(&|r| r["status"] = json!("later"));
    let kindless = with(&|r| drop(r.as_object_mut().expect("a record").remove("kind")));
    let colour = with(&|r| r["colour"] = json!("red"));
    for bad in [&later, &kindless, &colour] {
        assert_eq!(w.lab.edit(mac_b, bob, t.door, |item| item.put_record(bad)), Err(Refusal::NotAView), "{bad}");
    }
    let retitled = with(&|r| r["title"] = json!("The door"));
    let document = w.lab.edit(mac_b, bob, t.door, |item| item.set_record(View::document_v1(), &retitled));
    assert_eq!(document, Err(Refusal::NotAView));
    assert_eq!(may(&mut w, mac_b, bob, &[status("later")]), [json!("NotAView")]);
    // a patched app makes one all the same: no reader counts it, its own device neither, and each keeps the last
    // record that fit
    let patched = w.lab.patched(|lab| lab.edit(mac_b, bob, t.door, |item| item.put_record(&later)));
    let patched = patched.expect("a patched app makes it").to_hex();
    w.lab.sync_all(1);
    for d in [mac, mac_b, mac_c] {
        assert_eq!(counted(&mut w, d, t.door).last(), Some(&(patched.clone(), false)));
        assert_eq!(w.lab.item(d, t.door).expect("the door").record()["status"], "doing");
    }
    // the latest write each device holds, why it doesn't count, and how many lines it shows
    let latest = |w: &mut World, d| {
        let history = ok(run(w, d, json!({ "op": "history", "entry": door })));
        let last = list(&history["edits"]).last().expect("its writes").clone();
        (last["id"].clone(), last["why"].clone(), list(&history["lines"]).len())
    };
    assert_eq!(latest(&mut w, mac), (json!(patched), json!("unfit"), 1));
    // nor anything built on it: a proposal Bob starts from that version
    let from = json!({ "op": "propose", "entry": door, "from": [patched], "name": "Later" });
    let started = ok(run(&mut w, mac_b, from))["edit"].clone();
    w.lab.sync_all(2);
    for d in [mac, mac_b, mac_c] {
        assert_eq!(latest(&mut w, d), (started.clone(), json!("builds-on"), 1));
    }
    // what Bob's app writes next builds on the writes his readers count, and counts
    ok(run(&mut w, mac_b, status("done")));
    w.lab.sync_all(3);
    for d in [mac, mac_b, mac_c] {
        assert_eq!(cast::status(&w.lab, d, t.door), Some(Status::Done));
        assert_eq!(counted(&mut w, d, t.door).last().map(|c| c.1), Some(true));
    }
}

/// An outline: nodes, each with a text and the nodes under it, at any depth.
const OUTLINE: &str = r##"{ "title": "Outline", "type": "object",
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

/// An outline `depth` nodes deep, one under the other, as an app on it sees it.
fn chain(depth: usize) -> Value {
    let mut nodes = json!([]);
    for i in (0..depth).rev() {
        nodes = json!([{ "id": i as i64 + 1, "text": "", "kids": nodes }]);
    }
    json!({ "kind": "outline", "title": "", "nodes": nodes })
}

/// Alice's outline schema, in her lane, and an outline of hers made on her Mac: `(entry, schema)`.
fn alices_outline(w: &mut World) -> (EntryId, Schema) {
    let (alice, mac) = (w.alice.to_hex(), w.mac_a);
    ok(run(w, mac, json!({ "op": "create", "vault": alice, "type": "schema", "value": OUTLINE })));
    let value = json!({ "kind": "outline", "title": "Garden" });
    let made = ok(run(w, mac, json!({ "op": "create", "vault": alice, "type": "note", "value": value })));
    let entry = EntryId::from_hex(made["entry"].as_str().expect("its id")).expect("an entry");
    (entry, Schema::parse(OUTLINE.as_bytes()).expect("a schema"))
}

/// The ceiling (`lens::CEILING`): a write whose rows reach deeper than 256 counts for no reader, whatever its schema
/// says, and a device refuses to make one; a write as deep as the ceiling counts. Every reader reaches the same
/// verdict, as the ceiling is fixed.
#[test]
fn a_write_deeper_than_the_ceiling_counts_for_no_reader() {
    let mut w = cast::world();
    let (alice, mac, phone) = (w.alice, w.mac_a, w.phone_a);
    let (outline, schema) = alices_outline(&mut w);
    let view = View::plain(&schema);
    // as deep as the ceiling: it counts, on both of Alice's devices
    let deepest = chain(lens::CEILING);
    w.lab.edit(mac, alice, outline, |item| item.set_record(&view, &deepest)).expect("it fits");
    w.lab.sync_all(0);
    for d in [mac, phone] {
        assert_eq!(counted(&mut w, d, outline).last().map(|c| c.1), Some(true));
        assert_eq!(w.lab.item(d, outline).and_then(|i| i.read(&view)), Some(deepest.clone()));
    }
    // 300 deep: her device refuses to make it, and a patched app's counts for no reader, each keeping the last that fit
    let deeper = chain(300);
    let refused = w.lab.edit(mac, alice, outline, |item| item.set_record(&view, &deeper));
    assert_eq!(refused, Err(Refusal::NotAView));
    let patched = w.lab.patched(|lab| lab.edit(mac, alice, outline, |item| item.set_record(&view, &deeper)));
    let patched = patched.expect("a patched app makes it").to_hex();
    w.lab.sync_all(1);
    for d in [mac, phone] {
        assert_eq!(counted(&mut w, d, outline).last(), Some(&(patched.clone(), false)));
        assert_eq!(w.lab.item(d, outline).and_then(|i| i.read(&view)), Some(deepest.clone()));
    }
}

/// The path of a row `ids` names down an outline, each id a row of the `kids` of the one before (the first of `nodes`),
/// and then `then`.
fn down(ids: &[i64], then: &[&str]) -> Value {
    let mut path = vec![];
    for (i, id) in ids.iter().enumerate() {
        path.push(json!(if i == 0 { "nodes" } else { "kids" }));
        path.push(json!({ "id": id }));
    }
    path.extend(then.iter().map(|f| json!(f)));
    Value::Array(path)
}

/// `run` and `may` take paths rows down, and the ops of a share name places rows down as they do at the top: a share
/// lets whom it names make only what its ops reach, at any depth, `may` answering first, and an op on a row reaches
/// everything under it. What he makes counts for every reader.
#[test]
fn run_and_may_take_deep_paths_and_deep_caps() {
    let mut w = cast::world();
    let (alice, bob, mac, mac_b) = (w.alice, w.bob, w.mac_a, w.mac_b);
    let (outline, _) = alices_outline(&mut w);
    let e = hex(outline);
    let insert = |path: Value, value: Value| json!({ "op": "insert", "entry": e, "path": path, "value": value });
    let set = |path: Value, value: &str| json!({ "op": "set", "entry": e, "path": path, "value": value });
    // Alice writes rows three levels down, an op at a time
    ok(run(&mut w, mac, insert(json!(["nodes"]), json!({ "id": 1, "text": "Beds" }))));
    ok(run(&mut w, mac, insert(json!(["nodes"]), json!({ "id": 2, "text": "Tools" }))));
    ok(run(&mut w, mac, insert(down(&[1], &["kids"]), json!({ "id": 11, "text": "North" }))));
    ok(run(&mut w, mac, insert(down(&[1, 11], &["kids"]), json!({ "id": 111, "text": "Beans" }))));
    let got = ok(run(&mut w, mac, json!({ "op": "get", "entry": e })));
    assert_eq!(got["record"]["nodes"][0]["kids"][0]["kids"][0]["text"], "Beans");
    // Bob may set the texts two rows down, add rows to any list under a node, and change anything of the tools
    let caps = ops_of(json!([
        { "op": "set", "path": ["nodes", "*", "kids", "*", "text"] },
        { "op": "insert", "path": ["nodes", "*", "kids"] },
        { "op": "set", "path": ["nodes", { "id": 2 }] },
    ]));
    w.lab.issue(mac, &[mac], on_entry(alice, bob, outline, caps)).expect("Alice shares her outline with Bob");
    w.lab.sync_all(0);
    let remove = |path: Value| json!({ "op": "remove", "entry": e, "path": path });
    let north = set(down(&[1, 11], &["text"]), "North bed");
    let peas = insert(down(&[1, 11], &["kids"]), json!({ "id": 112, "text": "Peas" }));
    let spades = set(down(&[2], &["text"]), "Spades");
    let spade = insert(down(&[2], &["kids"]), json!({ "id": 21, "text": "Spade", "kids": [{ "id": 211 }] }));
    let asks = [
        north.clone(),
        set(down(&[1], &["text"]), "Raised beds"),
        set(down(&[1, 11, 111], &["text"]), "Runner beans"),
        peas.clone(),
        insert(json!(["nodes"]), json!({ "id": 3 })),
        spades.clone(),
        spade.clone(),
        remove(down(&[1, 11], &[])),
    ];
    let (yes, no) = (json!(true), json!("NotAllowed"));
    let want = [&yes, &no, &no, &yes, &no, &yes, &yes, &no].map(Value::clone);
    assert_eq!(may(&mut w, mac_b, bob, &asks), want, "one row down, three rows down, the top: not his");
    for (ask, want) in asks.iter().zip(&want) {
        if *want == no {
            assert_eq!(refused(&run(&mut w, mac_b, ask.clone())), "NotAllowed", "{ask}");
        }
    }
    // what they allow is made, and every reader counts it; a row added with rows of its own, under the tools' row
    for op in [north, peas, spades, spade] {
        ok(run(&mut w, mac_b, op));
    }
    let under = set(down(&[2, 21, 211], &["text"]), "Handle");
    assert_eq!(may(&mut w, mac_b, bob, std::slice::from_ref(&under)), [yes]);
    ok(run(&mut w, mac_b, under));
    w.lab.sync_all(1);
    for d in [mac, mac_b] {
        assert!(counted(&mut w, d, outline).iter().all(|c| c.1));
        let got = ok(run(&mut w, d, json!({ "op": "get", "entry": e })));
        let (beds, tools) = (&got["record"]["nodes"][0], &got["record"]["nodes"][1]);
        assert_eq!((&beds["text"], &beds["kids"][0]["text"]), (&json!("Beds"), &json!("North bed")));
        assert_eq!(each(&beds["kids"][0]["kids"], |k| &k["text"]), ["Beans", "Peas"]);
        assert_eq!((&tools["text"], &tools["kids"][0]["kids"][0]["text"]), (&json!("Spades"), &json!("Handle")));
    }
}

/// Merges, undos, restores and forks of an outline, rows down: a proposal's rows join main's by id inside each of
/// the outline's own rows, and a clash anywhere in one makes that row the conflict, whole, the merge keeping main's
/// unless it takes the proposal's; undo and restore give back what a version showed, at any depth; a fork copies
/// every row.
#[test]
fn merge_undo_restore_and_forks_reach_rows_of_rows() {
    let mut w = cast::world();
    let mac = w.mac_a;
    let (outline, _) = alices_outline(&mut w);
    let e = hex(outline);
    let insert = |line: &Value, path: Value, value: Value| {
        json!({ "op": "insert", "entry": e, "line": line, "path": path, "value": value })
    };
    let set = |line: &Value, path: Value, value: &str| {
        json!({ "op": "set", "entry": e, "line": line, "path": path, "value": value })
    };
    let main = Value::Null;
    let beds = json!({ "id": 1, "text": "Beds", "kids": [{ "id": 11, "text": "North" }, { "id": 12, "text": "South" }]
    });
    ok(run(&mut w, mac, insert(&main, json!(["nodes"]), beds)));
    let record = |w: &mut World, line: &Value| {
        let got = ok(run(w, mac, json!({ "op": "get", "entry": e, "line": line })));
        got["record"].clone()
    };
    let kids = |r: &Value| each(&r["nodes"][0]["kids"], |k| &k["text"]);
    // a proposal and main each change a different row under the beds, and each add one: the merge joins them
    let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": e, "name": "Spring" })))["line"].clone();
    ok(run(&mut w, mac, set(&line, down(&[1, 12], &["text"]), "South bed")));
    ok(run(&mut w, mac, insert(&line, down(&[1], &["kids"]), json!({ "id": 13, "text": "East" }))));
    ok(run(&mut w, mac, set(&main, down(&[1, 11], &["text"]), "North bed")));
    let note = ok(run(&mut w, mac, json!({ "op": "note", "entry": e })));
    assert_eq!(note["lines"][1]["conflicts"], json!([]), "no clash anywhere in the beds");
    ok(run(&mut w, mac, json!({ "op": "merge", "entry": e, "from": line })));
    assert_eq!(kids(&record(&mut w, &main)), ["North bed", "South bed", "East"]);
    // both change one text two rows down: the beds' row is the conflict, whole, and main keeps its own
    let line = ok(run(&mut w, mac, json!({ "op": "propose", "entry": e, "name": "Summer" })))["line"].clone();
    ok(run(&mut w, mac, set(&line, down(&[1, 13], &["text"]), "East bed")));
    ok(run(&mut w, mac, set(&line, down(&[1, 12], &["text"]), "Sunny bed")));
    ok(run(&mut w, mac, set(&main, down(&[1, 13], &["text"]), "Eastern bed")));
    let note = ok(run(&mut w, mac, json!({ "op": "note", "entry": e })));
    let conflicts = list(&note["lines"][2]["conflicts"]);
    assert_eq!(conflicts.len(), 1, "{conflicts:?}");
    assert_eq!(conflicts[0]["at"], json!(["nodes", { "id": 1 }]));
    let theirs = conflicts[0]["theirs"].clone();
    assert_eq!(each(&theirs["kids"], |k| &k["text"]), ["North bed", "Sunny bed", "East bed"]);
    // merged taking the proposal's row there: all of it, the text it didn't clash on too
    let take = json!([{ "at": conflicts[0]["at"], "what": conflicts[0]["what"] }]);
    let merge = ok(run(&mut w, mac, json!({ "op": "merge", "entry": e, "from": line, "take": take })))["edit"].clone();
    assert_eq!(kids(&record(&mut w, &main)), ["North bed", "Sunny bed", "East bed"]);
    // undo an edit two rows down; take a row there out, and restore the version the merge made: as each showed it
    let north = ok(run(&mut w, mac, set(&main, down(&[1, 11], &["text"]), "Northern bed")))["edit"].clone();
    assert_eq!(kids(&record(&mut w, &main)), ["Northern bed", "Sunny bed", "East bed"]);
    ok(run(&mut w, mac, json!({ "op": "undo", "entry": e, "edit": north })));
    assert_eq!(kids(&record(&mut w, &main)), ["North bed", "Sunny bed", "East bed"]);
    ok(run(&mut w, mac, json!({ "op": "remove", "entry": e, "path": down(&[1, 12], &[]) })));
    assert_eq!(kids(&record(&mut w, &main)), ["North bed", "East bed"]);
    ok(run(&mut w, mac, json!({ "op": "restore", "entry": e, "at": [merge] })));
    assert_eq!(kids(&record(&mut w, &main)), ["North bed", "Sunny bed", "East bed"]);
    // a fork in her vault, whose lane holds the outline schema, copies every row, and a deep op in its first write
    let alice = w.alice.to_hex();
    let more = [json!({ "op": "insert", "path": down(&[1, 11], &["kids"]), "value": { "id": 111, "text": "Beans" } })];
    let fork = json!({ "op": "fork", "entry": e, "into": alice, "ops": more });
    let copy = ok(run(&mut w, mac, fork))["entry"].as_str().expect("its id").to_string();
    let copied = ok(run(&mut w, mac, json!({ "op": "get", "entry": copy })))["record"].clone();
    assert_eq!(kids(&copied), ["North bed", "Sunny bed", "East bed"]);
    assert_eq!(copied["nodes"][0]["kids"][0]["kids"][0]["text"], "Beans");
}

/// A query reads each record so many rows down: 16 unless it names its own depth, and never deeper than the device's
/// most. A list of rows below that isn't read: no where sees it, the record shows the row above it without it, and the
/// row says it was cut.
#[test]
fn a_query_stops_at_its_depth_limit() {
    let mut w = cast::world();
    let (alice, mac) = (w.alice, w.mac_a);
    let (outline, schema) = alices_outline(&mut w);
    // twenty nodes, one under the other, the nth's text "n"
    let mut nodes = json!([]);
    for n in (1..=20).rev() {
        nodes = json!([{ "id": n, "text": n.to_string(), "kids": nodes }]);
    }
    let deep = json!({ "kind": "outline", "title": "Deep", "nodes": nodes });
    let view = View::plain(&schema);
    w.lab.edit(mac, alice, outline, |item| item.set_record(&view, &deep)).expect("it fits");
    // the where on the text `n` rows down, and the query of it
    let at = |n: usize| {
        let mut path = vec![json!("nodes"), json!("*")];
        for _ in 1..n {
            path.extend([json!("kids"), json!("*")]);
        }
        path.push(json!("text"));
        json!({ "path": path, "eq": n.to_string() })
    };
    let query = |w: &mut World, n: usize, depth: Option<usize>| {
        let mut q = json!({ "op": "query", "vault": alice.to_hex(), "where": at(n) });
        if let Some(d) = depth {
            q["depth"] = d.into();
        }
        ok(run(w, mac, q))
    };
    // 16 rows down by default: the 16th is there, the 17th isn't, and the 16th shows no rows under it
    let found = query(&mut w, 16, None);
    assert_eq!((&found["count"], &found["depth"]), (&json!(1), &json!(16)));
    let row = &found["rows"][0];
    assert_eq!(row["cut"], true);
    let mut node = &row["record"]["nodes"][0];
    for _ in 1..16 {
        node = &node["kids"][0];
    }
    assert_eq!((&node["text"], node.get("kids")), (&json!("16"), None));
    assert_eq!(query(&mut w, 17, None)["count"], 0);
    // deeper where a query asks, and shallower
    let all = query(&mut w, 20, Some(20));
    assert_eq!((&all["count"], &all["rows"][0]["cut"]), (&json!(1), &json!(false)));
    assert_eq!(query(&mut w, 2, Some(2))["count"], 1);
    assert_eq!(query(&mut w, 3, Some(2))["count"], 0);
    let top = ok(run(&mut w, mac, json!({ "op": "query", "vault": alice.to_hex(), "depth": 0 })));
    let rows = list(&top["rows"]);
    let mine = rows.iter().find(|r| r["entry"] == hex(outline)).expect("the outline");
    let (record, cut) = (&mine["record"], &mine["cut"]);
    assert_eq!((record.get("nodes"), &record["title"], cut), (None, &json!("Deep"), &json!(true)));
    // never deeper than the device's most, whatever a query asks, which the device sets for itself
    let limits = |depth: usize| json!({ "depth": depth, "default": engine::QUERY_DEPTH, "ceiling": lens::CEILING });
    assert_eq!(ok(run(&mut w, mac, json!({ "op": "limits" }))), limits(lens::CEILING));
    let set = |depth: Value| json!({ "op": "set_limits", "depth": depth });
    assert_eq!(ok(run(&mut w, mac, json!({ "op": "may", "ops": [set(json!(4))] }))), json!([true]));
    assert_eq!(w.lab.query_depth(mac), lens::CEILING, "a dry run changes nothing");
    for bad in [json!(0), json!(lens::CEILING + 1), json!("deep")] {
        assert_eq!(refused(&run(&mut w, mac, set(bad))), "BadOp");
    }
    assert_eq!(ok(run(&mut w, mac, set(json!(4)))), limits(4));
    assert_eq!((w.lab.query_depth(mac), w.lab.query_depth(w.phone_a)), (4, lens::CEILING), "its own alone");
    let capped = query(&mut w, 4, Some(20));
    assert_eq!((&capped["count"], &capped["depth"]), (&json!(1), &json!(4)));
    assert_eq!(query(&mut w, 5, Some(20))["count"], 0);
    assert_eq!(refused(&run(&mut w, mac, json!({ "op": "query", "depth": "deep" }))), "BadOp");
}

/// A person: a name, a friend (a link that follows its entry's newest version), who they were (a link pinned at a
/// version) and notes (links of either kind).
const PERSON: &str = r##"{ "title": "Person", "type": "object", "properties": {
    "kind": { "const": "person" },
    "name": { "type": "string", "default": "" },
    "friend": { "x-link": "newest" },
    "was": { "x-link": "pinned" },
    "notes": { "type": "array", "default": [], "items": { "x-link": true } } },
  "required": ["kind"] }"##;

/// A link to entry `e` of vault `v`.
fn link(v: VaultId, e: EntryId) -> Value {
    json!({ "vault": v.to_hex(), "entry": hex(e) })
}

/// Alice's people, made on her Mac: Ada and Bo, each the other's friend.
fn alices_people(w: &mut World) -> (EntryId, EntryId) {
    let (alice, mac) = (w.alice, w.mac_a);
    ok(run(w, mac, json!({ "op": "create", "vault": alice.to_hex(), "type": "schema", "value": PERSON })));
    let mut person = |name: &str| {
        let value = json!({ "kind": "person", "name": name });
        let made = ok(run(w, mac, json!({ "op": "create", "vault": alice.to_hex(), "type": "note", "value": value })));
        EntryId::from_hex(made["entry"].as_str().expect("its id")).expect("an entry")
    };
    let (ada, bo) = (person("Ada"), person("Bo"));
    for (who, friend) in [(ada, bo), (bo, ada)] {
        let set = json!({ "op": "set", "entry": hex(who), "path": ["friend"], "value": link(alice, friend) });
        ok(run(w, mac, set));
    }
    (ada, bo)
}

/// Ada's row of a query of device `d` that follows `follow`, `depth` levels deep (the default, left out).
fn ada_following(w: &mut World, d: SignerId, follow: Value, depth: Option<usize>) -> Value {
    let mut q = json!({ "op": "query", "where": { "path": ["name"], "eq": "Ada" }, "follow": follow });
    if let Some(n) = depth {
        q["depth"] = n.into();
    }
    let found = ok(run(w, d, q));
    assert_eq!(found["count"], 1, "{found}");
    found["rows"][0]["record"].clone()
}

/// How many hops a query made down field `f` from `r`, and what the last link there shows instead.
fn hops(r: &Value, f: &str) -> (usize, Value) {
    let (mut at, mut n) = (&r[f], 0);
    while let Some(to) = at.get("to") {
        (at, n) = (&to[f], n + 1);
    }
    (n, at["empty"].clone())
}

/// A query follows the links at the places it names, a level at a time, each hop one level of its depth: a cycle of
/// links ends at the depth, never deeper than the device's most; a place it doesn't name is left a link.
#[test]
fn a_cycle_of_links_ends_at_the_depth_limit() {
    let mut w = cast::world();
    let (alice, mac) = (w.alice, w.mac_a);
    let (ada, bo) = alices_people(&mut w);
    let ada_now = ada_following(&mut w, mac, json!(["friend"]), Some(1));
    assert_eq!(ada_now["friend"]["to"]["name"], "Bo");
    assert_eq!(ada_now["friend"]["to"]["friend"]["empty"], "Deep");
    assert!(ada_now["friend"]["to"]["friend"]["why"].is_string());
    for (depth, want) in [(Some(0), 0), (Some(1), 1), (Some(5), 5), (None, engine::QUERY_DEPTH)] {
        let r = ada_following(&mut w, mac, json!(["friend"]), depth);
        assert_eq!(hops(&r, "friend"), (want, json!("Deep")), "{depth:?}");
    }
    // a hop through Bo comes back to Ada, as the link names her
    let r = ada_following(&mut w, mac, json!(["friend"]), Some(2));
    assert_eq!(r["friend"]["to"]["friend"]["entry"], hex(ada));
    assert_eq!(r["friend"]["to"]["friend"]["to"]["name"], "Ada");
    // nothing named, nothing followed: the link as it is stored
    let plain = ada_following(&mut w, mac, json!([]), None);
    assert_eq!(plain["friend"], link(alice, bo));
    // the device's most bounds the hops as it bounds the rows
    w.lab.set_query_depth(mac, 2);
    assert_eq!(hops(&ada_following(&mut w, mac, json!(["friend"]), Some(9)), "friend"), (2, json!("Deep")));
    let bad = json!({ "op": "query", "follow": [["friend", "*"]] });
    assert_eq!(refused(&run(&mut w, mac, bad)), "BadOp");
}

/// Each hop opens only what its reader reads, and one that opens nothing shows why: an entry it doesn't read, a vault
/// that isn't the entry's, a version it doesn't hold, a row that isn't there. A link names a row, or a version, and a
/// schema says which kind of link a field takes.
#[test]
fn a_hop_the_reader_cant_open_comes_back_empty_with_its_reason() {
    let mut w = cast::world();
    let (alice, bob, mac, mac_b) = (w.alice, w.bob, w.mac_a, w.mac_b);
    let (ada, bo) = alices_people(&mut w);
    let (garden, schema) = alices_outline(&mut w);
    let beds = json!({ "kind": "outline", "title": "Garden", "nodes": [{ "id": 1, "text": "Beds", "kids": [
        { "id": 2, "text": "North", "kids": [{ "id": 3, "text": "Beans", "kids": [] }] }] }] });
    w.lab.edit(mac, alice, garden, |item| item.set_record(&View::plain(&schema), &beds)).expect("it fits");
    // Bob's own todo, which no share gives Alice
    let todo = json!({ "kind": "todo", "title": "Bob's door" });
    let bobs = ok(run(&mut w, mac_b, json!({ "op": "create", "vault": bob.to_hex(), "type": "todo", "value": todo })));
    let bobs = EntryId::from_hex(bobs["entry"].as_str().expect("its id")).expect("an entry");
    // Bo as he was, pinned at the version before his new name
    let then = ok(run(&mut w, mac, json!({ "op": "get", "entry": hex(bo) })))["heads"].clone();
    let renamed = json!({ "op": "set", "entry": hex(bo), "path": ["name"], "value": "Bob" });
    ok(run(&mut w, mac, renamed));
    let pinned = |at: Value| {
        let mut l = link(alice, bo);
        l["at"] = at;
        l
    };
    let row = |id: i64| {
        let mut l = link(alice, garden);
        l["row"] = json!(["nodes", { "id": 1 }, "kids", { "id": id }]);
        l
    };
    let notes = json!([link(alice, bo), link(bob, bobs), link(bob, bo), row(2), row(9), pinned(json!([hex(bo)]))]);
    let set = |f: &str, v: Value| json!({ "op": "set", "entry": hex(ada), "path": [f], "value": v });
    ok(run(&mut w, mac, set("notes", notes)));
    ok(run(&mut w, mac, set("was", pinned(then.clone()))));
    // a schema takes the kind of link it names, and nothing else, where a link goes
    assert_eq!(refused(&run(&mut w, mac, set("friend", json!("Bo")))), "NotAView");
    assert_eq!(refused(&run(&mut w, mac, set("friend", pinned(then.clone())))), "NotAView");
    assert_eq!(refused(&run(&mut w, mac, set("was", link(alice, bo)))), "NotAView");
    // on Alice's Mac
    let r = ada_following(&mut w, mac, json!(["notes", "was", "friend"]), Some(2));
    let why = |x: &Value| (x["empty"].as_str().map(str::to_string), x["why"].is_string());
    let (n, was) = (&r["notes"], &r["was"]);
    let names = [&n[0]["to"]["name"], &r["friend"]["to"]["name"], &was["to"]["name"]];
    assert_eq!(names, [&json!("Bob"), &json!("Bob"), &json!("Bo")], "the newest of Bo, and Bo as he was");
    assert_eq!(was["at"], then, "the link as it is stored, and what it leads to");
    assert_eq!(why(&n[1]), (Some("NoEntry".into()), true), "Bob's todo is no share's of Alice");
    assert_eq!(why(&n[2]), (Some("WrongVault".into()), true));
    assert_eq!((&n[3]["to"]["text"], &n[3]["to"]["kids"][0]["text"]), (&json!("North"), &json!("Beans")));
    assert_eq!(why(&n[4]), (Some("NoRow".into()), true));
    assert_eq!(why(&n[5]), (Some("NoVersion".into()), true));
    // a row a link names is read as many rows down below it as the hop has left, as a record is
    let shallow = ada_following(&mut w, mac, json!(["notes"]), Some(1));
    assert_eq!((&shallow["notes"][3]["to"]["text"], shallow["notes"][3]["to"].get("kids")), (&json!("North"), None));
    // Bob reads Ada, as a share gives him her, and nothing else of Alice's: his hops open what he reads, his own todo
    let viewer = json!({ "op": "share", "over": alice.to_hex(), "who": { "vault": bob.to_hex() }, "level": "Viewer",
        "what": { "entry": [hex(ada)] } });
    ok(run(&mut w, mac, viewer));
    w.lab.sync_all(0);
    let r = ada_following(&mut w, mac_b, json!(["notes", "was", "friend"]), Some(2));
    assert_eq!(why(&r["friend"]), (Some("NoEntry".into()), true));
    assert_eq!(why(&r["was"]), (Some("NoEntry".into()), true));
    assert_eq!(r["notes"][1]["to"]["title"], "Bob's door");
    for i in [0, 2, 3, 4, 5] {
        assert!(r["notes"][i].get("to").is_none() && r["notes"][i]["empty"].is_string(), "{i}: {}", r["notes"][i]);
    }
}

/// A todo schema of Alice's own: v2, where a todo may be blocked too.
const TODO_V2: &str = r#"{ "title": "Todo, v2", "type": "object", "properties": {
  "kind": { "const": "todo" },
  "title": { "type": "string", "default": "" },
  "status": { "enum": ["open", "doing", "blocked", "done"], "default": "open" },
  "notes": { "type": "string", "x-loro": "text", "default": "" },
  "due": { "type": "string", "format": "date" } },
  "required": ["kind"] }"#;

/// A write is judged under the schemas of its vault's lane and the built-in ones: one a patched app writes through a
/// schema the lane doesn't hold counts for no reader until the vault creates it as a schema entry, and from then on, as
/// a lane only grows, for every reader. Its JSON is the entry's whole content, as written.
#[test]
fn a_write_counts_once_the_lane_holds_its_schema() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (alice, mac) = (w.alice, w.mac_a);
    let v2 = Schema::parse(TODO_V2.as_bytes()).expect("a schema");
    let (door, schema) = (hex(l.door), v2.id().to_hex());
    let get = json!({ "op": "get", "entry": door, "schema": schema });
    let blocked = json!({ "op": "set", "entry": door, "schema": schema, "path": ["status"], "value": "blocked" });
    // an app on v2 neither reads nor writes through it while Alice's lane doesn't hold it
    assert_eq!(refused(&run(&mut w, mac, get.clone())), "NoSchema");
    assert_eq!(refused(&run(&mut w, mac, blocked)), "NoSchema");
    // a patched one writes through it all the same, which no reader counts: the todo stores no status still, so is
    // open, its default
    let patched = w.lab.patched(|lab| {
        lab.edit(mac, alice, l.door, |item| {
            let mut r = item.record();
            r["status"] = json!("blocked");
            item.set_record(&View::plain(&v2), &r);
        })
    });
    let patched = patched.expect("a patched app makes it").to_hex();
    let stored = |w: &World| w.lab.item(mac, l.door).expect("the door").record()["status"].clone();
    assert_eq!(counted(&mut w, mac, l.door).last(), Some(&(patched.clone(), false)));
    assert_eq!(stored(&w), Value::Null);
    // a schema entry holds a schema and nothing else, of the type it says
    let add = |ty: &str, value: Value| json!({ "op": "create", "vault": alice.to_hex(), "type": ty, "value": value });
    assert_eq!(refused(&run(&mut w, mac, add("schema", json!("no schema")))), "BadOp");
    assert_eq!(refused(&run(&mut w, mac, add("lens", json!(TODO_V2)))), "BadOp");
    assert_eq!(refused(&run(&mut w, mac, add("schema", json!(lens::example::blobs::TODO_LENS)))), "BadOp");
    let tagged = json!({ "op": "create", "vault": alice.to_hex(), "type": "schema", "tags": [], "value": TODO_V2 });
    assert_eq!(refused(&run(&mut w, mac, tagged)), "BadOp");
    // once Alice adds v2 to her lane, the write fits the schemas it was written under, and counts
    let made = ok(run(&mut w, mac, add("schema", json!(TODO_V2))));
    assert_eq!(made["blob"], BlobId::of(TODO_V2.as_bytes()).to_hex());
    let entry = EntryId::from_hex(made["entry"].as_str().expect("its id")).expect("an entry");
    assert_eq!(w.lab.lane_of(mac, alice), [TODO_V2.as_bytes()], "its JSON, as written");
    assert!(w.lab.meaning(mac, entry).is_some_and(|m| m.attrs.ty.of_lane()), "of a schema entry");
    assert_eq!(counted(&mut w, mac, l.door).last(), Some(&(patched, true)));
    assert_eq!(stored(&w), "blocked");
    // an app on v2 reads it, read-only: no lens joins v2 to v1, which the todo was written under too
    let seen = ok(run(&mut w, mac, get));
    assert_eq!((seen["record"]["status"].clone(), seen["readOnly"].clone()), (json!("blocked"), json!(true)));
}

/// Who wrote an entry is never its coop (Samuel 2026-10-18): a story of Maia City is written by avenMAIA, Maia City's
/// aven, and the human vaults whose devices signed its writes, each once in the order they first wrote; the world, the
/// history of each release and line, and the feed everyone reads say so alike (`world::authors`).
#[test]
fn a_coops_entry_is_written_by_its_aven_and_the_people_who_signed_its_writes() {
    let mut w = cast::world();
    let (mac, mac_b, alice, bob) = (w.mac_a, w.mac_b, w.alice, w.bob);
    let city = world::seed_of(&w.lab, mac)[0];
    let (c, aven) = (city.to_hex(), w.avenceo.to_hex());
    let story = json!({ "kind": "story", "title": "The first village", "text": "Day one." });
    let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": c, "type": "story", "tags": ["out"], "value": story,
        "as": c })));
    let entry = made["entry"].as_str().expect("its id").to_string();
    let authors = |w: &mut World, d: SignerId| {
        let world = ok(run(w, d, json!({ "op": "world" })));
        let row = list(&world["entries"]).iter().find(|e| e["entry"] == entry.as_str()).cloned().expect("the story");
        row["authors"].as_array().expect("its authors").iter().map(|v| v.as_str().unwrap().to_string()).collect::<Vec<_>>()
    };
    assert_eq!(authors(&mut w, mac), [aven.clone(), alice.to_hex()], "avenMAIA and Alice, never Maia City");
    // Bob edits it by a share Maia City gives him: he joins its authors
    let editor = json!({ "op": "share", "over": c, "who": { "vault": bob.to_hex() }, "level": "Editor", "what": { "type": ["story"] },
        "as": c });
    ok(run(&mut w, mac, editor));
    w.lab.sync_all(5);
    let set = json!({ "op": "set", "entry": entry, "path": ["text"], "value": "Day one, and two.", "as": bob.to_hex() });
    ok(run(&mut w, mac_b, set));
    w.lab.sync_all(5);
    let want = [aven.clone(), alice.to_hex(), bob.to_hex()];
    assert_eq!(authors(&mut w, mac), want, "and Bob, once");
    // the history says it of the main line, and of a release as it was then
    let history = ok(run(&mut w, mac, json!({ "op": "history", "entry": entry })));
    let main = &list(&history["lines"])[0];
    let names = |xs: &Value| xs.as_array().expect("authors").iter().map(|a| a["vault"].as_str().unwrap().to_string()).collect::<Vec<_>>();
    assert_eq!(names(&main["authors"]), want, "main as it stands");
    let first = list(&history["edits"]).iter().find(|e| e["version"] == 1).expect("its first release");
    assert_eq!(names(&first["authors"]), [aven, alice.to_hex()], "its first version, before Bob wrote");
}

/// What a device's work cost is its own (`Lab::perf`): `perf` reads it like any read, writes nothing, takes no field,
/// and says what the device holds as it holds it.
#[test]
fn perf_reads_what_the_devices_work_cost_and_writes_nothing() {
    let mut w = cast::world();
    cast::library(&mut w);
    w.lab.sync_all(5);
    let mac = w.mac_a;
    let op = json!({ "op": "perf" });
    assert!(engine::reads(&op), "a read");
    let edits = w.lab.log(mac).edits().len();
    let perf = ok(run(&mut w, mac, op.clone()));
    assert!(perf["timers"].is_object() && perf["counts"].is_object(), "{perf}");
    assert_eq!(perf["held"]["edits"], edits, "the edits it holds");
    let replay = &perf["timers"]["replay"];
    assert!(replay["count"].as_u64().is_some_and(|n| n > 0), "it replayed: {perf}");
    assert!(replay["max_ms"].as_f64() <= replay["total_ms"].as_f64(), "{replay}");
    // it changes nothing: no edit made, and asked again it answers the same of what it holds
    assert_eq!(w.lab.log(mac).edits().len(), edits, "nothing written");
    assert_eq!(ok(run(&mut w, mac, op.clone()))["held"], perf["held"]);
    let alice = w.alice.to_hex();
    assert_eq!(refused(&run(&mut w, mac, json!({ "op": "perf", "vault": alice }))), "BadOp", "it takes no field");
    assert!(engine::prepare(&mut w.lab, mac, &op).is_err(), "read it, don't run it");
}


#[test]
fn entry_views_are_exact_scoped_world_rows_before_and_after_revocation() {
    use avendb::policy::Revoking;
    use avendb::world::{Holder, SyncedTo};
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let key = avendb::sealed::FileKey::from_bytes([9; 32]);
    let plain = b"canonical entry collection file";
    let brought = avendb::sealed::Brought::new(avendb::hash::hash("entry collection file", &avendb::sealed::seal(&key, plain)), key, plain.len() as u64);
    let root = brought.root;
    ok(engine::put_file(&mut w.lab, w.mac_a, &json!({ "op": "put_file", "vault": w.alice.to_hex(), "name": "sample.txt", "media": "text/plain", "tags": [], "len": plain.len() }), brought));
    let mut synced = SyncedTo::default();
    synced.files.insert(root, vec![Holder { device: w.phone_a, has: 1, of: 1, checked: Some(8) }]);
    synced.entries.insert(l.door, vec![Holder { device: w.phone_a, has: 2, of: 3, checked: Some(7) }]);
    let compare = |w: &World, me: SignerId, vault: VaultId, types: Option<Vec<String>>| {
        let mut op = json!({ "op": "entry_views", "vault": vault.to_hex() });
        if let Some(types) = &types { op["types"] = json!(types); }
        let all = ok(engine::world(&w.lab, me, &synced));
        let expected: Vec<Value> = all["entries"].as_array().unwrap().iter()
            .filter(|row| row["vault"] == vault.to_hex())
            .filter(|row| types.as_ref().is_none_or(|types| row["type"].as_str().is_some_and(|ty| types.iter().any(|t| t == ty))))
            .cloned().collect();
        let actual = ok(engine::entry_views(&w.lab, me, &op, &synced));
        assert_eq!(actual["rows"], json!(expected));
    };
    w.lab.sync_all(0);
    for me in [w.mac_a, w.mac_b, w.server] {
        for vault in [w.alice, w.bob, VaultId([0; 32])] {
            compare(&w, me, vault, None);
            compare(&w, me, vault, Some(vec!["todo".into()]));
            compare(&w, me, vault, Some(vec![]));
        }
    }
    let share = w.lab.issue(w.mac_a, &[w.mac_a], cast::share(w.alice, cast::vault(w.bob), Level::Read, cast::by_id(l.door))).unwrap();
    w.lab.sync_all(1);
    compare(&w, w.mac_b, w.alice, None);
    let revoke = Action::Revoke(Revoking::Grant { share, actor: w.alice, keep: vec![], via: vec![] });
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    w.lab.sync_all(2);
    compare(&w, w.mac_b, w.alice, None);
    let mac = w.mac_a;
    ok(run(&mut w, mac, json!({ "op": "insert", "entry": l.diary.to_hex(), "path": ["tags"], "value": world::DELETED })));
    compare(&w, mac, w.alice, None);
    assert!(engine::read(&w.lab, mac, &json!({ "op": "entry_views" })).get("refused").is_some());
    assert!(engine::read(&w.lab, mac, &json!({ "op": "entry_views", "vault": "not-a-vault" })).get("refused").is_some());
    assert!(engine::read(&w.lab, mac, &json!({ "op": "entry_views", "vault": w.alice.to_hex(), "types": "todo" })).get("refused").is_some());
    assert!(engine::read(&w.lab, mac, &json!({ "op": "entry_views", "vault": w.alice.to_hex(), "unknown": true })).get("refused").is_some());
}
