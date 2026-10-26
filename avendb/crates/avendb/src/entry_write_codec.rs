//! A write's public fields on the wire inside an owner's judged entry base (`entry_judgment`), each list of links
//! bounded before it is read.
use super::*;
use crate::policy::Write;
use crate::wire::Decode;

const MAX_LINKS: usize = 64;

pub(super) fn encode_write(w: &Write, out: &mut Vec<u8>) {
    w.edit.encode(out); w.author.encode(out); w.actor.encode(out); w.entry.encode(out);
    w.stay.encode(out); w.epoch.encode(out); w.deps.encode(out); w.proposal.encode(out);
    w.via.encode(out); w.first.encode(out); w.audience.encode(out); w.shares.encode(out);
}
// Enforce each count BEFORE allocation/decoding, not after reading an unbounded vector.
fn links<T: Decode>(r: &mut WireReader<'_>) -> Option<Vec<T>> {
    let count = r.count(32).ok()?;
    if count > MAX_LINKS { return None; }
    (0..count).map(|_| T::decode(r).ok()).collect()
}
pub(super) fn decode_write(r: &mut WireReader<'_>) -> Option<Write> {
    Some(Write {
        edit: Decode::decode(r).ok()?, author: Decode::decode(r).ok()?,
        actor: Decode::decode(r).ok()?, entry: Decode::decode(r).ok()?,
        stay: r.option().ok()?, epoch: Decode::decode(r).ok()?, deps: links(r)?,
        proposal: Decode::decode(r).ok()?, via: links(r)?, first: Decode::decode(r).ok()?,
        audience: Decode::decode(r).ok()?, shares: links(r)?,
    })
}
