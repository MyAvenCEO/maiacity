# Ops: one JSON language to read and change any data, and caps that name it

Samuel's ask (2026-10-10, 06:49 to 06:52), two tasks in this order: first one universal query and mutation engine,
in which every read and every change of avenDB is a declarative JSON op, the same for any schema and its values; then
caps that name those ops, still decentralized and Biscuit-like, fitting the local-first Loro and iroh design and the
frontier sync, built from first principles, DRY, end to end. This file is the design. It builds on flat vaults
(`FLAT-VAULTS.md`) and on the research behind them (`/mnt/project-files/sync-research/reports/E2E database dynamic
caps and keys.md`), and changes none of their theorems. The first task is built (O1 to O3, below); the second is
the design still to build (C1 to C3).

## First principles

1. **What a key protects is the unit of reading.** Every entry is sealed under its own key and whoever opens it reads
   all of it. So a read cap can only ever pick whole entries, by what is known of them before opening them: their
   labels (type, author, id, created, tags). A cap that "reads only the title" would be decoration. Fields that must
   be read apart belong in an entry of their own, linked by id.
2. **What every reader can check is the unit of writing.** Every reader of an entry opens every write to it, so every
   reader can tell exactly what a write changed. A write cap can therefore be as fine as a single field, a list or a
   value, and every reader enforces it the same way, offline, with nothing to trust but the vault's log.
3. **Relays see neither.** Peers that only relay check what they can see in the clear: who acts, for which vault,
   with which role on which cell (T25). Everything an op says travels sealed. A finer rule changes what readers accept,
   never what relays carry.
4. **One evaluator.** The selector that decides which cells a cap reaches, and so what a device syncs, is the label
   half of every query. The function that turns a write into the changes it made is the one that shows a history, the
   one that will check a write against a cap, and the one the page will ask before it offers a button. Nothing is
   written twice, in Rust and again in JavaScript.

## Records, paths and values

An op reads and changes **records**: an entry's content as an app sees it through a schema (`lens::View`), whatever
version wrote it (one lens hop, `Lane::view`). The schema says how each field is stored (text, value, list of values,
list of records with an integer `id`), so ops never name Loro containers.

A **path** is a JSON array of steps from the record's root: `[]` the whole record, `["title"]` a field,
`["blocks", {"id": 2}]` the row with id 2 of a list of records, `["blocks", {"id": 2}, "text"]` a field of that row.
In a `where`, `["blocks", "*", "text"]` is that field of any row. A text, a value or a list of values changes as a
whole (Loro still writes the smallest change to a text, so edits at once merge), while a list of records changes row
by row.

## Reads

```
{"op": "query",   "vault": VaultId?, "where": Where?, "schema": SchemaRef?, "select": [Field]?,
                  "order": [[Key, "asc" | "desc"]]?, "limit": n?, "offset": n?}
{"op": "get",     "entry": EntryId, "schema": SchemaRef?, "line": Line?, "at": [EditId]?}
{"op": "history", "entry": EntryId, "limit": n?}
{"op": "schemas", "vault": VaultId}

Where     = {"all": [Where]} | {"any": [Where]} | {"not": Where}
          | Label                                 -- the cap selector's atoms, exactly as a slice writes them
          | {"path": Path, Test}                  -- a value of the record; a row step may be "*": any row
Label     = {"type": [Sym]} | {"author": [VaultId]} | {"entry": [EntryId]} | {"created": [from, to]}
          | {"tag": Sym} | {"noTag": [Sym]} | {"onlyTags": [Sym]}
Test      = "eq": v | "ne": v | "lt": v | "le": v | "gt": v | "ge": v | "in": [v] | "has": v | "contains": "text"
          | "exists": bool
SchemaRef = "document" | "todo" (the app's built-ins), a schema's id in hex, or "stored": the record as the item
            stores it, which ops read and never change. Left out: the newest schema of the record's own kind.
Key       = a label ("type", "author", "entry", "created"), or a path into the record
Line      = null or left out: the main line; a proposal, by the id of the write that started it
```

- **Labels first.** The planner (`Where::plan`) turns the label part of `where` into a `Selector`, the very type caps
  hold: its labels' or-of-ands, or the whole vault where that would pass a selector's bounds. A device picks entries
  by the plan before it opens any, then tests the rest on each record it opens. The plan picks no less than the query
  (O3), and a query never sees an entry the device can't open: its label part is the only part that could ever
  decide what a device syncs.
- **Rows.** `query` answers `{"rows", "count", "plan"}`: each row `{"entry", "vault", "type", "tags", "created",
  "author", "schema", "readOnly", "record"}`, the record with only the fields `select` names, if it names any; in the
  order the device took the entries, or by `order`; from the `offset`th, at most `limit`. `count` is how many rows
  there are in all; `plan` is the selector they were picked by. `get` answers one row, with its `line`, the line's
  `heads`, the version `at` (read-only) and the schemas the item was written under (`authored`).
- **History** gives an entry's lines (`main` first, then each proposal with its name, where it started and its
  heads) and every write of it the device counts: its id, its device (`author`), the vault it acted for (`actor`), its
  line, what it builds on, what it is (`edit`, `propose`, `merge`, `promote` or `sealed`) and, for the latest `limit`
  (200) that change anything, the changes it made to the stored record, as every reader sees them alike:
  `{"set": path, "value": v}`, `{"unset": path}`, or `{"rows": field, "keys": [key]}`, a list's new order of rows.
- **Schemas** gives the schemas and lenses a vault's entries are read through, the app's own first (`builtIn`).

## Changes

```
{"op": "create",  "vault": VaultId, "type": Sym, "tags": [Sym]?, "schema": SchemaRef?, "value": Record}
{"op": "set",     "entry": EntryId, "path": Path, "value": v,               "line": Line?, "schema": SchemaRef?}
{"op": "unset",   "entry": EntryId, "path": Path,                           "line": Line?, "schema": SchemaRef?}
{"op": "insert",  "entry": EntryId, "path": [Field], "value": v, "at": n?,  "line": Line?, "schema": SchemaRef?}
{"op": "remove",  "entry": EntryId, "path": Path, "value": v?,              "line": Line?, "schema": SchemaRef?}
{"op": "move",    "entry": EntryId, "path": [Field, {"id": n}], "to": n,    "line": Line?, "schema": SchemaRef?}
{"op": "tag",     "entry": EntryId, "add": [Sym]?, "remove": [Sym]?}
{"op": "propose", "entry": EntryId, "from": [EditId]?, "name": "text"}
{"op": "merge",   "entry": EntryId, "from": Line, "into": Line?, "promote": bool?}
{"op": "restore", "entry": EntryId, "line": Line?, "at": [EditId]}
{"op": "undo",    "entry": EntryId, "line": Line?, "edit": EditId}
{"op": "variant", "entry": EntryId, "line": Line?, "into": VaultId, "schema": SchemaRef?, "ops": [RecordOp]?}
{"op": "batch",   "ops": [Op]}
```

Every change op may carry `"as": VaultId`, the vault it acts for (the device's own by default; a batch's for its
ops that name none), as every edit does, and the rules judge it as they judge any peer's edit. An op carrying a field
it doesn't take is refused, never half read.

- **The record ops** (`ops::Op`): `set` the whole record, a field, a row (all its fields) or a field of a row; `unset`
  a field or a field of a row; `insert` a row into a list of records, or a value into a list of values, at place `at`
  or last; `remove` a row, or (with `value`) every copy of a value from a list of values, a no-op if it holds none;
  `move` a row to place `to` of the list without it. Each names a place (`ops::Loc`) and changes nothing it doesn't
  cover (O2).
- **Apply, then write.** The engine runs the record ops on the app's view of the line, fills each field they leave
  out at its schema's default, checks the result is a view of the schema (`View::put`, else `NotAView`), and hands it
  to `Item::write`, whose lens and Loro diff make the smallest change. So ops are schema-generic: a new schema needs
  no new code. A record op that changes nothing writes nothing (its `edit` is `null`).
- **The rest map onto what exists.** `create` onto `Lab::create` (with no `schema`, the one its value's `kind`
  names; fields it leaves out take their defaults), `tag` onto `Lab::tag`, `propose` (from the main line's heads,
  left out), `merge` (with `promote`, a merge that brings `into` to exactly what `from` shows), `restore` and `undo`
  onto `History`'s lines, and
  `variant`, a new entry of vault `into` that starts from the line's record, onto `Lab::variant_with`, with the record
  ops (`ops`, which name no entry, line or schema) the copy runs before it is written, as the page's variant mark.
  Promote, restore, undo and variant need no schema: they put back records the item's own changes wrote, each field
  in the container it already has.
- **Batches.** Every op of a batch is read before any runs. Record ops in a row on one entry's line, through one
  schema, acting for one vault, make one write. The steps then run in order up to the first refused, and what ran
  before it stands: the refusal says which op (`at`) and what the steps before it did (`done`).
- **Answers.** `{"ok": ...}`, or `{"refused": name, "why": "words"}` (a batch's with `at` and `done`): a rule's
  refusal by its name (`NoCap`, `NotActing`, `ReadOnly`, `NotAView`, `Locked`, `UnknownDep`, `NotOnProposal`, ...),
  `BadOp` where the JSON says nothing the engine does or an op makes no sense of the record, `NoSchema` where no
  schema reads the record, `NoEntry` where the device shows no such entry or line. One shape for the page and the Mac
  app alike.

## One engine, everywhere

`avendb::engine` runs every op on a device's Lab: `engine::read` for the four reads, which run on what the device
holds and change nothing, and `engine::run` for changes. Each device has one entry point:

- **The page's device** (`avendb-browser`): `Device::run(op)`, reads through the node's read lock, changes through
  `act`, which tells its peers. `PageDevice.run(op)` hands it to JavaScript as a promise.
- **The Mac app's device** (`avendb-device`, the sidecar): one call, `run`, the same JSON, the same answer.
- **The page** (`src/lib/avendb/ops.js`, `Account.svelte`): `api.run(what, op)` runs a change and reports a refusal
  in the engine's words; `api.ask(op)` returns the answer as it is. Notes, Todos, tags, the note's proposals, merges,
  restores, undos and variants all write through it; the note page reads its lines through `get`.
- **The studio's Query console** (Database, Query): any op as JSON, run with Ctrl+Enter or ⌘Enter, with examples for
  the vault looked at. A query shows its rows as a table and, in words and as JSON, the selector its labels picked
  them by before any entry was opened: the selector a cap on those entries would hold. A change acts as the acting
  vault unless it names another.

## What a write did: the same changes

`ops::diff(before, after)` turns two records into the changes that make one the other, in a normal form: the new
value of each place that changed (a field, or a field of a row; gone: `unset`), and the new rows of each list of
records whose rows changed. A write's changes are the diff of its line's record before it (its own line's deps) and
after it. Two laws tie the halves together, proved in `spec/AvenDB/Ops.lean`:

- **O1, diff explains apply** (`apply_diff`): applying `diff(r, s)` to `r` gives `s`, so no change escapes a diff
  (`diff_complete`) and a diff names only what changed (`diff_sound`).
- **O2, ops do what they say** (`diff_within`): the diff of an op's run names only what its place covers.

So a client that may run some ops can predict exactly what every reader will judge its write to have done.

## Caps that name ops

A write cap's slice may carry **rules**: which ops its grantee's writes may make, as op patterns, beside its selector
(which entries) and its relabel set (which tags it may ask for). A cap without rules is unruled and lets its grantee
change anything of the entries it reaches, as before.

```
Slice   = { select: Selector, relabel: [Sym], rules: [Rule]? }
Rule    = {"op": "set", "path": Pattern, "to": [v]?, "on": On?}   -- any change at or under the path; to: only to these
        | {"op": "insert" | "remove" | "move", "path": Pattern?, "on": On?}   -- rows of a list of records
        | {"op": "merge", "on": On?} | {"op": "propose"} | {"op": "create"}
Pattern = a path whose steps may be "*": any one field or any one row; [] is the whole record
On      = "main" | "proposals"                                     -- left out: either
```

A slice carries at most 64 rules, a pattern at most 8 steps and a `to` at most 64 plain values (`null`, `true`,
`false`, integers, texts); a proof opens at most 16 caps. A rule with a field it doesn't take is refused, never
ignored.

"Bob may set the status of the todos tagged work, to doing or done" is a write cap whose selector picks
`[[{"type": ["todo"]}, {"tag": "work"}]]`, with the one rule `{"op": "set", "path": ["status"], "to": ["doing",
"done"]}`. "Carol may suggest changes to the notes" is `[{"op": "propose"}, {"op": "set", "path": [], "on":
"proposals"}, {"op": "merge", "on": "proposals"}]`: she edits her own proposals, and only a writer the main line lets
in merges them there. "Dave may tick the items of this checklist" is `{"op": "set", "path": ["blocks", "*",
"checked"]}`.

### What a write did: its touches

Rules judge a write by what its ops do, not by the record before and after it: a write that sets a field to the
value it already holds changes nothing, yet carries a newer Loro op that wins over an edit made at once. So every
reader reads a write's **touches** off the Loro ops it carries, imported on the version it builds on (`doc::Item::
footprint`), the same for every reader:

- `set(place, to?)`: an op on a field (`["title"]`), a row (`["blocks", {"id": 2}]`) or a field of a row (`["blocks",
  {"id": 2}, "text"]`): a value set or removed (with `to`, its new value, `null` when removed), a text edited, a list
  of values changed. An op the reader can't place in the record touches the whole record (`[]`).
- `insert(field)`, `remove(field)`, `move(field)`: a row of that list of records added, deleted or moved. What a
  write does inside a row it adds is part of adding it.
- `create` for the write that creates its entry, `propose` for one that starts a proposal, `merge` for one that
  brings another line's writes in (a promote also carries the changes it makes).

A rule allows a touch where its op names the touch's kind (`set` names all of `set`, `insert`, `remove` and `move`,
unless it lists the values it may set `to`), its path reaches the touch's place (names it or a place above it), and its
line holds the write's: `main` for the main line, `proposals` for any proposal. Rules allow a write when every touch is
allowed by one of them. Tags stay with the relabel set.

### Chains narrow

A cap's chain is the cap and the caps it rests on (T22). The chain is **ruled** when one of its caps is, and then
allows a write when **every** ruled cap of it allows the write: a child cap claiming more gains nothing, as for
selectors, roles and relabel sets (C1). An unruled cap under a ruled one is ruled by it.

### One bit in the clear, rules in the proof

Whoever reads an entry must be able to tell what a writer's chain allows, though the caps' slices are sealed to their
vaults only. So the rules travel with the write, and are checked against the cap:

- **A commitment in the clear.** A ruled cap's `select` carries, in the clear, the hash of its rules and a salt of 32
  random bytes (`H("rules", rules, salt)`). That is the one bit a relay learns: that some write cap is restricted,
  never how. The salt keeps the commitment from being guessed. The rules and the salt are in the sealed slice.
- **Openings down the chain.** A child cap's sealed slice carries the rules and salt of every ruled cap above it, as
  its issuer read them in its own slice, so its grantee can show its whole chain.
- **Proof-carrying writes.** A write whose actor reaches the entry only through ruled chains carries, inside its
  encrypted body, a proof: the cap it relies on, and the rules and salt of each ruled cap of that cap's chain. Readers
  of the entry learn what the writer may do there, and nothing of any selector.

### Every reader counts the same writes

Relays accept a write as before, by what they see: who acts, with which role on which cell (T25). Readers also judge
it. A write **counts** when it builds only on writes that count, and its actor is the entry's vault, or holds a live
cap with write or more reaching the entry through an unruled chain, or its proof names such a cap whose chain is
ruled: every opening hashes to its cap's commitment, and every ruled cap's rules allow every touch. A creation counts
the same way through the cap it is created through, with the touch `create`. Whether a write counts is decided by what
was true when it was accepted: the caps its actor held then (`policy::Write::caps`, none for a write that acts for the
entry's own vault), the cell its entry was in, its proof and the writes it builds on (C2). Nothing of it reads a
selector, an entry's type or its tags, so every reader of the entry, whatever caps it opened, reaches the same
verdict.

A write that doesn't count is read as one nobody can open: it stays in the log, as every edit does, and no record
ever shows it, nor anything that builds on it. A line's history is its writes that count and what they build on.
Devices build only on writes they count (a line's heads leave the others out), so an honest edit is never lost to
one that doesn't count. The engine refuses an op its caps' rules don't allow (`NotAllowed`) before anything is
written, and attaches the proof a write needs: the first ruled cap it holds whose chain allows the write. An app
patched to skip that check (`Lab::ignoring_rules`, in the tests) writes all the same, and no reader counts what it
wrote, its own device neither, nor what anyone builds on it.

Old data keeps its meaning: caps without a commitment are unruled, slices without rules have none, and bodies
without a proof carry none.

### The page asks the same evaluator

`{"op": "may", "ops": [Op], "as": VaultId?}` answers whether the device would make each op, on what it holds now: it
runs each dry (checked, proven against the rules of the caps it relies on and refused as running it would be, then not
made) and answers `{"ok": [true | {"refused": name, "why": "..."}]}`, one answer for each op, each judged on its own as
the next op a person might run. It writes nothing and tells no peer. A change that changes nothing writes nothing, so
it is never refused by the rules.

The page asks before it offers a button: a todo's tick, a note's save and rename, a proposal, a merge, a restore and
an undo. A refusal by the rules (`NotAllowed`) holds the button back and says why; a note whose line the rules let a
vault change nowhere reads as viewing, and one it may only suggest changes to offers a proposal. The page keeps no
copy of the rules: its helpers for roles, selectors and relabel sets (`reads`, `matches`, `creates`, `tagging` in
`vaults.js`) only pick what to show, and the device refuses what they get wrong.

The share dialog writes the rules of a cap that writes: any change (no rules), only suggest changes (Carol's rules
above), change only some fields, set one field to some values, or any rules as JSON, each with or without adding new
entries (`create`). The fields and values it offers are those of the newest schema of what it shares (the `schemas`
op: the one no lens reads on from). Access says each cap's rules in words, and those of the caps it rests on. A note
says how many of its edits no reader counts, and the studio's history marks each such write: it stays in the log,
sealed, and changes nothing anyone reads.

Reads get no rules, by the first principle: a read cap is its selector.

## Sync

Nothing changes in how devices sync: cells stay the unit, compiled from the caps' selectors, and relays route cell
ids. The label half of a query is the same selector, so a device that wants less than its caps reach (a phone that
holds only todos) syncs the cells its own query picks; a query's value half never decides sync, as no relay or
unopened entry could evaluate it. Ruled writes travel like any other; their readers judge them.

## Theorems

In `spec/AvenDB/Ops.lean`, beside the existing ones (vectors in `OpsVectors.lean`, which the Rust tests replay):

- **O1 diff explains apply** and **O2 ops do what they say** (above), over flat records.
- **O3 queries pick by labels** (`cover_sound`, `plan_sound`, `plan_run`): the plan picks every entry the query
  does, so running the query on what the plan picks gives the same rows.

And for caps that name ops, stated in `spec/AvenDB/Theorems.lean` and proven in `RuleLemmas.lean` and `Rules.lean`
(vectors in `Vectors.lean`):

- **C1 chains narrow rules** (`chain_narrows`, `child_narrows`): a chain allows no write one of its ruled caps
  forbids, and a cap's chain allows no more than the chain of the cap it rests on (T22's twin for rules).
- **C2 readers agree** (`counts_seen`, `creates_seen`): whether a write counts reads no selector, type or tag, and no
  rules but those of the chain its proof names, so it is the same for every reader of the entry, whatever caps it
  opened.
- **C3 ruled writes do what they may** (`counted_allowed`, `changes_allowed`): a counted write whose actor reaches the
  entry only through ruled chains has every touch allowed by every ruled cap of the chain its proof names; where its
  touches' places cover what it changed, every change of its diff is at a place a rule allows.
- **C4 allowed writes count** (`allowed_counts`, `allowed_creates`, `uncounted_closed`): a write that builds on
  writes that count, whose proof names a cap its actor holds reaching the entry, and whose chain allows its touches,
  counts, and so does a creation whose chain allows `create`; no write that builds on one that doesn't count counts.
- **T25 still holds**: relays see one bit more of a cap, and nothing of its rules, of a write's proof or of what it
  touches.

The Rust side is tested against them: `tests/rules.rs` writes random records in turn from two devices, wholesale or by
random ops, and checks that each write's touches cover every change of its diff and name the value of each place they
alone cover (C3's `Within`); `tests/engine.rs` runs ruled caps end to end, a grantee's `may`, a write no rule allows
and what builds on it counted by no reader, chains of ruled caps (C1) and suggesting through proposals; the vectors
replay `Vectors.lean`'s ruled caps.

## Phases

| Phase | What | Ships as |
|---|---|---|
| O1 | Lean: flat records, paths, changes, ops, apply, diff, where, plan; O1 to O3; vectors | PR #415, with O2, O3 |
| O2 | Rust: `ops` and `engine` in the core, `Device::run`, the sidecar's `run`; generic promote and variant | |
| O3 | Page: Notes, Todos, tags and the note page on `api.run`; the studio's Query console | |
| C1 | Lean: rules in slices, chain narrowing, proof-carrying writes, acceptance; C1 to C4, T25 | one PR, with C2, C3 |
| C2 | Rust: slice rules and the ruled bit, chain keys, proofs, every reader's check, `may` | |
| C3 | Page: rules in the share dialog, buttons by `may`; the walks; server redeploy | |

## Later

Live queries (a subscription that names what changed instead of re-running), updates by query (`set ... where`),
batches over several entries that write all or nothing, indexes for large vaults, more than one lens hop, and
entries split into facets for field-level reading.
