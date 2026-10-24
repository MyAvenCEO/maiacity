# Receive signature preparation

Status: focused implementation; core/cooperative/Lean checks passed previously; combined native integration and actual browser validation pending. This is one bounded interaction-responsiveness improvement, not completion of the overall latency work.

## Blocking operation and change

A legacy sync reply previously called `Lab::receive_whose_now` while holding the same Lab mutex used by generic `Node::read` and `Node::try_act`. Cryptographic signature verification was part of that protected interval. A large incoming page could therefore delay unrelated local operations even though its signatures depend only on immutable incoming bytes.

Native legacy-page ingestion now captures an opaque `ReceivePreparation` under the Lab lock, performs signature verification on a blocking worker without that lock, and commits the resulting opaque `PreparedReceive` through ordinary current-state admission. The token owns its original signed edits and keeps its fields private. Only the first occurrence of an unknown edit is prepared, matching existing duplicate semantics. Checkpoint-covered edits retain the existing whole-page treatment.

The commit still recalculates duplicates and checkpoint coverage and applies the current admission gate. Preparation contains no cached authorization. If a restore or checkpoint withdrawal means a previously skipped signature now needs checking, it uses the ordinary verifier. No signatures, permissions, policy checks, or durable storage requirements are removed. Every native node follows the same path.

A separate FIFO async mutex admits only one prepared-page signature checker per node without holding the interactive Lab mutex. This avoids multiplying the existing per-page CPU parallelism by every active prepared peer pull. Both legacy and range-transfer ingestion use it; other operations can still perform signature work independently.

The page budget and lifecycle admission tickets move through both blocking workers and remain owned until those workers finish, even if their async caller is cancelled. They remain held through commit. Shutdown must not treat detached signature work as complete prematurely.

## Specification and focused evidence

`avendb/spec/AvenDB/PreparedReceive.lean` specifies that prepared signature answers must equal verification for the same immutable input and never replace current gate admission. It explicitly assumes the cryptographic verifier and Rust ownership boundary; it is not an extracted proof of Rust or a wall-clock latency guarantee. The proof passed before implementation.

The core differential regressions passed three tests, covering:

- Ordinary versus prepared reception, including invalid-first duplicate signatures.
- A restore between capture and commit, requiring fallback verification.
- A gate change after capture, still refusing a newcomer without current admission.
- Whole-page checkpoint coverage and withdrawal before commit, refusing an uncovered bare edit.

A local optimized test-profile workload of 54 ML-signed edits measured:

| Phase | Time |
| --- | ---: |
| Original protected receive | 3.576 ms |
| Prepared capture under lock | 0.161 ms |
| Signature verification outside lock | 2.582 ms |
| Prepared commit under lock | 0.489 ms |
| Capture + commit protected time | 0.650 ms |

These are one synthetic run's operation timings, not an end-to-end device benchmark or a throughput claim. `Perf` retains the moved work separately as `prepared signature check` and `prepared signatures`; the CPU cost is not hidden by the shorter protected interval.

The native integration regression deliberately holds the actual signature worker, requires generic reads and mutations to complete while it is held, and checks page-budget/shutdown ownership after cancellation. Its result must be recorded before this slice is marked done.

## Cooperative browser implementation — validation pending

The browser uses the same owned preparation and whole-page admission. `check_cooperatively` checks at most eight signed edits per turn and yields between unfinished groups. The production WASM caller uses `n0_future::time::sleep(Duration::ZERO)`, whose browser implementation waits for a `setTimeout` callback, allowing worker messages to run. A completed token is returned only after all selected signatures have been checked. Cancellation discards the uncommitted preparation. The FIFO checker prevents several pages each doing a full group during the same turn.

`AvenDB/CooperativeReceive.lean` proves the eight-edit step bound and that an incomplete cursor cannot commit; this proof passed before implementation. The combined core regression passed, including cooperative stepping parity and the eight-signature turn count. Actual browser-worker execution remains pending. One signature check is indivisible, so eight edits is not a wall-clock guarantee.

## Remaining work

The range-transfer receive path now uses the same preparation helper. Its opaque caller context carries both range admission and the accepted-count owner through capture, detached checking, and commit. Cancellation during preparation cannot publish a premature count or release range admission while its worker still runs; only actual commitment increments accepted edits. A held-checker regression is added, with combined validation pending. Current-state gate/replay work, page hashing/capture, and commit still require the mutex; large individual operations can still delay interaction. It does not establish the requested sub-50 ms local UI target, remote live-entry latency, or bandwidth saturation. Production rollout and physical-device measurements remain separate acceptance tasks.

Follow-up implementation boundaries:

1. Validate cooperative verification with the actual compiled WASM in a browser worker: queued messages must run during verification, and final admission must match the ordinary path. Do not split raw incoming pages at the receive boundary: checkpoint coverage and gate admission depend on the whole batch.
2. Validate the range-transfer extension with its real-protocol authority/revocation, fallback, and accepted-count cancellation regressions. The new `cancelled_range_signature_check_retains_admission_and_count_until_worker_exits` additionally holds the actual checker and tests ownership after cancellation.
3. Capture and commit measurements must be repeated with larger existing histories, mixed signatures, and concurrent real local writes. Remaining current-state replay/gate costs need their own measured optimization; this signature slice does not bound those costs.

## Reproduce

From `avendb/spec`, run `lake env lean AvenDB/PreparedReceive.lean`. From `avendb`, run:

```sh
cargo test -p avendb --lib prepared_receive_tests -- --nocapture
cargo test -p avendb-net --lib prepared_page_allows_generic_access_and_keeps_cancelled_work_admitted -- --nocapture
```

The first command prints protected/capture/check/commit timings and checks state equivalence; the second exercises the real native helper with a test-only blocking hook. Neither command uses a live account or persistent application store.

## Combined-source core validation — 24 October 2026

On the combined performance branch, all three `prepared_receive_tests` passed, including whole-page checkpoint coverage, current admission after preparation, and cooperative signature-result equivalence. In this synthetic 54-edit run, baseline protected work was 7.463 ms; capture was 0.426 ms, verification outside the lock 5.764 ms, and commit 1.188 ms, for 1.613 ms total protected work. These are operation measurements, not physical-device or end-to-end latency. History (6 tests) and document (20 tests) regressions also passed on the same compiled core. Network cancellation/interaction and compiled-browser acceptance remain separate pending gates.
