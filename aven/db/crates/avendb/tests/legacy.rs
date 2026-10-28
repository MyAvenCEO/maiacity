//! The Lean model's legacy anchor vectors (`aven/db/spec/vectors/legacy.json`, written by `lake exe vectors` from
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

/// The freeze of the edits a server holds (`legacy::Freezing`): Alice's vault, founded before the key move by her
/// SLH-DSA passkey on her SLH-DSA Mac, which then adds her ML-DSA-65 Mac, is frozen whole; Bob's vault, founded since
/// in ML-DSA-65 alone, is not. As no test signs in SLH-DSA since the fork, her edits bring their old keys and no
/// signature, and the test counts them as frozen (`legacy::admit`). Every edit is kept, every frozen one has its path to
/// the anchor, and the survey says which signers of each vault are still of SLH-DSA, and who signs in it.
#[test]
fn the_freeze_takes_the_slh_dsa_edits_and_says_who_is_left() {
    use avendb::id::VaultId;
    use avendb::policy::{Action, Edit, Kind, Principal, Sharing};
    use avendb::sign::{DeviceKey, Passkey, PqKey, Signature, Signed, SignerKeys};

    let old = SignerKeys::Passkey { p256: Passkey::from_seed([1; 32]).public(), pq: PqKey::Slh([1; 32]) };
    let mac = SignerKeys::Device { ed25519: [2; 32], pq: PqKey::Slh([2; 32]) };
    let next_mac = DeviceKey::from_secret([3; 32]);
    let mut bob = Passkey::from_seed([4; 32]);
    let genesis = |p: SignerId| Action::Genesis {
        kind: Kind::Human,
        owners: vec![Principal::Signer(p)],
        threshold: 1,
        root: Some(p),
        nonce: 0,
        seal_to: vec![],
    };
    let edit = |depth, author, cosigners, action| Edit { parents: vec![], depth, author, cosigners, action };
    let unsigned = |keys: SignerKeys| Signature { keys, webauthn: None, enclave: None, pq: vec![] };

    let founding = edit(0, old.id(), vec![], genesis(old.id()));
    let alice = VaultId::from(founding.id());
    let add = |d| Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
    let adds_mac = edit(1, old.id(), vec![mac.id()], add(mac.id()));
    let adds_next = edit(2, old.id(), vec![next_mac.id()], add(next_mac.id()));
    let bobs = edit(0, bob.id(), vec![], genesis(bob.id()));
    let frozen = [founding.id(), adds_mac.id(), adds_next.id()];
    legacy::admit(frozen);
    let signed = [
        Signed { sigs: vec![unsigned(old)], edit: founding },
        Signed { sigs: vec![unsigned(old), unsigned(mac)], edit: adds_mac },
        Signed { sigs: vec![unsigned(old), next_mac.sign(adds_next.id())], edit: adds_next },
        Signed { sigs: vec![bob.sign(bobs.id())], edit: bobs.clone() },
    ];
    // a frozen edit's legacy part counts with no signature; a later edit's never
    assert!(signed.iter().all(|s| s.verify().is_ok()));
    let late = edit(3, old.id(), vec![], add(SignerId::from_u64(9)));
    assert!(Signed { sigs: vec![unsigned(old)], edit: late }.verify().is_err());

    let mut freezing = legacy::Freezing::default();
    for s in signed.iter().chain(&signed) {
        freezing.take(s, Some(alice));
    }
    let survey = freezing.finish();
    assert_eq!(survey.held, 4, "each edit once");
    let mut sorted = frozen.to_vec();
    sorted.sort();
    assert_eq!(survey.frozen.ids().collect::<Vec<_>>(), sorted);
    assert!(!survey.frozen.holds(bobs.id()), "Bob's vault is ML-DSA-65 alone");
    assert_eq!((survey.bare, survey.refused), (0, 0));
    let anchor = survey.frozen.anchor();
    for id in frozen {
        assert!(anchor.shows(id, &survey.frozen.path(id).expect("frozen")));
    }
    let report = survey.to_json();
    assert_eq!(report["kept_after_the_fork"], 4);
    let left = |v: &[u8; 32]| {
        let hex = avendb::words::hex(v);
        let vaults = report["vaults"].as_array().expect("vaults");
        vaults.iter().find(|x| x["vault"] == hex).expect("listed")["slh_dsa_left"].as_u64().expect("a count")
    };
    assert_eq!(left(&alice.0), 2, "her old passkey and her old Mac");
    assert_eq!(left(&bobs.id().0), 0);
    let signers = report["slh_signers"].as_array().expect("signers");
    assert_eq!(signers.len(), 2, "her old passkey and her old Mac: {signers:?}");
    assert_eq!((signers[0]["edits"].as_u64(), signers[0]["deepest"].as_u64()), (Some(3), Some(2)), "her passkey");
    assert_eq!(report["deepest"], 2);
}
