# avenDB: the architecture

This document is the one map of every part of avenDB. It says what each part is for and which few primitives they all
share. It also gives the words the parts use, the rules that hold across all of them, and how the whole stands up to
end-to-end encryption, local first and peer to peer. Each part's own spec has the detail; this document links to it
and owns only what is shared. Every term of every part, with what should merge, is in [`GLOSSARY.md`](GLOSSARY.md).

It was written on 30 Oct 2026 from six audits of the specs as they stood at main `2c1a9890`, one per part, and
updated for caps D13 to D20. Proposals are marked **A1** to **A25**
([Proposals for Samuel](#proposals-for-samuel)). Once Samuel decides one, it moves into the spec that owns it, and
this document keeps only the summary.

## The whole on one page

avenDB is a database that every device runs. Peers sync it, and keys decide who reads and who writes. A person's
devices hold their data and work offline. Every byte that leaves a device is sealed to the people who may read it.
Every peer runs the same core. The Aven Peer on the server is a peer that is always on, and it may do only what its
owners granted by cap.

Data moves in three forms:
- **Values:** immutable bytes, named by their hash.
- **Envelopes:** signed changes, each in one writer's log.
- **Docs:** mutable data, the merge of their writers' logs.

Every write is an envelope, and every reader checks every envelope itself. Demand (what a device wants, and how
urgently) is kept apart from authority (what a cap allows). Behaviour is actors: pure turns under caps.

```
avenOS       apps and faces; the applier draws                  os/
┌─ pure cores: no I/O, Lean first ─────────────────────────────────────────────┐
│ actors     definitions, turns, messages                     aven/actor        │
│ engine     operations, wants, views, runtimes               db/engine         │
│              ontology: facts and predicates, its first plugin  db/ontology     │
│ docs       Docs, Records, envelopes, logs, types, lenses    db/docs           │
│ store      Values and refs; files as hash sequences          store             │
│ avenID     keys, vaults, groups, caps, seals, the safe       id, id/caps       │
└──────────────────────────────────────────────────────────────────────────────┘
avenPEER     the edge that drives the cores: iroh, relays, the door,
             keepers, storage drivers, browser workers           peer/
```

Each core depends only on the cores below it. avenID is at the bottom because every layer signs, seals and checks
caps. avenPEER is the edge: it does all the I/O and runs the cores, which is how the README's rule 2 already puts it.
Today the README draws avenPEER above avenDB, while the engine and store specs draw it below the store. **A24**
settles it as drawn here.

## The parts and their specs

| Part | Its job | Its primitives | Spec | Thread |
|---|---|---|---|---|
| avenID | Who may do what: keys, vaults that own vaults, groups, caps, seals, the safe | key, vault, group, cap, ticket, keyring, epoch | [`id/caps`](id/caps/README.md), Lean `Aven.ID` | caps (#1492) |
| store | Bytes at rest and in flight | Value (a blob at rest), ref, file | [`store`](store/README.md) | done; security fixes in flight |
| docs | Mutable data and its history | Doc, Record, envelope, log, segment, type, lens, branch, checkpoint | [`db/docs`](db/docs/README.md) | docs |
| engine | Operations and demand | operation, want, target, view, runtime, vocabulary | [`db/engine`](db/engine/README.md) | engine |
| ontology | Meaning: facts over predicates | fact, predicate, trait | [`db/ontology`](db/ontology/README.md) | engine |
| actors | Behaviour | actor, definition, message, turn, face | [`aven/actor`](../actor/ARCHITECTURE.md) | avenACTORS |
| runtimes | Every runtime: the actors', the engine's plugins, and file runtimes with one registry of file types | runtime, registry, applier | [`aven/runtimes`](../runtimes/README.md) (a plan; Samuel, 30 Oct 2026: one home) | runtimes (plan only) |
| avenPEER | The node and the network | Peer, Peer-Light, relay, door, keeper | [`README`](README.md), [`MILESTONE2.md`](MILESTONE2.md), [`PRODUCTION.md`](PRODUCTION.md), [`SANDBOX.md`](SANDBOX.md) | PEERS planning |
| avenOS | The apps | app, face, the applier | `os/` | — |

## The primitives everything shares

These are the shared words. Every spec uses each of them in exactly this sense. The specs define about 300 terms
today; these 27 carry the whole design. [`GLOSSARY.md`](GLOSSARY.md) maps every other term onto them.

| Primitive | Its one meaning | Owned by | Replaces |
|---|---|---|---|
| **Value** | Immutable bytes named by their BLAKE3 hash, written `b3:<hex>` in text. At rest in a store it is a **blob**. A sealed Value is named by the hash of its sealed bytes; its plaintext hash is an id only inside a seal | store, docs | — |
| **ref** | A peer's own name for a Value, changed by compare-and-set. Refs never leave their peer | store | the README's "shared head, like IPNS" |
| **envelope** | The one signed unit of change. Its bytes are canonical, its signature covers exactly them, and it is named by their hash. It names its writer, its place in its log and, by hash, what it builds on. Always sealed to its readers; a public one to the network's members (caps D15) | docs, avenID | avenID statements, the chat's lines and docs envelopes. Actor messages and caps letters travel inside envelopes |
| **log** | One writer's envelopes in one Doc and branch, each naming the one before it by hash | docs | the store's chain, a device's run of segments, an actor's journal, an inbox's entries, a vault's statements |
| **segment** | A closed run of one log, sealed and hybrid-signed as one blob | docs | — |
| **split** | A writer signing two different envelopes after the same one. Final: neither side counts | docs, caps | "fork" in the store, the engine and Lean |
| **version** | A set of envelopes with everything they build on, named by its tips | docs | "heads" in engine answers, frontier, version vector |
| **snapshot** | A peer's own state at a version. It never leaves its peer | docs | the reader's snapshot of rule 1, which is the same thing |
| **checkpoint** | A signed state at a version that names what it covers. It travels, and any reader holding the inputs can check it | docs, caps | travelling snapshots, signed tree heads, compacted access maps, shared indexes |
| **Doc** | Mutable data named by the hash of its genesis envelope. Its state is the merge of its logs. It is the unit of keys, caps and sync | docs | — |
| **branch** | A run of a Doc's history: main, a proposal, a variant | docs | the docs spec's "line", caps' `lines` |
| **Record** | A typed piece of a Doc at `<doc>/<id>` | docs, engine | — |
| **link** | A field holding the address of a Record or a Doc | docs, engine | the engine's "ref", the ontology's "ref place", docs' `x-link` |
| **type** | A Doc whose versions are schemas, joined by lenses | docs | the schema family (`kind`) in docs, "table" in the engine, predicates and kinds in the ontology, definitions in actors (**A17**) |
| **key, vault, owner** | As avenID has them. A vault is person, coop, agent or device | avenID | — |
| **group** | Vaults that share a key: a Doc whose readers are its members. The network is a group | caps | `memberOf`, "in a group", the city-dome's readers (**A10**) |
| **cap** | A signed grant of verbs on a target, held by a vault, a group, the network's members or a ticket | caps | — |
| **verb** | What a cap allows: read, query, put, patch, remove, edit, tell, keep, share | caps, engine | caps' "operation" |
| **target** | One grammar for what a cap covers, what a want asks for and what a query ranges over | caps, engine | three grammars (**A8**) |
| **ticket** | A one-time key holding a cap until a vault claims it. An invite is a ticket | caps | invite and join (a join claims a ticket) |
| **operation** | Data the engine runs: a query, a mutation or a want | engine | — |
| **want** | Demand: a target, a depth, a window, a tier and a lifetime. A durable want is a **keep** | engine | loads, manifest, mounted wants, keep, keep share, avenDB-old's interest |
| **runtime** | A pure function named by its hash, from this repository: `run(part, input) → output`. A plugin is a runtime whose output is core operations | actors, engine | plugin (**A18**) |
| **actor** | A running definition with its own Doc, at an address that names no device | actors | — |
| **message** | tell, ask, reply or fail, between actors | actors | gossip's "live messages", which are live envelopes |
| **Peer** | A running node: the native Peer or a Peer-Light in a browser. The Aven Peer is a Peer of the agent Aven | avenPEER | — |
| **keeper** | A peer that keeps a vault's sealed bytes under a keep cap, without its key | caps, avenPEER | the Aven Peer's "keep rule", the code type `Keeper` |

## The rules across all parts

The parts' own rules stay in their specs. These hold across all of them, and every part's Lean model states the ones it
touches.

1. **One codec for everything signed.** Everything signed has one canonical encoding: bytes that don't encode back to
   themselves are refused. A signature covers exactly those bytes, under a label that names what is signed. The thing
   is named by the hash of the bytes. Lean proves decoding and encoding are inverse on everything accepted.
2. **History names its past by hash.** An envelope names, by hash, the envelope before it in its log and the tips of
   the other logs it builds on, never a counter alone.
3. **One writer per log, and a log never waits.** A device's own log is its truth. It never waits for another peer to
   confirm its head, and a device that lost its log starts a new one. Two envelopes after the same one are a split:
   final, and shown to every reader.
4. **Readers judge.** Every reader checks every envelope's signature, cap chain, footprint and fit itself, from what
   the envelope carries. It never asks a keeper, a relay or the Aven Peer.
5. **Reading is holding the key.** Whoever lacks a Doc's current key gets sealed bytes and the outside of a segment:
   its Doc, epoch and padded length (caps D13).
6. **Demand never grants.** A want only orders. What leaves a reader is wants ∩ caps; what leaves a keeper is
   wants ∩ fetch proofs.
7. **No privilege by position.** A peer holds only the caps its owners granted:
   - keep caps, which keep bytes blind;
   - hosting, which is an explicit read cap per actor, shown to the owner;
   - relaying, which moves sealed bytes.

   No peer is a sequencer, an arbiter, a custodian or the only source (Samuel, 30 Oct 2026).
8. **Derived state is a cache or a checkpoint.** Snapshots, views and indexes are a peer's own caches (README rule 5).
   What travels is a checkpoint: signed, naming its version and the runtime that made it.
9. **Sealed beyond the device.** No plain byte leaves a device except to a reader of it. The city-dome's plain history
   from before sealing is the one exception, and it stays readable.
10. **Every input has a limit** before it costs memory or time: envelopes, blobs, chunks, frames, pages, fan-out,
    queues, and a quota per vault.
11. **Every wait ends.** A dep, cap, revocation or key that never arrives leaves its envelope waiting and raises the
    stall alarm. It never blocks unrelated work (README rule 3).
12. **Order is causal; time is a claim.** Envelopes are ordered by what they name. Their time is the writer's claim:
    shown, and used by caps' time conditions as readers ack them, never for order.
13. **Keys live only in the safe.** Secrets never leave the safe runtime (caps D17). Pages, actors and files never
    hold them, and no origin that serves files or other code is the safe's origin.
14. **One protocol of ours.** `aven/db/1`, with iroh's gossip and blobs beside it on one `Router`. Every format is
    named and versioned, and Lean comes first, with vectors for every format.

## One vocabulary

Of about 300 terms, about 40 mean two or more things across the specs, and about 30 pairs name one thing twice. Every
homonym is a place where two threads building in parallel will diverge. These are the merges that matter most; the
full list, part by part, is in [`GLOSSARY.md`](GLOSSARY.md) (**A1**).

| Word | Today it means | Proposed |
|---|---|---|
| line | a chat message (store, engine); a run of history (docs, caps' `lines`) | **branch** for history; the chat's line is an envelope now and a `post` Record from milestone 4 |
| chain | a device's chat lines (store); a cap and its parents (caps); the vaults above one (avenID) | **chain** only for caps; the store's is a **log**; avenID's is "the owners above" |
| fork | a device's two histories (store, engine, Lean); a copy into a new Doc (docs D6) | **split** for the first; **fork** stays for the copy |
| envelope | signed Loro changes (docs); an operation's JSON wrapper (engine) | **envelope** for docs; the engine's wrapper is a **call** |
| operation | stored JSON work (engine); a permission (caps) | **operation** for the engine; caps grant **verbs** |
| statement, line, message, letter, journal entry | five signed units in four parts | one **envelope** format; messages and letters ride inside |
| keep, keeper, `Keeper` | a durable want (engine); blind retention for others (caps); every city-dome line (store); in-memory chains (code) | a **keep** is a durable want; a **keeper** keeps for another vault under a keep cap; the code type becomes `Logs` |
| loads, manifest, mount, interest | four names for demand | **want**; `loads` stays as the field of a definition |
| part | code for a runtime (actors); head, records or files (engine wants) | **part** for actors; a want has a **depth** |
| head, heads | a peer's ref to its newest state (store, docs); the stamp on an answer (engine) | **head** is the ref; the stamp is a **version** |
| ref | a pointer changed by compare-and-set (store); a Record pointer (engine); a fact id (ontology) | **ref** for the store; **link** for pointers between Records |
| snapshot | a peer's own cache (docs D4); something that travels (README, engine, milestone-4 notes) | **snapshot** stays local; what travels is a **checkpoint** (**A5**) |
| sealed | encrypted (caps); closed into a segment (README, engine) | **sealed** only for encryption; a segment **closes** |
| view | cached rows (engine); an app's schema and lenses (docs); a face's markup (actors); a kind's flat object (ontology) | **view**: a query's rows read through lenses at one schema version, stamped with a version. Actors' view part becomes **markup** |
| kind | a vault's kind; a composition of traits (ontology); a schema family (docs); a join's kind (engine) | **kind** only for vaults; the ontology's kinds and docs' families are **types**; a join says `join` |
| type, schema, predicate, definition, table | five words for "a shape with versions" | one **type** Doc with versions and lenses (**A17**) |
| catalogue, lane, vocabulary | a vault's names for Values (engine); the schemas a vault counts (docs); the ontology's lanes | one **vocabulary** per vault, Samuel's word: its named types, operations, runtimes and definitions; vault, then network, then built in |
| member | an invited person vault (avenID); a reader of a group (caps); an ontology predicate | a **member** is in the network's group (**A10**); `member_of` stays a predicate |
| network | the old agent kind; a statement field; the community; the Rust claim and config | the **network** is the members group under one genesis; the field names the genesis |
| claim | the first signup takes the network; a vault claims a ticket | the network starts with a **genesis**; **claim** is for tickets |
| peer, writer | a node; a Loro peer; the task that commits; a log's author | **Peer** is the node; a Loro peer is a **writer id**; a **writer** is a log's author; the task that applies changes is **the committer** |
| epoch | a Doc key between rotations (caps); a device's next Loro peer (docs proposal) | **epoch** only for keys; a device's fresh start after a split is a **generation** (Samuel) |
| partial | not everything is held (engine); not yet checked (milestone-4 notes) | **partial** means not everything is held; the other is **unchecked** |
| `$actor` | a person, the signing device, or an actor | `$actor` is the actor running the operation, `$vault` the vault it acts for and `$device` the signer. Caps compare `$vault` and `$device` with the signer, never `$actor` |
| index, gate, record | a file's chunk list, a pack's map, a query index; a time limit, an access check; a pack entry, a status, a log entry | **index** only for queries (a file has a **chunk list**); **gate** only for time limits (access is the **door**); "record" only as **Record** |

## Merging the primitives

Each part brought its own primitives, and many are the same idea twice. Merged, the design keeps about 30 nouns
instead of about 90, and every rule is stated and proven once.

| # | Merge | What it removes | Owner |
|---|---|---|---|
| K1 | **One codec and one signing rule** for everything signed: statements, chat lines, envelopes, caps, approvals, letters, checkpoints. Canonical bytes, a label per kind, a signature over exactly the bytes, the name from the hash (rule 1) | five formats with five parsers; a whole class of malleability bugs, of which the chat has one live | docs, with the security thread first (**A2**) |
| K2 | **One log** with the hash of the one before, a sequence number and deps by hash (rule 2). A segment is a closed run of it | the store's chains, docs' segment runs, actor journals and inboxes as separate structures; four gap and split detectors | docs (**A3**, **A4**) |
| K3 | **One target grammar** for caps, wants and query scope | the engine's four forms beside caps' seven; queries over "whatever this device holds" | engine, caps (**A8**) |
| K4 | **One want.** Loads, mounts, keeps and the device profile are wants. A keep cap is a keep placed at a keeper, with the right to hold the bytes | durable/mounted lifetimes, profile tiers and keep caps as three places deciding durability | engine (**A9**) |
| K5 | **One way to version a shape:** a type Doc with versions and lenses. Schemas, predicates, the ontology's kinds, actor definitions and runtime grammars are all versions. `replaces` is the previous version, an actor's state moves through lenses, and who may publish a version is whoever may write the type Doc | `replaces` with no state migration and no publisher; lanes beside type Docs; definitions outside caps | docs, actors (**A7**, **A17**) |
| K6 | **One answer to "who is in":** groups. The network is the members group (caps D15, #1492), an invite is a ticket for it, and the door admits its members' devices. The tree is a Doc of signed statements under one genesis | `memberOf` beside groups; the Aven Peer's custody of the tree; ordering by ref names | caps, PEERS (**A10** to **A12**) |
| K7 | **One kind of code:** the runtime. A plugin is a runtime that lowers to core operations, so a lowering is pinned by its hash and every reader re-lowers alike | plugins versus runtimes; lowered hashes that drift when a plugin upgrades | engine, actors (**A18**) |
| K8 | **One way to change data:** core mutations put, patch, remove, and a new `edit` for text, lists and trees, each with a verb and a footprint. The ontology's assert, set and retract and json-runtime's path updates lower to them | three update grammars; container edits outside caps and bounds | engine (**A19**) |
| K9 | **An actor's history is its Doc's log.** A turn is one envelope on the actor's Doc. A message is stored once and referenced by hash. Loads are journaled as (Doc, version, query hash), not as data. Inboxes go one per pair of vaults, not per pair of actors | each payload stored three times; a journal beside the Doc's history; O(pairs) inbox Docs; loaded data copied into journals | actors (**A17**) |
| K10 | **One checkpoint** for all signed derived state: a Doc's state for new devices, the tree's head, a compacted access map, an actor's state. Each names its version, the runtime that made it and what it covers | four separate trust stories for derived state that travels | docs, caps (**A5**, **A21**) |
| K11 | **One transport per job:** live envelopes on one gossip topic per group; catch-up by set reconciliation and iroh-blobs; `aven/db/1` for the rest | three transports for chat lines; JSON-line frames beside irpc; a topic per Doc | engine, PEERS (**A9**) |
| K12 | **One door:** a device is let in if its vault is in the network's group. The relay, the handshake and the blob provider check that; keepers check per-Doc fetch proofs | an allow-list kept apart from membership; any member fetching any blob | PEERS, caps (**A10**, **A22**) |

## Stress test: end to end, local first, peer to peer

Each scenario says what must hold, what runs in production today, what the specs give once built, and the fix.

| # | Scenario | Must hold | Live today | As specified | Fix |
|---|---|---|---|---|---|
| 1 | The Aven Peer is gone for a week | Members keep working and syncing | Browsers stop: one relay, one keeper, one way into gossip | Still one keeper and one relay for browsers | Several relays and keepers in the page's relay map; any member's Peer relays and keeps (PEERS) |
| 2 | The Aven Peer's operator turns hostile | It can't read, forge or split the network | It reads everything, swaps the guardian by configuration and tells each member the tree it likes | It sees metadata only; the guardian is still configuration; it still holds the tree | A signed genesis naming the guardian; the tree as a Doc; signed tips among members (**A11** to **A13**) |
| 3 | Storage rolls a ref back | Readers notice | Unnoticed | Heads are local; a keeper serving by arrival order can hide new segments | Deps by hash and signed tips show what's missing (rule 2) |
| 4 | A device is stolen | Removing it ends its reading and writing | Devices can't be removed | Removal and a heal (D19); grants need a passkey (D14); it reads each Doc's current epoch until that Doc's next write | Removal ships with sealing; a group rotates at once when a member leaves |
| 5 | A member is removed | Nothing new opens to them | Only the door closes | Each Doc rotates at its next write; network caps stand | Network caps end at removal (**A10**) |
| 6 | A month offline, then sync | Every write is kept and counts | Writes wait in memory until the Aven Peer confirms the device's head | Segments upload on reconnect; concurrent revocations settle by acks | A device's log is its truth (rule 3) |
| 7 | A member floods the network | The cost stays bounded | No limits | Fetch proofs and quotas at keepers | Limits everywhere (rule 10); a fetch-key chain (**A22**); a quota per vault |
| 8 | An adversary records traffic for a quantum computer | Content and keys stay private | iroh's transport is classical | X-Wing for keys, symmetric content; transport and the guardian classical | Hybrid TLS in iroh when rustls has it; a hybrid guardian (**A13**) |
| 9 | Script runs on avenOS's origin | Keys stay safe | Device keys sit in OPFS on that origin | The safe on the Peer-Light's own origin (D17) | Three origins: the app, the safe and files (**A15**) |
| 10 | 10,000 members and 100,000 Docs | Sync and rotations stay cheap | — | Flat keys up to about 150 (D7); a topic and a catch-up per Doc | The key tree; topics per group; set reconciliation across Docs; checkpoints (**A9**) |
| 11 | A Doc with ten years of history | A new device starts in seconds | — | Snapshots stay local, so a new device replays from the genesis | Checkpoints that travel (**A5**); period Docs (**A6**) |
| 12 | The guardian key leaks | The damage is bounded and visible | It owns every person vault | It owns every vault, and every keyring is sealed to it | Named in what people sign; it leaves before the network opens beyond the founding circle (caps D12); recovery with a delay |
| 13 | Two people use one invite offline | One winner, the same everywhere | The Aven Peer's compare-and-set picks | Undefined without a sequencer | The smallest claim hash wins, everywhere (**A12**) |
| 14 | The network splits for a day | Both halves work and merge after | Browsers only on the Aven Peer's side | Docs merge; acks settle revocations; statements are concurrent | The tree as a Doc; deterministic rules (**A12**) |
| 15 | A keeper shows two readers different histories | Readers notice at first contact | The first line to arrive wins | Deps name op ids, so it goes unnoticed | Deps by hash (rule 2, **A3**) |
| 16 | A writer goes away before it seals | Its readers still catch up | — | Only the author closes its segments, so readers wait forever | Keepers keep loose envelopes until a segment covers them (docs) |

## Caps, bulletproof

The caps grammar and its four key layers are sound: our own small grammar with subset checks, caps immutable by hash,
read by key, write checked by every reader, revocation in the Doc's history. Where caps aren't bulletproof yet is at
the edges: configuration, web origins, keepers, freshness. The table is the caps audit, updated for D13 to D20.

| # | Attack | The spec today | Status | Fix | Lean |
|---|---|---|---|---|---|
| 1 | Swap the guardian by configuration | It comes from `--guardian`; no person signs it | open | Its hybrid and X-Wing keys in the genesis and in every claim and join text; shown in fingerprints (**A13**) | `guardian_consented` |
| 2 | Ask for a passkey's PRF from another origin of `maia.city` | Any origin of the domain can ask, at a predictable input | open | A dedicated RP ID for avenOS before more passkeys exist; a secret the vault holds mixed into the input (**A14**) | — |
| 3 | Serve changed code from the origin | Outside the model; D17's safe helps | partial | Signed releases; the safe's origin serves only the safe (**A15**) | — |
| 4 | Mint caps with a stolen device | Every grant needs an owner's approval (D14) | covered | The heal also replaces the vault key, tag seeds and letterbox keys (D19, #1499) | `heal_evicts` |
| 5 | Launder a revoked holder's writes through another writer's late ack | "had seen" counts what the acking writer imported | covered (#1499) | An envelope with the revocation in its own past never counts; under a Doc cap only the revocation's own past is kept; another writer's ack may vouch for revocations kept elsewhere (**A23**) | `revocation_wins`, restated |
| 6 | Read the signer off a segment | Outside a segment is only its Doc, epoch and padded length (D13) | covered | — | `keeper_blind` over the outside |
| 7 | Learn who reads a Doc | Fetch proofs come over connections that name the device | accepted for now (D13) | Mixing, unlinkable proofs, later | — |
| 8 | Spoof a fetch-key change or upload junk | The new fetch key comes by letter, unauthenticated | open | Fetch keys chain from the Doc's genesis, each signed by the one before; the keeper keeps every successor, takes the smaller epoch hash as current, as writers do, and flags the fork; the uploading vault pays (**A22**) | `fetch_chain` |
| 9 | A reader given one Doc can't check vault-wide caps | They live in a group Doc it can't open | covered (#1499) | Envelopes carry, inside the seal, the caps they rest on; acks carry their revocation | — |
| 10 | `below` read upward | The text runs backwards | covered (#1499) | `below` is sealed downward | `authority_down` |
| 11 | Keep a writer from hearing of a removal | Browsers have one keeper and one relay | open | Several sources; signed tips; a writer never writes on an epoch older than a tip it has seen | — |
| 12 | Hold the door and the tree | The Aven Peer's, by position | open | The genesis, the tree as a Doc, the network's group (**A10** to **A12**) | `door_from_tree` |
| 13 | Pass on a read key without approval | Anyone holding a key can seal it to another | accepted, stated (#1499) | Say it: approvals bind writes, `share` and `tell`; reading is holding a key | — |
| 14 | Limit what one device reads | The keyring opens to every device | accepted | A limited device is a vault of its own, without the keyring (the Aven Peer is one) | — |
| 15 | Keep a group cap's children alive after their issuer leaves | Liveness checks only the writer | covered (#1499) | Children live only while their issuer is in the group | `child_live` |
| 16 | Keep network caps after removal | They stand | covered (#1499) | Removal ends public caps and rotates the members group at once (D15) | `public_bounded` |
| 17 | Read history with a `from-now` grant through a group | `back` opens all history | accepted, stated (#1499) | Say it; per-Doc keys where `from-now` matters | — |
| 18 | Play with clocks around expiry | A write carries its writer's time | partial | Readers judge expiry by acks; `not_before` holds only for reads | `time_acked` |
| 19 | Name a revocation or key that never comes | Its builders wait forever | covered (#1499) | Waits only for what is named by hash; every wait raises the stall alarm (rule 11) | `waits_end` |
| 20 | Claim one ticket twice | Only the Aven Peer's compare-and-set orders it | open | The smallest claim hash wins (**A12**) | `ticket_once` |
| 21 | Replay an old statement | No nonce, no expiry | open | Statements are envelopes in logs with a sequence and the hash before (K1, K2) | — |
| 22 | Make an actor act as a confused deputy | Inside the kernel (D16) | accepted | Hosting is the owner's explicit choice (**A16**) | `no_confused_deputy` |
| 23 | Show readers different sides of a split | Deps name op ids | open | Deps by hash (**A3**) | `split_found` |
| 24 | Forge later with a quantum computer | The guardian is Ed25519; the transport is classical | partial | A hybrid guardian; hybrid TLS | — |
| 25 | Flood a letterbox | Unspecified | covered (#1499) | The signature inside the seal, bound to the recipient; rate limits | — |

## Server peers hold only what owners grant

Samuel's line: no server peer has any privilege other than the caps its owners give it. Today the Aven Peer holds
every one of these by position. Each needs a replacement that someone grants, or a rule that every peer applies.

| Privilege today | Replaced by | Granted by | Where |
|---|---|---|---|
| Takes the network: the first signup wins | A signed genesis whose hash every member pins | The claimant's passkey and MaiaCityGuardian | **A11** |
| Orders joins and withdrawals by compare-and-set | The smallest claim hash wins; a withdrawal wins over the joins it precedes | Nobody: a rule every peer applies | **A12** |
| Holds the tree and tells it, with its configuration unsigned | The tree as a Doc of signed statements; the configuration in the genesis; signed tips among members | The statements' signers | **A11**, **A12** |
| Re-derives the guardian at every start from configuration | The guardian named in what each person signs | Each person | **A13** |
| The only relay for browsers | Several relays in the relay map; any member's Peer can relay | The admin coop lists them | PEERS |
| The way into gossip, presence, "who joined" | Any member; signed presence | — | PEERS |
| Keeps every chat line and file, plain, by a rule in its code | Keep caps from the city-dome's owners; blind once sealed | Maia City's owners | caps, milestone 3 |
| The only source for catch-up, so it can withhold | Several sources; deps by hash and signed tips show what's missing | — | **A3**, PEERS |
| Confirms a device's own head before the device writes durably | A device's log is its truth | — | rule 3, security |
| The first copy of a line to arrive decides a "fork" | Canonical bytes; splits are final | — | security, **A4** |
| Hosts actors and reads their data | An explicit read cap per hosted actor, shown to its owner; a member's own Peer by default | The actor's owner | **A16** |
| Serves avenOS's code | Signed releases; the safe on its own origin | Release signers | **A15** |
| Its storage can roll refs back | Heads are local; tips are signed | — | rule 2 |
| Serves any blob to any member | Blobs only through their Doc, against fetch proofs | — | caps, **A22** |
| Picks the RP ID, the origins, the coop's name and its own key | In the genesis; changes are the admin's signed acts | The admin coop | **A11** |

## Massive data: wants decide what moves

Samuel asked whether actors' wants and the engine's queries are the right place to decide what syncs first. **Yes:
wants are the right single demand signal, and actors' loads are where most of them come from.** The engine keeps
demand apart from authority, definitions declare their wants without fetching anything, and one queue orders both
fetching and opening. As specified, though, it orders whole Docs: a priority list, not yet a scheduler. A device's
loads ask for a Doc's head at `next` and its Records at `idle`, which the rule "each Doc once, at its highest tier"
can't express. What follows is the scheduler that's missing, proposed as **A9** for the engine thread.

**The want queue**

1. **Where wants come from:**
   - installed actors' `loads`, which are durable: what an app needs to work offline;
   - the device profile's tiers and `also`, which say how deep this device keeps each tier;
   - what is on screen and what a turn needs now, which are mounted;
   - queries: a query's target is an implicit want for its sources, so a fresh device fetches what a query ranges over;
   - follows: links from fetched Records, at most three hops, with a fan-out limit per hop.

   The device's wants are their union. Nothing outside the device ever sees them.
2. **The unit is a want key:** (Doc, branch, depth, window).
   - **Depth:** `head`, `records` or `files`, each including the one before.
   - **Window:** the newest n Records, everything since a version, everything, or a byte range of a file (the
     playhead).

   Each key is queued once, at its highest tier.
3. **Priority** is the tier first (`now`, `next`, `later`, `idle`), then the signal inside it: viewport position,
   distance to the playhead, place in a list. There are two kinds of `now`: the screen's comes before a background
   turn's.
4. **Prerequisites inherit priority.** A key needs, in order:
   1. its Doc id, resolved;
   2. the key blob and epoch key, through the keyring and its groups;
   3. the fetch key;
   4. the newest checkpoint;
   5. the segments after it;
   6. then follows and files.

   Each step runs at the highest priority of anything waiting on it, so a `now` want never waits behind an `idle` key
   fetch.
5. **Resolving targets.** A Doc target is direct. A vault target or a type target resolves through a directory Doc,
   one per vault and root type, sealed to that type's group. The genesis of every Doc names its vault and root type,
   so a directory can always be rebuilt from the geneses a device holds.
6. **Batches.** Each round with a source starts with range-based set reconciliation over (Doc, tip hashes) for every
   key in a tier. Then many Docs' segments come as one hash sequence per page, stored in one write.
7. **Sources.** Own devices on the LAN come first, then other readers of the Doc, then keepers. Several sources serve
   at once, a chunk each, and a source that stalls drops out for the round.
8. **Fair and preemptive.** Work goes a page or a chunk at a time, and the queue picks again between pages. Within a
   tier, Docs take turns. Durable tiers keep a fixed share, so they never starve.
9. **Uploads first.** A device's own unsent envelopes and segments go to keepers before any pull. That is
   avenDB-old's lesson: writes go first.
10. **Budgets and eviction.** The profile gives bytes per tier. Over budget, the lowest tier goes first, then the
    least recently used: their refs are dropped, and cleanup by reachability frees the blobs. `now` is never evicted.
11. **Windows a blind keeper can serve.** A keeper serves "the newest checkpoint of Doc D, then every segment after
    it" by arrival order, without reading anything. Older history is fetched only when someone scrolls to it, for
    reading only.
12. **Docs that grow without end are chains of period Docs:** a chat room by month, an actor's journal by month, books
    by year. Each links the one before, so a window maps to whole Docs (**A6**).
13. **Gossip per group, not per Doc.** A device joins one topic for each group it reads, and the tips of all that
    group's Docs are announced there. A reconnect reconciles sets.
14. **Progress.** Every round satisfies keys or moves versions. A round that moves nothing raises the stall alarm.
    Signals such as the camera and the playhead are coalesced to a few updates a second.
15. **Privacy.** Wants stay on the device. A keeper learns which Docs a device fetches, in what order and when, and
    nothing else. Later, fetches go in batches with decoys.

Two actor rules make it hold:
- a turn whose `now` loads aren't held runs offline with a `partial` answer rather than never;
- a journal keeps (Doc, version, query hash), not the loaded data (**A17**).

## Search: local first

**Decided (Samuel, 30 Oct 2026, A21): search is local.** A device searches only the data it holds, with its own index
as a cache (README rule 5). To search more, it wants more: an actor's `loads`, or the target of the search itself
(A8), makes the want queue sync those Docs from other peers first, the urgent ones first (A9). Then the device searches
them locally. No other peer ever indexes, matches or searches anyone's data.

Why not an index another peer can match (a **blind index**): it always leaks something, and published attacks recover
content from exactly these leaks (Islam, Kuzu and Kantarcioglu, 2012; Cash, Grubbs, Perry and Ristenpart, 2015;
Kellaris and others, 2016). The leaks are:
- which entries share a value;
- how often each value occurs;
- what occurs together;
- result sizes;
- what is fetched after a match.

avenDB-old had one, and it leaked who shares what and in which order.

What stays to do, all of it for the data at rest, none of it for search:

| Token | Fix |
|---|---|
| Stanza tags | Include the Doc in what a stanza tag is derived from (done in caps, #1499) |
| Letterbox tags | Ratchet per letter |
| Files | Padmé on every file (D18) |
| Doc ids and epoch hashes | Storage ids per epoch, later |

## Strengths and weaknesses, part by part

**store** ([audit summary](#sources))
- *Strong:*
  - a tiny contract (whole blobs, refs by compare-and-set), proven in Lean with crashes;
  - files as hash sequences, so a seek fetches only what it touches;
  - iroh-blobs behind one adapter;
  - local first stated as a rule;
  - per-engine gates measured.
- *Weak:*
  - live security bugs (fixed in their own thread first);
  - the chat's per-device chains can't survive sealing as written;
  - every line costs a blob and a ref, and every peer holds every chain in memory;
  - no limits or quotas;
  - three transports for lines.
- *Verdict:* a sound byte layer. Its chat chain is a bridge to docs' logs (K2).

**docs**
- *Strong:*
  - two primitives;
  - envelopes as the truth, with snapshots and heads as caches;
  - fit as a pure function, with a schema language of merge-surviving rules;
  - per-device segments with one post-quantum signature per 256 envelopes;
  - self-certifying Doc ids;
  - three-way merges on Loro's union.
- *Weak:*
  - **deps by op id** (critical);
  - snapshot trust undecided;
  - the unsealed tail;
  - a split freezes everyone until a settlement that can double edits;
  - fit has holes (merges name no schema; one schema per commit);
  - type-Doc writers decide fit for good;
  - unbounded histories;
  - milestone 4's target of 500 envelopes in a second against 30-second sealing.
- *Verdict:* the right foundation. Hash deps, final splits and checkpoints must be decided before code (**A3** to
  **A7**).

**engine**
- *Strong:*
  - demand apart from authority, proven;
  - one core evaluator;
  - operations as data, named by hash;
  - answers that carry completeness and phase;
  - nothing derived syncs;
  - iroh reused, iroh-docs refused.
- *Weak:*
  - queries have no scope;
  - wants order whole Docs;
  - it moves snapshots while docs and caps keep them local;
  - actors hosted on the Aven Peer need plaintext;
  - caps' footprints and re-lowering (E1 to E3) aren't adopted;
  - container edits sit outside operations;
  - the bound model is unsound for `order`, `group` and anti-joins;
  - two data models (facts and Records with fields).
- *Verdict:* the right shape. It needs scope, the want queue and caps' footprints (**A8**, **A9**, **A18**, **A19**).

**ontology**
- *Strong:*
  - typed places;
  - money in minor units;
  - slot ids for at-most-one;
  - samples that must round-trip;
  - avenOS's failures turned into rules.
- *Weak:*
  - kind queries can't run without indexes at modest scale;
  - slot ids undefined across predicate versions;
  - the gismu layer is heavy;
  - every kind edit re-issues caps.
- *Verdict:* facts for relations across kinds; transactional documents such as invoices as typed Records (**A20**).

**caps**
- *Strong:*
  - authority from four essentials;
  - our own grammar with subset checks;
  - caps and roles immutable by hash;
  - one target grammar;
  - read by key, write by every reader;
  - precise footprints;
  - Keyhive-style revocation;
  - four key layers and lazy rotation;
  - X-Wing everywhere;
  - the PRF step;
  - honest about forward secrecy.
- *Weak:* the guardian by configuration; the shared RP ID; the code-serving origin; ack laundering; keepers can't
  authenticate fetch-key changes; group verification gaps; freshness; the door and the tree as server privileges; 35
  nouns.
- *Verdict:* the strongest spec. Its holes are at its edges (**A10** to **A14**, **A22**, **A23**).

**actors**
- *Strong:*
  - one door for every event;
  - asks never block;
  - deterministic turns;
  - commit, then send;
  - the kernel enforces schemas and machines;
  - QuickJS inside wasmi inside a worker;
  - content-addressed definitions;
  - loads are wants.
- *Weak:*
  - a re-placed face reused its address, breaking replay (fixed in #1488: an incarnation in the address);
  - location was part of identity (decided in A17: a vault-scoped id, and the home only routes);
  - replay didn't pin the runtime, definition or fuel schedule (fixed in #1488); load versions are recommended in A17;
  - every entity was a root Doc. Samuel's doors (30 Oct 2026) settle it: an actor's own data is its state, and every
    other Doc is reached through a door actor such as the engine, so tasks can be Records;
  - an inbox per actor pair (decided in A17: one carrier Doc per pair of vaults);
  - state replaced whole grew history quadratically (decided in A17: a turn is one Loro commit);
  - no effect wrote data (settled by the doors: a write that can be refused is an ask to the engine);
  - views could carry data out through URLs (fixed in #1488: a CSP for faces, `url()` only by hash, links through an
    interstitial);
  - the kernel acts with the whole device cap. Doors act only with the message's cap, and a narrow device for the
    actor host is still open.
- *Verdict:* version 1 is sound and small, and its later layers now fold into docs and caps (K5, K9, **A16** and
  **A17** decided).

**avenPEER and the network**
- *Strong:*
  - the tree proven in Lean;
  - every membership change signed by whoever authorizes it;
  - the door checked twice;
  - no wipes in production;
  - honest, measured documents.
- *Weak:*
  - the claim is trust on first use;
  - members take the configuration unsigned;
  - all data is plain;
  - devices can't be removed;
  - the Aven Peer is sequencer, only relay, way into gossip, custodian of the tree and only keeper;
  - the code-serving origin is trusted;
  - restore orders by ref names.
- *Verdict:* a sound tree with server-held edges. The genesis and the tree as a Doc remove them (**A11**, **A12**).

## Security findings in live code

The store audit found five bugs in code that ran at aven.maia.city. All five are fixed and live (#1493, #1509): shared
files never run on avenOS's origin, a chat line's bytes are canonical, catch-up is paged, sizes are checked before
anything is allocated, and chunks are checked. The details are in [`audits/store.md`](audits/store.md).

## Proposals for Samuel

Each proposal comes with a recommendation; "yes" means the architect recommends it. Once decided, a proposal moves into
the spec that owns it.

**Before any docs or engine code**
- **A1. One vocabulary:** this document and [`GLOSSARY.md`](GLOSSARY.md) are the single source for shared words and
  cross-part rules, and every spec uses them in this sense. *Decided: yes (Samuel, 30 Oct 2026).*
- **A2. One codec and signing rule** for everything signed (K1, rule 1). It started with the chat's lines in the
  security fixes (#1493). Samuel asked for "the best-practice encoding possible", shared by avenDB and the actors
  (30 Oct 2026). The recommendation is **deterministic CBOR**, RFC 8949's core deterministic encoding, in a strict
  profile:
  - native byte strings and integers; no floats (integers only, as decided for actors' version 1);
  - text keys, sorted bytewise; shortest forms; definite lengths;
  - no tags but those the profile names;
  - a hash is its 32 bytes.

  A decoder refuses anything that doesn't encode back to itself, and Lean proves it. JSON stays the readable form,
  with bytes as `b3:` or base64url text. It is standard and widely implemented (COSE, WebAuthn, DAG-CBOR), and it
  answers the runtimes plan's question 6, a bytes leaf. Canonical JSON (RFC 8785) can't tell bytes from text and is
  weak on large integers. What a person approves is shown decoded from the exact bytes the passkey signs, never from a
  separate copy, and Lean's vectors include that rendering, so what is shown and what is signed can't drift (from the
  caps thread). *Decided: yes, "CBOR is good" (Samuel, 30 Oct 2026).*
- **A3. Envelopes name what they build on by hash** (rule 2). *Decided: yes (Samuel, 30 Oct 2026).*
- **A4. Splits are final,** with no settlement that revives a side, and "fork" means only a copy into a new Doc. The
  store's and Lean's fork becomes split. *Decided: yes (Samuel, 30 Oct 2026).*
- **A5. Checkpoints travel:** sealed and hybrid-signed, naming the segments they cover. A new device starts from one
  and checks it in the background, from milestone 4, whose catch-up target needs it. *Decided: yes (Samuel, 30 Oct
  2026).*
- **A6. Collections that grow without end are chains of period Docs.** *Decided: yes (Samuel, 30 Oct 2026), rather
  than shallow snapshots, which refuse older branches.*
- **A7. A Doc pins the type versions it accepts,** at birth or by its owners' act, and a listing can be withdrawn.
  *Decided: yes (Samuel, 30 Oct 2026).*
- **A8. One target grammar** for caps, wants and query scope. A query without a target is refused; `complete` means
  every Doc of the target is held, checked against its directory; the implicit want takes the query's tier and lasts
  while the query is live. *Yes; the engine thread agrees.*

**The network and trust**
- **A10. The network is a group:**
  - membership is the members group (D15, #1492);
  - the door admits its members' devices;
  - invites are tickets;
  - removal ends network caps.

  *Yes.*
- **A11. A signed genesis:**
  - the claimant's passkey and MaiaCityGuardian sign the network's first statement;
  - it names the RP ID, origins, coop, agent, the Aven Peer's key and the guardian's hybrid keys;
  - every member pins its hash.

  *Yes, before sealing.*
- **A12. The tree is a Doc of signed statements:**
  - ordered by what each statement names, not by ref names;
  - a ticket claimed once, by the smallest hash;
  - a withdrawal wins over every join not in its past, and a join is final once an admin device has acked it, as a
    revocation wins over what it hadn't seen (refined with the PEERS thread);
  - members gossip signed tips.

  *Yes.*
- **A13. The guardian is named, with hybrid keys, in every claim and join text** people sign, until it leaves before
  the network opens beyond the founding circle (caps D12). *Yes.*
- **A14. A dedicated passkey RP ID for avenOS,** for example `aven.maia.city`, before more passkeys exist; today's few
  members register once more. A salt the keeper serves per credential goes into the PRF input: secret from other
  origins, not from the keeper. *Not yet (Samuel, 30 Oct 2026): it waits until he takes it up.*
- **A15. Three origins:** avenOS (the app), the safe (D17: keys, the Peer-Light) and files (no keys, sandboxed).
  Releases are signed:
  - in the browser, a Service Worker on the safe's origin checks a release's signature before new code activates,
    and release hashes go into an append-only signed list that members' other devices check. A browser always
    re-checks a worker's script against the server, so this raises the bar without making the deploy unable to
    replace it;
  - the trusted path is the Mac app (Tauri), which checks signatures before it runs new code.

  *Decided: yes, as the architect recommends (Samuel, 30 Oct 2026: "do as you believe").*
- **A16. Hosting an actor on the Aven Peer is an explicit read cap** per actor and per load target, shown to its
  owner; a member's own Peer is the default home. *Decided: yes (Samuel, 30 Oct 2026).*

**The engine and actors**
- **A9. The want queue** as in [Massive data](#massive-data-wants-decide-what-moves). Its laws go into Lean before
  any code: tiers only order, each key once at its highest tier, prerequisites inherit priority, every round moves,
  `now` is never evicted. Older periods are reached by a bounded `follow` of the link to the period before. *Yes; the
  engine thread agrees.*
- **A17. Actors fold into docs.** Samuel, 30 Oct 2026:
  - an address names a vault-scoped id with an incarnation counter, never a device, and the home only routes:
    *decided, yes*;
  - a message is stored once, by hash: *decided, yes*;
  - an actor's history is its Doc's Loro history, a turn is one commit, and Loro snapshots are its checkpoints:
    *decided, yes*;
  - every actor keeps its own inbox (queue, read position, order of handling). Between devices one carrier Doc per
    pair of vaults, written by the sending vault's home device; none within one home: *decided, yes*;
  - loads are journaled as versions, not as data: *recommend yes*;
  - a definition is a version of an actor type, `replaces` names the version before, and a lens carries the state:
    *decided, yes*.
- **A18. Plugins are runtimes.** A lowering is pinned by its runtime's hash, and an envelope carries the lowered hash.
  *Yes; the engine thread agrees.*
- **A19. One update grammar:** put, patch, remove and a new `edit` for text, lists and trees, each with a verb and a
  footprint. *Yes; the engine thread agrees.*
- **A20. Facts for relations, Records for documents.** *Yes; the engine thread agrees.*
- **A21. Search is local first,** as [above](#search-local-first): a device searches what it holds, and its wants sync
  what it wants to search. *Decided (Samuel, 30 Oct 2026).*

**Caps**
- **A22. A peer that keeps sealed data for others checks who may add or fetch it, without reading it.** Phones and
  browsers are rarely online at the same time, so some peers keep a Doc's sealed bytes for its readers: any member's
  own Peer, or the Aven Peer, under a keep cap. Such a peer can't read caps, so it checks key proofs instead. Fetch keys
  chain from the Doc's genesis, each signed by the one before; it keeps every successor, takes the smaller epoch hash
  as current as writers do, and flags a fork; the uploading vault pays. Peer to peer: any peer may keep, and none is
  special. *Decided: yes (Samuel, 30 Oct 2026).*
- **A23. Acks can't launder:** a revoked holder's envelope never counts if the revocation is in its past. *Done in
  caps (#1499), as what D8 meant.*

**Housekeeping**
- **A24. The layers** as drawn [above](#the-whole-on-one-page). *Decided: yes (Samuel, 30 Oct 2026).*
- **A25. Publish the six audits** under [`audits/`](audits/README.md) now that the security fixes are live. *Decided:
  yes (Samuel, 30 Oct 2026), done.*

## Who does what next

| Thread | Takes |
|---|---|
| security | the live store bugs; rule 1's codec for the chat's lines (**A2**) |
| caps (#1492) | attacks 1 to 25; **A10** to **A14**, **A22**, **A23**; the text fixes its audit lists |
| docs | rules 1 to 3 and 8; **A3** to **A7**; loose envelopes at keepers; limits before Loro import; fit per Record |
| engine | **A8**, **A9**, **A18** to **A21**; a query's scope; a bound per operator; the snapshot contradiction |
| avenACTORS | **A16**, **A17**; the address reuse of version 1; a strict CSP for faces; what `seq` counts |
| PEERS planning | the privileges table; several relays and keepers; **A11**, **A12** |

Text fixes that need no decision (broken links to `aven/ID/caps` and `aven/actor`, wrong rule numbers, stale
milestone numbers) go to each spec's own thread.

## Sources

Six audits of 30 Oct 2026, one per part: foundation (README, production, milestone 2, the sandbox), store, docs,
engine, caps and actors, published in [`audits/`](audits/README.md) (**A25**). They cite every claim to a line of
the specs at `2c1a9890`.
