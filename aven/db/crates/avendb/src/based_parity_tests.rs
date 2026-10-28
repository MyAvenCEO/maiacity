//! Parity of the one based format (P6): a device that starts an entry from its owners' judged base shows exactly what
//! a device that read the old projection-1 rows showed, and what the owner's full replay shows.
use super::*;
use crate::cast::{document, human_on};
use crate::policy::{Level, Who};
use serde_json::{Value, json};

fn rows(lab: &Lab, on: SignerId, entry: EntryId) -> (Value, Value) {
    let query = crate::engine::read(lab, on, &json!({ "op": "query", "schema": "stored", "where": { "type": ["note"] } }));
    let get = crate::engine::read(lab, on, &json!({ "op": "get", "entry": entry.to_hex(), "schema": "stored" }));
    let row = query["ok"]["rows"].as_array().and_then(|r| r.iter().find(|r| r["entry"] == entry.to_hex())).cloned()
        .unwrap_or(Value::Null);
    (json!({ "record": row["record"], "readOnly": row["readOnly"] }),
        json!({ "record": get["ok"]["record"], "readOnly": get["ok"]["readOnly"], "line": get["ok"]["line"] }))
}

/// The old projection-1 rows were checked against the judged base before projection-1 went (both rows equal for an
/// owner device); now the judged base is checked against what the owner's full replay shows.
#[test]
fn a_judged_base_shows_what_a_full_replay_shows() {
    let mut lab = Lab::new();
    let owner = lab.passkey("Owner");
    let mac = lab.device_of(owner, "Mac");
    let pad = lab.device_of(owner, "Pad");
    let vault = human_on(&mut lab, owner, &[mac, pad]);
    lab.sync(mac, pad);
    let entry = lab.create(mac, vault, vault, "note", &[], document("Parity", "initial", mac)).unwrap();
    for n in 0..8 {
        lab.edit(mac, vault, entry, |item| item.set_text(2, &format!("latest {n}"))).unwrap();
    }
    let PreparedEntryBase { draft, sealed: base, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
    let judged = lab.complete(mac, draft, &[]).unwrap();
    let offer = lab.entry_base_offer(mac, pad, entry).unwrap();
    lab.receive(pad, offer.evidence, vec![]);
    assert!(lab.adopt_owner_entry_base(pad, judged, entry, base));
    let (full_row, full_get) = rows(&lab, mac, entry);
    let (row, get) = rows(&lab, pad, entry);
    assert_eq!(row["record"], full_row["record"], "query rows");
    assert_eq!(get["record"], full_get["record"], "get rows");
    assert_eq!(get["line"], full_get["line"]);
    assert_eq!(row["readOnly"], full_row["readOnly"]);
    assert!(!lab.based_read_only(pad, entry), "an owner writes over its owners' base once the suffix is in");
}

/// A reader of the entry (a share, not an owner) starts it from the same judged base: it shows the owner's record,
/// read-only, and takes the history over it once it arrives.
#[test]
fn a_reader_starts_from_the_judged_base_read_only() {
    let mut lab = Lab::new();
    let owner = lab.passkey("Owner");
    let mac = lab.device_of(owner, "Mac");
    let vault = human_on(&mut lab, owner, &[mac]);
    let guest = lab.passkey("Guest");
    let reader = lab.device_of(guest, "Reader");
    let guest_vault = human_on(&mut lab, guest, &[reader]);
    lab.share_contact(reader, mac, guest_vault);
    lab.share_contact(mac, reader, vault);
    let share = lab.issue(mac, &[owner], crate::cast::share(vault, Who::Vault(guest_vault), Level::Read, crate::cast::of_type("note"))).unwrap();
    lab.sync(mac, reader);
    let entry = lab.create_in(mac, vault, vault, vec![share], "note", &[], document("Shared", "initial", mac)).unwrap();
    for n in 0..4 {
        lab.edit(mac, vault, entry, |item| item.set_text(2, &format!("latest {n}"))).unwrap();
    }
    let expected = lab.item(mac, entry).unwrap().record();
    let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
    let snapshot = lab.complete(mac, draft, &[]).unwrap();
    let offer = lab.entry_base_offer(mac, reader, entry).expect("a reader is offered the base");
    lab.receive(reader, offer.evidence, vec![]);
    assert!(lab.adopt_owner_entry_base(reader, snapshot, entry, sealed), "a reader takes the based state");
    let (row, get) = rows(&lab, reader, entry);
    assert_eq!(row["record"], expected);
    assert_eq!(get["record"], expected);
    assert_eq!(row["readOnly"], true);
    assert_eq!(get["readOnly"], true);
    assert!(lab.based_read_only(reader, entry));
    lab.sync(mac, reader);
    assert_eq!(lab.item(reader, entry).unwrap().record(), expected, "the history takes over");
    lab.edit(mac, vault, entry, |item| item.set_text(2, "after")).unwrap();
    lab.sync(mac, reader);
    assert_eq!(lab.item(reader, entry).unwrap().record(), lab.item(mac, entry).unwrap().record());
}

/// A device with its owners' base of an entry catches up a step at a time too (until 2026-10-28 it took the whole
/// catch-up in one step): the based entry shows what its base shows between the steps, and it ends with the same view
/// as one catch-up.
#[test]
fn a_based_device_catches_up_a_step_at_a_time() {
    let make = || {
        let mut lab = Lab::new();
        let owner = lab.passkey("Owner");
        let mac = lab.device_of(owner, "Mac");
        let pad = lab.device_of(owner, "Pad");
        let vault = human_on(&mut lab, owner, &[mac, pad]);
        lab.sync(mac, pad);
        let entry = lab.create(mac, vault, vault, "note", &[], document("Based", "initial", mac)).unwrap();
        for n in 0..8 {
            lab.edit(mac, vault, entry, |item| item.set_text(2, &format!("latest {n}"))).unwrap();
        }
        let PreparedEntryBase { draft, sealed, .. } = lab.draft_judged_entry_base(mac, &[owner], entry).unwrap();
        let judged = lab.complete(mac, draft, &[]).unwrap();
        let offer = lab.entry_base_offer(mac, pad, entry).unwrap();
        lab.receive(pad, offer.evidence, vec![]);
        assert!(lab.adopt_owner_entry_base(pad, judged, entry, sealed));
        let before: HashSet<EditId> = lab.log(mac).ids().iter().copied().collect();
        for i in 0..12 {
            let other = lab.create(mac, vault, vault, "note", &[], document(&format!("Other {i}"), "x", mac)).unwrap();
            for n in 0..6 {
                lab.edit(mac, vault, other, |item| item.set_text(2, &format!("edit {n}"))).unwrap();
            }
        }
        let fresh: Vec<Signed> = lab.backup(mac).signed().iter().filter(|s| !before.contains(&s.edit.id())).cloned().collect();
        for page in fresh.chunks(20) {
            lab.receive_whose_now(pad, page.to_vec(), vec![], false);
        }
        (lab, pad, entry)
    };
    let (mut once, pad, entry) = make();
    let (mut steps, _, _) = make();
    let based = steps.item(pad, entry).unwrap().record();
    assert!(steps.held(pad).bases.contains_key(&entry) && steps.held(pad).behind, "a based device behind");
    assert!(once.catch_up(pad));
    let mut taken = 0;
    while let CatchUp::Stepped = steps.catch_up_step(pad, 1) {
        taken += 1;
        assert!(taken < 10_000, "a catch-up in steps ends");
        assert_eq!(steps.item(pad, entry).unwrap().record(), based, "the based entry as its base shows it, step {taken}");
    }
    assert!(taken > 4, "more than one step: {taken}");
    assert!(once.state(pad) == steps.state(pad), "the same state");
    let view = |lab: &Lab| {
        let entries: Vec<_> = lab.entries(pad).into_iter().map(|e| (e, lab.item(pad, e).map(|i| i.record()))).collect();
        (lab.log(pad).ids().to_vec(), entries)
    };
    assert_eq!(view(&once), view(&steps), "the same edits, entries and items as one catch-up");
    assert_eq!(rows(&once, pad, entry), rows(&steps, pad, entry));
}
