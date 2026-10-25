# Settled owner content writes

The previous local edit path always refreshed the whole held world: key-index
construction, opening key boxes, reconstructing every body’s metadata, rebuilding
cap-group judgments, then walking every entry’s history for key/steward upkeep.
The changed entry already had incremental judgment, but that did not remove the
world-wide work around it.

The new guarded path handles an existing ordinary entry’s main-line content edit
by its vault owner after the store is fully caught up. Signature validation and
canonical policy replay still run. Only a strict canonical tail append qualifies.
The new body's metadata is installed, and the existing per-entry judgment is
resumed using the unchanged current lane and cap groups. The whole-world key,
metadata, cap-group and upkeep passes are omitted because this edit changes none
of their inputs. Current actor authority is checked; no peer is privileged.

Creation, histories containing shared-actor writes or proposals, new files, tags, answers to tag requests, headers,
cap-group definitions, governance, pending policy, deferred bodies, and checkpoint
overlays use the existing full path. Snapshot-derived partial writes are not
silently treated as complete. A fallback after replay marks all shown state for
rechecking. Scratch retention remains bounded. The current entry key must already be held. Any computed post-write stewardship
mark falls back to full refresh.

Remaining costs: signing/encryption and canonical replay, State cloning, one
schema-lane metadata scan, and the target entry's incremental judgment/history.
This is not a claim that every write or phone paint meets 100 ms; creation and
partial-bootstrap writes need separate optimization and physical measurements.

Lean ContentRefresh proves context reuse preserves judgment given equality of
its dependencies; Rust guards and differential regressions establish the modeled
premises for this implementation. The proof alone is not an implementation or
latency proof. Three focused Rust regressions passed: 96 unrelated entries
with eight exact canonical comparisons, pending-policy/metadata guards, and
foreign-history/new-file/missing-key fallback. Eight signed owner edits took
40.956 ms total; eight additional canonical refreshes took 9.988 ms total in
the optimized test profile with debug assertions. These are synthetic Mac
measurements, not physical iPhone acceptance or an equal-total-work speedup.
Lean ContentRefresh passed before implementation.

## Established-audience creation

The second slice also handles owner MAIN creation of ordinary entries when the
vault already has a shown lane and the exact current audience key is held. Audience
reentry, epoch advancement, new files and schema/cap-group creation still fall
back. The only generated key is derived for the new entry from that held audience
key. The new header/tags/proof are installed and the new entry is judged normally.
Any required audience/keep mark invokes full refresh; no steward work is omitted.

All six focused tests passed. In a fixture with 1,194 signed edits, eight complete
signed new-entry writes took 85.109 ms total (10.64 ms average); eight additional
canonical refreshes took 54.942 ms. The new-audience test required and verified a
real signed stewardship move. A warm-reopen fixture retained three deferred bodies
and recorded zero fast-path hits: this commit intentionally does not solve that
case. Shared-author histories also remain conservative fallback. These synthetic
numbers include the write/signing call but not transport, persistence acknowledgment
or UI paint. The Node currently acknowledges mutations before its asynchronous
saver's durable frontier; immediate response must not be described as durable save.
