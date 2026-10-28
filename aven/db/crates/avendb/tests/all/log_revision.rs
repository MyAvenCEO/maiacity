//! Runtime index invalidation: metadata never changes persisted edit or wire bytes.
use avendb::id::{EditId, SignerId};
use avendb::policy::{Action, Kind, Log, Principal};
use avendb::wire::Wire;

fn genesis(log: &Log, nonce: u64) -> avendb::policy::Edit {
    let signer = SignerId::from_u64(1);
    log.draft(signer, &[], Action::Genesis {
        kind: Kind::Human, owners: vec![Principal::Signer(signer)], threshold: 1,
        root: Some(signer), nonce, seal_to: vec![],
    })
}

#[test]
fn revisions_change_only_with_contents_and_lineage_changes_on_withdrawal() {
    let mut log = Log::new();
    let initial = log.revision();
    let lineage = log.lineage();
    let edit = genesis(&log, 1);
    let bytes = edit.to_wire();
    log.receive([edit.clone()]);
    let received = log.revision();
    assert_ne!(initial, received);
    assert_eq!(lineage, log.lineage());
    log.receive([edit.clone()]);
    log.let_go(&[EditId([255; 32])].into());
    assert_eq!(received, log.revision(), "duplicates and unknown removals change nothing");
    assert_eq!(bytes, log.edits()[0].to_wire(), "revision tokens never enter persisted edits");
    log.let_go(&[edit.id()].into());
    assert_ne!(received, log.revision());
    assert_ne!(lineage, log.lineage());
    assert!(log.edits().is_empty());
}

#[test]
fn clones_and_equal_length_replacements_never_share_an_incremental_lineage() {
    let mut log = Log::new();
    log.receive([genesis(&log, 1)]);
    let mut fork = log.clone();
    assert_eq!(log.revision(), fork.revision(), "unchanged clones describe the same contents");
    assert_ne!(log.lineage(), fork.lineage(), "they may diverge on their next append");
    log.receive([genesis(&log, 2)]);
    fork.receive([genesis(&fork, 3)]);
    assert_eq!(log.ids().len(), fork.ids().len());
    assert_ne!(log.revision(), fork.revision());
    let restored = Log::from_edits(fork.edits().to_vec());
    assert_ne!(log.revision(), restored.revision());
    assert_ne!(fork.lineage(), restored.lineage());
}
