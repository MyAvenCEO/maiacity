//! A page (the iPhone's) and a machine (the Mac app's node) agree on a direct WebRTC route where they reach each other,
//! and stay on the relay where they don't. The relay is the simulated network (`sim`), which the test cuts once the
//! route is up: the edit that crosses after it crossed the route. The page is a node as a browser's is, with no UDP of
//! its own, its carrier driven through the page's own surface (`transport_next`/`transport_event`) by a WebRTC peer
//! on real loopback UDP; the machine runs its own (`Node::serve_webrtc`). Real ICE, DTLS and SCTP, real PQ TLS,
//! exporter-bound Hello and sync authorization: the route carries only the inner connection's packets.
#![cfg(all(feature = "sim", not(target_arch = "wasm32")))]
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use std::time::Duration;

use avendb::cast::*;
use avendb_net::sim::{Faults, Net};
use avendb_net::transports::{RtcConfig, webrtc};
use avendb_net::{Node, Options};
use serde_json::{Value, json};

const LOOPBACK: IpAddr = IpAddr::V4(Ipv4Addr::LOCALHOST);

/// The page's carrier adapter, as the device worker runs it (`deviceTransports`): it says it can do WebRTC, and hands
/// each route's events to its node as the page does.
fn page(node: Arc<Node>, config: RtcConfig) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        node.transport_event(json!({"kind": "capabilities", "webtransport": false, "webrtc": true})).await.unwrap();
        let (events, mut incoming) = tokio::sync::mpsc::channel(512);
        let carrier = tokio::spawn(webrtc::serve(node.packet_transport(), config, events));
        while let Some(event) = incoming.recv().await {
            let _ = node.transport_event(event).await;
        }
        carrier.abort();
    })
}

async fn until(what: &str, limit: Duration, mut check: impl AsyncFnMut() -> bool) {
    tokio::time::timeout(limit, async {
        while !check().await {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    })
    .await
    .unwrap_or_else(|_| panic!("{what}"));
}

fn routes(node: &Node) -> Vec<Value> {
    node.served()["carriers"]["routes"].as_array().cloned().unwrap_or_default()
}
fn diary(node: &Node) -> String {
    node.served()["carriers"]["diary"].to_string()
}

struct Pair {
    mac: Arc<Node>,
    phone: Arc<Node>,
    net: Net,
    coop: avendb::id::VaultId,
}

/// The Mac's node and the iPhone's page, synced once over the relay; neither has a socket iroh could go straight by.
async fn pair(w: &mut avendb::cast::World, coop: avendb::id::VaultId, seed: u8) -> Pair {
    let net = Net::with(u64::from(seed), Faults::CALM);
    let options = Options { lazy: true, ..Options::simulated(&net) };
    let (a, b) = (w.mac_a, w.phone_a);
    let mac = Arc::new(Node::spawn(w.lab.split(a, &[], [seed; 32]), a, options.clone()).await.unwrap());
    let phone = Arc::new(Node::spawn(w.lab.split(b, &[], [seed + 1; 32]), b, options).await.unwrap());
    mac.know(phone.addr());
    phone.know(mac.addr());
    phone.sync_with(mac.id()).await.unwrap();
    assert_eq!(phone.proven(mac.id()), Some(a));
    Pair { mac, phone, net, coop }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_page_and_a_machine_agree_on_a_direct_webrtc_route_that_carries_their_sync() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    tokio::time::timeout(Duration::from_secs(120), async {
        let Pair { mac, phone, net, coop } = pair(&mut w, coop, 41).await;
        let own = RtcConfig { stun: Some(vec![]), hosts: Some(vec![LOOPBACK]) };
        mac.serve_webrtc(own.clone()).await.unwrap();
        assert!(mac.serve_webrtc(own.clone()).await.is_err(), "one WebRTC peer a node");
        let browser = page(phone.clone(), own);
        until("both ends report the WebRTC route ready", Duration::from_secs(40), async || {
            routes(&mac).iter().any(|r| r["ready"] == true) && routes(&phone).iter().any(|r| r["ready"] == true)
        })
        .await;
        assert!(diary(&mac).contains("opening rtc") || diary(&phone).contains("opening rtc"), "{} / {}", diary(&mac), diary(&phone));
        // the relay goes: what syncs now crosses the route alone
        net.cut(mac.id(), phone.id());
        let entry = mac
            .act(move |lab, me| lab.create(me, coop, coop, "doc", &[], document("Straight", "over WebRTC", me)))
            .await
            .unwrap();
        until("the edit crosses the direct route with the relay cut", Duration::from_secs(40), async || {
            let _ = phone.sync_with(mac.id()).await;
            phone.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("over WebRTC")).await
        })
        .await;
        assert_eq!(phone.proven(mac.id()), Some(w.mac_a), "the same exporter-bound Hello proved the peer");
        assert_eq!(mac.proven(phone.id()), Some(w.phone_a));
        assert!(routes(&mac).iter().all(|r| r["ready"] == true), "the route stayed up: {}", diary(&mac));
        browser.abort();
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    })
    .await
    .expect("the direct route forms and carries sync within its deadline");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_page_the_machine_cannot_reach_stays_on_the_relay() {
    let mut w = world();
    let coop = handbook_ready(&mut w);
    tokio::time::timeout(Duration::from_secs(120), async {
        let Pair { mac, phone, coop, .. } = pair(&mut w, coop, 61).await;
        mac.serve_webrtc(RtcConfig { stun: Some(vec![]), hosts: Some(vec![LOOPBACK]) }).await.unwrap();
        // a page whose every candidate is out of the machine's reach (an mDNS name, a blocked network): none at all
        let browser = page(phone.clone(), RtcConfig { stun: Some(vec![]), hosts: Some(vec![]) });
        until("the route is negotiated", Duration::from_secs(30), async || !routes(&mac).is_empty() || diary(&mac).contains("carrier closed")).await;
        until("the unreachable route times out and closes at both ends", Duration::from_secs(45), async || {
            routes(&mac).is_empty() && routes(&phone).is_empty() && diary(&mac).contains("carrier closed")
        })
        .await;
        assert!(!diary(&mac).contains("carrier ready"), "no route was reported up: {}", diary(&mac));
        // and sync goes on, through the relay
        let entry = mac
            .act(move |lab, me| lab.create(me, coop, coop, "doc", &[], document("Relayed", "still synced", me)))
            .await
            .unwrap();
        until("the edit crosses the relay", Duration::from_secs(30), async || {
            let _ = phone.sync_with(mac.id()).await;
            phone.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("still synced")).await
        })
        .await;
        browser.abort();
        mac.shutdown().await.unwrap();
        phone.shutdown().await.unwrap();
    })
    .await
    .expect("the fallback holds within its deadline");
}
