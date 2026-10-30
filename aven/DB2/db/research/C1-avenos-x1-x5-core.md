# C1: avenOS's universal predication engine, the x1–x5 schema and its Lojban ontology (June–July 2026)

Research notes, not a spec: the core of what the [ontology](../ontology/README.md) and [engine](../engine/README.md)
proposals learn from. Read on 30 Oct 2026 by the avenONTOLOGY session in the public repository `MyAvenCEO/avenOS` at
commit `2894d6eb` (2026-07-05), a single squash of boards 0087–0119; snippets are quoted from that commit. Boards are
under `libs/aven-board/board/`. The invoice vertical, caps of that era and the aftermath are in
[`C2-avenos-invoice.md`](C2-avenos-invoice.md).

## 1. The arc, board by board

- **0085 (06-29, discover), universal predication schema.** One predicate vocabulary covering all 9 doctypes then on
  mainnet (todos, contact, invoice_doc, booking/SKR04, tx, match, invoice, bank_statement, contract). "Every fact is
  `predicate + positional places x1…x5`, each place a **value** (literal) or a **ref** (`data_value.id`, polymorphic —
  `references:"*"`)". Three principles: (1) **time is a predicate** (`valid(x1=fact, x2=from, x3=to)` plus `asserted`
  for transaction time; "done" = set `valid.x3`); (2) **a ref points at anything**: entities decompose into bundles of
  small predications sharing a ref, and nested arrays become child predications; (3) **the registry is predications
  too** (eventually). "The single fixed thing is the meta-grammar `predicate + x1…x5`."
  - **The naming rule (locked):** "predicate names are pragmatic English, but each predicate's x1–x5 place structure is
    reused from the canonical Lojban gismu where one applies, recorded as a `gismu:` provenance field" (pays≡pleji,
    address≡judri, names≡cmene, person≡prenu, company≡kagni, exchanges≡canja, manages≡jatna, note≡notci,
    sourced_from≡krasi). Domain gaps (SKR04 Soll/Haben/Konto) get coined names and glosses.
  - **Coverage is the metric:** a mapping table (doctype field → predicate and place) and a test that fails on any
    unmapped field. CRUD was not rewritten: predications rode the existing AJV `data_crud`.
- **0087:** the todos vertical, hand-coded (`executeTodos` writing task, valid, due and prioritized at fixed positions,
  plus a `v_task` view). The prototype to generalise.
- **0088 (06-29), universal predication CRUD/query engine.** The full engine in one card: (1) an admin-owned **type
  registry** `predicate_type`, each row a bundle spec; (2) a **generic mutator** `mutate(type, action, items)`; (3) a
  **Datalog-style x1–x5 matcher** `query(type, where?)`, replacing per-type SQL views; (4) one universal
  `data_crud(type, action, …)`. Proven by **parity** with 0087's hand-code, which was then deleted. A pure library,
  `libs/aven-ontology` (engine plus an in-memory store, unit-tested without a database).
- **0097 (06-30), canonical ontology re-audit.** Two systemic faults:
  - **(A) incompleteness:** 31 of 34 predicates declared only the places they used. The rule became: carry **all** of the
    gismu's x1–x5, the unused ones optional.
  - **(B) proliferation:** `email`, `phone`, `iban` and `postal` were each ≡ judri; `vat_id` and `tax_number` each ≡
    cmene. The rule became **type by x-position**: one `address`≡judri with x3 a seeded addressing-system entity
    (`addrsys-email`…); one `identifier`≡tcita with x1 an id-kind entity (`idkind-vat_id`, `idkind-invoice_number`…);
    the doc type as `kind`≡tcita (`doctype-*`); `classified`≡klesi removed. Samuel's prompt for it: "having for phone
    and postal the same judri feels weird, shouldn't it be just one judri schema with an address typed by x position?"
  - The gate: `libs/aven-vibes/tests/predicate.test.ts` checks every predicate, with no exclusions, against
    `gismu.json`: the same positions, the same ref/value kind, the complete set.
- **0099 (07-01):** strip to the todos core (finance was a dead end; the engine was kept).
- **0100 (07-02), dynamic ontology skill.**
  - **One registry:** `data_schema` holds every predicate definition; composite types may fold in as `kind='type'`; no
    separate vocabulary table.
  - **Enforced x1–x5 columns:** `data_value(id, user_id, predicate, x1…x5)` (migration 0049, indexed). "Columns enforce
    the structure; the data_schema AJV config validates the values per place."
  - A GLM-5.2 "ontology" actor reads the registry and mints new validated predicates with zero TypeScript changes:
    dedup first, the gismu's full place structure, AJV self-validation, persisted.
  - Live acceptance: "a person can be a member of a project" → GLM chose `cmima` → minted `member_of` (x1 member · x2
    set).
  - A mint took about 50 s with a ~900k-character gismu prompt; later the compact `gismu.tsv` (~130 KB) was used.
  - The card's goal tests only the deterministic pipeline; the quality of what GLM mints is a human review step.
- **0101 (07-02), dynamic queries and mutations as validated specs.** Tables `data_queries` and `data_mutations` of
  AJV-validated JSON specs; "GLM authors a validated SPEC, NEVER raw SQL"; filter, join and count (with HAVING);
  mutations in one transaction; a delete needs a person's confirmation. Tests: owners with more than 3 `owned_by`; a
  transfer of ownership applied transactionally; a bad op rolls back; an injection-like value stays a bound parameter.
- **0102 (07-02), dynamic bundles.** GLM mints composite types.
  - The taxonomy, settled: an **entity** is a live bundle of predications; a **bundle** is the recipe (TypeSpec), made of
    **traits** (PartSpec) and a **view** (the projection).
  - `predicate_type` renamed to `data_bundles` (migration 0058, which did nothing on a fresh database and broke the
    deploy; fixed by 0113).
  - The hard-coded domain specs were deleted and frozen as `legacy-bundle-fixtures.ts`, so the todos bundle exists only
    as database config, like a GLM-minted bundle.
  - `mintBundle`: author → AJV against the TypeSpec meta-schema → mint missing predicates through 0100 → `saveType`.
    Live check: "track books I read with a rating".
- **0103 (07-02), reified nested facts.** Triggered when the mutate actor stored `eats(x1="I", x2="2 bananas")`.
  - **Verdict: no new storage model** (no leaf/composite trees). "Flat `(predicate, x1..x5)` + referents already express
    arbitrary nesting … even statement-level nesting works (a place holding another predication's row id = Lojban
    `nu`/`du'u` abstraction). Explicit leaf/composite trees would LOSE role semantics, indexed SQL queryability, and
    per-predicate AJV validation — the RDF/blank-node lesson."
  - `B = new referent; banana(x1=B) ≡badna; quantity(x1=B, x2="2", x3=count) ≡klani; eat(x1=me, x2=B) ≡citka`.
  - The engine gap closed: the cross-op `{"ref": n}`. The prompt rule: reify, don't pack.
- **0104 (07-02), one `data_operations` table:** `(id, user_id NULL, name, kind CHECK in ('query','mutation'), spec
  jsonb, derived_from NULL)`.
  - "query = ASK · mutation = CHANGE · bundle = DEFINE A KIND". **Bundles are DDL, operations are DML**, and bundles
    **compile to operations** (`deriveOps`) rather than living in the operations table.
  - An operation row is a template; execution is forced to the calling `user_id`. Derived operations are global rows
    (user_id NULL); GLM-authored ones are user-scoped.
  - The grammar grew: `join.kind:'left'`; projections `{place, as, join}` and `{join, exists, as}`; an op-level `when`
    guard; an `update` op (patch in place, because delete+insert mints a new id and breaks referents); a reserved
    `{bind:'$user'}`. Parity was the gate before todos were rerouted through operations.
- **0107:** filters may target a join; `isnull` and `notnull`; `crud()` routes to named operations.
- **0110:** fully dynamic config, with the actors' prompts in database rows.
- **0112 (07-03), one universal operations engine.**
  - **Chained joins:** `on.base` may reference a strictly earlier join, `{join: N, place}`, refused otherwise like
    `{ref}`. Full recursion was deliberately left out.
  - **The second engine deleted** (`executeDataTool → loadTypeSpec → runType → runViaOps / runTypeInterpreted`, about
    350 lines); `deriveOps` survives only as the save-time seeder.
  - The authoring prompts moved onto the `query` and `mutate` actor rows, with the TypeScript constant as fallback.
  - Also: `many` traits (0..N satellites such as tags: delete-cascade only, left out of list joins and of
    create/update), and **reification** by name: `refType` (a field holding another entity's name is resolved to its id,
    finding or creating that entity) paired with a `refName` projection.
  - String `eq`/`neq` compare case-insensitively: "the single reason 'show me my Healthy Eating todos' returned 0".
- Later in the same squash: 0113 GLM skill minting; 0117 cross-skill connector actors with schema-scoped `ops:<type>`
  caps for sandboxed actor code. Then on 07-18 Calendar, Dienstplan and Kontakte on flat bundles with reified edges
  (`staffed_by`≡gunka), and on 07-31 the whole repository was stripped (board 0121).

## 2. The predicate definition and its compiler (`libs/aven-vibes/src/predicate/compile.ts`)

```ts
export type PlaceKind = 'value' | 'ref'
export type PlaceType = 'string' | 'number' | 'quantity' | 'boolean' | 'date-time'
export type PlaceDef = { pos: string /* x1..x5 */; role: string; gloss: string; kind: PlaceKind;
  type?: PlaceType /* value */; references?: string /* ref, '*' = polymorphic */; required?: boolean /* default true */;
  nullable?: boolean; minLength?: number; example?: string }
export type PredicateDef = { predicate: string /* English */; gismu?: string | null; gloss: string; places: PlaceDef[] }
const ID_PATTERN = '^[\\w-]{6,}$'   // a data_value UUID or a Better-Auth user id
const DATETIME_PATTERN = '^\\d{4}-\\d{2}-\\d{2}([T ]\\d{2}:\\d{2}(:\\d{2})?(\\.\\d+)?(Z|[+-]\\d{2}:?\\d{2})?)?$'
// ref(pos, role, gloss, opts) → { kind: 'ref', references: '*' }; val(pos, role, gloss, type, opts) → { kind: 'value', type }
// "board 0097 demands every predicate carry ALL of its gismu's places (x1–x5); the ones our domain doesn't fill are
//  declared required: false"
```

`compilePredicate(def)` emits `{ type: 'object', title: predicate, description: gloss, 'x-gismu': gismu, required:
['predicate', …required places], additionalProperties: false, properties: { predicate: { const }, xN: { title: role,
description: gloss, examples, type, pattern, 'x-ref': references } } }`. The shared AJV had no `ajv-formats`, so it emits
`pattern`, never `format`. The schema's name is the bare predicate ("no namespace prefix leaks to the DB/UI"). It is
self-documenting on purpose: the same schema goes into the model's prompt and the database viewer.

An example (`invoice-vocab.ts`, completed to full places in 0097):

```ts
export const INVOICE: PredicateDef = { predicate: 'invoice', gismu: 'janta',
  gloss: 'janta: x1 (the bill/account — the invoice entity) for goods x2, billed to party x3 by biller x4',
  places: [
    ref('x1', 'account', 'the bill/invoice itself — janta x1 (the row; implicit, the entity)', { required: false }),
    ref('x2', 'goods', 'the goods/services billed — janta x2 (open; itemised as line children)', { required: false }),
    ref('x3', 'billed party', 'who the invoice is billed to — janta x3 (the debtor; us)', { references: 'user' }),
    ref('x4', 'biller', 'who issued the invoice — janta x4 (the vendor company, a contact ref)', { required: false }) ] }
// total≡jdima (x1 price value · x2 item · x3 purchaser · x4 vendor); line≡pagbu (x1 part · x2 whole);
// description≡skicu (x4 text); quantity≡klani (x1 thing · x2 amount · x3 scale); unit_price, line_amount≡jdima;
// payment≡pleji (x1 payer · x2 amount · x3 payee · x4 goods); paid_on≡detri
```

- **The row is the entity.** For janta, pagbu, prenu and kagni, x1 is the entity itself, left implicit as the row's id.
  So `person` and `company` are rows with no places filled, and everything else hangs off their id.
- **Contact consolidation** (`contact-vocab.ts`, 0097): `address`≡judri (x1 value · x2 entity · x3 system, a ref to
  `addrsys-{email,phone,iban,postal}`); `identifier`≡tcita (x1 kind, a ref to `idkind-{vat_id, tax_number,
  invoice_number, currency, exchange_rate, …}` · x2 the tagged entity · x3 the value); `name`≡cmene (x1 name · x2 named
  · x3 namer); `represents`≡krati (an Ansprechpartner is a `person` who represents a `company`); `transaction`≡pleji;
  `dated` and `value_dated`≡detri; `booked`≡cmima to `skr04-6810`; `balance`≡klani; `matched`≡mapti.
- **A weak point:** `addrsys-*`, `idkind-*`, `doctype-*` and `skr04-*` were constant strings in ref places, not real
  rows.

## 3. The gismu table (`.claude/skills/ontology/` in avenOS at `2894d6eb`)

The only thing that survived the 07-31 strip.

- `gismu.json`: 1341 roots, enriched by a model letter by letter (`parts/*.json`, merged by `scripts/merge-parts.mjs`).
- `gismu.tsv`: the raw `word \t definition \t keywords`.
- `gismu.base.json`: parsed from the TSV by `scripts/build-gismu.mjs`.

An entry:

```json
"cmima": { "gismu": "cmima", "name": "member", "source": "lojban",
  "description": "x1 is a member/element of set x2; x1 belongs to group x2; x1 is amid/among/amongst group x2.",
  "keywords": ["belong to; be a member of", "member"], "arity": 2,
  "places": { "x1": { "role": "member", "definition": "the member or element", "example": "the senator", "kind": "ref", "references": "*" },
              "x2": { "role": "set", "definition": "the set or group", "example": "the senate", "kind": "ref", "references": "*" } } }
```

`judri`: x1 address (a string value) · x2 located (ref) · x3 system (ref). `ponse`: x1 owner (ref) · x2 possession
(ref) · x3 standard (a string value). The skill's use: grep the keywords to find a relation, reuse its place order,
give it an English name, record `gismu` as provenance. It was also meant as the fixed reference for a later
"discover-&-consolidate" alignment of vocabularies across peers.

## 4. Bundles: the TypeSpec model (`libs/aven-ontology/src/types.ts`)

```ts
export type Cell = string | null                 // places store only strings or null (a weakness: money as text)
export type Place = 'x1' | 'x2' | 'x3' | 'x4' | 'x5'
export type Row = { id: string } & Partial<Record<Place, Cell>>
// Bind: '$user' | '$primary' | '$parent' (while creating a child) | '$now' | '$value' | '$value?$now:null' | a literal
export type PartKind = 'primary' | 'singleton' | 'replace' | 'children' | 'many'
export type PartSpec = { pred: string; link?: Place /* the place on THIS predication holding the primary id */;
  kind: PartKind; field?: string; create?: Partial<Record<Place, Bind>>; set?: Partial<Record<Place, Bind>>;
  childSpec?: TypeSpec; fields?: Partial<Record<Place, string>> /* primary: extra input fields to its own places */;
  match?: Partial<Record<Place, Cell>> /* a discriminator: fixed cells written on insert, scoping the replace-delete
                                          and the projection, so several parts can share one predicate */;
  refType?: string /* 0112: the field is another entity's name, resolved to its id (found or created) */ }
export type ProjectSpec = { pred: string; place?: Place; notNull?: Place /* a boolean: the place is present */;
  children?: boolean; match?: Partial<Record<Place, Cell>>; refName?: boolean /* project the referenced entity's name */ }
export type TypeSpec = { type: string; parts: PartSpec[]; project: Record<string, ProjectSpec> }
export interface PredicationStore { rows(p); insert(p, cells): Promise<string>; patch(id, cells);
  patchWhere(p, place, equals, cells); deleteWhere(p, place, equals); remove(id) }
```

- `primary`: its rows are the entities.
- `singleton`: exactly one linked row, created with the entity and patched in place.
- `replace`: an optional attribute, deleted and re-inserted when set, cleared when empty.
- `children`: a 0..N array, each element its own sub-entity (`childSpec`, linked by `link` bound to `$parent`),
  replaced wholesale on update.
- `many`: 0..N satellites, declared only so that deletion cascades.

The todos bundle (the frozen fixture):

```ts
{ type: 'todos', parts: [
    { pred: 'task', kind: 'primary', field: 'title', create: { x1: '$user', x2: '$value' }, set: { x2: '$value' } },
    { pred: 'owned_by', kind: 'singleton', link: 'x2', create: { x1: '$user' } },
    { pred: 'done', kind: 'replace', link: 'x1', field: 'done', set: { x1: '$primary' } },
    { pred: 'due', kind: 'replace', link: 'x2', field: 'due', set: { x1: '$value', x2: '$primary' } },
    { pred: 'prioritized', kind: 'replace', link: 'x1', field: 'priority', set: { x1: '$primary', x2: '$user', x3: '$value' } } ],
  project: { title: { pred: 'task', place: 'x2' }, done: { pred: 'done', notNull: 'x1' }, due: { pred: 'due', place: 'x1' },
             priority: { pred: 'prioritized', place: 'x3' }, owner: { pred: 'owned_by', place: 'x1' } } }
```

0085's `valid(x1, x2, x3)` time predicate was replaced in practice by a presence satellite, `done`≡mulno. The invoice
bundle used `children` for `line` (child primary `line` with x2 = `$parent`, plus description, quantity, unit_price
and line_amount) and for `payment` (linked by x4), and a discriminated replace `identifier` with
`match: { x1: 'idkind-invoice_number' }`.

## 5. Bundles compile to operations (`libs/betterauth/src/derive-ops.ts`)

"A bundle compiles to OPERATIONS … `<type>.list` (query) — the primary predicate LEFT-joined to each satellite,
projected as the view; `<type>.create` (mutation) — insert the primary (op 0 = the entity id) + singleton +
when-guarded replace inserts; `<type>.update` — patch the primary + clear/re-insert each replace attribute
(partial-safe); `<type>.delete` — cascade-delete the primary + every linked satellite. SQL analogy: the bundle is
CREATE TABLE, these ops are the SELECT/INSERT/UPDATE/DELETE."

- How binds become cells: `$user` → `{bind:'$user'}`, `$now` → `{bind:'$now'}`, `$value` → `{param: field}`,
  `$primary` → `{ref:0}` on create or `{param:'id'}` on update and delete. Any other `$` bind throws ("conditional
  binds not yet derivable").
- **It throws loudly on `children` and `match` traits** ("never a silent partial derivation"). `many` derives only its
  delete-cascade.
- `saveType` regenerates a bundle's derived operations on every save (`derived_from = <bundle>`).

## 6. The operations grammar and engine (`libs/betterauth/src/queries.ts`, final at 0112)

```ts
type BinOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in'; type NullOp = 'isnull' | 'notnull'
export type Filter = { place: Place | 'id'; op: Op; value?: unknown; param?: string; join?: number }
type JoinBase = Place | 'id' | { join: number; place: Place | 'id' }          // chained: a strictly earlier join only
export type JoinSpec = { predicate: string; on: { place: Place; base: JoinBase }; kind?: 'inner' | 'left' }
export type ProjectEntry = Place | 'id' | { place: Place | 'id'; as?: string; join?: number } | { join: number; exists: true; as: string }
export type QuerySpec = { name?: string; from: string; where?: Filter[]; join?: JoinSpec[]; group_by?: Place;
  count?: { having?: { op: Op; value: number } }; project?: ProjectEntry[] }
export type MutationOp = { op: 'insert' | 'delete' | 'update'; predicate: string; where?: Filter[];
  cells?: Record<string, unknown>; when?: { param?: string /* skip when falsy */; present?: string /* skip when absent */ } }
export type MutationSpec = { name?: string; params?: string[]; ops: MutationOp[] }
```

- Both are validated by fixed AJV meta-schemas (`QUERY_META_SCHEMA`, `MUTATION_META_SCHEMA`, with
  `additionalProperties: false` throughout) before they are stored or run.
- `compileQuery(uid, spec, params)` builds one parameterized SQL statement: `SELECT … FROM data_value b [LEFT] JOIN
  data_value jN ON jN.user_id = b.user_id AND jN.predicate = $ AND jN.<place> = <b.<base> | jM.<place>> … WHERE
  b.user_id = $uid AND b.predicate = $from AND … [GROUP BY b.<place>] [HAVING count(*) <op> $n]`.
- Columns come only from an allow-list (`x1..x5`, `id`) through `sql.ref`; operators from a fixed map; every value is
  bound. String `eq`/`neq` compare `lower()` on both sides. A count query returns `{key, n}`; a projection with no
  entries returns x1 to x5.
- `resolveCell`: a literal, `{param}`, `{bind: '$user' | '$now'}`, or `{ref: n}`. `n` must be an integer index of a
  strictly earlier op that was an insert and generated an id; otherwise it throws.
- `runMutation` runs all ops in one transaction. An insert needs the predicate's `data_schema` row ("mint it first").

Specs from the tests that prove it:

```json
{"from":"owned_by","group_by":"x1","count":{"having":{"op":"gt","value":3}},"project":["x1"]}
{"params":["thing","from","to"],"ops":[
  {"op":"delete","predicate":"owned_by","where":[{"place":"x2","op":"eq","param":"thing"},{"place":"x1","op":"eq","param":"from"}]},
  {"op":"insert","predicate":"owned_by","cells":{"x1":{"param":"to"},"x2":{"param":"thing"}}}]}
{"ops":[{"op":"insert","predicate":"banana","cells":{"x1":"owner-me"}},
        {"op":"insert","predicate":"quantity","cells":{"x1":{"ref":0},"x2":"2"}},
        {"op":"insert","predicate":"eat","cells":{"x1":"owner-me","x2":{"ref":0}}}]}
{"from":"item","join":[{"predicate":"quantity","kind":"left","on":{"place":"x1","base":"id"}},
                       {"predicate":"unit","kind":"left","on":{"place":"x1","base":{"join":0,"place":"id"}}}],
 "project":["id",{"place":"x2","as":"name"},{"join":0,"place":"x2","as":"qty"},{"join":1,"place":"x2","as":"unit"}]}
```

The last is "2 kg of rice": the unit points at the quantity's row, so projecting it needs a join on a join. The result
was `[{ id, name: 'rice', qty: '2', unit: 'kg' }]`. Forward and self chain references are refused before any SQL. A
bad op (an insert into a predicate that doesn't exist) rolls back the delete before it.

## 7. GLM authoring: how the model grew the schema while it ran

**The ontology tool** (`skills/tools/ontology.ts`): `{ name: 'ontology', description: 'Read the user's x1–x5
relationship types, or CREATE a new one from plain language (e.g. "people can own companies", "a project has
members"). create mints a gismu-based predicate (reusing an existing fit); read lists them. SCHEMA (relationship kinds)
only — todos/data rows → data_crud.', parameters: { action: 'read' | 'create', request, response } }`.

**`CREATE_INSTRUCTIONS`**, verbatim:

> You mint NEW x1–x5 Lojban predicates for the relationship(s) the user describes, grounded in the gismu dictionary
> provided below.
>
> RULE 0 — ONE PER RELATIONSHIP: if the user describes SEVERAL relationships in one request (e.g. "eating and
> drinking", "owning and renting"), define EACH one separately — one output entry per relationship (eating → citka,
> drinking → pinxe). Never collapse distinct relations into one predicate.
>
> RULE 1 — REUSE FIRST: for each relation, search the EXISTING predicates listed below. If one already means the same
> relation, REUSE it (return its name) instead of minting a near-duplicate.
>
> RULE 2 — FULL PLACE STRUCTURE: when you do mint, define EVERY place the chosen gismu declares in the dictionary — its
> complete canonical place structure x1…xN — never a request-trimmed subset. For EACH place give its role, gloss, and a
> correct validation config: kind "ref" for an entity/id place, or kind "value" with a JSON type ("string" | "number" |
> "integer" | "boolean" | "date") for a literal. Define ALL places EVEN IF the user's request only fills some of them —
> the stored predicate is the whole gismu, so it stays a faithful, reusable relation. Mark places the request does not
> fill as optional (required:false); never drop them.

**The mint system prompt** (`libs/betterauth/src/ontology.ts`) is built from:

1. the `ontology` actor row's prompt, or `CREATE_INSTRUCTIONS` as fallback;
2. "EXISTING PREDICATES (reuse one of these names if it already fits):" followed by `name — gloss` lines;
3. "OUTPUT — return ONLY a JSON ARRAY … one entry PER relationship …", each entry `{"reuse":"<name>"}` or
   `{"predicate":"<english_snake_case>","gismu":"<root>","gloss":"x1 … x2 …","places":[{"pos","role","gloss","kind":"ref"|"value","type","references":"*","required"}]}`;
4. the whole `gismu.tsv`.

GLM-5.2 ran through Tinfoil. The handler checks each result against the registry, and against earlier entries of the
same batch, then compiles, validates with AJV and persists it. `findExistingPredicate` matches the exact name, then
name↔keyword/gloss overlap. Its weakness: no structural or embedding match.

**`QUERY_INSTRUCTIONS`** (the core, verbatim): "You author a QUERY SPEC — a small JSON object the engine compiles to ONE
safe, parameterized SQL over the x1–x5 predication store. You NEVER write SQL. Output ONLY the JSON object …", then the
grammar and three rules:

- **Filters:** "A `where` entry filters the base predicate, OR — with "join":N — the N-th join (0-based). The two
  EXISTENCE ops take NO value: "notnull" = the (LEFT-joined) satellite row is PRESENT, "isnull" = ABSENT."
- **Joins:** "Correlate a satellite on the base ROW ID with "base":"id" … Use "kind":"left" so base rows survive when
  the satellite is absent — REQUIRED for isnull."
- **Chains:** "base may instead reference an EARLIER join … N must be a STRICTLY EARLIER join index."

Its worked examples:

- done todos: `{"from":"task","join":[{"predicate":"done","kind":"left","on":{"place":"x1","base":"id"}}],"where":[{"join":0,"place":"id","op":"notnull"}],"project":["id",{"place":"x2","as":"title"}]}`
- open todos: the same with `isnull`;
- due by a date: a left join on `due` with `x1 lte` the date;
- owners of more than 3 companies: as in §6.

**`MUTATION_INSTRUCTIONS`**: "You author a MUTATION SPEC — a small JSON object the engine runs as ONE all-or-nothing
transaction of predication writes. You NEVER write SQL." Then the params and ops grammar; "A transfer of ownership X→Y
of thing T over owned_by(x1=owner, x2=thing) = delete the old (x1=X, x2=T) then insert the new (x1=Y, x2=T), one
spec"; "Prefer literal values from the request"; and, from 0103, reify, don't pack, with the banana example and
`{ref}`.

**`mintBundle`** (`type-caps.ts`): GLM authors a TypeSpec grounded in the live predicates, the bundle meta-language
(`TYPE_META_SCHEMA`, with a recursive `childSpec`) and the existing bundles. AJV checks it; missing predicates are
minted through the ontology path; then `saveType`, which also seeds the derived operations.

## 8. What this means for avenDB

**Keep:**
- one fixed grammar;
- English names with gismu places, carrying the full place structure;
- type by position;
- reify, don't pack (`{ref}`);
- specs validated by fixed meta-schemas, never SQL or code from a model;
- one engine, with bundles compiled to stored operations when saved, and parity before deleting an old path;
- prompts as data;
- tests of the deterministic part, with the model's quality as a human gate.

**Fix:**
- typed values (money as minor units and a currency, never a string);
- typed refs (`references: '*'` checked nothing);
- predicates named by hash rather than name, with real category entities instead of constant strings;
- a compiler that handles `children` and `match`;
- samples that round-trip, closing the 22-of-49 gap ([C2](C2-avenos-invoice.md));
- vocabularies beyond one user, with alignment;
- a gismu shortlist instead of the whole table in every prompt;
- caps that reach facts;
- a merge story between peers (slot ids).

All of it is taken up in [`../ontology/README.md`](../ontology/README.md) and [`../engine/README.md`](../engine/README.md).
