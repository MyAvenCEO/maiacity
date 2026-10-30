//! Files as hash sequences, and iroh-blobs on our store (README, "iroh-blobs on the store"): two endpoints in this
//! process, direct, each on a store of its own. What the spike measured in the box holds here as rules: a whole file
//! arrives whole, a seek fetches only the chunks it touches, a fetch asks only for what isn't held, a provider serves
//! members only, and serving a file costs one read of each blob (one GET each on S3).

use std::ops::Range;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering::Relaxed};

use aven_db_store::blobs::{self, Admit, Blobs, FetchError, Shared};
use aven_db_store::files::{self, CHUNK};
use aven_db_store::{Error, Hash, RefName, Result, Store, backend};
use bytes::Bytes;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, RelayMode};

/// Bytes that look random, the same on every run.
fn noise(len: u64, seed: &str) -> Bytes {
    let mut out = vec![0u8; len as usize];
    blake3::Hasher::new().update(seed.as_bytes()).finalize_xof().fill(&mut out);
    out.into()
}

/// A store that counts its whole reads, as S3 would count GETs.
struct Counted(backend::DalStore, AtomicU64);

#[async_trait::async_trait]
impl Store for Counted {
    async fn put(&self, bytes: Bytes) -> Result<Hash> {
        self.0.put(bytes).await
    }
    async fn get(&self, hash: &Hash) -> Result<Option<Bytes>> {
        self.1.fetch_add(1, Relaxed);
        self.0.get(hash).await
    }
    async fn get_range(&self, hash: &Hash, range: Range<u64>) -> Result<Option<Bytes>> {
        self.1.fetch_add(1, Relaxed);
        self.0.get_range(hash, range).await
    }
    async fn has(&self, hash: &Hash) -> Result<bool> {
        self.0.has(hash).await
    }
    async fn size(&self, hash: &Hash) -> Result<Option<u64>> {
        self.0.size(hash).await
    }
    async fn list(&self) -> Result<Vec<Hash>> {
        self.0.list().await
    }
    async fn delete(&self, hash: &Hash) -> Result<()> {
        self.0.delete(hash).await
    }
    async fn get_ref(&self, name: &RefName) -> Result<Option<Hash>> {
        self.0.get_ref(name).await
    }
    async fn set_ref(&self, name: &RefName, expected: Option<Hash>, new: Hash) -> Result<()> {
        self.0.set_ref(name, expected, new).await
    }
    async fn delete_ref(&self, name: &RefName, expected: Hash) -> Result<()> {
        self.0.delete_ref(name, expected).await
    }
    async fn list_refs(&self) -> Result<Vec<RefName>> {
        self.0.list_refs().await
    }
}

struct Peer {
    store: Shared,
    blobs: Blobs,
    endpoint: Endpoint,
    _router: Router,
}

async fn peer(store: Shared, admit: Admit) -> Peer {
    let endpoint = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .bind()
        .await
        .unwrap();
    let blobs = Blobs::new(store.clone());
    let router = Router::builder(endpoint.clone()).accept(blobs::ALPN, blobs.provider(admit)).spawn();
    Peer { store, blobs, endpoint, _router: router }
}

fn anyone() -> Admit {
    Arc::new(|_| true)
}

fn memory() -> Shared {
    Arc::new(backend::memory().unwrap())
}

async fn connect(from: &Peer, to: &Peer) -> iroh::endpoint::Connection {
    from.endpoint.connect(to.endpoint.addr(), blobs::ALPN).await.unwrap()
}

#[tokio::test]
async fn iroh_blobs_runs_on_our_store() {
    // the adapter answers iroh-blobs' store API through a `RefCast` of its client (src/blobs/actor.rs): if iroh-blobs
    // ever drops it, this fails at once, before any peer does
    let (alice, bob) = (peer(memory(), anyone()).await, peer(memory(), anyone()).await);
    let bytes = noise(3 * CHUNK + 12_345, "a file");
    let file = files::put(&*alice.store, files::split(bytes.clone())).await.unwrap();

    let conn = connect(&bob, &alice).await;
    let fetched = bob.blobs.fetch_file(&conn, file).await.unwrap();
    assert_eq!(fetched.bytes, bytes.len() as u64 + 4 * 32, "every chunk and the index, once");
    let held = files::open(&*bob.store, &file).await.unwrap().unwrap();
    assert_eq!(held.len, bytes.len() as u64);
    assert_eq!(held.read(&*bob.store, 0..held.len).await.unwrap().unwrap(), bytes);
    assert_eq!(bob.store.list().await.unwrap(), alice.store.list().await.unwrap(), "whole blobs, nothing else");

    // asked again, nothing crosses
    assert_eq!(bob.blobs.fetch_file(&conn, file).await.unwrap().bytes, 0);
}

#[tokio::test]
async fn a_seek_fetches_only_the_chunks_it_touches() {
    let (alice, bob) = (peer(memory(), anyone()).await, peer(memory(), anyone()).await);
    let bytes = noise(10 * CHUNK, "a movie");
    let file = files::put(&*alice.store, files::split(bytes.clone())).await.unwrap();
    let conn = connect(&bob, &alice).await;

    // the middle: 64 KiB across chunks 4 and 5
    let range = 5 * CHUNK - 32_768..5 * CHUNK + 32_768;
    let chunks = files::touched(&range);
    assert_eq!(chunks, 4..6);
    let fetched = bob.blobs.fetch_chunks(&conn, file, chunks).await.unwrap();
    assert_eq!(fetched.bytes, 2 * CHUNK + 10 * 32, "the index and two chunks");
    let held = files::open(&*bob.store, &file).await.unwrap().unwrap();
    assert_eq!(held.read(&*bob.store, range.clone()).await.unwrap().unwrap(), bytes.slice(range.start as usize..range.end as usize));
    assert_eq!(held.read(&*bob.store, 0..10).await.unwrap(), None, "a chunk not fetched");
    assert_eq!(held.missing(&*bob.store, 0..held.len).await.unwrap(), vec![0, 1, 2, 3, 6, 7, 8, 9]);
    assert_eq!(bob.store.list().await.unwrap().len(), 3);

    // a seek a little further on asks only for the chunk it lacks, the index held
    let fetched = bob.blobs.fetch_chunks(&conn, file, 5..7).await.unwrap();
    assert_eq!(fetched.bytes, CHUNK);
}

#[tokio::test]
async fn a_provider_serves_members_only() {
    let bob = peer(memory(), anyone()).await;
    let member = bob.endpoint.id();
    let alice = peer(memory(), Arc::new(move |id| *id == member)).await;
    let stranger = peer(memory(), anyone()).await;
    let file = files::put(&*alice.store, files::split(noise(100, "for members"))).await.unwrap();

    let conn = connect(&stranger, &alice).await;
    assert!(stranger.blobs.fetch_file(&conn, file).await.is_err(), "a stranger is refused");
    assert!(stranger.store.list().await.unwrap().is_empty());

    let conn = connect(&bob, &alice).await;
    bob.blobs.fetch_file(&conn, file).await.unwrap();
    assert!(bob.store.has(&file).await.unwrap());
}

#[tokio::test]
async fn serving_a_file_reads_each_blob_once() {
    // the spike's S3 GETs (README): 1058 for 1024 chunks before the index was kept, 1025 after
    let counted = Arc::new(Counted(backend::memory().unwrap(), AtomicU64::new(0)));
    let alice = peer(counted.clone(), anyone()).await;
    let bob = peer(memory(), anyone()).await;
    let n = 70;
    let file = files::put(&*alice.store, files::split(noise(n * CHUNK, "seventy chunks"))).await.unwrap();
    let conn = connect(&bob, &alice).await;

    counted.1.store(0, Relaxed);
    bob.blobs.fetch_file(&conn, file).await.unwrap();
    assert_eq!(counted.1.load(Relaxed), n + 1, "each chunk and the index once");

    // on a provider that has kept nothing yet, a cold seek reads the index and the chunk; a warm one the chunk
    let alice = peer(counted.clone(), anyone()).await;
    let carol = peer(memory(), anyone()).await;
    let conn = connect(&carol, &alice).await;
    counted.1.store(0, Relaxed);
    carol.blobs.fetch_chunks(&conn, file, 35..36).await.unwrap();
    assert_eq!(counted.1.load(Relaxed), 2, "a cold seek");
    counted.1.store(0, Relaxed);
    carol.blobs.fetch_chunks(&conn, file, 50..51).await.unwrap();
    assert_eq!(counted.1.load(Relaxed), 1, "a warm seek");
}

#[tokio::test]
async fn a_file_as_chunks_and_an_index() {
    let store = backend::memory().unwrap();
    // an empty file is an empty index
    let empty = files::put(&store, files::split(Bytes::new())).await.unwrap();
    let f = files::open(&store, &empty).await.unwrap().unwrap();
    assert_eq!((f.len, f.chunks.len()), (0, 0));
    assert_eq!(f.read(&store, 0..0).await.unwrap().unwrap(), Bytes::new());

    // exactly two chunks, and one byte more
    for len in [2 * CHUNK, 2 * CHUNK + 1] {
        let bytes = noise(len, "sizes");
        let name = files::put(&store, files::split(bytes.clone())).await.unwrap();
        let f = files::open(&store, &name).await.unwrap().unwrap();
        assert_eq!(f.len, len);
        assert_eq!(f.chunks.len() as u64, len.div_ceil(CHUNK));
        for r in [0..1, CHUNK - 1..CHUNK + 1, len - 1..len, 0..len] {
            assert_eq!(f.read(&store, r.clone()).await.unwrap().unwrap(), bytes.slice(r.start as usize..r.end as usize));
        }
        assert!(matches!(f.read(&store, 0..len + 1).await, Err(Error::Range { .. })));
    }

    // chunks are 1 MiB but the last: a short one in the middle, an empty one or one too long is refused
    let short = [noise(10, "a"), noise(CHUNK, "b")];
    assert!(files::put(&store, short).await.is_err());
    assert!(files::put(&store, [Bytes::new()]).await.is_err());
    assert!(files::put(&store, [noise(CHUNK + 1, "c")]).await.is_err());

    // an index is a list of hashes; a blob that isn't one is corrupt as an index
    let not_index = store.put(Bytes::from_static(b"not 32 bytes")).await.unwrap();
    assert!(matches!(files::open(&store, &not_index).await, Err(Error::Corrupt(_))));
    assert_eq!(files::touched(&(7..7)), 0..0);
    assert_eq!(files::touched(&(0..CHUNK)), 0..1);
    assert_eq!(files::touched(&(CHUNK..CHUNK + 1)), 1..2);
}

#[tokio::test]
async fn a_holder_that_hasnt_a_blob_says_so() {
    // the provider resets the stream for a blob it hasn't as for any trouble; asked afterwards, it says what it lacks:
    // a page's 404, not its 502
    let (alice, bob) = (peer(memory(), anyone()).await, peer(memory(), anyone()).await);
    let conn = connect(&bob, &alice).await;
    let never = Hash::of(b"a file never put");
    assert_eq!(bob.blobs.fetch_file(&conn, never).await, Err(FetchError::NotFound(never)));
    assert_eq!(bob.blobs.fetch_chunks(&conn, never, 0..1).await, Err(FetchError::NotFound(never)));
    assert_eq!(bob.blobs.fetch_blob(&conn, never).await, Err(FetchError::NotFound(never)));

    // the index is there, a chunk isn't: that chunk is what's missing
    let file = files::put(&*alice.store, files::split(noise(4 * CHUNK, "a torn file"))).await.unwrap();
    let lost = files::open(&*alice.store, &file).await.unwrap().unwrap().chunks[2];
    alice.store.delete(&lost).await.unwrap();
    assert_eq!(bob.blobs.fetch_chunks(&conn, file, 1..2).await.map(|f| f.bytes), Ok(CHUNK + 4 * 32));
    assert_eq!(bob.blobs.fetch_chunks(&conn, file, 2..3).await, Err(FetchError::NotFound(lost)));
    assert_eq!(bob.blobs.fetch_file(&conn, file).await, Err(FetchError::NotFound(lost)));

    // a holder that refuses is no answer about the blob: a plain failure
    let refusing = peer(memory(), Arc::new(|_| false)).await;
    let kept = files::put(&*refusing.store, files::split(noise(100, "kept"))).await.unwrap();
    let conn = connect(&bob, &refusing).await;
    assert!(matches!(bob.blobs.fetch_file(&conn, kept).await, Err(FetchError::Failed(_))));
}

#[tokio::test]
async fn a_blob_that_is_no_index_is_not_a_file() {
    // a hash sequence's root that is no list of hashes ends the fetch as any trouble does; asked afterwards, the holder's
    // blob is there and isn't an index: never a file, so nothing asks again
    let (alice, bob) = (peer(memory(), anyone()).await, peer(memory(), anyone()).await);
    let conn = connect(&bob, &alice).await;
    let odd = alice.store.put(noise(33, "thirty-three bytes")).await.unwrap();
    assert_eq!(bob.blobs.fetch_file(&conn, odd).await, Err(FetchError::NotAFile(odd)));
    assert_eq!(bob.blobs.fetch_chunks(&conn, odd, 0..1).await, Err(FetchError::NotAFile(odd)));
    // as a blob, it is one
    assert_eq!(bob.blobs.fetch_blob(&conn, odd).await.map(|f| f.bytes), Ok(33));
}
