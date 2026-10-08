//! The avenDB tile's world through its JSON views and actions, as the page reads and changes it: made a step at a
//! time, each device showing what its caps reach, apps editing through their schemas, branches, access, governance
//! signed by the passkeys it needs, and the Lab's columns.

use avendb::cast::{AFTER_TEXT, CHARTER_TEXT, ONBOARDING_TEXT, WELCOME_TEXT};
use avendb::lens::{DOCUMENT_LENS, DOCUMENT_V1, DOCUMENT_V2};
use avendb_web::Tile;
use serde_json::{json, Value};

/// The tile's world, made whole.
fn made() -> Tile {
    let mut tile = Tile::new();
    let mut steps = vec![];
    while let Some(step) = tile.build_step(1.0) {
        steps.push(step);
    }
    assert!(tile.ready());
    assert_eq!(steps.len(), Tile::steps(), "{steps:?}");
    assert_eq!(Tile::steps(), 8);
    tile
}

fn show(tile: &Tile, q: Value) -> Value {
    tile.show(&q).unwrap_or_else(|e| panic!("{q}: {e}"))
}

/// Do `a`, which must be done: what it made.
fn act(tile: &mut Tile, a: Value) -> Value {
    let done = tile.act_json(&a, 2.0);
    assert_eq!(done["ok"], json!(true), "{a}: {done}");
    done["made"].clone()
}

/// Do `a`, which the rules must refuse: the refusal.
fn refused(tile: &mut Tile, a: Value) -> String {
    let done = tile.act_json(&a, 2.0);
    assert_eq!(done["ok"], json!(false), "{a}: {done}");
    assert!(done["why"].is_string(), "{done}");
    done["refused"].as_str().unwrap_or_default().to_string()
}

/// The element of `list` whose `key` is `value`.
fn find(list: &Value, key: &str, value: &str) -> Value {
    let found = list.as_array().and_then(|l| l.iter().find(|x| x[key] == value));
    found.cloned().unwrap_or_else(|| panic!("no {key} {value} in {list}"))
}

/// What sits at `pointer` in each element of `list`, as text.
fn each(list: &Value, pointer: &str) -> Vec<String> {
    let at = |x: &Value| x.pointer(pointer).and_then(Value::as_str).unwrap_or("?").to_string();
    list.as_array().into_iter().flatten().map(at).collect()
}

/// The id of the device, signer, vault or space named `name` in `list`.
fn id(list: &Value, name: &str) -> String {
    find(list, "name", name)["id"].as_str().unwrap_or_default().to_string()
}

fn device(tile: &Tile, name: &str) -> String {
    id(&show(tile, json!({"view": "overview"}))["devices"], name)
}

/// What the page opens first: the Handbook and Welcome, Samuel's Todos and the door, the coop.
fn start(tile: &Tile, what: &str) -> String {
    show(tile, json!({"view": "overview"}))["start"][what].as_str().unwrap_or_default().to_string()
}

/// The id of the entry titled `title` in the space named `space`, as device `on` lists them.
fn entry(tile: &Tile, on: &str, space: &str, title: &str) -> String {
    let spaces = show(tile, json!({"view": "spaces", "on": on}));
    find(&find(&spaces["spaces"], "name", space)["entries"], "title", title)["id"].as_str().unwrap().to_string()
}

/// The text of each block of the entry as a v2 app shows it on `on`.
fn texts(tile: &Tile, on: &str, space: &str, entry: &str) -> Vec<String> {
    let e = show(tile, json!({"view": "entry", "on": on, "space": space, "entry": entry}));
    each(&e["value"]["blocks"], "/text")
}

#[test]
fn the_world_is_made_a_step_at_a_time_and_every_device_and_signer_is_named() {
    let mut tile = Tile::new();
    assert!(tile.show(&json!({"view": "overview"})).is_err(), "nothing to show before it is made");
    let first = tile.build_step(1.0);
    assert_eq!(first.as_deref(), Some("every passkey and device, and their keys"));
    while tile.build_step(1.0).is_some() {}
    let o = show(&tile, json!({"view": "overview"}));
    let all = ["Samuel's Mac", "Samuel's iPhone", "Bob's Mac", "Carol's Mac", "Dave's Mac", "the server", "a stranger"];
    assert_eq!(each(&o["devices"], "/name"), all);
    let passkeys = each(&o["signers"], "/kind").iter().filter(|k| *k == "passkey").count();
    assert_eq!((o["signers"].as_array().map(Vec::len), passkeys), (Some(12), 4));
    assert_eq!(o["signers"][0]["fingerprint"].as_str().map(str::len), Some(19));
    assert_eq!(o["devices"][1]["person"], json!("Samuel"));
    assert_eq!(start(&tile, "device"), device(&tile, "Samuel's Mac"));
    assert!(tile.show(&json!({"view": "nothing"})).is_err());
    assert!(tile.show(&json!({"view": "vaults", "on": "beef"})).is_err());
}

#[test]
fn each_device_sees_the_vaults_and_spaces_its_caps_reach() {
    let tile = made();
    let (mac, carol) = (device(&tile, "Samuel's Mac"), device(&tile, "Carol's Mac"));
    let vaults = show(&tile, json!({"view": "vaults", "on": mac}));
    let samuel = find(&vaults["vaults"], "name", "Samuel");
    assert_eq!(vaults["me"], samuel["id"]);
    assert_eq!(samuel["root"]["name"], json!("Samuel's passkey"));
    assert_eq!(samuel["devices"].as_array().map(Vec::len), Some(2));
    let coop = find(&vaults["vaults"], "name", "Maia Coop");
    assert_eq!([&coop["kind"], &coop["threshold"], &coop["mine"]], [&json!("coop"), &json!(2), &json!(true)]);
    assert_eq!(each(&coop["approvers"], "/name"), ["Samuel's passkey", "Bob's passkey"]);
    let spaces = show(&tile, json!({"view": "spaces", "on": mac}));
    assert_eq!(each(&spaces["spaces"], "/name"), ["Handbook", "Samuel's Notes", "Samuel's Todos"]);
    let handbook = &spaces["spaces"][0];
    assert_eq!((&handbook["role"], &handbook["through"]["name"]), (&json!("owner"), &json!("Maia Coop")));
    assert_eq!(each(&handbook["entries"], "/title"), ["Welcome", "Onboarding", "Charter"]);
    // Carol reaches the door todo and the public Charter, and nothing of Samuel's Notes
    let carols = show(&tile, json!({"view": "spaces", "on": carol}));
    assert_eq!(each(&carols["spaces"], "/name"), ["Handbook", "Samuel's Todos"]);
    assert_eq!(each(&carols["spaces"][0]["entries"], "/title"), ["Charter"]);
    assert_eq!(each(&carols["spaces"][1]["entries"], "/title"), ["Fix the greenhouse door"]);
    let todos = show(&tile, json!({"view": "todos", "on": carol}));
    assert_eq!(todos["todos"].as_array().map(Vec::len), Some(1));
    assert_eq!((&todos["todos"][0]["shared"], &todos["todos"][0]["role"]), (&json!(true), &json!("read")));
    let todos = show(&tile, json!({"view": "todos", "on": mac}));
    let mine = todos["todos"].as_array().unwrap();
    assert!(mine.len() == 3 && mine.iter().all(|t| t["shared"] == json!(false) && t["status"] == "open"));
}

#[test]
fn an_app_edits_through_its_schema_and_every_device_shows_the_edit() {
    let mut tile = made();
    let (space, welcome) = (start(&tile, "space"), start(&tile, "entry"));
    let (bob, phone) = (device(&tile, "Bob's Mac"), device(&tile, "Samuel's iPhone"));
    let e = show(&tile, json!({"view": "entry", "on": bob, "space": space, "entry": welcome}));
    // an app still on v1 wrote Welcome; Bob's v2 app reads it through the lens the coop published
    assert_eq!((&e["kind"], &e["readOnly"]), (&json!("document"), &json!(false)));
    assert_eq!(e["authored"], json!([DOCUMENT_V1.id().to_hex()]));
    assert_eq!(texts(&tile, &bob, &space, &welcome), ["Welcome", WELCOME_TEXT]);
    assert_eq!(e["value"]["blocks"][0]["type"], json!("heading"));
    let v1 = show(&tile, json!({"view": "entry", "on": bob, "space": space, "entry": welcome, "app": "v1"}));
    assert_eq!(v1["value"]["blocks"][0]["kind"], json!("h1"));
    let mut value = e["value"].clone();
    value["blocks"][1]["text"] = json!(AFTER_TEXT);
    let put = json!({"do": "put", "on": bob, "space": space, "entry": welcome, "value": value});
    assert!(act(&mut tile, put.clone())["op"].is_string());
    assert_eq!(act(&mut tile, put), Value::Null, "the same view again changes nothing");
    act(&mut tile, json!({"do": "sync_all"}));
    assert_eq!(texts(&tile, &phone, &space, &welcome), ["Welcome", AFTER_TEXT]);
    let e = show(&tile, json!({"view": "entry", "on": phone, "space": space, "entry": welcome}));
    assert_eq!(each(&e["commits"], "/kind"), ["create", "edit"]);
    let (create, edit) = (&e["commits"][0], &e["commits"][1]);
    assert_eq!(create["schemas"], json!([DOCUMENT_V1.id().to_hex()]));
    assert_eq!(edit["schemas"], json!([DOCUMENT_V2.id().to_hex()]));
    assert_eq!((&edit["author"]["name"], &edit["actor"]["name"]), (&json!("Bob's Mac"), &json!("Maia Coop")));
    assert_eq!(edit["when"], json!(2.0));
    // the first version opens read-only, as it was
    let version = json!({"view": "version", "on": phone, "space": space, "entry": welcome, "version": [create["op"]]});
    assert_eq!(show(&tile, version)["value"]["blocks"][1]["text"], json!(WELCOME_TEXT));
    // a new document, and a block added to it
    let mac = device(&tile, "Samuel's Mac");
    let made = act(&mut tile, json!({"do": "create", "on": mac, "space": space, "kind": "document", "title": "Rota"}));
    let rota = made["entry"].as_str().unwrap();
    let mut value = show(&tile, json!({"view": "entry", "on": mac, "space": space, "entry": rota}))["value"].clone();
    value["blocks"].as_array_mut().unwrap().push(json!({"id": 2, "type": "paragraph", "text": "Mondays: Bob"}));
    act(&mut tile, json!({"do": "put", "on": mac, "space": space, "entry": rota, "value": value}));
    assert_eq!(texts(&tile, &mac, &space, rota), ["Rota", "Mondays: Bob"]);
    let bad = json!({"do": "put", "on": mac, "space": space, "entry": rota, "value": {"kind": "document", "title": 7}});
    assert_eq!(refused(&mut tile, bad), "NotAView");
}

#[test]
fn the_rules_refuse_with_their_reason_on_the_device_that_tries() {
    let mut tile = made();
    let (todos, door) = (start(&tile, "todos"), start(&tile, "door"));
    let carol = device(&tile, "Carol's Mac");
    let e = show(&tile, json!({"view": "entry", "on": carol, "space": todos, "entry": door}));
    assert_eq!((&e["kind"], &e["role"]), (&json!("todo"), &json!("read")));
    let mut value = e["value"].clone();
    value["status"] = json!("done");
    let put = json!({"do": "put", "on": carol, "space": todos, "entry": door, "value": value});
    assert_eq!(refused(&mut tile, put.clone()), "NoCap");
    act(&mut tile, json!({"do": "lock", "on": carol}));
    assert!(tile.act_json(&put, 3.0)["ok"] == json!(false));
    assert_eq!(show(&tile, json!({"view": "todos", "on": carol}))["todos"], json!([]), "a locked device opens nothing");
    act(&mut tile, json!({"do": "unlock", "on": carol}));
    assert_eq!(show(&tile, json!({"view": "todos", "on": carol}))["todos"].as_array().map(Vec::len), Some(1));
    let server = device(&tile, "the server");
    let locked = tile.act_json(&json!({"do": "lock", "on": server}), 3.0);
    assert!(locked["error"].is_string(), "only a person's device locks: {locked}");
    assert!(tile.act_json(&json!({"do": "fly"}), 3.0)["error"].is_string());
    assert!(tile.act(r#"{"do": "#, 3.0).contains("error"));
}

#[test]
fn branches_merge_promote_and_revert_from_the_page() {
    let mut tile = made();
    let (space, welcome) = (start(&tile, "space"), start(&tile, "entry"));
    let (mac, bob) = (device(&tile, "Samuel's Mac"), device(&tile, "Bob's Mac"));
    let at = |tile: &Tile, on: &str, line: &Value| {
        show(tile, json!({"view": "entry", "on": on, "space": space, "entry": welcome, "line": line}))
    };
    let main = Value::Null;
    let made = act(&mut tile, json!({"do": "branch", "on": bob, "space": space, "entry": welcome, "name": "draft"}));
    let draft = made["line"].clone();
    let mut value = at(&tile, &bob, &draft)["value"].clone();
    value["blocks"][1]["text"] = json!("Hello, Bob here");
    act(&mut tile, json!({"do": "put", "on": bob, "space": space, "entry": welcome, "line": draft, "value": value}));
    act(&mut tile, json!({"do": "sync_all"}));
    let shown = at(&tile, &mac, &main);
    assert_eq!(shown["value"]["blocks"][1]["text"], json!(WELCOME_TEXT));
    assert_eq!(each(&shown["lines"], "/name"), ["main", "draft"]);
    act(&mut tile, json!({"do": "merge", "on": mac, "space": space, "entry": welcome, "from": draft, "into": main}));
    assert_eq!(at(&tile, &mac, &main)["value"]["blocks"][1]["text"], json!("Hello, Bob here"));
    assert_eq!(each(&at(&tile, &mac, &main)["commits"], "/kind"), ["create", "branch", "edit", "merge"]);
    // reverting the merge takes main back to where it was before
    act(&mut tile, json!({"do": "revert", "on": mac, "space": space, "entry": welcome, "line": main}));
    assert_eq!(at(&tile, &mac, &main)["value"]["blocks"][1]["text"], json!(WELCOME_TEXT));
    assert_eq!(each(&at(&tile, &mac, &main)["commits"], "/kind").last().map(String::as_str), Some("restore"));
    act(&mut tile, json!({"do": "promote", "on": mac, "space": space, "entry": welcome, "from": draft, "into": main}));
    assert_eq!(at(&tile, &mac, &main)["record"], at(&tile, &mac, &draft)["record"]);
    // a fork into Samuel's Notes copies the record and none of the history
    let notes = id(&show(&tile, json!({"view": "spaces", "on": mac}))["spaces"], "Samuel's Notes");
    let fork = json!({"do": "fork", "on": mac, "space": space, "entry": welcome, "line": main, "into": notes});
    let copy = act(&mut tile, fork)["entry"].clone();
    let copied = show(&tile, json!({"view": "entry", "on": mac, "space": notes, "entry": copy}));
    assert_eq!(copied["record"], at(&tile, &mac, &main)["record"]);
    assert_eq!(copied["commits"].as_array().map(Vec::len), Some(1));
    let onboarding = entry(&tile, &mac, "Handbook", "Onboarding");
    assert_eq!(texts(&tile, &mac, &space, &onboarding), ["Onboarding", ONBOARDING_TEXT], "the other entries stay");
}

#[test]
fn access_names_each_right_and_the_grant_behind_it_and_who_holds_each_key() {
    let mut tile = made();
    let (todos, door) = (start(&tile, "todos"), start(&tile, "door"));
    let (mac, carol) = (device(&tile, "Samuel's Mac"), device(&tile, "Carol's Mac"));
    let access = |tile: &Tile, on: &str| show(tile, json!({"view": "access", "on": on, "space": todos, "entry": door}));
    let a = access(&tile, &mac);
    let roles: Vec<(String, String)> =
        each(&a["holders"], "/vault/name").into_iter().zip(each(&a["holders"], "/role")).collect();
    for (vault, role) in [("Samuel", "owner"), ("Bob", "write"), ("Carol", "read"), ("Maia Coop", "owner")] {
        assert!(roles.contains(&(vault.into(), role.into())), "{vault} {role} in {roles:?}");
    }
    assert!(roles.contains(&("the server".into(), "relay".into())));
    let samuel = a["holders"].as_array().unwrap().iter().find(|h| h["vault"]["name"] == "Samuel").cloned().unwrap();
    assert_eq!(samuel["why"], json!([{"founded": true}]));
    let to = |name: &str| a["grants"].as_array().unwrap().iter().find(|g| g["to"]["name"] == name).cloned().unwrap();
    let (read, coop_owner) = (to("Carol"), to("Maia Coop"));
    assert_eq!((&read["role"], &read["scope"]), (&json!("read"), &json!("entry")));
    let held = each(&a["keys"][0]["holders"], "/name");
    assert!(held.contains(&"Carol's Mac".into()) && !held.contains(&"the server".into()), "{held:?}");
    // the coop's owner cap is governance: revoking it takes Samuel's passkey
    let signed = act(&mut tile, json!({"do": "revoke", "on": mac, "grant": coop_owner["id"]}));
    assert_eq!(signed["signed"], json!(["Samuel's Mac", "Samuel's passkey"]));
    act(&mut tile, json!({"do": "revoke", "on": mac, "grant": read["id"]}));
    let mut value = show(&tile, json!({"view": "entry", "on": mac, "space": todos, "entry": door}))["value"].clone();
    value["status"] = json!("doing");
    act(&mut tile, json!({"do": "put", "on": mac, "space": todos, "entry": door, "value": value}));
    act(&mut tile, json!({"do": "sync_all"}));
    let a = access(&tile, &mac);
    assert_eq!(a["epoch"], json!(2), "the door's key rotated after each revocation");
    let held = each(&a["keys"][2]["holders"], "/name");
    assert!(!held.contains(&"Carol's Mac".into()) && held.contains(&"Bob's Mac".into()), "{held:?}");
    let public = json!({"do": "grant", "on": mac, "space": todos, "entry": door, "role": "read", "to": "everyone"});
    act(&mut tile, public);
    assert_eq!(access(&tile, &mac)["public"], json!(true));
    assert!(access(&tile, &carol)["holders"].is_array());
    let owner = json!({"do": "grant", "on": mac, "space": todos, "entry": door, "role": "owner", "to": "everyone"});
    assert_eq!(refused(&mut tile, owner), "PublicBeyondRead");
}

#[test]
fn governance_signs_with_the_passkeys_it_needs() {
    let mut tile = made();
    let (mac, bob) = (device(&tile, "Samuel's Mac"), device(&tile, "Bob's Mac"));
    let vaults = |tile: &Tile| show(tile, json!({"view": "vaults", "on": mac}))["vaults"].clone();
    let (samuel, carol, coop) = (id(&vaults(&tile), "Samuel"), id(&vaults(&tile), "Carol"), start(&tile, "coop"));
    let added = act(&mut tile, json!({"do": "add_device", "on": mac, "name": "Samuel's iPad"}));
    assert_eq!(added["signed"], json!(["Samuel's passkey", "Samuel's iPad"]));
    act(&mut tile, json!({"do": "sync_all"}));
    let ipad = device(&tile, "Samuel's iPad");
    let theirs = show(&tile, json!({"view": "spaces", "on": ipad}));
    assert_eq!(theirs["spaces"].as_array().map(Vec::len), Some(3), "the iPad reaches what Samuel reaches");
    let garden = json!({"do": "create_coop", "on": mac, "name": "Garden Club", "owners": [samuel, carol]});
    let made = act(&mut tile, garden);
    assert_eq!(made["signed"], json!(["Samuel's passkey", "Carol's passkey"]));
    assert_eq!(id(&vaults(&tile), "Garden Club"), made["vault"].as_str().unwrap());
    let one = json!({"do": "set_threshold", "on": mac, "vault": coop, "threshold": 1});
    assert_eq!(act(&mut tile, one)["signed"], json!(["Samuel's passkey", "Bob's passkey"]));
    let alone = json!({"do": "set_threshold", "on": mac, "vault": coop, "threshold": 2, "signers": [mac]});
    assert_eq!(refused(&mut tile, alone), "BelowThreshold");
    act(&mut tile, json!({"do": "sync_all"}));
    let left = act(&mut tile, json!({"do": "leave", "on": bob, "vault": coop}));
    assert_eq!(left["signed"], json!(["Bob's passkey"]));
    act(&mut tile, json!({"do": "sync_all"}));
    assert_eq!(find(&vaults(&tile), "name", "Maia Coop")["owners"].as_array().map(Vec::len), Some(1));
    let backup = act(&mut tile, json!({"do": "add_passkey", "on": mac}));
    assert_eq!(backup["signed"], json!(["Samuel's passkey", "Samuel's backup passkey"]));
    let removed = act(&mut tile, json!({"do": "remove_device", "on": mac, "device": ipad}));
    assert_eq!(removed["signed"], json!(["Samuel's passkey"]));
}

#[test]
fn the_lab_shows_what_each_device_holds_and_opens() {
    let mut tile = made();
    let (space, welcome) = (start(&tile, "space"), start(&tile, "entry"));
    let columns = |tile: &Tile| show(tile, json!({"view": "lab", "space": space, "entry": welcome}))["columns"].clone();
    let column = |tile: &Tile, name: &str| {
        columns(tile).as_array().unwrap().iter().find(|c| c["device"]["name"] == name).cloned().unwrap()
    };
    let server = column(&tile, "the server");
    assert_eq!((&server["opens"], &server["writes"]), (&json!(false), &json!(1)));
    assert!(server["bytes"].as_u64().is_some_and(|b| b > 0));
    // the stranger knows the Handbook, for its public Charter, and holds nothing of Welcome
    let stranger = column(&tile, "a stranger");
    assert_eq!((&stranger["knows"], &stranger["writes"]), (&json!(true), &json!(0)));
    assert_eq!(column(&tile, "Carol's Mac")["writes"], json!(0));
    assert_eq!(column(&tile, "Bob's Mac")["value"]["blocks"][1]["text"], json!(WELCOME_TEXT));
    // Bob goes offline, Samuel edits, and Bob hears of it only once back
    let (mac, bob) = (device(&tile, "Samuel's Mac"), device(&tile, "Bob's Mac"));
    act(&mut tile, json!({"do": "online", "on": bob, "online": false}));
    let mut value = show(&tile, json!({"view": "entry", "on": mac, "space": space, "entry": welcome}))["value"].clone();
    value["blocks"][1]["text"] = json!(AFTER_TEXT);
    act(&mut tile, json!({"do": "put", "on": mac, "space": space, "entry": welcome, "value": value}));
    act(&mut tile, json!({"do": "sync_all"}));
    let bobs = column(&tile, "Bob's Mac");
    assert_eq!((&bobs["online"], &bobs["value"]["blocks"][1]["text"]), (&json!(false), &json!(WELCOME_TEXT)));
    act(&mut tile, json!({"do": "online", "on": bob, "online": true}));
    act(&mut tile, json!({"do": "sync_all"}));
    assert_eq!(texts(&tile, &bob, &space, &welcome), ["Welcome", AFTER_TEXT]);
    // the Charter is public: the stranger reads it
    let (charter, stranger) = (entry(&tile, &mac, "Handbook", "Charter"), device(&tile, "a stranger"));
    assert_eq!(texts(&tile, &stranger, &space, &charter), ["Charter", CHARTER_TEXT]);
}

#[test]
fn a_space_publishes_its_schemas_and_shows_what_each_commit_was_written_under() {
    let mut tile = made();
    let (mac, space) = (device(&tile, "Samuel's Mac"), start(&tile, "space"));
    let lane = show(&tile, json!({"view": "schemas", "on": mac, "space": space}));
    let schemas = each(&lane["schemas"], "/id");
    assert!(schemas.contains(&DOCUMENT_V1.id().to_hex()) && schemas.contains(&DOCUMENT_V2.id().to_hex()));
    assert_eq!(lane["lenses"][0]["id"], json!(DOCUMENT_LENS.id().to_hex()));
    assert_eq!(lane["mayPublish"], json!(true));
    let welcome = find(&lane["written"], "title", "Welcome");
    assert_eq!(welcome["commits"][0]["schemas"], json!([DOCUMENT_V1.id().to_hex()]));
    assert_eq!(lane["apps"].as_array().map(Vec::len), Some(6));
    let again = json!({"do": "publish", "on": mac, "space": space, "blob": DOCUMENT_V2.id().to_hex()});
    assert_eq!(refused(&mut tile, again), "AlreadyPublished");
    let found = json!({"do": "found_space", "on": mac, "actor": start(&tile, "coop"), "name": "Recipes"});
    let recipes = act(&mut tile, found)["space"].clone();
    act(&mut tile, json!({"do": "publish", "on": mac, "space": recipes, "blob": DOCUMENT_V2.id().to_hex()}));
    let lane = show(&tile, json!({"view": "schemas", "on": mac, "space": recipes}));
    assert_eq!(lane["schemas"].as_array().map(Vec::len), Some(1));
    assert_eq!(id(&show(&tile, json!({"view": "spaces", "on": mac}))["spaces"], "Recipes"), recipes.as_str().unwrap());
}
