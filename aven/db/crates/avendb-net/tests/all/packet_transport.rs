//! Real avenDB sync over the bounded custom packet bridge, with no IP or relay path available.
//! The byte-forwarding harness substitutes only the outer WT/RTC carrier, never QUIC, Hello or policy.
#![cfg(debug_assertions)]

use std::time::Duration;
use avendb::cast::*;
use avendb_net::{Node, Options};
use avendb_net::transports::{Carrier, Command, PacketTransport, RouteId};
use iroh::{EndpointAddr, TransportAddr};
use serde_json::Value;

fn forward(from: PacketTransport, to: PacketTransport, theirs: RouteId) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        while let Some(command) = from.next().await {
            if let Command::Send { bytes, .. } = command { to.receive(&theirs, &bytes); }
        }
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn authenticated_sync_over_fragmented_carrier_without_ip_or_relay() {
    // The cast's keys are made before the deadline starts: on a loaded runner they alone took ~39 s (2026-10-27).
    // The deadline is a hang guard (nextest stops a test after 6 minutes anyway): with the keys out of it, the same
    // two-node sync over WebTransport (webtransport.rs) still ran past 35 s on a loaded shard on 2026-10-27 10:33 UTC.
    let mut w = world(); let coop = handbook_ready(&mut w);
    tokio::time::timeout(Duration::from_secs(90), async {
        let (a, b, ka, kb) = (w.mac_a, w.mac_b, w.passkey_a, w.passkey_b);
        let opts = Options { bind: None, ..Options::local() };
        let mac = Node::spawn(w.lab.split(a, &[ka], [1; 32]), a, opts.clone()).await.unwrap();
        let bob = Node::spawn(w.lab.split(b, &[kb], [2; 32]), b, opts).await.unwrap();
        let at = mac.packet_transport(); let bt = bob.packet_transport();
        let ar = at.open(bob.id(), Carrier::WebRtc, [7; 16], Value::Null).unwrap();
        let br = bt.open(mac.id(), Carrier::WebRtc, [7; 16], Value::Null).unwrap();
        // Deliberately less than inner QUIC's minimum packet size: real handshakes require reassembly.
        let ba = at.ready(&ar, 512).unwrap(); let aa = bt.ready(&br, 512).unwrap();
        let pump_a = forward(at.clone(), bt.clone(), br); let pump_b = forward(bt, at, ar);
        mac.know(EndpointAddr::from_parts(bob.id(), [TransportAddr::Custom(ba)]));
        bob.know(EndpointAddr::from_parts(mac.id(), [TransportAddr::Custom(aa)]));
        let entry = mac.act(move |lab, me| lab.create(me, coop, coop, "doc", &[], document("Carrier", "same permissions", me))).await.unwrap();
        loop {
            bob.sync_with(mac.id()).await.unwrap();
            if bob.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("same permissions")).await { break; }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(bob.proven(mac.id()), Some(a), "the actual exporter-bound Hello proved the peer");
        assert_eq!(mac.proven(bob.id()), Some(b));
        assert!(mac.addr().addrs.is_empty() && bob.addr().addrs.is_empty(), "no IP or relay fallback in this harness");
        mac.shutdown().await.unwrap(); bob.shutdown().await.unwrap();
        pump_a.await.unwrap(); pump_b.await.unwrap();
    }).await.expect("custom carrier sync finishes within its deadline");
}
