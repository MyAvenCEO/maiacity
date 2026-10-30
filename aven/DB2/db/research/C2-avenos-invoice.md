# C2: the avenOS invoice vertical on Lojban predications, caps of that era, and what happened after

Research notes, not a spec, by the avenONTOLOGY session (30 Oct 2026). Repo: github.com/MyAvenCEO/avenOS (public).
The core engine is in [`C1-avenos-x1-x5-core.md`](C1-avenos-x1-x5-core.md).
Reference commit `2894d6eb` (2026-07-05). Citation form: `commit:path:line`. Unless stated otherwise,
board files are cited from `2894d6eb` (`B/` = `libs/aven-board/board/`).

---

## 0. Two facts to know before reading the rest

1. **History is squashed.** The whole arc from migration 0008 up to migration 0113 (boards 0087–0119, which
   cover the invoice vertical, its strip and the dynamic-skills work) is ONE squash commit, `2894d6eb`
   (407 files, +129k lines). Its parent `61004ad2` has migrations only up to 0007. `git fsck --unreachable`
   finds no dangling objects. So the **invoice actors' source is gone**: `extract_document`,
   `enrichAddressbook`, `storeDocument`, `classify_document`, `humanReview` and the old `aven-ontology`
   invoice spec files. Three things survive and are the evidence base here:
   - the migrations (they embed prompts, schemas and flow nodes),
   - the **frozen bundle snapshots** `2894d6eb:libs/betterauth/src/legacy-bundle-fixtures.ts`
     (INVOICE/COMPANY/PERSON/TRANSACTION/DOCUMENT/TODO_SPEC, "captured verbatim so migration replay stays
     byte-identical", lines 1-5),
   - the predicate vocab files `libs/aven-vibes/src/predicate/*` plus their gate test. These were kept
     because migrations and the gate test import them.
2. **The invoice-on-predications vertical lived about 3 days.** Board 0089 started on 2026-06-29. Board 0099
   ("strip to core", review) deleted every document, invoice and finance vertical on **2026-07-01**
   (`B/review/0099-strip-to-core.md:146-189`, migration 0046). So at the reference commit the invoice
   vertical is already gone. The commit title says "boards 0099-0119" because the strip is the first step of
   that arc.

To get concrete data despite the deleted code, I **replayed the frozen specs through the real engine**
(`2894d6eb:libs/aven-ontology/src/engine.ts` + `memstore.ts`):
two replay scripts (one invoice with its parties, and the extraction fixture against INVOICE_SPEC). The scripts lived in
that session's scratchpad and are not kept; every row below marked "engine replay" is real engine output from those
specs, not hand-written, and can be reproduced from the frozen specs and the engine at `2894d6eb`.

---

## 1. Timeline of the invoice vertical (all within `2894d6eb`)

| Date | Board | What landed | Migrations |
|---|---|---|---|
| 06-29 | 0087 | Two-layer split. **Layer A** = admin config tables (`flow`, later `predicate_type`). **Layer B** = per-user `data_schema`/`data_value`, "reserved for dynamic AI/user-generated predication roundtrips". Predicate compiler (gismu → Ajv) | 0008 `flow`, 0009 `v_task` view |
| 06-29 | 0088 | Generic predication engine + `predicate_type` registry (lead covers this) | 0014 |
| 06-29 | 0089 | Generic flow runner, content-addressed `artifact` store (bytea, sha256 PK), `document` type with `krasi` provenance + `finti` lineage, `flow_run`, `run_skill` chat tool | 0017, 0018, 0019 |
| 06-29 | 0090 | `invoice` type (janta/jdima/vendor + due/krasi/finti). Old JSON-blob `invoice` schema parked, migrated and dropped. Real runs replace fixtures | 0020-0023 |
| 06-29/30 | 0092 | SSOT plan: canonical gismu places, universal `owned_by`≡ponse, full invoice granularity (lines, payments), nested `children` engine primitive, contact graph (person/company/represents), transaction | 0025-0029, 0031 |
| 06-30 | 0093 | Flow-node config becomes the SSOT for the extraction prompt and schema. Generic `extract_document`. `enrichAddressbook` creates company + Ansprechpartner and links `billed_by`. `invoice-ingest` deleted. Invoice flow scoped to capture-only | 0030, 0032, 0033 |
| 06-30 | 0094/0095/0096 | Per-step vibes (StepVibe = one renderer), full DocCompareVibe invoice card, addressbook read from company/person predications | 0034-0036 |
| 06-30 | 0097 | Re-audit: every predicate carries ALL gismu places. Channels → one `address`≡judri; identifiers → one `identifier`≡tcita; doc type → `kind`≡tcita; `vendor`/`classified`/`number` retired. Neon branch reset fresh | 0037, 0038 |
| 07-01 | 0098 | Bank statements: trigger, full transaction fidelity, `matched`≡mapti reconciliation, single-entry `booked`≡cmima P&L. Flat `tx`/`match`/`booking` retired. Reference OCR prompts ported, compact schemas, two-pass parties+body extraction | 0039-0045 |
| **07-01** | **0099** | **Strip: every non-todos vertical deleted.** Keep the engine, runner, vibes and `skr.ts` | **0046, 0048** |

---

## 2. The invoice flow, PDF in → predications → read back → render

### 2.1 Flow definitions (Layer A, `flow` table)

Seed source: `2894d6eb:libs/aven-skills/configs/flows.json` (the seed survived the strip).
- `doc-ingest` "Document Ingest" (`flows.json:2-62`): `ingest` (actor `storeDocument`) → `classify` (actor `classify_document`, gemma4-31b vision, vibe `bookkeeping`, prompt "You are a bookkeeper. Determine the document type: invoice, bank_statement, contract or other…").
- `capture` **"Map Brain (Invoice)"** (`flows.json:63-118`): `extract` (actor `extract_document`, gemma4-31b vision + tool mode, tools `extract_document`, `emit_invoice`) → `enrich` (actor `enrichAddressbook`, "Create/update the contact (match by VAT-ID / IBAN / name) + persist the invoice").
- `capture-bank` "Map Brain (Kontoauszug)" (`flows.json:119-174`) has the same shape for bank statements.
- `book` "Bookkeeping" (`flows.json:175-238`): `match` (`matchInvoiceAgainstTx`) → `post` (`bookInvoice`, "Post the incoming invoice in SKR04 … Split booking on mixed rates").
- `invoice` "Invoice Processing" (`flows.json:239-336`) is a **composite** of flowRefs: `ingest-doc`→`doc-ingest`, `capture`→`capture`, `book`→`book`, then `review` (actor `humanReview`, `hitl: true`). The runner **flattens** composites before running them (`B/review/0090-…:115-118`).
- What actually ran: migration 0032 cut `invoice` down to **capture-only**, because `book` and `humanReview` had no runner actors (`2894d6eb:libs/betterauth/migrations/0032_invoice_flow_capture_only.ts:3-36`). The live chain was `storeDocument → classify_document → extract_document → enrichAddressbook` (`B/review/0093-…:130-139`). **The `book` step never got runner actors.** It stayed descriptive config until it was deleted.

### 2.2 Step by step

**(1) Ingest.** `storeDocument` writes the raw bytes to `artifact(sha256 PK, bytes bytea, mime, size)`
(`migrations/0017_artifact.ts:3-17`). "Only the hash enters the predication graph" (0017:4). The node note was
fixed in 0035 ("Postgres bytea (artifact table, by sha256)", `0035_…:31`).

**(2) Classify.** A vision call returns `{kind, title, summary}`. After 0097 the kind is a `doctype-*` reference
constant (`kind: doctype-invoice`, `B/review/0097-…:197`). It is persisted as a `document` bundle
(DOCUMENT_SPEC, `legacy-bundle-fixtures.ts:86-175`): `document`≡vreji (x2 = title) + `owned_by`≡ponse +
`kind`≡tcita (x1 = `doctype-invoice`) + `summary`≡skicu (x4 = text) + `source`≡krasi (x1 = artifact sha256) +
`produced`≡cupra (x1 = flow-run id). The provenance loop was verified live: "doc.artifact==artifact.sha256,
produced.run==flow_run.id" (`B/review/0089-…:144-150`).

**(3) Extract.** A generic `extract_document` reads `system_prompt` + `schema` (+ later `parties_prompt` /
`parties_schema`) **from the flow node** (0093: "the flow UI you see is literally what runs",
`B/review/0093-…:39-43`). The prompt and schema went through several versions:
- 0030: embedded the doctype prompt (3514 chars).
- 0036: vendor-focused prompt (`0036_extract_vendor_prompt.ts:10-29`, e.g. "`tax_id`: the VAT-ID / USt-IdNr ONLY … NEVER put an address, email, phone").
- 0040: party-completeness directive.
- 0041: ported the legacy OCR reference prompts and 29k-char schemas (`0041_port_reference_extraction.ts`).
- 0043: compact schemas. The comment reads "the ported reference schema (29k chars, 4 required nested objects) overwhelmed gemma4-31b's single-pass tool call → visionExtract returned null → EMPTY extraction" (`0043_compact_extract_schemas.ts:3-7`).
- 0045: **two vision passes** (parties + body) merged (`0045_multi_agent_extract.ts:3-7,17-29`).

The regression target was a Cursor invoice that had extracted "total 1,88 USD where the PDF says 100,11 $"
(`B/build/0098-…:82-89`).

The extraction output is the board-0064 **doctype JSON**: `header`, `vendor`, `buyer`, `totals.tax_breakdown[]`,
`statements[].line_items[]`, `payments[]`, `total_outstanding`, … (schema at `0045_…:9-10`; a full sample is
`2894d6eb:libs/aven-ui/src/vibes/invoice/source.json`).

**(4) Enrich.** `enrichAddressbook` does three things (`B/review/0093-…:144-151`, `0093:56-59`):
- match-or-create the vendor `company` (matched by VAT-ID / IBAN / name),
- create the Ansprechpartner (`contact_name`) as a `person` that `represents` the company,
- emit the ontology `invoice` with `billed_by` = the company id (janta.x4).

The generic persist loop in `runSkillForUser` writes "ANY registered output type generically"
(`B/review/0090-…:126-127`) through `data_crud(invoice, create)`. The mapping from extraction to bundle is
`header→number, totals→total, due, statements[].line_items → lines[] (description/quantity/unit_price/amount),
payments[]` (`B/review/0092-…:209-212`).

### 2.3 Which gismu and which places (the final, post-0097 shapes)

Vocabulary: `2894d6eb:libs/aven-vibes/src/predicate/invoice-vocab.ts`, `contact-vocab.ts`, `doc-vocab.ts`.
Each `PredicateDef` compiles to an Ajv JSON Schema stored as a `data_schema` row
(`compile.ts:98-117`: `{predicate: const, x1..x5}`, `additionalProperties:false`, `x-gismu`). Ref places
must match `^[\w-]{6,}$` (`compile.ts:37`).

| predicate | gismu | places used (the **bold** place is the value) | source |
|---|---|---|---|
| invoice | janta | x1 account (= the row itself, left empty) · x2 goods (left empty; items are line children) · x3 billed party = `$user` · x4 biller = company id | invoice-vocab.ts:15-33 |
| total | jdima | **x1 price** · x2 item = invoice | :36-48 |
| identifier | tcita | x1 kind = `idkind-invoice_number` · x2 = invoice · **x3 = "2026-014"** | contact-vocab.ts:72-86 |
| due | detri | **x1 date** · x2 event = invoice | vocab.ts |
| source | krasi | x1 = artifact sha256 · x2 = invoice | doc-vocab.ts:69-79 |
| produced | cupra | x1 = flow-run id · x2 = invoice · x3 process | doc-vocab.ts:83-94 |
| owned_by | ponse | x1 = account · x2 = entity (on EVERY entity) | vocab.ts; `B/review/0092-…:37-46` |
| line | pagbu | x1 part (= the row) · x2 whole = invoice | invoice-vocab.ts:52-60 |
| description | skicu | x2 = line · **x4 text** | :62-75 |
| quantity | klani | x1 = line · **x2 amount** · x3 scale (never filled) | :77-88 |
| unit_price / line_amount | jdima | **x1 price** · x2 = line | :90-112 |
| payment | pleji | **x2 amount** · x4 "goods" = invoice id (**a value-kind place in the seed**) | :116-126 |
| paid_on | detri | **x1 date** · x2 = payment | :128-138 |
| company / person | kagni / prenu | x1 = the row (empty) | contact-vocab.ts:20-35 |
| name | cmene | **x1 name** · x2 entity · x3 namer | :38-50 |
| address | judri | **x1 value** · x2 entity · x3 system = `addrsys-email/phone/iban/postal` | :54-68 |
| represents | krati | x1 person · x2 company · x3 matter | :89-98 |
| transaction | pleji | **x2 amount** · x3 payee = company · x4 = settled invoice | :101-114 |
| dated / value_dated | detri | **x1 date** · x2 = transaction | :115-150 |
| balance | klani | x1 = transaction · **x2 running balance** · x3 currency | :151-160 |
| booked | cmima | x1 = transaction · x2 = SKR04 account constant (`skr04-6810`) | :126-134 |
| matched | mapti | x1 = transaction · x2 = invoice · x3 confidence | :165-177 |

Currency and FX (`idkind-currency`, `idkind-exchange_rate`, `idkind-fx_fee_percent`, `idkind-original_currency`,
`idkind-original_amount`, `idkind-fx_surcharge`) reuse `identifier`≡tcita as discriminated parts on
TRANSACTION_SPEC (`legacy-bundle-fixtures.ts:710-787`). `addrsys-*`, `idkind-*`, `doctype-*` and `skr04-*` are
"canonical reference constants". They are strings in ref slots, not rows
(`B/review/0097-…` goal (5); 0097:92-102).

**Engine bundle (TypeSpec) for the invoice**, quoted from `legacy-bundle-fixtures.ts:177-416`:
- primary `invoice` (field `number`, `create:{x3:'$user'}`, `fields:{x4:'billed_by'}`),
- singleton `owned_by`,
- discriminated replace `identifier` (`match:{x1:'idkind-invoice_number'}`),
- replace parts `total`, `due`, `source`, `produced`,
- **`children`** `line` (childSpec type `line`: primary `line` x2=`$parent` + description/quantity/unit_price/line_amount),
- **`children`** `payment` (link x4; primary `payment` `create:{x2:'$value', x4:'$parent'}` + `paid_on`).

The projection map `project` turns these back into `{number, total, buyer, billed_by, owner, due, artifact,
run, lines[], payments[]}`.

### 2.4 Concrete example: every predication one invoice run writes (engine replay)

Input values: number `2026-014` and the lines `Beratung 3×100=300` / `Spesen 1×57=57` with a `100.00` payment
are the live test values from `B/review/0092-…:251-254,266`. The sha256 and run id are the vocab examples
(`doc-vocab.ts:75,89`). The company and person stand in for what `enrichAddressbook` creates. Engine replay:

```
id-1   document     {"x2":"Rechnung 2026-014"}                       ← classify (vreji)
id-2   owned_by     {"x1":"USER_samuel","x2":"id-1"}
id-3   kind         {"x1":"doctype-invoice","x2":"id-1"}             ← tcita
id-4   summary      {"x2":"id-1","x4":"Invoice from ACME for 357€"}  ← skicu
id-5   source       {"x1":"1bce272a633a5ab0","x2":"id-1"}            ← krasi → artifact sha256
id-6   produced     {"x1":"run_5f3a","x2":"id-1"}                    ← cupra → flow_run
id-7   company      {}                                               ← kagni; the row id IS the company
id-8   owned_by     {"x1":"USER_samuel","x2":"id-7"}
id-9   name         {"x1":"ACME GmbH","x2":"id-7"}
id-10  address      {"x1":"billing@acme.example","x2":"id-7","x3":"addrsys-email"}
id-11  address      {"x1":"DE89370400440532013000","x2":"id-7","x3":"addrsys-iban"}
id-12  address      {"x1":"Industriestr. 25, 91710 Gunzenhausen","x2":"id-7","x3":"addrsys-postal"}
id-13  identifier   {"x2":"id-7","x3":"DE123456789","x1":"idkind-vat_id"}
id-14  person       {}                                               ← prenu (Ansprechpartner)
id-15  owned_by     {"x1":"USER_samuel","x2":"id-14"}
id-16  name         {"x1":"Erika Muster","x2":"id-14"}
id-17  address      {"x1":"erika@acme.example","x2":"id-14","x3":"addrsys-email"}
id-18  represents   {"x1":"id-14","x2":"id-7"}                       ← krati
id-19  invoice      {"x3":"USER_samuel","x4":"id-7"}                 ← janta: billed to us, biller = company
id-20  owned_by     {"x1":"USER_samuel","x2":"id-19"}
id-21  identifier   {"x2":"id-19","x3":"2026-014","x1":"idkind-invoice_number"}
id-22  total        {"x1":"357.00","x2":"id-19"}                     ← jdima
id-23  due          {"x1":"2026-07-15","x2":"id-19"}                 ← detri
id-24  source       {"x1":"1bce272a633a5ab0","x2":"id-19"}
id-25  produced     {"x1":"run_5f3a","x2":"id-19"}
id-26  line         {"x2":"id-19"}                                   ← pagbu
id-27  description  {"x2":"id-26","x4":"Beratung (Stunden)"}         ← skicu
id-28  quantity     {"x1":"id-26","x2":"3"}                          ← klani
id-29  unit_price   {"x1":"100.00","x2":"id-26"}                     ← jdima
id-30  line_amount  {"x1":"300.00","x2":"id-26"}                     ← jdima
id-31..35           (second line: Spesen 1 × 57.00 = 57.00)
id-36  payment      {"x2":"100.00","x4":"id-19"}                     ← pleji
id-37  paid_on      {"x1":"2026-07-09","x2":"id-36"}
id-38  transaction  {"x2":"-357.00","x3":"id-7","x4":"id-19"}        ← pleji (bank flow, 0098)
id-39  owned_by     {"x1":"USER_samuel","x2":"id-38"}
id-40  dated        {"x1":"2026-07-14","x2":"id-38"}
id-41  identifier   {"x2":"id-38","x3":"EUR","x1":"idkind-currency"}
id-42  booked       {"x1":"id-38","x2":"skr04-6810"}                 ← cmima (SKR04 account)
id-43  matched      {"x1":"id-38","x2":"id-19"}                      ← mapti (reconciliation → "belegt")
```

The invoice alone (2 lines + 1 payment) is **19 rows** (id-19 to id-37). With its document, the vendor
company, the Ansprechpartner and one bank transaction it is **43 rows**. The engine reads it back
(`query(INVOICE_SPEC)`) as:

```json
{"id":"id-19","number":"2026-014","total":"357.00","buyer":"USER_samuel","billed_by":"id-7",
 "owner":"USER_samuel","due":"2026-07-15","artifact":"1bce272a633a5ab0","run":"run_5f3a",
 "lines":[{"id":"id-26","description":"Beratung (Stunden)","quantity":"3","unit_price":"100.00","amount":"300.00"},
          {"id":"id-31","description":"Spesen","quantity":"1","unit_price":"57.00","amount":"57.00"}],
 "payments":[{"id":"id-36","amount":"100.00","date":"2026-07-09"}]}
```

Physical storage at the time: `data_value(id, user_id, schema_id → data_schema(user_id,name), data jsonb
{predicate,x1..x5})` (`migrations/0003_user_data.ts:8-45`). There is one `data_schema` row **per user per
predicate**. Migration 0049 later added real `predicate, x1..x5` text columns (after the strip).

A real example from the data migration: the one pre-existing legacy blob invoice (Gandi, number 2026051100627,
€9.99, artifact preserved from `file_hash`) was migrated to predications and the blob schema dropped. This ran
as a **one-time live data migration**, not as a migration file (`B/review/0090-…:89,129-132`; the parking step
is `0021_park_legacy_invoice.ts:10-15`).

### 2.5 Booking, reconciliation, payment

- **Payment on the invoice**: `payment`≡pleji children with x4 = the invoice (`0092-…:242-254`).
- **Reconciliation, plan vs. what shipped.** Board 0092 principle 4 says "tx↔invoice is `pleji.x4`; don't
  invent a 'match'" (`0092-…:106-107,122`). Board 0098 then **added** `matched`≡mapti
  (`contact-vocab.ts:162-177`) and auto-matched each transaction to an invoice when "|amount|==invoice total +
  same biller" (`B/build/0098-…:184-186`). TRANSACTION_SPEC ended up carrying both the transaction's
  `invoice` (pleji.x4) and `matched_invoice` (mapti) (`legacy-bundle-fixtures.ts:667-670,798-806`). In the seed
  lexicon pleji.x4 is a **value**-kind place, while both places of mapti are refs. That fits the reversal, but
  no board states the reason.
- **Booking, plan vs. what shipped.** Board 0092 planned SKR04 double-entry: two `booked`≡cmima rows
  (Soll/Haben) + jdima (`0092-…:110-115`). Board 0098 shipped **single-entry**: `booked`≡cmima on the
  transaction, and "FinanceVibe now computes cash flow + P&L from `transaction` predications grouped by their
  `booked`≡cmima SKR04 account (single-entry) — no flat `booking` needed" (`0098-…:186-188`). The `book` flow
  actors (`matchInvoiceAgainstTx`, `bookInvoice`) were never implemented. Board 0098 closed with "Last-mile
  remaining: the chat-driven tx-import/match/booking tools in ai.ts … still ensureDocSchema the flat types"
  (`0098-…:189-192`).
- **VAT was never modelled.** "taxes (cteki+parbi) deferred — parbi has no ref place to anchor a rate to its
  tax line; needs a modelling decision" (`0092-…:255-256`). In the lexicon all parbi places are values and
  cteki x1 is a ref. VAT is the field that drives German input-tax booking, and it never became predications.

### 2.6 Query back → render (vibes)

| card / view | what it read | source |
|---|---|---|
| classify (`BookkeepingVibe`) | the step resource `{kind,title,summary}`; reads `kind`, strips the `doctype-` prefix | `B/review/0096-…:115-120`; 0097:204 |
| **extract (`DocCompareVibe`, board 0064)** | **the raw extraction JSON carried in the run resource, NOT the predications**: "the raw doctype is spread into the resource so the invoice vibe card still renders rich … the invoice vibe view reads the doctype from the resource (mapper.ts)" | `0092-…:211-215`; `0096-…:51-53` |
| enrich (`contact` vibe) | the enrich step's `contact` output | `0035_…:34-38` |
| Addressbook | **predications**: new `GET /api/data/type/:type` + client `listType`/`listContacts` merge company + person through the engine projection. Belege = invoices whose `billed_by` = the company (after 0097) | `0096-…:121-124`; `0097-…:204-207` |
| Transactions / BWA | predications: belegt/offen from `matched`; P&L from `booked` | `0098-…:184-190` |

### 2.7 What "roundtrip" meant (it meant several different things)

1. **Engine round-trip, the main meaning.** `data_crud(type, create)` takes flat or nested JSON and writes N
   predications. `data_crud(type, list)` projects them back through the bundle's `project` map into the
   *same JSON shape plus ids*. Update replaces children wholesale; delete cascades with no orphans.
   - Unit proof: `2894d6eb:libs/aven-ontology/test/engine.test.ts:188-246` ("children: a parent with N child sub-entities round-trips as a nested array") and `:251-304` (address/identifier discriminated by x3/x1 still projects flat).
   - Live proofs were SQL plus `data_crud` lists on the Neon `samuel` branch (`0090` acceptance line 87; `0092-…:242-268`).
   - Board 0087 framed Layer B as being *for* "dynamic AI/user-generated predication roundtrips".
2. **Parity (0088).** Engine output equals the previous hand-coded `v_task` view and hand-written rows (lead covers this).
3. **Places == seed gate.** Not a data round-trip: a schema-fidelity test. Every wired predicate must be
   CORRECT (position + ref/value kind) and COMPLETE (all seed places) against `.claude/skills/ontology/gismu.json`
   (`2894d6eb:libs/aven-vibes/tests/predicate.test.ts:124-176`; 0097 audit: 28 predicates, 0 missing). It
   still imports the invoice, contact and document vocab after the strip (`:5-21,131-142`).
4. **DB == file equivalence.** This existed, but for **vibe definitions**: "DB-loaded todos view tree == the
   file `todoView`" (`B/review/0095-…:57,72,121`). Separately, board 0102 kept historical bundle seeds
   **byte-identical on migration replay** through the frozen fixtures. Neither is an invoice proof.
5. **Data-migration "survives" (0090).** Legacy blob → predications, with the data shown intact afterwards.

**What did NOT exist:** a check that *extraction JSON == projected JSON*. The mapping was lossy, and the visible
invoice card bypassed the read-back. I fed the shipped extraction fixture (`aven-ui/src/vibes/invoice/source.json`,
49 leaf fields) through the 0092 mapping into INVOICE_SPEC (engine replay):
- 9 fields mapped into the invoice bundle.
- 18 party fields go to company/person through enrich.
- **22 fields cannot be represented**: currency, issue_date, order/customer number, referenced invoice numbers,
  section title, service period, line position/title/**quantity_unit**/**tax_rate_percent**, subtotal,
  **the whole tax_breakdown**, tax_total, payment method/reference, total_outstanding, payment_instructions.

Two more consequences of the engine semantics:
- **Line order is not part of the model.** There is no position predicate. The replay returned lines in
  store-id order, which is a memstore artifact, but nothing guarantees order in any store.
- **A line with no `description` is silently dropped.** `create()` returns null when the primary's driving
  field is empty (`engine.ts:76-77`).

### 2.8 Why the strip left this unreachable even for the later engine

The post-strip "bundle compiles to 4 operations" engine (0104) **refuses** the two features the invoice
depended on. `deriveOps` throws on `children` traits and on `match` (discriminated) traits
(`2894d6eb:libs/betterauth/src/derive-ops.ts:10-14,51-58`). The invoice (lines/payments children +
identifier match) and company/person/transaction (address/identifier match) bundles are therefore not
derivable on the July engine. Later verticals used reified edges, `many` traits and `refName` instead (lead covers this).

### 2.9 Tools and actors

- At `2894d6eb`, `skills/tools/*.ts` (bundle, data-crud, dispatch, goals, locations, mockup(s), ontology,
  promote, queries, registry, types) are all **post-strip**. None is an invoice tool.
- The tool-actor model (`ToolActor = {definition, handle(ctx,args)}`) was introduced by 0099
  (`skills/tools/types.ts:1-4`).
- The invoice actors lived in `libs/betterauth/src/skills-run.ts` and were deleted. That file now has an
  empty `skillActors()` with the comment "board 0099 stripped the document/finance actors with their
  verticals" (`skills-run.ts:17-20,34-39`).
- `capability.ts:60-62` still declares an `emit_invoice` capability (a leftover).

---

## 3. Caps and access in that era

### 3.1 Two completely separate access worlds

- **Testnet / aven-db CRDT world (Rust).** This is where caps live. Device app + Sprite relay, biscuit
  capabilities, per-SAFE DEKs, sealed cells.
- **Mainnet Postgres world (betterauth).** This is where the predications lived. **No biscuits.** Every
  invoice board says "mainnet Postgres only; aven-db CRDT untouched" (e.g. `0090-…:3`, `0092-…:3`).
  `git grep biscuit|aven-caps` over `libs/betterauth`, `libs/aven-ontology` and `skills` returns nothing.
  Access to predications was:
  - (a) **`user_id` scoping** on every `data_schema`/`data_value` query (`libs/betterauth/src/data.ts:69,112,146,…,253`),
  - (b) the **`owned_by`≡ponse predication** as the *semantic* owner, with `data_value.user_id` described as "a *mirror* of `owned_by.x1`, not the source of ownership meaning" (`0092-…:37-46`),
  - (c) Layer-A config (`flow`, `predicate_type`/`data_bundles`) gated by `adminGate` (role === admin) (`predicate-types.ts:11-76`, `flows.ts:12-174`).

  There was no sharing between users and no per-row caps on predications.
- **A third "caps" (July).** Sandboxed actor code (QuickJS) gets injected capabilities, fail-closed. Bare
  `['ops']` was replaced in 0117 by **schema-scoped `ops:<type>`** (`actor-run.ts:68-81`; `B/review/0117-…:60-62,73-80`).
  This is capability injection into code, unrelated to the biscuits.

### 3.2 aven-caps crate (`2894d6eb:libs/aven-caps`)

- Cargo description: "biscuit caps (mint/grant/authorize/report) + per-spark DEK keyshare crypto. Single
  source of truth shared by the app and the aven-node". Dependencies include `biscuit-auth` 6,
  chacha20poly1305 and x25519 (`Cargo.toml:1-25`). Files: `caps.rs` (2088 lines), `crypto.rs`, `ownership.rs`.
- `AccOp` covers Read/Write/Delete/Replicate (blind store-and-forward, no keyshare)/Admit (roster write)/RotateDek
  (keyshare write) (`caps.rs:32-61`).
- `ADMIN_RIGHTS = ["read","write","delete","admit","rotate_dek"]` (`caps.rs:138`).
- **0047 role → caps SSOT**: `grant_kind_caps`: admin → ADMIN_RIGHTS, reader → [read], relay → [replicate]
  (`caps.rs:140-156`). The board's model was "a role IS a named bundle of caps" with roles ADMIN, READER, RELAY,
  TIER-0 and two roots: per-SAFE biscuit grants vs network-roster admission (`B/ship/0047-…:29-43`).
- A lesson recorded the same day: renaming the **wire** predicate `owns`→`admin` changed the genesis format
  and broke the first-admin claim. It was reverted, and the role name became a report/UI-layer label only
  (`206bf1c5` message).
- **0049 R2, the "raw-facts caps UI"** (`6542c723`, 2026-06-14). `identity_cap_report` stopped returning role
  bundles and now returns each DID's literal biscuit facts: `owns`/`reads`/`replicate`/`grant(did,op,prefix)`
  with ops, raw prefix and a derived scope (`safe` | `directory` | `<table>` | `<table>:<row>`)
  (`caps.rs:158-248`). Quota and rate are "flat aven-node policy keyed on owner-binding, not per-subject
  caps" (`caps.rs:150-153`).
- **0049 sealed directory / "Addressbook"** (`B/review/0049-sealed-profile-directory.md`). The audit found
  content 100% sealed, but the roster (membership + trust graph) readable by the blind relay (`:15-23`). Fixes:
  - a sealed `profile` table (type/did/display_name) under its own DEK, read for discovery instead of the
    plaintext roster;
  - TIER-0 = relay admission + the directory DEK only, with no avenCEO content keyshare and no whole-roster
    `reads` (`:38-50,86-89`);
  - tests `tier0_minimal_grant` and `profile_seal_registry_dek_separation` (`caps.rs:1650`).

  R1 (`56e3581f`) re-modelled the directory as a **spark SAFE named "Addressbook" controlled by avenCEO**
  (`mint_safe_genesis_with_controller`), replacing the bespoke `extends` sub-group, so authority flows one way:
  avenCEO → Addressbook. The merge was titled "board 0049: sealed Addressbook + raw-facts caps UI" (`f8b73ff1`).
- **"Relay apply gate fail-closed on spark-scoped rows + shared owner-scoped predicate"** is board 0026 Phase 1
  (A3; CHANGELOG line 555 → `0c274943`). `is_spark_scoped_table` was hoisted into `aven-db` so app and relay
  share one schema-derived predicate. `ServerApplyGate::verify_on_apply` changed from `None => Allow` to: a
  spark-scoped row without owner-binding → `DenyPermanent` (`B/build/0026-…:78-92`). Per-spark read/write caps
  stay on the client because "the blind relay cannot see sealed user caps"; the relay enforces only
  avenCEO-membership caps: admission, quota, rate (`0026:22-45`).
- The **owner-binding** (board 0037): every owner-scoped CRDT row carries an `_owner_binding (value_id →
  owner SAFE)` signed by the device (`app/src-tauri/src/biscuit_resolver.rs:291-292`).

**Answer to "how did access apply to predications/bundles":** it didn't, in the biscuit sense. The predication
engine sat entirely in Neon Postgres behind Better-Auth sessions. Ownership there was a predicate (`owned_by`),
enforced only by `user_id` filtering. The caps machinery (owner-scoped rows, spark-scoped tables, the fail-closed
apply gate, the sealed Addressbook) applied only to the aven-db CRDT world. Nothing bridged the two. The invoice
"addressbook" (company/person predications) and the caps "Addressbook" (a sealed spark SAFE of DID profiles) are
**unrelated things with the same name**.

---

## 4. Aftermath (2026-07-01 → 2026-09)

### 4.1 07-01: strip to core (board 0099, inside `2894d6eb`)

- **Reasons recorded:** "The finance/bank/booking/enrich/addressbook/invoice program hit a dead end"
  (`B/review/0099-strip-to-core.md:4`). "(0098 + the finance half of 0097 + legacy 0064–0082) became a
  complexity sink and a dead end. Reset per the repo's own rules (`first-principles.mdc`,
  `compact-simplify-consolidate.mdc`): don't optimize what shouldn't exist — delete it — and re-introduce
  verticals later, deliberately" (`:47-50`).
- **Kept:** the actor/flow machinery, the vibe engine, **the predication data engine**, `skr.ts`
  (`:52-56,110-117`).
- **Later intent:** re-introduce invoices, bank and bookkeeping later, "each modeled as its own actor cluster
  on this same evolved machinery" (`:141-142`).
- **Design lesson** (`:58-76`): the linear pipeline gave way to an **actor hub** (address = tool, mailbox =
  args, behavior = data_crud, vibe = card), tried on Todos first.
- **DB strip.** Migration 0046 deletes 7 flows and their runs, un-registers company/person/transaction/
  document/invoice/line/payment, and hard-deletes 28 exclusive predicates. `owned_by`/`due` are shared with
  todos, so only their orphans are cleaned (`0046_strip_to_todos_core.ts:43-75`).
- Migration 0048 had to purge again, because `ensurePredicateSchemas` "kept RE-SEEDING document/invoice/
  contact vocab on every todos op" (`0048_…:1-4`).
- On a throwaway Neon branch forked from dev, the strip removed "the 28 exclusive-vertical data_schemas + their
  332 values" (`0099-…:176-180`). That is the order of magnitude of the live document/finance data.

### 4.2 07-01 → 07-05: engine made generic and dynamic (boards 0100–0117, same squash; the lead covers the detail)

- **0055 / 0060:** the `ontology` skill was renamed to `brain` and then back to `ontology`. Flow id, node
  actors, flow_run traces and persisted chat vibe markers were all rewritten each time
  (`0055_rename_ontology_to_brain.ts:3-28`, `0060_rename_brain_to_ontology.ts:1-30`).
- **0058:** `predicate_type` → `data_bundles`. "it's not 'a type of predicate', it's a BUNDLE recipe";
  namespace = data_schema (predicates) · data_bundles · data_value (predications) · data_queries/mutations
  (`0058_…:3-12`). This rename was `ALTER TABLE IF EXISTS`. On a fresh catch-up it silently did nothing, and
  that broke the 07-05 Fly deploy. Fixed by migration 0113 "ensure data_bundles exists" (`70eeb45c`).
- **0102:** the domain specs were deleted from aven-ontology and frozen into `legacy-bundle-fixtures.ts`.
  The engine is "domain-free"; bundles became runtime DB config authored by GLM or the user
  (`aven-ontology/src/index.ts:18-21`).

### 4.3 07-05 → 07-31: predications still in use, for simpler verticals

- 07-05: 0119 dispatch as a system skill (`316e15ef`).
- 07-14 → 07-16: 0120 realtime voice, reverted (`921b32af`).
- **07-18, `44038179` (#60).** New config-as-data skills on predication bundles, up to **migration 0128**:
  - **Calendar** reuses `task`+`due`(detri) ("Ontology consult first… no schema duplication").
  - **Dienstplan** uses bundles `shift`/`slot` (worker≡gunka, role≡jibri, onday≡detri, starts/ends≡tcika,
    slot≡stuzi). There is an `assign_shift` sandbox actor with caps `ops:slot/ops:shift`.
  - **Kontakte** stores people as `prenu` entities. `shift.person` was re-modelled as a reified
    `staffed_by`≡gunka edge to prenu, with 53 shifts migrated (0126/0127).

  These were flat entities with ops derived from bundles (no children, no discriminators), verified as "full
  CRUD roundtrip (batch create → flat projection → delete)" (commit message, the dienstplan section).

### 4.4 07-31: removed entirely (board 0121, `53cfa8a6` #63)

- **Deleted** `libs/betterauth`, `aven-ontology`, `aven-vibes`, `aven-skills`, `aven-schema`, `aven-db`,
  `aven-caps`, `aven-node`, … ("259 619 lines deleted. libs/ goes from 17 packages to two: aven-board and
  aven-city"). "BREAKING CHANGE: the vault, sync, auth, skills, vibes and flows are gone."
- **Survived:** only `.claude/skills/ontology/*` (the gismu lexicon). `skr04.json` did not survive.
- **Reasons** (`53cfa8a6:B/review/0121-strip-to-avencity-seed.md`, Context): "get back to a base small enough
  to hold in your head, so the next architecture can grow on a clean seed". The two server worlds "cost money
  and break builds".
- 0121 records **no critique specific to predications**. It is a whole-world deletion, and it cites "[[0119]]
  shipped the dynamic-skills arc that this deletes".
- So the engine was **kept and simplified (07-01), extended (07-05 → 07-18), then removed (07-31).**

### 4.5 August and September

- **Board 0125** (ideate, 2026-08-09, at `d605dd47`): "Repeating a flat `todos` table would walk back a
  decision the board already made". After the strip the predication model was still treated as the
  intended data model.
- **The September invoice reconciliation did not use predications.**
  - `d605dd47` (2026-08-30) and `a993da7e` #222 (2026-09-07), both by **jaensen** (Daniel), not Samuel.
  - They build on an **Artifact Store** (Rust service) of **typed, versioned JSON-Schema artifacts**:
    `banking.statement@1`, `banking.transaction@1`, `bookkeeping.open-item@1`,
    `reconciliation.match-candidate@1`, `reconciliation.decision@1`, `policy.snapshot@1`
    (`d605dd47:docs/invoice-statement-reconciliation.md:114-121`).
  - `banking.transaction@1` is a flat record: `amountMinor`, `currency`, `bookingDate`, `valueDate`,
    `counterpartyIban`, `originalAmountMinor`, `exchangeRate`, `fxSurchargeMinor`, `foreignExchangeFeeBps`,
    `balanceAfterMinor`, `dedupKey`, `sourceRow` …, using integer minor units
    (`d605dd47:services/artifact-store/conformance/fixtures/protocol/banking.transaction.v1.json`).
  - `git grep gismu|lojban|predication` over `app/src services libs docs` at `a993da7e` (boards excluded)
    finds nothing.
  - Its "historical work" section cites the **flat-era** cards 0065/0066/0081 (tx fan-out, amount-first
    reconciliation, belegt status), not the predication boards. It names the key difference: "Matching may be
    eager. Declaring a transaction to have settled an invoice requires a separate, inspectable decision". An
    amount-first top-row heuristic (what 0098's mapti auto-match did) is "insufficient authority for automatic
    acceptance".

---

## 5. Lessons recorded or implied (with sources)

1. **Too many layers moving at once.** In about 3 days there were 29 migrations (0017–0045), mostly on the doc/invoice/finance stack, re-shaping the
   same specs: canonical places (0092), then completeness and consolidation (0097) with a Neon reset "fresh (no
   legacy data to rewrite)" (`0037_…:11-13`). The extract-node prompt or schema alone was rewritten by 8 migrations (0030, 0036, 0038, 0040, 0041, 0043, 0044, 0045). The board
   called the result a "complexity sink and a dead end" (0099:48).
2. **Ontology fidelity beat domain fidelity.** The gate enforced every gismu place (28 predicates, 379-412
   assertions). Yet VAT/tax_breakdown, currency on invoices, service period, line order and payment terms were
   never representable (engine replay; `0092:255-256`). The visible invoice card rendered the raw
   extraction, not the predications (`0092:211-215`).
3. **Principles reversed under pressure.** "No match type, pleji.x4 is the link" (0092) became `matched`≡mapti
   (0098). "Double-entry Soll/Haben" became single-entry `booked` (0098). The number went from `number`≡cmene
   to `identifier`≡tcita (0097), with migration 0026 edited after the fact to drop the deleted `NUMBER` import
   (`0026_…:5-7`).
4. **Engine features did not carry forward.** `children` + `match` were built for the invoice (0092, 0097),
   but the July ops engine refuses them (`derive-ops.ts:51-58`). Verticals that survived were flat entities
   with reified edges.
5. **Extraction quality was the real bottleneck, not the schema.** It needed the legacy OCR reference
   pipeline (two-stage, per-doctype, small schemas). A 29k schema yielded empty output on gemma4-31b
   (`0043:3-7`; `0098:82-95`).
6. **The caps world and the predication world never met.** Predication "ownership" was a predicate plus a
   `user_id` filter, with no sharing or delegation story. The biscuit, seal and owner-binding work lived only
   in the aven-db stack, and both were deleted together on 07-31.

---
