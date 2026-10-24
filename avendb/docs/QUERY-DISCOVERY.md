# Bounded active-view discovery

A fresh app view can know its query before it knows any matching entry IDs. The local
`demand` operation accepts `queries: [{ types: ["type"], vault?: "hex" }]` alongside
known entry IDs. Up to eight selectors, each with one to eight positive types, are
accepted. The demand remains local scheduling metadata; it grants no capability.

An authenticated connection can request wire kind 17, version 1. A provider first
checks the current recipient READ/key entitlement and keep policy, then matches
materialized types. It returns at most 64 entry IDs, always `complete: false`.
Backup-only peers cannot learn plaintext type membership. The request cannot name
a different requester. The provider rejects a prepared result if the exact policy
log revision changed during preparation. Ordinary signed receive and authorization
still govern all transferred entry data; a hint is never a trusted checkpoint.

The requester retains hints under the view's lease/revision, prioritizes them in
normal reconciliation, and wakes the existing bounded live-pull lane. Navigation
replacement/release rejects late discovery results. Explicit IDs precede discovery
hints. Each pass visits at most four connected peers, has a ten-second deadline,
and each exchange has a three-second deadline. Each provider prepares one response
at a time; legacy/refusing peers leave the view incomplete and ordinary sync works.

## Scope and remaining limits

This removes the requirement to wait for unrelated entry history before fetching a
known query's first useful entries, once identity/governance and authorized holdings
are available. It does not bypass authority catch-up, restore unknown encryption
keys, paginate all query results, or provide authenticated snapshot bootstrap.
First-page hints cannot establish empty/full query completeness. An active query
is still subject to usual local query evaluation after verified entries arrive.

The production regression holds background admission closed and checks that a
query-only fresh view receives an existing matching entry while unrelated entry
payloads remain absent and global coverage remains incomplete. Unit regressions
cover private/backup-only/stranger disclosure, pending revocation, response bounds,
unsupported peers, and stale demand revisions/expiry. QueryDiscovery.lean models
identity binding, recipient authorization, bounds, non-completeness, and the policy
revision fence; it does not prove network timing or the concrete crypto primitives.
