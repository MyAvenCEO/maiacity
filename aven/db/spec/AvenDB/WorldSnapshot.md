# Owned World JSON conversion outside the native Lab lock

The Node `world` operation first computes sync metadata, then constructs a complete
permission-filtered `World` and converts it to a JSON value. Previously both the
World construction and `World::to_json` ran inside `Shared::read`'s Lab mutex.
That JSON conversion walks owned views, formats IDs and allocates JSON maps/arrays;
it requires no live Lab data. This is not the later wire byte serialization.

`WorldSnapshot` privately retains the acting identity and the owned optional World.
The existing engine operation delegates to the same snapshot conversion, preserving
its JSON response, including `{ "ok": null }` when there is no world. Native Node
execution captures the snapshot through the same authoritative read, then converts
it on the blocking executor without holding the Lab mutex. A lifecycle ticket follows the snapshot-capture and conversion closures, so
abandoning their async caller cannot permit shutdown before those closures finish.
The earlier synced-to metadata traversal retains its existing cancellation behavior;
this change does not establish a new whole-operation fence for that traversal. No stale snapshot is reused for another request or identity.

A per-node owned async permit serializes world capture/conversion. It moves through
the same capture/encode closures and survives requester cancellation until actual
work ends. This bounds simultaneous materialized World/JSON pairs to one per node,
matching the former Lab-lock serialization. Targeted reads and mutations never
acquire this world-only permit; a queued world captures fresh state after release.

WorldSnapshot.lean describes frozen actor/view provenance and conversion identity.
It is not an extracted proof of the Rust JSON encoder. The deterministic native
regression pauses conversion, submits an authorized local mutation/read, and requires
that work to finish before conversion is released. The rendered snapshot must still
match the one taken before that mutation. It also checks null-world compatibility
and cancellation/shutdown ownership.

Scope: full World extraction, policy replay and synced-to traversal still hold the
Lab mutex. Native execution adds a blocking-task handoff and can therefore cost more
on tiny worlds. WASM still converts synchronously in its worker; releasing a mutex
alone does not establish worker responsiveness or fix browser latency. No overall
performance percentage, DOM latency, device latency or bandwidth claim follows.

## Validation

- Lean specification built first; final full build passed 81 jobs.
- With the same helper retaining the old under-Lab-lock encoder placement, the
  concurrency regression failed at the intended authorized-write/read assertion
  (2.26s total fixture runtime).
- Moving conversion out passed (1.22s). After adding the world-only memory bound,
  the final regression passed (1.39s), including pending second capture, fresh
  subsequent snapshot and cancellation/permit/shutdown ownership.
- Three existing lifecycle cancellation/finalization tests passed.
- Independent review approved snapshot/actor ownership, same conversion/null shape,
  ticket and permit transfer, lock ordering and documented scope limits.

Fixture runtime differences above are not performance benchmarks: the baseline
includes an intentional timeout. CI/platform acceptance remains separate.
