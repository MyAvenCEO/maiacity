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
  change invalidates the view, and an explicit refresh cannot join a held older
  summary (single-flight followup: `WorldReads.md`). See `scripts/fixtures/local-write/CONTRACT.md`.
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

## Pending writes and writes first (batch 5: F4, W1, W2, W3)

The 27 Oct iPhone round measured writes at 1.9 s (insert p50 1,918 ms). A write went into the Lab's one queue as
a foreground turn, behind up to 32 waiting page reads (the observers re-reading after each change, the world
summary) and between catch-up turns; the page drew it only after the engine answered and a read came back.

- `LocalWrite.lean`, pending writes: what a page shows is the device's answer with its pending writes laid over,
  oldest first (`shown`). A new write is one step over what is shown (`shown_append`, `insert_painted`); a refusal
  shows exactly what was shown before the write (`refused_leaves_no_trace`); an accepted write the answer holds
  changes nothing when laid over (`insert_held_is_noop`, `set_held_is_noop`), so dropping it keeps the view
  (`reconciled_drop_keeps_shown`). `src/lib/avendb/pending-writes.js` follows it and replays
  `vectors/local_writes.json`; the session's `run`/`runAll` add each `insert`/`set` before the device answers, and
  `overlay(entry, record, mark)` lays them over (Chat does). An accepted write goes once a read asked after its
  acceptance answers for its entry (or the world summary, for entries no observer reads).
- `Writes.lean`, `Turns`: a person's write is a class of its own, granted before every waiting read and background
  turn (`pick_write_first`, `write_granted_in_order`); with no write waiting the old three-reads-then-background rule
  holds (`pick_without_writes`); with each turn at most `T`, a write is applied within `(k + 2) * T`
  (`write_wait_bound`). avendb-net's `lab_schedule.rs` has `Class::Write`, used by `Node::try_act`; its tests replay the
  vectors' turn orders.

Measured (this container, 2026-10-27): a write behind a 20 ms catch-up slice and 32 queued 20 ms reads was applied
p50 31 ms, p95 37 ms behind (769 ms with writes as foreground); `scale_turns.rs` at 130,181 edits: a write's own turn
at most 22.9 ms during a catch-up, catch-up steps at most 34.6 ms (one first-sync step took 24.1 s, outside this
lane). Chromium fixture (`--paint`), the device taking 1.9 s a write: 40 messages each in the page p50 4.4 ms, p95
8.5 ms, every one in the first frame after its key; a refused one rolled back with its draft. WebKit could not be
installed here; it runs in kernel CI. No device numbers yet.
