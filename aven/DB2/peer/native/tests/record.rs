//! The one record every peer keeps through its store: its first start, as a blob and the ref `first-start`. A
//! restart finds the same record; an empty store (a wipe) gets a new one.
#![cfg(feature = "native")]

use aven_db_store::{RefName, Store, backend};
use aven_peer::record;

async fn restart_keeps_it(store: &impl Store) {
    let first = record::first_start(store, "alice-peer", 1_000)
        .await
        .unwrap();
    assert!(!first.kept);
    assert_eq!(first.first, 1_000);

    // a restart, later: the same record, kept
    let again = record::first_start(store, "alice-peer", 9_000)
        .await
        .unwrap();
    assert!(again.kept);
    assert_eq!(again.first, 1_000);
    assert_eq!(again.blob, first.blob);

    // a blob and a ref, nothing else
    assert_eq!(store.list().await.unwrap(), vec![first.blob]);
    assert_eq!(
        store.list_refs().await.unwrap(),
        vec![RefName::new(record::REF).unwrap()]
    );
    let bytes = store.get(&first.blob).await.unwrap().unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(
        v,
        serde_json::json!({ "peer": "alice-peer", "first": 1_000 })
    );
}

#[tokio::test]
async fn memory_keeps_the_record() {
    restart_keeps_it(&backend::memory().unwrap()).await;
}

#[tokio::test]
async fn a_folder_keeps_it_across_stores_and_a_wipe_empties_it() {
    let dir = std::env::temp_dir().join(format!("aven-peer-record-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    restart_keeps_it(&backend::fs(&dir).unwrap()).await;

    // a new process opens the same folder: the record is still there
    let reopened = record::first_start(&backend::fs(&dir).unwrap(), "alice-peer", 20_000)
        .await
        .unwrap();
    assert!(reopened.kept);
    assert_eq!(reopened.first, 1_000);

    // wiped, the next start writes a new record
    std::fs::remove_dir_all(&dir).unwrap();
    std::fs::create_dir_all(&dir).unwrap();
    let fresh = record::first_start(&backend::fs(&dir).unwrap(), "alice-peer", 30_000)
        .await
        .unwrap();
    assert!(!fresh.kept);
    assert_eq!(fresh.first, 30_000);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[tokio::test]
async fn a_ref_to_a_missing_blob_is_corrupt() {
    let store = backend::memory().unwrap();
    let gone = store.put(bytes::Bytes::from_static(b"{}")).await.unwrap();
    store.delete(&gone).await.unwrap();
    store
        .set_ref(&RefName::new(record::REF).unwrap(), None, gone)
        .await
        .unwrap();
    assert!(record::first_start(&store, "alice-peer", 1).await.is_err());
}

#[test]
fn the_line_names_the_store() {
    let r = record::Record {
        first: 7,
        blob: aven_db_store::Hash::of(b"x"),
        kept: true,
    };
    let line: serde_json::Value =
        serde_json::from_str(&record::line(8, "aven-peer", "s3", &r)).unwrap();
    assert_eq!(line["event"], "stored");
    assert_eq!(line["store"], "s3");
    assert_eq!(line["first"], 7);
    assert_eq!(line["kept"], true);
    assert_eq!(line["blob"], aven_db_store::Hash::of(b"x").to_hex());
}
