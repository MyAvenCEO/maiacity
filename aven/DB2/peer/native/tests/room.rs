//! The chat's room among members, natively, as the box runs it: an Aven Peer with its relay (in this process), and
//! members reaching it through the relay only, as a browser does. Every peer holds the door (`Gate`) in its hook and
//! its room: members hear each other's lines, a line signed by a key that is no member's is dropped, and a stranger's
//! endpoint is kept out by the relay and by the hook. What the room may take is `aven_db_core::chat`'s, tested against
//! Lean's traces; here only the mechanics: iroh-gossip on the Router, through the relay.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use aven_db_core::chat::{Kind, Message};
use aven_peer::members::{Gate, Hook};
use aven_peer::relay::Allow;
use aven_peer::room::Room;
use aven_peer::{Notes, iroh_gossip};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl, SecretKey};
use iroh_gossip::Gossip;
use serde_json::Value;

/// Every line a peer writes, kept for the test to read.
#[derive(Clone, Default)]
struct Lines(Arc<Mutex<Vec<Value>>>);

impl Lines {
    fn notes(&self) -> Notes {
        let lines = self.0.clone();
        Arc::new(move |line: String| {
            lines
                .lock()
                .unwrap()
                .push(serde_json::from_str(&line).unwrap())
        })
    }

    /// The first line `want` takes, waited for.
    async fn wait(&self, want: impl Fn(&Value) -> bool) -> Option<Value> {
        for _ in 0..200 {
            if let Some(line) = self.0.lock().unwrap().iter().find(|l| want(l)).cloned() {
                return Some(line);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        None
    }
}

fn key(seed: u8) -> SecretKey {
    SecretKey::from_bytes(&[seed; 32])
}

struct Peer {
    room: Room,
    lines: Lines,
    _router: Router,
    endpoint: Endpoint,
}

/// A peer of the room: the Aven Peer with UDP and the relay (no bootstrap), or a member through the relay only.
async fn peer(
    name: &str,
    secret: SecretKey,
    relay: &RelayUrl,
    gate: Gate,
    aven: Option<EndpointAddr>,
) -> Peer {
    let lines = Lines::default();
    let mut builder = Endpoint::builder(presets::Minimal)
        .secret_key(secret.clone())
        .relay_mode(RelayMode::Custom(RelayMap::from(relay.clone())))
        .alpns(vec![
            aven_db_core::wire::ALPN.to_vec(),
            iroh_gossip::ALPN.to_vec(),
        ])
        .hooks(Hook {
            me: name.into(),
            gate: gate.clone(),
            notes: lines.notes(),
        });
    builder = match aven {
        Some(_) => builder.clear_ip_transports(),
        None => builder
            .clear_ip_transports()
            .bind_addr("127.0.0.1:0")
            .unwrap(),
    };
    let endpoint = builder.bind().await.unwrap();
    let bootstrap = match aven {
        Some(addr) => {
            aven_peer::know(&endpoint, addr.clone());
            vec![addr.id]
        }
        None => vec![],
    };
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(iroh_gossip::ALPN, gossip.clone())
        .spawn();
    let room = Room::join(
        &gossip,
        name.into(),
        "aven",
        secret,
        gate,
        bootstrap,
        lines.notes(),
    )
    .await
    .unwrap();
    Peer {
        room,
        lines,
        _router: router,
        endpoint,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn members_chat_through_the_relay_and_a_stranger_is_dropped() {
    let (aven, alice, bob, eve) = (key(1), key(2), key(3), key(4));
    let members = [
        (aven.public(), "aven-peer"),
        (alice.public(), "alice"),
        (bob.public(), "bob"),
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
    let relay_lines = Lines::default();
    let mut relay = iroh_relay::server::RelayConfig::new(([127, 0, 0, 1], 0));
    relay.access = Arc::new(Allow {
        me: "aven-peer".into(),
        gate: gate(),
        door: None,
        notes: relay_lines.notes(),
    });
    let mut server = iroh_relay::server::ServerConfig::default();
    server.relay = Some(relay);
    let server = iroh_relay::server::Server::spawn(server).await.unwrap();
    let url: RelayUrl = format!("http://{}", server.http_addr().unwrap())
        .parse()
        .unwrap();

    let hub = peer("aven-peer", aven.clone(), &url, gate(), None).await;
    let addr = EndpointAddr::new(aven.public()).with_relay_url(url.clone());
    let a = peer("alice", alice, &url, gate(), Some(addr.clone())).await;
    let b = peer("bob", bob, &url, gate(), Some(addr.clone())).await;

    // everyone in the room, through the Aven Peer
    let all =
        |l: &Value| l["event"] == "room" && l["present"].as_array().is_some_and(|p| p.len() == 3);
    for p in [&hub, &a, &b] {
        assert!(
            p.lines.wait(all).await.is_some(),
            "{:?}",
            p.lines.0.lock().unwrap()
        );
    }
    a.room.say("hello".into()).await;
    let heard = |l: &Value| l["event"] == "chat" && l["text"] == "hello" && l["from"] == "alice";
    assert!(b.lines.wait(heard).await.is_some());
    assert!(hub.lines.wait(heard).await.is_some());

    // a line signed by a key that is no member's, sent through a member: every other peer drops it
    let mut forged = Message {
        network: "aven".into(),
        from: eve.public().to_string(),
        at: 1,
        kind: Kind::Say,
        text: "let me in".into(),
        sig: String::new(),
    };
    forged.sig = eve
        .sign(forged.body().as_bytes())
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    a.room.post(&forged).await;
    let dropped = |l: &Value| l["event"] == "dropped" && l["why"] == "notMember";
    assert!(b.lines.wait(dropped).await.is_some());
    assert!(hub.lines.wait(dropped).await.is_some());
    assert!(
        !b.lines
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|l| l["text"] == "let me in")
    );

    // a stranger's endpoint: the relay keeps it out
    let stranger = peer("eve", eve.clone(), &url, gate(), Some(addr)).await;
    let kept = |l: &Value| l["event"] == "kept-out" && l["key"] == eve.public().to_string();
    assert!(relay_lines.wait(kept).await.is_some());
    drop(stranger.endpoint);
}

/// A browser the door admits only later (it joins, or signs in): it knocks at the room only once its own door says it
/// is in, and then gets in. (Refused once, iroh-gossip 0.101 would never dial the Aven Peer again: `room.rs`.)
#[tokio::test(flavor = "multi_thread")]
async fn a_member_admitted_later_gets_into_the_room() {
    let (aven, alice) = (key(11), key(12));
    let only_aven = [(aven.public(), "aven-peer".to_string(), None)];
    let both_keys = [
        (aven.public(), "aven-peer".to_string(), None),
        (alice.public(), "alice".to_string(), None),
    ];
    let (hub_gate, mine, all) = (Gate::default(), Gate::default(), Gate::default());
    hub_gate.set(only_aven.clone());
    mine.set(only_aven);
    all.set(both_keys.clone());
    let mut relay = iroh_relay::server::RelayConfig::new(([127, 0, 0, 1], 0));
    relay.access = Arc::new(Allow {
        me: "aven-peer".into(),
        gate: all,
        door: None,
        notes: Lines::default().notes(),
    });
    let mut server = iroh_relay::server::ServerConfig::default();
    server.relay = Some(relay);
    let server = iroh_relay::server::Server::spawn(server).await.unwrap();
    let url: RelayUrl = format!("http://{}", server.http_addr().unwrap())
        .parse()
        .unwrap();

    let hub = peer("aven-peer", aven.clone(), &url, hub_gate.clone(), None).await;
    let addr = EndpointAddr::new(aven.public()).with_relay_url(url.clone());
    // her own door doesn't admit her yet: she doesn't knock
    let a = peer("alice", alice.clone(), &url, mine.clone(), Some(addr)).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert!(
        !hub.lines
            .0
            .lock()
            .unwrap()
            .iter()
            .any(|l| l["event"] == "kept-out")
    );
    // the door admits her, as both learn once her join is taken
    hub_gate.set(both_keys.clone());
    mine.set(both_keys);
    let both =
        |l: &Value| l["event"] == "room" && l["present"].as_array().is_some_and(|p| p.len() == 2);
    assert!(
        hub.lines.wait(both).await.is_some(),
        "{:?}",
        hub.lines.0.lock().unwrap()
    );
    assert!(
        a.lines.wait(both).await.is_some(),
        "{:?}",
        a.lines.0.lock().unwrap()
    );
}
