//! Files on a Peer (store/README.md, "How a file travels"): the folder a Peer shares, and the Aven Peer's rule that
//! keeps every file announced. A file is announced as a line of its sender's chain (`aven_peer::chats`, the city-dome
//! thread's); this module is the bytes' side of it.
//!
//! - [`share`]: a Peer shares a folder (`--files DIR`). Each file that lands in it is put into the store as a hash
//!   sequence, a chunk at a time, its ref `file-<index>` set, and handed to `announce`.
//! - [`keep`]: the Aven Peer, told of a file line on a member device's chain, fetches the whole hash sequence from that
//!   device through iroh-blobs, checks its length against the line's size and sets `file-<index>`, so the file is
//!   served once its sender is gone.
//!
//! Timeline lines: `shared` (a file put), `kept` (a file fetched whole and kept: how many bytes crossed, how long it
//! took) and `dropped` (a file not shared or kept, and why).

use std::collections::BTreeMap;
use std::future::Future;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime};

use aven_db_core::timeline;
use aven_db_store::blobs::{Blobs, FetchError};
use aven_db_store::{Hash, RefName, Store, files};
use aven_runtimes_registry as registry;
use bytes::Bytes;
use iroh::{Endpoint, EndpointAddr, PublicKey, RelayUrl};
use serde_json::json;
use tokio::time::{Duration, sleep};

use crate::{Notes, now};

/// The ref that keeps a file: `file-<index>`.
pub fn file_ref(index: &Hash) -> RefName {
    RefName::new(format!("file-{index}")).expect("a valid ref name")
}

/// The media type a file is, by its first bytes (aven/runtimes' registry, `Aven.Runtime.Registry`): its name only
/// chooses among the text formats its bytes can't tell apart, so a movie named `.txt` is still a movie. A file that
/// can't be read is `application/octet-stream`.
pub fn sniffed(path: &Path, name: &str) -> &'static str {
    let mut head = Vec::with_capacity(registry::HEAD_MAX);
    let read = std::fs::File::open(path)
        .and_then(|f| f.take(registry::HEAD_MAX as u64).read_to_end(&mut head));
    if read.is_err() {
        return registry::FileType::Unknown.mime();
    }
    registry::sniff(
        &head,
        &registry::Claim {
            r#type: None,
            name: Some(name),
        },
    )
    .mime()
}

/// A file put from the folder, to announce: its index's hash, its size, its name and the type its bytes say.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Shared {
    pub index: Hash,
    pub size: u64,
    pub name: String,
    pub mime: String,
}

/// A file's chunks as they are read from disk, one at a time.
fn chunks(path: &Path) -> std::io::Result<impl Iterator<Item = Bytes>> {
    let mut file = std::fs::File::open(path)?;
    Ok(std::iter::from_fn(move || {
        let mut buf = Vec::with_capacity(files::CHUNK as usize);
        match (&mut file).take(files::CHUNK).read_to_end(&mut buf) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(Bytes::from(buf)),
        }
    }))
}

/// Shares the folder `dir` for as long as the Peer runs: every new or changed file in it, but those whose name starts
/// with a dot or ends in `.part` (still being written), is put and handed to `announce`.
pub async fn share<S, F, A>(dir: PathBuf, store: Arc<S>, announce: A, me: String, notes: Notes)
where
    S: Store + ?Sized,
    A: Fn(Shared) -> F,
    F: Future<Output = ()>,
{
    let note = |event: &str, fields| notes(timeline::line(now(), &me, event, fields));
    let mut seen: BTreeMap<PathBuf, (u64, SystemTime)> = BTreeMap::new();
    loop {
        let mut found = vec![];
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let Ok(meta) = entry.metadata() else { continue };
                if meta.is_file() && !name.starts_with('.') && !name.ends_with(".part") {
                    found.push((
                        entry.path(),
                        name,
                        (
                            meta.len(),
                            meta.modified().unwrap_or(SystemTime::UNIX_EPOCH),
                        ),
                    ));
                }
            }
        }
        found.sort();
        for (path, name, stamp) in found {
            if seen.get(&path) == Some(&stamp) {
                continue;
            }
            seen.insert(path.clone(), stamp);
            let started = Instant::now();
            let put = match chunks(&path) {
                Ok(chunks) => files::put(&*store, chunks).await.map_err(|e| e.to_string()),
                Err(e) => Err(e.to_string()),
            };
            let index = match put {
                Ok(index) => index,
                Err(why) => {
                    note("dropped", json!({ "file": name, "why": why }));
                    continue;
                }
            };
            let _ = store.set_ref(&file_ref(&index), None, index).await;
            note(
                "shared",
                json!({ "file": index.to_string(), "name": name, "size": stamp.0, "ms": started.elapsed().as_millis() as u64 }),
            );
            announce(Shared {
                index,
                size: stamp.0,
                mime: sniffed(&path, &name).into(),
                name,
            })
            .await;
        }
        sleep(Duration::from_secs(1)).await;
    }
}

/// Why a file wasn't kept. Only a sender that couldn't be reached may have it later: one that said it hasn't the file,
/// or whose file isn't the size its line says, never will, so the Aven Peer doesn't ask it again.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeepError {
    /// The device said it hasn't the file's index or a chunk of it.
    NotFound(String),
    /// The file it holds is `held` bytes; its line says `announced`.
    Mismatch { held: u64, announced: u64 },
    /// The index it announced is no list of hashes, lists more or fewer chunks than its size needs, or a chunk isn't
    /// cut as a file's must be (every one but the last exactly 1 MiB), or the file is past the largest: its bytes are
    /// checked against their names, so it never will be otherwise.
    Malformed(String),
    /// The device couldn't be reached, or the fetch or the store failed on the way: worth asking again.
    Unreachable(String),
}

impl KeepError {
    /// Whether asking the device again may keep the file.
    pub fn retry(&self) -> bool {
        matches!(self, KeepError::Unreachable(_))
    }
}

impl std::fmt::Display for KeepError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            KeepError::NotFound(why) | KeepError::Malformed(why) | KeepError::Unreachable(why) => {
                f.write_str(why)
            }
            KeepError::Mismatch { held, announced } => {
                write!(f, "{held} bytes, announced as {announced}")
            }
        }
    }
}

/// The Aven Peer's rule for one file line: the whole hash sequence `index` fetched from the device `from`, its length
/// checked against `size`, and kept under `file-<index>`; a file kept already is left as it is. The bytes that
/// crossed, and a `kept` or `dropped` line.
#[allow(clippy::too_many_arguments)]
pub async fn keep<S: Store + ?Sized>(
    endpoint: &Endpoint,
    relay: &RelayUrl,
    blobs: &Blobs,
    store: &S,
    from: PublicKey,
    index: Hash,
    size: u64,
    me: &str,
    notes: &Notes,
) -> Result<u64, KeepError> {
    let name = file_ref(&index);
    if matches!(store.get_ref(&name).await, Ok(Some(_))) {
        return Ok(0);
    }
    let started = Instant::now();
    let kept = async {
        let at = EndpointAddr::new(from).with_relay_url(relay.clone());
        let unreachable = |e: &dyn std::fmt::Display| KeepError::Unreachable(e.to_string());
        let conn = endpoint
            .connect(at, crate::blobs::ALPN)
            .await
            .map_err(|e| unreachable(&e))?;
        let fetch_error = |e: FetchError| match e {
            FetchError::NotFound(_) => KeepError::NotFound(e.to_string()),
            FetchError::NotAFile(_) => KeepError::Malformed(e.to_string()),
            FetchError::Failed(_) => unreachable(&e),
        };
        let corrupt = |e: aven_db_store::Error| match e {
            aven_db_store::Error::Corrupt(_) => KeepError::Malformed(e.to_string()),
            _ => unreachable(&e),
        };
        // the index first: a file whose index lists more or fewer chunks than its line's size needs, or one past the
        // largest file, is refused before any chunk is fetched
        if size > files::MAX_FILE {
            return Err(KeepError::Malformed(format!(
                "{size} bytes, past the largest file"
            )));
        }
        blobs
            .fetch_chunks(&conn, index, 0..0)
            .await
            .map_err(fetch_error)?;
        let listed = files::open(store, &index)
            .await
            .map_err(corrupt)?
            .ok_or_else(|| KeepError::NotFound("no index".into()))?;
        if listed.chunks.len() as u64 != size.div_ceil(files::CHUNK) {
            return Err(KeepError::Malformed(format!(
                "an index of {} chunks for {size} bytes",
                listed.chunks.len()
            )));
        }
        let fetched = blobs.fetch_file(&conn, index).await.map_err(fetch_error)?;
        let file = files::open(store, &index)
            .await
            .map_err(corrupt)?
            .ok_or_else(|| KeepError::NotFound("no index".into()))?;
        // every chunk but the last exactly 1 MiB: a malformed file is never kept, and never read into a panic
        file.check(store).await.map_err(corrupt)?;
        if file.len != size {
            return Err(KeepError::Mismatch {
                held: file.len,
                announced: size,
            });
        }
        match store.set_ref(&name, None, index).await {
            Ok(()) | Err(aven_db_store::Error::Stale { .. }) => Ok(fetched.bytes),
            Err(e) => Err(unreachable(&e)),
        }
    };
    let result = kept.await;
    let line = match &result {
        Ok(bytes) => (
            "kept",
            json!({ "file": index.to_string(), "size": size, "bytes": bytes,
            "ms": started.elapsed().as_millis() as u64 }),
        ),
        Err(why) => (
            "dropped",
            json!({ "file": index.to_string(), "why": why.to_string(), "retry": why.retry() }),
        ),
    };
    notes(timeline::line(now(), me, line.0, line.1));
    result
}
