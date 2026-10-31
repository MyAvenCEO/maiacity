//! A Doc as a peer holds it (brain/peers, "The Doc host"; `Aven.Peer.DocSync`): avenDOCS's [`Doc`] on avenDOCS'
//! [`Shelf`], synced with the Doc's other readers. It comes in two halves, so that in the browser Loro and the keys never
//! share a worker:
//!
//! - **[`Host`]**, the docs worker's half: the Doc, its shelf, commits up to and after the device's signature
//!   ([`Host::prepare`], [`Host::finish`]), plaintext envelopes taken in ([`Host::take`]), and what sync reads of it
//!   (its [`tips`], its [`version`], what lies [`beyond`] another reader's tips). It holds no key. Natively it runs in
//!   the peer's process, and the judge catches Loro's panics on its scratch copy (`panic = "unwind"`).
//! - **[`Sealer`]**, the keys' half, beside the device key in the Peer-Light's worker: the Doc's epoch keys, which open
//!   what arrives ([`aven_db_docs::open_page`]) and seal what leaves the device, under the newest epoch. The keyring
//!   Doc alone travels plain (A187): its items are its plain bytes, and a change to it is announced on its group's
//!   topic as its version and fetched, never sent whole (A195).
//! - **[`Reader`]** joins the two in one process, as the Peer runs them.
//!
//! Open: the Doc's genesis and its type Docs come from the caller (the pinned genesis, never the network); what the
//! shelf holds is imported back in the order held, and what crashed the judge is marked unfit first. What crashed the
//! judge is never served.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use aven_core::{DocId, Envelope, Hash};
use aven_db_docs::seal::{self, Seals};
use aven_db_docs::{
    Act, Authorize, Doc, EpochKey, Genesis, Imported, Item, Limits, Prepared, RecordWrite, Refused,
    Saved, Shelf, Snapshot, Unopened, open_page, travels_plain,
};
use aven_id::Entropy;

use crate::docs::{Entry, Live, Tip, beyond, tips, version};

/// The store a peer's shelf sits on: the peer's own, or the docs worker's that asks the Peer-Light's.
#[cfg(not(target_arch = "wasm32"))]
pub type DynStore = dyn aven_db_store::Store + Send + Sync;
#[cfg(target_arch = "wasm32")]
pub type DynStore = dyn aven_db_store::Store;

fn store_hash(h: &Hash) -> aven_db_store::Hash {
    let hex: String = h.0.iter().map(|b| format!("{b:02x}")).collect();
    hex.parse().expect("32 bytes in hex are a store hash")
}

fn core_hash(h: &aven_db_store::Hash) -> Hash {
    Hash(*h.as_bytes())
}

/// A Doc as the docs worker holds it: no key, only plaintext.
pub struct Host<A: Authorize> {
    shelf: Shelf<DynStore>,
    doc: Doc,
    saved: Saved,
    auth: A,
    /// Envelopes whose bytes are on the shelf, by name.
    shelved: BTreeSet<Hash>,
    /// What crashed the judge alone: never counted, forwarded or served (the docs worker's, kept by the caller).
    unfit: BTreeSet<Hash>,
}

impl<A: Authorize> Host<A> {
    /// Opens a Doc from its genesis, its pins resolved in the type Docs `types` gives, its built-in types checked by
    /// their definers ([`crate::joined::builtins`]), reading back what the shelf holds of it.
    pub async fn open(
        shelf: Shelf<DynStore>,
        genesis: Genesis,
        types: impl Fn(&DocId) -> Option<Arc<Snapshot>>,
        limits: Limits,
        auth: A,
        unfit: BTreeSet<Hash>,
    ) -> Result<Host<A>, String> {
        let mut doc = Doc::open_with(genesis, types, limits, crate::joined::builtins())
            .map_err(|u| format!("a genesis this peer can't open: {u:?}"))?;
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
            auth,
            shelved: held_names,
            unfit,
        })
    }

    pub fn doc(&self) -> &Doc {
        &self.doc
    }

    pub fn snapshot(&self) -> Arc<Snapshot> {
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

    /// Finishes a commit with the device's signature: it counts here and goes on the shelf. Returns the envelope, for
    /// the keys' half to seal and send.
    pub async fn finish(&mut self, prepared: Prepared, sig: [u8; 64]) -> Result<Envelope, String> {
        let bytes = self
            .doc
            .finish(prepared, sig, &self.auth)
            .map_err(|e| format!("{e:?}"))?;
        self.keep().await?;
        Envelope::decode(&bytes).ok_or_else(|| "a commit that doesn't decode".into())
    }

    /// Takes in plaintext envelopes, as the keys' half opened them, in one page; what became held goes on the shelf.
    pub async fn take(
        &mut self,
        envelopes: &[Vec<u8>],
    ) -> Result<Vec<Result<Imported, Refused>>, String> {
        let page: Vec<&[u8]> = envelopes.iter().map(Vec::as_slice).collect();
        let results = self.doc.import_page(&page, &self.auth);
        self.keep().await?;
        Ok(results)
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

    /// What lies beyond another reader's tips, by name and plaintext, for the keys' half to seal (`doc_have`).
    pub fn beyond(&self, their: &[Tip]) -> Vec<(Hash, Vec<u8>)> {
        let entries = self.entries();
        let names: Vec<Hash> = beyond(&entries, their).iter().map(|e| e.name).collect();
        let held: BTreeMap<Hash, &Envelope> = self.doc.held().collect();
        names
            .into_iter()
            .filter_map(|n| held.get(&n).map(|e| (n, e.encode())))
            .collect()
    }

    /// Marks an envelope unfit because the judge crashed on it alone: it never counts, and is never served.
    pub fn mark_unfit(&mut self, name: Hash) {
        self.unfit.insert(name);
        self.doc.mark_unfit(name);
    }
}

/// What leaves the device for one envelope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Out {
    /// Its sealed bytes, or for the keyring its plain bytes: what the fetch gate serves, by `hash`.
    pub bytes: Vec<u8>,
    pub hash: Hash,
    /// The epoch it was sealed under; none for the keyring.
    pub epoch: Option<Hash>,
}

/// A Doc's keys' half: its epoch keys, the newest last, which open what arrives and seal what leaves. It keeps what it
/// sealed on the peer's store, by the envelope's name, so an envelope is sealed once and served by its hash.
pub struct Sealer {
    genesis: Genesis,
    epochs: Vec<EpochKey>,
    limits: Limits,
    shelf: Shelf<DynStore>,
    out: BTreeMap<Hash, Out>,
}

impl Sealer {
    pub fn new(
        genesis: Genesis,
        epochs: Vec<EpochKey>,
        limits: Limits,
        shelf: Shelf<DynStore>,
    ) -> Sealer {
        Sealer {
            genesis,
            epochs,
            limits,
            shelf,
            out: BTreeMap::new(),
        }
    }

    /// Whether this Doc travels plain: the keyring alone (A187).
    pub fn plain(&self) -> bool {
        travels_plain(&self.genesis)
    }

    /// What leaves the device for the envelope `name` (its plaintext `bytes`): sealed under the newest epoch once, or
    /// as it is for the keyring, and kept on the store for the gate to serve.
    pub async fn out(
        &mut self,
        name: Hash,
        bytes: &[u8],
        entropy: &mut impl Entropy,
    ) -> Result<Out, String> {
        if let Some(o) = self.out.get(&name) {
            return Ok(o.clone());
        }
        let (bytes, epoch) = if self.plain() {
            (bytes.to_vec(), None)
        } else {
            let epoch = self.epochs.last().ok_or("no epoch key to write under")?;
            let sealed = seal::seal(Seals::Envelope, epoch, &self.genesis.id(), bytes, entropy);
            (sealed, Some(epoch.name))
        };
        let hash = core_hash(&self.shelf.put(bytes.clone()).await?);
        let o = Out { bytes, hash, epoch };
        self.out.insert(name, o.clone());
        Ok(o)
    }

    /// What a commit gossips (`Live`): its sealed envelope, or its hash when too large; for the keyring, the Doc's
    /// version, so the others fetch it (A195).
    pub fn live(&self, out: &Out, version: Hash) -> Live {
        let doc = self.genesis.id().0;
        if self.plain() {
            Live::Version { doc, version }
        } else {
            Live::of(doc, &out.bytes)
        }
    }

    /// Opens what arrived, loose envelopes and segments mixed, as one page: sealed things under the epoch their outside
    /// names, or the keyring's plain items. Per item, its plaintext envelopes, or why it didn't open.
    pub fn open(&self, items: &[Vec<u8>]) -> Vec<Result<Vec<Vec<u8>>, Unopened>> {
        let page: Vec<Item<'_>> = items
            .iter()
            .map(|b| {
                if self.plain() {
                    Item::Plain(b)
                } else {
                    Item::Sealed(b)
                }
            })
            .collect();
        let epochs = &self.epochs;
        open_page(
            &self.genesis,
            &page,
            |h| epochs.iter().find(|e| e.name == *h),
            &self.limits,
        )
    }

    /// The bytes kept under `hash`, for the fetch gate.
    pub async fn get(&self, hash: &Hash) -> Result<Option<Vec<u8>>, String> {
        self.shelf.get(&store_hash(hash)).await
    }
}

/// A commit as it left the device: what to gossip, the envelope, and what its writer's segment closing needs.
#[derive(Debug)]
pub struct Committed {
    pub live: Live,
    pub envelope: Envelope,
    pub out: Out,
}

/// What an item taken in did.
#[derive(Debug, PartialEq, Eq)]
pub enum Taken {
    /// Opened and imported: each of its envelopes' results.
    Imported(Vec<Result<Imported, Refused>>),
    /// It didn't open: another Doc, an epoch this peer holds no key for, a bad seal or segment.
    Unopened(Unopened),
}

/// A Doc as a native peer holds it: both halves in one process.
pub struct Reader<A: Authorize> {
    pub host: Host<A>,
    pub sealer: Sealer,
}

impl<A: Authorize> Reader<A> {
    /// Opens a Doc and its keys from one shelf.
    pub async fn open(
        shelf: Shelf<DynStore>,
        genesis: Genesis,
        types: impl Fn(&DocId) -> Option<Arc<Snapshot>>,
        limits: Limits,
        epochs: Vec<EpochKey>,
        auth: A,
        unfit: BTreeSet<Hash>,
    ) -> Result<Reader<A>, String> {
        let sealer = Sealer::new(genesis.clone(), epochs, limits, shelf.clone());
        let host = Host::open(shelf, genesis, types, limits, auth, unfit).await?;
        Ok(Reader { host, sealer })
    }

    /// Commits with a device key this peer holds: prepare, its Ed25519 signature, finish, then out and live.
    pub async fn commit(
        &mut self,
        device: &iroh::SecretKey,
        generation: u64,
        batch: &[RecordWrite],
        at: &str,
        act: Act,
        entropy: &mut impl Entropy,
    ) -> Result<Committed, String> {
        let p = self
            .host
            .prepare(*device.public().as_bytes(), generation, batch, at, act)?;
        let sig = device.sign(&p.signing()).to_bytes();
        let envelope = self.host.finish(p, sig).await?;
        let out = self
            .sealer
            .out(envelope.name(), &envelope.encode(), entropy)
            .await?;
        let live = self.sealer.live(&out, self.host.version());
        Ok(Committed {
            live,
            envelope,
            out,
        })
    }

    /// Takes in what arrived, by gossip or the gate: opened, then imported as one page.
    pub async fn take(&mut self, items: &[Vec<u8>]) -> Result<Vec<Taken>, String> {
        let opened = self.sealer.open(items);
        let page: Vec<Vec<u8>> = opened.iter().flatten().flatten().cloned().collect();
        let mut results = self.host.take(&page).await?.into_iter();
        Ok(opened
            .into_iter()
            .map(|o| match o {
                Ok(envs) => Taken::Imported(results.by_ref().take(envs.len()).collect()),
                Err(u) => Taken::Unopened(u),
            })
            .collect())
    }

    /// The answer to another reader's tips (`doc_have`): the hashes of what leaves the device for each envelope beyond
    /// them, kept on the store for the gate.
    pub async fn answer(
        &mut self,
        their: &[Tip],
        entropy: &mut impl Entropy,
    ) -> Result<Vec<Hash>, String> {
        let mut hashes = vec![];
        for (name, bytes) in self.host.beyond(their) {
            hashes.push(self.sealer.out(name, &bytes, entropy).await?.hash);
        }
        Ok(hashes)
    }

    pub fn tips(&self) -> Vec<Tip> {
        self.host.tips()
    }

    pub fn version(&self) -> Hash {
        self.host.version()
    }

    pub fn snapshot(&self) -> Arc<Snapshot> {
        self.host.snapshot()
    }

    pub fn doc(&self) -> &Doc {
        self.host.doc()
    }
}
