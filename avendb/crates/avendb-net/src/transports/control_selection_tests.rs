//! Deterministic publication order for two authenticated, opposite-direction connections.
use super::*;
use avendb::cast::*;
use avendb::sign::Hello;
use avendb::wire::Wire;
use crate::{Node, Options, ALPN, exporter};
use iroh::endpoint::{Connection, Side};

// Authenticate the actual connection before exposing its outbound completion to
// Shared::connected. The router serves the inbound half exactly once as usual.
async fn authenticated(from: &Node, to: &Node) -> Connection {
    let connection = from.endpoint().connect(to.addr(), ALPN).await.unwrap();
    let drawn = exporter(&connection).unwrap();
    let signed = from.read(move |lab, me| lab.hello(me, &drawn, true).unwrap().to_wire()).await;
    let (mut send, mut recv) = connection.open_bi().await.unwrap();
    send.write_all(&signed).await.unwrap();
    send.finish().unwrap();
    let answer = Hello::from_wire(&recv.read_to_end(64 << 10).await.unwrap()).unwrap();
    assert_eq!(answer.verify(&drawn, false, to.id().as_bytes()), Some(to.device()));
    // The Hello reply can arrive just before the router publishes its inbound
    // Peer. A real protocol acknowledgment proves registration and serve have
    // both finished, including when selection correctly declines this channel.
    let (mut send, mut recv) = connection.open_bi().await.unwrap();
    send.write_all(&[crate::session::ANNOUNCE]).await.unwrap();
    send.write_all(&avendb::wire::Announce::default().to_wire()).await.unwrap();
    send.finish().unwrap();
    assert!(recv.read_to_end(1).await.unwrap().is_empty());
    connection
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn opposite_authenticated_completions_select_the_same_control_connection() {
    tokio::time::timeout(Duration::from_secs(30), async {
        let mut world = world();
        handbook_ready(&mut world);
        let (a, b) = (world.mac_a, world.phone_a);
        let options = Options { lazy: true, ..Options::local() };
        let mac = Node::spawn(world.lab.split(a, &[], [191; 32]), a, options.clone()).await.unwrap();
        let phone = Node::spawn(world.lab.split(b, &[], [192; 32]), b, options).await.unwrap();
        mac.know(phone.addr());
        phone.know(mac.addr());
        // Both stores learn the other's signed endpoint before carrier policy is exercised.
        mac.sync_with(phone.id()).await.unwrap();
        phone.sync_with(mac.id()).await.unwrap();
        let (low, high) = if mac.id() < phone.id() { (&mac, &phone) } else { (&phone, &mac) };
        let low_dial = authenticated(low, high).await;
        low.shared.connected(low_dial.clone(), high.device());
        let high_dial = authenticated(high, low).await;
        // Reproduce the completion ordering of simultaneous dial attempts without
        // depending on scheduler luck: each outbound completion publishes last.
        low.shared.connected(low_dial.clone(), high.device());
        high.shared.connected(high_dial.clone(), low.device());
        let low_selected = low.shared.peers.lock().unwrap().get(&high.id()).unwrap().clone();
        let high_selected = high.shared.peers.lock().unwrap().get(&low.id()).unwrap().clone();
        assert_eq!(
            exporter(&low_selected.conn).unwrap(), exporter(&high_selected.conn).unwrap(),
            "both peers must select the same authenticated TLS session, not two outbound halves"
        );
        assert_eq!(low_selected.conn.side(), Side::Client);
        assert_eq!(high_selected.conn.side(), Side::Server);
        assert_eq!(low_selected.conn.stable_id(), low_dial.stable_id());
        high.transport_event(json!({"kind":"capabilities","webtransport":false,"webrtc":true})).await.unwrap();
        low.transport_event(json!({"kind":"capabilities","webtransport":false,"webrtc":true})).await.unwrap();
        let (lo, hi) = tokio::join!(low.transport_next(), high.transport_next());
        assert!(matches!(lo, Some(super::super::Command::Open { .. })), "lower endpoint negotiates a route: {lo:?}");
        assert!(matches!(hi, Some(super::super::Command::Open { .. })), "higher endpoint answers on that same connection: {hi:?}");
        // A later losing connection must not retire the route on the selected
        // authenticated channel. Read IDs directly: no timer/race inference.
        let selected_and_route = |node: &Node, other: &Node| {
            let state = node.shared.transport_control.state.lock().unwrap();
            let selected = node.shared.peers.lock().unwrap().get(&other.id()).unwrap().conn.stable_id();
            let route = state.sessions.get(&other.id()).unwrap().route.clone().expect("negotiated route");
            (selected, route)
        };
        let low_before = selected_and_route(low, high);
        let high_before = selected_and_route(high, low);
        let later_loser = authenticated(high, low).await;
        high.shared.connected(later_loser, low.device());
        assert_eq!(selected_and_route(low, high), low_before, "losing inbound duplicate preserves the route");
        assert_eq!(selected_and_route(high, low), high_before, "losing outbound duplicate preserves the route");
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    }).await.expect("deterministic control selection and negotiation finish within 30 seconds");
}
