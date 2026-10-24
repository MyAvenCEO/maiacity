//! Delayed shelf writes acknowledge only the store and pending prefix they actually captured. These tests pause
//! persistence by holding its Warming receipt while ordinary edits, restores, unlocks or another save complete.

use avendb::cast::{document, human_on};
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::lab::{Lab, Warm, Warming};
use avendb::policy::{Action, Kind, Principal};

fn alice() -> (Lab, SignerId, SignerId, SignerId, VaultId, EntryId) {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Alice's Mac");
    let phone = lab.device_of(passkey, "Alice's phone");
    let vault = human_on(&mut lab, passkey, &[mac, phone]);
    let note = lab
        .create(
            mac,
            vault,
            vault,
            "note",
            &[],
            document("Note", "Before.", mac),
        )
        .unwrap();
    // A cold restore opens real boxed keys, so each fixture starts with a pending key prefix and view.
    let backup = lab.backup(mac);
    lab.restore_from(phone, backup);
    (lab, passkey, mac, phone, vault, note)
}

fn warming(lab: &mut Lab, d: SignerId, checked: u8) -> Warming {
    lab.warming(d, lab.log(d).ids().len(), Some([checked; 40]))
        .expect("the shelf lacks work")
}

fn bytes(warming: &Warming) -> Warm {
    Warm {
        keys: warming.keys.clone().into_iter().collect(),
        views: warming.view.clone().into_iter().collect(),
    }
}

fn count(lab: &Lab, d: SignerId, what: &str) -> u64 {
    lab.perf(d)["counts"][what].as_u64().unwrap_or(0)
}

/// Add a new key family on the other device, then open its boxes through normal sync on the phone.
fn more_keys(
    lab: &mut Lab,
    passkey: SignerId,
    mac: SignerId,
    phone: SignerId,
    owner: VaultId,
    nonce: u64,
) {
    let before = count(lab, phone, "keys opened");
    let genesis = Action::Genesis {
        kind: Kind::Coop,
        owners: vec![Principal::Vault(owner)],
        threshold: 1,
        root: None,
        nonce,
        seal_to: vec![],
    };
    lab.submit(mac, &[passkey], genesis)
        .expect("Alice founds a coop");
    assert!(lab.sync(mac, phone) > 0);
    assert!(
        count(lab, phone, "keys opened") > before,
        "the phone opened new boxes after the pending save"
    );
}

#[test]
fn delayed_save_cannot_acknowledge_a_same_count_restored_branch() {
    let (mut lab, _, _, phone, vault, note) = alice();
    let base = lab.backup(phone);
    lab.edit(phone, vault, note, |it| it.set_text(2, "First branch."))
        .unwrap();
    let before = lab.log(phone).ids().to_vec();
    let delayed = warming(&mut lab, phone, 1);
    assert!(delayed.keys.is_some() && delayed.view.is_some());

    lab.restore_backup(phone, &base);
    lab.edit(phone, vault, note, |it| {
        it.set_text(2, "Replacement branch.")
    })
    .unwrap();
    assert_eq!(before.len(), lab.log(phone).ids().len());
    assert_ne!(before, lab.log(phone).ids());
    let expected = lab.item(phone, note).unwrap().record();
    lab.warmed(phone, delayed);
    assert!(
        lab.warm_due(phone),
        "the old store's receipt cannot acknowledge the replacement"
    );
    let current = warming(&mut lab, phone, 2);
    assert!(
        current.keys.is_some() && current.view.is_some(),
        "replacement keys and view still need saving"
    );
    let warm = bytes(&current);
    lab.warmed(phone, current);
    assert!(!lab.warm_due(phone));
    assert!(
        lab.warming(phone, lab.log(phone).ids().len(), Some([2; 40]))
            .is_none()
    );

    let backup = lab.backup(phone);
    let n = backup.signed().len();
    let used = count(&lab, phone, "replay: from its stored view");
    lab.restore_warm(phone, backup, Some(([2; 40], n)), &warm);
    assert_eq!(count(&lab, phone, "replay: from its stored view"), used + 1);
    assert_eq!(lab.item(phone, note).unwrap().record(), expected);
}

#[test]
fn appends_during_a_save_keep_its_prefix_valid_and_replay_the_tail_on_restart() {
    let (mut lab, _, _, phone, vault, note) = alice();
    let delayed = warming(&mut lab, phone, 1);
    let warm = bytes(&delayed);
    let held = lab.log(phone).ids().len();
    lab.edit(phone, vault, note, |it| {
        it.set_text(2, "Appended while saving.")
    })
    .unwrap();
    let expected = lab.item(phone, note).unwrap().record();
    lab.warmed(phone, delayed);
    assert!(
        !lab.warm_due(phone),
        "a small append does not invalidate a durable snapshot prefix"
    );

    let backup = lab.backup(phone);
    let used = count(&lab, phone, "replay: from its stored view");
    lab.restore_warm(phone, backup, Some(([1; 40], held)), &warm);
    assert_eq!(count(&lab, phone, "replay: from its stored view"), used + 1);
    assert_eq!(lab.item(phone, note).unwrap().record(), expected);
}

#[test]
fn a_receipt_from_before_lock_cannot_drain_keys_opened_after_unlock() {
    let (mut lab, _, _, phone, _, _) = alice();
    let delayed = warming(&mut lab, phone, 1);
    lab.lock(phone);
    assert!(lab.unlock(phone));
    lab.warmed(phone, delayed);
    assert!(lab.warm_due(phone));
    let current = warming(&mut lab, phone, 1);
    assert!(
        current.keys.is_some(),
        "the newly opened key prefix remains pending"
    );
    lab.warmed(phone, current);
    assert!(!lab.warm_due(phone));
}

#[test]
fn overlapping_receipts_never_drain_keys_outside_their_captured_prefix() {
    for newest_first in [false, true] {
        let (mut lab, passkey, mac, phone, vault, _) = alice();
        let first = warming(&mut lab, phone, 1);
        more_keys(&mut lab, passkey, mac, phone, vault, 1);
        let second = warming(&mut lab, phone, 2);
        let delayed = if newest_first {
            lab.warmed(phone, second);
            first
        } else {
            lab.warmed(phone, first);
            assert!(
                lab.warm_due(phone),
                "keys opened during the first save remain pending"
            );
            second
        };
        more_keys(&mut lab, passkey, mac, phone, vault, 2);
        lab.warmed(phone, delayed);
        assert!(
            lab.warm_due(phone),
            "a receipt cannot drain a shifted pending prefix"
        );
        let current = warming(&mut lab, phone, 3);
        assert!(current.keys.is_some());
        lab.warmed(phone, current);
        assert!(!lab.warm_due(phone));
    }
}

#[test]
fn owned_capture_survives_append_but_restore_and_lock_reject_its_receipt() {
    for mode in [0, 1, 2] {
        let (mut lab, _, _, phone, vault, note) = alice();
        let backup = lab.backup(phone);
        let held = lab.log(phone).ids().len();
        let capture = lab.capture_warm(phone, held, Some([9; 40])).unwrap();
        match mode {
            0 => { lab.edit(phone, vault, note, |it| it.set_text(2, "After capture")).unwrap(); }
            1 => lab.restore_backup(phone, &backup),
            _ => { lab.lock(phone); assert!(lab.unlock(phone)); }
        }
        // Encoding after mutation still produces the captured prefix, never current mutable state.
        let receipt = capture.encode();
        let warm = bytes(&receipt);
        lab.warmed(phone, receipt);
        assert_eq!(lab.warm_due(phone), mode != 0);
        if mode == 0 {
            let expected = lab.item(phone, note).unwrap().record();
            let backup = lab.backup(phone);
            lab.restore_warm(phone, backup, Some(([9; 40], held)), &warm);
            assert_eq!(lab.item(phone, note).unwrap().record(), expected);
        }
    }
}

#[test]
fn dropping_unencoded_capture_does_not_acknowledge_pending_work() {
    let (mut lab, _, _, phone, _, _) = alice();
    let held = lab.log(phone).ids().len();
    drop(lab.capture_warm(phone, held, Some([7; 40])).unwrap());
    assert!(lab.warm_due(phone));
    assert!(lab.capture_warm(phone, held, Some([7; 40])).is_some());
}

#[test]
fn captured_view_bytes_equal_canonical_encoding() {
    let (mut lab, _, _, phone, vault, note) = alice();
    let replay = lab.log(phone).replay();
    let held = lab.log(phone).ids().len();
    let expected = replay.to_view(held);
    let capture = replay.capture_view();
    lab.edit(phone, vault, note, |it| it.set_text(2, "Later")).unwrap();
    assert_eq!(capture.encode(held), expected);
}
