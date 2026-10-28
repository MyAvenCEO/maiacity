//! The show rules kept showings are sealed to (`ShowRules.lean`, `vectors/show_rules.json`): a pack of kept showings
//! opens in any build under the same show rules, not only in the build that sealed it (SR1), and the number pins what
//! judging gives, so that no build under it takes a showing another judging would not give.
//!
//! `tests/data/kept_shown_rules_<n>.bin` is a pack an earlier build sealed of `cast`'s showings: a build whose engine
//! hash is another's must open it and take every showing of it. Where `the_show_rules_number_pins_what_showings_hold`
//! is bumped, write the pack of the new number with `SHOW_RULES_WRITE=1` and commit it beside the new pin.

use avendb::cast::{document, human_on};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{GroupShare, Lab, Warm};
use avendb::policy::{Action, Kind, Level, Principal, Who};
use avendb::rules::{Cap, CapGroup, Op};
use avendb::slice::{Atom, Selector};
use serde_json::Value;

fn vectors() -> Value {
    serde_json::from_str(include_str!("../../../spec/vectors/show_rules.json")).expect("the show rules vectors")
}

const RULES: &str = env!("AVENDB_SHOW_RULES");

/// The pack an earlier build sealed of `cast`'s showings, under the show rules `RULES`.
fn pack_path() -> String {
    format!("{}/tests/data/kept_shown_rules_{RULES}.bin", env!("CARGO_MANIFEST_DIR"))
}

struct Cast {
    lab: Lab,
    mac: SignerId,
    phone: SignerId,
    vault: VaultId,
    entries: Vec<EntryId>,
}

/// Alice's notes on her Mac, written on, and a coop of hers with a cap group that shares what is tagged "travel" with
/// everyone, its entries some tagged and some not; her phone takes them all. Fixed keys and randomness: every build
/// writes the very same edits.
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

/// The phone saves what it worked out: its keys, its stored view and the pack of its showings.
fn save(c: &mut Cast) -> (Warm, Vec<u8>, usize) {
    let held = c.lab.log(c.phone).ids().len();
    let w = c.lab.warming(c.phone, held, Some([1; 40])).expect("the shelf lacks work");
    let pack = w.shown.clone().map(|(p, _)| p).expect("a pack of its showings");
    let warm = Warm { keys: w.keys.clone().into_iter().collect(), views: w.view.clone().into_iter().collect(), shown: vec![] };
    c.lab.warmed(c.phone, w);
    (warm, pack, held)
}

/// The phone opens again with `pack` as its kept showings.
fn reopen(c: &mut Cast, warm: &Warm, pack: Vec<u8>, held: usize) {
    let warm = Warm { shown: vec![pack.into()], ..warm.clone() };
    let backup = c.lab.backup(c.phone);
    c.lab.restore_warm(c.phone, backup, Some(([1; 40], held)), &warm);
}

#[test]
fn the_show_rules_number_is_the_models() {
    assert_eq!(vectors()["showRules"].to_string(), RULES, "build.rs reads showRules from ShowRules.lean");
}

/// SR1, as `vectors/show_rules.json` says: a pack opens in the build that sealed it, and in another build (the pack
/// in `tests/data`, sealed by an earlier one), where it takes every showing whose entry nobody wrote since and judges
/// the others anew, and shows what judging every entry anew shows.
#[test]
fn a_pack_of_kept_showings_opens_in_another_build() {
    if std::env::var("SHOW_RULES_WRITE").is_ok() {
        let mut c = cast();
        let (_, pack, _) = save(&mut c);
        std::fs::write(pack_path(), pack).expect("the pack written");
        return;
    }
    let sealed_before = std::fs::read(pack_path()).unwrap_or_else(|_| {
        panic!("no {}: a new showRules writes its pack with SHOW_RULES_WRITE=1", pack_path())
    });
    for case in vectors()["cases"].as_array().expect("cases") {
        let written = case["writtenSince"].as_u64().expect("writtenSince") as usize;
        let mut c = cast();
        let (warm, own, held) = save(&mut c);
        let pack = if case["sameBuild"] == true { own } else { sealed_before.clone() };
        let edited = c.entries[..written].to_vec();
        for e in &edited {
            c.lab.edit(c.mac, c.vault, *e, |it| it.set_text(2, "Since the save.")).expect("an edit");
        }
        if written > 0 {
            assert!(c.lab.sync(c.mac, c.phone) > 0);
            c.lab.catch_up(c.phone);
        }
        let expected = showings(&c);
        let held = if written > 0 { c.lab.log(c.phone).ids().len() } else { held };
        let taken = count(&c.lab, c.phone, "show: entries taken as kept");
        reopen(&mut c, &warm, pack, held);
        let name = case["name"].as_str().expect("a name");
        assert_eq!(count(&c.lab, c.phone, "kept shown: a pack that doesn't open"), 0, "{name}: the pack opens");
        let took = count(&c.lab, c.phone, "show: entries taken as kept") - taken;
        let others = (c.entries.len() - edited.len()) as u64;
        match case["takes"].as_str() {
            Some("kept") => assert!(took >= c.entries.len() as u64, "{name}: every showing taken, {took}"),
            Some("judged") => assert!(took >= others && took < c.entries.len() as u64, "{name}: the written one judged anew, {took}"),
            other => panic!("{name}: takes {other:?}"),
        }
        assert_eq!(showings(&c), expected, "{name}: what judging anew shows");
    }
}

/// What judging gives of `cast`, its showings hashed.
fn pinned_showings() -> String {
    let c = cast();
    blake3::hash(showings(&c).concat().as_bytes()).to_hex().to_string()
}

/// The show rules' number (`showRules`, `ShowRules.lean`) and the hash `pinned_showings` gave under them.
const PINNED: (&str, &str) = ("1", "ad678558a48544a80d4c99d5a2d5e42036e029cecae9c0608aeb89129c93d548");

/// A device takes a showing sealed under the same show rules number by any later build (SR1), so what judging gives must
/// not change under one number. Where this fails: if judging gives other showings now (a rule changed, or a fix changed
/// what `show_items` gives), bump `showRules` in `spec/AvenDB/ShowRules.lean`, pin the new hash beside it, and write the
/// new number's pack (see the top), so every device judges once; if only how an edit is written down changed, with the
/// same judging, pin the new hash and write the pack again under the same number (a new pack format bumps `KEPT_SHOWN` in
/// `lab/shown_map.rs`).
#[test]
fn the_show_rules_number_pins_what_showings_hold() {
    let got = pinned_showings();
    assert_eq!(
        (RULES, got.as_str()),
        PINNED,
        "judging gives other showings than the show rules number pins: bump showRules, or pin the new hash (see above)"
    );
}
