# Native shutdown ownership correspondence

`AvenDB/ShutdownOwnership.lean` models the ownership boundary of the existing native shutdown repair. It was added **after** the Rust implementation and its five passing regressions. This is neither Lean-first development nor Rust extraction, and it does not prove Tauri event delivery or filesystem persistence.

The model distinguishes:

- `phase`: running, admission closing, failed close, all stores fenced, runtime stopped;
- `active`: admitted work which can still produce mutations or a new Node, rather than a literal count of Rust mutex holders;
- `required`: Nodes whose persistence obligation has not been successfully fenced;
- `retained`: the corresponding owning references, including unpublished startup Nodes;
- `provisional`: unpublished bookkeeping, whose transfer does not discharge a fence;
- `waiters`: observers of shutdown, which do not own its completion task or runtime stop signal.

The abstract `fence` event requires global producer quiescence. Actual per-Node fences may interleave; the model conservatively represents their successful release at the aggregate quiescent boundary. It is not a full interleaving model of every running-host operation. In particular, cleanup-only constructor continuations may retain a lifecycle mutex after their last producing action; they are no longer `active` in this abstraction. Failed cleanup before Host close preserves ownership and is a stuttering observation here, not a successful fence.

`Safe` is preserved by every modeled transition and therefore every reachable state. An outstanding obligation always retains an owner and its runtime. Runtime release requires the aggregate fenced state, zero admitted work, and no outstanding owner obligations. Closing admission, a diagnostic timeout, an empty waiter list, or one child's successful fence cannot establish that condition. A failed close remains terminal and retains ownership across subsequent observations.

## Runtime correspondence and existing regression evidence

All paths below are relative to `avendb/`. The five tests passed in the focused native run recorded at `/private/tmp/avendb-native-shutdown-final-tests.log`; this document does not claim they exhaust all possible schedules.

| Existing Rust regression | Abstract property | What the Rust test additionally checks |
| --- | --- | --- |
| `crates/avendb-device/tests/device/shutdown.rs::delayed_admitted_write_survives_five_seconds_and_cancelled_quit_waiter` | `cancelled_waiter_keeps_obligations`, `begin_close_preserves_debt`, `runtime_release_requires_all_fences` | Uses the app's actual `RuntimeStop`; blocks an admitted mutation beyond five seconds, cancels both mutation/quit waiters, then reads the persisted record using the same identity after shutting down all fixture peers. Byte persistence and offline reopening are runtime evidence, not Lean theorems. |
| `.../shutdown.rs::failed_host_close_reports_same_error_and_keeps_runtime_and_writer` | `failed_step_retains`, `failed_runtime_alive`, `unfinished_owner_retained` | Injects a real disposable storage failure, checks the cached error, unsent quit signal, refusal of reopening and retained writer exclusion. Exact error caching and OS locks are not modeled. |
| `.../shutdown.rs::quitting_cancels_second_ceremony_and_drains_unpublished_store` | `capture_while_closing`, `finishing_work_keeps_owner`, `publication_keeps_obligations`, `runtime_release_requires_all_fences` | Waits for the second ceremony after Node spawn, queues another open, cancels by quitting, and verifies the store is released before runtime quit. A late genuine answer cannot resurrect startup. Ceremony cryptography is unchanged and outside this model. |
| `crates/avendb-device/src/shutdown_tests.rs::open_queued_before_close_rechecks_admission_after_lifecycle_mutex` | `admit_requires_open` | Polls open behind the actual lifecycle mutex before close, then verifies it cannot start a ceremony after acquiring that mutex. The model assumes the corresponding atomic admission boundary. |
| `.../shutdown_tests.rs::failed_provisional_save_retains_owner_after_constructor_and_host_close_fail` | `unfinished_owner_retained`, `failed_step_retains`, `publication_keeps_obligations` | Exercises the actual `Start.on_node` observer, drops constructor-owned references after a failed final save, and checks the Service registry alone retains the failed provisional owner and writer. |

`Service.start` supplies the synchronous `Start.on_node` observer; `Device::spawn` calls it before its next await. `Service.opened` / drive hosting transfer registry ownership after publication. `Host.close` owns one close task independently of callers; pending ceremonies are cancelled before waiting for the lifecycle boundary. `Drives.close_one` removes a hosted owner only after successful Node shutdown. `RuntimeStop.finish` keeps the quit sender in app state while waiting and sends it only after successful Host close. The Tauri wrapper retains `Hosted` on error.

## Explicit assumptions and limits

The proof assumes the Rust gates serialize admission; no mutating producer is omitted; Node identities are not reused within a host; capture happens before a startup suspension; a retained Node owns its writer; and the abstract successful fence really corresponds to quiescence, authoritative save and storage fencing. It assumes the app itself keeps the runtime stop sender and host alive through this protocol. Those are refinement obligations, not conclusions about Rust source.

There is no liveness/deadline theorem, crash/power-loss model, user-forced exit guarantee, extraction of Rust, proof of Tokio/Tauri scheduling, proof of fsync or cryptographic change. Existing `BatchDurability` concerns signed-root publication receipts, and `StoredView` concerns replay semantics; neither proves this native lifecycle. A failed close deliberately retains ownership and does not authorize a fresh writer.

Focused check, from `avendb/spec`:

```sh
lake env lean AvenDB/ShutdownOwnership.lean
```

The aggregate `AvenDB.lean` import and the project task ledger are intentionally left for the integrating owner.
