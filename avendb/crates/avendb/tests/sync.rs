//! Sync on the Lab (P6): every edit is in one log, a vault's, a share's, an audience's or an entry's, and devices ask
//! each other with what they hold of each log, gossip one digest per log and ask only where one differs, go offline and
//! come back, and come back from old backups, which forks what they sign next. A peer sends a device the logs of the
//! entries and audiences it reaches, and nothing about the others (T12): an entry a steward moves out of a device's
//! reach stops syncing to it, and the device never hears of the move; what everyone reads reaches a device only where
//! it has an interest in the vault or follows it, so a stranger gets nothing. Since blobs B2c, of those a device syncs
//! the entries its keep shares want (T28), by the stewards' marks, which a relay applies without reading a selector
//! (T23).

mod common;

use std::collections::BTreeSet;

use avendb::doc::Item;
use avendb::id::{AudienceId, EditId, EntryId, ShareId, SignerId, VaultId};
use avendb::lab::Lab;
use avendb::lens::{Status, DOCUMENT_V1};
use avendb::policy::{Action, KeepMode, Level, Refusal, Revoking, Who};
use avendb::sealed::{seal, Brought, FileKey, FileRoot};
use avendb::slice::{Atom, Selector, Sym, SCHEMA_TYPE};
use avendb::sync::{log_of, respond, LogId};
use common::*;

/// Every ordered pair of `ds`.
fn pairs(ds: &[SignerId]) -> Vec<(SignerId, SignerId)> {
    ds.iter().flat_map(|&a| ds.iter().filter(move |&&b| b != a).map(move |&b| (a, b))).collect()
}

fn devices(w: &World) -> [SignerId; 7] {
    [w.mac_a, w.phone_a, w.mac_b, w.mac_c, w.mac_d, w.server, w.stranger]
}

/// The logs of the edits device `d` holds.
fn logs(lab: &Lab, d: SignerId) -> Vec<LogId> {
    lab.log(d).edits().iter().filter_map(|edit| log_of(edit, edit.id())).collect()
}

#[test]
fn a_second_sync_sends_nothing() {
    let mut w = world();
    handbook(&mut w);
    w.lab.sync_all(1);
    for (from, to) in pairs(&devices(&w)) {
        assert_eq!(w.lab.sync(from, to), 0, "{from:?} to {to:?}");
    }
    // and gossip asks nobody
    assert_eq!(w.lab.sync_all(2), 0);
}

#[test]
fn an_edit_sends_only_what_is_new_both_ways() {
    let mut w = world();
    let h = handbook(&mut w);
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    // the server, behind, is sent the edit alone
    assert_eq!(w.lab.sync(w.mac_a, w.server), 1);
    // the Mac, ahead, names edits further back than its newest, so the server finds what they share and sends nothing
    assert_eq!(w.lab.sync(w.server, w.mac_a), 0);
    assert_eq!(w.lab.sync(w.server, w.mac_b), 1);
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(AFTER_TEXT));
}

#[test]
fn devices_that_synced_gossip_the_same_digests() {
    let mut w = world();
    let h = handbook(&mut w);
    let digests = |lab: &mut Lab, d| lab.digests(d).clone();
    let mac = digests(&mut w.lab, w.mac_a);
    // Alice's two devices hold the same edits
    assert_eq!(mac, digests(&mut w.lab, w.phone_a));
    // and of every log two devices both hold, they hold the same edits
    for (a, b) in pairs(&devices(&w)) {
        let (da, db) = (digests(&mut w.lab, a), digests(&mut w.lab, b));
        for (l, x) in &da {
            assert!(db.get(l).is_none_or(|y| y == x), "{a:?} and {b:?} differ on {l:?}");
        }
    }
    // an edit changes the digest of its entry's log alone, not its audience's nor its vault's
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    let after = digests(&mut w.lab, w.mac_a);
    let changed: Vec<_> = after.iter().filter(|(l, x)| mac.get(l) != Some(x)).map(|(l, _)| *l).collect();
    assert_eq!(changed, [LogId::Entry(h.welcome)]);
}

#[test]
fn an_offline_device_neither_sends_nor_receives() {
    let mut w = world();
    let h = handbook(&mut w);
    w.lab.set_online(w.mac_b, false);
    w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
    w.lab.edit(w.mac_b, h.coop, h.welcome, |i| i.set_text(1, "Bob's title, offline")).unwrap();
    assert_eq!(w.lab.sync(w.mac_a, w.mac_b), 0);
    assert_eq!(w.lab.sync(w.mac_b, w.mac_a), 0);
    w.lab.sync_all(3);
    assert!(!w.lab.online(w.mac_b));
    assert_eq!(text(&w.lab, w.mac_b, h.welcome, 2).as_deref(), Some(WELCOME_TEXT));
    assert_eq!(text(&w.lab, w.mac_a, h.welcome, 1).as_deref(), Some("Welcome"));
    // back online, both edits reach everyone who reads Welcome
    w.lab.set_online(w.mac_b, true);
    w.lab.sync_all(3);
    for d in [w.mac_a, w.phone_a, w.mac_b] {
        assert_eq!(text(&w.lab, d, h.welcome, 1).as_deref(), Some("Bob's title, offline"), "{d:?}");
        assert_eq!(text(&w.lab, d, h.welcome, 2).as_deref(), Some(AFTER_TEXT), "{d:?}");
    }
}

#[test]
fn a_device_restored_from_an_old_backup_forks_and_every_peer_sees_it() {
    let mut w = world();
    let h = handbook(&mut w);
    let backup = w.lab.backup(w.phone_a);
    let first = w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(2, "From the iPhone")).unwrap();
    w.lab.sync_all(4);
    assert!(devices(&w).iter().all(|&d| w.lab.forks(d).is_empty()));
    // the iPhone comes back from the backup, which lacks its edit, and edits again from that past
    w.lab.restore_backup(w.phone_a, &backup);
    assert!(w.lab.reads(w.phone_a, h.welcome), "restored, the iPhone holds Welcome's key again");
    let again = |i: &mut Item| i.set_text(2, "From the restored iPhone");
    let second = w.lab.edit(w.phone_a, h.coop, h.welcome, again).unwrap();
    w.lab.sync_all(4);
    // its two edits build on the same past, neither on the other: every device that holds both flags them
    let pair = (first.min(second), first.max(second));
    for d in [w.mac_a, w.phone_a, w.mac_b, w.server] {
        assert!(w.lab.forks(d).contains(&pair), "{d:?}");
    }
    // Carol, Dave and the stranger hold neither
    for d in [w.mac_c, w.mac_d, w.stranger] {
        assert!(w.lab.forks(d).is_empty(), "{d:?}");
    }
    // both edits still count, and every device shows the same Welcome
    let shown: Vec<_> = [w.mac_a, w.phone_a, w.mac_b].iter().map(|&d| text(&w.lab, d, h.welcome, 2)).collect();
    assert!(shown.iter().all(|t| t.is_some() && *t == shown[0]), "{shown:?}");
}

#[test]
fn every_order_of_delivery_ends_the_same() {
    // three devices edit Welcome at the same moment, two of them offline; whatever order the devices then meet in,
    // every device that reads Welcome shows the same document, the same one each time, and of every log two devices
    // both hold, they hold the same edits
    let mut first = None;
    for seed in 0..6 {
        let mut w = world();
        let h = handbook(&mut w);
        w.lab.set_online(w.mac_b, false);
        w.lab.set_online(w.phone_a, false);
        w.lab.edit(w.mac_b, h.coop, h.welcome, |i| i.set_text(1, "Bob's title")).unwrap();
        w.lab.edit(w.phone_a, h.coop, h.welcome, |i| i.set_text(2, "From the iPhone")).unwrap();
        w.lab.edit(w.mac_a, h.coop, h.welcome, |i| i.set_text(2, AFTER_TEXT)).unwrap();
        w.lab.sync_all(seed);
        w.lab.set_online(w.mac_b, true);
        w.lab.set_online(w.phone_a, true);
        w.lab.sync_all(seed);
        let shown: Vec<_> = [w.mac_a, w.phone_a, w.mac_b, w.server]
            .iter()
            .map(|&d| w.lab.item(d, h.welcome).and_then(|i| i.as_document()))
            .collect();
        // the server relays Welcome and reads none of it
        assert!(shown[3].is_none(), "seed {seed}");
        assert!(shown[..3].iter().all(|s| s.is_some() && *s == shown[0]), "seed {seed}: {shown:?}");
        assert_eq!(*first.get_or_insert_with(|| shown[0].clone()), shown[0], "seed {seed}");
        for (a, b) in pairs(&devices(&w)) {
            let (da, db) = (w.lab.digests(a).clone(), w.lab.digests(b).clone());
            assert!(da.iter().all(|(l, x)| db.get(l).is_none_or(|y| y == x)), "seed {seed}: {a:?} and {b:?}");
        }
        assert!(devices(&w).iter().all(|&d| w.lab.forks(d).is_empty()), "seed {seed}");
    }
}

#[test]
fn a_device_receives_the_logs_of_the_audiences_it_reaches_and_nothing_of_the_others() {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, mac) = (w.alice, w.bob, w.mac_a);
    let work = share(alice, vault(bob), Level::Read, tagged("todo", "work"));
    let work = w.lab.issue(mac, &[mac], work).expect("Alice shares her todos tagged work with Bob");
    w.lab.sync_all(5);
    // Bob's Mac holds the logs of the two work todos, of the audience her Mac moved them into, and of Bob's share
    let held = logs(&w.lab, w.mac_b);
    let theirs = AudienceId::of(alice, &[work]);
    for l in [LogId::Entry(lib.door), LogId::Entry(lib.solar), LogId::Audience(alice, theirs), LogId::Share(work)] {
        assert!(held.contains(&l), "Bob's Mac holds {l:?}");
    }
    // and nothing of the seeds, the plan or the diary, not even the audience they sit in, the audience of no shares
    for e in [lib.seeds, lib.plan, lib.diary] {
        assert!(!held.contains(&LogId::Entry(e)), "{e:?}");
        assert_eq!(w.lab.fetched(w.mac_b, e), 0, "{e:?}");
    }
    assert!(!held.contains(&LogId::Audience(alice, AudienceId::of(alice, &[]))), "nor the cell of no caps");
    // the server, which relays the whole vault through avenCEO's wide share, holds every entry's log
    let relayed = logs(&w.lab, w.server);
    assert!(lib.all().iter().all(|&e| relayed.contains(&LogId::Entry(e))));
}

#[test]
fn an_entry_that_leaves_a_devices_reach_stops_syncing_to_it() {
    let mut w = world();
    let lib = library(&mut w);
    let (alice, bob, mac, bobs) = (w.alice, w.bob, w.mac_a, w.mac_b);
    let work = share(alice, vault(bob), Level::Write, tagged("todo", "work"));
    let work = w.lab.issue(mac, &[mac], work).expect("Alice shares her todos tagged work with Bob");
    w.lab.sync_all(6);
    let solar = LogId::Entry(lib.solar);
    let named = |lab: &mut Lab| lab.announce(mac, bobs).iter().any(|(l, _)| *l == solar);
    assert!(named(&mut w.lab), "her Mac tells Bob's Mac of the solar todo");
    let had = w.lab.fetched(w.mac_b, lib.solar);
    w.lab.tag(mac, alice, lib.solar, &[], &["work"]).expect("Alice takes the work tag off the solar todo");
    w.lab.edit(mac, alice, lib.solar, |i| {
        i.edit_todo(|t| t.notes = AFTER_TEXT.into());
    })
    .expect("and writes a note on it");
    // her Mac, a steward, moved it to the audience of no shares, out of Bob's reach: it no longer tells Bob's Mac of
    // the todo's log, in what it announces or in what it asks
    let none = Some(AudienceId::of(alice, &[]));
    assert_eq!(w.lab.state(mac).entry(lib.solar).map(|en| en.audience()), none);
    assert!(!named(&mut w.lab));
    assert!(!w.lab.request(mac, w.mac_b).ask.haves.contains_key(&solar));
    w.lab.sync_all(6);
    assert_eq!(w.lab.fetched(w.mac_b, lib.solar), had, "Bob's Mac fetches nothing of it since");
    // it never hears of the move: by its own view the todo is still in the audience of Bob's share
    let still = Some(AudienceId::of(alice, &[work]));
    assert_eq!(w.lab.state(w.mac_b).entry(lib.solar).map(|en| en.audience()), still);
    assert!(!contains(&w.lab.store(w.mac_b), AFTER_TEXT), "nor sees the note written after it left");
    // the door todo, still in that audience, syncs on: Bob checks it off and Alice sees it
    w.lab.edit(w.mac_b, bob, lib.door, |i| i.set_status(Status::Done)).expect("Bob checks it off");
    w.lab.sync_all(6);
    assert_eq!(status(&w.lab, mac, lib.door), Some(Status::Done));
    // and nothing new reaches anyone once they have synced, though Bob's Mac, behind on the solar todo for good, still
    // sends the devices ahead of it a little of what it holds of it, which they hold already
    for (from, to) in pairs(&devices(&w)) {
        let before = w.lab.size(to);
        w.lab.sync(from, to);
        assert_eq!(w.lab.size(to), before, "{from:?} to {to:?}");
    }
}

/// The coop's Charter is public, and Carol reads Welcome. What everyone reads goes only to a device that has an
/// interest in its vault, acting for the grantee of a share over it, or follows it (T12, `T12_interest`): Carol's Mac
/// receives the Charter; Dave's Mac, with no share over the coop, receives nothing of it until it follows the coop, and
/// then nothing of the coop that isn't public; following a vault with nothing public brings nothing.
#[test]
fn t12_what_everyone_reads_goes_only_to_whoever_has_an_interest() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac, mac_d) = (w.mac_a, w.mac_d);
    let charter = w.lab.create(mac, h.coop, h.coop, "doc", &[], document("Charter", CHARTER_TEXT, mac)).unwrap();
    w.lab.issue(mac, &[mac], share(h.coop, Who::Everyone, Level::Read, by_id(charter))).unwrap();
    w.lab.issue(mac, &[mac], share(h.coop, vault(w.carol), Level::Read, by_id(h.welcome))).unwrap();
    w.lab.sync_all(12);
    let reads = |lab: &Lab, d| text(lab, d, charter, 2).as_deref() == Some(CHARTER_TEXT);
    assert!(reads(&w.lab, w.mac_c), "Carol's Mac, through her share over the coop, reads the Charter");
    assert_eq!(w.lab.fetched(mac_d, charter), 0, "Dave's Mac, with none, holds nothing of it");
    let held = w.lab.size(mac_d);
    w.lab.follow(mac_d, &[w.alice]);
    w.lab.sync_all(12);
    assert_eq!(w.lab.size(mac_d), held, "following Alice's vault, with nothing public, brings nothing");
    w.lab.follow(mac_d, &[h.coop, w.alice]);
    assert_eq!(w.lab.request(mac_d, mac).ask.follow, w.lab.follows(mac_d), "its requests name what it follows");
    w.lab.sync_all(12);
    assert!(reads(&w.lab, mac_d), "following the coop, it reads the Charter");
    assert_eq!(w.lab.fetched(mac_d, h.welcome), 0, "and holds nothing of Welcome, which isn't public");
}

/// A device that acts for no vault and follows none is sent nothing at all, however public what its peers hold
/// (`T12_stranger_gets_nothing`): not the coop's public Charter, nor its schema, nor any vault's log. Once it follows
/// the coop it receives both, and nothing else of the coop.
#[test]
fn t12_a_stranger_gets_nothing() {
    let mut w = world();
    let h = handbook(&mut w);
    let (mac, stranger) = (w.mac_a, w.stranger);
    let charter = w.lab.create(mac, h.coop, h.coop, "doc", &[], document("Charter", CHARTER_TEXT, mac)).unwrap();
    w.lab.issue(mac, &[mac], share(h.coop, Who::Everyone, Level::Read, by_id(charter))).unwrap();
    let schema = w.lab.add_schema(mac, h.coop, h.coop, DOCUMENT_V1.bytes()).unwrap();
    w.lab.sync_all(12);
    assert!(respond(w.lab.log(mac).edits(), stranger, &[]).is_empty(), "Alice's Mac would send it nothing");
    for d in devices(&w) {
        assert_eq!(w.lab.sync(d, stranger), 0, "{d:?} sends it nothing");
    }
    assert!(w.lab.entries(stranger).is_empty());
    w.lab.follow(stranger, &[h.coop]);
    w.lab.sync_all(12);
    assert_eq!(set(w.lab.entries(stranger)), set([charter, schema]), "following the coop, its public entries alone");
    assert_eq!(w.lab.lane_of(stranger, h.coop), [DOCUMENT_V1.bytes()], "whose lane it reads");
}

/// The entries tagged `tag`, of any type.
fn tagged_with(tag: &str) -> Selector {
    Selector::AnyOf(vec![vec![Atom::TagHas(Sym::new(tag))]])
}

/// Vault `actor` revokes share `share` on device `on`, which signs.
fn revoke(lab: &mut Lab, on: SignerId, share: ShareId, actor: VaultId) -> Result<EditId, Refusal> {
    lab.submit(on, &[on], Action::Revoke(Revoking::Grant { share, actor, keep: vec![], via: vec![] }))
}

/// A file sealed under a key of its own, its root standing for the hash iroh names its pieces by.
fn film(text: &str, k: u8) -> Brought {
    let (key, plain) = (FileKey::from_bytes([k; 32]), text.repeat(500).into_bytes());
    let root = avendb::hash::hash("a test file's root", &seal(&key, &plain));
    Brought::new(root, key, plain.len() as u64)
}

/// Alice's Mac makes a clip in her vault, tagged `tag`, and brings its film.
fn clip(w: &mut World, title: &str, tag: &str, k: u8) -> EntryId {
    clip_tagged(w, title, &[tag], k)
}

/// A clip as `clip` makes it, tagged `tags`.
fn clip_tagged(w: &mut World, title: &str, tags: &[&str], k: u8) -> EntryId {
    let (alice, mac) = (w.alice, w.mac_a);
    let e = w.lab.create(mac, alice, alice, "clip", tags, document(title, "A clip.", mac)).unwrap();
    w.lab.bring(mac, alice, e, vec![film(title, k)], |_| {}).unwrap();
    e
}

/// The files the edits of entry `e` that device `d` holds bring.
fn files_of(lab: &Lab, d: SignerId, e: EntryId) -> BTreeSet<FileRoot> {
    lab.log(d).edits().iter().filter(|o| o.entry() == Some(e)).flat_map(|o| o.files().iter().copied()).collect()
}

fn set(xs: impl IntoIterator<Item = EntryId>) -> BTreeSet<EntryId> {
    xs.into_iter().collect()
}

fn roots(xs: impl IntoIterator<Item = FileRoot>) -> BTreeSet<FileRoot> {
    xs.into_iter().collect()
}

/// Alice's films (blobs B2c): two clips, each a proxy and its original, every one bringing its file, and a note, all in
/// her vault, which gives the server relay. Her iPhone syncs only the proxies and keeps their files whole; the server
/// syncs every entry of hers and keeps every file whole, by a keep share of avenCEO's own; her Mac has no keep share
/// and syncs all of it, fetching files as it reads them. Nothing in the keep shares names a proxy: they are any slice
/// of any data, by the same selectors as shares, and the stewards mark which keep shares pick each entry.
#[test]
fn t28_each_device_syncs_what_its_keep_shares_pick() {
    let mut w = world();
    let (alice, mac, phone, server) = (w.alice, w.mac_a, w.phone_a, w.server);
    relay_on(&mut w, alice);
    w.lab.sync_all(0);
    let proxy = keep(alice, phone, alice, KeepMode::Whole, tagged_with("proxy"));
    let phone_keep = w.lab.issue(mac, &[mac], proxy).unwrap();
    w.lab.issue(server, &[server], keep(w.avenceo, server, alice, KeepMode::Whole, Selector::All)).unwrap();
    let proxies = [clip(&mut w, "Dawn, proxy", "proxy", 1), clip(&mut w, "Dusk, proxy", "proxy", 2)];
    let originals = [clip(&mut w, "Dawn", "original", 3), clip(&mut w, "Dusk", "original", 4)];
    let note = w.lab.create(mac, alice, alice, "note", &[], document("Shot list", "Dawn, then dusk.", mac)).unwrap();
    w.lab.sync_all(1);
    let all = set(proxies.into_iter().chain(originals).chain([note]));
    assert_eq!(set(w.lab.entries(phone)), set(proxies), "the iPhone syncs the proxies alone");
    assert_eq!(set(w.lab.entries(mac)), all, "the Mac, with no keep share, syncs everything");
    assert_eq!(set(w.lab.entries(server)), all, "the server syncs everything by its own keep share");
    // each keeps whole the files its keep shares say: the iPhone the proxies', the server all, the Mac none by default
    let proxy_files: BTreeSet<FileRoot> = proxies.iter().flat_map(|&e| files_of(&w.lab, mac, e)).collect();
    let every_file = roots(w.lab.files(mac));
    assert_eq!(every_file.len(), 4);
    assert_eq!(roots(w.lab.kept_files(phone, false)), proxy_files);
    assert_eq!(roots(w.lab.kept_files(server, false)), every_file);
    assert!(w.lab.kept_files(mac, false).is_empty());
    assert_eq!(roots(w.lab.kept_files(mac, true)), every_file);
    // files follow their edits (T27): the iPhone may fetch a proxy's file and not an original's
    let original_files: BTreeSet<FileRoot> = originals.iter().flat_map(|&e| files_of(&w.lab, mac, e)).collect();
    assert!(proxy_files.iter().all(|f| w.lab.may_fetch_file(mac, phone, f, &[])));
    assert!(original_files.iter().all(|f| !w.lab.may_fetch_file(mac, phone, f, &[])));
    // the server reads no selector of Alice's, and still sends the iPhone only what its keep share picks, by the marks
    // (T23): a new proxy reaches the iPhone through the server alone, while the Mac is away
    assert!(w.lab.slice(server, phone_keep).is_none());
    let late = clip(&mut w, "Noon, proxy", "proxy", 5);
    w.lab.sync(mac, server);
    w.lab.set_online(mac, false);
    w.lab.sync_all(2);
    assert_eq!(set(w.lab.entries(phone)), set(proxies.into_iter().chain([late])));
    w.lab.set_online(mac, true);
    // the keep share follows the data: an original retagged a proxy reaches the iPhone
    w.lab.tag(mac, alice, originals[0], &["proxy"], &["original"]).unwrap();
    w.lab.sync_all(3);
    assert!(w.lab.entries(phone).contains(&originals[0]));
    assert!(!w.lab.entries(phone).contains(&originals[1]));
    // and once Alice's vault revokes it, the iPhone syncs all of her vault again
    revoke(&mut w.lab, mac, phone_keep, alice).unwrap();
    w.lab.sync_all(4);
    assert_eq!(set(w.lab.entries(phone)), set(w.lab.entries(mac)));
}

/// The files the edits of entries `es` that Alice's Mac holds bring.
fn films(w: &World, es: &[EntryId]) -> BTreeSet<FileRoot> {
    es.iter().flat_map(|&e| files_of(&w.lab, w.mac_a, e)).collect()
}

/// Keep modes (V1c): Alice's iPhone keeps her proxies when it opens them, the dawn one whole and never the dusk one,
/// and with them the schema of her clips, which a keep share that keeps anything picks; the server never keeps her
/// originals, by a never share that picks the schema too and so picks none of it, and keeps whole the films of what it
/// syncs by its own setting, having no keep share there but a never one. Never wins over whole and opened. Once Alice's
/// vault revokes the iPhone's never share, the dusk proxy reaches it, and stays a proxy it keeps when it opens it.
#[test]
fn keep_modes_choose_what_and_how_a_device_syncs() {
    let mut w = world();
    let (alice, mac, phone, server) = (w.alice, w.mac_a, w.phone_a, w.server);
    relay_on(&mut w, alice);
    w.lab.sync_all(0);
    let both = |a: &str, b: &str| Selector::AnyOf(vec![vec![Atom::TagHas(Sym::new(a)), Atom::TagHas(Sym::new(b))]]);
    let modes = [
        (KeepMode::Opened, tagged_with("proxy")),
        (KeepMode::Whole, both("proxy", "dawn")),
        (KeepMode::Never, tagged_with("dusk")),
    ];
    let phone_keeps: Vec<ShareId> =
        modes.into_iter().map(|(m, s)| w.lab.issue(mac, &[mac], keep(alice, phone, alice, m, s)).unwrap()).collect();
    let schemas = vec![Atom::TypeIn(vec![Sym::new(SCHEMA_TYPE)])];
    let never = Selector::AnyOf(vec![vec![Atom::TagHas(Sym::new("original"))], schemas]);
    // Alice's Mac issues it for avenCEO, which her vault owns: the server holds no seed of Alice's vault to seal the
    // selector to, as a keep share that isn't wide must be
    w.lab.issue(mac, &[mac], keep(w.avenceo, server, alice, KeepMode::Never, never)).unwrap();
    w.lab.sync_all(1);
    let proxies = [
        clip_tagged(&mut w, "Dawn, proxy", &["proxy", "dawn"], 1),
        clip_tagged(&mut w, "Dusk, proxy", &["proxy", "dusk"], 2),
    ];
    let originals = [
        clip_tagged(&mut w, "Dawn", &["original", "dawn"], 3),
        clip_tagged(&mut w, "Dusk", &["original", "dusk"], 4),
    ];
    let schema = w.lab.add_schema(mac, alice, alice, DOCUMENT_V1.bytes()).unwrap();
    w.lab.sync_all(2);
    assert_eq!(set(w.lab.entries(phone)), set([proxies[0], schema]), "the dawn proxy and the schema");
    assert_eq!(set(w.lab.entries(server)), set([proxies[0], proxies[1], schema]), "all but the originals");
    assert!(originals.iter().all(|e| w.lab.entries(mac).contains(e)));
    // the iPhone keeps whole only the dawn proxy's film, whatever its own setting; the server keeps whole the films of
    // what it syncs by its own setting alone
    let dawn = films(&w, &proxies[..1]);
    assert_eq!(roots(w.lab.kept_files(phone, false)), dawn);
    assert_eq!(roots(w.lab.kept_files(phone, true)), dawn);
    assert_eq!(roots(w.lab.kept_files(server, true)), films(&w, &proxies));
    assert!(w.lab.kept_files(server, false).is_empty());
    // with the never share revoked, the dusk proxy reaches the iPhone, which fetches its film's pieces as it reads them
    revoke(&mut w.lab, mac, phone_keeps[2], alice).unwrap();
    w.lab.sync_all(3);
    assert_eq!(set(w.lab.entries(phone)), set([proxies[0], proxies[1], schema]));
    assert_eq!(roots(w.lab.kept_files(phone, true)), dawn);
    let demanded = [proxies[0], proxies[1], originals[0], originals[1]];
    assert_eq!(roots(w.lab.demanded_files(phone, &demanded)), films(&w, &proxies),
        "demand hydrates opened files, but cannot escape the keep selection");
    w.lab.issue(mac, &[mac], keep(alice, phone, alice, KeepMode::Never, tagged_with("dusk"))).unwrap();
    w.lab.sync_all(4);
    assert_eq!(roots(w.lab.demanded_files(phone, &demanded)), dawn,
        "a new never rule wins even when the device already holds the entry");
    assert!(w.lab.demanded_files(server, &demanded).is_empty(),
        "view demand grants no readable file keys to a sealed backup peer");
}

/// A keep share grants nothing (blobs B2c, K1): only a vault issues the keep shares of its own devices, over a vault
/// whose entries it may hold; a device under one syncs only what it may receive and its keep shares pick; a keep share
/// drops nothing a device already holds; and only its issuer revokes it, not even the vault it is over.
#[test]
fn keep_shares_grant_nothing() {
    let mut w = world();
    let (alice, carol, mac, mac_c) = (w.alice, w.carol, w.mac_a, w.mac_c);
    let l = library(&mut w);
    w.lab.sync_all(0);
    // a keep share to a device of another vault, or over a vault the issuer holds no share over, is refused
    let not_hers = w.lab.issue(mac, &[mac], keep(alice, mac_c, alice, KeepMode::Opened, Selector::All));
    assert_eq!(not_hers, Err(Refusal::NotDevice));
    let no_share = w.lab.issue(mac_c, &[mac_c], keep(carol, mac_c, alice, KeepMode::Opened, Selector::All));
    assert_eq!(no_share.map(drop), Err(Refusal::NoCap));
    // with a share to read Alice's notes, Carol's Mac may keep from her vault: a keep share that picks the todos
    // brings her none of them, and no new note either; once Carol's vault revokes it, the new note comes
    w.lab.issue(mac, &[mac], share(alice, vault(carol), Level::Read, of_type("note"))).unwrap();
    w.lab.sync_all(1);
    assert_eq!(set(w.lab.entries(mac_c)), set([l.plan, l.diary]));
    let todos = w.lab.issue(mac_c, &[mac_c], keep(carol, mac_c, alice, KeepMode::Whole, of_type("todo"))).unwrap();
    w.lab.sync_all(2);
    let ideas = w.lab.create(mac, alice, alice, "note", &[], document("Ideas", "A pond.", mac)).unwrap();
    w.lab.sync_all(3);
    assert_eq!(set(w.lab.entries(mac_c)), set([l.plan, l.diary]), "no todo, and no new note");
    // Alice's vault, which it is over, may not revoke it
    assert_eq!(revoke(&mut w.lab, mac, todos, alice), Err(Refusal::NoCap));
    revoke(&mut w.lab, mac_c, todos, carol).unwrap();
    w.lab.sync_all(4);
    assert_eq!(set(w.lab.entries(mac_c)), set([l.plan, l.diary, ideas]));
    // nor does anyone but Alice's vault revoke hers
    let notes = keep(alice, w.phone_a, alice, KeepMode::Opened, of_type("note"));
    let phone_keep = w.lab.issue(mac, &[mac], notes).unwrap();
    w.lab.sync_all(4);
    assert_eq!(revoke(&mut w.lab, mac_c, phone_keep, alice), Err(Refusal::NotActing));
    assert_eq!(revoke(&mut w.lab, mac_c, phone_keep, carol), Err(Refusal::NoCap));
    assert!(w.lab.state(mac).live(phone_keep));
}

