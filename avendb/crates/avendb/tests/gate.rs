//! Who the server takes (`Gate.lean`, `docs/ARCHITECTURE.md` §5, "Who the server takes"): a gated server, avenMAIA's
//! device, serving Maia City, takes a new human vault only with the invite it claims, and a coop or an aven only where
//! an admin of Maia City owns it: Maia City, a vault that owns it, or a holder of its cap group named Admin. Key
//! generation can't be stopped; what the server takes onto what it holds can. And a service that holds no device,
//! maiaCITY's API, learns from it by a device's pass which vault the device is a device of and whether that vault is
//! an admin (G3).

use avendb::cast::{self, World};
use avendb::engine;
use avendb::gate::ADMIN;
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::GroupShare;
use avendb::policy::{Action, Kind, Level, Principal, Refusal, Revoking, Who};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::sign::{unbase64url, ApiPass, PASS_LIFE};
use avendb::slice::{Selector, CAP_GROUP_TYPE};
use avendb::wire::Wire;
use avendb::world;
use serde_json::json;

/// The world with its server gated, Maia City's Traveler group, and an Admin group Maia City's owner gives Bob.
struct Served {
    w: World,
    maia: VaultId,
    traveler: EntryId,
    admin: EntryId,
}

fn served() -> Served {
    let mut w = cast::world();
    let (mac_a, server) = (w.mac_a, w.server);
    w.lab.gate(server, true);
    let maia = match w.lab.state(mac_a).vault(w.avenceo).expect("avenMAIA").owners[..] {
        [Principal::Vault(maia)] => maia,
        ref owners => panic!("avenMAIA has one owner, a vault: {owners:?}"),
    };
    // the server backs up Maia City, as it backs up whatever its person's vault owns: it holds its invites and their
    // claims
    cast::relay_on(&mut w, maia);
    let read = Cap { op: Op::of_json(&json!({ "op": "read" })).unwrap(), slice: cast::of_type("logic") };
    let traveler = CapGroup { name: "Traveler".into(), caps: vec![read], includes: vec![] };
    let traveler = w.lab.define_group(mac_a, maia, traveler).expect("Maia City defines Traveler");
    let admin = CapGroup { name: ADMIN.into(), caps: vec![], includes: vec![] };
    let admin = w.lab.define_group(mac_a, maia, admin).expect("Maia City defines Admin");
    // the server reads Maia City's cap groups: a share that reads nothing else, as every share selects them
    let groups = cast::share(maia, cast::vault(w.avenceo), Level::Read, cast::of_type(CAP_GROUP_TYPE));
    w.lab.issue(mac_a, &[mac_a], groups).expect("Maia City lets its server read its cap groups");
    let mut s = Served { w, maia, traveler, admin };
    let bobs = of_group(&s, Who::Vault(s.w.bob), admin);
    s.w.lab.issue_group(mac_a, &[mac_a], bobs).expect("Bob becomes an admin");
    s.w.lab.sync(mac_a, server);
    s
}

/// A share of Maia City's group `group` to `who`, to read.
fn of_group(s: &Served, who: Who, group: EntryId) -> GroupShare {
    let (over, level, select) = (s.maia, Level::Read, Selector::All);
    GroupShare { over, who, name: "Maia City".into(), select, group, level, parent: None, issuer: over }
}

/// A new person's vault, founded by their passkey on their new device, which takes the server's card and gives
/// avenMAIA relay on the vault, as a device founding through the server does.
fn newcomer(w: &mut World, name: &str) -> (SignerId, VaultId) {
    let passkey = w.lab.passkey(name);
    let mac = w.lab.device_of(passkey, &format!("{name}'s Mac"));
    let v = cast::human_on(&mut w.lab, passkey, &[mac]);
    w.lab.share_contact(w.server, mac, w.avenceo);
    let relay = cast::share(v, cast::vault(w.avenceo), Level::Relay, Selector::All);
    w.lab.issue(mac, &[mac], relay).expect("the vault gives the server relay");
    (mac, v)
}

/// A coop vault `owner` founds alone, its passkey `passkey` signing on its device `on`.
fn coop(w: &mut World, on: SignerId, passkey: SignerId, owner: VaultId) -> VaultId {
    let owners = vec![Principal::Vault(owner)];
    let genesis = Action::Genesis { kind: Kind::Coop, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    VaultId::from(w.lab.submit(on, &[passkey], genesis).expect("its owner founds the coop"))
}

fn takes(w: &World, v: VaultId) -> bool {
    w.lab.state(w.server).vault(v).is_some()
}

#[test]
fn a_newcomer_comes_in_with_the_invite_it_claims_and_a_stranger_stays_out() {
    let mut s = served();
    let (mac_a, server) = (s.w.mac_a, s.w.server);
    let key = s.w.lab.invite_key([7; 32]);
    let invite = of_group(&s, Who::Invite(key), s.traveler);
    let invite = s.w.lab.issue_group(mac_a, &[mac_a], invite).expect("Maia City invites a traveler");
    s.w.lab.sync(mac_a, server);
    // the server says the invite is open, as maiaCITY's API asks it before signing Erin up; a share of the group to a
    // vault is no invite
    assert!(world::open_invite(&s.w.lab, server, invite), "an unclaimed invite of Maia City is open");
    let to_bob = of_group(&s, Who::Vault(s.w.bob), s.traveler);
    let to_bob = s.w.lab.issue_group(mac_a, &[mac_a], to_bob).expect("Maia City makes Bob a traveler");
    s.w.lab.sync(mac_a, server);
    assert!(!world::open_invite(&s.w.lab, server, to_bob), "a share to a vault is no invite");
    // Erin's Mac founds her vault, and the server holds nothing of it
    let (mac_e, erin) = newcomer(&mut s.w, "Erin");
    s.w.lab.sync(mac_e, server);
    assert!(!takes(&s.w, erin), "a vault with no invite claimed stays out");
    // her link names the invite: the server hands it to her Mac, which claims it, and hands the server its vault and
    // the claim at once, which the server takes
    s.w.lab.hand_invite(server, mac_e, invite).expect("the server hands whoever names it the invite");
    s.w.lab.claim_invite(mac_e, invite, erin, key).expect("Erin's vault claims the invite");
    s.w.lab.sign_up(mac_e, server);
    assert!(takes(&s.w, erin), "the server takes Erin's vault, with the invite it claimed");
    assert_eq!(s.w.lab.state(server).share(invite).map(|cp| cp.share.who), Some(Who::Vault(erin)));
    // once claimed, nobody is handed the invite again, and it is open no more
    assert_eq!(s.w.lab.invite_card(server, invite).err(), Some(Refusal::NotInvite));
    assert!(!world::open_invite(&s.w.lab, server, invite), "a claimed invite signs nobody else up");
    // Frank comes with no invite: the server leaves his vault out, however it hears of him
    let (mac_f, frank) = newcomer(&mut s.w, "Frank");
    s.w.lab.sync(mac_f, server);
    s.w.lab.sign_up(mac_f, server);
    s.w.lab.share_contact(mac_f, server, frank);
    assert!(!takes(&s.w, frank), "the server leaves out a vault that comes with no invite");
    assert_eq!(s.w.lab.hand_invite(server, mac_f, invite), Err(Refusal::NotInvite));
    // an ungated server takes him as it takes any
    s.w.lab.gate(server, false);
    s.w.lab.share_contact(mac_f, server, frank);
    assert!(takes(&s.w, frank), "with no gate, the server takes any vault");
}

#[test]
fn a_coop_comes_in_only_from_an_admin() {
    let mut s = served();
    let w = &mut s.w;
    let (server, maia) = (w.server, s.maia);
    // the server reads Maia City's Admin group, and that Bob holds it
    assert_eq!(w.lab.group(server, maia, s.admin).map(|g| g.name.as_str()), Some(ADMIN));
    let (mac_b, passkey_b, bob) = (w.mac_b, w.passkey_b, w.bob);
    let (mac_c, passkey_c, carol) = (w.mac_c, w.passkey_c, w.carol);
    let (mac_a, passkey_a, alice) = (w.mac_a, w.passkey_a, w.alice);
    for v in [bob, carol, alice] {
        assert!(takes(w, v), "the server knows {v:?} from before the gate");
    }
    // Bob, an admin, founds a coop: the server takes it; Carol, no admin, founds one: it stays out
    let bobs = coop(w, mac_b, passkey_b, bob);
    w.lab.share_contact(mac_b, server, bobs);
    assert!(takes(w, bobs), "a coop an admin owns comes in");
    let carols = coop(w, mac_c, passkey_c, carol);
    w.lab.share_contact(mac_c, server, carols);
    assert!(!takes(w, carols), "a coop no admin owns stays out");
    // Alice owns Maia City: her coop comes in
    let alices = coop(w, mac_a, passkey_a, alice);
    w.lab.share_contact(mac_a, server, alices);
    assert!(takes(w, alices), "a coop Maia City's owner owns comes in");
    // Maia City renames the group: Bob is no admin from then on, and his next coop stays out
    let renamed = CapGroup { name: "Former admins".into(), caps: vec![], includes: vec![] };
    w.lab.redefine_group(mac_a, maia, s.admin, renamed).expect("Maia City renames Admin");
    w.lab.sync(mac_a, server);
    let again = coop(w, mac_b, passkey_b, bob);
    w.lab.share_contact(mac_b, server, again);
    assert!(!takes(w, again), "a coop of a vault that no longer holds Admin stays out");
}

/// The service maiaCITY's API names itself as in a device's pass.
const API: &str = "maiaCITY API";

/// The pass device `on` makes for maiaCITY's API through its engine, as a page asks its device.
fn pass_of(w: &mut World, on: SignerId) -> ApiPass {
    pass_for(w, on, API)
}

/// The pass device `on` makes for service `audience` through its engine, as a page asks its device.
fn pass_for(w: &mut World, on: SignerId, audience: &str) -> ApiPass {
    let made = engine::run(&mut w.lab, on, &json!({ "op": "api_pass", "audience": audience }));
    let text = made["ok"]["pass"].as_str().unwrap_or_else(|| panic!("a pass, not {made}"));
    assert_eq!(made["ok"]["expires"], w.lab.now() + PASS_LIFE, "it counts for ten minutes");
    ApiPass::from_wire(&unbase64url(text).expect("base64url")).expect("a pass's bytes")
}

#[test]
fn a_devices_pass_shows_the_api_its_vault_and_whether_it_is_an_admin() {
    let mut s = served();
    let (mac_a, mac_b, server) = (s.w.mac_a, s.w.mac_b, s.w.server);
    s.w.lab.set_now(1_791_500_000);
    let now = s.w.lab.now();
    let standing = |s: &Served, pass: &ApiPass, audience: &str, at: u64| {
        world::pass_standing(&s.w.lab, server, pass, audience, at)
    };
    // Alice's vault owns Maia City, and Bob holds its Admin group: the server says so of their Macs' passes
    let alices = pass_of(&mut s.w, mac_a);
    assert_eq!(standing(&s, &alices, API, now), Some((s.w.alice, true)));
    let bobs = pass_of(&mut s.w, mac_b);
    assert_eq!(standing(&s, &bobs, API, now), Some((s.w.bob, true)));
    // a pass counts for maiaCITY's API alone, for ten minutes, and its own device alone
    assert_eq!(standing(&s, &alices, "another service", now), None);
    assert_eq!(standing(&s, &alices, API, now + PASS_LIFE), None);
    assert_eq!(standing(&s, &ApiPass { keys: bobs.keys.clone(), ..alices.clone() }, API, now), None);
    // a newcomer who came in by a Traveler's invite is no admin
    let key = s.w.lab.invite_key([7; 32]);
    let invite = of_group(&s, Who::Invite(key), s.traveler);
    let invite = s.w.lab.issue_group(mac_a, &[mac_a], invite).expect("Maia City invites a traveler");
    s.w.lab.sync(mac_a, server);
    let (mac_e, erin) = newcomer(&mut s.w, "Erin");
    s.w.lab.hand_invite(server, mac_e, invite).expect("the server hands Erin the invite");
    s.w.lab.claim_invite(mac_e, invite, erin, key).expect("Erin's vault claims the invite");
    s.w.lab.sign_up(mac_e, server);
    let erins = pass_of(&mut s.w, mac_e);
    assert_eq!(standing(&s, &erins, API, now), Some((erin, false)));
    // once Maia City revokes Bob's Admin share, his Mac's pass shows him no admin
    let (maia, bob) = (s.maia, s.w.bob);
    let st = s.w.lab.state(mac_a);
    let to_bob = st.shares().iter().find(|cp| cp.share.over == maia && cp.share.who == Who::Vault(bob)).unwrap().id;
    let revoke = Revoking::Grant { share: to_bob, actor: maia, keep: vec![], via: vec![s.w.alice] };
    s.w.lab.submit(mac_a, &[mac_a], Action::Revoke(revoke)).expect("Maia City revokes Bob's Admin share");
    s.w.lab.sync(mac_a, server);
    assert_eq!(standing(&s, &bobs, API, now), Some((s.w.bob, false)));
    // a passkey is no device, and a stranger's device is nobody's: none makes a pass that counts for anyone
    let made = engine::run(&mut s.w.lab, s.w.passkey_a, &json!({ "op": "api_pass", "audience": API }));
    assert!(made["ok"].is_null(), "a passkey makes no pass: {made}");
    let stranger = s.w.stranger;
    let strangers = pass_of(&mut s.w, stranger);
    assert_eq!(standing(&s, &strangers, API, now), None);
    // a locked device makes none, and a pass names a service
    s.w.lab.lock(mac_b);
    assert_eq!(engine::run(&mut s.w.lab, mac_b, &json!({ "op": "api_pass", "audience": API }))["refused"], "Locked");
    assert_eq!(engine::run(&mut s.w.lab, mac_a, &json!({ "op": "api_pass", "audience": "" }))["refused"], "BadOp");
}

#[test]
fn the_server_lists_the_vaults_it_knows_to_an_admins_pass_for_that_alone() {
    let mut s = served();
    let (mac_a, mac_b, server) = (s.w.mac_a, s.w.mac_b, s.w.server);
    s.w.lab.set_now(1_791_500_000);
    let now = s.w.lab.now();
    // Alice owns Maia City and Bob holds its Admin group: each of their passes for the listing lists every vault
    let alices = pass_for(&mut s.w, mac_a, world::VAULTS_AUDIENCE);
    let listed = world::kept_vaults(&s.w.lab, server, &alices, now).expect("Alice's pass lists the vaults");
    let ids: Vec<&str> = listed.iter().map(|v| v["id"].as_str().expect("an id")).collect();
    let known: Vec<String> = s.w.lab.state(server).vaults().iter().map(|v| v.id.to_hex()).collect();
    assert_eq!(ids, known, "every vault the server knows, in the order they were founded");
    let maia = listed.iter().find(|v| v["id"] == s.maia.to_hex()).expect("Maia City is listed");
    assert_eq!(maia["kind"], "coop");
    assert_eq!(maia["owners"], json!([{ "vault": s.w.alice.to_hex() }]));
    let alice = listed.iter().find(|v| v["id"] == s.w.alice.to_hex()).expect("Alice's vault is listed");
    assert_eq!(alice["kind"], "human");
    assert!(["backup", "relay", "known"].contains(&alice["keeps"].as_str().unwrap()), "what it keeps: {alice}");
    let bobs = pass_for(&mut s.w, mac_b, world::VAULTS_AUDIENCE);
    assert!(world::kept_vaults(&s.w.lab, server, &bobs, now).is_some(), "an Admin holder's pass lists them");
    // a pass made for maiaCITY's API never lists them, nor one gone stale
    let for_api = pass_of(&mut s.w, mac_a);
    assert_eq!(world::kept_vaults(&s.w.lab, server, &for_api, now), None);
    assert_eq!(world::kept_vaults(&s.w.lab, server, &alices, now + PASS_LIFE), None);
    // a traveler's pass lists nothing
    let key = s.w.lab.invite_key([9; 32]);
    let invite = of_group(&s, Who::Invite(key), s.traveler);
    let invite = s.w.lab.issue_group(mac_a, &[mac_a], invite).expect("Maia City invites a traveler");
    s.w.lab.sync(mac_a, server);
    let (mac_e, erin) = newcomer(&mut s.w, "Erin");
    s.w.lab.hand_invite(server, mac_e, invite).expect("the server hands Erin the invite");
    s.w.lab.claim_invite(mac_e, invite, erin, key).expect("Erin's vault claims the invite");
    s.w.lab.sign_up(mac_e, server);
    let erins = pass_for(&mut s.w, mac_e, world::VAULTS_AUDIENCE);
    assert_eq!(world::kept_vaults(&s.w.lab, server, &erins, now), None);
}
