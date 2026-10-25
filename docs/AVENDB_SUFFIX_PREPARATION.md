# Bounded owner-bootstrap suffix preparation

This follow-up replaces initial full entry-suffix allocation with a resumable ordered-index cursor. Each reconstruction turn inspects at most 128 candidates across all anchors, including candidates already covered by the attested base. The existing shared 32-edit verification/materialization budget remains separate. An anchor retains only its current prepared page and resumes after the last inspected canonical key `(depth, rank, edit ID)`.

The cursor reuses the existing `OverlayBasis` revision fence: changes to log, keys, policy inputs, anchor or other replay dependencies invalidate progress and reconstruct it. The filtering predicate is unchanged from `entry_suffix_ids`; ordinary signature, authority, dependency, schema and convergence checks remain downstream. A missing key/body/schema wait continues to suspend work. Preparation progress rotates the anchor cursor even when a page contains no new edits.

`owner_base_pending` is a conservative candidate count while discovery is incomplete. Zero still requires exhausted discovery and an empty queue. When all indexed writes are already covered by the base, no discovery turn is required. The UI must not interpret a positive number as an exact count of authorized unprocessed edits.

Validation: Lean budget/completion/page-concatenation invariants passed. The exact extracted index-page and pending-cursor code passed a standalone Rust regression with 600 indexed candidates, 500 already judged, bounded yielding and reference-equivalent output. Repository tests extend canonical-order differentials across late parents, appends, removals, clone/replacement and page sizes 1/7/128. Full Cargo regression execution is pending the compiler slot.

Remaining synchronous work includes authenticated base decoding/judgment restoration, constructing its already-judged set, lane preparation and individual document/cryptographic operations. This change does not claim those operations are preemptible or all warm startup is constant time. Signed history is preserved; no storage reset or authority relaxation is involved.

## Live ordered owner appends

A narrowly admitted continuation now retains the already-validated overlay across current-log revisions consisting of at most 128 ordinary owner MAIN appends to active entries. Log lineage, key/anchor/warm identities, follow/depth/gate and strictly later per-entry order must match. After canonical replay, current checkpoint authority and lane digest are checked again. New edits extend the discovery cursor and still pass normal signature, dependency, policy and content judgment. Late-order edits, revocations, schema/key changes, proposals and unsupported bursts use the existing canonical restart path.

The deterministic regression starts with 256 suffix edits, repeatedly receives one live edit and pumps, requires remaining work to shrink instead of replaying the same prefix, checks canonical equality, then verifies revocation removes access. Lean continuation guards passed; Rust regression execution is pending. This does **not** establish liveness for arbitrary unsupported revision streams or bursts above the admission bound; fair intake/backpressure for those remains open.

## Common bounded receive admission

Normal and range transfer now share an owned prepared-page admission loop. Ordinary input is moved into chunks of at most 128 edits without changing their order or detaching signature outcomes. Each chunk acquires a fresh foreground/background scheduler grant, then yields a real browser task boundary before another chunk. When a partial base exists, deferred prior input is caught up before applying the next chunk, and that chunk refreshes the validated prefix immediately.

The page-memory permit, lifecycle ticket and range accounting owner move through the actual Lab closure. The accepted count is updated inside that closure, so cancelling a waiter cannot erase an already admitted count or release its permit during ongoing admission. Unadmitted remaining inputs are dropped on cancellation and ordinary sync retry recovers them through deduplication.

**Checkpoint exception:** a page containing an `Action::Checkpoint` stays atomic. Its coverage can vouch for bare signatures earlier in the same page; splitting it without a staged authenticated-coverage protocol would change admission. This follow-up therefore does not claim a universal 128-edit bound for checkpoint pages.

Added repository regressions cover ordered/deduplicated prepared chunks, unchanged checkpoint coverage, cancellation after the first 128 of 300 edits, permit retention while admission runs, and retry admitting exactly the remaining 172. Lean ownership/order invariants passed; Rust source parses. Full Cargo execution is pending. Non-owner/group-dependent revisions still use the conservative prefix invalidation path; bounded intake alone is not a proof of liveness for those streams.

The prepared-batch regression also places an invalid first signature at edit 127 and a valid duplicate at 128, plus a later invalid duplicate. Each chunk retains the original page's immutable per-ID verdict; removing that verdict after the first chunk would incorrectly change duplicate admission. The test compares exact retained signed edits against whole-page admission and asserts the rejected ID is absent. The cancellation test uses the actual range `Accepted::channel`, including last-owner completion. Standalone extraction of the exact batch iterator passed the negative-verdict and atomic-checkpoint regression; full runtime tests remain pending.
