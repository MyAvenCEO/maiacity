# Local accepted writes and targeted subscriptions

This fixture compiles the real Svelte session, Chat, Composer and a non-chat `get`
subscriber. Only the worker/device/passkey boundary is synthetic. It uses no live
account or filesystem store and blocks external network requests.

The contract applies to the generic avenDB session API:

1. Ordinary `insert`/`set` entry changes do not await peer catch-up. Explicitly
   head-conditional actions retain their bounded freshness guard, and the engine
   still validates every operation. `LocalWrite.lean` specifies this branch.
2. `session.run`/`runAll` return the engine's accepted result independently of
   full-world summary refresh. They do not report success for refused operations.
   The test holds every world read indefinitely, sends a real Composer message,
   observes its authorized read in the DOM and the cleared composer, then performs
   a non-chat `set` and observes its `get` result before releasing the world.
3. `session.observe(query, take, failed)` and `session.api.observe` subscribe to
   targeted local reads. Revisions coalesce; each completed authorized answer may
   publish. Query/owner/context replacement and disposal abort their scopes and
   discard old answers. A new query does not wait behind an old unresolved query.
4. A remote-accepted data change invalidates the targeted view without awaiting
   the full-world refresh/backoff. The fixture injects an accepted local replica
   change; it does **not** test actual peer transport latency.
5. An engine refusal leaves the draft intact, reports the refusal and renders no
   fabricated message. World reads are single-flight per device; explicit refresh
   cannot join a snapshot started before its call. A held read and queued refresh
   verify maximum concurrency one and the newer returned marker. Locking the
   device rejects its blocked explicit barrier before the held read is released.

`api.refresh()` remains an explicit barrier for code whose **next operation**
needs the updated world. The vault-creation/public-name-sharing and missing-schema
artifact flows use it. Generic write completion is local acceptance, not completion
of a whole-world UI redraw, peer acknowledgement, or a new fsync guarantee.

Run `bun scripts/test-avendb-local-write.mjs --browser chromium` or `--browser
webkit`; both run in kernel CI. Unit tests are `local-write.test.js` and
`reactive-read.test.js`. Lean checks are in `avendb/spec/AvenDB/LocalWrite.lean`.
The Lean model covers scheduling branch/acceptance independence only, not
extracted JavaScript, Svelte, OS timing, engine authorization or durability.

## Remaining limits

These tests prove a removed scheduling dependency, not a physical-device <50ms
p95. Native Lab lock contention, crypto/replay and already-running world queries
can still delay an engine read/write. Older world-only views still wait for their
summary to materialize; migrate their active queries to the shared observer as
needed. The device's existing changed(edits,keys) long poll cannot identify a
same-count revision replacement; this patch does not repair that engine API edge
case. Real peer transport under bulk load and Mac/iOS/iPad timings remain separate
acceptance work. No browser harness duration is claimed as network throughput or
physical local-commit latency.
