# The ontology: one fact grammar, fully dynamic

A proposal (30 Oct 2026) for how avenDB says what its data means: one grammar for every fact, `predicate(x1…x5)`,
with place structures borrowed from Lojban's gismu, and everything above that grammar kept as data that a person or an
agent can add to while the system runs. It is written for milestones 6 (schemas and lenses) and 7 (queries), with
hooks into 3 (caps), 4 (documents) and 5 (proposals). Nothing here is built before its milestone, and nothing comes in
from the older engines as code (README, rule 12): their learnings come in as the rules, decisions and Lean theorems
below.

## Where it comes from

The same idea has been built three times, and avenDB-old added what all three lacked. The third build worked and was
stripped for reasons outside the grammar.

| When | Where | Substrate | What it taught |
|---|---|---|---|
| Apr–May 2025 | `hominio-legacy`, HQL (`450fd04`, `a2672be`) | one Loro doc per fact | The grammar is enough for an app. One document per fact is far too many; untyped places and caps written in code don't hold. |
| Dec 2025 | `MaiaOS`, `libs/hominio-db` (`89dc1186`) | Jazz CoValues | Places that are bare references check nothing; a type looked up by name drifts from the stored one. |
| Jun–Jul 2026 | `avenOS`, boards 0085–0112 (squashed in `2894d6eb`) | Postgres, columns `predicate, x1…x5` | **The working engine:** gismu places, taxonomy by position, kinds that compile to operations, validated query and mutation specs, an LLM minting predicates, kinds and queries with no deploy. |
| until Oct 2026 | avenDB-old (`aven/db`, `lens.rs`, `Lens.lean`) | Loro, sealed | Schemas named by their hash, lenses instead of migrations, laws proven in Lean (GetPut, PutGet, an older app keeps what it can't see). |

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

The only fixed things are the grammar, its checker, the engine that runs specs over facts, and the merge rules. All of
them are defined in Lean. Everything else is data in documents: predicates, kinds, queries, mutations, lenses, category
trees, and the prompts the minting agent reasons with. Nothing a person or an agent adds needs a deploy.

## Terms

- **fact:** one statement, `{ id, p, x1…x5 }`, kept in a document. Its `id` names the entity it introduces.
- **predicate:** a definition of a relation: an English name, the gismu it borrows from, a gloss, and its places. It is
  a blob named by the BLAKE3 hash of its canonical bytes.
- **place:** one of `x1…x5`. A **value place** holds a typed value; a **ref place** holds a fact's id.
- **entity:** whatever a fact's id stands for. The `person` fact is the person; facts about them point at it.
- **referent:** an entity made only so other facts can point at it ("the 2 bananas", "this payment").
- **vocabulary:** the predicates a vault or a network uses, by name. A document of its own.
- **category:** an entity in a vocabulary that stands for a kind of thing (`addressing system: email`), referenced from
  the place the gismu gives for it.
- **kind:** a named composition of predicates around an entity, with a flat view (a todo, an invoice). The older
  engines called it a bundle or `TypeSpec`.
- **trait:** one predicate's part in a kind, with its cardinality.
- **operation:** a validated query or mutation spec, stored as data.
- **lens:** a two-way mapping between two versions of a predicate or a kind.
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
7. **Everything above the grammar is data, checked by a fixed meta-grammar.** Predicates, kinds, queries, mutations
   and lenses are JSON checked against grammars whose meaning Lean defines. What an agent writes passes the same check
   as what a person writes.
8. **Agents write specs, never code.** An LLM authors predicates, kinds, queries, mutations and lenses as specs. The
   engine evaluates specs; there is nothing for a spec to execute.
9. **Reuse before minting.** Before a new predicate, kind or operation is made, the existing ones are searched, and a
   fit is reused. Two predicates that mean the same must be aligned by a lens, never left as duplicates.
10. **A kind compiles to its operations, and it round-trips.** A kind is compiled once, when it is saved, into its
    list, create, update and delete operations. For every trait the grammar allows, reading back what was written
    returns exactly what was written. The compiler refuses nothing the grammar allows.
11. **A kind proves itself on real inputs.** A kind made for real documents carries samples of them. It is accepted
    when every sample round-trips without loss, or when a person accepts the named losses.
12. **Nothing is migrated.** A predicate or kind changes by a new version and a lens from the old one. Every fact
    records the predicate it was written under (its hash). Readers see facts through lenses; writers write back only
    what changed, and an older app keeps what it can't see.
13. **Cardinality lives in the id.** A trait that holds at most one fact per entity gets a slot id derived from the
    entity, the predicate and its fixed places, so two devices writing it at once converge on one fact. A trait that
    holds many gets fresh ids, so concurrent writes all survive.
14. **Queries always end.** Every query has a bound on its work, computed from its spec and the facts it reads, before
    it runs (README, rule 3). Graph walks have an explicit depth.
15. **Caps reach facts by predicate.** A write cap may narrow to a set of predicates. Every fact written is checked
    against the writer's caps, an agent's included.
16. **Views are caches, pushed as deltas.** Indexes and kind views are derived state keyed by the documents' heads and
    the code version (README, rule 5). A live query pushes changes to the UI; nothing re-queries (rule 8).

## Architecture

```
avenOS        apps read kinds and run operations; the minting agent proposes new ones
  ontology    the grammar, the vocabulary, kinds, operations, lenses, the local index
    avenDB    documents (Loro, sealed), caps, sync, the store
      avenID  who acts: vaults, devices, agents
```

### Where facts live

**A document is the unit of sharing; a fact is the unit of meaning.** A document holds many facts, in a Loro map
keyed by fact id:

```json
{ "facts": {
    "t1": { "p": "b3:task…",      "x1": "@samuel", "x2": "Order seeds" },
    "s:9f2c…": { "p": "b3:due…",  "x1": "2026-11-02", "x2": "t1" },
    "k4": { "p": "b3:tagged…",    "x1": "garden", "x2": "t1" } } }
```

- Facts that are shared together live in one document: a person's household, a coop's books, one shared invoice. The
  boundary is chosen by who may read, because a document is what caps grant and what gets sealed.
- A ref inside a document is the fact id; across documents it is `<document>/<fact>`.
- `s:9f2c…` is a slot id (rule 13): `due` is at most one per task, so its id is derived from `t1` and `due`, and two
  devices setting the date at once write the same key. Loro keeps one.
- Who wrote a fact and when comes from Loro's history and the signed envelope. It is not modelled as facts. When the
  domain needs valid time ("this price holds from March"), that is a predicate.

### The vocabulary

Predicates are blobs named by their hash; a vocabulary maps names to hashes. Three layers, looked up in order:

1. **A vault's vocabulary:** what its people and agents minted. Private unless published.
2. **The network's vocabulary:** published by the admin coop (Maia City for Aven). Shared by every member.
3. **The core vocabulary:** a handful fixed in Lean, which the rest is built on: `name` (cmene), `member_of` (cmima),
   `class_of` (klesi), `equals` (dunli).

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
definition get the same predicate, and a changed definition is a new version that the old facts keep pointing past.

**Value types** (closed, each with one canonical encoding): `text`, `int`, `decimal` (exact digits and scale, no
floats), `money` (minor units and a currency category), `date`, `time` (UTC), `bool`, `blob` (a hash). Money is never
a string again.

**Categories** are entities in a vocabulary document, named and grouped by core facts:

```
email:            name(x1 = "email", x2 = email)
                  member_of(x1 = email, x2 = addressing_system)
addressing_system: class_of(x1 = addressing_system, x2 = category)
```

A category tree is walked by a bounded query (`class_of`, `member_of`), so "every kind of identifier" is one query and
a new kind of identifier is one fact.

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
  `maybe` get slot ids (rule 13).
- `fix`: fixed place values. They scope the trait, so several traits can share one predicate (every identifier is
  `identifier`, told apart by its kind in x1).
- `of`: the elements of a `many` trait are entities of another kind, read back as a nested list. `order` names the
  element kind's field that keeps their order; a list without one is a set.
- Category refs (`idkind:invoice_number`) are shown here by name; stored, they are the category entity's id.
- `presence`: a `maybe` trait read back as a boolean ("done" is a `done` fact being there).

The view of this kind is `{ id, biller, number, total, issued_on, lines: [...], payments: [...] }`. Saving the kind
compiles it into `invoice.list`, `invoice.create`, `invoice.update` and `invoice.delete`, stored as operations. From
then on, apps and agents run operations; nothing interprets the kind again.

### Operations

Queries and mutations are specs, stored in a document and run by one engine over the device's local index.

**A query** names a base predicate, filters, joins, and what to return:

```json
{ "from": "task",
  "join": [ { "predicate": "done", "kind": "left", "on": { "place": "x1", "base": "id" } },
            { "predicate": "due",  "kind": "left", "on": { "place": "x2", "base": "id" } } ],
  "where": [ { "join": 0, "place": "id", "op": "isnull" } ],
  "order": [ { "join": 1, "place": "x1" } ],
  "project": [ "id", { "place": "x2", "as": "title" }, { "join": 1, "place": "x1", "as": "due" } ] }
```

Open todos by due date. The grammar:

- `where`: `eq neq gt gte lt lte in` with a value or `{ "param": … }`, and `isnull notnull` for presence. A filter
  targets the base or a join.
- `join`: `inner` or `left`, correlated on the base's id or a place, or on an earlier join (`{ "join": 0, "place":
  "id" }`), so a query walks a chain of referents to any written-out depth. A reference forward or to itself is refused
  before anything runs.
- `walk`: a bounded transitive step (`class_of` from a category up to its roots, at most N hops).
- `group` with `count`, `sum`, `min`, `max` over typed value places, and `having`.
- `order` and `limit`.
- `project`: places of the base or a join, renamed with `as`, or `exists` booleans.

Three levels, "2 kg of rice", where the unit is a fact about the quantity, not the rice:

```json
{ "from": "item",
  "join": [ { "predicate": "quantity", "kind": "left", "on": { "place": "x1", "base": "id" } },
            { "predicate": "unit",     "kind": "left", "on": { "place": "x1", "base": { "join": 0, "place": "id" } } } ],
  "project": [ "id", { "place": "x2", "as": "name" }, { "join": 0, "place": "x2", "as": "qty" },
               { "join": 1, "place": "x2", "as": "unit" } ] }
```

**A mutation** is a list of operations applied as one commit to one document, all or nothing:

```json
{ "params": ["n"],
  "ops": [ { "op": "assert", "predicate": "banana" },
           { "op": "assert", "predicate": "quantity", "cells": { "x1": { "ref": 0 }, "x2": { "param": "n" } } },
           { "op": "assert", "predicate": "eat",      "cells": { "x1": { "bind": "$actor" }, "x2": { "ref": 0 } } } ] }
```

- `assert` adds a fact; `set` changes places of a fact found by `where`; `retract` removes facts found by `where`.
- A cell is a literal, `{ "param": … }`, `{ "bind": "$actor" | "$vault" | "$now" }`, or `{ "ref": n }`: the id
  op `n` created. `n` must be an earlier `assert`.
- `when` skips an op unless a param is given.
- A mutation that retracts needs a person's confirmation in avenOS; an agent can only propose it.
- A mutation touches one document. Work across documents is several mutations, each atomic; nothing pretends to a
  transaction the network can't give.

### The minting agent

The agent that grows the ontology is an agent like any other (avenID): a device vault under the person's aven, acting
with the caps the person gave it. It writes the person's vault vocabulary and operations; it can only propose to the
network's vocabulary or to anything that removes data.

From a request ("I want to track which projects people are members of"):

1. **Shortlist, without the model.** Search the vocabulary by name, keywords and place structure, and search the gismu
   table for candidate roots by keyword. The model gets the existing predicates and a few dozen candidate gismu, not
   the whole table (avenOS put all of it in every prompt; a mint took about 50 s).
2. **Choose.** One entry per relationship in the request: reuse an existing predicate, or mint one with the gismu's
   full place structure and typed places.
3. **Check.** Meta-grammar, then the gismu table (positions, kinds, completeness), then the vocabulary (no second
   predicate with the same meaning; a near match becomes a lens or a reuse).
4. **Write or propose.** Additive definitions go into the vault's vocabulary directly. Anything for the network's
   vocabulary is a proposal (milestone 5) that its admin accepts.
5. **Keep provenance.** Who asked, which model, which request, as facts about the new definition.

Kinds and operations are minted the same way, on top of the predicates. A kind made for real documents brings samples
(rule 11): the agent shows which input fields have no trait, and the kind waits until it has one or a person accepts
the loss. The agent's prompts are themselves data in its actor's document, so how it reasons changes without a deploy.

### Lenses

A predicate's new version comes with a lens from the old one, as data. avenOS stored amounts as text; the fix is a
version of `total` whose x1 is `money`, and a lens:

```json
{ "lens": "total, text to money", "from": "b3:total-v1…", "to": "b3:total-v2…",
  "steps": [ { "convert": { "place": "x1", "forward": "parse_money", "backward": "format_money" } } ] }
```

- Lens steps: `rename` (a place moves position), `convert` (a value through a named, Lean-defined pair of functions or a
  table), `add` (a new place with a default), `split` and `join` (one place to a referent's facts and back).
- A reader on v2 sees v1 facts through the lens; a v1 app keeps writing v1 facts, and v2 apps keep what v1 can't see.
- A step that loses information says so, and Lean states the loss (as avenDB-old did for `done` and `doing`).
- Kinds get lenses too: a trait renamed, a field added, a `maybe` becoming `many`.
- Two vocabularies that minted the same meaning differently are aligned by a lens between their predicates, so a
  network can merge a member's vocabulary into its own without touching a fact.

### Caps

Caps come in milestone 3; the ontology asks two things of them:

- **Write caps may narrow by predicate.** A cap on a document may list the predicates its holder may assert, set and
  retract. A bookkeeping agent may write `booked` and `matched` in the coop's books and nothing else.
- **Read caps stay per document.** Narrowing reads by predicate would mean sealing each predicate apart. Instead,
  facts that need different readers go in different documents, which is what documents are for.

Every fact written is checked against its writer's caps and its predicate's places, on every peer that opens the
document, so an agent can't write past what it was given.

### The index

Each device keeps a local index of the facts it can open: by predicate, by place and value, by ref. Queries run on it,
across all the documents the device holds. The Aven Peer never queries anything; it only ever sees ciphertext. The index
and the kind views are caches keyed by the documents' heads and the code version, rebuilt without blanking a screen, and
every live query is a subscription that pushes deltas as facts change.

## A worked example

A person says: "track which projects people are members of, and show me projects with more than three members."

1. The agent's shortlist finds no `member_of` in the vault's vocabulary but finds it in the core vocabulary. Reuse:
   `member_of` (cmima), x1 the member, x2 the set.
2. `project` doesn't exist. The shortlist offers `gunka`, `zukte` and `jibri`; none means a project, so the agent
   mints `project` as a coined one-place predicate (the fact is the project) with a gloss, and a kind `project` with
   a `name` trait.
3. The person adds three members to "Garden". Each is one `assert`: `member_of(x1 = <person>, x2 = <garden>)`, written
   into the coop's projects document with the person's caps.
4. The agent writes the query:

   ```json
   { "from": "member_of", "group": "x2", "count": true, "having": { "op": "gt", "value": 3 } }
   ```

   It is checked, stored as `projects.crowded`, and runs on the person's device. Its bound is the number of
   `member_of` facts.
5. A fourth member is added on another device. Sync brings the fact; the index changes; the live query pushes "Garden"
   into the result. Nothing re-queried.

Nothing in that example needed a deploy, and every step is a check Lean defines.

## Decisions

1. **A fact grammar, not documents of JSON.** Records with fields are easier at first and harder forever: every kind
   needs its own code, and nothing composes across kinds. avenOS proved the grammar carries todos, contacts, invoices
   and reified quantities on one engine.
2. **Gismu place structures, English names.** Argument order is the thing every relation format gets wrong
   differently. The gismu are a standard refined for decades, small (1341), and readable by any model. Names stay
   English, so nobody reads Lojban to use the system.
3. **The full place structure, with coined predicates allowed.** Completeness keeps predicates reusable. Where no gismu
   fits (double-entry posting, a VAT rate on a line), a coined predicate is better than a gismu bent out of shape;
   avenOS's VAT stalled because `parbi` had no place to anchor the rate.
4. **Predicates named by hash.** Identity by name made duplicates and silent collisions; identity by hash makes a
   definition's version its name and gives dedup across vaults for free.
5. **Typed places, refs included.** avenOS kept every place as a string and every ref as `any`. Money, dates and
   pointing at the wrong thing were all caught too late or never.
6. **Cardinality in the id.** On one Postgres, "replace the due date" was a delete and an insert. Between peers it is
   two devices writing at once; slot ids make that converge without a merge rule per trait.
7. **One trait declaration for write and read.** avenOS declared parts (how to write) and a projection (how to read)
   separately, and its compiler refused nested and discriminated traits, exactly what invoices needed. One declaration
   makes the round-trip law provable for every trait.
8. **Queries run on devices, over a local index.** There is no server that can read facts. A local index is enough for
   a person's or a coop's data, and keeps rule 8 (pushed deltas) natural.
9. **Mutations are atomic per document.** A promise across documents would need coordination the network doesn't have.
10. **The agent is a vault with caps.** An LLM that mints is an actor like any other: bounded by caps, its writes
    signed, its proposals reviewed like a person's.
11. **Lenses, never migrations,** as avenDB-old proved: data written by any version stays readable by every version.

## Strengths, weaknesses, and how this design answers them

| | What happened | This design |
|---|---|---|
| **Strength:** one engine for every kind | avenOS deleted its per-domain code: a new kind was a row, CRUD and queries came free (0088, 0104) | Kept: kinds compile to operations (rule 10) |
| **Strength:** composes as a graph | Facts point at ids; chained joins walk referents; reification nests anything (0103, 0112) | Kept, plus bounded walks and aggregates over typed values |
| **Strength:** open world | A new fact about an entity needs no schema change | Kept |
| **Strength:** readable by models | Gismu places and glosses gave GLM a standard to mint against; "a person can be a member of a project" became `member_of` (cmima) live (0100) | Kept, with a shortlist instead of the whole table |
| **Strength:** dynamic but safe | Fixed meta-schemas, bound parameters, refs that fail closed, deletes confirmed by a person | Kept and moved into Lean (rule 7) |
| **Weakness:** strings everywhere | Amounts as `"357.00"`, dates as text; September's reconciliation redid it with integer minor units | Closed value types with canonical encodings |
| **Weakness:** untyped refs | `references: "*"`; nothing checked what a ref pointed at (avenOS, MaiaOS) | Typed refs, checked by the writer (rule 6) |
| **Weakness:** duplicates by name | Dedup compared names only; vocabularies were per user | Hash identity, three vocabulary layers, lenses to align |
| **Weakness:** no evolution | Renames broke a deploy; specs were frozen into migrations to replay | Versions by hash, lenses (rule 12) |
| **Weakness:** compiler gaps | `children` and `match` traits could not compile to operations | One trait declaration, round-trip proven for all (rule 10) |
| **Weakness:** the domain didn't fit | 22 of 49 invoice fields unstorable; VAT and line order never modelled | Samples must round-trip (rule 11); coined predicates; `order` on `many` |
| **Weakness:** concurrency | Single database, no merge story | Slot ids (rule 13); mutations atomic per document |
| **Weakness:** caps never met facts | Access was a user id filter; biscuits lived in another store | Write caps by predicate, read caps by document |
| **Weakness:** too many facts per thing | An invoice with its parties was 43 rows; hominio made 5 documents per todo | Many facts per document; views are caches; queries are local |
| **Weakness:** too much at once | 29 migrations in three days reshaped the same specs | Lean first, vectors, one milestone at a time |

## What Lean proves

`Aven.Ontology` (a proposal for the package's name), with vectors every implementation loads (README, rule 10):

- **The checker:** a fact accepted by `check` fits its predicate's places, values and refs alike. A gismu-sourced
  predicate matches the gismu table in position, kind and count. Vectors `predicates.json`, accepted and refused.
- **Kinds:** for every kind and every valid view `v`, `read (create v) = v`, for `one`, `maybe`, `many`, nested,
  ordered and fixed traits; `delete` leaves no trait fact of the entity behind. Vectors `kinds.json`.
- **Slots:** two concurrent writes to a `one` or `maybe` trait merge into exactly one fact. Traces `slots.json`.
- **Queries:** evaluation ends within the bound computed before it runs; a chained join refers only backward; results
  equal the model's on random fact sets. Vectors `queries.json`.
- **Mutations:** all ops apply or none; every `{ "ref": n }` points at an earlier assert; a mutation touches one
  document. Vectors `mutations.json`.
- **Lenses:** GetPut, PutGet, and an older version keeps what it can't see; lossy steps state their loss. Vectors
  `lenses.json`.
- **Caps:** a fact is accepted only if its predicate is within its writer's write cap.

## Open questions

1. Is the package its own (`aven/DB2/ontology`, beside `db` and `id`) or part of `db/`?
2. How strict is the gismu rule: may a vault coin freely, or does a coined predicate need a person's acceptance?
3. Is five places the hard limit, with referents beyond it, or do we allow named extra places the way Lojban's `fi'o`
   tags do?
4. Who accepts proposals into the network's vocabulary: the admin coop's owners, or a cap given for it?
5. Which value types does the first version need beyond the list above (durations, geo points)?

## Not in this spec

How the index is laid out on disk; the minting agent's UI in avenOS; embeddings for the shortlist; queries that run on
another peer's behalf; full text search.
