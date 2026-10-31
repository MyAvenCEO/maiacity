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
- **The decision log is the history.** It only grows: an entry is never edited, and a change of mind is a new entry
  naming the one it supersedes (checked by `aven/ops/devx/decisions.mjs`). The architect is its only writer.
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
| avenPEERS | the Peer and Peer-Light, the wire, gossip per group, sync, catch-up, keepers, the fetch gate, relays, presence, upgrades, deploy | [peers](peers/README.md) | `peer` | `Aven.DB.Wire`, `Aven.Peer` |
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
| 2. Authority in Lean | vault authority, member caps, the tree's passkey records and migration snapshot, k of n | merged (#1717, #1718, #1735); k of n and owner changes in progress |
| 3. Docs in the Peers | the Doc host, gossip per group, sync by version, the docs worker | native host built (#1727); the browser and the frames in progress |
| 4. The tree as the first Doc | the register on Core's counting, its setup as the root Record, sign-in keys bound | in progress |
| 5. Catch-up and keepers | arrivals, covers, bills, the fetch gate, catch-up by arrival number | native catch-up built (#1722); caps' half merged (#1734) |
| 6. The chat as a fresh Doc | messages as Records, the screen on avenOPS queries, files behind the gate | not started |
| 7. Rehearsal and cutover | production's snapshot replayed in the box, then release, deploy, delete `aven-gen1` | not started |

## Every decision

Every A-number in [the log](DECISIONS.md): what it decided, the page that states it now, and whether it still holds.
A decision superseded in part still holds for the rest. The table is generated from the log; an entry's own text,
reasons and Lean are in the log.

| Decision | What | Page | Holds |
|---|---|---|---|
| [A1](DECISIONS.md#from-architecturemd) | One vocabulary | [glossary](GLOSSARY.md) | superseded by A175 in part |
| [A2](DECISIONS.md#from-architecturemd) | One codec and signing rule | [core](core/README.md) | superseded by A174 in part |
| [A3](DECISIONS.md#from-architecturemd) | Envelopes name what they build on by hash | [core](core/README.md) | yes |
| [A4](DECISIONS.md#from-architecturemd) | Splits are final | [core](core/README.md) | yes |
| [A5](DECISIONS.md#from-architecturemd) | Checkpoints travel | [docs](docs/README.md) | yes |
| [A6](DECISIONS.md#from-architecturemd) | Collections that grow without end are chains of period Docs | [docs](docs/README.md) | yes |
| [A7](DECISIONS.md#from-architecturemd) | A Doc pins the type versions it accepts | [docs](docs/README.md) | yes |
| [A8](DECISIONS.md#from-architecturemd) | One target grammar | [core](core/README.md) | yes |
| [A9](DECISIONS.md#from-architecturemd) | The want queue | [ops](ops/README.md) | yes |
| [A10](DECISIONS.md#from-architecturemd) | The network is a group | [caps](caps/README.md) | yes |
| [A11](DECISIONS.md#from-architecturemd) | A signed genesis | [caps](caps/README.md) | yes |
| [A12](DECISIONS.md#from-architecturemd) | The tree is a Doc of signed statements | [caps](caps/README.md) | superseded by A63 in part |
| [A13](DECISIONS.md#from-architecturemd) | The guardian is named, with hybrid keys, in every claim and join text | [id](id/README.md) | yes |
| [A14](DECISIONS.md#from-architecturemd) | A dedicated passkey RP ID for avenOS | [os](os/README.md) | yes |
| [A15](DECISIONS.md#from-architecturemd) | Three origins | [os](os/README.md) | yes |
| [A16](DECISIONS.md#from-architecturemd) | Hosting an actor on the Aven Peer is an explicit read cap | [actors](actors/README.md) | yes |
| [A17](DECISIONS.md#from-architecturemd) | Actors fold into docs | [actors](actors/README.md) | yes |
| [A18](DECISIONS.md#from-architecturemd) | Plugins are runtimes | [ops](ops/README.md) | yes |
| [A19](DECISIONS.md#from-architecturemd) | One update grammar | [ops](ops/README.md) | yes |
| [A20](DECISIONS.md#from-architecturemd) | Facts for relations, Records for documents | [ops](ops/README.md) | yes |
| [A21](DECISIONS.md#from-architecturemd) | Search is local first | [ops](ops/README.md) | yes |
| [A22](DECISIONS.md#from-architecturemd) | A peer that keeps sealed data for others checks who may add or fetch it, without reading it | [caps](caps/README.md) | superseded by A141 in part |
| [A23](DECISIONS.md#from-architecturemd) | Acks can't launder | [caps](caps/README.md) | superseded by A182 |
| [A24](DECISIONS.md#from-architecturemd) | The layers | this page | yes |
| [A25](DECISIONS.md#from-architecturemd) | Publish the six audits | process | yes |
| [A26](DECISIONS.md#from-architecturemd) | Sealed indexes | [ops](ops/README.md) | yes |
| [A27](DECISIONS.md#from-architecturemd) | An actor host writes only under its actors' chains | [actors](actors/README.md) | yes |
| [A28](DECISIONS.md#from-architecturemd) | Vaults own; signers only sign | [caps](caps/README.md) | yes |
| [A29](DECISIONS.md#from-architecturemd) | Frames in CBOR | [peers](peers/README.md) | yes |
| [A30](DECISIONS.md#from-architecturemd) | One name for a signed thing | [core](core/README.md) | yes |
| [A31](DECISIONS.md#from-architecturemd) | Two kinds of signed thing | [core](core/README.md) | yes |
| [A32](DECISIONS.md#from-architecturemd) | Caps are built from ops | [caps](caps/README.md) | yes |
| [A33](DECISIONS.md#from-architecturemd) | An actor's message is an envelope | [actors](actors/README.md) | yes |
| [A34](DECISIONS.md#from-architecturemd) | Catch-up on Doc logs only | [peers](peers/README.md) | yes |
| [A35](DECISIONS.md#from-architecturemd) | One presence | [peers](peers/README.md) | yes |
| [A36](DECISIONS.md#from-architecturemd) | Releases | [sandbox](sandbox/README.md) | yes |
| [A37](DECISIONS.md#from-architecturemd) | state-runtime returns K8's steps | [runtime](runtime/README.md) | yes |
| [A38](DECISIONS.md#from-architecturemd) | Membership is a cap | [caps](caps/README.md) | yes |
| [A39](DECISIONS.md#from-architecturemd) | Every Doc has a type, always | [docs](docs/README.md) | yes |
| [A40](DECISIONS.md#from-architecturemd) | Holdings follow caps | [caps](caps/README.md) | yes |
| [A41](DECISIONS.md#from-architecturemd) | avenOS's documentation is "Brain" | [os](os/README.md) | yes |
| [A42](DECISIONS.md#from-architecturemd) | The contradictions of 31 Oct | [caps](caps/README.md) | superseded by A148 in part |
| [A43](DECISIONS.md#from-architecturemd) | The Doc foundation comes first | process | superseded by A112 in part |
| [A44](DECISIONS.md#from-architecturemd) | Placement has one source: the owner's vault | [caps](caps/README.md) | superseded by A144 in part |
| [A45](DECISIONS.md#from-architecturemd) | One concept, one owner | this page | superseded by A159 in part |
| [A46](DECISIONS.md#a46--computing-an-envelopes-past-is-cores) | `Aven.ID.Past` moves into Core as `Aven.Core.Past` | [core](core/README.md) | yes |
| [A47](DECISIONS.md#a47--a-writer-ids-exact-layout) | A writer id's exact layout (derive_key `avenDB writer 1`, first 8 bytes LE) | [docs](docs/README.md) | superseded by A48 in part |
| [A48](DECISIONS.md#a48--a-writer-id-is-never-loros-reserved-value) | A writer id is the first of four windows that isn't Loro's reserved value; 0 if none | [docs](docs/README.md) | yes |
| [A49](DECISIONS.md#a49--avenbrain-holds-the-documentation-a-visual-wiki-one-concept-per-slide) | avenBRAIN holds all documentation: a visual wiki, one concept per slide, the glossary | [os](os/README.md) | yes |
| [A50](DECISIONS.md#a50--the-docs-are-in-english) | The docs are in English | [os](os/README.md) | yes |
| [A51](DECISIONS.md#a51--cores-rust-crate-lives-beside-its-lean-the-runtimes-keep-their-own-workspace) | `aven-core` lives at `aven/DB2/core`; `aven/runtimes` is its own workspace | [core](core/README.md) | yes |
| [A52](DECISIONS.md#a52--cores-cbor-nests-at-most-512-deep) | Core's CBOR nests at most 512 deep | [core](core/README.md) | yes |
| [A53](DECISIONS.md#a53--node-trees-hold-at-most-20000-nodes-markdown-runtimes-first-rules) | Node trees ≤ 20,000 nodes; markdown-runtime: raw HTML as text, images only by hash | [runtime](runtime/README.md) | yes |
| [A54](DECISIONS.md#a54--face-runtimes-contrast-check) | face-runtime's contrast check (ancestors, full-bleed siblings; partial layers unseen) | [runtime](runtime/README.md) | yes |
| [A55](DECISIONS.md#a55--productions-migration-is-checked-on-its-real-store-with-no-dual-mode) | Production's migration: checked on the real store, pre-flight then switch, no dual mode | [peers](peers/README.md) | yes |
| [A56](DECISIONS.md#a56--only-a-write-line-allows-a-step) | Only a write line allows a step; footprints only on write lines | [id](id/README.md) | yes |
| [A57](DECISIONS.md#a57--the-wire-version-lives-in-the-hello-and-in-the-rooms-name) | The wire version is in the hello and the room's topic name; `update`, no fallback | [peers](peers/README.md) | yes |
| [A58](DECISIONS.md#a58--slides-render-through-face-runtime) | Slides render through face-runtime; CSS compiled to Style; no `url()` or custom properties | [os](os/README.md) | superseded by A111 in part |
| [A59](DECISIONS.md#a59--a-delete-on-the-vaults-own-authority-ends-a-doc-for-every-reader) | A delete on the vault's own authority ends a Doc for every reader | [id](id/README.md) | yes |
| [A60](DECISIONS.md#a60--a-sign-in-is-a-device-cap) | A sign-in is a device cap; removing a device revokes it | [id](id/README.md) | yes |
| [A61](DECISIONS.md#a61--one-list-of-file-types) | One list of file types (the registry replaces `passive`, `kind()`, keep.rs's `mime`) | [runtime](runtime/README.md) | yes |
| [A62](DECISIONS.md#a62--a-collection-is-one-target-for-every-op) | A collection is one target for every op; directories and keep scopes become collections | [id](id/README.md) | yes |
| [A63](DECISIONS.md#a63--confirming-a-claim-is-a-standing-cap-held-by-avens-vault) | Confirming a claim: a standing, revocable cap from Maia City to Aven's vault | [id](id/README.md) | yes |
| [A64](DECISIONS.md#a64--productions-members-get-member-caps-at-the-switch) | Production's members get member caps at the switch | [peers](peers/README.md) | yes |
| [A65](DECISIONS.md#a65--a-signed-things-name-leaves-its-signer-out) | `Signed.name` leaves the signer out | [core](core/README.md) | yes |
| [A66](DECISIONS.md#a66--a-cap-line-is-op-doc-params-bounds-are-enumerations) | A cap line is `{op, doc, params}`; bounds are enumerations | [id](id/README.md) | yes |
| [A67](DECISIONS.md#a67--avenids-built-in-root-types-and-the-type-of-types) | Built-in root types `keyring`, `safe`, `group`; Core's type of types | [id](id/README.md) | yes |
| [A68](DECISIONS.md#a68--the-trees-statements-are-op-calls-of-tree1) | The tree's statements are op calls of `tree/1`; full rewrite, no bridge | [id](id/README.md) | yes |
| [A69](DECISIONS.md#a69--slide-text-is-at-least-26cqw) | Slide text ≥ 2.6cqw (≥ 9 px at a 356 px slide) | [runtime](runtime/README.md) | yes |
| [A70](DECISIONS.md#a70--cores-past-is-generic-over-named-things) | Core's past is generic over named things; `Past.tips` → `parents` | [core](core/README.md) | yes |
| [A71](DECISIONS.md#a71--one-file-type-registry-crate-shared-by-the-peer-and-the-browser) | One registry crate, shared by the Peer (by path) and the browser (Peer-Light's wasm) | [runtime](runtime/README.md) | yes |
| [A72](DECISIONS.md#a72--avenids-key-formats) | avenID's key formats: BLAKE3 modes, hybrid encoding, KeyFormats, key-committing stanzas | [id](id/README.md) | yes |
| [A73](DECISIONS.md#a73--cores-limits) | Core's limits (`Aven.Core.Limits`; ≤ 16 sigs) | [core](core/README.md) | yes |
| [A74](DECISIONS.md#a74--an-epoch-is-named-without-its-stanzas) | An epoch is named without its stanzas | [id](id/README.md) | yes |
| [A75](DECISIONS.md#a75--op-ids-and-one-call-form) | `OpId := Hash`; fixed ids `{plugin, op}`; one call form `{op, params}` | [core](core/README.md) | yes |
| [A76](DECISIONS.md#a76--collections-nest-at-most-8-deep-capform) | Collections nest at most 8 deep; `CapKind` → `CapForm` | [id](id/README.md) | yes |
| [A77](DECISIONS.md#a77--the-prf-steps-browser-half) | The PRF step's browser half; the output only inside the Peer-Light's wasm | [id](id/README.md) | yes |
| [A78](DECISIONS.md#a78--userid-names-the-vault) | `user.id` names the vault (two taps on a new browser) | [id](id/README.md) | superseded by A80 |
| [A79](DECISIONS.md#a79--how-a-missing-prf-is-detected) | A missing PRF is detected from `prf.enabled` or a missing output, never the user agent | [id](id/README.md) | yes |
| [A80](DECISIONS.md#a80--the-passkey-record-and-the-sign-in-exactly) | The passkey record `{credential, spki, owner, seal, epoch}` and the sign-in, exactly | [id](id/README.md) | yes |
| [A81](DECISIONS.md#a81--the-docs-formats) | The docs formats: genesis, body, segment, head, built-in types, crate | [docs](docs/README.md) | superseded by A106 in part |
| [A82](DECISIONS.md#a82--one-seal-for-envelopes-segments-and-checkpoints) | One seal (`Aven.ID.Seal`) for envelopes, segments and checkpoints | [id](id/README.md) | yes |
| [A83](DECISIONS.md#a83--a-records-type-never-changes) | A Record's type never changes (`typesKept`) | [ops](ops/README.md) | yes |
| [A84](DECISIONS.md#a84--a-face-never-draws-outside-its-host) | A face never draws outside its host (`:host` containment) | [runtime](runtime/README.md) | yes |
| [A85](DECISIONS.md#a85--a-slides-style-has-one-source) | A slide's style has one source, `.style.json`; CSS only by `ruleCss` after `ruleOk` | [os](os/README.md) | yes |
| [A86](DECISIONS.md#a86--a-files-bytes-decide-its-type) | A file's bytes decide its type; no head means an attachment | [runtime](runtime/README.md) | yes |
| [A87](DECISIONS.md#a87--strangers-never-reach-loro) | Strangers never reach Loro; `catch_unwind`; judge worker; fuzzing; page-at-a-time imports | [docs](docs/README.md) | superseded by A119 in part |
| [A88](DECISIONS.md#a88--a-call-is-canonical-or-isnt-a-call) | A call is canonical or isn't one; ids are 32 bytes | [core](core/README.md) | yes |
| [A89](DECISIONS.md#a89--runtimes-load-by-hash-the-manifest-and-the-host) | The runtime manifest (no floor, append-only) and a deterministic host (no floats, threads, SIMD) | [runtime](runtime/README.md) | yes |
| [A90](DECISIONS.md#a90--core1s-lowering-is-the-engines) | `core/1`'s lowering is the engine's; `lower` a parameter; a removed field counts as written | [ops](ops/README.md) | yes |
| [A91](DECISIONS.md#a91--id1-is-avenids-plugin) | `id/1` is avenID's plugin | [id](id/README.md) | yes |
| [A92](DECISIONS.md#a92--a-refused-sign-up-drops-its-orphan-passkey-older-vaults-without-prf-still-sign-in) | A refused sign-up signals its orphan passkey; older vaults without PRF still sign in | [id](id/README.md) | superseded by A97 in part |
| [A93](DECISIONS.md#a93--one-padmé) | One Padmé, `Aven.ID.Padme` | [id](id/README.md) | yes |
| [A94](DECISIONS.md#a94--many-signatures-beside-one-name-exactly) | Many signatures beside one name, exactly (`Sig`, `writes`, `placed`, `Closed`) | [core](core/README.md) | yes |
| [A95](DECISIONS.md#a95--a-logs-first-envelope-carries-the-genesis-built-ins-are-fit-by-their-definer) | The genesis rides exactly in a log's first envelope; `builtinFit` by the definer | [docs](docs/README.md) | yes |
| [A96](DECISIONS.md#a96--a-records-id-as-a-loro-key-one-version) | A Record id's Loro key is lowercase hex; one `Version {type, schema?}` | [ops](ops/README.md) | yes |
| [A97](DECISIONS.md#a97--a-migrated-passkey-gets-its-owner-by-the-owner-epoch-op) | A migrated passkey gets its owner by the owner-epoch op | [peers](peers/README.md) | yes |
| [A98](DECISIONS.md#a98--the-codec-is-its-own-crate-aven-codec) | The codec is its own crate, `aven-codec` | [core](core/README.md) | yes |
| [A99](DECISIONS.md#a99--every-face-draws-border-box) | Every face draws border-box | [runtime](runtime/README.md) | yes |
| [A100](DECISIONS.md#a100--authority-runs-down-through-quorums-a-caps-issuer-is-a-vault) | Authority runs down through quorums; a cap's issuer is a vault, proven by sigs | [id](id/README.md) | yes |
| [A101](DECISIONS.md#a101--put-mints-a-new-record) | `put` mints a new Record; one freshness hypothesis, the engine's `Fresh` | [ops](ops/README.md) | yes |
| [A102](DECISIONS.md#a102--frozen-runtime-bytes-are-committed) | Frozen runtime bytes are committed in git until runtimes are avenDB blobs | [runtime](runtime/README.md) | yes |
| [A103](DECISIONS.md#a103--sign-ins-go-into-the-migration-snapshot) | Sign-ins go into the migration snapshot | [peers](peers/README.md) | yes |
| [A104](DECISIONS.md#a104--avenids-built-in-records-inside-a-doc) | avenID's cap, revoke and epoch Records inside a Doc; `idBuiltinFit` | [id](id/README.md) | yes |
| [A105](DECISIONS.md#a105--the-confirm-envelope-is-the-issuance) | The confirm envelope is the issuance of a member cap | [id](id/README.md) | yes |
| [A106](DECISIONS.md#a106--an-envelopes-authority-is-one-value-acks-caps) | An envelope's authority is one Value `{acks, caps}` (`Aven.ID.Authority`) | [id](id/README.md) | yes |
| [A107](DECISIONS.md#a107--the-member-caps-lines-caps-and-revocations-named-by-a30) | The member cap's lines; caps and revocations named by A30 | [id](id/README.md) | yes |
| [A108](DECISIONS.md#a108--core-means-only-core-the-first-generation-is-aven-gen1) | "core" means only Core: `aven-db-core` → `aven-gen1` | [core](core/README.md) | yes |
| [A109](DECISIONS.md#a109--core-names-every-plugins-ops-and-every-built-in-type) | Core names every plugin's ops (`OpId.ofPlugin`) and built-in types (`builtinType ns name`) | [core](core/README.md) | yes |
| [A110](DECISIONS.md#a110--a-markdown-link-is-resolved-inside-markdown-runtime) | markdown-runtime resolves links itself, lexically; `base` and prefixes are params | [runtime](runtime/README.md) | yes |
| [A111](DECISIONS.md#a111--one-node-tree-allowlist-the-runtimes) | One node-tree allowlist, the runtimes'; tree.js's check goes | [runtime](runtime/README.md) | yes |
| [A112](DECISIONS.md#a112--the-clean-slate-cutover-in-seven-stages) | The clean-slate cutover in seven stages | process | yes |
| [A113](DECISIONS.md#a113--readers-sync-by-version-keepers-serve-by-arrival-number) | Readers sync by version; keepers serve by arrival number; both the Peers' | [peers](peers/README.md) | yes |
| [A114](DECISIONS.md#a114--k-of-n-on-the-tree-a-passkey-without-an-owner-counts-only-for-adding-one) | k of n on the tree; an ownerless passkey counts only for adding its owner | [id](id/README.md) | yes |
| [A115](DECISIONS.md#a115--the-tree-counts-with-core) | The tree counts with Core; belonging is `e.doc = pinned` plus docs' genesis check | [id](id/README.md) | yes |
| [A116](DECISIONS.md#a116--owner-changes-one-winner-everywhere-and-a-removal-beats-the-removed) | Owner changes settle one way everywhere; a removal beats the removed (`removal_beats`) | [id](id/README.md) | yes |
| [A117](DECISIONS.md#a117--the-keepers-store-and-crate) | The keeper's store layout and pure crate; `dropped_listed` | [peers](peers/README.md) | superseded by A122 |
| [A118](DECISIONS.md#a118--docs-in-the-peers-a-topic-per-doc-blind-gossip-frames-named-by-topic) | Docs in the Peers: a topic per Doc, blind gossip, frames by topic, local first without a Peer | [peers](peers/README.md) | superseded by A122 in part, A143 |
| [A119](DECISIONS.md#a119--one-docs-worker-judges-every-open-doc) | One docs worker judges every open Doc; unfit only when it crashes again alone | [docs](docs/README.md) | yes |
| [A120](DECISIONS.md#a120--a-devices-ml-dsa-key-is-generated-and-counts-only-once-its-owner-binds-it) | A device's ML-DSA key: generated beside `device-key`, bound by its owner | [id](id/README.md) | superseded by A156 |
| [A121](DECISIONS.md#a121--the-keyring-is-a-vaults-own-doc) | The keyring is a vault's own Doc, the only Doc sealed to devices | [id](id/README.md) | yes |
| [A122](DECISIONS.md#a122--the-fetch-gates-frames-and-bounds) | The fetch gate's frames and bounds on aven/db/1 | [peers](peers/README.md) | superseded by A133 in part |
| [A123](DECISIONS.md#a123--stanza-lists-are-padded-and-tag-seeds-come-from-the-epoch-before) | Stanza lists padded to `padme (max n 4)`; tag seeds from the epoch before (D18) | [id](id/README.md) | yes |
| [A124](DECISIONS.md#a124--the-fetch-gate-names-a-doc-by-its-id-and-proves-only-to-holders) | The fetch gate names a Doc by id; prove only to known holders | [peers](peers/README.md) | superseded by A143 |
| [A125](DECISIONS.md#a125--architecturemd-and-the-lean-are-avendbs-single-source-of-truth) | ARCHITECTURE.md and the Lean are avenDB's single source of truth (#1728) | process | yes |
| [A126](DECISIONS.md#a126--all-architecture-moves-into-one-document-and-its-chapters) | All architecture moves into one document and its chapters; READMEs keep no design | process | superseded by A158 in part |
| [A127](DECISIONS.md#a127--a-commit-is-prepare-sign-finish) | A commit is `prepare` → `signing` → `finish` | [docs](docs/README.md) | yes |
| [A128](DECISIONS.md#a128--a-held-page-reopens-a-doc) | A Held page reopens a Doc | [docs](docs/README.md) | yes |
| [A129](DECISIONS.md#a129--held-envelopes-by-name-the-unfit-set-is-local) | `Doc::held()` by name; the unfit set is local and never stored | [docs](docs/README.md) | yes |
| [A130](DECISIONS.md#a130--a-devices-ml-dsa-ξ-exists-only-while-a-segment-closes) | A device's ML-DSA ξ exists only while a segment closes | [id](id/README.md) | yes |
| [A131](DECISIONS.md#a131--the-keyrings-records) | The keyring's Records are EpochRecords, one per epoch | [id](id/README.md) | superseded by A170 in part |
| [A132](DECISIONS.md#a132--a-devices-seal-seed-comes-from-its-own-seed) | A device's X-Wing seal seed is derived from its own Ed25519 seed | [id](id/README.md) | yes |
| [A133](DECISIONS.md#a133--the-fetch-gates-frames-exactly) | The fetch gate's frames exactly (`prove_refused`, ≤ 128 hashes, parts ≤ 48 KiB, `keep_`) | [peers](peers/README.md) | superseded by A143 |
| [A134](DECISIONS.md#a134--the-wire-moves-to-aven-peer-wire-doctips-keys) | The wire moves to `aven-peer-wire`; `doc_tips`' keys | [peers](peers/README.md) | superseded by A143 in part |
| [A135](DECISIONS.md#a135--the-tree-on-the-doc-host) | The tree on the Doc host: its `BuiltinFit` and `Authorize` | [id](id/README.md) | yes |
| [A136](DECISIONS.md#a136--tips-are-log-heads) | Tips are log heads `{writer, seq, name}` | [peers](peers/README.md) | yes |
| [A137](DECISIONS.md#a137--authorize-judges-an-envelope-on-its-own-counted-past) | Authorize judges an envelope on its own counted past | [docs](docs/README.md) | yes |
| [A138](DECISIONS.md#a138--the-decision-log-is-append-only) | The decision log is append-only; the architect is its only writer | process | yes |
| [A139](DECISIONS.md#a139--held-and-spent-in-caps-keep) | Held and spent in caps' Keep | [id](id/README.md) | superseded by A141 |
| [A140](DECISIONS.md#a140--the-peer-image-takes-its-crates-from-one-list) | The Peer image takes its crates from one list (`tag.mjs` reads `Cargo.toml`) | [peers](peers/README.md) | yes |
| [A141](DECISIONS.md#a141--the-keeper-owns-its-bill-and-admission) | The keeper owns its bill and admission; the earliest remaining uploader's vault pays | [peers](peers/README.md) | yes |
| [A142](DECISIONS.md#a142--the-fetch-proofs-tls-exporter) | The fetch proof's TLS exporter (`EXPORTER-avenDB-fetch-1`, 32 bytes) | [peers](peers/README.md) | yes |
| [A143](DECISIONS.md#a143--gossip-per-group-not-per-doc) | Gossip per group, not per Doc; `doc_tips`/`doc_have` name their Doc | [peers](peers/README.md) | yes |
| [A144](DECISIONS.md#a144--after-the-cutover-a-files-chunks-are-doc-values-behind-the-one-gate) | After the cutover a file's chunks are Doc Values behind the one gate | [store](store/README.md) | yes |
| [A145](DECISIONS.md#a145--a-limit-follows-its-primitives-owner) | A limit follows its primitive's owner | [core](core/README.md) | yes |
| [A146](DECISIONS.md#a146--the-trees-setup-is-its-root-record) | The tree's setup is its root Record | [id](id/README.md) | yes |
| [A147](DECISIONS.md#a147--authorize-is-a-function-of-the-envelope-and-its-counted-past) | Authorize = f(envelope, its counted past); concurrency only in the tree's settle | [docs](docs/README.md) | superseded by A182 |
| [A148](DECISIONS.md#a148--public-means-the-networks-members) | "Public" means the network's members | [id](id/README.md) | yes |
| [A149](DECISIONS.md#a149--a-genesis-stays-exact-what-a-doc-refers-to-at-birth-is-in-its-root-record) | A genesis stays exact; birth references live in the root Record | [docs](docs/README.md) | yes |
| [A150](DECISIONS.md#a150--checkpoints-come-after-the-cutover) | Checkpoints come after the cutover; their kind is the uploader's word | [docs](docs/README.md) | yes |
| [A151](DECISIONS.md#a151--a-peers-doc-shelf) | A peer's Doc shelf: blobs by hash, `doc-<id>-held` then `doc-<id>` by CAS | [peers](peers/README.md) | yes |
| [A152](DECISIONS.md#a152--a-live-gossip-message) | A live gossip message `{sealed}` or `{hash}` | [peers](peers/README.md) | superseded by A154 in part |
| [A153](DECISIONS.md#a153--a-keeper-takes-an-upload-when-the-bill-doesnt-grow) | A keeper takes an upload when the bill after it fits the quota or doesn't grow | [peers](peers/README.md) | yes |
| [A154](DECISIONS.md#a154--group-topics-and-what-a-groups-topic-carries) | Group topics `groupTopic(wire, key)`; Live `{sealed}`/`{doc, hash}`/`{doc, version}`; the members' and keyring groups | [peers](peers/README.md) | yes |
| [A155](DECISIONS.md#a155--a-sealed-live-message-names-its-doc-once) | A sealed live message names its Doc once (the seal's outside) | [peers](peers/README.md) | yes |
| [A156](DECISIONS.md#a156--a-devices-keys-as-built) | A device's ML-DSA ξ and X-Wing seed derived from its Ed25519 seed, as built (#1731) | [id](id/README.md) | yes |
| [A157](DECISIONS.md#a157--package-names) | Package names: avenDB, avenCORE, avenID, avenCAPS, avenDOCS, avenOPS, avenSTORE, avenPEERS, avenRUNTIME, avenACTORS, avenOS, avenBRAIN, avenSANDBOX | process | yes |
| [A158](DECISIONS.md#a158--avenbrain-is-the-architectures-one-location) | avenBRAIN is the architecture's one location: index, log, glossary, a page per package | process | yes |
| [A159](DECISIONS.md#a159--avencaps-is-its-own-package) | avenCAPS is its own package; avenID is keys, sealing, vaults and owners | [caps](caps/README.md) | yes |
| [A160](DECISIONS.md#a160--the-register-is-avencapss) | The register (`tree/1`) is avenCAPS's | [caps](caps/README.md) | yes |
| [A161](DECISIONS.md#a161--keepers-fetch-keys-and-records) | Fetch keys Ed25519 from `avenDB fetch key 1`; the proof's form is caps' | [caps](caps/README.md) | yes |
| [A162](DECISIONS.md#a162--a-vault-is-named-by-32-bytes) | A vault is named by 32 bytes in every format | [id](id/README.md) | yes |
| [A163](DECISIONS.md#a163--who-signs-the-keepers-records-and-their-exact-shapes) | Who signs the keeper's records; listing, link, order, choice shapes; no nulls | [caps](caps/README.md) | yes |
| [A164](DECISIONS.md#a164--a-vaults-name-comes-from-its-own-genesis) | A vault's name is the A30 name of `["avenID vault 1", {kind, nonce}]` | [id](id/README.md) | yes |
| [A165](DECISIONS.md#a165--the-claude-doc-is-superseded) | The Claude Doc is superseded by avenBRAIN | process | yes |
| [A166](DECISIONS.md#a166--a-reader-finds-a-keepers-items-kind-by-commitment) | A reader finds a keeper's item's kind by commitment | [docs](docs/README.md) | yes |
| [A167](DECISIONS.md#a167--rule-10-stays-composed) | Rule 10 stays composed over the keeper's and caps' theorems | process | yes |
| [A168](DECISIONS.md#a168--box-checks-run-the-real-path) | Box checks run the real path; no keys from cast config | [sandbox](sandbox/README.md) | yes |
| [A169](DECISIONS.md#a169--who-implements-authorize) | avenDOCS defines Authorize; avenCAPS a pure verdict; avenPEERS the adapter | [peers](peers/README.md) | yes |
| [A170](DECISIONS.md#a170--the-keyrings-records-are-write-once) | The keyring's `epoch` Records are write-once; a reseal adds a Record | [id](id/README.md) | superseded by A185 in part |
| [A171](DECISIONS.md#a171--threads-never-add-a-numbers) | Threads never add A-numbers or architecture prose | process | yes |
| [A172](DECISIONS.md#a172--a-pinned-schema-lives-in-its-type-docs-version-record) | A pinned schema lives in its type Doc's version Record `{at, name, schema}` | [docs](docs/README.md) | yes |
| [A173](DECISIONS.md#a173--the-keepers-byte-forms-as-built) | The keeper's byte forms, as built (keep-bytes.json); caps' half of the gate | [caps](caps/README.md) | yes |
| [A174](DECISIONS.md#a174--bytes-in-json-are-bytes-hex-as-built) | Bytes in JSON are `{"bytes": hex}`, as built | [core](core/README.md) | yes |
| [A175](DECISIONS.md#a175--versions-are-avencores) | Versions are avenCORE's | [core](core/README.md) | yes |
| [A176](DECISIONS.md#a176--one-padding-for-every-sealed-byte) | One padding for every sealed byte: 256 B, 1 KiB, 4 KiB, then Padmé | [id](id/README.md) | yes |
| [A177](DECISIONS.md#a177--the-seal-names-what-it-seals-and-a-checkpoint-is-a-checkpoint) | The seal names what it seals (`seals`), and a checkpoint is a checkpoint | [id](id/README.md) | yes |
| [A178](DECISIONS.md#a178--a-devices-vault-its-key-signs-the-vault-it-serves-owns) | A device's vault: its key signs, the vault it serves owns | [id](id/README.md) | yes |
| [A179](DECISIONS.md#a179--threads-keep-their-pages-status-table-current) | Threads keep their page's Status table current | process | yes |
| [A180](DECISIONS.md#a180--runtimes-have-no-release-of-their-own) | Runtimes have no release of their own; they ship inside `@aven/os` and the avenPEER image | [runtime](runtime/README.md) | yes |
| [A181](DECISIONS.md#a181--a-checkpoint-carries-a-state-sealed-as-a-checkpoint) | A checkpoint carries a `state`, sealed as a checkpoint | [docs](docs/README.md) | yes |
| [A182](DECISIONS.md#a182--a-revocation-discounts-as-a-split-does) | A revocation discounts, as a split does: Core's counting takes avenCAPS' `revoked` | [caps](caps/README.md) | yes |
| [A183](DECISIONS.md#a183--a-cap-is-its-content) | A cap is its content: no nonce | [caps](caps/README.md) | yes |
| [A184](DECISIONS.md#a184--built-in-bodies-carry-no-nulls) | Built-in bodies carry no nulls | [core](core/README.md) | yes |
| [A185](DECISIONS.md#a185--one-owner-for-each-of-the-pages-shared-parts) | One owner for each of the pages' shared parts | this page | yes |
| [A186](DECISIONS.md#a186--no-wiping-in-production) | No wiping in production (Samuel, 30 Oct) | [peers](peers/README.md) | yes |

Imported decisions that a later entry supersedes (every other imported decision still holds, cited on its page):

| Imported | Superseded by |
|---|---|
| caps D21 | [A141](DECISIONS.md#a141--the-keeper-owns-its-bill-and-admission) in part |
| docs 24 | [A81](DECISIONS.md#a81--the-docs-formats) |
| rule 15 | [A148](DECISIONS.md#a148--public-means-the-networks-members) in part, [A178](DECISIONS.md#a178--a-devices-vault-its-key-signs-the-vault-it-serves-owns) in part |
| runtimes 4 | [A71](DECISIONS.md#a71--one-file-type-registry-crate-shared-by-the-peer-and-the-browser) in part |
| runtimes 9 | [A111](DECISIONS.md#a111--one-node-tree-allowlist-the-runtimes) in part |
| runtimes 11 | [A102](DECISIONS.md#a102--frozen-runtime-bytes-are-committed) |
