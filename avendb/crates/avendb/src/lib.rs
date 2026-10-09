//! avenDB: the user-owned, end-to-end encrypted database behind the avenDB tile: vaults, caps, keys, Loro documents and
//! sync by caps, item by item and log by log.
//!
//! Signers (a passkey, each device's key) own human vaults, the passkey as the vault's root; human vaults own coop
//! vaults, and any vault founds spaces. Every right is a cap held by a vault, never by a signer: relay < read < write <
//! owner, on a whole space or on one entry, plus read for Public. Each device syncs exactly the items its vaults hold
//! caps on, and every edit is encrypted under that item's key, so the server and relays only ever hold ciphertext.
//!
//! Built test-first against the Lean specification in `avendb/spec/` (see its README): `policy` mirrors the Lean model
//! edit for edit, and every test is named after the scenario or theorem it guards. Each module is written in the phase
//! named below; until then it is a stub, and the tests waiting for it are ignored with that phase as the reason, so
//! `cargo test -p avendb -- --ignored` lists what is still red.
//!
//! | Phase | Modules | Proven in Lean |
//! |---|---|---|
//! | P1 vaults | `policy`: vaults, vault logs, chains; `encode`, `sign`: edit ids, device and passkey signatures; `lab`: devices; the Lean model's vectors for the vault rules | T2, T3 |
//! | P2 caps | `policy`: spaces, grants, revocation with strong removal, the passkey as root, Public, write checks; `sync`: items by caps | T1, T4, T8, T14, T16 |
//! | P3 keys | `keys`: X-Wing sealed boxes, committed XChaCha20-Poly1305 edits; `policy`: the key schedule and `Keys` edits; `doc`: Loro items; `lab`: keyrings, encrypted writes, reading, recovery, tampering | T5, T6, T7 |
//! | P4 documents and schemas | `lens`: schemas and lenses as blobs, projection on read, edits through a view; `doc`: items stored as records, edits tagged with their schema; `policy`: each space's schema lane, published by its owners; `lab`: apps on a schema, read-only fallback | T9, T17 |
//! | P4b post-quantum | `hash`: SHA-3 for every hash of ours; `sign`: SLH-DSA beside every classical signature but a write's, device keys derived from the passkey; `keys`: a Classic McEliece share beside X-Wing in every sealed box, wraps where the key is held; `policy`: checkpoints and the post-quantum-only replay; `lab`: locked devices, blobs | T18 |
//! | P5 history and proposals | `history`: every write an edit on a line of its entry's history, proposals from any version, merge, promote, restore and undo, versions opened read-only; `policy`: each write's line, writes on a proposal build on its start; `doc`: a Loro peer per line, records put back untagged, copies for variants; `lab`: every line of every entry shown, the proposal operations | T10 |
//! | P6 sync and convergence | `sync`: every edit in one log (a vault's, a space's or an entry's) building on that log's frontier, devices asking with what they hold of each log, one digest per log to gossip, forks flagged; `policy`: edits drafted on their log's frontier; `lab`: offline devices, gossip in random orders, backups whose restored devices fork, writes under the newest key a device knows | T11, T12, T13, T15, T19 |
//! | P7 the tile | `cast`: the scenarios' people, devices and vaults, made a step at a time; `scenarios`: the plan's scenarios, each check recorded green or red, for the tests and the tile's Lab; `keys`: McEliece pairs made from a seed anywhere, so a page makes them in its workers; `lab`: names, spare keys made ahead; `history`: the schemas each write was written under | |
//! | P8a devices on iroh | `wire`: every message between devices as bytes and back, one encoding each: signed edits, hellos, requests, replies, announcements; `sign`: a device's hello, its SLH-DSA signature on a connection; `lab`: a device split off to run on its own (`avendb-net` puts it on iroh), what it asks a peer, answers it and tells it, McEliece keys handed out only within a peer's reach | |

pub mod cast;
pub mod doc;
pub mod encode;
pub mod hash;
pub mod history;
pub mod id;
pub mod keys;
pub mod lab;
pub mod lens;
pub mod policy;
pub mod scenarios;
pub mod sign;
pub mod sync;
pub mod wire;
