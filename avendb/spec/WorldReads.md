# Single-flight world summaries with explicit freshness barriers

## Problem and contract

The local-write fix separates authoritative targeted reads from whole-world
rendering. Its background watcher and post-write summary requester could still
start two expensive `world` operations on the same device. Both can contend for
the same native Lab lock; publication ordering alone did not avoid that work.

`WorldReads.lean` was written and checked **before** this followup implementation.
The model proves that an active read cannot start another, tickets already
requested can coalesce, and a ticket created after a snapshot started cannot be
satisfied by that snapshot. It models scheduling, not extracted JavaScript,
underlying engine snapshot correctness, storage durability or elapsed time.

`src/lib/avendb/world-reader.js` captures one batch before invoking read. Later
requests share one pending batch/promise, which starts only after the active read
ends. Explicit refresh is a request in the same scheduler, so it never joins a
pre-call snapshot. Read or publication failure rejects its captured batch; later
requests remain free to retry. Requests made from publication callbacks are not
lost. The scheduler owns at most one active and one pending batch; arbitrary
external caller continuations are not claimed to have constant total memory.

`session.svelte.js` routes automatic watches, post-write summaries, and explicit
`api.refresh()` through that same per-device reader. The watch captures its device
and suppresses late errors after replacement. Retirement is terminal per device
object (WeakSet plus cancelled reader): active and pending promises reject
immediately, including when the underlying operation never returns; late results
cannot publish or restart work. Native work already submitted is not forcibly
cancelled. A newly opened device object receives its own scheduler.

## Evidence

- Eight unit regressions / 121 assertions: single-flight, explicit freshness,
  coalescing, read failure/retry, publication-time requests, publication refusal,
  prompt active/pending cancellation, late replies, shared pending promise,
  retirement before first request.
- Actual Svelte Session/Chat/non-chat browser fixture in Chromium and WebKit:
  local accepted operations and targeted views still work while world is held;
  maximum active world operations is one; a later explicit refresh stays pending
  until its new snapshot runs and returns the new marker; locking the device
  rejects its explicit barrier **before** releasing the held engine read.
- Independent source review checked ownership retirement before reader creation,
  no stale publisher, failure propagation and post-call snapshot freshness.

Full final Svelte/Lean results and implementation commit are recorded in the
maintained handoff. No live store, permission, identity or peer-role policy changes.
This removes redundant whole-world work; actual native execution latency and
legacy world-only view rendering remain empirical performance acceptance tasks.
