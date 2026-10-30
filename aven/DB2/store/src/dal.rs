//! Every backend through Apache OpenDAL: one `Store` over an `Operator`. Blobs at `blobs/<hash>`, refs at
//! `refs/<name>` holding their hash in hex. Nothing of OpenDAL leaves this file and `backend.rs`.

use std::ops::Range;

use async_lock::Mutex;
use bytes::Bytes;
use opendal::{ErrorKind, Operator};

use crate::{Error, Hash, RefName, Result, Store};

/// Which of S3's conditional writes a store sends with its refs: beside its own lock and the one writer, they make the
/// server refuse a stale write itself, so even a second writer, which rule 1 rules out, can't overwrite a ref unseen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conditions {
    /// `If-None-Match: *` to set a ref that must not exist, `If-Match` to change or delete one.
    On,
    /// `If-None-Match: *` only: every write-once ref (the claim, `joined-<invite>`) is refused on the server, a ref
    /// that changes leans on the lock. Hetzner refuses a correct `If-Match` (the deploy's probe, 30 Oct 2026).
    Create,
    /// None: the lock and the one writer alone, as on a folder.
    Off,
}

impl Conditions {
    pub fn name(self) -> &'static str {
        match self {
            Conditions::On => "on",
            Conditions::Create => "create",
            Conditions::Off => "off",
        }
    }
}

pub struct DalStore {
    op: Operator,
    /// Compare-and-set reads, compares and writes under this lock: the one writer's tasks take turns.
    writes: Mutex<()>,
    conditions: Conditions,
}

impl DalStore {
    pub(crate) fn new(op: Operator) -> Self {
        let cap = op.info().capability();
        let conditional =
            cap.write_with_if_match && cap.write_with_if_not_exists && cap.delete_with_if_match;
        Self {
            op,
            writes: Mutex::new(()),
            conditions: if conditional {
                Conditions::On
            } else {
                Conditions::Off
            },
        }
    }

    /// The same store sending fewer of the backend's conditional writes: never more than it takes.
    pub(crate) fn with_conditions(self, conditions: Conditions) -> Self {
        let conditions = match (self.conditions, conditions) {
            (Conditions::Off, _) => Conditions::Off,
            (_, c) => c,
        };
        Self { conditions, ..self }
    }

    /// Which conditional writes the store sends.
    pub fn conditions(&self) -> Conditions {
        self.conditions
    }

    /// Whether the backend itself refuses every stale ref write.
    pub fn conditional_writes(&self) -> bool {
        self.conditions == Conditions::On
    }

    /// The ref's hash and, on a conditional backend, the tag of the version it was read from.
    async fn read_ref(&self, name: &RefName) -> Result<(Option<Hash>, Option<String>)> {
        let path = ref_path(name);
        if self.conditions != Conditions::On {
            // A read racing a write sees the old value or the new one, but OPFS can also refuse it: the `File` it
            // read from went stale when the write committed, which it reports as `NotReadableError` or even
            // `NotFoundError`. So a ref is missing only if its file is; otherwise reading again sees the new value.
            // WebKit's OPFS doesn't refuse such a read: it hands back the file empty or zero-filled while the write
            // commits (measured in Safari 27.2's engine, 30 Oct 2026). So a ref that isn't a hash is read again too,
            // and is `Corrupt` only if it stays so.
            let mut tries = 0;
            return loop {
                let refused = match self.op.read(&path).await {
                    Ok(buf) => match parse_ref(&buf.to_bytes()) {
                        Ok(hash) => break Ok((Some(hash), None)),
                        Err(e) if tries == 8 => break Err(e),
                        Err(_) => {
                            tries += 1;
                            continue;
                        }
                    },
                    Err(e)
                        if e.kind() == ErrorKind::NotFound
                            && !self.op.exists(&path).await.map_err(backend)? =>
                    {
                        break Ok((None, None));
                    }
                    Err(e) => e,
                };
                if tries == 8 {
                    break Err(backend(refused));
                }
                tries += 1;
            };
        }
        // stat, then read that same version; a change in between only means reading again
        for _ in 0..8 {
            let tag = match self.op.stat(&path).await {
                Ok(meta) => meta
                    .etag()
                    .map(str::to_owned)
                    .ok_or_else(|| Error::Backend("no ETag".into()))?,
                Err(e) if e.kind() == ErrorKind::NotFound => return Ok((None, None)),
                Err(e) => return Err(backend(e)),
            };
            match self.op.read_with(&path).if_match(&tag).await {
                Ok(buf) => return Ok((Some(parse_ref(&buf.to_bytes())?), Some(tag))),
                Err(e)
                    if matches!(e.kind(), ErrorKind::ConditionNotMatch | ErrorKind::NotFound) =>
                {
                    continue;
                }
                Err(e) => return Err(backend(e)),
            }
        }
        Err(Error::Backend(format!(
            "ref {name} kept changing while read"
        )))
    }

    async fn stale(&self, name: &RefName) -> Error {
        match self.read_ref(name).await {
            Ok((current, _)) => Error::Stale { current },
            Err(e) => e,
        }
    }
}

#[cfg_attr(not(target_arch = "wasm32"), async_trait::async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait::async_trait(?Send))]
impl Store for DalStore {
    async fn put(&self, bytes: Bytes) -> Result<Hash> {
        let hash = Hash::of(&bytes);
        let path = blob_path(&hash);
        if !self.op.exists(&path).await.map_err(backend)? {
            self.op.write(&path, bytes).await.map_err(backend)?;
        }
        Ok(hash)
    }

    async fn get(&self, hash: &Hash) -> Result<Option<Bytes>> {
        match self.op.read(&blob_path(hash)).await {
            Ok(buf) => {
                let bytes = buf.to_bytes();
                if Hash::of(&bytes) != *hash {
                    return Err(Error::Corrupt(format!("blob {hash} holds other bytes")));
                }
                Ok(Some(bytes))
            }
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(backend(e)),
        }
    }

    async fn get_range(&self, hash: &Hash, range: Range<u64>) -> Result<Option<Bytes>> {
        let path = blob_path(hash);
        let len = match self.op.stat(&path).await {
            Ok(meta) => meta.content_length(),
            Err(e) if e.kind() == ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(backend(e)),
        };
        let Range { start, end } = range;
        if start > end || end > len {
            return Err(Error::Range { start, end, len });
        }
        if start == end {
            return Ok(Some(Bytes::new()));
        }
        let buf = self
            .op
            .read_with(&path)
            .range(start..end)
            .await
            .map_err(backend)?;
        Ok(Some(buf.to_bytes()))
    }

    async fn has(&self, hash: &Hash) -> Result<bool> {
        self.op.exists(&blob_path(hash)).await.map_err(backend)
    }

    async fn size(&self, hash: &Hash) -> Result<Option<u64>> {
        match self.op.stat(&blob_path(hash)).await {
            Ok(meta) => Ok(Some(meta.content_length())),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(backend(e)),
        }
    }

    async fn list(&self) -> Result<Vec<Hash>> {
        // only names that are hashes: a crash's leftovers, if a backend leaves any, are never blobs
        let mut hashes: Vec<Hash> = self
            .names("blobs/")
            .await?
            .iter()
            .filter_map(|n| n.parse().ok())
            .collect();
        hashes.sort();
        Ok(hashes)
    }

    async fn delete(&self, hash: &Hash) -> Result<()> {
        // gone already is fine; OPFS says NotFound where the others say nothing
        match self.op.delete(&blob_path(hash)).await {
            Err(e) if e.kind() != ErrorKind::NotFound => Err(backend(e)),
            _ => Ok(()),
        }
    }

    async fn get_ref(&self, name: &RefName) -> Result<Option<Hash>> {
        Ok(self.read_ref(name).await?.0)
    }

    async fn set_ref(&self, name: &RefName, expected: Option<Hash>, new: Hash) -> Result<()> {
        let _turn = self.writes.lock().await;
        let (current, tag) = self.read_ref(name).await?;
        if current != expected {
            return Err(Error::Stale { current });
        }
        let path = ref_path(name);
        let content = format!("{new}\n");
        let create = expected.is_none() && self.conditions != Conditions::Off;
        let written = if create {
            self.op.write_with(&path, content).if_not_exists(true).await
        } else if let Some(tag) = tag {
            self.op.write_with(&path, content).if_match(&tag).await
        } else {
            self.op.write(&path, content).await
        };
        match written {
            Ok(_) => Ok(()),
            Err(e) if is_refused(&e) || (create && is_create_refused(&e)) => {
                Err(self.stale(name).await)
            }
            Err(e) => Err(backend(e)),
        }
    }

    async fn delete_ref(&self, name: &RefName, expected: Hash) -> Result<()> {
        let _turn = self.writes.lock().await;
        let (current, tag) = self.read_ref(name).await?;
        if current != Some(expected) {
            return Err(Error::Stale { current });
        }
        let path = ref_path(name);
        let deleted = match tag {
            Some(tag) => self.op.delete_with(&path).if_match(&tag).await,
            None => self.op.delete(&path).await,
        };
        match deleted {
            Ok(()) => Ok(()),
            Err(e) if is_refused(&e) => Err(self.stale(name).await),
            Err(e) => Err(backend(e)),
        }
    }

    async fn list_refs(&self) -> Result<Vec<RefName>> {
        let mut names: Vec<RefName> = self
            .names("refs/")
            .await?
            .into_iter()
            .filter_map(|n| RefName::new(n).ok())
            .collect();
        names.sort();
        Ok(names)
    }
}

impl DalStore {
    /// The files directly in `dir`.
    async fn names(&self, dir: &str) -> Result<Vec<String>> {
        match self.op.list(dir).await {
            Ok(entries) => Ok(entries
                .into_iter()
                .filter(|e| e.metadata().is_file())
                .map(|e| e.name().to_owned())
                .collect()),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Vec::new()),
            Err(e) => Err(backend(e)),
        }
    }
}

fn blob_path(hash: &Hash) -> String {
    format!("blobs/{hash}")
}

fn ref_path(name: &RefName) -> String {
    format!("refs/{name}")
}

fn parse_ref(bytes: &[u8]) -> Result<Hash> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| Error::Corrupt("a ref that isn't text".into()))?;
    text.strip_suffix('\n').unwrap_or(text).parse()
}

fn is_refused(e: &opendal::Error) -> bool {
    matches!(
        e.kind(),
        ErrorKind::ConditionNotMatch | ErrorKind::AlreadyExists
    )
}

/// A create over an existing key, as a server refuses it other than with 412: Hetzner's answer is not 412 (the deploy's
/// probe prints its status and code); 409 `ConditionalRequestConflict` is S3's for a race with another create.
fn is_create_refused(e: &opendal::Error) -> bool {
    let said = e.to_string();
    [
        "409",
        "412",
        "ConditionalRequestConflict",
        "PreconditionFailed",
    ]
    .iter()
    .any(|c| said.contains(c))
}

fn backend(e: opendal::Error) -> Error {
    Error::Backend(e.to_string())
}
