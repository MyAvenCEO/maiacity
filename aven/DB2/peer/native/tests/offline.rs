//! Offline first at a peer's edge (`aven_peer::chats`, `aven_peer::link::{remember, recall}`; Lean's
//! `Aven.DB.Chains.own_store_never_forks`): a device whose store holds its key writes on its chain at once, offline,
//! and every line is in its store before any peer has it, so a reload, and another, keep it; on reconnect the Aven
//! Peer takes what it missed and ends with exactly the device's chain. A device whose store doesn't hold its key (a key
//! given apart from its store) still learns its head first, but what it writes until then is kept in its store too,
//! and survives a reload. And the network a Peer-Light was told is kept in its store, checked again when read back.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};

use aven_db_core::chain::{Answer, Body};
use aven_db_core::wire::Frame;
use aven_db_store::{RefName, backend};
use aven_peer::Notes;
use aven_peer::chats::{self, Chats};
use aven_peer::members::Gate;
use iroh::SecretKey;
use serde_json::Value;

#[derive(Clone, Default)]
struct Told(Arc<Mutex<Vec<Value>>>);

impl Told {
    fn notes(&self) -> Notes {
        let told = self.0.clone();
        Arc::new(move |line: String| {
            told.lock()
                .unwrap()
                .push(serde_json::from_str(&line).unwrap())
        })
    }

    fn chat(&self) -> Vec<(String, bool)> {
        let told = self.0.lock().unwrap();
        told.iter()
            .filter(|l| l["event"] == "chat")
            .map(|l| (l["text"].as_str().unwrap().to_string(), l["queued"] == true))
            .collect()
    }
}

fn key(seed: u8) -> SecretKey {
    SecretKey::from_bytes(&[seed; 32])
}

fn gate(keys: &[&SecretKey]) -> Gate {
    let gate = Gate::default();
    gate.set(
        keys.iter()
            .enumerate()
            .map(|(i, k)| (k.public(), format!("peer {i}"), None))
            .collect::<Vec<_>>(),
    );
    gate
}

fn memory() -> chats::Shared {
    Arc::new(backend::memory().unwrap())
}

async fn open(name: &str, secret: &SecretKey, gate: &Gate, store: &chats::Shared) -> (Chats, Told) {
    let told = Told::default();
    let chats = Chats::open(
        name.into(),
        "aven",
        secret.clone(),
        gate.clone(),
        told.notes(),
        store.clone(),
    )
    .await
    .unwrap();
    (chats, told)
}

/// What `from` answers what `to` holds, taken by `to`: one catch-up through the frames, page by page.
async fn catch_up(to: &Chats, from: &Chats) {
    let devices = from.heads_told().into_iter().map(|h| h.device);
    for page in to.catch_up_frames(devices) {
        let Frame::CatchUp { holds, only } = page else {
            panic!()
        };
        for frame in from.answer(&holds, only).await {
            let Frame::Lines { lines } = frame else {
                panic!()
            };
            for line in lines {
                to.take(line.as_bytes()).await;
            }
        }
    }
}

/// What `to` misses of `from`'s own chain, sent as on reconnect (`unsent`) and taken by `to`.
async fn upload(from: &Chats, to: &Chats) {
    for frame in from.unsent(&to.heads_told()).await {
        let Frame::Lines { lines } = frame else {
            panic!()
        };
        for line in lines {
            assert!(matches!(to.take(line.as_bytes()).await, Answer::Moved(_)));
        }
    }
}

/// A Peer-Light's store: its device secret under `device-key`, as `deviceSecret` keeps it.
async fn holding_secret(store: &chats::Shared, secret: &SecretKey) {
    let hex: String = secret
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let blob = store.put(hex.into_bytes().into()).await.unwrap();
    store
        .set_ref(&RefName::new("device-key").unwrap(), None, blob)
        .await
        .unwrap();
}

#[tokio::test]
async fn a_store_that_holds_its_key_writes_at_once_and_keeps_it() {
    let (aven, alice) = (key(1), key(2));
    let gate = gate(&[&aven, &alice]);
    let (hub_store, store) = (memory(), memory());
    let (hub, _) = open("aven", &aven, &gate, &hub_store).await;
    hub.learn().await;
    holding_secret(&store, &alice).await;

    // offline from the very start: it knows its head (its store is its truth), so a line is chained and kept at once
    let (a, told) = open("alice", &alice, &gate, &store).await;
    assert!(a.learned());
    let one = a
        .write(Body::Text("one, offline".into()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!((one.seq, one.prev.as_deref()), (1, None));
    assert_eq!(told.chat(), [("one, offline".to_string(), false)]);

    // two reloads, still offline: the line is there each time, and the next continues it
    let (_, told) = open("alice", &alice, &gate, &store).await;
    assert_eq!(told.chat(), [("one, offline".to_string(), false)]);
    let (a, told) = open("alice", &alice, &gate, &store).await;
    assert_eq!(told.chat(), [("one, offline".to_string(), false)]);
    let two = a
        .write(Body::Text("two, offline".into()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(two.seq, 2);

    // back online: the Aven Peer takes both and holds exactly her chain
    upload(&a, &hub).await;
    assert_eq!(hub.have(&alice.public().to_string()), 2);

    // offline again after the Aven Peer has some: her next line continues on top, and only it goes out
    let (a, _) = open("alice", &alice, &gate, &store).await;
    a.write(Body::Text("three".into())).await.unwrap().unwrap();
    upload(&a, &hub).await;
    let alice_ref = RefName::new(format!("chat-{}", alice.public())).unwrap();
    assert_eq!(
        hub_store.get_ref(&alice_ref).await.unwrap(),
        store.get_ref(&alice_ref).await.unwrap()
    );
}

#[tokio::test]
async fn a_key_given_apart_learns_first_and_keeps_what_waits() {
    let (aven, alice) = (key(1), key(2));
    let gate = gate(&[&aven, &alice]);
    let (hub_store, old, fresh) = (memory(), memory(), memory());
    let (hub, _) = open("aven", &aven, &gate, &hub_store).await;
    hub.learn().await;
    // her chain at the Aven Peer, written from a store that has since been lost (her key kept apart: a native Peer's
    // --secret, the box's cast)
    holding_secret(&old, &alice).await;
    let (a, _) = open("alice", &alice, &gate, &old).await;
    a.write(Body::Text("before".into())).await.unwrap().unwrap();
    upload(&a, &hub).await;

    // a fresh store with the same key can't tell it from a lost one: it waits to learn its head, but keeps what it
    // writes until then in its store, so a reload shows it again, still waiting
    let (f, told) = open("alice", &alice, &gate, &fresh).await;
    assert!(!f.learned());
    assert_eq!(f.write(Body::Text("waiting".into())).await, Ok(None));
    assert_eq!(told.chat(), [("waiting".to_string(), true)]);
    let (f, told) = open("alice", &alice, &gate, &fresh).await;
    assert!(!f.learned());
    assert_eq!(told.chat(), [("waiting".to_string(), true)]);

    // it learns its head: the line it kept continues her chain, never a fork of it
    catch_up(&f, &hub).await;
    let lines = f.learn().await;
    assert_eq!(lines.iter().map(|l| l.seq).collect::<Vec<_>>(), [2]);
    for line in &lines {
        assert!(matches!(hub.take(&line.blob()).await, Answer::Moved(_)));
    }
    // and now the store is its key's: a reload knows its head at once, and nothing waits any more
    let (f, told) = open("alice", &alice, &gate, &fresh).await;
    assert!(f.learned());
    assert_eq!(
        told.chat(),
        [
            ("before".to_string(), false),
            ("waiting".to_string(), false)
        ]
    );
}

#[tokio::test]
async fn another_keys_secret_is_not_its_own() {
    let (alice, bob) = (key(2), key(3));
    let gate = gate(&[&alice, &bob]);
    let store = memory();
    holding_secret(&store, &bob).await;
    let (a, _) = open("alice", &alice, &gate, &store).await;
    assert!(!a.learned());
}
