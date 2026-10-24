# Offline Assets readiness repair — candidate

Installed build 711's Shell refuses to mount every non-home view while the shared
world has `entriesComplete:false`. Shell changes its own route on native
`hashchange`, while the only refresh request lived in layout's router-page effect.
Those are independent navigation signals. A summary can therefore remain on the
new Assets route without its local data component ever mounting; no network is
required by the actual world read, but the guard still blocks local content.

Shell now requests local readiness from its actual hash/navigation event. Legacy
consumers retain the full-world path. Assets is explicitly audited as a scoped
consumer and mounts with metadata-only world state. It independently reads
`database(vault, types:[recipe])` for canonical version/variant rows and
`entry_views(vault, types:[recipe])` for file and reader metadata. These reads use
existing engine projection/authorization and no bring/network barrier. The optional
database type filter selects by held meaning before body projection; omitted
filter preserves existing database behavior. Files remain fetched on actual asset
demand through the existing local reader. Partial metadata remains marked partial;
unavailable inventory is an error, and absence is described as locally available,
not globally complete. A reactive session revision refreshes this scoped inventory.

Passed: 5 Bun regressions / 29 assertions covering native-hash readiness, a metadata-only
Assets route with global-world/network promises withheld, exact scoped requests,
and unavailable inventory handling; both modified Svelte components compile;
focused EntryProjection Lean subset proof passes. Rust typed-database exact-row
regression is added but not executed (shared Cargo queue). No physical offline
acceptance or deployment is claimed. Requires matching native/WASM engine build
for the optional database `types` parameter.

## Component integration review

Actual Assets component fixture passed Chromium and WebKit, using metadata-only
world state, a compiled reactive session stand-in and a synthetic local API.
It verifies DOM transitions on session revision (empty inventory, read refusal,
recipe validation refusal, removal), with external network blocked and only typed
database/entry_views allowed. Native hashing remains unit-covered, not a claim of
physical Mac acceptance. The selected asset's note/history effect now follows the
same session revision as inventory, so a stable entry ID no longer waits for a
full-world publication to update its history sidebar.

API review: Account spreads session.api; ask returns raw {ok}/{refused}, matching
the helper. The optional database type filter leaves canonical row authorization,
version history and metadata intact. Current entry_views(vault,types) is an
unpaginated enumeration of matching held entries; there is no ignored cursor.
Metadata remains partial and does not assert full peer/history completeness.
