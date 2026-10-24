# Own-shelf warm materialization reuse

Status: implemented on `codex/warm-working-set`, native validation pending. No physical-device speed or reload-fix claim.

## Problem and implemented boundary

The existing encrypted warm view saves policy replay but reconstructs every opened entry by judging historical writes, materializing before/after footprints and building Loro items again. This slice adds the device's own derived entry materializations to that same encrypted, engine-bound slot. It changes no signed history, peer authority, wire protocol, vault or data directory.

Warm restore still validates signatures/key receipts and the policy view, opens currently available keys/bodies, and rebuilds cap-group policy. Only then can a matching cached ordinary entry replace canonical historical judgment and materialization. It imports a full Loro snapshot, preserving historical operations and subsequent proposal/merge capability. This is not shallow state import from another peer.

The cache requires the exact complete ordered log and the entry's current shown fingerprint (writes, opened-body availability, lane and cap groups). Appended/revoked/reordered history disables all reuse; changed opened-body availability disables that entry. Corrupt/incompatible derived data falls back to canonical reconstruction. Legacy warm slots still decode and schedule a one-time materialization upgrade, retaining their valid policy replay. Future mutations resume canonical judgment from the restored history and ownership state; no scratch is persisted.

## Bounds and remaining limits

Capture prefers the recently reconstructed entries and caps selection at 256 entries, 8,192 judgments, and 32 MiB of source bodies. Encoded adjunct size and decoder entry/judgment counts are separately bounded. Each exported item is checked against the remaining adjunct budget before another is exported. Exporting a single item still temporarily allocates its complete snapshot. Encoding and encryption remain outside the shared database lock; capture forks selected Loro documents and clones judgment metadata without cloning historical bodies. These bounds do not constitute a hard bound on decoded Loro memory or snapshot decompression. Inputs are authenticated own-shelf data, never peer checkpoints.

Uncached entries still reconstruct normally. Cached entries still import their snapshots before first view. The work does **not** deliver lazy view-demand-only loading, authenticated remote bootstrap, complete removal of warm startup work, or a proven cure for iOS process reloads. Query/upkeep semantics remain unchanged. A saved prefix plus new edits uses canonical fallback. The clean-shutdown finalizer now requests the current derived view after authoritative journal persistence and producer quiescence, bypassing only the background 4,096-edit interval. An already-current acknowledged view does not encode again. Failed optional snapshot writes do not acknowledge a receipt and do not invalidate durable authoritative edits. Browser termination without a completed clean shutdown remains outside this guarantee; bounded idle publication and selective working-set imports remain follow-up work.

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
