# avenDB

This is the new avenDB, rebuilt from first principles beside v1 (`aven/db/`) in the same repository and sharing no
code with it. It grows one primitive at a time, each a package of its own and each proven before it is built: a Lean
model and its theorems first, then Rust tests checked against that model, then the code. Everything it needs lives in
this folder: its crates, its Lean spec, its pages and avenSANDBOX, the local network it is built and tested in.

v1 stays as the testing and learning battleground until the new avenDB is ready. Then v1 is deprecated, and the new
avenDB moves into `aven/db`.

**Status (30 Oct 2026): milestone 1 is integrated.** avenSANDBOX's box runs all four peers live: the Aven Peer with
its relay, Alice Peer direct over UDP, and two Peer-Lights in one Chromium. avenOS reads the cast's tree of vaults
through avenID's wasm, and each peer keeps its record through avenDB's store: in S3, a folder or OPFS. Lean proves
`Aven.ID` and `Aven.DB` without `sorry`, the store's contract included, and every test derives from it (rule 10): Lean's
examples and generated cases are exported as vectors that the Rust, the wasm and avenOS's check load. The plan:
[`SANDBOX.md`](SANDBOX.md).

## Why a rebuild

The architecture audit of 29 Oct 2026 traced v1's sync, loading and display failures to its shape, not to single
bugs. One Lab behind one lock serves reads, peers, catch-up and writes in turn. Catch-up runs in budgeted steps that
can loop without progress. Derived state lives only in the writer's memory and is bound to code versions. Status
numbers come from different moments. Each of the last 250 changes made one path inside that shape faster; none could
change the shape. avenDB starts with the shape.

## The rules

Each rule is held by a test or a check once there is code to hold.

1. **One writer per device.** Pages, peers and status read immutable snapshots stamped with the head they are correct
   at. No reader waits on the writer.
2. **Pure protocol cores.** A protocol is a state machine without I/O. iroh, disk and clocks sit at the edge, so a
   whole network can run deterministically in one process.
3. **No step without progress.** Every loop has a progress measure. A step that moves nothing stops and raises an
   alarm. Lean proves termination by that measure; every simulation run asserts it.
4. **React to changes, never to states.** Version vectors and heads decide what is redone: no hand-written staleness
   memos, no budgets, slices or retry timers.
5. **Derived state is a cache** keyed by its inputs and its code version. Rebuilding it never blanks an app: the last
   snapshot stays on screen.
6. **Catching up only reads.** Only a person's or an agent's act writes.
7. **Status names its phase** (connecting, catching up with what is left, live, offline, stalled), from one record per
   snapshot and one clock.
8. **The UI is pushed deltas.** It never re-queries.
9. **One protocol of our own,** behind one ALPN, with no fallbacks for older peers. iroh's protocols (gossip, later
   blobs) sit beside it on the same `Router`.
10. **Lean is the source of truth, and the tests derive from it.** Every answer a test checks comes from the Lean
    model. Examples are written once, in Lean, beside the definitions they show, and `lake build` checks them. A Lean
    program exports them, with generated cases, as test vectors (JSON) that the Rust tests, the wasm and JS build and
    avenOS's check all load. Models with state, such as the store and presence, export traces that every
    implementation replays. And the model runs: it checks the Rust on random inputs, so it can never be simpler than
    the code. No test elsewhere writes its own expected values. `bun run up --check` regenerates the vectors and fails
    when they differ from what's committed. Only mechanics stay outside Lean: crash safety, rendering, timing.
11. **Small packages in strict layers,** with a size limit per file.
12. **Zero legacy.** Nothing here imports, copies or vendors code from `aven/db/` or its crates. Learnings come in as
    rules and tests, never as code. A check will fail on any such import.
13. **Latest versions, always.** Every dependency and tool is pinned exactly. Pins move only when a person runs `bun
    run bump`, never on their own; `bun run bump --check` and `bun run doctor` show what's behind
    ([`SANDBOX.md`](SANDBOX.md#latest-versions-always)).
14. **Nothing merges with a red check,** and every bug found becomes a test.

## Names

The products, top to bottom. Each depends only on those below it:

```
avenOS        the client app: one UI, several targets. The browser now, the Mac app (Tauri) later
  avenPEER    the node: everything about the network (iroh, the relay, the members-only door), installing and running
              a node, and its one writer. Two builds: the Peer (native) and the Peer-Light (wasm, in a browser).
              The Aven Peer on the server is a Peer, headless, with its relay on. It ships as one slim image,
              the same in production and in the box
    avenDB    the database every peer runs: documents, caps and sync (its pure core) and the store its bytes rest in
      avenID  identity: keys, vaults that own vaults, signatures, multisig, recovery
avenSANDBOX   the box all of it is built and tested in
```

| Name | What |
|---|---|
| avenOS | the client app over everything below it: a dashboard of apps, the first two Vault and Control Room, and an account switcher for the people you may act as. Off the box, its browser client shows "avenOS · coming soon" for now; a Mac app with Tauri follows |
| avenPEER | the node: the network, installing and running a node, and the one writer, on avenDB. The native Peer and the Peer-Light, one core in two builds |
| avenDB | the database: this rebuild. Its core (`db/core`) holds the rules for documents, caps and sync without I/O; its store (`store`) is the one contract of blobs and refs, with a backend per place: S3, a folder, OPFS, memory |
| avenID | identity, a package of its own: keys and their suites, vaults that own vaults, owners acting k of n, recovery and rotation. avenDB asks it who may act for a vault, avenPEER whom to let in, and avenOS shows it |
| avenDB-old | the old database, in `aven/db/`: the testing and learning battleground until avenDB is ready, then deprecated. "v1" still names the whole old stack (its site, API and peer) |
| `aven/DB2` | the new avenDB's folder while avenDB-old still lives in `aven/db`. A Mac's disk ignores case, so `aven/DB` couldn't sit beside `aven/db`, and a path spelled `aven/db2` works on a Mac and fails on Linux and CI; a check will reject any other spelling. When avenDB-old is deprecated, the new avenDB moves into `aven/db` |
| avenSANDBOX | the local network avenDB is built and tested in: Peers and Peer-Lights in containers on one machine ([`SANDBOX.md`](SANDBOX.md)). It is part of this repository, not a package of its own |
| Peer | the native Rust peer, one binary |
| Aven Peer | the server: a Peer with its relay on |
| Alice Peer | a person's Peer with the relay off, the core of the future Mac app |
| Peer-Light | the same core compiled to wasm, in a browser (Alice Peer-Light, Bob's Peer-Light) |

### Terms

The words below are the ones every page here needs. Every term of every part, with the words that should merge, is in
[`GLOSSARY.md`](GLOSSARY.md).

**Who (avenID)**

- **key:** a signing key. An **owner key** governs a person's vault; a **device key** signs for the vault its device
  serves.
- **vault:** an identity that can own things, with a name. A **person's vault** is owned by keys; a **coop's vault**
  (Maia City) by person or coop vaults, and holds no devices; an **agent's vault** (Aven, which runs the network) by
  its admin; a **device's vault** by the vault it serves. Agents are usually LLM agents (Samuel, 30 Oct 2026); the kind
  was called `network` until then, and the old name still reads as `agent` (`Aven.ID.Before`).
- **owns, governs:** a vault owns what is directly below it and governs everything below it. Authority runs only down.
- **admin:** the vault that owns the network's agent: the coop Maia City is Aven's, and the people whose vaults own Maia
  City act for it ([`PRODUCTION.md`](PRODUCTION.md#part-c-maia-city-the-admin-coop)).
- **acts through:** a vault acts through its own devices, within the rights its owner gives it: Aven through the Aven
  Peer.
- **account:** a person's vault, which one acts as in avenOS. Never an agent's or a device's.

**Data (avenDB)**

- **Value:** immutable bytes named by their BLAKE3 hash, like IPFS. At rest in the store it is a **blob**.
- **Doc:** mutable, a Loro document named by a stable id, like IPNS: a head over Values (segments and snapshots). It
  holds **Records**, each named `<doc>/<id>` and each under a schema ([`db/docs`](db/docs/README.md), Samuel,
  30 Oct 2026).
- **ref:** a name pointing at a Value, changed atomically: a Doc's head.
- **store:** where a peer's blobs and refs rest, behind one contract.
- **cap:** a signed grant: which operations a vault may run on which Docs ([`id/caps`](id/caps/README.md)).
- **member, invite:** a person's vault let into the network, a member of the admin coop, which neither owns nor governs
  it (`Aven.ID.Invite`, `memberOf`); and the ticket that lets it in (milestone 2).

**Running (avenPEER)**

- **Peer:** the native program. The **Aven Peer** is a Peer with its relay on, on the server; **Alice Peer** one with it
  off, the core of the future Mac app.
- **Peer-Light:** the same core as wasm in a browser, on its own origin.
- **relay:** iroh's relay, for members only.
- **the one writer:** the single task in each peer that changes its data.

**Around them**

- **app:** a tile on avenOS's dashboard: Vault and Control Room for now.
- **the box, the cast, the check:** avenSANDBOX's image and containers, its fixed test setup (`sandbox/cast.json`) and
  `bun run up --check`.

### Namespaces: everything under `@aven`

Every product gets one id under the key namespace `@aven`, the same in every ecosystem. Ids are lowercase, because
npm, container images and crates require it; the capitals live in prose and the UI. Everything stays in this one
repository: an id names a product, not a separate repository.

| Where | avenOS | avenPEER | avenDB | avenID | avenSANDBOX |
|---|---|---|---|---|---|
| JS packages (npm scope `@aven`) | `@aven/os` (`aven/DB2/package.json`) | `@aven/peer`, the Peer-Light for pages (later) | | none: it runs inside the Peer-Light | none: tooling of this repository |
| Rust crates | | `aven-peer` (native), `aven-peer-light` (wasm) | `aven-db-core`, `aven-db-store` | `aven-id` | |
| Container images | | `ghcr.io/myavenceo/aven/peer` (later): the node, the `aven-peer` binary on a minimal base, run in production and by the box's peers alike | | | `ghcr.io/myavenceo/aven/sandbox`, the box built from this repository's Dockerfile so machines can download it |
| Lean | | | `Aven.DB` | `Aven.ID` | |
| Protocol (ALPN) | | | `aven/db/1`, which avenPEER carries | | |
| Releases (one per package, only when it changed) | `@aven/os@<version>`: `aven-os-web-<version>.tar.gz` (the browser client), later `aven-os-mac-…` | later `@aven/peer@<version>`: `aven-peer-<version>-<platform>.tar.gz` and the image, tagged `<version>` | | | `@aven/sandbox@<version>`: the image, tagged `<version>` |

`@aven/maia` comes later. None of these names had public packages on npm on 29 Oct 2026; creating the npm
organization `aven` reserves the scope before anything is published.

## Decisions so far

- **A hard fork beside v1** in this monorepo, with its own Cargo workspace, lockfile and build folder and its own
  `package.json`. The root only excludes it.
- **Two kinds of peer, one core.** A Peer is the native Rust binary: the Aven Peer (the server) is a Peer with its relay
  on, and Alice Peer, the future Mac app's core, is one with it off. A Peer-Light is the same core compiled to wasm, in a
  browser. They differ only at the edge: storage, network, relay or not. No Mac app yet.
- **iroh everywhere.** Browsers can't send UDP, so Peer-Lights reach every peer through a relay. A direct path between
  browsers (WebRTC, plugged in under iroh) can come later as a shortcut; nothing may depend on it.
- **Invite-only, end to end.** Nothing about the network is public: no public discovery, no public gossip. A peer joins
  only with an invite. From then on it takes part in the members' network, gossiping and connecting directly with other
  members only. The door is checked twice: the relay admits only members' keys, and every peer's `after_handshake` hook
  refuses unknown ones. Membership only opens the door; what a member may read or write inside is decided per document
  by caps, and data stays sealed. A direct connection shows a member's IP address to the member it talks to; the relay
  path hides it. Any member's Peer can run a relay, so the members' network doesn't depend on the Aven Peer.
- **Pluggable storage.** The core defines one small contract of blobs and refs, `Store`. Behind it: object storage for the
  Aven Peer, a folder for a Peer, OPFS for a Peer-Light, memory for tests. Apache OpenDAL provides the first backends;
  our own OPFS backend comes where speed needs it ([`SANDBOX.md`](SANDBOX.md#storage-one-contract-pluggable-backends)).
- **One primitive underneath: the sealed blob.** Everything at rest and on the wire is an immutable object named by
  the BLAKE3 hash of its bytes, sealed to its readers. A file is a hash sequence of chunks of at most 1 MiB
  ([`store`](store/README.md)). A Loro document is a small head (its id, its version and
  the hashes of its pieces) over blobs: sealed segments of edits and, now and then, a snapshot. Both live in the same
  `Store` and travel by the same blob transfer. Only the edits being made right now travel live over our sync protocol,
  until they are sealed into the next segment. The Aven Peer can store, verify and serve every sealed byte without
  reading it. Loro is the document model, so iroh-docs is not needed. The only other thing in storage is a ref: a name
  pointing at a blob, such as a document's latest head, changed atomically, as in git.
- **Deduplication follows who may know a file.** Nothing is published to the world: a public file is sealed to the
  network's members and dedups among them ([`id/caps`](id/caps/README.md), decision 15). Files shared in a space are
  sealed convergently with the space's secret (`key = hash(space secret, file)`): the space's peers store each file
  once, and outsiders, the Aven Peer included, can't even test a guess.
  This is Tahoe-LAFS's convergence secret, with symmetric crypto only. Private documents stay sealed with random keys;
  their segments are unique anyway. Dedup across all peers through the Aven Peer (DupLESS-style) stays an option, not
  the default. It takes effect with sealing, which comes with avenID's caps: the store upgrade's files are plain
  until then (Samuel, 30 Oct 2026; [`store`](store/README.md#later-sealing)).
- **Identity is a package of its own: avenID.** Vaults own vaults, a concept kept from avenDB-old and built anew. A
  person's vault is owned by its owner key. A device's vault is owned by the vault it serves; the device's key signs for
  that vault and governs nothing, so a lost device is revoked by its vault, and the vault loses nothing. A network's
  vault is owned by the vault that runs it: Aven by the coop Maia City, which Alice's vault owns, which makes **Maia City
  the admin, not Alice's key.**
  **A network acts through its own devices, and no person switches into it.** Aven has its own vault; the Aven Peer,
  its device, signs for Aven within the rights Alice's vault gives it and can take back. People act on Aven only as
  themselves: Alice manages it as Alice's vault, signing with her own devices, and a network is never an account.
  Authority runs down the tree, never up: a vault governs everything below it, and an app shows a vault only that.
  avenID also holds what decides who may act: owners acting k of n (multisig), recovery (guardian vaults that can
  replace a vault's owners, after a delay in which the owners can cancel), key rotation, and the cryptographic suites
  below. avenDB checks every write against it, avenPEER's door every peer.
- **Encryption, in avenID:** X-Wing (ML-KEM-768 with X25519) is the only key encapsulation. Every sealed box carries a suite byte,
  so a second scheme can join if lattices ever look weak: HQC, NIST's 2025 code-based backup, with keys of a few KB.
  No Classic McEliece: v1 derived a pair for every key, each with a 1 MB public half that took most of a second to
  make. Signatures: Ed25519 and passkeys, with Ed25519 and ML-DSA-65 together wherever authority lasts
  ([`id/caps`](id/caps/README.md), decision 10).
- **The Aven Peer only ever sees ciphertext,** once sealing ships with caps. The city-dome's history from before then
  stays plain and readable ([`store`](store/README.md#later-sealing)).
- **What ships is the node, never the box.** avenSANDBOX's image is a development machine (browsers, compilers,
  Lean) and is never deployed. avenPEER ships one binary whose modes are flags (`--relay`, `--store memory|fs|s3`), in
  one slim image: the binary on a minimal base. Sandbox or live is only configuration: which relay, which S3. The box
  runs that same image for its peers, so what is tested is what ships; for the fast loop it runs the binary straight
  from its build folder.

## What we take from iroh

iroh is built from pluggable protocols. Each peer has one endpoint, and a `Router` hands every incoming connection to
the `ProtocolHandler` registered for its ALPN. avenDB's own protocol plugs in the same way, beside iroh's.

| Piece | Status (29 Oct 2026) | How we use it |
|---|---|---|
| iroh: endpoint, `Router`, `ProtocolHandler`, hooks | 1.4.1, stable | Every peer: its identity, encrypted connections, hole punching, relay fallback. The door: `after_handshake` admits members only. |
| iroh-relay | 1.4.1, stable | Inside the Aven Peer, or any Peer with its relay on; admits members' keys only |
| iroh-gossip | 0.101 | Chat and presence among members, from milestone 2 |
| iroh-tickets | 1.0.0, stable | Invites |
| iroh-metrics | 1.0.2 | The progress counters behind status and the stall alarm |
| iroh-blobs | 0.104, "not yet production quality" (its README) | Files and the pieces of documents, later: its protocol and verified streaming, with a store written on our `Store`. Fallback: `bao-tree`, the library under it, used directly. |
| iroh-docs | 0.101, last release in June | Not the crate: it is a last-writer-wins key-value table, without roles or revocation, with its own storage, pinned to an older iroh-blobs. Its patterns: range-based set reconciliation, entries signed by document and author, download policies, live events. |
| iroh-willow | 0.0.1, February 2025 | Not the crate. Meadowcap's caps and areas of interest as a reference. |
| `unstable-custom-transports` | outside iroh's semver | Later: a direct WebRTC path between browsers |

## The specs

The whole, with its shared primitives, its cross-part rules and how it stands up to end-to-end encryption, local first
and peer to peer: [`ARCHITECTURE.md`](ARCHITECTURE.md). Every term of every part: [`GLOSSARY.md`](GLOSSARY.md).

Each plan is its own document; there is no numbered roadmap here (Samuel, 30 Oct 2026). The box:
[`SANDBOX.md`](SANDBOX.md). Production: [`PRODUCTION.md`](PRODUCTION.md). The members' network:
[`MILESTONE2.md`](MILESTONE2.md). The store: [`store`](store/README.md). Caps: [`id/caps`](id/caps/README.md). The data
design: [`db/docs`](db/docs/README.md), [`db/engine`](db/engine/README.md) and [`db/ontology`](db/ontology/README.md).

## How we work

- Milestone by milestone, test-first: the Lean model and its theorems, Rust tests against it, the sandbox check, then
  the code.
- Every command runs in the box ([`SANDBOX.md`](SANDBOX.md#the-box)), the same on a Mac (OrbStack), in a Claude cloud
  session and in CI.
- The repository's rules hold ([`CLAUDE.md`](../../CLAUDE.md)): task branches, draft PRs, CI once per goal.
