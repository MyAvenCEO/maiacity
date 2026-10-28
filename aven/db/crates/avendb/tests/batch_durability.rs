//! Process-local signing capture and durable publication preserve signer order across recovery.
use avendb::batch::{SignedRoot, SignerLog, SigningEvents};
use avendb::cast::{document, human_on};
use avendb::id::EditId;
use avendb::lab::Lab;
use avendb::sign::DeviceKey;

fn id(n: u64) -> EditId {
    EditId::from_u64(n)
}

#[test]
fn delayed_and_overlapping_receipts_only_drain_their_captured_prefix() {
    let mut events = SigningEvents::default();
    events.record(id(1));
    events.record(id(1));
    let a = events.capture().unwrap();
    events.record(id(2));
    let b = events.capture().unwrap();
    assert!(events.acknowledge(&a));
    events.record(id(3));
    assert!(!events.acknowledge(&b), "b cannot drain the shifted prefix");
    assert_eq!(events.capture().unwrap().ids(), &[id(2), id(3)]);
    let detached = events.detached();
    assert!(!events.acknowledge(&detached.capture().unwrap()), "a copied writer has another generation");
    let c = events.capture().unwrap();
    assert!(events.acknowledge(&c));
    assert!(!events.pending());
}

#[test]
fn only_a_matching_persisted_prefix_can_resume_or_publish() {
    let key = DeviceKey::from_secret([198; 32]);
    let mut log = SignerLog::wrap(key.id(), [id(1), id(2)]);
    let root = SignedRoot::sign(&key, log.durable_root().unwrap());
    assert!(log.proof(id(1)).is_none(), "signature has no publication receipt yet");
    assert!(log.publish(root.clone()));
    log.write(id(3));
    assert!(log.proof(id(3)).is_none());
    assert!(SignerLog::resume(key.id(), vec![id(1), id(2), id(3)], Some(root.clone())).is_some());
    assert!(SignerLog::resume(key.id(), vec![id(2), id(1)], Some(root.clone())).is_none());
    assert!(SignerLog::resume(key.id(), vec![id(1), id(1), id(2)], Some(root)).is_none());
}

#[test]
fn successful_signing_order_survives_same_count_restore_lock_and_delayed_ack() {
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Mac");
    let vault = human_on(&mut lab, passkey, &[mac]);
    let entry = lab.create(mac, vault, vault, "note", &[], document("Note", "Before.", mac)).unwrap();
    lab.capture_signing(mac);
    let base = lab.backup(mac);
    lab.edit(mac, vault, entry, |it| it.set_text(2, "First branch.")).unwrap();
    let first = lab.signing_capture(mac).unwrap();
    let first_count = lab.log(mac).ids().len();
    lab.restore_backup(mac, &base);
    lab.edit(mac, vault, entry, |it| it.set_text(2, "Replacement branch.")).unwrap();
    assert_eq!(lab.log(mac).ids().len(), first_count);
    let both = lab.signing_capture(mac).unwrap();
    assert!(both.ids().starts_with(first.ids()) && both.ids().len() > first.ids().len());
    lab.lock(mac);
    assert_eq!(lab.signing_capture(mac).unwrap().ids(), both.ids());
    assert!(lab.signing_saved(mac, &first), "persisted old branch remains part of signer order");
    assert!(!lab.signing_saved(mac, &both), "stale overlapping receipt cannot acknowledge replacement suffix");
    assert!(lab.unlock(mac));
    assert!(lab.signing_pending(mac));
}

#[test]
fn enrollment_does_not_turn_checkpoint_trust_into_device_signatures() {
    use avendb::policy::Action;
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let mac = lab.device_of(passkey, "Mac");
    let vault = human_on(&mut lab, passkey, &[mac]);
    lab.create(mac, vault, vault, "note", &[], document("Note", "Before.", mac)).unwrap();
    let actual = lab.capture_signing(mac);
    assert!(!actual.is_empty());
    let covered = lab.log(mac).ids().to_vec();
    lab.submit(mac, &[passkey], Action::Checkpoint { vault, covers: covered.clone() }).unwrap();
    let checked = lab.backup(mac);
    lab.restore_from(mac, checked);
    assert!(actual.iter().all(|id| lab.log(mac).ids().contains(id)), "checkpoint-trusted edits remain held");
    let enrolled = lab.capture_signing(mac);
    assert!(actual.iter().all(|id| !enrolled.contains(id)), "bare records never become device-signed leaves");
    for id in enrolled {
        assert!(lab.signed_edit(mac, id).unwrap().verify().is_ok());
    }
}
