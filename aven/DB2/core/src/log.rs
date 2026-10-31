//! Envelopes, logs, splits and versions (`Aven.Core.Log`, ARCHITECTURE.md rules 2 and 3, A3, A4, A30, A31).
//!
//! An **envelope** is the one signed unit of change. It names its place in its writer's **log** (its Doc, branch,
//! writer id and sequence number), the envelope before it by hash, and the tips of the other logs it builds on by hash,
//! never a counter alone (rule 2). It is named by the hash of exactly what its writer signs, its signature beside it
//! (A30).
//!
//! A **split** is a writer signing two different envelopes at one place of its log. Splits are final: an envelope whose
//! past holds a split never counts, for any reader, however many more envelopes it learns of (A4, `split_final`).

use alloc::collections::{BTreeMap, BTreeSet};
use alloc::string::String;
use alloc::vec;
use alloc::vec::Vec;

use crate::limits::{MAX_BRANCH_BYTES, MAX_DEPS, MAX_ENVELOPE_BYTES};
use crate::past::{self, Parents};
use crate::signed::{Sig, Verify, add_sig, signing_bytes, sigs_of, sigs_value, sigs_within};
use aven_codec::{DocId, Hash, blake3};
use aven_codec::{Value, decode, encode};

/// Which keys write which envelope's log (Lean's `Writes`): a parameter, as [`Verify`] is. The docs layer implements it
/// once, from how it derives a writer id, and caps checks the key against the device cap. Any
/// `Fn(&[u8], &Envelope) -> bool` is one.
pub trait Writes {
    fn writes(&self, key: &[u8], e: &Envelope) -> bool;
}

impl<F: Fn(&[u8], &Envelope) -> bool> Writes for F {
    fn writes(&self, key: &[u8], e: &Envelope) -> bool {
        self(key, e)
    }
}

/// What an envelope's writer signs it under (`envelopeLabel`).
pub const ENVELOPE_LABEL: &str = "avenDB envelope 1";

/// The one signed unit of change (Lean's `Envelope`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Envelope {
    pub doc: DocId,
    pub branch: String,
    pub writer: u64,
    pub seq: u64,
    pub prev: Option<Hash>,
    pub deps: Vec<Hash>,
    pub body: Value,
    /// The signatures beside its name, a set in its one form (sorted by signer, one each): the writer's, which places
    /// it in its log, and approvals.
    pub sigs: Vec<Sig>,
}

/// One log: one Doc, one branch, one writer id (`SameLog`).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct LogId {
    pub doc: DocId,
    pub branch: String,
    pub writer: u64,
}

fn opt_hash(h: &Option<Hash>) -> Value {
    h.as_ref().map_or(Value::Null, Hash::value)
}

fn hash_of(v: Value) -> Option<Hash> {
    Hash::of_value(&v)
}

impl Envelope {
    fn deps_value(&self) -> Value {
        Value::Array(self.deps.iter().map(Hash::value).collect())
    }

    /// What its signers sign: everything but the signatures, keys in the codec's order (`Envelope.unsigned`).
    pub fn unsigned(&self) -> Value {
        Value::Map(vec![
            ("doc".into(), self.doc.0.value()),
            ("seq".into(), Value::Uint(self.seq)),
            ("body".into(), self.body.clone()),
            ("deps".into(), self.deps_value()),
            ("prev".into(), opt_hash(&self.prev)),
            ("branch".into(), Value::Text(self.branch.clone())),
            ("writer".into(), Value::Uint(self.writer)),
        ])
    }

    /// The whole envelope, its signatures beside it, as it travels (`Envelope.value`).
    pub fn value(&self) -> Value {
        Value::Map(vec![
            ("doc".into(), self.doc.0.value()),
            ("seq".into(), Value::Uint(self.seq)),
            ("body".into(), self.body.clone()),
            ("deps".into(), self.deps_value()),
            ("prev".into(), opt_hash(&self.prev)),
            ("sigs".into(), sigs_value(&self.sigs)),
            ("branch".into(), Value::Text(self.branch.clone())),
            ("writer".into(), Value::Uint(self.writer)),
        ])
    }

    /// What its signers sign: `[ENVELOPE_LABEL, unsigned]` encoded (`Envelope.signing`).
    pub fn signing(&self) -> Vec<u8> {
        signing_bytes(ENVELOPE_LABEL, &self.unsigned())
    }

    /// Its name: the hash of exactly what its signers sign, so signing it again, by anyone, never makes a second name
    /// (A30).
    pub fn name(&self) -> Hash {
        blake3(&self.signing())
    }

    /// Placed in its log (`Envelope.placed`): a key that [`Writes`] this envelope's log signed it. Who writes is a
    /// parameter, as `verify` is: the docs layer derives it from the writer id, and caps checks the key against the
    /// device cap. An envelope that isn't placed is nothing: a reader refuses it, so it is never held, never counts and
    /// is never half of a split.
    pub fn placed(&self, verify: &impl Verify, writes: &impl Writes) -> bool {
        let msg = self.signing();
        self.sigs
            .iter()
            .any(|x| writes.writes(&x.signer, self) && x.valid(verify, &msg))
    }

    /// The signatures beside it that verify, the writer's among them (`Envelope.approvals`).
    pub fn approvals(&self, verify: &impl Verify) -> Vec<&Sig> {
        let msg = self.signing();
        self.sigs.iter().filter(|x| x.valid(verify, &msg)).collect()
    }

    /// Adds a signature beside it (`addSig`): never renames it, never a split.
    pub fn add_sig(&mut self, x: Sig) {
        add_sig(&mut self.sigs, x);
    }

    pub fn log(&self) -> LogId {
        LogId {
            doc: self.doc,
            branch: self.branch.clone(),
            writer: self.writer,
        }
    }

    /// Read back from [`Envelope::value`]: exactly its eight keys in the codec's order, each in its form and within
    /// its limit, its signatures a set in its one form (`Envelope.ofValue?`, `Envelope.withinLimits`, rule 10).
    pub fn of_value(v: Value) -> Option<Envelope> {
        const KEYS: [&str; 8] = [
            "doc", "seq", "body", "deps", "prev", "sigs", "branch", "writer",
        ];
        let Value::Map(kvs) = v else { return None };
        if kvs.len() != KEYS.len() || kvs.iter().zip(KEYS).any(|((k, _), want)| k != want) {
            return None;
        }
        let [doc, seq, body, deps, prev, sigs, branch, writer]: [Value; 8] = kvs
            .into_iter()
            .map(|(_, v)| v)
            .collect::<Vec<_>>()
            .try_into()
            .ok()?;
        let (Value::Uint(seq), Value::Array(deps), Value::Text(branch), Value::Uint(writer)) =
            (seq, deps, branch, writer)
        else {
            return None;
        };
        if deps.len() > MAX_DEPS || branch.len() > MAX_BRANCH_BYTES {
            return None;
        }
        let sigs = sigs_of(sigs)?;
        if !sigs_within(&sigs) {
            return None;
        }
        let prev = match prev {
            Value::Null => None,
            p => Some(hash_of(p)?),
        };
        Some(Envelope {
            doc: DocId(hash_of(doc)?),
            branch,
            writer,
            seq,
            prev,
            deps: deps.into_iter().map(hash_of).collect::<Option<_>>()?,
            body,
            sigs,
        })
    }

    pub fn encode(&self) -> Vec<u8> {
        encode(&self.value())
    }

    /// Decoded from its bytes, refused past [`MAX_ENVELOPE_BYTES`] before anything is read.
    pub fn decode(bytes: &[u8]) -> Option<Envelope> {
        if bytes.len() > MAX_ENVELOPE_BYTES {
            return None;
        }
        Envelope::of_value(decode(bytes)?)
    }
}

impl Parents for Envelope {
    /// The envelope before it in its log, then the tips it names.
    fn parents(&self) -> Vec<Hash> {
        self.prev.iter().chain(&self.deps).copied().collect()
    }
}

/// Two different envelopes at one place of one log (`Split`, A4): one Doc, branch, writer and sequence number, two
/// names. One envelope signed twice is no split (`sigs_no_split`).
pub fn split(a: &Envelope, b: &Envelope) -> bool {
    a.doc == b.doc
        && a.branch == b.branch
        && a.writer == b.writer
        && a.seq == b.seq
        && a.name() != b.name()
}

/// What a reader holds, `S`, with each envelope's name worked out once.
pub struct Held<'a> {
    envelopes: &'a [Envelope],
    names: Vec<Hash>,
    /// Each place, `(log, seq)`, and the names held there: more than one is a split.
    places: BTreeMap<(LogId, u64), BTreeSet<Hash>>,
    /// Every held name.
    by_name: BTreeSet<Hash>,
}

impl<'a> Held<'a> {
    pub fn new(envelopes: &'a [Envelope]) -> Held<'a> {
        let names: Vec<Hash> = envelopes.iter().map(Envelope::name).collect();
        let mut places: BTreeMap<(LogId, u64), BTreeSet<Hash>> = BTreeMap::new();
        for (e, n) in envelopes.iter().zip(&names) {
            places.entry((e.log(), e.seq)).or_default().insert(*n);
        }
        let by_name = names.iter().copied().collect();
        Held {
            envelopes,
            names,
            places,
            by_name,
        }
    }

    pub fn envelopes(&self) -> &'a [Envelope] {
        self.envelopes
    }

    /// Whether some held envelope makes a split with `x`, named `nx` (`∃ y ∈ S, Split x y`).
    fn split_with(&self, x: &Envelope, nx: &Hash) -> bool {
        self.places
            .get(&(x.log(), x.seq))
            .is_some_and(|ns| ns.iter().any(|n| n != nx))
    }

    /// The names before `e` among what is held (`Past.past`).
    pub fn past(&self, e: &Envelope) -> BTreeSet<Hash> {
        past::past_named(self.envelopes, &self.names, e)
    }

    /// Everything `e` reaches (`Reaches S e x`): `e` itself, then each held envelope whose name is in its past
    /// (`reaches_iff`).
    fn reached(&self, e: &Envelope) -> impl Iterator<Item = (&'a Envelope, Hash)> {
        let past = self.past(e);
        self.envelopes
            .iter()
            .zip(self.names.iter().copied())
            .filter(move |(_, n)| past.contains(n))
    }

    /// Its past, itself included, holds half of a split (`Discounted`).
    pub fn discounted(&self, e: &Envelope) -> bool {
        self.split_with(e, &e.name()) || self.reached(e).any(|(x, n)| self.split_with(x, &n))
    }

    /// Every parent `x` names is held (`parentsHeld`).
    fn parents_held(&self, x: &Envelope) -> bool {
        x.parents().iter().all(|h| self.by_name.contains(h))
    }

    /// Its whole past is held (`Closed`, rule 11): it and everything it reaches name only held envelopes as their
    /// prev and deps. Built on a parent the reader lacks, it waits.
    pub fn closed(&self, e: &Envelope) -> bool {
        self.parents_held(e) && self.reached(e).all(|(x, _)| self.parents_held(x))
    }

    /// It counts (`Counts`, the one counting rule, A45): its whole past is held, everything it reaches is `fit` and
    /// `authorized` and not `revoked`, and none of it is half of a split. The docs layer supplies `fit`, avenID
    /// `authorized`, avenCAPS `revoked` (A182). Not monotone in what is held, by design: a split or a revocation
    /// learned later discounts (A4, A182).
    pub fn counts(
        &self,
        e: &Envelope,
        fit: impl Fn(&Envelope) -> bool,
        authorized: impl Fn(&Envelope) -> bool,
        revoked: impl Fn(&Envelope) -> bool,
    ) -> bool {
        let ok = |x: &Envelope| fit(x) && authorized(x) && !revoked(x);
        self.closed(e)
            && ok(e)
            && !self.split_with(e, &e.name())
            && self
                .reached(e)
                .all(|(x, n)| ok(x) && !self.split_with(x, &n))
    }

    /// `e` is in version `v`, named by its tips: a held tip of `v` reaches it (`Version.holds`).
    pub fn holds(&self, v: &[Hash], e: &Envelope) -> bool {
        let ne = e.name();
        self.envelopes.iter().zip(&self.names).any(|(t, nt)| {
            v.contains(nt) && (t == e || (self.envelopes.contains(e) && self.past(t).contains(&ne)))
        })
    }
}

/// A log as one reader holds it, read as a chain (`IsChain`): one log, from sequence number 1 up, each envelope naming
/// the one before it, the first naming none.
pub fn is_chain(c: &[Envelope]) -> bool {
    let Some(first) = c.first() else { return true };
    let mut prev = None;
    for (i, e) in c.iter().enumerate() {
        if e.doc != first.doc
            || e.branch != first.branch
            || e.writer != first.writer
            || e.seq != i as u64 + 1
        {
            return false;
        }
        if e.prev != prev {
            return false;
        }
        prev = Some(e.name());
    }
    true
}

/// Why an envelope doesn't extend a [`Log`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refused {
    /// Another Doc, branch or writer.
    OtherLog,
    /// Not the next sequence number.
    NotNext,
    /// It doesn't name the log's head as the one before it.
    WrongPrev,
    /// A different envelope at a place the log already holds: a split, final (A4).
    Split,
}

/// A writer's log: a chain ([`is_chain`]) that only grows at its head.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Log {
    id: LogId,
    chain: Vec<Envelope>,
    head: Option<Hash>,
}

impl Log {
    pub fn new(id: LogId) -> Log {
        Log {
            id,
            chain: Vec::new(),
            head: None,
        }
    }

    pub fn id(&self) -> &LogId {
        &self.id
    }

    pub fn envelopes(&self) -> &[Envelope] {
        &self.chain
    }

    /// The name of its newest envelope, which the next one names as `prev`.
    pub fn head(&self) -> Option<Hash> {
        self.head
    }

    /// The next sequence number.
    pub fn next_seq(&self) -> u64 {
        self.chain.len() as u64 + 1
    }

    /// Adds the next envelope. One it already holds adds only its signatures; another at a place it holds is a split.
    pub fn push(&mut self, e: Envelope) -> Result<(), Refused> {
        if e.log() != self.id {
            return Err(Refused::OtherLog);
        }
        if let Some(held) = e
            .seq
            .checked_sub(1)
            .and_then(|i| self.chain.get_mut(i as usize))
        {
            if held.name() != e.name() {
                return Err(Refused::Split);
            }
            // the same envelope again: its signatures join the set, which only grows (`addSig`)
            for x in e.sigs {
                held.add_sig(x);
            }
            return Ok(());
        }
        if e.seq != self.next_seq() {
            return Err(Refused::NotNext);
        }
        if e.prev != self.head {
            return Err(Refused::WrongPrev);
        }
        self.head = Some(e.name());
        self.chain.push(e);
        Ok(())
    }
}
