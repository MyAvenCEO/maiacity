//! `aven-core`: what every part of avenDB shares, in Rust ([`README.md`](../README.md), `Aven.Core`).
//!
//! Values and the one codec (`Aven.Core.Cbor`, ARCHITECTURE.md rule 1, A2): deterministic CBOR in a strict profile;
//! the names of Values (`Aven.Core.Names`); signed things (`Aven.Core.Signed`, A30); envelopes, logs, splits and
//! versions (`Aven.Core.Log`, A3, A4); the past (`Aven.Core.Past`); ops, bounds and calls (`Aven.Core.Op`, A32); and
//! targets in their CBOR (`Aven.Core.Target`, `Aven.Core.TargetCbor`, A8). Every answer its tests check comes from
//! the Lean model's vectors (`spec/vectors`) or from the running model (`aven-core-model`) on random inputs.
//! Signatures are checked through [`Verify`], a parameter as in the Lean: aven-core holds no keys. Every input has a
//! limit ([`limits`], rule 10). `no_std` with `alloc`, no `unsafe`, so it builds for wasm32 with no imports.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

mod cbor;
pub mod limits;
mod log;
mod names;
mod op;
pub mod past;
mod signed;
mod target;

pub use cbor::{MAX_DEPTH, Value, decode, encode};
pub use log::{ENVELOPE_LABEL, Envelope, Held, Log, LogId, Refused, is_chain, split};
pub use names::{DocId, Hash, TypeId, blake3, name_of};
pub use op::{Bound, Call, CoreOp, OpId, type_of_types};
pub use past::Parents;
pub use signed::{Sig, Signed, Verify, add_sig, signing_bytes, sigs_ok};
pub use target::{Facts, Reach, Step, StepVerb, Target};
