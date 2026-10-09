//! A device on a machine of its own (P8b): randomness drawn from the machine, a device that keeps a secret of its own
//! (the server), claimed once by the first human vault that brings its setup code, as a device of avenCEO (P8f), the
//! contact card the server hands out, and a store reopened from what the device saved, which goes on vouching for the
//! device's writes.

mod common;

use common::*;
use avendb::id::{SignerId, SpaceId, VaultId};
use avendb::keys::KeyScope;
use avendb::lab::{same_code, Lab};
use avendb::policy::{Action, Kind, Principal, Refusal, Role, Scope};
use avendb::wire::Claim;

#[test]
fn a_lab_on_a_machine_makes_its_keys_from_the_machines_randomness() {
    let (mut a, mut b) = (Lab::with_entropy([1; 32]), Lab::with_entropy([2; 32]));
    let mut again = Lab::with_entropy([1; 32]);
    let (x, y, x2) = (a.device("a stranger"), b.device("a stranger"), again.device("a stranger"));
    assert_ne!(x, y, "two machines make different keys under the same name");
    assert_eq!(x, x2, "the same randomness makes the same keys, so a failing test replays");
    assert_ne!(x, Lab::new().device("a stranger"), "and neither makes the keys of the Lab's own");
}

/// A server on a machine of its own, and Samuel with a passkey and a Mac, his vault founded: nobody has claimed the
/// server yet.
fn unclaimed(seed: u8) -> (Lab, SignerId, SignerId, SignerId, VaultId) {
    let mut lab = Lab::with_entropy([seed; 32]);
    let server = lab.device_with("the server", [7; 32]);
    let passkey = lab.passkey("Samuel");
    let mac = lab.device_of(passkey, "Samuel's Mac");
    let samuel = human_on(&mut lab, passkey, &[mac]);
    (lab, server, passkey, mac, samuel)
}

/// A claim of `server` by hand, as a device that skips `Lab::claim`'s checks would send it: `action`, drafted on
/// `on`, signed by each of its signers but the server in a ceremony of the Lab's software passkey.
fn claim_by_hand(lab: &mut Lab, on: SignerId, signers: &[SignerId], action: Action, server: SignerId) -> Claim {
    let add = lab.draft(on, signers, action).expect("the view takes the op").op().clone();
    let (id, pq) = (add.id(), avendb::sign::needs_pq(&add));
    let sigs = add
        .sigs()
        .filter(|&s| s != server)
        .map(|s| {
            let ceremony = lab.ceremony(s, id.0).expect("a software passkey");
            ceremony.sign(lab.keys_of(s).expect("its keys"), id, pq).expect("its signature")
        })
        .collect();
    Claim { code: SETUP_CODE.to_vec(), card: lab.card(on), add, sigs }
}

#[test]
fn the_first_human_vault_to_bring_the_servers_setup_code_claims_it_once() {
    let (mut lab, server, passkey, mac, samuel) = unclaimed(1);
    assert_eq!(server, Lab::with_entropy([2; 32]).device_with("the server", [7; 32]), "its keys are its secret's");
    assert_eq!(lab.vault_of(server), None, "a new server belongs to no vault");
    // no code, another code, or a server with none: nothing to claim
    for (code, setup) in [(&b""[..], Some(SETUP_CODE)), (b"a guess", Some(SETUP_CODE)), (SETUP_CODE, None)] {
        assert!(matches!(lab.claim_key(server, code, setup), Err(Refusal::BadCode)), "only the server's own code");
    }
    assert!(same_code(SETUP_CODE, SETUP_CODE) && !same_code(SETUP_CODE, &SETUP_CODE[1..]));
    let avenceo = claim_on(&mut lab, mac, passkey, samuel, server);
    assert_eq!(lab.vault_of(server), Some(avenceo), "the server is a device of avenCEO");
    let vault = lab.state(server).vault(avenceo).expect("avenCEO").clone();
    assert_eq!((vault.kind, &vault.owners[..], vault.root), (Kind::Aven, &[Principal::Vault(samuel)][..], None));
    assert_eq!(vault.devices, vec![server], "owned by Samuel's vault, with the server its one device");
    assert_eq!(lab.state(mac).vault(avenceo).map(|v| v.devices.clone()), Some(vec![server]), "on his Mac too");
    // the server opens avenCEO's key, which Samuel's Mac boxed for it, and nothing of Samuel's own
    assert!(lab.opens(server, KeyScope::Vault(avenceo)) && !lab.opens(server, KeyScope::Vault(samuel)));
    // it acts for avenCEO, and never governs it
    let other = lab.device("another server");
    let add = Action::AddDevice { vault: avenceo, device: other, seal_to: None };
    assert_eq!(lab.submit(server, &[server, other], add.clone()), Err(Refusal::BelowThreshold));
    let found = lab.submit(server, &[server], Action::FoundSpace { actor: avenceo, nonce: 1, via: vec![] });
    assert!(found.is_ok(), "the server founds a space for avenCEO");
    lab.submit(mac, &[passkey, other], add).expect("Samuel's passkey adds a second server, through his vault");
    // nobody claims it again, not even with the code
    assert!(matches!(lab.claim_key(server, SETUP_CODE, Some(SETUP_CODE)), Err(Refusal::AlreadyMember)));
}

#[test]
fn a_server_takes_only_a_claim_that_makes_it_a_device_of_an_aven_vault() {
    let (mut lab, server, passkey, mac, samuel) = unclaimed(3);
    let key = lab.claim_key(server, SETUP_CODE, Some(SETUP_CODE)).expect("its key");
    let owners = vec![Principal::Vault(samuel)];
    let genesis = Action::Genesis { kind: Kind::Aven, owners, threshold: 1, root: None, nonce: 0, seal_to: vec![] };
    let avenceo = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("avenCEO"));
    let adds = |vault, device, key| Action::AddDevice { vault, device, seal_to: Some(key) };
    // the claiming device claims an aven vault alone
    let draft = lab.draft(mac, &[passkey, server], adds(samuel, server, key.clone())).expect("a draft");
    assert!(matches!(lab.claim(mac, draft, &[], SETUP_CODE), Err(Refusal::NotClaiming)));
    // and the server checks for itself: never a device of a human vault, which would open that person's keys
    let into_samuels = claim_by_hand(&mut lab, mac, &[passkey, server], adds(samuel, server, key.clone()), server);
    assert!(matches!(lab.accept_claim(server, into_samuels, Some(SETUP_CODE)), Err(Refusal::NotClaiming)));
    // another device than itself, or sealing to another key than the one it handed
    let other = lab.device("another server");
    let other_key = lab.claim_key(other, SETUP_CODE, Some(SETUP_CODE)).expect("its key");
    let draft = lab.draft(mac, &[passkey, other], adds(avenceo, other, other_key.clone())).expect("a draft");
    let for_other = lab.claim(mac, draft, &[], SETUP_CODE).expect("a claim of the other server");
    assert!(matches!(lab.accept_claim(server, for_other, Some(SETUP_CODE)), Err(Refusal::NotClaiming)));
    let draft = lab.draft(mac, &[passkey, server], adds(avenceo, server, other_key)).expect("a draft");
    let wrong_key = lab.claim(mac, draft, &[], SETUP_CODE).expect("a claim sealing to the other key");
    assert!(matches!(lab.accept_claim(server, wrong_key, Some(SETUP_CODE)), Err(Refusal::NotClaiming)));
    // the right claim, but another code, a signature missing or one too many, or no card to check it by
    let draft = lab.draft(mac, &[passkey, server], adds(avenceo, server, key)).expect("a draft");
    let claim = lab.claim(mac, draft, &[], SETUP_CODE).expect("the claim");
    let other_code = Claim { code: b"a guess".to_vec(), ..claim.clone() };
    assert!(matches!(lab.accept_claim(server, other_code, Some(SETUP_CODE)), Err(Refusal::BadCode)));
    let unsigned = Claim { sigs: vec![], ..claim.clone() };
    assert!(matches!(lab.accept_claim(server, unsigned, Some(SETUP_CODE)), Err(Refusal::BadSignature)));
    let twice = Claim { sigs: [&claim.sigs[..], &claim.sigs[..]].concat(), ..claim.clone() };
    assert!(matches!(lab.accept_claim(server, twice, Some(SETUP_CODE)), Err(Refusal::BadSignature)));
    let no_card = Claim { card: vec![], ..claim.clone() };
    assert!(matches!(lab.accept_claim(server, no_card, Some(SETUP_CODE)), Err(Refusal::UnknownVault)));
    assert_eq!(lab.vault_of(server), None, "none of them claimed it");
    let join = lab.accept_claim(server, claim.clone(), Some(SETUP_CODE)).expect("the claim");
    assert_eq!(join.blobs.len(), 1, "the server's join brings its McEliece key");
    assert_eq!(lab.vault_of(server), Some(avenceo));
    assert!(matches!(lab.accept_claim(server, claim, Some(SETUP_CODE)), Err(Refusal::AlreadyMember)), "once");
}

#[test]
fn the_server_hands_out_avenceos_log_as_its_contact_card() {
    let (mut lab, server, passkey, mac, samuel) = unclaimed(5);
    let avenceo = claim_on(&mut lab, mac, passkey, samuel, server);
    let card = lab.card(server);
    assert!(card.iter().any(|s| s.op.vault_of() == Some(avenceo)), "the card holds avenCEO's log");
    let ours = |s: &avendb::sign::Signed| matches!(s.op.vault_of(), Some(v) if v == avenceo || v == samuel);
    assert!(card.iter().all(ours), "and its owner's, and nothing else");
    // someone else, who knows nothing of this avenCEO, grants it relay once they hold the card
    let mut w = world();
    let bob = w.bob;
    let found = w.lab.submit(w.mac_b, &[w.mac_b], Action::FoundSpace { actor: bob, nonce: 9, via: vec![] });
    let garden = SpaceId::from(found.expect("Bob founds a space"));
    let relay = grant(Scope::Space(garden), Role::Relay, vault(avenceo), bob, None);
    let granted = w.lab.submit(w.mac_b, &[w.mac_b], relay.clone());
    assert!(granted.is_err(), "a vault Bob's Mac doesn't know gets no grant");
    let n = card.len();
    assert_eq!(w.lab.receive(w.mac_b, card, vec![]), n, "Bob's Mac takes every op of the card");
    w.lab.submit(w.mac_b, &[w.mac_b], relay).expect("with the card, the server relays the space");
    assert!(w.lab.peers(w.mac_b).iter().any(|(d, _)| *d == server), "and Bob's Mac knows the server as a peer");
}

#[test]
fn a_device_reopened_from_what_it_saved_vouches_for_its_writes_as_before() {
    let mut w = world();
    let h = handbook(&mut w);
    let after = w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).expect("an edit");
    let saved = w.lab.backup(w.mac_s);
    // the device starts again from what it saved, as a node does from its store on disk
    w.lab.restore_backup(w.mac_s, &saved);
    w.lab.checkpoint(w.mac_s);
    let vouched = w.lab.log(w.mac_s).ops().iter().any(|op| {
        op.author == w.mac_s && matches!(&op.action, Action::Checkpoint { covers, .. } if covers.contains(&after))
    });
    assert!(vouched, "a checkpoint of its own covers the edit it made before it started again");
    assert_eq!(text(&w.lab, w.mac_s, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "and it shows the edit");
}
