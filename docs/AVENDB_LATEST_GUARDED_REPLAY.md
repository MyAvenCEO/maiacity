# Guarded lazy authorization replay

`Lab::latest` previously rebuilt policy from the entire held log when deferred receive invalidated its latest state. It now advances a clone of the maintained replay prefix with the same `replay_on_why` used by refresh. Safe write/tail cases reuse policy work; removals, checkpoints and historical dependencies retain canonical full replay fallback. No stale prefix state is served. Existing latest/Answers invalidation remains unchanged; withdrawal resets the replay prefix and restore replaces the Store.

The Lean wrapper states guarded-equivalence and fallback obligations, relying on existing StoredView V1/V3/V4 contracts. Native differential tests compare deferred states and permission selections with full `log.view` and `answer_ids`, including revocation, checkpoint receipt, late parents, trust withdrawal and restore. The withdrawal fixture invokes the real trust path on a bare receipt that no longer has a valid signature or standing voucher. Existing replay and request-basis regressions remain required, including checkpoint/withdrawal coverage.

The new standalone Lean wrapper passed. All four new native tests passed after correcting checkpoint fixture signing (43.80 seconds total); all five existing request-basis tests passed (44.21 seconds). Scoped-reply and checkpoint integration suites remain explicitly pending the combined PR CI; no duplicate local normal-library build was started. Independent source review found no blocking issue. This is not an out-of-lock authorization pipeline: cloning Replay still copies history and safe fallback can still replay under Lab. No physical latency claim, new authorization cache, or changes to Mac artifacts are included.

The cached latest State does not advance Store.replay itself; consecutive deferred batches still start from the maintained materialization prefix. This slice deliberately leaves that ownership unchanged.

## Initial local evidence (2026-10-24)

The first native run passed deferred writes/revocation, historical-parent/restore, and real trust withdrawal. The checkpoint fixture initially requested a governing action with only the device key and correctly failed `BelowThreshold`; its setup was corrected to the account passkey and is being revalidated. This is a fixture setup failure, not a weakened permission rule.

Supplementary eight-iteration CPU comparison, default optimized test profile, on the same small fixture history:

| Case | Full log view | Guarded replay including clone |
| --- | --- | --- |
| Deferred writes (44 held, 42 prefix) | 5.697 ms | 0.690 ms |
| Revocation fallback (47 held, 44 prefix) | 8.571 ms | 9.142 ms |

The safe path avoided full policy reconstruction; fallback cost slightly increased (about 0.071 ms per call here). `Replay` owns edit/ID vectors and its clone is not constant cost. The fallback additionally derives IDs where `Log::view` already owns them. These tiny-fixture timings are not a representative-store or physical-device performance claim. Preserve this tradeoff when evaluating larger copied stores.

The successful rerun measured eight deferred-write iterations at 5.693 ms full versus 0.504 ms guarded; revocation fallback was 26.164 versus 29.807 ms under variable local load. The fallback overhead is retained transparently; this change optimizes eligible continuation, not mandatory full replay.

Exact local commands: `lean AvenDB/LatestReplay.lean` from `avendb/spec`; `cargo test -p avendb --lib latest_replay_tests -- --test-threads=1 --nocapture`; `cargo test -p avendb --lib request_basis_tests -- --test-threads=1`. Cargo used one job and the existing `/private/tmp/avendb-aip33-target` default test profile. Required remote gates include `tests/scoped_reply.rs` and `tests/checkpoint.rs`, plus the full existing core policy suite. No shipped WASM or native app binary has been regenerated for this commit.
