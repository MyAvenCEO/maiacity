//! `aven-db-docs`: avenDB's docs layer, step 1 (`db/docs/README.md`, "Order of work"; `Aven.DB.Docs`; ARCHITECTURE.md
//! A43): Loro Docs, the layer the network tree and a fresh chat stand on.
//!
//! Its formats are the Lean's, each held byte for byte to its vectors:
//! - [`Genesis`]: a Doc's typed birth (A39), named by A30, carried by its first envelope (`Aven.DB.Docs.Genesis`,
//!   `genesis.json`); the built-in types named by their labels ([`schema::builtin_type`]).
//! - [`writer`]: the writer id, defined once (`Aven.DB.Docs.Writers`, `writers.json`).
//! - [`Body`]: what a docs envelope carries inside Core's, with half-open ops (`Aven.DB.Docs.Body`, `bodies.json`);
//!   [`Device`] signs the envelope.
//! - [`ops_agree`] and [`loro_agrees`]: rule 7, op ids against hashes, and on Loro commits with the writer's previous
//!   op read back in (`Aven.DB.Docs.OpIds`, `envelopes.json`, `loro.json`).
//! - [`Doc`]: the [`Head`] (`heads.json`), snapshot reads, the change feed, `commit`, and import with its three
//!   verdicts: fit for the built-in types and pinned user versions ([`fit`], `Aven.DB.Docs.Fit`, `fit.json`),
//!   authorized through [`Authorize`] (caps implements it), and not a split; what counts is held to `logs.json` and
//!   `counts.json` (`Aven.DB.Docs.Counts`).
//! - [`Segment`] and [`Closer`]: segments closed per writer and epoch, hybrid-signed (`Aven.DB.Docs.Segment`,
//!   `segments.json`), inside the one seal ([`seal`], `Aven.ID.Seal`, id's `seals.json`).
//! - [`Limits`]: every input bounded before Loro sees it (`Aven.DB.Docs.Limits`).
//!
//! Catch-up, checkpoints and period streams are the next step.

#![forbid(unsafe_code)]

// Loro can panic on bytes it should have refused. Natively the judge catches that on its scratch copy, which needs
// panics to unwind: a profile with `panic = "abort"` would let one member's envelope kill the peer, and again on every
// catch-up (db/docs/README.md, "Importing"). In the browser, where wasm32 aborts, the judge runs in a worker of its own.
#[cfg(all(not(target_arch = "wasm32"), not(panic = "unwind")))]
compile_error!(
    "aven-db-docs needs panic = \"unwind\" natively: the judge catches Loro's panics on its scratch copy"
);

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

pub use body::{Body, Call, Version, codec_order};
pub use device::{Device, Ed25519};
pub use doc::{
    Act, Authorize, CommitError, Doc, Feed, Head, Imported, MAIN, RECORDS, Record, RecordWrite,
    Refused, Snapshot, TYPE_FIELD, Why, envelope_valid,
};
pub use fit::{ChangeKind, RecordChange, Unfit};
pub use genesis::{GENESIS_LABEL, Genesis};
pub use limits::Limits;
pub use opids::{LoroVerdict, OpId, OpsVerdict, carried_deps, loro_agrees, ops_agree};
pub use seal::EpochKey;
pub use segment::{BadSegment, Closer, SEGMENT_LABEL, Segment};
pub use value::{of_loro, to_loro};
pub use writer::{RESERVED_PEER, WRITER_LABEL, writer, writer_derived, writer_input};
