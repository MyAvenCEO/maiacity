//! A step of a catch-up leaves for the next only bodies to open (`read`, `ReadNew::left`): after a whole replay it
//! looks at every edit it holds, and of them the writes alone have a body. An iPhone's catch-up of one 712-edit page
//! left its 108,000 keys, wraps and marks to look at 32 a step, 3,629 steps of 24 ms each (2026-10-28).
use super::*;
use crate::cast::{document, paragraph};
use crate::policy::{Kind, Principal, Sharing};

/// Alice's iPhone, which took her vault early, then the edits her writers made since, interleaved, as a node takes
/// them, not caught up: they sort before where its replay steps on from, so its catch-up replays them all and reads
/// every write anew (`tests/catch_up_steps.rs`, `first_sync`).
fn first_sync(writers: usize, per: usize) -> (Lab, SignerId) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let ws: Vec<SignerId> = (0..writers).map(|i| lab.device_of(passkey, &format!("Alice's writer {i}"))).collect();
    let genesis = Action::Genesis {
        kind: Kind::Human, owners: vec![Principal::Signer(passkey)], threshold: 1, root: Some(passkey), nonce: 0, seal_to: vec![],
    };
    let alice = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a vault"));
    for &d in [phone].iter().chain(&ws) {
        let add = Action::Share(Sharing::Device { vault: alice, device: d, seal_to: None });
        lab.submit(mac, &[passkey, d], add).expect("a device added");
    }
    for &d in [phone].iter().chain(&ws) {
        lab.sync(mac, d);
    }
    for (i, &w) in ws.iter().enumerate() {
        let entry = lab.create(w, alice, alice, "doc", &[], document(&format!("Doc {i}"), "Written.", w)).expect("a document");
        for k in 0..per {
            lab.edit(w, alice, entry, |item| item.push_block(paragraph(100 + k as u64, &format!("Edit {k}.")))).expect("an edit");
        }
    }
    for &w in &ws {
        let held: HashSet<EditId> = lab.log(phone).ids().iter().copied().collect();
        let fresh: Vec<Signed> = lab.backup(w).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect();
        for page in fresh.chunks(40) {
            lab.receive_whose_now(phone, page.to_vec(), vec![], false);
        }
    }
    (lab, phone)
}

#[test]
fn a_step_leaves_only_writes_to_open() {
    let (mut lab, d) = first_sync(6, 40);
    let writes = |lab: &Lab| lab.log(d).edits().iter().filter(|e| matches!(e.action, Action::Write { .. })).count();
    let (held, w) = (lab.log(d).edits().len(), writes(&lab));
    assert!(held > w, "it holds edits other than writes: {held} edits, {w} writes");
    let reads = |lab: &Lab| lab.perf(d)["timers"]["read"]["count"].as_u64().unwrap_or(0);
    let (before, mut left_after, mut taken) = (reads(&lab), 0, 0);
    loop {
        let step = lab.catch_up_step(d, 1);
        taken += 1;
        assert!(taken < 10_000, "a catch-up in steps ends");
        let store = lab.held(d);
        for id in &store.read_new.left {
            let write = store.signed.get(id).is_some_and(|s| matches!(s.edit.action, Action::Write { .. }));
            assert!(write && !store.bodies.contains_key(id), "it left {id:?} for the next step, no body to open");
        }
        left_after += !store.read_new.left.is_empty() as usize;
        if let CatchUp::Caught(_) = step {
            break;
        }
    }
    assert!(reads(&lab) > before, "it read");
    // a step at the least budget opens `READ_WORK` bodies: as many steps leave some as its writes call for
    assert!(left_after <= w.div_ceil(READ_WORK), "{left_after} steps left bodies to open, of {w} writes");
    assert_eq!(lab.perf(d)["counts"]["read: every write"].as_u64(), Some(1), "it read every write anew, once");
}
