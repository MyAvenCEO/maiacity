# avenDB glossary

Every term the avenDB specs use, part by part, with its one meaning and a verdict. The shared primitives (Value,
envelope, log, Doc, cap, want and the rest) are defined once, in
[`ARCHITECTURE.md`](ARCHITECTURE.md#the-primitives-everything-shares). This file maps every other term onto them.
The verdicts are proposals until Samuel decides (**A1**).

**Verdicts.** No mark: keep as is. **→ x:** rename to x. **= x:** the same thing as x; use x. **⚠:** the same word
means something else in another part, and that part's meaning is named.

## avenID: identity

- **key**: signs or opens. An **owner key** governs a person's vault; a **device key** signs for one vault; a
  **passkey** is ES256 through WebAuthn; **PRF keys** are derived from a passkey; a **kit** is a printed recovery key.
- **suite**: the algorithm id on every seal and signature.
- **hybrid signature**: Ed25519 and ML-DSA-65 over the same bytes; both must verify.
- **X-Wing**: ML-KEM-768 with X25519, the only key encapsulation.
- **vault**: an identity that owns things. **kind** of vault: person, coop, agent, device. ⚠ "kind" elsewhere: see
  the ontology and docs; this is the only meaning kept.
- **owner, owns, governs**: a key or vault that owns a vault, k of n; direct; transitive. Authority runs only down.
- **tree**: the vaults and their keys. ⚠ Loro's tree is a **tree container**; caps' `tree 1` is the **key tree**.
- **chain** (avenID): the vaults above one, nearest first. **→ the owners above** (chain is caps').
- **account**: a person's vault one acts as.
- **sees, acts for, acts through, may act on**: how devices and vaults relate (`Aven.ID.Query`).
- **statement**: a signed text: claim, sign-in, invite, join, withdrawal. **= envelope** in the tree's Doc (**A12**).
- **claim** (of the network): the first signup takes the network. **→ genesis** (**A11**); "claim" stays for tickets.
- **genesis** (new): the network's first signed envelope, naming its RP ID, origins, coop, agent, the Aven Peer's key
  and the guardian.
- **sign-in**: one more browser for the signing passkey's vault. **sign out**: forget this browser's key; the device
  stays until it is removed.
- **invite**: an admin passkey's assertion over a one-time key. **= ticket**. **one-time key = ticket key**.
- **withdrawal**: ends an unused invite. **= the ticket's revocation**.
- **join**: an invited browser founds a person's vault. **= claiming a ticket**.
- **member, `memberOf`**: a person's vault let in by invite; `memberOf` leaves out the claimant. **= in the network's
  group** (**A10**), which includes the admin coop's people.
- **admin, admin key**: the coop that owns the agent; a passkey owning a vault that governs the coop.
- **door**: admission at the relay, the handshake and the blob provider. **newcomer**: a browser carrying one
  acceptable statement. **allow-list → the network group's devices** (K12).
- **assertion, challenge, counter, RP ID, origin**: WebAuthn's parts.
- **MaiaCityGuardian**: the offline key that co-owns every person's vault during evaluation. ⚠ The README's "guardian
  vaults … after a delay" are **recovery owners**.
- **recovery owner**: an owner that can replace the others after a delay in which they can cancel.
- **fingerprint**: a vault's short, checkable id.
- **network**: four meanings today. **→ the members group under one genesis**. The agent is "the network's agent",
  a statement's `network` field names the genesis hash, and the Rust `Network` becomes `Genesis`.
- **agent**: a vault kind for software principals: LLM agents, Aven, the ontology's minting agent. Only this meaning.

## caps

- **cap, grant, holder, issuer**: a signed grant; target × verbs × branches inside it; who holds it; who signs it.
- **operation** (caps) **→ verb**: read, query, put, patch, remove, edit, tell, keep, share. ⚠ An operation is the
  engine's.
- **target**: one grammar shared with wants and query scope (**A8**).
- **footprint**: per lowered step: type, verb, fields and constraints.
- **condition**: `not_before`, `expires`, `approve`, `uses`, `budget`, `own`, `history`, and `lines` **→ `branches`**.
- **chain, root cap**: a cap and its parents; a cap resting on authority over the target's vault. The only "chain".
- **role**: a named bundle of grants, pinned by hash.
- **approval**: k owners' signatures over one act's digest, used once.
- **ticket**: a one-time key holding a cap until a vault claims it.
- **public:network**: every member of the network (D15, revised in #1492); `public:world` is gone.
- **revocation, ack, kept list, access map**: ends a cap and every cap on it; a writer's mark that it saw one; per
  Doc, the revoked holder's last envelope a revoker saw; a Doc's Records of the types `cap`, `revoke` and `epoch`.
- **letter, letterbox, tag seed, pair tag**: a sealed Value carrying a cap and keys; where a first letter goes; what
  finds a reader's stanza; a tag per pair of vaults.
- **group**: shared primitive. **keyring, vault key, group key**: a vault's Doc of keys; the X-Wing pair it holds;
  a group's pair.
- **epoch, key blob, stanza, tag, back, rotation**: one Doc key between rotations; its stanzas, commitment and back
  link; one reader's sealed copy; what finds it; the previous key sealed under the new one; a new epoch. ⚠ "epoch"
  only for keys.
- **commit** (of a key) **→ key commitment**. ⚠ A commit is one Loro commit, one envelope.
- **scheme**: `flat 1`, `tree 1` (the key tree); `public 1` is gone (#1492).
- **subkeys**: `avenDB envelope/segment/snapshot/fetch/topic/converge 1`; the snapshot subkey seals **checkpoints**.
- **convergence secret, file key**: an epoch's secret for files; keyed BLAKE3 of it and the plaintext.
- **keeper, keep cap**: shared primitive; the cap that lets a keeper hold a Doc's sealed bytes.
- **fetch key, fetch proof, upload proof**: per epoch; a signature over the connection's TLS exporter.
- **heal**: after a compromise, new device keys and rotations (D19).
- **run, run cap, standing cap, tell cap**: the causal chain of messages and the cap beside it; an actor's own cap for
  its declared duties; a cap naming messages.
- **router**: the receiving kernel's check of `tell`. ⚠ iroh's `Router` hands connections to protocols.
- **kernel**: holds keys for its actors and runs only what a message's cap names. ⚠ `aven/kernel/sandbox` is another
  thing.
- **safe** (D17, #1492): a vault's secrets in a Doc that opens only in a safe runtime.
- **padding**: Padmé on segments and files; live messages to 256 B, 1 KiB or 4 KiB (D18).
- **pseudonym**: the writer's Loro peer outside a segment; gone by D13. **→ writer id**, inside the seal.
- **split**: shared primitive.
- **reader**: what an epoch is sealed to, a vault or a group; "every reader checks every write" means the same
  readers.

## store

- **store, `Store`, blob**: shared primitives (a blob **= Value** at rest).
- **`Hash`**: BLAKE3. Bare hex in store paths; **`b3:<hex>`** in every text format.
- **ref, `RefName`**: shared primitive; 1 to 128 characters of `A-Za-z0-9._-`, at rest 64 hex digits and a newline.
- **reachability**: a blob is kept while a ref reaches it.
- **driver, backend, OpenDAL, opfs, adapter**: what a store runs on; the one module that answers iroh-blobs from our
  store.
- **hash sequence (`HashSeq`)**: a blob of hashes; the form a file takes.
- **chunk**: a file's piece of at most 1 MiB, every one but the last exactly 1 MiB. ⚠ bao and iroh-blobs' chunks are
  1 KiB: **bao chunks**.
- **file index → chunk list**. ⚠ An index is a query index.
- **file**: bytes, a name and a media type, stored as a hash sequence. **announcement (`file` line) → a file Record**
  from milestone 4.
- **outboard, bao group, seek, range**: bao's tree, made when needed and never kept; 16 KiB groups; a read of a range
  that fetches only the chunks it touches.
- **holder**: a peer holding a file's chunks.
- **file API**: `file_len`, `file_range`, `file_fetch`.
- **city-dome**: the members' one room; a Doc read by `public:network` (D15).
- **keep rule → a keep cap** from the city-dome's owners.
- **`Keeper`** (code): every peer's in-memory chat chains. **→ `Logs`**. ⚠ A keeper is caps'.
- **leader, follower, Web Lock**: the tab worker that holds the lock and runs the Peer-Light; the other tabs.
- **line** (chat): a signed chat blob. **= envelope** in the chat's log; a **`post` Record** from milestone 4.
- **chain** (chat) **→ log**.
- **head** (`chat-<device>`): a device's newest line, a ref.
- **fork** (chat) **→ split**.
- **catching up, frames** (`heads`, `catch_up`, `lines`), **page**: fetching what is missing; the messages of
  `aven/db/1`; at most 32 KiB of lines.
- **learned head**: a device waiting for the Aven Peer's view of its own head. **Retires** (rule 3).
- **loose lines, offline queue**: lines waiting for what they build on; writes waiting for a connection.
- **temp file, roll forward, sweep, marker** (`meta/version`): the opfs crash protocol and format version.
- **gate**: a time limit per browser engine. **provider gate → the door** at the blob provider. ⚠ The code's `Gate`
  is the door's set of keys: **→ `Door`**.
- **pack, pack record → pack entry, refs log, tombstone, compaction, torn tail**: the next opfs layout.
- **relay**: iroh's relay; every Peer-Light byte crosses one.
- **spike**: the measured choice of iroh-blobs over bao-tree.
- **Service Worker**: answers `/files/<hash>` from the leader.
- **room secret, convergent key, AEAD unit**: the parked sealing sketch. **Retires**; caps' epochs and file keys
  replace it.

## docs

- **Value, Doc, Record, root Record**: shared primitives; a Record that is a Doc of its own.
- **container**: a field's merge kind: text, list, movable list, map, tree, counter, value.
- **type, schema**: shared primitive; one version of a Record's shape.
- **`x-loro`, `x-link`**: the container a field uses; **`x-link` = link**.
- **lens**: two-way steps between two schema versions: add, rename, convert, in, wrap, unwrap, move, container.
  Universal (Samuel, 30 Oct 2026): a lens joins versions inside one type Doc or of two type Docs. A reader uses only
  the lenses pinned where it reads, and those form a forest ([A7](ARCHITECTURE.md#proposals-for-samuel)).
- **kept, unseen**: where a dropped field's data goes.
- **lane → vocabulary** (Samuel); largely retired by D8 and type Docs.
- **view**: an app's schema and lenses. **= the input of a view** (one meaning, shared with the engine).
- **fit, kin**: whether an envelope's changes fit the schemas it names; one kind or kinds a lens joins.
- **envelope, segment, genesis envelope**: shared primitives; a Doc's first envelope, whose hash is its id.
- **snapshot, checkpoint, head**: shared primitives.
- **peer** (Loro) **→ writer id**. ⚠ A Peer is a node.
- **counter range**: a writer's op counters in a segment; inside the seal (D13).
- **epoch** (a device's next peer) **→ generation** (Samuel): a device's fresh start after a split. ⚠ Epochs are
  keys.
- **line → branch**: **main**, **proposal**, **variant**; **draft** dropped. ⚠ The face's variant is an axis of
  a face.
- **version, frontier, version vector**: **= version**.
- **named version**: a Record `{name, at}` (D10).
- **merge, merge footprint**: a change building on both heads, plus the three-way fix-up; every type and field it
  changes.
- **restore → revert to; undo of an older change → back out**.
- **fork**: a new Doc started from a version, with its state and a link to its origin, without its history (D6).
  Only this meaning.
- **split**: shared primitive. **settle**: **retires** (**A4**: splits are final).
- **counts, verdicts** (fit, authorized, not split), **stuck peer**: an envelope counts when all three hold and its
  past counts; a writer id whose next ops would build on one that doesn't.
- **scratch copy**: a fork used to open a version.
- **partial** (an unverified snapshot) **→ unchecked**. ⚠ The engine's partial means not everything is held.

## engine

- **table, column**: a type's Records; `id`, `doc` and the fields. **= type**, read as rows.
- **address**: `<doc>/<id>`. A link's value.
- **fact, file Record**: a Record whose type is a predicate; a Record of type `file`.
- **operation, core operation**: shared primitive; `query`, `put`, `patch`, `remove`, `want`, and `edit` (**A19**).
- **plugin, plugin operation, lowering**: **plugin = runtime** whose output is core operations; an operation in its
  grammar; the pure map to core operations.
- **grammar, meta-grammar**: JSON Schema with `additionalProperties: false`; each operation carries its grammar's
  hash.
- **envelope** (an operation's) **→ call**: `{plugin, grammar, op, doc, params, body}`. ⚠ An envelope is docs'.
- **params, bind, cell, `ref n`, `when`**: values given at run time; cells the engine fills (`$actor`, `$vault`,
  `$device`, `$now`); the id an earlier `put` made; a condition that skips.
- **`$actor`, `$vault`, `$device`, `$now`**: the actor running the operation; the vault it acts for; the signer; the
  writer's time.
- **walk**: a bounded step over a link column, at most N hops.
- **slot id**: the id of an at-most-one trait, so concurrent writes meet on one key.
- **catalogue = vocabulary** (Samuel's word): a vault's names for Values (types, operations, runtimes, definitions);
  vault, then network, then built in.
- **want, target, window, follow, tier, signal, lifetime**: shared primitive and its parts. **part → depth** (`head`,
  `records`, `files`). Tiers are `now`, `next`, `later`, `idle`. A lifetime is `mounted` or `durable`, with the same
  meaning as an actor's.
- **durable want = keep. mounted want, open**: imported while shown or running.
- **loads**: an actor definition's wants. **manifest = loads**; retires.
- **device profile**: a Doc of the device's vault: `keep.tiers`, `bytes`, `files`, `also`.
- **given**: a turn's input: its time and seed, and the `now` tier as versions (**A17**).
- **composite**: an actor whose loads are its members' union. ⚠ Actors have no members field; avenACTORS decides.
- **scheduler → the want queue**. **scope = a query's target**.
- **footprint, bound**: what an operation reads and writes; the most work it may do, per operator (**A9**).
- **view, delta, live answer**: shared primitive; added, changed and removed rows; a subscription's pushes.
- **heads** (on answers) **= version**.
- **snapshot** (a reader's) **= snapshot**.
- **sealed** (closed into a segment) **→ closed**. ⚠ Sealed means encrypted.
- **status, phase**: `complete`, `partial` or `denied`, and connecting, catching up, live, offline or stalled.
- **pending write, overlay**: a local write shown until committed or refused.
- **the one writer → the committer**: the single task in each peer that applies changes. ⚠ A writer is a log's
  author.
- **catch-up, page, telling**: fetching by version; one page at a time; announcing a changed head.
- **live message → live envelope**. ⚠ A message is actors'.
- **line** (chat) **→ post**. **chain** (chat) **→ log**. **fork** (chat) **→ split**.
- **stall alarm**: raised when a step moves no version.
- **directory**: the index of a vault's Docs of one root type, by Doc id: sealed Values, with recent entries in a small
  Doc ([A26](ARCHITECTURE.md#a-handful-among-millions-sealed-indexes)).
- **index**: a derived map that must equal a scan: a device's own cache, or a **sealed index** its readers share, a
  search tree of sealed Values derived from a query's shape, kept current by folds, which are checkpoints (A26).
  **blind index**: tokens another peer could match; not used, since search is local
  ([A21](ARCHITECTURE.md#search-local-first)).
- **door, provider events, RBSR**: admission; iroh-blobs' hooks; range-based set reconciliation.
- **run, journal**: as in actors.

## ontology

- **fact, entity, referent**: `{id, p, x1…x5}`; what an id names; what a place points at.
- **predicate**: **= a type** of facts, with an English name, a gismu, a gloss and typed places.
- **place** (x1 to x5): a **value place** (closed types) or a **ref place → link place**.
- **gismu, gismu table, coined**: Lojban roots with place structures; 1341 typed; a predicate without one.
- **vocabulary**: a vault's named types, operations, runtimes and definitions (Samuel's word for lanes and the
  engine's catalogue). **category**: an entity standing for a kind of thing.
- **kind → type** (a type composed of traits). ⚠ "kind" stays only for vaults.
- **trait**: one predicate around an entity, at most one or many.
- **proposal**: a change to the network's vocabulary that the admin accepts. **= a proposal branch** of the
  vocabulary.
- **minting agent**: makes predicates. **= an agent vault** with devices of its own, never a device of a person's
  vault.
- **definition** (of a predicate) **→ gloss**. ⚠ A definition is an actor's.
- **shortlist, alignment lens**: candidate gismu chosen by a model; a lens across vocabularies. **= a lens** between
  two type Docs, now that lenses are universal (Samuel, 30 Oct 2026).

## actors

- **Value**: JSON only: null, bool, finite number, string, array, map. **= Value**.
- **part**: code or data in one format, for one runtime. ⚠ A want has a **depth**.
- **runtime**: shared primitive. Actors' runtimes are named after their job (Samuel, 30 Oct 2026): **state-runtime**
  (not json-runtime), **js-runtime** and **face-runtime**: one runtime draws a face from its data, `markup` and
  `style`, checking a11y across both (Samuel, 30 Oct 2026; it replaces view-, markup-, css- and style-runtime). There
  is no prolog-runtime. Their home is
  [`aven/runtimes`](../runtimes/README.md).
- **floor, fuel, shim, hostile parts**: the oldest runtime still run; work counted per instruction; the deterministic
  answer to clock and random calls; test parts that try to escape.
- **definition**: the class: `interface`, `machine`, `turn`, `faces`, `init`, `lifetime`, `replaces`, `loads`.
  **= a version of an actor type** (**A17**); **`replaces` = the version before**.
- **component**: a definition whose main part is its face: `props`, `events`, `slots`, `styling`, `a11y` and
  `markup` (not `view`).
- **actor, instance**: shared primitive; an instance is an actor.
- **face, face actor**: an actor's drawn view; a placed component instance with a mounted lifetime.
- **placing, placer, place, `$use`**: spawning by drawing; the face that places; where.
- **variant**: one axis of a face: meaning, shape, size. ⚠ docs' variant is a branch.
- **states** (eight): default, hover, focus, active, disabled, loading, error, selected. **→ interaction states**. ⚠
  An actor's state is its data.
- **brand, tokens**: styling as data.
- **address, home, id**: `<home>/<id>`. **→ a vault-scoped id with an incarnation counter; the home becomes routing**
  (**A17**).
- **actor Doc**: `def`, `state`, `journal`. **inbox Doc**: one sender's messages to one receiver. **→ one per pair of
  vaults**.
- **log, field**: shared primitive; a value replaced whole.
- **record** (a log entry) **→ entry**. ⚠ A Record is docs'.
- **writer** (a Doc's one author): **= writer**, a log's author.
- **message**: `kind, from, to, seq, name, payload, re, deadline, run, cap`. **tell, ask, reply, fail**.
- **seq**: per pair or per sender, to be decided.
- **turn, given, effects**: handling one message, a mutation of the actor's Doc; the inputs the kernel hands it; the
  messages it sends.
- **journal, journal entry**: **= the actor Doc's log; an entry is a turn's envelope** (K9).
- **state, phase, machine, transition**: the actor's data; the machine's current phase; a machine is data, a table of
  phases and transitions in the interface, checked by the kernel's admission checker, proven in Lean (Samuel, 30 Oct
  2026: no Prolog).
- **present, view model, node tree**: state to a view model to an allowlisted tree.
- **kernel, router, scheduler, clock** (`tick`, `at`): routing, laws, one turn per actor at a time, time. ⚠
  "scheduler" in the engine is the want queue.
- **applier, shadow root, person actor**: trusted page code that draws; each face's scope; the device's person, sender
  of every click.
- **spawn, retire**: create an actor by asking the kernel; end it.
- **door actors**: the model, store, HTTP, files and push. ⚠ The door is admission.
- **composite, skill**: an actor whose turn tells others; a product word for one.
- **describe**: the ask every actor answers, from its definition, its current phase and the asker's caps: its tool
  specs (Samuel, 30 Oct 2026).
- **tool**: a message from `describe` that the caller's caps allow. A model's tool list is a projection of `describe`
  and is never configured apart.
- **sends**: the messages a definition declares it may send; the kernel enforces them.
- **contracts** (requires, produces) **= interface types and `sends`**.
- **type id**: `<type Doc>/<schema hash>`, the address of a version Record in a type Doc, from version 1 on (Samuel,
  30 Oct 2026). It names a version everywhere: an envelope's `records`, a fact's `p`, an actor message's payload.
  Equal schema bytes in two type Docs are two type ids; type ids a lens path joins are compatible, in one type Doc or
  across two.
  Edges between actors are derived by type id, never by name or prose.
- **keeper, live delivery, `ack` frame, compaction**: a keeper holds an absent home's inboxes; point-to-point
  appends; a delivery mark (⚠ caps' ack); later.
- **trace, outcome, preview**: used but undefined. To define.
- **`$`, `$$`, `$each`, `$on`, `$use`, `$description`**: the markup grammar's keys.

## runtimes

[`aven/runtimes`](../runtimes/README.md), the one home of every runtime.

- **runtime name**: `<job>-runtime` for actors (above), `<format>-runtime` for files (**svg-runtime**,
  **markdown-runtime**, **text-runtime**, **csv-runtime**, **json-runtime**, **pdf-runtime**), and after its plugin for
  a plugin (**ontology-runtime**). One namespace.
- **version, hash, floor**: `svg-runtime@3`, the third frozen module; `b3:<hex>` of its bytes, which is what names the
  code; the oldest version still run.
- **manifest**: the append-only list of every frozen runtime: name, version, hash, floor, schemas, limits, users.
- **host** (`aven-runtimes-host`): loads a module by hash, refuses any import, meters fuel and memory, checks the
  schemas and the output's limits. ⚠ avenOS's page is "the host" in actors; this one is the runtime host.
- **freeze**: the reproducible build that names a module by its hash.
- **file runtime**: a runtime whose part is a file's bytes and whose input is a render's params.
- **registry, entry, decide, decision**: the one list of file types; one type's line in it; the function from a file's
  first bytes, size and claimed type to a decision: its type, how it shows, its limits, how it is served.
- **sniff, signature**: what the bytes say a file is; bytes at an offset that mark a type. ⚠ A claim is only what the
  sender says.
- **show**: `native` (the browser's own decoder), `runtime`, `frame` (PDF's viewer in a sandboxed frame, until
  pdf-runtime) or `download`.
- **files origin**: the origin that serves files and runs file runtimes, holding no secret (**A15**).
- **render, render cache**: a file runtime's output for one file and one set of params; kept on the device by
  (runtime hash, file hash, params hash), never synced.
- **node tree, allowlist**: the one output faces and file runtimes draw as DOM; the one list of elements, attributes
  and URL schemes it may hold.
- **drawer**: trusted host code that shows checked output: the tree drawer (**= the applier**), pixels, table, scene.
- **hostile corpus**: test files per runtime that try to escape, explode or flood, each with its exact failure.

## avenPEER, the products and the box

- **avenOS, avenPEER, avenDB, avenID, avenSANDBOX**: the app; the node; the database; identity; the box.
- **avenDB-old, v1**: `aven/db`; the whole old stack.
- **Peer, Aven Peer, Alice Peer, Peer-Light**: the native node; with its relay on, on the server; with it off; the
  core as wasm in a browser.
- **box, cast, check**: the image and containers; the fixed test setup; `bun run up --check`.
- **app**: a tile on avenOS's dashboard.
- **relay**: iroh's relay, members only.
- **gossip topic**: one per network today. **→ one per group** (K11).
- **presence** (`here`, `bye`): who is connected.
- **room → city-dome**.
- **wipe**: emptying a store; never in production.
- **lane** (iroh) **→ topology**: a NAT or UDP test setup in the box. ⚠ docs' lane retires.
- **record** (a peer's status, `first-start`) **→ status**, **first-start ref**.
- **`aven/db/1`, `Router`, `ProtocolHandler`, `after_handshake`**: our ALPN; iroh's dispatch and hook.

## Words with two meanings

Which part keeps each word.

| Word | Keeps it | The others become |
|---|---|---|
| line | nobody | branch (docs); envelope, then `post` (chat) |
| chain | caps | log (store, engine); the owners above (avenID) |
| fork | docs (a copy) | split (store, engine, Lean) |
| envelope | docs | call (engine) |
| operation | engine | verb (caps) |
| keep / keeper | engine (keep), caps (keeper) | `Logs` (code); keep cap (the store's rule) |
| part | actors | depth (wants) |
| head / heads | store, docs | version (engine) |
| ref | store | link (engine, ontology, `x-link`) |
| snapshot | docs (local) | checkpoint (what travels) |
| sealed | caps | closed (segments) |
| view | engine | markup (actors); input of a view (docs) |
| kind | avenID (vaults) | type (ontology, docs); `join` (engine) |
| record | docs and engine (`Record`) | entry (actors), pack entry, status |
| peer | avenPEER (`Peer`) | writer id (Loro) |
| writer | a log's author | the committer (the task) |
| epoch | caps | generation (docs) |
| partial | engine | unchecked (milestone-4 notes) |
| index | engine | chunk list (files), pack table |
| gate | the box's time limits | door (access); `Door` (code) |
| network | the members group | the agent; the genesis hash; `Genesis` |
| claim | caps (tickets) | genesis (the network) |
| member | the network's group | `member_of` stays a predicate |
| state | actors (data) | interaction states (faces) |
| scheduler | actors (turns) | the want queue (engine) |
| ack | caps | delivery mark (actors' frames) |
| router | caps (`tell` check) | iroh's `Router` keeps its name in code |
| lane | nobody | vocabulary (docs, ontology); topology (box) |
| commit | docs and engine | key commitment (caps) |
| definition | actors | gloss (ontology) |
| variant | docs (a branch) and actors (an axis of a face) | both stay, each in its own part |

## One thing, two names

| Names | Use |
|---|---|
| Value, blob | Value; a blob is a Value at rest |
| statement, line, envelope, journal entry | envelope |
| chain, segment run, journal, inbox entries | log |
| fork (equivocation), split | split |
| heads, frontier, version vector, version | version |
| loads, manifest, durable want, keep, mounted want, interest | want (keep = durable) |
| keeper, holder, the Aven Peer's keep rule | keeper (holder for a file's chunks) |
| type, schema family, table, predicate, kind, definition | type, with versions |
| catalogue, lane, vocabulary | vocabulary |
| plugin, runtime | runtime |
| invite, ticket; join, claiming a ticket | ticket; claim |
| member, `memberOf`, in the network's group | member of the network's group |
| ref (engine), ref place, `x-link`, address | link, whose value is an address |
| turn, mutation of the actor's Doc | turn |
| line (docs), branch, `lines` | branch |
| snapshot (travelling), checkpoint, signed tree head | checkpoint |
| room, city-dome, space | city-dome |
| catch-up by hash sequence, by frames | catch-up, by set reconciliation and blobs (K11) |
