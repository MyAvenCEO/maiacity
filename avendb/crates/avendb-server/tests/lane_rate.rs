//! One lane's rate through the server's relay (Task 2 of the sync lane work, 2026-10-27): one large reply, as a page of
//! a pull is, sent on one stream from one raw iroh endpoint to another through a local relay that reads each client at
//! 8 MiB/s, as avendb.maia.city's does, both endpoints relay-only, as a page is. Once with a receiver that reads all
//! the time, and once with a receiver whose one thread is held now and then, as the Lab holds a page's one worker:
//! while it is held its QUIC stack sends no ACK and grants no credit, so the sender stops once its window is out.
//! Run by hand: `cargo test --release -p avendb-server --test lane_rate -- --ignored --nocapture`.

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use avendb_net::{Admission, pq_provider};
use avendb_server::{Rates, Relay};
use iroh::endpoint::presets;
use iroh::{Endpoint, EndpointAddr, RelayConfig, RelayMap, RelayMode, RelayUrl, SecretKey};

const LOOPBACK: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 0);
const ALPN: &[u8] = b"avendb/lane-rate/0";
/// About what a large page brings.
const REPLY: usize = 3 << 20;

async fn endpoint(relay: &RelayUrl, seed: u8) -> Endpoint {
    Endpoint::builder(presets::Empty)
        .secret_key(SecretKey::from_bytes(&[seed; 32]))
        .crypto_provider(pq_provider())
        .clear_ip_transports()
        .relay_mode(RelayMode::Custom(RelayMap::from(RelayConfig::from(relay.clone()))))
        .alpns(vec![ALPN.to_vec()])
        .bind()
        .await
        .expect("an endpoint")
}

/// Seconds the reply took to arrive whole, the receiver's thread held `held` after each `every` bytes it read.
fn one_reply(relay: RelayUrl, every: usize, held: Duration) -> (f64, f64) {
    let (addr_tx, addr_rx) = std::sync::mpsc::channel::<EndpointAddr>();
    let relay2 = relay.clone();
    // the receiver alone on a thread of its own, as a page's node is on its worker
    let receiver = std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async move {
            let ep = endpoint(&relay2, 7).await;
            ep.online().await;
            let addr = addr_rx.recv().unwrap();
            let conn = ep.connect(addr, ALPN).await.expect("a connection through the relay");
            let (mut send, mut recv) = conn.open_bi().await.unwrap();
            send.write_all(b"ask").await.unwrap();
            send.finish().unwrap();
            let began = Instant::now();
            let (mut got, mut since, mut holds) = (0usize, 0usize, 0u32);
            let mut buf = vec![0u8; 64 << 10];
            while let Some(n) = recv.read(&mut buf).await.unwrap() {
                got += n;
                since += n;
                if since >= every && !held.is_zero() {
                    since = 0;
                    // the Lab holds the worker: nothing else on this thread runs
                    std::thread::sleep(held);
                    holds += 1;
                }
            }
            assert_eq!(got, REPLY);
            let s = began.elapsed().as_secs_f64();
            conn.close(0u32.into(), b"done");
            ep.close().await;
            (s, (held * holds).as_secs_f64())
        })
    });
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    rt.block_on(async move {
        let ep = endpoint(&relay, 9).await;
        ep.online().await;
        addr_tx.send(EndpointAddr::new(ep.id()).with_relay_url(relay.clone())).unwrap();
        let incoming = ep.accept().await.expect("an incoming connection");
        let conn = incoming.await.expect("accepted");
        let (mut send, mut recv) = conn.accept_bi().await.unwrap();
        recv.read_to_end(16).await.unwrap();
        send.write_all(&vec![0x5a; REPLY]).await.unwrap();
        send.finish().unwrap();
        conn.closed().await;
        ep.close().await;
    });
    receiver.join().unwrap()
}

#[test]
#[ignore]
fn one_lanes_rate_through_the_relay() {
    let _ = rustls::crypto::CryptoProvider::install_default((*pq_provider()).clone());
    let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().unwrap();
    // the relay reads each client at 8 MiB/s, as the server's does
    let relay = rt.block_on(Relay::spawn_with(LOOPBACK, Admission::open(), Rates { relay: 8 << 20, ..Rates::default() })).unwrap();
    let url = relay.url();
    for (label, every, held) in [
        ("free receiver", usize::MAX, Duration::ZERO),
        ("held 250 ms per 512 KiB", 512 << 10, Duration::from_millis(250)),
        ("held 1 s per 1 MiB", 1 << 20, Duration::from_secs(1)),
    ] {
        let (s, h) = one_reply(url.clone(), every, held);
        let mb = REPLY as f64 / 1e6;
        eprintln!("LANE {label}: {mb:.2} MB in {s:.2} s = {:.2} MB/s; held {h:.2} s, so {:.2} s on the wire", mb / s, s - h);
    }
    rt.block_on(relay.shutdown()).unwrap();
}
