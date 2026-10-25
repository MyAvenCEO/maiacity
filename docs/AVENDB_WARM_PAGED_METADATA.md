# Bounded warm metadata and active working set

This follow-up separates the optional 256 document snapshots from complete ordinary-entry metadata receipts. It does not increase the existing aggregate 8,192-write or 32 MiB adjunct limits. Receipts serialize in pages of at most 256 entries inside the existing authenticated, encrypted `Warm.view` storage container. They are not independently fetched filesystem pages.

A metadata-only entry retains validated history judgments, current-key checks and canonical fingerprints. Reading its content hydrates that entry's authenticated bodies. Unrelated content remains deferred. Uncovered entries and malformed receipts still reconstruct canonically from preserved signed history. Governance/schema/key changes keep their existing conservative invalidation behavior.

Mounted generic query windows retain bounded opaque entry-ID hints for the current route. Native and PWA unlock pass those hints through the common startup path. At most 256 requested entries receive early materialization/snapshot priority. Hints contain no record payload or key, confer no access, and never unlock anything. Missing/corrupt hints or a new route use the existing discovery path.

## Validation

- `WarmMetadataPages.lean`: authorization and bounded-receipt invariants; standalone proof passed.
- Query-window and hint regressions: 21 tests passed, including route change, unmount persistence, invalid IDs, storage failure and the 256-hint cap.
- Rust warm-materialization suite: **15 passed, 0 failed** (2.67 seconds). New regression creates 300 entries, requests a metadata-only entry, asserts unrelated bodies remain closed, then saves/reopens while retaining unchanged durable slots and compares canonical data. Malformed/duplicate/excess pages fail closed.
- Full application typecheck: 0 errors, 27 existing warnings. `cargo check -p avendb-browser -p avendb-device --tests` passed, including the changed common startup signatures. Matching deployed WASM/native artifacts and physical-device acceptance remain pending.

## Remaining limits

The authenticated adjunct is still loaded as one bounded container. There is no claim of arbitrary-store lazy persistence, bounded cryptographic/document-operation latency, fresh-device bootstrap completion, or physical iPhone performance. Entries outside the aggregate receipt budget still reconstruct normally. Working-set hints only prioritize known IDs; fresh discovery remains separate. Matching WASM/native artifacts must be built before the new startup argument is effective in deployed applications.

## Capture admission follow-up

Capture now checks the remaining write budget before walking the entry's history, acquiring its deferred snapshot lock, or constructing metadata. Existing body-byte accounting also runs before metadata encoding. Metadata collection stops at the first byte overflow instead of encoding every later body and discarding the full collection. A skipped adjunct still falls back to signed-history reconstruction; no canonical admission or authorization rule changes.

Lean admission-bound proofs passed. The exact extracted Rust collector and its regression passed standalone (1 test): over-budget histories never invoke metadata construction, byte overflow stops the next body, and exact-budget input remains accepted. The full Cargo warm suite for this follow-up awaits the shared compiler slot. A single metadata body's encoding remains indivisible; this is not a hard wall-clock or single-allocation bound.
