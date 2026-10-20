//! avenDB: the user-owned, end-to-end encrypted database behind the avenDB page: vaults, shares, keys, Loro documents
//! and sync by shares, entry by entry and log by log. `avendb/docs/ARCHITECTURE.md` describes the whole design.
//!
//! Signers (a person's passkeys and the master recovery key) own human vaults, a passkey as the vault's root, and the
//! person's devices act for it; human and coop vaults own coop and aven vaults. A vault is a flat library: its entries
//! are in it directly, each with a type and tags that travel inside its encrypted writes. Every right is a share over a
//! vault, to a vault or to everyone: relay < backup < read < write < owner, the class of its group of ops (`rules`), on
//! a slice of the vault (`slice`): the entries of some types, with or without some tags, by some authors, created in
//! some span of time or named by their ids, or the whole of it; everyone only reads. A keep share, to one device of its
//! issuer, grants nothing: it says what that device syncs. The least is the default: a vault's entries are its own
//! until it shares them. The entries the same shares reach make up an audience, under a key of its own that moves on as
//! shares end; each device syncs exactly the logs its vaults' shares reach, as its keep shares narrow them, and every
//! write is encrypted under its entry's key, so the server and relays only ever hold ciphertext.
//!
//! Built test-first against the Lean specification in `avendb/spec/` (see its README): `policy` mirrors the Lean model
//! edit for edit, and every test is named after the scenario or theorem it guards. Each module was written in the phase
//! named below, its tests ignored with that phase as the reason until it was built; every phase is built now, so no
//! core test is ignored.
//!
//! | Phase | Modules | Proven in Lean |
//! |---|---|---|
//! | P1 vaults | `policy`: vaults, vault logs, chains; `encode`, `sign`: edit ids, device and passkey signatures; `lab`: devices; the Lean model's vectors for the vault rules | T2, T3 |
//! | P2 shares | `policy`: shares, revocation with strong removal, the passkey as root, Public, write checks; `sync`: entries by shares | T1, T4, T8, T14, T16 |
//! | P3 keys | `keys`: X-Wing sealed boxes, committed XChaCha20-Poly1305 edits; `policy`: the key schedule and `Keys` edits; `doc`: Loro items; `lab`: keyrings, encrypted writes, reading, recovery, tampering | T5, T6, T7 |
//! | P4 documents and schemas | `lens`: schemas and lenses as blobs, projection on read, edits through a view; `doc`: items stored as records, edits tagged with their schema; `policy`: each vault's schema lane, the schemas and lenses it creates as entries; `lab`: apps on a schema, read-only fallback | T9, T17 |
//! | P4b post-quantum | `hash`: one hash for every hash of ours (SHA-3, BLAKE3 since edit version 10); `sign`: SLH-DSA on every edit, a passkey's WebAuthn assertion beside it, device keys derived from the passkey; `keys`: a Classic McEliece share beside X-Wing in every sealed box, wraps where the key is held; `lab`: locked devices, blobs | |
//! | P5 history and proposals | `history`: every write an edit on a line of its entry's history, proposals from any version, merge, restore and undo, versions opened read-only; `merge`: a three-way merge of records place by place, as git merges a file, with its conflicts; `policy`: each write's line, writes on a proposal build on its start; `doc`: a Loro peer per line, records put back untagged, copies for variants; `lab`: every line of every entry shown, the proposal operations | T10 |
//! | P6 sync and convergence | `sync`: every edit in one log (a vault's, a share's, an audience's or an entry's) building on that log's frontier, devices asking with what they hold of each log, one digest per log to gossip, forks flagged; `policy`: edits drafted on their log's frontier; `lab`: offline devices, gossip in random orders, backups whose restored devices fork, writes under the newest key a device knows | T11, T12, T13, T15, T19 |
//! | P7 the tile | `cast`: the scenarios' people, devices and vaults, made a step at a time; `scenarios`: the plan's scenarios, each check recorded green or red, for the tests and the tile's Lab; `keys`: McEliece pairs made from a seed anywhere, so a page makes them in its workers; `lab`: names, spare keys made ahead; `history`: the schemas each write was written under | |
//! | F flat vaults | `slice`: what a share shares, its selector sealed to the vaults it names; `policy`: spaces folded into vaults, an entry's type and tags in its encrypted writes, audiences, shares resting on shares, stewards that move entries and answer the tags others ask for, creation through a share's intake audience; `keys`: a key for each audience, an entry's key derived for each stay; `sync`: the logs of shares and audiences; `lab`: stewardship in each device's upkeep | T20, T22 to T25 |
//! | P8a devices on iroh | `wire`: every message between devices as bytes and back, one encoding each: signed edits, hellos, requests, replies, announcements; `sign`: a device's hello, its SLH-DSA signature on a connection; `lab`: a device split off to run on its own (`avendb-net` puts it on iroh), what it asks a peer, answers it and tells it, McEliece keys handed out only within a peer's reach | |
//! | O ops | `ops`: one JSON language to read and change any record, whatever its schema: records flat, the diff of two records, ops on a record and the place each names, `where` with its labels' selector; `engine`: every op run on a device's Lab, a query, a read or a write | O1 to O3 |
//! | N records inside records | `ops`: rows of rows at any depth, each place named by its chain of rows, a record read so many rows down, links followed a level at a time; `lens`: lists of records in any row, shapes that hold their own, fit per innermost row, the ceiling; `doc`: nested lists as Loro containers of their rows; `merge`: rows joined by id inside a top row; `engine`: deep paths, caps and queries, `follow`, `limits` and `set_limits` | O1 to O3 and S1, S2 at any depth, `S2_ceiling`, L1 to L3 |
//! | C shares that name ops | `rules`: a share is a name and a group of ops, its level their class, the built-in groups (Owner, Editor, Suggester, Viewer, Public, Backup, Relay); its slice carries the ops sealed with their commitment in the clear, a write's touches and the proof it always carries; `policy`: the writes an entry's readers count, by the ops of the chain of the share they rely on, tags asked for included; `doc`, `history`: a write's touches read off its Loro update, each line's history of counted writes; `lab`: shares issued as named groups of ops, writes refused that their ops don't allow, the stewards granting counted tag asks, a dry run; `engine`: `may`, `groups` | C1 to C4 |
//! | B blobs | `sealed`: files of any size sealed as iroh blobs, each under a key of its own, in 64 KiB segments that open one by one, so any range of a film opens from its own segments alone, and in pieces of 1 GiB; `policy`, `wire`: writes that name the files they bring, their keys in the body; `sync`, `lab`: files fetched by whoever may receive such a write, opened by its readers | T27 |
//! | Bootstrap | `recovery`: the master recovery key, a passkey kept in software that every human vault adds as an owner while avenDB is bootstrapped, for emergencies; its public half as a file; `bin/master-key`, which makes it | |
//! | V2 one API | `engine`: every read and change the page and the Mac app make as one op, shares, keeps, revocations, settings, new vaults, files, marks, cards and profiles too, each answered done, refused or to approve, and `may` of each; `world`, `words`, `data`: a device's world, its names for the core's words, its database and its history as the page reads them | |
//! | CG cap groups and the gate | `rules`: a cap group, a name, caps (an op over a slice each) and the groups it includes, an entry of its vault, versioned; `policy`: a share that names a cap group, judged by the version in force where each write comes, an invite key a newcomer's vault claims once (`Action::Claim`); `gate`: what a server takes of a batch, a new person's vault only with the invite it claims, a coop or an aven only an admin's; `engine`: `cap_groups`, `define_group`, `redefine_group`, `share_group` | CG1, G1, G2 |
//! | K the key move | `sign`: two suites, ML-DSA-65 for every new signer and SLH-DSA for every signer made before, each signer's id hashing its suite; a passkey's or Touch ID key's secret deriving its key in each; a device's kept secret naming its suite; `lab`: devices reopened in their own suite, a passkey held in both and the one its vault knows taken; `avendb-net`: a new device's pass in each suite, to the relay and to a peer | the key move example (`keyMove`) and its vector |
//! | H2 provenance | `provenance`: the proof of a vault's public code, of what a stranger that follows it may receive (`sync::answer`), as one reply; an observer, a device of no vault anchored to the vault by its id, that takes it as any reply and reads back the rows the feed serves, and holds a file to the write that brought it | T12 |

pub mod aip;
pub mod backup;
pub mod cast;
pub mod data;
pub mod doc;
pub mod encode;
pub mod engine;
pub mod gate;
pub mod hash;
pub mod history;
pub mod id;
pub mod keys;
pub mod lab;
pub mod lens;
pub mod merge;
pub mod ops;
pub mod policy;
pub mod provenance;
pub mod recovery;
pub mod rules;
pub mod scenarios;
pub mod sealed;
pub mod sign;
pub mod slice;
pub mod sync;
pub mod wire;
pub mod words;
pub mod world;
