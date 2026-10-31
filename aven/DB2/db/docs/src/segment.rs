//! Segments: a writer's closed run of one log in one epoch (docs, rules 11 and 24, "Closing a segment"; caps,
//! "Sealing"). **Provisional: no Lean yet** for its CBOR or label. A segment is a Core [`Signed`] thing under
//! [`SEGMENT_LABEL`], hybrid-signed by its writer inside the seal, whose body is
//!
//! ```text
//! { "segment": 1, "doc": h'…', "epoch": h'…', "branch": "main", "writer": 9f2c…, "generation": 0,
//!   "from": 41, "to": 297, "prev": null | h'<previous segment>', "envelopes": [ h'<envelope>' … ],
//!   "covers": [ h'<envelope name>' … ] }
//! ```
//!
//! `from` and `to` are the sequence numbers of its first and last envelope. Its envelopes are the same signed bytes,
//! so their names stay. A [`Closer`] closes a writer's loose envelopes at whichever comes first: the limits (256
//! envelopes or 1 MiB), a rotation of the Doc's epoch (a segment holds one epoch), or the caller's word (quiet, or the
//! page hiding).

use aven_core::{DocId, Envelope, Hash, Signed, Value};
use aven_id::{Entropy, Hybrid, HybridPublic};

use crate::device::Device;
use crate::limits::Limits;
use crate::seal::{EpochKey, SEGMENT_SEAL, open, seal};

/// What a segment is signed under.
pub const SEGMENT_LABEL: &str = "avenDB segment 1";

/// A closed segment, before or after its seal.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub doc: DocId,
    pub epoch: Hash,
    pub branch: String,
    pub writer: u64,
    pub generation: u64,
    pub from: u64,
    pub to: u64,
    pub prev: Option<Hash>,
    pub envelopes: Vec<Vec<u8>>,
    pub covers: Vec<Hash>,
}

/// Why a segment is refused.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum BadSegment {
    /// It doesn't open under the epoch's key, or isn't the Doc's.
    Seal,
    /// Its form, or past a limit.
    Form,
    /// Its hybrid signature, or a signer that isn't the segment's.
    Signature,
    /// Its envelopes aren't one run of one log, or `covers` isn't their names.
    Run,
}

fn uint(v: &Value) -> Option<u64> {
    match v {
        Value::Uint(n) => Some(*n),
        _ => None,
    }
}

fn hash(v: &Value) -> Option<Hash> {
    match v {
        Value::Bytes(b) => Some(Hash(b.as_slice().try_into().ok()?)),
        _ => None,
    }
}

impl Segment {
    pub fn body(&self) -> Value {
        Value::Map(vec![
            ("to".into(), Value::Uint(self.to)),
            ("doc".into(), self.doc.0.value()),
            ("from".into(), Value::Uint(self.from)),
            (
                "prev".into(),
                self.prev.as_ref().map_or(Value::Null, Hash::value),
            ),
            ("epoch".into(), self.epoch.value()),
            ("branch".into(), Value::Text(self.branch.clone())),
            (
                "covers".into(),
                Value::Array(self.covers.iter().map(Hash::value).collect()),
            ),
            ("writer".into(), Value::Uint(self.writer)),
            ("segment".into(), Value::Uint(1)),
            (
                "envelopes".into(),
                Value::Array(
                    self.envelopes
                        .iter()
                        .map(|e| Value::Bytes(e.clone()))
                        .collect(),
                ),
            ),
            ("generation".into(), Value::Uint(self.generation)),
        ])
    }

    fn of_body(v: &Value, limits: &Limits) -> Option<Segment> {
        const KEYS: [&str; 11] = [
            "to",
            "doc",
            "from",
            "prev",
            "epoch",
            "branch",
            "covers",
            "writer",
            "segment",
            "envelopes",
            "generation",
        ];
        let Value::Map(kvs) = v else { return None };
        if kvs.len() != KEYS.len() || kvs.iter().zip(KEYS).any(|((k, _), want)| k != want) {
            return None;
        }
        let g = |i: usize| &kvs[i].1;
        let (Value::Text(branch), Value::Array(covers), Value::Array(envelopes)) =
            (g(5), g(6), g(9))
        else {
            return None;
        };
        if uint(g(8))? != 1
            || envelopes.len() > limits.segment_envelopes
            || covers.len() != envelopes.len()
        {
            return None;
        }
        Some(Segment {
            to: uint(g(0))?,
            doc: DocId(hash(g(1))?),
            from: uint(g(2))?,
            prev: match g(3) {
                Value::Null => None,
                p => Some(hash(p)?),
            },
            epoch: hash(g(4))?,
            branch: branch.clone(),
            covers: covers.iter().map(hash).collect::<Option<_>>()?,
            writer: uint(g(7))?,
            envelopes: envelopes
                .iter()
                .map(|e| match e {
                    Value::Bytes(b) => Some(b.clone()),
                    _ => None,
                })
                .collect::<Option<_>>()?,
            generation: uint(g(10))?,
        })
    }

    /// Signed by its writer's hybrid key, sealed under its epoch's `avenDB segment 1` subkey.
    pub fn seal(&self, device: &Device, epoch: &EpochKey, entropy: &mut impl Entropy) -> Vec<u8> {
        assert_eq!(
            epoch.name, self.epoch,
            "a segment is sealed under its own epoch"
        );
        let signed = device.hybrid().sign_value(SEGMENT_LABEL, self.body());
        seal(SEGMENT_SEAL, epoch, &self.doc, &signed.encode(), entropy)
    }

    /// Opens and checks a sealed segment of `doc`: it opens under the epoch's key, its hybrid signature holds, its
    /// signer's Ed25519 half signed every envelope in it, its envelopes are one run of one log from `from` to `to`, and
    /// `covers` names them. Each envelope is still checked as any import checks it.
    pub fn open(
        bytes: &[u8],
        doc: &DocId,
        epoch: &EpochKey,
        limits: &Limits,
    ) -> Result<(Segment, HybridPublic), BadSegment> {
        // the seal adds its framing, its nonce and commitment, and Padmé's at most 12 %
        let limit = limits.segment_bytes + limits.segment_bytes / 8 + 256;
        let (d, pt) = open(SEGMENT_SEAL, epoch, bytes, limit).ok_or(BadSegment::Seal)?;
        if d != *doc {
            return Err(BadSegment::Seal);
        }
        let signed = Signed::decode(&pt).ok_or(BadSegment::Form)?;
        if signed.label != SEGMENT_LABEL {
            return Err(BadSegment::Form);
        }
        if !signed.valid(&Hybrid) {
            return Err(BadSegment::Signature);
        }
        let key = aven_core::decode(&signed.signer)
            .and_then(|v| HybridPublic::of_value(&v))
            .ok_or(BadSegment::Signature)?;
        let s = Segment::of_body(&signed.body, limits).ok_or(BadSegment::Form)?;
        if s.doc != *doc || s.epoch != epoch.name {
            return Err(BadSegment::Seal);
        }
        let mut prev = None;
        for (i, (bytes, name)) in s.envelopes.iter().zip(&s.covers).enumerate() {
            let e = Envelope::decode(bytes).ok_or(BadSegment::Form)?;
            if e.signer != key.ed25519 {
                return Err(BadSegment::Signature);
            }
            if e.doc != s.doc
                || e.branch != s.branch
                || e.writer != s.writer
                || e.seq != s.from + i as u64
                || e.name() != *name
                || (i > 0 && e.prev != prev)
            {
                return Err(BadSegment::Run);
            }
            prev = Some(e.name());
        }
        if s.envelopes.is_empty() || s.to != s.from + s.envelopes.len() as u64 - 1 {
            return Err(BadSegment::Run);
        }
        Ok((s, key))
    }
}

/// A writer's loose envelopes of one log, closed into segments (docs, rule 11: each writer closes its own).
#[derive(Debug)]
pub struct Closer {
    doc: DocId,
    branch: String,
    writer: u64,
    generation: u64,
    limits: Limits,
    epoch: Option<Hash>,
    loose: Vec<Envelope>,
    bytes: usize,
    prev: Option<Hash>,
}

impl Closer {
    pub fn new(doc: DocId, branch: &str, writer: u64, generation: u64, limits: Limits) -> Closer {
        Closer {
            doc,
            branch: branch.into(),
            writer,
            generation,
            limits,
            epoch: None,
            loose: vec![],
            bytes: 0,
            prev: None,
        }
    }

    /// The loose envelopes not yet in a segment.
    pub fn loose(&self) -> &[Envelope] {
        &self.loose
    }

    /// Adds the writer's next envelope, written under `epoch`. Returns the segment this closes first: the open one, when
    /// the epoch rotated or the envelope would take it past a limit.
    pub fn add(&mut self, epoch: Hash, e: Envelope) -> Option<Segment> {
        assert!(
            e.doc == self.doc && e.branch == self.branch && e.writer == self.writer,
            "one log per closer"
        );
        let size = e.encode().len();
        let mut sizes: Vec<usize> = self.loose.iter().map(|x| x.encode().len()).collect();
        sizes.push(size);
        let closed = if self.epoch.is_some_and(|x| x != epoch) || !self.limits.segment_fits(&sizes)
        {
            self.close()
        } else {
            None
        };
        self.epoch = Some(epoch);
        self.bytes += size;
        self.loose.push(e);
        closed
    }

    /// Closes the open segment, if any: the writer went quiet, or the page hides.
    pub fn close(&mut self) -> Option<Segment> {
        let (first, last) = (self.loose.first()?, self.loose.last()?);
        let s = Segment {
            doc: self.doc,
            epoch: self.epoch?,
            branch: self.branch.clone(),
            writer: self.writer,
            generation: self.generation,
            from: first.seq,
            to: last.seq,
            prev: self.prev,
            envelopes: self.loose.iter().map(Envelope::encode).collect(),
            covers: self.loose.iter().map(Envelope::name).collect(),
        };
        self.prev = Some(aven_core::name_of(&s.body()));
        self.loose.clear();
        self.bytes = 0;
        Some(s)
    }
}
