//! `aven-core`: what every part of avenDB shares, in Rust ([`README.md`](../README.md), `Aven.Core`).
//!
//! Values and the one codec (`Aven.Core.Cbor`, ARCHITECTURE.md rule 1, A2): deterministic CBOR in a strict profile;
//! the names of Values (`Aven.Core.Names`), both from [`aven_codec`], re-exported here; signed things (`Aven.Core.Signed`, A30); envelopes, logs, splits and
//! versions (`Aven.Core.Log`, A3, A4); the past (`Aven.Core.Past`); ops, bounds and calls (`Aven.Core.Op`, A32); and
//! targets in their CBOR (`Aven.Core.Target`, `Aven.Core.TargetCbor`, A8). Every answer its tests check comes from
//! the Lean model's vectors (`spec/vectors`) or from the running model (`aven-core-model`) on random inputs.
//! Signatures are checked through [`Verify`], a parameter as in the Lean: aven-core holds no keys. Every input has a
//! limit ([`limits`], rule 10). `no_std` with `alloc`, no `unsafe`, so it builds for wasm32 with no imports.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

pub mod limits;
mod log;
mod op;
pub mod past;
mod signed;
mod target;

pub use aven_codec::{DocId, Hash, MAX_DEPTH, TypeId, Value, blake3, decode, encode, name_of};
pub use log::{ENVELOPE_LABEL, Envelope, Held, Log, LogId, Refused, Writes, is_chain, split};
pub use op::{
    Bound, Call, CoreOp, FIELDS_PARAM, NO_VAULT, OpId, TYPE_PARAM, builtin_type, op_id, stored_op,
    type_of_types,
};
pub use past::Parents;
pub use signed::{
    Sig, Signed, Verify, add_sig, signing_bytes, sigs_of, sigs_ok, sigs_value, sigs_within,
};
pub use target::{Facts, Reach, Step, StepVerb, Target};
