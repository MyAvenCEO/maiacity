//! Approvals against Lean's vectors (`approvals.json`, `Aven.ID.Approve`): k of a vault's owners signing one digest,
//! an owner vault approving by its own quorum. Every expected value is the model's.

mod common;

use aven_id::caps::Sig;
use aven_id::{Kind, Owner, Tree, Vault};
use common::vectors;
use serde_json::{Value, json};

const CAST: &str = include_str!("../../../sandbox/cast.json");

/// The cast, with the vaults a vector adds after it.
fn tree(input: &Value) -> Tree {
    let cast = Tree::from_cast(CAST).expect("the cast");
    let mut vaults = cast.vaults().to_vec();
    for v in input["plus"].as_array().into_iter().flatten() {
        vaults.push(Vault {
            id: v["id"].as_str().unwrap().into(),
            name: v["name"].as_str().unwrap().into(),
            kind: Kind::parse(v["kind"].as_str().unwrap()).unwrap(),
            owners: v["owners"]
                .as_array()
                .unwrap()
                .iter()
                .map(|o| Owner::parse(o.as_str().unwrap()).unwrap())
                .collect(),
            threshold: v["threshold"].as_u64().map_or(1, |t| t as usize),
            key: v["key"].as_str().map(str::to_string),
        });
    }
    let keys = cast.keys().map(|(k, p)| (k.into(), p.into())).collect();
    Tree::new(keys, vaults).expect("a well-formed tree")
}

#[test]
fn approvals_are_the_models() {
    let all = vectors("approvals.json");
    assert!(all.len() >= 14, "{} approval vectors", all.len());
    for v in &all {
        let input = &v["input"];
        let t = tree(input);
        let sigs: Vec<Sig> = input["sigs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| Sig::new(s["key"].as_str().unwrap(), s["digest"].as_str().unwrap()))
            .collect();
        let vault = input["vault"].as_str().unwrap();
        let digest = input["digest"].as_str().unwrap();
        let got = if let Some(k) = input["threshold"].as_u64() {
            json!({ "approved": t.approved(k as usize, vault, digest, &sigs) })
        } else {
            let ths = &input["thresholds"];
            let th = |v: &str| ths[v].as_u64().map_or(1, |k| k as usize);
            json!({ "approves": t.approves(&th, vault, digest, &sigs) })
        };
        assert_eq!(got, v["expected"], "{}", v["name"]);
    }
}
