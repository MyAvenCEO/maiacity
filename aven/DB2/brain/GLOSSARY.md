# The glossary

The one vocabulary of avenDB, kept in avenBRAIN and shown in avenOS's Brain: every term the packages use, with its one
meaning and a verdict. Every concept is defined once, in the package that owns it (**A45**), so a term here is one line
in its package's section, and that package's page has the rest. [The architecture](ARCHITECTURE.md) is the index of
the whole. The verdicts are decided (**A1**): every rename and merge below stands.

**How they apply.** In the specs and the Lean now, by each file's owner. In code only when it is rewritten anyway.
Stored formats keep their names: the `claim` ref, the first generation's frozen chat lines and the `network` field stay
as they are. A label such as `"avenID keep listing 1"` is a frozen format string, never a package's name (**L12**).

**Verdicts.** No mark: keep as is. **→ x:** rename to x. **= x:** the same thing as x; use x. **⚠:** the same word
means something else in another package, and that package's meaning is named.

## The packages

A package's name is "aven" and its name in capitals, in the specs, the brain and talk (**L8**). Crate and folder names
stay as they are.

- **avenDB**: the umbrella, the whole system in `aven/DB2`. ⚠ It names no single package.
- **avenCORE** (`core`, `codec`): the primitives every package shares ([its page](core/README.md)).
- **avenID** (`id`): who is who: keys, signatures, sealing, vaults and their owners ([its page](id/README.md)).
- **avenCAPS**: who may do what: caps, and Maia City's register; its code is still inside `id` (**L10**, **L11**)
  ([its page](caps/README.md)).
- **avenDOCS** (`db/docs`): Docs, Records, types and lenses ([its page](docs/README.md)). ⚠ "docs" means only this
  package or its Docs; the documentation is **Brain** (**A41**).
- **avenOPS** (`db/engine`): ops, queries, wants and views; the ontology is its first plugin
  ([its page](ops/README.md)). **the engine → avenOPS**.
- **avenSTORE** (`store`): blobs, refs and files ([its page](store/README.md)).
- **avenPEERS** (`peer`): the Peer, the Peer-Light, the wire, gossip, sync, catch-up, keepers, the fetch gate, relays,
  presence, upgrades and deploys ([its page](peers/README.md)). **avenPEER → avenPEERS**; its released image keeps the
  name avenPEER.
- **avenRUNTIME** (`aven/runtimes`): every runtime, the runtime host and the file registry
  ([its page](runtime/README.md)). **avenRUNTIMES → avenRUNTIME**.
- **avenACTORS** (`aven/actor`): programs that live in a Doc and take turns ([its page](actors/README.md)).
- **avenOS** (`os`): the shell people use ([its page](os/README.md)).
- **avenBRAIN** (`brain`): the architecture, the decisions, this glossary and a page per package
  ([its page](README.md)).
- **avenSANDBOX** (`sandbox`): the box ([its page](sandbox/README.md)).
- **first generation** (`aven-gen1`, `gen1`): the chat and the wire that run before Docs; it has no brand name and goes
  at the cutover ([below](#the-first-generation)). **`aven-db-core` → `aven-gen1`**, **`db/core` → `gen1`**, so
  "core" means only avenCORE.
- **avenDB-old, v1**: `aven/db`, the whole old stack; nothing here uses its code.
- **package**: one of the above; it owns its concepts and their vectors, and the others reuse them (**A45**). ⚠ A
  Cargo or npm package is a build unit.

## avenCORE: the primitives

Every package reuses these and adds only what is its own (**A45**). [avenCORE](core/README.md).

- **Value**: immutable bytes named by their BLAKE3 hash; at rest, a **blob**. A sealed Value is named by the hash of
  its sealed bytes. avenACTORS's JSON-only Value **= Value**.
- **codec, `aven-codec`**: the one canonical encoding, deterministic CBOR (**A2**), which refuses bytes that don't
  encode back to themselves; a crate of its own, re-exported by `aven-core`; its Lean is `Aven.Core.Cbor`.
- **JSON form**: a Value's readable form, a byte string written `{"bytes": "<hex>"}` in lowercase; a hash is such a
  byte string of 32 bytes (**A174**).
- **label**: the frozen string that names what is signed, and its version: `"avenDB fetch 1"`.
- **name**: the hash of a signed thing's `[label, body]` (**A30**); signing it again never renames it.
- **signed thing, `Sig`**: a label and a body with its signatures `{signer, sig}` beside its name, a set that only
  grows (**A30**).
- **history, beat**: the two kinds of signed thing: envelopes in a log, where a split is final, and beats, which
  decide nothing (**A31**).
- **envelope**: the one signed unit of change, in one writer's log: it names its place, the envelope before it and the
  tips it builds on, by hash. avenDOCS adds writer ids, fit and segments; avenCAPS its authority part, `cap` and `acks`.
- **placed, `Writes`**: an envelope is placed in its log when its log writer's signature verifies (`Envelope.placed`),
  its other signatures being approvals; `Writes` says which keys write for an envelope, avenDOCS's parameter.
- **log**: one writer's envelopes in one Doc and branch, each naming the one before by hash. **`IsChain` → `IsLog`**.
- **past, parents**: what an envelope names by hash, its `prev` and `deps`, and all they name in turn.
  **`Past.tips` → `parents`**.
- **split**: a writer signing two different envelopes at one place of its log; final, so neither side counts (**A4**).
  ⚠ A **fork** is a copy (avenDOCS).
- **version**: a set of envelopes with everything they build on, named by its tips (`Version`, **A175**); a Doc's
  version is one. **frontier, version vector, heads = version**.
- **`Closed`**: an envelope's whole past is held (**A30**).
- **counts, `Counts`**: the one counting rule: an envelope's whole past held, everything in it fit and authorized, and
  no split (**A30**, **A45**); fit is avenDOCS's, authorized avenCAPS's. **verdicts = counts**.
- **limit**: a bound on an input before it costs memory or time (rule 10); a call's params and a bound's values are
  avenCORE's limits, caps-only limits avenCAPS's (**P17**).
- **op, operation, `OpId`**: an operation, named by the name of `{op, plugin}` (`OpId.ofPlugin`). ⚠ Loro's op id
  **→ `LoroId`** (avenDOCS).
- **core op**: one of `core/1`'s eight: read, put, patch, remove, edit, tell, keep, share (**A32**). avenOPS's query and
  want are ops, not core ops.
- **call**: `{op, params}`, its `op` an `OpId` (**A32**). The engine's "envelope" of an operation **→ call**.
- **`typeParam`, `fieldsParam`**: `core/1`'s write params, `type` and `fields`.
- **target**: one grammar for what a cap covers, what a want asks for and what a query ranges over (**A8**): a Doc,
  with what it spawned or lists or not; a vault's Docs; or a vault's Docs of one type; each with the vaults below or
  not. A query's **scope = target**.
- **step**: what a call lowers to: put, patch, remove or edit at a path (**A19**, **A37**).
- **`builtinType`**: the one way a built-in type is named (**A45**); each package lists its own types.

## avenID: who is who

Keys, signatures, sealing, and vaults with their owners. [avenID](id/README.md).

- **key**: signs or opens. A **passkey** is ES256 through WebAuthn; a **kit** is a printed recovery key.
- **owner key**: an owner's hybrid key, derived from its passkey's PRF output for one ceremony and never stored
  (**A42**, **A77**); it signs as one of a vault's owners and holds no authority of its own.
- **seal key**: a vault's X-Wing key, derived from the same PRF output.
- **device key**: a device's Ed25519 key, made on the device and never leaving it; its ML-DSA and X-Wing seeds are
  derived from its seed and count only once its vault owner's hybrid signature binds them (**L6**).
- **PRF, PRF step**: a passkey's secret for an input, `["avenID prf 1", {epoch}]`, from which avenID derives the
  owner and seal keys (**A43**). A passkey without PRF makes no vault.
- **suite**: the algorithm id on every seal and signature.
- **hybrid signature**: Ed25519 and ML-DSA-65 over the same bytes; both must verify.
- **signer**: a key that signs for a vault, as one of its owners or as its device, and holds no authority itself
  (rule 15, **A28**).
- **assertion, challenge, counter, RP ID, origin**: WebAuthn's parts.
- **vault**: an identity that owns things, holds caps and may be an admin; named by the 32-byte name of its genesis,
  `["avenID vault 1", {kind, nonce}]`, which never changes (**L15**). Its **kind**: person, coop, agent or device.
  ⚠ "kind" means only this.
- **owner, owns, governs**: a vault's owners act k of n (D14); a vault governs what it owns, transitively, and
  authority runs only down. **chain** (avenID) **→ the owners above**.
- **approval**: an owner's `Sig` beside an act's name; k of n of them make the vault's act (D14).
- **device**: a vault of its own, owned only by the vault it serves, which alone may change or end it; its key signs
  for that vault and governs nothing, and what it may do is its device cap (**A178**).
- **account**: a person's vault one acts as.
- **sees, acts for, acts through, may act on**: how devices and vaults relate (`Aven.ID.Query`).
- **agent**: a vault kind for software principals: LLM agents, Aven, the ontology's minting agent. Only this meaning.
- **MaiaCityGuardian**: the guardian's vault, a full owner of every person's vault for now (**A42**, D12); its offline
  key is that vault's owner. ⚠ The README's "guardian vaults … after a delay" are **recovery owners**.
- **recovery owner**: an owner that can replace the others after a delay in which they can cancel; it comes later.
- **fingerprint**: a vault's short, checkable id.
- **tree** (avenID): the vaults and their owners, as avenID reads them. ⚠ Maia City's register is `tree/1`'s Doc
  (avenCAPS); Loro's tree is a **tree container**; the `tree 1` scheme is the **key tree**.
- **X-Wing**: ML-KEM-768 with X25519, the only key encapsulation.
- **sealed**: encrypted to its readers, and only that. ⚠ A segment **closes**; a signature on a slide is a
  **signature mark**.
- **reader**: what an epoch is sealed to, a vault or a group; "every reader checks every write" means the same readers.
- **group, group key**: vaults that share a key: a Doc whose readers are its members, whose key opens every Doc sealed
  to it; the network's members are a group (**A10**).
- **keyring, vault key**: a vault's own Doc of keys, of avenID's built-in type `keyring`, the only Doc sealed to
  devices, one Record per keyring epoch (**L7**); the X-Wing pair it holds.
- **epoch, key blob, stanza, tag, back, rotation**: one Doc key between rotations, named by its key blob's hash; the
  key sealed to each reader, with a commitment and a link back; one reader's sealed copy; what finds it; the previous
  key sealed under the new one; a new epoch. ⚠ "epoch" is only for keys.
- **key commitment**: an epoch's commitment to its key. **commit** (of a key) **→ key commitment**. ⚠ A commit is one
  Loro commit, one envelope.
- **scheme**: `flat 1` and `tree 1`, the key tree; `public 1` is gone.
- **seal, `seals`**: the one seal for envelopes, segments and checkpoints; its field `seals` names which, with the
  AAD `{doc, seals, epoch}` (**A177**). The seal's `kind` **→ `seals`**.
- **subkeys**: `avenDB envelope/segment/checkpoint/fetch/topic/converge 1`, and each sealed thing's `commit` key; what
  travels is a **checkpoint**, never a snapshot (**A177**).
- **padding**: one function pads every sealed thing a device sends, before sealing: up to 4 KiB, to the next of 256 B,
  1 KiB and 4 KiB; above that, Padmé (D18, **A176**).
- **convergence secret, file key**: an epoch's secret for files; the keyed BLAKE3 of it and the plaintext.
- **letter, letterbox, tag seed, pair tag**: a sealed Value from one vault to another, carrying a cap and keys; where
  a first letter goes; what finds a reader's stanza; a tag per pair of vaults.
- **safe, safe runtime**: a vault's Doc of secrets, of avenID's built-in type `safe`; each host's protected place that
  alone can open it (D17, rule 13).
- **heal**: after a compromise, new device keys and rotations (D19).
- **forgetting**: once no one holds a Doc's keys, no sealed copy of it is readable (`Aven.ID.Forget`).

## avenCAPS: who may do what

Caps over ops and targets, keeping, and Maia City's register. [avenCAPS](caps/README.md).

- **cap, grant, holder, issuer**: a signed grant of ops on targets under conditions; what it grants; the vault or group
  of vaults that holds it (the network's members are a group); the vault that grants it, proven by its owners' (or a
  device's) `Sig`s beside the cap's name (**A28**, **A30**). Caps delegate between vaults, never between signers.
- **verb** = a core op (**A32**): what a cap grants is ops.
- **clause**: one op of a grant, on a target, with bounds on its parameters, `{op, doc, params}`. **`Line` →
  `Clause`**.
- **condition**: `not_before`, `expires`, `approve`, `uses`, `budget`, `own`, `history`, and `lines` **→ `branches`**.
- **chain, root cap**: a cap and its parents; a cap resting on authority over the target's vault. The only "chain".
- **attenuation**: a link that narrows its parent for the same holder; at most one per message (**A27**).
- **role**: a named bundle of grants, pinned by hash.
- **device cap**: the cap from a vault to its device's vault, within which the device acts.
- **own authority**: a device writing on its vault's authority, within its device cap, without a chain.
- **outer bound**: an actor host's device cap, the most any hosted actor may do (**A27**). ⚠ avenOPS's **bound**.
- **run, run cap, standing cap, tell cap**: the causal chain of messages and the cap beside it; an actor's own cap for
  its declared duties; a cap naming messages.
- **router**: the receiving kernel's check of `tell`. ⚠ iroh's `Router` keeps its name in code.
- **collection**: a Doc of the sharing vault that lists Docs, like a smart album; its vault's devices run its query and
  sign each change, so what a cap covers changes only by its issuer's act (**A32**).
- **public**: the network's members, everywhere (D15, **P20**); never everyone or the open internet.
  **public:network = public**; `public:world` is gone.
- **authorized**: the reader's verdict that an envelope's caps allow it, judged on its own counted past (**P11**,
  **P19**); avenCAPS's half of counting.
- **revocation, ack, last-seen list, access map**: ends a cap and every cap on it; a writer's mark that it saw one; per
  Doc, the revoked holder's last envelope a revoker saw; a Doc's Records of the types `cap`, `revoke` and `epoch`.
  **kept list → last-seen list**.
- **whole merge** (`WholeMerges`): a merge into main judged as a whole.
- **change view** (`RecordChange`): what changed in a Record, as a reader sees it.
- **holdings**: what a device or keeper holds, only what its caps cover, so honest peers drop what coverage loses at
  their next sync (**A40**).
- **keep cap**: an owner vault's cap naming which keeper holds which of its Docs and Values; its default is the owner's
  own act at join (**A44**). The Aven Peer's **keep rule → a keep cap**.
- **offer cap**: a keeper vault's grant to a vault or a group: how much it stores (quota) and how fast (rate) (**A44**).
- **quota**: the bytes an offer cap allows a vault to hold (`Books.quota`, **L18**).
- **keeping**: who keeps a vault's Docs: its keep caps, issued and kept by the owner's vault (**A44**).
  **`Aven.ID.Placement` → `Aven.ID.Keeping`**; placement stays the actors'.
- **fetch key, fetch link**: a Doc epoch's Ed25519 key, `derive_key("avenDB fetch key 1", the epoch's key)`, which
  every reader derives (**L12**); the next key's link, signed by the key before, the chain starting at the listing
  (**L14**). Two links after one key **→ rival links** (not a fork).
- **fetch proof, upload proof**: a Doc's current fetch key's signature over `["avenDB fetch 1", {doc, exporter}]`, the
  connection's TLS exporter (**P14**).
- **listing, `KeepOrder`, choice, books**: a keep cap's Docs with each one's first fetch key; an order from its issuer,
  a withdraw or a delete; the issuer's pick of a branch after rival links; what a keeper's offers let each vault hold
  (**L12**, **L14**, **A22**). The keeper's `Signed` **→ `KeepOrder`** (**A45**). ⚠ **order** (causal order).
- **register, `tree/1`**: Maia City's register, a Doc whose readers are the members (**A42**, **P20**): its setup,
  governance, tickets, withdrawals, confirms, the relay list and the settings (**L11**).
- **statement** = a `tree/1` op call in the register: a claim, a sign-in, a ticket, a join, a withdrawal (**A12**,
  **A30**).
- **setup**: the register's root Record, fixed at birth: the network's settings and its own vaults' geneses, Maia
  City's, Aven's and the guardian's (**P18**, **L15**); a setting changes by a later `tree/1` op, settled by latest.
- **network**: the members group under one register, and only that. The agent is "the network's agent", a statement's
  `network` field names the register's genesis, and the Rust `Network` **→ `Genesis`**.
- **admin**: Maia City's vault; an admin act counts when its owners approve it (D14, **A28**). *admin key* retires.
- **ticket**: a cap from Maia City to the vault its claim founds, issued on its owners' approval; its one-time
  **ticket key** only authorizes the claim (**A28**). **invite = ticket**; **one-time key → ticket key**.
- **withdrawal**: ends an unused ticket, **= the ticket's revocation**. ⚠ A runtime's withdrawal is an appended
  manifest entry that stops its hash loading (avenRUNTIME).
- **claim, join**: claiming a ticket, which founds a person's vault; a confirm then issues its member cap (**A38**).
  **join = claiming a ticket**; the network's first claim **→ genesis**, so "claim" stays for tickets.
- **confirm**: `tree/1`'s op that issues a member cap, held by Aven and the genesis's confirmers under Maia City's cap
  (**A38**, **A42**). *admin device* retires; the tree's "ack" **→ confirm**.
- **member, member cap**: a vault holding Maia City's member cap (**A38**); the cap a confirm issues. The members are
  the network's group (**A10**). **`memberOf` → the members group**; `member_of` stays an ontology predicate.
- **sign-in**: the register act that adds a device to the vault of the passkey that signed it; it names no vault
  (**A43**).
- **passkey record**: the register's record of a passkey, by its credential id: its vault, its ES256 key, its owner and
  seal public halves and its epoch (**A43**).
- **settle, settled tree**: computing the register from its acts by the one rule; "settle" is for this only, and
  concurrency rules live only here (**P19**).
- **contested, final claim**: a ticket claimed twice, before one claim is final; the claim that stands.

## avenDOCS: Docs and their history

Data that merges, with its history. [avenDOCS](docs/README.md).

- **Doc**: mutable data named by the name of its genesis envelope, its state the merge of its logs; the unit of keys,
  caps and sync. ⚠ The documentation is **Brain**.
- **genesis**: a Doc's first envelope, exactly `{nonce, pins, type, vault}`, whose name is the Doc's id (**P23**).
  ⚠ A vault's genesis is avenID's; the network's setup is its register's root Record (avenCAPS).
- **Record, root Record**: a typed piece of a Doc at `<doc>/<id>`; a Doc as a Record of its own, where its first
  envelope fixes what it refers to at birth: a fork's origin, a period Doc's predecessor (**P23**).
- **container**: a field's merge kind: text, list, movable list, map, tree, counter, value.
- **type, schema, type id**: a Doc whose versions are schemas, joined by lenses; one version of a Record's shape; a
  version's address, `<type Doc>/<schema hash>`. Every Doc has a type, fixed by its genesis; a type Doc's own type is
  the built-in type of types (**A39**).
- **pin**: a schema version or a lens a Doc accepts, at birth or by its owners' act; a listing can be withdrawn
  (**A7**).
- **`x-loro`, `x-link`**: the container a field uses; **`x-link` = link**.
- **link**: a field holding the address of a Record or a Doc. avenOPS's **ref**, the ontology's **ref place** and
  **`x-link` = link**.
- **lens**: two-way steps between two schema versions, in one type Doc or across two: add, rename, convert, in, wrap,
  unwrap, move, container. A reader uses only the lenses pinned where it reads, and those form a forest (**A7**).
- **parked, unseen**: where a dropped field's data goes. A lens's **kept → parked**.
- **vocabulary**: a vault's named types, ops, runtimes and definitions, a Doc of its own; vault, then network, then
  built in. **catalogue, lane = vocabulary**.
- **fit**: whether an envelope's changes fit the schemas it names; avenDOCS's half of counting. **kin → the same type
  Doc**.
- **writer id**: the Loro peer a device writes a branch as, inside the seal (D13). Loro's **peer** and the
  **pseudonym → writer id**. ⚠ A **Peer** is a node.
- **writer, the committer**: a log's author; the one task in each peer that applies changes (README rule 1). **the one
  writer → the committer**.
- **segment, loose envelope**: a closed run of one log in one epoch, sealed and hybrid-signed as one Value; an envelope
  no closed segment covers yet. **sealed** (into a segment) **→ closed**.
- **loro range, `LoroId`**: `loro {from, to}`, a writer's Loro counters in an envelope; Loro's id of a change, never an
  op (**A45**). **counter range → loro range**.
- **head, held page, shelf**: a peer's own pointer to what it holds of a Doc; a Doc's held envelopes by name and hash,
  in held order (**P2**); the two refs a peer keeps per Doc, the held page moved first (**L2**).
- **snapshot, checkpoint**: a peer's own cache of a branch at a version, which never travels; a signed state at a
  version naming what it covers, which travels and is checked by replay (**A5**), after the cutover (**P24**). A
  **partial** snapshot **→ unchecked**.
- **branch**: **main**, a **proposal** or a **variant**; **draft** is dropped. **line → branch**. ⚠ A face's variant
  is an axis of a face.
- **named version**: a Record `{name, at}` (D10).
- **merge, merge footprint**: a change building on both heads, plus the three-way fix-up; every type and field it
  changes. Merges **resolve**; "settle" is the register's.
- **revert to, back out**: make a branch equal to an older version by a new commit; take one older change out.
  **restore → revert to**.
- **fork**: a new Doc started from a version, with its state and a link to its origin, without its history (D6). Only
  this meaning.
- **generation**: a device's fresh start on a branch, after a split or a stuck log. **epoch** (a device's next peer)
  **→ generation**.
- **stuck**: a log whose next envelope would build on one that doesn't count. **stuck peer → stuck**.
- **scratch copy**: a fork used to open a version.
- **judge, unfit**: importing envelopes with their verdicts; an envelope the judge crashed on alone, kept local and
  never travelling, as the ref `docs-unfit` in the Peer-Light's store (**P3**, **A169**).
- **period Doc, series**: one period of a stream, a chat's month, linking the period before; a chain of them (**A6**).
- **directory**: the index of a vault's Docs of one root type, by Doc id: sealed Values, with recent entries in a small
  Doc, each entry its own envelope there (**A26**, **P25**).

## avenOPS: ops, queries and wants

What a device runs over Docs, and what it wants. [avenOPS](ops/README.md).

- **query, mutation**: an op that reads, and an op that writes through steps.
- **table, column**: a type's Records; `id`, `doc` and the fields. **= type**, read as rows.
- **address**: `<doc>/<id>`, a link's value.
- **file Record**: a Record of type `file`, naming a file's chunk list.
- **plugin, plugin op, lowering**: **plugin = runtime** whose output is steps (**A18**); an op in its grammar; the pure
  map to steps, pinned by its runtime's hash.
- **grammar, meta-grammar**: JSON Schema with `additionalProperties: false`; each op carries its grammar's hash.
- **params, bind, cell, `ref n`, `when`**: values given at run time; a cell the engine fills: `$actor`, the actor
  running the op, `$vault`, the vault it acts for, `$device`, the signer, and `$now`, the writer's time; the id an
  earlier `put` made; a condition that skips.
- **walk**: a bounded step over a link column, at most N hops.
- **slot id**: the id of an at-most-one trait, so concurrent writes meet on one key.
- **want, window, follow, tier, signal, lifetime**: demand and its parts; a want's key is (Doc, branch, level,
  window) (**A9**). **part → level**: `head`, `records` or `files`. Tiers are `now`, `next`, `later`, `idle`; a lifetime
  is `mounted` or `durable`, as an actor's is. A want only orders, never grants (rule 6).
- **keep, open**: a durable want; a mounted want, imported while shown or running. **durable want = keep**.
- **loads**: an actor definition's wants. **manifest** (wants) **= loads**. ⚠ avenRUNTIME's **manifest**.
- **device profile**: a Doc of the device's vault: `keep.tiers`, `bytes`, `files`, `also`.
- **want queue**: the one queue that orders fetching and opening (**A9**). **scheduler** (avenOPS) **→ the want
  queue**.
- **footprint, bound**: what an op reads and writes per lowered step (type, verb, fields and constraints), computed
  from its lowering and never written in a cap (**A32**); the most work it may do, per operator (**A9**).
- **view, delta, live answer**: a query's rows read through lenses at one schema version, stamped with a version; the
  added, changed and removed rows; a subscription's pushes (README rule 8). avenDOCS's "view", an app's schema and
  lenses, **= the input of a view**.
- **status, phase**: `complete`, `partial` (not everything is held) or `denied`; connecting, catching up, live,
  offline or stalled.
- **pending write, overlay**: a local write shown until committed or refused.
- **stall alarm**: raised when a step moves no version (rule 11).
- **index, sealed index**: a derived map that must equal a scan: a device's own cache, or a search tree of sealed
  Values its readers share, derived from a query's shape and kept current by folds, which are checkpoints (**A26**).
  **blind index**: tokens another peer could match; not used, since search is local (**A21**).
- **RBSR**: range-based set reconciliation.

### The ontology, avenOPS's first plugin

- **fact, entity, referent**: `{id, p, x1…x5}`, a Record whose type is a predicate; what an id names; what a place
  points at.
- **predicate**: **= a type** of facts, with an English name, a gismu, a gloss and typed places.
- **place** (x1 to x5): a **value place** (closed types) or a **ref place → link place**.
- **gismu, gismu table, coined**: Lojban roots with place structures; 1341 typed; a predicate without one.
- **category**: an entity standing for a kind of thing.
- **trait**: one predicate around an entity, at most one or many. **kind → type** (a type composed of traits).
- **proposal**: a change to the network's vocabulary that the admin accepts. **= a proposal branch** of the
  vocabulary.
- **minting agent**: makes predicates. **= an agent vault** with devices of its own, never a device of a person's
  vault.
- **gloss**: a predicate's definition. **definition** (of a predicate) **→ gloss**. ⚠ A definition is an actor's.
- **shortlist, alignment lens**: candidate gismu chosen by a model; a lens across vocabularies. **= a lens** between
  two type Docs.

## avenSTORE: where bytes rest

Blobs, refs and files. [avenSTORE](store/README.md).

- **store, `Store`, blob**: where a peer's blobs and refs rest, with one writer; a Value at rest, whole or absent.
- **`Hash`**: BLAKE3. Bare lowercase hex in store paths; in JSON, a 32-byte `{"bytes": "<hex>"}` (**A174**).
- **ref, `RefName`**: a peer's own name for a Value, moved only by compare-and-set and never leaving its peer; 1 to 128
  of `A-Za-z0-9._-`, not starting with a dot; at rest 64 hex digits and a newline. ⚠ avenOPS's "ref" **→ link**.
- **compare-and-set**: a ref moves only if it still holds what its writer expected; a stale writer is refused.
- **reachability**: a blob is kept while a ref reaches it.
- **driver, backend, OpenDAL, opfs, adapter**: what a store runs on (memory, fs and s3 through OpenDAL; opfs, ours);
  the one module that answers iroh-blobs from our store.
- **marker, temp file, roll forward, sweep**: a browser store's format version (`meta/version`); the opfs driver's
  crash protocol.
- **hash sequence** (`HashSeq`): a blob of hashes; the form a file takes.
- **chunk**: a file's piece of at most 1 MiB, every one but the last exactly 1 MiB. ⚠ bao's and iroh-blobs' chunks are
  1 KiB: **bao chunks**.
- **chunk list**: a file's chunks' hashes, in order; the file is named by its hash. **file index → chunk list**.
- **file**: bytes stored as a hash sequence, named by its chunk list's hash; a file Record in a Doc names it, and it is
  kept and read as that Doc is (**A22**).
- **outboard, bao group, seek, range**: bao's tree, made when needed and never kept; 16 KiB groups; a read of a range
  that fetches only the chunks it touches.
- **file holder**: a peer holding a file's chunks.
- **spike**: the measurement that chose iroh-blobs on our store over bao-tree directly.
- **pack, pack entry, refs log, pack table, tombstone, compaction, torn tail**: the opfs driver's next layout.
  **pack record → pack entry**; its **index → pack table**.
- **room secret, convergent key, AEAD unit**: the parked sealing sketch. **Retires**: avenID's epochs and file keys
  replace it.

## avenPEERS: the network

The Peers and everything between them. [avenPEERS](peers/README.md).

- **Peer, Aven Peer, Alice Peer, Peer-Light**: a running node, native; one with its relay on, on the server, a Peer of
  the agent Aven; one with it off; the same code as wasm in a browser's worker.
- **wire, wire version, `aven/db/1`**: our protocol's frames; the one version a peer speaks, with no fallback; our
  ALPN, a frozen name. **`Router`, `ProtocolHandler`, `after_handshake`**: iroh's dispatch and hook.
- **greeting, `update`**: the hello, a frozen JSON line every version reads (**A29**); the answer to a peer of another
  wire version, which only the side behind follows.
- **relay, relay list**: iroh's relay, members only; Maia City's list of relays, in its register. The keeper list is
  gone (**A44**).
- **door**: admission at the relay, the handshake and the blob provider: a device whose vault is a member (K12).
  **newcomer**: a browser carrying one acceptable register act. **allow-list → the members' devices**; **provider
  gate → the door** at the blob provider.
- **group topic**: a group's gossip topic, the BLAKE3 hash of `{key, wire}`, its key `derive_key("avenDB topic 1",
  the group's epoch key)` (**L4**); one per group, never per Doc (**P15**). **gossip topic → group topic**.
- **live envelope** (`Live`): what a group topic carries: `{sealed}`, a loose envelope whose seal names its Doc;
  `{doc, hash}`, one too big for gossip; `{doc, version}`, the hash of the sender's tips (**L4**, **L5**). **live
  message → live envelope**. ⚠ A message is avenACTORS's.
- **`doc_tips`, `doc_have`**: the frames by which two readers whose versions differ catch a Doc up, paged (**L4**).
- **tip**: the newest point of a log, naming its writer, sequence number and name (**P10**). The wire's `Head` **=
  tip**.
- **catch-up**: fetching what is missing: among readers by version, from keepers by arrival. A catch-up **page →
  batch**.
- **keeper**: a peer that keeps a vault's sealed bytes without its key, where the owner's keep cap names it and its
  offer covers that owner (**A44**). **`Keep` → `KeeperState`**.
- **bill, admission**: the bytes of a keeper's held items whose earliest remaining uploader acts for a vault
  (**P13**); an upload is admitted when the vault's bill after it is within its quota, or no larger than before (**L1**).
- **covers**: the loose items a segment upload names by their sealed hashes; a keeper drops an item once no uploader of
  it is left (**A44**).
- **fetch gate**: the one check before a peer serves a Doc's sealed Values, to readers and keepers alike: `prove`, then
  `fetch` and `items` (**A44**, **P7**). ⚠ Any other **gate** is a time limit.
- **presence**: a device's signed beat, ordered by its counter, its time a claim; the only beat (**A35**). The
  hub's count, `here` and `bye`, and the wire's `Beat` frame retire.
- **address record, release record**: history, envelopes in their signer's own log, the newest the latest (**A31**);
  log tips are history too (**A42**). **notices → history**. Release records come later (**A36**, **A42**).
- **upgrade**: a new wire version reaching the peers; a Peer never upgrades itself without its owner.
- **first-start ref**: a peer's record of its first start. A peer's **record** (`first-start`) **→ status,
  first-start ref**.
- **bootstrap, home relay**: how a new device first reaches the network; a device's own relay. ⚠ An actor's **home**;
  avenRUNTIME's bootstrap manifest; the wire's bootstrap frames (rule 1).
- **file API**: the Peer-Light's `file_len`, `file_range` and `file_fetch`.
- **migration guarantee, clean store, old side**: how production's register moves to a new release without losing a
  device.
- **cutover**: the move from the first generation to Docs, in seven stages (**P22**); the first generation goes after
  it.

## avenRUNTIME: runtimes

Every runtime, in one home. [avenRUNTIME](runtime/README.md).

- **runtime**: a pure function named by its hash, `run(part, input) → output`, published by a vault, Aven's for the
  built-ins, and from this repository until Docs run (**A45**). **plugin = runtime** (**A18**).
- **runtime name**: `<job>-runtime` for actors (**state-runtime**, not json-runtime; **js-runtime**; **face-runtime**,
  which draws a face from its data, `markup` and `style` and checks its a11y, and replaces view-, markup-, css- and
  style-runtime; there is no prolog-runtime), `<format>-runtime` for files (**svg-runtime**, **markdown-runtime**,
  **text-runtime**, **csv-runtime**, **json-runtime**, **pdf-runtime**), and a plugin's after it
  (**ontology-runtime**). One namespace.
- **runtime version, module hash**: `svg-runtime@3`, the third frozen module; the BLAKE3 hash of its bytes, which names the code.
  There are no floors (**A18**, **A42**): a withdrawal stops a hash loading, and for what others wrote, A7's pins.
  **floor** retires.
- **manifest, bootstrap manifest**: `manifest.json`, append-only: each frozen runtime's name, version, hash, limits and
  users, and its withdrawals; a typed Doc of the publishing vault once Docs run (**A45**). ⚠ avenOPS's **manifest
  = loads**.
- **freeze, frozen bytes**: the reproducible build that names a module by its hash; its bytes, committed as
  `frozen/<hex>.wasm` until Docs keep them as Values.
- **host, browser host**: `aven-runtimes-host`, which loads a module by hash, refuses any import, admits only what every
  engine runs alike (no floats, one memory, no SIMD or threads), meters fuel and memory and checks the output's limits;
  the same host as `aven-runtimes-web`, in avenOS's runtimes worker. Always the **runtime host**.
- **fuel, shim, hostile parts**: work counted per instruction; the deterministic answer to clock and random calls;
  test parts that try to escape.
- **hostile corpus**: test files per runtime that try to escape, explode or flood, each with its exact failure.
- **file runtime**: a runtime whose part is a file's bytes and whose input is a render's params.
- **registry, decide, decision**: the one list of file types, a line per type; the function from a file's
  first bytes, size and claimed type to a decision: its type, how it shows, its limits, how it is served.
- **sniff, signature**: what the bytes say a file is; bytes at an offset that mark a type. ⚠ A claim is only what the
  sender says.
- **show**: `native` (the browser's own decoder), `runtime`, `frame` (PDF's viewer in a sandboxed frame, until
  pdf-runtime) or `download`.
- **files origin**: the origin that serves files and runs file runtimes, holding no secret (**A15**).
- **render, render cache**: a file runtime's output for one file and one set of params; kept on the device by
  (runtime hash, file hash, params hash), never synced.
- **node tree, allowlist**: the one output faces and file runtimes draw as DOM; the one list of elements, attributes
  and URL schemes it may hold, `Aven.Runtime.Tree` and its `tree.json`, which every check of a tree is held to.

## avenACTORS: actors

Programs that live in a Doc and take turns. [avenACTORS](actors/README.md).

- **actor, instance**: a running definition with its own Doc, at an address that names no device. **instance =
  actor**.
- **part**: code or data in one format, for one runtime. ⚠ A want has a **level**; caps have a share depth.
- **definition**: the class: `interface`, `machine`, `turn`, `faces`, `init`, `lifetime`, `replaces`, `loads`.
  **= a version of an actor type** (**A17**); **`replaces` = the version before**.
- **component**: a definition whose main part is its face: `props`, `events`, `slots`, `styling`, `a11y` and `markup`
  (not `view`).
- **face, face actor**: an actor's drawn view; a placed component instance with a mounted lifetime.
- **placing, placer**: spawning by drawing, with `$use`; the face that places, and where. ⚠ The ontology's **place**.
- **variant**: one axis of a face: meaning, shape, size. ⚠ avenDOCS's variant is a branch.
- **interaction states** (eight): default, hover, focus, active, disabled, loading, error, selected. **states →
  interaction states**. ⚠ An actor's state is its data.
- **brand, tokens**: styling as data.
- **actor address, home, id**: `<home>/<id>` **→ a vault-scoped id with an incarnation counter; the home only routes**
  (**A17**).
- **actor Doc**: `def`, `state`, `journal`.
- **carrier Doc**: the Doc of a pair of vaults, belonging to the vault that opened contact, the other holding read and
  tell on it, its readers its group (**A17**, **A33**, **A42**). **inbox Doc → carrier Doc**.
- **field**: a value replaced whole.
- **entry**: a log's entry. **record** (a log entry) **→ entry**. ⚠ A Record is avenDOCS's.
- **message**: an envelope in its two vaults' carrier Doc: `kind, from, to, seq, name, payload, re, deadline, run,
  cap`; **tell, ask, reply, fail** (**A33**).
- **receipt**: the receiver's turn naming a message by hash (**A33**). The delivery **`ack` frame → receipt**; **live
  delivery** retires: a message travels as any Doc's envelopes do.
- **seq**: per pair or per sender, to be decided.
- **turn, given, effects**: handling one message, one envelope on the actor's Doc; its input, its time and seed and
  the `now` tier as versions (**A17**); the messages it sends.
- **journal**: **= the actor Doc's log; an entry is a turn's envelope** (K9).
- **state, machine**: the actor's data; a table of phases and transitions in the interface, itself data, checked by
  the kernel's admission checker and proven in Lean (no Prolog). The actor's current **phase** is one of them.
- **present, view model**: state to a view model to a node tree.
- **kernel**: an open word, still to settle: the actors' spec uses it for the actor host's trusted part, which routes,
  keeps the laws and admits machines. ⚠ It never means avenCORE.
- **scheduler, clock** (`tick`, `at`): one turn per actor at a time; time. ⚠ avenOPS's scheduler is the want queue.
- **actor host**: a device that signs for the actors it hosts, under their chains (**A27**). Actors hold no keys: the
  actor host's device signs. Always "actor host", never bare "host".
- **shadow root, person actor**: each face's scope; the device's person, sender of every click. **applier = drawer**
  (avenOS).
- **spawn, retire**: create an actor by asking the kernel; end it.
- **door actors**: the model, store, HTTP, files and push. ⚠ The door is admission.
- **composite, skill**: an actor whose turn tells others, its loads its members' union; a product word for one.
  ⚠ Actors have no members field yet; avenACTORS decides.
- **describe**: the ask every actor answers, from its definition, its current phase and the asker's caps: its tool
  specs.
- **tool**: a message from `describe` that the caller's caps allow. A model's tool list is a projection of `describe`
  and is never configured apart.
- **sends**: the messages a definition declares it may send; the kernel enforces them.
- **contracts** (requires, produces) **= interface types and `sends`**.
- **trace, outcome, preview**: used but undefined. To define.
- **`$`, `$$`, `$each`, `$on`, `$use`, `$description`**: the markup grammar's keys.

## avenOS: the shell

The page, its workers and its apps. [avenOS](os/README.md).

- **app**: a tile on avenOS's dashboard: Vault, Control Room, Invite, Chat.
- **dashboard, account switcher**: the page of a vault's apps; the pill that picks the person you act as, never a
  network or a device.
- **leader, follower, Web Lock**: the tab that holds the Web Lock and runs the Peer-Light's worker; the other tabs,
  which reach it over its BroadcastChannel.
- **Peer-Light's worker, docs worker, runtimes worker**: the worker that runs the Peer-Light and holds the keys; the one
  that runs avenDOCS's judge for every open Doc; the one that runs the runtime host, holding no key.
- **Service Worker**: answers `/files/<hash>` from the leader, keeps the shell offline, and brings a newer release after
  `update`.
- **drawer**: avenOS's trusted page code that checks a runtime's tree and style again and draws them into a shadow
  root of its own. **applier, tree drawer = drawer**.
- **sign out**: ending the Peer-Light's worker and clearing the origin's storage; the device stays until it is removed.
- **Brain**: avenOS's screen over avenBRAIN, `#/brain`, readable by anyone, signed in or not (**A41**).

## avenBRAIN: the architecture's one location

[avenBRAIN](README.md) holds the architecture, in the repository and in the UI (**L9**).

- **the architecture** (`ARCHITECTURE.md`): the index: the whole on one page, the rules, the packages and their owners,
  and every decision with its status.
- **the decisions** (`DECISIONS.md`): the append-only audit trail of every decision.
- **page** (avenBRAIN): one package's page, `<id>/README.md`: its story with its slides, then its architecture, each
  concept once. ⚠ **page**.
- **story**: a page's concepts in the order a reader meets them, from first principles; never a term before its slide.
- **slide**: one concept as one 16:9 picture, with its text in Markdown under it. Its markup is allowlisted HTML with
  classes only, its pictures images by hash, so the face-runtime can draw it.
- **layer** (on a slide): one visual element with a stable class, so a motion version can move it. ⚠ **layer**.
- **object** (on a slide): one hand-drawn thing standing for a concept (STYLE.md, "Metaphors"), as an image by hash.
- **path** (on a slide): the dotted line that shows a relation, its name over it.
- **signature mark** (on a slide): a signature drawn as a mark pressed in wax; never "seal", since sealed means
  encrypted.
- **card** (on a slide or a page): a drawn or laid-out panel; never "record", since a Record is avenDOCS's.
- **contents**: a page's list of its sections, beside it; never "index", which is avenOPS's.
- **package list** (`packages.json`): what Brain's dashboard shows; never "catalogue", which the vocabulary replaced.

## avenSANDBOX: the box

Every peer on one machine, checked. [avenSANDBOX](sandbox/README.md).

- **box, cast, check**: the image and containers that run every peer on one machine; its four peers and their vaults,
  with public test keys; `bun run up --check`.
- **image, box tag**: the box's one image of tools; the first 16 hex digits of a SHA-256 over every file its build reads.
- **production's stand-in**: `prod`, an Aven Peer in production's configuration, with avenOS in front of it at
  `localhost:5174`.
- **topology**: a NAT or UDP test setup in the box (`bun run lanes`). **lane** (iroh) **→ topology**. ⚠ avenDOCS's lane
  retires.
- **wipe**: emptying a store; never in production.
- **gate**: a time limit per browser engine. ⚠ avenPEERS's **fetch gate**.
- **bump**: moving every pin, a dependency's exact version, to its newest stable release, only by hand.
- **vectors**: Lean's examples and generated cases as JSON, which every implementation and check loads (README rule 10).
- **fuzzer**: cargo-fuzz on avenDOCS's import, on its own nightly, in the box.

## The first generation

What runs before Docs. Nothing new is built on it, and it goes at the cutover (**A45**, rule 16, **P22**).

- **city-dome**: the members' one chat room; the chat Doc replaces it. **room, space → city-dome**.
- **line** (chat): a signed chat blob in the frozen format; the chat Doc's is a **post** Record.
- **`chat-<device>`**: a device's head, its newest line, a ref.
- **the chat's chains → logs**; its forks and `Fork` **→ splits**, `Split`.
- **catching up, frames** (`heads`, `catch_up`, `lines`): fetching what is missing; the messages of `aven/db/1` for it.
- **learned head**: a device waiting for the Aven Peer's view of its own head. **Retires** (rule 3).
- **loose lines, offline queue**: lines waiting for what they build on; writes waiting for a connection.
- **announcement** (a `file` line) **→ a file Record**.
- **retraction, withheld**: a delete of a line or a file, a line of the deleting device's chain; a file's blobs served
  as gone until their bytes are deleted.
- **the code's `Keeper`**: every peer's in-memory chat chains. **→ `Logs`**. ⚠ A keeper is avenPEERS's.
- **the code's `Gate`**: the door's set of keys. **→ `Admission`** (a `Door` type exists).

## Words with more than one meaning

Which package keeps each word.

| Word | Keeps it | The others become |
|---|---|---|
| ack | avenCAPS | the register's → confirm; avenACTORS' → receipt |
| bootstrap | avenPEERS (a new device's first reach) | avenRUNTIME's bootstrap manifest; the wire's bootstrap frames (rule 1) |
| chain | avenCAPS | log (`IsLog`); the owners above (avenID, `Tree.chain` → `above`); fetch keys "succeed"; period Docs a "series" |
| claim | avenCAPS (tickets) | genesis (the network's first) |
| commit | avenDOCS and avenOPS | key commitment (avenID) |
| core | avenCORE | the first generation's crate → `aven-gen1`; "kernel" is an open word, never avenCORE |
| definition | avenACTORS | gloss (the ontology) |
| docs, Docs | avenDOCS | the documentation is **Brain** (A41) |
| envelope | avenCORE | call (avenOPS's wrapper) |
| epoch | avenID (keys) | generation (avenDOCS) |
| fork | avenDOCS (a copy, A4) | split (avenCORE); rival links (fetch keys); the chat's `Fork` → `Split` |
| gate | avenSANDBOX and avenSTORE (time limits per engine) | avenPEERS's **fetch gate** keeps its name; door (access); `Admission` (the first generation's code) |
| genesis | avenDOCS (a Doc's first envelope) | a vault's genesis (avenID); the network's setup, its register's root Record (avenCAPS) |
| host | nobody | always qualified: "actor host", "runtime host", "the page side", "platform" |
| index | avenOPS (queries) | chunk list (files); pack table |
| kept, keep, keeper | "kept" only for what a keeper holds; keep (avenOPS, a durable want); keeper (avenPEERS) | the lens's → parked; caps' kept list → last-seen list; `Keep` → `KeeperState`; the code's `Keeper` → `Logs`; the keep rule → a keep cap |
| kind | avenID (vaults) | type (the ontology, avenDOCS); `join` (avenOPS) |
| lane | nobody | vocabulary (avenDOCS, the ontology); topology (avenSANDBOX) |
| line | nobody | branch (avenDOCS); post (the chat Doc); caps' `Line` → `Clause`; the first generation's frozen chat format keeps it |
| manifest | avenRUNTIME (the bootstrap manifest) | loads (wants) |
| member | avenCAPS (holding Maia City's member cap) | `member_of` stays a predicate |
| network | avenCAPS (the members group) | the agent; the register's genesis; `Genesis` |
| op, operation | avenCORE (`OpId`), run by avenOPS | caps' verb = a core op (A32); Loro's op id → `LoroId` |
| page | nobody | catch-up → batch; the example type → note; ⚠ between a browser page, a brain page and wasm pages |
| part | avenACTORS | level (wants) |
| partial | avenOPS | unchecked (a snapshot) |
| peer | avenPEERS (`Peer`) | writer id (Loro) |
| placement | avenACTORS (placing a face) | caps' → keeping |
| public | avenCAPS (the network's members, P20) | never everyone or the open internet: Brain is readable by anyone |
| record, Record | avenDOCS and avenOPS (`Record`) | peers' records → history (A31); `record.rs` → `FirstStart`; a log entry → entry; pack record → pack entry; slides' cards |
| ref | avenSTORE | link (avenOPS, the ontology, `x-link`) |
| router | avenCAPS (`tell` check) | iroh's `Router` keeps its name in code |
| scheduler | avenACTORS (turns) | the want queue (avenOPS) |
| seal, sealed | avenID (encrypted) | segments "close"; slides' "signature mark" |
| settle | avenCAPS (the register's one rule) | merges "resolve"; fetch keys "the issuer chooses"; `settleRemovals` → `resolveRemovals` |
| snapshot | avenDOCS (local) | checkpoint (what travels) |
| split | avenCORE (final, A4) | history entries at one place of a signer's log are splits too (A31, A42) |
| state | avenACTORS (data) | interaction states (faces) |
| tip, head | tip: a log's newest point (avenPEERS); head: a peer's own pointer to a Doc (avenDOCS) | `Past.tips` → `parents`; the wire's `Head` → `Tip`; avenOPS's heads → version |
| variant | avenDOCS (a branch) and avenACTORS (an axis of a face) | both stay, each in its own package |
| view | avenOPS | markup (avenACTORS); the input of a view (avenDOCS) |
| withdrawal | avenCAPS (a ticket's) | a runtime's manifest withdrawal (avenRUNTIME) |
| writer | a log's author | the committer (the task) |

## One thing, two names

| Names | Use |
|---|---|
| Value, blob | Value; a blob is a Value at rest |
| statement, line, envelope, journal entry | envelope |
| chain, segment run, journal, inbox entries | log |
| fork (equivocation), split | split |
| heads, frontier, version vector, version | version |
| loads, manifest, durable want, keep, mounted want, interest | want (keep = durable) |
| keeper, holder, the Aven Peer's keep rule | keeper (holder for a file's chunks); a keep cap for the rule |
| type, schema family, table, predicate, kind, definition | type, with versions |
| catalogue, lane, vocabulary | vocabulary |
| plugin, runtime | runtime |
| verb, core op | core op |
| invite, ticket; join, claiming a ticket | ticket; claim |
| member, `memberOf`, in the network's group | member: a vault holding Maia City's member cap |
| admin device's ack, confirm | confirm |
| quota under a keep cap, offer cap | offer cap |
| ref (engine), ref place, `x-link`, address | link, whose value is an address |
| inbox Doc, carrier Doc | carrier Doc |
| turn, mutation of the actor's Doc | turn |
| line (docs), branch, `lines` | branch |
| snapshot (travelling), checkpoint, signed tree head | checkpoint |
| address record, release record, log tip, notice | history |
| live message, live envelope | live envelope |
| gossip topic, group topic | group topic |
| applier, tree drawer, drawer | drawer |
| lane (iroh), topology | topology |
| room, city-dome, space | city-dome, until the chat Doc replaces it |
| catch-up by hash sequence, by frames | catch-up: among readers by version, from keepers by arrival |

## Still to settle

Words with more than one meaning still, each for its package's owner to settle: **kind** (vaults only, yet five new
enums), **kernel** (the actors' word for the actor host's trusted part), **link**, **version** (v1), **join** (only
the network's join: a browser signing in is *added* to a vault),
**index**, **address**, **fit**, **door**, **safe runtime**, **layer**, **part** and **package**, **standing**,
**order**, **withdraw** and **delete**, **seq** (per pair or per sender), and decision labels that mean caps decisions
in one file and thread tasks in another.
