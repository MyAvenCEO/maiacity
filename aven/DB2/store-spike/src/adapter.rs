//! (a) iroh-blobs on our `Store`: an actor answering iroh-blobs' store API (`api::proto::Request`) from blobs that are
//! whole or absent. Started from iroh-blobs' `readonly_mem.rs`. Transfer needs six of its 23 requests: observe, status
//! and the two exports to serve, import of bao to fetch, and listing; tags, temp tags' protection and deletes are not
//! ours (refs and reachability are), so they answer "unsupported" or nothing.

use std::io;
use std::sync::Arc;

use aven_db_store::{Error, Store};
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

/// Our store, as the actor holds it: in a browser it is neither `Send` nor `Sync`, and the actor and its tasks run on
/// the one thread, so only channels cross to iroh-blobs.
#[cfg(not(target_arch = "wasm32"))]
pub type Shared = Arc<dyn Store + Send + Sync>;
#[cfg(target_arch = "wasm32")]
pub type Shared = Arc<dyn Store>;

/// iroh-blobs' store, answered from ours.
pub fn blobs(store: Shared) -> api::Store {
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Command>(32);
    n0_future::task::spawn(async move {
        while let Some(cmd) = rx.recv().await {
            if let Command::Shutdown(cmd) = cmd {
                cmd.tx.send(()).await.ok();
                break;
            }
            n0_future::task::spawn(handle(store.clone(), cmd));
        }
    });
    let client: irpc::Client<proto::Request> = irpc::LocalSender::from(tx).into();
    api::Store::ref_cast(&client).clone()
}

/// One BLAKE3 hash, in our spelling (the store has no constructor from bytes: the spike leaves the contract alone).
fn id(h: iroh_blobs::Hash) -> aven_db_store::Hash {
    h.to_hex().parse().expect("a BLAKE3 hash in hex")
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

/// A blob's size without reading it: one stat (a HEAD on S3), through the contract's range error.
async fn size(store: &Shared, hash: iroh_blobs::Hash) -> io::Result<Option<u64>> {
    match store.get_range(&id(hash), u64::MAX..u64::MAX).await {
        Ok(None) => Ok(None),
        Err(Error::Range { len, .. }) => Ok(Some(len)),
        Ok(Some(_)) => Err(io::Error::other("a blob of 2^64 bytes")),
        Err(e) => Err(io_err(e)),
    }
}

async fn whole(store: &Shared, hash: iroh_blobs::Hash) -> io::Result<Bytes> {
    store
        .get(&id(hash))
        .await
        .map_err(io_err)?
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no such blob"))
}

async fn handle(store: Shared, cmd: Command) {
    match cmd {
        Command::Observe(cmd) => {
            let bits = match size(&store, cmd.inner.hash).await {
                Ok(Some(n)) => Bitfield::complete(n),
                _ => Bitfield::empty(),
            };
            cmd.tx.send(bits).await.ok();
        }
        Command::BlobStatus(cmd) => {
            let status = match size(&store, cmd.inner.hash).await {
                Ok(Some(size)) => BlobStatus::Complete { size },
                _ => BlobStatus::NotFound,
            };
            cmd.tx.send(status).await.ok();
        }
        Command::ExportBao(mut cmd) => {
            let hash = cmd.inner.hash;
            match whole(&store, hash).await {
                Ok(data) => {
                    // the outboard is made, not kept: about 4 KiB of tree for a 1 MiB chunk. `get` checked the
                    // bytes against their name, so its root is `hash`
                    let outboard = PreOrderMemOutboard::create(&data, IROH_BLOCK_SIZE);
                    let tx = Sink::ref_cast_mut(&mut cmd.tx);
                    traverse_ranges_validated(data, outboard, &cmd.inner.ranges, tx).await.ok();
                }
                Err(e) => {
                    cmd.tx.send(EncodedItem::Error(e.into())).await.ok();
                }
            }
        }
        Command::ExportRanges(mut cmd) => {
            if let Err(e) = export_ranges(&store, &cmd.inner, &mut cmd.tx).await {
                cmd.tx.send(ExportRangesItem::Error(e.into())).await.ok();
            }
        }
        Command::ImportBao(cmd) => {
            let result = import_bao(&store, cmd.inner.hash, cmd.inner.size.get(), cmd.rx).await;
            cmd.tx.send(result.map_err(Into::into)).await.ok();
        }
        Command::ListBlobs(cmd) => match store.list().await {
            Ok(all) => {
                for h in all {
                    cmd.tx.send(Ok(iroh_blobs::Hash::from_bytes(*h.as_bytes()))).await.ok();
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

/// Plain bytes of a blob, for iroh-blobs' reading of a hash sequence: the whole blob, sliced.
async fn export_ranges(
    store: &Shared,
    req: &proto::ExportRangesRequest,
    tx: &mut mpsc::Sender<ExportRangesItem>,
) -> io::Result<()> {
    let data = whole(store, req.hash).await?;
    let size = data.len() as u64;
    tx.send(ExportRangesItem::Size(size)).await?;
    for range in req.ranges.iter() {
        let (start, end) = match range {
            RangeSetRange::Range(r) => (size.min(*r.start), size.min(*r.end)),
            RangeSetRange::RangeFrom(r) => (size.min(*r.start), size),
        };
        if start < end {
            let leaf = Leaf { offset: start, data: data.slice(start as usize..end as usize) };
            tx.send(leaf.into()).await?;
        }
    }
    Ok(())
}

/// A fetched blob, verified by iroh-blobs as it arrives, kept whole: buffered, then one `put` once every byte is
/// here. A fetch of part of a blob keeps nothing (whole or absent).
async fn import_bao(
    store: &Shared,
    hash: iroh_blobs::Hash,
    size: u64,
    mut rx: mpsc::Receiver<BaoContentItem>,
) -> io::Result<()> {
    if store.has(&id(hash)).await.map_err(io_err)? {
        while rx.recv().await.map_err(io::Error::other)?.is_some() {}
        return Ok(());
    }
    let mut buf = vec![0u8; usize::try_from(size).map_err(io::Error::other)?];
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
    let put = store.put(buf.into()).await.map_err(io_err)?;
    if put != id(hash) {
        return Err(io::Error::other("fetched bytes that are not the blob"));
    }
    Ok(())
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
