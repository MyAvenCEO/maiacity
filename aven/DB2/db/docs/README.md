# Docs: Loro Docs, their history, schemas and lenses

This folder is avenDB's document layer, not documentation. It is the spec (30 Oct 2026) for three steps: **Loro
docs** (Docs, Records, envelopes, logs, segments, checkpoints, one Doc synced), **version control** (branches, merges,
reverts, named versions, forks, history) and **schemas and lenses** (types, fit, lenses). It was built up from first
principles with Samuel on 30 Oct 2026; every decision below is his unless it says otherwise.

Everything a Doc is lives here. Two neighbours build on it: the [engine](../engine/README.md) runs operations and wants
over Docs, and the [ontology](../ontology/README.md) says what their Records mean. Below it sit the
[store](../../store/README.md) (Values and refs, iroh-blobs through our adapter, unchanged by this spec) and avenID's
[caps](../../id/caps/README.md) (keys, seals, who may write). Shared words are the
[glossary](../../GLOSSARY.md)'s and the [architecture](../../ARCHITECTURE.md)'s, in exactly their sense. Nothing here
is built before its step's plan names it, and avenDB-old's learnings come in as rules and Lean theorems, never as code
(README, rule 12).

## Contents

1. [From first principles](#from-first-principles)
2. [What avenDB-old taught](#what-avendb-old-taught)
3. [What we take from Loro](#what-we-take-from-loro)
4. [Terms](#terms)
5. [The rules](#the-rules)
6. [A Doc](#a-doc)
7. [Envelopes](#envelopes)
8. [Logs, segments and the head](#logs-segments-and-the-head)
9. [Snapshots and checkpoints](#snapshots-and-checkpoints)
10. [Importing: three verdicts](#importing-three-verdicts)
11. [Splits](#splits)
12. [Branches, merges and forks](#branches-merges-and-forks)
13. [History and its analysers](#history-and-its-analysers)
14. [Types, schemas and fit](#types-schemas-and-fit)
15. [Lenses](#lenses)
16. [Streams: period Docs](#streams-period-docs)
17. [Directories and indexes](#directories-and-indexes)
18. [The chat moves onto a Doc](#the-chat-moves-onto-a-doc)
19. [What the engine and actors build on](#what-the-engine-and-actors-build-on)
20. [Decisions](#decisions)
21. [What Lean proves](#what-lean-proves)
22. [Order of work](#order-of-work)
23. [Open questions](#open-questions)
24. [Not in this spec](#not-in-this-spec)

## From first principles

avenDB has two primitives (Samuel, 30 Oct 2026):

- A **Value** is immutable and named by the BLAKE3 hash of its bytes.
- A **Doc** is mutable and named by a stable id. Its head moves; its name stays.

Everything else is built from them:

1. **The truth is signed envelopes.** One device signs one atomic change to one Doc, and the envelope is a Value.
2. **History is Loro's causal graph of those envelopes,** named by hash. There is no second graph.
3. **Everything else is derived and can be rebuilt:** segments, snapshots, checkpoints, the head's contents, state,
   Records, diffs and blame.
4. **Meaning sits on top:** schemas say what a Record may hold, lenses carry Records between schema versions, and
   branches name parts of the history.
5. **A Doc is the unit of sharing, sealing, caps and atomic change.** Every reader checks every envelope itself, from
   what the envelope names, and every reader reaches the same verdict.

Only one thing in avenDB is mutable: a Doc's head, the store's ref from the Doc's id to a Value. Refs never leave their
peer ([architecture](../../ARCHITECTURE.md#the-primitives-everything-shares)). Every other thing is a Value, and every
name is a hash or is worked out from one.

## What avenDB-old taught

avenDB-old (`aven/db`) ran Loro documents with history, proposals, schemas and lenses for months. Its Lean
(`aven/db/spec/AvenDB`) and Rust (`aven/db/crates/avendb`) were read again for this spec; nothing is copied.

| | What happened | Here |
|---|---|---|
| **Held** | One root map per document; the schema picks each field's container, so merge behaviour is declared, not coded | Rule 2, [A Doc](#a-doc) |
| **Held** | A Loro peer per device and line, and an import refused if any op is another peer's (`doc.rs`); timestamps off; the schema's hash as the commit message; mergeable containers created late | Rules 8 to 10 |
| **Held** | Full snapshots only: a shallow one refuses a branch that starts before it | Rule 12 |
| **Held** | Merge laws without `sorry`: commutative, idempotent, nothing lost, the target keeps its own on a conflict (`Doc.lean`, T10a–h) | [Merges](#merging) |
| **Held** | Fit judged only on what a write changed, with a depth ceiling of 256, and kinship by lenses (`Schemas.lean`, S1, S2) | [Fit](#fit) |
| **Hurt** | **Two causal graphs:** its own write graph (`EditId`, `deps`) over Loro's. "Version" meant two things, and each line's content was rebuilt from JSON on every read | Rule 7: one graph, Loro's, named by hash |
| **Hurt** | **Splits inside Loro went unseen** (`doc.rs:391`): a device restored from a backup reused its counters, and each reader kept whichever copy came first | Rules 7 and 14 |
| **Hurt** | **Merges ran on JSON**, not on containers: any two edits to one text conflicted, and any two moves of rows conflicted | [Merges](#merging) on Loro's union |
| **Hurt** | **"Snapshot" meant the owners' signed word** on an entry, which showed the entry read-only; judgment metadata came on the owners' word too | Rule 12: a snapshot is a cache; a checkpoint is checked |
| **Hurt** | **Fit re-judged by every reader on every catch-up**, and parsed anew on every read until memoised | Rule 15: judged once, from what the envelope names |
| **Hurt** | **Lenses of one hop**, and all eight shipped lenses only added fields; a version that dropped fields orphaned their data | Rules 19 and 20 |
| **Hurt** | **Loro's revert wasn't atomic** (1.16), so revert was built from a merge | Loro 1.17.1's `revert_to` is all or nothing ([below](#what-we-take-from-loro)) |
| **Hurt** | A variant was a proposal whose name began with byte `0xFF`; a proposal's name lived in a write's body; no named versions; no blame by field; undo without a Lean model; `LatestReplay` proved a tautology | [Branches](#branches-merges-and-forks) and [history](#history-and-its-analysers) as Records and Lean models |
| **Hurt** | Segments were never closed by count, size or time; the only limit was 65,536 ids per message | [Closing segments](#closing-a-segment) |

The first Lojban engine (`hominio-legacy`, 2025) gave every device the same Loro peer, so two devices' edits to one
document couldn't merge safely, and it persisted a document's whole history on every change.

## What we take from Loro

Loro 1.17.1, pinned exactly, is the CRDT. Its own docs, its glossary, its agent skill and the notes in its source were
studied for this spec (30 Oct 2026). We use its terms as it means them, and its best practices as rules:

- **Never reuse a peer**, and never use a user's id as one; two sessions on one peer give two ops one id. Our writer ids
  are worked out per device, Doc, branch and generation, and the committer holds the device's lock, the locking Loro
  asks for when a peer is reused across sessions (rule 8).
- **Timestamps off,** so the same edits export the same bytes (rule 9).
- **Mergeable children** (`ensure_mergeable_*`) wherever two writers may create the same child at once (rule 10).
- **Choose the container by merge behaviour:** text for prose, a map for values replaced whole, a movable list for
  reordering, a tree for outlines, a counter for sums. Hard invariants don't belong in a CRDT (rule 16).
- **Sync by version vector, checkpoint by frontiers.**
- **Keep ephemeral state out of the Doc:** presence and cursors travel apart (the network's presence).
- **Undo is local:** Loro's `UndoManager` undoes one editor's own recent edits. It is not history's back out.

What Loro 1.17.1 changes in the design, read in its source:

- **`revert_to` and `apply_diff` are all or nothing** (loro-dev/loro#1154): on an error the doc's state, history and
  version are as before. Revert uses Loro's own; a commit is one `apply_diff`.
- **An import that reuses an op id with other content is refused** with `UsedOpID` before anything changes. A split can
  no longer scramble a Doc's state. It can still show two readers two histories, which rules 7 and 14 close.
- **A Loro transaction has no rollback.** A commit is therefore built as one diff batch and applied all or nothing,
  never as steps that could stop halfway.
- **Loro merges a peer's consecutive commits into one Change** for storage, unless their messages differ. An envelope
  is cut by its commit's op-id range, not by Loro's Change boundaries.
- **`subscribe_pre_commit`** sees every commit, implicit ones included: that is where the commit message is set.
- **Loro composes as trees, not graphs:** links between Records are ids, never shared containers.

## Terms

**Primitives**

- **Value:** immutable bytes named by their BLAKE3 hash, written `b3:<hex>`. At rest it is a blob. A structured Value
  is deterministic CBOR in the strict profile, avenDB's one codec ([architecture](../../ARCHITECTURE.md), rule 1,
  A2); JSON is its readable form, and every example in this spec is shown in it.
- **Doc:** mutable data named by the hash of its signed genesis, written `d:<hex>`. Its state is the merge of its logs.
  The unit of keys, caps, sync and atomic change. A Doc is a **root Record**.
- **Record:** one typed piece of a Doc, a Loro map container named by its own id, addressed `<doc>/<id>`, always under
  a schema. Where it sits can change; its address can't. Inside one Doc a link may name the bare id.
- **field:** a Record's value, or one of its containers.
- **container:** Loro's word for how a field merges: text, list, movable list, map, tree, counter, or a value replaced
  whole. Every Record is a map container; not every container is a Record.
- **link:** a field holding the address of a Record or a Doc (`x-link`).

**Loro's, as Loro means them**

- **op, op id:** one atomic edit, named by (writer id, counter).
- **commit:** one atomic set of ops, with its message.
- **version:** a set of envelopes with everything they build on. Pointed at by its **frontiers**, synced by its
  **version vector**; in this spec always also named by the hashes of its tip envelopes.
- **import, export, pending, checkout, diff:** as in Loro. A checkout always happens on a scratch copy.
- **revert to:** make a branch equal to an older version by a new commit (Loro's `revert_to`). It replaces "restore".
- **undo, redo:** Loro's `UndoManager`, one editor's own recent edits.

**Ours**

- **writer id:** the 64-bit Loro peer a device writes a branch as. Not an identity: worked out from the signing
  device as `writer(device, doc, branch, generation)`.
- **writer:** a log's author, a device. **The committer:** the one task in each peer that applies changes (README,
  rule 1).
- **genesis:** a Doc's first signed Value: its vault, its root type, the schema versions it pins and a nonce.
- **envelope:** one commit, signed by a device, named by its hash; the truth.
- **log:** one writer's envelopes in one Doc and branch, each naming the one before by hash.
- **segment:** a closed run of one log in one epoch, sealed and hybrid-signed as one Value.
- **loose envelope:** one not yet covered by a closed segment.
- **head:** a peer's own pointer to what it holds of a Doc, a small Value kept under the Doc's ref.
- **snapshot:** a peer's own cache of a branch at a version (a Loro snapshot). Never travels.
- **checkpoint:** a sealed, hybrid-signed statement that a snapshot is a branch at a version and covers these
  segments. Travels, and is checked. A state taken from one and not yet checked is **unchecked**.
- **branch:** a named run of a Doc's history with its own logs and state: **main**, a **proposal** (opened to be
  merged into main) or a **variant** (a branch that follows main by merges). A new Doc made by someone who may only
  propose starts as a proposal over an empty main.
- **base:** the version two branches last shared.
- **merge:** a commit on the target branch that builds on both branches and settles them three-way from their base.
- **conflict:** a place both branches changed differently since their base.
- **back out:** take one older commit out and keep everything since (git's "revert", Mercurial's word).
- **named version:** a Record `{ name, at }` in the branch it names.
- **fork:** a new Doc started from a version of another, with that state and a link to its origin, not its history.
- **split:** two different envelopes from one writer after the same one. Final.
- **generation:** a device's fresh start on a branch, after a split or a stuck log.
- **counts:** an envelope counts when it is **fit**, **authorized** and **not a split**, and everything it builds on
  counts.
- **stuck:** a log whose next envelope would build on one that doesn't count.
- **type:** a Doc whose versions are schemas, joined by lenses. **schema:** one version of a Record's shape, a Value.
  **pin:** a schema version a Doc accepts for a type. **type id:** a version's address in its type Doc,
  `<type Doc>/<schema hash>`, the one way a version is named anywhere.
- **fit:** whether an envelope's changes are allowed by the schemas it names.
- **lens:** a two-way mapping between a schema version and its parent, a Value.
- **vocabulary:** a vault's named types, operations, runtimes and definitions (Samuel's word; the engine's catalogue).
- **period Doc:** one period of a stream (a chat room's month), linking the period before.

**Words that go:** line (branch), draft (a proposal over an empty main), restore (revert to), lane (vocabulary), kin
(the same type Doc), "view" for an app's schema (the engine keeps view), the `kind` field (a Record's type is its
schema's type), "seal" for closing a segment, "fork" for a split, and "ref" outside the store.

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **Two primitives.** Values and Docs. Everything is a Value except a Doc's head, which the store keeps under the
   Doc's id by compare-and-set and which never leaves its peer.
2. **A Doc is one Loro document per branch.** Its Records sit flat by id in one root map. Each Record is a map
   container holding its fields, each field in the container its schema picks. Order and nesting are fields too: ids
   in a parent's list or tree.
3. **Every Record is under a schema** (Samuel, 30 Oct 2026). There are no schemaless entries, so the engine queries
   Records by type and nothing else.
4. **A type says which of its Records are roots** (Samuel, 30 Oct 2026). A root Record is a Doc of its own: an invoice,
   a page, a chat room, an actor. Any other Record lives inside its Doc and changes atomically with it.
5. **The envelopes are the truth.** Segments, snapshots, checkpoints, heads, state and every analysis are derived from
   them, and rebuilding from the envelopes gives what replaying every envelope gives.
6. **One envelope is one commit:** one device, one Doc, one branch, all or nothing. A commit is built as one diff batch
   and applied by Loro's all-or-nothing `apply_diff`, or is an editor's text edit, which can't fail halfway.
7. **History names its past by hash.** Every envelope names the one before it in its log and the tip envelopes it
   builds on, by hash. Its Loro dependencies must be exactly the op ids of what it names; an envelope whose hashes and
   op ids disagree is refused.
8. **A writer id is worked out, never issued.** `writer(device, doc, branch, generation)`, defined once in Lean. An
   import refuses an envelope holding an op of any writer id but its signer's for that Doc, branch and generation, and
   one whose counters don't continue that writer's log.
9. **No clocks in Loro.** Timestamps are off. When an envelope was written is its writer's signed claim: shown, never
   used for order.
10. **A container made after a Record is born is made mergeable,** so two writers creating it at once share it.
11. **Each writer closes its own segments.** A segment is one log's run in one epoch, sealed and hybrid-signed by its
    writer. Outside it are only the Doc, the epoch and the padded length (caps D13).
12. **Snapshots never travel; checkpoints do.** A checkpoint is signed, names its version and what it covers, and is
    checked in the background. A state taken from it is unchecked until then. Snapshots are always full: history goes
    only by a period Doc's end, never by a shallow snapshot.
13. **An envelope counts only when it is fit, authorized and not a split, and everything it builds on counts.** One
    that doesn't count never enters a branch's live state. A verdict that turns after import (a revocation, a split
    found later) rebuilds that branch's state from the envelopes, and the last state stays on screen meanwhile.
14. **A split is final** (Samuel, 30 Oct 2026). From the split on, neither side counts for any reader, nor anything
    built on either. The writer starts a new generation.
15. **Fit is judged once per envelope, from what it names:** its ops, the schema Values it names by hash and the Doc's
    pins at its own dependencies. Every reader reaches the same verdict, and keeps it forever.
16. **A schema says only what survives a merge.** If each envelope fits, every merge of them fits. Invariants a CRDT
    can't keep belong to the engine.
17. **A Doc pins the schema versions it accepts,** at birth or by its owners' act on main. A version not pinned at an
    envelope's dependencies doesn't fit.
18. **Nothing is migrated.** A Record is read through lenses into the reader's schema version and written back as the
    difference, in the representation the Record already uses. A default is never written, and what an older app
    can't see survives its edits.
19. **Lenses follow the type's tree.** Each version names its parent and the one lens to it, so the path between two
    versions is unique. The laws hold along the path, and a read through lenses commutes with a merge.
20. **A version that drops a field says where its data goes:** a lens into another field or Record, or "kept, unseen".
21. **Versions open on a scratch copy,** never by checking out the live Doc, which would stop it taking imports.
22. **A branch's commits reach another branch only by a merge,** and merges are three-way, place by place. Nothing the
    target changed since the base is lost; everything the other branch changed alone lands; where both changed one
    place differently, the target keeps its own unless the person merging takes the other's.
23. **Catching up never rewrites** (README, rule 6). Moving Records into a newer schema's representation is an act.
24. **Every input has a limit before Loro sees it:** envelope size, ops, Records touched, depth, segment size.
25. **Streams that grow without end are chains of period Docs,** never one Doc forever.
26. **A directory or an index is one sealed search tree** (A26): the same entries make the same Values, whoever builds
    them and in whatever order, and a lookup finds every entry in its range.

## A Doc

### Its genesis and its id

A Doc is born with a **genesis**, a CBOR Value signed by the creating device (shown as JSON):

```json
{ "genesis": 1, "vault": "v:alice…", "type": "d:invoice…",
  "pins": { "d:invoice…": [ "b3:0d78…" ], "d:line…": [ "b3:51aa…" ] },
  "nonce": "b3:<32 random bytes>", "by": "device:…", "sig": "…" }
```

- **Its id is the hash of the genesis,** written `d:<hex>`: the vault and root type are sealed into the Doc's name, and
  nobody can later claim another owner or type without another id (Samuel, 30 Oct 2026).
- **The nonce** makes two Docs born alike different. A vault's singletons (its profile, its vocabulary) are found by
  name in the vault's vocabulary, never by a guessable id; two made offline at once are both kept, and the vocabulary's
  one key picks the one that counts.
- **A Doc never changes type.** Turning an invoice into something else is a fork into a new Doc.
- The genesis is the first thing the Doc's first envelope carries, so the writer id of that envelope can already name
  the Doc.

### Records flat by id

```
root map
 ├─ "d:7Hq…"        the root Record: its type's fields
 ├─ "l1"            a line of the invoice: a map container, its own type
 ├─ "l2"
 └─ …
root Record's field "lines": a movable list of ids  ["l1", "l2"]
```

- Every Record is a map container under the root map, keyed by its id, holding `t` (its type Doc's id, fixed at
  birth) and its fields.
- Where a Record sits (which list, which place in a tree) is a field of its parent: ids in a movable list or a tree.
  Moving a Record never changes its address.
- A change to a container maps straight to the Record it lies in, which gives the engine its change feed and every
  footprint without a path.
- Record ids that two writers may create at once (the ontology's slot ids) meet on one key: the Record's map is made
  with `ensure_mergeable_map`, so they share it.

### What the schema picks

| The schema says | Container | When two writers edit at once |
|---|---|---|
| a string with `"x-loro": "text"` | Text | merges character by character |
| rich text, for the editor | Text with marks | character by character; marks by Loro's rules |
| a list of values | List | both inserts kept |
| a list of Records | MovableList of ids | rows added, moved or edited apart all land |
| an outline or folders | Tree of ids | moves merge; a move that would make a cycle is dropped |
| a counter | Counter | adds sum |
| a map of entries (`additionalProperties`) | Map | one value per key, the later writer's |
| anything else | a value in the Record's map | the later writer's |

The ontology's facts are Records of predicate types, flat by fact id like every Record
([ontology](../ontology/README.md#where-facts-live)).

## Envelopes

### What one holds

Inside the seal, as deterministic CBOR (architecture, rule 1; shown as JSON):

```json
{ "envelope": 1, "doc": "d:7Hq…", "branch": "main", "generation": 0,
  "writer": "9f2c…", "seq": 42, "prev": "b3:11f2…", "deps": [ "b3:a4d7…" ],
  "ops": { "from": 1180, "to": 1193 },
  "records": { "l3": { "version": "d:line…/b3:51aa…" }, "d:7Hq…": { "version": "d:invoice…/b3:0d78…" } },
  "changes": h'<Loro update bytes, a CBOR byte string>',
  "at": "2026-10-30T17:02:11Z",
  "signer": "device:…", "cap": "b3:…", "acks": [ … ], "call": "b3:…", "params": { … },
  "sig": "…" }
```

- **`writer`, `seq`, `prev`:** its place in its log. `seq` counts the writer's envelopes from 1; `prev` is the hash of
  the one before (none for the first).
- **`deps`:** the hashes of the tip envelopes of other logs it builds on (rule 7). The reader checks that the commit's
  Loro dependencies are exactly the op ids those envelopes hold.
- **`ops`:** the commit's counter range for its writer id.
- **`records`:** every Record the commit creates, changes or removes, with the type id of the version it was written
  under. Merges, reverts and back-outs name them too. The reader works out the touched Records from the ops itself
  and refuses an envelope whose list differs. The commit's Loro message is the hash of this map.
- **`at`:** the writer's claimed time (rule 9).
- **`signer`, `cap`, `acks`, `call`, `params`:** the device, the cap it writes under, the revocations it acknowledges,
  the engine's operation and its params ([caps](../../id/caps/README.md#checking)).
- **`sig`:** Ed25519 by the device over exactly the CBOR encoding of the envelope without `sig`, under the label
  `avenDB envelope 1`. The segment that later covers it adds the hybrid signature.
- In CBOR every hash is its 32 bytes and every id its bytes; `b3:<hex>` and `d:<hex>` are only the readable form.

An envelope is named by the hash of its signed bytes. Sealed, it travels live as a **loose envelope** with the
`avenDB envelope 1` subkey on the Doc's gossip topic, and is put in the writer's own store at once: a write is local
first and survives a crash.

### Writer ids

`writer(device, doc, branch, generation)` is the first 64 bits of BLAKE3's key derivation under the label
`avenDB writer 1` over the device's public key, the Doc's id, the branch's id and the generation, skipping the one
value Loro reserves. It is defined once in `Aven.DB`, exported as vectors, and never stored as an identity: the
identity is the avenID device, and blame maps an op straight back to it.

Each part earns its place:
- **the device,** because a vault has many devices editing at once (hominio's bug, and Loro's first warning);
- **the Doc,** so a writer id links writes within one Doc only;
- **the branch,** because a device writes main and a proposal as two states whose ops meet when they merge;
- **the generation,** so a device starts a fresh log after a split or a stuck log without a new key.

### A commit

The committer makes a commit through the app's schema version:
1. It reads the touched Records through lenses (rule 18) and builds the change as one diff batch: values set, Records
   put or removed, list and tree edits. An editor's text edits are applied as typed.
2. It checks fit (rule 15) on the batch. A device never makes an unfit write.
3. It applies the batch with Loro's all-or-nothing `apply_diff`; the pre-commit hook sets the message.
4. It exports the commit's op range, builds the envelope, signs it and puts it in the store.
5. It hands it to sync, and the new version to everything downstream.

A mutation that fails at any step leaves no op behind.

## Logs, segments and the head

### Closing a segment

A writer closes its loose envelopes into a segment, at whichever comes first (the docs thread, 30 Oct 2026, from
Samuel's "do as you believe"):
- 256 envelopes, or 1 MiB;
- the Doc's key epoch rotates (caps: a segment holds one epoch);
- the writer goes quiet on the Doc for a few seconds (5 s to start; the catch-up target tunes it);
- the page hides or closes, best effort.

```json
{ "segment": 1, "doc": "d:7Hq…", "epoch": "b3:…", "branch": "main", "writer": "9f2c…", "generation": 0,
  "from": 41, "to": 297, "prev": "b3:<previous segment>", "envelopes": [ "<bytes>", … ],
  "covers": [ "b3:<loose envelope>", … ], "sig": "<hybrid>" }
```

- Its envelopes are the same signed bytes, so their hashes stay.
- One hybrid signature (Ed25519 and ML-DSA-65) covers the segment, inside the seal, about 3.4 KB per segment: what keeps
  single Ed25519 envelopes safe from a later quantum forgery (agreed with caps).
- It is sealed with the `avenDB segment 1` subkey and padded. Outside are only the Doc, the epoch and the padded
  length.
- `covers` lets a keeper drop the loose envelopes the segment replaces, without reading them.

**Keepers keep loose envelopes** until a segment covers them, so a writer that never comes back leaves nothing
unreachable (architecture, scenario 16).

### The head

A peer's own record of a Doc, a small Value under the ref `doc-<id>`, replaced by compare-and-set:

```json
{ "doc": "d:7Hq…",
  "branches": { "main": { "logs": { "9f2c…": "b3:<newest envelope>", "0c2e…": "b3:…" },
                          "snapshot": "b3:…", "checkpoint": "b3:…" } },
  "keeper": { "after": 1183 } }
```

It lists, per branch, each log's newest envelope, the peer's newest snapshot and the checkpoint it started from, and
how far it has caught up from each keeper. It never travels: what a peer tells others is a version, by hash.

### Catching up

1. **From a keeper,** which knows nothing about writers (caps D13): the device asks "what came after your number n?",
   gets hashes of segments and loose envelopes, and fetches the ones it lacks as one hash sequence.
2. **From other readers,** by version: each says the tip hashes of its logs; the other sends what lies beyond.
3. **A page lands in one write.** A fetched page is stored as one Value (its envelopes and segments, each still checked
   by its own hash) and one ref move, so catching up 500 envelopes costs a few files, not 500.
4. **Imports go in a batch** (Loro's `import_batch`: one diff, one event).
5. **Every page moves a version forward,** or the step stops and raises the stall alarm (README, rule 3).

**The target:** a Peer-Light catches up 500 envelopes of one Doc in under 1 s in every engine, Firefox included,
measured in `up --check` and shown in its report (the architect, for Samuel, 30 Oct 2026). Store pack files stay a
separate step for devices that hold many Docs ([store](../../store/README.md#next-pack-files)).

## Snapshots and checkpoints

- **A snapshot** is a peer's own Loro snapshot export of a branch at a version, sealed for its own store. It is a
  cache (README, rule 5), always full, and never travels (Samuel, 30 Oct 2026).
- **A checkpoint** travels (Samuel, 30 Oct 2026, A5). It is sealed with the `avenDB snapshot 1` subkey and
  hybrid-signed:

  ```json
  { "checkpoint": 1, "doc": "d:7Hq…", "branch": "main",
    "version": [ "b3:<tip envelope>", … ], "covers": [ "b3:<segment>", … ],
    "snapshot": "b3:<sealed Loro snapshot>", "state": "b3:<hash of the Records' CBOR>",
    "runtime": "b3:<the code that made it>", "by": "device:…", "sig": "<hybrid>" }
  ```

- **Who may sign one** a reader trusts: a device of the Doc's vault, or of a vault the Doc's caps grant `keep` with
  checkpoints. A keeper with only a keep cap can't make one: it can't read.
- **A new device** starts from the newest checkpoint and the segments after it, and shows the Doc at once, marked
  **unchecked**.
- **In the background** it fetches what the checkpoint covers, replays it, and compares the state's hash. Then the
  state is checked. A checkpoint that doesn't match is dropped, its signer's device is shown, and the state is rebuilt
  from the envelopes.
- A reader with a `history: from-now` grant can't fetch what came before. Its state stays unchecked, and says so.

## Importing: three verdicts

An imported envelope, in order (caps' [checking](../../id/caps/README.md#checking) runs steps 2, 4 and 7):

1. **Limits** on the sealed bytes, before anything is decoded (rule 24).
2. **Open** it with its epoch's key (caps).
3. **Decode** its CBOR strictly: bytes that don't encode back to themselves are refused. Check the device's signature.
4. **Signer:** the device served the signer's vault in the tree as the reader holds it (caps).
5. **Log:** the writer id is `writer(signer, doc, branch, generation)`; `seq` and `prev` continue its log. A second
   envelope after the same one is a **split**.
6. **Dependencies:** everything `prev` and `deps` name is here, else the envelope waits for it, with whatever builds on
   it, and asks for it. A wait that never ends raises the stall alarm.
7. **Epoch and authority** (caps): the epoch is no older than what it builds on; the cap chain is valid, live and
   covering.
8. **Loro:** the changes decode within limits; every op carries the writer id; its counters continue the writer's;
   its Loro dependencies equal the op ids of what it names by hash.
9. **Fit** per Record (rule 15), and its footprint for the engine.
10. **Counts:** fit, authorized and not a split, and everything it builds on counts. Then the committer imports it into
    its branch's live state.

**Three verdicts,** cached per envelope (README, rules 4 and 5):

| Verdict | Depends on | Can it turn? |
|---|---|---|
| **fit** | the envelope, the Values it names, the pins at its dependencies, the checker's version | never |
| **authorized** | the cap chain and the revocations the reader holds | yes, by a later revocation |
| **not a split** | the envelopes of its log the reader holds | yes, by a second envelope found later |

When a verdict turns after import, the branch's state is rebuilt from the envelopes that still count (Loro can't take
ops back out). Honest edits built on a discounted envelope are shown as not counted, with the reason, and their devices
re-apply them as new commits on top.

**Loro sees only bytes that passed the limits and a member's signature.** Its decoding is fuzzed (`cargo-fuzz`, every
release), and a decoding failure refuses one envelope without touching the live state.

## Splits

A **split** is two different envelopes from one writer after the same one, or with overlapping op ids: a cloned
device, an old backup, a stolen key.

- **Found** by any reader holding both, at step 5 or 8: the two signed envelopes are the proof. Hash dependencies make
  it visible: an envelope naming one side can't be imported by a reader holding the other.
- **Shown to every reader:** the proof travels on the Doc's topic and in catch-up, so readers converge on it.
- **Final** (Samuel, 30 Oct 2026, A4): from the split on, neither side counts, nor anything built on either, for every
  reader. There is no settlement that revives a side, so no edit is counted twice.
- **The device starts its next generation:** a fresh writer id, a fresh log. What was worth keeping from either side is
  re-applied by an act, as new commits.
- **A Doc's owners may declare one,** by a signed `split` Record naming the writer and the envelope it ends after, for a
  device they believe copied.

**A stuck log is the same remedy.** An envelope that doesn't fit counts for no one, and the writer's next envelopes
build on it, so its log is stuck (Samuel, 30 Oct 2026). An honest device never gets there, since it checks before it
commits; a broken or hostile one starts its next generation.

## Branches, merges and forks

### Branches

Branches live inside one Doc: one id, one key, one set of caps (Samuel, 30 Oct 2026).

- **A branch is named by the hash of its start,** a Value `{ doc, name, base: [tip hashes], follows, nonce, by }`.
  Main is `main`, from the genesis. The start is carried by the branch's first envelope.
- **Each branch has its own logs and its own live Loro state.** A proposal's state starts as a fork, in Loro's sense,
  of main at its base, and takes only its own branch's envelopes and the merges into it. Main's state never holds a
  proposal's commits until a merge lands them, so nothing shows on main by being imported.
- **Kinds are one flag:** a proposal is opened to be merged; `follows: "main"` makes it a variant, which takes merges of
  main and keeps its own value wherever both changed one place.
- **Discovered** from the Doc's own envelopes: every branch's start is in its logs, and the head lists the branches a
  peer holds.
- **Named by caps and wants** as `main`, a branch's hash, or `proposals` (every branch but main): caps grant writing to
  main or to proposals only, and an agent proposes while a person merges.
- **Closed** by a `closed` Record on the branch, or by its merge. Its history stays.

### Merging

A merge is an ordinary envelope on the target branch whose `deps` name both branches' tips:
1. **The union:** the target's state imports the other branch's envelopes since the base. Loro's union keeps
   everything, and silently picks one value where both changed a place.
2. **The three-way pass** runs only on the places both branches changed since the base:
   - a value replaced whole, a field;
   - a Record, with all its fields, by id at any depth;
   - the order of a list of Records;
   - text is never a conflict: Loro merges it character by character, and the merge shows where both edited the same
     stretch (the docs thread's choice).

   The target keeps its own unless the person merging takes the other's, place by place.
3. **The fix:** the commit sets every place the pass decided. Where Loro's union already shows the result, nothing is
   written.

A merge counts only when the merger's grant covers the footprint of the **whole merge**: every type and field that
differs between the base and the merged state (agreed with caps). A proposal's envelopes reach main's state only
through such a merge.

An example: Bob, who may propose but not edit, proposes "Order seeds by Friday" on Alice's todo, which says "Order
seeds". Meanwhile Alice ticks it done on main. Her merge lands his title (only he changed it) and keeps her done (only
she changed it): no conflict, nothing lost. Had both changed the title, Alice's would stay unless she took Bob's.

### Revert, back out, fork

- **Revert to a version:** Loro's `revert_to`, all or nothing, as one new commit on the branch. History keeps both.
- **Back out one commit:** a three-way merge whose base is the state after the commit, whose target is now and whose
  other side is the state before it. Only that commit's own changes go, where nothing since touched them; where
  something did, it is a conflict and the present stays. Applied with `apply_diff`, all or nothing.
- **Fork:** a new Doc whose genesis names `forked_from: { doc, version }` and whose first commit puts the origin's
  Records at that version, written by the forker. The fork has new writer ids and its own caps and key; the history
  before the fork stays in the origin, readable by whoever may read the origin. Ids inside are kept, so links within
  the Doc still resolve.
- **Named versions:** a `version` Record `{ name, at: [tip hashes] }` on the branch it names (Samuel, 30 Oct 2026). It
  syncs, has history, and is a person's act.

## History and its analysers

All of these are caches keyed by the Doc, the version and the code version, worked out from the envelopes and Loro's
history. None is stored in the Doc, and none travels.

- **History of a branch:** its envelopes in causal order, ties broken by hash. Each shows its signer's device and
  vault (through avenID), its claimed time, the Records it touched with their schemas, and the engine's operation.
- **By Record:** every envelope that touched a Record, from the Records each envelope names.
- **By field:** each envelope's diff (Loro's `diff` from its dependencies to it), mapped to Records and fields.
- **By character:** Loro's op ids in a text map to writer ids, and each writer id to its device, from the envelopes
  that carried it. No table of writers is kept in the Doc.
- **Diff between two versions:** Loro's `diff`, mapped to Records added, changed and removed, old and new, read through
  the reader's schema version.
- **Who changed what, when:** the claimed times are shown as claims. Nothing is ordered by them.

## Types, schemas and fit

### Types are Docs

A **type** is a Doc whose Records are its versions:

```json
{ "version": "b3:0d78…", "parent": "b3:40de…", "lens": "b3:7a1c…", "title": "Todo, v1" }
```

- A **schema** is a Value: JSON Schema (2020-12), the subset below, with `x-loro` for the container and `x-link` for a
  link.
- Each version names its **parent** and the one **lens** to it, so a type's versions form a tree (Samuel,
  30 Oct 2026). The newest on a line of versions is a leaf.
- A type Doc is written by whoever its caps let publish versions. The ontology's predicates and kinds, actor
  definitions and runtime grammars are types the same way (architecture, K5).
- **A version is named by its type id,** `<type Doc>/<schema hash>`: the version Record's id is its schema's hash
  (Samuel, 30 Oct 2026). It names a version everywhere: a Record's writes in an envelope's `records`, a fact's `p`, an
  actor message's payload. Two type Docs may hold the same schema bytes, and their type ids still differ. Versions a
  lens path joins, in one type Doc, are compatible.
- A Record's type is its `t`, a type Doc's id, so Records carry no `kind` field.
- **Every Record's creator is known:** the device and vault that signed the envelope creating it, read from history
  and never stored as a field anyone could change. Caps' `own` condition reads it.
- **Built-in types** every Doc pins without asking: caps' access map (`cap`, `revoke`, `epoch`), `branch`, `closed`,
  `version` and `split`.

```json
{ "title": "Todo, v1", "type": "object",
  "properties": {
    "title":  { "type": "string", "default": "" },
    "status": { "enum": ["open", "doing", "done"], "default": "open" },
    "notes":  { "type": "string", "x-loro": "text", "default": "" },
    "due":    { "type": "string", "format": "date" } },
  "required": [] }
```

### Pins

A Doc **pins** the versions it accepts, per type, in its genesis and later by its owners' act on main (Samuel,
30 Oct 2026, A7). A pin can be withdrawn: envelopes whose dependencies hold the withdrawal can't write under it, and
earlier ones still count. Fit never reads a type Doc's changing state; it reads only the pinned schema Values, by hash.
A type's writers can publish a version; only a Doc's owners decide whether that Doc takes it.

### What a schema may say

Only what survives a merge (Samuel, 30 Oct 2026). Two envelopes that each fit can't merge into a state that doesn't:

| Allowed | Not allowed |
|---|---|
| a value's type, `enum`, `const`, `pattern`, `format`, `minimum` and `maximum` on a value replaced whole | a container's size: `maxItems`, `minItems`, a text's length, a counter's bounds |
| each element of a list, and each Record of a list of Records, under its schema | `uniqueItems`, and anything counting across Records |
| `required` fields, set when the Record is born; removing one is an unfit write | rules across fields (`if`, `dependentRequired`) |
| typed links: which types a link may point at | |
| `additionalProperties: false` | |

At-most-one comes from ids instead: the ontology's slot ids make two writers write one key. Invariants a merge can't
keep, such as an invoice's total matching its lines, are the engine's: it checks them on operations and shows a broken
one as a conflict to settle.

### Fit

**Fit is judged once per envelope** (Samuel, 30 Oct 2026), from:
- its ops;
- the Records it names and their schemas, by hash;
- each touched Record's type, which never changes (from its birth, in this envelope or before it);
- the Doc's pins at the envelope's own dependencies;
- the checker's version, which is part of the protocol: a change to the rules is a new schema language, named in the
  schema, never a silent code update.

It checks:
1. the Records the ops touch are exactly those the envelope names;
2. every named version is in the Record's type Doc (its `t`) and pinned by the Doc;
3. every value the ops set, and every element they insert, is allowed by its field's schema;
4. a new Record's type is allowed where its parent's schema puts it, and its required fields are set;
5. no op removes a required field;
6. depth at most 256, and the size limits.

Because the schema language allows only what survives a merge, fit needs nothing but the ops and those Values: no
scratch copy, no state beyond the Records' types. Every reader gets the same verdict, keeps it forever, and the state of
any set of fit envelopes fits (Lean: `fit_merge`). The verdict doesn't depend on what the reader's vault knows: that
decides only what the reader can see through lenses (Samuel, 30 Oct 2026).

## Lenses

A lens is a Value of steps between a version and its parent:

```json
{ "lens": "Todo, v0 to v1", "from": "b3:40de…", "to": "b3:0d78…",
  "steps": [ { "convert": { "from": "done", "to": "status",
      "forward":  [ [ true, "done" ], [ false, "open" ] ],
      "backward": [ [ "done", true ], [ "open", false ], [ "doing", false ] ] } } ] }
```

- **Steps:** `add` (a field only the child has), `rename`, `convert` (a table each way, or a pair of named functions
  Lean defines, such as text to money), `in` (steps for each Record of a list), `wrap` and `unwrap` (a field to a
  nested Record and back), `move` (a field to another Record of the same Doc), `container` (a value to a text and back),
  and `drop` (with where its data goes, rule 20).
- **Paths:** a reader at version A reads a Record written at version B along the unique path between them in the
  type's tree, composing each lens forward or backward.
- **Reading:** where the Record holds a field of both versions, the one written later by Loro's order (Lamport, then
  writer id) wins, exactly as if both had written one field. So a read through lenses commutes with a merge: an older
  app's tick is never lost to a newer app's earlier write. What neither stored shows the schema's default, never
  written.
- **Writing:** only the fields whose value changed are written, in the representation the Record already uses: an
  older app writes into the newer fields once any is stored. The envelope names the schema whose fields it writes.
- **Laws** (Lean): GetPut, PutGet, an older version keeps what it can't see, composition keeps all three, a read
  through lenses commutes with a merge, and a lossy step states its loss. In the example, `backward (forward t) = t`
  holds for every v1 todo whose status isn't `doing`.

## Streams: period Docs

A stream is a collection that grows in time order without end: a chat room, an actor's journal, a log of payments.
**It is a chain of period Docs** (Samuel, 30 Oct 2026, A6), never one Doc forever and never trimmed by a shallow
snapshot, which would refuse branches that start before it:

- its type says the period (a month for a chat room);
- each period Doc's genesis links the one before (`before: d:…`), so a want's window maps to whole Docs, and older
  history is a bounded `follow` away;
- a period ends when the next begins; its last checkpoint stays valid forever.

Other collections that grow, such as invoices or pages, are root Records: each is a Doc of its own (rule 4), listed by
a directory Doc.

## Directories and indexes

A type with millions of Records is millions of Docs, of which a device wants a handful. Finding them by value, such as
"invoices from vendor X", without holding the rest, is a **sealed index** (architecture, A26; Samuel, 30 Oct 2026).

**One structure for both.** A **directory** lists a vault's Docs of one root type by Doc id; an **index** lists the
same Docs by a query's fields. Both are a **Prolly tree**: a search tree whose nodes are sealed Values named by hash.
- **Entries:** each a CBOR array, the key first: `[field values…, Doc id]` for an index, `[Doc id]` for a directory.
  Entries sort bytewise by their encodings, so they sort by key, and every entry is distinct.
- **Nodes:** a leaf is a CBOR array of entries; an inner node is an array of `[first entry, last entry, child]` per
  child. A node ends after an entry whose BLAKE3's low 6 bits are zero (about 64 entries a node) or before an entry
  that would take it past 64 KiB, the size limit (architecture, rule 10). The same rule cuts every level.
- **Why a Prolly tree, not a Merkle search tree:** both make the same Values from the same entries, in any order. A
  Prolly tree's nodes are cut by the entries' own hashes and also by size, so every node stays under the limit; a
  Merkle search tree places each key on a level by its hash, and a node's size has no bound. Dolt's Prolly trees show
  the shape at scale.

**Recent entries stay in the directory Doc.** The directory is an ordinary Doc of the vault, read by the directory's
readers. Whoever creates a Doc of the type, or changes a field an index sorts by, adds its entry there in the same
commit, as an `entry` Record; a Doc that leaves (removed, or its field changed) leaves a `gone` Record. Loro merges
writers who write at once.

**A fold** moves them into Values, as an LSM tree compacts. It is a checkpoint (rule 12): the directory's version it
covers, the root it makes, the runtime that made it, hybrid-signed. Any device that holds the Docs an index covers and
may write the directory can fold. A fold takes the entries of the last fold's root, drops the `gone`, adds the new
`entry` Records, and builds the tree. Two folds of one version give one root; folding in steps gives what folding at
once gives. A device that holds the covered Docs rebuilds the root in the background and compares, as it checks any
checkpoint.

**A lookup runs on the device** (architecture, A26 4):
1. it reads the directory Doc: the newest fold's root and the entries not yet folded;
2. it walks down from the root, opening only the nodes whose span, first to last entry, meets the range: three or four
   Values for millions of entries;
3. it wants the Docs the entries name, and the engine runs the query on them;
4. the answer is `complete` when every Doc that could match is held: the hits and the unfolded entries.

A wrong entry costs a fetch, never a wrong row: the query reads the Docs themselves. A missing entry is the only harm,
and only someone who may write the directory can cause it.

**Sealing.** Every node is sealed under the directory's key, and equal Values under one key get equal names, so equal
nodes are stored once; every Value is padded (caps, D18). An index holds fields only from Docs its directory's readers
can read, so a Doc with fewer readers never enters it (caps).

**The engine's side.** The engine derives an index from a query's shape (its filters and its order); equal shapes share
one index, and installing an actor registers the indexes its `loads` need by the vault owners' act (architecture, A26
3). The docs layer gives it four calls: `entry(index, Doc)` for a commit, `fold(directory, version)`, `lookup(index,
range)` with the unfolded entries, and `rebuild(index)` to check a fold. To be agreed with the engine thread.

## The chat moves onto a Doc

Loro segments replace the chat's one-blob-per-line chains (`chat-<device>`); that is the fix the chat waits for, with no
interim one (Samuel, 30 Oct 2026). The city-dome becomes a stream of period Docs, and a chat line becomes a `post`
Record.

**Today's history is read as it is, never rewritten** (Samuel, 30 Oct 2026). Production's Aven Peer keeps each
device's chain of line blobs in S3 (from release #1476 on), each line signed by its device:

- the city-dome's first period Doc's genesis names the frozen chains: `before: { "<device>": "b3:<head line>", … }`;
- readers walk them back and check each line's signature by the frozen format's rules (`Aven.DB.Chains`, frozen as
  `Aven.DB.Before`), and show them read-only before the first post;
- nothing is re-signed, so every old line keeps its own signature, and the store is never wiped
  ([`PRODUCTION.md`](../../PRODUCTION.md#no-wiping-in-production));
- Lean first, and the Rust is tested against a frozen copy of today's format under `db/docs/tests/before/`, the way
  `id/core/tests/before/` keeps avenID's.

## What the engine and actors build on

| The engine needs | Docs gives |
|---|---|
| 1. An immutable read stamped with its version, without waiting on the committer | **A snapshot read** per branch: the Records at a version, published after each import batch. Readers never lock the committer |
| 2. A change feed per new version | **The diff** from the previous version to the new one: Records added, changed and removed, old and new, with their types |
| 3. Commit as one atomic change through the app's schema version, signed and handed to sync | **`commit`** ([a commit](#a-commit)): one diff batch, fit checked, applied all or nothing, signed, stored, handed on |
| 4. Records by type, at the reader's schema version, with the version's hash | **Reads through lenses,** each row carrying the schema version it was read at and the one it was written under |
| 5. The footprint of an envelope's diff | **Per envelope:** each Record touched, its type, the fields changed and whether it was created, changed or removed |
| 6. `head`, `records`, `files` and a window in a long history | `head` is the genesis and the tips; `records` is the newest checkpoint and the segments after it; older history comes by keeper number, and period Docs bound it |
| 7. Type and predicate Docs | **Types are Docs** whose Records are versions; a version's type id is `<type Doc>/<schema hash>`, and a fact's `p` is one |
| 8. Who checks what | **Docs checks every envelope** (signer, writer id, log, dependencies, split, fit, with caps' authority); the engine checks operations and re-lowers a named one |
| 9. The chat's chains replaced by segments of the same shape | **A log per writer,** each envelope naming the one before by hash, closed into segments; old chains read as they are |
| 10. Actor Docs and inbox Docs | **Ordinary Docs.** One writer's commit is one envelope, so "commit, then send" holds: a turn's state and journal entry are one commit, its sends are envelopes on inbox Docs recorded in it, and a resent envelope is dropped by its hash |

The engine's "heads" on answers are versions (architect, 30 Oct 2026).

## Decisions

1. **Value and Doc are the primitives,** and a Record is a map container named by id (Samuel, 30 Oct 2026). Only a
   Doc's head moves, and "ref" stays the store's word.
2. **One envelope is one Loro commit** (Samuel, 30 Oct 2026). One signature, one footprint, one fit verdict.
3. **Each writer closes its own segments** (Samuel, 30 Oct 2026), so segments are the same bytes everywhere and a split
   shows as two runs after one envelope. When they close is the docs thread's (Samuel left it to the thread): count,
   size, epoch, quiet, page, tuned by the catch-up target.
4. **Snapshots stay local; checkpoints travel** (Samuel, 30 Oct 2026, A5). Trusting derived state is a signed,
   checkable statement, never an owner's word.
5. **Records flat by id in one root map** (Samuel, 30 Oct 2026). Addresses never move, and every change maps to a
   Record.
6. **A writer id is worked out from the avenID device** (Samuel, 30 Oct 2026): one identity, one function, one check.
7. **History names its past by hash** (Samuel, 30 Oct 2026, A3). Op ids alone can't show a split.
8. **Splits are final** (Samuel, 30 Oct 2026, A4, replacing a settlement that picked a side). Every reader agrees, and
   no edit counts twice.
9. **Fit depends only on what the envelope names,** and is judged per Record (Samuel, 30 Oct 2026). Every reader
   agrees, so it is computed once.
10. **A schema says only what survives a merge** (Samuel, 30 Oct 2026). Then fit needs only the ops, and every merge of
    fit envelopes fits.
11. **A Doc pins the versions it accepts** (Samuel, 30 Oct 2026, A7, replacing "ever listed by its type"). A type's
    writers can't decide fit for every Doc for good.
12. **An unfit envelope leaves its log stuck,** and the device starts its next generation (Samuel, 30 Oct 2026).
13. **A Doc's id is the hash of its signed genesis, with a nonce** (Samuel, 30 Oct 2026). Owner and type are sealed
    into the name.
14. **Branches inside one Doc; a fork is a new Doc** (Samuel, 30 Oct 2026). A fork carries state and a link to its
    origin, not its history, so its caps and key are its own.
15. **A tree of lenses per type** (Samuel, 30 Oct 2026). Paths are unique, so two paths can't disagree.
16. **Named versions are Records** (Samuel, 30 Oct 2026). A name is a person's act, and syncs.
17. **Revert by Loro's `revert_to`; back out by a three-way merge** (Samuel, 30 Oct 2026). Loro 1.17.1 made both all
    or nothing, so avenDB-old's revert-by-merge goes.
18. **Streams are chains of period Docs** (Samuel, 30 Oct 2026, A6).
19. **Today's chat chains are read as they are** (Samuel, 30 Oct 2026). No re-signing; nothing wiped.
20. **One vocabulary** (Samuel, 30 Oct 2026, items 1 to 13): the terms above, matching the glossary.
21. **Text never conflicts in a merge** (the docs thread). Loro's character merge is what people expect; overlapping
    edits are shown for review.
22. **A crate of its own, `aven-db-docs` in `db/docs`,** a pure core (README, rule 2), with Loro pinned at exactly
    1.17.1, the version its source was checked at (the architect, 30 Oct 2026).
23. **Directories and indexes are Prolly trees of sealed Values** (A26, Samuel, 30 Oct 2026; the Prolly tree is the
    docs thread's choice): the same entries give the same root, every node stays under the size limit, recent entries
    stay in the directory Doc until a fold.

## What Lean proves

`Aven.DB.Docs` grows a model, with vectors and traces every implementation loads (README, rule 10). Loro is modelled by
its laws (the same ops in any order give the same state and the same bytes) and by the container semantics fit and
lenses rely on: a map's later writer by (Lamport, writer id), lists, movable lists, text and counters. The model runs
against the Rust's Loro on random ops, so it can never be simpler than the code.

- **Writer ids:** distinct (device, Doc, branch, generation) give distinct writer ids under the hash assumption; an
  envelope holding another writer id's op is refused. Vectors `writers.json`.
- **Envelopes:** decoding and encoding are inverse on everything accepted; hashes and op ids agree or the envelope is
  refused. Vectors `envelopes.json`.
- **Logs and splits:** a split is found by any reader holding both sides; once found, neither side counts for any
  reader; a stuck log's next envelopes never count. Traces `logs.json`.
- **Counts:** an envelope counts only if all three verdicts hold and its past counts; rebuilding from the envelopes
  that count equals the live state. Traces `counts.json`.
- **Convergence:** the same counted envelopes in any order give the same Records and export the same bytes.
- **Checkpoints:** a checkpoint whose covered segments replay to its state hash is accepted; any other is refused.
  Vectors `checkpoints.json`.
- **Fit:** the verdict depends only on the envelope and the Values it names; fit judged on the ops equals fit judged on
  the state; any merge of fit envelopes fits (`fit_merge`). Vectors `fit.json`.
- **Lenses:** GetPut, PutGet, an older version keeps what it can't see, composition along the tree keeps all three, a
  read through lenses commutes with a merge, a lossy step states its loss. Vectors `lenses.json`.
- **Merges:** nothing the target changed is lost, everything the other branch changed alone lands, a conflict changes
  only by the merger's choice, the merged history is the union; revert to equals the version's Records; backing out a
  commit removes exactly its changes where nothing since touched them. Vectors `merges.json`.
- **Before:** reading today's frozen chains gives every line both peers can see, in order, each checked. Vectors
  `before.json`.
- **Indexes** (`Aven.DB.Docs.Index`): a fold's entries are the set of what went in, sorted, and nothing else could be;
  its nodes hold exactly those entries, each node within the size limit, and depend only on the set; folding in steps,
  removals included, gives what folding at once gives; a lookup finds every entry in its range, and only those.
  Vectors `indexes.json`.

## Order of work

Each step starts with its Lean, then Rust tests against the vectors, then the code, and its plan names what is built.

1. **Loro docs:** writer ids, envelopes, logs, segments, the head, catch-up, checkpoints, splits, the three verdicts
   (authorized from caps' step), fit for built-in types, `commit`, snapshot reads and the change feed; the city-dome on
   period Docs with its old chains read as they are; the catch-up target in `up --check`.
2. **Version control:** branches, merges, revert to, back out, named versions, forks, the history analysers.
3. **Schemas and lenses:** type Docs, pins by owners' acts, lens steps and their laws, reading at any version.

## Open questions

1. **The snapshot read** (engine need 1): a Loro fork per published version, or a persistent copy of the Records the
   committer keeps beside Loro? Measured on the chat and a 10,000-Record Doc.
2. **The quiet time** that closes a segment, tuned by the catch-up target and the cost of 3.4 KB per segment.
3. **Which named conversions** the first lens catalogue needs: text to money, text to date, text to number.
4. **Overlapping text edits** in a merge: shown only, or offered as a choice?
5. **The vocabulary as one Doc per vault** for types and operations (the glossary's "catalogue = vocabulary"), to
   settle with the engine.
6. **Checkpointers:** is "a device of the Doc's vault, or a vault granted `keep` with checkpoints" enough, or does a
   checkpoint need k of n for Docs with many readers?
7. **The index interface** with the engine: the four calls above, and how a query's shape names its index.

## Not in this spec

The engine's operations, wants and views ([engine](../engine/README.md)); what Records mean
([ontology](../ontology/README.md)); keys, seals, caps and revocation ([caps](../../id/caps/README.md)); Values and
refs, and how bytes move ([store](../../store/README.md)); actors' kernel and turns
(`aven/actor/ARCHITECTURE.md`, #1488); the editor's UI; presence.
