//! A new device of a person starts from what another device of the same passkey handed it (`Lab::handing`,
//! `Lab::start_handed`, M6, `V7_handed_view`): it checks only the signatures of the edits the handed view isn't of, and
//! steps those on the view instead of replaying every edit, in whatever order it took them. A device of another
//! passkey, bytes changed on the way, or a view of edits it didn't take start it as a restore does.

use avendb::cast::{document, human_on};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{Backup, Lab};
use serde_json::Value;

/// How many times device `d` counted `what` (`Lab::perf`).
fn count(lab: &Lab, d: SignerId, what: &str) -> u64 {
    lab.perf(d)["counts"][what].as_u64().unwrap_or(0)
}

/// How many times device `d` replayed every edit it holds again, for any reason.
fn wholes(lab: &Lab, d: SignerId) -> u64 {
    let perf = lab.perf(d);
    let counts = perf["counts"].as_object().expect("counts");
    counts.iter().filter(|(k, _)| k.starts_with("replay whole")).map(|(_, n)| n.as_u64().unwrap_or(0)).sum()
}

/// Alice's Mac and iPhone, of one passkey, her vault founded and some notes on it, each edited.
fn alice() -> (Lab, SignerId, SignerId, VaultId, Vec<EntryId>) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let alice = human_on(&mut lab, passkey, &[mac, phone]);
    let mut notes = vec![];
    for i in 0..12 {
        notes.push(lab.create(mac, alice, alice, "note", &[], document(&format!("Note {i}"), "Hello.", mac)).unwrap());
    }
    for (i, e) in notes.iter().enumerate() {
        lab.edit(mac, alice, *e, |it| it.set_text(2, &format!("Edit of {i}."))).unwrap();
    }
    (lab, mac, phone, alice, notes)
}

/// What device `d` shows of each of `notes`.
fn shown(lab: &Lab, d: SignerId, notes: &[EntryId]) -> Vec<Option<Value>> {
    notes.iter().map(|e| lab.item(d, *e).map(|it| it.record())).collect()
}

#[test]
fn a_new_device_starts_from_the_view_its_passkeys_device_handed_it() {
    let (mut lab, mac, phone, alice, notes) = alice();
    let handed = lab.handing(mac).expect("the Mac's view of every edit it holds");
    let of = lab.backup(mac).signed().len() as u64;
    // the Mac writes on after it handed its view: those edits are new to the view
    for (i, e) in notes.iter().enumerate().take(4) {
        lab.edit(mac, alice, *e, |it| it.set_text(2, &format!("Later edit of {i}."))).unwrap();
    }
    let all = lab.backup(mac);
    let new = all.signed().len() as u64 - of;
    // the phone takes them in another order than the Mac did
    let mut signed = all.signed().to_vec();
    signed.reverse();
    let (checked, from_view, whole) =
        (count(&lab, phone, "edits checked"), count(&lab, phone, "replay: from a handed view"), wholes(&lab, phone));
    assert!(lab.start_handed(phone, Backup::new(signed, []), &handed), "the phone takes the Mac's view");
    assert_eq!(count(&lab, phone, "replay: from a handed view"), from_view + 1);
    assert_eq!(count(&lab, phone, "edits checked") - checked, new, "it checks only the edits the view isn't of");
    assert_eq!(wholes(&lab, phone), whole, "it replays no edit it holds again");
    assert_eq!(shown(&lab, phone, &notes), shown(&lab, mac, &notes), "the phone shows what the Mac shows");
    assert!(shown(&lab, phone, &notes).iter().all(Option::is_some), "every note opened");
}

#[test]
fn a_view_handed_with_nothing_new_is_the_whole_replay() {
    let (mut lab, mac, phone, _, notes) = alice();
    let handed = lab.handing(mac).expect("the Mac's view");
    let (checked, whole) = (count(&lab, phone, "edits checked"), wholes(&lab, phone));
    assert!(lab.start_handed(phone, lab.backup(mac), &handed));
    assert_eq!(count(&lab, phone, "edits checked"), checked, "it checks no edit again");
    assert_eq!(wholes(&lab, phone), whole, "it replays no edit again");
    assert_eq!(shown(&lab, phone, &notes), shown(&lab, mac, &notes));
}

#[test]
fn another_passkeys_device_changed_bytes_or_missing_edits_start_as_a_restore() {
    let (mut lab, mac, phone, _, notes) = alice();
    let handed = lab.handing(mac).expect("the Mac's view");
    let all = lab.backup(mac);
    // a device of Bob's passkey opens nothing of it
    let bob = lab.passkey("Bob");
    let bobs = lab.device_of(bob, "Bob's Mac");
    assert!(lab.hand_key(bobs).is_some());
    assert!(!lab.start_handed(bobs, all.clone(), &handed), "Bob's Mac opens nothing Alice's Mac handed");
    // a byte changed on the way
    let mut changed = handed.clone();
    let last = changed.len() - 1;
    changed[last] ^= 1;
    assert!(!lab.start_handed(phone, all.clone(), &changed), "a changed byte opens nothing");
    assert_eq!(shown(&lab, phone, &notes), shown(&lab, mac, &notes), "it restored all the same");
    // edits the view is of that the phone didn't take: it takes what came, and checks it all
    let some: Vec<_> = all.signed()[1..].to_vec();
    let checked = count(&lab, phone, "edits checked");
    assert!(!lab.start_handed(phone, Backup::new(some.clone(), []), &handed), "a view of edits it lacks");
    assert_eq!(count(&lab, phone, "edits checked") - checked, some.len() as u64, "every edit it took checked");
    assert_eq!(lab.backup(phone).signed().len(), some.len(), "every edit it took held");
    // a device locked, or of no passkey, hands nothing
    let server = lab.device("server");
    assert!(lab.handing(server).is_none() && lab.hand_key(server).is_none());
}

/// A probe, run by hand: how long a new device takes to start from every edit, checked and replayed, and from a view
/// handed to it (`NOTES=2000 cargo test --release --test handed_view -- --ignored --nocapture`).
#[test]
#[ignore]
fn what_a_handed_view_spares() {
    let n: usize = std::env::var("NOTES").ok().and_then(|s| s.parse().ok()).unwrap_or(300);
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's iPhone");
    let alice = human_on(&mut lab, passkey, &[mac, phone]);
    for i in 0..n {
        let e = lab.create(mac, alice, alice, "note", &[], document(&format!("Note {i}"), "Hello.", mac)).unwrap();
        lab.edit(mac, alice, e, |it| it.set_text(2, &format!("Edit of {i}."))).unwrap();
    }
    let all = lab.backup(mac);
    let t = std::time::Instant::now();
    let handed = lab.handing(mac).expect("the Mac's view");
    eprintln!("{} edits; handing: {:?}, {} bytes", all.signed().len(), t.elapsed(), handed.len());
    let t = std::time::Instant::now();
    lab.restore_from(phone, all.clone());
    eprintln!("start from every edit: {:?}", t.elapsed());
    let t = std::time::Instant::now();
    assert!(lab.start_handed(phone, all, &handed));
    eprintln!("start from the handed view: {:?}", t.elapsed());
}


#[test]
fn real_passkey_devices_hand_views_without_software_passkey_seeds() {
    use avendb::sign::Passkey;
    let (mut source, mac, _, vault, notes) = alice();
    let passkey = source.state(mac).vault(vault).unwrap().root.unwrap();
    let seed = source.passkey_secret(passkey).unwrap();
    let mut authenticator = Passkey::from_seed(*seed);
    let ceremony = authenticator.ceremony([42; 32]);
    let backup = source.backup(mac);
    let handed = source.handing(mac).unwrap();

    let mut browser = Lab::new();
    let device = browser.device_with("real browser", [83; 32]);
    let keys = browser.web_passkey("Alice", authenticator.public(), &ceremony).unwrap();
    assert!(browser.passkey_secret(keys[0]).is_none());
    assert!(browser.hand_key(device).is_none(), "a device secret alone cannot open a passkey's view");
    assert!(browser.hand_from_ceremony(device, keys[0], &ceremony));
    assert!(browser.start_handed(device, backup.clone(), &handed));
    assert_eq!(count(&browser, device, "edits checked"), 0);
    assert_eq!(count(&browser, device, "replay: from a handed view"), 1);
    // The new device isn't yet a member. Adopting a view grants no membership or reading rights.
    assert!(shown(&browser, device, &notes).iter().all(Option::is_none));

    let mut stranger = Passkey::from_seed([84; 32]);
    let foreign = stranger.ceremony([42; 32]);
    assert!(!browser.hand_from_ceremony(device, keys[0], &foreign));
    assert!(browser.start_handed(device, backup, &handed), "a failed binding leaves the verified key intact");

    let mut split = browser.split(device, &[], [85; 32]);
    assert!(split.hand_key(device).is_some(), "the actual node retains the handoff key");
    split.lock(device);
    assert!(split.hand_key(device).is_none(), "locking drops the handoff key too");
    assert!(!split.hand_from_ceremony(device, keys[0], &ceremony), "a ceremony alone cannot unlock a device");
}
