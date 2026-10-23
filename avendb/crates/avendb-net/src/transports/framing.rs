//! Datagram framing below iroh's authenticated QUIC. Lost fragments are dropped; QUIC retransmits.
//! The epoch belongs to one authenticated route negotiation, never a restored device or a new carrier.
use std::collections::{BTreeMap, BTreeSet};
use std::io;
use n0_future::time::{Duration, Instant};

pub(super) const HEADER: usize = 36;
pub(super) const MAX_PACKET: usize = 16 << 10;
const MAX_PARTIAL: usize = 32;
const MAX_BYTES: usize = 256 << 10;
const MAX_FRAGMENTS: usize = 128;
const LIFETIME: Duration = Duration::from_secs(2);
const REPLAY_WINDOW: u64 = 256;

pub(super) fn encode(epoch: &[u8; 16], number: u64, packet: &[u8], mtu: usize) -> io::Result<Vec<Vec<u8>>> {
    if !(256..=65535).contains(&mtu) || packet.is_empty() || packet.len() > MAX_PACKET {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid carrier datagram size"));
    }
    let chunk = mtu - HEADER;
    let mut out = Vec::with_capacity(packet.len().div_ceil(chunk));
    for (index, piece) in packet.chunks(chunk).enumerate() {
        let mut frame = Vec::with_capacity(HEADER + piece.len());
        frame.extend_from_slice(b"AVP1");
        frame.extend_from_slice(epoch);
        frame.extend_from_slice(&number.to_be_bytes());
        frame.extend_from_slice(&(packet.len() as u32).to_be_bytes());
        frame.extend_from_slice(&((index * chunk) as u32).to_be_bytes());
        frame.extend_from_slice(piece);
        out.push(frame);
    }
    Ok(out)
}

#[derive(Debug)]
struct Partial {
    since: Instant,
    total: usize,
    bytes: usize,
    pieces: BTreeMap<usize, Vec<u8>>,
}

#[derive(Debug)]
pub(super) struct Reassembly {
    epoch: [u8; 16],
    partial: BTreeMap<u64, Partial>,
    bytes: usize,
    seen: BTreeSet<u64>,
    newest: u64,
}

impl Reassembly {
    pub(super) fn new(epoch: [u8; 16]) -> Self {
        Self { epoch, partial: BTreeMap::new(), bytes: 0, seen: BTreeSet::new(), newest: 0 }
    }

    fn finish(&mut self, number: u64) -> Option<Partial> {
        let old = self.partial.remove(&number);
        if let Some(old) = &old { self.bytes -= old.bytes; }
        self.newest = self.newest.max(number);
        self.seen.insert(number);
        self.seen.retain(|n| *n >= self.newest.saturating_sub(REPLAY_WINDOW));
        old
    }

    pub(super) fn expire(&mut self, now: Instant) {
        let expired: Vec<_> = self.partial.iter().filter_map(|(&n, p)|
            (now.saturating_duration_since(p.since) >= LIFETIME || n < self.newest.saturating_sub(REPLAY_WINDOW)).then_some(n)).collect();
        for number in expired { self.finish(number); }
    }

    pub(super) fn receive(&mut self, frame: &[u8], now: Instant) -> Option<Vec<u8>> {
        self.expire(now);
        if frame.len() <= HEADER || &frame[..4] != b"AVP1" || frame[4..20] != self.epoch { return None; }
        let number = u64::from_be_bytes(frame[20..28].try_into().ok()?);
        if self.seen.contains(&number) || number < self.newest.saturating_sub(REPLAY_WINDOW) { return None; }
        let total = u32::from_be_bytes(frame[28..32].try_into().ok()?) as usize;
        let offset = u32::from_be_bytes(frame[32..36].try_into().ok()?) as usize;
        let bytes = &frame[HEADER..];
        if total == 0 || total > MAX_PACKET || offset >= total || bytes.len() > total - offset { return None; }
        if !self.partial.contains_key(&number) {
            if self.partial.len() >= MAX_PARTIAL { return None; }
            self.partial.insert(number, Partial { since: now, total, bytes: 0, pieces: BTreeMap::new() });
        }
        let p = self.partial.get_mut(&number)?;
        if p.total != total { self.finish(number); return None; }
        if let Some(old) = p.pieces.get(&offset) {
            if old != bytes { self.finish(number); }
            return None;
        }
        // Different offsets must not overlap; do not let conflicting fragments choose the reconstructed bytes.
        let overlap = p.pieces.range(..offset).next_back().is_some_and(|(&at, b)| at + b.len() > offset)
            || p.pieces.range(offset..).next().is_some_and(|(&at, _)| at < offset + bytes.len());
        if overlap || p.pieces.len() >= MAX_FRAGMENTS { self.finish(number); return None; }
        if self.bytes + bytes.len() > MAX_BYTES { return None; }
        p.pieces.insert(offset, bytes.to_vec());
        p.bytes += bytes.len();
        self.bytes += bytes.len();
        if p.bytes != p.total { return None; }
        let p = self.finish(number)?;
        let mut out = Vec::with_capacity(p.total);
        for (offset, bytes) in p.pieces {
            if out.len() != offset { return None; }
            out.extend_from_slice(&bytes);
        }
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fragments_reorder_duplicate_and_keep_exact_packet_boundaries() {
        let now = Instant::now();
        for mtu in [256, 1200, 1500, 65535] {
            for size in [1, 1200, 1452, MAX_PACKET] {
                let data: Vec<_> = (0..size).map(|i| i as u8).collect();
                let frames = encode(&[7; 16], 3, &data, mtu).unwrap();
                assert!(frames.iter().all(|f| f.len() <= mtu));
                let mut r = Reassembly::new([7; 16]);
                let mut outputs = Vec::new();
                for f in frames.iter().rev() {
                    if let Some(v) = r.receive(f, now) { outputs.push(v); }
                    assert!(r.receive(f, now).is_none());
                }
                assert_eq!(outputs, vec![data]);
                assert_eq!(r.bytes, 0);
            }
        }
    }

    #[test]
    fn stale_truncated_conflicting_and_dropped_fragments_cannot_publish() {
        let now = Instant::now();
        let frames = encode(&[7; 16], 1, &[4; 1200], 256).unwrap();
        let mut r = Reassembly::new([8; 16]);
        for f in &frames { assert!(r.receive(f, now).is_none()); }
        let mut r = Reassembly::new([7; 16]);
        for len in 0..HEADER { assert!(r.receive(&frames[0][..len], now).is_none()); }
        assert!(r.receive(&frames[0], now).is_none());
        let mut conflict = frames[0].clone(); conflict[HEADER] ^= 1;
        assert!(r.receive(&conflict, now).is_none());
        for f in &frames { assert!(r.receive(f, now).is_none()); }
        assert_eq!(r.bytes, 0);
        let frames = encode(&[7; 16], 2, &[4; 1200], 256).unwrap();
        r.receive(&frames[0], now);
        for f in frames.iter().skip(1) { assert!(r.receive(f, now + LIFETIME).is_none()); }
        assert_eq!(r.bytes, 0);
    }

    #[test]
    fn claimed_lengths_overlap_and_partial_flood_stay_bounded() {
        let now = Instant::now();
        let mut r = Reassembly::new([7; 16]);
        let mut bad = encode(&[7; 16], 0, &[4; 1200], 256).unwrap().remove(0);
        bad[28..32].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(r.receive(&bad, now).is_none()); assert_eq!(r.bytes, 0);
        for n in 1..1000 {
            let frames = encode(&[7; 16], n, &[4; MAX_PACKET], 1200).unwrap();
            for f in frames.iter().take(10) { assert!(r.receive(f, now).is_none()); }
            assert!(r.partial.len() <= MAX_PARTIAL); assert!(r.bytes <= MAX_BYTES);
        }
        r.expire(now + LIFETIME); assert_eq!(r.bytes, 0); assert!(r.partial.is_empty());
        let mut r = Reassembly::new([7; 16]);
        let frames = encode(&[7; 16], 1, &[4; 1200], 256).unwrap();
        r.receive(&frames[0], now);
        let mut overlap = frames[1].clone(); overlap[32..36].copy_from_slice(&1u32.to_be_bytes());
        assert!(r.receive(&overlap, now).is_none()); assert_eq!(r.bytes, 0);
        for f in &frames { assert!(r.receive(f, now).is_none()); }
    }
}
