//! avenID: who may act for whom. Keys, vaults that own vaults, and what a vault governs (README, "Identity is a
//! package of its own"), checked against the Lean model `Aven.ID` in `id/spec`, which proves the same queries right.
//!
//! A [`Tree`] is only ever well formed: [`Tree::new`] and [`Tree::from_cast`] refuse anything else, so every query
//! answers for a tree the model's theorems hold for.
//!
//! In production the tree is data (PRODUCTION.md, Part A): a [`Network`] is claimed once by a passkey's signed
//! [`Claim`] and grows by [`SignIn`]s, each a WebAuthn [`Assertion`] checked as `Aven.ID.Passkey` says.

mod cast;
mod claim;
mod hex;
mod keys;
mod network;
mod passkey;
mod query;
mod sign;
mod tree;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use cast::CastError;
pub use claim::{Claim, SignIn, claim_text, device_id, passkey_id, person_id, sign_in_text};
pub use keys::{public_hex, test_signer};
pub use network::{ClaimError, Network};
pub use passkey::{Assertion, AssertionError, Passkey, Relying, base64url, challenge};
pub use sign::{SignError, Statement};
pub use tree::{Invalid, Kind, Owner, Tree, Vault};
