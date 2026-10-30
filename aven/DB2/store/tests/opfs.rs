//! The opfs driver over a folder in memory: the conformance suite, with a folder that moves and one that copies, and a
//! crash at every step of every call of the model's traces (Lean: `Aven.DB.StoreCrash`, `crash_atomic`).

#![cfg(not(target_arch = "wasm32"))]

use std::collections::BTreeMap;
use std::ops::Range;
use std::sync::atomic::{AtomicUsize, Ordering};

use aven_db_store::folder::{Folder, MemFolder};
use aven_db_store::opfs::OpfsStore;
use aven_db_store::{Error, Result, conformance};
use bytes::Bytes;
use serde_json::Value;

const TRACES: &str = include_str!("../../db/spec/vectors/store.json");

#[tokio::test]
async fn opfs_passes_the_suite_moving_and_copying() {
    for moves in [true, false] {
        let report = conformance::run(
            async || OpfsStore::open(MemFolder::new(moves)).await.unwrap(),
            TRACES,
        )
        .await;
        println!("moves {moves}:\n{report}");
        assert!(report.passed(), "moves {moves}");
    }
}

/// How a crash leaves the write it cuts: nothing of it, half, or all of its bytes but not the call's return.
#[derive(Clone, Copy, Debug)]
enum Tear {
    Nothing,
    Half,
    Whole,
}

/// A folder that crashes at its `at`-th change (a write, a move or a remove): that change is cut as `tear` says, and
/// every call after it fails, as a closed tab does.
struct Crashing {
    inner: MemFolder,
    at: usize,
    tear: Tear,
    changes: AtomicUsize,
}

impl Crashing {
    /// Whether this change is the crash; past it, every call fails.
    fn crash_now(&self) -> Result<bool> {
        let n = self.changes.fetch_add(1, Ordering::SeqCst);
        if n > self.at {
            return Err(Error::Backend("crashed".into()));
        }
        Ok(n == self.at)
    }

    fn crashed(&self) -> bool {
        self.changes.load(Ordering::SeqCst) > self.at
    }

    fn alive(&self) -> Result<()> {
        if self.crashed() {
            return Err(Error::Backend("crashed".into()));
        }
        Ok(())
    }
}

#[async_trait::async_trait]
impl Folder for Crashing {
    async fn read(&self, path: &str, range: Option<Range<u64>>) -> Result<Option<Bytes>> {
        self.alive()?;
        self.inner.read(path, range).await
    }

    async fn size(&self, path: &str) -> Result<Option<u64>> {
        self.alive()?;
        self.inner.size(path).await
    }

    async fn write(&self, path: &str, bytes: &[u8]) -> Result<()> {
        if self.crash_now()? {
            let part = match self.tear {
                Tear::Nothing => return Err(Error::Backend("crashed".into())),
                Tear::Half => &bytes[..bytes.len() / 2],
                Tear::Whole => bytes,
            };
            self.inner.set(path, part);
            return Err(Error::Backend("crashed".into()));
        }
        self.inner.write(path, bytes).await
    }

    async fn rename(&self, from: &str, to: &str) -> Result<bool> {
        if self.crash_now()? {
            return Err(Error::Backend("crashed".into()));
        }
        self.inner.rename(from, to).await
    }

    async fn remove(&self, path: &str) -> Result<()> {
        if self.crash_now()? {
            return Err(Error::Backend("crashed".into()));
        }
        self.inner.remove(path).await
    }

    async fn list(&self, dir: &str) -> Result<Vec<String>> {
        self.alive()?;
        self.inner.list(dir).await
    }
}

/// The folder after `ops`, from `files`.
async fn after(
    files: &BTreeMap<String, Vec<u8>>,
    moves: bool,
    ops: &[Value],
) -> BTreeMap<String, Vec<u8>> {
    let folder = MemFolder::with_files(files.clone(), moves);
    let store = OpfsStore::open(folder.clone()).await.unwrap();
    for op in ops {
        conformance::call(&store, op).await;
    }
    folder.files()
}

/// Every call of every trace, crashed at each of its changes, each tear: reopened, the folder is the store before
/// the call or after it, file for file, with no temporary file left.
#[tokio::test]
async fn a_crash_leaves_every_call_undone_or_done() {
    let traces: Vec<Value> = serde_json::from_str(TRACES).unwrap();
    let mut crashes = 0;
    for moves in [true, false] {
        for trace in &traces {
            let ops = trace["input"]["ops"].as_array().unwrap();
            // a store is made once, its marker written, before any call
            let made = MemFolder::new(moves);
            OpfsStore::open(made.clone()).await.unwrap();
            let mut before: BTreeMap<String, Vec<u8>> = made.files();
            for (i, op) in ops.iter().enumerate() {
                let done = after(&before, moves, std::slice::from_ref(op)).await;
                for tear in [Tear::Nothing, Tear::Half, Tear::Whole] {
                    for at in 0.. {
                        let inner = MemFolder::with_files(before.clone(), moves);
                        let folder = Crashing {
                            inner: inner.clone(),
                            at,
                            tear,
                            changes: AtomicUsize::new(0),
                        };
                        let store = OpfsStore::open(folder).await.unwrap();
                        conformance::call(&store, op).await;
                        if !store.folder().crashed() {
                            break;
                        }
                        crashes += 1;
                        OpfsStore::open(inner.clone()).await.unwrap();
                        let got = inner.files();
                        assert!(
                            got == before || got == done,
                            "{}, call {i} {op}, moves {moves}, crash at change {at}, {tear:?}: the folder is neither \
                             before nor after the call: {:?}",
                            trace["name"],
                            got.keys().collect::<Vec<_>>()
                        );
                    }
                }
                before = done;
            }
        }
    }
    println!("{crashes} crashes, each recovered to before or after its call");
    assert!(crashes > 1000);
}

/// A folder that refuses writes past `room` bytes, as OPFS does over its quota, after writing what fit.
struct Full {
    inner: MemFolder,
    room: usize,
}

#[async_trait::async_trait]
impl Folder for Full {
    async fn read(&self, path: &str, range: Option<Range<u64>>) -> Result<Option<Bytes>> {
        self.inner.read(path, range).await
    }

    async fn size(&self, path: &str) -> Result<Option<u64>> {
        self.inner.size(path).await
    }

    async fn write(&self, path: &str, bytes: &[u8]) -> Result<()> {
        let used: usize = self.inner.files().values().map(Vec::len).sum();
        if used + bytes.len() > self.room {
            self.inner.set(
                path,
                &bytes[..self.room.saturating_sub(used).min(bytes.len())],
            );
            return Err(Error::Backend("OPFS is full: QuotaExceededError".into()));
        }
        self.inner.write(path, bytes).await
    }

    async fn rename(&self, from: &str, to: &str) -> Result<bool> {
        self.inner.rename(from, to).await
    }

    async fn remove(&self, path: &str) -> Result<()> {
        self.inner.remove(path).await
    }

    async fn list(&self, dir: &str) -> Result<Vec<String>> {
        self.inner.list(dir).await
    }
}

/// Over its quota, a put fails with the reason and leaves the folder as it was: no temporary file, no blob.
#[tokio::test]
async fn a_full_folder_fails_cleanly() {
    use aven_db_store::Store;
    let inner = MemFolder::new(true);
    let store = OpfsStore::open(Full {
        inner: inner.clone(),
        room: 1000,
    })
    .await
    .unwrap();
    store.put(conformance::noise(600, 1)).await.unwrap();
    let before = inner.files();
    let refused = store.put(conformance::noise(600, 2)).await;
    assert!(
        matches!(&refused, Err(Error::Backend(why)) if why.contains("full")),
        "{refused:?}"
    );
    assert_eq!(inner.files(), before);
}

/// A store says which avenDB laid it out (`meta/version`): an empty folder becomes a store of this version, and opens
/// again; a folder with anything in it but not exactly this marker is from an older avenOS (`Error::Outdated`), so the
/// Peer-Light clears its origin and starts fresh. No store is migrated.
#[tokio::test]
async fn a_store_without_this_version_is_outdated() {
    use aven_db_store::opfs::VERSION;
    use aven_db_store::{Hash, RefName, Store};
    let fresh = MemFolder::new(true);
    let store = OpfsStore::open(fresh.clone()).await.unwrap();
    assert_eq!(fresh.files()["meta/version"], VERSION.to_vec());
    let h = store.put(Bytes::from_static(b"kept")).await.unwrap();
    store
        .set_ref(&RefName::new("head").unwrap(), None, h)
        .await
        .unwrap();
    drop(store);
    let again = OpfsStore::open(fresh.clone()).await.unwrap();
    assert_eq!(
        again.get(&h).await.unwrap().unwrap(),
        Bytes::from_static(b"kept")
    );

    // as the OpenDAL OPFS driver left a store: blobs and refs, no marker
    let old = MemFolder::new(true);
    let record = Bytes::from_static(b"a record");
    old.write(&format!("blobs/{}", Hash::of(&record)), &record)
        .await
        .unwrap();
    old.write("refs/first-start", Hash::of(&record).ref_text().as_bytes())
        .await
        .unwrap();
    assert!(matches!(
        OpfsStore::open(old.clone()).await,
        Err(Error::Outdated(_))
    ));
    assert!(
        !old.files().contains_key("meta/version"),
        "an outdated store is left as it is, for the Peer-Light to clear"
    );

    // a marker that isn't this version's, and a store with only a crash's leftovers
    let other = MemFolder::new(true);
    other
        .write("meta/version", b"avenDB store 0\n")
        .await
        .unwrap();
    assert!(matches!(
        OpfsStore::open(other).await,
        Err(Error::Outdated(_))
    ));
    let leftovers = MemFolder::new(true);
    leftovers.write("tmp/ref-head", b"x").await.unwrap();
    assert!(matches!(
        OpfsStore::open(leftovers).await,
        Err(Error::Outdated(_))
    ));
}
