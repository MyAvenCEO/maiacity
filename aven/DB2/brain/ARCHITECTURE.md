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
| 4 | **Readers judge.** Every reader checks every envelope's signatures, authority, footprint and fit itself, on the envelope's own past, never by asking a keeper, relay or the Aven Peer. | composed |
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
| 15 | **Vaults own; signers only sign.** Only a vault owns, holds caps and governs; a key signs only as an owner of a vault, k of n. A cap is held by a vault, a group, or the public, which is the network's members. | held by avenCAPS's Lean; not yet in `Gaps.lean` |
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

<!-- generated from DECISIONS.md and its register: id, one line, its page, and whether it still holds -->
