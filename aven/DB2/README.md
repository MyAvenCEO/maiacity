# avenDB2

avenDB2 is avenDB rebuilt from first principles, beside v1 (`aven/db/`) in the same repository and sharing no code
with it. It grows one primitive at a time, each a package of its own and each proven before it is built: a Lean model
and its theorems first, then Rust tests checked against that model, then the code. Everything it needs lives in this
folder: its crates, its Lean spec, its pages and avenSANDBOX, the local network it is built and tested in.

**Status (29 Oct 2026): planning, no code yet.** Milestone 1 is avenSANDBOX with a "coming soon" page:
[`SANDBOX.md`](SANDBOX.md).

## Why a rebuild

The architecture audit of 29 Oct 2026 traced v1's sync, loading and display failures to its shape, not to single
bugs. One Lab behind one lock serves reads, peers, catch-up and writes in turn. Catch-up runs in budgeted steps that
can loop without progress. Derived state lives only in the writer's memory and is bound to code versions. Status
numbers come from different moments. Each of the last 250 changes made one path inside that shape faster; none could
change the shape. avenDB2 starts with the shape.

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
10. **The Lean model runs.** It checks the Rust on random traces, so the model can never be simpler than the code.
11. **Small packages in strict layers,** with a size limit per file.
12. **Zero legacy.** Nothing here imports, copies or vendors code from `aven/db/` or its crates. Learnings come in as
    rules and tests, never as code. A check will fail on any such import.
13. **Latest versions, always.** Every dependency and tool is pinned exactly at its newest stable release, and a daily
    bump moves the pins forward ([`SANDBOX.md`](SANDBOX.md#latest-versions-always)).
14. **Nothing merges with a red check,** and every bug found becomes a test.

## Names

| Name | What |
|---|---|
| avenDB2 | the database, this rebuild |
| `aven/DB2` | its folder. A Mac's disk ignores case, so a path spelled `aven/db2` works there and fails on Linux and CI; a check will reject any other spelling |
| avenSANDBOX | the local network avenDB2 is built and tested in: Peers and Peer-Lights in containers on one machine ([`SANDBOX.md`](SANDBOX.md)) |
| Peer | the native Rust peer, one binary |
| Aven Peer | the server: a Peer with its relay on |
| Alice Peer | a person's Peer with the relay off, the core of the future Mac app |
| Peer-Light | the same core compiled to wasm, in a browser (Alice Peer-Light, Bob's Peer-Light) |

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
  the BLAKE3 hash of its bytes, sealed unless it is published. A file is one blob. A Loro document is a small head (its id, its version and
  the hashes of its pieces) over blobs: sealed segments of edits and, now and then, a snapshot. Both live in the same
  `Store` and travel by the same blob transfer. Only the edits being made right now travel live over our sync protocol,
  until they are sealed into the next segment. The Aven Peer can store, verify and serve every sealed byte without
  reading it. Loro is the document model, so iroh-docs is not needed. The only other thing in storage is a ref: a name
  pointing at a blob, such as a document's latest head, changed atomically, as in git.
- **Deduplication follows who may know a file.** Published files are signed, not encrypted, and dedup with everyone,
  like IPFS. Files shared in a space are sealed convergently with the space's secret (`key = hash(space secret,
  file)`): the space's peers store each file once, and outsiders, the Aven Peer included, can't even test a guess.
  This is Tahoe-LAFS's convergence secret, with symmetric crypto only. Private documents stay sealed with random keys;
  their segments are unique anyway. Dedup across all peers through the Aven Peer (DupLESS-style) stays an option, not
  the default. It takes effect in the milestone that brings files; nothing changes before it.
- **Encryption:** X-Wing (ML-KEM-768 with X25519) is the only key encapsulation. Every sealed box carries a suite byte,
  so a second scheme can join if lattices ever look weak: HQC, NIST's 2025 code-based backup, with keys of a few KB.
  No Classic McEliece: v1 derived a pair for every key, each with a 1 MB public half that took most of a second to
  make. Signatures: Ed25519 and passkeys now, ML-DSA later through the same suite byte.
- **The Aven Peer only ever sees ciphertext,** except what is published.

## What we take from iroh

iroh is built from pluggable protocols. Each peer has one endpoint, and a `Router` hands every incoming connection to
the `ProtocolHandler` registered for its ALPN. avenDB2's own protocol plugs in the same way, beside iroh's.

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

## Milestones

1. **avenSANDBOX** with a "coming soon" page ([`SANDBOX.md`](SANDBOX.md)).
2. **Network:** the invite-only door (invites, the relay's allow-list, the device handshake) and members-only gossip,
   with the first example app: a live chat.
3. **Accounts and caps:** owner keys (passkeys), devices, roles, delegation, revocation.
4. **Docs:** Loro documents in signed, sealed envelopes; the one writer and its snapshots; the store; one document
   synced. The chat gets its history.
5. **Version control:** history, versions, variants, proposals.
6. **Schemas and lenses.**
7. **Sync manifest and queries.**

The chat is the first example app and grows with each milestone. The Google-Docs-like editor, with history, variants
and proposals, follows it.

## How we work

- Milestone by milestone, test-first: the Lean model and its theorems, Rust tests against it, the sandbox check, then
  the code.
- Every command runs in the box ([`SANDBOX.md`](SANDBOX.md#the-box)), the same on a Mac (OrbStack), in a Claude cloud
  session and in CI.
- The repository's rules hold ([`CLAUDE.md`](../../CLAUDE.md)): task branches, draft PRs, CI once per goal.
