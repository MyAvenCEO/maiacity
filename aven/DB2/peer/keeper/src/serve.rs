//! A keeper serving its connections (`Aven.Peer.Serve`): each ask on one connection, composing avenID's gate, the
//! Doc's [`Arrivals`] and the fetch gate. The keeper reads no caps: [`Gate`] answers for it, and avenID implements it
//! (`Aven.ID.Keep`); the tests drive it by the model's verdicts.
//!
//! - `prove`: the Doc is proven on this connection, billed to the vault the gate names, or refused;
//! - `upload`: from a connection that proved the Doc, its puts land in one write, their new bytes admitted against the
//!   vault's quota, or refused whole with nothing taken;
//! - `after`: the first page of what came after a number, and whether more follows;
//! - `fetch`: the fetch gate's answer over what the keeper holds for that Doc.
//!
//! An ask other than `prove` for a Doc not proven on the connection is refused and changes nothing
//! (`unproven_refused`), so a Doc no keep cap names is never kept or served (`kept_only_proven`).

use std::collections::{BTreeMap, BTreeSet};

use crate::fetch::{self, Answer};
use crate::{Arrivals, PAGE, Put};

/// What a keeper asks avenID's gate (`Aven.ID.Keep`). The keeper reads no caps; the gate does.
pub trait Gate<D> {
    /// A device's fetch proof as it came in `prove {doc, key, sig}`.
    type Proof;
    /// Whom a bill is for: the vault the tree says the proof's device acts for.
    type Vault: Clone;
    /// `Books.serves`: the keeper keeps `doc` and `proof` signs this connection's TLS `exporter` with the Doc's current
    /// fetch key, or a branch's newest while a fork is unsettled. The vault to bill when it serves.
    fn serves(&self, doc: &D, exporter: &[u8; 32], proof: &Self::Proof) -> Option<Self::Vault>;
    /// `admit` under `Books.quota`: takes `bytes` more from `vault` onto its bill, or refuses past its quota. A bill
    /// counts the bytes held for the vault now.
    fn admit(&mut self, vault: &Self::Vault, bytes: u64) -> bool;
    /// An item `vault` paid for was dropped: its `bytes` leave the bill.
    fn release(&mut self, vault: &Self::Vault, bytes: u64);
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

/// A keeper: what it holds of each Doc, and the gate that decides for it.
#[derive(Debug)]
pub struct Keeper<D, H: Ord, G: Gate<D>> {
    pub gate: G,
    docs: BTreeMap<D, Arrivals<H>>,
    /// per Doc, who pays for each item held: the vault of the device that first uploaded it, and its bytes
    payers: BTreeMap<D, BTreeMap<H, (G::Vault, u64)>>,
}

impl<D: Ord + Clone, H: Ord + Clone, G: Gate<D>> Keeper<D, H, G> {
    pub fn new(gate: G) -> Self {
        Self {
            gate,
            docs: BTreeMap::new(),
            payers: BTreeMap::new(),
        }
    }

    /// What the keeper holds of `doc`, if anything.
    pub fn doc(&self, doc: &D) -> Option<&Arrivals<H>> {
        self.docs.get(doc)
    }

    /// `prove {doc, …}` on `c`.
    pub fn prove(&mut self, c: &mut Conn<D, G::Vault>, doc: &D, proof: &G::Proof) -> Reply<H> {
        match self.gate.serves(doc, &c.exporter, proof) {
            Some(v) => {
                c.proven.insert(doc.clone(), v);
                Reply::Proven
            }
            None => Reply::ProveRefused,
        }
    }

    /// An upload of `puts` to `doc` from `c`, whole: one write of the Doc's arrivals.
    pub fn upload(&mut self, c: &Conn<D, G::Vault>, doc: &D, puts: &[Put<H>]) -> Reply<H> {
        let Some(v) = c.proven.get(doc).cloned() else {
            return Reply::Refused;
        };
        let empty = Arrivals::default();
        let held = self.docs.get(doc).unwrap_or(&empty);
        // the puts the upload adds: those new to the Doc, once each (`fresh`)
        let mut seen = BTreeSet::new();
        let fresh: Vec<&Put<H>> = puts
            .iter()
            .filter(|p| held.get(&p.hash).is_none() && seen.insert(p.hash.clone()))
            .collect();
        if !self.gate.admit(&v, fresh.iter().map(|p| p.bytes).sum()) {
            return Reply::UploadRefused(UploadRefused::Quota);
        }
        let s = self.docs.entry(doc.clone()).or_default();
        let payers = self.payers.entry(doc.clone()).or_default();
        for p in fresh {
            payers.insert(p.hash.clone(), (v.clone(), p.bytes));
        }
        // what is gone once the whole upload is in frees its payer's bill (`release`)
        let dropped: Vec<H> = s
            .upload(&c.device, puts)
            .into_iter()
            .flat_map(|t| t.dropped)
            .map(|i| i.hash)
            .collect();
        for h in dropped {
            if s.get(&h).is_none()
                && let Some((w, bytes)) = payers.remove(&h)
            {
                self.gate.release(&w, bytes);
            }
        }
        Reply::Took(
            puts.iter()
                .filter_map(|p| s.get(&p.hash).map(|i| (p.hash.clone(), i.n)))
                .collect(),
        )
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
