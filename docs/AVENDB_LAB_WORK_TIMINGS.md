# Remaining catch-up responsiveness: measured Lab phases

## Finding

`Shared::catch_up_paced_class` calls `Lab::catch_up`, which calls the full `Lab::refresh` transition for held incoming history. The full transition updates policy replay, keys, opened bodies, materialized items, upkeep and checkpoint overlays together. Scheduler priority changes which queued operation starts next; it cannot preempt this transition once it owns the Lab mutex.

The existing `perf` response already times replay, key indexing/opening, read, lane/cap-group preparation, judging/materialization and upkeep. The copied diagnostic report retains those fixed labels. Previously it could not distinguish a slow local write caused by queued work, thread-pool dispatch, mutex contention, or execution inside the lock.

Pausing an arbitrary inner refresh loop is not safe: an exposed partial transition could mix newer authority/revocations with older opened/materialized state. Cloning the whole state to run elsewhere is also not a bounded solution. This slice therefore adds the missing bounded measurements rather than claiming an unvalidated change to those semantics.

## Implemented observations

Each successfully completed scheduled Lab operation records four disjoint durations:

- `queue`: time acquiring its scheduler turn, including waiting for queue capacity.
- `dispatch`: time from acquiring its turn until the actual work closure starts (native blocking-pool delay; worker dispatch on WASM).
- `lock_wait`: time acquiring the Lab mutex.
- `operation`: time executing while holding the Lab mutex, including transition bookkeeping, ending immediately after the guard is released.

There are exactly three fixed scheduling classes (`mutation`, `foreground`, `background`) and four phases. Each stores count, total, mean and maximum; no sample arrays, operation text, entries, identities or contents. The network diagnostic response exposes `lab_work`; the existing copied report includes only those fixed dimensions, rejecting malformed/nonfinite values and arbitrary extra data.

Cancelled/panicked operations are excluded. These are process-lifetime aggregates, not per-write correlation, DOM paint latency, worker event-loop scheduling before a message reaches Rust, or a guarantee of less than 100 ms. Maxima from different phases need not belong to the same operation. Use the phase breakdown with the existing core `perf` breakdown to select the next safe bounded transition, and keep authorization checks unchanged.

## Validation and integration

Lean model `AvenDB.LabWorkTiming` establishes fixed dimensions and independence from authorization; it does not prove a timing bound. Standalone Lean check passed. All 10 diagnostic report tests passed (31 assertions), including strict projection/redaction and unavailable legacy-engine handling.

Rust unit test `lab_timing::tests::lab_work_timings_keep_classes_and_phases_separate_without_samples` is added but **runtime validation is pending**. Per coordinator instruction, no Cargo build was started in this isolated worktree: Rust integration/testing must run in canonical `/private/tmp/avendb-view-first` to reuse vendor-path fingerprints and avoid repeating the entire network dependency build. No app installation or deployment was performed.
