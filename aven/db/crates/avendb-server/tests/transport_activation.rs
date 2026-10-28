//! Late custom paths must carry the existing authenticated sync connection, not just become ready.
//! The in-memory adapter replaces only outer packet delivery; PQ TLS, exporter Hello and blob gates are real.
use avendb::cast::*;
use avendb_net::transports::{Carrier, Command, RouteId};
use avendb_net::{Admission, Node, Options};
use avendb_server::Relay;
use bytes::Bytes;
use n0_future::stream;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicBool, AtomicUsize, Ordering},
};
use std::time::Duration;

async fn until(what: &str, mut check: impl AsyncFnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(15), async {
        while !check().await {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what}"));
}

fn event(id: &RouteId, kind: &str) -> Value {
    json!({"kind":kind,"route":id.route,"epoch":id.epoch})
}

async fn opened(node: &Node) -> RouteId {
    match node.transport_next().await.expect("live carrier broker") {
        Command::Open {
            id,
            carrier: Carrier::WebRtc,
            ..
        } => id,
        command => panic!("expected authenticated RTC negotiation, got {command:?}"),
    }
}

fn pump(
    from: Arc<Node>,
    local: RouteId,
    to: Arc<Node>,
    remote: RouteId,
    bytes: Arc<AtomicUsize>,
    closed: Arc<AtomicBool>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(command) = from.transport_next().await {
            match command {
                Command::Send { id, bytes: packet } => {
                    assert_eq!(id, local, "the originally negotiated route is retained");
                    assert!(packet.len() <= 512, "outer MTU bounds every fragment");
                    if to.transport_receive(&remote, &packet) {
                        bytes.fetch_add(packet.len(), Ordering::Relaxed);
                    }
                }
                Command::Close { id } => {
                    assert_eq!(id, local);
                    closed.store(true, Ordering::Relaxed);
                    break;
                }
                command => panic!("unexpected replacement or signaling: {command:?}"),
            }
        }
    })
}

async fn peer(node: &Node) -> Value {
    let network = node.network().await;
    let peers = network["peers"].as_array().expect("network peers");
    assert_eq!(peers.len(), 1, "exactly the original authenticated sync peer");
    peers[0].clone()
}
fn selected(peer: &Value, way: &str) -> bool {
    peer["paths"]
        .as_array()
        .unwrap()
        .iter()
        .any(|p| p["way"] == way && p["selected"] == true)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn late_negotiated_custom_path_keeps_live_sync_and_gated_blobs_after_relay_stops() {
    let mut stage = "spawn peers";
    let opened_finished = [AtomicBool::new(false), AtomicBool::new(false)];
    let mut diagnostic_nodes: Option<(Arc<Node>, Arc<Node>)> = None;
    let result = tokio::time::timeout(Duration::from_secs(65), async {
        let admission = Admission::default();
        let relay = Relay::spawn("127.0.0.1:0".parse().unwrap(), admission.clone())
            .await
            .unwrap();
        let mut world = world();
        let coop = handbook_ready(&mut world);
        let (a, b) = (world.mac_a, world.phone_a);
        let opts = Options {
            bind: None,
            relay: Some(relay.url()),
            lazy: true,
            keep: false,
            ..Options::local()
        };
        let mac = Arc::new(
            Node::spawn(
                world.lab.split(a, &[], [191; 32]),
                a,
                Options {
                    admission: Some(admission.clone()),
                    ..opts.clone()
                },
            )
            .await
            .unwrap(),
        );
        let phone = Arc::new(Node::spawn(world.lab.split(b, &[], [192; 32]), b, opts).await.unwrap());
        diagnostic_nodes = Some((mac.clone(), phone.clone()));
        for node in [&mac, &phone] {
            node.gate(true).await.unwrap();
            assert!(node.addr().ip_addrs().next().is_none(), "no IP bypass");
        }
        assert!(
            admission.admits(&mac.id()) && admission.admits(&phone.id()),
            "the owned relay admits both authenticated fixture devices"
        );
        stage = "relay registration";
        until("both nodes home on the owned relay", async || {
            mac.on_relay().await && phone.on_relay().await
        })
        .await;
        mac.know(phone.addr());
        phone.know(mac.addr());
        stage = "initial sync";
        phone.sync_with(mac.id()).await.unwrap();
        assert_eq!(phone.proven(mac.id()), Some(a));
        assert_eq!(mac.proven(phone.id()), Some(b));
        let before = [peer(&mac).await, peer(&phone).await];
        assert!(before.iter().all(|p| selected(p, "relay")), "sync initially uses relay");
        let dials = [mac.dials(), phone.dials()];

        let (initiator, responder) = if mac.id() < phone.id() {
            (&mac, &phone)
        } else {
            (&phone, &mac)
        };
        for node in [responder, initiator] {
            node.transport_event(json!({"kind":"capabilities","webtransport":false,"webrtc":true}))
                .await
                .unwrap();
        }
        stage = "negotiate custom routes";
        let (mac_route, phone_route) = tokio::join!(
            async {
                let route = opened(&mac).await;
                opened_finished[0].store(true, Ordering::Relaxed);
                route
            },
            async {
                let route = opened(&phone).await;
                opened_finished[1].store(true, Ordering::Relaxed);
                route
            },
        );
        let sent = Arc::new(AtomicUsize::new(0));
        let closed = Arc::new(AtomicBool::new(false));
        let outgoing = pump(
            mac.clone(),
            mac_route.clone(),
            phone.clone(),
            phone_route.clone(),
            sent.clone(),
            closed.clone(),
        );
        let incoming = pump(
            phone.clone(),
            phone_route.clone(),
            mac.clone(),
            mac_route.clone(),
            sent.clone(),
            closed.clone(),
        );
        for (node, route) in [(&mac, &mac_route), (&phone, &phone_route)] {
            let mut ready = event(route, "ready");
            ready["mtu"] = json!(512);
            node.transport_event(ready).await.unwrap();
        }
        stage = "validate custom path";
        until(
            "custom path validates and becomes selected on the already-live sync peers",
            async || {
                sent.load(Ordering::Relaxed) > 0
                    && selected(&peer(&mac).await, "other")
                    && selected(&peer(&phone).await, "other")
            },
        )
        .await;
        assert!(
            !closed.load(Ordering::Relaxed),
            "negotiated generation has not been replaced"
        );
        assert_eq!([mac.dials(), phone.dials()], dials, "no replacement sync dial");
        assert_eq!(
            [peer(&mac).await["since"].clone(), peer(&phone).await["since"].clone()],
            [before[0]["since"].clone(), before[1]["since"].clone()],
            "original sync peers remain"
        );

        stage = "stop relay";
        relay.shutdown().await.unwrap();
        let at_shutdown = sent.load(Ordering::Relaxed);
        stage = "create live edit";
        let entry = mac
            .act(move |lab, me| {
                lab.create(
                    me,
                    coop,
                    coop,
                    "doc",
                    &[],
                    document("Late carrier", "created after relay stopped", me),
                )
            })
            .await
            .unwrap();
        stage = "sync live edit after relay stopped";
        phone.sync_with(mac.id()).await.unwrap();
        assert_eq!(
            phone.read(move |lab, me| text(lab, me, entry, 2)).await.as_deref(),
            Some("created after relay stopped")
        );
        let file: Vec<u8> = (0..(1 << 20) + 113).map(|i| ((i * 7) % 251) as u8).collect();
        let source = || stream::iter([Ok::<_, std::io::Error>(Bytes::copy_from_slice(&file))]);
        stage = "store fixture file";
        let brought = mac.store_file(file.len() as u64, source).await.unwrap();
        let root = brought.root;
        stage = "attach fixture file";
        mac.act(move |lab, me| lab.bring(me, coop, entry, vec![brought], |_| {}))
            .await
            .unwrap();
        stage = "sync file authorization";
        phone.sync_with(mac.id()).await.unwrap();
        assert!(
            phone.read(move |lab, me| lab.file(me, &root).is_some()).await,
            "file authorization arrived over custom sync"
        );
        stage = "read gated file through custom path";
        assert_eq!(
            phone.read_file(root, 0..file.len() as u64).await.unwrap(),
            file,
            "fresh sealed bytes crossed the authenticated blob gate"
        );
        assert!(
            sent.load(Ordering::Relaxed) - at_shutdown > file.len(),
            "actual custom datagrams carry fresh blob, not only probes"
        );
        assert!(
            !closed.load(Ordering::Relaxed),
            "the original connection-bound carrier survives relay loss"
        );
        assert_eq!(
            [mac.dials(), phone.dials()],
            dials,
            "fresh sync reused its authenticated connection"
        );
        assert_eq!(
            [peer(&mac).await["since"].clone(), peer(&phone).await["since"].clone()],
            [before[0]["since"].clone(), before[1]["since"].clone()]
        );
        stage = "close custom routes";
        mac.transport_event(event(&mac_route, "closed")).await.unwrap();
        phone.transport_event(event(&phone_route, "closed")).await.unwrap();
        stage = "join packet pumps";
        outgoing.await.unwrap();
        incoming.await.unwrap();
        stage = "shut down Mac peer";
        mac.shutdown().await.unwrap();
        stage = "shut down phone peer";
        phone.shutdown().await.unwrap();
    })
    .await;
    if result.is_err() {
        eprintln!("activation timeout stage={stage} mac_opened={} phone_opened={}",
            opened_finished[0].load(Ordering::Relaxed), opened_finished[1].load(Ordering::Relaxed));
        if let Some((mac, phone)) = diagnostic_nodes {
            // Failure-only bounded observation, after the unchanged 65-second acceptance deadline.
            // All identities and addresses belong to this disposable local fixture.
            for (label, node, other) in [("mac", &mac, &phone), ("phone", &phone, &mac)] {
                let signer = other.device();
                let endpoint = *other.id().as_bytes();
                let snapshot = tokio::time::timeout(Duration::from_secs(1), async {
                    let known = node.read(move |lab, me| {
                        (lab.locked(me), lab.peers(me).iter().any(|(d, key)| *d == signer && *key == endpoint))
                    }).await;
                    (known, node.network().await)
                }).await;
                eprintln!("activation {label} (locked, signed_endpoint_known), network: {snapshot:?}");
            }
        }
    }
    assert!(result.is_ok(), "late custom path activation timed out during: {stage}");
}
