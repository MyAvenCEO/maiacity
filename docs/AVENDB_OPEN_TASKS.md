# avenDB: open tasks and handoff

Paused at the user's request on 2026-10-25. Continue from branch
`codex/view-first-performance`. Implementation through
[60c9fa53](https://github.com/MyAvenCEO/maiacity/commit/60c9fa53) is committed and pushed.
The latest batch is **not deployed**. Preserve existing accounts, keys and stores;
all nodes remain equal peers. Full background and history: [upgrade ledger](AVENDB_UPGRADE_PLAN.md).

| State | Remaining task |
|---|---|
| Doing | Finish combined Rust validation. The latest network compile was deliberately interrupted on pause; it is not a passing build. |
| Doing | Rerun cold-query hydration regressions after the corrected persisted-warm fixture; verify bounded progress and exact final results. |
| Doing | Prove group-backed Chat renders, finishes its semantic permission checks and receives live updates while unrelated history remains withheld. |
| Doing | Verify independent authority/group prerequisite admission, cancellation and unchanged shared memory/page limits. |
| Doing | Finish semantic completion for entries beyond the current 64-write/129-authority partial-path limits; complete-current-cut and accepted-base paths must not stay pending forever. |
| Doing | Verify persisted pending permission work resumes after restart and later arrivals. Complete recovery for the compact global uncertainty guard after corrupt companion data. |
| Doing | Validate bounded cold-query continuation end to end, including immediate provisional rows, exact counts, navigation cancellation and direct callers that may trigger writes. |
| Open | Measure remaining ready-record scans, individual Loro imports and synchronous operations during heavy catch-up; the hydration budget does not bound those operations. |
| Open | Build matching native/WASM artifacts, run final required checks, merge/deploy the combined release and install the matching Mac dev build. |
| Open | Physical iPhone/iPad acceptance: reload stability, warm unlock, fresh requested-view time, local durable-write latency and cross-device updates during catch-up. |

## Verified evidence and limits

- Plain shared Chat first view and participant live updates passed with unrelated history withheld at source `a350f66a`.
- Long-owner checkpoint live suffix passed with ordinary history slots occupied at that source. Group-backed Chat failed before its subsequent scheduling correction; its rerun is still required.
- Full core suite: **310 passed** at `bee1789b`, before later query/group-completion changes.
- Latest completed frontend check: **0 errors, 45 warnings**. Direct-consumer subset: **40 tests passed**. Earlier combined partial-query JS subset: **72 passed**.
- Full Lean build: **133 jobs passed** before the latest selector-completion additions; rerun the final aggregate.
- Local disk pressure interrupted one network compile. Only inactive task-owned incremental caches were deleted. Use `CARGO_INCREMENTAL=0` and serialize Cargo builds; check free disk before building.
- No latest-batch deployment or physical-device latency success is claimed. Do not mark the full goal complete from narrower tests.

## Resume

1. Read this file and the upgrade ledger; inspect branch status and current source.
2. Run focused core and real-peer regressions above, fix actual failures without weakening withheld-history/authorization assertions.
3. Finish the remaining semantic and responsiveness gaps, then validate one combined artifact set and deliver.
4. Update this list and the full ledger with each completion and its commit link.
