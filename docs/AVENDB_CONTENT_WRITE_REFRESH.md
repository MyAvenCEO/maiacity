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

## Warm and shared-content continuation (validation pending)

The next slice permits ordinary shared-author MAIN histories when every foreign
non-creation body is available and has no tag asks. It retains current actor
checks and the same proof/cap-group/row-ownership judgment. Foreign tag asks,
proposals and computed stewardship marks remain full-refresh cases. Cap groups
are functions of their definitions, included cap-group IDs, operation rules and
entry attributes; they do not execute arbitrary queries against ordinary payloads.

An exact-basis own deferred receipt may advance only across the guarded canonical
strict append, with unchanged old policy, ciphertext and keys. Every receipt must
be exclusively owned (no other Arc/Weak owners), preserving the existing plaintext
memo without copying it. Current-key and decrypted-metadata checks still run on
every demand. Only the edited entry's deferred bodies are hydrated; unrelated
history remains deferred. Any policy/removal/key-replacement path retains the
existing canonical invalidation behavior. These are process-local reuse guards,
not acceptance of a peer checkpoint or a new authority mechanism.

This follow-on is committed for combined validation in the integration checkout;
its Rust regressions have **not run yet**. Do not mark it delivered on this commit.
Run `cargo test -p avendb --features test-fixtures --lib content_refresh::tests`,
then the `deferred_body::tests` and `warm_materialization::tests` filters. Lean
DeferredContentAppend and ContentRefresh passed, and git diff whitespace checks
passed. Tests now cover current-key/revision rejection, zero-copy plaintext
ownership transfer, retained unrelated warm bodies, shared writes, foreign tag
asks, revocation, group references/redefinition and canonical cold reconstruction.
The target's prior History and hydrated Body buffers move into the active working
set; they are not cloned. Received ordinary tails still use the old global catch-up
path and are the next separate integration point.

## Verified received live tail (next slice; Rust validation pending)

A single fresh ordinary MAIN content edit now reuses the same target-only
materialization after ordinary signature verification and current gate admission.
The receiver must already be settled, currently entitled, and hold the exact
current entry stay/epoch key. The immutable prior log revision and length fence
must describe a strict one-edit append. Shared history, deferred receipts, policy,
metadata and stewardship safeguards are identical to local edits. This runs even
when a transport requests deferred page catch-up, so an eligible live tail need
not wait for a later global refresh. Multiple edits, stale ordering, missing keys,
blobs, checkpoint coverage and governance changes retain the canonical path.

Lean `ContentRefresh` additionally proves the received-tail predicate requires
verified signatures, current permission and current keys. Source regressions
exercise four received tails against forced full refresh, rejected signatures,
and retained multi-edit batching. No Rust run or physical latency result is
claimed for this slice yet: run `content_refresh::tests` and
`prepared_receive_tests` on the combined integration checkout. The earlier
received-tail limitation above describes the previous commit only. Bulk catch-up
and unsupported single-tail cases still incur their existing reconstruction work.

### Receiver regression correction

Combined validation identified a real overconservative fallback: a non-steward
receiver calculated a mark from its partial selector knowledge and unnecessarily
ran global upkeep. The correction mirrors the canonical `upkeep -> steward`
conditions: the device must act for the vault, read all its share selectors, and
have a capability mark or a keep mark whose keep selectors it can read. Missing
meaning remains a fallback. Owner-required marks still execute the full path;
the regression checks an actual signed audience move and exact canonical state.
Lean proves a foreign reader cannot require stewardship and legal capability/
readable keep marks remain required. Rust revalidation is pending integration.
