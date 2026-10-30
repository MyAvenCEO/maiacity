# avenDB foundation audit

main @ `2c1a9890`, 30 Oct 2026. Read-only: no repository file was changed.

**Refs.** `R` aven/DB2/README.md · `O` aven/DB2/db/ontology/README.md · `P` aven/DB2/PRODUCTION.md · `M2`
aven/DB2/MILESTONE2.md · `S` aven/DB2/SANDBOX.md · `D` aven/DB2/db/docs/README.md · `E` aven/DB2/db/engine/README.md ·
`C` aven/DB2/id/caps/README.md · `ST` aven/DB2/store/README.md · `C1`, `C2` aven/DB2/db/research/C1-avenos-x1-x5-core.md,
C2-avenos-invoice.md · `Tree`, `WF`, `Governs`, `Query`, `Claim`, `Invite`, `SignIn`, `Passkey`, `Name`, `Cast`, `Sign`,
`Before` = aven/DB2/id/spec/Aven/ID/<X>.lean · `door.rs`, `relay.rs`, `members.rs`, `hub.rs`, `room.rs`, `main.rs`,
`lib.rs` = aven/DB2/peer/native/src/ · `statements.rs` = aven/DB2/id/core/src/statements.rs · `ACT` = the scratchpad
copy of `aven/actor/ARCHITECTURE.md` (that folder is not on main). Code is cited only to establish today's state.

## 1. Purpose and scope

The audit covers R, O, P, M2 and the vault, storage, peer and lane parts of S. It checks them against each other, against the other avenDB specs (D, E, C, ST and the actors spec) and against what `Aven.ID` proves.
It covers the primitives and their names, the rules, the trust placed in the Aven Peer, privacy, and what the ontology costs at scale.

## 2. Primitives

| Primitive | Definition | Named by | Who writes it | Where it rests |
|---|---|---|---|---|
| vault | "an identity that can own things, with a name" (R:96); `{id,name,kind,owners}` (Tree:33-38) | id string (from its founding statement, or fixed: `aven`, `aven-peer`, `maia-city`); display name 1–64 chars, not unique (Name:3-6) | nobody directly: derived from statements (Claim:145-151, Invite:152-170) | not stored; recomputed from statement blobs at every start (door.rs:11-13) |
| · person | owned by keys: its passkey and MaiaCityGuardian (P:150) | `<name>'s vault` (Claim:79) | claim or join | as above |
| · coop | owned by person/coop vaults only, holds no devices (WF:40-41) | id `maia-city`, name `--admin-coop` | **configuration**, never signed (Claim:22-24) | config |
| · agent | was `network` until 30 Oct (R:97-99, Before:6-15); Aven, owned by Maia City, acts through the Aven Peer (R:103-104) | `aven` | the Aven Peer's model (Claim:147) | config |
| · device | one owner, the vault it serves; owns nothing; its key has its id (WF:34-38); the key is the iroh endpoint key (S:687) | `<name>'s browser`, `… 2` (Claim:81-83) | claim, sign-in, join | secret in OPFS or a folder (P:69-70, ST:211) |
| owner | a key or a vault (Tree:19-23); owns = direct, governs = transitive (R:100, Governs:13-15) | `key:<id>`, `vault:<id>` | founding statements only; no owner change before M3 (P:88-89) | in statements |
| tree | keys + vaults, well formed by `WF` (Tree:46-49, WF:30-41) | — | the cast in the box (Cast:14-24); statements in production (P:23-32) | `cast.json`; the Aven Peer's S3 |
| claim | first signup: `avenID claim 2` signed by a passkey assertion (Claim:74-76) | ref `claim` | the first browser to reach an unclaimed peer (P:13-14) | blob + ref set by CAS (P:29-30) |
| sign-in | `avenID sign-in 1`: one more browser for the signing passkey's vault (SignIn:143-148) | ref `signin-NNNNNN` (door.rs:4-5, 56) | any passkey the tree holds | blob + ref |
| invite | admin passkey's assertion over a one-time Ed25519 key; the link carries its secret (Invite:44-45, 201-213; M2:31-34) | `invite-<16 hex>` (Invite:55); `withdrawn-<id>` | a passkey owning a vault that governs the coop (Invite:182-185) | blob + ref |
| join | `avenID join 1`, signed by the one-time key and the new passkey (Invite:50-52, 224-238) | ref `joined-<id>`, CAS (M2:32-33) | the invited browser | blob + ref |
| member | a person vault a join founded; `memberOf` = joins only, so the claimant is not one (Invite:174-178); not an ownership edge (R:116-117) | vault id | join | derived |
| admin | the coop owning the agent (R:101-102); an admin *key* is a passkey owning a vault that governs the coop (Invite:182-185) | — | the claim (+ config) | derived |
| guardian | MaiaCityGuardian: one offline Ed25519 key, co-owner of every person vault (P:36-45) | `maia-city-guardian` (Claim:91) | the Aven Peer's `--guardian`, applied at founding **and at every restart** (Claim:141-143, 203-207); required in production (main.rs:211-215) | a GitHub environment variable (P:136) |
| door | admits devices of the agent, of members and of vaults governing the coop (Invite:337-347, 527-529); also newcomers carrying an acceptable statement and anyone while unclaimed (Invite:25-28, 361-363; relay.rs:1-8) | — | computed by each peer from what the Aven Peer tells it (members.rs:1-8) | memory |
| relay | iroh-relay inside the Aven Peer, "for members only" (R:124, 214) | `https://aven.maia.city/relay` (P:100) | `--relay` (S:363) | — |
| network / agent | Aven "which runs the network" (R:97-98); "network" has four meanings (§3) | `network` field = the agent's id (Claim:9-10) | config | config |
| fact | `{id, p, x1…x5}` in a Doc's facts map; `id` names the entity (O:44, 113-121) | fact id or slot id `s:…` (O:126-127); `<doc>/<fact>` across Docs (O:125) | `assert`/`set`/`retract` lowered to `put`/`patch`/`remove` (E:218-221) | a Loro map entry (D:135-139) |
| predicate | English name, gismu, gloss, typed places (O:45-47, 135-146); a type, i.e. a schema Doc | its version hash, carried by every fact's `p` (O:93-95) | people and the minting agent; the network lane by proposal (O:221-222) | a vocabulary Doc (O:152-157) |
| kind | a named composition of traits with a flat view (O:54-55, 177-204) | name; compiled ops `<kind>.list/create/update/delete` by hash (E:446-453) | as predicates | a Doc; ops as Values named in a catalogue (E:247-258) |
| place | x1–x5: a value place (closed types, O:148-150) or a ref place (a fact id with a typed target, O:48, 79-81) | position, copied from the gismu (O:68-75) | — | inside the fact |

## 3. Glossary

`≈` marks a synonym or near-synonym in another spec. `≠` marks the same word with another meaning.

| Term | Meaning (ref) | Elsewhere |
|---|---|---|
| avenOS, avenPEER, avenDB, avenID, avenSANDBOX | app; node (network, relay, door, one writer); database (core + store); identity; the box (R:63-84) | avenPEER sits above avenDB in R:63-74, below the store in E:157-158 and ST:70 |
| avenDB-old, v1 | `aven/db` and the old stack (R:82) | |
| Peer, Aven Peer, Alice Peer | native binary; with its relay on; with it off (R:85-87, 121-122) | ≠ D "peer" = a device's Loro peer per Doc and line (D:57) |
| Peer-Light | the core as wasm in a browser, on its own origin (R:88, 123) | |
| box, cast, check | image + containers; fixed test setup; `bun run up --check` (R:130-131) | |
| app, account | a dashboard tile (R:129); a person vault one acts as (R:105) | ≠ "Vault", the app (R:78) |
| key, owner key, device key, passkey | R:94-95; ES256 via WebAuthn (P:51-54) | C adds X-Wing/ML-DSA, vault and group keys, PRF-derived keys (C:77-78, 114, 693-699) |
| owns, governs | direct vs transitive ownership (R:100) | ≠ avenOS's `owned_by` (ponse) facts (C2:122, 321); Invite:9-10 says "governs" for "owns" |
| sees, acts for, acts through, may act on | devices a vault governs; a device's one vault; a vault's devices; a device may act on all its vault governs (Query:44-66; S:565-566) | ≈ C "device cap" (C:81) |
| chain (avenID) | the vaults above one, nearest first (Query:40-41) | ≠ ST: a device's hash-linked chat lines (ST:137-151); ≠ C: a cap and its parents (C:96-97) |
| admin | the coop owning the agent (R:101-102) | used for the person (P:3, M2:12); a role in avenOS's caps (C2:336-341) |
| member | a person vault let in by invite, a member of the admin coop (R:116-117) | ≠ `memberOf`, which excludes the claimant (Invite:174-178); ≠ C "in a group" (C:82-83); ≠ O's `member_of` facts (O:156) |
| invite, one-time key, withdrawal | M2:31-34; Invite:215-220 | ≈ C "ticket" (C:100), whose claim a *device* signs (C:392-393), not a passkey |
| claim | the first signup claims the network (P:13-14) | ≠ C "a vault claims a ticket" (C:100) |
| join | Invite:50-52 | ≈ C "a ticket claimed" |
| sign-in, sign out | add a browser; forget its key without removing the device (M2:17-20) | C: a sign-in also opens the keyring via PRF (C:706-710) |
| statement | a signed text: a device's (Sign:5-11) or a passkey's (claim, sign-in, invite, join) | ≈ D "envelope", ST "line", ACT "message", C "letter": all signed units, each shaped differently |
| assertion, challenge, counter, RP ID, origin | WebAuthn parts; challenge = base64url(SHA-256(text)) (Passkey:18-19, 42-43); counter per passkey (Claim:36-38) | |
| MaiaCityGuardian | §2 | ≠ R's "guardian vaults … after a delay" (R:192-193); ≠ C's recovery owners (C:679-683) |
| door, newcomer, allow-list | §2 | C: "a cap to connect in all but name" (C:231) |
| room, city-dome | the one chat room (M2:15), renamed city-dome (ST:22-23) | |
| presence | who is connected: counted by the Aven Peer (S:225, hub.rs:1-2), `here` messages (room.rs:4-5) | |
| gossip topic | one per network, derived from its id (M2:41) | C: per Doc or group, derived from a key (C:554-555, 817) |
| the one writer | the single task in each peer that changes its data (R:125) | S "one writer per store" (S:102); ≠ ACT "every Doc has exactly one writer" (ACT:58) |
| store, blob | blobs and refs behind one contract (R:114; S:98-101); immutable bytes by BLAKE3 at rest (R:109) | blob ≈ D/E "Value" (D:37-39) |
| ref | a name pointing at a Value, changed atomically (R:113) | ≠ O "ref place" and E "a ref is always an address" `<doc>/<id>` (O:48, E:182-183) |
| compare-and-set | `set_ref(name, expected, new)` (S:123) | the only thing that serialises claims and joins |
| record (lowercase) | a peer's `first-start` record (S:178); one status record (R:41-42) | ≠ D/E "Record" (D:48-50) |
| Value, Doc, Record | immutable by hash; mutable by id, a head over Values; a piece of a Doc under a schema (R:109-112) | ≈ D:37-50, E:72-76 |
| cap | a signed grant of operations on Docs (R:115) | ≈ C "cap"/"grant" (C:87-88) |
| wipe | emptying a store, which unclaims the network (P:32); none in production (P:172-180) | |
| lane (iroh) | a NAT/UDP test topology (S:440-448, M2:79-87) | ≠ D/O "lane" = the schemas or predicates a vault counts (D:62, O:51) |
| fact, entity, referent | O:44, 49-50 | E: a Record whose type is a predicate (E:77-78) |
| predicate, place | O:45-48 | predicate ≈ D/E "type" (a schema Doc) |
| vocabulary, category | a lane of predicates (O:51); an entity standing for a kind of thing, referenced by position (O:52-53) | vocabulary ≈ D "lane" |
| kind, trait, slot id | O:54-58 | ≠ the vault Kind (Tree:12-16); ≠ D's `kind` constant (D:51); ≈ avenOS "bundle", `TypeSpec` (O:54-55) |
| gismu table, coined | 1341 typed gismu (O:59-60); a predicate without one (O:68-70) | |
| proposal | network-vocabulary change the admin accepts (O:221-222) | ≈ D proposal *line* (D:58-59); C `lines: proposals` (C:336) |
| line | chat line (M2:96) | ≠ D: a run of history, main/proposal/variant/draft (D:58-59), which C would call "branch" (C:336); ST: a signed chat blob (ST:140) |
| view | Vault app's tree (S:210-212) | ≠ D: an app's schema + lenses (D:64); ≠ E: a query's rows (E:97); ≠ O: a kind's flat object (O:202) |
| operation | a kind's compiled ops (O:203-204) | ≈ E: a JSON spec of work (E:81); ≠ C: a permission verb, read…share (C:92) |
| plugin | (not in O) | E: the ontology is the engine's first built-in plugin (E:9-11, 84-85); O draws itself as a layer under the engine (O:101-109) |
| envelope | (not in these docs) | ≠ D: signed sealed Loro changes (D:53); ≠ E: the operation JSON (E:225-239) |
| want, tier, loads | (not in these docs) | E:86-92 ≈ ACT `loads` (ACT:195) ≈ C "keep share, follow list" (C:226) |
| keeper | the Aven Peer keeps every city-dome line and file (ST:118-120) | ≈ C keeper, which must be blind (C:117, 172-174); today it is not |
| epoch, keyring, group, grant | (not in these docs) | C:110-113, 82, 87 |
| actor, message, definition | O: "agents … are actors with caps" (O:96) | ACT:58, 99, 184; C: "agents are vaults whose devices run their actors" (C:390); ≠ O's predicate "definition" (O:45) |
| $actor, $vault, $now | context binds (O:192; E:236) | `$actor` is undefined: a person ("me", O:77; E:434), the signer (C:315), or an ACT actor |
| network | (a) the old agent kind (R:97-99); (b) a statement's field naming the agent's id (Claim:9-10); (c) the community of members (M2:3-6, O:155, D:192); (d) Rust `Network`: the claim plus config (id/core/src/network.rs) | stale in R:185-191 |
| agent | (a) a vault kind, "usually LLM agents", yet Aven is infrastructure (R:97-99); (b) O's minting agent, a *device* vault "of its person's aven" (O:96-97, 208-209); (c) C:390; (d) rule 6, "an agent's act" (R:40) | four meanings |

**Stale or used inconsistently in these documents**
- **Ownership of Aven.** P:3-4 ("so owns Aven"), P:27-28 ("makes it Aven's owner") and P:55-57 ("Aven's owner is the claimant's vault") predate Part C. Today Maia City owns Aven (P:150-154, Claim:245-249). R:185-191 still says "a network's vault is owned by the vault that runs it".
- **Who invites.** It is "Aven's" act in S:77-78, "an owner's act on Aven" in M2:27 and "the coop's act" in Invite:9.
- **Who is a member.** M2:104 makes Aven and Alice members, and M2:17 includes the admin, but `memberOf` excludes both.
- **The chat's history.** M2:15-17 and M2:43-44 say the chat has none, while M2:100-101 says it "catches up on the chat"; ST:13-14 superseded the in-memory chat. M2:118 says "six steps" where seven are listed (M2:93-102).
- **Code drift.** P:42-43 says the guardian is optional; main.rs:211-215 requires it. M2:108 says a refused join isn't told why; relay.rs:6-7 says it is told. S:587-588 still has a SharedWorker; ST:189 removed it.
- **Stale status.** S:83, 227-228 and 589 still put the door in the future. R:11-16 says "milestone 1 is integrated", but M2 and the store upgrade have shipped.

## 4. The rules (R:30-59), condensed, and who relies on them

| # | Rule | Relied on by |
|---|---|---|
| 1 | One writer per device; readers see immutable snapshots stamped with heads | E:98, 104-105; ST:84-86, 142, 184-189 (Web Lock leader); S:102-103; door.rs:16; P:189 (S3 ref replacement leans on it) |
| 2 | Pure protocol cores; I/O at the edge; deterministic simulation | E:376 (irpc in process); S:545 |
| 3 | Every loop has a progress measure; a stall raises an alarm | E:131-132, 353-354 |
| 4 | React to changes (version vectors, heads), never to states: no budgets, slices or timers | E:323, 337-338; C:461 |
| 5 | Derived state is a cache keyed by its inputs and code version | D:90-93; E:133-134; C:461; O:291 |
| 6 | Catching up only reads; only a person's or an agent's act writes | D:98-99; E:131 |
| 7 | Status names its phase, from one record and one clock | E:461-462; S:226 |
| 8 | The UI gets pushed deltas and never re-queries | E:136, 464-466; M2:72 |
| 9 | One protocol of ours on one ALPN, no fallbacks; iroh's beside it on one Router | M2:46-47; ST:52, 70-71; room.rs:1-3 |
| 10 | Lean is the source of truth; examples and traces are exported as vectors | O:296-304; D:248-259; E:540-555; C:194, 899-935; ST:289-294; P:59-60; M2:53-58, 120 |
| 11 | Small packages in strict layers | E:161-163; ST:36-42 |
| 12 | Zero legacy: learnings only as rules and tests | O:9-11; D:9-10; E:15-16; C:11 |
| 13 | Every pin exact; pins move only by `bun run bump` | ST:244; M2:60 |
| 14 | Nothing merges red; every bug becomes a test | M2:62-63 |

Where the rules meet resistance:
- **Rule 1** names a different unit in each spec: a device, a store (S:102) and, in the actors spec, one writer per Doc (ACT:58).
- **Rule 6's wording** is broken by catch-up's per-line compare-and-set and by the Aven Peer's keeping (ST:118-122, 335-336). Its intent, no derived writes into Docs, is not stated.
- **Rule 9** ("no fallbacks for older peers") collides with production's no-wipe and long-lived browser tabs.
- **Rule 13** collides with iroh-blobs, which is pinned because the adapter reaches a crate-private constructor (ST:282-285).
- **Rule 10's "every test derives from Lean"** (R:14-15) holds for values. It does not cover the trust-critical parts Lean leaves out (§5.1).

## 5. Trust model

Every privilege the Aven Peer holds today is **structural**. No cap exists before milestone 3 (C:8). The phrase "within the rights [its owner] gives it and can take back" (R:103-104, 189-190; S:75-77) names no mechanism. The Aven Peer's key is unsigned configuration (Claim:100-110, P:107-108). In the model it "may act on" only Aven and itself (Cast:69), and none of the privileges below is such an act.

| Privilege today | Ref | Source | How to remove it |
|---|---|---|---|
| Takes the claim by CAS on `claim`: the first signup wins, and while unclaimed anyone may connect | P:13-14, 29-30; Claim:166-170; relay.rs:2-3 | Structural, trust on first use | Fix a signed **genesis** before anyone connects: a one-time claim key printed by the deploy, or a genesis MaiaCityGuardian signs naming rp, origins, coop and peer key. Members pin the claim's hash, so a re-claim is visibly another network |
| Sequences joins (CAS on `joined-<id>`) and their order against withdrawals | M2:31-34; Invite:224-238 | Structural sequencer. Admission itself rests on admin-signed statements | A **deterministic rule** every peer applies: of the joins naming one invite, the smallest hash wins; a withdrawal wins only over joins it causally precedes. Members gossip the statements, and a double join is raised as a fork, as chat chains are (ST:146-148) |
| Decides restore order and re-checks every statement against its *current* config | Invite:30-33, 319-333; door.rs:11-13 | Structural | Each statement names the tree head it extends; restore replays in causal order; a config change is itself a signed statement |
| Tells members the tree, every statement, and the config **unsigned** (rp, origins, guardian, coop, its own key) | hub.rs:3-5; statements.rs:36-87; M2:39-40 | Structural. statements.rs:3-4 says members learn "without taking the Aven Peer's word", but they take it for the config | Put the config in the signed genesis. Gossip signed tree heads so a split view is caught (C:780-782). Devices carry their own proof chain (C:814) |
| Runs the only relay Peer-Lights can use; its allow-list is the first door | S:39-40, 375-376; R:158-159 | Structural | **Several relays** in the page's relay map: any member's Peer with `--relay` and the same allow-list derived from statements (R:165). WebRTC later |
| Bootstraps gossip, counts presence, announces who joined | room.rs:2-3; hub.rs:1-2; M2:45 | Structural | Bootstrap from any known member; presence from members' own signed `here` messages (room.rs:4-5) |
| The only keeper: every city-dome line and file, plain, and catch-up | ST:19-21, 118-122; E:559 | Structural, "the one rule" (ST:119-120), against S:48-49 ("from caps, not a code path") | Seal first; keep caps naming keeper vaults; any member's Peer can keep (C:601-612, 815) |
| MaiaCityGuardian owns every person vault, so through the admin's vault it governs Maia City and Aven | P:36-45; Claim:141-143, 331-332; C:666-671 | Neither a cap nor a signed choice of the person: server config, applied at founding and re-derived at every restart | Name the guardian in the claim/join text the passkey signs. Owners remove it (M3, C:673-677). Recovery owners with a delay take its place (C:679-683). Keyrings are not sealed to it by default |
| Picks the coop's name, its own key, the RP origins | Claim:22-24; P:107-108; Passkey:52-53 | Configuration | Fix them in the signed genesis; rotations become admin-signed acts |
| Sees IP addresses, timing, the tree and all content | C:768-769; ST:19-21 | Structural | Sealing, several relays, mixed fetches (C:777-779) |

**Roots of trust beyond the Aven Peer's process.**
- **Deploy access.** Whoever can edit the `production` environment and start `avendeploy.yml` controls the network. The run has no reviewer (P:119-120), and the guardian is a plain variable (P:136). The same holds for whoever holds the S3 keys (P:137) or the server. Each can swap the guardian, which re-owns every vault at the next restart, or delete `refs/claim` and claim anew.
- **No backup and no recovery path.** The bucket has real deletes and no backup is specified (P:102). "No wiping in production" (P:172-180) is a process rule that no member can check.
- **The avenOS origin.** The page hands the Peer-Light the Aven Peer's key and relay (S:375-376). It holds device secrets in OPFS (ST:211; C:967-968). It asks the passkey for every statement. WebAuthn shows the user no statement text, so a changed page can make the admin sign an invite while they think they are signing in. Caps admits this only for the PRF output (C:737-738).

### 5.1 What Lean proves, and what it doesn't

The model is sequential and takes every signature as sound (Passkey:13-14, Sign:5-7).

**Proves:**
- `WF` is decidable and acyclic by rank (WF:30-43, 64-67).
- Authority is irreflexive and asymmetric; devices and device keys govern nothing (Governs:58-75).
- A coop holds no devices and no key owns one (WF:80-105).
- A network is claimed at most once (Claim:230-241).
- After the claim, the claimant's vault is the coop's only owner, the coop is the agent's, and the tree is well formed (Claim:245-249).
- With a guardian configured, it owns every person vault (Claim:331-332).
- A sign-in adds one device to its own passkey's vault and changes no other (SignIn:143-148). A stranger can't sign in, and counters must count up per passkey (SignIn:179-191).
- Only admin keys invite (Invite:396-399). An invite is used once and not after it is withdrawn, and a used invite can't be withdrawn (Invite:441-477).
- A join founds one person vault and one device, a member (Invite:490-497).
- The door admits exactly the agent's, the members' and the coop's people's devices (Invite:527-529), and only device keys (Invite:552-553, SignIn:210-211).

**Does not model:**
- **Concurrency.** The CAS race is `Aven.DB.Store`'s alone (S:129-131); that the door and the store together give "at most once" across crashes and races is argued, not proven.
- **`restore`.** No theorem that it rebuilds the same state or is independent of order (only prose, Invite:30-33, 322-325).
- **The newcomer's limit,** "that statement and nothing more" (relay.rs:7-8).
- **Config authenticity.** Guardian, coop, rp and peer key are plain `Server` parameters (Claim:100-110).
- **Freshness.** The challenge is a hash of the text, with no nonce or expiry (Passkey:18-19).
- **Two authority models.** A device's statements (`mayActOn`, Sign:52-54) and passkey acts (`adminKey`) are never related. In the model the admin's browser key "may act on" Maia City and Aven (Cast:71), while an invite needs the passkey.

## 6. E2EE and privacy

**Today**
- **Transport.** iroh encrypts each connection (R:213; C:751). Connections ending at the Aven Peer carry plaintext to it: statements, catch-up, and lines the hub passes on. Through the relay, QUIC stays encrypted between endpoints, but the relay sees device keys, IP addresses, timing and volume (C:768).
- **At rest, everything is plain.** The Aven Peer keeps statements, chat lines (device, sequence, time, text: ST:140-141) and file chunks in Hetzner Object Storage (ST:19-21, P:102). Peer-Lights keep the same in OPFS, together with the device secret (ST:211). Nothing is deleted (ST:51). What is stored plain stays plain after sealing arrives (ST:160-162).
- **This contradicts stated invariants:** "data stays sealed" (R:163-164), "sealed unless it is published" (R:169-170), "The Aven Peer only ever sees ciphertext" (R:199), "Receiving is not reading" (E:128-129), and "servers … can't read them" (C:3-6). Only R:180-182 admits that files are plain until caps.

**What the door reveals**
- **To every admitted device: the whole statement set.** That is every person's name and vault id, their passkey public keys, every device key, how many browsers each person has and in what order, every invite and withdrawal, and the config with the guardian key (statements.rs:36-53, hub.rs:3-5). This roster is the social graph. avenOS once sealed it (C2:348-354); caps accepts that the keeper sees it (C:769).
- **To the relay operator:** device keys, IPs and timing. A newcomer's statement travels as a relay token in a URL query (relay.rs:1-8, lib.rs:32), which a proxy's access log may keep; v1's Caddy fronts `/relay` (P:100).
- **To a refused browser:** that the network exists, and the coop's name (M2:22-23). "Nothing about the network is public" (R:160) holds only for discovery: DNS, the HTTPS relay and the deploy's config in a public repository are all public (P:103, 142).
- **To members on a direct path:** each other's IP addresses (R:164-165).

**What gossip reveals**
- **Content and presence.** Every member and the Aven Peer get every line in plain, with its device and vault. They also get presence (`here`, `bye`), "who joined" (M2:45, room.rs:4-12) and file announcements `{file, size, name, type}` (ST:109-111).
- **The topic.** It is derived from the network's id (M2:41) and never changes; only the door keeps outsiders off it.

**After sealing (planned)**
- **Hidden:** content is hidden from the keeper.
- **Still visible:** the tree, Doc ids, epochs, padded sizes, times, and who fetches what (C:769, 777).
- **No forward secrecy for kept data** (C:570-573).
- **Key escrow.** MaiaCityGuardian holds a seal on every keyring (C:669-670), which means escrow over all data for the evaluation phase.

## 7. Ontology at scale

- **Facts per entity.** In avenOS's replay, one invoice with two lines and a payment is 19 rows; with its document, vendor, contact and one bank transaction it is 43 (C2:204-205). 22 of its 49 fields had no place (C2:279-281). Closing those gaps the ontology's way adds facts: reify per rule 5, and round-trip the samples per rule 11. The added facts are currency, dates, references, the service period, each line's position, unit and tax rate, and a tax breakdown of referents (rate, base, amount). *Estimate:* 40–50 facts for the invoice alone and about 70 with its parties, each carrying a full version hash in `p` (O:116-121).
- **Reads.** `<kind>.list` joins the primary table to each trait (E:449-450). Queries scan, and indexes come "in a later iteration" (E:419-420, 491-496).
  - **The bound.** It is "the product of the Records each step can read, capped by `limit`" (E:417), and a query over the device's limit is refused (E:418). With N invoices, the three single-valued traits alone give about N^4, before lines and payments: 10^12 at N = 1,000. Capping by `limit` bounds output, not scanning. As written, the bound is either useless for joins or not a bound on work.
  - **Earlier speed came from indexes.** avenOS ran this grammar on indexed SQL columns (C1:45).
  - **Nested lists.** The core grammar projects only columns and `exists` (E:399-405). How `.list` returns nested `lines: [...]` (O:202) is unspecified.
- **Shared tables.** Type by position (O:73-75) puts every identifier, whether invoice number, VAT id or currency, in one `identifier` table, and every channel in `address`. Without indexes, each lookup scans all of them.
- **Sync granularity.** The Doc is the unit of reading, sealing and sync (D:40-44; C:137-138). With "a coop's books" in one Doc (O:123-124), every reader syncs and opens all of it, full history included (D:237). With one invoice per Doc (D:105-108), each invoice pays for its own head, key, caps and gossip topic (C:817; E:561 is still open). Neither has been chosen.
- **Convergence.** A slot id makes a `one` trait converge by last writer wins on one map key (D:135; O:86-88), so of two concurrent totals one is silently lost. Whether the slot id hashes the predicate's stable id or its version hash is unstated (O:57-58 against O:93-95). If it hashes the version, two versions of `due` keep two "only" facts, which breaks rule 9.
- **Caps churn.** Caps name lowered operation hashes (C:324), and every edit to a kind recompiles its four operations (E:446-453). Every holder's cap must then be reissued, at odds with "nothing … needs a deploy" (O:38-40).
- **Dedup.** Identity by hash dedups only byte-identical canonical definitions (O:144-146). Minted glosses differ, so dedup across vaults rests on the shortlist and on lenses (O:84-85, 214-224).
- **The invoice lesson.** C2 concludes three things:
  - ontology fidelity beat domain fidelity (C2:471-474);
  - extraction quality was the real bottleneck (C2:482-484);
  - the later reconciliation used flat, typed, versioned JSON-Schema records with integer minor units, not predications (C2:445-461).

  The ontology closes the fidelity gaps: typed money, order, samples and coined predicates (O:148-150, 288). It never mentions that later rebuild. avenDB now has two ways to model an invoice, plain typed Records (D) or facts (O:250-253), and no rule for choosing. C2 points to Records for transactional documents and facts for relations across kinds (tags, membership, provenance).

## 8. Strengths

- **Lean is the source of truth, with exported vectors and a running model** (R:46-52; S:509-528). Tests can't drift from the spec, and `Tree.check` names the first rule a tree breaks (S:597-599).
- **Authority is a small, decidable structure.** It is acyclic by rank and runs only down; devices govern nothing; a coop holds no devices. "Governing is ownership, never a cap" (C:126-127) keeps governance out of the cap grammar.
- **Every membership change is signed by whoever authorizes it.** The Aven Peer can't invent a member, whatever else it controls.
  - The admin's passkey signs invites.
  - The one-time key and the joiner's passkey sign joins.
  - Challenges bind the exact text, device key included, and the sender must be that device (Claim:31-34).
- **The door is checked at two points, and gossip messages are signed** (M2:38-42).
- **The store is one small contract,** blobs and compare-and-set refs. It is proven in Lean with a crash model, and the same traces run on four backends (S:113-138; ST:168-177).
- **Content is addressed by BLAKE3 everywhere.** Big files are hash sequences (ST:89-105), and iroh's transport replaces v1's own networking (E:366-380).
- **Production discipline:** no wipes, old formats read and tested (P:172-180; id/core/tests/before).
- **The documents are honest and measured.** They report loop times, backend benchmarks and open questions, and C has a metadata table and says plainly there is no forward secrecy (S:15-31, 161-174; C:568-573, 764-782).
- **The ontology turns avenOS's failures into rules:** typed places, money in minor units, slot ids for cardinality, one trait declaration for writing and reading, samples that must round-trip (O:79-95, 148-150).
- **The caps design needs no sequencer and seals nothing per device,** and it is tested against scale on paper (C:798-835).

## 9. Weaknesses, gaps, risks, contradictions, over-complexity

**Critical**
1. **MaiaCityGuardian is one key over everything.**
   - It co-owns every person vault, the admin's included, so it governs Maia City and Aven; "any one owner is enough" (C:667-668).
   - Its public half is unsigned config, re-derived at every restart (Claim:141-143, 203-207). It is absent from the texts people sign (Claim:74-76, Invite:50-52), and members take it on the Aven Peer's word (statements.rs:65).
   - Changing one GitHub variable and redeploying therefore re-owns every vault silently.
   - Once sealing comes it also holds a seal on every keyring (C:669-670).

**High**

2. **Members trust the Aven Peer's unsigned config:** rp, origins, guardian, coop and its own key (statements.rs:56-73). "Each peer checks them itself" (M2:39-40) holds only for statements, and nothing detects a split view yet (C:780-782 is future work).
3. **The claim is trust on first use, and the network can be re-claimed.**
   - The first signup wins (P:13-14), and while unclaimed the peer is open (members.rs:6-7).
   - Losing `refs/claim` unclaims the network (P:32). The bucket has real deletes and no backup (P:102).
   - Members pin no genesis, so whoever has the S3 keys or the deploy can become admin.
4. **Plaintext everywhere contradicts five stated invariants** (§6). Data written before sealing stays readable for good (ST:160-162).
5. **No device can be removed.**
   - Sign-out leaves the device admitted (M2:19-20), and every browser reset mints a new, permanent device (ST:171-174, SignIn:5-6).
   - Device secrets sit in OPFS, which the page's scripts can read (ST:211; C:967-968).
   - A leaked key is door access and read access to every plain line, for good.
6. **The Aven Peer does everything:** sequencer, only relay, gossip bootstrap, teller of the tree, only keeper. That contradicts "the members' network doesn't depend on the Aven Peer" (R:165), caps' rule 28 and its refusal of a sequencer (C:187-188, 822).
7. **The avenOS origin is in the trusted base of every passkey act.** WebAuthn signs blind, the page supplies the peer key and the relay, and device secrets live in OPFS (§5).
8. **Kind queries are unrunnable at modest scale.** The bound is a product, there are no indexes, and nested projection is unspecified (§7, E:417-420, 491-496).
9. **Slot ids are undefined across predicate versions** (O:57-58, 93-95). Rule 9's "at most one" can split silently.

**Medium**

10. **Restore re-checks against the current config.**
    - Dropping an origin, which a move to `maia.city` invites (P:71-72), fails every stored assertion, and the peer stops (Passkey:52-53, door.rs:12-13).
    - A changed guardian re-owns vaults silently.
    - Restore orders by ref name (Invite:319-333). That is safe only while ownership never changes, which ends in M3. No theorem covers restore.
11. **Two authority models are never reconciled:** device statements may act on everything the vault governs (Query:62-66), while admin acts need passkeys (Invite:182-185).
12. **Names collide across specs** (§3): chain ×3; line, lane, ref, envelope and peer ×2 each; view ×4; operation, network and agent ×4; member ×3; and admin, guardian and claim ×2 each. The specs define about 90 nouns, while caps faults v1 for "about twenty" (C:61).
13. **The layering contradicts itself.** avenPEER sits above avenDB (R:63-74) and also below the store (E:157-158, ST:70). avenID's caps depend on the engine above it (C:18). The ontology is a layer (O:101-109) and a plugin (E:84, 147). All of this sits under rule 11's "strict layers".
14. **Local first meets reset.** Offline writes queue in the local store (ST:28-34), but a store from an older avenOS is cleared (ST:171-174), so unsent writes are lost.
15. **Upgrades must be in lockstep.** Rule 9 allows no fallback for older peers (R:44-45), yet Peer-Lights live in long-open tabs on a production that is never wiped.
16. **Agents are defined three ways.**
    - O's minting agent is a *device* of the person's vault (O:96-97, 208-209), so before caps it can do whatever the person can (C:369-371).
    - It is an agent vault in R:97-99 and C:390.
    - `WF` lets an agent or another person own a person's vault (S:563, WF:30-41): nothing says an agent never governs people.
17. **Dynamic kinds cost cap reissues** (C:324 against O:38-40, E:446-453).
18. **`memberOf` excludes the admin's people** (Invite:174-178), while the prose and caps' revocation of "a network member" by the admin coop (C:621) assume it doesn't.
19. **One admin with one passkey until M3,** and only the guardian can recover it (C:663-664).
20. **Replacing an S3 ref relies on a single process.** Hetzner ignores `If-Match` (P:187-189; S:102-103), so an overlapping deploy, or a second peer pointed at the same bucket, can fork or lose `chat-*` heads.
21. **The lanes never test losing the Aven Peer or its relay, a member's relay, or several relays** (S:440-448; M2:79-87), though the resilience claim in R:165 rests on exactly that.
22. **Statements can be replayed:** no nonce, no expiry (Passkey:18-19). Once devices can be removed (M3), a removed device that kept its key could re-add itself with its old sign-in.
23. **Names are free and not unique** (Name:3-6). A member can call themselves "Samuel" or "Maia City", and vault fingerprints are still future work (C:780-781).
24. **Over-complexity: the gismu layer.**
    - It brings 1341 roots, full place structures and an LLM shortlist.
    - Rule 3 keeps unused places, which C2 shows left empty (C2:116), and VAT stalled on `parbi` (C2:242-244).
    - English glosses with typed places would keep most of the benefit.
25. **Over-complexity: three separate answers to "who is in".** The ownership tree, the membership list kept outside it, and caps' groups, plus four levels of vault for a single network.

**Low**

26. **Dangling paths:** `aven/ID/caps`, `aven/PEER` and `aven/actor` (20 references, e.g. E:53, ST:40, C:376). E:474 cites caps "rule 8" for double checking; that is rule 9.
27. **The store "never holds keys, caps or members"** (ST:84), yet it holds the device secret (ST:211), the statements (P:23-32) and, as S:99-100 puts it, "a peer's key".
28. **Clone detection is weak.** Synced passkeys keep the counter at 0, and invites and withdrawals skip the counter (Claim:36-38, Invite:32-33).
29. **`signin-{n:06}` sorts wrongly past 999,999 sign-ins** (door.rs:56), and restore depends on that order.
30. **R's door exceptions are missing.** R states the door without them ("the relay admits only members' keys", R:162-163), though members.rs:6-8 lets in newcomers and anyone while unclaimed.

## 10. Open questions

1. Who signs the network's configuration (guardian, coop, rp and origins, the Aven Peer's key), and where does that genesis live?
2. Should a person's claim or join name MaiaCityGuardian in the text they sign, and how are members told when it changes?
3. How does a member notice a re-claim, or a tree that differs from another member's? By a pinned claim hash, or gossiped heads?
4. What replaces the compare-and-set on `joined-<id>` once the Aven Peer is no longer the only keeper or relay?
5. Does "member" include the admin coop's own people? This decides caps' "network member" revocation (C:621).
6. Is the minting agent a device of a person's vault, or an `agent` vault with devices of its own? May any agent own a person's vault?
7. What does `$actor` bind to: a person vault, a device, or a software actor?
8. Do slot ids hash a predicate's stable id or its version hash?
9. How is the bound computed for joins on `id` and on slot ids, and do indexes come before the first kind with more than three traits?
10. Is one invoice one Doc, or are a coop's books one Doc? How many gossip topics may a device hold?
11. Are transactional documents such as invoices facts, or typed Records with lenses?
12. Once a device can be removed, what keeps its old sign-in from being replayed: a nonce, an expiry, or tombstones that restore honours?
13. How does a Peer-Light's offline queue survive a reset of its store format?
14. With no fallbacks for older peers (rule 9), how are open tabs and installed apps upgraded?
15. Is a backup of `city-maia-aven` planned, and who may restore it without re-opening the claim?
