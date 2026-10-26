//! The Lean model's legacy anchor vectors (`avendb/spec/vectors/legacy.json`, written by `lake exe vectors` from
//! `spec/AvenDB/LegacyVectors.lean`). For each case, a device takes the edits at the fork whose signatures all check,
//! freezes those a legacy signer signed, and after the fork takes, of those and the later edits, each whose legacy
//! parts have a path to the anchor and whose other parts check: exactly as the model says. The model's numbers are
//! ids here (`EditId::from_u64`), so the anchor's tree hashes them in the model's order.

use std::collections::HashSet;

use avendb::id::{EditId, SignerId};
use avendb::legacy::{self, Frozen};
use serde_json::Value;

const VECTORS: &str = include_str!("../../../spec/vectors/legacy.json");

struct Edit {
    id: EditId,
    sigs: Vec<SignerId>,
}

fn num(v: &Value) -> u64 {
    v.as_u64().expect("a number")
}

fn edits(v: &Value) -> Vec<Edit> {
    let list = v.as_array().expect("edits");
    list.iter()
        .map(|e| {
            let author = SignerId::from_u64(num(&e["author"]));
            let cosigners = e["cosigners"].as_array().expect("cosigners").iter().map(|s| SignerId::from_u64(num(s)));
            Edit { id: EditId::from_u64(num(&e["id"])), sigs: std::iter::once(author).chain(cosigners).collect() }
        })
        .collect()
}

fn ids(v: &Value) -> Vec<EditId> {
    v.as_array().expect("ids").iter().map(|n| EditId::from_u64(num(n))).collect()
}

#[test]
fn the_fork_takes_what_the_model_takes() {
    let cases: Vec<Value> = serde_json::from_str(VECTORS).expect("legacy.json");
    assert!(!cases.is_empty());
    for case in &cases {
        let name = case["name"].as_str().expect("name");
        let legacy: HashSet<SignerId> = case["legacy"].as_array().unwrap().iter().map(|s| SignerId::from_u64(num(s))).collect();
        let bad: HashSet<(SignerId, EditId)> = case["bad"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| (SignerId::from_u64(num(&p[0])), EditId::from_u64(num(&p[1]))))
            .collect();
        let signed = |s: SignerId, e: EditId| !bad.contains(&(s, e));
        let before = edits(&case["before"]);
        let took: Vec<&Edit> = before.iter().filter(|e| e.sigs.iter().all(|&s| signed(s, e.id))).collect();
        assert_eq!(took.iter().map(|e| e.id).collect::<Vec<_>>(), ids(&case["took"]), "{name}: taken at the fork");
        let frozen = legacy::freeze(took.iter().map(|e| (e.id, e.sigs.iter().copied())), |s| legacy.contains(&s));
        assert_eq!(frozen.ids().collect::<Vec<_>>(), ids(&case["frozen"]), "{name}: frozen");
        let anchor = frozen.anchor();
        // the anchor of the file read back, as a device reads the pinned one
        let pinned = Frozen::from_bytes(&frozen.to_bytes()).expect("reads back").anchor();
        assert_eq!(pinned, anchor, "{name}: the file");
        let later = edits(&case["later"]);
        let after: Vec<EditId> = took
            .into_iter()
            .chain(&later)
            .filter(|e| {
                let path = frozen.path(e.id);
                e.sigs.iter().all(|&s| legacy::check(&anchor, legacy.contains(&s), e.id, path.as_ref(), || signed(s, e.id)))
            })
            .map(|e| e.id)
            .collect();
        assert_eq!(after, ids(&case["after"]), "{name}: taken after the fork");
    }
}

/// The freeze of a device's edits (`legacy::survey`): Alice's vault, founded before the key move by her SLH-DSA passkey
/// on her SLH-DSA Mac, which then adds her ML-DSA-65 Mac, is frozen whole; Bob's vault, founded since in ML-DSA-65
/// alone, is not. Every frozen edit has its path to the anchor, every edit the device holds is kept, and the survey
/// says which signers of each vault are still of SLH-DSA.
#[test]
fn the_freeze_of_a_lab_takes_the_slh_dsa_edits_and_says_who_is_left() {
    use avendb::lab::Lab;
    use avendb::policy::{Action, Kind, Principal, Sharing};
    use avendb::sign::Suite;

    let mut lab = Lab::with_entropy([7; 32]);
    let old = lab.passkey_from_in("Alice", [1; 32], Suite::SlhDsa);
    let mac = lab.device_with_in("Alice's Mac", [2; 32], Suite::SlhDsa);
    let next_mac = lab.device_with_in("Alice's new Mac", [3; 32], Suite::MlDsa);
    let bob = lab.passkey_from_in("Bob", [4; 32], Suite::MlDsa);
    let genesis = |p: SignerId| Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(p)],
        threshold: 1,
        root: Some(p),
        nonce: 0,
        seal_to: vec![],
    };
    let alice = avendb::id::VaultId::from(lab.submit(mac, &[old], genesis(old)).expect("founded"));
    for d in [mac, next_mac] {
        let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
        lab.submit(mac, &[old, d], add).expect("added");
    }
    let bobs = lab.submit(mac, &[bob], genesis(bob)).expect("founded");

    let survey = legacy::survey(&lab, mac);
    let held: Vec<EditId> = lab.log(mac).ids().to_vec();
    assert_eq!(survey.held, held.len());
    let slh: Vec<EditId> = held
        .iter()
        .copied()
        .filter(|&id| {
            let signed = lab.signed_edit(mac, id).expect("held");
            signed.sigs.iter().any(|s| s.keys.suite() == Suite::SlhDsa)
        })
        .collect();
    // her genesis, her two devices and what her old Mac signed besides: the keys its edits bring
    let by_old: Vec<EditId> =
        held.iter().copied().filter(|&id| lab.signed_edit(mac, id).unwrap().edit.sigs().any(|s| s == old || s == mac)).collect();
    assert_eq!(slh, by_old);
    assert!(slh.len() >= 3);
    let mut sorted = slh.clone();
    sorted.sort();
    assert_eq!(survey.frozen.ids().collect::<Vec<_>>(), sorted);
    assert!(!survey.frozen.holds(bobs), "Bob's vault is ML-DSA-65 alone");
    assert_eq!(survey.unseen, 0);
    let anchor = survey.frozen.anchor();
    for id in slh {
        assert!(anchor.shows(id, &survey.frozen.path(id).expect("frozen")));
    }
    let report = survey.to_json();
    assert_eq!(report["kept_after_the_fork"], held.len());
    let left = |v: &[u8; 32]| {
        let hex = avendb::words::hex(v);
        let vaults = report["vaults"].as_array().expect("vaults");
        vaults.iter().find(|x| x["vault"] == hex).expect("listed")["slh_dsa_left"].as_u64().expect("a count")
    };
    assert_eq!(left(&alice.0), 2, "her old passkey and her old Mac");
    assert_eq!(left(&bobs.0), 0);
}
