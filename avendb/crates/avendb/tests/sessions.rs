//! Agents as sessions (Samuel 2026-10-21; spec `AvenDB.Sessions`): an agent on a Mac whose key is a device of avenMAIA
//! keeps no store of its own. The Mac's device hosts it: the agent's writes are drafted on the Mac's one replay, signed
//! by the agent's own key, which the Lab never holds, and kept on the Mac's store; it reads what the Mac shows, of the
//! entries its own key opens alone.

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use avendb::cast::{claim_on, document, human_on};
use avendb::lab::{Lab, Remote};
use avendb::policy::{Action, Sharing};
use avendb::sign::DeviceKey;

#[test]
fn a_session_on_the_mac_writes_as_its_own_key_and_reads_only_what_its_key_opens() {
    let mut lab = Lab::with_entropy([5; 32]);
    let server = lab.device_with("the server", [7; 32]);
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let alice = human_on(&mut lab, passkey, &[mac]);
    let aven = claim_on(&mut lab, mac, passkey, alice, server);

    // agentClaude joins avenMAIA as its device, as Alice approves it on her Mac
    let secret = [42; 32];
    let agent = lab.device_with("agentClaude", secret);
    let add = Action::Share(Sharing::Device { vault: aven, device: agent, seal_to: None });
    lab.submit(mac, &[passkey, agent], add).expect("Alice's passkey adds agentClaude to avenMAIA");

    // Alice keeps a note of her own, which avenMAIA never reads
    let diary = document("Diary", "Alice's own.", mac);
    let diary = lab.create(mac, alice, alice, "note", &[], diary).expect("a note in Alice's vault");

    // the agent keeps nothing of its own from now on: the Mac hosts it, and it signs by its key, which the Lab never holds
    lab.lose(agent);
    let key = Arc::new(DeviceKey::from_secret(secret));
    assert_eq!(key.id(), agent, "the agent's key is the device avenMAIA holds");
    let signed = Arc::new(AtomicUsize::new(0));
    let sign: Remote = {
        let (key, signed) = (key.clone(), signed.clone());
        Arc::new(move |id| {
            signed.fetch_add(1, Ordering::Relaxed);
            Some(key.sign(id))
        })
    };
    lab.host(mac, agent, key.keys(), sign);
    assert_eq!(lab.sessions(mac), vec![agent]);
    assert_eq!(lab.vault_of(agent), Some(aven), "it acts for avenMAIA");

    // it reads nothing of Alice's own, which her Mac shows her
    assert!(lab.item(mac, diary).is_some(), "Alice's Mac shows her note");
    assert!(lab.item(agent, diary).is_none() && lab.history(agent, diary).is_none() && !lab.reads(agent, diary));
    assert!(!lab.entries(agent).contains(&diary), "nor lists it");

    // it writes in avenMAIA's vault: its edit, by its own key, on the Mac's one store
    let held = lab.log(mac).edits().len();
    let note = document("Status", "Written by agentClaude.", agent);
    let note = lab.create(agent, aven, aven, "note", &[], note).expect("the agent writes in avenMAIA's vault");
    assert!(signed.load(Ordering::Relaxed) > 0, "its holder signed it");
    let fresh = &lab.log(mac).edits()[held..];
    assert!(!fresh.is_empty() && fresh.iter().all(|e| e.author == agent || e.author == mac), "kept on the Mac's store");
    assert!(fresh.iter().any(|e| e.author == agent), "authored by the agent's key");
    assert!(lab.item(agent, note).is_some() && lab.entries(agent).contains(&note), "it reads what it wrote");
    assert!(lab.item(mac, note).is_some(), "and Alice's Mac shows it, from the same store");

    // the session ends: its key is forgotten, its writes stay
    lab.unhost(agent);
    assert!(lab.sessions(mac).is_empty());
    assert!(lab.item(mac, note).is_some());
}
