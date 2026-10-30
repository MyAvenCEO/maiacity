# Engine: sync, queries and mutations

A proposal (30 Oct 2026) for how avenDB moves documents between peers and works on them: the one writer, sync and the
sync manifest, the local index, and the query and mutation languages with the engine that runs them. It is written for
milestones 4 (one document synced) and 7 (sync manifest and queries), with caps from 3. It builds on the
[docs](../docs/README.md) layer (documents, envelopes, versions, schemas, lenses) and runs over the
[ontology](../ontology/README.md)'s facts and kinds. Nothing here is built before its milestone, and nothing comes in
from the older engines as code ([README](../../README.md), rule 12).

## What it takes from before

| From | What held | Here |
|---|---|---|
| avenOS, boards 0101–0112 | Queries and mutations as specs checked against a fixed grammar, never SQL from a model; values always bound, places allow-listed; chained joins; `HAVING` counts; `{ "ref": n }` to point at what an earlier op created; deletes confirmed by a person; kinds compiled to stored operations at save time, and the second, interpreting path deleted once parity was proven | "Queries", "Mutations", "Kinds compile to operations" |
| avenDB-old sync | Each history compared by its frontier, one digest each; a device asks with its frontier and a few changes further back, and is sent only what lies beyond, so nothing it lacks is withheld (T19); a change waits outside until what it builds on arrives; two changes of one device where neither builds on the other reveal a cloned device, an old backup or a stolen key; nothing about a document leaves a peer for a device that may not receive it (T12); a changed digest is told straight to each peer that may hold it, not on a gossip topic that would name its members | "Sync" |

And what hurt, from the README's "Why a rebuild": one Lab behind one lock served reads, peers, catch-up and writes in
turn; catch-up ran in budgeted steps that could loop without progress; derived state lived only in the writer's memory,
bound to code versions; status numbers came from different moments. The rules below start from those.

## Terms

- **the one writer:** the single task in each peer that changes its data (README, rule 1).
- **manifest:** what a device keeps: documents named, or queries that name documents.
- **index:** a device's derived lookup over the facts it can open.
- **operation:** a query or a mutation spec, stored as data.
- **query:** a spec that reads facts and returns rows. A **live query** keeps its rows current and pushes changes.
- **mutation:** a spec of changes to one document, applied as one commit.
- **bound:** the most work a query may do, computed from its spec and the facts it reads before it runs.

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **The one writer applies every change:** local mutations and imported envelopes, in turn. Pages, peers and status
   read immutable snapshots stamped with the head they are correct at, and never wait on it.
2. **Sync compares, then sends what's missing.** Two peers compare a document's heads and version vectors; each sends
   exactly what the other lacks and may receive, and withholds nothing.
3. **Receiving is not reading.** A peer without a document's key stores and forwards its sealed bytes and can read none
   of them. The Aven Peer is such a peer for everything not published.
4. **An envelope waits for what it builds on,** together with whatever builds on it.
5. **A fork is raised, not merged quietly.** Two envelopes of one device on one line where neither builds on the other
   mean a cloned device, an old backup or a stolen key.
6. **Catching up only reads and always progresses** (README, rules 3 and 6). Each step has a progress measure; a step
   that moves nothing stops and raises the stall alarm. Status names the phase: connecting, catching up with what is
   left, live, offline, stalled.
7. **A device keeps what its manifest names,** never everything it could receive.
8. **Operations are specs checked against a fixed grammar,** whose meaning Lean defines, before they are stored and
   before they run. A model writes specs, never code.
9. **Every query has a bound before it runs,** and graph walks name their depth.
10. **A mutation is one commit to one document,** all or nothing. Work across documents is several mutations, each
    atomic; nothing promises a transaction the network can't give.
11. **Retracting is a person's act.** An agent can propose a mutation that retracts; a person confirms it.
12. **Every write is checked against its writer's caps:** by document, and by predicate where the cap narrows that far
    (milestone 3).
13. **The index and every view are caches** keyed by the heads they were built from and the code version (README, rule
    5). A rebuild never blanks a screen: the last result stays until the next is ready.
14. **Live queries push deltas** (README, rule 8). The UI never re-queries.
15. **A kind compiles to its operations once, when it is saved.** The engine runs operations only.

## Architecture

### The one writer

```
local mutations ─┐
                 ├─▶ the one writer ─▶ document heads ─▶ snapshots stamped with heads ─▶ index, views, live queries ─▶ UI
imported envelopes┘                                                                    ─▶ status
```

The writer takes one item at a time: a mutation from a page or an agent, or an envelope sync brought in. A mutation is
checked (grammar, caps, the predicates' places, the schemas' fit), turned into one Loro commit through a view
([docs](../docs/README.md#lenses)), signed into an envelope and handed to sync. An imported envelope is checked as the
docs layer says ([envelopes](../docs/README.md#envelopes-and-peers)) and imported. Either way the head moves, and
everything downstream reacts to the new head (README, rule 4).

### Sync

**Live.** Changes not yet sealed travel over `aven/db/1` to the document's other peers that are online: members whose
caps let them receive it (README, rule 9).

**At rest.** Segments and snapshots are blobs, moved by blob transfer and verified by their hash; a head is a ref.

**Catching up.** A device tells a peer its version of each document it keeps. The peer answers with the segments and
envelopes beyond that version, in the order they build on each other, a page at a time. The device imports each page and
asks on from the last thing it got, until nothing is left. Every page moves the device's version forward or the step
stops (rule 6).

**Telling.** When a head changes, the writer tells each peer that may hold the document, directly, with the new digest.
A peer that is behind asks.

**The manifest** says what a device keeps (milestone 7):

```json
{ "keep": [ { "doc": "d:7Hq…" },
            { "query": "projects.mine", "docs": "x2" } ] }
```

A query in the manifest names documents through a place of its rows, so "every project I'm a member of" keeps those
projects' documents on this device, and a new membership brings a new document. A manifest's queries run only over what
the device already holds.

### The index

Each device keeps an index of the facts in the documents it can open: by predicate, by predicate and place and value,
and by what refers to an id. Queries run on it, across every document the device holds. The Aven Peer queries nothing,
because it can read nothing. The index is a cache (rule 13), updated from each head's changes and rebuilt when the code
version changes.

### Queries

A query names a base predicate, filters, joins, and what to return. Open todos by due date:

```json
{ "from": "task",
  "join": [ { "predicate": "done", "kind": "left", "on": { "place": "x1", "base": "id" } },
            { "predicate": "due",  "kind": "left", "on": { "place": "x2", "base": "id" } } ],
  "where": [ { "join": 0, "place": "id", "op": "isnull" } ],
  "order": [ { "join": 1, "place": "x1" } ],
  "project": [ "id", { "place": "x2", "as": "title" }, { "join": 1, "place": "x1", "as": "due" } ] }
```

The grammar:

- `where`: `eq neq gt gte lt lte in` with a value or `{ "param": … }`; `isnull notnull` for presence. A filter targets
  the base or a join. Comparison follows the place's value type (money by amount within one currency, dates as dates).
- `join`: `inner` or `left`, correlated on the base's id or a place, or on an earlier join (`{ "join": 0, "place":
  "id" }`), so a query walks a chain of referents to any written-out depth. A reference forward or to itself is refused
  before anything runs.
- `walk`: a bounded transitive step, such as `class_of` from a category up to its roots, at most N hops.
- `group`, with `count`, `sum`, `min`, `max` over typed value places, and `having`.
- `order` and `limit`.
- `project`: places of the base or a join, renamed with `as`, or `exists` booleans.

Three levels, "2 kg of rice", where the unit is a fact about the quantity, not the rice:

```json
{ "from": "item",
  "join": [ { "predicate": "quantity", "kind": "left", "on": { "place": "x1", "base": "id" } },
            { "predicate": "unit", "kind": "left", "on": { "place": "x1", "base": { "join": 0, "place": "id" } } } ],
  "project": [ "id", { "place": "x2", "as": "name" }, { "join": 0, "place": "x2", "as": "qty" },
               { "join": 1, "place": "x2", "as": "unit" } ] }
```

A query's bound is the product of the facts each step can read, capped by its `limit` and its walks' depths; a query
whose bound exceeds the device's limit is refused before it runs, with the bound in the answer.

### Mutations

A mutation is a list of ops applied as one commit to one document, all or nothing:

```json
{ "doc": "d:7Hq…", "params": ["n"],
  "ops": [ { "op": "assert", "predicate": "banana" },
           { "op": "assert", "predicate": "quantity", "cells": { "x1": { "ref": 0 }, "x2": { "param": "n" } } },
           { "op": "assert", "predicate": "eat",      "cells": { "x1": { "bind": "$actor" }, "x2": { "ref": 0 } } } ] }
```

- `assert` adds a fact; `set` changes places of facts found by `where`; `retract` removes facts found by `where`.
- A cell is a literal, `{ "param": … }`, `{ "bind": "$actor" | "$vault" | "$now" }`, or `{ "ref": n }`: the id op `n`
  created. `n` must be an earlier `assert`.
- `when` skips an op unless a param is given.
- A trait with at most one fact per entity is written under its slot id ([ontology](../ontology/README.md#the-rules),
  rule 9), so two devices setting it at once converge.

### Kinds compile to operations

When a kind is saved ([ontology](../ontology/README.md#kinds)), the engine compiles it into four operations stored beside
it: `<kind>.list` (the primary predicate joined to each trait, projected as the kind's view), `<kind>.create`,
`<kind>.update` and `<kind>.delete` (every trait fact of the entity, nested elements included). Apps and agents run
those; nothing interprets a kind at run time. The compiler handles every trait the ontology allows, nested and fixed
ones included, and Lean proves the compiled operations equal the ontology's model of the kind.

### Live queries

A live query is a subscription. When a head changes, the engine works out which of its rows the change can touch (by
the predicates and ids it reads), recomputes only those, and pushes the difference: rows added, changed, removed. A page
holds the rows it was given and applies each delta.

## Decisions

1. **One engine, one writer.** avenOS kept an interpreter beside its operations until a parity test let it delete one;
   avenDB-old's one Lab did everything behind one lock. Here the writer only writes, and readers read snapshots.
2. **Specs, never code, from a model.** It is what made avenOS's model-authored queries safe, and in avenDB there is
   nothing a spec could run besides the engine's own steps.
3. **Queries on devices, over a local index.** No peer that can read facts serves queries for others, so each device
   answers its own over what it holds.
4. **Mutations atomic per document.** A promise across documents would need coordination the network doesn't have.
5. **Sync by version, not by budget.** Comparing versions decides what is sent and redone (README, rule 4); a step with
   no progress stops instead of looping.
6. **The manifest as queries.** What a device keeps follows what its person works with, and changes when that changes.
7. **Telling peers directly.** A gossip topic per document would tell every member which documents exist; a direct
   message tells only peers that may hold it.

## What Lean proves

`Aven.DB` grows an engine model, with vectors and traces every implementation loads (README, rule 10):

- **Sync:** two peers that answered each other hold the same envelopes of every document both keep; nothing a device may
  receive is withheld, and nothing it may not is sent; every catch-up step moves a version forward, so catch-up ends;
  a fork is detected. Traces `sync.json`.
- **Queries:** evaluation ends within the bound computed before it runs; a chained join refers only backward; results
  equal the model's on random fact sets; a live query's rows after a delta equal a fresh run. Vectors `queries.json`.
- **Mutations:** all ops apply or none; every `{ "ref": n }` points at an earlier assert; a mutation touches one
  document; a write outside its writer's caps is refused. Vectors `mutations.json`.
- **Kinds:** the compiled operations of every kind equal the ontology's model of it. Vectors `kinds.json`.

## Open questions

1. Is the manifest a document of the device's own vault, or of its person's?
2. Which peer serves a catch-up: any member that holds the document, or the Aven Peer first?
3. iroh-blobs for segments, or `bao-tree` directly on our store (README, "What we take from iroh")?
4. How is the index laid out on disk, and how big may it grow on a phone?
5. What is a device's query bound by default?

## Not in this spec

Documents, versions, schemas and lenses ([docs](../docs/README.md)); what facts and kinds mean
([ontology](../ontology/README.md)); caps themselves (milestone 3); the network's door (milestone 2); full text search.
