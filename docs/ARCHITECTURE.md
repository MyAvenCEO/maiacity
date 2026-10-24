# Current architecture and retirement decisions

Reconciled against main on 2026-10-24. This is the current ownership guide, not a replacement for dated evidence or the active avenDB upgrade ledger.

## One owner per responsibility

- **Vault data:** avenDB owns cuts, library files, jobs, content-board records and published dynamic code. The studio's projections are not alternative databases. See [media storage](MEDIA_STORAGE_BOUNDARY.md) and [content/code ownership](CONTENT_CODE_LEDGER_OWNERSHIP.md).
- **Native commands:** `vault/app` embeds the avenDB device; UI and MCP remain adapters to existing native implementations. The standalone device executable remains useful for isolated tools/tests, not a production sidecar. Do not reintroduce a second device process for the same store.
- **Studio media lifecycle (A15):** `MediaSources` owns source deduplication, fetch cancellation, decoded buffers, blob URLs, serialized metadata probes, serialized native sound reads and retry eligibility. It takes narrow library/transport/presentation ports, not a `Studio` instance. `Studio` owns reactive presentation, timeline edits and playback scheduling. Destroying it closes the media service; late work cannot publish resources or start queued native reads. `cuts.js` remains the repository and job-command boundary; extraction does not duplicate native `studio_sound` or render implementations.
- **Studio scope still open:** this is the media-resource slice of A15, not a claim that the remaining playback/edit/render view model, Note proposal UI or native MCP modules are fully decomposed. Those need separately tested ownership boundaries, not arbitrary line-count splits or classes inheriting each other's mutable state. Existing cut/import/native services must be reused.
- **Descriptors (A22):** `game/places.js` owns each place's stable ID, route, display metadata, history/version and optional film descriptor. `game/games.js`, `game/film/worlds.js` and app navigation derive their projections. Vault-game order and navigation order are deliberately separate. Sandbox 7/8 remain navigation-only here; this refactor does not silently seed new vault games or grant access.
- **Film identity:** stored shot IDs are a separate namespace from current game IDs. Film `sandbox-3` still means Buildings; film `sandbox-4/5/6` still point to current Sandbox 3/4/5. Film URLs, default world, area names, channels and existing route adapters are unchanged. Registration never renumbers an existing shot or merges frozen simulations.
- **Assets and refresh:** [asset ownership and refresh](ASSET_OWNERSHIP_REFRESH.md) defines registration, retained historical builders and event-driven invalidation. Source identity for every historic asset version (A21) is not established merely by those registrations.
- **Deployment (A18):** shared SSH already exists in `prod-ssh`; shared relay/feed/browser-pass probes now live in `deploy/check-avendb.sh`. Release ownership, host locking and shared environment rules are in [deployment ownership](../deploy/OWNERSHIP.md). A shared helper is not permission to release all services together.

## Current, historical and pending

| Material | How to use it |
| --- | --- |
| This guide and the three ownership documents linked above | Current source boundaries and compatibility gates |
| `AVENDB_UPGRADE_PLAN.md` | Active upgrade ledger; its unchecked acceptance work remains open |
| `AVENDB_RELEASE_ACCEPTANCE.md` | Operator acceptance procedure plus dated observations; not evidence that every step ran |
| `AVENDB_HISTORICAL_STARTUP_EVIDENCE.md`, dated audit/latency documents, `docs/evidence` | Historical evidence pinned to the stated version/environment; revalidate against the release under test |
| Old media-vault/import plans, migration history and backup archives | Historical/migration material, not authority to restore an old writer or automatically import over live vault records |

The packaged avenDB sidecar and old media catalog are retired. Public media aliases, standalone test tooling, frozen simulation versions, migration history and backup archives are retained compatibility/evidence surfaces, not dead code. Storage deletion still requires the explicit recovery and acceptance gates in the relevant ownership document. No archive or live bytes are deleted by these architecture changes.
