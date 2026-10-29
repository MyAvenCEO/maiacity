//! Showings kept on the shelf (`ShownView.lean`): a device that opens with the showings its shelf kept takes each whose
//! print is its entry's print then, and judges the others anew, and shows what judging every entry anew shows (SV1),
//! whatever came since the save (SV2). In a debug build `show_items` judges each one it takes anew too and compares.
#![cfg(debug_assertions)]

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
        shown: w.shown.clone().map(Into::into).into_iter().collect(),
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

/// More entries than stay open (`shown_map::WINDOW`, 8 in a test build, beside the 32 that keep scratch items):
/// those past the window close as their kept bytes, and each shows as it did open, read in any order, edited on, and kept again.
#[test]
fn showings_past_the_window_close_and_open_as_they_were() {
    let (mut lab, mac, phone, vault, notes) = alice(56);
    for (i, e) in notes.iter().enumerate() {
        lab.edit(phone, vault, *e, |it| it.set_text(2, &format!("Written {i}."))).unwrap();
    }
    assert!(count(&lab, phone, "show: showings closed") > 0, "showings past the window closed");
    let expected = records(&lab, phone, &notes);
    let mut backwards = notes.clone();
    backwards.reverse();
    let mut seen = records(&lab, phone, &backwards);
    seen.reverse();
    assert_eq!(seen, expected);
    // edited on after it closed and opened again, on the device and on another that takes the edit
    lab.edit(phone, vault, notes[0], |it| it.set_text(2, "Again.")).unwrap();
    assert!(lab.sync(phone, mac) > 0);
    assert_eq!(records(&lab, mac, &notes[..1]), records(&lab, phone, &notes[..1]));
    assert!(records(&lab, phone, &notes[..1])[0].contains("Again."));
    // and kept: an unlock takes every one, closed, and shows each as before
    let (warm, held) = save(&mut lab, phone).expect("the shelf lacks work");
    let expected = records(&lab, phone, &notes);
    let backup = lab.backup(phone);
    lab.restore_warm(phone, backup, Some(([1; 40], held)), &warm);
    assert_eq!(records(&lab, phone, &notes), expected);
}

/// A pack whose last showing doesn't open (a shelf's file spoilt after the save): the others are taken, that one's
/// entry shows nothing till the next showing, which judges it anew.
#[test]
fn a_showing_that_does_not_open_is_judged_anew() {
    let (mut lab, _, phone, vault, notes) = alice(3);
    for (i, e) in notes.iter().enumerate() {
        lab.edit(phone, vault, *e, |it| it.set_text(2, &format!("Written {i}."))).unwrap();
    }
    let held = lab.log(phone).ids().len();
    let w: Warming = lab.warming(phone, held, Some([1; 40])).expect("the shelf lacks work");
    let mut pack = w.shown.clone().expect("a pack").pack;
    *pack.last_mut().unwrap() ^= 1;
    let warm = Warm { keys: w.keys.clone().into_iter().collect(), views: w.view.clone().into_iter().collect(), shown: vec![pack.into()] };
    lab.warmed(phone, w);
    let expected = records(&lab, phone, &notes);
    let backup = lab.backup(phone);
    lab.restore_warm(phone, backup, Some(([1; 40], held)), &warm);
    let seen = records(&lab, phone, &notes);
    assert_eq!(seen.iter().filter(|r| r.is_empty()).count(), 1, "the one that doesn't open shows nothing yet");
    // a write to another note shows the device's entries again
    let other = seen.iter().position(|r| !r.is_empty()).unwrap();
    lab.edit(phone, vault, notes[other], |it| it.set_text(2, "Again.")).unwrap();
    let now = records(&lab, phone, &notes);
    for (i, r) in now.iter().enumerate() {
        match i == other {
            true => assert!(r.contains("Again.")),
            false => assert_eq!(*r, expected[i], "note {i} judged anew as it was"),
        }
    }
}

/// A pack its shelf lists that doesn't open, beside one that does (the iPhone's 3 packs sealed before the show rules,
/// tried at every unlock on 2026-10-28): the next save keeps every showing in one pack in place of them all, so the
/// unlock after takes every one from it alone, and tries no pack that doesn't open.
#[test]
fn a_pack_that_does_not_open_is_put_again_whole() {
    let (mut lab, _, phone, vault, notes) = alice(4);
    for (i, e) in notes.iter().enumerate() {
        lab.edit(phone, vault, *e, |it| it.set_text(2, &format!("Written {i}."))).unwrap();
    }
    let held = lab.log(phone).ids().len();
    let w: Warming = lab.warming(phone, held, Some([1; 40])).expect("the shelf lacks work");
    let pack = w.shown.clone().expect("a pack").pack;
    let mut stale = pack.clone();
    stale[0] ^= 1;
    let warm = Warm { keys: w.keys.clone().into_iter().collect(), views: w.view.clone().into_iter().collect(), shown: vec![stale.into(), pack.into()] };
    lab.warmed(phone, w);
    let backup = lab.backup(phone);
    lab.restore_warm(phone, backup, Some(([1; 40], held)), &warm);
    assert_eq!(count(&lab, phone, "kept shown: a pack that doesn't open"), 1);
    let expected = records(&lab, phone, &notes);
    let (again, held) = save(&mut lab, phone).expect("its showings, put again in one pack");
    assert_eq!(again.shown.len(), 1, "one pack of them all");
    let (failed, taken) = (count(&lab, phone, "kept shown: a pack that doesn't open"), count(&lab, phone, "show: entries taken as kept"));
    let backup = lab.backup(phone);
    lab.restore_warm(phone, backup, Some(([1; 40], held)), &Warm { shown: again.shown, ..warm });
    assert_eq!(count(&lab, phone, "kept shown: a pack that doesn't open"), failed, "no pack that doesn't open");
    assert!(count(&lab, phone, "show: entries taken as kept") >= taken + notes.len() as u64, "every note taken from it");
    assert_eq!(records(&lab, phone, &notes), expected);
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
