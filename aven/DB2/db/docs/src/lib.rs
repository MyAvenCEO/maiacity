//! `aven-db-docs`: avenDB's docs layer, step 1 (`db/docs/README.md`, "Order of work"; `Aven.DB.Docs`; ARCHITECTURE.md
//! A43): Loro Docs, the layer the network tree and a fresh chat stand on.
//!
//! - [`Genesis`]: a Doc's typed birth (A39); its id is the genesis's name.
//! - [`writer`]: the writer id, defined once (`Aven.DB.Docs.Writers`), held to `writers.json`.
//! - [`Body`]: what a docs envelope carries inside Core's envelope; [`Device`] signs it.
//! - [`ops_agree`]: rule 7, op ids against hashes (`Aven.DB.Docs.OpIds`), held to `envelopes.json`.
//! - [`Doc`]: the head, snapshot reads, the change feed, `commit`, and import with its three verdicts: fit for the
//!   built-in types ([`fit`], `Aven.DB.Docs.Fit`), authorized through [`Authorize`] (caps implements it), and not a
//!   split; what counts is held to `logs.json` and `counts.json` (`Aven.DB.Docs.Counts`).
//! - [`Segment`] and [`Closer`]: segments closed per writer and epoch, hybrid-signed inside an XChaCha20-Poly1305 seal
//!   with a key commitment ([`seal`]).
//! - [`Limits`]: every input bounded before Loro sees it (`Aven.DB.Docs.Limits`).
//!
//! Catch-up, checkpoints and period streams are the next step.
//!
//! **Provisional, no Lean yet** (reported to the architect, who has Lean come first): the genesis's CBOR, the docs
//! body's keys, the segment's CBOR and seal, the head's CBOR, the root map's name, the built-in types' ids and schemas,
//! and rule 7 read in Loro's terms ([`carried_deps`]). Each is one module, so the Lean's format replaces it in place.

#![forbid(unsafe_code)]

mod body;
mod device;
mod doc;
pub mod fit;
mod genesis;
pub mod limits;
mod opids;
pub mod schema;
pub mod seal;
mod segment;
mod value;
mod writer;

pub use body::{BODY_VERSION, Body};
pub use device::{Device, Ed25519};
pub use doc::{
    Act, Authorize, CommitError, Doc, Feed, Head, Imported, MAIN, RECORDS, Record, RecordWrite,
    Refused, Snapshot, TYPE_FIELD, Why, envelope_valid,
};
pub use fit::{ChangeKind, RecordChange, Unfit};
pub use genesis::{GENESIS_LABEL, Genesis};
pub use limits::Limits;
pub use opids::{OpId, OpsVerdict, carried_deps, ops_agree};
pub use seal::EpochKey;
pub use segment::{BadSegment, Closer, SEGMENT_LABEL, Segment};
pub use value::{of_loro, to_loro};
pub use writer::{RESERVED_PEER, WRITER_LABEL, writer, writer_derived, writer_input};
