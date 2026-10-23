//! Durable local paged projections. This module is deliberately not on Node's
//! startup path: complete Lab dependencies and tail continuation remain gates.
//! Immutable encrypted objects and generation receipts precede either head slot.
use std::collections::{BTreeMap, BTreeSet};

use anyhow::{Result, anyhow, ensure};
use avendb::hash;
use avendb::id::{EntryId, SignerId, VaultId};
use avendb::keys::{self, Secret, SeededRng};
use avendb::paged_view::{
    Binding, Descriptor, Draft, Header, MAX_DRAFT_BYTES, MAX_HEADER_BYTES, MAX_PAGE_BYTES, PageId, PageRead,
};
use bytes::Bytes;
use tokio::sync::Mutex;
use zeroize::Zeroizing;

use crate::shelf::Shelf;

const RECEIPT: &[u8] = b"avenDB paged view receipt 1\n";
const ENCRYPTION_OVERHEAD: usize = 72;
const RECEIPT_BYTES: usize = RECEIPT.len() + 40 + ENCRYPTION_OVERHEAD;

/// One owner per device/vault. Concurrent instances cannot replace a generation:
/// its create-only receipt conflicts before a head slot changes. Unsupported
/// backends keep VIEW2; no unverified overwrite backend is activated here.
pub struct PagedViews {
    shelf: Shelf,
    key: Secret,
    device: SignerId,
    vault: VaultId,
    namespace: String,
    writer: Mutex<()>,
}
impl PagedViews {
    pub fn new(shelf: Shelf, key: Secret, device: SignerId, vault: VaultId) -> Result<Self> {
        ensure!(shelf.atomic_put(), "paged publication requires atomic create-only objects");
        ensure!(shelf.bounded_reads(), "paged publication requires bounded named-object reads");
        let namespace = format!("paged-views/{}/{}/", device.to_hex(), vault.to_hex());
        let key = key.child("paged local view shelf 1", namespace.as_bytes());
        Ok(Self { shelf, key, device, vault, namespace, writer: Mutex::new(()) })
    }
    fn aad(&self) -> Vec<u8> {
        let mut out = b"avenDB paged view local identity 1\n".to_vec();
        out.extend_from_slice(self.namespace.as_bytes());
        out.extend_from_slice(&avendb::paged_view::engine());
        out
    }
    fn object(&self, hash: [u8; 32]) -> String {
        format!("{}objects/{}", self.namespace, data_encoding::HEXLOWER.encode(&hash))
    }
    fn receipt(&self, generation: u64) -> String {
        format!("{}heads/{generation:016x}", self.namespace)
    }
    fn slot(&self, generation: u64) -> String {
        format!("slots/{}{}", self.namespace, generation % 2)
    }
    fn rng() -> Result<SeededRng> {
        let mut seed = Zeroizing::new([0; 32]);
        getrandom::fill(seed.as_mut()).map_err(|e| anyhow!("paged view randomness: {e}"))?;
        Ok(SeededRng::new("paged view nonces 1", seed.as_ref()))
    }
    fn check_binding(&self, binding: &Binding) -> Result<()> {
        ensure!(binding.device == self.device && binding.vault == self.vault, "paged view identity mismatch");
        ensure!(binding.engine == avendb::paged_view::engine(), "paged view engine mismatch");
        Ok(())
    }
    /// A failed pointer write can be retried with the same draft. Reuse its exact
    /// authenticated generation receipt instead of introducing a fresh nonce fork.
    pub async fn publish(&self, draft: &Draft) -> Result<Header> {
        let _guard = self.writer.lock().await;
        self.check_binding(&draft.binding)?;
        if let Some(latest) = self.latest().await? {
            ensure!(latest.binding.generation <= draft.binding.generation, "stale paged publication");
        }
        let mut total = 0usize;
        let mut descriptors = BTreeMap::new();
        for (&id, p) in &draft.pages {
            total = total.checked_add(p.bytes.len()).ok_or_else(|| anyhow!("oversized paged view"))?;
            ensure!(p.bytes.len() <= MAX_PAGE_BYTES && total <= MAX_DRAFT_BYTES, "oversized paged view");
            descriptors.insert(
                id,
                Descriptor {
                    object: [0; 32],
                    content: hash::content(&p.bytes),
                    bytes: p.bytes.len() as u32,
                    dependencies: p.dependencies.clone(),
                },
            );
        }
        let mut header = Header { binding: draft.binding.clone(), pages: descriptors };
        header.validate()?;
        if let Some(receipt) = self.shelf.get_bounded(&self.receipt(draft.binding.generation), RECEIPT_BYTES).await? {
            let existing = self.open_receipt(&receipt).await?;
            ensure!(
                existing.binding == header.binding && existing.pages.len() == header.pages.len(),
                "paged generation conflict"
            );
            for (id, wanted) in &header.pages {
                let old = existing.pages.get(id).ok_or_else(|| anyhow!("paged generation conflict"))?;
                ensure!(
                    old.content == wanted.content
                        && old.bytes == wanted.bytes
                        && old.dependencies == wanted.dependencies,
                    "paged generation conflict"
                );
                self.open_page(&existing, *id).await?.ok_or_else(|| anyhow!("missing published page"))?;
            }
            self.shelf.keep(&self.slot(existing.binding.generation), receipt).await?;
            return Ok(existing);
        }
        let mut rng = Self::rng()?;
        let key = self.key.child("page encryption 1", b"");
        for (&id, p) in &draft.pages {
            let descriptor = header.pages.get_mut(&id).expect("draft descriptor");
            let encrypted = keys::encrypt(&key, &p.bytes, &descriptor.aad(&draft.binding, id), &mut rng);
            descriptor.object = hash::content(&encrypted);
            self.shelf.put(&self.object(descriptor.object), Bytes::from(encrypted)).await?;
        }
        let encoded = Zeroizing::new(header.to_bytes()?);
        let bytes = keys::encrypt(&self.key.child("header encryption 1", b""), &encoded, &self.aad(), &mut rng);
        let object = hash::content(&bytes);
        self.shelf.put(&self.object(object), bytes.into()).await?;
        let mut plain = RECEIPT.to_vec();
        plain.extend(draft.binding.generation.to_be_bytes());
        plain.extend(object);
        let receipt =
            Bytes::from(keys::encrypt(&self.key.child("receipt encryption 1", b""), &plain, &self.aad(), &mut rng));
        self.shelf.put(&self.receipt(draft.binding.generation), receipt.clone()).await?;
        self.shelf.keep(&self.slot(draft.binding.generation), receipt).await?;
        Ok(header)
    }
    async fn open_receipt(&self, bytes: &[u8]) -> Result<Header> {
        ensure!(bytes.len() == RECEIPT.len() + 40 + ENCRYPTION_OVERHEAD, "bad paged receipt size");
        let plain = keys::decrypt(&self.key.child("receipt encryption 1", b""), bytes, &self.aad())
            .ok_or_else(|| anyhow!("unauthenticated paged receipt"))?;
        ensure!(plain.starts_with(RECEIPT), "bad paged receipt version");
        let generation = u64::from_be_bytes(plain[RECEIPT.len()..RECEIPT.len() + 8].try_into()?);
        let object: [u8; 32] = plain[RECEIPT.len() + 8..].try_into()?;
        let encrypted = self
            .shelf
            .get_bounded(&self.object(object), MAX_HEADER_BYTES + ENCRYPTION_OVERHEAD)
            .await?
            .ok_or_else(|| anyhow!("missing paged header"))?;
        ensure!(
            encrypted.len() <= MAX_HEADER_BYTES + ENCRYPTION_OVERHEAD && hash::content(&encrypted) == object,
            "corrupt paged header"
        );
        let plain = Zeroizing::new(
            keys::decrypt(&self.key.child("header encryption 1", b""), &encrypted, &self.aad())
                .ok_or_else(|| anyhow!("unauthenticated paged header"))?,
        );
        let header = Header::from_bytes(&plain)?;
        ensure!(header.binding.generation == generation, "paged receipt generation mismatch");
        self.check_binding(&header.binding)?;
        Ok(header)
    }
    /// Two independently authenticated slots; a torn or foreign newest slot cannot
    /// make an older valid view disappear. Header acceptance is not data readiness.
    pub async fn latest(&self) -> Result<Option<Header>> {
        let mut best: Option<Header> = None;
        for slot in 0..2 {
            let bytes = match self.shelf.get_bounded(&self.slot(slot), RECEIPT_BYTES).await {
                Ok(bytes) => bytes,
                Err(e) if e.kind() == std::io::ErrorKind::InvalidData => None,
                Err(e) => return Err(e.into()),
            };
            if let Some(bytes) = bytes {
                if let Ok(header) = self.open_receipt(&bytes).await {
                    if best.as_ref().is_none_or(|old| old.binding.generation < header.binding.generation) {
                        best = Some(header);
                    }
                }
            }
        }
        Ok(best)
    }
    async fn open_page(&self, header: &Header, id: PageId) -> Result<Option<Vec<u8>>> {
        let Some(d) = header.pages.get(&id) else { return Ok(None) };
        let Some(bytes) =
            self.shelf.get_bounded(&self.object(d.object), d.bytes as usize + ENCRYPTION_OVERHEAD).await?
        else {
            return Ok(None);
        };
        ensure!(
            bytes.len() == d.bytes as usize + ENCRYPTION_OVERHEAD && hash::content(&bytes) == d.object,
            "corrupt paged object"
        );
        let plain = keys::decrypt(&self.key.child("page encryption 1", b""), &bytes, &d.aad(&header.binding, id))
            .ok_or_else(|| anyhow!("unauthenticated paged object"))?;
        ensure!(plain.len() == d.bytes as usize && hash::content(&plain) == d.content, "paged content mismatch");
        Ok(Some(plain))
    }
    /// Demand-load exactly the declared transitive closure. This API returns no
    /// mutable State and cannot bypass the current full restore or legacy validation.
    pub async fn read(&self, header: &Header, current: &Binding, requested: &BTreeSet<EntryId>) -> Result<PageRead> {
        if &header.binding != current {
            return Ok(PageRead::Stale);
        }
        self.check_binding(current)?;
        let mut loaded = BTreeMap::new();
        let mut bytes = 0usize;
        for id in header.closure(requested)? {
            if let Some(page) = self.open_page(header, id).await? {
                bytes = bytes.checked_add(page.len()).ok_or_else(|| anyhow!("oversized page demand"))?;
                ensure!(bytes <= MAX_DRAFT_BYTES, "oversized page demand");
                loaded.insert(id, page);
            }
        }
        Ok(header.read(current, requested, &loaded)?)
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests {
    use super::*;
    use crate::shelf::Call;
    use avendb::cast::{document, human_on};
    use avendb::lab::Lab;
    use avendb::paged_view::Globals;
    use std::io;
    use std::sync::{Arc, Mutex as StdMutex};

    #[derive(Default)]
    struct Memory {
        objects: BTreeMap<String, Bytes>,
        writes: usize,
        fail_at: Option<usize>,
        reads: Vec<String>,
    }
    fn shelf() -> (Shelf, Arc<StdMutex<Memory>>) {
        let (shelf, mut rx) = Shelf::new();
        let memory = Arc::new(StdMutex::new(Memory::default()));
        let state = memory.clone();
        tokio::spawn(async move {
            while let Some(call) = rx.recv().await {
                let mut m = state.lock().unwrap();
                match call {
                    Call::Put { name, bytes, tx } => {
                        m.writes += 1;
                        let result = if m.fail_at == Some(m.writes) {
                            Err(io::Error::other("crash before put"))
                        } else if m.objects.get(&name).is_some_and(|old| old != &bytes) {
                            Err(io::ErrorKind::AlreadyExists.into())
                        } else {
                            m.objects.insert(name, bytes);
                            Ok(())
                        };
                        let _ = tx.send(result);
                    }
                    Call::Keep { name, bytes, tx } => {
                        m.writes += 1;
                        let result = if m.fail_at == Some(m.writes) {
                            m.objects.insert(name, bytes.slice(..bytes.len() / 2));
                            Err(io::Error::other("torn pointer"))
                        } else {
                            m.objects.insert(name, bytes);
                            Ok(())
                        };
                        let _ = tx.send(result);
                    }
                    Call::Get { name, tx } => {
                        m.reads.push(name.clone());
                        let _ = tx.send(Ok(m.objects.get(&name).cloned()));
                    }
                    Call::Names { prefix, tx } => {
                        let _ = tx.send(Ok(m.objects.keys().filter(|n| n.starts_with(&prefix)).cloned().collect()));
                    }
                    _ => panic!("not a paged named-object operation"),
                }
            }
        });
        let reader = memory.clone();
        let shelf = shelf.with_atomic_put().with_bounded_get(move |name, limit| {
            let reader = reader.clone();
            async move {
                let mut m = reader.lock().unwrap();
                m.reads.push(name.clone());
                match m.objects.get(&name) {
                    Some(bytes) if bytes.len() > limit => {
                        Err(io::Error::new(io::ErrorKind::InvalidData, "oversized test object"))
                    }
                    bytes => Ok(bytes.cloned()),
                }
            }
        });
        (shelf, memory)
    }
    fn fixture() -> (Lab, SignerId, VaultId, Vec<EntryId>) {
        let mut lab = Lab::new();
        let pass = lab.passkey("Pages");
        let mac = lab.device_of(pass, "Mac");
        let vault = human_on(&mut lab, pass, &[mac]);
        let entries = (0..3)
            .map(|i| lab.create(mac, vault, vault, "note", &[], document(&format!("{i}"), "text", mac)).unwrap())
            .collect();
        (lab, mac, vault, entries)
    }
    fn draft(lab: &Lab, mac: SignerId, vault: VaultId, entries: &[EntryId], generation: u64) -> Draft {
        let globals = Globals {
            kernel: b"private complete kernel".to_vec(),
            schema: b"private complete schema".to_vec(),
            key_epoch: b"private opening epoch".to_vec(),
        };
        let binding = Binding::new(mac, vault, lab.log(mac).ids(), &globals, generation);
        let deps = BTreeMap::from([(PageId::Entry(entries[0]), BTreeSet::from([PageId::Entry(entries[1])]))]);
        Draft::capture(binding, lab.state(mac), globals, &entries.iter().copied().collect(), &deps).unwrap()
    }
    fn store(shelf: Shelf, mac: SignerId, vault: VaultId) -> PagedViews {
        PagedViews::new(shelf, Secret::from_bytes([21; 32]), mac, vault).unwrap()
    }
    #[tokio::test]
    async fn encrypted_restart_reads_only_the_requested_closure_and_matches_full_replay() {
        let (lab, mac, vault, entries) = fixture();
        let (shelf, memory) = shelf();
        let storage = store(shelf.clone(), mac, vault);
        let draft = draft(&lab, mac, vault, &entries, 1);
        let published = storage.publish(&draft).await.unwrap();
        drop(storage);
        let storage = store(shelf, mac, vault);
        let header = storage.latest().await.unwrap().unwrap();
        assert_eq!(header, published);
        memory.lock().unwrap().reads.clear();
        let read = storage.read(&header, &draft.binding, &BTreeSet::from([entries[0]])).await.unwrap();
        assert_eq!(
            read,
            PageRead::Ready {
                binding: draft.binding.clone(),
                entries: BTreeMap::from([(entries[0], lab.state(mac).slice_of(entries[0]))])
            }
        );
        let m = memory.lock().unwrap();
        assert_eq!(m.reads.len(), 5);
        assert!(!m.reads.contains(&storage.object(header.pages[&PageId::Entry(entries[2])].object)));
        assert!(m.objects.values().all(|b| !b.windows(16).any(|w| w == b"private complete")));
    }
    #[tokio::test]
    async fn every_crash_boundary_preserves_old_head_and_retry_completes_publication() {
        let (lab, mac, vault, entries) = fixture();
        let first = draft(&lab, mac, vault, &entries, 1);
        let next = draft(&lab, mac, vault, &entries, 2);
        // Six pages, header, immutable generation receipt, then the head pointer.
        for boundary in 1..=next.pages.len() + 3 {
            let (shelf, memory) = shelf();
            let storage = store(shelf.clone(), mac, vault);
            storage.publish(&first).await.unwrap();
            let old_objects = memory.lock().unwrap().objects.clone();
            {
                let mut m = memory.lock().unwrap();
                m.fail_at = Some(m.writes + boundary);
            }
            assert!(storage.publish(&next).await.is_err(), "boundary {boundary}");
            drop(storage);
            let storage = store(shelf, mac, vault);
            assert_eq!(storage.latest().await.unwrap().unwrap().binding.generation, 1, "boundary {boundary}");
            {
                let mut m = memory.lock().unwrap();
                m.fail_at = None;
                for (name, bytes) in &old_objects {
                    assert_eq!(m.objects.get(name), Some(bytes));
                }
            }
            let recovered = storage.publish(&next).await.unwrap();
            assert_eq!(recovered.binding.generation, 2);
            assert_eq!(storage.latest().await.unwrap(), Some(recovered));
            assert!(storage.publish(&first).await.is_err(), "a delayed older snapshot cannot replace the newer head");
        }
    }
    #[tokio::test]
    async fn torn_foreign_and_missing_objects_never_become_ready() {
        let (lab, mac, vault, entries) = fixture();
        let (shelf, memory) = shelf();
        let storage = store(shelf.clone(), mac, vault);
        let first = draft(&lab, mac, vault, &entries, 1);
        storage.publish(&first).await.unwrap();
        let second = draft(&lab, mac, vault, &entries, 2);
        let header = storage.publish(&second).await.unwrap();
        let request = BTreeSet::from([entries[0]]);
        let foreign = PagedViews::new(shelf.clone(), Secret::from_bytes([22; 32]), mac, vault).unwrap();
        assert!(foreign.latest().await.unwrap().is_none());
        assert!(foreign.read(&header, &second.binding, &request).await.is_err());
        let missing = storage.object(header.pages[&PageId::Entry(entries[1])].object);
        let bytes = memory.lock().unwrap().objects.remove(&missing).unwrap();
        assert_eq!(
            storage.read(&header, &second.binding, &request).await.unwrap(),
            PageRead::Missing(BTreeSet::from([PageId::Entry(entries[1])]))
        );
        {
            let mut m = memory.lock().unwrap();
            let mut corrupted = bytes.to_vec();
            corrupted[0] ^= 1;
            m.objects.insert(missing, corrupted.into());
        }
        assert!(storage.read(&header, &second.binding, &request).await.is_err());
        let mut current = second.binding.clone();
        current.opened_epoch[0] ^= 1;
        assert_eq!(storage.read(&header, &current, &request).await.unwrap(), PageRead::Stale);
        memory.lock().unwrap().objects.insert(storage.slot(2), Bytes::from_static(b"torn"));
        assert_eq!(storage.latest().await.unwrap().unwrap().binding.generation, 1);
    }
    #[tokio::test]
    async fn conflicting_generation_and_unverified_backend_cannot_publish() {
        let (lab, mac, vault, entries) = fixture();
        let (shelf, _memory) = shelf();
        let storage = store(shelf, mac, vault);
        let first = draft(&lab, mac, vault, &entries, 1);
        storage.publish(&first).await.unwrap();
        let mut other = draft(&lab, mac, vault, &entries, 1);
        other.binding.frontier[0] ^= 1;
        assert!(storage.publish(&other).await.is_err());
        assert_eq!(storage.latest().await.unwrap().unwrap().binding, first.binding);
        let (unsupported, _rx) = Shelf::new();
        assert!(PagedViews::new(unsupported, Secret::from_bytes([21; 32]), mac, vault).is_err());
    }
}
