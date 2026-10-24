# Reactive Sparks and Artifacts collections

This is a bounded follow-up to [the canonical active-collection projection](AVENDB_ACTIVE_COLLECTIONS.md), based on generated source/WASM head `80bb49977`. It does not complete task 5 or establish physical-device latency.

## Problem and implementation

Sparks and Artifacts formerly selected their rows from `world.entries`. Even after a mutation was accepted and targeted observers were notified, these screens waited for broad world extraction and encoding. Both now observe the existing authorized `entry_views` operation through `entryCollection` in `src/lib/avendb/entry-collection.svelte.js`.

- Sparks requests the active vault, actor, types `spark` and `note`, and canonical kind `note`. This preserves both the spark schema and the existing legacy-note predicate.
- Artifacts requests the active vault, actor, and type `artifact`.
- Sorting, deletion filtering, capture drafts and existing creation/permission operations are retained. Permission probes also wake on collection-row replacement, so their refresh need not wait for world.
- Empty/access messages use the projection's canonical all-vault `totalEntries` and `readableEntries`, rather than the number of matching rows. An empty filtered collection is not evidence that the actor cannot read anything in that vault.
- The small helper distinguishes loading, ready-empty and error states, clears stale rows on error/context replacement, and delegates disposal and late-owner reply suppression to the existing generic observer. It adds no authoritative cache, speculative write overlay, protocol rule, schema operation or peer-role special case.
- Existing observer demand handling remains in place. This patch does not change read-window leases, hydration semantics or persisted state.

The core operation and authorization semantics come from the Lean-first predecessor. This change wires existing views to that operation; it does not introduce a new core transition or require a new theorem.

## Reproducible checks

Run each command from the repository:

```sh
bun scripts/test-avendb-local-write.mjs --browser chromium --collection sparks
bun scripts/test-avendb-local-write.mjs --browser chromium --collection artifacts
bun scripts/test-avendb-local-write.mjs --browser webkit --collection sparks
bun scripts/test-avendb-local-write.mjs --browser webkit --collection artifacts
bun run check
```

The fixture mounts the actual Svelte collection component and shared local session. It deliberately holds `world` responses, then verifies accepted local title changes, incoming revision changes, creation, deletion/restoration, access revocation, error clearing/recovery, capture-draft preservation, and vault switching while an old-vault read is pending. It checks the actual row title (`li.row b`), not a fixture status label. It asserts exact actor/type/kind query scopes and includes a legacy-note Spark.

Full Svelte validation passed with zero errors and 28 existing warnings. Independent source review found no blocker.

Both old components failed the accepted local title assertion with `world` held (1500 ms DOM timeout). All four updated component/browser combinations passed. The 1500 ms timeout is a deadlock/regression guard, **not** a measured latency target. The fixture's worker responses are synthetic: it is not native engine, network, disk-durability or physical iPhone/iPad acceptance. Native authorization/projection differential tests belong to the predecessor and must pass before this dependent change ships.

The CI Chromium and WebKit jobs run both collection variants. Existing Todos and chat fixture modes remain supported.

## Still open

- Story and Note single-entry displays/history must leave their world-only observation path. Use the same authorized canonical projection; an explicit-ID scope is preferable to requesting every entry body in a vault.
- SparkRow/ArtifactRow linked-file and related-entry displays, reverse `grownFrom` lookups, and Note copies can cross vaults. They deliberately retain their current world-backed semantics here. Do not substitute only the active vault's rows: that would silently lose authorized cross-vault relationships. A bounded authorized relation/ID observer is a separate follow-up.
- Vault names and broader navigation metadata still come from world.
- Physical action-to-visible and remote-visible distributions under background load, startup replay and final installed/deployed acceptance remain required. Passing these component tests does not close generic task 5 or prove <50 ms local latency.
