# Docs: Loro documents, their versions, schemas and lenses

This folder is avenDB's document layer (milestone 4, "Docs", in the [README](../../README.md#milestones)), not
documentation. A proposal (30 Oct 2026) for milestones 4 (docs), 5 (version control) and 6 (schemas and lenses).

Everything a document is lives here: its values and the Loro containers that hold them; its envelopes, segments,
snapshots and head; its history, versions, lines and merges; the schemas that shape its values and the lenses that carry
them between versions. Two neighbours build on it: the [engine](../engine/README.md) syncs documents and runs queries
and mutations over them, and the [ontology](../ontology/README.md) says what their values mean. Nothing here is built
before its milestone, and avenDB-old's learnings come in as rules and Lean theorems, never as code (README, rule 12).

## What avenDB-old taught

avenDB-old (`aven/db`) ran Loro documents with history, proposals, schemas and lenses for months. What held and what
hurt:

| | What happened | Here |
|---|---|---|
| **Held** | A document is one root map; its schema picks each field's container (text merging by character, rows by id, single values), so merge behaviour is declared, not coded | Rule 1, "Values" |
| **Held** | Each device edits as a Loro peer of its own, derived from its signer and the line, so an import can check every op is its signer's. No clock goes into an update: the same edits export the same bytes | Rules 2 and 3 |
| **Held** | Each change carries the schema it was written through as its commit message | Rule 6 |
| **Held** | Lenses instead of migrations, with laws proven in Lean (T9): round trips, GetPut, PutGet, an older app keeps what it can't see | Rule 7, "Lenses" |
| **Held** | Lines: proposals from any version, a lossless three-way merge place by place (T10), restore, undo of an older edit, variants that follow main, drafts that land | Rule 12, "History" |
| **Held** | Versions open read-only on a scratch copy; full snapshots only, because a shallow one refuses a proposal that starts before it | Rules 5 and 11 |
| **Hurt** | Accepted is not counted: peers store writes that readers later refuse, and every reader replays and re-judges every write ("why isn't my edit there?") | Rule 10: judged once, cached, shown |
| **Hurt** | A view took one lens hop, else it opened read-only. All eight shipped lenses only added fields; a version that dropped fields left their data unseen | Rules 8 and 9 |
| **Hurt** | The schema lane was parsed anew on every read until memoised; schemas, caps and fit all fed one 6,083-line rules file | Lanes are caches; caps live apart (milestone 3) |
| **Hurt** | Loro's revert wasn't atomic (Loro 1.16), so revert was built from a merge | Decision 8 |

The first Lojban engine (`hominio-legacy`, 2025) adds one more: it gave every device the same Loro peer id, so edits from
two devices to one document couldn't merge safely, and it persisted a document's whole history on every change.

## Terms

avenDB has two primitives (Samuel, 30 Oct 2026):

- **Value:** immutable bytes named by the BLAKE3 hash of exactly those bytes; a structured Value is canonical JSON. Like
  an IPFS CID: what a name names never changes. In the store it is a blob. Schema versions, lenses, predicates' and
  kinds' versions, operations, actor definitions, segments, snapshots and a file's chunks and index are Values.
- **Doc** (document): mutable, one Loro document, named by a stable id; its head is a ref pointing at Values (its
  snapshot and segments). Like IPNS: the name stays, what it points at moves. The unit of sharing, sealing, caps, sync
  and atomic change. A Doc is a **root Record** (rule 16). Types, predicates, kinds, catalogues, vocabularies and actors
  are Docs.

Reference a Value's hash to pin something exactly; reference a Doc's id to follow it as it changes. Both are written with
a capital; a lowercase value is just a field's data.

- **Record:** one piece of a Doc, named by its own id and addressed `<doc>/<id>` (the Doc's root Record is `<doc>`),
  always under a schema (rule 15); where it sits in the Doc can change, its address can't. Each field in a
  **container**: text, list, movable list, map, tree, counter, or a single value.
- **type:** a named schema: a Doc whose versions are schema Values. A Record of a type carries its `kind` constant; a
  Doc holds one such Record or many. A type says whether its Records are roots.
- **envelope:** one or more Loro changes, signed by a device and sealed with the document's key.
- **segment:** a sealed batch of envelopes, a Value.
- **snapshot:** a document's whole state and history at a version, a Value.
- **head:** a ref naming a document's version, its latest snapshot and the segments after it.
- **peer:** the Loro peer a device edits as, one per document and line.
- **line:** a run of history: **main**, a **proposal**, a **variant** (a proposal that stays open), or a **draft** (a
  new document's own line until its vault takes it in).
- **version:** any set of a document's changes, with what they build on; a frontier.
- **schema:** one version of a Record's shape, a Value.
- **lane:** the schemas and lenses a vault or a network counts.
- **lens:** a two-way mapping between two schema versions, a Value.
- **view:** an app's schema, plus the lenses that reach the versions a Record was written under.
- **fit:** whether an envelope's changes are allowed by the schemas it names.

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **A document is one Loro document.** Its values sit in one root map; each field goes in the container its schema
   picks.
2. **Every device is its own Loro peer, per document and line,** derived from its device key, the document and the
   line, never shared and never reused. An import refuses an envelope holding an op of any peer but its signer's.
3. **No clocks in Loro.** Timestamps are off, so the same changes export the same bytes. When something was written comes
   from its signed envelope.
4. **A container made after the document is born is made mergeable,** so two devices creating it at once share it
   instead of one hiding the other.
5. **The envelopes are the truth.** Segments carry them; snapshots and heads are derived from them, and loading from a
   snapshot gives what replaying every envelope gives. A snapshot keeps full history while any line starts before it.
6. **Every change names its schema.** Its commit message is the hash of the schema of the view it was written through,
   so a reader knows which versions wrote a Record. A merge, restore or undo names none.
7. **Nothing is migrated.** A Record is read through lenses into the app's schema and written back as the difference:
   only what changed, in the representation the Record already uses. A default is never written, and what an older app
   can't see survives its edits.
8. **Lenses compose.** A view reaches any version a path of lenses in the lane joins to it, and the laws hold along the
   path. With no path, or two that disagree, the Record opens read-only and says why.
9. **A version that drops a field says where its data goes:** a lens into another field or Record, or "kept, unseen".
   Data is never silently orphaned.
10. **Fit is judged once per envelope.** Every reader checks each envelope it imports against the schemas it names, and
    keeps the verdict as a cache keyed by the envelope, the lane and the code version (README, rule 5). An unfit
    envelope, and everything built on it, counts for no one. A device never makes an unfit write, and shows what didn't
    count and why.
11. **Versions open on a scratch copy,** never by checking out the live document, which would stop it taking imports.
12. **Merges are three-way, place by place.** Nothing the target line changed since the base is lost; everything the
    other line changed alone lands; where both changed one place differently, the target keeps its own unless the
    person merging takes the other's.
13. **Catching up never rewrites** (README, rule 6). Moving Records into a newer schema's representation is an act: an
    ordinary edit a person or an agent makes through lenses, signed like any other.
14. **Schemas and lenses are Values, each version's type a Doc.** One counts in a vault's lane only when a device
    acting for that vault created it on main.
15. **Every Record is under a schema** (Samuel, 30 Oct 2026). A Doc's root has one, and every Record inside it is typed
    by its place in it. There are no schemaless entries, so the [engine](../engine/README.md#one-primitive-the-record)
    queries Records by type and nothing else.
16. **A type says which of its Records are roots** (Samuel, 30 Oct 2026). A root Record is a Doc of its own: an invoice,
    a page, a project, a chat room, an actor. Any other Record lives inside the Doc it belongs to and changes atomically
    with it: an invoice's lines, a chat's lines, a task's facts. Every Record is a Loro container either way; only a
    root pays for a head, a key, caps and a catch-up of its own.

## Architecture

### A document at rest

```json
{ "doc": "d:7Hq…",
  "version": { "a91f…": 41, "0c2e…": 7 },
  "snapshot": "b3:9c0e…",
  "segments": ["b3:11f2…", "b3:a4d7…"] }
```

The head is a ref, changed by compare-and-set in the store (`db/store`). Loading reads the snapshot and imports the
segments after it. The changes being made right now travel live to the document's other peers until they are sealed into
the next segment (the [engine](../engine/README.md#sync) moves all three).

### Values: what the schema picks

| The schema says | Loro container | When two devices edit at once |
|---|---|---|
| a string with `"x-loro": "text"` | Text | merges character by character |
| rich text, for the editor | Text with marks | merges character by character; marks by Loro's rules |
| a list of values | List | both inserts kept |
| a list of Records, each with an `id` | MovableList of Maps, rows matched by `id` | rows added, moved or edited apart all land |
| an outline or folders | Tree | moves merge; a move that would make a cycle is dropped |
| a counter | Counter | adds sum |
| a map of entries (`additionalProperties`) | Map | one value per key, the last writer's |
| anything else | one value in its parent map | the last writer's |

The ontology's facts are the "map of entries" row: a map from fact id to fact Record, each Record read through its
predicate's schema ([ontology](../ontology/README.md#where-facts-live)).

### Envelopes and peers

A device's peer on a line is the first 64 bits of `BLAKE3(device key, document, line)`. An envelope carries the line,
the signer, the Loro changes and the schema they were written through; it is signed by the device and sealed with the
document's key. Importing one checks, in order:

1. the signature, and that the signer may write the document (caps, milestone 3);
2. that every op is from the signer's peer for that document and line;
3. that what it builds on is here (otherwise it waits, with whatever builds on it);
4. its fit (rule 10).

Then the one writer imports it ([engine](../engine/README.md#the-one-writer)).

### History, versions and lines

- **Main** is what a document shows by default.
- **A proposal** starts from any version and has a name. It is merged into main or dropped.
- **A variant** is a proposal that stays open beside main and follows it by merges of main into it, keeping its own
  value wherever both changed one place.
- **A draft** is a new document's own line; its main holds nothing until its vault lands it with a merge.
- **A version** can be named by a small Record in the document: `{ "name": "sent to Bob", "at": <frontier> }`.

A merge is a change on the target line that builds on both lines' heads, so its history is the union of both, which Loro
merges. Loro's union alone silently keeps one value where both lines changed a place. So the merge also carries the
change that brings the merged state to the three-way merge of the two lines' Records from their base, place by place: a
field, a row of a list of Records with all its fields, the order of a list's rows. Restoring puts a line back to a
version's Record; undoing an older change is a three-way merge that takes out just that change; a fork copies a Record
into a new document without its history.

An example: Bob, who may suggest but not edit, proposes "Order seeds by Friday" on Alice's todo, which says "Order
seeds". Meanwhile Alice ticks it done on main. Her merge of Bob's proposal lands his title (only he changed it) and keeps
her done (only she changed it): no conflict, nothing lost. Had both changed the title, Alice's would stay unless she took
Bob's.

### Schemas

A schema is a JSON Schema (2020-12) subset, plus `x-loro` for the container and `x-link` for a link to a document or a
row. The Record's `kind` constant finds its family.

```json
{ "title": "Todo, v1", "type": "object",
  "properties": {
    "kind":   { "const": "todo" },
    "title":  { "type": "string", "default": "" },
    "status": { "enum": ["open", "doing", "done"], "default": "open" },
    "notes":  { "type": "string", "x-loro": "text", "default": "" },
    "due":    { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" } },
  "required": ["kind"] }
```

- Its hash names it. A new version is new bytes, so a new hash; the newest of a kind is the one no lens leads on from.
- **Lanes,** looked up in order: the vault's own, the network's (published by the admin coop), and the built-in one
  avenDB ships, the same bytes everywhere. A lane is a cache rebuilt when its documents change.
- **Fit** checks only what an envelope changed: the values are ones the schemas allow; changed rows read under a schema
  of the lane; every schema it names is in the lane and of one kin (one kind, or kinds a lens joins), so no write can tag
  a Record with another kind's schema to slip fields in. Depth is capped.

### Lenses

A lens is a short list of steps:

```json
{ "lens": "Todo, v0 to v1", "from": "b3:40de…", "to": "b3:0d78…",
  "steps": [ { "convert": { "from": ["done"], "to": ["status"],
      "forward":  [ [ { "done": true }, { "status": "done" } ], [ { "done": false }, { "status": "open" } ] ],
      "backward": [ [ { "status": "done" }, { "done": true } ], [ { "status": "open" }, { "done": false } ],
                    [ { "status": "doing" }, { "done": false } ] ] } } ] }
```

- **Steps:** `add` (a field only the newer version has), `rename`, `convert` (a table of rows forward and backward, or
  a pair of named functions Lean defines, such as text to money), `in` (steps for each row of a list), `wrap` and
  `unwrap` (a field to a nested Record and back), `move` (a field to another Record of the same document), and
  `container` (a single value to a text and back).
- **Reading:** where both versions stored the same thing, the newer field wins; what neither stored shows the schema's
  default, which is never written.
- **Writing:** only fields whose view changed are written. A newer app writes the newer fields; an older app writes
  into the newer fields once any is stored.
- In the example, a v0 app ticking a todo stores `status: "done"` once the item holds a status, and `doing` reads as
  not done in v0. That loss is stated: `bwd (fwd t) = t` holds for every v1 todo whose status isn't `doing`.

### What the engine and the ontology build on

- **The engine** moves envelopes, segments, snapshots and heads; commits each mutation through a view; reads current
  values, and versions on scratch copies.
- **The ontology** keeps facts in a map of entries; a predicate is the schema of a fact Record, so predicates have
  versions, lanes and lenses like any schema; a slot id is just a key of that map, so two devices writing one slot write
  one key.

## Decisions

1. **Loro, one root map per document.** One CRDT for text, lists, trees and values, with history, versions and forks
   built in.
2. **A peer per device per line.** It makes "every op is its signer's" checkable, keeps a device's work on one line in
   one run of ops, and rules out hominio's shared peer id.
3. **Envelopes are the truth; snapshots and heads are derived.** Anything derived can be rebuilt, and a wrong snapshot
   can be thrown away.
4. **Full snapshots.** History is forgotten only by an owner's act, which closes every line that starts before it.
5. **Fit judged once and cached.** avenDB-old re-judged every write on every reader on every catch-up; a verdict keyed
   by envelope and lane needs computing once per device.
6. **Lenses compose, and drops say where.** avenDB-old's one-hop limit and orphaned fields were the reasons lenses went
   unused beyond adding fields.
7. **A three-way merge on top of Loro's union.** The union keeps everything; the three-way merge decides what a person
   sees, and never loses either side's lone changes.
8. **Revert from a merge,** not from Loro's revert, until Lean and the tests show Loro's is atomic.

## What Lean proves

`Aven.DB` grows a model of documents, with vectors and traces every implementation loads (README, rule 10):

- **Peers:** an envelope with an op from a peer not its signer's is refused; distinct (device, document, line) give
  distinct peers, under the hash assumption.
- **Convergence:** the same envelopes in any order give the same values and export the same bytes.
- **Snapshots:** loading a snapshot and the segments after it equals replaying every envelope.
- **Fit:** the verdict depends only on the envelope and the lane, so every reader agrees; an unfit envelope and what
  builds on it count for no one.
- **Lenses:** GetPut, PutGet, an older version keeps what it can't see, and composition keeps all three; a lossy step
  states its loss. Vectors `lenses.json`.
- **Merges:** nothing the target changed is lost, everything the other line changed alone lands, a conflict changes
  only by the person's choice, and the merged history is the union. Vectors `merges.json`.

## Open questions

1. Is a snapshot each device's own cache, or shared, signed by a device of the document's vault?
2. When is a segment sealed: by count, by size, by time?
3. Do named versions live in the document, or as refs in the store?
4. Which named conversions does the first lens catalogue need (text to money, text to date, text to number)?
5. Is this a crate of its own or part of `db/core`?

## Not in this spec

Sync and the one writer ([engine](../engine/README.md)); what values mean ([ontology](../ontology/README.md)); caps
(milestone 3); the store's contract (`db/store`); the editor's UI.
