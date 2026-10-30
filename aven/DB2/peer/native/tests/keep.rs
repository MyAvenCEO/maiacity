//! A file's way (store/README.md, "How a file travels"), natively, as the box runs it: an Aven Peer with its relay in
//! this process, and members reaching it through the relay only. Alice shares a folder: a file landing in it is put
//! as a hash sequence and handed to her announcement; the Aven Peer, told of it as it is of a `file` line on Alice's
//! chain, fetches the whole file from Alice through iroh-blobs and keeps it; once Alice is gone, Bob fetches it from
//! the Aven Peer. A size that isn't the file's is dropped, not kept.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use aven_db_store::blobs::{Blobs, Shared};
use aven_db_store::{Store, backend, files};
use aven_peer::members::{Gate, Hook};
use aven_peer::relay::Allow;
use aven_peer::keep::{self, Shared as Put};
use aven_peer::{Notes, blobs};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl, SecretKey};
use serde_json::Value;

#[derive(Clone, Default)]
struct Lines(Arc<Mutex<Vec<Value>>>);

impl Lines {
    fn notes(&self) -> Notes {
        let lines = self.0.clone();
        Arc::new(move |line: String| lines.lock().unwrap().push(serde_json::from_str(&line).unwrap()))
    }

    async fn wait(&self, want: impl Fn(&Value) -> bool) -> Option<Value> {
        for _ in 0..300 {
            if let Some(line) = self.0.lock().unwrap().iter().find(|l| want(l)).cloned() {
                return Some(line);
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        None
    }
}

struct Peer {
    lines: Lines,
    store: Arc<backend::DalStore>,
    held: Blobs,
    router: Router,
    endpoint: Endpoint,
}

async fn peer(name: &str, secret: SecretKey, relay: &RelayUrl, gate: Gate, aven: Option<EndpointAddr>) -> Peer {
    let lines = Lines::default();
    let mut builder = Endpoint::builder(presets::Minimal)
        .secret_key(secret.clone())
        .relay_mode(RelayMode::Custom(RelayMap::from(relay.clone())))
        .alpns(vec![blobs::ALPN.to_vec()])
        .hooks(Hook { me: name.into(), gate: gate.clone(), notes: lines.notes() })
        .clear_ip_transports();
    if aven.is_none() {
        builder = builder.bind_addr("127.0.0.1:0").unwrap();
    }
    let endpoint = builder.bind().await.unwrap();
    if let Some(addr) = aven {
        aven_peer::know(&endpoint, addr);
    }
    let store = Arc::new(backend::memory().unwrap());
    let held = Blobs::new(store.clone());
    let router = Router::builder(endpoint.clone())
        .accept(blobs::ALPN, blobs::provider(&held, name.into(), gate.clone(), lines.notes()))
        .spawn();
    Peer { lines, store, held, router, endpoint }
}

#[tokio::test(flavor = "multi_thread")]
async fn a_shared_file_is_kept_by_the_aven_peer_and_served_once_its_sender_is_gone() {
    let key = |seed: u8| SecretKey::from_bytes(&[seed; 32]);
    let (aven, alice, bob) = (key(11), key(12), key(13));
    let members = [(aven.public(), "aven-peer"), (alice.public(), "alice"), (bob.public(), "bob")];
    let gate = || {
        let gate = Gate::default();
        gate.set(members.map(|(k, n)| (k, n.to_string(), None)));
        gate
    };
    let mut relay = iroh_relay::server::RelayConfig::new(([127, 0, 0, 1], 0));
    relay.access = Arc::new(Allow { me: "aven-peer".into(), gate: gate(), door: None, notes: Lines::default().notes() });
    let mut server = iroh_relay::server::ServerConfig::default();
    server.relay = Some(relay);
    let server = iroh_relay::server::Server::spawn(server).await.unwrap();
    let url: RelayUrl = format!("http://{}", server.http_addr().unwrap()).parse().unwrap();

    let hub = peer("aven-peer", aven.clone(), &url, gate(), None).await;
    let addr = EndpointAddr::new(aven.public()).with_relay_url(url.clone());
    let a = peer("alice", alice.clone(), &url, gate(), Some(addr.clone())).await;
    let b = peer("bob", bob, &url, gate(), Some(addr.clone())).await;

    // Alice's folder: a file written beside it, then moved in, as the box's check writes one
    let dir = std::env::temp_dir().join(format!("aven-files-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut x = 0x2545_f491_4f6c_dd1du64;
    let bytes: Vec<u8> = (0..3 * files::CHUNK + 4321)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x as u8
        })
        .collect();
    std::fs::write(dir.join("movie.mp4.part"), &bytes).unwrap();
    std::fs::rename(dir.join("movie.mp4.part"), dir.join("movie.mp4")).unwrap();
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<Put>();
    let announce = move |put: Put| {
        let tx = tx.clone();
        async move {
            tx.send(put).unwrap();
        }
    };
    tokio::spawn(keep::share(dir.clone(), a.store.clone(), announce, "alice".into(), a.lines.notes()));
    let put = tokio::time::timeout(Duration::from_secs(30), rx.recv()).await.unwrap().unwrap();
    assert_eq!((put.size, put.name.as_str(), put.mime.as_str()), (bytes.len() as u64, "movie.mp4", "video/mp4"));
    assert!(a.lines.wait(|l| l["event"] == "shared").await.is_some());
    assert_eq!(a.store.get_ref(&keep::file_ref(&put.index)).await.unwrap(), Some(put.index));

    // the Aven Peer's rule, as it runs for a file line on Alice's chain: a size that isn't the file's is dropped
    let hub_notes = hub.lines.notes();
    let rule = |size| keep::keep(&hub.endpoint, &url, &hub.held, &*hub.store, alice.public(), put.index, size, "aven-peer", &hub_notes);
    // dropped, and never asked again: Alice's file isn't the size the line says
    let refused = rule(put.size + 1).await.unwrap_err();
    assert_eq!(refused, keep::KeepError::Mismatch { held: put.size, announced: put.size + 1 });
    assert!(!refused.retry());
    // a file Alice never had: not found, never asked again either
    let never = aven_db_store::Hash::of(b"a file nobody shared");
    let missing = keep::keep(&hub.endpoint, &url, &hub.held, &*hub.store, alice.public(), never, 1, "aven-peer", &hub_notes)
        .await
        .unwrap_err();
    assert!(matches!(missing, keep::KeepError::NotFound(_)), "{missing:?}");
    assert!(!missing.retry());
    // an index that is no list of hashes: refused, never asked again
    let odd = a.store.put(bytes::Bytes::from(vec![7u8; 33])).await.unwrap();
    let malformed = keep::keep(&hub.endpoint, &url, &hub.held, &*hub.store, alice.public(), odd, 33, "aven-peer", &hub_notes)
        .await
        .unwrap_err();
    assert!(matches!(malformed, keep::KeepError::Malformed(_)), "{malformed:?}");
    assert!(!malformed.retry());
    assert!(hub.lines.wait(|l| l["event"] == "dropped").await.is_some());
    assert_eq!(hub.store.get_ref(&keep::file_ref(&put.index)).await.unwrap(), None);
    let crossed = rule(put.size).await.unwrap();
    assert_eq!(crossed, 0, "nothing crosses again: the refused try's blobs are held, only unkept");
    assert!(hub.lines.wait(|l| l["event"] == "kept").await.is_some());
    assert_eq!(hub.store.get_ref(&keep::file_ref(&put.index)).await.unwrap(), Some(put.index));
    assert_eq!(rule(put.size).await.unwrap(), 0, "a file kept already");

    // Alice goes; Bob fetches the whole file from the Aven Peer
    a.router.shutdown().await.unwrap();
    a.endpoint.close().await;
    let mine: Shared = Arc::new(backend::memory().unwrap());
    let conn = b.endpoint.connect(addr, blobs::ALPN).await.unwrap();
    Blobs::new(mine.clone()).fetch_file(&conn, put.index).await.unwrap();
    let file = files::open(&*mine, &put.index).await.unwrap().unwrap();
    assert_eq!(file.read(&*mine, 0..file.len).await.unwrap().unwrap(), bytes);
    std::fs::remove_dir_all(&dir).ok();
}
