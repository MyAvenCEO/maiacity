# Audit of `aven/DB2/ARCHITECTURE.md`, 31 Oct 2026

**What was read.** ARCHITECTURE.md at main `f5cc91a1` (#1726), all 1,026 lines; the raw ledger, all 2,281 lines
(00:00 to 11:06 UTC). Lean names were checked with `git grep` on `origin/main` (`f5cc91a1`), PR numbers against
`git log` and, for PRs missing from it, GitHub's REST API. Main has since moved to `0b6e4409` (#1728), which changes
only `aven/DB2/CLAUDE.md` (the new "every decision lives in ARCHITECTURE.md" rule). The architect's branch adds
`5fc77eba` (an append-only `DECISIONS.md` check, not on main; the file doesn't exist yet).

**Severity.** H: a thread reading the text would build the wrong thing. M: misleads or is out of date, no build harm.
L: wording or history. "check" marks a finding that needs a reading or a decision before it is fixed.

**Open PRs referred to below** (REST, 31 Oct ~11:15): #1710 Core many signatures and `Closed`, codec split; #1697 ops
engine; #1716 avenID built-in Records; #1718 passkey records, owner-epoch op, migration snapshot; #1720 gen1 rename;
#1722 keepers (stage 5, titled `Aven.DB.Keeper`); #1667 release record (parked). #1686 is merged (`d1ac3a00`).

## Counts

| Section | Findings |
|---|---|
| 1. Internal contradictions | 44 (21 H, 13 M, 10 L) |
| 2. Stale status | 39 (7 H, 18 M, 14 L) |
| 3. Evidence that doesn't resolve | 20 |
| 4. Missing durable decisions | 52 (plus 14 process choices listed and excluded) |
| 5. Structure | outline, merges and cuts, the decision index |

## 1. Internal contradictions

| # | Line | What it says | What's current | Proposed fix |
|---|---|---|---|---|
| 1.1 H | 28–40, 997 (A24) | The layer diagram has no Core. docs owns "envelopes, logs"; store owns "Values and refs". A24: "the layers as drawn" | A45 (871–875): Core defines Values, names, signed things, envelopes, logs, the past, splits, counting, limits, ops, calls, targets, steps and built-in type names (`aven/DB2/core`, `aven-core`, and `aven-codec` once #1710 lands) | Redraw with Core at the bottom of the pure cores, under avenID. docs keeps Docs, Records, segments, types, lenses and fit; store keeps refs and files. Restate A24 against the new drawing |
| 1.2 H | 49–59 | The parts table has no Core row, no first generation (`aven-db-core`) and no avenBRAIN. engine's primitives include "target" | A45; ledger 10:20:42 (gen1 rename); A41 and the avenBRAIN package (Samuel 05:57:33) | Add rows for Core, gen1 (being split up) and avenBRAIN. Move "target" to Core |
| 1.3 H | 68, 70, 71, 73, 81, 86 | Primitive owners: Value "store, docs"; envelope "docs, avenID"; log "docs"; split "docs, caps"; type "docs"; target "caps, engine" | A45: Core owns these. docs supplies fit and writer ids, avenID supplies *authorized*, the engine lowers | Owner = Core for Value, name, envelope, log, split, version (the past), op, call, target, step and built-in type names |
| 1.4 H | 70 vs 142, 792–793, 274 | Envelope: "a public one to the network's members (caps D15)". Caps #16: "Removal ends public caps" | Rule 15: "the public (everyone)". A42: the register is "a public Doc whose readers are everyone". caps README (lines 29, 234, 1306; D15) still says "the public is the network's members" | One meaning of "public". Samuel 08:20:24: "it can be public what needs to be public". check: either "public" means everyone and members' Docs are sealed to the members group, or the register needs a word of its own |
| 1.5 H | 84 | Cap: "held by a vault, a group, the network's members or a ticket" | Rule 15 (141–143) and A28 (704): a bearer key (a ticket's) proves a condition and never holds a cap. Holders are a vault, a group of vaults or the public | "Held by a vault, a group of vaults or the public" |
| 1.6 H | 87 | Ticket: "A one-time key holding a cap until a vault claims it" | A28 (704): a ticket is a cap from Maia City to the vault its claim founds; the one-time key only authorizes the claim | Rewrite the row |
| 1.7 H | 85, 88, 185 | Verb: "read, query, put, patch, remove, edit, tell, keep, share", replacing caps' "operation". Operation: "a query, a mutation or a want". Vocabulary: "caps grant **verbs**" | A32 (725–749): a cap line names an op by hash. The core verbs are `core/1`'s eight ops, without `query`, which is a stored op (ledger 07:46:30). A45 (883): "'Op' means only an op" | Replace the verb and operation rows with **op** (`OpId`), **call** (`{op, params}`) and **step**. Drop `query` from the verbs |
| 1.8 M | 89, 189, 327–331 | A want has "a depth"; vocabulary: "a want has a **depth**"; want queue: "Depth: head, records or files" | A1 (604): "the engine's part → level (caps has a share depth)". GLOSSARY says level | Use **level** in all three |
| 1.9 M | 205 vs 603, 864 | "**gate** only for time limits (access is the **door**)" | A1: `Gate` → `Admission`. A44: "One fetch gate". The keepers thread builds a `Gate` trait (ledger 11:05:37) | Choose a meaning for "gate" (the fetch gate, or a time limit) and rename the other |
| 1.10 M | 175–179 | "These are the merges that matter most ... (A1)"; the column is headed "Proposed" | A1 is decided (601–605), plus the 07:51–07:52 renames (statement → envelope, claim → genesis, ack → confirm, Placement → Keeping, `tips` → `parents`, `CapKind` → `CapForm`) | Head the column "Decided" and add the 31 Oct renames |
| 1.11 H | 83, 198, 199, 219 (K6), 644–650 (A10) | "Membership is the members group (D15, #1492)"; "The network is a group"; "removal ends network caps" | A38 (772–775): membership is a member cap from Maia City's vault; a member shows its chain, so no device needs the roster; withdrawals revoke it. A42 (793–794): who joined is in the members' caps | Restate A10, K6 and the rows as A38. check: whether the members group survives only as the key group that members-only Docs are sealed to |
| 1.12 H | 225 (K12) | "The relay, the handshake and the blob provider check that; keepers check per-Doc fetch proofs" | A38: the door checks a member's cap chain. A44 (864–866): one fetch gate on `aven/db/1` (`prove`, `fetch`, `items`); iroh-blobs only for files | Rewrite K12 in the Peers section |
| 1.13 H | 224 (K11), 365–366 (want queue 13), 243 (stress #10) | "Live envelopes on one gossip topic per group"; "Gossip per group, not per Doc"; K11 removes "a topic per Doc"; stress #10's fix: "topics per group" | Ledger 10:48:52 (stage 3 approved): a topic per epoch of a Doc from `avenDB topic 1`, joining the newest epoch and the one before; `doc_tips` and `doc_have` named by topic. 10:42:25: "gossip per Doc" | Record the decision (4.25) and rewrite all three. Say what remains "per group" (the carrier Doc, A33; A42 816–817) |
| 1.14 H | 224 (K11), 350–351 (want queue 6) | Catch-up "by set reconciliation and iroh-blobs"; "many Docs' segments come as one hash sequence per page" | A44 (864–866): sealed Doc values travel only through `prove`, `fetch` and `items` on `aven/db/1`. Ledger 10:42:15: catch-up from keepers is by arrival number (stage 5), reader-to-reader sync by version (stage 3) | Rewrite item 6 and K11 |
| 1.15 M | 214 (K1), 215 (K2), 1008 | K1's owner is "docs, with the security thread first", K2's is "docs"; the docs thread takes "rules 1 to 3" | A45: Core | Owner Core |
| 1.16 H | 432–436 (sealed indexes 2) | "Whoever creates a Doc ... adds its entry there in the same commit" | A42 (818): "A directory entry is its own envelope in the directory's Doc, never written in another Doc's commit". The db/docs README (772, 968) still says "same commit" | Rewrite item 2; the docs README follows |
| 1.17 H | 974 (A22) | A vault's keep caps: "their targets may be queries (A8)" | A32 (731–740): a target ranges over birth facts, never a query over content; anything query-like is a collection | "Targets are A32's three forms; a query-like scope is a collection" |
| 1.18 H | 651–654 (A11), 669–670 (A13), 259 (caps #1) | The genesis names "the Aven Peer's key and the guardian's hybrid keys". "The guardian is named, with hybrid keys, in every claim and join text" | A28 (693–699): the guardian, release keys and avenPeer become vaults named by the genesis, Maia City's to change. A42 (803–804): "A claim names the guardian vault, not its keys" | Restate A11, A13 and caps #1 with vaults |
| 1.19 H | 651–652 (A11), 292 | "The claimant's passkey and MaiaCityGuardian sign the network's first statement"; granted by "The claimant's passkey and MaiaCityGuardian" | A28 (689–692): the admin is Maia City's vault. Ledger 07:21:15: the genesis names Maia City's vault and its owners; the claimant's passkey is only its own vault's owner key | check: state who signs the genesis under rule 15 (Maia City's owners, k of n) |
| 1.20 H | 657–668 (A12) | "A join is final once an admin device has acked it"; changes count "only when the admin's passkey signed it ... an admin device's key only acks claims (PEERS decision 12, `adminPasskey`, #1618)" | A28 (689–692, 701): Maia City's owners approve; a claim is final by a vault's grant. A38: the confirm op. A42 (801–802): "every older answer (owners' devices, the admin's device) goes". PEERS decision 12 now reads "Maia City's vault is the admin" | Rewrite A12's second paragraph and drop `adminPasskey` |
| 1.21 H | 665, 689–691, 705 (A12, A28) | Admin acts include "the relay and keeper lists"; "the relay and keeper lists name vaults" | A44 (851–853): the admin's keeper list goes, and the offers are the list; only the relay list stays | Drop the keeper list from A12 and A28 |
| 1.22 H | 766 (A36) vs 805–806 (A42) | A36: "one release record per package, ordered by its dated version" | A42: "ordered by the log, never by its dated version (rule 12)" | Keep A42's ordering and rewrite A36 |
| 1.23 M | 769 (A36) | "Who owns the release vault is for Samuel, with thread E's signer proposal" | A42 (795–796): release signing by a vault comes later (Samuel 08:20:24). #1667 is parked | Mark A36 deferred |
| 1.24 H | 675–683 (A15), 789–791, 261, 303 | A Service Worker checks a release's signature. A42: the PRF owner key's boundary is every `maia.city` origin, and "every such origin serves only our signed releases (A15)" | A42 (795–796): release signing comes later. #1667 ("the Service Worker's safe switch") is parked, so no origin serves signed releases today | check with Samuel: say that today's releases are the dated releases from `production`, and that the boundary in rule 13 rests on that until signing exists |
| 1.25 H | 260 (caps #2) | Status "open". Fix: "a dedicated RP ID ... a secret the vault holds mixed into the input (A14)" | A14 is decided no (671–674). A43 (829–832): the PRF input is only `["avenID prf 1", {epoch}]`. A42: the boundary is every `maia.city` origin | Status "decided: A14 no; A42 boundary; A43 input" |
| 1.26 M | 272 (caps #14) | "A limited device is a vault of its own, without the keyring (the Aven Peer is one)" | Rule 15 (140–141), A42 (807): every device is its own vault. Ledger 10:48:52: the keyring is sealed to the vault's devices | "A limited device is one the keyring isn't sealed to" |
| 1.27 M | 274 (caps #16) | "Removal ends public caps and rotates the members group at once (D15)" | A38: a withdrawal revokes the member cap; "public" (1.4) | Rewrite with 1.4 and 1.11 |
| 1.28 M | 298 | Keep caps for "every chat line and file" are "Granted by: Maia City's owners" | A22 (977–979), A44 (846–853): the vault that owns each Doc or Value issues its keep caps; a keeper keeps keep caps ∩ offers | Granted by each owner vault and offered by Aven's vault. check: the city-dome Doc itself is Maia City's |
| 1.29 L | 306 | The RP ID is "in the genesis; changes are the admin's signed acts" | A14 (673–674): moving to another RP ID means a new genesis | Separate the RP ID from the origins |
| 1.30 L | 296 | Relays: "The admin coop lists them" | A28: Maia City's vault, by its owners' approval; lists name vaults | Wording |
| 1.31 L | 234 (stress #1) | "Several relays and keepers in the page's relay map" | A44: keepers come from each vault's keep caps, not from a list | Relays only |
| 1.32 M | 566–567 | Actors, weak: "a narrow device for the actor host is still open" | A27 (917–929): one device key per host, in a narrow device vault; decided and proven (#1617, #1619, #1626, #1628) | Cut (§5) |
| 1.33 L | 467 vs 590 | Store, weak: "live security bugs (fixed in their own thread first)" | "All five are fixed and live (#1493, #1509)" | Cut |
| 1.34 H | 155, 1016 vs 821 | "13 of the 14 rules were composed"; "13 of 14 since 30 Oct" | A42 (821): "Status tables say what is open: rules 3, 7, 12, 15 and 16". `architecture/README.md` and `Gaps.lean` list rules 1–14 only, with nothing missing for 3, 7 and 12 | One status table (2.7). check: are rules 3, 7 and 12 open? |
| 1.35 M | 101–105 (rule 1) | "The thing is named by the hash of the bytes" | A30 (712–718): the name is the hash of `[label, body]`, with the signatures beside it; adding one never renames | Restate rule 1 |
| 1.36 M | 109–110 (rule 3) | "Two envelopes after the same one are a split" | A30 (713): "A split is two different bodies at one place"; a re-signed envelope is no split | Restate rule 3 |
| 1.37 L | 910 (A17) | "Loro snapshots are its checkpoints" | Vocabulary (192) and rule 8: a snapshot never leaves its peer, and what travels is a checkpoint. The seal's kind label "snapshot" seals checkpoints (ledger 09:04:35) | Say "checkpoints", and note the label |
| 1.38 L | 759–761 (A34), 824–825 (A43) | "The tree is the first Doc, the chat the second" | Ledger 10:48:52: the keyring, a Doc of built-in type `keyring`, is "the first Doc stage 3 holds" and needs no tree | check: "the keyring is the first Doc a device holds; the tree is the first shared one" |
| 1.39 M | 968–969 (A22) vs 858–859 (A44) | The keeper checks a fork-choice signature by "a device of the vault that issued the keep cap ... against the tree" | A44: the keeper learns the owner from the keep cap's issuer and "reads no other caps". Rule 15 and ledger 07:21:15: a device acts by a device cap, not by the tree | check: say what the keeper reads to verify that signature |
| 1.40 L | 963, 266 vs 848–851 | "The uploading vault pays" | A44: quota by the keeper's offer to the owner's vault. keep.json (#1725); Keep.lean:504's docstring says "within the quota its keep cap gives that vault" | check: who is charged, the uploader or the owner, in one sentence |
| 1.41 M | 280, 551, 566, 927, 943 | "Kernel" names the actor host's trusted part | Samuel (10:02:18): "shall we rename core to kernel?". It was answered by A45 and the gen1 rename. GLOSSARY's "kernel: holds keys for its actors" contradicts rule 13 | check: define "kernel" once, or rename it so it doesn't collide with Core; fix the glossary's key wording |
| 1.42 L | 90 | Runtime "Owned by: actors, engine" | Parts table (57): one home, `aven/runtimes`. A45 (886–888): runtimes live with their publisher's vault | Owner: runtimes |
| 1.43 L | 94, 217 (K4) | Keeper and keep cap with no mention of offers | A44: keep caps ∩ offers | Add offers |
| 1.44 L | 10–11 | "Once Samuel decides one, it moves into the spec that owns it, and this document keeps only the summary" | `aven/DB2/CLAUDE.md` (#1728; Samuel 11:06:56): ARCHITECTURE.md is the SSOT and specs cite it | Rewrite the intro |

## 2. Stale status

| # | Line | What it says | What's current | Proposed fix |
|---|---|---|---|---|
| 2.1 M | 8–9 | "Written on 30 Oct 2026 ... at main `2c1a9890`, updated for caps D13 to D20 and since" | 45 decisions through 31 Oct; the last is #1726 | "As of main `<sha>`, <date>" |
| 2.2 L | 44–45 | "Today the README draws avenPEER above avenDB ... A24 settles it" | The README cites A24 below its product diagram (README 76–77) | Cut. check: the README still draws products top to bottom |
| 2.3 M | 51 | avenID's thread: "caps (#1492)" | Three threads: caps Lean, avenID keys and minimal caps (Rust) | Name the owning package, not a thread (A45) |
| 2.4 M | 52 | store: "done; security fixes in flight" | Live since #1493 and #1509 | "Done" |
| 2.5 M | 57 | runtimes: "face-runtime and markdown-runtime as code, the rest a plan" | On main: tree #1631, markdown #1639, face #1643 and #1691, drawer #1650, Style #1673, state steps #1676, registry #1678 and #1689, loading by hash #1704, slides #1707, browser host #1719. Markdown v3 is next | Update |
| 2.6 M | 58 | avenPEER's thread: "PEERS planning"; the spec column has no PEERS.md | Stage 4 (the tree), thread E (wire v2 done, #1714; the wire move next), stage 3 (Docs in the Peers), stage 5 (catch-up and keepers, #1722) | Update and add PEERS.md |
| 2.7 H | 149–171, 1016 | Rules status: 13 of 14. "Rules 15 and 16 are new"; A28's places "each fixed Lean-first" | Rule 15's places done in Lean: #1656, #1671, #1674, #1686, #1695, #1717. Pending: thresholds k and owner removal (stage 4, after #1710 and #1718); the release vault is deferred. No rule 15 or 16 theorem, and `Gaps.lean` has no rows for them | One status table: rule, theorems, missing, PR. Generate it from `Gaps.lean`, or say there is none |
| 2.8 M | 179 | Column "Proposed" | A1 decided (#1670) | See 1.10 |
| 2.9 H | 260 | Caps #2: "open" | Decided: A14 no (#1632); A43's PRF input (#1680, #1693) | See 1.25 |
| 2.10 M | 261, 303 | Caps #3 "partial"; "Signed releases" | Release signing is deferred (A42); #1667 is parked | "Deferred" |
| 2.11 M | 270 | Caps #12: "decided" | Lean done: #1656, #1671, #1674, #1686, #1696, #1705. Code: stage 4 | "Lean done; code in stage 4" |
| 2.12 M | 279 | Caps #21: "decided" | Tree statements are Core envelopes (#1686) and `tree/1` op calls (#1705) | "Lean done" |
| 2.13 M | 281 | Caps #23: "decided" | A3 holds in Core and Architecture (`rule2_prev_fixed`, `rule2_dep_fixed`, `rule3_split_final`) | "Lean done", with citations |
| 2.14 L | 282 | Caps #24: "the guardian is Ed25519" | Owner keys are hybrid (#1680, #1700); the device's hybrid key is derived (A43, #1726). check: the guardian's key | Update |
| 2.15 M | 315 | "Proposed as **A9** for the engine thread" | A9 is decided, and its laws are in Lean (#1530) | "Decided (A9)" |
| 2.16 L | 400–403 | Search to-do: "Padmé on every file (D18)" | Padmé is defined (`Aven.ID.Padme`, #1694). Epochs' stanza lists are padded and tag seeds come from the previous epoch (#1724). check: files | Update the rows |
| 2.17 L | 453–455 | "In Lean, before any code: ..." | #1540 (the Prolly tree), #1611 (`walk_verified`) | Cite them |
| 2.18 M | 457–586 | Strengths and weaknesses, the 30 Oct snapshot: docs' "deps by op id (critical)", "snapshot trust undecided", "500 envelopes in a second"; engine's "queries have no scope", "E1 to E3 aren't adopted", "two data models"; caps' "shared RP ID", "guardian by configuration", "35 nouns"; actors' "narrow device still open"; avenPEER's "devices can't be removed", "only keeper" | A3; A5; 76 ms per 500 envelopes (#1694, ledger 09:41:15); A8; A32 (#1681); A20; A14; A13 (`guardian_consented`); A1; A27; A11–A13 and A38 | Move to `audits/` as history (§5) |
| 2.19 L | 588–592 | Security findings: only the store audit's five bugs | Today's findings: `Grant.allows` ignored a line's verb (spec, #1653); a face could draw over avenOS (fixed in #1691 before merge); Loro panics abort a wasm worker (design, #1694); `verify_strict`, found by Wycheproof (#1680). check: which of them ran live | One security log with live and spec marked (optional) |
| 2.20 M | 594–597 | "Proposals for Samuel. Each proposal comes with a recommendation" | Nothing is open but release-vault ownership, which is deferred | Rename it to the decision index (§5) |
| 2.21 H | 667–668 | A12 cites "PEERS decision 12, `adminPasskey`, #1618" | PEERS decision 12 now reads "Maia City's vault is the admin"; `adminPasskey` is gone from Lean (#1656) | See 1.20 and 3.5 |
| 2.22 M | 675–683 | A15: "Decided: yes" | Signing is deferred (A42). The three origins: no implementation found in `os/`, `deploy/` or `peer/light` (check) | "Decided; signing deferred; origins: check" |
| 2.23 M | 696–706 | A28's list, with no status per item | Done: guardian vault, genesis settings and lists naming vaults (#1671); claim final by grant (#1674); ticket as a cap (#1695, #1717); coop root by quorum and deviceless issuers (#1717). Pending: thresholds k (stage 4, after #1710); the first signup in code (stage 4). Deferred: the release vault | Status per item |
| 2.24 M | 707–711 | A29: "Decided: yes" | Done: Lean #1690, wire v2 #1714 | "Done" |
| 2.25 M | 712–721 | A30, no status | Done: #1666 (naming with one signature), #1686 (the tree on Core envelopes). Pending: many signatures and `Closed` (#1710, open) | Status |
| 2.26 L | 722–724 | A31, no status | Lean #1662 and #1696. `Records.newer` keeps the smaller-body tiebreak only as a split (check that this matches "the tie-break goes") | Status |
| 2.27 L | 754–758 | A33: "for milestone 3" | The avenACTORS docs are aligned (#1685) | Status |
| 2.28 M | 766–769 | A36 | Deferred (A42); #1667 parked | See 1.22 and 1.23 |
| 2.29 L | 770–771 | A37, no status | Done (#1676) | Status |
| 2.30 L | 772–775 | A38, no status | Lean #1674 and #1717. Rust member caps wait for `tree/1` (#1716 open) | Status |
| 2.31 L | 777–780 | A40, no Lean cited | `holds_within_caps` (Holdings.lean:34, #1681) | Cite it |
| 2.32 L | 782–783 | A41, no status | Done (#1668) | Status |
| 2.33 H | 798–821 | A42: "each thread fixes its own files", no status per item | k of n pending (#1718, after #1710); confirm (#1674); guardian setting (#1696); releases deferred; device as its own vault (#1695); collections (#1681, #1695); address generation and tips as history (#1696); A39's base case (#1681); carrier (#1685); runtime floors (#1683, #1684); wire defaults (#1714). Not done: directory entries (docs README 772, 968) and the status tables (2.7) | Status per item |
| 2.34 H | 822–826 | A43's order, with no progress | Done: aven-core (#1679, #1688, #1699, #1701), keys (#1680, #1700, #1724), minimal caps (#1702, #1706), docs layer (#1694, #1712). Open: ops engine #1697, member caps #1716, tree stage 2 #1718, keeper #1722. Stages 3 and 5 started on Samuel's "Go" (10:40:03) | Status |
| 2.35 H | 871–899 | A45's bullets read as done | Pending #1710: Core's `Counts` with fit and authorized (main has `Counts (ok)`, Log.lean:147), `Sig`, `writes`, `builtinType` in Core. Still on main: docs' `Verdicts` (Docs/Counts.lean:26), caps' `Sig {key, digest}` (Approve.lean:25), `Records.counts` and `candidates` (Records.lean:91–96), the tree's `counted` (Network.lean:555), db's vector copies. `LoroId` is absent. The gen1 rename is #1720 (open); the wire move hasn't started. Done: `KeepOrder` (Keep.lean:575, #1717) | Status per bullet |
| 2.36 H | 1001–1020 | "Who does what next": seven threads from 30 Oct | Today: aven-core, avenID keys, caps Lean, minimal caps, docs layer, docs spec (done), ops engine, avenPEER stage 4, thread E, stage 3, stage 5, runtimes, avenBRAIN (done), avenACTORS (specs). A45: "owners are packages, not threads" | Replace it with the owner column in the packages table and the status in the decision index |
| 2.37 L | 1022–1026 | Sources: the six audits of 30 Oct | Plus the 31 Oct audits: terms, principles, vaults (#1658) and contradictions (#1677) | Add them |
| 2.38 L | 232–249 | The stress test's "Live today" column has no date | It describes 30 Oct production | Date the column |
| 2.39 L | 624–626, 758 | "Milestone 4", "milestone 3" | A43's order, and stages 3 to 5 (ledger 10:42:20) | check: name the stage |

## 3. Evidence that doesn't resolve

Checked on `origin/main` `f5cc91a1`. Every PR number the document cites (24 distinct numbers, #1488 to #1681) is in
main's log. These are the citations that don't hold:

| # | Line | What it says | What's current | Proposed fix |
|---|---|---|---|---|
| 3.1 | 270 | `door_from_tree` | No such definition. The theorem is `settle_door` (Network.lean:1192); `door_from_tree` appears only in its docstring | Cite `settle_door` |
| 3.2 | 277 | `waits_end` | Not on main | Cite `rule11_waits_named`, `rule11_waits_isolated` and `rule11_stall_raised` (Rules.lean:434–455), or write it |
| 3.3 | 281 | `split_found` | Not on main | Cite `rule3_split_spreads` and `rule3_split_final` (Rules.lean:71, 93). check: the intended theorem |
| 3.4 | 280 | `no_confused_deputy` | Not on main. caps README:1462 calls it planned in `Aven.Architecture` | Mark it planned |
| 3.5 | 667–668 | `adminPasskey`, PEERS decision 12, #1618 | Removed, superseded by #1656 (`admin_by_owners`, Network.lean:1271). PEERS decision 12 says the opposite now | Cite `admin_by_owners` and #1656 |
| 3.6 | 844 | `device_hybrid_bound` | Not on main; stage 4 | Mark it pending |
| 3.7 | 863, 897 | `Aven.Peer.Keeper` | Not on main. #1722 is open and titled `Aven.DB.Keeper` | Mark it pending (#1722) |
| 3.8 | 895–896 | `peer/spec`, `Aven.Peer`, `Aven.Peer.DocSync` | Not on main; stage 3 and thread E have no PR yet | Mark it pending |
| 3.9 | 883 | `LoroId`, `loro {from, to}` | Not on main; the docs body still says `ops` | Mark it pending |
| 3.10 | 876 | Core's `Counts` "with fit and authorized as parameters" | Main has `Counts (ok)` (Log.lean:147); #1710 is open | Mark it pending (#1710) |
| 3.11 | 878 | `Sig {signer, sig}` | Not on main. Approve.lean:25 has `Sig {key, digest}`; #1710 | Mark it pending |
| 3.12 | 884 | One `builtinType` in Core | Main has docs' `builtinType` (db/spec Docs/Genesis.lean:73); Core has only `typeOfTypes` (Op.lean:144) | Mark it pending (#1710) |
| 3.13 | 879 | "The keeper's `Signed` becomes `KeepOrder`" | `structure KeepOrder` is already on main (Keep.lean:575), since #1717 | Mark it done |
| 3.14 | 876 | Docs' `Verdicts` "go" | `structure Verdicts` is still there (db/spec Docs/Counts.lean:26) | Mark it pending (the docs A45 PR) |
| 3.15 | 877 | "The tree's own past go" | The tree uses Core's `inPast` and `Before` (#1686) but keeps `counted` (Network.lean:555). Ledger 10:45:02: drop it | Partly done |
| 3.16 | 927–928 | `actor_calls_within` cited under #1617 | Introduced in #1681 (`018cf61b`) | Cite #1681 |
| 3.17 | 927 | Caps' reader-half theorems, no PR | `actor_within_device` and `host_never_beyond` in #1619; `host_chain_only` in #1624 | Add the PRs |
| 3.18 | 891 | `aven-db-core` | Exists; renamed to `aven-gen1` by #1720 (open) | Note it |
| 3.19 | 987 | Deletes "live in the chat since #1583" | #1583 orders a device's own deletes first on reconnect | check: cite the PR that makes keepers drop the bytes |
| 3.20 | 152–153 | Status "kept in one place ... `architecture/README.md`, 'Where the rules stand'" | That table is dated 30 Oct and lists rules 1–14 only; `Gaps.lean` is the same | See 2.7 |

Resolved on main (no action): `actor_within_chain`, `actor_within_device`, `attenuate_signed`, `attenuate_within`,
`attenuation_within_message`, `authority_down`, `child_live`, `default_kept`, `fetch_chain`, `grind_example`,
`guardian_consented`, `heal_evicts`, `holder_granted`, `host_chain_only`, `host_never_beyond`, `keeper_blind`,
`merge_covered`, `merge_steps`, `merge_within_device`, `new_holder_granted`, `public_bounded`, `revocation_wins`,
`rule4_merge_whole`, `signs_by_chain`, `ticket_once`, `time_acked`, `write_keeps_chain`, `write_names_actor`,
`Aven.Actor.Signing`, `Aven.ID.Keep`, `Aven.DB.Wire`, `Counts`, `KeepOrder`.

## 4. Missing durable decisions

Today's decisions by Samuel or the architect that ARCHITECTURE.md doesn't state, verified by grepping the document for
each one's terms. "Line" is where the decision belongs; "What's current" is what ARCHITECTURE.md has now. Times are
UTC from the ledger's headers.

| # | Line | What it says (ledger time, gist) | What's current | Proposed fix |
|---|---|---|---|---|
| 4.1 | rule 10, A2 | 06:29:34: Core CBOR nests at most 512 deep, for `Canon` and `decodeAll`'s fuel, with vectors at 512 and 513 (#1651) | Nothing | Add to A2, citing `Aven.Core.Cbor` |
| 4.2 | rule 10 | 08:33:03, 09:35:54: Core's limits: 1 MiB per envelope, 256 deps, 256-byte branch and label, 4 KiB signer, 16 KiB signature, at most 16 signatures (`Aven.Core.Limits`, #1688) | Rule 10 only in general | Cite `Aven.Core.Limits` under rule 10 |
| 4.3 | A2, A43 | 08:25:27: Core's BLAKE3 gains keyed and derive_key modes. A hybrid signature is Ed25519 plus ML-DSA-65 over the same bytes; both must verify; a suite (`Aven.Core.Hybrid`). Structured inputs are Core CBOR `[label, body]`. Stanzas are key-committing (enc and commit keys from X-Wing's secret, the commit checked before decrypting). Owner seeds come from derive_key XOF 64 (#1680) | A43 names the keys, not the formats | A keys-and-sealing section |
| 4.4 | A2 | 09:19:19: crypto primitives stay outside Lean as parameters, held to known answers and Wycheproof | Nothing | One line in rule 14 or A2 |
| 4.5 | A30 | 08:41:55: an epoch is named by its blob without its stanzas, so resealing to a new device never renames it | Nothing | Add to A30 |
| 4.6 | A30 | 07:44:22: `Signed.name` excludes the signer, so a body must carry whatever makes an act its own | Nothing | Add to A30 |
| 4.7 | A30 | 09:35:54: `Sig` sorted, one per signer; an envelope's writer signature is required and placed through the `writes` parameter, and an envelope with no valid writer signature is nothing (refused, never counted, never a split); the suite is opaque inside `sig`; counting is not monotone by design, since a later split discounts | A30 has many signatures and the whole past | Fold into A30 |
| 4.8 | A32 | 08:47:52, 08:55:25, 09:33:58, 10:34:39: `OpId := Hash`; a plugin's op id is the name of `{op, plugin}` (`OpId.ofPlugin`, in Core); the plugins are `core/1`, `tree/1` and `id/1`; every call's body is `{op, params}` (`Call.value`); `core/1`'s write params `type` and `fields` are named in Core | A32 says an op is named by hash, nothing more | Add an "op naming" paragraph to A32 |
| 4.9 | A32 | 07:46:30: `query` is a stored op; a line is `{op, doc, params}`; bounds are enumerated values, with ranges only when a real op needs them | Nothing | Fold into A32 |
| 4.10 | A32 | 08:49:59, 07:36:57: collections nest at most N = 8 levels (rule 10). check: "directories (A26), shared folders and keep scopes become collections", against A42's separate `directory` root type | Nothing | Fold into A32 and resolve against A42 |
| 4.11 | A12, A30 | 08:06:07: the tree's statements are op calls of `tree/1` (genesis, ticket, claim, confirm, withdraw, the three settings, sign-in as a device cap), each with a fixed id; settle is the tree type's fold over op calls; a full rewrite, no bridge | A43 mentions `tree/1`'s claim and join | Rewrite A12 around `tree/1` |
| 4.12 | rule 15 | 07:21:15: a sign-in is caps' device cap from the vault to the device's vault, so removing a device is revoking it | Rule 15 has device caps, not removal | Add one sentence |
| 4.13 | A38 | 10:10:56: the confirm envelope is the issuance. A member cap is Maia City's act under its confirm cap, not Aven's own grant, so Aven's owners aren't asked per member and there's no second cap object; its lines come from `tree/1` confirm's definition | A38 has the confirm op | Fold into A38 |
| 4.14 | A38 | 07:38:22: the confirm cap is standing, from Maia City to Aven's vault, approved once and revocable; it is bounded to claims of tickets Maia City issued, not withdrawn and not yet used; the ticket keeps its passkey tap | Partly in A38 | Fold into A38 |
| 4.15 | A45 | 10:10:56, 10:43:11: an envelope's authority part is `{acks, caps}`; `caps` names the chain's cap Records root first and is empty on own authority (`Aven.ID.Authority`) | A45 says only "caps' authority part" | Add the shape |
| 4.16 | A30, A32 | 10:17:54, 10:01:24: a cap is named `[capLabel, body]`. Cap, revoke and epoch Records in a Doc are their signed forms as Values with `sigs` beside them; `Revocation` gets an encoding; `idBuiltinFit` (#1716) | Nothing | Add to a caps section |
| 4.17 | A43 | 09:04:35, 09:41:15: the genesis is `{nonce, pins, type, vault}`; the Doc id is the name of `["avenDB genesis 1", body]`; unsigned; carried by the Doc's first envelope, whose cap authorizes it as a `core/1` put of the root Record; pins only non-built-in types; present exactly in a log's first envelope (`genesis_iff_first`) | Nothing | A docs-formats section |
| 4.18 | A43 | 09:04:35: the docs body is `{acks, at, calls, cap, changes, generation, ops, records}` (`ops` half-open); the segment body is `{branch, envelopes, from, generation, prev, to, writer}` under `avenDB segment 1`, hybrid-signed; `covers` goes | Nothing | Same section |
| 4.19 | rules 5, 9 | 09:04:35, 09:34:52: one seal for loose envelopes, segments and checkpoints (`Aven.ID.Seal`): a key per kind, a commit checked in constant time before decrypting, AAD `{doc, epoch, kind}`, Padmé padding (≤ 12 %), and the outside `{commit, ct, doc, epoch, nonce}`. There is one Padmé (`Aven.ID.Padme`) | Nothing | The keys-and-sealing section |
| 4.20 | A39 | 09:04:35, 09:41:15, 07:46:59: built-in types are named by label (`<ns> <name> 1`), never pinned, with no schema Doc; whoever defines one checks its shape (`builtinFit`: docs' four, aven-id's cap, revoke and epoch); avenID's built-ins include `keyring`, `safe` and `group`, and a group holder is a group Doc | A42 lists root types per kind | Fold into A39 |
| 4.21 | docs | 09:43:29: a Record's id is bytes, and its Loro map key is the lowercase hex, injective. `RecordChange.type` is docs' `Version {type, schema?}`, where the schema is absent exactly for built-ins (`schema_none_iff_builtin`) | Nothing | Docs section |
| 4.22 | docs, rule 4 | 09:04:39: a Record's type is kept, and a retype is refused under any footprint (`typesKept`, #1712) | Nothing | Rule 4 |
| 4.23 | A19, A32 | 09:20:58, 10:00:39, 10:14:37: `lowerCore : Call → Option (List Step)` is the engine's. Read, tell, keep and share lower to nothing. A call's values are in `changes`, not its params. `put` is put-new (`lowerCore_no_replace`). A removed field counts as written. `RecordChange` lives in the engine and docs depends on it. There is one freshness hypothesis, `Fresh`, and the engine owns it | Nothing | Engine section |
| 4.24 | A45 | 09:21:01: caps' reader takes `lower` as a parameter; aven-id never depends on the engine's internals | Nothing | A45 (dependency direction) |
| 4.25 | K11, want queue 13 | 10:48:52: a topic per Doc epoch from `avenDB topic 1`, joining the newest epoch and the one before. Gossip forwards sealed bytes blind and every reader judges. A reader serves what it holds, both halves of a split included; an envelope recorded unfit is never forwarded or served; oversize envelopes go as hash-then-fetch. `doc_tips` and `doc_have` are named by topic, and tips go only to a peer met there | It contradicts K11 (1.13) | A Peers section |
| 4.26 | A44 | 10:42:15, 10:48:52: reader-to-reader sync by version (stage 3) stays apart from catch-up by arrival number from keepers (stage 5). A Peer-Light never keeps or serves by arrival number for others. One wire bump to v3 for both | A44 mentions v3 | Peers section |
| 4.27 | A44 | 11:05:37: the gate names a Doc by its id, gossip by its topic. `prove {doc}` goes only to a peer known to hold the Doc: a keeper its keep caps name, or a reader met on the topic (`prove_only_to_holders`) | Nothing | Fold into A44 |
| 4.28 | A44 | 10:58:34: `fetch {doc, hashes}` → `items` (≤ 64 KiB each, split by offset); limits per fetch, bytes in flight and offset split are named; a hash the keeper doesn't hold for the proven Doc is refused per hash; an item that fails its BLAKE3 check is dropped and its sender noted | A44 has the gate's outline | Fold into A44 |
| 4.29 | A44 | 10:45:45: the keeper's store is one CAS per upload frame, with immutable full pages and arrival numbers never reused; `dropped_listed` holds under an honest uploader | Nothing | Fold into A44 |
| 4.30 | — | 10:48:52: the keyring is a vault's own Doc of built-in type `keyring`, the only Doc sealed to devices (epochs sealed to the vault's devices and each passkey's PRF seal key), the first Doc a device holds | Nothing | Keys section (see 1.38) |
| 4.31 | docs | 09:16:01, 10:48:52: strangers never reach Loro (the signature, the place in the log and the chain are checked first). Native: `catch_unwind` with `panic = unwind`. Browser: one docs worker for all open Docs, restarted on a crash; the crashed page is retried envelope by envelope in a fresh worker, and an envelope is marked unfit only when it crashes again alone; the unfit record is local and never travels. Keys and the Closer stay in the Peer-Light and Loro only in the docs worker (prepare → sign → finish). cargo-fuzz on import | Nothing ("judge workers") | Docs section |
| 4.32 | docs | 09:16:01, 09:41:15: imports are judged a page at a time on one scratch fork and land in one batch; the target is 500 envelopes in under 1 s (76 ms measured) | Nothing | Docs section |
| 4.33 | rule 7 | 10:48:52: local first needs no native Peer. With Alice's Peer stopped, her Peer-Light's commit still reaches Bob's Peer-Light over the relay. The Aven Peer joins a topic only as a blind forwarder | Nothing | Peers section |
| 4.34 | A42, A28 | 10:44:13, 10:45:02: k of n. `approvals` are the keys of valid signatures; `byAdmin` is `Tree.approves` with `Vault.threshold`; the default threshold is 1, with k ≥ 1 required. Concurrent owner changes settle the latest by the past, ties by the smallest hash, the same in any order. A removal beats the removed owner's concurrent acts (`removal_beats`). A passkey without an owner has no counted act but its `ownerEpoch`, stated as one theorem. The tree's `counted` goes: belonging is `e.doc = pinned` plus docs' genesis check | A42 has only "k of n through A30's signatures" ("k of n owner removal") | Fold into the network section |
| 4.35 | A28, A42 | 09:57:53: authority runs down only through vaults whose quorum the issuer meets alone; a coop with k > 1 issues as itself, approved by k of its owners; a cap's issuer is a vault proven by k owner signatures or by a device signature under its device cap; thresholds live on the tree's vault record, set by `tree/1`'s owner-change op | A28 has the coop item in one line | Fold into A28 |
| 4.36 | A43 | 09:49:41, 10:01:17, 07:43:24: the migration. Migrated claims carry a partial passkey record (no owner or seal); the first sign-in after the switch adds them by the owner-epoch op, signed by the ES256 alone (`ownerless_only_adds_owner`). Sign-ins go into the snapshot; `refOrder` keeps invites, withdrawals, joins and confirms. After the switch a sign-in needs an owner. A migrated non-PRF passkey keeps its devices but adds none. Existing members get member caps at the switch under Maia City's approval | A43 covers only the device key's migration | A migration section |
| 4.37 | A43 | 06:52:19: the migration's guarantee is `settle_restore_door` plus `isClean` plus `oldSideAgrees`, checked on production's store with Lean's exported functions. On failure it refuses and the deploy fails loudly. No dual mode. A read-only pre-flight runs in a release before the switch, and production's data never leaves the server | Nothing | Migration section |
| 4.38 | A43 | 09:34:50, 08:58:27, 09:04:14: a refused sign-up signals its orphan passkey (`signalUnknownCredential`, feature-detected). No-PRF is detected from `prf.enabled` or a missing first output, never from the user agent. Existing vaults without PRF still sign in until the migration. `user.id` stays 16 random bytes, and the credential id is an unsigned hint | A43 has the refusal and the register | Fold into A43 |
| 4.39 | rule 13, A43 | 08:51:43, 10:17:16: the PRF output goes straight into the Peer-Light's wasm and only derived public halves leave it; the owner key is derived per ceremony and dropped | Nothing | Rule 13 or A43 |
| 4.40 | D18 | 08:51:43 (#1724, 11:02:41): epochs' stanza lists are padded with the one Padmé (at least 4), and tag seeds come from the previous epoch | Nothing ("Padmé, tag seeds") | Keys section |
| 4.41 | A45 | 09:57:25, 10:39:53: the codec is its own crate, `aven-codec` (`aven/DB2/codec`: Value, encode, decode, the depth limit, Hash, blake3, name_of), and aven-core re-exports it, so the runtimes' frozen modules depend only on the codec | Nothing | A45 |
| 4.42 | A45 | 10:20:42 (Samuel), 10:02:18–10:06:01: `aven-db-core` → `aven-gen1` and `db/core` → `gen1`, so "core" means only Core; Core is not renamed "kernel" | Nothing (A45 line 891 still says `aven-db-core`) | A45 |
| 4.43 | A18, rule 4 | 09:18:54, 09:57:25, 10:07:08: the runtime manifest has no floor. An entry is name, version, hash, limits and users; a withdrawal is an appended entry, and the manifest is append-only ("the bootstrap manifest"). `admit` refuses threads, relaxed SIMD and float instructions, so hosts agree. The ABI is written down | Nothing (A42 has only floors → pins) | Runtimes section |
| 4.44 | rule 13 | 09:05:55, 09:57:25: a face never draws outside its host. The drawer's `:host` uses paint containment and isolation, and every shadow root draws border-box | Nothing | Runtimes section |
| 4.45 | A1, runtimes | 10:39:53: markdown-runtime emits " " for a soft break. It resolves `base` itself, lexically (RFC 3986 dot segments, `..` clamped at the root); hrefs with a scheme are never resolved; query and fragment are kept; fragment-only hrefs get `idPrefix`. Base and prefixes are params the brain supplies, and the runtime knows no repository. There is one allowlist, the runtime's (tree.js goes) | Nothing | Runtimes section |
| 4.46 | A41 | 05:57:33 (Samuel), 06:14:50 (Samuel), 07:07:31, 09:07:23: avenBRAIN is the package for all documentation. One concept per slide, built from first principles, in English. A slide is a face drawn by face-runtime into its own shadow root; its `.style.json` is the one source, and CSS is written only by `ruleCss` after `ruleOk` | "In English" only in "Who does what next" | Fold into A41 and the parts table |
| 4.47 | runtimes | 06:50:07, 06:38:38, 08:07:34: face contrast is checked against every colour ancestors paint and full-bleed siblings, and a partly placed layer isn't seen; trees hold at most 20,000 nodes; slide text is at least 2.6cqw (≥ 9 px on a 356 px slide) | Nothing | Cite from the runtimes and brain specs (low) |
| 4.48 | A29 | 07:07:26: the wire version is in the hello and in the gossip topic's name, so two versions never share a room; `meet` answers `update` with no fallback, and `follows` moves only the older side | A36 has "the hello's number is the only wire version" | Fold into A29 |
| 4.49 | A43 | 10:40:03 (Samuel "Go"), 10:42:20: the clean-slate cutover starts. Stage 3 is Docs in the Peers, stage 4 the tree as the first Doc, stage 5 catch-up and keepers; the tree builds on stage 3's Doc interface, not on storage or gossip of its own | Nothing | A43 |
| 4.50 | A32 | 07:06:32 (#1653): only a write op's line allows a step, and a footprint appears only on a write line. check: whether A32's ops model keeps this (`no_step_without_write`) | Nothing | A32 |
| 4.51 | rule 4 | 07:09:27 (#1652, #1655): a delete on the vault's own authority ends a Doc for every reader, and only the delete's past counts (`delete_ends`, `rule4_delete_ends`) | Rule 4's verdict (156–158) doesn't mention deletes | Add it to rule 4's verdict |
| 4.52 | intro | 11:06:56 (Samuel), #1728: ARCHITECTURE.md is the single source of truth with the Lean. Specs cite; a later decision replaces the old text instead of being appended; "done" means recorded, proven and built | Contradicted by lines 10–11 (1.44) | The intro, "How this document is kept" |

**Process choices, excluded** (one-off, not architecture): merge orders (#1710 before #1697, #1716, #1718 and #1720;
#1694 before the engine moves `Version`); merge holds (07:57 to 08:22 for the contradictions audit; freezes for
releases #1641, #1648 and #1698); release cuts and "the last manual reload"; branch hygiene (a new branch after a merge,
merges not rebases, the #1622 → #1624 cherry-pick); the six-spec and box checks before each head; thread assignments
(D1–D4 to caps, B1–F1 to avenPEER, the Record shapes to minimal caps, the keep module to minimal caps); "don't archive
the threads" (Samuel 09:41:46); B3's general proof as a nice-to-have; the fuzzer image PR; the interim `Gate` trait for
tests; vector loaders listed in PR bodies; the B–F go (07:42:01), since replaced by A43's order; disk cleanup in the
box; avenBRAIN's 390 px legibility check as a tooling choice.

## 5. Structure

**The problem.** The document is a 30 Oct audit with 31 Oct decisions appended to it. One concept is stated in up to
five places: the primitives table, the vocabulary, a K-merge, a section (stress test, caps, server privileges, massive
data), and one or more A-numbers. Later A-numbers (A28–A45) override earlier text without rewriting it, so 44 of the
contradictions above are old text still standing. A-numbers are also out of order (A39 before A33; A9, A17 and A27
after A45; A22 at the end), and a decision's status lives in "Who does what next", in the A-number's own prose or
nowhere. The new CLAUDE.md rule (#1728) asks for the opposite: replace, don't append, and give every decision a status.

**Proposed outline** (each concept stated once; A-numbers inline where they decide something):
1. How this document is kept: the SSOT with the Lean; replace, don't append; status words; DECISIONS.md as the
   append-only history, if it lands (check: only on the architect's branch, `5fc77eba`).
2. The whole on one page: the layer diagram with Core at the bottom (A24 and A45 restated).
3. Packages and owners: one row per package (Core, codec, avenID, store, docs, engine, ontology, runtimes, actors,
   avenPEER with wire and keeper, avenOS, avenBRAIN, gen1), what each owns and its Lean namespace. No threads.
4. Primitives: owner = package. Add op, call, step, collection, offer cap, member cap, signature, genesis, register,
   carrier Doc, beat and generation; fix cap and ticket.
5. Rules 1–16, restated for A30 and A32, each with its Lean status inline: one table generated from `Gaps.lean`,
   replacing `architecture/README.md`'s copy and the "13 of 14" prose.
6. Vocabulary: decided verdicts only (A1 and the 31 Oct renames). Cut the "Today it means" column; GLOSSARY keeps the
   rest.
7. Signed things, envelopes, logs and counting (Core): A2, A3, A4, A30, A31, A45, limits and op naming.
8. Authority: vaults, signers, owners k of n, devices, caps built from ops, targets, collections, tickets, member caps,
   attenuation and hosts (rule 15, A27, A28, A32, A38, A39, A40).
9. Keys and sealing: passkeys and the PRF, owner, seal and device keys, the keyring, epochs, the seal, Padmé and tag
   seeds (A14, A43, D18).
10. Docs and the engine: genesis and body formats, segments, checkpoints, built-in types, the judge, lowering, the
    want queue, search and sealed indexes (A5–A9, A18–A21, A26).
11. Actors and runtimes: A16, A17, A27, A33, A37, determinism, the drawer and markdown.
12. The network and the Peers: Maia City's register, genesis, membership and confirm, guardian, releases (deferred),
    the wire, topics, sync by version, catch-up by arrival, keepers, placement and the fetch gate (A10–A13, A15, A22,
    A29, A34–A36, A44); then the migration and the cutover stages.
13. Threat model: one table merging the stress test, caps bulletproof and server privileges, with Status and Lean
    columns and a dated "production today" column.
14. Decision index, then Sources (the 30 and 31 Oct audits).

**Merge or cut.**
- Merge "Merging the primitives" (K1–K13) into §4 and §7–§12. The K-numbers were a 30 Oct merge plan, so retire them,
  noting in §14 where each went.
- Merge "Stress test", "Caps, bulletproof" and "Server peers hold only what owners grant" into §13, one row per attack
  or privilege. Drop rows whose fix is a decided A-number restated elsewhere, and keep the Lean column.
- Merge "Massive data", "Search" and "Sealed indexes" into §10. Keep the want queue's laws and drop the reasoning;
  the Lean and the engine spec hold it.
- Cut "Strengths and weaknesses" to `audits/README.md` as superseded history; every weak point is now a decision or a
  §13 row.
- Fold "Security findings in live code" into §13 as a live/spec marker, or a short log.
- Turn "Proposals for Samuel" into the decision index; the decision text moves into its concept section.
- Replace "Who does what next" with the owner column in §3 and the status column in §14 (A45: owners are packages).

**The decision index** (§14). One row per A-number, in numeric order, with nothing deleted. A superseded decision
stays as a row that names its successor, and its text is gone from the body.

| A | Decision, in one line | Where | Lean evidence (name, file) | Status | Owner |
|---|---|---|---|---|---|
| A12 | The tree is `tree/1`'s Doc: a ticket claimed once, a withdrawal beats every claim not in its past | §12 | `ticket_once` (Network.lean:118), `settleDoc_envelopes` (TreeDoc.lean:60) | Lean done (#1671, #1686, #1705); code: stage 4 | avenID |
| A14 | No dedicated RP ID; passkeys stay on `maia.city` | §9 | — | Decided no (#1632) | — |
| A36 | Release records in a release vault's log | §12 | — | Deferred (A42); #1667 parked | Peers |
| A10 | Superseded by A38 for membership | §12 | — | Superseded | — |

Status words: **decided** (recorded, no Lean yet); **Lean done** (cited names on main); **built** (code on main);
**pending #N** (an open PR); **deferred** (Samuel: later); **superseded by A_n_**. Keep the index short: one line per
decision, so that anyone, `check.mjs` included, can verify that every cited name resolves on main. That would catch
3.1–3.17 mechanically.
