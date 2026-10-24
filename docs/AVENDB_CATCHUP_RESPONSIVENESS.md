# Catch-up admission responsiveness

Work branch: `codex/catchup-responsiveness`, based on `77e2eb81`. No changes to release PR1268, live stores, or deployment.

## Root cause and change

Native `try_lab` and `read` previously dispatched arbitrary blocking tasks directly at a standard mutex. Queued history admission/materialization could win that mutex ahead of an interactive read or mutation; there was no foreground fairness contract. In WASM the same immediately-ready futures could chain without letting the worker process new page messages.

`lab_schedule.rs` now admits one asynchronous Lab operation at a time before native dispatch. Local reads/mutations and live-edit pulls use the foreground FIFO; ordinary history request preparation, signed-page admission and catch-up use the background FIFO. A waiting background operation is granted after at most three additional foreground operations. Each class has separate bounded admitted slots (32 foreground, 16 background), including queued and active work. Excess callers wait for their class's slot without adding scheduler records. Cancellation removes queued records and releases their slots; an active turn belongs to the actual blocking closure until it exits, even if its caller was cancelled.

Browser background operations additionally await a real zero-delay timer before enqueueing, allowing pending worker messages to register foreground work. This is an event-loop boundary, not an assumption that a ready promise yields. Catch-up cooldown now measures actual core execution after admission, excluding queue wait; foreground priority cannot amplify waiting into an additional background-sync delay. All classes execute the unchanged core closures; priority grants no access and changes no validation, durability, or replay rule.

## Explicit limits

This bounds queued overtaking and concurrent background Lab execution. It cannot preempt a single `Lab::refresh`, cryptographic operation or large query once that operation owns the Lab. Core refresh still performs replay, keys, reads, shown histories and upkeep atomically; splitting those phases requires a separate policy/publication design to prevent stale access. Direct synchronous saver lock access remains outside this asynchronous scheduler: `edits.rs` uses it for due-edit capture, warm capture and warm acknowledgement; `signers.rs` uses it for signer capture, acknowledgement and durable-root signing. Those operations can still delay an admitted foreground operation. Snapshot encoding is already outside the Lab lock; capture itself is not preemptible. This change alone is not a claim of sub-50ms latency or bandwidth-limited sync.

Warm derived-state reuse and authenticated scoped bootstrap are separate coordinated branches. This lane deliberately leaves their core replay/materialization APIs intact.

## Validation

- Lean `LabScheduling.lean`: priority preserves operation/result; background receives a turn after the bounded foreground burst. Assumes running operations finish, as any non-preemptive scheduler must.
- Unit regressions: foreground overtakes queued history; background cannot starve; queued cancellation does not leak slots or records; cancellation after grant advances service.
- Real Node regression: hold a background closure, queue eight catch-up operations and a foreground read plus ordinary document creation, release the closure; both foreground operations execute before the whole queued history finishes, then all eight background operations finish and the created document remains readable.
- Timer source audit: the locked `n0-future` 0.3.2 `src/time.rs` WASM `sleep_impl` always registers `globalThis.setTimeout`, including duration zero. `Sleep::poll` waits on the callback flag; it does not return ready by comparing an elapsed deadline. Therefore this boundary cannot collapse into an immediately-ready future. This is source evidence, not a physical iPhone timing measurement.
- Earlier scheduler build compiled. The foreground ordering regression passed. The actual Node regression passed in 7.21 seconds with loopback access; it verifies foreground read/create before eight queued history operations, all history progress, and cancelled-caller ownership through actual blocking completion.
- The cancellation stress fixture previously exhausted Tokio's cooperative budget while polling 1,000 cancelled futures; it now asserts actual queue insertion and yields between iterations. This correction and the cooldown measurement change still require final exact-source combined validation. Source presence is not acceptance.
- Lean scheduling and queue-wait-independent cooldown contracts pass. The timing contract models execution cost separately; it is not a wall-clock latency bound.
- Final validation is owned by the coordinator after integrating the three isolated branches into one checkout, avoiding repeated dependency compilation for different source paths. No physical iPhone/iPad timings claimed.

## Manifest execution priority follow-up

The page planner previously sent early priority hints but then awaited one combined query across every priority rank before requesting even known explicit entries. This made a slow low-priority collection a prerequisite for a high-priority view. Execution now requests each rank's explicit IDs first, queries only that rank, follows its declared dependencies, then advances to the next rank. Cancellation after an in-flight dependency read is checked before initiating a broad file scan; cancellation is not swallowed as a missing-record result.

Lean `ViewDemand.explicit_prefix_before_discovery` specifies the ordering contract before implementation. Its proof passes; 18 manifest regressions (124 assertions) pass, including withheld query results, high-rank dependencies before low-rank queries, and cancellation during a reference read. These are execution-order/cancellation guarantees, not first-render timings or completeness proofs.

Remaining limits: an `aven:` file-root reference still resolves through the existing world file inventory; a scoped authorized root-to-entry query is needed to remove that broad dependency safely. Individual native refresh/query operations remain atomic. Writable partial bootstrap remains guarded: it requires validated causal ancestry/frontier, authorization evidence at the accepted state, safe concurrent-write reconciliation and durable adoption before lifting read-only restrictions. This slice changes no write guards or authorization. Final integrated scheduler cancellation validation remains coordinator-owned in the shared compiler queue.
