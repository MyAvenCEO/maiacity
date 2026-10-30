//! iroh-blobs' provider behind the door (MILESTONE2.md, "the door is checked twice"; store/README.md): even a
//! connection the first check let through is served only if the door admits its key now, and one it doesn't is noted
//! as kept out, by the blobs' check. Here without the endpoint hook, so the provider's own check is what refuses.

use std::sync::{Arc, Mutex};

use aven_db_store::blobs::{self as store_blobs, Blobs, Shared};
use aven_db_store::{backend, files};
use aven_peer::blobs;
use aven_peer::members::Gate;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, RelayMode};

async fn endpoint() -> Endpoint {
    Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).bind().await.unwrap()
}

#[tokio::test]
async fn the_provider_serves_the_doors_keys_only() {
    let (alice, bob, stranger) = (endpoint().await, endpoint().await, endpoint().await);
    let gate = Gate::default();
    gate.set([(bob.id(), "bob-peer-light".to_string(), None)]);
    let said = Arc::new(Mutex::new(Vec::<String>::new()));
    let notes = {
        let said = said.clone();
        Arc::new(move |line: String| said.lock().unwrap().push(line))
    };
    let store: Shared = Arc::new(backend::memory().unwrap());
    let file = files::put(&*store, files::split(vec![7u8; 3000].into())).await.unwrap();
    let provider = blobs::provider(&Blobs::new(store), "alice-peer".into(), gate.clone(), notes);
    let _router = Router::builder(alice.clone()).accept(blobs::ALPN, provider).spawn();

    // a stranger is refused and noted; a member is served
    let theirs: Shared = Arc::new(backend::memory().unwrap());
    let conn = stranger.connect(alice.addr(), store_blobs::ALPN).await.unwrap();
    assert!(Blobs::new(theirs.clone()).fetch_file(&conn, file).await.is_err());
    assert!(!theirs.has(&file).await.unwrap());
    let lines = said.lock().unwrap().clone();
    assert!(lines.iter().any(|l| l.contains("kept-out") && l.contains("\"by\":\"blobs\"") && l.contains(&stranger.id().to_string())), "{lines:?}");

    let mine: Shared = Arc::new(backend::memory().unwrap());
    let conn = bob.connect(alice.addr(), store_blobs::ALPN).await.unwrap();
    Blobs::new(mine.clone()).fetch_file(&conn, file).await.unwrap();
    assert!(mine.has(&file).await.unwrap());

    // the door changes: bob is no longer admitted, and a new connection of his is refused
    gate.set([]);
    let gone: Shared = Arc::new(backend::memory().unwrap());
    let conn = bob.connect(alice.addr(), store_blobs::ALPN).await.unwrap();
    assert!(Blobs::new(gone.clone()).fetch_file(&conn, file).await.is_err());
}
