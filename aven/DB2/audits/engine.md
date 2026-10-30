# Audit: avenDB's operations engine (`aven/DB2/db/engine/README.md`)

Audited at origin/main `2c1a9890` (30 Oct 2026, 18:54). The checkout's branch `claude/avendb-architect` is identical to it; the
local `main` ref is stale. This is a read-only audit: no repository file was changed.

**Refs.** ENG = `aven/DB2/db/engine/README.md` · ONT = `aven/DB2/db/ontology/README.md` · DOCS = `aven/DB2/db/docs/README.md` ·
CAPS = `aven/DB2/id/caps/README.md` · RM = `aven/DB2/README.md` · STORE = `aven/DB2/store/README.md` ·
E1 = `aven/DB2/db/research/E1-avendb-old-engine.md` · ACT and ACTR = `aven/actor/ARCHITECTURE.md` and `README.md`, which exist
**only on branch `origin/claude/vibrant-bohr-y20cy7`**, not on main. Severity: **Critical** breaks a core promise as written;
**High** must be settled before its milestone; **Medium**; **Low**.

## 1. Purpose and scope

The engine is avenDB's operations layer. It has one writer per peer and a fixed grammar of operations over Records (`query`, `put`, `patch`, `remove`, `want`). Plugins lower their own grammars to it, and the ontology is the first plugin. Sync and load are driven by **wants**. Answers are live deltas, and the engine owns the grammar, bound and footprint checks (ENG:3-11, 141-163, 202-212).
It is written for the old milestones 4 and 7, with caps from 3 (ENG:13). It sits on docs (Loro, envelopes, lenses) and the store (blobs and refs) (ENG:14-15) and declares itself fully decided (ENG:18-23).
The spec itself puts docs, the meaning of facts, caps, the actor kernel, the door, indexes and full-text search out of scope (ENG:566-571).

## 2. Primitives

| Primitive | Definition | Named by | Written by | Lives in |
|---|---|---|---|---|
| Record / table | One piece of a Doc, under a schema. All Records of one type form a table with columns `id`, `doc` and the type's fields (ENG:74-76, 179-195) | Address `<doc>/<id>`. The root Record is the Doc (ENG:180, 185) | Whoever writes the Doc: mutations, or container edits (ENG:424-427) | A Loro container inside its Doc (ENG:185-186) |
| Operation (core or plugin) | A JSON spec of work: a query, a mutation or a want. A plugin op means what its lowering does (ENG:81-83, 108-109) | BLAKE3 of its canonical JSON (D7, ENG:243-245). Caps name the *lowered* op's hash instead (CAPS:324) | People and agents (models), and the kind compiler (ENG:110-111, 448-451) | "A blob" in the store (ENG:243). The lowered form is a cache (ENG:238-239) |
| Operation envelope | `{plugin, grammar, op, doc, params, body}`. `bind` cells are filled by the engine (ENG:227-239) | Not named | The caller | Travels with the op |
| Query | Over tables: `where`, `join` (inner or left, backward only), `walk`, `group/having`, `order/limit/project` (ENG:384-405) | Op hash, plus a catalogue name (ENG:247-253) | As above | Runs on the device over the Docs it holds (ENG:417-420) |
| Mutation | Core ops applied as one commit to one Doc, all or nothing. The ontology's `assert/set/retract` lower to `put/patch/remove` (ENG:424-444) | Op hash | Page, actor or agent. The one writer commits it (ENG:333-335) | Its result is a docs envelope (ENG:335) |
| Want | Target (caps grammar, or a stored query plus a column), `part`, `window`, `follow` ≤3, `tier`, `by`, `lifetime`. It orders and never authorizes (ENG:86-87, 264-284) | Not named. `want` is also a core op (ENG:205) | Actors (loads), pages (mounted wants) and the device profile (`also`) (ENG:292-313) | Actor definition, profile Doc, page memory |
| Keep (durable want) | What a device keeps after nothing mounts it (ENG:88, 311-312, 322) | Not named | Derived: the profile's tiers × installed actors' loads, ∪ `also` (ENG:311-312) | The device's store |
| Open / mount (mounted want) | What is imported into views while a page shows it or a turn runs (ENG:88-89, 313, 321) | Not named | Page or kernel | Device memory |
| Manifest / loads | An actor's declared wants, in tiers. "No second manifest" (ENG:92, 114-115, 292-296) | Inside the actor definition's hash | The actor's author | The actor definition Value (ACT:195) |
| Device profile | `keep.tiers`, `bytes`, `files`, `also` (ENG:93, 298-306) | Doc id | The device's vault | A Doc of the device's own vault (ENG:298-299) |
| Scheduler | One list of Docs, ordered by tier and then by signal. A Doc not held is fetched; one held but closed is opened (ENG:318-323) | Not named | Engine core | Device |
| Catalogue | A vault Doc mapping names to op hashes. Lookup order: vault, then network, then core (ENG:94, 247-258) | Doc id; its entries by name | The vault, by proposal where the vault says so (ENG:256-257) | An ordinary synced Doc |
| Footprint | The Docs and types an op reads and writes (ENG:95). Caps' agreed version adds verbs, fields and constraints (CAPS:93, 305-326) | Computed from the lowering | Engine | Not stored |
| Bound | The most work an op may do: the product of its steps' Records, capped by `limit` and walk depth (ENG:96, 417-418) | Not named | Engine | Computed before the op runs |
| Plugin | Built-in Rust: a grammar (JSON Schema), checks, a pure lowering, a Lean model (ENG:84-85, 202-221, 512-513) | `name/major`, plus the grammar hash (ENG:233-235) | Engine developers | The engine's crate family |
| Kind operations | `<kind>.list`, `.create`, `.update` and `.delete`, compiled once when the kind is saved (ENG:139, 448-453) | Op hashes and catalogue names | The ontology plugin, on the saving device | Values, plus the catalogue |
| View, live query, delta | Rows stamped with heads. A subscription pushes added, changed and removed rows taken from the docs layer's diff (ENG:97, 133-136, 464-466) | Keyed by heads and code version (ENG:133) | Engine | Device cache; never synced (ENG:133) |
| Answer status | `complete`, `partial` or `denied`, plus the phase. Pending writes are laid over answers (ENG:457-469) | Not named | Engine | Inside each answer |
| The one writer | The single task per peer that applies local mutations and imported envelopes (ENG:98, 104-105, 327-338) | Not named | Not applicable | Each peer. RM places it in avenPEER (RM:68-69, 79) |
| Index (later), directory | Derived maps that must equal a scan and never sync. A vault **directory** Doc is kept by acts. No blind index by default (ENG:491-508) | Not named | Engine (index); mutations (directory) | Device; a vault Doc |
| Sync pieces | Live changes on gossip; segments and snapshots over iroh-blobs; catch-up by version, a page at a time; heads announced (ENG:342-357) | Blob hashes, topic ids | Writers, keepers, member peers | Store and network |

## 3. Glossary

(≈ near-synonym elsewhere in avenDB; ≠ the same word meaning something else elsewhere)

- **Value**: immutable bytes named by BLAKE3; a structured Value is canonical JSON (ENG:72-73; DOCS:37-39). ≈ the store's **blob**, and ENG itself says an op "is a blob" (ENG:243; RM:109).
- **Doc / document**: a mutable Loro document named by id, with a head over Values; the unit of sharing, sealing, caps, sync and atomic change (ENG:72-73; DOCS:40-44). The two words are used interchangeably (ENG:320, 351).
- **Record**: a piece of a Doc, addressed `<doc>/<id>`, always under a schema; the engine's only primitive (ENG:74-75, 106-107). ≠ the actor log's "record named (writer, seq)" (ACT:37, 83); ≈ avenDB-old's "entry" (E1:48).
- **root Record**: a Record that is a Doc of its own; its type decides (ENG:185-188; DOCS:105-108).
- **address**: `<doc>/<id>`; "a ref is always an address" (ENG:180-182). ≠ the store's and RM's **ref**, a named pointer changed by compare-and-set (RM:113; STORE:50). ≠ the ontology's in-Doc refs, which are bare fact ids (ONT:125).
- **type**: a named schema, itself a Doc whose versions are Values (ENG:76, 192). ≈ the docs layer's **schema** (one version) and the caps' **root type** (CAPS:90, 278). A **predicate** is a type (ONT:45-48).
- **table / column**: all Records of one type. Columns are `id` (the address), `doc` and the fields, read through lenses (ENG:76, 192-198).
- **fact**: a Record whose type is a predicate, `predicate(x1…x5)`, kept in a Doc's facts map (ENG:77-78; ONT:44, 113-120).
- **file (Record)**: type `file`, holding the index hash, size, name and media type. Its bytes are a hash sequence of chunks of at most 1 MiB (ENG:79-80; STORE:94).
- **operation**: a JSON spec of work: query, mutation or want (ENG:81). ≠ the caps' **operation**, a permission verb: `read`, `query`, `write`, `mutate`, `tell`, `keep`, `share` (CAPS:92, 133-134).
- **core operation**: `query`, `put`, `patch`, `remove`, `want` (ENG:205). ≈ the caps' verbs, which split `put` into `put-new` and `put-replace` (CAPS:310-312).
- **plugin operation / lowering**: an op written in a plugin's grammar; lowering is a pure map to core ops (ENG:82-83, 206). Caps name the **lowered hash** (CAPS:324).
- **plugin**: built-in Rust that adds a grammar, checks and a lowering (ENG:84-85, 214-216).
- **grammar / meta-grammar**: JSON Schema with `additionalProperties: false`; each op carries the grammar's hash (ENG:205, 233-235).
- **envelope (of an operation)**: `{plugin, grammar, op, doc, params, body}` (ENG:227-239). ≠ the docs layer's **envelope**, signed and sealed Loro changes (DOCS:53), which ENG also uses (ENG:104, 336, 473-475).
- **params / bind / cell / ref n / when**: values given at run time; `$actor`, `$vault` and `$now` are filled by the engine; `ref n` is the id an earlier `put` created; `when` skips an op (ENG:236-237, 440-442).
- **assert / set / retract**: the ontology verbs, lowered to `put`, `patch` and `remove` of fact Records (ENG:218-221, 439).
- **walk**: a bounded transitive step over a ref column, at most N hops; N is never given (ENG:403).
- **slot id**: the id for an at-most-one trait, so concurrent writes land on one key (ENG:443-444; ONT:57-58, 86-88).
- **kind**: the ontology's composition of predicates, compiled to four ops (ENG:448-453; ONT:54-55). ≠ the docs `kind` constant naming a schema family (DOCS:51, 177-178); ≠ "a kind of document", meaning a root type in wants (ENG:275); ≠ a join's `kind` (ENG:389); ≠ a vault's kind (RM:98).
- **catalogue**: a vault Doc mapping names to op hashes, looked up in the order vault, network, core (ENG:94, 247-258). ≈ the docs layer's **lane** and the ontology's **vocabulary** lanes (DOCS:62, 192-193; ONT:152-157).
- **want**: demand made of target, part, window, follow, tier, by and lifetime; it orders and never authorizes (ENG:86-87, 264-284). ≈ avenDB-old's **Interest** (E1:48-59); ≈ the actors' **loads** (ACTR:375).
- **target**: a Doc, a vault (optionally with `below`), a vault's Docs of one root type, or an actor; wants add `{query, column}` (ENG:274-275; CAPS:272-287). Same word in caps, but ENG lists four forms and caps lists seven. ENG never says **grant**; in caps a grant is target × operations × lines inside a cap (CAPS:203, 260), and ENG's "caps" means grants.
- **part / window / follow**: `head`, `records` or `files`; the newest *n* or everything; up to three ref hops (ENG:276-279). avenDB-old used "follow" for three different things (E1:190).
- **tier**: `now` (on screen, needed for a turn), `next`, `later`, `idle` (ENG:90-91).
- **by / signal**: the order inside a tier: viewport, playhead, camera or list position (ENG:280).
- **lifetime**: `mounted` or `durable` (ENG:281). ≠ the actor definition's `lifetime`, which says whether the actor persists (ACT:193).
- **durable want / keep**: what a device keeps for itself (ENG:88). ≠ the caps' **keep** operation, **keep cap** and **keeper**, which are blind retention for others (CAPS:117, 298, 601-607).
- **mounted want / open (load)**: imported into views while shown or running (ENG:88-89, 321).
- **loads / manifest**: the wants an actor definition declares; "an actor's manifest" (ENG:92, 114-115; ACT:195). The old name was "Manifest, v2" (E1:49).
- **device profile**: a Doc of the device's vault holding the kept tiers, bytes, file policy and `also` (ENG:93, 298-306).
- **given**: a turn's input; the `now` tier is handed in as `given` (ENG:315). ACT's `given` is time and seed, and is journaled (ACT:230-233, 276).
- **composite**: an actor whose loads are its members' union, capped by its tier (ENG:314, 549). ACT has no such concept (ACT:384; ACTR:374).
- **scheduler / scope**: one list of Docs ordered by tier, then signal. "Scope" is used but never defined in ENG (ENG:320-323); it comes from E1 (E1:67-70).
- **footprint**: the Docs and types an op reads and writes (ENG:95). ≠ the caps' footprint: types, verbs, fields and constraints (CAPS:93, 305-326).
- **bound**: the most work an op may do, computed before it runs (ENG:96, 417-418).
- **view**: a query's rows stamped with heads; a cache (ENG:97, 133). ≠ the docs layer's **view**, an app's schema plus lenses (DOCS:64), which ENG also uses (ENG:197-198, 334).
- **heads**: the versions answers and snapshots are stamped with (ENG:105, 460). ≠ the docs layer's **head**, a ref naming a version, snapshot and segments (DOCS:56); ≈ the docs **version** or frontier (DOCS:60); ≈ E1's head (E1:199).
- **snapshot (reader's)**: the immutable state pages and actors read (ENG:105). ≠ the docs layer's **snapshot**, a Value holding state and history (DOCS:55).
- **sealed**: means both encrypted (RM:169-170; CAPS:544) and closed into a segment (RM:172-173). ENG:342 uses both in one sentence: "not yet sealed… sealed messages".
- **delta / live answer**: row changes pushed from the docs diff (ENG:136, 464-466).
- **status / phase**: `complete`, `partial` or `denied`, plus connecting, catching up, live, offline or stalled (ENG:135, 461-462; RM:41-42). ≈ E1's coverage plus freshness (E1:110-112).
- **pending write / overlay**: a local write laid over answers until it is committed or refused (ENG:137-138, 468-469).
- **the one writer**: the single task per peer that changes data (ENG:98, 104-105). RM puts it in avenPEER (RM:68-69, 79).
- **segment**: a sealed batch of envelopes, a Value (DOCS:54; ENG:346). Under caps, a segment holds exactly one key epoch (CAPS:544-545).
- **catch-up / page**: fetching by version, one page of segments and envelopes at a time (ENG:131-132, 351-354).
- **telling**: announcing a changed head to the peers that may hold the Doc (ENG:356-357). ≈ E1's digests and holdings (E1:94-101).
- **live (gossip) message**: unsealed changes on a Doc's topic (ENG:342-344). ≠ the actors' **message** (`tell`, `ask`, `reply`, `fail`; ACT §4). ENG's "later tiers arrive as messages" (ENG:315) means `tell`s. ENG never uses `ask`, so it says nothing of how an ask's deadline meets an absent `now` tier (ACT:347).
- **fork**: two changes from one device, neither building on the other; it is raised, not merged (ENG:58, 130). ≈ the caps' and docs' **split** (CAPS:183-184, 455).
- **line**: main, a proposal, a variant or a draft (DOCS:58-59). The caps call it a **branch** (CAPS:336); ENG uses "lines" (ENG:256).
- **chain**: the chat's per-device chain of lines (ENG:359-362; STORE:133-153). ≠ the caps' **chain**, a cap and its parents (CAPS:96).
- **stall alarm**: raised when a step moves no version forward (ENG:131-132; RM:34-35).
- **directory**: a vault Doc listing its Docs, kept by acts (ENG:503-504, 564).
- **index / blind index**: derived maps (later) that must equal a scan; a blind index is keyed label tokens a host can match, refused by default (ENG:493-508; E1:113-114).
- **Aven Peer**: the server Peer with its relay on. In caps it is a **keeper** (RM:86; CAPS:117), a word ENG never uses.
- **door / provider events / RBSR**: the members-only gate; iroh-blobs' second gate; range-based set reconciliation, taken as a pattern (ENG:372, 375, 377).
- **run / run's caps**: the causal chain of messages, and the cap carried beside it (ENG:117; CAPS:378-382).
- **journal**: an actor's record of its turns. ENG quotes the actor law "same engine hash and same journal give the same state" (ENG:307-308; ACT:276, 354).

## 4. Rules and invariants (condensed)

- **One writer:** it applies local mutations and imported envelopes in turn. Readers use immutable snapshots stamped with heads and never wait on it (ENG:104-105, 327-338).
- **One primitive, one evaluator:** the engine handles Records only, each with an id and a schema. The core runs only core ops, and a plugin op means what its lowering does (ENG:106-109, 211-212, 524-526).
- **Ops are data:** everything asked of the engine is an op, grammar-checked before it is stored and before it runs. Models write ops, never code. Plugins are built-in code (ENG:110-113, 214-216, 512-513).
- **Ops are named by hash;** catalogues give them names, and a stored op is checked against its own grammar hash (ENG:233-235, 243-245, 527).
- **One want:** a durable want keeps, a mounted want opens, and one scheduler orders both. There is no second manifest (ENG:114-115, 318-323, 518-519).
- **A want grants nothing:** what is served is wants ∩ caps; what an actor is handed is its loads ∩ its run's caps (ENG:116-117, 283-284).
- **Wants come from definitions and bound slots, never from reading data;** a query-want runs only over data already held, and an unbound slot wants nothing (ENG:118-119, 284).
- **Tiers only order:** each Doc is fetched once, at its highest tier, and a new `now` goes first (ENG:120-121).
- **Actors declare, devices decide depth:** `now` is never optional, since a turn runs only when its `now` loads are present (ENG:298-316).
- **Bound and footprint come before running.** Over its bound, an op is refused with the bound in the answer; an op whose footprint the caps don't cover is refused; nothing fails halfway (ENG:122-123).
- **A mutation is one commit to one Doc,** all or nothing. An agent's removals are proposals that a person confirms (ENG:124-125, 532).
- **Sync** compares, then sends what is missing, never withholding or over-sending. Receiving is not reading. An envelope waits for what it builds on, and forks are raised. Catch-up only reads, and either progresses or stops with a stall alarm. Versions decide, not budgets (ENG:126-132, 533-534).
- **Views are caches** keyed by heads and code version. They never sync and never blank a screen (ENG:133-134).
- **Answers carry completeness and phase.** Live answers are deltas. Writes show at once and vanish without a trace if refused (ENG:135-138).
- **A kind compiles to ops once, when it is saved,** and Lean proves parity (ENG:139, 448-453).
- **D9:** docs checks envelopes (signer, chain, fit, write cap). The engine checks ops (grammar, bound, footprint), what is served, and what actors are handed (ENG:473-489).
- **D10:** indexes come later and may only make a query faster. Nothing derived syncs, and there is no blind index by default (ENG:493-508).
- **iroh before our own:** gossip, blobs and irpc, but not iroh-docs (ENG:366-380).

## 5. Trust model

- **Who runs what.** Queries and mutations run in the device's engine (a Peer, or a Peer-Light in a browser), over the Docs it holds and that the run's caps let it open (ENG:417-420). The one writer lowers, checks and commits mutations (ENG:333-335). Actors hold no keys: their kernel opens the loads and runs only the ops that the message's cap names (CAPS:376-384).
- **Who checks.** Every reader re-checks every imported envelope. The docs layer checks signer, chain, fit and write cap; the engine checks the footprint (ENG:477-486; CAPS:141-143, 432-446).
- **Who sees.** Reading is per Doc: the key is the read right (CAPS:137-138). ENG's caps below a Doc are sets of types and narrow **writes** only (ENG:488-489). Narrower reads exist only for actors, and only an honest kernel enforces them (CAPS:357, 362-363).
- **What is served.** ENG says "wants ∩ caps" (ENG:485). That holds at a peer that reads the Doc. A blind keeper serves on fetch proofs instead (CAPS:609-611, 788-791), and ENG never mentions fetch proofs.

Flags. Each is a place where a server-like peer holds a privilege no owner granted, or where the design needs plaintext at a server:

- **F1 [High]** ENG says one actor "runs on a phone, a Mac and the Aven Peer alike" (ENG:288-289). A turn needs the keys to the actor's Doc and to every `now` load (CAPS:383), so the Aven Peer would read plaintext. That contradicts ENG:128-129 ("The Aven Peer is such a peer for everything not published") and RM:199. Caps concedes that "actors at home on the Aven Peer are readable there" (CAPS:388-389, 845). ENG names no grant; the owner would have to issue an explicit read cap to Aven's vault for each actor and each load target.
- **F2 [Medium]** Caps lets a holder without `read` have "a kernel or serving peer that holds the key" run its named queries (CAPS:144-145, 294, 357). That peer reads plaintext, and the natural host is the always-on Aven Peer. ENG has no remote-query protocol, although caps proposed one to it (CAPS:854).
- **F3 [Medium]** Open question 1 asks whether the Aven Peer serves catch-up first (ENG:559). That is routing, not authority, but it would make one operator the default observer of every device's access pattern.
- **F4 [Medium, transitional]** Today the Aven Peer keeps every city-dome line and file as plain bytes (STORE:19, 118-121), and fetches are gated by membership only (STORE:250; ENG:375). This is a privilege by fiat, and ENG cites it as its model (ENG:343). Rule 13's "sending nothing it may not" (ENG:126-127) holds only once sealing and fetch proofs exist.
- **F5 [Medium]** The keeper stores and serves without any write check (CAPS:172-174). Any holder of a fetch key, which means any reader (and, before fetch proofs, any member), can append junk segments that the keeper will serve. Readers discard them (CAPS:141-143) but still pay to fetch them, and the keeper's split detection (CAPS:175-178) can be polluted.
- **F6 [High, context]** MaiaCityGuardian is an owner of every person's vault, and keyrings are sealed to it (CAPS:666-671). Through the evaluation phase, one server-held key can read everything. It is owner-granted in form only.
- **F7 [Medium]** The keeper sees the vault tree, every fetch and, with per-Doc gossip (ENG:342-343), every topic join: in effect, which device reads which Doc (CAPS:769, 774-777). Caps nonetheless lists "who reads which Doc" as hidden (CAPS:769).
- **F8 [Medium]** Views are keyed only by heads and code version (ENG:133). A view built under a wide run cap could then answer a narrower run, which defeats actors' read narrowing by query (CAPS:357), unless the key includes the run's cap scope.

## 6. E2EE and privacy

- **Queries** never leave the device in ENG (ENG:417-420). Live answers and overlays are local too (ENG:464-469). The one exception is the caps' remote `query` (F2).
- **Wants** keep their target, part, window, tier and signal on the device; only per-Doc requests leave it.
  - A member peer that reads the Doc sees Doc ids and versions (ENG:351-353). It is a reader already, so that is fine.
  - The **keeper** sees more:
    - Doc ids.
    - The device's version per Doc, written as writer pseudonyms and counters (CAPS:175-178).
    - Fetch proofs, which tie a device key to each Doc (CAPS:609).
    - The order and timing of requests. Tiers make this "what is on screen now", because `now` is asked first (ENG:120-121).
    - The sequence of `follow` hops, which traces the ref graph between Docs.
    - File index and chunk hashes and the ranges asked for, i.e. which part of a movie is played (STORE:94-98, 124-129).
    - The gossip topics joined (ENG:342-343; CAPS:554-555).
- **Indexes.** None syncs, and there is no blind or keyed index by default (ENG:502-508). A directory is a sealed Doc. That protects confidentiality; the price is no search on a server and every device indexing everything it keeps (§7).
- **Keyed constructs** live in caps, not in ENG: topic ids from `avenDB topic 1`, stanza tags and convergent file keys (CAPS:537-555, 515-517).
- **Hash-named Values [Medium-High].** ENG says an op "is a blob named by the BLAKE3 hash of its canonical JSON" (ENG:243). Schemas, predicates, kinds and actor definitions are Values too (DOCS:37-39).
  - If private Values rest as blobs under their plaintext hash, the keeper can read them, and it can confirm a guess: hash a known `invoice.list` and watch who fetches it.
  - The same op in two vaults has one hash, which links the vaults; ontology dedup works this way by design (ONT:145-146).
  - Neither ENG nor DOCS says how a private Value is sealed while its plaintext hash stays its avenDB id.
- **Type targets either leak or don't resolve.** The keeper can't see types (CAPS:769), so a `{vault, type}` want must be resolved to Doc ids on the device, and that needs the directory, which comes later (ENG:503-504). The alternative is a keeper that serves "every Doc of group G" from keep caps naming groups (CAPS:604). That reveals which Docs share a root-type group, because each root type has its own group (CAPS:495-498).
- **Shared files [Medium].** Sharing a file into another Doc copies its Record and key, never its bytes (CAPS:553). But a keeper serves bytes only against the owning Doc's current fetch key (CAPS:609-611). So readers of the second Doc can't fetch the file from a keeper, unless file blobs get a different gate. This is unresolved, and `part: files` depends on it.
- **What the keeper must know to serve a want:**
  - the Doc id, which the device resolves;
  - the current epoch's fetch-key public half, sent by letter from the writer who rotated (CAPS:604-605);
  - each segment's header: the Doc, the epoch, the writer's pseudonym and counter range, the previous segment and the padded length (CAPS:175-178);
  - the topic ids (CAPS:606);
  - the quota and who pays for it (CAPS:607);
  - blob hashes, for files.
  It never needs a type, a query, the meaning of a part, a window or a tier. It also cannot apply a window blind (§7).

## 7. Sync and performance

**How wants decide what is fetched.**
1. Durable wants are the profile's tiers × installed actors' loads, ∪ `also`. Mounted wants come from pages and running turns (ENG:311-313).
2. Targets resolve to Docs. Doc targets are direct. Vault and type targets: unspecified. Query targets run over held data (ENG:118-119). `follow` hops run once records arrive (ENG:279).
3. One list of Docs, ordered by tier and then signal, each Doc at its highest tier (ENG:120-121, 320).
4. A Doc not held is fetched by catch-up, by version, a page at a time (ENG:351-354). A Doc held but closed is opened (ENG:321). Changes arrive live on gossip, and new heads are announced (ENG:342-357).
5. Serving is gated by caps at a peer that reads the Doc, and by fetch proofs at a keeper (CAPS:788-791).

**Scale.**
- **Millions of Records [High].** D2 keeps lines and facts inside their root Doc (ENG:186-188). Every Record is a Loro container (ENG:185-186). Snapshots are full, history included (DOCS:24, 237-238). So a long chat or a coop's books is one Loro Doc, and reading any Record means fetching and holding its whole state and history. `window: {newest: 50}` (ENG:278) can't shrink that. Without a snapshot to start from, envelopes past the window wait forever for what they build on (ENG:130). This repeats E1's "long logs come whole" (E1:144-145, 187), and ENG's open question 5 defers it (ENG:563).
- **Many Docs per device.** The caps' target is 100,000 Docs (CAPS:805). Each Doc costs a head ref, key blobs per epoch, a fetch proof, a gossip topic ("one topic per Doc", CAPS:817) and a page-by-page catch-up dialogue (ENG:351-354). RBSR appears only "as a pattern" (ENG:377). Without batching across Docs, a cold device pays at least one round trip per Doc per page.
- **Terabytes.** Files are hash sequences of 1 MiB chunks (STORE:94). They are fetched by the store's file API on a seek (STORE:124-129), outside the scheduler. `part: files` is all or nothing per Doc, "by schema field or media type" (ENG:276-277). The profile's `bytes` (ENG:302) has no rule for what goes when it is exceeded.
- **Many devices.** Every device decrypts and indexes everything it keeps, because nothing derived is shared, by design (ENG:502-504). Every device pulls from the keeper, and there is one keeper for now (CAPS:815). A Peer-Light's bytes all cross the relay (STORE:130-131).
- **Queries across Docs.** "Each step scans the Records of its table in the documents it ranges over" (ENG:419-420). With no scope clause, that is every held Doc, opened and decrypted, until indexes come (D10).

**Query bounds [Medium].** ENG's bound is "the product of the Records each step can read, capped by `limit` and walk depth" (ENG:417-418). Five problems:
1. It is pessimistic. Two tables of 10,000 rows give a bound of 10⁸, so ordinary joins are refused, or the default is set so high it means nothing; the default is undecided (ENG:560).
2. It is unsound as a work bound. With `order` plus `limit`, `group/having`, or the anti-join `isnull` (ENG:389-393), everything must be scanned before the limit applies.
3. It needs a row count per table per Doc, which is an index, and D10 puts indexes later.
4. It depends on the device. The same stored op is accepted on a phone and refused on a Mac that holds more data, so an actor behaves differently by where it runs.
5. Wants are operations too (ENG:81, 205) but carry no bound: `{vault, below: true}` with `window: everything` and `part: files` has no limit at all.

**Bottlenecks.**
- **The one writer** serializes decryption, signatures, fit, footprint, the E3 re-lowering at the envelope's base, the Loro import and the commit (ENG:333-337). Local writes get no priority over imports, and no import step has a maximum size; E1's "writes go first in the queue" (E1:88-90) was lost. Immutable reader snapshots of Loro Docs cost a fork per commit unless readers only ever read views. On an Aven Peer that hosts actors, one writer serves them all.
- **Live queries without indexes.** "Recomputes the rows those Records can touch" (ENG:465) needs reverse maps from changed Records to output rows, for joins and aggregates. Without them, every head change is a re-scan.
- **Gossip:** one topic per Doc across 10⁵ Docs (open question 3, ENG:561).
- **The directory:** every creation writes it (ENG:503-504), so it is a hot Doc that keeps growing, with every big-Doc problem above.

**Can wants be the mechanism that prioritises what to sync? Yes, as the single demand signal.** The shape is right:
- demand is kept apart from authority (ENG:116-117);
- wants are declared by definitions and can be computed without fetching (ENG:118);
- they are aggregated per device into one ordered queue for both fetching and opening (ENG:320-321);
- tiers can't change what is served (ENG:120).

As specified, though, it is a priority list of Docs, not a sync scheduler. Missing:
1. **A unit finer than a Doc**: (Doc, part, window or range). Rule 9's "each document once, at the highest tier" contradicts the spec's own loads, which want the same Docs' `head` at `next` and their `records` at `idle` (ENG:293-295). Read literally, the records come at `next`.
2. **Priority inheritance through prerequisites**: key blob, then epoch key, then fetch key, then head, then records, then follow targets, then files. Without it, a `now` want can stall behind an `idle` key-blob fetch.
3. **Preemption and fairness**: yield between pages and chunks (E1:64-65), interleave scopes within a tier (E1:70), and stop the durable tiers starving.
4. **Budgets**: bytes per tier, an eviction order, metered and battery modes, and a GC seam, since refs are what keep blobs (STORE:51).
5. **Resolution of vault and type targets** through a directory. A query-want also needs an implicit want on its source Docs; otherwise rule 8 yields nothing on a fresh device.
6. **A fixpoint** for query-wants and `follow`, with a progress measure and fan-out bounds.
7. **Batching**: RBSR across many Docs over (Doc, version digest), and many segments per page as one hash sequence, as the chat already does (STORE:149-150).
8. **Source choice**: own devices and the LAN, other readers, the keeper; several holders at once (STORE:130). This is ENG's open question 1.
9. **An upload lane**: a device's own unsealed changes and segments pushed to keepers first. Wants cover pulling only.
10. **Windows a blind keeper can serve**: checkpoints, or Docs split into chunks.
11. **Signal handling**: coalesce updates and define the order key; camera and playhead change every frame.
12. **Two kinds of `now`**: the screen's, and a background turn's (ENG:90-91).

## 8. Seams

**Store.**
- ENG uses the store's blobs and refs, a new `size` method, hash sequences, and iroh-blobs through the adapter (ENG:346-349; STORE:44-54, 89-105). These agree.
- Ownership of the gate is unclear. ENG's iroh table claims the provider gate (ENG:375); STORE says `aven/PEER` owns iroh-blobs' networking and the gate (STORE:40-41, 250).
- "What keeps a blob: a ref reaching it" (STORE:51). ENG never says who sets or drops refs when a durable want is withdrawn or a mounted one ends (ENG:322).
- The chat's catch-up already fetches the missing lines as one hash sequence (STORE:149-150), while ENG's catch-up goes page by page, per Doc (ENG:351-354).

**Docs.**
- **[High] Contradiction on snapshots.**
  - ENG moves snapshots over iroh-blobs (ENG:346).
  - DOCS says the engine moves envelopes, segments, snapshots and heads (DOCS:121-123, 223-224), yet leaves "each device's own cache, or shared?" open (DOCS:263).
  - CAPS records the docs thread agreeing that "snapshots and heads are each device's own and never travel", with signed checkpoints in milestone 7 (CAPS:841).
  - ENG never mentions checkpoints. Both catch-up cost and windows hinge on this.
- The D9 split is consistent: docs checks signer, peer, dependencies, fit and the write cap (DOCS:143-152); the engine checks ops and footprints (ENG:477-486).
- Text, list and tree edits "go through the docs layer's containers" (ENG:426), outside the engine's ops, bounds and footprints.
- Full snapshots are a decision (DOCS:24, 237-238), and they conflict with windows (ENG:278).
- Shared homonyms: envelope, view, head, snapshot, sealed (§3).

**Caps.**
- **[High] Agreed but not adopted.** Caps agreed with the engine thread on footprints with verbs, fields and constraints (E1, E2), and on envelopes that carry the op hash and params so readers re-lower on import (E3) (CAPS:305-326, 446, 893-897). ENG's footprint is still "documents, and inside them types" (ENG:95, 488-489), and its import check is still the diff's footprint only (ENG:336-337, 484).
- **One op, two hashes.** Catalogues and actor definitions use the op's own hash (ENG:243-245); caps use the lowered hash (CAPS:324). ENG treats the lowered form as a cache keyed by the plugin's version (ENG:238-239), so a plugin upgrade changes it.
- `query` without `read` (CAPS:144-145, 854) has no counterpart in ENG.
- Fetch proofs, keep caps, epochs and keepers are absent from ENG: none of the words "keeper", "epoch" or "keep cap" appears. ENG's "served is wants ∩ caps" (ENG:485) is false at a keeper, which can't read caps (CAPS:172-174, 609-611).
- **Keeping is two mechanisms.** A device keeps by want and profile; a keeper keeps by keep cap (CAPS:794-795). D3's "one concept" (ENG:518-519) holds per device, not across the system.
- **Broken references.**
  - ENG:474 cites caps "rule 8" for caps being checked twice. Caps' rule 8 is "Write needs read" (CAPS:139-140); the double check is caps' table of checks (CAPS:464-473).
  - ENG:53, 474 and 570 cite `aven/ID/caps/README.md`, which isn't on main; the spec is at `aven/DB2/id/caps/README.md`.
- **Targets:** ENG lists four forms (ENG:274-275); caps lists seven, including the actor targets (CAPS:275-281).

**Actors** (on the branch only).
- ENG cites `aven/actor/*` (ENG:51-53, 316, 570), which is not on main.
- **Composites [Low-Medium].** ENG defines a composite's loads as its members' union and has Lean prove it (ENG:314, 549). ACT says a composite has "no members field, no merge law" (ACT:384; ACTR:374).
- **[High] `given` and journals.**
  - The `now` tier is handed in as `given` (ENG:315; ACT:195), and later tiers "arrive as messages" (ENG:315-316).
  - ACT journals `given` and every handled message whole (ACT:58-60, 233, 276).
  - So loaded data is copied into the actor's Doc on every turn. That costs size, and it opens a path across principals: Bob's run hands Bob's room into an actor at home in Alice's vault, and Alice reads that actor's journal.
  - If only heads are journaled instead, replay "anywhere" (ACT:354) needs those versions and their keys.
- **Where an actor runs.** ENG: "one actor runs on a phone, a Mac and the Aven Peer alike" (ENG:288-289). ACT: "an actor lives on one peer, its home" (ACT:373).
- **Waiting.** A turn runs only with its `now` loads (ENG:308-309), but in ACT "a turn never waits" and asks time out after 30 s (ACT:347). Offline, an ask times out instead of getting a `partial` answer.

**Ontology.**
- **One data model or two [Medium].** ONT's decision 1 says "a fact grammar, not documents of JSON… Records with fields are easier at first and harder forever" (ONT:250-253), and its rule 1 says "no other fact shape exists" (ONT:66-67). ENG's D2 makes Records with fields (pages, lines, settings) equal citizens (ENG:171-177, 514-517).
- **Refs.** ONT uses bare fact ids inside a Doc (ONT:118-120, 125). ENG says "a ref is always an address" and joins `x2` against `id`, which is the address (ENG:182, 193, 389-390). Without normalising one to the other, those joins fail.
- **Stale text.** ONT still gives the engine "the index", and its worked example says "the index changes" (ONT:104, 243, 316), though D10 defers indexes. ONT puts the store at `db/store` (ONT:107); it moved to `aven/DB2/store` (STORE:38-40).
- A kind's `delete` takes its nested elements with it (ENG:450). If those are root Docs, the delete spans several Docs, so it is not one mutation (ENG:124).

**README and avenPEER.**
- **Where the one writer sits.** RM puts it in avenPEER, above avenDB (RM:63-70, 79). ENG's diagram puts it in the engine's core, with avenPEER below the store (ENG:149, 157-158).
- ENG says "each layer knows only the one below it" (ENG:161), yet its sync drives iroh-gossip and irpc directly (ENG:342-377).
- ENG's milestone numbers (ENG:13, 359-362, 484, 563) point at a list that was removed from RM (RM:225; commit `05ba9e5d`).
- E1's lesson "digests to the peers that may hold the log, not over gossip" (E1:96-97, 239-240) is listed as taken (ENG:58), yet heads travel on gossip (ENG:373). That is acceptable only because topics are derived from keys (CAPS:554-555), and ENG doesn't say so.

## 9. Strengths

1. Authority and demand are kept apart, and Lean proves it: a want grants nothing, and what is served is wants ∩ caps (ENG:116-117; CAPS:179-180, 918).
2. One demand concept replaces Interests, keep shares, copy settings and follow lists, and one scheduler orders both fetching and opening (ENG:320-322, 518-519).
3. Ops are data checked against fixed grammars, and models never write code. Plugins are built in, so no untrusted code runs inside the writer (ENG:110-113, 214-216).
4. There is one core evaluator, so bounds, footprints, caps and deltas are worked out and proven once, and a plugin can't get them wrong (ENG:211-212, 524-526).
5. With Records as the only unit, caps below a Doc can be stated as types, and facts, pages and files all join the same way (ENG:179-183, 488-489).
6. Naming ops by hash lets caps and actor versions pin exactly what runs (ENG:243-245; CAPS:324).
7. Each named avenDB-old failure (ENG:62-68; E1:154-165) has a fix: answers carry completeness and phase, pages get deltas instead of re-querying, and writes show first and vanish cleanly when refused (ENG:135-138, 457-469).
8. Catch-up goes by version, with a progress measure and a stall alarm instead of budgets and timers (ENG:131-132, 533).
9. Nothing derived syncs, and there is no blind index by default. That removes the trust and leakage surface E1 documented (ENG:500-508).
10. Devices choose depth, so actor definitions don't vary by device and their hashes stay stable (D5, ENG:306-309).
11. It reuses hardened iroh pieces and refuses iroh-docs' last-writer-wins table (ENG:366-380).
12. Lean comes first, with vectors for ops, queries, mutations, wants, sync, plugins and kinds (ENG:538-555).

## 10. Weaknesses, gaps, risks, contradictions, over-complexity

- **W1 [High] Snapshots contradict across three specs, so catch-up may start from genesis.**
  - The specs: ENG:346 has snapshots travel; CAPS:841 says they never do; DOCS:263 leaves it open.
  - Why it matters: if snapshots never travel and checkpoints wait for milestone 7, a new device in milestone 4 replays every envelope since the Doc's birth. That is avenDB-old's failure: 10.5–24 s per 130,000 edits, and 313 s to unlock (E1:158).
  - Fix: signed checkpoints that travel, decided before milestone 4.
- **W2 [High] Big Docs come whole, and windows can't be built.**
  - Collections live inside root Docs (ENG:186-188), snapshots are full (DOCS:24), and a window can't shrink a Loro state (ENG:278).
  - Fix: build windows on checkpoints plus segments, and add a rule for splitting unbounded collections into root Docs (a chat by period, books by year).
- **W3 [High] Queries have no scope.**
  - There is no `over` clause (ENG:384-405), and "the documents it ranges over" is never defined (ENG:419-420).
  - So answers depend on how deep this device keeps (D5), `complete` (ENG:461) means nothing, the "documents" half of a footprint (ENG:95) can't be known before the query runs, and every scan covers every held Doc.
  - Fix: a target in the caps' grammar; `complete` means every Doc of the target is held; the target is also an implicit want.
- **W4 [High] The scheduler works on whole Docs, and rule 9 contradicts the spec's own loads** (ENG:120-121 against ENG:293-295).
  - Fix: key the queue by (Doc, part, window or range), give each key its own tier, and pass priority on to prerequisites.
- **W5 [High] Vault and type targets can't be resolved in the milestone that ships them.**
  - They need a directory, which is deferred with indexes and still an open question (ENG:503-504, 564).
  - The keeper can't see types (CAPS:769), and updating the directory isn't atomic with creating the Doc (ENG:124, 532).
  - Fix: specify directory Docs now, per vault and root type, kept by the creating act and repairable from held Docs.
- **W6 [High] Actors on the Aven Peer need plaintext** (F1; ENG:288-289 against ENG:128-129 and RM:199).
  - Fix: state where actors may live, and require an explicit read cap to Aven for each hosted actor and each load target, shown to the owner.
- **W7 [High] Loaded data is copied into actors' journals** (ENG:315-316; ACT:58-60, 233, 276).
  - The cost is size, plus the cross-principal leak in §8.
  - Fix: journal (Doc, heads, query hash) instead of data; replay re-reads under the original run's caps.
- **W8 [High] The caps' E1–E3 are missing from ENG, and re-lowering is not deterministic.**
  - The specs: ENG:95, 336-337, 437 and 484 against CAPS:305-326 and 446.
  - Three things make "the change is exactly what it produces" uncheckable:
    - `put` takes fresh ids (ENG:437);
    - `where` is evaluated against the writer's state, so checking needs a checkout at the envelope's base;
    - plugin upgrades change the lowered hash (ENG:238-239).
  - Readers on different engine versions then disagree, against `readers_agree` (CAPS:911).
  - Fix: freeze each lowering per (plugin major, grammar hash), have the envelope carry the lowered hash, and derive ids from (writer peer, counter, op index).
- **W9 [Medium-High] Container edits sit outside the operation model** (ENG:426), though typing in the editor is the most common write.
  - Rules 1, 4 and 10 (ENG:104, 110, 122) don't hold for these edits, and caps falls back on "core verbs over types" (CAPS:302-303) that ENG never defines for text, lists and trees.
  - Fix: a core `edit` op over a container path, with a verb and a footprint.
- **W10 [Medium-High] Private Values are named by their plaintext hash** (ENG:243; §6).
  - Fix: the plaintext hash is the id only inside a seal; blobs at rest are sealed and fetched through their Doc.
- **W11 [Medium-High] Gossip per Doc doesn't scale and leaks** (ENG:561; CAPS:817; F7).
  - It doesn't scale to 10⁵ Docs, and it tells the Aven Peer who reads what.
  - Fix: topics per group plus RBSR on reconnect, or name the leak.
- **W12 [Medium] The bound model** (§7) is unsound for `order`, `group` and anti-joins, too pessimistic for joins, needs row counts, and depends on the device.
  - Fix: a cost per operator (hash join, top-k) and bounds taken from directory counts.
- **W13 [Medium] Live answers without indexes mean a re-scan per head change** (ENG:465, 493-496). Rule 19 then holds only at the page boundary.
  - Fix: build reverse maps from (type, ref column) to rows together with live queries, not "later".
- **W14 [Medium] The view cache key leaves out the lane, params and run caps.** ENG keys views by heads and code version only (ENG:133), while RM:38-39 says "keyed by its inputs" (see F8).
- **W15 [Medium] The one writer limits throughput and latency** (§7).
  - Fix: run the pure checks outside the writer, import in bounded steps, put local writes first, and have readers read views rather than Docs.
- **W16 [Medium] Durability is decided in three places, with no eviction or GC rule.**
  - The three places: a want's `lifetime` (ENG:281), the profile's tiers (ENG:302, 311-312) and keep caps (CAPS:794-795). STORE:51 adds GC by reachability, with no seam to the engine.
  - Fix: drop `lifetime` from loads, or say which wins, and specify the eviction order.
- **W17 [Medium] Rule 8 contradicts itself.** Query-wants and `follow` do read held data (ENG:118-119, 279). There is no termination rule, no fan-out bound, and no implicit want on a query's sources; E1 named exactly this failure (E1:183-184).
- **W18 [Medium] Tier `now` mixes the screen and background turns** (ENG:90-91, 308-309).
  - A background agent's turn can go ahead of the screen.
  - Offline, a turn whose `now` loads are missing never runs, and asks to that actor time out (ACT:347).
- **W19 [Medium] There are two data models: facts, and Records with fields** (ONT:250-253 against ENG:514-517).
  - An invoice can be a kind of facts (ONT:180-188) or a root Doc holding line Records (ENG:186-188), and kinds cover only facts (ENG:528).
  - This is over-complex; the specs should say when each applies.
- **W20 [Medium] Pinning by hash cascades.**
  - Ops pin predicate versions (ENG:228-230), kinds compile once (ENG:139), and caps pin lowered hashes (CAPS:324).
  - A new predicate version therefore means recompiled kinds, new catalogue entries and re-issued caps (as with roles, CAPS:341-344), and nobody is named to do it.
- **W21 [Medium] Creating a Doc is not specified.**
  - Missing: which op creates a root Doc, who makes its key, how it is sealed to its type's group (CAPS:495-500), and how its vault and root type are fixed at birth (CAPS:841).
  - Its directory entry is a second Doc, so creation spans two Docs, against D11.
- **W22 [Medium] Keepers accept writes unchecked, and shared files can't be fetched** (F5; §6).
- **W23 [Low-Medium] Refs need normalising, and table identity is unclear.**
  - Bare ids (ONT:125) against addresses (ENG:182).
  - Tables are named "by hash" (ENG:396), but a type is a Doc (ENG:76) whose versions are joined by lenses within a lane (DOCS:191-196). So the same query reads different tables in vaults with different lanes.
- **W24 [Low-Medium] Homonyms across the specs.**
  - The words: operation, envelope, view, kind (five meanings), head, snapshot, sealed, lifetime, message, keep, footprint, chain, ref (§3).
  - Parallel threads implement these specs, so each homonym is a likely divergence.
  - Fix: one glossary shared by all the specs.
- **W25 [Low] Composite loads contradict the actor spec** (ENG:314, 549 against ACT:384).
- **W26 [Low] References are broken, and the status claims too much.**
  - Paths: `aven/ID/caps` (ENG:53, 474, 570) and `aven/actor`, which isn't on main.
  - Numbers: caps "rule 8" (ENG:474), and milestone numbers whose list is gone (ENG:13).
  - "Nothing here is still a proposal" (ENG:23), while caps' proposals to ENG are unadopted (CAPS:854) and decisions 11–12 name no decider (ENG:532-534).
- **W27 [Low] The layering contradicts RM and STORE** (§8).
- **W28 [Low] `aven/db/1` runs on irpc 0.17** (ENG:376). Under rule 9's "no fallbacks" (RM:44-45), every breaking irpc release becomes a flag day for the whole network.
- **W29 [Low] Rule 12 never says what "removes data" means.** `put` of a whole Record, `patch` to empty and deleting text all remove data, but only `remove` goes to proposals through the caps' `lines` condition (CAPS:336).
- **W30 [Low] The stall alarm fires on legitimate waits.**
  - Progress means "moves a version forward" (ENG:131-132).
  - Envelopes waiting for a key, a cap or what they build on move nothing (CAPS:183-184; ENG:130).
- **W31 [Low] "Atomic per Doc" covers one commit, not isolation.**
  - Concurrent commits merge field by field: slot-id upserts into mergeable containers (DOCS:77-78) can leave a `one` fact that neither writer wrote.
  - The theorem that exactly one fact remains (ONT:303) still holds.

## 11. Open questions

1. Do snapshots travel, or do signed checkpoints? Who signs them, under which epoch, and from which milestone? (W1)
2. What is a query's scope, and what does `complete` mean for it? (W3)
3. Is the scheduler keyed by (Doc, part, window or range)? Does file priority (the playhead) live in wants or in the store's file API? (W4)
4. How does `{vault, type}` resolve to Doc ids? Is the directory per vault, per type or per group, and which op keeps it? (W5)
5. Which peers may host actors? Is hosting on the Aven Peer an explicit read grant, per actor and per load? (W6)
6. Are loads journaled as data or as (Doc, heads)? How does a replay get the keys? (W7)
7. Which hash does an envelope carry: the op's, the lowered op's, or both? Is a lowering frozen per grammar hash? How are new ids made? (W8)
8. How are text, list and tree edits expressed, bounded and footprinted? (W9)
9. How is a private Value sealed while its plaintext hash stays its id? (W10)
10. How fine are gossip topics, and what may the Aven Peer learn from topic membership compared with fetch proofs? (W11)
11. What is the bound formula, and what is the default? May refusals differ by device? (W12)
12. In what order are things evicted under `bytes`, and who drops refs when wants go? (W16)
13. Is a `want` an operation with a bound and a footprint (rule 10), given that caps say "`want` needs no cap" (CAPS:303)?
14. Is there a remote `query` protocol for holders without `read` (CAPS:144-145)?
15. How does a want ask for a line other than main, such as a proposal or a variant? The want grammar has no line field (ENG:264-284; DOCS:58-59).
16. How do kinds that span Docs (a `delete` of nested root Docs) fit one-Doc mutations (ENG:450 against ENG:124)?
17. Where do local writes stand against imports in the writer's queue, and how large may one import step be? (W15)
