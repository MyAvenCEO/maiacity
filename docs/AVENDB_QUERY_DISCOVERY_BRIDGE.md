# Query discovery scheduling bridge

The generic read window now publishes bounded positive type hints even when its
local query returns no entry IDs. Manifest type requirements publish the same
hints before local query materialization. Neither path waits for a lease reply.

The local scheduling operation extends `demand` with optional
`queries: [{types: [string], vault?: hex}]`: at most eight selectors and eight
types per selector, each nonempty and at most 64 UTF-8 bytes. Only positive type
filters are extracted; negations, record predicates, projections and acting
identities are not forwarded. Invalid vault constraints are discarded with the
whole hint, never widened. Full original queries still execute locally.

Selector-only leases renew, survive returned-row updates, and are released on
query replacement, failure, device replacement and unmount. Old nodes' ordinary
`accepted` replies do not establish discovery support. Only explicit
`discovery_supported: true` does; even then completeness remains false.

Validation: 44 focused demand, manifest, device and query-window tests pass,
including empty local results with a held acknowledgement, selector cancellation,
bounded traversal, negation exclusion and UTF-8 limits. These are bridge tests,
not physical latency or proof of fresh-device bootstrap. The peer-side protocol
must be integrated and validated before this requests useful unknown entries.

This slice grants no access and changes no persisted account or vault state.
