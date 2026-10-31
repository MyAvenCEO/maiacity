//! A Doc on a peer's shelf (`aven_db_docs::Shelf`, A185), on the store's memory backend: envelopes kept by hash, the held
//! page and the head read back as they were saved, a Doc never held reads as nothing, and a ref moved by a second
//! writer is refused, never written over.

use std::sync::Arc;

use aven_core::{DocId, Hash, Value};
use aven_db_docs::{Saved, Shelf};
use aven_db_store::{RefName, Store, backend};

fn doc(n: u8) -> DocId {
    DocId(Hash([n; 32]))
}

#[tokio::test]
async fn a_doc_reads_back_as_it_was_saved() {
    let store = Arc::new(backend::memory().unwrap());
    let shelf = Shelf::new(store.clone());
    assert_eq!(shelf.load(&doc(1)).await.unwrap().held, None);

    let e = shelf.put(b"an envelope".to_vec()).await.unwrap();
    assert_eq!(
        shelf.get(&e).await.unwrap().as_deref(),
        Some(&b"an envelope"[..])
    );

    let held = Value::Map(vec![("doc".into(), Value::Bytes(vec![1; 32]))]);
    let head = Value::Map(vec![("doc".into(), Value::Bytes(vec![2; 32]))]);
    let mut saved = Saved::default();
    shelf.save(&doc(1), &mut saved, &held, &head).await.unwrap();
    let back = shelf.load(&doc(1)).await.unwrap();
    assert_eq!(
        (back.held.as_ref(), back.head.as_ref()),
        (Some(&held), Some(&head))
    );
    assert_eq!(back.saved, saved);
    // another Doc's refs are its own
    assert_eq!(shelf.load(&doc(2)).await.unwrap().head, None);

    // saving again from where it was moves it; the same Values again change nothing
    let head2 = Value::Map(vec![("doc".into(), Value::Bytes(vec![3; 32]))]);
    shelf
        .save(&doc(1), &mut saved, &held, &head2)
        .await
        .unwrap();
    shelf
        .save(&doc(1), &mut saved, &held, &head2)
        .await
        .unwrap();
    assert_eq!(shelf.load(&doc(1)).await.unwrap().head, Some(head2.clone()));

    // a second writer moved the head: this peer's next save is refused, and the second writer's head stays
    let other = store
        .put(aven_core::encode(&Value::Null).into())
        .await
        .unwrap();
    let name = RefName::new(format!("doc-{}", "01".repeat(32))).unwrap();
    store.set_ref(&name, saved.head, other).await.unwrap();
    let why = shelf
        .save(&doc(1), &mut saved, &held, &head)
        .await
        .unwrap_err();
    assert!(why.contains("second writer"), "{why}");
    assert_eq!(store.get_ref(&name).await.unwrap(), Some(other));
}
