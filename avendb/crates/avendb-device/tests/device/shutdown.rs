//! Quit uses the app's actual runtime-stop guard and disposable software-key stores.
use super::*;
use std::sync::{Arc, Condvar, Mutex};
use tokio::sync::oneshot;

// This small Tauri-free module is the production app guard. Testing it here
// exercises cancellation without linking AppKit or launching the installed app.
#[path = "../../../../../vault/app/src/avendb_shutdown.rs"]
mod app_shutdown;
use app_shutdown::RuntimeStop;

struct Release(Arc<(Mutex<bool>, Condvar)>);
impl Release {
    fn release(&self) {
        *self.0.0.lock().unwrap() = true;
        self.0.1.notify_all();
    }
}
impl Drop for Release {
    fn drop(&mut self) {
        self.release();
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn delayed_admitted_write_survives_five_seconds_and_cancelled_quit_waiter() {
    let (relay, url, server) = server().await;
    let folder = Folder::new("shutdown-delayed");
    let mut app = InApp::start(&folder.0, Passkey::from_seed([5; 32]));
    let found = app
        .call(
            "found",
            json!(["Eve's Mac", url.to_string(), server.offer().to_text()]),
        )
        .await;
    assert!(found["ok"]["id"].is_string(), "{found}");
    let node = app.host.node().unwrap();
    let reader = disk::open(&folder.0).unwrap();
    let gate = Release(Arc::new((Mutex::new(false), Condvar::new())));
    let (entered, started) = oneshot::channel();
    let (made, entry) = oneshot::channel();
    let mutation = tokio::spawn({
        let node = node.clone();
        let gate = gate.0.clone();
        async move {
            node.try_act(move |lab, me| {
                entered.send(()).unwrap();
                let mut ready = gate.0.lock().unwrap();
                while !*ready {
                    ready = gate.1.wait(ready).unwrap();
                }
                let vault = lab.vault_of(me).unwrap();
                let id = lab
                    .create(
                        me,
                        vault,
                        vault,
                        "note",
                        &[],
                        document("Note", "Kept after quit", me),
                    )
                    .unwrap();
                made.send(id).unwrap();
            })
            .await
        }
    });
    started.await.unwrap();
    mutation.abort();

    let (quit, mut quitting) = oneshot::channel();
    let (ended, end) = oneshot::channel();
    let guard = Arc::new(tokio::sync::Mutex::new(RuntimeStop::new(quit, end)));
    let first = tokio::spawn({
        let host = app.host.clone();
        let guard = guard.clone();
        async move {
            guard
                .lock()
                .await
                .finish(async { host.close().await.map_err(|e| e.to_string()) })
                .await
        }
    });
    tokio::time::timeout(Duration::from_secs(10), async {
        while app.host.node().is_some() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    first.abort();
    assert!(first.await.unwrap_err().is_cancelled());
    assert!(
        matches!(
            quitting.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ),
        "cancellation retains the runtime stop signal"
    );
    assert!(
        reader.writer().is_err(),
        "the admitted mutation still owns its store"
    );
    assert!(
        app.host.call("open", vec![]).await.get("error").is_some(),
        "quit cannot start a replacement device"
    );

    let next = tokio::spawn({
        let host = app.host.clone();
        let guard = guard.clone();
        async move {
            guard
                .lock()
                .await
                .finish(async { host.close().await.map_err(|e| e.to_string()) })
                .await
        }
    });
    tokio::time::sleep(Duration::from_millis(5_250)).await;
    assert!(
        !next.is_finished(),
        "five seconds warns; it cannot cancel admitted persistence"
    );
    assert!(matches!(
        quitting.try_recv(),
        Err(oneshot::error::TryRecvError::Empty)
    ));
    assert!(reader.writer().is_err());
    gate.release();
    let entry = entry.await.unwrap();
    tokio::time::timeout(Duration::from_secs(30), &mut quitting)
        .await
        .unwrap()
        .unwrap();
    ended.send(()).unwrap();
    next.await.unwrap().unwrap();
    app.host.close().await.unwrap();
    // Reopening must use the admitted write on disk, with no surviving peer
    // available to supply it. Keep the old Host and OpenNode handles alive too.
    server.shutdown().await.unwrap();
    relay.shutdown().await.unwrap();
    let mut replacement = InApp::start(&folder.0, Passkey::from_seed([5; 32]));
    let opened = replacement.call("open", json!([])).await;
    assert_eq!(opened["ok"]["id"], found["ok"]["id"]);
    let read = replacement
        .call("run", json!([{ "op":"get", "entry":hex(&entry.0) }]))
        .await;
    let record = &read["ok"]["ok"]["record"];
    assert_eq!(record["title"], "Note", "{read}");
    assert_eq!(record["blocks"][1]["text"], "Kept after quit", "{read}");
    replacement.host.close().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_host_close_reports_same_error_and_keeps_runtime_and_writer() {
    let (relay, url, server) = server().await;
    let folder = Folder::new("shutdown-failure");
    let mut app = InApp::start(&folder.0, Passkey::from_seed([5; 32]));
    let found = app
        .call(
            "found",
            json!(["Eve's Mac", url.to_string(), server.offer().to_text()]),
        )
        .await;
    assert!(found["ok"]["id"].is_string(), "{found}");
    let node = app.host.node().unwrap();
    tokio::time::timeout(Duration::from_secs(30), async {
        while node.behind().await {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let reader = disk::open(&folder.0).unwrap();
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
            document("Note", "Pending", me),
        )
    })
    .await
    .unwrap()
    .unwrap();
    let (quit, mut quitting) = oneshot::channel();
    let (_ended, end) = oneshot::channel();
    let mut runtime = RuntimeStop::new(quit, end);
    let first = tokio::time::timeout(
        Duration::from_secs(30),
        runtime.finish(async { app.host.close().await.map_err(|e| e.to_string()) }),
    )
    .await
    .unwrap()
    .unwrap_err();
    assert!(!first.is_empty());
    let again = app.host.close().await.unwrap_err().to_string();
    assert_eq!(again, first, "all waiters see the original failed fence");
    assert!(
        matches!(
            quitting.try_recv(),
            Err(oneshot::error::TryRecvError::Empty)
        ),
        "failure must keep the runtime alive"
    );
    assert!(app.host.node().is_none());
    assert!(app.host.call("open", vec![]).await.get("error").is_some());
    drop(node);
    assert!(
        reader.writer().is_err(),
        "the Host, not a test OpenNode, retains its failed owner"
    );
    std::fs::rename(dir.join("staging-held"), dir.join("new")).unwrap();
    server.shutdown().await.unwrap();
    relay.shutdown().await.unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn quitting_cancels_second_ceremony_and_drains_unpublished_store() {
    let (relay, url, server) = server().await;
    let folder = Folder::new("shutdown-ceremony");
    let mut app = InApp::start(&folder.0, Passkey::from_seed([5; 32]));
    let founding = tokio::spawn({
        let host = app.host.clone();
        let offer = server.offer().to_text();
        async move {
            host.call(
                "found",
                vec![json!("Eve's Mac"), json!(url.to_string()), json!(offer)],
            )
            .await
        }
    });
    let first = tokio::time::timeout(Duration::from_secs(30), app.sheets.recv())
        .await
        .unwrap()
        .unwrap();
    let asked = asked_in(first["url"].as_str().unwrap());
    assert_eq!(asked["what"], "unlock");
    app.host.answer(&sheet_page(
        &mut app.passkey,
        first["sheet"].as_u64().unwrap(),
        &asked,
    ));

    // The first sheet unlocks keys. The second comes only after Node::spawn,
    // while the founding transaction still owns the lifecycle mutex and has
    // not published a Device. An initial-sheet test misses this owner entirely.
    let second = tokio::time::timeout(Duration::from_secs(60), app.sheets.recv())
        .await
        .unwrap()
        .unwrap();
    let asked = asked_in(second["url"].as_str().unwrap());
    assert_eq!(asked["what"], "found");
    assert!(
        app.host.node().is_none(),
        "the provisional node is not published"
    );
    let reader = disk::open(&folder.0).unwrap();
    assert!(
        reader.writer().is_err(),
        "the provisional node already owns its store"
    );
    let late_answer = sheet_page(&mut app.passkey, second["sheet"].as_u64().unwrap(), &asked);

    // Poll the public call before close: it is pending behind founding, rather
    // than being a new request sent after the host is already closed. The
    // private queued-open test separately proves the exact mutex boundary.
    let mut opening = Box::pin(app.host.call("open", vec![]));
    std::future::poll_fn(|cx| {
        assert!(opening.as_mut().poll(cx).is_pending());
        std::task::Poll::Ready(())
    })
    .await;
    let (quit, mut quitting) = oneshot::channel();
    let (ended, end) = oneshot::channel();
    let closing = tokio::spawn({
        let host = app.host.clone();
        async move {
            RuntimeStop::new(quit, end)
                .finish(async { host.close().await.map_err(|e| e.to_string()) })
                .await
        }
    });
    tokio::time::timeout(Duration::from_secs(30), &mut quitting)
        .await
        .unwrap()
        .unwrap();
    let found = tokio::time::timeout(Duration::from_secs(30), founding)
        .await
        .unwrap()
        .unwrap();
    let opened = tokio::time::timeout(Duration::from_secs(30), opening)
        .await
        .unwrap();
    assert!(
        found.get("error").is_some(),
        "the unanswered founding ceremony was cancelled"
    );
    assert!(
        opened.get("error").is_some(),
        "the queued open cannot start another ceremony"
    );
    assert!(app.host.node().is_none());
    let writer = reader
        .writer()
        .expect("runtime quit is sent only after the provisional store is released");
    writer.shutdown().await.unwrap();
    ended.send(()).unwrap();
    closing.await.unwrap().unwrap();
    app.host.close().await.unwrap();

    // A genuine but late answer to the cancelled sheet must not resurrect the
    // startup, publish its Node, or open a new sheet on this terminal host.
    app.host.answer(&late_answer);
    assert!(app.host.node().is_none());
    assert!(app.sheets.try_recv().is_err());
    assert!(app.host.call("open", vec![]).await.get("error").is_some());
    server.shutdown().await.unwrap();
    relay.shutdown().await.unwrap();
}
