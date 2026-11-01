//! avenPEERS' wire (A45): the protocol every peer speaks on `aven/db/1`, its greeting and its frames in Core's CBOR
//! (`wire`), and presence as the Aven Peer counts it (`presence`), as state machines without I/O (README, rule 2).
//! Each is modelled in `peer/spec` (`Aven.Peer`): `tests/vectors.rs` replays its examples and generated cases, and
//! `tests/model.rs` random presence traces against the running model. The first generation (`aven-gen1`) takes them
//! back from here for the old chat until the cutover.

pub mod presence;
pub mod wire;
