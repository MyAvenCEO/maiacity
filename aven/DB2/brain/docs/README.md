# avenDOCS

avenDOCS is avenDB's docs layer: it makes a Doc, mutable data with a stable name, out of signed envelopes that every
reader checks for itself, and gives each Doc its types, its history, its branches and its structures.

## Owns

- [A Doc and its genesis](#a-doc-and-its-genesis): `{pins, type, nonce, vault}`, unsigned, named by A30; what a Doc
  refers to at birth sits in its root Record.
- [Records](#records): typed pieces of a Doc, flat by id in one root map, each field in the container its schema picks.
- [Types, schemas and fit](#types-schemas-and-fit): every Doc and every Record typed; types as Docs; the vocabulary;
  the built-in types and `BuiltinFit`; pins; fit.
- [Lenses](#lenses): two-way steps between versions, pinned where they are read, a forest.
- [The body](#the-body): what a docs envelope carries inside avenCORE's, avenCAPS' authority part carried unread.
- [Writer ids](#writer-ids): the Loro peer a device writes a branch as, worked out, never issued.
- [Loro](#loro): Loro 1.17.1 and its rules here; `LoroId`; the body's `loro` range; rule 7 in Loro's terms.
- [A commit](#a-commit): prepare → sign → finish, all or nothing.
- [Importing: three verdicts](#importing-three-verdicts): the import's steps, fit, `authorized` on the past, not a
  split; pages.
- [The live state](#the-live-state): what counts, the snapshot read, the change feed, the rebuild.
- [The judge](#the-judge): Loro behind the checks, where it can die alone; a crash mark kept local.
- [Generations and stuck logs](#generations-and-stuck-logs): a device's fresh start after a split or a stuck log.
- [Segments](#segments): a writer's closed run of one log, hybrid-signed; covers by the uploader's word.
- [Sealing and sealed pages](#sealing-and-sealed-pages): how a Doc uses avenID's seal; `import_sealed_page`, each
  item opened as what its commitment says it seals.
- [The head, the held page and the shelf](#the-head-the-held-page-and-the-shelf): what a peer keeps of a Doc, under
  two refs.
- [Limits](#limits): every input bounded before Loro sees it.
- [Checkpoints](#checkpoints): a signed, checkable state that travels.
- [Branches, merges and forks](#branches-merges-and-forks): branches inside a Doc, three-way merges, revert, back out,
  forks, named versions.
- [History](#history): the analysers, caches worked out from the envelopes.
- [Period Docs](#period-docs): streams that grow without end, as a series of Docs.
- [Directories and indexes](#directories-and-indexes): one sealed search tree; entries as their own envelopes.
- [The chat as a Doc](#the-chat-as-a-doc): a fresh Doc whose root Record names the frozen chains.

## Uses

- [avenCORE](../core/README.md#values): Values, [names](../core/README.md#names) by A30 (`[label, body]`) and
  [signed things](../core/README.md#signed-things).
- [avenCORE](../core/README.md#envelopes): the envelope, its name and its signatures, placed by who `Writes` its log;
  [logs](../core/README.md#logs), [splits](../core/README.md#splits),
  [the past and versions](../core/README.md#the-past) and [counting](../core/README.md#counting), with fit, authorized
  and revoked as parameters.
- [avenCORE](../core/README.md#ops-and-calls): calls `{op, params}`; [built-in types](../core/README.md#built-in-types),
  `builtinType` and the type of types; [limits](../core/README.md#limits).
- [avenID](../id/README.md#devices): device keys, Ed25519 for envelopes and the hybrid key for segments, counted once
  its owner binds it; [vaults](../id/README.md#vaults) and their names; [epochs](../id/README.md#epochs), their keys
  and the `epoch` Records; [the keyring](../id/README.md#the-keyring), which travels unsealed;
  [the seal](../id/README.md#the-seal), what it seals found by commitment, and
  [the one padding](../id/README.md#padding).
- [avenCAPS](../caps/README.md#the-readers-verdict): `reaches`, `authorized` and `revoked`;
  [the envelope's authority](../caps/README.md#the-envelopes-authority), `{acks, caps}` or `{acks, caps, actor}`; the
  `cap` and `revoke` Records and their shapes (`idBuiltinFit`, which checks avenID's `epoch` too);
  [collections](../caps/README.md#collections); the `own` condition; [the register](../caps/README.md#the-register) and
  its `tree` type.
- [avenOPS](../ops/README.md#footprints-and-the-merge-check): the change view (`RecordChange`), `typesKept`, the
  footprint; [a Record id as a key](../ops/README.md#a-record-id-as-a-key); calls lowered to steps; an index from a
  query's shape and its lookup ([the query side](../ops/README.md#sealed-indexes-the-query-side)).
- [avenSTORE](../store/README.md#blobs-and-refs): blobs named by hash, and refs moved by
  [compare-and-set](../store/README.md#compare-and-set).
- [avenPEERS](../peers/README.md#the-doc-host): the Doc host, which runs Docs in the Peer and the docs
  worker in the Peer-Light, and sifts a page that crashed that worker;
  [gossip per group](../peers/README.md#gossip-per-group),
  [sync by version](../peers/README.md#by-version-between-readers), [the fetch gate](../peers/README.md#the-fetch-gate),
  [keepers](../peers/README.md#keepers) and [catch-up from keepers](../peers/README.md#by-arrival-number-from-keepers).
- [avenRUNTIME](../runtime/README.md#pins): the runtime a checkpoint or a fold names, pinned by hash.

## A Doc and its genesis

A **Doc** is mutable data named by a stable id. Its state is the merge of its writers' logs, and only its head moves.
It is the unit of sharing, sealing, caps, sync and atomic change. Every reader checks every envelope itself, from what
the envelope names, and every reader reaches the same verdict.

A Doc is born with a **genesis**, which seals its vault and its root type into its name: nobody can later claim another
owner or another type without another id.

- **The genesis** is a Core Value with exactly these keys, no defaults, in the codec's order:
  `{pins, type, nonce, vault}`.
  - `pins`: the user-type versions it accepts at birth, `[[type Doc, [schema hash, …]], …]`: sorted by type, no type
    twice, each list of schema hashes non-empty, sorted and distinct, and never a built-in type.
  - `type`: its root type, a type Doc's id. Every Doc has one; a Doc never changes type, and turning an invoice into
    something else is a fork into a new Doc.
  - `nonce`: 32 random bytes, so two Docs born alike differ.
  - `vault`: the vault it belongs to, by the vault's 32-byte name ([avenID](../id/README.md#vaults)).
- **Its id** is the genesis's name: the hash of `["avenDB genesis 1", genesis]`. The label is its version. In JSON it
  is `{"bytes": "<hex>"}`, as every byte string is; `d:<hex>` is only for display.
- **It carries no signature of its own.** It rides in the body's `genesis` exactly in a log's first envelope (sequence
  number 1, no `prev`, no `deps`) and nowhere else. A reader refuses either mismatch, and a genesis whose id isn't the
  envelope's Doc. The first envelope's signature and authority authorize it: a `core/1` `put` of the root Record on
  `vaultType(vault, type)`. So every envelope of a Doc whose whole past is held reaches the genesis that names it.
- **What a Doc refers to at birth** (a fork's origin, a period Doc's predecessor, the chat's frozen chains) is in its
  root Record, written by its first envelope and fixed at birth. It is never a key of the genesis.
- **A vault's singletons** (its profile, its vocabulary) are found by name in the vault's vocabulary, never by a
  guessable id. Two made offline at once are both kept, and the vocabulary's one key picks the one that counts.

**Decided:** A30, A32, A39, A81, A95, A149, A164, A174, docs 13, docs 24 · **Lean:**
`Aven.DB.Docs.Genesis` — `id_fixes`; `Aven.DB.Docs.Body` — `genesis_iff_first`, `genesis_names_doc`,
`root_carries_genesis`, `closed_reaches_genesis`

## Records

A **Record** is one typed piece of a Doc, addressed `<doc>/<id>`. The Doc itself is its **root Record**. A type says
which of its Records are roots: an invoice, a page, a chat room, an actor. Any other Record lives inside its Doc and
changes atomically with it. Where a Record sits can change; its address can't.

- **One Loro document per branch.** Its Records sit flat by id in the root map `records`, each a map container keyed by
  [its id as a key](../ops/README.md#a-record-id-as-a-key). Inside one Doc a link may name the bare id.
- **Each Record holds `t`,** its type Doc's id, fixed at its birth (a retype is refused,
  [`typesKept`](../ops/README.md#footprints-and-the-merge-check)), and its fields. Records carry no `kind` field.
- **Order and nesting are fields:** ids in a parent's movable list or tree. Moving a Record never changes its address,
  and a change to a container maps straight to the Record it lies in, which gives the change feed and every footprint
  without a path.
- **Ids two writers may create at once** (the ontology's slot ids) meet on one key: the Record's map is made with
  `ensure_mergeable_map`, so they share it. Every container made after a Record's birth is made mergeable the same way.
- **Links are ids,** never shared containers: Loro composes as trees, not graphs. A link is a field holding the address
  of a Record or a Doc (`x-link`).
- **A field's value is a Core Value:** no floats, and integers within Loro's `i64`. Anything else Loro might hold is no
  Value, so it never fits.
- **Every Record's creator is known:** the device and vault that signed the envelope that created it, read from history
  and never stored as a field anyone could change. avenCAPS' `own` condition reads it.

| The schema says | Container | When two writers edit at once |
|---|---|---|
| a string with `"x-loro": "text"` | Text | merges character by character |
| rich text, for the editor | Text with marks | character by character; marks by Loro's rules |
| a list of values | List | both inserts kept |
| a list of Records | MovableList of ids | rows added, moved or edited apart all land |
| an outline or folders | Tree of ids | moves merge; a move that would make a cycle is dropped |
| a counter | Counter | adds sum |
| a map of entries (`additionalProperties`) | Map | one value per key, the later writer's |
| anything else | a value in the Record's map | the later writer's |

**Decided:** A39, A96, docs 1, docs 5, docs rules 2–4 · **Lean:** `Aven.DB.Docs.Head` — `recordsRoot`; the
type kept: avenOPS' `typesKept` (#1712)

## Types, schemas and fit

Every Doc has a type, and so does every Record. A user type's Records are written under a schema version the Doc pins;
a built-in type's Records under its definer's check. There are no schemaless Records, so a Record is always read and
queried by its type.

### Types are Docs

A **type** is a Doc whose Records are its versions. A type Doc's own root type is avenCORE's built-in type of types.

- **A version** is a built-in `schema` Record, `{at, name, schema}` (A207). `schema` is the schema's Value whole, in
  its one form; `name` is a title, and `at` the type Doc's tips it was published at. Its schema's hash names it: a pin
  `(type Doc, h)` resolves to the version whose `blake3(encode(schema))` is `h`. Being a built-in, it is write-once, so
  a pinned schema never changes under its pin.
- **The parent and the lens** aren't in the version yet. They come with lenses (step 3); until then a type's versions
  form no tree, and no lens joins them.
- **A schema**, in step 1's form, is `{title, closed, fields: [[name, kind, required]…]}`: a kind is `any`, `bool`,
  `text`, `bytes`, `hash`, `["uint", max]` or `["array", kind]`, no field is named twice, and it says only what survives
  a merge ([fit](#fit)). JSON Schema's subset, with `x-loro` for the container and `x-link` for a link and the types it
  may point at, replaces it in step 3, as in the example below.
- **A type id** is `<type Doc>/<schema hash>`, the one way a version is named anywhere: a Record's writes in a body's
  `records`, a fact's `p`, an actor message's payload. Two type Docs may hold the same schema bytes, and their type
  ids still differ. Type ids a lens path joins are compatible, in one type Doc or across two.
- **Who writes a type Doc** is whoever its caps let publish versions. The ontology's predicates, actor definitions and
  runtime grammars are types the same way.
- **The vocabulary** is a vault's named types, ops, runtimes and definitions, one Doc per vault. Names resolve in the
  vault's, then the network's, then the built-in ones.

```json
{ "title": "Todo, v1", "type": "object",
  "properties": {
    "title":  { "type": "string", "default": "" },
    "status": { "enum": ["open", "doing", "done"], "default": "open" },
    "notes":  { "type": "string", "x-loro": "text", "default": "" },
    "due":    { "type": "string", "format": "date" } },
  "required": [] }
```

**Decided:** A1, A39, A42, A172, A207, K5, docs rule 3 · **Lean:** `Aven.Core` — `typeOfTypes`; `Aven.DB.Docs.Schema` —
`Schema.ofValue?`, `ofValue_value`, `value_ofValue` (pending in #1742); JSON Schema's subset: not in Lean yet

### Built-in types

A **built-in type** is named by a fixed label, so every reader knows it without fetching anything. It is versioned by
its label, has no schema and is never pinned. Whoever defines it checks its Records' shape.

- **Its id** is avenCORE's `builtinType` of the label `<namespace> <name> 1`; avenDOCS' five use `avenDB`.
- **avenDOCS' five,** each a map of exactly these fields, in the codec's order:

  | Type | Fields | What it says |
  |---|---|---|
  | `branch` | `base` hashes, `name` text, `nonce` a hash, and `follows` text or absent | a branch's start ([below](#branches)) |
  | `closed` | `at` hashes, or none | a branch is closed |
  | `version` | `at` hashes, `name` text | a named version |
  | `schema` | `at` hashes, `name` text, `schema` a schema in its one form | a type Doc's version ([Types are Docs](#types-are-docs)) |
  | `split` | `after` a hash, `writer` an unsigned integer | the Doc's owners declare a split |

- **Other definers:** [avenID](../id/README.md#built-in-types) defines `keyring`, `safe` and `epoch`;
  [avenCAPS](../caps/README.md#where-caps-live) defines `group`, `collection`, `cap` and `revoke`, and its register
  `tree`.
- **Fit takes the checks as a parameter,** `BuiltinFit : DocId → Option (Value → Bool)`, one per definer, joined
  (`BuiltinFit.or`; Rust `Either`). A type nobody supplies is no built-in, so its Records don't fit.
- **A built-in Record** is written whole at its birth and its fields, as a map, pass its definer's check. It is never
  edited, and may be removed.
- **The version a Record is written under** is `{type, schema?}`: `schema` is absent exactly for a built-in type. A
  reader refuses a built-in type with a schema, and a user type without one.

**Decided:** A39, A45, A81, A95, A96, A104, A135, A146, A172, A185, A207 · **Lean:** `Aven.DB.Docs.Builtins` —
`builtin_fits_iff`, `docsBuiltinFit`, `isSchema` (pending in #1742); `Aven.Core` — `builtinType`; `Aven.ID` —
`idBuiltinFit`; `schema_none_iff_builtin`: not in Lean yet

### Pins

A Doc **pins** the versions it accepts, per type: at birth in its genesis, and later by its owners' act on main. A
type's writers can publish a version; only a Doc's owners decide whether that Doc takes it.

- **A pin can be withdrawn.** Envelopes whose dependencies hold the withdrawal can't write under it; earlier ones still
  count. So two readers holding the same past reach the same verdict.
- **Runtimes are pinned the same way:** the runtime a verdict runs is the hash an envelope names, pinned in its past,
  and there are no floors ([avenRUNTIME](../runtime/README.md#pins)).
- **A pin resolves in its type Doc.** Opening a Doc reads each pinned type Doc's snapshot and keeps the versions whose
  schema's hash a pin names; a pin that resolves to nothing is refused by name (`Unopenable::Pin {type, schema}`).
- **A pin names one schema.** Two versions whose schemas hash alike hold one schema: no two Values hash alike, and
  Values come off the wire canonical. Either can be taken.
- **Fit never reads a type Doc's changing state:** only the pinned schemas, resolved by hash when the Doc opens. A
  version is write-once.
- **Pins cover lenses** between two type Docs too ([Lenses](#lenses)).

**Decided:** A7, A18, A39, A42, A172, A207, docs 11, docs rule 17 · **Lean:** pins at birth: `Aven.DB.Docs.Genesis`
(`Genesis.ok`); resolving them: `Aven.DB.Docs.Schema` — `resolvePin`, `resolvePin_sound`, `pin_resolves_one` (pending in
#1742); pins by act: not in Lean yet

### Fit

**Fit** is whether an envelope's changes are allowed by the schemas it names. It is judged once per envelope, from what
the envelope names alone, so every reader reaches the same verdict and keeps it forever. What the reader's vault knows
decides only what the reader can see through lenses, never fit.

**What it reads:**
- the envelope's ops, as the change view ([`RecordChange`](../ops/README.md#footprints-and-the-merge-check), the same
  view the footprint reads), worked out by [the judge](#the-judge) at the envelope and at its dependencies;
- the versions its `records` names, and their schemas or built-in checks, by hash;
- each touched Record's type, which never changes;
- the Doc's pins at the envelope's own dependencies;
- the checker's version, which is part of the protocol: a change to the rules is a new schema language, named in the
  schema, never a silent code update.

**What it checks:**
1. the Records the ops touch are exactly those the envelope names;
2. every named version is the Record's own type, and is pinned by the Doc or a built-in type its definer checks;
3. every value the ops set, and every element they insert, is allowed by its field's schema;
4. a new Record's type is allowed where its parent's schema puts it, and its required fields are set;
5. no op removes a required field, and no op edits a built-in Record;
6. depth at most 256, and the [limits](#limits).

**A schema says only what survives a merge,** so if each envelope fits, every merge of them fits:

| Allowed | Not allowed |
|---|---|
| a value's type, `enum`, `const`, `pattern`, `format`, `minimum` and `maximum` on a value replaced whole | a container's size: `maxItems`, `minItems`, a text's length, a counter's bounds |
| each element of a list, and each Record of a list of Records, under its schema | `uniqueItems`, and anything counting across Records |
| `required` fields, set when the Record is born; removing one is an unfit write | rules across fields (`if`, `dependentRequired`) |
| typed links: which types a link may point at | |
| `additionalProperties: false` | |

At-most-one comes from ids instead: a slot id makes two writers write one key. Invariants a merge can't keep, such as
an invoice's total matching its lines, are avenOPS': it checks them on ops and shows a broken one as a conflict to
settle.

**Decided:** docs 9, docs 10, docs rules 15–16 · **Lean:** `Aven.DB.Docs.Fit` — `fit_merge`, `fit_envelopes`,
`fit_one_schema`, `size_rule_breaks`; `Aven.DB.Docs.Changes` — `fit_records`, `fit_diff`

## Lenses

A **lens** carries Records between two versions, so an app reads every Record at its own version and nothing is ever
migrated. A Record is read through lenses into the reader's version and written back as the difference, in the
representation it already uses. A default is never written, and what an older app can't see survives its edits.

A lens is a Value of steps:

```json
{ "lens": "Todo, v0 to v1", "from": { "bytes": "40de…" }, "to": { "bytes": "0d78…" },
  "steps": [ { "convert": { "from": "done", "to": "status",
      "forward":  [ [ true, "done" ], [ false, "open" ] ],
      "backward": [ [ "done", true ], [ "open", false ], [ "doing", false ] ] } } ] }
```

- **Steps:** `add` (a field only the child has), `rename`, `convert` (a table each way, or a pair of named functions
  Lean defines, such as text to money), `in` (steps for each Record of a list), `wrap` and `unwrap` (a field to a
  nested Record and back), `move` (a field to another Record of the same Doc), `container` (a value to a text and back)
  and `drop`. A version that drops a field says where its data goes: a lens into another field or Record, or
  **parked**.
- **Who publishes one:** inside one type Doc, whoever may write it. Between two type Docs, anyone may write the lens as
  a Value, and it counts only where a Doc's or a vault's owners pin it, once the checker has held it to the lens laws.
  That is how two vocabularies that minted one meaning twice are aligned, and how actors' messages cross types.
- **Paths are unique.** A reader uses only the lenses pinned where it reads (for a message, the receiving vault's), and
  a pin that would make a second path between two versions is refused there. The pinned lenses form a forest, so two
  paths can't disagree. A reader at version A reads a Record written at version B along that path, composing each
  lens forward or backward.
- **Reading:** where the Record holds a field of both versions, the one written later by Loro's order (Lamport, then
  writer id) wins, exactly as if both had written one field. So a read through lenses commutes with a merge: an older
  app's later tick is never lost to a newer app's earlier write. What neither stored shows the schema's default.
- **Writing:** only the fields whose value changed are written, in the representation the Record already uses: an
  older app writes into the newer fields once any is stored. The body's `records` names the version whose fields it
  writes.
- **Laws:** GetPut, PutGet, an older version keeps what it can't see, composition keeps all three, a read through
  lenses commutes with a merge, and a lossy step states its loss. In the example, `backward (forward t) = t` holds for
  every v1 todo whose status isn't `doing`.
- **A version opens on a scratch copy,** never by checking out the live Doc, which would stop it taking imports.

**Decided:** A7, A174, K5, docs 15, docs rules 18–21 · **Lean:** `Aven.DB.Docs.Lens` — `lens_merge`, `later_tick_wins`;
the round-trip, composition and loss laws: not in Lean yet

## The body

An envelope is [avenCORE's](../core/README.md#envelopes): it holds where it sits (the Doc, the branch, the writer id,
its sequence number, `prev` and `deps`), and its signatures beside its name. Its `body` is avenDOCS': what the commit
did. One envelope is one Loro commit, by one device, to one Doc and branch.

The body is a Core Value with exactly these keys, in the codec's order:

```
{at, loro, calls, changes, genesis, records, authority, generation}
```

| Key | What |
|---|---|
| `at` | the writer's claimed time, text: shown, never used for order |
| `loro` | `{to, from}`: the commit's Loro counters, half-open as Loro's spans are: its first, and the writer's next. In one log an envelope's `from` is the one before's `to`, so no two of a log's envelopes share a `LoroId` |
| `calls` | the ops the commit ran, each avenCORE's `Call` `{op, params}` |
| `changes` | the Loro update holding exactly the commit's ops, as bytes |
| `genesis` | the Doc's [genesis](#a-doc-and-its-genesis), exactly in a log's first envelope and absent from every other |
| `records` | every Record the commit creates, changes or removes, by id, with the version it was written under: `[type Doc, schema hash]` for a user type, `[type Doc]` for a built-in type. The reader works out the touched Records from the ops and refuses a body whose list differs |
| `authority` | [avenCAPS'](../caps/README.md#the-envelopes-authority) Value `{acks, caps}`, or `{acks, caps, actor}` for an actor host's envelope: the authority the envelope writes under. avenDOCS carries the Value whole and never reads inside it, checking only its canonical form and limits |
| `generation` | the writer's [generation](#generations-and-stuck-logs), which its writer id is derived from |

- **The commit's Loro message** is the lowercase hex of BLAKE3 over the canonical CBOR of `records`.
- **The writer's signature** is the device's Ed25519 over avenCORE's `["avenDB envelope 1", unsigned envelope]`. It
  places the envelope in its log; any other signature beside it is an approval over the same name and never renames
  it. The [segment](#segments) that later covers it adds the writer's hybrid signature.
- **Local first.** The writer keeps the envelope's own bytes at once
  ([the shelf](#the-head-the-held-page-and-the-shelf)), so a write survives a crash.

**Decided:** A30, A32, A45, A81, A95, A106, A188, docs 2, docs 24 ·
**Lean:** `Aven.DB.Docs.Body` — `log_ops_disjoint`; the authority's form: avenCAPS' `Authority.ofValue?_value`,
pending on `claude/avenid-a45` (no PR)

## Writer ids

A **writer id** is the 64-bit Loro peer a device writes one branch of one Doc as. It is worked out, never issued, and
never stored as an identity: the identity is the avenID device, and blame maps an op straight back to it.

- **`writer(device, doc, branch, generation)`** is BLAKE3's key derivation under the context `avenDB writer 1` over the
  CBOR array `[device's public key, the Doc's id, the branch, the generation]`. Read the output's four 8-byte windows
  little-endian and take the first that isn't the value Loro reserves, `2⁶⁴ − 1`; 0 when all four are, a chance of
  2⁻²⁵⁶. So no writer id is the reserved value.
- **Each part earns its place:** the device, because a vault has many devices editing at once; the Doc, so a writer id
  links writes within one Doc only; the branch, because a device writes main and a proposal as two states whose ops
  meet when they merge; the generation, so a device starts a fresh log after a split or a stuck log without a new key.
- **Who writes a log:** avenDOCS supplies avenCORE's `Writes`: a key writes an envelope's log exactly when
  `writer(key, doc, branch, the body's generation)` is the envelope's writer id.
- **An import refuses** an envelope holding an op of any writer id but its signer's for that Doc, branch and
  generation, and one whose counters don't continue that writer's log.

**Decided:** A45, A47, A48, docs 6, docs rule 8 · **Lean:** `Aven.DB.Docs.Writers` — `writer`,
`writer_lt`, `writer_ne_reserved`; `Aven.DB.Docs.Counts` — `writer_ids_distinct`, `ops_are_signers`

## Loro

Loro 1.17.1, pinned exactly, is the CRDT. avenDOCS uses its terms as Loro means them, and its best practices as rules.
The model takes Loro by its stated laws, the same changes in any order give the same state and the same bytes, and the
Rust tests check Loro against the model on causal orders.

- **A `LoroId`** is one Loro op's id, `(writer id, counter)`. "Op" alone means only avenCORE's op.
- **Never reuse a peer,** and never use a user's id as one: two sessions on one peer give two ops one id. Writer ids
  are worked out per device, Doc, branch and generation, and the committer holds the device's lock.
- **Timestamps off,** so the same edits export the same bytes.
- **Mergeable children** (`ensure_mergeable_*`) wherever two writers may create the same child at once.
- **The container by merge behaviour:** text for prose, a map for values replaced whole, a movable list for reordering,
  a tree for outlines, a counter for sums. Hard invariants don't belong in a CRDT.
- **All or nothing.** `revert_to` and `apply_diff` leave state, history and version as before on an error, and a Loro
  transaction has no rollback, so a commit is one diff batch applied by `apply_diff`, never steps that could stop
  halfway.
- **A reused `LoroId` with other content is refused** (`UsedOpID`) before anything changes.
- **An envelope is cut by its commit's `LoroId` range,** never by Loro's Change boundaries, since Loro merges a peer's
  consecutive commits into one Change.
- **`subscribe_pre_commit`** sees every commit, implicit ones included: that is where the commit message is set.
- **Version vectors and frontiers stay inside a peer.** A Doc's version is [avenCORE's](../core/README.md#the-past),
  named by its tips' hashes, and readers sync by it ([avenPEERS](../peers/README.md#by-version-between-readers)).
- **Ephemeral state stays out of the Doc:** presence and cursors travel apart. **Undo is local:** Loro's `UndoManager`
  undoes one editor's own recent edits; it is not history's back out.

**Rule 7, in Loro's terms.** History names its past by hash, and the Loro dependencies must agree. A commit's Loro
dependencies, read with its writer's previous op first (`carriedDeps`), must be exactly the last `LoroId`s of `prev`,
then of `deps`. An envelope whose hashes and `LoroId`s disagree is refused. Among envelopes that pass, the same hashes
name the same past exactly when the same `LoroId`s do.

**Decided:** A3, A45, A81, A175, docs 7, docs 22, docs rules 7–10 · **Lean:** `Aven.DB.Docs.Loro` —
`Loro.converges`, `Loro.snapshot_load`; `Aven.DB.Docs.OpIds` — `same_past`, `opsAgreeB_sound`, `loroAgrees_sound`

## A commit

A **commit** is one atomic change to one Doc: one diff batch, one envelope, all or nothing. A mutation that fails at
any step leaves no op behind. A device never makes an unfit write.

It goes in three calls, so the device's key never enters the docs worker and Loro never enters the key's:

1. **`Doc::prepare(signer's public key, generation, batch, at, act)`** reads the touched Records through lenses, builds
   the change as one diff batch (values set, Records put or removed, list and tree edits), applies it to a scratch fork
   of the live state with `apply_diff`, checks [fit](#fit) on it, exports exactly its op range, and builds the body and
   the unsigned envelope. An editor's text edits are applied as typed. Nothing in the Doc changes. A writer whose last
   envelope doesn't count, or is half of a split, gets `Stuck`: it starts its next
   [generation](#generations-and-stuck-logs).
2. **`Prepared::signing()`** is what the device signs: avenCORE's `["avenDB envelope 1", unsigned envelope]`.
3. **`Doc::finish(prepared, signature)`** adds the writer's signature beside the name and imports the envelope through
   every check a reader runs. It refuses with `Moved` when the Doc moved since `prepare` (an import or another commit
   in between): prepare again.

`Doc::commit(device, …)` is all three, for a device whose key is at hand. The envelope's bytes go to the
[shelf](#the-head-the-held-page-and-the-shelf) and to sync, and the new version to everything downstream.

**Decided:** A87, A119, A127, docs 2, docs rule 6 · **Lean:** not in Lean (the Rust holds it in
`tests/doc.rs`)

## Importing: three verdicts

An imported envelope goes through these steps in order. Step 2 opens avenID's seal, and steps 4 and 7 are
[avenCAPS'](../caps/README.md#the-readers-verdict); the rest are avenDOCS'.

1. **Limits** on the sealed bytes, before anything is decoded.
2. **Open** it with its epoch's key ([sealing](#sealing-and-sealed-pages)). A seal whose `doc` isn't this Doc's is
   refused.
3. **Decode** its CBOR strictly: bytes that don't encode back to themselves are refused. Check the writer's signature.
4. **Reaches:** the signer's chain reaches this Doc at all. A stranger's envelope is refused here and never held.
5. **Log:** the writer id is `writer(signer, doc, branch, generation)`; `seq` and `prev` continue its log; the body
   carries the genesis exactly when this is the log's first envelope, and that genesis names this Doc. A different
   envelope at a place the reader already holds is a split.
6. **Dependencies:** everything `prev` and `deps` name is held, recursively, else the envelope waits with whatever
   builds on it and asks for what it lacks. A wait that never ends raises the stall alarm.
7. **Epoch and authority:** the epoch is no older than what it builds on, and the envelope is `authorized`.
8. **Loro:** the changes decode within limits; every op carries the writer id; its counters continue the writer's;
   rule 7 holds.
9. **Fit** per Record, and its footprint for avenOPS.
10. **Counts:** then the committer imports it into its branch's [live state](#the-live-state).

**Three verdicts,** each cached per envelope:

| Verdict | Depends on | Can it turn? |
|---|---|---|
| **fit** (avenDOCS) | the envelope, the Values it names, the pins at its dependencies, the checker's version | never |
| **authorized** (avenCAPS) | the cap chain, judged on the envelope's own past | never; a later revocation discounts the envelope in counting instead (`revoked`) |
| **not a split** (avenCORE) | the envelopes of its log the reader holds | yes, by a second envelope found later |

- **What counts** is [avenCORE's](../core/README.md#counting) `Counts`, with fit, authorized and revoked as its
  parameters: an envelope counts once its whole past is held, it and its past are fit and authorized, none of them is
  half of a split, and none is discounted by a revocation the reader holds (avenCAPS' `revoked`).
- **`authorized` is judged on the past:** `authorized(genesis, envelope, body, past)`, where the past is every held
  envelope it reaches through `prev` and `deps`, held whole before it is asked. Every reader that holds that past
  reaches the same verdict, whatever order it imported in. A revocation learned later doesn't change it: it discounts
  the envelope in Core's counting, as a split does. Rules about concurrent envelopes live only in the register's
  settle; avenCAPS has none.
- **Imports go by page.** A page's envelopes all pass steps 1 to 8 first, and whatever waited on them joins. The page
  is judged on one scratch copy, and what counts enters the live state in one `import_batch`: one diff, one snapshot,
  one event. **The target:** a Peer-Light catches up 500 envelopes of one Doc in under a second, in every engine.

**Decided:** rule 4, rule 11, A23, A30, A45, A87, A95, A137, A147, A182, docs rule 13 · **Lean:**
`Aven.Core` — `Counts`, `counts_past`, `split_final`, `closed_mono`, `countsB_iff`

## The live state

Each branch has one live Loro document holding exactly what counts. Everything else is derived from the envelopes and
can be rebuilt: replaying every envelope that counts gives the live state.

- **The snapshot read.** Every counted version publishes an immutable read: the version's tips and its Records, a
  copy beside Loro. Readers keep it as long as they like, and the committer never waits on them.
- **The change feed.** One entry per new version: the envelope that counted and its `RecordChange`s, or a rebuild.
- **A verdict that turns** after import (a revocation, a split found later) rebuilds the branch's state from the
  envelopes that still count, since Loro can't take ops back out. The last state stays on screen meanwhile. Honest
  edits built on a discounted envelope are shown as not counted, with the reason, and their devices re-apply them as
  new commits on top.
- **A snapshot** is a peer's own Loro export of a branch at a version: a cache, always full, sealed for its own store,
  never travelling. History is shortened only by [period Docs](#period-docs), never by a shallow snapshot, which would
  refuse a branch that starts before it.

**Decided:** A5, rule 8, docs 4, docs rules 5, 12 and 13 · **Lean:** `Aven.DB.Docs.Loro` — `Loro.snapshot_load`;
`Aven.DB.Docs.Counts` — `live`

## The judge

Loro is a hole until proven otherwise. It can panic on bytes it should have refused, and in a browser a panic kills
the worker, then kills it again on every catch-up. So Loro sees only what has passed every other check, and only in a
place that can die alone.

- **Strangers never reach Loro.** The limits, strict decoding, the writer's signature, that the signer's chain reaches
  this Doc, the writer id, its place in its log and rule 7 from the update's metadata all run before Loro decodes a
  byte of an envelope's changes ([importing](#importing-three-verdicts)). Only a member's signed envelope, in its
  right place, reaches Loro.
- **Natively, the judge catches.** Fit is judged on a scratch copy inside `catch_unwind`, so a panic there marks one
  envelope and never touches the live state. That needs `panic = "unwind"`: `aven-db-docs` refuses to compile natively
  without it, and no profile of the workspace or the Peer sets `abort`.
- **In the browser,** wasm32 aborts on a panic, so `catch_unwind` does nothing there, and Loro runs only in one docs
  worker for all open Docs, away from the keys. When the worker crashes, it restarts and reopens the open Docs from the
  store, and an envelope is marked unfit only when it crashes the worker again alone, so a transient fault never marks
  a valid envelope.
- **Sifting** a crashed page to find that envelope is [avenPEERS'](../peers/README.md#the-doc-host).
- **A crash mark is local.** `Doc::mark_unfit(name)` takes effect before or after the envelope is held. The mark is the
  docs worker's, never stored by avenDOCS and never travelling, and it is not the shared fit verdict. An envelope so
  marked never counts here, and is never forwarded or served.
- **Fuzzed.** Three targets under cargo-fuzz: any bytes as an envelope (`envelope`), as the Loro update in a member's
  signed first envelope, so they reach Loro (`changes`), and as a sealed segment (`segment`). `tests/hostile.rs` runs
  the same inputs, and bit-flipped real updates, on every check.

**Decided:** A87, A119, A129, A185 · **Lean:** not in Lean: held by `tests/hostile.rs` and `db/docs/fuzz`

## Generations and stuck logs

A [split](../core/README.md#splits), two different envelopes from one writer at one place, is avenCORE's, and
final: from the split on, neither side counts for any reader, nor anything built on either. avenDOCS gives the writer
its way on.

- **A generation** is a device's fresh start on a branch: a fresh writer id and a fresh log, without a new key. The
  device starts one after a split or a stuck log. What was worth keeping from either side is re-applied by an act, as
  new commits.
- **A stuck log** is one whose next envelope would build on one that doesn't count. An unfit envelope counts for no one,
  and the writer's next envelopes build on it, so its log is stuck. An honest device never gets there, since it checks
  before it commits; a broken or hostile one starts its next generation.
- **A Doc's owners may declare a split** with a built-in `split` Record naming the writer and the envelope it ends
  after, for a device they believe copied.
- **Splits are visible:** an envelope naming one side can't be imported by a reader holding the other, and the two
  signed envelopes are the proof, shown to every reader.

**Decided:** A4, docs 8, docs 12, docs rule 14 · **Lean:** `Aven.Core` — `split_final`; the `split` Record's shape:
`Aven.DB.Docs.Builtins` (`docsBuiltinFit`)

## Segments

A **segment** is a writer's closed run of one log in one epoch, signed once with its hybrid key. Each writer closes its
own segments, so a segment is the same bytes everywhere, and a split shows as two runs after one envelope.

- **When it closes,** at whichever comes first: 256 envelopes or 1 MiB; a rotation of the Doc's epoch (a segment holds
  one epoch); the writer quiet on the Doc for a few seconds (5 s to start, tuned by the catch-up target); the page
  hiding or closing, best effort.
- **Its form** is avenCORE's `Signed` under `avenDB segment 1`, its body in the codec's order:
  `{to, from, prev, branch, writer, envelopes, generation}`.
  - `branch`, `writer`, `generation`: the log it is a run of;
  - `from`, `to`: the sequence numbers it holds, half-open: its first envelope's, and the next segment's first;
  - `prev`: the name of the writer's segment before it in this log, or null;
  - `envelopes`: its envelopes, each the encoding of avenCORE's envelope, the same signed bytes, so their names stay.
- **One hybrid signature** (Ed25519 and ML-DSA-65) covers it, inside the seal, about 3.4 KB a segment. It is what
  keeps single Ed25519 envelopes safe from a later quantum forgery. Its Ed25519 half is the key every envelope in it is
  signed with. Its ML-DSA half counts only where the vault owner's hybrid signature binds it, so a device closes
  segments only once its hybrid key is bound ([avenID](../id/README.md#devices)).
- **It is sealed** as `segment` ([below](#sealing-and-sealed-pages)).
- **Covers are the uploader's word.** A keeper sees only sealed bytes, so a segment's upload names the loose items it
  covers by their sealed hashes, beside the sealed segment and never inside it. The keeper takes only that device off
  those items' uploaders, and drops an item once none is left: a lie costs only the liar's own uploads, and a writer
  that never comes back loses nothing. Closing returns `Closed {segment, covers}`.

**Decided:** A43, A44, A130, A156, caps D13, docs 3, docs rule 11 · **Lean:** `Aven.DB.Docs.Segment` —
`run_one_log`, `run_bounded`; `Aven.DB.Docs.Limits` — `segment_bounded`, `segment_records`; the keeper's side,
`Aven.Peer.Keeper`, pending in #1722

## Sealing and sealed pages

Everything of a Doc that leaves a device, but the keyring's, is sealed under the Doc's epoch key by
[avenID's one seal](../id/README.md#the-seal). Its keys, its AAD, its outside, its padding, and how a reader finds what
a sealed thing seals, are avenID's. A peer keeps envelopes' own bytes, and seals only what leaves the device.

- **What a Doc seals:** a loose envelope as `envelope`, a segment as `segment`, and a [checkpoint](#checkpoints) and
  its state, each as `checkpoint`.
- **The keyring travels plain.** avenID's keyring Doc is the one built-in type whose envelopes and segments aren't
  sealed: its Records are already ciphertext ([avenID](../id/README.md#the-keyring)). avenDOCS takes its items by a
  plain path beside the sealed one; every other Doc stays sealed.
- **A loose envelope** travels live on its group's topic ([avenPEERS](../peers/README.md#gossip-per-group)). The seal's
  outside names its Doc, the one source for it, and a reader refuses a seal whose `doc` isn't the Doc's.
- **A sealed page** is what catch-up fetches: loose envelopes and segments mixed, served by hash with nothing beside
  them to say which is which. `Doc::import_sealed_page(items, epochs, authorize)` opens each item under the key of the
  epoch its outside names, as what its commitment says it seals, before anything is decrypted; flattens each segment's
  envelopes in order; and imports the whole page through one judge, one `import_batch` and one snapshot. Per item, the
  result is its envelopes' results in order, or why it didn't open: not a sealed thing within the limits, another Doc,
  an epoch the reader holds no key for, a commitment for neither an envelope nor a segment, a seal that doesn't open,
  or a bad segment.

**Decided:** A44, A82, A128, A155, A166, A176, A177, A181, A187, caps D13 · **Lean:** `Aven.ID.Seal` — `open_seal`,
`open_checks_commit`; found by commitment: `kind_by_commit`, `kindOf_sound`, `kindOf_complete`, `kindOf_seal`, pending
on `claude/aven-docs` (no PR)

## The head, the held page and the shelf

A peer keeps its own record of each Doc it holds. None of it travels: what a peer tells others is a version, by hash.

- **The head** is a small Value: per branch, each log's newest envelope that counts, sorted by writer id.

  ```
  {doc, branches: {<branch>: {logs: [[writer id, envelope name], …]}}}
  ```

- **The held page** is the head's companion: every envelope the peer holds, counted or not (a split's halves are
  proofs), in the order it held them, each by its name and the hash of its own encoded bytes.

  ```
  {doc, envelopes: [[name, blob hash], …]}
  ```

  `Doc::held()` gives each held envelope with its name, worked out once at import. Reopening a Doc is its genesis, then
  these envelopes imported again in this order: every verdict is worked out afresh, and what counts is the same.
- **The shelf** is where a peer keeps its Docs in its store. Each envelope's own bytes are a blob named by their hash.
  Each Doc has two refs, each pointing at a Value's blob and moved by compare-and-set: `doc-<id hex>-held`, the held
  page, and `doc-<id hex>`, the head. The held page moves first, so a crash between the two leaves nothing a reopen
  can't rebuild. A ref moved by a second writer is refused, never retried over.

**Decided:** A128, A129, A151, A185, docs rule 1 · **Lean:** `Aven.DB.Docs.Head` — `Head.ok`, `Held.ofValue?` (vectors
`heads.json`, `held.json`)

## Limits

Every input has a limit before Loro sees it, checked before the next step spends memory on what it measures. A sealed
envelope is read capped as its bytes arrive, before anything is opened or decoded; once decoded, its body is measured;
a segment and a blob have limits of their own. The limits of an envelope as such are
[avenCORE's](../core/README.md#limits).

| Limit | Default | When |
|---|---|---|
| an envelope's sealed bytes | 1 MiB | step 1, as they arrive |
| the body's CBOR depth | 256 | steps 3 and 8 |
| envelopes named in `deps` | 256 | steps 3 and 8 |
| Records touched | 4,096 | steps 3 and 8 |
| Loro ops | 65,536 | steps 3 and 8 |
| a segment | 256 envelopes or 1 MiB | closing and import |
| a blob's declared size | 4 GiB | before it is fetched |

The fan-out, Records, ops and blob limits are the release's; these are the defaults the vectors use.

**Decided:** rule 10, A145, docs rule 24 · **Lean:** `Aven.DB.Docs.Limits` — `capped_holds`, `capped_within`,
`capped_whole`, `admitted_bounded`, `segment_bounded`, `segment_records`, `blob_bounded`

## Checkpoints

A **checkpoint** is a signed statement that a state is a branch at a version, covering these segments. It travels, and
any reader holding what it covers can check it. A new device starts from the newest checkpoint and the segments after
it, and shows the Doc at once, marked **unchecked**. Checkpoints come after the cutover.

- **Its form** is avenCORE's `Signed` under `avenDB checkpoint 1`, its signatures beside its name, its body in the
  codec's order: `{doc, loro, state, branch, covers, runtime, version}` (A199).
  - `doc`, `branch`, `version`: the branch at the version it states, by its tips' hashes;
  - `covers`: the segments it covers, by hash;
  - `loro`: the hash of the sealed Loro export of the state, which travels only inside a checkpoint; the export is
    sealed as `checkpoint`, under the same Doc and epoch as the checkpoint that names it;
  - `state`: the hash of the Records' CBOR, which a reader checks after replay;
  - `runtime`: the runtime that made it.

**Decided:** A5, A150, A177, A181, A199, K10, rule 8, docs 4 · **Lean:** `Aven.DB.Docs.Checkpoint` —
`checked_is_replay`, `checked_names`, `checkpoint_by_writer`

## Branches, merges and forks

Branches live inside one Doc: one id, one key, one set of caps. A fork is a new Doc.

### Branches

- **A branch is a named run of a Doc's history** with its own logs and its own live Loro state. Main is `main`, from
  the genesis. Every other branch is named by the hash of its start, the built-in `branch` Record
  `{base, name, nonce, follows?}` that its first envelope writes, `base` being the tips it starts from.
- **Proposal or variant is one flag.** A **proposal** is opened to be merged into main. `follows: "main"` makes it a
  **variant**, which takes merges of main and keeps its own value wherever both changed one place. A new Doc made by
  someone who may only propose starts as a proposal over an empty main.
- **A proposal's state starts as a fork of main's at its base,** in Loro's sense, and takes only its own branch's
  envelopes and the merges into it. Main never holds a proposal's commits until a merge lands them, so nothing shows on
  main by being imported.
- **Discovered** from the Doc's own envelopes: every branch's start is in its logs, and the head lists the branches a
  peer holds.
- **Named by caps and wants** as `main`, a branch's hash, or `proposals` (every branch but main): caps grant writing to
  main or to proposals only, and an agent proposes while a person merges.
- **Closed** by a built-in `closed` Record on the branch, or by its merge. Its history stays.

### Merging

A merge is an ordinary envelope on the target branch whose `deps` name both branches' tips. A branch's commits reach
another branch only by a merge.

1. **The union:** the target's state imports the other branch's envelopes since the base. Loro's union keeps
   everything, and silently picks one value where both changed a place.
2. **The three-way pass** runs only on the places both branches changed since the base: a value replaced whole, a
   field; a Record, with all its fields, by id at any depth; the order of a list of Records. **Text never conflicts
   silently:** Loro merges it character by character, and where both edited the same stretch the merge shows it and
   offers a choice for that stretch: keep the target's (the default), take the other's, or keep Loro's mix (A204). The
   target keeps its own unless the person merging takes the other's, place by place.
3. **The fix:** the commit sets every place the pass decided. Where Loro's union already shows the result, nothing is
   written.

Nothing the target changed since the base is lost; everything the other branch changed alone lands. A merge into main
counts only when the merger's grant covers the whole merge ([avenCAPS](../caps/README.md#the-readers-verdict),
[avenOPS](../ops/README.md#footprints-and-the-merge-check)).

Bob, who may propose but not edit, proposes "Order seeds by Friday" on Alice's todo, which says "Order seeds".
Meanwhile Alice ticks it done on main. Her merge lands his title (only he changed it) and keeps her done (only she
changed it): no conflict, nothing lost. Had both changed the title, Alice's would stay unless she took Bob's.

### Revert, back out, fork, named versions

- **Revert to a version:** Loro's `revert_to`, all or nothing, as one new commit on the branch. History keeps both.
- **Back out one commit:** a three-way merge whose base is the state after the commit, whose target is now and whose
  other side is the state before it. Only that commit's own changes go, where nothing since touched them; where
  something did, it is a conflict and the present stays. Applied with `apply_diff`, all or nothing.
- **Fork:** a new Doc whose root Record, written by its first envelope and fixed at birth, links its origin (the Doc and
  the version), and whose first commit puts the origin's Records at that version, written by the forker. The fork has
  new writer ids, its own caps and its own key; the history before the fork stays in the origin, readable by whoever
  may read the origin. Ids inside are kept, so links within the Doc still resolve.
- **A named version** is a built-in `version` Record `{at, name}` on the branch it names, never a type's version, which
  is a `schema` Record (A207): a person's act, which syncs and has history.

**Decided:** A4, A149, A204, docs 14, docs 16, docs 17, docs 21, docs rule 22 · **Lean:** `Aven.DB.Docs.Merge` —
`keeps_target`, `lands_other`, `conflict_by_choice`, `merge_same`, `back_out_removes`, `back_out_keeps_later`; the
whole merge: `rule4_merge_whole` (`Aven.Architecture`, #1608)

## History

Every view of the past is a cache keyed by the Doc, the version and the code version, worked out from the envelopes and
Loro's history. None is stored in the Doc, and none travels.

- **A branch's history:** its envelopes in causal order, ties broken by hash. Each shows its signer's device and vault,
  its claimed time, the Records it touched with their versions, and the ops it ran.
- **By Record:** every envelope that touched a Record, from the `records` each envelope names.
- **By field:** each envelope's diff (Loro's `diff` from its dependencies to it), mapped to Records and fields.
- **By character:** the `LoroId`s in a text map to writer ids, and each writer id to its device, from the envelopes
  that carried it. No table of writers is kept in the Doc.
- **Between two versions:** Loro's `diff`, mapped to Records added, changed and removed, old and new, read through the
  reader's version.
- **When:** claimed times are shown as claims. Nothing is ordered by them.

**Decided:** rule 12, docs rules 5 and 9 · **Lean:** not in Lean yet

## Period Docs

A **stream** is a collection that grows in time order without end: a chat room, an actor's journal, a log of payments.
It is a **series of period Docs**, never one Doc forever, and never trimmed by a shallow snapshot.

- **Its type says the period:** a month for a chat room.
- **Each period Doc's root Record links the one before,** written by its first envelope and fixed at birth, so a want's
  window maps to whole Docs, and older history is a bounded follow away.
- **A period ends when the next begins.** Its last checkpoint stays valid forever.
- **Other collections that grow,** such as invoices or pages, are root Records: each is a Doc of its own, listed by a
  [directory](#directories-and-indexes).

**Decided:** A6, A9, A149, docs 18, docs rule 25 · **Lean:** not in Lean yet

## Directories and indexes

A type with millions of Records is millions of Docs, of which a device wants a handful. A **directory** lists a vault's
Docs of one root type by Doc id; an **index** lists the same Docs by a query's fields. Both are one structure: a
**Prolly tree** whose nodes are sealed Values named by hash. The same entries always make the same Values, whoever
builds them and in whatever order, so readers who build from one version get one root. How an index comes from a query
and how a lookup runs are [avenOPS'](../ops/README.md#sealed-indexes-the-query-side).

- **An entry is a key:** `(field values…, Doc id)` for an index and `(Doc id)` for a directory, in an order-preserving
  encoding, not CBOR, since canonical CBOR sorts text by length first and negative integers after positive ones. A
  key's bytes sort exactly as its tuple does. Each field is a tag, then:
  - an unsigned integer: its 8 bytes, big-endian (tag `15`);
  - a negative integer `-1 - n`: the 8 bytes of `2⁶⁴ - 1 - n` (tag `13`), so negatives sort first;
  - text: its UTF-8, normalised to NFC, each `00` written `00 FF`, and a `00` to end it (tag `02`);
  - bytes, the Doc id among them: the same escaping (tag `01`).

  Text compares by code point, UTF-8's byte order; collation by locale comes through a pinned sort-key runtime. A key
  is never named or signed, only sorted, and sits in a node as a CBOR byte string. A prefix `p`'s range is `p` to
  `p FF`, which holds every extension of `p`; a byte prefix alone isn't a tuple prefix (text `a` is a byte prefix of
  text `a 00`), so a prefix lookup keeps only the entries whose tuple extends `p`. Every entry is distinct.
- **Nodes:** a leaf is a CBOR array of entries; an inner node is an array of `[first entry, last entry, child]` per
  child. A node ends after an entry whose BLAKE3's low 6 bits are zero (about 64 entries a node) or before an entry
  that would take it past 64 KiB. The same rule cuts every level. A Prolly tree, not a Merkle search tree, because its
  nodes are cut by size too, so every node stays under the limit.
- **The walk** goes down from the root, opening only the children whose span, first to last entry, meets the range:
  three or four Values for millions of entries. It keeps a fetched node only when its hash is the name it asked for,
  so whatever a peer serves, it finds only entries of the fold in the range, and all of them once peers serve the
  fold's nodes.
- **Recent entries stay in the directory Doc,** an ordinary Doc of the vault, read by the directory's readers. Whoever
  creates a Doc of the type, or changes a field an index sorts by, adds its `entry` Record as its own envelope in the
  directory's Doc, never inside another Doc's commit; a Doc that leaves (removed, or its field changed) leaves a `gone`
  Record. Loro merges writers who write at once.
- **A fold** moves them into Values, as an LSM tree compacts. It is a [checkpoint](#checkpoints): the directory's
  version it covers, the root it makes and the runtime that made it, hybrid-signed. A fold takes the entries of the
  last fold's root, drops the `gone`, adds the new `entry` Records and builds the tree. Two folds of one version give
  one root, and folding in steps gives what folding at once gives. A reader takes a fold only from a vault that may
  write the directory, and a device that holds the covered Docs rebuilds the root in the background and compares.
- **Sealed.** Every node is sealed under the directory's key, and equal Values under one key get equal names, so equal
  nodes are stored once; every Value is padded. An index holds fields only from Docs its directory's readers can read,
  so a Doc with fewer readers never enters it. A wrong entry costs a fetch, never a wrong row; a missing entry is the
  only harm, and only someone who may write the directory can cause it.

**Decided:** A26, A42, K13, docs 23 · **Lean:** `Aven.DB.Docs.Key` — `key_order`, `key_inj`, `key_prefix`,
`extension_in_range`; `Aven.DB.Docs.Index` — `entries_set`, `fold_steps`, `fold_removes`, `chunks_size`, `root_set`,
`lookup_complete`, `lookup_sound`; `Aven.DB.Docs.Walk` — `fold_good`, `walk_exact`, `fold_exact`, `walk_verified`;
`Aven.DB.Docs.Directory` — `listed_now`, `same_entries` (to be restated for entries as their own envelopes)

## The chat as a Doc

The chat moves onto a Doc with no interim fix: a fresh Doc, the second after the tree, and from then on its wants, sync
and queries are every Doc's. The city-dome is a series of [period Docs](#period-docs), and a chat line is a `post`
Record.

**Its history is read as it is, never rewritten.** Each device's chain of signed line blobs from the first generation
stays stored, and nothing is wiped ([A186](../DECISIONS.md)).

- The first period Doc's root Record, written by its first envelope and fixed at birth, names the frozen chains:
  `{<device>: <its newest line's hash>, …}`.
- Readers walk them back and check each line's signature by the frozen format's rules, and show them read-only before
  the first post.
- Nothing is re-signed, so every old line keeps its own signature.
- The frozen format is held to a frozen copy of its Lean, `Aven.DB.Before`, and the Rust is tested against a frozen
  copy of the format under `db/docs/tests/before/`.

**Decided:** rule 9, rule 16, A34, A43, A112, A149, A186, docs 19 · **Lean:** the chains' rules: `Aven.DB.Chains`
(`chain_suffix`); `Aven.DB.Before`: not in Lean yet

## Status

avenDOCS' first step, Loro Docs, is built: [`db/docs`](../../db/docs/README.md) (`aven-db-docs`) and its Lean,
`Aven.DB.Docs`. Branches, merges and forks are the second step, and types, pins and lenses the third; neither is
built in Rust yet.

| Concept | Lean | Rust (`aven-db-docs`) | TS |
|---|---|---|---|
| A Doc and its genesis | `Genesis`, `Body` (#1694, #1732) | `Genesis`, the genesis checks (#1694, #1732) | — |
| Records | `recordsRoot` (#1694) | the root map `records`, `t` (#1694) | — |
| Types are Docs, the vocabulary | `Schema` (one form, read back), `resolvePin`, `pin_resolves_one` (#1742) | `Schema::of_value`, `Snapshot::versions`, `Doc::open` resolving pins (#1742); lenses and the vocabulary: not started | — |
| Built-in types | `Builtins` (#1694), the `schema` built-in (A207, #1742); avenID's `idBuiltinFit` (#1716) | `DocsBuiltins`, `Either` (#1694), the `schema` built-in (#1742) | — |
| Pins | at birth (`Genesis.ok`); resolved in the type Doc (#1742) | at birth, resolved in the type Doc (#1742) | — |
| Fit | `Fit`, `Changes`; step 1's schema form (`Aven.DB.Docs.Schema`, `schemas.json`, #1742) | `fit`, built-in types and step 1's schema language (#1694) | — |
| Lenses | `Lens`: `lens_merge` only | not started (step 3) | — |
| The body | `Body` with `ops`, `cap`, `acks` (#1694) | `Body`, the same keys (#1694) | — |
| Writer ids | `Writers` (#1613, #1615) | `writer` (#1694) | — |
| Loro, rule 7 | `Loro`, `OpIds` | `opids`, `loro_agrees` (#1694) | — |
| A commit | — | `prepare`, `finish`, `commit` (#1732) | — |
| Importing: three verdicts | avenCORE's `Counts` (#1710); avenDOCS' own copies | `import`, `import_page`, `Authorize` on the past (#1732) | — |
| The live state | `Loro.snapshot_load`, `live` | `Snapshot`, `Feed`, the rebuild (#1694) | — |
| The judge | — | `catch_unwind`, the `panic = "unwind"` guard, three fuzz targets (#1694, #1732), 600 s each with no crashes (#1742) | — (the docs worker and sifting are avenPEERS') |
| Generations and stuck logs | avenCORE's `split_final` | `Stuck`, a generation per writer (#1694) | — |
| Segments | `Segment` (#1694); `prev` left out of a log's first (A200, `value_no_prev`, #1773) | `Segment`, `Closer`, `Closed {segment, covers}` (#1694, #1732); `prev` left out of a log's first, a null refused (#1773) | — |
| Sealing and sealed pages | `Aven.ID.Seal` (#1694): what it seals found by commitment (`seals_by_commit`, #1742), `seals` and `checkpoint` (A177), the one padding (`padSealed`, A176) (#1773) | `seal` with `Seals` and `pad_sealed`; `open_page` and `Doc::import_items` over `Item::Sealed`, and `Item::Plain` for the keyring (A187) (#1742, #1773) | — |
| The head, the held page, the shelf | `Head`, `Held` (#1694, #1732) | `Head`, `HeldPage` (#1732); the shelf in `aven-peer`, pending in #1727 | — |
| Limits | `Limits` (#1582) | `limits` (#1694) | — |
| Checkpoints | `Checkpoint`: the check, no Value form | not started (after the cutover) | — |
| Branches, merges and forks | `Merge` | `main` only (step 2) | — |
| History | not yet | not started | — |
| Period Docs | not yet | not started (with the chat) | — |
| Directories and indexes | `Key`, `Index` (#1540), `Walk` (#1611), `Directory` | not started | — |
| The chat as a Doc | `Aven.DB.Chains` (the first generation's) | not started (stage 6 of the cutover) | — |

**Measured:** 500 envelopes of one Doc imported as one page in 76 ms natively (release), against about 0.7 s one by
one (`tests/catchup.rs`, #1694). In the browsers with Docs in the Peers (#1727).

**Known gaps** (Lean and code work):
- **The body's A45 form:** `ops` becomes `loro`, and `cap` and `acks` become one `authority` key holding avenCAPS'
  Value, in `Body.lean`, `bodies.json` and the Rust (`Body`, `Act`). avenCAPS' `Aven.ID.Authority` waits on
  `claude/avenid-a45`. `Body.lean`'s docstring still describes one signature.
- **`LoroId`:** `Docs/OpIds.lean`'s `OpId := Nat × Nat` shares a name with avenCORE's `OpId`; it becomes `LoroId`, the
  file `LoroIds`, and the Rust follows.
- **Counting is avenCORE's:** `Docs/Counts.lean`'s `Verdicts`, `counts`, `counts_verdicts`, `revocation_narrows`,
  `split_final` and `countsB_iff` restate avenCORE's and go; `live` is stated over avenCORE's `countsB`. db's copies of
  `envelopes.json`, `logs.json` and `counts.json` go, and `tests/vectors.rs` reads avenCORE's.
- **Who writes a log:** avenDOCS' `Writes` for avenCORE's `Envelope.placed` is in neither Lean nor Rust; the Rust
  checks the writer id itself.
- **Built-in type names:** `Docs/Genesis.lean` keeps its own `builtinType`; it uses avenCORE's
  `builtinType H "avenDB" name`.
- **`schema_none_iff_builtin`** is unproven: prove it in `Builtins.lean` beside `isBuiltin`, with a vector each way.
- **Two `Version`s:** a version is avenCORE's `Version` (A175), and avenDOCS' `Version {type, schema?}` shares its name;
  avenDOCS renames its own. `Version` and `RecordChange` move into the engine's Lean in #1697, and `aven-db-docs` then
  takes `aven-db-engine`'s types.
- **avenID's built-in fits in Rust:** nothing supplies `cap`, `revoke` and `epoch` to `BuiltinFit` yet
  (`IdBuiltins`, from `idBuiltinFit`), so their Records don't fit; the register's `tree` comes with the tree as the
  first Doc.
- **`authorized` and `reaches`:** no avenCAPS implementation of `Authorize` in Rust, and no `reaches` in avenCAPS'
  Lean.
- **The genesis's `vault`** is read as any bytes; it is a 32-byte vault name (`Aven.ID.VaultName`).
- **The Record key:** the lowercase hex key (`idKey`) is pending in #1697; `aven-db-docs` follows it.
- **Segments:** `Segment.ok` checks no signature, and `device_hybrid_bound` is in no Lean yet.
- **Checkpoints:** no Value form in Lean or Rust and no vector of the form; `Checkpoint.lean`'s `covers` holds the
  segments' envelopes, while the form names segments. The body names its Loro export `loro`, sealed as `checkpoint`,
  and `state` stays its Records' hash (A199): `Aven.DB.Docs`' checkpoint body and its vectors, to come with
  checkpoints. The seal's `checkpoint` is built (A177).
- **Directories:** `listed_now` and `same_entries`, and avenOPS' `lookup_exact` on them, assume an entry in the same
  commit as its Doc. An entry is its own envelope, so it can lag: avenDOCS and avenOPS restate them, the Doc counting
  as unfolded until its entry counts. No root type exists for a directory or a vocabulary, nor shapes for `entry` and
  `gone`.
- **The chat move:** `Aven.DB.Before`, `db/docs/tests/before/` and `before.json` come with it.
- **Limits:** avenDOCS' `fanout` repeats avenCORE's `maxDeps`.
- **The fuzzer** runs by hand in the box; no release gate runs it.
- **The keyring's plain path (A187):** `Item::Plain` is built in Rust (`travels_plain`: the genesis's root is avenID's
  `keyring`), with no Lean of the page API's two paths yet.
- **No nulls (A200):** the body's `cap` and `genesis` still write null when absent; they go with the body's A45 form.
- **The authority's second shape (A188):** `{acks, caps, actor}` for an actor host's envelope, carried whole like the
  first, with `Aven.ID.Authority` in draft #1741.

## Open questions

1. **Directory and vocabulary root types:** built-in types with their definers' shapes, or user types? A42 says every
   sort of Doc names its root type. *avenMAIA, with avenCAPS.*
2. **The index interface** with avenOPS: `entry`, `fold`, `lookup` with the unfolded entries, and `rebuild` to check a
   fold, for entries that are envelopes of their own. *avenDOCS and avenOPS; avenMAIA decides.*
3. **The first lens catalogue's named conversions:** text to money, text to date, text to number. *avenDOCS at step 3;
   avenMAIA decides.*
4. **The root Record's fields for a Doc's birth references** (a fork's origin, the period before, the frozen chains):
   their names and shapes, and how a user root type's schema admits them. *avenMAIA.*
