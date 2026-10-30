//! Files on a Peer (store/README.md, "How a file travels"). A Peer shares a folder (`--files DIR`): each file that
//! lands in it is put into its store as a hash sequence, its ref `file-<index>` set, and announced in the network's
//! room once the room has a neighbour. The Aven Peer keeps every file announced: it fetches the whole hash sequence
//! from the sender through iroh-blobs, checks its size against the announcement, and sets `file-<index>`, so the file
//! stays reachable when its sender is gone.
//!
//! Timeline lines: `shared` (a file put and announced), `kept` (a file fetched whole and kept: from whom, how many
//! bytes crossed, how long it took) and `dropped` (an announcement not kept, and why).

use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Instant, SystemTime};

use aven_db_core::chat::Announce;
use aven_db_core::timeline;
use aven_db_store::blobs::Blobs;
use aven_db_store::{Hash, RefName, Store, files};
use bytes::Bytes;
use futures_channel::mpsc::UnboundedReceiver;
use iroh::{Endpoint, EndpointAddr, PublicKey, RelayUrl};
use n0_future::StreamExt;
use serde_json::json;
use tokio::time::{Duration, sleep};

use crate::room::Room;
use crate::{Notes, now};

/// The ref that keeps a file: `file-<index>`.
pub fn file_ref(index: &Hash) -> RefName {
    RefName::new(format!("file-{index}")).expect("a valid ref name")
}

/// The MIME type a file's name claims, by its extension.
pub fn mime(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "txt" => "text/plain",
        _ => "application/octet-stream",
    }
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
/// with a dot or ends in `.part` (still being written).
pub async fn share<S: Store + ?Sized>(dir: PathBuf, store: Arc<S>, room: Room, me: String, notes: Notes) {
    let note = |event: &str, fields| notes(timeline::line(now(), &me, event, fields));
    let mut seen: BTreeMap<PathBuf, (u64, SystemTime)> = BTreeMap::new();
    loop {
        let mut found = vec![];
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                let Ok(meta) = entry.metadata() else { continue };
                if meta.is_file() && !name.starts_with('.') && !name.ends_with(".part") {
                    found.push((entry.path(), name, (meta.len(), meta.modified().unwrap_or(SystemTime::UNIX_EPOCH))));
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
            // an announcement is heard only by those connected when it goes out
            while !room.connected() {
                sleep(Duration::from_millis(500)).await;
            }
            let a = Announce { file: index.to_string(), size: stamp.0, mime: mime(&name).into(), name };
            room.announce(a.clone()).await;
            note(
                "shared",
                json!({ "file": a.file, "name": a.name, "size": a.size, "ms": started.elapsed().as_millis() as u64 }),
            );
        }
        sleep(Duration::from_secs(1)).await;
    }
}

/// The Aven Peer's rule: every file announced in the room is fetched whole from its sender and kept under
/// `file-<index>`, one at a time, unless it is kept already.
#[allow(clippy::too_many_arguments)]
pub async fn keep<S: Store + ?Sized>(
    endpoint: Endpoint,
    relay: RelayUrl,
    blobs: Blobs,
    store: Arc<S>,
    mut announced: UnboundedReceiver<(PublicKey, Announce)>,
    me: String,
    notes: Notes,
) {
    let note = |event: &str, fields| notes(timeline::line(now(), &me, event, fields));
    while let Some((from, a)) = announced.next().await {
        if from == endpoint.id() {
            continue;
        }
        let Ok(index) = a.file.parse::<Hash>() else { continue };
        let name = file_ref(&index);
        if matches!(store.get_ref(&name).await, Ok(Some(_))) {
            continue;
        }
        let started = Instant::now();
        let kept = async {
            let at = EndpointAddr::new(from).with_relay_url(relay.clone());
            let conn = endpoint.connect(at, files_alpn()).await.map_err(|e| e.to_string())?;
            let fetched = blobs.fetch_file(&conn, index).await.map_err(|e| e.to_string())?;
            let file = files::open(&*store, &index).await.map_err(|e| e.to_string())?.ok_or("no index")?;
            if file.len != a.size {
                return Err(format!("{} bytes, announced as {}", file.len, a.size));
            }
            store.set_ref(&name, None, index).await.map_err(|e| e.to_string())?;
            Ok::<_, String>(fetched.bytes)
        };
        match kept.await {
            Ok(bytes) => note(
                "kept",
                json!({ "file": a.file, "name": a.name, "size": a.size, "bytes": bytes,
                    "ms": started.elapsed().as_millis() as u64 }),
            ),
            Err(why) => note("dropped", json!({ "file": a.file, "why": why })),
        }
    }
}

fn files_alpn() -> &'static [u8] {
    crate::blobs::ALPN
}
