//! `aven-db-engine`: avenDB's ops engine, its pure core, in Rust ([`README.md`](../README.md), `Aven.DB.Engine`).
//!
//! The engine works on Records, by type, and nothing else: no Loro, no store, no network. The docs layer reads Records
//! out of its Docs, hands them here, and applies what comes back.
//!
//! - [`query`]: a query's operators over the rows of each type in its scope, its bound, its cost and the work it does
//!   (`Engine.Query`).
//! - [`mutate`]: a commit of core ops to one Doc's Records, all or nothing, its ids made, not drawn
//!   (`Engine.Mutate`).
//! - [`footprint`]: a commit's footprint steps and every reader's check of its diff (`Engine.Footprint`).
//! - [`changes`]: the change view a reader computes from a Doc's Records before and after, and the footprint part of
//!   the verdict over it, for a commit and for a merge into main (`Engine.Changes`).
//! - [`lower`]: `core/1`'s calls lowered to steps, and the call a committer's op names (`Engine.Lower`).
//! - [`value`]: how the engine compares and orders Values (`Engine.vals`).
//!
//! Every answer its tests check comes from the Lean model's vectors (`db/spec/vectors`) or from the model's
//! definitions run on random inputs. `no_std` with `alloc`, no `unsafe`, so it builds for wasm32 with no imports.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

pub mod changes;
pub mod footprint;
pub mod lower;
pub mod mutate;
pub mod query;
pub mod value;

pub use changes::{
    ChangeKind, RecordChange, change_of, changes_from, footprint_ok, id_key, id_of_key,
    verdict_footprint,
};
pub use footprint::{check, diff_within, footprint};
pub use lower::{core_op, lower_core};
pub use mutate::{Cell, NewId, Op, Record, Refused, apply, commit, created};
pub use query::{
    Answer, Cmp, Completeness, Query, Rec, Relations, Spec, Tuple, answer_over, bound, cost, eval,
    get, in_scope, resolve, run, work,
};
