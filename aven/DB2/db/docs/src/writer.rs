//! The writer id, defined once (docs, rule 8, "Writer ids"; `Aven.DB.Docs.Writers`).
//!
//! `writer(device, doc, branch, generation)` is BLAKE3's key derivation under `avenDB writer 1` over the CBOR array
//! `[device's public key, the Doc's id, the branch, the generation]` (each a byte string but the generation): the first
//! of the output's four 8-byte windows, little-endian, that isn't Loro's reserved peer `2⁶⁴ - 1`, and 0 when all four
//! are (`writer_ne_reserved`).

use aven_core::{DocId, Value, encode};

/// The context of the derivation.
pub const WRITER_LABEL: &str = "avenDB writer 1";

/// The peer Loro reserves for itself; no writer id is it.
pub const RESERVED_PEER: u64 = u64::MAX;

/// `writerInput`: the canonical CBOR the writer id is derived from.
pub fn writer_input(device: &[u8], doc: &DocId, branch: &str, generation: u64) -> Vec<u8> {
    encode(&Value::Array(vec![
        Value::Bytes(device.to_vec()),
        Value::Bytes(doc.0.0.to_vec()),
        Value::Bytes(branch.as_bytes().to_vec()),
        Value::Uint(generation),
    ]))
}

/// The 32 bytes the derivation gives.
pub fn writer_derived(device: &[u8], doc: &DocId, branch: &str, generation: u64) -> [u8; 32] {
    blake3::derive_key(WRITER_LABEL, &writer_input(device, doc, branch, generation))
}

/// `writer(device, doc, branch, generation)`: the 64-bit Loro peer a device writes a branch of a Doc as.
pub fn writer(device: &[u8], doc: &DocId, branch: &str, generation: u64) -> u64 {
    let out = writer_derived(device, doc, branch, generation);
    out.as_chunks::<8>()
        .0
        .iter()
        .map(|w| u64::from_le_bytes(*w))
        .find(|&w| w != RESERVED_PEER)
        .unwrap_or(0)
}
