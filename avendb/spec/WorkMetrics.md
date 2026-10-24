# Startup work observation

`AvenDB/WorkMetrics.lean` specifies a read-only projection of recorded metrics. Reading it preserves the entire store and returns the same metrics on repetition. This is an observation contract, not a proof of startup speed or authorization correctness.

`Lab::work_metrics` implements the boundary by serializing only `Perf`'s accumulated timer and counter maps. It does not scan edits, calculate blob totals, or compute vouching. Full `Lab::perf` remains available for the richer diagnostic view.

The copied-store upgrade rehearsal previously called full `Lab::perf` two or three times per opening. A sample of the combined Mac rehearsal found that diagnostic read in `vouching → vouch → uncovered → policy::acting → resolve_at`. Consequently, a slow metric capture was itself performing policy work and delaying subsequent observations. The rehearsal now reads the bounded recorded maps and reuses the captured stored-view counter for its assertions. Its read can still wait for the node's Lab lock; `metric_capture_ms` retains that queue delay and must not be described as serialization time alone.

The core regression compares timer/count output to full diagnostics, repeats observations, and verifies unchanged history, policy and entry inventory. The existing copied-store inventory and cold/warm/recovery acceptance checks remain intact.

## Remaining startup work

This change removes diagnostic distortion; it does not accelerate production unlock. Warm restoration still reconstructs keys, bodies, schemas, shown records and upkeep. Further optimizations require phase measurements and unchanged authenticated results.

`avendb/Cargo.toml`'s `app` and `server` profiles inherit `release`; the PWA uses `release`. Their default debug assertions are disabled. `vault/Cargo.toml` separately controls the embedded Mac build. A native development profile can execute the full-replay `debug_assert!` inside `refresh`'s replay timer; an optimized `app` result cannot be blamed on that assertion. Verify each artifact's actual build invocation before attributing observed time to its profile.

No live store, installed application, PWA or hosted peer was changed to collect this slice's evidence. Physical-device latency acceptance remains separate.

The engine identity hashes all core source files, including this accessor. A rebuilt binary will therefore invalidate an older derived warm view once and reconstruct it from authoritative history. Same-binary second reopen is required to measure warm startup; do not compare the first upgrade open to a prior warm open.
