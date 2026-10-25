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

### Reuse preparation between unchanged private judgment slices

A continued private slice now reuses the already judged historical capability
sequence and recorded vault lane hashes only when its judgment epoch matches the
exact current log revision and key identity, with no reshow or newly opened body.
It no longer rejudges all cap-group histories or walks every entry to discover
all vault lanes on each 32-write continuation. The complete historical group
sequence is retained; using only the latest group would incorrectly judge older
writes. Lane objects are built lazily for vaults actually used by this turn.

New policy edits, key replacement, reshow and newly opened bodies force canonical
preparation. The focused regression uses nine actual cap-group versions alongside
128 ordinary writes, checks reuse, forces key replacement and a later policy
edit, then compares the final record, group entry and full group history with an
unpaced reconstruction from the same signed backup. Rust execution remains
pending combined validation. The standalone PreparedJudgmentReuse Lean model and
Rust parser passed. This removes repeated preparation, not every possible long
operation: building a demanded vault's Lane still uses canonical lane_of, and
initial preparation retains its existing whole-context work.

### Mixed-author room cuts through plain grants

Scoped complete-cut discovery now permits participant writes on Main after an
owner-created entry. It records every actor as well as every via vault and requires
their current authority frontiers. Existing classified inventory closure still
includes historical audience shares, wide readers (including wide writers), every
parent chain, issuer/recipient/owner/device dependency and audience key frontiers.
The shape is a dependency plan only: signatures, current replay admission,
proof commitments, schema/row-ownership judgment and revocations remain canonical.
For any mixed-actor cut, a referenced grouped grant in that closure remains
unsupported; latest group state cannot replace historical group dependencies.
Foreign creation, proposals, over-budget or unknown cuts also retain fallback.
Owner-base suffix optimization remains owner-only in this increment.

The new real-peer fixture uses the actual Room built-in schema and a Member
participant grant. Public query+demand must expose the owner's first message and
a participant's second message, then a third live participant message via normal
peer transport while seventeen unrelated revocation frontiers and a payload
remain withheld. It never invokes target staging or direct target transfer.
A focused classifier regression checks missing actor authority and grouped-grant
refusal. Standalone MixedActorPlainScope Lean proof and Rust parser checks pass;
Rust execution is pending the canonical combined build. This is a scoped
increment, not completion of arbitrary shared bootstrap.

### Continuing an accepted owner base after participant writes

The current owner-base dependency summary now retains every actor in its bounded
main-line history, including already canonically judged participant writes. It
still requires an owner-created entry, exact current overlay basis and existing
write/actor/path bounds. This metadata remains only a transfer plan. The existing
suffix interpreter still requires current actor authority, valid signatures,
complete group-free commitment proofs, canonical per-operation judgment and
current revocation checks; no grouped-proof or proposal relaxation is introduced.

The existing malformed-proof/revocation regression now requests the real bounded
suffix response, admits it with deferred presentation, completes paced canonical
judgment, then uses the advanced mixed-actor base for a second participant suffix.
Both results must equal the fully replayed peer while the attested prefix stays
withheld. Its malformed proof and revoked participant assertions remain intact.
The net OwnerEntry::from_base actor propagation is coordinated in the grouped
collector agent's separate patch; this core API patch must be integrated with
that bridge. Standalone MixedOwnerBaseSuffix Lean and Rust parsing passed; Rust
runtime validation remains pending.
### Authority prerequisites cannot wait behind blocked target history

Accepted-base suffix transfer used separate page admission but still fetched
missing authority/witness prerequisites through ordinary active pull admission.
When every history slot is occupied, those prerequisites cannot progress. The
long-base gate deliberately holds all those slots and exposed this dependency
cycle; stage diagnostics are retained pending runtime confirmation of its exact
missing frontier.

The repair gives suffix authority prerequisites two separately bounded active
slots and four total queue tickets. It reuses the ordinary request/reply,
signature/current admission, frontier bookkeeping and common page/byte permits.
Only nonempty sets of at most128 Vault/Share/Audience logs can enter this lane;
Entry logs and mixed authority+Entry requests are rejected before admission.
Replies are also rejected if any edit belongs outside the exact requested
logs. Canonical catch-up remains paced. No unrelated payload history is added to
the independent lane, and shared pages still bound memory including large replies.
Only accepted-base suffix dependencies and their grant-classifier witness repair
select this lane; normal staged and background work retain existing admission.

The focused starvation regression holds every normal slot, admits exactly two
authority operations, checks bounded waiters/cancellation, refuses target-history
requests and verifies common page capacity cannot be exceeded. Lean model and
Rust parsing pass; Rust runtime and the original long-base gate remain pending.

### Chat fixture uses the actual public authoring operations

The first mixed-room runtime failed during fixture construction, before demand:
`Item::made` was given an incomplete nested view without the public engine's
schema-default completion. The fixture now follows Chat's actual create and
insert operations, including timestamps/mentions. Participant permissions use
`rules::member()` (also for the historical grouped variant), rather than the
broader Editor/Write operation set. Plain Member still has wire authority level
Write; Member is an operation group, not a Rust Level enum. Each public response
must report success and received row assertions remain unchanged. Parser passed;
runtime rerun pending.

### Cold query classification yields before loading every matching record

The label-only query count loop previously called `item` for every uncertified
candidate before applying limit/offset. A non-default-depth query could therefore
import every retained record even for `select:[]` and `limit:1`. Record predicates
had the same issue. Query turns now admit at most four cold candidates, stopping
after four milliseconds once one has started. Already materialized entries and
applicable authenticated visibility receipts remain usable. A new nonhydrating
predicate inspects lazy cells only; ordinary visibility and authorization are
rechecked on every actual query turn.

Skipped local work is explicit: `ok.readiness.deferredCandidates`,
`ok.countExact:false` when classification is unfinished, and
`ok.pageComplete:false` until the page's required local work finishes. A receipt
can establish an exact count even if selected record projection still waits.
Deferred candidates are separate from missing/unavailable candidates. Repeating
the same query after yielding reuses authenticated per-entry lazy cells and
advances; there is no cached authorization or answer tied to a stale query.
Consumer continuation is coordinated separately and must ship with this change.

The regression restores sixteen matching entries lazily and exercises metadata
pagination and record predicates. Each call hydrates at most four, later calls
make progress without sync events, and the final full response must equal the
unbounded canonical oracle. Standalone ColdQuerySlices Lean and parsing passed;
Rust execution remains pending. Ready-record scans, individual Loro imports,
checkpoint record decoding and metadata preparation are not wall-time bounded
by this increment.
### Verified group prerequisites share the bounded dependency lane

A separate opaque GroupDependencies token from the authenticated grouped closure
can now admit its named missing group Entry logs. The collector excludes the
original target and bounds the set to32; the transport verifies every requested
Entry is in that token. Ordinary authority calls still reject every Entry log.
Mixed token+unverified target requests are rejected, and response edits remain
limited to the exact requested logs. Group and authority requests share the same
two active slots, four queue tickets and existing common byte/page budgets.
The collector token/callsite is delivered by the coordinated grouped-closure
patch; neither patch is standalone. Parser and standalone VerifiedGroupAdmission
Lean passed; focused shared-capacity and unverified-entry rejection tests await
Rust execution.

Cold-query progress correction: nonhydrating current meaning and selector checks
precede record admission. Missing semantic groups or inaccessible deferred bodies
are unresolved, not retryable hydration; a candidate consumes one slot per turn
even when classification and projection both touch it. The missing-group
regression keeps four candidates unresolved while eight other cold records finish
and compares the final response with the canonical oracle. Rust remains pending.
