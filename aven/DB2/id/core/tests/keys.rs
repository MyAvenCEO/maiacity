//! The cast's keys, derived from their seeds, and statements a device signs for the vault it serves.

use aven_id::{SignError, Tree, public_hex, test_signer};

const CAST: &str = include_str!("../../../sandbox/cast.json");

fn cast() -> Tree {
    Tree::from_cast(CAST).unwrap()
}

#[test]
fn every_public_half_is_the_seeds() {
    let t = cast();
    let ids: Vec<_> = t.keys().map(|(id, _)| id).collect();
    assert_eq!(ids, ["alice-owner", "bob-owner", "aven-peer", "alice-peer", "alice-peer-light", "bob-peer-light"]);
    for (id, public) in t.keys() {
        assert_eq!(public_hex(&test_signer(id).verifying_key()), public, "{id}");
    }
    // one written out by hand, so a change to the derivation can't pass by changing the cast with it
    assert_eq!(public_hex(&test_signer("alice-peer-light").verifying_key()).get(..8), Some("9f78814b"));
}

#[test]
fn a_device_signs_for_the_vault_it_serves() {
    let t = cast();
    let s = t.sign("aven-peer", &test_signer("aven-peer"), b"hello").unwrap();
    assert_eq!(s.vault, "aven");
    assert_eq!(t.verify(&s), Ok(()));
    let s = t.sign("bob-peer-light", &test_signer("bob-peer-light"), b"hello").unwrap();
    assert_eq!(s.vault, "bob");
    assert_eq!(t.verify(&s), Ok(()));
}

#[test]
fn only_with_its_own_key() {
    let t = cast();
    assert_eq!(
        t.sign("aven-peer", &test_signer("alice-peer"), b"x"),
        Err(SignError::WrongKey("aven-peer".into()))
    );
    // a statement signed with another device's key, but naming this device, fails
    let mut s = t.sign("alice-peer", &test_signer("alice-peer"), b"x").unwrap();
    s.device = "alice-peer-light".into();
    assert_eq!(t.verify(&s), Err(SignError::BadSignature));
    // an owner key is no device
    assert_eq!(t.sign("alice-owner", &test_signer("alice-owner"), b"x"), Err(SignError::NotDevice("alice-owner".into())));
    assert_eq!(t.sign("alice", &test_signer("alice-owner"), b"x"), Err(SignError::NotDevice("alice".into())));
}

#[test]
fn only_for_its_vault() {
    let t = cast();
    let mut s = t.sign("aven-peer", &test_signer("aven-peer"), b"x").unwrap();
    s.vault = "alice".into();
    assert_eq!(t.verify(&s), Err(SignError::WrongVault { device: "aven-peer".into(), vault: "alice".into() }));
}

#[test]
fn not_once_changed() {
    let t = cast();
    let mut s = t.sign("alice-peer-light", &test_signer("alice-peer-light"), b"x").unwrap();
    s.body = b"y".to_vec();
    assert_eq!(t.verify(&s), Err(SignError::BadSignature));
    let mut s = t.sign("alice-peer-light", &test_signer("alice-peer-light"), b"x").unwrap();
    s.signature[0] ^= 1;
    assert_eq!(t.verify(&s), Err(SignError::BadSignature));
}

#[test]
fn may_act_on_decides_the_rest() {
    let t = cast();
    let bob = t.sign("bob-peer-light", &test_signer("bob-peer-light"), b"x").unwrap();
    assert_eq!(t.acts_on(&bob, "bob"), Ok(true));
    assert_eq!(t.acts_on(&bob, "aven"), Ok(false), "Bob's devices never act on Aven");
    let aven = t.sign("aven-peer", &test_signer("aven-peer"), b"x").unwrap();
    assert_eq!(t.acts_on(&aven, "aven"), Ok(true));
    assert_eq!(t.acts_on(&aven, "alice"), Ok(false), "nor the Aven Peer on Alice's vault above it");
    let alice = t.sign("alice-peer", &test_signer("alice-peer"), b"x").unwrap();
    assert_eq!(t.acts_on(&alice, "aven-peer"), Ok(true));
    assert_eq!(t.acts_on(&alice, "bob"), Ok(false));
}
