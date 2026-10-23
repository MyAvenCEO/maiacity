//! Durable signer order and publication receipts. Unlike a materialized view, these
//! immutable objects are never rebuilt from a restored Store or skipped on conflict.
//! Only shelves with atomic create-only names can publish batch roots.
use std::collections::HashSet;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Result, anyhow, ensure};
use avendb::batch::{self, ForkProof, Roots, SignedRoot, SignerLog, Taken};
use avendb::id::{EditId, SignerId};
use avendb::keys::Secret;
use avendb::lab::Lab;
use avendb::wire::Wire;
use bao_tree::blake3;
use bytes::Bytes;

use crate::shelf::Shelf;
use crate::{Cursor, Shared};

const SEGMENT: &[u8] = b"avenDB signer segment 1\n";
const ENROLLED: &[u8] = b"avenDB signer enrollment 1\n";
const PUBLICATION: &[u8] = b"avenDB signer publication 1\n";
const ADMISSION: &[u8] = b"avenDB root admission 1\n";
const DISABLED: &[u8] = b"avenDB signer publication disabled 1\n";
const MAX_IDS: usize = 65_536;
// Legacy SLH-DSA alone has a 17,088-byte signature, plus its key/root.
const MAX_ROOT: usize = 32 << 10;
// Peer admission is bounded independently of the local writer's necessary history.
// Reaching a quota leaves ordinary legacy signatures active, without deleting evidence.
const MAX_ADMISSIONS: usize = 4096;
const MAX_FORKS: usize = 1024;

fn seal(mut bytes: Vec<u8>) -> Bytes {
    let sum = blake3::hash(&bytes);
    bytes.extend_from_slice(sum.as_bytes());
    bytes.into()
}
fn checked<'a>(bytes: &'a [u8], magic: &[u8]) -> Result<Cursor<'a>> {
    ensure!(bytes.len() >= magic.len() + 32 && bytes.starts_with(magic), "bad signer object header");
    let (body, sum) = bytes.split_at(bytes.len() - 32);
    ensure!(blake3::hash(body).as_bytes() == sum, "bad signer object checksum");
    Ok(Cursor(&body[magic.len()..]))
}
fn take<const N: usize>(r: &mut Cursor<'_>) -> Result<[u8; N]> {
    r.array().ok_or_else(|| anyhow!("truncated signer object"))
}
fn u64of(r: &mut Cursor<'_>) -> Result<u64> {
    Ok(u64::from_be_bytes(take(r)?))
}
fn bytes<'a>(r: &mut Cursor<'a>, max: usize) -> Result<&'a [u8]> {
    let n = u32::from_be_bytes(take(r)?) as usize;
    ensure!(n <= max, "oversized signer object");
    r.take(n).ok_or_else(|| anyhow!("truncated signer object"))
}
fn put_bytes(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

/// A plain checksum catches truncation; the device-only MAC authenticates every
/// envelope field and ID before any unpublished tail is eligible for root signing.
fn authenticated_segment<'a>(data: &'a [u8], mac: &Secret) -> Result<Cursor<'a>> {
    let mut r = checked(data, SEGMENT)?;
    ensure!(r.0.len() >= 32, "missing signer segment authentication");
    let envelope = &data[..data.len() - 64];
    let tag: [u8; 32] = r.0[r.0.len() - 32..].try_into().expect("32-byte tag");
    let expected = mac.child("signer segment envelope 1", envelope).bytes();
    ensure!(
        blake3::Hash::from_bytes(tag) == blake3::Hash::from_bytes(expected),
        "unauthenticated signer ledger segment"
    );
    r.0 = &r.0[..r.0.len() - 32];
    Ok(r)
}

struct Book {
    log: SignerLog,
    next: u64,
    previous: [u8; 32],
    /// Sticky failure for a competing writer, missing segment, or mismatched publication.
    stopped: bool,
}

/// A durable publication selected by this live signer instance. Its private identity
/// prevents callers from substituting an unpublished, merely signed intermediate root.
#[derive(Clone)]
pub(crate) struct Published {
    root: Arc<SignedRoot>,
    instance: Arc<()>,
}
impl Published {
    pub(crate) fn root(&self) -> &Arc<SignedRoot> {
        &self.root
    }
}

pub(crate) struct Signers {
    instance: Arc<()>,
    shelf: Shelf,
    signer: SignerId,
    prefix: String,
    /// Authentication only, domain-separated from every vault/file/root key. It may
    /// persist queued signing events while locked, but cannot sign a root or open data.
    mac: Secret,
    saving: tokio::sync::Mutex<()>,
    book: Mutex<Book>,
    admission: tokio::sync::Mutex<Roots>,
    admission_count: AtomicUsize,
    fork_count: AtomicUsize,
}

impl Signers {
    /// Starts from a strict contiguous ledger. Existing enrollment plus missing/corrupt
    /// history is an error, never permission to wrap a replacement Store.
    pub(crate) async fn open(shelf: Shelf, signer: SignerId, lab: &mut Lab) -> Result<Option<Self>> {
        // SLH devices retain individual-signature recovery until the existing authorized key move.
        // Do not extend the deprecated suite with new enrollment or signed-root publication.
        if !shelf.atomic_put() || !lab.keys_of(signer).is_some_and(|keys| keys.suite() == avendb::sign::Suite::MlDsa) {
            return Ok(None);
        }
        let Some(mac) = lab.own_key(signer, "signer ledger authentication 1", &signer.0) else {
            return Ok(None);
        };
        let prefix = format!("signers/{}/", signer.to_hex());
        let segment_prefix = format!("{prefix}segments/");
        let names = shelf.names(&segment_prefix).await?;
        let enrollment = shelf.get(&format!("{prefix}enrolled")).await?;
        let disabled = shelf.get(&format!("{prefix}disabled")).await?;
        if let Some(disabled) = &disabled {
            let mut r = checked(disabled, DISABLED)?;
            ensure!(SignerId(take(&mut r)?) == signer && r.0.is_empty(), "invalid disabled writer marker");
        }
        let mut ids = Vec::new();
        let mut seen = HashSet::new();
        let mut previous = [0; 32];
        let mut first = None;
        for (sequence, name) in names.iter().enumerate() {
            ensure!(name == &format!("{segment_prefix}{sequence:016x}"), "signer ledger has a gap");
            let data = shelf.get(name).await?.ok_or_else(|| anyhow!("signer segment disappeared"))?;
            let mut r = authenticated_segment(&data, &mac)?;
            ensure!(
                SignerId(take(&mut r)?) == signer
                    && u64of(&mut r)? == sequence as u64
                    && take::<32>(&mut r)? == previous
                    && u64of(&mut r)? == ids.len() as u64,
                "signer segment does not extend the ledger"
            );
            let count = u32::from_be_bytes(take(&mut r)?) as usize;
            ensure!(count <= MAX_IDS && r.0.len() == count * 32, "invalid signer segment size");
            for _ in 0..count {
                let id = EditId(take(&mut r)?);
                ensure!(seen.insert(id), "repeated signer ledger id");
                ids.push(id);
            }
            previous = *blake3::hash(&data).as_bytes();
            first.get_or_insert(previous);
        }
        let enrolled_before = enrollment.is_some();
        if let Some(enrollment) = enrollment {
            let mut r = checked(&enrollment, ENROLLED)?;
            ensure!(
                SignerId(take(&mut r)?) == signer && Some(take::<32>(&mut r)?) == first && r.0.is_empty(),
                "enrolled signer history is missing or changed"
            );
        }
        let mut log = SignerLog::resume(signer, ids, None).ok_or_else(|| anyhow!("invalid signer ledger"))?;
        for name in shelf.names(&format!("{prefix}published/")).await? {
            let data = shelf.get(&name).await?.ok_or_else(|| anyhow!("publication disappeared"))?;
            let mut r = checked(&data, PUBLICATION)?;
            let root = SignedRoot::from_wire(bytes(&mut r, MAX_ROOT)?)?;
            ensure!(
                r.0.is_empty() && name == format!("{prefix}published/{:016x}", root.root.length),
                "invalid publication name"
            );
            ensure!(log.publish(root), "publication is not a persisted signer prefix");
        }
        let this = Self {
            instance: Arc::new(()),
            shelf,
            signer,
            prefix,
            mac,
            saving: Default::default(),
            book: Mutex::new(Book { log, next: names.len() as u64, previous, stopped: disabled.is_some() }),
            admission: Default::default(),
            admission_count: AtomicUsize::new(0),
            fork_count: AtomicUsize::new(0),
        };
        // A segment may have reached disk before enrollment. Recover that exact segment;
        // never choose a new history. An empty enrollment also gets an immutable segment.
        if disabled.is_none() {
            lab.start_capturing_signing(signer);
        }
        if !enrolled_before {
            ensure!(disabled.is_none(), "disabled writer has no enrollment");
            let began = std::time::Instant::now();
            let legacy = lab.capture_signing(signer);
            tracing::info!(signer = %signer.to_hex(), verified = legacy.len(),
                seconds = began.elapsed().as_secs_f64(), "avendb: enrolled individually signed legacy edits");
            let missing: Vec<_> = {
                let book = this.book();
                legacy.into_iter().filter(|id| book.log.tree().index(*id).is_none()).collect()
            };
            if names.is_empty() && missing.is_empty() {
                this.append(&[]).await?;
            }
            for chunk in missing.chunks(MAX_IDS) {
                this.append(chunk).await?;
            }
        }
        let first = this
            .shelf
            .get(&format!("{}segments/0000000000000000", this.prefix))
            .await?
            .ok_or_else(|| anyhow!("missing first signer segment"))?;
        let mut enrolled = ENROLLED.to_vec();
        enrolled.extend_from_slice(&signer.0);
        enrolled.extend_from_slice(blake3::hash(&first).as_bytes());
        this.shelf.put(&format!("{}enrolled", this.prefix), seal(enrolled)).await?;
        // The local receipt is an anchor too: a cloned device must not install a
        // conflicting first remote root as if this node had never seen its own log.
        let own = this.book().log.signed().cloned();
        if let Some(own) = own {
            this.admission.lock().await.take(&own, None);
        }
        this.restore_admissions().await?;
        Ok(Some(this))
    }

    fn book(&self) -> std::sync::MutexGuard<'_, Book> {
        self.book.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    async fn append(&self, ids: &[EditId]) -> Result<()> {
        self.append_on(&self.shelf, ids).await
    }

    async fn append_on(&self, on: &Shelf, ids: &[EditId]) -> Result<()> {
        let (sequence, bytes) = {
            let book = self.book();
            ensure!(!book.stopped, "signer ledger stopped after a conflict");
            ensure!(ids.len() <= MAX_IDS, "signer segment too large");
            let mut unique = HashSet::new();
            ensure!(
                ids.iter().all(|id| unique.insert(*id) && book.log.tree().index(*id).is_none()),
                "signer append repeats a leaf"
            );
            let mut out = SEGMENT.to_vec();
            out.extend_from_slice(&self.signer.0);
            out.extend_from_slice(&book.next.to_be_bytes());
            out.extend_from_slice(&book.previous);
            out.extend_from_slice(&book.log.tree().len().to_be_bytes());
            out.extend_from_slice(&(ids.len() as u32).to_be_bytes());
            for id in ids {
                out.extend_from_slice(&id.0);
            }
            let mac = self.mac.child("signer segment envelope 1", &out).bytes();
            out.extend_from_slice(&mac);
            (book.next, seal(out))
        };
        if let Err(e) = on.put(&format!("{}segments/{sequence:016x}", self.prefix), bytes.clone()).await {
            if e.kind() == std::io::ErrorKind::AlreadyExists {
                self.book().stopped = true;
            }
            return Err(e.into());
        }
        let mut book = self.book();
        ensure!(book.next == sequence, "overlapping signer ledger writers");
        for id in ids {
            book.log.write(*id);
        }
        book.next += 1;
        book.previous = *blake3::hash(&bytes).as_bytes();
        Ok(())
    }

    /// Called after legacy edits have been persisted. Events are acknowledged after the
    /// segment, roots only after their own immutable object, even if the Lab changed meanwhile.
    pub(crate) async fn save_on(&self, shared: &Arc<Shared>, on: &Shelf) -> Result<bool> {
        let _save = self.saving.lock().await;
        if self.book().stopped {
            self.disable_writer_on(on).await?;
            shared.locked_lab().stop_capturing_signing(self.signer);
            return Ok(false);
        }
        let capture = shared.locked_lab().signing_capture(self.signer);
        if let Some(capture) = capture {
            let ids: Vec<_> = {
                let book = self.book();
                capture.ids().iter().copied().filter(|id| book.log.tree().index(*id).is_none()).collect()
            };
            for chunk in ids.chunks(MAX_IDS) {
                self.append_on(on, chunk).await?;
            }
            shared.locked_lab().signing_saved(self.signer, &capture);
        }
        let root = self.book().log.durable_root();
        let Some(root) = root else { return Ok(false) };
        let signed = shared.locked_lab().sign_persisted_root(root);
        let Some(signed) = signed else {
            return Ok(false);
        };
        self.publish_on(on, signed).await?;
        Ok(true)
    }

    #[cfg(test)]
    async fn publish(&self, signed: SignedRoot) -> Result<()> {
        self.publish_on(&self.shelf, signed).await
    }

    async fn publish_on(&self, on: &Shelf, signed: SignedRoot) -> Result<()> {
        let root = signed.root;
        ensure!(
            root.log == self.signer
                && !self.book().stopped
                && self.book().log.tree().root_at(root.length) == Some(root.hash)
                && signed.verify(),
            "root is not of this durable signer prefix"
        );
        let mut roots = self.admission.lock().await;
        let prefix = roots.newest(self.signer).and_then(|old| {
            let (a, b) = (old.root.length.min(root.length), old.root.length.max(root.length));
            self.book().log.tree().prefix(a, b)
        });
        let mut next = roots.clone();
        match next.take(&signed, prefix.as_deref()) {
            Taken::Newer | Taken::Same | Taken::Older => {}
            Taken::Fork(fork) => {
                self.persist_fork_on(on, &fork).await?;
                *roots = next;
                self.book().stopped = true;
                self.disable_writer_on(on).await?;
                return Err(anyhow!("local signer publication proves a fork"));
            }
            _ => {
                self.book().stopped = true;
                self.disable_writer_on(on).await?;
                return Err(anyhow!("local signer root cannot extend its known durable history"));
            }
        }
        let mut encoded = PUBLICATION.to_vec();
        put_bytes(&mut encoded, &signed.to_wire());
        let name = format!("{}published/{:016x}", self.prefix, root.length);
        // Reuse a receipt if an earlier write reached disk but its acknowledgement was
        // lost. ML-DSA need not produce identical signature bytes on a retry.
        let signed = if let Some(existing) = on.get(&name).await? {
            let mut r = checked(&existing, PUBLICATION)?;
            let existing = SignedRoot::from_wire(bytes(&mut r, MAX_ROOT)?)?;
            ensure!(r.0.is_empty() && existing.root == root && existing.verify(), "conflicting publication");
            existing
        } else {
            on.put(&name, seal(encoded)).await?;
            signed
        };
        ensure!(self.book().log.publish(signed), "publication does not match its durable prefix");
        next.clear_verification_cache();
        *roots = next;
        Ok(())
    }

    pub(crate) fn root_due(&self) -> bool {
        let book = self.book();
        !book.stopped && book.log.durable_root().is_some()
    }

    /// Pin the current durable publication for a multi-request round. A later append
    /// or publication does not change this handle; a detected fork invalidates it.
    pub(crate) fn published(&self) -> Option<Published> {
        let book = self.book();
        if book.stopped {
            return None;
        }
        Some(Published { root: book.log.signed()?.clone(), instance: self.instance.clone() })
    }

    /// Membership only, without constructing a Merkle path for inventory selection.
    pub(crate) fn published_contains(&self, edit: EditId, published: &Published) -> bool {
        if !Arc::ptr_eq(&self.instance, &published.instance) {
            return false;
        }
        let book = self.book();
        let root = published.root.root;
        !book.stopped
            && book.log.tree().root_at(root.length) == Some(root.hash)
            && book.log.tree().index(edit).is_some_and(|index| index < root.length)
    }

    pub(crate) fn proof_at(&self, edit: EditId, published: &Published) -> Option<batch::Proof> {
        if !Arc::ptr_eq(&self.instance, &published.instance) {
            return None;
        }
        let book = self.book();
        let root = published.root.root;
        if book.stopped || book.log.tree().root_at(root.length) != Some(root.hash) {
            return None;
        }
        let index = book.log.tree().index(edit)?;
        let path = book.log.tree().prove(index, root.length)?;
        Some(batch::Proof { root: published.root.clone(), path })
    }

    pub(crate) fn proof(&self, edit: EditId) -> Option<batch::Proof> {
        let book = self.book();
        (!book.stopped).then(|| book.log.proof(edit)).flatten()
    }

    pub(crate) fn prefix_at(&self, from: u64, to: u64) -> Option<Vec<batch::Hash>> {
        self.book().log.tree().prefix(from, to)
    }

    /// Admission objects are content-addressed and never overwritten. Replay first
    /// reinstates fork evidence, then linked roots; an unlinked root grants no path.
    async fn restore_admissions(&self) -> Result<()> {
        let mut roots = self.admission.lock().await;
        let forks = self.shelf.names("batch-forks/").await?;
        ensure!(forks.len() <= MAX_FORKS, "fork evidence exceeds its admission quota");
        self.fork_count.store(forks.len(), Ordering::Relaxed);
        for name in forks {
            let bytes = self.shelf.get(&name).await?.ok_or_else(|| anyhow!("fork proof disappeared"))?;
            let fork = ForkProof::from_wire(&bytes)?;
            ensure!(
                fork.signer().is_some_and(|s| name == format!("batch-forks/{}", s.to_hex())),
                "invalid persisted fork proof name"
            );
            if fork.signer() == Some(self.signer) {
                self.book().stopped = true;
            }
            ensure!(roots.freeze(fork), "invalid persisted fork proof");
        }
        let mut records = Vec::new();
        let admissions = self.shelf.names("batch-roots/").await?;
        ensure!(admissions.len() <= MAX_ADMISSIONS, "root receipts exceed their admission quota");
        self.admission_count.store(admissions.len(), Ordering::Relaxed);
        for name in admissions {
            let data = self.shelf.get(&name).await?.ok_or_else(|| anyhow!("root admission disappeared"))?;
            let mut r = checked(&data, ADMISSION)?;
            let signed = SignedRoot::from_wire(bytes(&mut r, MAX_ROOT)?)?;
            ensure!(
                name == format!("batch-roots/{}", blake3::hash(&signed.root.message()).to_hex()) && signed.verify(),
                "invalid persisted root admission"
            );
            let n = u32::from_be_bytes(take(&mut r)?) as usize;
            ensure!(n <= batch::MOST_STEPS + 1 && r.0.len() == n * 32, "invalid root consistency proof");
            let mut prefix = Vec::with_capacity(n);
            for _ in 0..n {
                prefix.push(take(&mut r)?);
            }
            records.push((signed, prefix));
        }
        // Every record was admitted before it was persisted. Resume from each signer's
        // newest signed anchor; older consistency links may name other old anchors.
        records.sort_by_key(|(root, _)| (root.root.log, std::cmp::Reverse(root.root.length)));
        for (root, prefix) in records {
            if let Taken::Fork(fork) = roots.take(&root, Some(&prefix)) {
                self.persist_fork(&fork).await?;
                if fork.signer() == Some(self.signer) {
                    self.book().stopped = true;
                }
            }
            roots.clear_verification_cache();
        }
        Ok(())
    }

    pub(crate) async fn admit(&self, root: SignedRoot, prefix: &[batch::Hash]) -> Result<bool> {
        ensure!(prefix.len() <= batch::MOST_STEPS + 1, "oversized root consistency proof");
        let mut roots = self.admission.lock().await;
        // Work on a copy: failed persistence must not become admitted state in memory.
        let mut next = roots.clone();
        let taken = next.take(&root, Some(prefix));
        match taken {
            Taken::Same | Taken::Older => {
                next.clear_verification_cache();
                *roots = next;
                Ok(true)
            }
            Taken::Newer => {
                let mut out = ADMISSION.to_vec();
                put_bytes(&mut out, &root.to_wire());
                out.extend_from_slice(&(prefix.len() as u32).to_be_bytes());
                for hash in prefix {
                    out.extend_from_slice(hash);
                }
                let encoded = seal(out);
                let name = format!("batch-roots/{}", blake3::hash(&root.root.message()).to_hex());
                if let Some(existing) = self.shelf.get(&name).await? {
                    let mut r = checked(&existing, ADMISSION)?;
                    let existing = SignedRoot::from_wire(bytes(&mut r, MAX_ROOT)?)?;
                    ensure!(existing.root == root.root && existing.verify(), "conflicting admitted root");
                } else {
                    if self.admission_count.load(Ordering::Relaxed) >= MAX_ADMISSIONS {
                        return Ok(false);
                    }
                    self.shelf.put(&name, encoded).await?;
                    self.admission_count.fetch_add(1, Ordering::Relaxed);
                }
                next.clear_verification_cache();
                *roots = next;
                Ok(true)
            }
            Taken::Fork(fork) => {
                self.persist_fork(&fork).await?;
                if fork.signer() == Some(self.signer) {
                    self.book().stopped = true;
                    self.disable_writer().await?;
                }
                next.clear_verification_cache();
                *roots = next;
                Ok(false)
            }
            _ => Ok(false),
        }
    }

    pub(crate) async fn check(&self, signer: SignerId, edit: EditId, proof: &batch::Proof) -> bool {
        let mut roots = self.admission.lock().await;
        roots.check(signer, edit, proof)
    }

    pub(crate) async fn fork(&self, signer: SignerId) -> Option<ForkProof> {
        self.admission.lock().await.frozen(signer).cloned()
    }

    pub(crate) async fn freeze(&self, fork: ForkProof) -> Result<()> {
        ensure!(fork.signer().is_some(), "invalid fork proof");
        let mut roots = self.admission.lock().await;
        self.persist_fork(&fork).await?;
        if fork.signer() == Some(self.signer) {
            self.book().stopped = true;
            self.disable_writer().await?;
        }
        roots.freeze(fork);
        Ok(())
    }

    // The admission mutex serializes this quota and one immutable object per signer.
    async fn persist_fork(&self, fork: &ForkProof) -> Result<()> {
        self.persist_fork_on(&self.shelf, fork).await
    }

    async fn persist_fork_on(&self, on: &Shelf, fork: &ForkProof) -> Result<()> {
        let signer = fork.signer().ok_or_else(|| anyhow!("invalid fork proof"))?;
        let name = format!("batch-forks/{}", signer.to_hex());
        if let Some(existing) = on.get(&name).await? {
            ensure!(ForkProof::from_wire(&existing)?.signer() == Some(signer), "invalid stored fork evidence");
        } else {
            ensure!(self.fork_count.load(Ordering::Relaxed) < MAX_FORKS, "fork admission quota reached");
            on.put(&name, Bytes::from(fork.to_wire())).await?;
            self.fork_count.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    }

    async fn disable_writer(&self) -> Result<()> {
        self.disable_writer_on(&self.shelf).await
    }

    async fn disable_writer_on(&self, on: &Shelf) -> Result<()> {
        let mut out = DISABLED.to_vec();
        out.extend_from_slice(&self.signer.0);
        on.put(&format!("{}disabled", self.prefix), seal(out)).await?;
        Ok(())
    }

    pub(crate) async fn known(&self, signer: SignerId) -> Option<u64> {
        self.admission.lock().await.newest(signer).map(|r| r.root.length)
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::disk;
    use avendb::sign::DeviceKey;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Folder(PathBuf);
    impl Folder {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "avendb-signer-tests-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Folder {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn device() -> (Lab, SignerId, DeviceKey) {
        let mut lab = Lab::new();
        let key = DeviceKey::from_secret([197; 32]);
        let signer = lab.device_with("durable signer", [197; 32]);
        assert_eq!(signer, key.id());
        (lab, signer, key)
    }
    fn id(n: u64) -> EditId {
        EditId::from_u64(n)
    }

    #[tokio::test]
    async fn crash_after_segment_and_after_publication_resume_the_exact_prefix() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, key) = device();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        store.append(&[id(1), id(2)]).await.unwrap();
        assert!(store.proof(id(1)).is_none(), "persisted leaves are not a publication");
        let signed = SignedRoot::sign(&key, store.book().log.durable_root().unwrap());
        drop(store); // signing can have completed without storing its root
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        assert!(store.proof(id(1)).is_none());
        assert_eq!(store.book().log.durable_root(), Some(signed.root));
        // Simulate a root write reaching storage before its in-memory acknowledgement.
        let mut receipt = PUBLICATION.to_vec();
        put_bytes(&mut receipt, &signed.to_wire());
        shelf.put(&format!("{}published/{:016x}", store.prefix, signed.root.length), seal(receipt)).await.unwrap();
        assert!(store.proof(id(1)).is_none());
        drop(store);
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        assert!(store.proof(id(1)).unwrap().shows(signer, id(1)));
        assert_eq!(store.book().log.tree().index(id(2)), Some(1));
        store.append(&[id(3)]).await.unwrap();
        assert!(store.proof(id(3)).is_none());
        let root = store.book().log.durable_root().unwrap();
        store.publish(SignedRoot::sign(&key, root)).await.unwrap();
        assert!(store.proof(id(3)).is_some());
    }

    #[tokio::test]
    async fn legacy_slh_dsa_keeps_individual_history_without_batch_enrollment() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let mut lab = Lab::new();
        let signer = lab.device_with_in("legacy device", [198; 32], avendb::sign::Suite::SlhDsa);
        let person = lab.passkey("person");
        avendb::cast::human_on(&mut lab, person, &[signer]);
        let before = lab.backup(signer).signed().to_vec();
        assert!(!before.is_empty());
        assert!(Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().is_none());
        assert_eq!(lab.keys_of(signer).unwrap().suite(), avendb::sign::Suite::SlhDsa);
        assert_eq!(lab.backup(signer).signed(), before);
        assert!(!lab.signing_pending(signer));
        assert!(shelf.names("signers/").await.unwrap().is_empty());
        // Deprecation does not remove legacy verification or rewrite the device identity.
        for signed in before {
            assert_eq!(avendb::sign::Signed::from_wire(&signed.to_wire()).unwrap(), signed);
        }
    }

    #[tokio::test]
    async fn publication_handle_pins_only_a_durable_root_of_this_live_instance() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, key) = device();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        store.append(&[id(1), id(2)]).await.unwrap();
        assert!(store.published().is_none());
        let first = store.book().log.durable_root().unwrap();
        store.publish(SignedRoot::sign(&key, first)).await.unwrap();
        let pinned = store.published().unwrap();
        store.append(&[id(3)]).await.unwrap();
        let second = store.book().log.durable_root().unwrap();
        store.publish(SignedRoot::sign(&key, second)).await.unwrap();
        assert_eq!(pinned.root().root, first);
        assert_eq!(store.proof_at(id(1), &pinned).unwrap().root.root, first);
        assert!(store.proof_at(id(1), &pinned).unwrap().shows(signer, id(1)));
        assert!(store.proof_at(id(3), &pinned).is_none());
        assert!(store.published_contains(id(1), &pinned) && !store.published_contains(id(3), &pinned));
        assert!(store.proof_at(id(3), &store.published().unwrap()).is_some());
        let reopened = Signers::open(shelf, signer, &mut lab).await.unwrap().unwrap();
        assert!(reopened.proof_at(id(1), &pinned).is_none() && !reopened.published_contains(id(1), &pinned));
        store.book().stopped = true;
        assert!(store.published().is_none() && store.proof_at(id(1), &pinned).is_none());
        assert!(!store.published_contains(id(1), &pinned));
    }

    #[tokio::test]
    async fn concurrent_cloned_writers_cannot_skip_a_conflicting_segment() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, _) = device();
        let a = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        let b = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        a.append(&[id(1)]).await.unwrap();
        assert!(b.append(&[id(2)]).await.is_err());
        assert!(b.book().stopped && b.proof(id(2)).is_none());
        assert!(b.append(&[id(3)]).await.is_err());
        let restarted = Signers::open(shelf, signer, &mut lab).await.unwrap().unwrap();
        assert_eq!(restarted.book().log.tree().len(), 1);
        assert_eq!(restarted.book().log.tree().edit(0), Some(id(1)));
    }

    #[tokio::test]
    async fn missing_enrolled_segment_disables_roots_without_reconstructing_history() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, _) = device();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        let segment = folder.0.join(format!("g{}/{}segments/0000000000000000", crate::shelf::FLOOR, store.prefix));
        std::fs::rename(&segment, segment.with_extension("saved-for-test")).unwrap();
        assert!(Signers::open(shelf, signer, &mut lab).await.is_err());
    }

    #[tokio::test]
    async fn fork_admission_survives_restart_and_unlinked_roots_are_ineligible() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, key) = device();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        let mut a = SignerLog::wrap(signer, [id(1), id(2)]);
        let first = a.commit(&key).unwrap();
        assert!(store.admit((*first).clone(), &[]).await.unwrap());
        a.write(id(3));
        let later = a.commit(&key).unwrap();
        assert!(!store.admit((*later).clone(), &[]).await.unwrap(), "a signature alone is not consistency");
        assert!(store.admit((*later).clone(), &a.prefix(2).unwrap()).await.unwrap());
        let mut clone = SignerLog::wrap(signer, [id(1), id(9), id(3)]);
        let forked = clone.commit(&key).unwrap();
        assert!(!store.admit((*forked).clone(), &[]).await.unwrap());
        assert!(store.fork(signer).await.is_some());
        drop(store);
        let store = Signers::open(shelf, signer, &mut lab).await.unwrap().unwrap();
        assert!(store.fork(signer).await.is_some());
        assert!(!store.check(signer, id(1), &a.proof(id(1)).unwrap()).await);
        assert!(key.sign(id(1)).pq.len() > 0, "legacy signatures remain available");
    }

    #[tokio::test]
    async fn unsupported_shelf_does_not_enroll_or_enable_capture() {
        let (shelf, mut calls) = Shelf::new();
        let (mut lab, signer, _) = device();
        assert!(Signers::open(shelf, signer, &mut lab).await.unwrap().is_none());
        assert!(calls.try_recv().is_err());
        assert!(!lab.signing_pending(signer));
    }
    #[tokio::test]
    async fn own_publication_is_an_anchor_and_clone_fork_stays_disabled_after_restart() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, key) = device();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        store.append(&[id(1), id(2)]).await.unwrap();
        let own = SignedRoot::sign(&key, store.book().log.durable_root().unwrap());
        store.publish(own).await.unwrap();
        let mut clone = SignerLog::wrap(signer, [id(1), id(9)]);
        let conflicting = clone.commit(&key).unwrap();
        assert!(!store.admit((*conflicting).clone(), &[]).await.unwrap());
        assert!(store.fork(signer).await.is_some());
        assert!(store.proof(id(1)).is_none());
        assert!(store.shelf.get(&format!("{}disabled", store.prefix)).await.unwrap().is_some());
        drop(store);
        let store = Signers::open(shelf, signer, &mut lab).await.unwrap().unwrap();
        assert!(store.fork(signer).await.is_some() && store.proof(id(1)).is_none() && !store.root_due());
    }

    #[tokio::test]
    async fn repeated_semantic_roots_and_forks_do_not_grow_remote_storage() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, _) = device();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        let other = DeviceKey::from_secret([201; 32]);
        let mut log = SignerLog::wrap(other.id(), [id(1), id(2)]);
        let first = log.commit(&other).unwrap();
        for _ in 0..4 {
            let signed = SignedRoot::sign(&other, first.root);
            assert!(store.admit(signed, &[]).await.unwrap());
        }
        assert_eq!(shelf.names("batch-roots/").await.unwrap().len(), 1);
        log.write(id(3));
        let last = log.commit(&other).unwrap();
        assert!(store.admit((*last).clone(), &log.prefix(2).unwrap()).await.unwrap());
        assert!(store.admit((*first).clone(), &log.prefix(2).unwrap()).await.unwrap());
        assert_eq!(shelf.names("batch-roots/").await.unwrap().len(), 2);
        let mut clone = SignerLog::wrap(other.id(), [id(1), id(9), id(3)]);
        let forked = clone.commit(&other).unwrap();
        assert!(!store.admit((*forked).clone(), &[]).await.unwrap());
        let fork = store.fork(other.id()).await.unwrap();
        for _ in 0..4 {
            store.freeze(fork.clone()).await.unwrap();
        }
        assert_eq!(shelf.names("batch-forks/").await.unwrap().len(), 1);
        store.admission_count.store(MAX_ADMISSIONS, Ordering::Relaxed);
        let newer = DeviceKey::from_secret([202; 32]);
        let mut log = SignerLog::wrap(newer.id(), [id(1)]);
        let root = log.commit(&newer).unwrap();
        assert!(!store.admit((*root).clone(), &[]).await.unwrap());
        assert_eq!(shelf.names("batch-roots/").await.unwrap().len(), 2);
    }
    #[tokio::test]
    async fn tampered_unpublished_tail_cannot_be_promoted_even_with_a_recomputed_checksum() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, _) = device();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        store.append(&[id(1)]).await.unwrap();
        let name = format!("{}segments/0000000000000001", store.prefix);
        let mut bytes = shelf.get(&name).await.unwrap().unwrap().to_vec();
        let at = bytes.len() - 64 - 32;
        bytes[at..at + 32].copy_from_slice(&id(99).0);
        bytes.truncate(bytes.len() - 32);
        let forged = seal(bytes);
        std::fs::write(folder.0.join(format!("g{}/{}", crate::shelf::FLOOR, name)), forged).unwrap();
        drop(store);
        assert!(Signers::open(shelf, signer, &mut lab).await.is_err());
    }

    #[tokio::test]
    async fn forged_enrollment_segment_cannot_authorize_a_first_root() {
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let (mut lab, signer, _) = device();
        let prefix = format!("signers/{}/", signer.to_hex());
        let mut forged = SEGMENT.to_vec();
        forged.extend_from_slice(&signer.0);
        forged.extend_from_slice(&0u64.to_be_bytes());
        forged.extend_from_slice(&[0; 32]);
        forged.extend_from_slice(&0u64.to_be_bytes());
        forged.extend_from_slice(&1u32.to_be_bytes());
        forged.extend_from_slice(&id(99).0);
        forged.extend_from_slice(&[0; 32]);
        let forged = seal(forged);
        shelf.put(&format!("{prefix}segments/0000000000000000"), forged.clone()).await.unwrap();
        let mut enrollment = ENROLLED.to_vec();
        enrollment.extend_from_slice(&signer.0);
        enrollment.extend_from_slice(blake3::hash(&forged).as_bytes());
        shelf.put(&format!("{prefix}enrolled"), seal(enrollment)).await.unwrap();
        assert!(Signers::open(shelf, signer, &mut lab).await.is_err());
    }
    /// Isolates one-time enrollment from fixture construction and whole-store restore.
    /// Run in the app profile: the production path must not rely on debug batch logs.
    #[tokio::test]
    #[ignore = "disposable same-identity enrollment benchmark; run with --profile app --ignored --nocapture"]
    async fn same_identity_enrollment_benchmark() {
        use avendb::cast::{document, human_on};
        let edits = std::env::var("AVENDB_ENROLLMENT_EDITS").ok().and_then(|n| n.parse::<usize>().ok()).unwrap_or(1000);
        assert!((1..=20_000).contains(&edits));
        let folder = Folder::new();
        let writer = disk::open(&folder.0).unwrap().writer().unwrap();
        let shelf = writer.shelf();
        let mut lab = Lab::new();
        let passkey = lab.passkey("Enrollment benchmark");
        let signer = lab.device_with("Same device", [203; 32]);
        let vault = human_on(&mut lab, passkey, &[signer]);
        let entry = lab.create(signer, vault, vault, "note", &[], document("Note", "Before.", signer)).unwrap();
        for i in 0..edits {
            lab.edit(signer, vault, entry, |item| item.set_text(2, &format!("Revision {i}"))).unwrap();
        }
        let backup = lab.backup(signer);
        let wire_bytes: usize = backup.signed().iter().map(|s| s.to_wire().len()).sum();
        let began = std::time::Instant::now();
        let store = Signers::open(shelf.clone(), signer, &mut lab).await.unwrap().unwrap();
        let enrolled = store.book().log.tree().len();
        let root = store.book().log.durable_root().unwrap();
        store.publish(lab.sign_persisted_root(root).unwrap()).await.unwrap();
        let enroll_seconds = began.elapsed().as_secs_f64();
        drop(store);
        // Restore the same device's data without resetting its keys, then open its
        // authenticated signer ledger again. This measures the ledger, not restore.
        lab.restore_from(signer, backup);
        let began = std::time::Instant::now();
        let resumed = Signers::open(shelf, signer, &mut lab).await.unwrap().unwrap();
        let resume_seconds = began.elapsed().as_secs_f64();
        assert_eq!(resumed.book().log.tree().len(), enrolled);
        println!(
            "same_identity_enrollment writes={edits} enrolled={enrolled} wire_bytes={wire_bytes} enrollment_s={enroll_seconds:.6} authenticated_resume_s={resume_seconds:.6} debug={}",
            cfg!(debug_assertions)
        );
    }
}
