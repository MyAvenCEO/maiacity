# play.maia.city — spec v0.4 (2026-11-02)

A new, separate app with **three sandboxes and the asset library with its versions**, on Postgres and object storage
instead of what came before, on the branch `SNAPSHOT_2611101` (legacy): nothing of play's reads it (§6), and the new
sandboxes drift apart from it from day one.

## 1. Decisions

| Topic | Decision |
|---|---|
| Domain | `play.maia.city`, its own Caddy block on the same Hetzner machine |
| Code | `play/` in this repo. Code is **cloned** from `maia/content` into `play/`, never imported from legacy, so the two drift apart freely |
| Sandboxes | **Sandbox 1** = a clone of today's Sandbox 4 (the dome cell and its food forest). **Sandbox 2** = a clone of today's Sandbox 7 (the physical world lab), restyled in the light brand CI. **Sandbox 3** = a clone of MaiaCity V2's world, stripped to the world itself (§5) |
| Games | No V1/V2 game in play. One **game placeholder** page, where an invited person becomes a citizen (the game itself comes later) |
| State | All three sandboxes are **stateless**: nothing a visitor does in a world is saved on the server |
| Accounts | Today's founders and passkeys copied in once (the same passkey works: RP_ID `maia.city` covers the subdomain). Sign-up is **open**; everyone who signs up is a **traveler** |
| Ownership | The **Maia City coop owns every asset** and is their authority. Its **admins** are its owners and act for it (Samuel to start) |
| Rights | Visitors (not signed in): no rights, they see the sign-in page. Travelers: enter and play every sandbox, read every asset and every version. Citizens (by invite): + propose new asset versions, + the coming game. Admins: accept or archive the intents at Proposal, run members and invites |
| Proposals | v0: **asset update proposals** only (a new version of an asset): **citizens propose, admins accept**. Pinning a sandbox to an asset version is a separate proposal kind, later (§4.4). Since 2026-11-06 a proposal is no record of its own: it is an intent at its stage Proposal, its work on it (§4.12) |
| Encryption | None for now; it can come back as a layer on top |
| Versioning | A content-addressed version DAG in Postgres (§4.3), and under it every step kept in Loro: one Loro document per story (assets next), proposals as branches, versions named by the hash of their content (§4.4, §12; Samuel 2026-11-03) |
| Out of scope | Studio, blog, stories, posts, chat, the agent MCP, theOS, DB2, the V2 trailer/intro |

## 2. Shape

```
browser ──► play.maia.city (Caddy)
              ├─ /            static SvelteKit build (play/site)
              └─ /api/*  ──►  play-api (Bun)  ──►  Postgres (same instance, own schema `play`, own role)
                                   └──────────────►  Hetzner Object Storage, bucket `maiacity-play`
                                                      (blobs by BLAKE3 hash, served by signed URL)
```

A new `play-api` service in `docker-compose.prod.yml` with its own image and release workflow. After the one-time
import the `play` role reads nothing of `public`.

## 3. Ownership chain (Postgres, schema `play`)

Who owns what, who may do what, who wrote and who approved each version. No keys or signatures: the server is trusted.

```sql
humans       (id, name, founder_number, created)                  -- copied once from public.founders
passkeys     (id, human_id → humans, public_key, counter, transports, created)
coops        (id, name, created)                                  -- 'maia-city'
memberships  (coop_id, human_id, level, granted_by → humans, granted_at, via_invite)
             -- level: admin | citizen | traveler; sign-up writes traveler; admins are the coop's owners
level_rules  (coop_id, level, rule jsonb)                         -- seeded from today's cap groups, then changed:
             -- traveler: read every sandbox + every asset; citizen: + propose, + the game; admin: everything
invites      (code, coop_id, level /*citizen*/, made_by, expires_at, used_by, used_at)
sessions     -- as today's API (signed cookie)
```

### 3.1 Migrations (Samuel 2026-11-07)

Every migration is a file of its own, `play/api/migrations/<id>.sql`, its whole SQL as it ran; there is no list of
them in code. `play/api/src/migrations.ts` lists the folder and runs every `<id>.sql` not yet in `play.migrations`, in
name order, each once, in its own transaction under one advisory lock (play-api and the import migrate at once on a
deploy), then `ensureSchemas` and `ensureLayouts` (§4.6); `until` stops after one (a test builds a database as it stood then). A migration is
never edited after it has shipped, only followed by another.

- **To add one**, write one new file and touch nothing else: `<UTC time YYYYMMDDHHMM>-<the intent's first 8
  hex>-<slug>.sql` (lowercase), e.g. `202611071200-e9afc2d5-files.sql`, the time when it is written. It sorts after
  every shipped one, and two intents can't pick the same name, so intents built in parallel never conflict over their
  migrations (`play/api/test/migrations-merge.sh`).
- **The shipped ones** `0001-ownership` … `0034-schemas` keep their numbered ids and their SQL byte for byte,
  because `play.migrations` names them; their SHA-256 are frozen in `play/api/test/fixtures/migrations.sha256.json`
  (`migrate.test.ts`, "shipped migrations unchanged"). `0036-step-backs` and `0037-intent-depends`, numbered in
  the old array while this change was built, follow them; `0037` is the last numbered id: none comes after it.
- The runner refuses to start, naming the file, on a malformed id or a duplicate (two files under one number).

## 4. Asset version control, from first principles

### 4.1 What is versioned

**Readable source, the box, the host (Samuel 2026-11-02).** Every proposed version brings its **readable source**: a
CommonJS module that sets `module.exports.recipe`, as written (play refuses minified code), kept as a file of its own
(`source_hash`). play makes the recipe file from it (`RECIPE_HEAD + source + recipeTail(slug, v, variant)`), so the
file the box runs is exactly the source people read. Proposed code never runs on play's server (it only measures,
labels and hashes text), and in the page only in the **asset box**: a frame with `sandbox="allow-scripts"` and no
origin, its own CSP with no connection, the frozen engine (held to its hash) in a worker. A proposal's record may name
only a frozen box engine, and its manifest is the libraries its source requires. The board is the intents' (Samuel
2026-11-03; §4.12): a column per stage (work at Proposal ends accepted or archived, nothing else, Samuel 2026-11-04;
an admin archives any, whoever proposed it their own); a card opened shows the version built in the box nearly
full screen, its note folded, its source (beside its base's, as changes) a button away, before anyone decides. Nothing
is proposed or edited on the page: versions come over MCP. `/api/files` serves
code as plain text (`nosniff`, `sandbox`), never as script on play's origin.

**Imported versions' sources (Samuel 2026-11-03).** Legacy bundled each asset's library and minified it into the recipe
files play imported. Each library was made again from `SNAPSHOT_2611101` by legacy's own bundler at the commit its file
was seeded from, minified to prove it is that file byte for byte, and kept unminified as the version's source
(`play/api/import/legacy/sources`, how: its README). The import gives each imported version and variant its source once
(`source_hash`, the only field a frozen version may still take, and only where it had none). The box still runs the
imported recipe file; its source is the code it was made from, for people and agents to read and start from.

An asset version is atomic: a **recipe file** (named by its BLAKE3 hash, made by play from the readable source), its
**card** (JSON: label, size, triangles, engine, params it takes), and the engine version it runs on. A recipe file is
a build output: it is never edited in place and two of them are never merged line by line. Variants (param presets,
e.g. `actors/stand-in:stand-in?face=…`) belong to a version.

### 4.2 What it has to do

Propose a new version, accept or archive it, read an asset's history as a chain, read any old version forever, compare
two versions (card diff, file hashes), revert (propose an old version's content as the next one), pin a sandbox to a
version.

### 4.3 The primitive

A **version DAG**, the part of legacy's store worth keeping, without signatures and without a CRDT:

```sql
assets          (id UUID /*its identity: random for a new asset, derived from its legacy entry (v5) for an imported one*/,
                 coop_id /*owner: the Maia City coop*/, grp, slug /*a name, shown; two assets may share it*/, label, head → asset_versions, created)
                 -- nothing refers to an asset by its group and slug (§4.7)
asset_versions  (id /*BLAKE3 of canonical {asset, parents, recipe, default_variant, variants, card, engine}*/,
                 asset_id, parents text[] /*version ids; one, or none for the first*/,
                 number int /*@v, given on accept, 1, 2, 3 …*/,
                 recipe_hash → files      /*its own recipe; NULL for a kind of variants (actors, machines)*/,
                 default_variant          /*for a kind of variants: the one a ref without a variant names*/,
                 card jsonb, engine int, author → humans, approved_by → humans, note, created,
                 imported jsonb           /*provenance: legacy vault, entry, heads, edits, authors*/)
                 -- immutable: a trigger refuses UPDATE and DELETE (only number/approver are set once, on accept)
asset_variants  (version_id, name, recipe_hash → files, card jsonb)              -- immutable
files           (hash PK /*BLAKE3 of the bytes*/, size, media_type, bucket_key, created)
intents         (… work 'asset_version', asset_id, base → asset_versions, version → asset_versions,
                 work_note, proposed_by, proposed_via, proposed_at /*the intent's work: one record (§4.12)*/)
```

- Proposing a version puts an intent at **Proposal** with it (the intent named, or a new one, §4.12): its work names
  its **base** (the head it was made from) and a not yet numbered version.
- **Accept** is one transaction: it checks `assets.head = intent.base` (optimistic concurrency), gives the version
  the next number, moves the head, writes `approved_by`, and the intent is Accepted. If someone accepted another
  version first, its work is **archived** (and so is the intent, or, its spec approved, it goes back to Build):
  re-propose it on the new head.
- Content addressing gives what legacy's store gave: the same content has the same id, a file is checked by its hash wherever
  it is read, and history can't be rewritten without every id changing.

### 4.4 Documents in Loro: every step kept (Samuel 2026-11-03)

*Its words and its one module since 2026-11-06: §4.15 Version control (a step is an **edit**, a branch an **intent
variant**, the main line **Main**; `doc_branches` is `doc_variants`, `doc_updates` is `doc_edits`). What follows is how
it came to be.*

Asset versions began as the DAG of §4.3: each version whole, nothing in between. Samuel wants every step between two
versions kept as well: how a story or an asset got from one version to the next, edit by edit, for people and agents
to read, to time-travel through and to tell (a making-of is that history played back). So documents are kept in
**Loro** (loro-crdt, a CRDT with its own history), one document per thing, while every guarantee of §4.3 stays.

- **One Loro document per document**, typed by a schema (a document itself since 2026-11-06, §4.15: a JSON Schema with Loro hints):
  `story/1` now, `asset/1` next (its readable source a text, its card, its variants), later others (a world's layout,
  shared params). An object is a Loro map, an array a movable list, a string marked `x-loro: text` a Loro text, edited
  and kept character by character. A document is always read back as plain JSON; the browser never needs Loro.
- **The server is the only writer.** Every write locks the document's row, loads it, applies the edit, checks the whole
  result against its type (and the type's own rules, such as a clip inside its story), and appends a **step**: its Loro
  update, its author (a member, or an agent under its admin's name), its means (site, mcp, import), its message and its
  time. Every MCP call that edits is a step. A whole new body sent at once lands as the few operations it differs by.
- **An intent's work is a branch**: forked at the main line's head, with its own steps (an agent can take as many as it needs).
  Proposing names it; accepting merges it into the main line (a CRDT merge: if the line moved on, both sets of edits
  stand), checks the merged result, and names it the next **version**, whose canonical JSON's BLAKE3 is recorded with
  its frontiers. Rejecting or withdrawing keeps its steps on their side line.
- **Code is never merged unseen**: a type whose content is code (`asset/1`) whose merge met other edits is accepted only
  with the hash of the merged result as it was built and previewed in the box.
- **Built recipe files and pins are unchanged**: a recipe file is still made from a version's source and named by its
  hash; sandboxes still pin builds. Loro adds the history under a version; it replaces nothing of §4.5.
- **Tables** (migration `0013-docs`): `docs` (its type, schema, head frontiers and a snapshot of its main line, written
  again every 32 steps and always holding the whole history), `doc_updates` (every step, append only), `doc_versions`
  (named versions, never changed), `doc_branches` (drafts and the intents' work, each naming its intent), `doc_peers` (who writes as which Loro peer: one per
  author on the main line, a fresh one on every branch, so two branches never write the same operation ids).
- **Reading**: a document now, any step or version as JSON, its history (the main line with every accepted branch's
  steps where they were made), and what changed between two points, field by field (lists of clips followed by their ids).
- **Measured** (the papaya, a 54 kB source): 39 steps of history in a 61 kB snapshot, the state alone 30 kB, a step
  about 20 ms to write; its eleven real versions (v1, nine draft rounds, v2) in 142 kB against 734 kB stored whole,
  each restored exactly.

**Assets on documents** (Samuel 2026-11-03, `play/api/src/assetdocs.ts`). Every asset is an `asset/1` document,
`asset:<uuid>`: its readable source as a text (diffed by lines when a whole source is sent), its label, note and engine,
its card (the version's record), and for a kind of variants its default variant; each variant is a **breed** of the
document (§4.15, Breeds), beside Main, holding its own card and, where it differs from Main's, its source. The §4.3 tables stay what the catalog, the pins and the box read: a version's
id, number, recipe file and source hash are exactly what they were, and nothing downstream reads the document.

- **Its history, made once from its versions** (in the deploy's import, and the first time an asset is touched): each
  accepted version a step at its own date, by its author, named its own number (a number legacy skipped stays
  skipped); the work kept between two versions (`play/api/import/history/<asset's uuid>`: each step's file, hash, date
  and message) as the steps between them, only where the two versions are exactly the sources it ran between, its last
  step then the next version byte for byte. The papaya's nine rounds between v1 and v2, by Maia over MCP, are the first.
  Each intent's work not yet on a branch gets one at its base, closed as it was decided.
- **Work is an intent variant** (§4.15): work proposed over the web or MCP is an intent variant seeded from the head it
  was made on, the version as proposed its last edit; an agent can make it first edit by edit (`doc_edit`: a replace by
  its text, a range of the source, a field of the card, each edit with its message) and propose it
  (`propose_doc_version` with its `variant`), its edits going with it. Accepting merges it and names the document's
  version the asset's new number.
- **An agent's camera** (Samuel 2026-11-03): an admin's MCP token also opens the world's read-only routes (`GET
  /api/me`, `/api/catalog`, `/api/files/<hash>`, `/api/sandboxes/<id>/config`, `/api/assets…`, `/api/library`; `READ_BY_TOKEN` in
  `play/api/src/app.ts`), so an agent loads a sandbox in its own browser as its admin and films it (`window.__world`'s
  `fly` and `sun`) for a story's storyboard, and finds a file in the Library (§8; Samuel 2026-11-07, intent
  140fdce6). Every other route still wants a session, a Library label's rename among them.
- **Variants over MCP** (Samuel 2026-11-03; breeds since 2026-11-06, §4.15): an asset's breeds (each a `name`, its
  card's `label`, its own `source` where it differs from Main's; changed with `doc_edit`'s and `propose_doc_version`'s
  `breed`, made with `new_breed`, or given whole as `propose_asset`'s `variants` for a new asset) make each version a
  kind of variants, as the animals are: each breed built as its variant, its own recipe file, the source
  called with its name (`module.exports.recipe(id, v, variant)`), its label shown as a chip in the asset viewer
  ("Papaya: Male" as Male), `default_variant` the one a ref without a variant names. `params` sets the card's
  parameters when the recipe declares new ones (its meta.params, in its build's order), on the version and every
  variant. The papaya's three kinds (both, female, male) are the first.
- **Never merged unseen**: an asset's work is still accepted only on the head it was made on (a moved head archives it,
  §4.3), so what is accepted is exactly the version the intents' board built and showed in the asset box; the
  document's own rule (a merge that met other edits needs its previewed hash) stands behind it.
- **The making-of**: for admins the asset viewer's History tab (§4.15) has the scrubber over every edit (versions
  marked; who, how, message, time) and plays them as a time-lapse. At a version's point it builds that version's own
  recipe file; at any other edit play makes a recipe file the same way (the box's header, the edit's source, the line
  naming the asset and the version the edit leads to) and keeps it among its files by its hash (`GET
  /api/assets/:id/recipe?edit=<seq>`, or `?intent=<id>` for an intent variant's last).
- **Measured** on the full legacy import: 203 asset documents from 264 versions, 15.1 MB of steps, made in one deploy
  with the rest of the import in under 90 s, no errors.

### 4.5 One source, every asset by its hash

- **One source of truth:** Postgres (the catalog: assets, versions, variants, cards, the owner; the sandboxes' pins and
  configs) and the bucket (every file under the BLAKE3 hash of its bytes). Nothing else is read: no legacy store, no repo
  fallback, no index of readable names in the site.
- **A resilient store (Samuel 2026-11-05: "never run into this flaky store issue").** The bucket is reached only
  through `play/api/src/blobs.ts`, which holds it to never failing play for a slow moment:
  - every call is given its time to answer and asked again, with a doubling wait, when it is slow, cut off or answers
    5xx / slow down (`steady`); a missing key, refused access or bytes not hashing to their name are not asked again;
  - every file is kept **twice**: in play's `blobs/` and, written through on every put, in the backups' store
    `BACKUPS/play-files/blobs/` (`PLAY_MIRROR_ROOT`). A file the first can't hand back whole (missing, cut short, not
    answering) is read from the second, checked against its hash, and put back into the first (`mirroredStore`);
  - files never change, so the ones handed out are kept in memory (`PLAY_CACHE_MB`, default 256; `cachedStore`).
- **An asset is its UUID; a recipe is its hash.** Versions, proposals, the catalog and the library's addresses
  (`#<uuid>[/<hash>]`) name an asset by its UUID; a group and slug are only shown, and can't be taken twice.
- **Every reference is a hash.** A build is `<hash>?values`. A sandbox names an asset by a slot of its pins,
  `pin:<sandbox>/<slot>`, which its config in the database maps to a build (`GET /api/sandboxes/<id>/config`). A card
  that names another asset names its build: the import rewrote every readable ref legacy's cards made (the biomes'
  cover kinds, the pickup's Power Cube) and a proposal that names one is refused. A version's number, an asset's id
  and a label are only shown.
- **One loader** (play/site's `content/assets/catalog.js`): hash → its record from `/api/catalog` → its file from
  `/api/files/<hash>`, held to the hash → the frozen box engine builds it. Media (covers, sounds) are play's files too.
- **A recipe names a piece by hash** (intent 5a15e468, Samuel 2026-11-07). A **piece** is readable source two or more
  recipes share (the car kit, a battery pack, the Power Cube), a document `piece:<uuid>` of its own schema
  (`schema:<SCHEMA.piece>`, seeded from `play/api/migrations/schemas/piece.json`: `{ schema: 'piece/1', label, note,
  source }`), made and changed like any document (`propose_doc_version` with `kind: 'piece'`, or an intent variant), its
  History in its document's History tab (`/pieces/`). It is a CommonJS module as written (no minified lines), requiring
  only three.js, three's addons and other pieces, at most 4 deep counted from the recipe, with no cycle. Each accepted
  version's source is kept among play's files by its BLAKE3 hash and listed in `play.piece_versions` (what it requires,
  how deep; frozen). A recipe requires it by that hash, `require('<64 hex>')`, and its manifest's `pieces` names it and
  every piece beneath it; `propose_asset` and `propose_doc_version` refuse a hash that is no accepted piece version's.
  Since the recipe names a hash, a frozen version always builds the piece it was accepted with, and a newer piece
  version is a new version of the asset. **The box resolves it** (`play/site`'s `content/assets/box/pieces.js`,
  `load.js`): before the build, from play's files alone (`/api/files/<hash>`, held to its hash, cached as every file
  is), handed into the worker as one script (the pieces, then the recipe file as it is), never from any other origin;
  the frozen engines are unchanged. A piece not held, a hash mismatch, a cycle, more than 4 deep, or one not in the
  manifest is refused, saying which. The asset viewer and the intents' board name a version's pieces (label, version,
  hash). The imported legacy sources are kept the same way in the repository (`play/api/import/legacy/sources/pieces`,
  each shared part once, every source rebuilt byte for byte to its hash).

### 4.6 A sandbox's layout, a document (Samuel 2026-11-04 and 2026-11-06)

A sandbox's layout is a document, **`sandbox:<uuid>`** (its UUID the sandbox's) of the schema `sandbox/1`
(`schema:<SCHEMA.sandbox>`, seeded from `play/api/migrations/schemas/sandbox.json`; what it can't say is its hook
`sandboxCheck`), versioned like every other ("Version control", `play/api/src/versioned.ts`): its `pins`
(each slot an accepted asset version by its hash, its `variant`, null for the version's default, and its `params`) and
its `configs` by name (Sandbox 1's `garden`: its plantings, spacing, drifts and fields; where a thing stands), anything in
a config with a `slot` drawn as that slot's pin; its `title` only shown. It changes **only by proposal**, never by a
migration or by hand: an agent reads it (`list_sandboxes`, `get_sandbox`: each pin's asset, version, the asset's newest,
its variant and values, and where a config names it; `doc_at` and `doc_history`, each version and edit with its pins by
their assets) and changes it by an intent variant, `doc_edit` and `propose_doc_version`, with the sandbox's own edit
helpers: `pin` (a slot to an accepted version, variant and values; a new slot too), `pin_latest` (every slot of an asset
to its newest version), `unpin`, and `set`/`delete` of any value at a path of a config ("update Sandbox 1's papayas to
v4", "move the hens", "weight the apples 5"), or a document's own edits by path. Each edit is checked whole: only
accepted versions, variants they have, no readable refs, every slot a config names pinned. The intents' board reviews it
through `Changes.svelte`: each pin before and after by its asset's label and version, the configs field by field, its
edits, and the sandbox to open as it would be (`/sandbox-1/?layout=<sandbox's uuid>/<intent>`, its config read with
`?intent=`, admins only). An admin's Accept merges it into Main as the layout's next version (an overlapping change
since its seed, or a pin play no longer keeps, archives it instead) and writes Main's pins and configs to
`sandbox_pins (sandbox_id, slot, version_id, variant, params)` and `sandbox_configs (sandbox_id, name, data)`, in one
transaction: the worlds read those (`/api/sandboxes/<uuid>/config`) as before. A sandbox's page has no Frame, so its
layout's **History** is at `/sandboxes/<uuid>/` (admins): its pins and configs at any version or edit, and the world
opened so (`?layout=<uuid>/v<n>` or `/e<seq>`, its config read with `?v=` or `?edit=`). Migration
`202611070115-d2f50bf1-sandbox-layouts` with `ensureLayouts` (`play/api/src/sandboxes.ts`, run at the end of
`migrate()` after `ensureSchemas`, since SQL can't write a Loro document; the changes kept meanwhile in
`play.sandbox_changes_kept`) made every layout its v1 (its pins and configs as they were) and every intent's sandbox change
(`sandbox_id`, `sandbox_base`, `sandbox_change`, `sandbox_diff`, now gone) an intent variant of it, each intent keeping
its stage, an accepted or archived one keeping what it changed as its variant's `review`. The import writes a
sandbox's pins and garden only while it has no layout document. Admins only for now (`play/api/src/sandboxes.ts`).

### 4.7 Every reference a UUID or a hash (Samuel 2026-11-04)

A thing is named by its UUID (a coop, an asset, a story, a sandbox, an intent, a human, a token) or, where it never
changes, by the BLAKE3 hash of its content (a file, a recipe, a version). A title, a label, a slug, a group or a route
is only shown: nothing is looked up by it, no row refers to it, and two things may share it.

- **Migration `0017-uuids`** moved what was still named by a readable id onto UUIDs, everywhere it was named: the coop
  (`maia-city`), the sandboxes (`sandbox-1`, `sandbox-2`, `sandbox-3`, `factories`) and the stories (their slugs), with
  the story documents (`story:<slug>` → `story:<uuid>`) and every step of their history. Each got the UUID
  `play.uuid_of('<kind>:<old id>')` (version 8, the first 16 bytes of SHA-256 over `play:<kind>:<old id>`; `uuidOf` in
  `play/api/src/uuid.ts`), so the repo names the same ones: `play/api/src/ids.ts` (the coop and the sandboxes),
  `play/site/src/lib/content/assets/sandboxes.js` (a slot is `pin:<sandbox's uuid>/<slot>`), each `story.json`'s `id`,
  `folds.json`, the kept history's folders (`import/history/<asset's uuid>`) and the animals' sounds (`sounds.json`).
- **Anything new gets a random UUID**: `propose_story` takes no id and answers with the story's; `propose_asset` needs
  a group and a label, its slug (the name its recipe is called with, `recipe(slug, v, variant)`) made from the label
  where none is given, and no longer unique. A story or a sandbox named by anything but a UUID is not found.
- **What stays a name, on purpose**: a version's number (`v3`, shown, given on accept), a slot of a sandbox's pins and
  a config's name (keys inside one sandbox's layout, like the fields of a record), a clip's or track's id inside a
  timeline, a variant's name, a draft's number. None of them is looked up across play.
- **Hashes made before stay as they were**: a version id is the hash of its content as it was made, and that content
  named its asset or story by what it was then (`plants/papaya`, `papaya-v2-devlog`); new versions name their story by
  its UUID. Nothing recomputes an old one.

### 4.8 The Factories on Loro (the `factory_version` work, Samuel 2026-11-04)

Every production line play shows is a Loro document, `factory:<uuid>` (a factory is its UUID, §4.7; the first,
the LifeTrac line, `uuidOf('factory:lifetrac-line')`, `play/api/src/ids.ts` `FACTORY`; type `factory/1`, a schema document, §4.15;
one kind of `play/api/src/versioned.ts`, §4.15): its **line** as AirSup's factory runtime reads it (the product, the demand, the calendar,
every station with its machine, cycle variation, buffer, spare floor, breakdowns, yield and what it joins, the stages'
looks, the floor's layout) and its **bill of process** (every part of what it builds with its raw stock and every
operation it goes through, at which station and for how many seconds; the stock it buys; the assemblies; each station's
own handling). Data only, nothing of it code: a station's cycle time is the sum of its operations and its handling,
worked out where the line is drawn (`play/site`'s `content/factories/index.js` `lineOf`), unless the station gives its
own `ct`, so changing a part's operation moves the line. `play.factories` holds each factory's id and
label so an intent's work can name it (migration `0018`). A factory's first version is made once from the repo by the deploy's import
(`play/api/import/factories`: the LifeTrac line as it was first written, 2026-11-03); from then on play's Postgres is
its source of truth.

A factory changes **only by proposal**, versioned as every kind is (§4.15): an agent reads it (`list_docs`, `doc_at` at
Main's newest version, a version, an edit or an intent's variant; `doc_history`), makes a change edit by edit
(`doc_edit`: the document's own edits, set, insert, delete, move and text, a list's item named by its index or by its
id, `{ id: 'weld' }`; each edit checked whole: every operation at a station of the line, every id once) and proposes
it (`propose_doc_version` with its `variant`), or proposes edits at once. The intents' board shows what it changes field
by field from its seed (`Changes.svelte`), its edits, and opens the factory as it would be
(`/factories/?factory=<id>&intent=<id>`), its simulation running. Accepting merges it into Main and names the next
version; seeded from a version that is no longer the newest, it still goes in where the two changes touch different
fields and is archived where they touch the same. The Factories page reads every version (`&v=<n>`) and every edit in
its History tab. Admins only, as the Factories are.

### 4.9 The Game editor (the `game_config_version` work, Samuel 2026-11-04)

The game's configs are Loro documents too, `game:<uuid>` (type by kind: `levels/1` first, a schema document, §4.15;
one kind of `play/api/src/versioned.ts`, §4.15), listed in `play.game_configs` (migration `0019`) and shown on the
**Game editor** (`/game-editor/`, a tile of the coop's own on the dashboard; admins only): on the left the configs, in
the middle the config worked out, on the right its History tab. The first, the **levelling**
(`GAME_CONFIG.levelling`, its v1 made once by the deploy's import, `play/api/import/gameconfigs`), is how a village
grows: a level at every Fibonacci count of villagers (1, 2, 3, 5 … 1,597), each unlocking what the village builds next
with its cost; every new villager brings €12,500 and 50,000 hearts, and an investor adds a multiple of the level's new
villagers' euros. A mind costs 10 hearts more at every level (or that in euros at 4 hearts a euro), so the page works
out (`play/site`'s `routes/game-editor/levels.ts`) the minds each villager and investor gets, the investor's share, the
minds minted, and the treasury after every level in euros (raised and left after building), hearts and minds. A config
changes only by proposal, as every kind does (§4.15): `list_docs`, `doc_at`, `doc_history`, `doc_edit`,
`propose_doc_version` over MCP; the intents' board shows it field by field and opens the Game editor as it would be
(`?config=<id>&intent=<id>`).

### 4.10 A plant's reference sheet, data sheet and brief (Samuel 2026-11-05)

A version may name its **reference sheet**: one clean-lit photographic plate of every stage and organ of the plant,
made for it (the plant skill makes it with Google's Nano Banana Pro) and kept among play's `files` like any image, in
the Library, labelled. The version's record holds it by its hash (`sheet`), set by the proposal (the card's `sheet`, set with `doc_edit`,
or `propose_asset`'s `sheet`: an image play keeps, else refused) and carried on from the head unless a proposal names
another, or `null` for none. The asset library shows each version's sheet beside its note, opened whole; the Library
shows, beside an image, every asset version that has it as its sheet (accepted, or an intent's work still at Proposal), linked to
the asset. The recipe names the same hash in its `meta.sheet`, so the plant and the plate it was checked against are
kept together.

Its **data sheet** (the researched numbers, every row with its source) and the **brief** its sheet was made from are
kept the same way, so a plant's whole dataset is in play and nothing of it only in the repository: each a Markdown
document among play's `files` (`text/markdown`, at most 2 MB, added with MCP `add_document` and a label), named in
the version's record (`datasheet`, `brief`: the card's fields of those names, or `propose_asset`'s, refused
unless a document play keeps; carried on from the head, `null` for none). The Library lists documents as their own kind
(never the recipe sources, `text/javascript`), opens one as its text, and names beside it every asset version that has
it as its data sheet or brief; the asset library links a version's data sheet and brief beside its note.

### 4.11 Worlds (Samuel 2026-11-05)

A **world** is an asset of the group `worlds`: the other assets composed into one place (the first, the Old City: a
section of an old city, the highway into it across monoculture land, its traffic, under a smoggy dusk). It is
versioned, proposed and accepted like any asset (§4.1–4.5); only accepted versions of what it names are drawn on play.
Its card is checked against card schema v2 (`card.v2.json`: v1 with the group `worlds`). The Worlds page (`/worlds/`,
`#<asset id>[/<recipe hash>]`) shows the one picked big, under its own sky, with three cameras (orbit; walk at 1.65 m;
drive at 1.2 m and 50 km/h) and the views it names.

**Its recipe builds its land** (terrain, roads and their markings, kerbs, pavements, field plots; root on y 0, 1 unit =
1 m) and **names everything else by hash**: a node `use:<recipe hash>?values` is drawn by the page with that build
there (`plantings.js`, the universal renderer's levels of detail and far pictures, so hundreds of guests cost a few
hundred draw calls), a mesh `biome:<recipe hash>` is painted with that biome's floor and cover. A biome's floor is read
off its card's catalog: the catalog play keeps (the imported biomes'), else, for a biome proposed over MCP (play keeps
no catalog for it, and never runs or trusts code to make one), the catalog its own build's card carries, the biome
built in the box on the page like any guest. A catalog part may name its asset by build hash (`<hash>?values`) in card
schema v2. A floor's rows (a tilled field's furrows, stubble, a crop sown in rows, its tramlines) run along the mesh's
own +x, or the way its name says: `biome:<hash> rows:<deg>` (degrees from world +x toward +z; `$content/biomes/surfaces.js`
`rowsOf`).

**How a world moves: its own build, kept running in the box** (decided 2026-11-05, over a trusted traffic runtime in
the page, so a world's behaviour is in its versioned recipe). The recipe sets `root.userData.tick = (t) => …` (engine
4 on): the box hands it the world's **time** t, in seconds since its run began (a quarter second more at most each
call; measured, 2026-11-05: not the time since the last call). It brings the world to t in fixed steps of its own,
counted (`while ((n + 1) * 0.1 <= t) step(0.1), n++`), seeded, so the world at a time is the same however it got
there: a film steps through a shot, the page goes frame by frame. Each step it moves its own `use:`
nodes (or their parents) and hides one by `visible = false`; the box sends back what changed, and the page moves each
guest where its node now stands (a hidden node's guest is put away). Lanes, car following, queues, red lights and
emergency vehicles are the world's own code. A world keeps its moving guests to about 400.

**A guest's state** is the empty child nodes of its `use:` node named `state:<name>`, on while visible: a vehicle's
`head`, `tail`, `brake`, `indicator-l`, `indicator-r` (blinked by the page), `beacon` (its blue and red flashed in
turn), `horn`, `siren`, `engine` and any other a sound is for; a signal's `red`, `amber`, `green` (all its heads) or
`<i>:<colour>` (head i, its heads in tree order); a street lamp's `lamp`. Where a guest has no state for it, head,
tail and lamp lights follow the mood's `lamps`; the rest are off.

**The guests name the parts the page lights**, each modelled dark (its lens off): `light:head`, `light:tail`,
`light:brake`, `light:indicator-l`, `light:indicator-r`, `light:reverse`, `light:beacon-blue`, `light:beacon-red`,
`light:beacon-amber` (a work vehicle's; all beacons flash on `state:beacon`, the red against the others), `light:sign`
(a shop's lit sign: lit always, unless its guest's `state:sign` says otherwise),
`light:lamp`, `light:window` (a building's window cells, lit at dusk: the cells fall into four sets in their order and
each copy lights some of them by its seed), and a signal head's `lamp:red`, `lamp:amber`, `lamp:green`, one set per
head. The name is on the mesh itself or on a group holding it: every mesh under a named group is that light. The page
draws each lit light over its copy, bright and with its glow, copy by copy (`$content/worlds/lights.js`), never
touching the guest's own drawing. Node names survive the box to 120 characters. Later, not yet driven: wheels as
groups at their hubs `wheel:fl|fr|rl|rr` (spun about local x from a guest's speed), and a guest's sub-node turned by
the world (a semi-trailer swinging at its kingpin).

**Its mood** is a root node `mood:<preset>?k=v` (presets `smog-dusk`, `overcast`, `clear-day`, `night`, and `indoor`: no
sky, sun or fog, a flat soft light from everywhere, lamps and signs lit; keys `sun` and
`az` in degrees, `fog` a density a metre, `haze` a hex colour, `lamps` 0 or 1): the sky dome, the fog in the haze's
colour, the sun and the sky's light (`$content/worlds/sky.js`); `fog` is the density in the street, thinned with the
eye's height to a third of it from 300 m up (smog lies low: a crane shot over a city still reads its blocks). Keys `shadows` (1: the sun casts them; a clear day's preset does, smog, overcast and night do not: under
them there is no sun to cast one, and each caster would be drawn twice). **Its sound** is root nodes
`sound:<file hash>?for=<x>&gain=<g>`, recordings among play's files: `for=bed` the ambient loop; any other plays at
each guest whose `state:<x>` is on, panned and fading with distance (`horn` once each time it comes on, the rest looped
at the nearest few; `$content/worlds/sound.js`). **Its views** are nodes `view:<name>`: an eye where it stands, looking
along its +z.

**Filmable** (Samuel 2026-11-05): the Worlds screen is where a virtual film camera will fly through a world and render
shots for the films, so a world keeps to the film contract the sandboxes keep (`sandbox-kit/film.js` `connectFilm`,
`render/film.js`, `film/pipeline.js`; a shot as data, `game/film/shot.js`): its traffic and lights run on the shot's
clock, deterministic from its seed (a world's tick is seeded and its own clock is the sum of its steps, so a shot
stepped from 0 renders the same every time), and a shot names its world by the world asset's UUID and its version's
recipe hash (`world: { sandbox: 'worlds', asset, recipe, … }`, checked by `shot.js`; its film page
`/worlds/?film&asset=<uuid>&recipe=<hash>`, `$content/worlds/film.js`). There, each frame the world is brought to the
shot's moment (forward by its steps, back by building it afresh and stepping from 0), `window.__world.settle()`
resolving once the box has answered for it (every step of a jump of any length awaited as the box answers it, given
up only when the box stops answering; while a film holds the world, the page runs no clock of its own); a shot's camera may ride in a node the world names `frame:<name>` (a seat
in a vehicle, under its `use:` node), and scale its `sun`, `sky` and `lamps`. The frozen box engines run a build on by at most 0.25 s a
step, so the page sends a world its time exactly, 0.25 s at a time, owing the rest (a machine's time it lets go of
instead); a world in the box and the same recipe run in Node at the same t stand alike, guest for guest (checked).

**Developing a world** before its guests are accepted: `scripts/render.mjs --world --file <world.js> --guests
<guests.json>` runs it on the world bench (`/worlds/bench/`, development only) exactly as the Worlds page does, each
guest a local readable source put in place of the hash the world names it by (`as`), even one play holds (a new
version, before and after; with `--play` every guest not handed in is play's own), and shoots stills after the
world has run (`run`) from eyes, views or street cameras. The stand-in test world and its guests are
`$content/worlds/test/` (the template of the contract); the contract is read in one place,
`$content/worlds/contract.js`.

### 4.12 Intents (Samuel 2026-11-06; the Inbox and Specify before, 2026-11-05)

Everything Maia City wants made, fixed or improved is an **intent**. An intent goes through stages, the board's
columns: **Idea → Specify → Build → Proposal → Ship → Accepted** (or **Archived**). Idea is it
as it came; Specify is its spec written, waiting for an admin's approval; Build is the whole round of making it, an
agent building and checking until the spec is met (any intent an agent is working on is in Build); Proposal is its
work done and checked, waiting for the decision: an intent moves there **by itself** the moment every must check has
passed (Samuel 2026-11-06), so after the spec's approval there is one gate with a person in it, the decision at
Proposal, and none in Build. **Ship** (Samuel 2026-11-06) is an intent of code accepted and on its way to
production: its Accept merged its pull request into main, and the board shows each step of the way live until it is
in production (Accepted) or a step is red (back to Proposal with the report): *Accept ships it*, below. Each column folds away to a strip and opens again, each viewer's own choice
kept in their browser; Accepted and Archived are folded at first.

**One record, the intent** (Samuel 2026-11-06: *"proposal and intent are the same!! not different, merge, DRY"*, and
*"not a proposal belongs to an intent: the intent has a state, proposal. Do you see the difference?!"*). There is no
proposal beside an intent: **Proposal is a stage of the intent**, its work done and checked, waiting for the decision.
The work it brings, when it is work of play's (an asset's or a story's version, a sandbox's change, a factory's or a
config's version), is on the intent itself: what it changes and its refs, the base it was made on, the version it would
be (or its edits), its intent variant of the document it changes (`doc_id`, `doc_variant`, §4.15), what it says of
itself, who proposed it, how and when. An intent at Idea, Specify or Build has no work yet, or work in progress (an
open intent variant, `doc_edit` …); one whose work is code holds none of play's: its work is its pull request.

**The spec is the gate**, as a test is in test-driven development: it says what is wanted so that it can be checked,
and the same checks decide when the work is done. A spec is a **goal** (what is true once it is done, in a sentence), a
**scope** (what changes, named by UUIDs, hashes or paths, and what stays as it is) and 1–12 **checks**, each ONE
statement that passes or fails, checked one of three ways: a **test** (a command that passes), a **measure** (a value
and its range, read with a named tool) or a **look** (a comparison with a named reference: the subjective made
explicit), and each **must** (it holds the intent back from Proposal) or **nice** (it does not). The checks are ids
`c1…cn`.

**Reduce first, then the MVP** (Samuel 2026-11-06, Musk's algorithm made ours). A spec is written in two steps, in that
order. **Reduce**: what the intent removes, simplifies, consolidates or compacts where it works before it adds anything
(legacy glue gone, scattered concepts merged into one interface, fewer dependencies, less code, fewer indirections), so
play's architecture gets better with every intent instead of only bigger; each reduction is a check of step `reduce`,
always a must, so Proposal's gate holds it as it holds the MVP, or, where truly nothing is to be reduced, the spec's
`nothing_to_reduce` says why, which the admin accepts with the spec. **MVP**: the goal, the scope and the checks of step
`mvp` (the default), what is done at its smallest. `specify_intent` refuses a spec without its reduce step, and an
admin's approval refuses one at Specify (a spec from before the step): it is specified again first. Intents already in
Build or later are not held to it. The board shows a spec's Reduce above its MVP.

```sql
intents (id UUID, coop_id, kind /*idea|fix|improve: shown as Make, Fix, Improve*/, title /*only shown, 1–200*/, note,
         stage /*idea|specify|build|proposal|ship|accepted|archived*/, author, via /*web|mcp*/, created,
         spec jsonb /*{ goal, scope, checks: [{ id, check, how: test|measure|look, by, run, must, step: reduce|mvp }], nothing_to_reduce }*/, specified_by, specified_at,
         approved_by, approved_at /*the spec approved: Build and on need it, unless it came with its work*/,
         results jsonb /*each check's last result in Build: { "c1": { pass, evidence, by, at, where: avenBOX|main, commit } }*/, decided_by, decided_at,
         -- its work (0029-one-record): none, or one kind of work and the refs of that kind (intents_work_names_what)
         work /*<kind>_version of a versioned kind: asset, story, factory, game_config, skill, sandbox*/,
         asset_id, base → asset_versions, version → asset_versions,            -- an asset's version
         story_id, story_base → story_versions, story_version → story_versions, -- a story's version
         factory_id, game_config_id,                                          -- a factory's, a config's version
         doc_branch → doc_branches /*its branch of the document it changes*/,
         work_note, proposed_by → humans, proposed_via /*web|mcp*/, proposed_at,
         came_with → intents /*where it was one of several proposals of one intent before 0029*/,
         -- its code (0030-ship): its pull request into main, and its way to production once an Accept merged it
         pull_request /*its number*/, ship jsonb /*{ pr, head, merge, by, round, started, steps: [{ key, name, state:
           queued|running|green|red|skipped, started, finished, link, note }], report: { step, why, link, log, at },
           outcome: green|red, ended, again: main|release, main_run, release_run, deploy_run, past,
           live, commit, note /*the reconcile's: its merge in what play runs, that commit, how it was Accepted*/ }*/)
doc_variants.intent_id → intents        -- the intent an intent variant was proposed as (kept when newer work replaces it)
```

- **Agents, over MCP only** (`play/api/src/intents.ts`): nothing is typed in by hand. An admin's agent adds an intent
  (`add_intent`, at Idea) and specifies it (`specify_intent`: its goal, scope and checks; to Specify, its spec replaced
  if specified again, only at Idea or Specify), then stops: **an admin approves the spec** (Specify → Build). An agent
  that finds a spec wrong sends the intent **one stage back** itself, always with its reason (`step_back_intent`,
  `play/api/src/stepback.ts`; intent 5a78e0b7, Samuel 2026-11-07: "never a manual button, to self-serve"): from Build,
  or Proposal with no work of play's waiting, to Specify (its spec kept, its approval and results cleared), or from
  Specify to Idea (its spec dropped, its whole text kept in the history); refused at Idea, at Proposal while work of
  play's waits, in Ship, Accepted and Archived. Each step back is kept on the intent (`steps`, migration
  `0036-step-backs`: when, who, from which stage to which, the reason, the spec it dropped) and shown on the board
  under its note. Only an admin's Approve spec moves it forward again: until then no check is recorded, nothing is
  proposed for it. In
  Build the agent builds it, runs each check as its spec says and records every result with its evidence
  (`check_intent`: a failure as a failure), until every must check passes: then the intent moves to **Proposal by
  itself**. Checked again at Proposal (only while no work of it waits there), a must that fails takes it back to
  Build. **Work of play's is proposed in Build and waits there** (intent `94061718-2412-4356-9c72-f82a7ac75479`,
  Samuel 2026-11-07: 33266de8 was accepted holding 1 of its 23 documents): work of play's (an asset or story version,
  a sandbox change, a factory, a config, a skill) is proposed with every propose tool's `intent`, the intent's UUID;
  play takes it for an intent in Build or at Proposal (`intentReady`; at Idea or Specify it is refused), whatever its
  checks. Work proposed in Build waits on the intent: it stays in Build, working ("n documents proposed, its checks to
  pass") and not decidable, and **moves to Proposal with all of it at once when its last must check passes**, so an
  Accept always takes every document its builder proposed; one whose musts all pass already moves to Proposal with it
  at once. A builder proposes everything first and records its checks last. Rejected in Build, its work is archived
  with it. **New work for the same intent replaces
  its work**: the earlier one's branch is closed, its steps kept as a side line, its version kept unnumbered in the
  DAG (`play/api/src/work.ts` `putAtProposal`). Every propose tool gives back the intent (`intent`, and its `stage`:
  `build` while its work waits there, else `proposal`).
  Other work (code) holds none of play's: its work is its pull request into main, which the agent opens and names
  (`check_intent`'s `pr`, `intent.ts --pr`) and **never merges**: an admin's Accept merges it (*Accept ships it*,
  below). `list_intents` (the open stages, or one stage, or all; `work`, one kind of work) and `get_intent` (one whole,
  its work and its work's review) read them. No tool approves, accepts or rejects an intent; an agent archives only its
  own intents at Proposal that it put there over MCP (`archive_intent`: its work proposed over MCP, or, with no work,
  the intent added so), one it no longer stands by.
- **Checks run in avenBOX, and again on main** (Samuel 2026-11-06; intent `8888e140-a6e4-4472-b1db-e78692db5c4a`).
  **avenBOX** (one word, `aven` lowercase and `BOX` in capitals) is the cloud environment the agents build in
  (`env_011Zm65erarH7ffXio13u5pG`), and the box is built the same way wherever a check runs, by `play/avenbox/`:
  `setup.sh` (as root, once per container: PostgreSQL 17, CI's major, its cluster on 127.0.0.1:5432 with the
  `postgres` role's password `play`, every part's dependencies; idempotent, it never fails a session), `up.sh` (in
  every session, from the SessionStart hook in `.claude/settings.json`: Postgres started, `TEST_DATABASE_URL =
  postgres://postgres:play@127.0.0.1:5432/postgres` set, the dependencies brought up to their lockfiles) and `gate.sh`
  (what CI runs, red when a play/api test is skipped). **All work on play starts in an avenBOX session** (Samuel
  2026-11-06; intent `7cd4c779-9d7a-4ba0-8060-6b2697545886`): an intent at any stage, its code and its checks are done
  there, the only environment with play's MCP token and the box; a session elsewhere, without play's MCP (no
  `PLAY_MCP_TOKEN`), starts a session on avenBOX with the work's brief and hands it over, building, pushing and
  recording nothing itself (the SessionStart hook says so as such a session starts, after `up.sh`; never `up.sh`
  itself, which every check run calls); one intent has one builder session. So every check is a
  command:
  - each test and measure check carries its **`run`**, the exact command that decides it in avenBOX, from the
    repository's root, as written: a test passes when it exits 0, a measure prints its value and exits 0 only in its
    range. play refuses a test or measure check without one, and a `run` that holds a placeholder outside quotes
    (`…`, `...`, `<something>`, `TEST_DATABASE_URL` given a value), saying which check (`placeholderIn`). A look may
    carry the command that makes what is looked at. Specs from before keep their checks without a `run`.
  - in Build, **`bun play/avenbox/intent.ts <intent> --record`** reads the intent over MCP, makes the box ready,
    runs every check's `run` (no run sees `PLAY_MCP_TOKEN` or GitHub's tokens), prints each result and records the test
    and measure checks with `check_intent`: pass by the exit code, the evidence the command, its exit code, where it
    ran, the commit, Postgres's version and the output's tail. A look is judged by eye and recorded by hand.
  - each result says **where** it ran (`avenBOX`, or `main`) and on which **commit** (results `{ pass, evidence, by,
    at, where, commit }`), shown by its mark on the board (*avenBOX*, *main @ 1a2b3c4*), each check's `run` as code
    under its `by`.
  - **what is merged is what was checked.** Code goes by pull request into main, its commits naming the intent (the
    trailer `Intent: <UUID>`), its checks recorded on the pull request's head by its run in avenBOX on GitHub
    (`.github/workflows/intents-pr.yml`, below): an Accept merges it only when every must check with a `run` last passed on that head (`unmetOn`). Once
    merged, **`.github/workflows/intents.yml`** (*intents on main*; also by hand, an intent's UUID, on main's head)
    builds the same box on GitHub's runner (`sudo bash play/avenbox/setup.sh`) and runs `intent.ts <intent> --record
    --where main` on the merged commit, with the repository secret `PLAY_MCP_TOKEN` (an admin's access token). It
    records and never blocks: production's jobs read only main.yml's checks (`.github/actions/main-green`). main's results are a
    **confirmation**, taken in any stage once the spec is approved: in Build or at Proposal they move the intent as
    any result does, in Ship, Accepted or Archived they are kept and move nothing. Intents whose work is play's keep
    their gate (`intentReady`).
- **Every pull request names its one intent; only the box's run is evidence** (Samuel 2026-11-06; intent
  `4ea6b2ed-f96a-4bf6-83fd-4d165a793194`). Intent `c9113886` was decided on checks run on a Mac (Postgres 15, a bun
  fetched by hand) recorded as avenBOX's, and marked `+dirty` only by a per-user file; so every result an admin decides
  a code intent on now comes from avenBOX itself, on the pull request's head, before Accept, whatever machine the agent
  works on.
  - **One intent, one active pull request.** Every pull request into main is the work of exactly one intent: its title
    shows the intent's first 8 characters, `[c9113886] …` (only shown), its body and its commits carry the full UUID on
    the line `Intent: <uuid>`, which is what everything reads (`.github/pull_request_template.md`). An intent has
    **one active pull request**: the one named on it (`pull_request`). The required check **Intent named**
    (`.github/workflows/intent-named.yml`, `play/avenbox/pr-intent.ts`, main's own on `pull_request_target`, the pull
    request only read through GitHub's API) is red when a pull request names no intent or more than one, names one not
    at Build, Proposal or Ship, or is not the intent's active one while that one is open, saying which to
    consolidate into, or to close this one. main's ruleset requires it beside `play / API and site`, `website / build`
    and `Intent accepted`.
  - **A draft while building; ready promotes to Proposal.** While the intent is in Build its pull request is a
    **draft**, and the agent tests itself anywhere, untrusted: `bash play/avenbox/gate.sh`, and `bun
    play/avenbox/intent.ts <uuid>`, which runs and prints the checks and records nothing (`--record` refuses outside a
    GitHub run). **Marking it ready for review** runs **`.github/workflows/intents-pr.yml`** (*intents on pull
    requests*): the intent's checks in avenBOX on GitHub (`play/avenbox/setup.sh`, PostgreSQL 17, bun 1.4.4) on the
    pull request's head, recorded on the intent with that head, the run's link and `pr` (so it becomes the active pull
    request). Every must green: the intent moves to Proposal. Any must red: it stays in (or goes back to) Build with
    the failures, failed on the board, its pull request as it is: fix and push. Each new push to a ready pull request
    (play's main-merge included) runs and records again on the new head, so Accept merges only a head every must
    passed on (`ship.ts`, unchanged); the older head's run is cancelled (`concurrency`) and its record skipped
    (`!cancelled()`): it records nothing and is not red. Looks are still judged and recorded by hand (`check_intent`).
  - **Only the box's run is evidence.** intents-pr.yml runs on `pull_request_target`, for heads in this repository
    only, in three jobs: **spec** (main's `pr-intent.ts --id` and `intent.ts <uuid> --spec-out`, with avenBOX's token),
    **run** (the head checked out with `persist-credentials: false`, no secret and a read-only `GITHUB_TOKEN`; main's
    intent.ts, handed over by spec, runs the spec's checks with `--from <spec> --results-out <file> --root <head>`) and
    **record** (main's `intent.ts <uuid> --record-from <results> --pr <n> --head <sha>`, with avenBOX's token, refusing
    results of another intent or another commit; `contents: read` only, skipped when the run is cancelled). The workflow and
    the intent.ts that hold a token are always main's. **avenBOX's token** is an admin's access token marked so on
    play's profile page (`play.api_tokens.avenbox`, migration `202611070145-4ea6b2ed-avenbox-token`; `POST /api/tokens/<id>/avenbox`), the repository
    secret `PLAY_MCP_TOKEN` that intents-pr.yml, intent-named.yml and intents.yml hold. From any other token
    `check_intent` refuses a pull request named and every test or measure result that could decide a code intent (on a
    commit, on main, or once its pull request is named), saying the pull request's run records them; a result recorded
    by the box is marked `box` with its run's `link`. Work of play's own (no pull request, no commit) records as before.
  - **Dirty.** `.gitignore` ignores `.claude/settings.local.json`, the per-user file the Claude app writes; a dirty run
    names the files that made it dirty (`commit 1a2b…+dirty (a.ts, b.ts)`).
  - Later: work of play's own, proposed with `intent`, would dispatch the same box run on main's head.
- **Accept ships it** (Samuel 2026-11-06: *"only the manual accept should directly trigger the flow … it should
  instantly start the merge into main and prod"*; intent `d29933ff-3636-4148-8df7-c183c6065216`). The intent flow is the
  one authority over what lands on main and goes to production, and GitHub requires it.
  - **Accept and ship** (admins, at Proposal, an intent whose work is code: its pull request named;
    `play/api/src/ship.ts` `acceptAndShip`). On the press, play reads the pull request with `SHIP_TOKEN` (a
    fine-grained token of Samuel's, the repository secret written into play's environment; deploy/README.md).
    **Accept takes only a waiting intent** (*Sub-states*, below; Samuel 2026-11-07, intent `2bf8af96`: *"if an
    intent is still working / waiting on main merging we can't promote accept it"*): its head the commit every must
    check with a `run` last passed on, `play / API and site` and `website / build` green on that head, `mergeable`
    true, open into main, not a draft. Anything else is refused with its reason, nothing posted or merged, the intent
    left at Proposal: failed (a conflict, a red check, closed, a draft) or working (its head moved, its checks running,
    `mergeable` null). Taken, the intent is in **Ship** at once (Samuel 2026-11-06, intent `2f13976c`: *"ship should
    self queue smartly"*), decided by the admin, its first step **Ready to merge** waiting with its reason, shown on its
    card and in its dialog:
    - *Queued · behind \<title\>*: **one ship at a time, in the order accepted**. An intent waits behind every ship
      accepted before it until that one is Accepted or back at Proposal.
    - *Waiting for #N's checks* or *Waiting for GitHub to work out whether #N merges*, where GitHub changed while it
      waited its turn (read again then).

    When its turn comes and GitHub is ready (`startIfReady`, from Accept itself and from the watcher, one decision at
    a time under a lock), play posts the commit status **`Intent accepted`** on that head and merges the pull request
    (a merge commit, that head's sha): *Ready to merge* and *Merged into main* go green. First in line and ready, that
    happens within Accept's own request. While it waits, a required check turning red, the head moving, a conflict,
    the pull request closed, GitHub refusing the merge (the status posted back as failed) or **30 minutes** first in
    line without GitHub or its checks ready takes it back to Proposal with the report, nothing merged; waiting its
    turn has no limit. An intent with no pull request named is accepted on its checks, straight to Accepted, as
    play's own work is, unless its code is on main by its trailer: then the reconcile accepts it once play runs it
    (below).
  - **The ship watcher** (in play-api, every 10 s, `startShipWatcher`; its state is the intent's `ship` in Postgres, so
    it goes on after a restart) reads GitHub's Actions for the merge commit: **main's checks** (main.yml's run for the
    push), the **release** (release.yml's run named `release <sha>`), and the **deploy** (production.yml's run on the
    commit and its jobs *The image* and the **backup** (*The backup*) side by side, then *The server*, with *The
    website* beside them). Each step is kept on the intent as it changes: queued, running, green, red (skipped
    where a job did not run), when it started and finished, its link. A step whose run has not begun 15 minutes after
    the one before it is red.
  - **All green: ended in Ship**, its steps and links kept, until the reconcile finds it live (below; it holds no
    ship behind it up). **Any red: back to Proposal** with the **ship report**: the
    failing step, why, its link and the last 60 lines of the failed job's log (fetched from where GitHub points,
    without the token). From there an agent fixes it (a new pull request of the intent, named with `pr`, its checks
    recorded on its head) and Accept ships that one; or, its pull request merged already by a ship of it, **Ship
    again** runs main's failed jobs again (a red on main) or the release of the commit last merged (a red release or
    deploy), waiting its turn like any ship (*Ready to run main's checks again*, *Ready to release again*), and it is
    in Ship again (`round` 2, 3 …), the earlier round's runs never this one's.
  - **Accepted exactly when it is live: the reconcile** (Samuel 2026-11-07: *"ensure that our intents' state is always
    coupled correctly to its shipped state"*; intent `9876ef00-70dd-4b64-8bad-c43e7a33993b`; `play/api/src/ship.ts`
    `reconcile`). play knows the commit it runs: production.yml builds the image with it (`--build-arg
    PLAY_COMMIT=$GITHUB_SHA`), and **`GET /api/version`** answers `{ commit }` to anyone (`/api/health` stays `{ ok:
    true }`). The reconcile is **the one place a code intent becomes Accepted**: a code intent is one with no work of
    play's that names a pull request, or whose trailer `Intent: <its UUID>` is on a commit of main; its merge commit is
    its ship's, else GitHub's for its pull request (merged by hand), else its commits on main. Against the running
    commit (main's and its history read with `SHIP_TOKEN`):
    - its merge commit is in it (an ancestor, or itself) and it is at Build, Proposal, Archived, or ended in Ship →
      **Accepted**, its `ship` saying how (`live: true`, the `commit`, the `note` "Live at …: Accepted by the
      reconcile"); a ship still waiting or running is the watcher's;
    - it is Accepted (or ended green in Ship) and its merge commit is not in it (rolled back, closed unmerged, never
      deployed) → **flagged**, `ship.live: false` with the running commit, its stage left alone: no one's decision is
      undone by a machine. The board says *not live: production runs \<commit\>* on its card and in its dialog. Once
      play runs it again, the flag clears.

    It runs once as play starts (a deploy, a rollback by `restore.yml`, a deploy by hand: each starts play anew) and
    whenever a ship ends in the watcher's look. An admin's Accept on an intent with no pull request named whose code
    is on main by its trailer is the reconcile's too (`acceptCode`): Accepted at once if play runs it, else refused,
    saying it is Accepted by itself once production runs it; an intent with no code and no work of play's is accepted
    as before (`decideIntent`), and play's own work straight to Accepted, its version applied in the same transaction.
    **`bun play/avenbox/live-audit.ts`** checks the same from outside: the commit from `/api/version`, every intent over
    MCP, main's history from git; it prints every mismatch and exits 0 only with none.
  - **Main merged into open pull requests by play** (Samuel 2026-11-07: *"This merging main conflicts steps should be
    also automated right?"*; intent `f28822d9-6ef1-49d9-aa2c-e52f1897ee89`; `play/api/src/mainmerge.ts`). No one merges
    main into an intent's branch by hand: a pull request behind main is play's to update, only a real conflict is a
    person's or its builder's. Each tick of the watcher, after it has read the open intents' pull requests, it reads
    main's head and looks at every intent in Build or at Proposal whose named pull request is open into main:
    - **mergeable and behind** (GitHub's compare: main's head not in the branch): play calls GitHub's
      **`update-branch`** (`PUT /pulls/<n>/update-branch`, `expected_head_sha` the head it read), once per head and main's
      head, under the intent's row (an Accept pressed meanwhile waits and finds it moved). It is a push made with
      `SHIP_TOKEN`, so GitHub runs the required checks and the box's run (`intents-pr.yml` on `synchronize`) records the
      intent's checks on the new head: **working**, *main merged in: its checks run on \<head\>*, until every must is
      recorded on it, then **waiting** again. A builder's push in between makes GitHub refuse it (422): nothing is done,
      the next tick reads the new head first. Kept on `pr_seen` (`main_merged`).
    - **in conflict** (`mergeable` false): **failed**, *conflicts with main: \<files\>*, the files changed both on the
      branch (`GET /pulls/<n>/files`) and on main since their merge base (`GET /compare/<base>...main`), in Build too.
      play posts the commit status **`Merges with main`** (`failure`, that line, the intent's link) on its head, once per
      head and line, and `success` once it merges again; not a required check. A builder session subscribed to its
      pull request (`subscribe_pr_activity`) is woken by that status as a PR event.

    Never an intent in Ship, Accepted or Archived, never a pull request into another branch or naming no intent, never a
    merge into main or production. Ship itself (its queue, steps and re-read at its turn), the reconcile and how checks
    are recorded stay as they are.
  - **production follows main** (`.github/workflows/release.yml`): once main.yml is green for a push to main, or by
    `workflow_dispatch` with a sha (Ship again, or by hand), it moves `production` to that commit, fast-forward only,
    with `GITHUB_TOKEN`, and starts `production.yml` on it (`workflow_dispatch`; a push by `GITHUB_TOKEN` starts no
    workflow). One release at a time (`concurrency: release`). It reports nothing to play: the watcher reads it.
    Every job of production.yml reads main's checks for production's own commit as its first step after the checkout
    (one shared action, `.github/actions/main-green`), so *The image*, *The backup* and *The website* start together,
    and *The server* needs the image and the backup: nothing on the server changes before play is backed up (intent
    `5ab64b8e-f0b6-4688-9621-b38b0e665585`: merge to live in at most 90 s). production moves only by this fast-forward;
    no pull request into production is taken. On that push, main's checks pass without running again only when the
    pushed tree is the very tree the merged pull request's run of main.yml tested (`.github/workflows/tested-tree.sh`,
    from GitHub's API); anything else runs them in full.
  - **GitHub requires it**: one repository ruleset on main, with no bypass: a pull request (0 approvals), the status
    checks `play / API and site`, `website / build` and **`Intent accepted`** (only play posts it, on Accept), no
    force pushes, no deletion. Agents open the pull request and **never merge**, into main or production.
  - What it does not stop: someone acting as Samuel on GitHub on purpose (agents act as him there). It stops every
    change landing without his Accept by mistake. `SHIP_TOKEN` never leaves play's server: no route answers with it,
    no page holds it, no log names it; play only calls GitHub's API, no proposed code runs on its server.
- **Intents depend on intents** (Samuel 2026-11-06: *"this intent can only be started or continued if that other
  intent is shipped … fully generically"*; intent `420ee348-132f-4b04-a67d-082ae8b72efc`). An intent may name the
  intents it **depends on**, each by its UUID, of any kind and any work: one relation, `play.intent_depends (intent_id,
  depends_on, by, at)` (migration `0037-intent-depends`). No edge to itself and no cycle: an edge that would close one
  (the chain from the one depended on walked back) is refused, so chains and diamonds of any depth hold. While any
  intent it depends on is not **shipped** (at the stage Accepted: in Ship is not yet, and an archived one holds until
  the edge is dropped or it is reopened and shipped) it is **held**: `heldBy` (`play/api/src/intents.ts`) gives those,
  read live, never stored, direct ones only (each is held by its own).
  - **One forward gate**, `mayMove(intent, to)` (`play/api/src/intents.ts`), decides every forward move: approve
    (Specify → Build; never held, Samuel 2026-11-07: an approved intent whose dependencies aren't shipped waits in
    Build, idle, its brief null, check_intent refused with the held text, main's confirmations still taken), Build →
    Proposal on its checks, work proposed for it (`intentReady`, `play/api/src/work.ts`
    `putAtProposal`), accept, its work accepted (`play/api/src/versioned.ts` `decide`), Accept and ship and Ship's turn
    (`play/api/src/ship.ts` `acceptAndShip`, `startIfReady`). Each move's stage rules, its must checks and *held* are
    rules inside it; no path tests the stage on its own, and every refusal names the intents it waits for (UUID, title,
    stage). Going back (`step_back_intent`, reject, reopen, `archive_intent`) and specifying are never held, so a whole chain is
    specified up front.
  - **Ship's queue**: Accept refuses an intent whose dependency is not in Ship; one whose dependency is ahead of it in
    Ship waits (its first step says it waits for that one to ship) and merges only once that one is Accepted; that one
    going back to Proposal takes it back too, its report naming it.
  - **MCP**: `add_intent` and `specify_intent` take `depends_on` (UUIDs; specify's replaces those before),
    `depend_intent { intent, on, drop? }` adds or drops one edge (an admin's agent's only, as every tool); `list_intents`
    and `get_intent` give `depends_on` (each with its stage), `held_by` and `needed_by`. On the board, each card shows
    what it waits for and what waits on it (titles only shown, each opening that intent by its UUID), a held card
    striped and marked *Held*; the intent's dialog lists them with their stages.
- **Sub-states** (Samuel 2026-11-07; intent `2bf8af96-5708-42d2-8556-da35f3f805ba`): every open intent is one of
  failed, waiting, working or idle, with a tag and its reason (`sub: { state, tag, why }` on `list_intents`, `get_intent`,
  `GET /api/intents` and `/api/intents/<uuid>`; null once Accepted or Archived; the tag at most 32 characters, the
  dialog's chip *<State> · <tag>*, the reason below its title and on the card, checks named by id only: intent
  `2052a88c`), said by one pure function,
  `subStateOf` (`play/api/src/substate.ts`), first match wins. **failed** (a person is needed): Ship red (back at
  Proposal with its report, until its checks are recorded again or another pull request is named), a must check whose
  last result failed, its pull request in conflict with main (*conflicts with main: \<files\>*, in Build too: *Main
  merged into open pull requests by play*, above), red, a draft, closed or not into main. **waiting** (a human
  gate): at Specify a spec with its reduce step (*Approve spec*, held or not); at Proposal work of play's (*Accept*), or
  code whose pull request's head is the one every must check with a run last passed on, mergeable, its required checks
  green, not a draft, not held (*Accept and ship*). **working** (an agent, GitHub or Ship busy): in Build; code with
  main merged in by play whose checks run on its new head (*main merged in*); code whose head moved past the checked commit, whose required checks run, whose mergeability GitHub hasn't worked out, or whose
  pull request was read more than 60 s ago (*reading #N on GitHub*); in Ship on its way. **idle** (nothing moves until
  something else does): held by a dependency (*held: waits for …*), in Ship queued behind another, an Idea. What GitHub
  says is read by Ship's watcher every 10 s into the intent's `pr_seen` (head, draft, mergeable, the required checks,
  when), so the board's request asks GitHub nothing. **Only a waiting intent is decided**: Approve spec and Accept, on
  the board and on the server (`decideIntent`, a work's `decide`, `acceptAndShip`, each 409 with the reason), the one
  exception a red ship after its merge, which Accept ships again; Ship's turn reads GitHub again (`startIfReady`, the
  same checks). The board groups each column's cards under the dividers Failed, Waiting, Working and Idle, in that
  order, each with its count, empty ones left out, each card's reason its one status line.
- **No work without an intent** (intent 706ed873; Samuel 2026-11-07): every propose path (every `propose_*` tool,
  `add_artifact`, `update_artifact`, `doc_edit` and `POST /api/intents`) requires `intent`, one in Build or at Proposal,
  and refuses otherwise: without one (400, naming `add_intent` and `specify_intent`), or one at another stage (409, by
  the one gate, `mayMove`'s work), nothing is written. `add_intent` is the only way an intent comes in, so every intent
  with work has an approved spec, and Postgres holds it: an intent in Build, at Proposal or in Ship has a spec (the
  constraint `intents_specified`, migration `202611070300-706ed873-intents-specified`). The one exception is an
  artifact's: `add_artifact` and `update_artifact` without `intent` make their own (*Auto-accept rules*, below), so
  even that work is an intent's.
- **Auto-accept rules** (intent `de24f1c5-3f5d-47fb-a630-981d95534d44`; Samuel 2026-11-07: *"Rules that we set on
  allowed for specify specs intent types or proposal accept state intents, that can get auto accepted and need no
  HITL … only changeable via HITLs and also version controlled"*). One rule set, **`rules:<uuid>`** (`RULES`,
  `play/api/src/ids.ts`) of its own schema `schema:<SCHEMA.rules>` (`rules/1`, seeded from
  `play/api/migrations/schemas/rules.json`), a kind of `play.records` alone, versioned like every document (§4.15): its
  Main is the rules in force, its v1 made at migrate's end where absent (`ensureRules`, `play/api/src/rules.ts`), every
  later version a person's Accept of an intent variant (`doc_edit`, `propose_doc_version`). Admins read it on `/rules/`,
  its rules in order and its History tab.
  - **A rule** is `{ id (UUID), label (only shown), gates: approve and/or accept, match, reason (only shown) }`. At a
    gate it names, it matches when every field it names holds (a list: any of its values): for both gates `kind`,
    `via`, `author` (humans' UUIDs) and `work_kind` (every kind the intent declares is one of these); at accept also
    `proposed_by`, `proposed_via`, `schemas` (every document its work changes is of one of these), `code` (its work is
    a pull request), `new_only`, `max_documents`, `max_edits`. The first matching rule, in order, decides. The schema
    holds every rule to that form.
  - **Declared up front**: `add_intent` and `specify_intent` take `work_kind`, the kinds of work the intent will bring
    (schemas' UUIDs and/or `code`), kept as `play.intents.work_kind` (migration
    `202611071155-de24f1c5-auto-rules`) and shown on the board. Work of another kind is refused by `mayMove`'s work
    (409, naming the declared kinds), a pull request (`check_intent`'s `pr`) unless `code` is declared. An intent that
    declares nothing takes any kind, and no rule naming `work_kind` matches it; specified again, its declaration changes
    only while it holds no work.
  - **The matching**: one pure function, `matchRule` (`play/api/src/rules.ts`), called only by `autoMove`
    (`play/api/src/intents.ts`, beside `mayMove`), which runs as an intent reaches Specify (`specify_intent`) or
    Proposal (`check_intent`, its work proposed), as Ship's watcher reads its pull request, and for every intent held by
    one just Accepted. It moves an intent only where `mayMove` allows the move (its stage, its reduce step, its must
    checks, held) and a rule matches, and then by **exactly a person's path** (`versioned.ts` `decideAny`): a spec
    approved, work of play's accepted and applied, code into Ship by Ship's own steps (a refusal of Accept leaves it at
    Proposal, saying why). Every forward decision, a person's or a rule's, is written by one function, `decided`
    (`intents.ts`).
  - **The rules are always a person's**: `matchRule` gives null, whatever the rules say, for an intent whose work changes
    `rules:<RULES>` or `schema:<SCHEMA.rules>`, or that declares the rules' or the meta-schema's kind. No rule opens any
    gate but Approve spec and Accept, or changes what *No work without an intent* requires.
  - **Recorded**: `play.intents.auto`, `{ approve?, accept? }`, each the rule's UUID and label, `rules` (the BLAKE3
    content hash of the rule set's Main version it was decided by), its reason and when; `approved_by` and
    `decided_by` stay null. A step back, a reject or a reopen clears it; work back at Proposal (archived by itself, a red
    ship) clears its accept. The board marks the card *Auto* and its dialog says "Spec approved by rule …" or "Accepted
    by rule …", with the rule set's version and the reason, opening `/rules/` at that version.
  - **The first rule** (v1), *Artifacts need no tap* (`RULE.artifacts`): gates approve and accept, `via: ['mcp']`,
    `work_kind` and `schemas` `[SCHEMA.artifact]`. `add_artifact` and `update_artifact` called without `intent` make
    their own, in the same request and transaction, through the intent flow's own functions (`addIntent`,
    `specifyIntent`, `recordChecks`, `putAtProposal`): author the admin, via MCP, kind idea ("Keep …") or improve
    ("Correct …"), declaring the artifact; its spec play's (one must look, the artifacts' form, recorded as passed with
    the form checks as its evidence). The first rule approves it and accepts it: the artifact is kept, and the answer is
    the artifact with its intent, Accepted. Where no rule matches any more, the intent waits for a person, at Specify
    or at Proposal. Named with `intent`, they are held to that intent's gate as before.
- **Deciding settles the intent** (`POST /api/intents/:id/{accept,archive}`, `play/api/src/versioned.ts` `decideAny`),
  in one transaction. At Proposal with work of play's, **accepting applies it** as its kind says (§4.3 an asset's head,
  §12 a story's head, §4.6 a sandbox's pins and configs, §4.8 a factory's, §4.9 a config's next version) and the intent
  is Accepted; made on a base that has moved, the kind's own rule decides: merged where the two changes touch different
  fields, else its work is archived, and so is the intent; **archiving archives it**, its work's branch closed. Work
  archived by itself (its base moved, another's work accepted first) takes its intent back to Build (its results
  cleared, to be built again on the new head). Whoever proposed
  work may archive their own. The answer is the intent, with what its work came to (`decision`: status, number,
  version, merged, the message where it was archived).
- **Proposals became intents** (migrations `0026-intents`, then `0029-one-record`). 0026 gave every proposal an
  intent (one of its own, at its stage, where it had none) and a trigger kept them in step. 0029 made them one record,
  losing nothing: an intent and its one proposal became one intent; an intent with several kept the newest live one
  whose status was its stage (waiting, else accepted, else the newest), and each other proposal became an intent of
  its own at its own stage, named by the proposal's UUID and `came_with` the intent it was proposed for; every doc
  branch names the intent it was proposed as, a proposal's id written in an intent's or a branch's text became its
  intent's, and every proposal's id is kept in `proposal_ids` beside the intent it is, so an old link still finds it
  (`GET /api/proposals/:id` answers `308` to `/api/intents/<the intent>`, `/proposals/#<id>` opens it on the board,
  `?proposal=` on a factory, config or sandbox reads as `?intent=`). Then `play.proposals` and its triggers went; the
  old ids, their table and their aliases went in their turn with `0032-versioned` (§4.15): an intent is named by its own. An
  Inbox item became an intent at Idea (one done, Accepted), its definition and metric kept in its note, to be
  specified again with checks.
- **On the board** (admins only), each card is an intent: its title, how far its must checks are in Build and
  Proposal ("2/3 checks"), its type (what its work is, else its kind), who and when. Every intent opens its dialog:
  its note, its spec (the goal, the scope
  and each check with its mark, ✓ passed, ✗ failed, · no result yet, how and by what it is checked, and its last
  evidence), its work (a click from its review; for code, its pull request), and the **brief** that sends an agent to
  it (at Idea: specify it and stop; in Build: build it and record every check, so that it moves to Proposal by
  itself, and propose its work with `intent` if it is play's, or open its pull request, name it and stop if it is
  code). The brief is play's, never the board's: the Intents skill's text for the intent's stage (§4.14), the same
  `brief` `get_intent` gives an agent. An admin **approves the spec** (Specify → Build; no admin sends it back: its agent does, over
  MCP, `step_back_intent`), **accepts** it only at Proposal (what it asked is in; nothing is
  accepted from Build; an intent of code **Accept and ship**, or **Ship again** after a red ship, a refused one
  saying why), nothing in Ship (its card says its current step, its dialog the steps ticking with their links, the
  board read again every 3 s while any intent ships; a red ship's report at the top of its dialog back at Proposal), **rejects** it (from Idea, Specify, Build or Proposal; it ends archived) or
  **reopens** it (to Specify if it has a spec, else to Idea; not once its work of play's is accepted: what comes after
  it is an intent of its own). While its work waits at Proposal, its review is where it is decided: the intent is not
  sent back or checked again. Migration `0028-intents-ready-propose` moved the intents already in Build with every
  must check passed to Proposal. `GET /api/intents` (`?stage=idea,specify`, `?work=story_version`), `GET
  /api/intents/:id` (with `review`), `POST /api/intents` (an asset's version proposed on the web: an intent at
  Proposal), `POST /api/intents/:id/{approve,accept,archive,reject,reopen}`.
- The review of an intent's work shows the intent's checks as a strip of marks; an intent is named by its UUID only.
- **The decision sits at the foot** of what is open (a work's review, an intent), in the middle, where a thumb
  reaches it on a pad: **Reject** on the left, reddish (an intent rejected ends archived: its work ends accepted or
  archived), **Accept** (an intent's **Approve spec** in Specify) on the right, the rest between (Source,
  Reopen); no Close there: the nav pill's Back (or Escape) closes what is open, and the star the
  board (Samuel 2026-11-06). An asset's work's
  build keeps a height of its own (at least about half the screen) and its steps scroll below it.
- **The board is a modal** (Samuel 2026-11-05), not a page or a tile among the apps: the nav pill's **star** (the AI's
  mark, in Home's place: Back goes up to the dashboard anyway) opens it over whatever page is open, greyed out for
  everyone but the admins. The pill is Back, the star and You: the star its middle, a green round action button
  taller than the pill, standing out of it a few pixels above and below (which are as wide as each other, Back greyed in its place where there is nowhere to go
  back to), its mark alone with no word under it. Back closes what is open on it (a review, an intent), then the board; so do the star, Escape
  and its Close. `/intents/` (and `/proposals/` from before; a link, a new tab; `#<id>` opens that intent) opens it over the dashboard, and a link
  to it from a page opens it over that page (`play/site/src/lib/site/intents`).

- **The detail, by stage** (Samuel 2026-11-07, intent `bb3b0773-b4f4-4128-bcc1-b076674e3531`: *"the clear point of
  decision … reduced to the actual essence of decision point, while keeping overall the information that the agents
  need for their work intact"*). An intent opened is `IntentDetail.svelte` (`play/site/src/lib/site/intents`), apart
  from the board (`IntentsBoard.svelte`), and what it shows at each stage is one pure, tested function's, `detailOf`
  (`detail.ts`, `detail.test.ts`): **on top** only what a person needs at that moment, never a run command, a hash, a
  check's evidence or the brief; at the foot **one primary decision**, always in sight, its reason under it while it may
  not be taken, Reject beside it where an intent may be rejected; right above it the **tabs**, docked to the bottom and
  always in sight at every width (Samuel 2026-11-07: *"bottom align above the action button areas the tab section, so
  it's always like fixed to the bottom area"*; it replaces the spec's "sticky under the header"), scrolling sideways on a
  phone, in the aside's style (§4.15 *One aside*), the top staying where it is and the open tab's content scrolling
  between them, holding everything else whole:

  | Stage | On top | Decision |
  |---|---|---|
  | **Idea** | what is wanted (the note's first lines); "an agent specifies it next" | Reject only |
  | **Specify** | the goal in a sentence; what it removes first (the reduce checks, one line each); its checks one line each (statement and must or nice, no run); what it depends on | **Approve spec** |
  | **Build** | musts passed n of m, the checks as chips; who builds it (its pull request, draft or ready, or play's work); what holds it; a failure's reason in a line | none, Reject only |
  | **Proposal** | the goal; every must passed, the checks as chips; what changes in one line (the pull request, or the documents and their version, its review a tap away); a red ship's step and reason | **Accept**, **Accept and ship** for code, or **Ship again** |
  | **Ship** | the live steps to production, compact | none |
  | **Accepted / Archived** | what shipped (the version, or the pull request merged and in production) and when, or why it ended | Reopen |

  The tabs, in this order, a tab with nothing in it not shown: **Spec** (goal, scope, reduce and MVP), **Checks** (each
  check a card for a person, Samuel 2026-11-07: *"the audience is always a human, never a tech guy"*: its statement and
  its result in plain words, Passed, Not yet, or Failed with its reason in a line, and when; how it was checked, its how
  and by, its run, the tool's output and where it ran, folded behind *How it was checked*, closed at first; its two steps
  headed *First, what it removes* and *Then, what it delivers*), **Changes** (its work and its pull request; an asset's upgrade drawn right there in the asset box once the tab is opened, Samuel 2026-11-07, its whole review, versions, source, before and after, a tap away), **Ship**
  (steps, report, log), **Dependencies**, **History** (who and when, steps back, auto decisions, its declared work),
  **Note** (whole), **For an agent** (the brief and Copy). Each stage opens on its own tab first (Idea For an agent,
  Specify Spec, Build Checks, Proposal Changes, Ship Ship, Accepted History).

  **The decision travels with the work** (Samuel 2026-11-07): the bar is one component, `Decision.svelte`, by
  `detailOf`'s decision, docked at the foot of the detail and of its work's review opened from it alike (an asset's, a
  story's, a sandbox's), its secondary actions (Source …) quiet beside it, never in its place. **On a wide screen**
  (900 px and up: a tablet held wide, a desktop) the detail is two panes, as every versioned thing on play: the open
  tab's content large on the left (the asset drawn, the spec, the checks …), and on the right an aside with the header,
  the top, the tabs and the decision at its foot, Reject and the primary button side by side; the dialog as tall as
  what it holds, up to the screen. The work's review is the same: the work on the left, what it is and the decision on
  the right. Under 900 px, one column, the tabs and the decision docked at the bottom.

### 4.13 Artifacts (Samuel 2026-11-06; first called Sources)

Every link from the net Maia City keeps is an **artifact**: a web page, an article, a paper, a video, a social post, a
book, a podcast, code; all of them artifacts. The Artifacts (`/artifacts/`) are the coop's library of what we read, quote
and point to, so we can say where something comes from and have a proper summary of it to hand instead of a bare link.
Admins only for now, every row the Maia City coop's (`play/api/src/artifacts.ts`).

- **avenMAIA is every agent connected over MCP**, whatever its client, session or token: one row of `play.agents`, named
  by `uuidOf('agent:avenmaia')` (`AVENMAIA` in `play/api/src/ids.ts`), its name only shown. It is no human (no
  membership, no passkey, no level) and acts only through an admin's token; `initialize`'s instructions tell every
  connected agent that on play it is avenMAIA, working for the admin whose token connected it (its **operator**).
- **Who brought it.** Every artifact is avenMAIA's and names its operator, and its **origin**: `human`, a link the
  operator pasted to their agent, shown **Added by <the operator>**; `agent`, an artifact avenMAIA found and used in its
  own research (a plant's numbers, a claim in a story, a technique), shown **Sourced by avenMAIA**. The MCP teaches every
  agent to keep both. Who brought it never changes.
- **The three texts**, written by avenMAIA from the artifact itself and held to their form by play (refused otherwise,
  saying which): the **title**, very compact (one line, at most 70 characters, without the site's or channel's name);
  the **description**, the mini summary (1–2 sentences, one line, at most 280 characters, no Markdown); the
  **summary**, a small report on the overall topic (Markdown, **500–1,500 words**, in the sections `## What it is`,
  `## Key points` as bullets, `## The topic`, and if it likes `## For Maia City` last). Words are counted on the
  Markdown's text: headings', bullets' and links' words, not their marks or a link's address.
- **Authors** are rows of their own (`play.authors`: a person or an organization, its page and a note), n:m with the
  artifacts in their order (`play.artifact_authors`). An artifact has at least one: where no person is named, its publisher as
  an organization. An agent finds an author with `list_authors` and names them by their UUID; a new one is made only
  when none is them, and two of one name stay two (nothing is looked up or merged by a name, §4.7).
- **One link, one artifact.** A link is kept normalised: http(s) only, its scheme and host lower-cased, its `#fragment`,
  `utm_*`, `fbclid` and `gclid` dropped, a trailing slash dropped, a YouTube video one link however it is written
  (`youtu.be/<id>`, `/shorts/`, `/embed/`, `m.youtube.com` → `https://www.youtube.com/watch?v=<id>`); unique in the coop.
  Adding a link already kept answers with that artifact (`kept: true`), one an intent's work waits with answers with
  that intent; `update_artifact` corrects one. An artifact is still named by its UUID: its link is only data.
- **The page as it was**: `add_artifact` may take the page's readable text as fetched, kept among play's files by its hash
  (`text/plain`, not shown in the Library), since links rot and pages change.
- **A document like any other** (intent 847c5d38, Samuel 2026-11-06: "an artifact will go the same way as any other
  intent, just that we can promote it directly to proposal"; §4.15): every artifact is `artifact:<uuid>`, each kept
  before its v1. `add_artifact` proposes its first version and `update_artifact` its next, as every propose tool does:
  named with `intent`, the work of that intent, held to its gate (no work without an intent). Each is decided by the one Accept, one intent at a time, as any other; until then nothing of it is kept (the
  Artifacts page and `list_artifacts` show an artifact once accepted, marking a change of it that waits). Its row is
  what its accepted version says, written only by that Accept; it has the History tab every document has. Nothing is
  typed in by hand. Citing (stories, asset versions and intents naming the artifacts they rest on) comes later.

```sql
agents         (id UUID, coop_id, name /*only shown*/, created)            -- avenMAIA, seeded by 0027-artifacts
artifacts        (id UUID, coop_id, url /*normalised, unique per coop*/, title /*≤ 70*/, description /*≤ 280*/,
                summary /*Markdown, 500–1,500 words*/, kind /*page|article|paper|video|post|book|podcast|code|other*/,
                tags text[], published date, text_hash → files, agent_id → agents, origin /*human|agent*/,
                operator_id → humans, token_id → api_tokens, author_ids uuid[] /*in order*/, created, updated_by, updated_at)
                -- what its accepted version says (202611070117-847c5d38-intent-variants): a row not yet accepted holds only its id
authors        (id UUID, coop_id, name /*only shown*/, kind /*person|organization*/, url, note, agent_id, operator_id, created)
artifact_authors (artifact_id, author_id, position)    -- a view of artifacts.author_ids: n:m, in order
```

Over MCP: `add_artifact`, `update_artifact`, `list_artifacts` (`q` in a title, description, summary, link or an author's name;
`author`, `tag`, `kind`, `origin`; newest first, paged), `get_artifact`, `list_authors`, `get_author`. The page
(`/artifacts/`, a tile among the coop's own beside the Library) lists them newest first, each its title alone (its description is the opened artifact's, so a list stays short), kind,
date, authors, tags, its link (a new tab) and who brought it, filtered down its left by who brought it, kind, tag and
author; an artifact opens to be read (`?artifact=<uuid>`: its summary as Markdown, its authors), an author to their artifacts
(`?author=<uuid>`).

### 4.14 Skills (Samuel 2026-11-06)

What play teaches its agents is kept **once, in play's Postgres**, as **skills**: never in the code, never in the
board. Before, the system prompt every MCP agent got, the stage rules in the intent tools' descriptions and the board's
two briefs were four copies of one thing, each edited by hand (intent c9113886-0803-4ab9-bc3c-8e73b6667484).

- **A skill is a Loro document** (§4.4), `skill:<uuid>` of type `skill/1`, one kind of version control (§4.15): every
  edit kept with its author, message and time, its versions numbered on accept, a change an intent variant. Its fields: `system`,
  its part of the system prompt; for the Intents skill, `stages`, one text for each of an intent's stages (`idea`,
  `specify`, `build`, `proposal`, `ship`, `accepted`, `archived`; empty where an agent has nothing to do), in which
  `{intent}` and `{title}` are the intent's UUID and title, filled where it is served; and its `note`. Its `label` and
  `group` are only shown (*skills / intents*): a skill is named by its UUID (§4.7), `SKILL` in `play/api/src/ids.ts`.
  Its row is `play.records`' (kind `skill`), as a schema's and a piece's are (intent 1d9995c3, Samuel 2026-11-07).
- **Two skills** so far: **avenMAIA** (group *agents*: who every MCP agent is, what it does on play, the Artifacts'
  rule, §4.13) and the **Intents** skill (group *intents*: the lifecycle, and each stage's instructions, Ship
  included). Their v1 is the deploy's import (`play/api/import/skills.ts`), only where play holds none of that id:
  today's texts moved word for word. From then on Postgres is the source and the seed is never read again.
- **Changed only by proposal** (§4.15): `doc_edit` makes a change edit by edit (a field's text, a range of it, each
  edit with its message), `propose_doc_version` proposes it (with `intent`, held to its gate), the `skill_version` work
  on the intent, shown on the board field by field, each text sentence by sentence before and after; accepting merges
  it and names its next version. Never by a migration. **A new skill** is made over MCP as any document of a kind that
  is a schema alone: `doc_edit` with `kind: "skill"` and its `whole` on an intent variant (Main born empty), then
  `propose_doc_version` naming the intent; its v1 is an admin's Accept. `list_docs`, `doc_at` (a version, an edit, an intent's variant)
  and `doc_history` read them; `/skills/` shows them, each in its History tab (`GET /api/docs?kind=skill`,
  `/api/docs/<uuid>`). Admins only.
- **Served from Postgres, on each request**, so an accepted version teaches the next agent with no deploy:
  `initialize`'s instructions are avenMAIA's `system`, then the Intents skill's; an intent's **brief** (`get_intent` and
  `GET /api/intents/<uuid>`, and so the board's *For an agent*) is the Intents skill's text for its stage, filled, or
  null; and MCP's **prompts** (`prompts/list`, `prompts/get`) are one for each stage it speaks to (`intent_<stage>`, its
  argument the intent's UUID). A tool's description says only what it takes, gives back and refuses.
- **Every skill is in play, and only there** (intent a90151df, Samuel 2026-11-07): the 41 skills `.claude/skills` held
  (the asset, film, security and engineering families), beside avenMAIA and Intents, are skill documents of `skill/1`
  (`description`, `body`, `references` each a text or a file by hash, `uses`, `frontmatter`). The repository keeps no
  skill text, only the code skills name (`tools/security-auditor/`, `tools/plant/`, `tools/sheet/`). Every skill is an
  MCP **prompt** too, `skill:<uuid>` (`prompts/get`: its description, body and its references' index), beside the stage
  prompts. Claude Code's Skill tool reads only `.claude/skills`, so **a mirror** is written from play at each avenBOX
  session's start (`.claude/settings.json`, after `up.sh`): `play/avenbox/skills.ts` reads every skill over MCP
  (`list_docs`, `doc_at`) and writes one folder a skill (its label's slug, only shown), SKILL.md (`name`,
  `description`, the skill's `frontmatter` as it came, `allowed-tools` space-separated, then its `body`) and each
  reference at its path, a file fetched by its hash from play's files and held to it; a reference with both a text and
  a file, or neither, is refused. It replaces the folder whole, writes nothing without `PLAY_MCP_TOKEN`, and
  `.claude/skills/` is in `.gitignore`: never committed, so there is no second source to drift.

```sql
records (id UUID, coop_id, kind 'skill', label /*only shown*/, created, updated)  -- its document: docs 'skill:<id>';
                                                                                  -- play.skills (0031) moved here and gone (202611070945-1d9995c3-skills-records)
intents (…, work 'skill_version')                                                 -- its document and variant: intent_variants
```

### 4.15 Version control (Samuel 2026-11-06)

**One version control for everything play versions**: assets, stories, factories, the game's configs, skills,
the shared pieces a recipe names by hash (§4.5), sandboxes' layouts (§4.6), the auto-accept rules (`rules:<uuid>`, §4.12) and the schemas themselves (and, by its own intent, breeds next), in one vocabulary, by one
registry and one module, shown by one History.

| Word | Meaning | Was |
|---|---|---|
| **Edit** | One change, kept with its author, message and time | step |
| **Variant** | A line of edits of one document | branch, draft |
| **Main** | The default variant: what is accepted | main line |
| **Intent variant** | A variant that exists only inside an intent and goes through its stages. Accept merges it into the variant it came from; Archive closes it, kept in the history | draft, feature branch |
| **Seed** | The version a variant grows from ("seeded from Main v3"). A document's first version is just v1 | base |
| **Version** | A numbered state of Main, named on accept | version |
| **Breed** | A named variant beside Main that tracks Main: it takes every edit accepted on Main, except on the fields it overrides (an asset's kinds and breeds) | an asset's variants |

- **One registry, one module** (`play/api/src/versioned.ts`). Each versioned kind is one entry: its document prefix and
  its schema (a document, by its UUID: below), its row table, its label and group (only shown), and hooks only where it really differs (an
  asset's `replace` edit and its recipe built on propose; a story's timeline edits and its frozen `story_versions` row;
  an asset's and a story's own decide; a sandbox's layout's edit helpers and its rows written on accept; the fields its
  row keeps of an accepted version; its list item's extra fields; what a read or a change shows beside its fields).
  The module does the rest for every entry: list, read (at a version, an edit, an intent's variant), history (edits,
  versions, variants), edit, propose, review (what changed field by field against the seed, its edits, whether Main
  moved) and decide (merge; an overlapping-field clash or an invalid whole archived; archive). A kind registered there
  alone, with its table, gets all of it, over MCP and HTTP and on the board, with no other file changed: what a
  document's id is and what an intent's work names are one rule each in Postgres, and every list the board and the
  API read comes from the registry.
- **The store** (migration `0032-versioned`): `doc_variants` (each document's Main, type `main`, and its intent
  variants, type `intent`, each with its `seed`, the frontiers it grew from, and its intent), `doc_edits` (every edit,
  append only, on its variant), `doc_versions`, `doc_peers`. An intent's work names its document and variant
  (`doc_id`, `doc_variant`); an asset's frozen `version`/`base` and a story's `story_version`/`story_base` stay (a
  sandbox's change became its layout's intent variant in `202611070115-d2f50bf1-sandbox-layouts`, §4.6). Since `202611070117-847c5d38-intent-variants` the documents an intent changes are rows of
  **`play.intent_variants`** (intent, document, variant, seed, position: the first its work's own), in place of the
  intent's one `doc_id` and `doc_variant`.
- **Every change an intent variant** (intent 847c5d38, Samuel 2026-11-06): no MCP tool, HTTP route or token writes a
  document's Main but an admin's Accept of the intent holding the change, at Proposal (or a rule's Accept by the same
  path, §4.12 *Auto-accept rules*: today an artifact's) (and a document's v1 by the
  import, or made from its kind's own history the first time it is read). `doc_edit` names its intent (`intent`, one in
  Build or waiting at Proposal) and is refused without one; a variant made for an intent is proposed for that
  intent only. `play/api/test/nobypass.test.ts` calls every tool tools/list holds that is not a read, and every write
  route of `app.ts`, and finds every Main unchanged until the intent is accepted.
- **Several documents, one intent**: a document's version proposed naming an intent goes in beside the documents it
  holds (its variant of that same document replaced); an asset's, a story's or a sandbox layout's version (a kind that decides its own way) is the
  intent's whole work. The board reviews each document; Accept merges them all in one transaction, or none where one
  clashes (a field Main changed too) or is no longer valid merged: the intent is archived whole, as Archive closes
  them all. There is no batch accept: an Accept decides one intent.
- **MCP and HTTP, by a document's UUID**: `list_docs` (by kind), `doc_at` (a version, an edit or an intent's variant),
  `doc_history` (with `variant`), `doc_edit` (one edit of an intent variant, for its `intent`: the intent's open
  variant of the document, or a new one seeded from Main's newest version, if none is named) and `propose_doc_version` (`intent`, a `variant`, edits or the whole). `GET /api/docs`,
  `/api/docs/<uuid>` (`?v=`, `?edit=`, `?intent=`), `/api/docs/<uuid>/history` (`?variant=`) and
  `/api/docs/<uuid>/changes` (`?edit=` or `?variant=`, against what it grew from). Each kind's own reads and creates
  stay where they hold more than the document: `get_asset` (its recipe files; `edit`, `intent`), `get_story` (its
  links; `edit`, `intent`), `propose_asset`, `propose_story`, and `get_sandbox` (a layout's pins by their assets).
- **Schemas as documents** (migration `0034-schemas`, `play/api/src/docs/schemas.ts`; Samuel 2026-11-06). Every schema
  is itself a versioned document, `schema:<uuid>`, of the **meta-schema** (`schema:<SCHEMA.meta>`), which describes
  every schema, itself included: its `label` (only shown), `type` (its documents' id prefix), `name` (its old name,
  `story/1` …, only shown) and `node`, the JSON Schema subset `docs/validate.ts` checks (with Loro's `x-loro: text`).
  The fixed UUIDs are `play/api/src/ids.ts` `SCHEMA`. **Bootstrap:** `migrate()` ends with **`ensureSchemas()`**: it
  makes each schema's v1 from the seed (`play/api/migrations/schemas/*.json`, today's definitions as code wrote them
  before), only where absent, its row in `play.records`, and names every existing document's schema by its old
  `schema` name (`play.docs.schema_id`, `schema_version` 1). From then on Postgres is the source: every commit, merge
  and preview validates against the schema's Main (cached by the schema document's head), and a document records the
  version of its schema it was last written against (`schema_version`). What a schema can't say stays code, keyed by
  the schema's UUID in `versioned.ts`'s entries: a story's clips inside its duration, an asset's variant names and that
  it is code (`build`), a factory's stations named where they are, the levelling's rising villagers, a node's own words
  (the meta-schema's). **Changing a schema** is an intent variant like any document's (`doc_edit`,
  `propose_doc_version`); its Accept is **refused while any document on Main fails the new version**, naming them, and
  a schema's documents keep their prefix. **A new type needs no code**: `propose_doc_version` with `kind: "schema"` and
  the `whole` schema; once accepted it is a kind of its own (its rows in `play.records`), and its documents are proposed
  new the same way (`kind`, `whole`: Main born empty, the first version an intent variant's until a person accepts it).
  Admins see them on **`/schemas/`**: each schema's node field by field, the documents written against it, and its
  History in the right aside. No bypass: every change waits at Proposal for a person's Accept.
- **One aside, Info and History** (Samuel 2026-11-07; `play/site`'s `lib/app/Aside.svelte`, the only user of
  `lib/app/History.svelte`): every view of a versioned document shows on the right, in Frame's aside, one aside with two
  tabs centred at its top, the same on a phone (the round button at the bottom right opens it): the asset viewer (every
  group), Artifacts, Factories, the Game editor, Rules, a sandbox's layout (`/sandboxes/<uuid>/`), Schemas, Skills,
  Stories, Worlds, and the five sandbox worlds (`/sandbox-1/` to `/sandbox-5/`, each its layout's, an admin's: a pick
  opens the world at it, `?layout=<uuid>/v3`, `/e12`, `/<intent>`). A view gives the document as /api/docs gives it and
  its pick; no view keeps an aside or History of its own. **Info**: where it lives, its name and note, its kind, the
  version shown with who wrote and accepted it and when, the version's note, the view's own fields (an asset's
  details, reference sheet and parts, a factory's bill of process, a story's format, an artifact's link and authors), a
  picker of its latest versions and of its breeds, and how it changes. **History**, compact (a version one line over its
  note in at most two lines, whole on a tap or under the pointer): at its top the
  scrubber over every edit of Main, versions marked, MCP and merge edits marked; ▶ Play its making, Back to vN and the
  arrow keys; under it Main's versions with their edits folded beneath, and the open intent variants with their
  intents. Picking an edit or an intent variant shows what it changes (`lib/app/Changes.svelte`: the field diff, texts
  sentence by sentence and code line by line, and the edits list, once) and hands it to the view, which draws the thing
  as it stood there. Every review on the intents' board reads the same through `Changes.svelte`, beside an asset's
  build or a story's player.
- **No bypass**: every change waits at Proposal for a person's Accept; the intents' stages, gates and Ship are as they
  were (§4.12).

#### Breeds (Samuel 2026-11-06; intent 7c8085db-ccdb-44cf-8d6c-0ff984d71f41)

"Breeds are like variants under the hood but keep tracking their main so they live alongside main." An asset's
variants (a plant's kinds, an animal's breeds) are **breeds** of its document: variants of type `breed` in
`doc_variants` (migration `202611070120-7c8085db-breeds`), each named (its `name`, only shown; the frozen variant rows and the pins
keep naming a variant by it), beside Main.

- **What a breed holds is what it overrides**: the fields it changed from Main (`overrides`, paths into the document),
  only ever within an asset's `source` and `card` (`play/api/src/docs/breeds.ts`). A breed that overrides nothing is
  Main as it is.
- **A breed tracks Main**: when an edit is accepted on Main it is merged into every breed (one `merge` edit on the
  breed's line, "tracks Main vN"), and on every field the breed overrides the breed keeps its own value. A field both
  Main and the breed changed (a clash) keeps the breed's.
- **A breed changes by its own intent variant**, seeded from it (`doc_edit`'s or `propose_doc_version`'s `breed`, the
  breed's number from `doc_history`); it may change only the breed's own fields. Accepting merges it into the breed,
  and what it changed the breed overrides from then on. **A new breed is made by an intent too** (`new_breed`, its
  name): seeded from Main, its Accept makes the breed.
- **Every Accept, on Main or on a breed, is the asset's next frozen version**: `asset_versions` with one
  `asset_variants` row per breed, each built from the breed as it then is (Main beneath it), the recipe made in the
  box as before (`RECIPE_HEAD + source + recipeTail(slug, v, breed)`). An Accept on a breed leaves Main as it is and
  names its next version all the same. `defaultVariant` (on Main) names the breed shown first.
- **The migration**: every asset's variants became breeds of its document with the same sources and cards (in the
  deploy's import, `breedsFromVariants` in `play/api/src/assetdocs.ts`: each breed built gives its variant's recipe
  hash, byte for byte); Main holds no `variants` since. Every frozen version, its variant rows and every pin stayed as
  they were. A version proposed with its `variants` given whole (`propose_asset`) makes them breeds on its Accept; an
  asset of breeds is changed only through its document, so every breed is built from it.
- **In the views**: the asset viewer's chips list the breeds (the frozen version's variants, as before), and its
  History tab shows each breed as its own line beside Main (what it overrides; picking it builds the breed); an intent
  variant says whether it changes Main, changes a breed or makes one. `doc_at`'s `breed` reads a breed as it is now,
  `/api/docs/<uuid>?breed=` the same; `/changes?variant=` of a breed is what it overrides of Main.


## 5. The sandboxes

| New | Cloned from | What changes |
|---|---|---|
| **Sandbox 1** | Sandbox 4 (`maia/site/routes/app/games/sandbox-4`, `maia/content/sandbox-kit`, `maia/content/sandbox-2/interior`), its 56 asset pins | Recipes come from play's API instead of legacy's device; pins become `group/id@v` |
| **Sandbox 2** | Sandbox 7 (`maia/content/sandbox-7`), no legacy store's dependency | Restyled in the light brand CI: cream/paper backgrounds, ink green text, mustard/sage/terracotta accents, Fraunces display and DM Sans body (tokens from `maia/site/app.css`) |
| **Sandbox 3** | MaiaCity V2's world (`maia/content/maiacity-v2`, engine `maia/content/game/maiacity-v2/engine.js`) | **Stripped:** coops, tokens and money (HEARTS, the MINDs, €uro, the pool, rents, mint, demurrage, dividends), MIPs/AIPs, seats, the ledger and the trailer/intro/tour/film. Also stripped for now: **planting a tree** (the seedlings in the backpack, planting, watering a planted tree). **Kept:** the land, the plots, the trees already there, the van, the things. **Stateless:** no server state, no seats |
| **Sandbox 4** (Samuel 2026-11-05) | Nothing: new, `play/site/src/lib/sandbox-4` | The dome cassette joint: one cast cassette of the grand dome's (Ø 100 m) lowest rows seated from outside, keyed with sliding basalt keys, capped at its nodes and clamped by a ring cable, five steps on one clock, with the joint in section. No pins and no configs; a random UUID (migration `0021-sandbox-4`), in the light brand CI |
| **Sandbox 5** (Samuel 2026-11-05) | Sandbox 1 (`play/site/src/lib/content/sandbox-2/interior/village.ts`, its `solo` option) | The forest dome (buildings, asset `cac16350-08a4-4d51-8cdf-3ade5f61836e`) alone in the middle of Sandbox 1's world, in place of its thirteen domes, at its newest accepted version (never pinned), with its own forest, things and floor drawn where it stands them (`plantings.js`) and walked on its own floors (`hero.js` walkOf); round it Sandbox 1's outdoor food forest (its garden config), stream, ponds, coops and animals, the cell's paths meeting its four gates. No pins and no configs; a random UUID (migration `0022-sandbox-5`) |

**Every visitor gets a random character** when a world opens: today's stand-in actor (`actors/stand-in`) with
random values for its params (face, hair and colour, skin, height, shirt, trousers, shoes …), drawn within the
ranges its card allows. In all three sandboxes; in Sandbox 2 the character walks through the lab among the buildings.

## 6. Where the data comes from (one-time import, `play/import/`)

Where the legacy import read its data from, in 2026-11, from legacy's public feed (`SNAPSHOT_2611101`; retired on
2026-11-05, the import reads it no more):

| Data | Source | Key needed? |
|---|---|---|
| 203 asset recipes (plants 105, things 55, machines 12, buildings 12, actors 12, biomes 7) and their cards | legacy's public feed `GET /feed/entries?seed=1&type=recipe` | No |
| Every version and variant with its own card (264 versions, 145 variants) | `GET /feed/entry/<vault>/<entry>`: its `brought` rows, one per version and variant | No |
| 340 recipe files (18 MB) | `GET /feed/entry/<vault>/<entry>/file/<root>`; each BLAKE3-checked against its own card's `recipe` and its last line against its card's version and variant. History: a linear chain by version number | No |
| Sandbox 1's pins (165: 56 village + 109 garden) | `maia/content/code/configs/sandbox-4/{assets,garden}`; `entry@heads` translated through `maia/content/assets/pins.fixture.json` | No |
| Level rules | feed `type=capgroup` (Admin, Citizen, Traveler), then set to §1's rights | No |
| Humans + passkeys | `public.founders`, `public.passkeys` (read once) | No |
| Owners/admins | Samuel names them; everyone else starts as a traveler | No |

No V2 game state is imported (Sandbox 3 is stateless). The master recovery key is not needed.

**It ran once (Samuel 2026-11-03).** Postgres keeps that it ran (`play.imports`), and from then on **play's Postgres is
the one source of truth** for its assets, members and sandboxes. **The feed is gone (intent 59af6109, 2026-11-07):**
legacy's store was retired on 2026-11-05, and the import's legacy path, which read its feed, went with it. What every deploy
still runs (`bun import/run.ts --report <file>`) writes none of the legacy import and overrides nothing play changed
(a label, a head moved by accepting a version, a sound, a member's level, a member or pin removed); it only adds what
play lacks from the repo: its site's media from `play/media`, the imported versions' readable sources where they have
none (§4.1), the stories, factories, game configs and skills kept in the repo, and every asset's document. A media file
play's site names that is neither among play's files nor in `play/media` is an import error naming its hash: play
mends a file from its second copy (§4.5), and a database is restored from the backups (`restore.yml`), never from a
feed. Every file's bytes are read back only by the server workflow's report, by hand.

## 7. API (`play/api`, Bun)

- Auth: `POST /api/passkey/register/{options,finish}` (open sign-up → traveler),
  `POST /api/passkey/login/{options,finish}`, `GET /api/me`, sign-out. Ported from `aven/api/src/passkey.ts` and
  `session.ts`.
- Assets (traveler+): `GET /api/assets`, `GET /api/assets/:grp/:slug` (its chain), `GET /api/assets/:grp/:slug/:v`,
  `GET /api/files/:hash` (signed redirect to the bucket). Admins: `GET /api/assets/:id/recipe?edit=<seq>` (or
  `?intent=<id>`: the recipe file it builds at an edit, kept by its hash).
- Version control (admin, §4.15): `GET /api/docs` (`?kind=`), `GET /api/docs/:uuid` (`?v=`, `?edit=`, `?intent=`),
  `GET /api/docs/:uuid/history` (`?variant=`), `GET /api/docs/:uuid/changes` (`?edit=` or `?variant=`).
- Sandboxes (traveler+): `GET /api/sandboxes/:id/pins`.
- Intents, the one record (§4.12): `POST /api/intents` (citizen+: a new asset version, card + recipe file upload: an
  intent put at Proposal with it, the one named by `intent` held to its gate, else a new one), `GET /api/intents`
  (admin; `?stage=…&work=…`), `GET /api/intents/:id` (admin; with its work's `review`), `POST /api/intents/:id/{approve,accept,archive,reject,reopen}` (admin; whoever proposed work
  archives their own). Intents are added, specified and checked over MCP only; over MCP an agent archives only its own
  intents at Proposal put there over MCP (`archive_intent`, Samuel 2026-11-04) and sends one a stage back with its reason
  (`step_back_intent`); no tool accepts.
- Artifacts (admin): `GET /api/artifacts` (`?q=&author=&tag=&kind=&origin=human|agent&offset=&limit=`, with the count and
  the counts by origin, kind and tag), `GET /api/artifacts/:id`, `GET /api/authors` (`?q=`), `GET /api/authors/:id` (with
  their artifacts); artifacts are kept over MCP only, by avenMAIA (§4.13).
- Coop (admin+): `GET/POST /api/coops/:id/members`, `POST /api/invites`; `POST /api/invites/:code/claim` (makes the
  claimer a citizen).

Every route checks the caller's level against `level_rules`; a visitor gets 401 everywhere except sign-in/sign-up.

## 8. App (`play/site`, SvelteKit, light brand CI throughout)

`/` sign in or sign up · `/sandbox-1/` · `/sandbox-2/` · `/sandbox-3/` · `/sandbox-4/` · `/sandbox-5/` · `/assets/` (library; an asset's versions as
a chain, its variants, a viewer) · the intents (a modal from the nav pill's star, not a page: Idea, Specify, Build, Proposal, Ship, Accepted, Archived; §4.12) · `/game/` (placeholder; claim an invite to become a citizen) ·
`/admin/` (members, invites) · `/artifacts/` (admins: every link we keep, §4.13).

**The asset groups, each its own app** (Samuel 2026-11-04; `play/site/src/lib/app/groups.ts`): plants (`/plants/`),
**characters** (`/characters/`), actors shown as Animals (`/animals/`), things, machines, buildings, biomes and worlds,
each the asset library (`AssetLibrary.svelte`) given its group. The API names the groups once (`play/api/src/groups.ts`
`GROUPS`: list_assets' and propose_asset's enum, a new asset's group and a move checked against it); the site's card and
asset schemas list the same. **Characters** (intent 89f3ad37) are the people of Maia City (the Stand-in, the Elder
woman), apart from the animals: the group `characters`, an app for admins only (its tile `admins: true`; its page sends
anyone else back to `/`, as `/library/`). Who may read an asset is unchanged. **An asset moves to another group by its
own document**, never by a migration: an intent variant's edit of its card's group (`doc_edit`, the path
`["card", "card", "group"]`), proposed naming the intent (`propose_doc_version`), its version then of that group, and its
Accept moves the asset there (`play.assets.grp`; `play/api/src/assetdocs.ts`); an unknown group is refused.

**The Library** (`/library/`, Samuel 2026-11-04; `play/api/src/library.ts`): every image, video and recording play
keeps among its `files` (§4.3), newest first, for Maia City's admins only. Each shows its preview (a video plays,
a recording sounds), its media type, size and when it was kept, its **label**, and where the newest version of
every story uses it: a shot's still or video, or a clip's recording. A label is only shown, never looked up by: a
file is named by its hash. An agent gives one with `add_story_frame`, `add_story_video` or `add_story_audio`'s
`label`, where a new label replaces the old one and none keeps it. An admin renames it in the Library
(`POST /api/library/:hash/label`). `GET /api/library?kind=image|video|audio&q=…&offset=…&limit=…` lists them, `q`
matching a label or the start of a hash, with the count of each kind; an admin's token reads it too (§4.4 *An
agent's camera*), and over MCP `list_library` (`kind`, `q`, `offset`, `limit`) gives the same answer, so an agent finds
a file by its label or hash prefix with where it is used and fetches its bytes with `GET /api/files/<hash>`. Only
admins pass it (`admin(me, why)` in `play/api/src/access.ts`, the one admin guard every route's check calls with its
own message).

## 9. Deploy

- `play-api` service + a Caddy block for `play.maia.city`; DNS to the same machine.
- Env: `DATABASE_URL` (role `play`), `PLAY_BUCKET`, `PLAY_BUCKET_ENDPOINT`, `PLAY_BUCKET_ACCESS_KEY`,
  `PLAY_BUCKET_SECRET_KEY`, `RP_ID=maia.city`, `SITE_ORIGIN=https://play.maia.city`.
- production follows main (§4.12, *Accept ships it*): an admin's Accept merges an intent's pull request, and once
  main.yml is green `.github/workflows/release.yml` moves `production` to the commit (fast-forward) and starts
  `production.yml`, which deploys play and the website; play's ship watcher follows it with `SHIP_TOKEN` (written into
  `play.env` by the deploy, with `SHIP_REPO`).
- Backups: before every deploy a snapshot, like Time Machine's: a full `pg_dump -n play` and the list of the files it
  names, the files themselves kept once each in the shared store `BACKUPS/play-files/blobs/` (`deploy/backup.sh`).

## 10. Milestones

1. **M1 Data:** schema, import, verification report.
2. **M2 API:** auth (open sign-up), assets and files, pins, asset proposals, members and invites.
3. **M3 Sandboxes:** Sandbox 2 (no data dependency; the brand CI restyle), then Sandbox 1 (on the new recipe source),
   then Sandbox 3 (strip, random character), then the asset library, proposals, the game placeholder and admin.
4. **M4 Deploy:** `play.maia.city` live next to maia.city.

## 11. Open questions

None for v0. Settled 2026-11-02: citizens propose and admins accept; the Maia City coop owns every asset and its
admins are its owners; Sandbox 3 has no tree planting for now; every sandbox gets the random walking character.

## 12. Stories (Samuel 2026-11-03)

A **story** is one of our films as **one timeline**: admins play it through on `/stories/` (its storyboard frames
beside the subtitles of its script, the notes for the edit, its sections and its mood rising and falling) to feel
whether it works before anything is filmed or rendered. Admins only, reading and proposing. Later the same timeline
becomes the film itself (motion design, three.js scenes per shot) and is **rendered into a video frame by frame**.
The format and the player are made for that now.

**The format, `story/1`: tracks of clips.**

```
{ schema: 'story/1', format: '9:16' | '16:9' | '1:1' | '4:5', fps: 24|25|30|48|50|60, duration,
  tracks: [ { id, kind, clips: [ { id, at, duration, …its kind's fields } ] } ] }
```

| kind | a clip's fields | later |
|---|---|---|
| `shots` | `frame` (an image's file hash, a still of the storyboard), `transition` (how it goes into the next shot, read as code where it starts with one, below); `video` (a video's file hash: the shot's moving picture, an MP4 or WebM added with MCP `add_story_video`, ≤ 40 MB) played muted over the still from `video_in` (s) for the shot's length, the story's own sound under it (Samuel 2026-11-04) | `scene`: an asset ref by hash, its values (a plant's stage…), camera keyframes `[{ t, pos, look, fov }]`, replacing the still shot by shot |
| `voice` | `who`, `line` (the narration; its subtitle, cut into lines of about 26 characters spoken evenly); `cues` its own subtitles where it sets them, `[{ at, text, em? }]` (`at` seconds into the clip, each until the next; `em` one set apart, alone and large: "100x" while "a hundred times" is said; Samuel 2026-11-04); its take as the clip's sound (below) | |
| `notes` | `section`, `camera`, `retention`, `mood` (↑ ↑↑ ↑↑↑ ↓ ↓↓ ↕) | |
| `music`, `sfx`, `ambience` | the score and cues, spot sounds and hits, beds; clips may overlap; nothing dips under the voice by itself (a track's `duck: true` asks for about 6 dB under it; Samuel 2026-11-04) | |
| `story` | `story` (another story's UUID) and `version` (the id of the accepted version of it that plays; required); `duration` that version's own (left out, it is given it): that version linked in, below | |

**Every clip may sound** (Samuel 2026-11-03, the old studio's model of a clip's sound, `SNAPSHOT_2611101`
`maia/content/studio`): `audio` a recording's file hash (MCP `add_story_audio`: MP3, WAV, Ogg, FLAC, M4A or WebM, its
type read from its bytes, ≤ 25 MB, kept among `files` and served as audio), `audio_in` the trim into it (s), `gain`
(dB, −60…+24), `fade_in`/`fade_out` (s), `eq` (≤ 8 biquad bands `{ type, f, gain, q }`) and `keys` (gain automation,
`[s, dB]`). A track may carry `gain` (dB) and `mute`. Every hash must be a recording play holds, as every frame must be
an image. The player lays every sounding clip on one Web Audio clock (`play/site/src/lib/stories/sound.ts`, from the
pure `soundsOf(story)` in `timeline.ts`, which an export's mix will lay the same way); while it plays, t follows that
clock, and a seek lays the sound again from the new t.

**One film, one timeline** (Samuel 2026-11-03). A film's rewrites are versions of its one story, never stories of their
own: `propose_doc_version` on its head (§4.15). Stories proposed apart are brought together by `import/stories/folds.json`
(run with every deploy, `foldStories` in `play/api/src/stories.ts`): each story it names, in turn, has its accepted
versions proposed and accepted on the one story as its next versions (each by its own author and approver, its note
saying where it came from), the work of its intents at Proposal proposed again there for the same intents (their branches here closed); then it is
`folded_into` that story: kept with its whole history, listed no more, taking no proposal. The papaya devlog is the
first: v1 the devlog short, v2 "The Tree That Remembers", v3–v5 the Day 1 rewrites ("Your papaya flew across an
ocean", the same voiced, "Three seeds. One will never give fruit."), Three Seeds' voice its next proposal.

Times are seconds; `duration` is worked out from the clips. Clips of `shots`, `voice` and `notes` follow one another
and never overlap; other kinds may. **A clip may carry fields no kind names, and a track may be of a kind not named
here** (`music`, `sfx`, `callout`, `scene`): both are kept as given, so a new kind needs no migration. Frames are
`files` like any other (§4.3), served by `GET /api/files/:hash`.

**Linked stories: one timeline composed of others** (Samuel 2026-11-04: "Can you introduce timeline composition … so
we pull out the trailer as its own timeline, but we can reuse the trailer timeline in each other timeline, so this just
links into the actual trailer timeline? So we can develop the trailer individually or independently of all other
timelines." And then: "the linked trailer feature timeline should be like you need to link the actual version. So
different timelines can link different trailer versions."). The trailer every film plays after its intro is a story of
its own, and each film links a version of it:

- **The format.** A track of kind `story` holds links, one clip each: `{ id, at, duration, story: <its UUID>, version:
  <one of its accepted versions' ids> }`, by UUID and hash only (§4.7). A link always names its version: a film plays
  that version until a proposal on the film moves it to another (`set_clip` on the link with the new `version`; the
  clip then takes that version's length, and a `shift` closes or opens the difference), so two films can play two
  versions of one trailer, and a new trailer version changes no film. `duration` is the version's own, held to it.
- **Checked whole, with the rest** (`checkBody`, on every proposal and every `doc_edit` of a story): refused are a link
  without a version, to a story that does not exist, to the story itself, to a version not that story's, to a version
  never accepted (a film links only what an admin accepted), with a duration other than its version's, and links that
  loop at any depth (A links B links A: a story never plays inside itself) or nest more than 4 stories deep. A story
  track's clips never overlap each other; a link's content may overlap the story's own clips (the trailer's music
  ringing out under the film's next line) and is never checked against them. A story folded into another (below)
  keeps its versions, so a link to one of them plays on as it was.
- **Reading resolves them.** `GET /api/stories/:id[?v=n]`, a step's read, an intent's work's review (the work and its
  base) and MCP `get_story` give the story as stored and `links`: every version it links, to any depth, by the
  version's id, each `{ id (its story), title, number, version, duration, newest, body }` (`newest`: its story's newest
  accepted number, shown as "v5 available", never played). `get_story` leaves the bodies out unless asked
  (`links: true`). `GET /api/stories/:id` also gives `linked_by`: the stories whose newest version links it, and which
  version of it each plays.
- **The player flattens them** (`flatten(story, links)` in `play/site/src/lib/stories/timeline.ts`): each link's
  version laid in from its `at`, recursively, its clips tagged with the story they came from and their ids made unique
  against the story's own; `renderAt` and `soundsOf` (so the Web Audio mix) run on that one timeline, so the linked
  pictures, subtitles, notes and recordings play in their place. Where a linked clip and the story's own clip of a
  kind shown one at a time (shots, voice, notes) both cover t, the one that started later shows; two that start
  together, the story's own. The timeline draws a lane of links ("The trailer · v2", "v3 available" where its story has
  a newer version), each opening that story at that version on the Stories page, and the clips they lay in hatched
  and dashed in their own lanes, the link's span marked across them. Nothing of it is edited there.

**One function shows it.** The player's picture is `renderAt(story, t)` (`play/site/src/lib/stories/timeline.ts`):
from the timeline alone, the shot at second t, the one fading out under it and how far (a cut cuts, other
transitions cross-fade over up to half a second), how bright it is (the fades from and to black), the
subtitle and how much of it is spoken, the notes. Play and scrub only move t; nothing runs on a clock of its own. The
same t gives the same picture every time, which is what a frame-by-frame export needs (WebCodecs in the browser, or a
page a renderer seeks through): it comes later.

**Full screen** (Samuel 2026-11-06): the player's Full screen button (or F) shows the picture alone on the whole screen,
black around it and kept to the story's format (letterboxed, never cropped), its subtitles in it; a tap plays and pauses,
a bar (play, the time, a line to seek on, exit) shows while it is paused or the pointer moves and goes with the cursor
while it plays, and Esc or F leaves. Where a browser has no full screen for a page's element (an iPhone's Safari), the
same mode fills the window (`play/site/src/lib/stories/StoryPlayer.svelte`).

**A transition is code** (Samuel 2026-11-04: a fade is a transition like any other, set by a proposal like any other
field). A shot's `transition` holds codes separated by commas (`;` and `·` too), each read from its start, with its
seconds where it gives them (`transitionOf`): `cut` (and a hard, smash, match or jump cut, "cut to …") goes into the
next shot at once; `dissolve` or `cross-fade` [s] fades the next shot in over it (0.5 s unless it says, at most half of
either shot); `from black` or `fade in` [s] brings this shot up from black; `to black` or `fade out` [s] takes it down
to black; `dip to black` [s] takes it down and brings the next up out of black. Anything else is prose about the
transition, and a shot whose codes name no cut goes into the next with a short dissolve. A film opens out of black
with its first shot's `from black 0.7, cut`.

**Versioned like assets: the content-addressed DAG of §4.**

```sql
stories         (id UUID /*§4.7*/, coop_id, title /*its head's*/, head → story_versions, created, updated)
story_versions  (id /*BLAKE3 of canonical {story, parents, title, body}, as asset versions' ids (versions.ts)*/,
                 story_id, parents text[], number /*v1, v2 …, given on accept, shown only*/, title, body jsonb /*story/1*/,
                 note, author → humans, approved_by → humans, created)
                 -- immutable: a trigger refuses UPDATE and DELETE (only number/approver are set once, on accept)
intents         (… work 'story_version', story_id, story_base → story_versions, story_version → story_versions)
```

- A version's id is its content's: the same story, parents, title and timeline give the same id; any change to any
  of them, or to the history it stands on, gives another, so history can't be rewritten without the ids changing.
- Each version names its parent; an intent's work names the **base** it was made on.
- **Accept** is the asset versions' transaction: it checks `stories.head = intent.story_base`, gives the version
  the next number and moves the head (and the story's title), and the intent is Accepted. Work whose base is no longer
  the head still goes in where the two changes touch **different fields**: both stand, in a new version whose parents
  are the head and the work's (its note says it was merged). Where they touch **the same field** it is **archived**,
  never accepted: it is proposed again on the new head. Archived work stays as side lines in the history; its versions
  keep no number.
- The repo's stories (`play/api/import/stories/<folder>/`, `story.json`, whose `id` is the story's UUID, and its
  `frames/`) are written once, as their accepted v1, by the import every deploy runs, only where play holds no story of
  that id (`import/stories.ts`).

**Changed only by proposal, over MCP.** No page and no route edits a story: `GET /api/stories` and
`GET /api/stories/:id[?v=n|?edit=n|?intent=id]` read them (admins), and a story changes only by an admin's agent
proposing over play's MCP server (§7, `play/api/src/mcp.ts`), versioned as every kind is (§4.15):

- `list_stories`, `get_story` (its head, an accepted version, an edit or an intent's variant, with its versions);
- `propose_story`: a new story, as its whole timeline;
- `propose_doc_version`: a new version, as its whole timeline or as **edits applied to the head**: `set_clip`
  (any field of any clip; null removes one), `add_clip`, `remove_clip`, `add_track`, `remove_track`, `set_track`,
  `shift` (every clip from a time on moved by some seconds, to make room or close a gap) and `set` (format, fps, title).
  What is stored is the whole timeline, checked as a whole: its format, unique ids, times, no overlaps, every frame
  an image play holds;
- `add_story_frame`: an image (JPEG, PNG or WebP, up to 4 MB) as base64, kept as a file; its hash for a shot's frame.

The intents' board shows an intent's story work played in the Stories player, beside what changed against its base
(the title and settings, and track by track the clips added, removed, moved and changed) and the edits it was made in.
Admins accept or archive the intent there. No tool accepts; the agent that proposed it may archive it while it waits
(`archive_intent`: one it no longer stands by; to replace its work, it proposes again for the same intent), and nothing
else of anyone's.

**Every edit kept: each story is a Loro document (§4.4, §4.15).** Under its versions, story `x` (its UUID) is the document `story:x`
(its title and its timeline; a clip's line, transition, camera and retention Loro texts), every change an edit with
its author, its means, its message and its time (`play/api/src/storydocs.ts`):

- every intent's work is an **intent variant** of the document; accepting merges it into Main, and the document's
  version of the same number is named with the BLAKE3 of its content. Versions and documents stay in step, number for number;
- an agent can make a change **edit by edit**: `doc_edit` (`message`, and edits, or the whole story; plus `edit_text`,
  a range of one of a clip's texts) adds an edit to an intent variant (a new one seeded from the head if none is
  named), each checked whole; `propose_doc_version` with its `variant` proposes it, its edits going with it;
- `doc_history` lists every edit (Main's with every accepted work's; or one intent variant's) and `get_story`'s `edit`
  reads the story at any of them; the Stories page reads them (`GET /api/docs/:id/history`, `GET /api/stories/:id?edit=`)
  in its History tab and plays the story as it was at any edit;
- a story from before the documents gets one from its history the first time it is touched, and at every deploy's
  import: each accepted version an edit at its date, named its number, and each intent's work waiting at Proposal an intent variant seeded at its base.
