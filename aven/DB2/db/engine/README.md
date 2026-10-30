# Engine: one operations engine for queries, mutations and sync

avenDB's engine (30 Oct 2026). Everything an app, an agent or a device asks of its data is an **operation**: a piece
of JSON checked against a fixed grammar, then run by the engine over document snapshots. The engine works on one
primitive, the **value**: whatever a document holds at a path, always under a schema, since the docs layer stores no
value without one. A fact, a chat line, a page and a file are all values. The core is small and fixed: the one writer,
the operation envelope, one query and mutation evaluator over values, **wants** (what is synced and what is loaded, one concept), live answers and the checks. **Plugins** add
grammars on top that lower to the core's operations. The [ontology](../ontology/README.md)'s x1–x5 grammar is the
first.

It is written for milestones 4 (one document synced) and 7 (wants and queries), with caps from 3. It sits on the
[docs](../docs/README.md) layer (Loro documents, envelopes, versions, schemas, lenses), which sits on the
[store](../../store/README.md) (blobs and refs). Nothing here is built before its milestone, and nothing comes in from
older engines as code ([README](../../README.md), rule 12).

**Status.** Decided by Samuel on 30 Oct 2026: plugins are built in (D1), sync and load are one want (D3), wants use the
caps' target grammar (D4), actors declare and devices decide how deep (D5), operations are named by their avenDB hash
(D7), kinds stay inside one plugin (D8), the docs layer checks envelopes and the engine checks operations (D9),
indexes come in a later iteration (D10), and avenACTORS' engine notes are folded in here. **Proposed, waiting for
Samuel:** values as the one primitive, with plugins that lower to the core (D2, D6).

## Contents

1. [What it takes from before](#what-it-takes-from-before)
2. [Terms](#terms)
3. [The rules](#the-rules)
4. [The layers](#the-layers)
5. [One primitive: the value](#one-primitive-the-value)
6. [The core and its plugins](#the-core-and-its-plugins)
7. [Operations](#operations)
8. [Wants: sync and load as one](#wants-sync-and-load-as-one)
9. [The one writer](#the-one-writer)
10. [Sync](#sync)
11. [Queries](#queries)
12. [Mutations](#mutations)
13. [Kinds compile to operations](#kinds-compile-to-operations)
14. [Answers](#answers)
15. [Who checks what](#who-checks-what)
16. [Later: indexes](#later-indexes)
17. [Decisions](#decisions)
18. [What Lean proves](#what-lean-proves)
19. [Open questions](#open-questions)

## What it takes from before

The research is in [`../research`](../research/README.md): avenOS's x1–x5 engine ([C1](../research/C1-avenos-x1-x5-core.md),
[C2](../research/C2-avenos-invoice.md)) and avenDB-old's query and sync engine ([E1](../research/E1-avendb-old-engine.md),
by avenACTORS). The actor and caps designs this builds on are avenACTOR's `aven/actor/ARCHITECTURE.md` (sections 3, 6 and 11:
one document per actor, its definition, and what goes into avenDB), `aven/actor/README.md` (section 8: an actor's
`loads` are its wants) and `aven/ID/caps/README.md`.

| From | What held | Here |
|---|---|---|
| avenOS, boards 0085–0112 | Queries and mutations as specs checked against a fixed meta-schema, never SQL or code from a model; values always bound, columns allow-listed; chained joins; `HAVING` counts; `{ "ref": n }`; a failed step rolls back the steps before it; kinds compiled to stored operations when saved, and the interpreting path deleted once parity was proven | Operations, Queries, Mutations, Kinds |
| avenDB-old's sync | Each log compared by its frontier, one digest each; only what lies beyond is sent, nothing withheld (T19); a change waits for what it builds on; two changes of one device where neither builds on the other reveal a fork; nothing leaves a peer for a device that may not receive it (T12); changed digests told to the peers that may hold the log | Sync |
| avenDB-old's Interests | Wants in four tiers (`now`, `next`, `later`, `idle`), slots bound by the route, `part`, `window`, `follow`, a signal that orders; the laws proven: tiers only order and never add or withhold, each entry once at its highest tier, an unbound slot wants nothing, **a want grants nothing**; asking yields to a new `now`; wants published before any read | Wants |
| avenDB-old's answers | Coverage (complete, partial, denied) and freshness as pure functions of state, never of a clock; query views checked against an oracle; writes go first, painted at once, gone without a trace when refused | Answers |

And what hurt: one Lab behind one lock served reads, peers, catch-up and writes; catch-up ran in budgeted steps that
could loop without progress (46 whole replays in one fresh browser, 313 s to unlock a partial vault on an iPhone);
derived state lived only in the writer's memory; four status vocabularies came from different moments; wants were
computed by reading data first; five separate read operations (`query`, `room`, `posts`, `entry_views`, `world`); long
logs came whole; pages re-queried instead of receiving deltas. In avenOS: amounts as strings, refs unchecked, caps that
never reached facts, a compiler that refused nested and matched traits, and 22 of a real invoice's 49 fields with no
place to go.

## Terms

- **value:** whatever a document holds at a path, under the schema the docs layer enforces there
  ([docs](../docs/README.md#terms)), addressed `<doc>/<path>`. The one thing the engine queries and changes.
- **type:** a named schema. Values of one type form a **table**; a value whose schema has no name is a column of the
  value it sits in.
- **fact:** a value whose type is a predicate, in a document's facts map, `predicate(x1…x5)`
  ([ontology](../ontology/README.md#where-facts-live)).
- **file:** a value of type `file`: the hash of the file's index, its size, name and media type. Its bytes rest
  in the store as a hash sequence ([store](../../store/README.md#big-files-are-hash-sequences-decided)).
- **operation:** a JSON spec of work: a query, a mutation or a want. Data that people and agents write.
- **core operation:** one the engine runs directly. **Plugin operation:** one written in a plugin's grammar, which the
  plugin lowers to core operations.
- **plugin:** code built into the engine that adds a grammar, its checks and its lowering. The **ontology** plugin is the
  first.
- **want:** what a device or an actor asks to have: a target, a part, a tier and a lifetime. It orders and never
  authorizes.
- **durable want:** decides what a device **keeps** (sync). **Mounted want:** decides what is **open** (loaded, in
  views) while a page shows it or an actor runs.
- **tier:** `now` (on screen, needed for a turn), `next` (one click away), `later` (the rest of the screen's data),
  `idle` (kept offline).
- **loads:** the wants an actor's definition declares, in tiers. An actor's manifest.
- **device profile:** a device's own setting of how deep it keeps: which tiers become durable, and how many bytes.
- **catalogue:** a vault's document mapping names to operation hashes.
- **footprint:** what an operation reads and writes: documents, and inside them schemas and paths.
- **bound:** the most work an operation may do, computed before it runs.
- **view:** a query's current rows, stamped with the heads they were computed from. A cache.
- **the one writer:** the single task in each peer that changes its data (README, rule 1).

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **The one writer applies every change:** local mutations and imported envelopes, in turn. Pages, actors, peers and
   status read immutable snapshots stamped with the heads they are correct at, and never wait on it.
2. **One primitive.** The engine queries and changes values, nothing else, and every value has a schema. A fact, a line,
   a page and a file differ only by their type.
3. **One evaluator.** The core runs core operations only. A plugin operation is lowered to core operations, and what it
   means is what its lowering does.
4. **Everything asked of the engine is an operation,** checked against its grammar before it is stored and before it
   runs. A model writes operations, never code.
5. **Plugins are code; operations are data.** A plugin ships with the engine, with its Lean model and vectors. No
   operation can make the engine run anything but its own steps.
6. **One want for sync and load.** A durable want decides what a device keeps; a mounted want what it opens. There is
   no second manifest.
7. **A want grants nothing.** What a device is sent is its wants intersected with its caps; what an actor is handed
   is its loads intersected with its run's caps.
8. **Wants are computed from definitions and bound slots, never by reading data first.** A want that is a query runs
   only over what the device already holds.
9. **Tiers only order.** A tier never adds or withholds a document; each document is fetched once, at the highest tier
   anyone wants it; a new `now` want goes ahead of everything else.
10. **Every operation has a bound and a footprint before it runs.** A query over its bound is refused with the bound in
    the answer; an operation whose footprint its caps don't cover is refused. Nothing fails halfway.
11. **A mutation is one commit to one document,** all or nothing. Work across documents is several mutations.
12. **Retracting is a person's act.** An agent proposes a mutation that removes data; a person confirms it.
13. **Sync compares, then sends what's missing,** withholding nothing the asker may receive and sending nothing it may
    not.
14. **Receiving is not reading.** A peer without a document's key stores and forwards its sealed bytes and reads none of
    them. The Aven Peer is such a peer for everything not published.
15. **An envelope waits for what it builds on. A fork is raised, not merged quietly.**
16. **Catching up only reads and always progresses** (README, rules 3 and 6): every step moves a version forward, or it
    stops and raises the stall alarm.
17. **Views are caches** keyed by the heads they were built from and the code version (README, rule 5). They never sync.
    A rebuild never blanks a screen.
18. **Answers say how complete they are:** complete, partial (with what is waited for) or denied, and the phase.
19. **Live answers are pushed deltas** (README, rule 8). Nothing re-queries.
20. **Writes go first.** A local write is shown at once and laid over answers until the writer commits it; a refused
    write leaves no trace.
21. **A kind compiles to operations once, when it is saved.** The engine runs operations only.

## The layers

```
 actors (aven/actor)      declare loads, hold caps, run turns; operations come from them and from pages
        │  operations                       ▲ answers, deltas, `given`
 ── db/engine ────────────────────────────────────────────────────────────────────────────────────────
 plugins   ontology (x1–x5: assert, set, retract, walk, kinds)   … more later, built in
        │  lowered to core operations
 core      the one writer · envelope and checks · one evaluator over values ·   wants and their scheduler
           sync · views and deltas · status
        │  snapshots, diffs, commits, envelopes
 ── db/docs ──────────────────────────────────────────────────────────────────────────────────────────
           Loro documents · every value under a schema · envelopes signed and checked · versions, lines, merges · lenses
        │  blobs and refs
 ── store (aven/DB2/store) ───────────────────────────────────────────────────────────────────────────
           Store: blobs by BLAKE3, refs by compare-and-set · iroh-blobs through our adapter · S3, folder, opfs
 ── avenPEER ─────────────────────────────────────────────────────────────────────────────────────────
           iroh endpoint, relay, the door · /iroh-bytes/4 · iroh-gossip · aven/db/1 over irpc
```

Each layer knows only the one below it. The store knows bytes, not documents. The docs layer knows documents, values
and schemas, not queries or what a predicate means. The engine's core knows operations and values; its plugins know
meaning. Actors know operations and answers, not Loro.

## One primitive: the value

Proposed (D2). Once Loro documents ship, the docs layer enforces a schema on every value it stores: a document's root
has one, and every value inside it is typed by its place in that schema (Samuel, 30 Oct 2026). There are no
schemaless entries. So the engine needs one primitive only: the **value**, addressed `<doc>/<path>`, always with a
schema ([docs](../docs/README.md#values-what-the-schema-picks)).

| What | Its type | Where in the document | Example |
|---|---|---|---|
| A fact | its predicate (a predicate is a schema, [ontology](../ontology/README.md#predicates-and-vocabularies)) | `facts/<fact id>` | `due(x1 = 2026-11-02, x2 = t1)` |
| A chat line | the chat's line | `lines/<id>` in a movable list | `{ by, at, text }` |
| A page | the editor's page | the root, or `pages/<id>` | `{ title, body }`, `body` rich text |
| A file | `file` | wherever it is attached | `{ file: "b3:…", size, name, type }` |
| A setting | the app's settings | `settings` | `{ theme: "dark" }` |

**Tables are types.** A schema that has a name (and so a hash) is a **type**. Every value of one type forms one table
for queries: columns `id` (its address), `doc`, `path` and the type's fields. A value whose schema has no name of its
own, such as `theme` above, is a column of the value it sits in, not a table. For a fact, the fields are `x1`…`x5`,
typed by the predicate's places. Because a ref is always an address, a fact pointing at a page and a page pointing at a
file join the same way.

**Columns are read through lenses.** A value written under an older version of its type is read through the app's
view ([lenses](../docs/README.md#lenses)), so a table's columns are always the reader's version.

## The core and its plugins

| The core owns | A plugin brings |
|---|---|
| Values: tables by type, columns from the schema | Nothing new: its data are values of its types |
| Core operations: `query`, `put`, `patch`, `remove`, `want`, and their grammar | Its own operations and their meta-grammar (JSON Schema, `additionalProperties: false`) |
| One evaluator, its bound and its footprint | A **lowering**: a pure function from its operation to core operations |
| The one writer and the commit | Its checks beyond the schema (the ontology's: gismu places, typed refs, slot ids) |
| Views, deltas, status, wants, sync | Nothing: plugins never decide what moves or how answers flow |
| Lean: values, the evaluator, the writer, sync | Its Lean model, and the theorem that its lowering means what its model says (README, rule 10) |

So a plugin is a translator with checks, and the core is proven once. Bounds, footprints, caps and deltas are worked out
on core operations only, so a plugin can't get any of them wrong.

**Built in, for now** (D1, Samuel). A plugin is Rust in the engine's crate family, versioned with the engine. Loading
plugins at run time (WebAssembly) or writing them as actors would put untrusted code inside the one writer. It can come
later behind the same interface, once there is a case.

**The ontology plugin** ([ontology](../ontology/README.md)): `assert`, `set`, `retract` lower to `put`, `patch` and
`remove` of fact values at `facts/<id>`, with slot ids for traits that hold at most one fact
([ontology](../ontology/README.md#the-rules), rule 9); its checks are the meta-grammar, the gismu table and typed
places; `walk` over a category tree lowers to the core's bounded walk; it compiles kinds.

## Operations

### The envelope

```json
{ "plugin": "ontology/1", "grammar": "b3:4f1c…", "op": "mutate",
  "doc": "d:7Hq…", "params": { "n": 2 },
  "body": { "ops": [ { "op": "assert", "predicate": "b3:banana…" } ] } }
```

- `plugin` names the plugin and its major version, `core/1` for core operations; `grammar` is the hash of the
  meta-grammar the operation was written against, so a stored operation is always checked against its own grammar, and
  a new grammar is a new hash.
- `params` are the values given at run time; `{ "bind": "$actor" | "$vault" | "$now" }` cells are filled by the engine
  from the run and the writer's clock, never by the caller.
- A plugin operation is stored as written, which is what people and agents read. Its lowering is pure, so the lowered
  form is a cache keyed by the operation's hash and the plugin's version.

### Stored operations

An operation is a blob named by the BLAKE3 hash of its canonical JSON, like a schema, a lens or a predicate
([docs](../docs/README.md#the-rules), rule 14). That hash is its avenDB id (D7, Samuel): an actor's definition, a kind
or another operation refers to it by hash, so an actor's version pins exactly the operations it runs.

A **catalogue** is a document of a vault that maps names to hashes, so people and agents can say `projects.crowded` or
`invoice.list`:

```json
{ "operations": {
    "projects.crowded": "b3:9a0e…",
    "invoice.list":     "b3:51d2…", "invoice.create": "b3:c7f0…" } }
```

A catalogue is an ordinary document: it syncs, has history and lines, and changes by proposal where its vault says
so. A group of operations, such as the four a kind compiles to or the set an app ships, is a set of names in one
catalogue. Lookup follows the vocabularies' lanes: the vault's own, the network's, the core's.

## Wants: sync and load as one

### A want

```json
{ "want":     { "doc": "$room" },
  "part":     "values",
  "window":   { "newest": 50 },
  "follow":   1,
  "tier":     "now",
  "by":       "viewport",
  "lifetime": "mounted" }
```

- `want`: the target, in the **caps' target grammar** (D4, Samuel): a document, a vault's subtree, a kind of document in
  a vault, or a stored query whose rows name documents (`{ "query": "b3:…", "column": "x2" }`).
- `part`: `head` (that it exists and its version), `values` (what it holds), or `files` (the bytes of its file values,
  by schema field or media type).
- `window`: the newest `n`, or everything, for documents with long histories or long lists.
- `follow`: how many hops of refs to bring with it, at most three.
- `tier` and `by`: the order: tier first, then the signal (viewport, playhead, camera, list position).
- `lifetime`: `mounted` while a page or a turn needs it; `durable` until withdrawn.

Only the target is shared with caps; the rest is demand. What a device is served is the want's target intersected
with its caps, and a slot nobody bound wants nothing, never a whole vault.

### Actors declare, devices decide how deep

Decided (D5, Samuel). Actors live in the database and sync like any document, so one actor runs on a phone, a Mac and
the Aven Peer alike. Its definition is one hash everywhere, and its `loads` are part of it:

```json
{ "loads": [
    { "tier": "now",  "want": { "doc": "$room" }, "part": "values", "window": { "newest": 50 } },
    { "tier": "next", "want": { "query": "b3:…rooms.mine", "column": "id" }, "part": "head" },
    { "tier": "idle", "want": { "query": "b3:…rooms.mine", "column": "id" }, "part": "values" } ] }
```

The actor says what it needs, and how urgently; it never says which device it is on. The **device profile**, a
document of the device's own vault, says how deep that device keeps:

```json
{ "keep": { "tiers": [ "now", "next", "later" ], "bytes": "4 GB", "files": "on demand" },
  "also": [ { "want": { "doc": "d:9kP…" }, "part": "values" } ] }
```

So a Mac keeps the `idle` tier and a phone doesn't, with the same actor. Per-device variants inside an actor's
definition would make the definition's hash depend on the device, and the actor law "same engine hash and same journal
give the same state" relies on one definition everywhere. The `now` tier is never a device's choice: a turn runs only
when its `now` loads are present.

- A device's durable wants are the union of its profile's `also` and the tiers its profile keeps of the actors its
  person installed.
- A mounted want lives while its page is shown or its actor runs; then it is dropped.
- A composite actor's loads are the union of its members', each no higher than the tier the composite holds it at.
- The `now` tier is handed into each turn as `given`; later tiers arrive as messages as they come
  (`aven/actor/ARCHITECTURE.md`, sections 6 and 11).

### Sync and load, one scheduler

Every want names documents. The scheduler keeps one list of them, ordered by tier and signal: documents not held are
**fetched** (sync), documents held but not open are **opened** (load: imported, put into views), and both follow the
same order. A durable want also keeps its documents after nothing mounts them; a mounted one doesn't. Scopes carry
revisions with tombstones, so a late update can't revive a view that was cleared. There is no lease and no timer.

## The one writer

```
local mutations ──┐
                  ├─▶ the one writer ─▶ heads ─▶ snapshots stamped with heads ─▶ views ─▶ deltas ─▶ pages, actors
imported envelopes┘                                                            ─▶ status
```

The writer takes one item at a time. A mutation is lowered to core operations if it came in a plugin's grammar,
checked (grammar, bound, footprint against caps), committed through the docs layer as one commit through the app's view
([lenses](../docs/README.md#lenses)), signed into an envelope and handed to sync. An imported envelope is checked by the
docs layer ([envelopes](../docs/README.md#envelopes-and-peers)) and, where caps narrow below the document, by the
footprint of its diff, then imported. Either way the heads move, and everything downstream reacts to the new heads
(README, rule 4).

## Sync

**Live.** Changes not yet sealed travel as signed, sealed messages on an iroh-gossip topic shared by the peers that hold
the document. The Aven Peer can join and forward what it cannot read, as it keeps the chat's room alive in milestone 2.
Gossip is best effort; catching up fills any gap.

**At rest.** Segments and snapshots are blobs, moved by iroh-blobs through the store's adapter. How bytes are named,
kept and moved, one of each, is the store's: [One of each](../../store/README.md#one-of-each). A big file is a hash
sequence of chunk blobs of at most 1 MiB: [Big files are hash sequences](../../store/README.md#big-files-are-hash-sequences-decided).
The store's contract is unchanged by this except for a `size` method. A head is a ref and never travels as a blob.

**Catching up.** A device tells a peer the version of each document its wants name. The peer answers with the segments
and envelopes beyond that version that the device may receive, in the order they build on each other, a page at a
time. The device imports each page and asks on from the last thing it got, until nothing is left. Every page moves the
device's version forward, or the step stops (rule 16). Documents are asked for in the scheduler's order.

**Telling.** When a head changes, the writer announces it to the peers that may hold the document. A peer that is
behind asks for what it lacks.

**Before Loro: the chat.** Until milestone 4, the chat's history is one chain per device: each line a signed blob
naming the previous one, the device's ref `chat-<device>` its newest line ([store](../../store/README.md#the-chat-keeps-its-history)).
It already has the shape of rules 13 and 15: a head per device compared and walked back, two lines with one previous
line raised as a fork. Milestone 4 replaces the lines with Loro segments and keeps the shape.

### What we take from iroh

iroh is hardened where avenDB-old's own networking hurt most, so the engine writes its own only where iroh has no
fitting piece. Checked on 30 Oct 2026 against the crates DB2 pins.

| Need | From iroh | Notes |
|---|---|---|
| Connections, identity, NAT traversal, encryption | `iroh` 1.4.1 endpoint, its relay | Private: no n0 services, our own relay |
| The door | endpoint hooks (`after_handshake`), the relay's allow-list | Milestone 2 |
| Live changes and new heads | `iroh-gossip` 0.101 | Best effort; catching up stays the guarantee |
| Moving segments, snapshots and files | `iroh-blobs` 0.104 on our store through its adapter (decided by the store's spike, [store](../../store/README.md)) | Pinned exactly; nothing above the store names an iroh-blobs type |
| Who may fetch | iroh-blobs' provider events (`connected`, `get`, `push`) | A second gate after the door; push off unless allowed |
| Typed messages of `aven/db/1` | `irpc` 0.17 | Over iroh, and in process for the deterministic simulation (README, rule 2) |
| "Which of these do you have?" | iroh-docs' range-based set reconciliation, as a pattern | For many documents at once; per document, Loro's version vectors suffice |

Not taken: iroh-docs the crate (a last-writer-wins table without revocation), iroh-blobs' tags, garbage collector and
file store (the store keeps refs and backends of its own).

## Queries

A query reads tables of values, by type. Open tasks by due date, written directly in the core's grammar:

```json
{ "plugin": "core/1", "op": "query",
  "from": "task",
  "join": [ { "table": "done", "kind": "left", "on": { "column": "x1", "base": "id" } },
            { "table": "due",  "kind": "left", "on": { "column": "x2", "base": "id" } } ],
  "where": [ { "join": 0, "column": "id", "op": "isnull" } ],
  "order": [ { "join": 1, "column": "x1" } ],
  "project": [ "id", { "column": "x2", "as": "title" }, { "join": 1, "column": "x1", "as": "due" } ] }
```

A table is named by its schema (by name in the examples; stored, by hash), so `task`, `due` and `page` are all tables
whether their schema is a predicate or not. The grammar:

- `where`: `eq neq gt gte lt lte in` with a value or `{ "param": … }`; `isnull notnull`. Comparison follows the column's
  type: money by amount within one currency, dates as dates, never strings.
- `join`: `inner` or `left`, on a column of the base or of an earlier join (`{ "join": 0, "column": "id" }`). A
  reference forward or to itself is refused before anything runs.
- `walk`: a bounded transitive step over a ref column, such as `class_of` up a category tree, at most N hops.
- `group` with `count`, `sum`, `min`, `max` over typed columns, and `having`.
- `order`, `limit`, `project` (columns renamed with `as`, or `exists` booleans).

A fact joins a page, or a page its files, the same way, because every ref is `<doc>/<path>`. Open tasks that link to a
page, with the page's title:

```json
{ "plugin": "core/1", "op": "query",
  "from": "task",
  "join": [ { "table": "page", "kind": "inner", "on": { "column": "id", "base": "x3" } } ],
  "project": [ "id", { "column": "x2", "as": "task" }, { "join": 0, "column": "title", "as": "page" } ] }
```

**The bound** is the product of the values each step can read, capped by `limit` and by the walks' depths. A query
whose bound exceeds the device's limit is refused before it runs, with the bound in the answer. A query runs over the
documents the device holds and the run's caps let it open, nothing else. Until indexes come (below), each step scans
the values of its table in the documents it ranges over; the bound keeps that honest.

## Mutations

A mutation is core operations applied as one commit to one document, all or nothing: a step that fails undoes the steps
before it. The core's are `put` (a value at a path), `patch` (fields of values found by `where`) and `remove`
(values found by `where`); text, list and tree edits go through the docs layer's containers. The ontology plugin's
grammar is what people and agents usually write:

```json
{ "plugin": "ontology/1", "op": "mutate", "doc": "d:7Hq…", "params": { "n": 2 },
  "body": { "ops": [
    { "op": "assert", "predicate": "banana" },
    { "op": "assert", "predicate": "quantity", "cells": { "x1": { "ref": 0 }, "x2": { "param": "n" } } },
    { "op": "assert", "predicate": "eat",      "cells": { "x1": { "bind": "$actor" }, "x2": { "ref": 0 } } } ] } }
```

It lowers to three `put`s of fact values at `facts/<new id>`.

- `assert` adds a fact; `set` changes places of facts found by `where`; `retract` removes facts found by `where`.
- A cell is a literal, `{ "param": … }`, `{ "bind": … }`, or `{ "ref": n }`: the id op `n` created, where `n` is an
  earlier `assert` (an earlier `put` in the core).
- `when` skips an op unless a param is given.
- A trait with at most one fact per entity is put under its slot id ([ontology](../ontology/README.md#the-rules), rule
  9), so two devices setting it at once write one key.

## Kinds compile to operations

When a kind is saved ([ontology](../ontology/README.md#kinds)), its plugin compiles it into operations stored by hash and
named in the catalogue: `<kind>.list` (a query: the primary table joined to each trait, projected as the kind's view),
`<kind>.create`, `<kind>.update` and `<kind>.delete` (every trait fact of the entity, nested elements included). The
compiler handles every trait the ontology allows, `children` and `match` included, which avenOS's refused. Lean proves
the compiled operations equal the ontology's model of the kind. A kind lives inside one plugin (D8, Samuel); a kind
that mixes plugins waits for a real case.

## Answers

Every answer, whether to a query, a want or a load, carries:

- **its rows**, keyed by their row id;
- **the heads** they were computed from;
- **its status:** `complete`, `partial` (with what is held, known and waited for) or `denied`, and the phase
  (connecting, catching up with what is left, live, offline, stalled), from one status snapshot and one clock (README, rule 7).

**Live answers** are subscriptions. When heads change, the engine takes the docs layer's diff (which values changed),
recomputes the rows those values can touch, and pushes the difference: rows added, changed, removed. A page or an actor
holds the rows it was given and applies each delta.

**Pending writes.** A mutation from a page is shown at once: the engine lays its rows over the answers it touches until
the writer commits it (the overlay drops, the delta arrives) or refuses it (the overlay drops, nothing else changes).

## Who checks what

Decided (D9, Samuel). Loro itself checks nothing about authority: it is the CRDT. The docs layer wraps it and checks
every envelope; the engine checks every operation. Caps are checked twice (`aven/ID/caps/README.md`, rule 8): once where
an operation enters, once where its envelope is imported by every reader.

| Check | Where | When |
|---|---|---|
| Signer, peer, envelope chain, fork | docs | Every envelope, local or imported |
| Schema fit | docs | Once per envelope, cached |
| Write cap on the document | docs, asking avenID | Every envelope, local or imported |
| Grammar, and a plugin's own checks | engine | Before an operation is stored, and before it runs |
| Bound | engine, on the lowered operation | Before it runs |
| Footprint against caps narrower than a document (schemas, paths) | engine | Before an operation runs, and on every imported envelope's diff (milestone 3 on) |
| What a device is served | engine's sync: wants intersected with caps | Every request |
| What an actor is handed | engine: loads intersected with the run's caps | Every turn |

With values as the one primitive, a cap narrower than a document is a set of schemas and paths: "may write `due` and
`done` facts" is the schemas `due` and `done`, so caps reach facts without a rule of their own.

## Later: indexes

Decided (D10, Samuel): indexes come in a later iteration. The first queries scan the values of their tables within
their bound, over the documents a device holds; for the chat and the first apps that is small. An index may only make a
query faster, never change its answer (Lean: an index's answers equal a scan), so adding one later changes no
operation, no want and no answer.

Notes for that iteration, from this one's discussion:

- **Who builds them:** the docs layer's diff per head is the generic feed; the engine keeps the maps, keyed by heads and
  code version (rule 17); what is indexed follows the schemas and the stored queries. Nobody writes an index by hand.
- **No synced indexes:** an index synced between devices is derived state someone wrote, which a reader must trust or
  recompute. What must be shared, such as a phone's list of 10,000 invoices without the invoices, is a document kept by
  an act: a vault's **directory**, updated by the mutation that creates each one.
- **No blind index by default:** avenDB-old let the server answer "which entries carry this tag" over keyed hashes of
  labels, learning only equality; it cost re-hashing per audience, leaked who shares what, and was a second query
  engine. Per-document caps and a directory answer the same question on devices. It returns only if search across
  documents a device can't hold needs it.

## Decisions

1. **Plugins are built-in Rust,** versioned with the engine (Samuel, 30 Oct 2026). Untrusted code stays in actors, which
   write operations. Run-time plugins can come later behind the same interface.
2. **One primitive, the value, always under a schema** (proposed). The docs layer stores no value without a schema
   (Samuel, 30 Oct 2026), so a value and a typed record are the same thing and get one word. Facts, lines, pages and
   files are values of different types. One model of data in avenDB, not one per layer or plugin.
3. **Sync and load are one want** (Samuel, 30 Oct 2026): durable keeps, mounted opens, one scheduler orders both.
   avenDB-old had wants, keep shares, copy settings and follow lists for one job.
4. **A want's target is the caps' target grammar,** plus demand-only fields (Samuel, 30 Oct 2026). Served is want
   intersected with caps; authority is never demand.
5. **Actors declare, devices decide how deep** (Samuel, 30 Oct 2026). One actor definition everywhere; the device's
   profile picks which tiers it keeps.
6. **One evaluator; plugins lower to it** (proposed). avenOS's grammar already was an algebra over x1–x5 rows. With
   values as the primitive, the algebra belongs to the core, a plugin is a grammar with checks and a lowering, and
   bounds, footprints, caps and deltas are worked out and proven once.
7. **Operations are named by their hash,** avenDB's native id (Samuel, 30 Oct 2026); catalogues name them for people.
8. **A kind stays inside one plugin** for now (Samuel, 30 Oct 2026).
9. **The docs layer checks envelopes; the engine checks operations** (Samuel, 30 Oct 2026). Each checks what it can
   understand.
10. **Indexes in a later iteration** (Samuel, 30 Oct 2026). Queries scan within their bound until then.
11. **Mutations atomic per document.** A promise across documents would need coordination the network doesn't have.
12. **Sync by version, not by budget,** and **iroh before our own:** gossip for live changes and heads, iroh-blobs for
    bytes, irpc for our messages.
13. **avenACTORS' engine notes are research,** moved to [`../research/E1-avendb-old-engine.md`](../research/E1-avendb-old-engine.md)
    with nothing cut, so avenDB has one engine spec (Samuel, 30 Oct 2026).

## What Lean proves

`Aven.DB` grows an engine model, with vectors and traces every implementation loads (README, rule 10):

- **Operations:** an operation the grammar refuses is never stored or run; evaluation ends within its bound; what it
  reads and writes lies within its footprint. Vectors `operations.json`.
- **Queries:** the evaluator's results equal the model's on random documents; a chained join refers only backward; a
  live view after a delta equals a fresh run. Vectors `queries.json`.
- **Mutations:** all ops apply or none; every `{ "ref": n }` points at an earlier `put`; one document per mutation; a
  write outside its writer's caps is refused. Vectors `mutations.json`.
- **Wants:** tiers only order, never add or withhold; each document once, at its highest tier; an unbound slot wants
  nothing; served is within caps; a composite's member never rises above its tier. Vectors `wants.json`.
- **Sync:** two peers that answered each other hold the same envelopes of every document both keep; nothing a device may
  receive is withheld, and nothing it may not is sent; every catch-up step moves a version forward; a fork is detected.
  Traces `sync.json`.
- **Plugins:** each plugin's lowering means what its model says: the ontology's `assert`, `set` and `retract` equal its
  model of facts. Vectors `ontology.json`.
- **Kinds:** the compiled operations of every kind equal the ontology's model of it. Vectors `kinds.json`.

## Open questions

1. Which peer serves a catch-up: any member that holds the document, or the Aven Peer first?
2. What is a device's default query bound?
3. How many documents share a gossip topic, when a device holds thousands?
4. Delta granularity: rows (proposed), fields, or Loro updates?
5. Windows inside one document's history need snapshots plus the edits after them: milestone 4 or 7?
6. Is a vault's directory kept by every mutation that creates a document, or by the kinds' compiled operations?
7. Is the address `<doc>/<path>` stable enough when a value moves in a movable list or a tree, or does every value of a
   type carry its own id field, as the docs layer's lists already do?

## Not in this spec

Documents, versions, schemas and lenses ([docs](../docs/README.md)); what facts and kinds mean
([ontology](../ontology/README.md)); blobs and refs ([store](../../store/README.md)); caps themselves
(`aven/ID/caps/README.md`); actors, their kernel and journal (`aven/actor/ARCHITECTURE.md`); the network's door
(milestone 2); indexes (a later iteration); full-text search.
