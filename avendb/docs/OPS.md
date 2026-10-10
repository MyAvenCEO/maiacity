# Ops: one JSON language to read and change any data, and caps that name it

Samuel's ask (2026-10-10, 06:49 to 06:52), two tasks in this order: first one universal query and mutation engine,
in which every read and every change of avenDB is a declarative JSON op, the same for any schema and its values; then
caps that name those ops, still decentralized and Biscuit-like, fitting the local-first Loro and iroh design and the
frontier sync, built from first principles, DRY, end to end. This file is the design. It builds on flat vaults
(`FLAT-VAULTS.md`) and on the research behind them (`/mnt/project-files/sync-research/reports/E2E database dynamic
caps and keys.md`), and changes none of their theorems.

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
   half of every query. The function that turns a write into the ops it performed is the one that checks it against a
   cap, the one that shows a history, and the one the page asks before it offers a button. Nothing is written twice,
   in Rust and again in JavaScript.

## Records, paths and values

An op reads and changes **records**: an entry's content as an app sees it through a schema (`lens::View`), whatever
version wrote it (one lens hop, `Lane::view`). The schema says how each field is stored (text, value, list of values,
list of records with an integer `id`), so ops never name Loro containers.

A **path** is a JSON array of steps from the record's root: a field name, or `{"id": n}` for the record with that id
in a list of records. `["status"]`, `["tags"]`, `["blocks", {"id": 2}, "text"]`. A path ends at a field: a text, a
value or a list of values changes as a whole (an op may splice a text or insert into a list of values, and the
change is still that field's), while a list of records changes record by record.

## Reads

```
{"op": "query", "vaults": [VaultId]?, "where": Where?, "schema": SchemaRef?, "select": [Path]?,
 "order": [[Path, "asc" | "desc"]]?, "limit": n?, "after": Cursor?, "line": Line?}
{"op": "get", "entry": EntryId, "schema": SchemaRef?, "line": Line?, "at": [EditId]?}
{"op": "history", "entry": EntryId, "line": Line?}
{"op": "lines", "entry": EntryId}
{"op": "schemas", "vault": VaultId}

Where   = {"all": [Where]} | {"any": [Where]} | {"not": Where}
        | Label                                   -- the cap selector's atoms, exactly as a slice writes them
        | {"path": Path, Test}                    -- a value of the record
Label   = {"type": [Sym]} | {"author": [VaultId]} | {"entry": [EntryId]} | {"created": [from, to]}
        | {"tag": Sym} | {"noTag": [Sym]} | {"onlyTags": [Sym]}
Test    = "eq": v | "ne": v | "lt": v | "le": v | "gt": v | "ge": v | "in": [v] | "has": v | "contains": "text"
        | "exists": bool
SchemaRef = a schema's id, or a built-in name ("document", "todo")
```

- **Labels first.** The planner splits `where` into its label part, a `Selector` (`slice::Selector`, the very type
  caps hold, normalised to the bounded or-of-ands), and the rest. The label part picks cells and entries from labels
  alone; the rest runs on each record the device opens. A query never sees an entry the device can't open, and its
  label part is the only part that could ever decide what a device syncs.
- **Rows.** `{"entry", "vault", "type", "tags", "created", "author", "record" (or the selected paths), "readOnly",
  "line", "heads"}`, ordered, at most `limit`, with a cursor for the next page. Every row comes with the schema's
  fields (`{"path", "stored", "enum"?, "default"?}`), so a table can show any schema without knowing it.
- **History** gives each write of a line with the ops it performed (below), its author, actor and schema: the
  per-write diff the studio lacks today.

## Changes

```
{"op": "create", "vault": VaultId, "type": Sym, "tags": [Sym]?, "schema": SchemaRef?, "value": Record}
{"op": "set",    "entry": EntryId, "path": Path, "value": v,                 "line": Line?, "schema": SchemaRef?}
{"op": "unset",  "entry": EntryId, "path": Path,                             "line": Line?, "schema": SchemaRef?}
{"op": "insert", "entry": EntryId, "path": Path, "value": v, "at": n?,       "line": Line?, "schema": SchemaRef?}
{"op": "remove", "entry": EntryId, "path": Path,                             "line": Line?, "schema": SchemaRef?}
{"op": "move",   "entry": EntryId, "path": Path, "to": n,                    "line": Line?, "schema": SchemaRef?}
{"op": "splice", "entry": EntryId, "path": Path, "at": n, "delete": n, "insert": "text", "line": Line?, ...}
{"op": "tag",    "entry": EntryId, "add": [Sym], "remove": [Sym]}
{"op": "propose", "entry": EntryId, "from": [EditId], "name": "text"}
{"op": "merge",  "entry": EntryId, "from": Line, "into": Line, "promote": bool?}
{"op": "restore", "entry": EntryId, "line": Line?, "at": [EditId]}
{"op": "undo",   "entry": EntryId, "line": Line?, "edit": EditId}
{"op": "variant", "entry": EntryId, "line": Line?, "into": VaultId}
{"op": "batch",  "ops": [Op]}
```

Every change op may carry `"as": VaultId`, the vault it acts for (the device's own by default), as every edit does.

- **Apply, then write.** The record ops (`set` to `splice`) are pure functions on a record: the engine applies them to
  the app's view of the line, checks the result is a view of the schema (`View::put`, else `NotAView`), and hands it to
  `Item::write`, whose lens and Loro diff make the smallest change. So ops are schema-generic: a new schema needs no
  new code. The ops of a batch on one entry become one write; a batch over several entries writes nothing unless every
  one of them would be taken.
- **The rest map onto what exists**: `create` onto `Lab::create` with `Item::made`, `tag` onto `Lab::tag`, the line
  ops onto `History`'s drafts. Promote, restore, undo and variant become schema-generic too: they take their record
  through its own view instead of the built-in document or todo (`kind_view` goes).
- **Results.** `{"ok": {"entry"?, "edit"?, "line"?, "heads"?}}`, or `{"refused": Refusal, "why": "text"}`: one shape
  for the page and the Mac app alike.

## What a write did: the same ops

`diff(before, after)` turns two records into the ops that make one the other, in a normal form: `set` or `unset` of a
field (a text, a value or a list of values, whole), and for a list of records the `remove` of each record gone, the
`insert` of each new one, a `move` where the kept records changed order, and the `set` or `unset` of each field of a
kept record that changed. A write's ops are the diff of its line before it (its deps) and after it. Two laws tie the
halves together:

- **Diff explains apply.** Applying `diff(r, s)` to `r` gives `s`.
- **Apply is what it says.** Every op of `diff(r, apply(r, ops))` lies on a path one of `ops` names (or under it).

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
  that cell whose rules allow every op of the write's diff (merges, which carry no content, need the `merge` rule).
  A write no rule allows is read as one nobody can open: it stays in the log, as every edit does, and no record ever
  shows it, nor anything that builds only on it. The verdict depends only on the replayed log and the write, so every
  reader reaches the same one (convergence holds), with no steward online.
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

New, in `spec/AvenDB/Ops.lean` and beside the existing ones:

- **O1 diff explains apply**, **O2 apply is what it says** (above), over JSON records with paths.
- **O3 queries see only what opens**: a query's rows are entries the device reads, and its label part is a selector.
- **C1 chains narrow rules** (with T22): a chain allows no op one of its ruled links forbids.
- **C2 readers agree**: whether a write counts is a function of the replayed state and the write.
- **C3 ruled writes do what they may**: a counted write of a ruled chain changes only what its rules allow.
- **C4 allowed ops are taken**: ops the rules allow, run through the engine, make a write every reader counts.
- **T25 still holds**: relays see one bit more of a cap, and nothing of its rules or of any op.

## Phases

| Phase | What | Ships as |
|---|---|---|
| O1 | Lean: records, paths, ops, apply, diff, queries; O1 to O3; vectors | one PR with O2 and O3 |
| O2 | Rust: `ops` in the core (parse, apply, diff, where, planner), `Lab::run`, `Device::run`, one sidecar call `run`; generic promote, restore, undo and variant | |
| O3 | Page: Notes, Todos, the table editor and the studio on `api.run`; a query console in the studio | |
| C1 | Lean: rules in slices, chain narrowing, proof-carrying writes, acceptance; C1 to C4, T25 | one PR with C2 and C3 |
| C2 | Rust: slice rules and the ruled bit, chain keys, proofs, every reader's check, `may` | |
| C3 | Page: rules in the share dialog, buttons by `may`; the walks; server redeploy | |

## Later

Live queries (a subscription that names what changed instead of re-running), updates by query (`set ... where`),
indexes for large vaults, more than one lens hop, and entries split into facets for field-level reading.
