# Versions for everything: iroh, CRDTs, and what history needs

Research only: nothing here is built yet. Checked 2026-09-30 against what ships today and nothing older: the
current iroh docs (docs.iroh.computer), the latest releases on crates.io — which are exactly the versions we run
(iroh 1.3.0; iroh-docs 0.101.0, iroh-blobs 0.103.0, iroh-gossip 0.101.0) — their source in
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`, and the current docs, repos and registries of each
library.

The question: every change to our data (timelines, grades, looks, the mix, scripts, story sections, file descriptions,
analysis corrections, stories, world shots) kept as history, with revert and forward checkout. No forking and no
merging yet.

### The stack we run = the latest release (crates.io, 2026-09-30)

| Layer | Crates (ours = latest) |
|---|---|
| Transport, 1.x | iroh 1.3.0 · iroh-base 1.3.0 · iroh-relay 1.3.0 · iroh-dns 1.3.0 · noq / noq-proto / noq-udp 1.3.0 (QUIC) · iroh-tickets 1.0.0 · netwatch 0.19.3 · portmapper 0.19.3 |
| Protocols, 0.x (released with iroh 1.0) | iroh-docs 0.101.0 · iroh-blobs 0.103.0 · iroh-gossip 0.101.0 · bao-tree 0.16.1 · irpc 0.17.0 |
| Support | iroh-metrics 1.0.2 · n0-error 1.0.1 · n0-watcher 1.0.0 · n0-future 0.3.2 · iroh-util 0.6.0 · iroh-io 0.6.2 |

Nothing is behind. Everything below refers to these versions.

---

## 1. What iroh gives us already

iroh-docs is the only CRDT iroh ships, and it is a small one.

**The model.** An entry is `(namespace, author, key) → (BLAKE3 hash, length, timestamp)`
(`iroh-docs/src/sync.rs:1006-1052`, `sync.rs:1127-1134`). The value is only a hash; the content lives in iroh-blobs.
There are no maps, lists or text types: key → bytes, and nothing else.

**Signed.** Every entry carries two ed25519 signatures: the namespace's (write access) and the author's
(`sync.rs:737-746`). Authorship is native and verifiable.

**Merge rule: last writer wins, by wall clock.**

- Per author and key, a new entry must be strictly newer than the old one (`ranger.rs:564-576`); records are ordered
  by timestamp, then by content hash (`sync.rs:1141-1147`).
- Across authors, a read (`single_latest_per_key`) takes the newest timestamp; an exact tie goes to the first author
  in sort order (`store/util.rs:59-88`).
- The timestamp is `SystemTime::now()` in microseconds (`sync.rs:1033-1038`). No hybrid logical clock, no version
  vector. The only guard is that entries more than 10 minutes in the future are refused (`sync.rs:48`,
  `sync.rs:639-642`). A device with a slow clock loses quietly.

**No history.** The records table is keyed by `(namespace, author, key)` and a put overwrites
(`store/fs/tables.rs:30-40`, `store/fs.rs:760-777`); superseded entries are "simply dropped" (`ranger.rs:559`).

**Deletes are prefix deletes.** An empty entry at a prefix clears that author's older entries under it
(`sync.rs:401-417`). And not only on delete: any write removes the same author's older entries whose key starts with
the new key (`ranger.rs:578-579`, `store/fs.rs:855-888`).

> **A trap in today's catalog.** Writing `store/SDD_A` would wipe an older `store/SDD_AB`; writing `story/abc` would
> wipe `story/abcd`. Our per-file keys (`meta/<64 hex>`, `blobs/<64 hex>`, …) and story ids (64 hex) are fixed-width,
> so they are safe. Every new key must be prefix-free: fixed-width ids, zero-padded numbers.

**Sync.** Range-based set reconciliation (Meyer, https://arxiv.org/abs/2212.13567; `ranger.rs:1-2`), live updates over
iroh-gossip (HyParView + PlumTree; `engine/live.rs:39-47`), and download policies per device, by key prefix
(`store.rs:62-76`). Capabilities are read or write tickets (`sync.rs:186-191`, `ticket.rs:12-17`).

**Blobs and garbage collection.** BLAKE3 content addressing, so identical bytes are stored once, but nothing smaller:
no deltas. GC keeps what tags and temp tags pin (`iroh-blobs/src/store/gc.rs:34-109`). Our vault protects the tags and
the content of every current catalog entry (`vault-core/src/catalog.rs` `record_hashes`, `vault/app/src/keep.rs`).

> **Today, history is destroyed.** When a `meta/<hash>` or `story/<id>` record is overwritten, its old JSON blob is
> no longer referenced, and the next GC prunes it. A hash written *inside* a JSON blob is never protected either: GC
> does not read JSON.

**Status, today.** iroh 1.0 shipped on 2026-06-15, and iroh-docs 0.101, iroh-blobs 0.103 and iroh-gossip 0.101 were
released the same day, updated to it — the latest of each, and what we run. On the way, iroh-docs moved to redb 4
(0.99.0) and locked its signature wire format (0.99.1: "Wrap EntrySignature in iroh::Signature and lock wire format").
The current protocol overview (docs.iroh.computer/concepts/protocols) lists blobs ("Content-addressed blob storage and
transfer"), docs ("Collaborative key-value documents with CRDTs") and gossip as the building blocks, unlabelled; only
iroh-automerge is marked "(experimental)". The documents page recommends `Docs::persistent` with an `FsStore` for
production — our setup. What the 0.x version still means: no semver promise, so a minor release may change the API
(pin versions, upgrade on purpose, keep our use behind a thin layer in vault-core).

---

## 2. What the CRDT libraries would add

### Yjs (and yrs in Rust)

The most used CRDT for editors (yjs 13.6, yrs 0.28, MIT). Map, Array, Text, XML; the YATA algorithm. Updates are
plain byte arrays, so they could be stored as blobs. History is its weak side: old content is garbage-collected unless
`gc` is switched off, and time travel means snapshots (`Y.snapshot`, `createDocFromSnapshot`). It has an undo manager.
Yjs 14 (release candidate) adds attributed history and track changes. No iroh integration.

### Automerge (JS 3.5, Rust 0.12, MIT)

Map, List, Text with marks, Counter. Every change is a hashed node in a DAG, so the full history is there:
`view(doc, heads)` looks at any past version, `diff` compares two, `changeAt` edits against a past state (Rust:
`fork_at`, `get_at`, `diff`). Automerge 3 cut memory by more than ten times with the same file format. It has no
built-in undo. iroh has two examples: `iroh-automerge` (one document over an iroh stream) and `iroh-automerge-repo`
(samod, the Rust automerge-repo; samod calls itself a work in progress). Both keep everything in memory. Ink & Switch's
Subduction sync has an iroh transport too, marked early preview, not for production.

### Loro (Rust 1.16, JS 1.16, MIT)

The richest types for an editor: Map, List, **MovableList**, Text, **Tree**, Counter (Fugue, Peritext, Eg-walker). Full
history as a DAG with frontiers: `checkout(frontiers)` for a read-only look at any version, `checkout_to_latest()`,
`fork_at`, and `revert_to(frontiers)` that writes new ops restoring that version. It has an undo manager with grouping,
and shallow snapshots that trim old history. Loro publishes an iroh demo, `loro-dev/iroh-loro`: small (two peers, one
text), on an older iroh (0.91), no licence file. `revert_to` is young: 1.16.4 fixed duplicated content on revert.

### Jazz

Jazz 2 (still alpha) is a different product now: a local-first relational database that syncs through a central,
trusted server, with branches but no time-travel queries yet, and no peer-to-peer or iroh transport. Classic Jazz
(CoValues, groups, per-field edit history) is legacy. Either way it would replace iroh's identity, sync and storage
instead of sitting on top of them.

---

## 3. Side by side

| | iroh-docs (what we have) | Yjs | Automerge | Loro | Jazz 2 |
|---|---|---|---|---|---|
| Types | key → content hash | Map, Array, Text, XML | Map, List, Text + marks, Counter | Map, List, MovableList, Text, Tree, Counter | tables (relational) |
| Merge | last writer wins, wall clock | YATA | change DAG | Fugue / Eg-walker | server-authoritative |
| History | **none** | only with GC off, via snapshots | full DAG | full DAG | row versions, no time travel yet |
| Revert | build it ourselves | by hand | by hand (`changeAt`) | `revert_to` | — |
| Forward checkout | build it ourselves | snapshots | `view(heads)` | `checkout` / `checkout_to_latest` | — |
| Undo | none | yes | none built in | yes | — |
| Signed authorship | **yes** (ed25519, twice) | no | author ids, unsigned | peer ids, unsigned | signed JWTs, server-trusted |
| Transport | its own (reconciliation + gossip) | any | any (iroh examples) | any (iroh demo) | its own server |
| Rust / JS | native / through our API | yrs / native | native / wasm | native / wasm | Rust core / JS |
| Maturity | shipped with iroh 1.0, documented for production; 0.x (no semver promise) | very high | high | 1.x, younger | alpha |
| Licence | MIT / Apache-2.0 | MIT | MIT | MIT | MIT |

---

## 4. What history, revert and forward checkout need

**Recommendation: a hash-linked version log on iroh itself.** Whole-object JSON snapshots as blobs, one record per
change, never overwritten. It keeps iroh's signed authors, content addressing and sync, and every record stays plain
JSON that the Mac app, the server and the MCP agents read without a CRDT runtime. A CRDT library earns its place when
two people edit the same timeline at once and their edits must merge; that is not the goal yet.

### The layout

All keys fixed-width and prefix-free. An object is `<kind>/<fixed-width id>`, the kinds: `timeline`, `shot` (world
shots), `story`, `meta`, `analysis`, `transcript`, `sound`.

- **`hist/<object>/<microseconds:020>`**: one version record per change, written per author (so never overwritten),
  read with a flat prefix query:

  ```json
  { "v": 1, "obj": "timeline/…", "op": "create | edit | revert | delete",
    "parent": "<version hash | null>", "snapshot": "<blob hash>", "format": "json",
    "author": "…", "at": "…", "message": "…", "via": "studio | mcp:<agent> | cli",
    "reverts": "<version hash>" }
  ```

- **The current key** (`timeline/<id>`, `meta/<hash>`, `story/<id>`, …) keeps holding today's snapshot, so every
  reader works as now.
- **`headv/<object>`** names the current version: the parent of the next one.

### How it behaves

- **Revert** writes a new version whose snapshot is the old one's hash. Identical bytes are stored once; nothing is
  lost, and the history stays one line.
- **Forward checkout** is a local view: look at any version, step forward and back, and "restore" writes a revert. Redo
  after a revert is another revert.
- **One `commit` function** in vault-core (`commit(obj, snapshot, message, via, expected_parent)`) stores the blob,
  writes the `hist/` record, moves `headv/` and the current key, and refuses when the object changed underneath
  (another device or an agent). The studio calls it through Tauri, the agents through MCP (`history`, `show_version`,
  `restore`).
- **A gesture is one version**: a slider drag, a trim, an agent's batch. The studio's undo stack stays for the seconds
  in between.
- **GC must keep old versions**: the keep pass's protected set gains every `snapshot` a `hist/` record names. Never
  delete under `hist/`.

### What each kind becomes

- A **timeline** is one object: clips, cuts, grades, balances, looks, the mix, the script, story sections.
- A **world shot** is one object; its existing versions become its history.
- **Per-file records** (`meta`, `transcript`, `analysis` corrections, `sound`) version the keys they have.
- A **story** is `story/<id>`, its rules included.
- **Big files** stay blobs, named by hash inside the snapshots.

### Before it can start

Timelines and world shots live in Postgres today (`timelines`, `shots`, `shot_versions`). They move into iroh first
(docs + blobs), or their history stays outside the log.

### What to watch

- **Clocks.** Order history by parent links, never by time. Across devices the current key is still last writer wins.
- **Two writers at once** give two versions with the same parent: show it, don't merge it (yet).
- **Size.** Full snapshots add up (1,000 edits × 100 KB ≈ 100 MB). Coalescing gestures keeps it small; later, small
  JSON patches with a full snapshot every so often.
- **The prefix trap** (section 1) for every new key.

### Whose pattern this is

Neither iroh's docs nor Willow's prescribe a way to keep history or to name keys. Willow's prefix pruning is deliberate
— a write at a path is "like overwriting a directory with an empty file", and Willow prefers mutable data and traceless
removal over append-only hash chains, which it calls "quite dangerous when employed carelessly". History is left to the
application. The log above is our design built only from iroh's documented building blocks (signed entries under keys,
immutable blobs, HashSeq collections, tags and GC), and it stays deletable the Willow way: one empty write at
`hist/<object>/` prunes an object's whole history (each author its own entries). For rich history, the ecosystem's
demonstrated route is a CRDT library over iroh (n0's iroh-automerge, Loro's iroh-loro).

### If merging comes later

Loro, for timelines: MovableList for the clip order, Tree for story sections, `checkout` and `revert_to`, undo, shallow
snapshots, the same library in Rust and in the browser, and a working iroh example to start from. Automerge is the
alternative with more iroh examples and a longer record. Both would store their updates as blobs in the same vault.

---

## Sources

- iroh 1.0: https://www.iroh.computer/blog/v1 · protocols today: https://docs.iroh.computer/concepts/protocols ·
  documents: https://docs.iroh.computer/protocols/documents · blobs: https://docs.iroh.computer/protocols/blobs ·
  releases: https://github.com/n0-computer/iroh-docs/releases, https://github.com/n0-computer/iroh-blobs/releases ·
  crates.io (latest = ours): iroh 1.3.0, iroh-docs 0.101.0, iroh-blobs 0.103.0, iroh-gossip 0.101.0
- Willow: https://willowprotocol.org/specs/data-model/index.html,
  https://willowprotocol.org/more/willow_compared/index.html
- iroh + Automerge: https://github.com/n0-computer/iroh-examples/tree/main/iroh-automerge,
  https://github.com/n0-computer/iroh-examples/tree/main/iroh-automerge-repo · samod: https://github.com/alexjg/samod ·
  Subduction: https://github.com/inkandswitch/subduction
- Yjs: https://docs.yjs.dev, https://github.com/yjs/yjs · yrs: https://github.com/y-crdt/y-crdt
- Automerge: https://automerge.org/docs/reference/documents/, https://automerge.org/automerge/api-docs/js/,
  https://docs.rs/automerge/latest/automerge/struct.Automerge.html, https://automerge.org/blog/automerge-3/
- Loro: https://github.com/loro-dev/loro, https://docs.rs/loro/latest/loro/struct.LoroDoc.html,
  https://loro.dev/changelog/v1.3.0 · iroh demo: https://github.com/loro-dev/iroh-loro
- Jazz: https://jazz.tools/docs/concepts/how-sync-works, https://jazz.tools/docs/reference/internals,
  https://github.com/garden-co/jazz/issues/2572, https://classic.jazz.tools
