# Owner-attested scoped discovery at an accepted cut

## Why selector permission alone is insufficient

An actor may read a type or tag without reading every encrypted header in the
source vault. A hidden header can be unrelated, or a relevant entry still in an
intake audience. Treating all hidden headers as relevant leaks unrelated activity
through readiness; ignoring them invents negative evidence. A canonical share is
authority to read, not an exhaustive current inventory proof.

## Implemented candidate

`scope_manifest {vault, types|tag}` builds a bounded normalized manifest record
from a fully reconstructed owner-held domain, without changing any data. It
requires the device to act for the source vault, refuses unknown membership and
truncation, caps selected IDs at 512, per-entry heads at 64, and total heads at
4096. The result includes exact normalized scope and sorted member/frontier pairs.
It makes no remote-completeness claim.

The owner stores that record in a dedicated carrier entry and uses the existing
owner-approved entry-projection Snapshot path. Ordinary carrier writes alone
are not accepted as owner attestations. Publication and sharing remain explicit;
the record builder does not publish or grant access. The carrier must be shared
only with actors authorized to receive the selected-ID disclosure. Automatic
carrier creation/share policy is not implemented by this slice.

`entry_views` can explicitly name `manifest:{entry,snapshot}` alongside its exact
vault/types or vault/tag query. The core revalidates the retained owner projection,
carrier authority, normalized scope, each selected ID's current actor readability
and unchanged main frontier. Known readable in-domain additions, removals or
retags reject the old cut. Missing member metadata/history remains pending.

A successful result reports `completeAtOwnerCut:true`, `localComplete:false`, and
`remoteComplete:false`. A strict `read_guard` accepts this only when its query
explicitly names that exact owner snapshot. Its normal execution and delayed
approval checks re-run the same proof. No negative proof silently upgrades an
owner cut into latest global state.

## Publication and disclosure boundary

`checkpoint_scope {vault,types|tag}` prepares an encrypted carrier in memory.
The source owner must co-sign its exact creation before any content edit is kept.
The preparation and same-lock approval continuation check all live potentially
matching shares, including delegated shares and Everyone, against every selected
member's current readership. Unknown selectors fail closed; schema-only selectors
can be excluded using the actual prospective entry attributes. The continuation
also rechecks owner authority, exact selected membership/frontiers and audience.
Changed grants or source data require new preparation and a new owner ceremony.

After the approved carrier creation, existing `checkpoint_view` performs its
separate owner Snapshot approval and durable pin. Failure at this second stage
retains the already approved carrier and reports a resumable unpublished result.
No authenticator at the first stage means no carrier was created. This native
publication API deliberately exports no unsigned draft for a generic unguarded
continuation. Browser-local publication and automatic publication/sharing remain
unimplemented. Later explicit user-authorized sharing uses ordinary policy.

## Validation status

The first native run finished: one normalization test passed, three tests failed
at actual carrier creation with `NotAView`. This exposed a production schema gap,
not a fixture issue. A bounded built-in manifest schema and the guarded creation
path now address it; corrected native tests are **pending** the serialized build
slot. Existing JS demand/completeness suite: 73 passed, 239 assertions. Full
Svelte check: zero errors (27 existing warnings). Lean contract passes.
Run `cargo test -p avendb --lib discovery_manifest` and
`cargo test -p avendb-net discovery_manifest` on this exact correction.

## Pending discovery and durable restore wiring

An authenticated carrier can disclose its bounded selected IDs for scheduling
without claiming each member is currently readable. Pending `entry_views` results
expose those IDs only as owner-cut scheduling hints, with no content rows and
`completeAtOwnerCut:false`. Query windows prioritize the carrier itself, then
those pending IDs through the existing scoped demand path. Actual peer delivery
still checks ordinary authorization. Missing/currently revoked members never
become readable or complete merely because the owner disclosed their IDs.

The carrier's ciphertext already uses durable checkpoint pins. Query demand
restores its exact signed root from local blob storage before peer work after a
restart or in-memory eviction. The attestation accessor remains usable after
normal carrier history materializes, and revalidates owner Snapshot/policy/key
at each changed log revision without recloning/decrypting ciphertext each query.
The decoder now enforces the builder's total-head budget of 4096 and rejects
unknown fields, duplicate IDs, duplicate heads and malformed owner payloads.

Added native regressions cover malformed attestation, selected-entry revocation,
unknown-member discovery without content readiness, full-history cache eviction,
and a real Node shutdown/reopen/offline pin restore. Explicit publication without
an authenticator must return an approval requirement without keeping a carrier.
These tests are pending the granted native run; JS demand/completeness tests pass.
Automatic background republishing and automatic carrier-sharing policy are still
absent; no implicit standing owner consent has been added.

## Automatic active-view selection (follow-up candidate)

Normal `entry_views` reads with one exact vault/types or vault/tag scope now look
for an already retained, currently authorized owner-attested carrier matching the
normalized scope. They attach it as `scope.discovery` and keep all ordinary
locally readable rows and their existing completeness. This is scheduling evidence,
not implicit consent to use an old cut for a negative decision. Only an explicitly
snapshot-bound manifest query can promote strict accepted-cut guard evidence.

Read windows discover ordinary authorized `discovery-manifest` entries alongside
the view's own types, then prioritize the selected carrier and its disclosed IDs.
No manual carrier IDs, owner publication, or new privileges are involved. Normal
navigation/cancellation releases the same scoped demand lease. Selection examines
only the bounded retained projection set, without decoding unrelated entry bodies.
If a carrier is not yet retained its ordinary discovery/demand must first restore
it. Global queries, combined filters and semantic-kind queries do not silently
choose a narrower manifest. Automatic selection across these broader query forms
remains outside this exact-scope path.

JS query-window regression: 23 tests passed, 94 assertions. Core automatic-selection
assertions are added to the native manifest regression and remain pending Cargo.

### Bounded demand liveness correction

Automatic carrier discovery now precedes ordinary type discovery so the native
first-eight restore budget cannot be consumed entirely by unrelated held rows.
Missing manifest member hints precede the carrier and ordinary rows before the
512-ID demand cap. Already usable members are removed by reusing this exact read's
nonsealed rows (no additional body hydration), allowing later members to enter the
first-eight checkpoint batch on the next reactive update. This does not assert
those rows' complete history or turn an accepted old cut into fresh negative proof.
A 512-existing-row regression verifies missing IDs survive truncation and advance
after the first eight become visible. Combined JS demand/completeness: 28 passed,
99 assertions; Lean passes. Native manifest/publication/offline-restore gates remain
pending the parent-controlled compiler queue.

### Publication ordering correction

Matching retained carriers are ranked by their authenticated Snapshot edit's
causal depth, then signed snapshot ID for deterministic ties. Random carrier IDs
cannot cause an older ancestor publication to win indefinitely. Concurrent cuts
still carry historical accepted-cut labels; this ordering makes no wall-clock or
unknown-peer freshness claim. Every candidate still passes exact-scope/current
owner policy and carrier authorization before selection. The bounded carrier set
is ranked in one pass over existing log metadata, without decoding entry bodies.
A regression deliberately assigns the larger carrier ID to the older cut and
adds a member before publishing the smaller-ID newer carrier. It requires the
new cut/member set. Lean and syntax pass; native execution remains queued.

### Advertised frontier fulfillment correction

A nonsealed visible row alone no longer removes a missing-member hint: it can be
older than the owner's advertised heads. Fulfillment now requires the exact read
row plus current actor/device readability, an existing MAIN materialization, and
every advertised head both counted in the authenticated local history metadata
and present in MAIN's imported-edit set. This accepts later local descendants too.
It inspects existing metadata, without opening deferred historical bodies. Plain
read-only projections lacking this counted/imported proof remain conservatively
pending; deriving equivalent projection coverage is a separate optimization.

A receiver regression retains an old usable row while receiving only the newer
carrier, requires pending priority, then clears only after receiving the missing
updates, and stays clear after a later local edit. JS priority/completeness tests:
29 passed, 100 assertions; Lean passed. Native frontier regression is pending.
