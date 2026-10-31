//! A keeper serving its connections (`Aven.Peer.Serve`): each ask on one connection, composing avenID's gate, the
//! Doc's [`Arrivals`] and the fetch gate. The keeper reads no caps: [`Gate`] answers for it, and avenID implements it
//! (`Aven.ID.Keep`); the tests drive it by the model's verdicts.
//!
//! - `prove`: the Doc is proven on this connection, billed to the vault the gate names, or refused;
//! - `upload`: from a connection that proved the Doc, its puts land in one write if the vault's bill after them is
//!   within its quota or no larger than before, or refused whole with nothing taken. A bill is the bytes held whose
//!   earliest remaining uploader acts for the vault: it moves when that uploader covers the item, and is freed when
//!   the item drops. A bill moved past a quota refuses only uploads that would grow it (`moved_bill_keeps`,
//!   `over_quota_sheds`);
//! - `after`: the first page of what came after a number, and whether more follows;
//! - `fetch`: the fetch gate's answer over what the keeper holds for that Doc.
//!
//! An ask other than `prove` for a Doc not proven on the connection is refused and changes nothing
//! (`unproven_refused`), so a Doc no keep cap names is never kept or served (`kept_only_proven`).

use std::collections::{BTreeMap, BTreeSet};

use crate::fetch::{self, Answer};
use crate::{Arrivals, Item, PAGE, Put};

/// What a keeper asks avenID's gate (`Aven.ID.Keep`). The keeper reads no caps; the gate does. Bills are the keeper's:
/// only it sees who uploaded what.
pub trait Gate<D> {
    /// A device's fetch proof as it came in `prove {doc, key, sig}`.
    type Proof;
    /// Whom a bill is for: the vault the tree says the proof's device acts for.
    type Vault: Clone + Ord;
    /// `Books.serves`: the keeper keeps `doc` and `proof` signs this connection's TLS `exporter` with the Doc's current
    /// fetch key, or a branch's newest while a fork is unsettled. The vault the device acts for when it serves.
    fn serves(&self, doc: &D, exporter: &[u8; 32], proof: &Self::Proof) -> Option<Self::Vault>;
    /// `Books.quota`: how many bytes the keeper holds for `vault` at once.
    fn quota(&self, vault: &Self::Vault) -> u64;
}

/// One connection as the keeper sees it: the door's device, the TLS exporter, the Docs proven on it with the vault each
/// bills.
#[derive(Clone, Debug)]
pub struct Conn<D, V> {
    pub device: String,
    pub exporter: [u8; 32],
    proven: BTreeMap<D, V>,
}

impl<D: Ord, V> Conn<D, V> {
    pub fn new(device: impl Into<String>, exporter: [u8; 32]) -> Self {
        Self {
            device: device.into(),
            exporter,
            proven: BTreeMap::new(),
        }
    }

    /// Whether `doc` was proven on this connection.
    pub fn proved(&self, doc: &D) -> bool {
        self.proven.contains_key(doc)
    }
}

/// Why an upload was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UploadRefused {
    Quota,
}

/// The keeper's reply to one ask.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reply<H> {
    Proven,
    ProveRefused,
    Took(Vec<(H, u64)>),
    UploadRefused(UploadRefused),
    Arrived {
        entries: Vec<(u64, H)>,
        more: bool,
    },
    Fetched(Answer<H>),
    /// an ask for a Doc not proven on this connection, or a fetch of too many hashes
    Refused,
}

/// A keeper: what it holds of each Doc, the vault each device acts for, and each vault's bill: the bytes of the items
/// held whose earliest remaining uploader acts for it (`bill_follows`).
#[derive(Debug)]
pub struct Keeper<D, H: Ord, G: Gate<D>> {
    pub gate: G,
    docs: BTreeMap<D, Arrivals<H>>,
    acts: BTreeMap<String, G::Vault>,
    bills: BTreeMap<G::Vault, u64>,
}

impl<D: Ord + Clone, H: Ord + Clone, G: Gate<D>> Keeper<D, H, G> {
    pub fn new(gate: G) -> Self {
        Self {
            gate,
            docs: BTreeMap::new(),
            acts: BTreeMap::new(),
            bills: BTreeMap::new(),
        }
    }

    /// What the keeper holds of `doc`, if anything.
    pub fn doc(&self, doc: &D) -> Option<&Arrivals<H>> {
        self.docs.get(doc)
    }

    /// A vault's bill: the bytes held now that it pays for.
    pub fn bill(&self, vault: &G::Vault) -> u64 {
        self.bills.get(vault).copied().unwrap_or(0)
    }

    fn payer(acts: &BTreeMap<String, G::Vault>, item: &Item<H>) -> Option<G::Vault> {
        item.uploaders.first().and_then(|d| acts.get(d)).cloned()
    }

    fn charge(&mut self, item: &Item<H>, add: bool) {
        if let Some(v) = Self::payer(&self.acts, item) {
            let bill = self.bills.entry(v.clone()).or_default();
            if add {
                *bill += item.bytes;
            } else {
                *bill -= item.bytes;
                if *bill == 0 {
                    self.bills.remove(&v);
                }
            }
        }
    }

    /// Every bill again, after a device came to act for another vault.
    fn rebill(&mut self) {
        let mut bills = BTreeMap::new();
        for s in self.docs.values() {
            for i in s.items() {
                if let Some(v) = Self::payer(&self.acts, i) {
                    *bills.entry(v).or_default() += i.bytes;
                }
            }
        }
        self.bills = bills;
    }

    /// `prove {doc, …}` on `c`.
    pub fn prove(&mut self, c: &mut Conn<D, G::Vault>, doc: &D, proof: &G::Proof) -> Reply<H> {
        match self.gate.serves(doc, &c.exporter, proof) {
            Some(v) => {
                if self.acts.get(&c.device) != Some(&v) {
                    self.acts.insert(c.device.clone(), v.clone());
                    self.rebill();
                }
                c.proven.insert(doc.clone(), v);
                Reply::Proven
            }
            None => Reply::ProveRefused,
        }
    }

    /// An upload of `puts` to `doc` from `c`, whole: one write of the Doc's arrivals, taken when the vault's bill after
    /// it is within its quota or no larger than before (`admitted_within`), so a vault a moved bill pushed past its
    /// quota can always shed bytes (`over_quota_sheds`); otherwise refused with nothing taken.
    pub fn upload(&mut self, c: &Conn<D, G::Vault>, doc: &D, puts: &[Put<H>]) -> Reply<H> {
        let Some(v) = c.proven.get(doc).cloned() else {
            return Reply::Refused;
        };
        // the upload taken on a copy, before deciding (`taking`): only the items it names can change
        let held = self.docs.get(doc).cloned().unwrap_or_default();
        let mut taken = held.clone();
        taken.upload(&c.device, puts);
        let touched: BTreeSet<H> = puts
            .iter()
            .flat_map(|p| std::iter::once(p.hash.clone()).chain(p.covers.iter().cloned()))
            .collect();
        let before: Vec<Item<H>> = touched
            .iter()
            .filter_map(|h| held.get(h).cloned())
            .collect();
        let after: Vec<Item<H>> = touched
            .iter()
            .filter_map(|h| taken.get(h).cloned())
            .collect();
        let paid = |items: &[Item<H>]| -> u64 {
            items
                .iter()
                .filter(|i| Self::payer(&self.acts, i).as_ref() == Some(&v))
                .map(|i| i.bytes)
                .sum()
        };
        let now = self.bill(&v);
        let then = now - paid(&before) + paid(&after);
        if then > self.gate.quota(&v) && then > now {
            return Reply::UploadRefused(UploadRefused::Quota);
        }
        for i in &before {
            self.charge(i, false);
        }
        for i in &after {
            self.charge(i, true);
        }
        let took = puts
            .iter()
            .filter_map(|p| taken.get(&p.hash).map(|i| (p.hash.clone(), i.n)))
            .collect();
        self.docs.insert(doc.clone(), taken);
        Reply::Took(took)
    }

    /// `keep_after {doc, n}`: the first page of what came after `n`.
    pub fn after(&self, c: &Conn<D, G::Vault>, doc: &D, n: u64) -> Reply<H> {
        if !c.proved(doc) {
            return Reply::Refused;
        }
        let (entries, more) = self.docs.get(doc).map(|s| s.page(n)).unwrap_or_default();
        debug_assert!(entries.len() <= PAGE);
        Reply::Arrived { entries, more }
    }

    /// `fetch {doc, hashes}`: the fetch gate's answer over what the keeper holds for `doc`.
    pub fn fetch(&self, c: &Conn<D, G::Vault>, doc: &D, hashes: &[H]) -> Reply<H> {
        let held = self.docs.get(doc);
        let answer = fetch::answer(c.proved(doc), hashes, |h| {
            held.and_then(|s| s.get(h)).map(|i| i.bytes)
        });
        match answer {
            Some(a) => Reply::Fetched(a),
            None => Reply::Refused,
        }
    }
}
