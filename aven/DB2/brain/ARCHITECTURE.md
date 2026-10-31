# avenDB: the architecture

avenDB is a local-first database for people and their vaults: every change is a signed, sealed envelope in a Doc;
every reader judges for itself; and no server holds more than its owners grant. This page is the index of its
architecture: the whole on one page, the rules every part keeps, who owns what, and every decision with where it lives.

## How this is kept

- **One place.** The architecture lives here, in avenBRAIN, and nowhere else: this index, one page per package, the
  [decision log](DECISIONS.md) and the [glossary](GLOSSARY.md). Brain in avenOS shows these files themselves. Each
  package's Lean stays in its folder, and its page names it.
- **The pages are the latest truth.** Each concept is stated once, on its owner's page, as it is now, with the
  decisions it rests on and the Lean that proves it. A change rewrites the page; it is never appended below.
- **The decision log is the history.** One table, the newest decision on top. It only grows: a new decision is a new
  row at the top, a row is never edited, and a change of mind is a new row naming the one it supersedes (checked by
  `aven/ops/devx/decisions.mjs`). avenMAIA is its only writer.
- **Package READMEs** say what the package is, link its page, and give its commands and file map. They don't decide.

The working rules for every thread are in [`aven/DB2/CLAUDE.md`](../CLAUDE.md).

## The whole on one page

```
 avenOS ─────────── the shell: the page, its workers, Brain                     ┐
 avenPEERS ──────── Peer and Peer-Light: wire, gossip, sync, keepers, the gate  │ run
 avenACTORS ─────── programs that live in a Doc and take turns                  │
 avenRUNTIME ────── frozen modules by hash, and their hosts                     ┘
 avenOPS ────────── the ops engine: calls to steps, queries, wants, search      ┐
 avenDOCS ───────── Docs: typed, signed, sealed, counted; Loro inside           │ data
 avenSTORE ──────── Values by hash and refs, on every backend                   ┘
 avenCAPS ───────── who may do what: caps, and the register                     ┐
 avenID ─────────── who is who: keys, signatures, sealing, vaults and owners     │ trust
 avenCORE ───────── the primitives every part shares                            ┘
 avenBRAIN ──────── this documentation        avenSANDBOX ── the box that checks it all
```

A part uses only the parts below it. The first generation (`aven-gen1`) still runs production's chat until the
clean-slate cutover, and is deleted after it.

## Packages and owners

| Package | Owns | Page | Code | Lean |
|---|---|---|---|---|
| avenCORE | Values, the codec, names, signed things, envelopes, logs, the past, counting, limits, ops, calls, targets, steps | [core](core/README.md) | `core`, `codec` | `Aven.Core` |
| avenID | keys and signatures, passkeys and the PRF, sealing, epochs, the keyring, vaults and their owners | [id](id/README.md) | `id/core` | `Aven.ID` |
| avenCAPS | caps over ops, chains, revocation, collections, member, keep and offer caps, the gate's authority, `authorized`, the register | [caps](caps/README.md) | `id/core` (to move) | `Aven.ID` (to move) |
| avenDOCS | a Doc's genesis, types and fit, bodies, writer ids, commit, the head, import, segments, the seal's use, branches, lenses, directories | [docs](docs/README.md) | `db/docs` | `Aven.DB.Docs` |
| avenOPS | lowering calls to steps, footprints, queries, the want queue, search, sealed indexes' queries | [ops](ops/README.md) | `db/engine` | `Aven.DB.Engine` |
| avenSTORE | Values and refs, compare-and-set, backends | [store](store/README.md) | `store` | `Aven.DB.Store` |
| avenPEERS | the Peer and Peer-Light, the wire, gossip per group, sync, catch-up, keepers, the fetch gate, relays, presence, upgrades, deploy | [peers](peers/README.md) | `peer` | `Aven.Peer` |
| avenRUNTIME | modules by hash, the manifest, hosts, the drawer, the markdown and face runtimes | [runtime](runtime/README.md) | `aven/runtimes` | `Aven.Runtime` |
| avenACTORS | actors, inboxes, turns, hosts under chains | [actors](actors/README.md) | `aven/actor` | `Aven.Actor` |
| avenOS | the page, its workers, sign-up and sign-in, the chat screen, Brain | [os](os/README.md) | `os` | — |
| avenBRAIN | this documentation | [brain](README.md) | `brain` | — |
| avenSANDBOX | the box, the cast, `up --check`, lanes | [sandbox](sandbox/README.md) | `sandbox` | — |

Owners are packages, not threads: whoever writes a package's code follows its page.

## The rules

Every part keeps these. Each is proven in Lean by composing the parts' own theorems in `Aven.Architecture`
(`aven/DB2/architecture/spec`), except where the status says otherwise.

| # | Rule | Status |
|---|---|---|
| 1 | **One codec for everything signed.** One canonical encoding; a signature covers exactly those bytes under a label that names what is signed; the thing is named by the hash of the bytes. | composed |
| 2 | **History names its past by hash.** An envelope names the one before it in its log and the tips it builds on by hash. | composed |
| 3 | **One writer per log, and a log never waits.** Two envelopes after one are a split: final, and shown to every reader. | composed |
| 4 | **Readers judge.** Every reader checks every envelope's signatures, authority, footprint and fit itself, on the envelope's own past, never by asking a keeper, relay or the Aven Peer, and counts it by Core's one rule, where a split or a revocation learned later discounts (A182). | composed; the revocation's part to come (A182) |
| 5 | **Reading is holding the key.** Whoever lacks a Doc's current key sees only a seal's outside: `{ct, doc, epoch, nonce, commit}`. | composed |
| 6 | **Demand never grants.** What leaves a reader is wants ∩ caps; what leaves a keeper is wants ∩ fetch proofs. | composed |
| 7 | **No privilege by position.** A peer holds only what its owners granted: keep caps (blind), hosting (an explicit read cap per actor), relaying (sealed bytes). No peer is a sequencer, arbiter, custodian or only source. | composed |
| 8 | **Derived state is a cache or a checkpoint.** A device's snapshots and indexes are its own caches; what travels is a signed checkpoint, checked by replay. | composed |
| 9 | **Sealed beyond the device.** No plain byte leaves a device except to a reader of it. | composed |
| 10 | **Every input has a limit,** and every vault a quota at each keeper. | composed |
| 11 | **Every wait ends,** and raises the stall alarm without blocking other work. | composed |
| 12 | **Order is causal; time is a claim.** | composed |
| 13 | **Keys live only in the safe.** | composed |
| 14 | **One protocol of ours:** `aven/db/1`, with iroh's gossip for group topics and iroh-blobs for files, on one `Router`; every format named, versioned, with Lean and vectors first. | a property of the node, held by every format's vectors and the box |
| 15 | **Vaults own; signers only sign.** Only a vault owns, holds caps and governs. A key holds no authority: it signs for a vault that names it, k of n, and a device's key governs nothing; the vault it serves owns its vault (A178). A cap is held by a vault, a group, or the public, which is the network's members (A148). | held by avenID's and avenCAPS' Lean; not yet in `Gaps.lean` |
| 16 | **Clean architecture only, never a patch.** A fix goes where the primitive is, once, for every use of it. | a working rule, not a property of the system |

## The clean-slate cutover

Production moves from the first generation to this architecture in seven stages ([avenPEERS' plan](../PEERS.md)).

| Stage | What | State |
|---|---|---|
| 1. The Doc foundation | avenCORE, avenID's keys, minimal avenCAPS, avenDOCS, avenOPS | merged, except avenOPS' engine (#1697, next) |
| 2. Authority in Lean | vault authority, member caps, the tree's passkey records and migration snapshot, k of n | merged (#1717, #1718, #1735); envelope authority (#1741) and caps on Core's op ids (#1744) in review; k of n by stored thresholds in progress |
| 3. Docs in the Peers | the Doc host, gossip per group, sync by version, the docs worker | native host built (#1727); the docs API for it (#1742), the wire split (#1745) and the keyring Doc (#1743) in review; the browser and the frames in progress |
| 4. The tree as the first Doc | the register on Core's counting, its setup as the root Record, sign-in keys bound | in progress: k of n (PR 1), then owner changes on `Closed` (A191) and the vault-name switch (A190) |
| 5. Catch-up and keepers | arrivals, covers, bills, the fetch gate, catch-up by arrival number | native catch-up built (#1722); caps' half merged (#1734); the keeper's byte forms (#1739) and their Rust (#1740) in review |
| 6. The chat as a fresh Doc | messages as Records, the screen on avenOPS queries, files behind the gate | not started |
| 7. Rehearsal and cutover | production's snapshot replayed in the box, then release, deploy, delete `aven-gen1` | not started |

## Open questions

Every question the pages leave open, with who decides it. This list changes as they are settled: an answer becomes a
row in [the log](DECISIONS.md), its page states it, and it leaves both the page and this list.

| Question | Page | Who decides |
|---|---|---|
| The actor kernel's own authority: click caps, who may spawn, a run budget | [actors](actors/README.md#open-questions) | Samuel, on avenACTORS' proposal |
| A vault-wide cap in a one-Doc reader's hands | [caps](caps/README.md#open-questions) | avenMAIA, on avenCAPS' and avenDOCS' proposal |
| Directory and vocabulary root types: built-in or user types | [docs](docs/README.md#open-questions) | avenMAIA, with avenCAPS |
| The index interface between avenDOCS and avenOPS | [docs](docs/README.md#open-questions) | avenMAIA, on avenDOCS' and avenOPS' proposal |
| The first lens catalogue's named conversions | [docs](docs/README.md#open-questions) | avenMAIA, with avenDOCS at its step 3 |
| The root Record's fields for a Doc's birth references | [docs](docs/README.md#open-questions) | avenMAIA |
| A slot-id put, a device's default query bound, and the granularity of deltas | [ops](ops/README.md#open-questions) | avenMAIA, with avenOPS |
| Whether `set_ref` requires its blob to exist | [store](store/README.md#open-questions) | avenMAIA |
| How much of a Peer-Light's OPFS cached chunks may take | [store](store/README.md#open-questions) | avenMAIA, with avenOS |
| Reconciling many Docs at a reconnect | [peers](peers/README.md#open-questions) | avenMAIA |
| Large values over iroh-blobs | [peers](peers/README.md#open-questions) | avenMAIA, at stage 6 |
| Which stage builds relays, address entries, bootstrap and signed presence | [peers](peers/README.md#open-questions) | avenMAIA |
| When a keeper that goes quiet counts as gone | [peers](peers/README.md#open-questions) | avenMAIA |
| Presence at scale | [peers](peers/README.md#open-questions) | avenMAIA |
| Which `users` label avenOS's own pages load a runtime as | [runtime](runtime/README.md#open-questions) | avenMAIA, with the runtimes thread |
| The word "kernel" | [actors](actors/README.md#open-questions) | avenMAIA |
| Where the Service Worker lives once the safe has its own origin | [os](os/README.md#open-questions) | avenMAIA |
| Thumbnails and posters for files in the chat | [os](os/README.md#open-questions) | avenMAIA |

**Parked by Samuel for later** (A206): moving runtimes into avenDB and who may publish one then; the release vault, who
owns it and when signed release entries replace the dated releases.

## Every decision

Every A-number in [the log](DECISIONS.md), the newest first: what it decided, the page that states it now, and
whether it still holds. A decision superseded in part still holds for the rest. The table is generated from the log; a
decision's own text, reasons and Lean are its row there.

| Decision | What | Page | Holds |
|---|---|---|---|
| [A207](DECISIONS.md) | A type's version is a `schema` Record; a named version stays `version` | [docs](docs/README.md) | yes |
| [A206](DECISIONS.md) | Runtimes stay files in this repository; publishing runtimes and the release vault parked (Samuel) | [runtime](runtime/README.md) | yes |
| [A205](DECISIONS.md) | No compaction: everything about an actor is kept (Samuel) | [actors](actors/README.md) | yes |
| [A204](DECISIONS.md) | Overlapping text edits in a merge are a choice, the target's by default (Samuel) | [docs](docs/README.md) | yes |
| [A203](DECISIONS.md) | How Brain shows the source of truth: phone-readable pages, the log as searchable cards, A<n> links | [os](os/README.md) | yes |
| [A202](DECISIONS.md) | Moving an actor's home is a handover in its own log; a forced move starts a generation | [actors](actors/README.md) | yes |
| [A201](DECISIONS.md) | An actor's address is its Doc's id; `[vault, actor]` on the wire | [actors](actors/README.md) | yes |
| [A200](DECISIONS.md) | No nulls in any format avenDB defines | [core](core/README.md) | yes |
| [A199](DECISIONS.md) | A checkpoint's Loro export is `loro`; `state` stays its Records' hash | [docs](docs/README.md) | yes |
| [A198](DECISIONS.md) | The readable form exactly as Core's vectors write it: `{"bytes"}`, `b3:`, `d:`, hex keys | [core](core/README.md) | yes |
| [A197](DECISIONS.md) | Log tips retire with gen1; history is address and release entries | [peers](peers/README.md) | yes |
| [A196](DECISIONS.md) | What each release carries of the runtimes | [runtime](runtime/README.md) | yes |
| [A195](DECISIONS.md) | The keyring Doc is fetched by its id alone | [peers](peers/README.md) | yes |
| [A194](DECISIONS.md) | History entries: `Aven.Peer.History`, one-key bodies, no tree-tip beat | [peers](peers/README.md) | superseded by A197 in part |
| [A193](DECISIONS.md) | Peer records are avenPEERS' | [peers](peers/README.md) | superseded by A194 in part |
| [A192](DECISIONS.md) | markdown-runtime v3: links resolve against their document | [runtime](runtime/README.md) | yes |
| [A191](DECISIONS.md) | A removal never undoes finality | [caps](caps/README.md) | yes |
| [A190](DECISIONS.md) | Core names vaults by plain 32 bytes; one switch, two PRs back to back | [core](core/README.md) | yes |
| [A189](DECISIONS.md) | Approvals are Core signatures, and Lean's vectors sign for real | [caps](caps/README.md) | yes |
| [A188](DECISIONS.md) | An actor host's envelope names its actor in its authority | [caps](caps/README.md) | yes |
| [A187](DECISIONS.md) | The keyring Doc travels unsealed | [id](id/README.md) | yes |
| [A186](DECISIONS.md) | No wiping in production (Samuel, 30 Oct) | [peers](peers/README.md) | yes |
| [A185](DECISIONS.md) | One owner for each of the pages' shared parts | this page | yes |
| [A184](DECISIONS.md) | Built-in bodies carry no nulls | [core](core/README.md) | superseded by A200 |
| [A183](DECISIONS.md) | A cap is its content: no nonce | [caps](caps/README.md) | yes |
| [A182](DECISIONS.md) | A revocation discounts, as a split does: Core's counting takes avenCAPS' `revoked` | [caps](caps/README.md) | yes |
| [A181](DECISIONS.md) | A checkpoint carries a `state`, sealed as a checkpoint | [docs](docs/README.md) | superseded by A199 in part |
| [A180](DECISIONS.md) | Runtimes have no release of their own; they ship inside `@aven/os` and the avenPEER image | [runtime](runtime/README.md) | superseded by A196 in part |
| [A179](DECISIONS.md) | Threads keep their page's Status table current | process | yes |
| [A178](DECISIONS.md) | A device's vault: its key signs, the vault it serves owns | [id](id/README.md) | yes |
| [A177](DECISIONS.md) | The seal names what it seals (`seals`), and a checkpoint is a checkpoint | [id](id/README.md) | yes |
| [A176](DECISIONS.md) | One padding for every sealed byte: 256 B, 1 KiB, 4 KiB, then Padmé | [id](id/README.md) | yes |
| [A175](DECISIONS.md) | Versions are avenCORE's | [core](core/README.md) | yes |
| [A174](DECISIONS.md) | Bytes in JSON are `{"bytes": hex}`, as built | [core](core/README.md) | superseded by A198 in part |
| [A173](DECISIONS.md) | The keeper's byte forms, as built (keep-bytes.json); caps' half of the gate | [caps](caps/README.md) | yes |
| [A172](DECISIONS.md) | A pinned schema lives in its type Doc's version Record `{at, name, schema}` | [docs](docs/README.md) | superseded by A207 in part |
| [A171](DECISIONS.md) | Threads never add A-numbers or architecture prose | process | yes |
| [A170](DECISIONS.md) | The keyring's `epoch` Records are write-once; a reseal adds a Record | [id](id/README.md) | superseded by A185 in part |
| [A169](DECISIONS.md) | avenDOCS defines Authorize; avenCAPS a pure verdict; avenPEERS the adapter | [peers](peers/README.md) | yes |
| [A168](DECISIONS.md) | Box checks run the real path; no keys from cast config | [sandbox](sandbox/README.md) | yes |
| [A167](DECISIONS.md) | Rule 10 stays composed over the keeper's and caps' theorems | process | yes |
| [A166](DECISIONS.md) | A reader finds a keeper's item's kind by commitment | [docs](docs/README.md) | yes |
| [A165](DECISIONS.md) | The Claude Doc is superseded by avenBRAIN | process | yes |
| [A164](DECISIONS.md) | A vault's name is the A30 name of `["avenID vault 1", {kind, nonce}]` | [id](id/README.md) | yes |
| [A163](DECISIONS.md) | Who signs the keeper's records; listing, link, order, choice shapes; no nulls | [caps](caps/README.md) | yes |
| [A162](DECISIONS.md) | A vault is named by 32 bytes in every format | [id](id/README.md) | yes |
| [A161](DECISIONS.md) | Fetch keys Ed25519 from `avenDB fetch key 1`; the proof's form is caps' | [caps](caps/README.md) | yes |
| [A160](DECISIONS.md) | The register (`tree/1`) is avenCAPS's | [caps](caps/README.md) | yes |
| [A159](DECISIONS.md) | avenCAPS is its own package; avenID is keys, sealing, vaults and owners | [caps](caps/README.md) | yes |
| [A158](DECISIONS.md) | avenBRAIN is the architecture's one location: index, log, glossary, a page per package | process | yes |
| [A157](DECISIONS.md) | Package names: avenDB, avenCORE, avenID, avenCAPS, avenDOCS, avenOPS, avenSTORE, avenPEERS, avenRUNTIME, avenACTORS, avenOS, avenBRAIN, avenSANDBOX | process | yes |
| [A156](DECISIONS.md) | A device's ML-DSA ξ and X-Wing seed derived from its Ed25519 seed, as built (#1731) | [id](id/README.md) | yes |
| [A155](DECISIONS.md) | A sealed live message names its Doc once (the seal's outside) | [peers](peers/README.md) | yes |
| [A154](DECISIONS.md) | Group topics `groupTopic(wire, key)`; Live `{sealed}`/`{doc, hash}`/`{doc, version}`; the members' and keyring groups | [peers](peers/README.md) | yes |
| [A153](DECISIONS.md) | A keeper takes an upload when the bill after it fits the quota or doesn't grow | [peers](peers/README.md) | yes |
| [A152](DECISIONS.md) | A live gossip message `{sealed}` or `{hash}` | [peers](peers/README.md) | superseded by A154 in part |
| [A151](DECISIONS.md) | A peer's Doc shelf: blobs by hash, `doc-<id>-held` then `doc-<id>` by CAS | [peers](peers/README.md) | yes |
| [A150](DECISIONS.md) | Checkpoints come after the cutover; their kind is the uploader's word | [docs](docs/README.md) | yes |
| [A149](DECISIONS.md) | A genesis stays exact; birth references live in the root Record | [docs](docs/README.md) | yes |
| [A148](DECISIONS.md) | "Public" means the network's members | [id](id/README.md) | yes |
| [A147](DECISIONS.md) | Authorize = f(envelope, its counted past); concurrency only in the tree's settle | [docs](docs/README.md) | yes |
| [A146](DECISIONS.md) | The tree's setup is its root Record | [id](id/README.md) | yes |
| [A145](DECISIONS.md) | A limit follows its primitive's owner | [core](core/README.md) | yes |
| [A144](DECISIONS.md) | After the cutover a file's chunks are Doc Values behind the one gate | [store](store/README.md) | yes |
| [A143](DECISIONS.md) | Gossip per group, not per Doc; `doc_tips`/`doc_have` name their Doc | [peers](peers/README.md) | yes |
| [A142](DECISIONS.md) | The fetch proof's TLS exporter (`EXPORTER-avenDB-fetch-1`, 32 bytes) | [peers](peers/README.md) | yes |
| [A141](DECISIONS.md) | The keeper owns its bill and admission; the earliest remaining uploader's vault pays | [peers](peers/README.md) | yes |
| [A140](DECISIONS.md) | The Peer image takes its crates from one list (`tag.mjs` reads `Cargo.toml`) | [peers](peers/README.md) | yes |
| [A139](DECISIONS.md) | Held and spent in caps' Keep | [id](id/README.md) | superseded by A141 |
| [A138](DECISIONS.md) | The decision log is append-only; the architect is its only writer | process | yes |
| [A137](DECISIONS.md) | Authorize judges an envelope on its own counted past | [docs](docs/README.md) | yes |
| [A136](DECISIONS.md) | Tips are log heads `{writer, seq, name}` | [peers](peers/README.md) | yes |
| [A135](DECISIONS.md) | The tree on the Doc host: its `BuiltinFit` and `Authorize` | [id](id/README.md) | yes |
| [A134](DECISIONS.md) | The wire moves to `aven-peer-wire`; `doc_tips`' keys | [peers](peers/README.md) | superseded by A143 in part |
| [A133](DECISIONS.md) | The fetch gate's frames exactly (`prove_refused`, ≤ 128 hashes, parts ≤ 48 KiB, `keep_`) | [peers](peers/README.md) | superseded by A143 |
| [A132](DECISIONS.md) | A device's X-Wing seal seed is derived from its own Ed25519 seed | [id](id/README.md) | yes |
| [A131](DECISIONS.md) | The keyring's Records are EpochRecords, one per epoch | [id](id/README.md) | superseded by A170 in part |
| [A130](DECISIONS.md) | A device's ML-DSA ξ exists only while a segment closes | [id](id/README.md) | yes |
| [A129](DECISIONS.md) | `Doc::held()` by name; the unfit set is local and never stored | [docs](docs/README.md) | yes |
| [A128](DECISIONS.md) | A Held page reopens a Doc | [docs](docs/README.md) | yes |
| [A127](DECISIONS.md) | A commit is `prepare` → `signing` → `finish` | [docs](docs/README.md) | yes |
| [A126](DECISIONS.md) | All architecture moves into one document and its chapters; READMEs keep no design | process | superseded by A158 in part |
| [A125](DECISIONS.md) | ARCHITECTURE.md and the Lean are avenDB's single source of truth (#1728) | process | yes |
| [A124](DECISIONS.md) | The fetch gate names a Doc by id; prove only to known holders | [peers](peers/README.md) | superseded by A143 |
| [A123](DECISIONS.md) | Stanza lists padded to `padme (max n 4)`; tag seeds from the epoch before (D18) | [id](id/README.md) | yes |
| [A122](DECISIONS.md) | The fetch gate's frames and bounds on aven/db/1 | [peers](peers/README.md) | superseded by A133 in part |
| [A121](DECISIONS.md) | The keyring is a vault's own Doc, the only Doc sealed to devices | [id](id/README.md) | yes |
| [A120](DECISIONS.md) | A device's ML-DSA key: generated beside `device-key`, bound by its owner | [id](id/README.md) | superseded by A156 |
| [A119](DECISIONS.md) | One docs worker judges every open Doc; unfit only when it crashes again alone | [docs](docs/README.md) | yes |
| [A118](DECISIONS.md) | Docs in the Peers: a topic per Doc, blind gossip, frames by topic, local first without a Peer | [peers](peers/README.md) | superseded by A122 in part, A143 |
| [A117](DECISIONS.md) | The keeper's store layout and pure crate; `dropped_listed` | [peers](peers/README.md) | superseded by A122 |
| [A116](DECISIONS.md) | Owner changes settle one way everywhere; a removal beats the removed (`removal_beats`) | [id](id/README.md) | yes |
| [A115](DECISIONS.md) | The tree counts with Core; belonging is `e.doc = pinned` plus docs' genesis check | [id](id/README.md) | yes |
| [A114](DECISIONS.md) | k of n on the tree; an ownerless passkey counts only for adding its owner | [id](id/README.md) | yes |
| [A113](DECISIONS.md) | Readers sync by version; keepers serve by arrival number; both the Peers' | [peers](peers/README.md) | yes |
| [A112](DECISIONS.md) | The clean-slate cutover in seven stages | process | yes |
| [A111](DECISIONS.md) | One node-tree allowlist, the runtimes'; tree.js's check goes | [runtime](runtime/README.md) | yes |
| [A110](DECISIONS.md) | markdown-runtime resolves links itself, lexically; `base` and prefixes are params | [runtime](runtime/README.md) | yes |
| [A109](DECISIONS.md) | Core names every plugin's ops (`OpId.ofPlugin`) and built-in types (`builtinType ns name`) | [core](core/README.md) | yes |
| [A108](DECISIONS.md) | "core" means only Core: `aven-db-core` → `aven-gen1` | [core](core/README.md) | yes |
| [A107](DECISIONS.md) | The member cap's lines; caps and revocations named by A30 | [id](id/README.md) | yes |
| [A106](DECISIONS.md) | An envelope's authority is one Value `{acks, caps}` (`Aven.ID.Authority`) | [id](id/README.md) | yes |
| [A105](DECISIONS.md) | The confirm envelope is the issuance of a member cap | [id](id/README.md) | yes |
| [A104](DECISIONS.md) | avenID's cap, revoke and epoch Records inside a Doc; `idBuiltinFit` | [id](id/README.md) | yes |
| [A103](DECISIONS.md) | Sign-ins go into the migration snapshot | [peers](peers/README.md) | yes |
| [A102](DECISIONS.md) | Frozen runtime bytes are committed in git until runtimes are avenDB blobs | [runtime](runtime/README.md) | yes |
| [A101](DECISIONS.md) | `put` mints a new Record; one freshness hypothesis, the engine's `Fresh` | [ops](ops/README.md) | yes |
| [A100](DECISIONS.md) | Authority runs down through quorums; a cap's issuer is a vault, proven by sigs | [id](id/README.md) | yes |
| [A99](DECISIONS.md) | Every face draws border-box | [runtime](runtime/README.md) | yes |
| [A98](DECISIONS.md) | The codec is its own crate, `aven-codec` | [core](core/README.md) | yes |
| [A97](DECISIONS.md) | A migrated passkey gets its owner by the owner-epoch op | [peers](peers/README.md) | yes |
| [A96](DECISIONS.md) | A Record id's Loro key is lowercase hex; one `Version {type, schema?}` | [ops](ops/README.md) | yes |
| [A95](DECISIONS.md) | The genesis rides exactly in a log's first envelope; `builtinFit` by the definer | [docs](docs/README.md) | yes |
| [A94](DECISIONS.md) | Many signatures beside one name, exactly (`Sig`, `writes`, `placed`, `Closed`) | [core](core/README.md) | yes |
| [A93](DECISIONS.md) | One Padmé, `Aven.ID.Padme` | [id](id/README.md) | yes |
| [A92](DECISIONS.md) | A refused sign-up signals its orphan passkey; older vaults without PRF still sign in | [id](id/README.md) | superseded by A97 in part |
| [A91](DECISIONS.md) | `id/1` is avenID's plugin | [id](id/README.md) | yes |
| [A90](DECISIONS.md) | `core/1`'s lowering is the engine's; `lower` a parameter; a removed field counts as written | [ops](ops/README.md) | yes |
| [A89](DECISIONS.md) | The runtime manifest (no floor, append-only) and a deterministic host (no floats, threads, SIMD) | [runtime](runtime/README.md) | yes |
| [A88](DECISIONS.md) | A call is canonical or isn't one; ids are 32 bytes | [core](core/README.md) | yes |
| [A87](DECISIONS.md) | Strangers never reach Loro; `catch_unwind`; judge worker; fuzzing; page-at-a-time imports | [docs](docs/README.md) | superseded by A119 in part |
| [A86](DECISIONS.md) | A file's bytes decide its type; no head means an attachment | [runtime](runtime/README.md) | yes |
| [A85](DECISIONS.md) | A slide's style has one source, `.style.json`; CSS only by `ruleCss` after `ruleOk` | [os](os/README.md) | yes |
| [A84](DECISIONS.md) | A face never draws outside its host (`:host` containment) | [runtime](runtime/README.md) | yes |
| [A83](DECISIONS.md) | A Record's type never changes (`typesKept`) | [ops](ops/README.md) | yes |
| [A82](DECISIONS.md) | One seal (`Aven.ID.Seal`) for envelopes, segments and checkpoints | [id](id/README.md) | yes |
| [A81](DECISIONS.md) | The docs formats: genesis, body, segment, head, built-in types, crate | [docs](docs/README.md) | superseded by A106 in part |
| [A80](DECISIONS.md) | The passkey record `{credential, spki, owner, seal, epoch}` and the sign-in, exactly | [id](id/README.md) | yes |
| [A79](DECISIONS.md) | A missing PRF is detected from `prf.enabled` or a missing output, never the user agent | [id](id/README.md) | yes |
| [A78](DECISIONS.md) | `user.id` names the vault (two taps on a new browser) | [id](id/README.md) | superseded by A80 |
| [A77](DECISIONS.md) | The PRF step's browser half; the output only inside the Peer-Light's wasm | [id](id/README.md) | yes |
| [A76](DECISIONS.md) | Collections nest at most 8 deep; `CapKind` → `CapForm` | [id](id/README.md) | yes |
| [A75](DECISIONS.md) | `OpId := Hash`; fixed ids `{plugin, op}`; one call form `{op, params}` | [core](core/README.md) | yes |
| [A74](DECISIONS.md) | An epoch is named without its stanzas | [id](id/README.md) | yes |
| [A73](DECISIONS.md) | Core's limits (`Aven.Core.Limits`; ≤ 16 sigs) | [core](core/README.md) | yes |
| [A72](DECISIONS.md) | avenID's key formats: BLAKE3 modes, hybrid encoding, KeyFormats, key-committing stanzas | [id](id/README.md) | yes |
| [A71](DECISIONS.md) | One registry crate, shared by the Peer (by path) and the browser (Peer-Light's wasm) | [runtime](runtime/README.md) | yes |
| [A70](DECISIONS.md) | Core's past is generic over named things; `Past.tips` → `parents` | [core](core/README.md) | yes |
| [A69](DECISIONS.md) | Slide text ≥ 2.6cqw (≥ 9 px at a 356 px slide) | [runtime](runtime/README.md) | yes |
| [A68](DECISIONS.md) | The tree's statements are op calls of `tree/1`; full rewrite, no bridge | [id](id/README.md) | yes |
| [A67](DECISIONS.md) | Built-in root types `keyring`, `safe`, `group`; Core's type of types | [id](id/README.md) | yes |
| [A66](DECISIONS.md) | A cap line is `{op, doc, params}`; bounds are enumerations | [id](id/README.md) | yes |
| [A65](DECISIONS.md) | `Signed.name` leaves the signer out | [core](core/README.md) | yes |
| [A64](DECISIONS.md) | Production's members get member caps at the switch | [peers](peers/README.md) | yes |
| [A63](DECISIONS.md) | Confirming a claim: a standing, revocable cap from Maia City to Aven's vault | [id](id/README.md) | yes |
| [A62](DECISIONS.md) | A collection is one target for every op; directories and keep scopes become collections | [id](id/README.md) | yes |
| [A61](DECISIONS.md) | One list of file types (the registry replaces `passive`, `kind()`, keep.rs's `mime`) | [runtime](runtime/README.md) | yes |
| [A60](DECISIONS.md) | A sign-in is a device cap; removing a device revokes it | [id](id/README.md) | yes |
| [A59](DECISIONS.md) | A delete on the vault's own authority ends a Doc for every reader | [id](id/README.md) | yes |
| [A58](DECISIONS.md) | Slides render through face-runtime; CSS compiled to Style; no `url()` or custom properties | [os](os/README.md) | superseded by A111 in part |
| [A57](DECISIONS.md) | The wire version is in the hello and the room's topic name; `update`, no fallback | [peers](peers/README.md) | yes |
| [A56](DECISIONS.md) | Only a write line allows a step; footprints only on write lines | [id](id/README.md) | yes |
| [A55](DECISIONS.md) | Production's migration: checked on the real store, pre-flight then switch, no dual mode | [peers](peers/README.md) | yes |
| [A54](DECISIONS.md) | face-runtime's contrast check (ancestors, full-bleed siblings; partial layers unseen) | [runtime](runtime/README.md) | yes |
| [A53](DECISIONS.md) | Node trees ≤ 20,000 nodes; markdown-runtime: raw HTML as text, images only by hash | [runtime](runtime/README.md) | yes |
| [A52](DECISIONS.md) | Core's CBOR nests at most 512 deep | [core](core/README.md) | yes |
| [A51](DECISIONS.md) | `aven-core` lives at `aven/DB2/core`; `aven/runtimes` is its own workspace | [core](core/README.md) | yes |
| [A50](DECISIONS.md) | The docs are in English | [os](os/README.md) | yes |
| [A49](DECISIONS.md) | avenBRAIN holds all documentation: a visual wiki, one concept per slide, the glossary | [os](os/README.md) | yes |
| [A48](DECISIONS.md) | A writer id is the first of four windows that isn't Loro's reserved value; 0 if none | [docs](docs/README.md) | yes |
| [A47](DECISIONS.md) | A writer id's exact layout (derive_key `avenDB writer 1`, first 8 bytes LE) | [docs](docs/README.md) | superseded by A48 in part |
| [A46](DECISIONS.md) | `Aven.ID.Past` moves into Core as `Aven.Core.Past` | [core](core/README.md) | yes |
| [A45](DECISIONS.md) | One concept, one owner | this page | superseded by A159 in part, A206 in part |
| [A44](DECISIONS.md) | Placement has one source: the owner's vault | [caps](caps/README.md) | superseded by A144 in part |
| [A43](DECISIONS.md) | The Doc foundation comes first | process | superseded by A112 in part |
| [A42](DECISIONS.md) | The contradictions of 31 Oct | [caps](caps/README.md) | superseded by A148 in part |
| [A41](DECISIONS.md) | avenOS's documentation is "Brain" | [os](os/README.md) | yes |
| [A40](DECISIONS.md) | Holdings follow caps | [caps](caps/README.md) | yes |
| [A39](DECISIONS.md) | Every Doc has a type, always | [docs](docs/README.md) | yes |
| [A38](DECISIONS.md) | Membership is a cap | [caps](caps/README.md) | yes |
| [A37](DECISIONS.md) | state-runtime returns K8's steps | [runtime](runtime/README.md) | yes |
| [A36](DECISIONS.md) | Releases | [sandbox](sandbox/README.md) | yes |
| [A35](DECISIONS.md) | One presence | [peers](peers/README.md) | yes |
| [A34](DECISIONS.md) | Catch-up on Doc logs only | [peers](peers/README.md) | yes |
| [A33](DECISIONS.md) | An actor's message is an envelope | [actors](actors/README.md) | yes |
| [A32](DECISIONS.md) | Caps are built from ops | [caps](caps/README.md) | yes |
| [A31](DECISIONS.md) | Two kinds of signed thing | [core](core/README.md) | yes |
| [A30](DECISIONS.md) | One name for a signed thing | [core](core/README.md) | yes |
| [A29](DECISIONS.md) | Frames in CBOR | [peers](peers/README.md) | yes |
| [A28](DECISIONS.md) | Vaults own; signers only sign | [caps](caps/README.md) | yes |
| [A27](DECISIONS.md) | An actor host writes only under its actors' chains | [actors](actors/README.md) | yes |
| [A26](DECISIONS.md) | Sealed indexes | [ops](ops/README.md) | yes |
| [A25](DECISIONS.md) | Publish the six audits | process | yes |
| [A24](DECISIONS.md) | The layers | this page | yes |
| [A23](DECISIONS.md) | Acks can't launder | [caps](caps/README.md) | yes |
| [A22](DECISIONS.md) | A peer that keeps sealed data for others checks who may add or fetch it, without reading it | [caps](caps/README.md) | superseded by A141 in part |
| [A21](DECISIONS.md) | Search is local first | [ops](ops/README.md) | yes |
| [A20](DECISIONS.md) | Facts for relations, Records for documents | [ops](ops/README.md) | yes |
| [A19](DECISIONS.md) | One update grammar | [ops](ops/README.md) | yes |
| [A18](DECISIONS.md) | Plugins are runtimes | [ops](ops/README.md) | yes |
| [A17](DECISIONS.md) | Actors fold into docs | [actors](actors/README.md) | yes |
| [A16](DECISIONS.md) | Hosting an actor on the Aven Peer is an explicit read cap | [actors](actors/README.md) | yes |
| [A15](DECISIONS.md) | Three origins | [os](os/README.md) | yes |
| [A14](DECISIONS.md) | A dedicated passkey RP ID for avenOS | [os](os/README.md) | yes |
| [A13](DECISIONS.md) | The guardian is named, with hybrid keys, in every claim and join text | [id](id/README.md) | yes |
| [A12](DECISIONS.md) | The tree is a Doc of signed statements | [caps](caps/README.md) | superseded by A63 in part |
| [A11](DECISIONS.md) | A signed genesis | [caps](caps/README.md) | yes |
| [A10](DECISIONS.md) | The network is a group | [caps](caps/README.md) | yes |
| [A9](DECISIONS.md) | The want queue | [ops](ops/README.md) | yes |
| [A8](DECISIONS.md) | One target grammar | [core](core/README.md) | yes |
| [A7](DECISIONS.md) | A Doc pins the type versions it accepts | [docs](docs/README.md) | yes |
| [A6](DECISIONS.md) | Collections that grow without end are chains of period Docs | [docs](docs/README.md) | yes |
| [A5](DECISIONS.md) | Checkpoints travel | [docs](docs/README.md) | yes |
| [A4](DECISIONS.md) | Splits are final | [core](core/README.md) | yes |
| [A3](DECISIONS.md) | Envelopes name what they build on by hash | [core](core/README.md) | yes |
| [A2](DECISIONS.md) | One codec and signing rule | [core](core/README.md) | superseded by A174 in part |
| [A1](DECISIONS.md) | One vocabulary | [glossary](GLOSSARY.md) | superseded by A175 in part |

The package lists' decisions, below A1 in the log, that a later decision supersedes (every other one still holds, cited on its page):

| Imported | Superseded by |
|---|---|
| caps D21 | [A141](DECISIONS.md) in part |
| docs 24 | [A81](DECISIONS.md) |
| rule 15 | [A148](DECISIONS.md) in part, [A178](DECISIONS.md) in part |
| runtimes 4 | [A71](DECISIONS.md) in part |
| runtimes 9 | [A111](DECISIONS.md) in part |
| runtimes 11 | [A102](DECISIONS.md) |
