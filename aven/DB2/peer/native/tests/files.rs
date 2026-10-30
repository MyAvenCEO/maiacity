//! A file's way (store/README.md, "How a file travels"), natively, as the box runs it: an Aven Peer with its relay in
//! this process, and members reaching it through the relay only. Alice shares a folder: a file landing in it is put
//! as a hash sequence and announced in the room; the Aven Peer hears the announcement, fetches the whole file from
//! Alice through iroh-blobs and keeps it; once Alice is gone, Bob fetches it from the Aven Peer.
#![cfg(feature = "native")]

use std::sync::{Arc, Mutex};
use std::time::Duration;

use aven_db_store::blobs::{Blobs, Shared};
use aven_db_store::{Store, backend, files};
use aven_peer::members::{Gate, Hook};
use aven_peer::relay::Allow;
use aven_peer::room::Room;
use aven_peer::{Notes, blobs, iroh_gossip};
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, RelayMap, RelayMode, RelayUrl, SecretKey};
use iroh_gossip::Gossip;
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
    room: Room,
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
        .alpns(vec![iroh_gossip::ALPN.to_vec(), blobs::ALPN.to_vec()])
        .hooks(Hook { me: name.into(), gate: gate.clone(), notes: lines.notes() })
        .clear_ip_transports();
    if aven.is_none() {
        builder = builder.bind_addr("127.0.0.1:0").unwrap();
    }
    let endpoint = builder.bind().await.unwrap();
    let bootstrap = match aven {
        Some(addr) => {
            aven_peer::know(&endpoint, addr.clone());
            vec![addr.id]
        }
        None => vec![],
    };
    let store = Arc::new(backend::memory().unwrap());
    let held = Blobs::new(store.clone());
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let router = Router::builder(endpoint.clone())
        .accept(iroh_gossip::ALPN, gossip.clone())
        .accept(blobs::ALPN, blobs::provider(&held, name.into(), gate.clone(), lines.notes()))
        .spawn();
    let room = Room::join(&gossip, name.into(), "aven", secret, gate, bootstrap, lines.notes()).await.unwrap();
    Peer { room, lines, store, held, router, endpoint }
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
    tokio::spawn(aven_peer::files::keep(
        hub.endpoint.clone(),
        url.clone(),
        hub.held.clone(),
        hub.store.clone(),
        hub.room.announced(),
        "aven-peer".into(),
        hub.lines.notes(),
    ));
    let addr = EndpointAddr::new(aven.public()).with_relay_url(url.clone());
    let a = peer("alice", alice, &url, gate(), Some(addr.clone())).await;
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
    tokio::spawn(aven_peer::files::share(dir.clone(), a.store.clone(), a.room.clone(), "alice".into(), a.lines.notes()));

    let shared = a.lines.wait(|l| l["event"] == "shared").await.expect("alice shares the file");
    assert_eq!(shared["size"], bytes.len());
    let index: aven_db_store::Hash = shared["file"].as_str().unwrap().parse().unwrap();
    let heard = b.lines.wait(|l| l["event"] == "file").await.expect("bob hears the announcement");
    assert_eq!((&heard["from"], &heard["name"], &heard["type"]), (&"alice".into(), &"movie.mp4".into(), &"video/mp4".into()));
    let kept = hub.lines.wait(|l| l["event"] == "kept").await;
    let kept = kept.unwrap_or_else(|| panic!("the Aven Peer keeps it: {:?}", hub.lines.0.lock().unwrap()));
    assert_eq!(kept["bytes"], bytes.len() + 4 * 32, "every chunk and the index, once");
    assert_eq!(hub.store.get_ref(&aven_peer::files::file_ref(&index)).await.unwrap(), Some(index));

    // Alice goes; Bob fetches the whole file from the Aven Peer
    a.router.shutdown().await.unwrap();
    a.endpoint.close().await;
    let mine: Shared = Arc::new(backend::memory().unwrap());
    let conn = b.endpoint.connect(addr, blobs::ALPN).await.unwrap();
    Blobs::new(mine.clone()).fetch_file(&conn, index).await.unwrap();
    let file = files::open(&*mine, &index).await.unwrap().unwrap();
    assert_eq!(file.read(&*mine, 0..file.len).await.unwrap().unwrap(), bytes);
    std::fs::remove_dir_all(&dir).ok();
}
