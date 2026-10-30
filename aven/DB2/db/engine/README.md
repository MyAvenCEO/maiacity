# Engine: one operations engine for queries, mutations and sync

avenDB's engine (30 Oct 2026). Everything an app, an agent or a device asks of its data is an **operation**: a piece
of JSON checked against a fixed grammar, then run by the engine over document snapshots. Operations come from
**plugins**. The engine's core is small and fixed: the one writer, the operation envelope, the shared query algebra,
**wants** (what is synced and what is loaded, one concept), indexes, live answers and the checks. The
[ontology](../ontology/README.md)'s x1–x5 facts are the first plugin, and records are the second.

It is written for milestones 4 (one document synced) and 7 (wants and queries), with caps from 3. It sits on the
[docs](../docs/README.md) layer (Loro documents, envelopes, versions, schemas, lenses), which sits on the
[store](../../store/README.md) (blobs and refs). Nothing here is built before its milestone, and nothing comes in from
older engines as code ([README](../../README.md), rule 12).

**Status.** Decided by Samuel on 30 Oct 2026: plugins are built in (D1), sync and load are one want (D3), wants use the
caps' target grammar (D4), operations are named by their avenDB hash (D7), kinds stay inside one plugin (D8), and
avenACTORS' engine notes are folded in here. **Proposed, waiting for Samuel:** the shared query algebra (D6), where
indexes live and that none sync (D10), and how actors and devices share wants (D5). They are marked "proposed" where
they appear.

## Contents

1. [What it takes from before](#what-it-takes-from-before)
2. [Terms](#terms)
3. [The rules](#the-rules)
4. [The layers](#the-layers)
5. [The core and its plugins](#the-core-and-its-plugins)
6. [Operations](#operations)
7. [Wants: sync and load as one](#wants-sync-and-load-as-one)
8. [The one writer](#the-one-writer)
9. [Sync](#sync)
10. [Indexes](#indexes)
11. [Queries](#queries)
12. [Mutations](#mutations)
13. [Kinds compile to operations](#kinds-compile-to-operations)
14. [Answers](#answers)
15. [Who checks what](#who-checks-what)
16. [Decisions](#decisions)
17. [What Lean proves](#what-lean-proves)
18. [Open questions](#open-questions)

## What it takes from before

The research is in [`../research`](../research/README.md): avenOS's x1–x5 engine ([C1](../research/C1-avenos-x1-x5-core.md),
[C2](../research/C2-avenos-invoice.md)) and avenDB-old's query and sync engine ([E1](../research/E1-avendb-old-engine.md),
by avenACTORS). The actor and caps designs this builds on are avenACTORS' `aven/actors/README.md` and
`aven/ID/caps/README.md`.

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

- **operation:** a JSON spec of work: a query, a mutation or a want. Data that people and agents write.
- **plugin:** code built into the engine that brings operation kinds, their grammar, relations to query, and mutations
  over its own part of a document. The **ontology** plugin owns facts; the **records** plugin owns records.
- **fact:** one `predicate(x1…x5)` entry in a document's facts map ([ontology](../ontology/README.md#where-facts-live)).
  The unit of meaning: small, typed, reusable across apps.
- **record:** a value at a path in a document, shaped by that document's schema
  ([docs](../docs/README.md#values-what-the-schema-picks)): a page's rich text, a chat's list of lines, a settings
  map, a tree. Anything that is not a fact.
- **relation:** rows a plugin offers to queries. Facts of one predicate are a relation with columns `id`, `x1`…`x5`;
  records of one schema are a relation with columns `id`, `doc`, `path` and the schema's fields.
- **want:** what a device or an actor asks to have: a target, a part, a tier and a lifetime. It orders and never
  authorizes.
- **durable want:** decides what a device **keeps** (sync). **Mounted want:** decides what is **open** (loaded,
  indexed, in views) while a page shows it or an actor runs.
- **tier:** `now` (on screen, needed for a turn), `next` (one click away), `later` (the rest of the screen's data),
  `idle` (kept offline).
- **loads:** the wants an actor's definition declares, in tiers. An actor's manifest.
- **device profile:** a device's own setting of how deep it keeps: which tiers become durable, and how many bytes.
- **catalogue:** a vault's document mapping names to operation hashes.
- **footprint:** what an operation reads and writes: documents, and inside them predicates or paths.
- **bound:** the most work an operation may do, computed before it runs.
- **index:** a device's derived lookup over what it has open. A cache.
- **view:** a query's current rows, stamped with the heads they were computed from. A cache.
- **the one writer:** the single task in each peer that changes its data (README, rule 1).

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **The one writer applies every change:** local mutations and imported envelopes, in turn. Pages, actors, peers and
   status read immutable snapshots stamped with the heads they are correct at, and never wait on it.
2. **Everything asked of the engine is an operation,** checked against its plugin's grammar before it is stored and
   before it runs. A model writes operations, never code.
3. **Plugins are code; operations are data.** A plugin ships with the engine, with its Lean model and vectors. No
   operation can make the engine run anything but its own steps.
4. **One want for sync and load.** A durable want decides what a device keeps; a mounted want what it opens. There is
   no second manifest.
5. **A want grants nothing.** What a device is sent is its wants intersected with its caps; what an actor is handed
   is its loads intersected with its run's caps.
6. **Wants are computed from definitions and bound slots, never by reading data first.** A want that is a query runs
   only over what the device already holds.
7. **Tiers only order.** A tier never adds or withholds a document; each document is fetched once, at the highest tier
   anyone wants it; a new `now` want goes ahead of everything else.
8. **Every operation has a bound and a footprint before it runs.** A query over its bound is refused with the bound in
   the answer; an operation whose footprint its caps don't cover is refused. Nothing fails halfway.
9. **A mutation is one commit to one document,** all or nothing. Work across documents is several mutations.
10. **Retracting is a person's act.** An agent proposes a mutation that removes data; a person confirms it.
11. **Sync compares, then sends what's missing,** withholding nothing the asker may receive and sending nothing it may
    not.
12. **Receiving is not reading.** A peer without a document's key stores and forwards its sealed bytes and reads none of
    them. The Aven Peer is such a peer for everything not published.
13. **An envelope waits for what it builds on. A fork is raised, not merged quietly.**
14. **Catching up only reads and always progresses** (README, rules 3 and 6): every step moves a version forward, or it
    stops and raises the stall alarm.
15. **Indexes and views are caches** keyed by the heads they were built from and the code version (README, rule 5).
    They never sync. A rebuild never blanks a screen.
16. **Answers say how complete they are:** complete, partial (with what is waited for) or denied, and the phase.
17. **Live answers are pushed deltas** (README, rule 8). Nothing re-queries.
18. **Writes go first.** A local write is shown at once and laid over answers until the writer commits it; a refused
    write leaves no trace.
19. **A kind compiles to operations once, when it is saved.** The engine runs operations only.

## The layers

```
 actors (aven/actors)     declare loads, hold caps, run turns; operations come from them and from pages
        │  operations                       ▲ answers, deltas, `given`
 ── db/engine ────────────────────────────────────────────────────────────────────────────────────────
 core      the one writer · envelope and checks · wants and their scheduler · sync · the query algebra
           indexes · views and deltas · status
 plugins   ontology (facts, x1–x5)   records (values by path and schema)   … more later, built in
        │  snapshots, diffs, commits, envelopes
 ── db/docs ──────────────────────────────────────────────────────────────────────────────────────────
           Loro documents · envelopes signed and checked · versions, lines, proposals, merges · schemas, lenses
        │  blobs and refs
 ── store (aven/DB2/store) ───────────────────────────────────────────────────────────────────────────
           Store: blobs by BLAKE3, refs by compare-and-set · iroh-blobs through our adapter · S3, folder, opfs
 ── avenPEER ─────────────────────────────────────────────────────────────────────────────────────────
           iroh endpoint, relay, the door · /iroh-bytes/4 · iroh-gossip · aven/db/1 over irpc
```

Each layer knows only the one below it. The store knows bytes, not documents. The docs layer knows documents and their
schemas, not queries or what a predicate means. The engine knows operations and wants, and asks plugins for meaning.
Actors know operations and answers, not Loro.

## The core and its plugins

| The core owns | A plugin brings |
|---|---|
| The envelope, and the check that runs a plugin's grammar | Its operation kinds and their meta-grammar (JSON Schema, `additionalProperties: false`) |
| The query algebra: filter, join, walk, group, order, limit, project | Relations: its rows and their columns, typed |
| Bounds of queries | Per-relation cost: how many rows a step can read, from the index |
| Footprints and the caps check | A pure function from an operation, or an envelope's diff, to what it reads and writes |
| Indexes, their keys and their rebuild | Its index needs: which keys its relations are looked up by |
| The one writer and the commit | Mutations over its own part of a document, as a pure function from snapshot and op to Loro changes |
| Views, deltas, status | Which rows a document change touches |
| Wants, sync | Nothing: plugins never decide what moves |
| Lean: the algebra, the writer, sync | Its Lean model and vectors (README, rule 10) |

**Built in, for now** (D1). A plugin is Rust in the engine's crate family, versioned with the engine. Loading plugins at
run time (WebAssembly) or writing them as actors would put untrusted code inside the one writer. It can come later
behind the same interface, once there is a case.

**The ontology plugin** ([ontology](../ontology/README.md)): relations are predicates, one per predicate hash, columns
`id`, `x1`…`x5`, typed by the predicate's places; index needs are by predicate, by predicate and place and value, and by
what refers to an id; mutations are `assert`, `set` and `retract`; it adds `walk` for category trees; it compiles kinds.

**The records plugin:** relations are schemas, one per schema hash, columns `id` (`<doc>/<path>`), `doc`, `path` and
the schema's fields as read through the app's view ([lenses](../docs/README.md#lenses)); index needs are by schema, by
schema and field; mutations are `put`, `patch` and `remove` at a path, and text, list and tree edits go through the docs
layer's containers. It is what a chat, a page or a settings map uses.

**Facts or records.** A fact is the right home for anything that means something on its own and that other apps may
reuse: a task, its due date, who is a member of what, an invoice's total. A record is the right home for content whose
shape is the document's own: the text of a page, the order of a chat's lines, a 3D world's tree. A todo app is facts;
an editor is records; most apps are both, which is why queries may join them.

## Operations

### The envelope

```json
{ "plugin": "ontology/1", "grammar": "b3:4f1c…", "op": "mutate",
  "doc": "d:7Hq…", "params": { "n": 2 },
  "body": { "ops": [ { "op": "assert", "predicate": "b3:banana…" } ] } }
```

- `plugin` names the plugin and its major version; `grammar` is the hash of the meta-grammar the operation was written
  against, so a stored operation is always checked against its own grammar, and a new grammar is a new hash.
- Queries and wants belong to the core (`"plugin": "core/1"`), since they range over every plugin's relations.
- `params` are the values given at run time; `{ "bind": "$actor" | "$vault" | "$now" }` cells are filled by the engine
  from the run and the writer's clock, never by the caller.

### Stored operations

An operation is a blob named by the BLAKE3 hash of its canonical JSON, like a schema, a lens or a predicate
([docs](../docs/README.md#the-rules), rule 14). That hash is its avenDB id (D7): an actor's definition, a kind or
another operation refers to it by hash, so an actor's version pins exactly the operations it runs.

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
  "part":     "record",
  "window":   { "newest": 50 },
  "follow":   1,
  "tier":     "now",
  "by":       "viewport",
  "lifetime": "mounted" }
```

- `want`: the target, in the **caps' target grammar** (D4): a document, a vault's subtree, a kind of document in a
  vault, or a stored query whose rows name documents (`{ "query": "b3:…", "column": "x2" }`).
- `part`: `head` (that it exists and its version), `record` (its values), or `files` (its blobs, by a schema field or a
  media type).
- `window`: the newest `n`, or everything, for documents with long histories or long lists.
- `follow`: how many hops of refs to bring with it, at most three.
- `tier` and `by`: the order: tier first, then the signal (viewport, playhead, camera, list position).
- `lifetime`: `mounted` while a page or a turn needs it; `durable` until withdrawn.

Only the target is shared with caps; the rest is demand. What a device is served is the want's target intersected
with its caps, and a slot nobody bound wants nothing, never a whole vault.

### Actors declare, devices decide how deep (proposed, D5)

Actors live in the database and sync like any document, so one actor runs on a phone, a Mac and the Aven Peer alike.
Its definition is one hash everywhere, and its `loads` are part of it:

```json
{ "loads": [
    { "tier": "now",  "want": { "doc": "$room" }, "part": "record", "window": { "newest": 50 } },
    { "tier": "next", "want": { "query": "b3:…rooms.mine", "column": "id" }, "part": "head" },
    { "tier": "idle", "want": { "query": "b3:…rooms.mine", "column": "id" }, "part": "record" } ] }
```

The actor says what it needs, and how urgently; it never says which device it is on. The **device profile**, a
document of the device's own vault, says how deep that device keeps:

```json
{ "keep": { "tiers": [ "now", "next", "later" ], "bytes": "4 GB", "files": "on demand" },
  "also": [ { "want": { "doc": "d:9kP…" }, "part": "record" } ] }
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
  (`aven/actors/README.md`, section 9.3).

### Sync and load, one scheduler

Every want names documents. The scheduler keeps one list of them, ordered by tier and signal: documents not held are
**fetched** (sync), documents held but not open are **opened** (load: imported, indexed, put into views), and both
follow the same order. A durable want also keeps its documents after nothing mounts them; a mounted one doesn't.
Scopes carry revisions with tombstones, so a late update can't revive a view that was cleared. There is no lease and
no timer.

## The one writer

```
local mutations ──┐
                  ├─▶ the one writer ─▶ heads ─▶ snapshots stamped with heads ─▶ indexes, views ─▶ deltas ─▶ pages, actors
imported envelopes┘                                                            ─▶ status
```

The writer takes one item at a time. A mutation is checked (grammar, bound, footprint against caps), turned by its
plugin into Loro changes, committed through the docs layer as one commit through the app's view
([lenses](../docs/README.md#lenses)), signed into an envelope and handed to sync. An imported envelope is checked by the
docs layer ([envelopes](../docs/README.md#envelopes-and-peers)) and, where caps narrow below the document, by the
plugin's footprint of its diff, then imported. Either way the heads move, and everything downstream reacts to the new
heads (README, rule 4).

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
device's version forward, or the step stops (rule 14). Documents are asked for in the scheduler's order.

**Telling.** When a head changes, the writer announces it to the peers that may hold the document. A peer that is
behind asks for what it lacks.

**Before Loro: the chat.** Until milestone 4, the chat's history is one chain per device: each line a signed blob
naming the previous one, the device's ref `chat-<device>` its newest line ([store](../../store/README.md#the-chat-keeps-its-history)).
It already has the shape of rules 11 and 13: a head per device compared and walked back, two lines with one previous
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

## Indexes

Proposed (D10), with the reasoning, since it decides where a lot of code lives.

### What an index is for

A query like "open tasks by due date" must not read every fact of every document. An index answers "which facts have
predicate `due`" or "which records of schema `page` have `project = X`" directly. It is pure derived state: anything in
it can be recomputed from the documents.

### Who writes it, and in which layer

| Layer | What it gives indexes | Why not more |
|---|---|---|
| store | nothing | It knows bytes, not values |
| docs | **the change feed**: for each new head, the diff (which paths changed, old and new value), and snapshot reads by path | It knows paths and schemas but not what a query will look up; an index of every path by every value would be large and still not know a ref from a string |
| engine core | **the index machinery**: keyed, ordered, incremental maps, stamped with the heads they cover and the code version, rebuilt without blanking (rule 15) | It knows queries, so it knows which lookups are needed |
| plugins | **what is indexed**: their index needs, from the meaning of their relations (by predicate and place for facts, by schema and field for records, refs reversed) | |

So nobody writes indexes by hand. A plugin declares its index needs; a stored query may ask for one more key, which
the engine builds when the query is first opened; the docs layer feeds every index the same diffs. Samuel leaned toward
a fully generic index in the docs layer. The generic part is there: the change feed is generic and every index is
built from it. The keys can't be generic without knowing meaning, which the docs layer deliberately doesn't have.

### Why indexes don't sync

A synced index would let a phone list 10,000 invoices with their totals without holding them. But an index synced
between devices is derived state written by someone: a reader must either trust it (and a forged or stale index lies)
or recompute it (and then it didn't need the synced one). Each device updating a shared index while catching up would
also be catching up that writes (README, rule 6), and two sources of truth for one value is avenDB-old's shape. So:

- **Indexes are local caches** and never sync (rule 15).
- **What should be shared is authored, not derived.** If a phone needs the list of invoices without the invoices, that
  list is a document someone keeps by an act: a vault's **directory** of its documents (id, kind, name, a few summary
  fields), updated by the same mutation that creates or changes a document. It syncs like any document, is checked
  like any document, and a want for its `head` part is cheap.

### The blind index, and why not now

avenDB-old sealed every entry, so the server could store everything and read nothing. To let it still answer "which
entries are tagged `garden`", each device computed a keyed hash of each label with the audience's key (`token =
H(audience key, "tag:garden")`) and stored the tokens beside the sealed entry. A device asking for `garden` computed the
same token and asked the server for entries carrying it. The server learnt only equality: which entries share a token,
and how often each is asked for, never the label.

It worked, at a cost: a token per label per audience, re-made whenever an audience changed (the marks and steward work
in E1); the server learning the shape of who shares what; and a second, weaker query engine on the server beside the
device's.

Here the question it answered, "which documents may I have, and which matter", has cheaper answers. Caps are per
document, so a device's caps already list the documents it may read. A vault's directory, synced as an ordinary
sealed document, says what they are. Every query then runs on a device over what it holds (D10), and the Aven Peer
answers none. If a case appears where a device must find something among documents it can't hold (search across a
huge archive), a blind index can come back as a plugin with its own Lean model, as an open question, not a default.

## Queries

Proposed (D6): one query algebra in the core, over the relations of every plugin.

```json
{ "plugin": "core/1", "op": "query",
  "from": { "facts": "task" },
  "join": [ { "facts": "done", "kind": "left", "on": { "column": "x1", "base": "id" } },
            { "facts": "due",  "kind": "left", "on": { "column": "x2", "base": "id" } } ],
  "where": [ { "join": 0, "column": "id", "op": "isnull" } ],
  "order": [ { "join": 1, "column": "x1" } ],
  "project": [ "id", { "column": "x2", "as": "title" }, { "join": 1, "column": "x1", "as": "due" } ] }
```

A relation is `{ "facts": <predicate> }` or `{ "records": <schema> }` (by name in the examples; stored, by hash). The
grammar:

- `where`: `eq neq gt gte lt lte in` with a value or `{ "param": … }`; `isnull notnull`. Comparison follows the column's
  type: money by amount within one currency, dates as dates, never strings.
- `join`: `inner` or `left`, on a column of the base or of an earlier join (`{ "join": 0, "column": "id" }`). A
  reference forward or to itself is refused before anything runs.
- `walk`: a bounded transitive step, such as `class_of` up a category tree, at most N hops.
- `group` with `count`, `sum`, `min`, `max` over typed columns, and `having`.
- `order`, `limit`, `project` (columns renamed with `as`, or `exists` booleans).

Joining facts to records, "open tasks that link to a page, with the page's title":

```json
{ "plugin": "core/1", "op": "query",
  "from": { "facts": "task" },
  "join": [ { "records": "page", "kind": "inner", "on": { "column": "id", "base": "x3" } } ],
  "project": [ "id", { "column": "x2", "as": "task" }, { "join": 0, "column": "title", "as": "page" } ] }
```

The task's x3 is a ref, `<document>/<id>`; a page record's id has the same form, so the join is an ordinary equality.
Without a shared algebra this needs two queries and an actor gluing them, and the bound of the whole is nobody's.

**The bound** is the product of the rows each step can read, from the index's counts, capped by `limit` and by the
walks' depths. A query whose bound exceeds the device's limit is refused before it runs, with the bound in the answer.
A query runs over the documents the device holds and the run's caps let it open, nothing else.

## Mutations

A mutation is one plugin's ops applied as one commit to one document, all or nothing: a step that fails undoes the
steps before it. The ontology plugin's:

```json
{ "plugin": "ontology/1", "op": "mutate", "doc": "d:7Hq…", "params": { "n": 2 },
  "body": { "ops": [
    { "op": "assert", "predicate": "banana" },
    { "op": "assert", "predicate": "quantity", "cells": { "x1": { "ref": 0 }, "x2": { "param": "n" } } },
    { "op": "assert", "predicate": "eat",      "cells": { "x1": { "bind": "$actor" }, "x2": { "ref": 0 } } } ] } }
```

- `assert` adds a fact; `set` changes columns of facts found by `where`; `retract` removes facts found by `where`.
- A cell is a literal, `{ "param": … }`, `{ "bind": … }`, or `{ "ref": n }`: the id op `n` created, where `n` is an
  earlier `assert`.
- `when` skips an op unless a param is given.
- A trait with at most one fact per entity is written under its slot id ([ontology](../ontology/README.md#the-rules),
  rule 9), so two devices setting it at once write one key.

The records plugin's are `put`, `patch` and `remove` at a path, with text, list and tree edits through the docs layer's
containers. A mutation of both kinds on one document is two operations, or a kind's compiled create (below).

## Kinds compile to operations

When a kind is saved ([ontology](../ontology/README.md#kinds)), its plugin compiles it into operations stored by hash and
named in the catalogue: `<kind>.list` (a core query: the primary relation joined to each trait, projected as the kind's
view), `<kind>.create`, `<kind>.update` and `<kind>.delete` (every trait fact of the entity, nested elements included).
The compiler handles every trait the ontology allows, `children` and `match` included, which avenOS's refused. Lean
proves the compiled operations equal the ontology's model of the kind. A kind lives inside one plugin (D8); a kind that
mixes facts and records waits for a real case.

## Answers

Every answer, whether to a query, a want or a load, carries:

- **its rows**, keyed by their row id;
- **the heads** they were computed from;
- **its status:** `complete`, `partial` (with what is held, known and waited for) or `denied`, and the phase
  (connecting, catching up with what is left, live, offline, stalled), from one record and one clock (README, rule 7).

**Live answers** are subscriptions. When heads change, the plugins say which rows the diff can touch, the engine
recomputes those rows only, and pushes the difference: rows added, changed, removed. A page or an actor holds the rows
it was given and applies each delta.

**Pending writes.** A mutation from a page is shown at once: the engine lays its rows over the answers it touches until
the writer commits it (the overlay drops, the delta arrives) or refuses it (the overlay drops, nothing else changes).

## Who checks what

Loro itself checks nothing about authority: it is the CRDT. The docs layer wraps it and checks every envelope; the
engine checks every operation. Caps are checked twice (`aven/ID/caps/README.md`, rule 8): once where an operation
enters, once where its envelope is imported by every reader.

| Check | Where | When |
|---|---|---|
| Signer, peer, envelope chain, fork | docs | Every envelope, local or imported |
| Schema fit | docs | Once per envelope, cached |
| Write cap on the document | docs, asking avenID | Every envelope, local or imported |
| Grammar | engine | Before an operation is stored, and before it runs |
| Bound | engine, with the plugin's costs | Before it runs |
| Footprint against caps narrower than a document (predicates, paths) | engine, with the plugin's footprint function | Before an operation runs, and on every imported envelope's diff (milestone 3 on) |
| What a device is served | engine's sync: wants intersected with caps | Every request |
| What an actor is handed | engine: loads intersected with the run's caps | Every turn |

So the bound and a footprint finer than a document are the engine's, because only the engine and its plugins know what
an operation or a diff means; everything about the envelope is the docs layer's (D9).

## Decisions

1. **Plugins are built-in Rust,** versioned with the engine (Samuel, 30 Oct 2026). Untrusted code stays in actors, which
   write operations. Run-time plugins can come later behind the same interface.
2. **One envelope, with the grammar's hash.** A stored operation is checked against the grammar it was written for, so a
   grammar can grow without breaking stored operations.
3. **Sync and load are one want** (Samuel, 30 Oct 2026): durable keeps, mounted opens, one scheduler orders both.
   avenDB-old had wants, keep shares, copy settings and follow lists for one job.
4. **A want's target is the caps' target grammar,** plus demand-only fields (Samuel, 30 Oct 2026). Served is want
   intersected with caps; authority is never demand.
5. **Actors declare, devices decide how deep** (proposed). One actor definition everywhere; the device's profile picks
   which tiers it keeps.
6. **One query algebra in the core, over every plugin's relations** (proposed). avenOS's grammar already was an algebra
   over x1–x5 rows; making rows a plugin's offer lets facts join records, with one bound.
7. **Operations are named by their hash,** avenDB's native id (Samuel, 30 Oct 2026); catalogues name them for people.
8. **A kind stays inside one plugin** for now (Samuel, 30 Oct 2026).
9. **The docs layer checks envelopes; the engine checks operations** (proposed). Each checks what it can understand.
10. **Indexes are local caches, built by the engine from plugins' needs over the docs layer's change feed; nothing
    derived syncs; no blind index; queries run on devices only** (proposed). What must be shared is authored, such as a
    vault's directory.
11. **Mutations atomic per document.** A promise across documents would need coordination the network doesn't have.
12. **Sync by version, not by budget,** and **iroh before our own:** gossip for live changes and heads, iroh-blobs for
    bytes, irpc for our messages.
13. **avenACTORS' engine notes are research,** moved to [`../research/E1-avendb-old-engine.md`](../research/E1-avendb-old-engine.md)
    with nothing cut, so avenDB has one engine spec (Samuel, 30 Oct 2026).

## What Lean proves

`Aven.DB` grows an engine model, with vectors and traces every implementation loads (README, rule 10):

- **Operations:** an operation the grammar refuses is never stored or run; evaluation ends within its bound; what it
  reads and writes lies within its footprint. Vectors `operations.json`.
- **Queries:** the algebra's results equal the model's on random documents; a chained join refers only backward; a live
  view after a delta equals a fresh run. Vectors `queries.json`.
- **Mutations:** all ops apply or none; every `{ "ref": n }` points at an earlier assert; one document per mutation; a
  write outside its writer's caps is refused. Vectors `mutations.json`.
- **Wants:** tiers only order, never add or withhold; each document once, at its highest tier; an unbound slot wants
  nothing; served is within caps (`want ∩ caps`); a composite's member never rises above its tier. Vectors
  `wants.json`.
- **Sync:** two peers that answered each other hold the same envelopes of every document both keep; nothing a device may
  receive is withheld, and nothing it may not is sent; every catch-up step moves a version forward; a fork is detected.
  Traces `sync.json`.
- **Kinds:** the compiled operations of every kind equal the ontology's model of it. Vectors `kinds.json`.
- **Plugins:** each plugin's model, with its relations, mutations, footprint and costs, and the check that its index
  answers equal a scan.

## Open questions

1. Which peer serves a catch-up: any member that holds the document, or the Aven Peer first?
2. How is the index laid out on disk, and how big may it grow on a phone?
3. What is a device's default query bound?
4. How many documents share a gossip topic, when a device holds thousands?
5. Delta granularity: rows (proposed), fields, or Loro updates?
6. Windows inside one document's history need snapshots plus the edits after them: milestone 4 or 7?
7. Is a vault's directory kept by every mutation that creates a document, or by the kinds' compiled operations?
8. Does a search across documents a device can't hold ever need a blind index plugin?

## Not in this spec

Documents, versions, schemas and lenses ([docs](../docs/README.md)); what facts and kinds mean
([ontology](../ontology/README.md)); blobs and refs ([store](../../store/README.md)); caps themselves
(`aven/ID/caps/README.md`); actors, their kernel and journal (`aven/actors/README.md`); the network's door
(milestone 2); full-text search.
