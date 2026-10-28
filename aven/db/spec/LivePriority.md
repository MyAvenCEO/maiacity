# Live announcement canonicalization

`AvenDB/LivePriority.lean` models interactive hints as scheduling metadata: authorized differences and normal receive validation still control disclosure and acceptance. It does not prove network latency or arbitrary causal closure.

The wire decoder requires strictly ascending unique log IDs inside each announcement. This is a canonical metadata encoding requirement, not a total ordering of CRDT edits or peers. `Holdings::since` supplies canonical announcements. Adding a permitted creation witness must preserve this contract even when that witness's hash sorts before a newly changed log.

Before the repair, `add_witness_hints` appended witnesses to the vector. A receiver could reject the entire announcement as `Unordered`, leaving later entries absent even while ordinary reconciliation waited for the lost inventory. Disabling the interactive worker did not disable this outgoing mutation.

`canonicalHints` specifies an exact permutation of complete `(log, frontier)` pairs with strict ascending log order. Its theorems preserve pair membership and the admitted bound. This is an abstract postcondition, not extraction of Rust sorting. Runtime correspondence is the `earlier_witnesses_keep_the_announcement_wire_canonical` regression: lower and out-of-order witness IDs, distinct frontier values, duplicate and unauthorized candidates, bounded insertion, and actual wire encode/decode. The strict decoder remains unchanged. The production repair sorts the already-authorized, deduplicated vector; it changes neither edits nor their frontiers.

Focused wire acceptance alone is insufficient for release. The browser receipt and server feed regressions, live-priority tests, and full current-head integration shards must also pass. No production throughput claim follows from this proof.
