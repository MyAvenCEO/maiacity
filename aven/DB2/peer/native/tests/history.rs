//! The chat's history at a peer's edge (`aven_peer::chats`, store/README.md "The chat keeps its history"), without a
//! network: what the chains do is `aven_db_core::chain`'s, tested against Lean's traces; here the store and the frames.
//! Lines rest as blobs and `chat-<device>` follows the head; a reopened store shows the whole chat again, in order; a
//! peer catches up through the frames the Aven Peer answers (`heads`, `catch_up`, `lines`), and sends back what it
//! wrote offline; a fork is raised and never moves a head.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};

use aven_db_core::chain::{Answer, Line};
use aven_db_core::wire::Frame;
use aven_db_store::{Hash, RefName, Store, backend};
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
        Arc::new(move |line: String| told.lock().unwrap().push(serde_json::from_str(&line).unwrap()))
    }

    fn texts(&self) -> Vec<String> {
        let told = self.0.lock().unwrap();
        told.iter()
            .filter(|l| l["event"] == "chat")
            .map(|l| l["text"].as_str().unwrap().to_string())
            .collect()
    }

    fn events(&self, event: &str) -> usize {
        self.0.lock().unwrap().iter().filter(|l| l["event"] == event).count()
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

async fn open(name: &str, secret: &SecretKey, gate: &Gate, store: &chats::Shared) -> (Chats, Told) {
    let told = Told::default();
    let chats = Chats::open(name.into(), "aven", secret.clone(), gate.clone(), told.notes(), store.clone())
        .await
        .unwrap();
    (chats, told)
}

fn memory() -> chats::Shared {
    Arc::new(backend::memory().unwrap())
}

/// What `from` answers what `to` holds, taken by `to`: one catch-up through the frames.
async fn catch_up(to: &Chats, from: &Chats) {
    let Frame::Heads { heads } = from.heads_frame() else { panic!() };
    let Frame::CatchUp { holds } = to.catch_up_frame(&heads) else { panic!() };
    for frame in from.answer(&holds).await {
        let Frame::Lines { lines } = frame else { panic!() };
        for line in lines {
            to.take(line.as_bytes()).await;
        }
    }
}

#[tokio::test]
async fn history_is_kept_and_caught_up() {
    let (aven, alice, bob) = (key(1), key(2), key(3));
    let gate = gate(&[&aven, &alice, &bob]);
    let (hub_store, alice_store, bob_store) = (memory(), memory(), memory());
    let (hub, _) = open("aven", &aven, &gate, &hub_store).await;
    let (a, _) = open("alice", &alice, &gate, &alice_store).await;

    // Alice writes; each line is in her store at once, chat-<alice> at its head; the Aven Peer takes it from gossip
    let mut blobs = vec![];
    for text in ["one", "two", "three"] {
        let line = a.write(text.into()).await.unwrap();
        assert!(matches!(hub.take(&line.blob()).await, Answer::Moved(_)));
        blobs.push(line.blob());
    }
    let head = Hash::of(blobs.last().unwrap());
    let alice_ref = RefName::new(format!("chat-{}", alice.public())).unwrap();
    assert_eq!(alice_store.get_ref(&alice_ref).await.unwrap(), Some(head));
    assert_eq!(hub_store.get_ref(&alice_ref).await.unwrap(), Some(head));
    assert!(matches!(hub.take(&blobs[0]).await, Answer::Known));

    // a reload: the same store shows the whole chat again, in order
    let (_, told) = open("alice", &alice, &gate, &alice_store).await;
    assert_eq!(told.texts(), ["one", "two", "three"]);

    // Bob joins late, holding nothing, and catches up from the Aven Peer
    let (b, told) = open("bob", &bob, &gate, &bob_store).await;
    catch_up(&b, &hub).await;
    assert_eq!(told.texts(), ["one", "two", "three"]);
    assert_eq!(bob_store.get_ref(&alice_ref).await.unwrap(), Some(head));
    // again, nothing new
    catch_up(&b, &hub).await;
    assert_eq!(told.texts().len(), 3);

    // Bob writes offline; on reconnect the Aven Peer's heads show what it misses, and Bob sends it
    b.write("written offline".into()).await.unwrap();
    let Frame::Heads { heads } = hub.heads_frame() else { panic!() };
    let unsent = b.unsent(&heads).await;
    assert_eq!(unsent.len(), 1);
    for frame in unsent {
        let Frame::Lines { lines } = frame else { panic!() };
        for line in lines {
            assert!(matches!(hub.take(line.as_bytes()).await, Answer::Moved(_)));
        }
    }
    let (_, told) = open("aven", &aven, &gate, &hub_store).await;
    assert_eq!(told.texts(), ["one", "two", "three", "written offline"]);

    // a fork of Alice's chain: a second first line, signed by her key. Raised; her head stays
    let mut fork = Line {
        network: "aven".into(),
        device: alice.public().to_string(),
        seq: 1,
        prev: None,
        at: 1,
        sig: String::new(),
        text: "from a cloned laptop".into(),
    };
    fork.sig = alice.sign(fork.body().as_bytes()).to_bytes().iter().map(|b| format!("{b:02x}")).collect();
    let (hub, told) = open("aven", &aven, &gate, &hub_store).await;
    assert!(matches!(hub.take(&fork.blob()).await, Answer::Fork));
    assert_eq!(told.events("fork"), 1);
    assert_eq!(hub_store.get_ref(&alice_ref).await.unwrap(), Some(head));
}
