//! Caps' verdict on one envelope, over Core types only, for a reader that holds the envelope's whole past (A23, A182).
//! The docs layer's `Authorize` adapts it; caps never depends on the docs layer.
//!
//! - [`authorized`]: the signing device acts within its device cap, and the envelope writes on its vault's own
//!   authority or under the chain its `authority` names (`Reader.Authorized`), each cap found among the cap Records the
//!   reader holds by its name. An envelope naming a cap the reader doesn't hold isn't authorized.
//! - [`revoked`]: a revocation ends it, judged over its past (`Revoke.verdict`); Core's counting discounts it, as it
//!   does a split (A182).
//! - [`Reader::reaches`]: the docs layer's step 4, before any of its bytes is read.
//!
//! Each is a function of the envelope, its past and what the reader holds, so readers holding the same agree
//! (`readers_agree`).

use aven_core::{Call, Envelope, Hash};

use super::authority::Authority;
use super::authorized::{Path, Reader, Reading, Refusal};
use super::chain::Cap;
use super::revoke::{Doc, Reads, Revocation, Verdict};

/// One envelope as caps reads it: Core's envelope, the key that placed it in its log, its calls, and its `authority`.
pub struct Written<'e> {
    pub envelope: &'e Envelope,
    pub signer: &'e [u8],
    pub calls: &'e [Call],
    pub authority: &'e Authority,
}

/// Why caps refuses an envelope: a cap its authority names that the reader doesn't hold, or the reader's verdict.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Refused {
    UnknownCap(Hash),
    Reader(Refusal),
}

/// Caps' verdict on `e` (`Reader.Authorized`): the chain its authority names, root first, each cap found by its name
/// among those the reader holds (`cap`), judged by the reader.
pub fn authorized(
    reader: &Reader,
    cap: &dyn Fn(&Hash) -> Option<Cap>,
    e: &Written,
) -> Result<Path, Refused> {
    let chain = e
        .authority
        .caps
        .iter()
        .map(|n| cap(n).ok_or(Refused::UnknownCap(*n)))
        .collect::<Result<Vec<Cap>, _>>()?;
    let reading = Reading {
        signer: e.signer,
        doc: e.envelope.doc,
        branch: &e.envelope.branch,
        chain: &chain,
        calls: e.calls.to_vec(),
        actor: e.authority.actor,
    };
    reader.authorized(&reading).map_err(Refused::Reader)
}

/// What caps reads of the envelopes of a past (`Reads`): each one's vault, the caps it writes under and the
/// revocations it acknowledges, by its name.
pub struct PastReads<'a> {
    pub vault: &'a dyn Fn(&Envelope) -> String,
    pub authority: &'a dyn Fn(&Envelope) -> Authority,
}

impl Reads for PastReads<'_> {
    fn vault(&self, e: &Envelope) -> String {
        (self.vault)(e)
    }
    fn caps(&self, e: &Envelope) -> Vec<Hash> {
        (self.authority)(e).caps
    }
    fn acks(&self, e: &Envelope) -> Vec<Hash> {
        (self.authority)(e).acks
    }
}

/// Whether a revocation the reader holds ends `e`, judged over `held`, the envelopes of its Doc the reader holds, its
/// whole past among them (`Revoke.verdict`, A182). `Waits` names what it builds on that isn't held.
pub fn revoked(
    rd: &PastReads,
    held: &[Envelope],
    revocations: &[Revocation],
    e: &Envelope,
) -> Verdict {
    Doc::new(held).verdict(rd, revocations, e)
}
