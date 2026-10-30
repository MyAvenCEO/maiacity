//! (b) bao-tree directly, with our own range requests: one bi stream per request, `hash ‖ first chunk ‖ end chunk`
//! (1 KiB chunks, `u64::MAX` for the end), answered with the blob's size and the bao encoding of those ranges, which
//! the asker checks against the hash as it decodes. A whole blob fetched is kept with one `put`.

use aven_db_store::Hash;
use bao_tree::io::outboard::PreOrderMemOutboard;
use bao_tree::io::sync::{DecodeResponseIter, encode_ranges_validated};
use bao_tree::io::BaoContentItem;
use bao_tree::{BaoTree, BlockSize, ChunkNum, ChunkRanges};
use bytes::Bytes;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};

pub const ALPN: &[u8] = b"aven/spike-bao/1";
/// iroh's chunk groups: 16 KiB, so a 1 MiB chunk's tree is 64 leaves
const BLOCK: BlockSize = BlockSize::from_chunk_log(4);
const ABSENT: u64 = u64::MAX;

use crate::adapter::Shared;

/// One request: a blob's chunks `first..end`, answered with the encoded bytes.
type Ask = (Hash, u64, u64, tokio::sync::oneshot::Sender<Vec<u8>>);

/// Serves `aven/spike-bao/1` from a store. iroh's handlers must be `Send`, a browser's store isn't: the store is read
/// by a task of its own, which the handler asks over a channel.
#[derive(Clone)]
pub struct Serve(tokio::sync::mpsc::Sender<Ask>);

impl Serve {
    pub fn new(store: Shared) -> Self {
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Ask>(32);
        n0_future::task::spawn(async move {
            while let Some((hash, first, end, reply)) = rx.recv().await {
                let store = store.clone();
                n0_future::task::spawn(async move {
                    reply.send(answer(&store, hash, first, end).await).ok();
                });
            }
        });
        Self(tx)
    }
}

async fn answer(store: &Shared, hash: Hash, first: u64, end: u64) -> Vec<u8> {
    match store.get(&hash).await {
        Ok(Some(data)) => {
            let outboard = PreOrderMemOutboard::create(&data, BLOCK);
            let ranges = ChunkRanges::from(ChunkNum(first)..ChunkNum(end));
            let mut out = (data.len() as u64).to_le_bytes().to_vec();
            match encode_ranges_validated(&data[..], &outboard, &ranges, &mut out) {
                Ok(()) => out,
                Err(_) => ABSENT.to_le_bytes().to_vec(),
            }
        }
        _ => ABSENT.to_le_bytes().to_vec(),
    }
}

impl std::fmt::Debug for Serve {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Serve")
    }
}

impl ProtocolHandler for Serve {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        while let Ok((mut send, mut recv)) = conn.accept_bi().await {
            let ask = self.0.clone();
            n0_future::task::spawn(async move {
                let mut req = [0u8; 48];
                if recv.read_exact(&mut req).await.is_err() {
                    return;
                }
                let hash: Hash = hex(&req[..32]).parse().expect("hex");
                let first = u64::from_le_bytes(req[32..40].try_into().unwrap());
                let end = u64::from_le_bytes(req[40..48].try_into().unwrap());
                let (tx, rx) = tokio::sync::oneshot::channel();
                if ask.send((hash, first, end, tx)).await.is_err() {
                    return;
                }
                if let Ok(out) = rx.await {
                    send.write_all(&out).await.ok();
                    send.finish().ok();
                    // the asker closes once it has read
                    send.stopped().await.ok();
                }
            });
        }
        Ok(())
    }
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|b| format!("{b:02x}")).collect()
}

/// Chunks `first..end` of a blob from the peer at the other end, checked against `hash`: `(size, leaves)`, or `None`
/// where the peer has no such blob.
pub async fn fetch(conn: &Connection, hash: Hash, first: u64, end: u64) -> Result<Option<(u64, Vec<(u64, Bytes)>)>, String> {
    let (mut send, mut recv) = conn.open_bi().await.map_err(|e| e.to_string())?;
    let mut req = hash.as_bytes().to_vec();
    req.extend(first.to_le_bytes());
    req.extend(end.to_le_bytes());
    send.write_all(&req).await.map_err(|e| e.to_string())?;
    send.finish().map_err(|e| e.to_string())?;
    let body = recv.read_to_end(64 << 20).await.map_err(|e| e.to_string())?;
    let size = u64::from_le_bytes(body.get(..8).ok_or("short answer")?.try_into().unwrap());
    if size == ABSENT {
        return Ok(None);
    }
    let ranges = ChunkRanges::from(ChunkNum(first)..ChunkNum(end));
    let tree = BaoTree::new(size, BLOCK);
    let root = blake3::Hash::from_bytes(*hash.as_bytes());
    let mut leaves = Vec::new();
    for item in DecodeResponseIter::new(root, tree, &body[8..], &ranges) {
        if let BaoContentItem::Leaf(leaf) = item.map_err(|e| e.to_string())? {
            leaves.push((leaf.offset, leaf.data));
        }
    }
    Ok(Some((size, leaves)))
}

/// A whole blob from the peer, kept in `store`.
pub async fn get_blob(conn: &Connection, store: &Shared, hash: Hash) -> Result<Bytes, String> {
    if let Some(b) = store.get(&hash).await.map_err(|e| e.to_string())? {
        return Ok(b);
    }
    let (size, leaves) = fetch(conn, hash, 0, u64::MAX).await?.ok_or("the peer has no such blob")?;
    let mut buf = vec![0u8; size as usize];
    for (at, data) in leaves {
        buf[at as usize..at as usize + data.len()].copy_from_slice(&data);
    }
    let bytes = Bytes::from(buf);
    store.put(bytes.clone()).await.map_err(|e| e.to_string())?;
    Ok(bytes)
}
