//! A device on a machine of its own (P8b): randomness drawn from the machine, a device that keeps a secret of its own
//! (the server), the server's vault founded once by an owner key it then forgets, the contact card the server hands
//! out, and a store reopened from what the device saved, which goes on vouching for the device's writes.

mod common;

use common::*;
use avendb::id::SpaceId;
use avendb::lab::Lab;
use avendb::policy::{Action, Principal, Refusal, Role, Scope};

#[test]
fn a_lab_on_a_machine_makes_its_keys_from_the_machines_randomness() {
    let (mut a, mut b) = (Lab::with_entropy([1; 32]), Lab::with_entropy([2; 32]));
    let mut again = Lab::with_entropy([1; 32]);
    let (x, y, x2) = (a.device("a stranger"), b.device("a stranger"), again.device("a stranger"));
    assert_ne!(x, y, "two machines make different keys under the same name");
    assert_eq!(x, x2, "the same randomness makes the same keys, so a failing test replays");
    assert_ne!(x, Lab::new().device("a stranger"), "and neither makes the keys of the Lab's own");
}

#[test]
fn the_servers_vault_is_founded_once_by_an_owner_key_it_forgets() {
    let mut lab = Lab::with_entropy([1; 32]);
    let server = lab.device_with("the server", [7; 32]);
    assert_eq!(server, Lab::with_entropy([2; 32]).device_with("the server", [7; 32]), "its keys are its secret's");
    assert_eq!(lab.vault_of(server), None, "a new server belongs to no vault");
    let v = lab.found_server(server, [8; 32]).expect("the server founds its vault");
    assert_eq!(lab.vault_of(server), Some(v), "and is its device");
    let vault = lab.state(server).vault(v).expect("the vault").clone();
    let [Principal::Signer(owner)] = vault.owners[..] else { panic!("one owner, a signer: {:?}", vault.owners) };
    assert_ne!(owner, server, "owned by a key of its own, not the device's");
    // the owner key signed the genesis and admitted the device, and is gone: nobody changes the vault
    let other = lab.device("another server");
    let add = Action::AddDevice { vault: v, device: other, seal_to: None };
    assert_eq!(lab.submit(server, &[owner, other], add), Err(Refusal::Locked), "its owner key can't sign again");
    assert_eq!(lab.found_server(server, [9; 32]), Err(Refusal::AlreadyMember), "nor is the server founded twice");
}

#[test]
fn the_server_hands_out_its_vaults_log_as_its_contact_card() {
    let mut lab = Lab::with_entropy([5; 32]);
    let server = lab.device_with("the server", [7; 32]);
    let v = lab.found_server(server, [8; 32]).expect("its vault");
    let card = lab.card(server);
    assert!(!card.is_empty(), "the card holds the vault's genesis and its device");
    assert!(card.iter().all(|s| s.op.vault_of() == Some(v)), "and nothing but its vault's log");
    let mut w = world();
    let samuel = w.samuel;
    let found = w.lab.submit(w.mac_s, &[w.mac_s], Action::FoundSpace { actor: samuel, nonce: 9, via: vec![] });
    let garden = SpaceId::from(found.expect("Samuel founds a space"));
    let relay = grant(Scope::Space(garden), Role::Relay, vault(v), samuel, None);
    let granted = w.lab.submit(w.mac_s, &[w.mac_s], relay.clone());
    assert!(granted.is_err(), "a vault Samuel's Mac doesn't know gets no grant");
    let n = card.len();
    assert_eq!(w.lab.receive(w.mac_s, card, vec![]), n, "Samuel's Mac takes every op of the card");
    w.lab.submit(w.mac_s, &[w.mac_s], relay).expect("with the card, the new server relays the space");
    assert!(w.lab.peers(w.mac_s).iter().any(|(d, _)| *d == server), "and Samuel's Mac knows its device as a peer");
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
