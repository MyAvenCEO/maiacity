# Goal 10: one index primitive, on the shelf, portable (planned 2026-10-29 16:11-16:20 Berlin)

**NOT STARTED (Samuel 16:18 Berlin: "goal 10 don't start yet, just scope it for now").** Starts after Goal 9 ships and its final roundtrip (row 30) passes. One sentence: everything derived in avenDB is one ShelfIndex stamped by the one log head; an actor's query indexes (per cap group) travel between peers, so opening an app never waits on catching up logs.

**Metric (4-min live test):** Chat cold < 2 s while 3,000 behind; #Bla both ways < 2 s (1 s long-term); phone unlock <= 5 s; resident memory < 100 MB.

## The one list
State: open, working, done (collected @sha).

| # | Task | Source | State |
|---|---|---|---|
| **A. One index primitive (lane 1: spec + key index first)** ||||
| 1 | Lean: ONE Index module (derive, stamp, tail catch-up QV2, honest open QV3). KeyTree/KeyDerivation, StoredView/ShownView/StandingReplay/LatestReplay/StandingKeep, CapGroupsOnce, ToldIndex, Coverage become instances; their theorems kept as lemmas | 16:18 | open |
| 2 | Key index onto ShelfIndex: no RAM rebuild at unlock (iPhone holds key_index 29 MB + keys 27 MB) | Samuel 16:16, key-index-gap | open |
| 3 | Log's own indexes (ids, by_log, entry_order, write_at, depths) as stamped shelf rows; an open steps only the tail (finish what Goal 9 row 17 started) | Goal 9 row 17 | open |
| 4 | Hand-rolled stamped slots (keys-*, shown-*, fresh, edit-ranges, contract) become ShelfIndex rows, as row 18 did for the view; the slot code paths deleted | 16:16 | open |
| 5 | Cap-group judgments and kept showings as shelf indexes | 16:18 | open |
| 6 | One clock: the Store.revision memos (Shared::news, writers_shown, Lab::index_lists_all) and query_view.rs's own Stamp are stamped by the log head, or deleted | 16:16 | open |
| 7 | Derivations sealed to AVENDB_ENGINE (handed views, entry_base signed bases, edit_summaries) bound to viewRules instead, so they survive releases | 16:16 | open |
| 8 | Status derived: behind, coverage, holdings, lacks and the sync pill computed from index stamps vs peer heads; their counters deleted | 16:18 | open |
| **B. Portable indexes (lane 2)** ||||
| 9 | Actor queries (Actor v3 interests) as per-cap-group ShelfIndexes owned by the vault: pointers + head stamp, never copies | Samuel 16:11-16:15 | open |
| 10 | Wire: ask an actor's index pages by selector + stamp before any log page; the always-on peer keeps them current; content pages sealed to the cap group's key | 16:17 | open |
| 11 | "Judge views" share: which devices may write a vault's index answers (owners' devices; the peer only where it may read) | 16:12 | open |
| 12 | Verify handed pages by QV2 catch-up as edits arrive; a mismatch drops the page, flags the judge, falls back to logs | 16:17 | open |
| 13 | Client: an actor opens from its index pages, then fetches only the named entries; "behind" = named entries not held | 16:17 | open |
| **C. Carried from Goal 9** ||||
| 14 | Unlock: keys step still 1.8 s after rows 8's fixes; measure "Showing your pass" on the peer after db9e2c4d | Goal 9 row 8 | open |
| 15 | Relay-only transport: direct paths so a screen's KB never waits on the relay | 16:15 draft | open |
| 16 | Stored functions that should name ops: an entry-update AIP Samuel signs, if a vault holds any | Goal 9 row 29 | open |
| **D. CI audit refactor (parked, /mnt/project-files/goal8/ci-audit-handover.md)** ||||
| 17 | Stage 4: one sync wire, one index derivation, one entry state; test network out of the product (86k -> ~64k lines). Needs Samuel's call on the sync wire hard fork; overlaps A | handover | open, Samuel's call |
| 18 | Stage 5: the 62 avenDB page views, studio and site on one view kit (35k -> ~15k lines) | handover | open |
| 19 | Stage 6: asset version sources and the 11 places' code into the vault (each rebuilds its recipe to the same hash), one modeling kit, frozen engines by hash; Loro history byte for byte | handover | open |
| 20 | Stage 8: avenDB doc checked against the new layout, G7b memory measure, Samuel's device round | handover | open |
| 21 | Merge queue | handover | open, Samuel's call |
| 22 | The 174 s live chat test (last CI pole): faster without loosening it | handover | open |
| 23 | Check #1380 live: base job logs `last commit shipped`, ci skips jobs passed on the merged ref | handover | open |
| 24 | Net test live::mceliece_keys_go_over_iroh_blobs_only_within_reach red on release runs | handover | open |
| **E. More open ends** ||||
| 25 | Heads exchange at its root: a phone that holds a log gets its newest heads (asks by index stamp + heads), and live pushes carry their edits (new=0 today). Net-sim test from the real samples (log 002f97be lacks 7 heads) | iPhone reports 28-29 Oct | open |
| 26 | The pill tells the truth: last page received + its time, failed askings, and "stalled" only from derived status (with 8) | iPhone reports | open |
| 27 | Diagnostics report exports Index stats per instance (pages, stamp, RAM vs shelf), so each task is measured on real devices | 16:18 | open |
| 28 | Old branches: check each against main and land it or close it (7hcm0d, s-page-progress-vjjtfj, #1356 propose-actors fixes, cjujjd, gen7bn, nm0l8n, h62vdh, k1uwyu, s-one-offs, s8-pinned) | 16:18 | open |
| 29 | Actors v3 phone test (AIP-46 applied) folds into the metric | 16:18 | open |
| 30 | Mac auto-rebuild agent (watch-main LaunchAgent) not loaded; rebuild script now uses theos/app | Mac | open, Samuel's call |

| 31 | `collect.mjs --check` runs the targeted TESTS of every crate a merge touches (not only types), so cross-lane regressions show at collect time, not in the one final CI. Goal 9 lesson: shared index, stub counting and Log-by-place each passed their own lane but broke posts_page, stub_holdings and replay_rungs together | Goal 9 CI 16:20 Berlin | open |

## Background: Samuel's design Q&A (16:11-16:18 Berlin)

Samuel 16:11 Berlin: "wouldn't this all be solved with actual in-avenDB persisted shared Views, as the cleanest architectural first-principles pattern, instead of hacky patches? Now let's bump, but plan a new Goal 10 with this task."

Samuel 16:14 Berlin: "so isn't it then just the actor's manifest after all, whose interest definition is a cap-based avenDB-native query engine anyhow?" YES: no new view concept. Definition = the actor manifest's interest queries (cap-based, avenDB's own engine). A shared view = the kept answer of one such query, head-stamped, stored in the vault per cap group. Goal 10 = the engine persists and hands out manifest-query answers; a device opening an actor gets the answer first and verifies it as edits arrive.

## Tasks
| # | Item | Why | State |
|---|---|---|---|
| 1 | **Persisted shared views in avenDB.** A view is stored in avenDB, stamped with its log head and the rules number (viewRules). One device (normally the always-on peer) computes it once; other devices take it and check it against the head instead of replaying. A rules change costs one replay in total, not one per device, and needs no in-place upgrade step. Open design point: how a device cheaply checks a view it didn't compute (vouched by the head and the rules, a Lean proof that the stepped view equals the replay). Builds on [[unified-query-model]] (head-stamped stored views per query) and row 18's "view" ShelfIndex rows | Goal 9's viewRules 1→2 bump for the selector key (row 9) makes every device replay once; the per-device private view is the root cause | planned |

Also queued for Goal 10: the parked CI-audit refactor (stages 4-6 and 8), handover /mnt/project-files/goal8/ci-audit-handover.md.

Samuel 16:12 Berlin: "we do this at vault level, the vault owns the views right?" Yes: one view per VAULT (what that vault may read), stored in that vault, head + viewRules stamped, sealed to the vault's keys; all its devices share it; another vault keeps its own. The always-on peer stores and serves it but can't read sealed contents, so for private views one of the vault's own devices computes it. Supersedes D5 of [[unified-query-model]] ("views per device, hand only same-passkey").

## Draft plan "View-first: persisted, shared views" (16:15 Berlin)
Already in avenDB (aven/db/spec): HandedView.lean (same edits -> same view, so a view is checkable by another device), QueryView/StoredView/ShownView (head-stamped, caught up from the edits after it QV2, honest SV3), Interest.lean + Actor v3 (each app names its "now" needs). All per device today; views never leave it.
1. Lean first, SharedView.lean: a shared view = (selector or actor tier, head stamp, answer rows, judge's signature); valid iff replaying the stamped edits gives the same answer (HandedView). Rights: only rows the asker may read. Stale but honest: an older stamp is shown, marked, and caught up by QV2.
2. Storage: a view is an entry in its vault, keyed (selector hash, stamp), sealed to the vault's keys. The always-on peer keeps and serves it; OPEN: the peer can't read sealed rows, so a vault's own device judges/refreshes private views (the peer judges only views it may read).
3. Protocol: "ask view" + answer, before any log page.
4. Client: Actor v3's now tier opens from a handed view first, verifies and catches up underneath; "behind" counts only what the open view lacks.
5. Verify lazily as edits arrive; a mismatch drops the view, flags the judge, falls back to logs.
6. Metric (4-min live test): a cold phone 3,000 logs behind opens Chat with real rooms < 2 s, and #Bla goes both ways < 2 s, every run.
Removes: bulk catch-up gating views; heads/haves exchange as the only path (now background). Not fixed by it: relay-only transport (own task).

Refinement (16:16 Berlin): the view's DEFINITION is a vault entry (actor tier / query, changed via the vault's proposals/AIPs); its ANSWER (rows + head stamp, signed) is vault data written only by devices holding a "judge views" share (owners' devices; the always-on peer only under that share). One answer per CAP GROUP (Owners, Members, Public), not per device; a peer hands the answer for the asker's group. Syncs, backs up and is deleted with its vault.

## Goal 10 in one sentence (16:16 Berlin)
"An actor's now-tier answer is persisted per cap group and handed peer to peer, so opening an app never waits on catching up logs."
1. Lean: extend Interest + HandedView (no new module).
2. Keep each actor's now-answer per cap group fresh on every write (judged by a device holding the "judge views" share; the always-on peer only where it may read).
3. Client opens the actor from the handed answer, catches up underneath.
4. Metric: 4-min live test, Chat cold < 2 s while 3,000 behind; #Bla both ways < 2 s.

## It's an INDEX (Samuel 16:15 Berlin: "copy or cache, or just a clean index? each query/view is just an index?")
YES, an index, never a copy or cache. Each actor query = one ShelfIndex (per cap group): rows are pointers only (entry ids / log places in the query's order), stamped with the log head it is correct at, stepped per edit (delta, never recomputed), rebuildable from the log (never a trusted source). Handing = index rows + stamp (KB); the entries come as normal sealed data, and the receiver verifies the index against them. Same shape as row 18's "view" ShelfIndex. "Answer" above means these index rows.

## One primitive (Samuel 16:15 Berlin: "sharing the same primitive?")
YES: ShelfIndex is the single primitive for everything derived (shared, told, spill, stored view since Goal 9 row 18, and now each actor query per cap group). Sharing: structural indexes (heads, ids) shared openly; content indexes sealed to the cap group's key (a peer stores/passes, can't read); a handed index is a hint until it matches the log or carries a judge's signature over its root ([[index-design-gate]]).
Task 2 of Goal 10: move the device KeyIndex (still rebuilt in RAM at each unlock, [[key-index-gap]]) onto ShelfIndex, so nothing derived lives elsewhere.

## Final shape: "Indexes are vault data, handed between peers" (16:17 Berlin)
Spec base exists: QueryView.lean ("what a selector picks of the rows of a log is itself an index of that log", QV1 rows set per edit, QV2 catch up from the stamp, QV3 reopen honest slot or rebuild), HandedView (same edits, same index), query_window.rs (newest w off the shared index + tail after its stamp; device-own today).
1. Index pages travel: ask an actor's query-index pages by selector + stamp, before any log page; the always-on peer keeps them current.
2. Per cap group: an index lists only entries that group may read.
3. Verified as edits arrive: QV2's catch-up doubles as the check; a mismatching page is dropped.
4. Client: an app opens from its index pages, then fetches only the named entries; "behind" = named entries not held.
5. KeyIndex onto ShelfIndex (above).
6. Metric (4-min live test): Chat cold < 2 s while 3,000 behind; #Bla both ways < 2 s.

## SSOT consolidation (Samuel 16:16 Berlin: "device key index shouldn't be in memory either, same DRY primitive? further consolidation / SSOT potential?")
Rule: everything derived is a ShelfIndex stamped by the ONE log head; anything else is deleted. Disk engine is already one (avendb/src/pages.rs tree + Runs, avendb-net shelf_index.rs slot/stamp). Still beside it (quick code read 16:18):
1. KeyIndex: RAM, rebuilt each unlock.
2. query_view.rs QueryViews: per-device RAM LRU with its own Stamp (Store.revision, not log head) -> becomes the per-cap-group ShelfIndex.
3. Hand-rolled stamped slots: slots/keys-* (keys + checked head), shown-*, fresh, edit-ranges, contract -> ShelfIndex rows (as row 18 did for view).
4. Log's own indexes (ids, by_log, entry_order, write_at, depths): row 17 stage 2 starts; finish.
5. Store.revision-keyed memos (Shared::news, writers_shown, Lab::index_lists_all): a second clock -> log head.
6. AVENDB_ENGINE-sealed derivations (handed views, entry_base signed bases, edit_summaries) wiped each release -> bind to viewRules.

Spec side of the same consolidation (16:18 Berlin): ~6 "derived state at a stamp, caught up from the tail" mechanisms each have their own Lean spec: key index (KeyTree/KeyDerivation; iPhone report key_index 29 MB + keys 27 MB + edits 31 MB + log 66 MB in RAM), what stands (StoredView, ShownView, StandingReplay, LatestReplay, StandingKeep), cap-group judgments (CapGroupsOnce), told (ToldIndex), behind/lacks/holdings/coverage (Coverage, Sync: should be computed from stamps vs peer heads, no counters), query/actor views (QueryView, SharedIndex: already the primitive).
Framing "One index primitive, on the shelf, portable":
1. Spec: ONE Index module (derive, stamp, tail catch-up QV2, honest open QV3); the six specs become instances, theorems kept as lemmas.
2. Shelf, not RAM: key index, stored views, showings, cap judgments as content-addressed pages; memory holds only what the open view touches.
3. Portable: index pages handed per cap group (actor tiers), verified by catch-up.
4. Status derived: behind, coverage, the pill computed from stamps and heads, never counters.
5. Metric: phone unlock < 10 s (goal <= 5 s), resident memory < 100 MB, Chat cold < 2 s while 3,000 behind, #Bla both ways < 2 s.
Lanes: (1) Index spec + key index onto the shelf first; (2) views/showings + portable pages.

## F. Live roundtrip on the Goal 9 build: what is wrong today (2026-10-29 19:12-19:30 Berlin)

Build: main 31beada7 (Goal 9) on the always-on peer (85b01be4, up 18:02), theOS on the Mac (36ee6eef, built 19:19-19:22, opened 19:22:48, unlocked 19:23:10), the PWA on the iPhone (new device 559061e7, re-linked on 31beada7). Read from the peer's /feed/health, the Mac's os-20261029-192248.log and diagnostics reports (Mac 19:25:24, iPhone 19:18:07), and the page code. **Measured** unless marked *(guess)*.

What Samuel saw: Mac Assets stuck on "Reading Maia City's recipe entries…" with "This view · 120 logs left", "Logs left 114 of 3,107", both peers "pulling · 0 edits"; iPhone stuck on "Connecting", Peers "…", This view "checking"; yet assets load on the iPhone and not on the Mac, which holds everything locally. "The sync is still catastrophic", "all numbers still lie".

### F1. A rules bump replays everything on every device, the always-on peer included (root of the slow first 30 min)
- Peer at ~19:28: `replay {edits 157,696, latest:false}` 26 min after start; `stored view: none that opens: 1`, `replay whole: the first since it opened: 1`, `restore: left to its catch-up: 157,548`.
- Peer `keys: boxes` 100,548 calls, **1,332 s (22 min)** in total, max 192 ms; `keys: index grown` 100,521. Key boxes are re-derived per edit during the replay.
- Mac: `stored view: none that opens: 1`; whole replays: first since opened 1, back 1k at most 5, revocation or root handed on 2, new edit sorts before its place 3; `replay: begun` 4x (19.7 s, max 5.1 s), `replay: run` 28x (2.2 s).
- Cause (measured): viewRules 1 -> 2 (Goal 9 row 9, Samuel's choice) makes every stored view unopenable; each device and the peer rebuild alone, and the key index (RAM) is rebuilt with it.
- Lesson: a rules change must cost ONE replay in total, by one judge, and the result handed out (B 9-13); the key index must be stamped on the shelf so a replay doesn't re-derive 100k key boxes (A 2). Also: why a stepped device still falls to "whole replay" for "back 1k at most", "revocation", "sorts before its place" (5+2+3 times in one open) -> new task 32.

### F2. Local reads wait behind the catch-up lock (why Assets doesn't show on the Mac, which holds it all)
- Mac: `catch_up_steps` 261 steps, lock held 52 s in total, **max hold 16.0 s**; readers **waited 582 s in total, max 26.9 s**.
- Read latency in the same window: query p95 **33 s**, entry_views p95 **41 s**, cap_groups 18.8 s, world 13.8 s, 1-2 pending.
- Assets = `readAssetInventory` (aven/db/page/asset-inventory.js): `database` + `entry_views` for the recipes; the page shows "Reading … recipe entries…" until both answer (Assets.svelte `!held`). *(guess, strongly indicated)* That is the 33-41 s wait.
- The iPhone read the same entries fast (entry_views p95 85 ms, get 2 ms): it was not replaying, its reads didn't queue behind a catch-up. *(guess)* Its assets came from its own held entries.
- This breaks the local-first rule (no read may wait because the device is behind) and the 100 ms paint gate.
- Lesson: reads must run against the last stamped index, never behind the Lab's catch-up lock; catch-up steps in slices that never hold the lock long (max hold 16 s today) -> task 33.

### F3. The iPhone's only path is the relay, at 19 s RTT
- iPhone 19:12-19:18: relay RTT **19,324 ms** (Mac to the same relay: 63 ms); "negotiation failed: deadline has elapsed" every 30 s 19:13:31-19:18:02; "WebTransportError: source session" 19:12:31. That is "Connecting" and Peers "…".
- iPhone sync: behind 3,041 of 3,107; from 85b01be4 8 pages, 11 edits, 6 askings, 4 failed. Views: Chat partial, 0 of 5 entries, 5 waiting on 2,113 logs. synced p95 21 s, network 10.7 s.
- Mac: "no carrier in common" every 30 s (relay only); iroh "aborted by peer during the handshake" x3 at 19:23:12; "asking page after page error=stream reset by peer" 19:23:19.
- *(guess)* The peer answered slowly while it replayed (F1), which fits both devices' failed and timed-out askings; the 19 s RTT itself is on the phone's relay path.
- Lesson: task 15 (direct paths) is P0, not a nice-to-have; and a phone must open from handed index pages (B) so a slow path costs seconds of KB, not minutes of logs.

### F4. Live pulls bring nothing: lacking one head per log
- Mac 19:24:22-19:26:08: live pulls with **new=0** from both peers, 4-41 s each, view_ms 0.9-29 s, 5 of 8 `end="timed_out"`.
- Lacked: 97 logs to 85b01be4, 68 to d3e2b174, byStub 0; **every sampled log is held and lacks 1 head** (Vault 5272b604, Shares 29087c7e, 3abe9027, Audience aee573fe).
- Same shape as the 28 Oct iPhone reports (log 002f97be lacking 7 heads). Task 25 (heads exchange at its root) is confirmed by the Mac too.

### F5. The sync UI numbers contradict each other
Measured contradictions in one minute on the Mac:
- Pill rows "pulling · 0 edits" per peer vs the report's 382 edits taken (331 + 51). Cause (code): the row shows the running pull job's `took` (`j.done`, avendb-net lib.rs `synced`), which is 0 for a live pull that ran but saved nothing new, while "Edits taken" sums the peer's traffic since start. Two counters, two meanings, same word.
- "This view · 120 logs left" vs "Logs left 114 of 3,107" vs report `behind` 97. Three sources: the view's `fresh.logs` (avendb engine/coverage.rs `pending`: max of the read's coverage logs and the node's count for its scope, stamped when the read answered), `synced.behind` (count of logs where a peer's holdings differ, polled), and the report taken later. A view's logs can't exceed the device's; showing 120 > 114 proves they are from different moments *(guess: the view's read answered earlier, during the 33 s read wait)*.
- iPhone: "This view checking" while its report says Chat partial, waiting on 2,113 logs.
- Lesson: ONE status, derived from index stamps vs peer heads at one moment (task 8 + 26), never counters polled at different times. Until then every number is a guess dressed as a fact.

### F6. Memory on the Mac during catch-up
edits 151 MB, keys 150 MB, key_index 53 MB, log 114 MB in RAM, plus 188 MB spilled. Far from the < 100 MB metric; key data alone is 203 MB (A 2).

### F7. Process lessons from shipping Goal 9
- The first Mac build failed (18:03) on a stale local copy of the page's WebAssembly (`makePair` missing): the build used a CI-built artifact not in git. Fixed on the Mac: rebuild.sh now fetches the matching device build (`wasm.mjs ensure --fetch`) before every build. Should move into the repo's own build script -> task 34.
- The second build was lost when the Mac session restarted mid-build (18:10); nothing said so for an hour. A build must report its own end (success or failure) somewhere Samuel sees -> part of task 30.
- Cross-lane CI reds (task 31) cost three CI rounds.

### New tasks from F
| # | Task | Source | State |
|---|---|---|---|
| 32 | A stepped device falls to a whole replay for "back 1k at most", "revocation or root handed on", "new edit sorts before its place" (10 times in one Mac open): each becomes a stepped catch-up from the stamp, or is proven to need the replay | F1 | open |
| 33 | Reads never wait behind catch-up: query/entry_views/world answer from the last stamped index while catch-up runs in short slices (max lock hold 16 s, reader wait 27 s today) | F2 | open, P0 |
| 34 | The page's WebAssembly device build is fetched/verified by the repo's build (not a Mac-local script), so a stale copy can't be built in | F7 | open |
| 35 | A rules bump is judged once and handed (with B): the always-on peer must not spend 22 min on key boxes per release; restarts open the stored view | F1 | open, P0 |

Priority after these findings (*(guess)* order by impact): 33 (local first broken), 35 + A2 (every release costs 25+ min), 15 (phone relay 19 s), 25 (live pulls bring nothing), 8 + 26 (honest status), then B.

### F8. Self-test on the Goal 9 build (19:28-19:41 Berlin, fresh WebKit test device on maia.city)
- During catch-up no app showed its data: Chat at 19:29 empty intro, no rooms, pill "Syncing 35/3,111 · +4,276 edits".
- After the 4-min sync watch (~19:33): Logs left 959 of 3,111 vs This view 1,022 logs left (same view, same moment); last page "4 min ago"; **"failed askings 10 of 7"** (more failures than askings: counter bug); edits taken 10,938; only peer 85b01be4.
- Assets after sync: still "Reading Maia City's recipe entries…", empty (same as the Mac).
- Settings → Devices listed the devices.
- Always-on peer at 19:41: `replay latest:false`, 157,747 edits, **1 h 39 min after its 18:02 restart**. *(guess)* while it replays it stops answering askings (the test device's pages stopped after 6).
- Mac theOS 19:38: behind 10 of 3,111, but query p95 33 s, entry_views 41 s: catch-up lock waited **7,073 s in total**, max wait 40.7 s, max hold 33.8 s, 2,090 steps. Reads stay slow after the device is nearly caught up.
