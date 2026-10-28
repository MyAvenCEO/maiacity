//! Showings kept on the shelf (`ShownView.lean`): a device that opens with the showings its shelf kept takes each whose
//! print is its entry's print then, and judges the others anew, and shows what judging every entry anew shows (SV1),
//! whatever came since the save (SV2). In a debug build `show_items` judges each one it takes anew too and compares.

use avendb::cast::{document, human_on};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{Lab, Warm, Warming};

fn alice(notes: usize) -> (Lab, SignerId, SignerId, VaultId, Vec<EntryId>) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's phone");
    let vault = human_on(&mut lab, passkey, &[mac, phone]);
    let notes = (0..notes)
        .map(|i| lab.create(mac, vault, vault, "note", &[], document(&format!("Note {i}"), "Before.", mac)).unwrap())
        .collect();
    let backup = lab.backup(mac);
    lab.restore_from(phone, backup);
    (lab, mac, phone, vault, notes)
}

fn save(lab: &mut Lab, d: SignerId) -> Option<(Warm, usize)> {
    let held = lab.log(d).ids().len();
    let w: Warming = lab.warming(d, held, Some([1; 40]))?;
    let warm = Warm {
        keys: w.keys.clone().into_iter().collect(),
        views: w.view.clone().into_iter().collect(),
        shown: w.shown.clone().map(|(pack, _)| pack).into_iter().collect(),
    };
    lab.warmed(d, w);
    Some((warm, held))
}

fn count(lab: &Lab, d: SignerId, what: &str) -> u64 {
    lab.perf(d)["counts"][what].as_u64().unwrap_or(0)
}

fn records(lab: &Lab, d: SignerId, notes: &[EntryId]) -> Vec<String> {
    notes.iter().map(|e| lab.item(d, *e).map(|it| it.record().to_string()).unwrap_or_default()).collect()
}

#[test]
fn an_unlock_takes_the_showings_its_shelf_kept() {
    let (mut lab, _, phone, vault, notes) = alice(4);
    for (i, e) in notes.iter().enumerate() {
        lab.edit(phone, vault, *e, |it| it.set_text(2, &format!("Written {i}."))).unwrap();
    }
    let (warm, held) = save(&mut lab, phone).expect("the shelf lacks work");
    assert!(!warm.shown.is_empty(), "a save keeps its showings");
    let expected = records(&lab, phone, &notes);
    let taken = count(&lab, phone, "show: entries taken as kept");
    let backup = lab.backup(phone);
    lab.restore_warm(phone, backup, Some(([1; 40], held)), &warm);
    assert_eq!(count(&lab, phone, "replay: from its stored view"), 1);
    assert!(count(&lab, phone, "show: entries taken as kept") >= taken + notes.len() as u64, "every note taken");
    assert_eq!(records(&lab, phone, &notes), expected);
}

#[test]
fn a_showing_of_other_writes_is_judged_anew() {
    let (mut lab, mac, phone, vault, notes) = alice(3);
    let (warm, _) = save(&mut lab, phone).expect("the shelf lacks work");
    // the Mac writes on after the phone's save: the phone's kept showing of that note is of fewer writes
    lab.edit(mac, vault, notes[1], |it| it.set_text(2, "After the save.")).unwrap();
    assert!(lab.sync(mac, phone) > 0);
    let expected = records(&lab, phone, &notes);
    let backup = lab.backup(phone);
    let held = backup.signed().len();
    lab.restore_warm(phone, backup, Some(([1; 40], held)), &warm);
    assert_eq!(records(&lab, phone, &notes), expected);
    assert!(expected[1].contains("After the save."));
}

/// A random walk: notes written on both devices, saves in between, each unlock with the last save's showings; every
/// note shows as the device showed it before it locked, which in a debug build is checked against judging it anew.
#[test]
fn random_vaults_open_as_judged_anew() {
    let mut seed: u64 = 0x5eed_0f_5a0e;
    let mut next = |n: u64| {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (seed >> 33) % n
    };
    let mut taken = 0;
    for round in 0..6 {
        let (mut lab, mac, phone, vault, notes) = alice(2 + next(4) as usize);
        let mut warm = None;
        for step in 0..(4 + next(8)) {
            let e = notes[next(notes.len() as u64) as usize];
            let on = if next(3) == 0 { mac } else { phone };
            lab.edit(on, vault, e, |it| it.set_text(2, &format!("Round {round} step {step}."))).unwrap();
            if on == mac {
                lab.sync(mac, phone);
            }
            if next(3) == 0 && let Some(w) = save(&mut lab, phone) {
                warm = Some(w);
            }
        }
        let Some((warm, _)) = warm else { continue };
        let expected = records(&lab, phone, &notes);
        let backup = lab.backup(phone);
        let held = backup.signed().len();
        let before = count(&lab, phone, "show: entries taken as kept");
        lab.restore_warm(phone, backup, Some(([1; 40], held)), &warm);
        assert_eq!(records(&lab, phone, &notes), expected, "round {round}");
        taken += count(&lab, phone, "show: entries taken as kept") - before;
    }
    assert!(taken > 0, "some unlock took a kept showing");
}
