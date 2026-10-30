//! iroh-blobs' store API (`api::proto::Request`, 23 requests), answered from our `Store`: blobs whole or absent. Started
//! from iroh-blobs' `readonly_mem.rs`. Transfer needs six of the requests: observe and status (a blob's size), the
//! two exports to serve, import of bao to fetch, and listing. Tags, temp tags' protection and deletes are not ours
//! (refs and reachability keep blobs), so they answer "unsupported" or nothing.
//!
//! Two things make serving from S3 cheap (the spike, README): the indexes iroh-blobs reads 32 hashes at a time are
//! kept for a while, so each is one GET; and while a chunk of a file goes out, the next is already being read.

use std::collections::VecDeque;
use std::io;
use std::sync::{Arc, Mutex};

use bao_tree::io::mixed::{EncodedItem, traverse_ranges_validated};
use bao_tree::io::outboard::PreOrderMemOutboard;
use bao_tree::io::{BaoContentItem, Leaf};
use bytes::Bytes;
use iroh_blobs::api::blobs::Bitfield;
use iroh_blobs::api::proto::{self, BlobStatus, Command, ExportRangesItem};
use iroh_blobs::api::{self, TempTag};
use iroh_blobs::store::IROH_BLOCK_SIZE;
use irpc::channel::mpsc;
use range_collections::range_set::RangeSetRange;
use ref_cast::RefCast;
use tokio::sync::oneshot;

use super::Shared;
use crate::{Error, Hash};

/// How many indexes are kept, and up to which size: 256 KiB lists 8192 chunks, a file of 8 GiB.
const INDEXES: usize = 4;
const INDEX_MAX: usize = 256 << 10;

/// iroh-blobs' store, answered from ours by an actor of its own. iroh-blobs has no public constructor for a store of
/// someone else's (`from_sender` is crate-private); its `api::Store` derives `RefCast` over the `irpc::Client` it wraps,
/// which builds one. The store's test `iroh_blobs_runs_on_our_store` fails at once if that ever stops working.
pub(super) fn spawn(store: Shared) -> api::Store {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Command>(32);
    let actor = Arc::new(Actor {
        store,
        indexes: Mutex::default(),
        ahead: Mutex::default(),
        last: Mutex::default(),
    });
    n0_future::task::spawn(async move {
        while let Some(cmd) = rx.recv().await {
            if let Command::Shutdown(cmd) = cmd {
                cmd.tx.send(()).await.ok();
                break;
            }
            n0_future::task::spawn(actor.clone().handle(cmd));
        }
    });
    let client: irpc::Client<proto::Request> = irpc::LocalSender::from(tx).into();
    api::Store::ref_cast(&client).clone()
}

pub(super) fn ours(h: iroh_blobs::Hash) -> Hash {
    Hash::from_bytes(*h.as_bytes())
}

pub(super) fn theirs(h: Hash) -> iroh_blobs::Hash {
    iroh_blobs::Hash::from_bytes(*h.as_bytes())
}

fn io_err(e: Error) -> io::Error {
    io::Error::other(e.to_string())
}

fn unsupported_io() -> io::Error {
    io::Error::new(io::ErrorKind::Unsupported, "not on avenDB's store")
}

fn unsupported() -> api::Error {
    unsupported_io().into()
}

struct Actor {
    store: Shared,
    /// The indexes read last, newest first: iroh-blobs reads a hash sequence a window at a time.
    indexes: Mutex<VecDeque<(Hash, Bytes)>>,
    /// The chunk being read ahead, and where it will arrive.
    ahead: Mutex<Option<(Hash, oneshot::Receiver<Option<Bytes>>)>>,
    /// The chunk that went out last: a file is read ahead once its chunks go out in order, not for a seek.
    last: Mutex<Option<Hash>>,
}

impl Actor {
    /// A whole blob, checked against its name by `get`.
    async fn whole(&self, hash: Hash) -> io::Result<Bytes> {
        self.store
            .get(&hash)
            .await
            .map_err(io_err)?
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no such blob"))
    }

    fn kept_index(&self, hash: &Hash) -> Option<Bytes> {
        let indexes = self.indexes.lock().unwrap();
        indexes
            .iter()
            .find(|(h, _)| h == hash)
            .map(|(_, b)| b.clone())
    }

    /// Keeps a blob that may be an index: at most `INDEX_MAX` bytes, a list of hashes. A small blob that isn't one
    /// costs only memory while it is kept.
    fn keep_index(&self, hash: Hash, bytes: &Bytes) {
        if bytes.len() > INDEX_MAX || bytes.len() % 32 != 0 {
            return;
        }
        let mut indexes = self.indexes.lock().unwrap();
        indexes.retain(|(h, _)| *h != hash);
        indexes.push_front((hash, bytes.clone()));
        indexes.truncate(INDEXES);
    }

    /// The chunk after `hash` in a kept index, if `hash` is a chunk of one.
    fn next_chunk(&self, hash: &Hash) -> Option<Hash> {
        let indexes = self.indexes.lock().unwrap();
        indexes.iter().find_map(|(_, index)| {
            let at = index.chunks_exact(32).position(|h| h == hash.as_bytes())?;
            let next = index.get((at + 1) * 32..(at + 2) * 32)?;
            Some(Hash::from_bytes(next.try_into().ok()?))
        })
    }

    /// A blob to serve: the index kept, the chunk read ahead, or a read now; then, while a file's chunks go out in
    /// order, the next one is read ahead.
    async fn serve(self: &Arc<Self>, hash: Hash) -> io::Result<Bytes> {
        let ahead = self.ahead.lock().unwrap().take_if(|(h, _)| *h == hash);
        let bytes = match (self.kept_index(&hash), ahead) {
            (Some(index), _) => index,
            (None, Some((_, arriving))) => match arriving.await {
                Ok(Some(bytes)) => bytes,
                _ => self.whole(hash).await?,
            },
            (None, None) => self.whole(hash).await?,
        };
        // a hash sequence's index goes out first, then iroh-blobs reads it again to walk the chunks
        self.keep_index(hash, &bytes);
        let previous = self.last.lock().unwrap().replace(hash);
        let in_order = previous.is_some_and(|p| self.next_chunk(&p) == Some(hash));
        if let Some(next) = self.next_chunk(&hash).filter(|_| in_order) {
            let (tx, rx) = oneshot::channel();
            *self.ahead.lock().unwrap() = Some((next, rx));
            let me = self.clone();
            n0_future::task::spawn(async move {
                tx.send(me.store.get(&next).await.ok().flatten()).ok();
            });
        }
        Ok(bytes)
    }

    async fn handle(self: Arc<Self>, cmd: Command) {
        match cmd {
            Command::Observe(cmd) => {
                let bits = match self.store.size(&ours(cmd.inner.hash)).await {
                    Ok(Some(n)) => Bitfield::complete(n),
                    _ => Bitfield::empty(),
                };
                // a blob here is whole or absent and never changes, so there is nothing more to tell; but the channel
                // stays open until the asker goes, as iroh-blobs' own stores keep it: its provider resets the stream
                // when the channel ends, and a reset may drop the answer before the asker has read it
                if cmd.tx.send(bits).await.is_ok() {
                    cmd.tx.closed().await;
                }
            }
            Command::BlobStatus(cmd) => {
                let status = match self.store.size(&ours(cmd.inner.hash)).await {
                    Ok(Some(size)) => BlobStatus::Complete { size },
                    _ => BlobStatus::NotFound,
                };
                cmd.tx.send(status).await.ok();
            }
            Command::ExportBao(mut cmd) => match self.serve(ours(cmd.inner.hash)).await {
                Ok(data) => {
                    // the outboard is made, not kept: about 4 KiB of tree for a 1 MiB chunk. The bytes were checked
                    // against their name, so its root is the hash asked for
                    let outboard = PreOrderMemOutboard::create(&data, IROH_BLOCK_SIZE);
                    let tx = Sink::ref_cast_mut(&mut cmd.tx);
                    traverse_ranges_validated(data, outboard, &cmd.inner.ranges, tx)
                        .await
                        .ok();
                }
                Err(e) => {
                    cmd.tx.send(EncodedItem::Error(e.into())).await.ok();
                }
            },
            Command::ExportRanges(mut cmd) => {
                if let Err(e) = self.export_ranges(&cmd.inner, &mut cmd.tx).await {
                    cmd.tx.send(ExportRangesItem::Error(e.into())).await.ok();
                }
            }
            Command::ImportBao(cmd) => {
                let done = self
                    .import_bao(ours(cmd.inner.hash), cmd.inner.size.get(), cmd.rx)
                    .await;
                cmd.tx.send(done.map_err(Into::into)).await.ok();
            }
            Command::ListBlobs(cmd) => match self.store.list().await {
                Ok(all) => {
                    for h in all {
                        cmd.tx.send(Ok(theirs(h))).await.ok();
                    }
                }
                Err(e) => {
                    cmd.tx.send(Err(io_err(e).into())).await.ok();
                }
            },
            Command::CreateTempTag(cmd) => {
                cmd.tx.send(TempTag::new(cmd.inner.value, None)).await.ok();
            }
            Command::ListTempTags(cmd) => {
                cmd.tx.send(Vec::new()).await.ok();
            }
            Command::ListTags(cmd) => {
                cmd.tx.send(Vec::new()).await.ok();
            }
            Command::SyncDb(cmd) => {
                cmd.tx.send(Ok(())).await.ok();
            }
            Command::ClearProtected(cmd) => {
                cmd.tx.send(Ok(())).await.ok();
            }
            Command::WaitIdle(cmd) => {
                cmd.tx.send(()).await.ok();
            }
            Command::SetTag(cmd) => {
                cmd.tx.send(Err(unsupported())).await.ok();
            }
            Command::CreateTag(cmd) => {
                cmd.tx.send(Err(unsupported())).await.ok();
            }
            Command::RenameTag(cmd) => {
                cmd.tx.send(Err(unsupported())).await.ok();
            }
            Command::DeleteTags(cmd) => {
                cmd.tx.send(Err(unsupported())).await.ok();
            }
            Command::DeleteBlobs(cmd) => {
                cmd.tx.send(Err(unsupported())).await.ok();
            }
            Command::ImportBytes(cmd) => {
                cmd.tx.send(unsupported_io().into()).await.ok();
            }
            Command::ImportByteStream(cmd) => {
                cmd.tx.send(unsupported_io().into()).await.ok();
            }
            Command::ImportPath(cmd) => {
                cmd.tx.send(unsupported_io().into()).await.ok();
            }
            Command::ExportPath(cmd) => {
                cmd.tx.send(unsupported().into()).await.ok();
            }
            // dropping the batch's channel ends it: nothing here is protected by a scope, refs keep blobs
            Command::Batch(_) | Command::Shutdown(_) => {}
        }
    }

    /// Plain bytes of a blob: iroh-blobs reads a hash sequence's index this way, so what it reads is kept as one.
    async fn export_ranges(
        &self,
        req: &proto::ExportRangesRequest,
        tx: &mut mpsc::Sender<ExportRangesItem>,
    ) -> io::Result<()> {
        let hash = ours(req.hash);
        let data = match self.kept_index(&hash) {
            Some(data) => data,
            None => self.whole(hash).await?,
        };
        self.keep_index(hash, &data);
        let size = data.len() as u64;
        tx.send(ExportRangesItem::Size(size)).await?;
        for range in req.ranges.iter() {
            let (start, end) = match range {
                RangeSetRange::Range(r) => (size.min(*r.start), size.min(*r.end)),
                RangeSetRange::RangeFrom(r) => (size.min(*r.start), size),
            };
            if start < end {
                let leaf = Leaf {
                    offset: start,
                    data: data.slice(start as usize..end as usize),
                };
                tx.send(leaf.into()).await?;
            }
        }
        Ok(())
    }

    /// A fetched blob, checked by iroh-blobs as it arrives, kept whole: buffered, then one `put` once every byte is
    /// here. A fetch of part of a blob keeps nothing (whole or absent); a blob held already is not written again.
    async fn import_bao(
        &self,
        hash: Hash,
        size: u64,
        mut rx: mpsc::Receiver<BaoContentItem>,
    ) -> io::Result<()> {
        if self.store.has(&hash).await.map_err(io_err)? {
            while rx.recv().await.map_err(io::Error::other)?.is_some() {}
            return Ok(());
        }
        // the size is the holder's word, not yet checked by bao: nothing is allocated past the largest blob
        if size > crate::files::MAX_BLOB {
            return Err(io::Error::other(format!(
                "a blob of {size} bytes is past the largest, {}",
                crate::files::MAX_BLOB
            )));
        }
        let mut buf = vec![0u8; size as usize];
        let mut got = 0u64;
        while let Some(item) = rx.recv().await.map_err(io::Error::other)? {
            if let BaoContentItem::Leaf(leaf) = item {
                let at = leaf.offset as usize;
                let slot = buf
                    .get_mut(at..at + leaf.data.len())
                    .ok_or_else(|| io::Error::other("a leaf past the blob's end"))?;
                slot.copy_from_slice(&leaf.data);
                got += leaf.data.len() as u64;
            }
        }
        if got != size {
            return Ok(());
        }
        let bytes = Bytes::from(buf);
        if self.store.put(bytes.clone()).await.map_err(io_err)? != hash {
            return Err(io::Error::other("fetched bytes that are not the blob"));
        }
        self.keep_index(hash, &bytes);
        Ok(())
    }
}

/// bao-tree's sender over irpc's channel (iroh-blobs keeps its own private).
#[derive(RefCast)]
#[repr(transparent)]
struct Sink(mpsc::Sender<EncodedItem>);

impl bao_tree::io::mixed::Sender for Sink {
    type Error = irpc::channel::SendError;
    async fn send(&mut self, item: EncodedItem) -> Result<(), Self::Error> {
        self.0.send(item).await
    }
}
