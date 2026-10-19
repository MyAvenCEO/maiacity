//! Who the server takes (`Gate.lean`, `docs/ARCHITECTURE.md` §5, "Who the server takes"): a gated server, avenMAIA's
//! device, serving Maia City, takes a new human vault only with the invite it claims, and a coop or an aven only where
//! an admin of Maia City owns it: Maia City, a vault that owns it, or a holder of its cap group named Admin. Key
//! generation can't be stopped; what the server takes onto what it holds can.

use avendb::cast::{self, World};
use avendb::gate::ADMIN;
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::GroupShare;
use avendb::policy::{Action, Kind, Level, Principal, Refusal, Who};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::slice::{Selector, CAP_GROUP_TYPE};
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
    // once claimed, nobody is handed the invite again
    assert_eq!(s.w.lab.invite_card(server, invite).err(), Some(Refusal::NotInvite));
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
