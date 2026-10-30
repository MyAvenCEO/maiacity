//! Deleting a line at a peer's edge (`aven_peer::chats`, `Aven.DB.Chains` "Deleting a line"), without a network: what
//! counts is `aven_db_core::chain`'s, tested against Lean's traces; here the store and the page. A delete is a
//! retraction on the deleting device's chain; the deleted line's blob leaves the store, `gone-<id>` names the retraction,
//! a reload walks the chain past it and shows the line deleted in place, and catching up sends the retraction in its
//! place. A file no line names any more leaves the store. Only the line's own vault deletes it, from any of its devices.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};

use aven_db_core::chain::{Answer, Body, Retraction};
use aven_db_core::files::Announcement;
use aven_db_core::wire::Frame;
use aven_db_store::{Hash, RefName, backend, files};
use aven_peer::Notes;
use aven_peer::chats::{self, Chats};
use aven_peer::members::Gate;
use bytes::Bytes;
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

    /// The page's lines as it shows them, each once, by its name: its text, or `deleted`.
    fn shown(&self) -> Vec<String> {
        let mut out: Vec<(String, String)> = vec![];
        for l in self.0.lock().unwrap().iter().filter(|l| l["event"] == "chat") {
            let id = l["id"].as_str().unwrap().to_string();
            let said = match l["deleted"].as_bool() {
                Some(true) => "deleted".to_string(),
                _ => l["text"].as_str().unwrap().to_string(),
            };
            match out.iter_mut().find(|(i, _)| *i == id) {
                Some(seen) => seen.1 = said,
                None => out.push((id, said)),
            }
        }
        out.into_iter().map(|(_, s)| s).collect()
    }
}

fn key(seed: u8) -> SecretKey {
    SecretKey::from_bytes(&[seed; 32])
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

/// Everything `from` holds that `to` misses, taken by `to`.
async fn catch_up(to: &Chats, from: &Chats) {
    let devices: Vec<String> = from.heads().into_iter().map(|(d, _)| d).collect();
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

fn id(line: &aven_db_core::chain::Line) -> String {
    Hash::of(&line.blob()).to_hex()
}

#[tokio::test]
async fn a_delete_takes_the_text_out_of_every_store_and_keeps_the_chain() {
    let (aven, alice, alice2, bob) = (key(1), key(2), key(3), key(4));
    let gate = Gate::default();
    gate.set(vec![
        (aven.public(), "aven".into(), Some("Aven".into())),
        (alice.public(), "alice".into(), Some("Alice".into())),
        (alice2.public(), "alice2".into(), Some("Alice".into())),
        (bob.public(), "bob".into(), Some("Bob".into())),
    ]);
    let (hub_store, alice_store) = (memory(), memory());
    let (hub, hub_told) = open("aven", &aven, &gate, &hub_store).await;
    hub.learn().await;
    let (a, _) = open("alice", &alice, &gate, &alice_store).await;
    a.learn().await;

    let mut lines = vec![];
    for text in ["hello", "a secret", "still here"] {
        let line = a.write(Body::Text(text.into())).await.unwrap().unwrap();
        assert!(matches!(hub.take(&line.blob()).await, Answer::Moved(_)));
        lines.push(line);
    }
    let secret = id(&lines[1]);
    let hash: Hash = secret.parse().unwrap();
    let gone = RefName::new(format!("gone-{secret}")).unwrap();

    // Bob can't delete Alice's line: refused at his own peer, and a retraction he signs anyway counts for nothing
    let (b, _) = open("bob", &bob, &gate, &memory()).await;
    b.learn().await;
    catch_up(&b, &hub).await;
    assert!(b.retract(&secret).await.is_err());
    let forged = b
        .write(Body::Retract(Retraction::of(&secret, &lines[1])))
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(hub.take(&forged.blob()).await, Answer::Moved(_)));
    assert!(hub_store.has(&hash).await.unwrap());
    assert_eq!(hub_told.shown(), ["hello", "a secret", "still here"]);

    // Alice deletes it: shown deleted in place at once, its blob gone from her store, `gone-<id>` naming the delete
    let (a, told) = open("alice", &alice, &gate, &alice_store).await;
    let retraction = a.retract(&secret).await.unwrap().unwrap();
    assert_eq!(told.shown(), ["hello", "deleted", "still here"]);
    assert!(!alice_store.has(&hash).await.unwrap());
    assert_eq!(
        alice_store.get_ref(&gone).await.unwrap(),
        Some(Hash::of(&retraction.blob()))
    );
    assert!(a.retract(&id(&retraction)).await.is_err(), "a delete is never undone");

    // the Aven Peer takes the delete: the text leaves its store (its S3 bucket in production) too
    assert!(matches!(hub.take(&retraction.blob()).await, Answer::Moved(_)));
    assert!(!hub_store.has(&hash).await.unwrap());
    assert_eq!(hub_told.shown(), ["hello", "deleted", "still here"]);

    // a reload walks the chain past it, shows it deleted, and writes on top of the same chain
    let (a, told) = open("alice", &alice, &gate, &alice_store).await;
    assert_eq!(told.shown(), ["hello", "deleted", "still here"]);
    let after = a.write(Body::Text("after".into())).await.unwrap().unwrap();
    assert_eq!(after.seq, 5);
    assert!(matches!(hub.take(&after.blob()).await, Answer::Moved(_)));

    // a late joiner, Alice's second device, catches up from the Aven Peer: the delete comes in the line's place, so the
    // text never reaches it and its chain of Alice goes on past it
    let alice2_store = memory();
    let (a2, told) = open("alice2", &alice2, &gate, &alice2_store).await;
    catch_up(&a2, &hub).await;
    a2.learn().await;
    assert_eq!(told.shown(), ["hello", "deleted", "still here", "after"]);
    assert!(!alice2_store.has(&hash).await.unwrap());
    assert_eq!(a2.have(&alice.public().to_string()), 5);

    // from her second device Alice deletes another of her lines; Bob's peer, holding it, drops it too
    let first = id(&lines[0]);
    let from_two = a2.retract(&first).await.unwrap().unwrap();
    assert!(matches!(b.take(&from_two.blob()).await, Answer::Moved(_)));
    assert!(!b.store().has(&first.parse().unwrap()).await.unwrap());
}

#[tokio::test]
async fn a_file_leaves_the_store_once_no_line_names_it() {
    let (aven, alice, bob) = (key(1), key(2), key(4));
    let gate = Gate::default();
    gate.set(vec![
        (aven.public(), "aven".into(), Some("Aven".into())),
        (alice.public(), "alice".into(), Some("Alice".into())),
        (bob.public(), "bob".into(), Some("Bob".into())),
    ]);
    let hub_store = memory();
    let (hub, _) = open("aven", &aven, &gate, &hub_store).await;
    hub.learn().await;
    // two chunks, one a chunk of another file too
    let shared = Bytes::from(vec![7u8; files::CHUNK as usize]);
    let index = files::put(&*hub_store, [shared.clone(), Bytes::from_static(b"the end")])
        .await
        .unwrap();
    let other = files::put(&*hub_store, [shared.clone()]).await.unwrap();
    let file_ref = RefName::new(format!("file-{index}")).unwrap();
    hub_store.set_ref(&file_ref, None, index).await.unwrap();
    let file = |name: &str| Announcement {
        file: index.to_hex(),
        size: files::CHUNK + 7,
        name: name.into(),
        kind: "video/mp4".into(),
    };
    let other_file = Announcement {
        file: other.to_hex(),
        size: files::CHUNK,
        name: "other.mp4".into(),
        kind: "video/mp4".into(),
    };

    let (a, _) = open("alice", &alice, &gate, &memory()).await;
    a.learn().await;
    let (b, _) = open("bob", &bob, &gate, &memory()).await;
    b.learn().await;
    let mine = a.write(Body::File(file("dome.mp4"))).await.unwrap().unwrap();
    let his = b.write(Body::File(file("same.mp4"))).await.unwrap().unwrap();
    let kept = b.write(Body::File(other_file)).await.unwrap().unwrap();
    for line in [&mine, &his, &kept] {
        assert!(matches!(hub.take(&line.blob()).await, Answer::Moved(_)));
    }

    // Alice deletes hers: Bob's line still names the file, so its bytes stay
    let gone = a.retract(&id(&mine)).await.unwrap().unwrap();
    hub.take(&gone.blob()).await;
    assert!(hub_store.has(&index).await.unwrap());
    assert!(hub.names(&index.to_hex()));

    // Bob deletes his: the file leaves, but the chunk another file lists
    let gone = b.retract(&id(&his)).await.unwrap().unwrap();
    hub.take(&gone.blob()).await;
    assert!(!hub_store.has(&index).await.unwrap());
    assert_eq!(hub_store.get_ref(&file_ref).await.unwrap(), None);
    assert!(!hub_store.has(&Hash::of(b"the end")).await.unwrap());
    assert!(hub_store.has(&Hash::of(&shared)).await.unwrap());
    assert!(hub_store.has(&other).await.unwrap());
}
