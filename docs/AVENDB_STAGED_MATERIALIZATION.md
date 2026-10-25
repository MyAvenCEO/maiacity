# Node-mode staged canonical materialization

Source candidate; Rust tests pending the coordinator's compiler slot. Lean contract
`AvenDB/StagedMaterialization.lean` passed. No deployment or latency claim.

`Node::restore` enables staging before restore. Standalone `Lab` defaults remain
synchronous. Warm receipt reuse still runs first. A cold ordinary, non-draft,
owner-authored MAIN entry exceeding 32 writes can retain an owned `History` and
`After` continuation instead of judging its entire history in one foreground turn.
Policy/schema/cap-group entries, shared/proposal histories, and incremental entries
retain their existing synchronous implementation.

The existing Node background pump advances one entry by at most 32 ordinary
`Judging::judge` calls, rotating between entries. At most four continuations have begun judgment;
other queued entries retain empty history shells and share their vault lane. Each call uses unchanged canonical
judgment. Intermediate state is never installed in `Shown`. Publication occurs
only after all selected writes are judged. Changed log identity, key generation,
warm generation, newly opened bodies, or explicit reshow cancels prior staging;
the continuation cannot expose old-authority reads.

Pending mutations return `Materializing` with `retryable: true`; no signed write is
committed. `get` and generic query first serve a currently authorized read-only
checkpoint when its attested basis is still withheld. Without such a projection,
`get` returns `Materializing` and the query reports an unresolved candidate.
The pending diagnostic is available only to a currently entitled recipient. Query readiness reports `materializing`, and scoped
inventory cannot claim local completeness while reconstruction is pending. Engine
steps and Lab draft construction both guard unfinished entries. Unrelated local
writes continue normally. Steward actions derived from counted history wait until
that entry finishes, then canonical refresh runs ordinary upkeep.

Regressions cover pending visibility, refusal without a new signed edit, one-turn
budget, unrelated write publication/invalidation, exact final record equality,
synchronous later local edits, key-generation cancellation, and lock disposal.

Remaining limits: final Loro construction/import, canonical replay, body decoding,
lane/group preparation and upkeep remain atomic. Generation-wide invalidation is
conservative: sustained unrelated revisions can restart cold reconstruction. This
slice does not claim universal starvation freedom or a wall-time bound. It does
not introduce a cache authority, discard signed history, or grant a hosted node
special privileges.

## Resumed source repair

The interrupted candidate had placed per-entry tip invalidation inside immutable
`steward`, where no tip exists. Invalidation now runs in mutable `show_items` after
computing the entry tip; `steward` only withholds marks for pending entries.
`StagedMaterialization` is imported by the aggregate Lean build. A new regression
keeps old canonical history staged while a newer owner-approved checkpoint is
available, checks read-only get/query visibility, and verifies mutation refusal.
The focused Rust filter is `staged_materialization`; its runtime result remains
pending the coordinator's exclusive compiler slot.
