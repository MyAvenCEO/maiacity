# Studio collection reads without a whole-world dependency

`listCuts`, `listStories`, and `cutsHere` previously requested `worldOf`, which
materializes all held entries and caches the result for three seconds. Repeated
collection reads could therefore enqueue unrelated database work behind sync and
in front of local writes. The device logs reported expensive world reads, but do
not isolate these callers' contribution to the observed latency.

Cut/story discovery now uses the universal typed query engine, with an optional
vault restriction. It requests identifiers in pages of 50 and then materializes
only those identifiers through `entry_views`. Existing visibility, deleted-tag
filtering, timeline conversion and ordering remain in the callers. `cutsHere`
needs only ownership/vault metadata and now reads `world_summary`.

Failures remain failures rather than being presented as an empty collection.
These are held local results, not a claim of globally complete discovery. The
collection is not a transactional snapshot across pages; concurrent changes may
require the caller's next refresh, just as other paginated queries do. The engine
may scan all matching typed candidates before applying a page limit; this change
bounds metadata batches, not every internal operation.

Three focused regressions pass: multi-page scoped discovery without any world
read, refusal propagation, and termination when a changing collection cannot
advance. Other Studio world readers (job reconciliation, schema preparation,
proxy lookup and mutation helpers) remain and need individually scoped replacements.
