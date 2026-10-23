//! The main Mac listener follows an existing account's lifecycle; neither settings nor failure replace its identity.
use super::*;
use avendb_net::transports::WtConfig;
use std::net::UdpSocket;

fn config(dir: &Path, bind: SocketAddr) -> Config {
    Config {
        dir: dir.to_path_buf(),
        direct: false,
        volumes: None,
        webtransport: Some(WtConfig {
            bind,
            public_url: format!("https://127.0.0.1:{}/avendb", bind.port()),
            allowed_origins: vec!["https://maia.city".into()],
        }),
    }
}

#[tokio::test]
async fn malformed_listener_is_rejected_before_opening_the_account_folder() {
    let folder = Folder::new("wt-invalid");
    let dir = folder.0.join("unopened");
    let mut invalid = config(&dir, LOOPBACK);
    invalid.webtransport.as_mut().unwrap().allowed_origins = vec!["*".into()];
    assert!(host(invalid).is_err());
    assert!(
        !dir.exists(),
        "invalid network configuration does not touch account storage"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn listener_reopens_the_same_mac_and_bind_failure_keeps_its_existing_account() {
    tokio::time::timeout(Duration::from_secs(90), async {
        let (relay, url, server) = server().await;
        let folder = Folder::new("wt-existing");
        let mut original = InApp::start(&folder.0, Passkey::from_seed([5; 32]));
        let found = original
            .call(
                "found",
                json!(["Eve's existing Mac", url.to_string(), server.offer().to_text()]),
            )
            .await;
        let identity = found["ok"]["id"].clone();
        assert!(identity.is_string(), "{found}");
        let mine = original.call("run", json!([{ "op":"world" }])).await["ok"]["ok"]["mine"].clone();
        let write =
            json!({ "op":"create", "vault":mine, "type":"note", "value":titled("Kept", "existing vault contents") });
        let made = original.call("run", json!([write])).await;
        let entry = made["ok"]["ok"]["entry"].clone();
        assert!(entry.is_string(), "{made}");
        original.host.close().await;
        drop(original);

        let occupied = UdpSocket::bind(LOOPBACK).unwrap();
        let bind = occupied.local_addr().unwrap();
        let mut app = InApp::with(config(&folder.0, bind), Passkey::from_seed([5; 32]));
        let opened = app.call("open", json!([])).await;
        assert_eq!(
            opened["ok"]["id"], identity,
            "bind failure must not fail the account unlock: {opened}"
        );
        let retained = app
            .host
            .node()
            .expect("node runs despite unavailable optional listener");
        assert!(retained.on_relay().await, "existing relay fallback remains active");
        let read = app.call("run", json!([{ "op":"get", "entry":entry }])).await;
        assert_eq!(read["ok"]["ok"]["record"]["title"], "Kept");
        let old_writer = retained.writer_shelf().expect("the original node writer");
        drop(occupied);
        app.host.close().await;
        assert!(old_writer.put("tests/late", Bytes::from_static(b"must not write")).await.is_err());
        // Keep the old closed OpenNode alive: listener teardown must not rely on dropping its final Arc.
        let reopened = app.call("open", json!([])).await;
        assert_eq!(
            reopened["ok"]["id"], identity,
            "same stored device after optional listener becomes available"
        );
        assert!(UdpSocket::bind(bind).is_err(), "configured listener now owns its port");
        assert_eq!(
            app.call("open", json!([])).await,
            reopened,
            "opening an already open device installs no duplicate listener"
        );
        let live = app.host.node().unwrap();
        app.host.close().await;
        assert!(live.endpoint().is_closed());
        drop(UdpSocket::bind(bind).expect("shutdown releases socket even while the closed node is retained"));
        let reopened = app.call("open", json!([])).await;
        assert_eq!(reopened["ok"]["id"], identity);
        assert!(
            UdpSocket::bind(bind).is_err(),
            "next opening reinstalls the main-node listener"
        );
        let read = app.call("run", json!([{ "op":"get", "entry":entry }])).await;
        assert_eq!(
            read["ok"]["ok"]["record"]["title"], "Kept",
            "existing vault data remains readable"
        );
        drop((retained, live));
        app.host.close().await;
        drop(UdpSocket::bind(bind).expect("final listener closed"));
        server.shutdown().await.unwrap();
        relay.shutdown().await.unwrap();
    })
    .await
    .expect("optional listener preserves account and shuts down within its deadline");
}
