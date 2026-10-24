# Query-only discovery: protocol gap and opt-in acceptance fixture

Status: **proposed, not implemented**. Based on active-demand head `eb739f5cd8101db7e73da2de6bb21aa3478a3e9e`. No production API, wire format, authorization rule, installed app or live store changed.

## Concrete gap

`src/lib/avendb/query-window.js` publishes only explicit positive entry IDs and IDs returned by local reads. An empty type-only query on a device that has never seen the target cannot name any demand. `avendb-net/src/run.rs::view_demand` accepts bounded entry IDs only. `Shared::ask_differing` orders already-announced differing log IDs; it cannot associate an unknown entry ID with a requested type. `Scope` and `ReplyScope` support All, Logs and Vaults. `sync::Ask` carries log frontiers, loose edits and followed vaults, not selectors. This is not fixed by increasing bandwidth or reordering known IDs.

Types and tags come from canonical decrypted meanings. A backup/relay-only peer may hold ciphertext without being able to evaluate a type selector. Giving a hosted node decryption or query privileges would violate the architecture. A receiver must also not learn an otherwise hidden entry's existence or type through discovery.

## Smallest candidate implementation

1. Extend a negotiated discovery capability with a bounded positive-type hint request: at most eight type strings of at most 64 characters, optional explicit vault, no predicates, tags, negation, projections, remote code or remotely selected acting identity. Bound request bytes and at most 64 result IDs per request. These proposed limits need protocol review before implementation.
2. Authenticate the requester from the established peer connection. Before matching, intersect provider-readable canonical entries with the recipient's current canonical **read** authorization and existing receive/keep rules. Merely being allowed to hold ciphertext is insufficient to disclose matching type information. Recheck the same revision/authorization fences used by existing replies; revocation invalidates prepared output. A caller-supplied vault is a narrowing filter, never an impersonation grant.
3. Return only authorized matching IDs as untrusted scheduling hints, plus an explicitly partial/unsupported result state. Do not return record bodies, hidden match counts or a claim of global absence. A single peer's empty answer, unreadable ciphertext, refusal or truncated page never proves completeness.
4. Feed hints into the existing bounded interactive scheduling/normal signed-log receive path. Preserve required authority and causal witnesses before materialization; unknown dependencies remain pending, never skipped. Canonical local query results alone become visible. Hint spoofing cannot admit entries or bypass capabilities.
5. Expire/replace discovery with the same view scope and generation. Bound retry/pagination work and retain background fairness. Negotiate support: the current demand parser ignores extra fields, so its existing `accepted` flag must **not** be interpreted as selector support.

This is an implementation option, not yet a proof that every peer can perform discovery. A blind relay must say unsupported/partial; a readable authorized peer may assist without becoming privileged. Discovery from only blind peers remains a separate problem requiring authenticated metadata design rather than a trusted checkpoint shortcut.

## Executable acceptance fixture (not yet validated)

The opt-in test `live::tests::an_active_type_query_discovers_existing_entries_without_unrelated_history` lives in `avendb/crates/avendb-net/src/live_tests.rs` and is marked ignored with an explicit RED-specification reason. It uses real `Node`s, authenticated loopback transport and canonical `Node::op` queries. The receiver already has valid identity/governance/schema state but none of the remote payload IDs. All target/backlog entries predate the first connection, so the existing new-live-edit hint lane cannot accidentally satisfy the test. Background page slots stay held until after observations. The proposed local `queries` field is not implemented and is not advertised as a current API.

```sh
cargo test -p avendb-net --lib an_active_type_query_discovers_existing_entries_without_unrelated_history -- --ignored --nocapture
cd avendb/spec
lake env lean AvenDB/QueryDiscovery.lean
```

The fixture requires a useful authorized type-query result before releasing unrelated background history, retains `behind > 0`, and checks unrelated payloads remain absent. Its two-second timeout is a failure watchdog, not a production latency target. Native compilation/execution remains pending; do not claim a confirmed RED result until that command runs. Lean currently passes the abstract identity-binding, authorization-before-filter, response bound and no-completeness claims. It does not prove the unimplemented protocol or cryptographic chain.

Before production wiring, add real denied/private, revoked-during-preparation, wrong requester, blind-provider, oversized selector/response, cancellation and honest truncation cases. Then connect the existing generic read-window scheduling layer; Chat is only one consumer. This fixture covers a fresh **view** on an authorized device, not first-ever passkey enrollment or missing root authority.
