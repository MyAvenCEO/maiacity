//! Native startup ownership at the private lifecycle and publication boundaries.
//! Every shelf and key here belongs to a disposable, offline fixture.
use super::*;
use avendb::cast::{document, world};
use avendb_net::shelf::FLOOR;
use std::future::Future as _;
use std::task::Poll;

struct Folder(PathBuf);
impl Folder {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        #[cfg(target_os = "macos")]
        let root = PathBuf::from("/tmp");
        #[cfg(not(target_os = "macos"))]
        let root = std::env::temp_dir();
        let folder = Self(root.join(format!(
            "avendb-startup-{}-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos(),
        )));
        std::fs::create_dir(&folder.0).unwrap();
        folder
    }
    fn host(&self) -> (Host, Lines) {
        host(Config {
            dir: self.0.clone(),
            direct: false,
            volumes: None,
            webtransport: None,
        })
        .unwrap()
    }
}
impl Drop for Folder {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn open_queued_before_close_rechecks_admission_after_lifecycle_mutex() {
    let folder = Folder::new();
    let (host, mut sheets) = folder.host();
    let service = host.service.clone();
    let life = service.life.lock().await;
    let mut opening = Box::pin(service.open());
    // Unlike scheduling a public Host call, this first poll deterministically
    // places Service::open on the lifecycle mutex before close begins.
    std::future::poll_fn(|cx| {
        assert!(opening.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    let mut closing = Box::pin(host.close());
    std::future::poll_fn(|cx| {
        assert!(closing.as_mut().poll(cx).is_pending());
        Poll::Ready(())
    })
    .await;
    assert!(service.closing.load(Ordering::Acquire));
    drop(life);
    let error = tokio::time::timeout(Duration::from_secs(30), opening)
        .await
        .unwrap()
        .unwrap_err();
    assert!(error.to_string().contains("closing or closed"), "{error:#}");
    tokio::time::timeout(Duration::from_secs(30), closing)
        .await
        .unwrap()
        .unwrap();
    assert!(
        sheets.try_recv().is_err(),
        "a queued open never starts a ceremony"
    );
    assert!(host.node().is_none());
    let writer = service.shelf().writer().unwrap();
    writer.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_provisional_save_retains_owner_after_constructor_and_host_close_fail() {
    let folder = Folder::new();
    let (host, _sheets) = folder.host();
    let service = host.service.clone();
    // Exercise the actual synchronous observer constructed for native startup.
    // The URL is syntax only: this fixture Node has no relay and no peers.
    let (start, ending, starting) = service.start("Unpublished", "http://127.0.0.1:1").unwrap();
    let reader = service.shelf();
    let mut w = world();
    let me = w.mac_a;
    let node = Arc::new(
        Node::spawn(
            w.lab.split(me, &[], [91; 32]),
            me,
            Options {
                shelf: Some(reader.clone()),
                ..Options::local()
            },
        )
        .await
        .unwrap(),
    );
    start
        .on_node
        .as_ref()
        .expect("native startup observes every spawned node")(node.clone());
    assert!(host.node().is_none());
    assert!(Arc::ptr_eq(
        starting.lock().unwrap().as_ref().unwrap(),
        &node
    ));
    assert_eq!(service.provisional.lock().unwrap().len(), 1);
    assert!(reader.writer().is_err());
    tokio::time::timeout(Duration::from_secs(30), async {
        while node.behind().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();

    // A failed final save must never be mistaken for a completed disk fence.
    // Only this fixture's staging directory is withheld; the original directory
    // is restored below, without deleting a generation or authoritative data.
    let dir = folder.0.join(format!("g{FLOOR}"));
    std::fs::rename(dir.join("new"), dir.join("staging-held")).unwrap();
    node.try_act(|lab, me| {
        let vault = lab.vault_of(me).unwrap();
        lab.create(
            me,
            vault,
            vault,
            "note",
            &[],
            document("Pending", "Unsaved startup", me),
        )
    })
    .await
    .unwrap()
    .unwrap();
    let failed = tokio::time::timeout(
        Duration::from_secs(30),
        service.finish_start::<()>(Err(anyhow!("injected constructor failure")), &starting),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(format!("{failed:#}").contains("its node could not durably close"));
    assert_eq!(service.provisional.lock().unwrap().len(), 1);

    // Remove every constructor/test-owned strong Node reference, including the
    // observer's captured per-start slot. Only the Service registry may own it.
    let retained = Arc::downgrade(&node);
    drop(node);
    drop(starting);
    drop(start);
    drop(ending);
    assert!(
        retained.upgrade().is_some(),
        "failed startup keeps its unpublished node"
    );
    let first = tokio::time::timeout(Duration::from_secs(30), host.close())
        .await
        .unwrap()
        .unwrap_err()
        .to_string();
    assert!(first.contains("provisional nodes did not close"), "{first}");
    assert_eq!(host.close().await.unwrap_err().to_string(), first);
    assert!(host.node().is_none());
    assert!(host.call("open", vec![]).await.get("error").is_some());
    assert!(
        retained.upgrade().is_some(),
        "failed Host close retains the unpublished owner"
    );
    assert!(
        reader.writer().is_err(),
        "another writer cannot overlap failed persistence"
    );
    assert_eq!(service.provisional.lock().unwrap().len(), 1);
    std::fs::rename(dir.join("staging-held"), dir.join("new")).unwrap();
}
