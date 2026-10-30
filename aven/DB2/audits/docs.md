# Audit: avenDB's docs layer (`aven/DB2/db/docs/README.md`) with the 30 Oct decisions

main @ `2c1a9890`, 30 Oct 2026. Read-only: no repository file was changed.

**Refs.** `docs` aven/DB2/db/docs/README.md · `caps` aven/DB2/id/caps/README.md · `engine` aven/DB2/db/engine/README.md ·
`store` aven/DB2/store/README.md · `R` aven/DB2/README.md · `onto` aven/DB2/db/ontology/README.md · `prod`
aven/DB2/PRODUCTION.md · `chains` aven/DB2/db/spec/Aven/DB/Chains.lean · `act` the scratchpad copy of
`aven/actor/ARCHITECTURE.md` (that folder is not on main). **Labels**, not yet in any file on main: D1–D10 decided by
Samuel on 30 Oct; P proposed by the docs thread, awaiting Samuel; A agreed with caps (recorded at caps:175-178, 448-461,
544-547, 841); M4 the architect's milestone-4 notes.

## 1. Purpose and scope

The spec defines avenDB's document layer: Loro Docs of Records under schemas; envelopes, segments, snapshots and heads; versions, branches and merges; schemas, lenses and fit (docs:1-10, 33-65).
It sits on the store's blobs and refs, under the engine, and supplies the envelope every reader checks for caps (engine:143-163, caps:841).
Audited: main's file plus D1–D10, P, A and M4. No docs-layer Lean or code exists yet (`db/spec/Aven/DB/` has Store, Chains, Chat, Files…; Loro is not a dependency).

## 2. Primitives

The primitives are only **Value** and **Doc** (decided 30 Oct); the rest are structures over them, and "ref" is the store's word.

| Thing | Definition | Named by | Mutable | Written by | Stored |
|---|---|---|---|---|---|
| Value | Immutable bytes; a structured Value is canonical JSON (docs:37-39) | BLAKE3 hash, `b3:` | Never | Anyone (self-certifying) | A blob in each holder's store (store:48, R:109) |
| Doc | One Loro document; unit of sharing, sealing, caps, sync, atomic change; its own root Record (docs:40-44) | Stable id `d:`; P: hash of its genesis envelope | Only by appending envelopes | Devices of its vault or of cap holders (caps:439-444) | No single object: segments (Values), each device's head and snapshot, key blobs |
| Record | One piece of a Doc with its own id, always under a schema; D5 flat by id in one root map (docs:48-50, 102-108) | `<doc>/<id>`; root = `<doc>` | Fields yes; address never; type should never (unstated) | Writers within their footprint (caps:307-322) | Inside the Loro state |
| container | A field's merge kind: text, list, movable list, map, tree, counter, value (docs:50, 127-136) | Loro container id | Yes | — | Loro state |
| type | A named schema: a Doc whose versions are schema Values; says which Records are roots (docs:51-52, 105-108) | Doc id | Lists versions and lenses | Vault devices; admin coop (network lane); avenDB's release (built-in) (docs:192-193) | A Doc |
| schema | One version of a Record's shape: JSON Schema 2020-12 subset plus `x-loro`, `x-link` (docs:61, 177-189) | Hash | Never | Anyone; P: counts if its type Doc ever listed it | Value |
| lens | Two-way steps between two schema versions (docs:63, 200-219); D9 a tree per type | Hash | Never | Type authors | Value |
| envelope | D1 one Loro commit of one peer; Ed25519-signed live, sealed with the Doc's epoch key; inside: branch, signer, cap, acks, operation and params, changes, schema (docs:53, 143-150; caps:841) | Undefined | Never | One device | Gossip (engine:342-344), then its segment |
| segment | D2 one device's sealed batch per Doc and branch, hash-chained; D3 seals at 256 envelopes, 1 MiB, 30 s quiet, page close or offline; one epoch; hybrid signature inside; outside only Doc, epoch, pseudonymous peer, counter range, previous hash, padded length (docs:54; caps:175-178, 544-547) | Hash | Never | Only its writer | Blob at holders and keepers |
| snapshot | Whole state and history at a version (docs:55); D4 each device's own cache; A never travels; signed checkpoints later (caps:747, 841) | Hash | Never | Each device | Local; M4: one from the Aven Peer shown `partial` |
| head | Ref naming the version, latest snapshot and later segments (docs:56, 114-121); A local and unsigned | Ref name | Compare-and-set | The device's one writer | Local store only |
| peer | Loro peer: first 64 bits of BLAKE3(device key, Doc, line) (docs:57, 143); P adds an epoch | u64 | Fixed per (device, Doc, branch, epoch) | — | In every op id; outside each segment |
| version | A set of changes plus what they build on, a frontier (docs:60); D10 named by a Record `{name, at}` (docs:161) | Frontier, version vector | Never (its name Record is) | — | — |
| branch (line) | main, proposal, variant; draft dropped (P); D6 inside one Doc, a fork is a new Doc (docs:58-59, 154-168) | A name; identity unspecified | Grows | Per caps `lines` (caps:250, 336) | The Doc's segments |
| verdicts | fit, authorized, not split; counts iff all three hold and its past counts (caps:183-186, 452-461) | — | fit never; the others flip | Each reader | Cache per envelope, revocations, code (caps:461) |

## 3. Glossary

**=** synonym or near-synonym of a term used elsewhere in avenDB; **≠** same word, other meaning.

- **Value**: immutable hash-named bytes (docs:37). = store **blob** (store:48, R:109).
- **Doc, document**: mutable Loro doc named by id (docs:40); both spellings are used across the specs.
- **Record**: a piece of a Doc under a schema (docs:48); the engine's one primitive (engine:74-75). ≠ lowercase "record": a peer's record blob (R:13), a pack record (store:225).
- **root Record**: a Record that is a Doc of its own (docs:105-108). = caps' **root type** names its type (caps:278, 285).
- **container**: Loro's merge unit for a field (docs:50).
- **type**: a named schema kept as a Doc (docs:51). = engine **table** (engine:76, 192); = ontology **predicate** for facts (onto:45-47).
- **kind**: the `kind` constant that finds a Record's schema family (docs:51, 178). ≠ ontology **kind**, a composition of predicates around an entity (onto:54-55), which the engine compiles (engine:446-453).
- **schema**: one version of a Record's shape (docs:61). **x-loro, x-link**: container choice; link to a Doc or a row (docs:177).
- **lens**: two-way mapping between schema versions; steps add, rename, convert, in, wrap and unwrap, move, container (docs:63, 210-213).
- **kept, unseen**: where a dropped field's data goes when no lens maps it (docs:89).
- **lane**: the schemas and lenses a vault or network counts: the vault's, the network's, the built-in one (docs:62, 192-193). = ontology **vocabulary** (onto:51, 152-157); = the engine's catalogue lookup order (engine:258). Largely retired by D8 and P.
- **view**: an app's schema plus the lenses to stored versions (docs:64). ≠ engine **view**, a query's rows, a cache (engine:97).
- **fit**: whether an envelope's changes are allowed by the schemas it names (docs:65, 194-196); D8. **kin**: one kind, or kinds a lens joins (docs:195).
- **envelope**: D1 one signed, sealed Loro commit (docs:53). ≠ the engine's operation "envelope" `{plugin, grammar, op, doc, params, body}` (engine:225-239). Actor **messages** are entries of inbox Docs, so they travel inside envelopes (act:64-70, 370).
- **segment**: a sealed per-device batch (docs:54; D2). = store and engine **chain** of chat lines (store:137-148, engine:359-362), whose shape D2 copies.
- **genesis envelope**: P: a Doc's first envelope, whose hash is the Doc's id.
- **snapshot**: Loro's export of state and history (docs:55). ≠ R rule 1's immutable in-memory "snapshots stamped with the head" (R:30-31). **checkpoint**: later, a signed snapshot (caps:747).
- **head**: a ref over version, snapshot and segments (docs:56). = store **ref** (R:113); = the chat's `chat-<device>` (store:142); engine answers carry "heads" (engine:460).
- **peer**: the Loro peer a device edits as (docs:57). ≠ **Peer**, the node: Aven Peer, Alice Peer, Peer-Light (R:85-88).
- **pseudonymous peer, counter range**: the peer and its op counters as shown outside a segment (caps:175-178).
- **epoch**: caps' one Doc key between rotations (caps:110). ≠ P's "the device moves to its next epoch", which means a fresh peer.
- **line → branch**: a run of history (docs:58; P). ≠ store and engine **line**, one chat message (store:140, engine:174). Caps grants still say `lines` (caps:250, 336).
- **main, proposal, variant, draft**: the default branch; a named branch from any version, merged or dropped; a proposal that stays open and follows main; a new Doc's own line, dropped by P (docs:156-160).
- **version, frontier, version vector**: a set of changes with their deps (docs:60); the head example stores a version vector (docs:116).
- **named version**: D10, a Record `{name, at}` (docs:161).
- **merge**: a change on the target that builds on both heads, plus the fix-up to the three-way result (docs:163-166). **merge footprint** = engine and caps **footprint** (engine:95, caps:93), over every type and field the merge changes (caps:448-450).
- **restore → "revert to"**: put a branch back at a version (docs:166); P maps it to Loro's `revert_to`.
- **undo of an older change → "back out"**: a three-way merge that takes one change out (docs:166-167); git's revert (P).
- **fork**: copy a Record into a new Doc without its history (docs:167-168; D6). ≠ the engine's, store's and Lean's "fork" for a device's equivocation (engine:130, store:147, chains:18-27), which P renames **split**.
- **split**: P: one device's history splitting, two contents for one op range. **settle**: P and D7: the device's vault resolving it.
- **counts**: fit, authorized, not split, and everything built on counts (caps:183-186). **stuck peer**: P: a peer whose next ops would build on an envelope that doesn't count.
- **scratch copy**: a fork used to open a version (docs:94). **one writer**: the task that applies every change (R:30, engine:104).
- **keeper**: a peer that keeps sealed bytes it can't open (caps:117). = the Aven Peer; = the engine's serving peer. **fetch key**: what a device proves to be served (caps:118).
- **grant, ack, kept list, revocation, access map**: caps terms that the envelope carries or the Doc holds (caps:101-105, 203, 414-415).
- **keyring, group**: caps' key layers (caps:82-83, 113); docs says only "the document's key" (docs:53, 144) = caps' current **epoch** key.
- **want**: engine: what a device asks to have (engine:86-89); M4: "a want loads a snapshot plus recent segments". **operation**: engine JSON stored by hash (engine:81), a Value in docs (docs:38-39). **manifest**: engine, an actor's loads (engine:92); unused here.
- **journal, inbox, definition**: actors: an actor's Doc holds its journal as a Loro list, inbox Docs carry messages, a definition is a Value (act:58-70, 83-85; docs:39, 43).
- **catalogue**: the engine's Doc mapping names to operation hashes (engine:94); a Doc here (docs:43).
- **fact, slot id**: ontology Records in "a map of entries"; a derived id for at-most-one traits (docs:138-139; onto:57-58, 126-127).
- **partial**: engine answer status, not everything held (engine:461). ≠ M4's use for an unverified snapshot, which means untrusted, not incomplete.

## 4. Rules and invariants (condensed)

**Model**
1. Two primitives: Value (immutable, by hash) and Doc (mutable, by id) (docs:35-46).
2. A Doc is one Loro document; its values sit in one root map, each field in the container its schema picks (rule 1, docs:71-72). D5: Records flat by id in that map.
3. Every Record has an id and a schema; no schemaless entries (rule 15, docs:102-104). A type says which Records are roots; only roots pay for a head, a key, caps and a catch-up (rule 16, docs:105-108).
4. Containers made after birth are mergeable (rule 4, docs:77-78).

**Writers and envelopes**
5. One Loro peer per device, Doc and branch (P: and epoch), never shared or reused; an import refuses an op of any other peer (rule 2, docs:73-74, 143).
6. No clocks in Loro; when something was written comes from its signed envelope (rule 3, docs:75-76).
7. D1 an envelope is one Loro commit; its commit message is the hash of the view's schema (rule 6, docs:81-82), set by Loro 1.17.1's pre-commit hook (P); merges, restores and undos name none (docs:82).
8. Import: signature and write right, peer, deps (else wait), fit, then the one writer (docs:145-152); caps adds opening, epoch staleness, the cap chain, split and re-lowering (caps:432-446).
9. Envelopes are the truth; a snapshot plus later segments equals replaying everything (rule 5, docs:79-80). D4 and A: heads and snapshots are each device's own, unsigned.
10. D2 each device seals its own segments per Doc and branch, chained by previous hash; D3 triggers; A: one epoch per segment, a rotation closes it, one hybrid signature each (caps:544-547).

**Verdicts**
11. Fit is judged once per envelope and cached; an unfit envelope and all built on it count for no one; a device never makes an unfit write (rule 10, docs:90-93). D8: fit depends only on what the envelope names. P: a schema counts if its type Doc ever listed it; only merge-surviving rules, proven in Lean.
12. A: an envelope counts iff fit, authorized and not split, and its past counts; a revocation that discounts imported envelopes rebuilds the state (caps:183-186, 452-461).
13. P and D7: a split stops counting for everyone until the device's vault settles it; an unfit envelope leaves its peer stuck and the device moves to a new peer.

**History**
14. Versions open on a scratch copy (rule 11, docs:94). D10: named versions are Records.
15. Merges are three-way, place by place; on a conflict the target keeps its own unless the merger takes the other's (rule 12, docs:95-97). A: the merger's grant covers the whole merge's footprint (caps:448-450).
16. D6: branches live inside one Doc; a fork is a new Doc. Full snapshots; history is forgotten only by an owner's act that closes older branches (decision 4, docs:237).
17. Catching up never rewrites; moving Records into a newer representation is a signed act (rule 13, docs:98-99).

**Schemas and lenses**
18. Nothing is migrated: read through lenses, write back only the difference in the stored representation, never write a default, keep what an older app can't see (rule 7, docs:83-85).
19. Lenses compose; no path, or two that disagree, opens read-only (rule 8, docs:86-87). D9: a tree per type.
20. A version that drops a field says where its data goes (rule 9, docs:88-89).
21. Schemas and lenses are Values, each type a Doc; one counts in a vault's lane only if a device of that vault created it on main (rule 14, docs:100-101), in effect superseded by D8 and P.
22. Lean holds peers, convergence, snapshots, fit, lenses and merges, with vectors (docs:246-259).

## 5. Trust model

| Party | Sees | Can do | Authority from |
|---|---|---|---|
| Writer device | Plaintext of the Docs its vault reads | Write within its device cap and caps; seal its own segments; if hostile or restored, split | Its vault (device cap), caps |
| Doc's vault (owners) | Everything | Root caps, revocations; forget history; P: settle its own devices' splits | Ownership (avenID) |
| Cap holder of another vault | Plaintext, with read | Write within its footprint; propose; merge when its grant covers the whole merge | An owner-issued cap |
| Reader | Plaintext | Judge every envelope and compute its own state; upload sealed bytes (authority unspecified) | Read is the Doc's key (caps:137-138) |
| Type-Doc writers | Their types | List schemas and lenses; under D8 and P, decide fit for every Doc of the type, for good | Their own Doc, not the target Doc's owners |
| Keeper (Aven Peer, or a member's Peer) | Outside headers, sizes, times, connections, the tree (caps:769) | Keep and serve sealed bytes against fetch proofs; choose what to serve and in which order; notice splits | Keep caps for keeping; nothing for its serving choices |
| Relay | IP addresses, timing, volume (caps:768) | Carry or drop every Peer-Light connection (R:158-159) | Network membership (admin coop) |
| Gossip forwarder | Sealed live envelopes on the topics it is told (caps:554-555, 606) | Forward or drop, best effort | Keep caps |
| MaiaCityGuardian's holder | Every keyring, sealed to it (caps:666-671) | Act as an owner of every person's vault (prod:36) | Owner of every vault, for the evaluation phase |
| M4's snapshot provider | — | Decide what a fresh device shows until "verified" | None |

**Flags: privileges not derived from an owner-granted cap.**
- **F1 [High]** M4: "snapshot from the Aven Peer shown as `partial` until verified." A blind keeper can't make a snapshot of a sealed Doc (R:199), so it comes from the Aven Peer reading the Doc (an actor's home, caps:845) or from some reader's upload. A snapshot carries every peer's ops without their signatures, so its maker can show any writer saying anything; "verified" is undefined; writes made on top build on op ids that may not exist. It contradicts D4, A ("never travel", caps:841) and caps rule 9 (every reader checks every write, caps:141-143).
- **F2 [High]** Completeness of catch-up. The keeper chooses which segments to serve. Heads are local and unsigned (A), so a withheld tail of any chain, or a whole writer's chain, goes unnoticed; with op-id deps (W1) it can show one side of a split to some readers and the other side to others, indefinitely. Peer-Lights reach others only through relays and members' browsers are rarely online, so the Aven Peer is in practice the only source; engine OQ1 is open (engine:559), and the chat precedent fills gaps from the Aven Peer (chains:24, store:149-151).
- **F3 [Medium]** If D2 copies the chat's chain rules, a device learns its own head from the Aven Peer before writing (chains:455-461). A stale answer makes the device split itself, and D7 then freezes its writes until its vault acts.
- **F4 [Medium]** The keeper "catches a split" (caps:175-176) but can't verify signatures inside the seal (caps:546): it can hide split evidence or report false hints. Readers must act only on two validly signed segments.
- **F5 [Medium]** Upload authority is unspecified. If a fetch proof is enough, any reader (read-only included) can plant segments or snapshots with plausible headers and pollute the keeper's chains and split hints.
- **F6 [High]** Type-Doc writers set fit for every Doc of a type, for good under P: the admin coop for the network lane (docs:192, onto:155), avenDB's release for the built-in lane.
- **F7 [High, accepted for evaluation]** MaiaCityGuardian reads every person's Docs and can act as owner for anyone (settle splits, remove devices). Operator-held, not a peer, but the largest exception to end-to-end encryption.
- **F8 [Low]** The door and the relay (the admin coop's) can cut a member off from every Doc: availability, not access.

## 6. E2EE and privacy

| What | Sealed with | Signed | Refs |
|---|---|---|---|
| Live envelope | Subkey `avenDB envelope 1` of the Doc's epoch key; XChaCha20-Poly1305 with key commitment | Ed25519 by the device | caps:537-544, 748 |
| Segment | Subkey `avenDB segment 1`; one epoch per segment | Hybrid Ed25519 + ML-DSA-65, inside the seal | caps:544-547 |
| Snapshot | Subkey `avenDB snapshot 1` exists, though A says snapshots never travel | Nothing (checkpoints later) | caps:540, 841 |
| Epoch key | X-Wing stanzas to readers (vault and group keys), found by tags, padded; `back` opens history | The key blob | caps:507-522 |
| Files | Keyed BLAKE3 of the epoch's convergence secret and the plaintext; 64 KiB units | — | caps:548-553 |
| Live topic | Named by subkey `avenDB topic 1` | — | caps:554-555 |
| Published Docs (network and built-in types) | Not sealed | Published by the vault's owners, k of n | caps:405 |

**The keeper sees** the tree with every device's public key (caps:769); per Doc its id, epochs and padded stanza counts, padded sizes, times, and which device uploads or fetches what (caps:769, 774-775); per segment (A) the pseudonymous peer, counter range, previous segment's hash, epoch and padded length; the topics it keeps and their traffic. From these it learns how many write each Doc and branch, each writer's volume and timeline, a Doc's birth (its first segment), new writers, splits, stuck peers' fresh pseudonyms, rebuild bursts after a revocation, and heals (all of a device's pseudonyms change at once, caps:575-581).

**Findings**
- **E1 [High] The pseudonym is computable from public data.** Readers re-derive the peer from the signer (caps:177-178), as the first 64 bits of BLAKE3(device key, Doc, line) (docs:143). The keeper holds every device's public key and every Doc id, and "main" is guessable, so it can label every segment with its device and vault, against caps rule 23 (caps:177). The tree sits in the Aven Peer's store (prod:67), so a breach of its S3 can too. Fix: a keyed derivation under a per-Doc secret that survives rotations (readers check, keepers can't), or a random peer bound inside the seal.
- **E2 [Medium] The pseudonym hides little from the live keeper anyway:** the uploading connection names the device (caps:774-775). It protects only copies at rest, and E1 removes that.
- **E3 [Medium] The counter range gives exact op counts.** Loro counts every inserted character, so a segment's range states its edit volume precisely, beneath Padmé's padding (caps:776). Serving by segment sequence, or rounding ranges, leaks less.
- **E4 [Medium] Doc ids from the genesis hash (P).** A predictable genesis (a vault's catalogue or device profile) lets anyone holding the tree confirm "Doc X is vault V's"; the genesis needs a random nonce. It is circular if the hashed bytes include its epoch, since the first key blob names the Doc (caps:510).
- **E5 [Low]** Fetching a vault's private type Docs to judge fit correlates the Docs that use them.
- **E6 [Accepted]** MaiaCityGuardian (F7). Chat lines from before sealing stay plaintext on Hetzner (store:19-21, 160-162), and M4's "read, not migrated" keeps them so.
- No forward secrecy for kept data, by design (caps:570-573).

## 7. Sync and performance

**How a Doc syncs**
1. The one writer commits a mutation through a view (engine:333-336): one Loro commit (D1), the schema hash from the pre-commit hook, an Ed25519 signature, a seal.
2. Live: the sealed envelope goes on the Doc's gossip topic, best effort (engine:342-344). Actors' messages instead go point to point, "no gossip for messages" (act:373).
3. It joins the device's open segment for that Doc and branch, which seals on D3's triggers or a rotation, is hybrid-signed and chained, put in the store and moved by iroh-blobs (engine:346-349, caps:544-545).
4. Head changes are announced (engine:356-357).
5. Catch-up: a device sends its version of each Doc; a peer answers with the segments and envelopes beyond it, in build order, a page at a time, each page moving the version on (engine:351-354). A keeper selects by the outside peer and counter range (caps:175-177, 975-977).
6. Import: open, signer, epoch, authority, peer, deps, fit, split, re-lowering; then the one writer imports and views update (caps:432-446).
7. M4: a want loads a snapshot plus recent segments, older ones on scroll; the Aven Peer's snapshot is `partial` until verified.

| Quantity | Value | Source |
|---|---|---|
| Hybrid signature per segment | 3,373 B (Ed25519 64 + ML-DSA-65 3,309) | caps:757-758 |
| Outside header and AEAD | ≈120 B (Doc id, epoch hash, 8-byte peer, counters, previous hash) + ≈72 B (nonce, tag, key commitment) | estimate from caps:175-178, 544 |
| Live envelope overhead | Ed25519 64 B plus signer, branch, cap, schema and operation fields: ≈250–300 B | estimate |
| Padding | at most ≈12 % (Padmé) | caps:776 |
| One chat line alone in a segment | ≈3.8 KB for ≈200 B of text; a full 256-envelope segment pays ≈13 B of signature per envelope | estimate |
| The store today (Chromium / WebKit / Firefox) | chat line 20 / 13 / 78 ms; catch-up of 500 lines 4.2 / 2.2 / 14.7 s | store:199-205 |
| M4's target | a Peer-Light catches up 500 envelopes in under 1 s, in every engine | M4 |

**Scale**
- **Many Docs.** Each Doc has its own open segment and timer, gossip topic (caps:817), fetch proof per connection (caps:609-611), key blob, and a version sent in each catch-up (engine:351); thousands of Docs mean thousands of each, and reconciling many Docs at once is still only "a pattern" (engine:377, OQ3 engine:561). Actors multiply Docs: one inbox Doc per communicating pair (act:64-70), each message an envelope and, when traffic is sparse, a segment of its own with a 3.4 KB signature.
- **Many writers per Doc.** One chain per (device, branch, peer epoch). Version vectors and the keeper's chains grow with every peer ever used, and one revocation race can push every writer that built on a discounted envelope onto a new peer (W12).
- **Massive histories.** Full snapshots put all history on every device (decision 4). Without shared snapshots, a cold start replays from genesis, and rebuilds after a revocation or split replay from before the first discounted envelope. A chat room is one Doc whose lines are Records (rule 16, docs:106-107) and an actor's Doc keeps every turn whole (act:91), so both grow forever. Loro's state is all or nothing, so "older on scroll" and the engine's `window` (engine:278, OQ5 engine:563) have no mechanism yet.
- **Keepers.** Every segment is an S3 object; D2 rules out compacting across devices; with 30 s quiet sealing, the object count follows pauses, not bytes.

**Bottlenecks**, most likely first: one OPFS file per blob (store:194-197) until pack files (store:218-240, not built); per-segment signatures for sparse writers; relay bandwidth for every Peer-Light byte (store:130-131); cold-start replay; rebuilds; per-Doc topics, proofs and version vectors; fit checks that need state before import (W15); fetching type Docs before fit can be judged; big Docs' Loro state inside wasm memory.

## 8. Seams and contradictions

**Store.** Values are blobs and heads are refs (R:109-113), but under A no Doc head leaves its device, so at a keeper nothing references segments unless it keeps per-chain refs like `chat-<device>` (store:142-146), which it can't validate (signatures are sealed). Cleanup by reachability is milestone 4's (store:51) and must keep both sides of a split (D7's evidence) and loose envelopes. A segment's 1 MiB matches the store's chunk (store:94); an envelope over 1 MiB has no rule, nor is it said whether 1 MiB is before padding. One file per blob makes local durability per envelope slow (store:194-197). M4 reads the old `chat-<device>` chains without migrating them: a second reader kept for good.

**Caps.** Agreed and consistent: the outside and inside of a segment, three verdicts, rebuild on revocation, one epoch per segment, a hybrid signature per segment, the merge footprint (caps:841, 448-461, 544-547). Open seams: grants name `lines` (caps:250, 336) and P renames them; `own` needs each Record's creator from its first envelope (caps:335), which a snapshot loses and slot-id Records make ambiguous; caps, revocations and epochs are Records in the Doc's access map (caps:414-415), so a revocation can itself be discounted and cascade rebuilds; a cap holder needs read on the type Docs its envelopes name, and nothing grants it; `history: from-now` (caps:293, 337) needs a base state, so a travelling shallow snapshot, which D4 and A rule out.

**Engine.** D1 matches "a mutation is one commit to one document" (engine:124). The engine re-checks footprints on every imported envelope's diff (engine:335-337, 484), so a diff per envelope is needed before import (W15). Wants' `window` and OQ5 depend on a snapshot policy the docs layer doesn't have (engine:278, 563). "partial" means "not everything held" in answers (engine:461), not "untrusted". Engine rule 15 still says fork (engine:130). A type-level cap is a set of schemas (engine:488-489), so a Record's type must not change.

**Actors.** One actor is one Doc with exactly one writer, its home kernel (act:58), but the engine runs one actor "on a phone, a Mac and the Aven Peer alike" (engine:288-289), against "an actor lives on one peer, its home" (act:373). Logs are said to map "onto a Loro list one to one", entries named `(writer, seq)` as "Loro names its operations" (act:83-85): Loro's counters count ops, not entries, and with peers per device, branch and epoch one writer maps to several Loro peers, so `(writer, seq)` must be an application id. The journal "is the truth" (act:354) inside a Doc whose truth is envelopes: consistent only while the journal has one writer.

**Ontology.** Facts are Records in "a map of entries" (docs:138-139); under D5 that is the root map. Slot ids (onto:126-127) need rule 4's mergeable containers. Predicates' lanes are vocabularies (onto:152-157), and alignment lenses across vocabularies (onto:84-85, 159-160) break D9's tree per type.

| # | One place says | Another says |
|---|---|---|
| C1 | Snapshots are each device's own and never travel (D4; caps:841) | M4 loads the Aven Peer's snapshot; caps keeps a snapshot subkey (caps:540); `from-now` reads need one (caps:337) |
| C2 | Full snapshots only; a shallow one refuses older proposals (docs:24, 237) | M4's "snapshot plus recent segments, older on scroll"; the engine's `window` (engine:278) |
| C3 | A Doc is one Loro document (docs:71) | D6's branches in one Doc need one Loro state per open branch, and the live doc may not be checked out (docs:94) |
| C4 | Records typed by their place; lists and trees of Records (docs:102-104, 132-133, 165) | D5: Records flat by id |
| C5 | Merges, restores and undos name no schema (docs:82) | D8: fit depends only on what the envelope names; every envelope is judged (docs:90) |
| C6 | One schema hash per commit; "of one kin" (docs:81, 195) | A kind's create writes facts of several predicates in one commit (engine:448-450; onto:180-202) |
| C7 | Counting is relative to a lane (docs:91, 100-101, 192) | D8, and P's "ever listed" |
| C8 | Two lens paths may disagree (docs:86-87) | D9's tree per type; the ontology's alignment lenses across predicates (onto:159-160) |
| C9 | A head is a shared ref, "like IPNS" (docs:40-41, 114-121; R:170-175) | A: heads are local and unsigned |
| C10 | The pseudonym names no device or vault (caps:177) | It derives from public inputs (docs:143); the keeper sees the uploading device (caps:774-775) |
| C11 | Decision 8: revert from a merge (docs:244) | P: restore is Loro's `revert_to`, atomic in 1.17.1 |
| C12 | "fork" = a copy into a new Doc (docs:167; D6) | "fork" = a device's equivocation (engine:130, store:147, chains:18-27) |
| C13 | "line" = a branch (docs:58; caps:336) | "line" = a chat message (store:140; engine:174) |
| C14 | "epoch" = one Doc key (caps:110) | P: a device's "next epoch" = a new peer |
| C15 | "envelope" and "view" (docs:53, 64) | The engine's operation envelope and rows view (engine:97, 225-239) |
| C16 | Fit never changes (caps:185) | P: fit depends on a type Doc's listing, which a revocation in that Doc can discount |
| C17 | An envelope is "one or more Loro changes" (docs:53) | D1: one Loro commit |
| C18 | Verdict caches keyed by code version (docs:91) | D8, and "every reader agrees" (docs:254) |
| C19 | One actor runs on several devices (engine:288-289) | One home, one writer per Doc (act:58, 373) |

## 9. Strengths

1. Two primitives with clean jobs, immutable hash-named Values and mutable id-named Docs, give dedup, verification by name, blind storage and one transfer path (docs:35-46; R:169-175).
2. One CRDT for every container, with history built in; merge behaviour is declared by the schema, not coded per app (docs:19, 127-136).
3. A peer per device, Doc and branch makes "every op is its signer's" checkable and closes hominio's shared-peer failure (docs:30-31, 73-74).
4. Envelopes are the truth, and heads and snapshots are local caches (rule 5, D4, A): nobody has to trust derived state, and everything can be rebuilt (R:38-39).
5. Fit as a pure function of the envelope (D8), with a schema language that allows only merge-surviving rules (P): validity is local, cacheable and kept by merges. That is the right foundation for schemas over a CRDT, and it ends avenDB-old's re-judging (docs:25).
6. Lenses instead of migrations, catch-up that never rewrites, drops that say where, and one tree per type, which removes path ambiguity (docs:83-89, 98-99; D9).
7. A three-way merge over Loro's union never loses a lone change and leaves conflicts to a person (docs:95-97, 163-173); the whole-merge footprint closes the narrow-merger hole (caps:448-450).
8. Branches share their Doc's keys, caps and catch-up, so proposals are cheap; a fork is a new Doc, a clean boundary (D6).
9. Per-device segments need no sequencer and no shared ref (the chat's lesson, store:135-139), give each writer a hash chain for gap detection, and spread one post-quantum signature over up to 256 envelopes (caps:747-748).
10. A minimal outside, with the signer inside the seal, lets a blind keeper serve catch-up without content (caps:175-178).
11. Self-certifying Doc ids (P) bind a Doc's vault and root type at birth (caps:285-286).
12. Records flat by id (D5): addresses never move, caps name types, joins use addresses (engine:179-183).
13. Named versions as Records (D10) sync, keep history and obey caps, with no new ref namespace.
14. Loro 1.17.1's `UsedOpID` makes a split fail loudly at import instead of overwriting quietly.
15. Lean first, with vectors every implementation loads (docs:246-259; R:46-52).

## 10. Weaknesses, gaps, risks, contradictions, over-complexity

- **W1 [Critical] Causal deps are op ids, not hashes.** Loro's deps name `(peer, counter)`. Two contents for one op range are told apart only by a reader that holds both (`UsedOpID`). A reader with side B imports Bob's envelope built on side A onto B without noticing, and a keeper serving A to some readers and B to others keeps them diverged: D7's "stops counting for everyone" never fires for them. A segment chain hashes only its writer's own previous segment (caps:175-177). Fix now, while it is cheap: every envelope names, inside the seal, the hashes of the segments or envelopes at its frontier (or catch-up requests carry each chain's tip hash), so a mismatch is evidence at first contact.
- **W2 [High] Snapshot trust is undecided and contradictory** (F1, C1, C2). Decide one: no travelling snapshots until signed checkpoints (a cold start replays), or sealed snapshots signed by a writer, binding their frontier and the hashes of the segments they cover, checked in the background, with no writes until checked. `from-now` reads need the second.
- **W3 [High] The unsealed tail.** Others build on live envelopes at once, but only the author seals them (D2). "When the page closes" can't be guaranteed: the leader is a tab's dedicated worker (store:184-189), and a device holding many Docs can't hybrid-sign hundreds of segments in `pagehide`. If the author never returns, its envelopes live only at the peers that heard them, and every reader catching up from segments waits forever on what was built on them (docs:149). The engine serves "segments and envelopes" (engine:351-352), but keepers storing loose envelopes is unspecified, and those stay Ed25519-only (caps:167). Fix: loose envelopes are Values that keepers keep and serve until a segment covers them, which also allows denser segments (W9).
- **W4 [High] D7 invites griefing and doubles edits.** Any write-capable device (hostile, cloned or restored) can split, and then everything built on either side stops counting for every writer, with a rebuild at every reader, until "the device's vault" settles. For a cap holder's device that is the holder's own vault; the Doc's owners can only revoke. Honest devices re-apply their edits on new peers (caps:460); if settlement later revives a side, the originals and the copies both count (doubled inserts, counters added twice). Fix: a split is final from its first diverging op (both sides never count), the Doc's owners may act too, and nothing re-applied is ever revived.
- **W5 [High] Fit has holes.** (a) Merges, restores and back-outs name no schema (C5), so their fix-up writes are either unfit or unchecked. (b) One hash per commit can't describe a commit across types, and "of one kin" would refuse one (C6). (c) An older app writing newer fields (docs:216-217) names its view's schema, not the representation it writes. (d) P's "ever listed" makes fit depend on the type Doc's history, which a revocation can turn (C16), and readers need read on the type Doc. (e) Caches keyed by code version can disagree (C18). Fix: per Record touched, an envelope names the schema of what it writes and the envelope that listed it, merges and reverts included; the checker's version is data in the schema.
- **W6 [High] Type-Doc writers rule fit everywhere, for good** (F6). Listing one permissive version makes any write fit in every Doc of that type, in every vault. Fix: a Doc pins the type versions it accepts (at genesis, or by its owners' act), or listings can be withdrawn under the same ack rule as caps.
- **W7 [High] Pseudonyms are linkable and counters leak volume** (E1 to E3).
- **W8 [High] One Doc's history has no bound:** full snapshots, no shared snapshots, replay-based rebuilds, chat rooms and actor journals that grow forever (section 7). Decide a partitioning rule (a room or a journal as a chain of period Docs) or Loro shallow snapshots with older history fetched for reading only, and keep local checkpoints for rebuilds.
- **W9 [High] M4's target collides with D3 and the store.** With 30 s quiet sealing, a sparse chat gets about one envelope per segment, so 500 envelopes are about 500 blobs again, each with a 3.4 KB signature and an ML-DSA-65 check in wasm; the store does 500 lines in 2.2 to 14.7 s today (store:199-205). It needs pack files (not built), a page of segments fetched as one hash sequence and persisted in one write, and denser segments.
- **W10 [Medium] Loro parses hostile input.** Any write-capable device's envelope reaches Loro's import once its signature and cap check out. A validly signed hostile change (wrong container kinds, giant text, deep trees, huge counters) runs in the one writer, where a wasm panic kills the Peer-Light and a slow import blocks every write (R:30). Only fit's depth cap is named (docs:196). Fix: size and op caps before import, fuzzed decoding, panics contained per import.
- **W11 [Medium] Branches are underspecified** (C3). Missing: a branch's identity and how readers discover it, per-branch heads (the head example has one version, docs:114-119), how a merge names its base, what a three-way merge does to text, that a main envelope depending on another branch's ops is a merge, and how wants and caps targets name branches.
- **W12 [Medium] Peer churn.** Every stuck, split or discounted peer moves to a new one (P), and a device-key rotation or a heal changes every derived peer (caps:575-581). Version vectors, snapshots and the keeper's chains carry every peer for good.
- **W13 [Medium] D5 isn't carried through** (C4). The Values table and the merge rules assume nested Records. Slot-id Records created at once on two devices need rule 4's mergeable child containers; Loro's root containers, named by Record id, merge natively and may serve better (deletion then becomes a tombstone). A Record's type must be immutable once created, or a writer can retype it past a type-level footprint (engine:488-489, caps:352); no rule says so.
- **W14 [Medium] A snapshot loses envelope metadata.** Signer, time, cap, acks and verdicts are not Loro state, so "who wrote", "when" (rule 3), `own` (caps:335) and re-judging after a revocation need an envelope index kept beside the snapshot. Rule 5's equivalence holds for Loro state only.
- **W15 [Medium] Fit before import needs state.** "Changed rows read under a schema" (docs:195) needs the post-state, and Loro can't un-import. Choose: a scratch fork per envelope or batch, op-level checks that need only lookups (possible with merge-surviving rules), or a staging import with a rebuild on the rare unfit.
- **W16 [Medium] Lenses under concurrency.** "The newer field wins" (docs:214): a v0 app ticks `done` while a v1 app first writes `status`, and the tick is silently lost for both. Lean's laws are single-writer (docs:256-257); a law that reading through a lens commutes with merging is missing. `move` and `wrap` write other Records, so writes made by lenses must lie inside the writer's footprint.
- **W17 [Medium] Doc ids from genesis need a precise rule** (E4): no circularity with the first key blob, a random nonce, and per-vault singleton Docs (catalogue, profile) that two offline devices would create twice.
- **W18 [Medium] The keeper's index and its cleanup** (F5): uploads checked by nothing beyond the fetch proof; reachability from per-chain refs drops split evidence and loose envelopes; S3 objects grow with every pause.
- **W19 [Medium] Terminology collisions** (C12 to C15, section 3): peer, view, envelope, snapshot, epoch, kind, fork, line. P's renames fix two; the rest need edits in the engine, the store and Lean (`fork_raised`, chains:270-274).
- **W20 [Medium] Lean can't prove Loro.** Convergence and "export the same bytes" (docs:75-76, 252) and P's merge-surviving rules are facts about Loro's algorithms and encoder; byte-identical exports across import orders and versions are no documented Loro guarantee. Model the docs layer over an axiomatised Loro (op ids, commutative union, last-writer registers) and hold Loro to the axioms with property tests and vectors.
- **W21 [Low]** Outdated on main: decision 8 (Loro 1.16), open questions 1 to 3 (answered by D4, D3, D10), the IPNS head and its JSON (C9), "one or more Loro changes" (C17).
- **W22 [Low]** No envelope id (the live form is signed by Ed25519, the sealed form under its segment's signature), though caches are "keyed by the envelope" (docs:91).
- **W23 [Low]** "Restoring puts a line back to a version's Record" (docs:166) is per Record; Loro's `revert_to` (P) is per Doc.
- **W24 [Low]** Named versions (D10) are mutable, branch-local Records: no evidence of "what was sent to Bob".
- **W25 [Low]** The 30 s timer and "goes offline" are clock and state triggers; they must reach the pure core as events (R:32-37).
- **W26 [Low]** 64-bit peers: a targeted second preimage (about 2^64 work) gives an attacker's device a victim's peer in one Doc, a `UsedOpID` denial.

**Over-complexity.** Each envelope has four verdicts (fit, authorized, split, deps), three ways for a verdict to flip (a revocation, a split found, a settlement) and two repairs (a rebuild, re-applying on a new peer), over peers per device × Doc × branch × epoch, plus lanes, lens trees, local snapshots and keeper chains. Each piece is defensible; the bugs will live where they meet (W4, W12). Simplify: hash-linked deps (W1), final splits without settlement, lanes retired in favour of type Docs, variants deferred, and one "counted state" function in Lean with an incremental implementation tested against it.

## 11. Open questions

1. Who may upload segments (and snapshots, if any) to a keeper, and what does it check beyond the fetch proof?
2. How does a fresh device learn every chain of a Doc, and know it holds each chain's tail? Signed per-device tips on gossip?
3. Which peer serves catch-up first (engine:559)? Must a device learn its own head from the keeper before writing, as chat devices do (chains:455-461)?
4. What does "verified" mean for M4's `partial` snapshot, and may a device write before it?
5. How does a `history: from-now` reader (caps:293, 337) get a base state if snapshots never travel?
6. Who settles a cap holder's split, is settlement final, and what happens to edits already re-applied?
7. What exactly is the peer derived from (which key, which epoch counter), and can readers check it while keepers can't?
8. What is an envelope's id, and are per-envelope Ed25519 signatures kept inside segments?
9. What is the largest envelope, and is a segment's 1 MiB counted before or after padding?
10. Is the Doc id the hash of the plaintext or the sealed genesis, with which nonce, and how do per-vault singleton Docs stay single?
11. How are branches named, discovered and headed, and how do wants and caps name them?
12. How does an envelope name schemas per Record, and what do merges and reverts name?
13. Does a Doc pin the type versions it accepts, and can a listing be withdrawn?
14. How are big Docs (chat rooms, actor journals, logs) partitioned, and what does "older on scroll" fetch?
15. How is history forgotten (decision 4, docs:237), and how do keepers learn to delete segments?
16. Does an actor run on one home device (act:373) or on several (engine:288-289), and who orders a journal kept in a Loro list?
17. Still open from the spec: the first lens catalogue's named conversions, and whether this is a crate of its own (docs:266-267).
18. Where is Loro pinned, and which tests show 1.17.1's atomic `revert_to` and `apply_diff`, as decision 8 required (docs:244)?
