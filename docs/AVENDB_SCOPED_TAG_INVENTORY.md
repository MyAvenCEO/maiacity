# Scoped local tag inventory — candidate, runtime tests pending

`entry_views` accepts an exact global `tag` of 1–256 bytes and the existing acting vault. It rejects mixed vault/ID/type/kind filters so its scope cannot be mistaken for all current tag matches. Current actor readability is checked before tag projection or body materialization. The tag filter uses opened creation/retag metadata; unrelated ordinary entry bodies remain lazy. Existing ID/vault/type queries retain their response shape.

The response’s `scope` says `basis: current-readable-held-state`, reports whether that current local read has fully replayed input, no owner overlay, known authorized metadata and open matching bodies, and always reports `remoteComplete: false`. It exposes no global edit count or whole-log digest: those would leak unrelated private activity. `localComplete` is not proof that an unreadable entry lacks a reference, proof of remote absence, or a token authorizing a later mutation. Query rows are not privileged because they came from a hosted peer.

Public workflow transitions remain guarded. To use negative picture-reference evidence, an eventual planner must define its ownership/dependency domain, account for unavailable/unreadable references conservatively, and validate its local cut atomically with executing the planned mutations. An old UI snapshot is not that check. This commit supplies the narrow read primitive, not an unsafe public-transition bypass.

Lean ScopedTagInventory passed before implementation. Rust source parses. Added runtime tests for authorized selection, retag replacement, no leaked count/digest, invalid mixed scopes, unchanged warm entries remaining lazy, and unknown header refusing local completeness. Cargo was deliberately not started while the parent-owned compiler queue is occupied; run:

```
cargo test -p avendb --lib tag_inventory_
cargo test -p avendb --test engine tag_inventory_
```

No data resets, installation changes or physical-device claims.

Vault-scoped tag inventories now accept `vault` alongside `tag`. Their completeness
is a conservative local owner-domain claim; nonowners always receive incomplete,
so it cannot act as an oracle for hidden-entry presence. Typed vault inventories
also report local scope readiness. `read_guard` refuses scoped dependencies whose
local completeness is false, both initially and when refreshing a continuation.
