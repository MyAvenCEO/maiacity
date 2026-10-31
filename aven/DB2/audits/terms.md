# Terminology: one word, one meaning (31 Oct 2026)

Read-only audit for Samuel's goal: no duplicate-terminology confusion potential.

**Anchor: origin/main `f5a6fd3d`** (31 Oct 2026 08:03 +0100, "avenBRAIN: avenID in nine slides, the brand's look, a
contents index, every tree checked (#1646)"). All `path:line` citations are on that commit, paths from the repo root.

**Counts** are matching lines per file (`grep -cP`), not occurrences. Where a word has several senses, the count is for
the sense named, checked by sampling, and flagged where a file mixes senses.

**Timeline that explains most findings.** The glossary's verdicts and both tables were last changed at `fe7ef8b6`
(30 Oct 20:43). On 31 Oct it was moved into avenBRAIN (#1630), given an avenBRAIN section, and stripped of
attributions (#1646); no verdict changed (diffs checked). Nearly all the Lean that reuses retired words landed after
20:43 on 30 Oct: `Aven.ID.Keep` with fetch-key "forks" (20:52), Caps on Core with `structure Line` (21:28),
`Aven.ID.Network` with `settle` and `View` (21:17), `Aven.ID.Records` with `RecordKind` (21:34), `Aven.DB.Docs.Changes`
with `ChangeKind` (21:53), `CapKind` (31 Oct 06:06), `Aven.ID.CatchUp` with `Tip` and beats (06:36), `Aven.ID.Placement`,
the keeper's `Order`/`Books` and `Aven.ID.Forget` (06:38 to 07:57), and avenBRAIN's slides. Core's `IsChain` (30 Oct
20:33) predates the last verdict edit. The glossary has not absorbed 31 Oct at all.

---

## Ranked: the 15 most likely to confuse

| # | Word | The problem | Proposed resolution |
|---|---|---|---|
| 1 | **settle** | GLOSSARY.md:157 says it retires; it names the tree's one rule (PEERS.md:190-192; `Aven.ID.Network.settle`, Network.lean:638) and 5 other things | Keep it for the tree only and say so; merge "resolves", fetch-key fork "the issuer chooses", `Keeper::settle` → `apply_retractions`, `settleRemovals` → `resolveRemovals` |
| 2 | **docs / Docs** | The document layer `db/docs`, the plural of the Doc primitive, and avenOS's documentation tab "Docs"; db/docs/README.md:3 has to say "not documentation" | Call the documentation **Brain** (tab, route, prose); "docs" only for the document layer |
| 3 | **seal / sealed** | Specs: "sealed" only means encrypted (ARCHITECTURE.md:178; GLOSSARY.md:362). The new slides draw "a seal: a signature" (brain/style/slide.css:203; brain/id/slides/sign.html:1), and ARCHITECTURE still says a segment is "sealed" when closed (:234, :470, :475) | Slides: "signature mark", never "seal"; finish the "closed" rename |
| 4 | **record / Record** | ARCHITECTURE.md:190 allows only `Record`; PEERS §6 and `Aven.ID.Records` make signed peer "records" central; the slides draw vaults and caps as `.record` cards with a `.record-kind` (slide.css:88; owns.html:15-17) | Rename PEERS' records (e.g. **notices**: address, presence, tip, release); slide cards → "card"; `record.rs` → `FirstStart` |
| 5 | **chain** | GLOSSARY.md:56: "The only 'chain'" is caps'; Core has `IsChain` (a log), caps has fetch-key chains, avenID has `chain` (the owners above), the chat has chains, A6 has chains of period Docs | Keep for cap chains; `IsChain` → `IsLog`; fetch keys "succeed"; `Tree.chain` → `above`; "series" of period Docs |
| 6 | **line** | GLOSSARY.md:352: "line — nobody"; caps Lean added `structure Line`, a grant line, 2.5 h later (also in Placement and caps README); chat lines fill code and Lean | Caps' `Line` → `Clause`; chat "line" only in the frozen chat format until `post` |
| 7 | **fork** | A4: fork means only a copy (ARCHITECTURE.md:603-604); A22, caps and `Aven.ID.Keep` call two fetch-key links after one key a fork; the chat code has `Answer::Fork` | Fetch keys → "rival links" (or reuse "contested"); chat `Fork` → `Split` |
| 8 | **operation / verb** | Glossary and Core say caps grant verbs `read, query, put, patch, remove, edit, tell, keep, share`; caps README defines "operation" with `write`, `mutate` (id/caps/README.md:106, 342-350); the new cap slide says "which operations" (brain/id/slides/cap.md:3) | Rewrite caps README's Terms and Operations table to Core's `Verb`; fix README.md:121 and cap.md:3 |
| 9 | **host** | A27's actor host (a device that signs for hosted actors) vs actors' "The host is the page" vs `aven-runtimes-host` vs the platform a safe runtime runs on; glossary covers only page vs runtime host | Always qualify: "actor host", "runtime host"; actors' layer 6 → "the page side"; caps' platform → "platform" |
| 10 | **ack** | Caps' ack (marks a revocation), the tree's ack (an admin device finalises a claim), actors' `ack` frame; the glossary lists only the first and last | Tree's ack → **confirm** (avenOS already says "Waiting for Maia City to confirm"); actors' frame → receipt |
| 11 | **split** | A4: final, neither side counts (ARCHITECTURE.md:73); `Aven.ID.Records` calls two records with one counter "a split (A4)" and takes the smaller body (Records.lean:23-24) | Apply A4 to records, or call it a "tie" broken by the smaller body |
| 12 | **Placement** | `Aven.ID.Placement` (31 Oct): who keeps a vault's Docs; `Aven.Runtime.Markup.Placement` and actors' "placing": spawning a face by drawing it | Rename caps' module `Aven.ID.Keeping` (or `Custody`); placement stays actors' |
| 13 | **page** | Browser page, a catch-up page (a bounded batch), a page Record `{title, body}`, avenBRAIN's wiki page, wasm memory pages | Catch-up unit → "batch"; the engine's example type → "note"; ⚠ between the other two |
| 14 | **kept / keep / keeper** | "kept, unseen" (lens), caps' "kept list", the wire's `kept` frame and "Kept by the network", `kept_*` theorems, `Record.kept`, "kept-out"; `Keep` (a keeper's state) vs keep (a durable want); "keeper list" vs "kept list" | "kept" only for what a keeper holds; lens → "parked"; caps → "last-seen list"; `Keep` → `KeeperState` |
| 15 | **tip / head** | Core.Past `tips` = an envelope's parents; a version's tips; a signed log tip; tree tips; the wire `Head` is the signed log tip under another name; "tip" is not in the glossary | Add "tip"; `Past.tips` → `parents`; wire `Head` → `Tip` at the next wire version |

Close behind: **beat / presence** (wire clock beat, signed presence beats, `Network.beats`), **kind** (glossary says only
vaults; five new Lean enums and the slides' `.record-kind`), **link** (6 senses), **version / v1** (v1 means the old
stack and also the new chat before sealing), **join** (the new passkey slide says a sign-in "joins her vault"),
**index** (avenBRAIN's contents index), **network** (8 senses), **address** (glossary's `<home>/<id>` is stale),
**fit** vs `Node.Fits`, **`Gate` → `Door`** (blocked: `Door` exists), **safe runtime** vs the runtime primitive,
**layer**, **part / package**, **standing**, **order / withdraw / delete**, **verdict** count, **admin**, **member**,
decision labels (D1-D5 mean caps decisions and PEERS Thread D tasks in one file).

---

## (a) New terms not yet in the glossary

The glossary has no entry for: tip, beat, attenuation, device cap, actor host, outer bound, address record, release
record, wire version, relay list, keeper list, log tip, tree tip, fetch link, ground fork / grind, quota, whole merge,
own authority, change view (`RecordChange`), admin device, settled tree, bootstrap, home relay, contested, final claim,
placement (caps), listing, order, books, migration guarantee, clean store, old side, forgetting, contents index, seal
(slide), card, pill (searched by string in GLOSSARY.md).

### `Aven.ID.Admit` (aven/DB2/id/spec/Aven/ID/Admit.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `TreeStatement.brings` (:19-24) | The device a statement brings to the door: a claim's first device or a sign-in's device | — |
| ack policy, `ackPolicy`, `honest_ack_once` (:32-48) | An admin device acks only a claim that stands in its own view, never a second claim of a ticket with a final one | **ack** (caps, GLOSSARY.md:61; actors' frame, :285) |
| `newcomer`, `newcomer_own`, `newcomer_admitted` (:67-95) | A relay or hook lets a key in if the settled tree admits it, or if it brings a statement naming it as the device | consistent with GLOSSARY.md:37 |
| view (`view ok pinned V`, :37) | A device's settled view (`Network.View`) | **view** |
| labels B1, B2 (:3, 5, 11) | PEERS Thread B tasks | see "labels" in (b) |

### `Aven.ID.CatchUp` (CatchUp.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `Tip` (:22-26), log tip | A device's signed tip: its newest post's number and hash | **tip** (Past.lean:20-21; ARCHITECTURE.md:74; Network.lean:178-183); same thing as the wire `Head` (Wire.lean:17) |
| `Copy` (:28-29) | A source's copy of a device's log as post hashes | weakly "scratch copy" (GLOSSARY.md:160) |
| `reaches` (:31-35) | A copy holds the tip's post at the tip's place | `Reaches` (Log.lean:111-112), `Node.reaches` (Node.lean:131), `Grant.reaches` (Caps.lean:64) |
| `caught`, `withheld_shows`, `forged_shows` (:37-53) | A source whose copy falls short of, or differs at, the signed tip | — |
| `choose`, `chosen_reaches`, `none_chosen`, `honest_chosen` (:55-79) | The first source, in asking order, whose copy reaches the tip | weakly `Keep.chosen` (Keep.lean:260) |
| `present`, `window` (:85-88), `present_set`, `present_signed` | Present while the newest signed beat is at most `window` steps old | `Aven.DB.Presence.present` (Presence.lean:85, the hub's count); want **window** (ARCHITECTURE.md:89) |
| presence beat (:14-17) | A device's signed record per clock step | wire `beat` (Wire.lean:35); `Network.beats` (Network.lean:481) |

### `Aven.ID.Forget` (Forget.lean; on main since #1640, 31 Oct 07:57)

`readable` (:31), `rotation_shuts_out` (:35), `forgotten` (:44), `forgotten_unreadable` (:50), `copied_stays` (:56, its
hypothesis is named `kept`): once no one holds a Doc's keys, no sealed copy is readable; what a reader copied stays its
own. Header "Thread D, D5" (:3) and "D2 and D3" (:21) are PEERS Thread D tasks, not caps decisions D2/D3
(id/caps/README.md:18). No collision for "forget" itself.

### `Aven.ID.Node` (Node.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `Fits` (:43) | A new envelope fits a device's own log: the next seq, naming the one before | **fit** (docs' schema fit, GLOSSARY.md:141; both in Rules.lean:82-87 and :118-123); chat `fits` (db/core/src/chain.rs:372) |
| `Device` (:49: `own`, `held`) | A device as its own log plus what it holds of others' | avenID device; **own** |
| `write`, `write_fits`, `write_chain` (:54-63) | A write appends to the own log and keeps it a chain | **chain** (Core `IsChain`) |
| `split_spreads` (:97) | A split's proof reaches every reader that syncs | **proof** |
| `Net` (:116-120: members, relays, usable, holders) | The network as topology | **network** (GLOSSARY.md:44-45) |
| `home` (:127) | A device's home relay | actor **home** (GLOSSARY.md:253) |
| `holders` (:120) | A Doc's holders: its writers' devices and keepers | caps **holder**; store holder (GLOSSARY.md:105) |
| `fetchable`, `no_only_relay`, `no_only_holder`, `kept_fetchable` (:147-201) | R7: no peer is the only source | **kept** |
| `Sent`, `outgoing`, `seenBy`, `no_plain_to_nonreader`, `relay_blind`, `keeper_blind` (:215-248) | R9 | — |

### `Aven.ID.Network` (Network.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `TreeStatement` (:179-185), `TreeSays` (:158-175) | A signed tree statement; kinds genesis, signIn, ticket, withdrawal, claim, ack, relayAdd/Remove, keeperAdd/Remove | **statement** (= envelope, GLOSSARY.md:25); not built on Core's `Envelope`, though PEERS.md:179 says "a log of envelopes" |
| `Genesis` (:140-152), `GuardianKeys` (:131), `consented` (:154) | The network's first statement | Doc **genesis** (GLOSSARY.md:142) |
| `settle` (:638), `Settled` (:194-203) | The pure function from statements to the tree | **settle** retires (GLOSSARY.md:157) |
| `InPast`, `inPast`, `pastNames`, `fresh` (:210-280) | "In the past of" over statements | duplicates Core.Past (Past.lean:29-51); **fresh** (Authorized.lean:300) |
| `pinnedGenesis`, `Desc`, `counted` (:401-413) | Part of the tree | **counts** (GLOSSARY.md:158) |
| `View`, `view` (:419-434) | The counted statements and the past between them | **view** |
| `admin` (:452), `adminPasskey` (:462) | Admin key (passkey, first devices, signed-in devices); admin passkey only | GLOSSARY.md:36 |
| `final` (:477), `beats` (:481), `standing` (:488), `contested` (:199) | Claim states | "final" (splits), **beat**, **standing** cap |
| `member` (:497), `admits` (:529), `listed` (:544) | Member vaults incl. the admin coop and the agent; admitted devices; list entries | **member** (GLOSSARY.md:34); "keeper list" vs caps' "kept list" |

### `Aven.ID.Records` (Records.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `RecordKind` (:31-37), `PeerRecord` (:52-58) | Self-signed, newest-wins records: address, presence, log tip, tree tip, release | **Record**; ARCHITECTURE.md:190; **kind**; **body** (Log.lean:30) |
| labels `aven/peer/…/1` (:40-45) | One signing label per kind | — |
| `takes`, `newer`, `isNewest`, `newest` (:62-83) | Newer = larger counter, then smaller body | — |
| "a split (A4) … the smaller body is taken" (:23-24, :160) | Two records with one counter | **split** (A4: neither side counts) |
| release line (:50) | A release's channel | **line** |
| `speaks`, `speaks_same` (:141-146), wire version | One wire version, no fallback | **version** |

### `Aven.ID.Keep` (Keep.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `FetchLink` (:48), fetch link | A fetch key's successor | **link** |
| `Chained` (:232), `fetch_chain`, `kept_every` (:251) | Fetch keys chain from the genesis; a keeper takes every successor | **chain**, **kept** |
| `level`, `walk` (:271), `depth` (:279), `current` (:282) | Walking to the current key | **walk** (GLOSSARY.md:178; Walk.lean), **depth** |
| `forked`, `flags`, `fork_flagged` (:388-396); ground fork, grind (:22-27) | Two links after one key | **fork** |
| `Choice` (:59: depth, fork, branch, signer) | The issuer choosing a branch | **branch** |
| `unsettled` (:418), `grind_settled`, `settled_example` | A fork not yet chosen | **settle** |
| `Proof` (:410), `serves` (:426) | A device's proof on one connection | **proof** |
| `Upload`, `bill`, `spent`, `admit` (:505), `quota_holds` | Who pays; uploads within quota | **admit** |
| `Keep` (:68) | A keeper's state for one Doc | **keep** (a durable want) |
| `FetchLink.before` (:137) | An order on links | **Before** (Core.Past) |
| `Listing` (:564) | A keep cap as its keeper holds it, with the Docs its issuer resolved | A7's "a listing can be withdrawn" (ARCHITECTURE.md:613); `Listed` (Network.lean) |
| `Order` (:569: withdraw, delete), `Signed` (:575) | An order from a keep cap's issuer, and its signer | **order** ("Order is causal", ARCHITECTURE.md:130; engine `order`); **withdraw** (a ticket's withdrawal); **delete** (the chat's delete, a retraction); `Aven.Core.Signed` (a module) |
| `Books` (:582), `valid`, `withdrawn`, `deleted`, `keepsUnder`, `keeps`, `Books.serves` (:595-618) | A keeper's books | `Cap.keeps` (Placement.lean:49); `Keep.serves` |
| `kept_only_covered`, `kept_only_by_owner`, `kept_by_owner`, `withdrawn_dropped`, `others_kept`, `deleted_gone`, `deleted_final` (:632-717) | A keeper keeps only owner-approved keep caps' Docs | **kept**; labelled "(D1)", "(D2)", "(D3)" (:630, :667, :696) beside caps' "(D14)" |

### `Aven.ID.Placement` (Placement.lean, new 31 Oct)

| Term | Meaning | Collides with |
|---|---|---|
| Placement (:3) | Who keeps a vault's Docs | **`Aven.Runtime.Markup.Placement`** (Markup.lean:64-65: a component placed in a face); actors' "placing, placer, place" (GLOSSARY.md:248); ontology "place" (:217) |
| `coversB`, `coversB_iff` (:37-44) | Core's `Target.covers`, computed | — |
| `Cap.keeps` (:49), `Cap.keeper` (:58), `keepersOf` (:64), `keepers_by_caps`, `holder_keeps` | A cap keeps a Doc when a `keep` line reaches it | **keep** |
| `resolve`, `resolve_exact` (:86-91) | The issuer's device hands the keeper exactly the Docs covered | — |
| `defaultKeep` (:102), `default_kept` (:107), `default_approved`, `default_needs_owner` | The default keep cap, an ordinary grant needing owner approval | **kept** |
| `keep_one_holder`, `keeper_named_by_owner`, `keepers_by_owner` (:165-201) | No keeper passes data on; only the owner names keepers | — |
| "its lines `keep` targets" (:6) | Grant lines with the `keep` verb | **line** |

### `Aven.ID.RestoreDoor` (RestoreDoor.lean, new 31 Oct) and `Aven.ID.FailJson` (FailJson.lean, new)

| Term | Meaning | Collides with |
|---|---|---|
| `Clean` (RestoreDoor.lean:18), `isClean` (:484) | A store `Members.restore` reads back clean | — |
| `restoredKeys` (:33), `settle_restore_door` (:419), `oldSideAgrees` (:497), "the old side" (:479) | The settled door admits exactly a clean store's device keys | **settle** |
| `steps` (:42) | The migrated statements | Core's `Step` (Target.lean:133: a lowered write step) |
| labels B3 (:3), F1 (FailJson.lean:5) | PEERS Thread tasks | labels |
| "the box's failures", `failures.json`, `gone` (FailJson.lean:5-26) | The nine box checks with the Aven Peer gone | — |
| PEERS: "the migration's guarantee", "pre-flight", "Release N, N+1", "the switch", "dual mode" (PEERS.md:271-288) | How production's tree migrates | **version** (Release N) |

### `Aven.ID.Caps` (Caps.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `Line` (:39-43) | One line of a grant: target, verb, footprint grants | **line** |
| `Grant` (:45) = `List Line` | What a cap grants | `Core.Grant` (Target.lean:139-144); `CapKind.grant`; "a cap is a signed grant" |
| `Branches` (:110-115) | Which branches a cap writes | applied (`lines` → `branches`, GLOSSARY.md:55) |
| `Conditions` (:172-178), `own` (:177) | Conditions; `own` = Records its holder created | **own** vs `Reader.Own` |
| `Holder` (:203-208) | vault, group, public, ticket | **holder** |
| `CapKind` (:220-224), `CapKind.hops` | grant (passes the parent to a holder, approved) or attenuate (narrows for the same holder) | **kind**; **hops** |
| `Cap` (:237-247: kind, grant, share …) | A cap; `share : Nat` is a share depth | `share` verb; **depth** |
| `keepShares` rule (new) | A keep cap may not share | — |

### `Aven.ID.Authorized` (Authorized.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `DeviceCap` (:67-73, `host`) | A device's cap; `host` marks an actor host's device | **host** |
| `Reader` (:84-100), `actorOf` | What a checking reader knows | caps' **reader** (GLOSSARY.md:86-87 says the same readers) |
| `WithinDevice` (:114), `Own` (:119), `ByChain` (:124), `HostSigned` (:131), `Authorized` (:136) | Own authority or a chain; a host only by chain | **own**; **path** ("either path", :38-39) |
| `WholeMerges` (:215) | A merge into main judged whole | — |
| `Verdict` (:300) | signed, fresh, authorized, live, fit | docs' `Verdicts` (Counts.lean:26) and GLOSSARY.md:158 ("three"); **live**, **fresh** |
| `Facts` (Core, Target.lean:20-24) | What a Doc's genesis fixes | ontology **fact** (GLOSSARY.md:167, 215) |

### `Aven.Actor.Signing`, `Aven.Actor.Messaging`

| Term | Meaning | Collides with |
|---|---|---|
| `HostWrite` (Signing.lean:34-40), `signWrite`, handled message, carried chain | What the kernel hands the host's device to sign | **host**, **own** |
| outer bound (Signing.lean:6-7; ARCHITECTURE.md:686) | The host's device cap | engine **bound** (GLOSSARY.md:191) |
| `attenuation`, `kernelAttenuate` (Messaging.lean:37-47), `messageChain` (:50) | At most one attenuation per message | **bound** (a parameter), **link** |
| standing delegation, provenance (Messaging.lean:14-20) | A standing grant to another vault; a chain carried only as information | **standing** |

### `Aven.DB.Wire` (Wire.lean)

| Term | Meaning | Collides with |
|---|---|---|
| `kept` frame (:60-63) | The Aven Peer tells a sender's links which files it holds whole; avenOS then says "Kept by the network" (os/web/apps/Chat.svelte:315-317) | **kept** |
| `Head` (:17-21), `Have` (:24), `heads` (:53) | A device's chain as a peer holds it | **head**; = `CatchUp.Tip` |
| `beat` (:35), `presence` (:33) | The Aven Peer's clock; the hub's count | **beat**, **presence** |
| `network` (:48), `claim` (:37), `invite`, `withdraw`, `join` (:41-45) | The pre-PEERS tree frames | **network**, **claim**, invite/join |
| frames, `maxFrame` (:6-8, 66) | One JSON object per line | **frame**; JSON **line** |

### `Aven.Core.Past`; `Aven.DB.Docs.Walk`, `Writers`, `Counts`

| Term | Meaning | Collides with |
|---|---|---|
| `tips e` (Past.lean:20-21) | `prev` + `deps` | **tip** |
| `Before` (Past.lean:29-31), `past`, `inPast` | `b` is in `a`'s past | `Aven.ID.Before` (Before.lean:4), `FetchLink.before` (Keep.lean:137), the `before:` genesis field (db/docs/README.md:693, 777) |
| `fresh`, `pastNames` (Past.lean:38-46) | One round of the search | **fresh** |
| `walk` (Walk.lean:37-46), `under`, span, summary | A lookup walks down a sealed index | engine **walk**; `Keep.walk` |
| `Good` (:80), `Honest` (:378), `verify` (:382), `walk_verified` | Honest summaries; a store whose Values hash to their names | "honest acks" (Admit), "honest readers" (Keep) |
| `Fold` (:343), `fold_exact` | A fold is a checkpoint | consistent (GLOSSARY.md:207) |
| node, root, leaves (Walk.lean:5-8) | Search-tree nodes | avenPEER's **node**; **node tree** |
| `writer` (Writers.lean:29-32), `reservedPeer` (:27) | The writer-id derivation | **writer** (a log's author) |
| `Verdicts` (Counts.lean:26-29), `live` (:53) | fit, authorized (+ not split); a branch's live state | `Reader.Verdict`; **live** |

### avenBRAIN (aven/DB2/brain, os/web/docs)

| Term | Meaning | In glossary? | Collides with |
|---|---|---|---|
| page | One package's part of the wiki (GLOSSARY.md:339) | yes | browser, catch-up, Record pages |
| story | A page's concepts in reading order (:340) | yes | only "trust stories" (ARCHITECTURE.md:208) |
| slide | One concept on one 16:9 still (:341-342) | yes | none in scope |
| layer | A visual element with a stable class (:343; brain/STYLE.md:42) | yes | architecture, key and actor layers |
| arrow | A relation on a slide (:344) | yes | — |
| Docs (tab, `#/docs`) | avenOS's documentation view (os/web/docs/MainNav.svelte:8; Docs.svelte:70) | prose only (GLOSSARY.md:3, 337-338) | **docs**, **Docs** |
| contents index | The page's table of contents (os/web/docs/Docs.svelte:25, 96; brain/STYLE.md:29, 44) | no | **index** |
| catalogue | `docs.json` (brain/docs.json:2; brain/README.md:14; os/web/docs/brain.js:1, 4) | no | engine catalogue, retired (GLOSSARY.md:180, 396) |
| package | A top-level component (brain/docs.json:3; GLOSSARY.md:337) | in prose | ARCHITECTURE's "part"; Docs.svelte:20 names it `part` |
| still, frame | The 16:9 picture (brain/README.md:35; STYLE.md:37) | no | **frame** |
| card, pill, chip, bracket, tick (STYLE.md:22-31) | Drawn shapes | no | — |
| record, `record-kind` (slide.css:88; owns.html:15-17; cap.html:2-4; STYLE.md:29) | "A thing the system keeps (a vault, a cap), as a soft white card. Its kind is a pill" | no | **Record**, **kind** |
| seal (slide.css:203; sign.html:1, 20; check.html:7; cap.html:13; STYLE.md:22) | "a seal: a signature" | no | **sealed** (encrypted) |
| live package (docs.json:2; STYLE.md:20; Docs.svelte:235) | A package with a page | no | **live** |

New slide texts: "which operations" (brain/id/slides/cap.md:3, retired caps word); "the browser joins her vault" for
a sign-in (passkey.md:7; GLOSSARY.md:33 says join = an invited browser founding a vault); "Her photos and notes are
kept in it" (vault.md:3-4); "a coop's belongs to a group of people" (vault.md:6; **group** is a caps primitive).

---

## (b) Collisions: one word, two or more meanings

Each meaning with 2-3 citations, then which glossary verdict covers it.

### High

**settle.** (1) The tree's rule — PEERS.md:190-192; Network.lean:638, :194; id/caps/README.md:35, 457-458. (2) A merge
resolving conflicts — db/docs/README.md:164; db/spec/Aven/DB/Docs/Merge.lean:4; db/spec/Aven/DB/Engine/Examples.lean:384-390.
(3) The issuer deciding a fetch-key fork — Keep.lean:22, 418; id/caps/README.md:797; ARCHITECTURE.md:733;
Architecture/Rules.lean:251. (4) Clashing owner removals — id/spec/Aven/ID/Recover.lean:36 (`settleRemovals`). (5) The
chat keeper applying retractions — db/core/src/chain/retract.rs:3, 159; peer/native/src/chats.rs:792-795. (6)
Revocations decided by acks — ARCHITECTURE.md:224, 232; db/spec/Aven/DB/Engine/Wants.lean:553. (7) The retired split
settlement — ARCHITECTURE.md:471, 603; db/docs/README.md:490, 816. *Glossary:* only (7), "retires" (GLOSSARY.md:157).

**docs / Docs / Doc.** (1) Plural of Doc — ARCHITECTURE.md:23; brain/docs.json:25 ("Values, Docs, records and the
store"). (2) The document layer — db/docs/README.md:1-3; GLOSSARY.md:129 (section "docs"); ARCHITECTURE.md:775. (3)
The documentation and avenOS's "Docs" tab — brain/README.md:4-5; os/web/docs/MainNav.svelte:8; Docs.svelte:2-3, 70;
GLOSSARY.md:3, 335; ARCHITECTURE.md:779-780 ("the two the docs need", "The docs wiki"). Also "document" = Doc
(db/engine/README.md:3-7; README.md:71). *Glossary:* no ⚠; uses (2) and (3) as section titles.

**seal / sealed.** (1) Encrypted to readers — ARCHITECTURE.md:68, 124, 178; GLOSSARY.md:362. (2) Closed into a segment
(→ closed) — ARCHITECTURE.md:234, 470, 475; README.md:180. (3) Fixed into a name — db/docs/README.md:260 and decision
13. (4) A drawn signature — brain/style/slide.css:203 ("a seal: a signature"); brain/id/slides/sign.html:1 ("a seal
under them: signed by Alice's key"), :20; cap.html:13; brain/STYLE.md:22 ("a seal's ring"). *Glossary:* (1) kept,
(2) → closed; (3), (4) uncovered, and (4) teaches beginners the opposite of (1).

**record / Record.** (1) The primitive — ARCHITECTURE.md:79; db/docs/README.md:126. (2) Signed peer records —
PEERS.md:39-42, 102, 290-303, 321; Records.lean:3-17, 31-58. (3) A peer's first-start status —
peer/native/src/record.rs:1-3, 13; README.md:13, 41. (4) An actor log entry — actor/ARCHITECTURE.md:37, 89-90. (5)
avenBRAIN's card for a vault or a cap, with a `record-kind` — brain/style/slide.css:88; owns.html:15-17; cap.html:2-4;
brain/STYLE.md:29; brain/README.md:39. (6) "records" in the docs catalogue — brain/docs.json:25. *Glossary:* "record
only as Record" (ARCHITECTURE.md:190); → entry (GLOSSARY.md:258); → status (:332). (2) and (5) contradict.

**chain.** (1) Caps' cap chain — Caps.lean:13; Authorized.lean:124; Signing.lean:7-14; ARCHITECTURE.md:684-688. (2) A
well-formed log — Log.lean:14, 156-157 (`IsChain`); Node.lean:63 (`write_chain`); Rules.lean:63-64;
id/caps/README.md:814 ("a writer's chain"). (3) Fetch keys — Keep.lean:8, 232; id/caps/README.md:34, 759;
ARCHITECTURE.md:225, 251. (4) The chat's chain per device — Chains.lean:8-9; db/core/src/chain.rs:379-382;
Wire.lean:15-17. (5) avenID's vaults above — Query.lean:41; id/core/src/query.rs:45; os/web/apps/ControlRoom.svelte:18.
(6) Chains of period Docs — ARCHITECTURE.md:348, 611; db/docs/README.md:244, 834. (7) BLAKE3's chaining value —
Blake3.lean:6, 74. *Glossary:* (1) kept, "The only 'chain'" (GLOSSARY.md:56); (4) → log (:112); (5) → the owners above
(:22). (2), (3), (6) uncovered.

**line.** (1) A chat line — Chains.lean:8-9; db/core/src/chain.rs:166; Wire.lean:59; PEERS.md:120. (2) A grant line —
Caps.lean:9, 39-43; Placement.lean:6; id/caps/README.md:1218; actor/spec/Aven/Actor/Hosting.lean:10, 29. (3) A JSON or
text line — Wire.lean:6-8; runtimes/README.md:381, 406. (4) An invoice's line item — db/docs/README.md:274-277;
db/engine/README.md:185. (5) "A line of versions" — db/docs/README.md:584. (6) A release line — Records.lean:50. (7) A
peer timeline line — peer/native/src/keep.rs:11-12; record.rs:51; db/core/src/timeline.rs:6. (8) "One type's line" in
the registry — GLOSSARY.md:304-305. (9) Docs' history line → branch — db/docs/README.md:183. Also a chat message's text
(Chat.lean:8-9). *Glossary:* "line | nobody" (GLOSSARY.md:352) covers (1) and (9); (2) contradicts it.

**fork.** (1) A copy into a new Doc — db/docs/README.md:168, 549-551; GLOSSARY.md:155-156 ("Only this meaning"). (2)
The chat's equivocation — Chains.lean:19-20, 28; db/core/src/chain.rs:367, 428. (3) Two fetch-key links after one key —
Keep.lean:10, 13, 22-27, 388-396; id/caps/README.md:648, 766, 797-805; ARCHITECTURE.md:251, 730-736. (4) Loro's fork —
db/docs/README.md:508, 945. (5) A software fork — README.md:159. *Glossary:* (1), (2) → split (:114); (3) contradicts
A4.

**operation / verb.** (1) Engine operation — ARCHITECTURE.md:88. (2) Caps' "operation" with `write`, `mutate` —
id/caps/README.md:4, 101, 106, 153, 342-350; Caps.lean:6; brain/id/slides/cap.md:3. (3) Verbs — Target.lean:114-115;
ARCHITECTURE.md:85. (4) Step verbs `put-new` … — Target.lean:120-130; id/caps/README.md:361-363. (5) Loro's op —
db/docs/README.md:137. (6) The engine's `"op"` field — db/engine/README.md:226, 429. *Glossary:* (2) → verb
(GLOSSARY.md:51-52), not applied, and the verb lists disagree (d9).

**host.** (1) Actor host (A27) — ARCHITECTURE.md:684-693; id/caps/README.md:426-432; Authorized.lean:73, 131;
Signing.lean:4-9. (2) Actors' host is the page — actor/ARCHITECTURE.md:19, 32, 415-417, 529. (3) The runtime host —
runtimes/README.md:91, 145; actor/ARCHITECTURE.md:528. (4) A platform with a safe runtime — id/caps/README.md:129, 962,
980-987. (5) A web server or this device — PEERS.md:41, 303; Docs.svelte:3; peer/light/src/views.rs:2. (6) "What hosts
still see" — id/caps/README.md:1030. *Glossary:* (2) vs (3) only (GLOSSARY.md:300-301).

**ack.** (1) Caps' revocation ack — id/caps/README.md:117-118, 826-836, 843; db/docs/README.md:318, 331. (2) The tree's
ack, finalising a claim — PEERS.md:47, 198-204; Network.lean:170, 477-478; Admit.lean:5-9, 32-39; ARCHITECTURE.md:641.
(3) Actors' `ack` frame — actor/ARCHITECTURE.md:501; GLOSSARY.md:285-286. *Glossary:* (1), (3) (GLOSSARY.md:377); (2)
missing.

**split.** (1) Final, neither side counts — ARCHITECTURE.md:73; Log.lean:9-10, 102-103. (2) Two peer records with one
counter, smaller body taken — Records.lean:23-24, 160. (3) A network partition — ARCHITECTURE.md:232. *Glossary:* (1).

**Placement / place.** (1) `Aven.ID.Placement`, who keeps a vault's Docs — Placement.lean:3; id/caps/README.md:1245.
(2) `Aven.Runtime.Markup.Placement`, a component placed in a face — Markup.lean:14, 64-65, 88; actors' placing —
GLOSSARY.md:248; actor/ARCHITECTURE.md:200, 655. (3) Ontology places x1-x5 — GLOSSARY.md:217. *Glossary:* (2), (3); (1)
is new.

**page.** (1) Browser page — ARCHITECTURE.md:132; actor/ARCHITECTURE.md:417; db/engine/README.md:89, 104;
id/caps/README.md:993. (2) A catch-up batch — ARCHITECTURE.md:126, 336, 339; db/docs/README.md:413-416; Wire.lean:53;
db/core/src/wire.rs:114-118. (3) A page Record — db/engine/README.md:5, 173, 395-413; db/docs/README.md:199, 697. (4)
avenBRAIN's page — GLOSSARY.md:339; brain/README.md:3; brain/VOICE.md:20. (5) Memory pages; a render's `page` —
runtimes/README.md:87, 59. *Glossary:* (2) (GLOSSARY.md:115-116, 200) and (4) (:339), no ⚠.

**kept / keep / keeper.** *kept:* (1) "kept, unseen" — db/docs/README.md:237; GLOSSARY.md:138. (2) caps' kept list —
id/caps/README.md:119-120, 831; GLOSSARY.md:61-62. (3) Held by a keeper — Wire.lean:60-63; Chat.svelte:315-317;
Node.lean:201; Placement.lean:107; Keep.lean:632-684; PEERS.md:140, 145. (4) Every fetch-key successor — Keep.lean:251.
(5) The store held it (a restart) — peer/native/src/record.rs:17-18. (6) Refused at the door, "kept-out" —
peer/native/src/relay.rs:80. (7) A line stored before canonical bytes — db/core/src/chain.rs:221-223. *keep:* (1) A
durable want — GLOSSARY.md:185. (2) The verb and keep cap — Target.lean:115; GLOSSARY.md:74. (3) `Aven.ID.Keep`, a
keeper's state — Keep.lean:68. (4) `keep::keep` — PEERS.md:23, 164. (5) `--keep` — PEERS.md:134-136. *keeper:* (1)
The primitive — ARCHITECTURE.md:94. (2) Code `Keeper` — db/core/src/chain.rs:382; Chains.lean:158. (3) The keeper list —
PEERS.md:134; Network.lean:173-174, beside caps' "kept list". *Glossary:* covers keep, keeper, `Keeper` → `Logs`, kept
(lens), kept list, with no ⚠ among them.

**tip / head.** *tip:* (1) Past.tips = prev + deps — Past.lean:20-21. (2) A version's tips — ARCHITECTURE.md:74;
Log.lean:193-197. (3) A signed log tip — CatchUp.lean:22-26; Records.lean:10, 34; PEERS.md:122-124. (4) Tree tips —
Network.lean:178-183; Records.lean:11, 35; PEERS.md:177, 298. *head:* (1) The ref (ARCHITECTURE.md:175; README.md:119)
or a Value under it (db/docs/README.md:156). (2) `chat-<device>` — GLOSSARY.md:113; Chains.lean:11-12. (3) The wire
`Head` — Wire.lean:17-21, 53. (4) The want depth `head` — db/engine/README.md:274; ARCHITECTURE.md:313. (5) Signed tree
heads — ARCHITECTURE.md:76, 406. *Glossary:* no "tip".

### Medium

**beat / presence.** *beat:* (1) The wire clock — Wire.lean:35; peer/native/src/hub.rs:3, 277; db/core/src/status.rs:7.
(2) Signed presence — PEERS.md:111-113, 301; CatchUp.lean:14-17, 85-88. (3) `beats`, a withdrawal winning — Network.lean:481-484;
id/caps/README.md:1276. (4) Keeper liveness — PEERS.md:160. (5) The gossip `here` loop — peer/native/src/room.rs:141-149.
*presence:* (1) The hub's count — Wire.lean:33; Presence.lean:1-7, 85. (2) `here`/`bye` — db/core/src/chat.rs:1-5,
24-28. (3) Signed beats — PEERS.md:111; Records.lean:9, 33. *Glossary:* presence = (2) (GLOSSARY.md:328); no "beat".

**kind.** (1) Vault kind — Tree.lean:12. (2) Cap kind — Caps.lean:220-224, 242; id/caps/README.md:308. (3) Record kind —
Records.lean:31-37. (4) Change kind — Docs/Changes.lean:28. (5) Chat message kind — Chat.lean:26; chat.rs:24-28. (6)
Actor message kind — actor/ARCHITECTURE.md:105-116; Basic.lean:42. (7) Ontology kinds — db/engine/README.md:20,
445-448. (8) A join's kind — db/engine/README.md:412. (9) Statement kinds — PEERS.md:183. (10) avenBRAIN's
`record-kind` — slide.css:88; owns.html:17; STYLE.md:29. *Glossary:* "only for vaults" (GLOSSARY.md:18-19, 221, 364).

**link.** (1) The field — ARCHITECTURE.md:80, 309, 671. (2) A peer connection (`link.rs`) — PEERS.md:54-55, 114, 125. (3)
An invite link — PEERS.md:40, 45-49, 108. (4) A cap chain's link — ARCHITECTURE.md:700-701; id/caps/README.md:308, 502,
547; Revoke.lean:8. (5) A fetch-key link — Keep.lean:48; id/caps/README.md:760-767. (6) A key blob's link —
id/caps/README.md:126, 185. *Glossary:* (1) only (GLOSSARY.md:134, 400).

**version / v1.** (1) A set of envelopes — Log.lean:193-194. (2) A schema version — GLOSSARY.md:281-283;
db/docs/README.md:174-176. (3) A runtime version — runtimes/README.md:83, 107. (4) The wire version — PEERS.md:318-320;
Records.lean:138-146. (5) A release — PEERS.md:281-286, 321; CLAUDE.md:7-8. (6) avenACTOR's "version 1" —
actor/ARCHITECTURE.md:7 and 24 more lines. (7) "v1": the old stack (README.md:3, 8, 85; GLOSSARY.md:321) but also the
new chat before sealing (Chains.lean:11; db/core/src/chain.rs:3; store/README.md:103). *Glossary:* (1), (3) without ⚠.

**join.** (1) Claiming a ticket — GLOSSARY.md:33; Wire.lean:45; ARCHITECTURE.md:641. (2) A sign-in, "the browser joins
her vault" — brain/id/slides/passkey.md:7. (3) A query join — db/engine/README.md:412. (4) Joining a gossip room or
group — PEERS.md:105; id/caps/README.md:612. *Glossary:* (1).

**index.** (1) A query or sealed index — GLOSSARY.md:206-209. (2) A file's index (→ chunk list) — Files.lean:7-8,
216-220; db/engine/README.md:79; PEERS.md:163. (3) avenBRAIN's contents index — Docs.svelte:25, 96; STYLE.md:29, 44. (4)
A position ("by its index in the cast") — Presence.lean:14. *Glossary:* (1), (2) → chunk list (GLOSSARY.md:100).

**network.** (1) The members group — ARCHITECTURE.md:83, 625-629. (2) The old vault kind — README.md:104-105, 193-198;
Before.lean:6. (3) The statement field `"network":"aven"` — id/core/src/invite.rs:9-11; Claim.lean:9-10; chat.rs:11.
(4) Rust `Network` — id/core/src/network.rs:1-6, 66. (5) Lean `Aven.ID.Network` — Network.lean:1-4; PEERS.md:67-68.
(6) `Node.Net` — Node.lean:116-120. (7) The wire frame — Wire.lean:48. (8) avenOS's Network screen —
os/web/Network.svelte:2-6. *Glossary:* (1)-(4) (GLOSSARY.md:44-45, 372).

**claim.** (1) The network's claim — Claim.lean:5-12; id/core/src/network.rs:1-6; Wire.lean:37; os/web/Network.svelte:3,
59. (2) A ticket's claim — Network.lean:166-168; PEERS.md:45, 183. (3) A claimed file type — GLOSSARY.md:306-307;
os/web/public/files-sw.js:16, 22. (4) Time is a claim — ARCHITECTURE.md:130; Rules.lean:418. (5) `replaces` is a claim
— id/caps/README.md:336. *Glossary:* (1) → genesis, (2) kept, (3) ⚠.

**member.** (1) In the network's group — GLOSSARY.md:34-35; ARCHITECTURE.md:625-629. (2) A group's readers —
ARCHITECTURE.md:83; id/caps/README.md:96-97. (3) A member of the admin coop — README.md:122-123; Before.lean:6. (4) Lean
member vaults incl. the coop and agent — Network.lean:496-502. (5) `member_of` — GLOSSARY.md:374.

**fit.** (1) Schema fit — GLOSSARY.md:141; Rules.lean:118-123. (2) `Node.Fits` — Node.lean:43; Rules.lean:82-87. (3)
Chat `fits` — db/core/src/chain.rs:372, 459. (4) Output fits its schema — runtimes/README.md:61.

**address.** (1) `<doc>/<id>` — GLOSSARY.md:166; ARCHITECTURE.md:79-80. (2) `<scope>/<id>/<n>` —
actor/ARCHITECTURE.md:69, 117, 232; Basic.lean:14-17 (GLOSSARY.md:253 still says `<home>/<id>`). (3) An address record
— PEERS.md:42, 102-104; Records.lean:8, 32. (4) An IP address — README.md:170.

**node / tree.** *node:* (1) avenPEER's node — README.md:67-68; PEERS.md:316; Node.lean:5. (2) A node tree —
runtimes/README.md:94, 149; runtimes/tree/src/lib.rs:1-5; brain/render/tree.js:1-3. (3) A search-tree node —
Walk.lean:5-6. *tree:* (1) avenID's tree — GLOSSARY.md:21; PEERS.md:175. (2) A node tree — os/web/docs/brain.js:46
beside os/web/apps/ControlRoom.svelte:18 (`tree.chain`). (3) The key tree — id/caps/README.md:638-641. (4) A search tree
— ARCHITECTURE.md:415, 722-723. (5) Loro's and bao's trees — GLOSSARY.md:21, 103.

**standing.** (1) A standing cap, grant or delegation — GLOSSARY.md:77-78; ARCHITECTURE.md:686, 705-707;
Messaging.lean:14-20. (2) A claim that stands — Network.lean:197, 488-495; PEERS.md:199, 204.

**layer.** (1) The architecture's stack — ARCHITECTURE.md:42, 764; db/engine/README.md:141; Authorized.lean:9. (2)
Caps' key layers — id/caps/README.md:589-600; ARCHITECTURE.md:238, 521. (3) avenACTOR's layers 0-7 —
actor/ARCHITECTURE.md:27-40. (4) A slide's layer — GLOSSARY.md:343; STYLE.md:42. (5) "The gismu layer" —
ARCHITECTURE.md:508.

**path.** (1) A lens path — ARCHITECTURE.md:617, 778; GLOSSARY.md:282-283; actor/ARCHITECTURE.md:262, 285. (2) An
authority path — Authorized.lean:38-39, 164. (3) A network path — README.md:164, 170-171; PEERS.md:27, 37, 409. (4) A
store path — GLOSSARY.md:92; store/src/opfs_folder.rs:137. (5) JSON path updates — ARCHITECTURE.md:206;
actor/ARCHITECTURE.md:189. (6) A node path — brain/render/tree.js:47-51. (7) The trusted path — ARCHITECTURE.md:662.
(The slides' "dotted ochre path" token of 17880922 is gone at the anchor.) *Glossary:* none.

**part / package.** (1) Actors' part — GLOSSARY.md:234. (2) A part of the system — ARCHITECTURE.md:47-49, 63;
GLOSSARY.md:3-4, 348. (3) A want's part (→ depth) — db/engine/README.md:86, 274. (4) A slide's parts —
brain/README.md:18, 39. (5) `part` = a docs package — Docs.svelte:20. "Part" (ARCHITECTURE.md:49-59) and "package"
(brain/docs.json:3; README.md:4, 53) name the top-level components with different lists.

**view.** (1) Engine view — GLOSSARY.md:192. (2) An app's schema and lenses — GLOSSARY.md:140. (3) Actors' view →
markup — GLOSSARY.md:267; runtimes/README.md:56. (4) A settled view — Network.lean:419-434; PEERS.md:199-200. (5) The
change view — Docs/Changes.lean:6; db/docs/README.md:877. (6) The Peer-Light's views — peer/light/src/views.rs:1-2. (7)
A kind's view — db/engine/README.md:448.

**scope.** (1) Query scope — GLOSSARY.md:190; ARCHITECTURE.md:201, 620. (2) Actor address scope —
actor/ARCHITECTURE.md:69, 237; Basic.lean:14-17. (3) A face's CSS scope — GLOSSARY.md:270. (4) npm scope — README.md:147.

**proof.** (1) Fetch/upload/key proofs — ARCHITECTURE.md:114; Keep.lean:410; id/caps/README.md:197, 579. (2) Lean
proofs — ARCHITECTURE.md:141, 784; db/docs/README.md:912. (3) Caps' "Proof" — id/caps/README.md:259; 194, 921. (4) A
split's proof — db/docs/README.md:486-488; PEERS.md:236. (5) A Merkle proof — ARCHITECTURE.md:406. One paragraph has
two: ARCHITECTURE.md:731 and :734.

**grant.** (1) A cap — ARCHITECTURE.md:84; id/caps/README.md:101. (2) `Aven.ID.Grant` — Caps.lean:9, 45. (3)
`Core.Grant` — Target.lean:139-144. (4) `CapKind.grant` — Caps.lean:220-224. (5) A standing grant — ARCHITECTURE.md:707.

**own.** (1) The `own` condition — Caps.lean:177; id/caps/README.md:386. (2) `Own` authority — Authorized.lean:16-18,
119; Signing.lean:9, 40. (3) A device's own log — Node.lean:49.

**live.** (1) Not revoked — Authorized.lean:300; id/caps/README.md:549. (2) A branch's live state — Counts.lean:53. (3)
The status phase — README.md:41. (4) Live envelopes — GLOSSARY.md:201. (5) Live answers — GLOSSARY.md:192. (6) Live
delivery — GLOSSARY.md:285. (7) A live package — brain/docs.json:2; STYLE.md:20.

**walk.** (1) Engine walk — GLOSSARY.md:178. (2) Sealed-index walk — Walk.lean:37-46. (3) `Keep.walk` — Keep.lean:271.

**depth.** (1) Want depth — ARCHITECTURE.md:89, 312-313; Wants.lean:26, 43. (2) Share depth — id/caps/README.md:149,
350; Caps.lean:347. (3) Epoch depth — Keep.lean:19-20, 279; id/caps/README.md:760. (4) Node-tree depth —
runtimes/README.md:87. (5) Placement depth — actor/ARCHITECTURE.md:655.

**runtime / safe runtime.** (1) A pure function named by its hash — ARCHITECTURE.md:90. (2) The safe runtime —
ARCHITECTURE.md:132; id/caps/README.md:129, 962, 987; Safe.lean:7. Both in the glossary (GLOSSARY.md:81-82, 235), no ⚠.

**frame.** (1) Wire frames — Wire.lean:6; GLOSSARY.md:115. (2) A slide's frame — STYLE.md:37; brain/README.md:35. (3)
The `frame` show mode — GLOSSARY.md:308-309. (4) The forbidden `frame` tag — brain/render/tree.js:14.

**catalogue.** (1) Engine catalogue = vocabulary — GLOSSARY.md:180-181, 396; db/engine/README.md:94, 245-256. (2)
avenBRAIN's catalogue — brain/docs.json:2; brain/README.md:14; brain.js:1, 4.

**order / withdraw / delete.** *order:* (1) Causal order — ARCHITECTURE.md:130. (2) A keeper order — Keep.lean:569;
id/caps/README.md:784. (3) The engine's sort — db/engine/README.md (`order`, ARCHITECTURE.md:494). *withdraw:* (1)
A ticket's withdrawal — Network.lean:165; GLOSSARY.md:32. (2) Withdrawing a keep cap — Keep.lean:570, 603. (3)
Withdrawing a want — db/engine/README.md:279. (4) Withdrawing a type listing — ARCHITECTURE.md:613. *delete:* (1) A
delete order to a keeper — Keep.lean:571, 606. (2) The chat's delete (a retraction) — ARCHITECTURE.md:754;
peer/light/src/lib.rs:358. (3) A delete as a Record in the Doc — id/caps/README.md:791-792. Engine's verb is `remove`.

**Gate / gate / Door.** (1) A per-engine time limit — runtimes/README.md:397-400; ARCHITECTURE.md:450. (2) Code `Gate`
— peer/native/src/members.rs:34. (3) A show-mode gate — runtimes/spec/Aven/Runtime/Registry.lean:347. (4) A human gate
— id/caps/README.md:268. (5) Code `Door` — peer/native/src/door.rs:43. (6) The door — GLOSSARY.md:37, 210.

**statement.** (1) A tree statement — Network.lean:177-185; PEERS.md:175-187. (2) A signed assertion: "a checkpoint: a
sealed, hybrid-signed statement" — db/docs/README.md:158-159, 810-811.

**genesis.** (1) A Doc's genesis — GLOSSARY.md:142; ARCHITECTURE.md:77; db/docs/README.md:151. (2) The network's
genesis — GLOSSARY.md:27-28; Network.lean:140-152; PEERS.md:180-182.

**admin.** (1) The admin coop — README.md:107-108; GLOSSARY.md:36. (2) Lean `admin`, keys incl. devices —
Network.lean:451-458. (3) Admin passkey — Network.lean:460-462; PEERS.md:73-76. (4) Admin device — PEERS.md:198.

**writer.** (1) A log's author — GLOSSARY.md:259, 367; db/docs/README.md:149. (2) The one writer (→ committer) —
README.md:30, 131; db/engine/README.md:98, 323. (3) The `writer` field and function — Log.lean:26; Writers.lean:29-32.
README.md:30 (rule 1, "One writer per device") and ARCHITECTURE.md:106 (rule 3, "One writer per log") use (2) and (1).

**room.** (1) The city-dome — GLOSSARY.md:329. (2) The gossip room — PEERS.md:42, 105; chat.rs:1.

**message.** (1) Actor message — GLOSSARY.md:260. (2) The gossip chat `Message` — Chat.lean:4-8; chat.rs:41.

**group.** (1) Caps' group — ARCHITECTURE.md:83. (2) The engine's `group` operator — db/engine/README.md:403. (3) A bao
group — GLOSSARY.md:103. (4) "A group of people" (a coop) on the vault slide — brain/id/slides/vault.md:6.

**labels.** "D6" is caps' roles pinned (id/caps/README.md:19), the engine's one evaluator (db/engine/README.md:22-23)
and, in GLOSSARY.md:155 and ARCHITECTURE.md:168, docs' fork decision, which db/docs/README.md numbers 14 (:827; its 6
is writer ids, :814; GLOSSARY.md:151 says named versions are D10, the README's 16 at :831). "D1"-"D5" are caps
decisions (id/caps/README.md:17-21) and PEERS Thread D tasks: Keep.lean:630, 667, 696 tag theorems "(D1)", "(D2)",
"(D3)" next to caps' "(D14)"; Forget.lean:3, 21; PEERS.md:154, 158. "Rule 13" is README's latest versions (:56),
ARCHITECTURE's keys in the safe (:132) and docs' counts (Authorized.lean:56).

### Low

- **Reaches / reaches** in four namespaces: Log.lean:111-112; CatchUp.lean:32; Node.lean:131; Caps.lean:64.
- **Before**: Past.lean:29; module `Aven.ID.Before` (Before.lean:4); `FetchLink.before` (Keep.lean:137); `before:`
  fields (db/docs/README.md:693, 777).
- **fresh**: Past.lean:38, Network.lean:270 vs `fresh` epoch (Authorized.lean:300).
- **Facts / fact**: `Core.Facts` (Target.lean:20-24) vs ontology facts (GLOSSARY.md:167, 215).
- **bound**: GLOSSARY.md:191 vs the outer bound (ARCHITECTURE.md:686) vs `kernelAttenuate`'s `bound` (Messaging.lean:43).
- **holder**: Caps.lean:203; GLOSSARY.md:105; Node.lean:120.
- **final**: ARCHITECTURE.md:73 vs Network.lean:477 (a final claim can still be contested; PEERS.md:251-252).
- **counted / counts**: Network.lean:412 vs GLOSSARY.md:158.
- **verdict**: three (Counts.lean:3-6), five (Authorized.lean:300), seven conditions (ARCHITECTURE.md:144-146).
- **target**: ARCHITECTURE.md:86 vs a merge's target branch (db/docs/README.md:164; Merge.lean:9, 19) vs avenOS's
  targets (README.md:66) vs performance targets (ARCHITECTURE.md:475).
- **slot**: GLOSSARY.md:179 vs bound slots (db/engine/README.md:118) vs component slots (actor/ARCHITECTURE.md:251) vs
  the `slot` tag (brain/render/tree.js:11).
- **run**: GLOSSARY.md:77 vs "a run of a log" (ARCHITECTURE.md:72, 78) vs `run(part, input)` (:90).
- **branch**: ARCHITECTURE.md:78 vs a fetch-key branch (Keep.lean:59-63; id/caps/README.md:801-805) vs git.
- **lane**: db/engine/README.md:256 vs PEERS.md:408.
- **epoch**: key epoch vs the Unix epoch (peer/native/src/record.rs:14).
- **state**: ARCHITECTURE.md:75-77 vs actor state and interaction states (GLOSSARY.md:250-251, 265, 375).
- **ticket**: GLOSSARY.md:59 vs iroh-tickets "for invites" (README.md:226).
- **directory**: GLOSSARY.md:204 vs a filesystem directory (store/src/opfs_folder.rs:137).
- **checkpoint / snapshot**: README.md:177-179 (snapshots travel); ARCHITECTURE.md:677 ("Loro snapshots are its
  checkpoints"); the `avenDB snapshot 1` subkey seals checkpoints (GLOSSARY.md:72); peer/light/src/views.rs:1.
- **peer**: `PeerId` = an index in the cast (Presence.lean:14-15); `hello (peer)` (Wire.lean:31).
- **steps**: Core `Step` (Target.lean:133) vs `RestoreDoor.steps` (RestoreDoor.lean:42).
- **Signed**: `Aven.Core.Signed` (a module) vs `Aven.ID.Signed` (an order and its signer, Keep.lean:575).
- **counter, phase, tag, Vault (the app), turn**: see the glossary's own entries (GLOSSARY.md:39, 145, 196, 265, 63);
  not ⚠-marked.
- **generation, slide, story**: one sense each in scope.

### One thing, two names (new since the glossary)

| Names | What | Where |
|---|---|---|
| wire `Head` / `heads`; signed log tip (`Tip`, `.logTip`) | A device's newest post | Wire.lean:17-21; CatchUp.lean:22-26; Records.lean:34 |
| part; package; product | A top-level component | ARCHITECTURE.md:47; brain/docs.json:3; README.md:63 |
| Doc; document | The mutable-data primitive | db/engine/README.md:3-7; README.md:71 |
| claim of a ticket; join | Founding a vault with a ticket | Network.lean:166; ARCHITECTURE.md:641 ("a join is final once …") vs PEERS.md:47 ("a claim is final once …") |
| ack (tree); confirm (avenOS) | An admin device finalising a claim | Network.lean:170; PEERS.md:256 |
| withdrawal; withdraw | Ending a ticket | Network.lean:165; Wire.lean:43 |
| delete; retraction; remove | Taking data away | Keep.lean:571; db/core/src/chain/retract.rs; Target.lean:115 |
| `Gate`; the door | The admitted key set | members.rs:34; GLOSSARY.md:37 |
| record (slide); card (STYLE) | A drawn vault or cap | slide.css:88; STYLE.md:28 |

---

## (c) Verdicts not applied

Matching lines per file at `f5a6fd3d`. "Applied in" lists where the new name is used.

| Verdict | Old name still used (file: lines) | Applied in | Deferred? |
|---|---|---|---|
| **statement = envelope** (GLOSSARY.md:25, 389) | Lean: Network.lean 84, SettleJson.lean 42, Wire.lean 31, RestoreDoor.lean 28, Admit.lean 27, Restore.lean 26, Sign.lean 20, Claim.lean 12, FailJson.lean 12 (316 in all). Specs: PEERS.md 38, id/caps/README.md 13, ARCHITECTURE.md 12. Code: peer/native/src/door.rs 36, link.rs 26, tests/door.rs 26, peer/light/src/lib.rs 25, os/web/invites.js 15, id/core/src/sign.rs 13 (247 in all) | nowhere; `TreeStatement` is not Core's `Envelope` | implicitly, until the tree is a Doc (A12) |
| **line (chat) = envelope, then `post`** (GLOSSARY.md:111, 202) | Lean: Chains.lean 243, db/spec/Vectors.lean 31, ChainsBytes.lean 30, Wire.lean 24, Chat.lean 15. Code: chats.rs 140, chain.rs 78, chain/retract.rs 61, tests/room.rs 49, tests/chains.rs 46, Chat.svelte 45, room.svelte.js 38, peer/light/src/lib.rs 38 (about 12 are timeline lines). Specs: db/docs/README.md:770-787, db/engine/README.md:357-361, id/caps/README.md:476, 1342, 1350 | PEERS.md:118-128 and CatchUp.lean say "posts"; PEERS.md:120 still names the `lines` frame | **yes, "from milestone 4"** (GLOSSARY.md:111); docs decision 19 keeps today's chains (db/docs/README.md:835) |
| **line → nobody** | `Line`: Caps.lean 20, CapsJson.lean 9, Placement.lean 8, CapsExamples.lean 6, Hosting.lean 6, CapsCbor.lean 4; id/caps/README.md:1218-1236 | `branches` (Caps.lean:110) | no |
| **chain (chat) → log** (GLOSSARY.md:112) | Lean: Chains.lean 139, db/spec/Vectors.lean 27, Wire.lean 20. Code: chats.rs 62, chain.rs 30, retract.rs 18, wire.rs 10, room.rs 10, tests 31 | PEERS.md:62, 159 ("the chat's logs") | frozen format, not stated in the glossary |
| **chain (avenID) → the owners above** (GLOSSARY.md:22) | Query.lean:41; Ask.lean:17, 74, 85; Cast.lean:48-50; Correct.lean:6, 78-80; Governs.lean:17; id/core/src/query.rs:45; tests/common/mod.rs:75; tests/model.rs:199; peer/light/src/views.rs:30; os/web/id.svelte.js:37; ControlRoom.svelte:18, 53; Vault.svelte:13 | UI locals already `above` (ControlRoom.svelte:18; Vault.svelte:13) | no |
| **fork → split** (GLOSSARY.md:114; A4) | Chains.lean 81, db/spec/Vectors.lean 8; chain.rs 10, retract.rs 7, chats.rs 7, tests 13 | Core `Split` (Log.lean:102) | frozen chat format |
| **`Gate` → `Door`** (GLOSSARY.md:120-121) | `Gate`: members.rs 5, link.rs 5, room.rs 4, chats.rs 3, relay.rs 2, main.rs 2, blobs.rs 2, peer/light/src/lib.rs 2, tests 24 (49) | nowhere; `Door` already exists (door.rs:43) | no |
| **`Keeper` → `Logs`** (GLOSSARY.md:109) | Chains.lean 82; chain.rs 7, chats.rs 6, retract.rs 4, tests/chains.rs 4; `Logs`: 0 | — | no |
| **network → members group; `Network` → `Genesis`; the field → the genesis hash** (GLOSSARY.md:44-45) | Rust `Network`: network.rs 15, members.rs 10, statements.rs 2, lib.rs 2, door.rs 3, link.rs 1, tests 8 (41); Rust `Genesis`: 0. Field `"network":"aven"`: invite.rs:9-11, 71-189; Claim.lean:9-10; chat.rs:11; Chains.lean:9. Wire frame: Wire.lean:48 | Lean `Genesis` (Network.lean:140) | stored texts keep it (Claim.lean:9-10; PEERS.md:333-334) |
| **claim (network) → genesis** (GLOSSARY.md:26) | Claim.lean 79, ClaimTrace.lean 64, ClaimJson.lean 12, Wire.lean:37; network.rs 66, door.rs 29, os/web/network.svelte.js 17, Network.svelte 16, claim.rs 11 (some lines are sign-ins). The `claim` ref stays for the deploy (door.rs:5-6) | PEERS, Network.lean | the genesis names the old claim's hash (PEERS.md:266-268) |
| **peer (Loro) → writer id** | definitions only: db/docs/README.md:73, 87, 147; Writers.lean:6, 27, 47 | applied | — |
| **epoch (device) → generation** | none | applied (db/docs/README.md:170, 379, 824; Writers.lean:8) | — |
| **kind only for vaults** (GLOSSARY.md:221, 364) | Lean: Records.lean 29, Caps.lean 23, Chat.lean 17, Asks.lean 13, Engine/Changes.lean 6, Deadlines.lean 6, Kernel.lean 5, CapsJson.lean 5, CapsExamples.lean 5, Basic.lean 4, Messaging.lean 4, Docs/Changes.lean 3. Code: chat.rs 14, Chat.svelte 14, room.rs 7. Specs: id/caps/README.md:308; actor/ARCHITECTURE.md:105-116; PEERS.md:183; db/engine/README.md:20, 412, 445-448. avenBRAIN: slide.css:88, `record-kind` in owns.html:17, cap.html:4 | docs dropped its `kind` field (db/docs/README.md:184) | no |
| **operation (caps) → verb** (GLOSSARY.md:51-52) | id/caps/README.md (about 15 of its 38 matching lines; :4, 101, 106, 148, 152-153, 247, 258, 309, 340-347) with `write`, `mutate`; Caps.lean:6; README.md:121; brain/id/slides/cap.md:3 | ARCHITECTURE.md:85; Core `Verb` | no |
| **envelope (operation's) → call** (GLOSSARY.md:173) | db/engine/README.md:8, 223 | docs' `"call"` (db/docs/README.md:318, 331) | no |
| **sealed (closed) → closed** (GLOSSARY.md:195) | ARCHITECTURE.md:234, 470, 475; README.md:180 | db/docs/README.md:184 | no |
| **part → depth** (GLOSSARY.md:182, 234) | db/engine/README.md:86, 264, 274, 291-293, 301 | ARCHITECTURE.md:89, 312; Wants.lean:26 | no |
| **catalogue = vocabulary** (GLOSSARY.md:180-181) | db/engine/README.md:94, 245-256, 448, 538; reused by brain/docs.json:2, brain/README.md:14, brain.js:1, 4 | db/docs/README.md:180 | no |
| **lane → vocabulary; lane (box) → topology** (GLOSSARY.md:139, 331) | db/engine/README.md:256; PEERS.md:383, 408, 432 (`bun run lanes`, `sandbox/lanes.mjs`) | docs | no |
| **the one writer → the committer** (GLOSSARY.md:198-199) | README.md:30, 68, 82, 131; db/engine/README.md:7, 98, 158, 213, 323, 327; PEERS.md:325 | db/docs/README.md (6 lines); db/engine/README.md:147; ARCHITECTURE.md:186 | no |
| **file index → chunk list** (GLOSSARY.md:100) | Files.lean:7-8, 216-220; db/engine/README.md:79; Wire.lean:60; PEERS.md:163; keep.rs:6-8, 31, 57, 145, 178, 213; hub.rs:95; peer/light/src/lib.rs:394 | ARCHITECTURE.md:748; PEERS.md:146 | the ref name is stored |
| **manifest = loads; retires** (GLOSSARY.md:186) | db/engine/README.md:92, 115 | — | no |
| **room → city-dome** (GLOSSARY.md:329) | PEERS.md:42, 105; chat.rs:1; room.rs; room.svelte.js | — | no |
| **record (peer status) → status** (GLOSSARY.md:332) | peer/native/src/record.rs:1-3, 13; README.md:13, 41 | — | no |
| **record (log entry) → entry** (GLOSSARY.md:258) | actor/ARCHITECTURE.md:37, 89-90 | — | no |
| **live message → live envelope** (GLOSSARY.md:201) | Chat.lean `Message`; chat.rs:41 | — | gossip chat until milestone 4 |
| **invite = ticket; join = claiming a ticket** (GLOSSARY.md:31-33, 398) | "ticket" in 0 code lines, "invite" in 255; wire `invite`, `join`, `withdraw` (Wire.lean:41-45); passkey slide's "joins her vault" (passkey.md:7) | Network.lean; PEERS | no |
| **plugin = runtime** (A18; GLOSSARY.md:169) | db/engine/README.md throughout; runtimes/README.md:9-11 still "proposes" | ARCHITECTURE.md:90 | no |
| **guardian vaults → recovery owners** (GLOSSARY.md:40-41) | README.md:200-201 | caps README | no |
| **travelling snapshot → checkpoint** (A5) | README.md:177-179 | docs, ARCHITECTURE | no |
| **space → city-dome; room secret retires** (GLOSSARY.md:126-127, 404) | README.md:185-188 | — | no |
| **learned head retires** (GLOSSARY.md:117) | Chains.lean:34-36, 484-506; peer/light/src/lib.rs (7 lines) | — | frozen chat |

Deferred by the glossary itself: file announcements and chat lines become Records "from milestone 4"
(GLOSSARY.md:101-102, 111); the learned head and the room secret "retire" (:117, :126-127); gossip topics per group
with K11 (:327); A17's address and inbox changes (:253-256). The specs add: today's chat chains are read as they are
(db/docs/README.md:835), stored formats are read forever (PEERS.md:333-334), and the `claim` ref stays for the deploy
(peer/native/src/door.rs:5-6). No other verdict in the table says when or whether it applies.

---

## (d) Contradictions between the glossary and the specs

1. **settle.** GLOSSARY.md:157: "settle: retires (A4: splits are final)". PEERS §5 is "The settle rule"
   (PEERS.md:190-192); `settle` is the tree's function (Network.lean:638) with `settle_*` theorems (PEERS.md:217-227;
   id/caps/README.md:1275-1278) and now `settle_restore_door` (RestoreDoor.lean:419); caps says the tree is one "that one
   rule settles" (id/caps/README.md:35); A22's grind is "how a ground fork settles" (:797); docs' merge "settles them
   three-way" (db/docs/README.md:164).

2. **record.** ARCHITECTURE.md:190: "record" only as **Record**. PEERS §6 "Signed records, not a peer's word"
   (PEERS.md:290) and `Aven.ID.Records` define five signed record kinds; avenBRAIN draws vaults and caps as `.record`
   cards with a `record-kind` (slide.css:88; owns.html:15-17; cap.html:2-4).

3. **sealed.** ARCHITECTURE.md:178 and GLOSSARY.md:362: "sealed" only for encryption. The slides define "a seal: a
   signature" (slide.css:203) and caption one "a seal under them: signed by Alice's key" (sign.html:1). ARCHITECTURE
   itself still says a writer "seals" a segment (:234) and speaks of "30-second sealing" (:475).

4. **line.** GLOSSARY.md:352: "line | nobody". Caps' model: "A grant is a list of lines" (Caps.lean:9, 39); the caps
   spec: "A **line** of a grant is …" (id/caps/README.md:1218); Placement: "its lines `keep` targets"
   (Placement.lean:6). Added 2.5 h after the glossary row (`e8fa1f3e` 30 Oct 21:28 vs `ce17da33` 18:51).

5. **fork.** A4 (ARCHITECTURE.md:603-604) and GLOSSARY.md:155-156: fork is only a copy. ARCHITECTURE's own A22: a
   keeper "flags a fork", "a fork ground by a removed reader" (:251, 730-736); caps (id/caps/README.md:648, 766,
   797-805); `Keep.fork_flagged` (Keep.lean:396).

6. **chain.** GLOSSARY.md:56: "The only 'chain'". Core's `IsChain`, "a log read as a chain" (Log.lean:14, 157), used by
   Rules.lean:63-64 and Node.lean:63; fetch keys "chain" (ARCHITECTURE.md:225, 251; id/caps/README.md:34, 759); A6 and
   docs decision 18, "chains of period Docs" (ARCHITECTURE.md:611; db/docs/README.md:834).

7. **kind.** GLOSSARY.md:221: "'kind' stays only for vaults". A cap's JSON has a `kind` field (id/caps/README.md:308);
   `CapKind` (31 Oct), `RecordKind` and `ChangeKind` (30 Oct evening) are new; the slides have `record-kind`.

8. **ack.** GLOSSARY.md:377 gives "ack" to caps and calls actors' a delivery mark. PEERS decision 5 and §5
   (PEERS.md:47, 198-204), A12 (ARCHITECTURE.md:641) and Network.lean:170 make the tree's ack a statement kind with its
   own policy (Admit.lean:34). The glossary never mentions it.

9. **verbs.** GLOSSARY.md:51 and ARCHITECTURE.md:85: `read, query, put, patch, remove, edit, tell, keep, share`, as
   Core's `Verb` (Target.lean:114-115). Caps' own Terms: "operation: what a cap allows: `read`, `query`, `write`,
   `mutate`, `tell`, `keep`, `share`" (id/caps/README.md:106), its table lists `write` and `mutate` (:342-350), its
   decisions D4/D5 say "caps grant the engine's operations" (:19), and avenID's new cap slide says "which operations"
   (brain/id/slides/cap.md:3).

10. **split.** ARCHITECTURE.md:73: "Final: neither side counts". Records.lean:23-24: two records with one counter are
    "a split (A4), and the smaller body is taken everywhere".

11. **verdicts.** GLOSSARY.md:158: three (fit, authorized, not split). `Reader.Verdict`: signed, fresh, authorized, live,
    fit, plus not split (Authorized.lean:300-312); rule 4 lists seven conditions (ARCHITECTURE.md:144-146);
    Counts.lean:3 still says "three verdicts".

12. **actor address.** GLOSSARY.md:253: `<home>/<id>`. actor/ARCHITECTURE.md:69, 232-237 and Basic.lean:14-17:
    `<scope>/<id>/<n>`; `<home>` appears nowhere else.

13. **admin.** GLOSSARY.md:36: "the coop that owns the agent; a passkey owning a vault that governs the coop".
    Network.lean:451-458: `admin` is a key (the claimant's passkey, its first devices, or a device it signed in);
    `adminPasskey` (:460-462) is the passkey; PEERS decision 12 separates "admin passkey" and "admin device"
    (PEERS.md:73-76). (A28, after the anchor, moves the spec back toward the glossary; see the end.)

14. **member.** GLOSSARY.md:34: "a person's vault let in by invite". Network.lean:496-502: the claimant's vault, the
    admin coop, the agent and every vault a standing claim founds; README.md:122: "a member of the admin coop".

15. **`Gate` → `Door`** (GLOSSARY.md:120-121) cannot be applied as written: `pub struct Door` exists for the Aven
    Peer's claim and invite handling (peer/native/src/door.rs:43), used beside `Gate` in relay.rs:17-24.

16. **presence.** GLOSSARY.md:328: "presence (`here`, `bye`): who is connected". PEERS §2 replaces it with signed beats
    (PEERS.md:111-113) and `CatchUp.present` (CatchUp.lean:85), while the wire's `presence` frame and the hub's
    `Aven.DB.Presence` remain.

17. **join.** GLOSSARY.md:33: "join: an invited browser founds a person's vault". avenID's passkey slide: on a new
    browser "she signs in with the passkey, and the browser joins her vault" (brain/id/slides/passkey.md:7), a sign-in
    (GLOSSARY.md:29).

18. **head.** ARCHITECTURE.md:175 and README.md:119: the head is the ref. db/docs/README.md:156: "a small Value kept
    under the Doc's ref".

19. **genesis.** GLOSSARY.md:142 and ARCHITECTURE.md:77: an envelope. db/docs/README.md:151: "a Doc's first signed
    Value".

20. **catalogue.** GLOSSARY.md:180-181, 396 retire it into "vocabulary"; avenBRAIN names `docs.json` "the catalogue"
    (brain/docs.json:2; brain/README.md:14).

21. **v1.** GLOSSARY.md:321 and README.md:85: "v1" is the old stack. Chains.lean:11, chain.rs:3 and store/README.md:103
    use it for the new avenDB before sealing.

22. **Verdicts that create new collisions.** depth (→ share depth, epoch depth; id/caps/README.md:149, 350;
    Keep.lean:19-20), call (an ask "is a call", actor/ARCHITECTURE.md:155-156; voice calls, id/caps/README.md:695), entry
    (registry, manifest, index and pack entries), Door (#15), type (also a file's media type, GLOSSARY.md:101, 304-305).

23. **The glossary's own "part".** "Which part keeps each word" (GLOSSARY.md:348) and "one package's part of the wiki"
    (:339) use "part" for a system component, which its own table gives to actors only (:358).

Unsure: whether PEERS.md:62 and :159 ("Every native Peer also keeps the chat's logs it hears") contradict the keeper
primitive ("under a keep cap", ARCHITECTURE.md:94) or use an informal "keeps". It reads as keeping without a keep cap;
flagged, not counted.

---

## After the anchor (not audited line by line)

`f5a6fd3d..201cbe5e` added: ARCHITECTURE rule 15 and **A28** "Vaults own; signers only sign" (the network tree's admin
becomes Maia City's vault, not the claimant's passkey; release keys and the guardian become vaults' signers), **A29**
"Frames in CBOR" (the wire leaves JSON lines; actors' "frames as JSON lines" replaced), a delete's reader half in
`Revoke.lean` wired into rule 4, "only a write line allows a step" in Caps.lean, and Core's 512-deep nesting limit.
Effects on this report: A28 resolves contradiction 13 toward the glossary and makes Network.lean's `admin` /
`adminPasskey` a listed fix; A29 retires the JSON-line sense of "line" and changes "frame" (still a wire frame); "write
line" extends the caps `Line` usage of item 4.
