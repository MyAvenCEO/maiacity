# Legacy reply-pipeline measurement correspondence

`AvenDB/TransferAccounting.lean` was checked before the Rust timer change. It models monotone ticks and proves that adjacent intervals partition elapsed time, and that starting after first arrival omits the first wait. It does not prove Rust execution, scheduler timing, transport delivery or storage durability.

The Rust mapping is `Shared::pages` in `avendb-net/src/lib.rs`: `since` precedes the first `ask`; each `finished` marks the completed processing/lookahead join and becomes the next interval's start. Integer milliseconds truncate each interval (less than one millisecond per interval); the Lean identity is over unrounded ticks. Request planning precedes this clock. Keys and sparse range transfers are measured separately or not yet covered.

`pulls::tests::first_page_service_time_includes_initial_admission_wait` holds a real receiver's page permits while a direct authenticated peer exchange starts. After observing request planning, it waits 250 ms before releasing admission. The single-page report must include the complete first request duration. It changes no live store and uses no server, relay or external bandwidth test.

The existing Traffic aggregation regression checks compatible JSON rates, route counts and bounded recent samples. JSON field names stay unchanged. `bytes_per_s` and `edits_per_s` are legacy reply bytes and offered edits per summed pipeline service second. Concurrent pulls may overlap, so neither per-peer nor combined rate is device wall-clock bandwidth. `wait_ms` includes admission, encoding and decoding. `take_ms` includes validation and paced upkeep, with overlapping lookahead. Offered minus newly accepted includes rejected offers and must not be called duplicates.

Limits still open: accounting for failed/cancelled attempts and sparse transfers; useful accepted bytes; transport framing; admission versus network versus decode separation; lock/replay/durability/visible-completion phases; one contemporaneous wall-clock measurement window. No throughput improvement follows from correcting the counter.

## Validation (23 October 2026)

- Focused Lean file passed before implementation; full `lake build` passed 70 jobs and `lake exe vectors` left checked-in vectors unchanged.
- Svelte compiler accepted `Performance.svelte` with zero warnings.
- Real first-page regression passed (7.01 s); existing Traffic aggregation/ring-buffer regression passed (0.01 s).
- Negative control: restoring only the old first-clock placement made the real regression fail as intended: one 77-byte reply reported 335 ms request elapsed but zero pipeline milliseconds. The fixed clock placement was restored afterwards, and the real regression passed again (8.24 s; rebuild 1m52s).

Rust command from `avendb`: `CARGO_TARGET_DIR=/private/tmp/avendb-m4-m7-target CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=1 RUST_MIN_STACK=8388608 cargo test --profile app --locked --offline -p avendb-net --lib first_page_service_time_includes_initial_admission_wait -- --nocapture --test-threads=1`. Run the same command with filter `traffic::tests` for counter compatibility. The temporary target path is optional; it is not fixture data or a required machine-specific dependency.
