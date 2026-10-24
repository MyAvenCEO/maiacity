# Own-shelf warm materialization reuse

Status: implemented on `codex/warm-working-set`, native validation pending. No physical-device speed or reload-fix claim.

## Problem and implemented boundary

The existing encrypted warm view saves policy replay but reconstructs every opened entry by judging historical writes, materializing before/after footprints and building Loro items again. This slice adds the device's own derived entry materializations to that same encrypted, engine-bound slot. It changes no signed history, peer authority, wire protocol, vault or data directory.

Warm restore still validates signatures/key receipts and the policy view, opens currently available keys/bodies, and rebuilds cap-group policy. Only then can a matching cached ordinary entry replace canonical historical judgment and materialization. It imports a full Loro snapshot, preserving historical operations and subsequent proposal/merge capability. This is not shallow state import from another peer.

The cache requires the exact complete ordered log and the entry's current shown fingerprint (writes, opened-body availability, lane and cap groups). Appended/revoked/reordered history disables all reuse; changed opened-body availability disables that entry. Corrupt/incompatible derived data falls back to canonical reconstruction. Legacy warm slots still decode and schedule a one-time materialization upgrade, retaining their valid policy replay. Future mutations resume canonical judgment from the restored history and ownership state; no scratch is persisted.

## Bounds and remaining limits

Capture prefers the recently reconstructed entries and caps selection at 256 entries, 8,192 judgments, and 32 MiB of source bodies. Encoded adjunct size and decoder entry/judgment counts are separately bounded. Each exported item is checked against the remaining adjunct budget before another is exported. Exporting a single item still temporarily allocates its complete snapshot. Encoding and encryption remain outside the shared database lock; capture forks selected Loro documents and clones judgment metadata without cloning historical bodies. These bounds do not constitute a hard bound on decoded Loro memory or snapshot decompression. Inputs are authenticated own-shelf data, never peer checkpoints.

Uncached entries still reconstruct normally. Cached ordinary entries defer importing their Loro snapshots until that entry is read or mutated (see the follow-up below). The work does **not** deliver lazy view-demand-only loading, authenticated remote bootstrap, complete removal of warm startup work, or a proven cure for iOS process reloads. Query/upkeep semantics remain unchanged. A saved prefix plus new edits uses canonical fallback. The clean-shutdown finalizer now requests the current derived view after authoritative journal persistence and producer quiescence, bypassing only the background 4,096-edit interval. An already-current acknowledged view does not encode again. Failed optional snapshot writes do not acknowledge a receipt and do not invalidate durable authoritative edits. Browser termination without a completed clean shutdown remains outside this guarantee; bounded idle publication and selective working-set imports remain follow-up work.

## Evidence to record before delivery

- `AvenDB/WarmMaterialization.lean`: guard/fallback and conditional equivalence, with authentication, canonical capture and codec correctness explicitly outside the proof.
- Exact cached/legacy record and Loro-version equivalence; subsequent local mutation equivalence.
- Frontier, engine, damaged adjunct, revocation and body/lane/group fingerprint refusal.
- Existing warm-memory/reconstruction regression suite.
- Synthetic repeated canonical versus cached materialization measurement, explicitly separate from physical unlock timing.

Commit and test results are appended when validated; no task is marked complete on source presence alone.

## Review and validation checkpoint

The prior prototype passed eight warm/scratch core regressions, including exact record/Loro version and successor equivalence, revoked/missing-body fallback, and unchanged persistence. A synthetic ten-iteration comparison measured 21.413 ms canonical historical judgment versus 1.609 ms saved restoration including decoding. This is neither whole-unlock nor physical-device evidence.

The final source adds clean-shutdown current-view publication, a real write/save/shutdown/reopen regression, legacy policy-only slot upgrade, stricter aggregate metadata decoding bounds, and per-export adjunct budgeting. Standalone Lean passed and `git diff --check` is clean. **Final-source Rust validation remains pending the parent’s single integrated build.** Do not mark this task Done or infer deployed behavior from the prototype results.

Focused final filters: core `own_materialization`, `unchanged_warm_restore`, `ordinary_reconstruction`, and `bounded_decoder`; net `clean_shutdown_publishes_recent_materialization_without_background_reencoding`, plus existing optional-snapshot/shutdown regressions. No live account, store, or installed application was touched.

## Follow-up: reject stale adjunct before copying

Warm restore now checks exact-frontier eligibility before copying the decrypted materialization adjunct into retained state. A valid older policy prefix still restores as before, but its unusable adjunct no longer causes a second allocation of up to 32 MiB. Decrypting the authenticated slot itself and valid exact-frontier imports retain their existing costs. This is an allocation reduction, not active-working-set-first startup.

The existing successor/frontier, corruption and revocation regressions cover the unchanged fallback decision. Standalone `WarmMaterialization.lean` and whitespace checks passed on this follow-up; focused final-source Rust tests await the shared compiler slot. The real clean-close/reopen regression remains required before claiming delivery.

## Follow-up: defer warm item imports until use

A validated warm entry now retains eager `History` and authorization metadata but places its Loro item map behind a `OnceLock`. The first item read imports that entry's saved snapshots; subsequent reads reuse the map. Saved bytes are released after initialization. Snapshot import failure rebuilds the item from the already validated canonical history. Targeted mutations initialize their entry before incremental reconstruction resumes. Cap-group judgment remains eager and unchanged. Entries without a matching own snapshot still reconstruct canonically.

This preserves the borrowed `&self` read API and does not represent missing materialization as missing history. Stewardship, counted writes, heads and revocation still use validated history. Projection capture explicitly reads the item map. Snapshot capture can also materialize entries; a clean close already covered by an acknowledged snapshot avoids another capture. Existing debug-only canonical parity assertions intentionally force imports; production first-read behavior and physical unlock timing must be measured separately. Broad world reads can still initialize all entries, so this is **not** a claim that active-view-only loading is complete.

Tests now assert deferred initialization, first-read parity, saved-buffer release and canonical recovery from corrupt deferred snapshot bytes. Existing successor-write and revocation tests continue to cover the changed private representation. Lean deferred-read/fallback lemmas passed before implementation; Rust validation pending the shared integration compiler. No new deployment or iPhone stability claim.

## Startup summary deduplication

App unlock completion and the session watcher previously each requested a fresh full-world snapshot. They now share the first successful summary through `initialWorld()` / `createWorldReader.ensure()`. Explicit mutation freshness barriers still call `refresh()` / `request()` and always require a snapshot begun after their request. Failed initial reads can retry; device retirement cancels both initial and freshness requests. Ten world-reader tests passed, including these boundaries.

The remaining broad-read blocker is concrete: `world::entry_with_files` calls `lab.item` for every landed entry. Navigation, acting-vault ownership, access and seeding consume the same world response, and no current metadata-only operation supplies those fields. Removing this read without a new metadata contract would silently remove required ownership/context information. Active-view-only startup therefore still requires an additive authorized metadata summary and explicit completeness for the consumers, then route-scoped queries. This frontend change removes redundant work; it does not remove the first full-world materialization.

## Metadata-first dashboard and Chat startup candidate

The additive local read operation `world_summary` now returns canonical navigation, acting identity, ownership, share and audience metadata, including profile/card labels, without constructing ordinary entry/file projections. It explicitly marks `entriesComplete:false`. Identity profile/card entries may still materialize, so this is not a zero-item-read claim. It has no privileged peer/server route.

Dashboard home and the already scoped Chat route request this summary; unaudited routes and legacy hash collections retain full-world reads. Route changes request the appropriate new summary. Legacy collection rendering waits while the world is explicitly incomplete instead of showing an empty collection. Account upkeep may maintain its device card/copy policy from metadata, but entry-based seeding/maintenance refuses an incomplete collection. Explicit `refresh()` remains a full-world freshness barrier for callers that require it.

Twelve targeted JavaScript tests passed; changed Svelte components and the session rune module compile; Lean summary authority/incompleteness lemmas passed. Native regression `startup_summary_preserves_authority_without_importing_ordinary_warm_items` checks an unrelated deferred note remains unimported and compares every non-entry response field with canonical full world. Rust validation pending parent integration. These changes require matching frontend and native/WASM engine delivery. Physical startup latency, broad route conversion and complete manifest coverage remain open.

## Completeness follow-up: media and initial founding

The media resolver distinguishes an unenumerated collection from a confirmed full-world deletion. Same-device incomplete summaries retain resolved URLs; full-world deletion still revokes them. Device replacement clears URLs and file identities immediately on summary/render access, and an old asynchronous read cannot publish into a replacement device. Four focused media regressions pass alongside the twelve summary/reader tests. New unresolved media still needs file metadata; this does not claim complete scoped media discovery.

The app's explicit `founded` result requests one full freshness barrier for entry-based account initialization. Routine unlocks still join metadata-only startup. This does not silently run entry seeding against partial collections, nor does it add a full-world request to every ordinary dashboard open. Later repository seed top-ups still require complete inventory; fully scoped maintenance remains separate work.

## Follow-up: file-only media inventory (isolated candidate)

Two consumers still defeated lazy item restoration by requesting `world` only to
resolve media: profile/local-media fallback before a complete shared snapshot, and
manifest traversal of `aven:` references. They now use canonical `entry_views`
with `types: ['file']`; local-media scopes to requested vaults. Cross-vault legacy
roots enumerate identity metadata through `world_summary`, then query each vault
sequentially. No unrelated note/chat/game body is projected by this inventory.
Authorization remains the engine's existing projection policy.

An unavailable/refused/incomplete inventory throws rather than confirming empty;
local-media retains already resolved same-device URLs on that path. Actual device
replacement still clears them. Demand is captured before awaits, so a newly added
vault request cannot be mistaken for a missing file in the prior inventory.
Enumeration is of currently held local files, not a promise of complete peer
history. File collections themselves remain unpaginated. This is evidence of
avoided work, not proof of the cause or resolution of iPhone document restarts.

Validation: 26 focused Bun tests pass (file inventory, manifest traversal,
local-media state), Svelte module compilation passes, and
`AvenDB/LocalFileInventory.lean` passes. Lean proves only the modeled preservation
and subset properties; canonical engine authorization remains a premise. No Cargo,
physical iPhone measurement, production deployment, or live-store mutation here.
Keep this follow-up separate from the frozen release until explicitly integrated.

## Follow-up: saving preserves undemanded lazy entries

`Capture::take` previously called `Shown::items()` for every selected entry, so an
optional warm save could undo lazy restore: import all saved Loro snapshots and
then export them again despite no view reading those entries. Capture now forks
already materialized items only; untouched entries retain their own authenticated
snapshot bytes and emit those bytes unchanged. The existing exact log/entry
fingerprint validation and first-read canonical-history fallback are unchanged.
Deferred bytes count toward the capture budget before cloning. The final encoded
adjunct limit still applies. This reduces import/export work; it does not promise
zero copying, a hard total process-memory bound, or a complete lazy-history engine.

Regression added: three lazy restored entries remain unmaterialized through
capture and encoding, the next receipt contains exactly the same per-line bytes,
and first demand returns the original content. Focused WarmMaterialization Lean
proof passes. Rust regression `recapturing_untouched_warm_entries_preserves_lazy_items_and_snapshots`
is pending the shared Cargo queue; no deployment or physical-device claim.

Still eager: canonical policy/key/body preparation and History/Mine/After metadata;
entries outside the bounded saved receipt; capability-group reconstruction; and
consumers requesting a full world. Deferring these requires authenticated metadata
read dependencies and canonical admission to be disentangled from item access.
