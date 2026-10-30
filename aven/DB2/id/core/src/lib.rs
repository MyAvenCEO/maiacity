//! avenID: who may act for whom. Keys, vaults that own vaults, and what a vault governs (README, "Identity is a
//! package of its own"), checked against the Lean model `Aven.ID` in `id/spec`, which proves the same queries right.
//!
//! A [`Tree`] is only ever well formed: [`Tree::new`] and [`Tree::from_cast`] refuse anything else, so every query
//! answers for a tree the model's theorems hold for.
//!
//! In production the tree is data (PRODUCTION.md, Parts A and C): a [`Network`] is claimed once by a passkey's signed
//! [`Claim`], which founds the claimant's vault and the admin coop that owns Aven, the agent, and grows by [`SignIn`]s,
//! each a WebAuthn [`Assertion`] checked as `Aven.ID.Passkey` says. From milestone 2 its [`Members`] join by the
//! admin's [`Invite`]s (`Aven.ID.Invite`), and the door admits only them.

mod cast;
mod claim;
mod hex;
mod invite;
mod keys;
mod members;
mod network;
mod passkey;
mod query;
mod sign;
mod statements;
mod tree;

pub use cast::CastError;
pub use claim::{Claim, SignIn, claim_text, device_id, passkey_id, person_id, sign_in_text};
pub use invite::{
    Invite, Join, Withdrawal, invite_id, invite_text, join_text, one_time_public, sign_join,
    withdraw_text,
};
pub use keys::{public_hex, test_signer};
pub use members::{MemberError, Members, Pending};
pub use network::{COOP, COOP_NAME, ClaimError, GUARDIAN, Network};
pub use passkey::{Assertion, AssertionError, Passkey, Relying, base64url, challenge};
pub use sign::{SignError, Statement};
pub use tree::{
    Invalid, Kind, MAX_NAME, MAX_PERSON_NAME, Owner, Tree, Vault, valid_name, valid_person_name,
};
