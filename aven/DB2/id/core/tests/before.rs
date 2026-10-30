//! What production stored before the agent (`Aven.ID.Before`, `tests/before`): the statements main's code kept on 30
//! Oct 2026, read with today's: the same tree but for Aven's kind, which reads as `agent` (Lean's vector of the old
//! name, `trees.json`), the members on the admin coop, the same door; and the same again through the statements the
//! Aven Peer tells its devices, as a Peer-Light checks them.

mod common;

use aven_id::{Claim, Invite, Join, Kind, Members, Network, Relying, SignIn, Withdrawal};
use serde_json::{Value, json};

fn old() -> Value {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/tests/before/store-2026-10-30.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn tree(m: &Members) -> Value {
    let keys: Vec<Value> = m
        .publics()
        .into_iter()
        .map(|(id, k)| json!([id, k]))
        .collect();
    let vaults: Vec<Value> = m
        .vaults()
        .iter()
        .map(|v| {
            let owners: Vec<String> = v.owners.iter().map(ToString::to_string).collect();
            json!({ "id": v.id, "name": v.name, "kind": v.kind.as_str(), "owners": owners })
        })
        .collect();
    json!({ "keys": keys, "vaults": vaults })
}

/// The members read back from the stored refs, in the order a store lists them, as the Aven Peer reads its store.
fn restore(old: &Value) -> Members {
    let s = &old["server"];
    let text = |k: &str| s[k].as_str().unwrap();
    let rp = Relying {
        rp_id: text("rpId").into(),
        origins: common::origins(&s["origins"]),
    };
    let base = Members::new(
        Network::new(
            text("network"),
            text("peer"),
            text("peerKey"),
            rp,
            Some(text("guardian").into()),
        )
        .with_coop(text("coop"), text("coopName")),
    );
    let refs = old["refs"].as_object().unwrap();
    let mut names: Vec<&String> = refs.keys().collect();
    names.sort();
    let (mut claim, mut sign_ins, mut invites, mut withdrawn, mut joins) =
        (None, vec![], vec![], vec![], vec![]);
    for n in names {
        let v = &refs[n];
        match n.split('-').next().unwrap() {
            "claim" => claim = Some(Claim::from_json(v).unwrap()),
            "signin" => sign_ins.push(SignIn::from_json(v).unwrap()),
            "invite" => invites.push(Invite::from_json(v).unwrap()),
            "withdrawn" => withdrawn.push(Withdrawal::from_json(v).unwrap()),
            "joined" => joins.push(Join::from_json(v).unwrap()),
            other => panic!("an unknown ref {other}"),
        }
    }
    base.restore(claim, sign_ins, invites, withdrawn, joins)
        .unwrap()
}

fn check(m: &Members, old: &Value) {
    let mut want = old["tree"].clone();
    for v in want["vaults"].as_array_mut().unwrap() {
        v["kind"] = json!(Kind::parse(v["kind"].as_str().unwrap()).unwrap().as_str());
    }
    assert_ne!(want, old["tree"], "the old tree names a network");
    assert_eq!(tree(m), want);
    let t = m.tree().unwrap();
    assert_eq!(t.kind("aven"), Some(Kind::Agent));
    assert_eq!(t.kind(m.coop()), Some(Kind::Coop));
    assert_eq!(json!(m.members()), old["members"]);
    assert!(m.members().iter().all(|s| m.member_of(s, m.coop())));
    assert!(!m.members().is_empty() && m.members().iter().all(|s| !m.member_of(s, "aven")));
    assert_eq!(json!(m.admitted()), old["admitted"]);
    // a restart reads invites back by their id, not in the order they came (`Aven.ID.Invite`)
    let sorted = |v: &Value| {
        let mut all: Vec<String> = v.as_array().unwrap().iter().map(Value::to_string).collect();
        all.sort();
        all
    };
    let states: Vec<Value> = m
        .invites()
        .iter()
        .map(|i| json!([i.key, m.state(&i.key)]))
        .collect();
    assert_eq!(sorted(&json!(states)), sorted(&old["invites"]));
    // the admin's passkey signs for the coop, the member's doesn't
    let claim = m.network().claim().unwrap();
    assert!(m.admin_key(&claim.passkey));
    assert!(m.joins().iter().all(|j| !m.admin_key(&j.passkey)));
}

#[test]
fn the_stored_statements_read_as_the_agents_tree() {
    let old = old();
    check(&restore(&old), &old);
}

#[test]
fn a_device_reads_them_the_same_through_the_statements_it_is_told() {
    let old = old();
    let told = restore(&old).statements();
    check(&Members::from_statements(&told).unwrap(), &old);
}
