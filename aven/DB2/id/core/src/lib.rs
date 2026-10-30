//! avenID: who may act for whom. Keys, vaults that own vaults, and what a vault governs (README, "Identity is a
//! package of its own"), checked against the Lean model `Aven.ID` in `id/spec`, which proves the same queries right.
//!
//! A [`Tree`] is only ever well formed: [`Tree::new`] and [`Tree::from_cast`] refuse anything else, so every query
//! answers for a tree the model's theorems hold for.

mod cast;
mod keys;
mod query;
mod sign;
mod tree;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use cast::CastError;
pub use keys::{public_hex, test_signer};
pub use sign::{SignError, Statement};
pub use tree::{Invalid, Kind, Owner, Tree, Vault};
