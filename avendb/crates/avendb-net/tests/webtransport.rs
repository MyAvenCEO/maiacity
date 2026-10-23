//! Real local HTTP/3 with certificate pin verification and mandatory PQ key exchange; no live nodes/stores.
#![cfg(not(target_arch = "wasm32"))]
use std::{sync::Arc, time::Duration};
use avendb::cast::*;
use avendb_net::{Node, Options, pq_provider};
use avendb_net::transports::{Carrier, Command, NativeWt, PacketTransport, RouteId, WtConfig, WtEvent};
use iroh::{EndpointAddr, EndpointId, TransportAddr};
use serde_json::Value;
use tokio::sync::mpsc;
use wtransport::{ClientConfig, Connection, Endpoint, VarInt};
use wtransport::endpoint::{ConnectOptions, endpoint_side::Client};
use wtransport::tls::{Sha256Digest, client::ServerHashVerification};

const ORIGIN: &str = "https://app.example";
fn peer(byte: u8) -> EndpointId { iroh::SecretKey::from_bytes(&[byte; 32]).public() }
fn config() -> WtConfig { WtConfig { bind: "127.0.0.1:0".parse().unwrap(), public_url: "https://127.0.0.1:0/packets".into(), allowed_origins: vec![ORIGIN.into()] } }
fn hashes(descriptor: &Value) -> Vec<Sha256Digest> {
    descriptor["certificateHashes"].as_array().unwrap().iter().map(|value| {
        let bytes: [u8; 32] = data_encoding::HEXLOWER.decode(value.as_str().unwrap().as_bytes()).unwrap().try_into().unwrap();
        Sha256Digest::new(bytes)
    }).collect()
}
fn client(hashes: Vec<Sha256Digest>, classical: bool) -> Endpoint<Client> {
    let mut provider = (*pq_provider()).clone();
    if classical { provider.kx_groups = vec![rustls::crypto::aws_lc_rs::kx_group::X25519]; }
    // This verifier checks the SHA256 pin, ECDSA-P256 key, <=14-day validity and handshake signatures.
    // The rustls API calls custom verifiers "dangerous"; no certificate-verification bypass is used here.
    let mut tls = rustls::ClientConfig::builder_with_provider(Arc::new(provider))
        .with_protocol_versions(&[&rustls::version::TLS13]).unwrap().dangerous()
        .with_custom_certificate_verifier(Arc::new(ServerHashVerification::new(hashes))).with_no_client_auth();
    tls.alpn_protocols = vec![wtransport::proto::WEBTRANSPORT_ALPN.to_vec()];
    Endpoint::client(ClientConfig::builder().with_bind_address("127.0.0.1:0".parse().unwrap()).with_custom_tls(tls).build()).unwrap()
}
async fn connect(endpoint: &Endpoint<Client>, url: &str, origin: &str) -> Result<Connection, wtransport::error::ConnectingError> {
    endpoint.connect(ConnectOptions::builder(url).add_header("origin", origin).build()).await
}
async fn ready(events: &mut mpsc::Receiver<WtEvent>) -> (RouteId, EndpointId, iroh_base::CustomAddr) {
    loop {
        match events.recv().await.unwrap() { WtEvent::Ready { id, peer, address } => return (id, peer, address), WtEvent::Closed { .. } => {} }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pinned_pq_http3_requires_origin_and_single_use_admission() {
    tokio::time::timeout(Duration::from_secs(20), async {
        let broker = PacketTransport::new(peer(1)); let (tx, mut events) = mpsc::channel(16);
        let listener = NativeWt::bind(config(), broker, tx).await.unwrap();
        let reservation = listener.reserve(peer(2), [7; 16]).unwrap();
        let url = reservation.descriptor["url"].as_str().unwrap();
        let endpoint = client(hashes(&reservation.descriptor), false);
        assert!(connect(&endpoint, url, "https://wrong.example").await.is_err(), "Origin checked before consuming ticket");
        let connection = connect(&endpoint, url, ORIGIN).await.unwrap();
        let (id, expected, _) = ready(&mut events).await; assert_eq!(id, reservation.id); assert_eq!(expected, peer(2));
        assert!(connect(&endpoint, url, ORIGIN).await.is_err(), "ticket cannot be replayed");
        let bad_pin = client(vec![Sha256Digest::new([0; 32])], false);
        assert!(connect(&bad_pin, url, ORIGIN).await.is_err(), "wrong certificate hash rejected");
        let classical = client(hashes(&reservation.descriptor), true);
        assert!(connect(&classical, url, ORIGIN).await.is_err(), "classical-only outer TLS cannot negotiate");
        connection.close(VarInt::from_u32(0), b"done");
        loop { if let WtEvent::Closed { id, .. } = events.recv().await.unwrap() { assert_eq!(id, reservation.id); break; } }
        listener.shutdown().await;
        for endpoint in [&endpoint, &bad_pin, &classical] { endpoint.close(VarInt::from_u32(0), b"done"); }
    }).await.expect("local security checks finish within deadline");
}

fn client_pump(broker: PacketTransport, id: RouteId, connection: Connection) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::select! {
                command = broker.next() => match command {
                    Some(Command::Send { bytes, .. }) => { if connection.send_datagram(bytes).is_err() { break; } },
                    Some(Command::Close { .. }) | None => break,
                    _ => {},
                },
                received = connection.receive_datagram() => match received {
                    Ok(bytes) => { broker.receive(&id, &bytes); },
                    Err(_) => break,
                }
            }
        }
        connection.close(VarInt::from_u32(0), b"pump ended"); broker.close_route(&id);
    })
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn real_aven_sync_keeps_inner_pq_and_exporter_hello_over_pinned_http3() {
    tokio::time::timeout(Duration::from_secs(35), async {
        let mut w = world(); let coop = handbook_ready(&mut w);
        let (a, b, ka, kb) = (w.mac_a, w.mac_b, w.passkey_a, w.passkey_b);
        let opts = Options { bind: None, ..Options::local() };
        let mac = Node::spawn(w.lab.split(a, &[ka], [1; 32]), a, opts.clone()).await.unwrap();
        let bob = Node::spawn(w.lab.split(b, &[kb], [2; 32]), b, opts).await.unwrap();
        let (tx, mut events) = mpsc::channel(16);
        let listener = NativeWt::bind(config(), mac.packet_transport(), tx).await.unwrap();
        // This harness supplies the peer binding normally established by authenticated capability negotiation.
        let reservation = listener.reserve(bob.id(), [11; 16]).unwrap();
        let endpoint = client(hashes(&reservation.descriptor), false);
        let connection = connect(&endpoint, reservation.descriptor["url"].as_str().unwrap(), ORIGIN).await.unwrap();
        let (_, peer, bob_address) = ready(&mut events).await; assert_eq!(peer, bob.id());
        let broker = bob.packet_transport();
        let id = broker.open(mac.id(), Carrier::WebTransport, [11; 16], Value::Null).unwrap();
        let mac_address = broker.ready(&id, connection.max_datagram_size().unwrap()).unwrap();
        let pump = client_pump(broker, id, connection);
        mac.know(EndpointAddr::from_parts(bob.id(), [TransportAddr::Custom(bob_address)]));
        bob.know(EndpointAddr::from_parts(mac.id(), [TransportAddr::Custom(mac_address)]));
        let entry = mac.act(move |lab, me| lab.create(me, coop, coop, "doc", &[], document("WebTransport", "same authorization", me))).await.unwrap();
        loop {
            bob.sync_with(mac.id()).await.unwrap();
            if bob.read(move |lab, me| text(lab, me, entry, 2).as_deref() == Some("same authorization")).await { break; }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert_eq!(bob.proven(mac.id()), Some(a)); assert_eq!(mac.proven(bob.id()), Some(b));
        assert!(mac.addr().addrs.is_empty() && bob.addr().addrs.is_empty(), "inner connection had no IP or relay alternative");
        mac.shutdown().await.unwrap(); bob.shutdown().await.unwrap(); listener.shutdown().await;
        endpoint.close(VarInt::from_u32(0), b"done"); pump.await.unwrap();
    }).await.expect("nested PQ/HTTP3 authenticated sync finishes within deadline");
}
