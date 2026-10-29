//! The conformance suite on a folder, and what a crash mid-write leaves there.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

use aven_db_store::{Hash, RefName, Store, backend, conformance};
use bytes::Bytes;

fn fresh_dir() -> PathBuf {
    static N: AtomicU32 = AtomicU32::new(0);
    let dir = std::env::temp_dir().join(format!("aven-db-store-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[tokio::test]
async fn fs_passes_the_suite() {
    let report = conformance::run(async || backend::fs(&fresh_dir()).unwrap()).await;
    println!("{report}");
    assert!(report.passed());
}

#[tokio::test]
async fn a_folder_store_survives_a_restart() {
    let dir = fresh_dir();
    let head = RefName::new("head").unwrap();
    let hash = backend::fs(&dir).unwrap().put(Bytes::from_static(b"kept")).await.unwrap();
    backend::fs(&dir).unwrap().set_ref(&head, None, hash).await.unwrap();
    let again = backend::fs(&dir).unwrap();
    assert_eq!(again.get(&hash).await.unwrap().unwrap(), Bytes::from_static(b"kept"));
    assert_eq!(again.get_ref(&head).await.unwrap(), Some(hash));
}

/// A crash mid-write leaves a partial file in `.tmp`, never in place: the store reads on as before.
#[tokio::test]
async fn a_crash_mid_write_corrupts_nothing() {
    let dir = fresh_dir();
    let store = backend::fs(&dir).unwrap();
    let head = RefName::new("head").unwrap();
    let hash = store.put(Bytes::from_static(b"whole")).await.unwrap();
    store.set_ref(&head, None, hash).await.unwrap();
    // what a writer killed halfway through its next writes leaves
    std::fs::write(dir.join(".tmp").join("partial-blob"), b"who").unwrap();
    std::fs::write(dir.join(".tmp").join("partial-ref"), &hash.to_hex()[..20]).unwrap();
    let store = backend::fs(&dir).unwrap();
    assert_eq!(store.list().await.unwrap(), vec![hash]);
    assert_eq!(store.list_refs().await.unwrap(), vec![head.clone()]);
    assert_eq!(store.get_ref(&head).await.unwrap(), Some(hash));
    assert_eq!(store.get(&hash).await.unwrap().unwrap(), Bytes::from_static(b"whole"));
}

/// Bytes changed on disk behind the store's back are caught when the blob is read whole.
#[tokio::test]
async fn a_blob_changed_on_disk_reads_as_corrupt() {
    let dir = fresh_dir();
    let store = backend::fs(&dir).unwrap();
    let hash = store.put(Bytes::from_static(b"original")).await.unwrap();
    std::fs::write(dir.join("blobs").join(hash.to_hex()), b"tampered").unwrap();
    assert!(matches!(store.get(&hash).await, Err(aven_db_store::Error::Corrupt(_))));
    assert_ne!(Hash::of(b"tampered"), hash);
}
