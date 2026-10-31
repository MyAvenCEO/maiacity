//! Revocations, acks and deletes (`Aven.ID.Revoke`; caps README, rule 14; A22).
//!
//! A revocation ends a cap and every cap resting on it, and wins over what it had not seen. A Doc is the envelopes a
//! reader holds, each named as Core names it ([`Envelope::name`]), its past Core's ([`aven_core::past`]). Caps reads
//! three things of an envelope, from inside its seal ([`Reads`]): the vault it writes for, the ids of the caps it
//! writes under (every link, root first) and the revocations it acknowledges.
//!
//! - an envelope whose deps aren't all here **waits**, naming them;
//! - a revoked holder's envelope that had seen the revocation never counts, whatever anyone acknowledges;
//! - under a Doc cap (the revocation lives in the Doc), only the revocation's own past is kept;
//! - elsewhere, once the revocation has reached the Doc, only what its kept list or another writer's ack had seen.
//!
//! A delete (A22): once a reader holds a delete its vault wrote on its own authority, an envelope counts only if it
//! is the delete or in its past ([`survives`]).

use std::collections::BTreeSet;

use aven_core::past::past;
use aven_core::{Envelope, Hash, Parents};

/// What caps reads of an envelope, from inside its seal.
pub trait Reads {
    /// The vault it writes for.
    fn vault(&self, e: &Envelope) -> String;
    /// The ids of the caps it writes under, every link, root first.
    fn caps(&self, e: &Envelope) -> Vec<Hash>;
    /// The revocations it acknowledges.
    fn acks(&self, e: &Envelope) -> Vec<Hash>;
}

/// A revocation of `cap`: living in the Doc as the envelope named `envelope`, or elsewhere, with a kept list of names
/// for this Doc when its revoker held it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Revocation {
    pub id: Hash,
    pub cap: Hash,
    pub envelope: Option<Hash>,
    pub kept: Option<Vec<Hash>>,
}

/// The revocations' verdict on an envelope.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Verdict {
    Counts,
    /// Ended by the revocation with this id.
    Revoked(Hash),
    /// It builds on these, which the reader doesn't hold.
    Waits(Vec<Hash>),
}

/// A Doc as a reader holds it, each envelope's name and past worked out once.
pub struct Doc<'a> {
    envelopes: &'a [Envelope],
    names: Vec<Hash>,
}

impl<'a> Doc<'a> {
    pub fn new(envelopes: &'a [Envelope]) -> Doc<'a> {
        Doc {
            envelopes,
            names: envelopes.iter().map(Envelope::name).collect(),
        }
    }

    pub fn envelopes(&self) -> &'a [Envelope] {
        self.envelopes
    }

    /// The names of what is before `e` (`past`).
    pub fn past(&self, e: &Envelope) -> BTreeSet<Hash> {
        past(Envelope::name, self.envelopes, e)
    }

    /// `y` is before `e` (`inPast nm doc e y`).
    fn before(&self, past_of_e: &BTreeSet<Hash>, y: usize) -> bool {
        past_of_e.contains(&self.names[y])
    }

    /// What `e` builds on that isn't here, by name (`missing`).
    pub fn missing(&self, e: &Envelope) -> Vec<Hash> {
        e.parents()
            .into_iter()
            .filter(|d| !self.names.contains(d))
            .collect()
    }

    /// The envelopes from other vaults that acknowledge `r` (`ackers`).
    fn ackers(&self, rd: &impl Reads, e: &Envelope, r: &Revocation) -> Vec<usize> {
        let mine = rd.vault(e);
        (0..self.envelopes.len())
            .filter(|&a| {
                let x = &self.envelopes[a];
                rd.acks(x).contains(&r.id) && rd.vault(x) != mine
            })
            .collect()
    }

    /// `e` had seen `r`: `r`'s envelope is before `e`, or `e` or something before it acknowledges `r` (`saw`).
    pub fn saw(&self, rd: &impl Reads, e: &Envelope, r: &Revocation) -> bool {
        let p = self.past(e);
        r.envelope.is_some_and(|x| p.contains(&x))
            || rd.acks(e).contains(&r.id)
            || (0..self.envelopes.len())
                .any(|y| self.before(&p, y) && rd.acks(&self.envelopes[y]).contains(&r.id))
    }

    /// `r` has reached the Doc: it lives in it, its revoker kept a list for it, or another writer acknowledges it
    /// (`effective`).
    pub fn effective(&self, rd: &impl Reads, e: &Envelope, r: &Revocation) -> bool {
        r.envelope.is_some() || r.kept.is_some() || !self.ackers(rd, e, r).is_empty()
    }

    /// `r` keeps `e`: under a Doc cap, `e` is before the revocation's envelope; elsewhere, its kept list names `e` or
    /// another writer's ack had seen it (`keptBy`).
    pub fn kept_by(&self, rd: &impl Reads, e: &Envelope, r: &Revocation) -> bool {
        let ne = e.name();
        let seen_by = |y: usize| self.past(&self.envelopes[y]).contains(&ne);
        match r.envelope {
            Some(x) => (0..self.envelopes.len()).any(|y| self.names[y] == x && seen_by(y)),
            None => {
                r.kept.as_ref().is_some_and(|k| k.contains(&ne))
                    || self.ackers(rd, e, r).into_iter().any(seen_by)
            }
        }
    }

    /// `r` ends `e`: `e` writes under the revoked cap, and either had seen `r` or isn't kept by it once it took effect
    /// (`rejects`).
    pub fn rejects(&self, rd: &impl Reads, e: &Envelope, r: &Revocation) -> bool {
        rd.caps(e).contains(&r.cap)
            && (self.saw(rd, e, r) || (self.effective(rd, e, r) && !self.kept_by(rd, e, r)))
    }

    /// The verdict on `e`, with the revocations `rs` the reader holds (`verdict`).
    pub fn verdict(&self, rd: &impl Reads, rs: &[Revocation], e: &Envelope) -> Verdict {
        let m = self.missing(e);
        if !m.is_empty() {
            return Verdict::Waits(m);
        }
        match rs.iter().find(|r| self.rejects(rd, e, r)) {
            Some(r) => Verdict::Revoked(r.id),
            None => Verdict::Counts,
        }
    }

    /// The deletes a reader holds: envelopes that read as a delete and that the Doc's vault wrote on its own
    /// authority (`deletesOf`).
    fn deletes(
        &self,
        is_delete: &impl Fn(&Envelope) -> bool,
        by_owner: &impl Fn(&Envelope) -> bool,
    ) -> Vec<usize> {
        (0..self.envelopes.len())
            .filter(|&d| is_delete(&self.envelopes[d]) && by_owner(&self.envelopes[d]))
            .collect()
    }

    /// `e` survives the deletes a reader holds: it is each of them, or in its past (`survives`).
    pub fn survives(
        &self,
        is_delete: impl Fn(&Envelope) -> bool,
        by_owner: impl Fn(&Envelope) -> bool,
        e: &Envelope,
    ) -> bool {
        let ne = e.name();
        self.deletes(&is_delete, &by_owner)
            .into_iter()
            .all(|d| self.names[d] == ne || self.past(&self.envelopes[d]).contains(&ne))
    }

    /// Caps' liveness with the deletes a reader holds: the revocations' verdict counts it, and it survives every
    /// delete (`liveWith`).
    pub fn live_with(
        &self,
        rd: &impl Reads,
        is_delete: impl Fn(&Envelope) -> bool,
        by_owner: impl Fn(&Envelope) -> bool,
        rs: &[Revocation],
        e: &Envelope,
    ) -> bool {
        self.verdict(rd, rs, e) == Verdict::Counts && self.survives(is_delete, by_owner, e)
    }
}
