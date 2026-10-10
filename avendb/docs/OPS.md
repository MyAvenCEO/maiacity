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

## Caps that name ops (the second task)

A slice gains **rules**, op patterns, beside its selector and its relabel set (which already is the tags' rule):

```
Slice   = { select: Selector, relabel: [Sym], rules: Option<[Rule]> }       -- none: the role decides alone, as today
Rule    = {"op": "set", "path": PathPattern, "to": [v]?}         -- any change at or under the path; to: only these
        | {"op": "insert" | "remove" | "move", "path": PathPattern}  -- only that change, of a list of records
        | {"op": "create", "where": Where?}
        | {"op": "propose"} | {"op": "merge"}
PathPattern = a path whose steps may be "*": any field or any record
```

"Bob may set the status of the todos tagged work, to doing or done" is a write cap selecting `type in {todo}, tag has
work`, with the one rule `{"op": "set", "path": ["status"], "to": ["doing", "done"]}`.

- **Chains narrow.** What a chain allows is what every one of its ruled links allows (the AND, as for selectors,
  roles and relabel sets): a child claiming more gains nothing.
- **One bit in the clear.** A cap says in the clear whether it is ruled. Relays learn that some write cap is
  restricted, never how.
- **Proof-carrying writes.** A write that relies on a ruled chain carries, inside its sealed body, the selector key of
  each link of that chain: whoever opens the write opens the chain's slices and so its rules. A child cap carries its
  parent chain's selector keys inside its own sealed slice, so its grantee can always prove its whole chain. Readers
  of the entry learn what the writer may do there, and nothing else.
- **Every reader checks the same way.** A reader takes a write by an actor that holds an unruled chain granting write
  on the entry's cell as today. Otherwise it takes it only if the write's proof opens a ruled chain granting write on
  that cell whose rules allow every change of the write's diff (merges, which carry no content, need the `merge`
  rule). A write no rule allows is read as one nobody can open: it stays in the log, as every edit does, and no record
  ever shows it, nor anything that builds only on it. The verdict depends only on the replayed log and the write, so
  every reader reaches the same one (convergence holds), with no steward online.
- **Old data reads as before.** Caps without the bit are unruled, slices without rules or chain keys have none, and
  bodies without a proof carry none: what is in the vaults today keeps its meaning.
- **The page asks the same evaluator.** `{"op": "may", "ops": [Op]}` answers whether this device may run them, and
  why not, before anything is written: the buttons it offers are the ops its caps allow. The JavaScript copies of the
  rules (`matches`, `creates`, `tagging`, `reads` in `vaults.js`) go.

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

Still to prove, with the second task:

- **C1 chains narrow rules** (with T22): a chain allows no op one of its ruled links forbids.
- **C2 readers agree**: whether a write counts is a function of the replayed state and the write.
- **C3 ruled writes do what they may**: a counted write of a ruled chain changes only what its rules allow.
- **C4 allowed ops are taken**: ops the rules allow, run through the engine, make a write every reader counts.
- **T25 still holds**: relays see one bit more of a cap, and nothing of its rules or of any op.

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
