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

## Current limits and next wiring

- This is an opt-in core query path, not automatic owner publication or discovery.
- Unknown IDs are not yet exposed as a separate authorized discovery/fetch list;
  content and negative proof remain pending until each member's current authority
  and frontier is locally available. That split is needed for fresh-device fetch.
- Projection retention is bounded by the existing eight-entry/four-MiB store.
  This slice adds no durable manifest registry or background publication loop.
- No user store is reset, and no hosted-peer privilege is introduced.
- Carrier sharing must preserve selected-ID disclosure permissions. Do not wire an
  automatic public carrier publication shortcut.

## Evidence

ScopedDiscoveryManifest Lean proofs pass. Rust syntax parses. Native tests are
added for owner approval, exact scope, query/guard cut labels, and invalidation by
an added member; they remain unrun while the parent owns the Cargo queue.
Run `cargo test -p avendb --lib discovery_manifest` after integration.

## Publication, pending discovery and durable restore wiring

`checkpoint_scope {vault,types|tag}` now explicitly creates a normal private carrier
on a fully reconstructed owner node and invokes the existing `checkpoint_view`
owner-approval/blob-pin path. It does not infer any sharing. If approval is absent,
cancelled, refused or storage fails after creation, the response retains the
created carrier and reports `published:false` with a resumable checkpoint request;
it never claims the creation rolled back. Native Node publication is implemented;
matching browser-local publication remains unimplemented.

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
an authenticator must preserve an unpublished private carrier and approval request.
These tests are pending the granted native run; JS demand/completeness tests pass.
Automatic background republishing and automatic carrier-sharing policy are still
absent; no implicit standing owner consent has been added.
