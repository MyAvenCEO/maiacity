//! Every input has a limit before Loro sees it (docs, rule 24; ARCHITECTURE.md rule 10; `Aven.DB.Docs.Limits`).
//!
//! An envelope is measured in the order a reader imports it: first its sealed bytes as they arrive, before anything is
//! opened or decoded ([`capped`]); then, once decoded, its CBOR's depth, its fan-out, the Records it touches and its
//! ops ([`Limits::admits`]). A segment closes before 256 envelopes or 1 MiB ([`Limits::segment_fits`]).

use aven_core::Value;

/// The limits, each checked before the next step spends memory on what it measures (`Limits`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// an envelope's sealed bytes
    pub sealed: usize,
    /// nesting of its CBOR
    pub depth: usize,
    /// the envelopes it names in `deps`
    pub fanout: usize,
    /// the Records it touches
    pub records: usize,
    /// its Loro ops
    pub ops: usize,
    /// envelopes in a segment
    pub segment_envelopes: usize,
    /// a segment's sealed bytes
    pub segment_bytes: usize,
    /// a blob's declared size
    pub blob: u64,
}

impl Limits {
    /// `Limits.defaults`: 1 MiB sealed, depth 256, a segment of 256 envelopes or 1 MiB.
    pub const DEFAULTS: Limits = Limits {
        sealed: 1024 * 1024,
        depth: 256,
        fanout: 256,
        records: 4096,
        ops: 65536,
        segment_envelopes: 256,
        segment_bytes: 1024 * 1024,
        blob: 4 * 1024 * 1024 * 1024,
    };

    /// `admits`: a decoded envelope's body depth, fan-out, Records touched and ops, each within its limit.
    pub fn admits(&self, body: &Value, deps: usize, records: usize, ops: usize) -> bool {
        depth(body) <= self.depth
            && deps <= self.fanout
            && records <= self.records
            && ops <= self.ops
    }

    /// `segmentFits`: a segment of envelopes of these sealed sizes is within both of its limits.
    pub fn segment_fits(&self, sizes: &[usize]) -> bool {
        sizes.len() <= self.segment_envelopes
            && sizes
                .iter()
                .try_fold(0usize, |a, s| a.checked_add(*s))
                .is_some_and(|t| t <= self.segment_bytes)
    }

    /// `fetchBlob`: a blob is fetched only when its declared size is within the limit.
    pub fn fetch_blob(&self, declared: u64) -> bool {
        declared <= self.blob
    }
}

impl Default for Limits {
    fn default() -> Limits {
        Limits::DEFAULTS
    }
}

/// How deeply a Value nests: arrays and maps add one (`depth`). Iterative, so a deep Value can't exhaust the stack.
pub fn depth(v: &Value) -> usize {
    let mut deepest = 0;
    let mut todo = vec![(v, 0usize)];
    while let Some((v, d)) = todo.pop() {
        match v {
            Value::Array(xs) => todo.extend(xs.iter().map(|x| (x, d + 1))),
            Value::Map(kvs) => todo.extend(kvs.iter().map(|(_, x)| (x, d + 1))),
            _ => {}
        }
        let here = match v {
            Value::Array(_) | Value::Map(_) => d + 1,
            _ => d,
        };
        deepest = deepest.max(here);
    }
    deepest
}

/// Read chunks into a buffer, refusing (`None`) as soon as the buffer would pass the limit: nothing after that is
/// kept (`capped`). It never holds more than the limit plus the chunk it was offered (`capped_holds`).
pub fn capped<'a>(limit: usize, chunks: impl IntoIterator<Item = &'a [u8]>) -> Option<Vec<u8>> {
    let mut buf = Vec::new();
    for c in chunks {
        if buf.len().checked_add(c.len())? > limit {
            return None;
        }
        buf.extend_from_slice(c);
    }
    Some(buf)
}
