//! Keys on the Lab (P3; T5, T6, T7; since the flat vaults T24, T25): what each device can open, and what the server
//! holds. An audience's key reaches its vault and the grantees of the shares with read or more that reach the audience,
//! an entry's key derives from its audience's, a move carries the entry's history to its new audience and nothing else
//! of the audience it left, and a relay share gets no key at all. Since P4b, devices that lock and unlock with the
//! passkey, and what is left once the curves fall (T18); and since P6, that a device writes under the newest key it
//! knows (T15). They share one test binary, as the Lab's world makes Classic McEliece keys that take a while, and each
//! binary makes its own.

mod common;

use std::collections::{BTreeSet, HashSet};

use common::*;
use avendb::id::{AudienceId, EntryId, ShareId, SignerId, VaultId};
use avendb::keys::{KeyFam, KeyId, KeyName, Secret};
use avendb::lab::Lab;
use avendb::policy::{mk_audience, view, Action, Edit, Level, Principal, Refusal, Revoking, State, Who};
use avendb::sealed::{open, seal, Brought, FileKey};
use avendb::slice::Selector;

/// The key family of the audience entry `e` is in now, by device `d`'s view.
fn audience_key(lab: &Lab, d: SignerId, e: EntryId) -> KeyFam {
    let en = lab.state(d).entry(e).expect("an entry the device knows");
    KeyFam::Audience(en.vault, en.audience())
}

/// The key family of vault `v`'s audience of the shares `shares`.
fn audience_of(v: VaultId, shares: &[ShareId]) -> KeyFam {
    KeyFam::Audience(v, AudienceId::of(v, &mk_audience(shares)))
}

/// A write of entry `e` for `actor` under the key device `d`'s view says the entry is under now, with a body nobody
/// opens: what a patched app sends.
fn forced(lab: &Lab, d: SignerId, e: EntryId, actor: VaultId) -> Action {
    let st = lab.state(d);
    let en = st.entry(e).expect("an entry the device knows");
    write(en.vault, e, actor, en.stay(), st.epoch(KeyFam::Audience(en.vault, en.audience())))
}

/// Every key of vault `v` that `st` names: each epoch of its seed, of each of its shares' keys and of each audience an
/// entry of it is or was in, and the key of each of its entries in each stay, at each epoch the stay's audience
/// reached.
fn keys_of(st: &State, v: VaultId) -> BTreeSet<KeyName> {
    let mut fams: BTreeSet<KeyFam> = st.key_fams().into_iter().filter(|k| k.vault() == v).collect();
    let mut out = BTreeSet::new();
    for en in st.entries().iter().filter(|en| en.vault == v) {
        for &(stay, x) in &en.stays {
            fams.insert(KeyFam::Audience(v, x));
            out.extend((0..=st.epoch(KeyFam::Audience(v, x))).map(|g| KeyName::Entry(en.id, stay, g)));
        }
    }
    out.extend(fams.into_iter().flat_map(|k| (0..=st.epoch(k)).map(move |e| KeyName::Scoped(k, e))));
    out
}

#[test]
fn entry_reader_cannot_open_other_entries() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(w.mac_a, &[w.mac_a], read).unwrap();
    w.lab.sync_all(1);
    // a steward moved Welcome into the audience of Carol's share: Carol opens her share's key, that audience's key and
    // Welcome's key there, which derives from the audience's, and reads Welcome…
    let audience = audience_of(h.coop, &[carol_read]);
    assert_eq!(audience_key(&w.lab, w.mac_a, h.welcome), audience);
    assert!(w.lab.opens(w.mac_c, KeyFam::Share(h.coop, carol_read)) && w.lab.opens(w.mac_c, audience));
    let st = w.lab.state(w.mac_a);
    let welcome = st.entry_key(h.welcome).expect("Welcome's key");
    assert!(w.lab.holds_key(w.mac_c, welcome));
    assert_eq!(text(&w.lab, w.mac_c, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    // …written in the audience of no shares, before the move: the move wrapped Welcome's key there under its key now
    // (T24)…
    let first = st.entry_writes(h.welcome).next().map(|x| x.key()).expect("Welcome's creation");
    assert_ne!(first, welcome);
    assert!(w.lab.holds_key(w.mac_c, first));
    // …and nothing else of that audience: neither its key nor Onboarding's, which stays there, nor the coop's seed, and
    // she never fetches Onboarding
    let none = audience_of(h.coop, &[]);
    assert_eq!(audience_key(&w.lab, w.mac_a, h.onboarding), none);
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
    // the server relays Welcome and Onboarding, through avenCEO's wide relay share on the coop: a share with no key
    // (T7)
    assert!(w.lab.fetched(w.server, h.welcome) > 0 && w.lab.fetched(w.server, h.onboarding) > 0);
    let st = w.lab.state(w.mac_a);
    let relay = st.shares_over(h.coop).find(|cp| cp.share.who == vault(w.avenceo)).expect("avenCEO's relay cap");
    assert!(relay.share.wide && relay.share.level == Level::Backup);
    assert!(!st.key_fams().contains(&KeyFam::Share(h.coop, relay.id)));
    // it holds no key of the coop: not its seed, its audience's or its entries'…
    let keys = keys_of(st, h.coop);
    assert!(keys.len() >= 4, "the coop's seed, its cell's key and Welcome's and Onboarding's: {keys:?}");
    for &k in &keys {
        assert!(!w.lab.holds_key(w.server, k), "{k:?}");
    }
    // …reads neither what its relay share selects nor what Welcome is, as its type and tags travel encrypted (T25)…
    assert!(w.lab.slice(w.server, relay.id).is_none() && w.lab.meaning(w.server, h.welcome).is_none());
    // …and yet knows each entry's audience and each of the coop's keys' epochs as the coop's devices do
    let theirs = w.lab.state(w.server);
    for e in [h.welcome, h.onboarding] {
        assert_eq!(theirs.entry(e).map(|en| en.audience()), st.entry(e).map(|en| en.audience()));
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

/// Files follow their edits (T27): Alice brings a photo into Welcome, which Carol reads, and a scan into Onboarding,
/// which she doesn't. Whoever may receive a write may fetch the files it brings, as sealed bytes: Carol the photo and
/// the server both, as it keeps the coop's ciphertext; only who opens the write's key opens the file.
#[test]
fn t27_files_follow_their_edits() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    w.lab.issue(w.mac_a, &[w.mac_a], read).unwrap();
    w.lab.sync_all(1);
    // each file sealed under a key of its own; its root here stands for the BLAKE3 hash iroh names its pieces by
    let file = |text: &[u8], k: u8| {
        let (key, plain) = (FileKey::from_bytes([k; 32]), text.repeat(9_000));
        let sealed = seal(&key, &plain);
        let root = avendb::hash::hash("a test file's root", &sealed);
        (Brought::new(root, key, plain.len() as u64), plain, sealed)
    };
    let (photo, photo_text, photo_sealed) = file(b"the greenhouse at dawn ", 1);
    let (scan, _, _) = file(b"the onboarding form, signed ", 2);
    let (photo_root, scan_root) = (photo.root, scan.root);
    assert!(photo_root.size > 3 * 65_536, "a photo of a few segments");
    w.lab.bring(w.mac_a, h.coop, h.welcome, vec![photo.clone()], |_| {}).unwrap();
    w.lab.bring(w.mac_a, h.coop, h.onboarding, vec![scan], |_| {}).unwrap();
    w.lab.sync_all(2);
    // Carol may fetch the photo and not the scan; the server both; Dave and the stranger neither
    let may = |asker, root| w.lab.may_fetch_file(w.mac_a, asker, root, &[]);
    assert!(may(w.mac_c, &photo_root) && !may(w.mac_c, &scan_root));
    assert!(may(w.server, &photo_root) && may(w.server, &scan_root));
    for nobody in [w.mac_d, w.stranger] {
        assert!(!may(nobody, &photo_root) && !may(nobody, &scan_root));
    }
    assert_eq!(w.lab.files(w.mac_c), vec![photo_root]);
    // Carol opens the photo: its key from the write that brings it, its bytes from the root, any range on its own
    let got = w.lab.file(w.mac_c, &photo_root).expect("the photo's key, from the write Carol opens");
    assert_eq!(got, photo);
    assert_eq!(open(&got.key, got.shape(), 0, &photo_sealed), Some(photo_text.clone()));
    let (_, at) = got.shape().sealed_ranges(70_000..70_010)[0].clone();
    let segment = open(&got.key, got.shape(), 1, &photo_sealed[at.start as usize..at.end as usize]).unwrap();
    assert_eq!(&segment[70_000 - 65_520..70_010 - 65_520], &photo_text[70_000..70_010]);
    // the server keeps both files and opens neither, and neither key is in its store
    let mut both = vec![photo_root, scan_root];
    both.sort();
    assert_eq!(w.lab.files(w.server), both);
    assert!(w.lab.file(w.server, &photo_root).is_none() && w.lab.file(w.server, &scan_root).is_none());
    let store = w.lab.store(w.server);
    assert!(!store.windows(32).any(|b| b == photo.key.bytes() || b == [2; 32]));
}

#[test]
fn revoked_reader_cannot_open_new_edits() {
    let mut w = world();
    let h = handbook(&mut w);
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(w.mac_a, &[w.mac_a], read).unwrap();
    w.lab.sync_all(2);
    let key = audience_key(&w.lab, w.mac_a, h.welcome);
    assert_eq!(key, audience_of(h.coop, &[carol_read]));
    let before = w.lab.state(w.mac_a).epoch(key);
    let revoke = Action::Revoke(Revoking::Grant { share: carol_read, actor: h.coop, keep: vec![], via: vec![] });
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(2);
    // a revocation moves no entry: Welcome stays in its audience, whose key moved on, and so did Welcome's key there
    assert_eq!(audience_key(&w.lab, w.mac_a, h.welcome), key);
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
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(w.mac_a, &[w.mac_a], read).unwrap();
    w.lab.sync_all(15);
    let key = audience_key(&w.lab, w.phone_a, h.welcome);
    let before = w.lab.state(w.phone_a).epoch(key);
    w.lab.set_online(w.phone_a, false);
    let revoke = Action::Revoke(Revoking::Grant { share: carol_read, actor: h.coop, keep: vec![], via: vec![] });
    w.lab.submit(w.mac_a, &[w.mac_a], revoke).unwrap();
    // the iPhone hasn't seen the revocation, so its edit is made alongside it, under the epoch of Welcome's audience
    // it knows
    let alongside = w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(1, "Welcome, alongside")).unwrap();
    w.lab.set_online(w.phone_a, true);
    w.lab.sync_all(15);
    // once it has seen it, it writes under the audience's new epoch, which Carol can't open
    let after = w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(15);
    let epoch = |id| w.lab.state(w.mac_a).all_writes().iter().find(|x| x.edit == id).map(|x| x.epoch);
    assert_eq!((epoch(alongside), epoch(after)), (Some(before), Some(before + 1)));
    assert!(!w.lab.opens(w.mac_c, key) && w.lab.opens(w.mac_b, key));
    assert!(!contains(&w.lab.store(w.mac_c), AFTER_TEXT));
    // both edits stand
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 1).as_deref(), Some("Welcome, alongside"));
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
}

/// Each device opens the current key of a family exactly when, by every edit the Lab holds, it may: it acts for a vault
/// that reads the family, or the family is public (T6, and every device that may read gets the key); and it holds the
/// key of each entry in its stay now, at its audience's epoch now, exactly when it may open that audience's key (T24).
/// A public key, though, reaches only a device with an interest in its vault or that follows it, which is all it is
/// sent of what everyone reads (T12): one that has neither opens it only if it had one before.
fn keys_follow_shares(w: &World, step: &str) {
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
    let named = |d, cp: &avendb::policy::Issued| matches!(cp.share.who, Who::Vault(g) if st.acts_for(d, g));
    let interested = |d, v| {
        st.acts_for(d, v) || w.lab.follows(d).contains(&v) || st.shares_over(v).any(|cp| st.live(cp.id) && named(d, cp))
    };
    let may = |d, k: KeyFam| st.entitled(d, k) || st.public_key(k);
    let must = |d, k: KeyFam| st.entitled(d, k) || (st.public_key(k) && interested(d, k.vault()));
    let check = |opens: bool, d, k, what: &dyn std::fmt::Debug| {
        assert!(!opens || may(d, k), "{step}: {d:?} opens {what:?}, which it may not");
        assert!(opens || !must(d, k), "{step}: {d:?} doesn't open {what:?}");
    };
    for d in devices {
        for k in st.key_fams() {
            check(w.lab.opens(d, k), d, k, &k);
        }
        for en in st.entries() {
            let key = st.entry_key(en.id).expect("an entry's key");
            check(w.lab.holds_key(d, key), d, KeyFam::Audience(en.vault, en.audience()), &key);
        }
    }
}

#[test]
fn every_device_opens_exactly_what_it_may() {
    let mut w = world();
    let h = handbook(&mut w);
    let mac = w.mac_a;
    keys_follow_shares(&w, "the Handbook");
    // a public charter, and Carol reading Welcome
    let charter = w.lab.create(mac, h.coop, h.coop, "doc", &[], document("Charter", CHARTER_TEXT, mac)).unwrap();
    w.lab.issue(mac, &[mac], share(h.coop, Who::Everyone, Level::Read, by_id(charter))).unwrap();
    let read = share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome));
    let carol_read = w.lab.issue(mac, &[mac], read).unwrap();
    w.lab.follow(w.stranger, &[h.coop]);
    w.lab.sync_all(3);
    keys_follow_shares(&w, "public charter, Carol reads Welcome");
    // the key of the charter's audience is published: the stranger opens it, and reads the charter
    let (public, st) = (audience_key(&w.lab, mac, charter), w.lab.state(mac));
    assert!(st.published().contains(&st.current(public)));
    assert_eq!(text(&w.lab, w.stranger, charter, 2).as_deref(), Some(CHARTER_TEXT));
    // Carol's read revoked, then Welcome edited
    let revoke = Action::Revoke(Revoking::Grant { share: carol_read, actor: h.coop, keep: vec![], via: vec![] });
    w.lab.submit(mac, &[mac], revoke).unwrap();
    w.lab.edit(mac, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(4);
    keys_follow_shares(&w, "Carol revoked");
    // Alice's library: her todos tagged work shared with Bob, and her whole vault with Dave, her backup, read; then she
    // takes the work tag off the solar panels, which a steward moves out of Bob's audience
    let lib = library(&mut w);
    let alice = w.alice;
    let work = w.lab.issue(mac, &[mac], share(alice, vault(w.bob), Level::Read, tagged("todo", "work"))).unwrap();
    w.lab.issue(mac, &[mac], share(alice, vault(w.dave), Level::Read, Selector::All)).unwrap();
    w.lab.sync_all(5);
    keys_follow_shares(&w, "Bob reads Alice's work todos, Dave her whole vault");
    // Dave's wide share splits no audience and reaches each: the seeds, at home, stay in the audience of no shares,
    // whose key Dave opens and Bob doesn't
    let (none, works) = (audience_of(alice, &[]), audience_of(alice, &[work]));
    assert_eq!((audience_key(&w.lab, mac, lib.seeds), audience_key(&w.lab, mac, lib.solar)), (none, works));
    assert!(w.lab.opens(w.mac_d, none) && !w.lab.opens(w.mac_b, none));
    w.lab.tag(mac, alice, lib.solar, &[], &["work"]).unwrap();
    w.lab.sync_all(5);
    keys_follow_shares(&w, "the solar panels leave Bob's slice");
    assert_eq!(audience_key(&w.lab, mac, lib.solar), none);
    // Bob leaves the coop, and Alice loses her iPhone: her seed and the key of each of her audiences move on
    let leave = Action::Revoke(Revoking::Owner { vault: h.coop, owner: Principal::Vault(w.bob), keep: vec![] });
    w.lab.submit(w.mac_b, &[w.passkey_b], leave).unwrap();
    w.lab.sync_all(6);
    keys_follow_shares(&w, "Bob left");
    let fams = [KeyFam::Seed(alice), none, works];
    let before = fams.map(|k| w.lab.state(mac).epoch(k));
    let phone = w.phone_a;
    let remove = Action::Revoke(Revoking::Device { vault: alice, device: phone, keep: vec![] });
    w.lab.submit(mac, &[w.passkey_a], remove).unwrap();
    w.lab.sync_all(7);
    keys_follow_shares(&w, "the iPhone removed");
    assert_eq!(fams.map(|k| w.lab.state(mac).epoch(k)), before.map(|e| e + 1));
}

/// A person's device derives its keys from the passkey at every unlock (P4b): locked, it holds no key and shows
/// nothing, though it keeps the ciphertext and still receives; unlocked, it opens again what it did; once the passkey
/// is lost, nothing unlocks it.
#[test]
fn a_locked_device_holds_no_key() {
    let mut w = world();
    let h = handbook(&mut w);
    let welcome = audience_key(&w.lab, w.mac_a, h.welcome);
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

/// A device's own key (`Lab::own_key`): what it wraps for itself under a key derived from its own, as the Mac wraps the
/// key of a drive it hosts, it alone opens again, for that one purpose and drive, and only while it is unlocked; a
/// passkey has none.
#[test]
fn a_device_wraps_a_secret_only_it_opens_again() {
    use avendb::keys::{open, wrap, SeededRng};
    let mut w = world();
    let (drive, info) = ([7; 32], b"avenDB drive");
    let mut rng = SeededRng::new("the test's wrap", b"");
    let key = w.lab.own_key(w.mac_a, "drive key", &drive).expect("an unlocked device's");
    let secret = Secret::from_bytes([9; 32]);
    let wrapped = wrap(&secret, &key, info, &mut rng);
    assert!(!wrapped.windows(32).any(|x| x == secret.bytes()), "never in plain");
    assert_eq!(open(&wrapped, &key, info), Some(secret.clone()));
    assert_eq!(w.lab.own_key(w.mac_a, "drive key", &drive), Some(key), "the same key each time");
    let others = [
        w.lab.own_key(w.phone_a, "drive key", &drive),
        w.lab.own_key(w.mac_a, "drive key", &[8; 32]),
        w.lab.own_key(w.mac_a, "another purpose", &drive),
    ];
    for other in others {
        assert_eq!(open(&wrapped, &other.expect("a device's"), info), None, "another device, drive or purpose");
    }
    assert!(w.lab.own_key(w.passkey_a, "drive key", &drive).is_none(), "a passkey has no own key");
    w.lab.lock(w.mac_a);
    assert!(w.lab.own_key(w.mac_a, "drive key", &drive).is_none(), "nor a locked device");
}

/// Once the curves fall (P4b): whoever broke a device's ed25519 key, or a passkey's P-256 key, signs no edit, as every
/// signature on every edit is SLH-DSA. A write or a share by Alice's Mac whose SLH-DSA signature is made up is refused
/// by every device, and the devices' own edits go on as before.
#[test]
fn a_broken_curve_signs_nothing() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac_a, mac_b) = (w.mac_a, w.mac_b);
    let held = w.lab.size(mac_b).0;
    let forge = |w: &mut World, action| {
        let mut signed = w.lab.sign_unchecked(mac_a, &[mac_a], action).expect("Alice's Mac signs");
        signed.sigs[0].pq = vec![0; avendb::sign::PQ_SIGNATURE_BYTES];
        assert_eq!(signed.verify(), Err(Refusal::BadSignature));
        signed
    };
    let write = forced(&w.lab, mac_b, h.welcome, h.coop);
    let write = forge(&mut w, write);
    let to_dave = w.lab.draft_share(mac_a, &[mac_a], share(h.coop, vault(w.dave), Level::Read, by_id(h.welcome)));
    let to_dave = forge(&mut w, to_dave.expect("Alice's Mac drafts a share to Dave").edit().action.clone());
    assert_eq!(w.lab.receive(mac_b, vec![write, to_dave], vec![]), 0, "Bob's Mac keeps neither");
    assert_eq!(w.lab.size(mac_b).0, held);
    // Alice's own edits still count, and an edit made now reaches Bob's Mac
    assert_eq!(text(&w.lab, mac_b, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    w.lab.edit(mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.sync_all(7);
    assert_eq!(text(&w.lab, mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
    assert_eq!(text(&w.lab, w.mac_c, h.welcome, 2), None);
    keys_follow_shares(&w, "the curves fell");
}
