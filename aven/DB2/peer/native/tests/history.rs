//! The chat's history at a peer's edge (`aven_peer::chats`, store/README.md "The chat keeps its history"), without a
//! network: what the chains do is `aven_db_core::chain`'s, tested against Lean's traces; here the store and the frames.
//! Lines rest as blobs and `chat-<device>` follows the head; a reopened store shows the whole chat again, in order; a
//! peer catches up through the frames the Aven Peer answers (`heads`, `catch_up`, `lines`), and sends back what it
//! wrote offline; a fork is raised and never moves a head.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};

use aven_db_core::chain::{Answer, Body, Line};
use aven_db_core::wire::{Frame, Head, MAX_FRAME, encode};
use aven_db_store::{Hash, RefName, backend};
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

    fn texts(&self) -> Vec<String> {
        let told = self.0.lock().unwrap();
        told.iter()
            .filter(|l| l["event"] == "chat")
            .map(|l| l["text"].as_str().unwrap().to_string())
            .collect()
    }

    fn events(&self, event: &str) -> usize {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|l| l["event"] == event)
            .count()
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

fn memory() -> chats::Shared {
    Arc::new(backend::memory().unwrap())
}

/// Every head `from` holds, through the pages of one telling, each a frame under the wire's limit.
fn heads(from: &Chats) -> Vec<Head> {
    let pages = from.heads_frames();
    let mut out = vec![];
    for (i, page) in pages.iter().enumerate() {
        assert!(
            encode(page).len() <= MAX_FRAME,
            "a heads page of {} bytes",
            encode(page).len()
        );
        let Frame::Heads { heads, more } = page else {
            panic!()
        };
        assert_eq!(
            *more,
            i + 1 < pages.len(),
            "only the last page ends the telling"
        );
        out.extend(heads.iter().cloned());
    }
    out
}

/// What `from` answers what `to` holds, taken by `to`: one catch-up through the frames, every one of them, the pages
/// of `catch_up` and the `lines` of the answer, under the wire's limit.
async fn catch_up(to: &Chats, from: &Chats) {
    let heads = heads(from);
    for page in to.catch_up_frames(heads.into_iter().map(|h| h.device)) {
        assert!(
            encode(&page).len() <= MAX_FRAME,
            "a catch_up page of {} bytes",
            encode(&page).len()
        );
        let Frame::CatchUp { holds, only } = page else {
            panic!()
        };
        for frame in from.answer(&holds, only).await {
            assert!(encode(&frame).len() <= MAX_FRAME);
            let Frame::Lines { lines } = frame else {
                panic!()
            };
            for line in lines {
                to.take(line.as_bytes()).await;
            }
        }
    }
}

#[tokio::test]
async fn history_is_kept_and_caught_up() {
    let (aven, alice, bob) = (key(1), key(2), key(3));
    let gate = gate(&[&aven, &alice, &bob]);
    let (hub_store, alice_store, bob_store) = (memory(), memory(), memory());
    let (hub, _) = open("aven", &aven, &gate, &hub_store).await;
    hub.learn().await;
    let (a, _) = open("alice", &alice, &gate, &alice_store).await;
    a.learn().await;

    // Alice writes; each line is in her store at once, chat-<alice> at its head; the Aven Peer takes it from gossip
    let mut blobs = vec![];
    for text in ["one", "two", "three"] {
        let line = a.write(Body::Text(text.into())).await.unwrap().unwrap();
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
    b.learn().await;
    assert_eq!(told.texts(), ["one", "two", "three"]);
    assert_eq!(bob_store.get_ref(&alice_ref).await.unwrap(), Some(head));
    // again, nothing new
    catch_up(&b, &hub).await;
    assert_eq!(told.texts().len(), 3);

    // Bob writes offline; on reconnect the Aven Peer's heads show what it misses, and Bob sends it
    b.write(Body::Text("written offline".into())).await.unwrap();
    let unsent = b.unsent(&heads(&hub)).await;
    assert_eq!(unsent.len(), 1);
    for frame in unsent {
        let Frame::Lines { lines } = frame else {
            panic!()
        };
        for line in lines {
            assert!(matches!(hub.take(line.as_bytes()).await, Answer::Moved(_)));
        }
    }
    let (_, told) = open("aven", &aven, &gate, &hub_store).await;
    assert_eq!(told.texts(), ["one", "two", "three", "written offline"]);

    // a fresh profile with Alice's key: what it writes before it learns its head waits, unchained, and then continues
    // her chain, never a fork of it (Aven.DB.Chains.learned_never_forks)
    let fresh_store = memory();
    let (fresh, told) = open("alice", &alice, &gate, &fresh_store).await;
    assert_eq!(
        fresh.write(Body::Text("from a fresh profile".into())).await,
        Ok(None)
    );
    assert_eq!(told.texts(), ["from a fresh profile"]);
    catch_up(&fresh, &hub).await;
    let lines = fresh.learn().await;
    assert_eq!(lines.len(), 1);
    assert_eq!(
        (lines[0].seq, lines[0].prev.as_deref()),
        (4, Some(head.to_hex().as_str()))
    );
    assert!(matches!(hub.take(&lines[0].blob()).await, Answer::Moved(_)));
    let head = Hash::of(&lines[0].blob());

    // a fork of Alice's chain: a second first line, signed by her key. Raised; her head stays
    let mut fork = Line {
        network: "aven".into(),
        device: alice.public().to_string(),
        seq: 1,
        prev: None,
        at: 1,
        sig: String::new(),
        body: Body::Text("from a cloned laptop".into()),
    };
    fork.sig = alice
        .sign(fork.signs().as_bytes())
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let (hub, told) = open("aven", &aven, &gate, &hub_store).await;
    assert!(matches!(hub.take(&fork.blob()).await, Answer::Fork));
    assert_eq!(told.events("fork"), 1);
    assert_eq!(hub_store.get_ref(&alice_ref).await.unwrap(), Some(head));
}

/// A device's first line, signed by its key, as its own peer would write it.
fn first_line(secret: &SecretKey, text: &str) -> Vec<u8> {
    let mut line = Line {
        network: "aven".into(),
        device: secret.public().to_string(),
        seq: 1,
        prev: None,
        at: 1,
        sig: String::new(),
        body: Body::Text(text.into()),
    };
    line.sig = secret
        .sign(line.signs().as_bytes())
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    line.blob()
}

#[tokio::test]
async fn catching_up_on_many_devices_stays_under_the_frame_limit() {
    // every browser reset adds a device: in one frame each, `heads` and `catch_up` passed the wire's 64 KiB at about
    // 400 of them, and catching up broke for everyone. In pages (`Aven.DB.Wire.headsPages`, `catchUpPages`) it holds
    // at any number
    let devices: Vec<SecretKey> = (0..600u16)
        .map(|i| {
            let mut seed = [7u8; 32];
            seed[..2].copy_from_slice(&i.to_le_bytes());
            SecretKey::from_bytes(&seed)
        })
        .collect();
    let (aven, bob) = (key(1), key(3));
    let mut all: Vec<&SecretKey> = devices.iter().collect();
    all.extend([&aven, &bob]);
    let gate = gate(&all);
    let (hub, _) = open("aven", &aven, &gate, &memory()).await;
    hub.learn().await;
    for (i, d) in devices.iter().enumerate() {
        let blob = first_line(d, &format!("line {i}"));
        assert!(matches!(hub.take(&blob).await, Answer::Moved(_)));
    }
    assert!(hub.heads_frames().len() >= 5, "600 heads are several pages");

    let (b, told) = open("bob", &bob, &gate, &memory()).await;
    catch_up(&b, &hub).await;
    assert_eq!(told.texts().len(), 600);
    // and the Aven Peer's answer to a page names only that page's chains
    catch_up(&b, &hub).await;
    assert_eq!(told.texts().len(), 600);
}
