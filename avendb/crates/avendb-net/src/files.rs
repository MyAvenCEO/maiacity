//! Files over iroh-blobs (blobs B2, `docs/BLOBS.md`): a node keeps one blob store, over its shelf (`shelf`), or else
//! in memory, and a file is its sealed pieces there, each a blob, with the
//! HashSeq of their hashes when there are several. A node brings a file by sealing it as it reads it, a piece at a
//! time, under a key of its own (`Node::store_file`), for a write to name (`Lab::bring`); reads any range of a file its
//! device opens, from its own store or else from a peer that may hand it over, fetching only the sealed segments that
//! hold the range, which it keeps (`Node::read_file`); and keeps whole every file its device's sync rules say to keep,
//! fetched from its peers as soon as it learns of them: where its device has no rule over a vault, every file of the
//! vault if the node keeps files (`Options::keep`), as the server does, and none otherwise (`Lab::kept_files`). It
//! drops no file it kept.
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

use std::collections::HashSet;
use std::io;
use std::ops::Range;
use std::sync::Arc;

use anyhow::{Context as _, Result, anyhow, bail, ensure};
use avendb::sealed::{Brought, FileKey, FileRoot, PIECE, PIECE_SEGMENTS, SEALED, SEGMENT, Sealer, open};
use bytes::Bytes;
use iroh::EndpointId;
use iroh::endpoint::Connection;
use iroh_blobs::api::proto::BlobStatus;
use iroh_blobs::api::{Store, TempTag};
use iroh_blobs::hashseq::HashSeq;
use iroh_blobs::protocol::{ChunkRanges, ChunkRangesExt as _, GetRequest};
use iroh_blobs::{BlobFormat, Hash, HashAndFormat};
use n0_future::task::{self, JoinHandle};
use n0_future::{Stream, StreamExt as _, stream, time};
use tokio::sync::mpsc;

use crate::{Backoff, Node, Shared, WAIT};

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

impl Node {
    /// A file of `len` bytes, sealed under a key of its own as it is read from `data`, a piece at a time, into this
    /// node's blob store, where it stays: the file for a write to bring (`Lab::bring`), which names it by its root.
    /// Fails if `data` holds more or fewer bytes than `len`, or fails itself.
    pub async fn store_file<S>(&self, len: u64, data: S) -> Result<Brought>
    where
        S: Stream<Item = io::Result<Bytes>> + Unpin,
    {
        self.shared.store_file(len, data).await
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
    async fn store_file<S>(self: &Arc<Self>, len: u64, mut data: S) -> Result<Brought>
    where
        S: Stream<Item = io::Result<Bytes>> + Unpin,
    {
        let key = FileKey::from_bytes(*crate::server::random()?);
        let mut sealer = Sealer::new(&key, len);
        let mut pieces = Pieces::new(self.store.clone());
        while let Some(bytes) = data.next().await {
            let sealed = sealer.push(&bytes?).map_err(|_| anyhow!("more bytes than the file's {len}"))?;
            pieces.write(sealed).await?;
        }
        pieces.write(sealer.finish().map_err(|_| anyhow!("fewer bytes than the file's {len}"))?).await?;
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
                self.get(GetRequest::blob_ranges(hash, ChunkRanges::bytes(at.clone()))).await?;
                let bytes = self.store.export_ranges(hash, at.clone()).concatenate().await?;
                let first = p * PIECE_SEGMENTS + at.start / SEALED as u64;
                plain.extend(open(&brought.key, shape, first, &bytes).context("sealed bytes that don't open")?);
            }
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
        self.get(GetRequest::blob(hash)).await?;
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

    /// What `request` asks of one blob, in this node's store: what it lacks of it fetched from the first peer that
    /// hands it over, and kept.
    async fn get(self: &Arc<Self>, request: GetRequest) -> Result<()> {
        let remote = self.store.remote();
        if remote.local_for_request(request.clone()).await?.is_complete() {
            return Ok(());
        }
        for endpoint in self.sources() {
            let Ok(conn) = self.blob_connection(endpoint).await else { continue };
            let missing = remote.local_for_request(request.clone()).await?.missing();
            if remote.execute_get(conn, missing).await.is_err() {
                continue;
            }
            if remote.local_for_request(request.clone()).await?.is_complete() {
                return Ok(());
            }
        }
        bail!("no peer hands over {}", request.hash)
    }

    /// The peers to fetch a blob from: those this node is connected to now.
    fn sources(&self) -> Vec<EndpointId> {
        let peers = self.peers.lock().expect("peers");
        peers.values().filter(|p| p.conn.close_reason().is_none()).map(|p| p.endpoint).collect()
    }

    /// The blob connection to `endpoint`, dialed if there is none open.
    async fn blob_connection(self: &Arc<Self>, endpoint: EndpointId) -> Result<Connection> {
        let open = self.blob_conns.lock().expect("blob connections").get(&endpoint).cloned();
        if let Some(conn) = open.filter(|c| c.close_reason().is_none()) {
            return Ok(conn);
        }
        let dial = self.endpoint.connect(self.addr_of(endpoint), iroh_blobs::ALPN);
        let conn = time::timeout(WAIT, dial).await.context("no answer")??;
        self.blob_conns.lock().expect("blob connections").insert(endpoint, conn.clone());
        Ok(conn)
    }

    /// Keeps the files the edits its device holds bring: whole, fetched from its peers, those its device's sync rules
    /// say to keep, or with no rule, if the node keeps files (`Options::keep`), as the server does (`Lab::kept_files`);
    /// of the rest it marks for the gate the pieces of those whose HashSeq it holds. A file no peer hands over is tried
    /// again after `retry`, then twice as long each time, up to a minute.
    pub(crate) async fn keeper(self: Arc<Self>) {
        let mut size = self.size.subscribe();
        let (mut kept, mut failing) = (HashSet::new(), Backoff::default());
        let keep = self.opts.keep;
        loop {
            let (files, whole) = self.lab(move |lab, me| (lab.files(me), lab.kept_files(me, keep))).await;
            let whole: HashSet<FileRoot> = whole.into_iter().collect();
            let files = files.into_iter().map(|f| (f, whole.contains(&f)));
            for (root, whole) in files.filter(|f| !kept.contains(f) && failing.due(&f.0)).collect::<Vec<_>>() {
                match self.keep(root, whole).await {
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

    /// Keeps file `root`, whole if `whole` says, as `keeper` says.
    async fn keep(self: &Arc<Self>, root: FileRoot, whole: bool) -> Result<()> {
        if !whole {
            if root.pieced() && self.store.has(Hash::from_bytes(root.hash)).await? {
                self.pieces_of(root).await?;
            }
            return Ok(());
        }
        let pieces = self.pieces_of(root).await?;
        // tagged first, so that a blob store over a shelf puts the pieces it fetches onto it
        self.store.tags().set(tag(&root), content(&root)).await?;
        for (p, &piece) in pieces.iter().enumerate() {
            self.get(GetRequest::blob(piece)).await?;
            // whole, and on a shelf, finished there: on the server, in its bucket; until then the keeper tries again
            let want = (root.size - p as u64 * PIECE).min(PIECE);
            match self.store.status(piece).await? {
                BlobStatus::Complete { size } if size == want => {}
                BlobStatus::Complete { size } => bail!("piece {p} of the file is {size} bytes, not {want}"),
                _ => bail!("piece {p} of the file isn't kept whole yet"),
            }
        }
        Ok(())
    }

    /// `Node::holds_file`.
    pub(crate) async fn holds(&self, root: FileRoot) -> bool {
        let Some(shelf) = &self.shelf else {
            let local = self.store.remote().local(content(&root)).await;
            return local.is_ok_and(|l| l.is_complete());
        };
        let hash = Hash::from_bytes(root.hash);
        if !shelf.shelved(&hash) {
            return false;
        }
        if !root.pieced() {
            return true;
        }
        let seq = self.store.get_bytes(hash).await.ok().and_then(HashSeq::new);
        seq.is_some_and(|seq| seq.iter().all(|p| shelf.shelved(&p)))
    }
}
