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
//!
//! Keys (id/caps/README.md, "Keys", "Passkeys and the PRF step"): a passkey's [`PrfOutput`] derives its hybrid
//! owner [`HybridKey`] and its [`SealKey`]; a vault's keyring and each Doc's keys are [`Epoch`]s sealed to their readers in
//! X-Wing [`Stanza`]s; and [`safe`] decides what may leave a vault's safe, as `Aven.ID.Safe` does.

pub mod caps;
mod cast;
mod claim;
mod epoch;
mod hex;
mod hybrid;
mod invite;
pub mod keep;
mod keys;
mod members;
mod network;
mod padme;
mod passkey;
mod prf;
mod query;
pub mod safe;
mod seal;
mod secret;
mod sign;
mod statements;
mod tree;
mod value;

pub use cast::CastError;
pub use claim::{
    Claim, SignIn, browser_name, claim_text, device_id, passkey_id, person_id, sign_in_text,
};
pub use epoch::{
    BACK_LABEL, COMMIT_LABEL, Epoch, History, KeyError, SCHEME, TAG_SEED_LABEL, VAULT_LABEL,
    commit, subkey, tag, tag_seed,
};
pub use hybrid::{HYBRID_SUITE, Hybrid, HybridKey, HybridPublic, HybridSignature, hybrid_verify};
pub use invite::{
    Invite, Join, Withdrawal, invite_id, invite_text, join_text, one_time_public, sign_join,
    withdraw_text,
};
pub use keys::{public_hex, test_signer};
pub use members::{MemberError, MemberSignIn, Members, Pending};
pub use network::{COOP, COOP_NAME, ClaimError, GUARDIAN, Network};
pub use padme::{MIN_STANZAS, padded, padme};
pub use passkey::{Assertion, AssertionError, Passkey, Relying, base64url, challenge};
pub use prf::{OWNER_LABEL, PRF_LABEL, PrfOutput, SEAL_LABEL, prf_input, prf_salt};
pub use seal::{
    CIPHERTEXT_LEN, Context, HASH_LEN, SEALED_LEN, STANZA_COMMIT_LABEL, STANZA_KEY_LABEL,
    STANZA_SUITE, Scope, SealKey, SealPublic, Stanza, stanza_commit, stanza_keys,
};
pub use secret::{Entropy, Secret, TestEntropy};
pub use sign::{SignError, Statement};
pub use tree::{
    Invalid, Kind, MAX_NAME, MAX_PERSON_NAME, Owner, Tree, Vault, valid_name, valid_person_name,
};
