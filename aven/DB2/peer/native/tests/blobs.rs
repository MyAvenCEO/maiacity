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

/// The guard for a kept connection that died unseen (`blobs::once_more`), with connections as numbers: a kept one is
/// tried first; a plain failure over it is tried once more over a fresh one, which is then kept; a holder's "not found"
/// is an answer, not a reason to dial again.
#[tokio::test]
async fn a_kept_connection_that_fails_is_tried_once_more_fresh() {
    use aven_db_store::Hash;
    use aven_db_store::blobs::FetchError;
    use std::sync::atomic::{AtomicU32, Ordering::SeqCst};
    let dials = AtomicU32::new(0);
    let fresh = async || -> Result<u32, String> { Ok(100 + dials.fetch_add(1, SeqCst)) };
    let dead = |c: u32| c < 100;

    // a kept connection that answers: no dial
    let (got, keep) = blobs::once_more(Some(7), &fresh, async |c: u32| Ok::<_, FetchError>(c)).await;
    assert_eq!((got, keep, dials.load(SeqCst)), (Ok(7), Some(7), 0));

    // a kept connection that died: one fresh dial, which answers and is kept
    let fetch = async |c: u32| if dead(c) { Err(FetchError::Failed("stream reset".into())) } else { Ok(c) };
    let (got, keep) = blobs::once_more(Some(7), &fresh, &fetch).await;
    assert_eq!((got, keep, dials.load(SeqCst)), (Ok(100), Some(100), 1));

    // "not found" over a kept connection is the holder's answer: no dial, the connection kept
    let missing = Hash::of(b"missing");
    let (got, keep) = blobs::once_more(Some(7), &fresh, async |_: u32| Err::<u32, _>(FetchError::NotFound(missing))).await;
    assert_eq!((got, keep, dials.load(SeqCst)), (Err(FetchError::NotFound(missing)), Some(7), 1));

    // a fresh one that fails too: once, and nothing kept
    let failing = async |_: u32| Err::<u32, _>(FetchError::Failed("unreachable".into()));
    let (got, keep) = blobs::once_more(Some(7), &fresh, &failing).await;
    assert!(matches!(got, Err(FetchError::Failed(_))) && keep.is_none());
    assert_eq!(dials.load(SeqCst), 2);

    // nothing kept: a dial; one that can't connect is a plain failure
    let (got, keep) = blobs::once_more(None, async || Err::<u32, _>("no route"), &fetch).await;
    assert!(matches!(got, Err(FetchError::Failed(ref why)) if why.contains("no route")) && keep.is_none());
}
