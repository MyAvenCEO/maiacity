# Publish known active-view demand before unrelated discovery

Implemented in [09939016](https://github.com/MyAvenCEO/maiacity/commit/0993901671235136ed58caeda240eba513255f81), based on `1942f429ffe0554b14c444b7da52ea47824fb915`.

## Observed barrier and narrow change

`useView` previously waited for the entire manifest walk before publishing previously learned IDs. Inside that walk, `planDeclared` resolved all query leaves before publishing even explicit entry IDs already present in canonical local manifest records. A slow unrelated query therefore withheld useful scheduling hints.

The view now publishes its bounded learned IDs immediately. Once canonical local manifest records arrive, their explicit entry IDs are sent to the existing demand lease before querying other leaves. Existing bring ordering, rank/follow traversal, lease bounds, cancellation and canonical authorization remain in use. No HTTP fallback, privileged hosted node, checkpoint shortcut or alternate authority cache was added. Hints do not confer access and never claim delivery or completeness.

## Reproducible verification

```sh
bun test game/code/sources/manifests.test.js game/code/sources/device.test.js game/code/sources/demand.test.js
cd avendb/spec
lake env lean AvenDB/ViewDemand.lean
```

The two new regressions failed against the base runtime: learned demand waited behind manifest discovery, and explicit dependencies waited behind unrelated query materialization. With the fix, all **28 tests / 154 assertions** passed. In the held-query fixture, the explicit dependency is prioritized and its useful local record can be read **before** the withheld discovery query is released. Diagnostics still report a pending manifest walk and no completed bring. Cancellation then prevents the late query result from issuing work. The learned-demand fixture verifies lease closure on device replacement and rejects stale manifest publication.

These are deterministic dependency-order tests with a 100 ms failure watchdog, not physical-device latency benchmarks. The read fixture supplies a canonical-shaped response; it does not re-prove native authorization or show that a native Lab lock is free. Lean proves an abstract separation of scheduling hints from authorization/completeness and owner replacement; it does not prove JavaScript execution time.

## Remaining work

A genuinely fresh device without a local manifest or known entry IDs still relies on generic peer discovery. Query-only unknown IDs, native query/materialization lock contention, follow traversal's broad-world file-root lookup, and sequential transfer waits are not removed by this slice. Published demand only prioritizes logs the existing scheduler can discover; it does not make an incomplete local result globally complete. Physical fresh-device usefulness, warm unlock and remote propagation distributions remain pending. No native build, installation, live-store change or reset was performed.

## Review hardening

Explicit manifest requirements now precede older learned hints within the same 512-ID lease, preserving the remaining hints rather than clearing the scope. Scheduling acknowledgement is not awaited by manifest query discovery. Two additional regressions fail on the initial implementation and pass after this repair: a full 512-ID learned lease retains the explicit target plus 511 prior hints, and a permanently pending lease acknowledgement does not prevent local query discovery. Total focused validation is **30 tests / 158 assertions**; the Lean model also proves that an explicit first requirement precedes learned hints. The diagnostic and physical-measurement limitations above remain unchanged.

## 2026-10-25: remove the duplicate awaited history pull

Implemented: `useView` publishes scoped demand and continues its bounded local
manifest walk without issuing a second legacy `bring`. Previously every manifest
rank awaited `bringEntries` even after demand was accepted. Native `bring` first
pulls authority, then entry history, with a 60-second overall deadline; this
serialized later ranks behind history and consumed foreground pull slots outside
the cancellable view scope. The deadline itself remains unchanged. Fire-and-forget
`near` reads are a separate caller, so a recorded 60-second operation alone does
not prove a blocked UI thread.

Explicit old-protocol responses still select the legacy compatibility path.
Policy refusals and transport errors do not authorize an unscoped retry. View
failure/navigation closes its lease; learned IDs remain scheduling hints only.

Validation: `lake env lean AvenDB/ViewDemand.lean` passes. Two multi-rank regressions
with indefinitely pending legacy transfers fail against the old `device.js` and
pass with this change. `bun test game/code/sources/device.test.js
game/code/sources/demand.test.js game/code/sources/manifests.test.js`: 36 passed.

Remaining: missing local manifests and dependencies that arrive after the initial
local walk need incremental discovery/re-evaluation. This change does not claim
cold-device completeness, physical iPhone latency acceptance, or deployment.

### Same-route discovery after partial arrival

Implemented follow-up: each view immediately requests authorized `manifest` type
discovery in its scoped lease. The existing cheap session revision watcher calls
`refreshActiveView`; real local changes schedule one walk after 150 ms, with at
most one walk active and one pending replan. Replanning retains the original lease
and extends dependencies discovered from newly held records. Navigation and device
replacement cancel the timer and invalidate the old walk. No polling, broad-world
materialization, new peer authority, or completeness assertion is introduced.

This closes the frontend once-only walk gap: an initially absent route manifest
and a referenced record arriving later can now add their requirements on the same
route. It depends on authenticated peer discovery and local revision delivery;
physical first-view latency and full coverage remain acceptance work.

Validation: ViewDemand Lean proofs pass; 39 focused device/demand/manifest tests
pass, including cold manifest arrival, later reference arrival, revision bursts,
notifications during a blocked local query, and obsolete-navigation cancellation.
