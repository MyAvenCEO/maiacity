//! Keys on the Lab (P3; T5, T6, T7): what each device can open, and what the server holds.

mod common;

use common::*;
use vault_db::id::GrantId;
use vault_db::keys::KeyScope;
use vault_db::policy::{view, Action, Grantee, Op, Principal, Role, Scope};

#[test]
fn entry_reader_cannot_open_other_entries() {
    let mut w = world();
    let h = handbook(&mut w);
    let carol = w.carol;
    w.lab.submit(w.mac_s, &[w.mac_s], grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None)).unwrap();
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
    let carol_read = GrantId::from(w.lab.submit(w.mac_s, &[w.mac_s], read).unwrap());
    w.lab.sync_all(2);
    let key = KeyScope::Entry(h.space, h.welcome);
    let before = w.lab.log(w.mac_s).view().epoch(key);
    w.lab.submit(w.mac_s, &[w.mac_s], Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![] }).unwrap();
    w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(2);
    // the key moved on; Carol can't open it and never sees the new text, Bob does (T6)
    assert_eq!(w.lab.log(w.mac_s).view().epoch(key), before + 1);
    assert!(!w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    assert_eq!(text(&w.lab, w.mac_b, h.space, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    // what she had stays readable to her
    assert_eq!(text(&w.lab, w.mac_c, h.space, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
}

/// Each device opens the current key of a family exactly when, by every op the Lab holds, it may: it reads the family
/// or the family is public (T6, and every device that may read gets the key).
fn keys_follow_caps(w: &World, step: &str) {
    let devices = [w.mac_s, w.phone_s, w.mac_b, w.mac_c, w.mac_d, w.server, w.stranger];
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
    let charter = w.lab.create(w.mac_s, h.coop, h.space, document("Charter", CHARTER_TEXT, w.mac_s)).unwrap();
    w.lab.submit(w.mac_s, &[w.mac_s], grant(Scope::Entry(h.space, charter), Role::Read, Grantee::Public, h.coop, None)).unwrap();
    let carol = w.carol;
    let read = grant(Scope::Entry(h.space, h.welcome), Role::Read, vault(carol), h.coop, None);
    let carol_read = GrantId::from(w.lab.submit(w.mac_s, &[w.mac_s], read).unwrap());
    w.lab.sync_all(3);
    keys_follow_caps(&w, "public charter, Carol reads Welcome");
    // Carol's read revoked, then Welcome edited
    w.lab.submit(w.mac_s, &[w.mac_s], Action::Revoke { grant: carol_read, actor: h.coop, keep: vec![] }).unwrap();
    w.lab.edit(w.mac_s, h.coop, h.space, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(4);
    keys_follow_caps(&w, "Carol revoked");
    // Bob leaves the coop, and Samuel loses his iPhone
    let bob = w.bob;
    w.lab.submit(w.mac_b, &[w.passkey_b], Action::RemoveOwner { vault: h.coop, owner: Principal::Vault(bob), keep: vec![] }).unwrap();
    w.lab.sync_all(5);
    keys_follow_caps(&w, "Bob left");
    let (samuel, phone) = (w.samuel, w.phone_s);
    w.lab.submit(w.mac_s, &[w.passkey_s], Action::RemoveDevice { vault: samuel, device: phone, keep: vec![] }).unwrap();
    w.lab.sync_all(6);
    keys_follow_caps(&w, "the iPhone removed");
}
