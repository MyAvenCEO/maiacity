//! Files over iroh-blobs (`docs/ARCHITECTURE.md` §13): a node keeps one blob store, over its shelf (`shelf`), or else
//! in memory, and a file is its sealed pieces there, each a blob, with the
//! HashSeq of their hashes when there are several. A node brings a file by reading it twice (`Source`): once to
//! derive its key from what it holds, keyed by its person's vault (`Lab::convergence`, `sealed::Convergent`), so that
//! the same file brought again seals to the same pieces, which the store keeps once; then to seal it, a piece at a
//! time (`Node::store_file`), for a write to name (`Lab::bring`); reads any range of a file its
//! device opens, from its own store or else from a peer that may hand it over, fetching only the sealed segments that
//! hold the range, which it keeps (`Node::read_file`); and keeps whole every file its device's keep shares say to keep,
//! fetched from its peers as soon as it learns of them: where its device has none over a vault but never ones, every
//! file of the vault it syncs if the node keeps files (`Options::keep`), as the server does, and none otherwise
//! (`Lab::kept_files`). It drops no file it kept. A file it holds whole but needn't keep it lets go of when told
//! (`Node::let_go`), as an agent device does once its person's Mac holds the file whole by its own word
//! (`Node::holds_whole`): so one Mac keeps one copy.
//!
//! The blob gate (`blobs::gate`) hands a peer a blob only if the peer may fetch it: a McEliece key by `Lab::may_fetch`,
//! a file's root or one of its pieces by `Lab::may_fetch_file` (T27). Every request names one blob, never a HashSeq
//! with its children: a node fetches a file's HashSeq as a blob of its own and then its pieces one by one, so that the
//! gate weighs every hash a peer asks for, and no blob that merely holds hashes hands out the blobs it names.
//!
//! A node keeps what it brings and keeps whole on its shelf (`shelf`), a page's OPFS, the Mac's folder or the server's
//! bucket, and what else it reads in memory, a window at a time: a page that plays a film holds only the stretches that
//! play. A node reads a range a few megabytes at a time (`READ`), so that the window holds what it fetched until it
//! has read it.
//!
//! What a node holds of a file for good, as its holdings say (`holdings`), is what its shelf holds whole of it, or
//! with no shelf what its blob store does: all of it, or some of its pieces. It fetches a blob of a file first from
//! the peers whose holdings hold it, then from its other peers, over its pool of blob connections (`blobs`).

use std::collections::HashSet;
use std::io;
use std::ops::Range;
use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use avendb::id::{BlobId, SignerId};
use avendb::sealed::{Brought, Convergent, FileKey, FileRoot, PIECE, PIECE_SEGMENTS, SEALED, SEGMENT, Sealer, open};
use avendb::wire::FileHold;
use bytes::Bytes;
use iroh::EndpointId;
use iroh_blobs::api::proto::BlobStatus;
use iroh_blobs::api::{Store, TempTag};
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::protocol::{ChunkRanges, ChunkRangesExt as _, GetRequest};
use iroh_blobs::{BlobFormat, Hash, HashAndFormat};
use n0_future::task::{self, JoinHandle};
use n0_future::{Stream, StreamExt as _, stream, time};
use tokio::sync::mpsc;

use crate::{Backoff, Node, Running, Shared};

/// The most sealed bytes of a piece a node reads at a time: whole segments, as each opens on its own.
const READ: u64 = 64 * SEALED as u64;

/// The name a file's root is kept under in the blob store, so that whatever cleans the store up leaves it whole.
fn tag(root: &FileRoot) -> Vec<u8> {
    [&b"avendb/file/"[..], &root.hash].concat()
}

/// How the blob store holds a file's root: its one piece, or the HashSeq of its pieces, which holds them too.
fn content(root: &FileRoot) -> HashAndFormat {
    let format = if root.pieced() { BlobFormat::HashSeq } else { BlobFormat::Raw };
    HashAndFormat::new(Hash::from_bytes(root.hash), format)
}

/// A file's bytes as a node brings it (`Node::store_file`): each `open`, all of them again, from the first. The node
/// reads them twice: once to derive the file's key from what it holds (`sealed::Convergent`), once to seal them.
pub trait Source {
    /// The bytes, a chunk at a time.
    type Read: Stream<Item = io::Result<Bytes>> + Unpin;

    /// All of the file's bytes, from the first.
    fn open(&mut self) -> Self::Read;
}

impl<F, S> Source for F
where
    F: FnMut() -> S,
    S: Stream<Item = io::Result<Bytes>> + Unpin,
{
    type Read = S;

    fn open(&mut self) -> S {
        self()
    }
}

impl Node {
    /// A file of `len` bytes, read from `source` twice: once for its key, derived from what it holds under its
    /// device's convergence secret (`Lab::convergence`), or 32 random bytes where it has none; then sealed under that
    /// key, a piece at a time, into this node's blob store, where it stays: the file for a write to bring
    /// (`Lab::bring`), which names it by its root. The same file brought again, by any device of the same vault, seals
    /// to the same pieces and root, which the store keeps once. Fails if `source` holds more or fewer bytes than
    /// `len`, reads other bytes the second time, or fails itself.
    pub async fn store_file<B: Source>(&self, len: u64, source: B) -> Result<Brought> {
        self.shared.store_file(len, source).await
    }

    /// The plaintext bytes `range` of file `root`, cut to the file, which this node's device opens (`Lab::file`): the
    /// sealed segments that hold them, from its own store or else fetched from a peer that may hand them over and kept,
    /// each opened under its own number. Fails if the device opens no such file, or no peer it reaches hands the
    /// segments over.
    pub async fn read_file(&self, root: FileRoot, range: Range<u64>) -> Result<Vec<u8>> {
        self.shared.read_file(root, range).await
    }

    /// Whether this node holds every sealed byte of file `root`: on a shelf, once the shelf holds it whole, which on
    /// the server is its bucket.
    pub async fn holds_file(&self, root: FileRoot) -> bool {
        self.shared.holds(root).await
    }

    /// Whether device `device` holds every sealed byte of file `root` for good, by its own word as Synced to reads it
    /// (`Node::synced_to`): on a live connection, or with no statement of it kept, as it announced; else as its newest
    /// statement says. Only a file within its reach counts, one its edits by this device's view bring. Its word routes,
    /// shows and lets this node let go of its own copy (`let_go`), and never lets anyone fetch anything (T27).
    pub fn holds_whole(&self, device: SignerId, root: FileRoot) -> bool {
        self.shared.word_of(device, root) == Some(FileHold::Whole)
    }

    /// Lets go of file `root`, which this node keeps on its shelf: no tag keeps it any more, its pieces and its HashSeq
    /// go from its blob store, and so from its shelf, and it works out again what it holds of it for good, for its
    /// holdings: none. A read of it later fetches what it reads from a peer, as of any file it doesn't keep. Whether it
    /// let go: not of a file its device keeps whole (`Lab::kept_files`), which its keeper would only fetch again, nor
    /// with no shelf, as it keeps nothing past its end anyway. Fails if its store does.
    pub async fn let_go(&self, root: FileRoot) -> Result<bool> {
        self.shared.let_go(root).await
    }
}

/// The sealed pieces of a file on their way into the blob store, each a stream of its own, a few segments at a time.
struct Pieces {
    store: Store,
    /// The piece being written: how many bytes went into it, where its next go, and the task that adds it.
    open: Option<(u64, mpsc::Sender<Bytes>, JoinHandle<Result<TempTag>>)>,
    /// The pieces written, in order, each held in the store until the file's root is named.
    done: Vec<TempTag>,
}

impl Pieces {
    fn new(store: Store) -> Pieces {
        Pieces { store, open: None, done: Vec::new() }
    }

    /// Writes `sealed`, the next sealed bytes of the file, into its pieces: a piece that fills is added, and the next
    /// one starts with the bytes after it.
    async fn write(&mut self, sealed: Vec<u8>) -> Result<()> {
        let mut sealed = Bytes::from(sealed);
        while !sealed.is_empty() {
            let store = &self.store;
            let (filled, tx, _) = self.open.get_or_insert_with(|| start(store));
            let n = sealed.len().min((PIECE - *filled) as usize);
            tx.send(sealed.split_to(n)).await.map_err(|_| anyhow!("the blob store stopped taking the piece"))?;
            *filled += n as u64;
            if *filled == PIECE {
                self.close().await?;
            }
        }
        Ok(())
    }

    /// Ends the piece being written, if one is, and waits until the store holds it.
    async fn close(&mut self) -> Result<()> {
        if let Some((_, tx, adding)) = self.open.take() {
            drop(tx);
            self.done.push(adding.await.map_err(|_| anyhow!("the piece's task ended"))??);
        }
        Ok(())
    }

    /// Every piece, in order, once the last is in the store.
    async fn finish(mut self) -> Result<Vec<TempTag>> {
        self.close().await?;
        Ok(self.done)
    }
}

/// A new piece: the bytes sent to it stream into the store, which hashes them as they come.
fn start(store: &Store) -> (u64, mpsc::Sender<Bytes>, JoinHandle<Result<TempTag>>) {
    let (tx, rx) = mpsc::channel::<Bytes>(4);
    let bytes = stream::unfold(rx, |mut rx| async move { rx.recv().await.map(|b| (Ok(b), rx)) });
    let store = store.clone();
    let adding = task::spawn(async move { Ok(store.add_stream(bytes).await.temp_tag().await?) });
    (0, tx, adding)
}

impl Shared {
    /// `Node::store_file`.
    async fn store_file<B: Source>(self: &Arc<Self>, len: u64, mut source: B) -> Result<Brought> {
        let secret = self.lab(|lab, me| lab.convergence(me)).await;
        let key = match &secret {
            Some(secret) => {
                let mut convergent = Convergent::new(secret, len);
                let mut data = source.open();
                while let Some(bytes) = data.next().await {
                    convergent.push(&bytes?);
                    ensure!(convergent.seen() <= len, "more bytes than the file's {len}");
                }
                convergent.finish().with_context(|| format!("fewer bytes than the file's {len}"))?
            }
            None => FileKey::from_bytes(*crate::server::random()?),
        };
        // the bytes it seals derive the same key again: one key never seals two files, whose segments' nonces it
        // would share
        let mut again = secret.as_ref().map(|secret| Convergent::new(secret, len));
        let mut sealer = Sealer::new(&key, len);
        let mut pieces = Pieces::new(self.store.clone());
        let mut data = source.open();
        while let Some(bytes) = data.next().await {
            let bytes = bytes?;
            if let Some(again) = &mut again {
                again.push(&bytes);
            }
            let sealed = sealer.push(&bytes).map_err(|_| anyhow!("more bytes than the file's {len}"))?;
            pieces.write(sealed).await?;
        }
        pieces.write(sealer.finish().map_err(|_| anyhow!("fewer bytes than the file's {len}"))?).await?;
        if let Some(again) = again {
            ensure!(again.finish().is_some_and(|k| k == key), "the file changed while it was sealed");
        }
        let pieces = pieces.finish().await?;
        let hashes: Vec<Hash> = pieces.iter().map(TempTag::hash).collect();
        let root = match &hashes[..] {
            [one] => *one,
            many => {
                let seq: HashSeq = many.iter().copied().collect();
                self.store.add_bytes_with_opts((seq.into_inner(), BlobFormat::HashSeq)).temp_tag().await?.hash()
            }
        };
        let brought = Brought::new(*root.as_bytes(), key, len);
        self.store.tags().set(tag(&brought.root), content(&brought.root)).await?;
        self.index(brought.root, &hashes);
        self.refresh_file(brought.root).await;
        Ok(brought)
    }

    /// `Node::read_file`.
    async fn read_file(self: &Arc<Self>, root: FileRoot, range: Range<u64>) -> Result<Vec<u8>> {
        let brought = self.lab(move |lab, me| lab.file(me, &root)).await.context("no file this device opens")?;
        let shape = brought.shape();
        let (from, to) = (range.start.min(shape.len), range.end.min(shape.len));
        if from >= to {
            return Ok(Vec::new());
        }
        let segments = shape.segments_of(from..to);
        let pieces = self.pieces_of(root).await?;
        let mut plain = Vec::new();
        for (p, sealed) in shape.sealed_ranges(from..to) {
            let hash = pieces[p as usize];
            for start in sealed.clone().step_by(READ as usize) {
                let at = start..(start + READ).min(sealed.end);
                self.get(GetRequest::blob_ranges(hash, ChunkRanges::bytes(at.clone())), root, Some(p)).await?;
                let bytes = self.store.export_ranges(hash, at.clone()).concatenate().await?;
                let first = p * PIECE_SEGMENTS + at.start / SEALED as u64;
                plain.extend(open(&brought.key, shape, first, &bytes).context("sealed bytes that don't open")?);
            }
        }
        // with no shelf, the pieces it fetched whole it holds
        if self.shelf.is_none() {
            self.refresh_file(root).await;
        }
        let skip = (from - segments.start * SEGMENT as u64) as usize;
        Ok(plain[skip..skip + (to - from) as usize].to_vec())
    }

    /// The hashes of file `root`'s pieces, in order: its root alone, or the HashSeq its root names, fetched if this
    /// node lacks it, with as many pieces as the file's sealed size says. Each is marked for the gate as a piece of the
    /// file.
    async fn pieces_of(self: &Arc<Self>, root: FileRoot) -> Result<Vec<Hash>> {
        let hash = Hash::from_bytes(root.hash);
        if !root.pieced() {
            return Ok(vec![hash]);
        }
        self.get(GetRequest::blob(hash), root, None).await?;
        let seq = HashSeq::new(self.store.get_bytes(hash).await?).context("a file's HashSeq that is none")?;
        let pieces: Vec<Hash> = seq.iter().collect();
        let count = root.size.div_ceil(PIECE);
        ensure!(pieces.len() as u64 == count, "a file of {count} pieces whose HashSeq names {}", pieces.len());
        self.index(root, &pieces);
        Ok(pieces)
    }

    /// Marks each of `pieces` as a piece of file `root`, for the gate.
    fn index(&self, root: FileRoot, pieces: &[Hash]) {
        if root.pieced() {
            let mut index = self.pieces.lock().expect("pieces");
            pieces.iter().for_each(|p| _ = index.entry(*p).or_default().insert(root));
        }
    }

    /// What `request` asks of one blob of file `root`, piece `piece` of it or else its HashSeq, in this node's store:
    /// what it lacks of it fetched from the first peer that hands it over (`providers`), and kept.
    async fn get(self: &Arc<Self>, request: GetRequest, root: FileRoot, piece: Option<u64>) -> Result<()> {
        let remote = self.store.remote();
        if remote.local_for_request(request.clone()).await?.is_complete() {
            return Ok(());
        }
        for endpoint in self.providers(root, piece) {
            // the peer's blob gate lets in only an endpoint whose sync connection lives
            if self.connection(endpoint).await.is_err() {
                continue;
            }
            let Ok(conn) = self.pool.get_or_connect(endpoint).await else { continue };
            let missing = remote.local_for_request(request.clone()).await?.missing();
            if remote.execute_get((*conn).clone(), missing).await.is_err() {
                continue;
            }
            if remote.local_for_request(request.clone()).await?.is_complete() {
                return Ok(());
            }
        }
        bail!("no peer hands over {}", request.hash)
    }

    /// The peers to fetch piece `piece` of file `root` from, or its HashSeq: first those connected now whose holdings
    /// hold it, then the others connected now, then those whose holdings hold it that it would have to reach. Only
    /// holdings of a file within the holder's reach count, as `Node::synced_to` reads them: a claim to anything else
    /// steers nothing. Holdings only order them: a peer hands the piece over by its own blob gate (T27).
    fn providers(&self, root: FileRoot, piece: Option<u64>) -> Vec<EndpointId> {
        let live: Vec<(EndpointId, SignerId)> = {
            let peers = self.peers.lock().expect("peers");
            peers.values().filter(|p| p.conn.close_reason().is_none()).map(|p| (p.endpoint, p.device)).collect()
        };
        let reach = self.reach.lock().expect("reach").clone();
        let held = self.held.lock().expect("held");
        let holders: Vec<(EndpointId, SignerId)> = held
            .iter()
            .filter(|(_, h)| match h.files.get(&root) {
                Some(FileHold::Whole) => true,
                Some(FileHold::Pieces(pieces)) => piece.is_none_or(|p| pieces.iter().any(|&q| u64::from(q) == p)),
                None => false,
            })
            .filter_map(|(d, _)| reach.get(d).filter(|r| r.files.contains(&root)).map(|r| (r.endpoint, *d)))
            .collect();
        drop(held);
        let holds = |x: &(EndpointId, SignerId)| holders.contains(x);
        let (first, then): (Vec<_>, Vec<_>) = live.iter().copied().partition(holds);
        let last = holders.iter().copied().filter(|x| !live.contains(x));
        first.into_iter().chain(then).chain(last).map(|(endpoint, _)| endpoint).collect()
    }

    /// Keeps the files the edits its device holds bring: whole, fetched from its peers, those its device's keep shares
    /// say to keep, or with none but never ones, if the node keeps files (`Options::keep`), as the server does
    /// (`Lab::kept_files`); of the rest it marks for the gate the pieces of those whose HashSeq it holds. A file no
    /// peer hands over is tried again after `retry`, then twice as long each time, up to a minute. After each, it works
    /// out again what it holds of the file for good, for its holdings.
    pub(crate) async fn keeper(self: Arc<Self>) {
        let mut size = self.size.subscribe();
        let (mut kept, mut failing) = (HashSet::new(), Backoff::default());
        let keep = self.opts.keep;
        loop {
            let (files, whole) = self.lab(move |lab, me| (lab.files(me), lab.kept_files(me, keep))).await;
            let whole: HashSet<FileRoot> = whole.into_iter().collect();
            let files = files.into_iter().map(|f| (f, whole.contains(&f)));
            for (root, whole) in files.filter(|f| !kept.contains(f) && failing.due(&f.0)).collect::<Vec<_>>() {
                let keeping = self.keep(root, whole).await;
                self.refresh_file(root).await;
                match keeping {
                    Ok(()) => {
                        kept.insert((root, whole));
                        failing.reached(&root);
                    }
                    Err(e) => {
                        tracing::debug!("avendb: file {} not kept yet: {e:#}", Hash::from_bytes(root.hash));
                        failing.failed(root, self.opts.retry);
                    }
                }
            }
            time::timeout(self.opts.retry, size.changed()).await.ok();
        }
    }

    /// Keeps file `root`, whole if `whole` says, as `keeper` says: a `keep` job of the file, in pieces, forgotten if it
    /// fetched none, as they were all there or it failed before it fetched one, as the keeper tries it again.
    async fn keep(self: &Arc<Self>, root: FileRoot, whole: bool) -> Result<()> {
        if !whole {
            if root.pieced() && self.store.has(Hash::from_bytes(root.hash)).await? {
                self.pieces_of(root).await?;
            }
            return Ok(());
        }
        let count = root.size.div_ceil(PIECE).max(1);
        let mut job = self.jobs.begin("keep", BlobId(root.hash).to_hex(), String::new(), count, "pieces");
        let whose = self.lab(move |lab, me| lab.whose_file(me, &root)).await;
        let vaults = whose.values().map(|v| (v.to_hex(), count)).collect();
        job.about(vaults, whose.keys().map(|e| (e.to_hex(), count)).collect());
        let mut fetched = 0;
        let kept = self.keep_whole(root, &mut job, &mut fetched).await;
        if fetched == 0 { job.forget() } else { job.ended(&kept) }
        kept
    }

    /// `keep` of file `root` whole, each piece told to `job`, and how many it fetched to `fetched`.
    async fn keep_whole(self: &Arc<Self>, root: FileRoot, job: &mut Running, fetched: &mut u64) -> Result<()> {
        job.stage("finding its pieces");
        let pieces = self.pieces_of(root).await?;
        // tagged first, so that a blob store over a shelf puts the pieces it fetches onto it
        self.store.tags().set(tag(&root), content(&root)).await?;
        job.stage("fetching its pieces");
        for (p, &piece) in pieces.iter().enumerate() {
            let want = (root.size - p as u64 * PIECE).min(PIECE);
            let had = matches!(self.store.status(piece).await?, BlobStatus::Complete { size } if size == want);
            if !had {
                self.get(GetRequest::blob(piece), root, Some(p as u64)).await?;
                *fetched += 1;
            }
            // whole, and on a shelf, finished there: on the server, in its bucket; until then the keeper tries again
            match self.store.status(piece).await? {
                BlobStatus::Complete { size } if size == want => {}
                BlobStatus::Complete { size } => bail!("piece {p} of the file is {size} bytes, not {want}"),
                _ => bail!("piece {p} of the file isn't kept whole yet"),
            }
            job.progress(p as u64 + 1, None);
        }
        Ok(())
    }

    /// `Node::holds_file`.
    pub(crate) async fn holds(&self, root: FileRoot) -> bool {
        self.hold_of(root).await == Some(FileHold::Whole)
    }

    /// What this node holds of file `root` for good: of a file whose HashSeq it holds so, if it has one, the pieces
    /// it holds so, all of them, some, or none (`kept`).
    pub(crate) async fn hold_of(&self, root: FileRoot) -> Option<FileHold> {
        let hash = Hash::from_bytes(root.hash);
        let pieces: Vec<Hash> = match root.pieced() {
            false => vec![hash],
            true if self.kept(hash, None).await => {
                HashSeq::new(self.store.get_bytes(hash).await.ok()?)?.iter().collect()
            }
            true => return None,
        };
        let count = root.size.div_ceil(PIECE).max(1);
        if pieces.len() as u64 != count {
            return None;
        }
        let mut held = Vec::new();
        for (p, piece) in pieces.into_iter().enumerate() {
            if self.kept(piece, Some((root.size - p as u64 * PIECE).min(PIECE))).await {
                held.push(p as u32);
            }
        }
        match held.len() as u64 {
            0 => None,
            n if n == count => Some(FileHold::Whole),
            _ => Some(FileHold::Pieces(held)),
        }
    }

    /// This node holds blob `hash` whole for good, of `size` bytes if given: on a shelf, once the shelf holds it, which
    /// on the server is once its bucket does; with no shelf, in its blob store.
    async fn kept(&self, hash: Hash, size: Option<u64>) -> bool {
        if let Some(shelf) = &self.shelf {
            return shelf.shelved(&hash);
        }
        matches!(self.store.status(hash).await, Ok(BlobStatus::Complete { size: s }) if size.is_none_or(|n| n == s))
    }

    /// Works out again what this node holds of file `root` for good (`hold_of`), for its holdings; and tells its peers
    /// if that changed.
    pub(crate) async fn refresh_file(&self, root: FileRoot) {
        let hold = self.hold_of(root).await;
        let mut own = self.own.lock().expect("own");
        let files = &mut own.holdings.files;
        let changed = match hold {
            Some(hold) => files.insert(root, hold.clone()).is_none_or(|was| was != hold),
            None => files.remove(&root).is_some(),
        };
        drop(own);
        if changed {
            self.changed.notify_one();
        }
    }

    /// What `device` holds of file `root` for good by its own word, as `synced_to` reads it: as it announced, on a live
    /// connection or with no statement of it kept; else as its newest statement says. Nothing of a file outside its
    /// reach (`Reach`).
    fn word_of(&self, device: SignerId, root: FileRoot) -> Option<FileHold> {
        let endpoint = self.reach.lock().expect("reach").get(&device).filter(|r| r.files.contains(&root))?.endpoint;
        let live = self.live(endpoint).is_some_and(|p| p.device == device);
        match (!live).then(|| self.statement_of(device)).flatten() {
            Some(stated) => stated.files.into_iter().find(|(r, _)| *r == root).map(|(_, hold)| hold),
            None => self.held.lock().expect("held").get(&device)?.files.get(&root).cloned(),
        }
    }

    /// `Node::let_go`.
    async fn let_go(self: &Arc<Self>, root: FileRoot) -> Result<bool> {
        let Some(shelf) = &self.shelf else { return Ok(false) };
        let keep = self.opts.keep;
        if self.lab(move |lab, me| lab.kept_files(me, keep).contains(&root)).await {
            return Ok(false);
        }
        // its pieces, as the HashSeq it holds names them, and the HashSeq itself; or its one piece
        let hash = Hash::from_bytes(root.hash);
        let mut blobs: Vec<Hash> = match root.pieced() {
            true => self.store.get_bytes(hash).await.ok().and_then(HashSeq::new).into_iter().flatten().collect(),
            false => Vec::new(),
        };
        blobs.push(hash);
        self.store.tags().delete(tag(&root)).await?;
        shelf.delete(blobs, true).await?;
        self.refresh_file(root).await;
        Ok(true)
    }
}
