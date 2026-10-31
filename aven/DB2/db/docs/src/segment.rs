//! Segments: a writer's closed run of one log in one epoch (`Aven.DB.Docs.Segment`; docs, rules 11 and 24), held to
//! `db/spec/vectors/segments.json`.
//!
//! A segment is Core's [`Signed`] under [`SEGMENT_LABEL`], hybrid-signed by its writer, sealed with the `segment` kind
//! of the one seal. Its body is `{to, from, prev, branch, writer, envelopes, generation}`: `from` and `to` its
//! envelopes' sequence numbers, half-open; `prev` the name of the writer's segment before it in this log; its
//! envelopes the same signed bytes, so their names stay. A keeper never reads them: the upload names the loose items
//! it covers by their sealed hashes, beside the segment ([`Closed::covers`]; A44).
//!
//! A [`Closer`] closes a writer's loose envelopes at whichever comes first: the limits (256 envelopes or 1 MiB), a
//! rotation of the Doc's epoch (a segment holds one epoch), or the caller's word (quiet, or the page hiding).

use aven_core::{DocId, Envelope, Hash, Signed, Value, blake3, signing_bytes};
use aven_id::{Entropy, Hybrid, HybridPublic};

use crate::device::Device;
use crate::limits::Limits;
use crate::seal::{EpochKey, Kind, open, seal};

/// What a segment is signed under.
pub const SEGMENT_LABEL: &str = "avenDB segment 1";

/// A closed segment of one Doc, in one epoch. Its Doc and epoch are outside its seal, not in its body.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub doc: DocId,
    pub epoch: Hash,
    pub branch: String,
    pub writer: u64,
    pub generation: u64,
    /// Its first envelope's sequence number.
    pub from: u64,
    /// The next segment's first: half-open.
    pub to: u64,
    pub prev: Option<Hash>,
    pub envelopes: Vec<Vec<u8>>,
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
    /// Its envelopes aren't one run of one log from `from` to `to` (`Segment.ok`).
    Run,
}

fn uint(v: &Value) -> Option<u64> {
    match v {
        Value::Uint(n) => Some(*n),
        _ => None,
    }
}

impl Segment {
    /// The body its writer signs (`Segment.value`).
    pub fn body(&self) -> Value {
        Value::Map(vec![
            ("to".into(), Value::Uint(self.to)),
            ("from".into(), Value::Uint(self.from)),
            (
                "prev".into(),
                self.prev.as_ref().map_or(Value::Null, Hash::value),
            ),
            ("branch".into(), Value::Text(self.branch.clone())),
            ("writer".into(), Value::Uint(self.writer)),
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

    /// Its name, the next segment's `prev` (`Segment.name`, A30).
    pub fn name(&self) -> Hash {
        blake3(&signing_bytes(SEGMENT_LABEL, &self.body()))
    }

    /// Read back from its body, for `doc` and `epoch`: exactly its keys, each in its form, within the limit.
    pub fn of_body(doc: DocId, epoch: Hash, v: &Value, limits: &Limits) -> Option<Segment> {
        const KEYS: [&str; 7] = [
            "to",
            "from",
            "prev",
            "branch",
            "writer",
            "envelopes",
            "generation",
        ];
        let Value::Map(kvs) = v else { return None };
        if kvs.len() != KEYS.len() || kvs.iter().zip(KEYS).any(|((k, _), want)| k != want) {
            return None;
        }
        let g = |i: usize| &kvs[i].1;
        let (Value::Text(branch), Value::Array(envelopes)) = (g(3), g(5)) else {
            return None;
        };
        if envelopes.len() > limits.segment_envelopes {
            return None;
        }
        Some(Segment {
            doc,
            epoch,
            to: uint(g(0))?,
            from: uint(g(1))?,
            prev: match g(2) {
                Value::Null => None,
                Value::Bytes(b) => Some(Hash(b.as_slice().try_into().ok()?)),
                _ => return None,
            },
            branch: branch.clone(),
            writer: uint(g(4))?,
            envelopes: envelopes
                .iter()
                .map(|e| match e {
                    Value::Bytes(b) => Some(b.clone()),
                    _ => None,
                })
                .collect::<Option<_>>()?,
            generation: uint(g(6))?,
        })
    }

    /// `Segment.ok`: not empty, within the limit, `to` past its last, and one run of its log from `from`, each envelope
    /// naming the one before. Returns the envelopes decoded.
    pub fn run(&self, limits: &Limits) -> Option<Vec<Envelope>> {
        if self.envelopes.is_empty()
            || self.envelopes.len() > limits.segment_envelopes
            || self.to != self.from.checked_add(self.envelopes.len() as u64)?
        {
            return None;
        }
        let mut prev: Option<Hash> = None;
        let mut out = Vec::with_capacity(self.envelopes.len());
        for (i, bytes) in self.envelopes.iter().enumerate() {
            let e = Envelope::decode(bytes)?;
            let seq = self.from + i as u64;
            if e.branch != self.branch
                || e.writer != self.writer
                || e.seq != seq
                || !(seq == 1 || e.prev == prev || prev.is_none())
            {
                return None;
            }
            prev = Some(e.name());
            out.push(e);
        }
        Some(out)
    }

    /// Signed by its writer's hybrid key, sealed as a `segment` under its epoch.
    pub fn seal(&self, device: &Device, epoch: &EpochKey, entropy: &mut impl Entropy) -> Vec<u8> {
        assert_eq!(
            epoch.name, self.epoch,
            "a segment is sealed under its own epoch"
        );
        let signed = device.hybrid().sign_value(SEGMENT_LABEL, self.body());
        seal(Kind::Segment, epoch, &self.doc, &signed.encode(), entropy)
    }

    /// Opens and checks a sealed segment of `doc`: it opens under the epoch's key, its hybrid signature holds, it is
    /// one run of one log, and its signer's Ed25519 half signed every envelope in it. Each envelope is still checked
    /// as any import checks it.
    pub fn open(
        bytes: &[u8],
        doc: &DocId,
        epoch: &EpochKey,
        limits: &Limits,
    ) -> Result<(Segment, HybridPublic), BadSegment> {
        // the seal adds its framing, its nonce and commitment, and Padmé's at most an eighth
        let limit = limits.segment_bytes + limits.segment_bytes / 8 + 256;
        let (d, pt) = open(Kind::Segment, epoch, bytes, limit).ok_or(BadSegment::Seal)?;
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
        let s = Segment::of_body(*doc, epoch.name, &signed.body, limits).ok_or(BadSegment::Form)?;
        let envs = s.run(limits).ok_or(BadSegment::Run)?;
        if envs
            .iter()
            .any(|e| e.signer != key.ed25519 || e.doc != *doc)
        {
            return Err(BadSegment::Signature);
        }
        Ok((s, key))
    }
}

/// A closed segment, and the loose envelopes it replaces as the writer uploaded them: the hashes of their sealed bytes.
/// `covers` travels beside the sealed segment, never inside it: a keeper drops loose envelopes only by its uploader's
/// covers, and only that uploader's own (A44, `Aven.Peer.Keeper`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Closed {
    pub segment: Segment,
    pub covers: Vec<Hash>,
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
    /// The hash of each loose envelope's sealed bytes, as it was uploaded.
    sealed: Vec<Hash>,
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
            sealed: vec![],
            prev: None,
        }
    }

    /// The loose envelopes not yet in a segment.
    pub fn loose(&self) -> &[Envelope] {
        &self.loose
    }

    /// Adds the writer's next envelope, written under `epoch` and uploaded loose as sealed bytes whose hash is `sealed`.
    /// Returns the segment this closes first: the open one, when the epoch rotated or the envelope would take it past a
    /// limit.
    pub fn add(&mut self, epoch: Hash, e: Envelope, sealed: Hash) -> Option<Closed> {
        assert!(
            e.doc == self.doc && e.branch == self.branch && e.writer == self.writer,
            "one log per closer"
        );
        let mut sizes: Vec<usize> = self.loose.iter().map(|x| x.encode().len()).collect();
        sizes.push(e.encode().len());
        let closed = if self.epoch.is_some_and(|x| x != epoch) || !self.limits.segment_fits(&sizes)
        {
            self.close()
        } else {
            None
        };
        self.epoch = Some(epoch);
        self.loose.push(e);
        self.sealed.push(sealed);
        closed
    }

    /// Closes the open segment, if any: the writer went quiet, or the page hides.
    pub fn close(&mut self) -> Option<Closed> {
        let first = self.loose.first()?;
        let s = Segment {
            doc: self.doc,
            epoch: self.epoch?,
            branch: self.branch.clone(),
            writer: self.writer,
            generation: self.generation,
            from: first.seq,
            to: first.seq + self.loose.len() as u64,
            prev: self.prev,
            envelopes: self.loose.iter().map(Envelope::encode).collect(),
        };
        self.prev = Some(s.name());
        self.loose.clear();
        Some(Closed {
            segment: s,
            covers: std::mem::take(&mut self.sealed),
        })
    }
}
