# Bounded ordinary-entry judgment during catch-up

Implementation: [f64394f6](https://github.com/MyAvenCEO/maiacity/commit/f64394f6).

Status: integrated core implementation and Lean passed. All four judgment regressions passed within the combined296-test core run (zero failures,43.15s). Network integration and measured device latency remain pending. No deployment. This is a cooperative boundary around ordinary entry judgment, not a claim that all catch-up computation is bounded or sub-100 ms.

## The blocking path

`Shared::catch_up_paced_class` formerly ran `Lab::catch_up` under one Lab lock/scheduler permit. `refresh` performed authority replay, keys, body reads, all entry judgment and upkeep in the same call. Foreground queue priority could not interrupt an already-running long entry.

## Explicit presentation phase

`catch_up_step` initially performs the existing atomic authority/key/readings preparation. Ordinary entries then progress in private `JudgmentJob` state (History, After, cursor and optional ready items). Each job is fenced by exact log revision, keyring revision, entry tip, lane/groups digest and authenticated body-availability fingerprint. Stale jobs restart; partial jobs never become public Shown entries. Changed entries undergoing judgment are absent from the public map, while unchanged ready entries remain readable. Universal query completeness includes pendingJudgments; discovery remains unverified, never authoritative empty.

A slice stops after at most 32 judged writes, or after consuming 256 KiB of update bytes, or observing 4 ms elapsed at a cooperative boundary. It always makes at least one actual judgment step to avoid starvation when fixed preparation already exceeds the time target. One indivisible Loro import and final materialization can exceed that target; no fake preemption or synthetic elapsed measurements are used. At most one extra private scratch is retained. Demand priority changes cannot evict an unfinished cursor: it runs first until complete, then demand orders the next unstarted entry. Foreground read/write scheduling still preempts between slices.

Unchanged subsequent slices reuse the already-prepared authority phase. Upkeep runs only once all ordinary judgments complete. Ready ordinary local writes can use the existing strict content-only path while presentation alone is pending. A strict non-creation append preserves an unrelated private cursor only when its exact prior revision, keyring generation, target tip, lane and groups all remain unchanged; the cursor receives the new exact revision. Changed targets, creations and authority/context transitions cancel it. This avoids resetting background progress under continuous ready-entry writes. An unfinished target itself rejects mutation as ReadOnly instead of drafting from an empty visible history. Policy, key, lane and context changes do not inherit private judgments. Locking drops all private state and keys.

The network scheduler releases both mutex and scheduling permit between slices and performs a real asynchronous yield (including the browser task boundary). Active manifest demand orders entry work from the first prepared slice, including canonical retry after retiring an invalid warm receipt. The loop re-registers for scheduling each turn, so foreground work can run between real catch-up slices.

## Remaining limits

Initial authority replay, key opening, body decoding and cap-group judgment remain atomic. Owner-bootstrap overlays retain their canonical transaction path, because their state/readings restoration contract cannot be safely split by this change. Final per-entry materialization and individual Loro operations remain indivisible. Existing debug canonical differential checks can additionally affect debug timing. These are explicit remaining work, not silently waived acceptance criteria.

## Evidence required

The core regression receives 128 actual signed revisions, runs a bounded step, verifies the incomplete target is hidden, reads and writes a different ready entry between steps, requires that write not drain the backlog, writes the ready entry again after every background slice without resetting its cursor, resumes to completion, then compares both records against cold canonical restore. Another test locks with a real private judgment and requires cancellation. Lean proves cursor work bound, stale/incomplete non-publication and pending-upkeep exclusion under the implementation's stated exact-basis assumptions. Runtime tests, timing and physical-device responsiveness remain pending integration in the canonical build tree.


## Review corrections

Demand churn previously could replace the sole cursor and repeatedly lose progress. The current cursor now stays first until complete; a two-entry regression alternates demand each turn and requires strictly advancing progress or completion with at most one retained cursor. Invalid warm materialization retry now hides the failed old Shown and defers decoding/retry to the next scheduler turn rather than recursively resetting the slice budget. A dedicated regression requires no decoded body after that yielded turn, then canonical recovery. Finalization after a completed prepared slice also uses its own turn; upkeep-generated writes return for a fresh authority turn instead of starting another bounded refresh round inside the spent call.

The stale-visibility audit found the invalid-warm retry branch as the new exposure risk when yielding: it previously kept the old entry until immediate recursion repaired it. That branch now removes it before returning. Other invalidated/budget-deferred entries are already removed from public Shown; exact context changes cancel private jobs. Runtime validation of these corrections remains pending.

## Receive integration boundaries

Fetched key blobs previously called synchronous `Lab::receive`, immediately
running global refresh under one scheduler/DB turn. Key-byte admission now uses
normal receive with `now=false`, notifies the existing persistence path, releases
the Lab guard, and enters `catch_up_paced_class` with the original foreground or
background class. A focused regression admits 96 real signed revisions, supplies
real named key blobs, requires the entry to remain unpublished at the admission
boundary, then requires multiple bounded judgment turns and exact final content.

Staged entry admission likewise uses `receive_prepared(..., false)` under its
unchanged signature, current authority, inventory and demand fences. Only after
those locks release does it call paced catch-up. Demand-origin cancellation wraps
that wait; admitted data is retained and both admission/completion notify viewers.
Eligible exact ordinary live tails retain their existing immediate fast path.
Ceremony/contact receives remain synchronous because callers inspect current
policy in the same turn; they are separate review work, not silently changed here.

New Lean boundary lemmas passed standalone and changed Rust files parsed with
rustfmt. Rust/runtime validation is pending integration. Run the new
`receive_boundary_tests` filter plus existing staged transport and cold-demand
regressions.

### Remaining query hydration work

`engine::query_candidates_from` still imports records for every metadata-matching
candidate before applying offset/limit. `Shown::items_in` may import own snapshots
or rebuild a deferred history in that synchronous read. Pending-judgment safety
does not bound that already-validated warm hydration. A future guarded label-only
query plan could choose the ordered page before importing records, but only when
predicates, projection, count and ordering semantics can be preserved. This slice
makes no query-semantic change and claims no physical-device latency result.

### Accepted owner-base suffix reception

Owner-base suffix admission now follows the same split as scoped staged history:
verify the captured base, current authority/dependency closure, inventory and
active demand atomically; retain the verified edits with deferred presentation;
then run paced canonical catch-up outside the admission locks. Old overlay
metadata is not current after the held log changes: its exact log/key/anchor
basis must match before use. Navigation cancellation stops the foreground wait,
not the retained admitted edits. Actual live announcements remain independent.

The long-owner-base suffix regression now exercises prepared deferred reception
and `catch_up_step`, requires the old base scope to become unavailable before
reconstruction, then requires the exact latest text and advanced active base.
The existing public cold-room demand regression still requires both first view
and a subsequent live edit while all seventeen unrelated grant frontiers and the
unrelated payload remain withheld. Neither assertion was relaxed.

This split removes an unpaced receive call; it does not prove all work inside a
single canonical authority or owner-overlay restoration turn is bounded in wall
time. Owner-overlay restoration and initial authority preparation retain their
existing guards and budgets. Rust runtime validation is pending integration;
standalone `OwnerSuffixPacing` Lean model and Rust parser validation passed.
