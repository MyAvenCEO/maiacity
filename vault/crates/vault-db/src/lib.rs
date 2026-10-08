//! The user-owned, end-to-end encrypted database behind the Database tile: vaults, caps, keys, Loro documents and sync
//! by caps, item by item.
//!
//! Signers (a passkey, each device's key) own human vaults, the passkey as the vault's root; human vaults own coop
//! vaults, and any vault founds spaces. Every right is a cap held by a vault, never by a signer: relay < read < write <
//! owner, on a whole space or on one entry, plus read for Public. Each device syncs exactly the items its vaults hold
//! caps on, and every edit is encrypted under that item's key, so the server and relays only ever hold ciphertext.
//!
//! Built test-first against the Lean specification in `vault/spec/` (see its README): `policy` mirrors the Lean model
//! op for op, and every test is named after the scenario or theorem it guards. Each module is written in the phase
//! named below; until then it is a stub, and the tests waiting for it are ignored with that phase as the reason, so
//! `cargo test -p vault-db -- --ignored` lists what is still red.
//!
//! | Phase | Modules | Proven in Lean |
//! |---|---|---|
//! | P1 vaults | `policy`: vaults, vault logs, chains; `encode`, `sign`: op ids, device and passkey signatures, recovery codes; `lab`: devices; the Lean model's vectors for the vault rules | T2, T3 |
//! | P2 caps | `policy`: spaces, grants, revocation with strong removal, the passkey as root, Public, write checks; `sync`: items by caps | T1, T4, T8, T14, T16 |
//! | P3 keys | `keys`, `lab`: sealing, encryption of every edit, rotation | T5, T6, T7 |
//! | P4 documents and schemas | `doc`, `lens` | T9 |
//! | P5 history and branches | `branch` | T10 |
//! | P6 sync and convergence | `sync`, `lab` on a controllable network | T11, T12, T13 |

pub mod branch;
pub mod doc;
pub mod encode;
pub mod id;
pub mod keys;
pub mod lab;
pub mod lens;
pub mod policy;
pub mod sign;
pub mod sync;
