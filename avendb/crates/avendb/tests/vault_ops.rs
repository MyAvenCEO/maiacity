//! The ops on vaults (`docs/ARCHITECTURE.md` §8, `engine::vaults`): what a device's page reads of its world, of
//! the shares over a vault and of what a vault may add and tag in another; and the changes of vaults, each answered
//! done, refused by its rule's name, or, where the vault's owners approve it, `approve`, which makes nothing until the
//! passkey's ceremony signs the drafts (`engine::approve`, as avendb-net's `Node::run` has it signed). `may` answers
//! each before a page offers its button: `true`, `{"approve": {signers}}` or the refusal. Every op is JSON, as the page
//! and the Mac app send it.

use std::sync::Arc;

use avendb::cast::{self, World};
use avendb::engine::{self, Prepared};
use avendb::id::{BlobId, EntryId, ShareId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::lens::example::blobs::TODO_LENS;
use avendb::policy::{Action, KeepMode, Kind, Level, Principal, Sharing};
use avendb::recovery::RecoveryKey;
use avendb::sealed::{Brought, FileKey, seal};
use avendb::sign;
use avendb::slice::Selector;
use avendb::world;
use serde_json::{Value, json};

fn run(w: &mut World, d: SignerId, op: Value) -> Value {
    engine::run(&mut w.lab, d, &op)
}

/// What an op answered, which it must have done.
fn ok(answer: Value) -> Value {
    assert!(answer.get("ok").is_some(), "not done: {answer}");
    answer["ok"].clone()
}

/// Why an op was refused, which it must have been.
fn refused(answer: &Value) -> &str {
    answer["refused"].as_str().unwrap_or_else(|| panic!("not refused: {answer}"))
}

/// What `may` answers of each of `ops` on device `d`.
fn may(w: &mut World, d: SignerId, ops: Value) -> Vec<Value> {
    ok(run(w, d, json!({ "op": "may", "ops": ops }))).as_array().cloned().expect("an answer for each op")
}

/// What `may` answers of an op the passkey `passkey` would approve, alone or with a newcomer.
fn approves(signers: &[SignerId]) -> Value {
    json!({ "approve": { "signers": signers.iter().map(|s| s.to_hex()).collect::<Vec<_>>() } })
}

/// Op `op` on device `d`, which its vault's owners approve, signed in passkey `passkey`'s ceremony over its challenge
/// and kept, as `Node::run` has it signed: its answer.
fn approved(w: &mut World, d: SignerId, passkey: SignerId, op: Value) -> Value {
    let Ok(Prepared::Approve(a)) = engine::prepare(&mut w.lab, d, &op) else { panic!("{op} waits for approval") };
    let ceremony = w.lab.ceremony(passkey, a.challenge()).expect("a software passkey's ceremony");
    engine::approve(&mut w.lab, d, a, &ceremony).unwrap_or_else(|why| panic!("{op} refused: {}", why.to_json()))
}

/// The id an answer names at `field`.
fn id(answer: &Value, field: &str) -> [u8; 32] {
    let text = answer[field].as_str().unwrap_or_else(|| panic!("an id at {field}: {answer}"));
    BlobId::from_hex(text).expect("64 hex digits").0
}

/// Vault `v` as device `d` sees it.
fn vault(lab: &Lab, d: SignerId, v: VaultId) -> avendb::policy::Vault {
    lab.state(d).vault(v).expect("the vault").clone()
}

/// A vault as the world shows it, by its id.
fn shown(world: &Value, v: VaultId) -> Value {
    let vaults = world["vaults"].as_array().expect("its vaults");
    vaults.iter().find(|x| x["id"] == v.to_hex()).cloned().unwrap_or_else(|| panic!("{v:?} in the world"))
}

/// A share op as the page sends it.
fn share(over: VaultId, who: Value, level: Value, what: Value) -> Value {
    json!({ "op": "share", "over": over.to_hex(), "who": who, "level": level, "what": what })
}

fn to(v: VaultId) -> Value {
    json!({ "vault": v.to_hex() })
}

#[test]
fn the_world_is_the_devices_view_and_null_for_a_device_of_no_vault() {
    let mut w = cast::world();
    let (mac, alice, stranger, passkey) = (w.mac_a, w.alice, w.stranger, w.passkey_a);
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    assert_eq!((&seen["me"], &seen["mine"]), (&json!(mac.to_hex()), &json!(alice.to_hex())));
    assert_eq!(seen["ownsServer"], true, "Alice's vault claimed the server");
    assert_eq!(seen["kinds"], avendb::words::kinds_json(), "the kind table, for the page to read");
    let mine = shown(&seen, alice);
    assert_eq!(mine["acting"], json!({ "as": alice.to_hex(), "reaches": true, "shares": true }));
    assert_eq!((&mine["kind"], &mine["root"]), (&json!("human"), &json!(passkey.to_hex())));
    let groups = seen["groups"].as_array().expect("the groups");
    assert!(groups.iter().all(|g| g["level"].is_string()), "each with its level: {groups:?}");
    assert_eq!(run(&mut w, stranger, json!({ "op": "world" })), json!({ "ok": null }), "it belongs to no vault");
    let extra = run(&mut w, mac, json!({ "op": "world", "vault": alice.to_hex() }));
    assert_eq!(refused(&extra), "BadOp", "world takes no field");
    assert!(engine::reads(&json!({ "op": "world" })) && !engine::reads(&json!({ "op": "share" })));
    assert!(engine::asks(&json!({ "op": "shares" })) && engine::asks(&json!({ "op": "may" })));
    // a node's jobs read nothing of the Lab: a node answers them (avendb-net's Node::run)
    let jobs = json!({ "op": "jobs" });
    assert!(engine::reads(&jobs) && refused(&engine::read(&w.lab, mac, &jobs)) == "BadOp");
}

#[test]
fn the_server_is_read_from_the_seed_and_a_coops_drive_is_no_server() {
    let mut w = cast::world();
    let (mac, passkey, bob, avenceo) = (w.mac_b, w.passkey_b, w.bob, w.avenceo);
    let st = w.lab.state(mac);
    assert_eq!(world::seeder(st, avenceo), Some(w.alice), "avenCEO server ends the seed Alice's vault founded");
    let owners = |v: VaultId| st.vault(v).map(|v| v.owners.clone()).expect("the vault");
    let [Principal::Vault(gmbh)] = owners(avenceo)[..] else { panic!("one owner, avenCEO GmbH") };
    let [Principal::Vault(holding)] = owners(gmbh)[..] else { panic!("one owner, Maia Holding GmbH") };
    assert_eq!(owners(holding), [Principal::Vault(w.alice)], "which her vault owns");
    // Bob's coop, his alone, and its drive: a device vault under it, the drive its one device, which his vault gives
    // backup on the whole of it
    let found = |lab: &mut Lab, kind: Kind, owner: VaultId, nonce: u64| {
        let owners = vec![Principal::Vault(owner)];
        let genesis = Action::Genesis { kind, owners, threshold: 1, root: None, nonce, seal_to: vec![] };
        VaultId::from(lab.submit(mac, &[passkey], genesis).expect("his passkey founds it"))
    };
    let coop = found(&mut w.lab, Kind::Coop, bob, 1);
    let drives = found(&mut w.lab, Kind::DeviceVault, coop, 2);
    let drive = w.lab.device("Bob's drive");
    let add = Action::Share(Sharing::Device { vault: drives, device: drive, seal_to: None });
    w.lab.submit(mac, &[passkey, drive], add).expect("its drive");
    let backup = cast::share(bob, cast::vault(drives), Level::Backup, Selector::All);
    w.lab.issue(mac, &[mac], backup).expect("his vault gives the drive backup");
    // the drive's device vault ends no seed: no server, so Bob's vault owns none and relays to none
    let st = w.lab.state(mac);
    assert_eq!(world::seeder(st, drives), None, "a coop's drive's vault ends no seed");
    assert_eq!(world::avenceo(st, bob), None, "his vault relays to no server");
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    assert_eq!((&seen["ownsServer"], &seen["backsUp"]), (&json!(false), &Value::Null), "nor owns one");
    // once his vault gives avenCEO server relay, that is his server
    let relay = cast::share(bob, cast::vault(avenceo), Level::Relay, Selector::All);
    w.lab.issue(mac, &[mac], relay).expect("his vault gives the server relay");
    assert_eq!(world::avenceo(w.lab.state(mac), bob), Some(avenceo));
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    assert_eq!((&seen["ownsServer"], &seen["backsUp"]), (&json!(false), &json!(false)), "Alice's, relay alone");
}

#[test]
fn shares_lists_a_vaults_owners_devices_and_shares_each_with_may_of_its_revoke() {
    let mut w = cast::world();
    let t = cast::todos_on(&mut w);
    w.lab.sync_all(0);
    let (mac, phone, alice, passkey) = (w.mac_a, w.phone_a, w.alice, w.passkey_a);
    let listed = ok(run(&mut w, mac, json!({ "op": "shares", "over": alice.to_hex() })));
    assert_eq!((&listed["over"], &listed["as"]), (&json!(alice.to_hex()), &json!(alice.to_hex())));
    assert_eq!(listed["share"], true, "Alice's vault may share it on");
    let rows = listed["rows"].as_array().expect("its rows");
    let kinds: Vec<&str> = rows.iter().map(|r| r["kind"].as_str().expect("a kind")).collect();
    assert_eq!(kinds, ["owner", "device", "device", "grant", "grant", "grant", "grant"]);
    let owner = &rows[0];
    assert_eq!(owner["who"], json!({ "signer": passkey.to_hex() }));
    assert_eq!((&owner["root"], &owner["recovery"], &owner["group"]), (&json!(true), &json!(false), &json!("Owner")));
    assert_eq!(refused(&owner["revoke"]), "LastOwner", "a vault keeps an owner");
    assert_eq!((&rows[1]["who"], &rows[1]["level"]), (&json!({ "device": mac.to_hex() }), &json!("actsFor")));
    assert_eq!(rows[1]["revoke"], true, "the device itself leaves alone");
    assert_eq!(rows[2]["revoke"], approves(&[passkey]), "another device's place her passkey ends");
    // the grants, the strongest first: the coop's owner share on the door, which her passkey ends, then Bob's write
    let levels: Vec<&str> = rows[3..].iter().map(|r| r["level"].as_str().expect("a level")).collect();
    assert_eq!(levels, ["owner", "write", "read", "backup"]);
    let coop = &rows[3];
    assert_eq!(coop["id"], t.coop_owner.to_hex());
    assert_eq!((&coop["who"], &coop["group"]), (&to(t.coop), &json!("Owner")));
    assert_eq!((&coop["what"], &coop["reaches"]), (&json!({ "entry": [t.door.to_hex()] }), &json!(1)));
    assert_eq!(coop["revoke"], approves(&[passkey]));
    assert_eq!((&rows[4]["id"], &rows[4]["revoke"]), (&json!(t.bob_write.to_hex()), &json!(true)));
    assert_eq!((&rows[6]["what"], &rows[6]["group"]), (&json!("everything"), &json!("Backup")), "avenCEO's");
    assert_eq!(rows[6]["reaches"], 3, "every entry of her vault");
    // her iPhone lists the same
    let again = ok(run(&mut w, phone, json!({ "op": "shares", "over": alice.to_hex() })));
    assert_eq!(again["rows"].as_array().map(Vec::len), Some(7));
    // Bob's Mac acts there as the coop, whose owner share on the door is the strongest it acts through: the coop may
    // share the door on, and ends no share it didn't issue
    let mac_b = w.mac_b;
    let bobs = ok(run(&mut w, mac_b, json!({ "op": "shares", "over": alice.to_hex() })));
    assert_eq!(bobs["as"], t.coop.to_hex());
    assert_eq!(bobs["share"], true);
    let rows = bobs["rows"].as_array().expect("its rows");
    let carols = rows.iter().find(|r| r["id"] == t.carol_read.to_hex()).expect("Carol's share");
    assert!(carols["revoke"].get("refused").is_some(), "{}", carols["revoke"]);
    let as_bob = json!({ "op": "shares", "over": alice.to_hex(), "as": w.bob.to_hex() });
    let bobs = ok(run(&mut w, mac_b, as_bob));
    assert_eq!(bobs["as"], w.bob.to_hex());
    assert!(bobs["share"].get("refused").is_some(), "Bob's vault shares nothing of hers on: {}", bobs["share"]);
    let unknown = run(&mut w, mac, json!({ "op": "shares", "over": BlobId([7; 32]).to_hex() }));
    assert_eq!(refused(&unknown), "UnknownVault");
}

#[test]
fn a_share_is_issued_alone_and_one_at_owner_level_once_the_passkey_approves() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (mac, alice, bob, carol, passkey) = (w.mac_a, w.alice, w.bob, w.carol, w.passkey_a);
    let plan = json!({ "entry": [l.plan.to_hex()] });
    // a read share by id: alone
    let viewer = share(alice, to(bob), json!("Viewer"), plan.clone());
    assert_eq!(may(&mut w, mac, json!([viewer])), [json!(true)]);
    let read = ShareId(id(&ok(run(&mut w, mac, viewer)), "share"));
    assert!(w.lab.state(mac).live(read));
    // Owner on a slice: the passkey approves it; without a ceremony the op answers its draft and makes nothing
    let owner = share(alice, to(carol), json!("Owner"), json!({ "type": ["todo"] }));
    assert_eq!(may(&mut w, mac, json!([owner])), [approves(&[passkey])]);
    let before = w.lab.state(mac).shares().len();
    let asked = run(&mut w, mac, owner.clone());
    let draft = &asked["approve"];
    assert_eq!(draft["signers"], json!([passkey.to_hex()]));
    assert_eq!(draft["challenge"].as_str().map(str::len), Some(64), "{asked}");
    let bytes = sign::unbase64url(draft["draft"].as_str().expect("the draft")).expect("base64url");
    let first = u32::from_le_bytes(bytes[..4].try_into().expect("a length")) as usize;
    assert_eq!(bytes.len(), 4 + first, "one edit, behind its length");
    assert_eq!(w.lab.state(mac).shares().len(), before, "nothing made");
    // a ceremony of another passkey signs nothing
    let Ok(Prepared::Approve(a)) = engine::prepare(&mut w.lab, mac, &owner) else { panic!("it waits for approval") };
    let wrong = w.lab.ceremony(w.passkey_b, a.challenge()).expect("Bob's passkey's ceremony");
    let why = engine::approve(&mut w.lab, mac, a, &wrong).expect_err("not her passkey");
    assert_eq!(why.to_json()["refused"], "BadSignature");
    let made = ShareId(id(&approved(&mut w, mac, passkey, owner), "share"));
    let st = w.lab.state(mac);
    assert_eq!(st.shares().iter().find(|cp| cp.id == made).map(|cp| cp.share.level), Some(Level::Owner));
    // refused, each by its rule's name
    let refusals = [
        (share(alice, json!({ "signer": w.passkey_b.to_hex() }), json!("Viewer"), plan.clone()), "DeviceOnlyKeeps"),
        (share(alice, to(bob), json!("keepWhole"), plan.clone()), "KeepNeedsDevice"),
        (share(alice, json!("everyone"), json!("Editor"), plan.clone()), "PublicBeyondRead"),
        (share(alice, to(alice), json!("Viewer"), plan.clone()), "CapToItself"),
        (share(alice, to(bob), json!("Nobody"), plan.clone()), "BadOp"),
        (share(alice, json!({ "device": mac.to_hex() }), json!("actsFor"), plan.clone()), "BadOp"),
        (share(alice, json!("someone"), json!("Viewer"), plan.clone()), "BadOp"),
        (share(alice, to(bob), json!({ "name": "Mine", "ops": [{ "op": "fly" }] }), plan.clone()), "BadOp"),
    ];
    for (op, why) in refusals {
        assert_eq!(refused(&may(&mut w, mac, json!([op.clone()]))[0]), why, "may of {op}");
        assert_eq!(refused(&run(&mut w, mac, op.clone())), why, "{op}");
    }
    // a group of its own; then Bob's read share ends, alone, and once only
    let own = json!({ "name": "Plan readers", "ops": [{ "op": "read" }] });
    ok(run(&mut w, mac, share(alice, to(carol), own, plan)));
    let end = json!({ "op": "revoke", "share": read.to_hex() });
    assert_eq!(may(&mut w, mac, json!([end])), [json!(true)]);
    assert!(ok(run(&mut w, mac, end.clone()))["edit"].is_string());
    assert!(!w.lab.state(mac).live(read));
    assert_eq!(refused(&run(&mut w, mac, end)), "Revoked");
    // a vault op runs alone, never in a batch
    let batch = json!({ "op": "batch", "ops": [{ "op": "card", "name": "Mac" }] });
    assert_eq!(refused(&run(&mut w, mac, batch)), "BadOp");
}

#[test]
fn owner_of_everything_makes_a_co_owner_once_the_passkey_approves() {
    let mut w = cast::world();
    let master = w.lab.set_recovery(Arc::new(RecoveryKey::of([11; 32])));
    let (mac, alice, bob, passkey) = (w.mac_a, w.alice, w.bob, w.passkey_a);
    // the master recovery key, an owner of Alice's vault: it signs too, by its standing consent
    let add = share(alice, json!({ "signer": master.to_hex() }), json!("Owner"), json!("everything"));
    assert_eq!(may(&mut w, mac, json!([add])), [approves(&[passkey, master])]);
    let asked = run(&mut w, mac, add.clone());
    assert_eq!(asked["approve"]["signers"], json!([passkey.to_hex(), master.to_hex()]));
    assert_eq!(vault(&w.lab, mac, alice).owners, [Principal::Signer(passkey)], "nothing made");
    assert!(approved(&mut w, mac, passkey, add.clone())["edit"].is_string());
    assert_eq!(vault(&w.lab, mac, alice).owners, [Principal::Signer(passkey), Principal::Signer(master)]);
    assert_eq!(refused(&may(&mut w, mac, json!([add]))[0]), "AlreadyMember");
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    assert_eq!(seen["recovery"], master.to_hex());
    let owners = shown(&seen, alice)["owners"].clone();
    assert_eq!(owners[1], json!({ "signer": master.to_hex(), "recovery": true }));
    let listed = ok(run(&mut w, mac, json!({ "op": "shares", "over": alice.to_hex() })));
    assert_eq!(listed["rows"][1]["recovery"], true);
    // and out again, as any owner
    let out = json!({ "op": "revoke", "vault": alice.to_hex(), "owner": { "signer": master.to_hex() } });
    assert_eq!(may(&mut w, mac, json!([out])), [approves(&[passkey])]);
    assert!(approved(&mut w, mac, passkey, out)["edit"].is_string());
    assert_eq!(vault(&w.lab, mac, alice).owners, [Principal::Signer(passkey)]);
    // a human vault has no vault among its owners
    let vaults = share(alice, to(bob), json!("Owner"), json!("everything"));
    assert_eq!(refused(&may(&mut w, mac, json!([vaults]))[0]), "WrongOwnerKind");
    // a coop her vault founds takes another of hers as a co-owner, which her passkey consents for too; Bob's vault
    // would have to consent itself
    let (x, coop) = (founded(&mut w, "coop", "Garden COOP"), founded(&mut w, "coop", "Maia City COOP"));
    let co = share(x, to(coop), json!("Owner"), json!("everything"));
    assert_eq!(may(&mut w, mac, json!([co])), [approves(&[passkey])]);
    assert!(approved(&mut w, mac, passkey, co)["edit"].is_string());
    assert_eq!(vault(&w.lab, mac, x).owners, [Principal::Vault(alice), Principal::Vault(coop)]);
    let bobs = share(x, to(bob), json!("Owner"), json!("everything"));
    assert_eq!(refused(&may(&mut w, mac, json!([bobs]))[0]), "NoConsent");
    // her aven has her vault as its one owner: no other joins it
    let aven = founded(&mut w, "aven", "avenALICE");
    let bobs = share(aven, to(bob), json!("Owner"), json!("everything"));
    assert_eq!(refused(&may(&mut w, mac, json!([bobs]))[0]), "OneOwner");
}

/// A vault's id, as an answer names it.
fn vault_id(v: &Value) -> VaultId {
    VaultId::from_hex(v.as_str().unwrap_or_else(|| panic!("a vault's id: {v}"))).expect("64 hex digits")
}

/// The vault of kind `kind` Alice's vault founds alone, named `name`, once her passkey approved it.
fn founded(w: &mut World, kind: &str, name: &str) -> VaultId {
    let (mac, passkey) = (w.mac_a, w.passkey_a);
    let new = approved(w, mac, passkey, json!({ "op": "found", "kind": kind, "name": name }));
    vault_id(&new["vaults"][0])
}

#[test]
fn a_vaults_threshold_changes_once_the_passkey_approves() {
    let mut w = cast::world();
    let (mac, alice, passkey, stranger) = (w.mac_a, w.alice, w.passkey_a, w.stranger);
    let (x, y) = (founded(&mut w, "coop", "Garden COOP"), founded(&mut w, "coop", "Maia City COOP"));
    approved(&mut w, mac, passkey, share(x, to(y), json!("Owner"), json!("everything")));
    let two = json!({ "op": "settings", "vault": x.to_hex(), "threshold": 2 });
    assert_eq!(may(&mut w, mac, json!([two])), [approves(&[passkey])]);
    let asked = run(&mut w, mac, two.clone());
    assert_eq!(asked["approve"]["signers"], json!([passkey.to_hex()]), "{asked}");
    assert_eq!(vault(&w.lab, mac, x).threshold, 1, "nothing made");
    assert!(approved(&mut w, mac, passkey, two)["edit"].is_string());
    assert_eq!(vault(&w.lab, mac, x).threshold, 2);
    // the coop, which Alice's and Bob's vaults own with a threshold of two: her passkey alone approves no change
    let coop = cast::coop_on(&mut w);
    let one = json!({ "op": "settings", "vault": coop.to_hex(), "threshold": 1 });
    assert_eq!(refused(&may(&mut w, mac, json!([one.clone()]))[0]), "BelowThreshold");
    assert_eq!(refused(&run(&mut w, mac, one)), "BelowThreshold", "Bob's vault must approve it too");
    let refusals = [
        (json!({ "op": "settings", "vault": alice.to_hex(), "threshold": 3 }), "BadThreshold"),
        (json!({ "op": "settings", "vault": x.to_hex(), "root": passkey.to_hex() }), "NotHuman"),
        (json!({ "op": "settings", "vault": x.to_hex() }), "BadOp"),
        (json!({ "op": "settings", "vault": x.to_hex(), "threshold": 1, "root": null }), "BadOp"),
        (json!({ "op": "settings", "vault": x.to_hex(), "threshold": "two" }), "BadOp"),
    ];
    for (op, why) in refusals {
        assert_eq!(refused(&may(&mut w, mac, json!([op.clone()]))[0]), why, "may of {op}");
        assert_eq!(refused(&run(&mut w, mac, op.clone())), why, "{op}");
    }
    let theirs = json!({ "op": "settings", "vault": alice.to_hex(), "threshold": 1 });
    assert_eq!(refused(&run(&mut w, stranger, theirs.clone())), "NotActing");
    let mac_b = w.mac_b;
    assert_eq!(refused(&run(&mut w, mac_b, theirs)), "NotActing", "Bob's Mac doesn't act for Alice's vault");
}

#[test]
fn new_vaults_are_founded_in_one_ceremony_each_with_its_profile() {
    let mut w = cast::world();
    let (mac, alice, passkey) = (w.mac_a, w.alice, w.passkey_a);
    let four = json!({ "op": "found", "vaults": [
        { "kind": "aven", "name": "avenALICE" },
        { "kind": "device", "name": "Alice's server" },
        { "kind": "coop", "name": "Maia City COOP" },
    ] });
    assert_eq!(may(&mut w, mac, json!([four])), [approves(&[passkey])]);
    let known = w.lab.state(mac).vaults().len();
    let asked = run(&mut w, mac, four.clone());
    let bytes = sign::unbase64url(asked["approve"]["draft"].as_str().expect("the draft")).expect("base64url");
    let mut at = 0;
    let mut drafts = 0;
    while at < bytes.len() {
        at += 4 + u32::from_le_bytes(bytes[at..at + 4].try_into().expect("a length")) as usize;
        drafts += 1;
    }
    assert_eq!((at, drafts), (bytes.len(), 3), "three geneses, each behind its length");
    assert_eq!(w.lab.state(mac).vaults().len(), known, "nothing made");
    let made = approved(&mut w, mac, passkey, four);
    let ids: Vec<VaultId> = made["vaults"].as_array().expect("the vaults").iter().map(vault_id).collect();
    assert_eq!(ids.len(), 3);
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let named = [("aven", "avenALICE"), ("device", "Alice's server"), ("coop", "Maia City COOP")];
    for (v, (kind, name)) in ids.iter().zip(named) {
        let x = shown(&seen, *v);
        assert_eq!((&x["kind"], &x["name"]), (&json!(kind), &json!(name)), "{x}");
        assert_eq!((&x["owners"], &x["root"]), (&json!([to(alice)]), &Value::Null), "her vault owns it");
        assert_eq!(x["via"], json!([alice.to_hex()]), "her Mac acts for it through her vault");
    }
    let kinds: Vec<Kind> = ids.iter().map(|&v| vault(&w.lab, mac, v).kind).collect();
    assert_eq!(kinds, [Kind::Aven, Kind::DeviceVault, Kind::Coop]);
    // the kind table says what her vault founds: no human vault, and no second aven
    let human = json!({ "op": "found", "kind": "human", "name": "Me" });
    assert_eq!(refused(&run(&mut w, mac, human)), "WrongOwnerKind");
    let second = json!({ "op": "found", "kind": "aven", "name": "avenBOB" });
    assert_eq!(refused(&run(&mut w, mac, second)), "SecondAven");
    let refusals = [
        json!({ "op": "found", "kind": "ghost", "name": "Boo" }),
        json!({ "op": "found", "kind": "aven" }),
        json!({ "op": "found", "vaults": [] }),
        json!({ "op": "found", "vaults": [{ "kind": "aven", "name": "x" }], "kind": "aven" }),
    ];
    for op in refusals {
        assert_eq!(refused(&run(&mut w, mac, op.clone())), "BadOp", "{op}");
    }
    let stranger = w.stranger;
    let theirs = json!({ "op": "found", "kind": "aven", "name": "x" });
    assert_eq!(refused(&run(&mut w, stranger, theirs)), "NotActing", "a device of no vault founds none");
}

#[test]
fn a_keep_share_names_a_device_of_the_vault_and_only_its_issuer_ends_it() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, phone, alice) = (w.mac_a, w.phone_a, w.alice);
    let keep = json!({ "op": "keep", "over": alice.to_hex(), "mode": "whole", "what": { "type": ["todo"] } });
    assert_eq!(may(&mut w, mac, json!([keep])), [json!(true)]);
    let made = ShareId(id(&ok(run(&mut w, mac, keep)), "share"));
    let phones = json!({ "op": "keep", "over": alice.to_hex(), "mode": "never", "device": phone.to_hex() });
    ok(run(&mut w, mac, phones));
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let shares = seen["shares"].as_array().expect("its shares");
    let row = shares.iter().find(|c| c["id"] == made.to_hex()).expect("the keep share");
    assert_eq!((&row["level"], &row["who"]), (&json!("keepWhole"), &json!(mac.to_hex())), "{row}");
    assert_eq!((&row["reads"], &row["gets"], &row["group"]), (&json!(false), &json!(false), &json!("Keep whole")));
    let listed = ok(run(&mut w, mac, json!({ "op": "shares", "over": alice.to_hex() })));
    let rows = listed["rows"].as_array().expect("its rows");
    let kept = rows.iter().find(|r| r["id"] == made.to_hex()).expect("its row");
    assert_eq!((&kept["kind"], &kept["level"], &kept["revoke"]), (&json!("keep"), &json!("keepWhole"), &json!(true)));
    let bad = json!({ "op": "keep", "over": alice.to_hex(), "mode": "sometimes" });
    assert_eq!(refused(&run(&mut w, mac, bad)), "BadOp");
    let stranger = json!({ "op": "keep", "over": alice.to_hex(), "mode": "whole", "device": w.mac_b.to_hex() });
    assert_eq!(refused(&run(&mut w, mac, stranger)), "NotDevice");
    let end = json!({ "op": "revoke", "share": made.to_hex(), "as": alice.to_hex() });
    assert!(ok(run(&mut w, mac, end))["edit"].is_string());
    assert!(!w.lab.state(mac).live(made));
}

#[test]
fn a_devices_copy_setting_is_one_wide_keep_share_its_vault_issues_over_itself() {
    let mut w = cast::world();
    let lib = cast::library(&mut w);
    let (mac, phone, alice) = (w.mac_a, w.phone_a, w.alice);
    let copy = |full: bool| json!({ "op": "copy", "device": phone.to_hex(), "full": full });
    let copies = |w: &World| {
        let st = w.lab.state(mac);
        st.copy_of(phone).map(|k| (k.id, k.share.level, k.share.wide, k.share.over, k.share.issuer)).collect::<Vec<_>>()
    };
    let shown_copy = |w: &mut World, d: SignerId| {
        let world = ok(run(w, mac, json!({ "op": "world" })));
        let devices = shown(&world, alice)["devices"].as_array().cloned().expect("its devices");
        devices.iter().find(|x| x["id"] == d.to_hex()).map(|x| x["copy"].clone()).expect("the device")
    };
    // nothing set: it syncs every entry and keeps a file only by the node's own default
    assert_eq!((shown_copy(&mut w, phone), shown_copy(&mut w, mac)), (Value::Null, Value::Null));
    let door = |w: &World| w.lab.state(mac).entry(lib.door).cloned().expect("the door todo");
    assert_eq!(w.lab.state(mac).keeps(phone, &door(&w)), None);
    // a full copy: its vault issues it, a device alone, no passkey; the phone keeps every file whole
    assert_eq!(may(&mut w, mac, json!([copy(true)])), [json!(true)]);
    let full = ShareId(id(&ok(run(&mut w, mac, copy(true))), "share"));
    assert_eq!(copies(&w), [(full, Level::Keep(KeepMode::Whole), true, alice, alice)]);
    assert_eq!(shown_copy(&mut w, phone), json!("full"));
    assert_eq!(w.lab.state(mac).keeps(phone, &door(&w)), Some(true));
    assert!(w.lab.state(mac).wants(phone, &door(&w)));
    // the same again issues nothing
    assert_eq!(ok(run(&mut w, mac, copy(true)))["share"], json!(full.to_hex()));
    assert_eq!(copies(&w).len(), 1);
    // a light one: every entry, a file only as it is opened; the full copy is revoked, so one stays
    let light = ShareId(id(&ok(run(&mut w, mac, copy(false))), "share"));
    assert_eq!(copies(&w), [(light, Level::Keep(KeepMode::Opened), true, alice, alice)]);
    assert!(!w.lab.state(mac).live(full));
    assert_eq!(shown_copy(&mut w, phone), json!("light"));
    assert_eq!(w.lab.state(mac).keeps(phone, &door(&w)), Some(false));
    assert!(w.lab.state(mac).wants(phone, &door(&w)));
    // a keep share of its own over a vault speaks for that vault instead
    let never = json!({ "op": "keep", "over": alice.to_hex(), "mode": "never", "what": "everything",
        "device": phone.to_hex() });
    ok(run(&mut w, mac, never));
    assert!(!w.lab.state(mac).wants(phone, &door(&w)));
    // only a device of a vault the acting device acts for
    let stranger = json!({ "op": "copy", "device": w.mac_b.to_hex(), "full": true });
    assert!(run(&mut w, mac, stranger).get("refused").is_some());
    let unknown = json!({ "op": "copy", "device": w.stranger.to_hex(), "full": true });
    assert_eq!(refused(&run(&mut w, mac, unknown)), "BadOp");
}

#[test]
fn a_device_and_an_owner_leave_by_revoke() {
    let mut w = cast::world();
    let (mac, phone, alice, passkey) = (w.mac_a, w.phone_a, w.alice, w.passkey_a);
    let out = json!({ "op": "revoke", "vault": alice.to_hex(), "device": phone.to_hex() });
    assert_eq!(may(&mut w, mac, json!([out])), [approves(&[passkey])]);
    assert!(run(&mut w, mac, out.clone())["approve"].is_object());
    assert!(vault(&w.lab, mac, alice).devices.contains(&phone), "nothing made");
    assert!(approved(&mut w, mac, passkey, out)["edit"].is_string());
    assert!(!vault(&w.lab, mac, alice).devices.contains(&phone));
    let bad = [
        json!({ "op": "revoke" }),
        json!({ "op": "revoke", "vault": alice.to_hex() }),
        json!({ "op": "revoke", "vault": alice.to_hex(), "owner": { "someone": passkey.to_hex() } }),
        json!({ "op": "revoke", "share": BlobId([1; 32]).to_hex(), "vault": alice.to_hex() }),
    ];
    for op in bad {
        assert_eq!(refused(&run(&mut w, mac, op.clone())), "BadOp", "{op}");
    }
    let last = json!({ "op": "revoke", "vault": alice.to_hex(), "owner": { "signer": passkey.to_hex() } });
    assert_eq!(refused(&run(&mut w, mac, last)), "LastOwner");
    // a device leaves alone
    let leave = json!({ "op": "revoke", "vault": alice.to_hex(), "device": mac.to_hex() });
    assert_eq!(may(&mut w, mac, json!([leave])), [json!(true)]);
}

/// A file sealed under a key of its own, as a node's store seals one (`Node::store_file`).
fn film(text: &str) -> Brought {
    let (key, plain) = (FileKey::from_bytes([9; 32]), text.repeat(500).into_bytes());
    let root = avendb::hash::hash("a test file's root", &seal(&key, &plain));
    Brought::new(root, key, plain.len() as u64)
}

#[test]
fn put_file_makes_a_file_entry_whose_write_brings_the_bytes() {
    let mut w = cast::world();
    let (mac, alice, bob) = (w.mac_a, w.alice, w.bob);
    let brought = film("Harvest. ");
    let len = brought.len;
    let op = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "Harvest.mp4", "media": "video/mp4",
        "tags": ["film"], "len": len });
    assert_eq!(may(&mut w, mac, json!([op])), [json!(true)], "the entry it would create");
    assert_eq!(refused(&run(&mut w, mac, op.clone())), "BadOp", "its bytes come beside it, as a node runs it");
    assert_eq!(engine::len_of(&op).ok(), Some(len));
    let root = brought.root;
    let made = ok(engine::put_file(&mut w.lab, mac, &op, brought));
    let entry = EntryId(id(&made, "entry"));
    assert_eq!((&made["root"], &made["size"]), (&json!(BlobId(root.hash).to_hex()), &json!(root.size)));
    assert_eq!(w.lab.entry_files(mac, entry), [(root, Some(len))]);
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let rows = seen["entries"].as_array().expect("its entries");
    let row = rows.iter().find(|e| e["entry"] == entry.to_hex()).expect("its row");
    assert_eq!((&row["kind"], &row["title"]), (&json!("file"), &json!("Harvest.mp4")));
    assert_eq!((&row["media"], &row["tags"]), (&json!("video/mp4"), &json!(["film"])));
    assert_eq!((&row["files"][0]["len"], &row["files"][0]["pieces"]), (&json!(len), &json!(1)));
    // read_file: the file and the range, which a node reads
    let read = json!({ "op": "read_file", "root": BlobId(root.hash).to_hex(), "size": root.size, "from": 3, "to": 9 });
    assert_eq!(engine::file_of(&read).ok(), Some((root, 3..9)));
    let whole = json!({ "op": "read_file", "root": BlobId(root.hash).to_hex(), "size": root.size });
    assert_eq!(engine::file_of(&whole).ok(), Some((root, 0..u64::MAX)));
    let back = json!({ "op": "read_file", "root": BlobId(root.hash).to_hex(), "size": root.size, "from": 9, "to": 3 });
    assert_eq!(engine::file_of(&back).map_err(|why| why.to_json()["refused"].clone()), Err(json!("BadOp")));
    assert!(engine::reads(&read));
    let theirs = json!({ "op": "put_file", "vault": bob.to_hex(), "name": "x", "len": 1 });
    assert_eq!(refused(&may(&mut w, mac, json!([theirs]))[0]), "NoCap", "Alice's vault holds no share on Bob's");
    let nameless = json!({ "op": "put_file", "vault": alice.to_hex(), "len": 1 });
    assert_eq!(refused(&may(&mut w, mac, json!([nameless]))[0]), "BadOp");
    let lengthless = json!({ "op": "put_file", "vault": alice.to_hex(), "name": "x" });
    assert_eq!(refused(&may(&mut w, mac, json!([lengthless]))[0]), "BadOp");
}

/// A schema or lens entry holds its JSON as written, not a Loro document: the world shows it by its kind and its
/// name, a schema's title or a lens's, and the database has that JSON for its record, not a sealed row.
#[test]
fn a_schema_or_lens_entry_shows_as_what_it_holds() {
    let mut w = cast::world();
    let (mac, alice) = (w.mac_a, w.alice);
    let plant = r#"{ "title": "Plant", "type": "object", "properties": {
  "kind": { "const": "plant" }, "name": { "type": "string", "default": "" } }, "required": ["kind"] }"#;
    let mut add = |ty: &str, value: &str| {
        let made = ok(run(&mut w, mac, json!({ "op": "create", "vault": alice.to_hex(), "type": ty, "value": value })));
        EntryId(id(&made, "entry"))
    };
    let (schema, lens) = (add("schema", plant), add("lens", TODO_LENS));
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let data = ok(run(&mut w, mac, json!({ "op": "database", "vault": alice.to_hex() })));
    let each = [(schema, "schema", "Plant", plant), (lens, "lens", "Todo, v0 to v1", TODO_LENS)];
    for (entry, kind, title, blob) in each {
        let of = |rows: &Value| {
            let rows = rows.as_array().expect("its rows");
            rows.iter().find(|e| e["entry"] == entry.to_hex()).cloned().expect("its row")
        };
        let (shown, row) = (of(&seen["entries"]), of(&data["rows"]));
        assert_eq!((&shown["kind"], &shown["title"]), (&json!(kind), &json!(title)));
        assert_eq!((&row["kind"], &row["title"], &row["type"]), (&json!(kind), &json!(title), &json!(kind)));
        assert_eq!(row["record"], serde_json::from_str::<Value>(blob).expect("its JSON"));
    }
}

#[test]
fn back_up_moves_the_server_between_backup_and_relay() {
    let mut w = cast::world();
    cast::library(&mut w);
    let (mac, stranger) = (w.mac_a, w.stranger);
    let backs_up = |w: &mut World| ok(run(w, mac, json!({ "op": "world" })))["backsUp"].clone();
    assert_eq!(backs_up(&mut w), true, "avenCEO keeps a backup of her vault (`cast::relay_on`)");
    let off = json!({ "op": "back_up", "on": false });
    assert_eq!(may(&mut w, mac, json!([off])), [json!(true)]);
    assert_eq!(ok(run(&mut w, mac, off.clone())), json!({ "changed": true }));
    assert_eq!(backs_up(&mut w), false, "relay alone");
    assert_eq!(ok(run(&mut w, mac, off)), json!({ "changed": false }), "nothing to change");
    assert_eq!(ok(run(&mut w, mac, json!({ "op": "back_up", "on": true }))), json!({ "changed": true }));
    assert_eq!(backs_up(&mut w), true);
    assert_eq!(refused(&run(&mut w, mac, json!({ "op": "back_up" }))), "BadOp");
    assert_eq!(refused(&run(&mut w, stranger, json!({ "op": "back_up", "on": true }))), "NotActing");
}

#[test]
fn mark_marks_an_entry_as_its_vaults_steward_does() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (mac, mac_b, alice, bob) = (w.mac_a, w.mac_b, w.alice, w.bob);
    let mark = json!({ "op": "mark", "entry": l.plan.to_hex() });
    assert_eq!(may(&mut w, mac, json!([mark])), [json!(true)]);
    assert_eq!(ok(run(&mut w, mac, mark.clone())), json!({ "edit": null }), "its marks say what the shares say");
    // a share by its id: the device's upkeep marks it into the audience of the share at once, so the op has nothing
    // left to mark
    ok(run(&mut w, mac, share(alice, to(bob), json!("Viewer"), json!({ "entry": [l.plan.to_hex()] }))));
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let rows = seen["entries"].as_array().expect("its entries");
    let plan = rows.iter().find(|e| e["entry"] == l.plan.to_hex()).expect("the plan");
    assert_eq!(plan["levels"][bob.to_hex()], "read", "Bob's vault reads it: {plan}");
    assert_eq!(ok(run(&mut w, mac, mark.clone())), json!({ "edit": null }));
    w.lab.sync_all(0);
    assert_eq!(refused(&run(&mut w, mac_b, mark)), "NotActing", "only a device of its vault marks it");
    let unknown = json!({ "op": "mark", "entry": BlobId([3; 32]).to_hex() });
    assert_eq!(refused(&run(&mut w, mac, unknown)), "UnknownEntry");
}

#[test]
fn a_card_names_its_device_and_a_profile_its_vault() {
    let mut w = cast::world();
    let (mac, alice, bob) = (w.mac_a, w.alice, w.bob);
    let card = |name: &str| json!({ "op": "card", "name": name });
    assert_eq!(may(&mut w, mac, json!([card("Alice's Mac")])), [json!(true)]);
    assert_eq!(ok(run(&mut w, mac, card("Alice's Mac"))), json!({ "wrote": true }));
    assert_eq!(ok(run(&mut w, mac, card("Alice's Mac"))), json!({ "wrote": false }), "it reads that already");
    assert_eq!(ok(run(&mut w, mac, card("Alice's MacBook"))), json!({ "wrote": true }));
    assert_eq!(refused(&run(&mut w, mac, card("  "))), "BadOp");
    let profile = |v: VaultId, name: &str| json!({ "op": "profile", "vault": v.to_hex(), "name": name });
    assert_eq!(ok(run(&mut w, mac, profile(alice, "Alice"))), json!({ "wrote": true }));
    assert_eq!(ok(run(&mut w, mac, profile(alice, "Alice"))), json!({ "wrote": false }));
    assert_eq!(refused(&run(&mut w, mac, profile(bob, "Bob"))), "NotActing");
    let seen = ok(run(&mut w, mac, json!({ "op": "world" })));
    let mine = shown(&seen, alice);
    assert_eq!(mine["name"], "Alice");
    let devices = mine["devices"].as_array().expect("her devices");
    let me = devices.iter().find(|d| d["me"] == true).expect("this Mac");
    assert_eq!((&me["id"], &me["name"]), (&json!(mac.to_hex()), &json!("Alice's MacBook")));
}

#[test]
fn a_device_follows_any_vault_and_names_them_smallest_first() {
    let mut w = cast::world();
    let (mac, bob, dave) = (w.mac_a, w.bob, w.dave);
    let follow = |v: VaultId, on: bool| json!({ "op": "follow", "vault": v.to_hex(), "on": on });
    assert_eq!(may(&mut w, mac, json!([follow(dave, true)])), [json!(true)]);
    assert!(w.lab.follows(mac).is_empty(), "may makes nothing");
    assert_eq!(ok(run(&mut w, mac, follow(dave, true))), json!({ "follow": [dave.to_hex()] }));
    let both = ok(run(&mut w, mac, follow(bob, true)));
    let mut ids = [bob, dave];
    ids.sort();
    assert_eq!(both, json!({ "follow": ids.iter().map(|v| v.to_hex()).collect::<Vec<_>>() }));
    assert_eq!(w.lab.follows(mac), ids);
    assert_eq!(ok(run(&mut w, mac, follow(dave, false))), json!({ "follow": [bob.to_hex()] }));
    assert_eq!(refused(&run(&mut w, mac, json!({ "op": "follow", "vault": dave.to_hex() }))), "BadOp");
}

#[test]
fn creatable_and_taggable_say_what_a_share_lets_a_vault_add_and_tag() {
    let mut w = cast::world();
    let l = cast::library(&mut w);
    let (mac, mac_b, alice, bob) = (w.mac_a, w.mac_b, w.alice, w.bob);
    let creatable =
        |ty: &str, tags: &[&str]| json!({ "op": "creatable", "vault": alice.to_hex(), "type": ty, "tags": tags });
    assert_eq!(ok(run(&mut w, mac, creatable("todo", &[]))), json!({ "tags": [] }), "her own vault");
    let taggable = json!({ "op": "taggable", "entry": l.door.to_hex() });
    assert_eq!(ok(run(&mut w, mac, taggable.clone())), json!({ "tags": "any" }));
    // Bob's vault writes her work todos, and tags them done alone
    let work = json!({ "all": [{ "type": ["todo"] }, { "tag": "work" }] });
    let ops =
        json!([{ "op": "read" }, { "op": "create" }, { "op": "set", "path": [] }, { "op": "tag", "tags": ["done"] }]);
    ok(run(&mut w, mac, share(alice, to(bob), json!({ "name": "Work", "ops": ops }), work)));
    ok(run(&mut w, mac, json!({ "op": "mark", "entry": l.door.to_hex() })));
    w.lab.sync_all(0);
    assert_eq!(ok(run(&mut w, mac_b, creatable("todo", &[]))), json!({ "tags": ["work"] }), "the tag its share asks");
    assert_eq!(ok(run(&mut w, mac_b, creatable("todo", &["work"]))), json!({ "tags": [] }));
    assert_eq!(refused(&run(&mut w, mac_b, creatable("note", &[]))), "NoCap");
    assert_eq!(ok(run(&mut w, mac_b, taggable.clone())), json!({ "tags": ["done"] }));
    let as_alice = json!({ "op": "taggable", "entry": l.door.to_hex(), "as": alice.to_hex() });
    assert_eq!(ok(run(&mut w, mac, as_alice)), json!({ "tags": "any" }));
    let diary = json!({ "op": "taggable", "entry": l.diary.to_hex() });
    assert_eq!(refused(&run(&mut w, mac_b, diary)), "NoEntry", "no share of Bob's reaches her diary");
    let seeds = json!({ "op": "taggable", "entry": l.seeds.to_hex(), "as": bob.to_hex() });
    assert_eq!(ok(run(&mut w, mac, seeds)), json!({ "tags": [] }), "nor her home todos");
    // may passes its `as` to the ops that take one
    let todo = json!({ "op": "create", "vault": alice.to_hex(), "type": "todo", "tags": ["work"],
        "value": { "kind": "todo", "title": "Oil the hinges" } });
    let both = json!({ "op": "may", "as": bob.to_hex(), "ops": [todo, { "op": "card", "name": "B" }] });
    let asked = ok(run(&mut w, mac_b, both));
    assert_eq!(asked, json!([true, true]), "the card acts for Bob's Mac's own vault, and takes no as");
}
