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

### Diagnose zero concrete requests without assuming absent demand

The iPhone export from frontend `7dc7c57a` records 17 completed manifest walks
with `requested: 0`. That field counted only concrete entry IDs, not discovery
selectors. The repo declarations are query-based, and cold manifest discovery
itself is published by `useView`, outside this counter. Therefore the report does
not establish whether manifests were absent, the route had no matching leaves,
or type discovery was active while no readable rows existed locally.

Walk observations now distinguish bounded counts of held manifests, matched
leaves, query leaves, type discovery hints, and local rows. Catalog outcomes
separately report local/refused/unavailable/failed without error text. No routes,
IDs, selectors, contents or capability details are exported. These are scheduling
observations, not completeness or delivery proofs. Tests cover all three zero-ID
cases and refused catalogs: 41 focused device/demand/manifest tests pass.

Remaining declaration gaps: Chat has its own reactive room discovery but no repo
Chat manifest; game manifests currently contain tag-only leaves, which cannot
produce positive type discovery hints. Manifests are owner-AIP records, not seed
writes; adding declarations in source alone cannot update existing vault records.
No live owner records were changed by this diagnostic patch.

### Discovered IDs no longer wait behind optional checkpoint attempts

Scheduling fix: once an authenticated discovery response has been retained in its
current demand scope, queue its IDs through the existing live reconciliation path
before attempting optional checkpoints. Previously up to eight checkpoint probes
ran before that queue action. Missing checkpoint pins return no offer; a slow or
missing checkpoint must not delay ordinary reconciliation of already discovered
IDs. `pull_live` still checks all authority readiness and ordinary signed receive
is unchanged; this does not introduce a quarantine or bypass authorization.

The ten-second discovery network budget is shared among the remaining peers,
instead of letting the first peer consume all of it. This bounds allocated network
waits, not synchronous computation or scheduler delay. Explicit-ID checkpoint
probes remain bounded, and complete scoped-authority bootstrap remains open.

Validation: `lake env lean AvenDB/LivePriority.lean` passed. Rust parser check via
`rustfmt --edition 2024 --emit stdout .../discovery.rs` passed. Added Rust tests for
queue publication while a checkpoint never completes and remaining-peer budget
reservation. Rust type-check/runtime tests are deliberately pending while the Mac
build owns compilation resources; no runtime or physical-device win is claimed.

### Preserve discovered catalog priorities across lease renewal

The follow-up iPhone report from `24b8c4af` records ten successful local catalog
reads with zero held manifests. A coordinated read-only check of an existing peer
found 13 manifest records, so this is a missing local catalog, not proof that the
provider has no manifests. The export alone still cannot identify all missing
causal/authority dependencies.

A concrete scheduling loss existed in `view_demand`: every revision called
`Demands::replace`, which discarded all discovered IDs, then reinstalled selectors.
A 30-second renewal or unrelated newly learned entry therefore removed discovered
catalog priorities while their authorization/history could still be arriving.

`replace_query` now retains bounded discovered IDs for the exact same nonempty
selector on an unexpired scope. Revision advances still invalidate old responses.
Changed selectors, explicit release, expiry, and capacity rules discard hints as
before. Entries remain hints only; no permission, checkpoint or replay gate changes.

Validation: ViewDemand Lean retention/expiry laws passed; Rust parsing passed.
Two Rust regressions cover cold-catalog renewal, learned-entry changes, stale
responses, selector replacement, release, expiry and shared capacity. Runtime and
full crate compilation remain pending the coordinated compiler slot. This is an
actual retention repair, not a claim that the broad authority bootstrap is solved.
