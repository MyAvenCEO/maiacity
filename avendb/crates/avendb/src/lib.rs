//! avenDB: the user-owned, end-to-end encrypted database behind the avenDB page: vaults, caps, keys, Loro documents and
//! sync by caps, entry by entry and log by log.
//!
//! Signers (a passkey, each device's key) own human vaults, the passkey as the vault's root; human vaults own coop and
//! aven vaults. A vault is a flat library: its entries are in it directly, each with a type and tags that travel inside
//! its encrypted writes. Every right is a cap held by a vault, never by a signer: relay < read < write < owner, on a
//! slice of the vault (`slice`): the entries of some types, with or without some tags, by some authors, created in some
//! span of time or named by their ids, or the whole of it; read for Public too. The least is the default: a vault's
//! entries are its own until it shares them. The entries the same caps reach make up a cell, under a key of its own
//! that moves on as caps end; each device syncs exactly the logs its vaults' caps reach, and every write is encrypted
//! under its entry's key, so the server and relays only ever hold ciphertext.
//!
//! Built test-first against the Lean specification in `avendb/spec/` (see its README): `policy` mirrors the Lean model
//! edit for edit, and every test is named after the scenario or theorem it guards. Each module is written in the phase
//! named below; until then it is a stub, and the tests waiting for it are ignored with that phase as the reason, so
//! `cargo test -p avendb -- --ignored` lists what is still red.
//!
//! | Phase | Modules | Proven in Lean |
//! |---|---|---|
//! | P1 vaults | `policy`: vaults, vault logs, chains; `encode`, `sign`: edit ids, device and passkey signatures; `lab`: devices; the Lean model's vectors for the vault rules | T2, T3 |
//! | P2 caps | `policy`: caps, revocation with strong removal, the passkey as root, Public, write checks; `sync`: entries by caps | T1, T4, T8, T14, T16 |
//! | P3 keys | `keys`: X-Wing sealed boxes, committed XChaCha20-Poly1305 edits; `policy`: the key schedule and `Keys` edits; `doc`: Loro items; `lab`: keyrings, encrypted writes, reading, recovery, tampering | T5, T6, T7 |
//! | P4 documents and schemas | `lens`: schemas and lenses as blobs, projection on read, edits through a view; `doc`: items stored as records, edits tagged with their schema; `policy`: each vault's schema lane, published by its owners; `lab`: apps on a schema, read-only fallback | T9, T17 |
//! | P4b post-quantum | `hash`: SHA-3 for every hash of ours; `sign`: SLH-DSA beside every classical signature but a write's, device keys derived from the passkey; `keys`: a Classic McEliece share beside X-Wing in every sealed box, wraps where the key is held; `policy`: checkpoints and the post-quantum-only replay; `lab`: locked devices, blobs | T18 |
//! | P5 history and proposals | `history`: every write an edit on a line of its entry's history, proposals from any version, merge, promote, restore and undo, versions opened read-only; `policy`: each write's line, writes on a proposal build on its start; `doc`: a Loro peer per line, records put back untagged, copies for variants; `lab`: every line of every entry shown, the proposal operations | T10 |
//! | P6 sync and convergence | `sync`: every edit in one log (a vault's, a cap's, a cell's or an entry's) building on that log's frontier, devices asking with what they hold of each log, one digest per log to gossip, forks flagged; `policy`: edits drafted on their log's frontier; `lab`: offline devices, gossip in random orders, backups whose restored devices fork, writes under the newest key a device knows | T11, T12, T13, T15, T19 |
//! | P7 the tile | `cast`: the scenarios' people, devices and vaults, made a step at a time; `scenarios`: the plan's scenarios, each check recorded green or red, for the tests and the tile's Lab; `keys`: McEliece pairs made from a seed anywhere, so a page makes them in its workers; `lab`: names, spare keys made ahead; `history`: the schemas each write was written under | |
//! | F flat vaults | `slice`: what a cap shares, its selector sealed to the vaults it names; `policy`: spaces folded into vaults, an entry's type and tags in its encrypted writes, cells, caps resting on caps, stewards that move entries and answer the tags others ask for, creation through a cap's intake cell; `keys`: a key for each cell, an entry's key derived for each stay; `sync`: the logs of caps and cells; `lab`: stewardship in each device's upkeep | T20, T22 to T25 |
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
pub mod slice;
pub mod sync;
pub mod wire;
