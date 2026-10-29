//! The log's one head (`ShelfIndex.lean`, "The log's one head"): what everything worked out of a log is stamped with.
//! It changes only with the edits the log holds, in their order, never enters persisted edits, and names a prefix of
//! the log only while the log goes on from it.
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
fn the_head_changes_only_with_the_edits_and_stops_naming_a_prefix_withdrawn() {
    let mut log = Log::new();
    let initial = log.head();
    let edit = genesis(&log, 1);
    let bytes = edit.to_wire();
    log.receive([edit.clone()]);
    let received = log.head();
    assert_ne!(initial, received);
    assert!(log.of_log(initial), "the empty prefix is of every log");
    log.receive([edit.clone()]);
    log.let_go(&[EditId([255; 32])].into());
    assert_eq!(received, log.head(), "duplicates and unknown removals change nothing");
    assert_eq!(bytes, log.edits()[0].to_wire(), "heads never enter persisted edits");
    log.let_go(&[edit.id()].into());
    assert_ne!(received, log.head());
    assert!(!log.of_log(received), "a withdrawn edit's prefix is of the log no more");
    assert!(log.edits().is_empty());
}

#[test]
fn equal_length_replacements_never_share_a_head() {
    let mut log = Log::new();
    log.receive([genesis(&log, 1)]);
    let mut fork = log.clone();
    assert_eq!(log.head(), fork.head(), "a clone holds the same edits");
    let before = log.head();
    log.receive([genesis(&log, 2)]);
    fork.receive([genesis(&fork, 3)]);
    assert_eq!(log.ids().len(), fork.ids().len());
    assert_ne!(log.head(), fork.head());
    assert!(log.of_log(before) && fork.of_log(before), "both go on from the edit they share");
    assert!(!fork.of_log(log.head()), "the same count of other edits is no prefix");
    let restored = Log::from_edits(fork.edits().to_vec());
    assert_eq!(fork.head(), restored.head(), "the same edits in the same order, wherever they came from");
    assert_ne!(log.head(), restored.head());
}
