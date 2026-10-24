# Frontend data comes from local avenDB

The native and browser device adapters both apply `localOperation` to file reads. A caller cannot enable peer fetching with `local: false`. The native webview bridge enforces the same restriction. Native film media also uses local reads.

Code, recipes, manifest discovery, Universe posts, named profile images and legacy media hashes read this device. Missing local data is a pending/error state, never permission to read a remote feed or media gateway. Profile pictures share the resolver with other media and update as the local world changes.

Manifests and learned view dependencies prioritize background synchronization. Timeline traversal resolves shot references and aven file roots to local entry metadata. Active entry demand also wakes the native file keeper: light/opened devices hydrate readable files for those entries in the background, subject to the same native keep selection. Demand grants no capability and cannot override a never rule. Peer transports continue operating in the background. PostgreSQL API operations remain separate and unchanged.

A manifest describes dependencies; it does not grant network authority to a renderer. A missing manifest or missing file cannot weaken the local-read policy. AIP-34 declares the V2 gameplay/film dependency routes; the live entry was confirmed applied on 2026-10-24.

Validation covers forced local reads, preserved sync operations, absent/partial local catalogs, file reads with live peers but absent local bytes, manifest audio traversal, and profile identity/deletion matching.

Traveler demo: the original broad Traveler cap is migrated to the Sandbox 4 tag; Citizen retains wider game access. Public assets and Universe posts keep their existing public shares. The person's own profile belongs to their own vault. A native `keep` restriction excludes the other games listed in the game registry and is revoked on upgrade; manifests cannot override it. This does not purge data already synced. Native schema, lens and cap-group metadata remain necessary for validating reads and sync.

The keep restriction currently targets registered non-demo games. It is not a blanket prohibition on all other public entry types; a stricter catalog-wide allowlist needs complete media dependency membership to avoid breaking public post images.
