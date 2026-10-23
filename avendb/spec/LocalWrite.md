# Local-write scheduling and reactive reads

`AvenDB/LocalWrite.lean` specifies the foreground freshness branch and local
acceptance/summary independence. The first five lemmas were checked before the
foreground gate was changed. The accepted-result model was added while extending
the slice to generic completion and subscriptions; it is not a proof extracted
from JavaScript or the Rust engine.

## Correspondence

- `waitsForPeer` maps to `src/lib/avendb/local-write.js`: only an entry operation
  carrying explicit heads while behind enters the bounded foreground bring.
  `ordinary_is_local`, `caught_up_is_local`, `creation_is_local`,
  `conditional_behind_still_waits`, and `ordinary_peer_independent` preserve the
  guarded-review behavior while allowing ordinary insert/set through immediately.
- `acceptedResult`, `refusal_never_succeeds`, and
  `acceptance_independent_of_summary` describe generic session run/runAll
  completion: return the engine result without waiting for world redraw. They
  assume engine authorization and acceptance, which this patch does not alter.
- `local-write.test.js` tests the gate with a never-answering peer, unchanged and
  changed guarded reviews, and deadline cleanup.
- `reactive-read.test.js` tests generic scoped query coalescing, completed-answer
  progress during repeated invalidations, owner/context/query cancellation,
  A→B→A isolation, disposal, refusal/errors and mutation rejection before any
  device invocation. One request at a time per scope; new scopes do not wait
  behind unresolved old scopes. Native work already submitted may finish.
- `scripts/test-avendb-local-write.mjs` compiles actual Svelte Session, Chat,
  Composer and a non-chat subscriber with only the device/passkey boundary
  synthetic. Full-world reads and peer bring are held; real insert/set run calls
  complete, authorized reads render, refusal preserves the draft, a replica
  change invalidates the view, and an older summary cannot overwrite a newer
  explicit refresh. See `scripts/fixtures/local-write/CONTRACT.md`.
- Explicit summary barriers remain at NewVaults (new IDs needed for name sharing)
  and Artifact (new schema needed for the next operation), identified in the
  independent caller audit. Other audited callers use result IDs/direct reads
  or do not require the next operation to consume an updated summary.

## Validation and limits

Full `lake build`: 75 jobs pass; generated vectors unchanged. Focused JS:
15 tests, 49 assertions pass (gate + reactive read + existing latest tests).
Chromium and WebKit real component fixtures pass, including the final read-only
observer guard. Full Svelte check passes with zero errors and 18 pre-existing
warnings across eight files. The existing Chromium session lifecycle fixture also
passes: view teardown/remount preserves the exact device, and a new document
remains locked. These results precede deployment and physical-device acceptance.

This removes proven scheduling dependencies, not every possible latency source.
No physical-device p95, durable fsync, cryptographic speedup, end-to-end remote
latency, or total M3–M7 completion is claimed. Native Lab contention and already
running world materialization can delay targeted work. Legacy world-only views
still depend on world rendering; further shared-observer adoption is needed.
The existing changed(edits,keys) API cannot identify a same-count revision
replacement; fixing that lower-level API remains separate. Local completion
retains the engine's existing durability semantics, rather than inventing a new
persistence receipt. Server/peer privileges, storage layout and identities are
unchanged.
