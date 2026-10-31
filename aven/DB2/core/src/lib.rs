//! `aven-core`: what every part of avenDB shares, in Rust ([`README.md`](../README.md), `Aven.Core`).
//!
//! Values and the one codec (`Aven.Core.Cbor`, ARCHITECTURE.md rule 1, A2): deterministic CBOR in a strict profile;
//! the names of Values (`Aven.Core.Names`); signed things (`Aven.Core.Signed`, A30); envelopes, logs, splits and
//! versions (`Aven.Core.Log`, A3, A4); and the past (`Aven.Core.Past`). Every answer its tests check comes from the Lean
//! model's vectors (`spec/vectors/cbor.json`, `names.json`, `envelopes.json`, `logs.json`) or from the model's
//! definitions run on random inputs. Signatures are checked through [`Verify`], a parameter as in the Lean: aven-core
//! holds no keys. Every input has a limit ([`limits`], rule 10). `no_std` with `alloc`, no `unsafe`, so it builds for
//! wasm32 with no imports.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

mod cbor;
pub mod limits;
mod log;
mod names;
pub mod past;
mod signed;

pub use cbor::{MAX_DEPTH, Value, decode, encode};
pub use log::{ENVELOPE_LABEL, Envelope, Held, Log, LogId, Refused, is_chain, split};
pub use names::{DocId, Hash, TypeId, blake3, name_of};
pub use past::Parents;
pub use signed::{Signed, Verify, signing_bytes};
