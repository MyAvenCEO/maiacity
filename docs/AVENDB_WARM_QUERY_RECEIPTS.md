# Warm metadata pagination receipts

## Problem and scope

Universal query previously imported every eligible warm Loro snapshot before
sorting and applying a page limit. A view requesting one row could therefore
materialize an entire local collection. This change keeps exact counts and
ordering while avoiding unrelated snapshot imports for label-only predicates
and ordering. It does not add peer authority or change query result schemas.

## Receipt and trust boundary

An own encrypted warm materialization now optionally records main-line snapshot
hash, resolved Own schema ID, and Own translation eligibility at QUERY_DEPTH
(16). These are generated from the actual validated Item outside the shared
Lab lock. Saved.print already binds entry writes/body availability and the lane
and cap-group context. Existing restore additionally requires the authenticated
own shelf, engine compatibility, ordered log basis, canonical print, exact
history, and current entry keys. The snapshot hash is checked during decode.
Old receipt formats remain readable and simply use the canonical fallback.

The receipt is used only for a currently readable, landed, non-pending entry,
with matching shown print and authorized deferred bodies. Changed ordinary
entries lose eligibility through their changed print; reconstructed entries
start without a certificate. Receipt generation and resaving remain bounded by
existing 256-entry/8192-write/32MiB limits; copied lane sources have a separate
32MiB ceiling. Certificate lookup does not import Loro or decrypt old content.

## Query behavior

Label-only predicates and orders classify eligible candidates before paging.
Stored-schema visibility uses certified snapshot presence. Own or explicit
matching Own schema uses the certified visibility only at the exact default
depth. Other schemas, depths, payload conditions/orders, absent receipts, and
checkpoint overlays use existing translation. Exact count, stable sorting,
unresolved candidate reporting, and partial-state flags are preserved. Returned
page rows use normal materialization, including schema, readOnly, cut, follow,
and optional revision behavior. Following requested links may legitimately load
additional entries. Full unpaged queries still need their full result set.

Optional warm view capture is postponed while ordinary judgment is pending;
key and journal persistence remain independent. A partially judged view is not
acknowledged as a complete warm capture.

## Validation and handoff

Implementation: [92e9cb29](https://github.com/MyAvenCEO/maiacity/commit/92e9cb29).

- Lean WarmQueryReceipt proves stale/unauthorized/payload rejection and page
  equivalence under equal membership decisions. Local module check passed.
- Rust syntax parsed with rustfmt; diff whitespace check passed.
- Added cold-vs-warm exact query result tests and one-page/zero-page import-count
  assertions, edited-entry/payload fallback, snapshot corruption, current-key
  rejection, and pending-judgment capture coverage.
- **Rust runtime checks pending canonical compiler slot.** No Cargo run from this
  isolated worktree, to avoid vendor-path cache rebuilds. No physical latency
  claim and no deployment included.

Next: integrate this commit into the canonical source, run the new warm query
and all existing warm materialization/query regressions, then report timing
separately from semantic equivalence. Broader cold-peer discovery and arbitrary
payload query costs remain separate work.
