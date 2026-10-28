//! The Lean model's key tree vectors (`aven/db/spec/vectors/key_trees.json`, written by `lake exe vectors` from
//! `KeyTreeVectors.lean`): runs of adds, removals and commits, which V6 (`KeyTree.lean`) proves keep every member in
//! and every removed device out. Each run is played on the Rust tree with real X-Wing keys: the same changes must
//! count, the epochs must hold the same keys and keep the history alike, and each device must open exactly the keys of
//! each epoch that the model says it opens. So the tree's crypto is held to the proof, not only to its own tests.

use std::collections::{BTreeSet, HashMap};

use avendb::id::SignerId;
use avendb::keys::{Secret, SeededRng};
use avendb::tree::{Change, CommitId, KeyTree};
use avendb_testkit::{num as n, vectors};
use serde_json::Value;

/// One run on the Rust tree, against what the model says of it.
fn play(case: &Value) {
    let name = case["name"].as_str().expect("a name");
    let mut rng = SeededRng::new("key tree vectors", name.as_bytes());
    let mut own: HashMap<u64, (SignerId, Secret)> = HashMap::new();
    let mut tree = KeyTree::new(name.as_bytes());
    // the tree after each number of changes, as a commit drafted on it saw it
    let mut seen = vec![tree.clone()];
    let mut commits: HashMap<u64, CommitId> = HashMap::new();
    for (i, (step, counts)) in case["steps"].as_array().unwrap().iter().zip(case["counts"].as_array().unwrap()).enumerate() {
        let counts = counts.as_bool().unwrap();
        let change = if let Some(d) = step.get("add") {
            let (d, leaf, history) = (n(d), n(&step["leaf"]), step["history"].as_bool().unwrap());
            let (id, secret) = own.entry(d).or_insert_with(|| (SignerId::from_u64(d), Secret::generate(&mut rng))).clone();
            // a member that opens the epoch's keys boxes them to the new device
            let adders: Vec<(SignerId, Secret)> =
                tree.members().filter_map(|m| own.values().find(|o| o.0 == m.device).cloned()).collect();
            let drafted = adders.iter().find_map(|(me, k)| {
                tree.draft_add(*me, k, id, leaf, secret.xwing_public(), history, &mut rng)
            });
            Some(drafted.unwrap_or(Change::Add { device: id, leaf, public: secret.xwing_public(), history, boxes: vec![] }))
        } else if let Some(d) = step.get("remove") {
            Some(Change::Remove { device: own[&n(d)].0 })
        } else {
            let (u, on) = (n(&step["draft"]), n(&step["on"]) as usize);
            let (id, secret) = own[&u].clone();
            seen[on].draft(id, &secret, &mut rng)
        };
        let applied = match &change {
            Some(c) => tree.apply(c).is_ok(),
            None => false,
        };
        assert_eq!(applied, counts, "{name}: step {i} ({step}) counts as the model says");
        if let (true, Some(Change::Commit(c))) = (applied, &change) {
            commits.insert(i as u64, c.id());
        }
        seen.push(tree.clone());
    }
    let step_of: HashMap<CommitId, u64> = commits.iter().map(|(s, c)| (*c, *s)).collect();
    assert_eq!(tree.epoch(), n(&case["epoch"]), "{name}: the epoch");
    for (g, keys) in case["keys"].as_array().unwrap().iter().enumerate() {
        let ours: Vec<u64> = tree.keys(g as u64).iter().map(|c| step_of[c]).collect();
        let model: Vec<u64> = keys.as_array().unwrap().iter().map(n).collect();
        assert_eq!(ours, model, "{name}: the keys of epoch {g}");
    }
    for (g, chains) in case["chains"].as_array().unwrap().iter().enumerate() {
        assert_eq!(tree.chains(g as u64), chains.as_bool().unwrap(), "{name}: whether epoch {g} keeps the history");
    }
    let members: BTreeSet<SignerId> = tree.members().map(|m| m.device).collect();
    let model: BTreeSet<SignerId> = case["members"].as_array().unwrap().iter().map(|d| own[&n(d)].0).collect();
    assert_eq!(members, model, "{name}: the members");
    for o in case["opens"].as_array().unwrap() {
        let (d, g, c, opens) = (n(&o[0]), n(&o[1]), n(&o[2]), o[3].as_bool().unwrap());
        let (id, secret) = &own[&d];
        let got = tree.opener(*id, secret).epoch_key(g, commits[&c]).is_some();
        assert_eq!(got, opens, "{name}: device {d} opens the key commit {c} made in epoch {g}");
    }
}

#[test]
fn the_key_tree_opens_what_the_model_says() {
    let cases = vectors("key_trees");
    for case in cases.as_array().expect("a list of runs") {
        play(case);
    }
}
