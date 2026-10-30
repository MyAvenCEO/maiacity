# Ontology: one fact grammar, fully dynamic

A proposal (30 Oct 2026) for how avenDB says what its data means: one grammar for every fact, `predicate(x1…x5)`,
with place structures borrowed from Lojban's gismu, and everything above that grammar kept as data that a person or an
agent can add to while the system runs. It is written for milestones 6 (schemas and lenses) and 7 (queries).

The ontology is a part of avenDB, between two neighbours. Facts are values in [docs](../docs/README.md), and a predicate
is a schema there, so predicates get versions, lanes and lenses from the docs layer. The [engine](../engine/README.md)
syncs the documents facts live in and runs queries and mutations over them. Nothing here is built before its
milestone, and nothing comes in from the older engines as code ([README](../../README.md), rule 12): their learnings
come in as the rules, decisions and Lean theorems below.

## Where it comes from

The same idea has been built three times, and avenDB-old added what all three lacked. The third build worked and was
stripped for reasons outside the grammar.

| When | Where | Substrate | What it taught |
|---|---|---|---|
| Apr–May 2025 | `hominio-legacy`, HQL (`450fd04`, `a2672be`) | one Loro doc per fact | The grammar is enough for an app. One document per fact is far too many; untyped places and caps written in code don't hold. |
| Dec 2025 | `MaiaOS`, `libs/hominio-db` (`89dc1186`) | Jazz CoValues | Places that are bare references check nothing; a type looked up by name drifts from the stored one. |
| Jun–Jul 2026 | `avenOS`, boards 0085–0112 (squashed in `2894d6eb`) | Postgres, columns `predicate, x1…x5` | **The working engine:** gismu places, taxonomy by position, kinds that compile to operations, validated query and mutation specs, an LLM minting predicates, kinds and queries with no deploy. |
| until Oct 2026 | avenDB-old (`aven/db`, `lens.rs`, `Lens.lean`) | Loro, sealed | Schemas named by their hash, lenses instead of migrations, laws proven in Lean. |

avenOS's finance vertical on predications lasted three days (29 Jun – 1 Jul) and was cut as "a complexity sink and a
dead end" (board 0099). The grammar and engine survived the cut and were made fully dynamic on todos (boards
0100–0112), then the whole repository was stripped on 31 Jul (board 0121). What broke was fidelity to the domain:
replaying a real invoice through its kind, 22 of 49 extracted fields had no place to go, VAT was never modelled, and
amounts were strings. The rules below keep what worked and close those gaps.

## The idea

Every fact is a predicate and up to five places: `member_of(x1 = Samuel, x2 = the garden project)`. A place holds a
typed value or a reference to another fact. A fact's id is the entity it introduces, so facts point at each other and
form a graph. The order and meaning of the places come from the gismu that fits, so `pays` has the places of `pleji`
(payer, payment, payee, goods) and every agent, app and peer reads them the same way.

The only fixed things are the grammar, its checker, and the engine. All of them are defined in Lean. Everything else is
data in documents: predicates, kinds, category trees, queries, mutations, lenses, and the prompts the minting agent
reasons with. Nothing a person or an agent adds needs a deploy.

## Terms

- **fact:** one statement, `{ id, p, x1…x5 }`, kept in a document. Its `id` names the entity it introduces.
- **predicate:** a definition of a relation: an English name, the gismu it borrows from, a gloss, and its places. In the
  docs layer's terms, the schema of a fact record: a blob named by its hash.
- **place:** one of `x1…x5`. A **value place** holds a typed value; a **ref place** holds a fact's id.
- **entity:** whatever a fact's id stands for. The `person` fact is the person; facts about them point at it.
- **referent:** an entity made only so other facts can point at it ("the 2 bananas", "this payment").
- **vocabulary:** the predicates a vault or a network uses, by name: its lane of predicates.
- **category:** an entity in a vocabulary that stands for a kind of thing (`addressing system: email`), referenced from
  the place the gismu gives for it.
- **kind:** a named composition of predicates around an entity, with a flat view (a todo, an invoice). The older engines
  called it a bundle or `TypeSpec`.
- **trait:** one predicate's part in a kind, with its cardinality.
- **slot id:** the id of a fact a trait allows at most one of, derived from the entity, the predicate and its fixed
  places.
- **gismu table:** the 1341 gismu with typed places (`role`, `kind` ref or value, `type`), kept as data and checked
  against in Lean.

## The rules

Each rule is held by a Lean theorem or a check once there is code to hold.

1. **One grammar.** Every fact is `predicate(x1…x5)`. More than five places, or any structure inside a place, is
   expressed by more facts about a referent. No other fact shape exists, in storage, on the wire or in an API.
2. **English names, gismu places.** A predicate's name is plain English (`address`, `pays`, `member_of`). Its places
   copy the order, roles and ref/value kinds of the gismu it names in `gismu`. Lojban words never appear in app code or
   UI, only as that provenance. A predicate with no fitting gismu is `coined`: it says so and needs a gloss per place.
3. **The full place structure.** A gismu-sourced predicate declares every place its gismu has, the unused ones
   optional, never dropped. That keeps it faithful and reusable by the next domain that needs the dropped place.
4. **Type by position, not by name.** A category goes in the place the gismu gives for it, as a reference to a
   category entity: one `address` (judri) with `x3 = addressing system: email`, never four predicates `email`,
   `phone`, `iban`, `postal`. A new channel is a new category entity, not a new predicate.
5. **Reify, don't pack.** A value with inner structure becomes a referent with facts of its own. "I ate 2 bananas" is
   `banana(B)`, `quantity(x1 = B, x2 = 2)`, `eat(x1 = me, x2 = B)`, never `eat(x2 = "2 bananas")`. A place may hold
   another fact's id, so a statement can be about a statement.
6. **Places are typed, refs included.** Value places take one of a closed set of types with one canonical encoding
   each. Ref places name what they may point at (a kind, a predicate, a category tree) or say `any` explicitly. The
   writer checks both, so a ref to a missing entity or the wrong kind is refused.
7. **Predicates and kinds are data, checked by a fixed meta-grammar.** What an agent writes passes the same check as
   what a person writes. (The engine does the same for queries and mutations.)
8. **Reuse before minting.** Before a new predicate or kind is made, the existing ones are searched, and a fit is
   reused. Two predicates that mean the same are aligned by a lens, never left as duplicates.
9. **Cardinality lives in the id.** A trait that holds at most one fact per entity writes it under a slot id, so two
   devices writing it at once write one key and converge on one fact. A trait that holds many gets fresh ids, so
   concurrent writes all survive.
10. **A kind round-trips, for every trait.** Reading back what was written returns exactly what was written: for one,
    maybe and many traits, nested kinds, ordered lists and fixed places. Nothing the grammar allows is left out.
11. **A kind proves itself on real inputs.** A kind made for real documents carries samples of them. It is accepted
    when every sample round-trips without loss, or when a person accepts the named losses.
12. **Predicates evolve as schemas do.** A predicate is named by its hash, so a changed definition is a new version.
    Facts are never migrated: they are read through the docs layer's lenses, and every fact's `p` names the version that
    wrote it ([docs](../docs/README.md#lenses)).
13. **The agents that grow it are actors with caps.** A model mints as a device vault of its person's aven: its
    additions are signed, bounded by its caps, and anything beyond its person's vault is a proposal.

## Architecture

```
avenOS            apps run operations; the minting agent proposes predicates, kinds and operations
  avenDB
    engine        the one writer, sync, the index, queries and mutations              db/engine
    ontology      the grammar, predicates, vocabularies, categories, kinds            db/ontology
    docs          Loro documents, versions, schemas, lenses                           db/docs
    store         blobs and refs                                                      db/store
  avenID          who acts: vaults, devices, agents
```

### Where facts live

**A document is the unit of sharing; a fact is the unit of meaning.** A document holds many facts, in a map of entries
keyed by fact id ([docs](../docs/README.md#values-what-the-schema-picks)):

```json
{ "facts": {
    "t1":      { "p": "b3:task…",   "x1": "@samuel", "x2": "Order seeds" },
    "s:9f2c…": { "p": "b3:due…",    "x1": "2026-11-02", "x2": "t1" },
    "k4":      { "p": "b3:tagged…", "x1": "garden", "x2": "t1" } } }
```

- Facts that are shared together live in one document: a person's household, a coop's books, one shared invoice. The
  boundary is chosen by who may read, because a document is what caps grant and what gets sealed.
- A ref inside a document is the fact id; across documents it is `<document>/<fact>`.
- `s:9f2c…` is a slot id (rule 9): `due` is at most one per task, so its id is derived from `t1` and `due`, and two
  devices setting the date at once write the same key. The docs layer keeps one value per key.
- Who wrote a fact and when comes from the document's history and its signed envelopes. It is not modelled as facts.
  When the domain needs valid time ("this price holds from March"), that is a predicate.

### Predicates and vocabularies

A predicate definition:

```json
{ "predicate": "address", "gismu": "judri",
  "gloss": "x1 is the address of x2 in addressing system x3",
  "places": {
    "x1": { "role": "address", "value": "text", "min": 1 },
    "x2": { "role": "located", "ref": "any" },
    "x3": { "role": "system",  "ref": "category:addressing_system" } } }
```

It is checked against the meta-grammar, then against the gismu table: `judri` has three places, x1 a value and x2, x3
refs, so this definition is complete and correct. Its hash names it everywhere, so two vaults minting the same
definition get the same predicate, and a changed definition is a new version with a lens from the old one.

**Value types** (closed, each with one canonical encoding): `text`, `int`, `decimal` (exact digits and scale, no
floats), `money` (minor units and a currency category), `date`, `time` (UTC), `bool`, `blob` (a hash). Money is never
a string again.

**Vocabularies** are lanes of predicates, looked up in order:

1. **A vault's own:** what its people and agents minted. Private unless published.
2. **The network's:** published by the admin coop (Maia City for Aven). Shared by every member.
3. **The core:** a handful fixed in Lean, which the rest is built on: `name` (cmene), `member_of` (cmima), `class_of`
   (klesi), `equals` (dunli).

Two vocabularies that minted the same meaning differently are aligned by a lens between their predicates, so a network
can take a member's predicate into its own without touching a fact.

### Categories

Categories are entities in a vocabulary document, named and grouped by core facts:

```
email:             name(x1 = "email", x2 = email)
                   member_of(x1 = email, x2 = addressing_system)
addressing_system: class_of(x1 = addressing_system, x2 = category)
```

A category tree is walked by a bounded query ([engine](../engine/README.md#queries), `walk`), so "every kind of
identifier" is one query and a new kind of identifier is one fact.

### Kinds

A kind declares each trait once, for writing and reading alike, so the two can't drift:

```json
{ "kind": "invoice",
  "traits": [
    { "predicate": "invoice",    "primary": true, "fields": { "x4": "biller" }, "set": { "x3": "$vault" } },
    { "predicate": "identifier", "card": "one",   "link": "x2", "fix": { "x1": "idkind:invoice_number" },
      "fields": { "x3": "number" } },
    { "predicate": "total",      "card": "one",   "link": "x2", "fields": { "x1": "total" } },
    { "predicate": "issued",     "card": "maybe", "link": "x2", "fields": { "x1": "issued_on" } },
    { "predicate": "line",       "card": "many",  "link": "x2", "of": "invoice_line", "order": "position" },
    { "predicate": "payment",    "card": "many",  "link": "x4", "of": "payment" } ] }
```

- `primary`: the fact whose id is the entity. `fields` maps places to the view's fields; `set` fills places from the
  context (`$vault`, `$actor`, `$now`).
- `card`: `one` (exactly one, created with the entity), `maybe` (zero or one), `many` (zero or more). `one` and
  `maybe` get slot ids (rule 9).
- `fix`: fixed place values. They scope the trait, so several traits can share one predicate (every identifier is
  `identifier`, told apart by its kind in x1).
- `of`: the elements of a `many` trait are entities of another kind, read back as a nested list. `order` names the
  element kind's field that keeps their order; a list without one is a set.
- `presence`: a `maybe` trait read back as a boolean ("done" is a `done` fact being there).
- Category refs (`idkind:invoice_number`) are shown here by name; stored, they are the category entity's id.

The view of this kind is `{ id, biller, number, total, issued_on, lines: [...], payments: [...] }`. Saving the kind has
the engine compile it into `invoice.list`, `invoice.create`, `invoice.update` and `invoice.delete`
([engine](../engine/README.md#kinds-compile-to-operations)); from then on, apps and agents run those.

### The minting agent

The agent that grows the ontology is an agent like any other (avenID): a device vault under the person's aven, acting
with the caps the person gave it. It writes the person's vault vocabulary, kinds and operations; it can only propose to
the network's vocabulary or anything that removes data.

From a request ("I want to track which projects people are members of"):

1. **Shortlist, without the model.** Search the vocabulary by name, keywords and place structure, and search the gismu
   table for candidate roots by keyword. The model gets the existing predicates and a few dozen candidate gismu, not the
   whole table (avenOS put all of it in every prompt; a mint took about 50 s).
2. **Choose.** One entry per relationship in the request: reuse an existing predicate, or mint one with the gismu's full
   place structure and typed places.
3. **Check.** Meta-grammar, then the gismu table (positions, kinds, completeness), then the vocabulary (no second
   predicate with the same meaning; a near match becomes a lens or a reuse).
4. **Write or propose.** Additive definitions go into the vault's vocabulary directly. Anything for the network's
   vocabulary is a proposal ([docs](../docs/README.md#history-versions-and-lines)) that its admin accepts.
5. **Keep provenance.** Who asked, which model, which request, as facts about the new definition.

Kinds are minted the same way, on top of the predicates, and queries and mutations in the engine's grammar. A kind made
for real documents brings samples (rule 11): the agent shows which input fields have no trait, and the kind waits until
it has one or a person accepts the loss. The agent's prompts are themselves data in its actor's document, so how it
reasons changes without a deploy.

## A worked example

A person says: "track which projects people are members of, and show me projects with more than three members."

1. The agent's shortlist finds `member_of` (cmima) in the core vocabulary: x1 the member, x2 the set. Reuse.
2. `project` doesn't exist. The shortlist offers `gunka`, `zukte` and `jibri`; none means a project, so the agent mints
   `project` as a coined one-place predicate (the fact is the project) with a gloss, and a kind `project` with a `name`
   trait. The engine compiles the kind's operations.
3. The person adds three members to "Garden". Each is one `assert`: `member_of(x1 = <person>, x2 = <garden>)`, written
   into the coop's projects document with the person's caps.
4. The agent writes a query in the engine's grammar,
   `{ "from": "member_of", "group": "x2", "count": true, "having": { "op": "gt", "value": 3 } }`, stored as
   `projects.crowded`, run on the person's device within its bound.
5. A fourth member is added on another device. Sync brings the fact, the index changes, and the live query pushes
   "Garden" into the result. Nothing re-queried.

Nothing in that example needed a deploy, and every step is a check Lean defines.

## Decisions

1. **A fact grammar, not documents of JSON.** Records with fields are easier at first and harder forever: every kind
   needs its own code, and nothing composes across kinds. avenOS proved the grammar carries todos, contacts, invoices and
   reified quantities on one engine. (Documents of plain records still exist in the docs layer, for things like the
   editor's text; facts are for what needs meaning across kinds.)
2. **Gismu place structures, English names.** Argument order is the thing every relation format gets wrong differently.
   The gismu are a standard refined for decades, small (1341), and readable by any model. Names stay English, so nobody
   reads Lojban to use the system.
3. **The full place structure, with coined predicates allowed.** Completeness keeps predicates reusable. Where no gismu
   fits (double-entry posting, a VAT rate on a line), a coined predicate is better than a gismu bent out of shape;
   avenOS's VAT stalled because `parbi` had no place to anchor the rate.
4. **Predicates named by hash.** Identity by name made duplicates and silent collisions; identity by hash makes a
   definition's version its name and gives dedup across vaults for free.
5. **Typed places, refs included.** avenOS kept every place as a string and every ref as `any`. Money, dates and
   pointing at the wrong thing were all caught too late or never.
6. **Cardinality in the id.** On one Postgres, "replace the due date" was a delete and an insert. Between peers it is two
   devices writing at once; slot ids make that converge without a merge rule per trait.
7. **One trait declaration for write and read.** avenOS declared parts (how to write) and a projection (how to read)
   separately, and its compiler refused nested and discriminated traits, exactly what invoices needed. One declaration
   makes the round-trip law provable for every trait.
8. **Evolution belongs to the docs layer.** A predicate is a schema there; its versions, lanes and lenses are the same
   machinery every document uses, proven once.
9. **The agent is a vault with caps.** An LLM that mints is an actor like any other: bounded by caps, its writes signed,
   its proposals reviewed like a person's.

## Strengths, weaknesses, and how this design answers them

| | What happened | This design |
|---|---|---|
| **Strength:** one engine for every kind | avenOS deleted its per-domain code: a new kind was a row, CRUD and queries came free (0088, 0104) | Kept: kinds compile to operations (rule 10, engine) |
| **Strength:** composes as a graph | Facts point at ids; chained joins walk referents; reification nests anything (0103, 0112) | Kept, plus bounded walks and aggregates over typed values (engine) |
| **Strength:** open world | A new fact about an entity needs no schema change | Kept |
| **Strength:** readable by models | Gismu places and glosses gave GLM a standard to mint against; "a person can be a member of a project" became `member_of` (cmima) live (0100) | Kept, with a shortlist instead of the whole table |
| **Strength:** dynamic but safe | Fixed meta-schemas, bound parameters, refs that fail closed, deletes confirmed by a person | Kept and moved into Lean (rule 7, engine) |
| **Weakness:** strings everywhere | Amounts as `"357.00"`, dates as text; September's reconciliation redid it with integer minor units | Closed value types with canonical encodings |
| **Weakness:** untyped refs | `references: "*"`; nothing checked what a ref pointed at (avenOS, MaiaOS) | Typed refs, checked by the writer (rule 6) |
| **Weakness:** duplicates by name | Dedup compared names only; vocabularies were per user | Hash identity, three vocabulary lanes, lenses to align |
| **Weakness:** no evolution | Renames broke a deploy; specs were frozen into migrations to replay | Versions by hash, lenses in docs (rule 12) |
| **Weakness:** compiler gaps | `children` and `match` traits could not compile to operations | One trait declaration, round-trip proven for all (rule 10) |
| **Weakness:** the domain didn't fit | 22 of 49 invoice fields unstorable; VAT and line order never modelled | Samples must round-trip (rule 11); coined predicates; `order` on `many` |
| **Weakness:** concurrency | Single database, no merge story | Slot ids (rule 9); mutations atomic per document (engine) |
| **Weakness:** caps never met facts | Access was a user id filter; biscuits lived in another store | Write caps by predicate, read caps by document (engine, milestone 3) |
| **Weakness:** too many facts per thing | An invoice with its parties was 43 rows; hominio made 5 documents per todo | Many facts per document; views are caches; queries are local (engine) |
| **Weakness:** too much at once | 29 migrations in three days reshaped the same specs | Lean first, vectors, one milestone at a time |

## What Lean proves

`Aven.DB` grows an ontology model, with vectors every implementation loads (README, rule 10):

- **The checker:** a fact accepted by `check` fits its predicate's places, values and refs alike. A gismu-sourced
  predicate matches the gismu table in position, kind and count. Vectors `predicates.json`, accepted and refused.
- **Kinds:** for every kind and every valid view `v`, `read (create v) = v`, for `one`, `maybe`, `many`, nested, ordered
  and fixed traits; `delete` leaves no trait fact of the entity behind. Vectors `kinds.json`, which the engine's
  compiled operations replay.
- **Slots:** two concurrent writes to a `one` or `maybe` trait merge into exactly one fact. Traces `slots.json`.
- Lenses between predicate versions use the docs layer's laws; queries and mutations the engine's.

## Open questions

1. How strict is the gismu rule: may a vault coin freely, or does a coined predicate need a person's acceptance?
2. Is five places the hard limit, with referents beyond it, or do we allow named extra places the way Lojban's `fi'o`
   tags do?
3. Who accepts proposals into the network's vocabulary: the admin coop's owners, or a cap given for it?
4. Which value types does the first version need beyond the list above (durations, geo points)?

## Not in this spec

Documents, versions, schemas and lenses ([docs](../docs/README.md)); sync, the index, queries and mutations
([engine](../engine/README.md)); the minting agent's UI in avenOS; embeddings for the shortlist.
