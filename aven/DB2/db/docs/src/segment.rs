//! Segments: a writer's closed run of one log in one epoch (`Aven.DB.Docs.Segment`; docs, rules 11 and 24), held to
//! `db/spec/vectors/segments.json`.
//!
//! A segment is Core's [`Signed`] under [`SEGMENT_LABEL`], hybrid-signed by its writer, sealed as a `segment`
//! of the one seal. Its body is `{to, from, prev, branch, writer, envelopes, generation}`: `from` and `to` its
//! envelopes' sequence numbers, half-open; `prev` the name of the writer's segment before it in this log, absent from
//! a log's first segment (A200: no nulls); its
//! envelopes the same signed bytes, so their names stay. A keeper never reads them: the upload names the loose items
//! it covers by their sealed hashes, beside the segment ([`Closed::covers`]; A44).
//!
//! A [`Closer`] closes a writer's loose envelopes at whichever comes first: the limits (256 envelopes or 1 MiB), a
//! rotation of the Doc's epoch (a segment holds one epoch), or the caller's word (quiet, or the page hiding).

use aven_core::{DocId, Envelope, Hash, Signed, Value, blake3, signing_bytes};
use aven_id::{Entropy, Hybrid, HybridPublic};

use crate::device::Device;
use crate::limits::Limits;
use crate::seal::{EpochKey, Seals, open, seal};

/// What a segment is signed under.
pub const SEGMENT_LABEL: &str = "avenDB segment 1";

/// A closed segment of one Doc, in one epoch. Its Doc and epoch are outside its seal, not in its body; a plain segment
/// (the keyring's, A187) has no epoch.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Segment {
    pub doc: DocId,
    pub epoch: Option<Hash>,
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
        let prev = self.prev.as_ref().map(|h| ("prev".into(), h.value()));
        let head = [
            ("to".into(), Value::Uint(self.to)),
            ("from".into(), Value::Uint(self.from)),
        ];
        Value::Map(
            head.into_iter()
                .chain(prev)
                .chain([
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
                .collect(),
        )
    }

    /// Its name, the next segment's `prev` (`Segment.name`, A30).
    pub fn name(&self) -> Hash {
        blake3(&signing_bytes(SEGMENT_LABEL, &self.body()))
    }

    /// Read back from its body, for `doc` and `epoch`: exactly its keys, each in its form, within the limit; `prev`
    /// present but for a log's first segment, and never null (A200).
    pub fn of_body(doc: DocId, epoch: Option<Hash>, v: &Value, limits: &Limits) -> Option<Segment> {
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
        let has_prev = kvs.get(2).is_some_and(|(k, _)| k == "prev");
        let keys = KEYS.iter().filter(|k| has_prev || **k != "prev");
        if kvs.len() != keys.clone().count() || kvs.iter().zip(keys).any(|((k, _), want)| k != want)
        {
            return None;
        }
        // with `prev` left out, the keys after it sit one place earlier
        let g = |i: usize| &kvs[if has_prev || i < 2 { i } else { i - 1 }].1;
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
            prev: match (has_prev, g(2)) {
                (false, _) => None,
                (true, Value::Bytes(b)) => Some(Hash(b.as_slice().try_into().ok()?)),
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
            Some(epoch.name),
            self.epoch,
            "a segment is sealed under its own epoch"
        );
        seal(
            Seals::Segment,
            epoch,
            &self.doc,
            &self.signed(device),
            entropy,
        )
    }

    /// Signed by its writer's hybrid key, unsealed: what the seal holds, and what the keyring's segments travel as
    /// (A187).
    pub fn signed(&self, device: &Device) -> Vec<u8> {
        device
            .hybrid()
            .sign_value(SEGMENT_LABEL, self.body())
            .encode()
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
        let limit = crate::seal::sealed_limit(limits.segment_bytes);
        let (d, pt) = open(Seals::Segment, epoch, bytes, limit).ok_or(BadSegment::Seal)?;
        if d != *doc {
            return Err(BadSegment::Seal);
        }
        Segment::check(&pt, doc, Some(epoch.name), limits)
    }

    /// Checks an unsealed segment of `doc`, the keyring's (A187): its hybrid signature holds, it is one run of one log,
    /// and its signer's Ed25519 half signed every envelope in it.
    pub fn open_plain(
        bytes: &[u8],
        doc: &DocId,
        limits: &Limits,
    ) -> Result<(Segment, HybridPublic), BadSegment> {
        if bytes.len() > crate::seal::sealed_limit(limits.segment_bytes) {
            return Err(BadSegment::Form);
        }
        Segment::check(bytes, doc, None, limits)
    }

    /// A segment's signed bytes, checked: what both paths share.
    fn check(
        bytes: &[u8],
        doc: &DocId,
        epoch: Option<Hash>,
        limits: &Limits,
    ) -> Result<(Segment, HybridPublic), BadSegment> {
        let signed = Signed::decode(bytes).ok_or(BadSegment::Form)?;
        if signed.label != SEGMENT_LABEL {
            return Err(BadSegment::Form);
        }
        // hybrid-signed by its writer alone
        let [by] = signed.sigs.as_slice() else {
            return Err(BadSegment::Signature);
        };
        if !signed.valid(&Hybrid) {
            return Err(BadSegment::Signature);
        }
        let key = aven_core::decode(&by.signer)
            .and_then(|v| HybridPublic::of_value(&v))
            .ok_or(BadSegment::Signature)?;
        let s = Segment::of_body(*doc, epoch, &signed.body, limits).ok_or(BadSegment::Form)?;
        let envs = s.run(limits).ok_or(BadSegment::Run)?;
        if envs
            .iter()
            .any(|e| !e.sigs.iter().any(|x| x.signer == key.ed25519) || e.doc != *doc)
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
            epoch: Some(self.epoch?),
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
