//! Every file this server holds, served over iroh's blobs protocol. Object Storage is cold storage behind the server's
//! small iroh store: a paired device asks for a file (a blobs `Get` — iroh's Downloader), iroh-blobs holds the request
//! (its provider events, `RequestMode::Intercept`) while the file comes up from the bucket into the store — hashed on
//! the way in, kept only if it is the hash that was asked for — and then iroh answers it as it answers any file:
//! BLAKE3-verified streaming. No device needs an HTTPS fetch.
//!
//! A file brought up is pinned by a `cache/<hash>` tag. When the cache grows past its size (`VAULT_IROH_CACHE_GB`,
//! default 20), the files asked for least recently — and not being sent right now — lose their tag, and iroh's garbage
//! collection prunes them. The files this server made (`vault/<hash>`) are never let go.

use std::{
    collections::{HashMap, HashSet, hash_map::Entry},
    future::Future,
    io,
    sync::{Arc, Mutex, RwLock},
    time::Instant,
};

use anyhow::{Result, bail};
use bytes::Bytes;
use futures_lite::StreamExt;
use iroh_blobs::{
    Hash,
    api::{Store, blobs::BlobStatus},
    provider::events::{AbortReason, EventMask, EventSender, ProviderMessage, RequestMode},
    store::{ProtectCb, ProtectOutcome},
};
use tokio::sync::{Semaphore, mpsc};

/// How many files come up from the bucket at once (a Downloader asks for up to 32 in parallel).
const LANES: usize = 4;

/// Where the files this server holds live: the catalog says which (the server's own `blobs/<hash>` entry), the bucket
/// has the bytes.
pub trait Cold: Send + Sync + 'static {
    /// The file's size when this server holds it; None when it does not.
    fn holds(&self, hash: Hash) -> impl Future<Output = Result<Option<u64>>> + Send;
    /// The file's bytes from its first, as they arrive.
    fn read(&self, hash: Hash) -> impl Future<Output = Result<mpsc::Receiver<io::Result<Bytes>>>> + Send;
}

/// What the blobs protocol reports to the cache: every get held until the file is here.
pub fn events() -> (EventSender, mpsc::Receiver<ProviderMessage>) {
    EventSender::channel(64, EventMask { get: RequestMode::Intercept, get_many: RequestMode::Intercept, ..EventMask::DEFAULT })
}

/// iroh-docs protects every hash the catalog names — the files' too (`blobs/<hash>`). A file in this store is a copy
/// of the bucket's, kept only while a tag pins it (`vault/`, `cache/`): the files are taken out of the docs' set, and
/// the tags put back what is pinned (iroh-blobs marks the tags after this callback).
pub fn unprotect_files(docs: ProtectCb, files: Arc<RwLock<HashSet<Hash>>>) -> ProtectCb {
    Arc::new(move |live| {
        let (docs, files) = (docs.clone(), files.clone());
        Box::pin(async move {
            let outcome = docs(live).await;
            if matches!(outcome, ProtectOutcome::Continue) {
                let files = files.read().unwrap();
                live.retain(|h| !files.contains(h));
            }
            outcome
        })
    })
}

pub struct Cache {
    store: Store,
    books: Mutex<Lru>,
    /// one bringing-up per file: whoever asks second waits for the first
    rising: Mutex<HashMap<Hash, Arc<tokio::sync::Mutex<()>>>>,
    lanes: Semaphore,
    /// every hash the catalog names as a file (see `unprotect_files`)
    files: Arc<RwLock<HashSet<Hash>>>,
}

impl Cache {
    /// The cache as the store has it: every `cache/<hash>` tag counts (as asked for long ago).
    pub async fn open(store: Store, cap: u64, files: Arc<RwLock<HashSet<Hash>>>) -> Result<Arc<Self>> {
        let mut books = Lru::new(cap);
        let tags: Vec<_> = store.tags().list_prefix("cache/").await?.collect().await;
        for tag in tags {
            let tag = tag?;
            match store.blobs().status(tag.hash).await? {
                BlobStatus::Complete { size } => {
                    books.insert(tag.hash, size);
                    files.write().unwrap().insert(tag.hash);
                }
                _ => {
                    store.tags().delete(tag.name).await?;
                }
            }
        }
        let cache = Arc::new(Self { store, books: Mutex::new(books), rising: Mutex::default(), lanes: Semaphore::new(LANES), files });
        let (n, total) = {
            let b = cache.books.lock().unwrap();
            (b.len(), b.total())
        };
        tracing::info!("iroh cache: {n} files from the bucket, {:.1} of {:.1} GB", total as f64 / 1e9, cap as f64 / 1e9);
        cache.settle().await;
        Ok(cache)
    }

    /// The catalog names these files (the garbage collection's filter).
    pub fn files(&self, hashes: impl IntoIterator<Item = Hash>) {
        self.files.write().unwrap().extend(hashes);
    }

    /// A deleted file: out of the cache at once.
    pub async fn let_go(&self, hash: Hash) -> Result<()> {
        self.books.lock().unwrap().forget(hash);
        self.store.tags().delete(tag(hash)).await?;
        Ok(())
    }

    /// Answer the blobs protocol's events, each request on its own task.
    pub async fn serve<C: Cold>(self: Arc<Self>, cold: Arc<C>, mut rx: mpsc::Receiver<ProviderMessage>) {
        while let Some(msg) = rx.recv().await {
            match msg {
                ProviderMessage::GetRequestReceived(m) => {
                    let (me, cold) = (self.clone(), cold.clone());
                    tokio::spawn(async move { me.answer(&*cold, vec![m.inner.request.hash], m.tx, m.rx).await });
                }
                ProviderMessage::GetManyRequestReceived(m) => {
                    let (me, cold) = (self.clone(), cold.clone());
                    tokio::spawn(async move { me.answer(&*cold, m.inner.request.hashes.clone(), m.tx, m.rx).await });
                }
                // iroh-blobs 0.103 applies the get mode to every request kind: a push (a device writing into this
                // store) stays refused, as iroh-blobs' own default means it to be
                ProviderMessage::PushRequestReceived(m) => {
                    m.tx.send(Err(AbortReason::Permission)).await.ok();
                }
                ProviderMessage::ObserveRequestReceived(m) => {
                    m.tx.send(Ok(())).await.ok();
                }
                ProviderMessage::ClientConnected(m) => {
                    m.tx.send(Ok(())).await.ok();
                }
                ProviderMessage::Throttle(m) => {
                    m.tx.send(Ok(())).await.ok();
                }
                _ => {}
            }
        }
    }

    /// One request: every file it names that this server holds but its store lacks comes up first; then iroh answers.
    /// The cached files stay in use until the request is over (its update channel closes).
    async fn answer<C: Cold>(
        &self,
        cold: &C,
        hashes: Vec<Hash>,
        tx: irpc::channel::oneshot::Sender<Result<(), AbortReason>>,
        mut updates: irpc::channel::mpsc::Receiver<iroh_blobs::provider::events::RequestUpdate>,
    ) {
        let mut busy = Vec::new();
        for hash in hashes {
            match self.ready(cold, hash).await {
                Ok(true) => busy.push(hash),
                Ok(false) => {}
                Err(e) => tracing::warn!("{}: not brought up from the bucket: {e:#}", hash.fmt_short()),
            }
        }
        self.settle().await;
        // go ahead in any case: what the store lacks, iroh answers as it would (the request fails there)
        tx.send(Ok(())).await.ok();
        if busy.is_empty() {
            return;
        }
        while let Ok(Some(_)) = updates.recv().await {}
        {
            let mut books = self.books.lock().unwrap();
            for hash in &busy {
                books.end(*hash);
            }
        }
        self.settle().await;
    }

    /// Before iroh answers a request for `hash`. True: a cached file, now in use (the caller ends it).
    pub(crate) async fn ready<C: Cold>(&self, cold: &C, hash: Hash) -> Result<bool> {
        if self.books.lock().unwrap().begin(hash) {
            return Ok(true);
        }
        // a record, a file the server made, or anything else the store has: served as it is
        if self.complete(hash).await {
            return Ok(false);
        }
        let Some(size) = cold.holds(hash).await? else { return Ok(false) };
        let gate = self.rising.lock().unwrap().entry(hash).or_default().clone();
        let one = gate.lock().await;
        let out = async {
            // the first one brought it up while this one waited
            if self.books.lock().unwrap().begin(hash) {
                return Ok(true);
            }
            if self.complete(hash).await {
                return Ok(false);
            }
            let _lane = self.lanes.acquire().await?;
            self.files.write().unwrap().insert(hash);
            self.bring_up(cold, hash, size).await?;
            let mut books = self.books.lock().unwrap();
            books.insert(hash, size);
            books.begin(hash);
            Ok(true)
        }
        .await;
        // the last one out takes the gate away
        {
            let mut rising = self.rising.lock().unwrap();
            if let Entry::Occupied(e) = rising.entry(hash)
                && Arc::ptr_eq(e.get(), &gate)
                && Arc::strong_count(&gate) <= 2
            {
                e.remove();
            }
        }
        drop(one);
        out
    }

    /// The file from the bucket into the store, pinned — only if its bytes are the hash that was asked for.
    async fn bring_up<C: Cold>(&self, cold: &C, hash: Hash, size: u64) -> Result<()> {
        let started = Instant::now();
        let rx = cold.read(hash).await?;
        let bytes = futures_lite::stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|item| (item, rx)) });
        let name = tag(hash);
        let added = self.store.blobs().add_stream(bytes).await.with_named_tag(&name).await?;
        if added.hash != hash {
            self.store.tags().delete(&name).await.ok();
            bail!("the bucket's bytes hash to {}, not {}", added.hash.fmt_short(), hash.fmt_short());
        }
        let secs = started.elapsed().as_secs_f64();
        tracing::info!("brought {} ({size} B) up from the bucket for iroh in {secs:.1} s, {:.1} MB/s", hash.fmt_short(), size as f64 / secs.max(0.001) / 1e6);
        Ok(())
    }

    async fn complete(&self, hash: Hash) -> bool {
        matches!(self.store.blobs().status(hash).await, Ok(BlobStatus::Complete { .. }))
    }

    /// Over its size: the least recently asked-for files that nothing is sending lose their tag.
    async fn settle(&self) {
        let gone = self.books.lock().unwrap().evict();
        for hash in gone {
            match self.store.tags().delete(tag(hash)).await {
                Ok(_) => tracing::info!("iroh cache: let go of {} (garbage collection prunes it)", hash.fmt_short()),
                Err(e) => tracing::warn!("iroh cache: {}: {e:#}", hash.fmt_short()),
            }
        }
    }
}

fn tag(hash: Hash) -> String {
    format!("cache/{}", hash.to_hex())
}

/// The cache's books: which files are here, how big, when last asked for, and how many transfers are sending each
/// right now. Pure: the tags follow what it says.
#[derive(Debug, Default)]
pub struct Lru {
    cap: u64,
    total: u64,
    clock: u64,
    slots: HashMap<Hash, Slot>,
}

#[derive(Debug)]
struct Slot {
    size: u64,
    used: u64,
    busy: u32,
}

impl Lru {
    pub fn new(cap: u64) -> Self {
        Self { cap, ..Self::default() }
    }

    /// A file came up (or was found at start): counted, as just asked for.
    pub fn insert(&mut self, hash: Hash, size: u64) {
        self.clock += 1;
        match self.slots.entry(hash) {
            Entry::Occupied(mut e) => e.get_mut().used = self.clock,
            Entry::Vacant(e) => {
                e.insert(Slot { size, used: self.clock, busy: 0 });
                self.total += size;
            }
        }
    }

    /// A request for a cached file begins: asked for now, and kept until it ends. False: not in the cache.
    pub fn begin(&mut self, hash: Hash) -> bool {
        self.clock += 1;
        let Some(slot) = self.slots.get_mut(&hash) else { return false };
        slot.used = self.clock;
        slot.busy += 1;
        true
    }

    pub fn end(&mut self, hash: Hash) {
        if let Some(slot) = self.slots.get_mut(&hash) {
            slot.busy = slot.busy.saturating_sub(1);
        }
    }

    pub fn forget(&mut self, hash: Hash) {
        if let Some(slot) = self.slots.remove(&hash) {
            self.total -= slot.size;
        }
    }

    /// Over the cap: the least recently asked-for files not in use, until it fits — out of the books (the caller
    /// drops their tags). A file in use stays, even alone over the cap.
    pub fn evict(&mut self) -> Vec<Hash> {
        let mut gone = Vec::new();
        if self.total <= self.cap {
            return gone;
        }
        let mut idle: Vec<(u64, Hash)> = self.slots.iter().filter(|(_, s)| s.busy == 0).map(|(h, s)| (s.used, *h)).collect();
        idle.sort_unstable();
        for (_, hash) in idle {
            if self.total <= self.cap {
                break;
            }
            self.forget(hash);
            gone.push(hash);
        }
        gone
    }

    pub fn total(&self) -> u64 {
        self.total
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use iroh::{Endpoint, RelayMode, endpoint::presets, protocol::Router};
    use iroh_blobs::{BlobsProtocol, store::mem::MemStore};

    use super::*;

    fn h(n: u8) -> Hash {
        Hash::new([n])
    }

    #[test]
    fn evicts_least_recently_asked_for_first() {
        let mut lru = Lru::new(100);
        lru.insert(h(1), 40);
        lru.insert(h(2), 40);
        lru.insert(h(3), 40);
        assert_eq!(lru.total(), 120);
        // 1 asked for again: 2 is now the oldest
        assert!(lru.begin(h(1)));
        lru.end(h(1));
        assert_eq!(lru.evict(), vec![h(2)]);
        assert_eq!(lru.total(), 80);
        assert!(lru.evict().is_empty());
    }

    #[test]
    fn a_file_in_use_is_never_let_go() {
        let mut lru = Lru::new(50);
        lru.insert(h(1), 40);
        assert!(lru.begin(h(1)));
        lru.insert(h(2), 40);
        assert!(lru.begin(h(2)));
        // both sending: nothing goes, over the cap or not
        assert!(lru.evict().is_empty());
        lru.end(h(1));
        assert_eq!(lru.evict(), vec![h(1)]);
        // alone over the cap, but in use
        let mut big = Lru::new(10);
        big.insert(h(3), 40);
        assert!(big.begin(h(3)));
        assert!(big.evict().is_empty());
        big.end(h(3));
        assert_eq!(big.evict(), vec![h(3)]);
        assert_eq!(big.total(), 0);
    }

    #[test]
    fn unknown_files_and_forgetting() {
        let mut lru = Lru::new(100);
        assert!(!lru.begin(h(9)));
        lru.end(h(9));
        lru.insert(h(1), 30);
        lru.insert(h(1), 30);
        assert_eq!((lru.len(), lru.total()), (1, 30));
        lru.forget(h(1));
        assert_eq!((lru.len(), lru.total()), (0, 0));
    }

    /// A bucket in memory: which files the server holds, their bytes, how often they were read.
    struct Fake {
        files: HashMap<Hash, Bytes>,
        /// what the bucket answers instead (a corrupted object)
        lies: HashMap<Hash, Bytes>,
        reads: AtomicUsize,
    }

    impl Fake {
        fn new(files: &[&[u8]]) -> Self {
            let files = files.iter().map(|b| (Hash::new(b), Bytes::copy_from_slice(b))).collect();
            Self { files, lies: HashMap::new(), reads: AtomicUsize::new(0) }
        }
    }

    impl Cold for Fake {
        async fn holds(&self, hash: Hash) -> Result<Option<u64>> {
            Ok(self.files.get(&hash).map(|b| b.len() as u64))
        }
        async fn read(&self, hash: Hash) -> Result<mpsc::Receiver<io::Result<Bytes>>> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            let bytes = self.lies.get(&hash).or(self.files.get(&hash)).cloned().unwrap_or_default();
            let (tx, rx) = mpsc::channel(4);
            tokio::spawn(async move {
                // slowly, in pieces: the second asker has to wait for the first
                for piece in bytes.chunks(64 * 1024) {
                    tokio::time::sleep(std::time::Duration::from_millis(5)).await;
                    if tx.send(Ok(Bytes::copy_from_slice(piece))).await.is_err() {
                        return;
                    }
                }
            });
            Ok(rx)
        }
    }

    fn big(seed: u8, len: usize) -> Vec<u8> {
        (0..len).map(|i| (i as u8).wrapping_mul(31).wrapping_add(seed)).collect()
    }

    #[tokio::test]
    async fn brings_up_once_verifies_and_evicts() -> Result<()> {
        let (a, b) = (big(1, 700_000), big(2, 500_000));
        let store = MemStore::new();
        let files = Arc::new(RwLock::new(HashSet::new()));
        let cache = Cache::open((*store).clone(), 1_000_000, files.clone()).await?;
        let cold = Fake::new(&[&a, &b]);
        let (ha, hb) = (Hash::new(&a), Hash::new(&b));

        // three asking at once: one read from the bucket
        let (r1, r2, r3) = tokio::join!(cache.ready(&cold, ha), cache.ready(&cold, ha), cache.ready(&cold, ha));
        assert!(r1? && r2? && r3?);
        assert_eq!(cold.reads.load(Ordering::SeqCst), 1);
        assert_eq!(store.get_bytes(ha).await?.as_ref(), &a[..]);
        assert!(store.tags().get(tag(ha)).await?.is_some());
        assert!(files.read().unwrap().contains(&ha));

        // a file the server does not hold, or one the store has anyway: not the cache's
        let other = store.add_slice(b"a record").await?;
        assert!(!cache.ready(&cold, other.hash).await?);
        assert!(!cache.ready(&cold, h(7)).await?);

        // b comes up; a is still being sent, so nothing goes
        assert!(cache.ready(&cold, hb).await?);
        cache.settle().await;
        assert!(store.tags().get(tag(ha)).await?.is_some());
        // a's transfers end: over the cap, a (the older) goes
        for _ in 0..3 {
            cache.books.lock().unwrap().end(ha);
        }
        cache.settle().await;
        assert!(store.tags().get(tag(ha)).await?.is_none());
        assert!(store.tags().get(tag(hb)).await?.is_some());
        Ok(())
    }

    #[tokio::test]
    async fn refuses_bytes_that_are_not_the_hash() -> Result<()> {
        let a = big(3, 300_000);
        let store = MemStore::new();
        let cache = Cache::open((*store).clone(), 1_000_000, Arc::default()).await?;
        let mut cold = Fake::new(&[&a]);
        let ha = Hash::new(&a);
        cold.lies.insert(ha, Bytes::from(big(4, 300_000)));
        assert!(cache.ready(&cold, ha).await.is_err());
        assert!(store.tags().get(tag(ha)).await?.is_none());
        assert!(!store.has(ha).await?);
        Ok(())
    }

    #[tokio::test]
    async fn gc_keeps_only_what_a_tag_pins() -> Result<()> {
        let files = Arc::new(RwLock::new(HashSet::from([h(1), h(2)])));
        let docs: ProtectCb = Arc::new(|live| {
            Box::pin(async move {
                live.extend([h(1), h(2), h(3)]);
                ProtectOutcome::Continue
            })
        });
        let cb = unprotect_files(docs, files);
        let mut live = HashSet::new();
        assert!(matches!(cb(&mut live).await, ProtectOutcome::Continue));
        assert_eq!(live, HashSet::from([h(3)]));
        Ok(())
    }

    /// The whole way: a device's Downloader asks the server's endpoint for a file only the bucket has, and gets it,
    /// verified, over iroh.
    #[tokio::test]
    async fn a_device_downloads_a_file_only_the_bucket_has() -> Result<()> {
        let a = big(5, 2_000_000);
        let ha = Hash::new(&a);

        let server_store = MemStore::new();
        let cache = Cache::open((*server_store).clone(), 1 << 30, Arc::default()).await?;
        let (events, rx) = events();
        let server_ep = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).bind().await?;
        let router = Router::builder(server_ep.clone()).accept(iroh_blobs::ALPN, BlobsProtocol::new(&server_store, Some(events))).spawn();
        let cold = Arc::new(Fake::new(&[&a]));
        tokio::spawn(cache.clone().serve(cold.clone(), rx));

        let lookup = iroh::address_lookup::MemoryLookup::new();
        lookup.add_endpoint_info(server_ep.addr());
        let device_ep = Endpoint::builder(presets::Minimal).relay_mode(RelayMode::Disabled).address_lookup(lookup).bind().await?;
        let device_store = MemStore::new();
        device_store.downloader(&device_ep).download(ha, vec![server_ep.id()]).await?;
        assert_eq!(device_store.get_bytes(ha).await?.as_ref(), &a[..]);
        assert_eq!(cold.reads.load(Ordering::SeqCst), 1);

        // a second device: served from the cache, the bucket not asked again
        let second = MemStore::new();
        second.downloader(&device_ep).download(ha, vec![server_ep.id()]).await?;
        assert_eq!(second.get_bytes(ha).await?.as_ref(), &a[..]);
        assert_eq!(cold.reads.load(Ordering::SeqCst), 1);
        // and once the transfers are over, nothing of it counts as in use
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        assert_eq!(cache.books.lock().unwrap().slots[&ha].busy, 0);

        router.shutdown().await.ok();
        device_ep.close().await;
        Ok(())
    }
}
