//! A Doc as a peer holds it (docs README, "A Doc", "Importing"; `Aven.Peer.DocSync`): the docs layer's [`Doc`], kept on
//! the peer's [`Shelf`] and synced with the Doc's other readers. Natively it runs in the peer's process: the judge
//! catches Loro's panics on its scratch copy (`panic = "unwind"`). In the browser it runs in the docs worker, and the
//! keys stay in the Peer-Light's own worker: [`Host::prepare`] and [`Host::finish`] take the device's signature from
//! outside.
//!
//! - **Open:** the Doc's genesis and its schemas come from the caller (the pinned genesis, never the network); what
//!   the shelf holds is imported back, in the order held, and the envelopes the docs worker found to crash the judge
//!   are marked unfit first.
//! - **Commit:** prepare, the device's signature, finish; then the envelope's bytes go on the shelf, the held page and
//!   the head move, and the envelope is sealed under the newest epoch for gossip ([`Live::of`]).
//! - **Take:** a sealed envelope or segment from gossip or a fetch is opened under the epoch its outside names and
//!   imported; whatever it made held goes on the shelf.
//! - **Sync:** its [`tips`], its [`version`], and its answer to another reader's tips: the sealed values beyond them
//!   (`doc_have`), sealed on the shelf so the fetch gate can serve them. What crashed the judge is never served.

use std::collections::{BTreeMap, BTreeSet};

use aven_core::{Envelope, Hash};
use aven_db_docs::seal::{self, Kind};
use aven_db_docs::{
    Act, Authorize, Doc, EpochKey, Genesis, Imported, Limits, Prepared, RecordWrite, Snapshot,
    schema::Schema,
};
use aven_db_docs::{SealedItem, Unopened};
use aven_id::Entropy;

use crate::docs::{Entry, Live, Saved, Shelf, Tip, beyond, tips, version};

/// What a sealed thing taken in did.
#[derive(Debug, PartialEq, Eq)]
pub enum Taken {
    /// Opened and imported: each of its envelopes' results.
    Imported(Vec<Result<Imported, aven_db_docs::Refused>>),
    /// It didn't open: another Doc, an epoch this peer holds no key for, a bad seal or segment.
    Unopened(Unopened),
}

/// A Doc as one peer holds it.
pub struct Host<A: Authorize> {
    shelf: Shelf,
    doc: Doc,
    saved: Saved,
    /// The Doc's epochs this peer holds, the newest last: what it writes under, and what it opens with.
    epochs: Vec<EpochKey>,
    auth: A,
    /// Envelopes whose bytes are on the shelf, by name.
    shelved: BTreeSet<Hash>,
    /// Each envelope's sealed bytes on the shelf, by its name, as written, heard or sealed for an answer.
    sealed: BTreeMap<Hash, Hash>,
    /// What crashed the judge alone: never counted, forwarded or served (the docs worker's, kept by the caller).
    unfit: BTreeSet<Hash>,
}

fn store_hash(h: &Hash) -> aven_db_store::Hash {
    let hex: String = h.0.iter().map(|b| format!("{b:02x}")).collect();
    hex.parse().expect("32 bytes in hex are a store hash")
}

fn core_hash(h: &aven_db_store::Hash) -> Hash {
    Hash(*h.as_bytes())
}

impl<A: Authorize> Host<A> {
    /// Opens a Doc from its genesis, reading back what the shelf holds of it.
    #[allow(clippy::too_many_arguments)]
    pub async fn open(
        shelf: Shelf,
        genesis: Genesis,
        schemas: &[Schema],
        limits: Limits,
        epochs: Vec<EpochKey>,
        auth: A,
        unfit: BTreeSet<Hash>,
    ) -> Result<Host<A>, String> {
        let mut doc = Doc::open(genesis, schemas, limits)
            .ok_or("a genesis this peer can't open: its type or pins")?;
        for name in &unfit {
            doc.mark_unfit(*name);
        }
        let shelved = shelf.load(&doc.id()).await?;
        let mut held_names = BTreeSet::new();
        if let Some(v) = &shelved.held {
            let page =
                aven_db_docs::HeldPage::of_value(v).ok_or("the held page doesn't read back")?;
            if page.doc != doc.id() {
                return Err("the held page is another Doc's".into());
            }
            let mut blobs = Vec::with_capacity(page.envelopes.len());
            for (name, h) in &page.envelopes {
                let bytes = shelf
                    .get(&store_hash(h))
                    .await?
                    .ok_or("the held page names an envelope the shelf lacks")?;
                blobs.push(bytes);
                held_names.insert(*name);
            }
            let page: Vec<&[u8]> = blobs.iter().map(Vec::as_slice).collect();
            doc.import_page(&page, &auth);
        }
        Ok(Host {
            shelf,
            doc,
            saved: shelved.saved,
            epochs,
            auth,
            shelved: held_names,
            sealed: BTreeMap::new(),
            unfit,
        })
    }

    pub fn doc(&self) -> &Doc {
        &self.doc
    }

    pub fn snapshot(&self) -> std::sync::Arc<Snapshot> {
        self.doc.snapshot()
    }

    /// A commit up to its signature: what the device signs is [`Prepared::signing`].
    pub fn prepare(
        &self,
        signer: [u8; 32],
        generation: u64,
        batch: &[RecordWrite],
        at: &str,
        act: Act,
    ) -> Result<Prepared, String> {
        self.doc
            .prepare(signer, generation, batch, at, act)
            .map_err(|e| format!("{e:?}"))
    }

    /// Finishes a commit with the device's signature: it counts here, goes on the shelf, and is sealed under the newest
    /// epoch. Returns what to gossip.
    pub async fn finish(
        &mut self,
        prepared: Prepared,
        sig: [u8; 64],
        entropy: &mut impl Entropy,
    ) -> Result<Live, String> {
        let bytes = self
            .doc
            .finish(prepared, sig, &self.auth)
            .map_err(|e| format!("{e:?}"))?;
        self.keep().await?;
        let e = Envelope::decode(&bytes).ok_or("a commit that doesn't decode")?;
        let name = e.name();
        let sealed = self.seal(&bytes, entropy)?;
        let at = self.shelf.put(sealed.clone()).await?;
        self.sealed.insert(name, core_hash(&at));
        Ok(Live::of(self.doc.id().0, &sealed))
    }

    /// Commits with a device key this peer holds: [`Host::prepare`], its Ed25519 signature, [`Host::finish`].
    pub async fn commit(
        &mut self,
        device: &iroh::SecretKey,
        generation: u64,
        batch: &[RecordWrite],
        at: &str,
        act: Act,
        entropy: &mut impl Entropy,
    ) -> Result<Live, String> {
        let p = self.prepare(*device.public().as_bytes(), generation, batch, at, act)?;
        let sig = device.sign(&p.signing()).to_bytes();
        self.finish(p, sig, entropy).await
    }

    fn seal(&self, plaintext: &[u8], entropy: &mut impl Entropy) -> Result<Vec<u8>, String> {
        let epoch = self.epochs.last().ok_or("no epoch key to write under")?;
        Ok(seal::seal(
            Kind::Envelope,
            epoch,
            &self.doc.id(),
            plaintext,
            entropy,
        ))
    }

    /// Takes in sealed things, loose envelopes and segments, as one page: each opened under the epoch its outside
    /// names, then imported in one batch. What became held goes on the shelf.
    pub async fn take(&mut self, items: &[(bool, Vec<u8>)]) -> Result<Vec<Taken>, String> {
        let page: Vec<SealedItem<'_>> = items
            .iter()
            .map(|(segment, b)| {
                if *segment {
                    SealedItem::Segment(b)
                } else {
                    SealedItem::Loose(b)
                }
            })
            .collect();
        let epochs = &self.epochs;
        let results = self.doc.import_sealed_page(
            &page,
            |h| epochs.iter().find(|e| e.name == *h),
            &self.auth,
        );
        self.keep().await?;
        Ok(results
            .into_iter()
            .map(|r| match r {
                Ok(rs) => Taken::Imported(rs),
                Err(u) => Taken::Unopened(u),
            })
            .collect())
    }

    /// Puts every newly held envelope's bytes on the shelf, then moves the held page and the head.
    async fn keep(&mut self) -> Result<(), String> {
        let fresh: Vec<(Hash, Vec<u8>)> = self
            .doc
            .held()
            .filter(|(name, _)| !self.shelved.contains(name))
            .map(|(name, e)| (name, e.encode()))
            .collect();
        if fresh.is_empty() {
            return Ok(());
        }
        for (name, bytes) in fresh {
            self.shelf.put(bytes).await?;
            self.shelved.insert(name);
        }
        let held = self.doc.held_page().value();
        let head = self.doc.head().value();
        self.shelf
            .save(&self.doc.id(), &mut self.saved, &held, &head)
            .await
    }

    /// What sync reads of each envelope held, but never one that crashed the judge.
    pub fn entries(&self) -> Vec<Entry> {
        self.doc
            .held()
            .filter(|(name, _)| !self.unfit.contains(name))
            .map(|(name, e)| Entry {
                name,
                writer: e.writer,
                seq: e.seq,
                prev: e.prev,
                deps: e.deps.clone(),
            })
            .collect()
    }

    /// This reader's tips: the head of each of its logs.
    pub fn tips(&self) -> Vec<Tip> {
        tips(&self.entries())
    }

    /// This reader's version, as its group's topic announces it.
    pub fn version(&self) -> Hash {
        version(&self.tips())
    }

    /// The answer to another reader's tips (`doc_have`): the hashes of the sealed values beyond them, each sealed on
    /// the shelf under the newest epoch if it isn't yet, so the fetch gate can serve it.
    pub async fn answer(
        &mut self,
        their: &[Tip],
        entropy: &mut impl Entropy,
    ) -> Result<Vec<Hash>, String> {
        let entries = self.entries();
        let names: Vec<Hash> = beyond(&entries, their).iter().map(|e| e.name).collect();
        let bytes: BTreeMap<Hash, Vec<u8>> = self
            .doc
            .held()
            .filter(|(n, _)| names.contains(n) && !self.sealed.contains_key(n))
            .map(|(n, e)| (n, e.encode()))
            .collect();
        for (name, plaintext) in bytes {
            let sealed = self.seal(&plaintext, entropy)?;
            let at = self.shelf.put(sealed).await?;
            self.sealed.insert(name, core_hash(&at));
        }
        Ok(names.iter().map(|n| self.sealed[n]).collect())
    }

    /// The sealed bytes on the shelf under `hash`, for the fetch gate.
    pub async fn sealed(&self, hash: &Hash) -> Result<Option<Vec<u8>>, String> {
        self.shelf.get(&store_hash(hash)).await
    }

    /// Marks an envelope unfit because the judge crashed on it alone: it never counts, and is never served.
    pub fn mark_unfit(&mut self, name: Hash) {
        self.unfit.insert(name);
        self.doc.mark_unfit(name);
    }
}
