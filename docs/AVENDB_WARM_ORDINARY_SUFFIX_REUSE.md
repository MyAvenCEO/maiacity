# Conservative own warm receipt reuse after an ordinary suffix

Previously any extra held log edit rejected all deferred materialization from
an otherwise valid encrypted own receipt. This restored every covered entry's
historical bodies even when only one unrelated ordinary document changed.

The new path is called only after the existing encrypted shelf and
`Replay::from_view` checks authenticate an exact ordered log prefix. The adjunct
hash must match exactly that prefix. Its suffix must contain only existing-entry
MAIN writes targeting entries fully covered by ordinary authenticated receipt
metadata. New entries, other action kinds, schema/lens/cap-group entries,
uncovered entries and suffixes exceeding the existing 8192-write bound reject
reuse. Every touched entry is excluded and reconstructs canonically.

Untouched entries still pass current envelope-key checks and final canonical
shown fingerprint, exact entry-history and lane/group checks. Ordinary policy
replay, signatures, write admission and upkeep still run. Any new upkeep edit
changes the log revision and invalidates the retained metadata before exposure.
No receipt from a peer is accepted by this path and no persisted format changes.

Lean sufficient-gate invariants passed. Rust parses and diff checks passed.
Regressions added/updated cover: one ordinary suffix with untouched bodies still
lazy and canonical output equality; reordered/corrupt prefix; schema changes;
nonordinary action classification; real share/revocation/key rotation fallback;
and a tampered signed suffix compared with ordinary canonical restore.
Rust execution is pending the shared compiler owner; no Cargo run here.

Limits remain: live post-unlock log changes still conservatively invalidate all
deferred bodies; ordinary changes to uncovered entries still rebuild; captures
remain bounded to256 entries/8192 writes; this does not claim constant-time
restore, skip governance replay, or solve general incremental materialization.
