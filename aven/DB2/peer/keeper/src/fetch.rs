//! The fetch gate (`Aven.Peer.Fetch`): sealed bytes only to a connection that proved their Doc, on our own ALPN, since a
//! fetch proof signs the TLS exporter of the connection that serves. One gate for a keeper's catch-up by number and a
//! reader's by version.
//!
//! - [`answer`]: a `fetch {doc, hashes}` of at most [`FETCH_HASHES`], on a connection that proved `doc`: each hash held
//!   *for that Doc* is served, in the order asked, while the bytes beyond the first item stay within [`IN_FLIGHT`];
//!   from the first that doesn't fit on, the rest held are `later`; a hash not held for that Doc is `missing`, never
//!   served from another Doc. The caller's `held` looks a hash up in its hash→Doc map for the Doc asked.
//! - [`parts`]: an item in parts of at most [`PART_BYTES`] at consecutive offsets, so every frame stays under the
//!   wire's 64 KiB.
//! - [`Assembly`]: the receiver puts parts back together and stores the item only if its bytes hash to what it asked
//!   for (`stored_checked`); otherwise it drops them and notes the sender.

use aven_core::{Value, signing_bytes};

/// The label a fetch proof signs under.
pub const FETCH_LABEL: &str = "avenDB fetch 1";
/// The TLS exporter a fetch proof signs: this label (RFC 5705's prefix), an empty context, and this many bytes, the
/// same at both ends of one connection and different on every other.
pub const EXPORTER_LABEL: &[u8] = b"EXPORTER-avenDB-fetch-1";
pub const EXPORTER_LEN: usize = 32;

/// What a device signs with a Doc's fetch key to prove it on a connection: `["avenDB fetch 1", {doc, exporter}]`
/// (`proofBytes`). Whether the key is the Doc's current one is avenID's gate.
pub fn proof_bytes(doc: &[u8; 32], exporter: &[u8; EXPORTER_LEN]) -> Vec<u8> {
    signing_bytes(
        FETCH_LABEL,
        &Value::Map(vec![
            ("doc".into(), Value::Bytes(doc.to_vec())),
            ("exporter".into(), Value::Bytes(exporter.to_vec())),
        ]),
    )
}

/// The most hashes in one `fetch`.
pub const FETCH_HASHES: usize = 128;
/// The most bytes of an item in one `items` frame.
pub const PART_BYTES: usize = 48 * 1024;
/// The most bytes of items one `fetch` is answered with, beyond its first item.
pub const IN_FLIGHT: u64 = 1024 * 1024;

/// The answer to one `fetch`: the hashes to serve, in order, those missing for the Doc asked, and those deferred.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Answer<H> {
    pub served: Vec<H>,
    pub missing: Vec<H>,
    pub later: Vec<H>,
}

/// The gate's answer to `fetch {doc, hashes}`: `None` (refused) for a Doc not proven on this connection or too many
/// hashes. `held(h)` is the length of `h`'s bytes if the peer holds it for the Doc asked.
pub fn answer<H: Clone>(
    proven: bool,
    hashes: &[H],
    held: impl Fn(&H) -> Option<u64>,
) -> Option<Answer<H>> {
    if !proven || hashes.len() > FETCH_HASHES {
        return None;
    }
    let mut a = Answer {
        served: Vec::new(),
        missing: Vec::new(),
        later: Vec::new(),
    };
    // after the first that doesn't fit, the room is gone: what follows waits (`serveFrom`)
    let (mut first, mut room) = (true, IN_FLIGHT);
    for h in hashes {
        match held(h) {
            None => a.missing.push(h.clone()),
            Some(len) if first || (len <= room && room > 0) => {
                room -= len.min(room);
                first = false;
                a.served.push(h.clone());
            }
            Some(_) => {
                (first, room) = (false, 0);
                a.later.push(h.clone());
            }
        }
    }
    Some(a)
}

/// A part of an item: its offset, the item's whole length, and the bytes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Part<'a> {
    pub at: u64,
    pub total: u64,
    pub bytes: &'a [u8],
}

/// An item in parts of at most [`PART_BYTES`]; an empty item is one empty part.
pub fn parts(bytes: &[u8]) -> Vec<Part<'_>> {
    let total = bytes.len() as u64;
    if bytes.is_empty() {
        return vec![Part {
            at: 0,
            total,
            bytes,
        }];
    }
    bytes
        .chunks(PART_BYTES)
        .enumerate()
        .map(|(i, b)| Part {
            at: (i * PART_BYTES) as u64,
            total,
            bytes: b,
        })
        .collect()
}

/// Why a receiver dropped an item.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dropped {
    /// a part not at the next offset, or naming another length, or past the end
    Out,
    /// the bytes don't hash to what was asked for
    Hash,
}

/// An item being put back together from its parts.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Assembly {
    total: Option<u64>,
    bytes: Vec<u8>,
}

impl Assembly {
    /// Adds the next part. `Ok(true)` once the item is whole.
    pub fn add(&mut self, p: Part<'_>) -> Result<bool, Dropped> {
        let total = *self.total.get_or_insert(p.total);
        let end = p.at.checked_add(p.bytes.len() as u64).ok_or(Dropped::Out)?;
        if total != p.total
            || p.at != self.bytes.len() as u64
            || end > total
            || p.bytes.len() > PART_BYTES
        {
            return Err(Dropped::Out);
        }
        self.bytes.extend_from_slice(p.bytes);
        Ok(end == total)
    }

    /// The whole item, if its bytes hash to `asked` (`stored_checked`).
    pub fn finish<H: PartialEq>(
        self,
        asked: &H,
        hash: impl Fn(&[u8]) -> H,
    ) -> Result<Vec<u8>, Dropped> {
        if self.total != Some(self.bytes.len() as u64) {
            return Err(Dropped::Out);
        }
        if hash(&self.bytes) != *asked {
            return Err(Dropped::Hash);
        }
        Ok(self.bytes)
    }
}
