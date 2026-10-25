# Guarded local mutation — candidate, runtime tests pending

`read_guard { query }` returns the deterministic authorized local read as `value` and a `{query,digest}` receipt. Only scoped entry inventories, schemas and navigation summary reads are accepted; no network, perf, arbitrary world scan, mutation or nested guard runs. Query encoding is capped at 64 KiB; result hashing streams to a bounded writer rather than copying large JSON buffers.

`guarded { checks, change }` accepts 1–16 receipts with at most 8 MiB of combined encoded results. It re-reads each original query with the original device and current permissions under the Lab mutation lock, compares its digest, and only then runs ordinary `prepare(change)`. It never grants a right to perform the underlying change. Nested wrappers, read wrappers and file uploads are rejected; removal classification delegates to the inner operation so the node's existing removal-behind checks remain intact.

If preparation yields owner approval, the checks remain on the in-process Approval and are bound to its challenge. After the ceremony, `approve` verifies the challenge binding and re-reads the checks under the Lab lock before keeping/completing any draft. A stale plan is refused even when its owner has already approved its old challenge; no extra edit is kept. The external ceremony itself cannot be undone. No automatic approval or key change is introduced.

This is a one-change primitive. It does not yet orchestrate the ordered multi-op public workflow plan. Reusing an original receipt after an earlier planned operation changed its query result is intentionally stale; the next integration must plan/execute the sequence coherently rather than silently discard checks. A local tag receipt is not proof of remote absence or of absence of an unreadable picture reference.

Lean GuardedMutation passed before implementation. Rust parses. Added tests cover immediate stale refusal without an edit, delayed owner approval becoming stale before execution, unsupported/recursive reads and bounds, and preserved removal classification. Cargo has not run because the parent owns the serialized compiler queue. Required commands:

```
cargo test -p avendb --test engine guarded_
cargo test -p avendb --test engine read_guard_
cargo test -p avendb --test vault_ops
```

One additive `Approval.guards` field updates normal approval constructors and the checkpoint-delivery constructor (empty checks there). No live account/store/app changes.

## Sequential continuation receipts

After a successful guarded mutation, the core refreshes the exact same queries
under the same Lab lock, returning `{value, guards, canContinue}`. Owner-approved
mutations do this only after challenge-bound revalidation and acceptance. A
refresh failure returns the accepted value plus `canContinue:false`; it never
claims that the accepted write was refused. The next step uses these receipts,
so its own preceding edits do not stale the plan, but intervening changes do.

`guardedPlan` preserves accepted results and stops on the first refusal, failed
refresh, or changed view/actor. It resolves creation references from underlying
accepted values. This is sequential and partially applied on failure, not atomic.
The public Story orchestration still needs its complete dependency domain wired
in; the helper alone does not close that task.

Validation: three Bun behavioral regressions (nine assertions) and the extended
Lean contract passed. Rust parses; new native continuation regression and previous
guard regressions remain pending the parent-owned compiler queue.

## Positive dependencies versus absence evidence

`read_guard.requireComplete` defaults to true. Explicit false captures positive
local dependencies without claiming the queried domain is complete. The mode is
retained in the receipt, delayed approval and post-write refresh; all reads still
use current canonical authorization and any changed result invalidates the plan.
Tag inventories always force strict mode, including if a caller tampers with a
receipt to request false. Negative picture-user decisions therefore cannot opt
out of completeness.

Private workflow plans use positive target/workflow/post inputs and avoid file
or profile materialization entirely. Public transitions additionally capture
strict complete dependencies before emitting any change. Selectively delegated
writers can make private transitions; selectively delegated public changes still
need evidence covering their actual negative-decision domain.

Validation: Lean dependency distinction proved; 47 Bun tests / 148 assertions
passed. Native selective-write/forced-strict-tag regression added, not yet run
because parent owns Cargo. Full Svelte typecheck passed: zero errors, 27 existing warnings.
