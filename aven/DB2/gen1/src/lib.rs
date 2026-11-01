//! avenDB's first generation: state machines without I/O (README, rule 2). Milestone 1 holds what every peer runs to
//! say how it is, its status phase (`status`) and its timeline lines (`timeline`); milestone 2 adds the chat's messages
//! and room (`chat`); the store upgrade adds the chat's chains (`chain`) and its files (`files`). The wire and presence
//! moved to avenPEERS (`aven-peer-wire`, A45). Each machine here is modelled in `db/spec` (`Aven.DB`): `tests/vectors.rs`, `tests/chat.rs`,
//! `tests/chains.rs` and `tests/files.rs` replay its examples and generated cases, and `tests/model.rs` random traces
//! against the running model.

pub mod chain;
pub mod chat;
pub mod files;
pub mod status;
pub mod timeline;

/// The wire and presence, avenPEERS' now (`aven-peer-wire`, A45), taken back for the old chat until the cutover.
pub use aven_peer_wire::{presence, wire};
