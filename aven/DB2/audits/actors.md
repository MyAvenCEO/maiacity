# Audit: avenACTOR's architecture (`aven/actor/ARCHITECTURE.md`)

## 1. Purpose and scope

This audit checks the actor engine's single source of truth (layers 0–7, laws 1–12, §11 "later") against its discovery notes and against avenDB's engine, caps, docs and store specs, as of 30 Oct 2026.
It reviews documents only. No actor code exists yet (R:3-5) and nothing was run (R:45), so every performance figure below is an estimate that still has to be measured.
Version 1 (a standalone todo app, in memory) is judged as version 1. §11 is judged on whether v1's interfaces survive it, as A:8-10 and A:366 promise.

**Refs.** `A:n` = `aven/actor/ARCHITECTURE.md`, branch `claude/vibrant-bohr-y20cy7`, line numbers from the audit copy. The branch's newer commit `6f99f9f2` changes only §13 and §15: the package gets its own Cargo workspace and depends on no storage backend. `R:n` = `aven/actor/README.md`.
`E:n` = `aven/DB2/db/engine/README.md`, `C:n` = `aven/DB2/id/caps/README.md`, `D:n` = `aven/DB2/db/docs/README.md`, `S:n` = `aven/DB2/store/README.md`, `DB:n` = `aven/DB2/README.md`.

## 2. Primitives

| Primitive | What it is | Named by | Written by | Lives in |
|---|---|---|---|---|
| Value | Immutable JSON: null, bool, finite number, string, array, map with string keys (A:46-48) | BLAKE3 of its canonical bytes, 64 lowercase hex (A:49-51) | Anyone; never changes | Memory in v1; a blob later (DB:109) |
| Part | Code or data in one format, for one runtime (A:197-198) | Hash | Its author; only the repo in v1 | Inside a definition |
| Runtime | A pure `run(part, input) → output`, frozen as wasm. It has no host imports, has fuel and memory limits, schemas for its input and output, and a floor (A:130-151) | `<format>-runtime`, a version and a hash (A:150, A:427) | The repo, after review (A:143-146) | `aven/actor/runtimes/*` (A:400); runs inside the kernel's wasmi (A:147) |
| Definition | The class: `interface`, `machine`, `turn`, `faces`, `init`, `lifetime`, `replaces`, `loads`. A component adds `props`, `events`, `slots`, `view`, `styling`, `a11y` (A:184-195, A:209-217) | Hash (A:184) | Authors; v1 spawns only definitions from the repo (A:280, A:432) | The repo (A:402-403); its name sits in the actor Doc's `def` (A:65) |
| Actor (instance) | A live definition: an address and an actor Doc (A:200) | `<home>/<id>`, where id = H(definition name, spawner address, spawner count) (A:200-201) | The kernel spawns it on an ask (A:279) | Its home, one peer (A:373) |
| Face actor | A placed component instance with a `mounted` lifetime (A:203-207) | Derived from its placer, its place and the `$each` key (A:220-221) | The kernel, on the first draw (A:220) | Memory of the placer's home |
| Address | `<home>/<id>`; later the home is an iroh EndpointId (A:111, A:373) | — | The kernel | In messages, in actor states and in cap targets (C:279) |
| Actor Doc | `def`, `state` (with the journal entry it follows) and `journal` (A:63-67) | `<home>/<id>` | Only the actor's home kernel (A:64) | Memory (A:94); one avenDB Doc later (A:370) |
| Inbox Doc | A `log` of the messages from one sender to one receiver (A:69-70) | `<sender> → <receiver>` | Only the sender's home kernel (A:69) | Memory; later a Doc of the sender's vault that the receiver's vault reads (A:370, A:375; C:386-387) |
| Log / field | An append-only list whose entries are `(writer, seq)`, or a value the writer replaces whole (A:81-86) | `(writer, seq)` | The Doc's one writer | Inside a Doc |
| Message | `kind, from, to, seq, name, payload, re, deadline, run`, plus `cap` later (A:108-117, A:375) | `(from, seq)` (A:112) | The sender's kernel (effects), the applier (clicks), the clock, the router (fails) | The inbox log; whole in the receiver's journal (A:59-60) |
| tell / ask / reply / fail | No answer expected / an answer by a deadline (30 s default, at most 10 min) / the answer / `timeout`, `refused` or `error` (A:101-106, A:116) | — | Turns send tell, ask and reply; the kernel and clock send fail (A:255, A:260) | — |
| Turn | `turn(state, message, given) → {state', effects, phase'?}` (A:230) | Its journal entry | The runtime computes; the kernel checks and commits (A:262-274) | The journal |
| given | The turn's time and seed; later also the `now` tier of its loads (A:233, A:195) | — | The kernel and clock | The journal entry (A:270) |
| Journal entry | The message (whole per A:67, by name per A:276), state hashes before and after, given, effects, fuel, outcome | `(writer, seq)` | The home kernel | The actor Doc's log |
| State / phase | The actor's data, set whole after each turn; the phase is the machine's current state (A:66, A:189) | A hash in each entry | The kernel, from the turn's output | The `state` field. Where the phase is kept is not specified |
| Machine | Fact-only Prolog: `state/1`, `initial/1`, `transition/3` (A:235-247) | Part hash | The author | The definition; checked by prolog-runtime (A:159) |
| Face | A `present` function plus a view-runtime part and a css-runtime part (A:191, A:298-304) | Its name in the definition | The author | The definition; drawn into a shadow root (A:309) |
| Kernel | Router, scheduler, turns and clock: pure Rust, no I/O, wasm in a worker (A:251-260). Also the `kernel` actor that spawns (A:279, A:331) | `kernel` | The repo | A page worker (A:295); native in tests |
| Router | Appends to inbox Docs; answers an unknown receiver or a bad payload with a fail (A:254-255) | — | — | The kernel |
| Scheduler | One turn per actor at a time, different actors in parallel, oldest arrival first across senders (A:256-257) | — | — | The kernel |
| Clock | The only source of time: `tick`, `at` and the fails for overdue asks (A:259-260) | `clock` actor (A:332) | — | The kernel |
| Applier | Trusted page code: checks node trees again, writes shadow roots, turns `$on` events into tells (A:296, A:313-320) | — | The repo | The page's main thread |
| Person actor | The device's person, sender of every click (A:317, A:330, A:441) | Built in | The applier | One per device |
| Run | The causal chain: every effect carries the run of the message its turn handled (A:117) | Not specified | The kernel | A message field |
| Cap field (later) | The cap a message acts under; a turn's effects carry it or a narrower one (A:375; C:378-382) | Cap hash (C:236) | The kernel | A message field |
| Lifetime | `durable` (persists later) or `mounted` (goes when unplaced) (A:193) | — | The definition | The definition |
| Loads (later) | Wants in tiers; the `now` tier is handed into `given` (A:195, A:372; E:92) | — | The definition | The definition |
| replaces | The definition this one upgrades (A:194) | Hash | The author | The definition |

## 3. Glossary

- **actor**: an addressable unit with a mailbox, a live instance of a definition (A:200). The same word means maiaCITY's rigged people and animals (R:11-12).
- **definition**: the immutable class, a Value (A:184). Same idea as avenOS's manifest and avenVIBES's `ActorDef` (R:416-418). **Near-synonym** of avenDB's **type**, a schema Doc whose versions are Values (E:76).
- **instance**: another word for actor (A:200). **component**: a definition whose main part is its face (A:203-205).
- **face / face actor**: an actor's drawn view (A:191) / a placed component instance with a `mounted` lifetime (A:205-206).
- **placing, placer, place, `$use`**: spawning by drawing; the face that does the placing; the spot it places into (A:219-222).
- **props / events / slots**: what the placer passes in (the first state, then `props` tells) / messages the component sends out, wired by the placer / child faces (A:213-215).
- **variant**: one axis of a face: meaning, shape, size (A:171-172). **Homonym** of docs' **variant**, a proposal line that stays open (D:58-59).
- **states (eight)**: default, hover, focus, active, disabled, loading, error, selected (A:173-176). **Homonym** of an actor's **state**.
- **brand, tokens**: styling as data (A:179-180). **part**: content in a format, for a runtime (A:197). **Homonym** of the engine want's `part` (head, records or files; E:276).
- **view / styling / a11y**: a face's view-runtime part / its css-runtime part / its accessible names and roles (A:216). **Homonyms**: the engine's view is a query's cached rows (E:97); docs' view is an app's schema plus its lenses (D:64).
- **present → view model → node tree**: state goes through js- or json-runtime to a view model, then through view-runtime to an allowlisted node tree (A:298-304).
- **preview**: an entry point of js-runtime that is **never defined** (A:158).
- **runtime, `<format>-runtime`**: a frozen, pure wasm function, named after its format (A:130-134, A:427). **Near-synonym** of the engine's **plugin**: both are repo-only code that interprets a grammar, but plugins are built-in Rust (E:84, E:214).
- **json-, js-, prolog-, view-, css-runtime**: the five runtimes of v1 (A:155-161).
- **floor**: the lowest runtime version still run; a part naming an older version runs on the floor (A:145-146).
- **fuel**: a work budget, counted per wasm instruction (A:147-149). **shim**: the kernel's deterministic answer to an engine's clock and random calls (A:138-140).
- **hostile parts**: test parts that try to get out, run too long or blow up (A:414-415).
- **interface**: the messages an actor accepts, with payload schemas (and a reply schema for asks) (A:188).
- **machine / transition / phase**: a fact-only Prolog state machine / `transition(Message, From, To)` / its current state (A:235-247). The `state/1` facts call phases "states". avenDB uses **phase** for sync status (DB:41-42).
- **turn**: handling one message (A:227-233). **Near-synonym** of the engine's **mutation**, one atomic commit to one Doc (E:124), and of avenOS's `reduce` (R:101).
- **given / effects**: the inputs the kernel hands a turn / the messages a turn sends (A:230-233).
- **init**: the first state (A:192). It also appears in `spawn {def, init}` (A:279), and a component's `props` are its first state (A:213). Which wins is not stated.
- **lifetime durable / mounted**: (A:193). The engine uses the same words for a want's lifetime (E:88-89, E:281), a different object.
- **replaces**: the upgrade link (A:194). **loads**: the definition's wants, in tiers (A:195). **Synonym** of an engine **want** that an actor declares (E:92; C:226).
- **message**: a Value of one of four kinds (A:99-117). **Near-synonym** of docs' **envelope**, the signed and sealed unit of change (D:53). avenOS called its messages "envelopes" (R:143, R:370).
- **tell / ask / reply / fail**: (A:101-106). **seq**: "the sender's count" (A:112), also "counts the writer's entries from 1" (A:83).
- **name, payload, re, deadline**: (A:113-116). **run**: a message's causal chain (A:117). **Homonyms**: `run(part, input)` (A:133); caps' run caps (C:229); avenOS's runner runs (R:145).
- **cap field / standing cap / tell cap**: later (A:375; C:297, C:378-382, C:419).
- **address, home, id**: `<home>/<id>`; the peer an actor lives on; the derived id (A:111, A:200-201, A:373). avenDB has no "home"; the nearest term is Peer or device (DB:121-123).
- **spawn / retire**: create an actor by asking the kernel / end it (A:279, A:193, A:221).
- **actor Doc / inbox Doc**: (A:63-71). **Doc** here means "one writer each" (A:37, A:58). avenDB's **Doc** is a multi-writer Loro document (D:40-43; C:813).
- **writer**: the one author of a Doc (A:58). **Homonym** of avenDB's **the one writer**, the single task in each peer that applies every change (DB:125, E:98).
- **log**: an append-only list in a Doc (A:83). It is neither docs' **line** (a branch, D:58) nor the store's chat **line** (a signed blob, S:140).
- **record** (lowercase): a log entry named `(writer, seq)` (A:37, A:83). "One actor, one record" means the actor's whole history (A:351). **Homonym** of avenDB's **Record**, named by its own id `<doc>/<id>` and always under a schema (D:48-50).
- **field**: a Doc value replaced whole (A:86). **journal / journal entry**: the record of each turn (A:67, A:276).
- **trace**: "every trace" is kept (A:91); **undefined**. **outcome**: a journal field (A:276); its values are **undefined**.
- **kernel / router / scheduler / clock**: (A:251-260). "kernel" is also the name of `aven/kernel/sandbox` (R:43, R:229). **tick / at**: clock messages (A:259); how an actor subscribes to them is not specified.
- **host / applier / shadow root**: the page / its trusted DOM writer / the scope each face renders into (A:295-311). **person actor**: (A:317, A:441).
- **door actors**: the model, store, HTTP, files and push, "the only holders of effects in the real world" (R:360; A:386).
- **composite / skill**: an actor whose turn tells other actors / a product word for one (A:384). **keeper**: a peer that holds the inboxes of an absent home (A:373), the same as caps' keeper (C:117).
- **live delivery, `message` and `ack` frames**: point-to-point appends on `aven/db/1`, sent ahead of sync (A:374), as JSON lines (A:431). **compaction**: later (A:376).
- **name (hash)**: 64 lowercase hex (A:50). avenDB writes `b3:…` (E:228, C:246). **canonical bytes**: sorted keys, one spelling per number, UTF-8 (A:49). This must be the very function avenDB uses (D:37-39), or the hashes split.
- **`$`, `$$`, `$each`, `$on`, `$use`, `$description`**: the view grammar's keys, and documentation at any depth (A:160, A:217, A:219). **Aven.Actor**: the Lean model and its vectors (A:397, A:408-412).

**Against avenDB's terms**

| avenDB term | Actor counterpart | Verdict |
|---|---|---|
| store **blob** (S:48), **ref** (DB:113) | A Value at rest; no head or ref named | Blob: the same later. Ref: missing; actor Docs will need heads |
| store **chain**, one per device (S:137-147) | The inbox Doc's log | Near-synonym. A:76 claims "the same shape", but an inbox is per actor pair and is a Loro list, not hash-linked blobs |
| docs **Value** (D:37) | Value | Narrower: JSON only, no raw bytes |
| docs **Doc** (D:40) | Actor Doc and inbox Doc | The same container; "one writer each" is a restriction on the actor side |
| docs **Record** (D:48) | None; "record" means a log entry | Homonym. Journal entries, state and inbox entries are not modelled as Records under schemas (D:102) |
| docs **envelope**, **segment** (D:53-54) | A message rides inside one or more envelopes | Two layers that each carry a `cap` (C:841 vs A:375) |
| docs **branch / line** (D:58; C:336) | None | Missing: an agent's removals go to proposal lines (E:125) |
| docs **version** (D:60) | A runtime's `v`, the floor | Homonym |
| engine **operation**, **mutation**, **footprint** (E:81, E:124, E:95) | A turn's commit; no effect issues an operation | Mutation ≈ turn commit. Operation and footprint are missing for whatever a turn writes outside its own Doc |
| engine **query** (E:382-394) | None; only the `now` loads in `given` | A turn cannot query |
| engine **want**, **plugin** (E:86, E:84) | loads; runtime | Synonym; near-synonym |
| caps **grant**, **tell cap** (C:260, C:297) | "granted", tell cap (A:375) | The same, but the rule for upgrades differs (§8) |
| caps **holder** (C:89, C:124) | An actor's "standing cap" (A:375) | Conflict: actors are not holders |
| caps **vault** (DB:96) | Absent from A | Missing: no actor names the vault that owns it |

**Concepts duplicated across the two designs**
- **Journal vs. Doc history.** In docs, the envelopes are the truth (D:79). Here the journal is the truth (A:354; R:347), and the `state` field is derived state that still syncs, which goes against E:133 and DB:38. An actor Doc keeps history three times: the journal, the Loro history of `state`, and the envelopes.
- **Inbox vs. per-device chain, and vs. Loro's own per-peer oplog.** A single-writer Loro Doc already is a log, so the inbox list logs the same thing twice.
- **Message vs. envelope.** Each has its own `cap` and its own check (the router's and the docs layer's).
- **Definition + `replaces` vs. a type Doc with versions and lenses** (E:76; D:83-85). How state migrates on an upgrade is not specified, and lenses already solve it.
- **Turn vs. mutation.** There are three update grammars: json-runtime's set, merge, append and remove **by path** (A:157), the core's put, patch and remove (E:205), and the ontology's assert, set and retract. The json-runtime one uses paths, which avenDB rules out for Records (E:179-183).
- **Actor per entity vs. Records in a Doc.** A task becomes a root Doc (A:333-334, A:370). avenDB puts a task's facts inside a Doc, because only roots pay for a head, a key, caps and a catch-up (D:105-108; E:384-394).
- **Loads vs. wants**: one concept, which is good. But the engine's composite members (E:314) have no counterpart on the actor side (A:384).
- **Runtime vs. plugin**, and **Prolog machine facts vs. the ontology's facts** (E:77-78): two fact languages.

## 4. Rules and laws, condensed

1. **Only messages.** Nothing reads or writes another actor's Doc (A:343).
2. **One door.** Every message, clicks and the clock included, goes through the router into an inbox (A:344-345).
3. **One turn at a time** per actor; different actors run in parallel (A:346).
4. **No waiting.** Asks never block; answers and timeouts come back as later messages (A:347, A:282-291).
5. **Pure turns.** Turns are deterministic and do no I/O; time and seed come in `given` (A:348-349).
6. **Every ask is answered once,** by its deadline: 30 s by default, at most 10 min (A:350, A:116).
7. **One actor, one record.** One Doc holds the definition, the state and every turn with its message whole. Every Doc has one writer, inbox Docs are per pair, and everything is kept (A:351-353).
8. **The journal is the truth.** Replaying it on the same runtimes gives the same state (A:354).
9. **Runtimes compute; the host only draws.** Runtimes import nothing that reaches the host and come only from the repo (A:355-356, A:136-141).
10. **Laws are code,** checked by the kernel, never by prompts or by reading a part's source (A:357).
11. **Commit, then send.** State and journal entry go in one write; effects are sent from the entry, sent again after a crash, and dropped as duplicates by `(from, seq)` (A:358-360).
12. **One primitive.** A component is a definition, a placed one is a face actor, and its lifetime decides whether it persists (A:361-362).

Beside the laws:
- **Order** holds per sender→receiver pair. Across senders, the receiver's journal fixes the order (A:124-126).
- **Machines gate messages.** A message is refused unless `transition(msg, phase, To)` exists, and the new phase must be that `To` (A:246-247).
- **Schemas are checked** on payloads and on runtime input and output (A:150, A:255, A:266).
- **Faces**: placements are checked, and a face sees only its own state and props. Variants are axes; there are eight states with fixed selectors; custom properties are scoped; components size by container queries; the only media query is `prefers-reduced-motion`; the brand is data and no raw CSS is accepted (A:169-180).
- **The applier** checks every node, attribute and URL scheme again, adds no script, and receives only deltas (A:315-320).
- **v1**: any local actor may spawn, but only definitions from the repo (A:280); one person actor per device (A:441).
- **Later**:
  - one home per actor;
  - a `cap` field on every message; effects carry the handled cap or a narrower one, and the standing cap is used only for duties the definition declares;
  - tell caps by message name, pinned by the definition's hash, and they follow a `replaces` upgrade while the named messages keep their schema (A:373-375).

## 5. Trust model

| Party | Trusted for | Bounded by | Finding |
|---|---|---|---|
| Kernel | Routing, laws, scheduling, commits. Later it holds the vault's keys and caps for all its actors (A:375; C:383) | Its device cap, by default "all its vault may do except govern" (C:81, C:369-370) | **Privileged, and not bounded per actor by caps.** Separating actors is kernel bookkeeping. A kernel bug, or a misassigned "standing cap", hands an actor the device's whole authority |
| Runtimes | Being correct sandboxes for untrusted parts | The wasm boundary, wasmi's fuel and memory limits, no imports (A:136-149) | Two walls: QuickJS inside wasmi. The root of trust is whoever can merge to the repo (A:143); no signed runtime list or reproducible-build check is named |
| Parts and actors | Nothing | Runtimes, schemas, machines; later tell caps and run caps | v1 runs only repo definitions (A:280); later "anyone" (R:27). Who may spawn or upgrade is not specified (W13, W14) |
| Built-in `kernel`, `clock`, `person` (A:330-332) | Spawning, time, the person's voice | Nothing is stated | **Privileged, with no caps.** `spawn` creates actors whose owner and caps are not specified. The router's clock decides when a tell cap expires (C:332). Every click carries the person's authority |
| Door actors (R:360) | Effects in the real world | Not specified | Privileged by role, with no cap story yet |
| Page and applier | Writing the DOM; turning real events into person tells (A:315-319) | Its own allowlist, checked again | **A single point of failure on the page origin.** An XSS through the applier reaches the origin where a Peer-Light keeps its device secrets (C:967-968). URL destinations are not checked (W10) |
| Person | The root of every run that starts with a click; later the run's cap starts from the person (C:379) | Signing in on the device | One person actor per device (A:441), so a shared device mixes people up. A click carries the person's cap into the face actor clicked, which may be a third party's |
| Other vaults | Appending to inbox Docs they own (C:386) | The receiver's router checks tell caps (C:297, C:358) | A never says that a sender's identity comes from the inbox Doc's signer and never from `from` (cf. R:202-203). Inside a home, an actor-level `from` is only as good as that home's kernel |
| Aven Peer as keeper | Holding sealed inboxes for absent homes (A:373) | The blind keeper's rules (C:172-174, C:601-612) | It sees which pairs talk (§6) |
| Aven Peer as home | Running always-on actors | Only the choice to host there (C:388-389) | **It reads hosted actors' Docs, their inbound inboxes and their loads, and signs their writes** (C:845). A never mentions this, and it contradicts DB:199. It can drop, reorder or delay messages. Replay catches a forged turn only once journals pin everything (W3) |

**Privileged components not bounded by caps:**
1. The kernel, because authority per actor is local policy.
2. Actors' "standing caps". They have no holder in the caps model (C:124), so whoever configures the kernel decides them.
3. The built-in `kernel` (spawn), `clock` and `person` actors, and later the door actors.
4. The applier on the page origin.
5. The Aven Peer wherever it is an actor's home.
6. The repository, as the supply chain of every runtime and of floor raises (A:143-146).

## 6. E2EE and privacy

- **What a home reads.** An actor's home reads:
  - the actor Doc;
  - every inbox Doc addressed to the actor, which it must read;
  - the actor's own outbound inbox Docs;
  - the `now` tier, which the kernel opens with keys the actor never holds (C:792-793).

  The home is a device holding its vault's keyring, so it can read everything that vault reads, not just the actor's Docs. When the home is the Aven Peer, all of that for the hosted actors is readable on the server (C:388-389, C:845). A says nothing about it.
- **What keepers see.** For an inbox Doc they see:
  - its id, epochs, padded size, times;
  - the device that uploads and the device that fetches;
  - the writer's pseudonym and counter ranges (C:769).

  With one inbox Doc per actor pair, every Doc is an **edge of the communication graph**: who messages whom, roughly how often (counter ranges), and when. Access patterns are already the largest leak (C:777-779). Per-pair Docs make it worse.
- **Doc ids give away type and location.** If an avenDB Doc's id is the actor address `<home>/<id>` (A:64), the keeper learns the hosting EndpointId of every Doc. Because id = H(definition, spawner, count) (A:200-201), anyone who knows a public definition and a spawner's address can enumerate and recognise its actors. That breaks "learns no … type" (C:172-174). Keyed or random Doc ids are needed.
- **Addresses leak the device.** An address carries the home's device key (A:373). Every message, every stored address (the list holds its tasks' addresses, A:333) and every cap target (C:279) links an actor to a device that relays see together with IP addresses (C:768).
- **Exfiltration through rendering (HIGH).** A face's view or CSS can carry `https://` URLs to any host. The applier checks only the scheme (A:315-316). A turn that was handed private loads can encode them into an image URL or a link. maiaCITY's runtimes had a first wall, "a policy that allows no connection" (R:384-386); the shadow-root path in the page has none.
- **Declassification through `given`.** `given` is journaled (A:233, A:270) and will carry the `now` tier (A:195). Data sealed for the readers of Doc X is then copied into the actor Doc, sealed for its readers.
- **Retention.** "Everything is kept" (A:91, A:353): every message whole, every turn, and every keystroke a face actor turns into a message (A:206-207). Forgetting is an owner's act in avenDB (D:237). A sets no policy for keystroke journals (A:371).
- **Frames.** "JSON lines" (A:431) must carry the sealed envelope, not plaintext. Through a relay, the relay sees both device keys, the timing and the volume (C:768).

## 7. Sync and performance

- **What one message costs later.** The sender's turn commits its journal entry, with the effect inside it (envelope 1). The router appends to the inbox Doc (envelope 2), which syncs or goes as a live frame. The receiver checks it, runs its turn, journals the message whole and replaces `state` whole (envelope 3). So one payload is stored **three times** (A:67, A:70, A:59-60), each copy with its own Ed25519 signature and AEAD overhead.
- **Inbox Docs grow with the pairs, not the actors.** In the worst case that is N(N−1); in practice it is N × out-degree. In the UI it is about two or three per face actor (person→face, face→placer, placer→face).

  Rough fixed cost per inbox Doc at rest:

  | Item | Size | Ref |
  |---|---|---|
  | Key blob | about 2.3 KB (two X-Wing stanzas of 1,120 B each) | C:493, C:757 |
  | One segment's ML-DSA-65 signature | 3.3 KB | C:758 |
  | Total | **about 6 KB per Doc before its first message** | |

  Beyond that, each inbox Doc has its own head, catch-up entry, keep cap and, per C:817, gossip topic.

  For example, 1,000 actors with 20 peers each make 20,000 inbox Docs and about 120 MB of fixed overhead. Multiplexing by vault pair would cut that to a few thousand Docs at most.
- **Journal growth is quadratic for growing state.** State is replaced whole on every turn (A:86) and Loro keeps every value (D:237).

  For example, a list of K task addresses at about 130 B each writes about 130·K²/2 bytes of history. That is about 65 MB at K = 1,000 and about 6.5 GB at K = 10,000.

  A 1 Hz `tick` to 100 actors is 8.6 M journal entries a day, all kept.
- **Compaction** is deferred (A:376). Forgetting history is an owner's act that closes lines (D:237), so routine automatic compaction conflicts with docs. Compacting an inbox Doc needs the sender's act, but it is driven by the receiver's journal. No `ack` semantics exist yet to coordinate the two (A:374).
- **wasm inside wasm (unmeasured).** JS turns run three interpreters deep: the browser JITs the kernel's wasm, which includes wasmi; wasmi interprets QuickJS's wasm (about 1 MB, `aven/kernel/sandbox/logic.js:46`); QuickJS interprets the JS. Rough guesses:
  - wasmi is about an order of magnitude below JIT-compiled wasm, and QuickJS one or two orders below a JIT JS engine, so JS code may run **10²–10³× slower** than in the page;
  - add instantiating QuickJS for each turn, which A does not specify (instantiate, snapshot, or reuse), and JSON marshalling;
  - guess: about 1–50 ms per js-runtime turn, so 20–1,000 such turns per second per worker. json-runtime turns are likely 10³–10⁴ per second.
- **Fuel is not portable as specified.** It is "per instruction" in wasmi (A:148-149), but wasmi's fuel schedule is version-specific. The fallback "host engine with fuel counters added" (A:443-444) counts differently, so one part can run out of fuel on one path and not the other, and replay diverges.
- **The face pipeline.** Each face needs present, view-runtime and css-runtime in wasmi, one shadow root and one `<style>` per face actor (A:309-311). The first paint of 1,000 rows with four face actors each is about 12,000 runtime calls. No memoization is specified, although every runtime is pure (A:130-134). The cache key could be (runtime, part, input hash), with CSS shared per definition through `adoptedStyleSheets`.
- **Parallel turns, serial commits.**
  - "Actors in parallel" (A:257, A:346) has no mechanism inside one browser worker.
  - Later, every turn commits through avenDB's one writer per peer (DB:30-31, E:104-105), so turns serialize at commit. That partly repeats weak spot 27 (R:335-336).
- **How loads would drive sync.**
  - A device keeps the union of the durable wants of the actors its person installed (E:311-312).
  - A turn runs only when its `now` loads are present (E:308-309), so message latency includes syncing those loads.
  - Slots bound per message mean per-message churn in wants.
  - Actor Docs and inbox Docs are implicit wants that no `loads` declares. How a home learns of a new inbox A→B is not specified; the inbox is "born with the tell cap" (C:386-387), so the letter must carry its Doc id.

## 8. Seams with store, docs, engine, caps and peer

- **Store.** Values are blobs. Definitions and runtime modules can be stored by hash, and heads are refs. Canonical JSON must be one shared function, and names need avenDB's `b3:` spelling.
- **Docs.**
  - Actor and inbox Docs become Loro Docs. Docs require every Record to be under a schema (D:102), but a definition has **no state schema**, and journal and inbox entries have none either.
  - Loro is used single-writer only: it buys uniformity, not merging.
  - There are no lines for agents' proposals.
  - The upgrade path (`replaces`) has no lenses.
- **Engine.**
  - The engine expects actors to issue operations (E:144-146, E:243-245, E:486), but A has no effect that writes data.
  - Turn commits must go through the one writer.
  - `now` gating, slot binding, later tiers arriving "as messages" (E:315-316) and composites are engine features with no actor-side spec.
- **Caps.**
  - Run caps, tell caps, standing caps and inbox ownership are agreed in words (C:845, "for Samuel to confirm"), but neither spec gives the mechanism; each defers to the other (A:375 "Designed in avenID's caps spec"; C:986 "The kernel and its router: `aven/actor`").
  - Spawning, uses and budgets "only where one … kernel counts them" (C:182), and `$actor` are not designed.
- **Peer.**
  - Home = EndpointId.
  - A keeper holds inboxes, and live frames go on `aven/db/1`.
  - A Peer-Light is one origin with many tabs: two tabs mean two kernels claiming one home. The store already elects a leader (S:184-191); the kernel has to live in it.

**Contradictions**

| # | Topic | The two sides | Notes |
|---|---|---|---|
| C1 | Where an actor runs | One home writes the actor Doc (A:64, A:373) vs. "one actor runs on a phone, a Mac and the Aven Peer alike" (E:288-289) | Device-dependent `loads` depth (E:298-309) leans towards the engine's reading |
| C2 | Composites | "No members field" (A:384) vs. a composite's loads as the union of its members' (E:314), with a Lean theorem (E:549) | Also "an actor's loads may hold another actor" (R:256-257) |
| C3 | Loads in turns | Later tiers "arrive as messages" and a turn waits for its `now` loads (E:315-316, E:308-309) vs. A's sender list and scheduler (A:256-257, A:344) | |
| C4 | Gossip | "No gossip for messages" (A:373) vs. live changes on a gossip topic per Doc (E:342-344, C:817) | |
| C5 | Wire format | JSON-lines frames on `aven/db/1` (A:374, A:431) vs. `aven/db/1` over irpc (E:158, E:376, E:533-534) and "one protocol" (DB:44) | |
| C6 | Caps across upgrades | A cap follows per unchanged message (A:375), "as far as the old interface reached" (A:194) vs. "a cap by definition doesn't [carry over]" (C:285-287) | The caps spec still lists it open, phrased all-or-nothing (C:972-973). A is ambiguous between the two readings |
| C7 | Who holds caps | An actor's "standing cap" (A:375, C:380) vs. "only a vault, a group … or a ticket holds a cap" (C:124) and "Actors hold no keys" (C:863) | R:30 says an actor is "limited by the capabilities it holds" |
| C8 | `$actor` | Compared with the envelope's signer (C:315, C:321; E:236-237), but the signer is always a device, never an actor (A:375) | |
| C9 | Layering | Actors sit above the engine and "know operations, not Loro" (E:144-146, E:163) vs. the kernel owning a Doc interface that avenDB implements (A:94-95, A:383) | The branch's `6f99f9f2` adds "depends on no storage backend" |
| C10 | The truth | The journal is the truth (A:354) vs. the envelopes are the truth (D:79) | Derived `state` syncs, against E:133 |
| C11 | Granularity | Every task and every placed component is a root Doc (A:200, A:205-206, A:370) vs. Records inside a Doc (D:105-108, E:185-190) | The engine's own todo is Records (E:384-394) |
| C12 | E2EE | Hosted actors are readable on the Aven Peer (C:388-389, C:845) vs. "The Aven Peer only ever sees ciphertext" (DB:199) and "can't read them" (C:6) | |
| C13 | Human gates | An ask addressed to a person (R:362), and "what matters waits for a person's signature" (R:32) vs. asks of at most 10 min (A:116) | |
| C14 | The promise | Later steps change "a layer's implementation, not its interface" (A:8-10, A:366) vs. new `cap` on messages, loads in `given`, EndpointIds in addresses, schemas in Docs (A:370-375) | |
| C15 | Inside A itself | Five places | 1. The journal holds the message whole (A:59-60, A:67, A:351-352) vs. by name (A:276). 2. `fail` answers asks (A:106) vs. any refused message (A:263). 3. The machine has start, finish, reopen (A:241-243) vs. the app's `toggle` (A:338). 4. The button sends `add {title}` (A:337-338), though it sees only its own state (A:170-171). 5. A component's `view`/`styling` (A:216) vs. a face's present plus parts (A:191) |
| C16 | Small inaccuracies | "One Doc has one key and one grant" (A:73-74), though Docs hold many caps and type-level writes (C:147, C:352); the real reason is write-needs-read (C:138). "Maps onto a Loro list one to one" (A:83-85), though Loro peers are per device, Doc and line (D:57, D:143) and counters count every op | |

## 9. Strengths, from first principles

- **One door** for every event (A:344-345). It removes weak spot 8's race between a click and a message (R:290-291) and makes the UI replayable.
- **Asks never block,** have deadlines and are answered exactly once (A:282-291, A:347, A:350). This removes the deadlocks of weak spot 9 (R:292-293).
- **Deterministic by construction**: no imports, frozen time and seed, fuel by instruction (A:136-149, A:233). This fixes weak spot 13 (R:300-301) and makes "checked by replaying its journal" (R:31) possible.
- **Single-writer Docs and per-pair inboxes** line up with one key per Doc and write-needs-read (C:138). A sender never reads its receiver's state, and actor state never needs a CRDT merge (A:73-76, A:88-89).
- **The transactional outbox** (law 11), with duplicates dropped on receipt, is a proven pattern for effects that survive crashes. It answers weak spot 17 (R:310-311).
- **The kernel enforces schemas and machines** (A:263-266). This closes weak spots 6 and 14 (R:284-285, R:302-303).
- **Defence in depth**: QuickJS inside wasmi, in a worker, never on the page's thread (R:388-389); the applier checks every tree again (A:315-316; R:393-394).
- **Content-addressed definitions and runtimes**: exact pinning and ids a replay reproduces (A:50-51, A:200-201).
- **A pure Rust kernel with no I/O**, matching avenDB's rule 2 (DB:32-33). It allows a deterministic simulation and Lean vectors (A:408-412).
- **An honest, small v1** (A:420) with an explicit list of what is left out (A:378-387).
- **Faces as data, with laws learned from aven-brands and avenVIBES** (A:165-180): checked placements, the state contract, and no raw CSS.
- **Loads = wants**: one concept with avenDB, and a want grants nothing (E:92, E:116-117; C:226).
- **No global sequencer**: order per pair, then the receiver's journal (A:124-126), which fits caps rule 28 (C:187-188).
- **Seams negotiated early with caps**:
  - "no confused deputy" is a theorem (C:922);
  - an inbox is born together with its tell cap, so its receiver can always read it (C:386-387);
  - hosting is stated as a privacy decision (C:388).

## 10. Weaknesses, gaps, risks and over-complexity

**HIGH**

- **W1. Reusing an address after retirement breaks law 8 or law 11 (affects v1).** A re-placed face actor gets the same address (A:220-221): rows filtered or scrolled out and back, tabs switched. Then one of two things happens:
  - it reuses the old Doc and counters, and the journal no longer replays to its state, because the reset was never a turn; or
  - it starts fresh at seq 1, and the receiver's `(from, seq)` duplicate check (A:358-360) **silently drops its new messages**.

  The same holds for the person actor across reloads, later. Fix: the kernel keeps a count per address across incarnations, or the address carries an incarnation.
- **W2. Location is part of identity.** The home is an EndpointId inside the address (A:111, A:373). Replacing a device, or moving an actor from a Peer-Light to the Aven Peer, changes:
  - every cap granted by address (C:279);
  - the name of every inbox Doc;
  - every address stored in other actors' state.

  This contradicts E:288-289 and A:8-10. No handover of the single writer (fencing) is defined. Fix: a location-free id scoped to a vault, with the home kept as a routing Record that can change.
- **W3. Replay is under-pinned.** A journal entry (A:276) does not record:
  - the runtime hash that actually ran, though a floor may substitute a newer one (A:145-146);
  - the definition in force, though `replaces` can change it (A:194);
  - the fuel schedule (wasmi's version, or the host-engine fallback, A:443-444);
  - the heads of the loads in `given`.

  Without these, law 8 (A:354) cannot hold.
- **W4. Every entity is a root Doc.** Each task and each placed component is a root Doc (A:200, A:205-207, A:370), and avenDB charges each root a head, a key, caps and a catch-up (D:105-108). Actor state is opaque to the engine's queries (E:384-394), so the same app has two data models. Allow many actors per Doc, or let actors behave while Records hold the data.
- **W5. Inbox Docs are per actor pair.** That means O(pairs) roots of about 6 KB fixed each (§7), keep caps and topics, and an edge visible to keepers for every pair (§6). Messages within one home do not need a Doc at all: the sender's journal already is the durable outbox (law 11). Across homes, multiplex per pair of vaults or homes, with a seq per actor pair.
- **W6. State is replaced whole.** A:86, together with Loro keeping full history (D:237), gives quadratic growth. Every payload is stored three times (§7), and derived state syncs (E:133). Fix: checkpoint state as Values referenced from the journal, and let the journal reference inbox entries instead of copying them.
- **W7. No effect writes data.** Effects are only tell, ask and reply (A:230). The engine expects operations from actors (E:144, E:243-245; C:383). Neither spec says which signer, which Doc, which footprint, or whether such a write commits with the journal or goes through the outbox.
- **W8. Caps do not compose across vaults as written.** "Effects carry the handled cap or narrower" (A:375; C:381-382), but:
  - a write counts only when the *signer's* chain covers it (C:141-143, C:439-444), and the signer is the home's device;
  - the standing cap has no holder (C:124);
  - if narrowing mints a child cap (C:404), each narrowed hop costs a hybrid signature of about 3.3 KB (C:747, C:758).

  Each spec defers the mechanism to the other (§8).
- **W9. The kernel acts with the full device cap** for every actor (C:81, C:369-370). Actors written by anyone (R:27) run under the person's device authority. A click's cap (C:379) flows into whichever face actor, possibly a third party's, was clicked. Fix: a narrow device vault for the actor host, and click caps scoped to what the placer wired.
- **W10. Rendering exfiltrates, and the applier shares the page's origin** (A:315-316, A:447-448). Fixes:
  - a CSP with `img-src`, `font-src` and `media-src` limited to `'self'` and `blob:`;
  - css-runtime refuses `url()` except content hashes;
  - links go through an interstitial;
  - consider a single opaque-origin frame for the whole face tree, so an applier bug cannot reach the keys.
- **W11. Actors hosted on the Aven Peer are readable there** (C:388-389, C:845), and A is silent about it. Always-on actors (timers, agents that receive messages while devices sleep) therefore give up E2EE, against DB:199. This should be a visible choice per actor, with a member's own Peer as the default host.
- **W12. `given` declassifies** loaded data into journals (§6). Journaling only heads instead would make replay need read access to those Docs.

**MEDIUM**

- **W13. Spawning has no authority model.** A tell cap names a message, not its payload (C:297). Whoever holds `tell kernel spawn` can therefore run any definition at your home, and the new actor's owner, caps and quota are not specified (A:279-280). Placing has no bound on recursion, so a component that places itself spawns without end (A:219-221).
- **W14. Who may publish a `replaces` is not specified.** A definition is just a Value that claims `replaces` (A:194). State migration is undefined, while docs uses lenses (D:83-85). The caps spec is behind (C6).
- **W15. Human approvals are capped at 10 minutes** (C13). A `timeout` also does not mean "not done"; avenOS knew this as `EXECUTION_UNCERTAIN` (R:146-147).
- **W16. Refusals are half-specified.**
  - A `fail` for a tell is undefined (A:106 vs A:263, A:318-319).
  - Refusals are not journaled (A:263 vs A:269), and the Doc keeps no read position per inbox (A:65-67). After a restart, a refusal can be sent twice, against law 6.
  - Nothing says a `reply` must come from the ask's `to`, so replies can be spoofed (A:115).
- **W17. The journal's content is contradictory**: the message whole or its name (C15). That decides whether inbox Docs can ever be compacted.
- **W18. No run budget and no backpressure.** A self-tell or a ping-pong loops forever while the journal grows (A:91), against "no step without progress" (DB:34-35). `uses` and `budget` come only later (C:334).
- **W19. Inboxes are hard to discover and to sync.** There is no way to discover a new inbox, gossip is excluded (C4), frames are JSON lines rather than irpc (C5), and the meaning of an `ack` is undefined (A:374).
- **W20. Engine contradictions C1–C3** decide where turns run and when they may run.
- **W21. Performance is unmeasured** (§7): wasm inside wasm, fuel portability, one shadow root and stylesheet per face, no memoization. Add a performance gate to steps 3 and 5 (A:414-417).
- **W22. Every keystroke is about three turns.** It goes person→field, field→placer, placer→field as `props`, because the v1 flow cannot get the title to `list` as written (C15). IME composition and controlled-input echo races are not addressed.
- **W23. A Prolog runtime to look up a fact table is too much.** A machine is a set of atom triples (A:237-243), yet it gets a wasm Prolog with "a real term parser" (A:159), run on every message.
  - Guards went (avenOS had `guard/2`, R:90-91), so legality that depends on the payload lives in code again.
  - Uniqueness of `(message, from) → To` is not stated (A:246-247).
  - The phase has no field (A:65-67).
- **W24. json-runtime is the main runtime ("mostly JSON", A:197-198), yet its grammar is not specified** (A:157): expressions, conditions, how messages are templated.
- **W25. Fields that later steps add are not reserved in v1** (C14): `cap`, the loads in `given`, a home in the address, schemas and lines.
- **W26. No actor names the vault that owns it** (§3 table), and `$actor` collides (C8).
- **W27. Shadow roots split forms and accessibility, and tabs split the home.** ID references (`aria-labelledby`, `<label for>`) and form autofill do not cross shadow roots. Several tabs need one kernel, in a leader (S:184-191).

**LOW**

- **W28. Terms.**
  - Undefined: `preview`, `trace`, `outcome`, the runtime for `a11y`.
  - Contested spellings: names without `b3:`, the "one grant" claim and the Loro claim (C16).
  - Overloaded words: view, part, variant, run, state, record, writer, kernel, envelope.
  - Ambiguous scope: whether `seq` counts per pair or per sender (A:83 vs A:112), and whether "the spawner's count" is the kernel's or the asking actor's (A:200-201, A:279).
- **W29. "Rust only," but js-runtime is QuickJS, which is C.** JS parts are strings inside JSON Values, which repeats weak spot 24 (R:328-329). Whether "actors written in Rust as WebAssembly" (A:163) are parts or runtimes is unclear, and "only from the repository" (A:143) depends on the answer.
- **W30. A:453 says "Open: nothing for version 1"** while W1, W16, W22–W24 are open in v1. The branch's `6f99f9f2` (its own workspace) needs an interface crate between the two workspaces (C9).

## 11. Open questions

1. Is an actor's identity its location? Can an actor change home, and how is its single writer handed over (a fencing epoch)?
2. Which vault owns an actor, and whose groups seal its Doc and its inbox Docs?
3. Can many actors share one Doc? Should a task be a Record that an actor writes, rather than an actor of its own?
4. Is an inbox per actor pair, per home pair or per vault pair? Do messages within one home need a Doc at all?
5. Does the journal keep the message whole or by name? Does each entry pin the definition, the runtime hash, the fuel schedule and the heads in `given`?
6. How does a turn write data? Is it a `mutate` effect, a store door actor, or operations in the turn's output? Under which signer and cap, and atomic with the journal or through the outbox?
7. How does a cap narrow hop by hop across vaults without a signed child cap per message? What holds an actor's standing cap, and where does a definition declare "its own" duties?
8. Who may spawn which definition at a home, under which owner, with which caps and quota? What bounds placement and spawn cascades?
9. Who may publish a `replaces`? Is state migrated through lenses? Does a cap with one changed message stop following entirely, or per message?
10. How do approvals that take hours work? Asks longer than 10 min, or a tell, a waiting phase and a tell back?
11. Is a refused tell answered with a `fail`? Are refusals journaled? Where is each inbox's read position kept?
12. Does `seq` count per pair or per sender? How do counters survive a face actor's retirement and the person actor's reloads?
13. What are `preview`, `trace` and `outcome`? Which runtime checks `a11y`? How does an actor subscribe to `tick` and `at`? What starts a new `run`?
14. Which URLs may views and CSS contain, and which CSP backs the applier? Should the whole face tree live in one frame with an opaque origin?
15. What does an `ack` frame acknowledge? Are frames sealed envelopes? How do JSON lines sit with irpc on `aven/db/1`?
16. Which worker or tab runs the home kernel when several tabs are open?
17. Who triggers compaction, given that history is forgotten only by an owner's act (D:237)?
18. Which turns per second and which first-paint budget must js-runtime and the face pipeline meet before step 6?
19. Is the caps spec's open question 8 (C:972-973) closed by A:194/A:375, and which wording wins?
