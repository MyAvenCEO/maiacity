# Audit A11–A14: registration, historical builders and refresh

## A14: changes, not polling

Studio refreshes subscribe to the existing avenDB session revision and native `jobs` / `vault-proxy` events. One coalescing queue serializes background reads, retains changes received during a read and defers work while hidden or playing. Visibility and playback resumption drain pending work. Destroy closes the queue and removes subscriptions; late library, cut and render reads cannot replace disposed state.

The studio holds and releases the session's existing watcher. Database changes invalidate the shared cut-world snapshot, now also reused by the media library. Native progress events update job/render views without forcing a library or timeline reload. The old four-second timeline, twenty-second library and three-second render timers are removed. Playback clocks, autosave debounce and worker lease timers are intentionally unchanged.

The queue tests measure 100 invalidations becoming one read, 100 changes during that read becoming one trailing read, zero idle polling, and cancellation on close. These are deterministic request-count tests, not a production performance benchmark. Direct user commands remain immediate.

The Jobs screen already subscribes to sync and native job events. Its remaining fifteen-second lane-hold snapshot has no corresponding native hold-change event, so that fallback stays, now visibility-aware and serialized through the same queue. Its display clock stays separate, and late responses cannot update an unmounted screen.

## A13: one media-reference parser

A03 already moved public-hash, private avenDB-file and HTTP references into `media/ref.js`, with shared Rust/JS fixtures. The remaining studio proxy classifiers now use that same parser. Private audio proxies are accepted; malformed private refs and external URLs cannot masquerade as stored proxies. Public URLs and private access rules are unchanged. The old auth/media and studio-vault facades were already removed upstream.

## A12: asset-owned historical builders

The timber coop, rabbit hutch and playground now live in `models/timber.v1.js`. The world imports them; compatibility exports preserve existing world callers. Their deterministic random generator is shared from `assets/seeded.js`, with the original sequence unchanged.

Regression fingerprints cover geometry attributes, indices, groups, world transforms and material properties. All three match the original builders recovered from the pre-refactor Git revision. CI normalizes numbers to five decimal places (10 micrometres for positions) to ignore platform-specific trigonometric rounding; raw fingerprints also matched locally before and after the move. No geometry redesign or asset version bump is intended. The larger dome-room interiors still have world-specific dependencies; this change moves the historical builders identified by A12, not every world interior. The existing world-builder boundary register explicitly records this relocated legacy dependency.

## A11: one object-asset registration boundary

Things, machines, actors, plants, object-buildings and biome cover use `assets/register.js`. It preserves the existing metadata and builder identities while validating IDs, ordered history and variant builders. Missing historical world builders remain explicitly `kept: false`; registration does not pretend to reconstruct them. Specialized plants, actors and whole-world behavior stays in its owning group.

Models now use the shared parameter type. Existing recipe/card generation consumes the registered lists; no parallel card registry is added. Physical dimensions remain independently specified in `models/units.js` and measured by the size tests, rather than deriving expected sizes from a builder's own declarations.

Moving source ownership and registration changes bundled recipe hashes. The derived repository seed-card index is regenerated; all 336 cards match their pre-refactor contents after excluding the recipe hash. Published avenDB recipe bytes and frozen execution engines are not rewritten. This does not promise byte-identical rebundles of historical source: that separate A21 decision remains open. Geometry compatibility is tested independently of recipe hashes.
