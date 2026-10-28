//! What a device read, sealed with its stored view (`StoredReadings.lean`, `vectors/stored_readings.json`): a device that
//! opens its view reads on from what it read, opening only the bodies of the edits after the view (RR1), and shows what
//! reading every body anew shows; a view without them (an older engine's) reads every body anew, and the next save gives
//! a view with them; and the read rules' number pins what reading gives, so that no build under it reads otherwise.
//!
//! In a debug build `read` checks what it read on against reading every body anew (`same_readings`), which opens every
//! body: how many it opened as they were asked for is measured in a release build (`tests/unlock_phone.rs`).

#![cfg(feature = "test-fixtures")]

use avendb::cast::{document, human_on};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{GroupShare, Lab, Warm};
use avendb::policy::{Action, Kind, Level, Principal, Who};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::slice::{Atom, Selector};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../../../spec/vectors/stored_readings.json")).expect("the stored readings vectors")
}

const RULES: &str = env!("AVENDB_READ_RULES");

struct Cast {
    lab: Lab,
    mac: SignerId,
    phone: SignerId,
    vault: VaultId,
    entries: Vec<EntryId>,
}

/// Alice's notes on her Mac, written on, and a coop of hers with a cap group that shares what is tagged "travel" with
/// everyone, its entries some tagged and some not; her phone takes them all. Fixed keys and randomness: every build
/// reads the very same.
fn cast() -> Cast {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_with("Alice's phone", [9; 32]);
    let vault = human_on(&mut lab, passkey, &[mac, phone]);
    let genesis = Action::Genesis {
        kind: Kind::Coop,
        owners: vec![Principal::Vault(vault)],
        threshold: 1,
        root: None,
        nonce: 0,
        seal_to: vec![],
    };
    let coop = VaultId::from(lab.submit(mac, &[passkey], genesis).expect("a coop"));
    let travel = Selector::AnyOf(vec![vec![Atom::TagHas("travel".into())]]);
    let caps = CapGroup { name: "Traveler".into(), caps: vec![Cap { op: Op::Read, slice: travel.clone() }], includes: vec![] };
    let g = lab.define_group(mac, coop, caps).expect("a cap group");
    let share = GroupShare {
        over: coop,
        who: Who::Everyone,
        name: "Traveler of the coop".into(),
        select: travel,
        group: g,
        level: Level::Read,
        parent: None,
        issuer: coop,
    };
    lab.issue_group(mac, &[mac], share).expect("a share through it");
    let mut entries = vec![];
    for i in 0..4 {
        let doc = document(&format!("Note {i}"), "Before.", mac);
        entries.push(lab.create(mac, vault, vault, "note", &[], doc).expect("a note"));
        let tags: &[&str] = if i % 2 == 0 { &["travel"] } else { &[] };
        let doc = document(&format!("Coop doc {i}"), "Of the coop.", mac);
        entries.push(lab.create(mac, coop, coop, "doc", tags, doc).expect("a coop doc"));
    }
    for (i, e) in entries.iter().enumerate() {
        let v = if i % 2 == 0 { vault } else { coop };
        lab.edit(mac, v, *e, |it| it.set_text(2, &format!("Written {i}."))).expect("an edit");
    }
    lab.sync(mac, phone);
    lab.catch_up(phone);
    Cast { lab, mac, phone, vault, entries }
}

/// What the phone shows of each entry: its item's record and its history.
fn showings(c: &Cast) -> Vec<String> {
    let item = |e| c.lab.item(c.phone, e).map(|it| it.record().to_string()).unwrap_or_default();
    let history = |e| c.lab.history(c.phone, e).map(|h| format!("{h:?}")).unwrap_or_default();
    c.entries.iter().map(|e| format!("{}\n{}", item(*e), history(*e))).collect()
}

fn count(lab: &Lab, d: SignerId, what: &str) -> u64 {
    lab.perf(d)["counts"][what].as_u64().unwrap_or(0)
}

/// The phone saves what it worked out: its keys and its stored view, with what it read.
fn save(c: &mut Cast) -> (Warm, usize) {
    let held = c.lab.log(c.phone).ids().len();
    let w = c.lab.warming(c.phone, held, Some([1; 40])).expect("the shelf lacks work");
    let warm = Warm { keys: w.keys.clone().into_iter().collect(), views: w.view.clone().into_iter().collect(), shown: vec![] };
    c.lab.warmed(c.phone, w);
    (warm, held)
}

/// The phone opens again from `warm`, its shelf naming the first `held` edits as checked.
fn reopen(c: &mut Cast, warm: &Warm, held: usize) {
    let backup = c.lab.backup(c.phone);
    c.lab.restore_warm(c.phone, backup, Some(([1; 40], held)), warm);
}

#[test]
fn the_read_rules_number_is_the_models() {
    assert_eq!(vectors()["readRules"].to_string(), RULES, "build.rs reads readRules from StoredReadings.lean");
    for case in vectors()["cases"].as_array().expect("cases") {
        assert_eq!(case["readsAsAnew"], true, "{}: what it reads is what reading anew reads", case["name"]);
    }
}

/// RR1: an unlock reads on from what its view read, and reads only the bodies of the edits after it, showing what it
/// showed, and what it shows after more edits came.
#[test]
fn an_unlock_reads_on_from_what_its_view_read() {
    let mut c = cast();
    let (warm, held) = save(&mut c);
    let expected = showings(&c);
    let (from, whole) = (count(&c.lab, c.phone, "read: from its stored view"), count(&c.lab, c.phone, "read: every write"));
    reopen(&mut c, &warm, held);
    assert_eq!(count(&c.lab, c.phone, "read: from its stored view"), from + 1, "it reads on from its view");
    assert_eq!(count(&c.lab, c.phone, "read: every write"), whole, "it looks at no write but the new");
    assert_eq!(showings(&c), expected, "and shows what it showed");
    // edits after the save: it opens their bodies, and shows what reading every body shows
    // Alice's notes, the even entries
    for e in [c.entries[0], c.entries[2]].iter() {
        c.lab.edit(c.mac, c.vault, *e, |it| it.set_text(2, "Since the save.")).expect("an edit");
    }
    assert!(c.lab.sync(c.mac, c.phone) > 0);
    c.lab.catch_up(c.phone);
    let expected = showings(&c);
    assert!(expected[0].contains("Since the save."));
    reopen(&mut c, &warm, held);
    assert_eq!(count(&c.lab, c.phone, "read: from its stored view"), from + 2);
    assert_eq!(showings(&c), expected);
}

/// A view without what its device read, an older engine's: it reads every body anew, shows what it showed, and gives a
/// view with what it read at its next save, which the unlock after reads on from.
#[test]
fn a_view_without_what_it_read_reads_anew_and_is_given_again() {
    let mut c = cast();
    let (warm, held) = save(&mut c);
    let expected = showings(&c);
    // the view as an older engine sealed it: the replay alone
    let older = c.lab.view_without_readings(c.phone, &warm.views[0]).expect("its view opens");
    let warm = Warm { views: vec![older], ..warm };
    let (whole, views) = (count(&c.lab, c.phone, "read: every write"), count(&c.lab, c.phone, "replay: from its stored view"));
    reopen(&mut c, &warm, held);
    assert_eq!(count(&c.lab, c.phone, "replay: from its stored view"), views + 1, "its view opens");
    assert_eq!(count(&c.lab, c.phone, "read: every write"), whole + 1, "it reads every body anew");
    assert_eq!(showings(&c), expected);
    let (again, held) = save(&mut c);
    assert_eq!(again.views.len(), 1, "a view again, with what it read");
    let from = count(&c.lab, c.phone, "read: from its stored view");
    reopen(&mut c, &again, held);
    assert_eq!(count(&c.lab, c.phone, "read: from its stored view"), from + 1);
    assert_eq!(showings(&c), expected);
}

/// A view given before its device read every body (a first sync's, saved as it goes) holds not what it read: the device
/// gives one again once it read them all, which the unlock after reads on from (a Mac's browser read every body anew at
/// each unlock, 36.1 s of 57.3 s, 2026-10-28).
#[test]
fn a_view_given_before_it_read_every_body_is_given_again_with_what_it_read() {
    use avendb::lab::CatchUp;
    let mut c = cast();
    // the Mac writes more, and the phone takes it a page at a time, not caught up
    for (i, e) in c.entries.clone().iter().enumerate().filter(|(i, _)| i % 2 == 0) {
        c.lab.edit(c.mac, c.vault, *e, |it| it.set_text(2, &format!("Later {i}."))).expect("an edit");
    }
    let fresh: Vec<_> = {
        let held: std::collections::HashSet<_> = c.lab.log(c.phone).ids().iter().copied().collect();
        c.lab.backup(c.mac).signed().iter().filter(|s| !held.contains(&s.edit.id())).cloned().collect()
    };
    assert!(!fresh.is_empty());
    c.lab.receive_whose_now(c.phone, fresh, vec![], false);
    // its replay stepped on, its bodies not yet read: the view it gives now holds not what it read
    while c.lab.replay_current(c.phone) == false {
        assert_eq!(c.lab.catch_up_step(c.phone, 1), CatchUp::Stepped);
    }
    let (early, held) = save(&mut c);
    assert_eq!(early.views.len(), 1, "a view, given as it goes");
    while let CatchUp::Stepped = c.lab.catch_up_step(c.phone, 1) {}
    let expected = showings(&c);
    let (again, held_again) = save(&mut c);
    assert_eq!(held_again, held);
    assert_eq!(again.views.len(), 1, "once it read every body, the view again, with what it read");
    let (from, whole) = (count(&c.lab, c.phone, "read: from its stored view"), count(&c.lab, c.phone, "read: every write"));
    let warm = Warm { views: again.views, ..early };
    reopen(&mut c, &warm, held);
    assert_eq!(count(&c.lab, c.phone, "read: from its stored view"), from + 1, "it reads on from its view");
    assert_eq!(count(&c.lab, c.phone, "read: every write"), whole);
    assert_eq!(showings(&c), expected);
}

/// The read rules' number (`readRules`, `StoredReadings.lean`) and the hash `Lab::read_print` gave of `cast` under it.
const PINNED: (&str, &str) = ("1", "48ff8a354b0ce0d4765db320af084c917cbd64d916fc011767c8d9459c13fa4f");

/// A device reads on from what any later build under the same number sealed (RR1), so what reading gives must not change
/// under one number. Where this fails: if a body reads otherwise now (`read_body`, or what its metadata holds), bump
/// `readRules` in `spec/AvenDB/StoredReadings.lean` and pin the new hash beside it; if only how it is written down
/// changed, pin the new hash under the same number.
#[test]
fn the_read_rules_number_pins_what_reading_gives() {
    let c = cast();
    let got = c.lab.read_print(c.phone).expect("it read every body its replay counts");
    assert_eq!((RULES, got.as_str()), PINNED, "reading gives otherwise than the read rules number pins: bump readRules, or pin the new hash");
}
