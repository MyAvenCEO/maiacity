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
