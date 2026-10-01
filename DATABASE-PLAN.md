# A generic database on Loro + iroh — execution plan

A plan, not built. It follows [VERSIONING-RESEARCH.md](VERSIONING-RESEARCH.md): Loro documents carried by the iroh-docs
catalog, with Jazz 2's patterns for schemas, migrations and branches — because we want dynamic schemas later, not a
fixed data model in code.

The deliverable: a **Database** tile on the app's dashboard (the Mac app, where the vault lives), a generic viewer and
editor for any collection whose objects are Loro documents, each enforced by its own JSON Schema — with history,
checkout, revert, branches, merging, promotion and schema migration. Two examples prove it: **todos** (records) and a
**collaborative text document** (rich text, presence, history, drafts).

Nothing here touches today's data (timelines, the catalog's file records) — they move onto the same module later, once
it is proven.

---

## 1. Principles

- **Never invent a CRDT.** Loro does operations, merge, history, checkout, revert, undo, forks. iroh-docs does signing,
  sync, ordering, download policies, deletion by prefix; iroh-blobs does bytes. We write the glue and the UI.
- **Schemas are data** (Jazz 2): every schema version is a content-addressed JSON Schema, named by its hash, travelling
  in its own lane of the catalog. Every object records the schema it was written under and keeps it.
- **Lenses translate between schema versions**, two-way and composable; an ambiguous change (a rename) is never guessed.
- **Loro only in Rust** (vault-core), with validation, lenses, merge and history: the studio, the MCP agents and any
  later surface all go through it. The page holds no Loro at all — it sends edits through Tauri commands and redraws
  from what Rust answers. One Loro, one encoding, nothing to keep in step between two runtimes.
- **Prefix-safe keys** through one key builder; never write at a key that is a folder of others (except to delete it).
- **Mac-native**: the Database tile exists in the Mac app only (the vault and iroh run there).

---

## 2. The model

| Term | What it is | Jazz 2 counterpart |
|---|---|---|
| **Collection** (`kind`) | a named set of objects sharing a schema family (`todo`, `note`) | table |
| **Object** | one Loro document, its id fixed-width (32 hex, random) | row |
| **Schema version** | a JSON Schema (2020-12) document; its id is its BLAKE3 hash | `schema.ts` version hash |
| **Lens** | a two-way, declarative transform from one schema version to another | migration lens |
| **Branch** | a named parallel view over a collection; an object has a fork on it only once edited there; reading falls back to the base | branch view `{branch, base}` |
| **Version** | a Loro frontier (a point in the object's history) | row version |

### JSON Schema → Loro containers

The root of every object is a `LoroMap`. The schema decides each field's container, with an extension keyword
(`x-loro`) where JSON Schema alone is ambiguous:

| JSON Schema | Loro | Merges as |
|---|---|---|
| `object` | `LoroMap` (nested) | per field |
| `array` | `LoroList` (default) · `LoroMovableList` (`"x-loro": "movable"`) | inserts/deletes kept; movable: moves too |
| `string` | plain value (last writer wins) · `LoroText` (`"x-loro": "text"`, rich text with marks) | text: character by character |
| `number` / `integer` / `boolean` / `null` | plain value | last writer wins |
| `integer` + `"x-loro": "counter"` | `LoroCounter` | adds up |
| `array` of nodes + `"x-loro": "tree"` | `LoroTree` | moves without cycles |

Every object's root also holds `$schema` (the schema hash it is written under) and `$kind`. A `checkout` of an old
version therefore shows the schema that version was written under.

---

## 3. Storage: keys in the iroh-docs catalog

All keys fixed-width or terminated (`/`), built by one function, never a prefix of another by accident.

```
kind/<kind 16>/                                   → collection record: name, current schema hash, branches
schema/<kind 16>/<schema hash 64>/                → the JSON Schema blob (content-addressed: hash = id)
lens/<kind 16>/<from 64>/<to 64>/                 → a lens spec blob (two-way ops)
branch/<kind 16>/<branch id 32>/                  → branch record: name, base branch, created, by, state (open/merged/promoted/closed)
obj/<kind 16>/<id 32>/main/ops/<author 64>/<seq 020>/            → one commit's Loro update (main)
obj/<kind 16>/<id 32>/main/snap/<author 64>/<seq 020>/           → a Loro snapshot (compaction)
obj/<kind 16>/<id 32>/br/<branch id 32>/fork/                    → where this object forked: base frontiers
obj/<kind 16>/<id 32>/br/<branch id 32>/ops/<author 64>/<seq 020>/  → its commits on that branch
view/<kind 16>/<id 32>/                           → the current JSON view on main (plain readers, the web mirror)
```

- **Per author, never overwritten**: commits from different devices never collide; iroh-docs' CRDT keeps them all.
- **Deletion the Willow way**: one empty write at `obj/<kind>/<id>/` prunes the object (each author its own entries);
  a delete goes through the person's approval modal (asks.rs), as file deletes do.
- **GC**: entry contents are already protected by the keep pass (`record_hashes`), so every update and snapshot stays.
- **Download policy**: every device syncs `kind/`, `schema/`, `lens/`, `branch/` and the objects of the collections it
  keeps (later: per-collection rules, like stories' rules today).

---

## 4. Phases

Each phase ends merged to main, with tests; the UI comes after the engine is proven headless.

### P0 · The engine (vault-core `crdt`)

- Add `loro` (1.16.x, pinned) to vault-core.
- The key builder (prefix-safe, with a test that no two key shapes cut each other).
- `open(kind, id, branch) -> LoroDoc`: read the object's snapshot (newest) + every later op entry, import them.
- `commit(kind, id, branch, change, message) -> Version`: apply the change, export the update since the last local
  version (`ExportMode::Updates { from }`), store it as a blob, write the op entry; `set_next_commit_message` carries the
  message; refuses if validation fails (P1).
- `subscribe(kind, id)`: iroh-docs live events → re-import new op entries → notify (Tauri event / MCP).
- Compaction: after N commits (e.g. 200), a snapshot entry; opening starts from it.
- **Accept**: two in-process nodes (the test harness already runs real iroh endpoints for the server) edit the same
  object offline, sync, converge; history survives a restart; a deleted object is pruned on both.

### P1 · Schemas (enforced)

- `schema_put(kind, json_schema) -> hash` (stored as a blob under `schema/`), `schema_get(kind, hash)`,
  `kind_put(kind, name, current_schema)`.
- Validation on every commit: the object's JSON view (`get_deep_value`) against its `$schema` (Rust `jsonschema` crate —
  check the current version), plus the `x-loro` container check (a `text` field must be a `LoroText`, …). An invalid
  commit is refused with the schema's own messages.
- `create(kind, initial)`: builds the containers from the schema (§2 table), sets `$schema`/`$kind`.
- **Accept**: a todo without a title is refused; a text field edited character by character merges across two nodes.

### P2 · Lenses and migration (Jazz 2's model)

- A lens spec: a list of two-way ops — `add(path, default)`, `drop(path, backwardsDefault)`, `rename(from, to)`,
  `convert(path, mapping both ways)` (e.g. `done: bool ↔ status: enum`), `wrap`/`head`, `in(path, ops)`, `map(ops)`.
  Ink & Switch's Cambria is the reference design; Jazz 2's add/drop defaults and draft rule apply.
- `lens_put(kind, from, to, spec)`; a diff between two schema versions proposes a lens; a removed + added field pair is
  a **draft** until a person confirms rename or not (the approval modal).
- Reading: `view(kind, id, at_schema)` runs the lens chain from the object's `$schema` to the one asked for — every
  version, old or new, readable under the current schema (and the other way, for an older app).
- Writing: an app on a newer schema writing an older object first writes **one migration commit** (the lens applied as
  Loro operations, `$schema` moved) — it sits in the history like any edit; "migrate all" does it for a collection,
  ideally on a branch first (P4) and merged when it looks right. An app older than an object's schema opens it read-only.
- **Accept**: todos written under v1 read correctly under v2 and back; migrating on a branch, then merging, moves main.

### P3 · History

- `history(kind, id, branch) -> [Version {frontiers, author, time, message, schema}]` (Loro's change graph; authors are
  the iroh authors behind each op entry).
- `checkout(kind, id, version)`: a read-only view of that version (Loro `checkout`, then `checkout_to_latest`).
- `diff(kind, id, a, b)`: field-level changes (Loro `diff`), text as inserted/deleted runs.
- `revert(kind, id, version)`: Loro `revert_to` — a new commit restoring that version; nothing is lost.
- Undo/redo in the editor: Loro's `UndoManager` (per local session, grouped by gesture), separate from history.
- **Accept**: step back and forth through 50 versions; revert, then revert the revert; undo stays local.

### P4 · Branches, merging, promotion

- `branch_create(kind, name, base)`; editing an object on a branch forks it there the first time (Loro `fork_at` of the
  base's current frontier, the fork point recorded under `fork/`).
- Reading `{branch, base}`: the object's branch fork if it has one, else the base — a branch is cheap: only what changed
  on it is stored.
- `merge(kind, branch → base)`: for each forked object, import its branch ops into the base document — Loro merges
  them (concurrent edits on both sides combine per the CRDT's rules); a preview shows the diff first.
- `promote(kind, branch)` (**swap**: the branch becomes the truth): for each forked object, revert the base to the fork
  point, then import the branch's ops — the base now equals the branch, and the replaced work stays in its history.
- `branch_close` / `branch_delete` (prune its entries; approval modal).
- Branch records carry state (open, merged, promoted, closed) so the UI and agents see what happened.
- **Accept**: a "planning" branch over todos, edits on both sides, merge combines them; a second branch promoted
  replaces main; a schema migration done on a branch and merged.

### P5 · Surfaces: Tauri commands and MCP

- Tauri: `db_kinds`, `db_schema_*`, `db_list`, `db_get`, `db_commit`, `db_history`, `db_checkout`, `db_diff`,
  `db_revert`, `db_branch_*`, `db_merge`, `db_promote`, `db_lens_*`, `db_migrate`, and events `db-changed`.
- MCP: the same as tools, so agents read and edit any collection through the same validation and history. A delete, a
  schema change that drops data, a promote: asked of the person first (asks.rs modal).

### P6 · The Database app (dashboard tile)

- A tile in `src/lib/app/places.ts` (`ADMIN`, cap `media:admin`, shown only in the Mac app), route `/app/database/`.
- Layout, on the studio's dark marine tokens:
  - **Left**: collections, each with its current schema version and branch count; "New collection".
  - **Top bar**: the branch switcher (main · planning · …, "New branch", "Merge into main", "Promote"), a search.
  - **Middle**: the objects as a table — columns from the schema (titles from `title`, types from `type`), sortable and
    filterable; schema-version badge per row when it differs from the current one ("v1 → shown as v2").
  - **Right**: the inspector — a form generated from the JSON Schema (string, enum, boolean, number, date, nested
    object, list, rich text), validation errors inline as you type (the schema's messages), "Save" = one commit with a
    message.
  - **Bottom drawer**: history of the selected object — versions as a list (author, time, message, schema), a slider to
    scrub, the diff of the selected version, "Restore this version", "Branch from here".
  - **Checkout banner** while looking at the past: "Viewing <time> — Restore · Back to latest".
  - **Schema panel**: the JSON Schema of each version (read and edit), the lens to the next version as a list of ops
    (add / drop / rename / convert), a migration preview over the collection's objects, "Migrate on a branch".
- Live: other devices' and agents' commits appear at once (iroh live events → `db-changed`).

### P7 · Example 1 — Todos

- **Schema v1** (`todo`): `{ title: string (minLength 1), done: boolean (default false), notes: string ("x-loro": "text") }`.
- **Schema v2**: `{ title, status: "todo" | "doing" | "done" (default "todo"), due: string (format date, default null),
  notes, tags: array ("x-loro": "movable") }`; lens v1→v2: `convert(done ↔ status: true ↔ "done", false ↔ "todo")`,
  `add(due, null)`, `add(tags, [])`.
- The walk-through (each step a test and a demo):
  1. Create todos; edit them on two devices offline; they converge.
  2. History of one todo: scrub, diff, restore an old title.
  3. Branch "planning": reorder tags, mark some done; main changes meanwhile; merge — both kept.
  4. Branch "rewrite": rename everything; promote — main becomes it, the old main in history.
  5. Schema v2 published: v1 todos show as v2 through the lens; "Migrate on a branch" → merge → all on v2.

### P8 · Example 2 — A collaborative text document

- **Schema** (`note`): `{ title: string, body: string ("x-loro": "text", rich), tags: array ("x-loro": "movable") }`.
- **The editor**: the body in a rich-text editor (ProseMirror or CodeMirror) with a thin binding of our own to the Rust
  engine — no Loro in the page. The editor's inserts and deletes (index, length, text) go to Rust in small batches
  (`db_text_edit`, a few ms apart; a Tauri call is about a millisecond); Rust applies them to the `LoroText` and pushes
  others' changes back as deltas (`db-changed`). Cursors and selections are Loro's stable cursors, kept in Rust, so they
  stay put when others type. Plain text first, then marks (bold, italic, headings). Typing commits are grouped (every
  pause, every N seconds), each a history entry.
- **Presence**: cursors and selections of others — Loro's ephemeral store, sent over **iroh-gossip** on a topic per
  document (never stored: presence is not history).
- **History UI**: a timeline rail beside the text — versions grouped by session and author, a scrubber that shows the
  text as it was (read-only checkout), changes highlighted (inserted / deleted runs), "Restore this version",
  **"Recover"**: select text in an old version and bring it back into the current one (a new commit, nothing reverted).
- **Branches as drafts**: "New draft from here" (a branch), edit freely, "Compare with main" (side by side, changes
  marked), "Merge draft" (Loro merges the text character by character), "Promote draft" (it becomes the text), switch
  between drafts and main from the top bar.
- The walk-through: two devices type at once; one goes offline, writes a paragraph, comes back — merged; a sentence
  deleted yesterday recovered from history; a draft rewrite compared, then promoted; the old text still in history.

### P9 · Hardening

- Compaction thresholds and shallow snapshots for very long histories (measured on the text example).
- Large values stay blobs referenced by hash (never inside a Loro document).
- Per-collection keep rules (which store keeps which collection), like stories' rules.
- Version pinning of `loro` (Rust only), upgrade notes.
- End-to-end tests with two real nodes (as the server's cold-storage test does), a crash mid-commit, a clock-skewed
  device (order must not depend on it).

---

## 5. What comes after (not in this plan)

Timelines, world shots, stories and file descriptions moved onto the same engine — each becomes a collection with its
schema; the studio's editing, grading and looks get history, branches and merge from it, and Postgres' `timelines` /
`shots` tables retire.

## 6. Risks and open questions

- **The text binding is ours**: positions, batching, marks and cursor mapping between the editor and Rust's
  `LoroText` — plain text first, measured for typing latency; Loro's own browser bindings stay a fallback if it bites.
- **Validation of CRDT merges**: two valid concurrent edits can merge into an invalid state (e.g. two `status` writes
  are fine, but a merged list may break a `maxItems`). Policy: validate after import; an invalid merged state is flagged
  in the UI (and to agents), fixed by a normal commit — never silently dropped.
- **Lens coverage**: complex reshapes beyond add/drop/rename/convert need care; start with those four.
- **Schema permissions**: who may publish a schema version or a lens (for now: the admin, through the approval modal).
- **Presence over gossip**: topic per document, bounded rate; no presence when offline.
- **Size**: text histories grow; measure, then decide compaction and shallow-snapshot policy.

## 7. Order of work and rough size

| Phase | Depends on | Size |
|---|---|---|
| P0 engine | — | M |
| P1 schemas | P0 | M |
| P2 lenses + migration | P1 | L |
| P3 history | P0 | S |
| P4 branches | P3 | M |
| P5 surfaces (Tauri, MCP) | P0–P4 | M |
| P6 Database app | P5 | L |
| P7 todos example | P6 | S |
| P8 text example | P6 | L |
| P9 hardening | all | M |
