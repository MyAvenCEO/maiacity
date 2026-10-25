# Bounded warm metadata and active working set

This follow-up separates the optional 256 document snapshots from complete ordinary-entry metadata receipts. It does not increase the existing aggregate 8,192-write or 32 MiB adjunct limits. Receipts serialize in pages of at most 256 entries inside the existing authenticated, encrypted `Warm.view` storage container. They are not independently fetched filesystem pages.

A metadata-only entry retains validated history judgments, current-key checks and canonical fingerprints. Reading its content hydrates that entry's authenticated bodies. Unrelated content remains deferred. Uncovered entries and malformed receipts still reconstruct canonically from preserved signed history. Governance/schema/key changes keep their existing conservative invalidation behavior.

Mounted generic query windows retain bounded opaque entry-ID hints for the current route. Native and PWA unlock pass those hints through the common startup path. At most 256 requested entries receive early materialization/snapshot priority. Hints contain no record payload or key, confer no access, and never unlock anything. Missing/corrupt hints or a new route use the existing discovery path.

## Validation

- `WarmMetadataPages.lean`: authorization and bounded-receipt invariants; standalone proof passed.
- Query-window and hint regressions: 21 tests passed, including route change, unmount persistence, invalid IDs, storage failure and the 256-hint cap.
- Rust warm-materialization suite: 14 passed; the new 300-entry save/reopen regression exposed metadata-only recapture being skipped inside the snapshot positions. The source fix retains metadata when no snapshot exists; rerun is pending. New regression creates 300 entries, requests a metadata-only entry, asserts unrelated bodies remain closed, then saves/reopens and compares canonical data. Malformed/duplicate/excess pages must fail closed.
- Full application typecheck: 0 errors, 27 existing warnings. Common native/PWA Rust compilation remains pending.

## Remaining limits

The authenticated adjunct is still loaded as one bounded container. There is no claim of arbitrary-store lazy persistence, bounded cryptographic/document-operation latency, fresh-device bootstrap completion, or physical iPhone performance. Entries outside the aggregate receipt budget still reconstruct normally. Working-set hints only prioritize known IDs; fresh discovery remains separate. Matching WASM/native artifacts must be built before the new startup argument is effective in deployed applications.
