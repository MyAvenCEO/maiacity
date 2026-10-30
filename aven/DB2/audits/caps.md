# Audit: avenID caps (`aven/DB2/id/caps/README.md`), main @ 2c1a9890, 30 Oct 2026

Refs (path:line): **R** `aven/DB2/id/caps/README.md` · **Q** `aven/DB2/id/caps/research.md` · **CL**, **IN**, **TR** `aven/DB2/id/spec/Aven/ID/{Claim,Invite,Tree}.lean` · **ST** `aven/DB2/id/core/src/statements.rs` · **A** `aven/DB2/README.md` · **P** `aven/DB2/PRODUCTION.md` · **M2** `aven/DB2/MILESTONE2.md` · **D** `aven/DB2/db/docs/README.md` · **E** `aven/DB2/db/engine/README.md` · **O** `aven/DB2/db/ontology/README.md` · **S** `aven/DB2/store/README.md` · **AA** `aven/actor/ARCHITECTURE.md` at commit 6f99f9f2 (a branch; absent from main). Severity: **C** critical, **H** high, **M** medium, **L** low.

## 1. Purpose and scope

1. Audit of the caps spec (R, 988 lines) and its research (Q), read against today's avenID Lean (tree, claim, door, invites), the Aven Peer's statements code and the docs, engine, store, ontology, production and actor specs.
2. The bar: caps bulletproof for an E2EE, local-first, P2P network where no server peer holds any privilege its owners didn't grant by cap.
3. Read only, nothing built or run. The caps Lean (`Caps`, `Revoke`, `Epochs`, `Approve`, `Recover`, R:901) doesn't exist yet, so every theorem below is a plan.

## 2. Primitives

| Primitive | Definition | Named by | Issued / held by | Stored | Mutable |
|---|---|---|---|---|---|
| Key | Signs (Ed25519, ML-DSA-65, ES256) or opens (X-Wing); hybrid signature = Ed25519 + ML-DSA-65, both verify (R:77-78) | public half | made on device; PRF-derived for passkeys (R:696-699); offline for guardian, kit | statements, keyring | rotates |
| Vault | Principal: owners (keys or vaults) acting k of n (R:213, R:652-656); kinds person, agent, coop, device (TR:12-17) | id | founded by claim/join statements (CL:145-151, IN:152-154) | the tree, in the Aven Peer's store (CL:7) | by governance |
| Governs | Ownership followed down the tree; never a cap, never a device (R:126-127) | — | owners | tree | — |
| Device, device cap | A device vault and key acting for one vault; default cap: all its vault may do except govern (R:79-81, R:369-371) | key id | owner adds it (passkey sign-in, pairing) | tree; where device caps live is unspecified | removable |
| Cap | Signed Value `{issuer, holder, parent, grants, conditions, nonce}` (R:238-262); hybrid signature beside it over `avenID cap 1` + hash (R:264-266) | BLAKE3 of canonical JSON (R:236) | issuer vault: one device, or owners k of n (R:400-406); holder: vault, group `g:<doc>` or ticket key (R:258) | Doc's access map; the group's Doc for vault-wide caps; the receiver's vault for `tell` (R:413-419); delivered by letter | never; ends by revocation or expiry |
| Grant | target × operations × lines, or role + target (R:260) | inside a cap | — | — | no |
| Target | Doc; vault's Docs; by root type; ±`below`; actor; actor + spawned; actors of one definition (R:274-282); one grammar with wants (R:135-136) | JSON | — | — | — |
| Operation | `read` (crypto), `query` (key holder), `write`, `mutate` (every reader), `tell` (router), `keep` (nothing checks), `share` (readers) (R:291-299) | name | — | — | — |
| Footprint | Per lowered core step: type; verb `put-new`/`put-replace`/`patch`/`remove`; fields with constraints (literal or param, `$actor`/`$vault`, `{ref}`, `free`, `$now`); `where` only on never-changing fields (R:307-322) | lowered op hash (R:324) | computed once (E1–E3, R:893-897) | — | fixed |
| Condition | `not_before`, `expires`, `approve`, `uses`, `budget`, `own`, `lines`, `history` (R:330-337) | in cap | — | — | — |
| Chain, root cap | A cap and its parents up to a root issued by the target's vault or one governing it (R:96-97, R:408) | cap ids | — | — | — |
| Role | Value `{role, name, grants}` with `$target` (R:341-344) | hash | its vault | — | never; change = revoke and reissue |
| Approval | k named owners' signatures over one act's digest, once; a vault owner approves by its own quorum (R:99, R:181, R:652-656) | digest | owners | beside the act | — |
| Ticket | One-time key holding a cap until a vault claims it; invites are tickets (R:100, R:392-394) | its key | owners k of n (R:403) | its link carries the secret | claim-once undefined outside the Aven Peer's CAS |
| Revocation | Signed Record ending a cap and every cap resting on it (R:101, R:636-637) | hash | issuer, any issuer up the chain, target's vault, holder (R:618) | Doc's access map, or the group (R:626-628) | no |
| Ack, kept list | A writer's mark inside an envelope that it saw a revocation (R:102-104); per Doc the revoker holds, the revoked holder's last envelope it saw (R:105-106) | — | other writers; revoker | sealed envelopes; revocation | no |
| Letter, letterbox, tag seed | Sealed Value with the cap, the target's Doc or group ids and the holder's tag seed; first letter to the recipient's letterbox, later ones under pair tags (R:421-428) | hash | sending device, hybrid-signed | keeper, served to any member (R:611-612) | no |
| Group | A Doc whose readers are its members; its key opens Docs sealed to it; may hold caps (a proposal, R:149-150, R:372-375) | `g:<doc>` | any device, no governance (R:375) | a Doc | roster changes |
| Keyring | A vault's own Doc of keys, holding the vault key; the only Doc sealed to devices (R:113, R:158-160, R:491) | Doc | its vault | keeper | rotates |
| Vault key, group key | X-Wing pairs; private half in the keyring or the group's Doc (R:114-115) | public half | — | — | implied to change when a device or reader leaves |
| Epoch, key blob, stanza | One Doc key between rotations; key blob `{doc, n, prev, scheme, stanzas[{tag, ct}], commit, back}` (R:110-111, R:509-522) | BLAKE3 of key blob | any writer, before writing (R:524-529) | `epoch` Record and a blob | no; concurrent epochs coexist |
| Subkeys, file key | `avenDB envelope/segment/snapshot/fetch/topic/converge 1` (R:537-543); file key = keyed BLAKE3(converge secret, BLAKE3(plaintext)) (R:549) | label | derived | key in the file's Record | per epoch |
| Keeper, keep cap, fetch key | Peer keeping and serving sealed bytes; keep cap = Doc ids or group, per-epoch fetch public halves, topics, quota, payer (R:117-118, R:603-607); serves only to a device signing the TLS exporter with the current fetch key (R:609-610) | — | issuer unspecified; "nothing to check" (R:298) | keeper | per epoch |
| Heal | Revoke the device, new device keys, rotate keyring, every group, Docs lazily (R:575-583) | — | owners | — | — |
| PRF keys, kit | Hybrid owner key and X-Wing seal key from the PRF over `avenID prf 1` + vault id + owner's epoch (R:693-700); a printed kit derived the same way (R:685-686) | statement | passkey; person | vault statement | by owner epoch |
| MaiaCityGuardian | Offline key, owner of every person vault; every keyring sealed to it once sealing comes (R:666-671) | id `maia-city-guardian` (CL:91); public half by configuration (P:42) | Samuel | offline | exit written (R:673-677) |
| Message cap, standing cap, inbox Doc, router, kernel | Cap beside `run`, narrowing per hop; an actor's own cap for its own duties; inbox Doc of the sender's vault, born with the tell cap; router checks `tell`; kernel holds keys (R:378-389) | — | kernel holds them for actors | inbox Docs | — |

## 3. Glossary

Marks: [≈ X] near-synonym of X elsewhere; [≠ X] same word, another meaning elsewhere.

- **access map**: a Doc's Records of avenID types `cap`, `revoke`, `epoch`, sealed with it (R:414-415).
- **ack**: a writer's mark that it saw a revocation (R:102-104). [≠ actors' delivery `ack` frames, AA:374]
- **approval**: k owners' signatures over one digest, used once (R:99, R:181). [≈ avenDB-old threshold, consent, merge accept (R:224)]
- **back**: the previous epoch's key sealed under the new one (R:520-521).
- **below**: target flag adding the vaults it governs (R:277, R:501).
- **branch / line**: a run of history; caps says "branch" (R:175-176, R:841) and "lines" (R:336). [≈ docs **line** (D:57-59); docs proposes "branches" (R:336)]
- **cap**: a signed grant (R:87-88; A:115). [≈ avenDB-old share, avenOS tenant grant (R:222)]
- **chain**: a cap and its parents up to a root (R:96-97). [≠ store's per-device **chain** of chat lines (S:137-147); ≈ "proof" (R:215)]
- **commit**: a commitment to an epoch's key (R:518-519). [≠ engine/docs commit of a mutation (E:334); ≠ MLS commit (R:587)]
- **condition**: what narrows a cap's use (R:95, R:330-337).
- **convergence secret**: the `avenDB converge 1` subkey keying file keys (R:543, R:549). [≈ A:177 "space's secret"]
- **device, device cap**: R:79-81, R:369-371. [≈ avenDB-old "device rights" (R:229)]
- **Doc**: mutable Loro document by stable id; unit of sealing, caps and sync (D:41-43). [same as docs]
- **door**: admission at the relay and every peer's hook (IN:19-23, IN:338-347); "a cap to connect in all but name" (R:231). [it is not a cap]
- **envelope**: signed, sealed Loro changes (D:53); caps fixes its inside and outside (R:841). [same as docs]
- **epoch**: one Doc key between rotations, named by its key blob's hash (R:110). [≠ "owner's epoch" in the PRF input (R:694); also keyring and group epochs; docs agreed "key epoch" (R:841)]
- **fetch key, fetch proof**: per-epoch key; proof = signature over the TLS exporter (R:118, R:609-610).
- **fit**: schema verdict (D:65); caps says it "never changes" (R:185, R:453). [≠ docs: keyed by lane and code version (D:91, D:254)]
- **footprint**: what a write may touch (R:93-94, R:307-322). [≈ engine footprint, narrower: "documents and types" (E:95)]
- **governs**: ownership down the tree (R:126-127; TR, Governs.lean).
- **group / in a group**: a Doc whose readers are its members; holding read on it (R:82-83). [≠ avenDB-old built-in and cap groups (R:221)]
- **heal**: post-compromise act (R:575-583).
- **holder, issuer**: R:89.
- **hybrid signature**: Ed25519 + ML-DSA-65 over the same bytes (R:77-78).
- **inbox Doc**: messages from A to B, owned by A's vault, written by A's home device (R:386-387; AA:375). [same as actors]
- **keep (operation), keep cap**: keeping sealed bytes without a key (R:298, R:603-607). [≠ device profile `keep` tiers (E:302); ≈ avenDB-old keep share (R:226)]
- **keeper**: a peer keeping sealed bytes it can't open (R:117). [≈ actors' "keeper peer holds the inbox" (AA:373); ≈ engine "receiving is not reading" (E:128-129)]
- **kept list**: R:105-106.
- **kernel**: holds actors' keys, runs only what a message's cap names (R:383). [actors' kernel]
- **key blob**: an epoch's stanzas, commit and back (R:111). [a store blob]
- **keyring**: R:113, R:491.
- **letter, letterbox, tag seed**: R:107, R:421-428.
- **loads**: an actor's declared wants (R:792). [≈ engine "manifest" (E:92)]
- **member**: a person's vault let in through the door, `memberOf` the admin coop (A:116-117, IN:174-178); distinct from "in a group" (R:83).
- **mutate**: operation naming lowered core operations by hash (R:296). [≠ engine `op: "mutate"` of a plugin (E:228)]
- **operation**: a permission verb of a cap (R:92). [≠ engine **operation**: a stored JSON spec of work (E:81); caps' `query` and `mutate` name engine operations by hash]
- **owner**: a key or vault owning a vault (TR:19-23).
- **pseudonym**: the writer's Loro peer per Doc and branch, outside the seal (R:175-178). [≈ docs **peer** (D:57, D:143)]
- **query (operation)**: running named stored queries through a key holder (R:294). [≈ engine query]
- **reader**: what an epoch is sealed to, a vault or a group (R:112). [≠ "every reader checks every write" = any importing device (R:141)]
- **revocation**: R:101.
- **role**: a named bundle of grants, pinned by hash (R:98).
- **root cap**: R:96-97.
- **rotation**: a new epoch for the remaining readers (R:116).
- **router**: the receiver's kernel part that checks `tell` (R:384). [≠ iroh `Router` (A:208)]
- **run, run cap**: the causal chain of messages, with a cap that narrows per hop (R:378-381). [actors' `run` (AA:117)]
- **scheme / suite**: key blob layout (`flat 1`, `tree 1`) / algorithm id on seals and signatures (R:189-190).
- **seal, unsealed**: R:535-555; publishing a Doc unsealed needs owners (R:405).
- **segment**: a sealed batch of envelopes, one epoch, hybrid-signed inside (R:544-547). [docs segment]
- **share (operation)**: issuing narrower caps, to a depth (R:299). [≠ avenDB-old "share" = a cap (R:222)]
- **snapshot**: each device's own, never travels (R:841). [≠ A:170-173, which has snapshots travel]
- **stanza, tag**: an epoch key sealed to one reader, found by a keyed tag (R:515-517).
- **standing cap**: an actor's own cap (R:380-381). [≈ avenDB-old standing grant (R:228)]
- **statement**: a body a device or passkey signs (CL:31-34); carries the tree.
- **target**: R:90-91. [same as engine want target (E:274)]
- **tell (operation)**: sending named messages as `tell` or `ask` (R:297). [≠ actors' message kind `tell` (AA:103)]
- **ticket**: R:100. [≈ invite (IN:13-17)]
- **topic**: gossip topic from the `avenDB topic 1` subkey (R:554-555). [≠ M2's one topic per network (M2:41)]
- **tree**: avenID's vaults and keys (TR:46-49). [≠ `tree 1` key-tree scheme (R:522); ≠ Loro Tree container (D:133)]
- **Value**: immutable bytes by hash; caps, roles, key blobs and letters are Values (D:37-40). [= store blob]
- **vault fingerprint**: R:780-781.
- **want**: demand that grants nothing; served = wants ∩ caps (R:179-180, R:786-791). [engine want; ≈ avenDB-old interest, keep share (R:226)]

## 4. Rules and invariants, condensed

- **Authority.** Only keys sign; only vaults, groups and tickets hold caps; devices act within device caps and never govern (R:124-127). Every cap narrows its parent in targets, operations, footprints, conditions and share depth; a root rests on authority over the target's vault, which runs down the tree (R:128-130, R:408). The verifier computes the chain; caps and roles are fixed by hash (R:131-132, R:341-344). Operations, not levels (R:133-134).
- **Grammar.** One target grammar with wants; a cap never names a query (R:135-136). Caps name lowered core operations; envelopes carry the op hash and params; `where` only on immutable fields (E1–E3, R:893-897).
- **Read and write.** Read = holding the Doc's key; nothing inside a Doc is secret from its readers (R:137-138). Write needs read (R:139-140). Every reader checks every write; an uncounted change and all built on it show on no line (R:141-143). Without the key, the key holder checks (R:144-145). Hidden is not refused (R:146).
- **Placement.** Caps live where their checkers read them (R:147-148); groups hold caps for their members (R:149-150).
- **Revocation.** Wins over what it hadn't seen and cascades; takes effect per Doc at its first ack (R:151-154, R:636-637). Removal closes reading at the next epoch (R:155-156). A write uses an epoch no older than its causal past's (R:157). Removals beat additions; mutual removal that empties a vault fails (R:644-648).
- **Keys.** Docs sealed to readers (vaults or groups), only keyrings to devices (R:158-160); keys travel with what they open (R:161-162); nothing re-encrypted (R:163-164); concurrent rotations both valid, next writer takes the smaller hash (R:527-528); readers check staleness only (R:531-533).
- **PQ.** X-Wing for every key sent; hybrid on caps, revocations, governance, approvals, letters, segments, checkpoints; Ed25519 on live envelopes; suites named (R:165-170). Passkey acts need the assertion and the PRF-derived hybrid signature (R:170-171).
- **Network.** The keeper is blind: door, quota, fetch proofs, never a write cap (R:172-174). The signer is inside the seal (R:175-178). A want grants nothing (R:179-180).
- **Conditions.** Approval = k co-signatures over one digest, once (R:181). Conditions only narrow; uses and budgets only where one checker counts (R:182).
- **Verdicts.** Fail closed: counts, doesn't, or waits (R:183-186); fit, authorized, not-split; a revocation can turn "authorized" and rebuild state (R:452-462); merges count only when the merger's grant covers the whole merge (R:448-450). No global state; proofs travel with acts (R:187-188).
- **Recovery and process.** Never one key, except the guardian through evaluation (R:191-192); the UI holds no rule (R:193); Lean first (R:194).

## 5. Trust model and attack surface

| Party | Sees | Can do | Note |
|---|---|---|---|
| Person | All its vault reads; the keyring through its passkey's PRF (R:706-710) | Govern its vault (k = 1 today, "any one owner is enough", R:668), approve, recover | Trusts its devices, the web origin serving avenOS (P:100) and its passkey provider (R:661), none modelled |
| Device | Keyring → vault key → everything its vault reads (R:491); keys in OPFS, readable by page scripts (R:967) | Sign within its device cap; issue single-Doc root caps alone (R:402); never govern | A device cap can't narrow reads: the keyring is sealed to every device (R:491) |
| Vault | Its Docs, groups, caps, letters | Issue caps; govern below (R:408) | — |
| Group member | Group key → every Doc sealed to the group; the roster (caps in its access map) | Use group caps; delegate them (R:404); a group-vault device adds members alone (R:402, R:375) | Adding a member extends owner-approved vault-wide caps with no approval |
| Admin coop (Maia City's owners) | The tree | Invite, withdraw (IN:6-11, IN:210-220), remove members (R:621), publish the network's schema lane every vault reads (D:192, O:155), govern Aven and its Peer | The lane decides fit for every vault; not a cap |
| Aven Peer, as keeper | Per R:769: the tree, per-Doc ids, epochs, padded counts and sizes, times, who uploads or fetches, per-segment pseudonym, counters, prev; letterboxes; topics. Also (§6.5): signers, readers, Doc → payer | Keep, serve, withhold, delay, serve stale; accept fake fetch keys and uploads from any member (R:605, R:298) | Blind to content; not to identities |
| Aven Peer, as relay and door | Device keys of both ends, IPs, timing, volume (R:768) | Admit or refuse any device (IN:338-347); be the only path for browsers (A:158-159), so eclipse them | The door is no cap (R:231, R:981) |
| Aven Peer, as tree custodian | Every statement | Order claims and joins by CAS (CL:27-29); choose what it tells peers (ST:1-4); supply the unsigned guardian, coop and RP settings peers adopt (ST:57-73) | Not caps |
| Aven Peer, as actor home | Plaintext of hosted actors' Docs (R:845) | Hold their keys; pick the cap a turn runs under (R:383) | Owner-granted by placement; deputy checks are kernel-internal |
| Hetzner (VM, Object Storage, DNS) | All the keeper sees, plus the Peer's key file (P:105-108), its config and memory, Caddy's TLS key | All the Aven Peer can; rewrite or delete the store (a wipe unclaims the network, CL:200; forbidden only by policy, P:172-180); serve a modified avenOS (P:100) | Listed only as "storage" (R:769) |
| Deploy operator, GitHub `production` | Public repo, environment variables | Set `--guardian` (P:42, P:136), RP ID, origins, coop; ship peer and avenOS builds with no reviewer (P:119-120) | Not in the spec at all |
| Any origin under `maia.city` | Page memory | Ask any `maia.city` passkey (RP ID, P:71) for the PRF at its predictable salt (R:694); v1's `maia.city`, `api.`, `avendb.`, `www.` share that domain | Not in the spec |
| Passkey sync provider | Synced passkeys | An account takeover is an owner key and the keyring's PRF (R:661) | Unstated dependency |
| MaiaCityGuardian holder | Everything, once keyrings seal to it (R:669) | Any act on any person vault (R:668) | Kept by D12; Ed25519 only (P:40) |
| Any relay | As the Aven relay | DoS, traffic analysis | Enforces the door |
| Kernel | Plaintext of its actors' loads | Runs the ops a message's cap names; counts uses and budgets (R:182, R:383) | Trusted |
| Actor | `given`: loads ∩ run caps (R:792-793) | Emit operations within the message's cap; standing cap only for own duties (R:380-381) | — |
| Malicious member, not a reader of D | The whole tree with every name; key blobs and letters of every Doc (R:611-612) | DoS the keeper with fake fetch keys and uploads; spam letterboxes | Contradicts R:771 |
| Malicious writer of D | D's caps, writers, reader count (R:772) | Leak (inherent); launder a revoked holder's writes by a late ack (§7); "expire" caps early by its clock; grind a concurrent epoch to the smaller hash (R:527-528); name a bogus revocation so builders wait | — |
| Stolen device | As a device, until the removal reaches each Doc | Write until acked (R:631); mint single-Doc caps to the thief (R:402); read current epochs until each Doc's next write (R:559-566) | The heal never revokes its minted caps (R:575-583) |
| Network observer | IPs, timing, volume, SNI | Record now; transport is classical (R:751) | Later sees what the relay and keeper see |

**Privileges a server peer holds that no owner granted by cap:**

| Privilege | Holder | Removed by the spec? |
|---|---|---|
| Door: admit or refuse any device | Aven Peer's relay and hook (IN:338-347, M2:38-40) | No. Called "a cap in all but name" (R:231), then left to milestone 2 (R:981) |
| Tree custody: first claim wins by CAS (TOFU), joins, sign-ins, withdrawals and what is told | Aven Peer (CL:27-29, IN:15-17, ST:1-4) | No. Tree-head gossip only detects, and the head is undefined (R:780-782) |
| **Which key is MaiaCityGuardian**: an owner of every person vault, chosen by `--guardian`, never signed by the person (claim and join texts omit it, CL:74-76, IN:50-52); peers adopt it from the Peer's JSON (ST:65), and a restart with another value swaps it in every vault (CL:141-143, CL:203-207) | Aven Peer config, deploy operator | **No.** D12 keeps the guardian a full owner and seals every keyring to "the guardian's seal key" (R:669) without binding that key to anything the person signed |
| Admin coop id and name, RP ID, origins | Aven Peer config, unsigned (CL:22-24) | No |
| Serving avenOS's code to browsers | Caddy on the same host (P:100) | No; not mentioned |
| Quota and who pays | Keeper policy (R:607, R:844) | No |
| Keep anything; serve key blobs and letters to any member | Keeper (R:298, R:611-612) | No |
| Accept fetch-key updates and uploads for any Doc | Keeper (R:605) | No: unauthenticated |
| Only keeper and relay for browsers (eclipse) | Aven Peer | Later: many keepers, any member's relay (R:815, A:165) |
| Hold hosted actors' keys and pick the turn's cap | Aven Peer kernel (R:383, R:845) | Partly: owner-granted, not reader-verifiable |
| Wipe = unclaim; a new claimant owns the admin coop | Store operator (CL:200) | Policy only (P:172-180) |
| Full owner of every person vault | MaiaCityGuardian (R:666-671) | Kept for evaluation; exit written (R:673-677) |

## 6. E2EE and privacy

**Keys per layer.**

| Layer | Keys | Sealed to | Rotates | Note |
|---|---|---|---|---|
| Device | X-Wing, Ed25519, ML-DSA-65, made on device (R:490) | public halves in its statement | on suspicion or schedule | browser: OPFS, page-readable (R:967) |
| Passkey | ES256; PRF → hybrid owner key, X-Wing seal key (R:696-699) | public halves in the vault statement | owner epoch | PRF output crosses the page (R:737) |
| Keyring | per-epoch key; vault key (X-Wing) inside (R:491) | devices, passkey seal keys, guardian; a coop's to its owners' vault keys | a device or sealing owner leaves | root of all its vault reads |
| Group | per-epoch key; group key (X-Wing) inside (R:492) | its readers, vaults and groups | a reader leaves or rekeys | flat now, `tree 1` later (R:522) |
| Doc | per-epoch key (R:493) | type group, shared groups, ≤ 64 vaults (R:503) | next write after a reader leaves | `back` opens all history (R:520-521) |
| Subkeys, files | six labels (R:537-543); convergent file keys (R:549) | — | per epoch | dedup within an epoch |
| Letters, tickets | X-Wing to the holder's vault key (R:421); one-time key (R:100) | — | — | a ticket is a bearer secret |
| Guardian | Ed25519, X-Wing planned (R:669-670) | keyrings sealed to it | exit | no ML-DSA: breaks rule 20 (R:167) |

**Sealed:** envelopes and segments with branch, signer, cap, acks, op, params, changes and schema inside (R:841); files; the access map; every key in stanzas, letters and `back`. **In the clear:** the tree and statements with every member's name, passkey and device keys (CL:79, IN:153), told to every admitted device (ST:1-4) and stored as plaintext blobs (P:23-32); segment headers (Doc, epoch, pseudonym, counters, prev, length); key blob structure (`doc`, `n`, `prev`, `scheme`, tags, `commit`); keep caps (Doc ids, fetch public halves, topics, quota, payer); letterbox addresses; store ref names (`claim`, `joined-<invite>`, `chat-<device>`, S:142); published Docs (R:405). A:199 ("only ever sees ciphertext") overstates.

**Forward secrecy and healing, as claimed.** None for kept data, by design, stated honestly: old keys are kept and the newest key opens the past through `back` (R:570-573), so one Doc key exposes that Doc's whole history, one group key every Doc sealed to it, one keyring epoch everything. FS only for never-kept presence, typing and calls, later. PCS only through the heal (R:575-583), by hand or on a schedule (open, R:969); until then a silently copied device key stays good (R:582-583). The heal's steps omit replacing the vault key and tag seeds explicitly and omit revoking caps the device minted (§7).

**What removal really guarantees.** As claimed (R:557-566): no epoch made after a writer saw the removal opens for the removed; concurrent writes by unaware writers stay readable; what was read stays read; a removed device keeps the keyring as it was. In addition:
- It holds only if writers learn of the removal. A keeper that withholds a revocation or a newer epoch from a writer (browsers have no other path, A:158-159) gets new writes sealed under an epoch the removed reader opens.
- Group removal must rotate the group key at once, or Docs re-seal to the old group key; this is implied by "before writing, a writer rotates" (R:525-526) and the revocation being a write, never stated.
- `history: from-now` can't be honoured for group or vault-wide grants: a new group reader gets each Doc's current key and, through `back`, all its history (R:499-500, R:520-521).
- A network member's removal leaves its caps standing (R:621), so writers keep sealing to it.
- A removed reader keeps the tag seeds and can test future key blobs, served to any member, for which readers remain.

**Metadata: what the spec claims hidden but isn't.**
- **Signers:** the pseudonym is the Loro peer, the first 64 bits of BLAKE3(device key, Doc, line) (D:143), worked out from the signing device so importers can check it (R:177). The keeper holds every device's public key (R:769), so it computes the pseudonym of every device for `main` and guessable lines. Rule 22's "no signer" (R:173) and R:769's "not who it is" fail.
- **Readers:** fetch proofs come over door-identified connections (R:609-610) and topic joins name devices (R:554-555), so the keeper learns "device X reads Doc D", which R:769 lists as unseen ("who reads which Doc").
- **Group rosters:** members fetch the group's Doc with its fetch key, and stanza tags may repeat across Docs (below).
- **Doc ↔ vault:** keep caps carry the paying vault (R:607).
- **Social graph:** first contact names the recipient (R:427), and pair-tag uploads and fetches come from identified devices (R:774-775).
- **Memberships:** bursts of rotations after a device removal (the heal goes "busiest first", R:582) reveal which groups a vault is in.
- **Any member** sees every member's name, devices and passkeys, and every Doc's key blobs and letters (R:611-612), contradicting R:771 ("nothing of it").
- **Relay:** both endpoint keys of every relayed connection (R:768) give the device-level contact graph, which the tree maps to names.

**The blind index.** avenDB-old had one: keyed BLAKE3 tokens per key family, epoch and label, which let the server answer "which entries carry this label" and learn equality (Q:82-83, Q:108-109), and it leaked who shares what and creation order (Q:140-148). The engine dropped it by default (E:505-508). What remains is a de facto blind index: deterministic tokens the keeper indexes by.

| Token | Derived from | Linkable across | Equality reveals | Fix |
|---|---|---|---|---|
| Doc id | creation | its whole life | one Doc's activity timeline | per-epoch storage ids keyed by the epoch, `prev` inside the seal |
| Epoch hash, `prev`, `n` | key blob (R:509-512) | per Doc | rotation times, i.e. membership changes; cross-Doc bursts | jitter, batch rotations |
| Stanza tag | keyed BLAKE3(reader's tag seed, epoch number) (R:515-517); the seed is "the holder's" (R:425) | **Docs**, if a seed serves many Docs (a type group reads every Doc of its type), since the Doc id is not an input | which Docs share a group, so vault and type clusters; counts padded to a power of two | include Doc id and epoch hash; one seed per (reader, Doc); rotate seeds on removal |
| Writer pseudonym | BLAKE3(device key, Doc, line) (D:143) | epochs, by design (R:177) | the signer's identity (computable) | key it with a per-Doc secret carried forward in each epoch's key material |
| Counters, prev segment | Loro (R:175-176) | per writer | each writer's volume | inherent while keepers serve by version (R:975-977) |
| Fetch key | `avenDB fetch 1` (R:541) | per epoch | reader devices, via identified proofs | unlinkable tokens (blind signatures), proofs through other members |
| Topic | `avenDB topic 1` (R:542) | per epoch or group | subscriber devices | as for fetch keys |
| Letterbox, pair tag | recipient; pair secret (R:427-428) | per pair, if the tag is static (unspecified) | communication edges and their frequency | per-letter ratcheted tags, cover traffic |
| File blob | convergent key (R:549-553) | within an epoch, and across Docs when a Record is copied (R:553) | duplicate files; the same blob fetched under two Docs links them; size to 64 KiB unless padded (open, R:974) | Padmé on files; re-seal when cross-Doc unlinkability matters |
| Quota payer | keep cap (R:607) | per Doc | Doc → owner vault | blinded quota tokens |

Verdict: private against content, not against metadata. Frequency attacks work on segment and counter volumes, rotation cadence and file equality; correlation attacks (upload versus fetch timing, rotation bursts after tree changes, topic joins) dominate and are admitted only as "access patterns" (R:777-779). Scoping is per epoch for stanzas, fetch keys and topics, not per Doc for stanza tags, deliberately not per epoch for pseudonyms, and never for Doc ids. The bar of R:172-174 and R:769 is not met as written; either the claims shrink or the fixes above come in, ideally before formats freeze (R:189-190).

## 7. Adversarial stress test

| Attack | What happens per the spec | Verdict |
|---|---|---|
| Revoked member writes offline, then syncs | After a Doc's first ack, its writes count only if an ack had seen them (R:631-633). But any writer that imported them before naming the revocation makes them count with its first ack (R:102-104, R:153-154); for vault-wide caps and device removals every other writer's first naming envelope is an ack (R:627-629) | Partial |
| Concurrent revoke and write | Settled the same way by every reader through acks; honest concurrent work is cut and shown "didn't count", re-applicable by someone still holding a cap (R:624-634) | Covered, with the per-writer window |
| Laundering by a colluding writer | A writer with any live write cap imports the revoked holder's later writes, even ones causally after the revocation, and delays naming the revocation; its eventual ack "had seen" them, so they count under the revoked cap's wider footprint. `revocation_wins` (R:912) allows this. R:626 hints only the revocation's past counts for Doc caps; the ack definition says otherwise | Not covered |
| Stolen device before revocation | Holds the full device cap (R:369-371): writes until acked; reads the keyring and every current epoch; mints single-Doc root caps with `read`/`write` to the thief's vault (R:402). The heal (R:575-583) revokes the device, not those caps, and rotations then seal to the thief's vault as a legitimate reader. If instead the signer check uses today's tree ("as the reader holds it", R:437), every honest cap that device ever signed breaks | Not covered |
| Malicious keeper withholds | Can't forge; readers wait or show stale state (R:183-186). Withholding revocations or newer epochs from a writer gets new writes sealed to an old epoch that removed readers open (R:524-526) | Partial |
| Malicious keeper reorders | CRDT order-independence and causal acks ("in any order of arrival", R:912) | Covered |
| Malicious keeper replays | Envelopes idempotent, caps immutable, revocations by id (R:262). A stale key blob served as current is caught only if the writer knows newer ones | Mostly covered |
| Malicious keeper forks | Signed segments; readers' and keeper's split checks (R:175-176, R:452-455). Tree equivocation: gossip of an undefined "tree head" (R:780-782) | Partial |
| Any member poisons the keeper | Sends a fake fetch public half for any Doc (R:605), uploads junk segments under computable pseudonyms; the keeper can't tell (R:298) | Not covered |
| Confused deputy via actors | The kernel runs only the message's cap's operations (R:378-385); readers see only the host device's signature and its vault's caps, so the check is kernel-internal | Partial |
| Cap chain forgery or widening | Subset checks per link, chain computed by the verifier, roles pinned, hybrid signatures (R:128-132, R:264-266). Holes: `below` reads upward (R:501); children of a group cap survive the issuing member's removal, since liveness covers the writer's group read (R:444), not the issuer's (R:404); no partial order for conditions such as `approve` sets; `uses` on writes unenforceable (R:182, R:334) | Partial |
| Replay of old grants | Revocation by id, nonce (R:262), expiry. A Doc ticket claimed twice concurrently: no order exists outside the Aven Peer's CAS (R:392-394) | Partial |
| Guardian compromise | Owner of every person vault; any one owner suffices (R:668); keyrings sealed to it (R:669): read everything, add devices, remove owners, win every clash as the recovery owner (R:646-647) | Accepted (D12); not covered |
| Guardian swap by configuration | `--guardian` changes, peer restarts: every person vault gets the new key as an owner (CL:141-143, ST:65, P:136) | Not covered |
| Passkey loss | Other seals: devices, other passkeys, kit, guardian (R:658-664, R:734-736) | Covered while the guardian stays; after its exit, only with a kit |
| PRF missing | Pairing by QR and short code, kit, guardian; that passkey's owner signatures are classical (R:728-732) | Partial |
| PRF theft by script | Any page on any `maia.city` origin can request the PRF (P:71, R:694) and open the keyring; R:737-738 names only scripts during a ceremony | Not covered |
| Quantum adversary recording now | Stanzas, letters and keyrings are X-Wing (R:746); content symmetric (R:750). Transport is classical (R:751): the tree, Doc ids, fetch proofs and letterboxes fall later. The PRF crosses classical CTAP channels: USB and NFC are noted (R:738-740), hybrid (caBLE) phone-to-desktop through a tunnel service is not. Guardian Ed25519 and ES256-only owners are forgeable later | Partial |
| Metadata correlation at the relay | Endpoint pairs, IPs, timing (R:768); mixing later (R:777-779) | Not covered |
| Member colludes with the keeper | Hands over tag seeds and keys (inherent leak); together they eclipse writers so a removed member keeps reading | Not covered beyond the inherent |
| Huge group churn | Flat up to about 256, then `tree 1`, groups of groups, hourly batches, weekly renewals (R:596-599, R:806-809) | Designed, not built; access-map growth unbounded |
| Clock attacks on expiry | Writes are judged by the writer's own signed time (R:332, D:75): an expired holder backdates until another writer acks (R:639-640). `not_before` falls to a forward-dated envelope. Any writer with a fast clock can ack expiry early and cut others' writes | Partial |
| Bogus references | An envelope or ack naming a revocation, cap or epoch that never arrives makes it and its builders wait forever (R:183-186), against README rule 3 (A:34-35) | Not covered |
| Single-Doc reader of a group-covered Doc | Vault-wide caps and their revocations live in the group's Doc (R:416-418), which a vault given that Doc alone can't open (R:493) | Not covered |

## 8. Sync and performance at scale

- **Per envelope, per reader:** AEAD open, Ed25519 verify (about 50 µs, batchable), chain verdict from cache (R:813), liveness in O(1) with a per-peer max-ack frontier, footprint extraction from Loro ops, and re-lowering of named operations (R:325-326, R:446). Hybrid verify once per segment of up to 256 envelopes (R:546-547). 1,000 writers at 1 envelope/s each costs a desktop reader about 50-100 ms of CPU per second; phones on wasm two to three times that.
- **Rotations, flat:** stanza ≈ 1.2 KB (Q:443), list padded to the next power of two (R:517). So 300 readers → 512 stanzas ≈ 614 KB, and 10,000 → 16,384 ≈ 19.7 MB, not "about 11 MB" (R:807) or 12 MB (Q:446). Readers fetch their stanza by tag; range reads by sorted tag are unspecified, so a naive client downloads the whole blob, and 10,000 members × 19.7 MB is about 197 GB of egress per leave.
- **Device loss:** keyring, then every group the person is in (R:806). 300 groups of 20 readers ≈ 11.5 MB; 300 community subgroups of 1,000 ≈ 370 MB flat, ≈ 3.6 MB as trees. In groups of groups, each subgroup's new key forces its parent to rotate, so every member's device loss rotates the parent; only hourly batching (R:808) saves it.
- **Big communities:** weekly renewals for 1,000,000 members (R:808) are about 1.65 cap Records/s, each about 4 KB of cap and hybrid signature plus a letter: ≈ 8 GB/week across subgroups, ≈ 400 MB/year in each subgroup's Doc that its 1,000 members sync. With no access-map compaction, it grows forever.
- **Kept lists:** one per Doc the revoker holds (R:105-106), so revoking a cap on 50,000 Docs is "one Record" (R:812) of 50,000 version vectors, which the revoker must hold synced.
- **Rebuilds:** a revocation that discounts imported envelopes rebuilds the Doc from its envelopes (R:458-460): O(history) for hot Docs with churn. Honest work built on a discounted envelope needs its own device to re-apply (R:459), lost if that device is gone.
- **Cold start:** a new device opens ≥ 1 key blob per Doc plus the group chain: 100,000 Docs ≈ 100,000 fetches and 5–10 s of X-Wing decaps. Tiers order it (R:796).
- **Door and tree:** every peer reads the whole tree today (R:814). Positive proofs can travel with acts, but device removals are negative facts (a revocation list), with no distribution design: short-lived device statements, the PKI lesson the spec applies only to groups (R:71), would fit.
- **Wants and caps:** served = wants ∩ caps (R:788-791). At a keeper, one fetch proof per connection and epoch (O(1)). At a member's Peer, read via a group means walking group chains in Docs it may not hold, and it fails closed. For actors, the kernel intersects loads with run caps per turn (R:792-793).
- **Bottlenecks, in order:** flat rotations above a few hundred readers; device-loss fan-out; access-map growth; revocation rebuilds in hot Docs; tree and revocation distribution at millions; the single keeper's bandwidth and availability (R:815); per-envelope footprint extraction and re-lowering.

## 9. Seams and contradictions

- **Docs:**
  - "Fit never changes" (R:185, R:453) against fit cached by envelope, lane and code version (D:91, D:254).
  - The public Loro peer derivation (D:143) defeats rule 23 (R:175-178).
  - The import order checks caps before what an envelope builds on (D:145-150), but liveness needs the causal past (R:432-446).
  - Snapshots "never travel" (R:841) against "travel by the same blob transfer" (A:170-173), and docs still has it open (D:263).
  - A Doc's vault and root type, "fixed at birth" (R:841), must be bound to the genesis signer, or `vault`/`type` targets are spoofable (R:284-285).
- **Engine:**
  - Its footprint is still "documents, and inside them types" (E:95), and "a cap narrower than a document is a set of types" (E:488-489): E1–E3 haven't landed there.
  - It cites `aven/ID/caps/README.md` rule 8 for "checked twice" (E:474): a stale path, and caps' rule 8 is "write needs read".
  - Lowerings are cached per plugin version (E:238-239) while caps name lowered hashes (R:324): an upgrade silently uncovers caps, or readers on two versions disagree (R:461-462).
  - `{ bind: $actor }` is filled from the run (E:236-237), but R:315 compares `$actor` with the envelope's signer, which is a device.
- **Store:**
  - The Aven Peer advances `chat-<device>` only to "a line that device signed" (S:145-147), which a blind keeper can't check once signers are sealed (R:175). Ref names show device activity.
  - The parked sealing seals a room secret to each device (S:157-158) against rule 17 (R:158-160).
  - How 1 MiB chunk blobs (S:94) map to 64 KiB AEAD units and BLAKE3 verification (R:551-552) is unspecified.
- **Actors:**
  - AA is not on main, yet R:376 relies on its section 11.
  - Rule 1 allows only vaults, groups and tickets as holders, but "B's vault grants A a tell cap" (R:386-387) names an actor; the holder must be A's vault, so any actor there can use it.
  - Open question 8 (R:972-973) is already decided on the branch: a definition names what it `replaces` (AA:194, AA:375). Who may claim `replaces` is unstated.
  - An actor's address names its home's EndpointId (AA:373): a cap by address breaks when the actor moves, and the address shows its device.
- **Peer and door:** the door is admin-coop membership (IN:338-347), not a cap (R:231). Caps defer it (R:981) yet rely on it for member removal (R:621). Guardian, coop and RP settings are unsigned configuration (CL:22-24, ST:57-73).
- **avenDB README:** "ML-DSA later" (A:197-198) against D10's hybrid now (R:885-886). R:850-852 proposes Terms fixes the README already has (A:115-117).
- **Within R:**
  - "Every reader of the covered Docs can open" the group (R:416-418) is false for single-vault readers (R:493), and so is R:772.
  - `below` (R:501) is written backwards.
  - R:771 against R:611-612.
  - R:769's "unseen" list against its own "which device … fetches".
  - The guardian without ML-DSA (R:669-670) against rule 20 (R:167).
  - A recovery kit is one key (R:685-686) against "never one key" (R:191-192), unless k ≥ 2.
  - The scale arithmetic ignores the padding (R:517 against R:807).

## 10. Strengths

- **Authority from first principles.** Four essentials, key, vault, cap and proof (R:208-215), with older concepts mapped onto them or dropped (R:217-232). Governance is kept apart from caps (R:126-127).
- **Attenuation readers can check.** Our own small grammar, a subset check meant for Lean (R:866-868); no Datalog, no unchecked third-party blocks (Q:268-276).
- **Immutability.** Caps and roles are Values named by hash; operations are pinned by lowered hash, which a plugin upgrade can't widen (R:324, R:341-344). This cures avenDB-old's mutable cap groups (Q:126).
- **Separate operations instead of levels** (R:133-134); `keep` grants no key (R:298); a want grants nothing (R:179-180).
- **One target grammar** for caps and wants (R:135-136).
- **Read enforced by crypto per Doc, write by every reader.** No server judges writes (R:172-174), and avenDB-old's relay check on cleartext is gone (Q:207-213).
- **Precise footprints.** Verbs, fields, constraints, `where` only on immutable fields (R:307-322). A merge is checked over everything it changes (R:448-450), so a narrow merger can't land a wide proposal.
- **Revocation in the Doc's causal history,** Keyhive style: cascade by one Record (R:636-637), strong removal (R:631-633), every reader reaching the same verdict (R:461-462).
- **Key layers.** Device churn stays inside the keyring; Docs seal to groups; joining a vault's Docs is one seal (R:495-500, R:805, R:811). Rotations are lazy, need no sequencer, re-encrypt nothing, and leave room for trees behind a scheme byte (R:522-529).
- **No undecryptable messages.** Keys travel with what they open (R:161-162), a lesson taken from Matrix's failures.
- **Honesty.** Forward secrecy, removal and scale costs are stated plainly (R:557-583, R:831-834).
- **Post-quantum where it matters.** X-Wing on every key sent; hybrid signatures where authority lasts, amortised per segment; suite bytes for agility (R:744-754).
- **The PRF step.** A new browser opens its vault with no other device online. Device keys are never derived from the PRF, and the owner epoch is in the salt, fixing avenDB-old's fixed-salt PRF (Q:250-251).
- **Approvals** are lists of post-quantum co-signatures over the exact digest (R:654-655).
- **Grounded in research.** Prior failures are mapped to rules (R:59-71), and the work is Lean first with vectors (R:899-935).

## 11. Weaknesses, gaps, risks, over-complexity

- **C1. The guardian is configuration, not consent.**
  - Its public half comes from `--guardian` / `AVEN_PEER_GUARDIAN`, a non-secret variable of GitHub's `production` environment (P:42, P:136).
  - No person signs it (CL:74-76, IN:50-52), and peers adopt it from the Aven Peer's JSON (ST:65). A restart with another key re-owns every person vault (CL:141-143, CL:203-207).
  - With caps, "any one owner is enough" (R:668), and every keyring seals to the guardian's seal key (R:669), whose public half nobody authenticates.
  - **Fix:** put the guardian's hybrid and X-Wing public halves in the claim and join texts the passkey signs, and show them in the vault fingerprint.
- **C2. The passkey RP ID `maia.city` exposes every keyring to every `maia.city` origin.**
  - WebAuthn lets any subdomain use the parent RP ID. v1's `maia.city`, `api.`, `avendb.` and `www.` share it (P:71).
  - The PRF salt is predictable (R:694), and the PRF output alone opens the keyring (R:706-710).
  - One XSS anywhere on the domain, plus one biometric prompt, reads a vault's entire history.
  - **Fix:** a dedicated RP ID such as `aven.maia.city`, or a separate registrable domain, before more passkeys exist; also mix a vault-held secret into the PRF input.
- **C3. The code-serving origin is outside the model.**
  - Browsers run avenOS's JS served by Caddy on the Aven Peer's host (P:100). Hetzner, SSH holders and the deploy job (P:119-120) can serve code that reads OPFS keys (R:967), PRF outputs and plaintext.
  - R:5-6 ("No server decides anything … can't read them") is false for browser users today.
  - **Fix:** signed releases, a pinned service worker or the Mac app, an install-time hash anyone can check.
- **H1. Caps minted by a stolen device survive the heal** (R:402, R:575-583); device-signed caps need ack-style cut-off at removal. **H2. Ack laundering:** "an ack had seen them" lets any writer whitelist a revoked holder's later writes, even causally post-revocation ones, with its first ack (R:102-104, R:912). **Fix:** never count a revoked holder's envelope that has the revocation in its causal past; for Doc caps, keep only the revocation's own past (R:626).
- **H3. Signers aren't hidden:** the pseudonym is computable (D:143, R:769). **H4. The blind keeper can't authenticate fetch-key updates or uploads** (R:605, R:298): any member can deny service on any Doc. **Fix:** chain each epoch's fetch and upload keys, signed by the previous epoch's upload key from the Doc's first epoch.
- **H5. Single-vault readers can't verify vault-wide caps or their revocations** (R:416-418, R:493); envelopes must carry full chains, and liveness then rests on acks. **H6. `below`** as written makes governed vaults' readers readers of the governor (R:501): an upward leak, e.g. the Aven Peer → Maia City → Samuel. **Fix:** a per-vault "below" group sealed downward.
- **H7. No freshness or anti-eclipse design:** removal relies on writers learning of it (R:524-526); a single keeper and relay for browsers can stall that indefinitely. **H8. The door and tree custody are server privileges,** not caps (R:231, R:981; CL:27-29). The tree-head gossip (R:780-782) has no defined head and no append-only log.
- **M1. Approvals on read grants are unenforceable:** any device holding a key can seal it to anyone, so the k-of-n rows of R:402-403 bind only writes, share and tell. Say so, or root group keys in owner-only key material.
- **M2. Readers are revealed** by fetch proofs and topics (R:609-610, against R:769). **M3. Stanza tags lack the Doc id** (R:515-517), letting the keeper cluster Docs by group.
- **M4. Groups:** children of a group cap outlive the issuing member's removal (R:404, R:444), and a single device adding a member extends owner-approved caps (R:375). **M5. A device cap can't narrow reads,** since every device opens the keyring (R:491); a limited device must be a separate vault without the keyring.
- **M6. Post-quantum gaps:** the guardian is Ed25519 only (R:669-670, P:40); ES256-only owners stay classical (R:732); the PRF crosses classical CTAP channels, hybrid included (R:738-740); iroh's transport is classical (R:751). Enable rustls' X25519MLKEM768 in iroh if available.
- **M7. Time:** `not_before` is unenforceable on writes, expiry needs another writer, and early expiry acks are possible (R:332, R:639-640). **M8. Doc tickets:** claim-once isn't defined without a sequencer; read through a ticket is a bearer secret until rotation (R:392-394).
- **M9. Removing a network member keeps its caps** (R:621); add a cascade, or have writers treat non-members as removed readers. **M10. Quota and payer link Docs to vaults** (R:607). **M11. `from-now`** is illusory for group grants (R:499-500, R:520-521).
- **M12. Waits on references that never arrive stall Docs** (R:183-186); require a named revocation to be in the causal past. **M13. Unbounded access maps and O(#Docs) kept lists** (R:808, R:812); a checkpoint or compaction design is needed.
- **M14. Versioning:** the plugin version must be pinned in envelopes and caps (E:238-239 against R:324), and "fit never changes" corrected (D:91). **M15. Confused-deputy prevention can't be verified by readers** (R:378-385): state the trust in hosting kernels, and keep face and inbox rules (R:388-389).
- **M16. The heal** must explicitly replace the vault key, tag seeds and letterbox keys, and revoke device-minted caps (R:575-580). **M17. Recovery:** owners can "cancel" each other forever, so a thief blocks recovery (R:680-681); a kit is a one-key owner (R:685-686). **M18. Device-revocation distribution** at millions is unsolved (R:814); use short-lived device statements.
- **Low:**
  - L1. `uses` and `budget` on write caps: say they are refused, not ignored (R:182).
  - L2. Minimum suites per object type, against downgrade (R:170).
  - L3. Letters: put the signature inside the seal, bound to the recipient; rate-limit letterboxes (R:421-428).
  - L4. The PRF input needs the vault id before the assertion reveals the passkey: a second ceremony, or `evalByCredential` exposing credential ids (R:694).
  - L5. Padding arithmetic (R:807).
  - L6. Stale or dangling references (E:474, R:376, R:850-852).
  - L7. Overloaded words (§3).
  - L8. Ed25519-only live envelopes give a future forger splits until segments arrive (R:168).
  - L9. `$actor` and `own` for group holders are undefined (R:315, R:335).
  - L10. No partial order for conditions.
  - L11. Over-complexity: 35 nouns in Terms (R:73-118), where avenDB-old's "about twenty" was a criticism (Q:590-593); caps live in three places; there are three kinds of epoch; rebuild and re-apply echo avenDB-old's replay machinery (Q:222-233).
- **Lean:**
  - `revocation_wins` (R:912) permits laundering.
  - `keeper_blind` (R:917) covers keys, not rules 22 and 23's metadata claims.
  - `readers_agree` (R:911) must include tree view, lane and code version.
  - Missing: the heal's eviction, group-child liveness, tickets claimed once, time monotonicity, termination of waits.
  - Today's `guardian_owns` (CL:331) proves that a configured guardian owns every vault, not that anyone consented.

## 12. Open questions

From the spec (R:959-977), with this audit's view:
1. Groups holding caps: yes, but with issuer-liveness for children (M4) and an approval rule for adding members to cap-holding groups.
2. Which root caps need approval: say plainly that approval binds writes, share and tell only (M1).
3. When trees come: before the first group above about 256 readers; the padding makes flat costlier than stated.
4. Write without read (drop boxes): useful, and it also needs blind upload proofs (H4).
5. Device secrets in OPFS: non-extractable wrapping doesn't stop live in-page misuse; the real fix is C3.
6. The heal on a schedule: needs H1 and M16 first; otherwise it doesn't evict.
7. The guardian's exit and opt-in data guardians: first bind the guardian to consent (C1).
8. Caps across actor upgrades: decided on the actor branch (AA:194); who may claim `replaces`?
9. Padmé on every envelope, or only segments and files: files at least, since the file blob table shows sizes leak.
10. What a blind keeper sees of writers: the pseudonym isn't blind today (H3); key it, or move to "everything after segment X".

New:
11. Who issues and who checks keep caps, and what authenticates uploads, head refs and fetch-key changes at a blind keeper?
12. Where do device caps and device removals live so that every reader of every Doc can see them, and how fresh must they be?
13. What exactly does "had seen" mean for acks (causal past or imported)? Does any later ack count, or only minimal ones, and is an envelope that has its own revocation in its causal past ever counted?
14. Does the signer check use the tree at signing or now, for caps signed by a later-removed device?
15. Is a tag seed per holder, per cap or per (reader, Doc)? Do seeds rotate on removal?
16. Do envelopes carry full cap chains, or ids only? How do single-vault readers verify vault-wide caps?
17. What is the "tree head", who signs it, and what does a member do on equivocation?
18. Which RP ID, and which origins, may ever call the PRF?
19. Can a person remove MaiaCityGuardian during evaluation (P:37-38 says yes, D12 says it "stays")?
20. Does network-member removal revoke data access, or only the door?
21. How are access maps compacted, and which signed checkpoints let a new reader skip churn history?
22. Who rotates a group on removal: the revoker at once, or its next writer?
