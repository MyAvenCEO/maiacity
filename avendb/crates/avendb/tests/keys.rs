//! Keys on the Lab (P3; T5, T6, T7): what each device can open, and what the server holds; since P4b, devices
//! that lock and unlock with the passkey, and what is left once the curves fall (T18); and since P6, that a device
//! writes under the newest key it knows (T15). They share one test binary, as the Lab's world makes Classic McEliece
//! keys that take a while, and each binary makes its own.

mod common;

use common::*;
use avendb::id::GrantId;
use avendb::keys::KeyScope;
use avendb::lab::Tamper;
use avendb::policy::{view, Action, Grantee, Op, Principal, Refusal, Role, Scope};

#[test]
fn entry_reader_cannot_open_other_entries() {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    w.lab.submit(w.mac_a, &[w.mac_a], grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None)).unwrap();
    w.lab.sync_all(1);
    // Carol opens Welcome's key and reads it…
    assert!(w.lab.opens(w.mac_c, KeyScope::Entry(h.space, h.welcome)));
    assert_eq!(text(&w.lab, w.mac_c, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    // …but neither Onboarding's key, nor the Handbook's, nor the coop's, and never fetches Onboarding
    for k in [KeyScope::Entry(h.space, h.onboarding), KeyScope::Space(h.space), KeyScope::Vault(h.coop)] {
        assert!(!w.lab.opens(w.mac_c, k), "{k:?}");
    }
    assert_eq!(w.lab.fetched(w.mac_c, h.space, h.onboarding), 0);
    assert!(!contains(&w.lab.store(w.mac_c), ONBOARDING_TEXT));
}

#[test]
fn server_holds_only_ciphertext() {
    let mut w = world();
    let h = handbook(&mut w);
    // the server relays Welcome and Onboarding…
    assert!(w.lab.fetched(w.server, h.space, h.welcome) > 0 && w.lab.fetched(w.server, h.space, h.onboarding) > 0);
    // …opens no key of the coop, the Handbook or its entries, and no plaintext appears anywhere in its store
    let keys = [
        KeyScope::Vault(h.coop),
        KeyScope::Space(h.space),
        KeyScope::Entry(h.space, h.welcome),
        KeyScope::Entry(h.space, h.onboarding),
    ];
    assert!(keys.iter().all(|&k| !w.lab.opens(w.server, k)));
    let store = w.lab.store(w.server);
    for plain in [WELCOME_TEXT, ONBOARDING_TEXT, "Welcome", "Onboarding"] {
        assert!(!contains(&store, plain), "{plain} in the server's store");
    }
}

#[test]
fn revoked_reader_cannot_open_new_edits() {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    let welcome = Scope::Entry(h.space, h.welcome);
    let read = grant(welcome, Role::Read, vault(carol), h.coop, None);
    let carol_read = GrantId::from(w.lab.submit(w.mac_a, &[w.mac_a], read).unwrap());
    w.lab.sync_all(2);
    let key = KeyScope::Entry(h.space, h.welcome);
    let before = w.lab.log(w.mac_a).view().epoch(key);
    let revoke = Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(2);
    // the key moved on; Carol can't open it and never sees the new text, Bob does (T6)
    assert_eq!(w.lab.log(w.mac_a).view().epoch(key), before + 1);
    assert!(!w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    assert_eq!(text(&w.lab, w.mac_b, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    // what she had stays readable to her
    assert_eq!(text(&w.lab, w.mac_c, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
}

#[test]
fn a_device_writes_under_the_newest_key_it_knows() {
    // T15: Carol loses Welcome while Alice's iPhone is offline
    let mut w = world();
    let h = handbook(&mut w);
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(w.carol), h.coop, None);
    let carol_read = GrantId::from(w.lab.submit(w.mac_a, &[w.mac_a], read).unwrap());
    w.lab.sync_all(15);
    let key = KeyScope::Entry(h.space, h.welcome);
    let before = w.lab.state(w.phone_a).epoch(key);
    w.lab.set_online(w.phone_a, false);
    let revoke = Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    // the iPhone hasn't seen the revocation, so its edit is made alongside it, under the key it knows
    let alongside = w.lab.edit(w.phone_a, h.coop, h.space, h.welcome, |i| i.set_text(1, "Welcome, alongside")).unwrap();
    w.lab.set_online(w.phone_a, true);
    w.lab.sync_all(15);
    // once it has seen it, it writes under the new key, which Carol can't open
    let after = w.lab.edit(w.phone_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(15);
    let epoch = |id| w.lab.state(w.mac_a).all_writes().iter().find(|x| x.op == id).map(|x| x.epoch);
    assert_eq!((epoch(alongside), epoch(after)), (Some(before), Some(before + 1)));
    assert!(!w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    // both edits stand
    assert_eq!(text(&w.lab, w.mac_b, h.space, h.welcome, 1).as_deref(), Some("Welcome, alongside"));
    assert_eq!(text(&w.lab, w.mac_b, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
}

/// Each device opens the current key of a family exactly when, by every op the Lab holds, it may: it reads the family
/// or the family is public (T6, and every device that may read gets the key).
fn keys_follow_caps(w: &World, step: &str) {
    let devices = [w.mac_a, w.phone_a, w.mac_b, w.mac_c, w.mac_d, w.server, w.stranger];
    let mut all: Vec<Op> = vec![];
    for d in devices {
        for op in w.lab.log(d).ops() {
            if !all.contains(op) {
                all.push(op.clone());
            }
        }
    }
    let st = view(&all);
    for d in devices {
        for k in st.key_scopes() {
            let may = st.entitled(d, k) || st.public_key(k);
            assert_eq!(w.lab.opens(d, k), may, "{step}: {d:?} and {k:?}");
        }
    }
}

#[test]
fn every_device_opens_exactly_what_it_may() {
    let mut w = world();
    let h = handbook(&mut w);
    keys_follow_caps(&w, "the Handbook");
    // a public charter, and Carol reading Welcome
    let charter = w.lab.create(w.mac_a, h.coop, h.space, document("Charter", CHARTER_TEXT, w.mac_a)).unwrap();
    w.lab.submit(w.mac_a, &[w.mac_a], grant(Scope::Entry(h.space, charter), Role::Read, Grantee::Public, h.coop, None)).unwrap();
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None);
    let carol_read = GrantId::from(w.lab.submit(w.mac_a, &[w.mac_a], read).unwrap());
    w.lab.sync_all(3);
    keys_follow_caps(&w, "public charter, Carol reads Welcome");
    // Carol's read revoked, then Welcome edited
    let revoke = Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(4);
    keys_follow_caps(&w, "Carol revoked");
    // Bob leaves the coop, and Alice loses her iPhone
    let bob = w.bob;
    w.lab.submit(w.mac_b, &[w.passkey_b], Action::RemoveOwner { vault: h.coop, owner: Principal::Vault(bob), keep: vec![] }).unwrap();
    w.lab.sync_all(5);
    keys_follow_caps(&w, "Bob left");
    let (alice, phone) = (w.alice, w.phone_a);
    w.lab.submit(w.mac_a, &[w.passkey_a], Action::RemoveDevice { vault: alice, device: phone, keep: vec![] }).unwrap();
    w.lab.sync_all(6);
    keys_follow_caps(&w, "the iPhone removed");
}

/// A person's device derives its keys from the passkey at every unlock (P4b): locked, it holds no key and shows
/// nothing, though it keeps the ciphertext and still receives; unlocked, it opens again what it did; once the passkey
/// is lost, nothing unlocks it.
#[test]
fn a_locked_device_holds_no_key() {
    let mut w = world();
    let h = handbook(&mut w);
    let welcome = KeyScope::Entry(h.space, h.welcome);
    assert!(w.lab.opens(w.phone_a, welcome));
    w.lab.lock(w.phone_a);
    assert!(w.lab.locked(w.phone_a));
    assert!(!w.lab.opens(w.phone_a, welcome) && w.lab.item(w.phone_a, h.space, h.welcome).is_none());
    assert!(!contains(&w.lab.store(w.phone_a), WELCOME_TEXT));
    // it signs nothing, and still receives the Mac's edit, as ciphertext
    let edit = w.lab.edit(w.phone_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    assert_eq!(edit, Err(Refusal::Locked));
    let before = w.lab.fetched(w.phone_a, h.space, h.welcome);
    w.lab.edit(w.mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(1);
    assert_eq!(w.lab.fetched(w.phone_a, h.space, h.welcome), before + 1);
    assert!(!contains(&w.lab.store(w.phone_a), AFTER_TEXT));
    // unlocked, it derives the same key from the passkey, and reads the edit
    assert!(w.lab.unlock(w.phone_a));
    assert_eq!(text(&w.lab, w.phone_a, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    // the server and a stranger derive their keys from no passkey; and with Alice's passkey lost, the iPhone stays
    // locked once it locks
    assert!(!w.lab.unlock(w.server) && !w.lab.unlock(w.stranger));
    w.lab.lock(w.phone_a);
    w.lab.lose(w.passkey_a);
    assert!(!w.lab.unlock(w.phone_a) && w.lab.locked(w.phone_a));
}

/// Once the curves fall (P4b; T18): whoever broke a device's ed25519 key signs writes as it, as writes carry only
/// the classical half, but no grant, no governance and no checkpoint, which carry the hash-based half too. A peer
/// that no longer trusts the curves counts only the writes their own device's checkpoints cover, and the devices'
/// own edits go on as before, each vouched for at once.
#[test]
fn a_broken_curve_writes_nothing_that_counts() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac_a, mac_b, dave) = (w.mac_a, w.mac_b, w.dave);
    let broken = |action| Tamper::BrokenClassicalKey { signer: mac_a, action };
    // no grant to Dave, and no new device for Alice, with the classical half alone
    let to_dave = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(dave), h.coop, None);
    assert_eq!(w.lab.tamper(mac_b, broken(to_dave)), Err(Refusal::BadSignature));
    let add = Action::AddDevice { vault: w.alice, device: w.stranger, seal_to: None };
    assert_eq!(w.lab.tamper(mac_b, broken(add)), Err(Refusal::BadSignature));
    // a write as Alice's Mac passes while Bob's Mac trusts the curves
    let forged = w.lab.tamper(mac_b, broken(write(h.space, h.welcome, h.coop, 0))).unwrap();
    let counts = |w: &World, d| w.lab.state(d).all_writes().iter().any(|x| x.op == forged);
    assert!(counts(&w, mac_b));
    // the forger can't vouch for it
    let vouch = Action::Checkpoint { space: h.space, entry: h.welcome, covers: vec![forged] };
    assert_eq!(w.lab.tamper(mac_b, broken(vouch)), Err(Refusal::BadSignature));
    // once no device trusts the curves, the forged write doesn't count, and Alice's own edits, vouched for when her
    // Mac synced, still do
    w.lab.set_pq_only(true);
    assert!(!counts(&w, mac_b) && w.lab.log(mac_b).view().all_writes().iter().any(|x| x.op == forged));
    assert_eq!(text(&w.lab, mac_b, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    // an edit made now is vouched for at once, and reaches Bob's Mac
    w.lab.edit(mac_a, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(7);
    assert_eq!(text(&w.lab, mac_b, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    assert_eq!(text(&w.lab, w.mac_c, h.space, h.welcome, 2), None);
    keys_follow_caps(&w, "the curves fell");
}
