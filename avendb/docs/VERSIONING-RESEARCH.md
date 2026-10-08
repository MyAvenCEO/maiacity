# Versions for everything: iroh, CRDTs, and what history needs

> The research and first plan that led to avenDB, kept for their reasoning; avenDB's own plan supersedes them (see
> [../README.md](../README.md)).

Research only: nothing here is built yet. Checked 2026-09-30 against what ships today and nothing older: the
current iroh docs (docs.iroh.computer), the latest releases on crates.io — which are exactly the versions we run
(iroh 1.3.0; iroh-docs 0.101.0, iroh-blobs 0.103.0, iroh-gossip 0.101.0) — their source in
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`, and the current docs, repos and registries of each
library.

The question: every change to our data (timelines, grades, looks, the mix, scripts, story sections, file descriptions,
analysis corrections, stories, world shots) kept as history, with revert and forward checkout — operation-based like
Loro, as close to iroh's own architecture as possible, inventing no CRDT. No forking and no merging yet; schema changes
and branches thought through for later.

### The stack we run = the latest release (crates.io, 2026-09-30)

| Layer | Crates (ours = latest) |
|---|---|
| Transport, 1.x | iroh 1.3.0 · iroh-base 1.3.0 · iroh-relay 1.3.0 · iroh-dns 1.3.0 · noq / noq-proto / noq-udp 1.3.0 (QUIC) · iroh-tickets 1.0.0 · netwatch 0.19.3 · portmapper 0.19.3 |
| Protocols, 0.x (released with iroh 1.0) | iroh-docs 0.101.0 · iroh-blobs 0.103.0 · iroh-gossip 0.101.0 · bao-tree 0.16.1 · irpc 0.17.0 |
| Support | iroh-metrics 1.0.2 · n0-error 1.0.1 · n0-watcher 1.0.0 · n0-future 0.3.2 · iroh-util 0.6.0 · iroh-io 0.6.2 |

Nothing is behind. Everything below refers to these versions.

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

## 4. Is there history in iroh-docs itself?

No. iroh-docs is a **state-based** CRDT: it syncs and converges on the current set of entries. A write replaces the
author's slot for that key (`tables.records.insert`, `store/fs.rs:760-777`), and superseded entries are "simply dropped
right now. We might want to make this return an iterator, to potentially log or expose the deleted entries"
(`ranger.rs:558-560`). The signatures and timestamps prove who wrote what is there now — not what was there before.
Its order is deterministic, (timestamp, hash), by the writer's clock — agreed on every replica, but not causal.

Automerge and Loro are **operation-based**: every change is kept in a log (a DAG of changes, ordered causally), and that
log is their history. So operation-based history on iroh means carrying such a log — without writing a CRDT ourselves.

---

## 5. Recommended: Loro documents carried by the iroh-docs catalog

Loro owns the operations, the merge and the history; iroh-docs and iroh-blobs carry them exactly as they carry
everything else. Neither side's design changes, and no CRDT is invented.

- **Each editable object is a Loro document**: a timeline, a world shot, a story, a file's description.
- **Each commit's operations are a blob, each blob an entry**, per author, never overwritten, fixed width:

  ```
  crdt/<kind>/<object id>/<author>/<seq, 20 digits>/   →  content: that commit's Loro update
  crdt/<kind>/<object id>/snapshot/                     →  content: a Loro snapshot (compaction)
  ```

- **Opening an object** reads its entries and imports every update into one `LoroDoc`. Loro merges them in causal order
  (version vectors), so device clocks no longer decide the order.
- **Compaction**: now and then a snapshot blob, so a device does not replay thousands of updates; Loro's shallow
  snapshots can trim very old history if it grows too large.
- **For plain JSON readers** (the website's mirror, quick reads), the object's current key keeps a JSON view, written
  on each commit.

### Who does what

| | |
|---|---|
| iroh-docs (as shipped) | signing, ordering, sync (reconciliation + gossip), download policies, GC protection of entry contents, deletion by prefix pruning (`crdt/<kind>/<id>/`, each author its own), live events |
| iroh-blobs (as shipped) | update and snapshot bytes, verified, deduplicated |
| Loro (as shipped) | operations, merge, full history, `checkout` (look at any version), `revert_to` (a new commit restoring it), undo, `fork_at` |
| ours | one generic module in vault-core, and the UI |

**The single lever is one generic `crdt` module in vault-core:** `open(object)`, `commit(object, change, message)`,
`history(object)`, `checkout` / `revert(object, version)`. Written once, it gives every tool — editing, grading, looks,
the mix, scripts, story sections, world shots, descriptions, analysis corrections — history, revert, forward checkout,
undo, and later merging. Loro's MovableList fits the clip order, its Tree the story sections.

**Why Loro over Automerge:** those editor types, `checkout` and `revert_to`, an undo manager in Rust (the app, MCP) and
in JS (the studio), shallow snapshots. Automerge has more iroh examples and a longer record, but no built-in undo.

**What it costs:** Loro in the Mac app (Rust) and in the studio (wasm); timelines and world shots out of Postgres first;
compaction. The server stays as it is: it stores and relays blobs without knowing what is in them.

### What the iroh-loro demo teaches (read, not used)

`loro-dev/iroh-loro` (a two-peer plain-text demo, pinned to an older iroh 0.91 and loro 1.6, last pushed September 2025)
syncs one Loro document over a protocol of its own (`ALPN iroh/loro/1`, a `ProtocolHandler`):

- **The hook to keep:** `doc.subscribe_local_update(…)` hands over each local commit's operations as bytes — exactly
  what our `commit` turns into a blob and a catalog entry.
- **Edits from a whole new state:** `get_text("text").update(…)` (or `update_by_line` for large text) turns a new full
  value into minimal operations — useful where a tool hands over a finished state instead of single edits.
- **What not to copy:** on every connect it sends *all* updates (`ExportMode::all_updates()`), keeps the history only
  in memory, works for two peers, and caps a message at 10 MB; import errors are only printed. Carrying updates as
  catalog entries gives us persistence, any number of peers, offline catch-up and partial sync through iroh-docs'
  reconciliation instead.

### A simpler fallback

If Loro's cost is not wanted yet: one entry per version, never overwritten (`hist/<kind>/<id>/<µs, 20 digits>/`), its
content the full JSON snapshot. The entry itself is the version record (author, time, signature, hash); revert writes
an old snapshot's hash again; history is ordered by the writers' clocks. It gives history, revert and forward checkout,
but no merge, no undo, and no causal order. Both routes keep the same keys discipline and the same deletion.

### Whose pattern this is

Neither iroh's docs nor Willow's prescribe a way to keep history or to name keys. Willow's prefix pruning is deliberate
— a write at a path is "like overwriting a directory with an empty file" — and Willow prefers mutable data and
traceless removal over append-only hash chains, which it calls "quite dangerous when employed carelessly". History is
left to the application. Carrying a CRDT library's operations over iroh is the ecosystem's demonstrated route (n0's
iroh-automerge, Loro's iroh-loro); carrying them as catalog entries is our choice, built only from iroh's documented
building blocks (signed entries under keys, immutable blobs, tags and GC). It stays deletable the Willow way: one empty
write at `crdt/<kind>/<id>/` prunes an object's whole history, each author its own entries.

---

## 6. Schema changes

A schema is the shape of an object: a timeline's clips and their fields, a grade's layers. It will change: a field
added, renamed, split. Neither iroh-docs nor Loro knows schemas (Loro has typed containers, no schema), so this is
ours — and Jazz 2 has thought it through for local-first apps.

### What Jazz 2 does (its current docs)

- **The schema is code** (`schema.ts`, "the source of truth"), and every version of it has **a hash** to refer to it.
- **Data keeps the schema it was written under**: "Rows retain the physical schema identity under which they were
  written." Nothing is rewritten on disk.
- **Lenses translate on read and on write**: migrations are declarative operations "which carry enough information to
  run in either direction"; "lenses compose in sequence to bridge multiple schema versions". So old and new apps share
  the same data — staggered updates, offline clients writing under an old schema.
- **Each change says how to go both ways**: an added field has a `default`, a dropped one a `backwardsDefault` for older
  apps; an ambiguous diff (removed + added — a rename?) is a **draft** lens that must be reviewed before it can ship.
- **Schemas and lenses travel in their own lane** ("a separate catalogue lane, not through the normal user-row
  history"), so a device discovers a schema when it meets data written under it.
- History is append-only per row; the visible entry is "the current winner" per branch view.

### What we would take from it

- **Each object records its schema hash** (a field in the Loro document — so a `checkout` of an old version shows which
  schema it was written under — or in the JSON snapshot).
- **Schemas in code** (Rust types for the app and MCP, TS for the studio), each version hashed; schemas and lenses also
  stored in the catalog under their own keys (`schema/<kind>/<hash>/`, `lens/<kind>/<from>/<to>/`) — our "catalogue
  lane".
- **Declarative, two-way lenses**: add (with a default), drop (with a backwards default), rename (always explicit, never
  guessed). Ink & Switch's Cambria is the precedent for lenses over CRDT documents.
- **Reading an old version** runs its schema's lens chain up to the current one; history stays readable forever.
- **Writing**: our devices are few and all run our app, so we can be simpler than Jazz — when an app with a newer
  schema opens an older object, it writes **one migration commit** (the change as Loro operations, in the history like
  any edit). An app older than an object's schema opens it read-only and says to update. Full Jazz-style coexistence
  (writing through lenses) only if many app versions must write at once.

---

## 7. Branches

Jazz 2's branches are "parallel views of the same objects" — drafts, scenarios, environments — chosen by a branch column
(`.branchBy()`); a query asks for `{branch, base}` and gets the draft where it exists, else the base. Merging is "a
userland operation": the app reads both, computes the writes, commits them. Discarding is just not referencing it.

For us, later (not now): a branch is a Loro `fork_at(version)` — a new object with a pointer to its base and the
version it left from; the studio shows "draft over main", falling back to main where the draft changed nothing; merging,
when wanted, is Loro importing one document's operations into the other. The same idea as Jazz, on our own catalog.

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
- Jazz 2: https://jazz.tools/docs/schemas/migrations, https://jazz.tools/docs/schemas/defining-tables,
  https://jazz.tools/docs/concepts/branches, https://jazz.tools/docs/reference/internals,
  https://jazz.tools/docs/concepts/how-sync-works · classic: https://classic.jazz.tools
- iroh-loro demo (read, not used): https://github.com/loro-dev/iroh-loro (src/lib.rs)
