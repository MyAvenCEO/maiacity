//! Keys on the Lab (P3; T5, T6, T7; since the flat vaults T24, T25): what each device can open, and what the server
//! holds. A cell's key reaches its vault and the grantees of the caps with read or more that reach the cell, an entry's
//! key derives from its cell's, a move carries the entry's history to its new cell and nothing else of the cell it
//! left, and a relay cap gets no key at all. Since P4b, devices that lock and unlock with the passkey, and what is left
//! once the curves fall (T18); and since P6, that a device writes under the newest key it knows (T15). They share one
//! test binary, as the Lab's world makes Classic McEliece keys that take a while, and each binary makes its own.

mod common;

use std::collections::{BTreeSet, HashSet};

use common::*;
use avendb::id::{CapId, CellId, EntryId, SignerId, VaultId};
use avendb::keys::{KeyFam, KeyId, KeyName, Secret};
use avendb::lab::{Lab, Tamper};
use avendb::policy::{mk_cell, view, Action, Edit, Grantee, Principal, Refusal, Role, State};
use avendb::slice::Selector;

/// The key family of the cell entry `e` is in now, by device `d`'s view.
fn cell_key(lab: &Lab, d: SignerId, e: EntryId) -> KeyFam {
    let en = lab.state(d).entry(e).expect("an entry the device knows");
    KeyFam::Cell(en.vault, en.cell())
}

/// The key family of vault `v`'s cell of the caps `caps`.
fn cell_of(v: VaultId, caps: &[CapId]) -> KeyFam {
    KeyFam::Cell(v, CellId::of(v, &mk_cell(caps)))
}

/// A write of entry `e` for `actor` under the key device `d`'s view says the entry is under now, with a body nobody
/// opens: what a patched app sends.
fn forced(lab: &Lab, d: SignerId, e: EntryId, actor: VaultId) -> Action {
    let st = lab.state(d);
    let en = st.entry(e).expect("an entry the device knows");
    write(en.vault, e, actor, en.stay(), st.epoch(KeyFam::Cell(en.vault, en.cell())))
}

/// Every key of vault `v` that `st` names: each epoch of its seed, of each of its caps' keys and of each cell an entry
/// of it is or was in, and the key of each of its entries in each stay, at each generation the stay's cell reached.
fn keys_of(st: &State, v: VaultId) -> BTreeSet<KeyName> {
    let mut fams: BTreeSet<KeyFam> = st.key_fams().into_iter().filter(|k| k.vault() == v).collect();
    let mut out = BTreeSet::new();
    for en in st.entries().iter().filter(|en| en.vault == v) {
        for &(stay, x) in &en.stays {
            fams.insert(KeyFam::Cell(v, x));
            out.extend((0..=st.epoch(KeyFam::Cell(v, x))).map(|g| KeyName::Entry(en.id, stay, g)));
        }
    }
    out.extend(fams.into_iter().flat_map(|k| (0..=st.epoch(k)).map(move |e| KeyName::Scoped(k, e))));
    out
}

#[test]
fn entry_reader_cannot_open_other_entries() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = cap(h.coop, vault(w.carol), Role::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(w.mac_a, &[w.mac_a], read).unwrap();
    w.lab.sync_all(1);
    // a steward moved Welcome into the cell of Carol's cap: Carol opens her cap's key, that cell's key and Welcome's
    // key there, which derives from the cell's, and reads Welcome…
    let cell = cell_of(h.coop, &[carol_read]);
    assert_eq!(cell_key(&w.lab, w.mac_a, h.welcome), cell);
    assert!(w.lab.opens(w.mac_c, KeyFam::Cap(h.coop, carol_read)) && w.lab.opens(w.mac_c, cell));
    let st = w.lab.state(w.mac_a);
    let welcome = st.entry_key(h.welcome).expect("Welcome's key");
    assert!(w.lab.holds_key(w.mac_c, welcome));
    assert_eq!(text(&w.lab, w.mac_c, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    // …written in the cell of no caps, before the move: the move wrapped Welcome's key there under its key now (T24)…
    let first = st.entry_writes(h.welcome).next().map(|x| x.key()).expect("Welcome's creation");
    assert_ne!(first, welcome);
    assert!(w.lab.holds_key(w.mac_c, first));
    // …and nothing else of that cell: neither its key nor Onboarding's, which stays there, nor the coop's seed, and
    // she never fetches Onboarding
    let none = cell_of(h.coop, &[]);
    assert_eq!(cell_key(&w.lab, w.mac_a, h.onboarding), none);
    for k in [none, KeyFam::Seed(h.coop)] {
        assert!(!w.lab.opens(w.mac_c, k), "{k:?}");
    }
    let onboarding = st.entry_key(h.onboarding).expect("Onboarding's key");
    assert!(!w.lab.holds_key(w.mac_c, onboarding));
    assert_eq!(w.lab.fetched(w.mac_c, h.onboarding), 0);
    assert!(!contains(&w.lab.store(w.mac_c), ONBOARDING_TEXT));
}

#[test]
fn server_holds_only_ciphertext() {
    let mut w = world();
    let h = handbook(&mut w);
    // the server relays Welcome and Onboarding, through avenCEO's wide relay cap on the coop: a cap with no key (T7)
    assert!(w.lab.fetched(w.server, h.welcome) > 0 && w.lab.fetched(w.server, h.onboarding) > 0);
    let st = w.lab.state(w.mac_a);
    let relay = st.caps_over(h.coop).find(|cp| cp.cap.grantee == vault(w.avenceo)).expect("avenCEO's relay cap");
    assert!(relay.cap.wide && relay.cap.role == Role::Relay);
    assert!(!st.key_fams().contains(&KeyFam::Cap(h.coop, relay.id)));
    // it holds no key of the coop: not its seed, its cell's or its entries'…
    let keys = keys_of(st, h.coop);
    assert!(keys.len() >= 4, "the coop's seed, its cell's key and Welcome's and Onboarding's: {keys:?}");
    for &k in &keys {
        assert!(!w.lab.holds_key(w.server, k), "{k:?}");
    }
    // …reads neither what its relay cap selects nor what Welcome is, as its type and tags travel encrypted (T25)…
    assert!(w.lab.slice(w.server, relay.id).is_none() && w.lab.meaning(w.server, h.welcome).is_none());
    // …and yet knows each entry's cell and each of the coop's keys' epochs as the coop's devices do
    let theirs = w.lab.state(w.server);
    for e in [h.welcome, h.onboarding] {
        assert_eq!(theirs.entry(e).map(|en| en.cell()), st.entry(e).map(|en| en.cell()));
    }
    assert_eq!(keys_of(theirs, h.coop), keys);
    // no plaintext appears anywhere in its store, nor any key of Alice's Mac that it doesn't hold itself
    let store = w.lab.store(w.server);
    for plain in [WELCOME_TEXT, ONBOARDING_TEXT, "Welcome", "Onboarding"] {
        assert!(!contains(&store, plain), "{plain} in the server's store");
    }
    let own: HashSet<KeyId> = w.lab.secrets(w.server).iter().map(Secret::id).collect();
    for s in w.lab.secrets(w.mac_a).iter().filter(|s| !own.contains(&s.id())) {
        assert!(!store.windows(32).any(|b| b == s.bytes().as_slice()), "{s:?} in the server's store");
    }
}

#[test]
fn revoked_reader_cannot_open_new_edits() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = cap(h.coop, vault(w.carol), Role::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(w.mac_a, &[w.mac_a], read).unwrap();
    w.lab.sync_all(2);
    let key = cell_key(&w.lab, w.mac_a, h.welcome);
    assert_eq!(key, cell_of(h.coop, &[carol_read]));
    let before = w.lab.state(w.mac_a).epoch(key);
    let revoke = Action::Revoke { cap: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(2);
    // a revocation moves no entry: Welcome stays in its cell, whose key moved on, and so did Welcome's key there
    assert_eq!(cell_key(&w.lab, w.mac_a, h.welcome), key);
    assert_eq!(w.lab.state(w.mac_a).epoch(key), before + 1);
    let now = w.lab.state(w.mac_a).entry_key(h.welcome).expect("Welcome's key");
    assert!(matches!(now, KeyName::Entry(_, _, g) if g == before + 1), "{now:?}");
    // Carol can't open either, and never sees the new text; Bob does (T6, T24)
    assert!(!w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    assert!(!w.lab.holds_key(w.mac_c, now) && w.lab.holds_key(w.mac_b, now));
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    // what she had stays readable to her
    assert_eq!(text(&w.lab, w.mac_c, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
}

#[test]
fn a_device_writes_under_the_newest_key_it_knows() {
    // T15: Carol loses Welcome while Alice's iPhone is offline
    let mut w = world();
    let h = handbook(&mut w);
    let read = cap(h.coop, vault(w.carol), Role::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(w.mac_a, &[w.mac_a], read).unwrap();
    w.lab.sync_all(15);
    let key = cell_key(&w.lab, w.phone_a, h.welcome);
    let before = w.lab.state(w.phone_a).epoch(key);
    w.lab.set_online(w.phone_a, false);
    let revoke = Action::Revoke { cap: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    // the iPhone hasn't seen the revocation, so its edit is made alongside it, under the generation of Welcome's cell
    // it knows
    let alongside = w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(1, "Welcome, alongside")).unwrap();
    w.lab.set_online(w.phone_a, true);
    w.lab.sync_all(15);
    // once it has seen it, it writes under the cell's new generation, which Carol can't open
    let after = w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(15);
    let generation = |id| w.lab.state(w.mac_a).all_writes().iter().find(|x| x.edit == id).map(|x| x.generation);
    assert_eq!((generation(alongside), generation(after)), (Some(before), Some(before + 1)));
    assert!(!w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    // both edits stand
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 1).as_deref(), Some("Welcome, alongside"));
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
}

/// Each device opens the current key of a family exactly when, by every edit the Lab holds, it may: it acts for a vault
/// that reads the family, or the family is public (T6, and every device that may read gets the key); and it holds the
/// key of each entry in its stay now, at its cell's generation now, exactly when it may open that cell's key (T24).
fn keys_follow_caps(w: &World, step: &str) {
    let devices = [w.mac_a, w.phone_a, w.mac_b, w.mac_c, w.mac_d, w.server, w.stranger];
    let (mut all, mut seen): (Vec<Edit>, HashSet<_>) = (vec![], HashSet::new());
    for d in devices {
        let log = w.lab.log(d);
        for (edit, id) in log.edits().iter().zip(log.ids()) {
            if seen.insert(*id) {
                all.push(edit.clone());
            }
        }
    }
    let st = view(&all);
    let may = |d, k| st.entitled(d, k) || st.public_key(k);
    for d in devices {
        for k in st.key_fams() {
            assert_eq!(w.lab.opens(d, k), may(d, k), "{step}: {d:?} and {k:?}");
        }
        for en in st.entries() {
            let key = st.entry_key(en.id).expect("an entry's key");
            let cell = KeyFam::Cell(en.vault, en.cell());
            assert_eq!(w.lab.holds_key(d, key), may(d, cell), "{step}: {d:?} and {key:?}");
        }
    }
}

#[test]
fn every_device_opens_exactly_what_it_may() {
    let mut w = world();
    let h = handbook(&mut w);
    let mac = w.mac_a;
    keys_follow_caps(&w, "the Handbook");
    // a public charter, and Carol reading Welcome
    let charter = w.lab.create(mac, h.coop, h.coop, "doc", &[], document("Charter", CHARTER_TEXT, mac)).unwrap();
    w.lab.issue(mac, &[mac], cap(h.coop, Grantee::Public, Role::Read, by_id(charter))).unwrap();
    let read = cap(h.coop, vault(w.carol), Role::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(mac, &[mac], read).unwrap();
    w.lab.sync_all(3);
    keys_follow_caps(&w, "public charter, Carol reads Welcome");
    // the key of the charter's cell is published: the stranger opens it, and reads the charter
    let (public, st) = (cell_key(&w.lab, mac, charter), w.lab.state(mac));
    assert!(st.published().contains(&st.current(public)));
    assert_eq!(text(&w.lab, w.stranger, charter, 2).as_deref(), Some(CHARTER_TEXT));
    // Carol's read revoked, then Welcome edited
    let revoke = Action::Revoke { cap: carol_read, actor: h.coop, keep: vec![], via: vec![] };
    w.lab.submit(mac, &[mac], revoke).unwrap();
    w.lab.edit(mac, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(4);
    keys_follow_caps(&w, "Carol revoked");
    // Alice's library: her todos tagged work shared with Bob, and her whole vault with Dave, her backup, read; then she
    // takes the work tag off the solar panels, which a steward moves out of Bob's cell
    let lib = library(&mut w);
    let alice = w.alice;
    let work = w.lab.issue(mac, &[mac], cap(alice, vault(w.bob), Role::Read, tagged("todo", "work"))).unwrap();
    w.lab.issue(mac, &[mac], cap(alice, vault(w.dave), Role::Read, Selector::All)).unwrap();
    w.lab.sync_all(5);
    keys_follow_caps(&w, "Bob reads Alice's work todos, Dave her whole vault");
    // Dave's wide cap splits no cell and reaches each: the seeds, at home, stay in the cell of no caps, whose key Dave
    // opens and Bob doesn't
    let (none, works) = (cell_of(alice, &[]), cell_of(alice, &[work]));
    assert_eq!((cell_key(&w.lab, mac, lib.seeds), cell_key(&w.lab, mac, lib.solar)), (none, works));
    assert!(w.lab.opens(w.mac_d, none) && !w.lab.opens(w.mac_b, none));
    w.lab.tag(mac, alice, lib.solar, &[], &["work"]).unwrap();
    w.lab.sync_all(5);
    keys_follow_caps(&w, "the solar panels leave Bob's slice");
    assert_eq!(cell_key(&w.lab, mac, lib.solar), none);
    // Bob leaves the coop, and Alice loses her iPhone: her seed and the key of each of her cells move on
    let leave = Action::RemoveOwner { vault: h.coop, owner: Principal::Vault(w.bob), keep: vec![] };
    w.lab.submit(w.mac_b, &[w.passkey_b], leave).unwrap();
    w.lab.sync_all(6);
    keys_follow_caps(&w, "Bob left");
    let fams = [KeyFam::Seed(alice), none, works];
    let before = fams.map(|k| w.lab.state(mac).epoch(k));
    let phone = w.phone_a;
    w.lab.submit(mac, &[w.passkey_a], Action::RemoveDevice { vault: alice, device: phone, keep: vec![] }).unwrap();
    w.lab.sync_all(7);
    keys_follow_caps(&w, "the iPhone removed");
    assert_eq!(fams.map(|k| w.lab.state(mac).epoch(k)), before.map(|e| e + 1));
}

/// A person's device derives its keys from the passkey at every unlock (P4b): locked, it holds no key and shows
/// nothing, though it keeps the ciphertext and still receives; unlocked, it opens again what it did; once the passkey
/// is lost, nothing unlocks it.
#[test]
fn a_locked_device_holds_no_key() {
    let mut w = world();
    let h = handbook(&mut w);
    let welcome = cell_key(&w.lab, w.mac_a, h.welcome);
    assert!(w.lab.opens(w.phone_a, welcome));
    w.lab.lock(w.phone_a);
    assert!(w.lab.locked(w.phone_a) && w.lab.secrets(w.phone_a).is_empty());
    assert!(!w.lab.opens(w.phone_a, welcome) && w.lab.item(w.phone_a, h.welcome).is_none());
    // nor reads what Welcome is, as it opens none of its writes
    assert!(w.lab.meaning(w.phone_a, h.welcome).is_none());
    assert!(!contains(&w.lab.store(w.phone_a), WELCOME_TEXT));
    // it signs nothing, and still receives the Mac's edit, as ciphertext
    let edit = w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT));
    assert_eq!(edit, Err(Refusal::Locked));
    let before = w.lab.fetched(w.phone_a, h.welcome);
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(1);
    assert_eq!(w.lab.fetched(w.phone_a, h.welcome), before + 1);
    assert!(!contains(&w.lab.store(w.phone_a), AFTER_TEXT));
    // unlocked, it derives the same key from the passkey, and reads the edit
    assert!(w.lab.unlock(w.phone_a));
    assert_eq!(text(&w.lab, w.phone_a, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    // the server and a stranger derive their keys from no passkey; and with Alice's passkey lost, the iPhone stays
    // locked once it locks
    assert!(!w.lab.unlock(w.server) && !w.lab.unlock(w.stranger));
    w.lab.lock(w.phone_a);
    w.lab.lose(w.passkey_a);
    assert!(!w.lab.unlock(w.phone_a) && w.lab.locked(w.phone_a));
}

/// Once the curves fall (P4b; T18): whoever broke a device's ed25519 key signs writes as it, as writes carry only
/// the classical half, but no cap, no governance and no checkpoint, which carry the hash-based half too. A peer that
/// no longer trusts the curves counts only the writes their own device's checkpoints cover, and the devices' own edits
/// go on as before, each vouched for at once.
#[test]
fn a_broken_curve_writes_nothing_that_counts() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac_a, mac_b, dave) = (w.mac_a, w.mac_b, w.dave);
    let broken = |action| Tamper::BrokenClassicalKey { signer: mac_a, action };
    // no cap to Dave, as Alice's Mac would draft it, and no new device for Alice, with the classical half alone
    let to_dave = w.lab.draft_cap(mac_a, &[mac_a], cap(h.coop, vault(dave), Role::Read, by_id(h.welcome)));
    let to_dave = to_dave.expect("Alice's Mac drafts a cap to Dave").edit().action.clone();
    assert_eq!(w.lab.tamper(mac_b, broken(to_dave)), Err(Refusal::BadSignature));
    let add = Action::AddDevice { vault: w.alice, device: w.stranger, seal_to: None };
    assert_eq!(w.lab.tamper(mac_b, broken(add)), Err(Refusal::BadSignature));
    // a write as Alice's Mac passes while Bob's Mac trusts the curves
    let write = forced(&w.lab, mac_b, h.welcome, h.coop);
    let forged = w.lab.tamper(mac_b, broken(write)).unwrap();
    let counts = |w: &World, d| w.lab.state(d).all_writes().iter().any(|x| x.edit == forged);
    assert!(counts(&w, mac_b));
    // the forger can't vouch for it
    let vouch = Action::Checkpoint { entry: h.welcome, covers: vec![forged] };
    assert_eq!(w.lab.tamper(mac_b, broken(vouch)), Err(Refusal::BadSignature));
    // once no device trusts the curves, the forged write doesn't count, and Alice's own edits, vouched for when her
    // Mac synced, still do
    w.lab.set_pq_only(true);
    assert!(!counts(&w, mac_b) && w.lab.log(mac_b).view().all_writes().iter().any(|x| x.edit == forged));
    assert_eq!(text(&w.lab, mac_b, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    // an edit made now is vouched for at once, and reaches Bob's Mac
    w.lab.edit(mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(7);
    assert_eq!(text(&w.lab, mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    assert_eq!(text(&w.lab, w.mac_c, h.welcome, 2), None);
    keys_follow_caps(&w, "the curves fell");
}
