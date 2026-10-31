//! `aven-core`: what every part of avenDB shares, in Rust ([`README.md`](../README.md), `Aven.Core`).
//!
//! For now, Values and the one codec (`Aven.Core.Cbor`, ARCHITECTURE.md rule 1, A2): deterministic CBOR in a strict
//! profile, and the names of Values (`Aven.Core.Names`). Every answer its tests check comes from the Lean model's
//! vectors (`spec/vectors/cbor.json`, `names.json`). Other threads extend it (envelopes, logs). `no_std` with `alloc`,
//! no `unsafe`, so it builds for wasm32 with no imports.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

mod cbor;
mod names;

pub use cbor::{MAX_DEPTH, Value, decode, encode};
pub use names::{DocId, Hash, TypeId, blake3, name_of};
