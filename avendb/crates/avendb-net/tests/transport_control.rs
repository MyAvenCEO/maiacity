//! Authenticated optional-carrier negotiation over real avenDB sync connections.
//! The harness substitutes only outer packet delivery; TLS, Hello, policy and control messages are real.
use avendb::cast::*;
use avendb::sign::Hello;
use avendb::wire::Wire;
use avendb_net::transports::{Carrier, Command, RouteId};
use avendb_net::{ALPN, Node, Options, exporter};
use iroh::endpoint::Connection;
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::time::Duration;

async fn open(node: &Node) -> (RouteId, Value) {
    match tokio::time::timeout(Duration::from_secs(12), node.transport_next())
        .await
        .unwrap()
        .unwrap()
    {
        Command::Open {
            id,
            carrier: Carrier::WebRtc,
            descriptor,
        } => (id, descriptor),
        other => panic!("expected negotiated RTC open, got {other:?}"),
    }
}
fn event(id: &RouteId, kind: &str) -> Value {
    json!({"route":id.route,"epoch":id.epoch,"kind":kind})
}
fn forward(
    from: Arc<Node>,
    to: Arc<Node>,
    theirs: RouteId,
    packets: Arc<AtomicUsize>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(command) = from.transport_next().await {
            match command {
                Command::Send { bytes, .. } => {
                    assert!(
                        bytes.len() <= 512,
                        "the real QUIC packets are fragmented by negotiated MTU"
                    );
                    if to.transport_receive(&theirs, &bytes) {
                        packets.fetch_add(1, Ordering::Relaxed);
                    }
                }
                Command::Close { .. } => break,
                other => panic!("unexpected byte carrier command {other:?}"),
            }
        }
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn legacy_sync_negotiates_optional_carrier_and_survives_its_closure() {
    tokio::time::timeout(Duration::from_secs(35), async {
        let mut w = world();
        let coop = handbook_ready(&mut w);
        let (a, b) = (w.mac_a, w.phone_a);
        let options = Options {
            lazy: true,
            ..Options::local()
        };
        let mac = Arc::new(
            Node::spawn(w.lab.split(a, &[], [181; 32]), a, options.clone())
                .await
                .unwrap(),
        );
        let phone = Arc::new(
            Node::spawn(w.lab.split(b, &[], [182; 32]), b, options)
                .await
                .unwrap(),
        );
        phone.know(mac.addr());
        mac.know(phone.addr());
        phone.sync_with(mac.id()).await.unwrap();
        for node in [&mac, &phone] {
            assert!(
                tokio::time::timeout(Duration::from_millis(100), node.transport_next())
                    .await
                    .is_err(),
                "default legacy connection opens no optional carrier"
            );
        }
        let (initiator, responder) = if mac.id() < phone.id() {
            (&mac, &phone)
        } else {
            (&phone, &mac)
        };
        // The ordered responder cannot initiate while the other node's capabilities are still disabled.
        responder
            .transport_event(json!({"kind":"capabilities","webtransport":false,"webrtc":true}))
            .await
            .unwrap();
        initiator
            .transport_event(json!({"kind":"capabilities","webtransport":false,"webrtc":true}))
            .await
            .unwrap();
        let ((ir, offer), (rr, answer)) = tokio::join!(open(initiator), open(responder));
        assert_eq!(offer["initiator"], true);
        assert_eq!(answer["initiator"], false);
        let mut signal = event(&ir, "signal");
        signal["signal"] = json!({"candidate":null});
        initiator.transport_event(signal).await.unwrap();
        match tokio::time::timeout(Duration::from_secs(5), responder.transport_next())
            .await
            .unwrap()
            .unwrap()
        {
            Command::Signal { id, signal } => {
                assert_eq!(id, rr);
                assert_eq!(signal, json!({"candidate":null}));
            }
            other => panic!("expected authenticated signal, got {other:?}"),
        }
        let bytes = Arc::new(AtomicUsize::new(0));
        let pump_i = forward(
            initiator.clone(),
            responder.clone(),
            rr.clone(),
            bytes.clone(),
        );
        let pump_r = forward(
            responder.clone(),
            initiator.clone(),
            ir.clone(),
            bytes.clone(),
        );
        for (node, id) in [(initiator, &ir), (responder, &rr)] {
            let mut ready = event(id, "ready");
            ready["mtu"] = json!(512);
            node.transport_event(ready).await.unwrap();
        }
        // The path actor may retain its already-working IP route for the probe and subsequent sync.
        // This checks negotiation and fallback, not path selection; the custom-only integration checks
        // actual encrypted sync packets over a carrier. Keep the byte pump active for any selected traffic.
        let entry = mac
            .act(move |lab, me| {
                lab.create(
                    me,
                    coop,
                    coop,
                    "doc",
                    &[],
                    document("Negotiated", "same signed sync", me),
                )
            })
            .await
            .unwrap();
        phone.sync_with(mac.id()).await.unwrap();
        assert!(phone.read(move |lab, me| lab.fetched(me, entry) > 0).await);
        for (node, id) in [(initiator, &ir), (responder, &rr)] {
            node.transport_event(event(id, "closed")).await.unwrap();
        }
        pump_i.await.unwrap();
        pump_r.await.unwrap();
        for (node, id) in [(initiator, &ir), (responder, &rr)] {
            let mut stale = event(id, "ready");
            stale["mtu"] = json!(512);
            assert!(
                node.transport_event(stale).await.is_err(),
                "a late ready cannot resurrect a closed route"
            );
            assert!(!node.transport_receive(id, &[0; 100]));
        }
        let next = mac
            .act(move |lab, me| {
                lab.create(
                    me,
                    coop,
                    coop,
                    "doc",
                    &[],
                    document("Fallback", "old path still works", me),
                )
            })
            .await
            .unwrap();
        phone.sync_with(mac.id()).await.unwrap();
        assert!(phone.read(move |lab, me| lab.fetched(me, next) > 0).await);
        assert_eq!(phone.proven(mac.id()), Some(a));
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    })
    .await
    .expect("optional carrier lifecycle completes within its deadline");
}

async fn hello(from: &Node, to: &Node) -> Connection {
    let conn = from.endpoint().connect(to.addr(), ALPN).await.unwrap();
    let drawn = exporter(&conn).unwrap();
    let signed = from
        .read(move |lab, me| lab.hello(me, &drawn, true).unwrap().to_wire())
        .await;
    let (mut send, mut recv) = conn.open_bi().await.unwrap();
    send.write_all(&signed).await.unwrap();
    send.finish().unwrap();
    let response = Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
    assert_eq!(
        response.verify(&drawn, false, to.id().as_bytes()),
        Some(to.device())
    );
    conn
}
async fn control(conn: &Connection, value: Value) -> anyhow::Result<Value> {
    let (mut send, mut recv) = conn.open_bi().await?;
    send.write_all(&[15]).await?;
    send.write_all(&serde_json::to_vec(&value)?).await?;
    send.finish()?;
    let bytes = recv.read_to_end(32 << 10).await?;
    Ok(serde_json::from_slice(&bytes)?)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn negotiated_challenges_cannot_be_replayed_after_close_or_connection_replacement() {
    tokio::time::timeout(Duration::from_secs(25), async {
        let mut w = world(); handbook_ready(&mut w);
        let (a, b) = (w.mac_a, w.phone_a);
        let options = Options { lazy: true, ..Options::local() };
        let mac = Node::spawn(w.lab.split(a, &[], [185;32]), a, options.clone()).await.unwrap();
        let phone = Node::spawn(w.lab.split(b, &[], [186;32]), b, options).await.unwrap();
        // Node startup records its endpoint in signed state; Hello alone does not exchange that state.
        phone.know(mac.addr()); mac.know(phone.addr());
        phone.sync_with(mac.id()).await.unwrap();
        let (initiator, responder) = if mac.id() < phone.id() { (&mac, &phone) } else { (&phone, &mac) };
        responder.transport_event(json!({"kind":"capabilities","webtransport":false,"webrtc":true})).await.unwrap();
        let first = hello(initiator, responder).await;
        let caps = json!({"v":1,"op":"caps","nonce":"ab".repeat(16)});
        let challenge = control(&first, caps.clone()).await.unwrap();
        let request = json!({"v":1,"op":"open","mode":"rtc","initiator":caps["nonce"],"responder":challenge["nonce"]});
        assert_eq!(control(&first, request.clone()).await.unwrap()["v"], 1);
        let (route, _) = open(responder).await;
        assert!(control(&first, request.clone()).await.is_err(), "a spent nonce pair cannot open twice");
        responder.transport_event(event(&route, "closed")).await.unwrap();
        assert!(control(&first, request.clone()).await.is_err(), "closing the route does not unspend its challenge");
        let mut huge = caps.clone(); huge["padding"] = json!("x".repeat(32 << 10));
        assert!(control(&first, huge).await.is_err(), "control frames reject the excess before legacy-sized allocation");
        let second = hello(initiator, responder).await;
        let fresh = control(&second, caps.clone()).await.unwrap();
        assert_ne!(fresh["nonce"], challenge["nonce"], "a replacement PQ session supplies a fresh local nonce");
        assert!(control(&second, request.clone()).await.is_err(), "an old pair is not accepted on the new connection");
        assert!(control(&first, caps.clone()).await.is_err(), "an old still-open connection cannot recreate its control state");
        let new_request = json!({"v":1,"op":"open","mode":"rtc","initiator":caps["nonce"],"responder":fresh["nonce"]});
        assert_eq!(control(&second, new_request).await.unwrap()["v"], 1);
        // Close commands for the prior generation can precede the new route's Open.
        let fresh_route = loop {
            match responder.transport_next().await.unwrap() {
                Command::Open { id, .. } => break id,
                Command::Close { .. } => {},
                other => panic!("unexpected replacement command {other:?}"),
            }
        };
        assert_ne!(fresh_route, route);
        first.close(0u32.into(), b"old test connection complete");
        tokio::time::sleep(Duration::from_millis(30)).await;
        let mut ready = event(&fresh_route, "ready"); ready["mtu"] = json!(512);
        responder.transport_event(ready).await.expect("old connection cleanup cannot retire the new route");
        let signal = json!({"v":1,"op":"signal","epoch":"00".repeat(16),"sequence":0,"signal":{"candidate":null}});
        assert!(control(&second, signal).await.is_err(), "an unrelated wire epoch never injects signaling");
        responder.transport_event(event(&fresh_route, "closed")).await.unwrap();
        second.close(0u32.into(), b"test complete");
        mac.shutdown().await.unwrap(); phone.shutdown().await.unwrap();
    }).await.expect("replayed transport negotiation is rejected promptly");
}

#[cfg(not(target_arch = "wasm32"))]
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn concurrent_shutdown_releases_listener_port_while_node_is_retained() {
    let phase = std::time::Instant::now();
    tokio::time::timeout(Duration::from_secs(20), async {
        let mut w = world();
        handbook_ready(&mut w);
        eprintln!("listener gate fixture ready: {:?}", phase.elapsed());
        let me = w.mac_a;
        let node = Node::spawn(
            w.lab.split(me, &[], [187; 32]),
            me,
            Options {
                lazy: true,
                ..Options::local()
            },
        )
        .await
        .unwrap();
        eprintln!("listener gate node ready: {:?}", phase.elapsed());
        let probe = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        let address = probe.local_addr().unwrap();
        drop(probe);
        node.listen_webtransport(avendb_net::transports::WtConfig {
            bind: address,
            public_url: format!("https://{address}/packets"),
            allowed_origins: vec!["https://app.example".into()],
        })
        .await
        .unwrap();
        assert!(
            std::net::UdpSocket::bind(address).is_err(),
            "listener owns the port"
        );
        eprintln!("listener gate shutdown begins: {:?}", phase.elapsed());
        let (first, second) = tokio::join!(node.shutdown(), node.shutdown());
        eprintln!("listener gate shutdown complete: {:?}", phase.elapsed());
        first.unwrap();
        second.unwrap();
        let rebound = std::net::UdpSocket::bind(address)
            .expect("awaited shutdown must release the listener while the old Node still exists");
        assert_eq!(rebound.local_addr().unwrap(), address);
        assert_eq!(
            node.device(),
            me,
            "the old Node has deliberately not been dropped"
        );
    })
    .await
    .expect("concurrent shutdown finishes within its deadline");
}
