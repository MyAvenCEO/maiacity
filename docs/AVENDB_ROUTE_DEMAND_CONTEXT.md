# Route demand lifetime follows local view context

`useView` now owns a lease keyed by device, pathname, selected vault, local URL
context, and explicit selected entry IDs. Changing a hash selection, Studio
cut/Chat room query parameter, or selected vault closes the old scope and
starts the new one even when the pathname stays unchanged. An identical context
reuses its scope. The URL context is never sent to the node or peers; only
validated entry IDs and existing vault/type scheduling hints are published.

The route helper reads only explicit room/entry/timeline address parameters and
known entry-addressed Shell hash routes. It does not scan arbitrary URL strings
for IDs or send filters/search text. Explicit IDs are prioritized before catalog
queries complete. Existing component-owned read windows still manage their
own paging/playhead dependencies independently.

Shared Maia City manifests continue to query their owning shared vault; they
are not silently reinterpreted against the selected personal vault. A selected
vault additionally supplies its own locally authorized route manifests. Both
catalogs contribute scheduling selectors to one scope, without one catalog
replacing the other's selectors. A selected vault with no manifests does not
inherit fictitious private declarations. Source-level authorization is unchanged.

Historical pathname-only hints are not replayed into a different selected
vault or semantic URL context. Device replacement clears remembered route
context until the reactive layout supplies the new session's selection.

Validation: 43 route/device/manifest/context tests passed. New tests cover
same-path vault replacement during an outstanding catalog read, cancellation of
old scopes, retention of shared plus owned catalogs, immediate explicit selected
entry demand, identical-context reuse, and absence of private context strings in
operations. Root Svelte layout compiled. No Rust build or deployment performed.

Remaining boundary: Studio's actual clip/playhead/page dependencies belong to
its component-owned collection/entry scopes (root agent's separate work), not
to interpreting private arbitrary query predicates in the route planner.
