# Bounded ordinary-entry judgment during catch-up

Status: source implemented, Lean and Rust syntax checks passed; canonical runtime validation pending. No deployment. This is a cooperative boundary around ordinary entry judgment, not a claim that all catch-up computation is bounded or sub-100 ms.

## The blocking path

`Shared::catch_up_paced_class` formerly ran `Lab::catch_up` under one Lab lock/scheduler permit. `refresh` performed authority replay, keys, body reads, all entry judgment and upkeep in the same call. Foreground queue priority could not interrupt an already-running long entry.

## Explicit presentation phase

`catch_up_step` initially performs the existing atomic authority/key/readings preparation. Ordinary entries then progress in private `JudgmentJob` state (History, After, cursor and optional ready items). Each job is fenced by exact log revision, keyring revision, entry tip, lane/groups digest and authenticated body-availability fingerprint. Stale jobs restart; partial jobs never become public Shown entries. Changed entries undergoing judgment are absent from the public map, while unchanged ready entries remain readable. Universal query completeness includes pendingJudgments; discovery remains unverified, never authoritative empty.

A slice stops after at most 32 judged writes, or after consuming 256 KiB of update bytes, or observing 4 ms elapsed at a cooperative boundary. It always makes at least one actual judgment step to avoid starvation when fixed preparation already exceeds the time target. One indivisible Loro import and final materialization can exceed that target; no fake preemption or synthetic elapsed measurements are used. At most one extra private scratch is retained. Demand priority changes may replace that scratch; displaced entry IDs remain queued.

Unchanged subsequent slices reuse the already-prepared authority phase. Upkeep runs only once all ordinary judgments complete. Ready ordinary local writes can use the existing strict content-only path while presentation alone is pending. Such a write cancels the old exact-basis cursors and retains the pending entry IDs, rather than draining them synchronously. Policy, key, lane and context changes do not inherit private judgments. Locking drops all private state and keys.

The network scheduler releases both mutex and scheduling permit between slices and performs a real asynchronous yield (including the browser task boundary). Active manifest demand orders entry work. The loop re-registers for scheduling each turn, so foreground work can run between real catch-up slices.

## Remaining limits

Initial authority replay, key opening, body decoding and cap-group judgment remain atomic. Owner-bootstrap overlays retain their canonical transaction path, because their state/readings restoration contract cannot be safely split by this change. Final per-entry materialization and individual Loro operations remain indivisible. Existing debug canonical differential checks can additionally affect debug timing. These are explicit remaining work, not silently waived acceptance criteria.

## Evidence required

The core regression receives 128 actual signed revisions, runs a bounded step, verifies the incomplete target is hidden, reads and writes a different ready entry between steps, requires that write not drain the backlog, resumes to completion, then compares both records against cold canonical restore. Another test locks with a real private judgment and requires cancellation. Lean proves cursor work bound, stale/incomplete non-publication and pending-upkeep exclusion under the implementation's stated exact-basis assumptions. Runtime tests, timing and physical-device responsiveness remain pending integration in the canonical build tree.
