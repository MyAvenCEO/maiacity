//! Real folder/Node ownership: retained handles and cancelled callers cannot race
//! the old writer's blocking work or its final durable save. All stores are disposable.
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use avendb::cast::{document, human_on};
use avendb::lab::Lab;
use avendb_net::{Node, Options, disk, server};
use bytes::Bytes;

struct Folder(PathBuf);
impl Folder {
    fn new(label: &str) -> Self {
        let folder = Self(std::env::temp_dir().join(format!("avendb-lifecycle-{label}-{}", std::process::id())));
        assert!(!folder.0.exists(), "unique disposable fixture");
        folder
    }
}
impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test]
async fn cancelled_blocking_mutation_and_shutdown_waiter_keep_writer_until_real_completion() {
    let folder = Folder::new("cancelled");
    let reader = disk::open(&folder.0).unwrap();
    let node = Arc::new(server::open(reader.clone(), Options::local()).await.unwrap());
    let device = node.device();
    let shelf = node.writer_shelf().unwrap();
    shelf.put("test/history", Bytes::from_static(b"keep this")).await.unwrap();
    let gate = Arc::new((Mutex::new(false), Condvar::new()));
    let (entered, started) = tokio::sync::oneshot::channel();
    let mutation = tokio::spawn({
        let node = node.clone();
        let gate = gate.clone();
        async move {
            node.try_act(move |_, _| {
                entered.send(()).unwrap();
                let (lock, changed) = &*gate;
                let mut ready = lock.lock().unwrap();
                while !*ready {
                    ready = changed.wait(ready).unwrap();
                }
            })
            .await
        }
    });
    started.await.unwrap();
    mutation.abort();
    let waiter = tokio::spawn({
        let node = node.clone();
        async move { node.shutdown().await }
    });
    // Observe the synchronous admission transition without depending on a sleep.
    loop {
        if node.try_know(node.endpoint().addr()).is_err() {
            break;
        }
        tokio::task::yield_now().await;
    }
    waiter.abort();
    assert!(reader.writer().is_err(), "a cancelled waiter cannot release an admitted blocking mutation");
    assert!(node.try_act(|_, _| ()).await.is_err());
    assert!(!node.on_relay().await, "closed nodes cannot admit relay retries");
    assert!(shelf.put("test/late", Bytes::new()).await.is_err());
    *gate.0.lock().unwrap() = true;
    gate.1.notify_all();
    tokio::time::timeout(Duration::from_secs(20), node.shutdown()).await.unwrap().unwrap();
    assert_eq!(node.read(|_, me| me).await, device, "retained closed reads are immutable");
    let replacement = server::open(reader.clone(), Options::local()).await.unwrap();
    assert_eq!(replacement.device(), device);
    assert_eq!(reader.get("test/history").await.unwrap().unwrap(), Bytes::from_static(b"keep this"));
    assert!(shelf.keep("slots/late", Bytes::new()).await.is_err(), "old handles cannot join the replacement writer");
    replacement.shutdown().await.unwrap();
}

#[tokio::test]
async fn failed_final_save_reports_failure_and_retains_lease_until_failed_node_is_dropped() {
    let folder = Folder::new("failure");
    let reader = disk::open(&folder.0).unwrap();
    let mut lab = Lab::new();
    let passkey = lab.passkey("Alice");
    let device = lab.device_of(passkey, "Mac");
    let vault = human_on(&mut lab, passkey, &[device]);
    let node = Node::spawn(
        lab.split(device, &[passkey], [47; 32]),
        device,
        Options { shelf: Some(reader.clone()), ..Options::local() },
    )
    .await
    .unwrap();
    tokio::time::timeout(Duration::from_secs(20), async {
        while node.behind().await {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let dir = folder.0.join(format!("g{}", avendb_net::shelf::FLOOR));
    // Inject a filesystem failure after the baseline has become durable. The next
    // authoritative journal/pack cannot create its staged object in this fixture.
    std::fs::rename(dir.join("new"), dir.join("staging-held")).unwrap();
    node.try_act(move |lab, me| lab.create(me, vault, vault, "note", &[], document("Note", "Unsaved", me)))
        .await
        .unwrap()
        .unwrap();
    assert!(node.shutdown().await.is_err(), "failed save is not successful shutdown");
    assert!(node.shutdown().await.is_err(), "every waiter sees the same failure");
    assert!(reader.writer().is_err(), "retained failed Node keeps the real root lock");
    assert!(node.try_act(|_, _| ()).await.is_err());
    std::fs::rename(dir.join("staging-held"), dir.join("new")).unwrap();
    drop(node);
    // Aborted background futures can release their last Shared reference on the
    // next executor turn. A failed node must retain the lease while held above;
    // after drop, require bounded eventual release rather than synchronous Drop.
    let owner = tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            match reader.writer() {
                Ok(owner) => break owner,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock =>
                    tokio::time::sleep(Duration::from_millis(5)).await,
                Err(error) => panic!("replacement writer: {error}"),
            }
        }
    }).await.expect("dropped failed node releases its writer lease");
    owner.shutdown().await.unwrap();
}
