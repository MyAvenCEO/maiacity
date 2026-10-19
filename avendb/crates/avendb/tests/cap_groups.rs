//! Cap groups and invites (`docs/ARCHITECTURE.md` §5, "Cap groups"; `Examples.lean`'s cap groups and invites): a cap
//! group is an entry of its vault, versioned as any entry, and a share names one, copying none of its ops. Every write
//! through it is judged by the version in force where it comes in the replay, so a narrower version narrows the share
//! at once, and the writes made before stand. A share to an invite key is claimed once, by the newcomer's vault, with
//! no owner of the vault it is over signing; then it reads what the group's caps pick, and nothing more.

use avendb::cast::{self, World};
use avendb::doc::Item;
use avendb::engine;
use avendb::lens::View;
use avendb::id::{BlobId, EntryId, ShareId, SignerId};
use avendb::lab::GroupShare;
use avendb::policy::{Level, Refusal, Who};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::slice::{Atom, Selector, Sym};
use serde_json::{json, Value};

fn op(v: Value) -> Op {
    Op::of_json(&v).expect("an op")
}

/// The game's tag, as Maia City tags what a game holds.
const GAME: &str = "game:valley";

/// Whatever is tagged with the game.
fn games() -> Selector {
    Selector::AnyOf(vec![vec![Atom::TagHas(Sym::new(GAME))]])
}

/// Maia City's Traveler: reads the game's entries.
fn traveler() -> CapGroup {
    let read = Cap { op: op(json!({ "op": "read" })), slice: games() };
    CapGroup { name: "Traveler".into(), caps: vec![read], includes: vec![] }
}

/// Citizen: Traveler, and makes a move in the game's logic, its note.
fn citizen(traveler: EntryId) -> CapGroup {
    let moves = Cap { op: op(json!({ "op": "set", "path": ["note"] })), slice: cast::tagged("logic", GAME) };
    CapGroup { name: "Citizen".into(), caps: vec![moves], includes: vec![traveler] }
}

/// A game's rules, after `n` moves.
fn map_at(n: u64) -> Value {
    json!({
        "kind": "logic", "title": "The valley", "note": format!("move {n}"),
        "source": "// the rules\nexport default (x) => x;",
        "engine": { "host": "logic", "version": 4, "hash": "ab".repeat(32) },
        "manifest": { "hooks": ["tick"], "ops": ["set"] },
        "params": [{ "id": 1, "name": "height", "kind": "number", "range": { "min": 0.2, "max": 2, "step": 0.1 },
            "default": 0.6 }],
        "contract": { "budgets": { "bytes": 200000, "ms": 2000 }, "invariants": ["replay-equal"] },
    })
}

/// Alice's vault as Maia City: a game map, a memo, and the Traveler and Citizen groups, all on her Mac.
struct City {
    w: World,
    map: EntryId,
    memo: EntryId,
    traveler: EntryId,
    citizen: EntryId,
}

fn city() -> City {
    let mut w = cast::world();
    let (mac_a, alice) = (w.mac_a, w.alice);
    let item = |record: Value| {
        let (app, record) = full(&record);
        Item::made(app, &record, mac_a).expect("a view of its app")
    };
    let map = w.lab.create(mac_a, alice, alice, "logic", &[GAME], item(map_at(0))).expect("Alice makes the map");
    let memo = item(json!({ "kind": "document", "title": "Plans" }));
    let memo = w.lab.create(mac_a, alice, alice, "document", &[], memo).expect("Alice writes a memo");
    let traveler = w.lab.define_group(mac_a, alice, traveler()).expect("Alice defines Traveler");
    let citizen = w.lab.define_group(mac_a, alice, citizen(traveler)).expect("Alice defines Citizen");
    City { w, map, memo, traveler, citizen }
}

/// A share of Alice's group `group` at level `level` to `who`, on all of her vault.
fn of_group(c: &City, who: Who, group: EntryId, level: Level) -> GroupShare {
    let (alice, name) = (c.w.alice, "Maia City".to_string());
    GroupShare { over: alice, who, name, select: Selector::All, group, level, parent: None, issuer: alice }
}

fn app(kind: &str) -> &'static View {
    View::built_in(kind).expect("a built-in app")
}

/// `record` as the app of its kind shows it, its defaults filled in.
fn full(record: &Value) -> (&'static View, Value) {
    let app = app(record["kind"].as_str().expect("a kind"));
    (app, app.schema().read(record).expect("a view of its app"))
}

/// An edit that makes the item's record `record`, through the app of its kind.
fn to(record: Value) -> impl FnOnce(&mut Item) {
    move |i| {
        let (app, record) = full(&record);
        assert!(i.write(app, &record), "a view of its app");
    }
}

fn moved(c: &City, on: SignerId) -> Value {
    c.w.lab.item(on, c.map).expect("it reads the map").record()["note"].clone()
}

#[test]
fn a_share_names_a_group_and_follows_its_versions() {
    let mut c = city();
    let (mac_a, mac_b, alice, bob) = (c.w.mac_a, c.w.mac_b, c.w.alice, c.w.bob);
    assert_eq!(c.w.lab.group(mac_a, alice, c.citizen), Some(&citizen(c.traveler)));
    assert_eq!(c.w.lab.groups(mac_a, alice).len(), 2);
    let share = of_group(&c, Who::Vault(bob), c.citizen, Level::Write);
    c.w.lab.issue_group(mac_a, &[mac_a], share).expect("Alice makes Bob a citizen");
    c.w.lab.sync(mac_a, mac_b);
    // Bob reads the map, by Traveler, which Citizen includes, and the groups, which every share selects; not the memo
    assert!(c.w.lab.reads(mac_b, c.map));
    assert!(!c.w.lab.reads(mac_b, c.memo));
    assert_eq!(c.w.lab.group(mac_b, alice, c.citizen), Some(&citizen(c.traveler)));
    assert_eq!(c.w.lab.group(mac_b, alice, c.traveler), Some(&traveler()));
    // he moves, and does nothing else
    c.w.lab.edit(mac_b, bob, c.map, to(map_at(1))).expect("Bob moves");
    let mut mine = map_at(1);
    mine["title"] = "Mine".into();
    assert_eq!(c.w.lab.edit(mac_b, bob, c.map, to(mine)), Err(Refusal::NotAllowed));
    c.w.lab.sync(mac_b, mac_a);
    assert_eq!(moved(&c, mac_a), json!("move 1"));
    // a group only its vault writes: Bob's share selects it, but no cap of his sets it
    let mut wide = citizen(c.traveler).record();
    wide["caps"] = json!([{ "op": "set", "path": [] }]);
    assert_eq!(c.w.lab.edit(mac_b, bob, c.citizen, to(wide)), Err(Refusal::NotAllowed));
    // Alice narrows Citizen to Traveler: Bob's next move is refused, and a patched app's isn't counted; he still
    // reads, and his first move stands
    let narrow = CapGroup { caps: vec![], ..citizen(c.traveler) };
    c.w.lab.redefine_group(mac_a, alice, c.citizen, narrow.clone()).expect("Alice narrows Citizen");
    assert_eq!(c.w.lab.group(mac_a, alice, c.citizen), Some(&narrow));
    c.w.lab.sync(mac_a, mac_b);
    assert_eq!(c.w.lab.group(mac_b, alice, c.citizen), Some(&narrow));
    assert_eq!(c.w.lab.edit(mac_b, bob, c.map, to(map_at(2))), Err(Refusal::NotAllowed));
    c.w.lab.patched(|lab| lab.edit(mac_b, bob, c.map, to(map_at(2)))).expect("a patched app writes all the same");
    c.w.lab.sync(mac_b, mac_a);
    assert_eq!(moved(&c, mac_a), json!("move 1"));
    assert_eq!(moved(&c, mac_b), json!("move 1"));
    assert!(c.w.lab.reads(mac_b, c.map));
    // only the vault's own versions say what a group is
    assert_eq!(c.w.lab.redefine_group(mac_b, bob, c.citizen, citizen(c.traveler)), Err(Refusal::UnknownEntry));
}

#[test]
fn an_invite_is_claimed_once_with_no_owner_signing() {
    let mut c = city();
    let (mac_a, alice) = (c.w.mac_a, c.w.alice);
    let key = c.w.lab.invite_key([7; 32]);
    let owner = of_group(&c, Who::Invite(key), c.traveler, Level::Owner);
    assert_eq!(c.w.lab.issue_group(mac_a, &[mac_a], owner).err(), Some(Refusal::InviteOwner));
    let share = of_group(&c, Who::Invite(key), c.traveler, Level::Read);
    let invite: ShareId = c.w.lab.issue_group(mac_a, &[mac_a], share).expect("Alice invites a traveler");
    // Erin signs up: her passkey founds her vault, and her Mac claims the invite her link carries
    let passkey_e = c.w.lab.passkey("Erin");
    let mac_e = c.w.lab.device_of(passkey_e, "Erin's Mac");
    let erin = cast::human_on(&mut c.w.lab, passkey_e, &[mac_e]);
    c.w.lab.sync(mac_a, mac_e);
    assert!(!c.w.lab.reads(mac_e, c.map));
    c.w.lab.hand_invite(mac_a, mac_e, invite).expect("the link carries the invite");
    let wrong = c.w.lab.invite_key([8; 32]);
    assert_eq!(c.w.lab.claim_invite(mac_e, invite, erin, wrong), Err(Refusal::NoConsent));
    assert_eq!(c.w.lab.claim_invite(mac_e, invite, alice, key), Err(Refusal::NotActing));
    c.w.lab.claim_invite(mac_e, invite, erin, key).expect("Erin's vault claims the invite");
    // once claimed, the share goes to Erin's vault, no longer to the key
    assert_eq!(c.w.lab.claim_invite(mac_e, invite, erin, key), Err(Refusal::NotInvite));
    // Alice's Mac takes the claim and boxes the share's key for Erin; Erin reads the map and the groups, nothing more
    c.w.lab.sync(mac_e, mac_a);
    let held = c.w.lab.state(mac_a).share(invite).expect("Alice's Mac knows the invite").share.who;
    assert_eq!(held, Who::Vault(erin));
    c.w.lab.sync(mac_a, mac_e);
    assert!(c.w.lab.reads(mac_e, c.map));
    assert!(!c.w.lab.reads(mac_e, c.memo));
    assert_eq!(moved(&c, mac_e), json!("move 0"));
    assert_eq!(c.w.lab.group(mac_e, alice, c.traveler), Some(&traveler()));
    // a share to read writes nothing
    assert_eq!(c.w.lab.edit(mac_e, erin, c.map, to(map_at(1))), Err(Refusal::NoCap));
}

/// What op `op` answers on device `on`, made: its `ok`.
fn ran(c: &mut City, on: SignerId, op: Value) -> Value {
    let out = engine::run(&mut c.w.lab, on, &op);
    out.get("ok").cloned().unwrap_or_else(|| panic!("{op}: {out}"))
}

#[test]
fn the_engine_defines_lists_shares_and_narrows_cap_groups_and_hands_out_an_invites_secret() {
    let mut c = city();
    let (mac_a, mac_b, alice, bob) = (c.w.mac_a, c.w.mac_b, c.w.alice.to_hex(), c.w.bob.to_hex());
    let defined = ran(&mut c, mac_a, json!({ "op": "define_group", "vault": alice, "group": traveler().to_json() }));
    let entry = defined["entry"].as_str().expect("its entry").to_string();
    let groups = ran(&mut c, mac_a, json!({ "op": "cap_groups", "vault": alice }));
    let names: Vec<&str> = groups.as_array().unwrap().iter().map(|g| g["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["Traveler", "Citizen", "Traveler"]);
    assert_eq!(groups[2]["entry"], json!(entry));
    // a share of it to Bob names the group: Bob reads the map, not the memo
    let to_bob = json!({ "op": "share_group", "over": alice, "group": entry, "who": { "vault": bob } });
    let share = ran(&mut c, mac_a, to_bob)["share"].as_str().expect("the share").to_string();
    c.w.lab.sync(mac_a, mac_b);
    assert!(c.w.lab.reads(mac_b, c.map) && !c.w.lab.reads(mac_b, c.memo));
    let shares = ran(&mut c, mac_a, json!({ "op": "shares", "over": alice }));
    let row = shares["rows"].as_array().unwrap().iter().find(|r| r["id"] == json!(share)).expect("its row").clone();
    assert_eq!((row["group"].clone(), row["capGroup"].clone()), (json!("Traveler"), json!(entry)));
    // an invite: the answer carries its link's secret, which makes the key that claims it
    let invite = json!({ "op": "share_group", "over": alice, "group": entry, "who": "invite" });
    let invited = ran(&mut c, mac_a, invite);
    let (share, secret) = (invited["share"].as_str().unwrap(), invited["secret"].as_str().unwrap());
    let share = ShareId::from_hex(share).expect("a share id");
    let secret = BlobId::from_hex(secret).expect("64 hex digits").0;
    let passkey_e = c.w.lab.passkey("Erin");
    let mac_e = c.w.lab.device_of(passkey_e, "Erin's Mac");
    let erin = cast::human_on(&mut c.w.lab, passkey_e, &[mac_e]);
    c.w.lab.hand_invite(mac_a, mac_e, share).expect("the link carries the invite");
    let key = c.w.lab.invite_key(secret);
    c.w.lab.claim_invite(mac_e, share, erin, key).expect("the secret makes the invite's key again");
    // a new version: the one in force says it from there on
    let none = json!({ "name": "Nobody", "caps": [] });
    ran(&mut c, mac_a, json!({ "op": "redefine_group", "entry": entry, "group": none }));
    let groups = ran(&mut c, mac_a, json!({ "op": "cap_groups", "vault": alice }));
    assert_eq!(groups[2]["name"], json!("Nobody"));
    let wrong = engine::run(&mut c.w.lab, mac_a, &json!({ "op": "share_group", "over": alice, "group": entry }));
    assert_eq!(wrong["refused"], json!("BadOp"), "a share names whom it goes to");
}
