//! A Doc's topic among its readers, natively, as the box runs it: a relay in this process, a reader's Peer on UDP and
//! the relay, and two Peer-Lights through the relay only. Every peer holds the door (`Gate`) in its hook. A message one
//! reader sends reaches the other through the Peer; a member on another Doc's topic hears nothing of it; and each reader
//! meets the others on the topic, which is when the host syncs with them by version.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use aven_peer::docs::{DocTopic, Heard, Live, topic};
use aven_peer::members::{Gate, Hook};
use aven_peer::relay::Allow;
use aven_peer::{Notes, iroh_gossip};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, PublicKey, RelayMap, RelayMode, RelayUrl, SecretKey};
use iroh_gossip::Gossip;

fn key(seed: u8) -> SecretKey {
    SecretKey::from_bytes(&[seed; 32])
}

fn notes() -> Notes {
    Arc::new(|_line: String| {})
}

#[derive(Clone, Default)]
struct Got(Arc<Mutex<(Vec<Live>, Vec<PublicKey>)>>);

impl Got {
    async fn wait(&self, want: impl Fn(&(Vec<Live>, Vec<PublicKey>)) -> bool) -> bool {
        for _ in 0..200 {
            if want(&self.0.lock().unwrap()) {
                return true;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        false
    }
}

struct Peer {
    topic: DocTopic,
    got: Got,
    _router: Router,
    _endpoint: Endpoint,
}

async fn peer(
    name: &str,
    secret: SecretKey,
    relay: &RelayUrl,
    gate: Gate,
    udp: bool,
    on: [u8; 32],
    bootstrap: Vec<EndpointAddr>,
) -> Peer {
    let mut builder = Endpoint::builder(presets::Minimal)
        .secret_key(secret.clone())
        .relay_mode(RelayMode::Custom(RelayMap::from(relay.clone())))
        .alpns(vec![iroh_gossip::ALPN.to_vec()])
        .hooks(Hook {
            me: name.into(),
            gate: gate.clone(),
            notes: notes(),
        })
        .clear_ip_transports();
    if udp {
        builder = builder.bind_addr("127.0.0.1:0").unwrap();
    }
    let endpoint = builder.bind().await.unwrap();
    for addr in &bootstrap {
        aven_peer::know(&endpoint, addr.clone());
    }
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(iroh_gossip::ALPN, gossip.clone())
        .spawn();
    let got = Got::default();
    let into = got.clone();
    let topic = DocTopic::join(
        &gossip,
        on,
        name.into(),
        gate,
        secret.public(),
        bootstrap.iter().map(|a| a.id).collect(),
        notes(),
        Arc::new(move |h| {
            let mut g = into.0.lock().unwrap();
            match h {
                Heard::Live(l, _) => g.0.push(l),
                Heard::Met(k) => g.1.push(k),
            }
        }),
    )
    .await
    .unwrap();
    Peer {
        topic,
        got,
        _router: router,
        _endpoint: endpoint,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn readers_hear_each_other_on_a_docs_topic_and_no_one_else_does() {
    let (alice_peer, alice, bob, carol) = (key(1), key(2), key(3), key(4));
    let members = [
        (alice_peer.public(), "alice-peer"),
        (alice.public(), "alice-peer-light"),
        (bob.public(), "bob-peer-light"),
        (carol.public(), "carol-peer-light"),
    ];
    let gate = || {
        let gate = Gate::default();
        gate.set(
            members
                .iter()
                .map(|(k, n)| (*k, n.to_string(), None))
                .collect::<Vec<_>>(),
        );
        gate
    };
    let mut relay = iroh_relay::server::RelayConfig::new(([127, 0, 0, 1], 0));
    relay.access = Arc::new(Allow {
        me: "relay".into(),
        gate: gate(),
        door: None,
        notes: notes(),
    });
    let mut server = iroh_relay::server::ServerConfig::default();
    server.relay = Some(relay);
    let server = iroh_relay::server::Server::spawn(server).await.unwrap();
    let url: RelayUrl = format!("http://{}", server.http_addr().unwrap())
        .parse()
        .unwrap();

    let doc = topic(&[7; 32]);
    let other = topic(&[8; 32]);
    let via = EndpointAddr::new(alice_peer.public()).with_relay_url(url.clone());
    let hub = peer("alice-peer", alice_peer, &url, gate(), true, doc, vec![]).await;
    let a = peer(
        "alice-peer-light",
        alice,
        &url,
        gate(),
        false,
        doc,
        vec![via.clone()],
    )
    .await;
    let b = peer(
        "bob-peer-light",
        bob,
        &url,
        gate(),
        false,
        doc,
        vec![via.clone()],
    )
    .await;
    let c = peer(
        "carol-peer-light",
        carol,
        &url,
        gate(),
        false,
        other,
        vec![via],
    )
    .await;

    // each Peer-Light meets the Peer on the Doc's topic
    for p in [&a, &b] {
        assert!(p.got.wait(|g| !g.1.is_empty()).await, "never met anyone");
    }
    assert!(
        hub.got.wait(|g| g.1.len() >= 2).await,
        "the Peer met both readers"
    );

    let live = Live::of(b"a sealed envelope");
    assert!(a.topic.send(&live).await);
    assert!(b.got.wait(|g| g.0.contains(&live)).await, "Bob heard it");
    assert!(
        hub.got.wait(|g| g.0.contains(&live)).await,
        "the Peer heard it"
    );

    let big = Live::of(&vec![9u8; 10_000]);
    assert!(matches!(big, Live::Hash(_)));
    assert!(b.topic.send(&big).await);
    assert!(
        a.got.wait(|g| g.0.contains(&big)).await,
        "Alice heard the hash"
    );

    // Carol, on another Doc's topic, heard nothing of either
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(c.got.0.lock().unwrap().0.is_empty());
}
