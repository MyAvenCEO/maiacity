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
9. **One protocol, one ALPN,** no fallbacks for older peers.
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
- **iroh everywhere.** Browsers can't send UDP, so Peer-Lights reach every peer through the Aven Peer's relay.
- **Pluggable storage.** The core defines one small, object-shaped contract, `Store`. Behind it: object storage for the
  Aven Peer, a folder for a Peer, OPFS for a Peer-Light, memory for tests. Apache OpenDAL provides the first backends;
  our own OPFS backend comes where speed needs it ([`SANDBOX.md`](SANDBOX.md#storage-one-contract-pluggable-backends)).
- **Encryption:** X-Wing (ML-KEM-768 with X25519) is the only key encapsulation. Every sealed box carries a suite byte,
  so a second scheme can join if lattices ever look weak: HQC, NIST's 2025 code-based backup, with keys of a few KB.
  No Classic McEliece: v1 derived a pair for every key, each with a 1 MB public half that took most of a second to
  make. Signatures: Ed25519 and passkeys now, ML-DSA later through the same suite byte.
- **The server only ever sees ciphertext.**

## Milestones

1. **avenSANDBOX** with the coming-soon page ([`SANDBOX.md`](SANDBOX.md)).
2. **Network:** iroh endpoints, our relay, one ALPN, the device handshake, presence.
3. **Accounts and caps:** owner keys (passkeys), devices, roles, delegation, revocation.
4. **Docs:** Loro documents in signed, sealed envelopes; the one writer and its snapshots; the store; one document
   synced.
5. **Version control:** history, versions, variants, proposals.
6. **Schemas and lenses.**
7. **Sync manifest and queries.**

The mini app these build toward is a Google-Docs-like editor with history, variants and proposals.

## How we work

- Milestone by milestone, test-first: the Lean model and its theorems, Rust tests against it, the sandbox check, then
  the code.
- Every command runs in the box ([`SANDBOX.md`](SANDBOX.md#the-box)), the same on a Mac (OrbStack), in a Claude cloud
  session and in CI.
- The repository's rules hold ([`CLAUDE.md`](../../CLAUDE.md)): task branches, draft PRs, CI once per goal.
