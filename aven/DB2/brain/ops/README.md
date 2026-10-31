# avenOPS

avenOPS is avenDB's ops engine: it lowers every write to steps that every reader can check, runs queries over Records,
and decides the order in which a device fetches and opens its Docs.

## Owns

- [The update grammar](#the-update-grammar): `core/1`'s four writes, one commit per Doc, ids made, never drawn.
- [Lowering a call to steps](#lowering-a-call-to-steps): `put` to `put-new` only, write params exactly `{type, fields}`.
- [Plugins are runtimes](#plugins-are-runtimes): a grammar on top of `core/1`, lowered by a runtime pinned by hash.
- [Footprints and the merge check](#footprints-and-the-merge-check): the change view, `typesKept`, one `Fresh`, a
  merge judged whole.
- [A Record id as a key](#a-record-id-as-a-key): the lowercase hex of its bytes.
- [Facts and Records](#facts-and-records): facts for relations, Records with fields for documents.
- [Queries](#queries): tables by type, a target, a bound before anything runs.
- [Answers](#answers): rows, the versions they come from, how complete they are, and live deltas.
- [The want queue](#the-want-queue): one demand signal for what is fetched and what is opened.
- [Search, local first](#search-local-first): a device searches what it holds, and wants what it wants to search.
- [Sealed indexes: the query side](#sealed-indexes-the-query-side): an index from a query's shape, and the lookup.

## Uses

- [avenCORE](../core/README.md#ops-and-calls): ops named by hash, calls `{op, params}`, `core/1`'s eight ops and their
  fixed ids.
- [avenCORE](../core/README.md#targets-and-steps): the one target grammar, and steps `{type, verb, fields}` with their
  verbs.
- [avenCORE](../core/README.md#values): Values, their equality and the codec.
- [avenCORE](../core/README.md#the-past): versions, a Doc's envelopes named by their tips, which every answer, want and
  index is read at.
- [avenDOCS](../docs/README.md#records): Records flat by id in a Doc, a Doc's root Record, links as addresses
  `<doc>/<id>`, and [the vocabulary](../docs/README.md#types-are-docs) that names ops for people.
- [avenDOCS](../docs/README.md#types-schemas-and-fit): types and their versions (`Docs.Version`), and fit, which reads
  the same change view as the footprint.
- [avenDOCS](../docs/README.md#lenses): lenses, so a column is always read at the reader's version.
- [avenDOCS](../docs/README.md#a-commit): the commit, and [the live state](../docs/README.md#the-live-state): snapshot
  reads stamped with a version, and the diff per version.
- [avenDOCS](../docs/README.md#directories-and-indexes): directories and the index tree: entries, keys, nodes, folds and
  their sealing.
- [avenCAPS](../caps/README.md#the-readers-verdict): whether a caller may call an op, constraints on field values,
  collections, keep caps.
- [avenID](../id/README.md): the keyring and the epoch keys a want waits on.
- [avenRUNTIME](../runtime/README.md#pins): runtimes, frozen, pinned and run by hash.
- [avenACTORS](../actors/README.md#loads): an actor's `loads`, its turns and their `given`.
- [avenPEERS](../peers/README.md#catch-up): everything that moves bytes: gossip, catch-up, the fetch gate, frames and
  keepers.

## The update grammar

Data changes in one way. Every write, from a page, an actor or a plugin, becomes `core/1`'s four writes, each with a
verb and a footprint. A mutation is a list of them applied to one Doc as one commit: all of them, or none.

| Write | What it does | Its footprint step |
|---|---|---|
| `put` | a new Record of a type, with its fields | `put-new` of the type, the fields it carries |
| `patch` | fields of the Records of a type that a `where` finds | `patch` of the type, the fields it sets |
| `remove` | the Records of a type that a `where` finds | `remove` of the type, no field |
| `edit` | one field of one Record: a text, list or tree edit | `edit` of the type, that field |

- **One commit, one Doc.** A step that fails undoes every step before it. Work across Docs is several mutations.
- **Ids are made, never drawn.** A `put` names its Record from the writer id, the writer's counter for this commit and
  the op's place in it, so every reader that re-runs the commit names it alike, and no two commits' Records share an
  id. The writer id is the envelope's ([avenDOCS](../docs/README.md#writer-ids)).
- **References point back.** A `{ "ref": n }` cell names the Record that op `n` put; `n` is an earlier op, and a `put`.
- **Removing is a person's act.** An agent's mutation that removes data is a proposal; a person confirms it.
- **Every grammar above it lowers to these:** the ontology's `assert`, `set` and `retract`, and state-runtime's steps
  ([avenRUNTIME](../runtime/README.md#state-runtime)).

**Decided:** A19, K8, A37, engine 11, engine rule 12 · **Lean:** `Aven.DB.Engine.Mutate` —
`refused_changes_nothing`, `refs_point_backward`, `created_distinct`, `ids_differ_across`

## Lowering a call to steps

An envelope names the calls it ran, each an op by its hash and its params. Every reader works out the same steps from
each call itself, its **lowering**, and judges the envelope's changes against them. Nobody takes another peer's
lowering on trust. This is `core/1`'s lowering, `lowerCore : Call → Option (List Step)`; a plugin's ops lower to
`core/1`'s calls first ([below](#plugins-are-runtimes)).

- **Only `core/1`'s ops.** A call whose op is not one of `core/1`'s eight fixed ids is refused (`none`).
- **Read, tell, keep and share lower to no step,** whatever their params. What an owner approves as reading never
  writes.
- **A write's params are exactly two keys,** in the codec's order: `type`, the type Doc's hash as 32 bytes, then
  `fields`, an array of text. No other key and no default; a call with anything else is refused.
- **A call's values are not params.** They are in the envelope's changes, which must fit the steps.
- **A remove names no field.** A remove whose `fields` is not empty is refused, so a remove step never lets a change
  write a field.
- **`put` lowers to `put-new`, never `put-replace`.** The engine's `put` always mints a new id, so it never meets a
  Record that was there. Changing a Record that exists is a `patch` or an `edit`. No `core/1` call lowers to
  `put-replace`.
- **A committer's op names its call.** A typed op with its values names the call `{op: its core op's id, params:
  {type, fields}}`, and that call lowers to exactly the op's own footprint step. So what the committer ran, what the
  envelope names and what every reader lowers it to agree.
- **avenCAPS takes the lowering as a parameter,** so caps never depends on the engine's internals.

**Decided:** A32, A19, A90, A101 · **Lean:** `Aven.DB.Engine.Lower` —
`lowerCore_no_replace`, `lower_call`, `lower_calls` (#1697)

## Plugins are runtimes

A plugin adds a grammar on top of `core/1`. Its ops are data in that grammar, which people and agents write and read.
Its **lowering** is a pure function from one of its ops to `core/1` calls, and what a plugin op means is exactly what
its lowering does. A model writes ops, never code, and no op can make the engine run anything but its own steps.

- **A plugin is a runtime.** Its lowering is named and pinned by the runtime's hash. Two readers that agree on what one
  hash names lower every call alike and make the same commit, ids included, whatever other runtimes they hold. Which
  runtime hashes a Doc accepts, and where a runtime runs, are [avenRUNTIME](../runtime/README.md#pins)'s.
- **Checked twice.** A plugin op is checked against its grammar before it is stored and before it runs. Its bound and
  footprint are worked out on the `core/1` steps it lowers to, so a plugin can't get a bound, a footprint, a cap or a
  delta wrong, and it decides nothing about what moves or how answers flow.
- **Proven with its model.** Each plugin ships with its Lean model and the theorem that its lowering means what the
  model says, with vectors.
- **`core/1` is built in.** Plugins' op ids are named as `core/1`'s are, `{op, plugin}`
  ([avenCORE](../core/README.md#ops-and-calls)).

**The ontology** is the first plugin ([its grammar](../../db/ontology/README.md)). Its `assert`, `set` and `retract`
lower to `put`, `patch` and `remove` of fact Records. Its own checks are its grammar's: predicates, typed places and
slot ids. A `walk` over a category tree lowers to the core's bounded walk. A type it composes from traits compiles,
once, when it is saved, into stored ops: `<type>.list` (a query over the type joined to each trait), `<type>.create`,
`<type>.update` and `<type>.delete`. A composed type stays inside one plugin.

**Decided:** A18, K7, engine 6, engine 8 · **Lean:** `Aven.DB.Engine.Mutate` — `readers_agree`; the ontology's
lowering and its compiled types: not in Lean yet

## Footprints and the merge check

Every reader checks every envelope itself (rule 4): its signature, its chain of caps, its fit and its **footprint**.
The footprint is the list of steps the envelope's calls lower to, known before anything runs and never written in a cap.
The reader computes what the envelope changed, then checks that every change is one those steps make.

**The change view.** One `RecordChange` per Record the envelope touches, which the footprint check and
[fit](../docs/README.md#types-schemas-and-fit) both read:

| Key | What |
|---|---|
| `id` | the Record's id, as bytes |
| `type` | `Docs.Version`: the Record's type Doc, and its schema's hash unless the type is built in |
| `kind` | `new`, `edited` or `gone` |
| `fields` | the fields it writes, each `(name, value)`; a field it removes is `(name, none)` |

- A Record is **new** when no Record before had its id; its fields are all it carries.
- A Record is **edited** when a field's value differs or a field is gone; it names at least one field, and a Record
  none of whose fields changed has no change.
- A Record is **gone** when it was there before and isn't after; it names no field.
- **A removed field counts as written.** It is a real change (a Loro map delete), so the footprint must cover it like
  any other write.

**The verdict's footprint part** for a commit from Records `s` to `s'` is two checks:
1. **`typesKept`:** every Record after with an id from before has the type it had. A Record's type is fixed at birth,
   so a retype is refused under any footprint.
2. **`footprintOk`:** a new Record's type has a `put-new` step and every field it carries is written by a step of its
   type; an edited Record's every named field is written by a step of its type; a gone Record's type has a `remove`
   step.

**An honest writer always passes.** A commit that ran as its ops say, on a Doc whose Records have distinct ids, under a
**fresh** counter, keeps every type and passes. `Fresh w c s` means no Record of the Doc was made under writer `w`'s
counter `c`, and it is the one statement of freshness. It holds because a writer's counter only grows: a commit that
reused one would make an id a Record already has, which is a split of the writer's log, so it fails the check.

**A merge into main is judged whole.** The reader compares main's Records before the merge with the merged Records, not
the commit that settles conflicts. Every Record the merge changes, brings or removes on main, field by field, removed
fields included, must be made by the steps the whole merge's calls lower to. Whether the merger may call them is
[avenCAPS](../caps/README.md#the-readers-verdict)'s.

**Who checks what.** Loro checks nothing about authority. [avenDOCS](../docs/README.md#importing-three-verdicts)
checks every envelope: its signer, writer id, log, split and fit, with caps' authority. What counts is
[avenCORE's](../core/README.md#counting) one rule, where a split or a revocation learned later discounts. avenOPS
checks every op:

| Check | When |
|---|---|
| Its grammar, and its plugin's own checks | Before it is stored, and before it runs |
| Its bound, on the lowered steps | Before it runs |
| Its changes against its footprint | Every envelope, local or imported |
| What a device is served: its wants ∩ its caps | Every request |
| What an actor is handed: its loads ∩ its run's caps | Every turn |

Whether the signer's caps allow each call is [avenCAPS](../caps/README.md#the-readers-verdict)' part of the same
verdict.

**Decided:** rule 4, A32, A45, engine 9, A83, A90, A96, A101, A182 · **Lean:** `Aven.DB.Engine.Footprint` —
`commit_within`, `honest_passes`; `Aven.DB.Engine.Changes` — `changesFrom_edited_names`, `typesKept` (#1712),
`diff_footprint`, `commit_types_kept`, `honest_footprint`, `footprint_steps`, `merge_steps`; `Fresh`, removed fields
and `RecordChange.type : Docs.Version` #1697; `Aven.Architecture` composes the merge
(`rule4_merge_whole`, #1608)

## A Record id as a key

A Record's id is bytes. The docs layer stores a Doc's Records in a map whose keys are text, so each id needs one text
form.

- **The key is the lowercase hex of the id's bytes,** two digits per byte, `0`–`9` and `a`–`f`: the bytes
  `00 0f a5 ff` are the key `000fa5ff`.
- **One encoding.** A key reads back to its id, so two ids have two keys. A reader refuses a key with an upper-case
  digit or half a byte.
- **The ids the engine mints** are the codec's encoding of `[writer, counter, index]`. Ids two writers may create at
  once, such as a slot id, meet on one key, so not every id is a minted one.

**Decided:** A96 · **Lean:** `Aven.DB.Engine.Changes` — `idOfKey_idKey`, `idKey_inj` (#1697)

## Facts and Records

Some data is a relation between things: a task is due on a date, a page is tagged `garden`, a person is a member of a
project. Some data is a document, read and changed together: an invoice and its lines, a page, a chat post. Relations
are **facts**; documents are **Records with fields**. Both are Records, so one engine queries and changes both.

| What | Its type | Example |
|---|---|---|
| A fact | its predicate | `due(x1 = 2026-11-02, x2 = t1)` |
| A chat post | the chat's post | `{ by, at, text }` |
| A page | the editor's page | `{ title, body }`, the body rich text |
| A file's entry | `file` | its chunk list's hash, size, name and media type |
| A setting | the app's settings | `{ theme: "dark" }` |

- **A fact is a Record whose type is a predicate,** `predicate(x1…x5)`, flat by its id like every Record. Its places
  are its columns `x1` to `x5`.
- **Every link is an address,** `<doc>/<id>`. A fact joins a page the way a page joins its files.
- **A trait with at most one fact per entity** writes it under a slot id, so two devices setting it at once write one
  key ([ontology](../../db/ontology/README.md#the-rules), rule 9).

**Decided:** A20, A17, engine 2 · **Lean:** not in Lean yet

## Queries

A query reads **tables**: a table is a type, and its rows are that type's Records, with the columns `id` (the Record's
address), `doc` and the type's fields. A Record written under an older version of its type is read through
[lenses](../docs/README.md#lenses), so the columns are always the reader's version. A query is an op: stored by its
hash, named for people in the vault's vocabulary.

**The grammar:**

| Operator | What |
|---|---|
| target | which Docs it ranges over, in avenCORE's target grammar; a query without one is refused before anything runs |
| `from` | the base table |
| `where` | `eq neq gt gte lt lte in` against a value or a param; `isnull notnull`. A comparison follows the column's type: money by amount within one currency, dates as dates, never strings |
| `join` | inner or left, on a column of the base or an earlier join; a reference forward or to itself is refused before anything runs. An anti join keeps the rows with no match: open tasks are tasks with no `done` |
| `walk` | a bounded step over a link column, such as up a category tree, at most N hops |
| `group` | `count`, `sum`, `min`, `max` over typed columns, and `having` |
| `order`, `limit`, `project` | sorted, at most n rows, columns kept and renamed, or `exists` as a boolean |

- **Scope.** Rows come only from Records of Docs the target covers that the device holds and the run's caps let it
  open. The target is resolved over a directory: what each listed Doc's genesis fixes. A query's target is also an
  implicit want, at the query's tier, for as long as the query is live ([below](#the-want-queue)).
- **The bound.** Every operator has a bound on the rows it can yield and a cost on the work it can do, computed before
  it runs from counts the device knows, such as a directory's. A query whose bound is over the device's limit is
  refused, with the bound in the answer. Without an index, each step scans its table in the Docs it ranges over, and
  the bound keeps that honest.
- **Order of values.** Values compare by avenCORE's equality. Keyable Values (bytes, text, integers) order as index keys
  do: by kind, integers by sign and magnitude, text and bytes bytewise, which for UTF-8 is code-point order.

**Decided:** A8, A32, A66, engine 6, engine 7 · **Lean:** `Aven.DB.Engine.Query` —
`run_refused_without_target`, `complete_iff`, `scoped_only`, `length_le_bound`, `work_le_cost`; `Aven.Core` —
`Target.coversB_iff`; `Aven.DB.Engine.Index` — `vals_lt_key`

## Answers

Every answer, to a query, a want or an actor's loads, carries:

- **its rows,** keyed by their row id;
- **the version** each Doc was read at ([avenCORE's](../core/README.md#the-past) version, named by its tips);
- **its status:** `complete`, `partial` (with what is held, what is known and what is waited for) or `denied`, and the
  phase (connecting, catching up with what is left, live, offline, stalled), all from one status snapshot and one
  clock. `complete` means every Doc the target covers is held, checked against its directory.

**Live answers are pushed deltas.** When a Doc's version moves, the engine takes the docs layer's diff (which Records
changed), recomputes the rows those Records can touch, and pushes the difference: rows added, changed and removed. A
page or an actor holds the rows it was given and applies each delta. Nothing re-queries. For an actor, its `loads` are
its standing reads, and the engine tells it `changed` for every loaded Doc whose version the want queue moves.

**Writes go first.** A mutation from a page shows at once: its rows lie over the answers it touches until the committer
commits it (the overlay drops, the delta arrives) or refuses it (the overlay drops, nothing else changes).

**Views are caches.** A view is a query's rows, keyed by the versions it was built from and the code's version. Views
never sync, and a rebuild never blanks a screen.

**Decided:** A8, A175, rule 8, engine rules 17–20, the `changed` tell (#1504) · **Lean:** `Aven.DB.Engine.Query` —
`complete_iff`; live deltas: not in Lean yet

## The want queue

A device never holds everything. **Wants** say what it should hold and open, and how urgently. They are the one demand
signal: one queue orders both fetching a Doc a device doesn't hold and opening one it holds. A want orders and never
grants (rule 6).

**A want:**

| Field | What |
|---|---|
| target | in avenCORE's target grammar: a Doc (alone, with what it spawned, or with what it lists, a collection), a vault's Docs, or a vault's Docs of one type. Only the target is shared with caps |
| `level` | `head` (that it exists, and its version), `records` (what it holds) or `files` (the bytes of its file Records), each including the one before |
| `window` | the newest n Records, everything since a version, everything, or a byte range of a file (the playhead) |
| `follow` | how many hops of links to bring with it: at most three, with a fan-out limit per hop |
| `tier` | `now` (on screen, or needed for a turn; the screen's before a background turn's), `next` (one click away), `later` (the rest of the screen's data), `idle` (kept offline) |
| `by` | the signal that orders inside a tier: viewport position, distance to the playhead, place in a list |
| `lifetime` | `mounted` (while a page shows it or a turn runs) or `durable` (until withdrawn). A durable want is a **keep** |

**Where wants come from.** The device's wants are the union of these, and nothing outside the device sees them:
- **installed actors' `loads`,** durable: what an app needs to work offline. An actor says what it needs and how
  urgently, never which device it runs on, so its definition has one hash everywhere;
- **the device profile,** a Doc of the device's vault, `{ keep: { tiers, bytes, files }, also }`: which tiers of the
  loads this device keeps, how many bytes, and wants of its own. A Mac keeps `idle` and a phone doesn't, with one actor.
  The `now` tier is never a device's choice;
- **what is on screen and what a turn needs now,** mounted;
- **queries:** a query's target is an implicit want for its sources;
- **follows:** links from fetched Records.

Wants are computed from definitions and bound slots, never by reading data first, and a slot nobody bound wants nothing.

**The queue:**
1. **The unit is a key:** (Doc, branch, level, window). Each key is queued once, at its highest tier, and what is served
   is exactly the wants allowed by the device's caps (wants ∩ caps).
2. **Priority** is the tier first, then the signal. Tiers only order: changing one never adds or withholds a key.
3. **Resolving targets.** A Doc target is direct. A vault or type target resolves through its vault's directory for
   that root type; a collection through what it lists.
4. **Prerequisites inherit priority.** A key needs, in order: its Doc id resolved; the key blob and the epoch key,
   through the keyring and its groups; the fetch key; the newest checkpoint, once there are checkpoints (A150); the
   segments after it; then follows and files. Each runs at the highest priority of anything waiting on it, so a `now`
   want never waits behind an `idle` key fetch.
5. **Uploads first.** A device's own unsent envelopes and segments go out before any pull.
6. **Fair and preemptive.** Work goes a page or a chunk at a time, and the queue picks again between pages. Within a
   tier, Docs take turns. Durable tiers keep a fixed share, so they never starve.
7. **Sources.** Own devices first, then other readers of the Doc, then keepers. How a source is asked is
   [avenPEERS](../peers/README.md#catch-up)'.
8. **Every round moves.** A round satisfies keys or moves versions; one that moves nothing raises the stall alarm and
   says why. A key waiting on a dependency, a cap, a revocation or a key never stops another (rule 11). Signals such as
   the camera and the playhead are coalesced to a few updates a second.
9. **Budgets and eviction.** The profile gives bytes per tier. Over budget, the lowest tier goes first, then the least
   recently used: their refs are dropped, and cleanup by reachability frees the blobs. `now` is never evicted.
10. **Older periods** of a Doc that grows without end are reached by a bounded `follow` of the link to the period
    before ([avenDOCS](../docs/README.md#period-docs)).
11. **Privacy.** Wants stay on the device. A keeper learns which Docs a device fetches, in what order and when, and
    nothing else.

**Decided:** A9, K4, A8, A1, rule 6, rule 11, engine 3, engine 4, engine 5, A150 · **Lean:**
`Aven.DB.Engine.Wants` — `served_eq_wants_caps`, `keys_once`, `queued_highest`, `tiers_only_order`,
`prerequisites_inherit`, `uploads_first`, `page_bounded`, `round_moves`, `roundP_moves`, `waits_isolated`,
`stall_raised`, `now_never_evicted`, `evict_fits`

## Search, local first

A device searches only the data it holds. To search more, it wants more: an actor's `loads`, or the search's own
target, makes the want queue sync those Docs first, the urgent ones first, and then the device searches them itself.
To find a handful among millions of Docs it doesn't hold, it first fetches a few Values of its fellow readers'
[sealed index](#sealed-indexes-the-query-side), then only the Docs they point to.

No peer without the key indexes, matches or searches anyone's data. There is no **blind index** (tokens another peer
could match) and no `match` verb: a blind index always leaks which entries share a value, how often each value occurs,
what occurs together, result sizes and what is fetched after a match.

**Decided:** A21 · **Lean:** holds by `scoped_only` and `served_eq_wants_caps`; no theorem of its own

## Sealed indexes: the query side

A type with millions of Records is millions of Docs, of which a device wants a handful. A **sealed index** lets it find
them by value, such as "invoices from vendor X", without holding the rest, and no one without the directory's key can
read it. The tree, its keys, its folds and its sealing are [avenDOCS](../docs/README.md#directories-and-indexes)'; this
is how the engine derives an index and looks a query up in it.

- **An index comes from a query's shape:** its vault, its type, its equality fields, its range field and its order.
  As a Value, `[vault, type, [equality fields], range field or null, order field or null]`. Equal shapes share one
  index, named by the shape's hash.
- **Registering.** Installing an actor registers in that vault the indexes its `loads` need, by the vault owners' act,
  up to a limit per directory. A shape registered twice is kept once.
- **Its entries.** For every Record of the type in a Doc the directory lists at version V: the values of the shape's
  fields, then the Doc. Each entry's key is in the docs layer's order-preserving encoding, so the engine's value order
  is the keys' order.
- **A probe** has a keyable value (bytes, text, or an integer of 64 bits) for every equality field, and a range exactly
  when the shape has a range field; an open-ended range is the full one. It becomes one byte range over the keys, whose
  bounds are keys themselves: from the probe's equality values and lower range value, to its equality values, upper
  range value and the integer `0`, which sorts after every Doc id. That range holds exactly the entries the probe
  matches.
- **The lookup runs on the device:** walk the index's Values to the entries in range, add the Docs of the directory's
  entries not yet folded in, want the Docs found, and run the query on them. A hit is only a hint: the query re-checks
  every Doc, so a wrong entry costs a fetch, never a wrong row.
- **`complete` with an index** means every Doc that could match is held: the hits and the unfolded Docs. Without an
  index, it is every Doc of the target.
- **Built from its entries alone.** Two readers who build from the same version get the same root, whatever order they
  read the Docs in, and folding entries in, in any number of steps, equals building at once.

**Decided:** A26, K13, A42 · **Lean:** `Aven.DB.Engine.Index` — `register_once`, `register_limit`,
`lookup_exact`, `complete_with_index`, `same_root`, `fold_eq_build`, `fold_root`, `fold_steps`, `directory_facts`,
`lookup_exact_dir`, `fold_eq_build_dir`, `same_root_docs`, `fold_steps_docs`; `Aven.DB.Engine.Probe` — `bounds`,
`inRange_iff_keyMatch`, `treeHits_eq_hits`, `lookup_exact_tree`

## Status

| Concept | Lean | Rust (`aven-db-engine`) | TS |
|---|---|---|---|
| The update grammar | `Engine.Mutate`, `mutations.json` (#1530) | `mutate` (#1697) | — |
| Lowering a call to steps | `Engine.Lower`, `lower.json` (#1697) | `lower` (#1697) | — |
| Plugins are runtimes | `readers_agree` (#1530); the ontology's lowering not yet | `core/1` only (#1697); the ontology not started | — |
| Footprints and the merge check | `Engine.Footprint`, `Engine.Changes` (`typesKept` in #1712); `Fresh`, removed fields, `Docs.Version`, `changes.json` and `merge-check.json` (#1697) | `footprint`, `changes` (#1697) | — |
| A Record id as a key | `idKey` (#1697) | `id_key`, `id_of_key` (#1697) | — |
| Facts and Records | not yet | not started | — |
| Queries | `Engine.Query`, `queries.json` (#1530) | `query`, `value` (#1697) | — |
| Answers | `complete_iff`; live deltas not yet | not started | — |
| The want queue | `Engine.Wants`, `wants.json` (#1530) | not started | — |
| Sealed indexes, the query side | `Engine.Index`, `Engine.Probe`, `lookups.json` | not started | — |

The Rust crate is pure (`no_std`, no `unsafe`, builds for wasm32) and replays every vector (#1697).

**Known gaps** (Lean and code work):
- `Engine.Wants`' `Depth` becomes `Level` (A1).
- The engine's `Writes` (`Engine.Footprint`) shares a name with avenCORE's `Writes`; the engine's becomes
  `WritesField` (A45).
- A directory entry is its own envelope in the directory's Doc (A42), so it can lag its Doc. avenDOCS' `listed_now`
  and `same_entries` assume one commit, and `lookup_exact` and `directory_facts` rest on them: avenDOCS and avenOPS
  restate them for an entry that lags, the Doc counting as unfolded until its entry counts.
- `aven-db-docs` takes `RecordChange` from `aven-db-engine` once #1697 lands; `aven-db-docs` depends on
  `aven-db-engine`, never the other way.
- Docs' `Version` (a type's version) and avenCORE's `Version` (a Doc's version, A175) share a name; avenDOCS renames
  its own.
- The grammar check (an op its grammar refuses is never stored or run) has no Lean and no vectors.
- Not in Lean yet: live deltas equal a fresh run; `walk`, `sum`, `min`, `max`, `having`, `in` and `exists`; the
  ontology's lowering and its compiled types.

## Open questions

1. **A slot-id put.** The ontology writes an at-most-one trait under a slot id, an upsert that may meet a Record that
   is there; avenCAPS' footprints call it `put-replace`, but no `core/1` call lowers to `put-replace`. How does it
   lower: a `put` when the Record is absent and a `patch` when present, or a write of its own? *avenMAIA, with
   avenOPS and avenCAPS.*
2. **A device's default query bound.** *avenMAIA, on avenOPS' proposal.*
3. **Delta granularity:** rows, fields or Loro updates. Rows are proposed. *avenMAIA, on avenOPS' proposal.*
