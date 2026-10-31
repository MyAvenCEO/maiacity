//! `aven-codec`: the one codec and the names of what it encodes, in Rust (`Aven.Core.Cbor`, `Aven.Core.Names`;
//! ARCHITECTURE.md rule 1, A2).
//!
//! Values in deterministic CBOR's strict profile, `encode` and `decode`, nothing deeper than [`MAX_DEPTH`]; and BLAKE3
//! names, Doc ids and type ids. A crate of its own so what compiles only these, such as the runtimes' frozen wasm
//! modules, moves only when they do: the rest of Core (envelopes, logs, ops, targets) lives in `aven-core`, which
//! re-exports all of this, so nobody's imports change. Held to `core/spec/vectors/cbor.json` and `names.json` by
//! aven-core's tests. `no_std` with `alloc`, no `unsafe`, so it builds for wasm32 with no imports.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

mod cbor;
mod names;

pub use cbor::{MAX_DEPTH, Value, decode, encode};
pub use names::{DocId, Hash, TypeId, blake3, name_of};
