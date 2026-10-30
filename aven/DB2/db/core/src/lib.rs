//! avenDB's core: the rules for documents, caps and sync, as state machines without I/O (README, rule 2). Milestone 1
//! holds what every peer runs to say how it is: its status phase, presence, and the frames of our protocol; milestone 2
//! adds the chat's messages and room (`chat`). Each machine is modelled in `db/spec` (`Aven.DB`): `tests/vectors.rs`
//! and `tests/chat.rs` replay its examples and generated cases, and `tests/model.rs` random traces against the running
//! model.

pub mod chat;
pub mod presence;
pub mod status;
pub mod timeline;
pub mod wire;
