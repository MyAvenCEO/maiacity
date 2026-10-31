//! avenID's caps, as A43's minimal caps need them (`id/caps/README.md`; Lean's `Aven.ID.Caps`, `CapsCbor`,
//! `Authorized`, `Revoke`, `Types`, `Approve`): a vault's own authority over its Docs, device caps, a cap's lines of
//! ops with bounds, chains that only narrow, revocation, and the reader's verdict on an envelope's calls.

mod approve;
mod authorized;
mod cbor;
mod chain;
mod conditions;
mod line;
mod revoke;
mod types;

pub use approve::Sig;
pub use authorized::{Authority, DeviceCap, Reader, Reading, Refusal};
pub use cbor::CAP_LABEL;
pub use chain::{Cap, ChainError, Ctx, Role, authority_over_vault, vault_id};
pub use conditions::{Branches, Conditions, Form, History, Holder, MAIN};
pub use line::{Grant, Line, World, grant_allows, grant_reaches, grant_within};
pub use revoke::{Doc, Reads, Revocation, Verdict};
pub use types::{BUILTIN_TYPES, builtin_type, group_type};
