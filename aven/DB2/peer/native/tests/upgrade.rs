//! Upgrades are a clean refusal (PEERS.md §7, `Aven.DB.Wire`, "The wire version"): the first frame of every
//! `aven/db/1` connection names the wire version its peer speaks, and a peer of another version is answered `update`,
//! with the version this one speaks, and closed, never fallen back for. Both sides say `update` on their timeline, and
//! the one behind says it `follows`: a tab switches to the newer release, a native Peer waits for its owner. What each
//! side answers is the model's (`upgrades.json`, in aven-db-core's tests); here only that the hub and the link do it.

#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use aven_db_core::wire::{self, ALPN, Decoder, Greeting, Incoming};
use aven_peer::Notes;
use aven_peer::hub::Hub;
use aven_peer::keys::Members;
use aven_peer::link;
use iroh::endpoint::{Connection, presets};
use iroh::protocol::{AcceptError, ProtocolHandler, Router};
use iroh::{Endpoint, RelayMode};
use serde_json::Value;

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

    async fn wait(&self, event: &str) -> Value {
        for _ in 0..100 {
            if let Some(line) = self.0.lock().unwrap().iter().find(|l| l["event"] == event) {
                return line.clone();
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        panic!("no {event} line in {:?}", self.0.lock().unwrap());
    }
}

async fn endpoint(alpns: Vec<Vec<u8>>) -> Endpoint {
    Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .alpns(alpns)
        .bind()
        .await
        .unwrap()
}

/// Everything a stream sends until it closes.
async fn read_all(recv: &mut iroh::endpoint::RecvStream) -> Vec<Incoming> {
    let mut decoder = Decoder::default();
    let mut frames = vec![];
    let mut buf = vec![0u8; 4096];
    while let Ok(Ok(Some(n))) =
        tokio::time::timeout(Duration::from_secs(5), recv.read(&mut buf)).await
    {
        frames.extend(decoder.push(&buf[..n]).unwrap());
    }
    frames
}

/// A tab of wire version 1 says hello, with a frame of its own JSON lines behind it in the same write: the hub
/// answers `update` and the version it speaks in place of its hello, reads nothing more, and closes; its timeline says
/// so, and that it is not the one to follow.
#[tokio::test]
async fn the_hub_refuses_an_older_hello_with_update() {
    let (aven, tab) = (endpoint(vec![ALPN.to_vec()]).await, endpoint(vec![]).await);
    let lines = Lines::default();
    let members = Members::parse(&format!("alice={}", tab.id())).unwrap();
    let hub = Hub::new("aven-peer".into(), members, lines.notes(), None);
    let _router = Router::builder(aven.clone()).accept(ALPN, hub).spawn();

    let conn = tab.connect(aven.addr(), ALPN).await.unwrap();
    let (mut send, mut recv) = conn.open_bi().await.unwrap();
    send.write_all(
        b"{\"frame\":\"hello\",\"peer\":\"alice\",\"wire\":1}\n{\"frame\":\"beat\",\"n\":1}\n",
    )
    .await
    .unwrap();
    assert_eq!(
        read_all(&mut recv).await,
        [Incoming::Greeting(Greeting::Update {
            wire: wire::VERSION
        })]
    );
    let update = lines.wait("update").await;
    assert_eq!(update["from"], "alice");
    assert_eq!(update["theirs"], 1);
    assert_eq!(update["mine"], wire::VERSION);
    assert_eq!(update["follows"], false);
}

/// An Aven Peer a version ahead, as a stand-in: it reads the hello and answers `update` in its place.
#[derive(Debug, Clone)]
struct Ahead(Arc<Mutex<Vec<Incoming>>>);

impl ProtocolHandler for Ahead {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        let (mut send, mut recv) = conn.accept_bi().await?;
        let mut decoder = Decoder::default();
        let mut buf = vec![0u8; 4096];
        let n = recv
            .read(&mut buf)
            .await
            .map_err(AcceptError::from_err)?
            .unwrap_or(0);
        if let Some(g) = decoder.greeting(&buf[..n]).ok().flatten() {
            self.0.lock().unwrap().push(Incoming::Greeting(g));
        }
        send.write_all(
            &Greeting::Update {
                wire: wire::VERSION + 1,
            }
            .line(),
        )
        .await
        .map_err(AcceptError::from_err)?;
        let _ = send.finish();
        let _ = tokio::time::timeout(Duration::from_secs(2), send.stopped()).await;
        Ok(())
    }
}

/// A Peer one version behind the Aven Peer it dials: refused with `update`, it says `update` on its timeline as the one
/// that follows, and doesn't dial again for a minute unless woken. It never upgrades itself.
#[tokio::test]
async fn a_link_behind_says_update_and_follows() {
    let (aven, me) = (endpoint(vec![ALPN.to_vec()]).await, endpoint(vec![]).await);
    let heard = Arc::new(Mutex::new(vec![]));
    let _router = Router::builder(aven.clone())
        .accept(ALPN, Ahead(heard.clone()))
        .spawn();
    let lines = Lines::default();
    let run = tokio::spawn(link::run(
        me,
        "alice-peer".into(),
        link::fixed(aven.addr()),
        "aven-peer".into(),
        lines.notes(),
        None,
        None,
        None,
        None,
    ));
    let update = lines.wait("update").await;
    assert_eq!(update["to"], "aven-peer");
    assert_eq!(update["mine"], wire::VERSION);
    assert_eq!(update["theirs"], wire::VERSION + 1);
    assert_eq!(update["follows"], true);
    let lost = lines.wait("lost").await;
    assert!(
        lost["why"].as_str().unwrap().contains("update to join"),
        "{lost}"
    );
    // its hello named its version, and nothing came before the answer
    tokio::time::sleep(Duration::from_secs(1)).await;
    let heard = heard.lock().unwrap().clone();
    assert_eq!(
        heard,
        [Incoming::Greeting(Greeting::Hello {
            peer: "alice-peer".into(),
            wire: wire::VERSION
        })]
    );
    // one dial, then a minute's wait
    tokio::time::sleep(Duration::from_secs(2)).await;
    let dials = lines
        .0
        .lock()
        .unwrap()
        .iter()
        .filter(|l| l["event"] == "update")
        .count();
    assert_eq!(dials, 1);
    run.abort();
}
